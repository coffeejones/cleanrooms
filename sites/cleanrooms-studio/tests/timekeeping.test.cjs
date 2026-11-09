const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const Publication=require('../src/publication-model.js');
const Time=require('../src/timekeeping-model.js');
const Groups=require('../src/payroll-groups-model.js');
const owner={id:'time-owner',email:'owner@example.com'},employee={id:'time-worker',email:'worker@example.com'},other={id:'other-worker',email:'other@example.com'};
const people=[{id:'person-time-001',name:'Emma Test',initials:'ET',target:35,site:0,role:'Service',active:true},{id:'person-time-002',name:'Noah Test',initials:'NT',target:35,site:0,role:'Service',active:true}];
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const q=sqlite.prepare(sql);if(q.columns().length)return {success:true,results:q.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(q.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}};return db;}
const request=(url,method,body,principal=owner,origin='https://cleanrooms.example')=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id,...(method==='GET'?{}:{origin,'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const action=async(db,action,payload={},principal=owner,origin)=>{const r=await Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal,origin),db);return {status:r.status,body:await r.json()};};
const saveSiteGps=async(db,gps,expectedVersion=1)=>{const r=await Workspace.handleDirectoryRequest(request('/api/directory','POST',{action:'write',changes:[{kind:'site',id:'site-nord',expectedVersion,patch:{gps}}]}),db);return {status:r.status,body:await r.json()};};
const read=(db,principal=owner,extra={})=>action(db,'timeRead',{from:'2026-10-26',to:'2026-11-01',...extra},principal);
async function join(db,principal,personId,roleId='employee'){const i=await action(db,'invite',{email:principal.email,roleId,personId});assert.equal(i.status,200,JSON.stringify(i));const token=new URL(i.body.inviteUrl).searchParams.get('token');assert.equal((await action(db,'acceptInvite',{token},principal)).status,200);}
async function setup(){const db=database(),shift=(id,person,date='2026-10-26')=>({id,person,site:0,date,start:'07:00',end:'15:00',note:''}),edits={'t1':shift('t1',people[0].id),'t2':shift('t2',people[1].id),'t3':shift('t3',people[0].id,'2026-10-27')};let studio={storageVersion:1,demoSeed:false,roster:people,organization:Departments.defaultOrganization(),series:[],edits,deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[]};studio=Publication.publish(studio,{from:'2026-10-26',to:'2026-11-01',siteIds:[0],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:'2026-10-26T00:00:00.000Z'}).studio;await Store.writeStudio(db,owner.id,0,studio);const response=await Workspace.handleWorkspaceStudioRequest(request('/api/studio','GET'),db),context=await response.json();assert.equal(response.status,200);await join(db,employee,people[0].id);await join(db,other,people[1].id);return {db,workspace:context.workspace};}
const correct=(db,extra={},principal=owner)=>action(db,'timeWrite',{operation:'correct',shiftId:'t1',version:0,start:'07:00',end:'15:00',breakMinutes:30,reason:'Registreret efter vagt',...extra},principal);
const rates=(amount)=>({currency:'DKK',agreements:[{id:'base',from:'2026-01-01',type:'hourly',amountCents:amount}],supplements:[]});
async function configure(db,workspace){const policy={schema:1,groups:[{id:'group',name:'Daghold',archived:false,revisions:[{id:'r1',from:'2026-01-01',payroll:{...rates(18550),supplements:[{id:'morning',name:'Morgentillæg',type:'hourly',amountCents:2000,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4,5,6],start:'07:00',end:'09:00'}]}}]}],links:people.map((p,i)=>({personId:p.id,from:'2026-01-01',groupId:'group',baseMode:i?'group':'personal',excludedPersonalSupplementIds:[],supplementOverrides:[]}))};db.sqlite.prepare('INSERT INTO workspace_payroll_policies VALUES (?,?,?,?,?,?,?)').run(workspace.id,JSON.stringify(policy),1,'[]',owner.id,new Date().toISOString(),'policy-token');db.sqlite.prepare('INSERT INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspace.id,people[0].id,JSON.stringify(rates(19800)),1,owner.id,new Date().toISOString(),'person-token');return policy;}

const clockInGps={enabled:true,latitude:55,longitude:12,radiusMeters:100};
test('clock-in checks the current worksite GPS settings on an already published shift without storing the fix',async(t)=>{
  const {db}=await setup();t.after(()=>db.sqlite.close());t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T06:00:00Z')});
  const policy=await saveSiteGps(db,clockInGps);assert.equal(policy.status,200,JSON.stringify(policy));
  const fix={latitude:55.000234,longitude:12.000045,accuracyMeters:12,timestamp:Date.now()};
  const start=(payload={},principal=employee)=>action(db,'timeWrite',{operation:'start',shiftId:'t1',version:0,...payload},principal);
  assert.equal((await start({},other)).status,403);
  for(const [payload,error] of [
    [{site:1},'time_location_required'],
    [{location:{...fix,latitude:91}},'time_location_invalid'],
    [{location:{...fix,timestamp:fix.timestamp-30_001}},'time_location_stale'],
    [{location:{...fix,timestamp:fix.timestamp+5_001}},'time_location_stale'],
    [{location:{...fix,accuracyMeters:51}},'time_location_imprecise'],
    [{location:{...fix,latitude:55.001}},'time_location_outside'],
    [{location:{...fix,latitude:55.0008,accuracyMeters:15}},'time_location_imprecise'],
  ]){const rejected=await start(payload);assert.equal(rejected.status,400);assert.equal(rejected.body.error,error);}
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,0);
  const started=await start({location:fix});assert.equal(started.status,200,JSON.stringify(started));
  const persisted=db.sqlite.prepare('SELECT config FROM workspace_time_entries').get().config;
  const activity=db.sqlite.prepare("SELECT * FROM workspace_activity WHERE kind='time'").all();assert.equal(activity.length,1);
  for(const output of [JSON.stringify(started.body),persisted,JSON.stringify(activity)]){
    assert.equal(output.includes(String(fix.latitude)),false);assert.equal(output.includes(String(fix.longitude)),false);assert.equal(output.includes('accuracyMeters'),false);
  }
  t.mock.timers.tick(8*60*60*1000);
  const finished=await action(db,'timeWrite',{operation:'finish',entryId:started.body.entry.id,version:started.body.entry.version},employee);
  assert.equal(finished.status,200,JSON.stringify(finished));
  assert.equal((await start({location:fix})).status,409);
});

test('a GPS setting change during clock-in fences the write and turning GPS off restores ordinary clock-in',async(t)=>{
  const {db}=await setup();t.after(()=>db.sqlite.close());t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T06:00:00Z')});
  const policy=await saveSiteGps(db,clockInGps);assert.equal(policy.status,200,JSON.stringify(policy));
  const start=payload=>action(db,'timeWrite',{operation:'start',shiftId:'t1',version:0,...payload},employee);
  const location={latitude:55,longitude:12,accuracyMeters:10,timestamp:Date.now()};
  let updated;
  db.beforeBatch=async statements=>{
    if(!statements.some(item=>item.sql.startsWith('INSERT INTO workspace_time_entries')))return;
    db.beforeBatch=null;
    updated=await saveSiteGps(db,{...clockInGps,longitude:12.01},2);
  };
  const stale=await start({location});assert.equal(updated?.status,200,JSON.stringify(updated));assert.equal(stale.status,409,JSON.stringify(stale));assert.equal(stale.body.error,'time_conflict');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,0);
  assert.equal((await start({location})).body.error,'time_location_outside');
  const disabled=await saveSiteGps(db,{...clockInGps,enabled:false},3);assert.equal(disabled.status,200,JSON.stringify(disabled));
  const started=await start({});assert.equal(started.status,200,JSON.stringify(started));
});

async function clockRegistration(db,{pauseMinutes=0,claimedPlannedBreak,principal=owner,comment}={}){
  const NativeDate=global.Date;let instant='2026-10-26T06:00:00Z';
  class FixedDate extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant);}}
  global.Date=FixedDate;
  try{
    const started=await action(db,'timeWrite',{operation:'start',shiftId:'t1',version:0,...(claimedPlannedBreak===undefined?{}:{plannedBreakMinutes:claimedPlannedBreak})},principal);assert.equal(started.status,200,JSON.stringify(started));
    let version=started.body.entry.version;
    if(pauseMinutes){
      instant='2026-10-26T07:00:00Z';
      const paused=await action(db,'timeWrite',{operation:'pause',entryId:started.body.entry.id,version},principal);assert.equal(paused.status,200,JSON.stringify(paused));
      instant=new NativeDate(NativeDate.parse(instant)+pauseMinutes*60000).toISOString();
      const resumed=await action(db,'timeWrite',{operation:'resume',entryId:started.body.entry.id,version:paused.body.entry.version},principal);assert.equal(resumed.status,200,JSON.stringify(resumed));version=resumed.body.entry.version;
    }
    instant='2026-10-26T14:00:00Z';
    const finished=await action(db,'timeWrite',{operation:'finish',entryId:started.body.entry.id,version,...(comment===undefined?{}:{comment})},principal);assert.equal(finished.status,200,JSON.stringify(finished));
    return finished.body.entry;
  }finally{global.Date=NativeDate;}
}

