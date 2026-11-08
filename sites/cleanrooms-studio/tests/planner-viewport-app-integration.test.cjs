const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../src/publication-budget.js');
const clone=value=>JSON.parse(JSON.stringify(value)),settle=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};

// Reuse the DOM fixture while exercising the actual app's viewport, painting,
// editor and action guards. The network boundary is deliberately controllable.
const file=fs.readFileSync(path.join(__dirname,'series-editor-integration.test.cjs'),'utf8'),end=file.indexOf('\ntest(');assert.ok(end>0);
let fixture=file.slice(0,end);
const replace=(before,after)=>{assert.ok(fixture.includes(before),before);fixture=fixture.replace(before,after);};
replace('let publicationControls=null;const reviewed=[];','let publicationControls=null;const reviewed=[],boards=[];');
replace('CleanRoomsCalendar:{revealDay(){}},','CleanRoomsPublicationBudget:globalThis.CleanRoomsPublicationBudget,fixtureCalendarBoards:boards,CleanRoomsCalendar:{revealDay(){},render:options=>{boards.push(options);return {element:new Element(),dispose(){}};}},');
replace('state,openEditor,openSeriesEditor,','state,sites:()=>sites,setDirectory:value=>{directory=value;},syncCalendarBudget,usesViewportCalendar,acceptVisibleWeeks,loadPlannerViewport,visiblePlanningProjection,calendarWeekLoaded,calendarWeekState,loadedCalendarWeeks,retryCalendarWeek,renderWeek,plannerHeader,ensureBaseWeek,withPlanningDates,moveShift,viewport:()=>clone(plannerViewport),select:ids=>{selectedIds=new Set(ids);},boards:()=>globalThis.fixtureCalendarBoards,openEditor,openSeriesEditor,');
const application=Function('require','__dirname',fixture+'\nreturn application;')(require,__dirname);
const first='2026-11-02',second='2026-11-09',third='2026-11-16',week=from=>({from,to:require('../src/planning-scope.js').add(from,6)});

function setup({cached=null,onAdopt=null,paintOnAdopt=false}={}){
 const app=application(),reads=[],scopeReads=[],adoptions=[];let current=week(first),generation='generation-1';
 Object.assign(app.state,{demoSeed:false,page:'schedule',role:'admin',view:'week',week:1,search:'',site:'all',onlyOpen:false,edits:{},deleted:[],weekPlans:{},requests:{}});
 const covers=range=>range.from>=current.from&&range.to<=current.to;
 const api={isPartial:true,coverageValid:true,get calendarGeneration(){return generation;},viewportCovers:covers,covers,coversScope:projection=>projection.mode==='calendar'&&covers(projection),
  viewport:(range,options)=>new Promise(resolve=>reads.push({range:clone(range),options,resolve,cached:api.viewportCached?.(range)===true})),scope:projection=>new Promise(resolve=>scopeReads.push({projection:clone(projection),resolve})),
  ensureFull:async()=>{assert.fail('A nearby calendar operation must not load the whole company');},window:async()=>{assert.fail('Scrolling must use the viewport service');},action:async()=>({ok:true})};
 if(cached!==null)api.viewportCached=range=>cached.some(value=>range.from>=value.from&&range.to<=value.to);
 app.installWindow(api);
 const reply=async(index,{ok=true,superseded=false,message='Offline'}={})=>{const read=reads[index];assert.ok(read);const valid=read.options.isCurrent();if(ok&&valid){current=clone(read.range);adoptions.push({index,range:clone(read.range)});if(paintOnAdopt)app.renderWeek();onAdopt?.({app,read,index});}read.resolve(ok&&valid?{ok:true}:{ok:false,superseded:superseded||!valid,message});await settle();};
 const replyScope=async index=>{const read=scopeReads[index];current=week(read.projection.from);current.to=read.projection.to;read.resolve({ok:true});await settle();};
 return {app,api,reads,scopeReads,adoptions,reply,replyScope,setCached:ranges=>{cached=ranges;},setCurrent:range=>{current=clone(range);},newGeneration:()=>{generation+='-new';}};
}

