const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js');
const owner={id:'chat-owner',email:'owner@example.com'},worker={id:'chat-worker',email:'worker@example.com'},other={id:'chat-other',email:'other@example.com'},planner={id:'chat-planner',email:'planner@example.com'},foreign={id:'chat-foreign',email:'foreign@example.com'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,queries:[],beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const values=statements.map(({sql,values})=>{assert.ok(values.length<=100);const q=sqlite.prepare(sql),r=q.columns().length?{results:q.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(q.run(...values).changes)}};db.queries.push({sql,values,returned:r.results});return r;});sqlite.exec('COMMIT');return values;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
function request(action,payload={},actor=owner){return new Request('https://chat.example/api/accounts',{method:'POST',headers:{origin:'https://chat.example','content-type':'application/json',...(actor?{'oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email,'oai-authenticated-user-full-name':actor.id}:{})},body:JSON.stringify({action,...payload})});}
async function api(db,action,payload={},actor=owner){const response=await Workspace.handleAccountsRequest(request(action,payload,actor),db);return {status:response.status,body:await response.json()};}
async function invite(db,actor,personId,roleId='employee'){const sent=await api(db,'invite',{email:actor.email,roleId,...(personId?{personId}:{})});assert.equal(sent.status,200,JSON.stringify(sent));const accepted=await api(db,'acceptInvite',{token:new URL(sent.body.inviteUrl).searchParams.get('token')},actor);assert.equal(accepted.status,200,JSON.stringify(accepted));}
async function setup(){const db=database(),roster=[{id:'person-chat-one',name:'Anna Jensen',initials:'AJ',site:0,target:37,role:'Service',active:true},{id:'person-chat-two',name:'Bo Hansen',initials:'BH',site:1,target:30,role:'Service',active:true}],studio={storageVersion:1,demoSeed:false,roster,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{}};assert.equal((await Store.writeStudio(db,owner.id,0,studio)).ok,true);const initial=await api(db,'chatList');assert.equal(initial.status,200,JSON.stringify(initial));await invite(db,worker,roster[0].id);await invite(db,other,roster[1].id);await invite(db,planner,null,'planner');const north=await api(db,'chatCreate',{departmentId:'dep-nord',name:'Kontor Nord'}),clinic=await api(db,'chatCreate',{departmentId:'dep-klinik',name:'Klinikken'});assert.equal(north.status,200,JSON.stringify(north));assert.equal(clinic.status,200,JSON.stringify(clinic));const workspaceId=db.sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner.id).id;return {db,studio,workspaceId,north:north.body.room,clinic:clinic.body.room};}

test('chat room access follows stable employee worksite membership and chat management, not guessed departments',async()=>{
 const {db,north,clinic}=await setup();const list=await api(db,'chatList',{},worker);assert.equal(list.status,200);assert.deepEqual(list.body.rooms.map(room=>room.id),[north.id]);assert.equal(list.body.canManage,false);assert.deepEqual(list.body.departments,[]);assert.equal(list.body.rooms[0].memberCount,1);
 assert.equal((await api(db,'chatRead',{roomId:clinic.id},worker)).status,403);assert.equal((await api(db,'chatSend',{roomId:clinic.id,clientId:'spoof',text:'No'},worker)).status,403);assert.equal((await api(db,'chatCreate',{departmentId:'dep-havn',name:'No'},worker)).status,403);assert.equal((await api(db,'chatList',{},null)).status,401);
 assert.equal((await api(db,'chatList',{workspaceId:'forged'},worker)).status,400);assert.equal((await api(db,'chatCreate',{departmentId:'dep-nord',name:'Duplicate'})).status,409);assert.equal((await api(db,'chatCreate',{departmentId:'dep-havn',name:'Bad\nName'})).status,400);db.sqlite.close();
});

test('messages are durable, literal, sequenced and idempotent without increasing the planning revision',async()=>{
 const {db,north}=await setup(),before=db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner.id).revision;
 const text='Hej <script>alert(1)</script>\nNøglen ligger ved indgangen.',first=await api(db,'chatSend',{roomId:north.id,clientId:'message-1',text},worker);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.message.authorId,worker.id);assert.equal(first.body.message.seq,1);assert.equal(first.body.message.text,text);
 const retry=await api(db,'chatSend',{roomId:north.id,clientId:'message-1',text},worker);assert.equal(retry.status,200);assert.equal(retry.body.message.id,first.body.message.id);assert.equal(retry.body.room.latestSeq,1);assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'message-1',text:'Different'},worker)).status,409);
 const reply=await api(db,'chatSend',{roomId:north.id,clientId:'manager-1',text:'Tak!'});assert.equal(reply.status,200);assert.equal(reply.body.message.seq,2);const loaded=await api(db,'chatRead',{roomId:north.id},worker);assert.equal(loaded.status,200);assert.deepEqual(loaded.body.messages.map(item=>item.text),[text,'Tak!']);assert.equal(loaded.body.room.unread,1);assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner.id).revision,before);
 assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'invalid',text:'x'.repeat(10001)},worker)).status,400);assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'impersonate',text:'No',authorId:owner.id},worker)).status,400);db.sqlite.close();
});

