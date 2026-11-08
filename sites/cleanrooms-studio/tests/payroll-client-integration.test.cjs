const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary>0,'Exercise the production functions without adding application test hooks.');
const plain=value=>JSON.parse(JSON.stringify(value));
const person=(id,name,target=30,site=0)=>({id,name,initials:name.split(' ').map(part=>part[0]).join(''),target,site,role:'Servicemedarbejder',active:true});
const anna=person('person-anna','Anna Hansen'),bob=person('person-bob','Bob Jensen',20,1);
const shift=(id,person,date,site=0,start='07:00',end='15:00')=>({id,person,date,site,start,end,note:''});
const payroll=(amountCents=20000)=>({currency:'DKK',agreements:[{id:'confidential-rate',from:'2026-01-01',type:'hourly',amountCents}],supplements:[]});
const receipt=(personId=anna.id,version=2,configured=payroll())=>({ok:true,personId,version,payroll:configured,policyVersion:0,policy:{schema:1,groups:[],links:[]},updatedAt:'2026-10-31T10:00:00.000Z'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settled=()=>new Promise(resolve=>setImmediate(resolve));

function application(){
  const controls=new Map(),profiles=[],payViews=[],policyViews=[],personGroupViews=[],actions=[],sharedSaves=[],responses=[],reloads=[],messages=[];
  const doc={activeElement:null};
  const descendants=element=>element.children.flatMap(child=>[child,...descendants(child)]);
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.className='';this.scrollTop=0;this._text='';}
    get isConnected(){return this.parentElement?.isConnected===true;}
    append(...children){for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(item=>item!==child);child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
    get options(){return this.children;}
    set textContent(value){this._text=String(value);this.replaceChildren();}
    get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    setAttribute(){}
    removeAttribute(){}
    querySelectorAll(selector){return descendants(this).filter(element=>selector.startsWith('.')?element.className.split(' ').includes(selector.slice(1)):element.tagName===selector.toUpperCase());}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){doc.activeElement=this;}
    scrollIntoView(){}
  }
  const root={isConnected:true,querySelector:selector=>control(selector),querySelectorAll:()=>[]};
  const control=selector=>{if(!controls.has(selector)){const value=new Element();value.parentElement=root;controls.set(selector,value);}return controls.get(selector);};
  Object.assign(doc,{getElementById:()=>root,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:String(text),children:[]})});
  const transport={
    action:async(action,payload)=>{actions.push({action,payload:plain(payload)});assert.ok(responses.length,'Provide an explicit server result for '+action);return await responses.shift();},
    save:async shared=>{sharedSaves.push(plain(shared));return true;},discardPending(){}
  };
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-31'},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsRosterPlanning:require('../src/roster-planning.js'),CleanRoomsEmployeeCalendar:require('../src/employee-calendar.js'),
    CleanRoomsEmployeeProfileCalendar:require('../src/employee-profile-calendar.js'),CleanRoomsPayroll:require('../src/payroll-model.js'),CleanRoomsPayrollGroups:require('../src/payroll-groups-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsRosterView:{mount:()=>({render(){},destroy(){}})},
    CleanRoomsEmployeeProfileView:{mount:options=>{const view={options,renders:[],resets:0};profiles.push(view);options.element.append(new Element('h2'));return {render:rendered=>{view.renders.push(rendered);if(rendered.payrollElement)options.element.append(rendered.payrollElement);},reset(){view.resets++;}};}},
    CleanRoomsPayrollView:{mount:options=>{const view={options,renders:[],destroyed:false};payViews.push(view);return {render:rendered=>{view.renders.push(rendered);options.element.textContent=rendered.payroll?JSON.stringify(rendered.payroll):'';},destroy(){view.destroyed=true;options.element.replaceChildren();options.element.textContent='';}};}},
    CleanRoomsPayrollPersonGroupView:{mount:options=>{const view={options,renders:[]};personGroupViews.push(view);return {render:rendered=>view.renders.push(rendered),destroy(){options.element.replaceChildren();}};}},
    CleanRoomsPayrollGroupsView:{mount:options=>{const view={options,renders:[],opened:[],destroyed:false};policyViews.push(view);return {render:rendered=>view.renders.push(rendered),openGroup:(groupId,context)=>view.opened.push({groupId,context}),destroy(){view.destroyed=true;options.element.replaceChildren();}};}},
    document:doc,window:{},Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    __transport:transport,__reload:value=>reloads.push(plain(value)),__notify:message=>messages.push(message)
  });
  vm.runInContext(source.slice(0,boundary)+`
    render=()=>renderRoster();notify=message=>globalThis.__notify(message);persistence=globalThis.__transport;
    initializeCloud=async()=>{globalThis.__reload({record:clone(payrollState),hasView:Boolean(payrollView)});cloudCapabilities={plan:false,viewPayroll:false,managePayroll:false};};
    globalThis.payrollTest={state,renderRoster,renderEmployeeProfile,openEmployeeProfile,closeEmployeeProfile,saveEmployeeProfile,
      loadPayroll,savePayroll,savePayrollPersonPolicy,clearPayroll,renderPayrollPolicyPage,loadPayrollPolicy,clearPayrollPolicy,previewPayrollPolicy,savePayrollPolicy,policyRecord:()=>clone(payrollPolicyState),canViewPayroll,canManagePayroll,renderPayroll,accountPreferences,snapshot,
      setup:(people,work={})=>{Object.assign(state,{roster:clone(people),demoSeed:false,series:[],edits:{},deleted:[],page:'people',role:'admin'},clone(work));syncRoster();},
      access:(capabilities,options={})=>{cloudCapabilities={...capabilities};cloudLoaded=options.loaded!==false;cloudStatus={state:'saved',conflict:options.conflict===true};sessionViewer={userId:'fixture',role:options.role||'planner'};},
      record:()=>clone(payrollState),profileId:()=>employeeProfileId,sharedSave:()=>save()
    };
  })();`,context,{filename:'app.js (private payroll integration)'});
  const app=context.payrollTest;app.access({plan:true,manageUsers:true,viewPayroll:true,managePayroll:true});app.setup([anna,bob]);
  return {...app,control,profiles,payViews,policyViews,personGroupViews,actions,sharedSaves,reloads,messages,enqueue:value=>responses.push(value),view:()=>payViews.at(-1),last:()=>payViews.at(-1)?.renders.at(-1)};
}