const reviewShift={id:'review-shift',person:'review-person',date:'2026-11-02',site:0,start:'07:00',end:'15:00'};
const reviewEntry=(patch={})=>({id:'review-entry',shiftId:reviewShift.id,personId:reviewShift.person,date:reviewShift.date,endDate:reviewShift.date,site:0,plannedStart:'07:00',plannedEnd:'15:00',start:'07:00',end:'15:00',breakMinutes:0,breaks:[],workedMinutes:480,status:'submitted',flags:[],...patch});

test('review requires exact current plan intervals instead of trusting flags or an equal net duration',()=>{
  assert.deepEqual(Time.review(reviewEntry(),{shift:reviewShift}),{bucket:'ready',reasons:[],priority:10});
  for(const patch of [{start:'06:00',end:'14:00'},{start:'08:00',end:'16:00'},{end:'14:00',workedMinutes:420}]){
    const result=Time.review(reviewEntry({...patch,deltaMinutes:0,flags:[]}),{shift:reviewShift});
    assert.equal(result.bucket,'attention');assert.ok(result.reasons.some(reason=>['start_difference','end_difference'].includes(reason.code)));
  }
  const changed=Time.review(reviewEntry(),{shift:{...reviewShift,start:'08:00',end:'16:00'}});
  assert.equal(changed.bucket,'attention');assert.equal(changed.reasons[0].code,'plan_changed');
  for(const [shift,code] of [[undefined,'shift_missing'],[{...reviewShift,person:'another-person'},'person_changed'],[{...reviewShift,date:'2026-11-03'},'date_changed'],[{...reviewShift,site:1},'site_changed']])assert.ok(Time.review(reviewEntry(),{shift}).reasons.some(reason=>reason.code===code));
});

test('planned breaks define net targets and allow the agreed pause while deviations still require review',()=>{
  const shift={...reviewShift,plannedBreakMinutes:30},entry=reviewEntry({plannedBreakMinutes:30,breakMinutes:30,workedMinutes:450});
  assert.equal(Time.plannedBreak(shift),30);assert.equal(Time.plannedMinutes(shift),450);assert.equal(Time.plannedGrossMinutes(shift),480);
  assert.equal(Time.plannedBreak(reviewShift),0);assert.equal(Time.plannedMinutes(reviewShift),480);
  assert.deepEqual(Time.summary(entry),{plannedMinutes:450,plannedBreakMinutes:30,plannedGrossMinutes:480,workedMinutes:450,deltaMinutes:0,flags:[]});
  assert.equal(Time.review(entry,{shift}).bucket,'ready');
  for(const actual of [0,15,45,75]){
    const changed={...entry,breakMinutes:actual,workedMinutes:480-actual};Object.assign(changed,Time.summary(changed));
    const result=Time.review(changed,{shift});assert.equal(result.bucket,'attention');
    const reason=result.reasons.find(reason=>reason.code==='pause');assert.ok(reason);assert.match(reason.label,new RegExp(actual+' min'));assert.match(reason.label,/planlagt pause er 30 min/);
  }
  const long={...entry,plannedBreakMinutes:75,breakMinutes:75,workedMinutes:405,flags:['long_break']};
  assert.equal(Time.review(long,{shift:{...shift,plannedBreakMinutes:75}}).bucket,'ready');assert.deepEqual(Time.summary(long).flags,[]);
  for(const invalid of [null,'30',-1,1.5,480,Infinity]){
    const invalidShift={...shift,plannedBreakMinutes:invalid};assert.equal(Time.plannedBreak(invalidShift),null);assert.equal(Time.plannedMinutes(invalidShift),null);
    assert.equal(Time.review({...entry,plannedBreakMinutes:invalid},{shift:invalidShift}).bucket,'attention');assert.ok(Time.validate({...entry,plannedBreakMinutes:invalid}).length);
  }
  const changedPlan=Time.review(entry,{shift:{...shift,plannedBreakMinutes:45}});assert.ok(changedPlan.reasons.some(reason=>reason.code==='plan_changed'));
});

async function publishPlannedBreak(db,plannedBreakMinutes){
  const saved=await Store.readStudio(db,owner.id);saved.studio.edits.t1={...saved.studio.edits.t1,plannedBreakMinutes};
  const published=Publication.publish(saved.studio,{from:'2026-10-26',to:'2026-11-01',siteIds:[0],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:'2026-10-26T00:00:00.000Z'}).studio;
  await Store.writeStudio(db,owner.id,saved.revision,published);
}

test('clocked agreed pauses can be quick-approved without double deduction and immutable receipts retain their original plan',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);await publishPlannedBreak(db,30);
  const entry=await clockRegistration(db,{pauseMinutes:30,claimedPlannedBreak:0});
  assert.equal(entry.plannedBreakMinutes,30,'The published plan, not an employee payload, defines the agreement.');assert.equal(entry.plannedMinutes,450);assert.equal(entry.workedMinutes,450);assert.equal(entry.deltaMinutes,0);
  const approved=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true});assert.equal(approved.status,200,JSON.stringify(approved));
  assert.equal(approved.body.entry.payroll.baseCents,148500);assert.equal(approved.body.entry.payroll.supplementCents,3000);assert.equal(approved.body.entry.payroll.totalCents,151500);
  await publishPlannedBreak(db,45);
  const after=(await read(db)).body.entries.find(item=>item.id===entry.id);assert.equal(after.plannedBreakMinutes,30);assert.equal(after.plannedMinutes,450);assert.equal(after.deltaMinutes,0);assert.deepEqual(after.payroll,approved.body.entry.payroll);db.sqlite.close();
});

test('changing the published pause fences quick approval even if the attendance version and clock times are unchanged',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);await publishPlannedBreak(db,30);
  const entry=await clockRegistration(db,{pauseMinutes:30});await publishPlannedBreak(db,45);
  const before=db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config;
  const rejected=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true,plannedBreakMinutes:30});
  assert.equal(rejected.status,409);assert.equal(rejected.body.error,'time_plan_review_required');assert.equal(db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config,before);db.sqlite.close();
});

test('planned pauses are never filled into the actual registration or used to hide a missing pause',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);await publishPlannedBreak(db,30);
  const entry=await clockRegistration(db,{claimedPlannedBreak:0});assert.equal(entry.plannedBreakMinutes,30);assert.equal(entry.breakMinutes,0);assert.equal(entry.workedMinutes,480);assert.equal(entry.deltaMinutes,30);
  const guarded=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true});assert.equal(guarded.status,409);
  const manual=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:entry.version});assert.equal(manual.status,200);assert.equal(manual.body.entry.payroll.baseCents,158400,'Only actual pauses affect wages.');db.sqlite.close();
});

