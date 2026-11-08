const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Groups=require('../src/payroll-groups-model.js');
const Payroll=require('../src/payroll-model.js');
const base=(amountCents=10000,type='hourly',from='2026-01-01',id='base')=>({id,from,type,amountCents});
const addon=(id='extra',amountCents=1000,extra={})=>({id,name:'Tillæg '+id,type:'hourly',amountCents,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4,5,6],start:null,end:null,...extra});
const payroll=(agreements=[base()],supplements=[])=>({currency:'DKK',agreements,supplements});
const revision=(id='r1',from='2026-01-01',pay=payroll())=>({id,from,payroll:pay});
const group=(id='g1',revisions=[revision()],extra={})=>({id,name:'Løngruppe '+id,archived:false,revisions,...extra});
const link=(personId='p0',from='2026-01-01',groupId='g1',extra={})=>({personId,from,groupId,baseMode:groupId?'group':'personal',excludedPersonalSupplementIds:[],supplementOverrides:[],...extra});
const policy=(groups=[group()],links=[link()])=>({schema:1,groups,links});
const resolve=(extra={})=>Groups.resolve({policy:policy(),personId:'p0',payroll:payroll([base(15000)]),from:'2026-10-01',to:'2026-10-31',...extra});
const shift=(id,date='2026-10-26',extra={})=>({id,person:'p0',date,site:0,start:'07:00',end:'08:00',note:'',...extra});
const estimate=(resolved,shifts=[],month='2026-10')=>Payroll.estimate({config:resolved.payroll,personId:'p0',month,shifts});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('canonical normalization sorts dated full snapshots and does not generate or rewrite stable IDs',()=>{
  assert.deepEqual(Groups.normalize(),{schema:1,groups:[],links:[]});assert.deepEqual(Groups.validate(null),[]);
  const input=freeze(policy([group('b',[revision('new','2026-10-16'),revision('old','2026-01-01')]),group('a')],[link('p0','2026-10-16','b'),link('p1','2026-01-01','a'),link('p0','2026-01-01','a')])),before=JSON.stringify(input),result=Groups.normalize(input);
  assert.deepEqual(result.groups.map(item=>item.id),['a','b']);assert.deepEqual(result.groups[1].revisions.map(item=>item.id),['old','new']);assert.deepEqual(result.links.map(item=>[item.personId,item.from]),[['p0','2026-01-01'],['p0','2026-10-16'],['p1','2026-01-01']]);result.groups[0].name='Changed';assert.equal(JSON.stringify(input),before);
  assert.equal(Groups.linkFor(input,'p0','2026-10-15').groupId,'a');assert.equal(Groups.linkFor(input,'p0','2026-10-16').groupId,'b');assert.equal(Groups.linkFor(input,'unknown','2026-10-16'),null);assert.equal(Groups.groupFor(input,'b','2026-10-16').revision.id,'new');assert.equal(Groups.groupFor(input,'b','2025-12-31').revision,null);
});

test('a dated group revision changes only its period and a superseded future base agreement cannot escape its revision',()=>{
  const configured=policy([group('g1',[revision('old','2026-01-01',payroll([base(10000),base(99999,'hourly','2026-10-20','obsolete-future')])),revision('new','2026-10-16',payroll([base(20000)]))])]);
  const result=resolve({policy:configured}),total=estimate(result,[shift('old','2026-10-15'),shift('new','2026-10-16'),shift('later','2026-10-21')]);
  assert.equal(total.baseCents,50000);assert.deepEqual(total.shifts.map(item=>item.baseCents),[10000,20000,20000]);assert.equal(result.payroll.agreements.length,2);assert.equal(result.currentGroup.revision.id,'new');assert.equal(result.currentLink.groupId,'g1');assert.equal(result.personalBase,false);
  const prior=resolve({policy:configured,from:'2026-09-01',to:'2026-09-30'});assert.equal(prior.payroll.agreements[0].amountCents,10000);assert.equal(prior.group.revision.id,'old');assert.equal(Object.values(result.sources.agreements).every(source=>source.origin==='group'&&source.groupId==='g1'),true);
});

