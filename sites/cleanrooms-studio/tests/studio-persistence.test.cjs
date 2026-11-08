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

test('save is blocked until a source-bound private channel completes the initial read',async()=>{
  const h=harness();assert.equal(h.api.ready,false);assert.equal(await h.api.save({draft:'early'}),false);assert.equal(h.connections.length,0);
  const loading=h.api.load();assert.equal(h.connections.length,1);assert.equal(h.api.ready,false);assert.equal(h.lastStatus().state,'loading');
  assert.equal(await h.api.save({draft:'during load'}),false);assert.equal(h.requests.length,0);
  await h.ready();assert.equal(h.reads().length,1);assert.equal(h.writes().length,0);
  await h.reply(h.reads()[0],{ok:true,revision:12,studio:{version:'loaded'}});
  assert.deepEqual(plain(await loading),loadedState({version:'loaded'}));assert.equal(h.api.ready,true);assert.equal(h.lastStatus().state,'saved');
});

test('load returns only server capabilities separately and never derives permission from a saved role or flag',async()=>{
  const h=harness(),loading=h.api.load();await h.ready();
  const studio={role:'employee',capabilities:{manageDepartments:false},organization:{version:1}};
  await h.reply(h.reads()[0],{ok:true,revision:1,studio,capabilities:{manageDepartments:true,unrecognized:'ignored'}});
  const result=plain(await loading);
  assert.deepEqual(result,loadedState(studio,true));
  const saved=receipt(h.api.save(result.studio));await h.clock.advance(120);
  assert.deepEqual(h.writes()[0].data.studio,studio,'Server capabilities must not be inserted into persisted app state.');
  await h.reply(h.writes()[0],{ok:true,revision:2});assert.equal(saved.value,true);
  const reload=h.api.load();await drain();
  await h.reply(h.reads().at(-1),{ok:true,revision:2,studio:{role:'admin',capabilities:{manageDepartments:true}}});
  assert.deepEqual(plain(await reload),loadedState({role:'admin',capabilities:{manageDepartments:true}}),'Missing server capability fails closed, even after an earlier permitted read.');
});

test('chat-only managers retain strict server chat capabilities without gaining planning authority',async()=>{
  const h=harness(),studio={chat:true,manageChat:true,capabilities:{chat:true,manageChat:true}};
  let loaded=await h.loaded(1,studio,{capabilities:{chat:true,manageChat:true,plan:false}});
  assert.equal(loaded.capabilities.chat,true);assert.equal(loaded.capabilities.manageChat,true);assert.equal(loaded.capabilities.plan,false);
  loaded=await h.loaded(1,studio,{capabilities:{chat:1,manageChat:'true'}});
  assert.equal(loaded.capabilities.chat,false);assert.equal(loaded.capabilities.manageChat,false);
  loaded=await h.loaded(1,studio);
  assert.equal(loaded.capabilities.chat,false);assert.equal(loaded.capabilities.manageChat,false,'Stored flags and earlier grants never replace current server authority.');
  assert.deepEqual(plain(loaded.studio),studio);assert.equal(h.writes().length,0);
});

test('payroll access uses strict server capabilities and the fixed account channel independently of plan saves',async()=>{
  const h=harness(),loading=h.api.load();await h.ready();
  await h.reply(h.reads()[0],{ok:true,revision:3,studio:{managePayroll:true,capabilities:{managePayroll:true}},capabilities:{plan:true,viewPayroll:true,managePayroll:'true'}});
  const result=await loading;assert.equal(result.capabilities.viewPayroll,true);assert.equal(result.capabilities.managePayroll,false);
  const reading=h.api.action('payrollRead',{personId:'p0'});await drain();const read=h.requests.at(-1);assert.equal(read.data.action,'account');assert.equal(read.data.operation,'payrollRead');assert.deepEqual(read.data.payload,{personId:'p0'});await h.reply(read,{ok:true,personId:'p0',version:0,payroll:null});assert.equal((await reading).payroll,null);
  const saving=h.api.action('payrollSave',{personId:'p0',version:0,payroll:{currency:'DKK',agreements:[],supplements:[]}});await drain();const save=h.requests.at(-1);assert.equal(save.data.operation,'payrollSave');await h.reply(save,{ok:false,status:403,message:'Ingen adgang'});assert.equal((await saving).status,403);assert.equal(h.writes().length,0);
});

test('time mutations wait for queued plan changes and hold later saves until the attendance acknowledgement',async()=>{
  const h=harness();await h.loaded(7);
  const saved=receipt(h.api.save({page:'hours'}));
  const time=receipt(h.api.action('timeDemo',{operation:'load'}));await drain();
  assert.equal(h.writes().length,1);assert.equal(h.requests.filter(r=>r.data.action==='account').length,0);
  await h.reply(h.writes()[0],{ok:true,revision:8});assert.equal(saved.value,true);
  const request=h.requests.find(r=>r.data.operation==='timeDemo');assert.ok(request);
  const later=receipt(h.api.save({page:'hours',view:'week'}));await h.clock.advance(120);assert.equal(h.writes().length,1);
  await h.reply(request,{ok:true,demo:{active:true}});assert.equal(time.value.ok,true);
  assert.equal(h.writes().length,2);assert.equal(h.writes()[1].data.revision,8);
  await h.reply(h.writes()[1],{ok:true,revision:9});assert.equal(later.value,true);
});

test('a conflicted plan save prevents a time mutation from using its stale snapshot',async()=>{
  const h=harness();await h.loaded();h.api.save({page:'hours'});
  const time=h.api.action('timeWrite',{operation:'approve',entryId:'entry',version:1});await drain();
  await h.reply(h.writes()[0],{ok:false,status:409,message:'Planen er ændret.'});
  assert.equal((await time).status,409);assert.equal(h.requests.filter(r=>r.data.action==='account').length,0);
});

test('debounce sends only the latest copied snapshot and receipts wait for its matching acknowledgement',async()=>{
  const h=harness();await h.loaded(3);
  const first=receipt(h.api.save(freeze({version:1,nested:{value:'first'}}))),latest={version:2,nested:{value:'latest'}},second=receipt(h.api.save(latest));
  latest.nested.value='mutated after save';await h.clock.advance(119);assert.equal(h.writes().length,0);
  assert.equal(first.settled,false);assert.equal(second.settled,false);assert.equal(h.lastStatus().state,'saving');
  await h.clock.advance(1);const write=h.writes()[0];assert.equal(h.writes().length,1);assert.equal(write.data.revision,3);
  assert.deepEqual(write.data.studio,{version:2,nested:{value:'latest'}});
  write.connection.port.postMessage({id:write.data.id+999,ok:true,revision:999});await drain();
  assert.equal(first.settled,false);assert.equal(second.settled,false);assert.equal(h.lastStatus().state,'saving');
  await h.reply(write,{ok:true,revision:4});assert.equal(first.value,true);assert.equal(second.value,true);assert.equal(h.lastStatus().state,'saved');
});

test('overlapping saves stay serial, coalesce pending snapshots, and advance revisions only after acknowledgements',async()=>{
  const h=harness();await h.loaded(10);const a=receipt(h.api.save({version:'A'}));await h.clock.advance(120);const writeA=h.writes()[0];
  const b=receipt(h.api.save({version:'B'})),c=receipt(h.api.save({version:'C'}));await h.clock.advance(120);
  assert.equal(h.writes().length,1);assert.equal(h.lastStatus().state,'saving');
  await h.reply(writeA,{ok:true,revision:11});const writeC=h.writes()[1];
  assert.equal(a.value,true);assert.equal(b.settled,false);assert.equal(c.settled,false);assert.equal(h.lastStatus().state,'saving');
  assert.equal(writeC.data.revision,11);assert.deepEqual(writeC.data.studio,{version:'C'});
  await h.reply(writeC,{ok:true,revision:12});assert.equal(b.value,true);assert.equal(c.value,true);assert.equal(h.lastStatus().state,'saved');
  const d=receipt(h.api.save({version:'D'}));await h.clock.advance(120);assert.equal(h.writes()[2].data.revision,12);
  await h.reply(h.writes()[2],{ok:true,revision:13});assert.equal(d.value,true);
});

test('API failure message is visible, receipt fails, and retry retains the unsaved snapshot',async()=>{
  const h=harness();await h.loaded(20);const saved=receipt(h.api.save({version:'retained'}));await h.clock.advance(120);
  await h.reply(h.writes()[0],{ok:false,status:503,message:'Lagringen er midlertidigt utilgængelig. Prøv igen om lidt.'});
  assert.equal(saved.value,false);assert.equal(h.lastStatus().state,'error');assert.equal(h.lastStatus().conflict,false);
  assert.equal(h.lastStatus().message,'Lagringen er midlertidigt utilgængelig. Prøv igen om lidt.');
  const retry=h.api.retry();await drain();const write=h.writes()[1];assert.equal(h.lastStatus().state,'saving');assert.equal(write.data.revision,20);assert.deepEqual(write.data.studio,{version:'retained'});
  await h.reply(write,{ok:true,revision:21});await retry;assert.equal(h.lastStatus().state,'saved');
});

test('a failure with a newer queued snapshot retains the newer value for retry',async()=>{
  const h=harness();await h.loaded(30);const first=receipt(h.api.save({version:'old'}));await h.clock.advance(120);
  const latest=receipt(h.api.save({version:'new'}));await h.reply(h.writes()[0],{ok:false,status:500,message:'Serverfejl'});
  assert.equal(first.value,false);assert.equal(latest.value,false);
  const retry=h.api.retry();await drain();assert.deepEqual(h.writes()[1].data.studio,{version:'new'});assert.equal(h.writes()[1].data.revision,30);
  await h.reply(h.writes()[1],{ok:true,revision:31});await retry;assert.equal(h.lastStatus().state,'saved');
});

test('write timeout retains pending data and a late reply cannot advance the retry revision',async()=>{
  const h=harness();await h.loaded(40);const saved=receipt(h.api.save({version:'timeout'}));await h.clock.advance(120);const timedOut=h.writes()[0];
  await h.clock.advance(30000);assert.equal(saved.value,false);assert.equal(h.lastStatus().state,'error');assert.match(h.lastStatus().message,/lang tid/);
  await h.reply(timedOut,{ok:true,revision:999});assert.equal(h.lastStatus().state,'error');
  const retry=h.api.retry();await drain();assert.equal(h.writes()[1].data.revision,40);assert.deepEqual(h.writes()[1].data.studio,{version:'timeout'});
  await h.reply(h.writes()[1],{ok:true,revision:41});await retry;assert.equal(h.lastStatus().state,'saved');
});