test('manager corrections cannot create future starts or checkouts on an otherwise valid work date',async t=>{
  const {db}=await setup();t.after(()=>db.sqlite.close());
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T06:00:00Z')});
  for(const patch of [
    {start:'07:00',end:'15:00',endDate:'2026-10-26',breakMinutes:0},
    {start:'07:01',end:null,breakMinutes:0},
    {start:'23:00',end:'01:00',endDate:'2026-10-27',breakMinutes:0},
  ]){
    const result=await correct(db,patch);assert.equal(result.status,400,JSON.stringify(result));
    assert.equal(result.body.error,'time_future_entry');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,0);
  }
  // A real overnight correction remains possible once its checkout has passed.
  t.mock.timers.setTime(Date.parse('2026-10-26T23:10:00Z'));
  const overnight=await correct(db,{start:'23:00',end:'00:00',endDate:'2026-10-27',breakMinutes:0});
  assert.equal(overnight.status,200,JSON.stringify(overnight));assert.equal(overnight.body.entry.workedMinutes,60);
});

test('legacy future submissions cannot freeze pay until their recorded checkout has occurred',async t=>{
  const {db,workspace}=await setup();t.after(()=>db.sqlite.close());await configure(db,workspace);
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T14:00:00Z')});
  const submitted=await correct(db,{breakMinutes:0});assert.equal(submitted.status,200,JSON.stringify(submitted));
  const entry=submitted.body.entry,before=db.sqlite.prepare('SELECT config FROM workspace_time_entries WHERE id=?').get(entry.id).config;
  // Model a legacy forward-dated row without changing the host clock or source plan.
  t.mock.timers.setTime(Date.parse('2026-10-26T06:00:00Z'));
  const refused=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:entry.version});
  assert.equal(refused.status,400,JSON.stringify(refused));assert.equal(refused.body.error,'time_future_entry');
  assert.equal(db.sqlite.prepare('SELECT config FROM workspace_time_entries WHERE id=?').get(entry.id).config,before);
  t.mock.timers.setTime(Date.parse('2026-10-26T14:00:00Z'));
  const approved=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:entry.version});
  assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.status,'approved');
  assert.ok(approved.body.entry.payroll.totalCents>0);
});

test('review explains pauses and corrections once and fails closed on DST, overlap and unknown flags',()=>{
  const result=Time.review(reviewEntry({start:'07:20',breakMinutes:75,workedMinutes:385,correctionReason:'Kontrolleret',flags:['late_start','long_break','corrected','dst_transition']}),{shift:reviewShift});
  assert.equal(result.bucket,'attention');assert.equal(result.priority,100);assert.equal(result.reasons[0].code,'dst_transition');
  assert.deepEqual(result.reasons.map(reason=>reason.code).sort(),['corrected','dst_transition','pause','start_difference']);
  assert.match(result.reasons.find(reason=>reason.code==='pause').label,/75 min/);
  for(const flag of ['overlap','dst_transition','future-warning'])assert.equal(Time.review(reviewEntry({flags:[flag]}),{shift:reviewShift}).bucket,'attention');
  assert.equal(Time.review(reviewEntry({breakMinutes:30,workedMinutes:450}),{shift:reviewShift}).bucket,'attention');
});

test('review separates ongoing, overdue, returned and approved records and respects payroll visibility',()=>{
  for(const status of ['running','paused']){
    const open=reviewEntry({status,end:null,workedMinutes:0,flags:['missing_end']});
    assert.equal(Time.review(open,{shift:reviewShift,today:reviewShift.date}).bucket,'progress');
    assert.equal(Time.review(open,{shift:reviewShift,today:'2026-11-03'}).bucket,'attention');
  }
  const rejected=Time.review(reviewEntry({status:'rejected'}),{shift:reviewShift});assert.equal(rejected.bucket,'attention');assert.ok(rejected.reasons.some(reason=>reason.code==='rejected'));
  assert.deepEqual(Time.review(reviewEntry({status:'approved',end:null,flags:['missing_end']}),{canViewPayroll:true}),{bucket:'approved',reasons:[],priority:0});
  assert.equal(Time.review(reviewEntry(),{shift:reviewShift,canViewPayroll:false}).bucket,'ready');
  const missing=Time.review(reviewEntry(),{shift:reviewShift,canViewPayroll:true});assert.equal(missing.bucket,'attention');assert.equal(missing.reasons[0].code,'payroll_missing');
  assert.equal(Time.review(reviewEntry({payroll:{totalCents:0,monthlyBaseCents:3000000}}),{shift:reviewShift,canViewPayroll:true}).bucket,'ready');
  assert.equal(Time.review(reviewEntry({payroll:{totalCents:0,unavailableReason:'Ingen aftale'}}),{shift:reviewShift,canViewPayroll:false}).bucket,'ready');
});

test('quick approval accepts a clean clocked record and rejects corrected hours without changing manual approval',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);const clean=await clockRegistration(db);
  const approved=await action(db,'timeWrite',{operation:'approve',entryId:clean.id,version:clean.version,onlyIfMatchesPlan:true});
  assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.status,'approved');assert.equal(approved.body.entry.payroll.totalCents,162400);
  const corrected=await correct(db,{shiftId:'t3',breakMinutes:0});assert.equal(corrected.status,200);
  const before=db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config;
  const guarded=await action(db,'timeWrite',{operation:'approve',entryId:corrected.body.entry.id,version:1,onlyIfMatchesPlan:true});
  assert.equal(guarded.status,409);assert.equal(guarded.body.error,'time_plan_review_required');assert.equal(db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config,before);
  assert.equal((await action(db,'timeWrite',{operation:'approve',entryId:corrected.body.entry.id,version:1})).status,200);db.sqlite.close();
});

test('quick approval checks the latest published plan even when the attendance version has not changed',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);const clean=await clockRegistration(db),saved=await Store.readStudio(db,owner.id);
  saved.studio.edits.t1={...saved.studio.edits.t1,start:'08:00',end:'16:00'};
  const changed=Publication.publish(saved.studio,{from:'2026-10-26',to:'2026-11-01',siteIds:[0],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:'2026-10-27T00:00:00.000Z'}).studio;
  await Store.writeStudio(db,owner.id,saved.revision,changed);
  const visible=await read(db);assert.equal(visible.body.entries[0].version,clean.version);assert.equal(visible.body.shifts.find(shift=>shift.id==='t1').start,'08:00');
  const before=db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config;
  const guarded=await action(db,'timeWrite',{operation:'approve',entryId:clean.id,version:clean.version,onlyIfMatchesPlan:true});
  assert.equal(guarded.status,409);assert.equal(guarded.body.error,'time_plan_review_required');assert.equal(db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config,before);
  db.sqlite.close();
});

test('quick approval considers missing wages only for reviewers with payroll access and never grants that access',async()=>{
  const {db}=await setup(),clean=await clockRegistration(db),planner={id:'time-planner',email:'planner@example.com'};
  const missing=await action(db,'timeWrite',{operation:'approve',entryId:clean.id,version:clean.version,onlyIfMatchesPlan:true});
  assert.equal(missing.status,409);assert.equal(missing.body.error,'time_plan_review_required');
  await join(db,planner,null,'planner');
  const visible=await read(db,planner);assert.equal(visible.body.canViewPayroll,false);assert.equal(visible.body.entries[0].payroll,undefined);
  const approved=await action(db,'timeWrite',{operation:'approve',entryId:clean.id,version:clean.version,onlyIfMatchesPlan:true},planner);
  assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.status,'approved');assert.equal(approved.body.entry.payroll,undefined);db.sqlite.close();
});

test('pure model counts exact clock pauses, dated group/personal supplements and excludes monthly fixed salary per shift',()=>{const entry={id:'e',personId:'person-time-001',date:'2026-10-26',plannedStart:'07:00',plannedEnd:'15:00',start:'07:00',end:'15:00',breakMinutes:30,breaks:[{start:8*60,end:8*60+30}],status:'submitted'};assert.deepEqual(Time.validate(entry),[]);assert.equal(Time.summary(entry).workedMinutes,450);const policy={schema:1,groups:[],links:[]},payroll={...rates(19800),supplements:[{id:'morning',name:'Morning',type:'hourly',amountCents:2000,from:'2026-01-01',to:null,weekdays:[0],start:'07:00',end:'09:00'}]},resolved=Groups.resolve({policy,payroll,personId:'person-time-001',from:entry.date,to:entry.date}),receipt=Time.payroll(entry,resolved);assert.equal(receipt.baseCents,148500);assert.equal(receipt.supplementCents,3000);assert.equal(receipt.totalCents,151500);payroll.agreements[0].type='monthly';payroll.agreements[0].amountCents=3000000;const monthly=Time.payroll(entry,Groups.resolve({policy,payroll,personId:'person-time-001',from:entry.date,to:entry.date}));assert.equal(monthly.baseCents,0);assert.equal(monthly.monthlyBaseCents,3000000);assert.equal(monthly.totalCents,3000);assert.equal(monthly.monthlyLines.length,1);});

