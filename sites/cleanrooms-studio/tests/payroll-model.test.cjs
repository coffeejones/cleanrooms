const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Payroll=require('../src/payroll-model.js');
const agreement=(id='rate',from='2026-01-01',type='hourly',amountCents=18550)=>({id,from,type,amountCents});
const supplement=(extra={})=>({id:'evening',name:'Aftentillæg',type:'hourly',amountCents:2500,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4],start:'18:00',end:'22:00',...extra});
const config=(extra={})=>({currency:'DKK',agreements:[agreement()],supplements:[],...extra});
const shift=(id,date='2026-10-26',extra={})=>({id,person:'p0',date,site:0,start:'07:00',end:'15:00',note:'',...extra});
const estimate=(extra={})=>Payroll.estimate({config:config(),personId:'p0',month:'2026-10',shifts:[],...extra});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('normalization sorts and clones stable identities and accepts an absent, explicitly unconfigured salary',()=>{
  assert.deepEqual(Payroll.normalize(),{currency:'DKK',agreements:[],supplements:[]});assert.deepEqual(Payroll.normalize(null),Payroll.normalize());
  const input=freeze(config({agreements:[agreement('later','2026-11-01'),agreement('earlier','2026-01-01')],supplements:[supplement({weekdays:[4,0,2]})]})),before=JSON.stringify(input),result=Payroll.normalize(input);
  assert.deepEqual(result.agreements.map(item=>item.id),['earlier','later']);assert.deepEqual(result.supplements[0].weekdays,[0,2,4]);result.supplements[0].weekdays.push(1);assert.equal(JSON.stringify(input),before);assert.deepEqual(Payroll.validate(input),[]);
});

test('strict configuration validation rejects ambiguous rates, invalid dates, duplicate IDs and incomplete windows',()=>{
  const invalid=[{},config({currency:'EUR'}),config({extra:true}),config({agreements:[agreement('same'),agreement('same','2026-11-01')]}),config({agreements:[agreement('a'),agreement('b')]}),config({agreements:[agreement('bad','2026-02-29')]}),config({agreements:[agreement('bad','2026-01-01','hourly',-1)]}),config({agreements:[agreement('bad','2026-01-01','hourly',0.5)]}),config({agreements:[agreement('bad','2026-01-01','hourly',Number.MAX_SAFE_INTEGER+1)]}),config({supplements:[supplement({weekdays:[]})]}),config({supplements:[supplement({weekdays:[0,0]})]}),config({supplements:[supplement({weekdays:[7]})]}),config({supplements:[supplement({start:null})]}),config({supplements:[supplement({start:'18:00',end:'18:00'})]}),config({supplements:[supplement({to:'2025-12-31'})]}),config({supplements:[supplement({type:'monthly'})]}),config({supplements:[supplement({name:' '})]}),config({supplements:[supplement({id:'a'}),supplement({id:'a'})]})];
  for(const input of invalid){assert.ok(Payroll.validate(input).length,JSON.stringify(input));assert.throws(()=>Payroll.normalize(input),TypeError);}
  assert.equal(Payroll.validate(config({agreements:[agreement('zero','2026-01-01','hourly',0)]})).length,0);
  assert.equal(Payroll.validate(config({agreements:Array.from({length:1001},(_,i)=>agreement(String(i)))})).some(message=>message.includes('1000')),true);
});

test('hourly base pay uses actual month/person/site assignments and exact integer minute arithmetic',()=>{
  const moved=shift('pattern@2027-03-02','2026-10-31',{site:2,seriesId:'pattern',start:'07:15',end:'09:45',note:'Flyttet vagt'});
  const result=estimate({shifts:[shift('prior','2026-09-30'),shift('first','2026-10-01',{start:'10:00',end:'11:00'}),moved,shift('later','2026-11-01'),shift('foreign','2026-10-31',{person:'p1'}),{person:'',date:'ignored'}]});
  assert.equal(result.label,'Planlagt løn');assert.equal(result.currency,'DKK');assert.equal(result.from,'2026-10-01');assert.equal(result.to,'2026-10-31');assert.equal(result.minutes,210);assert.equal(result.shiftCount,2);assert.equal(result.baseCents,64925);assert.equal(result.supplementCents,0);assert.equal(result.totalCents,64925);assert.equal(result.complete,true);
  assert.deepEqual(result.shifts.map(item=>item.id),['first',moved.id]);assert.equal(result.shifts[1].seriesId,'pattern');assert.equal(result.shifts[1].site,2);assert.equal(result.shifts[1].date,'2026-10-31');assert.equal(result.shifts[1].agreementId,'rate');assert.equal(result.activeAgreement.id,'rate');assert.equal(result.lines[0].minutes,210);
});

