const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const gateway = import(pathToFileURL(path.resolve(__dirname, '../../cleanrooms-app-api/worker/index.js')).href);
const dispatchKey = 'a'.repeat(64);
const siteAccessToken = 'fixture-private-site-access-token';
const mobileToken = 'm'.repeat(43);
const env = { PUSH_DISPATCH_KEY: dispatchKey, STUDIO_SITE_ACCESS_TOKEN: siteAccessToken, STUDIO_ORIGIN: 'https://studio.test' };
const endpoint = 'https://app-api.test/api/push-dispatch';
const studioEndpoint = 'https://studio.test/api/push-dispatch';

function request({ url = endpoint, method = 'POST', key = dispatchKey, contentType = 'application/json', body = '{}', extraHeaders = {} } = {}) {
  const headers = new Headers(extraHeaders);
  if (key !== null) headers.set('X-CleanRooms-Push-Key', key);
  if (contentType !== null) headers.set('Content-Type', contentType);
  return new Request(url, { method, headers, ...(method === 'GET' || method === 'HEAD' || body === null ? {} : { body }) });
}

async function handle(input, settings = env, upstream = async () => Response.json({ ok: true })) {
  return (await gateway).handleGatewayRequest(input, settings, upstream);
}

async function assertRejected(input, status, settings = env) {
  let calls = 0;
  const response = await handle(input, settings, async () => { calls++; return Response.json({ ok: true }); });
  assert.equal(response.status, status);
  assert.equal(calls, 0, 'rejected requests must not reach the private site');
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  return response;
}

test('push gateway conceals the endpoint without the configured service key', async () => {
  for (const key of [null, '', 'b'.repeat(64), 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)]) {
    const response = await assertRejected(request({ key }), 404);
    assert.equal((await response.json()).error, 'not_found');
  }
  for (const key of [undefined, '', 'invalid']) {
    await assertRejected(request(), 404, { ...env, PUSH_DISPATCH_KEY: key });
  }
  await assertRejected(request({ method: 'GET', key: null }), 404);
});

test('push gateway rejects queries, other paths and non-POST methods before forwarding', async () => {
  for (const url of [endpoint + '?wake=1', endpoint + '?key=' + dispatchKey, endpoint + '/', 'https://app-api.test/not-a-route']) {
    await assertRejected(request({ url }), 404);
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    await assertRejected(request({ method }), 405);
  }
});

test('push gateway accepts only the exact bounded empty JSON request', async () => {
  for (const body of [null, '', 'null', '[]', '{"ok":true}', '{ }', ' {}', '{}\n', 'not-json', new Uint8Array([0xff]), 'x'.repeat(2049), 'ø'.repeat(1025)]) {
    await assertRejected(request({ body }), 400);
  }
  for (const contentType of [null, 'text/plain', 'application/jsonp', 'application/octet-stream']) {
    await assertRejected(request({ contentType }), 400);
  }
  await assertRejected(request({ extraHeaders: { 'content-length': '2049' } }), 400);
});

