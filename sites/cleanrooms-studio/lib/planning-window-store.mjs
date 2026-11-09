/* Period-scoped planner reads. Full authoritative writes continue through studio-store. */
import Planning from '../src/planning-records.js';
import Window from '../src/planning-window.js';
import {currentCalendarSummary,packCalendarSummary,unpackCalendarSummary,calendarSummaryChunks} from './planning-calendar-summary.mjs';
import {decodePlanningRecord,planWindowFields,trimPlanningSnapshot,PlanningStoreError} from './planning-store.mjs';
import {publicationWindowPage,projectPublicationWindow} from './publication-store.mjs';
import {storedScheduleErrors} from './planning-validation.mjs';

const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(db,sql,...values)=>(await rows(db,sql,...values))[0]||null;
const PAGE_BYTES=1024*1024,PAGE_ROWS=500,DEFERRED_PAGE_ROWS=1000;
const fail=(status,code,message)=>{throw new PlanningStoreError(status,code,message);};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const add=(day,count)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
const monday=day=>add(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));

export function windowMetadata(studio){
  const value=trimPlanningSnapshot(studio||{});
  value.publications={version:1,sequence:0,slots:{},records:[]};value.activity=[];value.checklistProgress={};value.requests={};value.leaveDecisions={};value.shiftWorkflow={version:1,sequence:0,notifications:[],requests:[]};
  delete value.absences;delete value.absenceHasMore;return value;
}

export function decodeWindowCursor(value){
  if(value===undefined||value===null)return null;
  try{
    if(typeof value!=='string'||value.length>16384||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('cursor');
    const parsed=JSON.parse(decode.decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),letter=>letter.charCodeAt(0))));
    if(parsed.v!==1||typeof parsed.workspace!=='string'||!Number.isSafeInteger(parsed.revision)||typeof parsed.token!=='string'||!Number.isSafeInteger(parsed.absenceVersion)||!['draft','publication'].includes(parsed.phase))throw Error('cursor');
    Window.normalize({mode:'calendar',from:parsed.from,to:parsed.to});
    if(parsed.instructions!==undefined&&parsed.instructions!=='deferred')throw Error('cursor');
    if(parsed.phase==='draft'&&parsed.after!==null&&(!parsed.after||!['series','shift','week'].includes(parsed.after.kind)||typeof parsed.after.id!=='string'||parsed.after.id.length>512))throw Error('cursor');
    return parsed;
  }catch{fail(400,'planning_window_cursor_invalid','Kalenderens sidehenvisning er ugyldig. Hent perioden igen.');}
}

