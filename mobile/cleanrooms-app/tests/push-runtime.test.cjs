const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function transpile(file){return ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:file}).outputText;}
function load(file,globals={}){const module={exports:{}};vm.runInNewContext(transpile(file),{module,exports:module.exports,...globals});return module.exports;}
const wire=load('src/notifications/push-wire.ts');
const preferences=load('src/state/employee-preferences-wire.ts',{require:id=>{assert.equal(id,'../domain/model');return load('src/domain/model.ts');}});
const installationId='96377345-250b-426a-b3cf-edb1481e7130',projectId='aa411426-95bc-45f2-9676-e46db520d23b';
const hint={v:1,eventId:'a'.repeat(32),installationId};
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('push hints carry only opaque event and installation identifiers; payload URLs and extra authority fail closed',()=>{
  assert.deepEqual(plain(wire.parsePushHint(hint)),hint);
  for(const value of [null,[],{}, {...hint,v:2},{...hint,url:'https://external.test'},{...hint,personId:'other'},
    {...hint,installationId:'not-uuid'},{...hint,eventId:'../account'},{...hint,eventId:'a'.repeat(33)}]) assert.equal(wire.parsePushHint(value),null);
  assert.equal(wire.validProjectId(projectId),true);assert.equal(wire.validProjectId('not-project'),false);
});
test('only authenticated, bounded server targets become fixed internal routes',()=>{
  for(const [target,route] of [
    [{kind:'shift',shiftId:'series-abc@2026-11-09'},{pathname:'/shift/[id]',params:{id:'series-abc@2026-11-09'}}],
    [{kind:'chat',roomId:'chat-abc'},{pathname:'/chat/[id]',params:{id:'chat-abc'}}],
    [{kind:'inbox'},'/notifications'],
  ]) assert.deepEqual(plain(wire.pushRoute(wire.parsePushTarget({target}))),route);
  for(const target of [{kind:'url',url:'https://external.test'},{kind:'shift',shiftId:'../account'},{kind:'shift',shiftId:'abc%2Fdef'},
    {kind:'chat',roomId:'https://external.test'},{kind:'inbox',url:'/account'},{kind:'shift',shiftId:'a',personId:'another'},
    {kind:'shift',shiftId:'x'.repeat(513)}]) assert.throws(()=>wire.parsePushTarget({target}),/Beskeden/);
});
test('notification taps deduplicate races, reject foreign installation and discard reads after account switch',async()=>{
  const guard=new wire.PushOpenGuard(),routes=[];guard.setScope('account-a');
  let release,reads=0;const response=new Promise(resolve=>{release=resolve;});
  const first=guard.open(hint,installationId,()=>{reads++;return response;},target=>routes.push(target));
  assert.equal(await guard.open(hint,installationId,async()=>{reads++;return{};},()=>{}),false);
  assert.equal(await guard.open({...hint,installationId:projectId},installationId,async()=>{reads++;return{};},()=>{}),false);
  guard.setScope('account-b');release({target:{kind:'shift',shiftId:'own-a'}});
  assert.equal(await first,false);assert.equal(routes.length,0);assert.equal(reads,1);
  assert.equal(await guard.open(hint,installationId,async()=>({target:{kind:'chat',roomId:'own-b'}}),target=>routes.push(target)),true);
  assert.equal(await guard.open(hint,installationId,async()=>{throw Error('duplicate');},()=>{}),false);assert.equal(routes.length,1);
});
test('temporary target-read failure and a superseded intent remain retryable without reporting a completed open',async()=>{
  const guard=new wire.PushOpenGuard();guard.setScope('account');
  await assert.rejects(guard.open(hint,installationId,async()=>{throw Error('offline');},()=>{}),/offline/);
  assert.equal(await guard.open(hint,installationId,async()=>({target:{kind:'inbox'}}),()=>false),false);
  assert.equal(await guard.open(hint,installationId,async()=>({target:{kind:'inbox'}}),()=>{}),true);
});

