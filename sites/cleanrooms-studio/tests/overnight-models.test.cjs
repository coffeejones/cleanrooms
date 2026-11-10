const test=require('node:test'),assert=require('node:assert/strict');
const Series=require('../src/series-engine.js'),Actions=require('../src/schedule-actions.js'),Bulk=require('../src/bulk-actions.js'),Staffing=require('../src/staffing-engine.js'),Payroll=require('../src/payroll-model.js'),Cost=require('../src/planning-cost-model.js'),Coverage=require('../src/coverage-engine.js');
const {shiftCoreErrors,seriesCoreErrors,planningCoreErrors}=require('../lib/planning-validation.mjs');
const shift=(patch={})=>({id:'night',person:'p0',site:0,date:'2026-11-01',start:'22:00',end:'06:00',plannedBreakMinutes:30,note:'',...patch});
const series=(patch={})=>({id:'night-series',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-08',weekdays:[0,6],start:'22:00',end:'06:00',plannedBreakMinutes:30,note:'',...patch});
const wage=(agreements=[{id:'base',from:'2026-01-01',type:'hourly',amountCents:12000}],supplements=[])=>({currency:'DKK',agreements,supplements});
const allowance=patch=>({id:'night-extra',name:'Nat',from:'2026-01-01',to:null,type:'hourly',amountCents:3000,weekdays:[6],start:'22:00',end:'06:00',...patch});

test('overnight civil intervals cross week/month/year once, exclude a midnight-only next day, and reject 24-hour ambiguity',()=>{
 const night=shift();assert.equal(Series.shiftEndDate(night),'2026-11-02');assert.deepEqual(Series.shiftDates(night),['2026-11-01','2026-11-02']);assert.equal(Series.plannedMinutes(night),450);
 assert.equal(Series.plannedMinutesInRange(night,'2026-10-26','2026-11-01'),120);assert.equal(Series.plannedMinutesInRange(night,'2026-11-02','2026-11-08'),330);assert.equal(Series.plannedMinutesInRange(night,'2026-11-03','2026-11-08'),0);
 assert.equal(Series.shiftInterval(shift({date:'9999-12-31'})),null);assert.equal(Series.shiftEndDate(shift({date:'2100-12-31'})),'2101-01-01');
 assert.equal(Series.shiftEndDate(shift({date:'2026-12-31'})),'2027-01-01');assert.deepEqual(Series.shiftDates(shift({end:'00:00'})),['2026-11-01']);assert.equal(Series.plannedMinutesInRange(shift({end:'00:00'}),'2026-11-02','2026-11-02'),0);
 assert.equal(Series.shiftInterval(shift({end:'22:00'})),null);assert.equal(Series.shiftInterval(shift({date:'2026-02-30'})),null);assert.ok(shiftCoreErrors(shift({end:'22:00'})).length);assert.deepEqual(shiftCoreErrors(night),[]);assert.deepEqual(shiftCoreErrors({...night,endDate:'2026-11-02'}),[]);assert.ok(shiftCoreErrors({...night,endDate:'2026-11-03'}).some(error=>error.includes('slutdato')));assert.deepEqual(seriesCoreErrors(series()),[]);
 const dst=shift({date:'2026-10-24'});assert.equal((Series.shiftInterval(dst).end-Series.shiftInterval(dst).start)/60000,480,'Planning is civil-clock arithmetic; actual clock instants stay in attendance.');
});

test('night series day overrides retain start-date occurrence IDs and planned pauses',()=>{
 const input=series({dayTimes:{'0':{start:'23:00',end:'05:00',plannedBreakMinutes:15}}}),before=JSON.stringify(input),rows=Series.enumerate(input);
 assert.deepEqual(rows.map(row=>[row.id,row.date,row.start,row.end,Series.plannedMinutes(row)]),[['night-series@2026-10-26','2026-10-26','23:00','05:00',345],['night-series@2026-11-01','2026-11-01','22:00','06:00',450],['night-series@2026-11-02','2026-11-02','23:00','05:00',345],['night-series@2026-11-08','2026-11-08','22:00','06:00',450]]);
 assert.equal(JSON.stringify(input),before);assert.ok(Series.validate(series({dayTimes:{'0':{start:'22:00',end:'22:00'}}})).length);assert.ok(Series.validate(series({plannedBreakMinutes:480})).length);
});

test('conflicts detect a previous-night assignment and only report each overlapping pair once',()=>{
 const night=shift({plannedBreakMinutes:0}),early=shift({id:'early',date:'2026-11-02',start:'05:00',end:'07:00'}),touch=shift({id:'touch',date:'2026-11-02',start:'06:00',end:'08:00'});
 assert.equal(Series.conflicts([early],[night]).length,1);assert.equal(Series.conflicts([night],[early]).length,1);assert.deepEqual(Series.conflicts([night],[touch]),[]);
 const sameNight=shift({id:'other',start:'23:00',end:'05:00'});assert.equal(Series.conflicts([night],[sameNight]).length,1);assert.deepEqual(Series.conflicts([night],[sameNight],['other']),[]);
 assert.deepEqual(Series.conflicts([night],[{...early,person:'p1'}]),[]);
});

test('group, bulk and move planning accept nights but enforce next-day leave and conflicts',()=>{
 const night=shift({date:'2026-10-31'}),early=shift({id:'early',date:'2026-11-02',start:'05:30',end:'07:00'});
 assert.equal(Actions.planGroup({members:[night],existing:[night],start:'23:00',end:'05:00'}).ok,true);
 assert.equal(Actions.planMove({shift:night,current:night,targetDate:'2026-11-01',existing:[night,early]}).allowed,false);
 const blockedDates=[{person:'p0',date:'2026-11-02'}];assert.equal(Actions.planMove({shift:night,current:night,targetDate:'2026-11-01',existing:[night],blockedDates}).allowed,false);
 const copied=Bulk.plan({members:[night],existing:[night],operation:'copy',offsetDays:1,copyIds:{night:'copy'},blockedDates});assert.equal(copied.ok,false);assert.ok(copied.issues.some(issue=>issue.code==='leave'));
 const available=Bulk.plan({members:[night],existing:[night],operation:'copy',offsetDays:2,copyIds:{night:'copy'}});assert.equal(available.ok,true);assert.equal(available.proposed[0].end,'06:00');
});

test('weekly staffing splits paid night hours and carries next-day availability and pending warnings',()=>{
 const night=shift(),person={id:'p0',target:4},base={person,proposed:[night],existing:[],weekStart:'2026-10-26'};
 const result=Staffing.assess(base);assert.equal(result.available,true);assert.equal(result.projectedMinutes,120);assert.equal(result.weekCount,2);assert.deepEqual(result.overTargetWeeks,[{weekStart:'2026-11-02',projectedMinutes:330,targetMinutes:240}]);
 assert.equal(Staffing.assess({...base,blockedDates:[{person:'p0',date:'2026-11-02'}]}).available,false);
 assert.equal(Staffing.assess({...base,pendingRequests:[{person:'p0',date:'2026-11-02',id:'pending'}]}).pendingRequests.length,1);
});

test('planned payroll uses each workday rate, midnight allowance anchors and end-allocated breaks',()=>{
 const config=wage([{id:'old',from:'2026-01-01',type:'hourly',amountCents:12000},{id:'new',from:'2026-11-02',type:'hourly',amountCents:18000}],[allowance()]),night=shift(),result=Payroll.estimate({config,personId:'p0',month:'2026-11',shifts:[night]});
 assert.equal(result.minutes,450);assert.equal(result.baseCents,123000);assert.equal(result.supplementCents,22500);assert.equal(result.totalCents,145500);assert.deepEqual(result.shifts[0].dayParts.map(part=>[part.date,part.minutes,part.baseCents,part.supplementCents]),[['2026-11-01',120,24000,6000],['2026-11-02',330,99000,16500]]);
 assert.equal(result.shifts[0].totalCents,result.shifts[0].dayParts.reduce((sum,part)=>sum+part.totalCents,0));
});

test('month clipping includes previous-month night carry-in without duplicating minutes or fixed salaries',()=>{
 const night=shift({date:'2026-10-31'}),config=wage(),oct=Payroll.estimate({config,personId:'p0',month:'2026-10',shifts:[night]}),nov=Payroll.estimate({config,personId:'p0',month:'2026-11',shifts:[night]});
 assert.equal(oct.minutes,120);assert.equal(nov.minutes,330);assert.equal(oct.baseCents+nov.baseCents,90000);assert.equal(oct.plannedBreakMinutes+nov.plannedBreakMinutes,30);assert.equal(nov.shifts[0].date,'2026-10-31');
 const monthly=wage([{id:'monthly',from:'2026-01-01',type:'monthly',amountCents:3000000}]);assert.equal(Payroll.estimate({config:monthly,personId:'p0',month:'2026-11',shifts:[night]}).baseCents,3000000);
 const missing=Payroll.estimate({config:wage([{id:'late',from:'2026-11-02',type:'hourly',amountCents:12000}]),personId:'p0',month:'2026-11',shifts:[shift()]});assert.deepEqual(missing.uncoveredDates,['2026-11-01']);assert.equal(missing.complete,false);
});

test('weekly planning cost allocates a single night once per touched week and carries prior-start days into the visible range',()=>{
 const night=shift(),people=[{personId:'p0',name:'Freja',payroll:wage([],[])}],config=wage(undefined,[allowance()]);people[0].payroll=config;
 const [before,after]=Cost.estimate({from:'2026-10-26',to:'2026-11-08',people,shifts:[night,night]});assert.deepEqual([before.minutes,after.minutes],[120,330]);assert.deepEqual([before.totalCents,after.totalCents],[30000,82500]);assert.deepEqual([before.shiftCount,after.shiftCount],[1,1]);assert.equal(after.people[0].shiftCount,1);
 const carry=Cost.estimate({from:'2026-11-02',to:'2026-11-08',people,shifts:[night]})[0];assert.equal(carry.minutes,330);assert.equal(carry.totalCents,82500);
 const monthEdge=Cost.estimate({from:'2026-10-26',to:'2026-11-01',people,shifts:[shift({date:'2026-10-31'})]})[0];assert.equal(monthEdge.minutes,450);assert.equal(monthEdge.people[0].shiftCount,1);
});

test('night demand coverage uses the next workday absence and adjacent recurring rules reject real overlap',()=>{
 const night=shift({plannedBreakMinutes:0}),rule={id:'demand',site:0,weekdays:[6],start:'22:00',end:'06:00',required:1},base={rules:[rule],from:'2026-11-01',to:'2026-11-01',shifts:[night]};
 const covered=Coverage.coverage(base);assert.equal(covered.valid,true);assert.equal(covered.totals.coveredMinutes,480);assert.equal(covered.totals.deficitMinutes,0);
 const absent=Coverage.coverage({...base,blockedDates:[{person:'p0',date:'2026-11-02'}]});assert.equal(absent.totals.coveredMinutes,120);assert.equal(absent.totals.deficitMinutes,360);assert.equal(absent.slots[0].segments[1].date,'2026-11-02');
 assert.equal(Coverage.expand({...base,rules:[rule,{id:'early',site:0,weekdays:[0],start:'05:00',end:'07:00',required:1}]}).valid,false);
 assert.equal(Coverage.expand({...base,rules:[rule,{id:'touch',site:0,weekdays:[0],start:'06:00',end:'07:00',required:1}]}).valid,true);
});


test('changed planning records enforce inferred end dates while untouched legacy recovery data remains readable',()=>{
 const legacy=shift({endDate:'2026-11-03'}),before={series:[],edits:{night:legacy},weekPlans:{}};
 assert.deepEqual(planningCoreErrors(before,before),[]);assert.ok(planningCoreErrors({...before,edits:{night:{...legacy,note:'Changed'}}},before).some(error=>error.includes('slutdato')));
 const source=shift({date:'2026-10-31',endDate:'2026-11-01'}),moved=Actions.planMove({shift:source,current:source,targetDate:'2026-11-01',existing:[source]});assert.equal(moved.allowed,true);assert.equal(moved.proposed.endDate,'2026-11-02');assert.deepEqual(shiftCoreErrors(moved.proposed),[]);
 const changed=Actions.planGroup({members:[source],existing:[source],start:'07:00',end:'15:00'});assert.equal(changed.ok,true);assert.equal(changed.proposed[0].endDate,'2026-10-31');
});

test('publication change summaries and transfer templates accept night shifts without instructions or a duplicate date field',()=>{
 const Workflow=require('../src/shift-workflow-model.js'),night=shift(),at='2026-10-30T12:00:00.000Z',messages=Workflow.publicationMessages(undefined,[],[night],{at,sites:[{name:'Kontor'}]});assert.deepEqual(Workflow.validate(messages),[]);assert.equal(messages.notifications[0].after.end,'06:00');assert.equal(messages.notifications[0].after.date,'2026-11-01');assert.equal(Object.hasOwn(messages.notifications[0].after,'endDate'),false);
 const changed=Workflow.publicationMessages(messages,[night],[{...night,start:'23:00',end:'07:00'}],{at,sites:[{name:'Kontor'}]});assert.deepEqual(Workflow.validate(changed),[]);assert.equal(changed.notifications.at(-1).kind,'changed');
 for(const patch of [{end:'22:00'},{plannedBreakMinutes:480},{date:'2026-02-30'}]){const invalid=structuredClone(messages);Object.assign(invalid.notifications[0].after,patch);assert.ok(Workflow.validate(invalid).length);}
});