test('read markers are monotonic, exclude own messages and cannot spoof other users or future sequences',async()=>{
 const {db,north}=await setup();for(let index=0;index<3;index++)assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'manager-'+index,text:'Message '+index})).status,200);
 assert.equal((await api(db,'chatList',{},worker)).body.unreadCount,3);assert.equal((await api(db,'chatReadMark',{roomId:north.id,throughSeq:2},worker)).body.room.unread,1);assert.equal((await api(db,'chatReadMark',{roomId:north.id,throughSeq:1},worker)).body.room.unread,1);assert.equal((await api(db,'chatReadMark',{roomId:north.id,throughSeq:4},worker)).status,400);
 assert.equal((await api(db,'chatReadMark',{roomId:north.id,throughSeq:3,userId:other.id},worker)).status,400);assert.equal((await api(db,'chatMute',{roomId:north.id,muted:true},worker)).status,200);const muted=await api(db,'chatList',{},worker);assert.equal(muted.body.rooms[0].unread,1);assert.equal(muted.body.unreadCount,0);assert.equal(muted.body.rooms[0].muted,true);assert.equal((await api(db,'chatReadMark',{roomId:north.id,throughSeq:3},worker)).body.room.muted,true);assert.equal((await api(db,'chatMute',{roomId:north.id,muted:false},worker)).body.room.unread,0);db.sqlite.close();
});

test('pinning is permission and room scoped, version checked and capped at three pins',async()=>{
 const {db,north,clinic}=await setup(),messages=[];for(let index=0;index<4;index++)messages.push((await api(db,'chatSend',{roomId:north.id,clientId:'pin-'+index,text:'Pin '+index})).body.message);let version=north.version;
 assert.equal((await api(db,'chatPin',{roomId:north.id,messageId:messages[0].id,pinned:true,version},worker)).status,403);assert.equal((await api(db,'chatPin',{roomId:clinic.id,messageId:messages[0].id,pinned:true,version})).status,404);
 for(let index=0;index<3;index++){const pin=await api(db,'chatPin',{roomId:north.id,messageId:messages[index].id,pinned:true,version});assert.equal(pin.status,200,JSON.stringify(pin));version=pin.body.room.version;}
 assert.equal((await api(db,'chatPin',{roomId:north.id,messageId:messages[3].id,pinned:true,version})).status,400);assert.equal((await api(db,'chatUpdate',{roomId:north.id,name:'Changed',version:1})).status,409);const read=await api(db,'chatRead',{roomId:north.id},worker);assert.equal(read.body.pins.length,3);
 const unpin=await api(db,'chatPin',{roomId:north.id,messageId:messages[0].id,pinned:false,version});assert.equal(unpin.status,200);assert.equal((await api(db,'chatRead',{roomId:north.id},worker)).body.pins.length,2);db.sqlite.close();
});

test('bounded pagination retains every message once and binds cursors to workspace, actor and room',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 // Build history across ordinary send windows; pagination is not a quota bypass.
 const {db,north,clinic,studio}=await setup();for(let index=0;index<57;index++){if(index===30)t.mock.timers.tick(61000);assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'page-'+index,text:'Message '+index})).status,200);}
 const page=await api(db,'chatRead',{roomId:north.id},worker);assert.equal(page.body.messages.length,50);assert.equal(page.body.messages[0].seq,8);assert.equal(page.body.hasMore,true);const previous=await api(db,'chatRead',{roomId:north.id,before:page.body.nextCursor},worker);assert.equal(previous.body.messages.length,7);assert.equal(previous.body.hasMore,false);assert.deepEqual([...previous.body.messages,...page.body.messages].map(item=>item.seq),Array.from({length:57},(_,index)=>index+1));
 assert.equal((await api(db,'chatRead',{roomId:clinic.id,before:page.body.nextCursor})).status,400);assert.equal((await api(db,'chatRead',{roomId:north.id,before:page.body.nextCursor})).status,400);
 assert.equal((await Store.writeStudio(db,foreign.id,0,studio)).ok,true);assert.equal((await api(db,'chatRead',{roomId:north.id},foreign)).status,403);db.sqlite.close();
});