test('push gateway forwards only its server credentials and returns only an acknowledgement', async () => {
  let observed;
  const response = await handle(request({
    contentType: 'application/json; charset=utf-8',
    extraHeaders: {
      Authorization: 'Bearer ' + mobileToken,
      Cookie: 'session=client-cookie',
      'OAI-Sites-Authorization': 'Bearer forged-site-access',
      'OAI-Authenticated-User-Id': 'forged-user',
      'X-CleanRooms-Gateway-Key': 'forged-gateway-key',
      'X-CleanRooms-Client-IP': '203.0.113.1',
      'CF-Connecting-IP': '203.0.113.2',
      'X-Request-Id': 'forged-request-id',
      'X-Untrusted-Header': 'client-value',
    },
  }), env, async (url, options) => {
    observed = { url, ...options, headers: new Headers(options.headers) };
    return Response.json({ ok: true, token: siteAccessToken, sent: 57, internal: { key: dispatchKey } }, {
      headers: { 'Set-Cookie': 'must-not-relay', 'X-Request-Id': 'upstream-request-id', 'X-Upstream-Secret': dispatchKey, 'Retry-After': '100' },
    });
  });
  assert.equal(observed.url, studioEndpoint);
  assert.equal(observed.method, 'POST');
  assert.equal(observed.body, '{}');
  assert.equal(observed.redirect, 'manual');
  assert.ok(observed.signal instanceof AbortSignal);
  assert.deepEqual([...observed.headers.keys()].sort(), ['content-type', 'oai-sites-authorization', 'x-cleanrooms-push-key', 'x-request-id']);
  assert.equal(observed.headers.get('content-type'), 'application/json');
  assert.equal(observed.headers.get('oai-sites-authorization'), 'Bearer ' + siteAccessToken);
  assert.equal(observed.headers.get('x-cleanrooms-push-key'), dispatchKey);
  assert.match(observed.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  assert.notEqual(observed.headers.get('x-request-id'), 'forged-request-id');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('x-request-id'), observed.headers.get('x-request-id'));
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-upstream-secret'), null);
  assert.equal(response.headers.get('retry-after'), null);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('push gateway rejects redirects, HTML, errors and unexpected upstream JSON', async t => {
  t.mock.method(console, 'warn', () => {});
  const responses = [
    () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.test/', 'Content-Type': 'application/json' } }),
    () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => Response.json({ ok: true }, { status: 401 }),
    () => Response.json({ ok: true }, { status: 429 }),
    () => Response.json({ ok: true }, { status: 500 }),
    () => Response.json({}),
    () => Response.json({ ok: false }),
    () => Response.json({ ok: 'true' }),
    () => Response.json(null),
    () => Response.json([{ ok: true }]),
    () => new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(null, { status: 204, headers: { 'Content-Type': 'application/json' } }),
  ];
  for (const makeResponse of responses) {
    let calls = 0;
    const response = await handle(request(), env, async () => { calls++; return makeResponse(); });
    assert.equal(calls, 1);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'mobile_unavailable');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('push gateway failures log only diagnostics and never credentials or upstream content', async t => {
  const logs = [];
  t.mock.method(console, 'warn', (...values) => logs.push(values.join(' ')));
  const leakedValues = [dispatchKey, siteAccessToken, mobileToken, 'sensitive-upstream-message', 'sensitive-client-cookie'];
  const input = () => request({ extraHeaders: { Authorization: 'Bearer ' + mobileToken, Cookie: 'sensitive-client-cookie' } });
  const responses = [
    await handle(input(), env, async () => { throw new Error(leakedValues.join(' ')); }),
    await handle(input(), env, async () => Response.json({ error: leakedValues.join(' ') }, { status: 500 })),
    await handle(input(), { ...env, STUDIO_SITE_ACCESS_TOKEN: '' }, async () => { assert.fail('missing site credential must not forward'); }),
  ];
  assert.equal(logs.length, 3);
  for (let index = 0; index < responses.length; index++) {
    const response = responses[index];
    assert.equal(response.status, 503);
    const body = await response.text();
    for (const secret of leakedValues) {
      assert.ok(!logs[index].includes(secret));
      assert.ok(!body.includes(secret));
    }
    const diagnostic = JSON.parse(logs[index]);
    assert.deepEqual(Object.keys(diagnostic).sort(), ['durationMs', 'event', 'requestId', 'status']);
    assert.equal(diagnostic.event, 'mobile_gateway_failure');
    assert.equal(diagnostic.status, 503);
    assert.equal(diagnostic.requestId, response.headers.get('x-request-id'));
    assert.ok(Number.isInteger(diagnostic.durationMs) && diagnostic.durationMs >= 0);
  }
});


test('public gateway validates its configured origin for both login and push routes', async t => {
  t.mock.method(console, 'warn', () => {});
  const mobile = () => new Request('https://app-api.test/api/mobile-auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"employeeInbox"}',
  });
  for (const origin of [undefined, '', 'not-a-url', 'http://studio.test', 'https://user:password@studio.test', 'https://studio.test/private', 'https://studio.test/?secret=1', 'https://studio.test/#fragment']) {
    const settings = { ...env, MOBILE_GATEWAY_KEY: 'b'.repeat(64), STUDIO_ORIGIN: origin };
    for (const input of [request(), mobile()]) {
      await assertRejected(input, 503, settings);
    }
  }
  const settings = { ...env, MOBILE_GATEWAY_KEY: 'b'.repeat(64), STUDIO_ORIGIN: 'https://configured-studio.test' };
  const destinations = [];
  for (const input of [request(), mobile()]) {
    const result = await handle(input, settings, async url => {
      destinations.push(url);
      return Response.json({ ok: true });
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(destinations, [
    'https://configured-studio.test/api/push-dispatch',
    'https://configured-studio.test/api/mobile-auth',
  ]);
});
