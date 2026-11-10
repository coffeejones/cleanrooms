const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary>0,'Use the actual application functions without production test hooks.');
const navMarker="  root.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {",navStart=source.indexOf(navMarker),navEnd=source.indexOf('\n  }));',navStart);
assert.ok(navStart>boundary&&navEnd>navStart,'Find the unchanged production sidebar navigation handler.');
const navigation=source.slice(navStart+navMarker.length,navEnd);
const plain=value=>JSON.parse(JSON.stringify(value));
const person=(id,name,target=30,site=0)=>({id,name,initials:name.split(' ').map(part=>part[0]).join(''),target,site,role:'Servicemedarbejder',active:true});
const anna=person('person-anna','Anna Hansen'),bob=person('person-bob','Bob Jensen',20,1);
const shift=(id,person,date,site=0,start='07:00',end='15:00')=>({id,person,date,site,start,end,note:''});

function application(){
  const controls=new Map(),directoryMounts=[],directoryRenders=[],profileMounts=[],profileRenders=[],opened=[],messages=[],policyMounts=[],payrollShows=[],payrollLoads=[];
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
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsRosterPlanning:require('../src/roster-planning.js'),CleanRoomsEmployeeCalendar:require('../src/employee-calendar.js'),
    CleanRoomsEmployeeProfileCalendar:require('../src/employee-profile-calendar.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsDepartments:require('../src/department-model.js'),CleanRoomsDirectoryRecords:require('../src/directory-records.js'),
    CleanRoomsPlanningRecords:require('../src/planning-records.js'),CleanRoomsPlanningReconcile:require('../src/planning-reconcile.js'),CleanRoomsPlanningScope:require('../src/planning-scope.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsRosterView:{mount:options=>{directoryMounts.push(options);const localSearch=new Element('input');localSearch.value='Bevar min lokale søgning';options.element.append(localSearch);return {render:rendered=>{directoryRenders.push(rendered);if(!options.element.querySelectorAll('.cs-roster-name-button').length)for(const person of rendered.staff){const button=new Element('button');button.className='cs-roster-name-button';button.dataset.personId=person.id;options.element.append(button);}},destroy(){}};}},
    CleanRoomsEmployeeProfileView:{mount:options=>{profileMounts.push(options);options.element.append(new Element('h2'));return {render:rendered=>profileRenders.push(rendered),showPayroll:()=>payrollShows.push(profileRenders.at(-1)?.person.id),destroy(){}};}},
    CleanRoomsPayrollGroupsView:{mount:options=>{policyMounts.push(options);return {render(){},destroy(){}};}},
    document:doc,window:{},Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    __opened:(...args)=>opened.push(args),__notify:message=>messages.push(message),__payrollLoad:id=>payrollLoads.push(id)
  });
  vm.runInContext(source.slice(0,boundary)+`
    render=()=>renderRoster();notify=message=>globalThis.__notify(message);openEditor=(...args)=>globalThis.__opened(...args);
    let saveCalls=0;save=async()=>{saveCalls++;return true;};
    globalThis.profileTest={state,renderRoster,renderEmployeeProfile,openEmployeeProfile,closeEmployeeProfile,saveEmployeeProfile,saveDepartment,applyDirectory,reconcile:reconcilePlanning,
      installDirectory:api=>{directory=api;applyDirectory({ok:true});},
      installPlanning:api=>{persistence=api;q('#cs-changes-layer').hidden=true;render=()=>{if(!needsPlanningProjection())renderRoster();};},
      planningGate:needsPlanningProjection,completePlanning:withCompletePlanning,readPlanning:readPlanningProjection,planningStatus:()=>({busy:planningReadBusy,blocked:planningReadBlocked,status:clone(cloudStatus)}),
      navigatePage:page=>{const button={dataset:{page}};${navigation}},
      payrollDestination:()=>{Object.assign(payrollPolicyState,{loaded:true,loading:false,error:'',policy:{groups:[{id:'payroll-group',name:'Cleaning'}],links:[]}});state.page='payroll';loadPayroll=async()=>globalThis.__payrollLoad(employeeProfileId);renderPayrollPolicyPage();},
      setup:(people,work={})=>{Object.assign(state,{roster:clone(people),demoSeed:false,series:[],edits:{},deleted:[],page:'people',role:'admin'},clone(work));syncRoster();},
      access:(capabilities,options={})=>{cloudCapabilities={...capabilities};cloudLoaded=options.loaded!==false;cloudStatus={state:'saved',conflict:options.conflict===true};sessionViewer={userId:'fixture',role:options.role||'planner'};},
      refresh:()=>syncRoster(),saved:()=>saveCalls,profileId:()=>employeeProfileId,month:()=>employeeProfileMonth
    };
  })();`,context,{filename:'app.js (employee profile integration)'});
  const app=context.profileTest;app.access({plan:true,manageUsers:true});
  return {...app,control,doc,directoryMounts,directoryRenders,profileMounts,profileRenders,opened,messages,policyMounts,payrollShows,payrollLoads,last:()=>profileRenders.at(-1)};
}