function actualSync(overrides={}){
  const filename='src/notifications/push-notifications.tsx',source=fs.readFileSync(path.join(root,filename),'utf8');
  const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);let sync;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='sync')sync=node.initializer.arguments[0];ts.forEachChild(node,visit);}visit(tree);assert.ok(sync);
  const calls=[],states=[],nativeCalls=[],retries=[];
  let permission={granted:true,canAskAgain:true,ios:{status:2}};
  const module={IosAuthorizationStatus:{AUTHORIZED:2,PROVISIONAL:3,EPHEMERAL:4},AndroidImportance:{DEFAULT:3},AndroidNotificationVisibility:{PRIVATE:0},
    getPermissionsAsync:async()=>{nativeCalls.push('get-permission');return permission;},
    requestPermissionsAsync:async()=>{nativeCalls.push('request-permission');return permission;},
    getExpoPushTokenAsync:async options=>{nativeCalls.push({tokenOptions:options});return{data:'ExpoPushToken[synthetic-token-12345]'};},
    setNotificationChannelAsync:async()=>{nativeCalls.push('channel');},
  };
  class MobileAuthError extends Error{}
  const context=vm.createContext({Date,queueMicrotask,Constants:{easConfig:{projectId}},Device:{isDevice:true},process:{env:{EXPO_OS:'ios'}},validProjectId:wire.validProjectId,permitted: (p,n)=>p.ios?.status===n.IosAuthorizationStatus.AUTHORIZED||p.ios?.status===n.IosAuthorizationStatus.PROVISIONAL,
    MobileAuthError,clearTimeout,pushPreferencesEnabled:preferences.pushPreferencesEnabled,retryGate:{current:{ready:()=>true,success(){}}},retryTimer:{current:null},scheduleRetry:(...args)=>retries.push(args),unavailable:'unavailable',retryMessage:'retry',status:{status:'checking'},setStatus:value=>states.push(value),
    running:{current:null},refreshAfterCurrent:{current:false},scopeRef:{current:'account-a'},closedScope:{current:null},native:{current:module},nativeId:{current:installationId},deviceToken:{current:undefined},
    lastSync:{current:0},generation:{current:0},mounted:{current:true},lastRegistration:{current:null},enabled:{current:false},syncRef:{current:null},
    requestRef:{current:async payload=>{calls.push(plain(payload));if(payload.action==='employeePreferences')return{notifications:true,chatNotifications:false};return{registered:payload.action==='employeePushRegister'};}},...overrides,
  });
  vm.runInContext(ts.transpileModule('globalThis.sync='+sync.getText(tree)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  context.syncRef.current=context.sync;
  return{context,calls,states,nativeCalls,retries,module,setPermission:value=>{permission=value;},sync:(...args)=>context.sync(...args)};
}
test('native startup never prompts; granted iOS provisional authorization registers using current scoped API and configured project only',async()=>{
  const app=actualSync();app.setPermission({granted:false,canAskAgain:true,ios:{status:3}});
  assert.equal(await app.sync(),true);assert.equal(app.nativeCalls.includes('request-permission'),false);
  const command=app.calls.find(call=>call.action==='employeePushRegister');
  assert.deepEqual(command,{action:'employeePushRegister',installationId,expoPushToken:'ExpoPushToken[synthetic-token-12345]',platform:'ios',projectId});
  assert.equal(Object.hasOwn(command,'personId'),false);assert.equal(app.states.at(-1).status,'ready');
  await app.sync();assert.equal(app.calls.filter(call=>call.action==='employeePushRegister').length,1);
});
test('permission denial and missing project configuration fail closed without blocking login',async()=>{
  const denied=actualSync();denied.setPermission({granted:false,canAskAgain:false,ios:{status:1}});
  assert.equal(await denied.sync(true,true),false);assert.equal(denied.nativeCalls.includes('request-permission'),false);assert.equal(denied.calls.some(call=>call.action==='employeePushRegister'),false);assert.equal(denied.states.at(-1).status,'permission-denied');
  for(const overrides of [{Constants:{easConfig:null,expoConfig:{}}}]){
    const app=actualSync(overrides);assert.equal(await app.sync(),false);assert.equal(app.calls.some(call=>call.action==='employeePushRegister'),false);assert.equal(app.states.at(-1).status,'unavailable');
  }
});

test('supported native simulators can register when the native push API supplies a token',async()=>{
  // SDK57 supports APNs on modern iOS simulators and Google Play-enabled emulators.
  // Capability is determined by the native token API, not Device.isDevice.
  const app=actualSync({Device:{isDevice:false}});
  assert.equal(await app.sync(),true);
  assert.equal(app.calls.some(call=>call.action==='employeePushRegister'),true);
});
test('revoked device permission unregisters the current installation and both-off preferences never request a token',async()=>{
  const app=actualSync();await app.sync();app.setPermission({granted:false,canAskAgain:false,ios:{status:1}});await app.sync(false,true);
  assert.equal(app.calls.at(-1).action,'employeePushUnregister');assert.equal(app.context.lastRegistration.current,null);
  const disabled=actualSync({requestRef:{current:async payload=>{if(payload.action==='employeePreferences')return{notifications:false,chatNotifications:false};return{registered:false};}}});
  assert.equal(await disabled.sync(),false);assert.equal(disabled.nativeCalls.length,0);assert.equal(disabled.states.at(-1).status,'disabled');
});
test('either reminder category keeps a reminder-only account registered independently of chat and schedule-change switches',async()=>{
  for(const category of ['shiftReminders','checkoutReminders']){
    const calls=[];
    const app=actualSync({requestRef:{current:async payload=>{calls.push(plain(payload));return payload.action==='employeePreferences'
      ?{notifications:false,chatNotifications:false,shiftReminders:false,checkoutReminders:false,reminderLeadMinutes:30,[category]:true}
      :{registered:payload.action==='employeePushRegister'};}}});
    assert.equal(await app.sync(),true);
    assert.equal(app.context.enabled.current,true);
    assert.equal(calls.some(value=>value.action==='employeePushRegister'),true);
    assert.equal(calls.some(value=>value.action==='employeePushUnregister'),false);
  }
});
test('malformed reminder preference replies fail closed rather than silently enabling token registration',async()=>{
  for(const patch of [{shiftReminders:'true'},{checkoutReminders:1},{reminderLeadMinutes:20},{shiftReminders:null}]){
    const app=actualSync({requestRef:{current:async()=>({notifications:false,chatNotifications:false,...patch})}});
    assert.equal(await app.sync(),false);
    assert.equal(app.nativeCalls.length,0);
    assert.equal(app.states.at(-1).status,'error');
  }
});
test('account-close during native token retrieval never registers a token on the replacement account',async()=>{
  const app=actualSync();let release;app.module.getExpoPushTokenAsync=()=>new Promise(resolve=>{release=resolve;});
  const task=app.sync();await tick();app.context.closedScope.current='account-a';app.context.generation.current++;
  release({data:'ExpoPushToken[synthetic-token-12345]'});assert.equal(await task,false);
  assert.equal(app.calls.some(call=>call.action==='employeePushRegister'),false);assert.equal(app.states.length,0);
});
test('token rotation reuses the native token and coalesces concurrent forced refresh instead of recursing',async()=>{
  const app=actualSync();let release;const original=app.module.getExpoPushTokenAsync;
  app.module.getExpoPushTokenAsync=async options=>{app.module.getExpoPushTokenAsync=original;await new Promise(resolve=>{release=resolve;});return{data:'ExpoPushToken[synthetic-original-token]'};};
  const first=app.sync();await tick();app.context.deviceToken.current={type:'ios',data:'native-rotated'};
  const second=app.sync(false,true);release();await Promise.all([first,second]);await tick();await tick();
  assert.equal(app.calls.filter(call=>call.action==='employeePushRegister').length,2);
  assert.equal(app.nativeCalls.at(-1).tokenOptions.devicePushToken.data,'native-rotated');
});
test('logout teardown cancels local listeners synchronously and does not recursively unregister an expired session',async()=>{
  const events=load('src/notifications/push-account-events.ts',{setTimeout,clearTimeout,Promise});let closed=false,remote;
  const remove=events.onPushAccountClosing(async value=>{closed=true;remote=value;});
  const ending=events.closePushAccount(false);assert.equal(closed,true);await ending;assert.equal(remote,false);remove();
});


test('registration network failures expose a retryable status and schedule backoff without replaying the call immediately',async()=>{
  const app=actualSync({requestRef:{current:async()=>{throw Error('offline');}}});
  assert.equal(await app.sync(),false);assert.equal(app.states.at(-1).status,'error');assert.equal(app.retries.length,1);
  assert.equal(app.retries[0][0],'account-a');assert.equal(app.retries[0][1],0);
});

function actualTest(app){
  const filename='src/notifications/push-notifications.tsx',source=fs.readFileSync(path.join(root,filename),'utf8');
  const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);let callback;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='sendTest')callback=node.initializer.arguments[0];ts.forEachChild(node,visit);}visit(tree);assert.ok(callback);
  vm.runInContext(ts.transpileModule('globalThis.sendTest='+callback.getText(tree)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,app.context);
  return()=>app.context.sendTest();
}
test('self-test uses only the current acknowledged installation, never a recipient or message supplied by UI',async()=>{
  const app=actualSync();await app.sync();const calls=[];
  app.context.requestRef.current=async payload=>{calls.push(plain(payload));return{queued:true};};
  await actualTest(app)();
  assert.deepEqual(calls,[{action:'employeePushTest',installationId}]);
  app.context.lastRegistration.current=null;
  await assert.rejects(actualTest(app)(),/Tillad/);assert.equal(calls.length,1);
});
test('self-test does not claim completion for an unconfirmed receipt or after changing account',async()=>{
  const app=actualSync();await app.sync();
  app.context.requestRef.current=async()=>({queued:false});
  await assert.rejects(actualTest(app)(),/bekræftes/);
  app.context.requestRef.current=async()=>{app.context.scopeRef.current='account-b';return{queued:true};};
  await assert.rejects(actualTest(app)(),/Kontoen er ændret/);
});
