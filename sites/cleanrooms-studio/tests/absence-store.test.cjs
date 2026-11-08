const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs');
const Workspace=require('../lib/workspace-store.mjs');
const Departments=require('../src/department-model.js');
const Data=require('../src/studio-data.js');
const Publication=require('../src/publication-model.js');
const {ABSENCE_PAGE_BYTES}=require('../lib/absence-store.mjs');
const owner={id:'absence-owner',email:'owner@example.com'},otherOwner={id:'absence-other-owner',email:'other-owner@example.com'},employee={id:'absence-worker',email:'worker@example.com'},peer={id:'absence-peer',email:'peer@example.com'};
const people=[{id:'person-absence-001',name:'Anna Test',initials:'AT',target:37,site:0,role:'Service',active:true},{id:'person-absence-002',name:'Bo Test',initials:'BT',target:30,site:1,role:'Service',active:true}];
const add=(value,days)=>{const day=new Date(value+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);};
const date=add(Data.todayFor(),7),from=add(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)),to=add(from,6);
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
  return db;
}
const request=(url,method,body,principal=owner,headers={})=>new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email,'oai-authenticated-user-full-name':principal.id,...(method==='GET'?{}:{origin:'https://cleanrooms.example','content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async response=>({status:response.status,body:await response.json()});
const api=(db,action,payload={},principal=owner,headers={})=>Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},principal,headers),db).then(json);
const plan=(db,method='GET',body,principal=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio',method,body,principal),db).then(json);
const create=(db,principal=employee,patch={})=>api(db,'leaveCreate',{from:date,to:add(date,2),type:'Ferie',comment:'Ferie med familien',...patch},principal);
const decide=(db,entry,status='approved',reason='',principal=owner)=>api(db,'leaveDecide',{id:entry.id,version:entry.version,status,reason},principal);
const leaveAudit=(db,workspaceId)=>db.sqlite.prepare("SELECT entry FROM workspace_activity WHERE workspace_id=? AND kind='leave' ORDER BY at,id").all(workspaceId).map(row=>JSON.parse(row.entry));
async function bootstrap(db,principal=owner){
  const studio={storageVersion:1,demoSeed:false,roster:people,organization:Departments.defaultOrganization(),series:[],edits:{planned:{id:'planned',person:people[0].id,date,site:0,start:'07:00',end:'15:00',note:''}},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{}};
  assert.equal((await Store.writeStudio(db,principal.id,0,studio)).ok,true);const read=await plan(db,'GET',undefined,principal);assert.equal(read.status,200);return read.body;
}
async function join(db,principal,personId){
  const invitation=await api(db,'invite',{email:principal.email,roleId:'employee',personId});assert.equal(invitation.status,200);
  const joined=await api(db,'acceptInvite',{token:new URL(invitation.body.inviteUrl).searchParams.get('token')},principal);assert.equal(joined.status,200);
}
async function setup(){const db=database(),context=await bootstrap(db);await join(db,employee,people[0].id);await join(db,peer,people[1].id);return {db,...context};}
function seedRequests(db,workspaceId,count,{comment='',sameDay=false}={}){
  const insert=db.sqlite.prepare('INSERT INTO workspace_absences (workspace_id,id,person_id,from_date,to_date,type,status,version,config,write_token,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'),entries=[];
  db.sqlite.exec('BEGIN');try{for(let index=0;index<count;index++){
    const day=sameDay?Data.minDate:add(date,index%20),personId=people[index%2].id,type=index%2?'Sygdom':'Ferie',status=['pending','approved','rejected'][index%3],entry={id:'absence-seeded-'+String(index).padStart(6,'0'),p:personId,days:[day],dates:day,type,status,version:1,comment};
    entries.push(entry);insert.run(workspaceId,entry.id,personId,day,day,type,status,1,JSON.stringify(entry),'seed',new Date().toISOString());
  }db.sqlite.exec('COMMIT');}catch(error){db.sqlite.exec('ROLLBACK');throw error;}return entries;
}

test('real employee requests use the authenticated person and a separate versioned row without changing the calendar revision',async()=>{
  const {db,workspace}=await setup(),before=await Store.readStudio(db,owner.id),created=await create(db,employee,{status:'approved',version:99,createdBy:{userId:owner.id,name:'Forged'}});
  assert.equal(created.status,200,JSON.stringify(created));const entry=created.body.request;assert.match(entry.id,/^absence-/);assert.equal(entry.p,people[0].id);assert.equal(entry.version,1);assert.equal(entry.status,'pending');assert.equal(entry.createdBy.userId,employee.id);assert.deepEqual(entry.days,[date,add(date,1),add(date,2)]);
  assert.deepEqual(await Store.readStudio(db,owner.id),before);assert.equal(db.sqlite.prepare('SELECT version FROM workspace_absence_imports WHERE workspace_id=?').get(workspace.id).version,1);
  const own=await api(db,'leaveRead',{},employee);assert.deepEqual(own.body.requests,[entry]);assert.deepEqual((await api(db,'leaveRead',{},peer)).body.requests,[]);
  const projection=await plan(db,'GET',undefined,employee);assert.deepEqual(projection.body.employee.leaveRequests,[entry]);assert.equal(projection.body.studio,null);
  const audits=leaveAudit(db,workspace.id);assert.equal(audits.length,1);assert.equal(audits[0].actor.userId,employee.id);db.sqlite.close();
});

test('leave decisions need a current version, rejection reason and planner; only the server stamps their actor and timestamp',async()=>{
  const {db,workspace}=await setup(),created=(await create(db)).body.request,before=await Store.readStudio(db,owner.id);
  for(const reason of ['', '  ', '\n']){const rejected=await decide(db,created,'rejected',reason);assert.equal(rejected.status,400);assert.equal(rejected.body.error,'leave_reason_required');}
  assert.equal((await decide(db,created,'approved','',employee)).status,403);
  const accepted=await api(db,'leaveDecide',{id:created.id,version:created.version,status:'rejected',reason:'  Ingen afløser.  ',decision:{decidedBy:{userId:'forged'},decidedAt:'1900-01-01T00:00:00Z'}});assert.equal(accepted.status,200);assert.equal(accepted.body.request.version,2);assert.equal(accepted.body.request.decision.reason,'Ingen afløser.');assert.equal(accepted.body.request.decision.decidedBy.userId,owner.id);assert.notEqual(accepted.body.request.decision.decidedAt,'1900-01-01T00:00:00Z');
  assert.equal((await decide(db,created)).status,409);assert.equal((await decide(db,accepted.body.request)).status,409);assert.deepEqual(await Store.readStudio(db,owner.id),before);assert.equal(leaveAudit(db,workspace.id).length,2);db.sqlite.close();
});

test('read selectors, mutation identity and known request IDs cannot cross employee or company boundaries',async()=>{
  const {db,workspace}=await setup(),first=(await create(db)).body.request,second=(await create(db,peer,{comment:'Peer private request'})).body.request,other=await bootstrap(db,otherOwner);
  for(const action of ['leaveRead','leaveCreate'])assert.equal((await api(db,action,{personId:people[1].id,from:date,to:date,type:'Ferie'},employee)).status,403);
  assert.equal((await decide(db,second,'approved','',employee)).status,403);
  const isolated=await api(db,'leaveRead',{workspaceId:workspace.id,ownerId:owner.id},otherOwner);assert.equal(isolated.status,200);assert.deepEqual(isolated.body.requests,[]);
  assert.equal((await decide(db,first,'approved','',otherOwner)).status,404);
  const foreign=await create(db,otherOwner,{personId:people[0].id,workspaceId:workspace.id});assert.equal(foreign.status,200);assert.equal(db.sqlite.prepare('SELECT workspace_id FROM workspace_absences WHERE id=?').get(foreign.body.request.id).workspace_id,other.workspace.id);
  assert.deepEqual((await api(db,'leaveRead',{},employee)).body.requests.map(entry=>entry.id),[first.id]);assert.equal((await api(db,'leaveRead',{}, {id:'outsider',email:'outsider@example.com'})).status,403);
  const csrf=await api(db,'leaveCreate',{from:date,to:date,type:'Ferie'},employee,{origin:'https://evil.example'});assert.equal(csrf.status,403);db.sqlite.close();
});

test('actual approved leave blocks publication and stale calendar fields cannot alter a decision',async()=>{
  const {db}=await setup(),stale=await plan(db),created=(await create(db)).body.request,approved=await decide(db,created);assert.equal(approved.status,200);
  stale.body.studio.requests[created.id]='rejected';stale.body.studio.leaveDecisions={[created.id]:{status:'rejected',reason:'Forged stale calendar'}};stale.body.studio.absences=[];stale.body.studio.edits.planned.note='Unrelated plan change';
  const saved=await plan(db,'PUT',{revision:stale.body.revision,studio:stale.body.studio});assert.equal(saved.status,200,JSON.stringify(saved));
  const actual=await api(db,'leaveRead',{});assert.equal(actual.body.requests[0].status,'approved');assert.deepEqual(actual.body.requests[0].decision,approved.body.request.decision);
  const latest=await plan(db),publication=await plan(db,'PUT',{revision:latest.body.revision,studio:latest.body.studio,publication:{from,to,siteIds:[0],includeDependencies:true}});assert.equal(publication.status,400,JSON.stringify(publication));assert.equal(publication.body.error,'publication_leave');assert.equal(Publication.publishedShifts((await Store.readStudio(db,owner.id)).studio).length,0);db.sqlite.close();
});

test('a concurrent approval invalidates a publication after its preflight check without publishing or losing the leave decision',async()=>{
  const {db,workspace}=await setup(),created=(await create(db)).body.request,current=await plan(db),before=await Store.readStudio(db,owner.id);
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE studio_states SET revision')))return;db.beforeBatch=null;assert.equal((await decide(db,created)).status,200);};
  const publication=await plan(db,'PUT',{revision:current.body.revision,studio:current.body.studio,publication:{from,to,siteIds:[0],includeDependencies:true}});assert.ok([403,409].includes(publication.status),JSON.stringify(publication));
  assert.deepEqual(await Store.readStudio(db,owner.id),before);assert.equal((await api(db,'leaveRead')).body.requests[0].status,'approved');assert.equal(leaveAudit(db,workspace.id).length,2);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_activity WHERE kind='publication'").get().n,0);db.sqlite.close();
});

test('concurrent decisions commit one outcome and no phantom audit; a plan change fences an already-read decision',async()=>{
  const {db,workspace}=await setup(),created=(await create(db)).body.request;
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_absences SET status')))return;db.beforeBatch=null;assert.equal((await decide(db,created,'rejected','Ingen afløser')).status,200);};
  const loser=await decide(db,created);assert.equal(loser.status,409);assert.equal(leaveAudit(db,workspace.id).length,2);assert.equal((await api(db,'leaveRead')).body.requests[0].status,'rejected');
  const next=(await create(db,employee,{from:add(date,4),to:add(date,4)})).body.request,audits=leaveAudit(db,workspace.id).length;
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE workspace_absences SET status')))return;db.beforeBatch=null;const snapshot=await plan(db);snapshot.body.studio.edits.planned.note='Concurrent plan';assert.equal((await plan(db,'PUT',{revision:snapshot.body.revision,studio:snapshot.body.studio})).status,200);};
  assert.equal((await decide(db,next)).status,409);assert.equal(leaveAudit(db,workspace.id).length,audits);assert.equal((await api(db,'leaveRead',{status:'pending'})).body.requests[0].id,next.id);db.sqlite.close();
});

test('an audit failure rolls back both absence data and aggregate version; revocation cannot commit a request',async()=>{
  const {db,workspace}=await setup(),before=await Store.readStudio(db,owner.id),version=db.sqlite.prepare('SELECT version FROM workspace_absence_imports WHERE workspace_id=?').get(workspace.id).version;
  db.sqlite.exec("CREATE TRIGGER fail_absence_audit BEFORE INSERT ON workspace_activity WHEN NEW.kind='leave' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.equal((await create(db)).status,500);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_absences').get().n,0);assert.equal(db.sqlite.prepare('SELECT version FROM workspace_absence_imports').get().version,version);assert.deepEqual(await Store.readStudio(db,owner.id),before);
  db.sqlite.exec('DROP TRIGGER fail_absence_audit');
  db.beforeBatch=statements=>{if(!statements.some(item=>item.sql.startsWith('INSERT INTO workspace_absences')))return;db.beforeBatch=null;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(employee.id);};
  assert.ok([403,409].includes((await create(db)).status));assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_absences').get().n,0);assert.equal(leaveAudit(db,workspace.id).length,0);db.sqlite.close();
});

test('leave keyset pagination and status/date filters remain person scoped and reject malformed input',async()=>{
  const {db}=await setup();for(let index=0;index<5;index++)assert.equal((await create(db,employee,{from:add(date,index),to:add(date,index)})).status,200);await create(db,peer);
  const ids=[];let cursor;do{const page=await api(db,'leaveRead',{limit:2,...(cursor?{cursor}:{})},employee);assert.equal(page.status,200);ids.push(...page.body.requests.map(item=>item.id));cursor=page.body.nextCursor;if(!page.body.hasMore)assert.equal(cursor,null);}while(cursor);assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
  const filtered=await api(db,'leaveRead',{from:add(date,2),to:add(date,3),status:'pending'},employee);assert.equal(filtered.body.requests.length,2);
  for(const payload of [{limit:501},{cursor:'bad'},{from:'2026-02-31'},{status:'invented'}])assert.equal((await api(db,'leaveRead',payload,employee)).status,400);db.sqlite.close();
});

test('creation dates are bounded and the final supported day terminates the inclusive date expansion',async()=>{
  const {db}=await setup();
  for(const patch of [{from:'1999-12-31',to:'1999-12-31'},{from:'9999-12-31',to:'9999-12-31'},{from:'2101-01-01',to:'2101-01-01'},{from:date,to:add(date,-1)},{from:date,to:add(date,366)}]){
    const rejected=await create(db,employee,patch);assert.equal(rejected.status,400,JSON.stringify(patch));assert.equal(rejected.body.error,'leave_date_invalid');
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_absences').get().n,0);
  const last=await create(db,employee,{from:Data.maxDate,to:Data.maxDate});assert.equal(last.status,200);assert.deepEqual(last.body.request.days,[Data.maxDate]);
  const first=await create(db,employee,{from:Data.minDate,to:Data.minDate});assert.equal(first.status,200);assert.deepEqual(first.body.request.days,[Data.minDate]);
  const longest=await create(db,employee,{from:date,to:add(date,365)});assert.equal(longest.status,200);assert.equal(longest.body.request.days.length,366);db.sqlite.close();
});

test('a real absence keeps an unbound employee identity intact while archiving remains possible',async()=>{
  const db=database();await bootstrap(db);const created=await create(db,owner,{personId:people[1].id});assert.equal(created.status,200);
  const before=await Store.readStudio(db,owner.id),snapshot=await plan(db);snapshot.body.studio.roster=[people[0]];
  const rejected=await plan(db,'PUT',{revision:snapshot.body.revision,studio:snapshot.body.studio});assert.equal(rejected.status,400);assert.equal(rejected.body.error,'person_has_records');assert.deepEqual(await Store.readStudio(db,owner.id),before);
  snapshot.body.studio.roster=[people[0],{...people[1],active:false}];assert.equal((await plan(db,'PUT',{revision:snapshot.body.revision,studio:snapshot.body.studio})).status,200);assert.equal((await api(db,'leaveRead')).body.requests[0].id,created.body.request.id);db.sqlite.close();
});

test('the committing roster SQL fences a concurrently created absence and the reverse race cannot create an orphan',async()=>{
  const db=database();await bootstrap(db);const before=await Store.readStudio(db,owner.id),snapshot=await plan(db);snapshot.body.studio.roster=[people[0]];
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('UPDATE studio_states SET revision')))return;db.beforeBatch=null;assert.equal((await create(db,owner,{personId:people[1].id})).status,200);};
  const rejected=await plan(db,'PUT',{revision:snapshot.body.revision,studio:snapshot.body.studio});assert.equal(rejected.status,409);assert.deepEqual(await Store.readStudio(db,owner.id),before);assert.equal(db.sqlite.prepare('SELECT person_id FROM workspace_absences').get().person_id,people[1].id);db.sqlite.close();
  const reverse=database();await bootstrap(reverse);
  reverse.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('INSERT INTO workspace_absences')))return;reverse.beforeBatch=null;const current=await plan(reverse);current.body.studio.roster=[people[0]];assert.equal((await plan(reverse,'PUT',{revision:current.body.revision,studio:current.body.studio})).status,200);};
  assert.equal((await create(reverse,owner,{personId:people[1].id})).status,409);assert.equal(reverse.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_absences').get().n,0);assert.deepEqual((await Store.readStudio(reverse,owner.id)).studio.roster,[people[0]]);reverse.sqlite.close();
});

