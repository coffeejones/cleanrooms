const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js'),References=require('../lib/directory-references.mjs');
const {renderMobileGpsHandoff}=require('../lib/mobile-gps-handoff.mjs');
const {handleMobileAuthRequest}=require('../lib/mobile-auth-route.mjs');
const owner={id:'directory-security-owner',email:'owner@example.com'},worker={id:'directory-security-worker',email:'worker@example.com'},colleague={id:'directory-security-colleague',email:'colleague@example.com'},foreign={id:'directory-security-foreign',email:'foreign@example.com'},alpha='person-directory-alpha',beta='person-directory-beta',calendar={from:'2090-01-09',to:'2090-01-15'},stamp='2026-11-02T10:00:00.000Z';
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));const db={sqlite,beforeBatch:null,queries:[],prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{assert.ok(values.length<=100);assert.ok(values.every(value=>typeof value!=='string'||Buffer.byteLength(value)<=2*1024*1024));db.queries.push({sql,values});const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
function request(url,method='GET',body,actor=owner){return new Request('https://directory.example'+url,{method,headers:{...(actor?{'oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email,'oai-authenticated-user-full-name':actor.id}:{}),...(method==='GET'?{}:{origin:'https://directory.example','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function json(response){return {status:response.status,body:await response.json()};}
const directory=(db,body,actor=owner)=>Workspace.handleDirectoryRequest(request('/api/directory','POST',body,actor),db).then(json),accounts=(db,action,payload={},actor=owner,secret)=>Workspace.handleAccountsRequest(request('/api/accounts','POST',{...payload,action},actor),db,secret).then(json),plan=(db,{actor=owner,method='GET',body,url='/api/studio'}={})=>Workspace.handleWorkspaceStudioRequest(request(url,method,body,actor),db).then(json);
const patch=(id,version,fields,kind='employee')=>({kind,id,expectedVersion:version,patch:fields});
async function setup({count=1}={}){const db=database(),roster=[{id:alpha,name:'Anna Directory',initials:'AD',target:37,site:0,role:'Service',active:true,profileNotes:'OWN_PROFILE_NOTE '.repeat(30000)},{id:beta,name:'Bo Directory',initials:'BD',target:30,site:1,role:'Service',active:true,profileNotes:'OTHER_PROFILE_SECRET '.repeat(30000)}],shift={id:'directory-own',person:alpha,site:0,date:'2090-01-10',start:'07:00',end:'15:00',note:''};let value={storageVersion:1,demoSeed:false,roster,organization:Departments.defaultOrganization(),series:[],edits:{[shift.id]:shift},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{}};value=Publication.publish(value,{...calendar,siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:stamp}).studio;for(let index=1;index<count;index++){const id='directory-extra-'+String(index).padStart(4,'0');value.edits[id]={...shift,id};}assert.equal((await Store.writeStudio(db,owner.id,0,value)).ok,true);const loaded=await plan(db);assert.equal(loaded.status,200,JSON.stringify(loaded));return {db,loaded:loaded.body,value};}
async function join(db,actor,personId){const invite=await accounts(db,'invite',{email:actor.email,roleId:'employee',personId});assert.equal(invite.status,200,JSON.stringify(invite));assert.equal((await accounts(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},actor)).status,200);}
async function allowed(db,guard){return Boolean((await db.batch([db.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.values)]))[0].results.length);}

test('company time budget is versioned, separate from contracts, and ignores the retired employee default',async t=>{
 const {db,loaded}=await setup();t.after(()=>db.sqlite.close());
 const save=(revision,studio)=>plan(db,{method:'PUT',body:{revision,studio}});
 for(const workHoursBudget of [{period:'year',hours:160},{period:'week',hours:-1},{period:'week',hours:'37'},{period:'month',hours:160.111}]){
   const invalid=await save(loaded.revision,{...loaded.studio,workspaceSettings:{workHoursBudget}});
   assert.equal(invalid.status,400,JSON.stringify(invalid));
 }
 const legacySettings={workHours:{period:'month',hours:160}};
 const stored=db.sqlite.prepare('SELECT content FROM studio_state_chunks WHERE owner_id=? AND revision=? ORDER BY chunk_index').all(owner.id,loaded.revision);
 const raw={...JSON.parse(stored.map(row=>row.content).join('')),workspaceSettings:legacySettings};
 const {chunks,byteLength}=Store.splitSnapshot(JSON.stringify(raw));
 db.sqlite.prepare('DELETE FROM studio_state_chunks WHERE owner_id=? AND revision=?').run(owner.id,loaded.revision);
 const insert=db.sqlite.prepare('INSERT INTO studio_state_chunks (owner_id,revision,chunk_index,content) VALUES (?,?,?,?)');
 chunks.forEach((content,index)=>insert.run(owner.id,loaded.revision,index,content));
 db.sqlite.prepare('UPDATE studio_states SET chunk_count=?,byte_length=?,default_weekly_hours=? WHERE owner_id=?').run(chunks.length,byteLength,36.92,owner.id);
 const normalized=(await plan(db)).body;
 assert.deepEqual(normalized.studio.workspaceSettings,{});
 const workHoursBudget={period:'month',hours:1200.5};
 const saved=await save(normalized.revision,{...normalized.studio,workspaceSettings:{workHoursBudget}});
 assert.equal(saved.status,200,JSON.stringify(saved));
 const current=(await plan(db)).body;
 assert.deepEqual(current.studio.workspaceSettings.workHoursBudget,workHoursBudget);
 assert.deepEqual(current.studio.roster.map(person=>person.target),[37,30]);
 const legacy=await save(current.revision,{...current.studio,workspaceSettings:{...legacySettings,companyName:'CleanRooms'}});
 assert.equal(legacy.status,200,JSON.stringify(legacy));
 db.queries.length=0;
 const user=await accounts(db,'createEmployeeUser',{name:'Ny medarbejder',email:'hours-app@example.test',site:1,roleId:'employee'},owner,'d'.repeat(64));
 assert.equal(user.status,200,JSON.stringify(user));assert.equal(user.body.createdEmployee.target,37);
 const invite=await accounts(db,'invite',{email:'hours-web@example.test',roleId:'employee',newEmployee:{name:'Ny webmedarbejder',site:0}});
 assert.equal(invite.status,200,JSON.stringify(invite));assert.equal(invite.body.createdEmployee.target,37);
 assert.equal(db.queries.some(({sql})=>/studio_state_chunks|default_weekly_hours/i.test(sql)),false);
 const updated=(await plan(db)).body;
 assert.deepEqual(updated.studio.workspaceSettings,{companyName:'CleanRooms',workHoursBudget});
 const weekly=await save(updated.revision,{...updated.studio,workspaceSettings:{workHoursBudget:{period:'week',hours:0}}});
 assert.equal(weekly.status,200,JSON.stringify(weekly));
 const zero=(await plan(db)).body;
 assert.deepEqual(zero.studio.workspaceSettings.workHoursBudget,{period:'week',hours:0});
 const cleared=await save(zero.revision,{...zero.studio,workspaceSettings:{workHoursBudget:null}});
 assert.equal(cleared.status,200,JSON.stringify(cleared));
 const result=(await plan(db)).body.studio;
 assert.equal(result.workspaceSettings.workHoursBudget,null);
 assert.equal(result.roster.find(person=>person.id===beta).target,30);
 assert.equal(result.roster.find(person=>person.id===user.body.createdEmployee.id).target,37);
});

test('scoped budgets use versioned point writes, preserve omitted limits, and require Settings access',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 const siteBudget={period:'week',hours:0},departmentBudget={period:'month',hours:128.5};
 db.queries=[];
 const saved=await directory(db,{action:'write',changes:[patch('site-nord',1,{workHoursBudget:siteBudget},'site'),patch('dep-nord',1,{workHoursBudget:departmentBudget},'department')]});
 assert.equal(saved.status,200,JSON.stringify(saved));
 assert.ok(saved.body.records.every(item=>item.version===2));
 assert.equal(db.queries.some(({sql})=>/FROM studio_state_chunks|FROM workspace_plan_record_chunks/.test(sql)),false);
 for(const workHoursBudget of [{period:'year',hours:160},{period:'week',hours:-1},{period:'week',hours:'37'},{period:'month',hours:160.111},{period:'week',hours:10,unknown:true}]){
  for(const [kind,id]of [['site','site-nord'],['department','dep-nord']])assert.equal((await directory(db,{action:'write',changes:[patch(id,2,{workHoursBudget},kind)]})).status,400);
 }
 const stale=await directory(db,{action:'write',changes:[patch('site-nord',1,{workHoursBudget:{period:'week',hours:10}},'site')]});
 assert.equal(stale.status,409);
 const delegate={id:'directory-budget-delegate',email:'budget-delegate@example.com'};
 const invite=await accounts(db,'invite',{email:delegate.email,roleId:'planner-departments'});
 assert.equal(invite.status,200,JSON.stringify(invite));
 assert.equal((await accounts(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},delegate)).status,200);
 assert.equal((await directory(db,{action:'write',changes:[patch('site-nord',2,{workHoursBudget:null},'site')]},delegate)).status,403);
 assert.equal((await directory(db,{action:'write',changes:[patch('dep-nord',2,{workHoursBudget:null},'department')]},delegate)).status,403);
 assert.equal((await directory(db,{action:'write',changes:[patch('site-nord',2,{name:'Nord opdateret'},'site')]},delegate)).status,200);
 const previous=(await plan(db,{actor:delegate})).body,legacy=structuredClone(previous.studio);
 legacy.organization.departments[0].name='Nord afdeling';
 legacy.organization.departments[0].workHoursBudget=null;
 const saveLegacy=()=>plan(db,{actor:delegate,method:'PUT',body:{revision:previous.revision,directoryRevision:previous.directory.revision,studio:legacy}});
 assert.equal((await saveLegacy()).status,403);
 delete legacy.organization.sites[0].workHoursBudget;
 delete legacy.organization.departments[0].workHoursBudget;
 assert.equal((await saveLegacy()).status,200);
 const latest=(await plan(db)).body;
 assert.deepEqual(latest.studio.organization.sites[0].workHoursBudget,siteBudget);
 assert.deepEqual(latest.studio.organization.departments[0].workHoursBudget,departmentBudget);
 const catalog=await directory(db,{action:'read',ids:[{kind:'site',id:'site-nord'},{kind:'department',id:'dep-nord'}],catalog:true});
 assert.equal(catalog.status,200,JSON.stringify(catalog));
 const cleared=await directory(db,{action:'write',changes:catalog.body.records.map(({kind,id,version})=>patch(id,version,{workHoursBudget:null},kind))});
 assert.equal(cleared.status,200,JSON.stringify(cleared));
 assert.ok(cleared.body.records.every(item=>item.value.workHoursBudget===null));
});

test('only the workspace administrator can issue an app login and only the gateway can use it',async t=>{
 const {db,loaded}=await setup();t.after(()=>db.sqlite.close());
 await join(db,worker,alpha);
 const create={personId:alpha,email:'mobile-login@example.test'};
 const key='e'.repeat(64);
 assert.equal((await accounts(db,'createAppLogin',create,worker)).status,403);
 const created=await accounts(db,'createAppLogin',create,owner,key);
 assert.equal(created.status,200);
 assert.equal(created.body.temporaryPassword.length,10);
 assert.equal(created.body.account.personId,alpha);
 assert.equal(created.body.account.status,'active');
 assert.equal((await accounts(db,'createAppLogin',create)).status,409);
 const listed=await accounts(db,'list');
 const {canRevealStartCode,...accountSummary}=created.body.account;
 assert.equal(canRevealStartCode,true);
 assert.deepEqual(listed.body.appLogins,[accountSummary]);
 assert.equal(JSON.stringify(listed.body).includes(created.body.temporaryPassword),false);
 assert.equal((await accounts(db,'revealAppStartCode',{personId:alpha,version:1},owner,key)).body.temporaryPassword,created.body.temporaryPassword);
 const make=(body,token,secret)=>new Request('https://directory.example/api/mobile-auth',{method:'POST',headers:{
   'content-type':'application/json',...(secret?{'x-cleanrooms-gateway-key':secret}:{}),...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const login={action:'login',email:create.email,password:created.body.temporaryPassword};
 assert.equal((await handleMobileAuthRequest(make(login),db,key)).status,404);
 const authenticated=await json(await handleMobileAuthRequest(make(login,null,key),db,key));
 assert.equal(authenticated.status,200);
 assert.deepEqual(authenticated.body.employee,{workspaceId:loaded.workspace.id,personId:alpha,email:create.email,name:'Anna Directory'});
 assert.equal(authenticated.body.temporaryPassword,true);
 const me=await json(await handleMobileAuthRequest(make({action:'session'},authenticated.body.token,key),db,key));
 assert.equal(me.status,200);
 assert.deepEqual(Object.keys(me.body).sort(),['employee','expiresAt','temporaryPassword']);
 assert.equal((await handleMobileAuthRequest(make({action:'createAppLogin',personId:beta,email:'other@example.test'},authenticated.body.token,key),db,key)).status,400);
 const revoked=await accounts(db,'revokeAppLogin',{personId:alpha,version:created.body.account.version});
 assert.equal(revoked.status,200);
 assert.deepEqual(revoked.body,{ok:true,version:2});
 assert.equal((await accounts(db,'revealAppStartCode',{personId:alpha,version:1},owner,key)).status,409);
 assert.equal((await handleMobileAuthRequest(make({action:'session'},authenticated.body.token,key),db,key)).status,401);
});

test('creating a new employee issues mobile access atomically and reveals only the current temporary code',async t=>{
 const {db,loaded}=await setup();t.after(()=>db.sqlite.close());
 const key='d'.repeat(64);
 const user={name:'  Ny medarbejder  ',email:'NEW-EMPLOYEE@EXAMPLE.TEST',site:1,roleId:'employee'};
 const create=(payload=user,secret=key)=>accounts(db,'createEmployeeUser',payload,owner,secret);
 const rosterCount=()=>db.sqlite.prepare("SELECT COUNT(*) n FROM workspace_directory_records WHERE kind='employee' AND deleted=0").get().n;
 const initialRoster=rosterCount();
 assert.equal((await create(user,null)).status,503);
 assert.equal((await create({...user,site:99})).status,400);
 assert.equal((await create({...user,roleId:'admin'})).status,400);
 assert.equal(rosterCount(),initialRoster);
 await join(db,worker,alpha);
 assert.equal((await create({...user,email:worker.email})).status,409);
 assert.equal((await accounts(db,'createEmployeeUser',user,worker,key)).status,403);
 db.sqlite.exec(`CREATE TRIGGER reject_test_mobile_credential BEFORE INSERT ON workspace_mobile_credentials
   BEGIN SELECT RAISE(ABORT,'test mobile insert failure'); END`);
 assert.equal((await create()).status,500);
 assert.equal(rosterCount(),initialRoster);
 db.sqlite.exec('DROP TRIGGER reject_test_mobile_credential');

 const attempts=await Promise.all([create(),create()]);
 assert.deepEqual(attempts.map(result=>result.status).sort(),[200,409]);
 const {body}=attempts.find(result=>result.status===200);
 assert.equal(rosterCount(),initialRoster+1);
 const {id:personId}=body.createdEmployee;
 assert.deepEqual(body.account,{personId,email:'new-employee@example.test',temporary:true,status:'active',version:1});
 assert.equal(body.createdEmployee.name,'Ny medarbejder');
 assert.equal(body.createdEmployee.target,37);
 assert.equal(body.records[0].value.id,personId);
 assert.equal(body.temporaryPassword,undefined);
 assert.equal(body.inviteUrl,undefined);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_invites WHERE person_id=?').get(personId).n,0);

 const read=async()=>accounts(db,'readAppLogin',{personId},owner,key);
 const reveal=async(version,actor=owner,secret=key)=>accounts(db,'revealAppStartCode',{personId,version},actor,secret);
 assert.deepEqual((await read()).body,{account:{...body.account,canRevealStartCode:true}});
 assert.equal((await reveal(1,worker)).status,403);
 assert.equal((await reveal(1,owner,'c'.repeat(64))).status,409);
 const revealed=await reveal(1);
 assert.equal(revealed.status,200);
 const {temporaryPassword:code}=revealed.body;
 assert.match(code,/^[A-Za-z0-9_-]{10}$/);
 assert.equal((await reveal(1)).body.temporaryPassword,code);
 const credential=()=>db.sqlite.prepare('SELECT * FROM workspace_mobile_credentials WHERE person_id=?').get(personId);
 assert.match(credential().start_code_ciphertext,/^[A-Za-z0-9_-]{51}$/);
 assert.ok(!JSON.stringify(credential()).includes(code));
 assert.ok(!JSON.stringify(await accounts(db,'list')).includes(code));

 const appRequest=(payload,token)=>new Request('https://directory.example/api/mobile-auth',{method:'POST',
   headers:{'content-type':'application/json','x-cleanrooms-gateway-key':key,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});
 const authenticated=await json(await handleMobileAuthRequest(appRequest({action:'login',email:body.account.email,password:code}),db,key));
 assert.equal(authenticated.status,200);
 assert.deepEqual(authenticated.body.employee,{workspaceId:loaded.workspace.id,personId,email:body.account.email,name:body.createdEmployee.name});
 const newPassword='Egen sikker kode til mobilen';
 assert.equal((await handleMobileAuthRequest(appRequest({action:'changePassword',currentPassword:code,newPassword},authenticated.body.token),db,key)).status,200);
 assert.equal((await read()).body.account.canRevealStartCode,false);
 assert.equal((await reveal(1)).status,409);
 assert.equal((await reveal(2)).status,409);
 assert.equal(credential().start_code_ciphertext,null);
 assert.ok(!JSON.stringify(credential()).includes(newPassword));

 const reset=await accounts(db,'resetAppLogin',{personId,version:2},owner,key);
 assert.equal(reset.status,200);
 assert.equal(reset.body.account.canRevealStartCode,true);
 assert.notEqual(reset.body.temporaryPassword,code);
 assert.equal((await reveal(3)).body.temporaryPassword,reset.body.temporaryPassword);
 assert.equal((await directory(db,{action:'write',changes:[patch(personId,1,{active:false})]})).status,200);
 assert.equal((await read()).body.account.canRevealStartCode,false);
 assert.equal((await reveal(3)).status,409);
 assert.equal(credential().start_code_ciphertext,null);
});

test('missing app access suggests one current email for the active employee in the same workspace',async t=>{
 const {db,value}=await setup();t.after(()=>db.sqlite.close());
 const read=(personId=alpha,actor=owner)=>accounts(db,'readAppLogin',{personId},actor);
 assert.deepEqual((await read()).body,{account:null,suggestedEmail:null});
 const invite=(email,actor=owner)=>accounts(db,'invite',{email,roleId:'employee',personId:alpha},actor);
 await join(db,worker,alpha);
 assert.equal((await Store.writeStudio(db,foreign.id,0,value)).ok,true);
 assert.equal((await plan(db,{actor:foreign})).status,200);
 assert.equal((await invite('foreign-profile@example.test',foreign)).status,200);
 assert.equal((await invite(worker.email)).status,200);
 assert.deepEqual((await read()).body,{account:null,suggestedEmail:worker.email});
 assert.deepEqual((await read(beta)).body,{account:null,suggestedEmail:null});
 assert.equal((await read(alpha,worker)).status,403);
 const conflict=await invite('other-email@example.test');
 assert.equal(conflict.status,200);
 assert.deepEqual((await read()).body,{account:null,suggestedEmail:null});
 db.sqlite.prepare('UPDATE workspace_invites SET expires_at=? WHERE id=?').run(stamp,conflict.body.invite.id);
 assert.deepEqual((await read()).body,{account:null,suggestedEmail:worker.email});
 assert.equal((await directory(db,{action:'write',changes:[patch(alpha,1,{active:false})]})).status,200);
 assert.deepEqual((await read()).body,{account:null,suggestedEmail:null});
});

test('the mobile handoff reads one current site, seals its policy, and enforces Sites membership and tenant scope',async()=>{
 const {db,loaded,value}=await setup();
 const workspaceId=loaded.workspace.id;
 const curve={name:'ECDH',namedCurve:'P-256'},client=await crypto.subtle.generateKey(curve,false,['deriveBits']);
 const state=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const key=Buffer.from(await crypto.subtle.exportKey('raw',client.publicKey)).toString('base64url');
 const search=new URLSearchParams({v:'1',state,key});
 const render=(suffix='',actor=owner)=>{
  const incoming=request('/mobile-gps?'+search+suffix,'GET',undefined,actor);
  return renderMobileGpsHandoff(incoming,{readWorkplaces:(siteId,workspace)=>Workspace.readMobileGpsWorkplaces(incoming,db,siteId,workspace),signInPath:returnTo=>'/signin-with-chatgpt?return_to='+encodeURIComponent(returnTo)});
 };
 const open=async response=>{
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const html=await response.text(),href=html.match(/href="(cleanrooms:\/\/gps-return[^"\n]+)"/)[1];
  const {searchParams}=new URL(href.replaceAll('&amp;','&'));
  assert.deepEqual([...searchParams.keys()],['v','key','iv','data']);
  assert.equal(html.includes(state),false);
  const server=await crypto.subtle.importKey('raw',Buffer.from(searchParams.get('key'),'base64url'),curve,false,[]);
  const secret=await crypto.subtle.deriveBits({name:'ECDH',public:server},client.privateKey,256);
  const digest=await crypto.subtle.digest('SHA-256',secret);
  const aes=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['decrypt']);
  const data=Buffer.from(searchParams.get('data'),'base64url'),iv=Buffer.from(searchParams.get('iv'),'base64url');
  const payload=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},aes,data)));
  assert.equal(payload.v,1);assert.equal(payload.state,state);assert.ok(Math.abs(Date.now()-payload.issuedAt)<10000);
  return {html,site:payload.site,gps:payload.gps};
 };
 try{
  const site=value.organization.sites[0],gps={enabled:true,latitude:55.123456,longitude:12.654321,radiusMeters:180};
  const named='Kontor <Nord> & “team”';
  assert.equal((await directory(db,{action:'write',changes:[patch(site.id,1,{gps,name:named},'site')]})).status,200);
  db.queries=[];
  const picker=await render(),pickerHtml=await picker.text();
  assert.equal(picker.status,200);assert.match(pickerHtml,/Kontor &lt;Nord&gt; &amp;/);
  assert.ok(!pickerHtml.includes('55.123456'));
  assert.ok(db.queries.every(query=>!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(query.sql)));
  assert.ok(db.queries.some(query=>query.sql.includes("json_extract(catalog,'$.name')")));
  const fetched=await open(await render('&site='+site.id));
  assert.deepEqual(fetched.site,{id:site.id,name:named,workspaceId});assert.deepEqual(fetched.gps,gps);
  assert.ok(!fetched.html.includes('55.123456'));
  assert.equal((await directory(db,{action:'write',changes:[patch(site.id,2,{gps:{...gps,enabled:false}},'site')]})).status,200);
  assert.equal((await open(await render('&site='+site.id+'&workspace='+workspaceId))).gps,null);
  await join(db,worker,alpha);
  assert.equal((await render('&site='+site.id,worker)).status,403);
  const signedOut=await render('&site='+site.id+'&workspace='+workspaceId,null);
  assert.equal(signedOut.status,401);assert.match(await signedOut.text(),new RegExp('signin-with-chatgpt\\?return_to=[^\"]+workspace%3D'+workspaceId));
  assert.equal((await render('&v=1')).status,400);
  const other=structuredClone(value);
  other.organization.sites.push({id:'foreign-site',name:'Foreign GPS workplace',address:'Testvej 1',color:Departments.COLORS[0]});
  assert.equal((await Store.writeStudio(db,foreign.id,0,other)).ok,true);
  assert.equal((await plan(db,{actor:foreign})).status,200);
  assert.equal((await render('&site=foreign-site')).status,404);
  assert.equal((await render('&site='+site.id+'&workspace='+workspaceId,foreign)).status,404);
  assert.ok(!(await (await render()).text()).includes('Foreign GPS workplace'));
 }finally{db.sqlite.close();}
});

test('directory point reads and writes keep other profiles cold, preserve unknown fields and do not revise the plan',async()=>{
 const {db,loaded}=await setup();db.queries=[];db.beforeBatch=async statements=>{for(const query of statements)if(query.sql.includes('FROM workspace_directory_chunks'))assert.notEqual(query.values[2],beta,'unrelated employee profile hydrated');};const read=await directory(db,{action:'read',kind:'employee',ids:[alpha]});assert.equal(read.status,200);assert.equal(read.body.records.length,1);assert.ok(read.body.records[0].value.profileNotes.startsWith('OWN_PROFILE_NOTE'));const changed=await directory(db,{action:'write',changes:[patch(alpha,read.body.records[0].version,{name:'Anna Updated'})]});assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(changed.body.records.length,1);assert.ok(changed.body.records[0].value.profileNotes.startsWith('OWN_PROFILE_NOTE'));assert.equal(changed.body.records[0].version,2);assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner.id).revision,loaded.revision);assert.equal(db.sqlite.prepare('SELECT version FROM workspace_directory_records WHERE kind=? AND id=?').get('employee',beta).version,1);assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_plan_record_chunks')||query.sql.includes('FROM workspace_publication_chunks')),false);db.beforeBatch=null;
 const raw=await Store.readRawStudio(db,owner.id);assert.equal(raw.studio.roster,undefined);assert.equal(raw.studio.organization,undefined);const catalog=await directory(db,{action:'read',kind:'employee',catalog:true});assert.equal(catalog.status,200);assert.equal(catalog.body.records.length,2);assert.equal(JSON.stringify(catalog.body).includes('PROFILE'),false);const stale=await directory(db,{action:'write',changes:[patch(alpha,1,{target:20})]});assert.equal(stale.status,409);const independent=await directory(db,{action:'write',changes:[patch(beta,1,{target:32})]});assert.equal(independent.status,200);assert.equal(independent.body.records[0].version,2);db.sqlite.close();
});

