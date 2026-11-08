const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js');
const owner={id:'audit-owner',email:'owner@example.com',name:'Planlaegger Anna'},worker={id:'audit-worker',email:'worker@example.com',name:'Maja Jensen'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,maxBindings:0,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{db.maxBindings=Math.max(db.maxBindings,values.length);assert.ok(values.length<=100,'D1 supports at most 100 bound parameters per statement');const q=sqlite.prepare(sql);return q.columns().length?{results:q.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(q.run(...values).changes)}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const request=(method,body,person=owner)=>new Request('https://cleanrooms.example/api/'+(method==='POST'?'accounts':'studio'),{method,headers:{'oai-authenticated-user-id':person.id,'oai-authenticated-user-email':person.email,'oai-authenticated-user-full-name':person.name,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async response=>{const r=await response;return {status:r.status,body:await r.json()};};
const action=(db,action,payload={},person=owner)=>json(Workspace.handleAccountsRequest(request('POST',{action,...payload},person),db));
const entries=db=>db.sqlite.prepare("SELECT entry FROM workspace_activity WHERE kind='access' ORDER BY rowid").all().map(row=>JSON.parse(row.entry));
async function setup(){const db=database(),studio={storageVersion:1,demoSeed:false,roster:[['p1','Maja'],['p2','Noah']].map(([id,name])=>({id,name,initials:name[0],active:true,site:0,target:37,role:'Service'})),organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}};await Store.writeStudio(db,owner.id,0,studio);const loaded=await json(Workspace.handleWorkspaceStudioRequest(request('GET'),db));assert.equal(loaded.status,200,JSON.stringify(loaded));return {db,workspaceId:loaded.body.workspace.id};}
async function role(db){const result=await action(db,'createRole',{name:'Teamleder',permissions:['plan'],actor:{userId:'forged',name:'Fake'}});assert.equal(result.status,200,JSON.stringify(result));return result.body.role;}
async function invite(db,person=worker,grant={roleId:'employee',personId:'p1'}){const result=await action(db,'invite',{email:person.email,name:person.name,...grant});assert.equal(result.status,200,JSON.stringify(result));return {...result.body,token:new URL(result.body.inviteUrl).searchParams.get('token')};}
async function join(db,grant={roleId:'employee',personId:'p1'}){const invitation=await invite(db,worker,grant),result=await action(db,'acceptInvite',{token:invitation.token},worker);assert.equal(result.status,200,JSON.stringify(result));return invitation;}
const changeFor=(all,id,summary)=>all.find(entry=>entry.summary===summary&&entry.changes.some(change=>change.id===id));

test('account and role audit records server actors and before/after without invitation or preference secrets',async()=>{
 const {db}=await setup(),created=await role(db),updated=await action(db,'updateRole',{roleId:created.id,version:created.version,name:'Lokal teamleder',permissions:['plan','departments.manage']});assert.equal(updated.status,200,JSON.stringify(updated));
 const invitation=await join(db,{roleId:created.id,personId:'p1'});db.sqlite.prepare('UPDATE workspace_members SET preferences=? WHERE user_id=?').run(JSON.stringify({search:'PRIVATE_PREFERENCE_SECRET'}),worker.id);
 const member=(await action(db,'list')).body.members.find(member=>member.userId===worker.id),changed=await action(db,'updateMember',{userId:worker.id,version:member.version,name:'Maja Ny',roleId:'employee',personId:'p1',status:'disabled'});assert.equal(changed.status,200,JSON.stringify(changed));
 const pending=await invite(db,{id:'unused',email:'pending@example.com',name:'Pending'},{roleId:'employee',personId:'p2'});assert.equal((await action(db,'revokeInvite',{inviteId:pending.invite.id,version:pending.invite.version})).status,200);
 const all=entries(db),creation=changeFor(all,created.id,'Rolle oprettet'),roleUpdate=changeFor(all,created.id,'Rollens rettigheder ændret'),memberUpdate=changeFor(all,worker.id,'Kontoadgang ændret'),revoked=changeFor(all,pending.invite.id,'Invitation tilbagekaldt');
 for(const entry of [creation,roleUpdate,memberUpdate,revoked]){assert.ok(entry);assert.deepEqual(entry.actor,{userId:owner.id,name:owner.name});assert.equal(entry.recoverable,false);assert.deepEqual(entry.areas,['access']);assert.ok(Number.isFinite(Date.parse(entry.at)));}
 assert.equal(creation.changes[0].before,null);assert.deepEqual(creation.changes[0].after.permissions,['plan']);assert.deepEqual(roleUpdate.changes[0].before.permissions,['plan']);assert.deepEqual(roleUpdate.changes[0].after.permissions,['plan','departments.manage']);
 assert.equal(memberUpdate.changes[0].before.status,'active');assert.equal(memberUpdate.changes[0].after.status,'disabled');assert.equal(memberUpdate.changes[0].before.roleId,created.id);assert.equal(memberUpdate.changes[0].after.roleId,'employee');assert.equal(memberUpdate.changes[0].after.version,member.version+1);assert.deepEqual(memberUpdate.personIds,['p1']);assert.equal(revoked.changes[0].before.status,'pending');assert.equal(revoked.changes[0].after.status,'revoked');
 const serialized=JSON.stringify(all),hashes=db.sqlite.prepare('SELECT token_hash FROM workspace_invites').all().map(row=>row.token_hash);for(const secret of [invitation.token,pending.token,invitation.inviteUrl,pending.inviteUrl,'PRIVATE_PREFERENCE_SECRET',...hashes])assert.equal(serialized.includes(secret),false,secret);assert.equal(serialized.includes('token_hash'),false);assert.equal(serialized.includes('preferences'),false);assert.equal(serialized.includes('forged'),false);db.sqlite.close();
});

test('access events remain in durable history after the plan recovery cache is emptied',async()=>{
 const {db}=await setup(),created=await role(db),before=entries(db),saved=await Store.readStudio(db,owner.id);saved.studio.activity=[];assert.equal((await Store.writeStudio(db,owner.id,saved.revision,saved.studio)).ok,true);
 const history=await action(db,'activityRead',{filters:{area:'access'},limit:100});assert.equal(history.status,200,JSON.stringify(history));assert.ok(history.body.entries.some(entry=>entry.id===changeFor(before,created.id,'Rolle oprettet').id));assert.deepEqual(entries(db),before);db.sqlite.close();
});

test('stale role/member/invitation versions and commit races create no phantom access audit',async()=>{
 for(const operation of ['updateRole','updateMember','revokeInvite']){
  const {db}=await setup();let payload,targetSql,targetValues,interception;
  if(operation==='updateRole'){const created=await role(db);payload={roleId:created.id,version:created.version,name:'Updated',permissions:['plan']};targetSql='UPDATE workspace_roles SET version=version+1 WHERE id=?';targetValues=[created.id];interception='UPDATE workspace_roles SET name';}
  if(operation==='updateMember'){await join(db);const member=(await action(db,'list')).body.members.find(member=>member.userId===worker.id);payload={userId:worker.id,version:member.version,name:'Updated'};targetSql='UPDATE workspace_members SET version=version+1 WHERE user_id=?';targetValues=[worker.id];interception='UPDATE workspace_members SET name';}
  if(operation==='revokeInvite'){const pending=await invite(db);payload={inviteId:pending.invite.id,version:pending.invite.version};targetSql='UPDATE workspace_invites SET version=version+1 WHERE id=?';targetValues=[pending.invite.id];interception="UPDATE workspace_invites SET status = 'revoked'";}
  const before=entries(db);let intercepted=false;db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes(interception))){intercepted=true;db.sqlite.prepare(targetSql).run(...targetValues);}};
  const result=await action(db,operation,payload);db.beforeBatch=null;assert.equal(result.status,409,JSON.stringify({operation,...result}));assert.ok(intercepted);assert.deepEqual(entries(db),before);assert.equal((await action(db,operation,payload)).status,409);assert.deepEqual(entries(db),before);db.sqlite.close();
 }
});

test('actor revocation at every account mutation commit fences both state and audit',async()=>{
 for(const operation of ['createRole','updateRole','invite','updateMember','revokeInvite']){
  const {db}=await setup();let payload,interception;
  if(operation==='createRole'){payload={name:'Forbidden role',permissions:['plan']};interception='INSERT INTO workspace_roles (workspace_id,id,name,permissions,version,is_system,created_at,updated_at)';}
  if(operation==='updateRole'){const created=await role(db);payload={roleId:created.id,version:created.version,name:'Forbidden edit',permissions:['plan']};interception='UPDATE workspace_roles SET name';}
  if(operation==='invite'){payload={email:'blocked@example.com',roleId:'employee',personId:'p2'};interception='INSERT INTO workspace_invites (id,workspace_id,email,name';}
  if(operation==='updateMember'){await join(db);const member=(await action(db,'list')).body.members.find(member=>member.userId===worker.id);payload={userId:worker.id,version:member.version,name:'Forbidden edit'};interception='UPDATE workspace_members SET name';}
  if(operation==='revokeInvite'){const pending=await invite(db);payload={inviteId:pending.invite.id,version:pending.invite.version};interception="UPDATE workspace_invites SET status = 'revoked'";}
  const before=entries(db);let intercepted=false;db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes(interception))){intercepted=true;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(owner.id);}};
  const result=await action(db,operation,payload);db.beforeBatch=null;assert.ok([403,409].includes(result.status),JSON.stringify({operation,...result}));assert.ok(intercepted,operation);assert.deepEqual(entries(db),before,operation);if(payload.roleId)assert.notEqual(db.sqlite.prepare('SELECT name FROM workspace_roles WHERE id=?').get(payload.roleId)?.name,'Forbidden edit');if(operation==='updateMember')assert.equal(db.sqlite.prepare('SELECT name FROM workspace_members WHERE user_id=?').get(worker.id).name,worker.name);if(operation==='revokeInvite')assert.equal(db.sqlite.prepare('SELECT status FROM workspace_invites WHERE id=?').get(payload.inviteId).status,'pending');db.sqlite.close();
 }
});

