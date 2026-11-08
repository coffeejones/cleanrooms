/* Read-only employee planning summaries from already-materialized occurrences. */
(() => {
  'use strict';
  const Engine=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
  const order=(left,right)=>left.date.localeCompare(right.date)||left.start.localeCompare(right.start)||left.end.localeCompare(right.end)||left.id.localeCompare(right.id);
  function build({staff,weekStart,today,weeklyShifts=[],upcomingShifts=[],horizonEnd,nowTime}={}){
    if(!validDate(weekStart)||new Date(weekStart+'T12:00:00Z').getUTCDay()!==1)throw new TypeError('Ugens start skal være en gyldig mandag i formatet ÅÅÅÅ-MM-DD.');
    if(!validDate(today)||!validDate(horizonEnd)||horizonEnd<today)throw new TypeError('Vælg gyldige datoer for i dag og den kommende periode.');
    if(nowTime!==undefined&&!validTime(nowTime))throw new TypeError('Det aktuelle klokkeslæt skal være i formatet TT:MM.');
    if(!Array.isArray(staff)||!Array.isArray(weeklyShifts)||!Array.isArray(upcomingShifts))throw new TypeError('Medarbejdere og vagter skal være gyldige lister.');
    const last=new Date(weekStart+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+6);const lastISO=last.toISOString();
    if(!/^\d{4}-\d{2}-\d{2}T/.test(lastISO))throw new TypeError('Ugen ligger uden for kalenderens understøttede datoer.');
    const weekEnd=lastISO.slice(0,10),ids=new Set();
    const people=staff.map(person=>{
      if(!record(person)||typeof person.id!=='string'||!person.id||person.id!==person.id.trim()||ids.has(person.id))throw new TypeError('Hver medarbejder skal have et entydigt id.');
      if(typeof person.target!=='number'||!Number.isFinite(person.target)||person.target<0||person.target>168)throw new TypeError('Aftalte timer skal være et tal fra 0 til 168.');
      ids.add(person.id);return {id:person.id,plannedMinutes:0,targetMinutes:Math.round(person.target*60),differenceMinutes:0,ratio:0,nextShift:null,upcoming:[],shiftCount:0,overTarget:false};
    });
    const byPerson=Object.fromEntries(people.map(person=>[person.id,person])),occurrences=new Map();
    function collect(shifts){
      const selected=new Set();
      for(const shift of shifts){
        if(!record(shift)||typeof shift.id!=='string'||!shift.id||typeof shift.person!=='string'||!validDate(shift.date)||!validTime(shift.start)||!validTime(shift.end)||shift.end<=shift.start||!Number.isInteger(shift.site)||shift.site<0||!Engine.validPlannedBreak(shift))throw new TypeError('En vagt har ugyldigt id, medarbejder, arbejdssted, dato, klokkeslæt eller planlagt pause.');
        const previous=occurrences.get(shift.id);
        if(previous&&['person','date','site','start','end','note','noteRich','seriesId'].some(field=>(previous[field]??'')!==(shift[field]??'')))throw new TypeError('Samme vagt-id forekommer med forskellige oplysninger. Hent planen igen.');
        if(previous&&Engine.plannedBreakMinutes(previous)!==Engine.plannedBreakMinutes(shift))throw new TypeError('Samme vagt-id forekommer med forskellige planlagte pauser. Hent planen igen.');
        if(!previous)occurrences.set(shift.id,shift);selected.add(shift.id);
      }
      return selected;
    }
    const weeklyIds=collect(weeklyShifts),upcomingIds=collect(upcomingShifts);
    for(const id of weeklyIds){
      const shift=occurrences.get(id);if(!shift.person||!Object.hasOwn(byPerson,shift.person)||shift.date<weekStart||shift.date>weekEnd)continue;
      const person=byPerson[shift.person];person.plannedMinutes+=Engine.plannedMinutes(shift);person.shiftCount++;
    }
    const future=new Map(people.map(person=>[person.id,[]]));
    for(const id of upcomingIds){
      const shift=occurrences.get(id);if(!shift.person||!future.has(shift.person)||shift.date<today||shift.date>horizonEnd||nowTime!==undefined&&shift.date===today&&shift.end<=nowTime)continue;
      future.get(shift.person).push(shift);
    }
    for(const person of people){
      person.differenceMinutes=person.plannedMinutes-person.targetMinutes;person.overTarget=person.differenceMinutes>0;
      person.ratio=person.targetMinutes>0?Math.min(1,person.plannedMinutes/person.targetMinutes):person.plannedMinutes>0?1:0;
      person.upcoming=future.get(person.id).sort(order).slice(0,3).map(clone);person.nextShift=person.upcoming.length?clone(person.upcoming[0]):null;
    }
    return {weekStart,weekEnd,horizonEnd,people,byPerson};
  }
  const api=Object.freeze({build});globalThis.CleanRoomsRosterPlanning=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
