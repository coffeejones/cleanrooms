const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Publication=require('../src/publication-model.js');
const Departments=require('../src/department-model.js');
const Description=require('../src/description-model.js');
const Checklist=require('../src/checklist-progress.js');
const owner={id:'owner',email:'owner@example.com'},employee={id:'employee',email:'employee@example.com'};
const person={id:'person-alex-123',name:'Alex Rengøring',initials:'AR',target:30,site:0,role:'Rengøringsassistent',active:true};
const week={from:'2026-10-26',to:'2026-11-01',siteIds:[0]};
const template=text=>Description.encode({type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}]}]});
const shift=(changes={})=>({id:'own-shift',person:person.id,site:0,date:'2026-10-27',start:'07:00',end:'15:00',note:'Udgivet instruktion',noteRich:template('Lås døren'),...changes});
const studio=(changes={})=>({storageVersion:1,demoSeed:false,roster:[person],organization:Departments.defaultOrganization(),series:[],edits:{'own-shift':shift()},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{},...changes});
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  const directory=path.join(__dirname,'../drizzle');for(const file of fs.readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(directory,file),'utf8'));
  const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
const request=(url,method,body,principal=owner)=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':encodeURIComponent(principal.id==='owner'?'Ægte Planlægger':'Alex'),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8',...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const plan=(db,method='GET',body,principal=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal),db);
const account=(db,action,payload={},principal=owner)=>Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal),db);
const json=async response=>({status:response.status,body:await response.json()});
const state=async db=>Store.readStudio(db,owner.id);
async function put(db,value,revision,publication,directoryRevision){return json(await plan(db,'PUT',{revision,studio:value,...(publication?{publication}:{}),...(directoryRevision===undefined?{}:{directoryRevision})}));}
async function setup(value=studio()){
  const db=database();await Store.writeStudio(db,owner.id,0,value);assert.equal((await plan(db)).status,200);
  const invitation=await json(await account(db,'invite',{email:employee.email,roleId:'employee',personId:person.id}));assert.equal(invitation.status,200,JSON.stringify(invitation.body));
  const token=new URL(invitation.body.inviteUrl).searchParams.get('token');assert.equal((await account(db,'acceptInvite',{token},employee)).status,200);return db;
}
async function employeeView(db){const initial=await json(await plan(db,'GET',undefined,employee));assert.equal(initial.status,200,JSON.stringify(initial.body));assert.equal(initial.body.studio,null);const result=await json(await account(db,'employeeRead',{from:'2026-10-26',to:'2026-11-22'},employee));assert.equal(result.status,200,JSON.stringify(result.body));const shifts=[],progress={};for(const summary of result.body.shifts){const detail=await json(await account(db,'employeeShift',{shiftId:summary.id},employee));assert.equal(detail.status,200,JSON.stringify(detail.body));const {location,...shift}=detail.body.shift;shifts.push(shift);Object.assign(progress,detail.body.progress);}return {...result.body,shifts,progress};}

test('employees see no legacy drafts and explicit publication stamps only server actor and time',async()=>{
  const draft=studio({weekPlans:{0:{published:true,baselineKind:'published',baseline:[shift()]}}}),db=await setup(draft);
  assert.deepEqual((await employeeView(db)).shifts,[]);
  const saved=await put(db,draft,1);assert.equal(saved.status,200);assert.deepEqual((await employeeView(db)).shifts,[]);
  const published=await put(db,draft,2,{...week,actor:{userId:'forged',name:'FORGED ACTOR'},at:'1900-01-01T00:00:00.000Z'});
  assert.equal(published.status,200,JSON.stringify(published.body));assert.equal(published.body.revision,3);
  const record=published.body.publications.records[0];assert.equal(record.actor.userId,owner.id);assert.equal(record.actor.name,'Ægte Planlægger');assert.notEqual(record.at,'1900-01-01T00:00:00.000Z');
  assert.equal(published.body.activity.at(-1).kind,'publication');assert.equal(published.body.activity.at(-1).actor.userId,owner.id);
  assert.deepEqual((await employeeView(db)).shifts,[shift()]);db.sqlite.close();
});

