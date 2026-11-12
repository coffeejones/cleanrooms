const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  attachDemoWebCredential, clearWebSessionCookie, hasWebSessionCookie, loginWeb,
  logoutWeb, readWebPrincipal, webSessionCookie,
} = require('../lib/web-auth-store.mjs');

const origin = 'https://cleanrooms.example.test';
const now = Date.parse('2026-11-12T10:00:00Z');
const stamp = new Date(now).toISOString();
const owner = { userId: 'fixture-site-owner', name: 'Test ejer', email: 'ejer@example.test' };
const demo = { email: 'demo@example.test', password: 'example-test-code' };

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = path.join(__dirname, '../drizzle');
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(path.join(directory, file), 'utf8'));
  }
  sqlite.prepare('INSERT INTO workspaces (id, owner_user_id, snapshot_owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run('demo-workspace', owner.userId, owner.userId, stamp);
  const addMember = sqlite.prepare(`INSERT INTO workspace_members
    (user_id, workspace_id, email, name, role, role_id, created_at, updated_at)
    VALUES (?, 'demo-workspace', ?, ?, 'admin', 'admin', ?, ?)`);
  addMember.run(owner.userId, owner.email, owner.name, stamp, stamp);
  addMember.run('other-admin', 'admin@example.test', 'Anden admin', stamp, stamp);

  return {
    sqlite,
    prepare: sql => ({ bind: (...values) => ({ sql, values }) }),
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, values }) => {
          const query = sqlite.prepare(sql);
          return query.columns().length
            ? { results: query.all(...values) }
            : { meta: { changes: Number(query.run(...values).changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('the existing test company can only be accessed with its owner-bound demo login', async t => {
  const db = database(t);
  const setup = { db, ...demo, now };
  const login = { db, ...demo, now, ip: '203.0.113.2' };
  await assert.rejects(
    attachDemoWebCredential({ ...setup, principal: { userId: 'other-admin' } }),
    { code: 'web_demo_owner_required' },
  );
  const principal = await attachDemoWebCredential({ ...setup, principal: owner });
  assert.equal(principal.workspaceId, 'demo-workspace');
  const retry = await attachDemoWebCredential({ ...setup, principal: owner });
  assert.deepEqual(retry, principal);
  await assert.rejects(
    attachDemoWebCredential({ ...setup, principal: owner, password: 'changed-code' }),
    { code: 'web_demo_credential_conflict' },
  );
  await assert.rejects(loginWeb(login), { code: 'web_credentials_invalid' });
  await assert.rejects(loginWeb({ ...login, siteUserId: 'other-admin' }), { code: 'web_credentials_invalid' });
  const session = await loginWeb({ ...login, siteUserId: owner.userId });
  assert.deepEqual(session.principal, principal);

  const authRequest = new Request(origin + '/login');
  const setCookie = webSessionCookie(session.token, authRequest);
  assert.match(setCookie, /^__Host-cleanrooms-web=/);
  assert.match(setCookie, /; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
  const cookie = setCookie.split(';', 1)[0];
  const pageRequest = value => new Request(origin + '/vagtplan', { headers: { Cookie: value } });
  const request = pageRequest(cookie);
  assert.equal(await readWebPrincipal({ db, request: authRequest, now }), null);
  assert.equal(hasWebSessionCookie(request), true);
  await assert.rejects(readWebPrincipal({ db, request, now }), { code: 'web_session_invalid' });
  const ownerSession = { db, request, now, siteUserId: owner.userId };
  assert.deepEqual(await readWebPrincipal(ownerSession), principal);
  await assert.rejects(readWebPrincipal({ ...ownerSession, now: Date.parse(session.expiresAt) }),
    { code: 'web_session_invalid' });

  const duplicate = pageRequest(cookie + '; ' + cookie);
  assert.equal(hasWebSessionCookie(duplicate), true);
  await assert.rejects(readWebPrincipal({ ...ownerSession, request: duplicate }), { code: 'web_session_invalid' });
  assert.equal(db.sqlite.prepare('SELECT token_hash FROM workspace_web_sessions').get().token_hash,
    createHash('sha256').update(session.token).digest('hex'));
  await logoutWeb({ db, request });
  assert.match(clearWebSessionCookie(authRequest), /; Max-Age=0; Secure$/);
  await assert.rejects(readWebPrincipal(ownerSession), { code: 'web_session_invalid' });
});

test('concurrent wrong passwords are capped per account and source', async t => {
  const db = database(t);
  await attachDemoWebCredential({ db, principal: owner, ...demo, now });
  const login = { db, ...demo, siteUserId: owner.userId, ip: '203.0.113.3', now };
  const failed = await Promise.allSettled(Array.from({ length: 10 }, () => loginWeb({
    ...login, password: 'bad-password',
  })));
  assert.equal(failed.filter(result => result.reason?.code === 'web_credentials_invalid').length, 8);
  assert.equal(failed.filter(result => result.reason?.code === 'web_auth_rate_limited').length, 2);
  await assert.rejects(loginWeb(login), { code: 'web_auth_rate_limited' });
  assert.equal((await loginWeb({ ...login, ip: '203.0.113.4' })).principal.userId, owner.userId);
  assert.equal((await loginWeb({ ...login, now: now + 15 * 60_000 })).principal.userId, owner.userId);
});