test('payroll reads are lazy per employee and view-only permission never enables a mutation',async()=>{
  const app=application();app.access({plan:true,manageUsers:false,viewPayroll:true,managePayroll:false});app.openEmployeeProfile(anna.id);
  assert.equal(app.actions.length,0);assert.equal(app.profiles[0].renders.at(-1).canViewPayroll,true);assert.equal(app.canViewPayroll(),true);assert.equal(app.canManagePayroll(),false);assert.equal(app.last().estimate,null);assert.equal(app.last().canManage,false);
  app.profiles[0].options.onTabChange('calendar');assert.equal(app.actions.length,0);
  app.enqueue(receipt());app.profiles[0].options.onTabChange('pay');await settled();
  assert.deepEqual(app.actions,[{action:'payrollRead',payload:{personId:anna.id}}]);assert.equal(app.record().loaded,true);assert.equal(app.last().canManage,false);assert.equal(app.last().estimate.totalCents,0);
  app.profiles[0].options.onTabChange('pay');await settled();assert.equal(app.actions.length,1,'Returning to the same pay tab uses the current private record.');
  assert.equal((await app.view().options.onSave(payroll(25000),2,0)).ok,false);assert.equal(app.actions.length,1);assert.equal(app.sharedSaves.length,0);
});

test('the private estimate uses the selected month and actual effective assignments across every site',async()=>{
  const app=application(),series={id:'pattern',person:anna.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:''};
  const reassigned={...shift(series.id+'@2026-10-27',bob.id,'2026-11-02',2),seriesId:series.id};
  const movedOut={...shift(series.id+'@2026-11-03',anna.id,'2026-10-31',1),seriesId:series.id};
  const shortened={...shift(series.id+'@2026-11-10',anna.id,'2026-11-10',2,'10:00','12:00'),seriesId:series.id};
  app.setup([anna,bob],{week:18,site:'0',search:'Bob',onlyOpen:true,series:[series],edits:{[reassigned.id]:reassigned,[movedOut.id]:movedOut,[shortened.id]:shortened,final:shift('final',anna.id,'2026-11-30',1,'08:00','09:00')},deleted:[series.id+'@2026-11-05']});
  app.openEmployeeProfile(anna.id);const before=plain(app.state);app.enqueue(receipt());await app.loadPayroll();app.view().options.onMonthChange('2026-11');
  const result=app.last().estimate;assert.equal(result.month,'2026-11');assert.deepEqual(result.shifts.map(item=>item.id),[shortened.id,series.id+'@2026-11-12','final']);assert.equal(result.minutes,660);assert.equal(result.shiftCount,3);assert.equal(result.totalCents,220000);assert.deepEqual(result.shifts.map(item=>item.site),[2,0,1]);assert.deepEqual(plain(app.state),before);assert.equal(app.sharedSaves.length,0);
});

