const path = '/api/mobile-auth';
const pushPath = '/api/push-dispatch';
const maxBodyBytes = 64 * 1024;
const headers = {
  'Cache-Control': 'no-store, private',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function reply(error, message, status) {
  return Response.json({ error, message }, { status, headers });
}

const unavailable = () => reply('mobile_unavailable', 'Login er midlertidigt utilgængeligt. Prøv igen.', 503);

function studioEndpoint(env, pathname) {
  try {
    const origin = new URL(env.STUDIO_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null;
    return new URL(pathname, origin).href;
  } catch { return null; }
}

async function readSmallBody(request, limit = maxBodyBytes) {
  if (!request.body || Number(request.headers.get('content-length')) > limit) return null;
  const reader = request.body.getReader();
  const result = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return result.subarray(0, length);
      if (length + value.byteLength > limit) {
        await reader.cancel();
        return null;
      }
      result.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

async function route(request, env, requestStudio, requestId) {
  const url = new URL(request.url);
  if (url.pathname === pushPath) return wakePush(request, env, requestStudio, requestId);
  if (url.pathname !== path || url.search) return reply('not_found', 'Siden findes ikke.', 404);
  if (request.method !== 'POST') return reply('method_not_allowed', 'Brug CleanRooms-appen.', 405);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return reply('mobile_json_required', 'Send oplysningerne som JSON.', 415);
  }
  const studioUrl = studioEndpoint(env, path);
  if (!studioUrl || !/^[a-f0-9]{64}$/.test(env.MOBILE_GATEWAY_KEY ?? '') || !env.STUDIO_SITE_ACCESS_TOKEN) return unavailable();

  try {
    const body = await readSmallBody(request);
    if (!body?.length) return reply('mobile_body_invalid', 'Forespørgslen mangler eller er for stor.', 400);
    const upstreamHeaders = new Headers({
      'Content-Type': 'application/json',
      'OAI-Sites-Authorization': `Bearer ${env.STUDIO_SITE_ACCESS_TOKEN}`,
      'X-CleanRooms-Gateway-Key': env.MOBILE_GATEWAY_KEY,
      'X-Request-Id': requestId,
    });
    const authorization = request.headers.get('authorization');
    if (authorization && /^Bearer [A-Za-z0-9_-]{32,128}$/.test(authorization)) {
      upstreamHeaders.set('Authorization', authorization);
    }
    const ip = request.headers.get('cf-connecting-ip');
    if (ip && /^[0-9a-f:.]{3,45}$/i.test(ip)) upstreamHeaders.set('X-CleanRooms-Client-IP', ip);
    const upstream = await requestStudio(studioUrl, {
      method: 'POST', headers: upstreamHeaders, body, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    const type = upstream.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(type) || upstream.status === 404 || upstream.status >= 500) {
      return unavailable();
    }
    const responseHeaders = new Headers({ ...headers, 'Content-Type': 'application/json' });
    const retryAfter = upstream.headers.get('retry-after');
    if (upstream.status === 429 && /^\d{1,5}$/.test(retryAfter ?? '') && Number(retryAfter) > 0 && Number(retryAfter) <= 3600) {
      responseHeaders.set('Retry-After', retryAfter);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return unavailable();
  }
}

async function matchesPushKey(supplied, expected) {
  if (!/^[a-f0-9]{64}$/.test(supplied ?? '') || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false;
  // WebCrypto's HMAC verification performs the comparison without an early-exit
  // string loop. The random request-local key is never stored or transmitted.
  const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(supplied));
}

async function wakePush(request, env, requestStudio, requestId) {
  const url = new URL(request.url);
  if (url.search || !await matchesPushKey(request.headers.get('x-cleanrooms-push-key'), env.PUSH_DISPATCH_KEY)) return reply('not_found', 'Siden findes ikke.', 404);
  if (request.method !== 'POST') return reply('method_not_allowed', 'Brug POST.', 405);
  const studioUrl = studioEndpoint(env, pushPath);
  if (!studioUrl || !env.STUDIO_SITE_ACCESS_TOKEN) return unavailable();
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply('push_request_invalid', 'Send JSON.', 400);
  try {
    const body = await readSmallBody(request, 2048);
    if (!body || new TextDecoder().decode(body) !== '{}') return reply('push_request_invalid', 'Send en tom forespørgsel.', 400);
    const upstream = await requestStudio(studioUrl, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + env.STUDIO_SITE_ACCESS_TOKEN,
      'X-CleanRooms-Push-Key': env.PUSH_DISPATCH_KEY, 'X-Request-Id': requestId,
    }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    if (!upstream.ok || !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('content-type') ?? '')) return unavailable();
    const responseBody = await upstream.json();
    return responseBody?.ok === true ? Response.json({ ok: true }, { headers }) : unavailable();
  } catch { return unavailable(); }
}

export async function handleGatewayRequest(request, env, requestStudio = fetch) {
  const requestId = crypto.randomUUID(), startedAt = performance.now();
  const result = await route(request, env, requestStudio, requestId);
  result.headers.set('X-Request-Id', requestId);
  if (result.status >= 500) {
    // Intentionally omit URLs, authorization, bodies, email and location.
    console.warn(JSON.stringify({ event: 'mobile_gateway_failure', requestId, status: result.status,
      durationMs: Math.round(performance.now() - startedAt) }));
  }
  return result;
}

export default { fetch: (request, env) => handleGatewayRequest(request, env) };