test('409 conflict stays explicit and a fresh load discards stale pending data before later saves',async()=>{
  const h=harness();await h.loaded(50);const saved=receipt(h.api.save({version:'stale'}));await h.clock.advance(120);
  await h.reply(h.writes()[0],{ok:false,status:409,message:'Revision conflict'});
  assert.equal(saved.value,false);assert.equal(h.lastStatus().state,'error');assert.equal(h.lastStatus().conflict,true);assert.match(h.lastStatus().message,/andet vindue/);
  const reloading=h.api.load();await drain();assert.equal(h.lastStatus().state,'loading');await h.reply(h.reads().at(-1),{ok:true,revision:75,studio:{version:'fresh'}});
  assert.deepEqual(plain(await reloading),loadedState({version:'fresh'}));assert.equal(h.lastStatus().state,'saved');
  await h.api.retry();await h.clock.advance(120);assert.equal(h.writes().length,1,'Fresh load must discard the conflict snapshot.');
  const next=receipt(h.api.save({version:'after reload'}));await h.clock.advance(120);assert.equal(h.writes()[1].data.revision,75);
  await h.reply(h.writes()[1],{ok:true,revision:76});assert.equal(next.value,true);
});

test('read API errors retain their human message and a later successful load enables saves',async()=>{
  const h=harness(),loading=h.api.load();await h.ready();await h.reply(h.reads()[0],{ok:false,status:401,message:'Din login-session er udløbet. Log ind igen.'});
  assert.deepEqual(plain(await loading),{ok:false});assert.equal(h.api.ready,false);assert.equal(h.lastStatus().message,'Din login-session er udløbet. Log ind igen.');assert.equal(await h.api.save({version:'blocked'}),false);
  await h.loaded(80);assert.equal(h.api.ready,true);assert.equal(h.connections.length,1,'Read failure reuses the established private channel.');
});

test('a connection timeout is visible and the next load obtains a fresh private channel',async()=>{
  const h=harness(),loading=h.api.load();await h.clock.advance(15000);assert.deepEqual(plain(await loading),{ok:false});assert.equal(h.api.ready,false);assert.match(h.lastStatus().message,/forbindelse/);assert.equal(h.connections[0].port.peer.closed,true);
  const next=h.api.load();assert.equal(h.connections.length,2);await h.ready();await h.reply(h.reads().at(-1),{ok:true,revision:1,studio:null});assert.equal((await next).ok,true);assert.equal(h.api.ready,true);
});

test('fresh load invalidates readiness and settles superseded debounced save receipts',async()=>{
  const h=harness();await h.loaded(90);const queued=receipt(h.api.save({version:'superseded'}));
  const reloading=h.api.load();await drain();
  assert.equal(h.api.ready,false,'A fresh read must block writes until its revision is known.');
  assert.equal(await h.api.save({version:'during reload'}),false);
  await h.reply(h.reads().at(-1),{ok:true,revision:100,studio:{version:'fresh'}});await reloading;await h.clock.advance(120);
  assert.equal(queued.settled,true,'Discarded queued snapshots must not leave their promise receipt pending forever.');assert.equal(queued.value,false);
  assert.equal(h.writes().length,0);assert.equal(h.api.ready,true);
});

test('reload waits for an in-flight acknowledgement, cancels queued data, and never announces saved before the read',async()=>{
  const h=harness();await h.loaded(110);const active=receipt(h.api.save({version:'active'}));await h.clock.advance(120);const inFlight=h.writes()[0];
  const queued=receipt(h.api.save({version:'must not follow'})),statusStart=h.statuses.length,reloading=h.api.load();await drain();
  assert.equal(h.api.ready,false);assert.equal(active.value,false);assert.equal(queued.value,false);assert.equal(h.reads().length,1,'Fresh read must wait until the active write finishes.');
  assert.equal(await h.api.save({version:'blocked while reloading'}),false);await h.clock.advance(120);assert.equal(h.writes().length,1);
  await h.reply(inFlight,{ok:true,revision:111});assert.equal(h.reads().length,2);assert.equal(h.api.ready,false);assert.equal(h.lastStatus().state,'loading');
  assert.ok(h.statuses.slice(statusStart).every(status=>status.state!=='saved'),'A completed old write must not announce that the fresh load has finished.');
  await h.reply(h.reads()[1],{ok:true,revision:112,studio:{version:'fresh authoritative'}});assert.deepEqual(plain(await reloading),loadedState({version:'fresh authoritative'}));
  await h.api.retry();assert.equal(h.writes().length,1,'The superseded queued snapshot must not reappear.');
  const later=receipt(h.api.save({version:'after fresh read'}));await h.clock.advance(120);assert.equal(h.writes()[1].data.revision,112);
  await h.reply(h.writes()[1],{ok:true,revision:113});assert.equal(later.value,true);
});

test('a slower superseded load cannot replace the latest snapshot revision or status',async()=>{
  const h=harness();await h.loaded(200);const older=h.api.load();await drain();const oldRequest=h.reads().at(-1);
  const newer=h.api.load();await drain();const newRequest=h.reads().at(-1);assert.notEqual(newRequest.data.id,oldRequest.data.id);
  await h.reply(newRequest,{ok:true,revision:202,studio:{version:'newest'}});assert.deepEqual(plain(await newer),loadedState({version:'newest'}));
  const savedStatus=plain(h.lastStatus());await h.reply(oldRequest,{ok:true,revision:201,studio:{version:'older'}});
  assert.deepEqual(plain(await older),{ok:false});assert.deepEqual(h.lastStatus(),savedStatus);assert.equal(h.api.ready,true);
  const later=receipt(h.api.save({version:'uses newest revision'}));await h.clock.advance(120);assert.equal(h.writes()[0].data.revision,202);
  await h.reply(h.writes()[0],{ok:true,revision:203});assert.equal(later.value,true);
});


test('account operations use the fixed channel and reject unknown operations without sending',async()=>{
  const h=harness();await h.loaded();const before=h.requests.length;
  assert.equal((await h.api.action('arbitrary',{url:'https://elsewhere.example'})).status,400);assert.equal(h.requests.length,before);
  const pending=h.api.action('invite',{email:'member@example.com',role:'planner',manageDepartments:true});await drain();
  const account=h.requests.at(-1);assert.deepEqual(account.data,{id:account.data.id,action:'account',operation:'invite',payload:{email:'member@example.com',role:'planner',manageDepartments:true}});
  await h.reply(account,{ok:false,status:403,message:'Din adgang er ændret.'});assert.equal((await pending).status,403);
});

test('department chat operations use the account channel independently of queued planning saves',async()=>{
  const h=harness();await h.loaded(7);const queued=receipt(h.api.save({draft:'Unsaved schedule'}));
  for(const [operation,payload]of [
    ['chatList',{cursor:'room-page'}],['chatRead',{roomId:'room',before:'message-page',limit:25}],['chatSync',{roomId:'room',afterSeq:12,version:3}],
    ['chatCreate',{departmentId:'department',name:'Rengøring'}],['chatUpdate',{roomId:'room',name:'Team Nord',version:2}],
    ['chatSend',{roomId:'room',clientId:'stable-client-id',text:'Hej\nteam'}],['chatPin',{roomId:'room',messageId:'message',pinned:true,version:3}],
    ['chatReadMark',{roomId:'room',throughSeq:12}],['chatMute',{roomId:'room',muted:true}],['chatDemo',{}]
  ]){
    const pending=receipt(h.api.action(operation,payload));await drain();const account=h.requests.at(-1);
    assert.deepEqual(account.data,{id:account.data.id,action:'account',operation,payload});
    assert.equal(h.writes().length,0,'Chat never flushes or waits for the shared planning draft.');
    await h.reply(account,{ok:true,revision:9999,planChanged:true,studio:{forged:true},room:{id:'room',version:4}});
    assert.equal(pending.value.ok,true);assert.equal(h.api.ready,true);assert.deepEqual(h.saved,[]);
  }
  const denied=receipt(h.api.action('chatSend',{roomId:'room',clientId:'retry',text:'Retained draft'}));await drain();
  await h.reply(h.requests.at(-1),{ok:false,status:403,message:'Din adgang er ændret.'});assert.equal(denied.value.status,403);
  await h.clock.advance(120);assert.equal(h.writes().length,1);assert.equal(h.writes()[0].data.revision,7);
  assert.deepEqual(h.writes()[0].data.studio,{draft:'Unsaved schedule'});
  await h.reply(h.writes()[0],{ok:true,revision:8});assert.equal(queued.value,true);
});

test('employee projection and trusted identity remain separate from untrusted studio preferences',async()=>{
  const h=harness(),pending=h.api.load();await h.ready();const viewer={userId:'member',role:'employee',personId:'p1'},employee={person:{id:'p1'},shifts:[],sites:[],progress:{}};
  await h.reply(h.reads()[0],{ok:true,revision:7,studio:null,viewer,employee,workspace:{id:'work'},capabilities:{plan:false,manageUsers:false,manageDepartments:false,previewEmployees:false}});
  const result=plain(await pending);assert.deepEqual(result.viewer,viewer);assert.deepEqual(result.employee,employee);assert.equal(result.studio,null);assert.equal(result.capabilities.plan,false);
});

test('publication flushes the queued draft first and sends an explicit scope with the acknowledged revision',async()=>{
  const h=harness();await h.loaded(300);
  const studio={storageVersion:1,edits:{a:{note:'Gennemgået kladde'}},publications:{version:1,sequence:0,slots:{},records:[]}};
  const queued=receipt(h.api.save(studio));
  const scope={from:'2026-11-02',to:'2026-11-08',siteIds:[0,2],includeDependencies:true};
  const published=receipt(h.api.publish(studio,scope));await drain();
  assert.equal(h.writes().length,1);assert.equal(h.writes()[0].data.revision,300);
  assert.equal(Object.hasOwn(h.writes()[0].data,'publication'),false,'Saving the draft must not publish it.');
  assert.equal(published.settled,false);
  const lineage={version:1,sequence:0,slots:{},records:[],scopeLinks:[{from:'2026-11-02|0',to:'2026-11-02|2'}]};
  await h.reply(h.writes()[0],{ok:true,revision:301,publications:lineage,activity:[{id:'draft-audit'}],checklistProgress:{}});
  assert.equal(queued.value,true);assert.equal(h.writes().length,2);
  const write=h.writes()[1];assert.equal(write.data.revision,301);assert.deepEqual(write.data.publication,scope);assert.deepEqual(write.data.studio,studio);
  assert.equal(published.settled,false,'Publication only succeeds after its own acknowledgement.');
  const metadata={ok:true,revision:302,publications:{...lineage,sequence:1,records:[{id:'server-publication',actor:{userId:'trusted'}}]},activity:[{id:'server-audit'}],checklistProgress:{a:{checked:[0]}}};
  await h.reply(write,metadata);
  assert.deepEqual(plain(published.value),{id:write.data.id,...metadata});assert.deepEqual(h.saved,[{id:h.writes()[0].data.id,ok:true,revision:301,publications:lineage,activity:[{id:'draft-audit'}],checklistProgress:{}},{id:write.data.id,...metadata}]);
  assert.equal(h.lastStatus().state,'saved');assert.match(h.lastStatus().message,/udgivet/);
});

test('publication CAS failure never reports published success or delivers forged saved metadata',async()=>{
  const h=harness();await h.loaded(400);
  const published=receipt(h.api.publish({draft:true},{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}));await drain();
  await h.reply(h.writes()[0],{ok:false,status:409,message:'Nyere revision',revision:401,publications:{sequence:999}});
  assert.equal(published.value.ok,false);assert.equal(published.value.status,409);assert.deepEqual(h.saved,[]);
  assert.equal(h.lastStatus().state,'error');assert.equal(h.lastStatus().conflict,true);
  assert.equal(h.statuses.some(status=>/er udgivet/.test(status.message)),false);
  const before=h.writes().length;assert.equal((await h.api.publish({draft:true},{})).ok,false);assert.equal(h.writes().length,before);
});

