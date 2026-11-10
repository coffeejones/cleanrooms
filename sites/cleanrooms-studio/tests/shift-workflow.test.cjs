const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Publication=require('../src/publication-model.js'),Workflow=require('../src/shift-workflow-model.js'),Departments=require('../src/department-model.js');
const Availability=require('../lib/employee-availability.mjs');
const owner={id:'owner',email:'owner@example.com'},alex={id:'alex-account',email:'alex@example.com'},bea={id:'bea-account',email:'bea@example.com'},cara={id:'cara-account',email:'cara@example.com'};
const people=[['p1','Alex'],['p2','Bea'],['p6','Cara']].map(([id,name])=>({id,name,initials:name[0],active:true,site:0,target:37,role:'Servicemedarbejder'}));
const shift=(patch={})=>({id:'own',person:'p1',date:'2090-01-10',site:0,start:'07:00',end:'15:00',note:'Arbejdsinstruktion',...patch});
const draft=(patch={})=>({storageVersion:1,demoSeed:false,roster:people,organization:Departments.defaultOrganization(),series:[],edits:{own:shift(),open:shift({id:'open',person:'',site:1}),other:shift({id:'other',date:'2090-01-11'})},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{},...patch});
const weekFor=day=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const from=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {from,to:date.toISOString().slice(0,10),siteIds:[0,1,2]};};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const req=(method,body,principal=owner)=>new Request('https://cleanrooms.example/api/'+(method==='PUT'||method==='GET'?'studio':'accounts'),{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async response=>{response=await response;return {status:response.status,body:await response.json()};};
const action=(db,action,payload={},principal=owner)=>json(Workspace.handleAccountsRequest(req('POST',{...payload,action},principal),db));
const state=db=>Store.readStudio(db,owner.id);
async function plan(db,studio,publication){const saved=await state(db);return json(await Workspace.handleWorkspaceStudioRequest(req('PUT',{revision:saved.revision,studio,...(publication?{publication}:{})}),db));}
async function publish(db,scope){const saved=await state(db);const result=await plan(db,saved.studio,scope||weekFor(shift().date));assert.equal(result.status,200,JSON.stringify(result.body));return result;}
async function setup(studio=draft()){
 const db=database();await Store.writeStudio(db,owner.id,0,studio);await Workspace.handleWorkspaceStudioRequest(req('GET'),db);
 for(const [principal,personId] of [[alex,'p1'],[bea,'p2'],[cara,'p6']]){const invited=await action(db,'invite',{email:principal.email,roleId:'employee',personId});assert.equal(invited.status,200,JSON.stringify(invited.body));assert.equal((await action(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},principal)).status,200);}
 await publish(db);return db;
}
async function offer(db){const view=await action(db,'workflowRead',{},alex),own=view.body.ownShifts.find(item=>item.id==='own'),result=await action(db,'workflowRequest',{kind:'offer',shiftId:own.id,toPersonId:'p2',fingerprint:own.fingerprint,comment:'Kan du tage min vagt?'},alex);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.requests.find(item=>item.shift.id==='own');}
async function claim(db,principal=bea){const view=await action(db,'workflowRead',{},principal),open=view.body.openShifts.find(item=>item.id==='open'),result=await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},principal);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.requests.find(item=>item.shift.id==='open');}
async function decide(db,request,decision='approve',extra={}){const saved=await state(db);return action(db,'workflowDecide',{requestId:request.id,version:request.version,studioRevision:saved.revision,decision,...extra});}
function markUnavailable(db,personId,dates,workspaceId=db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(owner.id).workspace_id){
 db.sqlite.prepare(`INSERT INTO workspace_employee_preferences(workspace_id,person_id,version,config,updated_at) VALUES (?,?,1,?,?)
   ON CONFLICT(workspace_id,person_id) DO UPDATE SET version=version+1,config=excluded.config,updated_at=excluded.updated_at`).run(workspaceId,personId,JSON.stringify({notifications:false,chatNotifications:false,privateField:'must-not-leak',unavailableDates:dates}),new Date().toISOString());
}

