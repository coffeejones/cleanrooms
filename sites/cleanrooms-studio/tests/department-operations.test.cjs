/* Adversarial real-handler tests. Every fixture uses all production migrations. */
const test=require('node:test'),assert=require('node:assert/strict');
const {createDepartmentAccessFixture}=require('./helpers/department-access-fixture.cjs');
const Time=require('../src/timekeeping-model.js');
const {archiveStatements}=require('../lib/activity-store.mjs');
const Auth=require('../lib/mobile-auth-store.mjs');
const {handleMobileAuthRequest}=require('../lib/mobile-auth-route.mjs');
const Departments=require('../src/department-model.js'),Publication=require('../src/publication-model.js');
const Workspace=require('../lib/workspace-store.mjs');

const scope=departmentIds=>({mode:'departments',departmentIds});
const hidden=value=>assert.equal(JSON.stringify(value).includes('FOREIGN SECRET'),false,JSON.stringify(value));
const expect=async(promise,status=200)=>{const result=await promise;assert.equal(result.status,status,JSON.stringify(result));return result.body;};
async function rates(h){for(const [person,amount] of [[h.allowedPerson,18000],[h.foreignPerson,973400]])await expect(h.account('payrollSave',{personId:person.id,version:0,payroll:{currency:'DKK',agreements:[{id:'base',from:h.date,type:'hourly',amountCents:amount}],supplements:[]}}));}
async function register(h,shift=h.allowedShift){return (await expect(h.account('timeWrite',{operation:'correct',shiftId:shift.id,personId:shift.person,version:0,start:shift.start,end:shift.end,breakMinutes:0,reason:shift.site?'FOREIGN SECRET correction':'Confirmed attendance'}))).entry;}
const activityCount=h=>h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_activity WHERE workspace_id=?').get(h.workspaceId).n;
function revoke(h,kind){if(kind==='member')h.sqlite.prepare('UPDATE workspace_members SET access_scope=?,version=version+1 WHERE user_id=?').run(JSON.stringify(scope(['dep-klinik'])),h.scopedPlanner.id);else h.sqlite.prepare("UPDATE workspace_directory_state SET version=version+1,write_token='mapping-revoked' WHERE workspace_id=?").run(h.workspaceId);}

test('time pages, scalar totals and exact record writes stay inside the selected departments',async t=>{
 const h=await createDepartmentAccessFixture(t);await rates(h);const own=await register(h),foreign=await register(h,h.foreignShift);await expect(h.account('timeWrite',{operation:'approve',entryId:foreign.id,version:foreign.version}));
 const page=await expect(h.account('timeRead',{...h.range,queue:'all',scope:'real',pageSize:50},h.scopedPlanner));hidden(page);assert.deepEqual(page.entries.map(row=>row.id),[own.id]);assert.equal(page.summary.counts.all,1);assert.equal(page.summary.approvedMinutes,0);assert.equal(page.summary.approvedCents,0);assert.ok(page.plannedRows.every(row=>row.personId===h.allowedPerson.id));
 const legacy=await expect(h.account('timeRead',h.range,h.scopedPlanner));hidden(legacy);assert.deepEqual(legacy.entries.map(row=>row.id),[own.id]);
 await expect(h.account('timeRead',{...h.range,queue:'all',scope:'demo',pageSize:50},h.scopedPlanner),403);
 await expect(h.account('timeRead',{...h.range,personId:h.foreignPerson.id},h.scopedPlanner),403);
 const before=h.sqlite.prepare('SELECT config FROM workspace_time_entries WHERE id=?').get(foreign.id).config,audit=activityCount(h);await expect(h.account('timeWrite',{operation:'reopen',entryId:foreign.id,version:2,reason:'FORGED'},h.scopedPlanner),403);assert.equal(h.sqlite.prepare('SELECT config FROM workspace_time_entries WHERE id=?').get(foreign.id).config,before);assert.equal(activityCount(h),audit);
 const approved=await expect(h.account('timeWrite',{operation:'approve',entryId:own.id,version:own.version},h.scopedPlanner));assert.equal(approved.entry.status,'approved');const final=await expect(h.account('timeRead',{...h.range,queue:'approved',scope:'real',pageSize:50},h.scopedPlanner));assert.equal(final.summary.approvedCents,18000);assert.equal(final.summary.approvedMinutes,60);hidden(final);
});

