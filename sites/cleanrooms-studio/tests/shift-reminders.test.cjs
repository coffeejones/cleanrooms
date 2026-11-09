const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { handleMobileAuthRequest } = require('../lib/mobile-auth-route.mjs');
const { drainPushOutbox } = require('../lib/push-dispatch.mjs');
const { generateShiftReminders, readReminderStates } = require('../lib/shift-reminders.mjs');
const { readWorkflow } = require('../lib/engagement-store.mjs');
const source = fs.readFileSync(require.resolve('./mobile-route-employee.test.cjs'), 'utf8').split("test('mobile employee HTTP routes")[0].replaceAll('2090-01-', '2031-01-').replaceAll("'2031-01-09'", "'2031-01-06'").replaceAll("'2031-01-15'", "'2031-01-12'");
const { setup, key, personId, peerId } = Function('require', '__dirname', source + '\nreturn {setup,key,personId,peerId};')(require, __dirname);
const projectId = '99999999-9999-4999-8999-999999999999';
const installationId = '11111111-1111-4111-8111-111111111111';
const RealDate = Date;
async function fixture(t, { plannedBreakMinutes = 0 } = {}) {
  let now = RealDate.parse('2031-01-10T06:29:00Z');
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  t.after(() => { global.Date = RealDate; });
  const normalizedSource = source.replace('site: 0, noteRich }', 'site: 0, plannedBreakMinutes: fixtureBreakMinutes, noteRich }');
  assert.notEqual(normalizedSource, source);
  const create = Function('require', '__dirname', 'fixtureBreakMinutes', normalizedSource + '\nreturn setup;')(require, __dirname, plannedBreakMinutes);
  const f = await create(t);
  const call = async (payload, token = f.token) => {
    const response = await handleMobileAuthRequest(new Request('https://studio.test/api/mobile-auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cleanrooms-gateway-key': key, authorization: 'Bearer ' + token }, body: JSON.stringify(payload) }), f.db, key, { projectId });
    return { status: response.status, body: await response.json() };
  };
  const register = () => call({ action: 'employeePushRegister', installationId, expoPushToken: 'ExpoPushToken[synthetic-reminder-device-0123456789]', platform: 'ios', projectId });
  async function prefs(values) {
    let current = await call({ action: 'employeePreferences' });assert.equal(current.status, 200);
    for (const [key, value] of Object.entries(values)) {
      current = await call({ action: 'employeePreference', version: current.body.version, key, value });assert.equal(current.status, 200, JSON.stringify(current.body));
    }
    return current.body;
  }
  const sent = [];
  const provider = async (_url, options) => { const body = JSON.parse(options.body);sent.push(...body);return Response.json({ data: body.map((_, index) => ({ status: 'ok', id: 'reminder-ticket-' + index })) }); };
  const drain = () => drainPushOutbox({ db: f.db, projectId, requestProvider: provider, now });
  const set = value => { now = typeof value === 'string' ? RealDate.parse(value) : value; };
  const start = () => call({ action: 'shiftTime', shiftId: 'route-own', operation: 'start', version: 0, comment: null, location: null });
  return { ...f, call, register, prefs, sent, drain, set, start, now: () => now };
}

test('legacy preference defaults are opt-out and settings use exact CAS and allowed values', async t => {
  const f = await fixture(t);
  const defaults = await f.call({ action: 'employeePreferences' });
  assert.equal(defaults.body.shiftReminders, false);assert.equal(defaults.body.checkoutReminders, false);assert.equal(defaults.body.reminderLeadMinutes, 30);
  const next = await f.prefs({ shiftReminders: true, reminderLeadMinutes: 15, checkoutReminders: true });
  assert.equal(next.reminderLeadMinutes, 15);assert.equal(next.version, 3);
  for (const [key, value] of [['reminderLeadMinutes', 20], ['reminderLeadMinutes', true], ['shiftReminders', 1]]) {
    assert.equal((await f.call({ action: 'employeePreference', version: next.version, key, value })).status, 400);
  }
  assert.equal((await f.call({ action: 'employeePreference', version: 0, key: 'checkoutReminders', value: false })).status, 409);
  await f.register();f.set('2031-01-10T06:50:00Z');await f.drain();assert.equal(f.sent.length, 1);
});

