const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Planning=require('../src/roster-planning.js');
const staff=()=>[{id:'p0',target:37},{id:'p1',target:30}];
const shift=(id,date='2026-10-31',patch={})=>({id,person:'p0',date,site:0,start:'07:00',end:'15:00',note:'',...patch});
const options=patch=>({staff:staff(),weekStart:'2026-10-26',today:'2026-10-31',horizonEnd:'2026-11-27',...patch});
const freeze=value=>{Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return value;};

test('weekly exact-minute totals include Monday and Sunday, exclude surrounding dates, and compare fractional targets',()=>{
  const result=Planning.build(options({staff:[{id:'p0',target:6.5},{id:'p1',target:1.5}],weeklyShifts:[shift('mon','2026-10-26',{start:'07:15',end:'11:45'}),shift('sun','2026-11-01',{start:'22:00',end:'23:59'}),shift('prior','2026-10-25'),shift('later','2026-11-02'),shift('other','2026-10-27',{person:'p1',start:'09:00',end:'11:00'})]}));
  assert.equal(result.weekStart,'2026-10-26');assert.equal(result.weekEnd,'2026-11-01');assert.equal(result.horizonEnd,'2026-11-27');
  assert.equal(result.byPerson.p0.plannedMinutes,389);assert.equal(result.byPerson.p0.targetMinutes,390);assert.equal(result.byPerson.p0.differenceMinutes,-1);assert.equal(result.byPerson.p0.ratio,389/390);assert.equal(result.byPerson.p0.shiftCount,2);assert.equal(result.byPerson.p0.overTarget,false);
  assert.equal(result.byPerson.p1.plannedMinutes,120);assert.equal(result.byPerson.p1.differenceMinutes,30);assert.equal(result.byPerson.p1.ratio,1);assert.equal(result.byPerson.p1.overTarget,true);assert.equal(result.byPerson.p0.nextShift,null);
});

test('moved and reassigned occurrences use actual assignee/date/site while preserving their stable series IDs',()=>{
  const moved=shift('original@2026-10-27','2026-11-03',{person:'p1',site:2,seriesId:'original',note:'Moved to another customer'}),movedEarlier=shift('original@2027-03-09','2026-10-30',{person:'p1',site:1,start:'18:00',end:'19:00'});
  const result=Planning.build(options({weeklyShifts:[moved,movedEarlier],upcomingShifts:[moved,movedEarlier]}));
  assert.equal(result.byPerson.p0.plannedMinutes,0);assert.equal(result.byPerson.p0.nextShift,null);assert.equal(result.byPerson.p1.plannedMinutes,60);assert.equal(result.byPerson.p1.shiftCount,1);assert.deepEqual(result.byPerson.p1.nextShift,moved);assert.equal(result.byPerson.p1.upcoming.length,1);
});

test('identical occurrence IDs are deduplicated across both inputs and missing empty metadata is equivalent',()=>{
  const occurrence=shift('same','2026-10-31',{start:'10:00',end:'11:00',note:undefined}),result=Planning.build(options({weeklyShifts:[occurrence,{...occurrence}],upcomingShifts:[{...occurrence,note:'',noteRich:null},{...occurrence}]}));
  assert.equal(result.byPerson.p0.plannedMinutes,60);assert.equal(result.byPerson.p0.shiftCount,1);assert.equal(result.byPerson.p0.upcoming.length,1);assert.equal(result.byPerson.p0.nextShift.id,'same');
  assert.throws(()=>Planning.build(options({weeklyShifts:[occurrence],upcomingShifts:[{...occurrence,person:'p1',site:2}]})),/Samme vagt-id/);
});

test('upcoming lists contain the first three actual shifts in the inclusive date window and ignore unknown or unassigned people',()=>{
  const upcoming=[shift('after','2026-11-28'),shift('past','2026-10-30'),shift('today','2026-10-31',{start:'16:00',end:'18:00'}),shift('later','2026-11-01',{start:'10:00',end:'12:00'}),shift('early','2026-11-01',{start:'08:00',end:'09:00'}),shift('fourth','2026-11-02'),shift('horizon','2026-11-27',{person:'p1'}),shift('unknown','2026-10-31',{person:'missing'}),shift('open','2026-10-31',{person:''})];
  const result=Planning.build(options({upcomingShifts:upcoming,weeklyShifts:upcoming}));assert.deepEqual(result.byPerson.p0.upcoming.map(shift=>shift.id),['today','early','later']);assert.equal(result.byPerson.p0.nextShift.id,'today');assert.equal(result.byPerson.p1.nextShift.id,'horizon');assert.deepEqual(Object.keys(result.byPerson),['p0','p1']);
  const noFuture=Planning.build(options({upcomingShifts:[shift('past','2026-10-30'),shift('outside','2026-11-28')]}));assert.deepEqual(noFuture.byPerson.p0.upcoming,[]);assert.equal(noFuture.byPerson.p0.nextShift,null);
});

