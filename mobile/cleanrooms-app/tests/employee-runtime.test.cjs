const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.CLEANROOMS_TEST_BUILD;
const {elapsedSeconds,confirmsTimeCommand}=require(path.join(root,'state/attendance-runtime.js'));
const {RetryGate,retryAfterMilliseconds}=require(path.join(root,'state/retry-policy.js'));
const {sanitizeNativePath}=require(path.join(root,'state/native-path.js'));
const {PendingLogouts}=require(path.join(root,'auth/pending-logouts.js'));
const entry={version:3,status:'running',clockIn:'2026-11-09T06:00:00Z',clockOut:null,pauseAt:null,workedSeconds:3600,measuredAt:100,receivedAtMonotonic:5000};
test('elapsed attendance follows server duration and monotonic arrival, independent of wall-clock skew',()=>{
  assert.equal(elapsedSeconds(entry,15_000),3610);
  assert.equal(elapsedSeconds({...entry,measuredAt:9_000_000_000_000},15_000),3610);
  assert.equal(elapsedSeconds({...entry,status:'paused'},15_000),3600);
  assert.equal(elapsedSeconds(entry,1000),3600);
  assert.equal(elapsedSeconds({...entry,receivedAtMonotonic:undefined},15_000),null);
});
test('a reconciliation needs a newer server version and the concrete requested transition',()=>{
  assert.equal(confirmsTimeCommand('start',0,entry),true);
  assert.equal(confirmsTimeCommand('start',3,entry),false);
  assert.equal(confirmsTimeCommand('finish',2,entry),false);
  const closed={...entry,status:'submitted',clockOut:'2026-11-09T14:00:00Z'};
  assert.equal(confirmsTimeCommand('finish',2,closed),true);
  assert.equal(confirmsTimeCommand('submit',2,closed),true);
  assert.equal(confirmsTimeCommand('submit',2,{...closed,status:'rejected'}),false);
  assert.equal(confirmsTimeCommand('submit',2,{...entry,status:'rejected',comment:'Forklaring'},'Forklaring',''),true);
  assert.equal(confirmsTimeCommand('submit',2,{...entry,status:'rejected',comment:'Anden tekst'},'Forklaring',''),false);
  assert.equal(confirmsTimeCommand('pause',2,{...entry,status:'paused',pauseAt:'2026-11-09T12:00:00Z'}),true);
  assert.equal(confirmsTimeCommand('pause',2,entry),false);
});
test('external native paths are bounded and percent-valid while retired GPS callbacks stay disabled',()=>{
  for(const path of [null,{},'x'.repeat(8193),'cleanrooms://gps-return','cleanrooms://gps-return?token=synthetic','cleanrooms://shift/%E0%A4%A','cleanrooms://shift/%ZZ','/chat/abc\n'])assert.equal(sanitizeNativePath(path),null);
  assert.equal(sanitizeNativePath('cleanrooms://shift/shift-one?note=%C3%A6'),'cleanrooms://shift/shift-one?note=%C3%A6');
  assert.equal(sanitizeNativePath('/shift/abc'),'/shift/abc');
});
test('retry-after supports delay seconds and HTTP dates, bounds the wait and ignores invalid values',()=>{
  assert.equal(retryAfterMilliseconds('30',0),30_000);
  assert.equal(retryAfterMilliseconds('999999',0),300_000);
  assert.equal(retryAfterMilliseconds('Mon, 09 Nov 2026 12:01:00 GMT',Date.parse('2026-11-09T12:00:00Z')),60_000);
  for(const value of [null,'invalid','-10'])assert.equal(retryAfterMilliseconds(value,Date.parse('2026-11-09T12:00:00Z')),undefined);
});
test('chat retries back off with jitter and a stale success cannot erase newer throttling',()=>{
  const gate=new RetryGate(3000,60_000),version=gate.version;
  assert.equal(gate.fail(1000,30_000,()=>0),30_000);
  assert.equal(gate.ready(30_999),false);assert.equal(gate.ready(31_000),true);
  gate.success(version);assert.equal(gate.ready(2000),false);
  gate.success(gate.version);assert.equal(gate.ready(2000),true);
  assert.equal(gate.fail(0,undefined,()=>0),2400);
  assert.equal(gate.fail(0,undefined,()=>1),7200);
  for(let i=0;i<10;i++)assert.ok(gate.fail(0,undefined,()=>1)<=60_000);
});
test('pending logout survives app recreation/offline failure and clears only after the matching server ACK',async()=>{
  let raw=null;
  const storage={read:async()=>raw,write:async value=>{raw=value;},clear:async()=>{raw=null;}};
  const origin='https://own.example.test',foreign='https://other.example.test';
  const token='synthetic-session-token-which-is-never-used-on-a-network';
  const queue=new PendingLogouts(storage);
  await queue.enqueue(origin,token);await queue.enqueue(origin,token);await queue.enqueue(foreign,token+'-other');
  await assert.rejects(queue.flush(origin,async()=>{throw new Error('offline');}),/offline/);
  assert.equal(await queue.hasPending(origin),true);
  const restored=new PendingLogouts(storage),revoked=[];
  assert.equal(await restored.contains(origin,token),true);
  assert.equal(await restored.contains(foreign,token),false);
  assert.equal(await restored.contains(origin,'synthetic-unrelated-current-account'.padEnd(43,'x')),false);
  await restored.flush(origin,async value=>{revoked.push(value);});
  assert.deepEqual(revoked,[token]);assert.equal(await restored.hasPending(origin),false);assert.equal(await restored.hasPending(foreign),true);
  await restored.flush(foreign,async()=>{});assert.equal(raw,null);
});
test('concurrent enqueues/ACKs do not lose logout jobs and a storage failure cannot pretend the job was saved',async()=>{
  let raw=null;
  const storage={read:async()=>raw,write:async value=>{raw=value;},clear:async()=>{raw=null;}};
  const queue=new PendingLogouts(storage),origin='https://own.example.test';
  await Promise.all(['first','second'].map(value=>queue.enqueue(origin,('synthetic-'+value).padEnd(32,'x'))));
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const revoked=[];const flush=queue.flush(origin,async token=>{await waiting;revoked.push(token);});
  await queue.enqueue(origin,'synthetic-third'.padEnd(32,'x'));release();await flush;
  assert.equal(revoked.length,3);assert.equal(revoked.includes('synthetic-third'.padEnd(32,'x')),true);
  assert.equal(raw,null);assert.equal(await queue.hasPending(origin),false);
  await queue.enqueue(origin,'synthetic-fourth'.padEnd(32,'x'));
  const broken=new PendingLogouts({...storage,write:async()=>{throw new Error('storage unavailable');}});
  await assert.rejects(broken.enqueue(origin,'synthetic-failed'.padEnd(32,'x')),/storage unavailable/);
  assert.equal(JSON.parse(raw).length,1);
});
test('pending logout expiry prunes old credentials without contacting another API or retaining an unbounded queue',async()=>{
  let raw=null,now=0;
  const storage={read:async()=>raw,write:async value=>{raw=value;},clear:async()=>{raw=null;}};
  const queue=new PendingLogouts(storage,()=>now),origin='https://own.example.test';
  for(let i=0;i<16;i++)await queue.enqueue(origin,('synthetic-session-'+i).padEnd(32,'x'),1000);
  await assert.rejects(queue.enqueue(origin,'synthetic-seventeenth'.padEnd(32,'x'),1000),/full/);
  assert.equal(JSON.parse(raw).length,16);
  now=1001;let calls=0;await queue.flush(origin,async()=>{calls++;});
  assert.equal(calls,0);assert.equal(raw,null);assert.equal(await queue.hasPending(origin),false);
});
test('logout jobs support the configured local development origin without accepting arbitrary insecure origins',async()=>{
  let raw=null;const storage={read:async()=>raw,write:async value=>{raw=value;},clear:async()=>{raw=null;}};
  const queue=new PendingLogouts(storage),token='synthetic-local-session'.padEnd(43,'x');
  await queue.enqueue('http://127.0.0.1:8080',token);
  assert.equal(await queue.contains('http://127.0.0.1:8080',token),true);
  await assert.rejects(queue.enqueue('http://public.example.test',token),/Invalid pending logout/);
  await assert.rejects(queue.enqueue('https://user:pass@example.test',token),/Invalid pending logout/);
  const sent=[];await queue.flush('http://127.0.0.1:8080',async value=>{sent.push(value);});
  assert.deepEqual(sent,[token]);assert.equal(raw,null);
});

