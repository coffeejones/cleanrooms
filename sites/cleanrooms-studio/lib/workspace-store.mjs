/* Sites identity authorizes a durable workspace; client snapshots never grant access. */
import {StudioError,MAX_BODY_BYTES,readStudio,readRawStudio,readStudioWindow,projectStudioWindow,readStudioSelection,projectStudioSelection,splitSnapshot,writeStudio,validateStudio} from './studio-store.mjs';
import Departments from '../src/department-model.js';
import {storedAccessScope,loadDepartmentAccess,isScoped,siteAllowed,departmentAllowed,assertSiteAccess,assertPersonAccess,assertDirectoryKeysAccess,validateGrantScope,assertTargetScope,grantScopeGuard,accessGuard,projectOrganization,projectStudioAccess,sitePredicate,personPredicate,jsonSitePredicate} from './department-access.mjs';
import Data from '../src/studio-data.js';
import Series from '../src/series-engine.js';
import Checklist from '../src/checklist-progress.js';
import Actions from '../src/schedule-actions.js';
import PlanningScope from '../src/planning-scope.js';
import Planning from '../src/planning-records.js';
import {assertPlanningCommandAccess,assertPlanningScopesAccess,filterPlanningRows} from './department-planning-access.mjs';
import {initializePlanningCommandStorage,readPlanningCommandContext} from './planning-command-store.mjs';
import {PlanningStoreError,preparePlanningCommandWrite} from './planning-store.mjs';
import {readPublicationPlanningContext,readPublicationLineage,publicationCommandConflict} from './publication-command.mjs';
import {preparePublicationCommandWrite} from './publication-store.mjs';
import Directory from '../src/directory-records.js';
import Roster from '../src/roster-model.js';
import {DirectoryError,ensureDirectory,hydrateDirectory,readDirectoryHeader,readDirectoryRecords,readDirectoryPage,prepareDirectoryWrite} from './directory-store.mjs';
import {directoryPlanningContext,directoryVersionGuard,employeeReferenceGuard,siteReferenceGuard} from './directory-references.mjs';
import Roles from '../src/role-model.js';
import Publication from '../src/publication-model.js';
import Payroll from '../src/payroll-model.js';
import PayrollGroups from '../src/payroll-groups-model.js';
import {handleChatAction} from './chat-store.mjs';
import {handleTimekeepingAction} from './timekeeping-store.mjs';
import {handlePayrollPeriodAction} from './payroll-period-store.mjs';
import {handlePayrollExportProfileAction} from './payroll-export-profile-store.mjs';
import {handleEmployeeRead,initializeEmployeeReadContext,readEmployeePublishedShift} from './employee-read-store.mjs';
import {handlePlannerDetail} from './planner-detail-store.mjs';
import {readPublicationBudget} from './publication-budget.mjs';
import {readPlanningCost} from './planning-cost.mjs';
import {enforceWorkspaceRequestQuota} from './workspace-request-quota.mjs';
import {readPlanningAvailability} from './employee-availability.mjs';
import {lookupSiteAddress} from './site-address-lookup.mjs';
import EmployeeCalendar from '../src/employee-calendar.js';
import {archiveStatements,readActivity,timeActivityStatements} from './activity-store.mjs';
import ShiftWorkflow from '../src/shift-workflow-model.js';
import {handleShiftWorkflowAction} from './shift-workflow-store.mjs';
import {hydrateEngagement,ensureEngagement,readChecklistProgress,handleChecklistAction,prepareEngagementPlan,preparePublicationEngagement} from './engagement-store.mjs';
import {hydrateAbsences,ensureAbsences,handleAbsenceAction,absenceGuard,absencePlanStatements,assertNoPublishedAbsence} from './absence-store.mjs';
import {accountAuditStatements} from './account-audit.mjs';
import {ensureTimeEntries} from './time-entry-store.mjs';
import {assertPersonalPayrollHistory,payrollRevisionStatements} from './payroll-history.mjs';
import {planningReceipt,preparePlanningSubmission} from './planning-write.mjs';
import {issueMobileCredential,listMobileCredentials,normalizeMobileEmail,prepareMobileCredentialCreate,readMobileCredential,revealMobileStartCode,revokeMobileCredential} from './mobile-auth-store.mjs';
import {firstLegacyCompanyId, resolveCompanyPrincipal} from './company-signup-store.mjs';
import {hasWebSessionCookie, readWebPrincipal} from './web-auth-store.mjs';

export const MAX_ACCOUNT_BODY_BYTES=64*1024;
export const MAX_PAYROLL_BODY_BYTES=512*1024;
export const MAX_PAYROLL_POLICY_BODY_BYTES=512*1024;
const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const ROLES=['admin','planner','employee'];
const CHAT_ACTIONS=new Set(['chatList','chatRead','chatSync','chatCreate','chatUpdate','chatSend','chatPin','chatReadMark','chatMute','chatDemo']);
const MOBILE_ADMIN_ACTIONS=new Set(['createEmployeeUser','createAppLogin','resetAppLogin','revokeAppLogin','readAppLogin','revealAppStartCode']);
const PREFS=['role','page','group','view','zoom','calendarLayoutVersion','calendarAnchor','day','onlyOpen','week','pageIndex','search','site','departmentId','employeePerson','employeeWeek','employeeDate','employeeView','employeeCalendarVersion','employeeShift','demoReturnPage','worksiteDate','worksiteSite'];
const PRIVATE_KEYS=[...PREFS,'viewer','capabilities','permissions','roleId','roleName','ownerId','userId','cloudCapabilities','manageDepartments','manageUsers','manageRoles','canManageDepartments','manageSiteGps','manageAppLogins','viewPayroll','managePayroll','managePayrollGroups','chat','manageChat','accessScope','access','scopeRestricted','allowedDepartmentIds','allowedSiteIds','companyPayroll'];
const PAYROLL_FIELDS=new Set(['payroll','payrollConfig','payrollByPerson','payrollPolicy','payrollGroups','payrollLinks','payrollPolicyHistory','salary','salaries']);
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
async function rows(db,sql,...values) {return (await db.batch([statement(db,sql,...values)]))[0]?.results||[];}
async function first(db,sql,...values) {return (await rows(db,sql,...values))[0]||null;}
const identity=value=>typeof value==='string'&&value.trim()&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
const email=value=>typeof value==='string'&&value.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value.trim().toLowerCase():null;
const now=()=>new Date().toISOString();
const same=(a,b)=>Planning.canonical(a??null)===Planning.canonical(b??null);
const rosterHas=(context,id)=>typeof id==='string'&&context.staff?.some(person=>person.id===id);
async function staffContext(db,context,options={}) {
  if(context.staff)return context.staff;
  if(!context.workspace.snapshotOwnerId){const stored=await first(db,'SELECT * FROM workspaces WHERE id = ?',context.workspace.id);if(!stored)fail(403,'membership_invalid','Arbejdsområdet findes ikke.');context.workspace=workspace(stored);}
  let directoryHead=options.directoryOnly?await readDirectoryHeader({db,workspaceId:context.workspace.id}):null;
  if(options.directoryOnly&&directoryHead){const header=await first(db,'SELECT revision FROM studio_states WHERE owner_id=?',context.workspace.snapshotOwnerId);context.saved={revision:header?.revision||0,studio:{directorySchema:1}};}
  else{
    context.saved=await (options.metadataOnly?readRawStudio:readStudio)(db,context.workspace.snapshotOwnerId);
    if(options.metadataOnly){
      if(!await ensureDirectory({db,workspaceId:context.workspace.id,owner:context.workspace.snapshotOwnerId,raw:context.saved,splitSnapshot}))fail(409,'directory_changed','Virksomhedsoplysningerne er ændret. Prøv igen.');
      context.saved=await readRawStudio(db,context.workspace.snapshotOwnerId);
    }
  }
  if(options.metadataOnly&&options.catalogOnly){
    // Account and payroll READS use the compact roster and metadata, never the
    // editable plan, employee profiles, absences or engagement collections.
    const studio=await hydrateDirectory({db,workspaceId:context.workspace.id,studio:context.saved.studio,catalog:true});
    context.saved.studio=studio;context.staff=Data.staffFor(studio);context.directory={...studio.directory,complete:true};context.metadataOnly=true;return context.staff;
  }
  if(options.metadataOnly){
    const ids=[...new Set([context.member.personId,context.member.preferences?.employeePerson,...(options.personIds||[]),...(!options.directoryOnly&&context.saved.studio?.demoSeed!==false?Data.leaveRequests().map(item=>item.p):[])].filter(id=>Directory.validId('employee',id)))];
    const own=await readDirectoryRecords({db,workspaceId:context.workspace.id,kind:'employee',ids,catalog:true});
    context.staff=own.records.filter(row=>row.value).map(row=>row.value);context.directory=own.directory;context.metadataOnly=true;return context.staff;
  }
  context.staff=Data.staffFor(context.saved.studio||{});const planning=context.saved.planning,directory=context.saved.directory;
  await hydrateAbsences(db,context,{capabilities,actorGuard,assertContext});
  await hydrateEngagement(db,context,{capabilities,actorGuard,assertContext,fail});
  if(planning)Object.defineProperty(context.saved,'planning',{value:planning,enumerable:false,configurable:true});
  if(directory)Object.defineProperty(context.saved,'directory',{value:directory,enumerable:false,configurable:true});
  return context.staff;
}
async function ensureOperationalSource(db,context){
  if(context.saved?.source?.workspaceId===context.workspace.id&&typeof context.saved.source.token==='string'){
    const current=await first(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',context.workspace.snapshotOwnerId);
    if(current?.revision===context.saved.source.revision&&current.write_token===context.saved.source.token)return context.saved;
  }
  const saved=await readRawStudio(db,context.workspace.snapshotOwnerId);
  if(saved.revision!==context.saved.revision)fail(409,'operational_context_changed','Planen er ændret under indlæsningen. Prøv igen.');
  context.saved=saved;return saved;
}
async function ensureOperationalPlanningSource(db,context){
  await ensureOperationalSource(db,context);
  const helpers={capabilities,actorGuard,assertContext,fail,ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)};
  await ensureEngagement(db,context,helpers);await ensureAbsences(db,context,helpers);
  return context.saved;
}
function appendActivity(studio,before,actor,revision,at,publication=null) {
  let history=clone(before?.activity||[]);
  const changes=Publication.activityChanges(before||{},studio);
  for(const change of changes)if(change.field==='requests'&&studio.leaveDecisions?.[change.id])change.decision=clone(studio.leaveDecisions[change.id]);
  const append=entry=>{history.push(entry);history=history.slice(-100);while(history.length>1&&encode.encode(JSON.stringify(history)).byteLength>512*1024)history.shift();};
  if(changes.length){
    const complete=changes.length<=500&&encode.encode(JSON.stringify(changes)).byteLength<=64*1024;
    const recoverable=complete&&changes.every(change=>!['organization','demoSeed','requests'].includes(change.field));
    const added=changes.filter(change=>change.field==='deleted'?change.before&&!change.after:change.before===null).length,removed=changes.filter(change=>change.field==='deleted'?!change.before&&change.after:change.after===null).length;
    const counts={added,removed,changed:changes.length-added-removed,total:changes.length};
    append({id:'activity-'+crypto.randomUUID(),at,actor:clone(actor),kind:'plan',summary:changes.length+(changes.length===1?' ændring gemt i planen':' ændringer gemt i planen'),counts,revision,changes:complete?changes:changes.slice(0,500).map(({field,id})=>({field,...(id===undefined?{}:{id})})),recoverable});
  }
  if(publication)append({id:'activity-'+crypto.randomUUID(),at,actor:clone(actor),kind:'publication',summary:publication.shiftCount+' vagter udgivet på '+publication.scopes.length+(publication.scopes.length===1?' uge':' uger'),counts:{...publication.counts,total:publication.shiftCount},revision,changes:[],recoverable:false,publicationId:publication.id,scopes:clone(publication.scopes)});
  studio.activity=history;return studio;
}
function leaveDecisions(previous,next,actor,at){
  const old=previous.leaveDecisions||{},requested=next.leaveDecisions||{},result=clone(old),definitions=new Map(Data.leaveRequests(previous).map(item=>[item.id,item]));
  for(const [id,status]of Object.entries(next.requests||{})){
    const before=previous.requests?.[id]??definitions.get(id)?.status??'pending';
    if(before===status)continue;
    // A previously stamped decision echoed by an older editor is not a new
    // reason. Changed statuses must not inherit a different decision's text.
    const draft=same(requested[id],old[id])?null:requested[id],reason=typeof draft?.reason==='string'?draft.reason.trim():'';
    if(draft&&draft.status!==status)fail(400,'leave_decision_mismatch','Fraværets beslutning og status skal følges ad.');
    if(status==='rejected'&&!reason)fail(400,'leave_reason_required','Skriv en begrundelse, når du afviser fravær.');
    result[id]={status,reason,decidedBy:clone(actor),decidedAt:at};
  }
  for(const id of Object.keys(previous.requests||{}))if(!Object.hasOwn(next.requests||{},id)){
    const status=definitions.get(id)?.status??'pending';
    if(previous.requests[id]!==status)result[id]={status,reason:'',decidedBy:clone(actor),decidedAt:at};
  }
  if(Object.keys(result).length||Object.hasOwn(previous,'leaveDecisions')||Object.hasOwn(next,'leaveDecisions'))next.leaveDecisions=result;
}
function publishedOverlap(studio,scopes) {
  const selected=new Set(scopes.flatMap(scope=>scope.siteIds.map(site=>scope.from+'|'+site)));
  const keyFor=shift=>{const value=new Date(shift.date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()-((value.getUTCDay()+6)%7));return value.toISOString().slice(0,10)+'|'+shift.site;};
  const shifts=Publication.publishedShifts(studio);
  for(const {shift,other}of Series.conflicts(shifts,shifts))if(selected.has(keyFor(shift))||selected.has(keyFor(other)))return [shift,other];
  return null;
}

