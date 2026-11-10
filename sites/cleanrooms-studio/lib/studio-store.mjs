/* Owner-scoped, revisioned snapshots. D1 batches make header/chunks one commit. */
import Departments from '../src/department-model.js';
import Publication from '../src/publication-model.js';
import Roster from '../src/roster-model.js';
import Series from '../src/series-engine.js';
import {planningCoreErrors} from './planning-validation.mjs';
import Roles from '../src/role-model.js';
import ShiftWorkflow from '../src/shift-workflow-model.js';
import {ensurePlanningImported,planningState,preparePlanningWrite,PlanningStoreError} from './planning-store.mjs';
import PlanningWindow from '../src/planning-window.js';
import Data from '../src/studio-data.js';
import PayrollPeriod from '../src/payroll-period-model.js';
import {decodeWindowCursor,ensurePlanWindowIndex,readWindowPage} from './planning-window-store.mjs';
import PlanningScope from '../src/planning-scope.js';
import {ensurePlanningSchedules,decodeSelectionCursor,readSelectionPage} from './planning-selection-store.mjs';
import {ensureDirectory,hydrateDirectory,readDirectoryHeader,prepareDirectorySnapshotWrite,trimDirectorySnapshot} from './directory-store.mjs';
import {directoryVersionGuard,employeeRemovalGuard} from './directory-references.mjs';
export {projectStudioSelection} from './planning-selection-store.mjs';
export {projectStudioWindow} from './planning-window-store.mjs';

export const STORAGE_VERSION = 1;
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
export const CHUNK_BYTES = 512 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true});
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const MAX_CHUNKS = Math.ceil(MAX_BODY_BYTES / CHUNK_BYTES) + 1;

export class StudioError extends Error {
  constructor(status,code,message) { super(message); this.status = status; this.code = code; }
}

function bad(message) { throw new StudioError(400,'invalid_studio',message); }
function ownerId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new StudioError(401,'authentication_required','Log ind med ChatGPT for at gemme planen.');
  return value;
}

export function validateStudio(studio,{readOnly=false,previous}={}) {
  if (!record(studio) || studio.storageVersion !== STORAGE_VERSION) bad('Planens lagringsversion er ugyldig.');
  for (const key of ['series','deleted','coverageRules']) if (!Array.isArray(studio[key])) bad('Planen mangler en gyldig ' + key + '-liste.');
  for (const key of ['edits','weekPlans','requests','checklistProgress']) if (!record(studio[key])) bad('Planen mangler et gyldigt ' + key + '-objekt.');
  if (studio.series.some(value => !record(value)) || studio.coverageRules.some(value => !record(value))) bad('Vagtserier og bemandingsbehov skal være objekter.');
  if(!readOnly){const errors=planningCoreErrors(studio,previous);if(errors.length)bad(errors[0]);}
  if (studio.deleted.some(value => typeof value !== 'string')) bad('Slettede vagter skal have tekst-id.');
  for (const key of ['edits','weekPlans','checklistProgress']) if (Object.values(studio[key]).some(value => !record(value))) bad('Planen indeholder ugyldige poster i ' + key + '.');
  if (Object.values(studio.requests).some(value => !['pending','approved','rejected'].includes(value))) bad('Planen indeholder en ugyldig fraværsbeslutning.');
  if(Object.hasOwn(studio,'leaveDecisions')) {
    if(!record(studio.leaveDecisions)||Object.entries(studio.leaveDecisions).some(([id,value])=>!id||!record(value)||!['pending','approved','rejected'].includes(value.status)||typeof value.reason!=='string'||value.reason.length>16000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.reason)
      ||value.decidedAt!==undefined&&(typeof value.decidedAt!=='string'||!Number.isFinite(Date.parse(value.decidedAt)))
      ||value.decidedBy!==undefined&&(!record(value.decidedBy)||typeof value.decidedBy.userId!=='string'||typeof value.decidedBy.name!=='string')))bad('Fraværsbeslutningerne er ugyldige.');
  }
  if (Object.hasOwn(studio,'organization')) {
    const errors = Departments.validate(studio.organization);
    if (errors.length) bad(errors[0]);
  }
  if (Object.hasOwn(studio,'roster')) {
    const errors=Roster.validate(studio.roster,{sites:(studio.organization||Departments.defaultOrganization()).sites});
    if(errors.length)bad(errors[0]);
  }
  if (Object.hasOwn(studio,'workspaceSettings')) {
    const limits={companyName:120,productName:80,contactName:120,contactEmail:320,contactPhone:60,brandNote:2000};
    if(!record(studio.workspaceSettings))bad('Virksomhedsindstillingerne er ugyldige.');
    const {workHours,workHoursBudget,payrollPeriod,...details}=studio.workspaceSettings;
    if(Object.entries(details).some(([key,value])=>!Object.hasOwn(limits,key)||typeof value!=='string'||value.length>limits[key]||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)))bad('Virksomhedsindstillingerne er ugyldige.');
    if(workHoursBudget!==undefined&&workHoursBudget!==null&&!Roster.validWorkHoursBudget(workHoursBudget))bad('Virksomhedens timebudget er ugyldigt.');
    if(Object.hasOwn(studio.workspaceSettings,'payrollPeriod')&&!PayrollPeriod.valid(payrollPeriod))bad('Lønperiodens startdag skal være et heltal fra 1 til 31.');
    if(details.contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.contactEmail))bad('Kontaktens e-mailadresse er ugyldig.');
  }
  if(Object.hasOwn(studio,'demoSeed')&&typeof studio.demoSeed!=='boolean')bad('Eksempeldataindstillingen er ugyldig.');
  if(Object.hasOwn(studio,'publications')){const errors=Publication.validate(studio.publications);if(errors.length)bad(errors[0]);}
  if(Object.hasOwn(studio,'shiftWorkflow')){const errors=ShiftWorkflow.validate(studio.shiftWorkflow);if(errors.length)bad(errors[0]);}
  if(Object.hasOwn(studio,'activity')) {
    if(!Array.isArray(studio.activity)||studio.activity.length>100||studio.activity.some(item=>!record(item)||typeof item.id!=='string'||!['plan','publication','checklist'].includes(item.kind)||typeof item.summary!=='string'||!record(item.actor)||typeof item.actor.userId!=='string'||typeof item.actor.name!=='string'||typeof item.at!=='string'||!Number.isFinite(new Date(item.at).getTime())||!Number.isSafeInteger(item.revision)||!record(item.counts)||!Array.isArray(item.changes)||typeof item.recoverable!=='boolean'))bad('Aktivitetshistorikken er ugyldig.');
  }
  const ancestors = new WeakSet();
  function json(value,depth) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if ((!record(value) && !Array.isArray(value)) || depth > 128 || ancestors.has(value)) bad('Planen skal være gyldige JSON-data.');
    ancestors.add(value);
    for (const [key,child] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) bad('Planen indeholder en ugyldig nøgle.');
      json(child,depth + 1);
    }
    ancestors.delete(value);
  }
  json(studio,0);
  // Older clients and saved plans may carry a retired per-employee default.
  // It has no meaning as a budget and must not reappear in new snapshots.
  if(Object.hasOwn(studio.workspaceSettings||{},'workHours')){
    const workspaceSettings={...studio.workspaceSettings};
    delete workspaceSettings.workHours;
    return {...studio,workspaceSettings};
  }
  return studio;
}

