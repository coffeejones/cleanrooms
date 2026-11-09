import type {StorageWriteMessage,StudioWriteRequest,StorageReadMessage,StorageDirectoryMessage} from '../../lib/planning-contracts';

export const dynamic = 'force-dynamic';

// Serialized after TypeScript compilation; the browser receives this exact allowlisted projection.
function studioWriteBody(message: StorageWriteMessage): StudioWriteRequest {
  return {revision:message.revision,studio:message.studio,
    ...(message.planning!==undefined?{planning:message.planning}:{}),
    ...(message.commandReceipt==='records'?{commandReceipt:message.commandReceipt}:{}),
    ...(message.directoryRevision!==undefined?{directoryRevision:message.directoryRevision}:{}),
    ...(message.instructions==='deferred'?{instructions:message.instructions}:{}),
    ...(message.publication!==undefined?{publication:message.publication}:{}),
    ...(message.projection!==undefined?{projection:message.projection}:{})};
}

function directoryBody(message: StorageDirectoryMessage): object {
  const payload=message.payload,kinds=['employee','site','department'],object=(value:unknown)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)),id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512&&value===value.trim()&&!['__proto__','prototype','constructor'].includes(value)&&!/[\u0000-\u001f\u007f]/.test(value);
  if(!object(payload))throw new Error('invalid_directory_request');
  if(message.action==='directoryRead'){
    const p=message.payload;
    if(Object.keys(p).some(key=>!['kind','ids','cursor','limit','catalog'].includes(key))||p.kind!==undefined&&!kinds.includes(p.kind)||p.limit!==undefined&&(!Number.isInteger(p.limit)||p.limit<1||p.limit>500)||p.catalog!==undefined&&typeof p.catalog!=='boolean'||p.ids!==undefined&&(!p.kind||!Array.isArray(p.ids)||!p.ids.length||p.ids.length>500||p.ids.some(value=>!id(value)))||p.ids===undefined&&p.catalog!==true||p.cursor!==undefined&&(typeof p.cursor!=='string'||!p.cursor||p.cursor.length>16384))throw new Error('invalid_directory_request');
    return {action:'read',...p};
  }
  const p=message.payload;
  if(Object.keys(p).some(key=>key!=='changes')||!Array.isArray(p.changes)||p.changes.length>5000||p.changes.some(change=>!object(change)||Object.keys(change).some(key=>!['kind','id','expectedVersion','patch','siteIndex'].includes(key))||!kinds.includes(change.kind)||!id(change.id)||!Number.isSafeInteger(change.expectedVersion)||change.expectedVersion<0||change.expectedVersion>=Number.MAX_SAFE_INTEGER||!object(change.patch)||Object.keys(change.patch).some(key=>['__proto__','prototype','constructor'].includes(key))||change.siteIndex!==undefined&&(change.kind!=='site'||!Number.isInteger(change.siteIndex)||change.siteIndex<0||change.siteIndex>=2000)))throw new Error('invalid_directory_request');
  return {action:'write',changes:p.changes};
}