test('audit failure rolls back earlier access changes and a later member failure rolls back its preceding audit',async()=>{
 const {db}=await setup();const before=entries(db),roleCount=db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_roles').get().n;
 db.sqlite.exec("CREATE TRIGGER reject_access_audit BEFORE INSERT ON workspace_activity WHEN NEW.kind='access' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;");
 const failed=await action(db,'createRole',{name:'Must roll back',permissions:['plan']});assert.equal(failed.status,500);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_roles').get().n,roleCount);assert.deepEqual(entries(db),before);db.sqlite.exec('DROP TRIGGER reject_access_audit');
 await join(db);const member=(await action(db,'list')).body.members.find(member=>member.userId===worker.id),auditBefore=entries(db);db.sqlite.exec("CREATE TRIGGER reject_member_update BEFORE UPDATE OF name ON workspace_members WHEN NEW.name='FAIL_MEMBER' BEGIN SELECT RAISE(ABORT,'simulated member failure'); END;");
 const failure=await action(db,'updateMember',{userId:worker.id,version:member.version,name:'FAIL_MEMBER'});assert.equal(failure.status,500);assert.equal(db.sqlite.prepare('SELECT name FROM workspace_members WHERE user_id=?').get(worker.id).name,worker.name);assert.deepEqual(entries(db),auditBefore);db.sqlite.close();
});