test('long comments are hydrated and paged through size metadata with a byte ceiling and every request remains reachable',async()=>{
  const {db,workspace}=await setup(),seeded=seedRequests(db,workspace.id,32,{comment:'æ'.repeat(100000)}),original=db.batch,calls=[];
  db.batch=async statements=>{const results=await original(statements);statements.forEach((statement,index)=>{if(statement.sql.includes('workspace_absences'))calls.push({sql:statement.sql,bytes:(results[index].results||[]).reduce((sum,row)=>sum+(typeof row.config==='string'?Buffer.byteLength(row.config):0),0)});});return results;};
  const snapshot=await plan(db);assert.equal(snapshot.status,200);assert.equal(snapshot.body.studio.absenceHasMore,true);assert.ok(snapshot.body.studio.absences.length<seeded.length);assert.ok(Buffer.byteLength(JSON.stringify(snapshot.body.studio.absences))<=ABSENCE_PAGE_BYTES+1000);
  const ids=[];let cursor;do{const response=await api(db,'leaveRead',{limit:500,...(cursor?{cursor}:{})});assert.equal(response.status,200,JSON.stringify(response));assert.ok(response.body.requests.length<32);assert.equal(response.body.counts.all,32);ids.push(...response.body.requests.map(item=>item.id));cursor=response.body.nextCursor;}while(cursor);
  assert.equal(ids.length,32);assert.equal(new Set(ids).size,32);assert.ok(calls.some(call=>call.sql.includes('length(CAST(config AS BLOB))')));assert.ok(calls.every(call=>call.bytes<=ABSENCE_PAGE_BYTES));db.sqlite.close();
});