test('directory access is tenant and role scoped; an employee can read only their own full profile',async()=>{
 const {db,value}=await setup();await join(db,worker,alpha);assert.equal((await directory(db,{action:'read',kind:'employee',ids:[alpha]},null)).status,401);const own=await directory(db,{action:'read',kind:'employee',ids:[alpha]},worker);assert.equal(own.status,200);assert.equal(own.body.records[0].id,alpha);assert.equal(JSON.stringify(own.body).includes('OTHER_PROFILE_SECRET'),false);for(const body of [{action:'read',kind:'employee',ids:[beta]},{action:'read',kind:'employee',catalog:true},{action:'read',kind:'site'},{action:'write',changes:[patch(alpha,1,{target:1})]}])assert.equal((await directory(db,body,worker)).status,403);
 const other=structuredClone(value);other.roster[0].profileNotes='FOREIGN_PROFILE_SECRET';assert.equal((await Store.writeStudio(db,foreign.id,0,other)).ok,true);const otherContext=(await plan(db,{actor:foreign})).body;const forged=await directory(db,{action:'read',kind:'employee',ids:[alpha],workspaceId:otherContext.workspace.id});assert.equal(forged.status,400);assert.equal(JSON.stringify((await directory(db,{action:'read',kind:'employee',ids:[alpha]})).body).includes('FOREIGN_PROFILE_SECRET'),false);for(const fields of [{id:beta},{payroll:{hourlyRate:1}},{salary:1},{__proto__:null}]){if(!Object.keys(fields).length)continue;assert.equal((await directory(db,{action:'write',changes:[patch(alpha,1,fields)]})).status,400);}db.sqlite.close();
});