test('a role with 500 assignees updates atomically with one audit and bounded D1 parameters',async()=>{
 const {db,workspaceId}=await setup(),created=await role(db),stamp=new Date().toISOString(),insert=db.sqlite.prepare("INSERT INTO workspace_members (user_id,workspace_id,email,name,role,role_id,manage_departments,person_id,status,version,preferences,created_at,updated_at) VALUES (?,?,?,?,'planner',?,0,NULL,'active',1,'{}',?,?)");
 db.sqlite.exec('BEGIN');for(let i=0;i<500;i++)insert.run('large-audit-'+i,workspaceId,'large-'+i+'@example.com','Worker '+i,created.id,stamp,stamp);db.sqlite.exec('COMMIT');const before=entries(db).length;
 const updated=await action(db,'updateRole',{roleId:created.id,version:created.version,name:'Shared role',permissions:['plan','departments.manage']});assert.equal(updated.status,200,JSON.stringify(updated));assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id=? AND role_id=? AND version=2 AND manage_departments=1').get(workspaceId,created.id).n,500);assert.equal(entries(db).length,before+1);assert.ok(db.maxBindings<=100);db.sqlite.close();
});

test('simultaneous acceptance of one invitation by the same identity records exactly one acceptance audit',async()=>{
 const {db}=await setup(),pending=await invite(db,worker,{roleId:'planner',personId:null});let winner;
 db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.includes("UPDATE workspace_invites SET status = 'accepted'")))return;db.beforeBatch=null;winner=await action(db,'acceptInvite',{token:pending.token},worker);assert.equal(winner.status,200,JSON.stringify(winner));};
 const loser=await action(db,'acceptInvite',{token:pending.token},worker);assert.equal(loser.status,409,JSON.stringify(loser));assert.equal(entries(db).filter(entry=>entry.summary==='Invitation accepteret').length,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE user_id=?').get(worker.id).n,1);db.sqlite.close();
});

