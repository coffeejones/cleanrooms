const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Members=require('../src/payroll-group-members.js');
const Payroll=require('../src/payroll-model.js');
const Groups=require('../src/payroll-groups-model.js');
const date='2026-10-31';
const rate=(amountCents=18550,from='2026-01-01',type='hourly',id='base')=>({id,from,type,amountCents});
const rule=(id='morning',patch={})=>({id,name:id,type:'hourly',amountCents:2000,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4],start:'06:00',end:'08:00',...patch});
const config=(amount=18550,supplements=[],agreements)=>({currency:'DKK',agreements:agreements||[rate(amount)],supplements});
const group=(id='g1',patch={})=>({id,name:'Daghold',archived:false,revisions:[{id:id+'-v1',from:'2026-01-01',payroll:config(18550,[rule()])}],...patch});
const link=(personId='p1',patch={})=>({personId,from:'2026-01-01',groupId:'g1',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[],...patch});
const person=(personId='p1',payroll=null)=>({personId,name:personId==='p1'?'Emma Nielsen':personId,payroll,version:payroll?1:0});
const policy=(links=[link()],groups=[group()])=>({schema:1,groups,links});
const build=(value=policy(),people=[person()],day=date,patch={})=>Members.build({policy:value,people,date:day,...patch});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

test('current members are split by effective group salary, personal salary, and missing base with exclusive counts',()=>{
  const value=policy([link('p1'),link('p2',{baseMode:'personal'}),link('p3',{baseMode:'personal'})]);
  const result=build(value,[person(),person('p2',config(19800)),person('p3')]);
  assert.deepEqual(result.groups[0].counts,{total:3,group:1,personal:1,missing:1,upcoming:0});
  assert.equal(result.members[0].status,'group');assert.equal(result.members[0].label,'Følger gruppen');assert.equal(result.members[0].followsBase,true);assert.equal(result.members[0].followsSupplements,true);assert.equal(result.members[0].base.origin,'group');assert.equal(result.members[0].base.amountCents,18550);
  assert.equal(result.members[1].label,'Personlige undtagelser');assert.equal(result.members[1].base.amountCents,19800);assert.equal(result.members[1].exceptions[0].groupAmountCents,18550);
  assert.equal(result.members[2].status,'missing');assert.equal(result.members[2].base.origin,'missing');assert.equal(result.members[2].base.amountCents,null);assert.equal(result.members[2].label,'Grundløn mangler');
});

test('an explicit personal base remains an exception even when its amount matches the group and group changes do not become a personal change',()=>{
  const future={id:'g1-v2',from:'2026-12-01',payroll:config(19000,[rule()])};
  const value=policy([link('p1',{baseMode:'personal'}),link('p2')],[group('g1',{revisions:[...group().revisions,future]})]);
  const result=build(value,[person('p1',config()),person('p2')]);
  assert.equal(result.members[0].status,'personal');assert.equal(result.members[0].upcoming,null);assert.equal(result.members[0].exceptions[0].amountCents,18550);
  assert.equal(result.members[1].status,'group');assert.equal(result.members[1].upcoming.date,'2026-12-01');assert.equal(result.members[1].upcoming.base.amountCents,19000);assert.equal(result.members[1].upcoming.kind,'terms');
  assert.deepEqual(result.groups[0].counts,{total:2,group:1,personal:1,missing:0,upcoming:1});
});

test('current custom and disabled group allowances are exceptions while expired or removed historical rules are ignored',()=>{
  const old=group();old.revisions[0].payroll.supplements.push(rule('removed'));
  old.revisions.push({id:'current',from:'2026-10-01',payroll:config(18550,[rule(),rule('expired',{to:'2026-09-30'}),rule('evening',{start:'18:00',end:'23:00'})])});
  const value=policy([link('p1',{supplementOverrides:[{id:'morning',mode:'personal',supplement:rule('my-rate',{amountCents:3000})},{id:'evening',mode:'off',supplement:null},{id:'expired',mode:'off',supplement:null},{id:'removed',mode:'off',supplement:null}]})],[old]);
  const member=build(value).members[0];assert.equal(member.status,'personal');assert.equal(member.followsBase,true);assert.equal(member.followsSupplements,false);assert.equal(member.exceptionCount,2);
  assert.deepEqual(member.exceptions.map(item=>item.kind),['supplement-off','supplement-personal']);
  const own=member.exceptions.find(item=>item.kind==='supplement-personal');assert.equal(own.name,'morning');assert.equal(own.amountCents,3000);assert.equal(own.groupAmountCents,2000);assert.equal(own.id,'morning');assert.equal(own.rule.id,'my-rate');
  const off=member.exceptions.find(item=>item.kind==='supplement-off');assert.equal(off.name,'evening');assert.equal(off.amountCents,null);assert.equal(off.groupAmountCents,2000);
});