test('server-side name/type/date/status filters and counts cover all matching history while employee searches keep own scope',async()=>{
  const {db,workspace}=await setup(),seeded=seedRequests(db,workspace.id,24),expected=seeded.filter(item=>item.p===people[0].id&&item.type==='Ferie'&&item.days[0]>=date&&item.days[0]<=add(date,10));
  const filtered=await api(db,'leaveRead',{q:'ANNA',type:'Ferie',from:date,to:add(date,10),status:'approved',limit:500});assert.equal(filtered.status,200);assert.deepEqual(filtered.body.requests.map(item=>item.id).sort(),expected.filter(item=>item.status==='approved').map(item=>item.id).sort());assert.equal(filtered.body.counts.all,expected.length);for(const status of ['pending','approved','rejected'])assert.equal(filtered.body.counts[status],expected.filter(item=>item.status===status).length);
  const deniedSearch=await api(db,'leaveRead',{q:'Bo',type:'Sygdom',limit:500},employee);assert.equal(deniedSearch.status,200);assert.deepEqual(deniedSearch.body.requests,[]);assert.equal(deniedSearch.body.counts.all,0);
  for(const payload of [{q:'x'.repeat(121)},{type:'Unknown'},{from:add(date,1),to:date}])assert.equal((await api(db,'leaveRead',payload)).status,400);db.sqlite.close();
});

