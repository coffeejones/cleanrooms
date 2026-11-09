const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Auth = require('../lib/mobile-auth-store.mjs');
const { handleMobileAuthRequest } = require('../lib/mobile-auth-route.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const Workspace = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const Publication = require('../src/publication-model.js');

const key = 'a'.repeat(64), personId = 'person-route-own', peerId = 'person-route-peer';
const owner = 'mobile-route-owner';
async function setup(t, { day = '2090-01-10' } = {}) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  }
  t.after(() => sqlite.close());
  const db = { beforeBatch: null, prepare: sql => ({ bind: (...values) => ({ sql, values }) }) };
  db.batch = async statements => {
    await db.beforeBatch?.(statements); sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(({ sql, values }) => {
        const q = sqlite.prepare(sql);
        return q.columns().length ? { results: q.all(...values) } : { meta: { changes: Number(q.run(...values).changes) } };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  const noteRich = JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fyld sæbe op' }] }] },
  ] }] });
  const roster = [personId, peerId].map((id, i) => ({ id, name: i ? 'Peer Name' : 'Own Name', initials: 'ON', site: 0, target: 37, role: 'Service', active: true }));
  const shifts = [personId, peerId].map((person, i) => ({ id: i ? 'route-peer' : 'route-own', person, date: day, start: '08:00', end: '16:00', site: 0, noteRich }));
  const studio = Publication.publish({ storageVersion: 1, demoSeed: false, roster, organization: Departments.defaultOrganization(),
    series: [], edits: Object.fromEntries(shifts.map(shift => [shift.id, shift])), deleted: [], requests: {}, weekPlans: {}, checklistProgress: {}, coverageRules: [],
  }, { from: '2090-01-09', to: '2090-01-15', siteIds: [0], actor: { userId: owner, name: 'Owner' }, at: new Date().toISOString() }).studio;
  assert.equal((await writeStudio(db, owner, 0, studio)).ok, true);
  const web = async (action, payload) => {
    const response = await Workspace.handleAccountsRequest(new Request('https://studio.example/api/accounts', {
      method: 'POST', headers: { origin: 'https://studio.example', 'content-type': 'application/json',
        'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': 'owner@example.test' },
      body: JSON.stringify({ action, ...payload }),
    }), db);
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  await web('timeRead', { from: '2090-01-09', to: '2090-01-15' });
  const workspaceId = sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner).id;
  async function call(payload, token, customKey = key, raw) {
    const response = await handleMobileAuthRequest(new Request('https://studio.example/api/mobile-auth', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-cleanrooms-gateway-key': customKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: raw ?? JSON.stringify(payload),
    }), db, key);
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control'), retryAfter: response.headers.get('retry-after') };
  }
  const tokens = [];
  for (const [person, email] of [[personId, 'route-own@example.test'], [peerId, 'route-peer@example.test']]) {
    const credential = await Auth.issueMobileCredential({ db, workspaceId, personId: person, email,
      actorGuard: { sql: '1=1', values: [] }, expectedVersion: 0 });
    const response = await call({ action: 'login', email, password: credential.temporaryPassword });
    assert.equal(response.status, 200, JSON.stringify(response.body)); tokens.push(response.body.token);
  }
  return { db, sqlite, call, web, workspaceId, token: tokens[0], peerToken: tokens[1] };
}

test('mobile employee HTTP routes authenticate and keep settings, time and conversations on the same account', async t => {
  const { call, web, token, peerToken } = await setup(t);
  const hours = { action: 'employeeHours', from: '2090-01-09', to: '2090-01-15' };
  for (const payload of [hours, { action: 'employeePreferences' }, { action: 'chatList', cursor: null, limit: 50 }]) {
    assert.equal((await call(payload)).status, 401);
    assert.equal((await call(payload, token, 'b'.repeat(64))).status, 404);
    assert.equal((await call({ ...payload, personId: peerId }, token)).status, 400);
  }
  const ownHours = await call(hours, token);
  assert.equal(ownHours.status, 200, JSON.stringify(ownHours.body));
  assert.deepEqual(ownHours.body.rows.map(row => row.shift.personId), [personId]);
  assert.equal(ownHours.cache, 'no-store, private');
  const preferences = await call({ action: 'employeePreferences' }, token);
  assert.equal(preferences.status, 200);
  const changed = await call({ action: 'employeePreference', key: 'notifications', value: false, version: preferences.body.version }, token);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.notifications, false);
  assert.equal((await call({ action: 'employeePreferences' }, peerToken)).body.notifications, true);
  const room = (await web('chatCreate', { departmentId: 'dep-nord', name: 'Fælles samtale' })).room;
  const sent = await call({ action: 'chatSend', roomId: room.id, clientId: 'route-message', text: 'Besked fra appen' }, token);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.message.authorName, 'Own Name');
  assert.equal((await web('chatRead', { roomId: room.id })).messages[0].id, sent.body.message.id);
  assert.equal((await call({ action: 'chatCreate', departmentId: 'dep-klinik', name: 'Forbidden' }, token)).status, 400);
});