test('draft instruction and assignment changes stay private, checklist uses published template and draft saves preserve completion',async()=>{
  const db=await setup();let current=await state(db);assert.equal((await put(db,current.studio,current.revision,week)).status,200);
  const view=(await employeeView(db)).shifts[0],catalog=Checklist.read({},view);
  current=await state(db);current.studio.edits['own-shift']={...shift(),note:'PRIVATE DRAFT INSTRUCTIONS',noteRich:template('Ny opgave')};assert.equal((await put(db,current.studio,current.revision)).status,200);
  assert.equal((await employeeView(db)).shifts[0].note,view.note);
  const checked=await json(await account(db,'checklist',{shiftId:view.id,key:catalog.tasks[0].key,signature:catalog.signature,checked:true},employee));assert.equal(checked.status,200,JSON.stringify(checked.body));
  current=await state(db);current.studio.checklistProgress={};current.studio.activity=[];current.studio.publications=Publication.empty();
  assert.equal((await put(db,current.studio,current.revision)).status,200);
  const stillPublished=await employeeView(db);assert.equal(Checklist.read(stillPublished.progress,stillPublished.shifts[0]).checked,1);assert.equal(stillPublished.shifts[0].note,view.note);
  current=await state(db);assert.equal((await put(db,current.studio,current.revision,week)).status,200);
  const next=await employeeView(db);assert.equal(next.shifts[0].note,'PRIVATE DRAFT INSTRUCTIONS');assert.equal(Checklist.read(next.progress,next.shifts[0]).checked,0);
  assert.equal((await account(db,'checklist',{shiftId:view.id,key:catalog.tasks[0].key,signature:catalog.signature,checked:true},employee)).status,409);
  db.sqlite.close();
});

test('cross-week/site move requires explicit dependency consent and deletion stays unpublished until requested',async()=>{
  const db=await setup();let current=await state(db);await put(db,current.studio,current.revision,week);
  current=await state(db);current.studio.edits['own-shift']={...shift(),date:'2026-11-03',site:1};await put(db,current.studio,current.revision);
  assert.equal((await employeeView(db)).shifts[0].date,'2026-10-27');
  const target={from:'2026-11-02',to:'2026-11-08',siteIds:[1]};current=await state(db);
  const rejected=await put(db,current.studio,current.revision,target);assert.equal(rejected.status,400);assert.deepEqual(rejected.body.dependencies,[week]);assert.equal((await state(db)).revision,current.revision);
  assert.equal((await put(db,current.studio,current.revision,{...target,includeDependencies:true})).status,200);
  assert.deepEqual((await employeeView(db)).shifts,[current.studio.edits['own-shift']]);
  current=await state(db);current.studio.deleted=['own-shift'];await put(db,current.studio,current.revision);assert.equal((await employeeView(db)).shifts.length,1);
  current=await state(db);await put(db,current.studio,current.revision,target);assert.equal((await employeeView(db)).shifts.length,0);
  db.sqlite.close();
});

test('server-owned publication and audit cannot be forged or erased by full snapshots',async()=>{
  const db=await setup();let current=await state(db);await put(db,current.studio,current.revision,week);current=await state(db);
  const original=structuredClone(current.studio),forged=structuredClone(original);forged.publications.slots['2026-10-26|0'].shifts[0].note='FORGED PUBLICATION';forged.publications.records[0].actor={userId:'fake',name:'Fake'};forged.activity=[];
  const saved=await put(db,forged,current.revision);assert.equal(saved.status,200);
  const result=await state(db);assert.deepEqual(result.studio.publications,original.publications);assert.deepEqual(result.studio.activity,original.activity);
  const noPlan=await json(await plan(db,'PUT',{revision:result.revision,studio:result.studio,publication:week},employee));assert.equal(noPlan.status,403);assert.equal(noPlan.body.studio,undefined);
  const personal=await employeeView(db);assert.equal(JSON.stringify(personal).includes('FORGED PUBLICATION'),false);assert.equal(personal.activity,undefined);
  db.sqlite.close();
});