test('unchanged employee choices keep their option nodes and selection while staff details still refresh',()=>{
  const app=application();app.setup([anna,bob]);
  const edit=app.control('#cs-edit-person'),employee=app.control('#cs-employee-person');
  edit.value=bob.id;employee.value=anna.id;
  const editOptions=[...edit.options],employeeOptions=[...employee.options];
  for(let repeat=0;repeat<4;repeat++)app.refresh();
  assert.ok(editOptions.every((option,index)=>edit.options[index]===option));
  assert.ok(employeeOptions.every((option,index)=>employee.options[index]===option));
  assert.equal(edit.value,bob.id);assert.equal(employee.value,anna.id);
  assert.equal(edit.options[0].value,'');assert.equal(edit.options[0].textContent,'Ledig vagt');
  app.setup([anna,{...bob,site:2,target:37,role:'Teamleder'}]);app.renderRoster();
  assert.ok(editOptions.every((option,index)=>edit.options[index]===option),'Non-display staff changes must not rebuild the selectors.');
  const refreshed=app.directoryRenders.at(-1).staff.find(person=>person.id===bob.id);
  assert.equal(refreshed.site,2);assert.equal(refreshed.target,37);assert.equal(refreshed.role,'Teamleder');
  assert.equal(app.control('.cs-nav-button[data-page="people"] .cs-nav-count').textContent,'2');
});

test('employee choice caches rebuild for renames, archives, additions, removals and ordering',()=>{
  const app=application();app.setup([anna,bob]);
  const edit=app.control('#cs-edit-person'),employee=app.control('#cs-employee-person');edit.value=bob.id;employee.value=bob.id;
  let previous=edit.options[2];
  const archived={...bob,name:'Bob Andersen',active:false};app.setup([anna,archived]);
  assert.notEqual(edit.options[2],previous);assert.equal(edit.options[2].textContent,'Bob Andersen · arkiveret');
  assert.equal(edit.options[2].disabled,true);assert.equal(employee.options[1].disabled,false);
  assert.equal(edit.value,bob.id);assert.equal(employee.value,bob.id);
  assert.equal(app.control('.cs-nav-button[data-page="people"] .cs-nav-count').textContent,'1');
  const clara=person('custom-clara','Clara Øster');app.setup([clara,anna,archived]);
  assert.deepEqual(edit.options.map(option=>option.value),['',clara.id,anna.id,bob.id]);
  assert.deepEqual(employee.options.map(option=>option.value),[clara.id,anna.id,bob.id]);
  previous=edit.options[1];app.setup([anna,clara]);
  assert.notEqual(edit.options[1],previous);assert.deepEqual(edit.options.map(option=>option.value),['',anna.id,clara.id]);
  assert.deepEqual(employee.options.map(option=>option.value),[anna.id,clara.id]);
});

test('preference receipts preserve employee caches while plan receipts still invalidate them',()=>{
  const creation=source.split('\n').find(line=>line.includes('persistence = globalThis.CleanRoomsPersistence.create({'));
  assert.ok(creation,'Exercise the production persistence callbacks.');
  let callbacks,invalidations=0,changes=0,renders=0;
  const state={role:'admin',demoSession:null};
  const context=vm.createContext({
    CleanRoomsPersistence:{create:options=>{callbacks=options;return {};}},reconcilePlanning(){},resetChangedAccess(){},
    employeeReader:{invalidate:()=>invalidations++},state,clone:plain,q:()=>({hidden:true}),publicationBusy:false,
    render:()=>renders++,paintEditorPlanningConflict(){},renderChanges:()=>changes++,renderCloudStatus(){},cloudLoaded:true,renderEmployee(){}
  });
  vm.runInContext(creation,context);
  callbacks.onSaved({ok:true,preferencesOnly:true,preferences:{page:'people'}});
  assert.equal(invalidations,0);assert.equal(renders,0);assert.equal(changes,0);
  callbacks.onSaved({ok:true,publications:{version:1,slots:{}},activity:[{id:'saved-action'}],checklistProgress:{saved:true}});
  assert.equal(invalidations,1);assert.deepEqual(state.publications,{version:1,slots:{}});
  assert.deepEqual(state.activity,[{id:'saved-action'}]);assert.deepEqual(state.checklistProgress,{saved:true});
});

