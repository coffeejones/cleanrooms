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
  // The outer document pins the company for this tab when it creates the bridge.
  const company = typeof location.search === 'string' ? new URLSearchParams(location.search).get('virksomhed') : null;
  const companyHeaders = company === null ? {} : { 'X-CleanRooms-Workspace': /^[a-zA-Z0-9_-]{1,128}$/.test(company) ? company : '!' };
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
  async function downloadPayroll(payload) {
    const invalid={ok:false,status:400,message:'Vælg en gyldig lønperiode og eksportversion.'};
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['from','to','revision','profileId','profileVersion'].includes(key))
      ||!/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.from||'')||!/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.to||'')
      ||!Number.isSafeInteger(payload.revision)||payload.revision<1||payload.profileId!==undefined&&(typeof payload.profileId!=='string'||payload.profileId.length>160)||payload.profileVersion!==undefined&&(!Number.isSafeInteger(payload.profileVersion)||payload.profileVersion<1))return invalid;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),175000),parts=[],seen=new Set();
    let cursor=null,filename=null,workspaceId=null,profileVersion=payload.profileVersion,rowCount=null,receivedRows=0,size=0;
    try {
      for(let index=0;index<1000;index++) {
        const result=await fetch('/api/accounts',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',...companyHeaders},body:JSON.stringify({action:'payrollPeriodExport',...payload,...(profileVersion!==undefined?{profileVersion}:{}),limit:500,...(cursor?{cursor}:{})})});
        const page=await readResponse(result);
        if(!result.ok)return {ok:false,status:result.status,message:page.message||'Lønfilen kunne ikke hentes.'};
        if(typeof page.text!=='string'||page.text.length>4*1024*1024||page.revision!==payload.revision||typeof page.filename!=='string'||page.filename.length>180||!page.filename.endsWith('.csv')||/[\\/\\\\\\r\\n\\u0000-\\u001f]/.test(page.filename))throw Error('invalid_export');
        if(!Number.isSafeInteger(page.rowCount)||page.rowCount<0||!Number.isSafeInteger(page.pageCount)||page.pageCount<0||page.pageCount>500||page.profileId!==(payload.profileId??'standard-v1')||(page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>16384)))throw Error('invalid_export_page');
        if(index===0){rowCount=page.rowCount;if(typeof page.workspaceId!=='string'||!page.workspaceId||!Number.isSafeInteger(page.profileVersion)||page.profileVersion<1||profileVersion!==undefined&&profileVersion!==page.profileVersion)throw Error('invalid_export_scope');filename=page.filename;workspaceId=page.workspaceId;profileVersion=page.profileVersion;}
        else if(rowCount!==page.rowCount||filename!==page.filename||workspaceId!==page.workspaceId||profileVersion!==page.profileVersion)throw Error('export_changed');
        receivedRows+=page.pageCount;if(receivedRows>rowCount||page.nextCursor!==null&&page.pageCount===0)throw Error('invalid_export_count');
        size+=new TextEncoder().encode(page.text).byteLength;if(size>64*1024*1024)throw Error('export_too_large');parts.push(page.text);
        if(page.nextCursor===null) {
          if(receivedRows!==rowCount)throw Error('incomplete_export');
          return await new Promise(resolve=>{
            const channel=new MessageChannel(),deadline=setTimeout(()=>{channel.port1.close();resolve({ok:false,status:503,message:'Download kunne ikke startes. Prøv igen.'});},10000);
            channel.port1.onmessage=event=>{clearTimeout(deadline);channel.port1.close();resolve(event.data?.ok===true?{ok:true,status:200,filename}:{ok:false,status:503,message:'Download kunne ikke startes. Prøv igen.'});};
            parent.postMessage({type:'cleanrooms-payroll-download',filename,text:parts.join('')},location.origin,[channel.port2]);
          });
        }
        if(typeof page.nextCursor!=='string'||page.nextCursor.length>16384||seen.has(page.nextCursor))throw Error('invalid_export_cursor');seen.add(page.nextCursor);cursor=page.nextCursor;
      }
      throw Error('export_too_large');
    } catch {return {ok:false,status:503,message:'Lønfilen kunne ikke hentes samlet. Ingen delvis fil er downloadet. Prøv igen.'};}
    finally {clearTimeout(timeout);controller.abort();}
  }
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
          if(!['list','invite','updateMember','revokeInvite','createRole','updateRole','createEmployeeUser','readAppLogin','revealAppStartCode','createAppLogin','resetAppLogin','revokeAppLogin','preferences','checklist','employeeRead','employeeShift','plannerDetail','publicationBudgetRead','planningCostRead','planningAvailability','payrollRead','payrollSave','payrollPolicyRead','payrollPolicyPreview','payrollPolicySave','payrollPersonPolicySave','payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen','payrollPeriodExport','payrollPeriodDownload','payrollExportProfilesRead','payrollExportProfileRead','payrollExportProfileSave','payrollExportProfileArchive','payrollExportProfileEmployees','timeRead','timeWrite','timeDemo','leaveRead','leaveCreate','leaveDecide','activityRead','workflowRead','workflowReadMessage','workflowRequest','workflowRespond','workflowDecide','workflowDemo','chatList','chatRead','chatSync','chatCreate','chatUpdate','chatSend','chatPin','chatReadMark','chatMute','chatDemo','siteAddressLookup'].includes(message.operation)
            || !message.payload || typeof message.payload!=='object' || Array.isArray(message.payload)) {
            port.postMessage({id:message.id,ok:false,status:400,message:'Ukendt kontohandling.'});return;
          }
          if(message.operation==='payrollPeriodDownload'){port.postMessage({id:message.id,...await downloadPayroll(message.payload)});return;}
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
        if (company !== null) options.headers = { ...options.headers, ...companyHeaders };
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
