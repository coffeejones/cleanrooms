const path = '/api/mobile-auth';
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

async function readSmallBody(request) {
  if (!request.body || Number(request.headers.get('content-length')) > maxBodyBytes) return null;
  const reader = request.body.getReader();
  const result = new Uint8Array(maxBodyBytes);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return result.subarray(0, length);
      if (length + value.byteLength > maxBodyBytes) {
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

export async function handleGatewayRequest(request, env, requestStudio = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== path || url.search) return reply('not_found', 'Siden findes ikke.', 404);
  if (request.method !== 'POST') return reply('method_not_allowed', 'Brug CleanRooms-appen.', 405);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return reply('mobile_json_required', 'Send oplysningerne som JSON.', 415);
  }
  let studioUrl;
  try {
    const origin = new URL(env.STUDIO_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return unavailable();
    studioUrl = new URL(path, origin).href;
  } catch { return unavailable(); }
  if (!/^[a-f0-9]{64}$/.test(env.MOBILE_GATEWAY_KEY ?? '') || !env.STUDIO_SITE_ACCESS_TOKEN) return unavailable();

  try {
    const body = await readSmallBody(request);
    if (!body?.length) return reply('mobile_body_invalid', 'Forespørgslen mangler eller er for stor.', 400);
    const upstreamHeaders = new Headers({
      'Content-Type': 'application/json',
      'OAI-Sites-Authorization': `Bearer ${env.STUDIO_SITE_ACCESS_TOKEN}`,
      'X-CleanRooms-Gateway-Key': env.MOBILE_GATEWAY_KEY,
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
    return new Response(upstream.body, { status: upstream.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch {
    return unavailable();
  }
}

export default { fetch: (request, env) => handleGatewayRequest(request, env) };
