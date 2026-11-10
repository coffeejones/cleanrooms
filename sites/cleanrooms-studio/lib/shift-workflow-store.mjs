/* Request rows have independent versions; only an approved transfer commits a new plan. */
import {isScoped,assertSiteAccess,assertPersonAccess,accessGuard} from './department-access.mjs';
import Workflow from '../src/shift-workflow-model.js';
import Publication from '../src/publication-model.js';
import Data from '../src/studio-data.js';
import Departments from '../src/department-model.js';
import Checklist from '../src/checklist-progress.js';
import {writeStudio,StudioError} from './studio-store.mjs';
import {ensureTimeEntries} from './time-entry-store.mjs';
import {absenceGuard} from './absence-store.mjs';
import {ensureEngagement,readWorkflow,workflowDepartmentScope,workflowRequest,workflowRequestsForShift,requestStatement,requestVersionGuard,messageStatements,engagementPlanGuard,prepareEngagementPlan} from './engagement-store.mjs';
import {employeeReferenceGuard} from './directory-references.mjs';
import {handleWorkflowDemoAction} from './shift-workflow-demo-store.mjs';
import {createWorkflowContext} from './workflow-context.mjs';
import {preparePlanningCommandWrite} from './planning-store.mjs';
import {preparePublicationCommandWrite} from './publication-store.mjs';
import {readEmployeeAvailability,employeeAvailabilityGuard,unavailableShiftDate,availabilityMessage} from './employee-availability.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const activeStatuses=new Set(['awaiting_colleague','pending']);
const safeComment=value=>typeof value==='string'&&value.length<=16000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const localNow=stamp=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp)),part=type=>parts.find(item=>item.type===type).value;return {date:part('year')+'-'+part('month')+'-'+part('day'),time:part('hour')+':'+part('minute')};};
const weekFor=day=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const from=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {from,to:date.toISOString().slice(0,10)};};
const siteList=studio=>studio.organization?.sites||Departments.defaultOrganization().sites;
const overlap=(one,two)=>one.person===two.person&&one.date===two.date&&one.id!==two.id&&one.start<two.end&&two.start<one.end;