test('personal extras count only while active and included; stored personal bases do not override group mode',()=>{
  const raw=config(25000,[rule('extra'),rule('excluded'),rule('old',{to:'2026-10-30'}),rule('future',{from:'2026-11-01'})]);
  const member=build(policy([link('p1',{excludedPersonalSupplementIds:['excluded']})]),[person('p1',raw)]).members[0];
  assert.equal(member.base.amountCents,18550);assert.equal(member.followsBase,true);assert.equal(member.status,'personal');assert.equal(member.exceptionCount,1);assert.equal(member.exceptions[0].kind,'personal-extra');assert.equal(member.exceptions[0].name,'extra');
  assert.equal(member.upcoming.date,'2026-11-01');assert.equal(member.upcoming.exceptions.filter(item=>item.kind==='personal-extra').length,2);
});

test('a future dated personal snapshot is separate from the current follower status',()=>{
  const value=policy([link('p1'),link('p1',{from:'2026-11-15',baseMode:'personal'})]);
  const raw=config(19800),current=build(value,[person('p1',raw)]).members[0];
  assert.equal(current.status,'group');assert.equal(current.exceptionCount,0);assert.equal(current.upcoming.date,'2026-11-15');assert.equal(current.upcoming.status,'personal');assert.equal(current.upcoming.base.amountCents,19800);assert.equal(current.upcoming.exceptions[0].kind,'base');
  const next=build(value,[person('p1',raw)],'2026-11-15').members[0];assert.equal(next.status,'personal');assert.equal(next.activeFrom,'2026-11-15');assert.equal(next.upcoming,null);
});

test('future group assignments and removed memberships are described without counting them as current memberships',()=>{
  const value=policy([link('p1',{from:'2026-11-01'}),link('p2'),link('p2',{from:'2026-12-01',groupId:null,baseMode:'personal'})]);
  const result=build(value,[person(),person('p2',config(17500))]);
  assert.equal(result.members[0].groupId,null);assert.equal(result.members[0].status,'missing');assert.equal(result.members[0].upcoming.kind,'assignment');assert.equal(result.members[0].upcoming.groupId,'g1');
  assert.equal(result.groups[0].counts.total,1);assert.equal(result.members[1].upcoming.kind,'assignment');assert.equal(result.members[1].upcoming.groupId,null);assert.equal(result.members[1].upcoming.base.amountCents,17500);
});

test('a personal copy uses its own validity and the current group rule identity, including a copy that has expired',()=>{
  const value=policy([link('p1',{supplementOverrides:[{id:'morning',mode:'personal',supplement:rule('short-personal',{to:'2026-10-30',amountCents:3000})}]})]);
  const current=build(value).members[0];assert.equal(current.status,'personal');assert.equal(current.exceptions[0].amountCents,null);assert.equal(current.exceptions[0].label,'Personligt tillæg er udløbet');
  const ended=policy([link('p1',{supplementOverrides:[{id:'morning',mode:'personal',supplement:rule('long-personal',{amountCents:3000})}]})],[group('g1',{revisions:[{id:'v1',from:'2026-01-01',payroll:config(18550,[rule('morning',{to:'2026-10-30'})])}]})]);
  assert.equal(build(ended).members[0].exceptions[0].amountCents,3000,'A current revision still refers to the overridden rule even if the group rule validity ended.');
});

test('archive and group filtering retain effective history and preserve frozen inputs and independent output copies',()=>{
  const value=freeze(policy([link(),link('p2',{groupId:'g2'})],[group('g1',{archived:true}),group('g2')])),people=freeze([person(),person('p2')]);
  const before=JSON.stringify({value,people}),result=build(value,people,date,{groupId:'g1'});
  assert.equal(result.groups.length,1);assert.equal(result.groups[0].archived,true);assert.equal(result.members.length,1);assert.equal(result.members[0].groupName,'Daghold');assert.equal(JSON.stringify({value,people}),before);
  result.members[0].name='Changed';assert.equal(build(value,people).members[0].name,'Emma Nielsen');assert.deepEqual(build(value,people,date,{groupId:'missing'}).groups,[]);
});

