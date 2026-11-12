import {registerCompany, resolveCompanyPrincipal} from './company-signup-store.mjs';
import {StudioError} from './studio-store.mjs';
import {hasLegacyWorkspace, legacyWorkspaceId, optionalSitePrincipal} from './workspace-store.mjs';
import {
  attachDemoWebCredential, clearWebSessionCookie, hasWebSessionCookie,
  loginWeb, logoutWeb, readWebPrincipal, verifyWebCredential, webSessionCookie,
} from './web-auth-store.mjs';
import {webEntryPage} from './web-entry-page.mjs';

const loginFields = ['email', 'password'];
const signupFields = ['name', 'email', 'password', 'companyName', 'siteName', 'requestId'];
const maxFormBytes = 4096;
const studioPath = workspaceId => '/vagtplan?' + new URLSearchParams({virksomhed:workspaceId});

function requireDatabase(db) {
  if (!db) throw new StudioError(503, 'storage_unavailable', 'Lagringen er midlertidigt utilgængelig. Prøv igen.');
  return db;
}

function sameOrigin(request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    throw new StudioError(403, 'same_origin_required', 'Åbn forsiden igen, og prøv igen.');
  }
}

async function readForm(request, fields) {
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new StudioError(415, 'invalid_form', 'Brug formularen på forsiden.');
  }
  const tooLarge = () => new StudioError(413, 'form_too_large', 'Formularen indeholder for mange data.');
  if (Number(request.headers.get('content-length')) > maxFormBytes) throw tooLarge();
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = '', size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxFormBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      body += decoder.decode(value, {stream:true});
    }
  } finally {
    reader.releaseLock();
  }
  const form = new URLSearchParams(body + decoder.decode());
  if ([...form.keys()].some(key => !fields.includes(key)) || fields.some(key => form.getAll(key).length !== 1)) {
    throw new StudioError(400, 'invalid_form', 'Udfyld alle felter i formularen.');
  }
  return Object.fromEntries(fields.map(key => [key, form.get(key)]));
}

function redirect(location, cookie) {
  return new Response(null, {status:303, headers:{
    Location:location,
    'Cache-Control':'no-store, private',
    ...(cookie ? {'Set-Cookie':cookie} : {}),
  }});
}

async function sessionFor(request, db, site) {
  if (!hasWebSessionCookie(request)) return null;
  try {
    return await readWebPrincipal({db:requireDatabase(db), request, siteUserId:site?.userId});
  } catch (error) {
    if (error instanceof StudioError && error.status === 401) return null;
    throw error;
  }
}

function errorPage(error, options = {}) {
  if (error instanceof StudioError) {
    const page = webEntryPage({...options, status:error.status, error:error.message});
    if (error.retryAfterSeconds) page.headers.set('Retry-After', String(error.retryAfterSeconds));
    return page;
  }
  console.error(JSON.stringify({event:'web_entry_failed', errorType:error instanceof Error ? error.name : 'Error'}));
  return webEntryPage({...options, status:500, error:'CleanRooms kunne ikke gennemføre handlingen. Prøv igen.'});
}

export async function webHome(request, db) {
  const url = new URL(request.url);
  const view = url.searchParams.get('vis') === 'opret' ? 'signup' : 'login';
  try {
    const site = optionalSitePrincipal(request);
    const account = await sessionFor(request, db, site);
    if (site && !account && url.searchParams.has('virksomhed')) {
      return redirect(studioPath(url.searchParams.get('virksomhed')));
    }
    const legacyAccess = Boolean(db && site && !account && await hasLegacyWorkspace(db, site));
    const expired = !account && hasWebSessionCookie(request);
    const page = webEntryPage({view, account, legacyAccess, notice:expired ? 'Din session er udløbet. Log ind igen.' : ''});
    if (expired) page.headers.set('Set-Cookie', clearWebSessionCookie(request));
    return page;
  } catch (error) {
    return errorPage(error, {view});
  }
}

