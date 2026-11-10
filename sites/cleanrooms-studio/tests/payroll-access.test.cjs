const test=require('node:test');
const assert=require('node:assert/strict');

// Validate the authorization boundary token while comparing every domain field.
const domainBody=body=>{assert.match(body.accessIdentity,/^[a-f0-9]{64}$/);const {accessIdentity:_accessIdentity,...value}=body;return value;};
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const Roles=require('../src/role-model.js');
const Data=require('../src/studio-data.js');

function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  const dir=path.join(__dirname,'../drizzle');for(const file of fs.readdirSync(dir).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'));
  const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
  return db;
}
const owner={id:'pay-owner',email:'owner@example.com'},otherOwner={id:'other-owner',email:'other@example.com'};
const person={id:'person-alex',name:'Alex Hansen',initials:'AH',site:0,target:30,role:'Servicemedarbejder',active:true};
const studio=(changes={})=>({storageVersion:1,demoSeed:false,roster:[person],organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{},...changes});
const config=(amount=17550)=>({currency:'DKK',agreements:[{id:'private-agreement',from:'2026-10-01',type:'hourly',amountCents:amount}],supplements:[]});
const changedConfig=amount=>({...config(),agreements:[...config().agreements,{id:'new-agreement',from:Data.todayFor(),type:'hourly',amountCents:amount}]});
const request=(url,method,body,principal=owner,headers={})=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async response=>({status:response.status,body:await response.json()});
const action=(db,action,payload={},principal=owner,headers={})=>Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal,headers),db);
const plan=(db,method='GET',body,principal=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal),db);
async function setup(db=database(),principal=owner,value=studio()){await Store.writeStudio(db,principal.id,0,value);const read=await json(await plan(db,'GET',undefined,principal));assert.equal(read.status,200,JSON.stringify(read.body));return {db,...read.body};}
async function join(db,principal,grant){const invited=await json(await action(db,'invite',{email:principal.email,...grant}));assert.equal(invited.status,200,JSON.stringify(invited.body));const token=new URL(invited.body.inviteUrl).searchParams.get('token');const accepted=await json(await action(db,'acceptInvite',{token},principal));assert.equal(accepted.status,200,JSON.stringify(accepted.body));return accepted.body;}
async function roleMember(db,id,permissions){const created=await json(await action(db,'createRole',{name:id,permissions}));assert.equal(created.status,200,JSON.stringify(created.body));const principal={id,email:id+'@example.com'};await join(db,principal,{roleId:created.body.role.id});return {principal,role:created.body.role};}
const read=async(db,principal=owner,personId=person.id)=>json(await action(db,'payrollRead',{personId},principal));
const save=async(db,version,payroll=config(),principal=owner,personId=person.id)=>json(await action(db,'payrollSave',{personId,version,payroll},principal));
function noConfig(result){assert.equal(Object.hasOwn(result.body,'payroll'),false);assert.equal(Object.hasOwn(result.body,'studio'),false);assert.equal(JSON.stringify(result.body).includes('private-agreement'),false);}

test('payroll is durable per workspace/person and never changes the shared plan revision or history',async()=>{
  const {db,workspace}=await setup(),before=await Store.readStudio(db,owner.id);
  assert.deepEqual(domainBody((await read(db)).body),{personId:person.id,version:0,payroll:null,updatedAt:null,policyVersion:0,policy:{schema:1,groups:[],links:[]}});
  const saved=await save(db,0);assert.equal(saved.status,200);assert.equal(saved.body.version,1);assert.deepEqual(saved.body.payroll,config());assert.ok(saved.body.updatedAt);
  assert.deepEqual((await read(db)).body,saved.body);assert.deepEqual(await Store.readStudio(db,owner.id),before);
  const row=db.sqlite.prepare('SELECT * FROM workspace_payroll').get();assert.equal(row.workspace_id,workspace.id);assert.equal(row.person_id,person.id);assert.equal(row.updated_by,owner.id);assert.deepEqual(JSON.parse(row.config),config());assert.ok(row.write_token);
  const admin=(await json(await plan(db))).body;assert.equal(admin.capabilities.viewPayroll,true);assert.equal(admin.capabilities.managePayroll,true);assert.equal(JSON.stringify(admin.studio).includes('private-agreement'),false);
  const empty={currency:'DKK',agreements:[],supplements:[]};assert.equal((await save(db,1,empty)).status,400);assert.equal((await read(db)).body.version,1);assert.deepEqual((await save(db,1,changedConfig(19000))).body.payroll,changedConfig(19000));assert.equal((await read(db)).body.version,2);db.sqlite.close();
});

