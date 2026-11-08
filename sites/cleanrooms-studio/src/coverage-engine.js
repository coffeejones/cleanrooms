/* Recurring staffing demand and coverage over actual assignment boundaries. */
(() => {
  'use strict';

  const Actions = globalThis.CleanRoomsActions || (typeof require === 'function' ? require('./schedule-actions.js') : null);
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const validTime = value => typeof value === 'string' && TIME.test(value);
  const validId = value => typeof value === 'string' && value.trim() !== '';
  const validSite = value => Number.isInteger(value) && value >= 0 && value < 2000;
  const assigned = value => typeof value === 'string' && value.trim() !== '';
  const minute = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3));
  const time = value => String(Math.floor(value / 60)).padStart(2,'0') + ':' + String(value % 60).padStart(2,'0');
  const dayDate = value => new Date(value + 'T12:00:00Z');
  function addDays(value, count) { const date = dayDate(value); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0,10); }
  const emptyTotals = () => ({requiredMinutes:0,coveredMinutes:0,deficitMinutes:0,missingSlots:0,slotCount:0});

  function defaultRules() {
    return [
      {id:'nord-weekdays',site:0,weekdays:[0,1,2,3,4],start:'08:00',end:'15:00',required:7},
      {id:'klinik-weekdays',site:1,weekdays:[0,1,3,4],start:'07:00',end:'13:00',required:6},
      {id:'klinik-wednesday',site:1,weekdays:[2],start:'07:00',end:'13:00',required:7},
      {id:'havn-weekdays',site:2,weekdays:[0,1,2,3,4],start:'08:00',end:'14:00',required:7},
      {id:'havn-saturday',site:2,weekdays:[5],start:'09:00',end:'13:00',required:1}
    ];
  }

  function validateRule(rule) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ['Bemandingsreglen mangler.'];
    const errors = [];
    if (!validId(rule.id)) errors.push('Bemandingsreglen skal have et id.');
    if (!validSite(rule.site)) errors.push('Vælg et gyldigt arbejdssted.');
    if (!Array.isArray(rule.weekdays) || !rule.weekdays.length) errors.push('Vælg mindst én ugedag.');
    else if (rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(rule.weekdays).size !== rule.weekdays.length) errors.push('Vælg hver ugedag højst én gang, fra 0 (mandag) til 6 (søndag).');
    if (!validTime(rule.start) || !validTime(rule.end)) errors.push('Vælg gyldige tidspunkter i formatet TT:MM.');
    else if (rule.end <= rule.start) errors.push('Sluttidspunktet skal være efter starttidspunktet samme dag.');
    if (!Number.isInteger(rule.required) || rule.required < 1 || rule.required > 30) errors.push('Bemandingsbehovet skal være et helt tal fra 1 til 30.');
    return errors;
  }

  function expand(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return {valid:false,errors:['Bemandingsperioden mangler.'],slots:[]};
    const {rules, from, to} = options, errors = [];
    if (!Array.isArray(rules)) errors.push('Bemandingsreglerne skal være en liste.');
    else rules.forEach(rule => errors.push(...validateRule(rule)));
    if (!Actions.validDate(from) || !Actions.validDate(to)) errors.push('Vælg gyldige start- og slutdatoer i formatet ÅÅÅÅ-MM-DD.');
    else {
      const length = (dayDate(to) - dayDate(from)) / 86400000 + 1;
      if (length < 1 || length > 366) errors.push('Vælg en periode på 1 til 366 kalenderdage.');
    }
    if (errors.length) return {valid:false,errors,slots:[]};
    const ids = new Set();
    rules.forEach(rule => {
      if (ids.has(rule.id)) errors.push('Regel-id ' + rule.id + ' bruges flere gange.');
      ids.add(rule.id);
    });
    for (let left = 0; left < rules.length; left += 1) {
      for (let right = left + 1; right < rules.length; right += 1) {
        const a = rules[left], b = rules[right];
        if (a.site === b.site && a.start < b.end && b.start < a.end && a.weekdays.some(day => b.weekdays.includes(day))) errors.push('Bemandingsreglerne ' + a.id + ' og ' + b.id + ' overlapper på samme arbejdssted.');
      }
    }
    if (errors.length) return {valid:false,errors,slots:[]};
    const slots = [];
    for (let date = from; date <= to;) {
      const weekday = (dayDate(date).getUTCDay() + 6) % 7;
      rules.forEach(rule => {
        if (rule.weekdays.includes(weekday)) slots.push({id:rule.id + '@' + date,ruleId:rule.id,date,site:rule.site,start:rule.start,end:rule.end,required:rule.required});
      });
      if (date === to) break;
      date = addDays(date,1);
    }
    slots.sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.site - b.site || a.id.localeCompare(b.id));
    return {valid:true,errors:[],slots};
  }

  function coverage(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return {valid:false,errors:['Bemandingsperioden mangler.'],slots:[],totals:emptyTotals()};
    const expanded = expand(options);
    const invalid = errors => ({valid:false,errors,slots:[],totals:emptyTotals()});
    if (!expanded.valid) return invalid(expanded.errors);
    const {shifts} = options, blockedDates = options.blockedDates ?? [];
    if (!Array.isArray(shifts) || !Array.isArray(blockedDates)) return invalid(['Vagter og godkendt fravær skal være lister.']);
    const validShift = shift => shift && typeof shift === 'object' && !Array.isArray(shift) && validId(shift.id)
      && Actions.validDate(shift.date) && validSite(shift.site) && validTime(shift.start) && validTime(shift.end) && shift.end > shift.start
      && (shift.person === null || shift.person === undefined || typeof shift.person === 'string');
    if (shifts.some(shift => !validShift(shift))) return invalid(['En vagt har ugyldige oplysninger. Dækningen kan ikke beregnes.']);
    if (blockedDates.some(item => !item || !assigned(item.person) || !Actions.validDate(item.date))) return invalid(['Godkendt fravær indeholder en ugyldig medarbejder eller dato.']);
    const unique = new Map();
    for (const shift of shifts) {
      const previous = unique.get(shift.id);
      if (previous && ['date','person','site','start','end'].some(field => previous[field] !== shift[field])) return invalid(['En vagt har flere forskellige versioner med samme id.']);
      unique.set(shift.id,shift);
    }
    const assignedByDay = new Map(), leaveByDay = new Map();
    [...unique.values()].filter(shift => assigned(shift.person)).forEach(shift => {
      const rows = assignedByDay.get(shift.date) || []; rows.push(shift); assignedByDay.set(shift.date,rows);
    });
    blockedDates.forEach(item => { const people = leaveByDay.get(item.date) || new Set(); people.add(item.person); leaveByDay.set(item.date,people); });
    const slots = expanded.slots.map(slot => {
      const start = minute(slot.start), end = minute(slot.end);
      const dayShifts = (assignedByDay.get(slot.date) || []).filter(shift => minute(shift.start) < end && minute(shift.end) > start);
      const onsitePeople = new Set(dayShifts.filter(shift => shift.site === slot.site).map(shift => shift.person));
      const relevant = dayShifts.filter(shift => shift.site === slot.site || onsitePeople.has(shift.person));
      const boundaries = new Set([start,end]);
      relevant.forEach(shift => { boundaries.add(Math.max(start,minute(shift.start))); boundaries.add(Math.min(end,minute(shift.end))); });
      const points = [...boundaries].sort((a,b) => a-b), segments = [], deficits = [];
      let filled = Infinity, missing = 0, deficitMinutes = 0;
      for (let index = 0; index < points.length - 1; index += 1) {
        const first = points[index], last = points[index + 1], activeSites = new Map();
        relevant.filter(shift => minute(shift.start) < last && minute(shift.end) > first).forEach(shift => {
          const sites = activeSites.get(shift.person) || new Set(); sites.add(shift.site); activeSites.set(shift.person,sites);
        });
        const people = [...activeSites].filter(([person,sites]) => sites.has(slot.site) && sites.size === 1 && !leaveByDay.get(slot.date)?.has(person)).map(([person]) => person).sort();
        const covered = people.length, gap = Math.max(0,slot.required - covered);
        segments.push({start:time(first),end:time(last),covered,missing:gap,people});
        filled = Math.min(filled,covered); missing = Math.max(missing,gap); deficitMinutes += gap * (last - first);
        if (gap) {
          const previous = deficits.at(-1);
          if (previous && previous.end === time(first) && previous.missing === gap) previous.end = time(last);
          else deficits.push({start:time(first),end:time(last),missing:gap,filled:covered});
        }
      }
      return {...slot,filled,missing,deficitMinutes,covered:missing === 0,segments,deficits};
    });
    const totals = emptyTotals();
    slots.forEach(slot => {
      const required = slot.required * (minute(slot.end) - minute(slot.start));
      totals.requiredMinutes += required; totals.deficitMinutes += slot.deficitMinutes; totals.coveredMinutes += required - slot.deficitMinutes;
      if (!slot.covered) totals.missingSlots += 1;
    });
    totals.slotCount = slots.length;
    return {valid:true,errors:[],slots,totals};
  }

  const api = Object.freeze({defaultRules,validateRule,expand,coverage});
  globalThis.CleanRoomsCoverage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
