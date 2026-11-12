const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
const requestIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const styles = `
  :root {
    color-scheme: light;
    --canvas: #f5f7f2;
    --paper: #fff;
    --ink: #172e27;
    --muted: #52645b;
    --line: #d9e2d9;
    --green: #1f5f49;
    --green-dark: #154533;
    --tint: #eaf1e8;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--ink); font: 16px/1.55 "Avenir Next", Avenir, system-ui, sans-serif; }
  h1, h2, p { margin: 0; }
  .topbar { background: var(--paper); border-bottom: 1px solid var(--line); }
  .topbar-inner, main { width: min(100% - 64px, 1160px); margin-inline: auto; }
  .topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 70px; }
  .brand { display: flex; align-items: center; gap: 11px; font-size: 19px; font-weight: 750; letter-spacing: -.025em; color: var(--ink); text-decoration: none; }
  .brand-mark { display: grid; place-items: center; width: 35px; height: 35px; border-radius: 9px; background: var(--ink); color: var(--paper); font-size: 12px; letter-spacing: .03em; }
  .topbar nav { display: flex; align-items: center; gap: 8px; }
  .topbar nav a { padding: 8px 13px; border-radius: 7px; color: var(--ink); font-size: 14px; font-weight: 600; text-decoration: none; }
  .topbar nav a:hover { background: var(--tint); }
  .topbar nav .nav-cta { border: 1px solid var(--line); color: var(--green-dark); }
  main { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(340px, 1fr); grid-template-areas: "intro account" "preview account"; align-items: start; column-gap: clamp(32px, 7vw, 104px); row-gap: 32px; padding-block: clamp(48px, 8vw, 108px); }
  .intro { grid-area: intro; padding-top: 8px; }
  h1 { font-size: clamp(45px, 6.25vw, 84px); font-weight: 740; line-height: 1.02; letter-spacing: -.063em; }
  h1 span { color: var(--green); }
  .intro p { max-width: 470px; margin-top: 22px; color: var(--muted); font-size: clamp(17px, 1.7vw, 20px); }
  .schedule { grid-area: preview; min-width: 0; overflow: hidden; padding: 15px; border: 1px solid #cfdcce; border-radius: 13px; background: #e9efe5; }
  .schedule-card { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
  .schedule-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 15px; border-bottom: 1px solid var(--line); font-size: 13px; }
  .schedule-heading strong { font-size: 14px; }
  .schedule-heading span { color: var(--muted); font-size: 12px; }
  .schedule-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .schedule-day { min-width: 0; min-height: 124px; padding: 6px; border-right: 1px solid #ebefeb; }
  .schedule-day:last-child { border-right: 0; }
  .day-label { display: block; margin: 1px 3px 8px; color: var(--muted); font-size: 10px; font-weight: 650; }
  .shift { display: grid; gap: 1px; padding: 5px 6px; border-left: 2px solid #6c9a82; border-radius: 4px; background: #e9f1e9; color: #224536; font-size: 10px; line-height: 1.4; white-space: nowrap; }
  .shift + .shift { margin-top: 5px; }
  .shift strong, .shift span { overflow: hidden; text-overflow: ellipsis; }
  .shift span { font-size: 9px; }
  .shift.warm { border-color: #b6965c; background: #f4eedf; color: #564521; }
  .account { grid-area: account; min-width: 0; border: 1px solid var(--line); border-radius: 15px; background: var(--paper); box-shadow: 0 12px 36px rgb(29 55 43 / 7%); }
  .account-nav { display: grid; grid-template-columns: 1fr 1.25fr; gap: 4px; margin: 17px 17px 0; padding: 4px; border-radius: 9px; background: #eff3ee; }
  .account-nav a { display: grid; min-height: 38px; place-items: center; padding: 5px 8px; border-radius: 6px; color: var(--muted); font-size: 14px; font-weight: 650; text-align: center; text-decoration: none; }
  .account-nav a:hover { color: var(--green-dark); }
  .account-nav a[aria-current="page"] { background: var(--paper); color: var(--ink); box-shadow: 0 1px 2px rgb(29 55 43 / 13%); }
  .account-body { padding: 25px 26px 27px; }
  .account-body h2 { font-size: 26px; font-weight: 725; line-height: 1.17; letter-spacing: -.03em; }
  .account-copy { margin-top: 7px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
  .message { margin-top: 16px; padding: 10px 12px; border-radius: 7px; background: var(--tint); color: var(--ink); font-size: 14px; overflow-wrap: anywhere; }
  .message.error { border: 1px solid #f1d5ce; background: #fdf1ed; color: #862f24; }
  .account-form { display: grid; gap: 15px; margin-top: 20px; }
  .field { min-width: 0; display: grid; gap: 5px; }
  .field label { font-size: 13px; font-weight: 700; }
  .field small { color: var(--muted); font-size: 12px; }
  input { min-width: 0; width: 100%; min-height: 43px; padding: 8px 11px; border: 1px solid #adbeb2; border-radius: 7px; background: var(--paper); color: var(--ink); font: inherit; }
  input::placeholder { color: var(--muted); }
  .button { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 45px; padding: 8px 13px; border: 1px solid transparent; border-radius: 7px; background: var(--green); color: var(--paper); font: inherit; font-size: 14px; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; }
  .button:hover { background: var(--green-dark); }
  :is(a, button, input):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
  .account-actions { display: grid; gap: 10px; margin-top: 20px; }
  .plain-button { width: 100%; min-height: 39px; border: 0; border-radius: 7px; background: none; color: var(--green-dark); font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
  .plain-button:hover { background: var(--tint); }
  .legacy-link { display: inline-block; margin-top: 18px; color: var(--green-dark); font-size: 14px; }
  @media (max-width: 810px) {
    .topbar-inner, main { width: min(100% - 40px, 580px); }
    main { grid-template-columns: minmax(0, 1fr); grid-template-areas: "intro" "account" "preview"; padding-block: 36px; gap: 24px; }
    .intro { padding: 0; }
    h1 { font-size: clamp(40px, 9.5vw, 68px); }
    .intro p { margin-top: 15px; }
  }
  @media (max-width: 410px) {
    .topbar-inner, main { width: calc(100% - 28px); }
    .topbar-inner { min-height: 61px; gap: 8px; }
    .brand { gap: 7px; font-size: 17px; }
    .brand-mark { width: 29px; height: 29px; }
    .topbar nav { gap: 2px; }
    .topbar nav a { padding-inline: 7px; font-size: 12px; }
    .account-body { padding: 21px 18px; }
    .schedule { padding: 8px; }
    .schedule-day { padding-inline: 4px; }
    .shift { padding-inline: 3px; }
  }
`;

