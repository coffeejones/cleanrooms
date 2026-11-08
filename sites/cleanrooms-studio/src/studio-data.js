/* Shared plan expansion keeps server employee projections equal to planner occurrences. */
(() => {
  'use strict';
  const Series = globalThis.CleanRoomsSeries || (typeof require === 'function' ? require('./series-engine.js') : null);
  const Description = globalThis.CleanRoomsDescription || (typeof require === 'function' ? require('./description-model.js') : null);
  const PayrollPeriod = globalThis.CleanRoomsPayrollPeriod || (typeof require === 'function' ? require('./payroll-period-model.js') : null);
  const names = ['Jonas Larsen','Emma Nielsen','Sara Ahmed','Mikkel Jensen','Freja Holm','Oliver Madsen','Lea Hansen','Noah Andersen','Clara Lund','William Poulsen','Alma Sørensen','Oscar Møller','Ella Christensen','Lucas Pedersen','Agnes Berg','Malthe Rasmussen','Sofia Nørgaard','Emil Hansen','Ida Jørgensen','Anton Larsen','Laura Vestergaard','Victor Kristensen'];
  const staff = names.map((name,i) => Object.freeze({id:'p'+i,name,initials:name.split(' ').map(part=>part[0]).join(''),target:i===0?16:[35,32,30,25,37,37][(i-1+6)%6],site:i%3,role:i===3||i===12?'Teamleder':'Servicemedarbejder',active:true}));
  const minDate='2000-01-01', maxDate='2100-12-31';
  const instructionTemplates=new Map();
  const date=value=>new Date(value+'T12:00:00Z');
  const add=(value,count)=>{const result=date(value);result.setUTCDate(result.getUTCDate()+count);return result.toISOString().slice(0,10);};
  const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date(value).getTime())&&date(value).toISOString().slice(0,10)===value;
  function todayFor(now=new Date()) {
    const instant=now instanceof Date?now:new Date(now);
    if(!Number.isFinite(instant.getTime()))throw new TypeError('Vælg et gyldigt tidspunkt.');
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
    return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
  }
  function anchorFor(now=new Date()) {const day=todayFor(now);return add(day,-((date(day).getUTCDay()+6)%7));}
  const today=todayFor(),anchor=anchorFor();
  function staffFor(data={}) {
    if(data.roster===undefined)return staff;
    if(!Array.isArray(data.roster))throw new TypeError('Medarbejderlisten skal være en liste.');
    return data.roster;
  }
  function payrollPeriodFor(data={}) {return PayrollPeriod.normalize(data.workspaceSettings?.payrollPeriod);}
  function employeeInstructions(site) {
    const key=site===1||site===2?site:0;
    if(instructionTemplates.has(key))return {...instructionTemplates.get(key)};
    const titles=['Rengør skriveborde og kontaktflader','Rengør behandlingsrum og kontaktflader','Rengør fællesarealer og kontaktflader'];
    const doc={type:'doc',content:[{type:'heading',attrs:{level:3},content:[{type:'text',text:'Instruktioner til vagten'}]},{type:'paragraph',content:[{type:'text',text:'Eksempel: Brug nøglekortet ved hovedindgangen. Kontakt teamlederen, hvis der mangler udstyr.'}]},{type:'taskList',content:[titles[site]||titles[0],'Tøm affald og fyld sæbe op','Kontrollér lokalerne, lås og slå alarmen til'].map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]};
    const result={note:Description.text(doc),noteRich:Description.encode(doc)};instructionTemplates.set(key,result);return {...result};
  }
  function seededShifts(from,to,data={}) {
    if(!valid(from)||!valid(to)||to<from||(date(to)-date(from))/86400000>=366)throw new RangeError('Vælg højst 366 kalenderdage ad gangen.');
    if(data.demoSeed===false)return [];
    const result=[];
    // Legacy generated shifts are already part of the demo plan. Archiving an
    // identity must not delete that plan or rewrite its historical assignments.
    const people=staffFor(data).filter(person=>/^p(?:[0-9]|1[0-9]|2[01])$/.test(person.id));
    if(!people.length)return result;
    for(let day=from;day<=to;day=add(day,1)) {
      const index=(date(day).getUTCDay()+6)%7;
      people.forEach(person=>{
        const i=Number(person.id.slice(1));
        if(i===0)return;
        const workdays=i===2?[0,1,3,4,5]:i===3?[0,2,4]:i===4?[0,1,3,4]:[0,1,2,3,4];
        if(!workdays.includes(index)||(person.id==='p6'&&day==='2026-10-28'))return;
        let start=i===4?'16:00':i%3===1?'06:00':i%3===2?'07:00':'08:00',end=i===4?'21:00':i%3===1?'13:00':i%3===2?'14:00':'15:00';
        if(index===5){start='09:00';end='13:00';}
        result.push({id:person.id+'-'+day,person:person.id,date:day,site:person.site,start,end,note:'',...(data.employeeExamplesVersion===1?employeeInstructions(person.site):{})});
      });
      if(index===2)result.push({id:'open-'+day,person:'',date:day,site:1,start:'07:00',end:'14:00',note:''});
    }
    return result;
  }
  function shiftsInRange(from,to,data={}) {
    if(!valid(from)||!valid(to)||to<from||(date(to)-date(from))/86400000>=366)throw new RangeError('Vælg højst 366 kalenderdage ad gangen.');
    const deleted=new Set(data.deleted||[]),map=new Map();
    seededShifts(from,to,data).forEach(shift=>{if(!deleted.has(shift.id))map.set(shift.id,shift);});
    (data.series||[]).forEach(series=>Series.enumerate(series,{from,to}).forEach(shift=>{if(!deleted.has(shift.id))map.set(shift.id,shift);}));
    Object.values(data.edits||{}).forEach(shift=>{map.delete(shift.id);if(shift.date>=from&&shift.date<=to&&!deleted.has(shift.id))map.set(shift.id,shift);});
    return [...map.values()];
  }
  function shiftById(id,data={}) {
    if(typeof id!=='string'||(data.deleted||[]).includes(id))return null;
    if(data.edits?.[id])return data.edits[id];
    const series=(data.series||[]).find(item=>id.startsWith(item.id+'@'));
    if(series){const day=Series.occurrenceAnchor(id,series.id);return day?Series.enumerate(series,{from:day,to:day}).find(shift=>shift.id===id)||null:null;}
    const day=id.slice(-10);return valid(day)?shiftsInRange(day,day,data).find(shift=>shift.id===id)||null:null;
  }
  function leaveRequests(data) {
    if(data&&Array.isArray(data.absences))return data.absences.map(item=>({...item,days:[...item.days]}));
    return [
    {id:'a',p:'p6',dates:'28. oktober',days:['2026-10-28'],type:'Ferie',status:'approved'},
    {id:'b',p:'p1',dates:'3.–4. november',days:['2026-11-03','2026-11-04'],type:'Friønske',status:'pending'},
    {id:'c',p:'p10',dates:'9. november',days:['2026-11-09'],type:'Ferie',status:'pending'}
  ];}
  const api=Object.freeze({leaveRequests,names:Object.freeze(names),staff:Object.freeze(staff),staffFor,payrollPeriodFor,today,anchor,todayFor,anchorFor,minDate,maxDate,employeeInstructions,seededShifts,shiftsInRange,shiftById});
  globalThis.CleanRoomsData=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