export function splitSnapshot(serialized) {
  const bytes = encoder.encode(serialized);
  if (bytes.length > MAX_BODY_BYTES) throw new StudioError(413,'snapshot_too_large','Planen fylder mere end 16 MiB. Ingen data er overskrevet.');
  const chunks = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + CHUNK_BYTES,bytes.length);
    // A TEXT row must end between complete UTF-8 code points.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(decoder.decode(bytes.subarray(start,end))); start = end;
  }
  return {chunks,byteLength:bytes.length};
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) bad('Planens revision er ugyldig.');
  return value;
}
function prepared(db,sql,...values) {
  // D1PreparedStatement does not expose its bound values; enforce limits before constructing it.
  if(values.length>100||encoder.encode(sql).length>100*1024||values.some(value=>typeof value==='string'&&encoder.encode(value).length>2*1024*1024))throw new StudioError(413,'planning_batch_too_large','Handlingen er for stor til én sikker transaktion. Ændr færre poster ad gangen; eksisterende data er bevaret.');
  return db.prepare(sql).bind(...values);
}

export async function readRawStudio(db,owner) {
  ownerId(owner);
  const result = await db.batch([
    prepared(db,'SELECT revision, write_token, chunk_count, byte_length FROM studio_states WHERE owner_id = ?',owner),
    prepared(db,`SELECT c.chunk_index, c.content FROM studio_state_chunks c
      JOIN studio_states s ON s.owner_id = c.owner_id AND s.revision = c.revision
      WHERE s.owner_id = ? ORDER BY c.chunk_index`,owner),
    prepared(db,'SELECT id FROM workspaces WHERE snapshot_owner_id = ?',owner)
  ]);
  const header = result[0]?.results?.[0];
  const source={exists:Boolean(header),revision:header?.revision||0,token:header?.write_token||'',workspaceId:result[2]?.results?.[0]?.id||null};
  const receipt=value=>Object.defineProperty(value,'source',{value:source,enumerable:false});
  if (!header) return receipt({revision:0,studio:null});
  if (header.revision === 0 && header.chunk_count === 0) return receipt({revision:0,studio:null});
  const chunks = result[1]?.results || [];
  if (!Number.isSafeInteger(header.revision) || header.revision < 1 || header.revision > Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(header.chunk_count) || header.chunk_count < 1 || header.chunk_count > MAX_CHUNKS
    || chunks.length !== header.chunk_count || !Number.isSafeInteger(header.byte_length) || header.byte_length < 1 || header.byte_length > MAX_BODY_BYTES
    || chunks.some((chunk,index) => chunk.chunk_index !== index || typeof chunk.content !== 'string')) {
    throw new StudioError(500,'invalid_saved_state','Den gemte plan kunne ikke læses. Ingen data er overskrevet.');
  }
  const serialized = chunks.map(chunk => chunk.content).join('');
  if (encoder.encode(serialized).length !== header.byte_length) throw new StudioError(500,'invalid_saved_state','Den gemte plan er ufuldstændig. Ingen data er overskrevet.');
  try { return receipt({revision:header.revision,studio:validateStudio(JSON.parse(serialized),{readOnly:true})}); }
  catch { throw new StudioError(500,'invalid_saved_state','Den gemte plan kunne ikke læses. Ingen data er overskrevet.'); }
}

