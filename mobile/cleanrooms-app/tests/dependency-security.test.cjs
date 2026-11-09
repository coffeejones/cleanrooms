const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const installer = path.join(root, 'scripts/dependency-security.cjs');
const query = require('query-string');
const decoder = createRequire(require.resolve('query-string'))('decode-uri-component');

test('the installed package graph and CJS adapter pass the same fail-closed check used by npm ci and Metro', () => {
  const { prepareDependencySecurity } = require(installer);
  assert.equal(prepareDependencySecurity({ check: true }).decoders, 1);
  assert.equal(typeof decoder, 'function');
  assert.equal(decoder('M%C3%B8de+%E2%9C%93'), 'Møde+✓');
});

test('a modified upstream source, missing adapter or restored ESM-only package cannot pass the install check', () => {
  function checkWith(read) {
    const module = { exports: {} }, localRequire = createRequire(installer);
    const load = name => name === 'node:fs' ? { ...fs, readFileSync: (file, ...args) => read(String(file), () => fs.readFileSync(file, ...args)),
      writeFileSync() { assert.fail('a check must never mutate dependencies'); } } : localRequire(name);
    load.resolve = localRequire.resolve;
    vm.runInNewContext(fs.readFileSync(installer, 'utf8'), { require: load, module, exports: module.exports, __dirname: path.dirname(installer), console, process }, { filename: installer });
    return () => module.exports.prepareDependencySecurity({ check: true });
  }
  assert.throws(checkWith((file, read) => file.endsWith('/decode-uri-component/index.js') ? read() + '\n// unexpected source' : read()), /source\/license/);
  assert.throws(checkWith((file, read) => file.endsWith('/decode-uri-component/index.cjs') ? '// no adapter' : read()), /adapter is missing or changed/);
  assert.throws(checkWith((file, read) => file.endsWith('/node_modules/decode-uri-component/package.json')
    ? fs.readFileSync(path.join(root, 'vendor/decode-uri-component/upstream-package.json'), 'utf8') : read()), /adapter is missing or changed/);
});

test('CJS and official ESM decoders agree on Unicode, BOM, partial UTF-8 and deterministic malformed strings', async () => {
  const { default: official } = await import(pathToFileURL(path.join(root, 'node_modules/decode-uri-component/index.js')).href);
  const cases = ['Ægir Jensen', '%C3%86gir%20Jensen', '%F0%9F%91%8D', '%', '%G1', '%C2', '%FE%FF', '%FF%FE', '%E0%A4%A', '%ED%A0%80', '%F4%90%80%80', '%C3%B8%25broken'];
  let seed = 42;
  for (let n = 0; n < 500; n++) {
    let value = '';
    for (let i = 0; i < 40; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += '%' + (seed & 255).toString(16).padStart(2, '0'); }
    cases.push(value);
  }
  for (const value of cases) assert.equal(decoder(value), official(value));
  assert.throws(() => decoder(42), TypeError);
});

test('query-string keeps callable CommonJS decoding, array semantics, plus signs and prototype-safe dictionaries', () => {
  const value = query.parse('name=%C3%86gir+Jensen&tag=dag&tag=nat&empty=&flag&__proto__=safe&bad=%E0%A4%A');
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(value.name, 'Ægir Jensen'); assert.deepEqual(value.tag, ['dag', 'nat']);
  assert.equal(value.empty, ''); assert.equal(value.flag, null); assert.equal(value.__proto__, 'safe');
  assert.equal(typeof value.bad, 'string');
  const roundtrip = query.parse(query.stringify({ note: 'Møde kl. 08 + nøgle ✓', ids: ['a', 'b'] }));
  assert.equal(roundtrip.note, 'Møde kl. 08 + nøgle ✓'); assert.deepEqual(roundtrip.ids, ['a', 'b']);
});

test('the actual Expo Router parsers roundtrip a shift link with Unicode and query parameters', () => {
  // Native platform selection/container validation are stubbed. The Router
  // path serializers, query-string and installed decoder are the real modules.
  const cache = new Map();
  function load(filename) {
    if (filename.endsWith('/react-navigation/native.js')) return { validatePathConfig() {} };
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const localRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
      require(name) {
        if (name === 'react-native') return { Platform: { OS: 'ios', select: values => values.ios ?? values.default } };
        const next = localRequire.resolve(name); return next.includes('/expo-router/build/') ? load(next) : localRequire(name);
      },
      URL, URLSearchParams, process: { env: { EXPO_BASE_URL: '', EXPO_OS: 'ios' } }, console,
    }, { filename });
    return module.exports;
  }
  const { getPathFromState } = load(require.resolve('expo-router/build/fork/getPathFromState.js'));
  const { getStateFromPath } = load(require.resolve('expo-router/build/fork/getStateFromPath.js'));
  const options = { screens: { Shift: 'shift/:id' } };
  const url = getPathFromState({ routes: [{ name: 'Shift', params: { id: 'shift-one', note: 'Møde + nøgle ✓' } }] }, options);
  assert.equal(url, '/shift/shift-one?note=M%C3%B8de%20%2B%20n%C3%B8gle%20%E2%9C%93');
  const restored = getStateFromPath(url, options);
  assert.equal(restored.routes[0].params.id, 'shift-one');
  assert.equal(restored.routes[0].params.note, 'Møde + nøgle ✓');
  assert.doesNotThrow(() => getStateFromPath('/shift/shift-one?note=%E0%A4%A', options));
});

