const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const compiled=process.env.CLEANROOMS_TEST_BUILD,root=path.resolve(__dirname,'..');
const {EmployeeOfflineCache,offlineMaxAge,offlineMaxBytes}=require(path.join(compiled,'state/employee-offline-cache.js'));
const now=Date.parse('2026-11-10T12:00:00Z'),scope='a'.repeat(64),otherScope='b'.repeat(64),period=JSON.stringify(['2026-11-09','2026-11-15']);
const session={expiresAt:'2026-11-20T12:00:00Z',employee:{workspaceId:'company-one',personId:'employee-one',email:'one@example.test',name:'Employee One'},temporaryPassword:false};
const shift=(patch={})=>({shift:{id:'own-night',personId:'employee-one',siteId:'own-site',date:'2026-11-09',start:'22:00',end:'06:00',breakMinutes:30,role:'Service',description:'Sensitive instructions Æøå',checklist:[{id:'task-1',text:'Lock door'}],...patch},site:{id:'own-site',name:'Own site',address:'Own street',worksiteInfo:{contactName:'Customer',contactPhone:'+45 12345678',parking:'Behind building',accessInstructions:'Use side entrance'}}});
const detail=patch=>({...shift(patch),clockInRadius:200,entry:{version:1,status:'running',clockIn:'2026-11-09T21:00:00Z',clockOut:null,pauseAt:null},completedTaskIds:['task-1'],checklistToken:'e'.repeat(64)});
function storage(){let value=null;return{read:async()=>value,write:async(_scope,next)=>{value=next;},clear:async()=>{value=null;},raw:()=>value};}
async function fixture(){const native=storage();let time=now;const cache=new EmployeeOfflineCache(native,()=>time);await cache.remember(scope,session,cache.lease());return{native,cache,advance:ms=>{time+=ms;}};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a fresh process restores only the matching identity, complete window and fetched instructions',async()=>{
 const {native,cache}=await fixture(),lease=cache.lease();assert.equal(await cache.restore(scope,lease),null,'identity alone must not imply a downloaded plan');
 await cache.save(scope,'schedule',period,[shift()],lease);await cache.save(scope,'detail','own-night',detail(),lease);
 const reopened=new EmployeeOfflineCache(native,()=>now),restored=await reopened.restore(scope,reopened.lease());assert.deepEqual(restored.session,session);
 const record=await reopened.read(scope,'detail','own-night',reopened.lease());assert.equal(record.data.shift.description,'Sensitive instructions Æøå');assert.equal(record.data.site.worksiteInfo.accessInstructions,'Use side entrance');
 assert.deepEqual(record.data.completedTaskIds,['task-1']);assert.equal(record.data.checklistToken,null);assert.equal(record.data.entry,null,'a stale clock registration cannot become write authority');assert.equal(record.data.clockInRadius,null);
 assert.equal(await reopened.read(otherScope,'schedule',period,reopened.lease()),null);
});
test('offline reads expire at the earlier of 24 hours or actual session expiry, including backwards clocks',async()=>{
 const {cache,advance}=await fixture();await cache.save(scope,'schedule',period,[shift()],cache.lease());advance(offlineMaxAge);
 assert.equal(await cache.restore(scope,cache.lease()),null);assert.equal(await cache.read(scope,'schedule',period,cache.lease()),null);
 const native=storage(),short=new EmployeeOfflineCache(native,()=>now);await short.remember(scope,{...session,expiresAt:new Date(now+1000).toISOString()},0);await short.save(scope,'schedule',period,[shift()],0);
 assert.equal(await new EmployeeOfflineCache(native,()=>now+1000).restore(scope,0),null);assert.equal(await new EmployeeOfflineCache(native,()=>now-120000).restore(scope,0),null);
});
test('foreign people, malformed snapshots, duplicate rows and unrelated data cannot be cached',async()=>{
 const {cache,native}=await fixture();await assert.rejects(cache.save(scope,'schedule',period,[shift({personId:'foreign-person'})],0),/Invalid offline/);
 await assert.rejects(cache.save(scope,'schedule',period,[shift(),shift()],0),/Duplicate/);
 await assert.rejects(cache.save(scope,'detail','own-night',{payroll:{total:100}},0),/Invalid offline/);
 assert.equal(await cache.save(scope,'schedule','not-a-date-range',[shift()],0),false);
 await native.write(scope,JSON.stringify({schema:1,scope,session,verifiedAt:now,records:[{kind:'schedule',key:period,savedAt:now,data:[shift({personId:'foreign'})]}]}));
 assert.equal(await new EmployeeOfflineCache(native,()=>now).restore(scope,0),null);
});
test('logout fences pending writes immediately and its serialized cleanup wins over old completion',async()=>{
 const {native,cache}=await fixture(),entered=deferred(),release=deferred();let pause=true;
 const repository=new EmployeeOfflineCache({...native,write:async(key,value)=>{if(pause){pause=false;entered.resolve();await release.promise;}await native.write(key,value);}},()=>now);
 const lease=repository.lease(),writing=repository.save(scope,'schedule',period,[shift()],lease);await entered.promise;
 const clearing=repository.clear();assert.notEqual(repository.lease(),lease);release.resolve();await assert.rejects(writing,/account changed/);await clearing;
 assert.equal(native.raw(),null);await assert.rejects(repository.read(scope,'schedule',period,lease),/account changed/);
});
test('a missing or changed published assignment removes obsolete offline cards and old instructions',async()=>{
 const {cache}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);await cache.save(scope,'detail','own-night',detail(),0);
 await cache.save(scope,'detail','own-night',null,0);assert.deepEqual((await cache.read(scope,'schedule',period,0)).data,[]);
 await cache.save(scope,'detail','own-night',detail(),0);await cache.save(scope,'schedule',period,[],0);assert.equal(await cache.read(scope,'detail','own-night',0),null);
});
test('oversized offline details are skipped intact online and bounded LRU never grows past its budget',async()=>{
 const {cache,native}=await fixture();const long=detail({description:'👩🏽‍💻'.repeat(100000)});assert.equal(await cache.save(scope,'detail','large',long,0),false);assert.equal(long.shift.description.length,700000);
 for(let n=0;n<35;n++)await cache.save(scope,'detail','detail-'+n,detail({id:'detail-'+n,description:'Instruction '.repeat(4000)}),0);
 assert.ok(Buffer.byteLength(native.raw())<=offlineMaxBytes);assert.ok(JSON.parse(native.raw()).records.length<=24);assert.equal(await cache.read(scope,'detail','detail-0',0),null);
});