test('payroll read and manage are distinct delegated permissions and neither is implied by planning or account administration',async()=>{
  const {db}=await setup();await save(db,0);
  const viewer=await roleMember(db,'pay-viewer',['plan','payroll.view']),manager=await roleMember(db,'pay-manager',['plan','payroll.view','payroll.manage']),planner=await roleMember(db,'ordinary-planner',['plan']);
  assert.equal((await read(db,viewer.principal)).status,200);const denied=await save(db,1,config(19000),viewer.principal);assert.equal(denied.status,403);noConfig(denied);
  for(const principal of [planner.principal]){const denied=await read(db,principal);assert.equal(denied.status,403);noConfig(denied);}
  const accountManager=await roleMember(db,'account-manager',['users.manage','roles.manage']);const deniedManager=await read(db,accountManager.principal);assert.equal(deniedManager.status,403);noConfig(deniedManager);
  assert.equal((await save(db,1,changedConfig(19000),manager.principal)).status,200);
  const caps=(await json(await plan(db,'GET',undefined,viewer.principal))).body.capabilities;assert.equal(caps.viewPayroll,true);assert.equal(caps.managePayroll,false);assert.equal(caps.manageUsers,false);
  for(const permissions of [['payroll.view'],['payroll.manage'],['plan','payroll.manage']])assert.equal((await action(db,'createRole',{name:'Invalid',permissions})).status,400);
  assert.equal((await action(db,'createRole',{name:'Escalation',permissions:['plan','payroll.view','payroll.manage']},accountManager.principal)).status,403);db.sqlite.close();
});

test('trusted workspace membership and roster identity isolate records even when client ownership and role fields are forged',async()=>{
  const {db}=await setup();await save(db,0);await setup(db,otherOwner);
  const isolated=await json(await action(db,'payrollRead',{personId:person.id,workspaceId:'forged',ownerId:owner.id,role:'admin',capabilities:{managePayroll:true}},otherOwner));assert.equal(isolated.status,200);assert.equal(isolated.body.payroll,null);
  assert.equal((await save(db,0,config(25000),otherOwner)).status,200);assert.equal((await read(db)).body.payroll.agreements[0].amountCents,17550);assert.equal((await read(db,otherOwner)).body.payroll.agreements[0].amountCents,25000);
  const employee={id:'employee',email:'employee@example.com'};await join(db,employee,{roleId:'employee',personId:person.id});
  for(const actionName of ['payrollRead','payrollSave']){const denied=await json(await action(db,actionName,{personId:person.id,version:0,payroll:config(),role:'admin',permissions:Roles.PERMISSION_KEYS},employee));assert.equal(denied.status,403);noConfig(denied);}
  const unknown=await read(db,{id:'outsider',email:'outsider@example.com'});assert.equal(unknown.status,403);noConfig(unknown);
  assert.equal((await read(db,owner,'person-not-in-roster')).status,404);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,2);db.sqlite.close();
});

test('payroll optimistic concurrency returns the current record only to an authorized actor and does not create stale empty records',async()=>{
  const {db}=await setup();await save(db,0);const stale=await save(db,0,config(99900));assert.equal(stale.status,409);assert.equal(stale.body.version,1);assert.deepEqual(stale.body.payroll,config());
  assert.equal((await save(db,1,changedConfig(19000))).body.version,2);assert.equal((await read(db)).body.payroll.agreements.at(-1).amountCents,19000);
  const outsider=await roleMember(db,'no-pay-planner',['plan']);const denied=await save(db,0,config(),outsider.principal);assert.equal(denied.status,403);noConfig(denied);
  const {db:empty}=await setup();const mismatch=await save(empty,12);assert.equal(mismatch.status,409);assert.equal(mismatch.body.version,0);assert.equal(mismatch.body.payroll,null);assert.equal(empty.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,0);
  empty.sqlite.close();db.sqlite.close();
});

test('membership revocation and live role reductions fence payroll writes at the SQL commit, never returning private configuration',async()=>{
  for(const race of ['membership','role-version','live-permission']){
    const {db}=await setup();await save(db,0);const manager=await roleMember(db,'racing-manager',['plan','payroll.view','payroll.manage']);
    const before=db.sqlite.prepare('SELECT * FROM workspace_payroll').get(),memberVersion=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(manager.principal.id).version;
    db.beforeBatch=statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_payroll')))return;db.beforeBatch=null;if(race==='membership')db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(manager.principal.id);else db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+? WHERE id=?').run(JSON.stringify(['plan','payroll.view']),race==='role-version'?1:0,manager.role.id);};
    const denied=await save(db,1,changedConfig(99900),manager.principal);assert.equal(denied.status,403,race);noConfig(denied);assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_payroll').get(),before);
    if(race!=='membership')assert.equal(db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(manager.principal.id).version,memberVersion,'The role fence must not rely only on membership versions.');
    db.sqlite.close();
  }
});