test('employee chat previews require chat administration as well as planning and never allow writes',async()=>{
 const {db,north}=await setup();assert.equal((await api(db,'chatList',{previewPersonId:'person-chat-one'},planner)).status,403);const preview=await api(db,'chatList',{previewPersonId:'person-chat-one'});assert.equal(preview.status,200);assert.equal(preview.body.readonly,true);assert.equal(preview.body.canManage,false);assert.deepEqual(preview.body.rooms.map(room=>room.id),[north.id]);assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'preview',text:'No',previewPersonId:'person-chat-one'})).status,400);assert.equal((await api(db,'chatList',{previewPersonId:'missing'})).status,409);db.sqlite.close();
});

test('demo seeding is explicit, idempotent and never modifies existing user rooms or impersonates real users',async()=>{
 const {db,north}=await setup();assert.equal((await api(db,'chatDemo',{},worker)).status,403);const before=db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n;const demo=await api(db,'chatDemo');assert.equal(demo.status,200);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages WHERE room_id=?').get(north.id).n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n,before,'First two departments already have user rooms.');
 db.sqlite.prepare('DELETE FROM workspace_chat_rooms WHERE department_id=?').run('dep-klinik');const seeded=await api(db,'chatDemo');assert.equal(seeded.status,200);const messages=db.sqlite.prepare('SELECT * FROM workspace_chat_messages').all();assert.equal(messages.length,3);assert.ok(messages.every(row=>row.demo===1&&row.author_name.startsWith('Demo ·')&&row.author_id!==owner.id&&row.author_id!==worker.id));await api(db,'chatDemo');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n,3);db.sqlite.close();
});