test('server wake creates due shift reminder without writes, deduplicates and uses a private expiring push', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ notifications: false, chatNotifications: false, shiftReminders: true });
  await f.drain();assert.equal(f.sent.length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_shift_reminders WHERE kind='reminder'").get().n, 1);
  f.set('2031-01-10T06:30:00Z');await f.drain();assert.equal(f.sent.length, 1);
  const message = f.sent[0];assert.equal(message.title, 'Vagtpåmindelse');assert.equal(message.ttl, 1800);
  assert.doesNotMatch(JSON.stringify(message), /Own Name|08:00|16:00|route-own|person-route|Arbejdssted/);
  assert.match(message.data.eventId, /^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(message.data), ['v', 'eventId', 'installationId']);
  const inbox = await f.call({ action: 'employeeInbox', limit: 100, cursor: null });assert.equal(inbox.status, 200);
  const reminder = inbox.body.notifications.find(item => item.kind === 'reminder');assert.ok(reminder);
  assert.equal(reminder.after.id, 'route-own');
  const read = await f.call({ action: 'employeeInboxRead', messageId: reminder.id });assert.deepEqual(read.body.target, { kind: 'shift', shiftId: 'route-own' });
  assert.deepEqual((await f.call({ action: 'employeePushOpen', installationId, eventId: message.data.eventId })).body.target, { kind: 'shift', shiftId: 'route-own' });
  assert.equal((await f.call({ action: 'employeePushOpen', installationId, eventId: message.data.eventId }, f.peerToken)).status, 404);
  f.set('2031-01-10T06:35:00Z');await f.drain();assert.equal(f.sent.length, 1);
  const manager = await readWorkflow(f.db, f.workspaceId, { manager: true });assert.equal(manager.notifications.some(row => row.kind === 'reminder'), false);
});

test('reminders remain off by default and do not create jobs without an active authenticated installation', async t => {
  const f = await fixture(t);await f.register();f.set('2031-01-10T06:31:00Z');await f.drain();assert.equal(f.sent.length, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_reminders').get().n, 0);
  await f.prefs({ shiftReminders: true });
  await f.call({ action: 'employeePushUnregister', installationId });f.set('2031-01-10T06:33:00Z');await f.drain();assert.equal(f.sent.length, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_reminders').get().n, 0);
});

test('a start, cancellation, reassignment, timing change, approved absence or opt-out suppresses scheduled reminder', async t => {
  for (const scenario of ['start', 'deleted', 'reassigned', 'moved', 'absence', 'opt-out', 'revoked']) await t.test(scenario, async t => {
    const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });await f.drain();f.set('2031-01-10T06:31:00Z');
    if (scenario === 'start') assert.equal((await f.start()).status, 200);
    if (scenario === 'deleted') f.sqlite.prepare("UPDATE workspace_published_shifts SET deleted=1 WHERE id='route-own'").run();
    if (scenario === 'reassigned') f.sqlite.prepare("UPDATE workspace_published_shifts SET person_id=? WHERE id='route-own'").run(peerId);
    if (scenario === 'moved') f.sqlite.prepare("UPDATE workspace_published_shifts SET start_time='09:00',end_time='17:00' WHERE id='route-own'").run();
    if (scenario === 'absence') f.sqlite.prepare("INSERT INTO workspace_absences VALUES(?,?,?,?,?,'Ferie','approved',1,?,'qa',?)").run(f.workspaceId, 'approved-leave', personId, '2031-01-10', '2031-01-10', JSON.stringify({ days: ['2031-01-10'] }), new Date().toISOString());
    if (scenario === 'opt-out') await f.prefs({ shiftReminders: false });
    if (scenario === 'revoked') f.sqlite.prepare('UPDATE workspace_mobile_credentials SET version=version+1 WHERE workspace_id=? AND person_id=?').run(f.workspaceId, personId);
    await f.drain();assert.equal(f.sent.length, 0);
  });
});