test('no payroll capability or an unloaded session performs a fetch or save despite client role labels',async()=>{
  for(const [capabilities,options] of [[{plan:true,viewPayroll:false,managePayroll:true},{}],[{plan:false,viewPayroll:true,managePayroll:true},{}],[{plan:true,viewPayroll:true,managePayroll:true},{loaded:false}]]){
    const app=application();app.access(capabilities,{role:'admin',...options});app.openEmployeeProfile(anna.id);await app.loadPayroll();
    assert.equal(app.canViewPayroll(),false);assert.equal(app.canManagePayroll(),false);assert.equal((await app.savePayroll(payroll(),0,anna.id,0)).ok,false);assert.equal(app.actions.length,0);assert.equal(app.sharedSaves.length,0);assert.equal(app.payViews.length,0);
  }
});

test('a late read for a former employee cannot overwrite the next employee private state or view',async()=>{
  const app=application(),readA=deferred();app.openEmployeeProfile(anna.id);const oldView=app.view();app.enqueue(readA.promise);const first=app.loadPayroll();assert.equal(app.last().loading,true);assert.equal(app.last().estimate,null);
  app.openEmployeeProfile(bob.id);assert.equal(oldView.destroyed,true);app.enqueue(receipt(bob.id,7,payroll(22000)));await app.loadPayroll();const bobState=plain(app.record()),bobRender=app.last();
  readA.resolve(receipt(anna.id,99,payroll(90000)));await first;assert.deepEqual(plain(app.record()),bobState);assert.equal(app.last(),bobRender);assert.equal(app.last().person.id,bob.id);assert.equal(app.last().payroll.agreements[0].amountCents,22000);assert.equal(app.last().version,7);
});

