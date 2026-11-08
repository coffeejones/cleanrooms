const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const Data=require('../src/studio-data.js');
const Groups=require('../src/payroll-groups-model.js');
const Roles=require('../src/role-model.js');
const today=Data.todayFor();
const add=(value,days)=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
const owner={id:'group-owner',email:'owner@example.com'},other={id:'other-owner',email:'other@example.com'};
const people=[{id:'person-anna',name:'Anna Hansen',initials:'AH',target:30,site:0,role:'Service',active:true},{id:'person-bob',name:'Bob Jensen',initials:'BJ',target:25,site:1,role:'Service',active:true}];
const studio=()=>({storageVersion:1,demoSeed:false,roster:people,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{}});
const config=(amount=15000,from=today)=>({currency:'DKK',agreements:[{id:'rate-personal',from,type:'hourly',amountCents:amount}],supplements:[]});
const group=(id='group-clean',amount=15000,from=today)=>({id,name:'Rengøring',archived:false,revisions:[{id:id+'-revision-1',from,payroll:config(amount,from)}]});
const link=(personId=people[0].id,from=today,baseMode='group',groupId='group-clean')=>({personId,from,groupId,baseMode,excludedPersonalSupplementIds:[],supplementOverrides:[]});
const policy=(links=[link()],groups=[group()])=>({schema:1,groups,links});
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');const dir=path.join(__dirname,'../drizzle');for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(dir,name),'utf8'));const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const request=(url,method,body,principal=owner,headers={})=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async response=>({status:response.status,body:await response.json()});
const api=async(db,action,payload={},principal=owner,headers={})=>json(await Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal,headers),db));
const plan=(db,method='GET',body,principal=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal),db);
async function setup(db=database(),principal=owner){await Store.writeStudio(db,principal.id,0,studio());const response=await json(await plan(db,'GET',undefined,principal));assert.equal(response.status,200,JSON.stringify(response.body));return {db,...response.body};}
const read=(db,principal=owner)=>api(db,'payrollPolicyRead',{},principal);
const personalRead=(db,personId=people[0].id,principal=owner)=>api(db,'payrollRead',{personId},principal);
const personalSave=(db,payroll,version=0,policyVersion,personId=people[0].id,principal=owner)=>api(db,'payrollSave',{personId,payroll,version,...(policyVersion===undefined?{}:{policyVersion})},principal);
async function reviewedSave(db,value,version=0,date=today,principal=owner){const preview=await api(db,'payrollPolicyPreview',{version,policy:value,date},principal);assert.equal(preview.status,200,JSON.stringify(preview.body));const saved=await api(db,'payrollPolicySave',{version,policy:value,date,previewToken:preview.body.previewToken},principal);assert.equal(saved.status,200,JSON.stringify(saved.body));return saved.body;}
async function member(db,id,permissions){const role=await api(db,'createRole',{name:id,permissions});assert.equal(role.status,200,JSON.stringify(role.body));const principal={id,email:id+'@example.com'},invited=await api(db,'invite',{email:principal.email,roleId:role.body.role.id});assert.equal(invited.status,200);assert.equal((await api(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},principal)).status,200);return {principal,role:role.body.role};}
function noPrivate(response){assert.equal(Object.hasOwn(response.body,'policy'),false);assert.equal(Object.hasOwn(response.body,'people'),false);assert.equal(Object.hasOwn(response.body,'payroll'),false);}
function seedPolicy(db,workspaceId,value,version=1){db.sqlite.prepare('INSERT INTO workspace_payroll_policies (workspace_id,config,version,history,updated_by,updated_at,write_token) VALUES (?,?,?,?,?,?,?)').run(workspaceId,JSON.stringify(Groups.normalize(value)),version,'[]',owner.id,new Date().toISOString(),'fixture');}

