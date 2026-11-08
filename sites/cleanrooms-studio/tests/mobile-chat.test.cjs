const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Auth = require('../lib/mobile-auth-store.mjs');
const { handleMobileChat } = require('../lib/mobile-chat.mjs');
const { handleMobileEmployeeWorkflow } = require('../lib/mobile-employee-workflow.mjs');
const { writeStudio, readStudio } = require('../lib/studio-store.mjs');
const { handleAccountsRequest } = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const Publication = require('../src/publication-model.js');
const Workflow = require('../src/shift-workflow-model.js');

const owner = { id: 'mobile-chat-owner', email: 'owner@example.test' };
const linked = { id: 'mobile-chat-web-worker', email: 'one@example.test' };
const day = '2090-01-10';

async function setup(t, { webMember = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  }
  t.after(() => sqlite.close());
  const db = { sqlite, beforeBatch: null, queries: [], prepare: sql => ({ bind: (...values) => ({ sql, values }) }) };
  db.batch = async statements => {
    await db.beforeBatch?.(statements);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(({ sql, values }) => {
        assert.ok(values.length <= 100, 'D1 parameter budget');
        db.queries.push(sql);
        const prepared = sqlite.prepare(sql);
        return prepared.columns().length ? { results: prepared.all(...values) }
          : { meta: { changes: Number(prepared.run(...values).changes) } };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  const web = async (action, payload = {}, actor = owner) => {
    const response = await handleAccountsRequest(new Request('https://studio.example/api/accounts', {
      method: 'POST', headers: { origin: 'https://studio.example', 'content-type': 'application/json',
        'oai-authenticated-user-id': actor.id, 'oai-authenticated-user-email': actor.email },
      body: JSON.stringify({ action, ...payload }),
    }), db);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  const staff = (id, name, site) => ({ id, name, initials: name[0], target: 37, site, role: 'Service', active: true });
  const mine = { id: 'mobile-own', person: 'person-mobile-one', date: day, site: 0, start: '08:00', end: '16:00', note: 'Own instructions' };
  const open = { ...mine, id: 'mobile-open', person: '', date: '2090-01-11' };
  const initial = { storageVersion: 1, demoSeed: false,
    roster: [staff('person-mobile-one', 'Anna', 0), staff('person-mobile-two', 'Bo', 1)],
    organization: Departments.defaultOrganization(), series: [], edits: { [mine.id]: mine, [open.id]: open },
    deleted: [], requests: {}, weekPlans: {}, coverageRules: [], checklistProgress: {},
  };
  const studio = Publication.publish(initial, { from: '2090-01-09', to: '2090-01-15', siteIds: [0, 1, 2], actor: { userId: owner.id, name: 'Planner' }, at: new Date().toISOString() }).studio;
  assert.equal((await writeStudio(db, owner.id, 0, studio)).ok, true);
  await web('timeRead', { from: '2090-01-09', to: '2090-01-15' });
  const workspaceId = sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner.id).id;
  const north = (await web('chatCreate', { departmentId: 'dep-nord', name: 'Kontor Nord' })).room;
  const clinic = (await web('chatCreate', { departmentId: 'dep-klinik', name: 'Klinik' })).room;
  if (webMember) {
    const at = new Date().toISOString();
    sqlite.prepare(`INSERT INTO workspace_members(user_id,workspace_id,email,name,role,manage_departments,person_id,status,version,preferences,created_at,updated_at,role_id)
      VALUES(?,?,?,'Anna','employee',0,?,'active',1,'{}',?,?,'employee')`)
      .run(linked.id, workspaceId, linked.email, 'person-mobile-one', at, at);
  }
  const credential = await Auth.issueMobileCredential({ db, workspaceId, personId: 'person-mobile-one', email: linked.email,
    expectedVersion: 0, actorGuard: { sql: '1=1', values: [] } });
  const login = await Auth.loginMobile({ db, email: linked.email, password: credential.temporaryPassword });
  const session = await Auth.readMobileSession({ db, token: login.token });
  return { db, sqlite, web, workspaceId, north, clinic, mine, open, token: login.token, session,
    chat: payload => handleMobileChat(db, login.token, session, payload),
    workflow: payload => handleMobileEmployeeWorkflow(db, login.token, session, payload),
  };
}

test('native chat shares web rooms, authors, unread state and idempotent messages while staying employee scoped', async t => {
  const { chat, web, north, clinic, sqlite } = await setup(t);
  const list = await chat({ action: 'chatList', cursor: null, limit: 100 });
  assert.equal(list.viewer.userId, linked.id);
  assert.deepEqual(list.rooms.map(room => room.id), [north.id]);
  assert.ok(!Object.hasOwn(list, 'canManage') && !Object.hasOwn(list, 'departments'));
  await assert.rejects(chat({ action: 'chatRead', roomId: clinic.id, before: null, limit: 50 }), { code: 'chat_room_forbidden' });
  await assert.rejects(chat({ action: 'chatList', personId: 'person-mobile-two' }), { code: 'mobile_chat_action_invalid' });
  const payload = { action: 'chatSend', roomId: north.id, clientId: 'native-1', text: 'Native and web share this conversation.' };
  const sent = await chat(payload);
  assert.equal(sent.message.authorId, linked.id);
  assert.equal((await chat(payload)).message.id, sent.message.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n, 1);
  const read = await web('chatRead', { roomId: north.id }, linked);
  assert.equal(read.messages[0].id, sent.message.id);
  await web('chatSend', { roomId: north.id, clientId: 'web-reply', text: 'Reply from planner' });
  assert.equal((await chat({ action: 'chatRead', roomId: north.id, before: null, limit: 50 })).room.unread, 1);
  await chat({ action: 'chatReadMark', roomId: north.id, throughSeq: 2 });
  assert.equal((await web('chatRead', { roomId: north.id }, linked)).room.unread, 0);
  await chat({ action: 'chatMute', roomId: north.id, muted: true });
  assert.equal((await web('chatList', {}, linked)).rooms[0].muted, true);
});

test('mobile-only credentials can chat without a browser membership and cannot gain management rights', async t => {
  const { chat, sqlite, north } = await setup(t, { webMember: false });
  const list = await chat({ action: 'chatList', cursor: null, limit: 100 });
  assert.equal(list.viewer.userId, 'mobile-employee:person-mobile-one');
  await chat({ action: 'chatSend', roomId: north.id, clientId: 'mobile-only', text: 'Hello' });
  assert.equal(sqlite.prepare('SELECT author_name FROM workspace_chat_messages').get().author_name, 'Anna');
  await assert.rejects(chat({ action: 'chatCreate', departmentId: 'dep-havn', name: 'Forbidden' }), { code: 'mobile_chat_action_invalid' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_members WHERE person_id=?').get('person-mobile-one').n, 0);
});

test('chat pagination and delta sync retain bounded, account-bound web cursor semantics', async t => {
  const { chat, web, north, clinic } = await setup(t);
  for (let index = 0; index < 8; index++) await web('chatSend', { roomId: north.id, clientId: 'page-' + index, text: 'Message ' + index });
  const last = await chat({ action: 'chatRead', roomId: north.id, before: null, limit: 3 });
  const previous = await chat({ action: 'chatRead', roomId: north.id, before: last.nextCursor, limit: 5 });
  assert.deepEqual([...previous.messages, ...last.messages].map(message => message.seq), [1,2,3,4,5,6,7,8]);
  await assert.rejects(chat({ action: 'chatRead', roomId: clinic.id, before: last.nextCursor, limit: 3 }), { code: 'chat_room_forbidden' });
  const delta = await chat({ action: 'chatSync', roomId: north.id, afterSeq: 2, version: 1, limit: 3 });
  assert.deepEqual(delta.messages.map(message => message.seq), [3,4,5]);
  assert.equal(delta.hasMoreNew, true);
  const unchanged = await chat({ action: 'chatSync', roomId: north.id, afterSeq: 8, version: 1, limit: 50 });
  assert.equal(unchanged.unchanged, true);
  assert.equal(Object.hasOwn(unchanged, 'messages'), false);
});

test('session revocation and a late worksite change prevent native chat writes', async t => {
  const { db, chat, north, sqlite, workspaceId } = await setup(t);
  let raced = false;
  db.beforeBatch = statements => {
    if (!raced && statements.some(item => item.sql.startsWith('UPDATE workspace_chat_rooms SET latest_seq'))) {
      raced = true;
      sqlite.prepare("UPDATE workspace_directory_records SET site_index=1 WHERE workspace_id=? AND kind='employee' AND id='person-mobile-one'").run(workspaceId);
    }
  };
  await assert.rejects(chat({ action: 'chatSend', roomId: north.id, clientId: 'revoked-site', text: 'Must not save' }), { code: 'chat_access_changed' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n, 0);
  db.beforeBatch = null;
  sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=? WHERE workspace_id=?').run(new Date().toISOString(), workspaceId);
  await assert.rejects(chat({ action: 'chatList', cursor: null, limit: 100 }), { code: 'mobile_session_invalid' });
});

test('a revoked legacy web membership does not revoke a separately authorized mobile employee session', async t => {
  const { chat, sqlite, north } = await setup(t);
  sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(linked.id);
  assert.equal((await chat({ action: 'chatList', cursor: null, limit: 100 })).viewer.userId, linked.id);
  assert.equal((await chat({ action: 'chatSend', roomId: north.id, clientId: 'native-still-active', text: 'Mobile permission remains active' })).message.authorId, linked.id);
});

test('mobile-only claims remain pending until the planner approves the same durable request', async t => {
  const { workflow, web, open, db, sqlite } = await setup(t, { webMember: false });
  const period = { from: '2090-01-09', to: '2090-01-15' };
  const before = await workflow({ action: 'workflowRead', ...period, limit: 50 });
  const choice = before.openShifts.find(shift => shift.id === open.id);
  assert.ok(choice);
  const requested = await workflow({ action: 'workflowRequest', ...period, kind: 'claim', shiftId: choice.id, fingerprint: choice.fingerprint, comment: 'Jeg kan tage vagten.' });
  const request = requested.requests.find(item => item.shift.id === open.id);
  assert.equal(request.status, 'pending');
  const saved = await readStudio(db, owner.id);
  const approved = await web('workflowDecide', { requestId: request.id, version: request.version, studioRevision: saved.revision, decision: 'approve', reason: '' });
  assert.equal(approved.requests.find(item => item.id === request.id).status, 'approved');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_members WHERE person_id=?').get('person-mobile-one').n, 0);
  const after = await workflow({ action: 'workflowRead', ...period, limit: 50 });
  assert.ok(after.ownShifts.some(shift => shift.id === open.id));
});

test('native notifications mark the shared receipt and a shift free-day request remains pending on web', async t => {
  const { workflow, web, mine, sqlite, workspaceId } = await setup(t, { webMember: false });
  const message = Workflow.publicationMessages(undefined, [], [mine], { at: new Date().toISOString(), sites: Departments.defaultOrganization().sites }).notifications[0];
  sqlite.prepare('INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config) VALUES(?,?,?,?,?,?)')
    .run(workspaceId, message.id, message.personId, message.kind, message.createdAt, JSON.stringify(message));
  const period = { from: '2090-01-09', to: '2090-01-15' };
  const before = await workflow({ action: 'workflowRead', ...period, limit: 50 });
  assert.ok(before.notifications.length);
  await workflow({ action: 'workflowReadMessage', ...period, messageId: before.notifications[0].id });
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts WHERE message_id=?').get(before.notifications[0].id).n, 1);
  const leave = await workflow({ action: 'shiftLeave', shiftId: mine.id, comment: 'Ønsker fri hele dagen.' });
  assert.equal(leave.request.status, 'pending');
  assert.equal(leave.request.p, 'person-mobile-one');
  assert.deepEqual(leave.request.days, [mine.date]);
  assert.ok((await web('leaveRead', period)).requests.some(entry => entry.id === leave.request.id));
  await assert.rejects(workflow({ action: 'shiftLeave', shiftId: 'missing', comment: '' }), { code: 'employee_shift_changed' });
});

test('late native credential revocation denies chat sends and final read responses', async t => {
  for (const mutation of [true, false]) {
    const { db, chat, sqlite, north, workspaceId, web } = await setup(t, { webMember: false });
    await web('chatSend', { roomId: north.id, clientId: 'private', text: 'Private message' });
    let revoked = false;
    db.beforeBatch = statements => {
      const match = mutation ? statements.some(item => item.sql.startsWith('UPDATE workspace_chat_rooms SET latest_seq'))
        : statements.some(item => item.sql.includes('SELECT room.*,json_extract'));
      if (!revoked && match) {
        revoked = true;
        sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=? WHERE workspace_id=?').run(new Date().toISOString(), workspaceId);
      }
    };
    await assert.rejects(chat(mutation ? { action: 'chatSend', roomId: north.id, clientId: 'late-revoked', text: 'Must not save' }
      : { action: 'chatList', cursor: null, limit: 100 }), { code: 'mobile_session_invalid' });
    assert.equal(revoked, true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n, 1);
  }
});

test('mobile-only planner approval is atomically denied when the employee credential changes during commit', async t => {
  const { workflow, web, open, db, sqlite, workspaceId } = await setup(t, { webMember: false });
  const period = { from: '2090-01-09', to: '2090-01-15' };
  const view = await workflow({ action: 'workflowRead', ...period, limit: 50 });
  const choice = view.openShifts.find(shift => shift.id === open.id);
  const requested = await workflow({ action: 'workflowRequest', ...period, kind: 'claim', shiftId: choice.id, fingerprint: choice.fingerprint, comment: '' });
  const request = requested.requests.find(item => item.shift.id === open.id);
  const saved = await readStudio(db, owner.id);
  let revoked = false;
  db.beforeBatch = statements => {
    if (!revoked && statements.some(item => item.sql.startsWith('UPDATE studio_states'))) {
      revoked = true;
      sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=? WHERE workspace_id=?').run(new Date().toISOString(), workspaceId);
    }
  };
  const response = await handleAccountsRequest(new Request('https://studio.example/api/accounts', {
    method: 'POST', headers: { origin: 'https://studio.example', 'content-type': 'application/json',
      'oai-authenticated-user-id': owner.id, 'oai-authenticated-user-email': owner.email },
    body: JSON.stringify({ action: 'workflowDecide', requestId: request.id, version: request.version, studioRevision: saved.revision, decision: 'approve', reason: '' }),
  }), db);
  assert.equal(revoked, true);
  assert.equal(response.status, 409, JSON.stringify(await response.json()));
  assert.equal(sqlite.prepare('SELECT status FROM workspace_shift_requests WHERE id=?').get(request.id).status, 'pending');
});

test('native availability saved by the logged-in employee blocks their claim and appears in the planner scoped read', async t => {
  const { db, token, session, workflow, web, open } = await setup(t, { webMember: false });
  const { handleMobileEmployeeState } = require('../lib/mobile-employee-state.mjs');
  const mark = await handleMobileEmployeeState(db, token, session, {
    action: 'employeeAvailability', version: 0, date: open.date, unavailable: true,
  });
  assert.deepEqual(mark.unavailableDates, [open.date]);
  const read = await web('planningAvailability', { from: open.date, to: open.date, personIds: [session.employee.personId] });
  assert.deepEqual(read.people, [{ personId: session.employee.personId, version: 1, unavailableDates: [open.date] }]);
  const period = { from: open.date, to: open.date };
  const available = (await workflow({ action: 'workflowRead', ...period })).openShifts.find(shift => shift.id === open.id);
  await assert.rejects(workflow({ action: 'workflowRequest', kind: 'claim', shiftId: open.id, fingerprint: available.fingerprint, ...period }), { code: 'workflow_unavailable' });
  await handleMobileEmployeeState(db, token, session, { action: 'employeeAvailability', version: 1, date: open.date, unavailable: false });
  const requested = await workflow({ action: 'workflowRequest', kind: 'claim', shiftId: open.id, fingerprint: available.fingerprint, ...period });
  assert.equal(requested.requests[0].status, 'pending');
});