function hooks(){let index=0,slots=[],effects=[],cleanup=new Map();const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,n)=>!Object.is(v,b[n]));const react={
 useRef:value=>{const n=index++;return slots[n]??={current:value};},useState:value=>{const n=index++;if(!(n in slots))slots[n]=typeof value==='function'?value():value;return[slots[n],next=>{slots[n]=typeof next==='function'?next(slots[n]):next;}];},
 useCallback:(callback,deps)=>{const n=index++;if(changed(slots[n]?.deps,deps))slots[n]={callback,deps};return slots[n].callback;},useEffect:(callback,deps)=>{const n=index++;if(changed(slots[n],deps)){slots[n]=deps;effects.push(()=>{cleanup.get(n)?.();cleanup.set(n,callback());});}},
 createContext:()=>({}),use:()=>{},};react.useLayoutEffect=react.useEffect;return{react,render(fn){index=0;const result=fn();const queue=effects;effects=[];queue.forEach(fn=>fn());return result;},unmount(){cleanup.forEach(fn=>fn?.());}};}
class MobileAuthError extends Error{constructor(code,status,message){super(message);this.code=code;this.status=status;}}
const network=()=>new MobileAuthError('mobile_connection_failed',503,'Offline');
function loadModule(relative,dependencies,extra={}){const filename=path.join(root,relative),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText;vm.runInNewContext(code,{module,exports:module.exports,TextEncoder,TextDecoder,Date,Map,Set,Promise,Error,Number,String,Array,Object,JSON,console,queueMicrotask,...extra,require:name=>{if(name in dependencies)return dependencies[name];throw Error('Unexpected offline dependency '+name);}});return module.exports;}
function resources(auth,clockDate=Date){const h=hooks(),mod=loadModule('src/state/published-schedule.ts',{'react':h.react,'expo-router':{useFocusEffect:cb=>h.react.useEffect(cb,[cb])},'react-native':{AppState:{addEventListener:()=>({remove(){}})}},'@/auth/mobile-auth':{useMobileAuth:()=>auth,offlineConnectionFailure:error=>error instanceof MobileAuthError&&error.code==='mobile_connection_failed'},'@/auth/mobile-auth-api':{MobileAuthError},'./employee-offline-cache':require(path.join(compiled,'state/employee-offline-cache.js')),'@/domain/model':require(path.join(compiled,'domain/model.js'))},{Date:clockDate});return{render:load=>h.render(()=>mod.usePublishedResource(period,load,true,'schedule')),schedule:()=>h.render(()=>mod.usePublishedSchedule('2026-11-09','2026-11-15')),unmount:h.unmount};}