test('directory-only changes invalidate calendar continuations and a reviewed publication without advancing plan revision',async()=>{
 const {db}=await setup({count:650}),url='/api/studio?projection=calendar&from='+calendar.from+'&to='+calendar.to,first=await plan(db,{url});assert.equal(first.status,200);assert.equal(first.body.directory.complete,true);assert.ok(first.body.directory.versions[JSON.stringify(['employee',alpha])]);assert.ok(first.body.nextCursor);assert.equal(JSON.stringify(first.body).includes('PROFILE'),false);const oldRevision=first.body.revision,oldDirectory=first.body.directory.revision;assert.equal((await directory(db,{action:'write',changes:[patch(alpha,1,{name:'Fresh label'})]})).status,200);assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner.id).revision,oldRevision);assert.equal((await plan(db,{url:url+'&cursor='+encodeURIComponent(first.body.nextCursor)})).status,409);
 const full=(await plan(db)).body,projection={mode:'publication',...calendar,siteIds:[0],includeDependencies:false,calendar},body={revision:full.revision,directoryRevision:oldDirectory,commandReceipt:'records',projection,publication:{...calendar,siteIds:[0],includeDependencies:false},studio:full.studio,planning:{version:1,changes:[],metadataChanged:false,metadataBase:full.planning.metadataHash,dependencies:{series:[],groups:[]}}},stale=await plan(db,{method:'PUT',body});assert.equal(stale.status,409);assert.equal(stale.body.error,'directory_review_changed');db.sqlite.close();
});

