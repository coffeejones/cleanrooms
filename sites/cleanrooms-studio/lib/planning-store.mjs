/* Independently versioned planning records; the studio revision fences every multi-record commit. */
import Planning from '../src/planning-records.js';
import Data from '../src/studio-data.js';
import Scope from '../src/planning-scope.js';
import {packCalendarSummary,calendarSummaryChunks} from './planning-calendar-summary.mjs';
import {publicationHydrate,publicationImportStatements,publicationWriteStatements} from './publication-store.mjs';

export const PLAN_CHUNK_BYTES=256*1024;
export const MAX_PLAN_RECORD_BYTES=16*1024*1024;
const PAGE_BYTES=1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(db,sql,...values)=>(await rows(db,sql,...values))[0]||null;
export class PlanningStoreError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const invalid=()=>{throw new PlanningStoreError(500,'invalid_planning_records','Planens poster kunne ikke læses sikkert. Eksisterende data er bevaret.');};
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function planWindowFields(item,version,calendarAnchor=Data.anchor){
  const value=item.value,anchor=validDay(item.id.slice(-10))?item.id.slice(-10):null;
  if(item.kind==='series')return {from:validDay(value?.startDate)?value.startDate:null,to:validDay(value?.endDate)?value.endDate:null,origin:null,parent:value===null?null:value?.id||item.id,group:value===null?null:value?.groupId||value?.id||item.id,week:null,schema:1,version};
  if(item.kind==='shift')return {from:validDay(value?.edit?.date)?value.edit.date:null,to:validDay(value?.edit?.date)?value.edit.date:null,origin:anchor,parent:value?.edit?.seriesId||(anchor&&item.id.lastIndexOf('@')>0?item.id.slice(0,item.id.lastIndexOf('@')):null),group:null,week:null,schema:1,version};
  const week=/^-?\d{1,10}$/.test(item.id)?Number(item.id):null,baseline=(value?.baseline||[]).map(shift=>shift?.date).filter(validDay).sort();let from=null;
  if(baseline.length){const date=new Date(baseline[0]+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));from=date.toISOString().slice(0,10);}
  else if(week!==null){const date=new Date((validDay(calendarAnchor)?calendarAnchor:Data.anchor)+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+week*7);if(Number.isFinite(date.getTime())&&date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999)from=date.toISOString().slice(0,10);}
  const end=from?new Date(from+'T12:00:00Z'):null;if(end)end.setUTCDate(end.getUTCDate()+6);
  return {from,to:end?.toISOString().slice(0,10)||null,origin:null,parent:null,group:null,week,schema:1,version};
}
function boundedDocuments(values){
  const documents=[];let items=[],bytes=2;
  for(const value of values){const serialized=JSON.stringify(value),size=encoder.encode(serialized).length;if(size+2>PLAN_CHUNK_BYTES)throw new PlanningStoreError(413,'planning_guard_too_large','En planpost har for mange versionsoplysninger. Ændr færre poster ad gangen.');if(items.length&&bytes+size+1>PLAN_CHUNK_BYTES){documents.push('['+items.join(',')+']');items=[];bytes=2;}items.push(serialized);bytes+=size+(items.length>1?1:0);}
  if(items.length||!documents.length)documents.push('['+items.join(',')+']');return documents;
}

function split(value){
  const bytes=encoder.encode(value),chunks=[];
  for(let start=0;start<bytes.length;){let end=Math.min(start+PLAN_CHUNK_BYTES,bytes.length);while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;chunks.push(decoder.decode(bytes.subarray(start,end)));start=end;}
  return chunks;
}

async function encoded(value){
  const serialized=JSON.stringify(value),bytes=encoder.encode(serialized).length;
  if(bytes>MAX_PLAN_RECORD_BYTES)throw new PlanningStoreError(413,'planning_record_too_large','En enkelt planpost fylder mere end 16 MiB. Eksisterende data er bevaret.');
  const sha256=await digest(serialized);
  if(bytes<=PLAN_CHUNK_BYTES)return {config:JSON.stringify({schema:1,bytes,sha256,value}),chunks:[]};
  const chunks=split(serialized);return {config:JSON.stringify({schema:1,bytes,sha256,chunkCount:chunks.length}),chunks};
}

