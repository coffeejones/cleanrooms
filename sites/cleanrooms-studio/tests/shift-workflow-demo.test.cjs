const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Publication=require('../src/publication-model.js'),Workflow=require('../src/shift-workflow-model.js'),Departments=require('../src/department-model.js'),Demo=require('../lib/shift-workflow-demo-store.mjs');
const owner={id:'demo-owner',email:'planner@example.com'},employee={id:'real-employee-account',email:'employee@example.com'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const request=(method,payload,principal=owner)=>new Request('https://cleanrooms.example/api/'+(method==='GET'?'studio':'accounts'),{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
const json=async result=>{const response=await result;return {status:response.status,body:await response.json()};};
const action=(db,payload,principal=owner)=>json(Workspace.handleAccountsRequest(request('POST',{...payload,action:'workflowDemo'},principal),db));
const otherAction=(db,action,payload={},principal=owner)=>json(Workspace.handleAccountsRequest(request('POST',{...payload,action},principal),db));
const read=(db,personId)=>action(db,{operation:'read',...(personId?{personId}:{})});
const act=(db,bundle,demoAction,payload={})=>action(db,{operation:'act',demoVersion:bundle.demoVersion,demoAction,...(bundle.personId?{personId:bundle.personId}:{}),...payload});
const liveState=db=>Store.readStudio(db,owner.id);
const demoRow=db=>db.sqlite.prepare('SELECT * FROM workspace_workflow_demo').get();
async function setup(){
 const db=database(),live={storageVersion:1,demoSeed:false,roster:[{id:'p1',name:'Real Employee',initials:'RE',active:true,site:0,target:37,role:'Medarbejder'}],organization:Departments.defaultOrganization(),series:[],edits:{live:{id:'live',person:'p1',date:'2090-01-10',start:'07:00',end:'15:00',site:0,note:'Real instruction'}},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{},shiftWorkflow:Workflow.empty()};
 const published=Publication.publish(live,{from:'2090-01-09',to:'2090-01-15',siteIds:[0],actor:{userId:owner.id,name:'Planner'},at:'2026-11-02T10:00:00.000Z'}).studio;
 await Store.writeStudio(db,owner.id,0,published);assert.equal((await json(Workspace.handleWorkspaceStudioRequest(request('GET'),db))).status,200);
 const invited=await otherAction(db,'invite',{email:employee.email,roleId:'employee',personId:'p1'});assert.equal(invited.status,200,JSON.stringify(invited.body));assert.equal((await otherAction(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},employee)).status,200);return db;
}

test('demo seed contains distinct isolated people, varied messages and actionable scenarios',()=>{
 const state=Demo.seedWorkflowDemo('2026-11-02T08:00:00.000Z');assert.equal(state.people.length,4);assert.ok(state.people.every(person=>person.id.startsWith('demo-')));assert.ok(state.shifts.every(shift=>shift.date>'2026-11-02'));
 assert.deepEqual(Workflow.validate(state.workflow),[]);for(const kind of ['new','changed','moved','cancelled','request'])assert.ok(state.workflow.notifications.some(message=>message.kind===kind),kind);assert.ok(state.workflow.notifications.some(message=>message.readAt));assert.ok(state.workflow.notifications.some(message=>!message.readAt));for(const status of ['pending','awaiting_colleague','approved','rejected'])assert.ok(state.workflow.requests.some(request=>request.status===status),status);
});

test('read seeds once, reuses its own revision and never edits the live plan or receipt table',async()=>{
 const db=await setup(),before=await liveState(db),first=await read(db);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.demo,true);assert.equal(first.body.preview,false);assert.equal(first.body.canManage,true);assert.ok(first.body.requests.length>=7);assert.ok(first.body.deliveries.length>0);
 const second=await read(db);assert.equal(second.body.demoVersion,first.body.demoVersion);assert.equal(second.body.serverNow,first.body.serverNow);assert.deepEqual(second.body.requests,first.body.requests);assert.deepEqual(await liveState(db),before);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts').get().n,0);
 const real=(await otherAction(db,'workflowRead',{},employee)).body;assert.equal(real.notifications.length,0);assert.equal(real.requests.length,0);assert.equal(real.ownShifts[0].id,'live');db.sqlite.close();
});

test('real employees cannot enter, reset or mutate demo state, and foreign demo identities are rejected',async()=>{
 const db=await setup();for(const operation of ['read','reset','clear','act'])assert.equal((await action(db,{operation,demoAction:'workflowDecide'},employee)).status,403);assert.equal(demoRow(db),undefined);
 assert.equal((await read(db,'p1')).status,400);assert.equal(demoRow(db),undefined);assert.equal((await read(db,'demo-emma')).body.canManage,false);assert.equal((await read(db,'demo-emma')).body.personId,'demo-emma');db.sqlite.close();
});

test('demo message reads update only the chosen demo person and are idempotent',async()=>{
 const db=await setup(),before=await liveState(db),emma=(await read(db,'demo-emma')).body,message=emma.notifications.find(item=>!item.readAt);assert.ok(message);
 const seen=await act(db,emma,'workflowReadMessage',{messageId:message.id});assert.equal(seen.status,200);assert.equal(seen.body.unreadCount,emma.unreadCount-1);assert.ok(seen.body.notifications.find(item=>item.id===message.id).readAt);
 assert.equal((await act(db,seen.body,'workflowReadMessage',{messageId:message.id})).body.demoVersion,seen.body.demoVersion);const manager=(await read(db)).body;assert.ok(manager.deliveries.find(item=>item.id===message.id).readAt);
 const noah=(await read(db,'demo-noah')).body;assert.equal((await act(db,noah,'workflowReadMessage',{messageId:message.id})).status,404);assert.equal((await act(db,manager,'workflowReadMessage',{messageId:message.id})).status,403);assert.deepEqual(await liveState(db),before);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts').get().n,0);db.sqlite.close();
});

test('approving a demo claim assigns only the demo shift and leaves all live records byte-for-byte unchanged',async()=>{
 const db=await setup(),before=await liveState(db),activityBefore=db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_activity').get().n,manager=(await read(db)).body,claim=manager.requests.find(item=>item.id==='demo-request-claim');assert.equal(claim.canApprove,undefined);
 const approved=await act(db,manager,'workflowDecide',{requestId:claim.id,version:claim.version,decision:'approve'});assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.planChanged,false);assert.equal(approved.body.demoPlanChanged,true);assert.equal(approved.body.requests.find(item=>item.id===claim.id).status,'approved');assert.equal(approved.body.demoShifts.find(item=>item.id===claim.shift.id).person,'demo-emma');
 const emma=(await read(db,'demo-emma')).body;assert.ok(emma.ownShifts.some(item=>item.id===claim.shift.id));assert.ok(emma.notifications.some(item=>item.kind==='request'&&item.summary.includes('godkendt')));assert.deepEqual(await liveState(db),before);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_activity').get().n,activityBefore);db.sqlite.close();
});

