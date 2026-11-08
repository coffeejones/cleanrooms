const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Engagement=require('../lib/engagement-store.mjs');
const Publication=require('../src/publication-model.js'),Workflow=require('../src/shift-workflow-model.js'),Checklist=require('../src/checklist-progress.js'),Departments=require('../src/department-model.js');
const owner={id:'engagement-owner',email:'owner@example.com'},alex={id:'engagement-alex',email:'alex@example.com'},bea={id:'engagement-bea',email:'bea@example.com'};
const rich=JSON.stringify({type:'doc',content:[{type:'taskList',content:['Rengør bordene','Lås bygningen'].map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]});
const own={id:'engagement-own',person:'p1',date:'2090-01-10',site:0,start:'07:00',end:'15:00',note:'',noteRich:rich};

test('long valid checklist publication uses bounded parameter documents and preserves only matching tasks',async()=>{
 const {db,workspaceId}=await setup(),doc=last=>JSON.stringify({type:'doc',content:[{type:'taskList',content:Array.from({length:24000},(_,index)=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:index===23999?last:'Task '+index}]}]}))}]}),before={...own,noteRich:doc('Before')},after={...own,noteRich:doc('After')},oldView=Checklist.read({},before),hash=async value=>'sha256:'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex'),structure=await hash(JSON.stringify(oldView.tasks.map(task=>task.key))),insert=db.sqlite.prepare('INSERT INTO workspace_checklist_tasks VALUES (?,?,?,?,?,?,1,1,?)');
 assert.equal(oldView.tasks.length,24000);for(const task of [oldView.tasks[0],oldView.tasks.at(-1)])insert.run(workspaceId,own.id,own.person,task.key,await hash(task.signature),structure,'2026-11-03T00:00:00.000Z');insert.run(workspaceId,'unrelated',own.person,'task',await hash('untouched'),structure,'2026-11-03T00:00:00.000Z');
 const apply=await Engagement.preparePublicationEngagement({db,workspaceId,beforeShifts:[before],afterShifts:[after],sites:Departments.defaultOrganization().sites,at:'2026-11-03T00:00:00.000Z'}),statements=apply({sql:'1=1',values:[]}),cleanup=statements.find(statement=>statement.sql.includes('valid_task'));
 assert.ok(cleanup.sql.includes('UNION ALL'));assert.ok(Buffer.byteLength(cleanup.sql)<100*1024);assert.ok(cleanup.values.length<100);const documents=cleanup.values.filter(value=>typeof value==='string'&&value.startsWith('['));assert.ok(documents.length>1);assert.ok(documents.every(value=>Buffer.byteLength(value)<=512*1024));assert.ok(documents.reduce((sum,value)=>sum+Buffer.byteLength(value),0)>2*1024*1024);
 await db.batch(statements);assert.deepEqual(db.sqlite.prepare('SELECT task_key FROM workspace_checklist_tasks WHERE workspace_id=? AND shift_id=?').all(workspaceId,own.id).map(row=>row.task_key),[oldView.tasks[0].key]);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_checklist_tasks WHERE shift_id=?').get('unrelated').n,1);db.sqlite.close();
});
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{assert.ok(values.length<=100,'D1 allows at most 100 bound parameters per statement');const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const request=(method,body,principal=owner)=>new Request('https://cleanrooms.example/api/'+(method==='POST'?'accounts':'studio'),{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async value=>{const r=await value;return {status:r.status,body:await r.json()};};
const action=(db,action,payload={},person=owner)=>json(Workspace.handleAccountsRequest(request('POST',{action,...payload},person),db));
const get=(db,person=owner)=>json(Workspace.handleWorkspaceStudioRequest(request('GET',undefined,person),db));
const put=(db,revision,studio)=>json(Workspace.handleWorkspaceStudioRequest(request('PUT',{revision,studio}),db));
async function setup(){
 const db=database();let studio={storageVersion:1,demoSeed:false,roster:[['p1','Alex'],['p2','Bea']].map(([id,name])=>({id,name,initials:name[0],active:true,site:0,target:37,role:'Service'})),organization:Departments.defaultOrganization(),series:[],edits:{[own.id]:own,'engagement-open':{...own,id:'engagement-open',person:'',date:'2090-01-11'}},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}};
 studio=Publication.publish(studio,{from:'2090-01-09',to:'2090-01-15',siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-11-03T00:00:00.000Z'}).studio;
 studio.shiftWorkflow=Workflow.publicationMessages(undefined,[],Publication.publishedShifts(studio),{at:'2026-11-03T00:00:00.000Z',sites:studio.organization.sites});
 await Store.writeStudio(db,owner.id,0,studio);const loaded=await get(db);assert.equal(loaded.status,200,JSON.stringify(loaded));
 for(const [person,personId]of [[alex,'p1'],[bea,'p2']]){const invite=await action(db,'invite',{email:person.email,roleId:'employee',personId});assert.equal(invite.status,200);assert.equal((await action(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},person)).status,200);}
 return {db,workspaceId:loaded.body.workspace.id};
}
function completionPayload(index=0,checked=true){const view=Checklist.read({},own);return {revision:1,shiftId:own.id,key:view.tasks[index].key,signature:view.signature,checked};}
async function employeeDetail(db){const detail=await action(db,'employeeShift',{shiftId:own.id},alex);assert.equal(detail.status,200,JSON.stringify(detail));return detail.body;}

test('checklist updates preserve plan revision and different concurrent task writes survive a planner save',async()=>{
 const {db}=await setup(),planner=await get(db);let nested=false;
 db.beforeBatch=async statements=>{if(!nested&&statements.some(s=>s.sql.includes('INSERT INTO workspace_checklist_tasks'))){nested=true;const result=await action(db,'checklist',completionPayload(1),alex);assert.equal(result.status,200,JSON.stringify(result));}};
 const first=await action(db,'checklist',completionPayload(),alex);db.beforeBatch=null;assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.revision,1);assert.equal(Checklist.read(first.body.progress,own).checked,2);assert.equal((await Store.readStudio(db,owner.id)).revision,1);
 planner.body.studio.edits[own.id].note='Planlæggerens samtidige ændring';assert.equal((await put(db,planner.body.revision,planner.body.studio)).status,200);
 const employee=await employeeDetail(db);assert.equal(Checklist.read(employee.progress,employee.shift).checked,2);assert.equal((await Store.readStudio(db,owner.id)).studio.checklistProgress[JSON.stringify([own.id,own.person])],undefined);db.sqlite.close();
});

test('offers, colleague responses and claims use independent row versions and never invalidate a planner draft',async()=>{
 const {db}=await setup(),planner=await get(db),view=(await action(db,'workflowRead',{},alex)).body,shift=view.ownShifts.find(s=>s.id===own.id);
 const offered=await action(db,'workflowRequest',{kind:'offer',shiftId:shift.id,toPersonId:'p2',fingerprint:shift.fingerprint},alex);assert.equal(offered.status,200,JSON.stringify(offered));let offer=offered.body.requests.find(r=>r.shift.id===shift.id);
 const accepted=await action(db,'workflowRespond',{requestId:offer.id,version:offer.version,decision:'accept'},bea);assert.equal(accepted.status,200,JSON.stringify(accepted));offer=accepted.body.requests.find(r=>r.id===offer.id);assert.equal(offer.version,2);assert.equal((await Store.readStudio(db,owner.id)).revision,1);
 const open=(await action(db,'workflowRead',{},bea)).body.openShifts[0];assert.equal((await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},bea)).status,200);assert.equal((await Store.readStudio(db,owner.id)).revision,1);
 planner.body.studio.edits[own.id].note='Kladde fortsat gyldig';assert.equal((await put(db,planner.body.revision,planner.body.studio)).status,200);assert.equal((await action(db,'workflowRead')).body.requests.length,2);db.sqlite.close();
});