test('the initial planner authority is one week and observed scrolling requests visible plus adjacent weeks, never all eight',async()=>{
 const {app,reads,reply}=setup();assert.equal(app.usesViewportCalendar(),true);assert.deepEqual(clone(app.visiblePlanningProjection()),{mode:'calendar',...week(first)});
 assert.equal(app.needsPlanningProjection(),false);assert.equal(reads.length,0,'Painting a new navigation must wait for the actual observer, not speculate eight weeks');
 app.acceptVisibleWeeks({visible:[first],prefetch:[second]});assert.equal(reads.length,1);assert.deepEqual(reads[0].range,{from:first,to:'2026-11-15'});assert.equal(app.calendarWeekLoaded(first),true);assert.equal(app.calendarWeekLoaded(second),false);await reply(0);assert.equal(app.calendarWeekLoaded(second),true);
 app.acceptVisibleWeeks({visible:[second],prefetch:[third]});assert.equal(reads.length,2);assert.deepEqual(reads[1].range,{from:second,to:'2026-11-22'});await reply(1);assert.equal(app.calendarWeekLoaded(first),false);assert.equal(app.calendarWeekLoaded(third),true);assert.equal(app.persisted(),0);
});

test('the monthly budget waits for a shift save and switches when the visible month changes',async()=>{
 const {app,api,setCurrent}=setup();
 const december='2026-12-07';
 setCurrent({from:first,to:week(december).to});
 const requests=[];
 Object.assign(api,{ready:true,revision:1,directoryRevision:1,action:(name,range)=>new Promise(resolve=>requests.push({name,range,resolve}))});
 app.state.workspaceSettings={workHoursBudget:{period:'month',hours:100}};
 const value=app.control('#cs-calendar-budget-value');
 const answer=(index,revision,plannedMinutes)=>requests[index].resolve({ok:true,revision,directoryRevision:1,budget:{period:'month',periods:[{from:requests[index].range.from.slice(0,7)+'-01',plannedMinutes,budgetHours:100}]}});
 app.syncCalendarBudget();assert.deepEqual(clone(requests[0].range.scope),{kind:'company'});answer(0,1,4800);await settle();
 assert.equal(value.textContent,'20 t tilbage');
 api.hasPendingPlanSave=true;
 app.syncCalendarBudget();
 assert.equal(value.textContent,'Opdaterer…');assert.equal(requests.length,1);
 api.hasPendingPlanSave=false;api.revision=2;
 app.syncCalendarBudget();
 app.acceptVisibleWeeks({visible:[december],prefetch:[]});
 answer(1,2,4860);await settle();
 assert.equal(requests[2].range.from,december);assert.equal(value.textContent,'Henter…');
 answer(2,2,6300);await settle();
 assert.equal(value.textContent,'5 t over budget');
 assert.equal(app.control('#cs-calendar-budget-period').textContent,'December 2026');
});

test('year-long series cannot paint inferred shifts or zero-data authority in weeks that were never loaded',()=>{
 const {app}=setup();app.state.series=[{id:'annual',person:'p0',site:0,startDate:'2026-10-01',endDate:'2027-06-01',weekdays:[0,2,4],start:'07:00',end:'15:00',note:''}];
 assert.ok(app.shiftsInRange(second,'2026-11-15').length>0,'The fixture really can infer unloaded occurrences');app.renderWeek();const board=app.boards().at(-1);assert.ok(board.shifts.length>0);assert.ok(board.shifts.every(shift=>shift.date>=first&&shift.date<second));assert.equal(board.weeks,8);assert.equal(board.weekState(second).loaded,false);assert.equal(board.weekState(first).loaded,true);assert.equal(typeof board.onWeekRetry,'function');assert.equal(typeof board.onVisibleWeeks,'function');
});

test('an editor pins its source and preserves typed inputs while a newer scroll intent is waiting',async()=>{
 const {app,reads,reply}=setup(),shift={id:'one',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:'Original'};app.state.series=[];app.state.edits[shift.id]=shift;
 const moving=app.loadPlannerViewport({from:second,to:'2026-11-15'});assert.equal(reads.length,1);app.begin(shift);app.control('#cs-edit-start').value='08:30';assert.equal(reads[0].options.isCurrent(),false);await reply(0);assert.equal(await moving,false);assert.equal(app.active().id,shift.id);assert.equal(app.control('#cs-edit-start').value,'08:30');assert.equal(app.calendarWeekLoaded(first),true);assert.equal(app.calendarWeekLoaded(second),false);
 app.acceptVisibleWeeks({visible:[second],prefetch:[third]});assert.equal(reads.length,1,'The open form must not be evicted by its observer');assert.equal(app.persisted(),0);
});

