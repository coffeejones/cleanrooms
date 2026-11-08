const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const build = process.env.CLEANROOMS_TEST_BUILD;
if (!build) throw new Error('Run node tests/run.mjs to compile the actual app modules.');
const { payPeriod, addDays } = require(path.join(build, 'domain/model.js'));
const { parseEmployeeCompanySettings } = require(path.join(build, 'state/company-settings-wire.js'));
const interval = (...args) => { const { from, to } = payPeriod(...args); return [from, to]; };

test('company payroll periods support calendar months, chosen start days and year navigation', () => {
  assert.deepEqual(interval('2026-11-08', 0, 1), ['2026-11-01', '2026-11-30']);
  assert.deepEqual(interval('2026-01-01', -1, 1), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(interval('2026-11-08', 0, 15), ['2026-10-15', '2026-11-14']);
  assert.deepEqual(interval('2026-11-15', 0, 15), ['2026-11-15', '2026-12-14']);
  assert.deepEqual(interval('2026-12-30', 1, 26), ['2027-01-26', '2027-02-25']);
});

test('late payroll start days clamp in short months and produce contiguous leap-year periods', () => {
  assert.deepEqual(interval('2026-02-28', 0, 31), ['2026-02-28', '2026-03-30']);
  assert.deepEqual(interval('2028-02-28', 0, 31), ['2028-01-31', '2028-02-28']);
  assert.deepEqual(interval('2028-02-29', 0, 31), ['2028-02-29', '2028-03-30']);
  for (const startDay of [1, 15, 26, 28, 29, 30, 31]) {
    for (const date of ['2026-01-01', '2026-02-27', '2026-02-28', '2026-03-01', '2028-02-28', '2028-02-29', '2026-12-31']) {
      const current = payPeriod(date, 0, startDay), next = payPeriod(date, 1, startDay);
      assert.ok(current.from <= date && date <= current.to);
      assert.equal(addDays(current.to, 1), next.from);
    }
  }
});

test('invalid company period values fail closed rather than using a demo default', () => {
  for (const startDay of [0, 32, 1.5, NaN, '26', null]) assert.throws(() => payPeriod('2026-11-08', 0, startDay));
  for (const value of [null, [], {}, { version: 1 }, { version: -1, payrollPeriod: { startDay: 26 } }, { version: 1, payrollPeriod: { startDay: 32 } }, { version: 1, payrollPeriod: { startDay: '26' } }]) assert.throws(() => parseEmployeeCompanySettings(value));
  assert.deepEqual(parseEmployeeCompanySettings({ version: 4, payrollPeriod: { startDay: 31 }, privateData: 'ignored' }), { version: 4, payrollPeriod: { startDay: 31 } });
});