test('durable ledger isolates own published shifts and never leaks wages or another employee into employee reads',async()=>{const {db,workspace}=await setup();await configure(db,workspace);const written=await correct(db);assert.equal(written.status,200,JSON.stringify(written));assert.equal(written.body.entry.status,'submitted');assert.equal(written.body.entry.workedMinutes,450);assert.equal((await correct(db,{shiftId:'t2',personId:people[1].id},employee)).status,403);const denied=await read(db,employee,{personId:people[1].id});assert.equal(denied.status,403);const peer=await read(db,other);assert.deepEqual(peer.body.entries,[]);assert.equal(peer.body.shifts.length,1);const approved=await action(db,'timeWrite',{operation:'approve',entryId:written.body.entry.id,version:1});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.payroll.baseCents,148500);assert.equal(approved.body.entry.payroll.supplementCents,4000);const groupEntry=await correct(db,{shiftId:'t2'});assert.equal(groupEntry.status,200);const groupApproval=await action(db,'timeWrite',{operation:'approve',entryId:groupEntry.body.entry.id,version:1});assert.equal(groupApproval.body.entry.payroll.baseCents,139125);assert.match(groupApproval.body.entry.payroll.sourceLabel,/Daghold/);const privateRead=await read(db,employee);assert.equal(privateRead.body.entries.length,1);assert.equal(privateRead.body.entries[0].payroll,undefined);assert.equal(privateRead.body.entries[0].approvalHistory,undefined);assert.equal(JSON.stringify(privateRead.body).includes('148500'),false);assert.equal((await action(db,'timeWrite',{operation:'approve',entryId:written.body.entry.id,version:2},employee)).status,403);db.sqlite.close();});

test('approval snapshots stay fixed after a wage change; corrections require reopening, reasons and fresh versions',async()=>{const {db,workspace}=await setup();await configure(db,workspace);const first=await correct(db);assert.equal(first.status,200,JSON.stringify(first));const id=first.body.entry.id;const approved=await action(db,'timeWrite',{operation:'approve',entryId:id,version:1});assert.equal(approved.status,200);const snapshot=approved.body.entry.payroll;db.sqlite.prepare('UPDATE workspace_payroll SET config = ?,version = 2 WHERE person_id = ?').run(JSON.stringify(rates(25000)),people[0].id);assert.deepEqual((await read(db)).body.entries[0].payroll,snapshot);assert.equal((await correct(db,{entryId:id,version:2})).status,409);assert.equal((await action(db,'timeWrite',{operation:'reopen',entryId:id,version:2})).status,400);assert.equal((await action(db,'timeWrite',{operation:'reopen',entryId:id,version:1,reason:'Ret tid'})).status,409);const reopened=await action(db,'timeWrite',{operation:'reopen',entryId:id,version:2,reason:'Kontrolleret fejl'});assert.equal(reopened.status,200);assert.equal(reopened.body.entry.status,'submitted');assert.equal(reopened.body.entry.approvalHistory[0].snapshot.totalCents,snapshot.totalCents);const revised=await correct(db,{entryId:id,version:3,end:'16:00'});assert.equal(revised.status,200);const second=await action(db,'timeWrite',{operation:'approve',entryId:id,version:4});assert.equal(second.status,200);assert.equal(second.body.entry.payroll.personVersion,2);assert.equal(second.body.entry.approvalHistory.length,2);assert.equal(second.body.entry.audit.length,5);db.sqlite.close();});

test('invalid intervals, overlap, bad pause totals and missing checkout cannot be approved',async()=>{const {db}=await setup();for(const patch of [{start:'17:00',end:'15:00'},{breakMinutes:-1},{breakMinutes:480},{start:'x'},{reason:''}])assert.equal((await correct(db,patch)).status,400,JSON.stringify(patch));const first=await correct(db);assert.equal(first.status,200);const saved=await Store.readStudio(db,owner.id),duplicate={...saved.studio,edits:{...saved.studio.edits,overlap:{...saved.studio.edits.t1,id:'overlap',start:'12:00',end:'16:00'}}};const published=Publication.publish(duplicate,{from:'2026-10-26',to:'2026-11-01',siteIds:[0],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:'2026-10-26T00:00:00.000Z'}).studio;await Store.writeStudio(db,owner.id,saved.revision,published);assert.equal((await correct(db,{shiftId:'overlap',start:'12:00',end:'16:00'})).status,409);const incomplete=await correct(db,{shiftId:'t3',start:'07:00',end:null,breakMinutes:0});assert.equal(incomplete.status,200);assert.equal(incomplete.body.entry.flags.includes('missing_end'),true);assert.equal((await action(db,'timeWrite',{operation:'approve',entryId:incomplete.body.entry.id,version:1})).status,409);db.sqlite.close();});

test('demo week is separate, repeatable and has a full virtual clock flow without changing the real plan or payroll',async()=>{const {db}=await setup(),before=await Store.readStudio(db,owner.id);const loaded=await action(db,'timeDemo',{operation:'load'});assert.equal(loaded.status,200,JSON.stringify(loaded));assert.equal(loaded.body.demo.active,true);assert.equal(loaded.body.demo.scenarios.length,7);const clock=loaded.body.demo.scenarios.find(s=>s.id==='clock');const started=await action(db,'timeWrite',{operation:'start',shiftId:clock.shiftId,personId:clock.personId,version:0,demo:true});assert.equal(started.status,200,JSON.stringify(started));const id=started.body.entry.id;assert.equal(started.body.entry.start,'09:00');const paused=await action(db,'timeWrite',{operation:'pause',entryId:id,version:1,demo:true});assert.equal(paused.status,200);assert.equal(paused.body.entry.status,'paused');const resumed=await action(db,'timeWrite',{operation:'resume',entryId:id,version:2,demo:true});assert.equal(resumed.status,200);assert.equal(resumed.body.entry.breakMinutes,30);const finished=await action(db,'timeWrite',{operation:'finish',entryId:id,version:3,demo:true});assert.equal(finished.status,200,JSON.stringify(finished));assert.equal(finished.body.entry.status,'submitted');assert.ok(finished.body.entry.workedMinutes>0);assert.equal((await action(db,'timeDemo',{operation:'load'},employee)).status,403);assert.equal((await action(db,'timeWrite',{operation:'correct',entryId:id,version:4,demo:true,start:'09:00',end:'13:00',breakMinutes:0,reason:'forge'},employee)).status,403);assert.equal((await read(db,employee,{from:loaded.body.demo.from,to:loaded.body.demo.to})).body.entries.some(e=>e.demo),false);assert.equal((await action(db,'timeDemo',{operation:'load'})).body.demo.id,loaded.body.demo.id);assert.deepEqual(await Store.readStudio(db,owner.id),before);assert.equal((await action(db,'timeDemo',{operation:'clear'})).body.demo.active,false);assert.equal((await read(db)).body.entries.length,0);db.sqlite.close();});

