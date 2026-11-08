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
function command(base,next,extra={}){const changes=Planning.commands(base.studio,next,base.planning.versions);return {revision:base.revision,commandReceipt:'records',directoryRevision:base.directory?.revision,studio:Planning.payloadStudio(next),planning:{version:1,changes,metadataChanged:Planning.canonical(Planning.metadata(base.studio))!==Planning.canonical(Planning.metadata(next)),metadataBase:base.planning.metadataHash,dependencies:Planning.dependencies(base.studio,changes,base.planning.versions)},...extra};}
async function save(db,base,change,actor=owner,extra={}){const next=clone(base.studio);change(next);return api(db,'PUT',command(base,next,extra),actor);}

const Window=require('../src/planning-window.js');
const background={from:'2026-11-09',to:'2026-12-27'};
async function selected(db,projection,actor=owner){
  const collector=Window.collector(projection);let cursor;
  do{const params=new URLSearchParams({projection:projection.mode,selection:JSON.stringify(projection),...(cursor?{cursor}:{})});const res=await Workspace.handleWorkspaceStudioRequest(request('GET',undefined,actor,'/api/studio?'+params),db),page={...await res.json(),ok:res.ok};assert.equal(res.status,200,JSON.stringify(page));cursor=collector.add(page);}while(cursor);
  return collector.finish();
}

test('a selected series has complete own phases and exceptions, while other long descriptions remain read-only compact context',async()=>{
 const main=series('main',{groupId:'agreement'}),later=series('later',{groupId:'agreement',startDate:'2027-02-01',endDate:'2027-04-30',note:'FULL_OWN_FUTURE_INSTRUCTIONS'}),unrelated=series('other',{person:other,startDate:'2027-02-01',endDate:'2027-04-30',note:'UNRELATED_SECRET_DESCRIPTION'}),id='later@2027-02-02';
 const {db}=await setup({series:[main,later,unrelated],edits:{[id]:shift(id,{seriesId:'later',date:'2028-03-07',note:'OWN_DISTANT_EXCEPTION'})},deleted:['main@2026-12-01']});
 const projection={mode:'series',seriesId:'main',ranges:[{from:main.startDate,to:main.endDate}],calendar:background},loaded=await selected(db,projection);
 assert.equal(loaded.studio.series.find(row=>row.id==='later').note,later.note);assert.equal(loaded.studio.edits[id].note,'OWN_DISTANT_EXCEPTION');assert.ok(loaded.studio.deleted.includes('main@2026-12-01'));
 assert.ok(loaded.availability.series.some(row=>row.id==='other'));assert.equal(JSON.stringify(loaded.availability).includes('UNRELATED_SECRET_DESCRIPTION'),false);assert.equal(loaded.planning.versions[Planning.key('series','other')],undefined);
 const next=clone(loaded.studio);next.series.find(row=>row.id==='main').note='Scoped update';const saved=await api(db,'PUT',command(loaded,next,{projection}));assert.equal(saved.status,200,JSON.stringify(saved));assert.deepEqual(saved.body.planning.projection,projection);assert.equal(saved.body.recordPatch,true);assert.equal(saved.body.availability,undefined);assert.equal(saved.body.requiresRefresh,true);assert.equal((await api(db)).body.studio.series.find(row=>row.id==='other').note,unrelated.note);db.sqlite.close();
});

test('a new peer exception fences a series command from a partial selection',async()=>{
 const main=series('main',{groupId:'agreement'}),{db,loaded:full}=await setup({series:[main]});const projection={mode:'series',seriesId:'main',ranges:[],calendar:background},loaded=await selected(db,projection);
 assert.equal((await save(db,full,next=>{const id='main@2026-12-10';next.edits[id]=shift(id,{seriesId:'main',date:'2026-12-10',note:'Peer exception'});})).status,200);
 const next=clone(loaded.studio);next.series[0].note='Stale';const response=await api(db,'PUT',command(loaded,next,{projection}));assert.equal(response.status,409);assert.equal(response.body.studio,undefined);assert.equal((await api(db)).body.studio.series[0].note,'');db.sqlite.close();
});

test('a selected publication keeps review generation strict and never returns the full plan on conflict',async()=>{
 const {db,loaded:full}=await setup({edits:{one:shift('one'),remote:shift('remote',{date:'2028-07-03',note:'REMOTE_SECRET'})}}),scope={from:'2026-11-09',to:'2026-11-15',siteIds:[0],includeDependencies:true},projection={mode:'publication',...scope,calendar:background},loaded=await selected(db,projection);
 assert.equal(loaded.studio.edits.remote,undefined);assert.equal(JSON.stringify(loaded).includes('REMOTE_SECRET'),false);
 const malformed=await api(db,'PUT',command(loaded,loaded.studio,{projection,publication:{...scope,from:'bad'}}));assert.equal(malformed.status,400);
 assert.equal((await save(db,full,next=>{next.edits.remote.note='Remote peer';})).status,200);
 const stale=await api(db,'PUT',command(loaded,loaded.studio,{projection,publication:scope}));assert.equal(stale.status,409);assert.equal(stale.body.studio,undefined);
 const latest=await selected(db,projection),published=await api(db,'PUT',command(latest,latest.studio,{projection,publication:scope}));assert.equal(published.status,200,JSON.stringify(published));assert.deepEqual(published.body.planning.projection,projection);assert.equal(published.body.recordPatch,true);assert.equal(published.body.reconciledStudio,undefined);assert.deepEqual(published.body.reconciledRecords,[]);assert.equal((await api(db)).body.studio.edits.remote.note,'Remote peer');assert.equal(Publication.publishedShifts((await api(db)).body.studio).length,1);db.sqlite.close();
});

test('operation selectors reject ambiguous modes and cannot expose drafts to an employee',async()=>{
 const {db}=await setup({series:[series('main',{note:'DRAFT_SECRET'})]});
 for(const endpoint of ['/api/studio?projection=series&selection='+encodeURIComponent(JSON.stringify({mode:'series-list',calendar:background})),'/api/studio?projection=series-list&projection=publication&selection={}','/api/studio?projection=series-list&selection={bad']){const response=await Workspace.handleWorkspaceStudioRequest(request('GET',undefined,owner,endpoint),db);assert.equal(response.status,400);}
 await join(db,worker,'employee',person);const projection={mode:'series-list',calendar:background},res=await Workspace.handleWorkspaceStudioRequest(request('GET',undefined,worker,'/api/studio?'+new URLSearchParams({projection:'series-list',selection:JSON.stringify(projection)})),db),body=await res.json();assert.equal(res.status,200);assert.equal(body.studio,null);assert.equal(body.planning,undefined);assert.equal(JSON.stringify(body).includes('DRAFT_SECRET'),false);db.sqlite.close();
});