test('time cursors and summaries cannot retain a wider membership scope after narrowing',async t=>{
 const h=await createDepartmentAccessFixture(t,{departmentIds:['dep-nord','dep-klinik']});await register(h);await register(h,h.foreignShift);
 const first=await expect(h.account('timeRead',{...h.range,queue:'all',scope:'real',pageSize:1},h.scopedPlanner));assert.equal(first.summary.counts.all,2);assert.ok(first.nextCursor);
 const member=(await expect(h.account('list'))).members.find(row=>row.userId===h.scopedPlanner.id);await expect(h.account('updateMember',{userId:member.userId,version:member.version,accessScope:scope(['dep-nord'])}));
 const changed=await h.account('timeRead',{...h.range,queue:'all',scope:'real',pageSize:1,cursor:first.nextCursor},h.scopedPlanner);assert.ok([403,409].includes(changed.status),JSON.stringify(changed));const fresh=await expect(h.account('timeRead',{...h.range,queue:'all',scope:'real',pageSize:50},h.scopedPlanner));assert.equal(fresh.summary.counts.all,1);hidden(fresh);
});

test('membership and department mapping races leave no partial time approval or audit',async t=>{
 for(const kind of ['member','directory']){const h=await createDepartmentAccessFixture(t);await rates(h);const own=await register(h),before=activityCount(h);let raced=false;h.db.beforeBatch=statements=>{if(!raced&&statements.some(row=>row.sql.startsWith('UPDATE workspace_time_entries'))){raced=true;h.db.beforeBatch=null;revoke(h,kind);}};
  const result=await h.account('timeWrite',{operation:'approve',entryId:own.id,version:own.version},h.scopedPlanner);assert.equal(raced,true);assert.ok([403,409].includes(result.status),JSON.stringify(result));assert.equal(h.sqlite.prepare('SELECT status FROM workspace_time_entries WHERE id=?').get(own.id).status,'submitted');assert.equal(activityCount(h),before);
 }
});

test('absence pages, counts, direct decisions and continuation cursors are scoped',async t=>{
 const h=await createDepartmentAccessFixture(t),day=Time.addDays(h.date,20),create=(person,offset=0)=>h.account('leaveCreate',{personId:person.id,from:Time.addDays(day,offset),to:Time.addDays(day,offset),type:'Ferie',comment:person.site?'FOREIGN SECRET absence':'Own absence'});
 const own=(await expect(create(h.allowedPerson))).request;await expect(create(h.allowedPerson,1));const foreign=(await expect(create(h.foreignPerson))).request;
 const list=await expect(h.account('leaveRead',{limit:1},h.scopedPlanner));assert.equal(list.counts.all,2);assert.equal(list.counts.pending,2);assert.equal(list.requests.length,1);assert.ok(list.nextCursor);hidden(list);
 const next=await expect(h.account('leaveRead',{limit:1,cursor:list.nextCursor},h.scopedPlanner));assert.equal(next.requests.length,1);hidden(next);
 await expect(h.account('leaveRead',{personId:h.foreignPerson.id},h.scopedPlanner),403);const before=activityCount(h);await expect(h.account('leaveDecide',{id:foreign.id,version:foreign.version,status:'approved'},h.scopedPlanner),403);assert.equal(h.sqlite.prepare('SELECT status FROM workspace_absences WHERE id=?').get(foreign.id).status,'pending');assert.equal(activityCount(h),before);
 await expect(h.account('leaveDecide',{id:own.id,version:own.version,status:'rejected',reason:'Own request explained'},h.scopedPlanner));const final=await expect(h.account('leaveRead',{},h.scopedPlanner));assert.equal(final.counts.rejected,1);assert.equal(final.counts.pending,1);hidden(final);
 revoke(h,'member');const stale=await h.account('leaveRead',{limit:1,cursor:list.nextCursor},h.scopedPlanner);assert.ok([403,409].includes(stale.status),JSON.stringify(stale));
});