test('a failed draft flush prevents any publication request',async()=>{
  const h=harness();await h.loaded(500);
  const queued=receipt(h.api.save({draft:'not durable'}));
  const published=receipt(h.api.publish({draft:'not durable'},{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}));await drain();
  await h.reply(h.writes()[0],{ok:false,status:503,message:'Lagring utilgængelig'});
  assert.equal(queued.value,false);assert.equal(published.value.ok,false);assert.match(published.value.message,/kladden/);
  assert.equal(h.writes().length,1);assert.equal(Object.hasOwn(h.writes()[0].data,'publication'),false);assert.deepEqual(h.saved,[]);
});

test('ordinary saves made during publication wait for its revision and are not stranded after debounce',async()=>{
  const h=harness();await h.loaded(600);
  const publication=receipt(h.api.publish({draft:'reviewed'},{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}));await drain();
  const queued=receipt(h.api.save({draft:'edited while publication is in flight'}));await h.clock.advance(120);
  assert.equal(h.writes().length,1,'Only the publication may be in flight.');
  await h.reply(h.writes()[0],{ok:true,revision:601,publications:{sequence:1}});
  assert.equal(publication.value.ok,true);assert.equal(h.writes().length,2,'The queued save must resume even if its debounce expired during publication.');
  assert.equal(h.writes()[1].data.revision,601);assert.equal(Object.hasOwn(h.writes()[1].data,'publication'),false);
  assert.deepEqual(h.writes()[1].data.studio,{draft:'edited while publication is in flight'});
  await h.reply(h.writes()[1],{ok:true,revision:602});assert.equal(queued.value,true);
});

test('discarding a failed optimistic draft blocks hidden retry until a fresh load',async()=>{
  const h=harness();await h.loaded(700);const saving=receipt(h.api.save({draft:'rolled back in UI'}));await h.clock.advance(120);
  assert.equal(h.api.discardPending(),false,'An in-flight request cannot be discarded as if cancelled.');
  await h.reply(h.writes()[0],{ok:false,status:503,message:'Failure'});assert.equal(saving.value,false);
  assert.equal(h.api.discardPending(),true);assert.equal(h.api.ready,false);assert.equal(h.lastStatus().conflict,true);
  await h.api.retry();await h.clock.advance(120);assert.equal(h.writes().length,1);
  assert.equal(await h.api.save({draft:'blocked'}),false);assert.equal((await h.api.publish({},{})).ok,false);
  await h.loaded(701,{draft:'actual durable state'});const next=receipt(h.api.save({draft:'new intentional edit'}));await h.clock.advance(120);
  assert.equal(h.writes()[1].data.revision,701);await h.reply(h.writes()[1],{ok:true,revision:702});assert.equal(next.value,true);
});

test('workflow decisions wait for every queued draft and bind the server action to the last acknowledged studio revision',async()=>{
  const h=harness();await h.loaded(800);
  const first=receipt(h.api.save({draft:'first'}));await h.clock.advance(120);
  const latest=receipt(h.api.save({draft:'latest'})),decision=receipt(h.api.action('workflowDecide',{requestId:'offer-1',version:2,decision:'approve',studioRevision:99999}));await drain();
  assert.equal(h.writes().length,1);assert.equal(h.requests.some(request=>request.data.operation==='workflowDecide'),false);
  await h.reply(h.writes()[0],{ok:true,revision:801});assert.equal(first.value,true);assert.equal(h.writes().length,2);assert.equal(h.writes()[1].data.revision,801);assert.deepEqual(h.writes()[1].data.studio,{draft:'latest'});
  assert.equal(h.requests.some(request=>request.data.operation==='workflowDecide'),false,'The decision must not race the draft that was already queued.');
  await h.reply(h.writes()[1],{ok:true,revision:802});assert.equal(latest.value,true);
  const request=h.requests.find(request=>request.data.operation==='workflowDecide');assert.deepEqual(request.data.payload,{requestId:'offer-1',version:2,decision:'approve',studioRevision:802});assert.equal(request.data.action,'account');
  await h.reply(request,{ok:true,planChanged:true,revision:803});assert.equal(decision.value.ok,true);assert.equal(h.api.ready,false);
});

test('workflow approval retains the reviewed request-list revision independently of calendar and badge reads',async()=>{
 const h=harness();await h.loaded(800);
 const reviewed=receipt(h.api.action('workflowRead',{}));await drain();let request=h.requests.at(-1);await h.reply(request,{ok:true,canManage:true,revision:805,requests:[]});assert.equal(reviewed.value.ok,true);
 const badge=receipt(h.api.action('workflowRead',{summary:true}));await drain();request=h.requests.at(-1);await h.reply(request,{ok:true,canManage:true,revision:809,pendingCount:1});assert.equal(badge.value.ok,true);
 const decision=receipt(h.api.action('workflowDecide',{requestId:'reviewed-request',version:2,decision:'approve',studioRevision:99999}));await drain();request=h.requests.at(-1);
 assert.equal(request.data.payload.studioRevision,805,'Neither a calendar revision, count-only read nor caller token replaces the reviewed list');
 await h.reply(request,{ok:false,status:409,message:'Review again'});assert.equal(decision.value.ok,false);assert.equal(h.api.ready,true);
});

test('successful workflow decisions invalidate stale plan data and settle later queued saves before the required reload',async()=>{
  const h=harness();await h.loaded(810);
  const decision=receipt(h.api.action('workflowDecide',{requestId:'claim-1',version:1,decision:'approve'}));await drain();const request=h.requests.at(-1);assert.equal(request.data.payload.studioRevision,810);
  const queued=receipt(h.api.save({draft:'based on old ownership'}));await h.clock.advance(120);assert.equal(h.writes().length,0);
  await h.reply(request,{ok:true,planChanged:true,revision:811,studio:{assignment:'server-owned'}});assert.equal(decision.value.ok,true);assert.equal(h.api.ready,false);assert.equal(queued.settled,true,'Dropped stale drafts must not leave their save receipt hanging.');assert.equal(queued.value,false);
  assert.equal(await h.api.save({draft:'blocked after approval'}),false);assert.equal((await h.api.publish({},{})).ok,false);assert.equal((await h.api.action('workflowRead',{})).status,503);await h.api.retry();await h.clock.advance(120);assert.equal(h.writes().length,0);assert.deepEqual(h.saved,[],'Workflow responses cannot impersonate a shared snapshot save.');
  await h.loaded(812,{assignment:'authoritative fresh read'});const fresh=receipt(h.api.save({draft:'new intentional edit'}));await h.clock.advance(120);assert.equal(h.writes()[0].data.revision,812);await h.reply(h.writes()[0],{ok:true,revision:813});assert.equal(fresh.value,true);
});

test('a conflicted draft blocks workflow decisions before an account request can use the stale plan',async()=>{
  const h=harness();await h.loaded(820);const queued=receipt(h.api.save({draft:'not yet durable'})),decision=receipt(h.api.action('workflowDecide',{requestId:'offer-1',version:1,decision:'approve'}));await drain();
  await h.reply(h.writes()[0],{ok:false,status:409,message:'Planen er ændret.',revision:821});assert.equal(queued.value,false);assert.equal(decision.value.status,409);assert.equal(h.requests.some(request=>request.data.operation==='workflowDecide'),false);assert.equal(h.lastStatus().conflict,true);
});

test('a publication waiting behind a workflow decision cannot send its old snapshot after ownership changes',async()=>{
  const h=harness();await h.loaded(825);const decision=receipt(h.api.action('workflowDecide',{requestId:'claim-1',version:1,decision:'approve'}));await drain();const account=h.requests.at(-1);
  const publication=receipt(h.api.publish({draft:'old assignment'},{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}));await drain();assert.equal(h.writes().length,0);assert.equal(publication.settled,false);
  await h.reply(account,{ok:true,planChanged:true,revision:826});assert.equal(decision.value.ok,true);assert.equal(h.writes().length,0,'Publication must recheck readiness after waiting for a plan-changing decision.');assert.equal(publication.settled,true);assert.equal(publication.value.ok,false);assert.equal(h.api.ready,false);
});

test('workflow decision conflicts never adopt a returned revision or forged shared-save metadata',async()=>{
  const h=harness();await h.loaded(830);const decision=receipt(h.api.action('workflowDecide',{requestId:'claim-1',version:1,decision:'approve'}));await drain();const account=h.requests.at(-1);
  await h.reply(account,{ok:false,status:409,message:'Vagten er ændret.',revision:99999,publications:{sequence:99999},studio:{forged:true}});assert.equal(decision.value.ok,false);assert.equal(decision.value.status,409);assert.deepEqual(h.saved,[]);
  if(h.api.ready){
    const retry=receipt(h.api.action('workflowDecide',{requestId:'claim-1',version:1,decision:'reject',reason:'Vagten er ændret.'}));await drain();const next=h.requests.at(-1);assert.equal(next.data.payload.studioRevision,830,'An error body is never an authoritative studio revision.');await h.reply(next,{ok:false,status:409,message:'Hent seneste plan.'});assert.equal(retry.value.status,409);
  }else{
    assert.equal(await h.api.save({draft:'blocked until reload'}),false);assert.equal((await h.api.action('workflowDecide',{requestId:'claim-1'})).status,503);
  }
  await h.loaded(831,{draft:'fresh authoritative state'});const fresh=receipt(h.api.save({draft:'after reload'}));await h.clock.advance(120);assert.equal(h.writes()[0].data.revision,831);await h.reply(h.writes()[0],{ok:true,revision:832});assert.equal(fresh.value,true);
});

test('workflow reads, read receipts, requests and responses use only the fixed account channel and never advance plan authority',async()=>{
  const h=harness();await h.loaded(840);const queued=receipt(h.api.save({draft:'ordinary queued work'}));
  for(const [operation,payload]of [['workflowRead',{}],['workflowReadMessage',{messageId:'message-1'}],['workflowRequest',{kind:'claim',shiftId:'open-1',fingerprint:'published-fingerprint'}],['workflowRespond',{requestId:'offer-1',version:2,decision:'accept'}]]){
    const result=receipt(h.api.action(operation,payload));await drain();const request=h.requests.at(-1);assert.equal(request.data.action,'account');assert.equal(request.data.operation,operation);assert.deepEqual(request.data.payload,payload);assert.equal(Object.hasOwn(request.data.payload,'studioRevision'),false);assert.equal(h.writes().length,0,'These personal operations do not flush or submit a shared plan.');
    await h.reply(request,{ok:true,revision:99999,planChanged:true,studio:{forged:true},notifications:[]});assert.equal(result.value.ok,true);assert.equal(h.api.ready,true);assert.deepEqual(h.saved,[]);
  }
  await h.clock.advance(120);assert.equal(h.writes().length,1);assert.equal(h.writes()[0].data.revision,840);assert.deepEqual(h.writes()[0].data.studio,{draft:'ordinary queued work'});await h.reply(h.writes()[0],{ok:true,revision:841});assert.equal(queued.value,true);
});

