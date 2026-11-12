const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), crypto = require('node:crypto');
const compiled = process.env.CLEANROOMS_TEST_BUILD;
const mobile = path.resolve(__dirname, '..');
const { PrivateDraftStore } = require(path.join(compiled, 'state/private-draft-store.js'));
const wire = require(path.join(compiled, 'state/chat-wire.js'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const uuid = () => crypto.randomUUID();
const scope = value => crypto.createHash('sha256').update(value).digest('hex');
const expiresAt = Date.parse('2026-12-09T12:00:00Z');
function storage() {
  const values = new Map();
  return { values, read: async key => values.get(key) ?? null, write: async (key, value) => {
    assert.ok(Buffer.byteLength(value) <= 1800, 'every OS-encrypted item must remain below historical native size limits');
    values.set(key, value);
  }, remove: async key => { values.delete(key); } };
}

test('long Unicode drafts and their exact pending command survive process recreation in bounded encrypted chunks', async () => {
  const native = storage(), key = scope('origin/workspace/person/session/room');
  const text = 'Æøå 👩🏽‍💻 '.repeat(800).slice(0, 10_000), command = { clientId: uuid(), text };
  const first = new PrivateDraftStore(native, uuid);
  await first.save(key, { text, pending: command }, expiresAt, first.lease());
  const index = native.values.get('cleanrooms.private-drafts.v1');
  assert.doesNotMatch(index, /Æøå|person|workspace|room|clientId|text/);
  assert.ok(native.values.size > 10);
  const reopened = new PrivateDraftStore(native, uuid);
  assert.deepEqual(await reopened.read(key, reopened.lease()), { text, pending: command });
  assert.equal(await reopened.read(scope('other-person/room'), reopened.lease()), null);
  assert.equal(await reopened.read(scope('other-origin/person/room'), reopened.lease()), null);
});

test('chat previews expose only matching drafts, and disappear when the draft is cleared', async () => {
  const native = storage();
  const repository = new PrivateDraftStore(native, uuid);
  const lease = repository.lease();
  const room = scope('origin/employee-a/session/chat/room-one');
  const otherEmployee = scope('origin/employee-b/session/chat/room-one');
  const checkout = scope('origin/employee-a/session/clock-out/room-one');
  await repository.save(room, { text: '  Spørg Mette\n  om nøglen  ', pending: null }, expiresAt, lease);
  await repository.save(otherEmployee, { text: 'En anden medarbejders kladde', pending: null }, expiresAt, lease);
  await repository.save(checkout, { text: 'En kommentar til en vagt', pending: null }, expiresAt, lease);
  assert.deepEqual(await repository.readPreviews([room], lease), new Map([[room, 'Spørg Mette om nøglen']]));
  await repository.save(room, { text: '', pending: null }, expiresAt, lease);
  assert.equal((await repository.readPreviews([room], lease)).size, 0);
  await repository.clear();
  await assert.rejects(repository.readPreviews([room], lease), /account changed/);
});

test('checkout explanation storage preserves the existing 100,000-character server limit while chat commands retain their own limit', async () => {
  const native = storage(), repository = new PrivateDraftStore(native, uuid), key = scope('account/clock-out/long-shift');
  const text = '💬'.repeat(50_000);
  await repository.save(key, { text, pending: null }, expiresAt, repository.lease());
  assert.equal((await repository.read(key, repository.lease())).text, text);
  assert.throws(() => repository.save(scope('account/chat/room'), { text, pending: { text, clientId: uuid() } }, expiresAt, repository.lease()), /Invalid chat command/);
});

test('a partial Keychain write preserves the previously committed draft and command', async () => {
  const native = storage(), repository = new PrivateDraftStore(native, uuid), key = scope('room');
  const previous = { text: 'Første udkast', pending: { text: 'Første udkast', clientId: uuid() } };
  await repository.save(key, previous, expiresAt, repository.lease());
  let writes = 0;
  const failing = new PrivateDraftStore({ ...native, write: async (key, value) => {
    if (++writes === 3) throw Error('native storage full');
    await native.write(key, value);
  } }, uuid);
  await assert.rejects(failing.save(key, { text: 'Ny tekst '.repeat(1000), pending: null }, expiresAt, failing.lease()), /native storage full/);
  assert.deepEqual(await repository.read(key, repository.lease()), previous);
  assert.equal(native.values.size, 2, 'uncommitted chunks must not remain after a failed write');
});

test('logout invalidates an in-flight save synchronously and an old caller cannot resurrect account data', async () => {
  const native = storage(), key = scope('old-account-room');
  let entered, release;
  const enteredPromise = new Promise(resolve => { entered = resolve; }), block = new Promise(resolve => { release = resolve; });
  let paused = false;
  const repository = new PrivateDraftStore({ ...native, write: async (key, value) => {
    if (!paused) { paused = true; entered(); await block; }
    await native.write(key, value);
  } }, uuid);
  const lease = repository.lease();
  const saving = repository.save(key, { text: 'Privat udkast', pending: { clientId: uuid(), text: 'Privat udkast' } }, expiresAt, lease);
  await enteredPromise;
  const clearing = repository.clear();
  assert.notEqual(repository.lease(), lease, 'revocation cannot wait for Keychain I/O');
  release();
  await assert.rejects(saving, /account changed/);
  await clearing;
  await assert.rejects(repository.save(key, { text: 'Forsinket gammel konto', pending: null }, expiresAt, lease), /account changed/);
  assert.equal(await repository.read(key, repository.lease()), null);
  assert.equal(native.values.size, 1);
});

test('concurrent conversation writes retain both drafts and a full bounded store never silently evicts another message', async () => {
  const native = storage(), repository = new PrivateDraftStore(native, uuid);
  await Promise.all(Array.from({ length: 8 }, (_, i) => repository.save(scope('room-' + i), { text: 'Udkast ' + i, pending: null }, expiresAt, repository.lease())));
  await assert.rejects(repository.save(scope('room-9'), { text: 'Niende', pending: null }, expiresAt, repository.lease()), /Too many/);
  assert.equal((await repository.read(scope('room-0'), repository.lease())).text, 'Udkast 0');
  await repository.save(scope('room-0'), { text: '', pending: null }, expiresAt, repository.lease());
  await repository.save(scope('room-9'), { text: 'Niende', pending: null }, expiresAt, repository.lease());
  assert.equal((await repository.read(scope('room-9'), repository.lease())).text, 'Niende');
});

function hooks() {
  let index = 0, slots = [], effects = [], cleanups = new Map();
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    useRef(value) { const n = index++; return slots[n] ??= { current: value }; },
    useState(value) { const n = index++; if (!(n in slots)) slots[n] = typeof value === 'function' ? value() : value;
      return [slots[n], next => { slots[n] = typeof next === 'function' ? next(slots[n]) : next; }]; },
    useCallback(callback, deps) { const n = index++; if (changed(slots[n]?.deps, deps)) slots[n] = { deps, callback }; return slots[n].callback; },
    useLayoutEffect(callback, deps) { const n = index++; if (changed(slots[n], deps)) { slots[n] = deps; effects.push(() => { cleanups.get(n)?.(); cleanups.set(n, callback()); }); } },
  };
  return { react, render(fn) { index = 0; const value = fn(); const queue = effects; effects = []; queue.forEach(effect => effect()); return value; },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); cleanups.clear(); } };
}
function loadDrafts(native) {
  const harness = hooks(), module = { exports: {} }, filename = path.join(mobile, 'src/state/private-drafts.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Promise, TextEncoder, setTimeout, clearTimeout, queueMicrotask, require(name) {
    if (name === 'react') return harness.react;
    if (name === './private-draft-store') return { PrivateDraftStore };
    if (name === 'expo-crypto') return { randomUUID: uuid, CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_, value) => scope(value) };
    if (name === 'expo-secure-store') return { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: native.read, setItemAsync: native.write, deleteItemAsync: native.remove };
    throw Error('Unexpected draft dependency: ' + name);
  } });
  return { ...module.exports, render(key = 'account-session-1', persisted = 'origin/account/expiry/room') {
    return harness.render(() => module.exports.useEmployeeDraft(key, persisted, expiresAt));
  }, unmount: harness.unmount };
}
function sendHandler(composer, provider) {
  const filename = path.join(mobile, 'src/state/live-chat.ts'), source = fs.readFileSync(filename, 'utf8'), tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true);
  let callback; function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'send') callback = node.initializer.arguments[0]; ts.forEachChild(node, visit); } visit(tree); assert.ok(callback, 'Actual chat send callback must be found');
  const viewer = { userId: 'employee-one', name: 'Medarbejder' }, room = { id: 'room', departmentId: 'department', departmentName: 'Afdeling', name: 'Team', version: 1, latestSeq: 0, unread: 0, muted: false, memberCount: 2, lastMessage: null };
  const errors = [], context = vm.createContext({ composer, key: 'account-session-1', roomId: 'room', epoch: { current: 1 }, retry: { current: { version: 0, ready: () => true, success() {} } }, monotonicNow: () => 100,
    sending: { current: false }, data: { current: { viewer, room, messages: [], pins: [], nextCursor: null } }, setResource() {},
    employeeRequest: provider, record: wire.record, readRoom: wire.readRoom, readMessage: wire.readMessage, readViewer: wire.readViewer, mergeLiveMessages: wire.mergeLiveMessages,
    invalid: wire.invalid, accept(value) { context.data.current = value; }, fail: error => errors.push(error), MobileAuthError: class extends Error {},
  });
  vm.runInContext(ts.transpileModule('globalThis.send=' + callback.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { context, errors, send: text => context.send(text), receipt: text => ({ viewer, room: { ...room, latestSeq: 1 }, message: { id: 'message-1', seq: 1, text, authorId: viewer.userId, authorName: viewer.name, pinned: false, createdAt: '2026-11-09T12:00:00Z' } }) };
}

test('actual send persists its command before HTTP; lost ACK plus reopened app retries once with the same identity and no automatic resend', async () => {
  const native = storage(), first = loadDrafts(native);
  first.render(); await tick(); let composer = first.render(); composer.setDraft('Nøglen ligger i skabet.'); await tick(); composer = first.render();
  const calls = [], accepted = new Set();
  let sending = sendHandler(composer, async command => { calls.push(plain(command)); accepted.add(command.clientId); throw Error('lost reply'); });
  assert.equal(await sending.send(composer.draft), false);
  assert.equal(calls.length, 1); first.unmount();
  const reopened = loadDrafts(native); reopened.render(); await tick(); composer = reopened.render();
  assert.equal(composer.draft, 'Nøglen ligger i skabet.'); assert.equal(calls.length, 1, 'restoration must never resend automatically');
  sending = sendHandler(composer, async command => { calls.push(plain(command)); accepted.add(command.clientId); return sending.receipt(command.text); });
  assert.equal(await sending.send(composer.draft), true);
  assert.equal(calls[0].clientId, calls[1].clientId); assert.equal(accepted.size, 1);
  reopened.unmount();
  const confirmed = loadDrafts(native); confirmed.render(); await tick();
  assert.equal(confirmed.render().draft, '', 'acknowledged message must not reappear as an unsent draft');
});

test('a native persistence failure leaves the visible draft and never starts an unprotected HTTP send', async () => {
  const native = storage(), first = loadDrafts({ ...native, write: async () => { throw Error('keychain full'); } });
  first.render(); await tick(); let composer = first.render(); composer.setDraft('Bevar denne tekst'); await tick(); composer = first.render();
  let calls = 0; const sending = sendHandler(composer, async () => { calls++; });
  assert.equal(await sending.send(composer.draft), false); assert.equal(calls, 0); assert.equal(first.render().draft, 'Bevar denne tekst');
  assert.match(first.render().draftError, /gemmes sikkert/);
});

test('retrying failed secure storage preserves a newer visible draft instead of restoring stale text over it', async () => {
  const native = storage(); let broken = false;
  const first = loadDrafts({ ...native, write: async (key, value) => { if (broken) throw Error('temporary Keychain failure'); await native.write(key, value); } });
  first.render(); await tick(); first.render().setDraft('Gammelt udkast'); await tick();
  broken = true; first.render().setDraft('Ny tekst som skal bevares'); await tick();
  assert.match(first.render().draftError, /gemmes sikkert/);
  broken = false; first.render().restore(); await tick(); assert.equal(first.render().draft, 'Ny tekst som skal bevares'); first.unmount();
  const reopened = loadDrafts(native); reopened.render(); await tick(); assert.equal(reopened.render().draft, 'Ny tekst som skal bevares');
});

test('a known send receipt stays acknowledged if clearing its old local record temporarily fails', async () => {
  const native = storage(); let broken = false;
  const first = loadDrafts({ ...native, write: async (key, value) => { if (broken) throw Error('temporary native error'); await native.write(key, value); } });
  first.render(); await tick(); let composer = first.render(); composer.setDraft('Gentaget tekst'); await tick(); composer = first.render();
  const original = await composer.prepare(composer.draft);
  broken = true; await assert.rejects(composer.acknowledge(original), /gemmes sikkert/); assert.equal(first.render().draft, '');
  broken = false; first.render().restore(); await tick(); assert.equal(first.render().draft, '');
  first.render().setDraft('Gentaget tekst'); await tick();
  const explicitNewMessage = await first.render().prepare('Gentaget tekst');
  assert.notEqual(explicitNewMessage.clientId, original.clientId, 'an intentional new message cannot be confused with a known earlier receipt');
});

test('real composer scope changes and synchronous account teardown fence a pending send before HTTP', async () => {
  const native = storage(); let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; }), block = new Promise(resolve => { release = resolve; }); let held = false;
  const first = loadDrafts({ ...native, write: async (key, value) => { if (!held) { held = true; entered(); await block; } await native.write(key, value); } });
  first.render(); await tick(); const composer = first.render(); let calls = 0;
  const sending = sendHandler(composer, async () => { calls++; });
  const pending = sending.send('Skal ikke sendes efter logout'); await enteredPromise;
  const closing = first.clearEmployeeDrafts(); sending.context.epoch.current++;
  first.render('new-account-session', 'origin/new-account/expiry/room'); release();
  assert.equal(await pending, false); await closing; await tick();
  assert.equal(calls, 0); assert.equal(first.render('new-account-session', 'origin/new-account/expiry/room').draft, '');
});