const previewDays = [
  ['Man 12', [['Maja', '08–14'], ['Noah', '14–18', true]]],
  ['Tir 13', [['Emil', '08–14']]],
  ['Ons 14', [['Maja', '08–14'], ['Asta', '14–18', true]]],
  ['Tor 15', [['Emil', '08–14'], ['Noah', '14–18', true]]],
  ['Fre 16', [['Maja', '08–14']]],
];

function schedulePreview() {
  const days = previewDays.map(([day, shifts]) => `
    <div class="schedule-day">
      <span class="day-label">${day}</span>
      ${shifts.map(([name, time, evening]) => `
        <div class="shift${evening ? ' warm' : ''}"><strong>${name}</strong><span>${time}</span></div>`).join('')}
    </div>`).join('');
  return `<div class="schedule" aria-hidden="true">
    <div class="schedule-card">
      <div class="schedule-heading"><strong>Vagtplan</strong><span>Uge 42</span></div>
      <div class="schedule-grid">${days}</div>
    </div>
  </div>`;
}

function accountForm(view, values, requestId) {
  const signup = view === 'signup';
  const companyFields = signup ? `
    <input type="hidden" name="requestId" value="${requestId}">
    <div class="field">
      <label for="company-name">Virksomhedens navn</label>
      <input id="company-name" name="companyName" autocomplete="organization" maxlength="120" value="${escapeHTML(values.companyName)}" required>
    </div>
    <div class="field">
      <label for="site-name">Første arbejdssted</label>
      <input id="site-name" name="siteName" maxlength="120" value="${escapeHTML(values.siteName)}" placeholder="Hovedkontoret" required>
    </div>
    <div class="field">
      <label for="account-name">Dit navn</label>
      <input id="account-name" name="name" autocomplete="name" maxlength="120" value="${escapeHTML(values.name)}" required>
    </div>` : '';

  return `<form class="account-form" method="post" action="${signup ? '/opret' : '/login'}">
    ${companyFields}
    <div class="field">
      <label for="account-email">E-mail</label>
      <input id="account-email" name="email" type="email" autocomplete="${signup ? 'email' : 'username'}" maxlength="320" value="${escapeHTML(values.email)}" required>
    </div>
    <div class="field">
      <label for="account-password">Adgangskode</label>
      <input id="account-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="128"${signup ? ' minlength="12" aria-describedby="password-help"' : ''} required>
      ${signup ? '<small id="password-help">Mindst 12 tegn.</small>' : ''}
    </div>
    <button class="button" type="submit">${signup ? 'Opret virksomhed' : 'Log ind'} <span aria-hidden="true">→</span></button>
  </form>`;
}