test('demo workflow operations use the account transport without flushing or rebasing the ordinary plan',async()=>{
  const h=harness();await h.loaded(850);const queued=receipt(h.api.save({draft:'real work remains queued'}));
  for(const payload of [{operation:'read',personId:'demo-emma'},{operation:'act',demoAction:'workflowDecide',requestId:'demo-request',version:1,decision:'approve',demoVersion:3},{operation:'reset',demoVersion:4}]){
    const result=receipt(h.api.action('workflowDemo',payload));await drain();const request=h.requests.at(-1);assert.equal(request.data.action,'account');assert.equal(request.data.operation,'workflowDemo');assert.deepEqual(request.data.payload,payload);assert.equal(h.writes().length,0,'Demo data must not force or submit a shared-plan write.');assert.equal(Object.hasOwn(request.data.payload,'studioRevision'),false);
    await h.reply(request,{ok:true,demo:true,demoVersion:5,revision:99999,planChanged:true,studio:{simulated:'must not become plan data'},notifications:[]});assert.equal(result.value.ok,true);assert.equal(h.api.ready,true);assert.deepEqual(h.saved,[]);
  }
  await h.clock.advance(120);assert.equal(h.writes().length,1);assert.equal(h.writes()[0].data.revision,850);assert.deepEqual(h.writes()[0].data.studio,{draft:'real work remains queued'});await h.reply(h.writes()[0],{ok:true,revision:851});assert.equal(queued.value,true);
});

const Planning=require('../src/planning-records.js');
const planningShift=(id,start='07:00',extra={})=>({id,person:'p1',date:'2026-11-03',site:0,start,end:'15:00',note:'',...extra});
const planningState=(extra={})=>({storageVersion:1,series:[],edits:{a:planningShift('a'),b:planningShift('b')},deleted:[],weekPlans:{},coverageRules:[],roster:[],workspaceSettings:{name:'CleanRooms'},page:'schedule',...extra});
const recordVersions=(...items)=>Object.fromEntries(items.map(([kind,id,version])=>[Planning.key(kind,id),version]));
const protocol=(versions={},metadataHash='a'.repeat(64))=>({schema:1,versions,metadataHash});

test('modern saves send one copy of long descriptions as versioned record commands and keep preferences outside metadata CAS',async()=>{
 const h=harness(),base=planningState(),versions=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(10,base,{planning:protocol(versions)});
 const next=plain(base);next.edits.a.note='Detaljer '.repeat(10000);next.page='hours';const saved=receipt(h.api.save(next));await h.clock.advance(120);const write=h.writes()[0].data;
 assert.equal(write.revision,10);assert.equal(Object.hasOwn(write.studio,'edits'),false);assert.equal(Object.hasOwn(write.studio,'series'),false);assert.equal(write.studio.page,'hours');assert.equal(write.planning.metadataChanged,false);assert.equal(write.planning.metadataBase,'a'.repeat(64));assert.deepEqual(write.planning.changes,[{kind:'shift',id:'a',expectedVersion:1,value:{edit:next.edits.a,suppressed:false}}]);assert.deepEqual(Planning.validatePlanning(write.planning),[]);assert.equal(JSON.stringify(write).split(next.edits.a.note).length,2,'Long descriptions must be serialized only once');
 await h.reply(h.writes()[0],{ok:true,revision:11,planning:protocol({...versions,...recordVersions(['shift','a',2])})});assert.equal(saved.value,true);
});

test('rebased acknowledgements merge peer records into queued local changes without resending either acknowledged or peer changes',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(1,base,{planning:protocol(v)});
 const a=plain(base);a.edits.a.start='08:00';const first=receipt(h.api.save(a));await h.clock.advance(120);const b=plain(a);b.edits.b.start='09:00';b.page='hours';const queued=receipt(h.api.save(b));
 const remote=plain(a);remote.edits.peer=planningShift('peer','10:00');const ackVersions={...v,...recordVersions(['shift','a',2],['shift','peer',1])};await h.reply(h.writes()[0],{ok:true,revision:3,planning:protocol(ackVersions),reconciledStudio:remote});
 assert.equal(first.value,true);assert.equal(h.reconciled.length,1);assert.equal(h.reconciled[0].edits.a.start,'08:00');assert.equal(h.reconciled[0].edits.b.start,'09:00');assert.equal(h.reconciled[0].edits.peer.start,'10:00');assert.equal(h.reconciled[0].page,'hours');
 const second=h.writes()[1];assert.deepEqual(second.data.planning.changes.map(change=>[change.kind,change.id,change.expectedVersion]),[['shift','b',1]]);await h.reply(second,{ok:true,revision:4,planning:protocol({...ackVersions,...recordVersions(['shift','b',2])})});assert.equal(queued.value,true);
});

test('queued changes to a peer-modified record retain their original expected version instead of overwriting the rebased peer value',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(1,base,{planning:protocol(v)});const a=plain(base);a.edits.a.start='08:00';h.api.save(a);await h.clock.advance(120);const local=plain(a);local.edits.b.start='09:00';const queued=receipt(h.api.save(local));const peer=plain(a);peer.edits.b.start='10:00';await h.reply(h.writes()[0],{ok:true,revision:3,planning:protocol(recordVersions(['shift','a',2],['shift','b',2])),reconciledStudio:peer});
 const second=h.writes()[1];assert.equal(second.data.planning.changes[0].id,'b');assert.equal(second.data.planning.changes[0].expectedVersion,1);assert.equal(second.data.planning.changes[0].value.edit.start,'09:00');await h.reply(second,{ok:false,status:409,planning:protocol(recordVersions(['shift','b',2]))});assert.equal(queued.value,false);assert.equal(h.lastStatus().conflict,true);assert.equal(h.reconciled[0].edits.b.start,'09:00','The unsaved intent remains visible on conflict');
});

test('queued edits to our own acknowledged record advance only to its committed version, and a later peer commit still conflicts',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(1,base,{planning:protocol(v)});const a=plain(base);a.edits.a.start='08:00';h.api.save(a);await h.clock.advance(120);const later=plain(a);later.edits.a.start='09:00';const queued=receipt(h.api.save(later));await h.reply(h.writes()[0],{ok:true,revision:2,planning:protocol({...v,...recordVersions(['shift','a',2])})});
 const second=h.writes()[1];assert.equal(second.data.planning.changes[0].expectedVersion,2);await h.reply(second,{ok:false,status:409,revision:3,planning:protocol({...v,...recordVersions(['shift','a',3])}),reconciledStudio:{...base,edits:{...base.edits,a:planningShift('a','10:00')}}});assert.equal(queued.value,false);const retry=h.api.retry();await drain();assert.equal(h.writes()[2].data.revision,2);assert.equal(h.writes()[2].data.planning.changes[0].expectedVersion,2);await h.reply(h.writes()[2],{ok:false,status:409});await retry;assert.equal(h.reconciled.length,0,'Conflict responses cannot be adopted as successful acknowledgements');
});

test('pending metadata changes retain their original fingerprint across an unrelated rebased save',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(1,base,{planning:protocol(v)});const a=plain(base);a.edits.a.start='08:00';h.api.save(a);await h.clock.advance(120);const local=plain(a);local.workspaceSettings.name='Local';h.api.save(local);const peer=plain(a);peer.workspaceSettings.name='Peer';await h.reply(h.writes()[0],{ok:true,revision:3,planning:protocol({...v,...recordVersions(['shift','a',2])},'b'.repeat(64)),reconciledStudio:peer});
 assert.equal(h.reconciled[0].workspaceSettings.name,'Local');const second=h.writes()[1];assert.equal(second.data.planning.metadataChanged,true);assert.equal(second.data.planning.metadataBase,'a'.repeat(64));await h.reply(second,{ok:false,status:409});
});

test('a queued series-wide edit never adopts an unseen concurrent exception while advancing our own occurrence dependency',async()=>{
 const s={id:'s',groupId:'s',person:'p1',startDate:'2026-11-01',endDate:'2026-12-31',weekdays:[1],start:'07:00',end:'15:00'},h=harness(),base=planningState({series:[s]}),v=recordVersions(['shift','a',1],['shift','b',1],['series','s',1]);await h.loaded(1,base,{planning:protocol(v)});
 const a=plain(base),ownId='s@2026-11-03',peerId='s@2026-11-10';a.edits[ownId]=planningShift(ownId,'08:00',{seriesId:'s'});h.api.save(a);await h.clock.advance(120);const local=plain(a);local.series[0].start='09:00';h.api.save(local);const peer=plain(a);peer.edits[peerId]=planningShift(peerId,'10:00',{seriesId:'s'});const ackVersions={...v,...recordVersions(['shift',ownId,1],['shift',peerId,1])};await h.reply(h.writes()[0],{ok:true,revision:3,planning:protocol(ackVersions),reconciledStudio:peer});
 const next=h.writes()[1].data.planning;assert.deepEqual(next.changes.map(change=>[change.kind,change.id]),[['series','s']]);const group=next.dependencies.groups.find(group=>group.id==='s');assert.ok(group.signature.includes(ownId));assert.equal(group.signature.includes(peerId),false);assert.equal(Planning.checkDependencies(peer,ackVersions,next.dependencies,next.changes).ok,false);await h.reply(h.writes()[1],{ok:false,status:409});
});

test('modern publication remains bound to the reviewed global revision and cannot absorb a peer rebase',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(4,base,{planning:protocol(v)});const published=receipt(h.api.publish(base,{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}));await drain();const write=h.writes()[0];assert.equal(write.data.revision,4);assert.ok(write.data.planning);assert.deepEqual(write.data.publication,{from:'2026-11-02',to:'2026-11-08',siteIds:[0]});await h.reply(write,{ok:false,status:409,revision:5,planning:protocol(v),reconciledStudio:base});assert.equal(published.value.ok,false);assert.equal(h.reconciled.length,0);
});

test('publication stops for a fresh review when its queued draft was rebased while flushing',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(1,base,{planning:protocol(v)});const local=plain(base);local.edits.a.start='08:00';h.api.save(local);const publishing=receipt(h.api.publish(local,{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}));await drain();assert.equal(h.writes().length,1);const peer=plain(local);peer.edits.b.start='09:00';await h.reply(h.writes()[0],{ok:true,revision:3,planning:protocol(recordVersions(['shift','a',2],['shift','b',2])),reconciledStudio:peer});assert.equal(publishing.value.ok,false);assert.equal(publishing.value.status,409);assert.match(publishing.value.message,/Gennemgå/);assert.equal(h.writes().length,1,'No publication may undo or publish an unseen peer change');assert.equal(h.reconciled[0].edits.b.start,'09:00');
});