function authCallback(name, globals) {
  const filename = path.join(mobile, 'src/auth/mobile-auth.tsx'), source = fs.readFileSync(filename, 'utf8'), tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let callback; function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) callback = node.initializer.arguments[0]; ts.forEachChild(node, visit); } visit(tree); assert.ok(callback);
  const context = vm.createContext({ sessionValue: { current: null }, offlineMode: { current: false }, clearEmployeeOffline: async () => {}, acceptSession: (_token, session) => globals.setState?.({ mode: 'signedIn', session }), ...globals }); vm.runInContext(ts.transpileModule('globalThis.subject=' + callback.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context); return context.subject;
}
test('actual logout invalidates drafts before yielding and storage cleanup failure does not block local logout', async () => {
  let invalidated = false; const states = [], token = { current: 'old-token' };
  const logout = authCallback('signOut', { busy: { current: false }, inProgress() {}, activeToken: token, state: { mode: 'signedIn', session: { expiresAt: '2026-12-09T12:00:00Z' } },
    clearEmployeeDrafts() { invalidated = true; return Promise.reject(Error('native delete failed')); }, closePushAccount: async () => { assert.equal(invalidated, true); },
    mobileAuthOrigin: 'https://own.test', pendingLogouts: { enqueue: async () => {} }, clearToken: async () => {}, setSessionEpoch() {}, setState: value => states.push(value), flushLogouts: async () => {},
    pendingLogoutNotice: 'queued', unconfirmedLogoutNotice: 'unconfirmed', ok: { ok: true }, failure: error => ({ ok: false, error }), errorMessage: String,
  });
  assert.equal((await logout()).ok, true); assert.equal(token.current, null); assert.equal(states.at(-1).mode, 'signedOut');
});

