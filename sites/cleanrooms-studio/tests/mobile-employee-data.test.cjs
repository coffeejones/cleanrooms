const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { readMobileHours } = require('../lib/mobile-employee-data.mjs');
const { writeStudio } = require('../lib/studio-store.mjs');
const Workspace = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const Publication = require('../src/publication-model.js');
const Time = require('../src/timekeeping-model.js');

const own = 'person-mobile-own', peer = 'person-mobile-peer';
const rate = amount => ({ currency: 'DKK', agreements: [{ id: 'base', from: '2026-01-01', type: 'hourly', amountCents: amount }], supplements: [] });
const shift = (id, person, date = '2026-11-02', patch = {}) => ({ id, person, date, site: 0, start: '08:00', end: '16:00', plannedBreakMinutes: 30, note: '', ...patch });

async function setup(t, shifts = [shift('own', own), shift('peer', peer)]) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const filename of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', filename), 'utf8'));
  const db = { sqlite, prepare: sql => ({ bind: (...values) => ({ sql, values }) }), beforeBatch: null,
    async batch(statements) {
      await this.beforeBatch?.(statements);
      sqlite.exec('BEGIN IMMEDIATE');
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
  const roster = [own, peer].map((id, index) => ({ id, name: index ? 'Private Peer Name' : 'Own Employee', initials: 'OE', target: 37, site: 0, role: 'Service', active: true }));
  const studio = Publication.publish({ storageVersion: 1, demoSeed: false, roster,
    organization: Departments.defaultOrganization(), series: [], edits: Object.fromEntries(shifts.map(item => [item.id, item])),
    deleted: [], weekPlans: {}, requests: {}, checklistProgress: {}, coverageRules: [],
  }, { from: '2026-10-26', to: '2026-11-08', siteIds: [0], actor: { userId: 'mobile-hours-owner', name: 'Owner' }, at: '2026-10-26T00:00:00.000Z' }).studio;
  assert.equal((await writeStudio(db, 'mobile-hours-owner', 0, studio)).ok, true);
  const response = await Workspace.handleWorkspaceStudioRequest(new Request('https://studio.example/api/studio', {
    headers: { 'oai-authenticated-user-id': 'mobile-hours-owner', 'oai-authenticated-user-email': 'owner@example.test', 'oai-authenticated-user-full-name': 'Owner' },
  }), db);
  assert.equal(response.status, 200, await response.clone().text());
  const { workspace } = await response.json();
  const employee = { workspaceId: workspace.id, personId: own };
  function policy(config, personal = rate(20000), mode = 'personal') {
    const value = { schema: 1, groups: [{ id: 'group', name: 'Daghold', archived: false,
      revisions: [{ id: 'revision', from: '2026-01-01', payroll: config }] }],
    links: [own, peer].map(personId => ({ personId, from: '2026-01-01', groupId: 'group', baseMode: personId === own ? mode : 'group', excludedPersonalSupplementIds: [], supplementOverrides: [] })) };
    sqlite.prepare('INSERT OR REPLACE INTO workspace_payroll_policies VALUES (?,?,?,?,?,?,?)').run(workspace.id, JSON.stringify(value), 1, '[]', 'owner', new Date().toISOString(), 'policy');
    sqlite.prepare('INSERT OR REPLACE INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspace.id, own, JSON.stringify(personal), 1, 'owner', new Date().toISOString(), 'personal');
    sqlite.prepare('INSERT OR REPLACE INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspace.id, peer, JSON.stringify(rate(999999)), 1, 'owner', new Date().toISOString(), 'private-peer');
  }
  function attendance(source, patch = {}) {
    const entry = { id: 'entry-' + source.id, shiftId: source.id, personId: source.person, date: source.date, site: source.site,
      plannedStart: source.start, plannedEnd: source.end, plannedBreakMinutes: source.plannedBreakMinutes,
      start: source.start, end: source.end, endDate: source.end <= source.start ? Time.addDays(source.date, 1) : source.date,
      breakMinutes: source.plannedBreakMinutes, breaks: [], breakAllocation: 'end-of-shift', status: 'submitted', version: 1,
      audit: [], comment: 'Secret own comment', ...patch };
    const interval = Time.absoluteInterval(entry);
    sqlite.prepare(`INSERT INTO workspace_time_entries
      (workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at,interval_start,interval_end)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(workspace.id, entry.id, entry.shiftId, entry.personId, entry.date, entry.endDate,
      entry.status, Number(patch.demo || false), entry.version, JSON.stringify(entry), 'entry', new Date().toISOString(), interval?.start ?? null, interval?.end ?? null);
    return entry;
  }
  return { db, sqlite, employee, policy, attendance, shifts };
}

test('mobile hours use the actual group, personal override and dated supplements without leaking other employees', async t => {
  const { db, employee, policy, attendance, shifts } = await setup(t);
  const group = rate(18000);
  group.supplements.push({ id: 'morning', name: 'Morgentillæg', type: 'hourly', amountCents: 2500, from: '2026-01-01', to: null, weekdays: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '10:00' });
  policy(group); attendance(shifts[0]); attendance(shifts[1]);
  const result = await readMobileHours(db, employee, { from: '2026-11-01', to: '2026-11-08' });
  assert.equal(result.summary.workedMinutes, 450);
  assert.equal(result.summary.plannedMinutes, 450);
  assert.equal(result.summary.baseEarnedCents, 150000);
  assert.equal(result.summary.allowanceEarnedCents, 5000);
  assert.equal(result.summary.earnedCents, 155000);
  assert.deepEqual(result.rows.map(item => item.shift.id), ['own']);
  assert.match(result.rows[0].sourceLabel, /Daghold.*personlig/);
  assert.ok(!JSON.stringify(result).includes('Private Peer Name'));
  assert.ok(!JSON.stringify(result).includes('999999'));
  assert.ok(!JSON.stringify(result).includes('Secret own comment'));
  assert.equal(result.rows[0].entry.hasComment,true);assert.equal(result.rows[0].entry.commentDeferred,true);
  assert.ok(!JSON.stringify(result).includes('agreements'));
});

test('running records never accrue time or money and published future shifts remain forecasts', async t => {
  const { db, employee, policy, attendance, shifts } = await setup(t);
  policy(rate(18000), rate(20000), 'group');
  attendance(shifts[0], { end: null, clockStartAt: '2026-11-02T07:00:00Z', status: 'running' });
  const result = await readMobileHours(db, employee, { from: '2026-11-01', to: '2026-11-08' });
  assert.equal(result.summary.workedMinutes, 0); assert.equal(result.summary.earnedCents, 0);
  assert.equal(result.summary.plannedMinutes, 450); assert.equal(result.summary.estimatedCents, 135000);
  assert.equal(result.rows[0].pay.kind, 'planned'); assert.equal(result.rows[0].entry.status, 'running');
});

test('approved salary snapshots remain authoritative after the configured rate changes', async t => {
  const { db, employee, policy, attendance, shifts } = await setup(t);
  policy(rate(99000));
  attendance(shifts[0], { status: 'approved', payroll: { baseCents: 110000, supplementCents: 4500, totalCents: 114500, sourceLabel: 'Godkendt historisk aftale' } });
  const result = await readMobileHours(db, employee, { from: '2026-11-01', to: '2026-11-08' });
  assert.equal(result.summary.approvedMinutes, 450); assert.equal(result.summary.approvedCents, 114500);
  assert.equal(result.summary.earnedCents, 114500); assert.equal(result.rows[0].pay.totalCents, 114500);
});

test('monthly salary and monthly allowances are period amounts rather than duplicated per shift', async t => {
  const shifts = [shift('one', own, '2026-11-02'), shift('two', own, '2026-11-03')];
  const { db, employee, policy, attendance } = await setup(t, shifts);
  const monthly = rate(3000000); monthly.agreements[0].type = 'monthly';
  monthly.supplements.push({ id: 'fixed', name: 'Fast tillæg', type: 'monthly', amountCents: 300000, from: '2026-01-01', to: null, weekdays: [], start: null, end: null });
  policy(monthly, rate(20000), 'group'); shifts.forEach(item => attendance(item));
  const result = await readMobileHours(db, employee, { from: '2026-11-01', to: '2026-11-15' });
  assert.equal(result.summary.workedMinutes, 900); assert.equal(result.summary.earnedCents, 0);
  assert.equal(result.summary.monthlyCents, 1596774); // 15 selected days in the configured Oct26–Nov25 cycle.
  assert.equal(result.monthlyLines.reduce((amount, line) => amount + line.amountCents, 0), 1596774);
  assert.equal(result.monthlyLines.length, 2);
});

test('missing pay, invalid periods, inactive employees and concurrent pay edits fail safely', async t => {
  const { db, employee, sqlite, attendance, shifts, policy } = await setup(t);
  attendance(shifts[0]);
  const result = await readMobileHours(db, employee, { from: '2026-11-01', to: '2026-11-08' });
  assert.equal(result.summary.missingPayCount, 1); assert.ok(result.rows[0].pay.unavailableReason);
  await assert.rejects(readMobileHours(db, employee, { from: '2026-01-01', to: '2028-01-01' }), { code: 'mobile_hours_period_invalid' });
  await assert.rejects(readMobileHours(db, { ...employee, workspaceId: 'other-workspace' }, { from: '2026-11-01', to: '2026-11-08' }), { code: 'mobile_employee_inactive' });
  policy(rate(18000)); let changed = false;
  db.beforeBatch = statements => {
    if (!changed && statements.some(item => item.sql.includes('SELECT site_index,catalog'))) {
      changed = true; sqlite.prepare('UPDATE workspace_payroll SET version=version+1 WHERE workspace_id=? AND person_id=?').run(employee.workspaceId, own);
    }
  };
  await assert.rejects(readMobileHours(db, employee, { from: '2026-11-01', to: '2026-11-08' }), { code: 'mobile_hours_changed' });
});

test('a partial-day interval clips overnight work and marks unallocatable approved snapshots explicitly', async t => {
  const night = shift('night', own, '2026-11-02', { start: '22:00', end: '23:00', plannedBreakMinutes: 0 });
  const { db, employee, policy, attendance, sqlite } = await setup(t, [night]);
  policy(rate(18000), rate(20000), 'group');
  const entry = attendance(night, { end: '06:00', endDate: '2026-11-03' });
  const result = await readMobileHours(db, employee, { from: '2026-11-03', to: '2026-11-03' });
  assert.equal(result.summary.workedMinutes, 360); assert.equal(result.summary.earnedCents, 108000);
  entry.status = 'approved'; entry.payroll = { baseCents: 144000, supplementCents: 0, totalCents: 144000 };
  sqlite.prepare('UPDATE workspace_time_entries SET status=?,config=? WHERE workspace_id=? AND id=?').run('approved', JSON.stringify(entry), employee.workspaceId, entry.id);
  const approved = await readMobileHours(db, employee, { from: '2026-11-03', to: '2026-11-03' });
  assert.equal(approved.summary.workedMinutes, 360); assert.equal(approved.summary.missingPayCount, 1);
  assert.match(approved.rows[0].pay.unavailableReason, /periodegrænsen/);
});
