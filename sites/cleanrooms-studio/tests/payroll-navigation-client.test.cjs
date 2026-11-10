const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf('  staff.forEach(person => { const option');
assert.ok(boundary>0,'The app navigation harness requires the production setup boundary.');
const plain=value=>JSON.parse(JSON.stringify(value));

function application({timeRead,directoryGet,payrollRead,timeWrite}={}){
 const controls=new Map(),actions=[],saved=[],timeRenders=[],salaryRenders=[],shownPayroll=[];let timeCallbacks;
 const control=selector=>{
  if(!controls.has(selector))controls.set(selector,{value:'',hidden:false,disabled:false,dataset:{},children:[],get options(){return this.children;},isConnected:true,setAttribute(){},removeAttribute(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},focus(){}});
  return controls.get(selector);
 };
 const response=payload=>({ok:true,...payload,entries:payload.entryId?[{id:payload.entryId,personId:payload.personId||'p0',date:'2026-10-30',status:'approved',version:1}]:[],shifts:[],plannedRows:[],summary:{counts:{all:payload.entryId?1:0,approved:payload.entryId?1:0,attention:0,ready:0,progress:0}},ledgerVersion:1,planRevision:1,directoryRevision:1,canManage:true,canViewPayroll:true,nextCursor:null});
 const fixture={viewer:{userId:'planner',version:1,memberVersion:1,roleVersion:1},action:async(action,payload)=>{
  actions.push({action,payload:plain(payload)});
  if(action==='timeRead')return timeRead?timeRead(payload,response):response(payload);
  if(action==='timeWrite'&&timeWrite)return timeWrite(payload);
  if(action==='payrollRead')return payrollRead?payrollRead(payload):{ok:true,personId:payload.personId,version:0,payroll:null,policyVersion:0,policy:{schema:1,groups:[],links:[]}};
  throw Error('Unexpected mutation during navigation: '+action);
 },save:async snapshot=>{saved.push(plain(snapshot));return true;},directoryGet};
 const context=vm.createContext({TextEncoder,Date,Map,Set,WeakMap,Math,JSON,Number,String,Array,Object,RegExp,setTimeout,clearTimeout,
  document:{getElementById:()=>({querySelector:control,querySelectorAll:()=>[]}),createElement:tag=>control('created-'+tag+'-'+controls.size)},
  CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
  CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDepartments:require('../src/department-model.js'),CleanRoomsData:require('../src/studio-data.js'),
  CleanRoomsEmployeeCalendar:require('../src/employee-calendar.js'),CleanRoomsPayroll:require('../src/payroll-model.js'),CleanRoomsPayrollGroups:require('../src/payroll-groups-model.js'),CleanRoomsTimekeeping:require('../src/timekeeping-model.js'),
  CleanRoomsTimekeepingView:{mount:callbacks=>{timeCallbacks=callbacks;return {render:props=>timeRenders.push(plain(props)),destroy(){}};}},
  CleanRoomsPayrollView:{mount:()=>({render(){},destroy(){}})},CleanRoomsPayrollPersonGroupView:{mount:()=>({render(){},destroy(){}})},
  fixture,salaryRenders,shownPayroll
 });
 vm.runInContext(source.slice(0,boundary)+`
  cloudLoaded=true;sessionViewer=fixture.viewer;cloudCapabilities={plan:true,viewPayroll:true,companyPayroll:true};chatWorkspaceId='workspace-navigation';persistence={action:fixture.action,save:fixture.save};
  if(fixture.directoryGet){directory={ready:true,catalogRevision:1,get:fixture.directoryGet};state.roster=staff.map(person=>({...person}));}
  employeeProfileView={reset(){},showPayroll(){shownPayroll.push(employeeProfileId);}};
  render=()=>{if(state.page==='hours')renderHours();else if(employeeProfileId)renderEmployeeProfile();};
  renderEmployeeProfile=()=>{payrollPane(staff.find(person=>person.id===employeeProfileId));salaryRenders.push({personId:employeeProfileId,month:employeeProfileMonth,date:payrollProblemReturn?.date,returnTo:payrollProblemReturn});};
  renderPayroll=()=>{};
  globalThis.navigationClient={navigatePayrollProblem,clearTimeFocus,closeEmployeeProfile,renderHours,save,
   snapshot:()=>({page:state.page,role:state.role,focus:timeFocus,range:timeRange(),employeeProfileId,employeeProfileMonth,payrollMonth,payrollProblemReturn,timeState}),
   invalidateSession(){sessionViewer={userId:'different-planner',version:2};directoryProfileEpoch++;employeeProfileId=null;clearTimekeeping();clearPayroll();state.page='schedule';},
   revokePayroll(){cloudCapabilities.viewPayroll=false;},
   configureCapabilities(values){Object.assign(cloudCapabilities,values);},
   configureScoped(people){cloudCapabilities.scopeRestricted=true;cloudCapabilities.allowedSiteIds=[1];state.roster=people;state.organization={sites:[{id:'site-nord'},{id:'site-klinik'}],departments:[{id:'dep-klinik'}]};state.employeePerson='p0';state.worksiteSite=0;state.site=0;state.departmentId='dep-nord';syncRoster();return {employeePerson:state.employeePerson};}
  };
 })();`,context,{filename:'app.js (payroll navigation integration)'});
 return {...context.navigationClient,actions,saved,timeRenders,salaryRenders,shownPayroll,response,control,get callbacks(){return timeCallbacks;}};
}
const period={from:'2026-10-21',to:'2026-11-20'};
const hoursTarget={kind:'hours',...period,problem:'missing_payroll',entryId:'entry-on-page-20',personId:'p0',date:'2026-10-30'};