test('checkout comments survive leaving and reopening their own shift and never become a chat draft', async () => {
  const native = storage(), first = loadDrafts(native), checkoutScope = 'origin/account/session/clock-out/shift-one';
  first.render('checkout-one', checkoutScope); await tick(); first.render('checkout-one', checkoutScope).setDraft('Jeg mødte kl. 08, men glemte indstemplingen.'); await tick(); first.unmount();
  const reopened = loadDrafts(native); reopened.render('checkout-one', checkoutScope); await tick();
  let draft = reopened.render('checkout-one', checkoutScope);
  assert.equal(draft.draft, 'Jeg mødte kl. 08, men glemte indstemplingen.');
  await draft.clear('En anden, ikke gemt tekst'); assert.equal(reopened.render('checkout-one', checkoutScope).draft, draft.draft);
  await draft.clear(draft.draft); assert.equal(reopened.render('checkout-one', checkoutScope).draft, ''); reopened.unmount();
  const chat = loadDrafts(native); chat.render('chat-one', 'origin/account/session/chat/shift-one'); await tick(); assert.equal(chat.render('chat-one', 'origin/account/session/chat/shift-one').draft, '');
});

function confirmationSubmit(globals) {
  const filename = path.join(mobile, 'src/components/shift-confirmation.tsx'), source = fs.readFileSync(filename, 'utf8'), tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let chosen; function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'submit') chosen = node; ts.forEachChild(node, visit); } visit(tree); assert.ok(chosen);
  const context = vm.createContext({ AbortController, ...globals }); vm.runInContext(ts.transpileModule('globalThis.subject=' + chosen.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context); return context.subject;
}
test('the actual checkout confirmation keeps its note on failure and clears only the acknowledged submitted text', async () => {
  const cleared = [], feedback = [], requestRef = { current: null }, pending = [];
  let allowed = true, result = { ok: false, error: 'Forbindelsen forsvandt' }, calls = 0;
  const globals = { requestRef, commentReady: true, comment: 'Min forklaring', commentDraft: { clear: async text => { cleared.push(text); } }, leave: false,
    setPending: value => pending.push(value), onConfirm: async text => { calls++; assert.equal(text, 'Min forklaring'); return result; }, setStampResult: value => feedback.push(value),
    Keyboard: { dismiss() {} }, process: { env: { EXPO_OS: 'android' } } };
  const submit = confirmationSubmit(globals);
  await submit(); assert.equal(calls, 1); assert.equal(cleared.length, 0); assert.equal(feedback[0].ok, false);
  requestRef.current = null; result = { ok: true }; await submit();
  assert.equal(calls, 2); assert.deepEqual(cleared, ['Min forklaring']); await submit(); assert.equal(calls, 2, 'double tap cannot post twice');
  const notLoaded = confirmationSubmit({ ...globals, requestRef: { current: null }, commentReady: false, onConfirm: async () => { allowed = false; } });
  await notLoaded(); assert.equal(allowed, true, 'loading a persisted note must not submit an empty replacement');
});

