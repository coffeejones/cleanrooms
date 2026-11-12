import { env } from 'cloudflare:workers';
import { chatGPTSignInPath } from '../chatgpt-auth';
import { createCompany, listCompanies } from '../../lib/company-signup-store.mjs';
import { StudioError } from '../../lib/studio-store.mjs';
import { principalFromRequest } from '../../lib/workspace-store.mjs';

export const dynamic = 'force-dynamic';

const route = '/virksomheder';
const maxFormBytes = 4096;
const requestIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

type Principal = ReturnType<typeof principalFromRequest>;
type Company = { id: string; name: string; role: string; isOwner: boolean };
type CompanyForm = { name: string; siteName: string; requestId: string };

const headers = {
  'Cache-Control': 'no-store, private',
  'Vary': 'oai-authenticated-user-id',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function companyURL(id: string) {
  return '/?virksomhed=' + encodeURIComponent(id);
}

function companyRole(company: Company) {
  if (company.isOwner) return 'Ejer';
  if (company.role === 'admin') return 'Administrator';
  if (company.role === 'planner') return 'Vagtplanlægger';
  return 'Medarbejder';
}

function companyList(companies: Company[]) {
  if (!companies.length) return '<p class="empty">Dine virksomheder vises her, når du har oprettet en virksomhed eller accepteret en invitation.</p>';
  return `<ul class="companies">${companies.map(company => `<li>
    <div class="company-copy"><strong>${escapeHTML(company.name)}</strong><span>${companyRole(company)}</span></div>
    <a class="button secondary" href="${companyURL(company.id)}" aria-label="Åbn ${escapeHTML(company.name)}">Åbn <span aria-hidden="true">→</span></a>
  </li>`).join('')}</ul>`;
}

function page({ principal, companies = [], input, error, status = 200 }: {
  principal?: Principal; companies?: Company[]; input?: Partial<CompanyForm>; error?: string; status?: number;
}) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const requestId = input?.requestId && requestIdPattern.test(input.requestId) ? input.requestId : crypto.randomUUID();
  const alert = error ? `<p class="error" role="alert">${escapeHTML(error)}</p>` : '';
  const identity = principal ? `<span class="identity">${escapeHTML(principal.name)}</span>` : '';
  const content = principal ? `<div class="layout">
    <section class="listing" aria-labelledby="your-companies">
      <h2 id="your-companies">Dine virksomheder</h2>
      ${companyList(companies)}
    </section>
    <section class="setup" aria-labelledby="create-company">
      <h2 id="create-company">Opret virksomhed</h2>
      <p>Gratis i betaperioden.</p>
      ${alert}
      <form method="post" action="${route}">
        <input type="hidden" name="requestId" value="${requestId}">
        <label for="company-name">Virksomhedens navn</label>
        <input id="company-name" name="name" type="text" value="${escapeHTML(input?.name ?? '')}" maxlength="120" autocomplete="organization" required>
        <label for="site-name">Første arbejdssted</label>
        <input id="site-name" name="siteName" type="text" value="${escapeHTML(input?.siteName ?? '')}" maxlength="120" placeholder="F.eks. Hovedkontoret" required>
        <button class="button primary" type="submit">Opret virksomhed <span aria-hidden="true">→</span></button>
      </form>
    </section>
  </div>` : `<section class="setup sign-in" aria-labelledby="sign-in">
    <h2 id="sign-in">Log ind</h2>
    <p>Log ind for at oprette din virksomhed gratis eller åbne en virksomhed, du har adgang til.</p>
    ${alert}
    <a class="button primary" href="${chatGPTSignInPath(route)}" target="_top">Log ind med ChatGPT <span aria-hidden="true">→</span></a>
  </section>`;
  const html = `<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Virksomheder · CleanRooms</title>
  <style nonce="${nonce}">
    :root{color-scheme:light;--ink:#20323b;--muted:#596a72;--edge:#d7e0e0;--accent:#00634f;--canvas:#f5f8f7}
    *{box-sizing:border-box}
    body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.55 "Avenir Next",Avenir,"Segoe UI",system-ui,sans-serif}
    .topbar{background:#fff;border-bottom:1px solid var(--edge)}
    .topbar-inner,main{width:min(100% - 40px,1000px);margin-inline:auto}
    .topbar-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:66px;padding-block:10px}
    .brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:700;letter-spacing:-.025em}
    .brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:#143e38;color:#fff;font-size:12px;font-weight:700;letter-spacing:.02em}
    .identity{font-size:14px;color:var(--muted);text-align:right;overflow-wrap:anywhere}
    main{padding-block:clamp(34px,7vw,72px)}
    h1,h2,p{margin:0}
    h1{margin-bottom:clamp(24px,4vw,36px);font-size:clamp(33px,5vw,46px);font-weight:700;letter-spacing:-.045em;line-height:1.1}
    h2{font-size:21px;line-height:1.25;letter-spacing:-.02em}
    .layout{display:grid;grid-template-columns:minmax(0,1.22fr) minmax(0,1fr);gap:28px;align-items:start}
    .listing,.setup{min-width:0;border:1px solid var(--edge);border-radius:12px;background:#fff}
    .listing h2{padding:23px 24px}
    .companies{margin:0;padding:0;list-style:none}
    .companies li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;border-top:1px solid var(--edge)}
    .company-copy{min-width:0;display:grid;gap:2px;overflow-wrap:anywhere}
    .company-copy span{font-size:13px;color:var(--muted)}
    .empty{padding:18px 24px 24px;border-top:1px solid var(--edge);color:var(--muted)}
    .setup{padding:23px 24px 24px}
    .setup>p{margin-top:8px;color:var(--muted)}
    form{display:grid;margin-top:24px}
    label{font-weight:600;margin-bottom:6px}
    input:not([type=hidden]){width:100%;min-width:0;min-height:44px;margin:0 0 16px;padding:8px 11px;border:1px solid #aebebf;border-radius:7px;color:var(--ink);background:#fff;font:inherit}
    input::placeholder{color:var(--muted)}
    .button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:42px;padding:8px 13px;border:1px solid transparent;border-radius:7px;text-decoration:none;white-space:nowrap;font:inherit;font-weight:600;cursor:pointer}
    .button.primary{background:var(--accent);color:#fff}
    .button.primary:hover{background:#004f3f}
    .button.secondary{border-color:var(--edge);background:#fff;color:var(--accent)}
    .button.secondary:hover{background:var(--canvas);border-color:#a4b9b6}
    form .button{justify-self:start;margin-top:4px}
    :is(input,button,a):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .setup>.error{margin-top:16px;padding:10px 12px;border-radius:7px;background:#fff1ee;color:#8a3022}
    .sign-in{max-width:465px}
    .sign-in .button{margin-top:18px}
    @media(max-width:660px){.layout{grid-template-columns:1fr;gap:18px}.companies li,.listing h2,.empty,.setup{padding-inline:18px}}
    @media(max-width:380px){.topbar-inner,main{width:calc(100% - 24px)}.brand{font-size:15px}.identity{font-size:12px}}
  </style>
</head>
<body>
  <header class="topbar"><div class="topbar-inner">
    <div class="brand"><span class="brand-mark" aria-hidden="true">CR</span><span>CleanRooms</span></div>${identity}
  </div></header>
  <main><h1>Virksomheder</h1>${content}</main>
</body>
</html>`;
  return new Response(html, { status, headers: {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  } });
}