const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const mobileRoot = path.resolve(__dirname, '..');
function employeeData(request) {
  const filename = path.join(mobileRoot, 'src/state/employee-data.ts'), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if(name === 'react') return { useCallback: callback => callback };
    if(name === '@/auth/mobile-auth') return { useMobileAuth: () => ({ employeeRequest: request, state: { mode: 'signedIn', session: { employee: { personId: 'self' } } } }) };
    if(name === '@/domain/model') return require(path.join(root, 'domain/model.js'));
    if(name === './published-schedule') return { usePublishedResource: (scope, read, enabled) => ({ scope, read, enabled, refresh() {} }) };
    if(name === './company-settings-wire') return require(path.join(root, 'state/company-settings-wire.js'));
    if(name === './employee-preferences-wire') return require(path.join(root, 'state/employee-preferences-wire.js'));
    throw Error('Unexpected dependency ' + name);
  }});
  return module.exports;
}
const leaveRequest = (patch = {}) => ({ id: 'leave-1', p: 'self', version: 1, days: ['2026-11-10'], type: 'Friønske', status: 'pending', comment: 'Familieaftale', createdAt: '2026-11-09T08:00:00Z', ...patch });
test('reopening a shift reads its persisted leave status and rejection reason for only that employee and date', async () => {
  const calls = []; let current = leaveRequest();
  const api = employeeData(async payload => { calls.push(payload); return { requests: [current], nextCursor: null }; });
  const first = api.useShiftLeaves('2026-11-10');
  assert.equal(first.enabled, true); assert.equal(api.currentShiftLeave(await first.read(), '2026-11-10').status, 'pending');
  current = leaveRequest({ version: 2, status: 'rejected', decision: { reason: 'Vi mangler bemanding den dag.' } });
  const reopened = api.useShiftLeaves('2026-11-10'), latest = api.currentShiftLeave(await reopened.read(), '2026-11-10');
  assert.equal(latest.version, 2); assert.equal(latest.status, 'rejected'); assert.equal(latest.decision.reason, 'Vi mangler bemanding den dag.');
  assert.ok(calls.every(call => call.action === 'leaveRead' && call.from === '2026-11-10' && call.to === '2026-11-10' && call.limit === 50));
  assert.throws(() => api.parseShiftLeave(leaveRequest({ p: 'other' }), 'self'), /Friønsket/);
});
test('leave history follows bounded pages and refuses incomplete or repeated cursor state', async () => {
  const api = employeeData(async () => ({})), calls = [];
  const requests = await api.readShiftLeaveRequests(async payload => {
    calls.push(payload); return payload.cursor ? { requests: [leaveRequest({ id: 'latest', status: 'approved', createdAt: '2026-11-09T12:00:00Z' })], nextCursor: null }
      : { requests: [leaveRequest({ status: 'rejected', decision: { reason: 'Tidligere svar' } })], nextCursor: 'next' };
  }, '2026-11-10', 'self');
  assert.equal(calls.length, 2); assert.equal(api.currentShiftLeave(requests, '2026-11-10').status, 'approved');
  await assert.rejects(api.readShiftLeaveRequests(async () => ({ requests: [], nextCursor: 'same' }), '2026-11-10', 'self'), /ændret/);
  let page = 0; await assert.rejects(api.readShiftLeaveRequests(async () => ({ requests: [], nextCursor: 'page-' + ++page }), '2026-11-10', 'self'), /mange friønsker/); assert.equal(page, 10);
});
function shiftScreenFunction(select, globals) {
  const filename = path.join(mobileRoot, 'src/screens/published-shift-screen.tsx'), source = fs.readFileSync(filename, 'utf8'), tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let chosen; function visit(node) { if(!chosen && select(node)) chosen = node; ts.forEachChild(node, visit); } visit(tree); assert.ok(chosen, 'Actual shift handler must be found');
  const moduleSource = 'globalThis.subject = ' + chosen.getText(tree) + ';';
  const context = vm.createContext({ ...globals }); vm.runInContext(ts.transpileModule(moduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context); return context.subject;
}
test('an acknowledged clock action refreshes its detail and invalidates hours exactly once', async () => {
  const calls = [], counts = { hours: 0 }, saved = [];
  class AuthError extends Error {}
  const register = shiftScreenFunction(node => ts.isFunctionDeclaration(node) && node.name?.text === 'register', {
    detail: { shift: { id: 'shift' } }, id: 'shift', entry: { version: 1 }, pending: { current: false }, uncertain: { current: null },
    setBusy() {}, setActionError() {}, setSaved: value => saved.push(value), MobileAuthError: AuthError,
    writeShiftTime: async payload => { calls.push(payload); return { version: 2, status: 'submitted' }; },
    resource: { refresh: () => calls.push('detail') }, hours: { refresh: () => { counts.hours++; } },
    invalidateEmployeeResources: (...prefixes) => { calls.push(prefixes); if(prefixes.includes('hours:')) counts.hours++; },
  });
  assert.equal((await register('finish', 'Mødte til tiden')).ok, true); assert.equal(counts.hours, 1); assert.equal(saved[0].entry.version, 2); assert.equal(calls[0].operation, 'finish'); assert.equal(calls[0].comment, 'Mødte til tiden');
});
test('sending leave rechecks persisted status and never creates another pending request', async () => {
  const api = employeeData(async () => ({})); let created = 0, refreshed = 0;
  const confirm = shiftScreenFunction(node => ts.isArrowFunction(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    && node.parameters[0]?.name.getText() === 'comment' && node.getText().includes("action: 'shiftLeave'"), {
    detail: { shift: { date: '2026-11-10' } }, id: 'shift', auth: { mode: 'signedIn', session: { employee: { personId: 'self' } } },
    leaves: { read: async () => [api.parseShiftLeave(leaveRequest(), 'self')], refresh: () => { refreshed++; } },
    currentShiftLeave: api.currentShiftLeave, parseShiftLeave: api.parseShiftLeave, employeeRequest: async () => { created++; },
  });
  const result = await confirm('Familieaftale'); assert.equal(result.ok, false); assert.match(result.error, /allerede et friønske/); assert.equal(created, 0); assert.equal(refreshed, 1);
});

test('native Core Location fractional timestamps keep their measured freshness and reach the integer API contract',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
  const filename=require.resolve('../src/location/clock-in-location.ts');
  const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:filename}).outputText;
  async function read(timestamp,{abort=false}={}){
    const module={exports:{}},controller=new AbortController();let removed=0;
    vm.runInNewContext(source,{module,exports:module.exports,AbortController,setTimeout,clearTimeout,process:{env:{EXPO_OS:'ios'}},require(name){
      if(name==='@/domain/model')return require(path.join(root,'domain/model.js'));
      if(name==='react-native')return{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}};
      if(name==='expo-location')return{Accuracy:{High:4},hasServicesEnabledAsync:async()=>true,getForegroundPermissionsAsync:async()=>({granted:true}),watchPositionAsync:async(_options,onPosition)=>{
        onPosition({coords:{latitude:55.6761,longitude:12.5683,accuracy:5},timestamp,mocked:false});
        if(abort)queueMicrotask(()=>controller.abort());
        return{remove(){removed++;}};
      }};
      throw Error('Unexpected location dependency: '+name);
    }},{filename});
    const result=await module.exports.readClockInLocation(controller.signal,200);
    await Promise.resolve();return{result,removed};
  }
  const original=Date.now()-1234+0.375;
  const valid=await read(original);
  assert.equal(valid.result.location.timestamp,Math.trunc(original));
  assert.equal(Number.isSafeInteger(valid.result.location.timestamp),true);
  assert.equal(valid.removed,1,'GPS watcher must close after its usable fix');
  const stale=await read(Date.now()-120_000+0.375,{abort:true});
  assert.match(stale.result.error,/afbrudt/);
  assert.equal(stale.result.location,undefined,'normalisation cannot make a stale native fix fresh');
});

