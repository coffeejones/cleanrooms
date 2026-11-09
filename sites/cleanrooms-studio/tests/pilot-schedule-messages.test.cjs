/* Real web/mobile handlers on the same isolated migrated database. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Auth = require('../lib/mobile-auth-store.mjs');
const { handleMobileEmployeeWorkflow } = require('../lib/mobile-employee-workflow.mjs');
const { handleMobilePush } = require('../lib/mobile-push-store.mjs');
const { drainPushOutbox } = require('../lib/push-dispatch.mjs');

// Reuse the existing pilot's real account, command-write and login fixture.
const source = fs.readFileSync(path.join(__dirname, 'pilot-flow-e2e.test.cjs'), 'utf8').split("\ntest('new employee")[0];
const { setup, from, to, day } = Function('require', '__dirname', source + '\nreturn { setup, from, to, day };')(require, __dirname);
const pushSource = fs.readFileSync(path.join(__dirname, 'mobile-push.test.cjs'), 'utf8').split("\ntest('push HTTP registration")[0];
const push = Function('require', '__dirname', pushSource + '\nreturn { fixture, install, projectId, personId };')(require, __dirname);
const publish = { from, to, siteIds: [0, 1], includeDependencies: true };
const inputShift = (person, patch = {}) => ({ id: 'pilot-notifications', person, date: day, site: 0, start: '08:00', end: '16:00', note: 'Private instructions', ...patch });
const ownMessages = async h => (await h.request({ action: 'employeeInbox', cursor: null, limit: 50 })).body.notifications;
const read = (h, id) => h.request({ action: 'employeeInboxRead', messageId: id });
async function edit(h, shift, publication = publish) {
  const next = structuredClone((await h.plan()).body.studio);
  next.edits[shift.id] = shift;
  assert.equal((await h.save(next)).status, 200);
  if (publication) assert.equal((await h.save((await h.plan()).body.studio, publication)).status, 200);
}

test('publication changes reach the employee inbox and planner read status; cancelled and historical rows never authorize a removed shift', async t => {
  const h = await setup(t), shift = inputShift(h.personId);
  await edit(h, shift, null);
  assert.deepEqual(await ownMessages(h), [], 'unpublished draft changes stay private');
  assert.equal((await h.save((await h.plan()).body.studio, publish)).status, 200);
  let messages = await ownMessages(h), created = messages.find(item => item.kind === 'new');
  assert.ok(created); assert.equal(created.after.id, shift.id); assert.equal(created.before, null);
  assert.equal(Object.hasOwn(created.after, 'note'), false, 'inbox keeps long shift instructions lazy');
  const seen = await read(h, created.id); assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.target, { kind: 'shift', shiftId: shift.id }); assert.equal(seen.body.unreadCount, 0);
  const repeated = await read(h, created.id); assert.equal(repeated.body.readAt, seen.body.readAt);
  assert.deepEqual(repeated.body.target, seen.body.target);
  const planner = await h.account('workflowRead', { from, to, limit: 50 }); assert.equal(planner.status, 200);
  assert.equal(planner.body.deliveries.find(item => item.id === created.id).readAt, seen.body.readAt);

  await edit(h, { ...shift, start: '09:00' }, null);
  assert.equal((await h.request({ action: 'publishedShift', shiftId: shift.id })).body.shift.start, '08:00');
  assert.equal((await ownMessages(h)).length, 1, 'an edited draft does not announce an unpublished change');
  assert.equal((await h.save((await h.plan()).body.studio, publish)).status, 200);
  messages = await ownMessages(h); const changed = messages.find(item => item.kind === 'changed');
  assert.equal(changed.before.start, '08:00'); assert.equal(changed.after.start, '09:00');
  assert.deepEqual((await read(h, changed.id)).body.target, { kind: 'shift', shiftId: shift.id });

  await edit(h, { ...shift, start: '09:00', date: '2090-01-11', site: 1 });
  messages = await ownMessages(h); const moved = messages.find(item => item.kind === 'moved');
  assert.equal(moved.before.date, day); assert.equal(moved.after.date, '2090-01-11');
  assert.equal(moved.before.site, 0); assert.equal(moved.after.site, 1);
  assert.deepEqual((await read(h, moved.id)).body.target, { kind: 'shift', shiftId: shift.id });

  const cancelled = structuredClone((await h.plan()).body.studio); cancelled.deleted.push(shift.id);
  assert.equal((await h.save(cancelled)).status, 200);
  assert.equal((await h.save((await h.plan()).body.studio, publish)).status, 200);
  messages = await ownMessages(h); const notice = messages.find(item => item.kind === 'cancelled');
  assert.ok(notice.before); assert.equal(notice.after, null);
  assert.deepEqual((await read(h, notice.id)).body.target, { kind: 'inbox' });
  const historical = await read(h, created.id);
  assert.equal(historical.body.readAt, seen.body.readAt, 'a previously read row stays idempotent');
  assert.deepEqual(historical.body.target, { kind: 'inbox' }, 'old events cannot authorize their former assignment');
});

test('a transferred shift and foreign notification cannot be opened through a previous employee receipt', async t => {
  const h = await setup(t), shift = inputShift(h.personId);
  await edit(h, shift);
  const old = (await ownMessages(h)).find(item => item.kind === 'new');
  assert.deepEqual((await read(h, old.id)).body.target, { kind: 'shift', shiftId: shift.id });
  const colleague = await h.account('createEmployeeUser', { name: 'Kollega Pilot', email: 'colleague@example.test', site: 0, roleId: 'employee' });
  assert.equal(colleague.status, 200); const person = colleague.body.createdEmployee.id;
  await edit(h, { ...shift, person });
  assert.deepEqual((await read(h, old.id)).body.target, { kind: 'inbox' });
  const workspace = h.sqlite.prepare('SELECT workspace_id FROM workspace_shift_messages WHERE id=?').get(old.id).workspace_id;
  const foreign = h.sqlite.prepare('SELECT id FROM workspace_shift_messages WHERE workspace_id=? AND person_id=? ORDER BY created_at DESC LIMIT 1').get(workspace, person);
  assert.ok(foreign);
  const denied = await read(h, foreign.id); assert.equal(denied.status, 404);
  assert.equal(Object.hasOwn(denied.body, 'target'), false);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts WHERE message_id=?').get(foreign.id).n, 0);
});

test('far-future offers remain actionable through bounded default pages while explicit calendar ranges stay scoped', async t => {
  const h = await setup(t);
  const created = await h.account('createEmployeeUser', { name: 'Tilbyder Pilot', email: 'offerer@example.test', site: 0, roleId: 'employee' });
  assert.equal(created.status, 200); const offerer = created.body.createdEmployee.id;
  const start = await h.account('revealAppStartCode', { personId: offerer, version: 1 }); assert.equal(start.status, 200);
  const login = await Auth.loginMobile({ db: h.db, email: 'offerer@example.test', password: start.body.temporaryPassword });
  const session = await Auth.readMobileSession({ db: h.db, token: login.token });
  const peer = payload => handleMobileEmployeeWorkflow(h.db, login.token, session, payload);
  const shift = inputShift(offerer, { date: '2090-04-10' });
  await edit(h, shift, { from: '2090-04-10', to: '2090-04-16', siteIds: [0], includeDependencies: true });
  const available = await peer({ action: 'workflowRead', limit: 1 });
  assert.ok(available.ownShifts.length <= 1); const own = available.ownShifts.find(item => item.id === shift.id); assert.ok(own);
  const offered = await peer({ action: 'workflowRequest', kind: 'offer', shiftId: shift.id, fingerprint: own.fingerprint, toPersonId: h.personId, comment: 'Kan du tage denne vagt?' });
  const offeredRequest = offered.requests.find(item => item.shift.id === shift.id); assert.equal(offeredRequest.status, 'awaiting_colleague');
  const inbox = await h.request({ action: 'workflowRead', limit: 1 }); assert.equal(inbox.status, 200);
  assert.ok(inbox.body.requests.length <= 1);
  assert.ok(inbox.body.requests.some(item => item.id === offeredRequest.id), 'inbox offers must not disappear outside the next 56 days');
  const scoped = await h.request({ action: 'workflowRead', from, to, limit: 1 });
  assert.equal(scoped.status, 200); assert.deepEqual(scoped.body.requests, []); assert.deepEqual(scoped.body.ownShifts, []);
  const accepted = await h.request({ action: 'workflowRespond', requestId: offeredRequest.id, version: offeredRequest.version, decision: 'accept' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  const pending = accepted.body.requests.find(item => item.id === offeredRequest.id); assert.equal(pending.status, 'pending');
  const approved = await h.account('workflowDecide', { requestId: pending.id, version: pending.version, studioRevision: (await h.plan()).body.revision, decision: 'approve', reason: '' });
  assert.equal(approved.status, 200, JSON.stringify(approved));
  assert.equal((await h.request({ action: 'publishedShift', shiftId: shift.id })).body.shift.personId, h.personId);
  const notification = (await ownMessages(h)).find(item => item.kind === 'request'); assert.ok(notification);
  assert.deepEqual((await read(h, notification.id)).body.target, { kind: 'inbox' }, 'request replies open the actionable inbox');
});

test('real publication commits each push source; an explicit banner tap shares read status while provider tickets do not', async t => {
  const h = await setup(t), code = await h.account('revealAppStartCode', { personId: h.personId, version: 1 });
  const login = await Auth.loginMobile({ db: h.db, email: 'soren@example.test', password: code.body.temporaryPassword });
  const session = await Auth.readMobileSession({ db: h.db, token: login.token });
  const native = payload => handleMobilePush(h.db, login.token, session, payload, { projectId: push.projectId });
  await native({ action: 'employeePushRegister', installationId: push.install, expoPushToken: 'ExpoPushToken[synthetic-pilot-token-0123456789]', platform: 'ios', projectId: push.projectId });
  const sent = [];
  const provider = async (url, options) => {
    assert.ok(url.endsWith('/send')); const body = JSON.parse(options.body); sent.push(...body);
    return Response.json({ data: body.map((_, index) => ({ status: 'ok', id: 'publication-ticket-' + sent.length + '-' + index })) });
  };
  const shift = inputShift(h.personId);
  for (const change of ['new', 'changed', 'moved', 'cancelled']) {
    if (change === 'new') await edit(h, shift);
    if (change === 'changed') await edit(h, { ...shift, start: '09:00' });
    if (change === 'moved') await edit(h, { ...shift, start: '09:00', date: '2090-01-11', site: 1 });
    if (change === 'cancelled') {
      const next = structuredClone((await h.plan()).body.studio); next.deleted.push(shift.id);
      assert.equal((await h.save(next)).status, 200); assert.equal((await h.save((await h.plan()).body.studio, publish)).status, 200);
    }
    t.mock.timers.setTime(Date.now() + 2000);
    const before = sent.length, result = await drainPushOutbox({ db: h.db, projectId: push.projectId, requestProvider: provider });
    assert.equal(result.sent, 1); assert.equal(sent.length, before + 1);
    const payload = sent.at(-1), event = h.sqlite.prepare('SELECT * FROM workspace_push_events WHERE event_id=?').get(payload.data.eventId);
    const row = h.sqlite.prepare('SELECT kind FROM workspace_shift_messages WHERE id=?').get(event.source_id); assert.equal(row.kind, change);
    assert.deepEqual(Object.keys(payload.data).sort(), ['eventId', 'installationId', 'v']);
    assert.doesNotMatch(JSON.stringify(payload), /Private instructions|08:00|09:00|16:00|Søren/);
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts WHERE message_id=?').get(event.source_id).n, 0, 'provider acceptance is not an employee read receipt');
    const opened = await native({ action: 'employeePushOpen', installationId: push.install, eventId: event.event_id });
    assert.deepEqual(opened.target, change === 'cancelled' ? { kind: 'inbox' } : { kind: 'shift', shiftId: shift.id });
    const receipt = h.sqlite.prepare('SELECT read_at FROM workspace_message_receipts WHERE message_id=?').get(event.source_id); assert.ok(receipt);
    t.mock.timers.setTime(Date.now() + 1);
    await native({ action: 'employeePushOpen', installationId: push.install, eventId: event.event_id });
    assert.equal(h.sqlite.prepare('SELECT read_at FROM workspace_message_receipts WHERE message_id=?').get(event.source_id).read_at, receipt.read_at);
    const planner = await h.account('workflowRead', { from, to, limit: 50 });
    assert.equal(planner.body.deliveries.find(item => item.id === event.source_id).readAt, receipt.read_at);
  }
  assert.equal(h.sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('unscoped future shift choices and requests keep independent bounded continuation cursors', async t => {
  const h = await setup(t), next = structuredClone((await h.plan()).body.studio);
  for (const [id, date] of [['far-open-a', '2090-04-10'], ['far-open-b', '2090-04-11']]) next.edits[id] = inputShift('', { id, date });
  assert.equal((await h.save(next)).status, 200);
  assert.equal((await h.save((await h.plan()).body.studio, { from: '2090-04-10', to: '2090-04-16', siteIds: [0], includeDependencies: true })).status, 200);
  const first = await h.request({ action: 'workflowRead', limit: 1 }); assert.equal(first.status, 200);
  assert.equal(first.body.openShifts.length, 1); assert.ok(first.body.pagination.openShifts);
  const second = await h.request({ action: 'workflowRead', limit: 1, openCursor: first.body.pagination.openShifts });
  assert.equal(second.body.openShifts.length, 1); assert.equal(second.body.pagination.openShifts, null);
  const shifts = [...first.body.openShifts, ...second.body.openShifts];
  assert.equal(new Set(shifts.map(shift => shift.id)).size, 2);
  for (const shift of shifts) assert.equal((await h.request({ action: 'workflowRequest', kind: 'claim', shiftId: shift.id, fingerprint: shift.fingerprint, comment: '' })).status, 200);
  const one = await h.request({ action: 'workflowRead', limit: 1 }); assert.equal(one.body.requests.length, 1); assert.ok(one.body.pagination.requests);
  const two = await h.request({ action: 'workflowRead', limit: 1, requestCursor: one.body.pagination.requests });
  assert.equal(two.body.requests.length, 1); assert.equal(two.body.pagination.requests, null);
  assert.equal(new Set([...one.body.requests, ...two.body.requests].map(request => request.id)).size, 2);
  assert.ok([one, two].every(page => page.body.openShifts.length <= 1 && page.body.ownShifts.length <= 1 && page.body.colleagues.length <= 1));
});

test('a late credential revocation or device-generation change cannot write a banner read acknowledgement', async t => {
  for (const action of ['revoke', 'rotate']) await t.test(action, async sub => {
    const f = await push.fixture(sub); await f.register(); const event = f.message(); await f.drain();
    let raced = false;
    f.db.beforeBatch = statements => {
      if (!raced && statements.some(statement => statement.sql.startsWith('INSERT INTO workspace_message_receipts'))) {
        raced = true;
        if (action === 'revoke') f.sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=? WHERE workspace_id=? AND person_id=?').run(new Date().toISOString(), f.workspaceId, push.personId);
        else f.sqlite.prepare('UPDATE workspace_push_devices SET binding_id=?,version=version+1 WHERE installation_id=?').run(crypto.randomUUID(), push.install);
      }
    };
    const result = await f.call({ action: 'employeePushOpen', installationId: push.install, eventId: event.event_id });
    assert.ok([401, 404].includes(result.status), JSON.stringify(result)); assert.equal(raced, true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts WHERE message_id=?').get(event.source_id).n, 0);
  });
});

test('opening a chat or self-test push does not mark unrelated shift notifications or unseen chat messages read', async t => {
  const f = await push.fixture(t); await f.register();
  const room = (await f.web('chatCreate', { departmentId: 'dep-nord', name: 'Pilot chat' })).room;
  await f.call({ action: 'chatSend', roomId: room.id, clientId: 'pilot-peer-push', text: 'A message to open' }, f.peerToken);
  await f.drain({ now: Date.now() + 2000 });
  const event = f.sqlite.prepare("SELECT event_id FROM workspace_push_events WHERE source_kind='chat'").get(); assert.ok(event);
  const opened = await f.call({ action: 'employeePushOpen', installationId: push.install, eventId: event.event_id });
  assert.equal(opened.status, 200); assert.deepEqual(opened.body.target, { kind: 'chat', roomId: room.id });
  assert.equal(f.sqlite.prepare('SELECT last_read_seq FROM workspace_chat_readers WHERE room_id=?').get(room.id)?.last_read_seq ?? 0, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts').get().n, 0);
  await f.call({ action: 'employeePushTest', installationId: push.install }); await f.drain({ now: Date.now() + 4000 });
  const self = f.sqlite.prepare("SELECT event_id FROM workspace_push_events WHERE source_kind='test'").get(); assert.ok(self);
  assert.equal((await f.call({ action: 'employeePushOpen', installationId: push.install, eventId: self.event_id })).status, 200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts').get().n, 0);
});
