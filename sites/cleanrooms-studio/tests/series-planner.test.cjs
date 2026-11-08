const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Engine=require('../src/series-engine.js');
const Planner=require('../src/series-planner.js');
const series=patch=>({id:'regular',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-08',weekdays:[1,3],start:'07:00',end:'15:00',note:'Standard',...patch});
const freeze=value=>{Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return value;};
const dates=value=>value.map(shift=>shift.date);

test('creation preview reports actual calendar occurrences, date-based upcoming counts and independent rich descriptions',()=>{
  const noteRich='{"type":"doc","text":"ÆØÅ 🧽 <b>literal</b>"}';
  const draft=series({startDate:'2026-10-27',endDate:'2027-04-27',noteRich});
  const result=Planner.preview({draft,today:'2026-11-01'});
  assert.equal(result.valid,true);assert.equal(result.total,53);assert.equal(result.rawCount,53);assert.equal(result.past,2);assert.equal(result.upcoming,51);assert.equal(result.createdCount,53);assert.equal(result.affectedCount,0);
  assert.equal(result.first.date,'2026-10-27');assert.equal(result.last.date,'2027-04-27');assert.ok(result.shifts.every(shift=>shift.noteRich===noteRich));
  result.first.note='Changed';assert.equal(result.shifts[0].note,'Standard');assert.equal(draft.note,'Standard');
});

test('effective occurrences apply cancellations and actual moved dates while excluding detached or unrelated anchors',()=>{
  const source=series(),[first,second]=Engine.enumerate(source),moved={...first,person:'p1',site:2,date:'2028-02-29',start:'10:00',end:'12:00',note:'  Manual 🧽\n',noteRich:'literal-rich'};
  const edits={[first.id]:moved,'regular@2026-10-28':{...first,id:'regular@2026-10-28',seriesId:undefined},other:{...first,id:'other'}};
  const result=Planner.occurrences(source,{edits,deleted:[second.id]});
  assert.deepEqual(dates(result),['2026-11-03','2026-11-05','2028-02-29']);assert.deepEqual(result.at(-1),moved);assert.equal(result.length,3);
  result.at(-1).note='Changed';assert.equal(edits[first.id].note,'  Manual 🧽\n');
});

test('future choice maps an upcoming moved occurrence to its original valid anchor rather than its actual date',()=>{
  const source=series(),base=Engine.enumerate(source),future=base[2],edits={[future.id]:{...future,date:'2026-12-20'}};
  const result=Planner.chooseFutureAnchor(source,{today:'2026-11-01',edits});
  assert.equal(result.anchor,'2026-11-03');assert.equal(result.id,future.id);assert.equal(result.base.date,'2026-11-03');assert.equal(result.shift.date,'2026-12-20');
  const preferred=Planner.chooseFutureAnchor(source,{today:'2026-11-01',edits,preferredId:base[3].id});assert.equal(preferred.anchor,'2026-11-05');
});

test('future choice never falls back to history, a cancelled occurrence, or an occurrence already moved into the past',()=>{
  const source=series(),base=Engine.enumerate(source),edits={[base[0].id]:{...base[0],date:'2028-01-01'},[base[2].id]:{...base[2],date:'2026-10-20'}};
  assert.equal(Planner.chooseFutureAnchor(source,{today:'2026-11-01',edits,preferredId:base[0].id}).anchor,'2026-11-05');
  assert.equal(Planner.chooseFutureAnchor(source,{today:'2026-11-01',edits,deleted:[base[3].id]}),null);
  assert.equal(Planner.chooseFutureAnchor(source,{today:'2027-01-01',edits}),null);
  assert.throws(()=>Planner.chooseFutureAnchor(source,{today:'2026-02-30'}),TypeError);
});

test('all-series preview counts preserved live edits and cancellations rather than raw generated shifts',()=>{
  const source=series(),base=Engine.enumerate(source),manual={...base[0],person:'p1',date:'2028-01-01',start:'10:00',end:'12:00',note:'Manual',noteRich:'rich'};
  const result=Planner.preview({source,draft:{...source,start:'08:00',end:'16:00'},edits:{[manual.id]:manual},deleted:[base[1].id],today:'2026-11-01'});
  assert.equal(result.valid,true);assert.equal(result.rawCount,4);assert.equal(result.total,3);assert.equal(result.affectedCount,3);assert.equal(result.preservedCount,1);assert.equal(result.deletedCount,1);
  assert.equal(result.updatedCount,2);assert.equal(result.unchangedCount,1);assert.equal(result.createdCount,0);assert.equal(result.removedCount,0);assert.equal(result.upcoming,3);assert.equal(result.past,0);
  assert.deepEqual(result.shifts.find(shift=>shift.id===manual.id),manual);assert.deepEqual(result.exceptions,{count:2,edited:1,deleted:1,ids:[manual.id,base[1].id]});
});

test('weekday changes include preserved detached live exceptions and accurately count removed old occurrences',()=>{
  const source=series(),base=Engine.enumerate(source),manual={...base[0],date:'2026-12-01',note:'Special visit'};
  const result=Planner.preview({source,draft:{...source,weekdays:[0]},edits:{[manual.id]:manual},deleted:[base[1].id],today:'2026-11-01'});
  assert.equal(result.valid,true);assert.equal(result.rawCount,2);assert.equal(result.attached.length,2);assert.equal(result.detached.length,1);assert.equal(result.total,3);assert.equal(result.preservedCount,1);assert.equal(result.deletedCount,1);assert.equal(result.affectedCount,3);
  assert.equal(Object.hasOwn(result.detached[0],'seriesId'),false);assert.equal(result.detached[0].id,manual.id);assert.equal(result.removedCount,2);assert.equal(result.createdCount,2);assert.equal(result.updatedCount,0);assert.equal(result.unchangedCount,1);assert.equal(result.past,1);assert.equal(result.upcoming,2);
});

test('future preview follows anchors across widely separated actual dates and does not include earlier anchors',()=>{
  const source=series(),base=Engine.enumerate(source),prior={...base[0],date:'2029-01-01'},manual={...base[2],person:'p1',date:'2025-01-01',note:'Moved before cutoff'};
  const result=Planner.preview({source,draft:{...source,id:'future',startDate:'2026-11-03',start:'08:00',end:'16:00'},scope:'future',cutoff:'2026-11-03',edits:{[prior.id]:prior,[manual.id]:manual},deleted:[base[3].id],today:'2026-11-01'});
  assert.equal(result.valid,true);assert.equal(result.total,1);assert.equal(result.affectedCount,1);assert.equal(result.preservedCount,1);assert.equal(result.deletedCount,1);assert.equal(result.removedCount,0);assert.equal(result.unchangedCount,1);assert.equal(result.past,1);
  assert.equal(result.shifts[0].id,'future@2026-11-03');assert.equal(result.shifts[0].date,'2025-01-01');assert.equal(result.shifts[0].person,'p1');assert.ok(!result.shifts.some(shift=>shift.date==='2029-01-01'));
});

test('later starts and shorter periods distinguish existing affected work from the smaller effective result',()=>{
  const source=series();
  const future=Planner.preview({source,draft:{...source,id:'future',startDate:'2026-11-05'},scope:'future',cutoff:'2026-11-03',today:'2026-11-01'});
  assert.equal(future.valid,true);assert.equal(future.total,1);assert.equal(future.affectedCount,2);assert.equal(future.removedCount,1);assert.equal(future.unchangedCount,1);
  const shorter=Planner.preview({source,draft:{...source,endDate:'2026-11-03'},today:'2026-11-01'});assert.equal(shorter.total,3);assert.equal(shorter.affectedCount,4);assert.equal(shorter.removedCount,1);
});

test('a management cutoff may fall between pattern days and still respects original occurrence anchors',()=>{
  const source=series(),base=Engine.enumerate(source),prior={...base[0],date:'2027-02-01',note:'Earlier anchor remains unchanged'};
  const edits={[prior.id]:prior},draft={...source,id:'future',startDate:'2026-11-02',start:'08:00',end:'16:00'};
  const result=Planner.preview({source,draft,scope:'future',cutoff:'2026-11-02',edits,today:'2026-10-30'});
  assert.equal(result.valid,true);assert.equal(result.affectedCount,2);assert.equal(result.total,2);assert.equal(result.removedCount,0);assert.equal(result.preservedCount,0);assert.deepEqual(dates(result.shifts),['2026-11-03','2026-11-05']);assert.ok(result.shifts.every(shift=>shift.id.startsWith('future@')));assert.equal(edits[prior.id].note,'Earlier anchor remains unchanged');
  const earlier=Planner.preview({source,draft:{...draft,startDate:'2026-11-01'},scope:'future',cutoff:'2026-11-02',edits,today:'2026-10-30'});assert.equal(earlier.valid,false);assert.match(earlier.errors.join(' '),/Startdatoen kan ikke ligge før/);
  for(const cutoff of ['2026-10-25','2026-11-09'])assert.equal(Planner.preview({source,draft,scope:'future',cutoff,today:'2026-10-30'}).valid,false);
});

test('explicit exception replacement restores cancelled occurrences and replaces manual fields without counting them as preserved',()=>{
  const source=series(),base=Engine.enumerate(source),manual={...base[0],note:'Manual'};
  const result=Planner.preview({source,draft:{...source,start:'08:00',end:'16:00'},edits:{[manual.id]:manual},deleted:[base[1].id],preserve:false,today:'2026-11-01'});
  assert.equal(result.valid,true);assert.equal(result.total,4);assert.equal(result.preservedCount,0);assert.equal(result.deletedCount,0);assert.equal(result.exceptions.count,2);assert.equal(result.createdCount,1);assert.equal(result.updatedCount,3);assert.equal(result.removedCount,0);
  assert.ok(result.shifts.every(shift=>shift.note==='Standard'&&shift.start==='08:00'));
});

test('invalid draft, scope, cutoff, clock values and malformed exceptions fail closed with no misleading preview',()=>{
  const source=series(),base=Engine.enumerate(source);
  const cases=[{draft:{...source,weekdays:[]}},{draft:{...source,endDate:'2028-01-01',openEnded:true}},{scope:'one'},{source:null,scope:'future'},{source:{...source,startDate:'bad'},scope:'future',cutoff:'2026-11-03'},{scope:'future',cutoff:'2026-11-04'},{scope:'future',cutoff:'2026-11-03'},{today:'2026-02-30'},{preserve:'yes'},{deleted:{}},{edits:{[base[0].id]:{...base[0],start:'24:00'}}}];
  for(const patch of cases){const result=Planner.preview({source,draft:source,today:'2026-11-01',...patch});assert.equal(result.valid,false,JSON.stringify(patch));assert.ok(result.errors.length);assert.equal(result.total,0);assert.deepEqual(result.shifts,[]);}
});

test('previews and anchor choices preserve frozen caller data and never expose writable references into the plan',()=>{
  const source=series(),base=Engine.enumerate(source),input=freeze({source,draft:{...source,id:'future',startDate:'2026-11-03'},scope:'future',cutoff:'2026-11-03',edits:{[base[2].id]:{...base[2],note:'Exact\n  text'}},deleted:[base[3].id],today:'2026-11-01'});
  const before=JSON.stringify(input),result=Planner.preview(input);assert.equal(result.valid,true);result.shifts[0].note='Changed';result.exceptions.ids.length=0;Planner.chooseFutureAnchor(source,input);assert.equal(JSON.stringify(input),before);assert.ok(Object.isFrozen(Planner));
});

test('browser scripts expose the same frozen API without CommonJS',()=>{
  const context=vm.createContext({});for(const filename of ['series-engine.js','series-planner.js'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+filename),'utf8'),context);
  assert.deepEqual(Object.keys(context.CleanRoomsSeriesPlanner).sort(),['chooseFutureAnchor','occurrences','preview']);assert.ok(Object.isFrozen(context.CleanRoomsSeriesPlanner));
  assert.equal(context.CleanRoomsSeriesPlanner.preview({draft:series(),today:'2026-11-01'}).total,4);
});

test('effective previews count only weekdays whose actual times change and preserve manual daily overrides',()=>{
  const source=series({groupId:'agreement',dayTimes:{'3':{start:'09:00',end:'13:00'}}}),base=Engine.enumerate(source),manual={...base[0],start:'17:00',end:'19:00',note:'Manual'};
  const result=Planner.preview({source,draft:{...source,start:'08:00',end:'16:00'},edits:{[manual.id]:manual},today:'2026-10-30'});
  assert.equal(result.valid,true);assert.equal(result.total,4);assert.equal(result.preservedCount,1);assert.equal(result.updatedCount,1);assert.equal(result.unchangedCount,3);assert.equal(result.shifts.find(shift=>shift.date==='2026-11-03').start,'08:00');assert.equal(result.shifts.find(shift=>shift.date==='2026-11-05').start,'09:00');assert.equal(result.shifts.find(shift=>shift.id===manual.id).start,'17:00');
});
