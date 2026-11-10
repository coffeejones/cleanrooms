const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Workspace=require('../lib/workspace-store.mjs'),Published=require('../lib/publication-store.mjs'),Series=require('../src/series-engine.js'),Lifecycle=require('../src/series-lifecycle.js'),Window=require('../src/planning-window.js');
const prefix=fs.readFileSync(require.resolve('./workspace-planning.test.cjs'),'utf8').split("test('")[0];
const F=new Function('require','__dirname',prefix+'\nreturn {setup,save,api,account,join,owner,worker,person,shift,series,request};')(require,__dirname);
const range={from:'2026-12-21',to:'2027-01-17'},scope={...range,siteIds:[0],includeDependencies:true},cadence={startDate:range.from,endDate:range.to,weekdays:[0],weekInterval:2,weekAnchor:range.from};
const fresh=async db=>(await F.api(db)).body;
const workspaceId=db=>db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(F.owner.id).workspace_id;
async function setup(patch={}){const fixture=await F.setup({calendarAnchor:range.from,edits:{},series:[F.series('fortnight',{...cadence,note:'PRIVATE_CADENCE_INSTRUCTIONS',...patch})],weekPlans:{},workspaceSettings:{workHoursBudget:{period:'week',hours:40}}});const original=fixture.db.batch;fixture.db.queries=[];fixture.db.batch=async queries=>{fixture.db.queries.push(...queries);return original(queries);};return fixture;}
async function publish(db,publication=scope){return F.save(db,await fresh(db),()=>{},F.owner,{publication,commandReceipt:'records'});}
async function window(db,projection={mode:'calendar',...range}){const collector=Window.collector(projection),pages=[];let cursor=null;do{const endpoint='/api/studio?projection='+projection.mode+'&instructions=deferred&'+(projection.mode==='calendar'?'from='+projection.from+'&to='+projection.to:'selection='+encodeURIComponent(JSON.stringify(projection)))+(cursor?'&cursor='+encodeURIComponent(cursor):''),response=await Workspace.handleWorkspaceStudioRequest(F.request('GET',undefined,F.owner,endpoint),db),page=await response.json();assert.equal(response.status,200,JSON.stringify(page));pages.push(page);cursor=collector.add(page);}while(cursor);return {result:collector.finish(),pages};}

test('real compact calendar/catalog, budget and cost reads retain anchored cadence without instruction or full-plan hydration',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());
 const {result,pages}=await window(db);assert.equal(result.studio.series[0].weekInterval,2);assert.equal(result.studio.series[0].weekAnchor,range.from);assert.equal(JSON.stringify(pages).includes('PRIVATE_CADENCE_INSTRUCTIONS'),false);
 const catalog=await window(db,{mode:'series-list',calendar:range,catalogOnly:true});const [summary]=Lifecycle.summarizeSeries(catalog.result.catalog.series,{today:range.from,edits:catalog.result.catalog.edits,deleted:catalog.result.catalog.deleted});assert.equal(summary.total,2);assert.equal(summary.next.date,'2026-12-21');
 assert.equal(db.queries.some(query=>/FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);
 db.queries=[];const budget=await F.account(db,'publicationBudgetRead',range);assert.equal(budget.status,200,JSON.stringify(budget));assert.deepEqual(budget.body.budget.periods.map(period=>period.plannedMinutes),[480,0,480,0]);
 const at='2026-01-01T00:00:00.000Z',agreement={currency:'DKK',agreements:[{id:'hourly',from:'2026-01-01',type:'hourly',amountCents:18000}],supplements:[]};db.sqlite.prepare('INSERT INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(workspaceId(db),F.person,JSON.stringify(agreement),1,F.owner.id,at,'cadence-rate');
 const costs=await F.account(db,'planningCostRead',range);assert.equal(costs.status,200,JSON.stringify(costs));assert.deepEqual(costs.body.weeks.map(week=>week.totalCents),[144000,0,144000,0]);
 assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_plan_record_chunks')),false);
});

