/* Compare a week's saved plan with its current shifts without changing either. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);

  const FIELDS = Object.freeze(['date', 'person', 'site', 'start', 'end', 'plannedBreakMinutes', 'note', 'noteRich']);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    }
    return value;
  }

  function comparable(field, value) {
    if(field==='plannedBreakMinutes')return value===undefined?0:value;
    if (field === 'note' || field === 'noteRich') return value ?? '';
    if (field === 'site' && typeof value === 'string' && value.trim() !== '') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
    return value;
  }

  function index(shifts, label) {
    if (!Array.isArray(shifts)) throw new TypeError(label + ' skal være en liste af vagter.');
    const result = new Map();
    shifts.forEach(shift => {
      if (!shift || typeof shift !== 'object' || Array.isArray(shift) ||
          !((typeof shift.id === 'string' && shift.id.trim() !== '') ||
            (typeof shift.id === 'number' && Number.isFinite(shift.id)))) {
        throw new TypeError('Hver vagt skal have et stabilt id.');
      }
      if (shift.noteRich != null && typeof shift.noteRich !== 'string') throw new TypeError('Den formaterede beskrivelse skal være tekst.');
      const key = String(shift.id);
      if (result.has(key)) throw new TypeError('Vagt-id forekommer flere gange: ' + key);
      result.set(key, shift);
    });
    return result;
  }

  function diff(beforeShifts, currentShifts) {
    const before = index(beforeShifts, 'Den gemte plan');
    const current = index(currentShifts, 'Den aktuelle plan');
    const entries = [];
    new Set([...before.keys(), ...current.keys()]).forEach(key => {
      const previous = before.get(key), next = current.get(key);
      const fields = previous && next
        ? FIELDS.filter(field => (field==='note'||field==='noteRich')&&Instructions&&(Instructions.isDeferred(previous)||Instructions.isDeferred(next))?field==='note'&&!Instructions.equal(previous,next):!Object.is(comparable(field, previous[field]), comparable(field, next[field])))
        : FIELDS.filter(field => field==='plannedBreakMinutes'?comparable(field,(next||previous)[field])!==0:field !== 'noteRich' || comparable(field, (next || previous)[field]) !== '');
      if (!fields.length) return;
      entries.push({
        id: next ? next.id : previous.id,
        type: previous ? next ? 'changed' : 'removed' : 'added',
        before: previous ? clone(previous) : null,
        after: next ? clone(next) : null,
        fields
      });
    });
    return entries.sort((a, b) => {
      const left = a.after || a.before, right = b.after || b.before;
      return compare(String(left.date ?? ''), String(right.date ?? '')) ||
        compare(String(left.start ?? ''), String(right.start ?? '')) ||
        compare(String(a.id), String(b.id));
    });
  }

  const api = Object.freeze({diff});
  globalThis.CleanRoomsChanges = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
