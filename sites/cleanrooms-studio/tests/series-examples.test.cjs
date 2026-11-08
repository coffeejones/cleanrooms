const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Examples=require('../src/series-examples.js');
const Engine=require('../src/series-engine.js');
const Lifecycle=require('../src/series-lifecycle.js');
const Data=require('../src/studio-data.js');
const Checklist=require('../src/checklist-progress.js');
const today='2026-10-31';
const plain=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return value;};
const add=(day,n)=>{const value=new Date(day+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+n);return value.toISOString().slice(0,10);};
const base=()=>({series:[{id:'jonas-plan',person:'p0',site:0,startDate:'2026-10-26',endDate:'2027-04-26',weekdays:[1,3],start:'07:00',end:'15:00',note:''}],edits:{},deleted:[],weekPlans:{},requests:{},publications:{version:1,sequence:0,slots:{},records:[]},checklistProgress:{}});

test('five agreements contain seven valid phases with varied clocks, contiguous periods and clear fresh checklist descriptions',()=>{
  const made=Examples.create({today});assert.equal(made.groups.length,5);assert.equal(made.series.length,7);assert.deepEqual(Lifecycle.validate(made.series),[]);
  assert.ok(made.groups.every(group=>group.id.startsWith('demo-series-')&&group.phaseIds.every(id=>id.startsWith('demo-series-'))));
  const varied=made.series.find(phase=>phase.groupId==='demo-series-varied'),shifts=Engine.enumerate(varied);
  assert.deepEqual(shifts.slice(0,3).map(({date,start,end})=>({date,start,end})),[{date:'2026-10-26',start:'16:00',end:'19:00'},{date:'2026-10-28',start:'17:00',end:'20:00'},{date:'2026-10-30',start:'15:00',end:'18:00'}]);
  const periods=made.series.filter(phase=>phase.groupId==='demo-series-periods');assert.deepEqual(periods.map(phase=>[phase.startDate,phase.endDate]),[['2026-10-05','2026-10-25'],['2026-10-26','2026-11-22'],['2026-11-23','2027-01-17']]);assert.equal(periods[2].site,2);assert.equal(periods[2].start,'19:00');
  assert.ok(made.series.every(phase=>phase.note.startsWith('Eksempel: ')));assert.ok(made.series.every(phase=>Checklist.read({},Engine.enumerate(phase)[0]).total>=2));assert.ok(made.series.every(phase=>Checklist.read({},Engine.enumerate(phase)[0]).checked===0));
});

test('all five append to the full legacy schedule without overlaps and preserve every existing data field',()=>{
  const input=freeze(base()),before=JSON.stringify(input),result=Examples.appendPlan(input,{today,staff:Data.staff});
  assert.equal(result.changed,true);assert.equal(result.added.length,5);assert.deepEqual(result.skipped,[]);assert.equal(result.series.length,8);assert.equal(result.ranges.length,7);assert.deepEqual(result.series[0],input.series[0]);assert.equal(JSON.stringify(input),before);
  const schedule=Data.shiftsInRange('2026-09-28','2027-01-17',{...input,series:result.series});assert.deepEqual(Engine.conflicts(schedule,schedule),[],'Friday Mikkel at15:00 must touch, not overlap, his existing shift ending15:00.');
  assert.equal(Object.hasOwn(result,'publications'),false);assert.equal(Object.hasOwn(result,'checklistProgress'),false);
});

test('repeated installation preserves user changes, partial deletions and stable identities across different dates',()=>{
  const installed=Examples.appendPlan(base(),{today}),input={...base(),series:installed.series};
  input.series=input.series.filter(phase=>phase.id!=='demo-series-periods-past'&&phase.id!=='demo-series-expiring-1');
  input.series.find(phase=>phase.id==='demo-series-periods-current').note='User edited this phase';
  input.deleted.push('demo-series-expiring-1@2026-10-30');
  const before=JSON.stringify(input),result=Examples.appendPlan(input,{today:'2027-01-15'});
  assert.equal(result.changed,false);assert.equal(result.existing.length,5);assert.deepEqual(result.added,[]);assert.deepEqual(result.skipped,[]);assert.deepEqual(result.series,input.series);assert.equal(JSON.stringify(input),before);
  assert.ok(!result.series.some(phase=>phase.id==='demo-series-periods-past'));assert.equal(result.series.find(phase=>phase.id==='demo-series-periods-current').note,'User edited this phase');
});

test('a custom phase group or retained occurrence edit prevents recreating a partially existing agreement',()=>{
  const made=Examples.create({today}),current=made.series.find(phase=>phase.id==='demo-series-periods-current');
  const input={...base(),series:[{...current,id:'user-renamed-phase',note:'Custom period'}],edits:{standalone:{id:'standalone',seriesId:'demo-series-upcoming-1',person:'p10',site:1,date:'2026-11-10',start:'16:00',end:'19:00',note:'Keep this exception'}}};
  const result=Examples.appendPlan(input,{today});assert.ok(result.existing.includes('demo-series-periods'));assert.ok(result.existing.includes('demo-series-upcoming'));assert.ok(!result.series.some(phase=>phase.id==='demo-series-periods-past'||phase.id==='demo-series-periods-future'||phase.id==='demo-series-upcoming-1'));assert.deepEqual(result.series[0],input.series[0]);
});

