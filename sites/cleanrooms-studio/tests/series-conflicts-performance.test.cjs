const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/series-engine.js');

// Keep the previous brute-force implementation as a behavioral oracle.
function brute(proposed, existing, excludeIds = []) {
  const present = value => value !== null && value !== undefined && String(value).trim() !== '';
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const parsed = new Date(0);
    parsed.setUTCHours(0, 0, 0, 0);
    parsed.setUTCFullYear(year, month - 1, day);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  const excluded = new Set(excludeIds);
  const order = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)) || String(a.id).localeCompare(String(b.id));
  const candidates = (Array.isArray(proposed) ? proposed : [proposed]).filter(Boolean).slice().sort(order);
  const others = (Array.isArray(existing) ? existing : []).filter(shift => shift && !excluded.has(shift.id)).slice().sort(order);
  const result = [];
  for (const shift of candidates) {
    if (!present(shift.person) || !validDate(shift.date) || !validTime(shift.start) || !validTime(shift.end) || shift.end <= shift.start) continue;
    for (const other of others) {
      if ((present(shift.id) && shift.id === other.id) || other.person !== shift.person || other.date !== shift.date) continue;
      if (!validTime(other.start) || !validTime(other.end) || other.end <= other.start) continue;
      if (shift.start < other.end && other.start < shift.end) result.push({shift, other, type: 'overlap'});
    }
  }
  return result;
}

test('bucketed conflict results preserve brute-force identities, order and exclusions', () => {
  let seed = 99173;
  const random = max => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % max;
  const sharedPerson = {};
  const people = ['person-a', 'person-b', '__proto__', '', 0, null, undefined, NaN, sharedPerson, {}];
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-02-30', '', null];
  const times = ['07:00', '08:00', '09:00', '10:00', '16:00', '24:00', '', null];
  for (let run = 0; run < 150; run++) {
    const shifts = Array.from({length: 40}, (_, index) => ({
      id: [undefined, null, '', 'duplicate', String(index)][random(5)],
      person: people[random(people.length)], date: dates[random(dates.length)],
      start: times[random(times.length)], end: times[random(times.length)],
    }));
    const proposed = run % 3 ? shifts.slice(0, 20) : shifts[0];
    const existing = run % 11 ? [...shifts.slice(10), null] : {};
    const excluded = run % 2 ? ['duplicate', undefined] : [];
    const expected = brute(proposed, existing, excluded);
    const actual = Engine.conflicts(proposed, existing, excluded);
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < actual.length; index++) {
      assert.equal(actual[index].shift, expected[index].shift);
      assert.equal(actual[index].other, expected[index].other);
      assert.equal(actual[index].type, 'overlap');
    }
  }
});

test('person and date buckets retain strict identity and touching-time semantics', () => {
  const shift = (id, person, date, start = '08:00', end = '10:00') => ({id, person, date, start, end});
  const proposed = [shift('a', '__proto__', '2026-11-02'), shift('b', NaN, '2026-11-02'), shift('c', 0, '2026-11-02')];
  const existing = [shift('d', '__proto__', '2026-11-02'), shift('e', NaN, '2026-11-02'), shift('f', '0', '2026-11-02'), shift('g', 0, '2026-11-02', '10:00', '11:00')];
  assert.deepEqual(Engine.conflicts(proposed, existing), brute(proposed, existing));
  assert.equal(Engine.conflicts(proposed, existing).length, 1);
});

test('50,000 independent employees do not incur quadratic person comparisons', () => {
  const count = 50_000;
  let personReads = 0;
  const shifts = Array.from({length: count}, (_, index) => ({
    id: String(index).padStart(6, '0'),
    get person() { personReads++; return index; },
    date: '2026-11-02', start: '08:00', end: '16:00',
  }));
  assert.deepEqual(Engine.conflicts(shifts, shifts), []);
  assert.ok(personReads < count * 10, `${personReads} person reads for ${count} independent employees`);
});