test('checkout reminder requires an open clocked entry, includes paused work and never closes it', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ notifications: false, chatNotifications: false, checkoutReminders: true });
  f.set('2031-01-10T07:00:00Z');const started = await f.start();assert.equal(started.status, 200, JSON.stringify(started.body));
  f.set('2031-01-10T15:14:00Z');assert.equal((await f.call({ action: 'shiftTime', shiftId: 'route-own', operation: 'pause', version: started.body.entry.version, comment: null, location: null })).status, 200);await f.drain();assert.equal(f.sent.length, 0);
  f.set('2031-01-10T15:15:00Z');await f.drain();assert.equal(f.sent.length, 1);assert.equal(f.sent[0].title, 'Tidsregistrering');
  const entry = f.sqlite.prepare("SELECT * FROM workspace_time_entries WHERE shift_id='route-own'").get();assert.equal(entry.status, 'paused');
  assert.equal(JSON.parse(entry.config).end, null);
  f.set('2031-01-10T15:20:00Z');await f.drain();assert.equal(f.sent.length, 1);
});

test('finished, never-started, or too-old shifts never generate a checkout reminder', async t => {
  for (const scenario of ['not-started', 'finished', 'expired']) await t.test(scenario, async t => {
    const f = await fixture(t);await f.register();await f.prefs({ checkoutReminders: true });
    if (scenario !== 'not-started') { f.set('2031-01-10T07:00:00Z');assert.equal((await f.start()).status, 200); }
    if (scenario === 'finished') {
      f.set('2031-01-10T15:00:00Z');const entry = f.sqlite.prepare("SELECT version FROM workspace_time_entries WHERE shift_id='route-own'").get();
      assert.equal((await f.call({ action: 'shiftTime', shiftId: 'route-own', operation: 'finish', version: entry.version, comment: '', location: null })).status, 200);
    }
    f.set(scenario === 'expired' ? '2031-01-10T17:01:00Z' : '2031-01-10T15:16:00Z');await f.drain();assert.equal(f.sent.length, 0);
  });
});

test('a clock change between discovery and commit prevents a reminder message and outbox event', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });await f.drain();f.set('2031-01-10T06:31:00Z');
  let race = false;
  f.db.beforeBatch = async statements => {
    if (!race && statements.some(item => item.sql.includes('INSERT INTO workspace_shift_messages') && item.sql.includes('json_each(?) chosen'))) {
      race = true;f.db.beforeBatch = null;assert.equal((await f.start()).status, 200);
    }
  };
  await generateShiftReminders(f.db, projectId, f.now());assert.equal(race, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_shift_messages WHERE kind='reminder'").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_push_events WHERE source_id LIKE 'reminder-%'").get().n, 0);
});

test('preferences and attendance are rechecked immediately before provider handoff', async t => {
  for (const scenario of ['preference', 'clock']) await t.test(scenario, async t => {
    const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });f.set('2031-01-10T06:31:00Z');await generateShiftReminders(f.db, projectId, f.now());
    let race = false;
    f.db.beforeBatch = async statements => {
      if (!race && statements.some(item => item.sql.includes("SET status='sending'"))) {
        race = true;f.db.beforeBatch = null;
        if (scenario === 'preference') await f.prefs({ shiftReminders: false }); else assert.equal((await f.start()).status, 200);
      }
    };
    await f.drain();assert.equal(race, true);assert.equal(f.sent.length, 0);
    assert.equal(f.sqlite.prepare("SELECT status FROM workspace_push_deliveries").get().status, 'cancelled');
  });
});