test('old-person and stale-version save callbacks are rejected before transport and successful receipts remain private',async()=>{
  const app=application();app.openEmployeeProfile(anna.id);app.enqueue(receipt());await app.loadPayroll();const oldSave=app.view().options.onSave;
  assert.equal((await oldSave(payroll(23000),1,0)).status,409);assert.equal(app.actions.length,1);
  const stateBefore=plain(app.state),prefsBefore=plain(app.accountPreferences()),snapshotBefore=plain(app.snapshot());app.enqueue(receipt(anna.id,3,payroll(23000)));const saved=await oldSave(payroll(23000),2,0);
  assert.equal(saved.ok,true);assert.equal(saved.version,3);assert.equal(app.record().version,3);assert.equal(app.last().payroll.agreements[0].amountCents,23000);assert.deepEqual(plain(app.state),stateBefore);assert.deepEqual(plain(app.accountPreferences()),prefsBefore);assert.deepEqual(plain(app.snapshot()),snapshotBefore);assert.equal(app.sharedSaves.length,0);
  await app.sharedSave();assert.equal(app.sharedSaves.length,1);assert.equal(JSON.stringify(app.sharedSaves[0]).includes('confidential-rate'),false);assert.equal(Object.keys(app.sharedSaves[0]).some(key=>/payroll/i.test(key)),false);
  app.openEmployeeProfile(bob.id);const count=app.actions.length;assert.equal((await oldSave(payroll(99999),3,0)).ok,false);assert.equal(app.actions.length,count);assert.equal(app.record().personId,bob.id);assert.equal(app.record().payroll,null);
});

test('a server409 keeps the prior confirmed record and a late save cannot repopulate a different employee',async()=>{
  const app=application();app.openEmployeeProfile(anna.id);app.enqueue(receipt());await app.loadPayroll();const before=plain(app.record());app.enqueue({ok:false,status:409,message:'En anden bruger har ændret aftalen.'});
  const conflict=await app.savePayroll(payroll(25000),2,anna.id,0);assert.equal(conflict.ok,false);assert.equal(conflict.conflict,true);assert.equal(conflict.status,409);assert.match(conflict.error,/anden bruger/);assert.deepEqual(plain(app.record()),before);assert.equal(app.last().payroll.agreements[0].amountCents,20000);
  const saving=deferred();app.enqueue(saving.promise);const pending=app.savePayroll(payroll(26000),2,anna.id,0);app.openEmployeeProfile(bob.id);saving.resolve(receipt(anna.id,3,payroll(26000)));assert.equal((await pending).ok,false);assert.equal(app.record().personId,bob.id);assert.equal(app.record().payroll,null);assert.equal(app.last().estimate,null);
});

test('a403 clears all private payroll state and its DOM before refreshing account capabilities',async()=>{
  const app=application();app.openEmployeeProfile(anna.id);app.enqueue(receipt());await app.loadPayroll();const prior=app.view();assert.match(prior.options.element.textContent,/confidential-rate/);
  app.enqueue({ok:false,status:403,message:'Adgangen er ændret.'});const result=await app.savePayroll(payroll(27000),2,anna.id,0);
  assert.equal(result.ok,false);assert.equal(app.reloads.length,1);assert.equal(app.reloads[0].record.personId,null);assert.equal(app.reloads[0].record.payroll,null);assert.equal(app.reloads[0].hasView,false);assert.equal(prior.destroyed,true);assert.equal(prior.options.element.textContent,'');assert.equal(app.record().loaded,false);assert.equal(app.canViewPayroll(),false);assert.equal(app.sharedSaves.length,0);
});

test('loading, unconfigured, malformed and failed reads never show a fabricated zero estimate',async()=>{
  const app=application(),pending=deferred();app.openEmployeeProfile(anna.id);app.enqueue(pending.promise);const read=app.loadPayroll();assert.equal(app.last().loading,true);assert.equal(app.last().estimate,null);assert.equal(app.last().canManage,false);assert.equal(app.last().payroll,null);
  pending.resolve({ok:false,status:500,message:'Prøv igen senere.'});await read;assert.equal(app.last().loading,false);assert.equal(app.last().estimate,null);assert.match(app.last().error,/Prøv igen/);assert.equal(app.last().canManage,false);
  for(const malformed of [receipt(bob.id),{ok:true,personId:anna.id,version:4},receipt(anna.id,4,null),receipt(anna.id,0,payroll()),receipt(anna.id,-1),receipt(anna.id,2,[])]){
    app.enqueue(malformed);await app.loadPayroll(true);assert.equal(app.record().loaded,false,'Only version0/null or a versioned valid configuration is an authoritative record.');assert.equal(app.last().estimate,null);assert.match(app.last().error,/bekræftes/);
  }
  app.enqueue(receipt(anna.id,0,null));await app.loadPayroll(true);assert.equal(app.record().loaded,true);assert.equal(app.last().payroll,null);assert.equal(app.last().estimate,null);assert.equal(app.last().canManage,true);
});

