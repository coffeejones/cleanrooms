/* Read-only, Monday-first monthly planning model for one employee profile. */
(() => {
  'use strict';

  const MONTHS=['Januar','Februar','Marts','April','Maj','Juni','Juli','August','September','Oktober','November','December'];
  const optionalText=new Set(['note','noteRich','seriesId']);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const compare=(left,right)=>left<right?-1:left>right?1:0;
  const order=(left,right)=>compare(left.date,right.date)||compare(left.start,right.start)||compare(left.end,right.end)||compare(left.id,right.id);
  const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const engine=()=>globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);

  function parseDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [year,month,day]=value.split('-').map(Number),date=new Date(0);
    if(year<1||month<1||month>12||day<1||day>31)return null;
    date.setUTCHours(12,0,0,0);date.setUTCFullYear(year,month-1,day);
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:null;
  }
  function iso(date){
    if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1||date.getUTCFullYear()>9999)throw new RangeError('Måneden ligger uden for kalenderens understøttede datoer.');
    return date.toISOString().slice(0,10);
  }
  const addDays=(date,count)=>{const result=new Date(date);result.setUTCDate(result.getUTCDate()+count);return result;};
  const mondayOffset=date=>(date.getUTCDay()+6)%7;
  function same(left,right){
    if(left===right)return true;
    if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>same(value,right[index]));
    if(!record(left)||!record(right))return false;
    const keys=new Set([...Object.keys(left),...Object.keys(right)]);
    return [...keys].every(key=>same(key==='plannedBreakMinutes'?left[key]??0:optionalText.has(key)?left[key]??'':left[key],key==='plannedBreakMinutes'?right[key]??0:optionalText.has(key)?right[key]??'':right[key]));
  }
  function adjacentMonth(first,delta){
    const date=new Date(first);date.setUTCMonth(date.getUTCMonth()+delta);
    return date.getUTCFullYear()<1||date.getUTCFullYear()>9999?null:iso(date).slice(0,7);
  }

  function build({person,month,today,shifts=[],sites}={}){
    if(!record(person)||typeof person.id!=='string'||!person.id||person.id!==person.id.trim())throw new TypeError('Vælg en medarbejder med et gyldigt id.');
    if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||!parseDate(month+'-01'))throw new TypeError('Vælg en gyldig måned i formatet ÅÅÅÅ-MM.');
    if(!parseDate(today))throw new TypeError('Dags dato skal være en gyldig dato i formatet ÅÅÅÅ-MM-DD.');
    if(!Array.isArray(shifts)||sites!==undefined&&!Array.isArray(sites))throw new TypeError('Vagter og arbejdssteder skal være gyldige lister.');
    const first=parseDate(month+'-01'),last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1,0);
    const gridFirst=addDays(first,-mondayOffset(first)),gridLast=addDays(last,6-mondayOffset(last));
    const from=iso(gridFirst),to=iso(gridLast),occurrences=new Map();
    for(const shift of shifts){
      if(!record(shift)||typeof shift.id!=='string'||!shift.id||shift.id!==shift.id.trim()||typeof shift.person!=='string'
        ||!parseDate(shift.date)||!Number.isInteger(shift.site)||shift.site<0||!validTime(shift.start)||!validTime(shift.end)||shift.end===shift.start
        ||!engine().validPlannedBreak(shift)
        ||['note','noteRich','seriesId'].some(key=>shift[key]!=null&&typeof shift[key]!=='string'))throw new TypeError('En vagt har ugyldigt id, medarbejder, arbejdssted, dato, klokkeslæt, planlagt pause eller beskrivelse.');
      const previous=occurrences.get(shift.id);
      if(previous&&!same(previous,shift))throw new TypeError('Samme vagt-id forekommer med forskellige oplysninger. Hent planen igen.');
      if(!previous)occurrences.set(shift.id,shift);
    }
    const selected=[...occurrences.values()].filter(shift=>shift.person===person.id&&engine().shiftDates(shift).some(day=>day>=from&&day<=to)).sort(order).map(clone);
    const dates=[];
    for(let day=gridFirst;day<=gridLast;day=addDays(day,1)){
      const date=iso(day);dates.push({date,inMonth:date.slice(0,7)===month,isToday:date===today,shifts:[],minutes:0});
    }
    const byDate=Object.fromEntries(dates.map(day=>[day.date,day]));
    for(const shift of selected)for(const workedDay of engine().shiftDates(shift)){const day=byDate[workedDay];if(day){day.shifts.push(shift);day.minutes+=engine().plannedMinutesInRange(shift,workedDay,workedDay);}}
    const weeks=[];for(let index=0;index<dates.length;index+=7)weeks.push(dates.slice(index,index+7));
    const monthly=selected.filter(shift=>engine().shiftDates(shift).some(day=>day.slice(0,7)===month)),monthDays=dates.filter(day=>day.inMonth);
    return {month,from,to,label:MONTHS[first.getUTCMonth()]+' '+first.getUTCFullYear(),weeks,shifts:monthly,
      totalMinutes:monthDays.reduce((total,day)=>total+day.minutes,0),shiftCount:monthly.length,workingDays:monthDays.filter(day=>day.shifts.length).length,
      byDate,previousMonth:adjacentMonth(first,-1),nextMonth:adjacentMonth(first,1)};
  }

  const api=Object.freeze({build});globalThis.CleanRoomsEmployeeProfileCalendar=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