async function decoded(db,workspaceId,row){
  let envelope;try{envelope=JSON.parse(row.config);}catch{invalid();}
  if(envelope.schema!==1||!Number.isSafeInteger(envelope.bytes)||envelope.bytes<1||envelope.bytes>MAX_PLAN_RECORD_BYTES||typeof envelope.sha256!=='string'||!/^[0-9a-f]{64}$/.test(envelope.sha256))invalid();
  let serialized;
  if(Object.hasOwn(envelope,'value'))serialized=JSON.stringify(envelope.value);
  else{
    if(!Number.isSafeInteger(envelope.chunkCount)||envelope.chunkCount<1||envelope.chunkCount>Math.ceil(MAX_PLAN_RECORD_BYTES/PLAN_CHUNK_BYTES)+1)invalid();
    const parts=[];
    for(let offset=0;offset<envelope.chunkCount;offset+=4){
      const found=await rows(db,`SELECT chunk_index,content FROM workspace_plan_record_chunks WHERE workspace_id = ? AND kind = ? AND id = ? AND version = ? AND chunk_index >= ? AND chunk_index < ? ORDER BY chunk_index`,workspaceId,row.kind,row.id,row.version,offset,Math.min(offset+4,envelope.chunkCount));
      if(found.length!==Math.min(4,envelope.chunkCount-offset)||found.some((part,index)=>part.chunk_index!==offset+index||typeof part.content!=='string'||encoder.encode(part.content).length>PLAN_CHUNK_BYTES))invalid();
      parts.push(...found.map(part=>part.content));
    }
    serialized=parts.join('');
  }
  if(encoder.encode(serialized).length!==envelope.bytes||await digest(serialized)!==envelope.sha256)invalid();
  try{return JSON.parse(serialized);}catch{invalid();}
}

export const trimPlanningSnapshot=studio=>({...studio,series:[],edits:{},deleted:[],weekPlans:{},...(Object.hasOwn(studio,'publications')?{publications:{version:1,sequence:0,slots:{},records:[]}}:{})});

export async function readPlanningVersions(db,workspaceId){
  const versions={};
  for(const row of await rows(db,'SELECT kind,id,version FROM workspace_plan_records WHERE workspace_id = ? ORDER BY kind,id',workspaceId)){
    if(!['series','shift','week'].includes(row.kind)||typeof row.id!=='string'||!Number.isSafeInteger(row.version)||row.version<1)invalid();versions[Planning.key(row.kind,row.id)]=row.version;
  }
  return versions;
}

export async function planningState({db,workspaceId,studio}){
  const versions={},records=[];let after=null;
  while(true){
    const metadata=await rows(db,`SELECT kind,id,version,deleted,sort_order,length(CAST(config AS BLOB)) AS bytes FROM workspace_plan_records WHERE workspace_id = ? ${after?'AND (kind > ? OR (kind = ? AND id > ?))':''} ORDER BY kind,id LIMIT 501`,workspaceId,...(after?[after.kind,after.kind,after.id]:[]));
    if(!metadata.length)break;
    let bytes=0;const chosen=[];
    for(const row of metadata){if(chosen.length===500||bytes+row.bytes>PAGE_BYTES)break;if(!['series','shift','week'].includes(row.kind)||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.version)||row.version<1||![0,1].includes(row.deleted)||!Number.isSafeInteger(row.sort_order)||row.bytes>512*1024)invalid();chosen.push(row);bytes+=row.bytes;}
    if(!chosen.length)invalid();
    const found=await rows(db,`SELECT entry.kind,entry.id,entry.version,entry.deleted,entry.sort_order,entry.config FROM json_each(?) wanted JOIN workspace_plan_records entry ON entry.workspace_id = ? AND entry.kind = json_extract(wanted.value,'$.kind') AND entry.id = json_extract(wanted.value,'$.id') ORDER BY entry.kind,entry.id`,JSON.stringify(chosen.map(({kind,id})=>({kind,id}))),workspaceId);
    if(found.length!==chosen.length)throw new PlanningStoreError(409,'planning_read_conflict','Planen ændrede sig under indlæsning. Hent den igen.');
    for(const row of found){versions[Planning.key(row.kind,row.id)]=row.version;if(!row.deleted)records.push({kind:row.kind,id:row.id,value:await decoded(db,workspaceId,row),sortOrder:row.sort_order});}
    after=chosen.at(-1);if(chosen.length===metadata.length)break;
  }
  const projection=Planning.apply({...studio,series:[],edits:{},deleted:[],weekPlans:{}},records.sort((one,two)=>one.kind.localeCompare(two.kind)||one.sortOrder-two.sortOrder||one.id.localeCompare(two.id)));
  const hydrated=await publicationHydrate({db,workspaceId,studio:projection});
  const state={schema:1,versions,metadataHash:await digest(Planning.canonical(Planning.metadata(hydrated))),records};
  return {studio:hydrated,planning:state};
}