test('cursor paging reaches records beyond the old five-thousand-row projection without duplicates or truncating history',async()=>{
  const {db,workspace}=await setup();seedRequests(db,workspace.id,5010,{sameDay:true});const snapshot=await plan(db);assert.equal(snapshot.status,200);assert.equal(snapshot.body.studio.absences.length,100);assert.equal(snapshot.body.studio.absenceHasMore,true);
  const ids=[];let cursor;do{const response=await api(db,'leaveRead',{limit:500,...(cursor?{cursor}:{})});assert.equal(response.status,200);assert.equal(response.body.counts.all,5010);ids.push(...response.body.requests.map(item=>item.id));cursor=response.body.nextCursor;}while(cursor);
  assert.equal(ids.length,5010);assert.equal(new Set(ids).size,5010);db.sqlite.close();
});

test('a concurrent row growth is fenced after metadata and corrupt oversized history never loads its full payload',async()=>{
  const {db,workspace}=await setup(),entry=seedRequests(db,workspace.id,1)[0];
  db.beforeBatch=statements=>{if(!statements.some(item=>item.sql.startsWith('SELECT a.* FROM json_each')))return;db.beforeBatch=null;const next={...entry,version:2,comment:'b'.repeat(100000)};db.sqlite.prepare('UPDATE workspace_absences SET config=?,version=2 WHERE workspace_id=? AND id=?').run(JSON.stringify(next),workspace.id,entry.id);};
  const raced=await api(db,'leaveRead');assert.equal(raced.status,409);assert.equal(Object.hasOwn(raced.body,'requests'),false);
  const oversized={...entry,version:3,comment:'x'.repeat(2*1024*1024)};db.sqlite.prepare('UPDATE workspace_absences SET config=?,version=3 WHERE workspace_id=? AND id=?').run(JSON.stringify(oversized),workspace.id,entry.id);let payloadReads=0;
  db.beforeBatch=statements=>{if(statements.some(item=>item.sql.startsWith('SELECT a.* FROM json_each')))payloadReads++;};
  const rejected=await api(db,'leaveRead');assert.equal(rejected.status,413);assert.equal(rejected.body.error,'leave_entry_too_large');assert.equal(payloadReads,0);db.sqlite.close();
});

