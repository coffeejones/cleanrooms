const test=require('node:test'),assert=require('node:assert/strict');
const Series=require('../src/series-engine.js'),Planner=require('../src/series-planner.js'),Lifecycle=require('../src/series-lifecycle.js'),Actions=require('../src/schedule-actions.js'),Bulk=require('../src/bulk-actions.js'),Changes=require('../src/plan-changes.js'),Publication=require('../src/publication-model.js'),Data=require('../src/studio-data.js'),Staffing=require('../src/staffing-engine.js'),Roster=require('../src/roster-planning.js');
const series=patch=>({id:'pause-series',person:'p0',site:0,startDate:'2026-11-02',endDate:'2026-11-15',weekdays:[0,1,2],start:'07:00',end:'15:00',note:'Fast vagt',...patch});
const shift=patch=>({id:'one',person:'p0',site:0,date:'2026-11-02',start:'07:00',end:'15:00',note:'',...patch});

test('planned breaks inherit through a series, support weekday zero overrides and reject invalid or overlong pauses',()=>{
  const input=series({plannedBreakMinutes:30,dayTimes:{1:{start:'08:00',end:'13:00'},2:{start:'09:00',end:'13:00',plannedBreakMinutes:0}}}),before=JSON.stringify(input),shifts=Series.enumerate(input);
  assert.deepEqual(shifts.slice(0,3).map(item=>[item.start,item.end,Series.plannedBreakMinutes(item),Series.plannedMinutes(item)]),[['07:00','15:00',30,450],['08:00','13:00',30,270],['09:00','13:00',0,240]]);
  assert.equal(JSON.stringify(input),before);assert.equal(Object.hasOwn(Series.enumerate(series())[0],'plannedBreakMinutes'),false);
  for(const plannedBreakMinutes of [null,'30',-1,1.5,NaN,Infinity,480,99999])assert.ok(Series.validate(series({plannedBreakMinutes})).length,String(plannedBreakMinutes));
  assert.ok(Series.validate(series({plannedBreakMinutes:30,dayTimes:{1:{start:'08:00',end:'08:30'}}})).length,'Inherited pause must fit the shorter weekday.');
  assert.ok(Series.validate(series({dayTimes:{1:{start:'08:00',end:'13:00',plannedBreakMinutes:20,unknown:true}}})).length);
  assert.equal(Series.plannedMinutes(shift()),480);assert.equal(Series.plannedMinutes(shift({plannedBreakMinutes:30})),450);
});

test('series copies, extensions, future exceptions and previews retain pauses and detect a pause-only change',()=>{
  const source=series({plannedBreakMinutes:30,dayTimes:{1:{start:'09:00',end:'13:00',plannedBreakMinutes:15}}}),all=Series.enumerate(source),manual={...all[0],plannedBreakMinutes:45};
  const copy=Lifecycle.copyDraft(source,{id:'copy',startDate:'2026-12-01',endDate:'2026-12-31'});assert.equal(copy.ok,true);assert.equal(copy.draft.plannedBreakMinutes,30);assert.equal(copy.draft.dayTimes[1].plannedBreakMinutes,15);
  const extension=Lifecycle.extensionDraft(source,{id:'extension',months:1});assert.equal(extension.ok,true);assert.equal(extension.draft.plannedBreakMinutes,30);assert.equal(extension.draft.dayTimes[1].plannedBreakMinutes,15);
  const draft={...source,plannedBreakMinutes:20};const preview=Planner.preview({draft,source,today:'2026-11-01',edits:{[manual.id]:manual},preserve:true});
  assert.equal(preview.valid,true);assert.equal(preview.preservedCount,1);assert.equal(preview.shifts.find(item=>item.id===manual.id).plannedBreakMinutes,45);assert.ok(preview.updatedCount>0);
  const future={...draft,id:'future',startDate:all[3].date};const next=Series.preserveExceptions({source,replacement:future,scope:'future',cutoff:all[3].date,edits:{[all[3].id]:{...all[3],plannedBreakMinutes:40}},deleted:[]});
  assert.equal(next.edits['future@'+all[3].date].plannedBreakMinutes,40);
});