test('publication messages show exact changes and ownership while unchanged publications stay silent',()=>{
 const at='2026-11-02T08:00:00.000Z',sites=Departments.defaultOrganization().sites,original=shift();let workflow=Workflow.publicationMessages(undefined,[],[original],{at,sites});assert.equal(workflow.notifications[0].kind,'new');assert.equal(workflow.notifications[0].after.start,'07:00');
 workflow=Workflow.publicationMessages(workflow,[original],[original],{at,sites});assert.equal(workflow.notifications.length,1);
 const changed={...original,start:'08:00'};workflow=Workflow.publicationMessages(workflow,[original],[changed],{at,sites});assert.equal(workflow.notifications.at(-1).kind,'changed');assert.equal(workflow.notifications.at(-1).before.start,'07:00');assert.equal(workflow.notifications.at(-1).after.start,'08:00');
 const moved={...changed,date:'2090-01-12'};workflow=Workflow.publicationMessages(workflow,[changed],[moved],{at,sites});assert.equal(workflow.notifications.at(-1).kind,'moved');
 const transferred={...moved,person:'p2'};workflow=Workflow.publicationMessages(workflow,[moved],[transferred],{at,sites});assert.deepEqual(workflow.notifications.slice(-2).map(item=>[item.personId,item.kind]),[['p1','cancelled'],['p2','new']]);
 workflow=Workflow.publicationMessages(workflow,[transferred],[],{at,sites});assert.equal(workflow.notifications.at(-1).kind,'cancelled');assert.equal(workflow.notifications.at(-1).before.id,original.id);assert.deepEqual(Workflow.validate(workflow),[]);assert.equal(JSON.stringify(workflow).includes('Arbejdsinstruktion'),false);
});

test('publication creates durable private messages; planner preview cannot mark them read or impersonate employees',async()=>{
 const db=await setup(),personal=await action(db,'workflowRead',{},alex),other=await action(db,'workflowRead',{},bea);assert.equal(personal.status,200);assert.equal(personal.body.unreadCount,2);assert.equal(other.body.notifications.length,0);assert.deepEqual(personal.body.colleagues.map(item=>item.id).sort(),['p2','p6']);
 assert.equal((await action(db,'workflowRead',{personId:'p1'},bea)).status,403);
 const preview=await action(db,'workflowRead',{personId:'p1'});assert.equal(preview.body.preview,true);assert.equal(preview.body.canManage,false);assert.equal(preview.body.unreadCount,2);
 const message=personal.body.notifications[0];assert.equal((await action(db,'workflowReadMessage',{messageId:message.id})).status,403);assert.equal((await action(db,'workflowReadMessage',{messageId:message.id},bea)).status,404);
 const seen=await action(db,'workflowReadMessage',{messageId:message.id},alex);assert.equal(seen.status,200);assert.equal(seen.body.unreadCount,1);assert.ok(seen.body.notifications.find(item=>item.id===message.id).readAt);const currentRevision=seen.body.revision;assert.equal(currentRevision,personal.body.revision);
 assert.equal((await action(db,'workflowReadMessage',{messageId:message.id},alex)).body.revision,currentRevision);
 const manager=await action(db,'workflowRead');assert.equal(manager.body.canManage,true);assert.equal(manager.body.deliveries.find(item=>item.id===message.id).readAt,seen.body.notifications.find(item=>item.id===message.id).readAt);
 const saved=await state(db),forged=structuredClone(saved.studio);forged.shiftWorkflow=Workflow.empty();assert.equal((await plan(db,forged)).status,200);assert.equal((await action(db,'workflowRead',{},alex)).body.notifications.length,2);assert.ok((await action(db,'workflowRead',{},alex)).body.notifications.find(item=>item.id===message.id).readAt);db.sqlite.close();
});

