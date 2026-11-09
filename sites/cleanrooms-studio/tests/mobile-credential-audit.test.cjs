const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
const Store = require('../lib/studio-store.mjs'), Workspace = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const owner = 'credential-audit-owner', secret = 'a'.repeat(64);
async function setup(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close()); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', name), 'utf8'));
  const db = { beforeBatch: null, prepare: sql => ({ bind: (...values) => ({ sql, values }) }) };
  db.batch = async statements => {
    await db.beforeBatch?.(statements); sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ sql, values }) => {
        assert.ok(values.length <= 100);
        const query = sqlite.prepare(sql);
        return query.columns().length ? { results: query.all(...values) } : { meta: { changes: Number(query.run(...values).changes) } };
      }); sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  await Store.writeStudio(db, owner, 0, { storageVersion: 1, demoSeed: false, roster: [], organization: Departments.defaultOrganization(), series: [], edits: {}, deleted: [], requests: {}, weekPlans: {}, coverageRules: [], checklistProgress: {} });
  const headers = { origin: 'https://studio.test', 'content-type': 'application/json', 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': 'owner@example.test' };
  assert.equal((await Workspace.handleWorkspaceStudioRequest(new Request('https://studio.test/api/studio', { headers }), db)).status, 200);
  const account = async (action, payload = {}) => {
    const response = await Workspace.handleAccountsRequest(new Request('https://studio.test/api/accounts', { method: 'POST', headers, body: JSON.stringify({ action, ...payload }) }), db, secret);
    return { status: response.status, body: await response.json() };
  };
  const created = await account('createEmployeeUser', { name: 'Anna Test', email: 'anna@example.test', site: 0, roleId: 'employee' });
  assert.equal(created.status, 200, JSON.stringify(created));
  const personId = created.body.createdEmployee.id;
  const audit = () => sqlite.prepare("SELECT entry FROM workspace_activity WHERE kind='access' ORDER BY rowid").all().map(row => JSON.parse(row.entry));
  return { db, sqlite, personId, account, audit };
}

test('app credential creation, reveal, reset and revoke record server actor and versions without secrets', async t => {
  const { sqlite, account, personId, audit } = await setup(t);
  const first = await account('revealAppStartCode', { personId, version: 1 }); assert.equal(first.status, 200);
  const reset = await account('resetAppLogin', { personId, version: 1 }); assert.equal(reset.status, 200, JSON.stringify(reset));
  const second = await account('revealAppStartCode', { personId, version: 2 }); assert.equal(second.status, 200);
  assert.equal(second.body.temporaryPassword, reset.body.temporaryPassword);
  assert.equal((await account('revokeAppLogin', { personId, version: 2 })).status, 200);
  const entries = audit();
  assert.deepEqual(entries.map(entry => entry.summary), ['Medarbejderadgang oprettet', 'App-startkode vist', 'App-startkode nulstillet', 'App-startkode vist', 'App-adgang lukket']);
  assert.ok(entries.every(entry => entry.actor.userId === owner && entry.personIds.includes(personId)));
  assert.equal(entries.at(-1).changes[0].after.version, 3);
  assert.equal(entries.at(-1).changes[0].after.status, 'revoked');
  const raw = JSON.stringify(entries), credential = sqlite.prepare('SELECT * FROM workspace_mobile_credentials').get();
  for (const sensitive of [first.body.temporaryPassword, second.body.temporaryPassword, credential.write_token, secret]) assert.equal(raw.includes(sensitive), false);
  for (const key of ['password_hash', 'password_salt', 'start_code_ciphertext', 'temporaryPassword', 'token_hash']) assert.equal(raw.includes(key), false);
});

test('failed audit rolls back credential writes and prevents releasing a decrypted start code', async t => {
  for (const action of ['revealAppStartCode', 'resetAppLogin', 'revokeAppLogin']) await t.test(action, async t => {
    const { sqlite, account, personId, audit } = await setup(t), before = sqlite.prepare('SELECT * FROM workspace_mobile_credentials').get(), events = audit();
    sqlite.exec("CREATE TRIGGER fail_credential_audit BEFORE INSERT ON workspace_activity WHEN NEW.kind='access' BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
    const result = await account(action, { personId, version: 1 });
    assert.equal(result.status, 500); assert.equal(result.body.temporaryPassword, undefined);
    assert.deepEqual(sqlite.prepare('SELECT * FROM workspace_mobile_credentials').get(), before); assert.deepEqual(audit(), events);
  });
});

test('credential version or actor changes at commit cannot produce phantom access events', async t => {
  for (const action of ['revealAppStartCode', 'resetAppLogin', 'revokeAppLogin']) await t.test(action, async t => {
    const { db, sqlite, account, personId, audit } = await setup(t), before = audit();
    db.beforeBatch = statements => {
      if (!statements.some(statement => statement.sql.includes('INSERT INTO workspace_activity'))) return;
      db.beforeBatch = null;
      sqlite.prepare('UPDATE workspace_mobile_credentials SET version=version+1 WHERE person_id=?').run(personId);
    };
    const result = await account(action, { personId, version: 1 });
    assert.ok([403, 409].includes(result.status), JSON.stringify(result));
    assert.equal(result.body.temporaryPassword, undefined); assert.deepEqual(audit(), before);
  });
});