test('switching monthly groups mid-month prorates calendar days without depending on work hours',()=>{
  const configured=policy([group('g1',[revision('a','2026-01-01',payroll([base(3100000,'monthly')]))]),group('g2',[revision('b','2026-01-01',payroll([base(6200000,'monthly')]))])],[link(),link('p0','2026-10-16','g2')]);
  const result=resolve({policy:configured}),noWork=estimate(result),working=estimate(result,[shift('one','2026-10-01'),shift('other','2026-10-31',{end:'15:00'})]);
  assert.equal(noWork.baseCents,4700000);assert.equal(working.baseCents,noWork.baseCents);assert.deepEqual(noWork.lines.map(line=>[line.days,line.amountCents]),[[15,1500000],[16,3200000]]);assert.equal(result.currentGroup.id,'g2');assert.equal(result.currentLink.from,'2026-10-16');assert.deepEqual(result.missingBasePeriods,[]);
});

test('personal base exceptions survive group rate changes while group supplements remain inherited',()=>{
  const configured=policy([group('g1',[revision('old','2026-01-01',payroll([base(10000)],[addon('group-extra',1000)])),revision('new','2026-10-16',payroll([base(20000)],[addon('group-extra',2000)]))])],[link('p0','2026-01-01','g1',{baseMode:'personal'})]);
  const result=resolve({policy:configured,payroll:payroll([base(17500)])}),total=estimate(result,[shift('before','2026-10-15'),shift('after','2026-10-16')]);
  assert.equal(result.personalBase,true);assert.equal(result.payroll.agreements.length,1);assert.equal(total.baseCents,35000);assert.equal(total.supplementCents,3000);assert.equal(Object.values(result.sources.agreements)[0].origin,'personal');assert.equal(Object.values(result.sources.agreements)[0].groupId,null);
});

test('group add-ons, raw personal add-ons, exclusions and personal replacements are independent and additive',()=>{
  const fixed=addon('fixed',31000,{type:'monthly',weekdays:[],start:null,end:null});
  const configured=policy([group('g1',[revision('r1','2026-01-01',payroll([base()],[addon('off',1000),addon('replace',3000),fixed]))])],[link('p0','2026-01-01','g1',{excludedPersonalSupplementIds:['exclude'],supplementOverrides:[{id:'off',mode:'off',supplement:null},{id:'replace',mode:'personal',supplement:addon('replacement-personal',900)}]})]);
  const result=resolve({policy:configured,payroll:payroll([base(15000)],[addon('exclude',500),addon('add',700)])}),total=estimate(result,[shift('work','2026-10-26',{end:'09:00'})]);
  assert.equal(total.supplementCents,34200);assert.equal(total.shifts[0].supplementCents,3200);assert.equal(total.supplementCents-total.shifts[0].supplementCents,31000);
  const sources=Object.values(result.sources.supplements);assert.equal(sources.some(source=>source.sourceId==='off'||source.sourceId==='exclude'),false);assert.ok(sources.some(source=>source.sourceId==='add'&&source.origin==='personal'&&source.groupId===null));assert.ok(sources.some(source=>source.sourceId==='replacement-personal'&&source.origin==='personal'&&source.override===true&&source.targetId==='replace'));assert.ok(sources.some(source=>source.sourceId==='fixed'&&source.origin==='group'));
});

test('overnight group windows keep the prior-day anchor across a month boundary and a dated group departure',()=>{
  const night=addon('night',1000,{weekdays:[2],start:'22:00',end:'06:00'}),configured=policy([group('g1',[revision('r1','2026-01-01',payroll([base()],[night]))])],[link(),link('p0','2026-10-01',null)]);
  const result=resolve({policy:configured}),total=estimate(result,[shift('morning','2026-10-01',{start:'05:00',end:'07:00'})]);
  assert.equal(total.supplementCents,1000);assert.equal(result.personalBase,true);assert.equal(result.payroll.supplements.length,1);assert.equal(result.payroll.supplements[0].from,'2026-09-30');assert.equal(result.payroll.supplements[0].to,'2026-09-30');assert.equal(Object.values(result.sources.supplements)[0].groupId,'g1');
});

