import Directory from '../src/directory-records.js';

const encoder = new TextEncoder();
const curve = { name: 'ECDH', namedCurve: 'P-256' };
const routePath = '/mobile-gps';
const callbackPath = 'cleanrooms://gps-return';
const allowedParams = new Set(['v', 'state', 'key', 'site', 'workspace']);
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => entities[character]);

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function parseBase64Url(value, byteLength) {
  if (typeof value !== 'string' || value.length !== Math.ceil(byteLength * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  return bytes.length === byteLength && encodeBase64Url(bytes) === value ? bytes : null;
}

function parseRequest(request) {
  const { searchParams } = new URL(request.url);
  if ([...searchParams.keys()].some(key => !allowedParams.has(key) || searchParams.getAll(key).length !== 1) || searchParams.get('v') !== '1') return null;
  const state = searchParams.get('state'), key = searchParams.get('key');
  const siteId = searchParams.get('site'), workspaceId = searchParams.get('workspace');
  const keyBytes = parseBase64Url(key, 65);
  if (!parseBase64Url(state, 32) || keyBytes?.[0] !== 4 || (siteId !== null && !Directory.validId('site', siteId))) return null;
  if (workspaceId !== null && (siteId === null || !Directory.validId('workspace', workspaceId))) return null;
  return { state, key, keyBytes, siteId, workspaceId };
}

function handoffPath(parameters, siteId) {
  const query = new URLSearchParams({ v: '1', state: parameters.state, key: parameters.key });
  if (siteId !== null) query.set('site', siteId);
  if (parameters.workspaceId !== null) query.set('workspace', parameters.workspaceId);
  return `${routePath}?${query}`;
}

async function sealCallback(publicKey, message) {
  const server = await crypto.subtle.generateKey(curve, false, ['deriveBits']);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, server.privateKey, 256);
  const digest = await crypto.subtle.digest('SHA-256', shared);
  const aes = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, encoder.encode(JSON.stringify(message)));
  const key = await crypto.subtle.exportKey('raw', server.publicKey);
  const query = new URLSearchParams({ v: '1', key: encodeBase64Url(new Uint8Array(key)), iv: encodeBase64Url(iv), data: encodeBase64Url(new Uint8Array(data)) });
  return `${callbackPath}?${query}`;
}

function page(status, title, body) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · CleanRooms</title>
  <style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;padding:32px 20px;background:#f5f6f7;color:#222c32;font:16px/1.55 system-ui,sans-serif}main{max-width:32rem;margin:5vh auto;background:white;padding:24px;border:1px solid #dce1e4;border-radius:8px}h1{font-size:24px;line-height:1.25;margin:0 0 12px}p{margin:0 0 16px}ul{list-style:none;padding:0;margin:0}li+li{border-top:1px solid #e1e5e8}.site{display:block;padding:12px 0;color:#263840;overflow-wrap:anywhere}.button{display:inline-block;padding:10px 16px;background:#293941;color:white;border-radius:5px;text-decoration:none}a:focus-visible{outline:2px solid #1c6090;outline-offset:4px}</style></head>
  <body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Vary': 'oai-authenticated-user-id',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  } });
}

export async function renderMobileGpsHandoff(request, { readWorkplaces, signInPath }) {
  const parameters = parseRequest(request);
  const invalid = () => page(400, 'Ugyldig forbindelse', '<p>Start forbindelsen igen fra CleanRooms-appen.</p>');
  if (!parameters) return invalid();

  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey('raw', parameters.keyBytes, curve, false, []);
  } catch {
    return invalid();
  }

  try {
    const result = await readWorkplaces(parameters.siteId, parameters.workspaceId);
    if (parameters.siteId === null) {
      const options = result.sites.map(site => `<li><a class="site" href="${escapeHtml(handoffPath(parameters, site.id))}">${escapeHtml(site.name)}</a></li>`).join('');
      return page(200, 'Vælg arbejdssted', options ? `<p>Vælg hvilket arbejdssted i CleanRooms Studio, appen skal hente GPS-indstillingerne fra.</p><ul>${options}</ul>` : '<p>Der er ingen arbejdssteder i CleanRooms Studio endnu.</p>');
    }

    const callback = await sealCallback(publicKey, { v: 1, state: parameters.state, site: result.site, gps: result.gps, issuedAt: Date.now() });
    return page(200, 'Åbn CleanRooms', `<p>Fortsæt i appen med GPS-indstillingerne for <strong>${escapeHtml(result.site.name)}</strong>.</p><a class="button" href="${escapeHtml(callback)}">Tilbage til appen</a>`);
  } catch (error) {
    if (error?.status === 401 && error.code === 'authentication_required') {
      const signIn = signInPath(handoffPath(parameters, parameters.siteId));
      return page(401, 'Log ind i CleanRooms', `<p>Log ind med din administratorkonto for at hente GPS-indstillingerne.</p><a class="button" target="_top" href="${escapeHtml(signIn)}">Log ind med ChatGPT</a>`);
    }
    if (typeof error?.code === 'string' && error.code.startsWith('mobile_gps_')) {
      return page(error.status, 'Forbindelsen kunne ikke oprettes', `<p>${escapeHtml(error.message)}</p>`);
    }
    return page(503, 'Forbindelsen kunne ikke oprettes', '<p>GPS-indstillingerne kunne ikke hentes. Gå tilbage til CleanRooms-appen, og prøv igen.</p>');
  }
}