test('reminder-only preferences permit the self-test while ordinary categories stay disabled', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ notifications: false, chatNotifications: false, checkoutReminders: true });
  assert.equal((await f.call({ action: 'employeePushTest', installationId })).status, 200);await f.drain();assert.equal(f.sent.length, 1);assert.equal(f.sent[0].title, 'CleanRooms');
});

test('Copenhagen summer time and DST ambiguity use actual instants instead of a fixed UTC offset', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });
  f.sqlite.prepare("UPDATE workspace_published_shifts SET work_date='2031-07-10' WHERE id='route-own'").run();
  f.sqlite.prepare('UPDATE workspace_mobile_sessions SET expires_at=?').run(RealDate.parse('2032-01-01T00:00:00Z'));
  f.set('2031-07-10T05:29:00Z');await f.drain();assert.equal(f.sent.length, 0);
  f.set('2031-07-10T05:30:00Z');await f.drain();assert.equal(f.sent.length, 1);
  const summerJob = f.sqlite.prepare("SELECT * FROM workspace_shift_reminders WHERE work_date='2031-07-10'").get();assert.equal(summerJob.due_at, RealDate.parse('2031-07-10T05:30:00Z'));
  f.sqlite.prepare("UPDATE workspace_published_shifts SET work_date='2031-10-26',start_time='02:30',end_time='04:00' WHERE id='route-own'").run();
  f.set('2031-10-26T00:00:00Z');await f.drain();assert.equal(f.sent.length, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM workspace_shift_reminders WHERE work_date='2031-10-26'").get().status, 'cancelled');
});

test('job discovery is indexed, skips descriptions and caps each batch at100 with set-based commits', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });
  const original = f.sqlite.prepare("SELECT * FROM workspace_published_shifts WHERE id='route-own'").get();
  const columns = Object.keys(original), insert = f.sqlite.prepare('INSERT INTO workspace_published_shifts(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')');
  for (let index = 0; index < 205; index++) insert.run(...columns.map(column => column === 'id' ? 'batch-' + String(index).padStart(3, '0') : original[column]));
  const queries = [];f.db.beforeBatch = statements => { queries.push(...statements);assert.ok(statements.length <= 4, 'at most4 statements per reminder generation transaction'); };
  await generateShiftReminders(f.db, projectId, f.now());assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_reminders').get().n, 100);
  await generateShiftReminders(f.db, projectId, f.now());assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_reminders').get().n, 200);
  await generateShiftReminders(f.db, projectId, f.now());assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_reminders').get().n, 206);
  const discovery = queries.find(item => item.sql.includes('INDEXED BY workspace_reminder_published_day'));assert.ok(discovery);assert.doesNotMatch(discovery.sql, /published\.config/);
  const explanation = f.sqlite.prepare('EXPLAIN QUERY PLAN ' + discovery.sql).all(...discovery.values).map(row => row.detail).join('\n');
  assert.match(explanation, /SEARCH published USING INDEX workspace_reminder_published_day/);
});


test('lead-time changes reschedule an unsent reminder and never repeat an already emitted occurrence', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });await f.drain();
  f.set('2031-01-10T06:31:00Z');await f.prefs({ reminderLeadMinutes: 15 });await f.drain();assert.equal(f.sent.length, 0);
  f.set('2031-01-10T06:45:00Z');await f.drain();assert.equal(f.sent.length, 1);
  f.set('2031-01-10T06:46:00Z');await f.prefs({ reminderLeadMinutes: 30 });await f.drain();assert.equal(f.sent.length, 1);
});

test('approved absence on other sparse dates does not suppress this working day', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });
  f.sqlite.prepare("INSERT INTO workspace_absences VALUES(?,?,?,?,?,'Ferie','approved',1,?,'qa',?)").run(f.workspaceId, 'sparse-leave', personId, '2031-01-09', '2031-01-11', JSON.stringify({ days: ['2031-01-09', '2031-01-11'] }), new Date().toISOString());
  f.set('2031-01-10T06:31:00Z');await f.drain();assert.equal(f.sent.length, 1);
});

