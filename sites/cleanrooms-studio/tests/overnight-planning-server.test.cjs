const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Workspace=require('../lib/workspace-store.mjs'),Published=require('../lib/publication-store.mjs'),Window=require('../src/planning-window.js'),Planning=require('../src/planning-records.js');
// Reuse the real D1-compatible database and authenticated handlers, without
// registering the fixture module's own tests.
const prefix=fs.readFileSync(require.resolve('./workspace-planning.test.cjs'),'utf8').split("test('")[0];
const F=new Function('require','__dirname',prefix+'\nreturn {setup,save,api,account,join,owner,planner,worker,person,other,shift,series,request};')(require,__dirname);
const previous={from:'2026-10-26',to:'2026-11-01',siteIds:[0],includeDependencies:true},following={from:'2026-11-02',to:'2026-11-08',siteIds:[0],includeDependencies:true};
async function fresh(db){return (await F.api(db)).body;}
async function publish(db,scope=previous){const current=await fresh(db);return F.save(db,current,()=>{},F.owner,{publication:scope});}
const workspaceId=db=>db.sqlite.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(F.owner.id).workspace_id;
async function window(db,range=following){let cursor=null;const collector=Window.collector({mode:'calendar',from:range.from,to:range.to});const pages=[];do{const endpoint='/api/studio?projection=calendar&instructions=deferred&from='+range.from+'&to='+range.to+(cursor?'&cursor='+encodeURIComponent(cursor):''),response=await Workspace.handleWorkspaceStudioRequest(F.request('GET',undefined,F.owner,endpoint),db),page=await response.json();assert.equal(response.status,200,JSON.stringify(page));pages.push(page);cursor=collector.add(page);}while(cursor);return {result:collector.finish(),pages};}
async function setupNight(patch={}){
 const fixture=await F.setup({calendarAnchor:'2026-10-26',edits:{},series:[],weekPlans:{},...patch});
 const created=await F.save(fixture.db,fixture.loaded,next=>{next.series.push(F.series('night',{startDate:'2026-11-01',endDate:'2026-11-01',weekdays:[6],start:'22:00',end:'06:00',plannedBreakMinutes:30,note:'Private night instructions'}));});
 assert.equal(created.status,200,JSON.stringify(created));return fixture;
}

test('real save, series publication and own employee reads preserve overnight start-day identity',async t=>{
 const {db}=await setupNight();t.after(()=>db.sqlite.close());assert.equal((await publish(db)).status,200);
 await F.join(db,F.worker,'employee',F.person);
 const own=await F.account(db,'employeeRead',{from:previous.from,to:previous.to},F.worker);assert.equal(own.status,200,JSON.stringify(own));assert.deepEqual(own.body.shifts.map(shift=>[shift.id,shift.date,shift.start,shift.end,shift.plannedBreakMinutes]),[['night@2026-11-01','2026-11-01','22:00','06:00',30]]);assert.equal(own.body.shifts[0].note,undefined);
 const monday=await F.account(db,'employeeRead',{from:following.from,to:following.to},F.worker);assert.equal(monday.status,200);assert.deepEqual(monday.body.shifts.map(shift=>shift.id),['night@2026-11-01']);
 const options={db,workspaceId:workspaceId(db),personId:F.person,from:following.from,to:following.to};
 assert.deepEqual((await Published.readPublishedEmployeePage(options)).shifts,[]);
 assert.deepEqual((await Published.readPublishedEmployeePage({...options,overlap:true})).shifts.map(shift=>shift.id),['night@2026-11-01']);
 assert.deepEqual((await Published.readPublishedTimeShifts({...options,overlap:true})).map(shift=>shift.id),['night@2026-11-01']);
 const detail=await F.account(db,'employeeShift',{shiftId:'night@2026-11-01'},F.worker);assert.equal(detail.status,200);assert.equal(detail.body.shift.note,'Private night instructions');
});

test('publishing the following week retains Sunday night in its original scope and version',async t=>{
 const {db}=await setupNight();t.after(()=>db.sqlite.close());assert.equal((await publish(db)).status,200);
 const before=db.sqlite.prepare('SELECT * FROM workspace_published_shifts WHERE id=?').get('night@2026-11-01');
 assert.equal((await publish(db,following)).status,200);
 assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_published_shifts WHERE id=?').get('night@2026-11-01'),before);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_published_shifts WHERE deleted=0').get().n,1);
});

