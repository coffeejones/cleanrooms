const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const clone=value=>JSON.parse(JSON.stringify(value)),settle=async()=>{for(let index=0;index<30;index++)await Promise.resolve();};
const file=fs.readFileSync(path.join(__dirname,'series-editor-integration.test.cjs'),'utf8'),end=file.indexOf('\ntest(');assert.ok(end>0);
let fixture=file.slice(0,end);
function replace(before,after){assert.ok(fixture.includes(before),before);fixture=fixture.replace(before,after);}
replace('let publicationControls=null;const reviewed=[];',`let publicationControls=null;const reviewed=[],boards=[];
  const costClock={now:Date.now()},costDialog={view:null,log:[]};`);
replace('CleanRoomsCalendar:{revealDay(){}},',`fixtureCostClock:costClock,fixtureCostDialog:costDialog,
    CleanRoomsPlanningCostView:{mount:options=>{const view={isOpen:false,open:values=>{view.isOpen=true;costDialog.log.push({kind:'open',values});},update:values=>{costDialog.log.push({kind:'update',values});},close:values=>{if(view.isOpen){view.isOpen=false;costDialog.log.push({kind:'close',values});options.onClose();}}};costDialog.view=view;costDialog.options=options;return view;}},
    CleanRoomsCalendar:{revealDay(){},render:options=>{boards.push(options);return {element:new Element(),dispose(){}};}},`);
replace('Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,','Date:class extends Date{static now(){return costClock.now;}},Map,Set,Math,JSON,Number,String,Array,Object,RegExp,');
replace('let renderedWindows=0,reviewedWindows=0;','let renderedWindows=0,reviewedWindows=0,costRefreshes=0;initializeCloud=async()=>{costRefreshes++;};');
replace('state,openEditor,openSeriesEditor,',`state,sites:()=>sites,planningCostTarget,syncPlanningCosts,planningWeekCost,openPlanningWeekCost,
      setCostRights:value=>{cloudCapabilities={...cloudCapabilities,...value};},setDirectory:value=>{directory=value;},
      costDialog:()=>globalThis.fixtureCostDialog,costRefreshes:()=>costRefreshes,advanceClock:value=>{globalThis.fixtureCostClock.now+=value;},
      openEditor,openSeriesEditor,`);
const application=Function('require','__dirname',fixture+'\nreturn application;')(require,__dirname);
const first='2026-11-02',second='2026-11-09',add=(day,n)=>require('../src/planning-scope.js').add(day,n),week=from=>({from,to:add(from,6)});
function setup({rights=true,from=first,to=add(first,6)}={}){
 const app=application(),requests=[];let current={from,to};
 Object.assign(app.state,{demoSeed:false,page:'schedule',role:'admin',view:'week',week:1,search:'',site:'all',onlyOpen:false,series:[],edits:{},deleted:[],weekPlans:{},requests:{},departmentId:'all'});
 app.state.organization={version:1,sites:[],departments:[{id:'dep-nord',name:'Nord',kind:'branch',siteIds:[0]}]};
 app.sites().forEach((site,index)=>site.id='site-'+index);
 const covers=range=>range.from>=current.from&&range.to<=current.to;
 const api={ready:true,isPartial:true,coverageValid:true,revision:1,directoryRevision:2,calendarGeneration:'initial',covers,viewportCovers:covers,coversScope:covers,viewport:async()=>({ok:true}),
   action:(name,payload)=>new Promise(resolve=>requests.push({name,payload:clone(payload),resolve}))};
 app.installWindow(api);app.setCostRights({plan:true,viewPayroll:rights});
 const answer=async(index,changes={})=>{
  const request=requests[index];assert.ok(request,'A corresponding wage request exists');const weeks=[];
  for(let day=request.payload.from;day<=request.payload.to;day=add(day,7))weeks.push({...week(day),baseCents:100000,supplementCents:10000,totalCents:110000,minutes:300,shiftCount:1,openShiftCount:0,missingShiftCount:0,monthlyPersonCount:0,fixedSupplementPersonCount:0,overlapShiftCount:0,complete:true,people:[{personId:'p0',name:'Jonas',shiftCount:1,minutes:300,baseCents:100000,supplementCents:10000,totalCents:110000,monthly:false,fixedSupplement:false}]});
  request.resolve({ok:true,revision:api.revision,directoryRevision:api.directoryRevision,scope:clone(request.payload.scope),weeks,...changes});await settle();
 };
 return {app,api,requests,answer,setRange:value=>{current=clone(value);}};
}