test('reminder inbox destination is safe after assignment cancellation and cannot open a peer shift', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });f.set('2031-01-10T06:31:00Z');await f.drain();
  const event = f.sent[0].data, message = f.sqlite.prepare("SELECT id FROM workspace_shift_messages WHERE kind='reminder'").get();
  f.sqlite.prepare("UPDATE workspace_published_shifts SET person_id=? WHERE id='route-own'").run(peerId);
  assert.deepEqual((await f.call({ action: 'employeePushOpen', ...event })).status, 400);
  assert.deepEqual((await f.call({ action: 'employeePushOpen', eventId: event.eventId, installationId })).body.target, { kind: 'inbox' });
  assert.deepEqual((await f.call({ action: 'employeeInboxRead', messageId: message.id })).body.target, { kind: 'inbox' });
});


test('a shortly-after-midnight shift is reminded on the preceding Copenhagen date', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true, reminderLeadMinutes: 15 });
  f.sqlite.prepare("UPDATE workspace_published_shifts SET work_date='2031-01-11',start_time='00:05',end_time='01:00' WHERE id='route-own'").run();
  f.set('2031-01-10T22:49:00Z');await f.drain();assert.equal(f.sent.length, 0);
  f.set('2031-01-10T22:50:00Z');await f.drain();assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].ttl, 900);
});

test('malformed reminder preferences fail closed both in settings and provider eligibility', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });await f.drain();
  f.sqlite.prepare('UPDATE workspace_employee_preferences SET config=? WHERE workspace_id=? AND person_id=?').run(JSON.stringify({ notifications: false, chatNotifications: false, shiftReminders: true, checkoutReminders: null, reminderLeadMinutes: 30, unavailableDates: [] }), f.workspaceId, personId);
  assert.equal((await f.call({ action: 'employeePreferences' })).status, 503);
  f.set('2031-01-10T06:31:00Z');await f.drain();assert.equal(f.sent.length, 0);
});

test('legacy native request shapes remain readable and old preference writes preserve reminder settings', async t => {
  const f = await fixture(t);await f.register();let current = await f.prefs({ shiftReminders: true, checkoutReminders: true, reminderLeadMinutes: 15 });
  // Build3 changes only these original boolean settings and does not send a
  // complete preference document. New opt-ins must survive that old write.
  current = await f.call({ action: 'employeePreference', version: current.version, key: 'notifications', value: false });assert.equal(current.status, 200);
  assert.equal(current.body.shiftReminders, true);assert.equal(current.body.checkoutReminders, true);assert.equal(current.body.reminderLeadMinutes, 15);
  f.set('2031-01-10T06:46:00Z');await f.drain();
  const inbox = await f.call({ action: 'employeeInbox', limit: 50, cursor: null });assert.equal(inbox.status, 200);
  assert.ok(inbox.body.notifications.some(message => message.kind === 'reminder'));
  const workflow = await f.call({ action: 'workflowRead', from: '2031-01-06', to: '2031-01-12', limit: 50 });assert.equal(workflow.status, 200, JSON.stringify(workflow.body));
  assert.ok(workflow.body.notifications.some(message => message.kind === 'reminder'));
});


test('planner history uses a partial index excluding reminder volume in the actual read and unread-count queries', async t => {
  const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });f.set('2031-01-10T06:31:00Z');await f.drain();
  const original = f.sqlite.prepare("SELECT * FROM workspace_shift_messages WHERE kind='reminder'").get();
  const insert = f.sqlite.prepare('INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config) VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 500; i++) { const id = 'bulk-reminder-' + i;insert.run(original.workspace_id, id, original.person_id, original.kind, original.created_at, JSON.stringify({ ...JSON.parse(original.config), id })); }
  const queries = [];f.db.beforeBatch = statements => { queries.push(...statements); };
  const result = await readWorkflow(f.db, f.workspaceId, { manager: true });assert.equal(result.notifications.some(row => row.kind === 'reminder'), false);
  const selected = queries.filter(item => item.sql.includes('FROM workspace_shift_messages m INDEXED BY workspace_shift_messages_planner'));assert.equal(selected.length, 2);
  for (const query of selected) {
    const plan = f.sqlite.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.values).map(row => row.detail).join('\n');
    assert.match(plan, /SEARCH m USING INDEX workspace_shift_messages_planner/);
  }
});