for(const change of ['site','archive','department','role','membership'])test('a late '+change+' revocation denies a message without writing a row',async()=>{
 const {db,north,workspaceId}=await setup();let changed=false;db.beforeBatch=statements=>{if(!changed&&statements.some(item=>item.sql.startsWith('UPDATE workspace_chat_rooms SET latest_seq'))){changed=true;
  if(change==='role')db.sqlite.prepare('UPDATE workspace_roles SET version=version+1 WHERE workspace_id=? AND id=?').run(workspaceId,'employee');
  else if(change==='membership')db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(worker.id);
  else{if(change==='site')db.sqlite.prepare("UPDATE workspace_directory_records SET site_index=1,version=version+1 WHERE workspace_id=? AND kind='employee' AND id=?").run(workspaceId,'person-chat-one');if(change==='archive')db.sqlite.prepare("UPDATE workspace_directory_records SET active=0,version=version+1 WHERE workspace_id=? AND kind='employee' AND id=?").run(workspaceId,'person-chat-one');if(change==='department')db.sqlite.prepare("UPDATE workspace_directory_records SET deleted=1,version=version+1 WHERE workspace_id=? AND kind='department' AND id=?").run(workspaceId,'dep-nord');db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1,write_token=? WHERE workspace_id=?').run('revoked-chat',workspaceId);}
 }};const denied=await api(db,'chatSend',{roomId:north.id,clientId:'revoked',text:'Must not save'},worker);db.beforeBatch=null;assert.equal(changed,true);assert.ok([403,409].includes(denied.status),JSON.stringify(denied));assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages WHERE room_id=?').get(north.id).n,0);assert.equal(db.sqlite.prepare('SELECT latest_seq FROM workspace_chat_rooms WHERE id=?').get(north.id).latest_seq,0);db.sqlite.close();
});

test('room list and room bodies fail closed if directory or role authority changes before the final fence',async()=>{
 for(const action of ['chatList','chatRead']){const {db,north,workspaceId}=await setup();await api(db,'chatSend',{roomId:north.id,clientId:'secret',text:'CHAT_PRIVATE'});let changed=false;db.beforeBatch=statements=>{if(!changed&&statements.some(item=>item.sql.includes('SELECT room.*'))){changed=true;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(worker.id);}};const denied=await api(db,action,action==='chatRead'?{roomId:north.id}:{},worker);assert.equal(changed,true);assert.equal(denied.status,403,JSON.stringify(denied));assert.equal(JSON.stringify(denied.body).includes('CHAT_PRIVATE'),false);db.sqlite.close();}
});

test('large Unicode histories page by byte budget without losing messages or returning the full plan',async()=>{
 const {db,north}=await setup(),body='æ'.repeat(10000);for(let index=0;index<30;index++)assert.equal((await api(db,'chatSend',{roomId:north.id,clientId:'unicode-'+index,text:body},worker)).status,200);
 db.queries=[];const first=await api(db,'chatRead',{roomId:north.id},worker);assert.equal(first.status,200);assert.ok(first.body.messages.length<30);assert.ok(first.body.messages.length>0);assert.ok(Buffer.byteLength(JSON.stringify(first.body))<650*1024);assert.equal(first.body.hasMore,true);
 const earlier=await api(db,'chatRead',{roomId:north.id,before:first.body.nextCursor},worker);assert.equal(earlier.status,200);const result=[...earlier.body.messages,...first.body.messages];assert.equal(result.length,30);assert.equal(new Set(result.map(row=>row.id)).size,30);assert.ok(result.every(row=>row.text===body));
 assert.equal(db.queries.some(row=>/FROM (studio_state_chunks|workspace_plan_records|workspace_plan_record_chunks|workspace_published_shifts)/.test(row.sql)),false);db.sqlite.close();
});

test('overlapping retries of the same client request advance a room only once and never hide a different body',async()=>{
 const {db,north}=await setup();let raced=false;db.beforeBatch=async statements=>{if(!raced&&statements.some(row=>row.sql.startsWith('UPDATE workspace_chat_rooms SET latest_seq'))){raced=true;const peer=await api(db,'chatSend',{roomId:north.id,clientId:'concurrent',text:'Same body'},worker);assert.equal(peer.status,200,JSON.stringify(peer));}};
 const duplicate=await api(db,'chatSend',{roomId:north.id,clientId:'concurrent',text:'Same body'},worker);assert.equal(duplicate.status,200);assert.equal(duplicate.body.message.seq,1);assert.equal(duplicate.body.room.latestSeq,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_messages').get().n,1);db.beforeBatch=null;
 raced=false;db.beforeBatch=async statements=>{if(!raced&&statements.some(row=>row.sql.startsWith('UPDATE workspace_chat_rooms SET latest_seq'))){raced=true;const peer=await api(db,'chatSend',{roomId:north.id,clientId:'collision',text:'Authoritative first body'},worker);assert.equal(peer.status,200);}};
 const collision=await api(db,'chatSend',{roomId:north.id,clientId:'collision',text:'Stale second body'},worker);assert.equal(collision.status,409);assert.equal(db.sqlite.prepare('SELECT latest_seq FROM workspace_chat_rooms WHERE id=?').get(north.id).latest_seq,2);assert.deepEqual(db.sqlite.prepare('SELECT text FROM workspace_chat_messages ORDER BY seq').all().map(row=>row.text),['Same body','Authoritative first body']);db.sqlite.close();
});

function seedChatMessages(db,workspaceId,room,count,textFor=index=>'Message '+index){
 const put=db.sqlite.prepare('INSERT INTO workspace_chat_messages(workspace_id,room_id,id,seq,author_id,author_name,client_id,text,created_at,pinned,demo) VALUES(?,?,?,?,?,?,?,?,?,0,0)');
 for(let seq=1;seq<=count;seq++)put.run(workspaceId,room.id,room.id+'-sync-'+seq,seq,owner.id,'Chat owner','sync-seed-'+seq,textFor(seq),'2026-11-04T10:00:00.000Z');
 db.sqlite.prepare('UPDATE workspace_chat_rooms SET latest_seq=? WHERE workspace_id=? AND id=?').run(count,workspaceId,room.id);
}

test('unchanged chat sync is compact and never loads message bodies, pin rows or full room summaries',async()=>{
 const {db,north,workspaceId}=await setup();seedChatMessages(db,workspaceId,north,3);db.queries=[];
 const result=await api(db,'chatSync',{roomId:north.id,afterSeq:3,version:north.version},worker);assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(result.body.unchanged,true);assert.equal(result.body.latestSeq,3);assert.equal(result.body.throughSeq,3);assert.equal(result.body.hasMoreNew,false);assert.equal(result.body.version,1);
 for(const key of ['messages','pins','room'])assert.equal(Object.hasOwn(result.body,key),false,key);
 assert.equal(db.queries.some(row=>row.sql.includes('workspace_chat_messages')||row.sql.includes('member_count')),false);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_readers').get().n,0,'Checking for changes never marks messages read.');db.sqlite.close();
});

test('ascending chat deltas drain bursts larger than two pages without skipping or repeating sequences',async()=>{
 const {db,north,workspaceId}=await setup();seedChatMessages(db,workspaceId,north,123);db.queries=[];const collected=[];let afterSeq=0;
 for(const length of [50,50,23]){const result=await api(db,'chatSync',{roomId:north.id,afterSeq,version:1},worker);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.unchanged,false);assert.equal(result.body.messages.length,length);assert.equal(result.body.messages[0].seq,afterSeq+1);assert.equal(Object.hasOwn(result.body,'pins'),false);afterSeq=result.body.throughSeq;assert.equal(result.body.hasMoreNew,afterSeq<123);collected.push(...result.body.messages);}
 assert.deepEqual(collected.map(row=>row.seq),Array.from({length:123},(_,index)=>index+1));assert.equal(new Set(collected.map(row=>row.id)).size,123);assert.equal(afterSeq,123);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_readers').get().n,0);assert.equal(db.queries.some(row=>/FROM (studio_state_chunks|workspace_plan_records|workspace_plan_record_chunks|workspace_published_shifts)/.test(row.sql)),false);db.sqlite.close();
});

test('Unicode deltas are byte bounded and use delivered sequence instead of the room latest sequence',async()=>{
 const {db,north,workspaceId}=await setup(),body='æ'.repeat(10000);seedChatMessages(db,workspaceId,north,30,()=>body);
 const first=await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1},worker);assert.equal(first.status,200,JSON.stringify(first));assert.ok(first.body.messages.length>0&&first.body.messages.length<30);assert.ok(Buffer.byteLength(JSON.stringify(first.body))<650*1024);assert.equal(first.body.hasMoreNew,true);assert.equal(first.body.latestSeq,30);assert.equal(first.body.throughSeq,first.body.messages.at(-1).seq);assert.ok(first.body.throughSeq<30);
 const next=await api(db,'chatSync',{roomId:north.id,afterSeq:first.body.throughSeq,version:1},worker);assert.equal(next.status,200);const messages=[...first.body.messages,...next.body.messages];assert.equal(messages.length,30);assert.ok(messages.every(row=>row.text===body));assert.deepEqual(messages.map(row=>row.seq),Array.from({length:30},(_,index)=>index+1));assert.equal(next.body.hasMoreNew,false);db.sqlite.close();
});