test('publication checks both neighboring days and all sites while adjacent end/start times remain valid',async t=>{
 for(const reversed of [false,true])await t.test(reversed?'Monday first':'Sunday first',async()=>{
  const {db}=await setupNight();try{
   const day=F.shift('early',{date:'2026-11-02',site:1,start:'05:00',end:'07:00'}),saved=await F.save(db,await fresh(db),next=>{next.edits.early=day;});assert.equal(saved.status,200,JSON.stringify(saved));
   const monday={...following,siteIds:[1]};assert.equal((await publish(db,reversed?monday:previous)).status,200);
   const failed=await publish(db,reversed?previous:monday);assert.equal(failed.status,400,JSON.stringify(failed));assert.equal(failed.body.error,'publication_conflict');
   const repaired=await F.save(db,await fresh(db),next=>{next.edits.early.start='06:00';});assert.equal(repaired.status,200);if(reversed)assert.equal((await publish(db,monday)).status,200);const valid=await publish(db,reversed?previous:monday);assert.equal(valid.status,200,JSON.stringify(valid));
  }finally{db.sqlite.close();}
 });
});

test('approved absence on the next day blocks overnight publication but not a midnight ending',async t=>{
 for(const end of ['06:00','00:00'])await t.test(end,async()=>{
  const {db}=await setupNight();try{
   const changed=await F.save(db,await fresh(db),next=>{next.series[0].end=end;});assert.equal(changed.status,200);
   const created=await F.account(db,'leaveCreate',{personId:F.person,from:following.from,to:following.from,type:'Ferie',comment:''});assert.equal(created.status,200,JSON.stringify(created));
   const entry=created.body.request,approved=await F.account(db,'leaveDecide',{id:entry.id,version:entry.version,status:'approved'});assert.equal(approved.status,200,JSON.stringify(approved));
   const result=await publish(db);assert.equal(result.status,end==='06:00'?400:200,JSON.stringify(result));if(end==='06:00')assert.equal(result.body.error,'publication_leave');
  }finally{db.sqlite.close();}
 });
});

test('weekly and monthly time budgets split net minutes across midnight without fetching whole schedules',async t=>{
 const {db}=await setupNight({workspaceSettings:{workHoursBudget:{period:'week',hours:40}}});t.after(()=>db.sqlite.close());
 let read=await F.account(db,'publicationBudgetRead',{from:previous.from,to:following.to});assert.equal(read.status,200,JSON.stringify(read));assert.deepEqual(read.body.budget.periods.map(period=>period.plannedMinutes),[120,330]);
 const saved=await F.save(db,await fresh(db),next=>{next.workspaceSettings.workHoursBudget.period='month';next.series[0].startDate='2026-10-31';next.series[0].endDate='2026-10-31';next.series[0].weekdays=[5];});assert.equal(saved.status,200,JSON.stringify(saved));
 read=await F.account(db,'publicationBudgetRead',{from:previous.from,to:following.to});assert.equal(read.status,200,JSON.stringify(read));assert.deepEqual(read.body.budget.periods.map(period=>[period.from,period.plannedMinutes]),[['2026-10-01',120],['2026-11-01',330]]);
 const id=workspaceId(db),at='2026-01-01T00:00:00.000Z',agreement={currency:'DKK',agreements:[{id:'hourly',from:'2026-01-01',type:'hourly',amountCents:18000}],supplements:[]};db.sqlite.prepare('INSERT INTO workspace_payroll VALUES (?,?,?,?,?,?,?)').run(id,F.person,JSON.stringify(agreement),1,F.owner.id,at,'night-rate');
 const costs=await F.account(db,'planningCostRead',{from:previous.from,to:following.to});assert.equal(costs.status,200,JSON.stringify(costs));assert.equal(costs.body.weeks.reduce((sum,week)=>sum+week.totalCents,0),135000);
 const sunday=await F.save(db,await fresh(db),next=>{next.series[0].startDate='2026-11-01';next.series[0].endDate='2026-11-01';next.series[0].weekdays=[6];});assert.equal(sunday.status,200);
 const weeklyCosts=await F.account(db,'planningCostRead',{from:previous.from,to:following.to});assert.equal(weeklyCosts.status,200,JSON.stringify(weeklyCosts));assert.deepEqual(weeklyCosts.body.weeks.map(week=>week.totalCents),[36000,99000]);
});

test('calendar neighbors contain compact pauses but never gain writable rows, versions or instruction payloads',async t=>{
 const {db}=await setupNight();t.after(()=>db.sqlite.close());assert.equal((await publish(db)).status,200);
 const {result,pages}=await window(db);assert.equal(result.studio.edits['night@2026-11-01'],undefined);
 // A recurring template may intersect only the adjacent day; it remains
 // read-only availability rather than part of the calendar's version set.
 assert.equal(result.planning.versions[Planning.key('series','night')],undefined);
 assert.ok(result.availability.series.some(series=>series.id==='night'&&series.plannedBreakMinutes===30));
 assert.ok(result.availability.published.some(shift=>shift.id==='night@2026-11-01'&&shift.plannedBreakMinutes===30));
 const payload=JSON.stringify(pages);assert.equal(payload.includes('Private night instructions'),false);assert.ok(pages.every(page=>page.records.length+page.publicationRows.length+page.auxRows.length<=1000));
});