function encodeCursor(value){return btoa(String.fromCharCode(...encode.encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}

export async function ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot,outcome}){
  if(outcome)outcome.sourceChanged=false;
  const checked=await db.batch([
    statement(db,'SELECT schema FROM workspace_plan_window_imports WHERE workspace_id = ?',workspaceId),
    statement(db,'SELECT id FROM workspace_plan_records WHERE workspace_id = ? AND window_schema = 0 LIMIT 1',workspaceId)
  ]),marker=checked[0]?.results?.[0],dirty=checked[1]?.results?.[0];
  if(marker?.schema===1&&!dirty)return true;
  // A one-time, bounded-row source import; subsequent window reads never scan or decode unrelated records.
  for(let pass=0;pass<100000;pass++){
    const headers=await rows(db,'SELECT kind,id,version,length(CAST(config AS BLOB)) bytes FROM workspace_plan_records WHERE workspace_id = ? AND window_schema = 0 ORDER BY kind,id LIMIT 50',workspaceId);
    if(!headers.length)break;let size=0;const chosen=[];for(const row of headers){if(row.bytes>512*1024)fail(500,'planning_window_index_invalid','En planpost er for stor til sikker kalenderindeksering. Eksisterende data er bevaret.');if(chosen.length&&size+row.bytes>PAGE_BYTES)break;chosen.push(row);size+=row.bytes;}
    const pending=await rows(db,`SELECT item.kind,item.id,item.version,item.deleted,item.config,item.write_token FROM json_each(?) selected CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind=json_extract(selected.value,'$.kind') AND item.id=json_extract(selected.value,'$.id') AND item.version=json_extract(selected.value,'$.version')`,JSON.stringify(chosen),workspaceId);
    const updates=[];
    for(const row of pending){const value=row.deleted?null:await decodePlanningRecord(db,workspaceId,row),fields=planWindowFields({kind:row.kind,id:row.id,value},row.version,raw.studio?.calendarAnchor);updates.push(statement(db,`UPDATE workspace_plan_records SET window_from=COALESCE(?,window_from),window_to=COALESCE(?,window_to),origin_date=COALESCE(?,origin_date),parent_id=COALESCE(?,parent_id),group_id=COALESCE(?,group_id),week_index=COALESCE(?,week_index),window_schema=1,window_version=version WHERE workspace_id=? AND kind=? AND id=? AND version=? AND write_token=?`,fields.from,fields.to,fields.origin,fields.parent,fields.group,fields.week,workspaceId,row.kind,row.id,row.version,row.write_token));}
    await db.batch(updates);
  }
  if(await first(db,'SELECT id FROM workspace_plan_records WHERE workspace_id = ? AND window_schema = 0 LIMIT 1',workspaceId))fail(409,'planning_window_index_conflict','Planen ændrer sig under kalenderindekseringen. Hent perioden igen.');
  const metadata=trimPlanningSnapshot(raw.studio||{}),packed=splitSnapshot(JSON.stringify(metadata)),token=crypto.randomUUID(),at=new Date().toISOString();
  const condition={sql:'EXISTS (SELECT 1 FROM studio_states WHERE owner_id=? AND revision=? AND write_token=?)',values:[owner,raw.revision,token]};
  const statements=[statement(db,`UPDATE studio_states SET write_token=?,chunk_count=?,byte_length=?,updated_at=? WHERE owner_id=? AND revision=? AND write_token=? AND NOT EXISTS (SELECT 1 FROM workspace_plan_records WHERE workspace_id=? AND window_schema=0)`,token,packed.chunks.length,packed.byteLength,at,owner,raw.revision,raw.source.token,workspaceId),
    ...packed.chunks.map((content,index)=>statement(db,`INSERT INTO studio_state_chunks (owner_id,revision,chunk_index,content) SELECT ?,?,?,? WHERE ${condition.sql} ON CONFLICT(owner_id,revision,chunk_index) DO UPDATE SET content=excluded.content`,owner,raw.revision,index,content,...condition.values)),
    statement(db,`DELETE FROM studio_state_chunks WHERE owner_id=? AND revision=? AND chunk_index>=? AND ${condition.sql}`,owner,raw.revision,packed.chunks.length,...condition.values),
    statement(db,`INSERT INTO workspace_plan_window_imports (workspace_id,schema,source_revision,source_token,completed_at) SELECT ?,1,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id) DO UPDATE SET schema=1,source_revision=excluded.source_revision,source_token=excluded.source_token,completed_at=excluded.completed_at`,workspaceId,raw.revision,token,at,...condition.values)];
  const written=await db.batch(statements),changed=written[0]?.meta?.changes===1;
  if(outcome)outcome.sourceChanged=changed;
  return changed;
}

function candidateQuery(workspaceId,studio,{from,to},after=null,maxRows=PAGE_ROWS){
  const sql=`WITH candidates(kind,id) AS (
    SELECT kind,id FROM workspace_plan_records INDEXED BY workspace_plan_window_to WHERE workspace_id=? AND kind='series' AND window_schema=1 AND window_to>=? AND window_from<=?
    UNION SELECT kind,id FROM workspace_plan_records INDEXED BY workspace_plan_window_from WHERE workspace_id=? AND kind='shift' AND window_schema=1 AND window_from>=? AND window_from<=?
    UNION SELECT kind,id FROM workspace_plan_records INDEXED BY workspace_plan_window_origin WHERE workspace_id=? AND kind='shift' AND window_schema=1 AND origin_date>=? AND origin_date<=?
    UNION SELECT kind,id FROM workspace_plan_records INDEXED BY workspace_plan_window_from WHERE workspace_id=? AND kind='week' AND window_schema=1 AND window_from>=? AND window_from<=?
  ), selected(kind,id) AS (
    SELECT kind,id FROM candidates
    UNION SELECT 'series',child.parent_id FROM candidates chosen CROSS JOIN workspace_plan_records child WHERE child.workspace_id=? AND child.kind=chosen.kind AND child.id=chosen.id AND child.kind='shift' AND child.parent_id IS NOT NULL
  ) SELECT record.kind,record.id,record.version,record.deleted,record.sort_order,record.window_from,record.window_to,record.origin_date,record.parent_id,record.window_version,record.window_schema,record.write_token,record.schedule_version,length(CAST(record.schedule_config AS BLOB)) AS schedule_bytes,CASE WHEN json_valid(record.schedule_config) THEN json_extract(record.schedule_config,'$.bytes') END AS calendar_bytes,length(CAST(record.config AS BLOB)) AS stored_bytes,json_extract(record.config,'$.bytes') AS payload_bytes
    FROM selected chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=chosen.kind AND record.id=chosen.id
    ${after?'AND (record.kind>? OR (record.kind=? AND record.id>?))':''} ORDER BY record.kind,record.id LIMIT ?`;
  const values=[workspaceId,from,to,workspaceId,from,to,workspaceId,from,to,workspaceId,monday(from),monday(to),workspaceId,workspaceId,...(after?[after.kind,after.kind,after.id]:[]),maxRows+1];return {sql,values};
}

