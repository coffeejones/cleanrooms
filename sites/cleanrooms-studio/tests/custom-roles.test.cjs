const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const permissions=['plan','departments.manage','users.manage','roles.manage'];
const owner={id:'owner-a',email:'owner@example.com'};

function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  const directory=path.join(__dirname,'../drizzle');
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(directory,name),'utf8'));
  const db={sqlite,beforeBatch:null};
  db.prepare=sql=>({bind:(...values)=>({sql,values})});
  db.batch=async statements=>{
    await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');
    try{
      const result=statements.map(({sql,values})=>{
        const query=sqlite.prepare(sql);
        if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};
        const changed=query.run(...values);return {success:true,results:[],meta:{changes:Number(changed.changes)}};
      });
      sqlite.exec('COMMIT');return result;
    }catch(error){sqlite.exec('ROLLBACK');throw error;}
  };
  return db;
}
const studio=(changes={})=>({storageVersion:1,series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{},organization:Departments.defaultOrganization(),...changes});
const request=(url,method,body,principal=owner)=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const accounts=(db,action,payload={},principal=owner)=>Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal),db);
const plan=(db,method='GET',body,principal=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal),db);
const json=async response=>({status:response.status,body:await response.json()});
async function bootstrap(db,principal=owner,snapshot=studio()){
  assert.equal((await Store.writeStudio(db,principal.id,0,snapshot)).ok,true);
  const result=await json(await plan(db,'GET',undefined,principal));assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
}
async function createRole(db,name,grants,principal=owner){
  const result=await json(await accounts(db,'createRole',{name,permissions:grants},principal));
  assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.role.id);return result.body.role;
}
async function invite(db,principal,grant,issuer=owner){
  const result=await json(await accounts(db,'invite',{email:principal.email,...grant},issuer));
  assert.equal(result.status,200,JSON.stringify(result.body));return {...result.body,token:new URL(result.body.inviteUrl).searchParams.get('token')};
}
async function join(db,principal,grant,issuer=owner){
  const invitation=await invite(db,principal,grant,issuer);
  const result=await json(await accounts(db,'acceptInvite',{token:invitation.token},principal));
  assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
}

test('legacy roles lazily bind immutable workspace defaults and expose the fixed permission catalog',async()=>{
  const db=database();await bootstrap(db);
  const legacy={id:'legacy-planner',email:'legacy@example.com'};
  await join(db,legacy,{role:'planner',manageDepartments:true});
  db.sqlite.prepare('UPDATE workspace_members SET role_id=NULL WHERE user_id=?').run(legacy.id);
  const view=await json(await plan(db,'GET',undefined,legacy));assert.equal(view.status,200);
  assert.equal(db.sqlite.prepare('SELECT role_id FROM workspace_members WHERE user_id=?').get(legacy.id).role_id,'planner-departments');
  assert.equal(view.body.capabilities.plan,true);assert.equal(view.body.capabilities.manageDepartments,true);
  const listed=await json(await accounts(db,'list'));assert.equal(listed.status,200);
  assert.deepEqual(listed.body.permissionCatalog.map(item=>item.id).sort(),[...permissions,'payroll.view','payroll.manage','payroll.groups.manage','chat.manage'].sort());
  const defaults=Object.fromEntries(listed.body.roles.filter(role=>role.isSystem).map(role=>[role.id,role.permissions]));
  assert.deepEqual(defaults,{admin:[...permissions,'payroll.view','payroll.manage','payroll.groups.manage','chat.manage'],planner:['plan'],'planner-departments':['plan','departments.manage'],employee:[]});
  db.sqlite.close();
});

test('custom role validation rejects unknown permissions, malformed lists and departments without plan',async()=>{
  const db=database();await bootstrap(db);
  for(const grants of [['unknown'],['departments.manage'],'plan',null,[true]]){
    const result=await accounts(db,'createRole',{name:'Invalid',permissions:grants});assert.equal(result.status,400);
  }
  const valid=await createRole(db,'Planlægning',['plan']);
  for(const grants of [['unknown'],['departments.manage']])assert.equal((await accounts(db,'updateRole',{roleId:valid.id,version:valid.version,name:'Invalid update',permissions:grants})).status,400);
  const current=db.sqlite.prepare('SELECT permissions,version FROM workspace_roles WHERE id=?').get(valid.id);
  assert.deepEqual(JSON.parse(current.permissions),['plan']);assert.equal(current.version,valid.version);
  db.sqlite.close();
});