test('read authorization is rechecked after storage access so a concurrently revoked viewer receives no payroll data',async()=>{
  const {db}=await setup();await save(db,0);const viewer=await roleMember(db,'revoked-viewer',['plan','payroll.view']);
  db.beforeBatch=statements=>{if(!statements.some(item=>item.sql.includes('FROM workspace_payroll WHERE')))return;db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run(JSON.stringify(['plan']),viewer.role.id);};
  const denied=await read(db,viewer.principal);assert.equal(denied.status,403);noConfig(denied);db.sqlite.close();
});

test('a concurrent roster removal fences the first payroll save and cannot create an orphan record',async()=>{
  const {db}=await setup(),before=await Store.readStudio(db,owner.id);
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_payroll')))return;db.beforeBatch=null;const removed=await plan(db,'PUT',{revision:before.revision,directoryRevision:before.directory.revision,studio:{...before.studio,roster:[]}});assert.equal(removed.status,200);};
  const conflict=await save(db,0);assert.equal(conflict.status,409);noConfig(conflict);assert.equal(conflict.body.error,'payroll_plan_changed');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,0);assert.deepEqual((await Store.readStudio(db,owner.id)).studio.roster,[]);db.sqlite.close();
});

test('payroll-linked identities can be archived but not removed, including a record added during the roster CAS',async()=>{
  const {db}=await setup();await save(db,0);let before=await Store.readStudio(db,owner.id);
  const blocked=await json(await plan(db,'PUT',{revision:before.revision,directoryRevision:before.directory.revision,studio:{...before.studio,roster:[]}}));assert.equal(blocked.status,400);assert.equal(blocked.body.error,'payroll_person_linked');assert.deepEqual(await Store.readStudio(db,owner.id),before);
  assert.equal((await plan(db,'PUT',{revision:before.revision,directoryRevision:before.directory.revision,studio:{...before.studio,roster:[{...person,active:false}]}})).status,200);assert.deepEqual((await read(db)).body.payroll,config());db.sqlite.close();
  const {db:racing}=await setup();before=await Store.readStudio(racing,owner.id);
  racing.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.includes('UPDATE studio_states SET revision')))return;racing.beforeBatch=null;assert.equal((await save(racing,0)).status,200);};
  const rejected=await json(await plan(racing,'PUT',{revision:before.revision,directoryRevision:before.directory.revision,studio:{...before.studio,roster:[]}}));assert.equal(rejected.status,409);assert.deepEqual(await Store.readStudio(racing,owner.id),before,'The committing roster SQL must see a concurrently created private pay record.');assert.equal((await read(racing)).body.version,1);racing.sqlite.close();
});

test('a read racing a roster change returns a retryable snapshot conflict without the configuration',async()=>{
  const {db}=await setup();await save(db,0);const before=await Store.readStudio(db,owner.id);
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.includes('FROM workspace_payroll WHERE')))return;db.beforeBatch=null;assert.equal((await plan(db,'PUT',{revision:before.revision,directoryRevision:before.directory.revision,studio:{...before.studio,roster:[{...person,name:'Alex Nyt Navn'}]}})).status,200);};
  const conflict=await read(db);assert.equal(conflict.status,409);assert.equal(conflict.body.error,'payroll_plan_changed');noConfig(conflict);
  assert.deepEqual((await read(db)).body.payroll,config());db.sqlite.close();
});

test('only the complete previous built-in admin is upgraded once; custom roles never gain payroll access automatically',async()=>{
  const {db}=await setup(),legacy=['plan','departments.manage','users.manage','roles.manage'];
  const custom=await roleMember(db,'legacy-full-custom',legacy),initial=db.sqlite.prepare("SELECT version FROM workspace_roles WHERE id='admin'").get().version;
  db.sqlite.prepare("UPDATE workspace_roles SET permissions=? WHERE id='admin' AND is_system=1").run(JSON.stringify([...legacy].reverse()));
  const upgraded=(await json(await plan(db))).body;assert.equal(upgraded.capabilities.managePayroll,true);assert.equal(upgraded.viewer.isOwner,true);
  assert.equal(db.sqlite.prepare("SELECT version FROM workspace_roles WHERE id='admin'").get().version,initial+1);await plan(db);assert.equal(db.sqlite.prepare("SELECT version FROM workspace_roles WHERE id='admin'").get().version,initial+1);
  const customRead=(await json(await plan(db,'GET',undefined,custom.principal))).body;assert.equal(customRead.capabilities.viewPayroll,false);assert.equal(customRead.capabilities.managePayroll,false);assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT permissions FROM workspace_roles WHERE id=?').get(custom.role.id).permissions),legacy);assert.equal((await read(db,custom.principal)).status,403);db.sqlite.close();
});

