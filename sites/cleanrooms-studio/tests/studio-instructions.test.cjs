const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/studio-persistence.js'),'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const loadedState = (studio,manageDepartments=false) => ({ok:true,studio,employee:null,viewer:null,workspace:null,capabilities:{manageDepartments,manageUsers:false,manageRoles:false,viewPayroll:false,managePayroll:false,managePayrollGroups:false,chat:false,manageChat:false,plan:false,previewEmployees:false}});
const drain = () => new Promise(resolve => setImmediate(resolve));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function receipt(promise) {
  const result = {settled:false,value:undefined};
  promise.then(value => { result.settled=true; result.value=value; });
  return result;
}

function harness() {
  let now=0,nextTimer=0;
  const timers=new Map(),connections=[],requests=[],statuses=[],saved=[],reconciled=[],contexts=[];
  const clock={
    setTimeout(callback,delay) { const id=++nextTimer;timers.set(id,{at:now+delay,callback});return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(milliseconds) {
      const target=now+milliseconds;
      for (;;) {
        const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if (!next) break;
        const [id,timer]=next;timers.delete(id);now=timer.at;timer.callback();await drain();
      }
      now=target;await drain();
    }
  };
  class Port {
    constructor() { this.peer=null;this.onmessage=null;this.closed=false;this.started=false; }
    start() { this.started=true; }
    close() { this.closed=true; }
    postMessage(data) {
      const payload=plain(data);
      queueMicrotask(()=>{ if(!this.closed&&!this.peer.closed) this.peer.onmessage?.({data:payload}); });
    }
  }
  class Channel {
    constructor() { this.port1=new Port();this.port2=new Port();this.port1.peer=this.port2;this.port2.peer=this.port1; }
  }
  const parent={postMessage(message,targetOrigin,ports) {
    assert.deepEqual(plain(message),{type:'cleanrooms-storage-connect'});
    assert.equal(targetOrigin,'*','The visualization frame has an opaque origin; authority is the transferred port.');
    assert.equal(ports.length,1);assert.ok(ports[0] instanceof Port);
    const port=ports[0],connection={port};connections.push(connection);
    port.onmessage=event=>requests.push({connection,data:plain(event.data)});port.start();
  }};
  const context=vm.createContext({CleanRoomsPlanningRecords:require('../src/planning-records.js'),CleanRoomsPlanningScope:require('../src/planning-scope.js'),CleanRoomsPlanningWindow:require('../src/planning-window.js'),MessageChannel:Channel,parent,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout});
  vm.runInContext(source,context,{filename:'studio-persistence.js'});
  const api=context.CleanRoomsPersistence.create({onStatus:status=>statuses.push(plain(status)),onSaved:result=>saved.push(plain(result)),onReconciled:(studio,context)=>{reconciled.push(plain(studio));contexts.push(plain(context));}});
  const ready=async()=>{connections.at(-1).port.postMessage({type:'cleanrooms-storage-ready'});await drain();};
  const reply=async(request,payload)=>{request.connection.port.postMessage({id:request.data.id,...payload});await drain();};
  const writes=()=>requests.filter(request=>request.data.action==='write');
  const reads=()=>requests.filter(request=>request.data.action==='read');
  const loaded=async(revision=7,studio=null,extra={})=>{const loading=api.load();if(connections.length===1&&reads().length===0)await ready();else await drain();await reply(reads().at(-1),{ok:true,revision,studio,...extra});const result=await loading;assert.equal(result.ok,true);return result;};
  return {api,clock,connections,requests,statuses,saved,reconciled,contexts,ready,reply,writes,reads,loaded,lastStatus:()=>statuses.at(-1)};
}


const Planning=require('../src/planning-records.js'),Scope=require('../src/planning-scope.js'),Instructions=require('../src/instruction-state.js');
const key=(kind,id)=>Planning.key(kind,id),fullShift=(id='a',patch={})=>({id,person:'p1',date:'2090-01-09',site:0,start:'07:00',end:'15:00',note:'Instruction '+id,...patch});
const asRow=(value,version=1)=>({kind:'shift',id:value.id,value:{edit:value,suppressed:false},version});
const compactShift=value=>Scope.compact('shift',value.id,{edit:value,suppressed:false});
const base=edits=>({storageVersion:1,demoSeed:false,series:[],edits,deleted:[],weekPlans:{},checklistProgress:{}});
async function loadedCompact(h,studio,versions){const deferred=Planning.flatten(studio).filter(row=>row.kind!=='week'&&Instructions.contains(row.value)).map(row=>key(row.kind,row.id));await h.loaded(7,studio,{planning:{schema:1,versions,metadataHash:'hash',deferred},directory:{schema:1,revision:3}});}
const detailRequests=h=>h.requests.filter(item=>item.data.action==='account'&&item.data.operation==='plannerDetail');
const detailReply=(records,versions,extra={})=>({ok:true,revision:7,directoryRevision:3,records,planning:{schema:1,versions,metadataHash:'hash'},progress:{},...extra});

 test('point details upgrade only selected baselines and preserve long instructions in the subsequent command',async()=>{
 const h=harness(),a=fullShift('a',{note:'æ'.repeat(1100000)}),b=fullShift('b'),studio=base({a:compactShift(a).edit,b:compactShift(b).edit});await loadedCompact(h,studio,{[key('shift','a')]:1,[key('shift','b')]:1});assert.equal(h.api.needsDetails({shiftIds:['a']}),true);
 const loading=h.api.details({shiftIds:['a']});await drain();assert.deepEqual(detailRequests(h)[0].data.payload,{revision:7,directoryRevision:3,shiftIds:['a']});await h.reply(detailRequests(h)[0],detailReply([asRow(a)],{[key('shift','a')]:1}));const result=await loading;assert.equal(result.ok,true);assert.equal(result.studio.edits.a.note,a.note);assert.equal(result.studio.edits.a._instructions,undefined);assert.equal(h.api.needsDetails({shiftIds:['a']}),false);assert.equal(h.api.needsDetails({shiftIds:['b']}),true);assert.equal(h.contexts.at(-1).detailHydration,true);
 const next=plain(result.studio);next.edits.a.start='08:00';h.api.save(next);await h.clock.advance(120);assert.equal(h.writes()[0].data.planning.changes[0].value.edit.note,a.note);assert.equal(h.writes()[0].data.planning.changes[0].value.edit._instructions,undefined);
 });

 test('missing-body edits and copies are blocked without sending any command',async()=>{
 const h=harness(),a=fullShift(),studio=base({a:compactShift(a).edit});await loadedCompact(h,studio,{[key('shift','a')]:1});const moved=plain(studio);moved.edits.a.start='08:00';assert.equal(await h.api.save(moved),false);const removed=plain(studio);delete removed.edits.a;assert.equal(await h.api.save(removed),false);const copied=plain(studio);copied.edits.copy={...copied.edits.a,id:'copy'};assert.equal(await h.api.save(copied),false);assert.equal(h.writes().length,0);assert.match(h.lastStatus().message,/instruktioner/);
 });

 test('wrong point generation, directory, body token or row version cannot partially upgrade the baseline',async()=>{
 for(const mode of ['plan','directory','version','body','fields']){const h=harness(),a=fullShift(),studio=base({a:compactShift(a).edit});await loadedCompact(h,studio,{[key('shift','a')]:1});const pending=h.api.details({shiftIds:['a']});await drain();let row=asRow(a),reply=detailReply([row],{[key('shift','a')]:1});if(mode==='plan')reply.revision=8;if(mode==='directory')reply.directoryRevision=4;if(mode==='version'){row.version=2;reply.planning.versions[key('shift','a')]=2;}if(mode==='body')row.value.edit.note='A different instruction';if(mode==='fields')row.value.edit.start='08:00';await h.reply(detailRequests(h)[0],reply);assert.equal((await pending).ok,false);assert.equal(h.api.needsDetails({shiftIds:['a']}),true);assert.equal(h.reconciled.length,0);}
 });

 test('an edit arriving during point hydration remains queued and aborts adoption of the point response',async()=>{
 const h=harness(),a=fullShift(),b=fullShift('b'),studio=base({a:compactShift(a).edit,b});await loadedCompact(h,studio,{[key('shift','a')]:1,[key('shift','b')]:1});const pending=h.api.details({shiftIds:['a']});await drain();const next=plain(studio);next.edits.b.start='09:00';const saving=h.api.save(next);await h.reply(detailRequests(h)[0],detailReply([asRow(a)],{[key('shift','a')]:1}));assert.equal((await pending).blocked,true);await drain();assert.equal(h.reconciled.length,0);const sent=h.writes()[0];assert.equal(sent.data.planning.changes.length,1);assert.equal(sent.data.planning.changes[0].id,'b');await h.reply(sent,{ok:true,revision:8,recordPatch:true,reconciledRecords:[asRow(next.edits.b,2)],planning:{schema:1,versions:{[key('shift','b')]:2},metadataHash:'hash'}});assert.equal(await saving,true);assert.equal(h.api.needsDetails({shiftIds:['a']}),true);
 });

 test('six hundred detail targets are collected atomically across two point requests and a late failure preserves every deferred record',async()=>{
 const h=harness(),values=Array.from({length:600},(_,index)=>fullShift('s'+index)),ids=values.map(value=>value.id),studio=base(Object.fromEntries(values.map(value=>[value.id,compactShift(value).edit]))),versions=Object.fromEntries(ids.map(id=>[key('shift',id),1]));await loadedCompact(h,studio,versions);assert.equal(h.api.needsDetails({shiftIds:ids}),true);
 const failed=h.api.details({shiftIds:ids});await drain();assert.equal(detailRequests(h)[0].data.payload.shiftIds.length,500);await h.reply(detailRequests(h)[0],detailReply(values.slice(0,500).map(value=>asRow(value)),Object.fromEntries(ids.slice(0,500).map(id=>[key('shift',id),1]))));assert.equal(h.reconciled.length,0);assert.equal(detailRequests(h)[1].data.payload.shiftIds.length,100);await h.reply(detailRequests(h)[1],{ok:false,status:409,message:'Changed'});assert.equal((await failed).ok,false);assert.equal(h.api.needsDetails({shiftIds:ids}),true);assert.equal(h.reconciled.length,0);
 const retry=h.api.details({shiftIds:ids});await drain();await h.reply(detailRequests(h)[2],detailReply(values.slice(0,500).map(value=>asRow(value)),Object.fromEntries(ids.slice(0,500).map(id=>[key('shift',id),1]))));await h.reply(detailRequests(h)[3],detailReply(values.slice(500).map(value=>asRow(value)),Object.fromEntries(ids.slice(500).map(id=>[key('shift',id),1]))));assert.equal((await retry).ok,true);assert.equal(h.reconciled.length,1);assert.equal(h.api.needsDetails({shiftIds:ids}),false);
 });

 test('a second occurrence fetches its own checklist even when the shared parent body is already full',async()=>{
 const h=harness(),series={id:'series',person:'p1',site:0,startDate:'2090-01-09',endDate:'2090-01-15',weekdays:[0,1],start:'07:00',end:'15:00',note:'Shared instruction'},first='series@2090-01-09',second='series@2090-01-10',studio={...base({}),series:[Scope.compact('series',series.id,series)]};await loadedCompact(h,studio,{[key('series','series')]:1});const point=h.api.details({shiftIds:[first]});await drain();await h.reply(detailRequests(h)[0],detailReply([{kind:'series',id:'series',value:series,version:1}],{[key('series','series')]:1,[key('shift',first)]:0},{progress:{[JSON.stringify([first,'p1'])]:{checked:{one:'first'}}}}));assert.equal((await point).ok,true);assert.equal(h.api.needsDetails({shiftIds:[first]}),false);assert.equal(h.api.needsDetails({shiftIds:[second]}),true);const other=h.api.details({shiftIds:[second]});await drain();await h.reply(detailRequests(h)[1],detailReply([{kind:'series',id:'series',value:series,version:1}],{[key('series','series')]:1,[key('shift',second)]:0},{progress:{[JSON.stringify([second,'p1'])]:{checked:{two:'second'}}}}));const result=await other;assert.equal(result.ok,true);assert.deepEqual(plain(result.studio.checklistProgress[JSON.stringify([first,'p1'])].checked),{one:'first'});assert.deepEqual(plain(result.studio.checklistProgress[JSON.stringify([second,'p1'])].checked),{two:'second'});assert.deepEqual(h.contexts.at(-1).detailShiftIds,[second]);
 });

 test('a selected unchecked checklist clears its old cached checks while unrelated progress survives',async()=>{
 const h=harness(),a=fullShift(),b=fullShift('b'),aKey=JSON.stringify(['a','p1']),bKey=JSON.stringify(['b','p1']),studio={...base({a:compactShift(a).edit,b:compactShift(b).edit}),checklistProgress:{[aKey]:{checked:{old:'old'}},[bKey]:{checked:{other:'keep'}}}};await loadedCompact(h,studio,{[key('shift','a')]:1,[key('shift','b')]:1});const point=h.api.details({shiftIds:['a']});await drain();await h.reply(detailRequests(h)[0],detailReply([asRow(a)],{[key('shift','a')]:1}));const result=await point;assert.equal(result.ok,true);assert.equal(result.studio.checklistProgress[aKey],undefined);assert.deepEqual(plain(result.studio.checklistProgress[bKey]),{checked:{other:'keep'}});
 });

 test('forcing a covered occurrence to refresh retrieves new checklist state without a plan revision change',async()=>{
 const h=harness(),a=fullShift(),studio=base({a:compactShift(a).edit}),progressKey=JSON.stringify(['a','p1']);await loadedCompact(h,studio,{[key('shift','a')]:1});const first=h.api.details({shiftIds:['a']});await drain();await h.reply(detailRequests(h)[0],detailReply([asRow(a)],{[key('shift','a')]:1},{progress:{[progressKey]:{checked:{task:'checked'}}}}));assert.equal((await first).ok,true);assert.equal(h.api.needsDetails({shiftIds:['a']}),false);assert.equal((await h.api.details({shiftIds:['a']})).cached,true);assert.equal(detailRequests(h).length,1);const fresh=h.api.details({shiftIds:['a']},{force:true});await drain();assert.equal(detailRequests(h).length,2);await h.reply(detailRequests(h)[1],detailReply([asRow(a)],{[key('shift','a')]:1}));const result=await fresh;assert.equal(result.ok,true);assert.equal(result.studio.checklistProgress[progressKey],undefined);
 });

 test('point batches respect the UTF8 account payload budget as well as the 500 identity limit',async()=>{
 const h=harness(),values=Array.from({length:200},(_,index)=>fullShift(index+'-'+('ø'.repeat(480)))),byId=new Map(values.map(value=>[value.id,value])),ids=[...byId.keys()],studio=base(Object.fromEntries(values.map(value=>[value.id,compactShift(value).edit]))),versions=Object.fromEntries(ids.map(id=>[key('shift',id),1]));await loadedCompact(h,studio,versions);const pending=h.api.details({shiftIds:ids}),tracked=receipt(pending);await drain();let pages=0;while(!tracked.settled&&pages<10){const sent=detailRequests(h)[pages];assert.ok(sent);assert.ok(sent.data.payload.shiftIds.length<=500);assert.ok(Buffer.byteLength(JSON.stringify(sent.data.payload))<=60*1024);const selected=sent.data.payload.shiftIds;await h.reply(sent,detailReply(selected.map(id=>asRow(byId.get(id))),Object.fromEntries(selected.map(id=>[key('shift',id),1]))));pages++;}assert.ok(pages>2,'Multibyte IDs must be split by bytes even though fewer than 500 IDs were selected.');assert.equal((await pending).ok,true);assert.equal(h.api.needsDetails({shiftIds:ids}),false);
 });

 test('a generated occurrence can hydrate a parent series whose stable id starts with an at sign',async()=>{
 const h=harness(),source={id:'@series',person:'p1',site:0,startDate:'2090-01-09',endDate:'2090-01-15',weekdays:[0],start:'07:00',end:'15:00',note:'Instruction'},id='@series@2090-01-09',studio={...base({}),series:[Scope.compact('series',source.id,source)]};await loadedCompact(h,studio,{[key('series',source.id)]:1});assert.equal(h.api.needsDetails({shiftIds:[id]}),true);const point=h.api.details({shiftIds:[id]});await drain();await h.reply(detailRequests(h)[0],detailReply([{kind:'series',id:source.id,value:source,version:1}],{[key('series',source.id)]:1,[key('shift',id)]:0}));assert.equal((await point).ok,true);assert.equal(h.api.needsDetails({shiftIds:[id]}),false);
 });