test('policy persistence is private and reference-based, preserves legacy personal configurations and records reviewed impact',async()=>{
  const {db}=await setup(),before=await Store.readStudio(db,owner.id),empty=await read(db);assert.equal(empty.status,200);assert.deepEqual(empty.body,{policy:{schema:1,groups:[],links:[]},version:0,people:people.map(({id,name})=>({personId:id,name,payroll:null,version:0})),history:[]});
  const raw=config(19000,add(today,-20));assert.equal((await personalSave(db,raw)).status,200);
  const value=policy(),preview=await api(db,'payrollPolicyPreview',{version:0,policy:value,date:add(today,10)});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.preview.date,today,'A later review date must not hide an earlier effective assignment.');assert.equal(preview.body.preview.counts.affected,1);
  const saved=await api(db,'payrollPolicySave',{version:0,policy:value,date:add(today,10),previewToken:preview.body.previewToken});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.version,1);assert.deepEqual(saved.body.people[0].payroll,raw);assert.equal(saved.body.history[0].actor.userId,owner.id);assert.equal(saved.body.history[0].counts.affected,1);
  const person=await personalRead(db);assert.deepEqual(person.body.payroll,raw);assert.equal(person.body.version,1);assert.equal(person.body.policyVersion,1);assert.deepEqual(person.body.policy,Groups.normalize(value));
  assert.equal(Groups.resolve({policy:person.body.policy,personId:people[0].id,payroll:raw,from:today,to:today}).payroll.agreements[0].amountCents,15000);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,1,'Group assignment must not copy configurations into each person row.');assert.deepEqual(await Store.readStudio(db,owner.id),before);db.sqlite.close();
});

test('dated group revisions propagate inherited terms while personal base and personal extras remain explicit',async()=>{
  const {db}=await setup();await personalSave(db,config(21000),0,undefined,people[1].id);
  let value=policy([link(),link(people[1].id,today,'personal')]);await reviewedSave(db,value);const before=db.sqlite.prepare('SELECT * FROM workspace_payroll').all();
  const nextDate=add(today,7),nextConfig=config(17000,nextDate);nextConfig.supplements=[{id:'group-addon',name:'Fælles tillæg',type:'monthly',amountCents:5000,from:nextDate,to:null,weekdays:[],start:null,end:null}];value=structuredClone(value);value.groups[0].revisions.push({id:'revision-2',from:nextDate,payroll:nextConfig});
  const preview=await api(db,'payrollPolicyPreview',{version:1,policy:value,date:today});assert.equal(preview.status,200);assert.equal(preview.body.preview.counts.affected,2);const bob=preview.body.preview.rows.find(row=>row.personId===people[1].id);assert.equal(bob.baseChanged,false);assert.equal(bob.personalPreserved,true);assert.equal(bob.supplementsChanged,true);
  const saved=await reviewedSave(db,value,1);assert.equal(saved.version,2);assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_payroll').all(),before);
  for(const [id,amount] of [[people[0].id,17000],[people[1].id,21000]]){const person=await personalRead(db,id),resolved=Groups.resolve({policy:person.body.policy,personId:id,payroll:person.body.payroll,from:nextDate,to:nextDate});assert.equal(resolved.payroll.agreements[0].amountCents,amount);assert.ok(resolved.payroll.supplements.some(item=>item.amountCents===5000));}db.sqlite.close();
});

test('preview receipts are invalidated by changed candidate, personal pay, policy, plan or actor role versions',async()=>{
  for(const kind of ['candidate','personal','policy','plan','role']){
    const {db}=await setup(),value=policy(),preview=await api(db,'payrollPolicyPreview',{version:0,policy:value,date:today});assert.equal(preview.status,200);
    let candidate=value;
    if(kind==='candidate'){candidate=structuredClone(value);candidate.groups[0].name='Andet navn';}
    if(kind==='personal')assert.equal((await personalSave(db,config(18000),0,undefined,people[1].id)).status,200);
    if(kind==='policy')await reviewedSave(db,policy([],[group('other-group')]));
    if(kind==='plan'){const current=await Store.readStudio(db,owner.id);assert.equal((await plan(db,'PUT',{revision:current.revision,directoryRevision:current.directory.revision,studio:{...current.studio,edits:{'preview-plan':{id:'preview-plan',person:people[0].id,date:today,site:0,start:'07:00',end:'08:00',note:''}}}})).status,200);}
    if(kind==='role')db.sqlite.prepare("UPDATE workspace_roles SET version=version+1 WHERE id='admin'").run();
    const failed=await api(db,'payrollPolicySave',{version:0,policy:candidate,date:today,previewToken:preview.body.previewToken});assert.equal(failed.status,409,kind);assert.equal((await read(db)).body.version,kind==='policy'?1:0);db.sqlite.close();
  }
});