test('lost clock replies cannot acknowledge a different, uncommitted checkout or resubmission comment', () => {
  const { confirmsTimeCommand } = require(path.join(compiled, 'state/attendance-runtime.js'));
  const receipt = { version: 2, status: 'submitted', clockIn: '2026-11-09T08:00:00Z', clockOut: '2026-11-09T16:00:00Z', pauseAt: null, comment: 'Den oprindelige kommentar' };
  assert.equal(confirmsTimeCommand('finish', 1, receipt, 'Den oprindelige kommentar'), true);
  assert.equal(confirmsTimeCommand('finish', 1, receipt, '  Den oprindelige kommentar  '), true);
  assert.equal(confirmsTimeCommand('finish', 1, receipt, 'Ny kommentar som ikke er gemt'), false);
  assert.equal(confirmsTimeCommand('submit', 1, receipt, 'Ny kommentar som ikke er gemt'), false);
});

test('the actual reopened checkout reconciles the old command without reporting an edited note as submitted', async () => {
  const filename = path.join(mobile, 'src/screens/published-shift-screen.tsx'), source = fs.readFileSync(filename, 'utf8'), tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let chosen; function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'register') chosen = node; ts.forEachChild(node, visit); } visit(tree); assert.ok(chosen);
  let writes = 0, refreshed = 0;
  const { confirmsTimeCommand } = require(path.join(compiled, 'state/attendance-runtime.js'));
  const context = vm.createContext({ offline: false, detail: { shift: { id: 'shift' } }, id: 'shift', pending: { current: false }, uncertain: { current: { shiftId: 'shift', operation: 'finish', version: 1, comment: 'Oprindelig forklaring' } }, entry: { version: 1 },
    setBusy() {}, setActionError() {}, setSaved() {}, readPublishedShift: async () => ({ entry: { version: 2, status: 'submitted', clockIn: '2026-11-09T08:00:00Z', clockOut: '2026-11-09T16:00:00Z', pauseAt: null, comment: 'Oprindelig forklaring' } }),
    resource: { refresh() { refreshed++; } }, invalidateEmployeeResources() {}, confirmsTimeCommand, writeShiftTime: async () => { writes++; }, MobileAuthError: class extends Error {},
  });
  vm.runInContext(ts.transpileModule('globalThis.subject=' + chosen.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const result = await context.subject('finish', 'Ny tekst efter netværksfejlen');
  assert.equal(result.ok, false); assert.match(result.error, /tidligere kommentar/); assert.equal(writes, 0); assert.equal(refreshed, 1);
});

