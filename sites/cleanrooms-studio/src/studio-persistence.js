/* Serial, revision-checked cloud saves through a source-bound MessageChannel. */
(() => {
  function create({onStatus = () => {},onSaved = () => {},onReconciled = () => {},onAccessChanged = () => {}} = {}) {
    let port = null, connection = null, nextId = 0, revision = 0, ready = false;
    let pending = null, running = false, ticket = 0, timer = null, failed = false;
    const requests = new Map(), waiters = [], idle = [];
    let preferencePending=null,preferenceActive=null,preferencePromise=null,preferenceTimer=null,preferenceEpoch=0,preferenceValues=null,preferenceError='';
    const preferenceWaiters=[];
    let loadGeneration = 0, loading = false,workflowReviewedRevision=null;
    const Planning=globalThis.CleanRoomsPlanningRecords,Window=globalThis.CleanRoomsPlanningWindow,Scope=globalThis.CleanRoomsPlanningScope;
    const Instructions=globalThis.CleanRoomsInstructions||Planning?.instructionState;
    const Viewport=globalThis.CleanRoomsPlanningViewport;let viewportCache=Viewport?.create();
    const WARM_RETENTION_WEEKS=12;
    let warmEpoch=0,warmJob=null;
    const freshViewportCache=()=>Viewport.create({maxWeeks:viewportCache?.inspect?.maxWeeks||4});
    let accessEpoch=0;
    let acknowledged=null,planning=null,activeItem=null,reconciliationGeneration=0,projection=null,lastLoaded=null,coverageValid=true;
    let detailCoverage=new Set();
    const copy = value => JSON.parse(JSON.stringify(value));
    const jsonBytes=value=>{const json=JSON.stringify(value);return typeof TextEncoder==='function'?new TextEncoder().encode(json).length:encodeURIComponent(json).replace(/%[A-Fa-f0-9]{2}/g,'x').length;};
    const scopeData=()=>Object.fromEntries(['selection','availability','catalog','directory'].filter(field=>lastLoaded?.[field]!==undefined).map(field=>[field,copy(lastLoaded[field])]));
    const modern=value=>Boolean(Planning&&value?.schema===1&&value.versions&&typeof value.versions==='object'&&!Array.isArray(value.versions)&&typeof value.metadataHash==='string'&&value.metadataHash.length);
    const preferences=studio=>Object.fromEntries(Object.entries(studio||{}).filter(([name])=>Planning.PREFS.includes(name)));
    const withPreferences=studio=>preferenceValues?{...studio,...copy(preferenceValues)}:studio;
    function settlePreferenceWaiters(result,through=Infinity){
      for(let i=preferenceWaiters.length-1;i>=0;i--)if(preferenceWaiters[i].ticket<=through){const waiter=preferenceWaiters.splice(i,1)[0];waiter.resolve(waiter.structured?copy(result):result.ok===true);}
    }
    function cancelPreferences(result={ok:false,status:409,superseded:true,message:'Visningen er ændret. Prøv igen.'}){
      preferenceEpoch++;clearTimeout(preferenceTimer);preferenceTimer=null;preferencePending=null;preferenceValues=null;preferenceError='';
      settlePreferenceWaiters(result);
    }
    function queuePreferences(values,{structured=false,merge=false}={}){
      const current=++ticket;preferenceValues=merge?{...preferences(acknowledged),...preferenceValues,...copy(values)}:copy(values);preferencePending={values:copy(preferenceValues),ticket:current};preferenceError='';
      const promise=new Promise(resolve=>preferenceWaiters.push({ticket:current,resolve,structured}));onStatus({state:'saving',message:'Gemmer ændringer…'});
      clearTimeout(preferenceTimer);preferenceTimer=setTimeout(flushPreferences,120);return promise;
    }
    function preferenceStatus(){
      if(preferenceError)return {state:'error',message:preferenceError};
      return preferencePending||preferenceActive?.epoch===preferenceEpoch?{state:'saving',message:'Gemmer ændringer…'}:null;
    }
    function savedStatus(message='Alle ændringer er gemt'){
      if(loading||failed)return;
      if(pending||running){onStatus({state:'saving',message:'Gemmer ændringer…'});return;}
      onStatus(preferenceStatus()||{state:'saved',message});
    }
    function resumeQueued(){
      idle.splice(0).forEach(resolve=>resolve());
      if(!ready||loading||failed)return;
      if(pending)flush();else if(preferencePending&&!preferenceError)flushPreferences();
    }
    function preferenceOnly(item){
      return Boolean(planning&&!pending&&!activeItem&&item.versions&&Planning.canonical(Planning.metadata(acknowledged))===Planning.canonical(Planning.metadata(item.studio))&&!Planning.commands(acknowledged,item.studio,item.versions).some(change=>change.kind!=='week'));
    }
    function acknowledgeQueuedPreferences(item){
      if(!planning||!preferencePending||preferencePending.ticket>item.ticket||Planning.canonical(preferencePending.values)!==Planning.canonical(preferences(item.studio)))return;
      const covered=preferencePending;preferencePending=null;preferenceError='';clearTimeout(preferenceTimer);preferenceTimer=null;
      settlePreferenceWaiters({ok:true,status:200,preferences:copy(covered.values)},covered.ticket);
    }
    function flushPreferences(){
      clearTimeout(preferenceTimer);preferenceTimer=null;
      if(preferencePromise||!ready||loading||running||pending||failed||!preferencePending)return preferencePromise;
      const item=preferencePending,epoch=preferenceEpoch;preferencePending=null;preferenceActive={...item,epoch};preferenceError='';
      const work=(async()=>{
        try{
          const result=await request('account',{operation:'preferences',payload:{preferences:copy(item.values)}});
          if(epoch!==preferenceEpoch)return;
          if(result.status===401||result.status===403){
            cancelPreferences({ok:false,status:result.status,message:result.message||'Din adgang er ændret.'});cancelWarmViewport();loadGeneration++;ready=false;coverageValid=false;failed=true;pending=null;clearTimeout(timer);viewportCache?.clear();detailCache.clear();detailFreshness.clear();detailCoverage.clear();
            waiters.splice(0).forEach(waiter=>waiter.resolve(false));
            onStatus({state:'error',conflict:true,message:result.message||'Din adgang er ændret. Hent den seneste version, før du fortsætter.'});return;
          }
          if(!result.ok)throw Object.assign(new Error(result.message||'Visningsindstillingerne er ikke gemt. Prøv igen.'),{status:result.status});
          // A preference reply carries no planning authority. It cannot replay
          // the old projection, row versions or an older navigation intent.
          if(acknowledged)acknowledged=withPreferences(acknowledged);
          if(lastLoaded?.studio)lastLoaded.studio=withPreferences(lastLoaded.studio);
          onSaved({ok:true,preferencesOnly:true,revision,planning:copy(planning),preferences:preferences(result.preferences||item.values)});
          settlePreferenceWaiters({ok:true,status:result.status||200,preferences:preferences(result.preferences||item.values)},item.ticket);
        }catch(error){
          if(epoch!==preferenceEpoch)return;
          preferencePending??={...item,values:copy(preferenceValues||item.values)};preferenceError=error?.message||'Visningsindstillingerne er ikke gemt. Prøv igen.';
          settlePreferenceWaiters({ok:false,status:error?.status||503,message:preferenceError});
        }finally{
          if(preferencePromise===work){preferencePromise=null;preferenceActive=null;}
          resumeQueued();savedStatus();
        }
      })();
      preferencePromise=work;return work;
    }
    function capture(studio){
      const item={studio:copy(studio),projection:copy(projection),directoryRevision:lastLoaded?.directory?.revision};if(!planning)return item;
      Planning.assertDetails?.(acknowledged,item.studio,planning.deferred||[]);
      item.base=copy(acknowledged);item.versions=copy(planning.versions);item.metadataBase=planning.metadataHash;
      const inherited=pending||activeItem,changes=Planning.commands(acknowledged,item.studio,item.versions);
      item.dependencies=Planning.dependencies(acknowledged,changes,item.versions);
      if(inherited?.versions){
        const dirty=new Set(Planning.commands(acknowledged,inherited.studio,inherited.versions).map(change=>Planning.key(change.kind,change.id)));
        for(const change of changes){const key=Planning.key(change.kind,change.id);if(dirty.has(key))item.versions[key]=inherited.versions[key]??0;}
        for(const kind of ['series','groups'])item.dependencies[kind]=item.dependencies[kind].map(dependency=>copy(inherited.dependencies?.[kind]?.find(old=>old.id===dependency.id)||dependency));
        if(Planning.canonical(Planning.metadata(acknowledged))!==Planning.canonical(Planning.metadata(item.studio))&&Planning.canonical(Planning.metadata(acknowledged))!==Planning.canonical(Planning.metadata(inherited.studio)))item.metadataBase=inherited.metadataBase;
      }
      return item;
    }
    function envelope(item){
      const changes=Planning.commands(acknowledged,item.studio,item.versions),required=Planning.dependencies(acknowledged,changes,item.versions),original=Planning.dependencies(item.base||acknowledged,changes,item.versions);
      for(const kind of ['series','groups'])for(const dependency of original[kind])if(!required[kind].some(entry=>entry.id===dependency.id))required[kind].push(dependency);
      const dependencies={series:[],groups:[]};
      for(const kind of ['series','groups'])dependencies[kind]=required[kind].map(dependency=>copy(item.dependencies?.[kind]?.find(old=>old.id===dependency.id)||dependency));
      return {version:1,changes,metadataChanged:Planning.canonical(Planning.metadata(acknowledged))!==Planning.canonical(Planning.metadata(item.studio)),metadataBase:item.metadataBase,dependencies};
    }
    function writePayload(item,publication){
      if(!planning)return {revision,studio:item.studio,...(publication?{publication:copy(publication)}:{})};
      const command=envelope(item);return {revision,studio:Planning.payloadStudio(item.studio),planning:command,...(planning.deferred!==undefined?{instructions:'deferred'}:{}),...(!command.metadataChanged?{commandReceipt:'records'}:{}),...(Number.isSafeInteger(item.directoryRevision)?{directoryRevision:item.directoryRevision}:{}),...(item.projection?{projection:copy(item.projection)}:{}),...(publication?{publication:copy(publication)}:{})};
    }
    async function sendDraft(item,payload){
      if(payload.planning&&!payload.publication&&!payload.planning.metadataChanged&&!payload.planning.changes.some(change=>change.kind!=='week')){
        const preferences=Object.fromEntries(Object.entries(item.studio).filter(([name])=>Planning.PREFS.includes(name)));
        const result=await request('account',{operation:'preferences',payload:{preferences}});
        if(!result.ok)return result;
        // Preference replies never authorize a newer plan or entity generation.
        return {ok:true,revision,planning:copy(planning),preferences:copy(result.preferences||preferences)};
      }
      return request('write',payload);
    }
    function advanceDependencies(deps,command,before,after,nextPlanning){
      const result=copy(deps||{series:[],groups:[]}),writtenSeries=new Set(command.changes.filter(change=>change.kind==='series').map(change=>change.id));
      const oldSeries=new Map((before.series||[]).map(series=>[series.id,series])),newSeries=new Map((after.series||[]).map(series=>[series.id,series]));
      for(const parent of result.series)if(writtenSeries.has(parent.id))parent.expectedVersion=nextPlanning.versions[Planning.key('series',parent.id)]??0;
      for(const group of result.groups){
        const ownSeries=command.changes.some(change=>change.kind==='series'&&[(oldSeries.get(change.id)?.groupId||oldSeries.get(change.id)?.id),(newSeries.get(change.id)?.groupId||newSeries.get(change.id)?.id)].includes(group.id));
        if(ownSeries){group.signature=Planning.groupSignature(after,nextPlanning.versions,group.id);continue;}
        let tuples;try{tuples=JSON.parse(group.signature);}catch{continue;}
        const actual=JSON.parse(Planning.groupSignature(after,nextPlanning.versions,group.id));
        for(const change of command.changes.filter(change=>change.kind==='shift')){
          const old=tuples.findIndex(tuple=>tuple[0]==='shift'&&tuple[1]===change.id),current=actual.find(tuple=>tuple[0]==='shift'&&tuple[1]===change.id);
          if(old>=0)tuples.splice(old,1);if(current)tuples.push(current);
        }
        group.signature=Planning.canonical(tuples.sort((a,b)=>Planning.key(a[0],a[1])<Planning.key(b[0],b[1])?-1:Planning.key(a[0],a[1])>Planning.key(b[0],b[1])?1:0));
      }
      return result;
    }
    function recordAcknowledgment(result,item,payload){
      if(result.recordPatch!==true)return;
      if(!planning||!Scope||!Array.isArray(result.reconciledRecords)||!modern(result.planning)||!payload.planning||payload.planning.metadataChanged||result.planning.metadataHash!==payload.planning.metadataBase)throw new Error('Ændringens kvittering er ugyldig. Hent det berørte område igen.');
      const own=new Map(payload.planning.changes.map(change=>[Planning.key(change.kind,change.id),change])),seen=new Set();
      for(const row of result.reconciledRecords){
        const key=Planning.key(row?.kind,row?.id),change=own.get(key);
        const versionMatches=change&&(row.kind==='week'?row.version>=change.expectedVersion:row.version===change.expectedVersion+1||row.version===change.expectedVersion&&Planning.canonical(row.value)===Planning.canonical(change.value));
        if(!change||seen.has(key)||!Number.isSafeInteger(row.version)||row.version<1||!versionMatches||result.planning.versions[key]!==row.version||Planning.validateChanges([{kind:row.kind,id:row.id,value:row.value,expectedVersion:row.version}]).length)throw new Error('Ændringens postversioner stemmer ikke overens. Hent området igen.');
        seen.add(key);
      }
      if(Object.keys(result.planning.versions).some(key=>!seen.has(key))||payload.planning.changes.some(change=>change.kind!=='week'&&!seen.has(Planning.key(change.kind,change.id))))throw new Error('Ændringens kvittering mangler berørte poster. Hent området igen.');
      result.reconciledStudio=Planning.apply(item.studio,result.reconciledRecords);
      result.planning={...copy(planning),...copy(result.planning),versions:{...copy(planning.versions),...copy(result.planning.versions)}};
      for(const field of ['availability','catalog']){
        if(!lastLoaded?.[field]||result[field]!==undefined)continue;
        const rows=result.reconciledRecords.filter(row=>row.kind!=='week').map(row=>{
          const summary=Scope.summary(row.kind,row.id,row.value),value=copy(summary.value);
          if(field==='catalog'&&value){if(row.kind==='series')value.hasDescription=summary.hasDescription;else if(value.edit)value.edit.hasDescription=summary.hasDescription;}
          return {...row,value};
        });
        const summary=Planning.apply(lastLoaded[field],rows);delete summary.weekPlans;result[field]=summary;
      }
      if(result.requiresRefresh===true||item.projection&&payload.planning.changes.some(change=>change.kind==='series'))coverageValid=false;
    }
    function acknowledge(result,item,payload){
      if(result.revision!==revision||result.requiresRefresh===true)viewportCache?.clear();
      recordAcknowledgment(result,item,payload);
      if(planning&&!modern(result.planning))throw new Error('Planens versionsoplysninger mangler. Hent den seneste version.');
      if(item.projection&&(!result.planning?.partial||Planning.canonical(Window.normalize(result.planning.projection))!==Planning.canonical(item.projection)))throw new Error('Kalenderens gemte periode stemmer ikke overens. Hent perioden igen.');
      if(revision!==result.revision)detailCoverage.clear();revision=result.revision;
      if(!planning)return;
      const before=acknowledged,next=withPreferences(copy(result.reconciledStudio||item.studio)),nextPlanning=copy(result.planning),command=payload.planning;
      if(planning.deferred!==undefined||nextPlanning.deferred!==undefined)nextPlanning.deferred=Planning.flatten(next).filter(row=>row.kind!=='week'&&Instructions?.contains(row.value)).map(row=>Planning.key(row.kind,row.id));
      if(item.projection)for(const field of ['absences','requests','leaveDecisions'])if(next[field]===undefined&&before[field]!==undefined)next[field]=copy(before[field]);
      for(const field of ['publications','activity','checklistProgress','leaveDecisions'])if(result[field]!==undefined)next[field]=copy(result[field]);
      if(pending?.versions){
        pending.studio=Planning.merge(item.studio,pending.studio,next);
        for(const change of command.changes)pending.versions[Planning.key(change.kind,change.id)]=nextPlanning.versions[Planning.key(change.kind,change.id)]??0;
        pending.dependencies=advanceDependencies(pending.dependencies,command,before,next,nextPlanning);
        pending.base=Planning.apply(pending.base||before,command.changes);
        if(command.metadataChanged||Planning.canonical(Planning.metadata(item.studio))===Planning.canonical(Planning.metadata(pending.studio)))pending.metadataBase=nextPlanning.metadataHash;
      }
      acknowledged=next;planning=nextPlanning;projection=planning.partial?Window.normalize(planning.projection):null;
      for(const field of ['selection','availability','catalog'])if(result[field]!==undefined){lastLoaded??={};lastLoaded[field]=copy(result[field]);}
      if(result.reconciledStudio){if(Planning.diff(item.studio,next).some(change=>change.kind!=='week')||Planning.canonical(Planning.metadata(item.studio))!==Planning.canonical(Planning.metadata(next)))reconciliationGeneration++;onReconciled(copy(pending?.studio||next),{submitted:copy(item.studio),acknowledged:copy(next),previous:copy(before),...scopeData()});}
    }
    function connect() {
      if (connection) return connection;
      connection = new Promise((resolve,reject) => {
        const channel = new MessageChannel(); port = channel.port1;
        const deadline = setTimeout(() => { port.close(); port = null; connection = null; reject(new Error('Der er ikke forbindelse til lagringen. Prøv igen.')); },15000);
        port.onmessage = event => {
          const value = event.data;
          if (value?.type === 'cleanrooms-storage-ready') { clearTimeout(deadline); resolve(); return; }
          const request = requests.get(value?.id); if (!request) return;
          requests.delete(value.id); clearTimeout(request.deadline); request.resolve(value);
        };
        port.start(); parent.postMessage({type:'cleanrooms-storage-connect'},'*',[channel.port2]);
      });
      return connection;
    }
    function invalidateAccess(){
      accessEpoch++;loadGeneration++;reconciliationGeneration++;ready=false;failed=true;coverageValid=false;pending=null;acknowledged=null;planning=null;lastLoaded=null;projection=null;cancelPreferences();cancelWarmViewport();viewportCache?.clear();detailCache.clear();detailCacheBytes=0;detailCacheGeneration=null;detailCoverage.clear();detailFreshness.clear();activeItem=null;clearTimeout(timer);waiters.splice(0).forEach(waiter=>waiter.resolve(false));onAccessChanged();
    }
    async function request(action,data = {}) {
      await connect();const id=++nextId,accessAtStart=accessEpoch,superseded=()=>({ok:false,status:403,error:'access_changed',superseded:true,message:'Din adgang er ændret. Visningen genindlæses.'});
      let result;try{result=await new Promise((resolve,reject)=>{
        const clockIn=action==='account'&&data.operation==='timeWrite'&&data.payload?.operation==='start';
        const deadline=setTimeout(()=>{requests.delete(id);reject(new Error('Gemningen tog for lang tid. Prøv igen.'));},clockIn?45000:action==='account'&&data.operation==='payrollPeriodDownload'?180000:30000);
        requests.set(id,{resolve,deadline});port.postMessage({id,action,...data});
      });}catch(error){if(accessAtStart!==accessEpoch)return superseded();throw error;}
      if(accessAtStart!==accessEpoch)return superseded();
      const identityChanged=typeof lastLoaded?.accessIdentity==='string'&&typeof result.accessIdentity==='string'&&result.accessIdentity!==lastLoaded.accessIdentity;
      const revoked=lastLoaded!==null&&(result.status===401||result.status===403&&['membership_changed','membership_disabled','membership_required','membership_invalid','company_access_denied','role_invalid','department_scope_invalid','department_scope_unavailable','department_scope_changed','department_person_forbidden','department_site_forbidden','department_forbidden','department_scope_forbidden','department_directory_forbidden'].includes(result.error));
      if(identityChanged||revoked){invalidateAccess();return superseded();}
      return result;
    }
    async function readProjection(selected,generation,{isCurrent=()=>true}={}){
      if(selected&&!Window)throw new Error('Kalenderens periodeindlæsning er ikke klar. Genindlæs siden.');
      const target=selected?Window.normalize(selected):null;
      for(let attempt=0;attempt<2;attempt++){
        if(generation!==loadGeneration||!isCurrent())return {ok:false,superseded:true};
        let page=await request('read',target?{projection:target,instructions:'deferred'}:{});
        if(generation!==loadGeneration||!isCurrent())return {ok:false,superseded:true};
        if(!page.ok||!target||page.planning?.partial!==true)return page;
        const collected=Window.collector(target);let retry=false;
        for(;;){
          const cursor=collected.add(page);if(!cursor)return collected.finish();
          page=await request('read',{projection:target,cursor,instructions:'deferred'});
          if(generation!==loadGeneration||!isCurrent())return {ok:false,superseded:true};
          if(!page.ok){if(page.status===409&&attempt===0){retry=true;break;}return page;}
        }
        if(!retry)break;
      }
      return {ok:false,status:409,message:'Kalenderen ændrer sig. Prøv at hente perioden igen.'};
    }
    function loadedResult(result){
      const source=result.capabilities;
      const capabilities={manageDepartments:source?.manageDepartments===true,manageSiteGps:source?.manageSiteGps===true,manageAppLogins:source?.manageAppLogins===true,manageUsers:source?.manageUsers===true,manageRoles:source?.manageRoles===true,viewPayroll:source?.viewPayroll===true,managePayroll:source?.managePayroll===true,managePayrollGroups:source?.managePayrollGroups===true,chat:source?.chat===true,manageChat:source?.manageChat===true,plan:source?.plan===true,previewEmployees:source?.previewEmployees===true};
      if(typeof source?.companyPayroll==='boolean')capabilities.companyPayroll=source.companyPayroll;
      if(typeof source?.scopeRestricted==='boolean'){
        capabilities.scopeRestricted=source.scopeRestricted;
        // Calendar generations compare this result with the server projection.
        // An unrestricted scope has null lists; empty lists deny access in a restricted scope.
        if(source.scopeRestricted){
          capabilities.allowedDepartmentIds=Array.isArray(source.allowedDepartmentIds)?source.allowedDepartmentIds.filter(id=>typeof id==='string').slice(0,1000):[];
          capabilities.allowedSiteIds=Array.isArray(source.allowedSiteIds)?source.allowedSiteIds.filter(id=>Number.isInteger(id)&&id>=0&&id<2000):[];
        }else{
          capabilities.allowedDepartmentIds=null;
          capabilities.allowedSiteIds=null;
        }
      }
      return {ok:true,studio:result.studio,employee:result.employee||null,viewer:result.viewer||null,...(typeof result.accessIdentity==='string'?{accessIdentity:result.accessIdentity}:{}),workspace:result.workspace||null,capabilities,...Object.fromEntries(['workflowSummary','planningSummary','selection','availability','catalog','directory'].filter(field=>result[field]!==undefined).map(field=>[field,copy(result[field])]))};
    }
    // A small, private point cache is independent of the compact week cache.
    // Progress is a snapshot valid for at most 30 seconds, per occurrence/person.
    const detailCache=new Map(),detailFreshness=new Map();let detailCacheBytes=0,detailCacheGeneration=null,detailProgressEpoch=0;
    const DETAIL_TTL=30000,DETAIL_MAX_BYTES=8*1024*1024,DETAIL_MAX_ENTRIES=100;
    const detailGeneration=value=>{try{return Viewport?.generation(value,{strict:true})??null;}catch{return null;}};
    const currentDetailGeneration=()=>detailGeneration({revision,planning,directory:lastLoaded?.directory,workspace:lastLoaded?.workspace,viewer:lastLoaded?.viewer,capabilities:lastLoaded?.capabilities});
    function alignDetailCache(stamp=currentDetailGeneration()){if(stamp!==detailCacheGeneration){detailCache.clear();detailCacheBytes=0;detailCacheGeneration=stamp;}return stamp;}
    function invalidateDetailProgress(id){
      detailProgressEpoch++;
      for(const [key,entry]of detailCache)if(!id||Object.hasOwn(entry.people,id)){detailCacheBytes-=entry.bytes;detailCache.delete(key);}
      if(id){detailCoverage.delete(id);detailFreshness.delete(id);}else{detailCoverage.clear();detailFreshness.clear();}
    }
    const detailKey=selected=>Planning.canonical([[...selected.shiftIds].sort(),[...selected.seriesIds].sort()]);
    function detailIdentity(id,studio=acknowledged){
      let source=studio?.edits?.[id];if(!source)source=(studio?.series||[]).filter(series=>id.startsWith(series.id+'@')).sort((one,two)=>two.id.length-one.id.length)[0];
      if(!source)try{source=globalThis.CleanRoomsData?.shiftById(id,studio);}catch{}
      return source?{person:String(source.person??''),token:Instructions?.signature(source)??null}:null;
    }
    function freshDetail(id){const value=detailFreshness.get(id),actual=detailIdentity(id);return Boolean(value&&detailCoverage.has(id)&&actual&&value.stamp===calendarGeneration()&&Planning.canonical(value.identity)===Planning.canonical(actual)&&Date.now()-value.at<DETAIL_TTL&&Date.now()>=value.at);}
    function cachedDetails(selected){
      const stamp=alignDetailCache();if(!stamp||!coverageValid)return null;const key=detailKey(selected),entry=detailCache.get(key);if(!entry)return null;
      if(Date.now()<entry.at||Date.now()-entry.at>=DETAIL_TTL)return null;
      const rows=new Map(Planning.flatten(acknowledged).map(row=>[Planning.key(row.kind,row.id),row]));
      for(const row of entry.result.records){const id=Planning.key(row.kind,row.id),old=rows.get(id);if(!selected.keys.has(id)||planning.versions[id]!==row.version||row.value!==null&&!old||Planning.canonical(Scope.compact(row.kind,row.id,old?.value??null))!==Planning.canonical(Scope.compact(row.kind,row.id,row.value)))return null;}
      for(const [id,version]of Object.entries(entry.result.planning.versions))if(!selected.keys.has(id)||(planning.versions[id]??0)!==version)return null;
      if(selected.shiftIds.some(id=>!entry.people[id]||Planning.canonical(entry.people[id])!==Planning.canonical(detailIdentity(id))))return null;
      detailCache.delete(key);detailCache.set(key,entry);return entry;
    }
    function rememberDetails(selected,result,at){
      const stamp=alignDetailCache();if(!stamp||!coverageValid)return;const key=detailKey(selected),people=Object.fromEntries(selected.shiftIds.map(id=>[id,detailIdentity(id)]));if(Object.values(people).some(value=>!value))return;
      const value={result,people,at,stamp},size=jsonBytes({key,...value});if(size>DETAIL_MAX_BYTES)return;
      const old=detailCache.get(key);if(old){detailCacheBytes-=old.bytes;detailCache.delete(key);}detailCache.set(key,{...copy(value),bytes:size});detailCacheBytes+=size;
      while(detailCache.size>DETAIL_MAX_ENTRIES||detailCacheBytes>DETAIL_MAX_BYTES){const first=detailCache.keys().next().value;detailCacheBytes-=detailCache.get(first).bytes;detailCache.delete(first);}
    }
    function adopt(result,{keepViewport=false}={}){
      const stamp=detailGeneration(result),sameCache=Boolean(stamp&&viewportCache?.generation===stamp);if(!keepViewport&&!sameCache)viewportCache?.clear();alignDetailCache(stamp);
      detailCoverage.clear();detailFreshness.clear();revision=result.revision;acknowledged=withPreferences(copy(result.studio||{}));planning=modern(result.planning)?copy(result.planning):null;projection=planning?.partial?Window.normalize(planning.projection):null;lastLoaded=loadedResult({...result,...(result.studio?{studio:copy(acknowledged)}:{})});coverageValid=true;
      if(!keepViewport&&viewportCache&&projection?.mode==='calendar'){try{if(planning.recordWindows!==undefined&&viewportCache.putRange)viewportCache.putRange(result,{required:projection});else if(Viewport.weeks(projection).length===1)viewportCache.put(result);}catch{viewportCache.clear();}}
      return copy(lastLoaded);
    }
    function currentResult(){return {...copy(lastLoaded||{}),ok:true,studio:copy(acknowledged),cached:true};}
    function detailSelection(value={}){
      if(!value||typeof value!=='object'||value.shiftIds!==undefined&&!Array.isArray(value.shiftIds)||value.seriesIds!==undefined&&!Array.isArray(value.seriesIds))throw new TypeError('Vælg gyldige vagter eller vagtserier.');
      const shiftIds=[...new Set(value.shiftIds||[])],seriesIds=[...new Set(value.seriesIds||[])];
      if(shiftIds.length>20000||seriesIds.length>20000||[...shiftIds,...seriesIds].some(id=>!Scope?.validId(id)))throw new TypeError('Vælg højst 20000 vagter eller vagtserier ad gangen.');
      const parents=new Set(seriesIds),knownSeries=new Set((acknowledged?.series||[]).map(series=>series.id));for(const id of shiftIds){const direct=acknowledged?.edits?.[id]?.seriesId;if(direct)parents.add(direct);for(let index=id.indexOf('@',1);index>0;index=id.indexOf('@',index+1)){const parent=id.slice(0,index);if(knownSeries.has(parent))parents.add(parent);}}
      const keys=new Set([...shiftIds.map(id=>Planning.key('shift',id)),...[...parents].map(id=>Planning.key('series',id))]);
      return {shiftIds,seriesIds,keys};
    }
    function needsDetails(value={}){
      if(!planning||!acknowledged)return false;const selected=detailSelection(value),deferred=new Set(planning.deferred||[]);
      if(planning.deferred!==undefined&&selected.shiftIds.some(id=>!freshDetail(id)))return true;
      const rows=new Map(Planning.flatten(acknowledged).map(row=>[Planning.key(row.kind,row.id),row]));return [...selected.keys].some(key=>deferred.has(key)||Instructions?.contains(rows.get(key)?.value));
    }
    function detailBatches(selected,observedRevision,observedDirectory){
      const result=[];let shift=0,series=0;
      while(shift<selected.shiftIds.length||series<selected.seriesIds.length){const payload={revision:observedRevision,directoryRevision:observedDirectory,shiftIds:[],seriesIds:[]};let bytes=jsonBytes(payload);
        for(const [kind,index]of [['shiftIds','shift'],['seriesIds','series']]){let offset=index==='shift'?shift:series;while(offset<selected[kind].length&&payload[kind].length<500){const id=selected[kind][offset],size=jsonBytes(id)+(payload[kind].length?1:0);if(bytes+size>60*1024)break;payload[kind].push(id);bytes+=size;offset++;}if(index==='shift')shift=offset;else series=offset;}
        if(!payload.shiftIds.length&&!payload.seriesIds.length)throw new Error('En af instruktionernes identiteter fylder for meget til én forespørgsel.');if(!payload.seriesIds.length)delete payload.seriesIds;result.push(payload);
      }return result;
    }
    async function details(value={},{force=false}={}){
      if(typeof cancelWarmViewport==='function')cancelWarmViewport();
      if(!ready||loading)return {ok:false,status:503,message:'Indlæs planen, før du åbner instruktionerne.'};
      let selected;try{selected=detailSelection(value);}catch(error){return {ok:false,status:400,message:error.message};}
      if(!selected.shiftIds.length&&!selected.seriesIds.length)return currentResult();
      await flush();while(running)await new Promise(resolve=>idle.push(resolve));
      if(!ready||loading||failed||pending)return {ok:false,status:409,message:'Gem ændringerne, før du henter instruktionerne.'};
      if(!force&&!needsDetails(selected))return currentResult();
      const generation=++loadGeneration,observedRevision=revision,observedDirectory=lastLoaded?.directory?.revision,observedProjection=copy(projection),previous=copy(acknowledged),observedProgressEpoch=detailProgressEpoch;running=true;
      try{
        const cached=!force?cachedDetails(selected):null,gathered=new Map(),gatheredVersions={},gatheredProgress={},gatheredShifts=new Map();let result=cached?copy(cached.result):null,totalBytes=0;
        for(const payload of cached?[]:detailBatches(selected,observedRevision,observedDirectory)){
          const page=await request('account',{operation:'plannerDetail',payload});
          if(generation!==loadGeneration||!ready||loading||revision!==observedRevision||detailProgressEpoch!==observedProgressEpoch)return {ok:false,superseded:true};
          if(!page.ok)return page;
          if(page.revision!==observedRevision||page.directoryRevision!==observedDirectory||page.planning?.schema!==1||page.planning.metadataHash!==planning.metadataHash||!Array.isArray(page.records))throw new Error('Instruktionerne er ændret under indlæsningen. Hent planen igen.');
          totalBytes+=jsonBytes(page);
          if(totalBytes>64*1024*1024)throw new Error('De valgte instruktioner fylder for meget til én handling. Vælg færre vagter.');
          for(const row of page.records){const key=Planning.key(row?.kind,row?.id);if(gathered.has(key)&&Planning.canonical(gathered.get(key))!==Planning.canonical(row))throw new Error('Instruktionernes postversioner er ændret.');gathered.set(key,row);}
          if(gathered.size>50000)throw new Error('Der er for mange instruktioner til én handling. Vælg færre vagter.');
          for(const [key,version]of Object.entries(page.planning.versions||{})){if(Object.hasOwn(gatheredVersions,key)&&gatheredVersions[key]!==version)throw new Error('Instruktionernes postversioner er ændret.');gatheredVersions[key]=version;}
          Object.assign(gatheredProgress,page.progress||{});for(const shift of page.detailShifts||[])gatheredShifts.set(shift.id,shift);
          result={...page,records:[...gathered.values()],planning:{...page.planning,versions:gatheredVersions},progress:gatheredProgress,detailShifts:[...gatheredShifts.values()]};
        }
        if(generation!==loadGeneration||!ready||loading||revision!==observedRevision||Planning.canonical(projection)!==Planning.canonical(observedProjection)||detailProgressEpoch!==observedProgressEpoch)return {ok:false,superseded:true};
        if(!result.ok)return result;if(pending)return {ok:false,status:409,blocked:true,message:'Der er nye ændringer. Gem dem, før du åbner instruktionerne.'};
        if(result.revision!==observedRevision||result.directoryRevision!==observedDirectory||result.planning?.schema!==1||result.planning.metadataHash!==planning.metadataHash||!Array.isArray(result.records)||!result.planning.versions||typeof result.planning.versions!=='object')throw new Error('Instruktionernes version kunne ikke bekræftes. Hent planen igen.');
        const beforeRows=new Map(Planning.flatten(previous).map(row=>[Planning.key(row.kind,row.id),row])),seen=new Set();
        for(const row of result.records){const key=Planning.key(row?.kind,row?.id),old=beforeRows.get(key),expected=planning.versions[key];
          if(!['series','shift'].includes(row?.kind)||!selected.keys.has(key)||seen.has(key)||!Number.isSafeInteger(row.version)||row.version<1||expected!==undefined&&expected!==row.version||result.planning.versions[key]!==row.version||Planning.validateChanges([{kind:row.kind,id:row.id,value:row.value,expectedVersion:row.version}]).length||Instructions?.contains(row.value))throw new Error('Instruktionernes poster stemmer ikke overens med den viste vagt.');
          if(old?.value&&row.value){const oldValue=row.kind==='shift'?old.value.edit:old.value,nextValue=row.kind==='shift'?row.value.edit:row.value;if(Instructions&&(!Instructions.equal(oldValue,nextValue)||!Instructions.isDeferred(oldValue)&&Planning.canonical(oldValue)!==Planning.canonical(nextValue))||Scope&&Planning.canonical(Scope.compact(row.kind,row.id,old.value))!==Planning.canonical(Scope.compact(row.kind,row.id,row.value)))throw new Error('Instruktionerne er ændret. Hent planen igen.');}
          seen.add(key);
        }
        for(const [key,version]of Object.entries(result.planning.versions)){if(!selected.keys.has(key)||!Number.isSafeInteger(version)||version<0||version>0&&!seen.has(key)||planning.versions[key]!==undefined&&planning.versions[key]!==version)throw new Error('Instruktionernes postversioner er ugyldige.');}
        const remaining=new Set(planning.deferred||[]);for(const key of seen)remaining.delete(key);
        if([...selected.keys].some(key=>remaining.has(key)))throw new Error('Instruktionerne er ufuldstændige. Hent planen igen.');
        const next=withPreferences(Planning.apply(previous,result.records)),selectedIds=new Set(selected.shiftIds);
        next.checklistProgress=Object.fromEntries(Object.entries(next.checklistProgress||{}).filter(([key])=>{try{return !selectedIds.has(JSON.parse(key)[0]);}catch{return true;}}));Object.assign(next.checklistProgress,copy(result.progress||{}));
        acknowledged=next;planning={...planning,versions:{...planning.versions,...Object.fromEntries(Object.entries(result.planning.versions).filter(([,version])=>version>0))},deferred:[...remaining]};lastLoaded={...lastLoaded,studio:copy(next)};
        const at=cached?cached.at:Date.now();for(const id of selected.shiftIds){detailCoverage.add(id);detailFreshness.set(id,{at,stamp:calendarGeneration(),identity:detailIdentity(id)});}if(!cached)rememberDetails(selected,result,at);
        onReconciled(copy(next),{submitted:previous,acknowledged:copy(next),previous,scopeExpansion:true,detailHydration:true,projection:copy(projection),detailShiftIds:copy(selected.shiftIds),detailShifts:copy(result.detailShifts||[]),progress:copy(result.progress||{}),...scopeData()});return {...currentResult(),detailShifts:copy(result.detailShifts||[]),progress:copy(result.progress||{})};
      }catch(error){return {ok:false,status:409,message:error?.message||'Instruktionerne kunne ikke indlæses. Din plan er bevaret.'};}
      finally{running=false;resumeQueued();savedStatus();}
    }
    async function switchProjection(selected,{force=false}={}){
      if(typeof cancelWarmViewport==='function')cancelWarmViewport();
      if(!ready||loading)return {ok:false,status:503,message:'Indlæs din konto, før du henter en kalenderperiode.'};
      let target;try{target=selected?Window.normalize(selected):null;}catch(error){return {ok:false,status:400,message:error.message};}
      const generation=++loadGeneration;
      await flush();while(running)await new Promise(resolve=>idle.push(resolve));
      if(generation!==loadGeneration)return {ok:false,superseded:true};
      if(!ready||loading||failed||pending)return {ok:false,status:409,message:'Gem ændringerne, før du skifter periode.'};
      if(!force&&coverageValid&&Planning?.canonical(target)===Planning?.canonical(projection))return currentResult();
      running=true;
      try{
        const previous=copy(acknowledged),priorRevision=revision,priorProjection=copy(projection),result=await readProjection(target,generation);
        if(generation!==loadGeneration||result.superseded)return {ok:false,superseded:true};
        if(!result.ok)return {ok:false,status:result.status||503,message:result.message||'Perioden kunne ikke indlæses. Din tidligere plan er bevaret.'};
        if(pending)return {ok:false,status:409,blocked:true,message:'Der er nye ændringer. Gem dem, før du skifter periode.'};
        const loaded=adopt(result),context={submitted:previous,acknowledged:copy(acknowledged),previous,scopeReplacement:true,scopeExpansion:Boolean(priorProjection&&priorRevision===revision),projection:copy(projection),previousProjection:priorProjection,...scopeData()};
        onReconciled(copy(acknowledged),context);return loaded;
      }catch(error){return {ok:false,status:503,message:error?.message||'Perioden kunne ikke indlæses. Din tidligere plan er bevaret.'};}
      finally{running=false;resumeQueued();savedStatus();}
    }
    function cancelWarmViewport(){warmEpoch++;}
    function warmViewport(selected,{bounds=null,isCurrent=()=>true}={}){
      let target,limits,stamp;
      try{
        if(!Viewport||!Window||!Planning||typeof isCurrent!=='function')throw new TypeError('Kalenderens baggrundsindlæsning er ikke klar.');
        target=Viewport.normalize(selected);limits=bounds?Viewport.normalize(bounds):target;
        if(Viewport.weeks(target).length>6||!Window.covers(limits,target.from,target.to))throw new TypeError('Vælg højst seks uger inden for den viste kalender.');
      }catch(error){return Promise.resolve({ok:false,status:400,message:error.message,cached:[],complete:false});}
      const reply=(extra={})=>({cached:viewportCache?.generation===stamp?Viewport.weeks(target).filter(week=>viewportCache.covers(week)).map(week=>week.from):[],complete:false,...extra});
      const idleNow=()=>{try{return Boolean(ready&&!loading&&!running&&!pending&&!activeItem&&!failed&&coverageValid&&projection?.mode==='calendar'&&isCurrent());}catch{return false;}};
      if(!idleNow())return Promise.resolve(reply({ok:false,cancelled:true,superseded:true}));
      try{stamp=Viewport.generation({revision,planning,directory:lastLoaded?.directory,workspace:lastLoaded?.workspace,viewer:lastLoaded?.viewer,capabilities:lastLoaded?.capabilities});}
      catch{return Promise.resolve(reply({ok:false,status:409,message:'Kalenderens versionsgrundlag mangler.'}));}
      const key=Planning.canonical({target,limits,stamp});
      if(warmJob){
        if(warmJob.key===key&&warmJob.epoch===warmEpoch)return warmJob.promise;
        cancelWarmViewport();return Promise.resolve(reply({ok:false,busy:true,cancelled:true,superseded:true,retryAfter:300}));
      }
      if(viewportCache?.generation!==null&&viewportCache?.generation!==stamp)return Promise.resolve(reply({ok:false,changed:true,requiresRefresh:true,status:409}));
      const epoch=++warmEpoch,generation=loadGeneration,protectedRange=Viewport.normalize(projection);
      viewportCache=viewportCache.fork({maxWeeks:WARM_RETENTION_WEEKS});
      const current=()=>epoch===warmEpoch&&generation===loadGeneration&&idleNow()&&calendarGeneration()===stamp&&(!viewportCache.generation||viewportCache.generation===stamp);
      const job={key,epoch,promise:null};warmJob=job;
      job.promise=(async()=>{
        try{
          while(viewportCache.missing(target).length){
            if(!current())return reply({ok:false,cancelled:true,superseded:true});
            const missing=viewportCache.missing(target),first=missing[0],neighbor=missing.find(week=>week.from===Scope.add(first.from,7));
            const batching=Boolean(Viewport.split&&viewportCache.putRange&&planning?.recordWindows!==undefined),range=batching&&neighbor?{mode:'calendar',from:first.from,to:neighbor.to}:first;
            const result=await readProjection(range,generation,{isCurrent:current});
            if(!current()||result.superseded)return reply({ok:false,cancelled:true,superseded:true});
            if(!result.ok)return reply(result.status===413?{ok:true,tooLarge:true}:{ok:false,status:result.status||503,message:result.message||'Ugerne kunne ikke indlæses i baggrunden.'});
            if(Viewport.generation(result)!==stamp)return reply({ok:false,changed:true,requiresRefresh:true,status:409});
            const staged=viewportCache.fork({maxWeeks:WARM_RETENTION_WEEKS});
            try{staged.putRange(result,{required:protectedRange});}
            catch(error){if(error.status===413)return reply({ok:true,tooLarge:true});throw error;}
            if(!current())return reply({ok:false,cancelled:true,superseded:true});
            const before=missing.length,added=Viewport.weeks(range).length;viewportCache=staged;
            // A byte-bound cache can evict optional weeks just inserted. Do not
            // repeatedly fetch the same weeks when six cannot coexist safely.
            if(viewportCache.missing(target).length!==before-added)return reply({ok:true,tooLarge:true});
            if(viewportCache.missing(target).length)await new Promise(resolve=>setTimeout(resolve,0));
          }
          return reply({ok:true,complete:true});
        }catch(error){return reply(error.status===413||error instanceof RangeError?{ok:true,tooLarge:true}:{ok:false,status:error.status||503,message:error.message||'Ugerne kunne ikke indlæses i baggrunden.'});}
        finally{if(warmJob===job)warmJob=null;}
      })();
      return job.promise;
    }
    function viewportFetchRange(cache,target,bounds,previous,batch){
      const missing=cache.missing(target),backwards=Boolean(previous&&target.from<Scope.calendar(previous).from),week=backwards?missing.at(-1):missing[0];
      if(!week||!batch)return week;
      const neighbor={mode:'calendar',from:Scope.add(week.from,backwards?-7:7),to:Scope.add(week.to,backwards?-7:7)},required=Window.covers(target,neighbor.from,neighbor.to);
      const optional=bounds&&Viewport.weeks(target).length<4&&Window.covers(bounds,neighbor.from,neighbor.to);
      if((required||optional)&&!cache.covers(neighbor))return {mode:'calendar',from:backwards?neighbor.from:week.from,to:backwards?week.to:neighbor.to};
      return week;
    }
    async function switchViewport(selected,{force=false,isCurrent=()=>true,canRetain=()=>false,bounds=null}={}){
      cancelWarmViewport();
      if(!ready||loading||!Viewport)return {ok:false,status:503,message:'Indlæs din konto, før du henter kalenderen.'};
      let target,limits;try{target=Viewport.normalize(selected);limits=bounds?Viewport.normalize(bounds):null;if(limits&&!Window.covers(limits,target.from,target.to))throw new TypeError('Kalenderperioden ligger uden for den viste plan.');}catch(error){return {ok:false,status:400,message:error.message};}
      const generation=++loadGeneration;
      await flush();while(running)await new Promise(resolve=>idle.push(resolve));
      if(generation!==loadGeneration||!isCurrent())return {ok:false,superseded:true};
      if(!ready||loading||failed||pending)return {ok:false,status:409,message:'Gem ændringerne, før du skifter kalenderperiode.'};
      if(!force&&coverageValid&&Planning.canonical(target)===Planning.canonical(projection))return currentResult();
      const previous=copy(acknowledged),priorProjection=copy(projection),priorRevision=revision,previousPlanningVersions=copy(planning?.versions||{}),priorCalendarGeneration=calendarGeneration();running=true;
      let staged=force||!coverageValid?freshViewportCache():viewportCache.fork();
      const reusable=()=>Boolean(generation===loadGeneration&&ready&&!loading&&!failed&&!pending&&coverageValid&&calendarGeneration()===priorCalendarGeneration&&canRetain());
      const stillUseful=()=>generation===loadGeneration&&(isCurrent()||reusable());
      const superseded=()=>{if(reusable())viewportCache=staged;return {ok:false,superseded:true};};
      let batching=Boolean(Viewport.split&&staged.putRange&&planning?.recordWindows!==undefined);
      try{
        for(let attempt=0;attempt<2;attempt++){
          let changed=false;
          while(staged.missing(target).length){
            if(!isCurrent())return superseded();
            let range=viewportFetchRange(staged,target,limits,priorProjection,batching),result;
            try{result=await readProjection(range,generation,{isCurrent:stillUseful});}
            catch(error){if(!batching||Viewport.weeks(range).length<2||!(error instanceof RangeError||error.status===413))throw error;batching=false;if(!isCurrent())return superseded();range=viewportFetchRange(staged,target,limits,priorProjection,false);result=await readProjection(range,generation,{isCurrent:stillUseful});}
            if(result.status===413&&batching&&Viewport.weeks(range).length>1){batching=false;if(!isCurrent())return superseded();range=viewportFetchRange(staged,target,limits,priorProjection,false);result=await readProjection(range,generation,{isCurrent:stillUseful});}
            if(generation!==loadGeneration||result.superseded||!stillUseful())return {ok:false,superseded:true};
            if(!result.ok)return {ok:false,status:result.status||503,message:result.message||'Ugen kunne ikke indlæses. Din kalender er bevaret.'};
            const insert=()=>batching?staged.putRange(result,{required:target}):staged.put(result,{required:target});
            try{insert();}catch(error){if(error.generationChanged&&attempt===0){staged=freshViewportCache();insert();changed=true;break;}if(error.status===413&&batching&&Viewport.weeks(range).length>1){batching=false;continue;}throw error;}
            // Completed batches may serve a newer scroll intent. They never
            // replace active authority when their original intent is obsolete.
            if(!isCurrent())return superseded();
          }
          if(changed)continue;
          if(generation!==loadGeneration||!isCurrent())return superseded();
          if(pending)return {ok:false,status:409,blocked:true,message:'Der er nye ændringer. Gem dem, før du skifter kalenderperiode.'};
          const result=staged.assemble(target),viewportContext={viewport:true,previous,previousPlanningVersions,planningVersions:copy(result.planning?.versions||{}),samePlanningGeneration:Boolean(priorCalendarGeneration&&priorCalendarGeneration===Viewport.generation(result,{strict:false}))};
          // The active authority and the UI must use the same representation.
          // Retain full bodies only for identical, still-visible acknowledged rows;
          // the private weekly cache keeps its compact read model.
          result.studio=globalThis.CleanRoomsPlanningReconcile?.promoteViewport(previous,result.studio,viewportContext)||result.studio;
          result.planning.deferred=Planning.flatten(result.studio).filter(row=>row.kind!=='week'&&Instructions?.contains(row.value)).map(row=>Planning.key(row.kind,row.id));
          const loaded=adopt(result,{keepViewport:true});viewportCache=staged;
          onReconciled(copy(acknowledged),{submitted:previous,acknowledged:copy(acknowledged),...viewportContext,scopeReplacement:true,scopeExpansion:Boolean(priorProjection&&priorRevision===revision),projection:copy(projection),previousProjection:priorProjection,...scopeData()});return loaded;
        }
        return {ok:false,status:409,message:'Kalenderen ændrer sig. Hent perioden igen.'};
      }catch(error){return {ok:false,status:error.status||503,message:error.message||'Kalenderen kunne ikke indlæses. Din tidligere plan er bevaret.'};}
      finally{running=false;resumeQueued();savedStatus();}
    }
    function calendarGeneration(){try{return Viewport?.generation({revision,planning,directory:lastLoaded?.directory,workspace:lastLoaded?.workspace,viewer:lastLoaded?.viewer,capabilities:lastLoaded?.capabilities},{strict:false})??null;}catch{return null;}}
    function errorStatus(error,conflict = false) { failed = true; onStatus({state:'error',conflict,message:conflict ? 'Planen er ændret i et andet vindue. Hent den seneste version før du fortsætter.' : error?.message || 'Ændringen er ikke gemt. Prøv igen.'}); }
    async function load(options={}) {
      cancelPreferences();
      workflowReviewedRevision=null;viewportCache?.clear();
      const generation = ++loadGeneration; loading = true; ready = false;
      clearTimeout(timer); pending = null; activeItem=null; waiters.splice(0).forEach(waiter => waiter.resolve(false));
      onStatus({state:'loading',message:'Indlæser din plan…'});
      if (running) await new Promise(resolve => idle.push(resolve));
      if (generation !== loadGeneration) return {ok:false};
      onStatus({state:'loading',message:'Indlæser din plan…'});
      try {
        const result = await readProjection(options.projection||null,generation);
        if (generation !== loadGeneration) return {ok:false};
        if (!result.ok) throw new Error(result.message || 'Planen kunne ikke indlæses. Genindlæs siden, hvis din login-session er udløbet.');
        const loaded=adopt(result);ready = true; loading = false; failed = false; pending = null;
        onStatus({state:'saved',message:'Alle ændringer er gemt'});return loaded;
      } catch (error) { if (generation === loadGeneration) { loading = false; errorStatus(error); } return {ok:false}; }
    }
    async function flush() {
      clearTimeout(timer); if (running || !ready || !pending) return;
      if(preferencePromise){await preferencePromise;if(running||!ready||loading||!pending||failed)return;}
      running = true; failed = false; onStatus({state:'saving',message:'Gemmer ændringer…'});
      while (pending && !failed) {
        const item = pending; pending = null; activeItem=item;
        try {
          const payload=writePayload(item);const result = await sendDraft(item,payload);
          if (!result.ok) { if(result.superseded){activeItem=null;break;}if (!pending) pending = item; errorStatus(new Error(result.message || 'Ændringen er ikke gemt. Prøv igen.'),result.status === 409); break; }
          acknowledge(result,item,payload);acknowledgeQueuedPreferences(item);
          activeItem=null;onSaved(result);
          for (let i = waiters.length - 1;i >= 0;i--) if (waiters[i].ticket <= item.ticket) waiters.splice(i,1)[0].resolve(true);
        } catch (error) { if (!pending) pending = item; errorStatus(error); }
      }
      activeItem=null;running = false;
      resumeQueued();
      if (failed) { waiters.splice(0).forEach(waiter => waiter.resolve(false)); return; }
      savedStatus();
    }
    function save(studio) {
      if (!ready) return Promise.resolve(false);
      let captured;try{captured=capture(studio);}catch(error){onStatus({state:'error',message:error.message});return Promise.resolve(false);}
      if(preferenceOnly(captured)){
        return queuePreferences(preferences(studio));
      }
      cancelWarmViewport();
      if(planning){preferenceValues=preferences(studio);if(preferencePending)preferencePending.values=copy(preferenceValues);}
      const current = ++ticket; pending = {...captured,ticket:current};
      onStatus({state:'saving',message:'Gemmer ændringer…'});
      const promise = new Promise(resolve => waiters.push({ticket:current,resolve}));
      clearTimeout(timer); timer = setTimeout(flush,120); return promise;
    }
    async function action(operation,payload={}) {
      if(!ready)return {ok:false,status:503,message:'Indlæs din konto, før du fortsætter.'};
      if(!['list','invite','updateMember','revokeInvite','createRole','updateRole','createEmployeeUser','readAppLogin','revealAppStartCode','createAppLogin','resetAppLogin','revokeAppLogin','preferences','checklist','employeeRead','employeeShift','payrollRead','payrollSave','payrollPolicyRead','payrollPolicyPreview','payrollPolicySave','payrollPersonPolicySave','payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen','payrollPeriodExport','payrollPeriodDownload','payrollExportProfilesRead','payrollExportProfileRead','payrollExportProfileSave','payrollExportProfileArchive','payrollExportProfileEmployees','timeRead','timeWrite','timeDemo','leaveRead','leaveCreate','leaveDecide','activityRead','workflowRead','workflowReadMessage','workflowRequest','workflowRespond','workflowDecide','workflowDemo','chatList','chatRead','chatSync','chatCreate','chatUpdate','chatSend','chatPin','chatReadMark','chatMute','chatDemo','siteAddressLookup','publicationBudgetRead','planningCostRead','planningAvailability'].includes(operation))return {ok:false,status:400,message:'Ukendt kontohandling.'};
      if(operation==='preferences'&&planning){
        if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(name=>name!=='preferences')||!payload.preferences||typeof payload.preferences!=='object'||Array.isArray(payload.preferences)||Object.keys(payload.preferences).some(name=>!Planning.PREFS.includes(name)))return {ok:false,status:400,message:'Indstillingerne er ugyldige.'};
        return queuePreferences(payload.preferences,{structured:true,merge:true});
      }
      const timeMutation=['timeWrite','timeDemo','workflowDecide','payrollPeriodClose','payrollPeriodReopen'].includes(operation);
      if(timeMutation){
        await flush();
        if(preferencePromise)await preferencePromise;
        while(running)await new Promise(resolve=>idle.push(resolve));
        if(!ready||loading||failed||pending)return {ok:false,status:409,message:operation==='workflowDecide'?'Hent den seneste plan, før du behandler anmodningen.':'Hent den seneste plan, før du gemmer tidsregistreringen.'};
        running=true;
      }
      try{const result=await request('account',{operation,payload:operation==='workflowDecide'?{...payload,studioRevision:workflowReviewedRevision??revision}:payload});if(operation==='checklist'&&result.ok)invalidateDetailProgress(payload.shiftId);const bundle=result.bundle||result;if(operation==='workflowRead'&&result.ok&&payload.summary!==true&&bundle.canManage===true&&Number.isSafeInteger(bundle.revision))workflowReviewedRevision=bundle.revision;if(operation==='workflowDecide'&&result.ok){cancelPreferences();ready=false;pending=null;clearTimeout(timer);waiters.splice(0).forEach(waiter=>waiter.resolve(false));}return result;}catch(error){return {ok:false,status:503,message:error?.message||'Handlingen kunne ikke gennemføres.'};}
      finally{if(timeMutation){running=false;resumeQueued();}}
    }
    async function directoryRequest(action,payload={}){
      if(action==='directoryWrite'&&(!ready||loading))return {ok:false,status:503,message:'Indlæs din konto, før du ændrer medarbejdere eller afdelinger.'};
      try{return await request(action,{payload:copy(payload)});}catch(error){return {ok:false,status:503,message:error?.message||'Medarbejderregisteret kunne ikke indlæses.'};}
    }
    async function publish(studio,publication) {
      if(!ready||loading||failed)return {ok:false,message:'Hent den seneste plan, før du udgiver.'};
      if(!coverageValid)return {ok:false,status:409,message:'Hent og gennemgå det opdaterede udgivelsesområde, før du udgiver.'};
      const matches=()=>!projection||projection.mode==='publication'&&projection.from===publication?.from&&projection.to===publication?.to&&Planning.canonical(projection.siteIds)===Planning.canonical([...(publication?.siteIds||[])].sort((one,two)=>one-two))&&projection.includeDependencies===(publication?.includeDependencies===true);
      if(!matches())return {ok:false,status:409,message:'Hent og gennemgå det valgte udgivelsesområde, før du udgiver.'};
      const reviewedGeneration=reconciliationGeneration,reviewedProjection=copy(projection),reviewedDirectoryRevision=lastLoaded?.directory?.revision;
      await flush();
      if(preferencePromise)await preferencePromise;
      if(preferencePending&&!preferenceError)await flushPreferences();
      if(running)await new Promise(resolve=>idle.push(resolve));
      if(planning&&reviewedGeneration!==reconciliationGeneration){const message='Planen er ændret. Gennemgå den seneste version, før du udgiver.';errorStatus(new Error(message),true);return {ok:false,status:409,message};}
      if(Planning&&Planning.canonical(reviewedProjection)!==Planning.canonical(projection)||!matches())return {ok:false,status:409,message:'Udgivelsesområdet er ændret. Gennemgå perioden igen.'};
      if(reviewedDirectoryRevision!==lastLoaded?.directory?.revision)return {ok:false,status:409,message:'Medarbejdere eller arbejdssteder er ændret. Gennemgå perioden igen.'};
      if(!coverageValid)return {ok:false,status:409,message:'Planen er ændret. Hent og gennemgå udgivelsesområdet igen.'};
      if(!ready||loading)return {ok:false,message:'Hent den seneste plan, før du udgiver.'};
      if(failed||pending)return {ok:false,message:'Gem kladden, før du udgiver.'};
      let published=false;running=true;onStatus({state:'saving',message:'Udgiver den gennemgåede plan…'});
      try {
        const item=capture(studio);activeItem=item;const payload=writePayload(item,publication);const result=await request('write',payload);
        if(!result.ok){if(result.superseded)return result;errorStatus(new Error(result.message||'Planen kunne ikke udgives.'),result.status===409);return result;}
        acknowledge(result,item,payload);activeItem=null;onSaved(result);published=true;return result;
      } catch(error){errorStatus(error);return {ok:false,message:error.message};}
      finally{activeItem=null;running=false;resumeQueued();savedStatus(published?'Planen er udgivet og gemt':'Alle ændringer er gemt');}
    }
    function discardPending(){
      if(running)return false;
      cancelPreferences();
      clearTimeout(timer);pending=null;ready=false;failed=true;
      waiters.splice(0).forEach(waiter=>waiter.resolve(false));
      onStatus({state:'error',conflict:true,message:'Ændringen er ikke gemt. Hent den seneste version, før du fortsætter.'});return true;
    }
    async function retry(){preferenceError='';await flush();if(preferencePromise)await preferencePromise;if(preferencePending)await flushPreferences();}
    function viewportCached(range){try{return Boolean(ready&&!loading&&!running&&!failed&&!pending&&coverageValid&&projection?.mode==='calendar'&&viewportCache?.generation===calendarGeneration()&&viewportCache.covers(range));}catch{return false;}}
    return {load,save,publish,action,details,needsDetails,viewport:switchViewport,warmViewport,cancelWarmViewport,viewportCached,viewportCovers:range=>{try{return Boolean(ready&&coverageValid&&projection?.mode==='calendar'&&Window.covers(projection,range.from,range.to));}catch{return false;}},get viewportCache(){return viewportCache?.inspect??null;},get calendarGeneration(){return calendarGeneration();},get preferenceStatus(){return preferenceStatus();},directoryRead:payload=>directoryRequest('directoryRead',payload),directoryWrite:payload=>directoryRequest('directoryWrite',payload),invalidateCoverage:()=>{cancelWarmViewport();coverageValid=false;viewportCache?.clear();},discardPending,retry,scope:(selected,options)=>switchProjection(selected,options),coversScope:selected=>{try{return Boolean(ready&&coverageValid&&(!projection||Planning.canonical(Window.normalize(selected))===Planning.canonical(projection)));}catch{return false;}},window:(selected,options)=>switchProjection(selected,options),ensureFull:options=>switchProjection(null,options),covers:(from,to)=>{if(from&&typeof from==='object'){to=from.to;from=from.from;}return Boolean(ready&&coverageValid&&(!projection||Window.covers(projection,from,to)));},get revision(){return revision;},get hasPendingPlanSave(){return Boolean(pending||activeItem);},get directoryRevision(){return lastLoaded?.directory?.revision??null;},get coverageValid(){return coverageValid;},get selection(){return copy(lastLoaded?.selection??null);},get availability(){return copy(lastLoaded?.availability??null);},get catalog(){return copy(lastLoaded?.catalog??null);},get projection(){return copy(projection);},get isPartial(){return Boolean(projection);},get ready(){return ready;}};
  }
  globalThis.CleanRoomsPersistence = Object.freeze({create});
})();
