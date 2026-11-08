/* A first-party transport frame keeps the original visualization CSP intact. */
(() => {
  const app = document.getElementById('codex-visualization');
  if (!app) return;
  let transport = null, ready = false, pending = [];
  function createTransport() {
    transport = document.createElement('iframe'); transport.hidden = true;
    transport.title = 'CleanRooms lagring'; transport.setAttribute('aria-hidden','true'); transport.tabIndex = -1;
    transport.addEventListener('load',() => { ready = true; const waiting = pending; pending = []; waiting.forEach(port => transport.contentWindow.postMessage({type:'cleanrooms-storage-connect'},location.origin,[port])); });
    transport.src = '/storage-bridge'; document.body.append(transport);
  }
  window.addEventListener('message',event => {
    if (event.source !== app.contentWindow || event.data?.type !== 'cleanrooms-storage-connect' || !event.ports?.[0]) return;
    const port = event.ports[0];
    // A new app connection gets a fresh, single-use transport frame.
    if (transport) { transport.remove(); ready = false; }
    pending = [port]; createTransport();
  });
})();