test('message reads preserve the planner revision and cannot race past recipient access revocation',async()=>{
 const db=await setup(),before=await state(db),own=(await action(db,'workflowRead',{},alex)).body,message=own.notifications[0];
 const seen=await action(db,'workflowReadMessage',{messageId:message.id},alex);assert.equal(seen.status,200);assert.equal((await state(db)).revision,before.revision);assert.equal(JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_shift_messages WHERE id=?').get(message.id).config).readAt,null);
 const editor=structuredClone(before.studio);editor.edits.other.note='Planner saved after employee read';const saved=await json(Workspace.handleWorkspaceStudioRequest(req('PUT',{revision:before.revision,studio:editor}),db));assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal((await action(db,'workflowRead')).body.deliveries.find(item=>item.id===message.id).readAt,seen.body.notifications.find(item=>item.id===message.id).readAt);
 const unread=own.notifications.find(item=>item.id!==message.id);let intercepted=false;db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes('INSERT INTO workspace_message_receipts'))){intercepted=true;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(alex.id);}};
 assert.equal((await action(db,'workflowReadMessage',{messageId:unread.id},alex)).status,403);assert.ok(intercepted);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_message_receipts WHERE message_id=?').get(unread.id).n,0);assert.equal((await state(db)).revision,before.revision+1);db.sqlite.close();
});

test('older unread messages and active requests remain reachable beyond the recent history window',async()=>{
 const db=await setup(),saved=await state(db),base=(await action(db,'workflowRead',{},alex)).body.notifications[0],summary=Workflow.summary(Publication.publishedShifts(saved.studio).find(item=>item.id==='own'),saved.studio.organization.sites),at=new Date().toISOString();
 saved.studio.shiftWorkflow={version:1,sequence:350,notifications:Array.from({length:350},(_,index)=>({...structuredClone(base),id:'message-'+(index+1),readAt:index?at:null})),requests:Array.from({length:350},(_,index)=>({id:'request-'+index,version:1,kind:'offer',status:index?'approved':'pending',fromPersonId:'p1',toPersonId:'p2',shift:summary,comment:'',createdAt:at,updatedAt:at,decisionReason:''}))};
 const workspaceId=db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(owner.id).workspace_id;db.sqlite.prepare('DELETE FROM workspace_shift_messages WHERE workspace_id=?').run(workspaceId);for(const message of saved.studio.shiftWorkflow.notifications)db.sqlite.prepare('INSERT INTO workspace_shift_messages (workspace_id,id,person_id,kind,created_at,config) VALUES (?,?,?,?,?,?)').run(workspaceId,message.id,message.personId,message.kind,message.createdAt,JSON.stringify(message));for(const request of saved.studio.shiftWorkflow.requests)db.sqlite.prepare('INSERT INTO workspace_shift_requests (workspace_id,id,shift_id,kind,from_person_id,to_person_id,status,version,config,updated_at,write_token) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(workspaceId,request.id,request.shift.id,request.kind,request.fromPersonId,request.toPersonId,request.status,request.version,JSON.stringify(request),request.updatedAt,'fixture');const own=(await action(db,'workflowRead',{},alex)).body;assert.equal(own.unreadCount,1);assert.equal(own.notifications.length,350);assert.ok(own.notifications.some(item=>item.id==='message-1'));assert.ok(own.requests.some(item=>item.id==='request-0'&&item.status==='pending'));assert.equal((await action(db,'workflowRead')).body.deliveries.length,350);assert.equal((await action(db,'workflowReadMessage',{messageId:'message-1'},alex)).body.unreadCount,0);db.sqlite.close();
});

test('published changes notify only after publication and cancellation remains readable after deletion',async()=>{
 const db=await setup();let saved=await state(db);saved.studio.edits.own.start='08:00';assert.equal((await plan(db,saved.studio)).status,200);assert.equal((await action(db,'workflowRead',{},alex)).body.notifications.length,2);await publish(db);let messages=(await action(db,'workflowRead',{},alex)).body.notifications;assert.equal(messages.length,3);assert.equal(messages[0].before.start,'07:00');assert.equal(messages[0].after.start,'08:00');await publish(db);assert.equal((await action(db,'workflowRead',{},alex)).body.notifications.length,3);
 saved=await state(db);saved.studio.deleted.push('own');await plan(db,saved.studio);await publish(db);messages=(await action(db,'workflowRead',{},alex)).body.notifications;assert.equal(messages[0].kind,'cancelled');assert.equal(messages[0].before.id,'own');assert.equal(messages[0].after,null);assert.equal((await action(db,'workflowReadMessage',{messageId:messages[0].id},alex)).status,200);db.sqlite.close();
});

test('offer needs recipient consent and planner approval transfers one occurrence without publishing unrelated drafts',async()=>{
 const db=await setup();let request=await offer(db);assert.equal(request.status,'awaiting_colleague');assert.equal((await decide(db,request)).status,409);assert.equal((await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},cara)).status,404);
 const accepted=await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea);assert.equal(accepted.status,200,JSON.stringify(accepted.body));request=accepted.body.requests.find(item=>item.id===request.id);assert.equal(request.status,'pending');
 const before=await state(db);before.studio.edits.other.start='08:30';await plan(db,before.studio);const approved=await decide(db,request);assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.planChanged,true);assert.equal(approved.body.requests.find(item=>item.id===request.id).status,'approved');
 const after=await state(db),published=Publication.publishedShifts(after.studio);assert.equal(after.studio.edits.own.person,'p2');assert.equal(published.find(item=>item.id==='own').person,'p2');assert.equal(after.studio.edits.other.start,'08:30');assert.equal(published.find(item=>item.id==='other').start,'07:00');assert.equal(after.studio.activity.at(-1).kind,'publication');
 assert.equal((await action(db,'workflowRead',{},alex)).body.ownShifts.some(item=>item.id==='own'),false);assert.equal((await action(db,'workflowRead',{},bea)).body.ownShifts.some(item=>item.id==='own'),true);assert.equal((await decide(db,request)).status,409);db.sqlite.close();
});

