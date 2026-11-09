const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const item = patch => ({ id: 'notification-1', kind: 'new', before: null, after: { id: 'former-shift' }, readAt: null, ...patch });
const receipt = patch => ({ messageId: 'notification-1', readAt: '2026-11-09T12:00:00Z', unreadCount: 0, target: { kind: 'shift', shiftId: 'current-shift' }, ...patch });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function actualHandler(name, globals) {
  const filename = path.join(root, 'src/screens/live-notifications-screen.tsx'), source = fs.readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let chosen;
  function visit(node) { if (!chosen && ts.isFunctionDeclaration(node) && node.name?.text === name) chosen = node; ts.forEachChild(node, visit); }
  visit(tree); assert.ok(chosen, 'The actual notification handler must exist.');
  const context = vm.createContext(globals);
  const code = ts.transpileModule('globalThis.subject = ' + chosen.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInContext(code, context); return context.subject;
}
function targetParser() {
  const filename = path.join(root, 'src/notifications/push-wire.ts'), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports }); return module.exports.parsePushTarget;
}
function fixture() {
  const calls = [], errors = [], navigation = [], scrolls = [], busy = [];
  const pending = { current: false }, mounted = { current: true }, generation = { current: 1 }, pageGeneration = { current: 1 };
  let send = async () => receipt(), read = { scope: '', ids: [] }, invalidate = () => {};
  const globals = { Date, Set, Error, pending, mounted, generation, pageGeneration, scope: 'current-account-session',
    readIds: [], setRead: next => { read = next(read); }, setBusy: value => busy.push(value), setError: value => errors.push(value),
    employeeRequest: async payload => { calls.push(plain(payload)); return send(payload); },
    parsePushTarget: targetParser(), router: { push: target => { calls.push('navigate'); navigation.push(plain(target)); } },
    list: { current: { scrollToOffset: value => scrolls.push(plain(value)) } },
    invalidateEmployeeResources: prefix => { calls.push('invalidate:' + prefix); invalidate(); },
  };
  return { open: actualHandler('open', globals), calls, errors, navigation, scrolls, busy, pending, mounted, generation, pageGeneration,
    read: () => plain(read), send: next => { send = next; }, invalidate: next => { invalidate = next; } };
}

test('notification navigation follows fresh server authority before inbox invalidation can refresh the list', async () => {
  const h = fixture();
  h.invalidate(() => { h.generation.current++; });
  await h.open(item());
  assert.deepEqual(h.calls[0], { action: 'employeeInboxRead', messageId: 'notification-1' });
  assert.deepEqual(h.navigation, [{ pathname: '/shift/[id]', params: { id: 'current-shift' } }]);
  assert.deepEqual(h.calls.slice(1), ['navigate', 'invalidate:inbox']);
  assert.deepEqual(h.read().ids, ['notification-1']); assert.equal(h.pending.current, false);
  assert.equal(h.busy.at(-1), null);
});

test('cancelled and already-read historical notifications stay in the inbox after reassignment', async () => {
  for (const message of [item({ kind: 'cancelled', before: { id: 'removed' }, after: null }), item({ readAt: '2026-11-08T10:00:00Z' })]) {
    const h = fixture(); h.send(async () => receipt({ target: { kind: 'inbox' } }));
    await h.open(message);
    assert.equal(h.calls.filter(value => typeof value === 'object').length, 1, 'already-read events still recheck the assignment');
    assert.deepEqual(h.navigation, []); assert.deepEqual(h.read().ids, ['notification-1']);
    assert.equal(h.calls.at(-1), 'invalidate:inbox');
  }
});

test('request replies open the inbox request controls rather than the former shift assignment', async () => {
  const h = fixture(); h.send(async () => receipt({ target: { kind: 'inbox' } }));
  await h.open(item({ kind: 'request' }));
  assert.deepEqual(h.navigation, []); assert.deepEqual(h.scrolls, [{ offset: 0, animated: true }]);
});

test('a pending open cannot duplicate writes and an unrelated same-account refresh cannot discard its acknowledgement', async () => {
  const h = fixture(), pending = deferred(); h.send(() => pending.promise);
  const first = h.open(item()); await h.open(item({ id: 'second' }));
  assert.equal(h.calls.length, 1);
  h.pageGeneration.current++;
  pending.resolve(receipt()); await first;
  assert.equal(h.navigation.length, 1); assert.equal(h.pending.current, false);
});

test('old-account successes and failures cannot navigate, show an error or unlock a new session action', async () => {
  for (const fail of [false, true]) {
    const h = fixture(), pending = deferred(); h.send(() => pending.promise);
    const first = h.open(item()); h.generation.current++; h.pending.current = true;
    if (fail) pending.reject(new Error('Private old account failure')); else pending.resolve(receipt());
    await first;
    assert.deepEqual(h.navigation, []); assert.deepEqual(h.read().ids, []);
    assert.deepEqual(h.errors, ['']); assert.equal(h.pending.current, true);
    assert.equal(h.calls.includes('invalidate:inbox'), false);
    assert.equal(h.busy.includes(null), false);
  }
});

test('invalid receipts and foreign destinations cannot become a local read receipt or route', async () => {
  for (const value of [receipt({ messageId: 'foreign-message' }), receipt({ readAt: 'invalid' }), receipt({ target: { kind: 'shift', shiftId: 'https://untrusted.example/collect' } }), receipt({ target: { kind: 'chat', roomId: 'foreign-room' } })]) {
    const h = fixture(); h.send(async () => value); await h.open(item());
    assert.deepEqual(h.navigation, []); assert.deepEqual(h.read().ids, []);
    assert.ok(h.errors.at(-1)); assert.equal(h.calls.includes('invalidate:inbox'), false);
    assert.equal(h.pending.current, false);
  }
});

test('a failed receipt preserves the unread row and an explicit retry can finish without duplicate navigation', async () => {
  const h = fixture(); h.send(async () => { throw new Error('Forbindelsen mangler.'); });
  await h.open(item()); assert.deepEqual(h.read().ids, []); assert.deepEqual(h.navigation, []);
  assert.equal(h.errors.at(-1), 'Forbindelsen mangler.'); assert.equal(h.pending.current, false);
  h.send(async () => receipt()); await h.open(item());
  assert.equal(h.navigation.length, 1); assert.deepEqual(h.read().ids, ['notification-1']);
});

test('pagination responses and failures from an old inbox refresh do not replace the current page', async () => {
  for (const fail of [false, true]) {
    const pending = deferred(), writes = [], errors = [], lock = { current: false }, generation = { current: 1 }, pageGeneration = { current: 1 };
    const more = actualHandler('loadMore', { cursor: 'next', pending: lock, mounted: { current: true }, generation, pageGeneration,
      resource: { loading: false, generation: 1 }, scope: 'same-account', head: 'old', firstCursor: 'next', extra: undefined,
      employeeRequest: () => pending.promise, setBusy() {}, setError: value => errors.push(value), setMore: value => writes.push(value),
      invalidateEmployeeResources: () => writes.push('invalidated'), Error,
    });
    const reading = more(); pageGeneration.current++;
    if (fail) pending.reject(new Error('Stale page failure')); else pending.resolve({ notifications: [], nextCursor: null });
    await reading;
    assert.deepEqual(writes, []); assert.deepEqual(errors, ['']); assert.equal(lock.current, false);
  }
});