const windowScope=(from='2026-11-02',to='2026-11-08')=>({mode:'calendar',from,to});
const windowRow=(id,version=1)=>({kind:'shift',id,value:{edit:planningShift(id),suppressed:false},sortOrder:0,version});
const windowReceipt=(scope,rows,hash='a'.repeat(64))=>({...protocol(Object.fromEntries(rows.map(row=>[Planning.key(row.kind,row.id),row.version])),hash),partial:true,projection:scope});
const windowPage=(scope,rows,{first=true,revision=7,nextCursor=null,workflowSummary,planningSummary}={})=>({ok:true,revision,planning:windowReceipt(scope,rows),...(first?{studio:Planning.payloadStudio(planningState()),viewer:{userId:'planner'},workspace:{id:'workspace'},capabilities:{plan:true},...(workflowSummary?{workflowSummary}:{}),...(planningSummary?{planningSummary}:{})}:{}),records:rows,publicationRows:first?[{kind:'state',id:'state',value:{present:false,value:{version:1,sequence:0,scopeLinks:[]}}}]:[],auxRows:[],nextCursor});
async function loadWindow(h,scope=windowScope(),rows=[windowRow('a')],extra={}){const loading=h.api.load({projection:scope});await h.ready();assert.deepEqual(h.reads()[0].data.projection,scope);await h.reply(h.reads()[0],windowPage(scope,rows,extra));assert.equal((await loading).ok,true);return scope;}

test('initial calendar load collects every page atomically with bounded projection and summary',async()=>{
 const h=harness(),scope=windowScope(),loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],windowPage(scope,[windowRow('a')],{nextCursor:'second',workflowSummary:{pendingCount:3},planningSummary:{seriesCount:47,pendingAbsenceCount:9}}));assert.equal(h.api.ready,false);assert.equal(h.reads().length,2);assert.equal(h.reads()[1].data.cursor,'second');assert.equal(h.reconciled.length,0);await h.reply(h.reads()[1],windowPage(scope,[windowRow('b')],{first:false}));const result=await loading;assert.deepEqual(Object.keys(result.studio.edits).sort(),['a','b']);assert.deepEqual(plain(result.workflowSummary),{pendingCount:3});assert.deepEqual(plain(result.planningSummary),{seriesCount:47,pendingAbsenceCount:9});assert.equal(h.api.isPartial,true);assert.deepEqual(plain(h.api.projection),scope);assert.equal(h.api.covers({from:scope.from,to:scope.to}),true);assert.equal(h.api.covers('2026-11-09'),false);
});

test('a partial-window save sends only explicit loaded edits and asks for a matching scoped acknowledgement',async()=>{
 const h=harness(),scope=await loadWindow(h),local=planningState({edits:{a:planningShift('a','08:00')}}),saving=receipt(h.api.save(local));await h.clock.advance(120);const write=h.writes()[0];assert.deepEqual(write.data.projection,scope);assert.deepEqual(write.data.planning.changes.map(change=>[change.kind,change.id]),[['shift','a']]);assert.equal(write.data.planning.changes.some(change=>change.value===null),false,'Unknown, unloaded records cannot become deletions');const nextRows=[windowRow('a',2)];await h.reply(write,{ok:true,revision:8,planning:windowReceipt(scope,nextRows),reconciledStudio:local});assert.equal(saving.value,true);assert.equal(h.api.isPartial,true);
});

test('period navigation flushes dirty changes before replacing the old cache and failed saves block eviction',async()=>{
 const h=harness(),scope=await loadWindow(h),nextScope=windowScope('2026-11-09','2026-11-15'),local=planningState({edits:{a:planningShift('a','08:00')}});h.api.save(local);const moving=receipt(h.api.window(nextScope));await drain();assert.equal(h.writes().length,1);assert.equal(h.reads().length,1);await h.reply(h.writes()[0],{ok:false,status:409,message:'Changed'});assert.equal(moving.value.status,409);assert.deepEqual(plain(h.api.projection),scope);assert.equal(h.reads().length,1);
});

test('successful dirty flush precedes navigation and the next save never deletes evicted records',async()=>{
 const h=harness(),scope=await loadWindow(h),nextScope=windowScope('2026-11-09','2026-11-15'),local=planningState({edits:{a:planningShift('a','08:00')}});h.api.save(local);const moving=receipt(h.api.window(nextScope));await drain();await h.reply(h.writes()[0],{ok:true,revision:8,planning:windowReceipt(scope,[windowRow('a',2)]),reconciledStudio:local});assert.equal(h.reads().length,2);await h.reply(h.reads()[1],windowPage(nextScope,[windowRow('b')],{revision:8}));assert.equal(moving.value.ok,true);assert.equal(h.api.covers(scope),false);const next=planningState({edits:{b:planningShift('b','09:00')}}),saving=receipt(h.api.save(next));await h.clock.advance(120);const write=h.writes()[1];assert.deepEqual(write.data.projection,nextScope);assert.deepEqual(write.data.planning.changes.map(change=>change.id),['b']);await h.reply(write,{ok:true,revision:9,planning:windowReceipt(nextScope,[windowRow('b',2)]),reconciledStudio:next});assert.equal(saving.value,true);
});

test('a newer requested period supersedes slow pages without adopting stale data',async()=>{
 const h=harness();await loadWindow(h);const b=windowScope('2026-11-09','2026-11-15'),c=windowScope('2026-11-16','2026-11-22'),first=receipt(h.api.window(b));await drain();const second=receipt(h.api.window(c));await drain();await h.reply(h.reads()[1],windowPage(b,[windowRow('b')]));assert.equal(first.value.superseded,true);assert.equal(h.reconciled.length,0);assert.deepEqual(h.reads()[2].data.projection,c);await h.reply(h.reads()[2],windowPage(c,[windowRow('c')]));assert.equal(second.value.ok,true);assert.deepEqual(plain(h.api.projection),c);assert.deepEqual(Object.keys(h.reconciled[0].edits),['c']);
});

test('an edit arriving during a period read aborts cache replacement and remains queued against the original window',async()=>{
 const h=harness(),scope=await loadWindow(h),moving=receipt(h.api.window(windowScope('2026-11-09','2026-11-15')));await drain();const local=planningState({edits:{a:planningShift('a','09:00')}}),saving=receipt(h.api.save(local));await h.reply(h.reads()[1],windowPage(windowScope('2026-11-09','2026-11-15'),[windowRow('b')]));assert.equal(moving.value.blocked,true);assert.equal(moving.value.status,409);assert.deepEqual(plain(h.api.projection),scope);assert.equal(h.reconciled.length,0);assert.equal(h.writes().length,1);assert.deepEqual(h.writes()[0].data.projection,scope);await h.reply(h.writes()[0],{ok:true,revision:8,planning:windowReceipt(scope,[windowRow('a',2)]),reconciledStudio:local});assert.equal(saving.value,true);
});

test('ensureFull expands lazily and returning to calendar evicts unrelated history without creating deletions',async()=>{
 const h=harness(),scope=await loadWindow(h),expanding=receipt(h.api.ensureFull());await drain();assert.equal(Object.hasOwn(h.reads()[1].data,'projection'),false);const full=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.reply(h.reads()[1],{ok:true,revision:7,studio:full,planning:protocol(v),capabilities:{plan:true},viewer:{userId:'planner'},workspace:{id:'workspace'}});assert.equal(expanding.value.ok,true);assert.equal(h.api.isPartial,false);assert.equal(h.contexts[0].scopeExpansion,true);assert.equal(h.contexts[0].scopeReplacement,true);assert.equal(h.api.covers('2028-01-01'),true);
 const returning=receipt(h.api.window(scope));await drain();await h.reply(h.reads()[2],windowPage(scope,[windowRow('a')]));assert.equal(returning.value.ok,true);assert.equal(h.api.isPartial,true);assert.deepEqual(Object.keys(h.reconciled.at(-1).edits),['a']);assert.equal(h.contexts.at(-1).scopeExpansion,false);
});

test('a failed period read preserves the previous ready projection and a revision-paging conflict retries atomically',async()=>{
 const h=harness(),scope=await loadWindow(h),next=windowScope('2026-11-09','2026-11-15'),moving=receipt(h.api.window(next));await drain();await h.reply(h.reads()[1],{ok:false,status:503,message:'Temporary'});assert.equal(moving.value.ok,false);assert.equal(h.api.ready,true);assert.deepEqual(plain(h.api.projection),scope);assert.equal(h.reconciled.length,0);
 const retry=receipt(h.api.window(next));await drain();await h.reply(h.reads()[2],windowPage(next,[windowRow('old')],{nextCursor:'part2'}));await h.reply(h.reads()[3],{ok:false,status:409,message:'Revision changed'});assert.equal(h.reads()[4].data.cursor,undefined);await h.reply(h.reads()[4],windowPage(next,[windowRow('fresh')],{revision:8}));assert.equal(retry.value.ok,true);assert.deepEqual(Object.keys(retry.value.studio.edits),['fresh']);
});

test('modern view/cache-only saves use preferences and never adopt peer plan tokens or saved metadata from that channel',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(7,base,{planning:protocol(v)});const local=plain(base);local.page='hours';local.search='Emma';local.weekPlans['0']={published:false,changes:0,baseline:[local.edits.a]};const saving=receipt(h.api.save(local));await h.clock.advance(120);assert.equal(h.writes().length,0);const request=h.requests.at(-1);assert.equal(request.data.action,'account');assert.equal(request.data.operation,'preferences');assert.deepEqual(request.data.payload.preferences,{page:'hours',search:'Emma'});await h.reply(request,{ok:true,preferences:request.data.payload.preferences,revision:999,planning:protocol(recordVersions(['shift','a',999])),publications:{forged:true}});assert.equal(saving.value,true);assert.equal(h.saved.at(-1).revision,7);assert.deepEqual(h.saved.at(-1).planning.versions,v);assert.equal(h.saved.at(-1).publications,undefined);
 const edited=plain(local);edited.edits.a.start='08:00';const edit=receipt(h.api.save(edited));await h.clock.advance(120);assert.equal(h.writes()[0].data.revision,7);assert.equal(h.writes()[0].data.planning.changes.find(change=>change.id==='a').expectedVersion,1);await h.reply(h.writes()[0],{ok:true,revision:8,planning:protocol({...v,...recordVersions(['shift','a',2])})});assert.equal(edit.value,true);
});

test('an actual queued record edit waits for the preference acknowledgement and is never absorbed as a view-only change',async()=>{
 const h=harness(),base=planningState(),v=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(4,base,{planning:protocol(v)});const view=plain(base);view.page='hours';const first=receipt(h.api.save(view));await h.clock.advance(120);const preference=h.requests.at(-1),edited=plain(view);edited.edits.a.start='09:00';edited.page='people';const second=receipt(h.api.save(edited));await h.clock.advance(120);assert.equal(h.writes().length,0);await h.reply(preference,{ok:true,preferences:{page:'hours'}});assert.equal(first.value,true);assert.equal(second.settled,false);assert.equal(h.writes().length,1);assert.equal(h.writes()[0].data.studio.page,'people');assert.deepEqual(h.writes()[0].data.planning.changes.map(change=>[change.kind,change.id,change.expectedVersion]),[['shift','a',1]]);await h.reply(h.writes()[0],{ok:true,revision:5,planning:protocol({...v,...recordVersions(['shift','a',2])})});assert.equal(second.value,true);assert.equal((await h.api.ensureFull()).studio.page,'people');
});