test('competing claims stay requests until approval and the losing claimant is informed',async()=>{
 const db=await setup(),winner=await claim(db,bea),loser=await claim(db,cara);assert.equal(Publication.publishedShifts((await state(db)).studio).find(item=>item.id==='open').person,'');assert.equal((await decide(db,winner)).status,200);const other=(await action(db,'workflowRead',{},cara)).body;assert.equal(other.requests.find(item=>item.id===loser.id).status,'stale');assert.ok(other.notifications.some(message=>message.summary.includes('tildelt en anden')));assert.equal((await decide(db,loser)).status,409);db.sqlite.close();
});

test('stale versions, wrong identities and an unseen planner revision cannot approve or respond',async()=>{
 const db=await setup();let request=await offer(db);assert.equal((await action(db,'workflowRespond',{requestId:request.id,version:99,decision:'accept'},bea)).status,409);assert.equal((await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},alex)).status,403);assert.equal((await action(db,'workflowRequest',{kind:'offer',shiftId:'own',fingerprint:request.shift.fingerprint,toPersonId:'p6'},bea)).status,403);
 request=(await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea)).body.requests.find(item=>item.id===request.id);assert.equal((await action(db,'workflowDecide',{requestId:request.id,version:request.version,studioRevision:0,decision:'approve'})).status,409);assert.equal((await action(db,'workflowDecide',{requestId:request.id,version:request.version,studioRevision:(await state(db)).revision,decision:'approve'},alex)).status,403);db.sqlite.close();
});

test('recipient can decline, sender can cancel, and rejection requires a reason retained in the request',async()=>{
 const db=await setup();let request=await offer(db);const declined=await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'decline'},bea);assert.equal(declined.body.requests.find(item=>item.id===request.id).status,'declined');request=await offer(db);const cancelled=await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'cancel'},alex);assert.equal(cancelled.body.requests.find(item=>item.id===request.id).status,'cancelled');
 request=await claim(db);assert.equal((await decide(db,request,'reject')).status,400);const reason='Der er aftalt en anden bemanding. '+('Detalje '.repeat(1000)),rejected=await decide(db,request,'reject',{reason});assert.equal(rejected.status,200,JSON.stringify(rejected.body));const stored=rejected.body.requests.find(item=>item.id===request.id);assert.equal(stored.decisionReason,reason.trim());assert.equal(stored.decidedBy.userId,owner.id);assert.equal(Publication.publishedShifts((await state(db)).studio).find(item=>item.id==='open').person,'');db.sqlite.close();
});