test('demo offers require the receiving colleague before a planner can approve',async()=>{
 const db=await setup(),manager=(await read(db)).body,incoming=manager.requests.find(item=>item.status==='awaiting_colleague');assert.ok(incoming);
 assert.equal((await act(db,manager,'workflowDecide',{requestId:incoming.id,version:incoming.version,decision:'approve'})).status,409);
 const wrong=(await read(db,incoming.fromPersonId)).body;assert.equal((await act(db,wrong,'workflowRespond',{requestId:incoming.id,version:incoming.version,decision:'accept'})).status,403);
 const recipient=(await read(db,incoming.toPersonId)).body,accepted=await act(db,recipient,'workflowRespond',{requestId:incoming.id,version:incoming.version,decision:'accept'});assert.equal(accepted.status,200,JSON.stringify(accepted.body));const requestAfter=accepted.body.requests.find(item=>item.id===incoming.id);assert.equal(requestAfter.status,'pending');
 const planner=(await read(db)).body,approved=await act(db,planner,'workflowDecide',{requestId:incoming.id,version:requestAfter.version,decision:'approve'});assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.demoShifts.find(item=>item.id===incoming.shift.id).person,incoming.toPersonId);db.sqlite.close();
});

test('blocked overlap and approved leave are visible and still rejected by direct demo approval calls',async()=>{
 const db=await setup(),manager=(await read(db)).body;
 for(const [suffix,reason]of [['overlap','overlappende'],['leave','godkendt fravær']]){const item=manager.requests.find(request=>request.id==='demo-request-'+suffix);assert.ok(item.blockedReason.includes(reason));assert.equal(item.canApprove,false);const result=await act(db,manager,'workflowDecide',{requestId:item.id,version:item.version,decision:'approve'});assert.equal(result.status,409);assert.ok(result.body.message.includes(reason));}
 assert.equal((await read(db)).body.demoVersion,manager.demoVersion);db.sqlite.close();
});

test('rejection requires a reason, retains the full comment and creates a demo-only response',async()=>{
 const db=await setup(),manager=(await read(db)).body,item=manager.requests.find(request=>request.id==='demo-request-claim');assert.equal((await act(db,manager,'workflowDecide',{requestId:item.id,version:item.version,decision:'reject'})).status,400);
 const reason='Vi har aftalt en anden bemanding. '+('En længere begrundelse. '.repeat(200)),rejected=await act(db,manager,'workflowDecide',{requestId:item.id,version:item.version,decision:'reject',reason});assert.equal(rejected.status,200);assert.equal(rejected.body.requests.find(request=>request.id===item.id).decisionReason,reason.trim());const own=(await read(db,item.fromPersonId)).body;assert.ok(own.notifications.some(message=>message.kind==='request'&&message.summary.includes('afvist')));db.sqlite.close();
});

