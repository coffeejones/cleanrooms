const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Auth=require('../lib/mobile-auth-store.mjs');
const {readMobileCompanySettings}=require('../lib/mobile-company-settings.mjs');
const {handleMobileAuthRequest}=require('../lib/mobile-auth-route.mjs');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const gatewayKey='a'.repeat(64);

function request(actor,method='GET',payload){
  return new Request('https://company.example/api/studio',{method,headers:{
    'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test',
    ...(method==='GET'?{}:{origin:'https://company.example','content-type':'application/json'}),
  },...(payload===undefined?{}:{body:JSON.stringify(payload)})});
}
async function setup(t){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const db={beforeBatch:null,queries:[],prepare:sql=>({bind:(...values)=>({sql,values})}),async batch(statements){
    await this.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');
    try{const result=statements.map(({sql,values})=>{this.queries.push(sql);const q=sqlite.prepare(sql);return q.columns().length?{results:q.all(...values)}:{meta:{changes:Number(q.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  t.after(()=>sqlite.close());
  async function company(actor,startDay){
    const personId='person-'+actor,studio={storageVersion:1,demoSeed:false,series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[],
      roster:[{id:personId,name:'Employee '+actor,initials:'EA',target:37,site:0,role:'Service',active:true}],organization:Departments.defaultOrganization(),
      workspaceSettings:{companyName:'Private '+actor,...(startDay===undefined?{}:{payrollPeriod:{startDay}})}};
    assert.equal((await Store.writeStudio(db,actor,0,studio)).ok,true);
    const load=async()=>{const response=await Workspace.handleWorkspaceStudioRequest(request(actor),db);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const loaded=await load(),workspaceId=loaded.workspace.id;
    const issued=await Auth.issueMobileCredential({db,workspaceId,personId,email:actor+'-employee@example.test',actorGuard:{sql:'1=1',values:[]},expectedVersion:0});
    const login=await Auth.loginMobile({db,email:actor+'-employee@example.test',password:issued.temporaryPassword});
    const session=await Auth.readMobileSession({db,token:login.token});
    const save=async(revision,next)=>Workspace.handleWorkspaceStudioRequest(request(actor,'PUT',{revision,studio:next}),db);
    return {actor,workspaceId,personId,token:login.token,session,loaded,load,save};
  }
  const own=await company('company-period-own');
  return {db,sqlite,company,own};
}
function api(db,token,payload,key=gatewayKey){
  return handleMobileAuthRequest(new Request('https://company.example/api/mobile-auth',{method:'POST',headers:{
    'content-type':'application/json','x-cleanrooms-gateway-key':key,...(token?{authorization:'Bearer '+token}:{}),
  },body:JSON.stringify(payload)}),db,gatewayKey);
}

test('company period roundtrips through web CAS and the native response stays minimal',async t=>{
  const {db,sqlite,own}=await setup(t);
  const historical={id:'approved-before-period-change',shiftId:'historical-shift',personId:own.personId,date:'2026-10-05',start:'08:00',end:'16:00',status:'approved',version:2,
    payroll:{total:1400,base:1400,supplement:0,policyVersion:4,personVersion:2}};
  sqlite.prepare(`INSERT INTO workspace_time_entries(workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at)
    VALUES(?,?,?,?,?,?,'approved',0,2,?,'historical-token','2026-10-05T18:00:00Z')`).run(own.workspaceId,historical.id,historical.shiftId,own.personId,historical.date,historical.date,JSON.stringify(historical));
  const snapshot=sqlite.prepare('SELECT * FROM workspace_time_entries WHERE workspace_id=?').get(own.workspaceId);
  const initial=await readMobileCompanySettings(db,own.token,own.session);
  assert.deepEqual(initial,{version:own.loaded.revision,payrollPeriod:{startDay:26}});
  const updated={...own.loaded.studio,workspaceSettings:{companyName:'Private company-period-own',payrollPeriod:{startDay:31}}};
  const saved=await own.save(own.loaded.revision,updated);assert.equal(saved.status,200,await saved.clone().text());
  const loaded=await own.load();assert.deepEqual(loaded.studio.workspaceSettings.payrollPeriod,{startDay:31});
  assert.equal((await own.save(own.loaded.revision,{...updated,workspaceSettings:{payrollPeriod:{startDay:1}}})).status,409);
  const legacy={...loaded.studio,workspaceSettings:{companyName:'Renamed by older client'}};
  assert.equal((await own.save(loaded.revision,legacy)).status,200);
  const response=await api(db,own.token,{action:'employeeCompanySettings'});assert.equal(response.status,200);
  const result=await response.json();assert.deepEqual(Object.keys(result).sort(),['payrollPeriod','version']);
  assert.deepEqual(result.payrollPeriod,{startDay:31});assert.ok(result.version>initial.version);
  assert.deepEqual(sqlite.prepare('SELECT * FROM workspace_time_entries WHERE workspace_id=?').get(own.workspaceId),snapshot);
  assert.equal(JSON.stringify(result).includes('Private'),false);
  db.queries=[];await readMobileCompanySettings(db,own.token,own.session);
  assert.equal(db.queries.some(sql=>/workspace_planning_records|workspace_published_shifts|workspace_payroll(?:\s|_)/.test(sql)),false);
});

test('a planner without company-settings permission cannot change the payroll period',async t=>{
  const {db,own}=await setup(t),planner='company-period-planner';
  const accounts=async(actor,payload)=>Workspace.handleAccountsRequest(request(actor,'POST',payload),db);
  const invited=await accounts(own.actor,{action:'invite',email:planner+'@example.test',roleId:'planner'});
  assert.equal(invited.status,200,await invited.clone().text());
  const invitation=await invited.json(),token=new URL(invitation.inviteUrl).searchParams.get('token');
  assert.equal((await accounts(planner,{action:'acceptInvite',token})).status,200);
  const response=await Workspace.handleWorkspaceStudioRequest(request(planner,'PUT',{revision:own.loaded.revision,
    studio:{...own.loaded.studio,workspaceSettings:{payrollPeriod:{startDay:1}}}}),db);
  assert.equal(response.status,403,await response.clone().text());
  assert.deepEqual((await readMobileCompanySettings(db,own.token,own.session)).payrollPeriod,{startDay:26});
});

test('company settings are session scoped, strict and inaccessible after revocation',async t=>{
  const {db,sqlite,company,own}=await setup(t),other=await company('company-period-other',1);
  assert.deepEqual((await readMobileCompanySettings(db,other.token,other.session)).payrollPeriod,{startDay:1});
  assert.deepEqual((await readMobileCompanySettings(db,own.token,own.session)).payrollPeriod,{startDay:26});
  await assert.rejects(readMobileCompanySettings(db,own.token,{...own.session,employee:other.session.employee}),{code:'mobile_session_invalid'});
  assert.equal((await api(db,null,{action:'employeeCompanySettings'})).status,401);
  assert.equal((await api(db,own.token,{action:'employeeCompanySettings',workspaceId:other.workspaceId})).status,400);
  assert.equal((await api(db,own.token,{action:'employeeCompanySettings'},'b'.repeat(64))).status,404);
  sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=1 WHERE workspace_id=?').run(own.workspaceId);
  assert.equal((await api(db,own.token,{action:'employeeCompanySettings'})).status,401);
});

test('company settings fail closed if metadata or the employee session changes during the read',async t=>{
  const {db,sqlite,own}=await setup(t);let changed=false;
  db.beforeBatch=statements=>{if(!changed&&statements.some(row=>row.sql.includes('SELECT c.chunk_index'))){changed=true;sqlite.prepare('UPDATE studio_states SET write_token=? WHERE owner_id=?').run('raced-settings',own.actor);}};
  await assert.rejects(readMobileCompanySettings(db,own.token,own.session),{code:'employee_company_settings_changed'});
  db.beforeBatch=null;
  changed=false;db.beforeBatch=statements=>{if(!changed&&statements.some(row=>row.sql.includes('SELECT c.chunk_index'))){changed=true;sqlite.prepare('UPDATE workspace_mobile_credentials SET revoked_at=1 WHERE workspace_id=?').run(own.workspaceId);}};
  await assert.rejects(readMobileCompanySettings(db,own.token,own.session),{code:'mobile_session_invalid'});
});
