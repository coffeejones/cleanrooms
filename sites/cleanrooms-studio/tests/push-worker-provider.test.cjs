const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const sendUrl = 'https://exp.host/--/api/v2/push/send';
const receiptUrl = 'https://exp.host/--/api/v2/push/getReceipts';
const accessToken = 'synthetic-worker-provider-secret';

async function fixture(t) {
  const dispatcherPath = path.resolve(__dirname, '../lib/push-dispatch.mjs');
  const source = `import { providerJson } from ${JSON.stringify(dispatcherPath)};
    export default { async fetch(request) {
      const input = await request.json();
      try {
        if (input.oldRedirectMode) {
          await fetch(${JSON.stringify(sendUrl)}, { method: 'POST', body: '{}', redirect: 'error' });
          return Response.json({ unexpectedlyAccepted: true });
        }
        const result = await providerJson(fetch,
          input.receipt ? ${JSON.stringify(receiptUrl)} : ${JSON.stringify(sendUrl)},
          input.receipt ? { ids: ['fixture-ticket'] } : [{ to: 'ExpoPushToken[synthetic-worker-token-0123456789]' }], input.accessToken);
        return Response.json({ result });
      } catch (error) { return Response.json({ thrown: true, message: error.message }); }
    } };`;
  const bundle = await build({ stdin: { contents: source, resolveDir: path.resolve(__dirname, '..'), sourcefile: 'push-provider-worker.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*'], logLevel: 'silent' });
  const requests = [];
  let reply = () => Response.json({ data: [{ status: 'ok', id: 'fixture-ticket' }] });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-01', compatibilityFlags: ['nodejs_compat'],
    outboundService: async request => {
      requests.push({ url: request.url, method: request.method, authorization: request.headers.get('authorization'),
        contentType: request.headers.get('content-type'), accept: request.headers.get('accept'), body: await request.json() });
      return reply();
    } }));
  t.after(() => runtime.dispose());
  const call = async input => {
    const response = await runtime.dispatchFetch('https://worker.test/push-provider', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { requests, call, reply: next => { reply = next; } };
}

test('the real Worker rejects the former error redirect mode before making any provider request', async t => {
  const f = await fixture(t);
  const result = await f.call({ oldRedirectMode: true });
  assert.equal(result.thrown, true);
  assert.match(result.message, /Invalid redirect value.*follow.*manual/);
  assert.equal(f.requests.length, 0);
});

test('the actual provider helper sends and reads receipts through Worker fetch with server authorization', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.call({ accessToken }), { result: { body: { data: [{ status: 'ok', id: 'fixture-ticket' }] } } });
  f.reply(() => Response.json({ data: { 'fixture-ticket': { status: 'ok' } } }));
  assert.deepEqual(await f.call({ receipt: true, accessToken }), { result: { body: { data: { 'fixture-ticket': { status: 'ok' } } } } });
  assert.deepEqual(f.requests.map(request => request.url), [sendUrl, receiptUrl]);
  for (const request of f.requests) {
    assert.equal(request.method, 'POST');
    assert.equal(request.authorization, 'Bearer ' + accessToken);
    assert.equal(request.contentType, 'application/json');
    assert.equal(request.accept, 'application/json');
  }
  assert.deepEqual(f.requests[1].body, { ids: ['fixture-ticket'] });
});

test('Worker provider redirects are rejected without following or sending credentials to their target', async t => {
  const f = await fixture(t);
  const location = 'https://untrusted.example/collect?secret=never-copy-provider-data';
  for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
    f.reply(() => new Response(null, { status, headers: { Location: location } }));
    const before = f.requests.length;
    const result = await f.call({ accessToken });
    assert.deepEqual(result, { result: { error: 'provider_redirect' } });
    assert.equal(f.requests.length, before + 1, 'each redirect response makes exactly one Expo request');
    assert.equal(f.requests.at(-1).url, sendUrl);
    assert.doesNotMatch(JSON.stringify(result), /untrusted|never-copy-provider-data|synthetic-worker-provider-secret/);
  }
  assert.equal(f.requests.some(request => request.url.startsWith('https://untrusted.example/')), false);
});

test('invalid local authorization fails during Worker request construction and never reaches Expo', async t => {
  const f = await fixture(t);
  const result = await f.call({ accessToken: 'bad\nheader' });
  assert.deepEqual(result, { result: { error: 'provider_request_invalid' } });
  assert.equal(f.requests.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /bad|header|synthetic/);
});

test('an explicit transient provider response remains retryable in the actual Worker', async t => {
  const f = await fixture(t);
  for (const status of [429, 500, 503]) {
    f.reply(() => new Response(null, { status }));
    assert.deepEqual(await f.call({ accessToken }), { result: { retry: true } });
  }
  assert.equal(f.requests.length, 3);
});