async function initializeDirectory(db,owner,raw){
  if(!raw.source.workspaceId||!raw.studio)return raw;
  const alreadyTrimmed=raw.studio.directorySchema===1&&!Object.hasOwn(raw.studio,'roster')&&!Object.hasOwn(raw.studio,'organization');
  if(!await ensureDirectory({db,workspaceId:raw.source.workspaceId,owner,raw,splitSnapshot}))throw new StudioError(409,'directory_changed','Medarbejderne eller afdelingerne er ændret. Hent igen.');
  // Only a legacy import rewrites this source. Keep the request's validated
  // metadata for an established directory; the enclosing read still fences it.
  return alreadyTrimmed?raw:readRawStudio(db,owner);
}

async function directoryRead(db,raw,catalog,context){
  if(!raw.source.workspaceId||!raw.studio)return {raw,header:null,directory:null};
  const header=await readDirectoryHeader({db,workspaceId:raw.source.workspaceId});if(!header)throw new StudioError(500,'directory_import_incomplete','Medarbejderne eller afdelingerne mangler deres lagringsgrundlag.');
  const studio=await hydrateDirectory({db,workspaceId:raw.source.workspaceId,studio:raw.studio,catalog,context}),directory={...studio.directory,complete:true};delete studio.directorySchema;const result={...raw,studio};
  Object.defineProperty(result,'source',{value:raw.source,enumerable:false});Object.defineProperty(result,'directory',{value:directory,enumerable:false});return {raw:result,header,directory};
}

async function directoryUnchanged(db,workspaceId,header){
  if(!header)return true;const current=await readDirectoryHeader({db,workspaceId});return Boolean(current&&current.version===header.version&&current.write_token===header.write_token);
}

