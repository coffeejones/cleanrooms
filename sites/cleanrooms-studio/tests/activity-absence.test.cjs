const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const owner={id:'owner',email:'owner@example.com'},employee={id:'employee',email:'employee@example.com'};
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  const directory=path.join(__dirname,'../drizzle');for(const file of fs.readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(directory,file),'utf8'));
  const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
const request=(url,method,body,principal=owner)=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id==='owner'?'Planlaegger':'Medarbejder',...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async response=>({status:response.status,body:await response.json()});
const plan=(db,method='GET',body,principal=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal),db);
const account=(db,action,payload={},principal=owner)=>Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal),db);
const state=async db=>Store.readStudio(db,owner.id);
const put=async(db,value,revision)=>json(await plan(db,'PUT',{revision,studio:value}));
async function setup(){
  const db=database(),studio={storageVersion:1,demoSeed:false,organization:Departments.defaultOrganization(),series:[],edits:{one:{id:'one',person:'p1',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:''}},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}};
  await Store.writeStudio(db,owner.id,0,studio);const result=await json(await plan(db));assert.equal(result.status,200);return {db,workspace:result.body.workspace};
}
async function joinEmployee(db){const invitation=await json(await account(db,'invite',{email:employee.email,roleId:'employee',personId:'p1'}));assert.equal(invitation.status,200);const token=new URL(invitation.body.inviteUrl).searchParams.get('token');assert.equal((await account(db,'acceptInvite',{token},employee)).status,200);}

test('absence rejection requires a reason and server owns the decision actor, timestamp and retained metadata',async()=>{
  const {db}=await setup();let current=await state(db);
  let next=structuredClone(current.studio);next.requests.b='rejected';
  const missing=await put(db,next,current.revision);assert.equal(missing.status,400);assert.equal(missing.body.error,'leave_reason_required');assert.equal((await state(db)).revision,current.revision);
  next.leaveDecisions={b:{status:'approved',reason:'Ikke muligt'}};assert.equal((await put(db,next,current.revision)).status,400);
  next.leaveDecisions.b={status:'rejected',reason:'  Der mangler en afløser.  ',decidedBy:{userId:'forged',name:'Fake'},decidedAt:'1900-01-01T00:00:00Z'};
  const saved=await put(db,next,current.revision);assert.equal(saved.status,200,JSON.stringify(saved.body));
  const decision=saved.body.leaveDecisions.b;assert.equal(decision.reason,'Der mangler en afløser.');assert.equal(decision.decidedBy.userId,owner.id);assert.notEqual(decision.decidedAt,'1900-01-01T00:00:00Z');
  const audit=saved.body.activity.at(-1);assert.equal(audit.recoverable,false);assert.deepEqual(audit.changes.find(c=>c.field==='requests').decision,decision);
  current=await state(db);delete current.studio.leaveDecisions;assert.equal((await put(db,current.studio,current.revision)).status,200);assert.deepEqual((await state(db)).studio.leaveDecisions.b,decision);
  current=await state(db);current.studio.leaveDecisions.b={status:'rejected',reason:'FORGED REWRITE'};assert.equal((await put(db,current.studio,current.revision)).status,200);assert.deepEqual((await state(db)).studio.leaveDecisions.b,decision);
  await joinEmployee(db);const own=await json(await plan(db,'GET',undefined,employee));assert.equal(own.status,200);assert.deepEqual(own.body.employee.leaveRequests.map(r=>r.id),['b']);assert.deepEqual(own.body.employee.leaveRequests[0].decision,decision);assert.equal(JSON.stringify(own.body.employee).includes('Alma'),false);
  db.sqlite.close();
});

test('approval needs no reason, old rejected status remains readable, and stale saves create no new audit',async()=>{
  const {db}=await setup();let current=await state(db);current.studio.requests.b='approved';
  const saved=await put(db,current.studio,current.revision);assert.equal(saved.status,200);assert.equal(saved.body.leaveDecisions.b.status,'approved');assert.equal(saved.body.leaveDecisions.b.reason,'');
  assert.equal((await put(db,current.studio,current.revision)).status,409);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_activity').get().n,1);
  current=await state(db);current.studio.requests.c='rejected';current.studio.leaveDecisions.c={status:'rejected',reason:'Ingen dækning'};assert.equal((await put(db,current.studio,current.revision)).status,200);
  current=await state(db);current.studio.requests.b='pending';assert.equal((await put(db,current.studio,current.revision)).status,200);
  assert.equal((await state(db)).studio.leaveDecisions.c.reason,'Ingen dækning');db.sqlite.close();
});