function sourceCondition(owner,source){return source.exists||source.revision?{sql:'EXISTS (SELECT 1 FROM studio_states source WHERE source.owner_id = ? AND source.revision = ? AND source.write_token = ?)',values:[owner,source.revision,source.token]}:{sql:'NOT EXISTS (SELECT 1 FROM studio_states source WHERE source.owner_id = ?)',values:[owner]};}

async function recordStatements({db,workspaceId,item,version,condition,token,at,payload,expectedVersion,calendarAnchor}){
  const window=planWindowFields(item,version,calendarAnchor),schedule=await packCalendarSummary(item.kind,item.id,item.value),identity=item.kind==='shift'?item.value?.edit:item.value,args=[workspaceId,item.kind,item.id,version,item.value===null?1:0,payload.config,token,item.sortOrder??0,at,window.from,window.to,window.origin,window.parent,window.group,window.week,1,version,identity?.person??null,identity?.site??null,schedule.config,version];
  const insert=statement(db,`INSERT INTO workspace_plan_records (workspace_id,kind,id,version,deleted,config,write_token,sort_order,updated_at,window_from,window_to,origin_date,parent_id,group_id,week_index,window_schema,window_version,person_id,site_index,schedule_config,schedule_version) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id,kind,id) DO UPDATE SET version = excluded.version,deleted = excluded.deleted,config = excluded.config,write_token = excluded.write_token,sort_order = excluded.sort_order,updated_at = excluded.updated_at,
    window_from = COALESCE(excluded.window_from,workspace_plan_records.window_from),window_to = COALESCE(excluded.window_to,workspace_plan_records.window_to),origin_date = COALESCE(excluded.origin_date,workspace_plan_records.origin_date),parent_id = COALESCE(excluded.parent_id,workspace_plan_records.parent_id),group_id = COALESCE(excluded.group_id,workspace_plan_records.group_id),week_index = COALESCE(excluded.week_index,workspace_plan_records.week_index),window_schema = 1,window_version = excluded.version,person_id=COALESCE(excluded.person_id,workspace_plan_records.person_id),site_index=COALESCE(excluded.site_index,workspace_plan_records.site_index),schedule_config=excluded.schedule_config,schedule_version=excluded.version WHERE workspace_plan_records.version = ?`,...args,...condition.values,expectedVersion);
  return [insert,...calendarSummaryChunks({db,workspaceId,kind:item.kind,id:item.id,version,payload:schedule,condition,token}),...payload.chunks.map((content,index)=>statement(db,`INSERT INTO workspace_plan_record_chunks (workspace_id,kind,id,version,chunk_index,content) SELECT ?,?,?,?,?,? WHERE ${condition.sql} AND EXISTS (SELECT 1 FROM workspace_plan_records written WHERE written.workspace_id = ? AND written.kind = ? AND written.id = ? AND written.version = ? AND written.write_token = ?)`,workspaceId,item.kind,item.id,version,index,content,...condition.values,workspaceId,item.kind,item.id,version,token)),statement(db,`DELETE FROM workspace_plan_record_chunks WHERE workspace_id = ? AND kind = ? AND id = ? AND version <> ? AND ${condition.sql}`,workspaceId,item.kind,item.id,version,...condition.values)];
}

export {decoded as decodePlanningRecord};

/* Explicit keys are the authority boundary for command writes. Missing keys keep
 * version zero; physical tombstones retain their versions without payload reads. */
export async function readPlanningRecords({db,workspaceId,identities}){
  const keys=[...new Map(identities.map(item=>[Planning.key(item.kind,item.id),{kind:item.kind,id:item.id}])).values()],headers=[];
  for(const document of boundedDocuments(keys))headers.push(...await rows(db,`SELECT record.kind,record.id,record.version,record.deleted,record.sort_order,record.parent_id,record.group_id,record.origin_date,record.window_from,record.window_to,length(CAST(record.config AS BLOB)) stored_bytes,json_extract(record.config,'$.bytes') payload_bytes FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id')`,document,workspaceId));
  const records=[],versions={};let offset=0;
  while(offset<headers.length){const batch=[];let bytes=0;while(offset<headers.length&&batch.length<500){const header=headers[offset],size=header.stored_bytes;if(!Number.isSafeInteger(header.version)||header.version<1||![0,1].includes(header.deleted)||!Number.isSafeInteger(size)||size>512*1024)invalid();if(batch.length&&bytes+size>PAGE_BYTES)break;batch.push(header);bytes+=size;offset++;}
    const found=[];for(const document of boundedDocuments(batch.map(({kind,id,version})=>({kind,id,version}))))found.push(...await rows(db,`SELECT record.kind,record.id,record.version,record.deleted,record.sort_order,record.config FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id') AND record.version=json_extract(chosen.value,'$.version')`,document,workspaceId));
    if(found.length!==batch.length)throw new PlanningStoreError(409,'planning_read_conflict','Planen ændrede sig under indlæsning.');
    const byKey=new Map(found.map(row=>[Planning.key(row.kind,row.id),row]));for(const header of batch){const row=byKey.get(Planning.key(header.kind,header.id));versions[Planning.key(row.kind,row.id)]=row.version;records.push({kind:row.kind,id:row.id,value:row.deleted?null:await decoded(db,workspaceId,row),sortOrder:row.sort_order,version:row.version});}
  }
  return {records,versions,headers};
}

