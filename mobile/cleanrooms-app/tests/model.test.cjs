const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const build = process.env.CLEANROOMS_TEST_BUILD;
if (!build) throw new Error('Run node tests/run.mjs to compile and test the actual domain modules.');
const M = require(path.join(build, 'domain/model.js'));
const { createDemoState } = require(path.join(build, 'domain/demo.js'));
const { applyAction, rolloverDemoDay } = require(path.join(build, 'state/transitions.js'));
const { validateSnapshot, decodeSnapshot } = require(path.join(build, 'state/snapshot.js'));
const at = (date, time) => M.instantForLocal(date, time);
const iso = (date, time) => new Date(at(date, time)).toISOString();
const seed = () => createDemoState(at('2026-11-04', '18:00'));
const shift = (changes = {}) => ({ id: 's', personId: 'jonas', siteId: 'ringsted', date: '2026-11-04', start: '08:00', end: '16:00', breakMinutes: 0, role: 'Service', description: '', checklist: [], ...changes });
const entry = (changes = {}) => ({ shiftId: 's', clockIn: iso('2026-11-04', '08:00'), clockOut: iso('2026-11-04', '16:00'), pauses: [], comment: '', completedTaskIds: [], status: 'submitted', ...changes });

test('26th–25th payroll periods cross years/months and navigate without day overflow', () => {
  assert.deepEqual([M.payPeriod('2026-01-25').from, M.payPeriod('2026-01-25').to], ['2025-12-26', '2026-01-25']);
  assert.deepEqual([M.payPeriod('2026-01-26').from, M.payPeriod('2026-01-26').to], ['2026-01-26', '2026-02-25']);
  assert.equal(M.payPeriod('2026-12-30', 1).from, '2027-01-26');
  assert.equal(M.payPeriod('2026-03-01', -1).to, '2026-02-25');
  assert.equal(M.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(M.validDate('2026-02-30'), false);
});

test('overnight and both Copenhagen DST changes count elapsed time, not wall-clock differences', () => {
  assert.equal(M.plannedMinutes(shift({ start: '23:00', end: '07:00' })), 480);
  assert.equal(M.plannedMinutes(shift({ date: '2026-03-29', start: '00:00', end: '08:00' })), 420);
  assert.equal(M.plannedMinutes(shift({ date: '2026-10-25', start: '00:00', end: '08:00' })), 540);
  assert.throws(() => at('2026-03-29', '02:30'), /sommertid/);
  assert.equal(new Date(at('2026-10-25', '02:30')).toISOString(), '2026-10-25T00:30:00.000Z');
});

test('actual paused minutes are clipped to the work interval and overlapping pauses counted once', () => {
  const e = entry({ pauses: [{ start: iso('2026-11-04', '07:30'), end: iso('2026-11-04', '08:30') }, { start: iso('2026-11-04', '12:00'), end: iso('2026-11-04', '13:00') }, { start: iso('2026-11-04', '12:30'), end: iso('2026-11-04', '13:30') }] });
  assert.equal(M.workedMinutes(e, at('2026-11-04', '20:00')), 360);
  assert.equal(M.workedMinutes(entry({ clockOut: undefined, status: 'paused', pauses: [{ start: iso('2026-11-04', '09:00') }] }), at('2026-11-04', '10:00')), 60);
});

test('custom periods clip overnight paid time after subtracting pauses', () => {
  const e = entry({ clockIn: iso('2026-11-03', '22:00'), clockOut: iso('2026-11-04', '06:00'), pauses: [{ start: iso('2026-11-03', '23:30'), end: iso('2026-11-04', '00:30') }] });
  assert.equal(M.workedMinutesInPeriod(e, '2026-11-04', '2026-11-04', at('2026-11-05', '12:00')), 330);
  assert.equal(M.plannedMinutesInPeriod(shift({ date: '2026-11-03', start: '22:00', end: '06:00' }), '2026-11-04', '2026-11-04'), 360);
});

test('future planned pay remains a forecast; period earnings never include an open clock entry', () => {
  const state = seed(); state.shifts = [shift({ date: '2026-11-05' })]; state.entries = [];
  const summary = M.summarizePeriod(state, '2026-11-05', '2026-11-05', at('2026-11-04', '10:24'));
  assert.equal(summary.earnedCents, 0); assert.equal(summary.approvedCents, 0); assert.equal(summary.estimatedCents, 150000);
  state.entries = [entry({ clockIn: iso('2026-11-05', '08:00'), clockOut: undefined, status: 'running' })];
  assert.equal(M.summarizePeriod(state, '2026-11-05', '2026-11-05', at('2026-11-04', '10:24')).workedMinutes, 0);
  assert.equal(M.workedMinutes(entry(), at('2026-11-04', '10:00')), 120);
});

test('running and paused entries never accrue period totals, even when the selected period is in the past', () => {
  const state = seed();
  state.shifts = [shift({ id: 'running', date: '2026-11-03' }), shift({ id: 'paused', date: '2026-11-03', start: '18:00', end: '22:00' })];
  state.entries = [
    entry({ shiftId: 'running', clockIn: iso('2026-11-03', '08:00'), clockOut: undefined, status: 'running' }),
    entry({ shiftId: 'paused', clockIn: iso('2026-11-03', '18:00'), clockOut: undefined, status: 'paused', pauses: [{ start: iso('2026-11-03', '19:00') }] }),
  ];
  const earlier = M.summarizePeriod(state, '2026-11-03', '2026-11-03', at('2026-11-04', '10:24'));
  const later = M.summarizePeriod(state, '2026-11-03', '2026-11-03', at('2026-11-07', '16:00'));
  assert.deepEqual(later, earlier);
  for (const field of ['workedMinutes', 'earnedCents', 'baseEarnedCents', 'allowanceEarnedCents', 'approvedMinutes', 'approvedCents', 'completedCount', 'progress']) assert.equal(earlier[field], 0, field);
  assert.equal(earlier.plannedMinutes, 720); assert.equal(earlier.estimatedCents, 235000);
  assert.equal(M.workedMinutes(state.entries[0], at('2026-11-03', '09:00')), 60); // standalone shift clock stays live
});

test('clock-out adds completed own time and pay once, before approval, and later display-clock changes do not alter it', () => {
  const state = seed(), own = state.shifts.find(s => s.id === 'own-' + state.today);
  state.shifts = [own]; state.entries = [state.entries.find(e => e.shiftId === own.id)];
  const before = M.summarizePeriod(state, state.today, state.today, at(state.today, '10:24'));
  assert.equal(before.workedMinutes, 0); assert.equal(before.earnedCents, 0); assert.equal(before.progress, 0);
  const stamp = at(state.today, '10:24') + 12_000;
  const closed = applyAction(state, { type: 'clockOut', shiftId: own.id }, stamp);
  assert.equal(closed.result.ok, true);
  const immediate = M.summarizePeriod(closed.state, state.today, state.today, at(state.today, '10:24')); // UI may round now down to the minute
  const later = M.summarizePeriod(closed.state, state.today, state.today, at('2026-11-09', '20:00'));
  assert.deepEqual(immediate, later);
  assert.equal(immediate.workedMinutes, 131); assert.equal(immediate.completedCount, 1);
  assert.equal(immediate.baseEarnedCents, 41000); assert.equal(immediate.allowanceEarnedCents, 0);
  assert.equal(immediate.approvedMinutes, 0); assert.equal(immediate.approvedCents, 0);
  assert.equal(immediate.plannedMinutes, 450); assert.equal(immediate.progress, 131 / 450);
  const duplicate = applyAction(closed.state, { type: 'clockOut', shiftId: own.id }, stamp + 60_000);
  assert.equal(duplicate.result.ok, false);
  assert.deepEqual(M.summarizePeriod(duplicate.state, state.today, state.today, stamp + 60_000), immediate);
  const approved = { ...closed.state, entries: closed.state.entries.map(e => ({ ...e, status: 'approved' })) };
  const approvedSummary = M.summarizePeriod(approved, state.today, state.today, stamp + 60_000);
  assert.equal(approvedSummary.earnedCents, immediate.earnedCents); assert.equal(approvedSummary.workedMinutes, immediate.workedMinutes);
  assert.equal(approvedSummary.approvedCents, immediate.earnedCents); assert.equal(approvedSummary.approvedMinutes, immediate.workedMinutes);
});

test('completed totals clip overnight intervals and pauses to the selected period, excluding other employees', () => {
  const state = seed();
  state.shifts = [shift({ id: 'own-night', date: '2026-11-03', start: '22:00', end: '06:00' }), shift({ id: 'other-night', personId: 'sara', date: '2026-11-03', start: '22:00', end: '06:00' })];
  const timing = { clockIn: iso('2026-11-03', '22:00'), clockOut: iso('2026-11-04', '06:00'), pauses: [{ start: iso('2026-11-03', '23:30'), end: iso('2026-11-04', '00:30') }] };
  state.entries = [entry({ shiftId: 'own-night', ...timing }), entry({ shiftId: 'other-night', ...timing, status: 'approved' })];
  const summary = M.summarizePeriod(state, '2026-11-04', '2026-11-04', at('2026-11-05', '12:00'));
  assert.equal(summary.workedMinutes, 330); assert.equal(summary.baseEarnedCents, 103125); assert.equal(summary.allowanceEarnedCents, 0);
  assert.equal(summary.approvedMinutes, 0); assert.equal(summary.completedCount, 1);
});

test('closed totals use elapsed time across both DST changes, independently of the display clock', () => {
  const state = seed();
  for (const [date, minutes] of [['2026-03-29', 420], ['2026-10-25', 540]]) {
    state.shifts = [shift({ date, start: '00:00', end: '08:00' })];
    state.entries = [entry({ clockIn: iso(date, '00:00'), clockOut: iso(date, '08:00'), status: 'approved' })];
    const result = M.summarizePeriod(state, date, date, at(date, '12:00'));
    assert.equal(result.workedMinutes, minutes); assert.equal(result.approvedMinutes, minutes);
    assert.equal(result.baseEarnedCents, minutes * 18750 / 60);
    assert.equal(result.allowanceEarnedCents, minutes * 3500 / 60);
    assert.deepEqual(M.summarizePeriod(state, date, date, at(M.addDays(date, 1), '12:00')), result);
  }
});

test('demo allowances are calculated by worked interval and future forecasts remain distinct', () => {
  const state = seed(); state.shifts = [shift({ date: '2026-11-07', start: '17:00', end: '20:00' })]; state.entries = [entry({ clockIn: iso('2026-11-07', '17:00'), clockOut: iso('2026-11-07', '20:00'), status: 'approved' })];
  const summary = M.summarizePeriod(state, '2026-11-07', '2026-11-07', at('2026-11-08', '12:00'));
  assert.equal(summary.baseEarnedCents, 56250);
  assert.equal(summary.allowanceEarnedCents, 15500); // 3×35 weekend + 2×25 evening DKK
  assert.equal(summary.earnedCents, summary.approvedCents);
  assert.equal(summary.progress, 1);
});

test('a shift uses planned gross pay until clock-out, then actual paid time and allowance windows', () => {
  const date = '2026-11-07'; // Saturday
  const saturday = shift({ date, start: '17:00', end: '21:00', breakMinutes: 60 });
  const registration = entry({
    clockIn: iso(date, '17:00'), clockOut: iso(date, '21:00'),
    pauses: [{ start: iso(date, '17:00'), end: iso(date, '18:00') }],
  });
  const planned = { kind: 'planned', minutes: 180, baseCents: 56250, allowanceCents: 15500, totalCents: 71750 };
  const registered = { kind: 'registered', minutes: 180, baseCents: 56250, allowanceCents: 18000, totalCents: 74250 };
  assert.deepEqual(M.shiftPay(saturday), planned);
  assert.deepEqual(M.shiftPay(saturday, { ...registration, clockOut: undefined, status: 'running' }), planned);
  assert.deepEqual(M.shiftPay(saturday, { ...registration, clockOut: undefined, status: 'paused' }), planned);
  assert.deepEqual(M.shiftPay(saturday, { ...registration, shiftId: 'other-shift' }), planned);
  assert.deepEqual(M.shiftPay(saturday, registration), registered);
  assert.deepEqual(M.shiftPay(saturday, { ...registration, status: 'approved' }), registered);
});

test('a shift spanning midnight uses only paid time and applicable allowances within the selected dates', () => {
  const from = '2026-11-07', to = from;
  const night = shift({ date: '2026-11-06', start: '22:00', end: '06:00' });
  const registration = entry({
    clockIn: iso('2026-11-06', '22:00'), clockOut: iso(from, '06:00'),
    pauses: [{ start: iso('2026-11-06', '23:30'), end: iso(from, '00:30') }],
  });
  const planned = M.shiftPay(night, undefined, { from, to });
  const registered = M.shiftPay(night, registration, { from, to });
  assert.deepEqual(planned, { kind: 'planned', minutes: 360, baseCents: 112500, allowanceCents: 21000, totalCents: 133500 });
  assert.deepEqual(registered, { kind: 'registered', minutes: 330, baseCents: 103125, allowanceCents: 19250, totalCents: 122375 });
  const state = { ...seed(), shifts: [night], entries: [registration] };
  const summary = M.summarizePeriod(state, from, to, at(from, '20:00'));
  assert.equal(summary.estimatedCents, planned.totalCents);
  assert.equal(summary.earnedCents, registered.totalCents);
  assert.equal(summary.workedMinutes, registered.minutes);
});

test('request creation is pending, duplicates rejected and assigning/open schedule is unchanged', () => {
  const state = seed(), now = at(state.today, '10:24');
  const own = state.shifts.find(s => s.id === 'own-2026-11-05');
  const first = applyAction(state, { type: 'requestLeave', shiftId: own.id, comment: 'Lægetid' }, now);
  assert.equal(first.result.ok, true); assert.equal(first.state.requests.at(-1).status, 'pending');
  assert.equal(first.state.shifts, state.shifts);
  assert.equal(applyAction(first.state, { type: 'requestLeave', shiftId: own.id }, now).result.ok, false);
  assert.equal(applyAction(state, { type: 'claimShift', shiftId: 'open-evening' }, now).result.ok, false);
  const claim = applyAction(state, { type: 'claimShift', shiftId: 'open-later' }, now);
  assert.equal(claim.result.ok, true); assert.equal(claim.state.shifts.find(s => s.id === 'open-later').personId, null);
  assert.equal(applyAction(claim.state, { type: 'claimShift', shiftId: 'open-later' }, now).result.ok, false);
  const overlaps = { ...state, shifts: [...state.shifts, shift({ id: 'open-conflict', personId: null, date: '2026-11-05' })] };
  assert.match(applyAction(overlaps, { type: 'claimShift', shiftId: 'open-conflict' }, now).result.error, /overlapper/);
});

test('coworker list is for the whole day at the same site, including a non-overlapping evening worker', () => {
  const state = seed(), own = state.shifts.find(s => s.id === 'own-2026-11-04');
  const coworkerIds = M.coworkersForDay(state, own).map(p => p.id);
  assert.deepEqual(coworkerIds.sort(), ['emma', 'mikkel', 'sara']);
  assert.equal(M.shiftInterval(state.shifts.find(s => s.id === 'mikkel-2026-11-04')).start, M.shiftInterval(own).end);
  state.shifts.push(shift({ id: 'night-coworker', personId: 'oscar', date: '2026-11-03', start: '22:00', end: '02:00' }));
  assert.ok(M.coworkersForDay(state, own).some(p => p.id === 'oscar'));
  assert.deepEqual(M.coworkerShiftsForDay(state, own, 'oscar').map(s => s.id), ['night-coworker']);
  state.shifts.at(-1).end = '00:00';
  assert.equal(M.coworkersForDay(state, own).some(p => p.id === 'oscar'), false);
});

test('simulated day rollover preserves persistent activity and the original clock anchor', () => {
  const state = seed(), unchanged = rolloverDemoDay(state, at(state.today, '23:59'));
  assert.equal(unchanged, state);
  const next = rolloverDemoDay(state, at('2026-11-05', '00:00'));
  assert.equal(next.today, '2026-11-05'); assert.equal(next.entries, state.entries);
  assert.equal(next.demoBaseAt, state.demoBaseAt); assert.equal(next.demoStartedAt, state.demoStartedAt);
  assert.equal(M.payPeriod(next.today).from, '2026-10-26');
});

test('checklist completion is per own shift, cannot create a fake time entry or change someone else', () => {
  const state = seed(), now = at(state.today, '10:24');
  const changed = applyAction(state, { type: 'toggleTask', shiftId: 'own-2026-11-04', taskId: 'supplies' }, now);
  assert.equal(changed.result.ok, true);
  assert.equal(changed.state.entries.find(e => e.shiftId === 'own-2026-11-04').completedTaskIds.includes('supplies'), true);
  assert.deepEqual(changed.state.entries.find(e => e.shiftId === 'early-2026-11-04').completedTaskIds, state.entries.find(e => e.shiftId === 'early-2026-11-04').completedTaskIds);
  assert.equal(applyAction(state, { type: 'toggleTask', shiftId: 'own-2026-11-05', taskId: 'opening' }, now).result.ok, false);
  assert.equal(applyAction(state, { type: 'toggleTask', shiftId: 'sara-2026-11-04', taskId: 'opening' }, now).result.ok, false);
});

test('clock-out preserves original clock-in, closes pause, and retains employee explanation', () => {
  const state = seed(), now = at(state.today, '10:24'), original = state.entries.find(e => e.shiftId === 'own-' + state.today);
  const paused = applyAction(state, { type: 'pause', shiftId: original.shiftId }, now);
  assert.equal(paused.result.ok, true);
  const finished = applyAction(paused.state, { type: 'clockOut', shiftId: original.shiftId, comment: 'Jeg mødte kl. 8.' }, now + 600_000);
  const result = finished.state.entries.find(e => e.shiftId === original.shiftId);
  assert.equal(result.clockIn, original.clockIn); assert.equal(result.status, 'submitted'); assert.equal(result.comment, 'Jeg mødte kl. 8.');
  assert.equal(result.pauses.at(-1).end, result.clockOut);
  assert.equal(applyAction(finished.state, { type: 'clockIn', shiftId: original.shiftId }, now + 660_000).result.ok, false);
  assert.equal(applyAction(paused.state, { type: 'resume', shiftId: original.shiftId }, now - 60_000).result.ok, false);
});

test('clock-in uses the same opening time and restrictions for display and registration', () => {
  const own = shift();
  const other = shift({ id: 'other', personId: 'sara' });
  const state = { ...seed(), shifts: [own, other], entries: [], sites: [{ id: own.siteId, name: 'Arbejdssted', address: '' }] };
  const opensAt = at(own.date, '07:30');
  const assertAvailability = (current, target, now, allowed, expectedOpening = opensAt) => {
    const availability = M.clockInAvailability(current, target, now);
    assert.equal(availability.opensAt, expectedOpening);
    assert.equal(availability.allowed, allowed);
    const result = applyAction(current, { type: 'clockIn', shiftId: target.id }, now).result;
    assert.equal(result.ok, allowed);
    assert.equal(result.error, availability.reason);
  };

  assertAvailability(state, own, opensAt - 1, false);
  assertAvailability(state, own, opensAt, true);
  assertAvailability(state, own, at(own.date, own.end), false);
  assertAvailability(state, other, opensAt, false);
  assertAvailability({ ...state, entries: [entry()] }, own, opensAt, false);

  const earlier = shift({ id: 'earlier', start: '06:00', end: '07:00' });
  const busy = {
    ...state,
    shifts: [own, earlier],
    entries: [entry({ shiftId: earlier.id, clockIn: iso(own.date, '06:00'), clockOut: undefined, status: 'running' })],
  };
  assertAvailability(busy, own, opensAt, false);

  const midnightShift = shift({ start: '00:10' });
  const midnight = at(midnightShift.date, '00:00');
  const nightState = { ...state, shifts: [midnightShift] };
  assertAvailability(nightState, midnightShift, midnight - 1, false, midnight);
  assertAvailability(nightState, midnightShift, midnight, true, midnight);
});

test('GPS clock-in requires a fresh, precise and in-range fix without storing employee coordinates', () => {
  const own = shift();
  const geofence = { latitude: 0, longitude: 0, radiusMeters: 100 };
  const state = { ...seed(), shifts: [own], entries: [], sites: [{ id: own.siteId, name: 'Arbejdssted', address: '', geofence }] };
  const now = at(own.date, '08:00');
  const checkedAt = now + 3_600_000;
  const valid = { latitude: 0, longitude: 0.0001, accuracyMeters: 10, timestamp: checkedAt - 1_000 };
  const clockIn = location => applyAction(state, { type: 'clockIn', shiftId: own.id, location }, now, checkedAt);

  for (const [location, error] of [
    [undefined, /GPS-placering/],
    [{ ...valid, mocked: true }, /simuleret placering/],
    [{ ...valid, timestamp: checkedAt - M.maxClockInLocationAgeMs - 1 }, /ikke aktuel/],
    [{ ...valid, timestamp: checkedAt + 1 }, /ikke aktuel/],
    [{ ...valid, accuracyMeters: null }, /upræcis/],
    [{ ...valid, accuracyMeters: M.maxClockInAccuracyMeters + 1 }, /upræcis/],
    [{ ...valid, longitude: 0.002 }, /for langt/],
    [{ ...valid, longitude: 0.0008, accuracyMeters: 20 }, /for tæt på grænsen/],
  ]) {
    const rejected = clockIn(location);
    assert.equal(rejected.state, state);
    assert.equal(rejected.result.ok, false);
    assert.match(rejected.result.error, error);
  }

  const accepted = clockIn(valid);
  assert.equal(accepted.result.ok, true);
  assert.deepEqual(accepted.state.entries, [{ shiftId: own.id, clockIn: new Date(now).toISOString(), pauses: [], comment: '', completedTaskIds: [], status: 'running' }]);
  assert.equal(applyAction(accepted.state, { type: 'clockOut', shiftId: own.id }, now + 3_600_000).result.ok, true);
});

test('local clock-in uses its configured GPS area and ignores retired browser policy overrides', () => {
  const own = shift();
  const geofence = { latitude: 55, longitude: 12, radiusMeters: 150 };
  const state = { ...seed(), shifts: [own], entries: [], sites: [{
    id: own.siteId, name: 'Arbejdssted', address: '', geofence,
  }] };
  const now = at(own.date, '08:00');
  const clockIn = (location, workplacePolicy) => applyAction(state, { type: 'clockIn', shiftId: own.id, location, workplacePolicy }, now);
  assert.match(clockIn().result.error, /GPS-placering/);
  assert.equal(clockIn({ latitude: 55, longitude: 12, accuracyMeters: 5, timestamp: now }).result.ok, true);
  assert.equal(clockIn(undefined, { siteId: own.siteId, geofence: null }).result.ok, false);
  assert.equal(clockIn({ latitude: 0, longitude: 0, accuracyMeters: 5, timestamp: now }, {
    siteId: own.siteId, geofence: { latitude: 0, longitude: 0, radiusMeters: 45 },
  }).result.ok, false);
  const noGps = { ...state, sites: state.sites.map(({ geofence: ignored, ...site }) => site) };
  assert.equal(applyAction(noGps, { type: 'clockIn', shiftId: own.id }, now).result.ok, true);
  assert.deepEqual(state.sites[0].geofence, geofence);
});

test('retired browser connections are removed from saved state without losing records or GPS configuration', () => {
  const state = seed();
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.sites[0].workplacePolicyLink = { id: 'web-ringsted', name: 'CK Ringsted', workspaceId: 'tenant-id' };
  legacy.sites[1].workplacePolicyLink = { invalidOldLink: true };
  const restored = decodeSnapshot(JSON.stringify(legacy));
  assert.deepEqual(restored, state);
  assert.ok(restored.entries.some(record => record.pauses.length));
  assert.ok(restored.entries.some(record => record.completedTaskIds.length));
  assert.ok(restored.sites.every(site => !Object.hasOwn(site, 'workplacePolicyLink')));
  assert.deepEqual(restored.sites.map(site => site.geofence), state.sites.map(site => site.geofence));
  assert.deepEqual(decodeSnapshot(JSON.stringify(restored)), restored);
});

test('local chat actions require membership and mark only the selected room read', () => {
  const state = seed(), now = at(state.today, '10:24');
  const read = applyAction(state, { type: 'markRoomRead', roomId: 'ringsted-team' }, now);
  assert.ok(read.state.messages.filter(m => m.roomId === 'ringsted-team').every(m => m.read));
  assert.equal(read.state.messages.find(m => m.id === 'm4').read, false);
  assert.equal(applyAction(state, { type: 'sendMessage', roomId: 'unknown', text: 'Hej' }, now).result.ok, false);
  assert.equal(applyAction(state, { type: 'sendMessage', roomId: 'ringsted-team', text: '   ' }, now).result.ok, false);
  assert.equal(applyAction(state, { type: 'sendMessage', roomId: 'ringsted-team', text: 'Hej team' }, now).state.messages.at(-1).personId, state.selfId);
});

test('snapshot hydration validates version, entity references, clock consistency and per-shift task IDs', () => {
  const state = seed();
  assert.equal(validateSnapshot(state), true);
  assert.deepEqual(decodeSnapshot(JSON.stringify(state)), state);
  assert.equal(validateSnapshot({ ...state, schemaVersion: 2 }), false);
  assert.equal(validateSnapshot({ ...state, entries: [...state.entries, state.entries[0]] }), false);
  const malformed = structuredClone(state); malformed.entries[0].completedTaskIds.push('nonexistent-task');
  assert.equal(validateSnapshot(malformed), false);
  assert.throws(() => decodeSnapshot('{bad JSON'));
  assert.equal(validateSnapshot({ ...state, shifts: state.shifts.map((s, i) => i === 0 ? { ...s, date: '2026-02-30' } : s) }), false);
});

test('unavailable days persist through older snapshots without changing existing shifts', () => {
  const legacy = seed();
  delete legacy.unavailableDates;
  const restored = decodeSnapshot(JSON.stringify(legacy));
  assert.deepEqual(restored.unavailableDates, []);

  const date = restored.today;
  const mark = { type: 'setUnavailableDate', date, unavailable: true };
  const now = at(date, '10:24');
  const marked = applyAction(restored, mark, now);
  assert.equal(marked.result.ok, true);
  assert.equal(marked.state.shifts, restored.shifts);
  assert.equal(marked.state.entries, restored.entries);
  assert.equal(applyAction(marked.state, mark, now).state, marked.state);
  assert.deepEqual(decodeSnapshot(JSON.stringify(marked.state)).unavailableDates, [date]);
  assert.equal(validateSnapshot({ ...marked.state, unavailableDates: [date, date] }), false);

  const afterMidnight = at(M.addDays(date, 1), '00:01');
  assert.equal(applyAction(restored, mark, afterMidnight).result.ok, false);
  const removed = applyAction(marked.state, { ...mark, unavailable: false }, afterMidnight);
  assert.equal(removed.result.ok, true);
  assert.deepEqual(removed.state.unavailableDates, []);
});

test('older demos gain valid shift change history without replacing saved hours or activity', () => {
  const legacy = seed();
  const changed = legacy.shifts.find(shift => shift.previousTime);
  assert.ok(changed);
  delete changed.previousTime;
  legacy.messages[0].read = false;

  const restored = decodeSnapshot(JSON.stringify(legacy));
  const restoredShift = restored.shifts.find(shift => shift.id === changed.id);
  assert.deepEqual(restoredShift.previousTime, { start: '07:00', end: '15:00' });
  delete restoredShift.previousTime;
  assert.deepEqual(restored, legacy);

  changed.previousTime = { start: '25:00', end: '15:00' };
  assert.equal(validateSnapshot(legacy), false);
  changed.previousTime = { start: changed.start, end: changed.end };
  assert.equal(validateSnapshot(legacy), false);
});

test('legacy demo GPS areas are added without overriding configured or custom worksites', () => {
  const legacy = seed();
  const [ringsted, nykobing] = legacy.sites;
  const ringstedFence = ringsted.geofence;
  delete ringsted.geofence;
  nykobing.geofence.radiusMeters = 120;
  legacy.sites.push({ id: 'custom', name: 'Eget arbejdssted', address: 'Stationsvej 1' });

  assert.equal(validateSnapshot(legacy), true);
  const restored = decodeSnapshot(JSON.stringify(legacy));
  assert.deepEqual(restored.sites[0].geofence, ringstedFence);
  assert.deepEqual(restored.sites[1], nykobing);
  assert.deepEqual(restored.sites[2], legacy.sites[2]);
  assert.deepEqual(restored.entries, legacy.entries);

  restored.sites[0].geofence.latitude = 100;
  assert.equal(validateSnapshot(restored), false);
});


test('overnight clock-in remains available after midnight and preserves the original shift identity', () => {
  const night=shift({id:'night-new-year',date:'2026-12-31',start:'22:00',end:'06:00'}),state={...seed(),today:'2027-01-01',shifts:[night],entries:[],sites:[{id:night.siteId,name:'Own site',address:''}]};
  const now=at('2027-01-01','00:22');
  assert.equal(M.clockInAvailability(state,night,now).allowed,true);
  const started=applyAction(state,{type:'clockIn',shiftId:night.id},now);assert.equal(started.result.ok,true);
  assert.equal(started.state.entries[0].shiftId,night.id);assert.equal(started.state.entries[0].clockIn,iso('2027-01-01','00:22'));
  assert.equal(M.clockInAvailability(state,night,at('2027-01-01','06:00')).allowed,false);
  assert.deepEqual(M.upcoming(state,'2027-01-01').map(item=>item.id),[night.id]);
});

test('night calendars cover both days but a midnight checkout occupies only the start day', () => {
  const night=shift({date:'2026-12-31',start:'22:00',end:'06:00'});
  assert.deepEqual(M.shiftDates(night),['2026-12-31','2027-01-01']);
  assert.deepEqual(M.shiftDates({...night,end:'00:00'}),['2026-12-31']);
  assert.equal(M.shiftOverlapsDates(night,'2027-01-01','2027-01-01'),true);
  assert.equal(M.shiftOverlapsDates({...night,end:'00:00'},'2027-01-01','2027-01-01'),false);
  assert.equal(M.shiftTimeLabel(night),'22:00–06:00 (+1 dag)');
  assert.equal(M.shiftTimeLabel({...night,start:'08:00',end:'16:00'}),'08:00–16:00');
  assert.throws(()=>M.shiftInterval({...night,start:'22:00',end:'22:00'}),/forskellige/);
});
