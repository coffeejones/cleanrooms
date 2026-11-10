const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Data=require('../src/studio-data.js'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js'),Series=require('../src/series-engine.js');
const owner={id:'scoped-time-owner',email:'owner@example.com'},worker={id:'scoped-time-worker',email:'worker@example.com'},person='person-scope-0',week={from:'2026-10-26',to:'2026-11-01'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));const db={sqlite,queries:[],beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{assert.ok(values.length<=100);assert.ok(values.every(value=>typeof value!=='string'||Buffer.byteLength(value)<=2*1024*1024));const query=sqlite.prepare(sql),output=query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};db.queries.push({sql,values,returned:output.results});return output;});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const request=(path,body,actor=owner)=>new Request('https://scope.example'+path,{method:'POST',headers:{origin:'https://scope.example','content-type':'application/json','oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email},body:JSON.stringify(body)});
async function action(db,action,payload={},actor=owner){const response=await Workspace.handleAccountsRequest(request('/api/accounts',{action,...payload},actor),db);return {status:response.status,body:await response.json()};}
async function directory(db,changes){const response=await Workspace.handleDirectoryRequest(request('/api/directory',{action:'write',changes}),db);return {status:response.status,body:await response.json()};}
const shift=(id,date,patch={})=>({id,person,site:0,date,start:'07:00',end:'15:00',note:'Relevant published instructions',...patch});
const baseSeries=(id,patch={})=>({id,person,site:0,startDate:week.from,endDate:week.to,weekdays:[0,2,4],start:'07:00',end:'15:00',plannedBreakMinutes:30,note:'Relevant draft instruction',...patch});
async function setup({cold=false,budget}={}){const db=database(),organization=Departments.defaultOrganization();organization.internalMemo='PRIVATE_ORGANIZATION'.repeat(20000);const roster=Array.from({length:600},(_,index)=>({id:'person-scope-'+index,name:'Person '+index,initials:'P',target:37,site:0,role:'Service',active:true,...(index===599?{privateMemo:'PRIVATE_PROFILE'.repeat(30000)}:{})}));let source={storageVersion:1,demoSeed:false,roster,organization,series:[baseSeries('own'),baseSeries('peer',{person:'person-scope-1',weekdays:[1],start:'09:00',end:'12:00',plannedBreakMinutes:0}),baseSeries('far',{person:'person-scope-2',startDate:'2028-01-03',endDate:'2028-01-09',note:'PRIVATE_DRAFT'.repeat(60000)})],edits:{outside:shift('outside','2028-01-04',{person:'person-scope-599',note:'PRIVATE_PUBLISHED'.repeat(50000)})},deleted:[],weekPlans:{},coverageRules:[],requests:{},checklistProgress:{}};source=Publication.publish(source,{...week,siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-10-25T00:00:00.000Z'}).studio;source=Publication.publish(source,{from:'2028-01-03',to:'2028-01-09',siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-10-25T00:00:00.000Z'}).studio;source.series[0].start='08:00';source.series[0].end='16:00';source.edits['own@2026-10-26']=shift('own@2026-10-26','2026-11-02',{seriesId:'own'});source.deleted.push('own@2026-10-28');source.edits.manual=shift('manual','2026-10-27',{start:'09:00',end:'12:00',plannedBreakMinutes:15});source.edits['far@2028-01-03']=shift('far@2028-01-03','2026-10-29',{seriesId:'far',start:'06:00',end:'08:00'});if(budget)source.workspaceSettings={workHoursBudget:budget};await Store.writeStudio(db,owner.id,0,source);if(cold)return {db,source};const first=await action(db,'timeRead',week);assert.equal(first.status,200,JSON.stringify(first));const workspaceId=db.sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner.id).id;return {db,source,workspaceId};}
const correct=(db,id='own@2026-10-26')=>action(db,'timeWrite',{operation:'correct',shiftId:id,version:0,start:'07:00',end:'15:00',breakMinutes:30,reason:'Forgot clock'});
const markers=['PRIVATE_ORGANIZATION','PRIVATE_PROFILE','PRIVATE_DRAFT','PRIVATE_PUBLISHED'];

test('warm Timer reads only period schedules and scheduled identities, and draft totals equal the original plan including exceptions',async()=>{
 const {db,source}=await setup();db.queries=[];const result=await action(db,'timeRead',week);assert.equal(result.status,200,JSON.stringify(result));const expected=new Map();for(const shift of Data.shiftsInRange(week.from,week.to,source))if(shift.person)expected.set(shift.person,(expected.get(shift.person)||0)+Series.plannedMinutes(shift));assert.deepEqual(result.body.plannedRows.sort((a,b)=>a.personId.localeCompare(b.personId)),[...expected].map(([personId,plannedMinutes])=>({personId,plannedMinutes})).sort((a,b)=>a.personId.localeCompare(b.personId)));assert.equal(result.body.shifts.find(shift=>shift.id==='own@2026-10-26').plannedBreakMinutes,30);assert.ok(result.body.shifts.every(shift=>shift.note===undefined&&shift.noteRich===undefined));
 const returned=JSON.stringify(db.queries.map(query=>query.returned));for(const marker of markers)assert.equal(returned.includes(marker),false,marker);assert.equal(db.queries.some(query=>/FROM studio_state_chunks|FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);assert.equal(returned.includes('Person 599'),false,'Zero-hour people remain in the client catalog; the server fetches only relevant identities.');assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_directory_records WHERE workspace_id=')&&query.sql.includes('ORDER BY kind,position,id')),false);db.sqlite.close();
});

test('a person-filtered read excludes peer schedule templates and personal salary rows while wages stay correct',async()=>{
 const {db,workspaceId}=await setup(),entry=await correct(db);assert.equal(entry.status,200,JSON.stringify(entry));const config=(id,amount)=>({currency:'DKK',agreements:[{id,from:'2026-01-01',type:'hourly',amountCents:amount}],supplements:[]});for(const [id,label,amount]of [[person,'own-rate',18000],['person-scope-599','PRIVATE_WAGE',99000]])db.sqlite.prepare('INSERT INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspaceId,id,JSON.stringify(config(label,amount)),1,owner.id,'2026-10-25T00:00:00.000Z','pay-'+id);db.queries=[];const result=await action(db,'timeRead',{...week,personId:person});assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.body.entries.every(entry=>entry.personId===person));assert.ok(result.body.shifts.every(shift=>shift.person===person));assert.ok(result.body.plannedRows.every(row=>row.personId===person));assert.equal(result.body.entries[0].payroll.totalCents,135000);const returned=JSON.stringify(db.queries.map(query=>query.returned));assert.equal(returned.includes('PRIVATE_WAGE'),false);const scheduleValues=db.queries.filter(query=>query.sql.includes('record.schedule_config')).flatMap(query=>query.returned);assert.ok(scheduleValues.every(row=>row.id!=='peer'),'The source of a moved-in exception is related; an ordinary peer template is not.');db.sqlite.close();
});

test('warm summary repair never hydrates an unrelated dirty future instruction',async()=>{
 const {db}=await setup();db.sqlite.prepare("UPDATE workspace_plan_records SET schedule_version=0,schedule_config='' WHERE id=?").run('far');db.queries=[];const result=await action(db,'timeRead',{from:'2026-12-07',to:'2026-12-13'});assert.equal(result.status,200,JSON.stringify(result));assert.equal(db.sqlite.prepare('SELECT schedule_version FROM workspace_plan_records WHERE id=?').get('far').schedule_version,0);assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_plan_record_chunks')),false);assert.deepEqual(result.body.plannedRows,[]);db.sqlite.close();
});

test('time writes resolve an exact out-of-period shift and return a compact causal receipt',async()=>{
 const {db}=await setup();db.queries=[];const result=await correct(db);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.entry.date,'2026-10-26');assert.equal(result.body.entries,undefined);assert.equal(result.body.shifts,undefined);assert.equal(result.body.plannedRows,undefined);assert.ok(Number.isSafeInteger(result.body.planRevision));assert.ok(Number.isSafeInteger(result.body.directoryRevision));assert.ok(Number.isSafeInteger(result.body.ledgerVersion));const returned=JSON.stringify(db.queries.map(query=>query.returned));for(const marker of markers)assert.equal(returned.includes(marker),false,marker);assert.equal(db.queries.some(query=>/FROM studio_state_chunks|FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);db.sqlite.close();
});

test('a directory archive between lookup and commit cannot create a time entry; already archived historical assignments retain prior policy',async()=>{
 const {db}=await setup();let archived=false;db.beforeBatch=async statements=>{if(!archived&&statements.some(query=>query.sql.startsWith('INSERT INTO workspace_time_entries'))){archived=true;db.beforeBatch=null;const result=await directory(db,[{kind:'employee',id:person,expectedVersion:1,patch:{active:false}}]);assert.equal(result.status,200,JSON.stringify(result));}};const rejected=await correct(db);assert.equal(archived,true);assert.equal(rejected.status,409);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,0);const historical=await correct(db);assert.equal(historical.status,200,'The existing rule permits registering published historical work for an archived identity.');db.sqlite.close();
});

test('plan or directory changes during a read return no mixed-generation attendance payload',async()=>{
 for(const kind of ['plan','directory']){const {db,workspaceId}=await setup();await correct(db);let changed=false;db.beforeBatch=statements=>{if(!changed&&statements.some(query=>query.sql.includes('AS has_overlap'))){changed=true;db.beforeBatch=null;if(kind==='plan')db.sqlite.prepare('UPDATE studio_states SET revision=revision+1 WHERE owner_id=?').run(owner.id);else db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1 WHERE workspace_id=?').run(workspaceId);}};const result=await action(db,'timeRead',week);assert.equal(changed,true);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.body.entries,undefined);assert.equal(result.body.shifts,undefined);db.sqlite.close();}
});

test('an employee read contains only their attendance and never opens payroll or draft instruction stores',async()=>{
 const {db}=await setup();await correct(db);const invite=await action(db,'invite',{email:worker.email,roleId:'employee',personId:person});assert.equal(invite.status,200);assert.equal((await action(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},worker)).status,200);db.queries=[];const result=await action(db,'timeRead',week,worker);assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.body.entries.every(entry=>entry.personId===person&&entry.payroll===undefined));assert.ok(result.body.shifts.every(shift=>shift.person===person));assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_payroll ')),false);assert.equal(db.queries.some(query=>query.sql.includes('record.schedule_config')),false);assert.equal(result.body.plannedRows,undefined);assert.equal((await action(db,'timeRead',{...week,personId:'person-scope-1'},worker)).status,403);db.sqlite.close();
});

test('an older worker changing the snapshot invalidates the derived demo flag and repairs it once at the observed revision',async()=>{
 const {db}=await setup(),demoPerson=Data.staff.find(person=>person.id==='p1'),created=await directory(db,[{kind:'employee',id:demoPerson.id,expectedVersion:0,patch:{...demoPerson,id:undefined}}]);assert.equal(created.status,200,JSON.stringify(created));
 const saved=await Store.readStudio(db,owner.id);saved.studio.demoSeed=true;assert.equal((await Store.writeStudio(db,owner.id,saved.revision,saved.studio)).ok,true);const emptyWeek={from:'2026-12-07',to:'2026-12-13'},seeded=await action(db,'timeRead',emptyWeek);assert.equal(seeded.status,200);assert.ok(seeded.body.plannedRows.some(row=>row.personId==='p1'&&row.plannedMinutes>0));
 // Simulate a rolling previous worker: it knows only the old snapshot columns.
 const raw=await Store.readRawStudio(db,owner.id);raw.studio.demoSeed=false;const next=raw.revision+1,token='old-worker-token',parts=Store.splitSnapshot(JSON.stringify(raw.studio));db.sqlite.exec('BEGIN IMMEDIATE');db.sqlite.prepare('UPDATE studio_states SET revision=?,write_token=?,chunk_count=?,byte_length=? WHERE owner_id=?').run(next,token,parts.chunks.length,parts.byteLength,owner.id);db.sqlite.prepare('DELETE FROM studio_state_chunks WHERE owner_id=?').run(owner.id);for(let index=0;index<parts.chunks.length;index++)db.sqlite.prepare('INSERT INTO studio_state_chunks VALUES (?,?,?,?)').run(owner.id,next,index,parts.chunks[index]);db.sqlite.exec('COMMIT');
 const stale=db.sqlite.prepare('SELECT revision,demo_seed,demo_seed_revision FROM studio_states WHERE owner_id=?').get(owner.id);assert.equal(stale.demo_seed,1);assert.notEqual(stale.demo_seed_revision,stale.revision);db.queries=[];const repaired=await action(db,'timeRead',emptyWeek);assert.equal(repaired.status,200,JSON.stringify(repaired));assert.deepEqual(repaired.body.plannedRows,[]);assert.ok(db.queries.some(query=>query.sql.includes('FROM studio_state_chunks')));const head=db.sqlite.prepare('SELECT revision,demo_seed,demo_seed_revision FROM studio_states WHERE owner_id=?').get(owner.id);assert.equal(head.demo_seed,0);assert.equal(head.demo_seed_revision,head.revision);db.queries=[];assert.equal((await action(db,'timeRead',emptyWeek)).status,200);assert.equal(db.queries.some(query=>query.sql.includes('FROM studio_state_chunks')),false);db.sqlite.close();
});

test('a cold index repair refreshes the raw source token before deriving the attendance demo flag',async()=>{
 const {db,workspaceId}=await setup();try{
  const before=db.sqlite.prepare('SELECT revision,write_token FROM studio_states WHERE owner_id=?').get(owner.id);
  db.sqlite.prepare('DELETE FROM workspace_plan_window_imports WHERE workspace_id=?').run(workspaceId);
  db.sqlite.prepare('UPDATE studio_states SET demo_seed_revision=NULL WHERE owner_id=?').run(owner.id);
  const result=await action(db,'timeRead',week);assert.equal(result.status,200,JSON.stringify(result));
  const after=db.sqlite.prepare('SELECT revision,write_token,demo_seed,demo_seed_revision FROM studio_states WHERE owner_id=?').get(owner.id);
  assert.equal(after.revision,before.revision);assert.notEqual(after.write_token,before.write_token);
  assert.equal(after.demo_seed,0);assert.equal(after.demo_seed_revision,after.revision);
  db.queries=[];assert.equal((await action(db,'timeRead',week)).status,200);
  assert.equal(db.queries.some(query=>query.sql.includes('FROM studio_state_chunks')),false);
 }finally{db.sqlite.close();}
});

test('publication time budgets count net planned hours for all sites and open shifts, including complete months',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 const read=payload=>action(db,'publicationBudgetRead',payload);
 const without=await read(week);
 assert.equal(without.status,200);
 assert.equal(without.body.budget,null);
 assert.equal((await read({from:'2026-10-27',to:week.to})).status,400);
 assert.equal((await read({...week,extraWeeks:['2100-12-27']})).status,400);

 const saved=await Store.readStudio(db,owner.id);
 saved.studio.edits['open-other-site']=shift('open-other-site','2026-10-30',{site:1,person:'',start:'06:00',end:'12:00',plannedBreakMinutes:45});
 saved.studio.edits['later-in-month']=shift('later-in-month','2026-11-30',{site:2,start:'14:00',end:'15:30'});
 saved.studio.workspaceSettings={workHoursBudget:{period:'week',hours:20.5}};
 assert.equal((await Store.writeStudio(db,owner.id,saved.revision,saved.studio)).ok,true);
 db.queries=[];
 const planned=await read({...week,to:'2026-11-08'});
 assert.equal(planned.status,200,JSON.stringify(planned.body));
 assert.match(planned.body.accessIdentity,/^[a-f0-9]{64}$/);
 assert.deepEqual(planned.body,{accessIdentity:planned.body.accessIdentity,revision:saved.revision+1,directoryRevision:planned.body.directoryRevision,scope:{kind:'company'},budget:{period:'week',periods:[
   {...week,plannedMinutes:1230,budgetHours:20.5},
   {from:'2026-11-02',to:'2026-11-08',plannedMinutes:480,budgetHours:20.5}
 ]}});
 const returned=JSON.stringify(db.queries.map(query=>query.returned));
 for(const marker of markers)assert.equal(returned.includes(marker),false,marker);
 assert.equal(db.queries.some(query=>/FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);

 const latest=await Store.readStudio(db,owner.id);
 latest.studio.workspaceSettings.workHoursBudget={period:'month',hours:40};
 assert.equal((await Store.writeStudio(db,owner.id,latest.revision,latest.studio)).ok,true);
 db.queries=[];
 const month=await read({...week,extraWeeks:[week.from,'2028-01-03']});
 assert.equal(month.status,200,JSON.stringify(month.body));
 assert.deepEqual(month.body.budget,{period:'month',periods:[
   {from:'2026-10-01',to:'2026-10-31',plannedMinutes:1230,budgetHours:40},
   {from:'2026-11-01',to:'2026-11-30',plannedMinutes:570,budgetHours:40},
   {from:'2028-01-01',to:'2028-01-31',plannedMinutes:1380,budgetHours:40}
 ]});
 const indexed=db.queries.find(query=>query.sql.includes('INDEXED BY workspace_plan_window_to'));
 assert.deepEqual(JSON.parse(indexed.values[0]),[
   {from:'2026-10-01',to:'2026-11-30'},
   {from:'2028-01-01',to:'2028-01-31'}
 ]);
});

test('publication time budget reads require planning rights and discard a changed generation',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 const saved=await Store.readStudio(db,owner.id);
 saved.studio.workspaceSettings={workHoursBudget:{period:'week',hours:0}};
 assert.equal((await Store.writeStudio(db,owner.id,saved.revision,saved.studio)).ok,true);
 const invitation=await action(db,'invite',{email:worker.email,roleId:'employee',personId:person});
 assert.equal(invitation.status,200);
 assert.equal((await action(db,'acceptInvite',{token:new URL(invitation.body.inviteUrl).searchParams.get('token')},worker)).status,200);
 const denied=await action(db,'publicationBudgetRead',week,worker);
 assert.equal(denied.status,403);
 assert.equal(denied.body.budget,undefined);
 let changed=false;
 db.beforeBatch=statements=>{
   if(!changed&&statements.some(query=>query.sql.includes('record.schedule_config,record.schedule_version'))){
     changed=true;
     db.sqlite.prepare('UPDATE studio_states SET revision=revision+1 WHERE owner_id=?').run(owner.id);
   }
 };
 const stale=await action(db,'publicationBudgetRead',week);
 assert.equal(changed,true);
 assert.equal(stale.status,409,JSON.stringify(stale.body));
 assert.equal(stale.body.budget,undefined);
});

test('publication budget initializes a legacy plan without requiring an earlier calendar read',async t=>{
 const {db}=await setup({cold:true,budget:{period:'week',hours:20}});
 t.after(()=>db.sqlite.close());
 const result=await action(db,'publicationBudgetRead',week);
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.match(result.body.accessIdentity,/^[a-f0-9]{64}$/);
 assert.deepEqual(result.body,{accessIdentity:result.body.accessIdentity,revision:1,directoryRevision:1,scope:{kind:'company'},budget:{period:'week',periods:[{...week,plannedMinutes:915,budgetHours:20}]}});
 const workspaceId=db.sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner.id).id;
 assert.ok(db.sqlite.prepare('SELECT schema FROM workspace_plan_window_imports WHERE workspace_id=?').get(workspaceId));
});

test('scoped budget reads resolve current directory limits and count only their workplaces across complete months',async t=>{
 const {db}=await setup({budget:{period:'week',hours:100}});t.after(()=>db.sqlite.close());
 const read=scope=>action(db,'publicationBudgetRead',{...week,scope});
 assert.equal((await read({kind:'department',id:'dep-nord'})).body.budget,null,'A company limit is not copied into an unconfigured department.');
 for(const scope of [null,{},[],{kind:'unknown'},{kind:'site',id:0},{kind:'company',id:'x'},{kind:'site',id:'site-nord',siteIds:[1]}])assert.equal((await read(scope)).status,400);
 assert.equal((await read({kind:'site',id:'site-missing'})).status,404);
 const saved=await Store.readStudio(db,owner.id);
 saved.studio.edits['open-other-site']=shift('open-other-site','2026-10-30',{site:1,person:'',start:'06:00',end:'12:00',plannedBreakMinutes:45});
 saved.studio.edits['later-in-month']=shift('later-in-month','2026-11-30',{site:2,start:'14:00',end:'15:30'});
 assert.equal((await Store.writeStudio(db,owner.id,saved.revision,saved.studio)).ok,true);
 const configured=await directory(db,[
  {kind:'site',id:'site-klinik',expectedVersion:1,patch:{workHoursBudget:{period:'month',hours:40}}},
  {kind:'department',id:'dep-nord',expectedVersion:1,patch:{siteIds:[0,1],workHoursBudget:{period:'month',hours:80}}}
 ]);
 assert.equal(configured.status,200,JSON.stringify(configured));
 db.queries=[];
 const site=await read({kind:'site',id:'site-klinik'});
 assert.equal(site.status,200,JSON.stringify(site));
 assert.deepEqual(site.body.scope,{kind:'site',id:'site-klinik'});
 assert.equal(site.body.directoryRevision,configured.body.directory.revision);
 assert.deepEqual(site.body.budget,{period:'month',periods:[
  {from:'2026-10-01',to:'2026-10-31',plannedMinutes:315,budgetHours:40},
  {from:'2026-11-01',to:'2026-11-30',plannedMinutes:0,budgetHours:40}
 ]});
 const department=await read({kind:'department',id:'dep-nord'});
 assert.equal(department.status,200,JSON.stringify(department));
 assert.deepEqual(department.body.budget,{period:'month',periods:[
  {from:'2026-10-01',to:'2026-10-31',plannedMinutes:1230,budgetHours:80},
  {from:'2026-11-01',to:'2026-11-30',plannedMinutes:480,budgetHours:80}
 ]});
 assert.equal(db.queries.some(query=>/FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);
 let changed=false;
 db.beforeBatch=statements=>{
  if(!changed&&statements.some(query=>query.sql.includes('record.schedule_config,record.schedule_version'))){
   changed=true;
   db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1 WHERE workspace_id=?').run(configured.body.workspace.id);
  }
 };
 const stale=await read({kind:'department',id:'dep-nord'});
 assert.equal(changed,true);
 assert.equal(stale.status,409,JSON.stringify(stale));
 assert.equal(stale.body.budget,undefined);
});

test('attendance schedule collection fails explicitly at its row or byte budget without returning a partial overview',async()=>{
 const {db,workspaceId}=await setup();try{
  const {readPlanningScheduleSummaries}=require('../lib/planning-selection-store.mjs'),before=db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner.id).revision;
  for(const limit of [{maxRecords:1},{maxBytes:1}])await assert.rejects(()=>readPlanningScheduleSummaries(db,workspaceId,[week],limit),error=>error.status===413&&error.code==='planning_summary_too_large');
  assert.ok((await readPlanningScheduleSummaries(db,workspaceId,[week])).length>1);
  assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(owner.id).revision,before);
 }finally{db.sqlite.close();}
});
