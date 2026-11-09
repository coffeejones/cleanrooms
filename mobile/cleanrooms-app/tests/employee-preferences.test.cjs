const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const app=path.resolve(__dirname,'..'),output=process.env.CLEANROOMS_TEST_BUILD;
const wire=require(path.join(output,'state/employee-preferences-wire.js'));
const plain=value=>JSON.parse(JSON.stringify(value));
const legacy={version:0,notifications:true,chatNotifications:false,unavailableDates:[]};
const preferences=patch=>({...legacy,shiftReminders:false,checkoutReminders:false,reminderLeadMinutes:30,...patch});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}

test('legacy employee settings remain opt-out for both reminder categories',()=>{
  assert.deepEqual(plain(wire.parseEmployeePreferences(legacy)),preferences());
  assert.equal(wire.pushPreferencesEnabled({...legacy,notifications:false}),false);
  for(const key of ['notifications','chatNotifications','shiftReminders','checkoutReminders'])
    assert.equal(wire.pushPreferencesEnabled(preferences({notifications:false,[key]:true})),true);
});

test('preferences reject malformed categories, lead times and availability rather than silently substituting opt-ins',()=>{
  for(const patch of [{shiftReminders:'true'},{shiftReminders:null},{checkoutReminders:1},{reminderLeadMinutes:'30'},
    {reminderLeadMinutes:null},{reminderLeadMinutes:0},{reminderLeadMinutes:20},{reminderLeadMinutes:1440},
    {version:-1},{version:NaN},{unavailableDates:['2026-02-30']},{unavailableDates:Array(731).fill('2026-11-10')}])
    assert.throws(()=>wire.parseEmployeePreferences(preferences(patch)),/bekræftes/);
  for(const lead of [15,30,60])assert.equal(wire.parseEmployeePreferences(preferences({reminderLeadMinutes:lead})).reminderLeadMinutes,lead);
  const source=preferences({unavailableDates:['2026-11-10']});const parsed=wire.parseEmployeePreferences(source);
  source.unavailableDates.push('2026-11-11');assert.deepEqual(parsed.unavailableDates,['2026-11-10']);
});

test('a setting write requires the exact acknowledged value and next CAS version',()=>{
  for(const key of ['shiftReminders','checkoutReminders']){
    assert.equal(wire.confirmsEmployeePreference(preferences({version:1,[key]:true}),key,true,0)[key],true);
    for(const reply of [preferences({version:1}),preferences({version:0,[key]:true}),preferences({version:2,[key]:true}),{...legacy,version:1}])
      assert.throws(()=>wire.confirmsEmployeePreference(reply,key,true,0),/bekræftes/);
  }
  assert.equal(wire.confirmsEmployeePreference(preferences({version:8,reminderLeadMinutes:60}),'reminderLeadMinutes',60,7).reminderLeadMinutes,60);
});