test('actual credential replacement clears drafts while an unsuccessful password attempt preserves them', async () => {
  let clears = 0, saves = 0, fail = false; const state = [], token = { current: 'old-token' };
  const change = authCallback('changePassword', { activeToken: token, busy: { current: false }, inProgress() {}, sessionExpired: 'expired',
    mobileAuthApi: { changePassword: async () => { if (fail) throw Error('wrong password'); return { token: 'replacement', session: { employee: {} } }; }, logout: async () => {} },
    clearEmployeeDrafts: async () => { clears++; }, saveToken: async () => { assert.equal(clears, 1); saves++; }, setSessionEpoch() {}, setState: value => state.push(value),
    clearToken: async () => {}, ok: { ok: true }, failure: error => ({ ok: false, error }), errorMessage: String, sessionInvalid: () => false, expire: async () => {},
  });
  assert.equal((await change('old', 'new')).ok, true); assert.equal(clears, 1); assert.equal(saves, 1); assert.equal(token.current, 'replacement');
  fail = true; assert.equal((await change('wrong', 'another')).ok, false); assert.equal(clears, 1);
});

test('concurrent real session expirations revoke synchronously, share teardown and cannot delete a replacement login', async () => {
  const activeToken={current:'old-token'},busy={current:false},expiring={current:null};let saved='old-token',closes=0,clears=0,release;
  const blocking=new Promise(resolve=>{release=resolve;}),states=[];
  const globals={activeToken,busy,expiring,clearEmployeeDrafts:()=>new Promise(()=>{}),closePushAccount:async()=>{closes++;await blocking;},
    clearToken:async()=>{clears++;saved=null;},saveToken:async token=>{saved=token;},setSessionEpoch(){},setState:value=>states.push(value),sessionExpired:'expired',
    mobileAuthApi:{login:async()=>({token:'new-token',session:{employee:{personId:'new-person'}}}),logout:async()=>{}},
    ok:{ok:true},failure:error=>({ok:false,error}),errorMessage:String,inProgress:()=>({ok:false,error:'busy'}),
  };
  const expire=authCallback('expire',globals),signIn=authCallback('signIn',globals);
  const first=expire('old-token'),second=expire('old-token');assert.equal(activeToken.current,null);assert.equal(busy.current,true);assert.equal(closes,1);
  assert.equal((await signIn('new@example.test','synthetic-password')).ok,false,'replacement waits until old Keychain teardown completes');
  release();await Promise.all([first,second]);assert.equal(clears,1);assert.equal(busy.current,false);
  assert.equal((await signIn('new@example.test','synthetic-password')).ok,true);assert.equal(saved,'new-token');assert.equal(activeToken.current,'new-token');
  await expire('old-token');assert.equal(clears,1);assert.equal(saved,'new-token');assert.equal(states.at(-1).mode,'signedIn');
});

