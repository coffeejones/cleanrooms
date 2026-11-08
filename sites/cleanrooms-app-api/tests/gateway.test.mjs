import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGatewayRequest } from '../worker/index.js';

// Deliberately synthetic test credentials; no deployed service is contacted.
const config = {
  STUDIO_ORIGIN: 'https://studio.example.test',
  MOBILE_GATEWAY_KEY: 'a'.repeat(64),
  STUDIO_SITE_ACCESS_TOKEN: 'synthetic-server-only-access-token',
};
const sessionToken = 'employee-session-'.padEnd(40, 'x');
const request = ({ path = '/api/mobile-auth', method = 'POST', body = '{"action":"session"}', headers = {} } = {}) =>
  new Request('https://gateway.example.test' + path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(body === null ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
const noFetch = () => { assert.fail('Invalid requests must never contact the upstream'); };
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers });

test('missing or invalid server configuration fails closed before fetching', async () => {
  for (const env of [
    {}, { ...config, STUDIO_ORIGIN: undefined }, { ...config, STUDIO_ORIGIN: '' },
    { ...config, MOBILE_GATEWAY_KEY: undefined }, { ...config, MOBILE_GATEWAY_KEY: 'not-a-key' },
    { ...config, MOBILE_GATEWAY_KEY: 'A'.repeat(64) }, { ...config, STUDIO_SITE_ACCESS_TOKEN: undefined },
    { ...config, STUDIO_SITE_ACCESS_TOKEN: '' },
  ]) {
    const response = await handleGatewayRequest(request(), env, noFetch);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'mobile_unavailable', message: 'Login er midlertidigt utilgængeligt. Prøv igen.',
    });
  }
});

test('the configured upstream must be an HTTPS origin without userinfo, path, query or fragment', async () => {
  for (const origin of [
    'not a URL', 'http://studio.example.test', 'file:///private/config',
    'https://user@studio.example.test', 'https://user:password@studio.example.test',
    'https://studio.example.test/private', 'https://studio.example.test/api/mobile-auth',
    'https://studio.example.test?tenant=other', 'https://studio.example.test/#private',
    '//studio.example.test',
  ]) {
    const response = await handleGatewayRequest(request(), { ...config, STUDIO_ORIGIN: origin }, noFetch);
    assert.equal(response.status, 503, 'Reject non-origin configuration');
  }
});

test('a valid origin forwards only selected client data and keeps server credentials out of responses', async () => {
  const body = '{"action":"session"}';
  let calls = 0;
  const response = await handleGatewayRequest(request({ body, headers: {
    authorization: 'Bearer ' + sessionToken,
    'cf-connecting-ip': '2001:db8::1',
    cookie: 'private-browser-session=not-forwarded',
    'oai-sites-authorization': 'Bearer client-injected-credential',
    'x-cleanrooms-gateway-key': 'client-injected-key',
    'oai-authenticated-user-id': 'client-injected-user',
    'x-cleanrooms-client-ip': 'client-injected-ip',
  } }), { ...config, STUDIO_ORIGIN: config.STUDIO_ORIGIN + '/' }, async (url, init) => {
    calls += 1;
    assert.equal(url, config.STUDIO_ORIGIN + '/api/mobile-auth');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new TextDecoder().decode(init.body), body);
    assert.equal(init.headers.get('authorization'), 'Bearer ' + sessionToken);
    assert.equal(init.headers.get('oai-sites-authorization'), 'Bearer ' + config.STUDIO_SITE_ACCESS_TOKEN);
    assert.equal(init.headers.get('x-cleanrooms-gateway-key'), config.MOBILE_GATEWAY_KEY);
    assert.equal(init.headers.get('x-cleanrooms-client-ip'), '2001:db8::1');
    assert.equal(init.headers.has('cookie'), false);
    assert.equal(init.headers.has('oai-authenticated-user-id'), false);
    assert.equal(init.headers.has('cf-connecting-ip'), false);
    return json({ ok: true }, 200, {
      'set-cookie': 'upstream-private-cookie=not-forwarded',
      'x-private-debug': 'upstream-private-header',
      'x-cleanrooms-gateway-key': config.MOBILE_GATEWAY_KEY,
    });
  });
  assert.equal(calls, 1); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(response.headers.has('x-private-debug'), false);
  assert.equal(response.headers.has('x-cleanrooms-gateway-key'), false);
  const returned = await response.text();
  assert.equal(returned, '{"ok":true}');
  for (const value of [config.MOBILE_GATEWAY_KEY, config.STUDIO_SITE_ACCESS_TOKEN, sessionToken]) {
    assert.equal(returned.includes(value), false);
    assert.equal(JSON.stringify([...response.headers]).includes(value), false);
  }
});