test('custom definitions propagate to every assigned member and invalidate their cached membership versions',async()=>{
  const db=database();await bootstrap(db);
  const role=await createRole(db,'Planlægger med valgfri afdelinger',['plan']);
  const people=[{id:'custom-one',email:'one@example.com'},{id:'custom-two',email:'two@example.com'}];
  await join(db,people[0],{role:'planner'});
  const oldVersion=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(people[0].id).version;
  assert.equal((await accounts(db,'updateMember',{userId:people[0].id,version:oldVersion,roleId:role.id})).status,200);
  await join(db,people[1],{roleId:role.id});
  const versions=people.map(principal=>db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(principal.id).version);
  const update=await json(await accounts(db,'updateRole',{roleId:role.id,version:role.version,name:'Afdelingsplanlæggere',permissions:['plan','departments.manage']}));
  assert.equal(update.status,200);assert.equal(update.body.role.version,role.version+1);
  for(const [index,principal]of people.entries()){
    const current=(await json(await plan(db,'GET',undefined,principal))).body;
    assert.equal(current.capabilities.manageDepartments,true);
    assert.equal(db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(principal.id).version,versions[index]+1);
  }
  assert.equal((await accounts(db,'updateRole',{roleId:role.id,version:role.version,name:'Stale',permissions:[]})).status,409);
  db.sqlite.close();
});

test('role IDs remain workspace-scoped and system definitions and owner assignment cannot change',async()=>{
  const db=database();await bootstrap(db);
  const other={id:'other-owner',email:'other@example.com'};await bootstrap(db,other);
  const foreign=await createRole(db,'Other workspace',['plan'],other);
  const member={id:'existing-member',email:'existing@example.com'};await join(db,member,{role:'planner'});
  const version=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(member.id).version;
  assert.ok([400,404].includes((await accounts(db,'updateMember',{userId:member.id,version,roleId:foreign.id})).status));
  assert.ok([400,404].includes((await accounts(db,'updateRole',{roleId:foreign.id,version:foreign.version,name:'Foreign edit',permissions:[]})).status));
  assert.ok([400,404].includes((await accounts(db,'invite',{email:'bad@example.com',roleId:foreign.id})).status));
  const unchanged=db.sqlite.prepare('SELECT role_id,version FROM workspace_members WHERE user_id=?').get(member.id);
  assert.equal(unchanged.role_id,'planner');assert.equal(unchanged.version,version);
  const listed=(await json(await accounts(db,'list'))).body;
  for(const role of listed.roles.filter(role=>role.isSystem))assert.ok([403,409].includes((await accounts(db,'updateRole',{roleId:role.id,version:role.version,name:'Changed',permissions:[]})).status));
  const own=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(owner.id);
  assert.equal((await accounts(db,'updateMember',{userId:owner.id,version:own.version,roleId:'employee',personId:'p0'})).status,403);
  db.sqlite.close();
});