test('mobile request parsing rejects malformed bodies, null/array payloads and oversized Unicode messages', async t => {
  const { call, token } = await setup(t);
  for (const raw of ['null', '[]', '"session"', '1', '{', '{"action":"employeePreferences","workspaceId":"other"}']) {
    assert.equal((await call(null, token, key, raw)).status, 400, raw);
  }
  const huge = JSON.stringify({ action: 'chatSend', roomId: 'ignored', clientId: 'big', text: '😀'.repeat(18000) });
  assert.ok(Buffer.byteLength(huge) > 64 * 1024);
  assert.equal((await call(null, token, key, huge)).status, 413);
});

test('a checklist cannot commit against a reassigned published occurrence read at a later plan revision', async t => {
  const { call, token, db, sqlite, workspaceId } = await setup(t);
  const detail = await call({ action: 'publishedShift', shiftId: 'route-own' }, token);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  let reassigned = false;
  db.beforeBatch = statements => {
    if (!reassigned && statements.some(item => item.sql.includes('SELECT workspace.snapshot_owner_id,plan.revision'))) {
      reassigned = true;
      sqlite.prepare('UPDATE workspace_published_shifts SET person_id=?,version=version+1 WHERE workspace_id=? AND id=?').run(peerId, workspaceId, 'route-own');
      sqlite.prepare('UPDATE studio_states SET revision=revision+1,write_token=? WHERE owner_id=?').run('changed-during-checklist', owner);
    }
  };
  const changed = await call({ action: 'employeeChecklist', shiftId: 'route-own', taskId: detail.body.shift.checklist[0].id,
    checked: true, checklistToken: detail.body.shift.checklistToken }, token);
  assert.equal(reassigned, true);
  assert.ok([403, 409].includes(changed.status), JSON.stringify(changed.body));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_checklist_tasks WHERE person_id=?').get(personId).n, 0);
});

test('employee inbox includes newly received distant-shift events, paginates by event time and shares durable read receipts', async t => {
  const { call, token, peerToken, sqlite, workspaceId } = await setup(t);
  assert.equal((await call({ action: 'employeeInbox', cursor: null, limit: 100 }, token)).status, 200);
  sqlite.prepare('DELETE FROM workspace_shift_messages').run();
  const event = (id, person, date, createdAt, kind = 'new') => ({ id, personId: person, kind,
    before: kind === 'cancelled' ? { id: 'gone', person, date, site: 0, start: '08:00', end: '16:00' } : null,
    after: kind === 'cancelled' ? null : { id: 'future', person, date, site: 0, start: '08:00', end: '16:00', note:'PRIVATE_NOTIFICATION_INSTRUCTION',payroll:{amountCents:123456} },
    summary: 'Aktuel ændring', createdAt, readAt: null });
  const messages = [event('new-future', personId, '2090-05-10', '2089-12-01T12:00:03.000Z'),
    event('cancelled-past', personId, '2088-01-01', '2089-12-01T12:00:02.000Z', 'cancelled'),
    event('same-time-b', personId, '2090-01-10', '2089-12-01T12:00:01.000Z'),
    event('same-time-a', personId, '2090-01-10', '2089-12-01T12:00:01.000Z'),
    event('peer-only', peerId, '2090-05-10', '2089-12-01T12:00:04.000Z')];
  for (const message of messages) sqlite.prepare('INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config) VALUES (?,?,?,?,?,?)').run(workspaceId, message.id, message.personId, message.kind, message.createdAt, JSON.stringify(message));
  const revision = sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner).revision;
  const first = await call({ action: 'employeeInbox', cursor: null, limit: 2 }, token);
  assert.equal(first.status, 200, JSON.stringify(first.body));assert.equal(first.body.unreadCount, 4);
  assert.deepEqual(first.body.notifications.map(item => item.id), ['new-future', 'cancelled-past']);
  assert.equal(JSON.stringify(first.body).includes('PRIVATE_NOTIFICATION_INSTRUCTION'),false);assert.equal(JSON.stringify(first.body).includes('amountCents'),false);
  const marked = await call({ action: 'employeeInboxRead', messageId: 'new-future' }, token);
  assert.equal(marked.status, 200);assert.equal(marked.body.unreadCount, 3);
  assert.equal((await call({ action: 'employeeInboxRead', messageId: 'new-future' }, token)).body.readAt, marked.body.readAt);
  const second = await call({ action: 'employeeInbox', cursor: first.body.nextCursor, limit: 2 }, token);
  assert.equal(second.status, 200);assert.deepEqual(second.body.notifications.map(item => item.id), ['same-time-b', 'same-time-a']);
  assert.equal(second.body.nextCursor, null);
  assert.equal((await call({ action: 'employeeInbox', cursor: first.body.nextCursor, limit: 2 }, peerToken)).status, 400);
  assert.equal((await call({ action: 'employeeInboxRead', messageId: 'peer-only' }, token)).status, 404);
  assert.equal((await call({ action: 'employeeInboxRead', messageId: 'new-future' }, peerToken)).status, 404);
  assert.equal(sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner).revision, revision);
  assert.equal(sqlite.prepare('SELECT read_at FROM workspace_message_receipts WHERE workspace_id=? AND message_id=?').get(workspaceId, 'new-future').read_at, marked.body.readAt);
});