test('malformed employee authorization and client IP values are omitted, never promoted into server authority', async () => {
  for (const authorization of ['Basic dXNlcjpwYXNz', 'Bearer short', 'Bearer ' + 'x'.repeat(129), 'Bearer ' + 'x'.repeat(32) + '.suffix']) {
    let fetched = false;
    const response = await handleGatewayRequest(request({ headers: { authorization, 'cf-connecting-ip': 'not-an-ip' } }), config, async (_url, init) => {
      fetched = true;
      assert.equal(init.headers.has('authorization'), false);
      assert.equal(init.headers.has('x-cleanrooms-client-ip'), false);
      assert.equal(init.headers.get('x-cleanrooms-gateway-key'), config.MOBILE_GATEWAY_KEY);
      return json({ error: 'mobile_session_invalid' }, 401);
    });
    assert.equal(fetched, true); assert.equal(response.status, 401);
  }
});

test('unsupported routes, methods and content types never reach the upstream', async () => {
  for (const [options, status] of [
    [{ path: '/' }, 404], [{ path: '/api/mobile-auth/extra' }, 404],
    [{ path: '/api/mobile-auth?workspace=other' }, 404],
    [{ method: 'GET', body: null }, 405],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
  ]) {
    assert.equal((await handleGatewayRequest(request(options), config, noFetch)).status, status);
  }
});

test('empty and oversized bodies fail closed, including streams without a declared size', async () => {
  for (const options of [
    { body: null }, { body: '' }, { body: 'x'.repeat(64 * 1024 + 1) },
    { body: '{}', headers: { 'content-length': String(64 * 1024 + 1) } },
  ]) {
    assert.equal((await handleGatewayRequest(request(options), config, noFetch)).status, 400);
  }
  let cancelled = false;
  const oversized = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32 * 1024)); controller.enqueue(new Uint8Array(32 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  assert.equal((await handleGatewayRequest(request({ body: oversized }), config, noFetch)).status, 400);
  assert.equal(cancelled, true);
  const exact = new Uint8Array(64 * 1024);
  const accepted = await handleGatewayRequest(request({ body: exact }), config, async (_url, init) => {
    assert.equal(init.body.byteLength, exact.byteLength);
    return json({ ok: true });
  });
  assert.equal(accepted.status, 200);
});

test('untrusted upstream failures become generic unavailable responses without leaking its body or headers', async () => {
  for (const upstream of [
    () => new Response('upstream private HTML', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => json({ privateDetail: 'not-exposed' }, 404),
    () => json({ privateDetail: 'not-exposed' }, 500),
    () => json({ privateDetail: 'not-exposed' }, 503),
    () => new Response(null, { status: 302, headers: { location: 'https://different.example.test' } }),
    () => { throw new Error('upstream private transport detail'); },
  ]) {
    const response = await handleGatewayRequest(request(), config, upstream);
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('location'), false);
    assert.equal(await response.text(), '{"error":"mobile_unavailable","message":"Login er midlertidigt utilgængeligt. Prøv igen."}');
  }
  const rejected = await handleGatewayRequest(request(), config, () => json({ error: 'mobile_password_invalid' }, 401));
  assert.equal(rejected.status, 401);
  assert.deepEqual(await rejected.json(), { error: 'mobile_password_invalid' });
});