test('component rounding happens once and allocated shift cents reconcile deterministically',()=>{
  const input={config:config({agreements:[agreement('rate','2026-01-01','hourly',10001)],supplements:[supplement({amountCents:101,start:null,end:null,weekdays:[0]})]}),shifts:[shift('b','2026-10-26',{start:'08:00',end:'08:01'}),shift('a','2026-10-26',{start:'07:00',end:'07:01'})]};
  const result=estimate(input);assert.equal(result.baseCents,333);assert.equal(result.supplementCents,3);assert.equal(result.totalCents,336);assert.deepEqual(result.shifts.map(item=>[item.id,item.baseCents,item.supplementCents,item.totalCents]),[['a',167,2,169],['b',166,1,167]]);
  assert.equal(result.shifts.reduce((sum,item)=>sum+item.totalCents,0),result.totalCents);assert.equal(result.lines.reduce((sum,line)=>sum+line.amountCents,0),result.totalCents);
  assert.deepEqual(estimate({...input,shifts:[...input.shifts].reverse()}).shifts,result.shifts);
});

test('monthly salary is prorated by active calendar days across changes, independently of planned hours',()=>{
  const configured=config({agreements:[agreement('old','2026-01-01','monthly',3100000),agreement('new','2026-10-16','monthly',6200000)]});
  const empty=estimate({config:configured}),working=estimate({config:configured,shifts:[shift('before','2026-10-05'),shift('after','2026-10-20',{start:'09:00',end:'10:00'})]});
  assert.equal(empty.baseCents,4700000);assert.equal(working.baseCents,empty.baseCents);assert.equal(empty.shiftCount,0);assert.equal(empty.complete,true);assert.equal(working.minutes,540);
  assert.deepEqual(working.lines.map(line=>[line.id,line.days,line.monthDays,line.amountCents]),[['base:old',15,31,1500000],['base:new',16,31,3200000]]);assert.equal(working.activeAgreement.id,'new');assert.equal(working.shifts[1].agreementId,'new');assert.equal(working.shifts[1].baseType,'monthly');assert.ok(working.shifts.every(item=>item.baseCents===0),'Monthly pay is never allocated in proportion to shift hours.');
  const leap=estimate({month:'2028-02',config:config({agreements:[agreement('leap','2028-02-15','monthly',290000)]})});assert.equal(leap.baseCents,150000);assert.equal(leap.lines[0].days,15);assert.equal(leap.lines[0].monthDays,29);
});

test('hourly-to-monthly rate changes apply on the inclusive effective date without paying a base twice',()=>{
  const result=estimate({config:config({agreements:[agreement('hourly','2026-01-01','hourly',20000),agreement('monthly','2026-10-16','monthly',3100000)]}),shifts:[shift('old','2026-10-15',{start:'07:00',end:'09:00'}),shift('new','2026-10-16',{start:'07:00',end:'15:00'})]});
  assert.equal(result.baseCents,1640000);assert.equal(result.shifts[0].baseCents,40000);assert.equal(result.shifts[1].baseCents,0);assert.deepEqual(result.shifts.map(item=>item.agreementId),['hourly','monthly']);
});

test('overnight hourly supplements carry the originating weekday and inclusive validity into the following morning',()=>{
  const result=estimate({config:config({supplements:[supplement({id:'night',name:'Nat',amountCents:3000,from:'2026-10-26',to:'2026-10-26',weekdays:[0],start:'22:00',end:'06:00'})]}),shifts:[shift('monday','2026-10-26',{start:'21:00',end:'23:00'}),shift('tuesday','2026-10-27',{start:'00:30',end:'07:00'}),shift('wrong-day','2026-10-28',{start:'00:30',end:'07:00'})]});
  assert.equal(result.supplementCents,19500);assert.deepEqual(result.shifts.map(item=>[item.id,item.supplementCents]),[['monday',3000],['tuesday',16500],['wrong-day',0]]);assert.equal(result.lines.find(line=>line.type==='supplement').minutes,390);
  const monthCarry=estimate({config:config({supplements:[supplement({weekdays:[2],from:'2026-09-30',to:'2026-09-30',start:'22:00',end:'06:00',amountCents:1000})]}),shifts:[shift('carry','2026-10-01',{start:'05:00',end:'07:00'})]});assert.equal(monthCarry.supplementCents,1000);
});

