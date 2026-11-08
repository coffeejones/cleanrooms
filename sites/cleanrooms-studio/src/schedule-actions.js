/* Pure, atomic planning for individual moves and explicit time-group edits. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);

  const Engine = globalThis.CleanRoomsSeries || (typeof require === 'function' ? require('./series-engine.js') : null);
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const fields = ['id', 'date', 'person', 'site', 'start', 'end', 'plannedBreakMinutes', 'note', 'noteRich'];
  const hasPerson = person => person !== null && person !== undefined && String(person).trim() !== '';
  const validTime = value => typeof value === 'string' && TIME.test(value);
  const note = value => value ?? '';

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function sameSnapshot(captured, current) {
    return Boolean(captured && current && fields.every(field => field === 'note' || field === 'noteRich'
      ? Instructions&&(Instructions.isDeferred(captured)||Instructions.isDeferred(current))?Instructions.equal(captured,current):note(captured[field]) === note(current[field]) : field==='plannedBreakMinutes'?Engine.plannedBreakMinutes(captured)===Engine.plannedBreakMinutes(current):captured[field] === current[field]));
  }

  function dayLabel(value) {
    return new Date(value + 'T12:00:00Z').toLocaleDateString('da-DK', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'});
  }

  function personLabel(person, personName) {
    if (!hasPerson(person)) return 'Den ledige vagt';
    return (typeof personName === 'function' && personName(person)) || 'Medarbejder ' + person;
  }

  function onLeave(shift, blockedDates) {
    return hasPerson(shift.person) && blockedDates.some(block => block && block.person === shift.person && block.date === shift.date);
  }

  function overlapMessage(shift, other, personName, internal = false) {
    return personLabel(shift.person, personName) + (internal
      ? ' får overlappende vagter ' + shift.start + '–' + shift.end + ' og ' + other.start + '–' + other.end
      : ' har allerede en vagt ' + other.start + '–' + other.end)
      + ' den ' + dayLabel(shift.date) + '.';
  }

  function planGroup(options = {}) {
    const {members, start, end, personName} = options;
    const existing = Array.isArray(options.existing) ? options.existing : [];
    const blockedDates = Array.isArray(options.blockedDates) ? options.blockedDates : [];
    const issues = [], seenIssues = new Set();
    const addIssue = (id, code, message, detail = '') => {
      const key = JSON.stringify([id, code, detail]);
      if (!seenIssues.has(key)) { seenIssues.add(key); issues.push({id, code, message}); }
    };
    const finish = (proposed = [], changed = false) => ({
      ok: issues.length === 0, changed, proposed, issues,
      error: issues.length ? issues[0].message + (issues.length > 1 ? ' Der er desuden ' + (issues.length - 1) + (issues.length === 2 ? ' andet problem.' : ' andre problemer.') : '') : null
    });
    if (!Array.isArray(members) || !members.length) {
      addIssue(null, 'empty', 'Tidsgruppen indeholder ingen vagter.'); return finish();
    }
    if (!validTime(start) || !validTime(end)) {
      addIssue(null, 'time', 'Vælg gyldige tidspunkter i formatet TT:MM.'); return finish();
    }
    if (end <= start) {
      addIssue(null, 'time', 'Sluttidspunktet skal være efter starttidspunktet samme dag.'); return finish();
    }
    const currentById = new Map(existing.filter(Boolean).map(shift => [shift.id, shift]));
    const memberIds = new Set();
    const proposed = [];
    members.forEach(member => {
      const id = member?.id ?? null;
      if (!member || typeof member !== 'object' || !id || memberIds.has(id)) {
        addIssue(id, 'members', 'Tidsgruppen indeholder en ugyldig eller gentaget vagt.'); return;
      }
      memberIds.add(id);
      if (!validDate(member.date)) {
        addIssue(id, 'date', 'En vagt har en ugyldig dato. Åbn tidsgruppen igen.'); return;
      }
      if (member.noteRich != null && typeof member.noteRich !== 'string') {
        addIssue(id, 'description', 'Den formaterede beskrivelse er ugyldig. Åbn vagten igen.'); return;
      }
      if (!sameSnapshot(member, currentById.get(id))) {
        const subject = hasPerson(member.person) ? 'Vagten for ' + personLabel(member.person, personName) : 'Den ledige vagt';
        addIssue(id, 'stale', subject + ' er ændret eller slettet. Åbn tidsgruppen igen.');
      }
      const next={...member,start,end};
      if(!Engine.validPlannedBreak(next))addIssue(id,'break','Den planlagte pause skal være kortere end det nye tidsrum og et ikke-negativt helt antal minutter.');
      proposed.push(next);
    });
    const changed = members.some(member => member && typeof member === 'object' && (member.start !== start || member.end !== end));
    if (issues.length) return finish(proposed, changed);
    proposed.forEach(shift => {
      if (onLeave(shift, blockedDates)) addIssue(shift.id, 'leave', personLabel(shift.person, personName) + ' har godkendt fravær den ' + dayLabel(shift.date) + '.');
    });
    Engine.conflicts(proposed, existing, [...memberIds]).forEach(({shift, other}) => {
      addIssue(shift.id, 'overlap', overlapMessage(shift, other, personName), other.id);
    });
    Engine.conflicts(proposed, proposed).forEach(({shift, other}) => {
      addIssue(shift.id, 'overlap', overlapMessage(shift, other, personName, true), other.id);
    });
    return finish(proposed, changed);
  }

  function planMove(options = {}) {
    const {shift, current, targetDate, minDate, maxDate, personName} = options;
    const blocked = reason => ({allowed:false, status:'blocked', reason, proposed:null});
    if (!validDate(targetDate)) return blocked('Vælg en gyldig dato i formatet ÅÅÅÅ-MM-DD.');
    if ((minDate !== undefined && !validDate(minDate)) || (maxDate !== undefined && !validDate(maxDate)) || (minDate && maxDate && minDate > maxDate)) return blocked('Kalenderens planlægningsperiode er ugyldig.');
    if ((minDate && targetDate < minDate) || (maxDate && targetDate > maxDate)) return blocked('Vælg en dag inden for kalenderens planlægningsperiode.');
    if ((shift?.noteRich != null && typeof shift.noteRich !== 'string') || (current?.noteRich != null && typeof current.noteRich !== 'string')) return blocked('Den formaterede beskrivelse er ugyldig. Åbn vagten igen.');
    if (!sameSnapshot(shift, current)) return blocked('Vagten er ændret eller slettet. Vælg den igen i kalenderen.');
    if (targetDate === current.date) return {allowed:false, status:'same', reason:'Vagten ligger allerede på denne dato.', proposed:null};
    if (!validTime(current.start) || !validTime(current.end) || current.end <= current.start) return blocked('Vagten har ugyldige tidspunkter. Åbn vagten igen.');
    if(!Engine.validPlannedBreak(current))return blocked('Vagtens planlagte pause er ugyldig. Åbn vagten igen.');
    const proposed = {...current, date:targetDate};
    const blockedDates = Array.isArray(options.blockedDates) ? options.blockedDates : [];
    if (onLeave(proposed, blockedDates)) return blocked(personLabel(proposed.person, personName) + ' har godkendt fravær den ' + dayLabel(targetDate) + '.');
    const existing = Array.isArray(options.existing) ? options.existing : [];
    const conflicts = Engine.conflicts([proposed], existing, [proposed.id]);
    if (conflicts.length) return blocked(overlapMessage(proposed, conflicts[0].other, personName));
    return {allowed:true, status:'allowed', reason:'Flyt til ' + dayLabel(targetDate) + '.', proposed};
  }

  const api = Object.freeze({validDate, planGroup, planMove});
  globalThis.CleanRoomsActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
