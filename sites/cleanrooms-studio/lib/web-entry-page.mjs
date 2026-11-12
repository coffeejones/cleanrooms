const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
const requestIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const styles = `
  :root {
    color-scheme: light;
    --paper: #fbfbf6;
    --white: #fff;
    --ink: #172820;
    --muted: #4c6055;
    --line: #d8e0d7;
    --green: #255b46;
    --green-dark: #1b4735;
    --tint: #e8efe5;
    font-family: "Avenir Next", Avenir, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-size: 16px; line-height: 1.6; }
  h1, h2, p, figure { margin: 0; }
  a { color: inherit; }
  img { display: block; width: 100%; height: auto; }
  .wrap { width: min(100% - 80px, 1200px); margin-inline: auto; }
  .topbar { background: var(--paper); border-bottom: 1px solid var(--line); }
  .topbar-inner { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .brand { display: inline-flex; align-items: center; gap: 11px; color: var(--ink); font-size: 20px; font-weight: 750; letter-spacing: -.035em; text-decoration: none; }
  .brand-mark { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 9px; background: var(--green-dark); color: var(--white); font-size: 13px; letter-spacing: .01em; }
  .topbar nav { display: flex; align-items: center; gap: clamp(8px, 2.5vw, 30px); }
  .topbar nav > a:not(.button) { padding: 8px 0; font-size: 14px; font-weight: 650; text-decoration: none; }
  .topbar nav > a:not(.button):hover { text-decoration: underline; text-underline-offset: 4px; }
  .hero { padding-block: clamp(44px, 6vw, 88px) 34px; }
  .hero-intro { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(270px, .7fr); align-items: end; gap: clamp(24px, 5vw, 72px); margin-bottom: clamp(30px, 4vw, 56px); }
  h1, .feature-copy h2, .access-copy h2 { text-wrap: balance; font-weight: 750; letter-spacing: -.055em; line-height: 1.05; }
  h1 { font-size: clamp(53px, 6.5vw, 96px); }
  h1 span { display: block; color: var(--green); }
  .hero-copy p, .feature-copy p, .access-copy p { color: var(--muted); font-size: clamp(17px, 1.65vw, 21px); }
  .hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 22px; margin-top: 22px; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 12px; min-height: 47px; padding: 9px 17px; border: 1px solid transparent; border-radius: 8px; background: var(--green); color: var(--white); font: inherit; font-size: 14px; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; }
  .button:hover { background: var(--green-dark); }
  .topbar .button { min-height: 40px; padding: 6px 13px; }
  .text-action { color: var(--green-dark); font-size: 14px; font-weight: 700; text-decoration-thickness: 1px; text-underline-offset: 4px; }
  .text-action:hover { color: var(--ink); }
  .product-frame { padding: clamp(10px, 2vw, 24px); border: 1px solid #d1dfd0; border-radius: 18px; background: #dfe9dc; }
  .product-window { overflow: hidden; border: 1px solid #cbd7cc; border-radius: 10px; background: var(--white); box-shadow: 0 16px 32px rgb(23 40 32 / 12%); }
  .hero-window { aspect-ratio: 2.28; }
  .hero-window img { width: 100%; }
  figcaption { margin-top: 9px; color: var(--muted); font-size: 13px; }
  .features { padding-block: clamp(48px, 7vw, 102px); border-top: 1px solid var(--line); }
  .feature { display: grid; grid-template-columns: minmax(0, .83fr) minmax(0, 1.17fr); align-items: center; gap: clamp(28px, 6vw, 100px); }
  .feature + .feature { margin-top: clamp(56px, 9vw, 120px); }
  .feature-copy h2, .access-copy h2 { font-size: clamp(34px, 4.2vw, 61px); }
  .feature-copy p, .access-copy p { max-width: 480px; margin-top: 17px; }
  .feature-copy p + p { margin-top: 12px; }
  .series-window { box-shadow: 0 16px 30px rgb(23 40 32 / 8%); }
  .phone-feature { grid-template-columns: minmax(0, 1.17fr) minmax(0, .83fr); }
  .phone-visual { display: grid; place-items: end center; min-height: 380px; padding: 36px 24px 0; overflow: hidden; border: 1px solid #d0dbd1; border-radius: 17px; background: var(--tint); }
  .phone-screen { width: min(100%, 292px); height: 340px; overflow: hidden; border: 8px solid #21352a; border-bottom: 0; border-radius: 25px 25px 0 0; box-shadow: 0 16px 36px rgb(23 40 32 / 17%); background: #f3f5f4; }
  .phone-screen img { margin-top: -29%; }
  .access { padding-block: clamp(44px, 7vw, 92px); border-top: 1px solid var(--line); background: var(--tint); scroll-margin-top: 16px; }
  .access-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .78fr); align-items: start; gap: clamp(24px, 8vw, 120px); }
  .access-copy { padding-top: clamp(10px, 3vw, 44px); }
  .access-focused .access { border-top: 0; }
  .access-focused .hero { border-top: 1px solid var(--line); }
  .account { min-width: 0; border: 1px solid var(--line); border-radius: 15px; background: var(--white); box-shadow: 0 14px 36px rgb(23 40 32 / 9%); }
  .account-nav { display: grid; grid-template-columns: 1fr 1.25fr; gap: 4px; margin: 17px 17px 0; padding: 4px; border-radius: 9px; background: #eff3ee; }
  .account-nav a { display: grid; min-height: 38px; place-items: center; padding: 5px 8px; border-radius: 6px; color: var(--muted); font-size: 14px; font-weight: 650; text-align: center; text-decoration: none; }
  .account-nav a:hover { color: var(--green-dark); }
  .account-nav a[aria-current="page"] { background: var(--white); color: var(--ink); box-shadow: 0 1px 2px rgb(29 55 43 / 13%); }
  .account-body { padding: 26px; }
  .account-body h2 { font-size: 26px; font-weight: 725; line-height: 1.17; letter-spacing: -.03em; }
  .account-copy { margin-top: 7px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
  .message { margin-top: 16px; padding: 10px 12px; border-radius: 7px; background: var(--tint); font-size: 14px; overflow-wrap: anywhere; }
  .message.error { border: 1px solid #f1d5ce; background: #fdf1ed; color: #862f24; }
  .account-form { display: grid; gap: 15px; margin-top: 20px; }
  .field { min-width: 0; display: grid; gap: 5px; }
  .field label { font-size: 13px; font-weight: 700; }
  .field small { color: var(--muted); font-size: 12px; }
  input { min-width: 0; width: 100%; min-height: 44px; padding: 8px 11px; border: 1px solid #adbeb2; border-radius: 7px; background: var(--white); color: var(--ink); font: inherit; }
  input::placeholder { color: var(--muted); }
  :is(a, button, input):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
  .account-actions { display: grid; gap: 10px; margin-top: 20px; }
  .account-actions .button { width: 100%; }
  .plain-button { width: 100%; min-height: 40px; border: 0; border-radius: 7px; background: none; color: var(--green-dark); font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
  .plain-button:hover { background: var(--tint); }
  .legacy-link { display: inline-block; margin-top: 18px; color: var(--green-dark); font-size: 14px; text-underline-offset: 3px; }
  footer { border-top: 1px solid var(--line); }
  .footer-inner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; padding-block: 25px; color: var(--muted); font-size: 14px; }
  @media (max-width: 900px) {
    .wrap { width: min(100% - 48px, 680px); }
    .hero-intro, .feature, .access-layout { grid-template-columns: 1fr; gap: 24px; }
    .hero-intro { align-items: start; }
    .hero-copy p { max-width: 580px; }
    .hero-window { aspect-ratio: 1.82; }
    .phone-visual { order: 2; min-height: 330px; }
    .phone-screen { height: 296px; }
    .access-copy { padding-top: 0; }
  }
  @media (max-width: 520px) {
    .wrap { width: calc(100% - 36px); }
    .topbar-inner { min-height: 62px; gap: 10px; }
    .brand { gap: 7px; font-size: 16px; }
    .brand-mark { width: 29px; height: 29px; font-size: 11px; }
    .topbar nav { gap: 12px; }
    .topbar nav > a, .topbar .button { font-size: 12px; }
    .topbar .button { min-height: 36px; padding-inline: 8px; }
    .topbar .product-link { display: none; }
    h1 { font-size: clamp(37px, 10vw, 52px); }
    .hero-window { aspect-ratio: 1.6; }
    .hero-window img { width: 138%; max-width: none; margin-left: -25%; }
    .account-body { padding: 22px 20px; }
  }
`;