test('saved plan changes generate durable guarded recovery and large notes keep metadata without a text cap',async()=>{
  const db=await setup();let current=await state(db);current.studio.edits['own-shift'].start='08:00';
  const saved=await put(db,current.studio,current.revision);assert.equal(saved.status,200);
  const entry=saved.body.activity.at(-1);assert.equal(entry.kind,'plan');assert.equal(entry.recoverable,true);assert.equal(entry.changes[0].field,'edits');assert.equal(entry.changes[0].id,'own-shift');assert.equal(entry.actor.userId,owner.id);
  current=await state(db);const restored=Publication.restoreActivity(current.studio,entry);assert.equal(restored.ok,true);assert.equal(restored.studio.edits['own-shift'].start,'07:00');assert.equal((await put(db,restored.studio,current.revision)).status,200);
  current=await state(db);assert.equal(current.studio.activity.length,2);assert.equal(current.studio.activity.at(-1).revision,current.revision);
  const note='Lang instruktion\n'.repeat(20000);current.studio.edits['own-shift'].note=note;
  const large=await put(db,current.studio,current.revision);assert.equal(large.status,200);assert.equal(large.body.activity.at(-1).recoverable,false);assert.equal((await state(db)).studio.edits['own-shift'].note,note);
  assert.equal((await employeeView(db)).shifts.length,0);db.sqlite.close();
});

test('publication CAS checks role access at commit and leaves snapshots and audit unchanged on revocation',async()=>{
  const db=await setup(),role=await json(await account(db,'createRole',{name:'Planlægning',permissions:['plan']})),planner={id:'planner',email:'planner@example.com'};
  const invited=await json(await account(db,'invite',{email:planner.email,roleId:role.body.role.id}));await account(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},planner);
  const before=await state(db);let intercepted=false;
  db.beforeBatch=statements=>{if(!statements.some(item=>/UPDATE\s+studio_states\s+SET/i.test(item.sql)))return;db.beforeBatch=null;intercepted=true;db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run('[]',role.body.role.id);};
  const result=await plan(db,'PUT',{revision:before.revision,studio:before.studio,publication:week},planner);assert.equal(result.status,403);assert.equal(intercepted,true);assert.deepEqual(await state(db),before);db.sqlite.close();
});

test('roster and settings changes require users.manage and accept dynamic person identities only from the actual roster',async()=>{
  const db=await setup(),planner={id:'limited',email:'limited@example.com'},inviteResult=await json(await account(db,'invite',{email:planner.email,role:'planner'}));await account(db,'acceptInvite',{token:new URL(inviteResult.body.inviteUrl).searchParams.get('token')},planner);
  let current=await state(db);const changed=structuredClone(current.studio);changed.roster[0].name='Changed';assert.equal((await plan(db,'PUT',{revision:current.revision,studio:changed},planner)).status,403);
  const settings={...current.studio,workspaceSettings:{companyName:'CleanRooms'}};assert.equal((await plan(db,'PUT',{revision:current.revision,studio:settings},planner)).status,403);
  assert.equal((await plan(db,'PUT',{revision:current.revision,studio:{...current.studio,demoSeed:true}},planner)).status,403);
  assert.equal((await put(db,settings,current.revision)).status,200);current=await state(db);
  const invalid={...current.studio,workspaceSettings:{companyName:'X',invented:'not supported'}};assert.equal((await put(db,invalid,current.revision)).status,400);
  assert.equal((await account(db,'invite',{email:'missing@example.com',roleId:'employee',personId:'person-not-in-roster'})).status,400);
  assert.equal((await account(db,'preferences',{preferences:{page:'activity'}},employee)).status,200);
  db.sqlite.close();
});