test('a planner records sickness as approved in one atomic audited row while the original shift and attendance remain unchanged',async()=>{
  const {db,workspace}=await setup(),before=await Store.readStudio(db,owner.id);
  const saved=await api(db,'leaveCreate',{personId:people[0].id,from:date,to:date,type:'Sygdom',recordSickness:true,comment:'',decision:{decidedBy:{userId:'forged'},decidedAt:'1900-01-01T00:00:00Z'}});
  assert.equal(saved.status,200,JSON.stringify(saved));
  const entry=saved.body.request;assert.equal(entry.status,'approved');assert.equal(entry.version,1);assert.equal(entry.type,'Sygdom');assert.deepEqual(entry.days,[date]);assert.equal(entry.decision.decidedBy.userId,owner.id);assert.equal(entry.decision.decidedAt,entry.createdAt);assert.notEqual(entry.decision.decidedAt,'1900-01-01T00:00:00Z');
  assert.deepEqual(await Store.readStudio(db,owner.id),before,'Sickness must not erase assignments or change payroll/attendance snapshots.');
  const own=await api(db,'leaveRead',{},employee);assert.equal(own.body.requests[0].id,entry.id);assert.equal(own.body.requests[0].status,'approved');
  const audits=leaveAudit(db,workspace.id);assert.equal(audits.length,1);assert.equal(audits[0].summary,'Sygemelding registreret');assert.equal(audits[0].changes[0].after,'approved');
  const duplicate=await api(db,'leaveCreate',{personId:people[0].id,from:date,to:add(date,1),type:'Sygdom',recordSickness:true});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error,'leave_sickness_exists');assert.equal(leaveAudit(db,workspace.id).length,1);
  db.sqlite.close();
});

