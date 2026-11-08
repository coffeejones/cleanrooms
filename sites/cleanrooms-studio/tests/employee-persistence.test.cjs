const test=require('node:test'),assert=require('node:assert/strict'),Employee=require('../src/employee-persistence.js');
const clone=value=>JSON.parse(JSON.stringify(value)),person={id:'person-one',name:'One'},scope={personId:person.id,from:'2026-11-02',to:'2026-11-29'},shift=(id,patch={})=>({id,person:person.id,site:0,date:'2026-11-04',start:'07:00',end:'15:00',hasDescription:true,...patch});
const page=(shifts=[],patch={})=>({ok:true,person,from:scope.from,to:scope.to,shifts,sites:[{index:0,name:'Office'}],taskSummaries:{},planRevision:5,directoryRevision:2,nextCursor:null,...patch});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};

test('personal calendar collection keeps first-page next shift and compact context across coherently versioned pages',async()=>{
 const calls=[],changes=[],client=Employee.create({transport:{action:async(action,payload)=>{calls.push({action,payload:clone(payload)});return payload.cursor?page([shift('second')],{taskSummaries:{second:{checked:2,total:6,complete:false}}}):page([shift('first')],{nextCursor:'page-two',nextShift:shift('next',{date:'2026-12-01'}),taskSummaries:{first:{checked:1,total:2,complete:false}}});}},onChange:value=>changes.push(value)});const loaded=await client.load(scope);assert.equal(loaded.ok,true);assert.deepEqual(calls,[{action:'employeeRead',payload:scope},{action:'employeeRead',payload:{...scope,cursor:'page-two'}}]);assert.deepEqual(client.data.shifts.map(value=>value.id),['first','second','next']);assert.deepEqual(client.data.taskSummaries,{first:{checked:1,total:2,complete:false},second:{checked:2,total:6,complete:false}});assert.equal(client.loading,false);assert.equal(changes.at(-1).error,'');assert.equal((await client.load(scope)).cached,true);assert.equal(calls.length,2);loaded.shifts[0].id='mutated-result';assert.equal(client.data.shifts[0].id,'first');
});

test('an initial partial bootstrap page is completed without fetching its first page again',async()=>{
 const calls=[],client=Employee.create({transport:{action:async(action,payload)=>{calls.push(payload);return page([shift('second')]);}}});assert.equal(client.seed(page([shift('first')],{nextCursor:'initial-page-two',nextShift:shift('next')})),true);assert.equal((await client.load(scope)).ok,true);assert.deepEqual(calls,[{...scope,cursor:'initial-page-two'}]);assert.deepEqual(client.data.shifts.map(value=>value.id),['first','second','next']);
});

test('a plan or directory generation change retries once and never adopts mixed personal calendar pages',async()=>{
 for(const field of ['planRevision','directoryRevision']){let attempt=0;const client=Employee.create({transport:{action:async(_action,payload)=>{if(!payload.cursor){attempt++;return page([shift('first-'+attempt)],{nextCursor:'next'});}return page([shift('second-'+attempt)],attempt===1?{[field]:999}:{});}}});assert.equal((await client.load(scope)).ok,true);assert.equal(attempt,2);assert.deepEqual(client.data.shifts.map(value=>value.id),['first-2','second-2']);}
});

test('persistent paging conflict or failure keeps no incomplete calendar and exposes a retryable error',async()=>{
 for(const status of [409,503]){let firstReads=0;const client=Employee.create({transport:{action:async(_action,payload)=>{if(!payload.cursor){firstReads++;return page([shift('incomplete')],{nextCursor:'next'});}return {ok:false,status,message:'Collection failed'};}}});const result=await client.load(scope);assert.equal(result.ok,false);assert.equal(firstReads,status===409?2:1);assert.equal(client.data,null);assert.equal(client.error,'Collection failed');assert.equal(client.loading,false);}
});