test('an invitation creates and links a versioned employee using only the selected worksite',async t=>{
 const {db,workspaceId}=await setup();t.after(()=>db.sqlite.close());
 const listed=await action(db,'list');assert.equal(listed.status,200);
 const selected=listed.body.sites[1];assert.deepEqual(selected,{id:Departments.defaultOrganization().sites[1].id,name:Departments.defaultOrganization().sites[1].name,index:1});
 const readPlan=[];db.beforeBatch=statements=>{readPlan.push(...statements.filter(({sql})=>sql.includes('studio_state_chunks')));};
 const payload={roleId:'employee',email:worker.email,newEmployee:{name:'  Maja Jensen  ',site:selected.index}};
 const created=await action(db,'invite',payload);db.beforeBatch=null;
 assert.equal(created.status,200,JSON.stringify(created));assert.deepEqual(readPlan,[]);
 const {invite:pending,inviteUrl,createdEmployee,directory,records,workspace}=created.body;
 assert.equal(pending.personId,createdEmployee.id);assert.equal(pending.name,'Maja Jensen');assert.equal(createdEmployee.site,selected.index);assert.equal(createdEmployee.initials,'MJ');
 assert.equal(directory.schema,1);assert.equal(workspace.id,workspaceId);assert.equal(records.length,1);assert.equal(records[0].version,1);assert.deepEqual(records[0].value,createdEmployee);
 const refreshed=await action(db,'list');assert.ok(refreshed.body.staff.some(person=>person.id===createdEmployee.id));
 const retried=await action(db,'invite',payload);assert.equal(retried.status,409);assert.equal(retried.body.error,'invite_email_in_use');
 const accepted=await action(db,'acceptInvite',{token:new URL(inviteUrl).searchParams.get('token')},worker);assert.equal(accepted.status,200,JSON.stringify(accepted));assert.equal(accepted.body.viewer.personId,createdEmployee.id);
 const audit=changeFor(entries(db),pending.id,'Bruger inviteret');assert.deepEqual(audit.personIds,[createdEmployee.id]);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_directory_records WHERE kind='employee' AND workspace_id=?").get(workspaceId).n,3);
});

test('the inline invite requires directory edit permission and rejects invalid or ambiguous employee choices',async t=>{
 const {db,workspaceId}=await setup();t.after(()=>db.sqlite.close());
 const manager={id:'accounts-only-manager',email:'accounts-only@example.com',name:'Kontoadministrator'};
 const createdRole=await action(db,'createRole',{name:'Kun konti',permissions:['users.manage']});assert.equal(createdRole.status,200);
 const invitation=await invite(db,manager,{roleId:createdRole.body.role.id});
 assert.equal((await action(db,'acceptInvite',{token:invitation.token},manager)).status,200);
 assert.equal((await action(db,'list',{},manager)).body.sites,undefined);
 const payload={roleId:'employee',email:worker.email,newEmployee:{name:'Maja Jensen',site:0}};
 assert.equal((await action(db,'invite',payload,manager)).status,403);
 for(const malformed of [{...payload,personId:'p2'},{...payload,newEmployee:{name:' ',site:0}},{...payload,newEmployee:{name:'Maja Jensen',site:1999}},{...payload,roleId:'foreign-role'}])
   assert.equal((await action(db,'invite',malformed)).status,400);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_directory_records WHERE kind='employee' AND workspace_id=?").get(workspaceId).n,2);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_invites WHERE email=?').get(worker.email).n,0);
 assert.equal((await action(db,'invite',{roleId:'employee',email:worker.email,personId:'p2'},manager)).status,200);
});

test('reinviting after expiry or revocation reuses the existing employee instead of creating a duplicate',async t=>{
 for(const previousStatus of ['expired','revoked'])await t.test(previousStatus,async t=>{
   const {db,workspaceId}=await setup();t.after(()=>db.sqlite.close());
   const payload={roleId:'employee',email:worker.email,newEmployee:{name:'Maja Jensen',site:0}};
   const created=await action(db,'invite',payload);assert.equal(created.status,200,JSON.stringify(created));
   if(previousStatus==='expired')db.sqlite.prepare('UPDATE workspace_invites SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',created.body.invite.id);
   else assert.equal((await action(db,'revokeInvite',{inviteId:created.body.invite.id})).status,200);
   for(const newEmployee of [{name:'Andet navn',site:0},{name:'Maja Jensen',site:1}]){
     const mismatch=await action(db,'invite',{...payload,newEmployee});
     assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'invite_email_in_use');
   }
   const again=await action(db,'invite',{...payload,newEmployee:{name:'  MAJA JENSEN  ',site:0}});
   assert.equal(again.status,200,JSON.stringify(again));assert.equal(again.body.invite.personId,created.body.createdEmployee.id);
   assert.equal(again.body.createdEmployee,undefined);assert.notEqual(again.body.inviteUrl,created.body.inviteUrl);
   assert.equal((await action(db,'acceptInvite',{token:new URL(created.body.inviteUrl).searchParams.get('token')},worker)).status,410);
   const accepted=await action(db,'acceptInvite',{token:new URL(again.body.inviteUrl).searchParams.get('token')},worker);
   assert.equal(accepted.status,200);assert.equal(accepted.body.viewer.personId,created.body.createdEmployee.id);
   assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_directory_records WHERE kind='employee' AND workspace_id=?").get(workspaceId).n,3);
 });
});

