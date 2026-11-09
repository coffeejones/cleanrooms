const test = require('node:test'), assert = require('node:assert/strict');
const { handleGatewayRequest } = require('../../cleanrooms-app-api/worker/index.js');
const key = 'a'.repeat(64), env = { STUDIO_ORIGIN: 'https://studio.test', MOBILE_GATEWAY_KEY: key, STUDIO_SITE_ACCESS_TOKEN: 'fixture-gate' };
const request = () => new Request('https://app-api.test/api/mobile-auth', { method: 'POST', headers: {
  'content-type': 'application/json', authorization: 'Bearer ' + 'x'.repeat(43),
  'oai-authenticated-user-id': 'forged', 'x-cleanrooms-gateway-key': 'forged', 'x-request-id': 'forged',
}, body: JSON.stringify({ action: 'employeeInbox', cursor: null, limit: 50 }) });
test('gateway relays bounded rate-limit hints and creates a diagnostic ID without forwarding client identity', async () => {
  let observed;
  const response = await handleGatewayRequest(request(), env, async (_url, options) => {
    observed = options.headers;
    return Response.json({ error: 'mobile_request_rate_limited' }, { status: 429, headers: { 'Retry-After': '15', 'Set-Cookie': 'must-not-relay', 'X-Request-Id': 'upstream-forgery' } });
  });
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '15');
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(observed.get('oai-authenticated-user-id'), null);
  assert.equal(observed.get('x-cleanrooms-gateway-key'), key);
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/); assert.equal(response.headers.get('x-request-id'), observed.get('x-request-id'));
});
test('gateway discards invalid and excessive Retry-After values', async () => {
  for (const retry of ['999999999', '-1', 'bad', '0']) {
    const response = await handleGatewayRequest(request(), env, async () => Response.json({}, { status: 429, headers: { 'Retry-After': retry } }));
    assert.equal(response.headers.get('retry-after'), null);
  }
});

test('gateway preserves an authenticated API not-found without exposing framework or Site gate failures', async () => {
  for (const marker of ['matching', 'missing', 'forged']) {
    const response = await handleGatewayRequest(request(), env, async (_url, options) => Response.json({ error: 'mobile_inbox_not_found' }, {
      status: 404, headers: marker === 'matching' ? { 'X-Request-Id': options.headers.get('x-request-id') } : marker === 'forged' ? { 'X-Request-Id': 'forged' } : {},
    }));
    assert.equal(response.status, marker === 'matching' ? 404 : 503);
    assert.equal((await response.json()).error, marker === 'matching' ? 'mobile_inbox_not_found' : 'mobile_unavailable');
  }
  const html = await handleGatewayRequest(request(), env, async (_url, options) => new Response('<h1>Site gate</h1>', {
    status: 404, headers: { 'Content-Type': 'text/html', 'X-Request-Id': options.headers.get('x-request-id') },
  }));
  assert.equal(html.status, 503);
  assert.equal((await html.json()).error, 'mobile_unavailable');
});