test('a mapping change at the absence decision commit leaves no decision or phantom audit',async t=>{
 const h=await createDepartmentAccessFixture(t),day=Time.addDays(h.date,20),own=(await expect(h.account('leaveCreate',{personId:h.allowedPerson.id,from:day,to:day,type:'Ferie',comment:'Own request'}))).request,before=activityCount(h);let raced=false;h.db.beforeBatch=statements=>{if(!raced&&statements.some(row=>row.sql.startsWith('UPDATE workspace_absences'))){raced=true;h.db.beforeBatch=null;revoke(h,'directory');}};
 const failed=await h.account('leaveDecide',{id:own.id,version:own.version,status:'approved'},h.scopedPlanner);assert.equal(raced,true);assert.ok([403,409].includes(failed.status),JSON.stringify(failed));assert.equal(h.sqlite.prepare('SELECT status FROM workspace_absences WHERE id=?').get(own.id).status,'pending');assert.equal(activityCount(h),before);
});

test('chat managers see and mutate only their department rooms, including direct room IDs and a commit race',async t=>{
 const h=await createDepartmentAccessFixture(t),own=(await expect(h.account('chatCreate',{departmentId:'dep-nord',name:'Own department chat'}))).room,foreign=(await expect(h.account('chatCreate',{departmentId:'dep-klinik',name:'FOREIGN SECRET CHAT'}))).room;
 await expect(h.account('chatSend',{roomId:foreign.id,clientId:'foreign-message',text:'FOREIGN SECRET message'}));
 const list=await expect(h.account('chatList',{},h.scopedPlanner));assert.deepEqual(list.rooms.map(row=>row.id),[own.id]);assert.deepEqual(list.departments.map(row=>row.id),['dep-nord']);assert.equal(list.unreadCount,0);hidden(list);
 const before=h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n;for(const payload of [{action:'chatRead',roomId:foreign.id},{action:'chatSend',roomId:foreign.id,clientId:'forged-message',text:'FORGED'},{action:'chatUpdate',roomId:foreign.id,version:foreign.version,name:'FORGED'},{action:'chatCreate',departmentId:'dep-havn',name:'FORGED'}])await expect(h.account(payload.action,Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='action')),h.scopedPlanner),403);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n,before);
 const sent=await expect(h.account('chatSend',{roomId:own.id,clientId:'own-message',text:'Own message'},h.scopedPlanner));assert.equal(sent.message.text,'Own message');let raced=false;h.db.beforeBatch=statements=>{if(!raced&&statements.some(row=>row.sql.includes('INSERT INTO workspace_chat_messages'))){raced=true;h.db.beforeBatch=null;revoke(h,'directory');}};const failed=await h.account('chatSend',{roomId:own.id,clientId:'raced-message',text:'RACED'},h.scopedPlanner);assert.equal(raced,true);assert.ok([403,409].includes(failed.status),JSON.stringify(failed));assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM workspace_chat_messages WHERE text='RACED'").get().n,0);
});

test('employee chat preview intersects planner department rights even when departments share a worksite',async t=>{
 const h=await createDepartmentAccessFixture(t),response=await Workspace.handleDirectoryRequest(new Request('https://cleanrooms.example/api/directory',{method:'POST',headers:{origin:'https://cleanrooms.example','content-type':'application/json','oai-authenticated-user-id':h.owner.id,'oai-authenticated-user-email':h.owner.email},body:JSON.stringify({action:'write',changes:[{kind:'department',id:'dep-shared',expectedVersion:0,patch:{name:'FOREIGN SECRET SHARED DEPARTMENT',kind:'customer',siteIds:[0]}}]})}),h.db);assert.equal(response.status,200,await response.clone().text());
 const own=(await expect(h.account('chatCreate',{departmentId:'dep-nord',name:'Own chat'}))).room,shared=(await expect(h.account('chatCreate',{departmentId:'dep-shared',name:'FOREIGN SECRET SHARED CHAT'}))).room;await expect(h.account('chatSend',{roomId:shared.id,clientId:'shared-secret',text:'FOREIGN SECRET shared message'}));
 const preview=await expect(h.account('chatList',{previewPersonId:h.allowedPerson.id},h.scopedPlanner));assert.deepEqual(preview.rooms.map(row=>row.id),[own.id]);hidden(preview);await expect(h.account('chatRead',{roomId:shared.id,previewPersonId:h.allowedPerson.id},h.scopedPlanner),403);
});