test('archiving preserves bindings and saved history while a concurrent archive prevents a new absence request',async()=>{
 const {db,loaded}=await setup();await join(db,worker,alpha);assert.equal((await plan(db,{actor:worker})).status,200);const header=db.sqlite.prepare('SELECT * FROM studio_states').get();let archived=false;db.beforeBatch=async statements=>{if(!archived&&statements.some(statement=>statement.sql.startsWith('INSERT INTO workspace_absences'))){archived=true;const result=await directory(db,{action:'write',changes:[patch(beta,1,{active:false})]});assert.equal(result.status,200,JSON.stringify(result));}};const denied=await accounts(db,'leaveCreate',{personId:beta,from:'2090-01-10',to:'2090-01-10',type:'Ferie'});db.beforeBatch=null;assert.equal(archived,true);assert.equal(denied.status,409,JSON.stringify(denied));assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_absences WHERE person_id=?').get(beta).n,0);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_activity WHERE kind='leave'").get().n,0);assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states').get().revision,loaded.revision);
 const archiveOwn=await directory(db,{action:'write',changes:[patch(alpha,1,{active:false})]});assert.equal(archiveOwn.status,200);const own=await directory(db,{action:'read',kind:'employee',ids:[alpha]},worker);assert.equal(own.status,200);assert.equal(own.body.records[0].value.active,false);assert.equal((await plan(db,{actor:worker})).status,200);assert.deepEqual(db.sqlite.prepare('SELECT * FROM studio_states').get(),header);db.sqlite.close();
});