export function principalFromRequest(request) {
  const userId=request.headers.get('oai-authenticated-user-id'),address=email(request.headers.get('oai-authenticated-user-email'));
  if(!identity(userId)||!address)fail(401,'authentication_required','Log ind med ChatGPT for at fortsætte.');
  let name=request.headers.get('oai-authenticated-user-full-name');
  if(name&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')try{name=decodeURIComponent(name);}catch{name=null;}
  if(typeof name!=='string'||!name.trim()||name.length>200||/[\u0000-\u001f\u007f]/.test(name))name=address;
  return {userId,email:address,name:name.trim()};
}

export function optionalSitePrincipal(request) {
  try { return principalFromRequest(request); }
  catch(error) {
    if(error instanceof StudioError && error.status===401) return null;
    throw error;
  }
}

function requestIdentity(request) {
  const usingWeb = hasWebSessionCookie(request);
  const site = usingWeb ? optionalSitePrincipal(request) : principalFromRequest(request);
  return {usingWeb,site};
}

async function requestPrincipal(request, storage, {usingWeb,site}) {
  const db = await database(storage);
  const signedIn = usingWeb ? await readWebPrincipal({db,request,siteUserId:site?.userId}) : site;
  if(!signedIn) fail(401,'authentication_required','Log ind i CleanRooms for at fortsætte.');
  return {db,signedIn,usingWeb};
}

async function selectedCompanyPrincipal(db, principal, request, usingWeb) {
  const workspaceId = request.headers.get('X-CleanRooms-Workspace');
  if(usingWeb){
    if(workspaceId!==principal.workspaceId) fail(403,'company_access_denied','Åbn din vagtplan fra forsiden igen.');
    return principal;
  }
  return workspaceId === null ? principal : resolveCompanyPrincipal(db, principal, workspaceId);
}

export async function hasLegacyWorkspace(db, principal) {
  const current = await membership(db, principal.userId);
  if(current) return current.status==='active';
  return Boolean(await firstLegacyCompanyId(db, principal) ||
    await first(db,'SELECT 1 AS has_plan FROM studio_states WHERE owner_id = ? AND revision > 0',principal.userId));
}

export async function legacyWorkspaceId(db, principal) {
  const current = await membership(db, principal.userId);
  if(current) return current.status==='active' ? current.workspaceId : null;
  const legacy = await first(db,'SELECT 1 AS has_plan FROM studio_states WHERE owner_id = ? AND revision > 0',principal.userId);
  if(legacy) return (await resolveWorkspace(db, principal, {metadataOnly:true,directoryOnly:true})).workspace.id;
  return firstLegacyCompanyId(db, principal);
}

function member(row) {
  if(!row)return null;
  let preferences={};try{preferences=JSON.parse(row.preferences||'{}');}catch{}
  return {userId:row.user_id,workspaceId:row.workspace_id,email:row.email,name:row.name,role:row.role,roleId:row.role_id,
    manageDepartments:row.manage_departments===1,accessScope:storedAccessScope(row.access_scope),personId:row.person_id,status:row.status,version:row.version,
    preferences:record(preferences)?preferences:{},createdAt:row.created_at,updatedAt:row.updated_at};
}
export function capabilities(context) {
  const has=key=>context.role.permissions.includes(key),plan=has('plan');
  const restricted=isScoped(context),manageDepartments=has('departments.manage')&&!restricted,manageSiteGps=plan&&manageDepartments&&context.role.id==='admin'&&context.role.isSystem;
  const manageAppLogins=context.role.id==='admin'&&context.role.isSystem&&has('users.manage');
  return {plan,chat:true,manageChat:has('chat.manage'),scopeRestricted:restricted,allowedDepartmentIds:restricted?[...context.access.departmentIds]:null,allowedSiteIds:restricted?[...context.access.siteIds]:null,manageDepartments,manageSiteGps,manageAppLogins,manageUsers:has('users.manage'),manageRoles:has('roles.manage')&&!restricted,previewEmployees:plan,viewPayroll:plan&&has('payroll.view'),managePayroll:plan&&has('payroll.view')&&has('payroll.manage'),companyPayroll:!restricted&&plan&&has('payroll.view'),managePayrollGroups:!restricted&&plan&&has('payroll.view')&&has('payroll.manage')&&has('payroll.groups.manage')};
}
function viewer(context) {
  const m=context.member;
  return {userId:m.userId,name:m.name,email:m.email,role:m.role,roleId:context.role.id,roleName:context.role.name,personId:m.personId,version:m.version,memberVersion:m.version,roleVersion:context.role.version,accessScope:clone(m.accessScope),isOwner:context.workspace.ownerUserId===m.userId,preferences:preferences(m.preferences,context,false)};
}
function workspace(row) {return {id:row.id,ownerUserId:row.owner_user_id,snapshotOwnerId:row.snapshot_owner_id};}
async function membership(db,userId) {return member(await first(db,'SELECT * FROM workspace_members WHERE user_id = ?',userId));}
function guard(context,permissions=[]) {return {...(isScoped(context)?{extraCondition:accessGuard(context)}:{}),userId:context.member.userId,workspaceId:context.workspace.id,version:context.member.version,roleId:context.role.id,roleVersion:context.role.version,permissions};}
function actorGuard(context,permissions=[],scopeOverride=null) {
  const scope=scopeOverride||accessGuard(context);
  return {sql:`EXISTS (SELECT 1 FROM workspace_members actor JOIN workspace_roles actor_role
    ON actor_role.workspace_id = actor.workspace_id AND actor_role.id = actor.role_id
    WHERE actor.user_id = ? AND actor.workspace_id = ? AND actor.status = 'active' AND actor.version = ?
    AND actor.role_id = ? AND actor_role.version = ?
    ${permissions.map(()=>"AND EXISTS (SELECT 1 FROM json_each(actor_role.permissions) permission WHERE permission.value = ?)").join(' ')}) AND (${scope.sql})`,
    values:[context.member.userId,context.workspace.id,context.member.version,context.role.id,context.role.version,...permissions,...scope.values]};
}
function referenceAcl(context,acl,personIds=[]){const refs=employeeReferenceGuard({workspaceId:context.workspace.id,personIds:personIds.filter(Boolean)});return {sql:'('+acl.sql+') AND ('+refs.sql+')',values:[...acl.values,...refs.values]};}
async function refreshCommittedDirectoryAccess(db,context,prepared){if(isScoped(context)&&prepared?.statements?.length&&await first(db,'SELECT 1 AS committed WHERE '+prepared.condition.sql,...prepared.condition.values))await loadDepartmentAccess({db,context});}
async function assertContext(db,context) {
  const scope=accessGuard(context),active=await first(db,`SELECT actor.workspace_id,actor.status,actor.version,actor.role_id,actor_role.version AS role_version,
    CASE WHEN ${scope.sql} THEN 1 ELSE 0 END AS scope_valid
    FROM workspace_members actor LEFT JOIN workspace_roles actor_role
    ON actor_role.workspace_id=actor.workspace_id AND actor_role.id=actor.role_id WHERE actor.user_id=?`,...scope.values,context.member.userId);
  if(isScoped(context)&&active?.scope_valid!==1)fail(403,'department_scope_changed','Afdelingerne eller din adgang er ændret. Genindlæs siden.');
  if(!active||active.status!=='active'||active.workspace_id!==context.workspace.id||active.version!==context.member.version||active.role_id!==context.role.id||active.role_version!==context.role.version)
    fail(403,'membership_changed','Din adgang er ændret. Genindlæs siden.');
}

function roleDefinition(row) {
  if(!row)return null;
  let permissions;try{permissions=Roles.normalizePermissions(JSON.parse(row.permissions));}catch{fail(403,'role_invalid','Rollens rettigheder kunne ikke bekræftes.');}
  if(!Number.isSafeInteger(row.version)||row.version<1)fail(403,'role_invalid','Rollens version er ugyldig.');
  return {id:row.id,name:row.name,permissions,version:row.version,isSystem:row.is_system===1,...(Number.isSafeInteger(row.assigned_count)?{assignedCount:row.assigned_count}:{})};
}
async function readRole(db,workspaceId,id) {return roleDefinition(await first(db,'SELECT * FROM workspace_roles WHERE workspace_id = ? AND id = ?',workspaceId,id));}
export async function ensureWorkspaceRoles(db,workspaceId) {
  const stamp=now(),defaults=[['admin','Administrator',Roles.PERMISSION_KEYS],['planner','Vagtplanlægger',['plan']],['planner-departments','Vagtplanlægger med afdelinger',['plan','departments.manage']],['employee','Medarbejder',[]]];
  const oldAdmin=['plan','departments.manage','users.manage','roles.manage'],safePermissions="CASE WHEN json_valid(permissions) THEN permissions ELSE '[]' END";
  const upgrade=`workspace_id = ? AND id = 'admin' AND is_system = 1
    AND json_type(${safePermissions}) = 'array'
    AND (json_array_length(${safePermissions}) = 4 OR (json_array_length(${safePermissions}) = 6
      AND EXISTS (SELECT 1 FROM json_each(${safePermissions}) p WHERE p.value = 'payroll.view')
      AND EXISTS (SELECT 1 FROM json_each(${safePermissions}) p WHERE p.value = 'payroll.manage'))
      OR (json_array_length(${safePermissions}) = 7
      AND EXISTS (SELECT 1 FROM json_each(${safePermissions}) p WHERE p.value = 'payroll.view')
      AND EXISTS (SELECT 1 FROM json_each(${safePermissions}) p WHERE p.value = 'payroll.manage')
      AND EXISTS (SELECT 1 FROM json_each(${safePermissions}) p WHERE p.value = 'payroll.groups.manage')))
    ${oldAdmin.map(()=>`AND EXISTS (SELECT 1 FROM json_each(${safePermissions}) old_permission WHERE old_permission.value = ?)`).join(' ')}`;
  // Established workspaces need a fresh role read, not a migration write batch.
  // Keep every legacy repair below behind the same database-backed preflight;
  // no permission or migration result is cached across requests.
  const pending=await first(db,`SELECT 1 AS pending WHERE
    (SELECT COUNT(*) FROM workspace_roles WHERE workspace_id=? AND id IN ('admin','planner','planner-departments','employee'))<>4
    OR EXISTS (SELECT 1 FROM workspace_roles WHERE ${upgrade})
    OR EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=? AND role_id IS NULL)
    OR EXISTS (SELECT 1 FROM workspace_invites WHERE workspace_id=? AND role_id IS NULL)`,workspaceId,workspaceId,...oldAdmin,workspaceId,workspaceId);
  if(!pending)return false;
  const legacy="CASE WHEN role = 'admin' THEN 'admin' WHEN role = 'planner' AND manage_departments = 1 THEN 'planner-departments' WHEN role = 'planner' THEN 'planner' ELSE 'employee' END";
  await db.batch([
    ...defaults.map(([id,name,permissions])=>statement(db,`INSERT INTO workspace_roles (workspace_id,id,name,permissions,version,is_system,created_at,updated_at)
      VALUES (?,?,?,?,1,1,?,?) ON CONFLICT(workspace_id,id) DO NOTHING`,workspaceId,id,name,JSON.stringify(permissions),stamp,stamp)),
    // Only the previous complete built-in administrator gains newly introduced
    // system permissions. Custom definitions retain their exact grants.
    statement(db,`UPDATE workspace_roles SET permissions = ?,version = version + 1,write_token = ?,updated_at = ?
      WHERE ${upgrade}`,
      JSON.stringify(Roles.PERMISSION_KEYS),crypto.randomUUID(),stamp,workspaceId,...oldAdmin),
    statement(db,`UPDATE workspace_members SET role_id = ${legacy} WHERE workspace_id = ? AND role_id IS NULL`,workspaceId),
    statement(db,`UPDATE workspace_invites SET role_id = ${legacy} WHERE workspace_id = ? AND role_id IS NULL`,workspaceId)
  ]);
  return true;
}

export async function resolveWorkspace(db,principal,options={}) {
  let current=await membership(db,principal.userId);
  if(!current) {
    // Existing production ownership is the only HTTP bootstrap authority.
    const legacy=await first(db,'SELECT revision FROM studio_states WHERE owner_id = ? AND revision > 0',principal.userId);
    if(!legacy)fail(403,'membership_required','Log ind fra forsiden, eller bed din administrator om en invitation.');
    const stamp=now(),id='ws-'+crypto.randomUUID();
    const saved=await readStudio(db,principal.userId),initialPreferences=extractPreferences(saved.studio||{});
    await db.batch([
      statement(db,`INSERT INTO workspaces (id,owner_user_id,snapshot_owner_id,created_at)
        SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM studio_states WHERE owner_id = ? AND revision > 0)
        AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = ?) ON CONFLICT DO NOTHING`,
        id,principal.userId,principal.userId,stamp,principal.userId,principal.userId),
      statement(db,`INSERT INTO workspace_members (user_id,workspace_id,email,name,role,manage_departments,person_id,status,version,preferences,created_at,updated_at)
        SELECT ?,w.id,?,?,'admin',1,NULL,'active',1,?,?,? FROM workspaces w WHERE w.owner_user_id = ? AND w.snapshot_owner_id = ?
        AND EXISTS (SELECT 1 FROM studio_states WHERE owner_id = ? AND revision > 0)
        ON CONFLICT(user_id) DO NOTHING`,principal.userId,principal.email,principal.name,JSON.stringify(initialPreferences),stamp,stamp,
        principal.userId,principal.userId,principal.userId)
    ]);
    current=await membership(db,principal.userId);
  }
  if(!current||current.status!=='active')fail(403,'membership_disabled','Din adgang til arbejdsområdet er deaktiveret.');
  if((!current.roleId&&!ROLES.includes(current.role))||!Number.isSafeInteger(current.version)||current.version<1)fail(403,'membership_invalid','Din adgang kunne ikke bekræftes.');
  const stored=await first(db,'SELECT * FROM workspaces WHERE id = ?',current.workspaceId);
  if(!stored)fail(403,'membership_invalid','Arbejdsområdet kunne ikke findes.');
  if(await ensureWorkspaceRoles(db,current.workspaceId))current=await membership(db,principal.userId);
  if(!current||current.status!=='active')fail(403,'membership_disabled','Din adgang til arbejdsområdet er deaktiveret.');
  const role=await readRole(db,current.workspaceId,current.roleId);
  if(!role)fail(403,'role_invalid','Kontoens rolle findes ikke i arbejdsområdet.');
  Object.assign(current,Roles.legacy(role.permissions));
  const context={member:current,workspace:workspace(stored),role};
  if(current.accessScope.mode==='departments')await loadDepartmentAccess({db,context});
  await staffContext(db,context,options.employeeOnly&&!role.permissions.includes('plan')?{...options,metadataOnly:true,directoryOnly:true}:options);
  if(!context.access)await loadDepartmentAccess({db,context});
  if(current.personId&&!rosterHas(context,current.personId)||!role.permissions.length&&!current.personId)fail(403,'person_assignment_required','Din konto skal knyttes til en medarbejder i arbejdsområdet.');
  if(context.workspace.ownerUserId===current.userId&&isScoped(context))fail(403,'owner_membership_invalid','Ejerens adgang skal omfatte hele virksomheden.');
  if(context.workspace.ownerUserId===current.userId&&(role.id!=='admin'||!role.isSystem||!Roles.canGrant(role.permissions,Roles.PERMISSION_KEYS)))fail(403,'owner_membership_invalid','Ejerens adgang skal gendannes af administratoren.');
  return context;
}

function extractPreferences(studio) {return Object.fromEntries(PREFS.filter(key=>Object.hasOwn(studio,key)).map(key=>[key,studio[key]]));}
function sharedData(value) {
  if(Array.isArray(value))return value.map(sharedData);
  if(record(value))return Object.fromEntries(Object.entries(value).filter(([key])=>!PAYROLL_FIELDS.has(key)).map(([key,item])=>[key,sharedData(item)]));
  return value;
}
function hasSharedPayroll(value) {return Array.isArray(value)?value.some(hasSharedPayroll):record(value)?Object.entries(value).some(([key,item])=>PAYROLL_FIELDS.has(key)||hasSharedPayroll(item)):false;}
function sharedStudio(studio) {const result=sharedData(studio);for(const key of PRIVATE_KEYS)delete result[key];return result;}
function preferences(input,context,strict=true) {
  if(!record(input)) {if(strict)fail(400,'invalid_preferences','Indstillinger skal være et objekt.');return {};}
  const result={};
  for(const [key,value] of Object.entries(input)) {
    if(!PREFS.includes(key)){if(strict)fail(400,'invalid_preferences','Indstillingen kan ikke gemmes.');continue;}
    let valid=false;
    if(key==='role')valid=['admin','employee'].includes(value)&&((capabilities(context).plan||capabilities(context).manageUsers||capabilities(context).manageRoles||capabilities(context).manageChat)||value==='employee');
    else if(key==='page'||key==='demoReturnPage')valid=['schedule','people','hours','leave','series','demo','accounts','worksite','workspace','activity','payroll','workflow','chat'].includes(value);
    else if(key==='group')valid=['people','sites'].includes(value);
    else if(key==='view')valid=['auto','week','day'].includes(value);
    else if(key==='employeeView')valid=['month','week','day'].includes(value);
    else if(key==='zoom')valid=[1,2,4].includes(value);
    else if(['calendarLayoutVersion','employeeCalendarVersion'].includes(key))valid=Number.isInteger(value)&&value>=0&&value<=10;
    else if(key==='day')valid=Number.isInteger(value)&&value>=0&&value<=6;
    else if(key==='onlyOpen')valid=typeof value==='boolean';
    else if(key==='week')valid=Number.isInteger(value)&&value>=-52&&value<=52;
    else if(key==='pageIndex')valid=Number.isInteger(value)&&value>=0&&value<=1000;
    else if(key==='search')valid=typeof value==='string'&&value.length<=500;
    else if(key==='site')valid=value==='all'||typeof value==='string'&&/^\d{1,4}$/.test(value)&&Number(value)<2000;
    else if(key==='departmentId')valid=typeof value==='string'&&value.length>0&&value.length<=256;
    else if(key==='employeePerson')valid=rosterHas(context,value)&&(capabilities(context).plan||value===context.member.personId);
    else if(['employeeDate','employeeWeek'].includes(key))valid=Actions.validDate(value)&&value>=Data.minDate&&value<=Data.maxDate;
    else if(key==='calendarAnchor')valid=Actions.validDate(value)&&value>=Data.minDate&&value<=Data.maxDate&&new Date(value+'T12:00:00Z').getUTCDay()===1;
    else if(key==='worksiteDate')valid=Actions.validDate(value)&&value>=Data.minDate&&value<=Data.maxDate;
    else if(key==='worksiteSite')valid=Number.isInteger(value)&&value>=0&&value<2000;
    else if(key==='employeeShift')valid=value===null||typeof value==='string'&&value.length<=512;
    if(valid&&isScoped(context)){if(key==='site'&&value!=='all')valid=siteAllowed(context,Number(value));if(key==='worksiteSite')valid=siteAllowed(context,value);if(key==='departmentId'&&value!=='all')valid=departmentAllowed(context,value);if(key==='employeePerson')valid=context.staff.some(person=>person.id===value&&siteAllowed(context,person.site));}
    if(!valid){if(strict)fail(400,'invalid_preferences','En indstilling har en ugyldig værdi.');continue;}
    result[key]=value;
  }
  return result;
}

function addDays(value,count) {const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);}
export function employeeProjection(studio,personId) {
  const person=Data.staffFor(studio).find(item=>item.id===personId);
  if(!person)fail(403,'person_assignment_required','Din konto er ikke knyttet til en medarbejder.');
  const shifts=Publication.publishedShifts(studio,personId),sites=Publication.publishedSites(studio,personId);
  const owned=new Set(shifts.map(shift=>shift.id)),reconciled=Checklist.reconcile(studio.checklistProgress,shifts);
  const progress=Object.fromEntries(Object.entries(reconciled).filter(([,entry])=>entry.person===personId&&owned.has(entry.shiftId)));
  const leaveRequests=Data.leaveRequests(studio).filter(item=>item.p===personId).map(item=>({...item,status:studio.requests?.[item.id]||item.status,...(studio.leaveDecisions?.[item.id]?{decision:clone(studio.leaveDecisions[item.id])}:{})}));
  return {person:sharedData(person),shifts,sites,progress,leaveRequests,minDate:Data.minDate,maxDate:Data.maxDate};
}

function response(body,status=200,extraHeaders={}) {return Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie, oai-authenticated-user-id, X-CleanRooms-Workspace','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extraHeaders}});}
function errorResponse(error) {
  if(error instanceof StudioError&&error.status===429){const requestId=error.requestId||crypto.randomUUID(),retryAfter=Number.isSafeInteger(error.retryAfterSeconds)&&error.retryAfterSeconds>0?Math.min(error.retryAfterSeconds,3600):60;return response({error:error.code,message:error.message,requestId},429,{'Retry-After':String(retryAfter),'X-Request-ID':requestId});}
  if(error instanceof StudioError||error instanceof PlanningStoreError||error instanceof DirectoryError||Number.isInteger(error?.status)&&/^(directory_|employee_|department_)/.test(error?.code||''))return response({error:error.code,message:error.message,...(error.conflicts?{conflicts:error.conflicts}:{})},error.status);
  if(/UNIQUE constraint failed: workspace_members|workspace_members_active_person_unique/i.test(String(error?.message)))return response({error:'member_conflict',message:'Medarbejderen eller kontoen er allerede tilknyttet. Hent den seneste liste.'},409);
  const requestId=crypto.randomUUID();
  console.error(JSON.stringify({event:'storage_failed',requestId,errorType:typeof error?.name==='string'?error.name:'Error'}));
  return response({error:'storage_failed',requestId,message:'Handlingen kunne ikke gennemføres. Prøv igen; eksisterende data er bevaret.'},500);
}
function sameOrigin(request) {
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if(origin!==new URL(request.url).origin||site&&!['same-origin','none'].includes(site))fail(403,'same_origin_required','Brug handlingen fra denne side.');
}
async function requestJSON(request,maxBytes) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'json_required','Send handlingen som JSON.');
  if(Number(request.headers.get('content-length'))>maxBytes)fail(413,'body_too_large','Handlingen indeholder for mange data.');
  if(!request.body)fail(400,'invalid_request','Handlingen mangler.');
  const reader=request.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail(413,'body_too_large','Handlingen indeholder for mange data.');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(decode.decode(bytes));}catch{fail(400,'invalid_request','Handlingen er ikke gyldig JSON.');}
}
async function database(value) {const db=typeof value==='function'?await value():value;if(!db)fail(503,'storage_unavailable','Lagringen er midlertidigt utilgængelig.');return db;}

function readProjection(value){
  try{return PlanningScope.normalize(value);}catch(error){fail(400,'invalid_calendar_window',error.message);}
}
function requestedCalendar(request,payload){
  if(request.method!=='GET')return payload?.projection===undefined?null:readProjection(payload.projection);
  const params=new URL(request.url).searchParams,keys=['projection','from','to','selection','cursor','instructions'];
  if(!keys.some(key=>params.has(key)))return null;
  if(keys.some(key=>params.getAll(key).length>1))fail(400,'invalid_calendar_window','Planvisningens afgrænsning er angivet flere gange.');
  if(params.has('instructions')&&params.get('instructions')!=='deferred')fail(400,'invalid_calendar_window','Kalenderens instruktionsvisning er ugyldig.');
  if(params.get('projection')==='calendar'){
    if(params.has('selection'))fail(400,'invalid_calendar_window','Kalenderperioden er ugyldig.');
    return readProjection({mode:'calendar',from:params.get('from'),to:params.get('to')});
  }
  if(params.has('from')||params.has('to'))fail(400,'invalid_calendar_window','Planvisningens afgrænsning er ugyldig.');
  let selection;try{selection=JSON.parse(params.get('selection'));}catch{fail(400,'invalid_calendar_window','Planvisningens afgrænsning er ugyldig.');}
  if(selection?.mode!==params.get('projection'))fail(400,'invalid_calendar_window','Planvisningens type stemmer ikke overens.');
  return readProjection(selection);
}
function projectRead(studio,receipt,projection,changes){return projection.mode==='calendar'?projectStudioWindow(studio,receipt,projection,changes):projectStudioSelection(studio,receipt,projection,changes);}
function scopeExtras(result){return Object.fromEntries(['selection','availability','catalog'].filter(key=>result[key]!==undefined).map(key=>[key,result[key]]));}
function planningAckRows(rows,instructions){return instructions==='deferred'?rows.map(row=>row.kind==='week'&&row.value?{...row,value:PlanningScope.compact('week',row.id,row.value)}:row):rows;}
function containsDeferredInstructions(value){
  const pending=[value];while(pending.length){const current=pending.pop();if(!current||typeof current!=='object')continue;if(Object.hasOwn(current,'_instructions'))return true;for(const item of Object.values(current))if(item&&typeof item==='object')pending.push(item);}return false;
}