test('an incomplete successful save receipt cannot replace a confirmed private agreement with empty settings',async()=>{
  const app=application();app.openEmployeeProfile(anna.id);app.enqueue(receipt());await app.loadPayroll();const before=plain(app.record());
  for(const incomplete of [receipt(anna.id,3,null),{ok:true,personId:anna.id,version:3},receipt(anna.id,3,[]),receipt(bob.id,3),receipt(anna.id,4)]){
    app.enqueue(incomplete);const result=await app.savePayroll(payroll(25000),2,anna.id,0);assert.equal(result.ok,false);assert.equal(result.conflict,true);assert.deepEqual(plain(app.record()),before);assert.equal(app.last().payroll.agreements[0].amountCents,20000);
  }
});

test('payroll edits and an independently prepared roster edit preserve each other without shared compensation fields',async()=>{
  const app=application(),work=shift('work',anna.id,'2026-10-26');app.setup([anna,bob],{edits:{work}});app.openEmployeeProfile(anna.id);const before=plain(anna),draft={...before,target:32};app.enqueue(receipt());await app.loadPayroll();
  app.enqueue(receipt(anna.id,3,payroll(24000)));assert.equal((await app.savePayroll(payroll(24000),2,anna.id,0)).ok,true);assert.equal(app.state.roster[0].target,30);assert.equal(app.last().estimate.totalCents,192000);
  const saved=await app.saveEmployeeProfile(draft,before);assert.equal(saved.ok,true);assert.equal(app.state.roster[0].target,32);assert.equal(app.record().version,3);assert.equal(app.record().payroll.agreements[0].amountCents,24000);assert.equal(app.last().estimate.totalCents,192000);assert.equal(app.sharedSaves.length,1);assert.equal(JSON.stringify(app.sharedSaves[0]).includes('confidential-rate'),false);assert.deepEqual(plain(app.state.edits),{work});
  app.closeEmployeeProfile();assert.equal(app.record().personId,null);assert.equal(app.record().payroll,null);assert.equal(app.view().destroyed,true);
});