export function webEntryPage({ view = 'login', status = 200, error = '', values = {}, requestId, account = null, legacyAccess = false, notice = '' } = {}) {
  const signup = view === 'signup';
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const signupId = requestIdPattern.test(requestId ?? '') ? requestId : crypto.randomUUID();
  const messages = [
    error ? `<p class="message error" role="alert">${escapeHTML(error)}</p>` : '',
    notice ? `<p class="message" role="status">${escapeHTML(notice)}</p>` : '',
  ].join('');
  const entry = account ? `
    <div class="account-body">
      <h2 id="account-title">Din vagtplan</h2>
      ${account.name ? `<p class="account-copy">Du er logget ind som ${escapeHTML(account.name)}.</p>` : ''}
      ${messages}
      <div class="account-actions">
        <a class="button" href="/vagtplan">Åbn vagtplanen <span aria-hidden="true">→</span></a>
        <form method="post" action="/log-ud"><button class="plain-button" type="submit">Log ud</button></form>
      </div>
    </div>` : `
    <nav class="account-nav" aria-label="Adgang til CleanRooms">
      <a href="/#konto"${signup ? '' : ' aria-current="page"'}>Log ind</a>
      <a href="/?vis=opret#konto"${signup ? ' aria-current="page"' : ''}>Opret virksomhed</a>
    </nav>
    <div class="account-body">
      <h2 id="account-title">${signup ? 'Opret din virksomhed' : 'Velkommen tilbage'}</h2>
      <p class="account-copy">${signup ? 'Gratis i betaperioden.' : 'Log ind for at åbne din virksomheds vagtplan.'}</p>
      ${messages}
      ${accountForm(view, values, signupId)}
      ${legacyAccess ? '<a class="legacy-link" href="/vagtplan">Åbn eksisterende vagtplan</a>' : ''}
    </div>`;

  const html = `<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Planlæg faste vagtserier, og giv medarbejderne adgang til deres vagter i CleanRooms-appen.">
  <title>CleanRooms · Vagtplanlægning</title>
  <style nonce="${nonce}">${styles}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">CR</span> CleanRooms</a>
      ${account ? '<nav aria-label="Navigation"><a href="/vagtplan">Vagtplan</a></nav>' : `
      <nav aria-label="Navigation">
        <a href="/#konto">Log ind</a>
        <a class="nav-cta" href="/?vis=opret#konto">Opret virksomhed</a>
      </nav>`}
    </div>
  </header>
  <main>
    <div class="intro">
      <h1>Vagtplanen<br><span>på plads.</span></h1>
      <p>Læg faste vagter flere måneder frem, ret hele serier på én gang, og giv medarbejderne deres vagter direkte i appen.</p>
    </div>
    <section class="account" id="konto" aria-labelledby="account-title">${entry}</section>
    ${schedulePreview()}
  </main>
</body>
</html>`;

  return new Response(html, { status, headers: {
    'Cache-Control': 'no-store, private',
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  } });
}