async function calendarPage(db,context,projection,cursor,instructions){
  // One-time operational imports must see the trusted legacy source before
  // the planning-window migration trims its redundant collections.
  const helpers={capabilities,actorGuard,assertContext,fail};
  await ensureEngagement(db,context,helpers);await ensureAbsences(db,context,helpers);
  const page=await (projection.mode==='calendar'?readStudioWindow:readStudioSelection)(db,context.workspace.snapshotOwnerId,{...projection,cursor,...(instructions==='deferred'?{instructions}:{}),context});
  const pageShifts=(page.publicationRows||[]).filter(row=>row.kind==='shift'&&!row.value.shift?._instructions).map(row=>row.value.shift);
  const progress=pageShifts.length?await readChecklistProgress(db,context,{shifts:pageShifts}):{};
  const firstPage=page.studio!==undefined,own=viewer(context);
  const requestSite=jsonSitePredicate(context,'request.config','$.shift.site'),requestFrom=personPredicate(context,'request.from_person_id'),requestTo=personPredicate(context,'request.to_person_id'),seriesSite=sitePredicate(context,'series.site_index'),seriesPerson=personPredicate(context,'series.person_id'),absencePerson=personPredicate(context,'absence.person_id');
  const summaries=firstPage?await db.batch([
    statement(db,`SELECT COUNT(*) AS n FROM workspace_shift_requests request WHERE workspace_id=? AND status='pending' AND ${requestSite.sql} AND (request.from_person_id IS NULL OR request.from_person_id='' OR ${requestFrom.sql}) AND (request.to_person_id IS NULL OR request.to_person_id='' OR ${requestTo.sql})`,context.workspace.id,...requestSite.values,...requestFrom.values,...requestTo.values),
    statement(db,`SELECT COUNT(DISTINCT COALESCE(NULLIF(group_id,''),id)) AS n FROM workspace_plan_records series WHERE workspace_id=? AND kind='series' AND deleted=0 AND ${seriesSite.sql} AND (series.person_id IS NULL OR series.person_id='' OR ${seriesPerson.sql})`,context.workspace.id,...seriesSite.values,...seriesPerson.values),
    statement(db,`SELECT COUNT(*) AS n FROM workspace_absences absence WHERE workspace_id=? AND status='pending' AND ${absencePerson.sql}`,context.workspace.id,...absencePerson.values)
  ]):null;
  const workflowSummary=firstPage?{pendingCount:Number(summaries[0]?.results?.[0]?.n||0)}:undefined;
  const planningSummary=firstPage?{seriesCount:Number(summaries[1]?.results?.[0]?.n||0),pendingAbsenceCount:Number(summaries[2]?.results?.[0]?.n||0)}:undefined;
  await assertContext(db,context);
  return {...page,...(firstPage?{studio:page.studio?{...sharedStudio(page.studio),...own.preferences}:null,viewer:own,capabilities:capabilities(context),workspace:{id:context.workspace.id},workflowSummary,planningSummary}:{}),progress};
}

// The request projection controls the client cache only. Authority is selected
// from validated command targets/dependencies and the server's publication closure.
async function saveScopedPlanning({db,context,principal,payload,projection,onContext=()=>{}}){
  const validation=Planning.validatePlanning(payload.planning);if(validation.length)fail(400,'invalid_planning_command',validation[0]);
  if(projection&&projection.mode!=='series'&&payload.planning.changes.some(change=>change.kind==='series'))fail(409,'complete_plan_required','Indlæs hele aftalen, før du ændrer en vagtserie.');
  if(payload.publication!==undefined&&payload.planning.changes.some(change=>change.kind!=='week'))fail(409,'publication_requires_saved_draft','Gem kladden, og gennemgå udgivelsen igen.');
  for(let attempt=0;attempt<4;attempt++){
    if(attempt){context=await resolveWorkspace(db,principal,{metadataOnly:true});onContext(context);}
    if(!capabilities(context).plan)fail(403,'planning_forbidden','Din konto kan ikke ændre vagtplanen.');
    const h={capabilities,actorGuard,assertContext,fail};
    // Cold legacy imports see their original source once. Warm writes read only
    // their completion markers, shared metadata and the selected record family.
    await ensureEngagement(db,context,h);await ensureAbsences(db,context,h);
    let raw=context.saved;
    try{
      if(!await initializePlanningCommandStorage({db,workspaceId:context.workspace.id,owner:context.workspace.snapshotOwnerId,raw,splitSnapshot}))continue;
      raw=await readRawStudio(db,context.workspace.snapshotOwnerId);context.saved=raw;
      if(payload.publication!==undefined&&payload.revision!==raw.revision)fail(409,'revision_conflict','Planen er ændret. Hent den seneste version.');
      const originalHistory=clone(raw.studio?.activity||[]);
      let previous=await readPlanningCommandContext({db,workspaceId:context.workspace.id,owner:context.workspace.snapshotOwnerId,raw,payload,context}),publicationContext=null;
      let directoryContext=await directoryPlanningContext({db,workspaceId:context.workspace.id,studio:previous.studio});previous.studio=directoryContext.studio;
      if(payload.publication!==undefined&&payload.directoryRevision!==directoryContext.directory.revision)fail(409,'directory_review_changed','Medarbejdere eller arbejdssteder er ændret. Gennemgå udgivelsen igen.');
      if(payload.publication!==undefined){
        publicationContext=await readPublicationPlanningContext({db,workspaceId:context.workspace.id,raw:{...raw,source:raw.source,studio:directoryContext.studio},scope:payload.publication});
        assertPlanningScopesAccess(context,publicationContext.selection);
        const source=previous.source,receipt=previous.planning,studio=Planning.apply(publicationContext.before,Planning.flatten(previous.studio));
        const selectedDirectory=await directoryPlanningContext({db,workspaceId:context.workspace.id,studio});if(selectedDirectory.directory.revision!==directoryContext.directory.revision)fail(409,'directory_changed','Medarbejderne er ændret. Gennemgå udgivelsen igen.');directoryContext=selectedDirectory;previous={...previous,studio:selectedDirectory.studio};Object.defineProperty(previous,'source',{value:source});Object.defineProperty(previous,'planning',{value:{...receipt,versions:{...publicationContext.planning.versions,...receipt.versions}}});
      }
      context.saved=previous;
      const submission=preparePlanningSubmission(payload,previous);
      await assertPlanningCommandAccess({db,context,before:previous.studio,changes:submission.changes,publication:payload.publication});
      const ownPreferences={...preferences(context.member.preferences,context,false),...preferences(extractPreferences(payload.studio),context,false)};
      if(payload.publication===undefined&&!submission.changes.length){
        const own=actorGuard(context,['plan']),changed=await db.batch([statement(db,`UPDATE workspace_members SET preferences=?,updated_at=? WHERE user_id=? AND workspace_id=? AND ${own.sql}`,JSON.stringify(ownPreferences),now(),principal.userId,context.workspace.id,...own.values)]);
        if(changed[0]?.meta?.changes!==1)fail(403,'membership_changed','Din adgang er ændret.');await assertContext(db,context);
        return {revision:previous.revision,recordPatch:true,reconciledRecords:[],planning:{schema:1,...(projection?{partial:true,projection}:{}),versions:{},metadataHash:payload.planning.metadataBase},requiresRefresh:payload.revision!==previous.revision};
      }
      let old=sharedStudio(previous.studio),next=sharedStudio(submission.studio);old.activity=[];next.activity=[];
      let publication=null,lineage=null,attendanceVersion,engagement=()=>[];
      const actor={userId:principal.userId,name:principal.name},at=now();
      if(payload.publication!==undefined){
        try{const published=Publication.publish(next,{...payload.publication,actor,at});next=published.studio;publication=published.record;}catch(error){fail(400,'invalid_publication',error.message);}
        const beforeShifts=Publication.publishedShifts(old),afterShifts=Publication.publishedShifts(next),neighbors=publicationContext.publishedNeighbors;
        const overlap=publicationCommandConflict({afterShifts,publishedNeighbors:neighbors,scopes:publication.scopes});
        if(overlap)fail(400,'publication_conflict','Udgivelsen giver overlappende vagter den '+overlap[0].date+'. Ret de berørte vagter, og udgiv de relevante arbejdssteder samlet.');
        await assertNoPublishedAbsence(db,context.workspace.id,afterShifts);
        const attendance=await ensureTimeEntries({db,workspaceId:context.workspace.id,context,helpers:{actorGuard,fail}});attendanceVersion=attendance.row?.version||0;
        const afterById=new Map(afterShifts.map(shift=>[shift.id,shift])),changedIds=beforeShifts.filter(shift=>{const value=afterById.get(shift.id);return !value||value.person!==shift.person||value.date!==shift.date;}).map(shift=>shift.id);
        for(let offset=0;offset<changedIds.length;offset+=1000){const entries=await rows(db,'SELECT shift_id,person_id,work_date,status FROM workspace_time_entries WHERE workspace_id=? AND demo=0 AND shift_id IN (SELECT value FROM json_each(?))',context.workspace.id,JSON.stringify(changedIds.slice(offset,offset+1000)));for(const entry of entries){const shift=afterById.get(entry.shift_id);if(shift&&(shift.person!==entry.person_id||shift.date!==entry.work_date)||!shift&&['running','paused'].includes(entry.status))fail(409,'publication_attendance_locked','Vagten har registrerede timer. Medarbejder og dato skal bevares; en igangværende vagt skal afsluttes før aflysning.');}}
        const beforeSites=[];for(const slot of Object.values(old.publications?.slots||{}))beforeSites[slot.site]=slot.location;
        engagement=await preparePublicationEngagement({db,workspaceId:context.workspace.id,beforeShifts,afterShifts,sites:next.organization?.sites||Departments.defaultOrganization().sites,beforeSites,at});
      }else if(submission.changes.some(change=>change.kind==='series')){
        lineage=await readPublicationLineage({db,workspaceId:context.workspace.id,before:old,after:next});
        if(lineage.changed){old.publications=lineage.before.publications;next.publications=lineage.after.publications;}
      }
      validateStudio(next,{previous:old});appendActivity(next,old,actor,previous.revision+1,at,publication);
      const entries=[...originalHistory,...next.activity],persisted={...next,activity:[],checklistProgress:{},shiftWorkflow:ShiftWorkflow.empty()};delete persisted.absences;delete persisted.absenceHasMore;
      const source=previous.source,receipt=previous.planning,saved={...previous,studio:old};Object.defineProperty(saved,'source',{value:source});Object.defineProperty(saved,'planning',{value:receipt});Object.defineProperty(saved,'directory',{value:directoryContext.directory});
      const scopeCommit=accessGuard(context),baseDirectoryGuard=publication?{sql:'('+directoryContext.guard.sql+') AND ('+absenceGuard(context).sql+')',values:[...directoryContext.guard.values,...absenceGuard(context).values]}:directoryContext.guard,directoryCommitGuard={sql:'('+baseDirectoryGuard.sql+') AND ('+scopeCommit.sql+')',values:[...baseDirectoryGuard.values,...scopeCommit.values]};
      const result=await writeStudio(db,context.workspace.snapshotOwnerId,previous.revision,persisted,{
        ...guard(context,['plan']),extraCondition:directoryCommitGuard,...(publication?{workflowLedgerVersion:attendanceVersion}:{}),preferences:JSON.stringify(ownPreferences),
        commandContext:{saved,prepare:async options=>{
          const plan=await preparePlanningCommandWrite({...options,changes:submission.changes});
          if(publication||lineage?.changed){const publications=await preparePublicationCommandWrite({...options,before:old,after:next,scopeKeys:publicationContext?.selection.scopeKeys||[]});plan.statements.push(...publications);if(publications.guard){plan.guard.sql+=' AND ('+publications.guard.sql+')';plan.guard.values.push(...publications.guard.values);}}
          return plan;
        }},auditStatements:condition=>[...archiveStatements({db,workspaceId:context.workspace.id,entries,condition}),...engagement(condition)]
      });
      await assertContext(db,context);
      if(!result.ok){if(!publication&&attempt<3)continue;fail(409,'revision_conflict','Planen eller kontrolgrundlaget er ændret. Hent den seneste version.');}
      return {revision:result.revision,recordPatch:true,reconciledRecords:planningAckRows(filterPlanningRows(context,result.reconciledRecords,previous.studio),payload.instructions),planning:{...result.planning,...(projection?{partial:true,projection}:{}),metadataHash:payload.planning.metadataBase},requiresRefresh:Boolean(publication)||submission.rebased||Boolean(projection)&&submission.changes.some(change=>change.kind==='series')};
    }catch(error){
      if(error?.code==='planning_command_conflict'&&payload.publication===undefined&&attempt<3)continue;
      if(error instanceof StudioError||error instanceof PlanningStoreError)throw error;
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599&&typeof error.code==='string')throw new StudioError(error.status,error.code,error.message);
      throw error;
    }
  }
  fail(409,'revision_conflict','Planen ændrer sig. Hent den seneste version, før du prøver igen.');
}