const groupedPolicy=(rate=21000)=>({schema:1,groups:[{id:'group-cleaning',name:'Rengøring',archived:false,revisions:[{id:'revision-one',from:'2026-10-01',payroll:payroll(rate)}]}],links:[{personId:anna.id,from:'2026-10-01',groupId:'group-cleaning',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[]}]});
test('group salary is resolved for estimates without copying inherited rates into personal settings or shared snapshots',async()=>{
  const app=application();app.setup([anna,bob],{edits:{work:shift('work',anna.id,'2026-10-26')}});app.openEmployeeProfile(anna.id);
  app.enqueue({...receipt(anna.id,0,null),policyVersion:4,policy:groupedPolicy()});await app.loadPayroll();
  assert.equal(app.record().payroll,null);assert.equal(app.record().policyVersion,4);assert.equal(app.last().linked,true);assert.equal(app.last().estimate.totalCents,168000);assert.equal(app.last().estimate.complete,true);
  assert.equal(JSON.stringify(app.snapshot()).includes('group-cleaning'),false);assert.equal(JSON.stringify(app.accountPreferences()).includes('group-cleaning'),false);
  const count=app.actions.length;assert.equal((await app.view().options.onSave(payroll(25000),0,3)).conflict,true);assert.equal(app.actions.length,count,'An old personal form cannot overwrite a newer group version.');
  app.enqueue({...receipt(anna.id,1,payroll(25000)),policyVersion:5,policy:{...groupedPolicy(),links:[{...groupedPolicy().links[0],baseMode:'personal'}]}});
  assert.equal((await app.view().options.onSave(payroll(25000),0,4)).ok,true);assert.equal(app.actions.at(-1).payload.policyVersion,4);assert.equal(app.actions.at(-1).payload.payroll.agreements[0].amountCents,25000);assert.equal(app.last().estimate.totalCents,200000);
});
test('individual reset is versioned independently and never silently changes a group membership',async()=>{
  const app=application();app.openEmployeeProfile(anna.id);const policy=groupedPolicy();policy.links[0].baseMode='personal';
  app.enqueue({...receipt(),policyVersion:2,policy});await app.loadPayroll();
  const link={...policy.links[0],from:'2026-10-31',baseMode:'group'};
  app.enqueue({...receipt(),policyVersion:3,policy:{...policy,links:[...policy.links,link]}});
  const saved=await app.savePayrollPersonPolicy({personId:anna.id,version:2,policyVersion:2,link});assert.equal(saved.ok,true);assert.equal(app.record().version,2);assert.equal(app.record().policyVersion,3);
  assert.deepEqual(app.actions.at(-1),{action:'payrollPersonPolicySave',payload:{personId:anna.id,version:2,policyVersion:2,link}});
  const count=app.actions.length;assert.equal((await app.savePayrollPersonPolicy({personId:anna.id,version:2,policyVersion:2,link})).conflict,true);assert.equal(app.actions.length,count);
});
test('a linked interval with no base keeps a salary estimate incomplete rather than presenting sentinel zero as complete pay',async()=>{
  const app=application();app.openEmployeeProfile(anna.id);const policy=groupedPolicy();policy.links[0].baseMode='personal';app.enqueue({...receipt(anna.id,0,null),policyVersion:1,policy});await app.loadPayroll();
  assert.equal(app.last().estimate.complete,false);assert.ok(app.last().estimate.missingBasePeriods.length);assert.equal(app.last().payroll,null);
});

const policyReceipt=(version=0,policy={schema:1,groups:[],links:[]})=>({ok:true,version,policy,people:[{personId:anna.id,name:anna.name,payroll:null,version:0},{personId:bob.id,name:bob.name,payroll:payroll(),version:2}],history:[]});
test('central pay administration uses private read/preview/save actions with captured versions and an authoritative preview token',async()=>{
  const app=application();app.access({plan:true,viewPayroll:true,managePayroll:true,managePayrollGroups:true});app.state.page='payroll';app.enqueue(policyReceipt());app.renderPayrollPolicyPage();await settled();
  assert.equal(app.policyRecord().loaded,true);assert.deepEqual(app.actions[0],{action:'payrollPolicyRead',payload:{}});assert.equal(app.policyViews[0].renders.at(-1).canManage,true);
  const policy=groupedPolicy(),preview={date:'2026-10-31',rows:[],counts:{}};app.enqueue({ok:true,preview,previewToken:'bound-to-current-policy'});
  assert.equal((await app.previewPayrollPolicy({version:0,policy,date:'2026-10-31'})).ok,true);assert.equal(app.actions.at(-1).payload.version,0);
  app.enqueue(policyReceipt(1,policy));assert.equal((await app.savePayrollPolicy({version:0,policy,date:'2026-10-31',previewToken:'bound-to-current-policy'})).ok,true);assert.equal(app.actions.at(-1).payload.previewToken,'bound-to-current-policy');assert.equal(app.policyRecord().version,1);
  const count=app.actions.length;assert.equal((await app.previewPayrollPolicy({version:0,policy,date:'2026-10-31'})).conflict,true);assert.equal(app.actions.length,count);assert.equal(app.sharedSaves.length,0);assert.equal(JSON.stringify(app.snapshot()).includes('group-cleaning'),false);
  app.clearPayrollPolicy();assert.equal(app.policyViews[0].destroyed,true);assert.deepEqual(app.policyRecord().people,[]);assert.equal(app.policyRecord().policy,null);
});
test('personal pay management does not imply group administration and leaving the page invalidates a pending read',async()=>{
  const app=application();app.state.page='payroll';app.enqueue(policyReceipt());app.renderPayrollPolicyPage();await settled();assert.equal(app.policyViews[0].renders.at(-1).canManage,false);
  assert.equal((await app.previewPayrollPolicy({version:0,policy:groupedPolicy(),date:'2026-10-31'})).ok,false);assert.equal(app.actions.length,1);
  app.clearPayrollPolicy();app.access({plan:true,viewPayroll:true,managePayroll:true,managePayrollGroups:true});const pending=deferred();app.enqueue(pending.promise);app.renderPayrollPolicyPage();app.state.page='schedule';app.clearPayrollPolicy();pending.resolve(policyReceipt(3,groupedPolicy()));await settled();assert.equal(app.policyRecord().loaded,false);assert.equal(app.policyRecord().policy,null);
});

