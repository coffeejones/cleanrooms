/* Vagtbaseret bruttoløn. Fixed monthly amounts are disclosed, never charged per shift. */
(() => {
  'use strict';
  const Payroll=globalThis.CleanRoomsPayroll||(typeof require==='function'?require('./payroll-model.js'):null);
  const Groups=globalThis.CleanRoomsPayrollGroups||(typeof require==='function'?require('./payroll-groups-model.js'):null);
  const Range=globalThis.CleanRoomsPublicationRange||(typeof require==='function'?require('./publication-range.js'):null);
  const MAX_WEEKS=8,MAX_SHIFTS=50000,MAX_PEOPLE=5000;
  const add=(day,offset)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
  const monday=day=>add(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
  const sum=(left,right)=>{const value=left+right;if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Lønestimatet er for stort til at kunne beregnes sikkert.');return value;};
  function range(from,to){
    const value=Range.normalize({from,to});
    if(value.from!==from||value.to!==to||Range.countWeeks(from,to)>MAX_WEEKS)throw new TypeError('Vælg højst otte hele uger til lønestimatet.');
    return value;
  }
  function estimate({from,to,shifts=[],people=[],policy=null}={}){
    range(from,to);
    if(!Array.isArray(shifts)||shifts.length>MAX_SHIFTS||!Array.isArray(people)||people.length>MAX_PEOPLE)throw new RangeError('Vælg et mindre område til lønestimatet.');
    const normalized=Groups.normalize(policy),groups=new Map(normalized.groups.map(group=>[group.id,group])),links=new Map(),known=new Map(people.map(person=>[person.personId,person]));
    for(const link of normalized.links){if(!links.has(link.personId))links.set(link.personId,[]);links.get(link.personId).push(link);}
    const weeks=new Map();
    for(let day=from;day<=to;day=add(day,7))weeks.set(day,{from:day,to:add(day,6),totalCents:0,baseCents:0,supplementCents:0,shiftCount:0,minutes:0,missingShiftCount:0,openShiftCount:0,monthlyPersonCount:0,fixedSupplementPersonCount:0,overlapShiftCount:0,complete:true,people:[]});
    const unique=new Map(),batches=new Map(),personWeeks=new Map();
    for(const shift of shifts){
      if(!shift||typeof shift.id!=='string'||!shift.id||typeof shift.person!=='string'||!Range.validDate(shift.date)||!Number.isInteger(shift.site)||shift.site<0
        ||!/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.end)||shift.end<=shift.start)throw new TypeError('En vagt i lønestimatet er ugyldig.');
      const duration=Number(shift.end.slice(0,2))*60+Number(shift.end.slice(3))-Number(shift.start.slice(0,2))*60-Number(shift.start.slice(3)),pause=shift.plannedBreakMinutes??0;
      if(!Number.isSafeInteger(pause)||pause<0||pause>=duration)throw new TypeError('Vagtens planlagte pause er ugyldig.');
      const clean=Object.fromEntries(['id','person','site','date','start','end','plannedBreakMinutes'].filter(key=>shift[key]!==undefined).map(key=>[key,shift[key]]));
      const before=unique.get(clean.id);
      if(before&&JSON.stringify(before)!==JSON.stringify(clean))throw new TypeError('En vagt forekommer med forskellige oplysninger. Hent planen igen.');
      if(before)continue;unique.set(clean.id,clean);
      if(clean.date<from||clean.date>to)continue;
      const week=weeks.get(monday(clean.date));week.shiftCount++;
      if(!clean.person){week.openShiftCount++;continue;}
      const key=clean.person+'|'+clean.date.slice(0,7);
      if(!batches.has(key))batches.set(key,[]);batches.get(key).push(clean);
    }
    for(const rows of batches.values()){
      const personId=rows[0].person,month=rows[0].date.slice(0,7),monthFrom=month+'-01',next=new Date(monthFrom+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const monthTo=add(next.toISOString().slice(0,10),-1);
      const personal=known.get(personId),personLinks=links.get(personId)||[],ids=new Set(personLinks.map(link=>link.groupId).filter(Boolean));
      // Compile only this person's links, avoiding a full-company policy scan per employee/month.
      const resolved=Groups.resolve({policy:{schema:1,groups:[...ids].map(id=>groups.get(id)).filter(Boolean),links:personLinks},personId,payroll:personal?.payroll||null,from:monthFrom,to:monthTo});
      const result=Payroll.estimate({config:resolved.payroll,personId,month,shifts:rows});
      const overlaps=new Set(result.overlaps.flatMap(item=>[item.shiftId,item.otherId]));
      for(const shift of result.shifts){
        const week=weeks.get(monday(shift.date)),key=personId+'|'+week.from;
        if(!personWeeks.has(key)){const row={personId,name:typeof personal?.name==='string'?personal.name:personId,shiftCount:0,minutes:0,baseCents:0,supplementCents:0,totalCents:0,missingShiftCount:0,overlapShiftCount:0,monthly:false,fixedSupplement:false};personWeeks.set(key,row);week.people.push(row);}
        const row=personWeeks.get(key),missing=!personal||resolved.missingBasePeriods.some(period=>shift.date>=period.from&&shift.date<=period.to);
        row.shiftCount++;row.minutes=sum(row.minutes,shift.minutes);row.baseCents=sum(row.baseCents,shift.baseCents);row.supplementCents=sum(row.supplementCents,shift.supplementCents);row.totalCents=sum(row.totalCents,shift.totalCents);
        if(missing)row.missingShiftCount++;
        if(overlaps.has(shift.id))row.overlapShiftCount++;
        row.monthly||=shift.baseType==='monthly';
        row.fixedSupplement||=resolved.payroll.supplements.some(item=>item.type==='monthly'&&item.from<=shift.date&&(item.to===null||item.to>=shift.date));
      }
    }
    for(const week of weeks.values()){
      for(const person of week.people){
        for(const field of ['baseCents','supplementCents','totalCents','minutes','missingShiftCount','overlapShiftCount'])week[field]=sum(week[field],person[field]);
        if(person.monthly)week.monthlyPersonCount++;
        if(person.fixedSupplement)week.fixedSupplementPersonCount++;
      }
      week.complete=!(week.openShiftCount||week.missingShiftCount||week.monthlyPersonCount||week.fixedSupplementPersonCount||week.overlapShiftCount);
      week.people.sort((a,b)=>a.name.localeCompare(b.name,'da')||a.personId.localeCompare(b.personId));
    }
    return [...weeks.values()];
  }
  const api=Object.freeze({estimate,range,MAX_WEEKS,MAX_SHIFTS,MAX_PEOPLE});
  globalThis.CleanRoomsPlanningCost=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