test('CAS atomically fences concurrent role revocation and salary changes; same-origin is enforced',async()=>{const {db,workspace}=await setup();await configure(db,workspace);const entry=(await correct(db)).body.entry;db.beforeBatch=async statements=>{if(statements.some(s=>s.sql.startsWith('UPDATE workspace_time_entries'))){db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_payroll SET version = version + 1 WHERE person_id = ?').run(people[0].id);}};const changed=await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:1});assert.equal(changed.status,409,JSON.stringify(changed));assert.equal((await read(db)).body.entries[0].status,'submitted');db.beforeBatch=async statements=>{if(statements.some(s=>s.sql.startsWith('UPDATE workspace_time_entries'))){db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_members SET status = ?,version = version + 1 WHERE user_id = ?').run('disabled',employee.id);}};const revoked=await action(db,'timeWrite',{operation:'comment',entryId:entry.id,version:1,comment:'Jeg mødte til tiden.'},employee);assert.equal(revoked.status,403);assert.equal((await read(db)).body.entries[0].version,1);assert.equal((await action(db,'timeWrite',{operation:'approve',entryId:entry.id,version:1},owner,'https://evil.example')).status,403);db.sqlite.close();});


test('forged approval fields, drafts and other workspaces never cross the ledger boundary',async()=>{
  const {db}=await setup();const written=await correct(db,{status:'approved',approvedBy:{userId:'forged'},payroll:{totalCents:999999999},audit:[{actor:{name:'Forged'}}]});
  assert.equal(written.status,200);assert.equal(written.body.entry.status,'submitted');assert.equal(written.body.entry.approvedBy,null);assert.equal(written.body.entry.audit[0].actor.userId,owner.id);
  const before=db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config,current=await Store.readStudio(db,owner.id);current.studio.edits.t3.start='09:00';await Store.writeStudio(db,owner.id,current.revision,current.studio);assert.equal(db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config,before);
  const another={id:'separate-owner',email:'separate@example.com'};await Store.writeStudio(db,another.id,0,current.studio);const fresh=await Workspace.handleWorkspaceStudioRequest(request('/api/studio','GET',undefined,another),db);assert.equal(fresh.status,200);
  const isolated=await read(db,another);assert.equal(isolated.status,200);assert.deepEqual(isolated.body.entries,[]);assert.equal(isolated.body.demo.active,false);
  const forged=await action(db,'timeWrite',{operation:'approve',entryId:written.body.entry.id,version:1,workspaceId:(await fresh.json()).workspace.id},another);assert.equal(forged.status,404);
  // The published t3 remains at07:00 despite its private draft at09:00.
  assert.equal((await read(db,employee)).body.shifts.find(s=>s.id==='t3').start,'07:00');db.sqlite.close();
});

test('a role revoked during a time read returns no attendance or wage data',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);await correct(db);let fired=false;
  db.beforeBatch=async statements=>{if(!fired&&statements.some(s=>s.sql.startsWith('SELECT * FROM workspace_timekeeping'))){fired=true;db.sqlite.prepare('UPDATE workspace_members SET status = ?,version = version + 1 WHERE user_id = ?').run('disabled',owner.id);}};
  const result=await read(db);assert.equal(result.status,403);assert.equal(result.body.entries,undefined);assert.equal(result.body.payroll,undefined);db.sqlite.close();
});

test('demo comparison uses public roster order rather than private salary-group membership',async()=>{
  const {db,workspace}=await setup(),policy=await configure(db,workspace),peer={...people[1],id:'person-time-003',name:'Group peer'};
  const saved=await Store.readStudio(db,owner.id);saved.studio.roster.push(peer);await Store.writeStudio(db,owner.id,saved.revision,saved.studio);
  policy.groups.push({...policy.groups[0],id:'other-group',name:'Other group'});policy.links[1].groupId='other-group';policy.links.push({...policy.links[1],personId:peer.id,groupId:'group'});
  db.sqlite.prepare('UPDATE workspace_payroll_policies SET config = ?').run(JSON.stringify(policy));
  const before=db.sqlite.prepare('SELECT config FROM workspace_payroll_policies').get().config;
  const loaded=await action(db,'timeDemo',{operation:'load'});assert.equal(loaded.status,200);
  const bundle=await read(db,owner,{from:loaded.body.demo.from,to:loaded.body.demo.to});
  const comparison=bundle.body.entries.find(e=>e.scenario==='group-comparison'),personal=bundle.body.entries.find(e=>e.scenario==='corrected');
  assert.ok(comparison);assert.equal(comparison.personId,people[1].id);assert.equal(comparison.date,Time.addDays(loaded.body.demo.from,5));assert.equal(comparison.date,personal.date);assert.equal(comparison.endDate,comparison.date);
  assert.equal(bundle.body.shifts.find(s=>s.id===comparison.shiftId).date,comparison.date);
  assert.equal(comparison.plannedBreakMinutes,30);assert.equal(comparison.breakMinutes,30);assert.equal(comparison.plannedMinutes,450);assert.equal(comparison.deltaMinutes,0);
  assert.equal(Time.review(comparison,{shift:bundle.body.shifts.find(s=>s.id===comparison.shiftId),canViewPayroll:true}).bucket,'ready');
  assert.equal(comparison.payroll.baseCents,139125);assert.equal(personal.payroll.baseCents,158400);
  assert.equal(db.sqlite.prepare('SELECT config FROM workspace_payroll_policies').get().config,before);db.sqlite.close();
});

test('payroll source labels retain disabled group supplements and excluded personal supplements as personal choices',()=>{
  const entry={personId:people[0].id,date:'2026-10-26',plannedStart:'07:00',plannedEnd:'15:00',start:'07:00',end:'15:00',breakMinutes:0},extra={id:'extra',name:'Tillæg',type:'hourly',amountCents:1000,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4,5,6],start:null,end:null};
  const policy={schema:1,groups:[{id:'g',name:'Daghold',archived:false,revisions:[{id:'r',from:'2026-01-01',payroll:{...rates(18550),supplements:[extra]}}]}],links:[{personId:entry.personId,from:'2026-01-01',groupId:'g',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[{id:'extra',mode:'off',supplement:null}]}]};
  const calculate=payroll=>Time.payroll(entry,Groups.resolve({policy,payroll,personId:entry.personId,from:entry.date,to:entry.date}));
  const disabled=calculate(null);assert.equal(disabled.supplementCents,0);assert.match(disabled.sourceLabel,/Daghold · personlige tillæg/);
  policy.groups[0].revisions[0].payroll.supplements=[];policy.links[0].supplementOverrides=[];policy.links[0].excludedPersonalSupplementIds=['extra'];
  const excluded=calculate({...rates(20000),supplements:[extra]});assert.equal(excluded.supplementCents,0);assert.match(excluded.sourceLabel,/Daghold · personlige tillæg/);
  policy.links[0].excludedPersonalSupplementIds=[];assert.equal(calculate(null).sourceLabel,'Daghold');
});

test('Copenhagen transition detection catches repeated and skipped clock hours without flagging ordinary intervals',()=>{
  assert.equal(Time.copenhagenOffset('2026-10-25T00:30:00Z'),120);
  assert.equal(Time.copenhagenOffset('2026-10-25T02:30:00Z'),60);
  assert.equal(Time.crossesOffsetChange('2026-10-25T00:30:00Z','2026-10-25T02:30:00Z'),true);
  assert.equal(Time.crossesOffsetChange('2026-03-29T00:30:00Z','2026-03-29T02:30:00Z'),true);
  for(const date of ['2026-10-25','2026-03-29']){
    assert.equal(Time.hasDSTAmbiguity({date,start:'01:30',end:'03:30'}),true);
    assert.equal(Time.hasDSTAmbiguity({date,start:'03:30',end:'05:00'}),false);
  }
  assert.equal(Time.hasDSTAmbiguity({date:'2026-10-25',start:'02:10',end:'02:30',breakAllocation:'clocked',clockStartAt:'2026-10-25T00:10:00Z',clockEndAt:'2026-10-25T00:30:00Z'}),false);
  assert.equal(Time.hasDSTAmbiguity({date:'2026-10-24',start:'22:00',end:'05:00',endDate:'2026-10-25'}),true);
  assert.equal(Time.flagLabel('dst_transition'),'Skift mellem sommer- og vintertid');
});