async function deferredDraftPage({db,workspaceId,metadata,maxRows,maxBytes,includeRecordWindows,maxSourceBytes=Infinity}){
  const selected=[];let estimated=0;for(const row of metadata){const size=row.deleted?4:row.kind==='week'?(row.calendar_bytes||row.schedule_bytes||512):(row.schedule_bytes||512);if(!Number.isSafeInteger(size)||size<1||row.schedule_bytes>512*1024)fail(500,'planning_calendar_summary_invalid','Kalenderens tidsoversigt er ugyldig.');const proofBytes=encode.encode(JSON.stringify({kind:row.kind,id:row.id,version:row.version,token:row.write_token})).length;if(selected.length&&(selected.length>=maxRows||estimated+size+proofBytes>maxBytes))break;selected.push(row);estimated+=size+proofBytes;}
  const found=selected.length?await rows(db,`SELECT item.kind,item.id,item.version,item.deleted,item.sort_order,item.write_token,item.schedule_version,item.schedule_config FROM json_each(?) selected CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind=json_extract(selected.value,'$.kind') AND item.id=json_extract(selected.value,'$.id') AND item.version=json_extract(selected.value,'$.version') AND item.write_token=json_extract(selected.value,'$.token') AND length(CAST(item.schedule_config AS BLOB))<=524288 ORDER BY item.kind,item.id`,JSON.stringify(selected.map(({kind,id,version,write_token})=>({kind,id,version,token:write_token}))),workspaceId):[];
  if(found.length!==selected.length)fail(409,'planning_window_conflict','Planen ændrede sig under indlæsningen.');const records=[],deferred=[],recordWindows={},metadataById=new Map(selected.map(row=>[Planning.key(row.kind,row.id),row]));let bytes=0,sourceBytes=0;
  for(const row of found){let value=null;if(!row.deleted){
    if(row.schedule_version!==row.version||!currentCalendarSummary(row.kind,row.id,row.schedule_config)){
      const sourceSize=metadataById.get(Planning.key(row.kind,row.id)).payload_bytes;if(records.length&&sourceBytes+sourceSize>maxSourceBytes)break;sourceBytes+=sourceSize;
      const full=await first(db,'SELECT kind,id,version,deleted,config,write_token FROM workspace_plan_records WHERE workspace_id=? AND kind=? AND id=? AND version=? AND write_token=? AND length(CAST(config AS BLOB))<=524288',workspaceId,row.kind,row.id,row.version,row.write_token);if(!full)fail(409,'planning_window_conflict','Planen ændrede sig under indlæsningen.');const payload=await packCalendarSummary(row.kind,row.id,await decodePlanningRecord(db,workspaceId,full)),condition={sql:'EXISTS (SELECT 1 FROM workspace_plan_records current WHERE current.workspace_id=? AND current.kind=? AND current.id=? AND current.version=? AND current.write_token=?)',values:[workspaceId,row.kind,row.id,row.version,row.write_token]};
      const written=await db.batch([statement(db,'UPDATE workspace_plan_records SET schedule_config=?,schedule_version=version WHERE workspace_id=? AND kind=? AND id=? AND version=? AND write_token=?',payload.config,workspaceId,row.kind,row.id,row.version,row.write_token),...calendarSummaryChunks({db,workspaceId,kind:row.kind,id:row.id,version:row.version,payload,condition,token:row.write_token})]);if(written[0]?.meta?.changes!==1)fail(409,'planning_window_conflict','Planen ændrede sig under indlæsningen.');row.schedule_config=payload.config;row.schedule_version=row.version;
    }
    value=(await unpackCalendarSummary({db,workspaceId,row})).value;
  }
  const key=Planning.key(row.kind,row.id),index=metadataById.get(key),window={from:index.window_from,to:index.window_to,origin:index.origin_date,parent:index.parent_id};
  const record={kind:row.kind,id:row.id,value,sortOrder:row.sort_order,version:row.version},size=encode.encode(JSON.stringify(record)).length+(includeRecordWindows?encode.encode(JSON.stringify({[key]:window})).length:0);if(records.length&&bytes+size>maxBytes)break;records.push(record);bytes+=size;if(includeRecordWindows)recordWindows[key]=window;if(row.kind==='series'&&value||row.kind==='shift'&&value?.edit)deferred.push(key);
  }
  const last=records.at(-1);return {records,deferred,...(includeRecordWindows?{recordWindows}:{}),bytes,sourceBytes,nextAfter:metadata.length>records.length?{kind:last.kind,id:last.id}:null};
}