test('users.manage and roles.manage are independent and neither can grant permissions its actor lacks',async()=>{
  const db=database();await bootstrap(db);
  const usersRole=await createRole(db,'Brugeradministrator',['users.manage']);
  const rolesRole=await createRole(db,'Rolleadministrator',['roles.manage']);
  const users={id:'users-manager',email:'users@example.com'},roles={id:'roles-manager',email:'roles@example.com'};
  await join(db,users,{roleId:usersRole.id});await join(db,roles,{roleId:rolesRole.id});
  assert.equal((await accounts(db,'list',{},users)).status,200);assert.equal((await accounts(db,'list',{},roles)).status,200);
  assert.equal((await accounts(db,'createRole',{name:'Not permitted',permissions:[]},users)).status,403);
  assert.equal((await accounts(db,'invite',{email:'forbidden@example.com',roleId:'employee',personId:'p0'},roles)).status,403);
  assert.equal((await accounts(db,'createRole',{name:'Escalation',permissions:['plan','roles.manage']},roles)).status,403);
  assert.equal((await accounts(db,'updateRole',{roleId:rolesRole.id,version:rolesRole.version,name:'Escalation',permissions:['plan','roles.manage']},roles)).status,403);
  assert.equal((await accounts(db,'invite',{email:'admin-escalation@example.com',roleId:'admin'},users)).status,403);
  const target={id:'target-employee',email:'target@example.com'};await join(db,target,{roleId:'employee',personId:'p0'},users);
  const targetVersion=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(target.id).version;
  assert.equal((await accounts(db,'updateMember',{userId:target.id,version:targetVersion,roleId:'admin'},users)).status,403);
  assert.equal((await accounts(db,'updateMember',{userId:target.id,version:targetVersion,name:'Not allowed'},roles)).status,403);
  const harmless=await createRole(db,'Uden rettigheder',[],roles);assert.deepEqual(harmless.permissions,[]);
  const roleList=(await json(await accounts(db,'list',{},roles))).body;
  assert.ok(!roleList.members||roleList.members.length===0);assert.ok(!roleList.invites||roleList.invites.length===0);
  assert.equal(JSON.stringify(roleList).includes(target.email),false);
  db.sqlite.close();
});

test('pending invitations use the current role definition instead of frozen permissions',async()=>{
  const db=database();await bootstrap(db);
  const role=await createRole(db,'Konto og plan',['plan','users.manage']);
  const person={id:'pending-custom',email:'pending@example.com'};
  const pending=await invite(db,person,{roleId:role.id});
  assert.equal((await accounts(db,'updateRole',{roleId:role.id,version:role.version,name:role.name,permissions:['users.manage']})).status,200);
  const accepted=await json(await accounts(db,'acceptInvite',{token:pending.token},person));assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal(accepted.body.capabilities.plan,false);assert.equal(accepted.body.capabilities.manageUsers,true);
  const stored=db.sqlite.prepare('SELECT role_id FROM workspace_members WHERE user_id=?').get(person.id);assert.equal(stored.role_id,role.id);
  const read=await json(await plan(db,'GET',undefined,person));assert.equal(read.body.studio,null);
  db.sqlite.close();
});

test('account managers without plan never receive full snapshots or conflict snapshots',async()=>{
  const db=database(),snapshot=studio({privateMarker:'PRIVATE_FULL_PLAN',edits:{foreign:{id:'foreign',person:'p1',site:0,date:'2026-10-28',start:'07:00',end:'15:00',note:'PRIVATE_OTHER_NOTE'}}});
  await bootstrap(db,owner,snapshot);
  for(const [index,permission]of ['users.manage','roles.manage','chat.manage'].entries()){
    const role=await createRole(db,'Account manager '+index,[permission]);
    const principal={id:'manager-'+index,email:'manager-'+index+'@example.com'};await join(db,principal,{roleId:role.id});
    const read=await json(await plan(db,'GET',undefined,principal));assert.equal(read.status,200);assert.equal(read.body.studio,null);assert.equal(read.body.capabilities.plan,false);
    for(const secret of ['PRIVATE_FULL_PLAN','PRIVATE_OTHER_NOTE'])assert.equal(JSON.stringify(read.body).includes(secret),false);
    for(const revision of [0,1]){
      const denied=await json(await plan(db,'PUT',{revision,studio:{...snapshot,roleId:'admin',permissions}},principal));
      assert.equal(denied.status,403);assert.equal(denied.body.studio,undefined);assert.equal(JSON.stringify(denied.body).includes('PRIVATE_FULL_PLAN'),false);
    }
  }
  db.sqlite.close();
});

