/* A separate, revisioned sandbox lets planners try the workflow without changing the live plan. */
import Workflow from '../src/shift-workflow-model.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const activeStatuses=new Set(['awaiting_colleague','pending']);
const safeComment=value=>typeof value==='string'&&value.length<=16000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const dayAfter=(value,offset)=>{const day=new Date(value+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);};
const localNow=stamp=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp)),part=type=>parts.find(item=>item.type===type).value;return {date:part('year')+'-'+part('month')+'-'+part('day'),time:part('hour')+':'+part('minute')};};
const atOffset=(stamp,minutes)=>new Date(Date.parse(stamp)+minutes*60000).toISOString();
const overlap=(one,two)=>one.person===two.person&&one.date===two.date&&one.id!==two.id&&one.start<two.end&&two.start<one.end;
const PEOPLE=[['demo-emma','Emma Nielsen','EN'],['demo-noah','Noah Andersen','NA'],['demo-sara','Sara Ahmed','SA'],['demo-jonas','Jonas Larsen','JL']].map(([id,name,initials])=>({id,name,initials,active:true}));
const SITES=[{name:'Kontor Nord',address:'Nordvej 12',color:'#6d879a'},{name:'Klinikken',address:'Park Allé 8',color:'#8b8294'},{name:'Havnegade',address:'Havnegade 24',color:'#a58467'}];

export function seedWorkflowDemo(stamp=new Date().toISOString(),active=true){
  const clock=localNow(stamp),sites=clone(SITES),people=clone(PEOPLE),workflow=Workflow.empty();
  const state={schema:1,active,createdAt:stamp,clock,people,sites,shifts:[],leave:[],workflow};
  if(!active)return state;
  const shift=(id,person,offset,start='07:00',end='15:00',site=0)=>({id:'demo-shift-'+id,person,date:dayAfter(clock.date,offset),start,end,site,plannedBreakMinutes:30,note:'Eksempelvagt · Bruges kun til at afprøve beskeder og vagtanmodninger.'});
  state.shifts=[shift('claim','',1),shift('accepted-offer','demo-noah',2,'06:00','13:00',1),shift('incoming-offer','demo-emma',3),shift('approved','demo-sara',4,'08:00','16:00',2),shift('rejected','',5,'09:00','13:00'),shift('overlap','',6),shift('conflict','demo-noah',6,'10:00','18:00',1),shift('leave','demo-emma',7,'06:00','14:00',1),shift('available','',8,'12:00','18:00',2),shift('own','demo-emma',9),shift('changed','demo-noah',10,'08:00','16:00'),shift('moved','demo-emma',11,'06:00','14:00',2)];
  state.leave=[{personId:'demo-sara',date:dayAfter(clock.date,7),type:'Ferie',status:'approved'}];
  state.workflow=Workflow.publicationMessages(workflow,[],state.shifts,{at:atOffset(stamp,-150),sites});
  const changed=state.shifts.find(item=>item.id==='demo-shift-changed'),moved=state.shifts.find(item=>item.id==='demo-shift-moved'),cancelled=shift('cancelled','demo-noah',12,'09:00','13:00',1);
  state.workflow=Workflow.publicationMessages(state.workflow,[{...changed,start:'07:00',end:'15:00'}],[changed],{at:atOffset(stamp,-95),sites});
  state.workflow=Workflow.publicationMessages(state.workflow,[{...moved,date:dayAfter(clock.date,10),site:0}],[moved],{at:atOffset(stamp,-60),sites});
  state.workflow=Workflow.publicationMessages(state.workflow,[cancelled],[],{at:atOffset(stamp,-30),sites});
  const requests=[
    ['claim','claim','pending','demo-emma','demo-emma','Jeg vil gerne tage den ledige vagt.',''],
    ['accepted-offer','offer','pending','demo-noah','demo-sara','Sara har accepteret at tage min vagt.',''],
    ['incoming-offer','offer','awaiting_colleague','demo-emma','demo-noah','Kan du tage min vagt denne dag?',''],
    ['approved','claim','approved','demo-sara','demo-sara','Jeg kan godt hjælpe.','Godkendt som en del af eksemplet.'],
    ['rejected','claim','rejected','demo-jonas','demo-jonas','Jeg er ledig denne dag.','Vi har brug for en anden funktion på denne vagt.'],
    ['overlap','claim','pending','demo-noah','demo-noah','Her kan du se kontrollen af overlappende vagter.',''],
    ['leave','offer','pending','demo-emma','demo-sara','Fraværet blev godkendt efter kollegaens svar.','']
  ];
  requests.forEach(([key,kind,status,fromPersonId,toPersonId,comment,decisionReason],index)=>{
    const current=state.shifts.find(item=>item.id==='demo-shift-'+key),source=status==='approved'?{...current,person:''}:current,createdAt=atOffset(stamp,-20-index*10),request={id:'demo-request-'+key,version:1,kind,status,fromPersonId,toPersonId,shift:Workflow.summary(source,sites),comment,decisionReason,createdAt,updatedAt:createdAt};
    if(['approved','rejected'].includes(status)){request.decidedAt=createdAt;request.decidedBy={userId:'demo-planner',name:'Planlægger'};}
    state.workflow.requests.push(request);
    if(status==='awaiting_colleague')Workflow.requestMessage(state.workflow,request,toPersonId,createdAt,'Emma Nielsen tilbyder dig en vagt.');
    if(status==='rejected')Workflow.requestMessage(state.workflow,request,fromPersonId,createdAt,'Din anmodning er afvist. '+decisionReason);
    if(status==='approved')Workflow.requestMessage(state.workflow,request,fromPersonId,createdAt,'Din anmodning er godkendt. Din vagtplan er opdateret.');
  });
  state.workflow.notifications.forEach((message,index)=>{if(index%4===0)message.readAt=atOffset(stamp,-10);});
  return state;
}