test('page, period or selection changes reject a delayed viewport response without adopting its authority',async()=>{
 for(const change of [app=>{app.state.page='hours';},app=>{app.state.week=2;},app=>{app.select(['selected-while-loading']);}]){
  const {app,reads,reply}=setup(),moving=app.loadPlannerViewport(week(second));change(app);assert.equal(reads[0].options.isCurrent(),false);await reply(0);assert.equal(await moving,false);if(app.state.page==='schedule')assert.equal(app.calendarWeekLoaded(second),false);else assert.equal(app.usesViewportCalendar(),false);assert.equal(app.persisted(),0);
 }
});

test('a newer observed scroll supersedes an in-flight range and resumes only the latest visible weeks',async()=>{
 const {app,reads,reply}=setup();app.acceptVisibleWeeks({visible:[second],prefetch:[third]});assert.equal(reads.length,1);app.acceptVisibleWeeks({visible:[third],prefetch:['2026-11-23']});assert.equal(reads.length,1,'The app serializes the fetch while recording the newest intent');assert.equal(reads[0].options.isCurrent(),false);await reply(0);assert.equal(app.calendarWeekLoaded(third),false);assert.equal(app.needsPlanningProjection(),false);assert.equal(reads.length,2);assert.deepEqual(reads[1].range,{from:third,to:'2026-11-29'});await reply(1);assert.equal(app.calendarWeekLoaded(third),true);assert.equal(app.calendarWeekLoaded(second),false);assert.equal(app.persisted(),0);
});

test('a failed week leaves the previous week usable, exposes a retry, and does not persist an empty replacement',async()=>{
 const {app,reads,reply}=setup(),moving=app.loadPlannerViewport(week(second));await reply(0,{ok:false,message:'Gem kladden først'});assert.equal(await moving,false);assert.equal(app.calendarWeekState(first).loaded,true);assert.equal(app.calendarWeekState(second).loaded,false);assert.equal(app.calendarWeekState(second).error,'Gem kladden først');assert.equal(app.persisted(),0);
 const retry=app.retryCalendarWeek(second);assert.equal(reads.length,2);assert.equal(reads[1].options.force,true);await reply(1);assert.equal(await retry,true);assert.equal(app.calendarWeekState(second).loaded,true);assert.equal(app.calendarWeekState(second).error,'');
});

test('base-week actions load only their original week after scrolling rather than silently using the new visible week',async()=>{
 const {app,scopeReads,setCurrent,replyScope}=setup();setCurrent(week(third));let called=0;const opening=app.ensureBaseWeek(()=>{called++;return 'opened';});assert.equal(called,0);assert.equal(scopeReads.length,1);assert.deepEqual(scopeReads[0].projection,{mode:'calendar',...week(first)});await replyScope(0);assert.equal(await opening,'opened');assert.equal(called,1);assert.equal(app.persisted(),0);
});

test('nearby drag validation waits for source and target weeks and keeps the shift unchanged on failed scope loading',async()=>{
 const {app,scopeReads}=setup(),shift={id:'drag-one',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:'Keep these instructions'};app.state.series=[];app.state.edits[shift.id]=clone(shift);
 const moving=app.moveShift(shift,'2026-11-17');assert.equal(scopeReads.length,1);assert.deepEqual(scopeReads[0].projection,{mode:'calendar',from:first,to:'2026-11-22'});assert.equal(app.state.edits[shift.id].date,shift.date);scopeReads[0].resolve({ok:false,message:'Could not load target'});await settle();assert.equal(await moving,false);assert.deepEqual(clone(app.state.edits[shift.id]),shift);assert.equal(app.persisted(),0);
});

test('header counters become unknown after unseen authority changes instead of reporting zero changes for an unloaded base week',()=>{
 const {app,setCurrent,newGeneration}=setup();setCurrent(week(third));const unknown=app.plannerHeader();assert.equal(unknown.changes,null);assert.equal(unknown.drift,null);newGeneration();assert.equal(app.plannerHeader().changes,null);
});