test('cost reads are gated by actual payroll rights and never start for employees, day views or unloaded calendars',()=>{
 for(const change of [app=>app.setCostRights({viewPayroll:false}),app=>app.setCostRights({plan:false}),app=>{app.state.role='employee';},app=>{app.state.view='day';},app=>{app.state.demoSession={scenario:'example'};}]){
  const {app,requests}=setup();change(app);assert.equal(app.planningCostTarget(),null);app.syncPlanningCosts();assert.equal(requests.length,0);assert.equal(app.planningWeekCost(first),null);
 }
 const {app,api,requests,setRange}=setup();api.ready=false;app.syncPlanningCosts();assert.equal(requests.length,0);api.ready=true;setRange(week('2028-01-03'));app.syncPlanningCosts();assert.equal(requests.length,0);
});
test('only loaded calendar weeks are requested and the durable selected scope follows department then specific worksite',async()=>{
 const {app,requests,answer}=setup({to:add(second,6)});app.state.departmentId='dep-nord';
 app.syncPlanningCosts();assert.equal(requests.length,1);assert.equal(requests[0].name,'planningCostRead');assert.deepEqual(requests[0].payload,{from:first,to:add(second,6),scope:{kind:'department',id:'dep-nord'}});await answer(0);
 assert.equal(app.planningWeekCost(first).totalCents,110000);assert.equal(app.planningWeekCost(first).state,'ready');
 app.state.site='0';app.syncPlanningCosts();assert.equal(requests.length,2);assert.deepEqual(requests[1].payload.scope,{kind:'site',id:'site-0'});await answer(1);
 app.state.departmentId='all';app.state.site='all';app.syncPlanningCosts();assert.equal(requests.length,3);assert.deepEqual(requests[2].payload.scope,{kind:'company'});await answer(2);
});
test('pending plan saves suppress reads and mark a cached estimate as updating until the acknowledged revision is read',async()=>{
 const {app,api,requests,answer}=setup();api.hasPendingPlanSave=true;app.syncPlanningCosts();assert.equal(requests.length,0);assert.equal(app.planningWeekCost(first).state,'saving');
 api.hasPendingPlanSave=false;app.syncPlanningCosts();await answer(0);assert.equal(app.planningWeekCost(first).state,'ready');
 api.hasPendingPlanSave=true;app.syncPlanningCosts();assert.equal(requests.length,1);assert.equal(app.planningWeekCost(first).state,'saving');
 api.hasPendingPlanSave=false;api.revision=2;app.syncPlanningCosts();assert.equal(requests.length,2);assert.equal(app.planningWeekCost(first).state,'loading');
 await answer(1,{weeks:[{...week(first),baseCents:200000,supplementCents:20000,totalCents:220000,missingShiftCount:0,openShiftCount:0,monthlyPersonCount:0,fixedSupplementPersonCount:0,people:[]}]});assert.equal(app.planningWeekCost(first).state,'ready');assert.equal(app.planningWeekCost(first).totalCents,220000);
});
test('fresh results are cached and a directory revision change or expired thirty-second window starts exactly one refresh',async()=>{
 const {app,api,requests,answer}=setup();app.syncPlanningCosts();app.syncPlanningCosts();assert.equal(requests.length,1);await answer(0);app.syncPlanningCosts();assert.equal(requests.length,1);
 app.advanceClock(30001);app.syncPlanningCosts();app.syncPlanningCosts();assert.equal(requests.length,2);await answer(1);
 app.setDirectory({revision:3});app.syncPlanningCosts();assert.equal(requests.length,3);api.directoryRevision=3;await answer(2);assert.equal(app.planningWeekCost(first).state,'ready');
});
test('a late response from another scope cannot become the selected amount or dialog content',async()=>{
 const {app,requests,answer}=setup();app.syncPlanningCosts();app.state.site='1';app.syncPlanningCosts();assert.equal(requests.length,1,'An existing request is serialized');await answer(0);
 assert.equal(requests.length,2,'Rendering resumes only the latest selected scope');assert.deepEqual(requests[1].payload.scope,{kind:'site',id:'site-1'});assert.equal(app.planningWeekCost(first).totalCents,undefined);assert.equal(app.planningWeekCost(first).state,'loading');
 await answer(1);app.openPlanningWeekCost(first,app.control('#fixture-trigger'));const dialog=app.costDialog();assert.equal(dialog.view.isOpen,true);assert.equal(dialog.log.at(-1).values.scopeLabel,'Klinikken');
 app.state.departmentId='dep-nord';app.state.site='all';app.syncPlanningCosts();assert.equal(dialog.view.isOpen,false);assert.equal(dialog.log.at(-1).kind,'close');
});
test('page changes drop delayed values and permission loss closes the dialog and discards salary cache',async()=>{
 const firstCase=setup();firstCase.app.syncPlanningCosts();firstCase.app.state.page='hours';await firstCase.answer(0);assert.equal(firstCase.requests.length,1);assert.equal(firstCase.app.planningWeekCost(first),null);firstCase.app.state.page='schedule';firstCase.app.syncPlanningCosts();assert.equal(firstCase.requests.length,2,'The abandoned response was never cached');await firstCase.answer(1);
 const {app,requests,answer}=setup();app.syncPlanningCosts();await answer(0);app.openPlanningWeekCost(first,app.control('#fixture-trigger'));assert.equal(app.costDialog().view.isOpen,true);
 app.setCostRights({viewPayroll:false});app.syncPlanningCosts();assert.equal(app.costDialog().view.isOpen,false);assert.equal(app.planningWeekCost(first),null);app.setCostRights({viewPayroll:true});app.syncPlanningCosts();assert.equal(requests.length,2,'Restoring rights cannot reuse discarded private cache');
 app.setCostRights({viewPayroll:false});await answer(1);app.setCostRights({viewPayroll:true});app.syncPlanningCosts();assert.equal(requests.length,3,'A response arriving after rights loss also cannot enter cache');
});
test('forbidden and stale responses do not leave apparently ready wages and demand a refresh of authority',async()=>{
 const revoked=setup();revoked.app.syncPlanningCosts();await revoked.answer(0,{ok:false,status:403});assert.equal(revoked.app.planningWeekCost(first),null);assert.equal(revoked.app.costRefreshes(),1);assert.equal(revoked.requests.length,1);
 for(const changed of [{revision:99},{directoryRevision:99}]){
  const {app,requests,answer}=setup();app.syncPlanningCosts();await answer(0,changed);assert.equal(app.planningWeekCost(first).state,'error');assert.equal(app.planningWeekCost(first).totalCents,undefined);app.syncPlanningCosts();assert.equal(requests.length,1,'An error is not an automatic retry storm');app.openPlanningWeekCost(first,app.control('#fixture-trigger'));app.costDialog().options.onRetry();assert.equal(app.costRefreshes(),1);
 }
});
test('missing, duplicate or malformed week receipts never become apparently ready wage estimates',async()=>{
 const valid={...week(first),baseCents:10000,supplementCents:1000,totalCents:11000,missingShiftCount:0,openShiftCount:0,monthlyPersonCount:0,fixedSupplementPersonCount:0,people:[]};
 for(const weeks of [[],[valid,valid],[{...valid,to:first}],[{...valid,totalCents:11001}],[{...valid,missingShiftCount:-1}],[{...valid,totalCents:NaN}],[{...valid,people:null}]]){
  const {app,requests,answer}=setup();app.syncPlanningCosts();await answer(0,{weeks});assert.equal(app.planningWeekCost(first).state,'error');assert.equal(app.planningWeekCost(first).totalCents,undefined);app.syncPlanningCosts();assert.equal(requests.length,1);
 }
});
test('the sandbox persistence transports planningCostRead through its fixed account channel without writing the plan',async()=>{
 const persistenceFile=fs.readFileSync(path.join(__dirname,'studio-persistence.test.cjs'),'utf8'),last=persistenceFile.indexOf('\ntest(');assert.ok(last>0);
 const harness=Function('require',persistenceFile.slice(0,last)+'\nreturn harness;')(require),h=harness();
 await h.loaded(1,null,{capabilities:{plan:true,viewPayroll:true}});
 const payload={...week(first),scope:{kind:'site',id:'site-nord'}},promise=h.api.action('planningCostRead',payload);await new Promise(resolve=>setImmediate(resolve));
 const request=h.requests.at(-1);assert.equal(request.data.action,'account');assert.equal(request.data.operation,'planningCostRead');assert.deepEqual(request.data.payload,payload);assert.equal(h.writes().length,0);
 await h.reply(request,{ok:true,revision:1,directoryRevision:2,scope:payload.scope,weeks:[]});const result=await promise;assert.equal(result.ok,true);assert.deepEqual(clone(result.weeks),[]);
});
