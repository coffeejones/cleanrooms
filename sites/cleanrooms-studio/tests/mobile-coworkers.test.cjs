const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readMobileCoworkers } = require('../lib/mobile-coworkers.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const { handleAccountsRequest } = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const Publication = require('../src/publication-model.js');

async function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  }
  t.after(() => sqlite.close());
  const db = { sqlite, queries: [], beforeBatch: null, prepare: sql => ({ bind: (...values) => ({ sql, values }) }) };
  db.batch = async statements => {
    await db.beforeBatch?.(statements);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(({ sql, values }) => {
        db.queries.push(sql);
        const q = sqlite.prepare(sql);
        return q.columns().length ? { results: q.all(...values) } : { meta: { changes: Number(q.run(...values).changes) } };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  const people = [
    ['person-coworker-self', 'Anna', 0], ['person-coworker-peer', 'Bo', 0],
    ['person-coworker-foreign-site', 'Clara', 1], ['person-coworker-next-day', 'Ditte', 0],
  ].map(([id, name, site]) => ({ id, name, site, initials: name[0], role: 'Service', target: 37, active: true }));
  const own = { id: 'coworker-own', person: people[0].id, date: '2090-01-10', start: '08:00', end: '16:00', site: 0, note: 'OWN_PRIVATE_INSTRUCTIONS' };
  const shifts = [own,
    { ...own, id: 'coworker-morning', person: people[1].id, start: '06:00', end: '08:00', note: 'PEER_PRIVATE_INSTRUCTIONS' },
    { ...own, id: 'coworker-evening', person: people[1].id, start: '16:00', end: '22:00', note: 'EVENING_PRIVATE_INSTRUCTIONS' },
    { ...own, id: 'coworker-other-site', person: people[2].id, site: 1 },
    { ...own, id: 'coworker-next-day', person: people[3].id, date: '2090-01-11' },
    { ...own, id: 'coworker-own-extra', start: '18:00', end: '21:00' },
  ];
  const template = { storageVersion: 1, demoSeed: false, roster: people, organization: Departments.defaultOrganization(),
    series: [], edits: Object.fromEntries(shifts.map(shift => [shift.id, shift])), deleted: [], requests: {}, weekPlans: {}, coverageRules: [], checklistProgress: {},
  };
  const published = Publication.publish(template, { from: '2090-01-09', to: '2090-01-15', siteIds: [0,1,2], actor: { userId: 'owner-one', name: 'Planner' }, at: new Date().toISOString() }).studio;
  const tenants = [];
  for (const owner of ['coworker-owner-one', 'coworker-owner-two']) {
    assert.equal((await writeStudio(db, owner, 0, published)).ok, true);
    const response = await handleAccountsRequest(new Request('https://studio.example/api/accounts', {
      method: 'POST', headers: { origin: 'https://studio.example', 'content-type': 'application/json',
        'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': owner + '@example.test' },
      body: JSON.stringify({ action: 'timeRead', from: '2090-01-09', to: '2090-01-15' }),
    }), db);
    assert.equal(response.status, 200, await response.text());
    tenants.push(sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner).id);
  }
  const employee = { workspaceId: tenants[0], personId: people[0].id };
  return { db, sqlite, employee, own, people, foreignWorkspaceId: tenants[1],
    read: payload => readMobileCoworkers(db, employee, { shiftId: own.id, cursor: null, limit: 50, ...payload }),
  };
}

test('coworkers include the whole published day at the same worksite without exposing private data', async t => {
  const { db, read } = await setup(t);
  db.queries = [];
  const result = await read({});
  assert.deepEqual(result.colleagues, [
    { id: 'coworker-morning', personId: 'person-coworker-peer', name: 'Bo', role: 'Service', start: '06:00', end: '08:00' },
    { id: 'coworker-evening', personId: 'person-coworker-peer', name: 'Bo', role: 'Service', start: '16:00', end: '22:00' },
  ]);
  assert.equal(result.nextCursor, null);
  assert.equal(/PRIVATE|email|payroll|latitude|comment/.test(JSON.stringify(result)), false);
  assert.equal(db.queries.some(sql => /SELECT \*|studio_state_chunks|workspace_published_shift_chunks|occurrence\.config/.test(sql)), false);
  assert.ok(db.queries.some(sql => sql.includes('INDEXED BY workspace_published_shifts_scope')));
});

test('own published assignment must be verified before exposing colleagues or accepting a cursor', async t => {
  const { db, employee, read } = await setup(t);
  await assert.rejects(read({ shiftId: 'coworker-morning' }), { code: 'mobile_coworkers_forbidden' });
  await assert.rejects(read({ shiftId: 'missing' }), { code: 'mobile_coworkers_forbidden' });
  await assert.rejects(readMobileCoworkers(db, { ...employee, workspaceId: 'missing-workspace' }, { shiftId: 'coworker-own', cursor: null, limit: 50 }), { code: 'mobile_coworkers_forbidden' });
});

test('coworker cursors page once, bind to tenant/employee/shift and reject publication changes', async t => {
  const { db, employee, read, foreignWorkspaceId, sqlite } = await setup(t);
  const page = await read({ limit: 1 });
  assert.equal(page.colleagues[0].id, 'coworker-morning');
  assert.ok(page.nextCursor);
  const last = await read({ cursor: page.nextCursor, limit: 1 });
  assert.equal(last.colleagues[0].id, 'coworker-evening');
  assert.equal(last.nextCursor, null);
  await assert.rejects(readMobileCoworkers(db, { ...employee, workspaceId: foreignWorkspaceId }, { shiftId: 'coworker-own', cursor: page.nextCursor, limit: 1 }), { code: 'mobile_coworkers_cursor_invalid' });
  await assert.rejects(read({ shiftId: 'coworker-own-extra', cursor: page.nextCursor, limit: 1 }), { code: 'mobile_coworkers_cursor_invalid' });
  sqlite.prepare('UPDATE workspace_publication_scopes SET version=version+1 WHERE workspace_id=?').run(employee.workspaceId);
  await assert.rejects(read({ cursor: page.nextCursor, limit: 1 }), { code: 'mobile_coworkers_changed' });
});

test('a late reassignment or directory change cannot return colleague data from a stale access context', async t => {
  for (const change of ['assignment', 'directory']) {
    const { db, employee, own, read, sqlite } = await setup(t);
    let changed = false;
    db.beforeBatch = statements => {
      if (!changed && statements.some(item => item.sql.includes('SELECT occurrence.id'))) {
        changed = true;
        if (change === 'assignment') sqlite.prepare("UPDATE workspace_published_shifts SET person_id='person-coworker-peer' WHERE workspace_id=? AND id=?").run(employee.workspaceId, own.id);
        else sqlite.prepare('UPDATE workspace_directory_state SET version=version+1 WHERE workspace_id=?').run(employee.workspaceId);
      }
    };
    await assert.rejects(read({}), { code: 'mobile_coworkers_changed' });
    assert.equal(changed, true);
  }
});