test('choosing an empty personal base ends an inherited rate with a missing sentinel rather than carrying old wages',()=>{
  const result=resolve({policy:policy([group()],[link(),link('p0','2026-10-16',null)]),payroll:null}),total=estimate(result,[shift('before','2026-10-15'),shift('missing','2026-10-16')]);
  assert.equal(total.baseCents,10000);assert.equal(total.shifts[1].baseCents,0);assert.deepEqual(result.missingBasePeriods,[{from:'2026-10-16',to:'2026-10-31'}]);assert.equal(result.payroll.agreements.length,2);assert.equal(result.payroll.agreements[1].amountCents,0);assert.equal(result.sources.agreements[result.payroll.agreements[1].id].origin,'missing');
  const initiallyMissing=resolve({policy:null,payroll:payroll([base(20000,'hourly','2026-10-16')])});assert.deepEqual(initiallyMissing.missingBasePeriods,[{from:'2026-10-01',to:'2026-10-15'}]);assert.equal(initiallyMissing.payroll.agreements.length,1);assert.equal(initiallyMissing.payroll.agreements[0].from,'2026-10-16');
});

test('archiving preserves existing linked history and absent links simply resolve the raw personal agreement',()=>{
  const archived=resolve({policy:policy([group('g1',[revision()],{archived:true})])});assert.equal(archived.group.archived,true);assert.equal(archived.payroll.agreements[0].amountCents,10000);
  const personal=resolve({policy:null,payroll:payroll([base(18000)])});assert.equal(personal.group,null);assert.equal(personal.currentLink,null);assert.equal(personal.personalBase,true);assert.equal(personal.payroll.agreements[0].amountCents,18000);
});

test('preview sees future changes, unchanged people and preserved personal bases even when group add-ons change',()=>{
  const before=policy([group('g1',[revision('old','2026-01-01',payroll([base(10000)],[addon('extra',1000)]))])],[link('p0'),link('p1','2026-01-01','g1',{baseMode:'personal'})]);
  const after=Groups.normalize(before);after.groups[0].revisions.push(revision('new','2026-11-01',payroll([base(20000)],[addon('extra',2000)])));
  const people=[{personId:'p0',name:'Anna',payroll:payroll([base(17500)]),version:3},{personId:'p1',name:'Bob',payroll:payroll([base(18000)]),version:4},{personId:'p2',name:'Clara',payroll:payroll([base(19000)]),version:5}],result=Groups.preview({before,after,people,date:'2026-10-01'});
  assert.deepEqual(result.counts,{total:3,affected:2,unchanged:1,personalPreserved:1,missingBase:0});assert.deepEqual(result.affected.map(row=>row.personId),['p0','p1']);assert.equal(result.unchanged[0].personId,'p2');assert.equal(result.personalPreserved[0].personId,'p1');assert.equal(result.affected[0].effectiveFrom,'2026-11-01');assert.equal(result.affected[0].baseChanged,true);assert.equal(result.affected[0].before.base.amountCents,10000);assert.equal(result.affected[0].after.base.amountCents,20000);assert.equal(result.affected[1].baseChanged,false);assert.equal(result.affected[1].supplementsChanged,true);assert.equal(result.affected[1].personalPreserved,true);assert.equal(result.affected[1].before.base.amountCents,18000);
});

test('preview reports missing personal bases and does not treat a metadata-only revision ID as a pay change',()=>{
  const before=policy([group('g1',[revision('r1','2026-01-01',payroll([base()],[addon('night',1000,{start:'22:00',end:'06:00'})]))])]),same=Groups.normalize(before);same.groups[0].revisions.push(revision('same-rate','2026-10-16',payroll([base()],[addon('night',1000,{start:'22:00',end:'06:00'})])));
  const people=[{personId:'p0',name:'Anna',payroll:null,version:0}],unchanged=Groups.preview({before,after:same,people,date:'2026-10-01'});assert.equal(unchanged.counts.affected,0);
  const after=Groups.normalize(before);after.links.push(link('p0','2026-10-16',null));const changed=Groups.preview({before,after,people,date:'2026-10-01'});assert.equal(changed.counts.affected,1);assert.equal(changed.counts.missingBase,1);assert.equal(changed.affected[0].after.missingBase,true);assert.equal(changed.affected[0].effectiveFrom,'2026-10-16');
});