test('legacy planners may save effective defaults without gaining permission to alter settings or demo seeding',async()=>{
  const db=database(),legacy=studio({edits:{}});delete legacy.roster;delete legacy.demoSeed;
  await Store.writeStudio(db,owner.id,0,legacy);await plan(db);
  const planner={id:'legacy-planner',email:'legacy-planner@example.com'},invited=await json(await account(db,'invite',{email:planner.email,role:'planner'}));
  await account(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},planner);
  const Data=require('../src/studio-data.js'),effective={...legacy,roster:Data.staffFor(legacy),workspaceSettings:{},demoSeed:true};
  const observed=await state(db);assert.deepEqual(observed.studio.organization,effective.organization);
  const saved=await json(await plan(db,'PUT',{revision:1,directoryRevision:observed.directory.revision,studio:effective},planner));assert.equal(saved.status,200,JSON.stringify(saved.body));assert.deepEqual(saved.body.activity,[]);
  const current=await state(db);assert.equal((await plan(db,'PUT',{revision:current.revision,studio:{...current.studio,demoSeed:false}},planner)).status,403);
  db.sqlite.close();
});

test('a partial-site publication cannot overlap another site already visible to the employee',async()=>{
  const db=await setup();let current=await state(db);await put(db,current.studio,current.revision,week);
  current=await state(db);current.studio.edits['own-shift']={...shift(),start:'15:00',end:'16:00'};current.studio.edits.second=shift({id:'second',site:1,start:'08:00',end:'09:00'});
  await put(db,current.studio,current.revision);current=await state(db);
  const denied=await put(db,current.studio,current.revision,{...week,siteIds:[1]});assert.equal(denied.status,400);assert.equal(denied.body.error,'publication_conflict');assert.equal((await state(db)).revision,current.revision);
  assert.equal((await employeeView(db)).shifts.length,1);
  assert.equal((await put(db,current.studio,current.revision,{...week,siteIds:[0,1]})).status,200);assert.equal((await employeeView(db)).shifts.length,2);
  db.sqlite.close();
});

test('bound person identities cannot be deleted and a concurrent binding fences the roster CAS',async()=>{
  const db=await setup(),before=await state(db),removed={...before.studio,roster:[]};
  assert.equal((await put(db,removed,before.revision,undefined,before.directory.revision)).status,400);
  const archived={...before.studio,roster:[{...person,active:false}]};assert.equal((await put(db,archived,before.revision,undefined,before.directory.revision)).status,200);
  const second=database(),initial=studio();await Store.writeStudio(second,owner.id,0,initial);await plan(second);
  const invited=await json(await account(second,'invite',{email:'racing@example.com',roleId:'employee',personId:person.id}));
  const context=(await json(await plan(second))).body,stamp=new Date().toISOString();let intercepted=false;
  second.beforeBatch=statements=>{
    if(!statements.some(item=>/UPDATE\s+studio_states\s+SET/i.test(item.sql)))return;
    second.beforeBatch=null;intercepted=true;
    second.sqlite.prepare("INSERT INTO workspace_members (user_id,workspace_id,email,name,role,role_id,manage_departments,person_id,status,version,preferences,created_at,updated_at) VALUES (?,?,?,?,?,'employee',0,?,'active',1,'{}',?,?)").run('racing-member',context.workspace.id,'racing@example.com','Racing','employee',person.id,stamp,stamp);
  };
  const result=await put(second,{...initial,roster:[]},1,undefined,context.directory.revision);assert.equal(result.status,409);assert.equal(intercepted,true);assert.deepEqual((await state(second)).studio,initial);
  assert.ok(invited.body.invite);db.sqlite.close();second.sqlite.close();
});

