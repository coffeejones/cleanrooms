const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Planning=require('../src/planning-records.js');
const Departments=require('../src/department-model.js');
const Publication=require('../src/publication-model.js');
const owner={id:'planning-owner',email:'owner@example.com'},planner={id:'planning-colleague',email:'colleague@example.com'},worker={id:'planning-worker',email:'worker@example.com'};
const person='person-planning-001',other='person-planning-002';
const clone=value=>JSON.parse(JSON.stringify(value));
const shift=(id,patch={})=>({id,person,date:'2026-11-09',site:0,start:'07:00',end:'15:00',note:'',...patch});
const series=(id,patch={})=>({id,person,site:0,startDate:'2026-11-09',endDate:'2026-12-31',weekdays:[1,3],start:'07:00',end:'15:00',note:'',...patch});
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));
  const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{assert.ok(statements.every(item=>item.values.length<=100),'D1 parameter limit');await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const q=sqlite.prepare(sql);return q.columns().length?{results:q.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(q.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
  return db;
}
function request(method,body,actor=owner,endpoint='/api/studio'){return new Request('https://planning.example'+endpoint,{method,headers:{'oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email,'oai-authenticated-user-full-name':actor.id,...(method==='GET'?{}:{origin:'https://planning.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function api(db,method='GET',body,actor=owner){const response=await Workspace.handleWorkspaceStudioRequest(request(method,body,actor),db);return {status:response.status,body:await response.json()};}
async function account(db,action,payload={},actor=owner){const response=await Workspace.handleAccountsRequest(request('POST',{...payload,action},actor,'/api/accounts'),db);return {status:response.status,body:await response.json()};}
async function join(db,actor,roleId,personId=null){const invite=await account(db,'invite',{email:actor.email,roleId,personId});assert.equal(invite.status,200,JSON.stringify(invite));assert.equal((await account(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},actor)).status,200);}
async function setup(patch={}){
  const db=database(),roster=[person,other].map((id,index)=>({id,name:'Person '+index,initials:'P'+index,target:37,site:0,role:'Service',active:true}));
  const studio={storageVersion:1,demoSeed:false,roster,organization:Departments.defaultOrganization(),series:[],edits:{one:shift('one'),two:shift('two',{person:other})},deleted:[],weekPlans:{'0':{published:false,changes:0,baseline:[]}},requests:{},coverageRules:[],checklistProgress:{},...patch};
  await Store.writeStudio(db,owner.id,0,studio);const loaded=await api(db);assert.equal(loaded.status,200,JSON.stringify(loaded));return {db,loaded:loaded.body};
}
function command(base,next,extra={}){
  const changes=Planning.commands(base.studio,next,base.planning.versions),directoryChanged=['roster','organization'].some(field=>Planning.canonical(base.studio[field])!==Planning.canonical(next[field]));
  // Simulate a classic client explicitly editing directory aliases. Current
  // clients use /api/directory; the compatibility adapter still fences these.
  return {revision:base.revision,directoryRevision:base.directory?.revision??base.studio.directoryRevision,studio:{...Planning.payloadStudio(next),...(directoryChanged?{roster:clone(next.roster),organization:clone(next.organization)}:{})},planning:{version:1,changes,metadataChanged:directoryChanged||Planning.canonical(Planning.metadata(base.studio))!==Planning.canonical(Planning.metadata(next)),metadataBase:base.planning.metadataHash,dependencies:Planning.dependencies(base.studio,changes,base.planning.versions)},...extra};
}
async function save(db,base,change,actor=owner,extra={}){const next=clone(base.studio);change(next);return api(db,'PUT',command(base,next,extra),actor);}

test('API exposes server-owned row versions to planners while raw snapshots are only metadata',async()=>{
  const {db,loaded}=await setup();assert.equal(loaded.planning.schema,1);assert.equal(loaded.planning.versions[Planning.key('shift','one')],1);assert.equal(loaded.planning.records,undefined);
  const changed=await save(db,loaded,next=>{next.edits.one.note='Saved separately';});assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(changed.body.planning.versions[Planning.key('shift','one')],2);assert.equal(changed.body.planning.versions[Planning.key('shift','two')],1);
  const raw=await Store.readRawStudio(db,owner.id);assert.deepEqual(raw.studio.edits,{});assert.deepEqual(raw.studio.series,[]);assert.equal((await api(db)).body.studio.edits.one.note,'Saved separately');
  await join(db,worker,'employee',person);const own=await api(db,'GET',undefined,worker);assert.equal(own.body.planning,undefined);assert.equal(own.body.studio,null);db.sqlite.close();
});

test('two planners can save different shifts in the SAME week from the same original revision',async()=>{
  const {db,loaded}=await setup();await join(db,planner,'planner');
  const a=await save(db,loaded,next=>{next.edits.one.note='Owner change';next.weekPlans['0'].changes++;});assert.equal(a.status,200,JSON.stringify(a));
  const b=await save(db,loaded,next=>{next.edits.two.note='Colleague change';next.weekPlans['0'].changes++;},planner);assert.equal(b.status,200,JSON.stringify(b));
  const actual=(await api(db)).body;assert.equal(actual.studio.edits.one.note,'Owner change');assert.equal(actual.studio.edits.two.note,'Colleague change');assert.equal(b.body.reconciledStudio.edits.one.note,'Owner change');assert.equal(actual.planning.versions[Planning.key('shift','one')],2);assert.equal(actual.planning.versions[Planning.key('shift','two')],2);assert.deepEqual(actual.studio.weekPlans['0'].baseline,[]);db.sqlite.close();
});

test('simultaneous disjoint commits retry atomically while same-record changes stay conflicts',async()=>{
  const {db,loaded}=await setup();let racing=false;
  db.beforeBatch=async statements=>{if(racing||!statements.some(item=>/UPDATE studio_states SET revision/.test(item.sql)))return;racing=true;db.beforeBatch=null;const peer=await save(db,loaded,next=>{next.edits.two.note='Concurrent peer';});assert.equal(peer.status,200,JSON.stringify(peer));};
  const own=await save(db,loaded,next=>{next.edits.one.note='Concurrent owner';});assert.equal(own.status,200,JSON.stringify(own));assert.equal(racing,true);
  const conflict=await save(db,loaded,next=>{next.edits.one.note='Stale overwrite';});assert.equal(conflict.status,409);assert.equal(conflict.body.error,'planning_record_changed');assert.ok(conflict.body.conflicts.some(item=>item.id==='one'));
  const state=(await api(db)).body;assert.equal(state.studio.edits.one.note,'Concurrent owner');assert.equal(state.studio.edits.two.note,'Concurrent peer');assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM workspace_activity WHERE kind='plan'").get().n,2);db.sqlite.close();
});

test('independent series edits succeed; parent changes fence stale single-occurrence exceptions',async()=>{
  const a=series('series-one'),b=series('series-two',{person:other});const {db,loaded}=await setup({series:[a,b]});
  assert.equal((await save(db,loaded,next=>{next.series[0].note='One';})).status,200);
  assert.equal((await save(db,loaded,next=>{next.series[1].note='Two';})).status,200);
  const stale=await save(db,loaded,next=>{const id='series-one@2026-11-10';next.edits[id]=shift(id,{date:'2026-11-10',seriesId:'series-one',note:'Based on old series'});});assert.equal(stale.status,409);assert.ok(stale.body.conflicts.some(item=>item.id==='series-one'));db.sqlite.close();
});

test('a new concurrent exception fences all-series edits without losing either party data',async()=>{
  const {db,loaded}=await setup({series:[series('series-main')]});const id='series-main@2026-11-10';
  assert.equal((await save(db,loaded,next=>{next.edits[id]=shift(id,{date:'2026-11-10',seriesId:'series-main',note:'New manual exception'});})).status,200);
  const stale=await save(db,loaded,next=>{next.series[0].start='08:00';});assert.equal(stale.status,409);assert.ok(stale.body.conflicts.some(item=>item.kind==='group'));
  assert.equal((await api(db)).body.studio.edits[id].note,'New manual exception');db.sqlite.close();
});

test('deletion tombstones prevent ABA overwrites and new-client versions never authorize old full snapshots',async()=>{
  const {db,loaded}=await setup();const removed=await save(db,loaded,next=>{delete next.edits.one;});assert.equal(removed.status,200);
  const after=(await api(db)).body;assert.equal(after.planning.versions[Planning.key('shift','one')],2);
  const recreated=await save(db,after,next=>{next.edits.one=shift('one',{note:'Recreated'});});assert.equal(recreated.status,200);
  assert.equal((await save(db,loaded,next=>{next.edits.one.note='Old';})).status,409);
  const legacy=clone(loaded.studio);legacy.edits.two.note='Legacy stale';assert.equal((await api(db,'PUT',{revision:loaded.revision,studio:legacy})).status,409);assert.equal((await api(db)).body.studio.edits.one.note,'Recreated');db.sqlite.close();
});

test('record-only saves preserve newer organization metadata and cannot smuggle private changes',async()=>{
  const {db,loaded}=await setup();await join(db,planner,'planner');
  assert.equal((await save(db,loaded,next=>{next.workspaceSettings={companyName:'Current company'};})).status,200);
  const requestBody=command(loaded,{...clone(loaded.studio),edits:{...loaded.studio.edits,two:{...loaded.studio.edits.two,note:'Safe'}}});requestBody.studio.workspaceSettings={companyName:'Forged company'};requestBody.studio.organization=clone(loaded.studio.organization);requestBody.studio.organization.sites[0].name='Forged site';
  const saved=await api(db,'PUT',requestBody,planner);assert.equal(saved.status,200,JSON.stringify(saved));const state=(await api(db)).body;assert.equal(state.studio.workspaceSettings.companyName,'Current company');assert.notEqual(state.studio.organization.sites[0].name,'Forged site');
  const meta=await save(db,loaded,next=>{next.workspaceSettings={companyName:'Stale company'};});assert.equal(meta.status,409);assert.equal(meta.body.error,'planning_metadata_changed');db.sqlite.close();
});

test('publication remains tied to the reviewed complete revision and materialized shift versions',async()=>{
  const {db,loaded}=await setup();const scope={from:'2026-11-09',to:'2026-11-15',siteIds:[0],includeDependencies:true};
  assert.equal((await save(db,loaded,next=>{next.edits.two.note='Unreviewed change';})).status,200);
  const stale=await api(db,'PUT',command(loaded,loaded.studio,{publication:scope}));assert.equal(stale.status,409);
  const latest=(await api(db)).body,published=await api(db,'PUT',command(latest,latest.studio,{publication:scope}));assert.equal(published.status,200,JSON.stringify(published));
  assert.equal(db.sqlite.prepare('SELECT version FROM workspace_published_shifts WHERE id=?').get('one').version,1);
  const state=(await api(db)).body;assert.equal(Publication.publishedShifts(state.studio).find(shift=>shift.id==='two').note,'Unreviewed change');const raw=await Store.readRawStudio(db,owner.id);assert.deepEqual(raw.studio.publications.slots,{});db.sqlite.close();
});

test('failed audit rolls back entity versions, header and publication state together',async()=>{
  const {db,loaded}=await setup();db.sqlite.exec("CREATE TRIGGER reject_plan_audit BEFORE INSERT ON workspace_activity BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  const result=await save(db,loaded,next=>{next.edits.one.note='Must not commit';});assert.equal(result.status,500);const current=(await api(db)).body;assert.equal(current.revision,loaded.revision);assert.equal(current.planning.versions[Planning.key('shift','one')],1);assert.equal(current.studio.edits.one.note,'');db.sqlite.close();
});

test('bulk changes use bounded parameter counts and only touched entity versions advance',async()=>{
  const edits=Object.fromEntries(Array.from({length:505},(_,index)=>{const id='shift-bulk-'+index;return [id,shift(id,{date:'2026-11-09'})];}));
  const {db,loaded}=await setup({edits});const result=await save(db,loaded,next=>{for(const shift of Object.values(next.edits))shift.note='Bulk update';});assert.equal(result.status,200,JSON.stringify(result));assert.equal(Object.values(result.body.planning.versions).filter(value=>value===2).length,505);db.sqlite.close();
});