test('a recipient archived at request commit cannot acquire a new offer or notification',async()=>{
 const {db}=await setup();await join(db,worker,alpha);await join(db,colleague,beta);const view=await accounts(db,'workflowRead',{},worker);assert.equal(view.status,200);const shift=view.body.ownShifts[0];assert.ok(shift);let archived=false;db.beforeBatch=async statements=>{if(!archived&&statements.some(statement=>statement.sql.startsWith('INSERT INTO workspace_shift_requests'))){archived=true;const result=await directory(db,{action:'write',changes:[patch(beta,1,{active:false})]});assert.equal(result.status,200);}};const denied=await accounts(db,'workflowRequest',{kind:'offer',shiftId:shift.id,fingerprint:shift.fingerprint,toPersonId:beta},worker);db.beforeBatch=null;assert.equal(archived,true);assert.equal(denied.status,409,JSON.stringify(denied));assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_requests').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages').get().n,0);db.sqlite.close();
});

test('reference guards protect durable identities and stable worksite indices independently of supplied catalog data',async()=>{
 const {db,loaded}=await setup(),workspaceId=loaded.workspace.id;assert.equal(await allowed(db,References.employeeReferenceGuard({workspaceId,personIds:[alpha]})),true);assert.equal(await allowed(db,References.employeeReferenceGuard({workspaceId,personIds:['person-missing']})),false);assert.equal(await allowed(db,References.siteIdentityGuard({workspaceId,identities:[{id:'site-nord',index:0}]})),true);assert.equal(await allowed(db,References.siteIdentityGuard({workspaceId,identities:[{id:'site-klinik',index:0}]})),false);assert.equal(await allowed(db,References.siteReferenceGuard({workspaceId,siteIndices:[3]})),false);assert.equal(await allowed(db,References.employeeRemovalGuard({workspaceId,personIds:[alpha]})),false);assert.equal(await allowed(db,References.employeeRemovalGuard({workspaceId,personIds:[beta]})),true);
 const created=await directory(db,{action:'write',changes:[{kind:'site',id:'site-added',expectedVersion:0,siteIndex:3,patch:{name:'New worksite',address:'New address',color:Departments.COLORS[0]}},{kind:'department',id:'dep-added',expectedVersion:0,patch:{name:'New branch',kind:'branch',siteIds:[3]}}]});assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.body.directory.nextSiteIndex,4);assert.equal(db.sqlite.prepare("SELECT site_index FROM workspace_directory_records WHERE kind='site' AND id='site-added'").get().site_index,3);const reindex=await directory(db,{action:'write',changes:[{kind:'site',id:'site-added',expectedVersion:1,siteIndex:0,patch:{name:'Moved'}}]});assert.equal(reindex.status,400);const frozen=Publication.publishedShifts((await plan(db)).body.studio);assert.equal(frozen[0].site,0);db.sqlite.close();
});