test('audit retention is bounded while preserving complete recoverable recent changes',async()=>{
  const db=await setup();
  for(let index=0;index<16;index++){
    const current=await state(db);current.studio.edits['own-shift'].note=String(index)+'x'.repeat(28000);
    assert.equal((await put(db,current.studio,current.revision)).status,200);
  }
  const current=await state(db);assert.ok(current.studio.activity.length<16);assert.ok(new TextEncoder().encode(JSON.stringify(current.studio.activity)).byteLength<=512*1024);
  const entry=current.studio.activity.at(-1);assert.equal(entry.recoverable,true);assert.equal(Publication.restoreActivity(current.studio,entry).ok,true);db.sqlite.close();
});

test('a losing revision creates no publication or audit and initial settings edits can recover to effective empty settings',async()=>{
  const db=await setup(),before=await state(db),next={...before.studio,workspaceSettings:{companyName:'Ny virksomhed'}};
  const saved=await put(db,next,before.revision);assert.equal(saved.status,200);const entry=saved.body.activity.at(-1);
  const stale=await put(db,{...next,workspaceSettings:{companyName:'MUST NOT COMMIT'}},before.revision,week);assert.equal(stale.status,409);
  let current=await state(db);assert.equal(current.studio.activity.length,1);assert.equal(current.studio.publications.sequence,0);
  const recovery=Publication.restoreActivity(current.studio,entry);assert.equal(recovery.ok,true);assert.deepEqual(recovery.studio.workspaceSettings,{});
  assert.equal((await put(db,recovery.studio,current.revision)).status,200);current=await state(db);assert.deepEqual(current.studio.workspaceSettings,{});assert.equal(current.studio.activity.length,2);
  db.sqlite.close();
});

test('server derives future-split scope links and publishing a new site replaces old IDs without duplicate shifts',async()=>{
  const source={id:'original',person:person.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:''};
  const db=await setup(studio({series:[source],edits:{}})),scope={from:'2026-11-02',to:'2026-11-08',siteIds:[0]};
  let current=await state(db);await put(db,current.studio,current.revision,scope);
  current=await state(db);current.studio.series=[{...source,endDate:'2026-11-02'},{...source,id:'future',startDate:'2026-11-03',site:1}];
  const draft=await put(db,current.studio,current.revision);assert.equal(draft.status,200);assert.ok(draft.body.publications.scopeLinks.length);
  current=await state(db);assert.equal((await put(db,current.studio,current.revision,{...scope,siteIds:[1]})).status,400);
  assert.equal((await put(db,current.studio,current.revision,{...scope,siteIds:[1],includeDependencies:true})).status,200);
  const shifts=(await employeeView(db)).shifts;assert.equal(shifts.length,2);assert.ok(shifts.every(shift=>shift.seriesId==='future'&&shift.site===1));db.sqlite.close();
});