test('hidden work and a moved exception block the whole conflicting agreement across all its phases',()=>{
  const input=base();input.site='1';input.edits.hidden={id:'hidden',person:'p3',site:2,date:'2026-11-02',start:'17:00',end:'18:00',note:'Hidden other-site shift'};
  input.edits['historic@2026-09-01']={id:'historic@2026-09-01',seriesId:'historic',person:'p2',site:1,date:'2027-01-05',start:'20:00',end:'22:00',note:'Moved into the new period'};
  const result=Examples.appendPlan(input,{today});assert.deepEqual(result.skipped.map(item=>[item.id,item.code]),[['demo-series-varied','overlap'],['demo-series-periods','overlap']]);assert.equal(result.added.length,3);assert.ok(!result.series.some(phase=>phase.groupId==='demo-series-periods'||phase.groupId==='demo-series-varied'));
  assert.ok(result.skipped.find(item=>item.id==='demo-series-periods').reason.includes('2027-01-05'));
});

test('approved whole-day leave, missing or archived staff and unavailable worksites skip agreements without inventing replacements',()=>{
  const leave=Examples.appendPlan(base(),{today,blockedDates:[{person:'p5',date:'2026-11-02'}]});assert.equal(leave.added.length,4);assert.deepEqual(leave.skipped.map(item=>[item.id,item.code]),[['demo-series-expiring','leave']]);
  const staff=Data.staff.filter(person=>person.id!=='p3').map(person=>({...person,...(person.id==='p10'?{active:false}:{})})),result=Examples.appendPlan(base(),{today,staff,siteCount:2});assert.deepEqual(result.added,['demo-series-ended']);assert.equal(result.skipped.length,4);assert.ok(result.skipped.some(item=>item.id==='demo-series-varied'&&item.code==='person'));assert.ok(result.skipped.some(item=>item.id==='demo-series-upcoming'&&item.code==='person'));assert.ok(result.skipped.some(item=>item.id==='demo-series-periods'&&item.code==='site'));
  const empty=Examples.appendPlan(base(),{today,staff:[]});assert.equal(empty.changed,false);assert.equal(empty.skipped.length,5);assert.equal(empty.series.length,1);
});

test('relative dates remain valid over leap days and year boundaries with stable groups and a twelve-day expiry',()=>{
  const expected=[['2026-10-31','2026-10-26'],['2027-01-01','2026-12-28'],['2028-02-29','2028-02-28'],['2028-12-31','2028-12-25']];
  for(const [today,anchor]of expected){
    const made=Examples.create({today}),groups=Lifecycle.groupSeries(made.series,{today});assert.deepEqual(Lifecycle.validate(made.series),[]);assert.equal(made.series.find(phase=>phase.groupId==='demo-series-varied').startDate,anchor);assert.equal(made.series.find(phase=>phase.groupId==='demo-series-expiring').endDate,add(today,12));assert.equal(groups.find(group=>group.id==='demo-series-expiring').daysToEnd,12);assert.equal(groups.find(group=>group.id==='demo-series-expiring').expiring,true);assert.equal(groups.find(group=>group.id==='demo-series-upcoming').status,'upcoming');assert.equal(groups.find(group=>group.id==='demo-series-ended').status,'ended');assert.equal(groups.filter(group=>group.status==='active').length,3);
  }
  for(const today of [undefined,'2026-02-29','2028-02-30','2026-10-31T12:00:00Z',' 2026-10-31'])assert.throws(()=>Examples.create({today}),TypeError);
});

test('results are independent, malformed inputs fail closed, and browser scripts expose the same frozen API',()=>{
  const made=Examples.create({today});made.series[0].dayTimes['0'].start='01:00';made.groups[0].phaseIds.length=0;const fresh=Examples.create({today});assert.equal(fresh.series[0].dayTimes['0'].start,'16:00');assert.equal(fresh.groups[0].phaseIds.length,1);
  assert.throws(()=>Examples.appendPlan(base(),{today,siteCount:-1}),TypeError);assert.throws(()=>Examples.appendPlan(base(),{today,blockedDates:[{person:'p5',date:'invalid'}]}),TypeError);
  const invalid=base();invalid.series[0].start='25:00';const result=Examples.appendPlan(invalid,{today});assert.equal(result.changed,false);assert.equal(result.skipped.length,5);assert.ok(result.skipped.every(item=>item.code==='invalid'));
  const context=vm.createContext({});for(const filename of ['series-engine.js','description-model.js','studio-data.js','series-planner.js','series-lifecycle.js','series-examples.js'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+filename),'utf8'),context);assert.equal(context.CleanRoomsSeriesExamples.create({today}).series.length,7);assert.ok(Object.isFrozen(context.CleanRoomsSeriesExamples));assert.ok(Object.isFrozen(Examples));
});