export async function handleShiftWorkflowAction(args){try{return await workflowAction(args);}catch(error){if(!(error instanceof StudioError)&&Number.isInteger(error?.status)&&error.status>=400&&error.status<=599&&typeof error.code==='string')throw new StudioError(error.status,error.code,error.message);throw error;}}
async function workflowAction({db,context,payload,principal,helpers:h}){
  if(payload.action==='workflowDemo'&&isScoped(context))h.fail(403,'department_scope_forbidden','Eksempler kræver adgang til hele virksomheden.');
  if(payload.action==='workflowDemo')return handleWorkflowDemoAction({db,context,payload,principal,helpers:h});
  const manager=h.capabilities(context).plan,actor={userId:principal.userId,name:principal.name},stamp=new Date().toISOString(),local=localNow(stamp),workspaceId=context.workspace.id;
  const selectedPerson=payload.personId||context.member.personId||null,preview=Boolean(manager&&payload.personId);
  if(payload.personId&&!manager&&payload.personId!==context.member.personId)h.fail(403,'workflow_person_forbidden','Du kan kun se dine egne beskeder og vagtanmodninger.');
  if(!manager&&!context.member.personId)h.fail(403,'workflow_person_required','Kontoen skal være knyttet til en medarbejder.');
  const departmentWorkflow=manager?workflowDepartmentScope(context):workflowDepartmentScope(null);
  async function assertRequestAccess(request){if(!manager||!isScoped(context)||!request)return;assertSiteAccess(context,request.shift?.site);for(const personId of new Set([request.fromPersonId,request.toPersonId].filter(Boolean)))await assertPersonAccess({db,context,personId});}
  if(manager&&payload.personId)await assertPersonAccess({db,context,personId:payload.personId});
  await ensureEngagement(db,context,h);
  if(payload.summary===true){
    if(selectedPerson&&!await h.first(db,"SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=? AND deleted=0",workspaceId,selectedPerson))h.fail(404,'workflow_person_missing','Medarbejderen findes ikke.');
    const messageAccess=workflowDepartmentScope(manager?context:undefined,{messageAlias:'message'}).messages;
    const own=selectedPerson?await h.first(db,`SELECT COUNT(*) n FROM workspace_shift_messages message LEFT JOIN workspace_message_receipts receipt ON receipt.workspace_id=message.workspace_id AND receipt.message_id=message.id AND receipt.person_id=message.person_id WHERE message.workspace_id=? AND message.person_id=? AND receipt.read_at IS NULL AND json_extract(message.config,'$.readAt') IS NULL AND (${messageAccess.sql})`,workspaceId,selectedPerson,...messageAccess.values):null,pending=manager&&!preview?await h.first(db,`SELECT COUNT(*) n FROM workspace_shift_requests WHERE workspace_id=? AND status='pending' AND (${departmentWorkflow.requests.sql})`,workspaceId,...departmentWorkflow.requests.values):null;
    await h.assertContext(db,context);return {summary:true,unreadCount:own?.n||0,pendingCount:pending?.n||0,personId:selectedPerson,canManage:manager&&!preview,preview,revision:context.saved.revision,serverNow:stamp};
  }
  const scoped=await createWorkflowContext({db,context,payload,helpers:h,local});
  let saved=context.saved,studio=saved.studio||{};
  // A mutation is authorized from its exact request, not a page of unrelated history.
  const workflow={version:1,sequence:0,notifications:[],requests:[]},baseline=new Map();
  if(payload.requestId&&!baseline.has(payload.requestId)){const target=await workflowRequest(db,workspaceId,payload.requestId);if(target&&(manager&&!preview||[target.fromPersonId,target.toPersonId].includes(context.member.personId))){await assertRequestAccess(target);workflow.requests.push(target);baseline.set(target.id,clone(target));}}
  await scoped.prepareRequests(workflow.requests,[payload.shiftId].filter(Boolean));await scoped.loadPeople([selectedPerson,payload.toPersonId].filter(Boolean));
  const staff=()=>[...scoped.people.values()],nameFor=id=>staff().find(person=>person.id===id)?.name||'Medarbejder';
  if(selectedPerson&&!staff().some(person=>person.id===selectedPerson))h.fail(404,'workflow_person_missing','Medarbejderen findes ikke.');
  const members=scoped.members;
  const assignmentAvailability=new Map(),requestAvailability=new Map();
  const eligible=id=>staff().some(person=>person.id===id&&person.active!==false)&&members.has(id);
  const published=()=>scoped.published(),publishedShift=id=>scoped.publishedShift(id),draftShift=id=>scoped.draftShift(id);
  const fingerprint=shift=>shift?.fingerprint||Workflow.fingerprint(shift),summary=shift=>({...Workflow.summary(shift,scoped.sites.length?scoped.sites:siteList(studio)),fingerprint:fingerprint(shift)});
  function checkShift(shiftId,fingerprint){
    const shift=typeof shiftId==='string'?publishedShift(shiftId):null;
    if(!shift)h.fail(409,'workflow_shift_changed','Vagten er fjernet eller endnu ikke udgivet. Hent den seneste plan.');
    if(!Workflow.future(shift,local))h.fail(409,'workflow_shift_started','Vagter kan kun overdrages, før de starter.');
    if(typeof fingerprint!=='string'||fingerprint!==(shift.fingerprint||Workflow.fingerprint(shift)))h.fail(409,'workflow_shift_changed','Vagten er ændret. Hent den seneste version, før du fortsætter.');
    return shift;
  }
  async function checkAssignment(shift,target){
    if(manager){assertSiteAccess(context,shift.site);await assertPersonAccess({db,context,personId:target});}
    if(!eligible(target))h.fail(409,'workflow_colleague_unavailable','Medarbejderen er arkiveret eller mangler en aktiv medarbejderkonto.');
    const [availability]=await readEmployeeAvailability({db,workspaceId,personIds:[target]});
    assignmentAvailability.set(target,availability);
    const unavailable=unavailableShiftDate(availability,shift);
    if(unavailable)h.fail(409,'workflow_unavailable',availabilityMessage(unavailable));
    const proposed={...shift,person:target};
    if((await scoped.conflicts(shift,target)).some(other=>overlap(proposed,other)))h.fail(409,'workflow_overlap','Medarbejderen har en overlappende vagt. Vælg en anden medarbejder eller ret planen.');
    if(await h.first(db,"SELECT id FROM workspace_absences WHERE workspace_id=? AND person_id=? AND status='approved' AND from_date<=? AND to_date>=? LIMIT 1",workspaceId,target,shift.date,shift.date))h.fail(409,'workflow_leave','Medarbejderen har godkendt fravær på denne dato.');
  }
  function describeRequest(request){
    const current=publishedShift(request.shift.id),valid=Boolean(current&&Workflow.future(current,local)&&request.shift.fingerprint===fingerprint(current));
    const draftChanged=activeStatuses.has(request.status)&&valid&&Workflow.fingerprint(draftShift(current.id))!==fingerprint(current);
    const unavailable=valid?unavailableShiftDate(requestAvailability.get(request.toPersonId),current):null;
    const blockedReason=!valid?'Vagten er ændret eller er allerede startet.':draftChanged?'Vagten har ændringer i kladden. Udgiv eller fortryd dem før godkendelse.':!eligible(request.toPersonId)?'Modtageren mangler en aktiv medarbejderkonto.':unavailable?availabilityMessage(unavailable):null;
    return {...clone(request),fromName:nameFor(request.fromPersonId),toName:nameFor(request.toPersonId),shiftCurrent:valid,...(activeStatuses.has(request.status)&&blockedReason?{blockedReason}:{})};
  }
  async function bundle(extra={}){
    const managerMode=manager&&!preview,personId=selectedPerson;
    const page=await readWorkflow(db,workspaceId,{manager:managerMode,context:manager?context:undefined,personId,limit:payload.limit??500,messageCursor:payload.messageCursor,requestCursor:payload.requestCursor,...scoped.period});
    // A targeted mutation remains visible even when the request is outside the current page.
    if(payload.requestId&&!page.requests.some(request=>request.id===payload.requestId)){
      const target=await workflowRequest(db,workspaceId,payload.requestId);if(target&&(managerMode||[target.fromPersonId,target.toPersonId].includes(personId))){await assertRequestAccess(target);page.requests.push(target);}
    }
    await scoped.prepareRequests(page.requests);await scoped.loadPeople(page.notifications.map(message=>message.personId));
    const recipients=[...new Set(page.requests.filter(request=>activeStatuses.has(request.status)).map(request=>request.toPersonId).filter(Boolean))];
    for(let index=0;index<recipients.length;index+=500)for(const availability of await readEmployeeAvailability({db,workspaceId,personIds:recipients.slice(index,index+500)}))requestAvailability.set(availability.personId,availability);
    const own=personId?await scoped.shiftPage(personId,payload.ownCursor):{shifts:[],nextCursor:null},open=!managerMode?await scoped.shiftPage('',payload.openCursor):{shifts:[],nextCursor:null},colleagues=await scoped.colleaguePage(personId);
    const personalMessages=personId?page.notifications.filter(message=>message.personId===personId):[],pending=managerMode?await h.first(db,`SELECT COUNT(*) n FROM workspace_shift_requests WHERE workspace_id=? AND status='pending' AND (${departmentWorkflow.requests.sql})`,workspaceId,...departmentWorkflow.requests.values):null;
    const result={notifications:personalMessages,unreadCount:managerMode?personalMessages.filter(message=>!message.readAt).length:page.unreadCount,pendingCount:pending?.n||0,requests:page.requests.map(describeRequest),openShifts:open.shifts.map(summary),ownShifts:own.shifts.map(summary),colleagues:colleagues.people,deliveries:managerMode?page.notifications.filter(message=>message.kind!=='request').map(message=>({...message,personName:nameFor(message.personId)})):[],pagination:{...page.pagination,ownShifts:own.nextCursor,openShifts:open.nextCursor,colleagues:colleagues.nextCursor},personId,canManage:managerMode,preview,revision:saved.revision,directoryRevision:scoped.frame.directoryRevision,serverNow:stamp,...extra};
    await scoped.assert();return result;
  }
  function participantGuard(participants){
    const guards=[];
    for(const personId of new Set(participants)){
      const member=members.get(personId);if(!member)h.fail(409,'workflow_colleague_unavailable','Medarbejderen mangler en aktiv konto.');
      if(member.kind==='mobile'){
        guards.push({sql:`EXISTS (SELECT 1 FROM workspace_mobile_credentials credential
          JOIN workspace_directory_records employee ON employee.workspace_id=credential.workspace_id
            AND employee.kind='employee' AND employee.id=credential.person_id AND employee.deleted=0 AND employee.active=1
          WHERE credential.workspace_id=? AND credential.person_id=? AND credential.version=? AND credential.revoked_at IS NULL)`,
          values:[workspaceId,personId,member.version]});
        continue;
      }
      guards.push({sql:`EXISTS (SELECT 1 FROM workspace_members participant JOIN workspace_roles participant_role ON participant_role.workspace_id=participant.workspace_id AND participant_role.id=participant.role_id
        WHERE participant.workspace_id=? AND participant.user_id=? AND participant.person_id=? AND participant.version=? AND participant.status='active' AND participant.role_id=? AND participant_role.version=?
        AND NOT EXISTS (SELECT 1 FROM json_each(participant_role.permissions) permission WHERE permission.value='plan'))`,values:[workspaceId,member.user_id,personId,member.version,member.role_id,member.role_version]});
    }
    return {sql:guards.map(g=>'('+g.sql+')').join(' AND ')||'1=1',values:guards.flatMap(g=>g.values)};
  }
  async function commit(next,{participants=[],ledgerVersion,planChanged=false,publication=null}={}){
    const changed=workflow.requests.filter(request=>JSON.stringify(request)!==JSON.stringify(baseline.get(request.id))),existing=changed.filter(request=>baseline.has(request.id)).map(request=>baseline.get(request.id));
    const token=crypto.randomUUID(),own=h.actorGuard(context,manager?['plan']:[]),people=participantGuard(participants),versions=requestVersionGuard(workspaceId,existing),plan=engagementPlanGuard(context),absence=absenceGuard(context);
    const activePeople=payload.action==='workflowRequest'?participants:planChanged?changed.filter(request=>request.status==='approved').map(request=>request.toPersonId):payload.action==='workflowRespond'&&payload.decision==='accept'?changed.filter(request=>request.id===payload.requestId).map(request=>request.toPersonId):[];
    const references=employeeReferenceGuard({workspaceId,personIds:participants}),activeReferences=employeeReferenceGuard({workspaceId,personIds:activePeople,active:true});
    const directory={sql:'EXISTS (SELECT 1 FROM workspace_directory_state WHERE workspace_id=? AND version=? AND write_token=?)',values:[workspaceId,scoped.frame.directoryRevision,scoped.frame.directoryToken]};
    const availability=employeeAvailabilityGuard(workspaceId,[...assignmentAvailability.values()]);
    const condition={sql:[own,people,versions,plan,absence,references,activeReferences,directory,availability].map(g=>'('+g.sql+')').join(' AND '),values:[...own.values,...people.values,...versions.values,...plan.values,...absence.values,...references.values,...activeReferences.values,...directory.values,...availability.values]};
    if(planChanged){
      const transferred=changed.find(request=>request.status==='approved'),activeIds=[...baseline.values()].filter(request=>request.shift.id===transferred.shift.id&&activeStatuses.has(request.status)).map(request=>request.id);
      // A new claim arriving after our read must force a retry, so its final status and message join this transaction.
      const exactSet={sql:`NOT EXISTS (SELECT 1 FROM workspace_shift_requests arriving WHERE arriving.workspace_id=? AND arriving.shift_id=? AND arriving.status IN ('awaiting_colleague','pending')
        AND NOT EXISTS (SELECT 1 FROM json_each(?) expected_id WHERE expected_id.value=arriving.id))`,values:[workspaceId,transferred.shift.id,JSON.stringify(activeIds)]};
      const scopeAccess=accessGuard(context);
      const guard={...h.guard(context,manager?['plan']:[]),extraCondition:{sql:[versions,absence,exactSet,references,activeReferences,directory,availability,scopeAccess].map(value=>'('+value.sql+')').join(' AND '),values:[...versions.values,...absence.values,...exactSet.values,...references.values,...activeReferences.values,...directory.values,...availability.values,...scopeAccess.values]}};
      guard.workflowMembers=[...new Set(participants)].map(personId=>{const member=members.get(personId);return {personId,userId:member.user_id,version:member.version,roleId:member.role_id,roleVersion:member.role_version,...(member.kind==='mobile'?{kind:'mobile'}:{})};});
      if(ledgerVersion!==undefined)guard.workflowLedgerVersion=ledgerVersion;
      next.shiftWorkflow=workflow;h.appendActivity(next,studio,actor,saved.revision+1,stamp,publication);
      const engagement=await prepareEngagementPlan({db,workspaceId,before:{...studio,shiftWorkflow:Workflow.empty()},next});
      guard.auditStatements=written=>[
        ...h.archiveStatements({db,workspaceId,entries:next.activity,condition:written}),
        ...changed.map(request=>requestStatement({db,workspaceId,request,previous:baseline.get(request.id),token,condition:written})),
        ...engagement(written)
      ];
      const persisted={...next,checklistProgress:{},shiftWorkflow:Workflow.empty()};
      guard.commandContext={saved,prepare:async options=>{const plan=await preparePlanningCommandWrite({...options,changes:[{kind:'shift',id:transferred.shift.id}]});const publications=await preparePublicationCommandWrite({...options,before:studio,after:next,scopeKeys:[weekFor(transferred.shift.date).from+'|'+transferred.shift.site]});plan.statements.push(...publications);plan.guard.sql+=' AND ('+publications.guard.sql+')';plan.guard.values.push(...publications.guard.values);return plan;}};
      const written=await writeStudio(db,context.workspace.snapshotOwnerId,saved.revision,persisted,guard);await h.assertContext(db,context);
      if(!written.ok)h.fail(409,'workflow_conflict','Planen eller anmodningen er ændret. Hent den seneste version.');
      saved={revision:written.revision,studio:next};studio=next;await scoped.committed(written.revision);return bundle({planChanged:true});
    }
    if(changed.length!==1)h.fail(409,'workflow_conflict','Anmodningen er ændret. Hent den seneste version.');
    const request=changed[0],proof={sql:'EXISTS (SELECT 1 FROM workspace_shift_requests WHERE workspace_id=? AND id=? AND write_token=?)',values:[workspaceId,request.id,token]};
    let result;try{result=await db.batch([
      requestStatement({db,workspaceId,request,previous:baseline.get(request.id),token,condition}),
      ...messageStatements({db,workspaceId,messages:workflow.notifications,condition:proof})
    ]);}catch(error){if(/UNIQUE constraint failed.*workspace_shift_requests/i.test(String(error?.message)))h.fail(409,'workflow_request_exists','Der findes allerede en åben anmodning på denne vagt. Hent den seneste version.');throw error;}
    await h.assertContext(db,context);
    if(result[0]?.meta?.changes!==1)h.fail(409,'workflow_conflict','Anmodningen, kontoadgangen eller planen er ændret. Hent den seneste version.');
    return bundle({planChanged:false});
  }
  if(payload.action==='workflowRead')return bundle();
  if(payload.action==='workflowReadMessage'){
    if(manager||preview)h.fail(403,'workflow_preview_readonly','Forhåndsvisningen er skrivebeskyttet. Kun medarbejderens egen konto kan markere beskeder som set.');
    const row=await h.first(db,'SELECT config FROM workspace_shift_messages WHERE workspace_id=? AND id=? AND person_id=?',workspaceId,payload.messageId,context.member.personId);
    const message=row?JSON.parse(row.config):null;
    if(!message)h.fail(404,'workflow_message_missing','Beskeden findes ikke på din konto.');
    if(message.readAt)return bundle();
    const own=h.actorGuard(context);
    const recipient=context.mobileEmployee===true?{
      sql:"EXISTS (SELECT 1 FROM workspace_directory_records recipient WHERE recipient.workspace_id=? AND recipient.kind='employee' AND recipient.id=? AND recipient.deleted=0 AND recipient.active=1)",values:[workspaceId,context.member.personId],
    }:{sql:"EXISTS (SELECT 1 FROM workspace_members recipient WHERE recipient.workspace_id=? AND recipient.user_id=? AND recipient.person_id=? AND recipient.status='active')",values:[workspaceId,context.member.userId,context.member.personId]};
    await db.batch([db.prepare(`INSERT INTO workspace_message_receipts (workspace_id,message_id,person_id,read_at)
      SELECT ?,?,?,? WHERE ${own.sql} AND ${recipient.sql}
      ON CONFLICT(workspace_id,message_id) DO NOTHING`).bind(workspaceId,message.id,context.member.personId,stamp,...own.values,...recipient.values)]);
    await h.assertContext(db,context);return bundle();
  }
  if(payload.action==='workflowRequest'){
    if(manager||preview)h.fail(403,'workflow_employee_required','Kun medarbejderens egen konto kan sende en vagtanmodning.');
    if(!['offer','claim'].includes(payload.kind)||!safeComment(payload.comment||''))h.fail(400,'workflow_request_invalid','Vælg en gyldig vagthandling og kommentar.');
    const shift=checkShift(payload.shiftId,payload.fingerprint),personId=context.member.personId,to=payload.kind==='claim'?personId:payload.toPersonId;
    if(!eligible(personId))h.fail(403,'workflow_employee_inactive','Medarbejderen er ikke aktiv.');
    if(payload.kind==='claim'&&shift.person||payload.kind==='offer'&&shift.person!==personId)h.fail(403,'workflow_shift_forbidden','Du kan kun tilbyde dine egne vagter eller melde dig til en ledig vagt.');
    if(payload.kind==='offer'&&(typeof to!=='string'||to===personId))h.fail(400,'workflow_colleague_required','Vælg en anden medarbejder.');
    await checkAssignment(shift,to);
    const active=await workflowRequestsForShift(db,workspaceId,shift.id);
    const duplicate=active.find(request=>request.kind===payload.kind&&request.fromPersonId===personId);
    if(duplicate){if(duplicate.toPersonId===to)return bundle({request:describeRequest(duplicate)});h.fail(409,'workflow_request_exists','Der findes allerede en åben anmodning på denne vagt. Annullér den først.');}
    if(active.length>=Workflow.MAX_REQUESTS)h.fail(413,'workflow_requests_full','Der er for mange åbne anmodninger på denne vagt. Behandl nogle anmodninger først.');
    const request={id:'shift-request-'+crypto.randomUUID(),version:1,kind:payload.kind,status:payload.kind==='offer'?'awaiting_colleague':'pending',fromPersonId:personId,toPersonId:to,shift:summary(shift),comment:(payload.comment||'').trim(),createdAt:stamp,updatedAt:stamp,decisionReason:''};workflow.requests.push(request);
    if(payload.kind==='offer')Workflow.requestMessage(workflow,request,to,stamp,nameFor(personId)+' tilbyder dig en vagt.');
    return commit(clone(studio),{participants:[personId,to]});
  }
  const request=workflow.requests.find(item=>item.id===payload.requestId);
  if(!request||(manager&&!preview?false:![request.fromPersonId,request.toPersonId].includes(context.member.personId)))h.fail(404,'workflow_request_missing','Vagtanmodningen findes ikke på din konto.');
  if(!Number.isSafeInteger(payload.version)||payload.version!==request.version)h.fail(409,'workflow_request_changed','Anmodningen er ændret. Hent den seneste version.');
  if(payload.action==='workflowRespond'){
    if(manager||preview)h.fail(403,'workflow_employee_required','Kun medarbejderens egen konto kan svare på en anmodning.');
    const personId=context.member.personId,decision=payload.decision;
    if(!['accept','decline','cancel'].includes(decision))h.fail(400,'workflow_response_invalid','Vælg et gyldigt svar.');
    if(decision==='cancel'){
      if(personId!==request.fromPersonId||!activeStatuses.has(request.status))h.fail(409,'workflow_request_closed','Anmodningen kan ikke annulleres.');request.status='cancelled';
    }else{
      if(request.kind!=='offer'||personId!==request.toPersonId||request.status!=='awaiting_colleague')h.fail(403,'workflow_response_forbidden','Du kan ikke svare på denne anmodning.');
      if(decision==='accept'){const shift=checkShift(request.shift.id,request.shift.fingerprint);await checkAssignment(shift,personId);request.status='pending';}else request.status='declined';
    }
    request.version+=1;request.updatedAt=stamp;
    const other=personId===request.fromPersonId?request.toPersonId:request.fromPersonId;
    Workflow.requestMessage(workflow,request,other,stamp,request.status==='pending'?nameFor(personId)+' har accepteret vagten. Afventer planlæggerens godkendelse.':request.status==='declined'?nameFor(personId)+' har afslået vagten.':'Vagtanmodningen er annulleret.');
    return commit(clone(studio),{participants:request.status==='pending'?[request.fromPersonId,request.toPersonId]:[]});
  }
  if(payload.action!=='workflowDecide')h.fail(400,'workflow_action_invalid','Handlingen understøttes ikke.');
  if(!manager||preview)h.fail(403,'workflow_planner_required','Kun en planlægger kan godkende vagtanmodninger.');
  if(payload.studioRevision!==saved.revision)h.fail(409,'workflow_plan_changed','Vagtplanen er ændret. Hent den seneste version, før du godkender.');
  if(request.status!=='pending')h.fail(409,'workflow_request_closed','Anmodningen afventer ikke en beslutning fra planlæggeren.');
  if(!['approve','reject'].includes(payload.decision)||!safeComment(payload.reason||''))h.fail(400,'workflow_decision_invalid','Vælg en gyldig beslutning.');
  const reason=(payload.reason||'').trim();if(payload.decision==='reject'&&!reason)h.fail(400,'workflow_reason_required','Skriv en begrundelse, når du afviser anmodningen.');
  if(payload.decision==='reject'){
    request.status='rejected';request.version+=1;request.updatedAt=stamp;request.decisionReason=reason;request.decidedBy=actor;request.decidedAt=stamp;
    for(const personId of new Set([request.fromPersonId,request.toPersonId]))Workflow.requestMessage(workflow,request,personId,stamp,'Vagtanmodningen er afvist. '+reason);
    return commit(clone(studio));
  }
  let shift=checkShift(request.shift.id,request.shift.fingerprint);
  if(request.kind==='offer'&&shift.person!==request.fromPersonId||request.kind==='claim'&&shift.person)h.fail(409,'workflow_shift_changed','Vagten har allerede skiftet medarbejder.');
  if(!eligible(request.fromPersonId))h.fail(409,'workflow_employee_inactive','Den oprindelige medarbejders konto er ikke længere aktiv.');
  const draft=draftShift(shift.id);if(Workflow.fingerprint(draft)!==fingerprint(shift))h.fail(409,'workflow_draft_changed','Vagten har ændringer i kladden. Udgiv eller fortryd ændringerne, før anmodningen godkendes.');
  await checkAssignment(shift,request.toPersonId);
  const approval=await scoped.prepareApproval(shift.id,request.toPersonId);saved=approval.saved;studio=approval.studio;shift=publishedShift(shift.id);
  // Summary fingerprints are optimistic UI tokens. Approval still compares the
  // complete authoritative instruction and assignment before changing anything.
  if(!Workflow.sameShift(draftShift(shift.id),shift))h.fail(409,'workflow_draft_changed','Vagten har ændringer i kladden. Udgiv eller fortryd ændringerne, før anmodningen godkendes.');
  const migrated=await ensureTimeEntries({db,workspaceId,context,helpers:h}),ledger=migrated.row;
  if(await h.first(db,'SELECT id FROM workspace_time_entries WHERE workspace_id=? AND shift_id=? AND demo=0',workspaceId,shift.id))h.fail(409,'workflow_shift_registered','Der er allerede registreret tid på vagten. Den kan ikke overdrages.');
  workflow.requests=workflow.requests.filter(item=>item.shift.id===shift.id&&activeStatuses.has(item.status));
  for(const competing of await workflowRequestsForShift(db,workspaceId,shift.id))if(!baseline.has(competing.id)){workflow.requests.push(competing);baseline.set(competing.id,clone(competing));}
  const before=published(),replacement={...shift,person:request.toPersonId},next=clone(studio);next.edits={...next.edits,[shift.id]:replacement};
  // Publish the accepted occurrence without exposing unrelated draft edits.
  const scope={...weekFor(shift.date),siteIds:[shift.site],actor,at:stamp},temporary={...next,demoSeed:false,series:[],edits:Object.fromEntries(before.map(item=>[item.id,item.id===shift.id?replacement:item])),deleted:[],publications:{...clone(next.publications),scopeLinks:[]}};
  const publicationResult=Publication.publish(temporary,scope);next.publications=publicationResult.studio.publications;
  if(studio.publications?.scopeLinks)next.publications.scopeLinks=clone(studio.publications.scopeLinks);
  const key=scope.from+'|'+shift.site;if(studio.publications?.slots[key])next.publications.slots[key].location=clone(studio.publications.slots[key].location);
  const after=Publication.publishedShifts(next);next.checklistProgress=Checklist.reconcile(next.checklistProgress,after);
  Object.assign(workflow,Workflow.publicationMessages(workflow,before,after,{at:stamp,sites:siteList(studio)}));
  const currentRequest=workflow.requests.find(item=>item.id===request.id);currentRequest.status='approved';currentRequest.version+=1;currentRequest.updatedAt=stamp;currentRequest.decisionReason=reason;currentRequest.decidedBy=actor;currentRequest.decidedAt=stamp;
  for(const other of workflow.requests)if(other.id!==request.id&&other.shift.id===shift.id&&activeStatuses.has(other.status)){
    other.status='stale';other.version+=1;other.updatedAt=stamp;other.decisionReason='Vagten er tildelt en anden medarbejder.';
    for(const personId of new Set([other.fromPersonId,other.toPersonId]))Workflow.requestMessage(workflow,other,personId,stamp,other.decisionReason);
  }
  for(const personId of new Set([request.fromPersonId,request.toPersonId]))Workflow.requestMessage(workflow,currentRequest,personId,stamp,'Vagtanmodningen er godkendt. Din vagtplan er opdateret.');
  return commit(next,{participants:[request.fromPersonId,request.toPersonId],ledgerVersion:ledger?.version||0,planChanged:true,publication:publicationResult.record});
}