test('successful period reads retain preference errors or pending saves and clear an old read error otherwise',async()=>{
  const range={mode:'calendar',from:'2026-10-26',to:'2026-11-01'};
  for(const preferenceStatus of [{state:'error',message:'Visningen er ikke gemt.'},{state:'saving',message:'Gemmer ændringer…'},null]){
    const app=application();app.setup([anna,bob]);
    let result={ok:false,status:503,message:'Gammel læsefejl'};
    app.installPlanning({scope:async()=>result,get preferenceStatus(){return preferenceStatus;}});
    await app.readPlanning(range);assert.equal(app.planningStatus().status.message,'Gammel læsefejl');
    result={ok:true};assert.equal((await app.readPlanning(range)).ok,true);
    assert.deepEqual(plain(app.planningStatus()),{busy:false,blocked:'',status:preferenceStatus||{state:'saved',message:'Alle ændringer er gemt'}});
    assert.equal(app.control('.cs-main').inert,false);
  }
  const app=application();app.setup([anna]);app.access({plan:true,manageUsers:true},{conflict:true});
  app.installPlanning({scope:async()=>({ok:false,status:409,message:'Planen er ændret.'}),get preferenceStatus(){return {state:'saving',message:'Gemmer ændringer…'};}});
  await app.readPlanning(range);
  assert.equal(app.planningStatus().blocked,JSON.stringify(range));
  assert.deepEqual(plain(app.planningStatus().status),{state:'error',conflict:true,message:'Planen er ændret.'});
  assert.equal(app.control('.cs-main').inert,true);
});

test('a dedicated monthly profile uses all calendar weeks and sites without changing saved filters or directory state',()=>{
  const app=application();app.setup([anna,bob],{week:18,view:'day',site:'0',search:'en anden medarbejder',onlyOpen:true,edits:{
    leading:shift('leading',anna.id,'2026-10-27',2),
    first:shift('first',anna.id,'2026-11-02',1,'09:00','12:00'),
    last:shift('last',anna.id,'2026-11-30',2,'16:00','18:00'),
    trailing:shift('trailing',anna.id,'2026-12-01',1),
    other:shift('other',bob.id,'2026-11-03',0)
  }});
  app.renderRoster();const directory=app.directoryMounts[0].element;directory.scrollTop=260;const before=plain(app.state);
  app.directoryMounts[0].onOpenPerson(anna);assert.equal(app.profileId(),anna.id);assert.equal(app.last().person.id,anna.id);assert.equal(app.month(),'2026-10');assert.equal(directory.isConnected,false);
  app.profileMounts[0].onMonthChange('2026-11');const calendar=app.last().calendar;
  assert.equal(calendar.from,'2026-10-26');assert.equal(calendar.to,'2026-12-06');assert.equal(calendar.weeks.length,6);
  assert.deepEqual(calendar.shifts.map(item=>item.id),['first','last']);assert.equal(calendar.totalMinutes,5*60);
  assert.equal(calendar.byDate['2026-10-27'].shifts[0].id,'leading');assert.equal(calendar.byDate['2026-12-01'].shifts[0].id,'trailing');
  assert.equal(app.saved(),0);assert.deepEqual(plain(app.state),before,'Opening and browsing a profile is not a shared plan or preference write.');
  app.closeEmployeeProfile();assert.equal(app.profileId(),null);assert.equal(app.directoryMounts.length,1);assert.equal(app.directoryMounts[0].element,directory);assert.equal(directory.isConnected,true);assert.equal(directory.scrollTop,260);assert.equal(directory.children[0].value,'Bevar min lokale søgning');
  assert.equal(app.doc.activeElement.dataset.personId,anna.id);assert.equal(app.saved(),0);
});