test('DST checkout is durable, frees the next clock, and needs precise manager resolution before payroll approval',async()=>{
  const {db,workspace}=await setup();await configure(db,workspace);
  const saved=await Store.readStudio(db,owner.id),shift={...saved.studio.edits.t1,id:'dst-shift',date:'2026-10-25',start:'01:30',end:'04:30'};
  const published=Publication.publish({...saved.studio,edits:{...saved.studio.edits,[shift.id]:shift}},{from:'2026-10-19',to:shift.date,siteIds:[0],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:'2026-10-24T00:00:00.000Z'}).studio;
  await Store.writeStudio(db,owner.id,saved.revision,published);
  const NativeDate=global.Date;let instant='2026-10-24T23:30:00.000Z';
  global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant);}};
  try{
    const started=await action(db,'timeWrite',{operation:'start',shiftId:shift.id,version:0},employee);assert.equal(started.status,200,JSON.stringify(started));
    instant='2026-10-25T00:30:00.000Z';const paused=await action(db,'timeWrite',{operation:'pause',entryId:started.body.entry.id,version:started.body.entry.version},employee);assert.equal(paused.status,200);
    instant='2026-10-25T01:15:00.000Z';const resumed=await action(db,'timeWrite',{operation:'resume',entryId:started.body.entry.id,version:paused.body.entry.version},employee);assert.equal(resumed.status,200);assert.equal(resumed.body.entry.breakMinutes,45);
    instant='2026-10-25T02:30:00.000Z';
    const finished=await action(db,'timeWrite',{operation:'finish',entryId:started.body.entry.id,version:resumed.body.entry.version,comment:'Vagten krydsede vintertid.'},employee);
    assert.equal(finished.status,200,JSON.stringify(finished));assert.equal(finished.body.entry.status,'submitted');assert.equal(finished.body.entry.workedMinutes,135);assert.ok(finished.body.entry.flags.includes('dst_transition'));assert.equal(finished.body.entry.payroll,undefined);
    const id=finished.body.entry.id,version=finished.body.entry.version;
    const blocked=await action(db,'timeWrite',{operation:'approve',entryId:id,version});assert.equal(blocked.status,400);assert.equal(blocked.body.error,'time_dst_transition');
    instant='2026-10-26T06:00:00.000Z';
    const next=await action(db,'timeWrite',{operation:'start',shiftId:'t1',version:0},employee);assert.equal(next.status,200,JSON.stringify(next));
    const mismatch=await correct(db,{entryId:id,version,start:'01:30',end:'03:30',breakMinutes:0,actualStartAt:'2026-10-25T00:30:00.000Z',actualEndAt:'2026-10-25T02:30:00.000Z'});assert.equal(mismatch.status,400);assert.equal(mismatch.body.error,'time_instants_mismatch');
    const resolved=await correct(db,{entryId:id,version,start:'01:30',end:'03:30',breakMinutes:45,actualStartAt:'2026-10-24T23:30:00.000Z',actualEndAt:'2026-10-25T02:30:00.000Z',reason:'Præcise stemplinger kontrolleret med medarbejderen'});
    assert.equal(resolved.status,200,JSON.stringify(resolved));assert.equal(resolved.body.entry.workedMinutes,135);assert.equal(resolved.body.entry.flags.includes('dst_transition'),false);assert.equal(resolved.body.entry.timeZone,'Europe/Copenhagen');assert.equal(resolved.body.entry.breakAllocation,'clocked');assert.deepEqual(resolved.body.entry.breaks,finished.body.entry.breaks);
    const approved=await action(db,'timeWrite',{operation:'approve',entryId:id,version:resolved.body.entry.version});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.payroll.baseCents,44550);
    assert.equal(approved.body.entry.clockStartAt,'2026-10-24T23:30:00.000Z','Original stamps survive an explicit resolution.');
  }finally{global.Date=NativeDate;db.sqlite.close();}
});

test('ambiguous manual wall times are saved for clarification but never create an approvable wage receipt',async()=>{
  const {db}=await setup(),saved=await Store.readStudio(db,owner.id),shift={...saved.studio.edits.t1,id:'manual-dst',date:'2026-10-25',start:'01:30',end:'04:30'};
  const published=Publication.publish({...saved.studio,edits:{...saved.studio.edits,[shift.id]:shift}},{from:'2026-10-19',to:shift.date,siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-10-24T00:00:00.000Z'}).studio;await Store.writeStudio(db,owner.id,saved.revision,published);
  const manual=await correct(db,{shiftId:shift.id,start:'01:30',end:'03:30',breakMinutes:0});assert.equal(manual.status,200,JSON.stringify(manual));assert.ok(manual.body.entry.flags.includes('dst_transition'));assert.equal(manual.body.entry.payroll,undefined);
  assert.equal((await action(db,'timeWrite',{operation:'approve',entryId:manual.body.entry.id,version:manual.body.entry.version})).status,400);db.sqlite.close();
});

test('employees cannot fabricate or correct clock times and comments preserve the recorded times with an audit trail',async()=>{
  const {db}=await setup();
  assert.equal((await correct(db,{},employee)).status,403);
  const recorded=await correct(db,{start:'07:22',breakMinutes:0});assert.equal(recorded.status,200);
  const current=recorded.body.entry,comment='Jeg glemte at stemple ind, men mødte kl. 07:00.';
  const explained=await action(db,'timeWrite',{operation:'comment',entryId:current.id,version:1,comment,start:'07:00',end:'23:00',breakMinutes:1,status:'approved'},employee);
  assert.equal(explained.status,200,JSON.stringify(explained));assert.equal(explained.body.entry.start,'07:22');assert.equal(explained.body.entry.end,'15:00');assert.equal(explained.body.entry.breakMinutes,0);assert.equal(explained.body.entry.status,'submitted');assert.equal(explained.body.entry.comment,comment);assert.equal(explained.body.entry.payroll,undefined);
  const event=explained.body.entry.audit.at(-1);assert.equal(event.operation,'comment');assert.equal(event.actor.userId,employee.id);assert.equal(event.before.start,event.after.start);assert.equal(event.after.comment,comment);assert.match(event.id,/^time-event-/);
  assert.equal((await correct(db,{entryId:current.id,version:2},employee)).status,403);
  assert.equal((await action(db,'timeWrite',{operation:'comment',entryId:current.id,version:2,comment:'   '},employee)).status,400);
  assert.equal((await action(db,'timeWrite',{operation:'comment',entryId:current.id,version:2,comment:'En anden medarbejder'},other)).status,403);
  const second=await action(db,'timeWrite',{operation:'comment',entryId:current.id,version:2,comment:'Jeg sluttede kl. 15.'},employee);assert.equal(second.status,200);assert.equal(second.body.entry.comment,comment+'\n\nJeg sluttede kl. 15.');
  const approved=await action(db,'timeWrite',{operation:'approve',entryId:current.id,version:3});assert.equal(approved.status,200);
  assert.equal((await action(db,'timeWrite',{operation:'comment',entryId:current.id,version:4,comment:'Efter godkendelse'},employee)).status,409);
  db.sqlite.close();
});

test('even plan-matching hours with an employee comment require individual review before approval',async()=>{
  const {db}=await setup();const registered=await clockRegistration(db);const id=registered.id;
  const explained=await action(db,'timeWrite',{operation:'comment',entryId:id,version:registered.version,comment:'Kontrollér venligst min stempling.'},employee);assert.equal(explained.status,200,JSON.stringify(explained));
  const entry=explained.body.entry,result=Time.review(entry,{shift:{id:'t1',person:people[0].id,date:'2026-10-26',site:0,start:'07:00',end:'15:00'}});assert.equal(result.bucket,'attention');assert.ok(result.reasons.some(reason=>reason.code==='employee_comment'));
  const quick=await action(db,'timeWrite',{operation:'approve',entryId:id,version:entry.version,onlyIfMatchesPlan:true});assert.equal(quick.status,409);
  const manual=await action(db,'timeWrite',{operation:'approve',entryId:id,version:entry.version});assert.equal(manual.status,200);db.sqlite.close();
});

test('employee checkout stores an optional long comment with server-owned clock points',async()=>{
 const {db}=await setup(),comment='Jeg mødte til tiden, men glemte at stemple ind.\n'+'Praktiske oplysninger. '.repeat(1000),recorded=await clockRegistration(db,{principal:employee,comment});
 assert.equal(recorded.start,'07:00');assert.equal(recorded.end,'15:00');assert.equal(recorded.comment,comment.trim());assert.equal(recorded.status,'submitted');assert.equal(recorded.audit.at(-1).operation,'finish');assert.equal(recorded.audit.at(-1).actor.userId,employee.id);assert.equal(recorded.audit.at(-1).after.comment,comment.trim());assert.ok(recorded.flags.includes('employee_comment'));
 const readOwn=await read(db,employee);assert.equal(readOwn.body.entries[0].comment,comment.trim());assert.equal(readOwn.body.entries[0].payroll,undefined);
 assert.equal((await action(db,'timeWrite',{operation:'submit',entryId:recorded.id,version:recorded.version},employee)).status,403);db.sqlite.close();
});

test('submitted cancelled shifts retain their captured assignment, approval and immutable wage receipt',async()=>{
 const {db,workspace}=await setup();await configure(db,workspace);const registered=(await correct(db)).body.entry;
 const saved=await Store.readStudio(db,owner.id);saved.studio.deleted.push('t1');
 const response=await Workspace.handleWorkspaceStudioRequest(request('/api/studio','PUT',{revision:saved.revision,studio:saved.studio,publication:{from:'2026-10-26',to:'2026-11-01',siteIds:[0],includeDependencies:true}}),db);
 assert.equal(response.status,200,JSON.stringify(await response.json()));
 const approved=await action(db,'timeWrite',{operation:'approve',entryId:registered.id,version:registered.version});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.personId,people[0].id);assert.equal(approved.body.entry.frozenShift.start,'07:00');assert.equal(approved.body.entry.payroll.baseCents,148500);
 const own=await read(db,employee);assert.ok(own.body.shifts.some(shift=>shift.id==='t1'&&shift.recovered&&shift.cancelled));assert.equal(own.body.entries[0].payroll,undefined);
 const receipt=approved.body.entry.payroll;db.sqlite.prepare('UPDATE workspace_payroll SET config = ?,version = version + 1 WHERE person_id = ?').run(JSON.stringify(rates(30000)),people[0].id);assert.deepEqual((await read(db)).body.entries[0].payroll,receipt);db.sqlite.close();
});

test('a legacy reassigned or cancelled running shift is reachable outside the current month and can finish for its original employee',async()=>{
 for(const cancel of [false,true]){
  const {db}=await setup(),NativeDate=global.Date;let instant='2026-10-26T06:00:00.000Z';global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant);}};
  try{
   const started=await action(db,'timeWrite',{operation:'start',shiftId:'t1',version:0},employee);assert.equal(started.status,200);
   const saved=await Store.readStudio(db,owner.id);if(cancel)saved.studio.deleted.push('t1');else saved.studio.edits.t1.person=people[1].id;
   // Simulate an already-existing legacy plan inconsistency, bypassing the new publication guard.
   const published=Publication.publish(saved.studio,{from:'2026-10-26',to:'2026-11-01',siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-10-26T06:30:00.000Z'}).studio;await Store.writeStudio(db,owner.id,saved.revision,published);
   const recovery=await read(db,employee,{from:'2026-11-01',to:'2026-11-30'});assert.equal(recovery.status,200);assert.ok(recovery.body.entries.some(entry=>entry.id===started.body.entry.id));assert.ok(recovery.body.shifts.some(shift=>shift.id==='t1'&&shift.person===people[0].id&&shift.recovered));
   instant='2026-10-26T14:00:00.000Z';const finished=await action(db,'timeWrite',{operation:'finish',entryId:started.body.entry.id,version:started.body.entry.version},employee);assert.equal(finished.status,200,JSON.stringify(finished));assert.equal(finished.body.entry.personId,people[0].id);assert.equal(finished.body.entry.workedMinutes,480);
  }finally{global.Date=NativeDate;db.sqlite.close();}
 }
});

