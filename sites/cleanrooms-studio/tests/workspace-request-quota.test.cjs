const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js');
const owner={id:'quota-owner',email:'owner@example.test'},one={id:'quota-one',email:'one@example.test'},two={id:'quota-two',email:'two@example.test'};
const hash=value=>createHash('sha256').update(value).digest('hex');
async function setup(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
 t.after(()=>sqlite.close());const db={sqlite,beforeBatch:null,failQuota:false,prepare:sql=>({bind:(...values)=>({sql,values})})};
 db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values},index)=>{if(db.failQuota&&index===2&&sql.includes('INSERT INTO workspace_mobile_auth_attempts')){db.failQuota=false;throw Error('Injected quota transaction failure');}const q=sqlite.prepare(sql);return q.columns().length?{results:q.all(...values)}:{meta:{changes:Number(q.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 const roster=[['p1','One'],['p2','Two']].map(([id,name])=>({id,name,initials:name[0],site:0,role:'Service',target:37,active:true}));
 const studio={storageVersion:1,demoSeed:false,roster,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[]};
 await Store.writeStudio(db,owner.id,0,studio);
 const call=async(action,payload={},actor=owner)=>{const response=await Workspace.handleAccountsRequest(new Request('https://quota.example/api/accounts',{method:'POST',headers:{origin:'https://quota.example','content-type':'application/json','oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email},body:JSON.stringify({action,...payload})}),db);return{status:response.status,body:await response.json(),retry:response.headers.get('retry-after'),requestId:response.headers.get('x-request-id')};};
 assert.equal((await call('timeRead',{from:'2026-11-02',to:'2026-11-08'})).status,200);
 const workspaceId=sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner.id).id;
 for(const [actor,personId]of [[one,'p1'],[two,'p2']]){const invite=await call('invite',{email:actor.email,roleId:'employee',personId});assert.equal(invite.status,200,JSON.stringify(invite));assert.equal((await call('acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},actor)).status,200);}
 const room=await call('chatCreate',{departmentId:'dep-nord',name:'Private team'});assert.equal(room.status,200,JSON.stringify(room));return{db,sqlite,workspaceId,call,room:room.body.room,studio};
}

test('private web action quotas isolate callers and rejected-user spam cannot consume company capacity',async t=>{
 const {call,sqlite,workspaceId,room}=await setup(t);
 for(let index=0;index<30;index++){const sent=await call('chatSend',{roomId:room.id,clientId:'one-'+index,text:'En kort besked'},one);assert.equal(sent.status,200,JSON.stringify(sent));}
 for(let index=0;index<20;index++){const rejected=await call('chatSend',{roomId:room.id,clientId:'blocked-'+index,text:'Afvist'},one);assert.equal(rejected.status,429);assert.equal(rejected.retry,'60');assert.match(rejected.requestId,/^[a-f0-9-]{36}$/);assert.equal(rejected.body.requestId,rejected.requestId);}
 const shared=hash(`web-action:v1:${workspaceId}:chat-send`);assert.equal(sqlite.prepare('SELECT attempts FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(shared).attempts,30);
 assert.equal((await call('chatSend',{roomId:room.id,clientId:'two-first',text:'Anden medarbejder'},two)).status,200);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages WHERE workspace_id=?').get(workspaceId).n,31);
});

test('expensive web reads are bounded while time mutations and independent tenants do not share those limits',async t=>{
 const {call,sqlite,workspaceId,studio,db}=await setup(t),scope=hash(`web-action:v1:${workspaceId}:${owner.id}:time-read`);
 sqlite.prepare('UPDATE workspace_mobile_auth_attempts SET attempts=90 WHERE scope_hash=?').run(scope);
 const blocked=await call('timeRead',{from:'2026-11-02',to:'2026-11-08'});assert.equal(blocked.status,429);assert.equal(blocked.retry,'60');
 const mutation=await call('timeWrite',{operation:'finish',shiftId:'does-not-exist',version:0});assert.notEqual(mutation.status,429,'Clock-out may not be blocked by exhausted read allowance');
 assert.equal((await call('workflowRead',{from:'2026-11-02',to:'2026-11-08'})).status,200,'An unrelated budget remains available');
 const foreign={id:'quota-foreign-owner',email:'foreign@example.test'};await Store.writeStudio(db,foreign.id,0,studio);
 assert.equal((await call('timeRead',{from:'2026-11-02',to:'2026-11-08',workspaceId},foreign)).status,200,'Client workspace selection cannot select the first tenant quota');
});

test('quota reservation rollback and a concurrently revoked member leave no counters or business writes',async t=>{
 const {call,sqlite,workspaceId,db,room}=await setup(t),personal=hash(`web-action:v1:${workspaceId}:${one.id}:chat-send`);
 db.failQuota=true;const failed=await call('chatSend',{roomId:room.id,clientId:'rolled-back',text:'Never committed'},one);assert.equal(failed.status,500);
 assert.equal(sqlite.prepare('SELECT * FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(personal),undefined);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages WHERE workspace_id=?').get(workspaceId).n,0);
 assert.equal((await call('chatSend',{roomId:room.id,clientId:'after-rollback',text:'Committed normally'},one)).status,200);
 let revoked=false;db.beforeBatch=statements=>{if(!revoked&&statements.some(item=>item.sql.includes('INSERT INTO workspace_mobile_auth_attempts'))){revoked=true;sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE workspace_id=? AND user_id=?").run(workspaceId,two.id);}};
 const denied=await call('chatSend',{roomId:room.id,clientId:'revoked',text:'Denied'},two);assert.ok(revoked);assert.equal(denied.status,403,JSON.stringify(denied));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages WHERE workspace_id=?').get(workspaceId).n,1);
});


test('payroll preview and closing share a bounded company budget, independently of clocking and full-file export pages',async t=>{
 const {call,sqlite,workspaceId}=await setup(t);
 const preview=await call('payrollPeriodRead',{});assert.equal(preview.status,200,JSON.stringify(preview));
 const personal=hash(`web-action:v1:${workspaceId}:${owner.id}:payroll-period`),shared=hash(`web-action:v1:${workspaceId}:payroll-period`);
 assert.equal(sqlite.prepare('SELECT attempts FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(personal).attempts,1);
 sqlite.prepare('UPDATE workspace_mobile_auth_attempts SET attempts=30 WHERE scope_hash=?').run(personal);
 for(const action of ['payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen']){const result=await call(action,{});assert.equal(result.status,429,action);assert.equal(result.retry,'60');}
 assert.equal(sqlite.prepare('SELECT attempts FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(shared).attempts,1,'personal exhaustion does not spend company capacity');
 const clock=await call('timeWrite',{operation:'finish',shiftId:'missing',version:0});assert.notEqual(clock.status,429);
 const read=await call('timeRead',{from:'2026-11-02',to:'2026-11-08'});assert.equal(read.status,200);
 const payload={from:preview.body.from,to:preview.body.to,revision:1,limit:500};
 for(let index=0;index<300;index++){const page=await call('payrollPeriodExport',payload);assert.notEqual(page.status,429,'up to300 bounded pages remain available independently of the exhausted preview allowance');}
 const blocked=await call('payrollPeriodExport',payload);assert.equal(blocked.status,429);assert.equal(blocked.retry,'60');
});

test('forbidden payroll callers cannot consume another payroll users company budget and tenants remain isolated',async t=>{
 const {call,sqlite,workspaceId,db,studio}=await setup(t);
 const preview=await call('payrollPeriodRead',{});assert.equal(preview.status,200);
 const shared=hash(`web-action:v1:${workspaceId}:payroll-period`);
 for(let i=0;i<40;i++){assert.equal((await call('payrollPeriodRead',{},one)).status,403);assert.equal((await call('payrollPeriodClose',{},one)).status,403);}
 assert.equal(sqlite.prepare('SELECT attempts FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(shared).attempts,1);
 const unprivileged=hash(`web-action:v1:${workspaceId}:${one.id}:payroll-period`);assert.equal(sqlite.prepare('SELECT attempts FROM workspace_mobile_auth_attempts WHERE scope_hash=?').get(unprivileged),undefined);
 sqlite.prepare('UPDATE workspace_mobile_auth_attempts SET attempts=120 WHERE scope_hash=?').run(shared);assert.equal((await call('payrollPeriodRead',{})).status,429);
 const foreign={id:'quota-other-payroll-owner',email:'other-payroll@example.test'};await Store.writeStudio(db,foreign.id,0,studio);assert.equal((await call('payrollPeriodRead',{},foreign)).status,200);
});