async function handleWorkspaceStudioRequestInternal(request,storage,onContext) {
  try {
    if(!['GET','PUT'].includes(request.method))return response({error:'method_not_allowed'},405);
    if(request.method==='PUT')sameOrigin(request);
    const requestAuth=requestIdentity(request);
    const payload=request.method==='PUT'?await requestJSON(request,MAX_BODY_BYTES):null;
    if(payload?.instructions!==undefined&&payload.instructions!=='deferred')fail(400,'invalid_calendar_window','Kalenderens instruktionsvisning er ugyldig.');
    const projection=requestedCalendar(request,payload);
    const fastCommand=request.method==='PUT'&&payload?.commandReceipt==='records'&&record(payload?.planning)&&payload.planning.metadataChanged===false;
    const {db,signedIn,usingWeb}=await requestPrincipal(request,storage,requestAuth);
    const principal=await selectedCompanyPrincipal(db,signedIn,request,usingWeb);let context=await resolveWorkspace(db,principal,{metadataOnly:request.method==='GET'&&Boolean(projection)||fastCommand,employeeOnly:request.method==='GET'});const initialCaps=capabilities(context);onContext(context);
    if(request.method==='GET') {
      if(projection&&initialCaps.plan)return response(await calendarPage(db,context,projection,new URL(request.url).searchParams.get('cursor'),new URL(request.url).searchParams.get('instructions')));
      if(!initialCaps.plan){
        const own=viewer(context),prefs=own.preferences||{},view=['month','week','day'].includes(prefs.employeeView)?prefs.employeeView:'month',focus=Actions.validDate(prefs.employeeDate)?prefs.employeeDate:Data.todayFor(),range=EmployeeCalendar.range(view,focus);
        const employee=context.member.personId?await handleEmployeeRead({db,context,payload:{action:'employeeRead',from:range.from,to:range.to},helpers:{capabilities,actorGuard,assertContext,fail,ensureOperationalPlanningSource:sourceContext=>ensureOperationalPlanningSource(db,sourceContext),ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)}}):null;
        if(employee){await ensureAbsences(db,context,{capabilities,actorGuard,assertContext,fail,ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)});employee.leaveRequests=(await handleAbsenceAction({db,context,payload:{action:'leaveRead',limit:100},principal,helpers:{capabilities,actorGuard,assertContext}})).requests;}
        await assertContext(db,context);return response({revision:context.saved.revision,studio:null,employee,viewer:own,capabilities:initialCaps,workspace:{id:context.workspace.id}});
      }
      if(isScoped(context))fail(403,'department_projection_required','Åbn den afgrænsede kalender for dine afdelinger.');
      if(context.metadataOnly){context=await resolveWorkspace(db,principal);onContext(context);}
      const saved=context.saved;await assertContext(db,context);
      const own=viewer(context),caps=initialCaps,employee=!caps.plan&&context.member.personId&&saved.studio?employeeProjection(saved.studio,context.member.personId):null;
      // Legacy snapshots may omit unchanged defaults internally. A complete
      // directory receipt must also include those effective aliases on the wire.
      const directoryAliases=caps.plan&&saved.studio&&saved.directory?.complete?{roster:Data.staffFor(saved.studio),organization:saved.studio.organization??Departments.defaultOrganization()}:{};
      return response({revision:saved.revision,studio:caps.plan&&saved.studio?{...sharedStudio({...saved.studio,...directoryAliases}),...own.preferences,...(saved.directory?{directoryRevision:saved.directory.revision}:{})}:null,...(caps.plan&&saved.planning?{planning:planningReceipt(saved)}:{}),...(caps.plan&&saved.directory?{directory:saved.directory}:{}),employee,viewer:own,capabilities:caps,workspace:{id:context.workspace.id}});
    }
    if(!initialCaps.plan)fail(403,'planning_forbidden','Din konto kan ikke ændre vagtplanen.');
    if(isScoped(context)&&!fastCommand)fail(403,'department_commands_required','Åbn den afgrænsede kalender eller vagtserie, før du gemmer ændringer.');
    if(!record(payload)||!Number.isSafeInteger(payload.revision)||payload.revision<0||payload.revision>=Number.MAX_SAFE_INTEGER)fail(400,'invalid_request','Send en gyldig revision og plan.');
    const modern=payload.planning!==undefined;
    if(projection?.catalogOnly===true&&(payload.publication!==undefined||!Array.isArray(payload.planning?.changes)||payload.planning.changes.length))fail(409,'planning_catalog_readonly','Åbn vagtserien eller den berørte kalenderperiode, før du ændrer vagter.');
    if(projection&&!modern)fail(400,'calendar_commands_required','En delvist indlæst kalender skal gemmes som ændringer med versionsnumre.');
    if(projection&&payload.publication!==undefined){
      const selected=projection.mode==='publication'&&readProjection({...payload.publication,mode:'publication',calendar:projection.calendar});
      if(!selected||JSON.stringify(selected)!==JSON.stringify(projection))fail(409,'complete_plan_required','Gennemgå den valgte udgivelsesperiode, før du udgiver.');
    }
    if(!record(payload.studio))fail(400,'invalid_request','Send en gyldig plan.');
    if(containsDeferredInstructions(modern?payload.planning?.changes:payload.studio))fail(409,'planning_details_required','Hent de berørte vagters instruktioner, før du gemmer ændringen.');
    if(hasSharedPayroll({studio:payload.studio,planning:payload.planning??null}))fail(400,'payroll_separate','Lønoplysninger skal gemmes separat fra vagtplanen.');
    if(isScoped(context)){if(context.saved.studio?.demoSession||payload.studio.demoSession)fail(403,'department_demo_forbidden','Eksempler på tværs af virksomheden kræver adgang til alle afdelinger.');return response(await saveScopedPlanning({db,context,principal,payload,projection,onContext}));}
    if(fastCommand&&!context.saved.studio?.demoSession&&!payload.studio.demoSession)return response(await saveScopedPlanning({db,context,principal,payload,projection,onContext}));
    if(context.metadataOnly){context=await resolveWorkspace(db,principal);onContext(context);}
    for(let attempt=0;attempt<4;attempt++){
    const caps=capabilities(context);if(!caps.plan)fail(403,'planning_forbidden','Din konto kan ikke ændre vagtplanen.');
    const previous=context.saved;
    if((!modern||payload.publication!==undefined)&&payload.revision!==previous.revision){await assertContext(db,context);return response({error:'revision_conflict',message:'Planen er ændret. Hent den seneste version.',revision:previous.revision,...(!projection?{studio:previous.studio?{...sharedStudio(previous.studio),...viewer(context).preferences}:null}:{})},409);}
    const submission=modern?preparePlanningSubmission(payload,previous):null;
    if(projection&&projection.mode!=='series'&&submission.changes.some(change=>change.kind==='series'))fail(409,'complete_plan_required','Indlæs hele aftalen, før du ændrer en vagtserie.');
    if(modern&&payload.publication===undefined&&!payload.planning.metadataChanged&&!submission.changes.length){
      const ownPreferences={...preferences(context.member.preferences,context,false),...preferences(extractPreferences(payload.studio),context,false)},own=actorGuard(context,['plan']);
      const changed=await db.batch([statement(db,`UPDATE workspace_members SET preferences=?,updated_at=? WHERE user_id=? AND workspace_id=? AND ${own.sql}`,JSON.stringify(ownPreferences),now(),principal.userId,context.workspace.id,...own.values)]);
      if(changed[0]?.meta?.changes!==1)fail(403,'membership_changed','Din adgang er ændret.');
      await assertContext(db,context);
      const scoped=projection?projectRead(previous.studio,planningReceipt(previous),projection,[]):null;
      return response({revision:previous.revision,planning:scoped?.planning||planningReceipt(previous),...(scoped?scopeExtras(scoped):{}),reconciledStudio:{...sharedStudio(scoped?.studio||previous.studio),...ownPreferences}});
    }
    const old=sharedStudio(previous.studio||{});
    let next=validateStudio(sharedStudio(submission?submission.studio:payload.studio),{previous:old});
    if(!Object.hasOwn(next,'roster')&&Object.hasOwn(old,'roster'))next.roster=clone(old.roster);
    if(!Object.hasOwn(next,'workspaceSettings')&&Object.hasOwn(old,'workspaceSettings'))next.workspaceSettings=clone(old.workspaceSettings);
    if(Object.hasOwn(old.workspaceSettings||{},'workHoursBudget')&&record(next.workspaceSettings)&&!Object.hasOwn(next.workspaceSettings,'workHoursBudget'))next.workspaceSettings.workHoursBudget=clone(old.workspaceSettings.workHoursBudget);
    if(Object.hasOwn(old.workspaceSettings||{},'payrollPeriod')&&record(next.workspaceSettings)&&!Object.hasOwn(next.workspaceSettings,'payrollPeriod'))next.workspaceSettings.payrollPeriod=clone(old.workspaceSettings.payrollPeriod);
    if(!Object.hasOwn(next,'demoSeed')&&Object.hasOwn(old,'demoSeed'))next.demoSeed=old.demoSeed;
    const storedSites=old.organization?.sites||Departments.defaultOrganization().sites,previousSites=new Map(storedSites.map(site=>[site.id,site]));
    for(const site of next.organization?.sites||[]){
      const previousSite=previousSites.get(site.id);
      // Older clients omit the field. An explicit value is required to change it.
      if(previousSite&&Object.hasOwn(previousSite,'gps')&&!Object.hasOwn(site,'gps'))site.gps=clone(previousSite.gps);
      if(previousSite&&Object.hasOwn(previousSite,'worksiteInfo')&&!Object.hasOwn(site,'worksiteInfo'))site.worksiteInfo=clone(previousSite.worksiteInfo);
      if(!caps.manageDepartments&&!same(site.worksiteInfo,previousSite?.worksiteInfo))fail(403,'site_info_forbidden','Du har ikke adgang til at ændre arbejdsstedets faste oplysninger.');
      if(!caps.manageSiteGps&&!same(site.gps,previousSite?.gps))fail(403,'site_gps_forbidden','Kun en administrator kan ændre GPS-indstillinger for arbejdssteder.');
    }
    let scopedBudgetsChanged=false;
    for(const kind of ['sites','departments']){
      const prior=new Map((old.organization?.[kind]||Departments.defaultOrganization()[kind]).map(item=>[item.id,item]));
      for(const item of next.organization?.[kind]||[]){
        const previousItem=prior.get(item.id);
        // Omission from a rolling older client cannot erase a configured limit.
        if(previousItem&&Object.hasOwn(previousItem,'workHoursBudget')&&!Object.hasOwn(item,'workHoursBudget'))item.workHoursBudget=clone(previousItem.workHoursBudget);
        if(!same(item.workHoursBudget,previousItem?.workHoursBudget))scopedBudgetsChanged=true;
      }
    }
    if(scopedBudgetsChanged&&!caps.manageUsers)fail(403,'workspace_budget_forbidden','Du har ikke adgang til at ændre virksomhedens timebudgetter.');
    const peopleChanged=!same(Data.staffFor(old),Data.staffFor(next)),settingsChanged=!same(old.workspaceSettings||{},next.workspaceSettings||{}),demoChanged=(old.demoSeed!==false)!==(next.demoSeed!==false);
    const organizationChanged=!same(old.organization||Departments.defaultOrganization(),next.organization||Departments.defaultOrganization());
    if((peopleChanged||settingsChanged||demoChanged)&&!caps.manageUsers)fail(403,'workspace_forbidden','Du har ikke adgang til at ændre medarbejdere, virksomhedsindstillinger eller eksempeldata.');
    const rosterIds=Data.staffFor(next).map(person=>person.id);
    if(peopleChanged){
      const linked=await rows(db,'SELECT person_id FROM workspace_members WHERE workspace_id = ? AND person_id IS NOT NULL',context.workspace.id);
      if(linked.some(item=>!rosterIds.includes(item.person_id)))fail(400,'person_still_linked','En medarbejder med en tilknyttet konto må ikke slettes. Arkivér medarbejderen i stedet.');
      const payrollLinked=await rows(db,'SELECT person_id FROM workspace_payroll WHERE workspace_id = ?',context.workspace.id);
      if(payrollLinked.some(item=>!rosterIds.includes(item.person_id)))fail(400,'payroll_person_linked','En medarbejder med lønoplysninger må ikke slettes. Arkivér medarbejderen i stedet.');
      const policyRow=await first(db,'SELECT * FROM workspace_payroll_policies WHERE workspace_id = ?',context.workspace.id);
      if(policyResult(policyRow).policy.links.some(link=>!rosterIds.includes(link.personId)))fail(400,'payroll_person_linked','En medarbejder med en løngruppetilknytning må ikke slettes. Arkivér medarbejderen i stedet.');
      const recorded=await first(db,`SELECT person_id FROM workspace_absences WHERE workspace_id=? AND COALESCE(json_extract(config,'$.legacy'),0)=0 AND person_id NOT IN (SELECT value FROM json_each(?)) UNION ALL SELECT person_id FROM workspace_time_entries WHERE workspace_id=? AND person_id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`,context.workspace.id,JSON.stringify(rosterIds),context.workspace.id,JSON.stringify(rosterIds));
      if(recorded)fail(400,'person_has_records','En medarbejder med fravær eller registrerede timer må ikke slettes. Arkivér medarbejderen i stedet.');
    }
    if(!caps.manageDepartments) {
      const effective=previous.studio?.organization||Departments.defaultOrganization();
      if(modern?!same(next.organization,effective):!Object.hasOwn(payload.studio,'organization')||!same(payload.studio.organization,effective))fail(403,'departments_forbidden','Du har ikke adgang til at ændre afdelinger og arbejdssteder.');
    }
    next.absences=clone(old.absences||[]);
    next.requests={...Object.fromEntries(next.absences.map(item=>[item.id,item.status])),...Object.fromEntries(Object.entries(next.requests).filter(([id])=>!id.startsWith('absence-')))};
    // New requests have an explicit versioned command; a stale plan cannot decide them.
    for(const item of next.absences)if(!item.legacy)next.requests[item.id]=item.status;
    if(next.demoSession){next.requests=clone(old.requests||{});next.leaveDecisions=clone(old.leaveDecisions||{});}
    next.publications=clone(old.publications||Publication.empty());next.activity=clone(old.activity||[]);next.checklistProgress=clone(old.checklistProgress||{});
    if(Object.hasOwn(old,'shiftWorkflow'))next.shiftWorkflow=clone(old.shiftWorkflow);else delete next.shiftWorkflow;
    try{next=Publication.withLineage(old,next);}catch(error){fail(400,'invalid_series_change',error.message);}
    const actor={userId:principal.userId,name:principal.name},at=now();let publication=null,attendanceVersion;
    leaveDecisions(old,next,actor,at);
    if(payload.publication!==undefined){
      try{const result=Publication.publish(next,{...payload.publication,actor,at});next=result.studio;publication=result.record;}
      catch(error){return response({error:'invalid_publication',message:error.message,...(error.dependencies?{dependencies:error.dependencies}:{})},400);}
      const overlap=publishedOverlap(next,publication.scopes);
      if(overlap)fail(400,'publication_conflict','Udgivelsen giver overlappende vagter den '+overlap[0].date+'. Ret de berørte vagter, og udgiv de relevante arbejdssteder samlet.');
      const selected=publication.scopes,selectedShifts=Publication.publishedShifts(next).filter(shift=>selected.some(scope=>shift.date>=scope.from&&shift.date<=scope.to&&scope.siteIds.includes(shift.site))),absent=selectedShifts.find(shift=>shift.person&&Data.leaveRequests(next).some(leave=>leave.p===shift.person&&Series.shiftDates(shift).some(day=>leave.days.includes(day))&&(next.requests?.[leave.id]||leave.status)==='approved'));
      if(absent)fail(400,'publication_leave','En medarbejder har godkendt fravær den '+absent.date+'. Ret vagten, før perioden udgives.');
      await assertNoPublishedAbsence(db,context.workspace.id,selectedShifts);
      const attendance=await ensureTimeEntries({db,workspaceId:context.workspace.id,context,helpers:{actorGuard,fail}});attendanceVersion=attendance.row?.version||0;
      const after=new Map(Publication.publishedShifts(next).map(shift=>[shift.id,shift])),changedIds=Publication.publishedShifts(old).filter(shift=>{const current=after.get(shift.id);return !current||current.person!==shift.person||current.date!==shift.date;}).map(shift=>shift.id),registered=[];
      for(let i=0;i<changedIds.length;i+=1000)registered.push(...await rows(db,'SELECT shift_id,person_id,work_date,status FROM workspace_time_entries WHERE workspace_id=? AND demo=0 AND shift_id IN (SELECT value FROM json_each(?))',context.workspace.id,JSON.stringify(changedIds.slice(i,i+1000))));
      for(const entry of registered){const shift=after.get(entry.shift_id);if(shift&&(shift.person!==entry.person_id||shift.date!==entry.work_date)||!shift&&['running','paused'].includes(entry.status))fail(409,'publication_attendance_locked','Vagten har registrerede timer. Medarbejder og dato skal bevares; en igangværende vagt skal afsluttes før aflysning.');}
      const beforeIds=Publication.publishedShifts(old).map(shift=>shift.id),published=Publication.publishedShifts(next),afterIds=new Set(published.map(shift=>shift.id));
      next.checklistProgress=Checklist.reconcile(next.checklistProgress,published,{deletedIds:beforeIds.filter(id=>!afterIds.has(id))});
      const oldSites=[];for(const slot of Object.values(old.publications?.slots||{}))oldSites[slot.site]=slot.location;
      next.shiftWorkflow=ShiftWorkflow.publicationMessages(old.shiftWorkflow,Publication.publishedShifts(old),published,{at,sites:next.organization?.sites||Departments.defaultOrganization().sites,beforeSites:oldSites});
    }
    if(Publication.publishedShifts(next).some(shift=>shift.person&&!rosterIds.includes(shift.person)))fail(400,'published_person_missing','En medarbejder med udgivne vagter må ikke slettes. Arkivér medarbejderen i stedet.');
    appendActivity(next,old,actor,previous.revision+1,at,publication);
    const ownPreferences={...preferences(context.member.preferences,context,false),...preferences(extractPreferences(payload.studio),context,false)};
    const required=['plan',...((peopleChanged||settingsChanged||demoChanged||scopedBudgetsChanged)?['users.manage']:[]),...(organizationChanged?['departments.manage']:[])];
    const engagement=await prepareEngagementPlan({db,workspaceId:context.workspace.id,before:old,next});
    const persisted={...next,checklistProgress:{},shiftWorkflow:ShiftWorkflow.empty()};delete persisted.absences;delete persisted.absenceHasMore;
    const leaveChanged=Object.entries(next.requests||{}).some(([id,status])=>old.requests?.[id]!==status);
    const result=await writeStudio(db,context.workspace.snapshotOwnerId,previous.revision,persisted,{...guard(context,required),directoryRevision:payload.directoryRevision??payload.studio.directoryRevision,...(publication||leaveChanged?{extraCondition:absenceGuard(context)}:{}),...(attendanceVersion!==undefined?{workflowLedgerVersion:attendanceVersion}:{}),preferences:JSON.stringify(ownPreferences),...(peopleChanged?{rosterIds}:{}),auditStatements:condition=>[...archiveStatements({db,workspaceId:context.workspace.id,entries:next.activity,condition}),...engagement(condition),...absencePlanStatements({db,context,before:old,next,condition})]});
    await assertContext(db,context);
    if(!result.ok){
      if(modern&&payload.publication===undefined&&attempt<3){context=await resolveWorkspace(db,principal);onContext(context);continue;}
      return response({error:'revision_conflict',message:'Planen er ændret. Hent den seneste version.',revision:result.revision,...(!projection?{studio:result.studio?{...sharedStudio(result.studio),...viewer(context).preferences}:null}:{})},409);
    }
    // Acknowledge exactly our commit: later writers must never advance a queued edit's base token.
    let acknowledgment;
    if(modern&&projection){const scoped=projectRead(next,planningReceipt(result),projection,submission.changes);return response({revision:result.revision,planning:scoped.planning,...scopeExtras(scoped),reconciledStudio:{...sharedStudio(scoped.studio),...ownPreferences},publications:scoped.studio.publications,checklistProgress:scoped.studio.checklistProgress});}
    if(modern)acknowledgment={revision:result.revision,planning:planningReceipt(result),reconciledStudio:{...sharedStudio(next),...ownPreferences}};
    return response({revision:result.revision,publications:next.publications,activity:next.activity,checklistProgress:next.checklistProgress,...(next.leaveDecisions?{leaveDecisions:next.leaveDecisions}:{}),...acknowledgment});
    }
  }catch(error){return errorResponse(error);}
}

async function handleDirectoryRequestInternal(request,storage,onContext){
  try{
    if(request.method!=='POST')return response({error:'method_not_allowed'},405);
    sameOrigin(request);const requestAuth=requestIdentity(request),payload=await requestJSON(request,MAX_BODY_BYTES);
    if(!record(payload)||!['read','write'].includes(payload.action))fail(400,'directory_request_invalid','Vælg en gyldig handling.');
    const {db,signedIn,usingWeb}=await requestPrincipal(request,storage,requestAuth);
    const principal=await selectedCompanyPrincipal(db,signedIn,request,usingWeb);
    let context=await resolveWorkspace(db,principal,{metadataOnly:true,directoryOnly:true}),caps=capabilities(context);onContext(context);
    if(payload.action==='read'){
      if(Object.keys(payload).some(key=>!['action','kind','ids','cursor','limit','catalog'].includes(key))||payload.catalog!==undefined&&typeof payload.catalog!=='boolean')fail(400,'directory_request_invalid','Oversigtens afgrænsning er ugyldig.');
      const fullAccess=caps.plan,employeeAdmin=caps.manageUsers,departmentAdmin=caps.manageDepartments;
      const ownEmployee=payload.kind==='employee'&&context.member.personId&&Array.isArray(payload.ids)&&payload.ids.length===1&&payload.ids[0]===context.member.personId&&!payload.cursor;
      if(!fullAccess&&!(payload.kind==='employee'&&employeeAdmin)&&!(['site','department'].includes(payload.kind)&&departmentAdmin)&&!ownEmployee)fail(403,'directory_read_forbidden','Du har ikke adgang til disse virksomhedsoplysninger.');
      const point=payload.ids!==undefined;
      if(point&&payload.kind!==undefined&&(!Array.isArray(payload.ids)||payload.ids.some(id=>typeof id!=='string')))fail(400,'directory_keys_invalid','Vælg id fra den samme type poster.');
      if(point&&(payload.cursor!==undefined||payload.limit!==undefined))fail(400,'directory_request_invalid','Vælg poster eller en side ad gangen.');
      if(point&&!(ownEmployee&&!fullAccess))await assertDirectoryKeysAccess({db,context,kind:payload.kind,ids:payload.ids});
      const result=point?await readDirectoryRecords({db,workspaceId:context.workspace.id,kind:payload.kind,ids:payload.ids,catalog:payload.catalog===true,...(ownEmployee&&!fullAccess?{}:{context})}):await readDirectoryPage({db,workspaceId:context.workspace.id,kind:payload.kind,cursor:payload.cursor,limit:payload.limit,catalog:payload.catalog!==false,context});
      await assertContext(db,context);return response({...result,records:sharedData(result.records),workspace:{id:context.workspace.id},capabilities:capabilities(context)});
    }
    if(Object.keys(payload).some(key=>!['action','changes'].includes(key)))fail(400,'directory_request_invalid','Ændringen indeholder ukendte felter.');
    const validation=Directory.validateChanges(payload.changes);if(validation.length)fail(400,'directory_command_invalid',validation[0]);
    if(hasSharedPayroll(payload.changes))fail(400,'payroll_separate','Lønoplysninger skal gemmes separat.');
    const changesBudget=payload.changes.some(item=>item.kind!=='employee'&&Object.hasOwn(item.patch,'workHoursBudget'));
    const required=['plan',...(payload.changes.some(item=>item.kind==='employee')||changesBudget?['users.manage']:[]),...(payload.changes.some(item=>item.kind!=='employee')?['departments.manage']:[])];
    const changesGps=payload.changes.some(item=>item.kind==='site'&&Object.hasOwn(item.patch,'gps'));
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)context=await resolveWorkspace(db,principal,{metadataOnly:true,directoryOnly:true});onContext(context);
      if(required.some(key=>!context.role.permissions.includes(key)))fail(403,'directory_write_forbidden','Din rolle har ikke adgang til at ændre disse oplysninger.');
      if(isScoped(context)){for(const change of payload.changes){if(change.kind!=='employee')fail(403,'department_company_action_forbidden','Afdelingernes struktur administreres på tværs af virksomheden.');if(change.expectedVersion>0)await assertPersonAccess({db,context,personId:change.id});if(Object.hasOwn(change.patch,'site'))assertSiteAccess(context,change.patch.site);else if(change.expectedVersion===0)fail(400,'department_site_required','Vælg et arbejdssted i dine afdelinger.');}}
      if(changesGps&&!capabilities(context).manageSiteGps)fail(403,'site_gps_forbidden','Kun en administrator kan ændre GPS-indstillinger for arbejdssteder.');
      const acl=actorGuard(context,required),newIndices=new Set(payload.changes.filter(item=>item.kind==='site'&&item.expectedVersion===0).map(item=>item.siteIndex)),references=payload.changes.flatMap(item=>item.kind==='employee'?[item.patch.site]:item.kind==='department'&&Array.isArray(item.patch.siteIds)?item.patch.siteIds:[]).filter(index=>Number.isInteger(index)&&index>=0&&index<2000&&!newIndices.has(index)),sitesGuard=siteReferenceGuard({workspaceId:context.workspace.id,siteIndices:references}),condition={sql:'('+acl.sql+') AND ('+sitesGuard.sql+')',values:[...acl.values,...sitesGuard.values]},token=crypto.randomUUID(),at=now(),prepared=await prepareDirectoryWrite({db,workspaceId:context.workspace.id,changes:payload.changes,condition,token,at});
      if(!prepared.statements.length){await assertContext(db,context);return response({directory:prepared.directory,records:sharedData(prepared.records),workspace:{id:context.workspace.id},capabilities:capabilities(context)});}
      let detailBytes=0;const changes=prepared.changed.slice(0,500).map(item=>{const value=Directory.catalog(item.kind,item.value),size=encode.encode(JSON.stringify(value)).byteLength,fields=Object.keys(payload.changes.find(change=>change.kind===item.kind&&change.id===item.id)?.patch||{}),base={field:item.kind==='employee'?'roster':'organization',id:item.id,fields};if(detailBytes+size<=64*1024){detailBytes+=size;return {...base,after:value};}return base;});
      const entry={id:'activity-'+crypto.randomUUID(),kind:'plan',summary:prepared.changed.length+(prepared.changed.length===1?' post opdateret i virksomheden':' poster opdateret i virksomheden'),actor:{userId:principal.userId,name:principal.name},at,revision:context.saved.revision,counts:{total:prepared.changed.length},changes,recoverable:false};
      const result=await db.batch([...prepared.statements,...archiveStatements({db,workspaceId:context.workspace.id,entries:[entry],condition:prepared.condition})]);if(result[0]?.meta?.changes===1)await refreshCommittedDirectoryAccess(db,context,prepared);await assertContext(db,context);
      if(result[0]?.meta?.changes===1)return response({directory:prepared.directory,records:sharedData(prepared.records),workspace:{id:context.workspace.id},capabilities:capabilities(context)});
    }
    fail(409,'directory_changed','Virksomhedsoplysningerne ændrer sig. Åbn posten igen.');
  }catch(error){return errorResponse(error);}
}