test('read receipts govern unread priority and paging without deleting older unread messages or closed requests',async()=>{
 const {db,workspaceId}=await setup(),stamp='2026-11-03T00:00:00.000Z',insert=db.sqlite.prepare('INSERT INTO workspace_shift_messages VALUES (?,?,?,?,?,?)'),receipt=db.sqlite.prepare('INSERT INTO workspace_message_receipts VALUES (?,?,?,?)');
 db.sqlite.exec('BEGIN');for(let i=0;i<12010;i++){const id='retention-'+String(i).padStart(6,'0'),message={id,personId:'p1',kind:'new',createdAt:stamp,readAt:null,before:null,after:Workflow.summary(own),summary:'Test'};insert.run(workspaceId,id,'p1','new',stamp,JSON.stringify(message));if(i)receipt.run(workspaceId,id,'p1',stamp);}db.sqlite.exec('COMMIT');
 const page=await action(db,'workflowRead',{limit:20},alex);assert.equal(page.status,200,JSON.stringify(page));assert.equal(page.body.notifications.length,20);assert.ok(page.body.notifications.some(m=>m.id==='retention-000000'));assert.equal(page.body.unreadCount,2);assert.ok(page.body.pagination.messages);
 const next=await action(db,'workflowRead',{limit:20,messageCursor:page.body.pagination.messages},alex);assert.equal(next.status,200);assert.equal(next.body.notifications.some(message=>page.body.notifications.some(old=>old.id===message.id)),false);
 const read=await action(db,'workflowReadMessage',{messageId:'retention-000000'},alex);assert.equal(read.status,200);assert.equal(read.body.unreadCount,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages WHERE workspace_id=?').get(workspaceId).n,12011);assert.equal((await Store.readStudio(db,owner.id)).revision,1);db.sqlite.close();
});

test('checklist authorization is fenced at commit and cannot affect another employee task',async()=>{
 const {db,workspaceId}=await setup();assert.equal((await action(db,'checklist',completionPayload(),bea)).status,403);let revoked=false;
 db.beforeBatch=async statements=>{if(!revoked&&statements.some(s=>s.sql.includes('INSERT INTO workspace_checklist_tasks'))){revoked=true;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(alex.id);}};
 const result=await action(db,'checklist',completionPayload(),alex);assert.equal(result.status,403,JSON.stringify(result));assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_checklist_tasks WHERE workspace_id=?').get(workspaceId).n,0);assert.equal((await Store.readStudio(db,owner.id)).revision,1);db.sqlite.close();
});

test('legacy import marker is idempotent and later stale snapshot data cannot overwrite durable engagement',async()=>{
 const {db,workspaceId}=await setup();const result=await action(db,'checklist',completionPayload(),alex);assert.equal(result.status,200);
 const before=db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages WHERE workspace_id=?').get(workspaceId).n;await get(db);await get(db,alex);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages WHERE workspace_id=?').get(workspaceId).n,before);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_engagement_imports WHERE workspace_id=?').get(workspaceId).n,1);
 const planner=await get(db);planner.body.studio.checklistProgress={};planner.body.studio.shiftWorkflow=Workflow.empty();assert.equal((await put(db,planner.body.revision,planner.body.studio)).status,200);assert.equal(Checklist.read((await employeeDetail(db)).progress,own).checked,1);assert.equal((await action(db,'workflowRead',{},alex)).body.notifications.length,1);db.sqlite.close();
});

