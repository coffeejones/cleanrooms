/* Real API handlers + all migrations on isolated SQLite. The gateway fetch is
   in-process, so this does not claim to test production Sites ingress or GPS. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
const Workspace = require('../lib/workspace-store.mjs'), Store = require('../lib/studio-store.mjs');
const { handleMobileAuthRequest } = require('../lib/mobile-auth-route.mjs');
const { handleGatewayRequest } = require('../../cleanrooms-app-api/worker/index.js');
const Departments = require('../src/department-model.js'), Planning = require('../src/planning-records.js');
const Time = require('../src/timekeeping-model.js');
const owner = 'pilot-owner', secret = 'a'.repeat(64), gatewayKey = 'b'.repeat(64);
const from = '2090-01-09', to = '2090-01-22', day = '2090-01-10';
const rich = JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lås døren efter arbejdet' }] }] }] }] });
const pay = amount => ({ currency: 'DKK', agreements: [{ id: 'hourly-rate', from: day, type: 'hourly', amountCents: amount }],
  supplements: [{ id: 'service', name: 'Servicetillæg', type: 'hourly', amountCents: 1200, from: day, to: null, weekdays: [0, 1, 2, 3, 4, 5, 6], start: null, end: null }] });
async function setup(t,{now=Date.parse(day+'T06:00:00Z')}={}) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  const db = { beforeBatch: null, prepare: sql => ({ bind: (...values) => ({ sql, values }) }) };
  db.batch = async statements => {
    await db.beforeBatch?.(statements); sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(({ sql, values }) => {
        assert.ok(values.length <= 100, 'D1 binding limit');
        const query = sqlite.prepare(sql);
        return query.columns().length ? { results: query.all(...values) } : { meta: { changes: Number(query.run(...values).changes) } };
      }); sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  const studio = { storageVersion: 1, demoSeed: false, roster: [], organization: Departments.defaultOrganization(), series: [], edits: {}, deleted: [], requests: {}, weekPlans: {}, coverageRules: [], checklistProgress: {} };
  assert.equal((await Store.writeStudio(db, owner, 0, studio)).ok, true);
  const headers = { origin: 'https://studio.test', 'content-type': 'application/json', 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': 'owner@example.test' };
  const json = async response => ({ status: response.status, body: await response.json(), headers: response.headers });
  const plan = (method = 'GET', body) => Workspace.handleWorkspaceStudioRequest(new Request('https://studio.test/api/studio', {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), db).then(json);
  const account = (action, payload = {}) => Workspace.handleAccountsRequest(new Request('https://studio.test/api/accounts', {
    method: 'POST', headers, body: JSON.stringify({ action, ...payload }),
  }), db, secret).then(json);
  assert.equal((await plan()).status, 200);
  const created = await account('createEmployeeUser', { name: 'Søren Pilot', email: 'soren@example.test', site: 0, roleId: 'employee' });
  assert.equal(created.status, 200, JSON.stringify(created)); const personId = created.body.createdEmployee.id;
  const start = await account('revealAppStartCode', { personId, version: 1 }); assert.equal(start.status, 200);
  const mobile = async (payload, token) => {
    const response = await handleGatewayRequest(new Request('https://mobile.test/api/mobile-auth', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.40', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload),
    }), { STUDIO_ORIGIN: 'https://studio.test', MOBILE_GATEWAY_KEY: gatewayKey, STUDIO_SITE_ACCESS_TOKEN: 'local-only-test-gate' }, async (_url, options) => {
      assert.equal(options.headers.get('OAI-Sites-Authorization'), 'Bearer local-only-test-gate');
      // The gateway constructs headers; web administrator identity never crosses.
      assert.equal(options.headers.get('oai-authenticated-user-id'), null);
      const result = await handleMobileAuthRequest(new Request('https://studio.test/api/mobile-auth', options), db, gatewayKey);
      assert.equal(result.headers.get('x-request-id'), options.headers.get('x-request-id'));
      return result;
    });
    return json(response);
  };
  const login = await mobile({ action: 'login', email: 'soren@example.test', password: start.body.temporaryPassword });
  assert.equal(login.status, 200, JSON.stringify(login)); const token = login.body.token;
  const request = payload => mobile(payload, token);
  const save = async (next, publication) => {
    const current = await plan(), changes = Planning.commands(current.body.studio, next, current.body.planning.versions);
    return plan('PUT', { revision: current.body.revision, directoryRevision: current.body.directory.revision,
      commandReceipt: 'records', studio: Planning.payloadStudio(next), planning: { version: 1, changes,
        metadataChanged: Planning.canonical(Planning.metadata(current.body.studio)) !== Planning.canonical(Planning.metadata(next)),
        metadataBase: current.body.planning.metadataHash, dependencies: Planning.dependencies(current.body.studio, changes, current.body.planning.versions) },
      ...(publication ? { publication } : {}) });
  };
  const reviewedPolicy = async (policy, version = 0, date = day) => {
    const preview = await account('payrollPolicyPreview', { policy, version, date }); assert.equal(preview.status, 200, JSON.stringify(preview));
    const result = await account('payrollPolicySave', { policy, version, date, previewToken: preview.body.previewToken }); assert.equal(result.status, 200, JSON.stringify(result)); return result.body;
  };
  return { db, sqlite, personId, account, plan, request, save, reviewedPolicy };
}

test('new employee -> recurring publication -> inbox/checklist -> server clock/pause -> approval -> frozen group pay', async t => {
  const h = await setup(t), { personId, request, account } = h;
  const schedule = { action: 'publishedSchedule', from, to, cursor: null };
  assert.deepEqual((await request(schedule)).body.shifts, []);
  const policy = { schema: 1, groups: [{ id: 'service-team', name: 'Servicehold', archived: false, revisions: [{ id: 'first-period', from: day, payroll: pay(18000) }] }],
    links: [{ personId, from: day, groupId: 'service-team', baseMode: 'group', excludedPersonalSupplementIds: [], supplementOverrides: [] }] };
  await h.reviewedPolicy(policy);
  const next = structuredClone((await h.plan()).body.studio);
  next.series.push({ id: 'pilot-series', person: personId, site: 0, startDate: from, endDate: to, weekdays: [1], start: '07:00', end: '15:00', plannedBreakMinutes: 30, note: 'Arbejdsbeskrivelse', noteRich: rich });
  assert.equal((await h.save(next)).status, 200);
  assert.deepEqual((await request(schedule)).body.shifts, [], 'Drafts stay private until publication.');
  const published = await h.save((await h.plan()).body.studio, { from, to, siteIds: [0], includeDependencies: true });
  assert.equal(published.status, 200, JSON.stringify(published));
  const shifts = (await request(schedule)).body.shifts; assert.equal(shifts.length, 2); assert.ok(shifts.every(shift => shift.personId === personId));
  const shift = shifts.find(shift => shift.date === day); assert.ok(shift);
  const inbox = await request({ action: 'employeeInbox', cursor: null, limit: 50 }); assert.equal(inbox.status, 200, JSON.stringify(inbox));
  assert.ok(inbox.body.notifications.some(message => message.after?.id === shift.id));
  const detail = await request({ action: 'publishedShift', shiftId: shift.id }); assert.equal(detail.status, 200);
  assert.equal(detail.body.shift.description, 'Lås døren efter arbejdet'); assert.equal(detail.body.shift.checklist.length, 1);
  const checked = await request({ action: 'employeeChecklist', shiftId: shift.id, taskId: detail.body.shift.checklist[0].id, checklistToken: detail.body.shift.checklistToken, checked: true });
  assert.equal(checked.status, 200, JSON.stringify(checked));
  const clock = (operation, version, extra = {}) => request({ action: 'shiftTime', operation, shiftId: shift.id, version, comment: null, location: null, ...extra });
  const started = await clock('start', 0); assert.equal(started.status, 200, JSON.stringify(started)); assert.equal(started.body.entry.clockIn, day + 'T06:00:00.000Z');
  assert.equal((await clock('start', 0)).status, 409, 'An uncertain retry cannot create duplicate attendance.');
  assert.equal((await clock('finish', 1, { start: '05:00' })).status, 400, 'Employee cannot change clock times.');
  t.mock.timers.setTime(Date.parse(day + 'T10:00:00Z'));
  assert.equal((await clock('pause', 1)).status, 200);
  t.mock.timers.setTime(Date.parse(day + 'T10:30:00Z'));
  assert.equal((await clock('resume', 2)).status, 200);
  t.mock.timers.setTime(Date.parse(day + 'T14:00:00Z'));
  const finished = await clock('finish', 3); assert.equal(finished.status, 200, JSON.stringify(finished)); assert.equal(finished.body.entry.status, 'submitted');
  const period = { from, to, personId }, times = await account('timeRead', period); assert.equal(times.status, 200, JSON.stringify(times));
  const entry = times.body.entries.find(entry => entry.shiftId === shift.id); assert.equal(entry.workedMinutes, 450); assert.equal(entry.breakMinutes, 30);
  assert.equal(Time.review(entry, { shift: times.body.shifts.find(row => row.id === shift.id), canViewPayroll: true, today: day }).bucket, 'ready');
  const approval = await account('timeWrite', { operation: 'approve', entryId: entry.id, version: entry.version, onlyIfMatchesPlan: true });
  assert.equal(approval.status, 200, JSON.stringify(approval)); const frozen = structuredClone(approval.body.entry.payroll);
  assert.equal(frozen.baseCents, 135000); assert.equal(frozen.supplementCents, 9000); assert.equal(frozen.totalCents, 144000);
  assert.equal((await account('timeWrite', { operation: 'approve', entryId: entry.id, version: entry.version, onlyIfMatchesPlan: true })).status, 409);
  const hours = await request({ action: 'employeeHours', from, to }); assert.equal(hours.status, 200, JSON.stringify(hours));
  assert.equal(hours.body.summary.approvedMinutes, 450); assert.equal(hours.body.summary.approvedCents, 144000);
  const changed = structuredClone(policy); changed.groups[0].revisions.push({ id: 'future-period', from: '2090-01-17', payroll: { ...pay(20000), agreements: [{ id: 'next-rate', from: '2090-01-17', type: 'hourly', amountCents: 20000 }] } });
  await h.reviewedPolicy(changed, 1, '2090-01-17');
  const latest = await account('timeRead', period); assert.deepEqual(latest.body.entries.find(row => row.id === entry.id).payroll, frozen);
  assert.equal((await request({ action: 'employeeHours', from, to })).body.summary.approvedCents, 144000);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_time_entries').get().n, 1);
  assert.equal(h.sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('late clocking needs review; rejection and employee explanation preserve clock evidence before planner approval', async t => {
  const h = await setup(t), { personId, account, request } = h;
  const next = structuredClone((await h.plan()).body.studio), shiftId = 'pilot-late';
  next.edits[shiftId] = { id: shiftId, person: personId, site: 0, date: day, start: '07:00', end: '15:00', plannedBreakMinutes: 0, note: '' };
  assert.equal((await h.save(next)).status, 200);
  assert.equal((await h.save((await h.plan()).body.studio, { from, to, siteIds: [0], includeDependencies: true })).status, 200);
  assert.equal((await account('payrollSave', { personId, version: 0, payroll: pay(19000) })).status, 200);
  const clock = (operation, version, extra = {}) => request({ action: 'shiftTime', shiftId, operation, version, comment: null, location: null, ...extra });
  t.mock.timers.setTime(Date.parse(day + 'T06:22:00Z')); assert.equal((await clock('start', 0)).status, 200);
  t.mock.timers.setTime(Date.parse(day + 'T14:00:00Z')); assert.equal((await clock('finish', 1, { comment: 'Jeg mødte kl. 07, men glemte at stemple ind.' })).status, 200);
  let times = await account('timeRead', { from, to, personId }), entry = times.body.entries[0];
  assert.equal(entry.start, '07:22'); assert.equal(Time.review(entry, { shift: next.edits[shiftId], canViewPayroll: true, today: day }).bucket, 'attention');
  assert.equal((await account('timeWrite', { operation: 'approve', entryId: entry.id, version: entry.version, onlyIfMatchesPlan: true })).status, 409);
  assert.equal((await account('timeWrite', { operation: 'reject', entryId: entry.id, version: entry.version, reason: '' })).status, 400);
  const rejected = await account('timeWrite', { operation: 'reject', entryId: entry.id, version: entry.version, reason: 'Bekræft ankomst med teamlederen.' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected));
  const detail = await request({ action: 'publishedShift', shiftId });
  assert.equal(detail.body.shift.entry.rejectionReason, 'Bekræft ankomst med teamlederen.');
  const resubmitted = await clock('submit', rejected.body.entry.version, { comment: 'Teamlederen bekræfter ankomst kl. 07.' });
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted)); assert.equal(resubmitted.body.entry.status, 'submitted');
  assert.equal(resubmitted.body.entry.clockIn, day + 'T06:22:00.000Z'); assert.equal(resubmitted.body.entry.clockOut, day + 'T14:00:00.000Z');
  const corrected = await account('timeWrite', { operation: 'correct', entryId: entry.id, version: resubmitted.body.entry.version, start: '07:00', end: '15:00', breakMinutes: 0, reason: 'Ankomst kl. 07 bekræftet af teamlederen.' });
  assert.equal(corrected.status, 200, JSON.stringify(corrected));
  const approved = await account('timeWrite', { operation: 'approve', entryId: entry.id, version: corrected.body.entry.version });
  assert.equal(approved.status, 200, JSON.stringify(approved)); assert.equal(approved.body.entry.payroll.totalCents, 161600);
  assert.equal(approved.body.entry.clockStartAt, day + 'T06:22:00.000Z', 'Original server clock remains audit evidence.');
  assert.equal((await clock('submit', approved.body.entry.version, { comment: 'Cannot reopen approved pay' })).status, 409);
  times = await account('timeRead', { from, to, personId }); assert.equal(times.body.entries[0].status, 'approved');
});

test('an open Sunday registration survives the week boundary and can be completed on Monday', async t => {
  const h = await setup(t), next = structuredClone((await h.plan()).body.studio), shiftId = 'pilot-sunday';
  next.edits[shiftId] = { id: shiftId, person: h.personId, site: 0, date: '2090-01-15', start: '22:00', end: '23:00', note: '' };
  assert.equal((await h.save(next)).status, 200);
  assert.equal((await h.save((await h.plan()).body.studio, { from, to, siteIds: [0], includeDependencies: true })).status, 200);
  const clock = (operation, version) => h.request({ action: 'shiftTime', shiftId, operation, version, comment: null, location: null });
  t.mock.timers.setTime(Date.parse('2090-01-15T21:00:00Z')); assert.equal((await clock('start', 0)).status, 200);
  t.mock.timers.setTime(Date.parse('2090-01-15T23:10:00Z'));
  const calendar = await h.request({ action: 'publishedSchedule', from: '2090-01-16', to: '2090-01-22', cursor: null }); assert.deepEqual(calendar.body.shifts, []);
  const active = await h.request({ action: 'employeeActiveTime' }); assert.equal(active.status, 200, JSON.stringify(active));
  assert.equal(active.body.shift.id, shiftId); assert.equal(active.body.shift.entry.status, 'running');
  assert.equal((await clock('finish', active.body.shift.entry.version)).status, 200);
  assert.equal((await h.request({ action: 'employeeActiveTime' })).body.shift, null);
  const entry = (await h.account('timeRead', { from, to, personId: h.personId })).body.entries[0];
  assert.equal(entry.status, 'submitted'); assert.equal(entry.endDate, '2090-01-16'); assert.equal(entry.workedMinutes, 130);
});