test('demo users can create an offer or claim, while ownership, duplicate and fingerprint checks remain enforced',async()=>{
 const db=await setup(),emma=(await read(db,'demo-emma')).body,own=emma.ownShifts.find(shift=>shift.id==='demo-shift-own');
 assert.equal((await act(db,emma,'workflowRequest',{kind:'offer',shiftId:own.id,fingerprint:'stale',toPersonId:'demo-jonas'})).status,409);
 const offered=await act(db,emma,'workflowRequest',{kind:'offer',shiftId:own.id,fingerprint:own.fingerprint,toPersonId:'demo-jonas',comment:'Kan du hjælpe?'});assert.equal(offered.status,200,JSON.stringify(offered.body));const item=offered.body.requests.find(request=>request.shift.id===own.id);assert.equal(item.status,'awaiting_colleague');
 const repeated=await act(db,offered.body,'workflowRequest',{kind:'offer',shiftId:own.id,fingerprint:own.fingerprint,toPersonId:'demo-jonas'});assert.equal(repeated.status,200);assert.equal(repeated.body.demoVersion,offered.body.demoVersion);assert.equal(repeated.body.requests.filter(request=>request.shift.id===own.id).length,1);
 const cancelled=await act(db,repeated.body,'workflowRespond',{requestId:item.id,version:item.version,decision:'cancel'});assert.equal(cancelled.status,200);assert.equal(cancelled.body.requests.find(request=>request.id===item.id).status,'cancelled');
 const sara=(await read(db,'demo-sara')).body,available=sara.openShifts.find(shift=>shift.id==='demo-shift-available'),claimed=await act(db,sara,'workflowRequest',{kind:'claim',shiftId:available.id,fingerprint:available.fingerprint});assert.equal(claimed.status,200);assert.equal(claimed.body.requests.find(request=>request.shift.id===available.id).status,'pending');db.sqlite.close();
});

test('stale demo revisions and request versions cannot overwrite newer demo decisions',async()=>{
 const db=await setup(),old=(await read(db)).body,item=old.requests.find(request=>request.id==='demo-request-claim');const reset=await action(db,{operation:'reset',demoVersion:old.demoVersion});assert.equal(reset.status,200);
 assert.equal((await act(db,old,'workflowDecide',{requestId:item.id,version:item.version,decision:'approve'})).status,409);assert.equal((await act(db,reset.body,'workflowDecide',{requestId:item.id,version:99,decision:'approve'})).status,409);
 let intercepted=false;db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes('UPDATE workspace_workflow_demo SET config'))){intercepted=true;db.sqlite.prepare('UPDATE workspace_workflow_demo SET version = version+1').run();}};
 const result=await act(db,reset.body,'workflowDecide',{requestId:item.id,version:item.version,decision:'approve'});assert.equal(result.status,409);assert.ok(intercepted);assert.equal((await read(db)).body.requests.find(request=>request.id===item.id).status,'pending');db.sqlite.close();
});

test('commit-time planner access revocation fences the complete demo mutation',async()=>{
 const db=await setup(),manager=(await read(db)).body,item=manager.requests.find(request=>request.id==='demo-request-claim'),rowBefore=demoRow(db);let intercepted=false;
 db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes('UPDATE workspace_workflow_demo SET config'))){intercepted=true;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(owner.id);}};
 const result=await act(db,manager,'workflowDecide',{requestId:item.id,version:item.version,decision:'approve'});assert.equal(result.status,403);assert.ok(intercepted);assert.equal(demoRow(db).version,rowBefore.version);assert.equal(demoRow(db).config,rowBefore.config);db.sqlite.close();
});

test('clear and reset affect only the sandbox and never erase live notifications or plans',async()=>{
 const db=await setup(),before=await liveState(db),loaded=(await read(db)).body,cleared=await action(db,{operation:'clear',demoVersion:loaded.demoVersion});assert.equal(cleared.status,200);assert.equal(cleared.body.demoActive,false);assert.equal(cleared.body.requests.length,0);assert.equal(cleared.body.deliveries.length,0);assert.equal((await read(db)).body.demoActive,false);
 assert.equal((await act(db,cleared.body,'workflowDecide',{requestId:'demo-request-claim',version:1,decision:'approve'})).status,409);const reset=await action(db,{operation:'reset',demoVersion:cleared.body.demoVersion});assert.equal(reset.status,200);assert.equal(reset.body.demoActive,true);assert.ok(reset.body.requests.length>0);assert.deepEqual(await liveState(db),before);db.sqlite.close();
});

test('identical demo IDs in different workspaces never share decisions or read receipts',async()=>{
 const db=await setup(),one=(await read(db,'demo-emma')).body,other={id:'other-planner',email:'other@example.com'},saved=await liveState(db);
 await Store.writeStudio(db,other.id,0,saved.studio);assert.equal((await json(Workspace.handleWorkspaceStudioRequest(request('GET',undefined,other),db))).status,200);
 const otherView=await action(db,{operation:'read',personId:'demo-emma'},other);assert.equal(otherView.status,200);const message=one.notifications.find(item=>!item.readAt),seen=await act(db,one,'workflowReadMessage',{messageId:message.id});assert.equal(seen.status,200);
 const stillUnread=await action(db,{operation:'read',personId:'demo-emma'},other);assert.equal(stillUnread.body.notifications.find(item=>item.id===message.id).readAt,null);
 assert.equal((await action(db,{operation:'clear',demoVersion:otherView.body.demoVersion},other)).status,200);assert.equal((await read(db)).body.demoActive,true);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_workflow_demo').get().n,2);db.sqlite.close();
});