function productOverview() {
  return `<div class="features" id="produkt">
    <section class="feature wrap" aria-labelledby="series-title">
      <div class="feature-copy">
        <h2 id="series-title">Ret faste vagter samlet</h2>
        <p>Vælg arbejdsdage og tider, og lad vagten gentage sig hver uge eller hver anden uge. Når tiderne ændrer sig, kan du rette hele vagtserien på én gang.</p>
        <p>Se datoerne i kalenderen, før du gemmer.</p>
      </div>
      <figure>
        <div class="product-window series-window"><img src="/produkt/vagtserie.png" width="1280" height="720" loading="lazy" alt="CleanRooms’ vagtserieeditor med valgte arbejdsdage og forhåndsvisning af de kommende vagter"></div>
        <figcaption>Vagtserieeditoren med eksempeldata.</figcaption>
      </figure>
    </section>
    <section class="feature phone-feature wrap" aria-labelledby="hours-title">
      <figure class="phone-visual">
        <div class="phone-screen"><img src="/produkt/timer.png" width="1206" height="2622" loading="lazy" alt="Medarbejderappens oversigt over registrerede og godkendte timer med eksempeldata"></div>
      </figure>
      <div class="feature-copy">
        <h2 id="hours-title">Fra udgivet vagt til godkendte timer</h2>
        <p>Medarbejderen ser sine vagter og ændringer på telefonen og stempler ind og ud. Planlæggeren gennemgår og godkender timerne på web, så de kan bruges som løngrundlag.</p>
      </div>
    </section>
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

  const accessFocused = Boolean(error || notice);
  const accessSection = `<section class="access" id="konto" aria-labelledby="account-title">
      <div class="access-layout wrap">
        <div class="access-copy">
          <h2>${account ? 'Din virksomhed i CleanRooms' : 'Din første vagtplan starter her'}</h2>
          ${account ? '' : '<p>Opret din virksomhed og dit første arbejdssted. Derefter kan du tilføje medarbejdere og lægge de første vagter. Det er gratis i betaperioden.</p>'}
        </div>
        <div class="account">${entry}</div>
      </div>
    </section>`;
  const primary = account
    ? '<a class="button" href="/vagtplan">Åbn vagtplanen <span aria-hidden="true">→</span></a>'
    : '<a class="button" href="/?vis=opret#konto">Opret virksomhed <span aria-hidden="true">→</span></a>';
  const html = `<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Planlæg faste vagtserier flere måneder frem, ret vagterne samlet, og giv medarbejderne deres vagtplan i appen.">
  <title>CleanRooms · Vagtplanlægning</title>
  <style nonce="${nonce}">${styles}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner wrap">
      <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">CR</span> CleanRooms</a>
      <nav aria-label="Navigation">
        <a class="product-link" href="#produkt">Produkt</a>
        ${account
          ? '<a href="#konto">Min konto</a><a class="button" href="/vagtplan">Åbn vagtplanen</a>'
          : '<a href="/#konto">Log ind</a><a class="button" href="/?vis=opret#konto">Opret virksomhed</a>'}
      </nav>
    </div>
  </header>
  <main${accessFocused ? ' class="access-focused"' : ''}>
    ${accessFocused ? accessSection : ''}
    <section class="hero" aria-labelledby="hero-title">
      <div class="wrap">
        <div class="hero-intro">
          <h1 id="hero-title">Planlæg faste <span>vagter én gang.</span></h1>
          <div class="hero-copy">
            <p>Læg vagtplanen måneder frem, ret hele vagtserier samlet, og giv medarbejderne deres vagter direkte i appen.</p>
            <div class="hero-actions">
              ${primary}
              <a class="text-action" href="#produkt">Se produktet</a>
            </div>
          </div>
        </div>
        <figure>
          <div class="product-frame">
            <div class="product-window hero-window">
              <img src="/produkt/vagtplan.png" width="1280" height="720" fetchpriority="high" alt="CleanRooms-vagtplanen med ugevisning, arbejdssteder og en ledig vagt">
            </div>
          </div>
          <figcaption>Vagtplanen vist med eksempeldata.</figcaption>
        </figure>
      </div>
    </section>
    ${productOverview()}
    ${accessFocused ? '' : accessSection}
  </main>
  <footer><div class="footer-inner wrap"><span>CleanRooms</span><a class="text-action" href="#konto">${account ? 'Min konto' : 'Log ind eller opret virksomhed'}</a></div></footer>
</body>
</html>`;

  return new Response(html, { status, headers: {
    'Cache-Control': 'no-store, private',
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  } });
}