test('an optional local current time removes completed shifts today while retaining ongoing and later work',()=>{
  const shifts=[shift('finished','2026-10-31',{start:'08:00',end:'10:00'}),shift('boundary','2026-10-31',{start:'10:00',end:'12:00'}),shift('ongoing','2026-10-31',{start:'11:00',end:'13:00'}),shift('later','2026-10-31',{start:'13:00',end:'14:00'}),shift('tomorrow','2026-11-01',{start:'00:00',end:'01:00'})];
  const dated=Planning.build(options({upcomingShifts:shifts}));assert.equal(dated.byPerson.p0.nextShift.id,'finished');
  const timed=Planning.build(options({upcomingShifts:shifts,nowTime:'12:00'}));assert.deepEqual(timed.byPerson.p0.upcoming.map(shift=>shift.id),['ongoing','later','tomorrow']);
  assert.equal(Planning.build(options({upcomingShifts:shifts,nowTime:'23:59'})).byPerson.p0.nextShift.id,'tomorrow');
});

test('zero targets and rounded fractional hours never produce Infinity or hide actual overtime',()=>{
  const result=Planning.build(options({staff:[{id:'none',target:0},{id:'zero',target:0},{id:'fraction',target:0.1}],weeklyShifts:[shift('minute','2026-10-31',{person:'zero',start:'10:00',end:'10:01'}),shift('six','2026-10-31',{person:'fraction',start:'10:00',end:'10:06'})]}));
  assert.equal(result.byPerson.none.ratio,0);assert.equal(result.byPerson.none.overTarget,false);assert.equal(result.byPerson.zero.ratio,1);assert.equal(result.byPerson.zero.overTarget,true);assert.equal(result.byPerson.zero.differenceMinutes,1);assert.equal(result.byPerson.fraction.targetMinutes,6);assert.equal(result.byPerson.fraction.differenceMinutes,0);assert.equal(result.byPerson.fraction.overTarget,false);assert.ok(result.people.every(person=>Number.isFinite(person.ratio)&&Number.isInteger(person.plannedMinutes)&&Number.isInteger(person.targetMinutes)));
});

test('invalid calendar values, non-Monday starts, malformed shifts and ambiguous roster identities fail closed',()=>{
  for(const patch of [{weekStart:'2026-10-27'},{weekStart:'2026-02-30'},{today:'2026-02-30'},{horizonEnd:'2026-10-30'},{horizonEnd:undefined},{nowTime:'7:00'},{staff:[{id:'p0',target:NaN}]},{staff:[{id:'p0',target:Infinity}]},{staff:[{id:'p0',target:169}]},{staff:[{id:'p0',target:-1}]},{staff:[{id:'p0',target:37},{id:'p0',target:30}]},{weeklyShifts:null},{upcomingShifts:{}}])assert.throws(()=>Planning.build(options(patch)),TypeError,JSON.stringify(patch));
  for(const patch of [{date:'2026-02-30'},{start:'24:00'},{start:'23:00',end:'06:00'},{start:'15:00',end:'15:00'},{site:-1},{site:'0'},{id:''}])assert.throws(()=>Planning.build(options({weeklyShifts:[shift('bad','2026-10-31',patch)]})),TypeError,JSON.stringify(patch));
  const crossed=Planning.build(options({weekStart:'2026-12-28',today:'2027-01-01',horizonEnd:'2027-01-28',weeklyShifts:[shift('new-year','2027-01-01')]}));assert.equal(crossed.weekEnd,'2027-01-03');assert.equal(crossed.byPerson.p0.plannedMinutes,480);
});

test('caller data stays frozen and independent while browser and CommonJS expose the same pure API',()=>{
  const input=freeze(options({upcomingShifts:[shift('rich','2026-11-02',{note:'Exact\n  ÆØÅ 🧽 <b>literal</b>',noteRich:'literal-rich',metadata:{tags:['Cleaning']}})]})),before=JSON.stringify(input),result=Planning.build(input);
  result.byPerson.p0.nextShift.metadata.tags.push('Changed');result.byPerson.p0.nextShift.note='Changed';assert.equal(JSON.stringify(input),before);assert.equal(result.byPerson.p0.upcoming[0].note,input.upcomingShifts[0].note);assert.deepEqual(Object.keys(Planning),['build']);assert.ok(Object.isFrozen(Planning));
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/roster-planning.js'),'utf8'),context);assert.ok(Object.isFrozen(context.CleanRoomsRosterPlanning));assert.equal(context.CleanRoomsRosterPlanning.build(options()).people.length,2);assert.deepEqual(Planning.build(options({staff:[]})).byPerson,{});
});
