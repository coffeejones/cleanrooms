const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const Store = require('../lib/studio-store.mjs');
const Workspace = require('../lib/workspace-store.mjs');
const Departments = require('../src/department-model.js');
const Description = require('../src/description-model.js');
const Checklist = require('../src/checklist-progress.js');
const Publication = require('../src/publication-model.js');

// Exercise the production SQL and migrations, not an in-memory permission model.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name => name.endsWith('.sql')).sort();
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const adapter = {sqlite,batches:[],beforeBatch:null};
  const execute = ({sql,values}) => {
    const statement = sqlite.prepare(sql);
    if (statement.columns().length) return {success:true,results:statement.all(...values),meta:{changes:0}};
    const result = statement.run(...values);
    return {success:true,results:[],meta:{changes:Number(result.changes)}};
  };
  adapter.prepare = sql => {
    const bound = values => ({sql,values,
      async all() {return execute({sql,values});},
      async first(column) {const row=execute({sql,values}).results[0] || null;return column && row ? row[column] : row;},
      async run() {return execute({sql,values});}
    });
    return {...bound([]),bind:(...values) => bound(values)};
  };
  adapter.batch = async statements => {
    adapter.batches.push(statements);
    await adapter.beforeBatch?.(statements);
    sqlite.exec('BEGIN IMMEDIATE');
    try {const result=statements.map(execute);sqlite.exec('COMMIT');return result;}
    catch (error) {sqlite.exec('ROLLBACK');throw error;}
  };
  return adapter;
}

const owner = {id:'owner-a',email:'owner@example.com'};
const otherOwner = {id:'owner-b',email:'other@example.com'};
const studio = (changes={}) => ({storageVersion:1,series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{},organization:Departments.defaultOrganization(),...changes});
const request = (url,method='GET',body,principal=owner,headers={}) => new Request('https://cleanrooms.example'+url,{
  method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,
    ...(method!=='GET' ? {origin:'https://cleanrooms.example','content-type':'application/json'} : {}),...headers},
  ...(body===undefined ? {} : {body:JSON.stringify(body)})
});
const route = (db,method='GET',body,principal=owner,headers={}) => Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal,headers),db);
const accounts = (db,body,principal=owner,headers={}) => Workspace.handleAccountsRequest(request('/api/accounts','POST',body,principal,headers),db);
const json = async response => ({status:response.status,body:await response.json()});
async function bootstrap(db,principal=owner,snapshot=studio(),headers={}) {
  assert.equal((await Store.writeStudio(db,principal.id,0,snapshot)).ok,true);
  const result=await json(await route(db,'GET',undefined,principal,headers));
  assert.equal(result.status,200);return result.body;
}