test('concurrent claims on one open occurrence preserve both independent requests without plan contention',async()=>{
 const {db}=await setup(),open=(await action(db,'workflowRead',{},bea)).body.openShifts[0];let nested=false;
 db.beforeBatch=async statements=>{if(!nested&&statements.some(s=>s.sql.includes('INSERT INTO workspace_shift_requests'))){nested=true;const other=await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},alex);assert.equal(other.status,200,JSON.stringify(other));}};
 const result=await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},bea);db.beforeBatch=null;assert.equal(result.status,200,JSON.stringify(result));assert.ok(nested);assert.equal((await action(db,'workflowRead')).body.requests.length,2);assert.equal((await Store.readStudio(db,owner.id)).revision,1);db.sqlite.close();
});

test('a concurrent request cancellation fences the approved transfer, all generated messages and the plan together',async()=>{
 const {db}=await setup(),shift=(await action(db,'workflowRead',{},alex)).body.ownShifts[0];const offered=await action(db,'workflowRequest',{kind:'offer',shiftId:shift.id,fingerprint:shift.fingerprint,toPersonId:'p2'},alex);let offer=offered.body.requests[0];offer=(await action(db,'workflowRespond',{requestId:offer.id,version:offer.version,decision:'accept'},bea)).body.requests.find(item=>item.id===offer.id);
 const messageCount=db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages').get().n;let intercepted=false;
 db.beforeBatch=async statements=>{if(!intercepted&&statements.some(s=>s.sql.includes('UPDATE studio_states SET revision'))){intercepted=true;const cancelled={...offer,status:'cancelled',version:offer.version+1};db.sqlite.prepare('UPDATE workspace_shift_requests SET version=?,status=?,config=? WHERE id=?').run(cancelled.version,cancelled.status,JSON.stringify(cancelled),offer.id);}};
 const result=await action(db,'workflowDecide',{requestId:offer.id,version:offer.version,studioRevision:1,decision:'approve'});db.beforeBatch=null;assert.equal(result.status,409,JSON.stringify(result));assert.ok(intercepted);assert.equal((await Store.readStudio(db,owner.id)).revision,1);assert.equal(Publication.publishedShifts((await Store.readStudio(db,owner.id)).studio).find(item=>item.id===shift.id).person,'p1');assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages').get().n,messageCount);assert.equal((await action(db,'workflowRead')).body.requests.find(item=>item.id===offer.id).status,'cancelled');db.sqlite.close();
});