export async function ensurePlanningImported({db,workspaceId,owner,source,studio,guard={sql:'1 = 1',values:[]}}){
  const imported=await first(db,'SELECT * FROM workspace_plan_imports WHERE workspace_id = ?',workspaceId);if(imported)return imported;
  if(await first(db,'SELECT id FROM workspace_plan_records WHERE workspace_id = ? LIMIT 1',workspaceId)){const completed=await first(db,'SELECT * FROM workspace_plan_imports WHERE workspace_id = ?',workspaceId);if(completed)return completed;throw new PlanningStoreError(500,'planning_import_incomplete','Planens import mangler en fuldstændig kvittering. Eksisterende data er bevaret.');}
  const token=crypto.randomUUID(),at=new Date().toISOString(),fence=sourceCondition(owner,source),condition={sql:`(${fence.sql}) AND (${guard.sql}) AND NOT EXISTS (SELECT 1 FROM workspace_plan_imports imported WHERE imported.workspace_id = ?)`,values:[...fence.values,...guard.values,workspaceId]};
  const statements=[];
  for(const item of Planning.flatten(studio||{})){const payload=await encoded(item.value);statements.push(...await recordStatements({db,workspaceId,item,version:1,expectedVersion:0,condition,token,at,payload,calendarAnchor:studio?.calendarAnchor}));}
  try{statements.push(...await publicationImportStatements({db,workspaceId,studio:studio||{},condition,token,at}));}
  catch(error){const completed=await first(db,'SELECT * FROM workspace_plan_imports WHERE workspace_id = ?',workspaceId);if(completed)return completed;throw error;}
  statements.push(statement(db,`INSERT INTO workspace_plan_imports (workspace_id,source_revision,source_token,completed_at) SELECT ?,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id) DO NOTHING`,workspaceId,source.revision,source.token,at,...condition.values));
  await db.batch(statements);
  return first(db,'SELECT * FROM workspace_plan_imports WHERE workspace_id = ?',workspaceId);
}

export async function preparePlanningWrite({db,workspaceId,before,after,versions,condition,token,at,calendarAnchor}){
  const changed=Planning.diff(before||{},after),expected=changed.map(item=>({kind:item.kind,id:item.id,version:versions[Planning.key(item.kind,item.id)]||0}));
  const documents=boundedDocuments(expected),union=documents.map(()=> 'SELECT value FROM json_each(?)').join(' UNION ALL ');
  const guard={sql:`NOT EXISTS (SELECT 1 FROM (${union}) expected WHERE COALESCE((SELECT current.version FROM workspace_plan_records current WHERE current.workspace_id = ? AND current.kind = json_extract(expected.value,'$.kind') AND current.id = json_extract(expected.value,'$.id')),0) <> json_extract(expected.value,'$.version'))`,values:[...documents,workspaceId]};
  const statements=[];
  for(const item of changed){const oldVersion=versions[Planning.key(item.kind,item.id)]||0;if(oldVersion>=Number.MAX_SAFE_INTEGER)throw new PlanningStoreError(409,'planning_version_exhausted','Planpostens version kan ikke øges sikkert. Kontakt administratoren.');const payload=await encoded(item.value);statements.push(...await recordStatements({db,workspaceId,item,version:oldVersion+1,expectedVersion:oldVersion,condition,token,at,payload,calendarAnchor:calendarAnchor||after.calendarAnchor}));}
  const publications=await publicationWriteStatements({db,workspaceId,before:before||{},after,condition,token,at});
  if(publications.guard){guard.sql+=` AND (${publications.guard.sql})`;guard.values.push(...publications.guard.values);}
  statements.push(...publications);
  const committedVersions={...versions};for(const item of changed)committedVersions[Planning.key(item.kind,item.id)]=(versions[Planning.key(item.kind,item.id)]||0)+1;
  const planning={schema:1,versions:committedVersions,metadataHash:await digest(Planning.canonical(Planning.metadata(after)))};
  return {guard,statements,studio:trimPlanningSnapshot(after),changed,planning};
}