test('a renewed invitation fences simultaneous retries and ambiguous prior employee links',async t=>{
 const {db,workspaceId}=await setup();t.after(()=>db.sqlite.close());
 const payload={roleId:'employee',email:worker.email,newEmployee:{name:'Maja Jensen',site:0}};
 const created=await action(db,'invite',payload);assert.equal(created.status,200);
 assert.equal((await action(db,'revokeInvite',{inviteId:created.body.invite.id})).status,200);
 const legacy=await invite(db,worker,{roleId:'employee',personId:'p2'});
 assert.equal((await action(db,'revokeInvite',{inviteId:legacy.invite.id})).status,200);
 assert.equal((await action(db,'invite',payload)).status,409);
 db.sqlite.prepare('DELETE FROM workspace_invites WHERE id=?').run(legacy.invite.id);
 const [first,second]=await Promise.all([action(db,'invite',payload),action(db,'invite',payload)]);
 assert.deepEqual([first.status,second.status].sort(),[200,409]);
 const winner=[first,second].find(result=>result.status===200);
 assert.equal(winner.body.createdEmployee,undefined);assert.equal(winner.body.invite.personId,created.body.createdEmployee.id);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_invites WHERE email=? AND status='pending'").get(worker.email).n,1);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_directory_records WHERE kind='employee' AND workspace_id=?").get(workspaceId).n,3);
});

test('standalone new-user invites reject linked people and duplicate email addresses',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 const payload={name:worker.name,email:worker.email,roleId:'planner',newUser:true};
 assert.equal((await action(db,'invite',{...payload,personId:'p1'})).status,400);
 const created=await action(db,'invite',payload);assert.equal(created.status,200);
 assert.equal(created.body.invite.personId,null);
 assert.equal((await action(db,'invite',payload)).status,409);
 const accepted=await action(db,'acceptInvite',{token:new URL(created.body.inviteUrl).searchParams.get('token')},worker);
 assert.equal(accepted.status,200);
 assert.equal((await action(db,'invite',payload)).status,409);
 db.sqlite.prepare("UPDATE workspace_members SET status='disabled' WHERE user_id=?").run(worker.id);
 assert.equal((await action(db,'invite',payload)).status,409);
});

test('an inline invite leaves no employee when its commit is fenced or the invitation insert fails',async t=>{
 for(const failure of ['role-changed','same-address','insert-failed'])await t.test(failure,async t=>{
   const {db,workspaceId}=await setup();t.after(()=>db.sqlite.close());
   const payload={roleId:'employee',email:worker.email,newEmployee:{name:'Maja Jensen',site:0}};
   const before=db.sqlite.prepare('SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?').get(workspaceId);
   if(failure==='insert-failed')db.sqlite.exec("CREATE TRIGGER fail_inline_invitation BEFORE INSERT ON workspace_invites BEGIN SELECT RAISE(ABORT,'simulated invite insert failure'); END;");
   else db.beforeBatch=async statements=>{
     if(!statements.some(({sql})=>sql.includes('INSERT INTO workspace_invites (id,workspace_id,email,name')))return;
     db.beforeBatch=null;
     if(failure==='role-changed')db.sqlite.prepare("UPDATE workspace_roles SET version=version+1 WHERE workspace_id=? AND id='employee'").run(workspaceId);
     else assert.equal((await action(db,'invite',{...payload,newEmployee:undefined,personId:'p2'})).status,200);
   };
   const result=await action(db,'invite',payload);
   assert.equal(result.status,failure==='insert-failed'?500:409,JSON.stringify(result));
   assert.deepEqual(db.sqlite.prepare('SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?').get(workspaceId),before);
   assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_directory_records WHERE kind='employee' AND workspace_id=?").get(workspaceId).n,2);
   assert.equal(entries(db).filter(entry=>entry.summary==='Bruger inviteret').length,failure==='same-address'?1:0);
 });
});