test('invalid dates, duplicate identities, malformed configurations and policies fail explicitly instead of fabricating member status',()=>{
  for(const day of ['2026-02-30','0000-01-01','2026-1-01',''])assert.throws(()=>build(policy(),[person()],day));
  assert.throws(()=>build(policy(),[person(),person()]));assert.throws(()=>build(policy(),[{personId:'p1',name:'Missing payroll'}]));assert.throws(()=>build(policy(),[{personId:'p1',name:'Name',payroll:{currency:'USD',agreements:[],supplements:[]}}]));assert.throws(()=>build({schema:2,groups:[],links:[]}));assert.throws(()=>Members.build({policy:policy(),people:null,date}));
});

test('the same frozen API is available in browsers without CommonJS or a DOM',()=>{
  const context=vm.createContext({CleanRoomsPayroll:Payroll,CleanRoomsPayrollGroups:Groups});
  vm.runInContext(fs.readFileSync(require.resolve('../src/payroll-group-members.js'),'utf8'),context);
  assert.equal(Object.isFrozen(context.CleanRoomsPayrollGroupMembers),true);const actual=context.CleanRoomsPayrollGroupMembers.build({policy:policy(),people:[person()],date});assert.equal(actual.members[0].base.amountCents,18550);assert.equal(actual.members[0].status,'group');
});


test('a future rule start/end produces a separate upcoming indicator while same-value explicit overrides remain personal',()=>{
  const value=policy([link('p1',{supplementOverrides:[{id:'morning',mode:'personal',supplement:rule('copy')}]})]);
  assert.equal(build(value).members[0].status,'personal');assert.equal(build(value).members[0].exceptionCount,1);
  const futurePolicy=policy([link()],[group('g1',{revisions:[{id:'current',from:'2026-01-01',payroll:config(18550,[rule('later',{from:'2026-11-01',to:'2026-11-05'})])}]})]);
  const current=build(futurePolicy).members[0];assert.equal(current.status,'group');assert.equal(current.upcoming.date,'2026-11-01');
  assert.equal(build(futurePolicy,[person()],'2026-11-01').members[0].upcoming.date,'2026-11-06');
});

test('large-roster summaries keep payroll resolution scoped per person while retaining authoritative base sources',()=>{
  const second=group('g2',{name:'Aften',revisions:[{id:'g2-v1',from:'2026-01-01',payroll:config(19500,[rule('evening',{start:'18:00',end:'23:00'})])}]});
  const people=Array.from({length:500},(_,index)=>person('worker-'+index,index%5===0?config(21000):null));
  const links=people.flatMap((entry,index)=>[link(entry.personId,{baseMode:index%5===0?'personal':'group'}),...(index%10===0?[link(entry.personId,{from:'2026-12-01',groupId:'g2'})]:[])]);
  const value=policy(links,[group(),second]),requests=[];
  const context=vm.createContext({CleanRoomsPayroll:Payroll,CleanRoomsPayrollGroups:{...Groups,resolve:request=>{requests.push({people:request.policy.links.map(item=>item.personId),groups:request.policy.groups.length});return Groups.resolve(request);}}});
  vm.runInContext(fs.readFileSync(require.resolve('../src/payroll-group-members.js'),'utf8'),context);
  const result=context.CleanRoomsPayrollGroupMembers.build({policy:value,people,date});
  assert.equal(result.members.length,500);assert.deepEqual(JSON.parse(JSON.stringify(result.groups[0].counts)),{total:500,group:400,personal:100,missing:0,upcoming:50});
  assert.equal(requests.length,500);assert.ok(requests.every(request=>request.people.length<=2&&new Set(request.people).size===1&&request.groups<=2),'One member must not cause every colleague’s links to be revalidated.');
  for(const day of [date,'2026-12-01'])for(const index of [0,1,5,10,499]){
    const member=Members.build({policy:value,people:[people[index]],date:day}).members[0],reference=Groups.resolve({policy:value,personId:people[index].personId,payroll:people[index].payroll,from:day,to:day}).periods[0];
    assert.equal(member.base.origin,reference.source.origin);assert.equal(member.base.amountCents,reference.base?.amountCents??null);assert.equal(member.base.type,reference.base?.type??null);
  }
});

test('scoping members never skips validation of malformed unrelated policy references',()=>{
  const malformed=policy([link(),link('unrelated',{groupId:'missing-group'})]);
  assert.throws(()=>Members.build({policy:malformed,people:[person()],date,groupId:'g1'}));
});