test('a slower period or person read cannot replace the latest employee calendar or leak its next shift',async()=>{
 const waits=[],client=Employee.create({transport:{action:(_action,payload)=>{const wait=deferred();waits.push({payload,wait});return wait.promise;}}}),old=client.load(scope),other={personId:'person-two',from:'2026-12-01',to:'2026-12-28'},current=client.load(other);await settle();waits[1].wait.resolve(page([shift('new',{person:other.personId})],{person:{id:other.personId,name:'Two'},from:other.from,to:other.to}));assert.equal((await current).ok,true);waits[0].wait.resolve(page([shift('old')],{nextShift:shift('old-next')}));assert.equal((await old).superseded,true);assert.equal(client.data.person.id,other.personId);assert.deepEqual(client.data.shifts.map(value=>value.id),['new']);
});

test('long descriptions live only in the selected detail and opening another month does not accumulate prior shifts or notes',async()=>{
 const long='Detailed instructions '.repeat(15000),client=Employee.create({transport:{action:async(action,payload)=>action==='employeeShift'?{ok:true,person,shift:shift(payload.shiftId,{note:long,noteRich:JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:long}]}]})}),progress:{only:'selected'}}:page([shift(payload.from)],{from:payload.from,to:payload.to})}});await client.load(scope);assert.equal(JSON.stringify(client.data).includes('Detailed instructions'),false);await client.open({personId:person.id,shiftId:'selected'});assert.equal(client.detail.shift.note,long);assert.equal(JSON.stringify(client.data).includes('Detailed instructions'),false);client.cancelDetail();assert.equal(client.detail,null);await client.load({...scope,from:'2026-12-01',to:'2026-12-28'});assert.deepEqual(client.data.shifts.map(value=>value.id),['2026-12-01']);assert.equal(client.detail,null);assert.equal(JSON.stringify(client.data).includes(scope.from),false);
});

test('closing a detail, switching period, and resetting the service each discard in-flight shift details',async()=>{
 for(const cancel of ['close','period','reset']){const wait=deferred(),client=Employee.create({transport:{action:async action=>action==='employeeShift'?wait.promise:page([shift('calendar')])}});await client.load(scope);const opening=client.open({personId:person.id,shiftId:'detail'});if(cancel==='close')client.cancelDetail();else if(cancel==='reset')client.reset();else await client.load({...scope,from:'2026-12-01',to:'2026-12-28'});wait.resolve({ok:true,shift:shift('detail',{note:'Late private description'})});assert.equal((await opening).superseded,true,cancel);assert.equal(client.detail,null);}
});

test('a wrong person in a calendar or a wrong detail identity fails closed',async()=>{
 const client=Employee.create({transport:{action:async action=>action==='employeeShift'?{ok:true,shift:shift('foreign',{person:'person-other'})}:page([shift('foreign',{person:'person-other'})])}});assert.equal((await client.load(scope)).ok,false);assert.equal(client.data,null);assert.equal((await client.open({personId:person.id,shiftId:'expected'})).ok,false);assert.equal(client.detail,null);
});

test('a new bootstrap supersedes outstanding calendar and detail reads for the previous identity',async()=>{
 const calendar=deferred(),detail=deferred(),client=Employee.create({transport:{action:action=>action==='employeeShift'?detail.promise:calendar.promise}}),loading=client.load(scope),opening=client.open({personId:person.id,shiftId:'old-detail'});const replacement=page([shift('new',{person:'person-two'})],{person:{id:'person-two',name:'Two'}});assert.equal(client.seed(replacement),true);calendar.resolve(page([shift('old')]));detail.resolve({ok:true,shift:shift('old-detail',{note:'Old identity details'})});assert.equal((await loading).superseded,true);assert.equal((await opening).superseded,true);assert.equal(client.data.person.id,'person-two');assert.equal(client.detail,null);
});

test('a complete bootstrap keeps the next shift strip available when that shift is outside the selected calendar period',async()=>{
 let reads=0;const client=Employee.create({transport:{action:async()=>{reads++;throw Error('The complete bootstrap should be reused');}}}),next=shift('outside-next',{date:'2026-12-02'});assert.equal(client.seed(page([],{nextShift:next,taskSummaries:{'outside-next':{checked:1,total:6,complete:false}}})),true);assert.deepEqual(client.data.shifts.map(value=>value.id),['outside-next']);assert.equal(client.data.nextShift.date,'2026-12-02');assert.equal((await client.load(scope)).cached,true);assert.equal(reads,0);assert.equal(client.data.taskSummaries['outside-next'].checked,1);
});