test('role version changes fence in-flight plan and department writes even when membership version is unchanged',async()=>{
  for(const mode of ['plan','departments']){
    const db=database(),snapshot=studio();await bootstrap(db,owner,snapshot);
    const role=await createRole(db,'Race '+mode,['plan','departments.manage']);
    const principal={id:'race-'+mode,email:mode+'@example.com'};await join(db,principal,{roleId:role.id});
    const before=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(principal.id).version;
    const observed=await Store.readStudio(db,owner.id);
    const next=structuredClone(snapshot);if(mode==='plan')next.privateMarker='MUST NOT COMMIT';else next.organization.departments[0].name='MUST NOT COMMIT';
    let intercepted=false;
    db.beforeBatch=statements=>{
      if(!statements.some(item=>/UPDATE\s+studio_states\s+SET/i.test(item.sql)))return;
      db.beforeBatch=null;intercepted=true;
      db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run(JSON.stringify(mode==='plan'?[]:['plan']),role.id);
    };
    assert.equal((await plan(db,'PUT',{revision:1,directoryRevision:observed.directory.revision,studio:next},principal)).status,403);assert.equal(intercepted,true);
    assert.equal(db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(principal.id).version,before);
    assert.deepEqual(await Store.readStudio(db,owner.id),{revision:1,studio:snapshot});db.sqlite.close();
  }
});

test('role version changes fence account mutations before committing an invitation',async()=>{
  const db=database();await bootstrap(db);
  const role=await createRole(db,'Invitationsansvarlig',['users.manage']);
  const principal={id:'acl-race',email:'acl-race@example.com'};await join(db,principal,{roleId:role.id});
  const before=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(principal.id).version;
  let intercepted=false;
  db.beforeBatch=statements=>{
    if(!statements.some(item=>/INSERT\s+INTO\s+workspace_invites/i.test(item.sql)))return;
    db.beforeBatch=null;intercepted=true;
    db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run('[]',role.id);
  };
  const attempted=await accounts(db,'invite',{email:'must-not-invite@example.com',roleId:'employee',personId:'p0'},principal);
  assert.equal(attempted.status,403);assert.equal(intercepted,true);
  assert.equal(db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(principal.id).version,before);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_invites WHERE email=?').get('must-not-invite@example.com').count,0);
  db.sqlite.close();
});

test('role edits cannot turn duplicate or unbound plan accounts into active employees',async()=>{
  const db=database();await bootstrap(db);
  const duplicateRole=await createRole(db,'Delt tilknytning før rolleændring',['plan']);
  for(const [index,email]of ['bound-one@example.com','bound-two@example.com'].entries())await join(db,{id:'bound-'+index,email},{roleId:duplicateRole.id,personId:'p0'});
  assert.ok([400,409].includes((await accounts(db,'updateRole',{roleId:duplicateRole.id,version:duplicateRole.version,name:duplicateRole.name,permissions:[]})).status));
  assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT permissions FROM workspace_roles WHERE id=?').get(duplicateRole.id).permissions),['plan']);
  const unboundRole=await createRole(db,'Uden tilknytning',['plan']);
  await join(db,{id:'unbound',email:'unbound@example.com'},{roleId:unboundRole.id});
  assert.ok([400,409].includes((await accounts(db,'updateRole',{roleId:unboundRole.id,version:unboundRole.version,name:unboundRole.name,permissions:[]})).status));
  assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT permissions FROM workspace_roles WHERE id=?').get(unboundRole.id).permissions),['plan']);
  db.sqlite.close();
});