test('actual published hook restores a completed snapshot on network failure and rejects revoked-authority fallback',async()=>{
 const {cache}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);let writes=0;
 const auth={state:{mode:'signedIn',session},sessionEpoch:1,offlineLease:0,readOfflineResource:(kind,key,lease)=>cache.read(scope,kind,key,lease),saveOfflineResource:async()=>{writes++;}};
 const h=resources(auth,class extends Date{static now(){return now;}});let error=network();const load=async()=>{throw error;};h.render(load);await tick();let view=h.render(load);assert.equal(view.offline,true);assert.equal(view.data[0].shift.id,'own-night');assert.equal(view.error,undefined);assert.equal(writes,0);
 error=new MobileAuthError('forbidden',403,'No access');view.refresh();await tick();view=h.render(load);assert.equal(view.data,undefined);assert.equal(view.offline,false);assert.equal(view.error,'No access');h.unmount();
});
test('partial pagination and late old-account replies never persist or expose an incomplete/new-account plan',async()=>{
 const {cache}=await fixture();let writes=0;const old=deferred();const auth={state:{mode:'signedIn',session},sessionEpoch:1,offlineLease:0,readOfflineResource:async()=>null,saveOfflineResource:async()=>{writes++;},readPublishedSchedule:async(_from,_to,cursor)=>cursor?Promise.reject(network()):{shifts:[shift()],nextCursor:'page-two'}};
 const h=resources(auth);h.schedule();await tick();assert.equal(h.schedule().data,undefined);assert.equal(writes,0);h.unmount();
 const second=resources(auth);const load=()=>old.promise;second.render(load);await tick();auth.sessionEpoch=2;auth.offlineLease=cache.lease()+1;auth.state={mode:'signedIn',session:{...session,employee:{...session.employee,personId:'new-person'}}};const fresh=async()=>[];second.render(fresh);await tick();old.resolve([shift()]);await tick();assert.deepEqual(Array.from(second.render(fresh).data),[]);assert.equal(writes,1,'only the completed current account can save');second.unmount();
});