test('requests cannot transfer stale, unowned, archived, nonexistent or already-started shifts',async()=>{
 const db=await setup(),view=(await action(db,'workflowRead',{},alex)).body,own=view.ownShifts.find(item=>item.id==='own');assert.equal((await action(db,'workflowRequest',{kind:'offer',shiftId:'own',fingerprint:'old',toPersonId:'p2'},alex)).status,409);assert.equal((await action(db,'workflowRequest',{kind:'claim',shiftId:'own',fingerprint:own.fingerprint},alex)).status,403);assert.equal((await action(db,'workflowRequest',{kind:'offer',shiftId:'own',fingerprint:own.fingerprint,toPersonId:'missing'},alex)).status,409);
 const saved=await state(db);saved.studio.roster=saved.studio.roster.map(person=>person.id==='p2'?{...person,active:false}:person);saved.studio.directoryRevision=saved.directory.revision;const archived=await plan(db,saved.studio);assert.equal(archived.status,200,JSON.stringify(archived.body));assert.equal(db.sqlite.prepare("SELECT active FROM workspace_directory_records WHERE workspace_id=(SELECT workspace_id FROM workspace_members WHERE user_id=?) AND kind='employee' AND id='p2'").get(owner.id).active,0);assert.equal((await action(db,'workflowRequest',{kind:'offer',shiftId:'own',fingerprint:own.fingerprint,toPersonId:'p2'},alex)).status,409);db.sqlite.close();
 const past=await setup(draft({edits:{own:shift({date:'2001-01-10'}),open:shift({id:'open',person:'',date:'2001-01-10'})}})); // Publish the historical week explicitly below.
 const current=await state(past);await plan(past,current.studio,weekFor('2001-01-10'));assert.equal((await action(past,'workflowRequest',{kind:'offer',shiftId:'own',fingerprint:Workflow.fingerprint(shift({date:'2001-01-10'})),toPersonId:'p2'},alex)).status,409);past.sqlite.close();
});

test('approval rechecks unpublished source edits and newly overlapping published or draft assignments',async()=>{
 for(const mode of ['source','draft-overlap','published-overlap']){
  const db=await setup();let request=await offer(db);request=(await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea)).body.requests.find(item=>item.id===request.id);const saved=await state(db);
  if(mode==='source')saved.studio.edits.own.note='En ny upubliceret instruks';else saved.studio.edits.conflict=shift({id:'conflict',person:'p2',start:'10:00',end:'17:00',site:2});
  await plan(db,saved.studio);if(mode==='published-overlap')await publish(db);const rejected=await decide(db,request);assert.equal(rejected.status,409,JSON.stringify(rejected.body));assert.equal(rejected.body.error,mode==='source'?'workflow_draft_changed':'workflow_overlap');assert.equal(Publication.publishedShifts((await state(db)).studio).find(item=>item.id==='own').person,'p1');db.sqlite.close();
 }
});

test('approved leave is rechecked after colleague consent and blocks both approval and a new offer',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-02T08:00:00Z')});
 const db=await setup(draft({edits:{own:shift({person:'p2',date:'2026-11-03'})}}));await publish(db,weekFor('2026-11-03'));
 const summary=(await action(db,'workflowRead',{},bea)).body.ownShifts[0];let response=await action(db,'workflowRequest',{kind:'offer',shiftId:summary.id,fingerprint:summary.fingerprint,toPersonId:'p1'},bea);assert.equal(response.status,200,JSON.stringify(response.body));let request=response.body.requests[0];response=await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},alex);assert.equal(response.status,200,JSON.stringify(response.body));request=response.body.requests[0];
 const saved=await state(db);saved.studio.requests.b='approved';await plan(db,saved.studio);response=await decide(db,request);assert.equal(response.status,409);assert.equal(response.body.error,'workflow_leave');
 await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'cancel'},bea);response=await action(db,'workflowRequest',{kind:'offer',shiftId:summary.id,fingerprint:summary.fingerprint,toPersonId:'p1'},bea);assert.equal(response.status,409);assert.equal(response.body.error,'workflow_leave');db.sqlite.close();
});