test('per-entry CAS preserves independent concurrent changes while a stale change of the same entry fails atomically',async()=>{
 const {db}=await setup(),first=(await correct(db)).body.entry;let concurrent;
 db.beforeBatch=async statements=>{if(statements.some(item=>item.sql.startsWith('UPDATE workspace_time_entries'))){db.beforeBatch=null;concurrent=await correct(db,{shiftId:'t2'});}};
 const outer=await action(db,'timeWrite',{operation:'comment',entryId:first.id,version:first.version,comment:'Min kommentar'},employee);assert.equal(concurrent.status,200);assert.equal(outer.status,200,JSON.stringify(outer));assert.equal((await read(db)).body.entries.length,2);
 db.beforeBatch=async statements=>{if(statements.some(item=>item.sql.startsWith('UPDATE workspace_time_entries'))){db.beforeBatch=null;concurrent=await action(db,'timeWrite',{operation:'comment',entryId:first.id,version:outer.body.entry.version,comment:'Vinder'},employee);}};
 const stale=await action(db,'timeWrite',{operation:'comment',entryId:first.id,version:outer.body.entry.version,comment:'Taber'},employee);assert.equal(concurrent.status,200);assert.equal(stale.status,409);const final=(await read(db,employee)).body.entries.find(entry=>entry.id===first.id);assert.ok(final.comment.includes('Vinder'));assert.equal(final.comment.includes('Taber'),false);db.sqlite.close();
});