async function authFixture({cached=true,online=false,sessionReply=session}={}){
 const native=storage(),cache=new EmployeeOfflineCache(native),token='synthetic-own-session-token-not-used-on-a-network',origin='https://own.example.test';
 const binding=crypto.createHash('sha256').update(JSON.stringify([origin,token])).digest('hex');
 const freshSession={...session,expiresAt:new Date(Date.now()+86400000).toISOString()};
 if(cached){await cache.remember(binding,freshSession,0);await cache.save(binding,'schedule',period,[shift()],0);}
 const secrets=new Map([['cleanrooms.mobile-auth.v1',JSON.stringify({origin,token})]]),h=hooks(),events=[],calls=[],timers=[];
 let connected=online,reply=sessionReply,error=null,sessionDeferred=null,closing=null;
 const api={session:async supplied=>{calls.push(['session',supplied]);if(sessionDeferred)return sessionDeferred.promise;if(error)throw error;if(!connected)throw network();return{...reply,expiresAt:freshSession.expiresAt};},
   publishedSchedule:async()=>({shifts:[shift()],nextCursor:null}),publishedShift:async()=>detail(),activeTime:async()=>null,
   shiftTime:async()=>{calls.push(['clock']);return{version:1,status:'running'};},employeeRequest:async(_token,payload)=>{calls.push(['employee',payload.action]);return{};},logout:async()=>{},
   login:async()=>({token:'synthetic-new-session-token-not-used-on-a-network',session:{...freshSession,employee:{...freshSession.employee,personId:'employee-two'}}})};
 const offline={employeeOffline:cache,clearEmployeeOffline:()=>cache.clear(),offlineScope:async(o,t)=>crypto.createHash('sha256').update(JSON.stringify([o,t])).digest('hex')};
 const mod=loadModule('src/auth/mobile-auth.tsx',{
   'react':h.react,'react/jsx-runtime':{jsx:(_tag,props)=>props.value},'expo-secure-store':{WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async key=>secrets.get(key)||null,setItemAsync:async(key,value)=>{secrets.set(key,value);},deleteItemAsync:async key=>{secrets.delete(key);}},
   'react-native':{AppState:{addEventListener:(_type,fn)=>{events.push(fn);return{remove(){}};}}},'./pending-logouts':{PendingLogouts:class{flush=async()=>{};hasPending=async()=>false;contains=async()=>false;enqueue=async()=>{};}},
   '@/notifications/push-account-events':{closePushAccount:async()=>{if(closing)await closing.promise;}},'@/state/private-drafts':{clearEmployeeDrafts:async()=>{}},'@/state/employee-offline':offline,
   '@/state/employee-offline-cache':{offlineMaxAge},'./mobile-auth-api':{canUseMobileAuth:true,mobileAuthOrigin:origin,MobileAuthError,isSessionToken:value=>typeof value==='string'&&value.length>20,mobileAuthApi:api},
 },{setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
 const render=()=>h.render(()=>mod.MobileAuthProvider({children:null}));
 return{render,calls,cache,secrets,events,timers,token,binding,api,unmount:h.unmount,connect:()=>{connected=true;},fail:next=>{error=next;},wait:next=>{sessionDeferred=next;},closeWait:next=>{closing=next;}};
}
test('actual auth cold boot opens cached read-only data after process restart and blocks every mutation offline',async()=>{
 const h=await authFixture();h.render();await tick();await tick();let value=h.render();assert.equal(value.state.mode,'signedIn');assert.equal(value.state.offline,true);
 const record=await value.readOfflineResource('schedule',period,value.offlineLease);assert.equal(record.data[0].shift.id,'own-night');
 await assert.rejects(value.writeShiftTime({operation:'start'}),/forbindelse/);await assert.rejects(value.employeeRequest({action:'checklistWrite'}),/forbindelse/);
 assert.equal(h.calls.some(call=>['clock','employee'].includes(call[0])),false,'offline writes never reach HTTP and never pretend success');
 h.connect();h.events.forEach(fn=>fn('active'));await tick();await tick();value=h.render();assert.equal(value.state.offline,undefined);assert.equal(value.state.connection,'online');
 await value.writeShiftTime({operation:'start'});assert.equal(h.calls.filter(call=>call[0]==='clock').length,1);h.unmount();
});
test('chat list and conversation polling recover an offline session without a foreground event', async () => {
  const polls = [
    { action: 'chatList', cursor: null, limit: 100 },
    { action: 'chatSync', roomId: 'room-one', afterSeq: 12, version: 1, limit: 50 },
  ];
  for (const poll of polls) {
    const fixture = await authFixture();
    try {
      fixture.render();
      await tick();
      await tick();
      const auth = fixture.render();
      assert.equal(auth.state.connection, 'offline');

      const before = fixture.calls.length;
      await assert.rejects(auth.employeeRequest({ action: 'chatSend' }), { code: 'mobile_offline_read_only' });
      await assert.rejects(auth.employeeRequest({ action: 'chatReadMark' }), { code: 'mobile_offline_read_only' });
      assert.equal(fixture.calls.length, before, 'chat writes cannot start a request while offline');

      await assert.rejects(auth.employeeRequest(poll), { code: 'mobile_connection_failed' });
      assert.deepEqual(fixture.calls.slice(before), [['session', fixture.token]], 'an offline poll checks the session before reading chat');

      fixture.connect();
      await auth.employeeRequest(poll);
      assert.deepEqual(fixture.calls.slice(before + 1), [['session', fixture.token], ['employee', poll.action]]);
      assert.equal(fixture.render().state.connection, 'online');
    } finally {
      fixture.unmount();
    }
  }
});
test('an actual revoked session purges cached identity and protected data instead of restoring it again offline',async()=>{
 const h=await authFixture();h.fail(new MobileAuthError('mobile_session_invalid',401,'Revoked'));h.render();await tick();await tick();const value=h.render();assert.equal(value.state.mode,'signedOut');
 assert.equal(h.secrets.has('cleanrooms.mobile-auth.v1'),false);assert.equal(await h.cache.restore(h.binding,h.cache.lease()),null);h.unmount();
});
test('actual logout synchronously fences pending resource storage and prevents old data after another account signs in',async()=>{
 const h=await authFixture();h.render();await tick();await tick();let value=h.render(),oldLease=value.offlineLease;
 assert.equal((await value.signOut()).ok,true);assert.notEqual(h.cache.lease(),oldLease);assert.equal(await value.readOfflineResource('schedule',period,oldLease),null);
 value=h.render();assert.equal(value.state.mode,'signedOut');assert.equal((await value.signIn('two@example.test','synthetic-password')).ok,true);value=h.render();
 assert.equal(value.state.session.employee.personId,'employee-two');assert.equal(await value.readOfflineResource('schedule',period,oldLease),null);h.unmount();
});
test('cached identity remains read-only during a slow server check and clears when its local grace expires',async()=>{
 const h=await authFixture(),pending=deferred();h.wait(pending);h.render();await tick();let value=h.render();assert.equal(value.state.mode,'signedIn');assert.equal(value.state.connection,'checking');
 await assert.rejects(value.writeShiftTime({operation:'finish'}),/forbindelse/);assert.ok(h.timers.length>0);h.timers.at(-1)();await tick();
 value=h.render();assert.equal(value.state.mode,'signedOut');pending.resolve({...session,expiresAt:new Date(Date.now()+86400000).toISOString()});await tick();assert.equal(h.render().state.mode,'signedOut','late verification cannot reopen an expired local view');h.unmount();
});

test('a session reply started before logout cannot recreate the encrypted cache while device teardown is still pending',async()=>{
 const h=await authFixture();h.render();await tick();await tick();const pending=deferred(),closing=deferred();h.wait(pending);h.closeWait(closing);
 h.events.forEach(fn=>fn('active'));await tick();const old=h.render();const logout=old.signOut();
 pending.resolve({...session,expiresAt:new Date(Date.now()+86400000).toISOString()});await tick();await tick();
 assert.equal(await h.cache.restore(h.binding,h.cache.lease()),null);closing.resolve();await logout;assert.equal(h.render().state.mode,'signedOut');h.unmount();
});
function encryptedStore({secrets=new Map(),files=new Map()}={}){
 let failDelete=false;
 class NativeFile{constructor(...parts){this.uri=parts.map(value=>typeof value==='string'?value:value.uri).join('/');}get exists(){return files.has(this.uri);}get size(){return files.get(this.uri)?.length??0;}get name(){return this.uri.split('/').at(-1);}create(){files.set(this.uri,Buffer.alloc(0));}write(value){files.set(this.uri,Buffer.from(value));}async bytes(){return new Uint8Array(files.get(this.uri));}async move(destination){files.set(destination.uri,files.get(this.uri));files.delete(this.uri);this.uri=destination.uri;}delete(){files.delete(this.uri);}}
 const encryption={AESEncryptionKey:{generate:async()=>{const value=crypto.randomBytes(32).toString('hex');return{encoded:async()=>value};},import:async value=>({encoded:async()=>value})},AESSealedData:{fromCombined:value=>({combined:async()=>value})},
  aesEncryptAsync:async(value,key,{additionalData})=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(await key.encoded(),'hex'),iv);cipher.setAAD(Buffer.from(additionalData));const ciphertext=Buffer.concat([cipher.update(value),cipher.final()]);const result=Buffer.concat([iv,ciphertext,cipher.getAuthTag()]);return{combined:async()=>new Uint8Array(result)};},
  aesDecryptAsync:async(value,key,{additionalData})=>{const bytes=Buffer.from(await value.combined()),decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(await key.encoded(),'hex'),bytes.subarray(0,12));decipher.setAAD(Buffer.from(additionalData));decipher.setAuthTag(bytes.subarray(-16));return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]));},
  CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_algorithm,value)=>crypto.createHash('sha256').update(value).digest('hex'),randomUUID:crypto.randomUUID};
 const mod=loadModule('src/state/employee-offline.ts',{'expo-crypto':encryption,'expo-file-system':{File:NativeFile,Paths:{cache:'/private-cache'}},'expo-secure-store':{WHEN_UNLOCKED_THIS_DEVICE_ONLY:7,getItemAsync:async key=>secrets.get(key)||null,setItemAsync:async(key,value,options)=>{assert.equal(options.keychainAccessible,7);secrets.set(key,value);},deleteItemAsync:async key=>{if(failDelete)throw Error('Keychain unavailable');secrets.delete(key);}},'./employee-offline-cache':require(path.join(compiled,'state/employee-offline-cache.js'))});
 return{mod,secrets,files,reload:()=>encryptedStore({secrets,files}),failDelete:()=>{failDelete=true;}};
}
test('the actual native adapter writes only authenticated ciphertext and rejects a tampered file or another account binding',async()=>{
 const native=encryptedStore(),cache=native.mod.employeeOffline,fresh={...session,expiresAt:new Date(Date.now()+86400000).toISOString()};
 await cache.remember(scope,fresh,0);await cache.save(scope,'detail','own-night',detail(),0);
 assert.equal(native.files.size,1);const ciphertext=[...native.files.values()][0];assert.ok(!ciphertext.includes(Buffer.from('Sensitive instructions')));assert.ok(!ciphertext.includes(Buffer.from(session.employee.name)));assert.ok(![...native.secrets.values()].some(value=>value.includes('Sensitive instructions')));
 // Re-evaluate the real adapter to model a native process restart.
 const filename=[...native.files.keys()][0],original=Buffer.from(ciphertext);native.files.set(filename,Buffer.from(original));native.files.get(filename)[15]^=1;
 const restarted=native.reload();assert.equal(await restarted.mod.employeeOffline.restore(scope,0),null,'authenticated decryption must reject the modified ciphertext');
 native.files.set(filename,original);
 assert.equal(await native.reload().mod.employeeOffline.restore(otherScope,0),null);
 assert.ok(await native.reload().mod.employeeOffline.restore(scope,0),'unchanged ciphertext remains readable for its original account');
});
test('native ciphertext is deleted even when Keychain cleanup fails, and no temporary payload survives logout',async()=>{
 const native=encryptedStore(),cache=native.mod.employeeOffline;await cache.remember(scope,{...session,expiresAt:new Date(Date.now()+86400000).toISOString()},0);await cache.save(scope,'schedule',period,[shift()],0);
 native.failDelete();await assert.rejects(cache.clear(),/Keychain/);assert.equal(native.files.size,0);assert.equal(await cache.restore(scope,cache.lease()),null);
});


