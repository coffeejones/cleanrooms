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
async function setup(t) {
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
  const shifts = [personId, peerId].map((person, i) => ({ id: i ? 'route-peer' : 'route-own', person, date: '2090-01-10', start: '08:00', end: '16:00', site: 0, noteRich }));
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
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
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
