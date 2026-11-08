/* Server-owned publication messages and single-occurrence transfer requests. */
(() => {
  'use strict';
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const id=value=>text(value,512)&&value.trim()!=='';
  const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const STATUSES=Object.freeze(['awaiting_colleague','pending','declined','cancelled','approved','rejected','stale']);
  const MAX_NOTIFICATIONS=12000,MAX_REQUESTS=3000;
  const empty=()=>({version:1,sequence:0,notifications:[],requests:[]});
  const keys=['id','person','site','date','start','end','plannedBreakMinutes','note','noteRich'];
  const comparable=shift=>shift?keys.map(key=>key==='plannedBreakMinutes'?shift[key]??0:key==='note'||key==='noteRich'?shift[key]??'':shift[key]):null;
  const sameShift=(left,right)=>JSON.stringify(comparable(left))===JSON.stringify(comparable(right));
  // This is an optimistic version token, never an authorization credential.
  function fingerprint(shift){
    const value=JSON.stringify(comparable(shift));let a=2166136261,b=2246822519;
    for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);a=Math.imul(a^code,16777619);b=Math.imul(b^code,3266489917);}
    return 's1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  function summary(shift,sites=[]){
    if(!shift)return null;
    return {id:shift.id,person:shift.person,site:shift.site,date:shift.date,start:shift.start,end:shift.end,plannedBreakMinutes:shift.plannedBreakMinutes??0,siteName:sites[shift.site]?.name||shift.siteName||'Arbejdssted',fingerprint:fingerprint(shift)};
  }
  function validSummary(value){return record(value)&&id(value.id)&&typeof value.person==='string'&&Number.isInteger(value.site)&&value.site>=0&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.start)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.end)&&value.start<value.end&&Number.isSafeInteger(value.plannedBreakMinutes)&&value.plannedBreakMinutes>=0&&text(value.siteName,500)&&text(value.fingerprint,100);}
  function validate(value){
    if(!record(value)||value.version!==1||!Number.isSafeInteger(value.sequence)||value.sequence<0||!Array.isArray(value.notifications)||!Array.isArray(value.requests)||value.notifications.length>MAX_NOTIFICATIONS||value.requests.length>MAX_REQUESTS)return ['Beskederne eller vagtanmodningerne er ugyldige.'];
    const ids=new Set();
    for(const message of value.notifications){
      if(!record(message)||!id(message.id)||ids.has(message.id)||!id(message.personId)||!['new','changed','moved','cancelled','request'].includes(message.kind)||!timestamp(message.createdAt)||message.readAt!==null&&!timestamp(message.readAt)||!text(message.summary,1000)||message.before!==null&&!validSummary(message.before)||message.after!==null&&!validSummary(message.after)||message.requestId!==undefined&&!id(message.requestId))return ['En besked er ugyldig.'];ids.add(message.id);
    }
    ids.clear();
    for(const request of value.requests){
      if(!record(request)||!id(request.id)||ids.has(request.id)||!Number.isSafeInteger(request.version)||request.version<1||!['offer','claim'].includes(request.kind)||!STATUSES.includes(request.status)||!id(request.fromPersonId)||!id(request.toPersonId)||!validSummary(request.shift)||!text(request.comment,16000)||!timestamp(request.createdAt)||!timestamp(request.updatedAt)||!text(request.decisionReason||'',16000))return ['En vagtanmodning er ugyldig.'];ids.add(request.id);
    }
    return [];
  }
  function normalize(value){const next=value===undefined?empty():clone(value),errors=validate(next);if(errors.length)throw new TypeError(errors[0]);return next;}
  function appendMessage(workflow,message){
    // Limits bound a single working set, never retention. Durable rows are paged by the server.
    if(workflow.notifications.length>=MAX_NOTIFICATIONS)throw new RangeError('Der er for mange ændringer til én udgivelse. Udgiv færre uger ad gangen.');
    workflow.sequence+=1;workflow.notifications.push({id:'message-'+workflow.sequence,...clone(message),readAt:null});
  }
  function publicationMessages(value,before,after,{at,sites=[],beforeSites=sites}={}){
    const workflow=normalize(value),previous=new Map(before.map(shift=>[shift.id,shift])),current=new Map(after.map(shift=>[shift.id,shift]));
    for(const shiftId of new Set([...previous.keys(),...current.keys()])){
      const left=previous.get(shiftId),right=current.get(shiftId);
      if(sameShift(left,right)&&(!left||beforeSites[left.site]?.name===sites[right.site]?.name))continue;
      if(left?.person&&(!right||right.person!==left.person))appendMessage(workflow,{personId:left.person,kind:'cancelled',before:summary(left,beforeSites),after:null,createdAt:at,summary:right?'Vagten er overdraget til en anden medarbejder.':'Din vagt er aflyst.'});
      if(right?.person&&(!left||right.person!==left.person))appendMessage(workflow,{personId:right.person,kind:'new',before:null,after:summary(right,sites),createdAt:at,summary:'Du har fået en ny vagt.'});
      if(left?.person&&right?.person===left.person){const moved=left.date!==right.date||left.site!==right.site;appendMessage(workflow,{personId:right.person,kind:moved?'moved':'changed',before:summary(left,beforeSites),after:summary(right,sites),createdAt:at,summary:moved?'Din vagt er flyttet.':'Din vagt er ændret.'});}
    }
    return workflow;
  }
  function requestMessage(workflow,request,personId,at,summaryText){if(personId)appendMessage(workflow,{personId,kind:'request',before:null,after:clone(request.shift),createdAt:at,requestId:request.id,summary:String(summaryText).slice(0,1000)});}
  function future(shift,local){return Boolean(shift&&(shift.date>local.date||shift.date===local.date&&shift.start>local.time));}
  const api=Object.freeze({STATUSES,MAX_NOTIFICATIONS,MAX_REQUESTS,empty,validate,normalize,sameShift,fingerprint,summary,publicationMessages,requestMessage,future});
  globalThis.CleanRoomsShiftWorkflow=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