test('actual cached provenance stays read-only throughout online revalidation and a malformed response; expired cached data cannot linger',async()=>{
 let time=now;class Clock extends Date{static now(){return time;}}
 const saved={data:[shift()],savedAt:now};const auth={state:{mode:'signedIn',session},sessionEpoch:1,offlineLease:0,readOfflineResource:async()=>saved,saveOfflineResource:async()=>{}};
 const h=resources(auth,Clock),pending=deferred();let result=pending;const load=()=>result.promise;h.render(load);await tick();let view=h.render(load);assert.equal(view.offline,true);assert.equal(view.savedAt,now);
 auth.state={mode:'signedIn',session,connection:'online'};view.refresh();view=h.render(load);assert.equal(view.offline,true,'beginning refresh must not turn cached instructions into live point authority');assert.equal(view.savedAt,now);
 pending.reject(new MobileAuthError('mobile_schedule_invalid',503,'Malformed reply'));await tick();view=h.render(load);assert.equal(view.offline,true);assert.equal(view.error,'Malformed reply');
 const fresh=deferred();result=fresh;view.refresh();time+=offlineMaxAge;view=h.render(load);assert.equal(view.data,undefined);assert.match(view.error,/udløbet/);
 fresh.reject(network());await tick();view=h.render(load);assert.equal(view.data,undefined);assert.match(view.error,/ikke gemt offline/);h.unmount();
});