test('a held preference save does not delay a scoped read and its late receipt cannot restore the old projection or tokens',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';
 const saving=receipt(h.api.save(local));await h.clock.advance(120);const preference=h.requests.at(-1),next=windowScope('2026-11-09','2026-11-15'),moving=receipt(h.api.window(next));await drain();
 assert.equal(h.reads().length,2,'The scoped request starts while the preference RPC is held');assert.equal(saving.settled,false);
 await h.reply(h.reads()[1],windowPage(next,[windowRow('b',2)],{revision:8}));assert.equal(moving.value.ok,true);assert.equal(moving.value.studio.page,'hours');
 await h.reply(preference,{ok:true,preferences:{page:'schedule'},revision:999,planning:windowReceipt(scope,[windowRow('a',999)]),reconciledStudio:local,publications:{forged:true}});
 assert.equal(saving.value,true);assert.deepEqual(plain(h.api.projection),next);const current=await h.api.window(next);assert.deepEqual(Object.keys(current.studio.edits),['b']);assert.equal(current.studio.page,'hours');
 assert.equal(h.saved.at(-1).preferencesOnly,true);assert.equal(h.saved.at(-1).revision,8);assert.equal(h.saved.at(-1).planning.versions[Planning.key('shift','b')],2);assert.equal(h.saved.at(-1).publications,undefined);assert.equal(h.writes().length,0);
});

test('preferences coalesce independently and a save during a read cannot block or overwrite the newly loaded records',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const first=receipt(h.api.save(local));await h.clock.advance(120);const old=h.requests.at(-1);
 const next=windowScope('2026-11-09','2026-11-15'),moving=h.api.window(next);await drain();const latest={...local,page:'people',search:'Jonas'},second=receipt(h.api.save(latest));await h.clock.advance(120);assert.equal(h.requests.filter(item=>item.data.operation==='preferences').length,1);
 await h.reply(h.reads()[1],windowPage(next,[windowRow('b')]));assert.equal((await moving).studio.page,'people');await h.reply(old,{ok:true,preferences:{page:'hours'}});assert.equal(first.value,true);assert.equal(second.settled,false);
 const newer=h.requests.at(-1);assert.equal(newer.data.operation,'preferences');assert.deepEqual(newer.data.payload.preferences,{page:'people',search:'Jonas'});await h.reply(newer,{ok:true,preferences:newer.data.payload.preferences});assert.equal(second.value,true);
 const current=await h.api.window(next);assert.equal(current.studio.page,'people');assert.equal(current.studio.search,'Jonas');assert.deepEqual(Object.keys(current.studio.edits),['b']);assert.equal(h.lastStatus().state,'saved');
});

test('a read that outlives its preference acknowledgement settles the saving status when it completes',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const saving=receipt(h.api.save(local));await h.clock.advance(120);const preference=h.requests.at(-1),next=windowScope('2026-11-09','2026-11-15'),moving=h.api.window(next);await drain();
 await h.reply(preference,{ok:true});assert.equal(saving.value,true);await h.reply(h.reads()[1],windowPage(next,[windowRow('b')]));assert.equal((await moving).ok,true);assert.equal(h.lastStatus().state,'saved');
});

test('explicit preference actions and view saves share ordering while retaining structured action results and newest intent',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const first=receipt(h.api.action('preferences',{preferences:{page:'hours',search:'old'}}));await h.clock.advance(120);const old=h.requests.at(-1),latest={...local,page:'people',search:'new'},second=receipt(h.api.save(latest));await h.clock.advance(120);
 assert.equal(h.requests.filter(item=>item.data.operation==='preferences').length,1);await h.reply(old,{ok:true,status:200,preferences:{page:'hours',search:'old'},revision:999});assert.deepEqual(plain(first.value),{ok:true,status:200,preferences:{page:'hours',search:'old'}});assert.equal(second.settled,false);
 const current=await h.api.window(scope);assert.equal(current.studio.page,'people');assert.equal(current.studio.search,'new');const newer=h.requests.at(-1);assert.deepEqual(newer.data.payload.preferences,{page:'people',search:'new'});await h.reply(newer,{ok:true});assert.equal(second.value,true);
 const action=receipt(h.api.action('preferences',{preferences:{view:'week'}}));await h.clock.advance(120);const last=h.requests.at(-1);assert.deepEqual(last.data.payload.preferences,{page:'people',search:'new',view:'week'});await h.reply(last,{ok:true});assert.equal(action.value.ok,true);assert.equal((await h.api.window(scope)).studio.view,'week');assert.equal((await h.api.action('preferences',{preferences:{capabilities:{plan:true}}})).status,400);
});

test('a failed preference save remains retryable without blocking scoped reads or borrowing planning authority',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const saving=receipt(h.api.save(local));await h.clock.advance(120);const first=h.requests.at(-1);
 await h.reply(first,{ok:false,status:503,message:'Preferences unavailable'});assert.equal(saving.value,false);assert.equal(h.api.ready,true);assert.equal(h.lastStatus().state,'error');
 const next=windowScope('2026-11-09','2026-11-15'),moving=h.api.window(next);await drain();assert.equal(h.reads().length,2);await h.reply(h.reads()[1],windowPage(next,[windowRow('b')]));assert.equal((await moving).ok,true);
 const retry=h.api.retry();await drain();const request=h.requests.at(-1);assert.equal(request.data.operation,'preferences');assert.deepEqual(request.data.payload.preferences,{page:'hours'});await h.reply(request,{ok:true});await retry;assert.equal(h.lastStatus().state,'saved');assert.deepEqual(plain(h.api.projection),next);assert.equal(h.writes().length,0);
});

test('preference status exposes a fresh saving or retryable error summary and clears after settlement',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);assert.equal(h.api.preferenceStatus,null);local.page='hours';const saving=receipt(h.api.save(local));assert.equal(h.api.preferenceStatus.state,'saving');
 const observed=h.api.preferenceStatus;observed.state='error';observed.message='Forged';assert.equal(h.api.preferenceStatus.state,'saving','Consumers cannot mutate the internal status');
 await h.clock.advance(120);assert.equal(h.api.preferenceStatus.state,'saving');await h.reply(h.requests.at(-1),{ok:false,status:503,message:'Preferences unavailable'});assert.equal(saving.value,false);assert.deepEqual(plain(h.api.preferenceStatus),{state:'error',message:'Preferences unavailable'});
 const retry=h.api.retry();await drain();assert.equal(h.api.preferenceStatus.state,'saving');await h.reply(h.requests.at(-1),{ok:true});await retry;assert.equal(h.api.preferenceStatus,null);assert.deepEqual(plain(h.api.projection),scope);
});

test('a plan acknowledgement clears only older preferences it also saved, retaining newer queued intent',async()=>{
 for(const newer of [false,true]){
  const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const preference=receipt(h.api.save(local));await h.clock.advance(120);await h.reply(h.requests.at(-1),{ok:false,status:503,message:'Offline'});assert.equal(preference.value,false);
  const edited=plain(local);edited.edits.a.start='08:00';edited.page='people';const saving=receipt(h.api.save(edited));await h.clock.advance(120);const write=h.writes()[0];let action;
  if(newer){action=receipt(h.api.action('preferences',{preferences:{page:'workspace'}}));await h.clock.advance(120);}
  await h.reply(write,patchAck(scope,[{...windowRow('a',2),value:{edit:edited.edits.a,suppressed:false}}]));assert.equal(saving.value,true);
  if(newer){const request=h.requests.at(-1);assert.equal(request.data.operation,'preferences');assert.equal(request.data.payload.preferences.page,'workspace');assert.equal(action.settled,false);await h.reply(request,{ok:true});assert.equal(action.value.ok,true);assert.equal((await h.api.window(scope)).studio.page,'workspace');}
  else{assert.equal(h.requests.filter(item=>item.data.operation==='preferences').length,1,'The successful plan write already persisted these older preferences');assert.equal((await h.api.window(scope)).studio.page,'people');}
  assert.equal(h.lastStatus().state,'saved');
 }
});

test('load and discard cancel preference receipts, while an old transport reply cannot affect a new session',async()=>{
 for(const operation of ['load','discard']){
  const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const saving=receipt(h.api.save(local));await h.clock.advance(120);const old=h.requests.at(-1);
  let loading;if(operation==='load'){loading=h.api.load({projection:scope});await drain();assert.equal(h.reads().length,2);const next=windowPage(scope,[windowRow('new')],{revision:20});next.studio.page='accounts';await h.reply(h.reads()[1],next);assert.equal((await loading).studio.page,'accounts');}
  else{assert.equal(h.api.discardPending(),true);await drain();}
  assert.equal(saving.value,false);await h.reply(old,{ok:true,preferences:{page:'hours'},revision:999});assert.equal(h.saved.length,0);
  if(operation==='load'){assert.equal((await h.api.window(scope)).studio.page,'accounts');const newer=plain((await h.api.window(scope)).studio);newer.page='workspace';const saved=receipt(h.api.save(newer));await h.clock.advance(120);await h.reply(h.requests.at(-1),{ok:true});assert.equal(saved.value,true);assert.equal(h.saved.at(-1).revision,20);}
  else{assert.equal(h.api.ready,false);await h.api.retry();assert.equal(h.requests.filter(item=>item.data.operation==='preferences').length,1);}
 }
});

test('a preference authorization failure invalidates in-flight reads and all queued writes until a fresh account load',async()=>{
 const h=harness(),scope=await loadWindow(h),local=plain((await h.api.window(scope)).studio);local.page='hours';const saving=receipt(h.api.save(local));await h.clock.advance(120);const preference=h.requests.at(-1),next=windowScope('2026-11-09','2026-11-15'),moving=h.api.window(next);await drain();
 const edited=plain(local);edited.edits.a.start='09:00';const edit=receipt(h.api.save(edited));await h.reply(preference,{ok:false,status:403,message:'Access revoked'});assert.equal(saving.value,false);assert.equal(edit.value,false);assert.equal(h.api.ready,false);assert.equal(h.lastStatus().conflict,true);
 await h.reply(h.reads()[1],windowPage(next,[windowRow('b')]));assert.equal((await moving).superseded,true);await h.api.retry();assert.equal(h.writes().length,0);assert.equal((await h.api.action('timeRead',{})).status,503);
});

const operationScope=(mode='series')=>mode==='series'?{mode,groupId:'agreement',ranges:[{from:'2027-01-01',to:'2027-06-30'}],calendar:{from:'2026-11-02',to:'2026-12-27'}}:mode==='publication'?{mode,from:'2026-11-02',to:'2026-11-29',siteIds:[0],includeDependencies:false,calendar:{from:'2026-11-02',to:'2026-12-27'}}:{mode,calendar:{from:'2026-11-02',to:'2026-12-27'}};
const operationPage=(scope,rows,{selection={groupIds:[],ranges:[]},auxRows=[],...options}={})=>({...windowPage(scope,rows,options),selection,auxRows});

