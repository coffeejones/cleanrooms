/* Durable attendance rows. The small legacy ledger is now only a revision/demo header. */
import {personPredicate,jsonSitePredicate} from './department-access.mjs';
import Time from '../src/timekeeping-model.js';
import {legacyTimeActivityStatements} from './activity-store.mjs';

export const TIME_ENTRY_BYTES=512*1024;
const PAGE_BYTES=1536*1024;
const empty=()=>({schema:2,entries:[],demo:null});
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(db,sql,...values)=>(await rows(db,sql,...values))[0]||null;
export const entryInterval=entry=>Time.absoluteInterval(entry);
export class TimeEntryReadError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}

function decode(row){
  const entry=JSON.parse(row.config);
  if(!entry||typeof entry!=='object'||entry.id!==row.id||entry.personId!==row.person_id||entry.version!==row.version)throw Error('Invalid attendance row');
  return entry;
}

export async function ensureTimeEntries({db,workspaceId,helpers:h,context}){
  let row=await first(db,'SELECT * FROM workspace_timekeeping WHERE workspace_id = ?',workspaceId);
  if(!row)return {row:null,document:empty()};
  let document;
  try{
    document=JSON.parse(row.config);
    if(document.schema===2&&Array.isArray(document.entries)&&document.entries.length===0)return {row,document};
    if(document.schema!==1||!Array.isArray(document.entries)||document.entries.length>10000)throw Error('legacy shape');
    const ids=new Set(),shifts=new Set();
    for(const entry of document.entries){
      if(!entry||typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||typeof entry.shiftId!=='string'||typeof entry.personId!=='string'||!Time.validDate(entry.date)||!Number.isSafeInteger(entry.version)||entry.version<1||!['running','paused','submitted','approved','rejected'].includes(entry.status))throw Error('legacy entry');
      ids.add(entry.id);const shift=JSON.stringify([entry.shiftId,entry.demo===true]);if(shifts.has(shift))throw Error('duplicate occurrence');shifts.add(shift);
    }
  }catch{h.fail(500,'time_ledger_invalid','Tidsregistreringerne kunne ikke migreres sikkert. Eksisterende data er bevaret.');}
  // Read original entry JSON in SQLite rather than rebinding the entire (up to 8 MiB) legacy document.
  const intervals=document.entries.map(entry=>{const interval=entryInterval(entry);return interval?[interval.start,interval.end]:[null,null];});
  const token=crypto.randomUUID(),stamp=new Date().toISOString(),next={schema:2,entries:[],demo:document.demo||null};
  const guard=context&&h.actorGuard?h.actorGuard(context):{sql:'1 = 1',values:[]};
  const condition='workspace_id = ? AND version = ? AND write_token = ? AND '+guard.sql;
  const values=[workspaceId,row.version,row.write_token,...guard.values];
  const queries=[statement(db,`INSERT INTO workspace_time_entries
    (workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at,interval_start,interval_end)
    SELECT ?,json_extract(item.value,'$.id'),json_extract(item.value,'$.shiftId'),json_extract(item.value,'$.personId'),
      json_extract(item.value,'$.date'),COALESCE(json_extract(item.value,'$.endDate'),json_extract(item.value,'$.date')),
      json_extract(item.value,'$.status'),CASE WHEN json_extract(item.value,'$.demo') = 1 THEN 1 ELSE 0 END,
      json_extract(item.value,'$.version'),item.value,?,COALESCE(json_extract(item.value,'$.updatedAt'),?),
      json_extract(bounds.value,'$[0]'),json_extract(bounds.value,'$[1]')
    FROM workspace_timekeeping legacy,json_each(legacy.config,'$.entries') item
    JOIN json_each(?) bounds ON bounds.key = item.key
    WHERE legacy.workspace_id = ? AND legacy.version = ? AND legacy.write_token = ? AND ${guard.sql}
    ON CONFLICT(workspace_id,id) DO NOTHING`,workspaceId,token,stamp,JSON.stringify(intervals),...values),
    statement(db,`UPDATE workspace_timekeeping SET config = ?,version = version + 1,write_token = ?,updated_at = ?
      WHERE ${condition} AND (SELECT COUNT(*) FROM workspace_time_entries WHERE workspace_id = ?) = ?`,JSON.stringify(next),token,stamp,...values,workspaceId,document.entries.length)];
  if(context&&legacyTimeActivityStatements)queries.push(...await legacyTimeActivityStatements({db,context,entries:document.entries,condition:{sql:'EXISTS (SELECT 1 FROM workspace_timekeeping WHERE workspace_id = ? AND write_token = ?)',values:[workspaceId,token]}}));
  try{await db.batch(queries);}catch{h.fail(500,'time_migration_conflict','Tidsregistreringerne kunne ikke migreres sikkert. Eksisterende data er bevaret; kontakt administratoren.');}
  row=await first(db,'SELECT * FROM workspace_timekeeping WHERE workspace_id = ?',workspaceId);
  try{document=JSON.parse(row.config);if(document.schema!==2)throw Error('migration not committed');}catch{h.fail(409,'time_conflict','Tidsregistreringerne ændrede sig under migreringen. Hent dem igen.');}
  return {row,document};
}

