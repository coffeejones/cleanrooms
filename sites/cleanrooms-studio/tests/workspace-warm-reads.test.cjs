const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js'),Roles=require('../src/role-model.js');
const owner='warm-owner',at='2026-11-02T12:00:00.000Z',url='https://cleanrooms.example/api/studio?projection=calendar&from=2026-11-02&to=2026-11-08&instructions=deferred';
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const db={sqlite,batches:[],beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{db.batches.push(statements);await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
  return db;
}
async function calendar(db){const result=await Workspace.handleWorkspaceStudioRequest(new Request(url,{headers:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'warm@example.com'}}),db);return {status:result.status,body:await result.json()};}
async function setup(){
  const db=database(),studio={storageVersion:1,demoSeed:false,calendarAnchor:'2026-10-26',organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[]};
  assert.equal((await Store.writeStudio(db,owner,0,studio)).ok,true);assert.equal((await calendar(db)).status,200);assert.equal((await calendar(db)).status,200);
  const workspaceId=db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(owner).workspace_id;db.batches=[];return {db,workspaceId};
}

test('warm calendar reads avoid role writes, batch summaries and retain a final fresh member/role fence',async()=>{
  const {db,workspaceId}=await setup(),before=db.sqlite.prepare('SELECT * FROM workspace_roles ORDER BY id').all();
  const result=await calendar(db);assert.equal(result.status,200,JSON.stringify(result.body));
  const queries=db.batches.flat();assert.equal(queries.some(({sql})=>/^(?:INSERT INTO|UPDATE) workspace_roles|^UPDATE workspace_(?:members|invites) SET role_id/.test(sql)),false,'Normal reads must not run legacy repair writes.');
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_roles ORDER BY id').all(),before);
  const summaries=db.batches.filter(batch=>batch.some(({sql})=>sql.includes('COUNT(DISTINCT COALESCE')));assert.equal(summaries.length,1);assert.equal(summaries[0].length,3,'Independent counters share one D1 round trip.');
  assert.equal(result.body.workflowSummary.pendingCount,db.sqlite.prepare("SELECT COUNT(*) n FROM workspace_shift_requests WHERE workspace_id=? AND status='pending'").get(workspaceId).n);
  assert.equal(result.body.planningSummary.pendingAbsenceCount,db.sqlite.prepare("SELECT COUNT(*) n FROM workspace_absences WHERE workspace_id=? AND status='pending'").get(workspaceId).n);
  assert.equal(db.batches.at(-1).length,1);assert.match(db.batches.at(-1)[0].sql,/LEFT JOIN workspace_roles actor_role/);
  assert.ok(db.batches.length<=32,`An empty warm calendar should need at most 32 D1 batches, received ${db.batches.length}.`);db.sqlite.close();
});

test('role preflight still repairs missing defaults, null legacy assignments and all historical built-in admin grants',async t=>{
  for(const repair of ['missing-default','member-assignment','invite-assignment','admin-four','admin-six','admin-seven'])await t.test(repair,async()=>{
    const {db,workspaceId}=await setup(),old=['plan','departments.manage','users.manage','roles.manage'],beforeVersion=db.sqlite.prepare("SELECT version FROM workspace_roles WHERE workspace_id=? AND id='admin'").get(workspaceId).version;
    if(repair==='missing-default')db.sqlite.prepare("DELETE FROM workspace_roles WHERE workspace_id=? AND id='planner'").run(workspaceId);
    if(repair==='member-assignment')db.sqlite.prepare('UPDATE workspace_members SET role_id=NULL WHERE user_id=?').run(owner);
    if(repair==='invite-assignment')db.sqlite.prepare(`INSERT INTO workspace_invites (id,workspace_id,email,name,role,manage_departments,token_hash,expires_at,created_by,created_at,updated_at) VALUES ('legacy-invite',?,'legacy@example.com','Legacy','planner',1,'legacy-token',?,?,?,?)`).run(workspaceId,'2026-11-09T12:00:00.000Z',owner,at,at);
    if(repair.startsWith('admin-'))db.sqlite.prepare("UPDATE workspace_roles SET permissions=? WHERE workspace_id=? AND id='admin'").run(JSON.stringify(repair==='admin-four'?old:repair==='admin-six'?[...old,'payroll.view','payroll.manage']:[...old,'payroll.view','payroll.manage','payroll.groups.manage']),workspaceId);
    assert.equal(await Workspace.ensureWorkspaceRoles(db,workspaceId),true);assert.equal(db.batches.length,2,'A detected repair uses a preflight then the original atomic repair batch.');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_roles WHERE workspace_id=?').get(workspaceId).n,4);
    assert.equal(db.sqlite.prepare('SELECT role_id FROM workspace_members WHERE user_id=?').get(owner).role_id,'admin');
    if(repair==='invite-assignment')assert.equal(db.sqlite.prepare("SELECT role_id FROM workspace_invites WHERE id='legacy-invite'").get().role_id,'planner-departments');
    if(repair.startsWith('admin-')){const admin=db.sqlite.prepare("SELECT permissions,version FROM workspace_roles WHERE workspace_id=? AND id='admin'").get(workspaceId);assert.deepEqual(JSON.parse(admin.permissions),Roles.PERMISSION_KEYS);assert.equal(admin.version,beforeVersion+1);}
    db.batches=[];assert.equal(await Workspace.ensureWorkspaceRoles(db,workspaceId),false);assert.equal(db.batches.length,1);assert.ok(db.batches[0].every(({sql})=>sql.startsWith('SELECT')));db.sqlite.close();
  });
});