export async function draftWindowPage({db,workspaceId,studio,projection,after=null,maxRows=PAGE_ROWS,maxBytes=PAGE_BYTES,instructions,includeRecordWindows=false,maxSourceBytes=Infinity}){
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>(instructions==='deferred'&&includeRecordWindows?DEFERRED_PAGE_ROWS:PAGE_ROWS))fail(400,'invalid_calendar_window','Kalenderens sidestørrelse er ugyldig.');
  const query=candidateQuery(workspaceId,studio,projection,after,maxRows),metadata=await rows(db,query.sql,...query.values),selected=[];let bytes=0;
  for(const row of metadata)if(!Number.isSafeInteger(row.version)||row.version<1||row.window_schema!==1||row.window_version!==row.version||!Number.isSafeInteger(row.payload_bytes)||row.stored_bytes>512*1024)fail(500,'planning_window_index_invalid','Kalenderens indeks passer ikke til planposten. Eksisterende data er bevaret.');
  if(instructions==='deferred')return deferredDraftPage({db,workspaceId,metadata,maxRows,maxBytes,includeRecordWindows,maxSourceBytes});
  for(const row of metadata){const size=(row.deleted?4:row.payload_bytes)+encode.encode(row.id).length+150;if(selected.length&&(selected.length>=maxRows||bytes+size>maxBytes))break;selected.push(row);bytes+=size;}
  const found=selected.length?await rows(db,`SELECT item.* FROM json_each(?) selected CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind=json_extract(selected.value,'$.kind') AND item.id=json_extract(selected.value,'$.id') AND item.version=json_extract(selected.value,'$.version') ORDER BY item.kind,item.id`,JSON.stringify(selected.map(({kind,id,version})=>({kind,id,version}))),workspaceId):[];
  if(found.length!==selected.length)fail(409,'planning_window_conflict','Planen ændrede sig under indlæsningen. Hent perioden igen.');
  const records=[];for(const row of found)records.push({kind:row.kind,id:row.id,value:row.deleted?null:await decodePlanningRecord(db,workspaceId,row),sortOrder:row.sort_order,version:row.version});
  const last=selected.at(-1);return {records,bytes,nextAfter:metadata.length>selected.length?{kind:last.kind,id:last.id}:null};
}

