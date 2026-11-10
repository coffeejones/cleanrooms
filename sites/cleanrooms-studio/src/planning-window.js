/* A calendar window is complete only after every revision-pinned page is collected. */
(() => {
  'use strict';
  const Planning=globalThis.CleanRoomsPlanningRecords||(typeof require==='function'?require('./planning-records.js'):null);
  const Scope=globalThis.CleanRoomsPlanningScope||(typeof require==='function'?require('./planning-scope.js'):null);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const validRecordWindow=value=>record(value)&&Object.keys(value).length===4&&['from','to','origin','parent'].every(key=>Object.hasOwn(value,key))&&['from','to','origin'].every(key=>value[key]===null||validDate(value[key]))&&(value.from===null)===(value.to===null)&&(value.from===null||value.from<=value.to)&&(value.parent===null||typeof value.parent==='string'&&(Scope?Scope.validId(value.parent):value.parent.length>0));
  function normalize(projection){
    if(Scope)return Scope.normalize(projection);
    if(!record(projection)||Object.keys(projection).some(key=>!['mode','from','to'].includes(key))||projection.mode!=='calendar'||!validDate(projection.from)||!validDate(projection.to)||projection.to<projection.from||(Date.parse(projection.to)-Date.parse(projection.from))/86400000>=56)throw new TypeError('Vælg en gyldig kalenderperiode på højst otte uger.');
    return {mode:'calendar',from:projection.from,to:projection.to};
  }
  function covers(projection,from,to=from){if(projection?.catalogOnly===true)return false;const calendar=projection?.mode==='calendar'?projection:projection?.calendar;return !projection||Boolean(calendar&&validDate(from)&&validDate(to)&&from>=calendar.from&&to<=calendar.to&&to>=from);}
  const compact=(kind,value)=>Object.fromEntries((kind==='series'?['id','groupId','person','site','startDate','endDate','openEnded','weekdays','start','end','plannedBreakMinutes','dayTimes','weekInterval','weekAnchor']:['id','seriesId','person','site','date','start','end','plannedBreakMinutes']).filter(name=>Object.hasOwn(value,name)).map(name=>[name,clone(value[name])]));
  function summaryRows(rows,{published=false,description=false}={}){
    const result={series:[],edits:{},deleted:[],...(published?{published:[],demoSeed:false}:{})};
    for(const row of rows){
      if(!record(row)||!['series','shift',...(published?['published']:[])].includes(row.kind)||typeof row.id!=='string'||Scope&&!Scope.validId(row.id)||!record(row.value)||row.kind==='series'&&row.value.id!==row.id||row.kind==='published'&&row.value.id!==row.id)throw new TypeError('Kalenderens sammendrag er ugyldigt.');
      if(row.kind==='series'){const value=compact('series',row.value);if(description)value.hasDescription=row.hasDescription===true;result.series.push(value);}
      else if(row.kind==='published')result.published.push(compact('shift',row.value));
      else{
        if(Planning.validateChanges([{kind:'shift',id:row.id,expectedVersion:1,value:row.value}]).length)throw new TypeError('Kalenderens sammendrag er ugyldigt.');
        if(row.value.edit){const value=compact('shift',row.value.edit);if(description)value.hasDescription=row.hasDescription===true;Object.defineProperty(result.edits,row.id,{value,enumerable:true,writable:true,configurable:true});}
        if(row.value.suppressed)result.deleted.push(row.id);
      }
    }
    return result;
  }
  function collector(projection,{maxRecords=50000,maxBytes=64*1024*1024}={}){
    const scope=normalize(projection),records=new Map(),publications=new Map(),absences=new Map(),availability=new Map(),catalog=new Map(),windows=new Map(),progress={},versions={},cursors=new Set();
    let first=null,revision=null,metadataHash=null,complete=false,bytes=0,windowsProvided=false;
    const bad=()=>{throw new TypeError('Kalenderen er ændret under indlæsningen. Hent perioden igen.');};
    function remember(map,key,value){if(map.has(key)&&Planning.canonical(map.get(key))!==Planning.canonical(value))bad();map.set(key,clone(value));}
    function rememberRecord(row){
      const key=Planning.key(row.kind,row.id),previous=records.get(key);if(!previous||Planning.canonical(previous)===Planning.canonical(row)){records.set(key,clone(row));return;}
      const beforeDeferred=Planning.instructionState?.contains(previous.value),afterDeferred=Planning.instructionState?.contains(row.value);
      // Operation selections intentionally include a compact calendar first and
      // then complete selected records from the exact same immutable generation.
      if(Scope&&previous.version===row.version&&beforeDeferred!==afterDeferred&&Planning.canonical({...previous,value:Scope.compact(row.kind,row.id,previous.value)})===Planning.canonical({...row,value:Scope.compact(row.kind,row.id,row.value)})){if(beforeDeferred)records.set(key,clone(row));return;}
      bad();
    }
    function add(page){
      if(complete||!record(page)||page.ok===false||!Number.isSafeInteger(page.revision)||page.revision<0||!record(page.planning)||page.planning.schema!==1||page.planning.partial!==true||Planning.canonical(normalize(page.planning.projection))!==Planning.canonical(scope)||!record(page.planning.versions)||typeof page.planning.metadataHash!=='string')bad();
      if(page.planning.absenceVersion!==undefined&&(!Number.isSafeInteger(page.planning.absenceVersion)||page.planning.absenceVersion<0))bad();
      if(page.directory!==undefined&&(!record(page.directory)||page.directory.schema!==1||!Number.isSafeInteger(page.directory.revision)||page.directory.revision<0))bad();
      bytes+=new TextEncoder().encode(JSON.stringify(page)).byteLength;if(bytes>maxBytes)throw new RangeError('Kalenderperioden indeholder for mange data. Vælg en kortere periode.');
      if(first===null){if(!record(page.studio)||scope.mode!=='calendar'&&!record(page.selection))bad();first=clone(page);revision=page.revision;metadataHash=page.planning.metadataHash;}
      else if(page.accessIdentity!==first.accessIdentity||page.revision!==revision||page.planning.metadataHash!==metadataHash||page.planning.absenceVersion!==first.planning.absenceVersion||page.directory!==undefined&&(!record(page.directory)||page.directory.schema!==1||page.directory.revision!==first.directory?.revision)||page.studio!==undefined&&Planning.canonical(page.studio)!==Planning.canonical(first.studio)||page.selection!==undefined&&Planning.canonical(page.selection)!==Planning.canonical(first.selection)||page.workspace?.id&&page.workspace.id!==first.workspace?.id||page.viewer?.userId&&page.viewer.userId!==first.viewer?.userId)bad();
      for(const [key,value]of Object.entries(page.planning.versions)){if(!Number.isSafeInteger(value)||value<1||Object.hasOwn(versions,key)&&versions[key]!==value)bad();Object.defineProperty(versions,key,{value,enumerable:true,writable:true,configurable:true});}
      if(page.planning.recordWindows!==undefined){
        const value=page.planning.recordWindows;if(!record(value)||Object.keys(value).length!==Object.keys(page.planning.versions).length)bad();windowsProvided=true;
        for(const [key,window]of Object.entries(value)){if(!Object.hasOwn(page.planning.versions,key)||!validRecordWindow(window))bad();remember(windows,key,window);}
      }
      if(page.planning.deferred!==undefined){if(!Array.isArray(page.planning.deferred)||page.planning.deferred.some(key=>typeof key!=='string'||!Number.isSafeInteger(page.planning.versions[key])||page.planning.versions[key]<1))bad();}
      if(!Array.isArray(page.records||[])||!Array.isArray(page.publicationRows||[])||!Array.isArray(page.auxRows||[]))bad();
      // Catalog summaries never become calendar or editable-record authority.
      if(scope.catalogOnly===true&&(Object.keys(page.planning.versions).length||(page.records||[]).length||(page.publicationRows||[]).length||Object.keys(page.progress||{}).length||(page.auxRows||[]).some(row=>row?.kind!=='catalog')||page.selection!==undefined&&page.selection.catalogOnly!==true))bad();
      for(const row of page.records||[]){if(!record(row)||!['series','shift','week'].includes(row.kind)||typeof row.id!=='string'||!Number.isSafeInteger(row.version)||row.version<1||!Object.hasOwn(row,'value')||versions[Planning.key(row.kind,row.id)]!==row.version||Planning.validateChanges([{kind:row.kind,id:row.id,expectedVersion:row.version,value:row.value}]).length)bad();rememberRecord(row);}
      for(const row of page.publicationRows||[]){if(!record(row)||!['state','scope','shift'].includes(row.kind)||typeof row.id!=='string'||!record(row.value))bad();remember(publications,Planning.key(row.kind,row.id),row);}
      for(const row of page.auxRows||[]){
        if(!record(row)||!['absence','availability','catalog'].includes(row.kind)||typeof row.id!=='string'||!record(row.value))bad();
        if(row.kind==='absence'){if(row.value.id!==row.id)bad();remember(absences,row.id,row.value);}
        else{const target=row.kind==='availability'?availability:catalog;summaryRows([row.value],{published:row.kind==='availability',description:row.kind==='catalog'});remember(target,Planning.key(row.value.kind,row.value.id),row.value);}
      }
      for(const [key,value]of Object.entries(page.progress||{})){if(Object.hasOwn(progress,key)&&Planning.canonical(progress[key])!==Planning.canonical(value))bad();Object.defineProperty(progress,key,{value:clone(value),enumerable:true,writable:true,configurable:true});}
      if(records.size+publications.size+absences.size+availability.size+catalog.size>maxRecords)throw new RangeError('Kalenderperioden indeholder for mange poster. Vælg en kortere periode.');
      if(page.nextCursor!==null&&page.nextCursor!==undefined){if(typeof page.nextCursor!=='string'||!page.nextCursor||cursors.has(page.nextCursor))bad();cursors.add(page.nextCursor);return page.nextCursor;}
      complete=true;return null;
    }
    function finish(){
      if(!complete||!first)throw new TypeError('Kalenderperioden er ikke færdigindlæst.');
      if(windowsProvided&&(windows.size!==Object.keys(versions).length||Object.keys(versions).some(key=>!windows.has(key))))bad();
      const studio=Planning.apply({...clone(first.studio),series:[],edits:{},deleted:[],weekPlans:{}},[...records.values()]);
      const state=scope.catalogOnly===true?{present:false,value:{version:1,sequence:0}}:publications.get(Planning.key('state','state'))?.value;if(!state||typeof state.present!=='boolean'||!record(state.value)||state.value.version!==1||!Number.isSafeInteger(state.value.sequence)||state.value.sequence<0)bad();const header=state.value,slots={};
      for(const row of publications.values())if(row.kind==='scope'){if(!record(row.value.value))bad();slots[row.id]={...clone(row.value.value),shifts:[]};}
      for(const row of publications.values())if(row.kind==='shift'){const {scopeKey,shift}=row.value;if(typeof scopeKey!=='string'||!slots[scopeKey]||!record(shift)||shift.id!==row.id)bad();slots[scopeKey].shifts.push(clone(shift));}
      for(const slot of Object.values(slots))slot.shifts.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
      if(!state.present){if(Object.keys(slots).length)bad();delete studio.publications;}else studio.publications={version:1,sequence:header.sequence,scopeLinks:clone(header.scopeLinks||[]),slots,records:[]};
      studio.absences=[...absences.values()];studio.requests=Object.fromEntries(studio.absences.map(item=>[item.id,item.status]));studio.leaveDecisions=Object.fromEntries(studio.absences.filter(item=>item.decision).map(item=>[item.id,clone(item.decision)]));studio.checklistProgress=clone(progress);
      const deferred=[...records].filter(([key,row])=>row.kind!=='week'&&Planning.instructionState?.contains(row.value)).map(([key])=>key);
      const result={...clone(first),studio,planning:{schema:1,partial:true,projection:clone(scope),versions:clone(versions),metadataHash,recordOrder:Object.fromEntries([...records].map(([key,row])=>[key,row.sortOrder??0])),...(windowsProvided?{recordWindows:Object.fromEntries(windows)}:{}),...(first.planning.absenceVersion!==undefined?{absenceVersion:first.planning.absenceVersion}:{}),...(first.planning.deferred!==undefined||deferred.length?{deferred}: {})},nextCursor:null};
      if(scope.catalogOnly!==true&&(scope.mode!=='calendar'||availability.size))result.availability=summaryRows([...availability.values()],{published:true});
      if(scope.mode!=='calendar'||catalog.size)result.catalog=summaryRows([...catalog.values()],{description:true});
      delete result.records;delete result.publicationRows;delete result.auxRows;delete result.progress;
      return result;
    }
    return {add,finish,get complete(){return complete;}};
  }
  const api=Object.freeze({normalize,covers,collector,validRecordWindow});globalThis.CleanRoomsPlanningWindow=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