function seedWorkflow(h){
 const stamp=new Date().toISOString(),request=(id,person,shift,toPersonId=person)=>({id,version:1,kind:toPersonId===person?'claim':'offer',status:'pending',fromPersonId:person,toPersonId,shift:{...shift,fingerprint:'synthetic-stale-fingerprint'},comment:id.includes('foreign')||id.includes('mixed')?'FOREIGN SECRET request':'Own request',createdAt:stamp,updatedAt:stamp,decisionReason:''});
 const requests=[request('own-request',h.allowedPerson.id,h.allowedShift),request('foreign-request',h.foreignPerson.id,h.foreignShift),request('mixed-request',h.allowedPerson.id,h.allowedShift,h.foreignPerson.id)];
 const q=h.sqlite.prepare('INSERT INTO workspace_shift_requests(workspace_id,id,shift_id,kind,from_person_id,to_person_id,status,version,config,updated_at,write_token) VALUES(?,?,?,?,?,?,?,?,?,?,?)');for(const row of requests)q.run(h.workspaceId,row.id,row.shift.id,row.kind,row.fromPersonId,row.toPersonId,row.status,row.version,JSON.stringify(row),stamp,'fixture');
 const messages=[{id:'own-message',personId:h.allowedPerson.id,before:null,after:h.allowedShift,summary:'Own message'},{id:'foreign-message',personId:h.foreignPerson.id,before:null,after:h.foreignShift,summary:'FOREIGN SECRET message'},{id:'mixed-message',personId:h.allowedPerson.id,before:h.foreignShift,after:h.allowedShift,summary:'FOREIGN SECRET before shift'}];
 const m=h.sqlite.prepare('INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config) VALUES(?,?,?,?,?,?)');for(const row of messages){const value={...row,kind:'changed',createdAt:stamp,readAt:null};m.run(h.workspaceId,row.id,row.personId,value.kind,stamp,JSON.stringify(value));}return requests;
}

test('workflow queues, badge counts, deliveries and direct decisions exclude foreign and mixed-department records',async t=>{
 const h=await createDepartmentAccessFixture(t);await expect(h.account('workflowRead',{summary:true}));seedWorkflow(h);
 const count=await expect(h.account('workflowRead',{summary:true},h.scopedPlanner));assert.equal(count.pendingCount,1);const list=await expect(h.account('workflowRead',{...h.range,limit:50},h.scopedPlanner));assert.deepEqual(list.requests.map(row=>row.id),['own-request']);assert.equal(list.pendingCount,1);assert.deepEqual(list.deliveries.map(row=>row.id),['own-message']);hidden(list);
 const preview=await expect(h.account('workflowRead',{...h.range,personId:h.allowedPerson.id},h.scopedPlanner));hidden(preview);assert.deepEqual(preview.requests.map(row=>row.id),['own-request']);assert.deepEqual(preview.notifications.map(row=>row.id),['own-message']);const previewCount=await expect(h.account('workflowRead',{summary:true,personId:h.allowedPerson.id},h.scopedPlanner));assert.equal(previewCount.unreadCount,1);
 const before=h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_messages').get().n;for(const id of ['foreign-request','mixed-request']){await expect(h.account('workflowDecide',{requestId:id,version:1,studioRevision:list.revision,decision:'reject',reason:'FORGED'},h.scopedPlanner),403);assert.equal(h.sqlite.prepare('SELECT status FROM workspace_shift_requests WHERE id=?').get(id).status,'pending');}assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_messages').get().n,before);
 await expect(h.account('workflowRead',{...h.range,personId:h.foreignPerson.id},h.scopedPlanner),403);
 const own=await expect(h.account('workflowDecide',{requestId:'own-request',version:1,studioRevision:list.revision,decision:'reject',reason:'Own request rejected'},h.scopedPlanner));assert.equal(own.requests.find(row=>row.id==='own-request').status,'rejected');
});