export async function readWindowPage({db,workspaceId,owner,raw,projection,cursor=null,instructions}){
  const absence=(await first(db,'SELECT version FROM workspace_absence_imports WHERE workspace_id=?',workspaceId))?.version||0;
  if(cursor&&(cursor.workspace!==workspaceId||cursor.revision!==raw.revision||cursor.token!==raw.source.token||cursor.from!==projection.from||cursor.to!==projection.to||cursor.absenceVersion!==absence||cursor.instructions!==instructions))fail(409,'planning_window_conflict','Planen eller fraværet er ændret. Hent kalenderperioden igen.');
  const records=[],publicationRows=[],auxRows=[],versions={},deferred=[],recordWindows={},pageRows=instructions==='deferred'?DEFERRED_PAGE_ROWS:PAGE_ROWS;let next=null;
  const base={v:1,workspace:workspaceId,revision:raw.revision,token:raw.source.token,absenceVersion:absence,from:projection.from,to:projection.to,...(instructions?{instructions}:{})};
  if(!cursor||cursor.phase==='draft'){
    const page=await draftWindowPage({db,workspaceId,studio:raw.studio||{},projection,after:cursor?.after||null,instructions,maxRows:pageRows,includeRecordWindows:instructions==='deferred'});records.push(...page.records);deferred.push(...page.deferred||[]);Object.assign(recordWindows,page.recordWindows);
    if(page.nextAfter)next={...base,phase:'draft',after:page.nextAfter};
    else if(records.length<pageRows&&page.bytes<=PAGE_BYTES-1024){const published=await publicationWindowPage({db,workspaceId,...projection,instructions,cursor:null,maxRows:pageRows-records.length,maxBytes:PAGE_BYTES-page.bytes});publicationRows.push(...published.rows);auxRows.push(...published.auxRows||[]);if(published.nextCursor)next={...base,phase:'publication',after:published.nextCursor};}
    else next={...base,phase:'publication',after:null};
  }else{
    const published=await publicationWindowPage({db,workspaceId,...projection,instructions,cursor:cursor.after||null,maxRows:pageRows,maxBytes:PAGE_BYTES});publicationRows.push(...published.rows);auxRows.push(...published.auxRows||[]);if(published.nextCursor)next={...base,phase:'publication',after:published.nextCursor};
  }
  for(const row of records){
    if(storedScheduleErrors(row.kind,row.id,row.value).length)fail(409,'planning_schedule_repair_required','Den gemte '+(row.kind==='series'?'vagtserie':'vagt')+' '+row.id+' har ugyldige tider eller datoer. Ret eller fjern posten, før kalenderperioden åbnes.');
    versions[Planning.key(row.kind,row.id)]=row.version;
  }
  const final=await db.batch([
    statement(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',owner),
    statement(db,'SELECT version FROM workspace_absence_imports WHERE workspace_id=?',workspaceId)
  ]),header=final[0]?.results?.[0],finalAbsence=final[1]?.results?.[0]?.version||0;
  if(!header||header.revision!==raw.revision||header.write_token!==raw.source.token||finalAbsence!==absence)fail(409,'planning_window_conflict','Planen eller fraværet er ændret. Hent kalenderperioden igen.');
  return {revision:raw.revision,...(!cursor?{studio:windowMetadata(raw.studio)}:{}),planning:{schema:1,partial:true,projection,versions,...(instructions==='deferred'?{instructions,deferred,recordWindows,absenceVersion:absence}:{}),metadataHash:await hash(Planning.canonical(Planning.metadata(raw.studio||{})))},records,publicationRows,auxRows,nextCursor:next?encodeCursor(next):null};
}

export function projectStudioWindow(studio,planning,scope,touchedChanges=[]){
  const projection=Window.normalize({mode:'calendar',...scope}),all=Planning.flatten(studio),allKeys=new Set(all.map(row=>Planning.key(row.kind,row.id))),chosen=new Map(),parents=new Set(),touched=new Set(touchedChanges.map(item=>Planning.key(item.kind,item.id)));
  for(const row of all){const fields=planWindowFields(row,planning.versions[Planning.key(row.kind,row.id)]||0,studio.calendarAnchor),inside=row.kind==='series'?fields.from<=projection.to&&fields.to>=projection.from:row.kind==='week'?fields.from>=monday(projection.from)&&fields.from<=monday(projection.to):fields.from>=projection.from&&fields.from<=projection.to||fields.origin>=projection.from&&fields.origin<=projection.to;if(inside||touched.has(Planning.key(row.kind,row.id))){chosen.set(Planning.key(row.kind,row.id),row);if(fields.parent)parents.add(fields.parent);}}
  for(const row of all)if(row.kind==='series'&&parents.has(row.id))chosen.set(Planning.key(row.kind,row.id),row);
  for(const key of Object.keys(planning.versions)){if(chosen.has(key)||allKeys.has(key))continue;let identity;try{identity=JSON.parse(key);}catch{continue;}if(identity[0]!=='shift'||typeof identity[1]!=='string')continue;const day=identity[1].slice(-10);if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>=projection.from&&day<=projection.to)chosen.set(key,{kind:'shift',id:identity[1],value:null,sortOrder:0});}
  for(const change of touchedChanges)if(!chosen.has(Planning.key(change.kind,change.id)))chosen.set(Planning.key(change.kind,change.id),{kind:change.kind,id:change.id,value:null,sortOrder:0});
  const versions={},records=[];for(const row of chosen.values()){const key=Planning.key(row.kind,row.id),version=planning.versions[key];if(!Number.isSafeInteger(version)||version<1)continue;versions[key]=version;records.push({...row,version});}
  const publicationRows=projectPublicationWindow(studio,projection),publishedKeys=new Set(publicationRows.filter(row=>row.kind==='shift').map(row=>JSON.stringify([row.id,row.value.shift.person]))),progress=Object.fromEntries(Object.entries(studio.checklistProgress||{}).filter(([key])=>publishedKeys.has(key)));
  const collector=Window.collector(projection,{maxBytes:Infinity,maxRecords:Infinity});collector.add({revision:0,studio:windowMetadata(studio),planning:{schema:1,partial:true,projection,versions,metadataHash:planning.metadataHash},records,publicationRows,auxRows:[],progress,nextCursor:null});
  const result=collector.finish();delete result.studio.absences;delete result.studio.requests;delete result.studio.leaveDecisions;return {studio:result.studio,planning:result.planning};
}