test('metadata-only sync returns the matching pins and room name without advancing delivered sequence',async()=>{
 const {db,north}=await setup(),sent=await api(db,'chatSend',{roomId:north.id,clientId:'sync-pinned',text:'Important'}),pin=await api(db,'chatPin',{roomId:north.id,messageId:sent.body.message.id,pinned:true,version:1});assert.equal(pin.status,200);
 const renamed=await api(db,'chatUpdate',{roomId:north.id,name:'Updated department room',version:pin.body.room.version});assert.equal(renamed.status,200);
 const result=await api(db,'chatSync',{roomId:north.id,afterSeq:1,version:1},worker);assert.equal(result.status,200);assert.equal(result.body.unchanged,false);assert.equal(result.body.room.name,'Updated department room');assert.equal(result.body.version,3);assert.deepEqual(result.body.messages,[]);assert.equal(result.body.pins.length,1);assert.equal(result.body.pins[0].id,sent.body.message.id);assert.equal(result.body.throughSeq,1);assert.equal(result.body.hasMoreNew,false);
 const unchanged=await api(db,'chatSync',{roomId:north.id,afterSeq:1,version:3},worker);assert.equal(unchanged.body.unchanged,true);assert.equal(Object.hasOwn(unchanged.body,'pins'),false);db.sqlite.close();
});