test('history excludes whole mixed events and hidden actors, and explicit foreign availability IDs fail closed',async t=>{
 const h=await createDepartmentAccessFixture(t),at=new Date().toISOString(),event=(id,personIds,extra={})=>({id,at,actor:{userId:id.includes('foreign')?'foreign-secret-actor':'own-actor',name:id.includes('foreign')?'FOREIGN SECRET ACTOR':'Own actor'},kind:'leave',areas:['leave'],personIds,summary:id.includes('foreign')||id.includes('mixed')?'FOREIGN SECRET event':'Own history',changes:[],recoverable:false,...extra});
 await h.db.batch(archiveStatements({db:h.db,workspaceId:h.workspaceId,entries:[event('own-event',[h.allowedPerson.id]),event('foreign-event',[h.foreignPerson.id]),event('mixed-event',[h.allowedPerson.id,h.foreignPerson.id]),event('mixed-sites',[h.allowedPerson.id],{kind:'planning',changes:[{field:'edits',id:'moved',before:{person:h.allowedPerson.id,site:0},after:{person:h.allowedPerson.id,site:1}}]}),event('global-secret',[],{kind:'settings',summary:'FOREIGN SECRET company setting'})]}));
 const history=await expect(h.account('activityRead',{limit:100},h.scopedPlanner));assert.ok(history.entries.some(row=>row.id==='own-event'));assert.ok(!history.entries.some(row=>['foreign-event','mixed-event','mixed-sites','global-secret'].includes(row.id)));assert.equal(history.actors.some(row=>row.userId==='foreign-secret-actor'),false);hidden(history);await expect(h.account('activityRead',{filters:{personId:h.foreignPerson.id}},h.scopedPlanner),403);
 const own=await expect(h.account('planningAvailability',{...h.range,personIds:[h.allowedPerson.id]},h.scopedPlanner));assert.deepEqual(own.people.map(row=>row.personId),[h.allowedPerson.id]);hidden(own);await expect(h.account('planningAvailability',{...h.range,personIds:[h.allowedPerson.id,h.foreignPerson.id]},h.scopedPlanner),403);
});

test('normal mobile own-shift access remains independent of another planners department restriction',async t=>{
 const h=await createDepartmentAccessFixture(t),credential=await Auth.issueMobileCredential({db:h.db,workspaceId:h.workspaceId,personId:h.foreignPerson.id,email:'own-mobile-foreign@example.test',actorGuard:{sql:'1=1',values:[]},expectedVersion:0}),gateway='a'.repeat(64);
 const mobile=async(payload,token)=>{const response=await handleMobileAuthRequest(new Request('https://studio.test/api/mobile-auth',{method:'POST',headers:{'content-type':'application/json','x-cleanrooms-gateway-key':gateway,'x-cleanrooms-client-ip':'127.0.0.1',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)}),h.db,gateway);return{status:response.status,body:await response.json()};};
 const login=await expect(mobile({action:'login',email:'own-mobile-foreign@example.test',password:credential.temporaryPassword})),schedule=await expect(mobile({action:'publishedSchedule',...h.range,cursor:null},login.token));assert.deepEqual(schedule.shifts.map(row=>row.id),[h.foreignShift.id]);assert.ok(schedule.shifts.every(row=>row.personId===h.foreignPerson.id));assert.equal(JSON.stringify(schedule).includes(h.allowedPerson.name),false);
});