test('a new time registration or account revocation at commit blocks the complete approval atomically',async()=>{
 for(const race of ['ledger','account']){
  const db=await setup();let request=await offer(db);request=(await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea)).body.requests.find(item=>item.id===request.id);const before=await state(db);let intercepted=false;
  db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes('UPDATE studio_states SET revision'))){intercepted=true;if(race==='account')db.sqlite.prepare("UPDATE workspace_members SET status = 'disabled',version = version+1 WHERE user_id = ?").run(bea.id);else db.sqlite.prepare("INSERT INTO workspace_timekeeping(workspace_id,config,version,write_token,updated_at) SELECT workspace_id,?,1,'race',? FROM workspace_members WHERE user_id = ?").run(JSON.stringify({schema:1,entries:[{shiftId:'own',personId:'p1',status:'running'}],demo:null}),new Date().toISOString(),owner.id);}};
  const result=await decide(db,request);assert.equal(result.status,409,JSON.stringify(result.body));assert.ok(intercepted);const after=await state(db);assert.equal(after.revision,before.revision);assert.equal(JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_shift_requests WHERE id=?').get(request.id).config).status,'pending');assert.equal(Publication.publishedShifts(after.studio).find(item=>item.id==='own').person,'p1');db.sqlite.close();
 }
});

test('concurrent plan changes fence requests and preserve both the plan and all server-owned workflow data',async()=>{
 const db=await setup(),before=await state(db),view=(await action(db,'workflowRead',{},bea)).body,open=view.openShifts.find(item=>item.id==='open');let intercepted=false;
 db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes('INSERT INTO workspace_shift_requests'))){intercepted=true;const current=await state(db),next=structuredClone(current.studio);next.edits.other.note='Concurrent draft';await Store.writeStudio(db,owner.id,current.revision,next);}};
 const result=await action(db,'workflowRequest',{kind:'claim',shiftId:'open',fingerprint:open.fingerprint},bea);assert.equal(result.status,409,JSON.stringify(result.body));const after=await state(db);assert.equal(after.revision,before.revision+1);assert.equal(after.studio.edits.other.note,'Concurrent draft');assert.equal((await action(db,'workflowRead')).body.requests.length,0);assert.equal((await action(db,'workflowRead')).body.deliveries.length,2);db.sqlite.close();
});

test('server rejects multiweek publication when any selected week has approved leave',async()=>{
 const db=await setup(),saved=await state(db);saved.studio.edits.leave=shift({id:'leave',person:'p1',date:'2026-11-03'});saved.studio.requests.b='approved';await plan(db,saved.studio);const current=await state(db),response=await plan(db,current.studio,{from:'2026-11-02',to:'2026-11-15',siteIds:[0]});assert.equal(response.status,400);assert.equal(response.body.error,'publication_leave');assert.equal((await state(db)).revision,current.revision);assert.equal(Publication.publishedShifts((await state(db)).studio).some(item=>item.id==='leave'),false);db.sqlite.close();
});

test('availability counts only calendar days with actual work, including overnight and midnight boundaries',()=>{
 assert.deepEqual(Availability.shiftAvailabilityDates(shift()),['2090-01-10']);
 assert.deepEqual(Availability.shiftAvailabilityDates(shift({start:'22:00',end:'06:00'})),['2090-01-10','2090-01-11']);
 assert.deepEqual(Availability.shiftAvailabilityDates(shift({start:'22:00',end:'00:00'})),['2090-01-10']);
 assert.deepEqual(Availability.shiftAvailabilityDates(shift({date:'2027-03-27',start:'22:00',end:'06:00'})),['2027-03-27','2027-03-28']);
 assert.deepEqual(Availability.shiftAvailabilityDates(shift({date:'2027-10-30',start:'22:00',end:'06:00'})),['2027-10-30','2027-10-31']);
});