test('reminder summaries preserve planned breaks from the actual normalized publication envelope', async t => {
  const f = await fixture(t, { plannedBreakMinutes: 30 });
  const envelope = JSON.parse(f.sqlite.prepare("SELECT time_config FROM workspace_published_shifts WHERE id='route-own'").get().time_config);
  assert.equal(envelope.value.plannedBreakMinutes, 30);assert.equal(Object.hasOwn(envelope, 'plannedBreakMinutes'), false);
  await f.register();await f.prefs({ shiftReminders: true });f.set('2031-01-10T06:31:00Z');await f.drain();
  const inbox = await f.call({ action: 'employeeInbox', cursor: null, limit: 50 });assert.equal(inbox.status, 200);
  const reminder = inbox.body.notifications.find(message => message.kind === 'reminder');assert.ok(reminder);assert.equal(reminder.after.plannedBreakMinutes, 30);
});


test('a never-emitted canceled or moved occurrence restored before expiry is reactivated once', async t => {
  for (const scenario of ['cancelled', 'moved']) await t.test(scenario, async t => {
    const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });await f.drain();
    const original = f.sqlite.prepare("SELECT id FROM workspace_shift_reminders WHERE shift_id='route-own'").get().id;
    if (scenario === 'cancelled') f.sqlite.prepare("UPDATE workspace_published_shifts SET deleted=1 WHERE id='route-own'").run();
    else f.sqlite.prepare("UPDATE workspace_published_shifts SET start_time='09:00',end_time='17:00' WHERE id='route-own'").run();
    f.set('2031-01-10T06:31:00Z');await f.drain();assert.equal(f.sent.length, 0);
    assert.equal(f.sqlite.prepare('SELECT status FROM workspace_shift_reminders WHERE id=?').get(original).status, 'cancelled');
    f.sqlite.prepare("UPDATE workspace_published_shifts SET deleted=0,start_time='08:00',end_time='16:00' WHERE id='route-own'").run();
    f.set('2031-01-10T06:35:00Z');await f.drain();assert.equal(f.sent.length, 1);
    assert.equal(f.sqlite.prepare('SELECT status FROM workspace_shift_reminders WHERE id=?').get(original).status, 'emitted');
    f.set('2031-01-10T06:36:00Z');await f.drain();assert.equal(f.sent.length, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_shift_messages WHERE kind='reminder'").get().n, 1);
  });
});

test('restoring a previously emitted or expired occurrence never resurrects a reminder', async t => {
  for (const scenario of ['emitted', 'expired']) await t.test(scenario, async t => {
    const f = await fixture(t);await f.register();await f.prefs({ shiftReminders: true });await f.drain();
    if (scenario === 'emitted') { f.set('2031-01-10T06:31:00Z');await f.drain();assert.equal(f.sent.length, 1); }
    f.sqlite.prepare("UPDATE workspace_published_shifts SET deleted=1 WHERE id='route-own'").run();
    f.set(scenario === 'expired' ? '2031-01-10T07:01:00Z' : '2031-01-10T06:32:00Z');await f.drain();
    f.sqlite.prepare("UPDATE workspace_published_shifts SET deleted=0 WHERE id='route-own'").run();
    f.set(scenario === 'expired' ? '2031-01-10T07:02:00Z' : '2031-01-10T06:33:00Z');await f.drain();
    assert.equal(f.sent.length, scenario === 'emitted' ? 1 : 0);
  });
});