test('invalid payroll bodies and cross-origin requests cannot write configuration and oversized payroll actions never open storage',async()=>{
  const {db}=await setup();
  for(const payroll of [null,[],{...config(),currency:'EUR'},{...config(),unknown:'field'},config(-1),{...config(),agreements:[{...config().agreements[0],amountCents:1.5}]}])assert.equal((await save(db,0,payroll)).status,400,JSON.stringify(payroll));
  for(const version of [-1,0.5,'0',null,Number.MAX_SAFE_INTEGER])assert.equal((await save(db,version)).status,400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,0);
  let accessed=0;const unavailable=()=>{accessed++;throw Error('Must not access storage.');};
  assert.equal((await action(unavailable,'payrollSave',{personId:person.id,version:0,payroll:config()},owner,{origin:'https://evil.example'})).status,403);
  assert.equal((await action(unavailable,'payrollSave',{personId:person.id,version:0,payroll:config(),padding:'x'.repeat(Workspace.MAX_PAYROLL_BODY_BYTES)})).status,413);assert.equal(accessed,0);db.sqlite.close();
});

test('corrupt stored payroll fails closed instead of becoming a configured empty agreement',async()=>{
  const {db}=await setup();await save(db,0);const before=await Store.readStudio(db,owner.id),planner=await roleMember(db,'corruption-reader',['plan']);
  for(const serialized of ['null','[]','{"agreements":[{"id":"private-agreement"}]',JSON.stringify({...config(),currency:'EUR'})]){
    db.sqlite.prepare('UPDATE workspace_payroll SET config=?').run(serialized);
    const failed=await read(db);assert.equal(failed.status,500,serialized);assert.equal(failed.body.error,'invalid_payroll');noConfig(failed);assert.equal(Object.hasOwn(failed.body,'version'),false);
    const stored=db.sqlite.prepare('SELECT config,version FROM workspace_payroll').get();assert.equal(stored.config,serialized);assert.equal(stored.version,1,'A failed read must never rewrite or reset corrupt payroll.');
    assert.deepEqual(await Store.readStudio(db,owner.id),before);
    const denied=await read(db,planner.principal);assert.equal(denied.status,403);noConfig(denied,'Unauthorized callers cannot distinguish corrupt from valid pay records.');
  }
  db.sqlite.close();
});

test('shared snapshots, conflicts, history, employee projections and account lists never become payroll transport',async()=>{
  const privateConfig={...config(),agreements:[{...config().agreements[0],id:'NEVER-SHARE-PAYROLL'}]};
  const legacy=studio({payrollByPerson:{[person.id]:privateConfig},roster:[{...person,salary:privateConfig,metadata:{payroll:privateConfig}}]});
  const {db}=await setup(undefined,owner,legacy);await save(db,0,privateConfig);
  const employee={id:'projected-employee',email:'projected@example.com'};await join(db,employee,{roleId:'employee',personId:person.id});
  for(const response of [await plan(db),await plan(db,'GET',undefined,employee),await action(db,'list')])assert.equal(JSON.stringify(await response.json()).includes('NEVER-SHARE-PAYROLL'),false);
  const safe=(await json(await plan(db))).body.studio;
  for(const forged of [{...safe,payroll:privateConfig},{...safe,roster:[{...person,payrollConfig:privateConfig}]}]){const rejected=await json(await plan(db,'PUT',{revision:1,studio:forged}));assert.equal(rejected.status,400);noConfig(rejected);}
  const conflict=await json(await plan(db,'PUT',{revision:0,studio:safe}));assert.equal(conflict.status,409);assert.equal(JSON.stringify(conflict.body).includes('NEVER-SHARE-PAYROLL'),false);
  assert.equal((await action(db,'preferences',{preferences:{payroll:privateConfig}})).status,400);
  assert.equal((await plan(db,'PUT',{revision:1,studio:safe})).status,200);assert.equal(JSON.stringify((await Store.readStudio(db,owner.id)).studio).includes('NEVER-SHARE-PAYROLL'),false);
  assert.equal((await read(db)).body.payroll.agreements[0].id,'NEVER-SHARE-PAYROLL','A normal plan save must not erase the separately authorized record.');db.sqlite.close();
});