function testLoginConfig(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const config = JSON.parse(value);
    if (typeof config.email === 'string' && typeof config.siteEmail === 'string' &&
        /^[a-f0-9]{32}$/.test(config.password_salt) && /^[a-f0-9]{64}$/.test(config.password_hash)) return config;
  } catch { /* A missing or malformed configuration cannot enable test login. */ }
  return null;
}

async function attachConfiguredTestLogin({db, site, input, config}) {
  if (!config || site?.email !== config.siteEmail || input.email.trim().toLowerCase() !== config.email ||
      input.password.length < 6 || input.password.length > 128) return false;
  if (!await verifyWebCredential(config, input.password)) return false;
  await attachDemoWebCredential({db,principal:site,email:config.email,password:input.password});
  return true;
}

export async function webLogin(request, db, testLoginValue) {
  let values;
  try {
    sameOrigin(request);
    requireDatabase(db);
    const site = optionalSitePrincipal(request);
    if (await sessionFor(request, db, site)) return redirect('/vagtplan');
    const input = await readForm(request, loginFields);
    values = {email:input.email};
    const options = {
      db, ...input, siteUserId:site?.userId, ip:request.headers.get('cf-connecting-ip'),
    };
    let session;
    try {
      session = await loginWeb(options);
    } catch (error) {
      if (error?.code !== 'web_credentials_invalid' ||
          !await attachConfiguredTestLogin({db,site,input,config:testLoginConfig(testLoginValue)})) throw error;
      session = await loginWeb(options);
    }
    return redirect('/vagtplan', webSessionCookie(session.token, request));
  } catch (error) {
    return errorPage(error, {values});
  }
}

export async function webSignup(request, db, testLoginValue) {
  let values, requestId;
  try {
    sameOrigin(request);
    requireDatabase(db);
    const site = optionalSitePrincipal(request);
    if (await sessionFor(request, db, site)) return redirect('/vagtplan');
    const input = await readForm(request, signupFields);
    const {password, ...safeValues} = input;
    values = safeValues;
    requestId = input.requestId;
    if (input.email.trim().toLowerCase() === testLoginConfig(testLoginValue)?.email) {
      throw new StudioError(409, 'web_email_in_use', 'Der findes allerede et login til e-mailadressen.');
    }
    const ip = request.headers.get('cf-connecting-ip');
    await registerCompany(db, input, {ip});
    const {token} = await loginWeb({db,email:input.email,password,ip});
    return redirect('/vagtplan', webSessionCookie(token, request));
  } catch (error) {
    return errorPage(error, {view:'signup', values, requestId});
  }
}

export async function webLogout(request, db) {
  try {
    sameOrigin(request);
    if (hasWebSessionCookie(request)) await logoutWeb({db:requireDatabase(db),request});
    return redirect('/', clearWebSessionCookie(request));
  } catch (error) {
    return errorPage(error);
  }
}

export async function openWebStudio(request, db, document) {
  try {
    const site = optionalSitePrincipal(request);
    const workspaceId = new URL(request.url).searchParams.get('virksomhed');
    const account = await sessionFor(request, db, site);
    if (account) {
      if (workspaceId === null) return redirect(studioPath(account.workspaceId));
      return workspaceId === account.workspaceId ? document(request) : redirect('/');
    }
    if (hasWebSessionCookie(request)) return redirect('/', clearWebSessionCookie(request));
    if (site) {
      if (workspaceId !== null) {
        await resolveCompanyPrincipal(requireDatabase(db), site, workspaceId);
        return document(request);
      }
      const legacy = await legacyWorkspaceId(requireDatabase(db), site);
      if (legacy) return redirect(studioPath(legacy));
    }
    return redirect('/');
  } catch (error) {
    if (error instanceof StudioError && [400,401,403].includes(error.status)) return redirect('/');
    return errorPage(error);
  }
}