test('commit fences concurrent person pay, policy, roster and membership changes without partially saving reviewed policy',async()=>{
  for(const kind of ['personal','policy','roster','membership','role']){
    const {db}=await setup(),value=policy(),preview=await api(db,'payrollPolicyPreview',{version:0,policy:value,date:today});
    db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_payroll_policies')))return;db.beforeBatch=null;
      if(kind==='personal')assert.equal((await personalSave(db,config(19000))).status,200);
      if(kind==='policy')await reviewedSave(db,policy([],[group('other-group')]));
      if(kind==='roster'){const current=await Store.readStudio(db,owner.id);assert.equal((await plan(db,'PUT',{revision:current.revision,directoryRevision:current.directory.revision,studio:{...current.studio,roster:[people[1]]}})).status,200);}
      if(kind==='membership')db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(owner.id);
      if(kind==='role')db.sqlite.prepare("UPDATE workspace_roles SET permissions=?,version=version+1 WHERE id='admin'").run(JSON.stringify(['plan','payroll.view','payroll.manage']));
    };
    const failed=await api(db,'payrollPolicySave',{version:0,policy:value,date:today,previewToken:preview.body.previewToken});assert.equal(failed.status,['membership','role'].includes(kind)?403:409,kind);noPrivate(failed);
    const row=db.sqlite.prepare('SELECT config,version FROM workspace_payroll_policies').get();if(kind==='policy'){assert.equal(row.version,1);assert.equal(JSON.parse(row.config).groups[0].id,'other-group');}else assert.equal(row,undefined,kind);db.sqlite.close();
  }
});

test('linked raw writes require current policy receipts and personal rate changes create only dated personal-base snapshots atomically',async()=>{
  const {db}=await setup(),raw=config(19000,add(today,-30));await personalSave(db,raw);await reviewedSave(db,policy());
  const stale=await personalSave(db,config(15000),1);assert.equal(stale.status,409);assert.equal(stale.body.error,'payroll_policy_changed');assert.equal((await personalRead(db)).body.version,1);
  const manager=await member(db,'personal-pay-manager',['plan','payroll.view','payroll.manage']),next=structuredClone(raw);next.agreements.push({id:'personal-next',from:add(today,1),type:'hourly',amountCents:22000},{id:'personal-later',from:add(today,5),type:'hourly',amountCents:23000});
  const saved=await personalSave(db,next,1,1,people[0].id,manager.principal);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.version,2);assert.equal(saved.body.policyVersion,2);assert.deepEqual(saved.body.policy.links.map(value=>[value.from,value.baseMode]),[[today,'group'],[add(today,1),'personal'],[add(today,5),'personal']]);
  const ownLink={...link(people[0].id,add(today,2)),baseMode:'group'};const reset=await api(db,'payrollPersonPolicySave',{personId:people[0].id,version:2,policyVersion:2,link:ownLink},manager.principal);assert.equal(reset.status,200,JSON.stringify(reset.body));assert.equal(reset.body.version,2);assert.equal(reset.body.policyVersion,3);assert.ok(reset.body.policy.links.some(value=>value.from===add(today,5)&&value.baseMode==='personal'));
  assert.equal((await api(db,'payrollPersonPolicySave',{personId:people[0].id,policyVersion:3,link:ownLink},manager.principal)).status,400,'A personal raw version is mandatory.');
  const all=await read(db);assert.deepEqual(all.body.people.find(value=>value.personId===people[0].id).payroll,next);assert.equal(all.body.history.at(-1).actor.userId,manager.principal.id);db.sqlite.close();
});