test('the profile calendar follows actual moved/reassigned occurrences and deletions and resets month for another employee',()=>{
  const app=application(),series={id:'profile-pattern',person:anna.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:''};
  const moved={...shift(series.id+'@2026-10-27',bob.id,'2026-11-02',2,'10:00','14:00'),seriesId:series.id,note:'Flyttet fra oktober'};
  const reassigned={...shift(series.id+'@2026-11-05',bob.id,'2026-11-05',1,'09:00','12:00'),seriesId:series.id};
  app.setup([anna,{...bob,active:false}],{series:[series],edits:{[moved.id]:moved,[reassigned.id]:reassigned},deleted:[series.id+'@2026-11-03']});
  app.openEmployeeProfile(bob.id);app.profileMounts[0].onMonthChange('2026-11');
  assert.deepEqual(plain(app.last().calendar.shifts),[moved,reassigned]);assert.equal(app.last().calendar.totalMinutes,7*60);assert.equal(app.last().person.active,false,'Archived identities remain available for their history.');
  app.openEmployeeProfile(anna.id);assert.equal(app.month(),'2026-10');assert.equal(app.last().person.id,anna.id);assert.equal(app.profileMounts.length,1);
  app.profileMounts[0].onMonthChange('2026-11');assert.deepEqual(app.last().calendar.shifts.map(item=>item.id),[series.id+'@2026-11-10',series.id+'@2026-11-12']);
  const before=plain(app.state),last=app.last();app.profileMounts[0].onMonthChange('2026-13');assert.equal(app.last(),last);assert.deepEqual(plain(app.state),before);assert.equal(app.saved(),0);
});

test('opening a calendar event re-resolves its current assignment and checks plan capability before editing',()=>{
  const app=application(),original=shift('changing-shift',anna.id,'2026-11-02',2);app.setup([anna,bob],{edits:{[original.id]:original}});app.openEmployeeProfile(anna.id);
  const callback=app.profileMounts[0].onOpenShift,trigger={dataset:{shift:original.id}};
  app.state.edits[original.id]={...original,person:bob.id};callback(original,trigger);assert.equal(app.opened.length,0);assert.match(app.messages.at(-1),/Vagten er ændret/);
  const moved={...original,date:'2026-11-06',start:'10:00',end:'13:00'};app.state.edits[original.id]=moved;
  app.access({plan:true,manageUsers:false});callback(original,trigger);assert.equal(app.opened.length,1);assert.deepEqual(plain(app.opened[0][0]),moved);assert.equal(app.opened[0][1],trigger);
  app.access({plan:true,manageUsers:true},{conflict:true});callback(original,trigger);assert.equal(app.opened.length,1);
  app.access({plan:false,manageUsers:true});callback(original,trigger);assert.equal(app.opened.length,1);assert.equal(app.saved(),0);
});

test('profile saves retain stable identities and other work and reject stale, mismatched or unauthorized drafts',async()=>{
  const app=application(),work=shift('untouched-work',bob.id,'2026-11-03');app.setup([anna,bob],{edits:{[work.id]:work}});app.openEmployeeProfile(anna.id);
  const before=plain(anna),draft={...before,name:'Anna Opdateret',target:32};
  app.access({plan:true,manageUsers:false},{role:'admin'});app.renderEmployeeProfile();assert.equal(app.last().canEdit,false);assert.equal((await app.saveEmployeeProfile(draft,before)).ok,false);
  app.access({plan:true,manageUsers:true});app.renderEmployeeProfile();assert.equal(app.last().canEdit,true);assert.equal((await app.saveEmployeeProfile({...draft,id:bob.id},before)).ok,false);
  app.state.roster[0]={...anna,target:31};app.refresh();const stale=await app.saveEmployeeProfile(draft,before);assert.equal(stale.ok,false);assert.match(stale.error,/ændret siden/);assert.equal(app.saved(),0);
  const current=plain(app.state.roster[0]);const result=await app.saveEmployeeProfile({...current,name:draft.name,target:32},current);assert.equal(result.ok,true);assert.equal(app.saved(),1);
  assert.deepEqual(plain(app.state.roster),[{...anna,name:draft.name,target:32},bob]);assert.deepEqual(plain(app.state.edits),{[work.id]:work});assert.equal(app.profileId(),anna.id);assert.equal(app.last().person.name,draft.name);assert.equal(app.last().planning.byPerson[anna.id].targetMinutes,32*60);
});

