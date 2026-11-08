const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Publication=require('../src/publication-model.js');
const Departments=require('../src/department-model.js');
const Data=require('../src/studio-data.js');
const Payroll=require('../src/payroll-model.js');
const today=Data.todayFor(),add=(value,days)=>{const day=new Date(value+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);};
const owner={id:'history-owner',email:'owner@example.com'},person={id:'person-history',name:'Historik Test',initials:'HT',target:37,site:0,role:'Service',active:true};
const base=(patch={})=>({id:'old-rate',from:add(today,-60),type:'hourly',amountCents:18000,...patch});
const extra=(patch={})=>({id:'old-supplement',name:'Morgentillæg',from:add(today,-60),to:null,type:'hourly',amountCents:2000,weekdays:[0,1,2,3,4,5,6],start:'07:00',end:'09:00',...patch});
const config=()=>({currency:'DKK',agreements:[base()],supplements:[extra()]});
const future=(amount=19000)=>({...config(),agreements:[base(),base({id:'new-rate',from:add(today,1),amountCents:amount})]});
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
  return db;
}
const request=(url,method,body,principal=owner)=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const api=async(db,action,payload={},principal=owner)=>{const response=await Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal),db);return {status:response.status,body:await response.json()};};
const save=(db,payroll=config(),version=0,principal=owner,patch={})=>api(db,'payrollSave',{personId:person.id,version,payroll,...patch},principal);
const history=db=>db.sqlite.prepare('SELECT * FROM workspace_payroll_revisions ORDER BY version').all().map(row=>({...row,config:JSON.parse(row.config)}));
async function setup({published=false}={}){
  const db=database();let studio={storageVersion:1,demoSeed:false,roster:[person],organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{}};
  if(published){const date=add(today,-1),day=new Date(date+'T12:00:00Z').getUTCDay(),from=add(date,-((day+6)%7));studio.edits.history={id:'history',person:person.id,date,site:0,start:'07:00',end:'15:00',plannedBreakMinutes:30,note:''};studio=Publication.publish(studio,{from,to:add(from,6),siteIds:[0],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:new Date().toISOString()}).studio;}
  await Store.writeStudio(db,owner.id,0,studio);const response=await Workspace.handleWorkspaceStudioRequest(request('/api/studio','GET'),db);assert.equal(response.status,200);return {db,...await response.json(),studio};
}
async function manager(db){
  const principal={id:'history-manager',email:'manager@example.com'},created=await api(db,'createRole',{name:'Lønansvarlig',permissions:['plan','payroll.view','payroll.manage']});assert.equal(created.status,200);
  const invited=await api(db,'invite',{email:principal.email,roleId:created.body.role.id});assert.equal(invited.status,200);
  assert.equal((await api(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},principal)).status,200);return principal;
}

test('personal history is immutable without a policy and rejects base, allowance, deletion and backdated insertion changes',async()=>{
  const {db}=await setup();assert.equal((await save(db)).status,200);const before=history(db);
  for(const mutate of [value=>value.agreements[0].amountCents++,value=>value.agreements[0].from=add(today,-30),value=>value.agreements=[],value=>value.agreements.push(base({id:'backdated',from:add(today,-1)})),value=>value.supplements[0].amountCents++,value=>value.supplements[0].name='Changed',value=>value.supplements[0].weekdays=[0],value=>value.supplements[0].start='06:00',value=>value.supplements[0].to=add(today,-2),value=>value.supplements=[]]){
    const changed=config();mutate(changed);const rejected=await save(db,changed,1);assert.equal(rejected.status,400,JSON.stringify(changed));assert.equal(rejected.body.error,'historical_payroll_policy');
    assert.deepEqual(history(db),before);assert.equal(db.sqlite.prepare('SELECT version FROM workspace_payroll').get().version,1);
  }
  db.sqlite.close();
});

test('dated replacements preserve past salary and allowances while future setup stays editable and every saved version is retained',async()=>{
  const {db}=await setup();assert.equal((await save(db)).status,200);
  const candidate=future();candidate.supplements[0].to=add(today,-1);candidate.supplements.push(extra({id:'new-supplement',from:today,amountCents:3500}));
  const second=await save(db,candidate,1);assert.equal(second.status,200,JSON.stringify(second));assert.deepEqual(history(db).map(row=>row.version),[1,2]);
  const past=Payroll.estimate({config:config(),personId:person.id,month:add(today,-1).slice(0,7),shifts:[{id:'past',person:person.id,date:add(today,-1),site:0,start:'07:00',end:'15:00'}]}),after=Payroll.estimate({config:candidate,personId:person.id,month:past.month,shifts:past.shifts});assert.equal(past.totalCents,after.totalCents);
  for(let version=2;version<56;version++){candidate.agreements[1].amountCents++;assert.equal((await save(db,candidate,version)).status,200);}
  const revisions=history(db);assert.equal(revisions.length,56);assert.deepEqual(revisions[0].config,config());assert.equal(revisions[0].source,'save');assert.equal(revisions[0].actor_id,owner.id);assert.equal(revisions[0].actor_name,owner.id);assert.deepEqual(revisions.at(-1).config,Payroll.normalize(candidate));db.sqlite.close();
});