test('individual payroll managers cannot join another group or mutate other people through the personal endpoint',async()=>{
  const {db}=await setup();await reviewedSave(db,policy([link()],[group(),group('other-group',18000)]));const manager=await member(db,'limited-pay-manager',['plan','payroll.view','payroll.manage']);
  const forbidden=await api(db,'payrollPersonPolicySave',{personId:people[0].id,version:0,policyVersion:1,link:link(people[0].id,today,'group','other-group')},manager.principal);assert.equal(forbidden.status,403);noPrivate(forbidden);
  assert.equal((await api(db,'payrollPersonPolicySave',{personId:people[0].id,version:0,policyVersion:1,link:link(people[1].id,today,'personal')},manager.principal)).status,400);
  assert.equal((await api(db,'payrollPolicyPreview',{version:1,policy:policy(),date:today},manager.principal)).status,403);
  const denied=await api(db,'payrollPolicySave',{version:1,policy:policy(),date:today,previewToken:'forged'},manager.principal);assert.equal(denied.status,403);noPrivate(denied);assert.equal((await read(db)).body.version,1);db.sqlite.close();
});

test('historical group/link settings and effective personal base are immutable while unlinked legacy salary setup remains supported',async()=>{
  const {db,workspace}=await setup(),past=add(today,-20),raw=config(19000,add(today,-30));await personalSave(db,raw);
  const historical=policy([link(people[0].id,past,'personal')],[group('group-clean',15000,past)]);seedPolicy(db,workspace.id,historical);
  const changed=structuredClone(historical);changed.groups[0].revisions[0].payroll.agreements[0].amountCents=16000;assert.equal((await api(db,'payrollPolicyPreview',{version:1,policy:changed,date:today})).status,400);
  for(const payroll of [{currency:'DKK',agreements:[],supplements:[]},{...raw,agreements:[{...raw.agreements[0],from:add(today,1)}]},{...raw,agreements:[{...raw.agreements[0],amountCents:20000}]}]){const failed=await personalSave(db,payroll,1,1);assert.equal(failed.status,400,JSON.stringify(payroll));assert.equal(failed.body.error,'historical_payroll_policy');}
  assert.equal((await personalRead(db)).body.version,1);assert.equal((await personalSave(db,config(17000,add(today,-50)),0,1,people[1].id)).status,200,'A person without group history retains the legacy personal API.');
  const inherited={...historical,links:[link(people[0].id,past,'group')]};db.sqlite.prepare('UPDATE workspace_payroll_policies SET config=?').run(JSON.stringify(inherited));assert.equal((await personalSave(db,config(19500,add(today,-30)),1,1)).status,400,'Stored personal history is immutable even while the current group hides a personal rate.');db.sqlite.close();
});

test('new assignments to archived groups are rejected, and group-linked identities cannot be removed even without personal pay rows',async()=>{
  const {db}=await setup();let value=policy();await reviewedSave(db,value);value=structuredClone(value);value.groups[0].archived=true;await reviewedSave(db,value,1);value.links.push(link(people[1].id));assert.equal((await api(db,'payrollPolicyPreview',{version:2,policy:value,date:today})).status,400);
  const current=await Store.readStudio(db,owner.id),removed=await json(await plan(db,'PUT',{revision:current.revision,directoryRevision:current.directory.revision,studio:{...current.studio,roster:[people[1]]}}));assert.equal(removed.status,400);assert.equal(removed.body.error,'payroll_person_linked');assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_payroll').get().n,0);
  assert.equal((await plan(db,'PUT',{revision:current.revision,directoryRevision:current.directory.revision,studio:{...current.studio,roster:[{...people[0],active:false},people[1]]}})).status,200);db.sqlite.close();
});

test('private policy access is workspace-scoped, never leaks through plan/conflicts/accounts, and custom roles gain no automatic group authority',async()=>{
  const {db}=await setup();await reviewedSave(db,policy());await setup(db,other);assert.equal((await read(db,other)).body.version,0);
  const viewer=await member(db,'private-viewer',['plan','payroll.view']),ordinary=await member(db,'ordinary-planner',['plan']);assert.equal((await read(db,viewer.principal)).status,200);const denied=await read(db,ordinary.principal);assert.equal(denied.status,403);noPrivate(denied);
  for(const response of [await plan(db),await plan(db,'PUT',{revision:0,studio:studio()}),await Workspace.handleAccountsRequest(request('/api/accounts','POST',{action:'list'}),db)])assert.equal(JSON.stringify(await response.json()).includes('group-clean-revision-1'),false);
  const forged=await json(await plan(db,'PUT',{revision:1,studio:{...studio(),payrollPolicy:policy()}}));assert.equal(forged.status,400);noPrivate(forged);
  const oldSix=['plan','departments.manage','users.manage','roles.manage','payroll.view','payroll.manage'],custom=await member(db,'legacy-full-pay',oldSix);assert.equal((await json(await plan(db,'GET',undefined,custom.principal))).body.capabilities.managePayrollGroups,false);assert.equal((await api(db,'createRole',{name:'Escalation',permissions:Roles.PERMISSION_KEYS},custom.principal)).status,403);
  db.sqlite.prepare("UPDATE workspace_roles SET permissions=? WHERE id='admin' AND is_system=1").run(JSON.stringify(oldSix));assert.equal((await json(await plan(db))).body.capabilities.managePayrollGroups,true);assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT permissions FROM workspace_roles WHERE id=?').get(custom.role.id).permissions),oldSix);
  assert.equal((await api(db,'preferences',{preferences:{page:'payroll'}})).status,200);db.sqlite.close();
});


