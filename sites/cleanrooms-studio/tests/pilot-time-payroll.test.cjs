/* Real gateway/account handlers, all migrations and synthetic isolated accounts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shared = fs.readFileSync(path.join(__dirname, 'pilot-flow-e2e.test.cjs'), 'utf8').split("test('new employee")[0];
const { setup } = Function('require', '__dirname', shared + '\nreturn { setup };')(require, __dirname);
const period = { from: '2090-01-09', to: '2090-01-22' };
const day = '2090-01-10';
const rate = (amountCents, from = day) => ({ currency: 'DKK', agreements: [{ id: 'base', from, type: 'hourly', amountCents }], supplements: [] });

async function publish(h, shift) {
  const next = structuredClone((await h.plan()).body.studio);
  next.edits[shift.id] = shift;
  const saved = await h.save(next); assert.equal(saved.status, 200, JSON.stringify(saved));
  const published = await h.save((await h.plan()).body.studio, { ...period, siteIds: [0], includeDependencies: true });
  assert.equal(published.status, 200, JSON.stringify(published));
}

test('overnight approval applies dated group rates and prior-day allowances, then preserves pay after a current-day personal change', async t => {
  const h = await setup(t), shiftId = 'pilot-night-rates';
  const oldRate = rate(18000);
  oldRate.supplements.push({ id: 'night', name: 'Nattillæg', type: 'hourly', amountCents: 2000,
    from: day, to: day, weekdays: [1], start: '22:00', end: '06:00' });
  const policy = { schema: 1, groups: [{ id: 'night-team', name: 'Nathold', archived: false, revisions: [
    { id: 'old', from: day, payroll: oldRate },
    { id: 'new', from: '2090-01-11', payroll: rate(20000, '2090-01-11') },
  ] }], links: [{ personId: h.personId, from: day, groupId: 'night-team', baseMode: 'group',
    excludedPersonalSupplementIds: [], supplementOverrides: [] }] };
  await h.reviewedPolicy(policy);
  await publish(h, { id: shiftId, person: h.personId, site: 0, date: day, start: '22:00', end: '23:00', plannedBreakMinutes: 30, note: '' });
  await publish(h, { id: 'next-day-forecast', person: h.personId, site: 0, date: '2090-01-11', start: '07:00', end: '08:00', plannedBreakMinutes: 0, note: '' });
  const clock = (operation, version) => h.request({ action: 'shiftTime', operation, shiftId, version, comment: null, location: null });
  t.mock.timers.setTime(Date.parse(day + 'T21:00:00Z'));
  assert.equal((await clock('start', 0)).status, 200);
  t.mock.timers.setTime(Date.parse(day + 'T22:30:00Z'));
  assert.equal((await clock('pause', 1)).status, 200);
  t.mock.timers.setTime(Date.parse(day + 'T23:00:00Z'));
  assert.equal((await clock('resume', 2)).status, 200);
  t.mock.timers.setTime(Date.parse('2090-01-11T01:00:00Z'));
  const finished = await clock('finish', 3); assert.equal(finished.status, 200, JSON.stringify(finished));
  const reviewed = await h.account('timeRead', { ...period, personId: h.personId });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
  const entry = reviewed.body.entries.find(value => value.shiftId === shiftId);
  assert.equal(entry.workedMinutes, 210); assert.equal(entry.breakMinutes, 30);
  const quick = await h.account('timeWrite', { operation: 'approve', entryId: entry.id, version: entry.version, onlyIfMatchesPlan: true });
  assert.equal(quick.status, 409, 'Overtime into the next day must receive individual review.');
  const approval = await h.account('timeWrite', { operation: 'approve', entryId: entry.id, version: entry.version });
  assert.equal(approval.status, 200, JSON.stringify(approval));
  const frozen = approval.body.entry.payroll;
  assert.equal(frozen.baseCents, 67000); assert.equal(frozen.supplementCents, 7000); assert.equal(frozen.totalCents, 74000);
  let hours = await h.request({ action: 'employeeHours', ...period }); assert.equal(hours.status, 200, JSON.stringify(hours));
  assert.equal(hours.body.summary.approvedMinutes, 210); assert.equal(hours.body.summary.approvedCents, 74000);
  assert.equal(hours.body.summary.estimatedCents, 30000);
  assert.deepEqual(hours.body.rows[0].pay.interval, { startAt: day + 'T21:00:00.000Z', endAt: '2090-01-11T01:00:00.000Z' });
  const partial = await h.request({ action: 'employeeHours', from: '2090-01-11', to: '2090-01-11' });
  assert.equal(partial.status, 200, JSON.stringify(partial)); assert.equal(partial.body.summary.workedMinutes, 120);
  assert.deepEqual(partial.body.rows[0].pay.interval, { startAt: day + 'T23:00:00.000Z', endAt: '2090-01-11T01:00:00.000Z' });
  assert.ok(partial.body.rows[0].pay.unavailableReason, 'A partial frozen snapshot is not silently repriced.');

  const personal = await h.account('payrollRead', { personId: h.personId }); assert.equal(personal.status, 200);
  const changed = await h.account('payrollSave', { personId: h.personId, version: personal.body.version,
    policyVersion: personal.body.policyVersion, payroll: rate(35000, '2090-01-11') });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  hours = await h.request({ action: 'employeeHours', ...period }); assert.equal(hours.status, 200, JSON.stringify(hours));
  assert.equal(hours.body.summary.estimatedCents, 45000, 'The new current-day terms change the next planned shift.');
  assert.equal(hours.body.summary.approvedCents, 74000, 'Approved evidence retains its original group rates.');
  assert.equal(hours.body.summary.earnedCents, 74000);
  const after = await h.account('timeRead', { ...period, personId: h.personId });
  assert.deepEqual(after.body.entries.find(value => value.id === entry.id).payroll, frozen);
});

test('mobile hours expose the priced interval after late clock-in and planner correction without rewriting clock evidence', async t => {
  const h = await setup(t), shiftId = 'pilot-corrected-display';
  assert.equal((await h.account('payrollSave', { personId: h.personId, version: 0, payroll: rate(20000) })).status, 200);
  await publish(h, { id: shiftId, person: h.personId, site: 0, date: day, start: '07:00', end: '15:00', plannedBreakMinutes: 0, note: '' });
  const clock = (operation, version) => h.request({ action: 'shiftTime', operation, shiftId, version, comment: null, location: null });
  const planned = await h.request({ action: 'employeeHours', ...period });
  assert.equal(planned.body.rows[0].pay.kind, 'planned'); assert.equal(planned.body.rows[0].pay.interval, undefined);
  t.mock.timers.setTime(Date.parse(day + 'T06:22:00Z')); assert.equal((await clock('start', 0)).status, 200);
  t.mock.timers.setTime(Date.parse(day + 'T14:00:00Z')); const finished = await clock('finish', 1); assert.equal(finished.status, 200);
  let hours = await h.request({ action: 'employeeHours', ...period }); assert.equal(hours.status, 200);
  assert.equal(hours.body.rows[0].pay.kind, 'registered');
  assert.deepEqual(hours.body.rows[0].pay.interval, { startAt: day + 'T06:22:00.000Z', endAt: day + 'T14:00:00.000Z' });
  assert.equal(hours.body.rows[0].pay.minutes, 458); assert.equal(hours.body.rows[0].pay.totalCents, 152667);
  const reviewed = await h.account('timeRead', { ...period, personId: h.personId }), entry = reviewed.body.entries[0];
  const corrected = await h.account('timeWrite', { operation: 'correct', entryId: entry.id, version: entry.version,
    start: '07:00', end: '15:00', endDate: day, breakMinutes: 0, reason: 'Ankomst kl.07 bekræftet af teamlederen.' });
  assert.equal(corrected.status, 200, JSON.stringify(corrected));
  hours = await h.request({ action: 'employeeHours', ...period }); assert.equal(hours.status, 200);
  assert.equal(hours.body.rows[0].entry.clockIn, day + 'T06:22:00.000Z');
  assert.deepEqual(hours.body.rows[0].pay.interval, { startAt: day + 'T06:00:00.000Z', endAt: day + 'T14:00:00.000Z' });
  assert.equal(hours.body.rows[0].pay.minutes, 480); assert.equal(hours.body.rows[0].pay.totalCents, 160000);
  const approval = await h.account('timeWrite', { operation: 'approve', entryId: entry.id, version: corrected.body.entry.version });
  assert.equal(approval.status, 200, JSON.stringify(approval));
  hours = await h.request({ action: 'employeeHours', ...period }); assert.equal(hours.status, 200);
  assert.equal(hours.body.rows[0].entry.status, 'approved');
  assert.equal(hours.body.rows[0].entry.clockIn, day + 'T06:22:00.000Z');
  assert.deepEqual(hours.body.rows[0].pay.interval, { startAt: day + 'T06:00:00.000Z', endAt: day + 'T14:00:00.000Z' });
  assert.equal(hours.body.summary.approvedCents, 160000);
});
