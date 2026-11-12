const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const { createCompany, listCompanies } = require('../lib/company-signup-store.mjs');
const { handleWorkspaceStudioRequest, handleAccountsRequest, handleDirectoryRequest } = require('../lib/workspace-store.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const { defaultOrganization } = require('../src/department-model.js');

const origin = 'https://cleanrooms.example';
const owner = { userId: 'existing-owner', name: 'Existing owner', email: 'owner@example.test' };
const founder = { userId: 'new-founder', name: 'New founder', email: 'founder@example.test' };
const signup = (name = 'Nyt Firma', siteName = 'Firmaets værksted') => ({ name, siteName, requestId: crypto.randomUUID() });

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

function request(pathname, principal, { workspaceId, method = 'GET', body } = {}) {
  const headers = new Headers();
  if (principal) {
    headers.set('oai-authenticated-user-id', principal.userId);
    headers.set('oai-authenticated-user-email', principal.email);
    headers.set('oai-authenticated-user-full-name', principal.name);
  }
  if (workspaceId) headers.set('X-CleanRooms-Workspace', workspaceId);
  if (body !== undefined) {
    headers.set('origin', origin);
    headers.set('content-type', 'application/json');
  }
  return new Request(origin + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function response(result) {
  const value = await result;
  return { status: value.status, body: await value.json() };
}

const studio = (db, principal, workspaceId, options) =>
  response(handleWorkspaceStudioRequest(request('/api/studio', principal, { workspaceId, ...options }), db));
const accounts = (db, principal, workspaceId) =>
  response(handleAccountsRequest(request('/api/accounts', principal, { workspaceId, method: 'POST', body: { action: 'list' } }), db));
const directory = (db, principal, workspaceId, body = { action: 'read', kind: 'site' }) =>
  response(handleDirectoryRequest(request('/api/directory', principal, { workspaceId, method: 'POST', body }), db));

async function legacyCompany(db) {
  const saved = await writeStudio(db, owner.userId, 0, {
    storageVersion: 1, demoSeed: true, organization: defaultOrganization(), workspaceSettings: { companyName: 'Eksisterende testfirma' },
    series: [], edits: {}, deleted: [], weekPlans: {}, requests: {}, checklistProgress: {}, coverageRules: [],
  });
  assert.equal(saved.ok, true);
  const result = await studio(db, owner);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

function signupRoute(db) {
  const file = path.join(__dirname, '../app/virksomheder/route.ts');
  const source = transformSync(readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const routeModule = { exports: {} };
  const requireRoute = createRequire(file);
  vm.runInNewContext(source, {
    module: routeModule, exports: routeModule.exports, Response, URL, URLSearchParams, TextDecoder, crypto, console,
    require(name) {
      if (name === 'cloudflare:workers') return { env: { DB: db } };
      if (name === '../chatgpt-auth') return { chatGPTSignInPath: returnTo => '/signin-with-chatgpt?return_to=' + encodeURIComponent(returnTo) };
      return requireRoute(name);
    },
  }, { filename: file });
  return routeModule.exports;
}

test('the signup page requires signed-in same-origin form submission and opens the created company', async t => {
  const db = database(t);
  const route = signupRoute(db);
  const page = await route.GET(request('/virksomheder', null));
  const signedOut = await page.text();
  assert.match(signedOut, /Log ind med ChatGPT/);
  assert.doesNotMatch(signedOut, /<form/);

  const input = signup('Firma & Co. <A>');
  const submit = (principal, requestOrigin, values = new URLSearchParams(input)) => {
    const headers = new Headers(request('/virksomheder', principal).headers);
    headers.set('origin', requestOrigin);
    return route.POST(new Request(origin + '/virksomheder', { method: 'POST', headers, body: values }));
  };
  assert.equal((await submit(null, origin)).status, 401);
  assert.equal((await submit(founder, 'https://elsewhere.example')).status, 403);
  const duplicateFields = new URLSearchParams(input);
  duplicateFields.append('name', 'Another value');
  assert.equal((await submit(founder, origin, duplicateFields)).status, 400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count, 0);

  const created = await submit(founder, origin);
  assert.equal(created.status, 303, await created.text());
  const target = new URL(created.headers.get('location'), origin);
  assert.equal(target.origin, origin);
  assert.equal(target.pathname, '/');
  const companyId = target.searchParams.get('virksomhed');
  assert.ok(companyId);
  assert.equal((await studio(db, founder, companyId)).body.workspace.id, companyId);
  const reloaded = await (await route.GET(request('/virksomheder', founder))).text();
  assert.match(reloaded, /Firma &amp; Co\. &lt;A&gt;/);
  assert.doesNotMatch(reloaded, /Firma & Co\. <A>/);
});

test('the test company owner and a new founder can open separate companies in the free beta', async t => {
  const db = database(t);
  const legacy = await legacyCompany(db);
  const second = await createCompany(db, owner, signup());
  const third = await createCompany(db, founder, signup('Tredje Firma', 'Tredje arbejdssted'));
  assert.equal(new Set([legacy.workspace.id, second.id, third.id]).size, 3);
  assert.equal(second.plan, 'free_beta');
  assert.equal(third.plan, 'free_beta');
  const persistedPlan = db.sqlite.prepare('SELECT plan FROM workspace_plans WHERE workspace_id = ?');
  assert.equal(persistedPlan.get(second.id).plan, 'free_beta');
  assert.equal(persistedPlan.get(third.id).plan, 'free_beta');
  assert.deepEqual(new Set((await listCompanies(db, owner)).map(company => company.id)), new Set([legacy.workspace.id, second.id]));
  assert.deepEqual((await listCompanies(db, founder)).map(company => company.id), [third.id]);

  const currentLegacy = await studio(db, owner);
  assert.equal(currentLegacy.status, 200, JSON.stringify(currentLegacy.body));
  assert.equal(currentLegacy.body.workspace.id, legacy.workspace.id);
  assert.equal(currentLegacy.body.studio.workspaceSettings.companyName, 'Eksisterende testfirma');
  assert.equal(currentLegacy.body.studio.demoSeed, true);

  const current = await studio(db, owner, second.id);
  assert.equal(current.status, 200, JSON.stringify(current.body));
  assert.equal(current.body.workspace.id, second.id);
  assert.equal(current.body.viewer.isOwner, true);
  assert.equal(current.body.viewer.email, owner.email);
  assert.equal(current.body.studio.workspaceSettings.companyName, 'Nyt Firma');
  assert.equal(current.body.studio.demoSeed, false);
  assert.deepEqual(current.body.studio.roster, []);
  assert.deepEqual(current.body.studio.series, []);
  assert.deepEqual(current.body.studio.edits, {});
  assert.deepEqual(current.body.studio.requests, {});

  const sites = await directory(db, owner, second.id);
  assert.equal(sites.status, 200, JSON.stringify(sites.body));
  assert.equal(sites.body.workspace.id, second.id);
  assert.deepEqual(sites.body.records.map(row => row.value.name), ['Firmaets værksted']);
  const accountList = await accounts(db, owner, second.id);
  assert.equal(accountList.status, 200, JSON.stringify(accountList.body));
  assert.equal(accountList.body.workspace.id, second.id);
  assert.deepEqual(accountList.body.members.map(member => member.email), [owner.email]);
  assert.deepEqual(accountList.body.invites, []);
  assert.deepEqual(accountList.body.staff, []);

  const createdEmployee = await directory(db, owner, second.id, { action: 'write', changes: [{
    kind: 'employee', id: 'person-new-company', expectedVersion: 0,
    patch: { name: 'Ny Medarbejder', initials: 'NM', site: 0, target: 37, role: 'Service', active: true },
  }] });
  assert.equal(createdEmployee.status, 200, JSON.stringify(createdEmployee.body));
  assert.deepEqual((await accounts(db, owner, second.id)).body.staff.map(person => person.id), ['person-new-company']);
  assert.equal((await accounts(db, owner)).body.staff.some(person => person.id === 'person-new-company'), false);
  assert.deepEqual((await accounts(db, founder, third.id)).body.staff, []);
});

test('a selected company is authorized against the authenticated identity in each API', async t => {
  const db = database(t);
  const legacy = await legacyCompany(db);
  const second = await createCompany(db, owner, signup());
  await createCompany(db, founder, signup('Founder Company'));
  const sameEmail = { ...founder, email: owner.email };

  for (const read of [studio, accounts, directory]) {
    const anonymous = await read(db, null, second.id);
    assert.equal(anonymous.status, 401, JSON.stringify(anonymous.body));
    const denied = await read(db, sameEmail, second.id);
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error, 'company_access_denied');
    assert.equal(JSON.stringify(denied.body).includes('Firmaets værksted'), false);
    const deniedLegacy = await read(db, founder, legacy.workspace.id);
    assert.equal(deniedLegacy.status, 403, JSON.stringify(deniedLegacy.body));
  }

  const attemptedWrite = await directory(db, sameEmail, second.id, { action: 'write', changes: [{
    kind: 'employee', id: 'person-unauthorized', expectedVersion: 0,
    patch: { name: 'Unauthorized', initials: 'UN', site: 0, target: 37, role: 'Service', active: true },
  }] });
  assert.equal(attemptedWrite.status, 403, JSON.stringify(attemptedWrite.body));
  assert.deepEqual((await accounts(db, owner, second.id)).body.staff, []);
});

test('the same authenticated signup attempt creates only one company across concurrent retries', async t => {
  const db = database(t);
  const input = signup();
  const [first, second] = await Promise.all([createCompany(db, founder, input), createCompany(db, founder, input)]);
  assert.equal(first.id, second.id);
  assert.deepEqual((await listCompanies(db, founder)).map(company => company.id), [first.id]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count, 1);
  await assert.rejects(createCompany(db, founder, { ...input, name: 'Andet navn' }), { status: 409, code: 'company_signup_changed' });

  const differentOwner = await createCompany(db, owner, input);
  assert.notEqual(first.id, differentOwner.id);
  assert.deepEqual((await listCompanies(db, owner)).map(company => company.id), [differentOwner.id]);
});

test('an interrupted company creation rolls back owner, workspace and initial plan together', async t => {
  const db = database(t);
  const input = signup();
  db.sqlite.exec("CREATE TRIGGER stop_first_company BEFORE INSERT ON workspace_members BEGIN SELECT RAISE(ABORT, 'forced creation failure'); END");
  await assert.rejects(createCompany(db, founder, input));
  for (const table of ['workspaces', 'workspace_plans', 'workspace_members', 'studio_states', 'workspace_company_signups']) {
    assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
  db.sqlite.exec('DROP TRIGGER stop_first_company');
  const recovered = await createCompany(db, founder, input);
  assert.equal((await studio(db, founder, recovered.id)).status, 200);
});