test('saved past, current and future group periods cannot be edited, removed, moved or replaced through preview or save',async()=>{
  for(const when of [add(today,-20),today,add(today,15)]){
    const {db,workspace}=await setup(),savedGroup=group('locked-period',15000,when);
    savedGroup.revisions.push({id:'later-period',from:add(today,60),payroll:config(19000,add(today,60))});
    const saved=policy([],[savedGroup]);seedPolicy(db,workspace.id,saved);
    const original=db.sqlite.prepare('SELECT config,version,history FROM workspace_payroll_policies').get();
    const review=await api(db,'payrollPolicyPreview',{version:1,policy:saved,date:today});assert.equal(review.status,200);
    const variants=[
      ['rate',value=>value.groups[0].revisions[0].payroll.agreements[0].amountCents=99900],
      ['supplement',value=>value.groups[0].revisions[0].payroll.supplements.push({id:'late-added-rule',name:'Efterfølgende tillæg',type:'monthly',amountCents:50000,from:when,to:null,weekdays:[],start:null,end:null})],
      ['date',value=>value.groups[0].revisions[0].from=add(when,1)],
      ['remove',value=>value.groups[0].revisions.shift()],
      ['replacement-id',value=>value.groups[0].revisions[0].id='replacement-period'],
      ['remove-group',value=>value.groups=[]]
    ];
    for(const [kind,mutate] of variants){
      const candidate=structuredClone(saved);mutate(candidate);
      for(const action of ['payrollPolicyPreview','payrollPolicySave']){
        const result=await api(db,action,{version:1,policy:candidate,date:today,previewToken:review.body.previewToken});
        assert.equal(result.status,400,when+' '+kind+' '+action);assert.equal(result.body.error,'immutable_payroll_period');assert.match(result.body.message,/Gemte lønperioder kan ikke ændres/);noPrivate(result);
        assert.deepEqual(db.sqlite.prepare('SELECT config,version,history FROM workspace_payroll_policies').get(),original,'Rejected changes cannot alter policy or audit history.');
      }
    }
    db.sqlite.close();
  }
});

test('immutable saved periods still allow new dated revisions, explicit same-date no-ops and group metadata changes',async()=>{
  const {db}=await setup(),saved=policy([],[group()]);await reviewedSave(db,saved);
  const original=(await read(db)).body.policy.groups[0].revisions[0];
  const noOp=await reviewedSave(db,saved,1);assert.equal(noOp.version,1);assert.deepEqual(noOp.policy.groups[0].revisions[0],original);
  const next=structuredClone(saved),from=add(today,7);next.groups[0].revisions.push({id:'new-period',from,payroll:config(19000,from)});
  const extended=await reviewedSave(db,next,1);assert.equal(extended.version,2);assert.deepEqual(extended.policy.groups[0].revisions[0],original);assert.equal(extended.policy.groups[0].revisions[1].from,from);
  const meta=structuredClone(extended.policy);meta.groups[0].name='Nyt navn på samme gruppe';meta.groups[0].archived=true;
  const archived=await reviewedSave(db,meta,2);assert.equal(archived.version,3);assert.equal(archived.policy.groups[0].name,'Nyt navn på samme gruppe');assert.equal(archived.policy.groups[0].archived,true);assert.deepEqual(archived.policy.groups[0].revisions,extended.policy.groups[0].revisions);
  db.sqlite.close();
});
