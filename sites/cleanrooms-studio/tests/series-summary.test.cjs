const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Engine=require('../src/series-engine.js'),Lifecycle=require('../src/series-lifecycle.js'),Overview=require('../src/series-overview.js');
const phase=(id,extra={})=>({id,person:'p1',site:0,startDate:'2026-01-01',endDate:'2026-12-31',weekdays:[0,2,4],start:'07:00',end:'15:00',note:'',...extra});
const add=(day,count)=>{const value=new Date(day+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+count);return value.toISOString().slice(0,10);};
const comparable=value=>{const result={...value};for(const field of ['summary','shifts','occurrences','upcoming'])delete result[field];return result;};
function parity(phases,options){const full=Lifecycle.groupSeries(phases,options),summaries=Lifecycle.summarizeSeries(phases,options);assert.deepEqual(summaries.map(comparable),full.map(comparable));for(const summary of summaries){assert.equal(summary.summary,true);for(const field of ['shifts','occurrences','upcoming'])assert.equal(Object.hasOwn(summary,field),false);}return summaries;}

test('summary matches actual grouped occurrences across periods, moved assignments, cancellations and out-of-pattern exception identities',()=>{
 const phases=[phase('first',{groupId:'agreement',startDate:'2026-01-01',endDate:'2026-06-30'}),phase('second',{groupId:'agreement',startDate:'2026-07-01',endDate:'2026-12-31',person:'p2',site:1,weekdays:[1,3],dayTimes:{3:{start:'10:00',end:'14:00',plannedBreakMinutes:15}}}),phase('ended',{endDate:'2026-05-31'}),phase('upcoming',{startDate:'2027-01-01',endDate:'2027-06-30'})];
 const first=Engine.enumerate(phases[0]),second=Engine.enumerate(phases[1]),edits={
  [first[0].id]:{...first[0],date:'2027-02-01',person:'p3',site:2,start:'06:00',end:'10:00'},
  [second.at(-1).id]:{...second.at(-1),date:'2026-01-01'},
  [second[3].id]:{...second[3],seriesId:'another-series',date:'2028-01-01'},
  'first@2028-01-01':{invalid:'Outside this phase, counted as an exception but never applied'}
 },deleted=[second[0].id,second[0].id,first[1].id,'first@2029-01-01'];
 for(const today of ['2025-12-01','2026-01-01','2026-06-30','2026-07-01','2026-10-30','2027-02-01','2028-01-01'])parity(phases,{today,edits,deleted});
});

test('summary counts and next remain exact for generated sparse patterns and edited occurrences crossing today',()=>{
 let seed=0x71f92;const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
 for(let example=0;example<120;example++){
  const phases=[],edits={},deleted=[];const today=add('2026-01-01',random(700)-150);
  for(let index=0;index<1+random(5);index++){
   const start=add('2026-01-01',index*370),weekdays=Array.from({length:7},(_,day)=>day).filter(()=>random(3)!==0);if(!weekdays.length)weekdays.push(random(7));if(random(4)===0)weekdays.push(weekdays[0]);
   const item=phase('sample-'+index,{groupId:random(2)?'shared':'own-'+index,startDate:start,endDate:add(start,random(366)),weekdays,plannedBreakMinutes:random(31),dayTimes:{[weekdays[0]]:{start:'09:00',end:'17:00',plannedBreakMinutes:15}}});phases.push(item);
   for(const shift of Engine.enumerate(item))if(random(7)===0){if(random(3)===0)deleted.push(shift.id);else edits[shift.id]={...shift,date:add(shift.date,random(401)-200),person:'p'+random(4),site:random(3),...(random(5)===0?{seriesId:'unrelated'}:{})};}
  }
  parity(phases,{today,edits,deleted});
 }
});

