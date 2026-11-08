const test=require('node:test');
const assert=require('node:assert/strict');
const Availability=require('../src/planning-availability.js');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const receipt=(payload,version=0,dates=[])=>({ok:true,from:payload.from,to:payload.to,people:payload.personIds.map(personId=>({personId,version,unavailableDates:dates.filter(day=>day>=payload.from&&day<=payload.to)}))});
const scope={from:'2026-11-02',to:'2026-11-08',personIds:['p0']};

test('availability reads stay scoped, deduplicate pending and fresh coverage and expire without inventing availability',async()=>{
  const wait=deferred(),calls=[];let time=0,updates=0;const reader=Availability.create({now:()=>time,request:payload=>{calls.push(payload);return calls.length===1?wait.promise:Promise.resolve(receipt(payload,2,[]));},onUpdate:()=>updates++});reader.setContext('workspace:user');
  assert.equal(reader.status('p0',scope.from),'unknown');const pending=reader.ensure(scope);await Promise.resolve();assert.equal(reader.status('p0',scope.from),'loading');await reader.ensure(scope);assert.equal(calls.length,1);assert.deepEqual(calls[0],scope);
  wait.resolve(receipt(scope,1,['2026-11-03']));assert.equal((await pending).ok,true);assert.equal(reader.isUnavailable('p0','2026-11-03'),true);assert.equal(reader.status('p0',scope.from),'ready');assert.deepEqual(reader.dates('p0',scope.from,scope.to),['2026-11-03']);
  await reader.ensure({from:'2026-11-03',to:'2026-11-04',personIds:['p0']});assert.equal(calls.length,1);time=30001;assert.equal(reader.status('p0',scope.from),'unknown');await reader.ensure(scope);assert.equal(calls.length,2);assert.equal(reader.isUnavailable('p0','2026-11-03'),false);assert.equal(updates,2);
});
test('range and identity limits reject oversized or malformed requests before transport',async()=>{
  const calls=[],reader=Availability.create({request:payload=>{calls.push(payload);return Promise.resolve(receipt(payload));}});reader.setContext('w');
  for(const draft of [{...scope,to:'2026-12-28'},{...scope,from:'2026-99-01'},{...scope,to:'2026-02-30'},{...scope,personIds:Array.from({length:501},(_,index)=>'p'+index)}])assert.equal((await reader.ensure(draft)).ok,false);
  assert.equal(calls.length,0);assert.equal((await reader.ensure({from:'2026-11-02',to:'2026-12-27',personIds:Array.from({length:500},(_,index)=>'p'+index)})).ok,true);assert.equal(calls[0].personIds.length,500);
});
test('malformed mixed responses apply atomically and errors remain explicit with bounded retry',async()=>{
  let time=0,count=0;const reader=Availability.create({now:()=>time,request:async payload=>{count++;return count===1?{...receipt(payload,1,['2026-11-03']),people:[{personId:'p0',version:1,unavailableDates:['2026-11-03']},{personId:'someone-else',version:1,unavailableDates:[]}]}:receipt(payload,1,['2026-11-03']);}});reader.setContext('w');
  const request={...scope,personIds:['p0','p1']};assert.equal((await reader.ensure(request)).ok,false);assert.equal(reader.status('p0',scope.from),'error');assert.equal(reader.isUnavailable('p0','2026-11-03'),false);await reader.ensure(request);assert.equal(count,1);time=10001;await reader.ensure(request);assert.equal(count,2);assert.equal(reader.isUnavailable('p0','2026-11-03'),true);
});
test('late older employee versions cannot overwrite newer marks and context changes fence pending responses',async()=>{
  const waits=[],reader=Availability.create({request:payload=>{const wait=deferred();waits.push({payload,...wait});return wait.promise;}});reader.setContext('a');
  const first=reader.ensure(scope),otherScope={...scope,from:'2026-11-09',to:'2026-11-15'},second=reader.ensure(otherScope);await Promise.resolve();waits[1].resolve(receipt(otherScope,2,['2026-11-10']));await second;waits[0].resolve(receipt(scope,1,['2026-11-03']));await first;
  assert.equal(reader.isUnavailable('p0','2026-11-10'),true);assert.equal(reader.isUnavailable('p0','2026-11-03'),false);assert.equal(reader.status('p0',scope.from),'unknown');
  const third=reader.ensure(scope);await Promise.resolve();reader.setContext('b');waits[2].resolve(receipt(scope,3,['2026-11-03']));assert.equal((await third).stale,true);assert.equal(reader.isUnavailable('p0','2026-11-03'),false);assert.equal(reader.isUnavailable('p0','2026-11-10'),false);
});
test('concurrent picker and calendar work uses at most two transports',async()=>{
  const waits=[],reader=Availability.create({request:payload=>{const wait=deferred();waits.push({payload,...wait});return wait.promise;}});reader.setContext('w');
  const pending=[reader.ensure(scope),reader.ensure({...scope,personIds:['p1']}),reader.ensure({...scope,personIds:['p2']})];await Promise.resolve();assert.equal(waits.length,2);waits[0].resolve(receipt(waits[0].payload));await pending[0];assert.equal(waits.length,3);waits[1].resolve(receipt(waits[1].payload));waits[2].resolve(receipt(waits[2].payload));await Promise.all(pending);
});
test('overnight warnings include each worked calendar day but exclude a midnight-only boundary',()=>{
  assert.deepEqual(Availability.workedDates({date:'2026-11-02',start:'22:00',end:'06:00'}),['2026-11-02','2026-11-03']);assert.deepEqual(Availability.workedDates({date:'2026-11-02',start:'22:00',end:'00:00'}),['2026-11-02']);assert.deepEqual(Availability.workedDates({date:'2026-11-02',start:'08:00',end:'16:00'}),['2026-11-02']);assert.deepEqual(Availability.workedDates({date:'bad'}),[]);
});