test('repeated endpoint permission denials purge once instead of creating a generation/refetch loop',async()=>{
 const h=await authFixture({online:true});h.render();await tick();await tick();let value=h.render();assert.equal(value.state.connection,'online');
 h.api.employeeRequest=async()=>{throw new MobileAuthError('employee_scope_forbidden',403,'Not permitted');};
 const old=value.sessionEpoch;await assert.rejects(value.employeeRequest({action:'employeeColleagues'}),/Not permitted/);value=h.render();
 assert.equal(value.sessionEpoch,old+1);const lease=h.cache.lease();
 await assert.rejects(value.employeeRequest({action:'employeeColleagues'}),/Not permitted/);value=h.render();assert.equal(value.sessionEpoch,old+1);assert.equal(h.cache.lease(),lease);assert.equal(value.state.mode,'signedIn');h.unmount();
});


test('a fresh complete own calendar supplies basic offline shift details without inventing an opened point or write authority',async()=>{
 const {native,cache,advance}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);
 const basic=await cache.read(scope,'detail','own-night',0);assert.equal(basic.data.offlineSummary,true);assert.equal(basic.data.shift.date,'2026-11-09');assert.equal(basic.data.shift.start,'22:00');assert.equal(basic.data.shift.end,'06:00');assert.equal(basic.data.site.address,'Own street');
 assert.equal(basic.data.shift.description,'');assert.deepEqual(basic.data.shift.checklist,[]);assert.equal(basic.data.site.worksiteInfo,undefined);
 assert.equal(basic.data.entry,null);assert.equal(basic.data.clockInRadius,null);assert.equal(basic.data.checklistToken,null);assert.deepEqual(basic.data.completedTaskIds,[]);
 assert.equal(JSON.parse(native.raw()).records.some(record=>record.kind==='detail'),false,'reading a summary cannot manufacture an acknowledged point');
 await assert.rejects(cache.save(scope,'detail','own-night',basic.data,0),/not an acknowledged/);
 assert.equal(await cache.read(scope,'detail','never-published',0),null);assert.equal(await cache.read(otherScope,'detail','own-night',0),null);
 assert.ok(await cache.read(scope,'detail','own-night',0));advance(offlineMaxAge);assert.equal(await cache.read(scope,'detail','own-night',0),null);
});
test('an actually opened detail wins over a calendar fallback and an explicit withdrawal cannot be resurrected by an older window',async()=>{
 const {cache}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);await cache.save(scope,'detail','own-night',detail(),0);
 let opened=await cache.read(scope,'detail','own-night',0);assert.equal(opened.data.offlineSummary,undefined);assert.equal(opened.data.shift.description,'Sensitive instructions Æøå');assert.equal(opened.data.site.worksiteInfo.accessInstructions,'Use side entrance');
 await cache.save(scope,'detail','own-night',null,0);await cache.save(scope,'schedule',period,[shift()],0);
 const withdrawn=await cache.read(scope,'detail','own-night',0);assert.equal(withdrawn.data,null,'a known withdrawn point has priority over a remaining calendar observation');
});
test('point updates keep calendar windows compact instead of duplicating instructions and worksite guidance',async()=>{
 const {cache,native}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);await cache.save(scope,'schedule',JSON.stringify(['2026-11-09','2026-11-20']),[shift()],0);
 const large=detail({description:'Long own instructions '.repeat(5000),checklist:[{id:'task-1',text:'Task instruction '.repeat(1000)}]});
 large.site.worksiteInfo.accessInstructions='Site instruction '.repeat(5000);await cache.save(scope,'detail','own-night',large,0);
 for(const record of JSON.parse(native.raw()).records.filter(record=>record.kind==='schedule')){const value=record.data[0];assert.equal(value.shift.description,'');assert.deepEqual(value.shift.checklist,[]);assert.equal(value.site.worksiteInfo,undefined);assert.equal(value.clockInRadius,undefined);}
 assert.equal((await cache.read(scope,'detail','own-night',0)).data.shift.description,large.shift.description,'the opened point still retains the complete allowed instructions');
});


