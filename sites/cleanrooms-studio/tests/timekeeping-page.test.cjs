const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Time=require('../src/timekeeping-model.js'),Groups=require('../src/payroll-groups-model.js'),Store=require('../lib/studio-store.mjs'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js');
// Reuse the real-route database/identity setup, without registering its tests.
const shared=fs.readFileSync(path.join(__dirname,'timekeeping.test.cjs'),'utf8').split("\ntest('")[0];
const {database,action,join,configure,people,owner,employee}=new Function('require','__dirname',shared+'\nreturn {database,action,join,configure,people,owner,employee};')(require,__dirname);
const range={from:'2026-10-26',to:'2026-11-01'};
async function setup(size=125){
  const db=database(),edits={};
  for(let index=0;index<size;index++){const id='shift-'+String(index).padStart(4,'0');edits[id]={id,person:people[index%2].id,site:0,date:'2026-10-26',start:'07:00',end:'15:00',plannedBreakMinutes:30,note:'PRIVATE_INSTRUCTIONS'.repeat(100)};}
  let studio={storageVersion:1,demoSeed:false,roster:people,organization:Departments.defaultOrganization(),series:[],edits,deleted:[],weekPlans:{},coverageRules:[],requests:{},checklistProgress:{}};
  studio=Publication.publish(studio,{...range,siteIds:[0],actor:{userId:owner.id,name:'Owner'},at:'2026-10-26T00:00:00.000Z'}).studio;
  await Store.writeStudio(db,owner.id,0,studio);
  const init=await action(db,'timeRead',range);assert.equal(init.status,200,JSON.stringify(init));
  const workspace=db.sqlite.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(owner.id);await configure(db,workspace);
  const entries=Object.values(edits).map((shift,index)=>({id:'entry-'+String(index).padStart(4,'0'),shiftId:shift.id,personId:shift.person,version:1,date:shift.date,site:0,plannedStart:shift.start,plannedEnd:shift.end,plannedBreakMinutes:30,start:shift.start,end:shift.end,endDate:shift.date,breakMinutes:30,breaks:[],breakAllocation:'end-of-shift',status:index%5===0?'approved':'submitted',comment:index%7===0?'Forklaring fra medarbejderen':'',correctionReason:'',audit:[],createdAt:'2026-10-26T14:00:00.000Z',updatedAt:'2026-10-26T14:00:00.000Z',...(index%5===0?{payroll:{totalCents:10000+index,baseCents:9000+index,supplementCents:1000}}:{})}));
  const insert=db.sqlite.prepare('INSERT INTO workspace_time_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const entry of entries)insert.run(workspace.id,entry.id,entry.shiftId,entry.personId,entry.date,entry.endDate,entry.status,0,1,JSON.stringify(entry),'token-'+entry.id,entry.updatedAt,null,null);
  db.sqlite.prepare('INSERT INTO workspace_timekeeping VALUES (?,?,?,?,?)').run(workspace.id,JSON.stringify({schema:2,entries:[],demo:null}),1,'ledger-token','2026-10-26T14:00:00.000Z');
  return {db,workspace,entries};
}
const read=(db,extra={},actor=owner)=>action(db,'timeRead',{...range,queue:'all',scope:'real',search:'',pageSize:50,...extra},actor);

test('planner pages return at most50 DTOs while exact queue and person summaries cover every matching registration',async t=>{
  const {db,entries}=await setup();t.after(()=>db.sqlite.close());
  const legacy=await action(db,'timeRead',range);assert.equal(legacy.status,200);
  const shifts=new Map(legacy.body.shifts.map(shift=>[shift.id,shift])),expected={all:entries.length,attention:0,ready:0,progress:0,approved:0};
  for(const entry of legacy.body.entries)expected[Time.review(entry,{shift:shifts.get(entry.shiftId),canViewPayroll:true}).bucket]++;
  const page=await read(db);assert.equal(page.status,200,JSON.stringify(page));assert.equal(page.body.entries.length,50);assert.ok(page.body.nextCursor);assert.deepEqual(page.body.summary.counts,expected);assert.equal(page.body.matchedCount,125);assert.equal(page.body.summary.registeredMinutes,125*450);assert.equal(page.body.summary.approvedMinutes,25*450);assert.equal(page.body.summary.approvedCents,entries.filter(entry=>entry.status==='approved').reduce((sum,entry)=>sum+entry.payroll.totalCents,0));assert.equal(page.body.summary.people.length,2);assert.equal(page.body.plannedRows.length,2);
  for(const entry of page.body.entries)assert.deepEqual(entry.review,Time.review(entry,{shift:shifts.get(entry.shiftId),canViewPayroll:true}));
  const seen=[...page.body.entries.map(entry=>entry.id)];let cursor=page.body.nextCursor;
  while(cursor){const next=await read(db,{cursor});assert.equal(next.status,200,JSON.stringify(next));assert.ok(next.body.entries.length<=50);assert.deepEqual(next.body.summary,page.body.summary);assert.equal(next.body.plannedRows.length,2);seen.push(...next.body.entries.map(entry=>entry.id));cursor=next.body.nextCursor;}
  assert.equal(seen.length,125);assert.equal(new Set(seen).size,125);
  const ready=await read(db,{queue:'ready'});assert.equal(ready.status,200,JSON.stringify(ready));assert.deepEqual(ready.body.summary.counts,expected);assert.ok(ready.body.entries.every(entry=>entry.review.bucket==='ready'));
});

test('queue filters, search, demo scope and planner-only wages never change legacy/native reads',async t=>{
  const {db}=await setup(12);t.after(()=>db.sqlite.close());
  const search=await read(db,{search:'Emma'});assert.equal(search.status,200);assert.equal(search.body.summary.counts.all,6);assert.ok(search.body.entries.every(entry=>entry.personId===people[0].id));
  const demo=await read(db,{scope:'demo'});assert.equal(demo.status,200);assert.equal(demo.body.entries.length,0);assert.equal(demo.body.summary.counts.all,0);
  const loaded=await action(db,'timeDemo',{...range,operation:'load'});assert.equal(loaded.status,200);const demoRange={from:loaded.body.demo.from,to:loaded.body.demo.to};const fullDemo=await read(db,{...demoRange,scope:'demo',pageSize:1});assert.equal(fullDemo.status,200,JSON.stringify(fullDemo));assert.equal(fullDemo.body.entries.length,1);assert.ok(fullDemo.body.plannedRows.reduce((sum,row)=>sum+row.plannedMinutes,0)>450,'Every demo shift contributes planned minutes even when only one attendance row is visible.');assert.ok(fullDemo.body.nextCursor);
  const planner={id:'page-planner',email:'planner@example.com'};await join(db,planner,null,'planner');
  const limited=await read(db,{},planner);assert.equal(limited.status,200);assert.equal(limited.body.canViewPayroll,false);assert.equal(limited.body.summary.approvedCents,undefined);assert.ok(limited.body.summary.people.every(person=>person.approvedCents===undefined));assert.ok(limited.body.entries.every(entry=>entry.payroll===undefined));
  await join(db,employee,people[0].id);const own=await read(db,{},employee);assert.equal(own.status,200);assert.equal(own.body.page,undefined);assert.ok(own.body.entries.every(entry=>entry.personId===people[0].id));
});

test('cursors bind filters and all mutable review generations and reject mixed snapshots',async t=>{
  const {db,workspace}=await setup(55);t.after(()=>db.sqlite.close());
  const initial=await read(db);assert.equal(initial.status,200);const cursor=initial.body.nextCursor;
  for(const change of [{queue:'ready'},{search:'Emma'},{scope:'demo'},{pageSize:20}])assert.equal((await read(db,{cursor,...change})).status,409);
  db.sqlite.prepare('UPDATE workspace_payroll SET version=version+1 WHERE workspace_id=?').run(workspace.id);assert.equal((await read(db,{cursor})).status,409);
  const refreshed=await read(db);assert.equal(refreshed.status,200);db.sqlite.prepare('UPDATE workspace_timekeeping SET version=version+1 WHERE workspace_id=?').run(workspace.id);assert.equal((await read(db,{cursor:refreshed.body.nextCursor})).status,409);
  let raced=false;db.beforeBatch=statements=>{if(!raced&&statements.some(query=>query.sql.includes(' AS facts,'))){raced=true;db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1 WHERE workspace_id=?').run(workspace.id);}};
  const conflict=await read(db);assert.equal(raced,true);assert.equal(conflict.status,409);assert.equal(conflict.body.entries,undefined);
  assert.equal((await read(db,{pageSize:51})).status,400);assert.equal((await read(db,{queue:'forged'})).status,400);
});

test('off-page review scanning never hydrates attendance audit/comments or emits private instruction bodies',async t=>{
  const {db,entries}=await setup(620);t.after(()=>db.sqlite.close());const big='PRIVATE_LONG_COMMENT'.repeat(3000);
  const last={...entries.at(-1),comment:big,audit:[{reason:big}]};db.sqlite.prepare('UPDATE workspace_time_entries SET config=? WHERE id=?').run(JSON.stringify(last),last.id);
  const returned=[],batch=db.batch;db.batch=async statements=>{const output=await batch(statements);for(let i=0;i<statements.length;i++)returned.push({sql:statements[i].sql,rows:output[i].results});return output;};
  const result=await read(db);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.entries.length,50);assert.equal(result.body.summary.counts.all,620);
  for(const part of returned){if(part.sql.includes(' AS facts,')){assert.ok(part.rows.length<=500);assert.equal(JSON.stringify(part.rows).includes(big),false);}if(part.sql.startsWith('SELECT attendance.config'))assert.ok(part.rows.length<=50);}
  assert.equal(JSON.stringify(result.body).includes('PRIVATE_INSTRUCTIONS'),false);assert.equal(JSON.stringify(result.body).includes(big),false);
  returned.length=0;const ready=await read(db,{queue:'ready'});assert.equal(ready.status,200);assert.equal(ready.body.summary.counts.all,620);assert.ok(returned.filter(part=>part.sql.includes(' AS facts,')).reduce((sum,part)=>sum+part.rows.length,0)<=500,'A queue change reuses exact generation-bound totals and stops after its bounded visible scan.');
});

test('compact coverage matches exact wage coverage across pauses, midnight, monthly rates and resolved DST',()=>{
  const {payrollCoverage}=require('../lib/timekeeping-page.mjs');
  for(const patch of [{},{start:'23:00',end:'02:00',endDate:'2026-10-27'},{start:'23:00',end:'00:30',endDate:'2026-10-27',breakMinutes:30},{start:'01:30',end:'03:30',date:'2026-10-25',endDate:'2026-10-25',timingResolved:true,resolvedStartAt:'2026-10-24T23:30:00.000Z',resolvedEndAt:'2026-10-25T02:30:00.000Z'}])for(const from of ['2026-10-25','2026-10-26','2026-10-27'])for(const type of ['hourly','monthly']){
    const entry={personId:people[0].id,date:'2026-10-26',start:'07:00',end:'15:00',endDate:'2026-10-26',breakMinutes:0,breaks:[],plannedStart:'07:00',plannedEnd:'15:00',...patch},resolved=Groups.resolve({policy:null,personId:entry.personId,payroll:{currency:'DKK',agreements:[{id:'base',from,type,amountCents:10000}],supplements:[]},from:entry.date,to:entry.endDate});
    assert.equal(payrollCoverage(entry,resolved),!Time.payroll(entry,resolved).unavailableReason,JSON.stringify({patch,from,type}));
  }
});


test('compact review preserves whitespace semantics, detects cross-page overlaps and never treats DST as ready',async t=>{
  const {db,entries}=await setup(8);t.after(()=>db.sqlite.close());
  for(const [index,patch]of [[1,{comment:'\n\t\u00a0\u2003',correctionReason:'\u202f'}],[2,{dstUnresolved:true}],[3,{start:'07:30',end:'15:30'}]]){const entry={...entries[index],...patch};db.sqlite.prepare('UPDATE workspace_time_entries SET config=? WHERE id=?').run(JSON.stringify(entry),entry.id);}
  const interval={start:Date.parse('2026-10-26T06:00:00Z'),end:Date.parse('2026-10-26T14:00:00Z')};
  for(const index of [1,7])db.sqlite.prepare('UPDATE workspace_time_entries SET interval_start=?,interval_end=? WHERE id=?').run(interval.start,interval.end,entries[index].id);
  const all=await read(db);assert.equal(all.status,200,JSON.stringify(all));
  const overlap=all.body.entries.find(entry=>entry.id===entries[1].id);assert.ok(overlap.review.reasons.some(reason=>reason.code==='overlap'));assert.equal(overlap.review.reasons.some(reason=>reason.code==='employee_comment'||reason.code==='corrected'),false);assert.ok(overlap.flags.includes('overlap'));
  const dst=all.body.entries.find(entry=>entry.id===entries[2].id);assert.equal(dst.review.bucket,'attention');assert.ok(dst.review.reasons.some(reason=>reason.code==='dst_transition'));
});

test('missing payroll totals count only approved records and never label unapproved wages as missing approved basis',async t=>{
  const {db,workspace,entries}=await setup(12);t.after(()=>db.sqlite.close());db.sqlite.prepare('DELETE FROM workspace_payroll WHERE workspace_id=?').run(workspace.id);db.sqlite.prepare('DELETE FROM workspace_payroll_policies WHERE workspace_id=?').run(workspace.id);
  for(const entry of entries){delete entry.payroll;db.sqlite.prepare('UPDATE workspace_time_entries SET config=? WHERE id=?').run(JSON.stringify(entry),entry.id);}
  const result=await read(db);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.summary.missingPayrollCount,3);assert.equal(result.body.summary.approvedCents,0);assert.equal(result.body.summary.counts.approved,3);assert.equal(result.body.summary.people.reduce((sum,person)=>sum+person.missingPayrollCount,0),3);
});


test('payroll-period problem pages use the same frozen-source rules as closing and cursor-bind the problem',async t=>{
 const {db,entries}=await setup(125);t.after(()=>db.sqlite.close());
 const unapproved=await read(db,{problem:'unapproved',pageSize:20});assert.equal(unapproved.status,200,JSON.stringify(unapproved));assert.equal(unapproved.body.matchedCount,100);assert.equal(unapproved.body.summary.counts.approved,0);assert.ok(unapproved.body.entries.every(entry=>entry.status!=='approved'&&entry.payrollPeriodProblem==='unapproved'));assert.ok(unapproved.body.nextCursor);
 const crossed=await read(db,{problem:'missing_payroll',pageSize:20,cursor:unapproved.body.nextCursor});assert.equal(crossed.status,409);
 const missing=await read(db,{problem:'missing_payroll'});assert.equal(missing.status,200,JSON.stringify(missing));assert.equal(missing.body.matchedCount,25);assert.equal(missing.body.summary.missingPayrollCount,25);assert.equal(missing.body.summary.approvedCents,0,'A fresh estimate must not replace an absent frozen snapshot');assert.ok(missing.body.entries.every(entry=>entry.status==='approved'&&entry.payrollPeriodProblem==='missing_payroll'&&entry.payroll.unavailableReason));
 const first=entries[0],bad={...first,end:'06:00',breakMinutes:999};db.sqlite.prepare('UPDATE workspace_time_entries SET config=? WHERE id=?').run(JSON.stringify(bad),first.id);db.sqlite.prepare('UPDATE workspace_timekeeping SET version=version+1').run();
 const invalid=await read(db,{problem:'invalid_time'});assert.equal(invalid.status,200,JSON.stringify(invalid));assert.equal(invalid.body.matchedCount,1);assert.equal(invalid.body.entries[0].id,first.id);
});

test('payroll problem filters reject employee access, payroll-blind planners, demo data and unknown categories',async t=>{
 const {db}=await setup(2);t.after(()=>db.sqlite.close());
 const planner={id:'problem-blind-planner',email:'blind-planner@example.com'};await join(db,planner,null,'planner');
 assert.equal((await read(db,{problem:'unapproved'},planner)).status,403);
 await join(db,employee,people[0].id);assert.equal((await read(db,{problem:'unapproved'},employee)).status,403);
 assert.equal((await read(db,{problem:'anything'})).status,400);assert.equal((await read(db,{problem:'unapproved',scope:'demo'})).status,400);assert.equal((await action(db,'timeRead',{...range,problem:'unapproved'})).status,400);
});

test('an exact entry target reaches an off-page registration without bypassing the selected period or cursor generation',async t=>{
 const {db,entries}=await setup(125);t.after(()=>db.sqlite.close());const target=entries.at(-1),first=await read(db);assert.equal(first.status,200);assert.equal(first.body.entries.some(entry=>entry.id===target.id),false);
 const exact=await read(db,{entryId:target.id,pageSize:1});assert.equal(exact.status,200,JSON.stringify(exact));assert.deepEqual(exact.body.entries.map(entry=>entry.id),[target.id]);assert.equal(exact.body.matchedCount,1);assert.equal(exact.body.nextCursor,null);assert.equal(exact.body.page.entryId,target.id);
 assert.equal((await read(db,{entryId:target.id,cursor:first.body.nextCursor})).status,409);
 const outside=await read(db,{entryId:target.id,from:'2026-11-02',to:'2026-11-08'});assert.equal(outside.status,200);assert.equal(outside.body.entries.length,0);assert.equal(outside.body.matchedCount,0);
 const wrongPerson=await read(db,{entryId:target.id,personId:people[1].id});assert.equal(wrongPerson.status,200);assert.equal(wrongPerson.body.entries.length,0);
});

test('exact entry targets require a planner queue and reject malformed IDs without changing employee ownership reads',async t=>{
 const {db,entries}=await setup(2);t.after(()=>db.sqlite.close());await join(db,employee,people[0].id);
 assert.equal((await action(db,'timeRead',{...range,entryId:entries[0].id})).status,400);
 assert.equal((await read(db,{entryId:entries[0].id},employee)).status,400);
 for(const entryId of ['',null,1,'bad\nidentity','x'.repeat(513)])assert.equal((await read(db,{entryId})).status,400,JSON.stringify(entryId));
 const ordinary=await action(db,'timeRead',range,employee);assert.equal(ordinary.status,200);assert.ok(ordinary.body.entries.every(entry=>entry.personId===people[0].id));
});

test('an exact ID cannot reveal a foreign-home employee even when the historical shift is at an allowed workplace',async t=>{
 const {db,entries}=await setup(4);t.after(()=>db.sqlite.close());const Workspace=require('../lib/workspace-store.mjs');
 const moved=await Workspace.handleDirectoryRequest(new Request('https://cleanrooms.example/api/directory',{method:'POST',headers:{origin:'https://cleanrooms.example','content-type':'application/json','oai-authenticated-user-id':owner.id,'oai-authenticated-user-email':owner.email},body:JSON.stringify({action:'write',changes:[{kind:'employee',id:people[1].id,expectedVersion:1,patch:{site:1}}]})}),db);assert.equal(moved.status,200,await moved.text());
 const planner={id:'exact-scoped-planner',email:'exact-scoped@example.test'},invited=await action(db,'invite',{email:planner.email,roleId:'planner',accessScope:{mode:'departments',departmentIds:['dep-nord']}});assert.equal(invited.status,200,JSON.stringify(invited));assert.equal((await action(db,'acceptInvite',{token:new URL(invited.body.inviteUrl).searchParams.get('token')},planner)).status,200);
 const own=await read(db,{entryId:entries[0].id},planner);assert.equal(own.status,200,JSON.stringify(own));assert.equal(own.body.entries.length,1);assert.equal(own.body.entries[0].payroll,undefined);
 const foreign=await read(db,{entryId:entries[1].id},planner);assert.equal(foreign.status,200,JSON.stringify(foreign));assert.equal(foreign.body.entries.length,0);assert.equal(foreign.body.matchedCount,0);assert.equal(JSON.stringify(foreign.body).includes(people[1].name),false);
});