test('opening a group member targets payroll and returning reloads the group before restoring its private page context',async()=>{
  const app=application(),policy=groupedPolicy();app.state.page='payroll';app.enqueue(policyReceipt(1,policy));app.renderPayrollPolicyPage();await settled();
  const old=app.policyViews[0];app.enqueue({...receipt(),policyVersion:1,policy});await old.options.onOpenPerson(anna.id,{groupId:'group-cleaning',date:'2026-11-15',detail:'members',memberFilter:'personal',memberSearch:'Anna',memberPage:2,memberPageSize:50});
  assert.equal(app.state.page,'people');assert.equal(app.profileId(),anna.id);assert.equal(old.destroyed,true);assert.equal(app.profiles[0].renders.at(-1).month,'2026-11');assert.equal(app.profiles[0].renders.at(-1).backLabel,'Tilbage til løngruppen');assert.equal(app.record().loaded,true);assert.equal(app.last().month,'2026-11');assert.equal(app.personGroupViews.at(-1).renders.at(-1).contextDate,'2026-11-15');
  assert.equal(JSON.stringify(app.snapshot()).includes('group-cleaning'),false);assert.equal(JSON.stringify(app.accountPreferences()).includes('memberSearch'),false);
  app.closeEmployeeProfile();assert.equal(app.state.page,'payroll');assert.equal(app.record().personId,null);assert.equal(app.policyRecord().loaded,false);
  app.enqueue(policyReceipt(2,policy));app.renderPayrollPolicyPage();await settled();const current=app.policyViews.at(-1);assert.equal(current.opened.length,1);assert.deepEqual(current.opened[0],{groupId:'group-cleaning',context:{groupId:'group-cleaning',name:'Rengøring',date:'2026-11-15',detail:'members',memberFilter:'personal',memberSearch:'Anna',memberPage:2,memberPageSize:50}});
});
test('removed groups and lost pay access cannot restore an obsolete private group page from a member profile',async()=>{
  const app=application(),policy=groupedPolicy();app.state.page='payroll';app.enqueue(policyReceipt(1,policy));app.renderPayrollPolicyPage();await settled();app.enqueue({...receipt(),policyVersion:1,policy});await app.policyViews[0].options.onOpenPerson(anna.id,{groupId:'group-cleaning',date:'2026-10-31',detail:'members'});
  app.closeEmployeeProfile();app.enqueue(policyReceipt(2));app.renderPayrollPolicyPage();await settled();assert.equal(app.policyViews.at(-1).opened.length,0);assert.ok(app.messages.some(message=>message.includes('findes ikke længere')));
  app.openEmployeeProfile(anna.id);assert.equal(app.profiles[0].renders.at(-1).backLabel,null,'An ordinary employee profile cannot inherit another entry path.');app.access({plan:true,viewPayroll:false});app.closeEmployeeProfile();assert.equal(app.state.page,'people');assert.equal(app.record().payroll,null);
});
