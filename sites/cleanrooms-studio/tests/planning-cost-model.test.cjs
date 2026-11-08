const test=require('node:test'),assert=require('node:assert/strict');
const Cost=require('../src/planning-cost-model.js');
const from='2026-10-26',to='2026-11-01';
const base=(amountCents=18000,type='hourly',date='2026-01-01',id='base')=>({id,from:date,type,amountCents});
const supplement=(patch={})=>({id:'evening',name:'Aften',type:'hourly',amountCents:3000,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4,5,6],start:'18:00',end:'22:00',...patch});
const config=(agreements=[base()],supplements=[])=>({currency:'DKK',agreements,supplements});
const shift=(id,date=from,patch={})=>({id,person:'p1',site:0,date,start:'15:00',end:'21:00',plannedBreakMinutes:30,...patch});
const person=(payroll=config(),personId='p1')=>({personId,name:'Medarbejder '+personId,payroll});
const estimate=patch=>Cost.estimate({from,to,people:[person()],shifts:[shift('first')],...patch});
const link=(patch={})=>({personId:'p1',from:'2026-01-01',groupId:'group',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[],...patch});

test('weekly gross amounts reuse net planned hours and eligible supplements without exposing private agreements',()=>{
 const [week]=estimate({people:[person(config([base()],[supplement()]))]});
 assert.equal(week.minutes,330);assert.equal(week.baseCents,99000);assert.equal(week.supplementCents,7500);assert.equal(week.totalCents,106500);assert.equal(week.complete,true);
 assert.equal(week.people[0].totalCents,week.totalCents);assert.equal(JSON.stringify(week).includes('amountCents'),false);assert.equal(JSON.stringify(week).includes('agreementId'),false);
});
test('dated groups, personal base overrides and exclusions take effect on each actual shift date across a month boundary',()=>{
 const policy={schema:1,groups:[{id:'group',name:'Service',archived:false,revisions:[{id:'first',from:'2026-01-01',payroll:config([base(10000)],[supplement({start:null,end:null,amountCents:1000})])}]}],links:[link(),link({from:'2026-11-01',baseMode:'personal'})]};
 const [week]=estimate({policy,people:[person(config([base(20000)]))],shifts:[shift('oct','2026-10-31',{start:'08:00',end:'09:00',plannedBreakMinutes:0}),shift('nov','2026-11-01',{start:'08:00',end:'09:00',plannedBreakMinutes:0})]});
 assert.equal(week.baseCents,30000);assert.equal(week.supplementCents,2000);assert.equal(week.totalCents,32000);assert.equal(week.complete,true);
});
test('unknown/open/unconfigured wages are counted explicitly and zero wages stay valid',()=>{
 const [week]=estimate({people:[person(config([base(0)])),person(null,'p2')],shifts:[shift('zero'),shift('missing',from,{person:'p2'}),shift('unknown',from,{person:'p3'}),shift('open',from,{person:''})]});
 assert.equal(week.totalCents,0);assert.equal(week.missingShiftCount,2);assert.equal(week.openShiftCount,1);assert.equal(week.complete,false);assert.equal(week.people.find(item=>item.personId==='p1').missingShiftCount,0);
});
test('fixed monthly pay is not charged per shift, while its hourly supplements remain in the variable estimate',()=>{
 const [week]=estimate({people:[person(config([base(3000000,'monthly')],[supplement({start:null,end:null}),supplement({id:'fixed',type:'monthly',amountCents:250000,weekdays:[],start:null,end:null})]))],shifts:[shift('one'),shift('two','2026-10-27')]});
 assert.equal(week.baseCents,0);assert.equal(week.supplementCents,33000);assert.equal(week.totalCents,33000);assert.equal(week.monthlyPersonCount,1);assert.equal(week.fixedSupplementPersonCount,1);assert.equal(week.complete,false);assert.equal(week.people[0].monthly,true);
});
test('a missing-base policy gap is not silently represented as an authoritative zero rate',()=>{
 const policy={schema:1,groups:[{id:'group',name:'Service',archived:false,revisions:[{id:'first',from:'2026-01-01',payroll:config([base(10000)])}]}],links:[link(),link({from:'2026-10-27',groupId:null,baseMode:'personal'})]};
 const [week]=estimate({policy,people:[person(null)],shifts:[shift('known'),shift('gap','2026-10-27')]});assert.equal(week.baseCents,55000);assert.equal(week.missingShiftCount,1);assert.equal(week.complete,false);
});
test('totals are deterministic, duplicates do not double count and invalid ranges/data fail explicitly',()=>{
 const input=[shift('a'),shift('b','2026-10-27')],one=estimate({shifts:input}),two=estimate({shifts:[...input].reverse().concat(input[0])});assert.deepEqual(one,two);
 assert.throws(()=>estimate({shifts:[input[0],{...input[0],end:'22:00'}]}),/forskellige/);
 assert.throws(()=>estimate({from:'2026-10-27'}),/hele uger/);assert.throws(()=>estimate({to:'2026-12-27'}),/otte/);
 assert.throws(()=>estimate({shifts:[shift('bad',from,{person:'',plannedBreakMinutes:500})]}),/pause/);
 const [overlap]=estimate({shifts:[shift('a'),shift('b')]});assert.equal(overlap.overlapShiftCount,2);assert.equal(overlap.complete,false);
});