test('active attendance survives Sunday-to-Monday, cancellation and restart reads without exposing another employee record', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2090-01-15T21:00:00.000Z') });
  const { call, token, peerToken, sqlite, workspaceId } = await setup(t, { day: '2090-01-15' });
  const write = (operation, version, comment = null) => call({ action: 'shiftTime', shiftId: 'route-own', operation, version, comment, location: null }, token);
  const started = await write('start', 0);assert.equal(started.status, 200, JSON.stringify(started.body));
  t.mock.timers.tick(4 * 60 * 60 * 1000);
  const active = await call({ action: 'employeeActiveTime' }, token);
  assert.equal(active.status, 200, JSON.stringify(active.body));assert.equal(active.body.shift.date, '2090-01-15');
  assert.equal(active.body.shift.entry.status, 'running');assert.equal(active.body.shift.entry.workedSeconds, 4 * 3600);
  assert.equal((await call({ action: 'employeeActiveTime' }, peerToken)).body.shift, null);
  sqlite.prepare('UPDATE workspace_published_shifts SET deleted=1 WHERE workspace_id=? AND id=?').run(workspaceId, 'route-own');
  const recovered = await call({ action: 'publishedShift', shiftId: 'route-own' }, token);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));assert.equal(recovered.body.shift.entry.status, 'running');
  assert.equal(recovered.body.shift.description, '');assert.equal((await call({ action: 'publishedShift', shiftId: 'route-own' }, peerToken)).body.shift, null);
  const finished = await write('finish', started.body.entry.version, 'Afsluttet efter midnat.');
  assert.equal(finished.status, 200, JSON.stringify(finished.body));assert.equal(finished.body.entry.status, 'submitted');
  assert.equal((await call({ action: 'employeeActiveTime' }, token)).body.shift, null);
  assert.equal((await call({ action: 'publishedShift', shiftId: 'route-own' }, token)).body.shift.entry.status, 'submitted');
});

