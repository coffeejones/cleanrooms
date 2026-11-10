/* A bounded cache of complete weekly calendar projections. It never infers
 * authority for a gap, or deletion from an evicted week's absent records. */
(() => {
  'use strict';
  const Planning=globalThis.CleanRoomsPlanningRecords||(typeof require==='function'?require('./planning-records.js'):null);
  const Window=globalThis.CleanRoomsPlanningWindow||(typeof require==='function'?require('./planning-window.js'):null);
  const Scope=globalThis.CleanRoomsPlanningScope||(typeof require==='function'?require('./planning-scope.js'):null);
  const Instructions=globalThis.CleanRoomsInstructions||Planning?.instructionState;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
  function normalize(value){
    if(!Scope.validDate(value?.from)||!Scope.validDate(value?.to)||value.from>value.to)throw new TypeError('Vælg en gyldig kalenderperiode.');
    const from=Scope.monday(value.from),to=Scope.add(Scope.monday(value.to),6);return Window.normalize({mode:'calendar',from,to});
  }
  function weeks(value){const range=normalize(value),result=[];for(let from=range.from;from<=range.to;from=Scope.add(from,7))result.push({mode:'calendar',from,to:Scope.add(from,6)});return result;}
  function generation(value,{strict=true}={}){
    const planning=value?.planning,directory=value?.directory,absence=planning?.absenceVersion;
    if(!Number.isSafeInteger(value?.revision)||value.revision<0||planning?.schema!==1||typeof planning.metadataHash!=='string'||!planning.metadataHash||directory?.schema!==1||!Number.isSafeInteger(directory.revision)||directory.revision<0||strict&&(!Number.isSafeInteger(absence)||absence<0))fail('Kalenderens versionsgrundlag mangler. Hent perioden igen.');
    return Planning.canonical({workspace:value.workspace?.id??null,viewer:value.viewer?.userId??null,role:value.viewer?.roleId??value.viewer?.role??null,memberVersion:value.viewer?.memberVersion??value.viewer?.version??null,roleVersion:value.viewer?.roleVersion??null,accessScope:value.viewer?.accessScope??null,capabilities:value.capabilities||{},revision:value.revision,directory:directory.revision,absence:absence??null,metadata:planning.metadataHash});
  }
  function recordRows(value){
    const actual=new Map(Planning.flatten(value.studio).map(row=>[Planning.key(row.kind,row.id),row])),result=[];
    const windows=value.planning.recordWindows;
    if(windows!==undefined&&(!windows||typeof windows!=='object'||Array.isArray(windows)||Object.keys(windows).length!==Object.keys(value.planning.versions||{}).length||Object.keys(windows).some(key=>!Object.hasOwn(value.planning.versions||{},key)||!Window.validRecordWindow(windows[key]))))fail('Kalenderens postafgrænsninger er ugyldige.');
    for(const [key,version]of Object.entries(value.planning.versions||{})){
      let identity;try{identity=JSON.parse(key);}catch{fail('Kalenderens postidentiteter er ugyldige.');}
      if(!Array.isArray(identity)||identity.length!==2||!['series','shift','week'].includes(identity[0])||!Scope.validId(identity[1])||!Number.isSafeInteger(version)||version<1)fail('Kalenderens postversioner er ugyldige.');
      const row=actual.get(key)||{kind:identity[0],id:identity[1],value:null,sortOrder:0};result.push({...clone(row),sortOrder:value.planning.recordOrder?.[key]??row.sortOrder??0,version,...(windows!==undefined?{window:clone(windows[key])}:{})});actual.delete(key);
    }
    if(actual.size)fail('Kalenderen mangler versioner for sine planposter.');return result;
  }
  function mergeRecord(records,row){
    const key=Planning.key(row.kind,row.id),old=records.get(key);if(!old){records.set(key,clone(row));return;}
    if(old.version!==row.version)fail('Kalenderens postversioner er ændret under indlæsningen.');
    if(old.sortOrder!==row.sortOrder||old.window&&row.window&&Planning.canonical(old.window)!==Planning.canonical(row.window))fail('Kalenderens postafgrænsninger eller rækkefølge er ændret.');
    const window=old.window||row.window;
    if(window&&!old.window)old.window=clone(window);
    if(Planning.canonical(old.value)===Planning.canonical(row.value))return;
    const before=Instructions?.contains(old.value),after=Instructions?.contains(row.value);
    if(before!==after&&Planning.canonical(Scope.compact(row.kind,row.id,old.value))===Planning.canonical(Scope.compact(row.kind,row.id,row.value))){if(before)records.set(key,{...clone(row),...(window?{window:clone(window)}:{})});return;}
    fail('Kalenderens vagter er ændret under indlæsningen.');
  }
  function mergeResults(values,range){
    if(!values.length)fail('Kalenderperioden er ikke indlæst.');const stamp=generation(values[0]),records=new Map(),slots=new Map(),published=new Map(),absences=new Map(),progress={},result=clone(values.at(-1)),metadata=Planning.canonical(Planning.metadata(values[0].studio));let publication=null;
    for(const value of values){
      if(generation(value)!==stamp||Planning.canonical(Planning.metadata(value.studio))!==metadata)fail('Kalenderen er ændret under indlæsningen.');
      for(const row of recordRows(value))mergeRecord(records,row);
      const present=Object.hasOwn(value.studio,'publications'),header=present?Object.fromEntries(Object.entries(value.studio.publications).filter(([key])=>!['slots','records'].includes(key))):null;
      if(publication===null)publication={present,header};else if(publication.present!==present||Planning.canonical(publication.header)!==Planning.canonical(header))fail('Udgivelsen er ændret under indlæsningen.');
      for(const [key,slot]of Object.entries(value.studio.publications?.slots||{})){
        const heading=Object.fromEntries(Object.entries(slot).filter(([name])=>name!=='shifts')),old=slots.get(key);if(old&&Planning.canonical(old)!==Planning.canonical(heading))fail('Udgivelsens overskrifter er ændret.');slots.set(key,clone(heading));
        for(const shift of slot.shifts||[]){const old=published.get(shift.id);if(old){if(old.key!==key)fail('En udgivet vagt har to arbejdssteder.');const same=Planning.canonical(old.shift)===Planning.canonical(shift);if(!same){const one=Instructions?.isDeferred(old.shift),two=Instructions?.isDeferred(shift);if(one===two||Planning.canonical(Scope.compact('published',shift.id,old.shift))!==Planning.canonical(Scope.compact('published',shift.id,shift)))fail('En udgivet vagt er ændret.');if(one)published.set(shift.id,{key,shift:clone(shift)});}}else published.set(shift.id,{key,shift:clone(shift)});}
      }
      for(const absence of value.studio.absences||[]){const old=absences.get(absence.id);if(old&&Planning.canonical(old)!==Planning.canonical(absence))fail('Fraværet er ændret under indlæsningen.');absences.set(absence.id,clone(absence));}
      for(const [key,entry]of Object.entries(value.studio.checklistProgress||{})){if(Object.hasOwn(progress,key)&&Planning.canonical(progress[key])!==Planning.canonical(entry))fail('Tjeklisten er ændret under indlæsningen.');progress[key]=clone(entry);}
    }
    if(records.size+published.size+absences.size>50000)fail('Kalenderperioden indeholder for mange poster. Vælg færre uger.',413);
    result.studio=Planning.apply({...clone(result.studio),series:[],edits:{},deleted:[],weekPlans:{}},[...records.values()]);
    if(publication.present){const output={};for(const [key,heading]of slots)output[key]={...heading,shifts:[]};for(const {key,shift}of published.values())output[key].shifts.push(shift);for(const slot of Object.values(output))slot.shifts.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));result.studio.publications={...publication.header,slots:output,records:[]};}else delete result.studio.publications;
    result.studio.absences=[...absences.values()];result.studio.requests=Object.fromEntries(result.studio.absences.map(entry=>[entry.id,entry.status]));result.studio.leaveDecisions=Object.fromEntries(result.studio.absences.filter(entry=>entry.decision).map(entry=>[entry.id,clone(entry.decision)]));result.studio.checklistProgress=progress;
    result.planning={...result.planning,partial:true,projection:normalize(range),versions:Object.fromEntries([...records].map(([key,row])=>[key,row.version])),recordOrder:Object.fromEntries([...records].map(([key,row])=>[key,row.sortOrder])),deferred:[...records].filter(([,row])=>row.kind!=='week'&&Instructions?.contains(row.value)).map(([key])=>key)};
    if(values.some(value=>value.planning.recordWindows!==undefined)&&[...records.values()].every(row=>row.window))result.planning.recordWindows=Object.fromEntries([...records].map(([key,row])=>[key,clone(row.window)]));else delete result.planning.recordWindows;
    delete result.selection;delete result.availability;delete result.catalog;result.nextCursor=null;result.ok=true;return result;
  }
  function split(value){
    const range=normalize(value?.planning?.projection),chosenWeeks=weeks(range);
    if(value?.ok!==true||value?.planning?.partial!==true||value?.planning?.projection?.mode!=='calendar'||Planning.canonical(value.planning.projection)!==Planning.canonical(range)||value.nextCursor!==null&&value.nextCursor!==undefined)fail('Kun færdigindlæste kalenderperioder kan gemmes i kalendercachen.');
    generation(value);const records=recordRows(value);
    if(chosenWeeks.length===1)return [clone(value)];
    if(value.planning.recordWindows===undefined)fail('Kalenderperioden mangler præcise postafgrænsninger. Hent ugerne igen.');
    const byKey=new Map(records.map(row=>[Planning.key(row.kind,row.id),row])),used=new Set(),output=[];
    for(const week of chosenWeeks){
      const selected=new Map(),inside=day=>day!==null&&day>=week.from&&day<=week.to;
      for(const row of records){const window=row.window,inWeek=row.kind==='shift'?inside(window.from)||inside(window.origin):window.from!==null&&window.from<=week.to&&window.to>=week.from;if(inWeek)selected.set(Planning.key(row.kind,row.id),row);}
      for(const row of [...selected.values()])if(row.kind==='shift'&&row.window.parent){const key=Planning.key('series',row.window.parent),parent=byKey.get(key);if(parent)selected.set(key,parent);}
      for(const key of selected.keys())used.add(key);
      const result=clone(value),rows=[...selected.values()];result.studio=Planning.apply({...result.studio,series:[],edits:{},deleted:[],weekPlans:{}},rows);
      const published=new Set();
      if(Object.hasOwn(value.studio,'publications')){
        const slots={};for(const [key,slot]of Object.entries(value.studio.publications?.slots||{}))if(slot.from<=week.to&&slot.to>=week.from){const shifts=(slot.shifts||[]).filter(shift=>inside(shift.date));slots[key]={...clone(slot),shifts:clone(shifts)};for(const shift of shifts)published.add(JSON.stringify([shift.id,shift.person]));}
        result.studio.publications={...clone(value.studio.publications),slots,records:[]};
      }
      result.studio.absences=(value.studio.absences||[]).filter(entry=>Array.isArray(entry.days)&&entry.days.some(inside)).map(clone);
      result.studio.requests=Object.fromEntries(result.studio.absences.map(entry=>[entry.id,entry.status]));result.studio.leaveDecisions=Object.fromEntries(result.studio.absences.filter(entry=>entry.decision).map(entry=>[entry.id,clone(entry.decision)]));
      result.studio.checklistProgress=Object.fromEntries(Object.entries(value.studio.checklistProgress||{}).filter(([key])=>published.has(key)).map(([key,progress])=>[key,clone(progress)]));
      result.planning={...result.planning,projection:week,versions:Object.fromEntries(rows.map(row=>[Planning.key(row.kind,row.id),row.version])),recordOrder:Object.fromEntries(rows.map(row=>[Planning.key(row.kind,row.id),row.sortOrder])),recordWindows:Object.fromEntries(rows.map(row=>[Planning.key(row.kind,row.id),clone(row.window)])),deferred:rows.filter(row=>row.kind!=='week'&&Instructions?.contains(row.value)).map(row=>Planning.key(row.kind,row.id))};
      delete result.selection;delete result.availability;delete result.catalog;result.nextCursor=null;output.push(result);
    }
    if(used.size!==records.length)fail('En kalenderpost kan ikke afgrænses sikkert til en uge. Hent kalenderperioden igen.');
    return output;
  }
  function create({maxWeeks=4,maxBytes=64*1024*1024}={},seed=null){
    if(!Number.isInteger(maxWeeks)||maxWeeks<1||maxWeeks>12||!Number.isFinite(maxBytes)||maxBytes<1)throw new TypeError('Vælg en gyldig kalendercache.');
    let entries=seed?new Map(seed.entries):new Map(),stamp=seed?.stamp??null,tick=seed?.tick??0;
    const clear=()=>{entries.clear();stamp=null;tick=0;};
    function evict(required){const keys=new Set(weeks(required).map(week=>week.from)),capacity=Math.max(maxWeeks,keys.size);while(entries.size>capacity||[...entries.values()].reduce((sum,entry)=>sum+entry.bytes,0)>maxBytes){const candidates=[...entries].filter(([key])=>!keys.has(key)).sort((a,b)=>a[1].used-b[1].used);if(!candidates.length)fail('Kalenderperioden fylder for meget. Vælg færre uger.',413);entries.delete(candidates[0][0]);}}
    function put(value,{required=value?.planning?.projection}={}){
      const range=normalize(value?.planning?.projection);if(value?.ok!==true||value?.planning?.projection?.mode!=='calendar'||Planning.canonical(value.planning.projection)!==Planning.canonical(range)||weeks(range).length!==1||value.nextCursor)fail('Kun færdigindlæste uger kan gemmes i kalendercachen.');
      const next=generation(value);if(stamp!==null&&stamp!==next){const error=Object.assign(new Error('Kalenderens generation er ændret.'),{status:409,generationChanged:true});throw error;}
      const merged=entries.has(range.from)?mergeResults([entries.get(range.from).value,value],range):clone(value);recordRows(merged);const data=clone(merged);stamp=next;entries.set(range.from,{value:data,bytes:bytes(data),used:++tick});evict(required);return api;
    }
    function putRange(value,{required=value?.planning?.projection}={}){
      const incoming=split(value),previous={entries,stamp,tick};entries=new Map(entries);
      try{for(const week of incoming)put(week,{required});return api;}catch(error){({entries,stamp,tick}=previous);throw error;}
    }
    function missing(range){return weeks(range).filter(week=>!entries.has(week.from));}
    function assemble(range){const needed=weeks(range);if(needed.some(week=>!entries.has(week.from)))fail('En uge i kalenderperioden mangler.');const chosen=needed.map(week=>{const entry=entries.get(week.from);entries.set(week.from,{...entry,used:++tick});return entry.value;}),result=mergeResults(chosen,range);if(bytes(result)>maxBytes)fail('Kalenderperioden fylder for meget. Vælg færre uger.',413);evict(range);return result;}
    const api=Object.freeze({put,putRange,missing,assemble,clear,covers:range=>{try{return missing(range).length===0;}catch{return false;}},fork:({maxWeeks:capacity=maxWeeks}={})=>create({maxWeeks:capacity,maxBytes},{entries,stamp,tick}),get generation(){return stamp;},get inspect(){return {generation:stamp,keys:[...entries.keys()].sort(),weeks:entries.size,bytes:[...entries.values()].reduce((sum,entry)=>sum+entry.bytes,0),maxWeeks};}});return api;
  }
  const api=Object.freeze({create,normalize,weeks,generation,split});globalThis.CleanRoomsPlanningViewport=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
