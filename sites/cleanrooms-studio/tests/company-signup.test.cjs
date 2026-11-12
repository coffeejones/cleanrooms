const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { registerCompany } = require('../lib/company-signup-store.mjs');
const { handleWorkspaceStudioRequest, resolveWorkspace } = require('../lib/workspace-store.mjs');
const { loginWeb, readWebPrincipal, webSessionCookie } = require('../lib/web-auth-store.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const { defaultOrganization } = require('../src/department-model.js');
const { webHome, webSignup, webLogin, webLogout, openWebStudio } = require('../lib/web-entry-flow.mjs');
const { passwordRecord, passwordScheme } = require('../lib/mobile-auth-store.mjs');

const origin = 'https://cleanrooms.example';
const ip = '203.0.113.20';
const signup = (overrides = {}) => ({
  name: 'Ny ejer',
  email: 'ejer@example.test',
  password: 'Sikkert kodeord til testen',
  companyName: 'Nyt Firma',
  siteName: 'Firmaets værksted',
  requestId: crypto.randomUUID(),
  ...overrides,
});

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = path.join(__dirname, '../drizzle');
  const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  for (const file of migrations) sqlite.exec(readFileSync(path.join(directory, file), 'utf8'));

  return {
    sqlite,
    prepare: sql => ({ bind: (...values) => ({ sql, values }) }),
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, values }) => {
          assert.ok(values.length <= 100, 'D1 supports at most 100 bound parameters');
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

function count(db, table) {
  return db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function formRequest(route, data, headers = {}) {
  return new Request(origin + route, {
    method: 'POST',
    headers: {Origin: origin, 'CF-Connecting-IP': ip, ...headers},
    body: new URLSearchParams(data),
  });
}

test('the homepage signs a new customer in once and denies further company creation from that session', async t => {
  const db = database(t);
  const input = signup();
  const renderPlan = () => new Response('Plan');
  assert.equal((await openWebStudio(new Request(origin + '/vagtplan'), db, renderPlan)).headers.get('location'), '/');
  assert.equal((await webSignup(formRequest('/opret', input, {Origin:'https://elsewhere.test'}), db)).status, 403);
  assert.equal(count(db, 'workspaces'), 0);
  const created = await webSignup(formRequest('/opret', input), db);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), '/vagtplan');
  const cookie = created.headers.get('set-cookie').split(';', 1)[0];
  const headers = {Cookie: cookie};
  const entry = await openWebStudio(new Request(origin + '/vagtplan', {headers}), db, renderPlan);
  const planner = entry.headers.get('location');
  assert.match(planner, /^\/vagtplan\?virksomhed=ws-/);
  assert.equal(await (await openWebStudio(new Request(origin + planner, {headers}), db, renderPlan)).text(), 'Plan');
  assert.equal((await openWebStudio(new Request(origin + '/vagtplan?virksomhed=another', {headers}), db, renderPlan)).headers.get('location'), '/');
  const stale = await handleWorkspaceStudioRequest(new Request(origin + '/api/studio', {headers}), db);
  assert.equal(stale.status, 403);
  const home = await (await webHome(new Request(origin + '/?vis=opret', {headers}), db)).text();
  assert.match(home, /Åbn vagtplanen/);
  assert.doesNotMatch(home, /action="\/opret"/);
  assert.equal((await webSignup(formRequest('/opret', signup({email:'anden@example.test'}), headers), db)).status, 303);
  assert.equal(count(db, 'workspaces'), 1);
  const logout = await webLogout(formRequest('/log-ud', {}, headers), db);
  assert.equal(logout.headers.get('location'), '/');
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await openWebStudio(new Request(origin + '/vagtplan', {headers}), db, renderPlan)).headers.get('location'), '/');
  const login = await webLogin(formRequest('/login', {email:input.email, password:input.password}), db);
  assert.equal(login.headers.get('location'), '/vagtplan');
});

test('public signup produces a free workspace with one owner, a clean plan, and a working login', async t => {
  const db = database(t);
  const input = signup({ email: ' EJER@Example.TEST ' });
  const company = await registerCompany(db, input, { ip });
  assert.equal(company.name, input.companyName);
  assert.equal(company.plan, 'free_beta');
  assert.equal(company.isOwner, true);

  const login = await loginWeb({ db, email: input.email, password: input.password, ip });
  assert.equal(login.principal.email, 'ejer@example.test');
  const loginRequest = new Request(origin + '/login');
  const cookie = webSessionCookie(login.token, loginRequest).split(';', 1)[0];
  const principal = await readWebPrincipal({
    db,
    request: new Request(origin + '/vagtplan', { headers: { Cookie: cookie } }),
  });
  assert.deepEqual(principal, login.principal);
  const plan = await handleWorkspaceStudioRequest(new Request(origin + '/api/studio', {
    headers: { Cookie: cookie, 'X-CleanRooms-Workspace': company.id },
  }), db);
  assert.equal(plan.status, 200);
  assert.equal((await plan.json()).workspace.id, company.id);

  const context = await resolveWorkspace(db, principal);
  assert.equal(context.workspace.id, company.id);
  assert.equal(context.workspace.ownerUserId, principal.userId);
  assert.equal(context.role.id, 'admin');
  const studio = context.saved.studio;
  assert.equal(studio.workspaceSettings.companyName, input.companyName);
  assert.deepEqual(studio.organization.sites.map(site => site.name), [input.siteName]);
  assert.equal(studio.demoSeed, false);
  assert.deepEqual(studio.roster, []);
  assert.deepEqual(studio.series, []);
  assert.deepEqual(studio.edits, {});
  assert.equal(count(db, 'workspace_web_credentials'), 1);
  assert.equal(count(db, 'workspace_company_signups'), 0);
});