test('the first successful change archives a legacy snapshot with its original actor and time instead of inventing history',async()=>{
  const {db,workspace}=await setup(),recorded='2026-01-02T11:12:13.000Z';
  db.sqlite.prepare('INSERT INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspace.id,person.id,JSON.stringify(config()),7,'former-user',recorded,'legacy-token');
  assert.equal((await save(db,{...config(),agreements:[]},7)).status,400);assert.equal(history(db).length,0);
  assert.equal((await save(db,future(),7)).status,200);const rows=history(db);assert.deepEqual(rows.map(row=>row.version),[7,8]);assert.deepEqual(rows[0].config,config());assert.equal(rows[0].source,'legacy');assert.equal(rows[0].actor_id,'former-user');assert.equal(rows[0].actor_name,'Tidligere lønopsætning');assert.equal(rows[0].recorded_at,recorded);assert.equal(rows[1].actor_id,owner.id);db.sqlite.close();
});

test('concurrent payroll writes and revoked access cannot append an uncommitted or forged revision',async()=>{
  const {db}=await setup();await save(db);const principal=await manager(db);
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_payroll SET')))return;db.beforeBatch=null;assert.equal((await save(db,future(22000),1)).status,200);};
  const stale=await save(db,future(99900),1,principal,{actor:{userId:'forged',name:'Forged'},history:[{version:99}]});assert.equal(stale.status,409);assert.deepEqual(history(db).map(row=>row.version),[1,2]);assert.equal(history(db)[1].config.agreements[1].amountCents,22000);
  const before=history(db);db.beforeBatch=statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_payroll SET')))return;db.beforeBatch=null;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(principal.id);};
  assert.equal((await save(db,future(23000),2,principal)).status,403);assert.deepEqual(history(db),before);db.sqlite.close();
});

test('a failed history insert rolls back both personal pay and a linked policy change atomically',async()=>{
  const {db,workspace}=await setup(),policy={schema:1,groups:[{id:'group',name:'Daghold',archived:false,revisions:[{id:'first',from:today,payroll:{currency:'DKK',agreements:[base({from:today})],supplements:[]}}]}],links:[{personId:person.id,from:today,groupId:'group',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[]}]};
  db.sqlite.prepare('INSERT INTO workspace_payroll_policies VALUES (?,?,?,?,?,?,?)').run(workspace.id,JSON.stringify(policy),1,'[]',owner.id,new Date().toISOString(),'policy-token');
  db.sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON workspace_payroll_revisions BEGIN SELECT RAISE(ABORT,'simulated history storage failure'); END;");
  const failed=await save(db,{currency:'DKK',agreements:[base({id:'next',from:add(today,1)})],supplements:[]},0,owner,{policyVersion:1});assert.equal(failed.status,500);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,0);assert.equal(history(db).length,0);assert.equal(db.sqlite.prepare('SELECT version FROM workspace_payroll_policies').get().version,1);assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_payroll_policies').get().config),policy);db.sqlite.close();
});

test('a first personal allowance cannot retroactively alter existing group history',async()=>{
  const {db,workspace}=await setup(),from=add(today,-30),policy={schema:1,groups:[{id:'group',name:'Daghold',archived:false,revisions:[{id:'first',from,payroll:{currency:'DKK',agreements:[base({from})],supplements:[]}}]}],links:[{personId:person.id,from,groupId:'group',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[]}]};
  db.sqlite.prepare('INSERT INTO workspace_payroll_policies VALUES (?,?,?,?,?,?,?)').run(workspace.id,JSON.stringify(policy),1,'[]',owner.id,new Date().toISOString(),'policy-token');
  const failed=await save(db,{currency:'DKK',agreements:[],supplements:[extra()]},0,owner,{policyVersion:1});assert.equal(failed.status,400);assert.equal(failed.body.error,'historical_payroll_policy');assert.equal(history(db).length,0);db.sqlite.close();
});

test('future salary changes preserve approved receipts and reopening retains the original approval snapshot',async()=>{
  const {db}=await setup({published:true});await save(db);
  const date=add(today,-1),range={from:date,to:date},corrected=await api(db,'timeWrite',{...range,operation:'correct',shiftId:'history',version:0,start:'07:00',end:'15:00',breakMinutes:30,reason:'Aftalt rettelse'});assert.equal(corrected.status,200,JSON.stringify(corrected));
  const approved=await api(db,'timeWrite',{...range,operation:'approve',entryId:corrected.body.entry.id,version:corrected.body.entry.version});assert.equal(approved.status,200,JSON.stringify(approved));const receipt=structuredClone(approved.body.entry.payroll);
  assert.equal((await save(db,future(30000),1)).status,200);const read=await api(db,'timeRead',range);assert.deepEqual(read.body.entries[0].payroll,receipt);
  const reopened=await api(db,'timeWrite',{...range,operation:'reopen',entryId:approved.body.entry.id,version:approved.body.entry.version,reason:'Genåbnet til kontrol'});assert.equal(reopened.status,200,JSON.stringify(reopened));assert.deepEqual(reopened.body.entry.approvalHistory[0].snapshot,receipt);assert.equal(reopened.body.entry.approvedAt,null);
  db.sqlite.close();
});
