/* A one-shift preview against the selected area's current weekly budget. */
(() => {
  'use strict';
  const Series=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const Roster=globalThis.CleanRoomsRoster||(typeof require==='function'?require('./roster-model.js'):null);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'));
  function preview({budget,from,to,shifts,before,after,siteIds=null,loaded=false}={}) {
    if(!loaded||!Roster.validWorkHoursBudget(budget)||budget.period!=='week'||!validDate(from)||!validDate(to)||!validDate(after?.date)||after.date<from||after.date>to||!Array.isArray(shifts))return null;
    const sites=siteIds===null?null:new Set(siteIds);
    const included=shift=>Series.shiftDates(shift).some(day=>day>=from&&day<=to)&&(!sites||sites.has(shift.site));
    const minutes=shift=>{
      if(shift?.plannedBreakMinutes!==undefined&&(!Number.isSafeInteger(shift.plannedBreakMinutes)||shift.plannedBreakMinutes<0))return null;
      if(typeof shift?.start!=='string'||typeof shift?.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.end)||shift.end===shift.start)return null;
      const value=Series.plannedMinutesInRange(shift,from,to);
      return Number.isInteger(value)&&value>=0?value:null;
    };
    if(minutes(after)===null)return null;
    const unique=new Map();
    for(const shift of shifts){if(!included(shift))continue;if(!shift.id||unique.has(shift.id))return null;const value=minutes(shift);if(value===null)return null;unique.set(shift.id,{shift,minutes:value});}
    const currentMinutes=[...unique.values()].reduce((sum,item)=>sum+item.minutes,0);
    const removed=before?.id?unique.get(before.id)?.minutes||0:0;
    const added=included(after)?minutes(after):0;
    const deltaMinutes=added-removed,plannedMinutes=currentMinutes+deltaMinutes;
    return {from,to,currentMinutes,plannedMinutes,deltaMinutes,remainingMinutes:budget.hours*60-plannedMinutes};
  }
  const api=Object.freeze({preview});globalThis.CleanRoomsPlanningBudgetImpact=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