test('planner availability is bounded to selected employees, workspace and dates and never returns preference contents',async()=>{
 const db=await setup();try{
  const workspaceId=db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(owner.id).workspace_id;
  markUnavailable(db,'p2',['2090-01-10','2090-01-11','2090-03-10']);markUnavailable(db,'p6',['2090-01-10']);
  const foreign={id:'availability-foreign-owner',email:'foreign@example.test'};
  await Store.writeStudio(db,foreign.id,0,draft());await Workspace.handleWorkspaceStudioRequest(req('GET',undefined,foreign),db);
  const foreignWorkspace=db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(foreign.id).workspace_id;
  markUnavailable(db,'p2',['2090-01-12'],foreignWorkspace);
  const options={db,context:{workspace:{id:workspaceId}},payload:{from:'2090-01-10',to:'2090-01-11',personIds:['p1','p2','p2','person-missing']},helpers:{capabilities:()=>({plan:true}),assertContext:async()=>{}}};
  const result=await Availability.readPlanningAvailability(options);
  assert.deepEqual(result.people.sort((a,b)=>a.personId.localeCompare(b.personId)),[
   {personId:'p1',version:0,unavailableDates:[]},{personId:'p2',version:1,unavailableDates:['2090-01-10','2090-01-11']},
  ]);
  assert.equal(JSON.stringify(result).includes('notifications'),false);assert.equal(JSON.stringify(result).includes('privateField'),false);
  const queries=[];db.beforeBatch=statements=>{queries.push(...statements.map(item=>item.sql));};
  const routed=await action(db,'planningAvailability',options.payload);
  assert.equal(routed.status,200,JSON.stringify(routed.body));assert.match(routed.body.accessIdentity,/^[a-f0-9]{64}$/);assert.deepEqual(routed.body,{...result,accessIdentity:routed.body.accessIdentity});
  assert.equal(queries.some(sql=>/FROM studio_state_chunks|FROM workspace_plan_records|FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(sql)),false,'availability never fetches plan or instructions');
  queries.length=0;
  const forbidden=await action(db,'planningAvailability',options.payload,bea);
  assert.equal(forbidden.status,403);assert.equal(forbidden.body.people,undefined);
  assert.equal(queries.some(sql=>sql.includes('workspace_employee_preferences')),false,'non-planner never reads employee preferences');
  const isolated=await action(db,'planningAvailability',{...options.payload,workspaceId,personIds:['p2']},foreign);
  assert.equal(isolated.status,200,JSON.stringify(isolated.body));assert.deepEqual(isolated.body.people,[{personId:'p2',version:1,unavailableDates:[]}]);
  db.beforeBatch=null;
  await assert.rejects(Availability.readPlanningAvailability({...options,helpers:{capabilities:()=>({plan:false})}}),{status:403,code:'planning_availability_forbidden'});
  await assert.rejects(Availability.readPlanningAvailability({...options,payload:{...options.payload,to:'2090-04-10'}}),{status:400});
  await assert.rejects(Availability.readPlanningAvailability({...options,payload:{...options.payload,personIds:Array(501).fill('p1')}}),{status:400});
  const snapshot=await Availability.readEmployeeAvailability({db,workspaceId,personIds:['p1','p2']}),guard=Availability.employeeAvailabilityGuard(workspaceId,snapshot);
  assert.equal(db.sqlite.prepare(`SELECT 1 valid WHERE ${guard.sql}`).get(...guard.values).valid,1);
  markUnavailable(db,'p2',['2090-01-13'],foreignWorkspace);
  assert.equal(db.sqlite.prepare(`SELECT 1 valid WHERE ${guard.sql}`).get(...guard.values).valid,1,'another workspace cannot invalidate this guard');
  markUnavailable(db,'p1',['2090-01-10']);
  assert.equal(db.sqlite.prepare(`SELECT 1 valid WHERE ${guard.sql}`).get(...guard.values),undefined,'first preference insert invalidates version zero');
 }finally{db.sqlite.close();}
});

test('unavailability warns without changing existing shifts but blocks new offers and open-shift claims',async()=>{
 const db=await setup();try{
  const before=await state(db);markUnavailable(db,'p1',['2090-01-10']);markUnavailable(db,'p2',['2090-01-10']);
  const view=(await action(db,'workflowRead',{},alex)).body,own=view.ownShifts.find(item=>item.id==='own');
  assert.ok(own);assert.equal((await state(db)).revision,before.revision);
  assert.equal(Publication.publishedShifts((await state(db)).studio).find(item=>item.id==='own').person,'p1');
  const offered=await action(db,'workflowRequest',{kind:'offer',shiftId:own.id,fingerprint:own.fingerprint,toPersonId:'p2'},alex);
  assert.equal(offered.status,409);assert.equal(offered.body.error,'workflow_unavailable');assert.match(offered.body.message,/10\.01\.2090/);
  const open=(await action(db,'workflowRead',{},bea)).body.openShifts.find(item=>item.id==='open');
  const claimed=await action(db,'workflowRequest',{kind:'claim',shiftId:open.id,fingerprint:open.fingerprint},bea);
  assert.equal(claimed.status,409);assert.equal(claimed.body.error,'workflow_unavailable');
  // A planner may retain and publish an existing assignment; marks are advisory in planning.
  const saved=await state(db);assert.equal((await plan(db,saved.studio,weekFor('2090-01-10'))).status,200);
 }finally{db.sqlite.close();}
});

