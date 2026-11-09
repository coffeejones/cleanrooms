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
    if(event.source!==transport?.contentWindow||event.origin!==location.origin||event.data?.type!=='cleanrooms-payroll-download'||event.ports?.length!==1)return;
    const port=event.ports[0],file=event.data;
    if(typeof file.filename!=='string'||file.filename.length>180||!file.filename.endsWith('.csv')||/[/\\\r\n\u0000-\u001f]/.test(file.filename)||typeof file.text!=='string'||new TextEncoder().encode(file.text).byteLength>64*1024*1024){port.postMessage({ok:false});port.close();return;}
    let url;
    try{url=URL.createObjectURL(new Blob([file.text],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=file.filename;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();port.postMessage({ok:true});}
    catch{port.postMessage({ok:false});}
    finally{port.close();if(url)setTimeout(()=>URL.revokeObjectURL(url),60000);}
  });
  window.addEventListener('message',event => {
    if (event.source !== app.contentWindow || event.data?.type !== 'cleanrooms-storage-connect' || !event.ports?.[0]) return;
    const port = event.ports[0];
    // A new app connection gets a fresh, single-use transport frame.
    if (transport) { transport.remove(); ready = false; }
    pending = [port]; createTransport();
  });
})();