function directoryCursor(cursor,revision){
  if(!cursor)return cursor;const value=JSON.parse(decoder.decode(Uint8Array.from(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')),letter=>letter.charCodeAt(0))));value.directoryRevision=revision;return btoa(String.fromCharCode(...encoder.encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function directoryPage(db,workspaceId,loaded,cursor,read){
  if(cursor&&cursor.directoryRevision!==loaded.header?.version)throw new StudioError(409,'directory_changed','Medarbejderne eller afdelingerne er ændret. Hent perioden igen.');
  const page=await read();if(!await directoryUnchanged(db,workspaceId,loaded.header))throw new StudioError(409,'directory_changed','Medarbejderne eller afdelingerne er ændret. Hent perioden igen.');
  return {...page,directory:page.studio===undefined?{schema:1,revision:loaded.header.version}:loaded.directory,nextCursor:directoryCursor(page.nextCursor,loaded.header.version)};
}

export async function readStudio(db,owner) {
  ownerId(owner);
  // Rows and snapshot metadata must come from the same monotonically fenced generation.
  for(let attempt=0;attempt<3;attempt++){
    let raw=await readRawStudio(db,owner);const workspaceId=raw.source.workspaceId;
    if(!workspaceId)return raw;
    try{
      const imported=await ensurePlanningImported({db,workspaceId,owner,source:raw.source,studio:raw.studio});
      if(!imported)continue;
      raw=await initializeDirectory(db,owner,raw);const loadedDirectory=await directoryRead(db,raw,false);raw=loadedDirectory.raw;
      const hydrated=await planningState({db,workspaceId,studio:raw.studio});
      const check=(await db.batch([prepared(db,'SELECT revision,write_token FROM studio_states WHERE owner_id = ?',owner)]))[0]?.results?.[0];
      if((check?.revision||0)!==raw.source.revision||(check?.write_token||'')!==raw.source.token)continue;
      if(!await directoryUnchanged(db,workspaceId,loadedDirectory.header))continue;
      let studio=null;if(raw.studio!==null){try{studio=validateStudio(hydrated.studio,{readOnly:true});}catch{throw new StudioError(500,'invalid_planning_records','Planens gemte poster er ugyldige. Eksisterende data er bevaret.');}}
      const result={revision:raw.revision,studio};
      Object.defineProperty(result,'planning',{value:hydrated.planning,enumerable:false,configurable:true});
      Object.defineProperty(result,'source',{value:raw.source,enumerable:false});if(loadedDirectory.directory)Object.defineProperty(result,'directory',{value:loadedDirectory.directory,enumerable:false});return result;
    }catch(error){
      if(error instanceof PlanningStoreError||Number.isInteger(error?.status)&&typeof error?.code==='string'){
        const current=(await db.batch([prepared(db,'SELECT revision,write_token FROM studio_states WHERE owner_id = ?',owner)]))[0]?.results?.[0];
        if((current?.revision||0)!==raw.source.revision||(current?.write_token||'')!==raw.source.token)continue;
        throw new StudioError(error.status,error.code,error.message);
      }
      throw error;
    }
  }
  throw new StudioError(409,'planning_read_conflict','Planen ændrer sig i et andet vindue. Hent den seneste version igen.');
}

export async function readStudioWindow(db,owner,{from,to,cursor=null,instructions,context}={}){
  ownerId(owner);let projection,continuation;
  try{if(instructions!==undefined&&instructions!=='deferred')throw new TypeError('Vælg en gyldig instruktionsvisning.');projection=PlanningWindow.normalize({mode:'calendar',from,to});if(from<Data.minDate||to>Data.maxDate)throw new TypeError('Vælg en gyldig kalenderperiode.');continuation=decodeWindowCursor(cursor);}catch(error){throw new StudioError(error.status||400,error.code||'invalid_calendar_window',error.message);}
  for(let attempt=0;attempt<3;attempt++){
    let raw=await readRawStudio(db,owner);const workspaceId=raw.source.workspaceId;
    if(!workspaceId||!raw.studio)throw new StudioError(409,'planning_window_unavailable','Indlæs arbejdsområdet, før kalenderen åbnes.');
    try{
      if(!continuation){
        if(!await ensurePlanningImported({db,workspaceId,owner,source:raw.source,studio:raw.studio}))continue;
        raw=await initializeDirectory(db,owner,raw);
        const indexOutcome={};
        if(!await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot,outcome:indexOutcome}))continue;
        if(indexOutcome.sourceChanged)raw=await readRawStudio(db,owner);
      }
      const loadedDirectory=await directoryRead(db,raw,true,context);raw=loadedDirectory.raw;
      return await directoryPage(db,workspaceId,loadedDirectory,continuation,()=>readWindowPage({db,workspaceId,owner,raw,projection,cursor:continuation,instructions,context}));
    }catch(error){
      if(Number.isInteger(error?.status)&&typeof error?.code==='string'){
        const current=(await db.batch([prepared(db,'SELECT revision,write_token FROM studio_states WHERE owner_id = ?',owner)]))[0]?.results?.[0];
        if((current?.revision||0)!==raw.source.revision||(current?.write_token||'')!==raw.source.token){if(!continuation)continue;throw new StudioError(409,'planning_window_conflict','Planen er ændret. Hent kalenderperioden igen.');}
        throw new StudioError(error.status,error.code,error.message);
      }
      throw error;
    }
  }
  throw new StudioError(409,'planning_window_conflict','Planen ændrer sig i et andet vindue. Hent kalenderperioden igen.');
}

export async function readStudioSelection(db,owner,requested={}){
  ownerId(owner);const {cursor=null,instructions,context,...scope}=requested;let projection,continuation;
  try{projection=PlanningScope.normalize(scope);continuation=decodeSelectionCursor(cursor);}catch(error){throw new StudioError(error.status||400,error.code||'invalid_planning_selection',error.message);}
  if(projection.mode==='calendar')return readStudioWindow(db,owner,{...projection,cursor,instructions,context});
  for(let attempt=0;attempt<3;attempt++){
    let raw=await readRawStudio(db,owner);const workspaceId=raw.source.workspaceId;if(!workspaceId||!raw.studio)throw new StudioError(409,'planning_selection_unavailable','Indlæs arbejdsområdet, før planvisningen åbnes.');
    try{
      if(!continuation){
        if(!await ensurePlanningImported({db,workspaceId,owner,source:raw.source,studio:raw.studio}))continue;
        raw=await initializeDirectory(db,owner,raw);const indexOutcome={};
        if(!await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot,outcome:indexOutcome}))continue;
        // Catalog-only pages repair selected summaries within their page budget.
        // Other selections retain their existing complete summary initialization.
        if(!(projection.mode==='series-list'&&projection.catalogOnly===true))await ensurePlanningSchedules({db,workspaceId,context});
        if(indexOutcome.sourceChanged)raw=await readRawStudio(db,owner);
      }
      const loadedDirectory=await directoryRead(db,raw,true,context);raw=loadedDirectory.raw;
      return await directoryPage(db,workspaceId,loadedDirectory,continuation,()=>readSelectionPage({db,workspaceId,owner,raw,projection,cursor:continuation,instructions,context}));
    }catch(error){if(Number.isInteger(error?.status)&&typeof error?.code==='string'){const header=(await db.batch([prepared(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',owner)]))[0]?.results?.[0];if(header?.revision!==raw.revision||header?.write_token!==raw.source.token){if(!continuation)continue;throw new StudioError(409,'planning_selection_conflict','Planen er ændret. Hent det berørte område igen.');}throw new StudioError(error.status,error.code,error.message);}throw error;}
  }
  throw new StudioError(409,'planning_selection_conflict','Planen ændrer sig i et andet vindue. Hent det berørte område igen.');
}

function studioGuard(owner,guard) {
  if (!guard) return {sql:'1 = 1',values:[]};
  if(guard.roleId!==undefined) {
    const permissions=guard.permissions||[],known=Roles.PERMISSION_KEYS;
    if(!record(guard)||typeof guard.userId!=='string'||typeof guard.workspaceId!=='string'||!Number.isSafeInteger(guard.version)
      ||typeof guard.roleId!=='string'||!Number.isSafeInteger(guard.roleVersion)||!Array.isArray(permissions)||permissions.some(key=>!known.includes(key)))throw new StudioError(403,'membership_changed','Din adgang er ændret. Genindlæs siden.');
    return {sql:`EXISTS (SELECT 1 FROM workspace_members acl JOIN workspaces w ON w.id = acl.workspace_id
      JOIN workspace_roles effective_role ON effective_role.workspace_id = acl.workspace_id AND effective_role.id = acl.role_id
      WHERE acl.user_id = ? AND acl.workspace_id = ? AND acl.version = ? AND acl.status = 'active'
      AND acl.role_id = ? AND effective_role.version = ? AND w.snapshot_owner_id = ?
      ${permissions.map(()=>"AND EXISTS (SELECT 1 FROM json_each(effective_role.permissions) permission WHERE permission.value = ?)").join(' ')})`,
      values:[guard.userId,guard.workspaceId,guard.version,guard.roleId,guard.roleVersion,owner,...permissions]};
  }
  const roles=guard.roles || ['admin','planner'];
  if (!record(guard)||typeof guard.userId!=='string'||typeof guard.workspaceId!=='string'||!Number.isSafeInteger(guard.version)
    || !Array.isArray(roles)||!roles.length||roles.some(role=>!['admin','planner','employee'].includes(role))) throw new StudioError(403,'membership_changed','Din adgang er ændret. Genindlæs siden.');
  return {sql:`EXISTS (SELECT 1 FROM workspace_members acl JOIN workspaces w ON w.id = acl.workspace_id
    WHERE acl.user_id = ? AND acl.workspace_id = ? AND acl.version = ? AND acl.status = 'active'
      AND acl.role IN (${roles.map(()=>'?').join(',')}) AND w.snapshot_owner_id = ?)`,
    values:[guard.userId,guard.workspaceId,guard.version,...roles,owner]};
}

export async function writeStudio(db,owner,expectedRevision,studio,guard) {
  ownerId(owner); revision(expectedRevision); studio=validateStudio(studio,{readOnly:true});
  const identityAcl=studioGuard(owner,guard),acl={sql:identityAcl.sql,values:[...identityAcl.values]};
  // Conditions are server-built and fence dependent records in the same transaction.
  if(guard?.extraCondition){
    if(!record(guard.extraCondition)||typeof guard.extraCondition.sql!=='string'||!Array.isArray(guard.extraCondition.values))throw new StudioError(400,'invalid_commit_guard','Ændringens versionskontrol er ugyldig.');
    acl.sql+=' AND ('+guard.extraCondition.sql+')';acl.values.push(...guard.extraCondition.values);
  }
  if(guard?.workflowMembers!==undefined){
    if(!Array.isArray(guard.workflowMembers)||guard.workflowMembers.length>2||guard.workflowMembers.some(member=>!record(member)||(member.kind!==undefined&&member.kind!=='mobile')||typeof member.personId!=='string'||typeof member.userId!=='string'||typeof member.roleId!=='string'||!Number.isSafeInteger(member.version)||!Number.isSafeInteger(member.roleVersion)))throw new StudioError(400,'invalid_workflow_guard','Vagtanmodningens konti er ugyldige.');
    for(const member of guard.workflowMembers){
      if(member.kind==='mobile'){
        acl.sql+=` AND EXISTS (SELECT 1 FROM workspace_mobile_credentials participant
          JOIN workspace_directory_records employee ON employee.workspace_id=participant.workspace_id
            AND employee.kind='employee' AND employee.id=participant.person_id AND employee.deleted=0 AND employee.active=1
          WHERE participant.workspace_id=? AND participant.person_id=? AND participant.version=? AND participant.revoked_at IS NULL)`;
        acl.values.push(guard.workspaceId,member.personId,member.version);
        continue;
      }
      acl.sql+=` AND EXISTS (SELECT 1 FROM workspace_members participant JOIN workspace_roles participant_role
        ON participant_role.workspace_id = participant.workspace_id AND participant_role.id = participant.role_id
        WHERE participant.workspace_id = ? AND participant.user_id = ? AND participant.person_id = ? AND participant.version = ?
        AND participant.status = 'active' AND participant.role_id = ? AND participant_role.version = ?
        AND NOT EXISTS (SELECT 1 FROM json_each(participant_role.permissions) permission WHERE permission.value = 'plan'))`;
      acl.values.push(guard.workspaceId,member.userId,member.personId,member.version,member.roleId,member.roleVersion);
    }
  }
  if(guard?.workflowLedgerVersion!==undefined){
    if(!Number.isSafeInteger(guard.workflowLedgerVersion)||guard.workflowLedgerVersion<0)throw new StudioError(400,'invalid_workflow_guard','Tidsregistreringernes version er ugyldig.');
    acl.sql+=guard.workflowLedgerVersion===0?' AND NOT EXISTS (SELECT 1 FROM workspace_timekeeping WHERE workspace_id = ?)':' AND EXISTS (SELECT 1 FROM workspace_timekeeping WHERE workspace_id = ? AND version = ?)';
    acl.values.push(guard.workspaceId,...(guard.workflowLedgerVersion===0?[]:[guard.workflowLedgerVersion]));
  }
  if(guard?.rosterIds!==undefined){
    if(!Array.isArray(guard.rosterIds)||guard.rosterIds.some(id=>typeof id!=='string'))throw new StudioError(400,'invalid_roster','Medarbejderlisten er ugyldig.');
    acl.sql+=` AND NOT EXISTS (SELECT 1 FROM workspace_members linked WHERE linked.workspace_id = ? AND linked.person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM json_each(?) allowed_person WHERE allowed_person.value = linked.person_id))`;
    acl.values.push(guard.workspaceId,JSON.stringify(guard.rosterIds));
    acl.sql+=` AND NOT EXISTS (SELECT 1 FROM workspace_payroll payroll_linked WHERE payroll_linked.workspace_id = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) allowed_person WHERE allowed_person.value = payroll_linked.person_id))`;
    acl.values.push(guard.workspaceId,JSON.stringify(guard.rosterIds));
    acl.sql+=` AND NOT EXISTS (SELECT 1 FROM workspace_absences absence_linked WHERE absence_linked.workspace_id=? AND COALESCE(json_extract(absence_linked.config,'$.legacy'),0)=0 AND NOT EXISTS (SELECT 1 FROM json_each(?) allowed_person WHERE allowed_person.value=absence_linked.person_id)) AND NOT EXISTS (SELECT 1 FROM workspace_time_entries time_linked WHERE time_linked.workspace_id=? AND NOT EXISTS (SELECT 1 FROM json_each(?) allowed_person WHERE allowed_person.value=time_linked.person_id))`;
    acl.values.push(guard.workspaceId,JSON.stringify(guard.rosterIds),guard.workspaceId,JSON.stringify(guard.rosterIds));
    acl.sql+=` AND NOT EXISTS (SELECT 1 FROM workspace_payroll_policies policy,json_each(policy.config,'$.links') linked
      WHERE policy.workspace_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(?) allowed_person WHERE allowed_person.value = json_extract(linked.value,'$.personId')))`;
    acl.values.push(guard.workspaceId,JSON.stringify(guard.rosterIds));
  }
  async function assertGuard() {
    if (!guard) return;
    const check=await db.batch([prepared(db,`SELECT 1 AS allowed WHERE ${identityAcl.sql}`,...identityAcl.values)]);
    if (!check[0]?.results?.length) throw new StudioError(403,'membership_changed','Din adgang er ændret. Genindlæs siden.');
  }
  await assertGuard();
  // Compare against the revision being replaced; CAS below still protects a
  // concurrent append between this read and the atomic write.
  const commandContext=guard?.commandContext;
  if(commandContext&&(!record(commandContext.saved)||typeof commandContext.prepare!=='function'||commandContext.saved.source?.workspaceId!==guard.workspaceId))throw new StudioError(400,'invalid_command_context','Ændringens lagringsgrundlag er ugyldigt.');
  const previous = commandContext?commandContext.saved:await readStudio(db,owner);
  if (previous.revision !== expectedRevision) return {ok:false,...previous};
  validateStudio(studio,{previous:previous.studio});
  const directoryWorkspace=previous.source?.workspaceId,directoryHeader=directoryWorkspace?await readDirectoryHeader({db,workspaceId:directoryWorkspace}):null;
  if(directoryHeader){const directoryGuard=directoryVersionGuard({workspaceId:directoryWorkspace,version:previous.directory?.revision??directoryHeader.version});acl.sql+=' AND ('+directoryGuard.sql+')';acl.values.push(...directoryGuard.values);}
  // A refreshed older client can still have the current revision while its
  // editor drops fields it does not understand. Require an explicit empty
  // dayTimes map (or explicit groupId) rather than silently changing the plan.
  const nextSeries=new Map(studio.series.map(series=>[series.id,series]));
  for(const series of previous.studio?.series||[]){
    const replacement=nextSeries.get(series.id);if(!replacement)continue;
    if(['dayTimes','groupId'].some(key=>Object.hasOwn(series,key)&&!Object.hasOwn(replacement,key)))bad('Vagtseriens ugedagstider eller aftale-id mangler. Hent den seneste version, før du gemmer.');
    if(Object.hasOwn(series,'plannedBreakMinutes')&&!Object.hasOwn(replacement,'plannedBreakMinutes'))bad('Vagtseriens planlagte pause mangler. Hent den seneste version, før du gemmer.');
    if(Object.hasOwn(series,'openEnded')&&!Object.hasOwn(replacement,'openEnded'))bad('Vagtseriens valg af slutdato mangler. Hent den seneste version, før du gemmer.');
    for(const [day,times]of Object.entries(series.dayTimes||{}))if(Series.plannedBreakMinutes(times)>0&&replacement.dayTimes?.[day]?.plannedBreakMinutes===undefined&&!Object.hasOwn(replacement,'plannedBreakMinutes'))bad('Ugedagens planlagte pause mangler. Hent den seneste version, før du gemmer.');
  }
  for(const [id,shift]of Object.entries(previous.studio?.edits||{}))if(Series.plannedBreakMinutes(shift)>0&&studio.edits[id]&&!Object.hasOwn(studio.edits[id],'plannedBreakMinutes'))bad('Vagtens planlagte pause mangler. Hent den seneste version, før du gemmer.');
  const hadOrganization = previous.studio && Object.hasOwn(previous.studio,'organization');
  if (hadOrganization && !Object.hasOwn(studio,'organization')) bad('Planens afdelinger mangler. Hent den seneste version, før du gemmer.');
  if (Object.hasOwn(studio,'organization')) {
    const oldSites = (hadOrganization ? previous.studio.organization : Departments.defaultOrganization()).sites;
    if (studio.organization.sites.length < oldSites.length || oldSites.some((site,index) => studio.organization.sites[index]?.id !== site.id)) {
      bad('Eksisterende arbejdssteder må ikke fjernes eller skifte rækkefølge. Nye arbejdssteder skal tilføjes sidst.');
    }
  }
  const next = expectedRevision + 1, token = crypto.randomUUID(), now = new Date().toISOString();
  const condition = 'EXISTS (SELECT 1 FROM studio_states WHERE owner_id = ? AND revision = ? AND write_token = ?)';
  let planning=null,directoryWrite=null,snapshot=studio;
  if(previous.source?.workspaceId){
    let calendarAnchor;try{calendarAnchor=JSON.parse(guard?.preferences||'{}').calendarAnchor;}catch{}
    try{planning=await (commandContext?commandContext.prepare:preparePlanningWrite)({db,workspaceId:previous.source.workspaceId,before:previous.studio,after:studio,versions:previous.planning?.versions||{},condition:{sql:condition,values:[owner,next,token]},token,at:now,calendarAnchor});}
    catch(error){if(error instanceof PlanningStoreError)throw new StudioError(error.status,error.code,error.message);throw error;}
    acl.sql+=' AND ('+planning.guard.sql+')';acl.values.push(...planning.guard.values);snapshot=planning.studio;
  }
  if(directoryHeader){
    if(!commandContext){
      directoryWrite=await prepareDirectorySnapshotWrite({db,workspaceId:directoryWorkspace,before:previous.studio,after:studio,condition:{sql:condition,values:[owner,next,token]},token,at:now});
      if(guard&&directoryWrite.statements.length&&guard.directoryRevision!==previous.directory?.revision)throw new StudioError(409,'directory_reload_required','Medarbejdere eller afdelinger kræver deres gennemgåede version. Indlæs oplysningerne igen, før du gemmer.');
      acl.sql+=' AND ('+directoryWrite.guard.sql+')';acl.values.push(...directoryWrite.guard.values);
      const removed=directoryWrite.records.filter(row=>row.kind==='employee'&&row.value===null).map(row=>row.id);if(removed.length){const referenceGuard=employeeRemovalGuard({workspaceId:directoryWorkspace,personIds:removed});acl.sql+=' AND ('+referenceGuard.sql+')';acl.values.push(...referenceGuard.values);}
    }
    snapshot=trimDirectorySnapshot(snapshot);
  }
  const {chunks,byteLength} = splitSnapshot(JSON.stringify(snapshot));
  const statements = [
    prepared(db,`INSERT INTO studio_states (owner_id, revision, write_token, chunk_count, byte_length, updated_at,demo_seed,demo_seed_revision)
      SELECT ?, 0, '', 0, 0, ?,?,0 WHERE ? = 0 AND ${acl.sql} ON CONFLICT(owner_id) DO NOTHING`,owner,now,Number(studio.demoSeed!==false),expectedRevision,...acl.values),
    prepared(db,`UPDATE studio_states SET revision = ?, write_token = ?, chunk_count = ?, byte_length = ?, updated_at = ?,demo_seed=?,demo_seed_revision=?
      WHERE owner_id = ? AND revision = ? AND ${acl.sql}`,next,token,chunks.length,byteLength,now,Number(studio.demoSeed!==false),next,owner,expectedRevision,...acl.values),
    ...chunks.map((content,index) => prepared(db,`INSERT INTO studio_state_chunks (owner_id, revision, chunk_index, content)
      SELECT ?, ?, ?, ? WHERE ${condition}`,owner,next,index,content,owner,next,token)),
    prepared(db,`DELETE FROM studio_state_chunks WHERE owner_id = ? AND revision <> ? AND ${condition}`,owner,next,owner,next,token),
    ...(planning?.statements||[]),...(directoryWrite?.statements||[])
  ];
  if(guard?.preferences!==undefined) {
    if(typeof guard.preferences!=='string')throw new StudioError(400,'invalid_preferences','Indstillingerne er ugyldige.');
    statements.push(prepared(db,`UPDATE workspace_members SET preferences = ?,updated_at = ?
      WHERE user_id = ? AND workspace_id = ? AND version = ? AND status = 'active' AND ${condition} AND ${identityAcl.sql}`,
      guard.preferences,now,guard.userId,guard.workspaceId,guard.version,owner,next,token,...identityAcl.values));
  }
  if(guard?.auditStatements)statements.push(...guard.auditStatements({sql:condition,values:[owner,next,token]}));
  const result = await db.batch(statements);
  if (result[1]?.meta?.changes !== 1) { await assertGuard();return {ok:false,...await (commandContext?readRawStudio:readStudio)(db,owner)}; }
  const committed={ok:true,revision:next};if(directoryHeader)Object.defineProperty(committed,'directory',{value:directoryWrite?.directory||{schema:1,revision:directoryHeader.version,nextSiteIndex:directoryHeader.next_site_index},enumerable:false});if(planning){Object.defineProperty(committed,'planning',{value:planning.planning,enumerable:false,configurable:true});if(commandContext)Object.defineProperty(committed,'reconciledRecords',{value:planning.reconciledRecords||[],enumerable:false});}return committed;
}

async function requestJSON(request) {
  const length = request.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) throw new StudioError(413,'snapshot_too_large','Planen fylder mere end 16 MiB. Ingen data er overskrevet.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new StudioError(415,'json_required','Send planen som JSON.');
  if (!request.body) bad('Planen mangler.');
  const reader = request.body.getReader(), parts = [];
  let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new StudioError(413,'snapshot_too_large','Planen fylder mere end 16 MiB. Ingen data er overskrevet.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0; for (const part of parts) { bytes.set(part,offset); offset += part.byteLength; }
  try { return JSON.parse(decoder.decode(bytes)); }
  catch { bad('Planen er ikke gyldig JSON.'); }
}

function response(body,status = 200) {
  return Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Vary':'oai-authenticated-user-id','X-Content-Type-Options':'nosniff'}});
}

export async function handleStudioRequest(request,database) {
  try {
    const owner = ownerId(request.headers.get('oai-authenticated-user-id'));
    if (!['GET','PUT'].includes(request.method)) return response({error:'method_not_allowed'},405);
    if (request.method === 'PUT') {
      const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
      if (origin !== new URL(request.url).origin || site && !['same-origin','none'].includes(site)) return response({error:'same_origin_required',message:'Gem planen fra denne side.'},403);
    }
    let payload;
    if (request.method === 'PUT') {
      payload = await requestJSON(request);
      if (!record(payload) || !Object.hasOwn(payload,'revision') || !Object.hasOwn(payload,'studio')) bad('Send revision og studio.');
      revision(payload.revision); validateStudio(payload.studio);
    }
    const db = typeof database === 'function' ? await database() : database;
    if (!db) throw new StudioError(503,'storage_unavailable','Lagringen er midlertidigt utilgængelig. Prøv igen.');
    if (request.method === 'GET') return response({...await readStudio(db,owner),capabilities:{manageDepartments:true}});
    const result = await writeStudio(db,owner,payload.revision,payload.studio);
    if (!result.ok) return response({error:'revision_conflict',revision:result.revision,studio:result.studio},409);
    return response({revision:result.revision});
  } catch (error) {
    if (error instanceof StudioError) return response({error:error.code,message:error.message},error.status);
    return response({error:'storage_failed',message:'Planen kunne ikke gemmes eller læses. Prøv igen; eksisterende data er bevaret.'},500);
  }
}
