const test = require('node:test');
const assert = require('node:assert/strict');
const Demo = require('../src/demo-fixtures.js');
const Series = require('../src/series-engine.js');
const Actions = require('../src/schedule-actions.js');
const Staffing = require('../src/staffing-engine.js');
const Bulk = require('../src/bulk-actions.js');

const addDays=(value,count)=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
const requests=[{person:'p6',days:['2026-10-28'],type:'Ferie',status:'approved'},{person:'p1',days:['2026-11-03','2026-11-04'],type:'Friønske',status:'pending'}];

// The fixtures deliberately supply only differences from the existing 22-person
// seed. Reproduce that seed here to verify the combined, effective schedule.
function week(from,data=Demo.create()) {
  const result=[],to=addDays(from,6);
  for(let day=from;day<=to;day=addDays(day,1)){
    const index=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
    for(let i=1;i<22;i++){
      const workdays=i===2?[0,1,3,4,5]:i===3?[0,2,4]:i===4?[0,1,3,4]:[0,1,2,3,4];
      if(!workdays.includes(index)||(i===6&&day==='2026-10-28'))continue;
      const start=index===5?'09:00':i===4?'16:00':i%3===1?'06:00':i%3===2?'07:00':'08:00';
      const end=index===5?'13:00':i===4?'21:00':i%3===1?'13:00':i%3===2?'14:00':'15:00';
      result.push({id:'p'+i+'-'+day,person:'p'+i,date:day,site:i%3,start,end,note:''});
    }
    if(index===2)result.push({id:'open-'+day,person:'',date:day,site:1,start:'07:00',end:'14:00',note:''});
  }
  data.series.forEach(series=>result.push(...Series.enumerate(series,{from,to})));
  const map=new Map(result.map(shift=>[shift.id,shift]));
  Object.values(data.edits).forEach(shift=>{map.delete(shift.id);if(shift.date>=from&&shift.date<=to)map.set(shift.id,shift);});
  return [...map.values()].filter(shift=>!data.deleted.includes(shift.id));
}

test('fixtures add exactly one real overlap pair in week 44 and keep every shift valid',()=>{
  const shifts=week('2026-10-26'),pairs=new Map();
  Series.conflicts(shifts,shifts).forEach(pair=>pairs.set([pair.shift.id,pair.other.id].sort().join('|'),pair));
  assert.equal(pairs.size,1);const pair=[...pairs.values()][0];
  assert.deepEqual([pair.shift.id,pair.other.id].sort(),['demo-overlap-emma','p1-2026-10-26']);
  assert.notEqual(pair.shift.site,pair.other.site);
  assert.equal(Math.min(minutes(pair.shift.end),minutes(pair.other.end))-Math.max(minutes(pair.shift.start),minutes(pair.other.start)),120);
  for(const shift of shifts){assert.equal(Actions.validDate(shift.date),true);assert.deepEqual(Series.validate({id:shift.id,person:shift.person||'unassigned',site:shift.site,startDate:shift.date,endDate:shift.date,weekdays:[0],start:shift.start,end:shift.end}),[]);}
});

test('Lea has no assigned Wednesday shift and approved leave blocks assigning the existing open shift',()=>{
  const shifts=week('2026-10-26');assert.ok(!shifts.some(shift=>shift.person==='p6'&&shift.date==='2026-10-28'));
  const open=shifts.find(shift=>shift.id==='open-2026-10-28');assert.equal(open.site,1);assert.equal(open.start,'07:00');assert.equal(open.end,'14:00');
  const blockedDates=requests.filter(request=>request.status==='approved').flatMap(request=>request.days.map(date=>({person:request.person,date})));
  const result=Staffing.assess({person:{id:'p6',target:37},proposed:[{...open,person:'p6'}],existing:shifts,blockedDates,weekStart:'2026-10-26'});
  assert.equal(result.valid,true);assert.equal(result.available,false);assert.ok(result.conflicts.some(conflict=>conflict.type==='leave'));
});