test('individual, time-group and bulk operations preserve pauses, reject shrinkage and capture stale pause edits',()=>{
  const original=shift({plannedBreakMinutes:30}),moved=Actions.planMove({shift:original,current:original,targetDate:'2026-11-03',existing:[original]});
  assert.equal(moved.allowed,true);assert.equal(moved.proposed.plannedBreakMinutes,30);
  assert.equal(Actions.planMove({shift:original,current:{...original,plannedBreakMinutes:45},targetDate:'2026-11-03',existing:[original]}).status,'blocked');
  const group=Actions.planGroup({members:[original],existing:[original],start:'09:00',end:'09:30'});assert.equal(group.ok,false);assert.equal(group.issues[0].code,'break');
  const copied=Bulk.plan({members:[original],existing:[original],operation:'copy',offsetDays:1,copyIds:{one:'copy'}});assert.equal(copied.ok,true);assert.equal(copied.proposed[0].plannedBreakMinutes,30);
  assert.equal(Bulk.plan({members:[original],existing:[{...original,plannedBreakMinutes:15}],operation:'move',offsetDays:1}).ok,false);
  assert.equal(Bulk.plan({members:[original],existing:[original],operation:'time',start:'10:00',end:'10:20'}).ok,false);
});

test('publication and ordinary expansion preserve planned pauses and pause-only changes require publishing',()=>{
  const original=shift({plannedBreakMinutes:30}),studio={storageVersion:1,demoSeed:false,series:[],edits:{one:original},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}},scope={from:'2026-11-02',to:'2026-11-08',siteIds:[0],actor:{userId:'owner',name:'Planlægger'},at:'2026-11-01T12:00:00.000Z'};
  const saved=Publication.publish(studio,scope).studio;assert.equal(Publication.publishedShifts(saved)[0].plannedBreakMinutes,30);assert.equal(Data.shiftsInRange(scope.from,scope.to,saved)[0].plannedBreakMinutes,30);
  const next={...saved,edits:{one:{...original,plannedBreakMinutes:45}}};assert.equal(Publication.scopeStatus(next,scope).published,false);assert.deepEqual(Changes.diff([original],[next.edits.one])[0].fields,['plannedBreakMinutes']);
  assert.equal(Publication.publishedShifts(next)[0].plannedBreakMinutes,30);assert.equal(Publication.publishedShifts(Publication.publish(next,scope).studio)[0].plannedBreakMinutes,45);
  assert.deepEqual(Changes.diff([shift()],[shift({plannedBreakMinutes:0})]),[]);
  const invalid=structuredClone(saved);Object.values(invalid.publications.slots)[0].shifts[0].plannedBreakMinutes=480;assert.ok(Publication.validate(invalid.publications).length);
});

test('staffing and employee summaries use net planned minutes while availability still covers the entire shift',()=>{
  const original=shift({plannedBreakMinutes:30}),person={id:'p0',target:7.5};const assessment=Staffing.assess({person,weekStart:'2026-11-02',proposed:[original],existing:[]});
  assert.equal(assessment.valid,true);assert.equal(assessment.projectedMinutes,450);assert.deepEqual(assessment.overTargetWeeks,[]);
  const overlap=Staffing.assess({person,weekStart:'2026-11-02',proposed:[original],existing:[shift({id:'second',start:'14:45',end:'16:00'})]});assert.equal(overlap.available,false);assert.equal(overlap.conflicts[0].type,'overlap');
  const summary=Roster.build({staff:[person],weekStart:'2026-11-02',today:'2026-11-02',horizonEnd:'2026-11-08',weeklyShifts:[original],upcomingShifts:[original]});assert.equal(summary.byPerson.p0.plannedMinutes,450);assert.equal(summary.byPerson.p0.differenceMinutes,0);
  assert.throws(()=>Roster.build({staff:[person],weekStart:'2026-11-02',today:'2026-11-02',horizonEnd:'2026-11-08',weeklyShifts:[original],upcomingShifts:[{...original,plannedBreakMinutes:45}]}),/forskellige planlagte pauser/);
});