test('role preflight preserves custom and narrowed built-in grants rather than restoring extra permissions',async()=>{
  const {db,workspaceId}=await setup(),limited=['plan'];db.sqlite.prepare("UPDATE workspace_roles SET permissions=? WHERE workspace_id=? AND id='admin'").run(JSON.stringify(limited),workspaceId);
  db.sqlite.prepare('INSERT INTO workspace_roles (workspace_id,id,name,permissions,version,is_system,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)').run(workspaceId,'custom','Custom',JSON.stringify(['plan','departments.manage','users.manage','roles.manage']),at,at);
  const before=db.sqlite.prepare('SELECT * FROM workspace_roles ORDER BY id').all();assert.equal(await Workspace.ensureWorkspaceRoles(db,workspaceId),false);assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_roles ORDER BY id').all(),before);db.sqlite.close();
});

test('chat permission repair upgrades only a complete previous built-in role and leaves custom or narrowed seven-key grants intact',async()=>{
  const {db,workspaceId}=await setup(),oldComplete=Roles.PERMISSION_KEYS.filter(key=>key!=='chat.manage'),narrowed=Roles.PERMISSION_KEYS.filter(key=>key!=='payroll.groups.manage');
  assert.equal(oldComplete.length,7);assert.equal(narrowed.length,7);
  db.sqlite.prepare('INSERT INTO workspace_roles (workspace_id,id,name,permissions,version,is_system,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)').run(workspaceId,'complete-custom','Custom full previous grants',JSON.stringify(oldComplete),at,at);
  db.sqlite.prepare("UPDATE workspace_roles SET permissions=? WHERE workspace_id=? AND id='admin'").run(JSON.stringify(narrowed),workspaceId);
  const before=db.sqlite.prepare('SELECT * FROM workspace_roles ORDER BY id').all();db.batches=[];
  assert.equal(await Workspace.ensureWorkspaceRoles(db,workspaceId),false);assert.equal(db.batches.length,1);assert.ok(db.batches[0].every(({sql})=>sql.startsWith('SELECT')));
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_roles ORDER BY id').all(),before);
  assert.equal(JSON.parse(db.sqlite.prepare("SELECT permissions FROM workspace_roles WHERE workspace_id=? AND id='complete-custom'").get(workspaceId).permissions).includes('chat.manage'),false);db.sqlite.close();
});

test('a membership or role change just before the combined final fence still denies the calendar response',async t=>{
  for(const race of ['disabled','membership-version','role-assignment','role-version','missing-role'])await t.test(race,async()=>{
    const {db,workspaceId}=await setup();let intercepted=false;
    db.beforeBatch=statements=>{if(!statements.some(({sql})=>sql.includes('FROM workspace_members actor LEFT JOIN workspace_roles actor_role')))return;intercepted=true;db.beforeBatch=null;
      if(race==='disabled')db.sqlite.prepare("UPDATE workspace_members SET status='disabled' WHERE user_id=?").run(owner);
      if(race==='membership-version')db.sqlite.prepare('UPDATE workspace_members SET version=version+1 WHERE user_id=?').run(owner);
      if(race==='role-assignment')db.sqlite.prepare("UPDATE workspace_members SET role_id='planner' WHERE user_id=?").run(owner);
      if(race==='role-version')db.sqlite.prepare("UPDATE workspace_roles SET version=version+1 WHERE workspace_id=? AND id='admin'").run(workspaceId);
      if(race==='missing-role')db.sqlite.prepare("DELETE FROM workspace_roles WHERE workspace_id=? AND id='admin'").run(workspaceId);
    };
    const result=await calendar(db);assert.equal(intercepted,true);assert.equal(result.status,403);assert.equal(result.body.error,'membership_changed');assert.equal(result.body.studio,undefined);db.sqlite.close();
  });
});

test('warm preference saves validate people without reading a plan or metadata payload',async()=>{
 const {db}=await setup(),request=preferences=>new Request('https://cleanrooms.example/api/accounts',{method:'POST',headers:{origin:'https://cleanrooms.example','content-type':'application/json','oai-authenticated-user-id':owner,'oai-authenticated-user-email':'warm@example.com'},body:JSON.stringify({action:'preferences',preferences})});
 const saved=await Workspace.handleAccountsRequest(request({page:'hours',employeePerson:'p0'}),db);assert.equal(saved.status,200,JSON.stringify(await saved.json()));
 assert.equal(db.batches.flat().some(({sql})=>/FROM studio_state_chunks|FROM workspace_plan_record|FROM workspace_directory_chunks/.test(sql)),false,'View preferences must not read plan or full profile bodies.');
 assert.equal(db.sqlite.prepare('SELECT preferences FROM workspace_members WHERE user_id=?').get(owner).preferences.includes('"page":"hours"'),true);
 const invalid=await Workspace.handleAccountsRequest(request({employeePerson:'person-missing'}),db);assert.equal(invalid.status,400);assert.equal(db.sqlite.prepare('SELECT preferences FROM workspace_members WHERE user_id=?').get(owner).preferences.includes('person-missing'),false);db.sqlite.close();
});