test('the request example is available after Emmas original shift, advisory only, and changes 35 to 37 hours',()=>{
  const shifts=week('2026-11-02'),open=shifts.find(shift=>shift.id==='demo-request-shift');assert.ok(open);assert.equal(open.person,'');
  const pendingRequests=requests.filter(request=>request.status==='pending').flatMap(request=>request.days.map(date=>({person:request.person,date,type:request.type})));
  const result=Staffing.assess({person:{id:'p1',target:35},proposed:[{...open,person:'p1'}],existing:shifts,pendingRequests,weekStart:'2026-11-02'});
  assert.equal(result.available,true);assert.equal(result.conflicts.length,0);assert.equal(result.pendingRequests.length,1);assert.equal(result.pendingRequests[0].date,'2026-11-03');
  assert.equal(result.currentMinutes,35*60);assert.equal(result.projectedMinutes,37*60);
});

test('the existing Wednesday open shift takes Jonas from 16 to 23 hours without blocking',()=>{
  const shifts=week('2026-10-26'),open=shifts.find(shift=>shift.id==='open-2026-10-28');
  const result=Staffing.assess({person:{id:'p0',target:16},proposed:[{...open,person:'p0'}],existing:shifts,weekStart:'2026-10-26'});
  assert.equal(result.available,true);assert.equal(result.currentMinutes,16*60);assert.equal(result.projectedMinutes,23*60);
  assert.deepEqual(result.overTargetWeeks,[{weekStart:'2026-10-26',projectedMinutes:23*60,targetMinutes:16*60}]);
});

test('the original Tuesday/Thursday six-month series still contains 52 occurrences',()=>{
  const data=Demo.create(),shifts=Series.enumerate(data.series[0]);assert.equal(shifts.length,52);assert.equal(shifts[0].date,'2026-10-27');assert.equal(shifts.at(-1).date,'2027-04-22');
  assert.equal(Object.keys(data.edits).length,2);assert.deepEqual(Object.keys(data).sort(),['deleted','edits','requests','series','weekPlans']);
});

test('create and scenario copies are independent deterministic plain objects',()=>{
  const first=Demo.create(),second=Demo.create();assert.deepEqual(first,second);
  first.edits['demo-overlap-emma'].note='Changed';first.series[0].weekdays.push(5);first.deleted.push('a');first.weekPlans['0']={published:true};first.requests.a='rejected';
  assert.deepEqual(Demo.create(),second);
  Object.freeze(first);Object.freeze(first.edits);assert.doesNotThrow(()=>Demo.create());
  const scenarios=Demo.scenarios;assert.deepEqual(scenarios.map(scenario=>scenario.id),['overlap','leave','request','hours','series','bulk','coverage']);
  for(const scenario of scenarios){assert.equal(Object.getPrototypeOf(scenario),Object.prototype);assert.deepEqual(Object.keys(scenario).sort(),['description','expected','id','title']);assert.ok(scenario.title&&scenario.description&&scenario.expected);}
  scenarios[0].title='Changed';assert.notEqual(Demo.scenarios[0].title,'Changed');assert.equal(globalThis.CleanRoomsDemo,Demo);
});

test('scenario-specific fixtures contain only the selected example and reject unknown scenarios',()=>{
  assert.deepEqual(Object.keys(Demo.create('overview').edits).sort(),['demo-overlap-emma','demo-request-shift']);
  assert.deepEqual(Object.keys(Demo.create('overlap').edits),['demo-overlap-emma']);
  assert.deepEqual(Object.keys(Demo.create('request').edits),['demo-request-shift']);
  for(const scenario of['leave','hours','series','bulk'])assert.deepEqual(Demo.create(scenario).edits,{});
  for(const scenario of['unknown','Overview','overview ',null,1])assert.throws(()=>Demo.create(scenario),TypeError);
});

test('non-overlap scenarios are free of unrelated collisions and bulk changes remain publishable',()=>{
  for(const scenario of['leave','request','hours','series','bulk']){
    const data=Demo.create(scenario);
    assert.equal(Series.conflicts(week('2026-10-26',data),week('2026-10-26',data)).length,0,scenario);
  }
  const existing=week('2026-10-26',Demo.create('bulk')),members=existing.filter(shift=>shift.person==='p0');
  const plan=Bulk.plan({members,existing,operation:'time',start:'08:00',end:'16:00'});
  assert.equal(plan.ok,true);assert.equal(plan.proposed.length,2);
  const effective=new Map(existing.map(shift=>[shift.id,shift]));plan.proposed.forEach(shift=>effective.set(shift.id,shift));
  assert.equal(Series.conflicts([...effective.values()],[...effective.values()]).length,0);
});