function studioReadUrl(message: StorageReadMessage): string {
  if(message.instructions!==undefined&&message.instructions!=='deferred')throw new Error('invalid_calendar_projection');
  if(message.projection===undefined){if(message.cursor!==undefined||message.instructions!==undefined)throw new Error('invalid_calendar_projection');return '/api/studio';}
  const p=message.projection;
  const valid=(value: string)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const interval=(range:{from:string;to:string},days:number)=>range&&typeof range==='object'&&!Array.isArray(range)&&Object.keys(range).every(key=>['from','to'].includes(key))&&valid(range.from)&&valid(range.to)&&range.to>=range.from&&(Date.parse(range.to)-Date.parse(range.from))/86400000<days;
  const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512&&!['__proto__','prototype','constructor'].includes(value)&&!/[\u0000-\u001f\u007f]/.test(value);
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('invalid_calendar_projection');
  const allowed=p.mode==='calendar'?['mode','from','to']:p.mode==='series-list'?['mode','calendar','catalogOnly']:p.mode==='series'?['mode','seriesId','groupId','ranges','calendar']:p.mode==='publication'?['mode','from','to','siteIds','includeDependencies','calendar']:[];
  if(!allowed.length||Object.keys(p).some(key=>!allowed.includes(key)))throw new Error('invalid_calendar_projection');
  if(p.mode==='series-list'&&p.catalogOnly!==undefined&&p.catalogOnly!==true)throw new Error('invalid_calendar_projection');
  const params=new URLSearchParams();
  if(p.mode==='calendar'){
    if(!interval({from:p.from,to:p.to},56))throw new Error('invalid_calendar_projection');
    params.set('projection','calendar');params.set('from',p.from);params.set('to',p.to);
  }else{
    if(!interval(p.calendar,56))throw new Error('invalid_calendar_projection');
    if(p.mode==='series'&&(p.seriesId!==undefined&&!id(p.seriesId)||p.groupId!==undefined&&!id(p.groupId)||!Array.isArray(p.ranges)||p.ranges.length>20000||p.ranges.some(range=>!interval(range,366))))throw new Error('invalid_calendar_projection');
    if(p.mode==='publication'){
      if(!interval({from:p.from,to:p.to},366)||new Date(p.from+'T12:00:00Z').getUTCDay()!==1||new Date(p.to+'T12:00:00Z').getUTCDay()!==0||!Array.isArray(p.siteIds)||!p.siteIds.length||p.siteIds.length>2000||p.siteIds.some(site=>!Number.isInteger(site)||site<0||site>=2000)||new Set(p.siteIds).size!==p.siteIds.length||typeof p.includeDependencies!=='boolean')throw new Error('invalid_calendar_projection');
    }
    params.set('projection',p.mode);params.set('selection',JSON.stringify(p));
  }
  if(message.cursor!==undefined){if(typeof message.cursor!=='string'||!message.cursor||message.cursor.length>16384)throw new Error('invalid_calendar_projection');params.set('cursor',message.cursor);}
  if(message.instructions==='deferred')params.set('instructions','deferred');
  return '/api/studio?'+params.toString();
}