test('a directory change at publication commit fences every plan, publication and notification effect',async()=>{
 const {db,loaded}=await setup();await Store.readStudioWindow(db,owner.id,calendar);const before=db.sqlite.prepare('SELECT * FROM studio_states').get(),projection={mode:'publication',...calendar,siteIds:[0],includeDependencies:false,calendar},body={revision:loaded.revision,directoryRevision:loaded.directory.revision,commandReceipt:'records',projection,publication:{...calendar,siteIds:[0],includeDependencies:false},studio:loaded.studio,planning:{version:1,changes:[],metadataChanged:false,metadataBase:loaded.planning.metadataHash,dependencies:{series:[],groups:[]}}};let changed=false;
 db.beforeBatch=async statements=>{if(!changed&&statements.some(statement=>statement.sql.includes('UPDATE studio_states SET revision'))){changed=true;assert.equal((await directory(db,{action:'write',changes:[patch(beta,1,{target:31})]})).status,200);}};
 const denied=await plan(db,{method:'PUT',body});db.beforeBatch=null;assert.equal(changed,true);assert.equal(denied.status,409,JSON.stringify(denied));assert.deepEqual(db.sqlite.prepare('SELECT * FROM studio_states').get(),before);assert.equal(db.sqlite.prepare('SELECT sequence FROM workspace_publication_state').get().sequence,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_shift_messages').get().n,0);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_activity WHERE kind='publication'").get().n,0);assert.equal(db.sqlite.prepare("SELECT version FROM workspace_directory_records WHERE kind='employee' AND id=?").get(beta).version,2);db.sqlite.close();
});

test('legacy full directory edits need their observed revision and never reinsert directory copies into plan metadata',async()=>{
 const {db,loaded}=await setup(),next=structuredClone(loaded.studio);next.roster[0].name='Legacy changed';delete next.directoryRevision;const denied=await plan(db,{method:'PUT',body:{revision:loaded.revision,studio:next}});assert.equal(denied.status,409);assert.equal(denied.body.error,'directory_reload_required');assert.equal(db.sqlite.prepare("SELECT version FROM workspace_directory_records WHERE kind='employee' AND id=?").get(alpha).version,1);
 const accepted=await plan(db,{method:'PUT',body:{revision:loaded.revision,directoryRevision:loaded.directory.revision,studio:next}});assert.equal(accepted.status,200,JSON.stringify(accepted));const current=(await plan(db)).body;assert.equal(current.studio.roster[0].name,'Legacy changed');assert.ok(current.studio.roster[0].profileNotes.startsWith('OWN_PROFILE_NOTE'));const raw=await Store.readRawStudio(db,owner.id);for(const field of ['roster','organization','directoryRevision','directory'])assert.equal(Object.hasOwn(raw.studio,field),false,field);db.sqlite.close();
});

test('workplace GPS is versioned and administrator-only while delegated workplace edits retain it',async t=>{
 const {db,loaded}=await setup();t.after(()=>db.sqlite.close());
 const DirectoryStore=require('../lib/directory-store.mjs'),workspaceId=loaded.workspace.id,siteId='site-nord';
 const gps={enabled:true,latitude:56.1629,longitude:10.2039,radiusMeters:150};
 const write=(expectedVersion,fields,actor=owner)=>directory(db,{action:'write',changes:[patch(siteId,expectedVersion,fields,'site')]},actor);
 const readSite=siteIndex=>DirectoryStore.readDirectorySite({db,workspaceId,siteIndex});
 assert.equal(loaded.capabilities.manageSiteGps,true);
 assert.equal((await readSite(0)).gps,undefined);
 assert.equal(await readSite(1999),null);
 assert.equal((await write(1,{gps:{...gps,radiusMeters:0}})).status,400);
 assert.equal((await write(1,{gps:{...gps,latitude:null}})).status,400);
 const enabled=await write(1,{gps});
 assert.equal(enabled.status,200,JSON.stringify(enabled));
 assert.equal(enabled.body.records[0].version,2);
 assert.deepEqual((await readSite(0)).gps,gps);
 assert.equal((await write(1,{gps:{...gps,radiusMeters:200}})).status,409);
 assert.equal((await readSite(1)).gps,undefined);

 const delegate={id:'directory-department-delegate',email:'delegate@example.com'};
 const invite=await accounts(db,'invite',{email:delegate.email,roleId:'planner-departments'});
 assert.equal(invite.status,200,JSON.stringify(invite));
 assert.equal((await accounts(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},delegate)).status,200);
 const view=(await plan(db,{actor:delegate})).body;
 assert.equal(view.capabilities.manageDepartments,true);
 assert.equal(view.capabilities.manageSiteGps,false);
 const forged=await write(2,{gps:{...gps,enabled:false}},delegate);
 assert.equal(forged.status,403);
 assert.equal(forged.body.error,'site_gps_forbidden');
 assert.equal((await write(2,{name:'Kontor Nord 2'},delegate)).status,200);
 const previous=(await plan(db,{actor:delegate})).body;
 const legacy=structuredClone(previous.studio);
 legacy.organization.sites[0].address='Ny adresse';
 legacy.organization.sites[0].gps=null;
 const legacyWrite=()=>plan(db,{actor:delegate,method:'PUT',body:{revision:previous.revision,directoryRevision:previous.directory.revision,studio:legacy}});
 const rejected=await legacyWrite();
 assert.equal(rejected.status,403);
 assert.equal(rejected.body.error,'site_gps_forbidden');
 delete legacy.organization.sites[0].gps;
 const changed=await legacyWrite();
 assert.equal(changed.status,200,JSON.stringify(changed));
 assert.deepEqual((await readSite(0)).gps,gps);

 const disabled=await write(4,{gps:{...gps,enabled:false}});
 assert.equal(disabled.status,200,JSON.stringify(disabled));
 assert.deepEqual((await readSite(0)).gps,{...gps,enabled:false});
 const catalog=await directory(db,{action:'read',kind:'site',ids:[siteId],catalog:true});
 assert.deepEqual(catalog.body.records[0].value.gps,{...gps,enabled:false});
});