test('weekday-specific times survive shared storage and audit recovery while employees retain the explicitly published schedule',async()=>{
  const source={id:'variable-hours',groupId:'agreement-alex',person:person.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',dayTimes:{3:{start:'09:00',end:'17:00'}},note:'Ugentlig aftale'};
  const db=await setup(studio({series:[source],edits:{}})),scope={from:'2026-11-02',to:'2026-11-08',siteIds:[0]};
  assert.deepEqual((await employeeView(db)).shifts,[]);
  let current=await state(db);assert.equal((await put(db,current.studio,current.revision,scope)).status,200);
  const times=async()=>((await employeeView(db)).shifts.map(shift=>[shift.date,shift.start,shift.end]));
  assert.deepEqual(await times(),[['2026-11-03','07:00','15:00'],['2026-11-05','09:00','17:00']]);
  current=await state(db);current.studio.series[0].dayTimes[3]={start:'11:00',end:'19:00'};
  const saved=await put(db,current.studio,current.revision);assert.equal(saved.status,200,JSON.stringify(saved.body));
  const durable=await state(db);assert.equal(durable.studio.series[0].groupId,source.groupId);assert.deepEqual(durable.studio.series[0].dayTimes,{3:{start:'11:00',end:'19:00'}});
  const change=Publication.scopeStatus(durable.studio,scope);assert.equal(change.changed,1);assert.equal(change.changes[0].after.date,'2026-11-05');assert.ok(change.changes[0].fields.includes('start'));
  assert.deepEqual(await times(),[['2026-11-03','07:00','15:00'],['2026-11-05','09:00','17:00']],'A saved weekday override is still a draft until publication.');
  const audit=durable.studio.activity.at(-1),definition=audit.changes.find(item=>item.field==='series'&&item.id===source.id);
  assert.equal(audit.actor.userId,owner.id);assert.deepEqual(definition.before.dayTimes,source.dayTimes);assert.deepEqual(definition.after.dayTimes,durable.studio.series[0].dayTimes);
  const restored=Publication.restoreActivity(durable.studio,audit);assert.equal(restored.ok,true);assert.deepEqual(restored.studio.series[0],source,'Recovery retains the logical agreement and exact previous weekday overrides.');
  assert.equal((await put(db,durable.studio,durable.revision,scope)).status,200);
  assert.deepEqual(await times(),[['2026-11-03','07:00','15:00'],['2026-11-05','11:00','19:00']]);db.sqlite.close();
});

test('shared writes reject malformed or stripped recurrence metadata without weakening employee authorization or CAS',async()=>{
  const source={id:'protected-series',groupId:'agreement-alex',person:person.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',dayTimes:{3:{start:'09:00',end:'17:00'}},note:''};
  const db=await setup(studio({series:[source],edits:{}})),before=await state(db);
  const forged={...before.studio,role:'admin',capabilities:{plan:true},series:[{...source,dayTimes:{2:{start:'09:00',end:'17:00'}}}]};
  assert.equal((await plan(db,'PUT',{revision:before.revision,studio:forged},employee)).status,403,'Non-planners remain forbidden before recurrence validation.');
  assert.equal((await put(db,forged,before.revision)).status,400);assert.deepEqual(await state(db),before);
  const stripped={...source};delete stripped.dayTimes;delete stripped.groupId;
  const olderClient={...before.studio,series:[stripped]};
  assert.equal((await put(db,olderClient,before.revision)).status,400);assert.deepEqual(await state(db),before,'A failed refreshed old writer must not create audit or revision changes.');
  const stale=await put(db,olderClient,0);assert.equal(stale.status,409);assert.deepEqual(stale.body.studio.series,[source]);
  assert.equal((await plan(db,'PUT',{revision:0,studio:olderClient},employee)).status,403,'A stale employee cannot use CAS to read shared definitions.');
  assert.deepEqual(await state(db),before);db.sqlite.close();
});

test('activity recovery explicitly restores legacy recurrence semantics after the first weekday-time and agreement upgrade',async()=>{
  const source={id:'legacy-adoption',person:person.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:'Oprindelig aftale'};
  const db=await setup(studio({series:[source],edits:{}}));let current=await state(db);
  current.studio.series[0]={...source,groupId:'agreement-adopted',dayTimes:{3:{start:'09:00',end:'17:00'}}};
  assert.equal((await put(db,current.studio,current.revision)).status,200);
  current=await state(db);const recovered=Publication.restoreActivity(current.studio,current.studio.activity.at(-1));assert.equal(recovered.ok,true);
  assert.deepEqual(recovered.studio.series,[{...source,groupId:source.id,dayTimes:{}}],'Recovery uses explicit defaults rather than an old-client omission.');
  const restored=await put(db,recovered.studio,current.revision);assert.equal(restored.status,200,JSON.stringify(restored.body));
  const durable=await state(db);assert.deepEqual(durable.studio.series,recovered.studio.series);
  const Data=require('../src/studio-data.js');assert.ok(Data.shiftsInRange('2026-11-02','2026-11-08',durable.studio).every(shift=>shift.start==='07:00'&&shift.end==='15:00'));
  assert.deepEqual((await employeeView(db)).shifts,[],'Recovery does not implicitly publish either template.');db.sqlite.close();
});