test('a payroll blocker requests the exact pay period and entry, independent of the normal calendar week',async()=>{
 const app=application();assert.equal(await app.navigatePayrollProblem(hoursTarget),true);
 assert.deepEqual(app.actions,[{action:'timeRead',payload:{...period,queue:'all',search:'',scope:'real',problem:'missing_payroll',entryId:'entry-on-page-20',personId:'p0',pageSize:50}}]);
 assert.deepEqual(plain(app.snapshot().range),period);assert.equal(app.snapshot().page,'hours');const props=app.timeRenders.at(-1);
 assert.deepEqual(props.periodFocus,{...period,problem:'missing_payroll',entryId:'entry-on-page-20',personId:'p0'});assert.equal(props.requestedEntryId,'entry-on-page-20');assert.equal(props.serverFilter.problem,'missing_payroll');assert.equal(props.serverFilter.entryId,'entry-on-page-20');assert.deepEqual(props.entries.map(entry=>entry.id),['entry-on-page-20']);
 assert.equal(typeof app.callbacks.onPayrollPeriodNavigate,'function');assert.equal(typeof app.callbacks.onClearPeriodFocus,'function');
});
test('closing the requested registration keeps the whole payroll problem period, while clearing context restores the normal week',async()=>{
 const app=application();await app.navigatePayrollProblem(hoursTarget);await app.callbacks.onCloseFocusedEntry();
 assert.deepEqual(app.actions.at(-1),{action:'timeRead',payload:{...period,queue:'all',search:'',scope:'real',problem:'missing_payroll',pageSize:50}});assert.deepEqual(plain(app.snapshot().focus),{...period,problem:'missing_payroll'});assert.equal(app.timeRenders.at(-1).requestedEntryId,null);
 await app.callbacks.onClearPeriodFocus();const request=app.actions.at(-1).payload;assert.equal(request.problem,undefined);assert.equal(request.entryId,undefined);assert.equal(app.snapshot().focus,null);assert.equal((Date.parse(request.to)-Date.parse(request.from))/86400000,6);
});
test('switching from a payroll problem to approved payroll removes drilldown filters but retains the pay period',async()=>{
 const app=application();await app.navigatePayrollProblem(hoursTarget);assert.equal(await app.callbacks.onFilterChange({queue:'approved',search:'',scope:'real'}),true);
 assert.deepEqual(app.actions.at(-1),{action:'timeRead',payload:{...period,queue:'approved',search:'',scope:'real',pageSize:50}});assert.deepEqual(plain(app.snapshot().focus),period);assert.deepEqual(app.timeRenders.at(-1).periodFocus,period);assert.equal(app.timeRenders.at(-1).requestedEntryId,null);
});
test('the real time command retains a reopened payroll repair until reapproval then loads the remaining period problems',async()=>{
 let record={id:hoursTarget.entryId,personId:'p0',date:hoursTarget.date,status:'approved',version:7};
 const app=application({
  timeRead:(payload,response)=>{const entries=payload.problem==='unapproved'&&record.status==='approved'?[]:[{...record}];return {...response(payload),entries,ledgerVersion:record.version,summary:{counts:{all:entries.length,approved:record.status==='approved'?entries.length:0,attention:record.status==='submitted'?entries.length:0,ready:0,progress:0}}};},
  timeWrite:payload=>{assert.equal(payload.entryId,record.id);assert.equal(payload.version,record.version);assert.ok(['reopen','approve'].includes(payload.operation));record={...record,status:payload.operation==='reopen'?'submitted':'approved',version:record.version+1};return {ok:true,entry:{...record},ledgerVersion:record.version};}
 });
 assert.equal(await app.navigatePayrollProblem(hoursTarget),true);assert.equal(app.actions.filter(item=>item.action==='timeWrite').length,0);
 assert.equal((await app.callbacks.onAction('timeWrite',{operation:'reopen',entryId:record.id,version:7,reason:'Lønaftalen er rettet'})).ok,true);await app.callbacks.onRefresh();
 const repaired=app.timeRenders.at(-1);assert.equal(repaired.periodFocus.problem,'unapproved');assert.equal(repaired.requestedEntryId,record.id);assert.equal(repaired.serverFilter.problem,'unapproved');assert.equal(repaired.entries[0].status,'submitted');assert.equal(repaired.entries[0].version,8);assert.deepEqual(app.actions.filter(item=>item.action==='timeWrite').map(item=>item.payload.operation),['reopen']);
 assert.equal((await app.callbacks.onAction('timeWrite',{operation:'approve',entryId:record.id,version:8})).ok,true);await app.callbacks.onRefresh();const done=app.timeRenders.at(-1);
 assert.deepEqual(done.periodFocus,{...period,problem:'unapproved'});assert.equal(done.requestedEntryId,null);assert.equal(done.serverFilter.entryId,undefined);assert.deepEqual(done.entries,[]);assert.deepEqual(app.actions.filter(item=>item.action==='timeWrite').map(item=>item.payload.operation),['reopen','approve']);
 const latestRead=app.actions.filter(item=>item.action==='timeRead').at(-1).payload;assert.deepEqual(latestRead,{...period,queue:'all',search:'',scope:'real',problem:'unapproved',pageSize:50});
});
test('a pending repair for one entry cannot replace a newer payroll problem destination',async()=>{
 let release;const app=application({timeWrite:()=>new Promise(resolve=>{release=resolve;})});await app.navigatePayrollProblem(hoursTarget);
 const pending=app.callbacks.onAction('timeWrite',{operation:'reopen',entryId:hoursTarget.entryId,version:1,reason:'Lønaftalen er rettet'}),next={...hoursTarget,entryId:'newer-destination',personId:'p1'};
 assert.equal(await app.navigatePayrollProblem(next),true);release({ok:true,entry:{id:hoursTarget.entryId,personId:'p0',date:hoursTarget.date,status:'submitted',version:2},ledgerVersion:2});await pending;await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(plain(app.snapshot().focus),{...period,problem:'missing_payroll',entryId:'newer-destination',personId:'p1'});assert.equal(app.timeRenders.at(-1).requestedEntryId,'newer-destination');assert.deepEqual(app.timeRenders.at(-1).entries.map(entry=>entry.id),['newer-destination']);assert.equal(app.snapshot().page,'hours');
});
test('salary repair opens the exact employee and occurrence date and returns to that registration without financial writes',async()=>{
 const app=application();assert.equal(await app.navigatePayrollProblem({...hoursTarget,kind:'payroll-person'}),true);
 assert.equal(app.snapshot().employeeProfileId,'p0');assert.equal(app.snapshot().employeeProfileMonth,'2026-10');assert.equal(app.snapshot().payrollMonth,'2026-10');assert.equal(app.salaryRenders.at(-1).date,'2026-10-30');assert.deepEqual(app.shownPayroll,['p0']);assert.deepEqual(app.actions,[{action:'payrollRead',payload:{personId:'p0'}}]);
 app.closeEmployeeProfile();await new Promise(resolve=>setImmediate(resolve));assert.equal(app.snapshot().page,'hours');assert.deepEqual(plain(app.snapshot().focus),{...period,problem:'missing_payroll',entryId:hoursTarget.entryId,personId:'p0'});assert.equal(app.actions.at(-1).action,'timeRead');assert.ok(app.actions.every(item=>!['timeWrite','payrollSave','payrollPersonPolicySave'].includes(item.action)));
});
test('a superseded session cannot apply an awaited time page or complete stale navigation',async()=>{
 let release;const app=application({timeRead:(payload,response)=>new Promise(resolve=>{release=()=>resolve(response(payload));})});const pending=app.navigatePayrollProblem(hoursTarget);assert.equal(typeof release,'function');app.invalidateSession();release();assert.equal(await pending,false);assert.equal(app.snapshot().page,'schedule');assert.equal(app.snapshot().focus,null);assert.deepEqual(plain(app.snapshot().timeState.entries),[]);
});
test('a superseded employee-directory read cannot open the prior employee salary page',async()=>{
 let release;const app=application({directoryGet:()=>new Promise(resolve=>{release=resolve;})});const pending=app.navigatePayrollProblem({...hoursTarget,kind:'payroll-person'});app.invalidateSession();release({ok:true,record:{id:'p0',version:1,value:{id:'p0',name:'Old employee'}}});assert.equal(await pending,false);assert.equal(app.snapshot().employeeProfileId,null);assert.equal(app.snapshot().page,'schedule');assert.deepEqual(app.actions,[]);assert.deepEqual(app.shownPayroll,[]);
});
test('a newer hours destination supersedes a pending salary directory read without jumping back to the profile',async()=>{
 let release;const app=application({directoryGet:()=>new Promise(resolve=>{release=resolve;})}),salary=app.navigatePayrollProblem({...hoursTarget,kind:'payroll-person'});
 assert.equal(await app.navigatePayrollProblem(hoursTarget),true);release({ok:true,record:{id:'p0',version:1,value:{id:'p0',name:'Old employee'}}});assert.equal(await salary,false);assert.equal(app.snapshot().page,'hours');assert.equal(app.snapshot().employeeProfileId,null);assert.deepEqual(plain(app.snapshot().focus),{...period,problem:'missing_payroll',entryId:hoursTarget.entryId,personId:'p0'});assert.deepEqual(app.shownPayroll,[]);assert.deepEqual(app.actions.map(item=>item.action),['timeRead']);
});
test('invalid navigation targets and payroll access loss never dispatch a read or financial mutation',async()=>{
 const app=application(),invalid=[null,{...hoursTarget,kind:'url'},{...hoursTarget,problem:'arbitrary-query'},{...hoursTarget,from:'2026-02-30'},{...hoursTarget,to:'2026-10-01'},{...hoursTarget,to:'2028-01-01'},{...hoursTarget,entryId:''},{...hoursTarget,personId:[]},{...hoursTarget,kind:'payroll-person',date:'2026-12-01'},{...hoursTarget,kind:'payroll-person',personId:'not-in-directory'}];
 for(const target of invalid)assert.equal(await app.navigatePayrollProblem(target),false);assert.deepEqual(app.actions,[]);assert.equal(app.snapshot().page,'schedule');app.revokePayroll();assert.equal(await app.navigatePayrollProblem(hoursTarget),false);assert.deepEqual(app.actions,[]);
});
test('scoped preference saves never send the initial foreign employee or worksite, including an empty department roster',async()=>{
 for(const people of [[{id:'p1',name:'Allowed employee',site:1,active:true}],[]]){
  const app=application(),selection=app.configureScoped(people);assert.equal(selection.employeePerson,people[0]?.id||'');assert.deepEqual(app.control('#cs-employee-person').options.map(option=>option.value),people.map(person=>person.id));
  assert.equal(await app.save(),true);assert.equal(app.saved.length,1);const snapshot=app.saved[0];assert.equal(snapshot.employeePerson,people[0]?.id);assert.equal(Object.hasOwn(snapshot,'worksiteSite'),false);assert.equal(snapshot.site,'all');assert.equal(snapshot.departmentId,'all');assert.equal(app.actions.length,0);
 }
});