test('large neighbor calendars stay paginated, read-only and pinned to the absence generation',async t=>{
 const edits=Object.fromEntries(Array.from({length:1200},(_,index)=>{const id='neighbor-'+String(index).padStart(4,'0');return [id,F.shift(id,{date:'2026-11-01',start:'22:00',end:'06:00',person:'',plannedBreakMinutes:15})];}));
 const {db}=await F.setup({calendarAnchor:previous.from,edits,series:[],weekPlans:{}});t.after(()=>db.sqlite.close());const {result,pages}=await window(db);
 assert.ok(pages.length>=3);assert.equal(Object.keys(result.availability.edits).length,1200);assert.deepEqual(result.planning.versions,{});assert.deepEqual(result.studio.edits,{});assert.ok(pages.every(page=>page.auxRows.length<=500&&page.records.length+page.publicationRows.length+page.auxRows.length<=1000));
 const endpoint='/api/studio?projection=calendar&instructions=deferred&from='+following.from+'&to='+following.to,firstResponse=await Workspace.handleWorkspaceStudioRequest(F.request('GET',undefined,F.owner,endpoint),db),first=await firstResponse.json();assert.equal(firstResponse.status,200);assert.ok(first.nextCursor);
 assert.equal(db.sqlite.prepare('UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=?').run(workspaceId(db)).changes,1);
 const changed=await Workspace.handleWorkspaceStudioRequest(F.request('GET',undefined,F.owner,endpoint+'&cursor='+encodeURIComponent(first.nextCursor)),db),body=await changed.json();assert.equal(changed.status,409);assert.equal(body.records,undefined);assert.equal(body.auxRows,undefined);
});

test('scoped planner checks a private next-day collision without exposing the neighboring department',async t=>{
 const {db}=await setupNight();t.after(()=>db.sqlite.close());
 const saved=await F.save(db,await fresh(db),next=>{next.edits.privateEarly=F.shift('privateEarly',{date:'2026-11-02',site:1,start:'05:00',end:'07:00',note:'PRIVATE NEIGHBOR INSTRUCTIONS'});});assert.equal(saved.status,200);assert.equal((await publish(db,{...following,siteIds:[1]})).status,200);
 const invite=await F.account(db,'invite',{email:F.planner.email,roleId:'planner',accessScope:{mode:'departments',departmentIds:['dep-nord']}});assert.equal(invite.status,200);assert.equal((await F.account(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},F.planner)).status,200);
 const projection={mode:'publication',...previous,calendar:{from:previous.from,to:previous.to}},collector=Window.collector(projection);let cursor=null;do{const endpoint='/api/studio?projection=publication&instructions=deferred&selection='+encodeURIComponent(JSON.stringify(projection))+(cursor?'&cursor='+encodeURIComponent(cursor):''),response=await Workspace.handleWorkspaceStudioRequest(F.request('GET',undefined,F.planner,endpoint),db),page=await response.json();assert.equal(response.status,200,JSON.stringify(page));cursor=collector.add(page);}while(cursor);const view=collector.finish();assert.equal(JSON.stringify(view).includes('PRIVATE NEIGHBOR INSTRUCTIONS'),false);assert.equal(view.availability.published.some(shift=>shift.id==='privateEarly'),false);
 const revision=db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(F.owner.id).revision,foreign=db.sqlite.prepare('SELECT version,write_token,config FROM workspace_published_shifts WHERE id=?').get('privateEarly'),body={revision:view.revision,directoryRevision:view.directory.revision,commandReceipt:'records',studio:Planning.payloadStudio(view.studio),projection,planning:{version:1,changes:[],metadataChanged:false,metadataBase:view.planning.metadataHash,dependencies:Planning.dependencies(view.studio,[],view.planning.versions)},publication:previous},response=await F.api(db,'PUT',body,F.planner);
 assert.equal(response.status,400,JSON.stringify(response));assert.equal(response.body.error,'publication_conflict');assert.equal(JSON.stringify(response.body).includes('PRIVATE NEIGHBOR INSTRUCTIONS'),false);assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id=?').get(F.owner.id).revision,revision);assert.deepEqual(db.sqlite.prepare('SELECT version,write_token,config FROM workspace_published_shifts WHERE id=?').get('privateEarly'),foreign);
});