test('publication preserves unchanged checked tasks and permanently removes changed task signatures before undo-like edits',async()=>{
 const {db}=await setup();await action(db,'checklist',completionPayload(0),alex);await action(db,'checklist',completionPayload(1),alex);
 let planner=await get(db),changed=JSON.parse(rich);changed.content[0].content[0].content[0].content[0].text='Rengør borde og stole';planner.body.studio.edits[own.id].noteRich=JSON.stringify(changed);
 const publish=body=>json(Workspace.handleWorkspaceStudioRequest(request('PUT',{revision:body.revision,studio:body.studio,publication:{from:'2090-01-09',to:'2090-01-15',siteIds:[0]}}),db));
 assert.equal((await publish(planner.body)).status,200);let employee=await employeeDetail(db),shift=employee.shift;assert.equal(Checklist.read(employee.progress,shift).checked,1);
 planner=await get(db);planner.body.studio.edits[own.id].noteRich=rich;assert.equal((await publish(planner.body)).status,200);employee=await employeeDetail(db);shift=employee.shift;assert.equal(Checklist.read(employee.progress,shift).checked,1,'A removed signature must not revive when old text returns');db.sqlite.close();
});

test('legacy engagement backfill is fenced by source plan revision and a retry imports only the latest snapshot',async()=>{
 const {db,workspaceId}=await setup();db.sqlite.prepare('DELETE FROM workspace_engagement_imports WHERE workspace_id=?').run(workspaceId);db.sqlite.prepare('DELETE FROM workspace_shift_messages WHERE workspace_id=?').run(workspaceId);let intercepted=false;
 db.beforeBatch=async statements=>{if(!intercepted&&statements.some(s=>s.sql.includes('INSERT INTO workspace_engagement_imports'))){intercepted=true;const saved=await Store.readStudio(db,owner.id);saved.studio.edits[own.id].note='Concurrent plan while migrating';await Store.writeStudio(db,owner.id,saved.revision,saved.studio);}};
 const firstRead=await get(db);db.beforeBatch=null;assert.equal(firstRead.status,409,JSON.stringify(firstRead));assert.ok(intercepted);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_engagement_imports').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages').get().n,0);
 const retry=await get(db);assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(retry.body.revision,2);assert.equal(retry.body.studio.edits[own.id].note,'Concurrent plan while migrating');assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_engagement_imports').get().n,1);assert.equal((await action(db,'workflowRead',{},alex)).body.notifications.length,1);db.sqlite.close();
});

test('a newly arriving competing claim fences transfer until every claim can close in the same transaction',async()=>{
 const {db}=await setup(),open=(await action(db,'workflowRead',{},alex)).body.openShifts[0],claimed=await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},alex),winner=claimed.body.requests.find(request=>request.shift.id===open.id);let intercepted=false;
 db.beforeBatch=async statements=>{if(!intercepted&&statements.some(statement=>statement.sql.includes('UPDATE studio_states SET revision'))){intercepted=true;assert.equal((await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},bea)).status,200);}};
 const result=await action(db,'workflowDecide',{requestId:winner.id,version:winner.version,studioRevision:1,decision:'approve'});db.beforeBatch=null;assert.equal(result.status,409,JSON.stringify(result));assert.ok(intercepted);assert.equal((await Store.readStudio(db,owner.id)).revision,1);assert.equal((await action(db,'workflowRead')).body.requests.filter(request=>request.status==='pending').length,2);
 const retry=await action(db,'workflowDecide',{requestId:winner.id,version:winner.version,studioRevision:1,decision:'approve'});assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(retry.body.requests.find(request=>request.id===winner.id).status,'approved');const loser=(await action(db,'workflowRead',{},bea)).body;assert.equal(loser.requests.find(request=>request.shift.id===open.id).status,'stale');assert.ok(loser.notifications.some(message=>message.summary.includes('tildelt en anden')));db.sqlite.close();
});

test('transfer of a shift with 500 competing requests keeps version guards within D1 parameter limits',async()=>{
 const {db,workspaceId}=await setup(),open=(await action(db,'workflowRead',{},alex)).body.openShifts[0],claimed=await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},alex),winner=claimed.body.requests[0],insert=db.sqlite.prepare('INSERT INTO workspace_shift_requests (workspace_id,id,shift_id,kind,from_person_id,to_person_id,status,version,config,updated_at,write_token) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
 db.sqlite.exec('BEGIN');for(let i=0;i<500;i++){const personId='person-competing-'+i,request={...winner,id:'competing-'+i,fromPersonId:personId,toPersonId:personId};insert.run(workspaceId,request.id,open.id,request.kind,personId,personId,'pending',1,JSON.stringify(request),request.updatedAt,'fixture');}db.sqlite.exec('COMMIT');
 const result=await action(db,'workflowDecide',{requestId:winner.id,version:winner.version,studioRevision:1,decision:'approve'});assert.equal(result.status,200,JSON.stringify(result));assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_shift_requests WHERE workspace_id=? AND shift_id=? AND status='stale'").get(workspaceId,open.id).n,500);assert.equal((await Store.readStudio(db,owner.id)).revision,2);db.sqlite.close();
});