test('chat deltas retain room, tenant, payload and read-only preview restrictions',async()=>{
 const {db,north,clinic,studio}=await setup();assert.equal((await api(db,'chatSync',{roomId:clinic.id,afterSeq:0,version:1},worker)).status,403);assert.equal((await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1},null)).status,401);
 assert.equal((await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1,previewPersonId:'person-chat-one'},planner)).status,403);
 const preview=await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1,previewPersonId:'person-chat-one'});assert.equal(preview.status,200);assert.equal(preview.body.readonly,true);assert.equal(preview.body.canManage,false);
 for(const invalid of [{afterSeq:-1},{afterSeq:1},{afterSeq:0.1},{version:0},{version:'1'},{limit:51},{workspaceId:'other-workspace'}])assert.equal((await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1,...invalid},worker)).status,400,JSON.stringify(invalid));
 assert.equal((await Store.writeStudio(db,foreign.id,0,studio)).ok,true);assert.equal((await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1},foreign)).status,403);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_chat_readers').get().n,0);db.sqlite.close();
});

test('pin changes racing a delta read return a retryable conflict instead of acknowledging unloaded pins',async()=>{
 const {db,north,workspaceId}=await setup();seedChatMessages(db,workspaceId,north,2);let changed=false;
 db.beforeBatch=statements=>{if(!changed&&statements.some(row=>row.sql.startsWith('SELECT * FROM workspace_chat_messages')&&row.sql.includes('seq>?'))){changed=true;db.sqlite.prepare('UPDATE workspace_chat_messages SET pinned=1 WHERE workspace_id=? AND room_id=? AND seq=1').run(workspaceId,north.id);db.sqlite.prepare('UPDATE workspace_chat_rooms SET version=version+1 WHERE workspace_id=? AND id=?').run(workspaceId,north.id);}};
 const conflict=await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1},worker);assert.equal(changed,true);assert.equal(conflict.status,409,JSON.stringify(conflict));assert.equal(conflict.body.error,'chat_sync_changed');assert.equal(Object.hasOwn(conflict.body,'messages'),false);
 db.beforeBatch=null;const retried=await api(db,'chatSync',{roomId:north.id,afterSeq:0,version:1},worker);assert.equal(retried.status,200);assert.equal(retried.body.version,2);assert.equal(retried.body.pins.length,1);assert.equal(retried.body.messages.length,2);db.sqlite.close();
});

for(const unchanged of [true,false])test('a late authority revocation fails closed during '+(unchanged?'unchanged':'changed')+' chat sync',async()=>{
 const {db,north,workspaceId}=await setup();seedChatMessages(db,workspaceId,north,1,()=> 'SYNC_PRIVATE_BODY');let changed=false,fences=0;
 db.beforeBatch=statements=>{if(!changed&&statements.some(row=>row.sql.startsWith('SELECT 1 AS valid WHERE'))&&++fences===2){changed=true;db.sqlite.prepare("UPDATE workspace_members SET status='disabled',version=version+1 WHERE user_id=?").run(worker.id);}};
 const denied=await api(db,'chatSync',{roomId:north.id,afterSeq:unchanged?1:0,version:1},worker);assert.equal(changed,true);assert.ok([403,409].includes(denied.status),JSON.stringify(denied));assert.equal(JSON.stringify(denied.body).includes('SYNC_PRIVATE_BODY'),false);assert.equal(Object.hasOwn(denied.body,'messages'),false);db.sqlite.close();
});

test('a pin change racing the initial conversation read cannot establish a stale pin body at a new version',async()=>{
 const {db,north,workspaceId}=await setup();seedChatMessages(db,workspaceId,north,1);let changed=false;
 db.beforeBatch=statements=>{if(!changed&&statements.some(row=>row.sql.includes('SELECT room.*,json_extract'))){changed=true;db.sqlite.prepare('UPDATE workspace_chat_messages SET pinned=1 WHERE workspace_id=? AND room_id=? AND seq=1').run(workspaceId,north.id);db.sqlite.prepare('UPDATE workspace_chat_rooms SET version=version+1 WHERE workspace_id=? AND id=?').run(workspaceId,north.id);}};
 const conflict=await api(db,'chatRead',{roomId:north.id},worker);assert.equal(changed,true);assert.equal(conflict.status,409,JSON.stringify(conflict));assert.equal(conflict.body.error,'chat_sync_changed');assert.equal(Object.hasOwn(conflict.body,'pins'),false);
 db.beforeBatch=null;const retry=await api(db,'chatRead',{roomId:north.id},worker);assert.equal(retry.status,200);assert.equal(retry.body.room.version,2);assert.equal(retry.body.pins.length,1);db.sqlite.close();
});