test('durable audit outlives the recovery cache and keyset pages, person/area/actor/date filters stay workspace-scoped',async()=>{
  const {db}=await setup();
  for(let i=0;i<112;i++){const current=await state(db);current.studio.edits.one.note='Revision '+i;assert.equal((await put(db,current.studio,current.revision)).status,200);}
  const current=await state(db);assert.equal(current.studio.activity.length,100);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_activity').get().n,112);
  const ids=[];let cursor=null;do{const page=await json(await account(db,'activityRead',{limit:23,...(cursor?{cursor}:{})}));assert.equal(page.status,200,JSON.stringify(page.body));ids.push(...page.body.entries.map(e=>e.id));cursor=page.body.nextCursor;if(!page.body.hasMore)assert.equal(cursor,null);}while(cursor);
  assert.equal(ids.length,112);assert.equal(new Set(ids).size,112);
  const page=await json(await account(db,'activityRead',{filters:{personId:'p1',area:'planning',actorId:owner.id}}));assert.equal(page.status,200);assert.equal(page.body.entries.length,50);assert.equal(page.body.actors[0].userId,owner.id);
  const date=require('../src/timekeeping-model.js').localNow(new Date(page.body.entries[0].at)).date;assert.equal((await json(await account(db,'activityRead',{filters:{from:date,to:date}}))).body.entries.length,50);
  for(const filters of [{personId:'p2'},{area:'leave'},{actorId:'another-workspace'},{from:'1900-01-01',to:'1900-01-02'}])assert.deepEqual((await json(await account(db,'activityRead',{filters}))).body.entries,[]);
  assert.equal((await account(db,'activityRead',{cursor:'bad'})).status,400);assert.equal((await account(db,'activityRead',{filters:{from:'2026-02-31'}})).status,400);
  await joinEmployee(db);assert.equal((await account(db,'activityRead',{},employee)).status,403);
  db.sqlite.close();
});

test('legacy time audit imports idempotently, strips salary fields and survives ledger replacement',async()=>{
  const {db,workspace}=await setup(),audit={at:'2026-10-31T12:00:00.000Z',actor:{userId:owner.id,name:'Planlægger'},operation:'correct',reason:'Aftalt rettelse',before:{start:'08:22',end:'15:00',payroll:'SECRET SALARY'},after:{start:'08:00',end:'15:00',comment:'Glemte indstempling'},payroll:{salary:'SECRET SALARY'}};
  const document={schema:1,demo:null,entries:[{id:'legacy-one',personId:'p1',shiftId:'one',date:'2026-10-31',audit:[audit]}]};
  db.sqlite.prepare('INSERT INTO workspace_timekeeping (workspace_id,config,version,write_token,updated_at) VALUES (?,?,1,?,?)').run(workspace.id,JSON.stringify(document),'token',audit.at);
  const first=await json(await account(db,'activityRead',{filters:{kind:'time',personId:'p1',area:'time'}}));assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.entries.length,1);assert.equal(first.body.entries[0].timeOperation,'correct');assert.equal(JSON.stringify(first.body).includes('SECRET SALARY'),false);
  const second=await json(await account(db,'activityRead'));assert.equal(second.body.entries.length,1);assert.equal(second.body.entries[0].id,first.body.entries[0].id);
  db.sqlite.prepare('UPDATE workspace_timekeeping SET config=?,version=2 WHERE workspace_id=?').run(JSON.stringify({schema:1,entries:[],demo:null}),workspace.id);
  assert.equal((await json(await account(db,'activityRead'))).body.entries.length,1);db.sqlite.close();
});

test('an audit insertion failure rolls back plan revision and never leaves an untracked accepted edit',async()=>{
  const {db}=await setup(),current=await state(db);current.studio.edits.one.note='Do not commit';
  db.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON workspace_activity BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.equal((await put(db,current.studio,current.revision)).status,500);assert.equal((await state(db)).revision,current.revision);assert.equal((await state(db)).studio.edits.one.note,'');db.sqlite.close();
});

test('history date filters use Copenhagen days through spring and autumn DST changes',async()=>{
  const {db,workspace}=await setup(),Activity=require('../lib/activity-store.mjs');
  const stamps=['2026-10-24T22:15:00.000Z','2026-10-25T00:30:00.000Z','2026-10-25T01:30:00.000Z','2026-10-25T22:59:59.999Z','2026-10-25T23:00:00.000Z','2026-03-28T23:00:00.000Z','2026-03-29T21:59:59.999Z','2026-03-29T22:00:00.000Z'];
  await db.batch(Activity.archiveStatements({db,workspaceId:workspace.id,entries:stamps.map((at,i)=>({id:'date-'+i,at,actor:{userId:owner.id,name:'Planlægger'},kind:'time',summary:'Datoeksempel',personId:'p1',counts:{total:1},changes:[],recoverable:false,revision:0}))}));
  const autumn=await json(await account(db,'activityRead',{filters:{from:'2026-10-25',to:'2026-10-25'}}));assert.equal(autumn.status,200);assert.deepEqual(autumn.body.entries.map(e=>e.id).sort(),['date-0','date-1','date-2','date-3']);
  const spring=await json(await account(db,'activityRead',{filters:{from:'2026-03-29',to:'2026-03-29'}}));assert.equal(spring.status,200);assert.deepEqual(spring.body.entries.map(e=>e.id).sort(),['date-5','date-6']);db.sqlite.close();
});