async function realClaimFixture(t){
 const yesterday=Time.addDays(Time.localNow().date,-1),tomorrow=Time.addDays(yesterday,2),from=Time.addDays(yesterday,-((new Date(yesterday+'T12:00:00Z').getUTCDay()+6)%7)),range={from,to:Time.addDays(from,13)},people=[{id:'p0',name:'Allowed Freja',initials:'AF',site:0},{id:'p1',name:'FOREIGN SECRET MARTIN',initials:'FM',site:1},{id:'p2',name:'FOREIGN SECRET LIV',initials:'FL',site:2}].map(person=>({...person,target:37,role:'Service',active:true}));
 const shift=(id,person,date,site)=>({id,person,date,site,start:'07:00',end:'08:00',plannedBreakMinutes:0,note:site?'FOREIGN SECRET instruction':'Own instruction'}),edits={'department-allowed-shift':shift('department-allowed-shift','p0',yesterday,0),'department-foreign-shift':shift('department-foreign-shift','p1',yesterday,1),'own-open':shift('own-open','',tomorrow,0),'foreign-open':shift('foreign-open','',tomorrow,1)},studio=Publication.publish({storageVersion:1,demoSeed:false,roster:people,organization:Departments.defaultOrganization(),series:[],edits,deleted:[],weekPlans:{},coverageRules:[],requests:{},checklistProgress:{}},{...range,siteIds:[0,1,2],includeDependencies:true,actor:{userId:'owner-a',name:'Owner'},at:new Date().toISOString()}).studio;
 const h=await createDepartmentAccessFixture(t,{studio}),employee={id:'own-claim-employee',email:'own-claim@example.test'},invitation=await expect(h.account('invite',{email:employee.email,roleId:'employee',personId:'p0'}));await expect(h.account('acceptInvite',{token:new URL(invitation.inviteUrl).searchParams.get('token')},employee));
 const available=await expect(h.account('workflowRead',range,employee)),ownOpen=available.openShifts.find(row=>row.id==='own-open');assert.ok(ownOpen,'A real employee can find the published open shift');const sent=await expect(h.account('workflowRequest',{...range,kind:'claim',shiftId:ownOpen.id,fingerprint:ownOpen.fingerprint,comment:'Confirmed availability'},employee)),request=sent.request||sent.requests.find(row=>row.shift.id===ownOpen.id);assert.equal(request.status,'pending');
 return {...h,employee,request,workflowRange:range};
}

test('a real employee claim can be approved by its scoped planner without replacing foreign publication records',async t=>{
 const h=await realClaimFixture(t),before=h.sqlite.prepare("SELECT config,version FROM workspace_published_shifts WHERE workspace_id=? AND site=1 ORDER BY id").all(h.workspaceId),list=await expect(h.account('workflowRead',h.workflowRange,h.scopedPlanner));hidden(list);assert.equal(list.pendingCount,1);
 const approved=await expect(h.account('workflowDecide',{requestId:h.request.id,version:h.request.version,studioRevision:list.revision,decision:'approve',...h.workflowRange},h.scopedPlanner));assert.equal(approved.requests.find(row=>row.id===h.request.id).status,'approved');hidden(approved);assert.equal(h.sqlite.prepare("SELECT person_id FROM workspace_published_shifts WHERE workspace_id=? AND id='own-open'").get(h.workspaceId).person_id,h.allowedPerson.id);assert.deepEqual(h.sqlite.prepare("SELECT config,version FROM workspace_published_shifts WHERE workspace_id=? AND site=1 ORDER BY id").all(h.workspaceId),before);
});

test('a scope change at the final claim-publication commit leaves the request and all planning effects uncommitted',async t=>{
 const h=await realClaimFixture(t),list=await expect(h.account('workflowRead',h.workflowRange,h.scopedPlanner)),messages=h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_messages').get().n,activity=activityCount(h);let raced=false;h.db.beforeBatch=statements=>{if(!raced&&statements.some(row=>row.sql.startsWith('UPDATE studio_states'))){raced=true;h.db.beforeBatch=null;revoke(h,'member');}};
 const failed=await h.account('workflowDecide',{requestId:h.request.id,version:h.request.version,studioRevision:list.revision,decision:'approve',...h.workflowRange},h.scopedPlanner);assert.equal(raced,true);assert.ok([403,409].includes(failed.status),JSON.stringify(failed));assert.equal(h.sqlite.prepare('SELECT status FROM workspace_shift_requests WHERE id=?').get(h.request.id).status,'pending');assert.equal(h.sqlite.prepare("SELECT person_id FROM workspace_published_shifts WHERE workspace_id=? AND id='own-open'").get(h.workspaceId).person_id,'');assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_shift_messages').get().n,messages);assert.equal(activityCount(h),activity);
});
