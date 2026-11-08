const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const build = process.env.CLEANROOMS_TEST_BUILD;
if (!build) throw new Error('Run node tests/run.mjs to compile and test the actual domain modules.');
const model = require(path.join(build, 'domain/model.js'));
const filename = require.resolve('../src/auth/mobile-auth-api.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename,
}).outputText;
const origin = 'https://mobile-api.example.test';
const token = 'test-session-token-that-never-leaves-this-process';
const plain = value => JSON.parse(JSON.stringify(value));

function publishedShift(overrides = {}) {
  return {
    id: 'shift-own', personId: 'employee-own', date: '2026-11-08', start: '08:00', end: '16:00',
    breakMinutes: 30, site: { id: 'site-ringsted', name: 'CK Ringsted', address: 'Køgevej 50, 4100 Ringsted' },
    description: 'Start i fællesarealet.', checklist: [{ id: 'task-own', text: 'Fyld sæbe op' }],
    clockInRadius: 100, entry: null,
    ...overrides,
  };
}

function client(respond) {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    __DEV__: false,
    process: { env: { EXPO_OS: 'ios', EXPO_PUBLIC_CLEANROOMS_AUTH_URL: origin } },
    AbortController, setTimeout, clearTimeout,
    require(name) {
      if (name === '@/domain/model') return model;
      if (name === 'expo/fetch') return { fetch: async (url, options) => {
        calls.push({ url, options });
        return respond(url, options);
      } };
      throw new Error(`Unexpected dependency in the native API client: ${name}`);
    },
  }, { filename });
  return { ...module.exports, calls };
}

test('published shift data uses an authenticated native API request without cookies or redirects', async () => {
  const app = client(() => Response.json({ shift: publishedShift() }));
  const detail = await app.mobileAuthApi.publishedShift(token, 'shift-own');
  assert.equal(app.calls.length, 1);
  const [{ url, options }] = app.calls;
  assert.equal(url, origin + '/api/mobile-auth');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), { action: 'publishedShift', shiftId: 'shift-own' });
  assert.equal(detail.shift.personId, 'employee-own');
  assert.equal(detail.shift.siteId, 'site-ringsted');
  assert.equal(detail.site.name, 'CK Ringsted');
  assert.deepEqual(plain(detail.shift.checklist), [{ id: 'task-own', text: 'Fyld sæbe op' }]);
});

test('re-reading a shift receives the current radius and GPS-off requires an explicit null', async () => {
  const radii = [100, 250, null];
  const app = client(() => Response.json({ shift: publishedShift({ clockInRadius: radii.shift() }) }));
  for (const expected of [100, 250, null]) {
    const detail = await app.mobileAuthApi.publishedShift(token, 'shift-own');
    assert.equal(detail.clockInRadius, expected);
    assert.equal(detail.entry, null);
  }
  assert.equal(app.calls.length, 3, 'each re-read asks the API rather than reusing a cached GPS rule');
});

test('a missing or malformed GPS radius fails closed instead of becoming GPS-off', async () => {
  for (const radius of [undefined, 0, -1, 1.5, '100', false, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const fixture = publishedShift({ clockInRadius: radius });
    const app = client(() => Response.json({ shift: fixture }));
    await assert.rejects(app.mobileAuthApi.publishedShift(token, 'shift-own'), error => {
      assert.ok(error instanceof app.MobileAuthError);
      assert.equal(error.code, 'mobile_response_invalid');
      assert.equal(error.status, 503);
      return true;
    }, `invalid radius: ${String(radius)}`);
    assert.equal(app.calls.length, 1);
  }
});

test('only an explicit missing published shift becomes null', async () => {
  const missing = client(() => Response.json({ shift: null }));
  assert.equal(await missing.mobileAuthApi.publishedShift(token, 'removed-shift'), null);
  const malformed = client(() => Response.json({}));
  await assert.rejects(malformed.mobileAuthApi.publishedShift(token, 'shift-own'), error =>
    error instanceof malformed.MobileAuthError && error.code === 'mobile_schedule_invalid');
});

test('redirects, HTML, malformed JSON and connection failures stay in the API error flow', async () => {
  const cases = [
    [() => new Response('', { status: 302, headers: { location: 'https://external.example.test/login' } }), 'mobile_unavailable'],
    [() => new Response('<html>Log in elsewhere</html>', { headers: { 'content-type': 'text/html' } }), 'mobile_response_invalid'],
    [() => new Response('{', { headers: { 'content-type': 'application/json' } }), 'mobile_response_invalid'],
    [() => { throw new Error('Network unavailable'); }, 'mobile_connection_failed'],
  ];
  for (const [respond, expectedCode] of cases) {
    const app = client(respond);
    await assert.rejects(app.mobileAuthApi.publishedShift(token, 'shift-own'), error =>
      error instanceof app.MobileAuthError && error.code === expectedCode);
    assert.equal(app.calls.length, 1, 'a failed request never opens or follows a fallback URL');
    assert.equal(app.calls[0].options.redirect, 'error');
  }
});

test('native clock-in sends the GPS fix to the API and receives the server-owned clock receipt', async () => {
  const receipt = { version: 1, status: 'running', clockIn: '2026-11-08T07:00:00Z', clockOut: null, pauseAt: null };
  const app = client(() => Response.json({ entry: receipt }));
  const location = { latitude: 55.61, longitude: 12.1, accuracyMeters: 5, timestamp: 1794121200000 };
  const command = { shiftId: 'shift-own', operation: 'start', version: 0, comment: null, location };
  assert.deepEqual(plain(await app.mobileAuthApi.shiftTime(token, command)), receipt);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(app.calls[0].options.body), { action: 'shiftTime', ...command });
});

test('clock-in without a fix keeps the server GPS requirement authoritative without a browser fallback', async () => {
  const command = { shiftId: 'shift-own', operation: 'start', version: 0, comment: null, location: null };
  const app = client(() => Response.json({ error: 'time_location_required', message: 'Del din aktuelle placering.' }, { status: 400 }));
  await assert.rejects(app.mobileAuthApi.shiftTime(token, command), error => {
    assert.ok(error instanceof app.MobileAuthError);
    assert.equal(error.code, 'time_location_required');
    assert.equal(error.message, 'Del din aktuelle placering.');
    return true;
  });
  assert.deepEqual(JSON.parse(app.calls[0].options.body), { action: 'shiftTime', ...command });
  assert.equal(app.calls.length, 1);
});
