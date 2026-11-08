const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const Auth = require('../lib/mobile-auth-store.mjs');
const { handleMobileAuthRequest } = require('../lib/mobile-auth-route.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const { handleAccountsRequest } = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const Publication = require('../src/publication-model.js');
const Time = require('../src/timekeeping-model.js');

const start = Date.parse('2026-11-05T10:00:00Z');
const personId = 'person-mobile-example';
const workspaceId = 'workspace-a';
const email = 'employee@example.test';
const actorGuard = { sql: '1 = 1', values: [] };

function setup(t, { seedDirectory = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = path.join(__dirname, '../drizzle');
  for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
  for (const id of [workspaceId, 'workspace-b']) {
    sqlite.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?)').run(id, `owner-${id}`, `owner-${id}`, new Date(start).toISOString());
    if (!seedDirectory) continue;
    sqlite.prepare(`INSERT INTO workspace_directory_records
      (workspace_id, kind, id, version, position, active, name_sort, catalog, config, byte_length, chunk_count, write_token, updated_at)
      VALUES (?, 'employee', ?, 1, 0, 1, ?, ?, '{}', 2, 0, 'token', ?)`)
      .run(id, personId, 'anna test', JSON.stringify({ id: personId, name: 'Anna Test' }), new Date(start).toISOString());
  }
  const db = {
    prepare: sql => ({ bind: (...values) => ({ sql, values }) }),
    async batch(statements) {
      await this.beforeBatch?.(statements);
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, values }) => {
          const prepared = sqlite.prepare(sql);
          return prepared.columns().length ? { results: prepared.all(...values) }
            : { meta: { changes: Number(prepared.run(...values).changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  t.after(() => sqlite.close());
  return { db, sqlite,
    issue: overrides => Auth.issueMobileCredential({ db, workspaceId, personId, email, actorGuard, expectedVersion: 0, now: start, ...overrides }),
    login: (password, overrides) => Auth.loginMobile({ db, email, password, now: start, ...overrides }),
    session: (token, overrides) => Auth.readMobileSession({ db, token, now: start, ...overrides }),
    list: (id = workspaceId) => Auth.listMobileCredentials({ db, workspaceId: id }),
  };
}

test('new mobile accounts read only their published schedule and use the current web GPS rule to clock in', async t => {
  const { db, sqlite, issue } = setup(t, { seedDirectory: false });
  const owner = 'owner-' + workspaceId, day = Time.localNow().date;
  const morning = Date.parse(day + 'T10:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: morning });
  const date = new Date(day + 'T12:00:00Z');
  const from = Time.addDays(day, -((date.getUTCDay() + 6) % 7)), to = Time.addDays(from, 6);
  const organization = Departments.defaultOrganization();
  organization.sites[0].gps = { enabled: true, latitude: 55.61, longitude: 12.1, radiusMeters: 100 };
  const peer = 'person-mobile-peer';
  const employee = (id, name) => ({ id, name, initials: name[0], target: 37, site: 0, role: 'Service', active: true });
  const shift = (id, person, site = 0, note = '') => ({ id, person, site, date: day, start: '07:00', end: '15:00', note });
  const my = shift('mobile-mine', personId, 0, 'Egen vagtbeskrivelse');
  const noGps = { ...shift('mobile-no-gps', personId, 1), start: '17:00', end: '21:00' };
  const foreign = shift('mobile-foreign', peer, 0, 'Privat for kollegaen');
  const draft = shift('mobile-draft', personId, 2);
  const studio = Publication.publish({
    storageVersion: 1, demoSeed: false, roster: [employee(personId, 'Anna Test'), employee(peer, 'Peer Test')], organization,
    series: [], edits: { [my.id]: my, [foreign.id]: foreign, [noGps.id]: noGps, [draft.id]: draft },
    deleted: [], weekPlans: {}, coverageRules: [], requests: {}, checklistProgress: {},
  }, { from, to, siteIds: [0, 1], actor: { userId: owner, name: 'Planlægger' }, at: new Date().toISOString() }).studio;
  assert.ok((await writeStudio(db, owner, 0, studio)).ok);
  const imported = await handleAccountsRequest(new Request('https://studio.example/api/accounts', {
    method: 'POST', headers: { origin: 'https://studio.example', 'content-type': 'application/json',
      'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': 'owner@example.test' },
    body: JSON.stringify({ action: 'timeRead', from, to }),
  }), db);
  assert.equal(imported.status, 200, await imported.text());
  const account = await issue({ now: Date.now() });
  const gatewayKey = 'a'.repeat(64);
  async function call(payload, token) {
    const response = await handleMobileAuthRequest(new Request('https://studio.example/api/mobile-auth', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-cleanrooms-gateway-key': gatewayKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    }), db, gatewayKey);
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  const access = await call({ action: 'login', email, password: account.temporaryPassword });
  assert.equal(access.status, 200, JSON.stringify(access.body));
  assert.equal(access.body.temporaryPassword, true, 'a new employee can open the app with their start password');
  const token = access.body.token;
  const page = { action: 'publishedSchedule', from, to, cursor: null };
  assert.equal((await call(page)).status, 401);
  assert.equal((await call({ ...page, personId: peer }, token)).status, 400);
  const own = await call(page, token);
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.cache, 'no-store, private');
  assert.deepEqual(own.body.shifts.map(shift => shift.id), [my.id, noGps.id]);
  assert.equal(own.body.shifts[0].description, undefined);
  assert.equal((await call({ ...page, from: Time.addDays(to, 1), to: Time.addDays(to, 7) }, token)).body.shifts.length, 0);
  const detail = await call({ action: 'publishedShift', shiftId: my.id }, token);
  assert.equal(detail.body.shift.description, my.note);
  assert.equal(detail.body.shift.clockInRadius, 100);
  assert.ok(!JSON.stringify(detail.body).includes('latitude'));
  assert.deepEqual((await call({ action: 'publishedShift', shiftId: foreign.id }, token)).body, { shift: null });
  assert.deepEqual((await call({ action: 'publishedShift', shiftId: draft.id }, token)).body, { shift: null });
  const clock = (patch = {}) => call({ action: 'shiftTime', shiftId: my.id, operation: 'start',
    version: 0, comment: null, location: null, ...patch }, token);
  assert.equal((await clock({ shiftId: foreign.id })).status, 403);
  assert.equal((await clock()).body.error, 'time_location_required');
  const fix = { latitude: 55.61, longitude: 12.1, accuracyMeters: 5, timestamp: Date.now() };
  assert.equal((await clock({ location: { ...fix, latitude: 55.615 } })).body.error, 'time_location_outside');
  const started = await clock({ location: fix });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.entry.status, 'running');
  assert.equal((await clock({ location: fix })).status, 409, 'a retry cannot create a duplicate');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_time_entries').get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_activity WHERE kind='time'").get().count, 1);
  assert.equal((await call({ action: 'publishedShift', shiftId: my.id }, token)).body.shift.entry.version, 1);
  t.mock.timers.setTime(morning + 10 * 60000);
  const finished = await clock({ operation: 'finish', version: 1, comment: 'Glemte at stemple ind.' });
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.entry.status, 'submitted');
  assert.equal((await call({ action: 'publishedShift', shiftId: noGps.id }, token)).body.shift.clockInRadius, null);
  const second = await clock({ shiftId: noGps.id });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.entry.status, 'running', 'GPS-off uses no phone location');
  await Auth.logoutMobile({ db, token });
  assert.equal((await call(page, token)).status, 401);
});

test('a start password is ten random characters, has one receipt and binds only to the selected workspace employee', async t => {
  const { db, sqlite, issue, login, list, session } = setup(t);
  await assert.rejects(issue({ actorGuard: { sql: '0 = 1', values: [] } }), { code: 'mobile_account_conflict' });
  const created = await issue({ email: ` ${email.toUpperCase()} ` });
  assert.equal(created.email, email);
  assert.match(created.temporaryPassword, /^[a-zA-Z0-9_-]{10}$/);
  assert.equal(created.version, 1);
  await assert.rejects(issue(), { code: 'mobile_account_conflict' });
  await assert.rejects(issue({ workspaceId: 'workspace-b' }), { code: 'mobile_account_conflict' });
  assert.deepEqual(await list(), [{ personId, email, temporary: true, version: 1, status: 'active' }]);
  assert.deepEqual(await list('workspace-b'), []);
  const access = await login(created.temporaryPassword);
  assert.deepEqual(access.employee, { workspaceId, personId, email, name: 'Anna Test' });
  assert.equal(access.temporaryPassword, true);
  assert.match(access.token, /^[a-zA-Z0-9_-]{43}$/);
  const signedIn = await session(access.token);
  assert.equal(signedIn.expiresAt, access.expiresAt);
  assert.equal(signedIn.temporaryPassword, true);
  assert.deepEqual(signedIn.employee, access.employee);
  const credentialRow = sqlite.prepare('SELECT * FROM workspace_mobile_credentials').get();
  assert.match(credentialRow.password_hash, /^[a-f0-9]{64}$/);
  assert.match(credentialRow.password_salt, /^[a-f0-9]{32}$/);
  assert.ok(!JSON.stringify(credentialRow).includes(created.temporaryPassword));
  const tokenRow = sqlite.prepare('SELECT * FROM workspace_mobile_sessions').get();
  assert.ok(!JSON.stringify(tokenRow).includes(access.token));
  await Auth.logoutMobile({ db, token: access.token });
  await assert.rejects(session(access.token), { status: 401, code: 'mobile_session_invalid' });
});

test('employee change rotates sessions, hides passwords from the admin list and supports an explicit administrator reset', async t => {
  const { db, issue, login, list, session } = setup(t);
  const created = await issue();
  const first = await login(created.temporaryPassword);
  const second = await login(created.temporaryPassword);
  const newPassword = 'Å🧪Kode82';
  const change = overrides => Auth.changeMobilePassword({ db, token: first.token, currentPassword: created.temporaryPassword,
    newPassword, now: start, ...overrides });
  await assert.rejects(change({ currentPassword: 'incorrect' }), { status: 400, code: 'mobile_current_password_invalid' });
  await assert.rejects(change({ newPassword: 'Å🧪Kode8' }), {
    status: 400, code: 'mobile_password_invalid', message: 'Vælg en adgangskode på 8 til 128 tegn.',
  });
  const changed = await change();
  assert.equal(changed.temporaryPassword, false);
  assert.notEqual(changed.token, first.token);
  await assert.rejects(session(first.token), { code: 'mobile_session_invalid' });
  await assert.rejects(session(second.token), { code: 'mobile_session_invalid' });
  assert.equal((await session(changed.token)).credentialVersion, 2);
  await assert.rejects(login(created.temporaryPassword), { code: 'mobile_credentials_invalid' });
  assert.equal((await login(newPassword)).temporaryPassword, false);
  assert.deepEqual(await list(), [{ personId, email, temporary: false, version: 2, status: 'active' }]);
  await assert.rejects(issue({ expectedVersion: 1 }), { code: 'mobile_account_conflict' });
  await assert.rejects(issue({ email: 'different@example.test', expectedVersion: 2 }), { code: 'mobile_email_unchangeable' });
  const reset = await issue({ expectedVersion: 2 });
  assert.notEqual(reset.temporaryPassword, created.temporaryPassword);
  await assert.rejects(session(changed.token), { code: 'mobile_session_invalid' });
  await assert.rejects(login(newPassword), { code: 'mobile_credentials_invalid' });
  assert.equal((await login(reset.temporaryPassword)).temporaryPassword, true);
});

test('revocation, expiry and an archived employee invalidate an otherwise valid mobile session', async t => {
  const { db, sqlite, issue, login, list, session } = setup(t);
  const created = await issue();
  const access = await login(created.temporaryPassword);
  await assert.rejects(session(access.token, { now: Date.parse(access.expiresAt) }), { code: 'mobile_session_invalid' });
  sqlite.prepare("UPDATE workspace_directory_records SET active = 0 WHERE workspace_id = ? AND kind = 'employee'").run(workspaceId);
  await assert.rejects(session(access.token), { code: 'mobile_session_invalid' });
  await assert.rejects(login(created.temporaryPassword), { code: 'mobile_credentials_invalid' });
  sqlite.prepare("UPDATE workspace_directory_records SET active = 1 WHERE workspace_id = ? AND kind = 'employee'").run(workspaceId);
  await assert.rejects(session(access.token), { code: 'mobile_session_invalid' });
  const restored = await login(created.temporaryPassword);
  await Auth.revokeMobileCredential({ db, workspaceId, personId, expectedVersion: 1, actorGuard, now: start });
  assert.deepEqual(await list(), [{ personId, email, temporary: false, version: 2, status: 'revoked' }]);
  await assert.rejects(session(restored.token), { code: 'mobile_session_invalid' });
  await assert.rejects(issue(), { code: 'mobile_account_conflict' });
  const reissued = await issue({ expectedVersion: 2 });
  assert.equal(reissued.version, 3);
  assert.equal((await login(reissued.temporaryPassword)).temporaryPassword, true);
});

test('login rejects unknown and wrong passwords identically and the account limit is atomic across concurrent guesses', async t => {
  const { sqlite, issue, login } = setup(t);
  const created = await issue();
  const wrong = await login('incorrect').catch(error => [error.status, error.code, error.message]);
  const unknown = await login('incorrect', { email: 'nobody@example.test' }).catch(error => [error.status, error.code, error.message]);
  assert.deepEqual(unknown, wrong);
  const guesses = await Promise.all(Array.from({ length: 8 }, () => login('incorrect').catch(error => error.status)));
  assert.equal(guesses.filter(status => status === 401).length, 7);
  assert.equal(guesses.filter(status => status === 429).length, 1);
  await assert.rejects(login(created.temporaryPassword), { status: 429, code: 'mobile_auth_rate_limited' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_mobile_sessions').get().count, 0);
  assert.equal((await login(created.temporaryPassword, { now: start + 15 * 60_000 })).temporaryPassword, true);
});