test('recipient availability is rechecked on acceptance and planner approval while decline remains possible',async()=>{
 for(const stage of ['accept','approve']){
  const db=await setup();try{
   let request=await offer(db);
   if(stage==='approve')request=(await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea)).body.requests.find(item=>item.id===request.id);
   markUnavailable(db,'p2',['2090-01-10']);
   const result=stage==='accept'?await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea):await decide(db,request);
   assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.error,'workflow_unavailable');
   const pending=(await action(db,'workflowRead')).body.requests.find(item=>item.id===request.id);
   assert.match(pending.blockedReason,/utilgængelig den 10\.01\.2090/);
   assert.equal(Publication.publishedShifts((await state(db)).studio).find(item=>item.id==='own').person,'p1');
   const closed=stage==='accept'?await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'decline'},bea):await decide(db,request,'reject',{reason:'Vælg en anden medarbejder.'});
   assert.equal(closed.status,200,JSON.stringify(closed.body));
  }finally{db.sqlite.close();}
 }
});

test('overnight transfer rejects next-day unavailability but midnight-ending transfer does not touch that day',async()=>{
 for(const end of ['06:00','00:00']){
  const db=await setup();try{
   // Compact readers also support legacy overnight rows; publication creation currently limits same-day shifts.
   db.sqlite.prepare('UPDATE workspace_published_shifts SET start_time=?,end_time=?,workflow_fingerprint=? WHERE id=?').run('22:00',end,Workflow.fingerprint(shift({start:'22:00',end})),'own');
   markUnavailable(db,'p2',['2090-01-11']);
   const own=(await action(db,'workflowRead',{},alex)).body.ownShifts[0];
   const result=await action(db,'workflowRequest',{kind:'offer',shiftId:own.id,fingerprint:own.fingerprint,toPersonId:'p2'},alex);
   assert.equal(result.status,end==='06:00'?409:200,JSON.stringify(result.body));
   if(end==='06:00'){assert.equal(result.body.error,'workflow_unavailable');assert.match(result.body.message,/11\.01\.2090/);}
  }finally{db.sqlite.close();}
 }
});

test('concurrent recipient preference insert or version change fences request, acceptance and approval atomically',async()=>{
 for(const stage of ['request','accept','approve'])for(const existing of [false,true]){
  const db=await setup();try{
   let request;if(stage!=='request')request=await offer(db);
   if(stage==='approve')request=(await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea)).body.requests.find(item=>item.id===request.id);
   if(existing)markUnavailable(db,'p2',['2090-03-10']);
   const before=await state(db),count=db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_messages').get().n;
   const own=(await action(db,'workflowRead',{},alex)).body.ownShifts.find(item=>item.id==='own');let intercepted=false;
   db.beforeBatch=async statements=>{if(!intercepted&&statements.some(item=>item.sql.includes(stage==='approve'?'UPDATE studio_states SET revision':stage==='accept'?'UPDATE workspace_shift_requests SET':'INSERT INTO workspace_shift_requests'))){intercepted=true;markUnavailable(db,'p2',['2090-01-10']);}};
   const result=stage==='request'?await action(db,'workflowRequest',{kind:'offer',shiftId:own.id,fingerprint:own.fingerprint,toPersonId:'p2'},alex):stage==='accept'?await action(db,'workflowRespond',{requestId:request.id,version:request.version,decision:'accept'},bea):await decide(db,request);
   assert.ok(intercepted,stage);assert.equal(result.status,409,JSON.stringify(result.body));
   const after=await state(db);assert.equal(after.revision,before.revision);assert.equal(Publication.publishedShifts(after.studio).find(item=>item.id==='own').person,'p1');
   assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_messages').get().n,count);
   const stored=db.sqlite.prepare('SELECT config FROM workspace_shift_requests').all();
   if(stage==='request')assert.equal(stored.length,0);else assert.equal(JSON.parse(stored[0].config).status,stage==='accept'?'awaiting_colleague':'pending');
  }finally{db.sqlite.close();}
 }
});