test('concurrent retries only recover the original company with the original signup details and password', async t => {
  const db = database(t);
  const input = signup();
  const [first, second] = await Promise.all([
    registerCompany(db, input, { ip }),
    registerCompany(db, { ...input, email: 'EJER@example.test' }, { ip }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(count(db, 'workspaces'), 1);
  assert.equal(count(db, 'workspace_web_credentials'), 1);
  assert.equal(count(db, 'workspace_plans'), 1);

  const duplicate = { status: 409, code: 'company_signup_exists' };
  await assert.rejects(registerCompany(db, { ...input, password: 'Andet gyldigt kodeord' }, { ip }), duplicate);
  await assert.rejects(registerCompany(db, { ...input, companyName: 'Et andet firma' }, { ip }), duplicate);
  await assert.rejects(registerCompany(db, { ...input, requestId: crypto.randomUUID() }, { ip }), duplicate);
  assert.equal(count(db, 'workspaces'), 1);
});

test('competing companies cannot claim the same email, including through a different signup request', async t => {
  const db = database(t);
  const first = signup();
  const second = signup({ email: 'ejer@EXAMPLE.test', companyName: 'Konkurrerende firma' });
  const results = await Promise.allSettled([
    registerCompany(db, first, { ip }),
    registerCompany(db, second, { ip }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected');
  assert.equal(failed.reason.code, 'company_signup_exists');
  assert.equal(count(db, 'workspaces'), 1);
  assert.equal(count(db, 'workspace_members'), 1);
  assert.equal(count(db, 'workspace_web_credentials'), 1);
});

test('legacy accounts keep their workspaces and a new email cannot become the owner of the old company', async t => {
  const db = database(t);
  const legacy = { userId: 'existing-owner', name: 'Test owner', email: 'owner@example.test' };
  const saved = await writeStudio(db, legacy.userId, 0, {
    storageVersion: 1, demoSeed: true, organization: defaultOrganization(), workspaceSettings: { companyName: 'Eksisterende testfirma' },
    series: [], edits: {}, deleted: [], weekPlans: {}, requests: {}, checklistProgress: {}, coverageRules: [],
  });
  assert.equal(saved.ok, true);
  const original = await resolveWorkspace(db, legacy);

  await assert.rejects(registerCompany(db, signup({ email: 'Owner@Example.test' }), { ip }), {
    status: 409, code: 'company_signup_exists',
  });
  assert.equal(count(db, 'workspace_web_credentials'), 0);

  const input = signup();
  const company = await registerCompany(db, input, { ip });
  const login = await loginWeb({ db, email: input.email, password: input.password, ip });
  const workspace = await resolveWorkspace(db, login.principal);
  assert.equal(workspace.workspace.id, company.id);
  assert.notEqual(workspace.workspace.id, original.workspace.id);
  const cookie = webSessionCookie(login.token, new Request(origin + '/login')).split(';', 1)[0];
  const denied = await handleWorkspaceStudioRequest(new Request(origin + '/api/studio', {
    headers: {
      Cookie: cookie,
      'X-CleanRooms-Workspace': original.workspace.id,
      'oai-authenticated-user-id': legacy.userId,
      'oai-authenticated-user-email': legacy.email,
    },
  }), db);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'company_access_denied');
  assert.equal((await resolveWorkspace(db, legacy)).saved.studio.workspaceSettings.companyName, 'Eksisterende testfirma');

  const demo = {email:'demo@example.test', password:'demo-42'};
  const {salt, hash} = await passwordRecord(demo.password);
  const config = JSON.stringify({
    email:demo.email, siteEmail:legacy.email,
    password_scheme:passwordScheme, password_salt:salt, password_hash:hash,
  });
  assert.equal((await webLogin(formRequest('/login', demo), db, config)).status, 401);
  const siteHeaders = {'oai-authenticated-user-id':legacy.userId, 'oai-authenticated-user-email':legacy.email};
  const demoLogin = await webLogin(formRequest('/login', demo, siteHeaders), db, config);
  assert.equal(demoLogin.status, 303);
  const demoCookie = demoLogin.headers.get('set-cookie').split(';', 1)[0];
  const demoHeaders = {Cookie:demoCookie, 'X-CleanRooms-Workspace':original.workspace.id};
  assert.equal((await handleWorkspaceStudioRequest(new Request(origin + '/api/studio', {headers:demoHeaders}), db)).status, 401);
  const demoPlan = await handleWorkspaceStudioRequest(new Request(origin + '/api/studio', {
    headers:{...demoHeaders, ...siteHeaders},
  }), db);
  assert.equal(demoPlan.status, 200);
  assert.equal((await demoPlan.json()).workspace.id, original.workspace.id);
  assert.equal(count(db, 'workspaces'), 2);
});

test('an interrupted company creation rolls back credentials, company, owner and plan together', async t => {
  const db = database(t);
  const input = signup();
  db.sqlite.exec("CREATE TRIGGER stop_first_company BEFORE INSERT ON studio_state_chunks BEGIN SELECT RAISE(ABORT, 'forced creation failure'); END");
  await assert.rejects(registerCompany(db, input, { ip }), /forced creation failure/);
  for (const table of ['workspaces', 'workspace_plans', 'workspace_members', 'studio_states', 'workspace_web_credentials']) {
    assert.equal(count(db, table), 0);
  }
  db.sqlite.exec('DROP TRIGGER stop_first_company');
  const recovered = await registerCompany(db, input, { ip });
  assert.ok(recovered.id);
  assert.equal(count(db, 'workspace_web_credentials'), 1);
});