test('an explicitly rejected leave request can be sent again and keeps only the acknowledged server receipt', async () => {
  const api = employeeData(async () => ({})), sent = [], receipts = [], invalidated = [];
  const older = api.parseShiftLeave(leaveRequest({ status: 'rejected', decision: { reason: 'Tidligere afvist' } }), 'self'), source = [older];
  const confirm = shiftScreenFunction(node => ts.isArrowFunction(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    && node.parameters[0]?.name.getText() === 'comment' && node.getText().includes("action: 'shiftLeave'"), {
    detail: { shift: { date: '2026-11-10' } }, id: 'shift', auth: { mode: 'signedIn', session: { employee: { personId: 'self' } } },
    leaves: { data: source, read: async () => source, refresh() {} }, currentShiftLeave: api.currentShiftLeave, parseShiftLeave: api.parseShiftLeave,
    employeeRequest: async payload => { sent.push(payload); return { request: leaveRequest({ id: 'new-request' }) }; },
    setLeaveReceipt: value => receipts.push(value), invalidateEmployeeResources: (...prefixes) => invalidated.push(prefixes),
  });
  assert.equal((await confirm('Ny aftale')).ok, true);assert.equal(sent.length, 1);assert.equal(sent[0].shiftId, 'shift');assert.equal(sent[0].comment, 'Ny aftale');assert.equal(receipts[0].request.id, 'new-request');assert.equal(receipts[0].source, source);assert.equal(invalidated[0][0], 'leave:');
});
