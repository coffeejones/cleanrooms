/* Shared draft-record commands. Versions include tombstones; metadata is a separate CAS domain. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const KINDS=Object.freeze(['series','shift','week']);
  const RECORD_FIELDS=Object.freeze(['series','edits','deleted','weekPlans']);
  const SERVER_FIELDS=Object.freeze(['publications','activity','checklistProgress','shiftWorkflow','absences','absenceHasMore','absenceRequests','requests','leaveDecisions','planning','planningVersions','recordVersions','roster','organization','directory','directorySchema','directoryRevision']);
  const PREFS=Object.freeze(['role','page','group','view','zoom','calendarLayoutVersion','calendarAnchor','day','onlyOpen','week','pageIndex','search','site','departmentId','employeePerson','employeeWeek','employeeDate','employeeView','employeeCalendarVersion','employeeShift','demoReturnPage','worksiteDate','worksiteSite']);
  const PRIVATE_FIELDS=Object.freeze(['viewer','capabilities','permissions','roleId','roleName','ownerId','userId','cloudCapabilities','manageDepartments','manageUsers','manageRoles','canManageDepartments','viewPayroll','managePayroll','managePayrollGroups','chat','manageChat']);
  const metadataExcluded=new Set([...RECORD_FIELDS,...SERVER_FIELDS,...PREFS,...PRIVATE_FIELDS]),payloadExcluded=new Set([...RECORD_FIELDS,...SERVER_FIELDS,...PRIVATE_FIELDS]);
  const forbidden=new Set(['__proto__','prototype','constructor']);
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!forbidden.has(value)&&!/[\u0000-\u001f\u007f]/.test(value);
  const normalized=value=>Array.isArray(value)?value.map(item=>normalized(item===undefined?null:item)):record(value)?Object.fromEntries(Object.keys(value).filter(name=>value[name]!==undefined).sort().map(name=>[name,normalized(value[name])])):value;
  const canonical=value=>JSON.stringify(normalized(value===undefined?null:value));
  const key=(kind,id)=>JSON.stringify([kind,id]);
  const version=(versions,kind,id)=>Object.hasOwn(versions||{},key(kind,id))?versions[key(kind,id)]:0;
  function metadata(studio={}){return Object.fromEntries(Object.entries(studio||{}).filter(([name])=>!metadataExcluded.has(name)).map(([name,value])=>[name,clone(value)]));}
  function payloadStudio(studio={}){return Object.fromEntries(Object.entries(studio||{}).filter(([name])=>!payloadExcluded.has(name)).map(([name,value])=>[name,clone(value)]));}
  function flatten(studio={}){
    const rows=[],seen=new Set();
    const add=(kind,id,value,sortOrder)=>{if(!validId(id)||seen.has(key(kind,id)))throw new TypeError('Planen indeholder ugyldige eller gentagne post-id.');seen.add(key(kind,id));rows.push({kind,id,value:clone(value),sortOrder});};
    for(const [order,value]of (studio.series||[]).entries())add('series',value.id,value,order);
    const edits=studio.edits||{},deleted=studio.deleted||[],suppressed=new Set(deleted),ids=[...new Set([...deleted,...Object.keys(edits)])];
    ids.forEach((id,index)=>add('shift',id,{edit:Object.hasOwn(edits,id)?edits[id]:null,suppressed:suppressed.has(id)},index));
    Object.entries(studio.weekPlans||{}).forEach(([id,value],index)=>add('week',id,value,index));
    return rows;
  }
  function diff(before={},after={}){
    const old=new Map(flatten(before).map(row=>[key(row.kind,row.id),row])),next=new Map(flatten(after).map(row=>[key(row.kind,row.id),row])),changes=[];
    for(const id of [...new Set([...old.keys(),...next.keys()])].sort()){
      const left=old.get(id),right=next.get(id);if(canonical(left?.value)===canonical(right?.value))continue;
      const row=right||left;changes.push({kind:row.kind,id:row.id,before:left?clone(left.value):null,value:right?clone(right.value):null,deleted:!right,sortOrder:row.sortOrder});
    }
    return changes;
  }
  function commandValue(kind,value){if(kind==='week'&&record(value)&&Array.isArray(value.baseline)&&Instructions?.contains(value.baseline)){const next=clone(value);delete next.baseline;delete next.baselineKind;return next;}return value;}
  function commands(base,next,versions={}){return diff(base,next).map(({kind,id,value})=>({kind,id,expectedVersion:version(versions,kind,id),value:commandValue(kind,value)}));}
  function assertDetails(base,next,deferred=[]){
    const missing=new Set(deferred),previous=new Map(flatten(base).map(row=>[key(row.kind,row.id),row.value]));for(const change of diff(base,next)){if(change.kind==='week')continue;
      if(Instructions?.contains(change.value)||Instructions?.contains(previous.get(key(change.kind,change.id)))||missing.has(key(change.kind,change.id)))throw new TypeError('Indlæs vagtens instruktioner, før du gemmer ændringen.');
      if(change.kind==='shift'){const parents=new Set([base?.edits?.[change.id]?.seriesId,change.value?.edit?.seriesId].filter(Boolean));for(const series of base?.series||[])if(change.id.startsWith(series.id+'@'))parents.add(series.id);for(const parent of parents)if(missing.has(key('series',parent)))throw new TypeError('Indlæs vagtseriens instruktioner, før du gemmer ændringen.');}
    }
    return true;
  }
  function apply(studio={},changes=[]){
    const rows=new Map(flatten(studio).map(row=>[key(row.kind,row.id),row])),maximum=Object.fromEntries(KINDS.map(kind=>[kind,Math.max(-1,...[...rows.values()].filter(row=>row.kind===kind).map(row=>row.sortOrder))]));
    for(const change of changes){
      if(!KINDS.includes(change.kind)||!validId(change.id))throw new TypeError('Planændringen har et ugyldigt post-id.');
      const id=key(change.kind,change.id),previous=rows.get(id);
      if(change.value===null||change.deleted===true){rows.delete(id);continue;}
      if(!record(change.value))throw new TypeError('Planændringen mangler en gyldig værdi.');
      rows.set(id,{kind:change.kind,id:change.id,value:clone(change.value),sortOrder:Number.isSafeInteger(change.sortOrder)&&change.sortOrder>=0?change.sortOrder:previous?.sortOrder??++maximum[change.kind]});
    }
    const ordered=kind=>[...rows.values()].filter(row=>row.kind===kind).sort((a,b)=>a.sortOrder-b.sortOrder||(a.id<b.id?-1:a.id>b.id?1:0));
    const next={...clone(studio),series:ordered('series').map(row=>row.value),edits:{},deleted:[],weekPlans:{}};
    for(const row of ordered('shift')){if(row.value.edit!==null)next.edits[row.id]=row.value.edit;if(row.value.suppressed)next.deleted.push(row.id);}
    for(const row of ordered('week'))next.weekPlans[row.id]=row.value;
    return next;
  }
  function rebaseWeek(current,proposed){
    if(!record(current))return record(proposed)?clone(proposed):null;
    if(!record(proposed))return clone(current);
    const next={...clone(current),...clone(proposed),changes:Math.max(Number.isFinite(current.changes)?current.changes:0,Number.isFinite(proposed.changes)?proposed.changes:0)};
    if(current.published===false||proposed.published===false)next.published=false;
    if(Array.isArray(current.baseline)){next.baseline=clone(current.baseline);if(Object.hasOwn(current,'baselineKind'))next.baselineKind=current.baselineKind;else delete next.baselineKind;}
    return next;
  }
  function merge(base,local,remote){
    const next=apply(remote,diff(base,local));
    for(const name of new Set([...Object.keys(base||{}),...Object.keys(local||{})])){
      if(RECORD_FIELDS.includes(name)||SERVER_FIELDS.includes(name))continue;
      if(PREFS.includes(name)||PRIVATE_FIELDS.includes(name)||canonical(base?.[name])!==canonical(local?.[name])){
        if(Object.hasOwn(local||{},name))next[name]=clone(local[name]);else delete next[name];
      }
    }
    return next;
  }
  function groupSignature(studio,versions,groupId){
    const series=(studio.series||[]).filter(item=>(item.groupId||item.id)===groupId),ids=new Set(series.map(item=>item.id)),tuples=series.map(item=>['series',item.id,version(versions,'series',item.id)]),shifts=new Map(flatten(studio).filter(row=>row.kind==='shift').map(row=>[row.id,row]));
    for(const encoded of Object.keys(versions||{})){let pair;try{pair=JSON.parse(encoded);}catch{continue;}if(Array.isArray(pair)&&pair.length===2&&pair[0]==='shift'&&!shifts.has(pair[1]))shifts.set(pair[1],{id:pair[1],value:null});}
    for(const shift of shifts.values())if(ids.has(shift.value?.edit?.seriesId)||series.some(item=>shift.id.startsWith(item.id+'@')))tuples.push(['shift',shift.id,version(versions,'shift',shift.id)]);
    return canonical(tuples.sort((a,b)=>key(a[0],a[1])<key(b[0],b[1])?-1:key(a[0],a[1])>key(b[0],b[1])?1:0));
  }
  function dependencies(base,changes,versions={}){
    const all=new Map((base.series||[]).map(item=>[item.id,item])),parents=new Set(),groups=new Set(),rows=new Map(flatten(base).map(row=>[key(row.kind,row.id),row]));
    for(const change of changes||[]){
      if(change.kind==='series'){
        const previous=all.get(change.id);if(previous)groups.add(previous.groupId||previous.id);if(change.value)groups.add(change.value.groupId||change.id);
      }
      if(change.kind==='shift'){
        const old=rows.get(key('shift',change.id))?.value,explicit=[old?.edit?.seriesId,change.value?.edit?.seriesId].filter(Boolean);
        for(const id of explicit)parents.add(id);
        for(const id of all.keys())if(change.id.startsWith(id+'@'))parents.add(id);
      }
    }
    return {series:[...parents].sort().map(id=>({id,expectedVersion:version(versions,'series',id)})),groups:[...groups].sort().map(id=>({id,signature:groupSignature(base,versions,id)}))};
  }
  function checkDependencies(current,versions,deps,changes=[]){
    const errors=validateDependencies(deps);if(errors.length)return {ok:false,conflicts:[{kind:'coverage',id:'dependencies'}]};
    const conflicts=[];
    for(const parent of deps.series)if(version(versions,'series',parent.id)!==parent.expectedVersion)conflicts.push({kind:'series',id:parent.id});
    for(const group of deps.groups)if(groupSignature(current,versions,group.id)!==group.signature)conflicts.push({kind:'group',id:group.id});
    const required=dependencies(current,changes,versions);
    for(const parent of required.series)if(!deps.series.some(item=>item.id===parent.id))conflicts.push({kind:'coverage',id:parent.id});
    for(const group of required.groups)if(!deps.groups.some(item=>item.id===group.id))conflicts.push({kind:'coverage',id:group.id});
    return {ok:conflicts.length===0,conflicts};
  }
  function safeJson(value,depth=0){
    if(depth>128)return false;if(value===null||typeof value==='string'||typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value);
    if(Array.isArray(value))return value.every(item=>safeJson(item,depth+1));if(!record(value))return false;
    return Object.keys(value).every(name=>!forbidden.has(name)&&safeJson(value[name],depth+1));
  }
  function validateChanges(changes){
    if(!Array.isArray(changes)||changes.length>20000)return ['Send højst 20.000 planændringer ad gangen.'];const seen=new Set();
    for(const change of changes){
      if(!record(change)||Object.keys(change).some(name=>!['kind','id','expectedVersion','value'].includes(name))||!KINDS.includes(change.kind)||!validId(change.id)||!Number.isSafeInteger(change.expectedVersion)||change.expectedVersion<0||change.expectedVersion>=Number.MAX_SAFE_INTEGER||!Object.hasOwn(change,'value')||!safeJson(change.value))return ['En planændring er ugyldig.'];
      const id=key(change.kind,change.id);if(seen.has(id))return ['En post må kun ændres én gang pr. handling.'];seen.add(id);
      if(change.value===null)continue;
      if(!record(change.value))return ['En planændring skal indeholde et objekt eller en sletning.'];
      if(change.kind==='series'&&change.value.id!==change.id)return ['Vagtseriens id stemmer ikke overens med ændringen.'];
      if(change.kind==='shift'&&(Object.keys(change.value).some(name=>!['edit','suppressed'].includes(name))||!Object.hasOwn(change.value,'edit')||typeof change.value.suppressed!=='boolean'||change.value.edit!==null&&(!record(change.value.edit)||change.value.edit.id!==change.id)||change.value.edit===null&&!change.value.suppressed))return ['Vagtens redigering og sletning er ugyldig.'];
      if(change.kind==='week'&&!/^-?\d{1,10}$/.test(change.id))return ['Ugens id er ugyldigt.'];
    }
    return [];
  }
  function validateDependencies(deps){
    if(!record(deps)||Object.keys(deps).some(name=>!['series','groups'].includes(name))||!Array.isArray(deps.series)||!Array.isArray(deps.groups)||deps.series.length>20000||deps.groups.length>20000)return ['Planens afhængigheder er ugyldige.'];
    for(const [kind,items]of [['series',deps.series],['groups',deps.groups]]){const seen=new Set();for(const item of items){if(!record(item)||!validId(item.id)||seen.has(item.id)||Object.keys(item).some(name=>!(kind==='series'?['id','expectedVersion']:['id','signature']).includes(name)))return ['Planens afhængigheder er ugyldige.'];seen.add(item.id);if(kind==='series'?(!Number.isSafeInteger(item.expectedVersion)||item.expectedVersion<0||item.expectedVersion>=Number.MAX_SAFE_INTEGER):(typeof item.signature!=='string'||item.signature.length>1536*1024))return ['Planens afhængigheder er ugyldige.'];}}
    return [];
  }
  function validatePlanning(value){
    if(!record(value)||Object.keys(value).some(name=>!['version','changes','metadataChanged','metadataBase','dependencies'].includes(name))||value.version!==1||typeof value.metadataChanged!=='boolean'||typeof value.metadataBase!=='string'||!value.metadataBase.length||value.metadataBase.length>512)return ['Planens versionsoplysninger er ugyldige.'];
    return [...validateChanges(value.changes),...validateDependencies(value.dependencies)];
  }
  const api=Object.freeze({KINDS,RECORD_FIELDS,SERVER_FIELDS,PREFS,canonical,key,flatten,diff,commands,apply,metadata,payloadStudio,merge,rebaseWeek,dependencies,checkDependencies,groupSignature,validateChanges,validateDependencies,validatePlanning,assertDetails,instructionState:Instructions});
  globalThis.CleanRoomsPlanningRecords=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