test('pending invitations cannot outlive an issuer permission reduction or a concurrent target role edit',async()=>{
  const db=database();await bootstrap(db);
  const issuerRole=await createRole(db,'Inviter med plan',['plan','users.manage']);
  const issuer={id:'limited-issuer',email:'issuer@example.com'};await join(db,issuer,{roleId:issuerRole.id});
  const targetRole=await createRole(db,'Inviteret planlægger',['plan']);
  const recipient={id:'attenuated-recipient',email:'attenuated@example.com'};
  const pending=await invite(db,recipient,{roleId:targetRole.id},issuer);
  assert.equal((await accounts(db,'updateRole',{roleId:issuerRole.id,version:issuerRole.version,name:issuerRole.name,permissions:['users.manage']})).status,200);
  assert.ok([403,409,410].includes((await accounts(db,'acceptInvite',{token:pending.token},recipient)).status));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE user_id=?').get(recipient.id).count,0);
  const racing={id:'racing-recipient',email:'racing@example.com'},racingInvite=await invite(db,racing,{roleId:targetRole.id});
  let intercepted=false;
  db.beforeBatch=statements=>{
    if(!statements.some(item=>/UPDATE\s+workspace_invites\s+SET\s+status\s*=\s*'accepted'/i.test(item.sql)))return;
    db.beforeBatch=null;intercepted=true;
    db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run(JSON.stringify(['plan','departments.manage']),targetRole.id);
  };
  assert.ok([403,409,410].includes((await accounts(db,'acceptInvite',{token:racingInvite.token},racing)).status));assert.equal(intercepted,true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE user_id=?').get(racing.id).count,0);
  assert.equal(db.sqlite.prepare('SELECT status FROM workspace_invites WHERE id=?').get(racingInvite.invite.id).status,'pending');
  db.sqlite.close();
});

test('target role version changes fence invitations and member assignments after subset validation',async()=>{
  for(const operation of ['invite','updateMember']){
    const db=database();await bootstrap(db);
    const actorRole=await createRole(db,'Brugeransvarlig',['users.manage']),targetRole=await createRole(db,'Begrænset målrolle',[]);
    const actor={id:'target-race-actor',email:'target-race@example.com'};await join(db,actor,{roleId:actorRole.id});
    const subject={id:'target-race-subject',email:'subject@example.com'};
    let memberVersion;
    if(operation==='updateMember'){
      await join(db,subject,{roleId:'employee',personId:'p0'});
      memberVersion=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(subject.id).version;
    }
    let intercepted=false;
    db.beforeBatch=statements=>{
      const mutation=operation==='invite'?/INSERT\s+INTO\s+workspace_invites/i:/UPDATE\s+workspace_members\s+SET\s+name/i;
      if(!statements.some(item=>mutation.test(item.sql)))return;
      db.beforeBatch=null;intercepted=true;
      db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run(JSON.stringify(['plan']),targetRole.id);
    };
    const payload=operation==='invite'?{email:subject.email,roleId:targetRole.id,personId:'p0'}:{userId:subject.id,version:memberVersion,roleId:targetRole.id,personId:'p0'};
    const result=await accounts(db,operation,payload,actor);
    assert.ok([403,409].includes(result.status));assert.equal(intercepted,true);
    if(operation==='invite')assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_invites WHERE email=?').get(subject.email).count,0);
    else{
      const unchanged=db.sqlite.prepare('SELECT role_id,version FROM workspace_members WHERE user_id=?').get(subject.id);
      assert.equal(unchanged.role_id,'employee');assert.equal(unchanged.version,memberVersion);
    }
    db.sqlite.close();
  }
});

test('role definition creation and editing fence an actor definition changed before commit',async()=>{
  for(const operation of ['createRole','updateRole']){
    const db=database();await bootstrap(db);
    const actorRole=await createRole(db,'Rolleansvarlig',['roles.manage']);
    const actor={id:'role-write-race',email:'role-write@example.com'};await join(db,actor,{roleId:actorRole.id});
    const target=operation==='updateRole'?await createRole(db,'Oprindeligt navn',[]):null;
    const proposed='ROLE MUTATION MUST NOT COMMIT';let intercepted=false;
    db.beforeBatch=statements=>{
      const mutation=operation==='createRole'?/INSERT\s+INTO\s+workspace_roles/i:/UPDATE\s+workspace_roles\s+SET\s+name/i;
      if(!statements.some(item=>mutation.test(item.sql)&&item.values.includes(proposed)))return;
      db.beforeBatch=null;intercepted=true;
      db.sqlite.prepare('UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id=?').run('[]',actorRole.id);
    };
    const payload={name:proposed,permissions:[],...(target?{roleId:target.id,version:target.version}:{})};
    const result=await accounts(db,operation,payload,actor);
    assert.ok([403,409].includes(result.status));assert.equal(intercepted,true);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_roles WHERE name=?').get(proposed).count,0);
    if(target)assert.equal(db.sqlite.prepare('SELECT name FROM workspace_roles WHERE id=?').get(target.id).name,target.name);
    db.sqlite.close();
  }
});
