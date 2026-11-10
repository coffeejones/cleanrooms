/* Calendar arithmetic and overlap checks shared by the CleanRooms demo. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);

  const DAY = 86400000;
  const MAX_DAYS = 366;
  const OPEN_END = '2100-12-31';
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const plannedBreakMinutes = shift => shift?.plannedBreakMinutes === undefined ? 0 : shift.plannedBreakMinutes;
  const grossMinutes = shift => {if(!validTime(shift?.start)||!validTime(shift?.end))return NaN;const difference=Number(shift.end.slice(0,2))*60+Number(shift.end.slice(3))-Number(shift.start.slice(0,2))*60-Number(shift.start.slice(3));return difference<0?difference+1440:difference;};
  const validPlannedBreak = shift => Number.isSafeInteger(plannedBreakMinutes(shift))&&plannedBreakMinutes(shift)>=0&&plannedBreakMinutes(shift)<grossMinutes(shift);
  const plannedMinutes = shift => validPlannedBreak(shift)?grossMinutes(shift)-plannedBreakMinutes(shift):NaN;
  const present = value => value !== null && value !== undefined && String(value).trim() !== '';
  const plainObject=value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const prototype=Object.getPrototypeOf(value);
    return prototype===null||Object.getPrototypeOf(prototype)===null&&typeof prototype.constructor==='function'&&prototype.constructor.name==='Object';
  };

  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const result = new Date(0);
    result.setUTCHours(0, 0, 0, 0);
    result.setUTCFullYear(year, month - 1, day);
    return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day ? result : null;
  }

  function iso(date) { return date.toISOString().slice(0, 10); }

  function addMonths(value, count) {
    const date = parseDate(value);
    if (!date) throw new TypeError('Vælg en gyldig dato i formatet ÅÅÅÅ-MM-DD.');
    if (!Number.isInteger(count)) throw new TypeError('Antallet af måneder skal være et helt tal.');
    const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + count;
    const year = Math.floor(monthIndex / 12), month = ((monthIndex % 12) + 12) % 12;
    if (year < 1 || year > 9999) throw new RangeError('Datoen ligger uden for det understøttede kalenderinterval.');
    const lastDay = new Date(0);
    lastDay.setUTCFullYear(year, month + 1, 0);
    date.setUTCDate(1);
    date.setUTCFullYear(year, month, Math.min(Number(value.slice(-2)), lastDay.getUTCDate()));
    return iso(date);
  }

  function validate(series) {
    if (!series || typeof series !== 'object' || Array.isArray(series)) return ['Vagtserien mangler.'];
    const errors = [];
    if (!present(series.id)) errors.push('Vagtserien skal have et id.');
    if (!present(series.person)) errors.push('Vælg en medarbejder.');
    if (!present(series.site)) errors.push('Vælg et arbejdssted.');
    if (series.noteRich != null && typeof series.noteRich !== 'string') errors.push('Den formaterede beskrivelse skal være tekst.');
    if(series.groupId!==undefined&&(typeof series.groupId!=='string'||series.groupId.length>160||!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(series.groupId)))errors.push('Aftalens id skal være en stabil tekst på højst 160 tegn uden mellemrum.');
    const startDate = parseDate(series.startDate), endDate = parseDate(series.endDate);
    if (!startDate) errors.push('Vælg en gyldig startdato i formatet ÅÅÅÅ-MM-DD.');
    if (!endDate) errors.push('Vælg en gyldig slutdato i formatet ÅÅÅÅ-MM-DD.');
    if (startDate && endDate) {
      const days = (endDate - startDate) / DAY + 1;
      if (days < 1) errors.push('Slutdatoen skal være på eller efter startdatoen.');
    }
    if(series.openEnded!==undefined&&typeof series.openEnded!=='boolean')errors.push('Vælg om vagtserien skal have en slutdato.');
    if(series.openEnded===true&&series.endDate!==OPEN_END)errors.push('En vagtserie uden slutdato skal bruge kalenderens åbne slutgrænse.');
    if (!Array.isArray(series.weekdays) || !series.weekdays.length) errors.push('Vælg mindst én ugedag.');
    else if (series.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) errors.push('Ugedage skal være heltal fra 0 (mandag) til 6 (søndag).');
    if (!validTime(series.start)) errors.push('Vælg et gyldigt starttidspunkt i formatet TT:MM.');
    if (!validTime(series.end)) errors.push('Vælg et gyldigt sluttidspunkt i formatet TT:MM.');
    if (validTime(series.start) && validTime(series.end) && series.end === series.start) errors.push('Start og slut skal være forskellige; vagten må være kortere end 24 timer.');
    if(validTime(series.start)&&validTime(series.end)&&!validPlannedBreak(series))errors.push('Den planlagte pause skal være et helt antal minutter fra 0 og kortere end vagten.');
    if(series.dayTimes!==undefined){
      if(!plainObject(series.dayTimes)||Object.getOwnPropertySymbols(series.dayTimes).length)errors.push('Ugedagenes tider skal være en gyldig liste over valgte ugedage.');
      else{
        const selected=new Set(Array.isArray(series.weekdays)?series.weekdays:[]);
        for(const [key,times]of Object.entries(series.dayTimes)){
          if(!/^[0-6]$/.test(key)||!selected.has(Number(key)))errors.push('Særlige tider må kun angives for valgte ugedage fra 0 til 6.');
          if(!plainObject(times)||Object.keys(times).some(key=>!['start','end','plannedBreakMinutes'].includes(key))||!Object.hasOwn(times,'start')||!Object.hasOwn(times,'end')||Object.getOwnPropertySymbols(times).length){errors.push('Hver ugedag skal have start, slut og eventuelt en planlagt pause.');continue;}
          if(!validTime(times.start)||!validTime(times.end))errors.push('Ugedagens tider skal være gyldige tidspunkter i formatet TT:MM.');
          else if(times.end===times.start)errors.push('Ugedagens start og slut skal være forskellige; vagten må være kortere end 24 timer.');
          if(validTime(times.start)&&validTime(times.end)&&!validPlannedBreak({...times,plannedBreakMinutes:times.plannedBreakMinutes===undefined?plannedBreakMinutes(series):times.plannedBreakMinutes}))errors.push('Ugedagens planlagte pause skal være et helt antal minutter fra 0 og kortere end vagten.');
        }
      }
    }
    return errors;
  }

  const isOpenEnded=series=>series?.openEnded===true&&series.endDate===OPEN_END;
  const requiresRange=series=>isOpenEnded(series)||Boolean(parseDate(series?.startDate)&&parseDate(series?.endDate)&&(parseDate(series.endDate)-parseDate(series.startDate))/DAY>=MAX_DAYS);
  // Long agreements are templates; callers expand only a bounded working window.
  function operationRange(series,{from,to,today}={}){
    if(!parseDate(series?.startDate)||!parseDate(series?.endDate)||series.startDate>series.endDate||series.openEnded!==undefined&&typeof series.openEnded!=='boolean'||series.openEnded===true&&series.endDate!==OPEN_END)throw new RangeError('Vælg en gyldig periode til vagtserien.');
    if(from===undefined)from=requiresRange(series)?[series.startDate,today||series.startDate].sort().at(-1):series.startDate;
    if(!parseDate(from)||today!==undefined&&!parseDate(today))throw new TypeError('Vælg en gyldig dato til seriens arbejdsperiode.');
    if(to===undefined){
      if(!requiresRange(series))to=series.endDate;
      else{let horizon;try{horizon=addMonths(from,6);}catch{horizon=series.endDate;}to=horizon<series.endDate?horizon:series.endDate;if(to<from)to=from;}
    }
    if(!parseDate(to)||from>to)throw new TypeError('Vælg en gyldig afgrænset arbejdsperiode.');
    if((parseDate(to)-parseDate(from))/DAY>=MAX_DAYS)throw new RangeError('Vælg højst 366 kalenderdage ad gangen.');
    return {from,to};
  }
  function occursOn(series,day){
    const value=parseDate(day);return Boolean(value&&day>=series.startDate&&day<=series.endDate&&series.weekdays.includes((value.getUTCDay()+6)%7));
  }

  function enumerate(series, options = {}) {
    const errors = validate(series);
    if (errors.length) throw new RangeError(errors.join(' '));
    if(requiresRange(series)&&(options.from===undefined||options.to===undefined))throw new RangeError('En lang eller åben vagtserie kræver en afgrænset periode på højst 366 dage.');
    const from = options.from === undefined ? series.startDate : options.from;
    const to = options.to === undefined ? series.endDate : options.to;
    if (!parseDate(from) || !parseDate(to)) throw new TypeError('Afgrænsningen skal indeholde gyldige datoer i formatet ÅÅÅÅ-MM-DD.');
    if (from > to) throw new RangeError('Afgrænsningens slutdato skal være på eller efter startdatoen.');
    if((parseDate(to)-parseDate(from))/DAY>=MAX_DAYS)throw new RangeError('Vælg højst 366 kalenderdage ad gangen.');
    const first = from > series.startDate ? from : series.startDate;
    const last = to < series.endDate ? to : series.endDate;
    const weekdays = new Set(series.weekdays), shifts = [], lastTime = parseDate(last).getTime();
    for (let date = parseDate(first); date.getTime() <= lastTime; date.setUTCDate(date.getUTCDate() + 1)) {
      const weekday=(date.getUTCDay()+6)%7;
      if (!weekdays.has(weekday)) continue;
      const day = iso(date);
      const times=series.dayTimes&&Object.hasOwn(series.dayTimes,String(weekday))?series.dayTimes[weekday]:series;
      if (shifts.length >= MAX_DAYS) throw new RangeError('En vagtserie må højst indeholde 366 vagter.');
      const pause=times.plannedBreakMinutes===undefined?plannedBreakMinutes(series):times.plannedBreakMinutes;
      shifts.push({id: `${series.id}@${day}`, seriesId: series.id, person: series.person, site: series.site, date: day, start: times.start, end: times.end,...(pause>0?{plannedBreakMinutes:pause}:{}),...(Instructions?.isDeferred(series)?{_instructions:Instructions.metadata(series)}:{note:series.note??'',...(series.noteRich?{noteRich:series.noteRich}:{})})});
    }
    return shifts;
  }

  // Planning intervals use Copenhagen wall-clock dates. Actual attendance keeps
  // its separately resolved UTC instants, including DST transitions.
  function shiftInterval(shift){
    const day=parseDate(shift?.date),gross=grossMinutes(shift);
    if(!day||!Number.isFinite(gross)||gross<=0||gross>=1440)return null;
    const start=day.getTime()+(Number(shift.start.slice(0,2))*60+Number(shift.start.slice(3)))*60000;
    const end=start+gross*60000;
    if(!parseDate(iso(new Date(end))))return null;
    return {start,end};
  }
  function shiftEndDate(shift){const interval=shiftInterval(shift);return interval?iso(new Date(interval.end)):null;}
  function shiftDates(shift){
    const interval=shiftInterval(shift);if(!interval)return [];
    const result=[shift.date],last=iso(new Date(interval.end-1));if(last!==shift.date)result.push(last);return result;
  }
  function plannedMinutesInRange(shift,from,to){
    const interval=shiftInterval(shift),first=parseDate(from),last=parseDate(to);
    if(!interval||!first||!last||from>to||!validPlannedBreak(shift))return NaN;
    return Math.max(0,Math.min(interval.end-plannedBreakMinutes(shift)*60000,last.getTime()+DAY)-Math.max(interval.start,first.getTime()))/60000;
  }
  function conflicts(proposed, existing, excludeIds = []) {
    const excluded = new Set(excludeIds);
    const order = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)) || String(a.id).localeCompare(String(b.id));
    const candidates = (Array.isArray(proposed) ? proposed : [proposed]).filter(Boolean).slice().sort(order);
    const others = (Array.isArray(existing) ? existing : []).filter(shift => shift && !excluded.has(shift.id)).slice().sort(order);
    const byPerson = new Map();
    for (const other of others) {
      if(!present(other.person)||!shiftInterval(other))continue;
      let byDate=byPerson.get(other.person);if(!byDate)byPerson.set(other.person,byDate=new Map());
      for(const date of shiftDates(other)){let day=byDate.get(date);if(!day)byDate.set(date,day=[]);day.push(other);}
    }
    const result = [];
    for (const shift of candidates) {
      const interval=shiftInterval(shift);if(!present(shift.person)||!interval)continue;
      const checked=new Set();
      for(const date of shiftDates(shift))for(const other of byPerson.get(shift.person)?.get(date)||[]){
        if(checked.has(other)||other.person!==shift.person||(present(shift.id)&&shift.id===other.id))continue;checked.add(other);
        const span=shiftInterval(other);
        if(interval.start<span.end&&span.start<interval.end)result.push({shift,other,type:'overlap'});
      }
    }
    return result;
  }

  function occurrenceAnchor(id,seriesId) {
    if(typeof id!=='string'||typeof seriesId!=='string'||!id.startsWith(seriesId+'@'))return null;
    const day=id.slice(seriesId.length+1);return parseDate(day)?day:null;
  }
  function exceptionPreview({source,scope='all',cutoff,edits={},deleted=[]}={}) {
    if(validate(source).length)throw new TypeError('Vælg en gyldig vagtserie.');
    if(!['all','future'].includes(scope))throw new TypeError('Vælg hele serien eller kommende vagter.');
    if(scope==='future'&&(!parseDate(cutoff)||cutoff<source.startDate||cutoff>source.endDate))throw new TypeError('Vælg en gyldig forekomst som start for kommende vagter.');
    if(!edits||typeof edits!=='object'||Array.isArray(edits)||!Array.isArray(deleted))throw new TypeError('Seriens manuelle ændringer er ugyldige.');
    const affected=id=>{const anchor=occurrenceAnchor(id,source.id);return anchor&&(scope==='all'||anchor>=cutoff);};
    const edited=Object.keys(edits).filter(affected).sort(),removed=[...new Set(deleted.filter(affected))].sort();
    const ids=[...new Set([...edited,...removed])].sort();
    return {count:ids.length,edited:edited.length,deleted:removed.length,ids};
  }
  function preserveExceptions(options={}) {
    const preview=exceptionPreview(options),{source,replacement,edits={},deleted=[]}=options;
    if(validate(replacement).length)throw new TypeError('Vælg en gyldig erstatningsserie.');
    const nextEdits=JSON.parse(JSON.stringify(edits)),nextDeleted=new Set(deleted);
    const preservedIds=[],detachedIds=[],removedIds=[],remappedIds=[];
    for(const id of preview.ids){
      const anchor=occurrenceAnchor(id,source.id),nextId=occursOn(replacement,anchor)?replacement.id+'@'+anchor:id;
      if(nextId!==id&&(Object.hasOwn(edits,nextId)||nextDeleted.has(nextId)))throw new RangeError('En manuel ændring på erstatningsserien har allerede samme forekomst.');
      if(Object.hasOwn(edits,id)){
        const shift=nextEdits[id];
        if(!shift||typeof shift!=='object'||Array.isArray(shift)||shift.id!==id||!parseDate(shift.date))throw new TypeError('En manuel ændring i serien er ugyldig.');
        delete nextEdits[id];
        if(occursOn(replacement,anchor))nextEdits[nextId]={...shift,id:nextId,seriesId:replacement.id};
        else{const {seriesId,...standalone}=shift;nextEdits[nextId]=standalone;detachedIds.push(nextId);}
      }
      if(nextDeleted.delete(id))nextDeleted.add(nextId);
      if(nextId!==id){removedIds.push(id);remappedIds.push({from:id,to:nextId});}
      preservedIds.push(nextId);
    }
    return {edits:nextEdits,deleted:[...nextDeleted],preservedIds,detachedIds,removedIds,remappedIds,preview};
  }

  const api = Object.freeze({addMonths, enumerate, validate, conflicts,isOpenEnded,requiresRange,operationRange,occursOn,OPEN_END,occurrenceAnchor,exceptionPreview,preserveExceptions,plannedBreakMinutes,validPlannedBreak,plannedMinutes,shiftEndDate,shiftInterval,shiftDates,plannedMinutesInRange});
  globalThis.CleanRoomsSeries = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