test('operation reads replace the acknowledged scope atomically and never promote compact summaries to editable writes',async()=>{
 const h=harness();await loadWindow(h);const scope=operationScope(),moving=receipt(h.api.scope(scope));await drain();assert.deepEqual(h.reads()[1].data.projection,scope);
 const selection={groupIds:['agreement'],ranges:[{from:'2026-12-28',to:'2027-07-04'}]},compact={id:'not-loaded-as-plan',person:'p2',date:'2027-01-05',site:1,start:'07:00',end:'15:00'};
 await h.reply(h.reads()[1],operationPage(scope,[windowRow('own')],{selection,nextCursor:'second',auxRows:[{kind:'availability',id:'available',value:{kind:'shift',id:compact.id,value:{edit:compact,suppressed:false}}}]}));assert.equal(moving.settled,false);assert.equal(h.reconciled.length,0);
 await h.reply(h.reads()[2],operationPage(scope,[],{first:false,selection,auxRows:[{kind:'catalog',id:'header',value:{kind:'shift',id:compact.id,value:{edit:compact,suppressed:false},hasDescription:true}}]}));assert.equal(moving.value.ok,true);assert.equal(h.api.coversScope(scope),true);assert.equal(h.api.coversScope({...scope,groupId:'other'}),false);assert.equal(h.api.covers({from:scope.calendar.from,to:scope.calendar.to}),true);assert.equal(h.contexts[0].scopeExpansion,true);
 assert.equal(h.api.availability.edits[compact.id].person,'p2');assert.equal(h.api.catalog.edits[compact.id].hasDescription,true);assert.deepEqual(plain(h.api.selection),selection);const detached=h.api.catalog;detached.edits[compact.id].person='forged';assert.equal(h.api.catalog.edits[compact.id].person,'p2');
 const local=plain(moving.value.studio);local.edits.own.start='09:00';const saving=receipt(h.api.save(local));await h.clock.advance(120);const write=h.writes()[0];assert.deepEqual(write.data.planning.changes.map(change=>[change.kind,change.id]),[['shift','own']]);assert.equal(write.data.studio.availability,undefined);assert.equal(write.data.studio.catalog,undefined);assert.deepEqual(write.data.projection,scope);
 const nextAvailability={series:[],edits:{[compact.id]:{...compact,start:'08:00'}},deleted:[],published:[],demoSeed:false},nextCatalog={series:[],edits:{[compact.id]:{...compact,hasDescription:false}},deleted:[]};
 await h.reply(write,{ok:true,revision:8,planning:windowReceipt(scope,[windowRow('own',2)]),reconciledStudio:local,selection,availability:nextAvailability,catalog:nextCatalog});assert.equal(saving.value,true);assert.equal(h.api.availability.edits[compact.id].start,'08:00');assert.equal(h.api.catalog.edits[compact.id].hasDescription,false);assert.deepEqual(h.contexts.at(-1).availability,nextAvailability);
 const before=h.reads().length,cached=await h.api.scope(scope);assert.equal(cached.cached,true);assert.equal(h.reads().length,before);assert.equal(cached.availability.edits[compact.id].start,'08:00');
});

test('operation scope failures retain the previous projection and never silently expand to a full read',async()=>{
 const h=harness(),calendar=await loadWindow(h),invalid=await h.api.scope({...operationScope(),ownerId:'forged'});assert.equal(invalid.status,400);assert.equal(h.reads().length,1);
 const moving=receipt(h.api.scope(operationScope('series-list')));await drain();await h.reply(h.reads()[1],{ok:false,status:403,message:'Scope denied'});assert.equal(moving.value.status,403);assert.deepEqual(plain(h.api.projection),calendar);assert.equal(h.api.catalog,null);assert.equal(h.reads().some(read=>read.data.projection===undefined),false);
});

test('scope-only publication requires exactly the loaded review range, sites and dependency selection',async()=>{
 const h=harness(),scope=operationScope('publication'),loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[windowRow('a')]));const loaded=await loading;
 const publication={from:scope.from,to:scope.to,siteIds:scope.siteIds,includeDependencies:scope.includeDependencies};
 for(const patch of [{to:'2026-12-06'},{siteIds:[1]},{includeDependencies:true}]){const result=await h.api.publish(loaded.studio,{...publication,...patch});assert.equal(result.status,409);assert.equal(h.writes().length,0);}
 const publishing=receipt(h.api.publish(loaded.studio,publication));await drain();assert.equal(h.writes().length,1);assert.deepEqual(h.writes()[0].data.projection,scope);assert.deepEqual(h.writes()[0].data.publication,publication);
 await h.reply(h.writes()[0],{ok:true,revision:8,planning:windowReceipt(scope,[windowRow('a')]),reconciledStudio:loaded.studio,selection:{groupIds:[],ranges:[]},availability:h.api.availability,catalog:h.api.catalog});assert.equal(publishing.value.ok,true);
});

test('a review waiting behind a scope replacement cannot publish using the newer scope acknowledgement',async()=>{
 const h=harness(),scope=operationScope('publication'),loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[windowRow('a')]));const loaded=await loading;
 const next={...scope,to:'2026-12-06'},moving=receipt(h.api.scope(next));await drain();const publishing=receipt(h.api.publish(loaded.studio,{from:scope.from,to:scope.to,siteIds:[0],includeDependencies:false}));await drain();assert.equal(h.writes().length,0);
 await h.reply(h.reads()[1],operationPage(next,[windowRow('a')]));assert.equal(moving.value.ok,true);assert.equal(publishing.value.status,409);assert.equal(h.writes().length,0);assert.deepEqual(plain(h.api.projection),next);
});

test('operation acknowledgements preserve the separately paged absence overlay when the write response deliberately omits it',async()=>{
 const h=harness(),scope=operationScope(),absence={id:'leave',p:'p1',type:'Ferie',status:'approved',days:['2027-02-01']},loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[windowRow('a')],{auxRows:[{kind:'absence',id:absence.id,value:absence}]}));const loaded=await loading,local=plain(loaded.studio);local.edits.a.start='08:00';const saving=receipt(h.api.save(local));await h.clock.advance(120);
 const acknowledged=plain(local);delete acknowledged.absences;delete acknowledged.requests;delete acknowledged.leaveDecisions;await h.reply(h.writes()[0],{ok:true,revision:8,planning:windowReceipt(scope,[windowRow('a',2)]),reconciledStudio:acknowledged});assert.equal(saving.value,true);assert.deepEqual(h.reconciled[0].absences,[absence]);assert.deepEqual(h.reconciled[0].requests,{leave:'approved'});const cached=await h.api.scope(scope);assert.deepEqual(plain(cached.studio.absences),[absence]);
});

const patchAck=(scope,rows,extra={})=>({ok:true,revision:8,recordPatch:true,reconciledRecords:rows,planning:windowReceipt(scope,rows),...extra});
test('record-only acknowledgements apply to the submitted snapshot and retain untouched observations without fetching the calendar',async()=>{
 const h=harness(),scope=await loadWindow(h,windowScope(),[windowRow('a'),windowRow('b')]),local=planningState();local.edits.a.start='08:00';local.weekPlans['0']={changes:1,published:false};const saving=receipt(h.api.save(local));await h.clock.advance(120);
 await h.reply(h.writes()[0],patchAck(scope,[windowRow('a',2)].map(row=>({...row,value:{edit:local.edits.a,suppressed:false}}))));assert.equal(saving.value,true);assert.equal(h.reads().length,1);assert.equal(h.reconciled[0].edits.a.start,'08:00');assert.equal(h.reconciled[0].edits.b.start,'07:00');assert.equal(h.saved[0].planning.versions[Planning.key('shift','a')],2);assert.equal(h.saved[0].planning.versions[Planning.key('shift','b')],1);assert.equal(h.api.coverageValid,true);
 const next=plain(h.reconciled[0]);next.edits.b.start='09:00';const second=receipt(h.api.save(next));await h.clock.advance(120);assert.equal(h.writes()[1].data.planning.changes[0].id,'b');assert.equal(h.writes()[1].data.planning.changes[0].expectedVersion,1,'An untouched peer row never receives a newer unobserved token');await h.reply(h.writes()[1],{ok:false,status:409,message:'Peer changed b'});assert.equal(second.value,false);
});

test('queued edits advance only through their own exact record acknowledgement',async()=>{
 const h=harness(),scope=await loadWindow(h),first=planningState({edits:{a:planningShift('a','08:00')}}),saving=receipt(h.api.save(first));await h.clock.advance(120);const later=plain(first);later.edits.a.start='09:00';const queued=receipt(h.api.save(later));await h.clock.advance(120);
 await h.reply(h.writes()[0],patchAck(scope,[{...windowRow('a',2),value:{edit:first.edits.a,suppressed:false}}]));assert.equal(saving.value,true);assert.equal(queued.settled,false);assert.equal(h.reconciled[0].edits.a.start,'09:00');assert.equal(h.writes()[1].data.planning.changes[0].expectedVersion,2);assert.equal(h.writes()[1].data.planning.changes[0].value.edit.start,'09:00');
 await h.reply(h.writes()[1],patchAck(scope,[{...windowRow('a',3),value:{edit:later.edits.a,suppressed:false}}],{revision:9}));assert.equal(queued.value,true);assert.equal(h.saved[1].planning.versions[Planning.key('shift','a')],3);assert.equal(h.reads().length,1);
});

test('malformed record acknowledgements cannot advance authority or accidentally adopt peer values or metadata hashes',async()=>{
 for(const mutate of [reply=>{reply.reconciledRecords=[];reply.planning.versions={};},reply=>{reply.planning.versions[Planning.key('shift','peer')]=9;},reply=>{reply.reconciledRecords[0].value.edit.id='different';},reply=>{reply.reconciledRecords[0].version=8;reply.planning.versions[Planning.key('shift','a')]=8;},reply=>{reply.planning.metadataHash='new-unobserved-metadata';},reply=>{reply.planning.projection=windowScope('2026-12-07','2026-12-13');}]){
  const h=harness(),scope=await loadWindow(h),local=planningState({edits:{a:planningShift('a','08:00')}}),saving=receipt(h.api.save(local));await h.clock.advance(120);const reply=patchAck(scope,[{...windowRow('a',2),value:{edit:local.edits.a,suppressed:false}}]);mutate(reply);await h.reply(h.writes()[0],reply);assert.equal(saving.value,false);assert.equal(h.saved.length,0);assert.equal(h.reconciled.length,0);assert.equal(h.lastStatus().state,'error');
 }
});

test('series record acknowledgements compact their own summaries and invalidate coverage until the same scope is fetched again',async()=>{
 const h=harness(),scope=operationScope(),series={id:'agreement',person:'p1',site:0,startDate:'2027-01-01',endDate:'2027-06-30',weekdays:[1],start:'07:00',end:'15:00',note:'Long old instruction'},row={kind:'series',id:series.id,value:series,sortOrder:0,version:1},loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[row],{auxRows:[{kind:'availability',id:'available',value:{kind:'series',id:series.id,value:series}},{kind:'catalog',id:'catalog',value:{kind:'series',id:series.id,value:series,hasDescription:true}}]}));const loaded=await loading,local=plain(loaded.studio);local.series[0].start='08:00';local.series[0].note='Very long changed instructions '.repeat(500);const saving=receipt(h.api.save(local));await h.clock.advance(120);
 await h.reply(h.writes()[0],patchAck(scope,[{...row,value:local.series[0],version:2}]));assert.equal(saving.value,true);assert.equal(h.api.coverageValid,false);assert.equal(h.api.coversScope(scope),false);assert.equal(h.api.availability.series[0].start,'08:00');assert.equal(h.api.availability.series[0].note,undefined);assert.equal(h.api.catalog.series[0].hasDescription,true);assert.equal(h.api.catalog.series[0].note,undefined);
 const refreshing=receipt(h.api.scope(scope));await drain();assert.equal(h.reads().length,2,'An identical selector must bypass the invalidated cache');await h.reply(h.reads()[1],operationPage(scope,[{...row,value:local.series[0],version:2}],{revision:8}));assert.equal(refreshing.value.ok,true);assert.equal(h.api.coverageValid,true);assert.equal(h.api.coversScope(scope),true);
});