/* Sparse commits never infer deletion from an omitted row and never scan the
 * publication store. The caller adds any related publication transaction. */
export async function preparePlanningCommandWrite({db,workspaceId,before,after,versions,changes,condition,token,at,calendarAnchor}){
  const allowed=new Set(changes.map(item=>Planning.key(item.kind,item.id))),changed=Planning.diff(before||{},after);if(changed.some(item=>!allowed.has(Planning.key(item.kind,item.id))))throw new PlanningStoreError(400,'planning_command_scope_invalid','Ændringen berører poster uden for de sendte kommandoer.');const expected=changed.map(item=>({kind:item.kind,id:item.id,version:versions[Planning.key(item.kind,item.id)]||0})),documents=boundedDocuments(expected),union=documents.map(()=> 'SELECT value FROM json_each(?)').join(' UNION ALL '),guard={sql:`NOT EXISTS (SELECT 1 FROM (${union}) expected WHERE COALESCE((SELECT current.version FROM workspace_plan_records current WHERE current.workspace_id=? AND current.kind=json_extract(expected.value,'$.kind') AND current.id=json_extract(expected.value,'$.id')),0)<>json_extract(expected.value,'$.version'))`,values:[...documents,workspaceId]},statements=[],committedVersions={},reconciledRecords=[];
  const afterRows=new Map(Planning.flatten(after).map(item=>[Planning.key(item.kind,item.id),item])),beforeRows=new Map(Planning.flatten(before).map(item=>[Planning.key(item.kind,item.id),item])),appendKinds=[...new Set(changed.filter(item=>item.value!==null&&!beforeRows.has(Planning.key(item.kind,item.id))).map(item=>item.kind))],orders=new Map(),storedOrders=new Map();
  for(const document of boundedDocuments(changes.map(({kind,id})=>({kind,id}))))for(const row of await rows(db,`SELECT record.kind,record.id,record.version,record.sort_order FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id')`,document,workspaceId)){if(row.version!==(versions[Planning.key(row.kind,row.id)]||0))throw new PlanningStoreError(409,'planning_command_conflict','Planposten ændrede sig under valideringen.');storedOrders.set(Planning.key(row.kind,row.id),row.sort_order);}
  for(const kind of appendKinds){const maximum=await first(db,'SELECT sort_order FROM workspace_plan_records WHERE workspace_id=? AND kind=? AND deleted=0 ORDER BY sort_order DESC,id DESC LIMIT 1',workspaceId,kind);orders.set(kind,maximum?.sort_order??-1);}
  for(const item of changed){const id=Planning.key(item.kind,item.id),oldVersion=versions[id]||0;if(oldVersion>=Number.MAX_SAFE_INTEGER)throw new PlanningStoreError(409,'planning_version_exhausted','Planpostens version kan ikke øges sikkert.');if(item.value!==null&&!beforeRows.has(id)){item.sortOrder=orders.get(item.kind)+1;orders.set(item.kind,item.sortOrder);}else if(storedOrders.has(id))item.sortOrder=storedOrders.get(id);const version=oldVersion+1,payload=await encoded(item.value);statements.push(...await recordStatements({db,workspaceId,item,version,expectedVersion:oldVersion,condition,token,at,payload,calendarAnchor:calendarAnchor||after.calendarAnchor}));committedVersions[id]=version;reconciledRecords.push({kind:item.kind,id:item.id,value:item.value,sortOrder:item.sortOrder,version});}
  // An identical explicit command still needs a causal receipt without advancing
  // its row version. Only requested records receive tokens in the patch.
  for(const requested of changes){const key=Planning.key(requested.kind,requested.id);if(Object.hasOwn(committedVersions,key))continue;const version=versions[key]||0;if(!version)continue;const row=afterRows.get(key);committedVersions[key]=version;reconciledRecords.push({kind:requested.kind,id:requested.id,value:row?.value??null,sortOrder:storedOrders.get(key)??row?.sortOrder??0,version});}
  return {guard,statements,studio:trimPlanningSnapshot(after),changed,planning:{schema:1,versions:committedVersions,metadataHash:await digest(Planning.canonical(Planning.metadata(after)))},reconciledRecords};
}
