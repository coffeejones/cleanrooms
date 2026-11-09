const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const Auth = require('../lib/mobile-auth-store.mjs');
const { handleMobileEmployeeState, mobileChecklistSnapshot } = require('../lib/mobile-employee-state.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const Workspace = require('../lib/workspace-store.mjs');
const { readEmployeePublishedShift } = require('../lib/publication-store.mjs');
const { readChecklistProgress } = require('../lib/engagement-store.mjs');
const Departments = require('../src/department-model.js');
const Publication = require('../src/publication-model.js');
const Checklist = require('../src/checklist-progress.js');
const Time = require('../src/timekeeping-model.js');

const own = 'person-state-own', peer = 'person-state-peer';
async function setup(t) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const filename of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', filename), 'utf8'));
  const db = { sqlite, prepare: sql => ({ bind: (...values) => ({ sql, values }) }), beforeBatch: null,
    async batch(statements) {
      await this.beforeBatch?.(statements); sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(({ sql, values }) => {
          const q = sqlite.prepare(sql);
          return q.columns().length ? { results: q.all(...values) } : { meta: { changes: Number(q.run(...values).changes) } };
        });
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  t.after(() => sqlite.close());
  const noteRich = JSON.stringify({ type: 'doc', content: [{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fyld sæbe op' }] }] },
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lås døren' }] }] },
  ] }] });
  const makeShift = (id, person) => ({ id, person, date: '2026-11-02', site: 0, start: '08:00', end: '16:00', noteRich });
  const roster = [own, peer].map((id, index) => ({ id, name: index ? 'Peer Employee' : 'Own Employee', initials: 'OE', target: 37, site: 0, role: 'Service', active: true }));
  const edits = { own: makeShift('own', own), peer: makeShift('peer', peer) };
  const studio = Publication.publish({ storageVersion: 1, demoSeed: false, roster,
    organization: Departments.defaultOrganization(), series: [], edits,
    deleted: [], weekPlans: {}, requests: {}, checklistProgress: {}, coverageRules: [],
  }, { from: '2026-10-26', to: '2026-11-08', siteIds: [0], actor: { userId: 'mobile-state-owner', name: 'Owner' }, at: '2026-10-26T00:00:00.000Z' }).studio;
  assert.equal((await writeStudio(db, 'mobile-state-owner', 0, studio)).ok, true);
  const response = await Workspace.handleWorkspaceStudioRequest(new Request('https://studio.example/api/studio', {
    headers: { 'oai-authenticated-user-id': 'mobile-state-owner', 'oai-authenticated-user-email': 'owner@example.test', 'oai-authenticated-user-full-name': 'Owner' },
  }), db);
  assert.equal(response.status, 200, await response.clone().text());
  const { workspace } = await response.json();
  const issue = async (personId, email, workspaceId = workspace.id) => {
    const credential = await Auth.issueMobileCredential({ db, workspaceId, personId, email,
      actorGuard: { sql: '1=1', values: [] }, expectedVersion: 0 });
    const login = await Auth.loginMobile({ db, email, password: credential.temporaryPassword });
    return { token: login.token, session: await Auth.readMobileSession({ db, token: login.token }) };
  };
  const account = await issue(own, 'own-state@example.test');
  const call = payload => handleMobileEmployeeState(db, account.token, account.session, payload);
  return { db, sqlite, workspace, account, call, issue };
}

test('native notification preferences use CAS and persist per employee across fresh sessions', async t => {
  const { db, call, account } = await setup(t);
  assert.deepEqual(await call({ action: 'employeePreferences' }), { version: 0, notifications: true, chatNotifications: true, shiftReminders: false, checkoutReminders: false, reminderLeadMinutes: 30, unavailableDates: [] });
  const updated = await call({ action: 'employeePreference', key: 'notifications', value: false, version: 0 });
  assert.equal(updated.notifications, false); assert.equal(updated.version, 1);
  assert.equal(updated.shiftReminders, false); assert.equal(updated.checkoutReminders, false); assert.equal(updated.reminderLeadMinutes, 30);
  await assert.rejects(call({ action: 'employeePreference', key: 'chatNotifications', value: false, version: 0 }), { code: 'employee_preferences_changed' });
  const fresh = await Auth.readMobileSession({ db, token: account.token });
  const read = await handleMobileEmployeeState(db, account.token, fresh, { action: 'employeePreferences' });
  assert.deepEqual(read, updated);
  await assert.rejects(call({ action: 'employeePreference', key: 'payroll.manage', value: true, version: 1 }), { code: 'employee_preference_invalid' });
});

test('availability stays with the employee, supports removal of past marks and never edits published shifts', async t => {
  const { sqlite, call } = await setup(t), day = Time.addDays(Time.localNow().date, 1);
  const before = sqlite.prepare('SELECT id,version,config FROM workspace_published_shifts ORDER BY id').all();
  const added = await call({ action: 'employeeAvailability', date: day, unavailable: true, version: 0 });
  assert.deepEqual(added.unavailableDates, [day]);
  const reloaded = await call({ action: 'employeePreferences' }); assert.deepEqual(reloaded.unavailableDates, [day]);
  const removed = await call({ action: 'employeeAvailability', date: day, unavailable: false, version: reloaded.version });
  assert.deepEqual(removed.unavailableDates, []);
  await assert.rejects(call({ action: 'employeeAvailability', date: '2020-01-01', unavailable: true, version: removed.version }), { code: 'employee_availability_invalid' });
  assert.deepEqual(sqlite.prepare('SELECT id,version,config FROM workspace_published_shifts ORDER BY id').all(), before);
});

test('preferences cannot cross employee or workspace boundaries, including a forged session object', async t => {
  const { db, sqlite, workspace, account, call, issue } = await setup(t);
  const other = await issue(peer, 'peer-state@example.test');
  await call({ action: 'employeePreference', key: 'notifications', value: false, version: 0 });
  assert.equal((await handleMobileEmployeeState(db, other.token, other.session, { action: 'employeePreferences' })).notifications, true);
  await assert.rejects(handleMobileEmployeeState(db, account.token, {
    ...account.session, employee: { ...account.session.employee, personId: peer },
  }, { action: 'employeePreferences' }), { code: 'mobile_session_invalid' });
  const foreign = 'workspace-state-foreign';
  sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(foreign, 'foreign-owner', 'foreign-owner', new Date().toISOString());
  const columns = sqlite.prepare('PRAGMA table_info(workspace_directory_records)').all().map(row => row.name);
  const original = sqlite.prepare("SELECT * FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=?").get(workspace.id, own);
  original.workspace_id = foreign;
  sqlite.prepare(`INSERT INTO workspace_directory_records(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(key => original[key]));
  const foreignAccount = await issue(own, 'foreign-state@example.test', foreign);
  assert.equal((await handleMobileEmployeeState(db, foreignAccount.token, foreignAccount.session, { action: 'employeePreferences' })).notifications, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_employee_preferences').get().n, 1);
});

test('revoked sessions cannot commit settings even when revoked between read and write', async t => {
  const { db, sqlite, call, account } = await setup(t); let revoked = false;
  db.beforeBatch = statements => {
    if (!revoked && statements.some(item => item.sql.includes('INSERT INTO workspace_employee_preferences'))) {
      revoked = true; sqlite.prepare('DELETE FROM workspace_mobile_sessions WHERE token_hash=?').run(account.session.tokenHash);
    }
  };
  await assert.rejects(call({ action: 'employeePreference', key: 'notifications', value: false, version: 0 }), { code: 'mobile_session_invalid' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_employee_preferences').get().n, 0);
});

test('checklist changes update the same per-shift progress read by web without exposing another assignment', async t => {
  const { db, workspace, call, account, sqlite } = await setup(t);
  const detail = await readEmployeePublishedShift({ db, workspaceId: workspace.id, personId: own, shiftId: 'own' });
  const view = Checklist.read({}, detail.shift), task = view.tasks[0];
  const hash = value => createHash('sha256').update(value).digest('hex');
  const checklistToken = hash(view.signature);
  const changed = await call({ action: 'employeeChecklist', shiftId: 'own', taskId: task.key, checked: true, checklistToken });
  assert.deepEqual(changed.completedTaskIds, [task.key]);
  assert.deepEqual(await mobileChecklistSnapshot(db, account.session.employee, detail.shift), { completedTaskIds: [task.key], checklistToken });
  const web = await readChecklistProgress(db, { workspace: { id: workspace.id }, saved: { studio: {} } }, { personId: own, shifts: [detail.shift] });
  assert.equal(Checklist.read(web, detail.shift).tasks[0].checked, true);
  await assert.rejects(call({ action: 'employeeChecklist', shiftId: 'peer', taskId: task.key, checked: true, checklistToken }), { code: 'employee_shift_forbidden' });
  await assert.rejects(call({ action: 'employeeChecklist', shiftId: 'own', taskId: 'removed-task', checked: true, checklistToken }), { code: 'checklist_changed' });
  const staleView = Checklist.read({}, { ...detail.shift, noteRich: detail.shift.noteRich.replace('Fyld sæbe op', 'Den tidligere opgavetekst') });
  assert.equal(staleView.tasks[0].key, task.key);
  await assert.rejects(call({ action: 'employeeChecklist', shiftId: 'own', taskId: task.key, checked: false, checklistToken: hash(staleView.signature) }), { code: 'checklist_changed' });
  assert.equal(Checklist.read(await readChecklistProgress(db, { workspace: { id: workspace.id }, saved: { studio: {} } }, { personId: own, shifts: [detail.shift] }), detail.shift).tasks[0].checked, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_checklist_tasks WHERE person_id=?').get(peer).n, 0);
  const unchecked = await call({ action: 'employeeChecklist', shiftId: 'own', taskId: task.key, checked: false, checklistToken });
  assert.deepEqual(unchecked.completedTaskIds, []);
});