test('publication and employee readers expose only actual active weeks and preserve frozen schedules until republished',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());assert.equal((await publish(db)).status,200);
 const neighborQueries=db.queries.filter(query=>query.sql.includes("target.work_date=json_extract(chosen.value,'$.date')"));assert.ok(neighborQueries.length);assert.deepEqual([...new Set(neighborQueries.flatMap(query=>JSON.parse(query.values[0]).map(pair=>pair.date)))].sort(),['2026-12-20','2026-12-21','2026-12-22','2027-01-03','2027-01-04','2027-01-05']);
 await F.join(db,F.worker,'employee',F.person);
 assert.equal((await F.account(db,'employeeRead',range,F.worker)).status,200);db.queries=[];const own=await F.account(db,'employeeRead',range,F.worker);assert.equal(own.status,200,JSON.stringify(own));assert.deepEqual(own.body.shifts.map(shift=>shift.id),['fortnight@2026-12-21','fortnight@2027-01-04']);
 assert.equal(db.queries.some(query=>/FROM workspace_plan_records|FROM workspace_plan_record_chunks|FROM workspace_publication_chunks/.test(query.sql)),false);
 const page=await Published.readPublishedEmployeePage({db,workspaceId:workspaceId(db),personId:F.person,...range});assert.deepEqual(page.shifts.map(shift=>shift.date),['2026-12-21','2027-01-04']);
 const changed=await F.save(db,await fresh(db),next=>{next.series[0].weekInterval=1;});assert.equal(changed.status,200,JSON.stringify(changed));assert.deepEqual((await F.account(db,'employeeRead',range,F.worker)).body.shifts.map(shift=>shift.date),['2026-12-21','2027-01-04']);
 assert.equal((await publish(db)).status,200);assert.deepEqual((await F.account(db,'employeeRead',range,F.worker)).body.shifts.map(shift=>shift.date),['2026-12-21','2026-12-28','2027-01-04','2027-01-11']);
});

test('real future splits and open-ended point reads preserve cadence across an inactive cutoff and reject stale edits',async t=>{
 const {db}=await setup({openEnded:true,endDate:Series.OPEN_END});t.after(()=>db.sqlite.close());const stale=await fresh(db),cutoff='2026-12-30';
 const saved=await F.save(db,stale,next=>{const source=next.series[0],copy=Lifecycle.copyDraft(source,{id:'next-phase',startDate:cutoff,endDate:Series.OPEN_END,openEnded:true}).draft;copy.groupId=source.id;next.series=[{...source,endDate:'2026-12-29',openEnded:false},copy];});assert.equal(saved.status,200,JSON.stringify(saved));
 const {result}=await window(db);assert.deepEqual(result.studio.series.map(phase=>phase.weekAnchor),[range.from,range.from]);assert.deepEqual(require('../src/studio-data.js').shiftsInRange(range.from,range.to,result.studio).map(shift=>shift.date),['2026-12-21','2027-01-04']);
 const future=await window(db,{mode:'calendar',from:'2099-12-21',to:'2100-01-10'});assert.ok(future.result.studio.series.every(phase=>phase.weekAnchor===range.from));
 const staleWrite=await F.save(db,stale,next=>{next.series[0].weekAnchor='2026-12-28';});assert.equal(staleWrite.status,409);
});

test('new cadence validation and old-client field-drop guards apply to command and legacy saves',async t=>{
 const {db}=await setup();t.after(()=>db.sqlite.close());const current=await fresh(db);
 for(const mutate of [next=>{next.series[0].weekInterval=3;},next=>{next.series[0].weekAnchor='2026-12-22';},next=>{delete next.series[0].weekInterval;delete next.series[0].weekAnchor;}]){
  const denied=await F.save(db,current,mutate);assert.equal(denied.status,400,JSON.stringify(denied));
 }
 const old=structuredClone(current.studio);delete old.series[0].weekInterval;delete old.series[0].weekAnchor;const denied=await F.api(db,'PUT',{revision:current.revision,studio:old});assert.equal(denied.status,400,JSON.stringify(denied));
 const explicit=await F.save(db,current,next=>{next.series[0].weekInterval=1;});assert.equal(explicit.status,200,JSON.stringify(explicit));
});

test('overnight conflicts and next-day absence consider active weeks only',async t=>{
 for(const active of [true,false])await t.test(active?'active Sunday night':'inactive Sunday night',async()=>{
  const {db}=await setup({weekdays:[6],start:'22:00',end:'06:00'});try{
   const monday=active?'2026-12-28':'2027-01-04',saved=await F.save(db,await fresh(db),next=>{next.edits.early=F.shift('early',{date:monday,site:1,start:'05:00',end:'07:00'});});assert.equal(saved.status,200);
   const result=await publish(db,{...scope,siteIds:[0,1]});assert.equal(result.status,active?400:200,JSON.stringify(result));if(active)assert.equal(result.body.error,'publication_conflict');
   const removed=await F.save(db,await fresh(db),next=>{delete next.edits.early;});assert.equal(removed.status,200);
   const request=await F.account(db,'leaveCreate',{personId:F.person,type:'Ferie',from:monday,to:monday,comment:''});assert.equal(request.status,200,JSON.stringify(request));assert.equal((await F.account(db,'leaveDecide',{id:request.body.request.id,version:request.body.request.version,status:'approved'})).status,200);
   const absence=await publish(db);assert.equal(absence.status,active?400:200,JSON.stringify(absence));if(active)assert.equal(absence.body.error,'publication_leave');
  }finally{db.sqlite.close();}
 });
});