// The native prototype has no employee assignment yet. Limit pairing to the
// same administrators who can configure worksite GPS in the browser.
/** @param {string | null} workspaceId */
export async function readMobileGpsWorkplaces(request,storage,siteId,workspaceId=null){
  const principal=principalFromRequest(request),db=await database(storage);
  const current=await membership(db,principal.userId);
  if(!current||current.status!=='active')fail(403,'mobile_gps_forbidden','Kun en administrator kan forbinde mobilprototypen til et arbejdssted.');
  const role=await readRole(db,current.workspaceId,current.roleId);
  if(!role||!capabilities({role}).manageSiteGps)fail(403,'mobile_gps_forbidden','Kun en administrator kan forbinde mobilprototypen til et arbejdssted.');
  if(workspaceId!==null&&workspaceId!==current.workspaceId)fail(404,'mobile_gps_site_missing','Arbejdsstedet findes ikke længere i dit arbejdsområde.');
  const context={member:current,workspace:{id:current.workspaceId},role};
  const directory=await readDirectoryHeader({db,workspaceId:current.workspaceId});
  if(!directory)fail(409,'mobile_gps_directory_missing','Åbn Indstillinger i CleanRooms Studio, og prøv derefter igen fra appen.');

  if(siteId===null){
    const sites=await rows(db,`SELECT id,json_extract(catalog,'$.name') AS name
      FROM workspace_directory_records WHERE workspace_id=? AND kind='site' AND deleted=0 ORDER BY position,id`,current.workspaceId);
    await assertContext(db,context);
    return {sites};
  }

  if(!Directory.validId('site',siteId))fail(400,'mobile_gps_site_invalid','Vælg et gyldigt arbejdssted.');
  const result=await readDirectoryRecords({db,workspaceId:current.workspaceId,kind:'site',ids:[siteId]});
  const site=result.records[0]?.value;
  if(!site)fail(404,'mobile_gps_site_missing','Arbejdsstedet findes ikke længere i dit arbejdsområde.');
  if(Departments.validateGps(site.gps).length)fail(409,'mobile_gps_policy_invalid','Arbejdsstedets GPS-indstillinger kunne ikke bekræftes.');
  await assertContext(db,context);
  const gps=site.gps?.enabled?{enabled:true,latitude:site.gps.latitude,longitude:site.gps.longitude,radiusMeters:site.gps.radiusMeters}:null;
  return {site:{id:site.id,name:site.name,workspaceId:current.workspaceId},gps};
}

function requirePermission(context,key) {
  if(!context.role.permissions.includes(key))fail(403,'accounts_forbidden','Din rolle har ikke adgang til denne kontohandling.');
}
function requireGrant(context,target,current=null) {
  if(!Roles.canGrant(context.role.permissions,target.permissions)||current&&!Roles.canGrant(context.role.permissions,current.permissions))
    fail(403,'role_grant_forbidden','Du kan kun administrere roller og konti inden for dine egne rettigheder.');
}
function roleFence(workspaceId,role) {
  return {sql:'EXISTS (SELECT 1 FROM workspace_roles target_role WHERE target_role.workspace_id = ? AND target_role.id = ? AND target_role.version = ?)',values:[workspaceId,role.id,role.version]};
}
async function grant(db,input,context,current={},newPersonId=null) {
  let roleId;
  if(Object.hasOwn(input,'roleId')) {
    if(!identity(input.roleId))fail(400,'invalid_role','Vælg en gyldig rolle.');
    roleId=input.roleId;
  } else if(Object.hasOwn(input,'role')||Object.hasOwn(input,'manageDepartments')) {
    const legacyRole=Object.hasOwn(input,'role')?input.role:current.role;
    if(!ROLES.includes(legacyRole))fail(400,'invalid_member','Vælg en gyldig rolle.');
    const manage=Object.hasOwn(input,'manageDepartments')?input.manageDepartments:legacyRole===current.role?current.manageDepartments??legacyRole==='admin':legacyRole==='admin';
    if(typeof manage!=='boolean'||legacyRole==='employee'&&manage)fail(400,'invalid_member','Rollen kan ikke administrere afdelinger.');
    roleId=legacyRole==='admin'?'admin':legacyRole==='planner'&&manage?'planner-departments':legacyRole==='planner'?'planner':'employee';
  } else roleId=current.roleId;
  const definition=identity(roleId)?await readRole(db,context.workspace.id,roleId):null;
  if(!definition)fail(400,'invalid_role','Rollen findes ikke i dette arbejdsområde.');
  const personId=newPersonId??(Object.hasOwn(input,'personId')?input.personId:current.personId??null);
  if(newPersonId===null){
    await staffContext(db,context);
    if(personId!==null&&!rosterHas(context,personId)||!definition.permissions.length&&personId===null)fail(400,'person_assignment_required','En konto uden administrationsrettigheder skal knyttes til en gyldig medarbejder.');
  }
  if(personId!==null&&newPersonId===null)await assertPersonAccess({db,context,personId});
  return {...Roles.legacy(definition.permissions),roleId:definition.id,definition,personId};
}
function inviteEmployeeDraft(payload,context) {
  if(!Object.hasOwn(payload,'newEmployee'))return null;
  requirePermission(context,'plan');
  const input=payload.newEmployee;
  if(!record(input)||Object.keys(input).some(key=>!['name','site'].includes(key))||payload.personId!=null||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>120||/[\u0000-\u001f\u007f]/.test(input.name)||!Number.isInteger(input.site)||input.site<0||input.site>=2000)
    fail(400,'invalid_invite_employee','Angiv den nye medarbejders navn og arbejdssted.');
  assertSiteAccess(context,input.site);
  const name=input.name.trim();
  return {id:Roster.newId(),name,initials:Roster.initials(name),site:input.site,target:Roster.defaultEmployeeTarget,role:'Servicemedarbejder',active:true};
}
function inviteAddressGuard(workspaceId,address,stamp) {
  return {sql:`NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=? AND email=? AND status IN ('active','disabled'))
    AND NOT EXISTS (SELECT 1 FROM workspace_invites WHERE workspace_id=? AND email=? AND status='pending' AND expires_at>?)`,values:[workspaceId,address,workspaceId,address,stamp]};
}
function duplicateInvite() {
  fail(409,'invite_email_in_use','Der findes allerede en bruger eller en gyldig invitation med den e-mailadresse. Se under Brugere og roller.');
}
const priorInviteEmployees=`FROM workspace_invites previous JOIN workspace_directory_records employee
  ON employee.workspace_id=previous.workspace_id AND employee.kind='employee' AND employee.id=previous.person_id AND employee.deleted=0 AND employee.active=1
  WHERE previous.workspace_id=? AND previous.email=?`;