test('whole-day and daytime supplements stack only for matching minutes while monthly supplements use calendar validity',()=>{
  const configured=config({supplements:[supplement({id:'all',name:'Dagtillæg',amountCents:1000,start:null,end:null,weekdays:[0]}),supplement({id:'window',name:'Morgen',amountCents:2000,start:'08:00',end:'10:00',weekdays:[0]}),supplement({id:'fixed',name:'Fast tillæg',type:'monthly',amountCents:31000,from:'2026-10-16',to:'2026-10-25',weekdays:[],start:null,end:null})]});
  const result=estimate({config:configured,shifts:[shift('work','2026-10-26',{start:'07:00',end:'11:00'})]});assert.equal(result.supplementCents,18000);assert.equal(result.shifts[0].supplementCents,8000);assert.deepEqual(result.shifts[0].supplements.map(item=>[item.id,item.minutes,item.amountCents]),[['all',240,4000],['window',120,4000]]);
  const monthly=result.lines.find(line=>line.id==='supplement:fixed');assert.equal(monthly.days,10);assert.equal(monthly.amountCents,10000);assert.equal(estimate({config:configured}).supplementCents,10000);
});

test('unconfigured or not-yet-effective rates and real double bookings are reported as incomplete estimates',()=>{
  const shifts=[shift('one','2026-10-01'),shift('two','2026-10-01',{start:'14:00',end:'16:00'}),shift('touching','2026-10-01',{start:'16:00',end:'17:00'}),shift('prior','2026-10-02')];
  const none=estimate({config:null,shifts});assert.equal(none.baseCents,0);assert.equal(none.complete,false);assert.deepEqual(none.uncoveredDates,['2026-10-01','2026-10-02']);assert.equal(none.activeAgreement,null);assert.equal(none.overlaps.length,1);assert.deepEqual(none.overlaps[0],{date:'2026-10-01',shiftId:'one',otherId:'two',start:'14:00',end:'15:00'});
  const covered=estimate({shifts});assert.equal(covered.uncoveredDates.length,0);assert.equal(covered.overlaps.length,1);assert.equal(covered.complete,false);assert.equal(covered.shiftCount,4);
  assert.equal(estimate({config:null}).complete,false);assert.equal(estimate({config:config({agreements:[agreement('future','2026-11-01')]})}).complete,false);
  const partial=estimate({config:config({agreements:[agreement('starts','2026-10-02')]}),shifts});assert.deepEqual(partial.uncoveredDates,['2026-10-01']);assert.equal(partial.complete,false);
});

test('duplicate IDs deduplicate exact records, reject contradictions and invalid own shift fields fail explicitly',()=>{
  const original=shift('same'),result=estimate({shifts:[original,{...original}]});assert.equal(result.shiftCount,1);assert.equal(result.baseCents,148400);
  for(const patch of [{date:'2026-10-27'},{site:1},{end:'14:00'},{note:'changed'},{noteRich:'changed'}])assert.throws(()=>estimate({shifts:[original,{...original,...patch}]}),/Samme vagt-id/);
  for(const patch of [{date:'2026-02-30'},{start:'7:00'},{end:'24:00'},{start:'15:00',end:'07:00'},{end:'07:00'},{site:-1},{site:'0'},{id:''}])assert.throws(()=>estimate({shifts:[shift('bad','2026-10-26',patch)]}),TypeError);
  for(const extra of [{month:'2026-2'},{month:'0000-01'},{month:'2026-13'},{personId:''},{shifts:null}])assert.throws(()=>estimate(extra),TypeError);
  assert.throws(()=>estimate({config:config({agreements:[agreement('huge','2026-01-01','hourly',Number.MAX_SAFE_INTEGER)]}),shifts:[original]}),RangeError);
});