const settle=async()=>{for(let index=0;index<16;index++)await Promise.resolve();};
function connectedDirectory(app){
 const Model=require('../src/directory-records.js'),Directory=require('../src/directory-persistence.js'),reads=[],writes=[];
 const service=Directory.create({transport:{directoryRead:payload=>new Promise(resolve=>reads.push({payload:plain(payload),resolve})),directoryWrite:payload=>new Promise(resolve=>writes.push({payload:plain(payload),resolve}))},onReconciled:app.applyDirectory});
 const rows=Model.flatten({roster:[anna,bob],organization:require('../src/department-model.js').defaultOrganization()}).map(row=>({...row,version:1})),directory={schema:1,revision:1,nextSiteIndex:3};service.reconcile({directory:{...directory,complete:true},records:rows,workspace:{id:'profile-workspace'}});app.installDirectory(service);
 return {service,reads,writes,rows,reply:async(call,records,revision=1)=>{call.resolve({ok:true,directory:{...directory,revision},records:plain(records),workspace:{id:'profile-workspace'}});await settle();}};
}

test('real app profile navigation waits for a point read and ignores a slower previously selected employee',async()=>{
 const app=application();app.setup([anna,bob]);const connection=connectedDirectory(app),first=app.openEmployeeProfile(anna.id);await settle();assert.deepEqual(connection.reads[0].payload,{kind:'employee',ids:[anna.id]});assert.equal(app.profileId(),null);assert.equal(app.profileMounts.length,0);
 const second=app.openEmployeeProfile(bob.id);await settle();await connection.reply(connection.reads[1],[{...connection.rows[1],value:{...bob,profileNote:'Only this selected profile'}}]);assert.equal(await second,true);assert.equal(app.profileId(),bob.id);assert.equal(app.last().person.profileNote,'Only this selected profile');
 await connection.reply(connection.reads[0],[{...connection.rows[0],value:{...anna,profileNote:'Slower previous selection'}}]);assert.equal(await first,false);assert.equal(app.profileId(),bob.id);assert.equal(app.last().person.id,bob.id);assert.equal(app.saved(),0);assert.equal(connection.writes.length,0);
});

test('the real app saves one profile as an entity patch with the form version while preserving full details and other planning',async()=>{
 const app=application(),work=shift('kept-work',bob.id,'2026-11-03');app.setup([anna,bob],{edits:{[work.id]:work}});const connection=connectedDirectory(app),opening=app.openEmployeeProfile(anna.id);await settle();await connection.reply(connection.reads[0],[{...connection.rows[0],value:{...anna,profileNote:'Keep this hidden server profile field'}}]);await opening;const before=plain(app.last().person),saving=app.saveEmployeeProfile({...before,name:'Anna Opdateret',target:32},before);await settle();
 assert.equal(connection.writes.length,1);assert.deepEqual(connection.writes[0].payload,{changes:[{kind:'employee',id:anna.id,expectedVersion:1,patch:{name:'Anna Opdateret',target:32}}]});assert.equal(app.saved(),0);await connection.reply(connection.writes[0],[{...connection.rows[0],version:2,value:{...anna,name:'Anna Opdateret',target:32,profileNote:'Keep this hidden server profile field'}}],2);const result=await saving;assert.equal(result.ok,true);assert.equal(app.last().person.name,'Anna Opdateret');assert.equal(app.last().person.profileNote,'Keep this hidden server profile field');assert.equal(app.last().person._directoryVersion,2);assert.deepEqual(plain(app.state.edits),{[work.id]:work});assert.equal(app.saved(),0,'Employee mutation must not call the shared planning save');
});

test('a profile closed before its lookup finishes stays closed and a newly observed entity version blocks an old form',async()=>{
 const app=application();app.setup([anna,bob]);const connection=connectedDirectory(app),opening=app.openEmployeeProfile(anna.id);await settle();app.closeEmployeeProfile();await connection.reply(connection.reads[0],[connection.rows[0]]);assert.equal(await opening,false);assert.equal(app.profileId(),null);
 const again=app.openEmployeeProfile(anna.id);await settle();await connection.reply(connection.reads[1],[connection.rows[0]]);await again;const before=plain(app.last().person);connection.service.reconcile({directory:{schema:1,revision:2,nextSiteIndex:3},records:[{...connection.rows[0],version:2,value:{...anna,target:31}}]});const rejected=await app.saveEmployeeProfile({...before,name:'Stale form'},before);assert.equal(rejected.ok,false);assert.match(rejected.error,/ændret siden/);assert.equal(connection.writes.length,0);assert.equal(app.state.roster[0].target,31);
});