test('preview includes the previous revision overnight amount still applicable on the review morning',()=>{
  const before=policy([group('g1',[revision('old','2026-01-01',payroll([base()],[addon('night',1000,{weekdays:[2],start:'22:00',end:'06:00'})])),revision('new','2026-10-01',payroll())])]),after=Groups.normalize(before);
  after.groups[0].revisions[0].payroll.supplements[0].amountCents=2000;
  const result=Groups.preview({before,after,people:[{personId:'p0',name:'Anna',payroll:null,version:0}],date:'2026-10-01'});
  assert.equal(result.counts.affected,1);assert.equal(result.affected[0].effectiveFrom,'2026-10-01');assert.equal(result.affected[0].baseChanged,false);assert.equal(result.affected[0].supplementsChanged,true);assert.equal(result.affected[0].before.supplements[0].carryFrom,'2026-09-30');assert.equal(result.affected[0].after.supplements[0].amountCents,2000);
});

test('malformed policy identities, references, revision bases and ambiguous link/override modes fail closed',()=>{
  const mutations=[value=>value.schema=2,value=>value.extra=true,value=>value.groups.push(group()),value=>value.groups[0].name=' ',value=>value.groups[0].archived='yes',value=>value.groups[0].revisions=[],value=>value.groups[0].revisions.push(revision()),value=>value.groups[0].revisions[0].from='2026-02-30',value=>value.groups[0].revisions[0].payroll=payroll([]),value=>value.groups[0].revisions[0].payroll=payroll([base(10000,'hourly','2027-01-01')]),value=>value.links.push(link()),value=>value.links[0].groupId='missing',value=>value.links[0].from='2026-02-30',value=>value.links[0].baseMode='percent',value=>value.links[0].excludedPersonalSupplementIds=['x','x'],value=>value.links[0].supplementOverrides=[{id:'unknown',mode:'off',supplement:null}],value=>value.links[0].supplementOverrides=[{id:'extra',mode:'off',supplement:addon()}],value=>value.links[0].supplementOverrides=[{id:'extra',mode:'personal',supplement:null}]];
  for(const mutate of mutations){const value=policy([group('g1',[revision('r1','2026-01-01',payroll([base()],[addon()]))])]);mutate(value);assert.ok(Groups.validate(value).length,JSON.stringify(value));assert.throws(()=>Groups.normalize(value),TypeError);}
  assert.throws(()=>resolve({from:'2026-02-30'}),TypeError);assert.throws(()=>resolve({to:'2026-09-30'}),RangeError);assert.throws(()=>resolve({from:'2025-10-01',to:'2026-10-31'}),RangeError);assert.throws(()=>resolve({personId:''}),TypeError);
  assert.throws(()=>Groups.preview({before:null,after:null,people:[{personId:'p0'},{personId:'p0'}],date:'2026-10-01'}),TypeError);
});

test('historical override targets remain valid after removal in a later revision and compilation IDs are deterministic and unique',()=>{
  const configured=policy([group('g1',[revision('first','2026-01-01',payroll([base()],[addon('same')])),revision('later','2026-10-16',payroll([base(20000)]))])],[link('p0','2026-01-01','g1',{supplementOverrides:[{id:'same',mode:'off',supplement:null}]})]);
  assert.deepEqual(Groups.validate(configured),[]);const first=resolve({policy:configured}),second=resolve({policy:Groups.normalize(configured)});assert.deepEqual(first,second);assert.equal(first.payroll.supplements.length,0);const ids=first.payroll.agreements.map(item=>item.id);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>id.length<40&&!id.includes('p0')));
});

test('frozen private inputs remain untouched and independent while browser/CommonJS expose the same compiler API',()=>{
  const input=freeze({policy:policy([group('g1',[revision('r1','2026-01-01',payroll([base()],[addon()]))])]),personId:'p0',payroll:payroll([base(18000)],[addon('personal',500)]),from:'2026-10-01',to:'2026-10-31'}),before=JSON.stringify(input),result=Groups.resolve(input);
  result.payroll.agreements[0].amountCents=1;result.currentGroup.name='Changed';Object.values(result.sources.supplements)[0].groupName='Changed';assert.equal(JSON.stringify(input),before);assert.equal(Groups.resolve(input).payroll.agreements[0].amountCents,10000);
  const context=vm.createContext({CleanRoomsPayroll:Payroll});vm.runInContext(fs.readFileSync(require.resolve('../src/payroll-groups-model.js'),'utf8'),context);assert.ok(Object.isFrozen(context.CleanRoomsPayrollGroups));assert.equal(context.CleanRoomsPayrollGroups.resolve(input).payroll.agreements[0].amountCents,10000);assert.equal(globalThis.CleanRoomsPayrollGroups,Groups);
});