test('a returned attendance receipt exposes its reason and only allows a comment-based CAS resubmission', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2090-01-10T07:00:00.000Z') });
  const { call, token, web, sqlite } = await setup(t);
  const command = (operation, version, comment = null) => ({ action: 'shiftTime', shiftId: 'route-own', operation, version, comment, location: null });
  const started = await call(command('start', 0), token);assert.equal(started.status, 200, JSON.stringify(started.body));
  t.mock.timers.tick(8 * 60 * 60 * 1000);
  const finished = await call(command('finish', started.body.entry.version), token);assert.equal(finished.status, 200, JSON.stringify(finished.body));
  const before = JSON.parse(sqlite.prepare('SELECT config FROM workspace_time_entries WHERE shift_id=?').get('route-own').config);
  await web('timeWrite', { operation: 'reject', entryId: before.id, version: before.version, reason: 'Forklar din sene indstempling.' });
  const detail = await call({ action: 'publishedShift', shiftId: 'route-own' }, token);
  assert.equal(detail.body.shift.entry.status, 'rejected');assert.equal(detail.body.shift.entry.rejectionReason, 'Forklar din sene indstempling.');
  const hours = await call({ action: 'employeeHours', from: '2090-01-09', to: '2090-01-15' }, token);
  assert.equal(hours.body.rows[0].entry.rejectionReason, 'Forklar din sene indstempling.');
  assert.equal((await call({ ...command('submit', detail.body.shift.entry.version, 'Jeg var der til tiden.'), start: '06:00' }, token)).status, 400);
  const sent = await call(command('submit', detail.body.shift.entry.version, 'Jeg var der til tiden.'), token);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));assert.equal(sent.body.entry.status, 'submitted');
  assert.equal((await call(command('submit', detail.body.shift.entry.version, 'Jeg var der til tiden.'), token)).status, 409);
  const after = JSON.parse(sqlite.prepare('SELECT config FROM workspace_time_entries WHERE shift_id=?').get('route-own').config);
  for (const field of ['start', 'end', 'clockStartAt', 'clockEndAt', 'breakMinutes']) assert.equal(after[field], before[field], field);
  assert.equal(after.comment, 'Jeg var der til tiden.');
});

test('costly mobile requests have account and workspace quotas with Retry-After while clock recovery stays available', async t => {
  const { db, sqlite, workspaceId, call, token, peerToken } = await setup(t);
  const { enforceMobileRequestQuota } = require('../lib/mobile-request-quota.mjs');
  const session = await Auth.readMobileSession({ db, token });
  for (let i = 0; i < 30; i++) await enforceMobileRequestQuota(db, token, session, 'employeeHours');
  const limited = await call({ action: 'employeeHours', from: '2090-01-09', to: '2090-01-15' }, token);
  assert.equal(limited.status, 429, JSON.stringify(limited.body));assert.equal(limited.retryAfter, '60');
  for(let i=0;i<25;i++)await assert.rejects(enforceMobileRequestQuota(db,token,session,'employeeHours'),{status:429});
  const {createHash}=require('node:crypto'),hash=value=>createHash('sha256').update(value).digest('hex');
  const workspaceScope=hash(`mobile-action:v1:${workspaceId}:hours-read`);
  assert.equal(sqlite.prepare('SELECT attempts FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(workspaceScope).attempts,30,'Rejected personal requests cannot consume shared company quota');
  assert.equal((await call({ action: 'employeeHours', from: '2090-01-09', to: '2090-01-15' }, peerToken)).status, 200);
  assert.equal((await call({ action: 'employeeActiveTime' }, token)).status, 200);
  assert.equal((await call({ action: 'publishedShift', shiftId: 'route-own' }, token)).status, 200);
});

test('employee inbox and active attendance reject session revocation during their final read or receipt write', async t => {
  for (const action of ['employeeInbox', 'employeeInboxRead', 'employeeActiveTime']) {
    const { db, sqlite, token, call, workspaceId } = await setup(t);
    await call({ action: 'employeeInbox', cursor: null, limit: 10 }, token);
    const message={id:'race-inbox',personId,kind:'new',before:null,after:null,summary:'Personlig besked',createdAt:new Date().toISOString(),readAt:null};
    sqlite.prepare('INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config) VALUES (?,?,?,?,?,?)').run(workspaceId,message.id,personId,message.kind,message.createdAt,JSON.stringify(message));
    let revoked=false;
    db.beforeBatch=statements=>{
      const matches=action==='employeeInboxRead'?statements.some(item=>item.sql.includes('INSERT INTO workspace_message_receipts'))
        : action==='employeeInbox'?statements.some(item=>item.sql.includes('ORDER BY message.created_at DESC'))
          : statements.some(item=>item.sql.includes('SELECT id,shift_id,version,write_token FROM workspace_time_entries'));
      if(!revoked&&matches){revoked=true;sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=?,version=version+1 WHERE workspace_id=? AND person_id=?').run(Date.now(),workspaceId,personId);}
    };
    const payload=action==='employeeInbox'?{action,cursor:null,limit:10}:action==='employeeInboxRead'?{action,messageId:message.id}:{action};
    const denied=await call(payload,token);assert.ok(revoked,action);assert.equal(denied.status,401,JSON.stringify(denied.body));assert.equal(denied.body.notifications,undefined);assert.equal(denied.body.shift,undefined);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts WHERE workspace_id=? AND message_id=?').get(workspaceId,message.id).n,0);
    db.beforeBatch=null;
  }
});
