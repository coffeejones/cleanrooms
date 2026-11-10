/* Read exactly the command targets and the complete families required by their
 * original dependency tokens. Client-supplied scopes never select authority. */
import Planning from '../src/planning-records.js';
import {isScoped} from './department-access.mjs';
import {assertPlanningCommandAccess,assertPlanningHeadersAccess} from './department-planning-access.mjs';
import {PlanningStoreError,readPlanningRecords,ensurePlanningImported} from './planning-store.mjs';
import {ensurePlanWindowIndex} from './planning-window-store.mjs';
import {ensurePlanningSchedules} from './planning-selection-store.mjs';
const encoder=new TextEncoder();
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(...args)=>(await rows(...args))[0]||null;
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const fail=(status,code,message)=>{throw new PlanningStoreError(status,code,message);};
const chunks=(values,size=250)=>{const result=[];for(let offset=0;offset<values.length;offset+=size)result.push(values.slice(offset,offset+size));return result;};
const key=row=>Planning.key(row.kind,row.id);

export async function initializePlanningCommandStorage({db,workspaceId,owner,raw,splitSnapshot}){
  if(!await ensurePlanningImported({db,workspaceId,owner,source:raw.source,studio:raw.studio}))return false;
  if(!await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot}))return false;
  await ensurePlanningSchedules({db,workspaceId});return true;
}

async function groupHeaders(db,workspaceId,groups){
  const result=new Map();for(const groupBatch of chunks(groups)){let after='';while(true){const found=await rows(db,`SELECT record.kind,record.id FROM json_each(?) chosen CROSS JOIN workspace_plan_records record INDEXED BY workspace_plan_group WHERE record.workspace_id=? AND record.kind='series' AND record.group_id=chosen.value AND record.id>? ORDER BY record.id LIMIT 500`,JSON.stringify(groupBatch),workspaceId,after);for(const row of found)result.set(key(row),row);if(found.length<500)break;after=found.at(-1).id;}}
  return [...result.values()];
}

async function exceptionHeaders(db,workspaceId,seriesIds){
  const result=new Map();for(const ids of chunks(seriesIds)){let after='';while(true){const found=await rows(db,`WITH parents AS (SELECT value id FROM json_each(?)), selected(kind,id) AS (
    SELECT record.kind,record.id FROM parents parent CROSS JOIN workspace_plan_records record INDEXED BY workspace_plan_parent WHERE record.workspace_id=? AND record.kind='shift' AND record.parent_id=parent.id
    UNION SELECT record.kind,record.id FROM parents parent CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind='shift' AND record.id>=parent.id||'@' AND record.id<parent.id||'A'
  ) SELECT kind,id FROM selected WHERE id>? ORDER BY id LIMIT 500`,JSON.stringify(ids),workspaceId,workspaceId,after);for(const row of found)result.set(key(row),row);if(found.length<500)break;after=found.at(-1).id;}}
  return [...result.values()];
}


async function authorizeIdentities(db,workspaceId,context,identities){
  if(!isScoped(context)||!identities.length)return;const headers=[];
  for(const batch of chunks(identities))headers.push(...await rows(db,`SELECT record.kind,record.id,record.site_index,record.person_id,record.parent_id,record.origin_date FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id')`,JSON.stringify(batch),workspaceId));
  await assertPlanningHeadersAccess({db,context,headers});
}
export async function readPlanningCommandContext({db,workspaceId,owner,raw,payload,context}){
  if(raw?.source?.workspaceId!==workspaceId)fail(403,'planning_workspace_mismatch','Planen tilhører ikke dette arbejdsområde.');
  const errors=Planning.validatePlanning(payload?.planning);if(errors.length)fail(400,'invalid_planning_command',errors[0]);
  const targets=payload.planning.changes.map(({kind,id})=>({kind,id}));await authorizeIdentities(db,workspaceId,context,targets);const changed=await readPlanningRecords({db,workspaceId,identities:targets}),parentIds=new Set(),groups=new Set(payload.planning.dependencies.groups.map(item=>item.id));let parentBytes=0;
  const addParent=id=>{if(parentIds.has(id))return;parentBytes+=encoder.encode(id).length;if(parentBytes>16*1024*1024)fail(413,'planning_command_scope_too_large','Ændringen indeholder for mange serieafhængigheder. Gem færre vagter ad gangen.');parentIds.add(id);};
  for(const item of payload.planning.dependencies.series)addParent(item.id);
  for(const row of changed.headers){if(row.kind==='series')groups.add(row.group_id||row.id);if(row.kind==='shift'&&row.parent_id)addParent(row.parent_id);}
  for(const change of payload.planning.changes){if(change.kind==='series'&&change.value)groups.add(change.value.groupId||change.id);if(change.kind==='shift'){
    if(change.value?.edit?.seriesId)addParent(change.value.edit.seriesId);
    // Match the shared dependency model's prefix semantics without a SQL LIKE
    // wildcard or a tenant-wide series scan, even when IDs themselves contain @.
    for(let index=change.id.indexOf('@');index>=0;index=change.id.indexOf('@',index+1))if(index>0)addParent(change.id.slice(0,index));
  }}
  const familySeries=await groupHeaders(db,workspaceId,[...groups]),familyExceptions=await exceptionHeaders(db,workspaceId,familySeries.map(item=>item.id)),identities=[...familySeries,...familyExceptions,...[...parentIds].map(id=>({kind:'series',id}))],known=new Set(changed.records.map(key)),related=await (async()=>{const selected=identities.filter(row=>!known.has(key(row)));await authorizeIdentities(db,workspaceId,context,selected);return readPlanningRecords({db,workspaceId,identities:selected});})(),records=[...changed.records,...related.records],versions={...related.versions,...changed.versions};
  const current=await first(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',owner);if(!current||current.revision!==raw.revision||current.write_token!==raw.source.token)fail(409,'planning_command_conflict','Planen ændrede sig under valideringen. Hent den seneste version.');
  const studio=Planning.apply({...raw.studio,series:[],edits:{},deleted:[],weekPlans:{}},records),saved={revision:raw.revision,studio,commandScope:{targets,groups:[...groups],parents:[...parentIds],records:records.map(({kind,id})=>({kind,id}))}};
  await assertPlanningCommandAccess({db,context,before:studio,changes:payload.planning.changes,publication:payload.publication});
  Object.defineProperty(saved,'planning',{value:{schema:1,versions,metadataHash:await hash(Planning.canonical(Planning.metadata(raw.studio||{})))},enumerable:false,configurable:true});Object.defineProperty(saved,'source',{value:raw.source,enumerable:false});return saved;
}