const retryableInvite="(previous.status='revoked' OR (previous.status='pending' AND previous.expires_at<=?))";
async function inviteEmployeeGuard(db,workspaceId,address,stamp,employee) {
  const links=await rows(db,`SELECT employee.id,employee.version,employee.name_sort,employee.site_index,MAX(${retryableInvite}) AS retryable
    ${priorInviteEmployees} GROUP BY employee.id,employee.version,employee.name_sort,employee.site_index LIMIT 2`,stamp,workspaceId,address);
  if(!links.length)return {sql:`NOT EXISTS (SELECT 1 ${priorInviteEmployees})`,values:[workspaceId,address]};
  const [prior]=links;
  if(links.length!==1||prior.retryable!==1||prior.site_index!==employee.site||prior.name_sort?.normalize('NFC')!==employee.name.toLocaleLowerCase('da-DK').normalize('NFC'))
    fail(409,'invite_email_in_use','E-mailadressen er knyttet til en tidligere invitation. Kontrollér navn og arbejdssted i medarbejderlisten.');
  return {personId:prior.id,sql:`EXISTS (SELECT 1 ${priorInviteEmployees} AND employee.id=? AND employee.version=? AND ${retryableInvite})
    AND NOT EXISTS (SELECT 1 ${priorInviteEmployees} AND employee.id<>?)`,values:[workspaceId,address,prior.id,prior.version,stamp,workspaceId,address,prior.id]};
}
function publicMember(value,context,definition) {
  const {preferences,...safe}=value;
  return {...safe,...Roles.legacy(definition.permissions),roleId:definition.id,roleName:definition.name,isOwner:value.userId===context.workspace.ownerUserId};
}
function publicInvite(row,definition) {
  return {id:row.id,email:row.email,name:row.name,...(definition?Roles.legacy(definition.permissions):{role:row.role,manageDepartments:row.manage_departments===1}),
    roleId:row.role_id,roleName:definition?.name||'',accessScope:storedAccessScope(row.access_scope),personId:row.person_id,status:row.status==='pending'&&row.expires_at<=now()?'expired':row.status,
    version:row.version,expiresAt:row.expires_at,createdAt:row.created_at};
}
async function tokenHash(token) {const bytes=await crypto.subtle.digest('SHA-256',encode.encode(token));return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');}
function newToken() {const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}

async function acceptInvite(db,principal,payload) {
  if(typeof payload.token!=='string'||!/^[A-Za-z0-9_-]{40,128}$/.test(payload.token))fail(400,'invalid_invite','Invitationslinket er ugyldigt.');
  const existing=await membership(db,principal.userId);
  if(existing)fail(existing.status==='disabled'?403:409,existing.status==='disabled'?'membership_disabled':'already_member','Din konto er allerede knyttet til et arbejdsområde.');
  const hash=await tokenHash(payload.token);let invite=await first(db,'SELECT * FROM workspace_invites WHERE token_hash = ?',hash);
  if(!invite)fail(410,'invite_unavailable','Invitationen er udløbet, brugt eller tilbagekaldt.');
  await ensureWorkspaceRoles(db,invite.workspace_id);invite=await first(db,'SELECT * FROM workspace_invites WHERE token_hash = ?',hash);
  const stamp=now();
  if(invite.status!=='pending'||invite.expires_at<=stamp)fail(410,'invite_unavailable','Invitationen er udløbet, brugt eller tilbagekaldt.');
  if(invite.email!==principal.email)fail(403,'invite_email_mismatch','Log ind med den e-mailadresse, invitationen er sendt til.');
  const issuer=await membership(db,invite.created_by),issuerRole=issuer?.roleId?await readRole(db,invite.workspace_id,issuer.roleId):null;
  if(!issuer||issuer.workspaceId!==invite.workspace_id||issuer.status!=='active'||!issuerRole?.permissions.includes('users.manage'))fail(403,'invite_issuer_revoked','Invitationens udsteder har ikke længere adgang til at invitere.');
  const issuerContext={member:issuer,workspace:{id:invite.workspace_id},role:issuerRole};
  await staffContext(db,issuerContext,{metadataOnly:true,directoryOnly:true,personIds:[invite.person_id]});await loadDepartmentAccess({db,context:issuerContext});
  const acceptedScope=await validateGrantScope({db,context:issuerContext,value:storedAccessScope(invite.access_scope)});
  const permission=await grant(db,{roleId:invite.role_id,personId:invite.person_id},issuerContext);requireGrant(issuerContext,permission.definition);
  const issuerAcl=referenceAcl(issuerContext,actorGuard(issuerContext,['users.manage']),[permission.personId]),roleAcl=roleFence(invite.workspace_id,permission.definition),scopeAcl=grantScopeGuard(issuerContext,acceptedScope),targetAcl={sql:'('+roleAcl.sql+') AND ('+scopeAcl.sql+')',values:[...roleAcl.values,...scopeAcl.values]};
  if(permission.role==='employee'&&permission.personId&&await first(db,"SELECT user_id FROM workspace_members WHERE workspace_id = ? AND person_id = ? AND role = 'employee' AND status = 'active'",invite.workspace_id,permission.personId))fail(409,'person_already_bound','Medarbejderen er allerede knyttet til en aktiv konto.');
  const result=await db.batch([
    ...accountAuditStatements({db,context:{workspace:{id:invite.workspace_id}},principal,operation:'acceptInvite',id:invite.id,before:{id:invite.id,status:'pending',roleId:permission.roleId,personId:permission.personId,accessScope:acceptedScope,version:invite.version},after:{userId:principal.userId,name:principal.name,email:principal.email,status:'active',roleId:permission.roleId,personId:permission.personId,accessScope:acceptedScope,version:1},condition:{sql:`EXISTS (SELECT 1 FROM workspace_invites WHERE id=? AND token_hash=? AND email=? AND status='pending' AND expires_at>? AND version=?) AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id=?) AND ${issuerAcl.sql} AND ${targetAcl.sql}`,values:[invite.id,hash,principal.email,stamp,invite.version,principal.userId,...issuerAcl.values,...targetAcl.values]}}),
    statement(db,`UPDATE workspace_invites SET status = 'accepted',accepted_by = ?,version = version + 1,updated_at = ?
      WHERE id = ? AND token_hash = ? AND email = ? AND status = 'pending' AND expires_at > ? AND version = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = ?) AND ${issuerAcl.sql} AND ${targetAcl.sql}`,
      principal.userId,stamp,invite.id,hash,principal.email,stamp,invite.version,principal.userId,...issuerAcl.values,...targetAcl.values),
    statement(db,`INSERT INTO workspace_members (user_id,workspace_id,email,name,role,role_id,manage_departments,person_id,status,version,preferences,created_at,updated_at,access_scope)
      SELECT ?,workspace_id,?,CASE WHEN name <> '' THEN name ELSE ? END,?,?,?,?, 'active',1,'{}',?,?,?
      FROM workspace_invites WHERE id = ? AND token_hash = ? AND status = 'accepted' AND accepted_by = ? AND updated_at = ? AND version = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = ?) AND ${issuerAcl.sql} AND ${targetAcl.sql}`,
      principal.userId,principal.email,principal.name,permission.role,permission.roleId,Number(permission.manageDepartments),permission.personId,stamp,stamp,JSON.stringify(acceptedScope),
      invite.id,hash,principal.userId,stamp,invite.version+1,principal.userId,...issuerAcl.values,...targetAcl.values),

  ]);
  if(result.at(-2)?.meta?.changes!==1||result.at(-1)?.meta?.changes!==1)fail(409,'invite_changed','Invitationen eller rollens rettigheder er ændret.');
  const context=await resolveWorkspace(db,principal);return {accepted:true,viewer:viewer(context),capabilities:capabilities(context),workspace:{id:context.workspace.id}};
}

async function assertPayrollAccess(db,context,permissions) {
  const acl=actorGuard(context,permissions);
  const check=await first(db,`SELECT CASE WHEN ${acl.sql} THEN 1 ELSE 0 END AS allowed,
    EXISTS (SELECT 1 FROM studio_states payroll_plan WHERE payroll_plan.owner_id = ? AND payroll_plan.revision = ?) AS current_plan`,
    ...acl.values,context.workspace.snapshotOwnerId,context.saved.revision);
  if(!check?.allowed)fail(403,'payroll_forbidden','Din adgang til lønoplysninger er ændret. Genindlæs siden.');
  if(!check.current_plan)fail(409,'payroll_plan_changed','Vagtplanen eller medarbejderlisten er ændret. Genindlæs medarbejderprofilen, før du fortsætter.');
}
function payrollResult(row,personId) {
  if(!row)return {personId,version:0,payroll:null,updatedAt:null};
  if(!Number.isSafeInteger(row.version)||row.version<1||typeof row.updated_at!=='string'||!Number.isFinite(Date.parse(row.updated_at)))fail(500,'invalid_payroll','Lønoplysningerne kunne ikke læses. Ingen data er overskrevet.');
  let payroll;try{const parsed=JSON.parse(row.config);if(!record(parsed))throw new TypeError('Invalid stored payroll.');payroll=Payroll.normalize(parsed);}catch{fail(500,'invalid_payroll','Lønoplysningerne kunne ikke læses. Ingen data er overskrevet.');}
  return {personId,version:row.version,payroll,updatedAt:row.updated_at};
}
const PAYROLL_VIEW=['plan','payroll.view'],PAYROLL_MANAGE=[...PAYROLL_VIEW,'payroll.manage'],PAYROLL_GROUP_MANAGE=[...PAYROLL_MANAGE,'payroll.groups.manage'];
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
function policyResult(row) {
  if(!row)return {policy:PayrollGroups.normalize(null),version:0,history:[]};
  try{
    if(!Number.isSafeInteger(row.version)||row.version<0)throw Error('version');
    const parsed=JSON.parse(row.config),history=JSON.parse(row.history);if(!record(parsed)||!Array.isArray(history)||history.length>50)throw Error('shape');
    return {policy:PayrollGroups.normalize(parsed),version:row.version,history};
  }catch{fail(500,'invalid_payroll_policy','Løngrupperne kunne ikke læses. Ingen data er overskrevet.');}
}
async function payrollBundle(db,context,personId=null) {
  const subset=record(personId),all=personId===null;
  if(subset&&(!Array.isArray(personId.personIds)||personId.personIds.length>5000||personId.personIds.some(id=>!Directory.validId('employee',id))))fail(400,'payroll_people_invalid','Vælg gyldige medarbejdere til lønberegningen.');
  const ids=subset?[...new Set(personId.personIds)]:all?null:[personId],scope=all?'':subset?' AND person_id IN (SELECT value FROM json_each(?))':' AND person_id = ?',values=all?[context.workspace.id]:[context.workspace.id,subset?JSON.stringify(ids):personId];
  const result=await db.batch([
    statement(db,'SELECT * FROM workspace_payroll_policies WHERE workspace_id = ?',context.workspace.id),
    statement(db,`SELECT COALESCE(SUM(length(CAST(config AS BLOB))),0) AS bytes FROM workspace_payroll WHERE workspace_id = ?${scope}`,...values),
    statement(db,`SELECT person_id,config,version,updated_by,updated_at FROM workspace_payroll WHERE workspace_id = ?${scope}
      AND (SELECT COALESCE(SUM(length(CAST(config AS BLOB))),0) FROM workspace_payroll WHERE workspace_id = ?${scope}) <= ? ORDER BY person_id`,...values,...values,8*1024*1024)
  ]);
  if(result[1]?.results?.[0]?.bytes>8*1024*1024)fail(413,'payroll_policy_too_large','Der er for mange lønoplysninger til én samlet handling.');
  const stored=policyResult(result[0]?.results?.[0]),records=new Map((result[2]?.results||[]).map(row=>[row.person_id,row]));
  const selected=all?context.staff:subset?ids.map(id=>context.staff.find(person=>person.id===id)||{id,name:id}):context.staff.filter(person=>person.id===personId);
  const people=selected.map(person=>({personId:person.id,name:person.name,...(({payroll,version})=>({payroll,version}))(payrollResult(records.get(person.id),person.id))}));
  const versions=[...new Set([...(all?context.staff.map(person=>person.id):ids),...records.keys()])].sort().map(id=>({personId:id,version:records.get(id)?.version||0}));
  return {...stored,records,people,versions};
}
function scopedPayrollPolicy(context,policy,personId){if(!isScoped(context))return clone(policy);const links=policy.links.filter(link=>link.personId===personId),groups=new Set(links.map(link=>link.groupId).filter(Boolean));return {...clone(policy),links:clone(links),groups:policy.groups.filter(group=>groups.has(group.id)).map(clone)};}
function personalPayrollResult(bundle,personId,context){return {...payrollResult(bundle.records.get(personId),personId),policyVersion:bundle.version,policy:scopedPayrollPolicy(context,bundle.policy,personId)};}
function policyReadResult(bundle){return {policy:clone(bundle.policy),version:bundle.version,people:clone(bundle.people),history:clone(bundle.history)};}
function policyVersionGuard(context,version){return {sql:'COALESCE((SELECT version FROM workspace_payroll_policies WHERE workspace_id = ?),0) = ?',values:[context.workspace.id,version]};}
function personVersionsGuard(context,versions,all=false){
  const encoded=JSON.stringify(versions);
  return {sql:`NOT EXISTS (SELECT 1 FROM json_each(?) expected WHERE COALESCE((SELECT version FROM workspace_payroll current_pay
    WHERE current_pay.workspace_id = ? AND current_pay.person_id = json_extract(expected.value,'$.personId')),0) <> json_extract(expected.value,'$.version'))
    ${all?`AND NOT EXISTS (SELECT 1 FROM workspace_payroll current_pay WHERE current_pay.workspace_id = ? AND NOT EXISTS
      (SELECT 1 FROM json_each(?) expected WHERE json_extract(expected.value,'$.personId') = current_pay.person_id))`:''}`,
    values:[encoded,context.workspace.id,...(all?[context.workspace.id,encoded]:[])]};
}
function policyDate(value){if(!Actions.validDate(value)||value<Data.minDate||value>Data.maxDate)fail(400,'invalid_payroll_date','Vælg en gyldig dato for lønændringen.');return value;}
function validatePolicyChange(before,after,context){
  const today=Data.todayFor(),oldGroups=new Map(before.groups.map(group=>[group.id,group])),oldLinks=new Map(before.links.map(link=>[link.personId+'|'+link.from,link]));
  // A saved period is an audit record, including current and scheduled periods.
  // Changes must append another dated revision instead of rewriting that record.
  const nextGroups=new Map(after.groups.map(group=>[group.id,group]));
  for(const group of before.groups){
    const nextRevisions=new Map((nextGroups.get(group.id)?.revisions||[]).map(revision=>[revision.id,revision]));
    for(const revision of group.revisions){
      const next=nextRevisions.get(revision.id);
      if(!next||canonical(next)!==canonical(revision))fail(400,'immutable_payroll_period','Gemte lønperioder kan ikke ændres eller fjernes. Opret en ny lønændring fra en ledig dato fra i dag eller senere.');
    }
  }
  for(const group of after.groups)for(const revision of group.revisions)if(revision.from<today){
    const old=oldGroups.get(group.id)?.revisions.find(value=>value.id===revision.id);if(!old||canonical(old)!==canonical(revision))fail(400,'historical_payroll_policy','Nye gruppeperioder skal gælde fra i dag eller senere.');
  }
  for(const link of before.links)if(link.from<today&&!after.links.some(next=>next.personId===link.personId&&next.from===link.from&&canonical(next)===canonical(link)))fail(400,'historical_payroll_policy','Tidligere gruppetilknytninger må ikke ændres eller fjernes.');
  for(const link of after.links){
    if(!rosterHas(context,link.personId))fail(400,'payroll_person_missing','En gruppetilknytning henviser til en medarbejder, der ikke findes.');
    const old=oldLinks.get(link.personId+'|'+link.from);
    if(link.from<today&&(!old||canonical(old)!==canonical(link)))fail(400,'historical_payroll_policy','Nye personlige lønændringer skal gælde fra i dag eller senere.');
    if(link.groupId&&after.groups.find(group=>group.id===link.groupId)?.archived&&PayrollGroups.linkFor(before,link.personId,link.from)?.groupId!==link.groupId)fail(400,'payroll_group_archived','En arkiveret løngruppe kan ikke få nye medarbejdere.');
  }
}
function effectivePolicyDate(before,after,requested){
  const changed=[policyDate(requested)],left=new Map(before.groups.flatMap(group=>group.revisions.map(revision=>[group.id+'|'+revision.id,revision]))),right=new Map(after.groups.flatMap(group=>group.revisions.map(revision=>[group.id+'|'+revision.id,revision])));
  for(const key of new Set([...left.keys(),...right.keys()]))if(canonical(left.get(key)||null)!==canonical(right.get(key)||null)){if(left.get(key))changed.push(left.get(key).from);if(right.get(key))changed.push(right.get(key).from);}
  const a=new Map(before.links.map(link=>[link.personId+'|'+link.from,link])),b=new Map(after.links.map(link=>[link.personId+'|'+link.from,link]));
  for(const key of new Set([...a.keys(),...b.keys()]))if(canonical(a.get(key)||null)!==canonical(b.get(key)||null))changed.push((a.get(key)||b.get(key)).from);
  return changed.sort()[0];
}
function normalizedPolicy(value){if(!record(value))fail(400,'invalid_payroll_policy','Send gyldige løngrupper.');try{const policy=PayrollGroups.normalize(value);if(encode.encode(JSON.stringify(policy)).byteLength>MAX_PAYROLL_POLICY_BODY_BYTES)fail(413,'body_too_large','Løngrupperne indeholder for mange data.');return policy;}catch(error){if(error instanceof StudioError)throw error;fail(400,'invalid_payroll_policy',error.message||'Løngrupperne er ugyldige.');}}
function policyPreview(bundle,policy,date){try{return PayrollGroups.preview({before:bundle.policy,after:policy,people:bundle.people,date});}catch(error){fail(400,'invalid_payroll_policy',error.message||'Lønændringen kunne ikke gennemgås.');}}
async function policyPreviewToken(bundle,policy,date,context){return tokenHash(canonical({policy,date,version:bundle.version,studioRevision:context.saved.revision,directoryRevision:context.saved.directory?.revision??0,payVersions:bundle.versions,workspace:context.workspace.id,userId:context.member.userId,memberVersion:context.member.version,roleId:context.role.id,roleVersion:context.role.version}));}
function policyHistory(bundle,preview,context,principal,kind,version){
  const at=now(),affected=preview.affected||[],entry={id:'payroll-policy-'+crypto.randomUUID(),version,at,date:preview.date,actor:{userId:principal.userId,name:principal.name},kind,summary:affected.length+' medarbejdere berørt af lønændringen',counts:clone(preview.counts),people:affected.slice(0,200).map(({personId,name,effectiveFrom,baseChanged,supplementsChanged,personalPreserved})=>({personId,name,effectiveFrom,baseChanged,supplementsChanged,personalPreserved})),peopleTruncated:affected.length>200};
  const history=[...clone(bundle.history),entry].slice(-50);while(history.length>1&&encode.encode(JSON.stringify(history)).byteLength>128*1024)history.shift();return history;
}
function policyWrite(db,context,bundle,policy,history,principal,permissions,allVersions=false){
  const acl=actorGuard(context,permissions),pay=personVersionsGuard(context,bundle.versions,allVersions),token=crypto.randomUUID(),stamp=now(),version=bundle.version+1;
  const directory=context.saved.directory?directoryVersionGuard({workspaceId:context.workspace.id,version:context.saved.directory.revision}):{sql:'1=1',values:[]};
  const condition=`${acl.sql} AND EXISTS (SELECT 1 FROM studio_states payroll_plan WHERE payroll_plan.owner_id = ? AND payroll_plan.revision = ?) AND ${pay.sql} AND (${directory.sql})`;
  const values=[...acl.values,context.workspace.snapshotOwnerId,context.saved.revision,...pay.values,...directory.values];
  return {token,version,history,statements:[
    statement(db,`UPDATE workspace_payroll_policies SET config = ?,version = version + 1,history = ?,updated_by = ?,updated_at = ?,write_token = ?
      WHERE workspace_id = ? AND version = ? AND ${condition}`,JSON.stringify(policy),JSON.stringify(history),principal.userId,stamp,token,context.workspace.id,bundle.version,...values),
    statement(db,`INSERT INTO workspace_payroll_policies (workspace_id,config,version,history,updated_by,updated_at,write_token)
      SELECT ?,?,1,?,?,?,? WHERE ? = 0 AND ${condition} ON CONFLICT(workspace_id) DO NOTHING`,context.workspace.id,JSON.stringify(policy),JSON.stringify(history),principal.userId,stamp,token,bundle.version,...values)
  ]};
}
function personalBasePolicy(bundle,personId,payroll){
  const old=payrollResult(bundle.records.get(personId),personId).payroll||Payroll.normalize(null),byId=new Map(old.agreements.map(agreement=>[agreement.id,agreement])),policy=clone(bundle.policy);let changed=false;
  for(const agreement of payroll.agreements){
    if(canonical(byId.get(agreement.id)||null)===canonical(agreement))continue;
    const active=PayrollGroups.linkFor(policy,personId,agreement.from);if(!active?.groupId)continue;
    if(agreement.from<Data.todayFor())fail(400,'historical_payroll_policy','En personlig grundløn i en løngruppe skal oprettes fra i dag eller senere. Tidligere gruppetilknytninger bevares.');
    const next={...clone(active),from:agreement.from,baseMode:'personal'},index=policy.links.findIndex(link=>link.personId===personId&&link.from===agreement.from);
    if(index<0){policy.links.push(next);changed=true;}else if(canonical(policy.links[index])!==canonical(next)){policy.links[index]=next;changed=true;}
  }
  return {policy:changed?PayrollGroups.normalize(policy):bundle.policy,changed};
}
function protectHistoricalPersonalBase(bundle,personId,payroll){
  assertPersonalPayrollHistory(payrollResult(bundle.records.get(personId),personId).payroll,payroll,Data.todayFor());
  const links=bundle.policy.links.filter(link=>link.personId===personId&&link.groupId),yesterday=addDays(Data.todayFor(),-1);
  if(!links.length)return;const first=links.map(link=>link.from).sort()[0];if(first>yesterday)return;
  const old=payrollResult(bundle.records.get(personId),personId).payroll;
  const periods=value=>{const merged=[];for(const period of value.periods){const last=merged.at(-1);if(last&&addDays(last.to,1)===period.from&&canonical(last.base)===canonical(period.base))last.to=period.to;else merged.push({from:period.from,to:period.to,base:period.base});}return merged;};
  const supplements=value=>value.payroll.supplements.map(({id,...item})=>item).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  for(let from=first;from<=yesterday;from=addDays(from,366)){
    const to=[addDays(from,365),yesterday].sort()[0],before=PayrollGroups.resolve({policy:bundle.policy,personId,payroll:old,from,to}),after=PayrollGroups.resolve({policy:bundle.policy,personId,payroll,from,to});
    if(canonical(periods(before))!==canonical(periods(after))||canonical(supplements(before))!==canonical(supplements(after)))fail(400,'historical_payroll_policy','Tidligere grundløn og tillæg i en løngruppe må ikke ændres eller fjernes. Opret en personlig lønændring fra i dag eller senere.');
  }
}
async function payrollAction(db,context,payload,principal) {
  const saving=payload.action==='payrollSave',permissions=saving?PAYROLL_MANAGE:PAYROLL_VIEW;
  permissions.forEach(key=>requirePermission(context,key));
  if(!rosterHas(context,payload.personId))fail(404,'person_missing','Medarbejderen findes ikke i arbejdsområdet.');
  await assertPersonAccess({db,context,personId:payload.personId});
  const personId=payload.personId,bundle=await payrollBundle(db,context,personId);
  if(!saving){await assertPayrollAccess(db,context,permissions);return response(personalPayrollResult(bundle,personId,context));}
  if(!Number.isSafeInteger(payload.version)||payload.version<0||payload.version>=Number.MAX_SAFE_INTEGER)fail(400,'invalid_payroll_version','Lønaftalens version er ugyldig.');
  const linked=bundle.policy.links.some(link=>link.personId===personId),policyVersion=payload.policyVersion;
  if(policyVersion!==undefined&&(!Number.isSafeInteger(policyVersion)||policyVersion<0))fail(400,'invalid_payroll_version','Løngruppens version er ugyldig.');
  if((linked&&policyVersion===undefined)||(policyVersion!==undefined&&policyVersion!==bundle.version)){
    await assertPayrollAccess(db,context,permissions);return response({error:'payroll_policy_changed',message:'Løngruppen er ændret eller kræver en nyere klient. Hent medarbejderens løn igen.',...personalPayrollResult(bundle,personId,context)},409);
  }
  if(payload.version!==(bundle.records.get(personId)?.version||0)){await assertPayrollAccess(db,context,permissions);return response({error:'payroll_conflict',message:'Lønaftalen er ændret. Hent den seneste version.',...personalPayrollResult(bundle,personId,context)},409);}
  if(!record(payload.payroll))fail(400,'invalid_payroll','Send en gyldig lønaftale.');
  let payroll;try{payroll=Payroll.normalize(payload.payroll);}catch(error){fail(400,'invalid_payroll',error?.message||'Lønaftalen er ugyldig.');}
  const serialized=JSON.stringify(payroll);if(encode.encode(serialized).byteLength>MAX_PAYROLL_BODY_BYTES)fail(413,'body_too_large','Lønaftalen indeholder for mange data.');
  protectHistoricalPersonalBase(bundle,personId,payroll);
  const personal=personalBasePolicy(bundle,personId,payroll);let policyCommit=null;
  if(personal.changed){
    validatePolicyChange(bundle.policy,personal.policy,context);
    const changedPeople={...bundle,people:bundle.people.map(value=>value.personId===personId?{...value,payroll}:value)},preview=policyPreview(changedPeople,personal.policy,effectivePolicyDate(bundle.policy,personal.policy,Data.todayFor()));
    const history=policyHistory(bundle,preview,context,principal,'personal-base',bundle.version+1);policyCommit=policyWrite(db,context,bundle,personal.policy,history,principal,permissions);
  }
  const acl=referenceAcl(context,actorGuard(context,permissions),[personId]),stamp=now(),token=crypto.randomUUID();
  const currentPlan='EXISTS (SELECT 1 FROM studio_states payroll_plan WHERE payroll_plan.owner_id = ? AND payroll_plan.revision = ?)',planValues=[context.workspace.snapshotOwnerId,context.saved.revision];
  const policyGuard=policyCommit?{sql:'EXISTS (SELECT 1 FROM workspace_payroll_policies WHERE workspace_id = ? AND version = ? AND write_token = ?)',values:[context.workspace.id,policyCommit.version,policyCommit.token]}:policyVersionGuard(context,bundle.version);
  const result=await db.batch([
    ...(policyCommit?.statements||[]),
    statement(db,`UPDATE workspace_payroll SET config = ?,version = version + 1,updated_by = ?,updated_at = ?,write_token = ?
      WHERE workspace_id = ? AND person_id = ? AND version = ? AND ${acl.sql} AND ${currentPlan} AND ${policyGuard.sql}`,
      serialized,principal.userId,stamp,token,context.workspace.id,personId,payload.version,...acl.values,...planValues,...policyGuard.values),
    statement(db,`INSERT INTO workspace_payroll (workspace_id,person_id,config,version,updated_by,updated_at,write_token)
      SELECT ?,?,?,1,?,?,? WHERE ? = 0 AND ${acl.sql} AND ${currentPlan} AND ${policyGuard.sql}
      ON CONFLICT(workspace_id,person_id) DO NOTHING`,
      context.workspace.id,personId,serialized,principal.userId,stamp,token,payload.version,...acl.values,...planValues,...policyGuard.values),
    ...payrollRevisionStatements({db,workspaceId:context.workspace.id,personId,previous:bundle.records.get(personId),version:payload.version+1,writeToken:token,actor:principal})
  ]);
  await assertPayrollAccess(db,context,permissions);
  const payrollOffset=policyCommit?.statements.length||0;
  if(!result.slice(payrollOffset,payrollOffset+2).some(item=>item?.meta?.changes===1)){
    const latest=await payrollBundle(db,context,personId);await assertPayrollAccess(db,context,permissions);
    return response({error:'payroll_conflict',message:'Lønaftalen eller løngruppen er ændret. Hent den seneste version, før du gemmer.',...personalPayrollResult(latest,personId,context)},409);
  }
  return response({personId,version:payload.version+1,payroll,updatedAt:stamp,policyVersion:policyCommit?.version||bundle.version,policy:scopedPayrollPolicy(context,personal.policy,personId)});
}

async function payrollPolicyAction(db,context,payload,principal){
  const reading=payload.action==='payrollPolicyRead',personAction=payload.action==='payrollPersonPolicySave',permissions=reading?PAYROLL_VIEW:personAction?PAYROLL_MANAGE:PAYROLL_GROUP_MANAGE;
  permissions.forEach(key=>requirePermission(context,key));
  if(personAction&&!rosterHas(context,payload.personId))fail(404,'person_missing','Medarbejderen findes ikke i arbejdsområdet.');
  if(personAction)await assertPersonAccess({db,context,personId:payload.personId});
  const bundle=await payrollBundle(db,context,personAction?payload.personId:null);
  if(reading){await assertPayrollAccess(db,context,permissions);return response(policyReadResult(bundle));}
  const expected=personAction?payload.policyVersion:payload.version;
  if(!Number.isSafeInteger(expected)||expected<0||expected>=Number.MAX_SAFE_INTEGER)fail(400,'invalid_payroll_version','Løngruppens version er ugyldig.');
  if(expected!==bundle.version){await assertPayrollAccess(db,context,permissions);return response({error:'payroll_policy_changed',message:'Løngrupperne er ændret. Hent den seneste version.'},409);}
  let policy,date;
  if(personAction){
    if(!Number.isSafeInteger(payload.version)||payload.version<0||payload.version>=Number.MAX_SAFE_INTEGER)fail(400,'invalid_payroll_version','Send medarbejderens gældende lønversion.');
    if(payload.version!==(bundle.records.get(payload.personId)?.version||0)){await assertPayrollAccess(db,context,permissions);return response({error:'payroll_conflict',message:'Medarbejderens lønaftale er ændret. Hent den igen.'},409);}
    if(!record(payload.link)||payload.link.personId!==payload.personId)fail(400,'invalid_payroll_policy','Vælg en gyldig personlig lønændring.');
    date=policyDate(payload.link.from);const active=PayrollGroups.linkFor(bundle.policy,payload.personId,date);
    if((active?.groupId||null)!==payload.link.groupId)fail(403,'payroll_group_assignment_forbidden','Gruppetilknytning skal ændres under Løngrupper af en bruger med gruppetilladelse.');
    policy=normalizedPolicy({...bundle.policy,links:[...bundle.policy.links.filter(link=>link.personId!==payload.personId||link.from!==date),payload.link]});
  }else{policy=normalizedPolicy(payload.policy);date=effectivePolicyDate(bundle.policy,policy,payload.date);}
  validatePolicyChange(bundle.policy,policy,context);const preview=policyPreview(bundle,policy,date);
  if(payload.action==='payrollPolicyPreview'){const previewToken=await policyPreviewToken(bundle,policy,date,context);await assertPayrollAccess(db,context,permissions);return response({preview,previewToken});}
  if(!personAction&&(typeof payload.previewToken!=='string'||payload.previewToken!==await policyPreviewToken(bundle,policy,date,context)))fail(409,'payroll_preview_changed','Forhåndsvisningen er ændret. Gennemgå medarbejderne igen, før du gemmer.');
  if(canonical(policy)===canonical(bundle.policy)){await assertPayrollAccess(db,context,permissions);return response(personAction?personalPayrollResult(bundle,payload.personId,context):policyReadResult(bundle));}
  const history=policyHistory(bundle,preview,context,principal,personAction?'person':'policy',bundle.version+1),write=policyWrite(db,context,bundle,policy,history,principal,permissions,!personAction);
  const result=await db.batch(write.statements);await assertPayrollAccess(db,context,permissions);
  if(!result.some(item=>item?.meta?.changes===1))fail(409,'payroll_policy_changed','Løn, medarbejdere eller rettigheder er ændret. Gennemgå den seneste version igen.');
  const committed={...bundle,policy,version:write.version,history};
  return response(personAction?personalPayrollResult(committed,payload.personId,context):policyReadResult(committed));
}

async function createEmployeeUser(db,context,principal,payload,secret) {
  if(Object.keys(payload).some(key=>!['action','name','email','site','roleId'].includes(key))) {
    fail(400,'mobile_admin_invalid','Angiv medarbejderens navn, e-mail, arbejdssted og rolle.');
  }
  const employee=inviteEmployeeDraft({newEmployee:{name:payload.name,site:payload.site}},context);
  const address=normalizeMobileEmail(payload.email);
  if(!address)fail(400,'mobile_email_invalid','Angiv en gyldig e-mailadresse.');
  const {definition}=await grant(db,payload,context,{},employee.id);
  requireGrant(context,definition);
  if(definition.permissions.length)fail(400,'mobile_role_invalid','Vælg en medarbejderrolle til app-login.');

  const workspaceId=context.workspace.id,stamp=now(),actor=actorGuard(context,['plan','users.manage']);
  const webAddress=inviteAddressGuard(workspaceId,address,stamp);
  const site=siteReferenceGuard({workspaceId,siteIndices:[employee.site]});
  const role=roleFence(workspaceId,definition);
  const addressGuard={sql:`${webAddress.sql} AND NOT EXISTS (SELECT 1 ${priorInviteEmployees})
    AND NOT EXISTS (SELECT 1 FROM workspace_mobile_credentials WHERE email=? AND (workspace_id=? OR revoked_at IS NULL))`,
    values:[...webAddress.values,workspaceId,address,address,workspaceId]};
  const addressInUse=()=>fail(409,'mobile_account_conflict','E-mailen bruges allerede. Find den eksisterende person under Brugere og roller eller Medarbejdere.');
  if(!await first(db,'SELECT 1 WHERE '+site.sql,...site.values))fail(400,'invalid_invite_employee','Vælg et eksisterende arbejdssted.');
  if(!await first(db,'SELECT 1 WHERE '+addressGuard.sql,...addressGuard.values))addressInUse();

  const {id:personId,...patch}=employee;
  const condition={sql:`${actor.sql} AND ${role.sql} AND ${site.sql} AND ${addressGuard.sql}`,
    values:[...actor.values,...role.values,...site.values,...addressGuard.values]};
  const prepared=await prepareDirectoryWrite({db,workspaceId,changes:[{kind:'employee',id:personId,expectedVersion:0,patch}],condition,at:stamp});
  const credential=await prepareMobileCredentialCreate({db,workspaceId,personId,email:address,actorGuard:prepared.condition,secret,atomic:true});
  const account={personId,email:credential.email,temporary:true,status:'active',version:credential.version};
  const result=await db.batch([...prepared.statements,credential.statement,...accountAuditStatements({db,context,principal,
    operation:'createEmployeeUser',id:personId,after:{...account,name:employee.name,roleId:definition.id},condition:credential.commit})]);
  if(result[0]?.meta?.changes===1)await refreshCommittedDirectoryAccess(db,context,prepared);await assertContext(db,context);
  if(result[prepared.statements.length]?.meta?.changes!==1){
    if(!await first(db,'SELECT 1 WHERE '+addressGuard.sql,...addressGuard.values))addressInUse();
    fail(409,'mobile_account_conflict','Medarbejderlisten eller rollen er ændret. Opdater listen, og prøv igen.');
  }
  return response({createdEmployee:employee,account,directory:prepared.directory,records:sharedData(prepared.records),workspace:{id:workspaceId}});
}

async function suggestedAppLoginEmail({db,workspaceId,personId,actorGuard:actor}) {
  const employee=employeeReferenceGuard({workspaceId,personIds:[personId],active:true});
  const matches=await rows(db,`SELECT email FROM (
    SELECT email FROM workspace_members WHERE workspace_id=? AND person_id=?
    UNION
    SELECT email FROM workspace_invites WHERE workspace_id=? AND person_id=? AND status='pending' AND expires_at>?
  ) WHERE (${actor.sql}) AND (${employee.sql})`,
  workspaceId,personId,workspaceId,personId,now(),...actor.values,...employee.values);
  const addresses=new Set(matches.map(match=>normalizeMobileEmail(match.email)).filter(Boolean));
  return addresses.size===1?addresses.values().next().value:null;
}

async function manageMobileCredential(db,context,principal,payload,caps,secret) {
  if(!caps.manageAppLogins)fail(403,'mobile_admin_forbidden','Kun en administrator kan administrere app-login.');
  if(payload.action==='createEmployeeUser')return createEmployeeUser(db,context,principal,payload,secret);
  const creating=payload.action==='createAppLogin';
  const reading=payload.action==='readAppLogin';
  const allowed=creating?['action','personId','email']:reading?['action','personId']:['action','personId','version'];
  if(Object.keys(payload).some(key=>!allowed.includes(key))||!Directory.validId('employee',payload.personId)||
    (!creating&&!reading&&(!Number.isSafeInteger(payload.version)||payload.version<1))) {
    fail(400,'mobile_admin_invalid','Vælg en gyldig medarbejder og det aktuelle app-login.');
  }
  await assertPersonAccess({db,context,personId:payload.personId});
  const options={db,workspaceId:context.workspace.id,personId:payload.personId,expectedVersion:creating?0:payload.version,actorGuard:actorGuard(context,['users.manage']),secret,
    audit:({condition,before,after})=>accountAuditStatements({db,context,principal,operation:payload.action,id:payload.personId,condition,before,after})};
  if(reading){
    const account=await readMobileCredential(options);
    const suggestedEmail=account?null:await suggestedAppLoginEmail(options);
    await assertContext(db,context);
    return response(account?{account}:{account,suggestedEmail});
  }
  if(payload.action==='revealAppStartCode'){
    const temporaryPassword=await revealMobileStartCode(options);
    await assertContext(db,context);
    return response({temporaryPassword});
  }
  if(payload.action==='revokeAppLogin'){
    const {version}=await revokeMobileCredential(options);
    return response({ok:true,version});
  }
  const address=creating?email(payload.email):undefined;
  if(creating&&!address)fail(400,'mobile_email_invalid','Angiv en gyldig e-mailadresse.');
  const result=await issueMobileCredential({...options,...(creating?{email:address}:{})});
  await assertContext(db,context);
  return response({account:{personId:payload.personId,email:result.email,temporary:true,status:'active',version:result.version,canRevealStartCode:secret!==undefined},temporaryPassword:result.temporaryPassword});
}

async function handleAccountsRequestInternal(request,storage,secret,addressLookupToken,onContext) {
  try {
    if(request.method!=='POST')return response({error:'method_not_allowed'},405);
    sameOrigin(request);
    const requestAuth=requestIdentity(request);
    const payload=await requestJSON(request,MAX_BODY_BYTES);
    if(!record(payload)||typeof payload.action!=='string')fail(400,'invalid_request','Vælg en gyldig kontohandling.');
    const limit=payload.action==='payrollExportProfileSave'?2*1024*1024:payload.action==='checklist'?MAX_BODY_BYTES:['payrollSave','timeWrite','leaveCreate'].includes(payload.action)?MAX_PAYROLL_BODY_BYTES:['payrollPolicyPreview','payrollPolicySave','payrollPersonPolicySave'].includes(payload.action)?MAX_PAYROLL_POLICY_BODY_BYTES:MAX_ACCOUNT_BODY_BYTES;
    if(encode.encode(JSON.stringify(payload)).byteLength>limit)fail(413,'body_too_large','Kontohandlingen indeholder for mange data.');
    const {db,signedIn,usingWeb}=await requestPrincipal(request,storage,requestAuth);
    if(payload.action==='acceptInvite'){
      if(usingWeb)fail(409,'already_member','Log ud af din CleanRooms-konto for at acceptere en invitation til en anden konto.');
      return response(await acceptInvite(db,signedIn,payload));
    }
    const principal=await selectedCompanyPrincipal(db,signedIn,request,usingWeb);
    if(payload.action==='siteAddressLookup'){
      const context=await resolveWorkspace(db,principal,{metadataOnly:true,directoryOnly:true});onContext(context);
      if(!capabilities(context).manageSiteGps)fail(403,'site_gps_forbidden','Kun en administrator kan ændre GPS-indstillinger for arbejdssteder.');
      const result=await lookupSiteAddress(payload,addressLookupToken);
      await assertContext(db,context);
      return response(result);
    }
    if(payload.action==='planningCostRead'){
      const context=await resolveWorkspace(db,principal,{metadataOnly:true,directoryOnly:true});onContext(context);
      return response(await readPlanningCost({db,context,payload,helpers:{
        capabilities,assertContext,fail,payrollBundle,policyVersionGuard,personVersionsGuard,first,
        assertPayrollAccess:current=>assertPayrollAccess(db,current,PAYROLL_VIEW),
        ensureOperationalSource:current=>ensureOperationalSource(db,current)
      }}));
    }
    if(payload.action==='planningAvailability'){
      const context=await resolveWorkspace(db,principal,{metadataOnly:true,directoryOnly:true});onContext(context);
      return response(await readPlanningAvailability({db,context,payload,helpers:{capabilities,assertContext,fail,rows,first}}));
    }
    if(payload.action==='publicationBudgetRead'){
      const context=await resolveWorkspace(db,principal,{metadataOnly:true,directoryOnly:true});onContext(context);
      return response(await readPublicationBudget({db,context,payload,helpers:{
        capabilities,assertContext,fail,ensureOperationalSource:current=>ensureOperationalSource(db,current)
      }}));
    }
    const mobileAdmin=MOBILE_ADMIN_ACTIONS.has(payload.action);
    const catalogRead=['list','payrollRead','payrollPolicyRead'].includes(payload.action),inviteWrite=payload.action==='invite',operational=mobileAdmin||CHAT_ACTIONS.has(payload.action)||['timeRead','timeWrite','timeDemo','payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen','payrollPeriodExport','payrollExportProfilesRead','payrollExportProfileRead','payrollExportProfileSave','payrollExportProfileArchive','payrollExportProfileEmployees','leaveRead','leaveCreate','leaveDecide','employeeRead','employeeShift','plannerDetail','checklist','workflowRead','workflowReadMessage','workflowRequest','workflowRespond','workflowDecide'].includes(payload.action),context=await resolveWorkspace(db,principal,{metadataOnly:operational||catalogRead||inviteWrite||payload.action==='preferences',directoryOnly:operational||inviteWrite||payload.action==='preferences',catalogOnly:catalogRead,personIds:inviteWrite?[payload.personId]:payload.action==='preferences'?[payload.preferences?.employeePerson]:[]}),caps=capabilities(context);
    onContext(context);
    if(isScoped(context)&&(['payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen','payrollPeriodExport','payrollExportProfilesRead','payrollExportProfileRead','payrollExportProfileSave','payrollExportProfileArchive','payrollExportProfileEmployees','payrollPolicyRead','payrollPolicyPreview','payrollPolicySave','createRole','updateRole','timeDemo','workflowDemo','chatDemo'].includes(payload.action)))fail(403,'department_company_action_forbidden','Denne handling omfatter hele virksomheden og kræver adgang til alle afdelinger.');
    await enforceWorkspaceRequestQuota({db,context,action:payload.action,helpers:{actorGuard,assertContext}});
    if(mobileAdmin)return await manageMobileCredential(db,context,principal,payload,caps,secret);
    if(CHAT_ACTIONS.has(payload.action))return response(await handleChatAction({db,context,payload,helpers:{actorGuard,assertContext,fail}}));
    if(payload.action==='activityRead')return response(await readActivity({db,context,payload,helpers:{capabilities,actorGuard,assertContext,fail,rows,first}}));
    if(['employeeRead','employeeShift'].includes(payload.action))return response(await handleEmployeeRead({db,context,payload,helpers:{capabilities,actorGuard,assertContext,fail,ensureOperationalPlanningSource:sourceContext=>ensureOperationalPlanningSource(db,sourceContext),ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)}}));
    if(payload.action==='plannerDetail')return response(await handlePlannerDetail({db,context,payload,helpers:{capabilities,actorGuard,assertContext,fail,ensureOperationalPlanningSource:sourceContext=>ensureOperationalPlanningSource(db,sourceContext),ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)}}));
    if(['workflowRead','workflowReadMessage','workflowRequest','workflowRespond','workflowDecide','workflowDemo'].includes(payload.action))return response(await handleShiftWorkflowAction({db,context,payload,principal,helpers:{capabilities,guard,actorGuard,assertContext,fail,rows,first,appendActivity,archiveStatements,ensureOperationalPlanningSource:sourceContext=>ensureOperationalPlanningSource(db,sourceContext),ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)}}));
    if(['payrollExportProfilesRead','payrollExportProfileRead','payrollExportProfileSave','payrollExportProfileArchive','payrollExportProfileEmployees'].includes(payload.action))return response(await handlePayrollExportProfileAction({db,context,payload,principal,helpers:{capabilities,actorGuard,assertContext,fail}}));
    if(['payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen','payrollPeriodExport'].includes(payload.action))return response(await handlePayrollPeriodAction({db,context,payload,principal,helpers:{capabilities,actorGuard,assertContext,fail,personVersionsGuard,ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)}}));
    if(['timeRead','timeWrite','timeDemo'].includes(payload.action))return response(await handleTimekeepingAction({db,context,payload,principal,helpers:{capabilities,actorGuard,assertContext,fail,statement,rows,first,payrollBundle,policyVersionGuard,personVersionsGuard,timeActivityStatements,ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext),ensureOperationalPlanningSource:sourceContext=>ensureOperationalPlanningSource(db,sourceContext)}}));
    if(['leaveRead','leaveCreate','leaveDecide'].includes(payload.action)){await ensureAbsences(db,context,{capabilities,actorGuard,assertContext,fail,ensureOperationalSource:sourceContext=>ensureOperationalSource(db,sourceContext)});return response(await handleAbsenceAction({db,context,payload,principal,helpers:{capabilities,actorGuard,assertContext}}));}
    if(payload.action==='payrollRead'||payload.action==='payrollSave')return await payrollAction(db,context,payload,principal);
    if(['payrollPolicyRead','payrollPolicyPreview','payrollPolicySave','payrollPersonPolicySave'].includes(payload.action))return await payrollPolicyAction(db,context,payload,principal);
    if(payload.action==='preferences') {
      const safe=preferences(payload.preferences,context),merged={...preferences(context.member.preferences,context,false),...safe},own=actorGuard(context);
      const result=await db.batch([statement(db,`UPDATE workspace_members SET preferences = ?,updated_at = ? WHERE user_id = ? AND ${own.sql}`,JSON.stringify(merged),now(),principal.userId,...own.values)]);
      if(result[0]?.meta?.changes!==1)fail(403,'membership_changed','Din adgang er ændret.');
      return response({preferences:merged});
    }
    if(payload.action==='checklist')return response(await handleChecklistAction({db,context,payload,helpers:{capabilities,actorGuard,assertContext,resolveAssignedShift:async(sourceContext,shiftId)=>{await initializeEmployeeReadContext({db,context:sourceContext,helpers:{capabilities,actorGuard,assertContext,fail,ensureOperationalPlanningSource:current=>ensureOperationalPlanningSource(db,current),ensureOperationalSource:current=>ensureOperationalSource(db,current)}});return readEmployeePublishedShift({db,workspaceId:sourceContext.workspace.id,personId:sourceContext.member.personId,shiftId});}}}));
    if(payload.action==='list') {
      if(!caps.manageUsers&&!caps.manageRoles)fail(403,'accounts_forbidden','Din rolle har ikke adgang til kontoadministration.');
      const definitions=(await rows(db,`SELECT r.*,(SELECT COUNT(*) FROM workspace_members assigned WHERE assigned.workspace_id = r.workspace_id AND assigned.role_id = r.id) AS assigned_count
        FROM workspace_roles r WHERE r.workspace_id = ? ORDER BY r.is_system DESC,r.name,r.id`,context.workspace.id)).map(roleDefinition),byId=new Map(definitions.map(role=>[role.id,role]));
      let members=caps.manageUsers?await rows(db,'SELECT * FROM workspace_members WHERE workspace_id = ? ORDER BY created_at,user_id',context.workspace.id):[];
      let invites=caps.manageUsers?await rows(db,'SELECT * FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at,id',context.workspace.id):[];
      let appLogins=caps.manageAppLogins?await listMobileCredentials({db,workspaceId:context.workspace.id}):undefined;
      if(isScoped(context)){members=members.filter(row=>{try{assertTargetScope(context,storedAccessScope(row.access_scope));return !row.person_id||context.staff.some(person=>person.id===row.person_id&&siteAllowed(context,person.site));}catch{return false;}});invites=invites.filter(row=>{try{assertTargetScope(context,storedAccessScope(row.access_scope));return true;}catch{return false;}});if(appLogins)appLogins=appLogins.filter(login=>context.staff.some(person=>person.id===login.personId&&siteAllowed(context,person.site)));definitions.forEach(role=>{delete role.assignedCount;});}
      const sites=caps.manageUsers&&caps.plan?(context.saved.studio.organization||Departments.defaultOrganization()).sites.flatMap(({id,name},index)=>siteAllowed(context,index)?[{id,name,index}]:[]):undefined;
      const departments=(context.saved.studio.organization||Departments.defaultOrganization()).departments.filter(department=>departmentAllowed(context,department.id)).map(({id,name})=>({id,name}));
      await assertContext(db,context);
      return response({members:members.map(row=>publicMember(member(row),context,byId.get(row.role_id))),invites:invites.map(row=>publicInvite(row,byId.get(row.role_id))),roles:definitions,
        permissionCatalog:Roles.catalog(),departments,...(caps.manageUsers?{staff:context.staff.filter(person=>siteAllowed(context,person.site)).map(({id,name,initials,active})=>({id,name,initials,active}))}:{}),...(sites?{sites}:{}),...(appLogins?{appLogins}:{}),viewer:viewer(context),capabilities:caps,workspace:{id:context.workspace.id}});
    }
    if(payload.action==='createRole'||payload.action==='updateRole') {
      requirePermission(context,'roles.manage');
      const errors=Roles.validate({name:payload.name,permissions:payload.permissions});if(errors.length)fail(400,'invalid_role',errors[0]);
      const permissions=Roles.normalizePermissions(payload.permissions),actor=actorGuard(context,['roles.manage']);
      if(payload.action==='createRole') {
        requireGrant(context,{permissions});const id='role-'+crypto.randomUUID(),stamp=now();
        const result=await db.batch([statement(db,`INSERT INTO workspace_roles (workspace_id,id,name,permissions,version,is_system,created_at,updated_at)
          SELECT ?,?,?,?,1,0,?,? WHERE ${actor.sql}`,context.workspace.id,id,payload.name,JSON.stringify(permissions),stamp,stamp,...actor.values),...accountAuditStatements({db,context,principal,operation:'createRole',id,after:{id,name:payload.name,permissions,version:1},condition:{sql:'EXISTS (SELECT 1 FROM workspace_roles WHERE workspace_id=? AND id=? AND version=1)',values:[context.workspace.id,id]}})]);
        if(result[0]?.meta?.changes!==1)fail(403,'membership_changed','Din adgang til at administrere roller er ændret.');
        return response({role:await readRole(db,context.workspace.id,id)});
      }
      if(!identity(payload.roleId))fail(400,'invalid_role','Vælg en gyldig rolle.');
      const current=await readRole(db,context.workspace.id,payload.roleId);
      if(!current)fail(404,'role_missing','Rollen findes ikke i arbejdsområdet.');
      if(current.isSystem)fail(403,'system_role_protected','De indbyggede roller kan ikke redigeres.');
      if(!Number.isSafeInteger(payload.version)||payload.version!==current.version)fail(409,'role_changed','Rollen er ændret. Hent listen igen.');
      requireGrant(context,{permissions},current);
      if(!permissions.length&&await first(db,"SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role_id = ? AND status = 'active' AND person_id IS NULL",context.workspace.id,current.id))fail(400,'person_assignment_required','Alle aktive konti i rollen skal knyttes til en medarbejder, før alle rettigheder fjernes.');
      const token=crypto.randomUUID(),stamp=now(),derived=Roles.legacy(permissions),nextVersion=current.version+1;
      const bound=permissions.length?'1 = 1':"NOT EXISTS (SELECT 1 FROM workspace_members unbound WHERE unbound.workspace_id = ? AND unbound.role_id = ? AND unbound.status = 'active' AND unbound.person_id IS NULL)";
      const boundValues=permissions.length?[]:[context.workspace.id,current.id];
      const committed='EXISTS (SELECT 1 FROM workspace_roles changed_role WHERE changed_role.workspace_id = ? AND changed_role.id = ? AND changed_role.version = ? AND changed_role.write_token = ?)';
      const committedValues=[context.workspace.id,current.id,nextVersion,token];
      const mutations=[statement(db,`UPDATE workspace_roles SET name = ?,permissions = ?,version = version + 1,write_token = ?,updated_at = ?
        WHERE workspace_id = ? AND id = ? AND version = ? AND is_system = 0 AND ${bound} AND ${actor.sql}`,
        payload.name,JSON.stringify(permissions),token,stamp,context.workspace.id,current.id,current.version,...boundValues,...actor.values)];
      mutations.push(...accountAuditStatements({db,context,principal,operation:'updateRole',id:current.id,before:current,after:{...current,name:payload.name,permissions,version:nextVersion},condition:{sql:committed,values:committedValues}}));
      if(!permissions.includes('users.manage'))mutations.push(statement(db,`UPDATE workspace_invites SET status = 'revoked',version = version + 1,updated_at = ?
        WHERE workspace_id = ? AND status = 'pending' AND created_by IN (SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role_id = ?) AND ${committed}`,
        stamp,context.workspace.id,context.workspace.id,current.id,...committedValues));
      mutations.push(statement(db,`UPDATE workspace_members SET role = ?,manage_departments = ?,version = version + 1,updated_at = ?
        WHERE workspace_id = ? AND role_id = ? AND ${committed}`,derived.role,Number(derived.manageDepartments),stamp,context.workspace.id,current.id,...committedValues));
      mutations.push(statement(db,`UPDATE workspace_invites SET role = ?,manage_departments = ?,updated_at = ?
        WHERE workspace_id = ? AND role_id = ? AND ${committed}`,derived.role,Number(derived.manageDepartments),stamp,context.workspace.id,current.id,...committedValues));
      const result=await db.batch(mutations);
      if(result[0]?.meta?.changes!==1)fail(409,'role_changed','Rollen, kontotilknytningen eller dine rettigheder er ændret.');
      if(context.role.id===current.id){context.member=await membership(db,context.member.userId);context.role=await readRole(db,context.workspace.id,current.id);await loadDepartmentAccess({db,context});}
      return response({role:await readRole(db,context.workspace.id,current.id)});
    }
    requirePermission(context,'users.manage');const actor=actorGuard(context,['users.manage']);
    if(payload.action==='invite') {
      const grantedScope=await validateGrantScope({db,context,value:payload.accessScope});
      const address=email(payload.email);if(!address)fail(400,'invalid_invite','Angiv en gyldig e-mailadresse.');
      if(payload.newUser===true&&payload.personId!=null)fail(400,'invalid_invite','En ny brugerkonto skal oprettes med navn, e-mailadresse og rolle.');
      const employee=inviteEmployeeDraft(payload,context),permission=await grant(db,payload,context,{},employee?.id),name=payload.name??employee?.name??'';requireGrant(context,permission.definition);
      if(typeof name!=='string'||name.length>200||/[\u0000-\u001f\u007f]/.test(name))fail(400,'invalid_invite','Navnet er ugyldigt.');
      const workspaceId=context.workspace.id,role=roleFence(workspaceId,permission.definition),token=newToken(),hash=await tokenHash(token),id='invite-'+crypto.randomUUID(),stamp=now(),expires=new Date(Date.now()+7*86400000).toISOString();
      const addressGuard=employee||payload.newUser===true?inviteAddressGuard(workspaceId,address,stamp):null;
      if(addressGuard&&!await first(db,'SELECT 1 WHERE '+addressGuard.sql,...addressGuard.values))duplicateInvite();
      const employeeGuard=employee?await inviteEmployeeGuard(db,workspaceId,address,stamp,employee):null;
      const personId=employeeGuard?.personId??permission.personId;
      const scopeAcl=grantScopeGuard(context,grantedScope);let prepared=null,condition=addressGuard?{sql:`${role.sql} AND ${addressGuard.sql} AND ${scopeAcl.sql}`,values:[...role.values,...addressGuard.values,...scopeAcl.values]}:{sql:role.sql+' AND '+scopeAcl.sql,values:[...role.values,...scopeAcl.values]};
      if(employee){
        const directoryActor=actorGuard(context,['plan','users.manage']),site=siteReferenceGuard({workspaceId,siteIndices:[employee.site]});
        if(!await first(db,'SELECT 1 WHERE '+site.sql,...site.values))fail(400,'invalid_invite_employee','Vælg et eksisterende arbejdssted.');
        condition={sql:`${condition.sql} AND ${directoryActor.sql} AND ${site.sql} AND ${employeeGuard.sql}`,values:[...condition.values,...directoryActor.values,...site.values,...employeeGuard.values]};
        if(!employeeGuard.personId){
          const {id:employeeId,...patch}=employee;
          prepared=await prepareDirectoryWrite({db,workspaceId,changes:[{kind:'employee',id:employeeId,expectedVersion:0,patch}],condition,at:stamp});
        }
      }
      // Only the directory commit in this batch can authorize an invitation for a new employee.
      const target=referenceAcl(context,prepared?.condition??condition,[personId]),committedActor=prepared?actorGuard(context,['users.manage'],prepared.condition):actor;
      const result=await db.batch([...(prepared?.statements||[]),statement(db,`INSERT INTO workspace_invites (id,workspace_id,email,name,role,role_id,manage_departments,person_id,token_hash,status,version,expires_at,created_by,created_at,updated_at,access_scope)
        SELECT ?,?,?,?,?,?,?,?,?,'pending',1,?,?,?,?,? WHERE ${committedActor.sql} AND ${target.sql}`,
        id,workspaceId,address,name.trim(),permission.role,permission.roleId,Number(permission.manageDepartments),personId,hash,expires,principal.userId,stamp,stamp,JSON.stringify(grantedScope),...committedActor.values,...target.values),...accountAuditStatements({db,context,principal,operation:'invite',id,after:{id,email:address,name:name.trim(),roleId:permission.roleId,personId,accessScope:grantedScope,status:'pending',version:1},condition:{sql:"EXISTS (SELECT 1 FROM workspace_invites WHERE workspace_id=? AND id=? AND status='pending' AND version=1)",values:[workspaceId,id]}})]);
      if(result[prepared?.statements.length||0]?.meta?.changes!==1){
        if(addressGuard){
          await assertContext(db,context);
          if(!await first(db,'SELECT 1 WHERE '+addressGuard.sql,...addressGuard.values))duplicateInvite();
        }
        if(employee)fail(409,'invite_employee_changed','Medarbejderlisten eller rollen er ændret. Hent den seneste liste, og prøv igen.');
        fail(403,'membership_changed','Dine rettigheder eller den valgte rolle er ændret.');
      }
      return response({invite:publicInvite(await first(db,'SELECT * FROM workspace_invites WHERE id = ?',id),permission.definition),inviteUrl:new URL('/join?token='+encodeURIComponent(token),request.url).href,
        ...(prepared?{createdEmployee:employee,directory:prepared.directory,records:sharedData(prepared.records),workspace:{id:workspaceId}}:{})});
    }
    if(payload.action==='updateMember') {
      if(!identity(payload.userId))fail(400,'invalid_member','Vælg en gyldig konto.');
      const current=await membership(db,payload.userId);
      if(!current||current.workspaceId!==context.workspace.id)fail(404,'member_missing','Kontoen findes ikke i arbejdsområdet.');
      assertTargetScope(context,current.accessScope);const grantedScope=await validateGrantScope({db,context,value:payload.accessScope,current:current.accessScope});
      if(current.userId===context.workspace.ownerUserId&&grantedScope.mode!=='all')fail(403,'owner_protected','Ejeren skal have adgang til hele virksomheden.');
      if(!Number.isSafeInteger(payload.version)||payload.version!==current.version)fail(409,'member_changed','Kontoen er ændret. Hent listen igen.');
      const currentRole=await readRole(db,context.workspace.id,current.roleId),permission=await grant(db,payload,context,current);
      if(!currentRole)fail(403,'role_invalid','Kontoens rolle kunne ikke bekræftes.');
      requireGrant(context,permission.definition,currentRole);
      const status=Object.hasOwn(payload,'status')?payload.status:current.status,name=Object.hasOwn(payload,'name')?payload.name:current.name;
      if(!['active','disabled'].includes(status)||typeof name!=='string'||!name.trim()||name.length>200||/[\u0000-\u001f\u007f]/.test(name))fail(400,'invalid_member','Kontoens navn eller status er ugyldig.');
      if(current.userId===context.workspace.ownerUserId&&(permission.roleId!=='admin'||status!=='active'||payload.manageDepartments===false))fail(403,'owner_protected','Ejeren kan ikke deaktiveres eller miste administratoradgang.');
      const target=referenceAcl(context,roleFence(context.workspace.id,permission.definition),[permission.personId]),prior=roleFence(context.workspace.id,currentRole),scopeAcl=grantScopeGuard(context,grantedScope),condition=`${actor.sql} AND ${target.sql} AND ${prior.sql} AND ${scopeAcl.sql}`;
      const conditions=[...actor.values,...target.values,...prior.values,...scopeAcl.values],mutations=[];
      if(!permission.definition.permissions.includes('users.manage')||status!=='active')mutations.push(statement(db,`UPDATE workspace_invites SET status = 'revoked',version = version + 1,updated_at = ?
        WHERE workspace_id = ? AND created_by = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM workspace_members target WHERE target.user_id = ? AND target.workspace_id = ? AND target.version = ?) AND ${condition}`,
        now(),context.workspace.id,current.userId,current.userId,context.workspace.id,current.version,...conditions));
      mutations.push(...accountAuditStatements({db,context,principal,operation:'updateMember',id:current.userId,before:current,after:{...current,name:name.trim(),roleId:permission.roleId,personId:permission.personId,status,accessScope:grantedScope,version:current.version+1},condition:{sql:`EXISTS (SELECT 1 FROM workspace_members WHERE user_id=? AND workspace_id=? AND version=?) AND ${condition}`,values:[current.userId,context.workspace.id,current.version,...conditions]}}));
      mutations.push(statement(db,`UPDATE workspace_members SET name = ?,role = ?,role_id = ?,manage_departments = ?,person_id = ?,status = ?,access_scope = ?,version = version + 1,updated_at = ?
        WHERE user_id = ? AND workspace_id = ? AND version = ? AND ${condition}`,
        name.trim(),permission.role,permission.roleId,Number(permission.manageDepartments),permission.personId,status,JSON.stringify(grantedScope),now(),current.userId,context.workspace.id,current.version,...conditions));
      const result=await db.batch(mutations);
      if(result.at(-1)?.meta?.changes!==1)fail(409,'member_changed','Kontoen, rollen eller din kontoadgang er ændret.');
      if(current.userId===context.member.userId){context.member=await membership(db,current.userId);context.role=await readRole(db,context.workspace.id,context.member.roleId);await loadDepartmentAccess({db,context});}
      return response({member:publicMember(await membership(db,current.userId),context,permission.definition)});
    }
    if(payload.action==='revokeInvite') {
      if(!identity(payload.inviteId))fail(400,'invalid_invite','Vælg en gyldig invitation.');
      const invite=await first(db,'SELECT * FROM workspace_invites WHERE id = ? AND workspace_id = ?',payload.inviteId,context.workspace.id);
      if(!invite)fail(404,'invite_missing','Invitationen findes ikke.');
      assertTargetScope(context,storedAccessScope(invite.access_scope));
      const target=await readRole(db,context.workspace.id,invite.role_id);if(!target)fail(403,'role_invalid','Invitationens rolle findes ikke.');requireGrant(context,target);
      if(invite.status!=='pending'||payload.version!==undefined&&payload.version!==invite.version)fail(409,'invite_changed','Invitationen er ændret eller allerede brugt.');
      const targetAcl=roleFence(context.workspace.id,target),result=await db.batch([...accountAuditStatements({db,context,principal,operation:'revokeInvite',id:invite.id,before:{...invite,roleId:invite.role_id,personId:invite.person_id},after:{...invite,roleId:invite.role_id,personId:invite.person_id,status:'revoked',version:invite.version+1},condition:{sql:`EXISTS (SELECT 1 FROM workspace_invites WHERE workspace_id=? AND id=? AND status='pending' AND version=?) AND ${actor.sql} AND ${targetAcl.sql}`,values:[context.workspace.id,invite.id,invite.version,...actor.values,...targetAcl.values]}}),statement(db,`UPDATE workspace_invites SET status = 'revoked',version = version + 1,updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'pending' AND version = ? AND ${actor.sql} AND ${targetAcl.sql}`,
        now(),invite.id,context.workspace.id,invite.version,...actor.values,...targetAcl.values)]);
      if(result.at(-1)?.meta?.changes!==1)fail(409,'invite_changed','Invitationen, rollen eller din kontoadgang er ændret.');
      return response({invite:publicInvite(await first(db,'SELECT * FROM workspace_invites WHERE id = ?',invite.id),target)});
    }
    fail(400,'invalid_action','Kontohandlingen understøttes ikke.');
  }catch(error){return errorResponse(error);}
}