test('a rebased record receipt invalidates publication coverage and cannot be used as a fresh review',async()=>{
 const h=harness(),scope=operationScope('publication'),loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[windowRow('a')]));const loaded=await loading,local=plain(loaded.studio);local.edits.a.start='08:00';const saving=receipt(h.api.save(local));await h.clock.advance(120);await h.reply(h.writes()[0],patchAck(scope,[{...windowRow('a',2),value:{edit:local.edits.a,suppressed:false}}],{requiresRefresh:true,revision:9}));assert.equal(saving.value,true);assert.equal(h.api.coverageValid,false);
 const publication=await h.api.publish(h.reconciled[0],{from:scope.from,to:scope.to,siteIds:scope.siteIds,includeDependencies:false});assert.equal(publication.status,409);assert.equal(h.writes().length,1);assert.equal(h.reads().length,1);
});

test('publication-only record receipts settle the reviewed commit without inventing new draft versions',async()=>{
 const h=harness(),scope=operationScope('publication'),loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[windowRow('a')]));const loaded=await loading,publishing=receipt(h.api.publish(loaded.studio,{from:scope.from,to:scope.to,siteIds:scope.siteIds,includeDependencies:false}));await drain();await h.reply(h.writes()[0],patchAck(scope,[],{requiresRefresh:true}));assert.equal(publishing.value.ok,true);assert.equal(h.saved[0].planning.versions[Planning.key('shift','a')],1);assert.equal(h.api.coverageValid,false);assert.equal(h.reads().length,1);
});

test('modern full-cache edits explicitly opt into record receipts while keeping full coverage and untouched observations',async()=>{
 const h=harness(),base=planningState(),versions=recordVersions(['shift','a',1],['shift','b',1]);await h.loaded(7,base,{planning:protocol(versions)});const local=plain(base);local.edits.a.start='08:00';const saving=receipt(h.api.save(local));await h.clock.advance(120);const write=h.writes()[0];assert.equal(write.data.commandReceipt,'records');assert.equal(write.data.projection,undefined);
 await h.reply(write,{ok:true,revision:8,recordPatch:true,reconciledRecords:[{...windowRow('a',2),value:{edit:local.edits.a,suppressed:false}}],planning:protocol(recordVersions(['shift','a',2]))});assert.equal(saving.value,true);assert.equal(h.api.isPartial,false);assert.equal(h.api.coverageValid,true);assert.equal(h.api.coversScope(operationScope()),true);assert.equal(h.reconciled[0].edits.a.start,'08:00');assert.equal(h.reconciled[0].edits.b.start,'07:00');assert.equal(h.saved[0].planning.versions[Planning.key('shift','b')],1);assert.equal(h.reads().length,1);
 const changedMetadata=plain(h.reconciled[0]);changedMetadata.workspaceSettings.name='New company';const metadataSaving=receipt(h.api.save(changedMetadata));await h.clock.advance(120);assert.equal(h.writes()[1].data.planning.metadataChanged,true);assert.equal(h.writes()[1].data.commandReceipt,undefined,'Metadata edits retain the full compatibility contract');await h.reply(h.writes()[1],{ok:true,revision:9,planning:protocol({...versions,...recordVersions(['shift','a',2])},'b'.repeat(64))});assert.equal(metadataSaving.value,true);
});

test('a rebased full-cache record receipt requires a real full refresh before complete coverage can be used again',async()=>{
 const h=harness(),base=planningState();await h.loaded(7,base,{planning:protocol(recordVersions(['shift','a',1],['shift','b',1]))});const local=plain(base);local.edits.a.start='08:00';const saving=receipt(h.api.save(local));await h.clock.advance(120);await h.reply(h.writes()[0],{ok:true,revision:9,recordPatch:true,reconciledRecords:[{...windowRow('a',2),value:{edit:local.edits.a,suppressed:false}}],planning:protocol(recordVersions(['shift','a',2])),requiresRefresh:true});assert.equal(saving.value,true);assert.equal(h.api.coverageValid,false);assert.equal(h.api.coversScope(operationScope()),false);
 const refreshing=receipt(h.api.ensureFull());await drain();assert.equal(h.reads().length,2);assert.equal(h.reads()[1].data.projection,undefined);const latest=plain(local);latest.edits.b.start='10:00';await h.reply(h.reads()[1],{ok:true,revision:9,studio:latest,planning:protocol(recordVersions(['shift','a',2],['shift','b',2]))});assert.equal(refreshing.value.ok,true);assert.equal(h.api.coverageValid,true);assert.equal(h.reconciled.at(-1).edits.b.start,'10:00');
});

test('a series acknowledgement accepts unchanged and unseen future-week cache versions without relaxing the series CAS',async()=>{
 const h=harness(),scope=operationScope(),series={id:'agreement',person:'p1',site:0,startDate:'2027-01-01',endDate:'2027-06-30',weekdays:[1],start:'07:00',end:'15:00',plannedBreakMinutes:0,note:''},source={kind:'series',id:series.id,value:series,sortOrder:0,version:1},cached={kind:'week',id:'0',value:{changes:8,published:false,baseline:[]},sortOrder:0,version:4},loading=h.api.load({projection:scope});await h.ready();await h.reply(h.reads()[0],operationPage(scope,[source,cached]));const base=await loading,local=plain(base.studio);local.series[0].plannedBreakMinutes=5;local.weekPlans['0'].changes=1;local.weekPlans['20']={changes:1,published:false};const saving=receipt(h.api.save(local));await h.clock.advance(120);const sent=h.writes()[0].data.planning.changes;assert.equal(sent.find(row=>row.kind==='week'&&row.id==='0').expectedVersion,4);assert.equal(sent.find(row=>row.kind==='week'&&row.id==='20').expectedVersion,0);
 const future={kind:'week',id:'20',value:{changes:10,published:false,baseline:[]},sortOrder:20,version:7},rows=[{...source,value:local.series[0],version:2},cached,future];await h.reply(h.writes()[0],patchAck(scope,rows,{requiresRefresh:true}));assert.equal(saving.value,true);assert.equal(h.lastStatus().state,'saved');assert.equal(h.saved[0].planning.versions[Planning.key('series','agreement')],2);assert.equal(h.saved[0].planning.versions[Planning.key('week','0')],4);assert.equal(h.saved[0].planning.versions[Planning.key('week','20')],7);assert.equal(h.reconciled[0].weekPlans['20'].changes,10);assert.equal(h.api.coverageValid,false);
 const refreshing=receipt(h.api.scope(scope));await drain();assert.equal(h.reads().length,2,'A committed series save must release the queue so its required refresh can run');await h.reply(h.reads()[1],operationPage(scope,rows,{revision:8}));assert.equal(refreshing.value.ok,true);assert.equal(h.api.coverageValid,true);
});

test('an exact explicit no-op domain row can keep its version but a changed value cannot use that exception',async()=>{
 for(const changed of [false,true]){
  const h=harness(),scope=await loadWindow(h),local=planningState({edits:{a:planningShift('a','08:00')}}),saving=receipt(h.api.save(local));await h.clock.advance(120);const row={...windowRow('a',1),value:{edit:{...local.edits.a,...(changed?{end:'19:00'}:{})},suppressed:false}};await h.reply(h.writes()[0],patchAck(scope,[row]));assert.equal(saving.value,!changed);assert.equal(h.saved.length,changed?0:1);if(!changed)assert.equal(h.saved[0].planning.versions[Planning.key('shift','a')],1);
 }
});

test('directory bootstrap transport can read before plan load and its writes never advance plan authority or flush pending shifts',async()=>{
 const h=harness(),early=h.api.directoryRead({catalog:true,limit:500});await h.ready();const first=h.requests[0];assert.equal(first.data.action,'directoryRead');assert.deepEqual(first.data.payload,{catalog:true,limit:500});await h.reply(first,{ok:true,directory:{schema:1,revision:8,nextSiteIndex:3},records:[],nextCursor:null});assert.equal((await early).ok,true);assert.equal(h.api.ready,false);assert.equal((await h.api.directoryWrite({changes:[]})).status,503);
 const base=planningState();await h.loaded(7,base,{planning:protocol(recordVersions(['shift','a',1],['shift','b',1])),directory:{schema:1,revision:8}});const local=plain(base);local.edits.a.start='08:00';const saving=receipt(h.api.save(local));const changing=h.api.directoryWrite({changes:[{kind:'employee',id:'person-one',expectedVersion:3,patch:{name:'Jonas'}}]});await drain();assert.equal(h.writes().length,0,'Directory mutation does not flush unrelated plan edits');const request=h.requests.at(-1);assert.equal(request.data.action,'directoryWrite');await h.reply(request,{ok:true,directory:{schema:1,revision:9,nextSiteIndex:3},records:[]});assert.equal((await changing).ok,true);assert.equal(h.api.directoryRevision,8,'A directory mutation cannot replace the revision the planner actually reviewed');await h.clock.advance(120);assert.equal(h.writes()[0].data.directoryRevision,8);assert.equal(h.writes()[0].data.studio.roster,undefined);await h.reply(h.writes()[0],{ok:true,revision:8,planning:protocol(recordVersions(['shift','a',2],['shift','b',1]))});assert.equal(saving.value,true);assert.equal(h.saved.at(-1).revision,8);
});

test('planning reads preserve their directory receipt and later plan acknowledgements cannot advance it without a new read',async()=>{
 const h=harness(),scope=windowScope(),loading=h.api.load({projection:scope}),directory={schema:1,revision:4,nextSiteIndex:3,complete:true,versions:{}};await h.ready();await h.reply(h.reads()[0],{...windowPage(scope,[windowRow('a')]),directory});const loaded=await loading;assert.deepEqual(plain(loaded.directory),directory);assert.equal(h.api.directoryRevision,4);const local=plain(loaded.studio);local.edits.a.start='08:00';const saving=receipt(h.api.save(local));await h.clock.advance(120);assert.equal(h.writes()[0].data.directoryRevision,4);await h.reply(h.writes()[0],patchAck(scope,[{...windowRow('a',2),value:{edit:local.edits.a,suppressed:false}}],{directory:{schema:1,revision:99}}));assert.equal(saving.value,true);assert.equal(h.api.directoryRevision,4);h.api.invalidateCoverage();assert.equal(h.api.coverageValid,false);const refreshing=receipt(h.api.scope(scope));await drain();assert.equal(h.reads().length,2);await h.reply(h.reads()[1],{...windowPage(scope,[windowRow('a',2)],{revision:8}),directory:{...directory,revision:5}});assert.equal(refreshing.value.ok,true);assert.equal(h.api.directoryRevision,5);
});