test('scroll batches remain bounded to the visual calendar and reusable only while the same planner context and selection survive',async()=>{
 const {app,reads,reply}=setup();const moving=app.loadPlannerViewport(week(second));assert.deepEqual(clone(reads[0].options.bounds),{from:first,to:'2026-12-27'});assert.equal(reads[0].options.canRetain(),true);
 app.acceptVisibleWeeks({visible:[third],prefetch:['2026-11-23']});assert.equal(reads[0].options.isCurrent(),false);assert.equal(reads[0].options.canRetain(),true,'Scrolling alone may retain a fully validated private batch');
 app.select(['a-new-selection']);assert.equal(reads[0].options.canRetain(),false,'A late response must not evict newly selected records');await reply(0);assert.equal(await moving,false);assert.equal(app.persisted(),0);
});

test('page changes and opening a form cancel both viewport adoption and background batch reuse',async()=>{
 for(const change of [app=>{app.state.page='hours';},app=>{app.state.week=2;},app=>{app.begin({id:'form',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:''});}]){
  const {app,reads,reply}=setup(),moving=app.loadPlannerViewport(week(second));change(app);assert.equal(reads[0].options.isCurrent(),false);assert.equal(reads[0].options.canRetain(),false);await reply(0);assert.equal(await moving,false);assert.equal(app.persisted(),0);
 }
});


test('cached visible weeks paint before a held neighbor request while both steps share the original epoch and busy state',async()=>{
 const {app,reads,reply,adoptions}=setup({cached:[week(second)],paintOnAdopt:true});app.state.series=[];app.state.edits.visible={id:'visible',person:'p0',site:0,date:'2026-11-10',start:'07:00',end:'15:00',note:'Visible cached source'};
 app.acceptVisibleWeeks({visible:[second],prefetch:[third]});assert.equal(reads.length,1);assert.equal(reads[0].cached,true);assert.deepEqual(reads[0].range,week(second));const epoch=app.viewport().epoch;assert.equal(app.viewport().busy,true);
 await reply(0);assert.equal(reads.length,2);assert.deepEqual(reads[1].range,{from:second,to:'2026-11-22'});assert.equal(reads[1].cached,false);assert.equal(app.viewport().busy,true);assert.equal(app.viewport().epoch,epoch);assert.equal(reads[0].options.isCurrent(),true);assert.equal(reads[1].options.isCurrent(),true);assert.equal(app.calendarWeekLoaded(second),true);assert.equal(app.calendarWeekLoaded(third),false);assert.deepEqual(app.boards().at(-1).shifts.map(shift=>shift.id),['visible']);assert.deepEqual(adoptions,[{index:0,range:week(second)}]);
 await reply(1);assert.equal(app.viewport().busy,false);assert.equal(app.calendarWeekLoaded(third),true);assert.equal(reads.length,2);assert.equal(app.persisted(),0);
});

test('a failed neighbor read preserves the immediately adopted visible week and exposes only unloaded-week retry state',async()=>{
 const {app,reads,reply,adoptions}=setup({cached:[week(second)]});app.acceptVisibleWeeks({visible:[second],prefetch:[third]});await reply(0);assert.equal(reads.length,2);assert.equal(app.calendarWeekLoaded(second),true);await reply(1,{ok:false,message:'Neighbor unavailable'});
 assert.equal(app.calendarWeekState(second).loaded,true);assert.equal(app.calendarWeekState(third).loaded,false);assert.equal(app.calendarWeekState(third).error,'Neighbor unavailable');assert.equal(app.viewport().busy,false);assert.deepEqual(adoptions,[{index:0,range:week(second)}]);assert.equal(app.persisted(),0);
});

test('the immediate cache target includes selected source weeks instead of evicting a selection to fetch the visible week',async()=>{
 const {app,reads,reply}=setup({cached:[{from:first,to:'2026-11-15'}]});app.state.series=[];app.state.edits.selected={id:'selected',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:'Selected source'};app.select(['selected']);
 app.acceptVisibleWeeks({visible:[second],prefetch:[third]});assert.deepEqual(reads[0].range,{from:first,to:'2026-11-15'});assert.equal(reads[0].cached,true);await reply(0);assert.equal(app.calendarWeekLoaded(first),true);assert.equal(app.calendarWeekLoaded(second),true);assert.deepEqual(reads[1].range,{from:first,to:'2026-11-22'});await reply(1);assert.equal(app.calendarWeekLoaded(first),true);assert.equal(app.persisted(),0);
});

