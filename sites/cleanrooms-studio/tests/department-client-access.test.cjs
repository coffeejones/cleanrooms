/* Exercise the real client channel, private caches and server ACL generation. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Planning=require('../src/planning-records.js'),Scope=require('../src/planning-scope.js'),Window=require('../src/planning-window.js'),Viewport=require('../src/planning-viewport.js'),Reconcile=require('../src/planning-reconcile.js'),Directory=require('../src/directory-persistence.js'),DirectoryRecords=require('../src/directory-records.js'),Departments=require('../src/department-model.js'),Employee=require('../src/employee-persistence.js'),Workspace=require('../lib/workspace-store.mjs');
const {createDepartmentAccessFixture}=require('./helpers/department-access-fixture.cjs');
const persistenceSource=fs.readFileSync(require.resolve('../src/studio-persistence.js'),'utf8'),appSource=fs.readFileSync(require.resolve('../src/app.js'),'utf8');
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value)),drain=()=>new Promise(resolve=>setImmediate(resolve)),hash='a'.repeat(64),week=index=>({mode:'calendar',from:Scope.add('2026-11-02',index*7),to:Scope.add('2026-11-02',index*7+6)});
const employee=(id,site)=>({id,name:site?'FOREIGN NAME':'Own Name',initials:'QA',site,target:37,role:'Service',active:true});
const shift=(index,site=1)=>({id:'shift-'+index,person:site?'person-foreign':'person-own',site,date:Scope.add(week(index).from,1),start:'07:00',end:'15:00',note:site?'FOREIGN INSTRUCTIONS':'Own instructions'});
const record=(index,site=1)=>({kind:'shift',id:'shift-'+index,value:{edit:shift(index,site),suppressed:false},version:1,sortOrder:index});
function page(index,{identity='full',site=1,...patch}={}){
 const row=record(index,site),organization=Departments.defaultOrganization(),roster=[employee('person-own',0),...(site?[employee('person-foreign',1)]:[])];
 if(!site)organization.sites=organization.sites.map((value,i)=>i?{id:value.id,name:'Begrænset arbejdssted',address:'',color:value.color,restricted:true}:value);
 const rows=DirectoryRecords.flatten({roster,organization}).filter(row=>row.kind!=='site'||row.value.restricted!==true);
 return {ok:true,accessIdentity:identity,revision:7,studio:{storageVersion:1,demoSeed:false,organization,roster,coverageRules:[],workspaceSettings:{},series:[],edits:{},deleted:[],weekPlans:{}},records:[{...row,value:Scope.compact(row.kind,row.id,row.value)}],publicationRows:[{kind:'state',id:'state',value:{present:false,value:{version:1,sequence:0,scopeLinks:[]}}}],auxRows:[],nextCursor:null,planning:{schema:1,partial:true,projection:week(index),versions:{[Planning.key('shift',row.id)]:1},metadataHash:hash,absenceVersion:2,deferred:[Planning.key('shift',row.id)]},directory:{schema:1,revision:3,complete:true,nextSiteIndex:3,versions:Object.fromEntries(rows.map(row=>[DirectoryRecords.key(row.kind,row.id),1]))},workspace:{id:'workspace'},viewer:{userId:'planner',roleId:'admin',memberVersion:1,roleVersion:1,accessScope:{mode:site?'all':'departments',departmentIds:site?[]:['dep-nord']}},capabilities:{plan:true,previewEmployees:true,viewPayroll:true,scopeRestricted:!site,allowedDepartmentIds:site?[]:['dep-nord'],allowedSiteIds:site?[0,1,2]:[0]},...patch};
}
function detail(index,identity='full',site=1){const row=record(index,site);return {ok:true,accessIdentity:identity,revision:7,directoryRevision:3,records:[row],planning:{schema:1,metadataHash:hash,versions:{[Planning.key(row.kind,row.id)]:row.version}},progress:{},detailShifts:[row.value.edit]};}
function harness({transport=null}={}){
 const requests=[],connections=[],timers=new Map(),renders=[],status=[],callbacks=[];let timerId=0,hold=null,directory=null,personal=null,visible=null,resets=0;
 class Port{constructor(){this.peer=null;this.onmessage=null;this.closed=false;}start(){}close(){this.closed=true;}postMessage(value){const data=copy(value);queueMicrotask(()=>{if(!this.closed&&!this.peer.closed)this.peer.onmessage?.({data});});}}
 class Channel{constructor(){this.port1=new Port();this.port2=new Port();this.port1.peer=this.port2;this.port2.peer=this.port1;}}
 const parent={postMessage(_message,_origin,[port]){connections.push(port);port.onmessage=async event=>{const entry={data:copy(event.data),port};requests.push(entry);if(transport){entry.response=await transport(entry.data);if(hold?.(entry)){entry.held=true;return;}port.postMessage({id:entry.data.id,...entry.response});}};}};
 const context=vm.createContext({CleanRoomsPlanningRecords:Planning,CleanRoomsPlanningScope:Scope,CleanRoomsPlanningWindow:Window,CleanRoomsPlanningViewport:Viewport,CleanRoomsPlanningReconcile:Reconcile,CleanRoomsData:require('../src/studio-data.js'),MessageChannel:Channel,parent,TextEncoder,TextDecoder,setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(persistenceSource,context,{filename:'studio-persistence.js (department boundary)'});
 const api=context.CleanRoomsPersistence.create({onAccessChanged(){resets++;visible=null;directory?.reset();personal?.reset();callbacks.forEach(callback=>callback());},onReconciled(studio){visible=copy(studio);renders.push(copy(studio));},onStatus:value=>status.push(copy(value))});
 directory=Directory.create({transport:{directoryRead:payload=>api.directoryRead(payload),directoryWrite:payload=>api.directoryWrite(payload)}});personal=Employee.create({transport:{action:(operation,payload)=>api.action(operation,payload)}});
 const reply=async(entry,payload=entry.response)=>{entry.port.postMessage({id:entry.data.id,...payload});await drain();};
 async function load(response=page(0),projection=week(0)){
  const work=api.load({projection});await drain();if(connections.length===1&&!requests.length){connections[0].postMessage({type:'cleanrooms-storage-ready'});await drain();}if(!transport)await reply(requests.filter(entry=>entry.data.action==='read').at(-1),response);const result=await work;if(result.ok){visible=copy(result.studio);renders.push(copy(visible));}return result;
 }
 return {api,directory,personal,requests,renders,status,load,reply,callbacks,setHold:predicate=>{hold=predicate;},get visible(){return copy(visible);},get resets(){return resets;},async expireRequests(){for(const [id,timer]of timers)if(timer.delay===30000){timers.delete(id);timer.callback();}await drain();},async flushTimers(){for(const [id,timer]of timers)if(timer.delay===120){timers.delete(id);timer.callback();}await drain();}};
}
const noSecret=value=>assert.equal(JSON.stringify(value).includes('FOREIGN'),false);
const superseded=value=>{assert.equal(value.ok,false);assert.equal(value.superseded,true);noSecret(value);};

async function realTransport(f,data){
 if(data.action==='read'){
  const params=new URLSearchParams({projection:data.projection.mode,from:data.projection.from,to:data.projection.to,instructions:'deferred',...(data.cursor?{cursor:data.cursor}:{})});const result=await f.plan('GET',undefined,f.scopedPlanner,'/api/studio?'+params);return {...result.body,ok:result.status===200,status:result.status};
 }
 if(data.action==='account'){const result=await f.account(data.operation,data.payload,f.scopedPlanner);return {...result.body,ok:result.status===200,status:result.status};}
 if(data.action==='directoryRead'){
  const request=new Request('https://cleanrooms.example/api/directory',{method:'POST',headers:{origin:'https://cleanrooms.example','content-type':'application/json','oai-authenticated-user-id':f.scopedPlanner.id,'oai-authenticated-user-email':f.scopedPlanner.email},body:JSON.stringify({action:'read',...data.payload})}),result=await Workspace.handleDirectoryRequest(request,f.db);return {...await result.json(),ok:result.ok,status:result.status};
 }
 throw Error('Unexpected real transport '+data.action);
}
async function changeScope(f,accessScope){const listed=await f.account('list'),member=listed.body.members.find(member=>member.userId===f.scopedPlanner.id);const result=await f.account('updateMember',{userId:member.userId,version:member.version,accessScope});assert.equal(result.status,200,JSON.stringify(result));}
async function waitFor(predicate){for(let count=0;count<60;count++){if(predicate())return;await drain();}assert.fail('Expected the bounded asynchronous reply');}

test('real server scope narrowing fences all cached calendar, profile, instructions, time and pay data without a plan revision change',async t=>{
 const f=await createDepartmentAccessFixture(t);await changeScope(f,{mode:'all',departmentIds:[]});const h=harness({transport:data=>realTransport(f,data)}),projection={mode:'calendar',...f.range},first=await h.load(null,projection);assert.equal(first.ok,true);assert.equal(h.directory.reconcile(first).ok,true);assert.equal(h.directory.staff.some(person=>person.id===f.foreignPerson.id),true);
 const opened=await h.api.details({shiftIds:[f.foreignShift.id]});assert.equal(opened.ok,true,JSON.stringify(opened));assert.ok(JSON.stringify(h.visible).includes('FOREIGN'));assert.equal((await h.directory.get('employee',f.foreignPerson.id)).ok,true);assert.equal((await h.directory.get('employee',f.foreignPerson.id)).cached,true);
 h.setHold(entry=>entry.data.action==='account'&&['payrollRead','timeRead'].includes(entry.data.operation)||entry.data.action==='directoryRead');
 const latePay=h.api.action('payrollRead',{personId:f.foreignPerson.id}),lateTime=h.api.action('timeRead',{...f.range}),lateProfile=h.directory.get('employee',f.foreignPerson.id,{force:true});await waitFor(()=>h.requests.filter(entry=>entry.held).length===3);const old=h.requests.filter(entry=>entry.held);assert.ok(old.every(entry=>entry.response.ok),JSON.stringify(old.map(entry=>entry.response)));
 const revision=h.api.revision;await changeScope(f,{mode:'departments',departmentIds:['dep-nord']});h.setHold(null);const noticed=await h.api.action('timeRead',{...f.range});superseded(noticed);assert.equal(h.resets,1);assert.equal(h.api.ready,false);assert.equal(h.api.viewportCache.weeks,0);assert.equal(h.directory.records.length,0);assert.equal(h.personal.data,null);assert.equal(h.visible,null);assert.equal(h.api.hasPendingPlanSave,false);
 for(const entry of old)await h.reply(entry);superseded(await latePay);superseded(await lateTime);superseded(await lateProfile);assert.equal(h.resets,1,'Old replies cannot restart or undo the new access epoch');
 const narrowed=await h.load(null,projection);assert.equal(narrowed.ok,true,JSON.stringify(narrowed));assert.equal(h.api.revision,revision);assert.notEqual(narrowed.accessIdentity,first.accessIdentity);noSecret(narrowed);assert.equal(h.directory.reconcile(narrowed).ok,true,'Restricted placeholders have no fabricated versions');assert.deepEqual(h.directory.staff.map(person=>person.id),[f.allowedPerson.id]);assert.equal(h.directory.organization.sites[1].restricted,true);assert.equal(h.directory.organization.sites[1].address,'');assert.equal(h.directory.version('site','site-klinik'),0);
 const calls=h.requests.length,foreign=await h.directory.get('employee',f.foreignPerson.id);assert.equal(foreign.ok,false);assert.ok(h.requests.length>calls,'Old full profile cache must not be reused');noSecret(foreign);assert.equal((await h.directory.loadCatalog({force:true})).ok,true,'Standalone scoped pages retain their original sparse site indices');assert.equal(h.directory.organization.sites[1].restricted,true);
});

test('late old calendar and instruction responses never reconcile after another channel detects changed access',async()=>{
 for(const operation of ['calendar','instructions']){
  const h=harness();await h.load();let pending;
  if(operation==='calendar')pending=h.api.viewport({from:week(0).from,to:week(1).to});else pending=h.api.details({shiftIds:['shift-0']});await drain();const delayed=h.requests.at(-1),read=h.api.action('timeRead',{});await drain();await h.reply(h.requests.at(-1),{ok:true,accessIdentity:'narrowed',entries:[{name:'Own person'}]});superseded(await read);const renders=h.renders.length;
  await h.reply(delayed,operation==='calendar'?page(1):detail(0));superseded(await pending);assert.equal(h.renders.length,renders);assert.equal(h.visible,null);assert.equal(h.api.viewportCache.weeks,0);assert.equal(h.api.ready,false);assert.equal(h.api.needsDetails({shiftIds:['shift-0']}),false);
 }
});

test('each data channel rejects a changed identity before returning its private payload',async()=>{
 for(const operation of ['timeRead','payrollRead','employeeShift','planningCostRead','directoryRead','plannerDetail','calendar']){
  const h=harness();await h.load();const request=operation==='directoryRead'?h.api.directoryRead({kind:'employee',ids:['person-foreign']}):operation==='plannerDetail'?h.api.details({shiftIds:['shift-0']}):operation==='calendar'?h.api.viewport({from:week(0).from,to:week(1).to}):h.api.action(operation,{});await drain();const entry=h.requests.at(-1);let payload={ok:true,accessIdentity:'new-restricted-identity',private:'FOREIGN PRIVATE BODY'};if(operation==='plannerDetail')payload={...detail(0,'new-restricted-identity'),private:payload.private};if(operation==='calendar')payload={...page(1,{identity:'new-restricted-identity'}),private:payload.private};await h.reply(entry,payload);superseded(await request);assert.equal(h.resets,1,operation);assert.equal(h.api.ready,false);assert.equal(h.api.viewportCache.weeks,0);noSecret(h.visible);
 }
});

test('a superseded in-flight save cannot restore an old-scope pending draft or replay it on retry',async()=>{
 const h=harness(),loaded=await h.load(),full=h.api.details({shiftIds:['shift-0']});await drain();await h.reply(h.requests.at(-1),detail(0));const studio=copy((await full).studio);studio.edits['shift-0'].start='08:00';const saving=h.api.save(studio),flushing=h.api.retry();await drain();const write=h.requests.at(-1);assert.equal(write.data.action,'write');await h.reply(write,{ok:true,accessIdentity:'narrowed',revision:8,private:'FOREIGN OLD DRAFT'});assert.equal(await saving,false);await flushing;assert.equal(h.api.hasPendingPlanSave,false,'Invalidated drafts must never be restored by the old flush continuation');assert.equal(h.api.ready,false);assert.equal(h.api.viewportCache.weeks,0);const count=h.requests.length;await h.api.retry();assert.equal(h.requests.length,count);
 assert.equal(loaded.accessIdentity,'full');
});

test('a transport timeout from an old write cannot restore its draft after an independent revocation',async()=>{
 const h=harness();await h.load();const full=h.api.details({shiftIds:['shift-0']});await drain();await h.reply(h.requests.at(-1),detail(0));const studio=copy((await full).studio);studio.edits['shift-0'].start='09:00';const saving=h.api.save(studio),flushing=h.api.retry();await drain();assert.equal(h.requests.at(-1).data.action,'write');const notice=h.api.action('timeRead',{});await drain();await h.reply(h.requests.at(-1),{ok:true,accessIdentity:'restricted'});superseded(await notice);assert.equal(await saving,false);await h.expireRequests();await flushing;assert.equal(h.api.hasPendingPlanSave,false);assert.equal(h.api.ready,false);assert.equal(h.visible,null);assert.equal(h.resets,1);
});

test('preference replies do not reintroduce old scope or mark it saved after revocation',async()=>{
 const h=harness();await h.load();const saving=h.api.action('preferences',{preferences:{search:'FOREIGN SEARCH'}});await h.flushTimers();const preference=h.requests.at(-1),notice=h.api.action('timeRead');await drain();await h.reply(h.requests.at(-1),{ok:true,accessIdentity:'restricted'});superseded(await notice);await h.reply(preference,{ok:true,accessIdentity:'full',preferences:{search:'FOREIGN SEARCH'}});const result=await saving;assert.equal(result.ok,false);assert.equal(h.api.preferenceStatus,null);assert.equal(h.api.ready,false);assert.equal(h.visible,null);
});

test('role, membership and scope generations fence weekly caches even when the plan revision is unchanged',()=>{
 const base=page(0),collector=Window.collector(week(0));collector.add(base);const full=collector.finish(),generation=Viewport.generation(full),cache=Viewport.create();cache.put(full);
 for(const patch of [{viewer:{...full.viewer,memberVersion:2}},{viewer:{...full.viewer,roleVersion:2}},{viewer:{...full.viewer,roleId:'another-role'}},{viewer:{...full.viewer,accessScope:{mode:'departments',departmentIds:['dep-nord']}}},{directory:{...full.directory,revision:4}},{capabilities:{...full.capabilities,allowedSiteIds:[0]}}]){
  const changed={...copy(full),...patch};assert.notEqual(Viewport.generation(changed),generation);assert.throws(()=>cache.put(changed),error=>error.generationChanged===true);assert.equal(cache.inspect.weeks,1);
 }
});

test('calendar page collection refuses a mixed access identity even with identical record and plan versions',()=>{
 const first=page(0,{nextCursor:'next'}),collector=Window.collector(week(0));assert.equal(collector.add(first),'next');const second=page(0,{identity:'narrowed',studio:undefined,records:[],publicationRows:[],nextCursor:null});assert.throws(()=>collector.add(second),/ændret/);assert.throws(()=>collector.finish());
});

test('a denied moved employee profile clears stale private caches even though the planner access hash and plan revision are unchanged',async t=>{
 const f=await createDepartmentAccessFixture(t),h=harness({transport:data=>realTransport(f,data)}),projection={mode:'calendar',...f.range},loaded=await h.load(null,projection);assert.equal(loaded.ok,true);assert.equal(h.directory.reconcile(loaded).ok,true);assert.equal((await h.directory.get('employee',f.allowedPerson.id)).ok,true);const identity=loaded.accessIdentity,revision=h.api.revision;
 const request=new Request('https://cleanrooms.example/api/directory',{method:'POST',headers:{origin:'https://cleanrooms.example','content-type':'application/json','oai-authenticated-user-id':f.owner.id,'oai-authenticated-user-email':f.owner.email},body:JSON.stringify({action:'write',changes:[{kind:'employee',id:f.allowedPerson.id,expectedVersion:1,patch:{site:1}}]})}),changed=await Workspace.handleDirectoryRequest(request,f.db);assert.equal(changed.status,200,await changed.clone().text());
 const denied=await h.directory.get('employee',f.allowedPerson.id,{force:true});superseded(denied);assert.equal(h.requests.at(-1).response.error,'department_directory_forbidden');assert.equal(h.requests.at(-1).response.accessIdentity,identity);assert.equal(h.api.revision,revision);assert.equal(h.resets,1);assert.equal(h.directory.records.length,0);assert.equal(h.visible,null);assert.equal(h.api.ready,false);
});

test('department resource revocations reset authority while ordinary denied account actions leave the current plan intact',async()=>{
 for(const code of ['department_person_forbidden','department_site_forbidden','department_forbidden','department_scope_forbidden','department_directory_forbidden','department_scope_unavailable','department_scope_changed','department_company_action_forbidden','department_scope_grant_forbidden','payroll_forbidden']){
  const h=harness();await h.load();const pending=h.api.action('payrollRead',{});await drain();await h.reply(h.requests.at(-1),{ok:false,status:403,accessIdentity:'full',error:code,message:'Denied'});const result=await pending;if(['department_company_action_forbidden','department_scope_grant_forbidden','payroll_forbidden'].includes(code)){assert.equal(result.ok,false);assert.equal(result.superseded,undefined);assert.equal(h.resets,0);assert.equal(h.api.ready,true);}else{superseded(result);assert.equal(h.resets,1,code);assert.equal(h.api.ready,false);}
 }
});

test('an access change observed during reloading still rejects old private account replies',async()=>{
 const h=harness();await h.load();const privateRead=h.api.action('payrollRead',{});await drain();const old=h.requests.at(-1),reload=h.api.load({projection:week(0)});await drain();const loading=h.requests.at(-1);await h.reply(old,{ok:true,accessIdentity:'narrowed',private:'FOREIGN PAYROLL'});superseded(await privateRead);assert.equal(h.resets,1);await h.reply(loading,page(0));assert.equal((await reload).ok,false);assert.equal(h.api.ready,false);assert.equal(h.visible,null);
});

test('a standalone restricted directory preserves sparse indices and cannot fetch or write synthetic placeholders',async()=>{
 for(const index of [0,1,3]){
  const count=4,organization={version:1,sites:Array.from({length:count},(_,site)=>({id:Departments.LEGACY_SITE_IDS[site]||'site-four',name:site===index?'Allowed site':'FOREIGN SITE',address:site===index?'Allowed address':'FOREIGN ADDRESS',color:'var(--cs-blue)'})),departments:[{id:'dep-test',name:'Allowed department',kind:'branch',siteIds:[index]}]},real=DirectoryRecords.flatten({roster:[{...employee('person-own',index),name:'Allowed Person'}],organization}).filter(row=>row.kind!=='site'||row.siteIndex===index).map(row=>({...row,version:1})),calls=[],service=Directory.create({transport:{directoryRead:async payload=>{calls.push(payload);return {ok:true,records:real,directory:{schema:1,revision:3,nextSiteIndex:count},workspace:{id:'workspace'},capabilities:{scopeRestricted:true,allowedSiteIds:[index]},nextCursor:null};},directoryWrite:async()=>assert.fail('Synthetic placeholders may not be written')}});
  assert.equal((await service.loadCatalog()).ok,true);assert.equal(service.organization.sites.length,count);assert.equal(service.organization.sites[index].name,'Allowed site');for(let site=0;site<count;site++)if(site!==index){assert.equal(service.organization.sites[site].restricted,true);assert.equal(service.organization.sites[site].address,'');assert.equal(service.version('site',service.organization.sites[site].id),0);assert.equal((await service.get('site',service.organization.sites[site].id)).status,403);assert.equal((await service.commit([{kind:'site',id:service.organization.sites[site].id,expectedVersion:0,patch:{name:'Forbidden'}}])).status,403);}assert.equal(calls.length,1);noSecret(service.catalog);
  const aliases=service.catalog,versions=service.versions;service.reset();assert.equal(service.reconcile({studio:aliases,directory:{schema:1,revision:3,nextSiteIndex:count,versions,complete:true},workspace:{id:'workspace'},capabilities:{scopeRestricted:true,allowedSiteIds:[index]}}).ok,true);assert.equal(service.organization.sites[index].id,organization.sites[index].id);assert.equal(service.records.length,real.length);
 }
});

test('real role edits and department mapping changes invalidate open clients independently of the plan revision',async t=>{
 for(const kind of ['role','mapping'])await t.test(kind,async t=>{
  const f=await createDepartmentAccessFixture(t);let definition;
  if(kind==='role'){const created=await f.account('createRole',{name:'Limited local payroll viewer',permissions:['plan','payroll.view']});assert.equal(created.status,200);definition=created.body.role;const listed=await f.account('list'),member=listed.body.members.find(item=>item.userId===f.scopedPlanner.id);assert.equal((await f.account('updateMember',{userId:member.userId,version:member.version,roleId:definition.id})).status,200);}
  const h=harness({transport:data=>realTransport(f,data)}),first=await h.load(null,{mode:'calendar',...f.range}),revision=h.api.revision;assert.equal(first.ok,true);
  if(kind==='role')assert.equal((await f.account('updateRole',{roleId:definition.id,version:definition.version,name:definition.name,permissions:['plan']})).status,200);
  else{const request=new Request('https://cleanrooms.example/api/directory',{method:'POST',headers:{origin:'https://cleanrooms.example','content-type':'application/json','oai-authenticated-user-id':f.owner.id,'oai-authenticated-user-email':f.owner.email},body:JSON.stringify({action:'write',changes:[{kind:'department',id:'dep-nord',expectedVersion:1,patch:{siteIds:[1]}}]})}),changed=await Workspace.handleDirectoryRequest(request,f.db);assert.equal(changed.status,200,await changed.clone().text());}
  superseded(await h.api.action('timeRead',{...f.range}));assert.equal(h.api.revision,revision);assert.equal(h.resets,1);assert.equal(h.api.ready,false);assert.equal(h.visible,null);assert.equal(h.api.viewportCache.weeks,0);
 });
});

test('the production access reset clears visible private state and every independent cache synchronously',async()=>{
 const start=appSource.indexOf('  function resetChangedAccess(){'),end=appSource.indexOf('  async function initializeCloud()',start);assert.ok(start>=0&&end>start);const calls=[],state={series:[{note:'FOREIGN'}],edits:{old:{note:'FOREIGN'}},deleted:['old'],weekPlans:{0:{}},publications:{slots:{old:{}}},checklistProgress:{old:{}},activity:[{text:'FOREIGN'}],roster:[employee('person-foreign',1)],organization:{private:'FOREIGN'},coverageRules:[{}],requests:{old:'approved'},leaveDecisions:{old:{}},demoSession:{private:'FOREIGN'},demoSeed:true,departmentId:'all',site:1};
 let release;const waiting=new Promise(resolve=>release=resolve),stub=name=>(()=>calls.push(name)),service=name=>({reset:stub(name+'.reset'),destroy:stub(name+'.destroy'),close:stub(name+'.close')});const context=vm.createContext({state,accessReloadPending:false,cloudLoaded:true,closeEditor:stub('closeEditor'),closeOperationsSheets:stub('closeOperationsSheets'),closeDemoSheets:stub('closeDemoSheets'),accountsView:service('accounts'),accountsElement:{},departmentView:service('departments'),clearChat:stub('chat'),clearWorkflow:stub('workflow'),clearPayroll:stub('payroll'),clearPayrollPolicy:stub('payrollPolicy'),clearTimekeeping:stub('timekeeping'),clearProfileAppLogin:stub('appLogin'),directory:service('directory'),employeeReader:service('employee'),cancelPlannerDetails:stub('plannerDetails'),planningAvailability:service('availability'),lastUndo:{private:'FOREIGN'},staff:[employee('person-foreign',1)],sites:[{name:'FOREIGN'}],staffById:new Map([['person-foreign',{}]]),employeeProfileId:'person-foreign',employeeProfileView:service('profile'),employeeData:{private:'FOREIGN'},payrollProblemReturn:{},payrollProfileReturn:{},payrollPolicyPendingOpen:{},q:()=>({replaceChildren:stub('emptyDOM')}),renderCloudStatus:stub('cloudStatus'),initializeCloud:()=>{calls.push('reload');return waiting;}});
 vm.runInContext(appSource.slice(start,end)+'\nresetChangedAccess();resetChangedAccess();',context);assert.equal(context.cloudLoaded,false);assert.equal(context.staff.length,0);assert.equal(context.sites.length,0);assert.equal(context.staffById.size,0);assert.equal(context.lastUndo,null);assert.equal(context.employeeData,null);noSecret(state);assert.ok(calls.includes('emptyDOM'));for(const cache of ['directory.reset','employee.reset','availability.reset','plannerDetails','payroll','payrollPolicy','timekeeping','chat','workflow'])assert.ok(calls.includes(cache),cache);assert.equal(calls.includes('reload'),false,'The DOM and caches are removed before asynchronously fetching new authority');await drain();assert.equal(calls.filter(name=>name==='reload').length,1);release();await drain();assert.equal(context.accessReloadPending,false);
});