export async function findTimeEntry({db,workspaceId,id,shiftId}){
  const row=id?await first(db,'SELECT * FROM workspace_time_entries WHERE workspace_id = ? AND id = ?',workspaceId,id):await first(db,'SELECT * FROM workspace_time_entries WHERE workspace_id = ? AND shift_id = ? ORDER BY demo LIMIT 1',workspaceId,shiftId);
  return row?decode(row):null;
}

export async function readTimeEntries({db,workspaceId,from,to,personId,includeDemo=false,limit=5000,cursor=null,context}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new TypeError('Vælg en sidestørrelse mellem 1 og 5000.');
  let after=null;if(cursor!==null){try{after=JSON.parse(cursor);if(!Array.isArray(after)||after.length!==2||!Time.validDate(after[0])||typeof after[1]!=='string'||after[1].length>512)throw Error('cursor');}catch{throw new TypeError('Listen er ændret. Hent registreringerne igen.');}}
  const peopleAccess=personPredicate(context,'workspace_time_entries.person_id'),siteAccess=jsonSitePredicate(context,'workspace_time_entries.config');
  const scope='workspace_id = ? AND work_date >= ? AND work_date <= ?'+(personId?' AND person_id = ?':'')+(includeDemo?'':' AND demo = 0')+(after?' AND (work_date > ? OR (work_date = ? AND id > ?))':'')+' AND ('+peopleAccess.sql+') AND ('+siteAccess.sql+')';
  const args=[workspaceId,from,to,...(personId?[personId]:[]),...(after?[after[0],after[0],after[1]]:[]),...peopleAccess.values,...siteAccess.values];
  // First fetch bounded metadata so a page of long employee comments cannot create an enormous D1 response.
  const maximum=Math.min(limit,500),metadata=await rows(db,`SELECT id,work_date,version,length(CAST(config AS BLOB)) AS bytes FROM workspace_time_entries WHERE ${scope} ORDER BY work_date,id LIMIT ?`,...args,maximum+1);
  let bytes=0;const selected=[];
  for(const item of metadata){if(selected.length===maximum||bytes+item.bytes>PAGE_BYTES)break;selected.push(item);bytes+=item.bytes;}
  if(metadata.length&&!selected.length)throw new RangeError('En ældre tidsregistrering er for stor. Kontakt administratoren for sikker arkivering.');
  const data=selected.length?await rows(db,`SELECT attendance.*,EXISTS (SELECT 1 FROM workspace_time_entries other
    WHERE other.workspace_id = attendance.workspace_id AND other.person_id = attendance.person_id AND other.demo = attendance.demo
      AND other.work_date >= date(attendance.work_date,'-2 days') AND other.work_date <= date(attendance.work_date,'+2 days')
      AND other.id <> attendance.id AND other.interval_start < attendance.interval_end AND other.interval_end > attendance.interval_start) AS has_overlap
    FROM json_each(?) chosen CROSS JOIN workspace_time_entries attendance WHERE attendance.workspace_id = ? AND attendance.id=json_extract(chosen.value,'$.id') AND attendance.version=json_extract(chosen.value,'$.version') AND length(CAST(attendance.config AS BLOB))<=json_extract(chosen.value,'$.bytes') ORDER BY attendance.work_date,attendance.id`,JSON.stringify(selected.map(({id,version,bytes})=>({id,version,bytes}))),workspaceId):[];
  if(data.length!==selected.length)throw new TimeEntryReadError(409,'time_conflict','Registreringerne ændrede sig under indlæsningen. Hent timerne igen.');
  const last=selected.at(-1);return {entries:data.map(row=>({...decode(row),_hasOverlap:row.has_overlap===1})),nextCursor:metadata.length>selected.length?JSON.stringify([last.work_date,last.id]):null};
}

export async function relatedTimeEntries({db,workspaceId,personId,date,demo}){
  const data=await rows(db,`SELECT * FROM workspace_time_entries WHERE workspace_id = ? AND person_id = ? AND demo = ? AND work_date >= ? AND work_date <= ? ORDER BY work_date,id LIMIT 5001`,workspaceId,personId,demo?1:0,Time.addDays(date,-2),Time.addDays(date,2));
  if(data.length>5000)throw new RangeError('Der er for mange registreringer for denne medarbejder og periode. Kontakt administratoren.');
  return data.map(decode);
}
