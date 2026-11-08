const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js');
const owner={id:'chat-route-owner',email:'owner@example.com'},worker={id:'chat-route-worker',email:'worker@example.com'},manager={id:'chat-route-manager',email:'manager@example.com'},planner={id:'chat-route-planner',email:'planner@example.com'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));const db={sqlite,queries:[],prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{assert.ok(values.length<=100);db.queries.push(sql);const q=sqlite.prepare(sql);return q.columns().length?{results:q.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(q.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}};return db;}
function request(url,body,actor=owner,method='POST'){return new Request('https://chat.example'+url,{method,headers:{...(actor?{'oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email,'oai-authenticated-user-full-name':actor.id}:{}),...(method==='GET'?{}:{origin:'https://chat.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const unpack=async response=>({status:response.status,body:await response.json()});
const account=(db,action,payload={},actor=owner)=>Workspace.handleAccountsRequest(request('/api/accounts',{...payload,action},actor),db).then(unpack);
const bootstrap=(db,actor=owner)=>Workspace.handleWorkspaceStudioRequest(request('/api/studio?projection=calendar&from=2026-11-02&to=2026-11-08',undefined,actor,'GET'),db).then(unpack);
async function invite(db,actor,roleId,personId){const sent=await account(db,'invite',{email:actor.email,roleId,...(personId?{personId}:{})});assert.equal(sent.status,200,JSON.stringify(sent));const accepted=await account(db,'acceptInvite',{token:new URL(sent.body.inviteUrl).searchParams.get('token')},actor);assert.equal(accepted.status,200,JSON.stringify(accepted));}
async function setup(){const db=database(),roster=[{id:'person-chat-nord',name:'Nord Person',initials:'NP',target:37,site:0,role:'Service',active:true},{id:'person-chat-klinik',name:'Klinik Person',initials:'KP',target:37,site:1,role:'Service',active:true}];assert.equal((await Store.writeStudio(db,owner.id,0,{storageVersion:1,demoSeed:false,roster,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{}})).ok,true);assert.equal((await bootstrap(db)).status,200);const north=await account(db,'chatCreate',{departmentId:'dep-nord',name:'Kontor Nord'}),clinic=await account(db,'chatCreate',{departmentId:'dep-klinik',name:'Klinikken'});assert.equal(north.status,200,JSON.stringify(north));assert.equal(clinic.status,200,JSON.stringify(clinic));return {db,north:north.body.room,clinic:clinic.body.room};}

test('actual account transport keeps department chat separate from planning and restricts workers to their affiliation',async()=>{
 const {db,north,clinic}=await setup();await invite(db,worker,'employee','person-chat-nord');
 const sent=await account(db,'chatSend',{roomId:north.id,clientId:'route-idempotent-message',text:'Hej team\nNøglen ligger i skabet.'},worker);assert.equal(sent.status,200,JSON.stringify(sent));assert.equal(sent.body.message.authorId,worker.id);
 const duplicate=await account(db,'chatSend',{roomId:north.id,clientId:'route-idempotent-message',text:'Hej team\nNøglen ligger i skabet.'},worker);assert.equal(duplicate.status,200);assert.equal(duplicate.body.message.id,sent.body.message.id);
 const synced=await account(db,'chatSync',{roomId:north.id,afterSeq:0,version:north.version},worker);assert.equal(synced.status,200,JSON.stringify(synced));assert.deepEqual(synced.body.messages.map(message=>message.id),[sent.body.message.id]);assert.equal(synced.body.throughSeq,sent.body.message.seq);
 const idle=await account(db,'chatSync',{roomId:north.id,afterSeq:sent.body.message.seq,version:north.version},worker);assert.equal(idle.status,200,JSON.stringify(idle));assert.equal(idle.body.unchanged,true);assert.equal(Object.hasOwn(idle.body,'messages'),false);assert.equal(Object.hasOwn(idle.body,'room'),false);
 assert.equal((await account(db,'chatSync',{roomId:clinic.id,afterSeq:0,version:clinic.version},worker)).status,403);
 db.queries=[];const listed=await account(db,'chatList',{},worker);assert.equal(listed.status,200,JSON.stringify(listed));assert.deepEqual(listed.body.rooms.map(room=>room.id),[north.id]);assert.equal(listed.body.canManage,false);assert.equal(listed.body.departments.length,0);
 assert.equal((await account(db,'chatRead',{roomId:clinic.id},worker)).status,403);assert.equal((await account(db,'chatCreate',{departmentId:'dep-havn',name:'Forbidden'},worker)).status,403);assert.equal((await account(db,'chatList',{},null)).status,401);assert.equal((await account(db,'chatSend',{roomId:north.id,clientId:'spoof',text:'Spoof',authorId:owner.id},worker)).status,400);
 assert.equal(db.queries.some(sql=>/FROM workspace_plan_(record_chunks|records)|FROM studio_state_chunks/.test(sql)),false,'Chat reads and writes must not hydrate the planning snapshot.');
 db.sqlite.close();
});

test('an unbound custom chat manager can manage rooms and save chat navigation without accessing the plan',async()=>{
 const {db}=await setup(),role=await account(db,'createRole',{name:'Chatansvarlig',permissions:['chat.manage']});assert.equal(role.status,200,JSON.stringify(role));await invite(db,manager,role.body.role.id);
 const boot=await bootstrap(db,manager);assert.equal(boot.status,200,JSON.stringify(boot));assert.equal(boot.body.capabilities.plan,false);assert.equal(boot.body.capabilities.manageChat,true);assert.equal(boot.body.studio,null);
 const list=await account(db,'chatList',{},manager);assert.equal(list.status,200,JSON.stringify(list));assert.equal(list.body.rooms.length,2);assert.equal(list.body.canManage,true);
 assert.equal((await account(db,'preferences',{preferences:{role:'admin',page:'chat'}},manager)).status,200);
 assert.equal((await account(db,'chatCreate',{departmentId:'dep-havn',name:'Havnegade'},manager)).status,200);
 const denied=await Workspace.handleWorkspaceStudioRequest(request('/api/studio',{revision:1,studio:{}},manager,'PUT'),db);assert.equal(denied.status,403);
 db.sqlite.close();
});

test('chat preview is read-only and requires explicit chat management in addition to planning access',async()=>{
 const {db,north,clinic}=await setup();await invite(db,planner,'planner','person-chat-nord');
 const preview=await account(db,'chatList',{previewPersonId:'person-chat-klinik'});assert.equal(preview.status,200,JSON.stringify(preview));assert.equal(preview.body.readonly,true);assert.equal(preview.body.canManage,false);assert.deepEqual(preview.body.rooms.map(room=>room.id),[clinic.id]);
 assert.equal((await account(db,'chatRead',{roomId:north.id,previewPersonId:'person-chat-klinik'})).status,403);
 assert.equal((await account(db,'chatList',{previewPersonId:'person-chat-klinik'},planner)).status,403);
 assert.equal((await account(db,'chatRead',{roomId:clinic.id},planner)).status,403);
 const sync=await account(db,'chatSync',{roomId:clinic.id,afterSeq:0,version:clinic.version,previewPersonId:'person-chat-klinik'});assert.equal(sync.status,200,JSON.stringify(sync));assert.equal(sync.body.readonly,true);
 assert.equal((await account(db,'chatSync',{roomId:clinic.id,afterSeq:0,version:clinic.version,previewPersonId:'person-chat-klinik'},planner)).status,403);
 assert.ok([400,403].includes((await account(db,'chatSend',{roomId:clinic.id,clientId:'preview-write',text:'Forbidden',previewPersonId:'person-chat-klinik'})).status));
 db.sqlite.close();
});