function publishedResource() {
  const harness = hooks(), module = { exports: {} }, filename = path.join(mobile, 'src/state/published-schedule.ts');
  const auth = { offlineLease: 0, readOfflineResource: async () => null, saveOfflineResource: async () => {}, sessionEpoch: 1, state: { mode: 'signedIn', session: { employee: { workspaceId: 'own-workspace', personId: 'own-person' }, expiresAt: '2026-12-09T12:00:00Z' } } };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText;
  class MobileAuthError extends Error { constructor(status) { super('Scoped request failed'); this.status = status; } }
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (name === 'react') return harness.react;
    if (name === 'expo-router') return { useFocusEffect: callback => harness.react.useLayoutEffect(callback, [callback]) };
    if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name === '@/auth/mobile-auth') return { useMobileAuth: () => auth, offlineConnectionFailure: error => error.status === 503 };
    if (name === '@/auth/mobile-auth-api') return { MobileAuthError };
    if (name === './employee-offline-cache') return require(path.join(compiled, 'state/employee-offline-cache.js'));
    if (name === '@/domain/model') return require(path.join(compiled, 'domain/model.js'));
    throw Error('Unexpected resource dependency ' + name);
  } });
  return { auth, MobileAuthError, render: loader => harness.render(() => module.exports.usePublishedResource('same-period', loader)), renderSchedule: (from,to) => harness.render(() => module.exports.usePublishedSchedule(from,to)), unmount: harness.unmount };
}
test('actual published resources never join an old session request after same-account reauthentication with an unchanged expiry', async () => {
  const { auth, render, unmount } = publishedResource();
  let finishOld, oldCalls = 0, freshCalls = 0;
  const old = () => { oldCalls++; return new Promise(resolve => { finishOld = resolve; }); }, fresh = async () => { freshCalls++; return 'new-session-data'; };
  render(old); await tick(); auth.sessionEpoch = 2; render(fresh); await tick();
  assert.equal(oldCalls, 1); assert.equal(freshCalls, 1, 'fresh session must not await or reuse the old authenticated request');
  finishOld('old-session-data'); await tick(); assert.equal(render(fresh).data, 'new-session-data'); unmount();
});

