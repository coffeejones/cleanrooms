const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Series=require('../src/series-engine.js'),Planner=require('../src/series-planner.js'),Lifecycle=require('../src/series-lifecycle.js'),Data=require('../src/studio-data.js'),Scope=require('../src/planning-scope.js'),Publication=require('../src/publication-model.js');
const series=patch=>({id:'fortnight',person:'p1',site:0,startDate:'2026-12-21',endDate:'2027-02-28',weekdays:[0,6],start:'22:00',end:'06:00',weekInterval:2,weekAnchor:'2026-12-21',note:'Instructions',...patch});
const add=(day,count)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};

test('fixed Monday cadence spans week 53 and week 1, inclusive boundaries and Copenhagen DST dates',()=>{
 const item=series(),actual=Series.enumerate(item,{from:'2026-12-21',to:'2027-01-17'});
 assert.deepEqual(actual.map(shift=>shift.date),['2026-12-21','2026-12-27','2027-01-04','2027-01-10']);
 assert.equal(Series.occursOn(item,'2026-12-28'),false);assert.equal(Series.occursOn(item,'2027-01-04'),true);
 assert.equal(Series.weekMonday('2027-01-01'),'2026-12-28');
 const dst=series({startDate:'2026-03-16',endDate:'2026-04-12',weekAnchor:'2026-03-16',weekdays:[6]});
 assert.deepEqual(Series.enumerate(dst).map(shift=>shift.date),['2026-03-22','2026-04-05']);
 assert.equal(Data.shiftById('fortnight@2026-12-28',{series:[item]}),null);
 assert.equal(Data.shiftById('fortnight@2027-01-04',{series:[item]}).id,'fortnight@2027-01-04');
});

test('weekly legacy records retain their dates while malformed cadence and anchors are rejected',()=>{
 const legacy=series();delete legacy.weekInterval;delete legacy.weekAnchor;
 assert.equal(Series.enumerate(legacy,{from:'2026-12-21',to:'2027-01-17'}).length,8);
 for(const patch of [{weekInterval:0},{weekInterval:3},{weekInterval:'2'},{weekAnchor:'2026-12-22'},{weekAnchor:'2026-02-30'},{weekAnchor:undefined}])assert.ok(Series.validate(series(patch)).length,JSON.stringify(patch));
 assert.deepEqual(Series.validate(series({weekInterval:1})),[]);
});

test('bounded arithmetic counts and next dates match expansion for anchors before and after the period',()=>{
 for(const anchor of ['2026-12-07','2026-12-21','2027-01-04'])for(const weekdays of [[0],[6],[0,0,2,6],[0,1,2,3,4,5,6]]){
  const item=series({weekAnchor:anchor,weekdays});
  for(let offset=-10;offset<90;offset++){
   const from=add(item.startDate,offset),to=add(from,19),rows=Series.enumerate(item,{from,to});
   assert.equal(Series.countOccurrences(item,from,to),rows.length,JSON.stringify([anchor,weekdays,from]));
   assert.equal(Series.nextOccurrenceDate(item,from,to),rows[0]?.date??null);
  }
 }
});

test('future phases, cutoffs and extensions retain the original anchor instead of restarting their cadence',()=>{
 const source=series({weekdays:[0],endDate:'2027-01-31'}),cutoff='2026-12-30',prior={...source,endDate:add(cutoff,-1)},copy=Lifecycle.copyDraft(source,{id:'second',startDate:cutoff,endDate:source.endDate}).draft;
 copy.groupId=source.id;
 assert.equal(copy.weekAnchor,source.weekAnchor);
 assert.deepEqual(Series.enumerate(prior).concat(Series.enumerate(copy)).map(shift=>shift.date),Series.enumerate(source).map(shift=>shift.date));
 const extension=Lifecycle.extensionDraft([prior,copy],{id:'third',months:1});assert.equal(extension.ok,true);assert.equal(extension.draft.weekAnchor,source.weekAnchor);assert.equal(Series.enumerate(extension.draft)[0].date,'2027-02-01');
 assert.equal(Planner.chooseFutureAnchor(source,{today:cutoff}).anchor,'2027-01-04');
});