test('frozen inputs and full literal rich metadata remain independent and the browser API is dependency-free',()=>{
  const input=freeze({config:config({supplements:[supplement()]}),personId:'p0',month:'2026-10',shifts:[shift('pattern@2026-10-20','2026-10-26',{seriesId:'pattern',note:'  ÆØÅ 🧽 <b>literal</b>\n'.repeat(1000),noteRich:'{"type":"doc"}',metadata:{labels:['safe']}})]}),before=JSON.stringify(input),result=Payroll.estimate(input);
  assert.equal(result.shifts[0].note,input.shifts[0].note);assert.equal(result.shifts[0].noteRich,input.shifts[0].noteRich);assert.equal(result.shifts[0].seriesId,'pattern');result.shifts[0].metadata.labels.push('changed');result.agreements[0].amountCents=1;result.activeAgreement.amountCents=2;assert.equal(JSON.stringify(input),before);assert.equal(Payroll.estimate(input).activeAgreement.amountCents,18550);
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/payroll-model.js'),'utf8'),context);assert.ok(Object.isFrozen(context.CleanRoomsPayroll));assert.equal(context.CleanRoomsPayroll.estimate({config:null,personId:'p0',month:'2026-10'}).totalCents,0);assert.equal(globalThis.CleanRoomsPayroll,Payroll);
});

test('planned pauses reduce base and matching supplements using the labelled end-of-shift assumption',()=>{
  const Time=require('../src/timekeeping-model.js'),Groups=require('../src/payroll-groups-model.js');
  const configured=config({supplements:[supplement({id:'all',start:null,end:null,weekdays:[0]}),supplement({id:'late',start:'14:00',end:'15:00',weekdays:[0]})]}),planned=shift('with-pause','2026-10-26',{plannedBreakMinutes:30});
  const before=JSON.stringify(planned),result=estimate({config:configured,shifts:[planned]});
  assert.equal(result.minutes,450);assert.equal(result.shifts[0].grossMinutes,480);assert.equal(result.plannedBreakMinutes,30);assert.equal(result.baseCents,139125);
  assert.deepEqual(result.shifts[0].supplements.map(item=>[item.id,item.minutes]),[['all',450],['late',30]]);assert.equal(result.breakAllocation,'end-of-shift');assert.match(result.breakAssumption,/sidst i vagten/);assert.equal(JSON.stringify(planned),before);
  const actual={id:'actual',personId:'p0',date:planned.date,endDate:planned.date,start:planned.start,end:planned.end,plannedStart:planned.start,plannedEnd:planned.end,plannedBreakMinutes:30,breakMinutes:30,breaks:[],breakAllocation:'end-of-shift',status:'submitted'};
  const receipt=Time.payroll(actual,Groups.resolve({policy:null,personId:'p0',payroll:configured,from:planned.date,to:planned.date}));
  assert.equal(result.baseCents,receipt.baseCents);assert.equal(result.supplementCents,receipt.supplementCents);assert.equal(result.totalCents,receipt.totalCents);
  for(const pause of [-1,0.5,480,481,'30',null,NaN])assert.throws(()=>estimate({shifts:[{...planned,plannedBreakMinutes:pause}]}),/planlagte pause/);
  assert.equal(estimate({shifts:[{...planned,plannedBreakMinutes:0}]}).minutes,480);
});

test('past personal base and supplement settings are immutable, with dated ongoing replacements supported',()=>{
  const before=freeze(config({supplements:[supplement(),supplement({id:'ended',from:'2026-01-01',to:'2026-09-30'})]})),today='2026-10-26';
  for(const mutate of [value=>value.agreements[0].amountCents++,value=>value.agreements=[],value=>value.agreements.push(agreement('backdated','2026-10-01')),value=>value.supplements[0].amountCents++,value=>value.supplements[0].weekdays=[0],value=>value.supplements.shift(),value=>value.supplements[1].to='2026-10-01']){
    const next=structuredClone(before);mutate(next);assert.ok(Payroll.validateHistory(before,next,today).length);
  }
  const after=structuredClone(before);after.agreements.push(agreement('new','2026-10-26','hourly',21000));after.supplements[0].to='2026-10-25';after.supplements.push(supplement({id:'replacement',from:today,amountCents:3500}));
  assert.deepEqual(Payroll.validateHistory(before,after,today),[]);assert.deepEqual(Payroll.validateHistory(null,before,today),[]);
  after.agreements.push(agreement('future','2026-12-01','monthly',3000000));assert.deepEqual(Payroll.validateHistory(before,after,today),[]);
  const edited=structuredClone(after);edited.agreements.at(-1).amountCents=3100000;assert.deepEqual(Payroll.validateHistory(after,edited,today),[]);
});