test('actual resources keep current data through connection loss but remove it immediately when authority is withdrawn', async () => {
  const { render, MobileAuthError, unmount } = publishedResource();
  let failure = null; const load = async () => { if (failure) throw failure; return 'own-private-hours'; };
  render(load); await tick(); assert.equal(render(load).data, 'own-private-hours');
  failure = Error('offline'); render(load).refresh(); await tick(); assert.equal(render(load).data, 'own-private-hours');
  failure = new MobileAuthError(403); render(load).refresh(); await tick(); assert.equal(render(load).data, undefined); assert.match(render(load).error, /Scoped request/); unmount();
});


test('actual schedule hook requests a bounded prior day and retains only shifts touching the selected week', async () => {
  const { auth, renderSchedule, unmount } = publishedResource(), calls=[];
  const record=(id,date,start,end)=>({shift:{id,date,start,end,personId:'own-person'},site:{id:'own-site',name:'Own site',address:''}});
  auth.readPublishedSchedule=async(from,to,cursor)=>{calls.push({from,to,cursor});return {shifts:[record('carry','2026-12-31','22:00','06:00'),record('midnight-end','2026-12-31','20:00','00:00'),record('old-day','2026-12-31','08:00','16:00'),record('new-day','2027-01-01','08:00','16:00')],nextCursor:null};};
  renderSchedule('2027-01-01','2027-01-07');await tick();
  const result=renderSchedule('2027-01-01','2027-01-07');
  assert.deepEqual(calls,[{from:'2026-12-31',to:'2027-01-07',cursor:null}]);
  assert.deepEqual(plain(result.data.map(item=>item.shift.id)),['carry','new-day']);unmount();
});
