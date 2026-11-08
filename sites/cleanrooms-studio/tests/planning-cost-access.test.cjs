const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js');
const owner={id:'cost-owner',email:'cost-owner@example.com'},week={from:'2026-10-26',to:'2026-11-01'};
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));
 const db={sqlite,queries:[],beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
 db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{assert.ok(values.length<=100);const query=sqlite.prepare(sql),result=query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};db.queries.push({sql,values,returned:result.results});return result;});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 return db;
}
const request=(body,actor=owner)=>new Request('https://cost.example/api/accounts',{method:'POST',headers:{origin:'https://cost.example','content-type':'application/json','oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email},body:JSON.stringify(body)});
async function action(db,name,payload={},actor=owner){const response=await Workspace.handleAccountsRequest(request({action:name,...payload},actor),db);return {status:response.status,body:await response.json()};}
const read=(db,payload=week,actor=owner)=>action(db,'planningCostRead',payload,actor);
const shift=(id,date,patch={})=>({id,date,person:'p0',site:0,start:'07:00',end:'09:00',note:'',...patch});
const agreement=id=>({currency:'DKK',agreements:[{id,from:'2026-01-01',type:'hourly',amountCents:18000}],supplements:[]});
async function setup({db=database(),actor=owner,cold=false}={}){
 const roster=Array.from({length:80},(_,index)=>({id:'p'+index,name:'Medarbejder '+index,initials:'M',site:0,target:37,role:'Service',active:true,...(index===79?{privateMemo:'PRIVATE_PERSON'.repeat(20000)}:{})}));
 const organization=Departments.defaultOrganization();organization.privateMemo='PRIVATE_ORGANIZATION'.repeat(10000);
 const source={storageVersion:1,demoSeed:false,roster,organization,series:[{id:'own',person:'p0',site:0,startDate:week.from,endDate:week.to,weekdays:[0,2,4],start:'07:00',end:'15:00',plannedBreakMinutes:30,note:'Relevant description'},
 {id:'far',person:'p0',site:0,startDate:'2028-01-03',endDate:'2028-01-09',weekdays:[0],start:'07:00',end:'15:00',note:'PRIVATE_DRAFT'.repeat(40000)}],edits:{'own@2026-10-26':shift('own@2026-10-26','2026-11-02',{seriesId:'own'}),'far@2028-01-03':shift('far@2028-01-03','2026-10-29',{seriesId:'far'}),site:shift('site','2026-10-27',{site:1}),open:shift('open','2026-10-28',{person:'',site:1}),missing:shift('missing','2026-10-30',{person:'p1',site:2})},deleted:['own@2026-10-28'],weekPlans:{},coverageRules:[],requests:{},checklistProgress:{}};
 const saved=await Store.writeStudio(db,actor.id,0,source);assert.equal(saved.ok,true);
 const bootstrap=await action(db,'timeRead',week,actor);assert.equal(bootstrap.status,200,JSON.stringify(bootstrap));
 const workspaceId=db.sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(actor.id).id;
 for(const [id,key]of [['p0','known-rate'],['p79','PRIVATE_PAYROLL']])db.sqlite.prepare('INSERT INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspaceId,id,JSON.stringify(agreement(key)),1,actor.id,'2026-10-25T00:00:00.000Z','pay-'+id);
 if(cold){db.sqlite.prepare('DELETE FROM workspace_plan_window_imports WHERE workspace_id=?').run(workspaceId);}
 db.queries=[];return {db,workspaceId,source};
}
async function join(db,actor,roleId,personId){const invited=await action(db,'invite',{email:actor.email,roleId,...(personId?{personId}:{})});assert.equal(invited.status,200,JSON.stringify(invited));const accepted=await action(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},actor);assert.equal(accepted.status,200,JSON.stringify(accepted));}
async function delegate(db,id,permissions){const result=await action(db,'createRole',{name:id,permissions});assert.equal(result.status,200,JSON.stringify(result));const actor={id,email:id+'@example.com'};await join(db,actor,result.body.role.id);return {actor,role:result.body.role};}

test('planned wage reads only relevant compact schedules, identities and salary rows and reflects moved/deleted exceptions',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());const result=await read(db);
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.calculation,'shift-based-gross');
 const cost=result.body.weeks[0];assert.equal(cost.baseCents,207000);assert.equal(cost.totalCents,207000);assert.equal(cost.openShiftCount,1);assert.equal(cost.missingShiftCount,1);assert.equal(cost.shiftCount,5);assert.equal(cost.people.length,2);assert.equal(cost.complete,false);
 const body=JSON.stringify(result.body);for(const marker of ['known-rate','amountCents','agreements','payroll','note','PRIVATE_'])assert.equal(body.includes(marker),false,marker);
 const returned=JSON.stringify(db.queries.map(query=>query.returned));for(const marker of ['PRIVATE_PERSON','PRIVATE_ORGANIZATION','PRIVATE_DRAFT','PRIVATE_PAYROLL'])assert.equal(returned.includes(marker),false,marker);
 assert.equal(db.queries.some(query=>/FROM studio_state_chunks|FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);
});
test('site and department scopes resolve durable workplace membership with no client-supplied filter authority',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 for(const kind of ['site','department']){
  const scope={kind,id:kind==='site'?'site-nord':'dep-nord'},response=await read(db,{...week,scope});assert.equal(response.status,200,JSON.stringify(response));
  assert.deepEqual(response.body.scope,scope);assert.equal(response.body.weeks[0].totalCents,171000);assert.equal(response.body.weeks[0].shiftCount,2);assert.equal(response.body.weeks[0].complete,true);
 }
 assert.equal((await read(db,{...week,scope:{kind:'site',id:'loc-missing'}})).status,404);
 assert.equal((await read(db,{...week,scope:{kind:'site',id:'site-nord',siteIds:[1]}})).status,400);
 assert.equal((await read(db,{...week,scope:{kind:'company',id:'anything'}})).status,400);
});
test('wage estimates require both planning and payroll visibility and isolate other tenants',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 const planner=await delegate(db,'cost-no-pay',['plan']),viewer=await delegate(db,'cost-viewer',['plan','payroll.view']);
 const denied=await read(db,week,planner.actor);assert.equal(denied.status,403);assert.equal(denied.body.weeks,undefined);assert.equal((await read(db,week,viewer.actor)).status,200);
 const employee={id:'cost-employee',email:'cost-employee@example.com'};await join(db,employee,'employee','p0');assert.equal((await read(db,{...week,role:'admin',viewPayroll:true},employee)).status,403);
 const other={id:'other-cost-owner',email:'other-cost-owner@example.com'};await setup({db,actor:other});db.sqlite.prepare('DELETE FROM workspace_payroll WHERE workspace_id=(SELECT id FROM workspaces WHERE owner_user_id=?)').run(other.id);
 const isolated=await read(db,{...week,workspaceId:'forged',ownerId:owner.id},other);assert.equal(isolated.status,200);assert.equal(isolated.body.weeks[0].totalCents,0);assert.equal(isolated.body.weeks[0].missingShiftCount,4);
});
test('period boundaries and caps are explicit and a cold projection repairs before calculating',async t=>{
 const {db}=await setup({cold:true});t.after(()=>db.sqlite.close());assert.equal((await read(db)).status,200);
 for(const payload of [{from:'2026-10-27',to:week.to},{from:week.from,to:'2026-10-31'},{from:week.from,to:'2026-12-27'},{from:'2100-12-27',to:'2101-01-02'}])assert.equal((await read(db,payload)).status,400,JSON.stringify(payload));
 const eight=await read(db,{from:week.from,to:'2026-12-20'});assert.equal(eight.status,200,JSON.stringify(eight));assert.equal(eight.body.weeks.length,8);
});
test('plan, directory, payroll and live permission changes reject mixed or revoked wage reads',async t=>{
 for(const race of ['plan','directory','rates','policy','permission'])await t.test(race,async()=>{
  const {db,workspaceId}=await setup();try{
   const viewer=await delegate(db,'cost-racing',['plan','payroll.view']);let changed=false;
   db.beforeBatch=statements=>{
    const trigger=race==='rates'||race==='policy'?statements.some(query=>query.sql.includes('THEN 1 ELSE 0 END AS current')):statements.some(query=>query.sql.includes('record.schedule_config,record.schedule_version'));
    if(changed||!trigger)return;changed=true;
    if(race==='plan')db.sqlite.prepare('UPDATE studio_states SET revision=revision+1 WHERE owner_id=?').run(owner.id);
    if(race==='directory')db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1 WHERE workspace_id=?').run(workspaceId);
    if(race==='rates')db.sqlite.prepare('UPDATE workspace_payroll SET version=version+1 WHERE workspace_id=? AND person_id=?').run(workspaceId,'p0');
    if(race==='policy')db.sqlite.prepare('INSERT INTO workspace_payroll_policies (workspace_id,config,version,history,updated_by,updated_at,write_token) VALUES (?,?,?,?,?,?,?)').run(workspaceId,JSON.stringify({schema:1,groups:[],links:[]}),1,'[]',owner.id,'2026-10-25T00:00:00.000Z','policy-new');
    if(race==='permission')db.sqlite.prepare('UPDATE workspace_roles SET permissions=? WHERE workspace_id=? AND id=?').run(JSON.stringify(['plan']),workspaceId,viewer.role.id);
   };
   const result=await read(db,week,viewer.actor);assert.equal(changed,true);assert.equal(result.status,race==='permission'?403:409,JSON.stringify(result));assert.equal(result.body.weeks,undefined);
  }finally{db.sqlite.close();}
 });
});