function template(...labels) {
  return Description.encode({type:'doc',content:[{type:'taskList',content:labels.map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]});
}

async function invite(db,principal,grant,admin=owner) {
  const created=await json(await accounts(db,{action:'invite',email:principal.email,...grant},admin));
  assert.equal(created.status,200,JSON.stringify(created.body));
  const token=new URL(created.body.inviteUrl,'https://cleanrooms.example').searchParams.get('token');
  assert.ok(token,'A copied invitation URL must contain its single-use token.');
  return {...created.body,token};
}
async function join(db,principal,grant,admin=owner) {
  const invitation=await invite(db,principal,grant,admin);
  const accepted=await json(await accounts(db,{action:'acceptInvite',token:invitation.token},principal));
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  return {...accepted.body,invitation};
}

test('shared-route bootstrap requires the authenticated user own legacy snapshot',async()=>{
  const db=database();
  const missing=await json(await route(db));assert.equal(missing.status,403);
  const initialized=await bootstrap(db,owner,studio(),{'oai-authenticated-user-full-name':encodeURIComponent('Ægir Østergaard'),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'});
  assert.equal(initialized.viewer.name,'Ægir Østergaard');
  const outsider={id:'outsider',email:'outsider@example.com'};
  assert.equal((await route(db,'GET',undefined,outsider)).status,403);
  assert.equal((await route(db,'GET',undefined,{id:'',email:owner.email})).status,401);
  assert.equal((await route(db,'GET',undefined,{id:owner.id,email:''})).status,401);
  db.sqlite.close();
});

test('workspace mutations retain the same-origin requirement before opening storage',async()=>{
  let accessed=0;const db=()=>{accessed++;throw new Error('Should not access storage');};
  for(const headers of [{origin:'https://other.example'},{origin:'null'},{'sec-fetch-site':'cross-site'}]) {
    assert.equal((await route(db,'PUT',{revision:0,studio:studio()},owner,headers)).status,403);
    assert.equal((await accounts(db,{action:'invite'},owner,headers)).status,403);
  }
  assert.equal(accessed,0);
});

test('members share the invited workspace while independent owners and unknown identities remain isolated',async()=>{
  const db=database(), a=studio({privateMarker:'workspace-a-secret'}),b=studio({privateMarker:'workspace-b-secret'});
  const first=await bootstrap(db,owner,a),second=await bootstrap(db,otherOwner,b);
  assert.notEqual(first.workspace.id,second.workspace.id);
  const planner={id:'planner-a',email:'planner@example.com'};
  const accepted=await join(db,planner,{role:'planner'});
  assert.equal(accepted.workspace.id,first.workspace.id);
  const member=await json(await route(db,'GET',undefined,planner));
  assert.equal(member.body.workspace.id,first.workspace.id);assert.deepEqual(member.body.studio,first.studio);
  assert.equal(JSON.stringify(member.body).includes('workspace-b-secret'),false);
  const own=await json(await route(db,'GET',undefined,otherOwner));assert.deepEqual(own.body.studio,second.studio);
  const forgedWorkspace=await json(await Workspace.handleWorkspaceStudioRequest(request('/api/studio?workspaceId='+first.workspace.id,'GET',undefined,otherOwner,{'x-workspace-id':first.workspace.id}),db));
  assert.equal(forgedWorkspace.body.workspace.id,second.workspace.id);assert.deepEqual(forgedWorkspace.body.studio,second.studio);
  const stranger={id:'unknown',email:'unknown@example.com'};
  assert.equal((await route(db,'GET',undefined,stranger)).status,403);
  db.sqlite.prepare("UPDATE workspace_members SET status='disabled', version=version+1 WHERE user_id=?").run(planner.id);
  assert.equal((await route(db,'GET',undefined,planner)).status,403);
  db.sqlite.close();
});

test('planner department delegation is enforced on real snapshot writes and cannot grant account administration',async()=>{
  const db=database(), original=studio();await bootstrap(db,owner,original);
  const planner={id:'planner',email:'planner@example.com'};
  await join(db,planner,{role:'planner',manageDepartments:false});
  const view=(await json(await route(db,'GET',undefined,planner))).body;
  assert.equal(view.capabilities.plan,true);assert.equal(view.capabilities.manageDepartments,false);assert.equal(view.capabilities.manageUsers,false);
  const changed=structuredClone(original);changed.organization.departments[0].name='Forged change';changed.role='admin';changed.capabilities={manageDepartments:true,manageUsers:true};
  assert.equal((await route(db,'PUT',{revision:1,directoryRevision:view.directory.revision,studio:changed},planner)).status,403);
  const omitted=structuredClone(original);delete omitted.organization;
  assert.equal((await route(db,'PUT',{revision:1,directoryRevision:view.directory.revision,studio:omitted},planner)).status,403);
  assert.equal((await accounts(db,{action:'list'},planner)).status,403);
  assert.equal((await accounts(db,{action:'invite',email:'escalate@example.com',role:'admin'},planner)).status,403);
  const allowed={...original,edits:{planned:{id:'planned',person:'p0',site:0,date:'2026-10-28',start:'08:00',end:'09:00',note:''}}};
  assert.equal((await route(db,'PUT',{revision:1,directoryRevision:view.directory.revision,studio:allowed},planner)).status,200);
  const current=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(planner.id);
  assert.equal((await accounts(db,{action:'updateMember',userId:planner.id,version:current.version,manageDepartments:true})).status,200);
  const next={...allowed,organization:changed.organization};
  assert.equal((await route(db,'PUT',{revision:2,directoryRevision:view.directory.revision,studio:next},planner)).status,200);
  assert.equal((await json(await route(db,'GET',undefined,planner))).body.capabilities.manageDepartments,true);
  assert.equal((await accounts(db,{action:'invite',email:'still-forbidden@example.com',role:'admin'},planner)).status,403);
  db.sqlite.close();
});

test('the stable workspace owner cannot be disabled, demoted or stripped of owner capabilities',async()=>{
  const db=database();await bootstrap(db);
  for(const patch of [{role:'employee',personId:'p0'},{status:'disabled'},{manageDepartments:false}]) {
    const member=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(owner.id);
    const response=await accounts(db,{action:'updateMember',userId:owner.id,version:member.version,...patch});
    assert.ok([400,403,409].includes(response.status),'Owner mutation must be rejected.');
    const current=(await json(await route(db))).body;
    assert.equal(current.viewer.role,'admin');assert.equal(current.capabilities.manageUsers,true);assert.equal(current.capabilities.manageDepartments,true);
  }
  db.sqlite.close();
});

test('a planner can echo semantically unchanged directory aliases despite JSON key order while actual department edits remain forbidden',async()=>{
  const db=database();try{await bootstrap(db);const planner={id:'planner-key-order',email:'key-order@example.com'};await join(db,planner,{role:'planner',manageDepartments:false});const observed=(await json(await route(db,'GET',undefined,planner))).body,next=structuredClone(observed.studio),organization=next.organization;
    next.organization={departments:organization.departments.map(value=>({siteIds:value.siteIds,kind:value.kind,name:value.name,id:value.id})),sites:organization.sites.map(value=>({color:value.color,address:value.address,name:value.name,id:value.id})),version:organization.version};next.edits.planned={id:'planned',person:'p0',site:0,date:'2026-10-28',start:'08:00',end:'09:00',note:''};
    const accepted=await json(await route(db,'PUT',{revision:observed.revision,directoryRevision:observed.directory.revision,studio:next},planner));assert.equal(accepted.status,200,JSON.stringify(accepted.body));const current=(await json(await route(db,'GET',undefined,planner))).body;assert.deepEqual(current.studio.organization,observed.studio.organization);assert.equal(current.studio.edits.planned.start,'08:00');const unauthorized=structuredClone(current.studio);unauthorized.organization.departments[0].name='Unauthorized department name';assert.equal((await route(db,'PUT',{revision:current.revision,directoryRevision:current.directory.revision,studio:unauthorized},planner)).status,403);
  }finally{db.sqlite.close();}
});

test('invitation tokens are hashed, email-bound and single-use without trusting body identity or grants',async()=>{
  const db=database();await bootstrap(db);
  const employee={id:'employee',email:'employee@example.com'};
  const invitation=await invite(db,employee,{email:'Employee@Example.COM',role:'employee',personId:'p0'});
  const stored=db.sqlite.prepare('SELECT * FROM workspace_invites WHERE id=?').get(invitation.invite.id);
  assert.ok(stored.token_hash);assert.notEqual(stored.token_hash,invitation.token);
  assert.equal(JSON.stringify(stored).includes(invitation.token),false);
  const listed=await json(await accounts(db,{action:'list'}));
  assert.equal(listed.status,200);assert.equal(JSON.stringify(listed.body).includes(invitation.token),false);
  const wrong={id:'wrong-email',email:'wrong@example.com'};
  assert.equal((await accounts(db,{action:'acceptInvite',token:invitation.token,email:employee.email,role:'admin'},wrong)).status,403);
  const accepted=await json(await accounts(db,{action:'acceptInvite',token:invitation.token,role:'admin',manageDepartments:true},employee));
  assert.equal(accepted.status,200);assert.equal(accepted.body.viewer.role,'employee');assert.equal(accepted.body.capabilities.plan,false);
  const duplicate={id:'another-id',email:employee.email};
  assert.ok([400,403,409,410].includes((await accounts(db,{action:'acceptInvite',token:invitation.token},duplicate)).status));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE user_id=?').get(duplicate.id).count,0);
  db.sqlite.close();
});

test('expired and revoked invitations cannot create membership',async()=>{
  const db=database();await bootstrap(db);
  const expiredUser={id:'expired-user',email:'expired@example.com'};
  const expired=await invite(db,expiredUser,{role:'planner'});
  db.sqlite.prepare('UPDATE workspace_invites SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',expired.invite.id);
  assert.ok([400,403,409,410].includes((await accounts(db,{action:'acceptInvite',token:expired.token},expiredUser)).status));
  const revokedUser={id:'revoked-user',email:'revoked@example.com'};
  const revoked=await invite(db,revokedUser,{role:'planner'});
  assert.equal((await accounts(db,{action:'revokeInvite',inviteId:revoked.invite.id,version:revoked.invite.version})).status,200);
  assert.ok([400,403,409,410].includes((await accounts(db,{action:'acceptInvite',token:revoked.token},revokedUser)).status));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE user_id IN (?,?)').get(expiredUser.id,revokedUser.id).count,0);
  db.sqlite.close();
});

test('simultaneous claims of one invitation create exactly one bound identity',async()=>{
  const db=database();await bootstrap(db);
  const first={id:'claim-one',email:'claim@example.com'},second={id:'claim-two',email:first.email};
  const invitation=await invite(db,first,{role:'planner'});
  const responses=await Promise.all([first,second].map(principal=>accounts(db,{action:'acceptInvite',token:invitation.token},principal)));
  assert.equal(responses.filter(response=>response.status===200).length,1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE user_id IN (?,?)').get(first.id,second.id).count,1);
  db.sqlite.close();
});

test('employees receive only effective own occurrences and cannot use full PUT or stale conflicts to read the plan',async()=>{
  const db=database(),noteRich=template('Lås døren','Sluk lyset');
  const own={id:'own-shift',person:'p0',site:0,date:'2026-10-28',start:'07:00',end:'15:00',note:'Egne instruktioner',noteRich};
  const foreign={id:'foreign-shift',person:'p1',site:1,date:'2026-10-28',start:'08:00',end:'16:00',note:'OTHER_EMPLOYEE_SECRET',noteRich:template('PRIVATE_TASK_SECRET')};
  const deleted={...own,id:'deleted-shift'};
  const series={id:'own-series',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-02',weekdays:[1],start:'07:00',end:'15:00',noteRich,note:'Serie'};
  const reassigned={...own,id:'own-series@2026-10-27',seriesId:'own-series',person:'p1',date:'2026-11-02',note:'REASSIGNED_SECRET'};
  const foreignTasks=Checklist.read({},foreign);
  let progress=Checklist.set({},foreign,{person:'p1',key:foreignTasks.tasks[0].key,signature:foreignTasks.signature,checked:true}).progress;
  const oldAssignment={...reassigned,person:'p0'},oldTasks=Checklist.read(progress,oldAssignment);
  progress=Checklist.set(progress,oldAssignment,{person:'p0',key:oldTasks.tasks[0].key,signature:oldTasks.signature,checked:true}).progress;
  const snapshot=Publication.publish(studio({series:[series],edits:{[own.id]:own,[foreign.id]:foreign,[deleted.id]:deleted,[reassigned.id]:reassigned},deleted:[deleted.id],checklistProgress:progress,privateMarker:'FULL_PLAN_SECRET',weekPlans:{private:{note:'PRIVATE_HISTORY_SECRET'}},role:'admin',employeePerson:'p1'}),{from:'2026-10-26',to:'2026-11-01',siteIds:[0,1,2],actor:{userId:owner.id,name:'Ejer'},at:'2026-10-30T12:00:00.000Z'}).studio;
  await bootstrap(db,owner,snapshot);
  const employee={id:'employee',email:'employee@example.com'};await join(db,employee,{role:'employee',personId:'p0'});
  const read=await json(await route(db,'GET',undefined,employee));assert.equal(read.status,200);assert.equal(read.body.studio,null);
  assert.equal(read.body.employee.person.id,'p0');
  assert.ok(read.body.employee.shifts.some(shift=>shift.id===own.id));
  assert.ok(read.body.employee.shifts.every(shift=>shift.person==='p0'&&shift.id!==deleted.id&&shift.id!==reassigned.id));
  assert.ok(read.body.employee.sites.every(site=>read.body.employee.shifts.some(shift=>shift.site===site.index)));
  for(const secret of [foreign.id,foreign.note,reassigned.id,reassigned.note,'PRIVATE_TASK_SECRET','FULL_PLAN_SECRET','PRIVATE_HISTORY_SECRET']) assert.equal(JSON.stringify(read.body).includes(secret),false);
  const preferences=await accounts(db,{action:'preferences',preferences:{role:'admin',employeePerson:'p1',personId:'p1',manageDepartments:true}},employee);
  assert.ok([200,400].includes(preferences.status));
  const afterForgery=(await json(await route(db,'GET',undefined,employee))).body;
  assert.equal(afterForgery.viewer.role,'employee');assert.equal(afterForgery.employee.person.id,'p0');assert.equal(afterForgery.capabilities.plan,false);
  for(const revision of [0,1]) {
    const denied=await json(await route(db,'PUT',{revision,studio:{...snapshot,role:'admin',capabilities:{plan:true,manageUsers:true}}},employee));
    assert.equal(denied.status,403);assert.equal(denied.body.studio,undefined);assert.equal(JSON.stringify(denied.body).includes('FULL_PLAN_SECRET'),false);
  }
  const view=Checklist.read({},own),task=view.tasks[0];
  const staleTemplate=await accounts(db,{action:'checklist',revision:1,shiftId:own.id,key:task.key,signature:'forged-template',checked:true},employee);
  assert.ok([400,409].includes(staleTemplate.status));
  const stale=await json(await accounts(db,{action:'checklist',revision:0,shiftId:own.id,key:task.key,signature:view.signature,checked:true},employee));
  assert.equal(stale.status,409);assert.equal(stale.body.studio,undefined);assert.equal(JSON.stringify(stale.body).includes('FULL_PLAN_SECRET'),false);
  for(const shiftId of [foreign.id,deleted.id,reassigned.id,'missing-id']) {
    const denied=await accounts(db,{action:'checklist',revision:1,shiftId,key:task.key,signature:view.signature,checked:true,person:'p1'},employee);
    assert.ok([400,403,404].includes(denied.status));
  }
  const saved=await json(await accounts(db,{action:'checklist',revision:1,shiftId:own.id,key:task.key,signature:view.signature,checked:true},employee));
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  const durable=(await json(await route(db,'GET',undefined,owner))).body;assert.equal(durable.revision,1,'Checklist writes must not invalidate the planner revision');assert.equal(Checklist.read(durable.studio.checklistProgress,own).checked,1);
  assert.equal(Checklist.read(durable.studio.checklistProgress,foreign).checked,1,'Own checklist writes must preserve another employee’s saved completion.');
  db.sqlite.close();
});

test('membership revocation after preliminary authorization blocks the committing snapshot CAS',async()=>{
  const db=database(),snapshot=studio(),observed=await bootstrap(db,owner,snapshot);
  const planner={id:'planner-race',email:'race@example.com'};await join(db,planner,{role:'planner'});
  let intercepted=false;
  db.beforeBatch=statements=>{
    if(!statements.some(statement=>/UPDATE\s+studio_states\s+SET/i.test(statement.sql)))return;
    intercepted=true;db.beforeBatch=null;
    db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(planner.id);
  };
  const result=await route(db,'PUT',{revision:1,directoryRevision:observed.directory.revision,studio:{...snapshot,privateMarker:'MUST_NOT_COMMIT'}},planner);
  assert.equal(intercepted,true);assert.equal(result.status,403);
  assert.deepEqual(await Store.readStudio(db,owner.id),{revision:1,studio:snapshot});
  db.sqlite.close();
});

test('revoking only the department grant fences an already-authorized organization write',async()=>{
  const db=database(),snapshot=studio(),observed=await bootstrap(db,owner,snapshot);
  const planner={id:'grant-race',email:'grant-race@example.com'};await join(db,planner,{role:'planner',manageDepartments:true});
  const next=structuredClone(snapshot);next.organization.departments[0].name='MUST NOT COMMIT';
  let intercepted=false;
  db.beforeBatch=statements=>{
    if(!statements.some(statement=>/UPDATE\s+studio_states\s+SET/i.test(statement.sql)))return;
    intercepted=true;db.beforeBatch=null;
    db.sqlite.prepare('UPDATE workspace_members SET manage_departments=0,version=version+1 WHERE user_id=?').run(planner.id);
  };
  const result=await route(db,'PUT',{revision:1,directoryRevision:observed.directory.revision,studio:next},planner);
  assert.equal(intercepted,true);assert.equal(result.status,403);
  assert.deepEqual(await Store.readStudio(db,owner.id),{revision:1,studio:snapshot});
  assert.equal(db.sqlite.prepare('SELECT status FROM workspace_members WHERE user_id=?').get(planner.id).status,'active');
  db.sqlite.close();
});

test('active employee bindings are unique and a rejected claim does not burn its invitation',async()=>{
  const db=database();await bootstrap(db);
  const first={id:'binding-one',email:'binding-one@example.com'},second={id:'binding-two',email:'binding-two@example.com'};
  await join(db,first,{role:'employee',personId:'p0'});
  const pending=await invite(db,second,{role:'employee',personId:'p0'});
  assert.equal((await accounts(db,{action:'acceptInvite',token:pending.token},second)).status,409);
  assert.equal(db.sqlite.prepare('SELECT status FROM workspace_invites WHERE id=?').get(pending.invite.id).status,'pending');
  const existing=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(first.id);
  assert.equal((await accounts(db,{action:'updateMember',userId:first.id,version:existing.version,status:'disabled'})).status,200);
  assert.equal((await accounts(db,{action:'acceptInvite',token:pending.token},second)).status,200);
  const a={id:'binding-race-a',email:'binding-a@example.com'},b={id:'binding-race-b',email:'binding-b@example.com'};
  const invitations=await Promise.all([a,b].map(principal=>invite(db,principal,{role:'employee',personId:'p1'})));
  const claims=await Promise.all([a,b].map((principal,index)=>accounts(db,{action:'acceptInvite',token:invitations[index].token},principal)));
  assert.deepEqual(claims.map(response=>response.status).sort(),[200,409]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE person_id='p1' AND status='active'").get().count,1);
  const loser=claims.findIndex(response=>response.status!==200);
  assert.equal(db.sqlite.prepare('SELECT status FROM workspace_invites WHERE id=?').get(invitations[loser].invite.id).status,'pending');
  db.sqlite.close();
});

test('disabling or demoting an invitation issuer atomically revokes outstanding grants',async()=>{
  const db=database();await bootstrap(db);
  for(const [index,patch] of [{status:'disabled'},{role:'planner'}].entries()) {
    const admin={id:'issuer-'+index,email:'issuer-'+index+'@example.com'};
    await join(db,admin,{role:'admin'});
    const recipient={id:'recipient-'+index,email:'recipient-'+index+'@example.com'};
    const pending=await invite(db,recipient,{role:'admin'},admin);
    const current=db.sqlite.prepare('SELECT version FROM workspace_members WHERE user_id=?').get(admin.id);
    assert.equal((await accounts(db,{action:'updateMember',userId:admin.id,version:current.version,...patch})).status,200);
    assert.equal(db.sqlite.prepare('SELECT status FROM workspace_invites WHERE id=?').get(pending.invite.id).status,'revoked');
    assert.equal((await accounts(db,{action:'acceptInvite',token:pending.token},recipient)).status,410);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE user_id=?').get(recipient.id).count,0);
  }
  db.sqlite.close();
});

test('full snapshot preferences remain per-account and a losing CAS cannot change them',async()=>{
  const db=database(),original=studio({page:'people',week:1,calendarAnchor:'2026-10-26',worksiteDate:'2026-10-28',worksiteSite:0}),observed=await bootstrap(db,owner,original);
  const planner={id:'preference-planner',email:'preferences@example.com'};await join(db,planner,{role:'planner'});
  const planned={...original,page:'hours',week:3,calendarAnchor:'2026-11-02',worksiteDate:'2026-11-05',worksiteSite:1999,privateMarker:'shared-plan'};
  assert.equal((await route(db,'PUT',{revision:1,directoryRevision:observed.directory.revision,studio:planned},planner)).status,200);
  const ownerRead=(await json(await route(db))).body,plannerRead=(await json(await route(db,'GET',undefined,planner))).body;
  assert.equal(ownerRead.studio.page,'people');assert.equal(ownerRead.studio.week,1);
  assert.equal(plannerRead.studio.page,'hours');assert.equal(plannerRead.studio.week,3);
  assert.equal(ownerRead.studio.calendarAnchor,'2026-10-26');assert.equal(ownerRead.studio.worksiteDate,'2026-10-28');assert.equal(ownerRead.studio.worksiteSite,0);
  assert.equal(plannerRead.studio.calendarAnchor,'2026-11-02');assert.equal(plannerRead.studio.worksiteDate,'2026-11-05');assert.equal(plannerRead.studio.worksiteSite,1999);
  const durable=(await Store.readStudio(db,owner.id)).studio;
  assert.equal(Object.hasOwn(durable,'page'),false);assert.equal(Object.hasOwn(durable,'week'),false);
  for(const key of ['calendarAnchor','worksiteDate','worksiteSite'])assert.equal(Object.hasOwn(durable,key),false,`${key} must never rebase another member's shared plan.`);
  assert.equal((await route(db,'PUT',{revision:2,studio:{...ownerRead.studio,page:'leave',week:4}})).status,200);
  assert.equal((await route(db,'PUT',{revision:2,directoryRevision:observed.directory.revision,studio:{...planned,page:'demo',week:9}},planner)).status,409);
  const after=(await json(await route(db,'GET',undefined,planner))).body;
  assert.equal(after.studio.page,'hours');assert.equal(after.studio.week,3);
  assert.equal(after.studio.calendarAnchor,'2026-11-02');assert.equal(after.studio.worksiteDate,'2026-11-05');assert.equal(after.studio.worksiteSite,1999);
  db.sqlite.close();
});

test('private calendar and worksite preferences reject invalid dates, non-Mondays and unsupported site indices',async()=>{
  const db=database();await bootstrap(db);
  for(const preferences of [{calendarAnchor:'2026-10-28'},{calendarAnchor:'1999-12-27'},{calendarAnchor:'2101-01-03'},{worksiteDate:'2026-02-30'},{worksiteDate:'2101-01-01'},{worksiteSite:-1},{worksiteSite:2000},{worksiteSite:0.5}]){
    const response=await accounts(db,{action:'preferences',preferences});assert.equal(response.status,400,JSON.stringify(preferences));
  }
  const preferences={calendarAnchor:'2026-10-26',worksiteDate:'2000-01-01',worksiteSite:0};
  assert.equal((await accounts(db,{action:'preferences',preferences})).status,200);
  const read=(await json(await route(db))).body;for(const [key,value]of Object.entries(preferences))assert.equal(read.studio[key],value);
  assert.equal((await Store.readStudio(db,owner.id)).revision,1,'Private navigation updates must not write a plan revision.');
  db.sqlite.close();
});