test('new page, period, editor, selection or scroll intent between cache adoption and neighbor loading cancels the old second step',async()=>{
 const changed=[['page',app=>{app.state.page='hours';}],['period',app=>{app.state.week=2;}],['editor',app=>{app.begin(app.state.edits.visible);app.control('#cs-edit-start').value='09:45';}],['selection',app=>{app.select(['visible']);}],['scroll',app=>{app.acceptVisibleWeeks({visible:[third],prefetch:['2026-11-23']});}]];
 for(const [name,change]of changed){const {app,reads,reply,adoptions}=setup({cached:[week(second)],onAdopt:({app,index})=>{if(index===0)change(app);}});app.state.series=[];app.state.edits.visible={id:'visible',person:'p0',site:0,date:'2026-11-10',start:'07:00',end:'15:00',note:'Keep source'};app.acceptVisibleWeeks({visible:[second],prefetch:[third]});assert.deepEqual(reads[0].range,week(second));await reply(0);assert.equal(reads.length,1,name+': no obsolete neighbor request');assert.deepEqual(adoptions,[{index:0,range:week(second)}],name);assert.equal(app.viewport().busy,false,name);if(name==='editor'){assert.equal(app.active().id,'visible');assert.equal(app.control('#cs-edit-start').value,'09:45');}if(name==='scroll'){assert.deepEqual(app.viewport().wanted,{from:third,to:'2026-11-29'});app.needsPlanningProjection();assert.equal(reads.length,2);assert.deepEqual(reads[1].range,{from:third,to:'2026-11-29'});await reply(1);}assert.equal(app.persisted(),0,name);}
});

test('a late second-stage neighbor response cannot replace a newer scroll or an editor opened after cached content appeared',async()=>{
 for(const mode of ['scroll','editor','selection']){const {app,reads,reply,adoptions}=setup({cached:[week(second)]});app.state.series=[];app.state.edits.visible={id:'visible',person:'p0',site:0,date:'2026-11-10',start:'07:00',end:'15:00',note:'Keep cached source'};app.acceptVisibleWeeks({visible:[second],prefetch:[third]});await reply(0);assert.equal(reads.length,2);if(mode==='scroll')app.acceptVisibleWeeks({visible:['2026-11-23'],prefetch:['2026-11-30']});if(mode==='editor'){app.begin(app.state.edits.visible);app.control('#cs-edit-start').value='10:15';}if(mode==='selection')app.select(['visible']);assert.equal(reads[1].options.isCurrent(),false);await reply(1);assert.deepEqual(adoptions,[{index:0,range:week(second)}]);assert.equal(app.calendarWeekLoaded(second),true);assert.equal(app.calendarWeekLoaded(third),false);if(mode==='editor'){assert.equal(app.active().id,'visible');assert.equal(app.control('#cs-edit-start').value,'10:15');}assert.equal(app.persisted(),0);}
});