const bridge = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>CleanRooms lagring</title></head><body><script>
const studioWriteBody = ${studioWriteBody.toString()};
const studioReadUrl = ${studioReadUrl.toString()};
const directoryBody = ${directoryBody.toString()};
(() => {
  // Keep the employee's position in the first-party frame and send it only after a server challenge.
  function clockInLocation() {
    return new Promise(resolve => {
      const unavailable = { error:'time_location_unavailable', message:'Placeringen kunne ikke findes. Tjek, at placering er slået til, og prøv igen.' };
      const timedOut = { error:'time_location_timeout', message:'Det tog for lang tid at finde din placering. Prøv igen.' };
      if (!navigator.geolocation) { resolve(unavailable); return; }
      const deadline = setTimeout(() => resolve(timedOut), 20000);
      const finish = result => { clearTimeout(deadline); resolve(result); };
      try {
        navigator.geolocation.getCurrentPosition(position => finish({ location:{
          latitude:position.coords.latitude, longitude:position.coords.longitude,
          accuracyMeters:position.coords.accuracy, timestamp:Math.trunc(position.timestamp),
        } }), error => finish(error.code===1
          ? { error:'time_location_denied', message:'Tillad placering for dette websted i din browser, og prøv igen.' }
          : error.code===3 ? timedOut : unavailable), { enableHighAccuracy:true, maximumAge:0, timeout:10000 });
      } catch { finish(unavailable); }
    });
  }
  const readResponse = async result => {
    try { return await result.json(); } catch { return { error:'invalid_storage_response' }; }
  };
  let connected = false;
  addEventListener('message', event => {
    if (connected || event.source !== parent || event.origin !== location.origin
      || event.data?.type !== 'cleanrooms-storage-connect' || event.ports.length !== 1) return;
    connected = true;
    const port = event.ports[0], pending = new Set();
    port.addEventListener('message', async event => {
      const message = event.data;
      if (!message || typeof message !== 'object' || Array.isArray(message)
        || !(typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 100
          || Number.isSafeInteger(message.id) && message.id > 0)
        || !['read','write','account','directoryRead','directoryWrite'].includes(message.action) || pending.has(message.id)) return;
      pending.add(message.id);
      let clockInDeadline;
      try {
        let url=message.action==='account'?'/api/accounts':'/api/studio';
        if(message.action==='read'){try{url=studioReadUrl(message);}catch{port.postMessage({id:message.id,ok:false,status:400,error:'invalid_planning_projection'});return;}}
        const options = { method: message.action === 'read' ? 'GET' : message.action === 'account' ? 'POST' : 'PUT', credentials: 'same-origin', cache: 'no-store' };
        if (message.action === 'write') {
          options.headers = { 'Content-Type': 'application/json' };
          options.body = JSON.stringify(studioWriteBody(message));
        }
        let clockInBody;
        if(message.action === 'account') {
          if(!['list','invite','updateMember','revokeInvite','createRole','updateRole','createEmployeeUser','readAppLogin','revealAppStartCode','createAppLogin','resetAppLogin','revokeAppLogin','preferences','checklist','employeeRead','employeeShift','plannerDetail','publicationBudgetRead','planningCostRead','planningAvailability','payrollRead','payrollSave','payrollPolicyRead','payrollPolicyPreview','payrollPolicySave','payrollPersonPolicySave','timeRead','timeWrite','timeDemo','leaveRead','leaveCreate','leaveDecide','activityRead','workflowRead','workflowReadMessage','workflowRequest','workflowRespond','workflowDecide','workflowDemo','chatList','chatRead','chatSync','chatCreate','chatUpdate','chatSend','chatPin','chatReadMark','chatMute','chatDemo','siteAddressLookup'].includes(message.operation)
            || !message.payload || typeof message.payload!=='object' || Array.isArray(message.payload)) {
            port.postMessage({id:message.id,ok:false,status:400,message:'Ukendt kontohandling.'});return;
          }
          options.headers={'Content-Type':'application/json'};
          const body={...message.payload,action:message.operation};
          if(message.operation==='timeWrite'&&body.operation==='start'){
            delete body.location;
            clockInBody=body;
            const controller=new AbortController();
            options.signal=controller.signal;
            clockInDeadline=setTimeout(() => controller.abort(),40000);
          }
          options.body=JSON.stringify(body);
        }
        if(message.action==='directoryRead'||message.action==='directoryWrite'){
          try{options.body=JSON.stringify(directoryBody(message));}catch{port.postMessage({id:message.id,ok:false,status:400,error:'invalid_directory_request'});return;}
          url='/api/directory';options.method='POST';options.headers={'Content-Type':'application/json'};
        }
        let result = await fetch(url, options), payload = await readResponse(result);
        if(clockInBody&&result.status===400&&payload?.error==='time_location_required'){
          const fix=await clockInLocation();
          if(!fix.location){port.postMessage({ ...fix, id:message.id, ok:false, status:400 });return;}
          result=await fetch(url,{...options,body:JSON.stringify({...clockInBody,location:fix.location})});
          payload=await readResponse(result);
        }
        port.postMessage({ ...payload, id: message.id, ok: result.ok, status: result.status });
      } catch {
        port.postMessage({ id: message.id, ok: false, status: 503, error: 'storage_unavailable' });
      } finally { if(clockInDeadline!==undefined)clearTimeout(clockInDeadline); pending.delete(message.id); }
    });
    port.start();
    port.postMessage({ type: 'cleanrooms-storage-ready' });
  });
})();
</script></body></html>`;

export function GET() {
  return new Response(bridge, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
  } });
}