test('malformed decoding and query parsing stay bounded in a subprocess with an enforced timeout', () => {
  const program = `const assert=require('node:assert/strict');const d=require('decode-uri-component');const q=require('query-string');
    const inputs=['%C2'.repeat(100000),'%E0%A4%A'.repeat(75000),Array.from({length:15000},(_,i)=>'%'+(i%256).toString(16).padStart(2,'0')+'!').join('')+'%FF'];
    for(const value of inputs){const result=d(value);assert.ok(result.length<=value.length);assert.equal(typeof q.parse('note='+value).note,'string');}
    process.stdout.write('bounded');`;
  assert.equal(execFileSync(process.execPath, ['-e', program], { cwd: root, encoding: 'utf8', timeout: 10_000 }), 'bounded');
});

test('Expo fingerprint retains its ignore/directory matching contracts with the nonrecursive minimatch', () => {
  const fingerprintRequire = createRequire(require.resolve('@expo/fingerprint'));
  const matcher = fingerprintRequire('minimatch');
  assert.equal(matcher.minimatch('src/app/index.tsx', '**/*.tsx'), true);
  const helpers = require('@expo/fingerprint/build/utils/Path.js');
  const ignores = helpers.buildPathMatchObjects(['**/node_modules/**', '**/.expo/**', '!**/.expo/keep.json']);
  assert.equal(helpers.isIgnoredPathWithMatchObjects('packages/app/node_modules/pkg/index.js', ignores), true);
  assert.equal(helpers.isIgnoredPathWithMatchObjects('.expo/temporary.json', ignores), true);
  assert.equal(helpers.isIgnoredPathWithMatchObjects('.expo/keep.json', ignores), false);
  assert.equal(helpers.isIgnoredPathWithMatchObjects('src/app/index.tsx', ignores), false);
  assert.ok(helpers.buildDirMatchObjects(ignores).every(value => typeof value.match === 'function'));
});

test('the actual fingerprint glob preserves discovery and honours pre-aborted traversal', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanrooms-glob-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of ['.gitignore', 'app/.gitignore', 'app/src/.gitignore', 'node_modules/ignored/.gitignore']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.writeFileSync(path.join(directory, file), 'build/\n');
  }
  const fingerprintRequire = createRequire(require.resolve('@expo/fingerprint')), { glob } = fingerprintRequire('glob');
  // glob13 and glob14 both treat a bare ignore as an exact pattern, rather
  // than an implicit subtree pattern. Preserve the fingerprint caller's API.
  assert.deepEqual((await glob('**/.gitignore', { cwd: directory, ignore: ['node_modules'], follow: false })).sort(), ['.gitignore', 'app/.gitignore', 'app/src/.gitignore', 'node_modules/ignored/.gitignore']);
  assert.deepEqual((await glob('**/.gitignore', { cwd: directory, ignore: ['node_modules/**'], follow: false })).sort(), ['.gitignore', 'app/.gitignore', 'app/src/.gitignore']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(glob('**/*', { cwd: directory, signal: controller.signal }));
  const during = new AbortController(); let reads = 0;
  const observed = { ...fs, readdir(folder, options, callback) {
    reads++;
    fs.readdir(folder, options, (error, files) => { if (!during.signal.aborted) during.abort(); callback(error, files); });
  } };
  await assert.rejects(glob('**/*', { cwd: directory, fs: observed, signal: during.signal }));
  const atAbort = reads;
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.ok(atAbort > 0); assert.equal(reads, atAbort, 'a cancelled walk must not schedule new directory reads');
});

test('ESLint React hooks uses the supported patched zod/v4 and its error formatter', () => {
  const hooksRequire = createRequire(require.resolve('eslint-plugin-react-hooks'));
  const z = hooksRequire('zod/v4');
  const { fromError } = hooksRequire('zod-validation-error/v4');
  const result = z.object({ enabled: z.boolean() }).safeParse({ enabled: 'wrong' });
  assert.equal(result.success, false); assert.match(fromError(result.error).message, /boolean/);
  const oversized = z.array(z.string()).max(5).safeParse(Array(50_000).fill(0));
  assert.equal(oversized.success, false);
  assert.equal(oversized.error.issues.length, 1, 'oversized collections must fail before allocating one issue per element');
  assert.ok(require('eslint-plugin-react-hooks').rules['rules-of-hooks']);
});
