/* Pure plans for explicit multi-date selections; the application commits once. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);

  const Actions = globalThis.CleanRoomsActions || (typeof require === 'function' ? require('./schedule-actions.js') : null);
  const Engine = globalThis.CleanRoomsSeries || (typeof require === 'function' ? require('./series-engine.js') : null);
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const fields = ['id', 'person', 'date', 'site', 'start', 'end', 'plannedBreakMinutes', 'note', 'noteRich', 'seriesId'];
  const validTime = value => typeof value === 'string' && TIME.test(value);
  const validId = value => typeof value === 'string' && value.trim() !== '';
  const assigned = value => value !== null && value !== undefined && String(value).trim() !== '';
  const fieldValue = (shift, field) => field === 'note' || field === 'noteRich' ? shift[field] ?? '' : field === 'seriesId' ? shift[field] ?? null : field==='plannedBreakMinutes'?Engine.plannedBreakMinutes(shift):shift[field];
  const sameSnapshot = (member, current) => current && fields.every(field => (field==='note'||field==='noteRich')&&Instructions&&(Instructions.isDeferred(member)||Instructions.isDeferred(current))?Instructions.equal(member,current):fieldValue(member, field) === fieldValue(current, field));

  function addDays(value, count) {
    const date = new Date(value + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + count);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  function dayLabel(value) {
    return new Date(value + 'T12:00:00Z').toLocaleDateString('da-DK', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'});
  }

  function plan(options = {}) {
    const {members, operation, start, end, minDate, maxDate, personName, copyIds} = options;
    const existing = Array.isArray(options.existing) ? options.existing : [];
    const blockedDates = Array.isArray(options.blockedDates) ? options.blockedDates : [];
    const offset = options.offsetDays ?? 0;
    const issues = [], seenIssues = new Set();
    const person = id => assigned(id) ? (typeof personName === 'function' && personName(id)) || 'Medarbejder ' + id : 'Den ledige vagt';
    const addIssue = (id, code, message, detail = '') => {
      const key = JSON.stringify([id, code, detail]);
      if (!seenIssues.has(key)) { seenIssues.add(key); issues.push({id, code, message}); }
    };
    const finish = (proposed = [], changed = false) => ({
      ok: issues.length === 0, changed, proposed, issues,
      error: issues.length ? issues[0].message + (issues.length > 1 ? ' Der er desuden ' + (issues.length - 1) + (issues.length === 2 ? ' andet problem.' : ' andre problemer.') : '') : null
    });
    if (!Array.isArray(members) || !members.length) {
      addIssue(null, 'empty', 'Vælg mindst én vagt.'); return finish();
    }
    if (!['time', 'move', 'copy'].includes(operation)) {
      addIssue(null, 'operation', 'Vælg en gyldig handling for de markerede vagter.'); return finish();
    }
    if (operation === 'time' && (!validTime(start) || !validTime(end) || end === start)) {
      addIssue(null, 'time', 'Vælg gyldige tidspunkter; start og slut skal være forskellige, og vagten skal være kortere end 24 timer.'); return finish();
    }
    if (operation !== 'time' && !Number.isSafeInteger(offset)) {
      addIssue(null, 'offset', 'Antallet af dage skal være et helt tal.'); return finish();
    }
    if ((minDate != null && !Actions.validDate(minDate)) || (maxDate != null && !Actions.validDate(maxDate)) || (minDate && maxDate && minDate > maxDate)) {
      addIssue(null, 'bounds', 'Kalenderens planlægningsperiode er ugyldig.'); return finish();
    }
    const currentById = new Map(existing.filter(Boolean).map(shift => [shift.id, shift]));
    const existingIds = new Set(currentById.keys()), memberIds = new Set(), proposedIds = new Set(), originById = new Map();
    const proposed = [];
    members.forEach(member => {
      const id = member?.id ?? null;
      if (!member || typeof member !== 'object' || !validId(id) || memberIds.has(id)) {
        addIssue(id, 'members', 'Udvalget indeholder en ugyldig eller gentaget vagt.'); return;
      }
      memberIds.add(id);
      if (!Actions.validDate(member.date)) {
        addIssue(id, 'date', 'En markeret vagt har en ugyldig dato. Vælg vagterne igen.'); return;
      }
      if (member.noteRich != null && typeof member.noteRich !== 'string') {
        addIssue(id, 'description', 'Den formaterede beskrivelse er ugyldig. Åbn vagten igen.'); return;
      }
      if (!sameSnapshot(member, currentById.get(id))) {
        addIssue(id, 'stale', (assigned(member.person) ? 'Vagten for ' + person(member.person) : 'Den ledige vagt') + ' er ændret eller slettet. Vælg vagterne igen.');
      }
      if (!validTime(member.start) || !validTime(member.end) || member.end === member.start) {
        addIssue(id, 'time', 'En markeret vagt har ugyldige tidspunkter. Åbn vagten igen.'); return;
      }
      const date = operation === 'time' ? member.date : addDays(member.date, offset);
      if (!Actions.validDate(date) || (minDate && date < minDate) || (maxDate && date > maxDate)) {
        addIssue(id, 'bounds', 'Vagten for ' + person(member.person) + ' ligger uden for kalenderens planlægningsperiode.'); return;
      }
      const next = {...member, date, ...(operation === 'time' ? {start, end} : {})};
      if(Object.hasOwn(member,'endDate'))next.endDate=Engine.shiftEndDate(next);
      if(!Engine.validPlannedBreak(next)){addIssue(id,'break','Den planlagte pause skal være et ikke-negativt helt antal minutter og kortere end vagten.');return;}
      if (operation === 'copy') {
        const nextId = copyIds && Object.hasOwn(copyIds, id) ? copyIds[id] : null;
        if (!validId(nextId) || existingIds.has(nextId) || proposedIds.has(nextId)) {
          addIssue(id, 'ids', 'Hver kopieret vagt skal have et nyt, entydigt id.'); return;
        }
        next.id = nextId;
        delete next.seriesId;
      }
      proposedIds.add(next.id); originById.set(next.id, id); proposed.push(next);
    });
    const changed = operation === 'copy' || (operation === 'move' ? offset !== 0 : members.some(member => member && (member.start !== start || member.end !== end)));
    if (issues.length) return finish(proposed, changed);
    if (operation === 'move' && offset === 0) return finish(proposed, false);
    proposed.forEach(shift => {
      const leave=assigned(shift.person)&&blockedDates.find(block=>block&&block.person===shift.person&&Engine.shiftDates(shift).includes(block.date));
      if(leave){
        addIssue(originById.get(shift.id),'leave',person(shift.person)+' har godkendt fravær den '+dayLabel(leave.date)+'.');
      }
    });
    const overlaps = (candidates, internal) => Engine.conflicts(proposed, candidates, internal || operation === 'copy' ? [] : [...memberIds]).forEach(({shift, other}) => {
      const message = person(shift.person) + (internal ? ' får overlappende vagter ' + shift.start + '–' + shift.end + ' og ' : ' har allerede en vagt ')
        + other.start + '–' + other.end + ' den ' + dayLabel(shift.date) + '.';
      addIssue(originById.get(shift.id), 'overlap', message, other.id);
    });
    overlaps(existing, false); overlaps(proposed, true);
    return finish(proposed, changed);
  }

  const api = Object.freeze({plan});
  globalThis.CleanRoomsBulk = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
