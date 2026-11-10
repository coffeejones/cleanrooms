/* Logical agreements collect immutable occurrence identities across dated phases. */
(() => {
  'use strict';
  const Engine=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const Planner=globalThis.CleanRoomsSeriesPlanner||(typeof require==='function'?require('./series-planner.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const validDate=value=>typeof value==='string'&&Engine.occurrenceAnchor('date@'+value,'date')===value;
  const date=value=>new Date(value+'T12:00:00Z');
  const addDay=value=>{const result=date(value);result.setUTCDate(result.getUTCDate()+1);const iso=result.toISOString();if(!/^\d{4}-\d{2}-\d{2}T/.test(iso))throw new RangeError('Perioden ligger uden for kalenderens understøttede datoer.');return iso.slice(0,10);};
  const phaseOrder=(left,right)=>left.startDate.localeCompare(right.startDate)||left.endDate.localeCompare(right.endDate)||left.id.localeCompare(right.id);
  const shiftOrder=(left,right)=>left.date.localeCompare(right.date)||left.start.localeCompare(right.start)||left.id.localeCompare(right.id);
  const keyFor=phase=>phase.groupId||phase.id;
  function validate(phases){
    if(!Array.isArray(phases))return ['Vagtserierne skal være en liste.'];
    const errors=[],ids=new Set(),groups=new Map();
    phases.forEach((phase,index)=>{
      const phaseErrors=Engine.validate(phase);errors.push(...phaseErrors.map(message=>'Periode '+(index+1)+': '+message));
      if(!record(phase))return;
      if(typeof phase.id!=='string'||!phase.id.trim()||phase.id!==phase.id.trim())errors.push('Hver periode skal have et stabilt id uden ydre mellemrum.');
      else if(ids.has(phase.id))errors.push('Periodens id forekommer flere gange: '+phase.id);else ids.add(phase.id);
      if(phaseErrors.length||typeof phase.id!=='string')return;
      const key=keyFor(phase);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(phase);
    });
    for(const phases of groups.values()){
      const ordered=[...phases].sort(phaseOrder);let latest=null;
      for(const phase of ordered){if(latest&&phase.startDate<=latest.endDate)errors.push('Perioder i samme aftale må ikke overlappe: '+latest.id+' og '+phase.id+'.');if(!latest||phase.endDate>latest.endDate)latest=phase;}
    }
    return errors;
  }
  function groupSeries(phases,{today,edits={},deleted=[]}={}){
    if(!validDate(today))throw new TypeError('Vælg en gyldig dagsdato.');
    const errors=validate(phases);if(errors.length)throw new TypeError(errors.join(' '));
    const groups=new Map();
    for(const phase of phases){const key=keyFor(phase);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(phase);}
    return [...groups].map(([id,values])=>{
      const ordered=[...values].sort(phaseOrder),first=ordered[0],latest=ordered.at(-1);
      const representative=ordered.find(phase=>phase.startDate<=today&&phase.endDate>=today)||ordered.find(phase=>phase.startDate>today)||latest;
      const shifts=ordered.flatMap(phase=>Planner.occurrences(phase,{edits,deleted,today})).sort(shiftOrder),upcoming=shifts.filter(shift=>shift.date>=today),next=upcoming[0]||null;
      const exceptions={count:0,edited:0,deleted:0,ids:[]},allIds=new Set();
      for(const phase of ordered){const preview=Engine.exceptionPreview({source:phase,scope:'all',edits,deleted});exceptions.edited+=preview.edited;exceptions.deleted+=preview.deleted;preview.ids.forEach(id=>allIds.add(id));}
      exceptions.ids=[...allIds].sort();exceptions.count=exceptions.ids.length;
      const bounded=ordered.some(Engine.requiresRange),summary=bounded?summarizeSeries(ordered,{today,edits,deleted})[0]:null;
      const openEnded=Engine.isOpenEnded(latest),daysToEnd=openEnded?null:Math.round((date(latest.endDate)-date(today))/86400000),status=first.startDate>today?'upcoming':latest.endDate<today&&!next?'ended':'active';
      return {id,groupId:id,phases:ordered.map(clone),representative:clone(representative),latest:clone(latest),startDate:first.startDate,endDate:latest.endDate,...(openEnded?{openEnded:true}:{}),shifts:shifts.map(clone),occurrences:shifts.map(clone),upcoming:upcoming.map(clone),upcomingCount:summary?summary.upcomingCount:upcoming.length,total:summary?summary.total:shifts.length,next:summary?summary.next:next?clone(next):null,...(bounded?{limited:true}:{}),status,exceptions,daysToEnd,expiring:daysToEnd!==null&&daysToEnd>=0&&daysToEnd<=28};
    }).sort((left,right)=>left.startDate.localeCompare(right.startDate)||left.id.localeCompare(right.id));
  }
  // Overview counts and the next actual shift need no materialized yearly plan.
  // Keep the editor's occurrence-based API separate from this read-only summary.
  function summarizeSeries(phases,{today,edits={},deleted=[]}={}){
    if(!validDate(today))throw new TypeError('Vælg en gyldig dagsdato.');
    const errors=validate(phases);if(errors.length)throw new TypeError(errors.join(' '));
    if(!phases.length)return [];
    if(!record(edits)||!Array.isArray(deleted)||deleted.some(id=>typeof id!=='string'))throw new TypeError('Seriens manuelle ændringer er ugyldige.');
    const dayMs=86400000,stamp=day=>Date.parse(day+'T12:00:00Z'),todayStamp=stamp(today);
    const byId=new Map(phases.map(phase=>[phase.id,{phase,edits:[],deleted:new Set()}])),groups=new Map();
    const parent=id=>{const key=id.slice(0,-11),own=byId.get(key);return own&&Engine.occurrenceAnchor(id,key)?own:null;};
    for(const [id,shift]of Object.entries(edits)){const own=parent(id);if(own)own.edits.push([id,shift]);}
    for(const id of deleted){const own=parent(id);if(own)own.deleted.add(id);}
    for(const phase of phases){const key=keyFor(phase);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(phase);}
    const checked=(shift,id)=>{
      if(!record(shift)||shift.id!==id||!validDate(shift.date))throw new TypeError('En manuel ændring i serien er ugyldig.');
      const errors=Engine.validate({id,person:shift.person||'unassigned',site:shift.site,startDate:shift.date,endDate:shift.date,weekdays:[0],start:shift.start,end:shift.end,plannedBreakMinutes:shift.plannedBreakMinutes,noteRich:shift.noteRich});
      if(errors.length||typeof shift.person!=='string'||shift.note!=null&&typeof shift.note!=='string')throw new TypeError(errors[0]||'En manuel ændring i serien er ugyldig.');
    };
    return [...groups].map(([id,values])=>{
      const ordered=[...values].sort(phaseOrder),first=ordered[0],latest=ordered.at(-1),representative=ordered.find(phase=>phase.startDate<=today&&phase.endDate>=today)||ordered.find(phase=>phase.startDate>today)||latest;
      const exceptions={count:0,edited:0,deleted:0,ids:[]},exceptionIds=new Set();let total=0,upcomingCount=0,next=null;
      const choose=candidate=>{if(!next||shiftOrder(candidate,next)<0)next=candidate;};
      for(const phase of ordered){
        const own=byId.get(phase.id);
        const belongs=anchor=>Engine.occursOn(phase,anchor);
        const blocked=new Set();total+=Engine.countOccurrences(phase);upcomingCount+=Engine.countOccurrences(phase,today);
        exceptions.edited+=own.edits.length;exceptions.deleted+=own.deleted.size;
        for(const [key]of own.edits)exceptionIds.add(key);for(const key of own.deleted)exceptionIds.add(key);
        for(const key of own.deleted){const anchor=key.slice(-10);if(!belongs(anchor))continue;blocked.add(key);total--;if(anchor>=today)upcomingCount--;}
        for(const [key,shift]of own.edits){
          const anchor=key.slice(-10);if(!belongs(anchor))continue;checked(shift,key);
          if(shift.seriesId&&shift.seriesId!==phase.id||own.deleted.has(key))continue;
          blocked.add(key);if(anchor>=today)upcomingCount--;if(shift.date>=today){upcomingCount++;choose({id:shift.id,date:shift.date,start:shift.start,shift});}
        }
        for(let day=Engine.nextOccurrenceDate(phase,today);day;){
          const key=phase.id+'@'+day,weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
          if(!blocked.has(key)){const times=phase.dayTimes&&Object.hasOwn(phase.dayTimes,String(weekday))?phase.dayTimes[weekday]:phase;choose({id:key,date:day,start:times.start,phase});break;}
          day=day===phase.endDate?null:Engine.nextOccurrenceDate(phase,addDay(day));
        }
      }
      exceptions.ids=[...exceptionIds].sort();exceptions.count=exceptions.ids.length;
      const actualNext=next?next.shift||Engine.enumerate(next.phase,{from:next.date,to:next.date})[0]:null;
      const openEnded=Engine.isOpenEnded(latest),daysToEnd=openEnded?null:Math.round((stamp(latest.endDate)-todayStamp)/dayMs),status=first.startDate>today?'upcoming':latest.endDate<today&&!actualNext?'ended':'active';
      return {summary:true,id,groupId:id,phases:ordered.map(clone),representative:clone(representative),latest:clone(latest),startDate:first.startDate,endDate:latest.endDate,...(openEnded?{openEnded:true}:{}),total:openEnded?null:total,upcomingCount:openEnded?null:upcomingCount,next:actualNext?clone(actualNext):null,status,exceptions,daysToEnd,expiring:daysToEnd!==null&&daysToEnd>=0&&daysToEnd<=28};
    }).sort((left,right)=>left.startDate.localeCompare(right.startDate)||left.id.localeCompare(right.id));
  }
  const fail=errors=>({ok:false,draft:null,errors,error:errors[0]||'Vagtserien kunne ikke oprettes.'});
  function template(source){
    const draft={};for(const field of ['person','site','start','end','plannedBreakMinutes','note','noteRich','weekdays','dayTimes','weekInterval','weekAnchor'])if(source[field]!==undefined)draft[field]=clone(source[field]);
    return draft;
  }
  function copyDraft(source,{id,startDate,endDate,person,site,openEnded}={}){
    const errors=Engine.validate(source);if(errors.length)return fail(errors);
    if(typeof id!=='string'||!id||id===source.id||id===keyFor(source))return fail(['Kopien skal have et nyt, selvstændigt id.']);
    const draft={...template(source),id,groupId:id,startDate,endDate,...(openEnded!==undefined?{openEnded}:Engine.isOpenEnded(source)&&endDate===Engine.OPEN_END?{openEnded:true}:{}),...(person!==undefined?{person}:{}),...(site!==undefined?{site}:{})};
    const draftErrors=Engine.validate(draft);return draftErrors.length?fail(draftErrors):{ok:true,draft,errors:[],error:null};
  }
  function extensionDraft(source,{id,months}={}){
    const phases=Array.isArray(source)?source:record(source)&&Array.isArray(source.phases)?source.phases:[source];
    const errors=validate(phases);if(errors.length)return fail(errors);
    if(!phases.length)return fail(['Vælg en eksisterende aftale, der skal forlænges.']);
    if(new Set(phases.map(keyFor)).size!==1)return fail(['Vælg kun én aftale, der skal forlænges.']);
    if(!Number.isInteger(months)||months<1||months>12)return fail(['Forlæng med et helt antal måneder fra 1 til 12 pr. periode.']);
    if(typeof id!=='string'||!id||phases.some(phase=>phase.id===id)||id===keyFor(phases[0]))return fail(['Den nye periode skal have et nyt, selvstændigt id.']);
    const latest=[...phases].sort(phaseOrder).at(-1);
    if(Engine.isOpenEnded(latest))return fail(['En vagtserie uden slutdato skal ikke forlænges.']);
    try{
      const draft={...template(latest),id,groupId:keyFor(latest),startDate:addDay(latest.endDate),endDate:Engine.addMonths(latest.endDate,months)};
      const draftErrors=validate([...phases,draft]);return draftErrors.length?fail(draftErrors):{ok:true,draft,errors:[],error:null};
    }catch(error){return fail([error?.message||'Den nye periode ligger uden for kalenderen.']);}
  }
  const api=Object.freeze({validate,groupSeries,summarizeSeries,copyDraft,extensionDraft});
  globalThis.CleanRoomsSeriesLifecycle=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