test('a newer same-ID calendar time invalidates stale opened instructions and offline detail falls back to the fresh time',async()=>{
 const {cache}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);await cache.save(scope,'detail','own-night',detail(),0);
 const changed=shift({start:'23:00',end:'07:00'});await cache.save(scope,'schedule',period,[changed],0);
 const read=await cache.read(scope,'detail','own-night',0);assert.equal(read.data.offlineSummary,true);assert.equal(read.data.shift.start,'23:00');assert.equal(read.data.shift.end,'07:00');assert.equal(read.data.shift.description,'');assert.equal(read.data.site.worksiteInfo,undefined);
 const freshPoint={...detail({start:'23:00',end:'07:00'}),site:changed.site};await cache.save(scope,'detail','own-night',freshPoint,0);
 await cache.save(scope,'schedule',period,[changed],0);const unchanged=await cache.read(scope,'detail','own-night',0);assert.equal(unchanged.data.offlineSummary,undefined);assert.equal(unchanged.data.shift.description,'Sensitive instructions Æøå','an unchanged summary keeps the previously opened full instructions');
});
test('cross-week/site relocation supersedes the old point and all cached calendar geometry despite identical download timestamps',async()=>{
 const {cache}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);await cache.save(scope,'detail','own-night',detail(),0);
 const nextPeriod=JSON.stringify(['2026-11-16','2026-11-22']),moved={...shift({date:'2026-11-16',siteId:'new-site'}),site:{id:'new-site',name:'New workplace',address:'New address'}};
 await cache.save(scope,'schedule',nextPeriod,[moved],0);const point=await cache.read(scope,'detail','own-night',0);
 assert.equal(point.data.offlineSummary,true);assert.equal(point.data.shift.date,'2026-11-16');assert.equal(point.data.site.id,'new-site');assert.equal(point.data.site.address,'New address');assert.deepEqual((await cache.read(scope,'schedule',period,0)).data,[],'the old window cannot retain a contradictory row');
 await cache.save(scope,'schedule',nextPeriod,[],0);assert.equal(await cache.read(scope,'detail','own-night',0),null,'a later complete empty window cannot resurrect an older cached calendar summary');
});
test('changed pause or workplace name/address invalidates only the incompatible opened point',async()=>{
 for(const change of [{shift:{breakMinutes:45}},{shift:{role:'New role'}},{shift:{previousTime:{start:'21:00',end:'05:00'}}},{site:{name:'Renamed site'}},{site:{address:'Changed entrance address'}}]){
  const {cache}=await fixture();await cache.save(scope,'schedule',period,[shift()],0);await cache.save(scope,'detail','own-night',detail(),0);const summary=shift();Object.assign(summary.shift,change.shift);Object.assign(summary.site,change.site);await cache.save(scope,'schedule',period,[summary],0);
  const point=await cache.read(scope,'detail','own-night',0);assert.equal(point.data.offlineSummary,true);assert.equal(point.data.shift.breakMinutes,summary.shift.breakMinutes);assert.equal(point.data.site.name,summary.site.name);assert.equal(point.data.site.address,summary.site.address);assert.equal(point.data.shift.role,summary.shift.role??'');assert.deepEqual(point.data.shift.previousTime,summary.shift.previousTime);
 }
});