test('live workplace GPS and budgets do not become a published location or require republishing a week',async t=>{
 const {db,loaded}=await setup();t.after(()=>db.sqlite.close());
 const scope={...calendar,siteIds:[0]},gps={enabled:true,latitude:56.1629,longitude:10.2039,radiusMeters:150},workHoursBudget={period:'week',hours:100};
 const saved=await directory(db,{action:'write',changes:[patch('site-nord',1,{gps,workHoursBudget},'site')]});
 assert.equal(saved.status,200,JSON.stringify(saved));
 const {studio}= (await plan(db)).body;
 assert.deepEqual(studio.organization.sites[0].gps,gps);
 assert.deepEqual(studio.organization.sites[0].workHoursBudget,workHoursBudget);
 assert.equal(Publication.scopeStatus(studio,scope).published,true);
 const published=Publication.publish(studio,{...scope,actor:{userId:owner.id,name:'Owner'},at:stamp}).studio;
 assert.equal(Object.hasOwn(Object.values(published.publications.slots)[0].location,'gps'),false);
 assert.equal(Object.hasOwn(Publication.publishedSites(published,alpha)[0],'gps'),false);
 assert.equal(Object.hasOwn(Object.values(published.publications.slots)[0].location,'workHoursBudget'),false);
 assert.equal(Object.hasOwn(Publication.publishedSites(published,alpha)[0],'workHoursBudget'),false);
 await join(db,worker,alpha);
 const employee=await accounts(db,'employeeShift',{shiftId:'directory-own'},worker);
 assert.equal(employee.status,200,JSON.stringify(employee));
 assert.equal(Object.hasOwn(employee.body.site,'gps'),false);
 assert.equal(Object.hasOwn(employee.body.shift.location,'gps'),false);
 assert.equal(Object.hasOwn(employee.body.site,'workHoursBudget'),false);
 assert.equal(Object.hasOwn(employee.body.shift.location,'workHoursBudget'),false);
 assert.equal((await plan(db)).body.revision,loaded.revision);
});