test('cadence changes preserve manual assignments and deletions using existing exception semantics',()=>{
 const source=series({weekInterval:1,weekdays:[0]}),removed='fortnight@2026-12-28',kept='fortnight@2027-01-04',edited=Data.shiftById(removed,{series:[source]}),shift=Data.shiftById(kept,{series:[source]});
 const preserved=Series.preserveExceptions({source,replacement:series({weekdays:[0]}),edits:{[removed]:{...edited,date:'2027-01-02'},[kept]:{...shift,start:'21:00'}},deleted:['fortnight@2027-01-11']});
 assert.deepEqual(preserved.detachedIds,[removed]);assert.equal(preserved.edits[removed].seriesId,undefined);assert.equal(preserved.edits[removed].date,'2027-01-02');assert.equal(preserved.edits[kept].seriesId,'fortnight');assert.ok(preserved.deleted.includes('fortnight@2027-01-11'));
 assert.ok(Data.shiftsInRange('2026-12-21','2027-01-17',{demoSeed:false,series:[series({weekdays:[0]})],edits:preserved.edits,deleted:preserved.deleted}).some(shift=>shift.id===removed));
});

test('summary counts, moved dates and next stay exact without expanding an open agreement',()=>{
 const finite=series({weekdays:[0,3],endDate:'2027-02-28'}),rows=Series.enumerate(finite),edits={[rows[1].id]:{...rows[1],date:'2027-02-27'}},deleted=[rows[0].id];
 for(const today of ['2026-12-21','2026-12-30','2027-01-04','2027-02-27']){
  const [summary]=Lifecycle.summarizeSeries([finite],{today,edits,deleted}),[full]=Lifecycle.groupSeries([finite],{today,edits,deleted});
  assert.equal(summary.total,full.total);assert.equal(summary.upcomingCount,full.upcomingCount);assert.deepEqual(summary.next,full.next);
 }
 let calls=0;const bounded={...Series,enumerate(item,range){calls++;assert.equal(range.from,range.to);return Series.enumerate(item,range);}},context=vm.createContext({CleanRoomsSeries:bounded});vm.runInContext(fs.readFileSync(require.resolve('../src/series-lifecycle.js'),'utf8'),context);
 const [open]=context.CleanRoomsSeriesLifecycle.summarizeSeries([series({openEnded:true,endDate:Series.OPEN_END})],{today:'2099-12-29'});
 assert.equal(open.total,null);assert.equal(open.upcomingCount,null);assert.ok(Series.occursOn(series({openEnded:true,endDate:Series.OPEN_END}),open.next.date));assert.equal(calls,1);
 const compact=Scope.compact('series','fortnight',finite);assert.equal(compact.weekInterval,2);assert.equal(compact.weekAnchor,finite.weekAnchor);
});

test('night conflicts occur only in active weeks and undo restores explicit weekly cadence metadata',()=>{
 const item=series({weekdays:[6]}),active=Series.enumerate(item,{from:'2026-12-21',to:'2027-01-17'}),early=date=>({id:'early-'+date,person:item.person,date,site:1,start:'05:00',end:'07:00'});
 assert.equal(Series.conflicts(active,[early('2026-12-28')]).length,1);assert.equal(Series.conflicts(active,[early('2027-01-04')]).length,0);
 const weekly={...item};delete weekly.weekInterval;delete weekly.weekAnchor;
 const plan={series:[item],edits:{},deleted:[],weekPlans:{}},event={kind:'plan',recoverable:true,changes:[{field:'series',id:item.id,before:weekly,after:item}]};
 const restored=Publication.restoreActivity(plan,event);assert.equal(restored.ok,true);assert.equal(restored.studio.series[0].weekInterval,1);assert.equal(restored.studio.series[0].weekAnchor,item.weekAnchor);
});