test('the real app preserves an opened department form version in its independent patch',async()=>{
 const app=application();app.setup([anna,bob]);app.access({plan:true,manageUsers:true,manageDepartments:true});const connection=connectedDirectory(app),original=connection.rows.find(row=>row.kind==='department');connection.service.reconcile({directory:{schema:1,revision:2,nextSiteIndex:3},records:[{...original,version:2,value:{...original.value,name:'Peer name'}}]});const saving=app.saveDepartment({id:original.id,expectedVersion:1,name:'Our old form',kind:original.value.kind,siteIds:original.value.siteIds});await settle();assert.equal(connection.writes.length,1);assert.equal(connection.writes[0].payload.changes[0].expectedVersion,1);assert.equal(connection.writes[0].payload.changes[0].kind,'department');connection.writes[0].resolve({ok:false,status:409,message:'Changed while open'});assert.equal((await saving).ok,false);assert.equal(app.state.organization.departments.find(row=>row.id===original.id).name,'Peer name');assert.equal(app.saved(),0);
});

test('people overview and profile month changes load calendar windows rather than the full company plan',async()=>{
 const app=application();app.setup([anna,bob]);const connection=connectedDirectory(app),reads=[];let projection={mode:'calendar',from:'2026-10-26',to:'2026-11-01'},valid=true;const Scope=require('../src/planning-scope.js'),client={get isPartial(){return true;},get coverageValid(){return valid;},get directoryRevision(){return 1;},invalidateCoverage(){valid=false;},covers:range=>valid&&range.from>=projection.from&&range.to<=projection.to,coversScope:range=>valid&&JSON.stringify(Scope.normalize(range))===JSON.stringify(projection),scope:range=>new Promise(resolve=>reads.push({projection:plain(range),resolve})),window:range=>client.scope(range),ensureFull:()=>{assert.fail('The employee page must not request the full company plan');},action:async()=>({ok:true})};app.installPlanning(client);
 const reply=async index=>{projection=reads[index].projection;valid=true;const studio=plain(app.state);app.reconcile(studio,{submitted:studio,acknowledged:studio,scopeReplacement:true,scopeExpansion:true,projection});reads[index].resolve({ok:true,studio});await settle();};
 assert.equal(app.planningGate(),true);assert.deepEqual(reads[0].projection,{mode:'calendar',from:'2026-10-26',to:'2026-11-29'});await reply(0);const opening=app.openEmployeeProfile(anna.id);await settle();await connection.reply(connection.reads[0],[connection.rows[0]]);await opening;assert.equal(reads.length,2);await reply(1);app.profileMounts[0].onMonthChange('2026-11');assert.equal(reads.length,3);assert.deepEqual(reads[2].projection,{mode:'calendar',from:'2026-10-26',to:'2026-12-06'});await reply(2);assert.equal(app.last().month,'2026-11');assert.equal(reads.every(item=>(Date.parse(item.projection.to)-Date.parse(item.projection.from))/86400000<42),true);assert.equal(app.saved(),0);
});

test('account, payroll and settings navigation retain bounded planning while history and explicit recovery still load the full plan',async()=>{
 for(const page of ['accounts','payroll','workspace','activity']){
  const app=application();app.setup([anna,bob],{page});const reads=[];
  const client={isPartial:true,coverageValid:true,window:()=>assert.fail('Administrative navigation must not fetch a calendar period'),ensureFull:()=>new Promise(resolve=>reads.push(resolve)),action:async()=>({ok:true})};
  app.installPlanning(client);
  assert.equal(app.planningGate(),page==='activity',page);
  assert.equal(reads.length,page==='activity'?1:0,page);
  if(page==='activity'){client.isPartial=false;reads[0]({ok:true});await settle();assert.equal(app.planningStatus().blocked,'');}
 }
 const app=application();app.setup([anna,bob],{page:'workspace'});const reads=[];
 const client={isPartial:true,coverageValid:true,window:()=>assert.fail('Recovery requires a complete plan'),ensureFull:()=>new Promise(resolve=>reads.push(resolve)),action:async()=>({ok:true})};
 app.installPlanning(client);let recovered=false;
 const recovery=app.completePlanning(()=>{recovered=true;return 'restored';});await settle();
 assert.equal(reads.length,1);assert.equal(recovered,false,'An explicit full operation cannot run using only the visible calendar');
 client.isPartial=false;reads[0]({ok:true});assert.equal(await recovery,'restored');assert.equal(recovered,true);
});