test('GPS address lookup is administrator-only and saves the canonical address with the WGS84 position',async t=>{
 const {db,loaded}=await setup();t.after(()=>db.sqlite.close());
 await join(db,worker,alpha);
 const id='0a3f5082-2849-32b8-e044-0003ba298018',title='Duehusvej 11, 4632 Bjæverskov',address=title+', Danmark';
 const lookup=payload=>accounts(db,'siteAddressLookup',payload);
 const fetch=t.mock.method(globalThis,'fetch',async (url,options)=>{
  assert.equal(url.origin,'https://adressevaelger.dk');
  assert.equal(url.searchParams.get('token'),'adressevaelger123');
  assert.equal(options.redirect,'manual');
  if(url.pathname==='/husnumre/soeg'){
   if(url.searchParams.get('tekst')==='Ingen match 404')return Response.json({status:'ok',fund:[]});
   if(url.searchParams.get('tekst')==='Tjenesten utilgængelig')return Response.json({}, {status:503});
   assert.equal(url.searchParams.get('tekst'),title);
   return Response.json({status:'ok',fund:[{id,type:'husnummer',titel:title},{id,type:'vejnavn',titel:'Duehusvej'}]});
  }
  assert.equal(url.pathname,'/husnumre/'+id);
  return Response.json({status:'ok',husnummer:{id_lokalid:id,adgangsadressebetegnelse:title,adgangspunkt:{geometri:{
   type:'Point',crs:{properties:{name:'EPSG:25832'}},coordinates:[692318.51,6150243.65]
  }}}});
 });
 assert.equal((await accounts(db,'siteAddressLookup',{query:title},worker)).status,403);
 assert.equal((await lookup({id:'../../other'})).status,400);
 assert.equal(fetch.mock.callCount(),0);
 assert.deepEqual((await lookup({query:address})).body,{suggestions:[{id,address}]});
 assert.deepEqual((await lookup({query:'Ingen match 404'})).body,{suggestions:[]});
 assert.equal((await lookup({query:'Tjenesten utilgængelig'})).body.error,'address_lookup_unavailable');
 const resolved=await lookup({id});
 assert.equal(resolved.status,200,JSON.stringify(resolved));
 assert.equal(resolved.body.address,address);
 assert.ok(Math.abs(resolved.body.latitude-55.460494)<1e-6);
 assert.ok(Math.abs(resolved.body.longitude-12.041896)<1e-6);
 const gps={...resolved.body,enabled:true,radiusMeters:125};
 const save=await directory(db,{action:'write',changes:[patch('site-nord',1,{address,gps},'site')]});
 assert.equal(save.status,200,JSON.stringify(save));
 const {readDirectorySite}=require('../lib/directory-store.mjs');
 const site=await readDirectorySite({db,workspaceId:loaded.workspace.id,siteIndex:0});
 assert.equal(site.address,address);
 assert.deepEqual(site.gps,gps);
});