test('simultaneous starts on different shifts are fenced by the atomic one-running-entry constraint',async()=>{
 const {db}=await setup(),saved=await Store.readStudio(db,owner.id);saved.studio.edits.t3={...saved.studio.edits.t3,date:'2026-10-26',start:'16:00',end:'20:00'};const published=Publication.publish(saved.studio,{from:'2026-10-26',to:'2026-11-01',siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-10-25T12:00:00.000Z'}).studio;await Store.writeStudio(db,owner.id,saved.revision,published);
 const NativeDate=global.Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-26T06:00:00.000Z']));}static now(){return NativeDate.parse('2026-10-26T06:00:00.000Z');}};let concurrent;
 try{
  db.beforeBatch=async statements=>{if(statements.some(item=>item.sql.startsWith('INSERT INTO workspace_time_entries'))){db.beforeBatch=null;concurrent=await action(db,'timeWrite',{operation:'start',shiftId:'t3',version:0},employee);}};
  const outer=await action(db,'timeWrite',{operation:'start',shiftId:'t1',version:0},employee);assert.equal(concurrent.status,200);assert.equal(outer.status,409);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM workspace_time_entries WHERE status IN ('running','paused')").get().n,1);
 }finally{global.Date=NativeDate;db.sqlite.close();}
});

test('legacy ledger migration preserves every entry and receipt, archives legacy events, and is idempotent',async()=>{
 const {db,workspace}=await setup();await configure(db,workspace);const record=(await correct(db)).body.entry,approved=await action(db,'timeWrite',{operation:'approve',entryId:record.id,version:record.version});assert.equal(approved.status,200);
 const original=JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_time_entries').get().config);delete original.audit[0].id;
 db.sqlite.prepare('DELETE FROM workspace_time_entries').run();db.sqlite.prepare('UPDATE workspace_timekeeping SET config = ?,version = 12,write_token = ?').run(JSON.stringify({schema:1,entries:[original],demo:null}),'legacy-token');
 const migrated=await read(db);assert.equal(migrated.status,200,JSON.stringify(migrated));assert.equal(migrated.body.entries.length,1);assert.deepEqual(migrated.body.entries[0].payroll,original.payroll);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,1);assert.equal(JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_timekeeping').get().config).schema,2);assert.ok(db.sqlite.prepare("SELECT COUNT(*) n FROM workspace_activity WHERE id LIKE 'legacy-time-%'").get().n>=1);
 const before=db.sqlite.prepare('SELECT config,version FROM workspace_timekeeping').get();assert.equal((await read(db)).status,200);assert.deepEqual(db.sqlite.prepare('SELECT config,version FROM workspace_timekeeping').get(),before);db.sqlite.close();
});

test('500-person reads share one payroll bundle and row storage grows beyond the old 10000-entry ledger limit',async()=>{
 const {db,workspace}=await setup(),saved=await Store.readStudio(db,owner.id);saved.studio.roster=[...people,...Array.from({length:498},(_,index)=>({...people[0],id:'person-scale-'+index,name:'Medarbejder '+index}))];await Store.writeStudio(db,owner.id,saved.revision,saved.studio);
 db.sqlite.prepare('INSERT INTO workspace_timekeeping VALUES (?,?,?,?,?)').run(workspace.id,JSON.stringify({schema:2,entries:[],demo:null}),1,'scale-header',new Date().toISOString());
 const insert=db.sqlite.prepare('INSERT INTO workspace_time_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let day=0;day<21;day++)for(const person of saved.studio.roster){const date=Time.addDays('2026-10-01',day),id='scale-'+day+'-'+person.id,entry={id,version:1,shiftId:id,personId:person.id,date,endDate:date,site:0,plannedStart:'07:00',plannedEnd:'08:00',start:'07:00',end:'08:00',plannedBreakMinutes:0,breakMinutes:0,breaks:[],breakAllocation:'end-of-shift',status:'submitted',demo:false,comment:'',audit:[]},interval=Time.absoluteInterval(entry);insert.run(workspace.id,id,id,person.id,date,date,entry.status,0,1,JSON.stringify(entry),'fixture','2026-11-02T12:00:00.000Z',interval.start,interval.end);}
 const batch=db.batch;let payrollQueries=0;db.batch=async statements=>{payrollQueries+=statements.filter(item=>/FROM workspace_payroll(?:\s|_policies)/.test(item.sql)).length;return batch(statements);};
 const everyone=await read(db,owner,{from:'2026-10-01',to:'2026-10-01'});assert.equal(everyone.status,200,JSON.stringify(everyone.body));assert.equal(everyone.body.entries.length,500);assert.equal(payrollQueries,3,'One policy/bytes/people batch, independent of the 500 DTOs.');
 let cursor=null,seen=[];do{const page=await read(db,owner,{from:'2026-10-01',to:'2026-10-21',personId:people[0].id,pageSize:5,...(cursor?{cursor}:{})});assert.equal(page.status,200);seen.push(...page.body.entries.map(entry=>entry.id));cursor=page.body.nextCursor;}while(cursor);assert.equal(seen.length,21);assert.equal(new Set(seen).size,21);
 const added=await correct(db,{shiftId:'t2'});assert.equal(added.status,200,JSON.stringify(added));assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,10501);assert.ok(db.sqlite.prepare('SELECT length(config) n FROM workspace_timekeeping').get().n<1000);db.sqlite.close();
});

test('resolved repeated and skipped local hours use UTC elapsed minutes and retain exact clocked pause allocation',()=>{
 const config={...rates(20000),supplements:[{id:'night',name:'Nattetillæg',type:'hourly',amountCents:1000,from:'2026-01-01',to:null,weekdays:[6],start:'02:00',end:'03:00'}]};
 const repeated={id:'repeat',personId:people[0].id,date:'2026-10-25',endDate:'2026-10-25',plannedStart:'01:30',plannedEnd:'03:30',start:'01:30',end:'03:30',status:'submitted',breakMinutes:45,breaks:[{start:150,end:195}],breakAllocation:'clocked',clockStartAt:'2026-10-24T23:30:00.000Z',clockEndAt:'2026-10-25T02:30:00.000Z',resolvedStartAt:'2026-10-24T23:30:00.000Z',resolvedEndAt:'2026-10-25T02:30:00.000Z',timingResolved:true};
 const receipt=Time.payroll(repeated,Groups.resolve({policy:null,personId:people[0].id,payroll:config,from:repeated.date,to:repeated.date}));assert.equal(Time.summary(repeated).workedMinutes,135);assert.equal(receipt.baseCents,45000);assert.equal(receipt.supplementCents,1250,'75 actual paid minutes in the repeated 02–03 supplement window.');
 const backwards={...repeated,start:'02:45',end:'02:15',breakMinutes:0,breaks:[],clockStartAt:'2026-10-25T00:45:00.000Z',clockEndAt:'2026-10-25T01:15:00.000Z',resolvedStartAt:'2026-10-25T00:45:00.000Z',resolvedEndAt:'2026-10-25T01:15:00.000Z'};assert.equal(Time.span(backwards).minutes,30);assert.deepEqual(Time.validate(backwards),[]);
 const spring={...repeated,date:'2026-03-29',endDate:'2026-03-29',end:'04:30',breakMinutes:0,breaks:[],resolvedStartAt:'2026-03-29T00:30:00.000Z',resolvedEndAt:'2026-03-29T02:30:00.000Z'};assert.equal(Time.span(spring).minutes,120);
 assert.equal(Time.instantForLocal('2026-03-29','02:30'),null);assert.equal(Time.instantForLocal('2026-10-25','02:30'),null);
});

test('byte-bounded pages preserve long comments and archived full audit while allowing later approval',async()=>{
 const {db,workspace}=await setup();await configure(db,workspace);const comment='🧽'.repeat(50000),record=(await correct(db,{comment})).body.entry;assert.ok(record, 'The full 100000-character comment remains supported.');
 const approved=await action(db,'timeWrite',{operation:'approve',entryId:record.id,version:record.version});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.comment,comment);assert.ok(db.sqlite.prepare('SELECT length(CAST(config AS BLOB)) n FROM workspace_time_entries').get().n<=512*1024);assert.equal(approved.body.entry.auditArchived,true);
 const archive=db.sqlite.prepare("SELECT entry FROM workspace_activity WHERE json_extract(entry,'$.timeEntryId') = ? AND json_extract(entry,'$.timeOperation') = 'approve'").get(record.id);assert.equal(JSON.parse(archive.entry).changes[0].after.comment,comment);
 const otherRecord=await correct(db,{shiftId:'t2',comment});assert.equal(otherRecord.status,200);
 const source=JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_time_entries WHERE id = ?').get(record.id).config),insert=db.sqlite.prepare('INSERT INTO workspace_time_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let index=0;index<6;index++){const copy={...source,id:'byte-'+index,shiftId:'byte-shift-'+index,audit:[]},interval=Time.absoluteInterval(copy);insert.run(workspace.id,copy.id,copy.shiftId,copy.personId,copy.date,copy.endDate,copy.status,0,copy.version,JSON.stringify(copy),'byte-fixture',copy.updatedAt,interval.start,interval.end);}
 const page=await read(db,owner,{pageSize:5000});assert.equal(page.status,200);assert.ok(page.body.entries.length>=1);assert.ok(page.body.nextCursor,'Long comments enforce a byte limit even before the row-count limit.');
 let cursor=page.body.nextCursor,all=[...page.body.entries];while(cursor){const following=await read(db,owner,{cursor});assert.equal(following.status,200);all.push(...following.body.entries);cursor=following.body.nextCursor;}assert.equal(all.length,8);assert.equal(new Set(all.map(entry=>entry.id)).size,8);assert.equal(all.find(entry=>entry.id===record.id).comment,comment);
 assert.equal((await read(db,owner,{cursor:'invalid cursor'})).status,400);db.sqlite.close();
});

test('a planner without payroll access gets the same public demo membership without reading private salary policies',async()=>{
 const {db,workspace}=await setup();await configure(db,workspace);const planner={id:'public-demo-planner',email:'public-planner@example.com'},role=await action(db,'createRole',{name:'Vagtplanlægger',permissions:['plan']});assert.equal(role.status,200);await join(db,planner,null,role.body.role.id);
 const batch=db.batch;let payrollQueries=0;db.batch=async statements=>{payrollQueries+=statements.filter(item=>/FROM workspace_payroll(?:\s|_policies)/.test(item.sql)).length;return batch(statements);};
 const demo=await action(db,'timeDemo',{operation:'load'},planner);assert.equal(demo.status,200,JSON.stringify(demo));assert.equal(demo.body.demo.personId,people[0].id);assert.equal(demo.body.canViewPayroll,false);assert.equal(payrollQueries,0);assert.equal(demo.body.entries.some(entry=>Object.hasOwn(entry,'payroll')||Object.hasOwn(entry,'approvalHistory')),false);db.sqlite.close();
});