test('empty patterns, duplicate weekdays, leap years, boundary dates and same-day ordering match the editor model',()=>{
 const cases=[phase('empty',{startDate:'2026-11-04',endDate:'2026-11-04',weekdays:[0]}),phase('leap',{startDate:'2024-01-01',endDate:'2024-12-31',weekdays:[0,0,1,2,3,4,5,6]}),phase('early',{startDate:'0001-01-01',endDate:'0001-12-31'}),phase('late',{startDate:'9999-01-01',endDate:'9999-12-31'})];
 for(const item of cases)for(const today of [item.startDate,item.endDate])parity([item],{today});
 const item=phase('same'),original=Engine.enumerate(item),edits=Object.fromEntries(original.slice(0,4).map((shift,index)=>[shift.id,{...shift,date:'2026-11-04',start:index%2?'08:00':'07:00',end:'15:00'}]));parity([item],{today:'2026-11-04',edits,deleted:original.slice(4).map(shift=>shift.id)});
});

test('summary validates actual exceptions even when cancelled, ignores non-occurrence bodies and never changes caller data',()=>{
 const item=phase('safe'),shift=Engine.enumerate(item)[0],invalid={...shift,start:'25:00'};
 for(const deleted of [[],[shift.id]])for(const method of ['groupSeries','summarizeSeries'])assert.throws(()=>Lifecycle[method]([item],{today:'2026-11-04',edits:{[shift.id]:invalid},deleted}),TypeError);
 const frozen=JSON.parse(JSON.stringify({phases:[item],edits:{[shift.id]:{...shift,date:'2027-01-01',_summaryPhase:{bad:true}}},deleted:[]})),before=JSON.stringify(frozen),[summary]=parity(frozen.phases,{today:'2026-11-04',edits:frozen.edits,deleted:frozen.deleted});
 summary.phases[0].weekdays.push(6);summary.representative.person='Changed';summary.next.note='Changed';assert.equal(JSON.stringify(frozen),before);
 for(const input of [{today:'2026-02-30'},{today:'2026-11-04',edits:[]},{today:'2026-11-04',deleted:[123]}])assert.throws(()=>Lifecycle.summarizeSeries([item],input),TypeError);
 assert.deepEqual(Lifecycle.summarizeSeries([],{today:'2026-11-04',edits:[]}),[],'Empty input follows the existing lifecycle validation behavior');
});

test('hundreds of annual daily series materialize at most one next-day shift per agreement',()=>{
 let calls=0,materialized=0;const bounded={...Engine,enumerate(item,range){calls++;assert.equal(range.from,range.to,'Overview summary must never enumerate the full period');const shifts=Engine.enumerate(item,range);materialized+=shifts.length;return shifts;}};
 const context=vm.createContext({CleanRoomsSeries:bounded});vm.runInContext(fs.readFileSync(require.resolve('../src/series-lifecycle.js'),'utf8'),context);
 const phases=Array.from({length:500},(_,index)=>phase('annual-'+index,{weekdays:[0,1,2,3,4,5,6]})),summaries=context.CleanRoomsSeriesLifecycle.summarizeSeries(phases,{today:'2026-11-04'});
 assert.equal(summaries.length,500);assert.equal(summaries.reduce((sum,item)=>sum+item.total,0),500*365);assert.equal(calls,500);assert.equal(materialized,500);assert.equal(summaries[0].upcomingCount,58);
});

test('overview accepts summaries without occurrence arrays and applies names and filters freshly',()=>{
 const phases=[phase('person-one'),phase('person-two',{person:'p2'})],agreements=Lifecycle.summarizeSeries(phases,{today:'2026-11-04'});let name='First';
 const options={agreements,today:'2026-11-04',personName:id=>id==='p1'?name:'Other'},first=Overview.model(options);assert.equal(first.entries.find(entry=>entry.series.person==='p1').name,'First');name='Renamed';
 const next=Overview.model({...options,filterAgreement:entry=>entry.series.person==='p1'});assert.equal(next.entries.length,1);assert.equal(next.entries[0].name,'Renamed');assert.equal(next.entries[0].upcomingCount,agreements[0].upcomingCount);assert.equal(next.entries[0].next.id,agreements[0].next.id);assert.equal(Object.hasOwn(next.entries[0],'upcoming'),false);
});