test('sidebar navigation cancels an in-flight profile lookup instead of reopening the previous page after it finishes',async()=>{
 const app=application();app.setup([anna,bob]);const connection=connectedDirectory(app),opening=app.openEmployeeProfile(anna.id);await settle();app.navigatePage('hours');assert.equal(app.state.page,'hours');await connection.reply(connection.reads[0],[connection.rows[0]]);assert.equal(await opening,false);assert.equal(app.profileId(),null);assert.equal(app.state.page,'hours');
});

test('opening payroll from a group waits for the actual employee lookup before selecting the pay tab or loading pay',async()=>{
 for(const allowed of [true,false]){const app=application();app.setup([anna,bob]);app.access({plan:true,manageUsers:true,viewPayroll:true});const connection=connectedDirectory(app);app.payrollDestination();const opening=app.policyMounts[0].onOpenPerson(anna.id,{groupId:'payroll-group',date:'2026-11-15',detail:'members'});await settle();assert.deepEqual(connection.reads[0].payload,{kind:'employee',ids:[anna.id]});assert.equal(app.profileId(),null);assert.deepEqual(app.payrollShows,[]);assert.deepEqual(app.payrollLoads,[],'A pending profile must not launch payroll for a null or previously selected employee');
  if(allowed)await connection.reply(connection.reads[0],[connection.rows[0]]);else{connection.reads[0].resolve({ok:false,status:403,message:'Profile access revoked'});await settle();}await opening;
  assert.deepEqual(app.payrollShows,allowed?[anna.id]:[]);assert.deepEqual(app.payrollLoads,allowed?[anna.id]:[]);assert.equal(app.profileId(),allowed?anna.id:null);if(allowed)assert.equal(app.month(),'2026-11');
 }
});

test('a payroll destination waits for the employee month scope and does not reopen payroll after navigation during that read',async()=>{
 for(const navigateAway of [false,true]){
  const app=application();app.setup([anna,bob]);app.access({plan:true,manageUsers:true,viewPayroll:true});const connection=connectedDirectory(app),reads=[];let projection=null;
  const client={get isPartial(){return projection!==null;},get coverageValid(){return true;},get directoryRevision(){return 1;},covers:range=>projection&&range.from>=projection.from&&range.to<=projection.to,coversScope:range=>projection&&JSON.stringify(range)===JSON.stringify(projection),scope:range=>new Promise(resolve=>reads.push({projection:plain(range),resolve})),window:range=>client.scope(range),ensureFull:()=>{assert.fail('Opening an employee pay destination must use the employee month scope');},action:async()=>({ok:true})};
  app.installPlanning(client);app.payrollDestination();const opening=app.policyMounts[0].onOpenPerson(anna.id,{groupId:'payroll-group',date:'2026-11-15',detail:'members'});await settle();await connection.reply(connection.reads[0],[connection.rows[0]]);
  assert.equal(reads.length,1);assert.deepEqual(reads[0].projection,{mode:'calendar',from:'2026-10-26',to:'2026-12-06'});assert.equal(app.profileId(),anna.id);assert.equal(app.planningStatus().busy,true);assert.deepEqual(app.payrollShows,[]);assert.deepEqual(app.payrollLoads,[],'Point details alone must not start payroll before the profile has its month context');
  if(navigateAway){app.navigatePage('schedule');assert.equal(app.state.page,'schedule');assert.equal(app.profileId(),null);}
  projection=reads[0].projection;reads[0].resolve({ok:true,studio:plain(app.state)});await opening;await settle();
  assert.deepEqual(app.payrollShows,navigateAway?[]:[anna.id]);assert.deepEqual(app.payrollLoads,navigateAway?[]:[anna.id]);assert.equal(app.state.page,navigateAway?'schedule':'people');if(!navigateAway)assert.equal(app.last().person.id,anna.id);
 }
});
