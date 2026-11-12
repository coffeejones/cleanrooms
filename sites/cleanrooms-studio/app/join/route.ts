import { principalFromRequest } from '../../lib/workspace-store.mjs';

export const dynamic = 'force-dynamic';

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

export function GET(request: Request) {
  const nonce=crypto.randomUUID().replaceAll('-','');
  const url=new URL(request.url),token=url.searchParams.get('token')||'';
  const valid=/^[A-Za-z0-9_-]{40,128}$/.test(token);
  let signedIn=false,name='';
  try {const principal=principalFromRequest(request);signedIn=true;name=principal.name;}catch{}
  const returnTo='/join?token='+encodeURIComponent(token);
  const content=!valid?'<p>Invitationslinket er ugyldigt. Bed administratoren om et nyt link.</p>'
    :signedIn?`<p>Du er logget ind som <strong>${escapeHTML(name)}</strong>.</p><button type="button" id="accept">Acceptér invitation</button><p><a target="_top" href="/signout-with-chatgpt?return_to=${escapeHTML(encodeURIComponent(returnTo))}">Brug en anden konto</a></p>`
    :`<p>Log ind med den e-mailadresse, invitationen er oprettet til.</p><a target="_top" href="/signin-with-chatgpt?return_to=${escapeHTML(encodeURIComponent(returnTo))}">Log ind med ChatGPT</a>`;
  const html=`<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Invitation · CleanRooms</title>
  <style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;padding:32px 20px;background:#f5f6f8;color:#30353c;font:15px/1.6 system-ui,sans-serif}main{max-width:520px;margin:8vh auto;padding:28px;background:#fff;border:1px solid #dfe3e7;border-radius:8px}h1{margin:0 0 16px;font-size:24px}p{margin:12px 0}button,a{display:inline-block;margin-top:8px;padding:10px 16px;border:0;border-radius:5px;background:#30353c;color:#fff;font:inherit;text-decoration:none;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.hint{font-size:13px;color:#68717d}#status{overflow-wrap:anywhere}</style>
  <main><h1>Invitation til CleanRooms</h1>${content}<p class="hint">Administratorens invitation giver adgang til arbejdsområdet. Du skal også have adgang til selve den private Sites-side.</p><p id="status" role="status" aria-live="polite"></p></main>
  <script nonce="${nonce}">const button=document.getElementById('accept');if(button)button.addEventListener('click',async()=>{button.disabled=true;const status=document.getElementById('status');status.textContent='Accepterer invitation…';try{const token=new URL(location.href).searchParams.get('token');const response=await fetch('/api/accounts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'acceptInvite',token})});const result=await response.json();if(!response.ok)throw new Error(result.message||'Invitationen kunne ikke accepteres.');status.textContent='Invitationen er accepteret.';history.replaceState(null,'','/join');const link=document.createElement('a');link.href='/vagtplan';link.target='_top';link.textContent='Åbn CleanRooms';status.append(document.createElement('br'),link);}catch(error){status.textContent=error.message||'Prøv igen.';button.disabled=false;}});</script></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, private','Vary':'oai-authenticated-user-id','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`}});
}