function database() {
  if (!env.DB) throw new StudioError(503, 'storage_unavailable', 'Lagringen er midlertidigt utilgængelig.');
  return env.DB;
}

async function readForm(request: Request): Promise<CompanyForm> {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin !== new URL(request.url).origin || fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    throw new StudioError(403, 'same_origin_required', 'Åbn virksomhedssiden igen for at oprette en virksomhed.');
  }
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new StudioError(415, 'invalid_form', 'Brug formularen til at oprette en virksomhed.');
  }
  if (Number(request.headers.get('content-length')) > maxFormBytes) {
    throw new StudioError(413, 'form_too_large', 'Formularen indeholder for mange data.');
  }
  if (!request.body) throw new StudioError(400, 'invalid_form', 'Udfyld virksomhedens navn og arbejdssted.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = '', size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxFormBytes) {
        await reader.cancel();
        throw new StudioError(413, 'form_too_large', 'Formularen indeholder for mange data.');
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const form = new URLSearchParams(body + decoder.decode());
  const fields = ['name', 'siteName', 'requestId'];
  if (Array.from(form.keys()).some(key => !fields.includes(key)) || fields.some(key => form.getAll(key).length !== 1)) {
    throw new StudioError(400, 'invalid_form', 'Udfyld virksomhedens navn og arbejdssted.');
  }
  return { name: form.get('name')!, siteName: form.get('siteName')!, requestId: form.get('requestId')! };
}

function pageError(error: unknown) {
  if (error instanceof StudioError) return { error: error.message, status: error.status };
  console.error(JSON.stringify({ event: 'company_signup_failed', errorType: error instanceof Error ? error.name : 'Error' }));
  return { error: 'Virksomhedssiden kunne ikke åbnes. Prøv igen.', status: 500 };
}

export async function GET(request: Request) {
  let principal: Principal | undefined;
  try {
    principal = principalFromRequest(request);
    return page({ principal, companies: await listCompanies(database(), principal) });
  } catch (error) {
    if (error instanceof StudioError && error.status === 401) return page({});
    return page({ principal, ...pageError(error) });
  }
}

export async function POST(request: Request) {
  let principal: Principal | undefined;
  let input: CompanyForm | undefined;
  try {
    principal = principalFromRequest(request);
    input = await readForm(request);
    const company = await createCompany(database(), principal, input);
    return new Response(null, { status: 303, headers: { ...headers, Location: companyURL(company.id) } });
  } catch (error) {
    const companies = principal ? await Promise.resolve().then(() => listCompanies(database(), principal!)).catch(() => []) : [];
    return page({ principal, companies, input, ...pageError(error) });
  }
}
