/* Availability and weekly minute totals for a complete proposed assignment. */
(() => {
  'use strict';

  const Actions = globalThis.CleanRoomsActions || (typeof require === 'function' ? require('./schedule-actions.js') : null);
  const Engine = globalThis.CleanRoomsSeries || (typeof require === 'function' ? require('./series-engine.js') : null);
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const validId = value => (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value));
  const timeMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const duration = shift => Engine.plannedMinutes(shift);
  const validShift = shift => Boolean(shift && typeof shift === 'object' && validId(shift.id) && Actions.validDate(shift.date)
    && typeof shift.start === 'string' && TIME.test(shift.start) && typeof shift.end === 'string' && TIME.test(shift.end) && shift.end > shift.start&&Engine.validPlannedBreak(shift));

  function addDays(value, count) {
    const date = new Date(value + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + count);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  function monday(value) {
    const date = new Date(value + 'T12:00:00Z');
    return addDays(value, -((date.getUTCDay() + 6) % 7));
  }

  function assess(options = {}) {
    const {person, proposed, existing, weekStart} = options;
    const roundedTarget = typeof person?.target === 'number' && Number.isFinite(person.target) && person.target >= 0 ? Math.round(person.target * 60) : null;
    const targetMinutes = Number.isSafeInteger(roundedTarget) ? roundedTarget : null;
    const weekEnd = Actions.validDate(weekStart) ? addDays(weekStart, 6) : null;
    const base = {
      valid:false, available:false, status:'incomplete', conflicts:[], pendingRequests:[],
      currentMinutes:0, projectedMinutes:0, targetMinutes,
      weekStart:weekStart ?? null, weekEnd:Actions.validDate(weekEnd) ? weekEnd : null,
      weekCount:0, overTargetWeeks:[]
    };
    if (!person || !validId(person.id) || targetMinutes === null || !Actions.validDate(weekStart)
      || monday(weekStart) !== weekStart || !Actions.validDate(weekEnd)
      || !Array.isArray(proposed) || !Array.isArray(existing)) return base;
    const removedIds = options.removedIds ?? [], blockedDates = options.blockedDates ?? [], pendingRequests = options.pendingRequests ?? [];
    if (!Array.isArray(removedIds) || !Array.isArray(blockedDates) || !Array.isArray(pendingRequests)) return base;
    if (removedIds.some(id => !validId(id)) || blockedDates.some(item => !item || !validId(item.person) || !Actions.validDate(item.date))) return base;
    if (proposed.some(shift => !validShift(shift) || shift.person !== person.id) || existing.some(shift => !validShift(shift))) return base;
    const proposalIds = new Set(proposed.map(shift => shift.id));
    if (proposalIds.size !== proposed.length) return base;
    const uniqueExisting = new Map();
    for (const shift of existing) {
      const previous = uniqueExisting.get(shift.id);
      if (previous && ['person','date','site','start','end'].some(field => previous[field] !== shift[field])) return base;
      if(previous&&Engine.plannedBreakMinutes(previous)!==Engine.plannedBreakMinutes(shift))return base;
      uniqueExisting.set(shift.id, shift);
    }
    const original = [...uniqueExisting.values()].filter(shift => shift.person === person.id);
    const excluded = new Set([...removedIds, ...proposalIds]);
    const remaining = original.filter(shift => !excluded.has(shift.id));
    const projected = [...remaining, ...proposed];
    const total = (shifts, from, to) => shifts.filter(shift => shift.date >= from && shift.date <= to).reduce((sum, shift) => sum + duration(shift), 0);
    const weeks = [...new Set(proposed.map(shift => monday(shift.date)))].sort();
    if (weeks.some(first => !Actions.validDate(first) || !Actions.validDate(addDays(first, 6)))) return base;
    const conflicts = [], seen = new Set();
    Engine.conflicts(proposed, remaining).forEach(({shift, other}) => {
      const key = JSON.stringify(['overlap', shift.id, other.id]);
      if (!seen.has(key)) { seen.add(key); conflicts.push({type:'overlap',date:shift.date,shift:{...shift},other:{...other}}); }
    });
    Engine.conflicts(proposed, proposed).forEach(({shift, other}) => {
      const ids = [shift.id,other.id].map(String).sort();
      const key = JSON.stringify(['internal', ...ids]);
      if (!seen.has(key)) { seen.add(key); conflicts.push({type:'internal',date:shift.date,shift:{...shift},other:{...other}}); }
    });
    proposed.forEach(shift => {
      if (blockedDates.some(block => block.person === person.id && block.date === shift.date)) {
        conflicts.push({type:'leave',date:shift.date,shift:{...shift}});
      }
    });
    conflicts.sort((a,b) => a.date.localeCompare(b.date) || a.shift.start.localeCompare(b.shift.start) || String(a.shift.id).localeCompare(String(b.shift.id)) || a.type.localeCompare(b.type));
    const candidateDays = new Set(proposed.map(shift => shift.date));
    const advisories = pendingRequests.filter(request => request && request.person === person.id && candidateDays.has(request.date)).map(request => ({...request}));
    const overTargetWeeks = weeks.map(first => ({weekStart:first,projectedMinutes:total(projected,first,addDays(first,6)),targetMinutes})).filter(week => week.projectedMinutes > targetMinutes);
    const available = proposed.length > 0 && conflicts.length === 0;
    return {
      ...base, valid:true, available, status:!proposed.length ? 'incomplete' : available ? 'available' : 'blocked',
      conflicts, pendingRequests:advisories,
      currentMinutes:total(original,weekStart,weekEnd), projectedMinutes:total(projected,weekStart,weekEnd),
      weekCount:weeks.length, overTargetWeeks
    };
  }

  const api = Object.freeze({assess});
  globalThis.CleanRoomsStaffing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