test('week heading net hours and maxima follow the exact selected department or worksite',()=>{
 const {app}=setup();
 app.state.series=[];
 app.state.edits={
   assigned:{id:'assigned',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'09:00',plannedBreakMinutes:30},
   open:{id:'open',person:'',site:1,date:'2026-11-03',start:'10:00',end:'11:00'}
 };
 app.state.workspaceSettings={workHoursBudget:{period:'week',hours:102}};
 const sites=app.sites();
 Object.assign(sites[0],{id:'site-north',workHoursBudget:{period:'week',hours:40}});
 Object.assign(sites[1],{id:'site-clinic',workHoursBudget:{period:'week',hours:0}});
 const department={id:'selected-team',name:'Valgt afdeling',siteIds:[0],workHoursBudget:{period:'week',hours:75}};
 app.state.organization={...app.state.organization,departments:[department]};
 const total=()=>{
   app.renderWeek();
   return clone(app.boards().at(-1).weekHours(first));
 };
 assert.deepEqual(total(),{plannedMinutes:150,budgetHours:102,scopeLabel:'Hele virksomheden'});
 app.state.site='0';
 assert.deepEqual(total(),{plannedMinutes:90,budgetHours:40,scopeLabel:'Kontor Nord'});
 assert.equal(app.boards().at(-1).shifts.length,1);
 app.state.site='1';
 assert.deepEqual(total(),{plannedMinutes:60,budgetHours:0,scopeLabel:'Klinikken'});
 delete sites[1].workHoursBudget;
 assert.equal(total().budgetHours,null,'a worksite without a budget never inherits the company maximum');
 app.state.departmentId='selected-team';
 assert.equal(total().plannedMinutes,0,'a worksite outside the selected department has no hours');
 app.state.site='all';
 assert.deepEqual(total(),{plannedMinutes:90,budgetHours:75,scopeLabel:'Valgt afdeling'});
 app.state.search='no matching employee';
 app.state.onlyOpen=true;
 assert.equal(total().plannedMinutes,90,'employee search and open-shift filtering do not change the area total');
 assert.equal(app.boards().at(-1).shifts.length,0);
 app.state.site='0';
 assert.deepEqual(total(),{plannedMinutes:90,budgetHours:40,scopeLabel:'Valgt afdeling · Kontor Nord'});
 app.state.site='all';department.workHoursBudget=null;
 assert.equal(total().budgetHours,null,'a department budget is explicit and is not summed from its worksites');
 department.workHoursBudget={period:'month',hours:400};
 app.state.edits.assigned.end='10:00';
 assert.deepEqual(total(),{plannedMinutes:150,budgetHours:null,scopeLabel:'Valgt afdeling'});
 app.state.departmentId='all';
 assert.equal(total().plannedMinutes,210);
 assert.equal(total().budgetHours,102);
 app.state.workspaceSettings={};
 assert.equal(total().budgetHours,null);
});

test('the monthly calendar budget reads the exact scope and changes cache authority with directory versions',async()=>{
 const {app,api}=setup(),requests=[];
 Object.assign(api,{ready:true,revision:1,directoryRevision:1,action:(name,range)=>new Promise(resolve=>requests.push({name,range,resolve}))});
 const directory={revision:2};app.setDirectory(directory);
 app.state.workspaceSettings={workHoursBudget:{period:'month',hours:900}};
 const department={id:'dep-north',name:'Nord',siteIds:[0],workHoursBudget:{period:'month',hours:200}};
 app.state.organization={...app.state.organization,departments:[department]};
 app.state.departmentId=department.id;
 const answer=(index,plannedMinutes,budgetHours,version=directory.revision)=>requests[index].resolve({ok:true,revision:1,directoryRevision:version,budget:{period:'month',periods:[{from:'2026-11-01',plannedMinutes,budgetHours}]}});
 app.syncCalendarBudget();
 assert.deepEqual(clone(requests[0].range.scope),{kind:'department',id:'dep-north'});
 answer(0,6000,200);await settle();
 assert.equal(app.control('#cs-calendar-budget-value').textContent,'100 t tilbage');
 assert.match(app.control('#cs-calendar-budget-caption').textContent,/^Nord · /);
 Object.assign(app.sites()[0],{id:'site-north',workHoursBudget:{period:'month',hours:80}});
 app.state.site='0';app.syncCalendarBudget();
 assert.deepEqual(clone(requests[1].range.scope),{kind:'site',id:'site-north'});
 answer(1,4500,80);await settle();
 assert.equal(app.control('#cs-calendar-budget-value').textContent,'5 t tilbage');
 assert.match(app.control('#cs-calendar-budget-caption').textContent,/^Nord · Kontor Nord · /);
 directory.revision=3;app.sites()[0].workHoursBudget.hours=90;
 app.syncCalendarBudget();assert.equal(requests.length,3,'a scoped edit invalidates totals without a plan revision change');
 answer(2,4500,90);await settle();
 assert.equal(app.control('#cs-calendar-budget-value').textContent,'15 t tilbage');
 app.sites()[0].workHoursBudget=null;app.syncCalendarBudget();
 assert.equal(app.control('#cs-calendar-budget').hidden,true);
 assert.equal(requests.length,3,'an unset worksite budget never falls back to the department or company');
});