function actualHandler(name,globals){
  const filename=path.join(app,'src/screens/account-screen.tsx'),source=fs.readFileSync(filename,'utf8');
  const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);let container,chosen;
  for(const node of tree.statements)if(ts.isFunctionDeclaration(node)&&node.name?.text==='NotificationPreferences')container=node;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)chosen=node;ts.forEachChild(node,visit);}
  assert.ok(container);visit(container);assert.ok(chosen);
  const context=vm.createContext({Error,...globals});
  vm.runInContext(ts.transpileModule('globalThis.subject='+chosen.getText(tree)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  return context.subject;
}
function fixture(patch={}){
  const commands=[],saved=[],errors=[],saving=[],testing=[],receipts=[],invalidations=[];
  const generation={current:1},mounted={current:true},busy={current:false};
  let enable=async()=>true,request=async payload=>preferences({version:payload.version+1,[payload.key]:payload.value}),testPush=async()=>{};
  let pushRefresh=0,resourceRefresh=0,permissions=0;
  const globals={value:preferences(patch),scope:'company:person:session1',generation,mounted,busy,disabled:false,
    confirmsEmployeePreference:wire.confirmsEmployeePreference,
    push:{enable:async()=>{permissions++;return enable();},refresh:()=>pushRefresh++,sendTest:()=>testPush()},
    employeeRequest:async payload=>{commands.push(plain(payload));return request(payload);},
    resource:{refresh:()=>resourceRefresh++},invalidateEmployeeResources:key=>invalidations.push(key),
    setSaved:value=>saved.push(plain(value)),setError:value=>errors.push(value),setSaving:value=>saving.push(value),
    setTesting:value=>testing.push(value),setTestReceipt:value=>receipts.push(value),
  };
  return{change:actualHandler('change',globals),testPush:actualHandler('testPush',globals),generation,mounted,busy,commands,saved,errors,saving,testing,receipts,invalidations,
    enable:value=>{enable=value;},request:value=>{request=value;},pushTest:value=>{testPush=value;},counts:()=>({pushRefresh,resourceRefresh,permissions})};
}

test('reminder opt-in prompts only the current phone and changes visible settings only after a valid server ACK',async()=>{
  const h=fixture();await h.change('shiftReminders',true);
  assert.deepEqual(h.commands,[{action:'employeePreference',key:'shiftReminders',value:true,version:0}]);
  assert.equal(h.saved[0].value.shiftReminders,true);assert.deepEqual(h.saving,[true,false]);
  assert.deepEqual(h.counts(),{permissions:1,pushRefresh:1,resourceRefresh:0});assert.deepEqual(h.invalidations,['preferences']);
});

test('changing lead time does not re-prompt OS permission; denied permission never pretends a reminder was enabled',async()=>{
  const h=fixture({shiftReminders:true});await h.change('reminderLeadMinutes',60);
  assert.equal(h.counts().permissions,0);assert.equal(h.saved[0].value.reminderLeadMinutes,60);
  const denied=fixture();denied.enable(async()=>false);await denied.change('checkoutReminders',true);
  assert.deepEqual(denied.saved,[]);assert.deepEqual(denied.commands,[]);assert.equal(denied.busy.current,false);
});

test('offline or malformed setting replies keep the acknowledged old value and offer a refreshed retry',async()=>{
  for(const fail of ['offline','wrong-value','wrong-version']){
    const h=fixture();h.request(async()=>{if(fail==='offline')throw Error('Forbindelsen mangler.');return preferences({version:fail==='wrong-version'?0:1,shiftReminders:fail==='wrong-version'});});
    await h.change('shiftReminders',true);assert.deepEqual(h.saved,[]);assert.equal(h.counts().pushRefresh,0);
    assert.equal(h.counts().resourceRefresh,1);assert.ok(h.errors.at(-1));assert.equal(h.busy.current,false);
  }
});

test('a permission prompt that resolves after changing account cannot write preferences on the replacement session',async()=>{
  const h=fixture(),waiting=deferred();h.enable(()=>waiting.promise);
  const change=h.change('shiftReminders',true);h.generation.current++;h.busy.current=true;
  waiting.resolve(true);await change;
  assert.deepEqual(h.commands,[]);assert.deepEqual(h.saved,[]);assert.equal(h.busy.current,true);assert.deepEqual(h.saving,[true]);
});

test('a late old-session settings success or failure cannot update feedback or unlock a new pending action',async()=>{
  for(const fail of [false,true]){
    const h=fixture(),waiting=deferred();h.request(()=>waiting.promise);
    const change=h.change('reminderLeadMinutes',60);h.generation.current++;h.busy.current=true;
    if(fail)waiting.reject(Error('Old private error'));else waiting.resolve(preferences({version:1,reminderLeadMinutes:60}));
    await change;assert.deepEqual(h.saved,[]);assert.deepEqual(h.errors,['']);assert.deepEqual(h.saving,[true]);
    assert.equal(h.busy.current,true);assert.deepEqual(h.invalidations,[]);
  }
});

test('pending preference writes are serialized and unchanged values do not issue another command',async()=>{
  const h=fixture(),waiting=deferred();h.request(()=>waiting.promise);
  await h.change('shiftReminders',false);assert.deepEqual(h.commands,[]);
  const first=h.change('reminderLeadMinutes',60);await h.change('checkoutReminders',true);assert.equal(h.commands.length,1);
  waiting.resolve(preferences({version:1,reminderLeadMinutes:60}));await first;assert.equal(h.saved.length,1);
});

test('a stale push self-test receipt cannot appear on a replacement account',async()=>{
  const h=fixture(),waiting=deferred();h.pushTest(()=>waiting.promise);
  const sending=h.testPush();h.generation.current++;h.busy.current=true;waiting.resolve();await sending;
  assert.deepEqual(h.receipts,[undefined]);assert.deepEqual(h.testing,[true]);assert.equal(h.busy.current,true);
});