function validState(value){
  return Boolean(value&&value.schema===1&&typeof value.active==='boolean'&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&value.clock&&typeof value.clock.date==='string'&&typeof value.clock.time==='string'&&Array.isArray(value.people)&&value.people.length===4&&value.people.every(person=>PEOPLE.some(item=>item.id===person.id)&&typeof person.name==='string')&&Array.isArray(value.sites)&&value.sites.length===3&&Array.isArray(value.shifts)&&value.shifts.length<=50&&value.shifts.every(shift=>typeof shift.id==='string'&&shift.id.startsWith('demo-shift-')&&typeof shift.person==='string'&&(shift.person===''||PEOPLE.some(person=>person.id===shift.person))&&/^\d{4}-\d{2}-\d{2}$/.test(shift.date)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(shift.start)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(shift.end)&&shift.start<shift.end&&Number.isInteger(shift.site)&&shift.site>=0&&shift.site<3)&&Array.isArray(value.leave)&&Workflow.validate(value.workflow).length===0);
}

export async function handleWorkflowDemoAction({db,context,payload,principal,helpers:h}){
  if(!h.capabilities(context).plan)h.fail(403,'workflow_demo_forbidden','Kun en planlægger kan åbne demoanmodninger og demobeskeder.');
  if(!['read','reset','clear','act'].includes(payload.operation))h.fail(400,'workflow_demo_operation','Vælg en gyldig demohandling.');
  if(payload.personId!==undefined&&payload.personId!==null&&!PEOPLE.some(person=>person.id===payload.personId))h.fail(400,'workflow_demo_person','Vælg en medarbejder fra eksemplet.');
  const workspaceId=context.workspace.id,stamp=new Date().toISOString(),actor={userId:principal.userId,name:principal.name},own=h.actorGuard(context,['plan']);
  let row=await h.first(db,'SELECT * FROM workspace_workflow_demo WHERE workspace_id = ?',workspaceId);
  if(!row){
    const config=JSON.stringify(seedWorkflowDemo(stamp,payload.operation!=='clear'));
    await db.batch([db.prepare(`INSERT INTO workspace_workflow_demo (workspace_id,config,version,write_token,updated_at)
      SELECT ?,?,1,?,? WHERE ${own.sql} ON CONFLICT(workspace_id) DO NOTHING`).bind(workspaceId,config,crypto.randomUUID(),stamp,...own.values)]);
    await h.assertContext(db,context);row=await h.first(db,'SELECT * FROM workspace_workflow_demo WHERE workspace_id = ?',workspaceId);
  }
  if(!row||!Number.isSafeInteger(row.version)||row.version<1||row.version>=Number.MAX_SAFE_INTEGER)h.fail(500,'workflow_demo_unavailable','Eksempeldata kunne ikke læses. Ingen almindelige data er ændret.');
  let state;
  if(payload.operation==='reset'||payload.operation==='clear')state=seedWorkflowDemo(stamp,payload.operation==='reset');
  else{try{state=JSON.parse(row.config);}catch{}if(!validState(state))h.fail(500,'workflow_demo_invalid','Eksempeldata kunne ikke læses. Nulstil eksemplet for at starte forfra.');}
  const personId=payload.personId||null,managerMode=personId===null;
  if(personId&&!state.people.some(person=>person.id===personId))h.fail(400,'workflow_demo_person','Vælg en medarbejder fra eksemplet.');
  const nameFor=id=>state.people.find(person=>person.id===id)?.name||'Medarbejder';
  const shiftFor=id=>state.shifts.find(shift=>shift.id===id);
  function blockedReason(request){
    const current=shiftFor(request.shift.id);
    if(!current||!Workflow.future(current,state.clock)||Workflow.fingerprint(current)!==request.shift.fingerprint)return 'Vagten er ændret eller er allerede startet.';
    const proposed={...current,person:request.toPersonId};
    if(state.shifts.some(other=>overlap(proposed,other)))return 'Medarbejderen har en overlappende vagt.';
    if(state.leave.some(leave=>leave.personId===request.toPersonId&&leave.date===current.date&&leave.status==='approved'))return 'Medarbejderen har godkendt fravær på denne dato.';
    return null;
  }
  function requestDto(request){
    const reason=activeStatuses.has(request.status)?blockedReason(request):null;
    return {...clone(request),demo:true,fromName:nameFor(request.fromPersonId),toName:nameFor(request.toPersonId),shiftCurrent:!reason,...(reason?{blockedReason:reason,canApprove:false}:{})};
  }
  async function bundle(extra={}){
    const all=state.shifts,personal=personId?state.workflow.notifications.filter(item=>item.personId===personId):[],visible=managerMode?state.workflow.requests:state.workflow.requests.filter(item=>item.fromPersonId===personId||item.toPersonId===personId),summary=shift=>({...Workflow.summary(shift,state.sites),demo:true});
    const result={demo:true,demoActive:state.active,demoVersion:row.version,demoPersonId:personId,demoPeople:clone(state.people),demoSites:clone(state.sites),demoShifts:all.filter(shift=>managerMode||shift.person===personId).map(shift=>({...clone(shift),demo:true,siteName:state.sites[shift.site]?.name})),demoClockDate:state.clock.date,notifications:clone(personal).reverse(),unreadCount:personal.filter(item=>!item.readAt).length,requests:visible.map(requestDto).reverse(),openShifts:all.filter(shift=>!shift.person&&Workflow.future(shift,state.clock)).map(summary),ownShifts:personId?all.filter(shift=>shift.person===personId&&Workflow.future(shift,state.clock)).map(summary):[],colleagues:clone(state.people.filter(person=>person.id!==personId)),deliveries:managerMode?state.workflow.notifications.filter(item=>item.kind!=='request').map(message=>({...clone(message),personName:nameFor(message.personId)})).reverse():[],personId,canManage:managerMode,preview:false,revision:context.saved.revision,serverNow:state.createdAt,...extra};
    await h.assertContext(db,context);return result;
  }
  async function commit(extra={}){
    if(!validState(state))h.fail(500,'workflow_demo_invalid','Demohandlingen gav ugyldige data. Ingen ændringer er gemt.');
    while(state.workflow.notifications.length>500)state.workflow.notifications.shift();
    while(state.workflow.requests.length>200){const index=state.workflow.requests.findIndex(request=>!activeStatuses.has(request.status));if(index<0)h.fail(413,'workflow_demo_full','Der er mange åbne demoanmodninger. Nulstil eksemplet for at starte forfra.');state.workflow.requests.splice(index,1);}
    const config=JSON.stringify(state);if(new TextEncoder().encode(config).byteLength>4*1024*1024)h.fail(413,'workflow_demo_full','Eksempeldata fylder for meget. Nulstil eksemplet for at starte forfra.');
    const result=await db.batch([db.prepare(`UPDATE workspace_workflow_demo SET config = ?,version = version+1,write_token = ?,updated_at = ?
      WHERE workspace_id = ? AND version = ? AND ${own.sql}`).bind(config,crypto.randomUUID(),stamp,workspaceId,row.version,...own.values)]);
    await h.assertContext(db,context);
    if(result[0]?.meta?.changes!==1)h.fail(409,'workflow_demo_changed','Eksemplet er ændret i et andet vindue. Hent de seneste eksempeldata.');
    row={...row,version:row.version+1,config};return bundle(extra);
  }
  if(payload.demoVersion!==undefined&&payload.demoVersion!==row.version)h.fail(409,'workflow_demo_changed','Eksemplet er ændret. Hent de seneste eksempeldata.');
  if(payload.operation==='read')return bundle();
  if(payload.operation==='reset'||payload.operation==='clear')return commit({demoReset:payload.operation==='reset'});
  if(!Number.isSafeInteger(payload.demoVersion)||payload.demoVersion!==row.version)h.fail(409,'workflow_demo_changed','Hent eksemplet, før du ændrer den.');
  if(!state.active)h.fail(409,'workflow_demo_inactive','Indlæs demoeksemplerne, før du prøver handlingerne.');
  const action=payload.demoAction;
  if(action==='workflowReadMessage'){
    if(managerMode)h.fail(403,'workflow_demo_employee','Vælg en demomedarbejder for at læse beskeden.');
    const message=state.workflow.notifications.find(item=>item.id===payload.messageId&&item.personId===personId);
    if(!message)h.fail(404,'workflow_demo_message','Beskeden findes ikke hos denne demomedarbejder.');
    if(message.readAt)return bundle();message.readAt=stamp;return commit();
  }
  function checkedShift(id,fingerprint){
    const shift=shiftFor(id);if(!shift||!Workflow.future(shift,state.clock)||fingerprint!==Workflow.fingerprint(shift))h.fail(409,'workflow_demo_shift_changed','Eksempelvagten er ændret. Hent de seneste eksempeldata.');return shift;
  }
  function checkAssignment(shift,target){
    if(!state.people.some(person=>person.id===target))h.fail(400,'workflow_demo_person','Vælg en medarbejder fra eksemplet.');
    const proposed={...shift,person:target};
    if(state.shifts.some(other=>overlap(proposed,other)))h.fail(409,'workflow_demo_overlap','Medarbejderen har en overlappende vagt.');
    if(state.leave.some(leave=>leave.personId===target&&leave.date===shift.date&&leave.status==='approved'))h.fail(409,'workflow_demo_leave','Medarbejderen har godkendt fravær på denne dato.');
  }
  if(action==='workflowRequest'){
    if(managerMode)h.fail(403,'workflow_demo_employee','Vælg en demomedarbejder for at sende en anmodning.');
    if(!['offer','claim'].includes(payload.kind)||!safeComment(payload.comment||''))h.fail(400,'workflow_demo_request','Vælg en gyldig demohandling og kommentar.');
    const shift=checkedShift(payload.shiftId,payload.fingerprint),to=payload.kind==='claim'?personId:payload.toPersonId;
    if(payload.kind==='claim'&&shift.person||payload.kind==='offer'&&shift.person!==personId)h.fail(403,'workflow_demo_shift_forbidden','Du kan kun tilbyde demomedarbejderens egne vagter eller vælge en ledig vagt.');
    if(payload.kind==='offer'&&to===personId)h.fail(400,'workflow_demo_colleague','Vælg en anden demomedarbejder.');
    checkAssignment(shift,to);
    const duplicate=state.workflow.requests.find(request=>activeStatuses.has(request.status)&&request.shift.id===shift.id&&request.fromPersonId===personId&&request.kind===payload.kind);
    if(duplicate){if(duplicate.toPersonId===to)return bundle();h.fail(409,'workflow_demo_request_exists','Der er allerede en åben anmodning på denne eksempelvagt.');}
    const request={id:'demo-request-'+crypto.randomUUID(),version:1,kind:payload.kind,status:payload.kind==='offer'?'awaiting_colleague':'pending',fromPersonId:personId,toPersonId:to,shift:Workflow.summary(shift,state.sites),comment:(payload.comment||'').trim(),decisionReason:'',createdAt:stamp,updatedAt:stamp};state.workflow.requests.push(request);
    if(request.kind==='offer')Workflow.requestMessage(state.workflow,request,to,stamp,nameFor(personId)+' tilbyder dig en eksempelvagt.');return commit();
  }
  if(!['workflowRespond','workflowDecide'].includes(action))h.fail(400,'workflow_demo_action','Demohandlingen understøttes ikke.');
  const request=state.workflow.requests.find(item=>item.id===payload.requestId);
  if(!request||!managerMode&&![request.fromPersonId,request.toPersonId].includes(personId))h.fail(404,'workflow_demo_request','Anmodningen findes ikke i denne demovisning.');
  if(payload.version!==request.version)h.fail(409,'workflow_demo_request_changed','Anmodningen er ændret. Hent de seneste eksempeldata.');
  if(action==='workflowRespond'){
    if(managerMode)h.fail(403,'workflow_demo_employee','Vælg en demomedarbejder for at svare.');
    if(payload.decision==='cancel'){
      if(personId!==request.fromPersonId||!activeStatuses.has(request.status))h.fail(409,'workflow_demo_closed','Anmodningen kan ikke trækkes tilbage.');request.status='cancelled';
    }else{
      if(!['accept','decline'].includes(payload.decision)||request.kind!=='offer'||personId!==request.toPersonId||request.status!=='awaiting_colleague')h.fail(403,'workflow_demo_response','Du kan ikke svare på denne demoanmodning.');
      if(payload.decision==='accept'){const shift=checkedShift(request.shift.id,request.shift.fingerprint);checkAssignment(shift,personId);request.status='pending';}else request.status='declined';
    }
    request.version++;request.updatedAt=stamp;
    Workflow.requestMessage(state.workflow,request,personId===request.fromPersonId?request.toPersonId:request.fromPersonId,stamp,request.status==='pending'?nameFor(personId)+' har accepteret eksempelvagten. Afventer planlæggeren.':request.status==='declined'?'Tilbuddet om eksempelvagten er afslået.':'Anmodningen er trukket tilbage.');return commit();
  }
  if(!managerMode)h.fail(403,'workflow_demo_planner','Skift til planlægger i eksemplet for at godkende.');
  if(request.status!=='pending')h.fail(409,'workflow_demo_closed','Anmodningen afventer ikke planlæggerens beslutning.');
  if(!['approve','reject'].includes(payload.decision)||!safeComment(payload.reason||''))h.fail(400,'workflow_demo_decision','Vælg en gyldig beslutning.');
  const reason=(payload.reason||'').trim();if(payload.decision==='reject'&&!reason)h.fail(400,'workflow_demo_reason','Skriv en begrundelse ved afvisning.');
  if(payload.decision==='approve'){
    const shift=checkedShift(request.shift.id,request.shift.fingerprint);
    if(request.kind==='offer'&&shift.person!==request.fromPersonId||request.kind==='claim'&&shift.person)h.fail(409,'workflow_demo_shift_changed','Eksempelvagten har allerede skiftet medarbejder.');
    checkAssignment(shift,request.toPersonId);const before=clone(state.shifts);shift.person=request.toPersonId;
    state.workflow=Workflow.publicationMessages(state.workflow,before,state.shifts,{at:stamp,sites:state.sites});
    const current=state.workflow.requests.find(item=>item.id===request.id);current.status='approved';current.version++;current.updatedAt=stamp;current.decisionReason=reason;current.decidedBy=actor;current.decidedAt=stamp;
    for(const other of state.workflow.requests)if(other.id!==request.id&&other.shift.id===request.shift.id&&activeStatuses.has(other.status)){other.status='stale';other.version++;other.updatedAt=stamp;other.decisionReason='Eksempelvagten er tildelt en anden medarbejder.';Workflow.requestMessage(state.workflow,other,other.fromPersonId,stamp,other.decisionReason);}
    for(const id of new Set([current.fromPersonId,current.toPersonId]))Workflow.requestMessage(state.workflow,current,id,stamp,'Anmodningen er godkendt. Eksempelplanen er opdateret.');
  }else{
    request.status='rejected';request.version++;request.updatedAt=stamp;request.decisionReason=reason;request.decidedBy=actor;request.decidedAt=stamp;
    for(const id of new Set([request.fromPersonId,request.toPersonId]))Workflow.requestMessage(state.workflow,request,id,stamp,'Anmodningen er afvist. '+reason);
  }
  return commit({planChanged:false,demoPlanChanged:payload.decision==='approve'});
}