test('employees cannot self-approve sickness, and planner direct registration is limited to sickness',async()=>{
  const {db,workspace}=await setup();
  const forbidden=await create(db,employee,{from:date,to:date,type:'Sygdom',recordSickness:true});assert.equal(forbidden.status,403);assert.equal(forbidden.body.error,'leave_sickness_forbidden');
  const wrongType=await api(db,'leaveCreate',{personId:people[0].id,from:date,to:date,type:'Ferie',recordSickness:true});assert.equal(wrongType.status,400);
  assert.equal(leaveAudit(db,workspace.id).length,0);
  const requested=await create(db,employee,{from:date,to:date,type:'Sygdom',status:'approved'});assert.equal(requested.status,200);assert.equal(requested.body.request.status,'pending');
  db.sqlite.close();
});

test('a concurrent duplicate sickness cannot create a second registration or phantom audit',async()=>{
  const {db,workspace}=await setup();let winner;
  db.beforeBatch=async statements=>{if(!statements.some(item=>item.sql.startsWith('INSERT INTO workspace_absences')&&item.sql.includes('NOT EXISTS')))return;db.beforeBatch=null;winner=await api(db,'leaveCreate',{personId:people[0].id,from:date,to:date,type:'Sygdom',recordSickness:true});assert.equal(winner.status,200);};
  const loser=await api(db,'leaveCreate',{personId:people[0].id,from:date,to:date,type:'Sygdom',recordSickness:true});assert.equal(loser.status,409);assert.equal(leaveAudit(db,workspace.id).length,1);assert.equal((await api(db,'leaveRead',{personId:people[0].id,type:'Sygdom'})).body.requests.length,1);
  db.sqlite.close();
});