async function responseWithAccessIdentity(run){
 let context=null;const result=await run(value=>{context=value;});
 if(!context&&result.status>=400)return result;const body=await result.json();if(!record(body))return response(body,result.status,Object.fromEntries(result.headers));
 let parts;
 if(context)parts=[context.workspace.id,context.member.userId,context.member.version,context.role.id,context.role.version,context.member.accessScope,isScoped(context)?context.access?.departmentIds??[]:null,isScoped(context)?context.access?.siteIds??[]:null];
 else if(body.viewer&&body.workspace&&body.capabilities)parts=[body.workspace.id,body.viewer.userId,body.viewer.memberVersion??body.viewer.version,body.viewer.roleId,body.viewer.roleVersion,body.viewer.accessScope,body.capabilities.allowedDepartmentIds,body.capabilities.allowedSiteIds];
 if(!parts)return response(body,result.status,Object.fromEntries(result.headers));
 return response({...body,accessIdentity:await tokenHash(canonical(parts))},result.status,Object.fromEntries(result.headers));
}
export async function handleWorkspaceStudioRequest(request,storage){return responseWithAccessIdentity(onContext=>handleWorkspaceStudioRequestInternal(request,storage,onContext));}
export async function handleDirectoryRequest(request,storage){return responseWithAccessIdentity(onContext=>handleDirectoryRequestInternal(request,storage,onContext));}
export async function handleAccountsRequest(request,storage,secret,addressLookupToken){return responseWithAccessIdentity(onContext=>handleAccountsRequestInternal(request,storage,secret,addressLookupToken,onContext));}
