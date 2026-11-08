/* Materialized published occurrences. The planning importer owns the one migration transaction. */
import Publication from '../src/publication-model.js';
import Data from '../src/studio-data.js';
import Time from '../src/timekeeping-model.js';
import {publishedEmployeeDescriptor,publishedEmployeeIndexStatements} from './published-employee-index.mjs';

export const PUBLICATION_CHUNK_BYTES=256*1024;
const MAX_PAYLOAD_BYTES=64*1024*1024,READ_BYTES=1024*1024;
const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const same=(left,right)=>canonical(left)===canonical(right);
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(...args)=>(await rows(...args))[0]||null;
const stores={
  state:{table:'workspace_publication_state',key:null,fields:['version','sequence','config','byte_length','chunk_count','write_token','updated_at','window_config','window_version']},
  scope:{table:'workspace_publication_scopes',key:'scope_key',fields:['scope_key','from_date','to_date','site','version','deleted','config','byte_length','chunk_count','payload_version','write_token','updated_at','window_config','window_version']},
  shift:{table:'workspace_published_shifts',key:'id',fields:['id','scope_key','person_id','work_date','site','start_time','end_time','version','deleted','config','byte_length','chunk_count','payload_version','write_token','updated_at','time_config','time_version','employee_version','has_description','checklist_total','checklist_structure','workflow_fingerprint','instruction_token','instruction_version']},
  record:{table:'workspace_publication_records',key:'id',fields:['id','position','at','config','byte_length','chunk_count','write_token']}
};
const invalid=(message='De udgivne vagter kunne ikke læses sikkert.')=>{const error=new Error(message);error.code='publication_storage_invalid';error.status=500;return error;};
const conflict=()=>{const error=new Error('Udgivelsen er ændret. Hent den seneste plan.');error.code='publication_read_conflict';error.status=409;return error;};
const checksum=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encode.encode(value):value))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
async function timeConfig(shift){const value={plannedBreakMinutes:shift.plannedBreakMinutes??0};return JSON.stringify({sha256:await checksum(canonical(value)),value});}

const employeeColumns='id,scope_key,person_id,work_date,site,start_time,end_time,version,write_token,employee_version,has_description,checklist_total,checklist_structure,workflow_fingerprint,instruction_token,instruction_version';
function validatePublishedIdentity(shift,row){if(!record(shift)||shift.id!==row.id||shift.person!==row.person_id||shift.date!==row.work_date||shift.site!==row.site||shift.start!==row.start_time||shift.end!==row.end_time||Time.plannedBreak(shift)===null)throw invalid();}
async function employeeDescriptors(db,workspaceId,headers){
  for(const row of headers){
    if(row.employee_version!==row.version||row.instruction_version!==row.version||!/^i1-[a-f0-9]{16}$/.test(row.instruction_token)){
      const full=await first(db,`SELECT * FROM workspace_published_shifts WHERE workspace_id=? AND id=? AND deleted=0 AND version=? AND write_token=? AND length(CAST(config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,workspaceId,row.id,row.version,row.write_token);if(!full)throw conflict();const shift=await unpack(db,workspaceId,'shift',full);validatePublishedIdentity(shift,row);const descriptor=await publishedEmployeeDescriptor(shift,row.version),condition={sql:'EXISTS (SELECT 1 FROM workspace_published_shifts current WHERE current.workspace_id=? AND current.id=? AND current.version=? AND current.write_token=? AND current.deleted=0)',values:[workspaceId,row.id,row.version,row.write_token]};
      const written=await db.batch([statement(db,'UPDATE workspace_published_shifts SET employee_version=?,has_description=?,checklist_total=?,checklist_structure=?,workflow_fingerprint=?,instruction_token=?,instruction_version=? WHERE workspace_id=? AND id=? AND version=? AND write_token=? AND deleted=0',...Object.values(descriptor.fields),workspaceId,row.id,row.version,row.write_token),...publishedEmployeeIndexStatements({db,workspaceId,descriptors:[{id:row.id,descriptor}],condition})]);if(written[0]?.meta?.changes!==1)throw conflict();Object.assign(row,descriptor.fields);
    }
    if(!Number.isSafeInteger(row.version)||row.version<1||row.employee_version!==row.version||![0,1].includes(row.has_description)||!Number.isSafeInteger(row.checklist_total)||row.checklist_total<0||!/^sha256:[a-f0-9]{64}$/.test(row.checklist_structure)||!/^s1-[a-f0-9]{16}$/.test(row.workflow_fingerprint))throw invalid();
  }
}
export async function readPublishedEmployeeLocations({db,workspaceId,scopeKeys}){
  const result=new Map();for(const batch of groups([...new Set(scopeKeys)],32)){const headers=await rows(db,'SELECT scope_key,from_date,to_date,site,version,write_token,window_version FROM workspace_publication_scopes WHERE workspace_id=? AND deleted=0 AND scope_key IN (SELECT value FROM json_each(?))',workspaceId,JSON.stringify(batch));if(headers.length!==batch.length)throw conflict();const values=await readWindowHeaders(db,workspaceId,'scope',headers);for(const [key,value]of values)result.set(key,clone(Publication.locationDetails(value.value.location)));}return result;
}
export async function readEmployeePublishedShift({db,workspaceId,personId,shiftId}){
  if(typeof shiftId!=='string'||!shiftId||shiftId.length>512)throw Object.assign(new TypeError('Vælg en gyldig vagt.'),{status:400,code:'employee_shift_invalid'});
  const header=await first(db,`SELECT ${employeeColumns},deleted,byte_length,chunk_count,payload_version FROM workspace_published_shifts WHERE workspace_id=? AND id=?${personId!==undefined?' AND person_id=?':''} AND deleted=0`,workspaceId,shiftId,...(personId!==undefined?[personId]:[]));if(!header)return null;
  const value=(await hydratePayloads(db,workspaceId,'shift',[header])).get(shiftId);if(!value)throw conflict();validatePublishedIdentity(value.value,header);const sites=await readPublishedEmployeeLocations({db,workspaceId,scopeKeys:[header.scope_key]}),live=await first(db,'SELECT version,write_token,deleted FROM workspace_published_shifts WHERE workspace_id=? AND id=?',workspaceId,shiftId);if(live?.version!==header.version||live.write_token!==header.write_token||live.deleted)throw conflict();const site=sites.get(header.scope_key);return {shift:{...clone(value.value),location:site},site,publicationVersion:header.version};
}
/* The only warm instruction reads are explicit details. Periods use typed
 * schedules and a SQL join against current hashed checklist descriptors. */
export async function readPublishedEmployeePage({db,workspaceId,from=Data.minDate,to=Data.maxDate,personId,cursor=null,limit=500,ids,next=false}){
  if(!Time.validDate(from)||!Time.validDate(to)||from>to||from<Data.minDate||to>Data.maxDate||!Number.isInteger(limit)||limit<1||limit>500||personId!==undefined&&typeof personId!=='string'||ids!==undefined&&(!Array.isArray(ids)||ids.length>5000||ids.some(id=>typeof id!=='string'||!id||id.length>512)))throw Object.assign(new TypeError('Vælg en gyldig vagtperiode.'),{status:400,code:'employee_period_invalid'});
  let after=null;if(cursor!==null){try{after=JSON.parse(cursor);if(!Array.isArray(after)||after.length!==2||!Time.validDate(after[0])||typeof after[1]!=='string'||after[1].length>512)throw Error();}catch{throw Object.assign(new TypeError('Sidehenvisningen er ugyldig.'),{status:400,code:'employee_cursor_invalid'});}}
  const where=['workspace_id=?','deleted=0','work_date>=?','work_date<=?'],values=[workspaceId,from,to];if(personId!==undefined){where.push('person_id=?');values.push(personId);}if(ids!==undefined){where.push('id IN (SELECT value FROM json_each(?))');values.push(JSON.stringify([...new Set(ids)]));}if(after){where.push('(work_date>? OR (work_date=? AND id>?))');values.push(after[0],after[0],after[1]);}
  const headers=await rows(db,`SELECT ${employeeColumns} FROM workspace_published_shifts INDEXED BY ${personId!==undefined?'workspace_published_shifts_person':'workspace_published_shifts_window'} WHERE ${where.join(' AND ')} ORDER BY work_date,id LIMIT ?`,...values,(next?1:limit)+1),selected=headers.slice(0,next?1:limit);await employeeDescriptors(db,workspaceId,selected);
  const idsSelected=selected.map(row=>row.id),pauses=await readPublishedTimeShifts({db,workspaceId,ids:idsSelected,...(personId?{personId}:{})}),pauseById=new Map(pauses.map(shift=>[shift.id,shift.plannedBreakMinutes])),locations=await readPublishedEmployeeLocations({db,workspaceId,scopeKeys:selected.map(row=>row.scope_key)}),counts=new Map();
  if(selected.length){const counted=await rows(db,`SELECT current.id,COUNT(item.task_key) AS total,COALESCE(SUM(CASE WHEN progress.checked=1 AND progress.structure=item.structure AND progress.signature=item.signature THEN 1 ELSE 0 END),0) AS checked FROM json_each(?) chosen CROSS JOIN workspace_published_shifts current LEFT JOIN workspace_published_checklist_items item ON item.workspace_id=current.workspace_id AND item.shift_id=current.id AND item.published_version=current.version AND item.structure=current.checklist_structure LEFT JOIN workspace_checklist_tasks progress ON progress.workspace_id=item.workspace_id AND progress.shift_id=item.shift_id AND progress.person_id=current.person_id AND progress.task_key=item.task_key WHERE current.workspace_id=? AND current.id=json_extract(chosen.value,'$.id') AND current.version=json_extract(chosen.value,'$.version') AND current.write_token=json_extract(chosen.value,'$.token') AND current.employee_version=current.version AND current.deleted=0 GROUP BY current.id`,JSON.stringify(selected.map(row=>({id:row.id,version:row.version,token:row.write_token}))),workspaceId);if(counted.length!==selected.length)throw conflict();for(const row of counted)counts.set(row.id,row);}
  const taskSummaries={},shifts=selected.map(row=>{const count=counts.get(row.id);if(!count||count.total!==row.checklist_total||!pauseById.has(row.id))throw invalid();taskSummaries[row.id]={checked:count.checked,total:count.total,complete:count.total>0&&count.checked===count.total};return {id:row.id,person:row.person_id,date:row.work_date,site:row.site,start:row.start_time,end:row.end_time,plannedBreakMinutes:pauseById.get(row.id),hasDescription:row.has_description===1,fingerprint:row.workflow_fingerprint,location:locations.get(row.scope_key),publicationVersion:row.version};});
  const last=selected.at(-1);return {shifts,taskSummaries,sites:[...locations.values()],nextCursor:!next&&headers.length>selected.length?JSON.stringify([last.work_date,last.id]):null};
}

// Time review needs the frozen assignment and agreed pause, not its instruction.
// An older writer dirties this derived summary; repair only the selected rows.
export async function readPublishedTimeShifts({db,workspaceId,from,to,personId,ids}){
  if(typeof workspaceId!=='string'||!workspaceId||personId!==undefined&&(typeof personId!=='string'||!personId)||ids!==undefined&&(!Array.isArray(ids)||ids.length>5000||ids.some(id=>typeof id!=='string'||!id))||ids===undefined&&(!Time.validDate(from)||!Time.validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>366))throw Object.assign(new TypeError('Vælg en gyldig periode eller de berørte vagter.'),{status:400,code:'publication_time_scope_invalid'});
  const result=[],seen=new Set(),expected=[];
  const batches=ids===undefined?[null]:ids.length?guardDocuments([...new Set(ids)]).map(value=>JSON.parse(value)):[];
  for(const chosen of batches){let after='',afterDate=from;for(;;){
    const where=['workspace_id=?','deleted=0'],values=[workspaceId];if(personId!==undefined){where.push('person_id=?');values.push(personId);}if(chosen){where.push('id>?','id IN (SELECT value FROM json_each(?))');values.push(after,JSON.stringify(chosen));}else{where.push('work_date>=? AND work_date<=?','(work_date>? OR (work_date=? AND id>?))');values.push(from,to,afterDate,afterDate,after);}
    const index=chosen?'':` INDEXED BY ${personId===undefined?'workspace_published_shifts_window':'workspace_published_shifts_person'}`;
    const headers=await rows(db,`SELECT id,person_id,work_date,site,start_time,end_time,version,write_token,time_version,length(CAST(time_config AS BLOB)) AS time_bytes FROM workspace_published_shifts${index} WHERE ${where.join(' AND ')} ORDER BY ${chosen?'':'work_date,'}id LIMIT 500`,...values);
    const summaries=new Map(),warm=headers.filter(row=>row.time_version===row.version&&row.time_bytes>0&&row.time_bytes<=2048).map(row=>({id:row.id,version:row.version,token:row.write_token}));
    if(warm.length)for(const document of guardDocuments(warm)){const current=await rows(db,'SELECT current.id,current.time_config FROM json_each(?) chosen CROSS JOIN workspace_published_shifts current WHERE current.workspace_id=? AND current.id=json_extract(chosen.value,\'$.id\') AND current.version=json_extract(chosen.value,\'$.version\') AND current.write_token=json_extract(chosen.value,\'$.token\') AND current.deleted=0 AND current.time_version=current.version AND length(CAST(current.time_config AS BLOB))<=2048',document,workspaceId);for(const row of current)summaries.set(row.id,row.time_config);}
    for(const header of headers){
      if(result.length>=50000)throw selectionTooLarge();if(!Number.isSafeInteger(header.version)||header.version<1||!Number.isSafeInteger(header.time_bytes)||header.time_bytes>2048)throw invalid();
      let config;if(header.time_version!==header.version||!header.time_bytes){
        const full=await first(db,`SELECT * FROM workspace_published_shifts WHERE workspace_id=? AND id=? AND deleted=0 AND version=? AND write_token=? AND length(CAST(config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,workspaceId,header.id,header.version,header.write_token);if(!full)throw conflict();
        const shift=await unpack(db,workspaceId,'shift',full);if(!record(shift)||shift.id!==header.id||shift.person!==header.person_id||shift.date!==header.work_date||shift.site!==header.site||shift.start!==header.start_time||shift.end!==header.end_time||Time.plannedBreak(shift)===null)throw invalid();
        config=await timeConfig(shift);const repaired=await db.batch([statement(db,'UPDATE workspace_published_shifts SET time_config=?,time_version=version WHERE workspace_id=? AND id=? AND deleted=0 AND version=? AND write_token=?',config,workspaceId,header.id,header.version,header.write_token)]);if(repaired[0]?.meta?.changes!==1)throw conflict();
      }else{config=summaries.get(header.id);if(!config)throw conflict();}
      let envelope;try{envelope=JSON.parse(config);}catch{throw invalid();}if(!record(envelope)||!record(envelope.value)||Object.keys(envelope.value).length!==1||!Object.hasOwn(envelope.value,'plannedBreakMinutes')||await checksum(canonical(envelope.value))!==envelope.sha256)throw invalid();
      const shift={id:header.id,person:header.person_id,date:header.work_date,site:header.site,start:header.start_time,end:header.end_time,plannedBreakMinutes:envelope.value.plannedBreakMinutes};if(!Time.validDate(shift.date)||!Number.isInteger(shift.site)||shift.site<0||shift.site>=2000||Time.plannedBreak(shift)===null||Time.plannedMinutes(shift)===null)throw invalid();
      if(seen.has(shift.id))throw invalid();seen.add(shift.id);result.push(shift);expected.push({id:header.id,version:header.version,token:header.write_token});
    }
    if(headers.length<500)break;after=headers.at(-1).id;afterDate=headers.at(-1).work_date;
  }}
  if(expected.length)for(const document of guardDocuments(expected)){const matching=await first(db,`SELECT COUNT(*) AS n FROM json_each(?) chosen CROSS JOIN workspace_published_shifts current WHERE current.workspace_id=? AND current.id=json_extract(chosen.value,'$.id') AND current.version=json_extract(chosen.value,'$.version') AND current.write_token=json_extract(chosen.value,'$.token') AND current.deleted=0 AND current.time_version=current.version`,document,workspaceId);if(matching?.n!==JSON.parse(document).length)throw conflict();}
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}

function checked(studio){
  const present=Object.hasOwn(studio||{},'publications'),value=Publication.normalize(studio?.publications);
  return {present,value};
}
function metadata(studio){const {present,value}=checked(studio),{slots,records,...meta}=value;return {present,value:meta};}
async function scopePayload(slot){const {shifts,...value}=slot;return {value,shiftOrder:shifts.map(shift=>shift.id),shiftsDigest:await checksum(canonical(shifts))};}
function windowValue(kind,value){
  if(kind==='state')return {present:value.present,value:{version:1,sequence:value.value.sequence,scopeLinks:[]}};
  const slot=value.value,location=Object.fromEntries(['index','id','name','address','color'].map(key=>[key,slot.location?.[key]]));
  return {value:{from:slot.from,to:slot.to,site:slot.site,location,publicationId:slot.publicationId,at:slot.at,actor:{userId:slot.actor?.userId,name:slot.actor?.name}},shiftOrder:[],shiftsDigest:''};
}
async function windowConfig(kind,value){
  const projected=windowValue(kind,value),serialized=canonical(projected),config=JSON.stringify({sha256:await checksum(serialized),value:projected});
  if(encode.encode(config).byteLength>PUBLICATION_CHUNK_BYTES){const error=new Error('Udgivelsens kalenderoverskrift er for stor. Eksisterende data er bevaret.');error.status=413;error.code='publication_heading_too_large';throw error;}
  return config;
}
const payloadVersion=(kind,row)=>kind==='record'?1:row.payload_version??row.version;
const idFor=(kind,row)=>kind==='state'?'state':row[stores[kind].key];
const nextVersion=row=>{const version=row?.version??0;if(!Number.isSafeInteger(version)||version<0||version>=Number.MAX_SAFE_INTEGER)throw new RangeError('Udgivelsespostens version kan ikke øges sikkert. Kontakt administratoren.');return version+1;};

async function pack(value){
  const serialized=canonical(value),bytes=encode.encode(serialized);
  if(bytes.byteLength>MAX_PAYLOAD_BYTES)throw new RangeError('Udgivelsesposten er for stor til én handling.');
  const sha256=await checksum(bytes),parts=[];
  if(bytes.byteLength>PUBLICATION_CHUNK_BYTES){for(let start=0;start<bytes.length;){let end=Math.min(start+PUBLICATION_CHUNK_BYTES,bytes.length);while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;parts.push(decode.decode(bytes.subarray(start,end)));start=end;}}
  return {config:parts.length?JSON.stringify({sha256}):'{"sha256":"'+sha256+'","value":'+serialized+'}',byte_length:bytes.byteLength,chunk_count:parts.length,parts};
}

async function unpack(db,workspaceId,kind,row){
  if(!Number.isSafeInteger(row.byte_length)||row.byte_length<1||row.byte_length>MAX_PAYLOAD_BYTES||!Number.isSafeInteger(row.chunk_count)||row.chunk_count<0||row.chunk_count>Math.ceil(MAX_PAYLOAD_BYTES/PUBLICATION_CHUNK_BYTES)+1||Boolean(row.chunk_count)!==(row.byte_length>PUBLICATION_CHUNK_BYTES)||typeof row.write_token!=='string'||!row.write_token)throw invalid();
  if(kind==='record'){if(!Number.isSafeInteger(row.position)||row.position<0)throw invalid();}
  else if(!Number.isSafeInteger(row.version)||row.version<1||kind!=='state'&&(!Number.isSafeInteger(row.payload_version)||row.payload_version<1||row.payload_version>row.version||![0,1].includes(row.deleted)))throw invalid();
  let envelope;try{envelope=JSON.parse(row.config);}catch{throw invalid();}
  if(!record(envelope)||typeof envelope.sha256!=='string'||!/^[a-f0-9]{64}$/.test(envelope.sha256))throw invalid();
  let serialized;
  if(row.chunk_count){
    if(Object.hasOwn(envelope,'value'))throw invalid();const parts=[];
    for(let offset=0;offset<row.chunk_count;offset+=4){const chunks=await rows(db,`SELECT chunk_index,content FROM workspace_publication_chunks WHERE workspace_id=? AND entity_type=? AND entity_id=? AND version=? AND chunk_index>=? AND chunk_index<? ORDER BY chunk_index`,workspaceId,kind,idFor(kind,row),payloadVersion(kind,row),offset,Math.min(offset+4,row.chunk_count));
      if(chunks.length!==Math.min(4,row.chunk_count-offset))throw conflict();
      for(const chunk of chunks){if(chunk.chunk_index!==parts.length||typeof chunk.content!=='string'||encode.encode(chunk.content).byteLength>PUBLICATION_CHUNK_BYTES)throw invalid();parts.push(chunk.content);}
    }
    serialized=parts.join('');
  }else{if(!Object.hasOwn(envelope,'value'))throw invalid();serialized=canonical(envelope.value);}
  if(encode.encode(serialized).byteLength!==row.byte_length||await checksum(serialized)!==envelope.sha256)throw invalid();
  try{return JSON.parse(serialized);}catch{throw invalid();}
}

function groups(values,size=128){const result=[];for(let start=0;start<values.length;start+=size)result.push(values.slice(start,start+size));return result;}
async function currentRows(db,workspaceId,kind,ids){
  const store=stores[kind],result=[];
  const columns=store.fields.filter(field=>!['config','window_config'].includes(field)).map(field=>'target.'+field).join(',');
  for(const batch of groups([...new Set(ids)]))result.push(...await rows(db,`SELECT ${columns} FROM json_each(?) chosen CROSS JOIN ${store.table} target WHERE target.workspace_id=? AND target.${store.key}=chosen.value`,JSON.stringify(batch),workspaceId));
  return new Map(result.map(row=>[row[store.key],row]));
}

async function hydratePayloads(db,workspaceId,kind,headers){
  const store=stores[kind],result=new Map(),batches=[];let current=[],size=0;
  for(const header of headers){const estimate=header.chunk_count?200:header.byte_length+200;if(current.length&&(current.length>=128||size+estimate>READ_BYTES)){batches.push(current);current=[];size=0;}current.push(header);size+=estimate;}
  if(current.length)batches.push(current);
  for(const batch of batches){
    const expected=batch.map(row=>({id:idFor(kind,row),version:kind==='record'?1:row.version,token:row.write_token}));
    const data=await rows(db,`SELECT target.* FROM json_each(?) chosen CROSS JOIN ${store.table} target WHERE target.workspace_id=? AND target.${store.key}=json_extract(chosen.value,'$.id') AND ${kind==='record'?'1':'target.version'}=json_extract(chosen.value,'$.version') AND target.write_token=json_extract(chosen.value,'$.token') AND length(CAST(target.config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,JSON.stringify(expected),workspaceId);
    if(data.length!==batch.length)throw conflict();
    for(const row of data)result.set(idFor(kind,row),{row,value:await unpack(db,workspaceId,kind,row)});
  }
  return result;
}

export async function publicationHydrate({db,workspaceId,studio,personId,from,to}){
  const state=await first(db,`SELECT * FROM workspace_publication_state WHERE workspace_id=? AND length(CAST(config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,workspaceId);
  if(!state)throw conflict();
  const meta=await unpack(db,workspaceId,'state',state);
  if(!record(meta)||typeof meta.present!=='boolean'||!record(meta.value)||meta.value.version!==1||meta.value.sequence!==state.sequence||!Number.isSafeInteger(state.version)||state.version<1)throw invalid();
  const shiftWhere=['workspace_id=?','deleted=0'],args=[workspaceId];
  if(personId!==undefined){if(typeof personId!=='string'||!personId)throw new TypeError('Vælg en gyldig medarbejder.');shiftWhere.push('person_id=?');args.push(personId);}
  for(const [value,sql]of [[from,'work_date>=?'],[to,'work_date<=?']])if(value!==undefined){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new TypeError('Vælg en gyldig udgivelsesperiode.');shiftWhere.push(sql);args.push(value);}
  const shiftHeaders=await rows(db,`SELECT id,scope_key,person_id,work_date,site,start_time,end_time,version,deleted,byte_length,chunk_count,payload_version,write_token FROM workspace_published_shifts WHERE ${shiftWhere.join(' AND ')} ORDER BY scope_key,work_date,start_time,id`,...args);
  const scopeWhere=['workspace_id=?','deleted=0'],scopeArgs=[workspaceId];
  if(personId!==undefined){scopeWhere.push('scope_key IN (SELECT value FROM json_each(?))');scopeArgs.push(JSON.stringify([...new Set(shiftHeaders.map(row=>row.scope_key))]));}
  else{if(from!==undefined){scopeWhere.push('to_date>=?');scopeArgs.push(from);}if(to!==undefined){scopeWhere.push('from_date<=?');scopeArgs.push(to);}}
  const scopeHeaders=await rows(db,`SELECT scope_key,from_date,to_date,site,version,deleted,byte_length,chunk_count,payload_version,write_token FROM workspace_publication_scopes WHERE ${scopeWhere.join(' AND ')} ORDER BY scope_key`,...scopeArgs);
  const scopes=await hydratePayloads(db,workspaceId,'scope',scopeHeaders),shifts=await hydratePayloads(db,workspaceId,'shift',shiftHeaders),slots={};
  const scopeCounts=new Map();for(const [id,{row,value}]of shifts){if(!record(value)||value.id!==id||value.person!==row.person_id||value.date!==row.work_date||value.site!==row.site||value.start!==row.start_time||value.end!==row.end_time||!scopes.has(row.scope_key))throw invalid();scopeCounts.set(row.scope_key,(scopeCounts.get(row.scope_key)||0)+1);}
  for(const [key,{row,value}]of scopes){
    if(!record(value)||!record(value.value)||!Array.isArray(value.shiftOrder)||typeof value.shiftsDigest!=='string'||value.value.from!==row.from_date||value.value.to!==row.to_date||value.value.site!==row.site)throw invalid();
    const selected=value.shiftOrder.filter(id=>shifts.has(id)&&shifts.get(id).row.scope_key===key).map(id=>shifts.get(id).value);
    if(personId===undefined&&from===undefined&&to===undefined&&(selected.length!==value.shiftOrder.length||(scopeCounts.get(key)||0)!==value.shiftOrder.length||await checksum(canonical(selected))!==value.shiftsDigest))throw invalid();
    slots[key]={...value.value,shifts:selected};
  }
  let records=[];
  if(personId===undefined){const headers=await rows(db,'SELECT id,position,at,byte_length,chunk_count,write_token FROM workspace_publication_records WHERE workspace_id=? ORDER BY position DESC,id DESC LIMIT 100',workspaceId),loaded=await hydratePayloads(db,workspaceId,'record',headers);records=headers.reverse().map(row=>loaded.get(row.id).value);}
  const publications={...(personId===undefined?meta.value:{version:1,sequence:meta.value.sequence}),slots,records};
  if(Publication.validate(publications).length)throw invalid();
  const result={...studio};if(meta.present)result.publications=publications;else{if(Object.keys(slots).length||records.length)throw invalid();delete result.publications;}return result;
}

export async function readPublicationMetadata({db,workspaceId}){
  const state=await first(db,`SELECT * FROM workspace_publication_state WHERE workspace_id=? AND length(CAST(config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,workspaceId);if(!state)throw conflict();
  const meta=await unpack(db,workspaceId,'state',state);if(!record(meta)||typeof meta.present!=='boolean'||!record(meta.value)||meta.value.version!==1||meta.value.sequence!==state.sequence||Publication.validate({...meta.value,slots:{},records:[]}).length)throw invalid();return {state,meta};
}

/* Authoritative replacement context contains entire target scopes, never a
 * calendar slice. The caller fences the enclosing plan generation at commit. */
export async function readPublicationCommandContext({db,workspaceId,scopeKeys=[]}){
  if(!Array.isArray(scopeKeys)||scopeKeys.length>10000)throw selectionTooLarge();for(const key of scopeKeys)scopeParts(key);
  const {state,meta}=await readPublicationMetadata({db,workspaceId}),scopeHeaders=await currentRows(db,workspaceId,'scope',scopeKeys),active=[...scopeHeaders.values()].filter(row=>!row.deleted),scopes=await hydratePayloads(db,workspaceId,'scope',active),shiftHeaders=[];
  let bytes=0;for(const batch of groups(active.map(row=>row.scope_key))){let after='';while(true){const found=await rows(db,`SELECT id,scope_key,person_id,work_date,site,start_time,end_time,version,deleted,byte_length,chunk_count,payload_version,write_token FROM workspace_published_shifts WHERE workspace_id=? AND deleted=0 AND scope_key IN (SELECT value FROM json_each(?)) AND id>? ORDER BY id LIMIT 500`,workspaceId,JSON.stringify(batch),after);for(const row of found){bytes+=row.byte_length;if(shiftHeaders.length>=50000||bytes>64*1024*1024)throw selectionTooLarge();shiftHeaders.push(row);}if(found.length<500)break;after=found.at(-1).id;}}
  const loaded=await hydratePayloads(db,workspaceId,'shift',shiftHeaders),counts=new Map(),slots={};
  for(const [id,{row,value}]of loaded){if(!record(value)||value.id!==id||value.person!==row.person_id||value.date!==row.work_date||value.site!==row.site||value.start!==row.start_time||value.end!==row.end_time||!scopes.has(row.scope_key))throw invalid();counts.set(row.scope_key,(counts.get(row.scope_key)||0)+1);}
  for(const [key,{row,value}]of scopes){if(!record(value)||!record(value.value)||!Array.isArray(value.shiftOrder)||typeof value.shiftsDigest!=='string'||value.value.from!==row.from_date||value.value.to!==row.to_date||value.value.site!==row.site)throw invalid();const selected=value.shiftOrder.map(id=>loaded.get(id)).filter(item=>item?.row.scope_key===key).map(item=>item.value);if(selected.length!==value.shiftOrder.length||selected.length!==(counts.get(key)||0)||await checksum(canonical(selected))!==value.shiftsDigest)throw invalid();slots[key]={...value.value,shifts:selected};}
  const publications={...meta.value,slots,records:[]};if(Publication.validate(publications).length||!meta.present&&Object.keys(slots).length)throw invalid();
  const scopeCount=Number((await first(db,'SELECT COUNT(*) AS n FROM workspace_publication_scopes WHERE workspace_id=? AND deleted=0',workspaceId))?.n||0);return {state,meta,scopeHeaders,scopeCount,studio:{...(meta.present?{publications}:{})}};
}

export async function preparePublicationCommandWrite({db,workspaceId,before,after,scopeKeys=[],condition,token,at}){
  const allowed=new Set(scopeKeys);for(const key of allowed)scopeParts(key);const old=checked(before).value,next=checked(after).value;
  for(const key of new Set([...Object.keys(old.slots),...Object.keys(next.slots)]))if(!same(old.slots[key]||null,next.slots[key]||null)&&!allowed.has(key))throw new TypeError('Udgivelsen forsøger at ændre en uge uden for det indlæste område.');
  const count=Number((await first(db,'SELECT COUNT(*) AS n FROM workspace_publication_scopes WHERE workspace_id=? AND deleted=0',workspaceId))?.n||0),current=await currentRows(db,workspaceId,'scope',[...allowed]),added=Object.keys(next.slots).filter(key=>!current.has(key)||current.get(key).deleted).length,removed=Object.keys(old.slots).filter(key=>!Object.hasOwn(next.slots,key)&&current.get(key)?.deleted===0).length;if(count+added-removed>10000)throw selectionTooLarge();
  return prepare({db,workspaceId,before,after,condition,token,at,importing:false});
}

function windowPeriod(from,to){
  const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  if(!valid(from)||!valid(to)||from>to||from<Data.minDate||to>Data.maxDate||(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000>=56){const error=new Error('Vælg højst 56 gyldige kalenderdage.');error.status=400;error.code='invalid_calendar_window';throw error;}
}

function scopeParts(key){
  const match=typeof key==='string'&&/^(\d{4}-\d{2}-\d{2})\|(\d{1,4})$/.exec(key);if(!match)throw invalid();const from=match[1],site=Number(match[2]),date=new Date(from+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==from||date.getUTCDay()!==1||from<Data.minDate||from>Data.maxDate||site<0||site>=2000)throw invalid();date.setUTCDate(date.getUTCDate()+6);const to=date.toISOString().slice(0,10);if(to>Data.maxDate)throw invalid();return {from,to,site};
}
const scopeKey=shift=>{const date=new Date(shift.date+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==shift.date||!Number.isInteger(shift.site)||shift.site<0||shift.site>=2000)throw invalid();date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const key=date.toISOString().slice(0,10)+'|'+shift.site;scopeParts(key);return key;};
function groupedScopes(keys){const weeks=new Map();for(const key of [...keys].sort()){const {from,to,site}=scopeParts(key);if(!weeks.has(from))weeks.set(from,{from,to,siteIds:[]});weeks.get(from).siteIds.push(site);}return [...weeks.values()].map(scope=>({...scope,siteIds:scope.siteIds.sort((a,b)=>a-b)}));}
function selectionRanges(scopes){const weeks=[...new Map(scopes.map(scope=>[scope.from,{from:scope.from,to:scope.to}])).values()].sort((a,b)=>a.from.localeCompare(b.from)),result=[];for(const range of weeks){const last=result.at(-1);if(last&&(Date.parse(range.from)-Date.parse(last.to))/86400000<=1&&(Date.parse(range.to)-Date.parse(last.from))/86400000<366)last.to=range.to;else result.push({...range});}return result;}
function initialScopeKeys(projection){
  const {from,to,siteIds}=projection||{};let valid=typeof from==='string'&&typeof to==='string'&&from<=to&&Array.isArray(siteIds)&&siteIds.length&&new Set(siteIds).size===siteIds.length;
  try{scopeParts(from+'|0');const end=new Date(to+'T12:00:00Z');valid=valid&&Number.isFinite(end.getTime())&&end.toISOString().slice(0,10)===to&&end.getUTCDay()===0&&(Date.parse(to)-Date.parse(from))/86400000<366;}catch{valid=false;}
  if(!valid||siteIds.some(site=>!Number.isInteger(site)||site<0||site>=2000)){const error=new Error('Vælg hele uger og gyldige arbejdssteder til udgivelse.');error.status=400;error.code='invalid_publication_scope';throw error;}
  const keys=new Set();for(let day=from;day<=to;){for(const site of siteIds)keys.add(day+'|'+site);const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+7);day=date.toISOString().slice(0,10);}if(keys.size>10000)throw selectionTooLarge();return keys;
}
function selectionTooLarge(){const error=new Error('For mange forbundne uger eller arbejdssteder. Vælg en mindre udgivelse.');error.status=413;error.code='publication_selection_too_large';return error;}
function normalizedLinks(value){
  if(value===undefined)return [];if(!Array.isArray(value)||value.length>20000)throw invalid();const result=new Map();
  for(const link of value){if(!record(link))throw invalid();scopeParts(link.from);scopeParts(link.to);if(link.from===link.to)continue;const [left,right]=[link.from,link.to].sort();result.set(left+'>'+right,{from:left,to:right});}return [...result.values()].sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
}
function linkStatements(db,workspaceId,links,condition){
  const result=[statement(db,`DELETE FROM workspace_publication_links WHERE workspace_id=? AND ${condition.sql}`,workspaceId,...condition.values)];
  for(const batch of groups(links))result.push(statement(db,`INSERT INTO workspace_publication_links (workspace_id,left_scope,right_scope) SELECT ?,json_extract(edge.value,'$.from'),json_extract(edge.value,'$.to') FROM json_each(?) edge WHERE ${condition.sql}`,workspaceId,JSON.stringify(batch),...condition.values));
  result.push(statement(db,`INSERT INTO workspace_publication_link_imports (workspace_id,state_version,state_token) SELECT workspace_id,version,write_token FROM workspace_publication_state WHERE workspace_id=? AND ${condition.sql} ON CONFLICT(workspace_id) DO UPDATE SET state_version=excluded.state_version,state_token=excluded.state_token`,workspaceId,...condition.values));return result;
}

export async function ensurePublicationLinks({db,workspaceId}){
  const state=await first(db,'SELECT version,write_token FROM workspace_publication_state WHERE workspace_id=?',workspaceId);if(!state)throw conflict();
  const marker=await first(db,'SELECT state_version,state_token FROM workspace_publication_link_imports WHERE workspace_id=?',workspaceId);if(marker?.state_version===state.version&&marker.state_token===state.write_token)return;
  const header=await first(db,`SELECT * FROM workspace_publication_state WHERE workspace_id=? AND version=? AND write_token=? AND length(CAST(config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,workspaceId,state.version,state.write_token);if(!header)throw conflict();
  const meta=await unpack(db,workspaceId,'state',header);if(!record(meta)||!record(meta.value)||meta.value.version!==1||meta.value.sequence!==header.sequence)throw invalid();
  const condition={sql:'EXISTS (SELECT 1 FROM workspace_publication_state current WHERE current.workspace_id=? AND current.version=? AND current.write_token=?)',values:[workspaceId,state.version,state.write_token]};
  await db.batch(linkStatements(db,workspaceId,normalizedLinks(meta.value.scopeLinks),condition));
  const committed=await first(db,'SELECT 1 AS ready FROM workspace_publication_link_imports marker JOIN workspace_publication_state current ON current.workspace_id=marker.workspace_id AND current.version=marker.state_version AND current.write_token=marker.state_token WHERE marker.workspace_id=? AND current.version=? AND current.write_token=?',workspaceId,state.version,state.write_token);if(!committed)throw conflict();
}

async function adjacentLinks(db,workspaceId,keys){
  const result=new Map();for(const batch of groups(keys)){const serialized=JSON.stringify(batch);let after=null;while(true){const found=await rows(db,`SELECT left_scope,right_scope FROM (SELECT left_scope,right_scope FROM workspace_publication_links WHERE workspace_id=? AND left_scope IN (SELECT value FROM json_each(?)) UNION SELECT left_scope,right_scope FROM workspace_publication_links WHERE workspace_id=? AND right_scope IN (SELECT value FROM json_each(?))) ${after?'WHERE (left_scope,right_scope)>(?,?)':''} ORDER BY left_scope,right_scope LIMIT 500`,workspaceId,serialized,workspaceId,serialized,...(after?[after.left_scope,after.right_scope]:[]));for(const row of found){scopeParts(row.left_scope);scopeParts(row.right_scope);result.set(row.left_scope+'>'+row.right_scope,{from:row.left_scope,to:row.right_scope});}if(found.length<500)break;after=found.at(-1);}}return [...result.values()];
}

export async function publicationSelection({db,workspaceId,projection,draftForScopes,currentForIds}){
  if(typeof draftForScopes!=='function'||typeof currentForIds!=='function')throw new TypeError('Udgivelsens kladdeopslag mangler.');
  const initial=initialScopeKeys(projection),keys=new Set(initial),links=new Map();let frontier=[...initial];await ensurePublicationLinks({db,workspaceId});
  const add=(key,next)=>{scopeParts(key);if(!keys.has(key)){keys.add(key);next.add(key);if(keys.size>10000)throw selectionTooLarge();}};
  while(frontier.length){
    const next=new Set();for(const link of await adjacentLinks(db,workspaceId,frontier)){links.set(link.from+'>'+link.to,link);add(link.from,next);add(link.to,next);}
    for(const batch of groups(frontier)){
      let after='';while(true){const headers=await rows(db,`SELECT id,scope_key FROM workspace_published_shifts WHERE workspace_id=? AND deleted=0 AND scope_key IN (SELECT value FROM json_each(?)) AND id>? ORDER BY id LIMIT 500`,workspaceId,JSON.stringify(batch),after);if(!headers.length)break;const current=await currentForIds(headers.map(row=>row.id));if(!(current instanceof Map))throw new TypeError('Udgivelsens vagtindeks er ugyldigt.');for(const row of headers){const shift=current.get(row.id);if(shift)add(scopeKey(shift),next);}if(headers.length<500)break;after=headers.at(-1).id;}
    }
    const drafts=await draftForScopes(groupedScopes(frontier));if(!Array.isArray(drafts))throw new TypeError('Udgivelsens kladder er ugyldige.');
    for(const batch of groups(drafts.map(shift=>shift.id))){const published=await currentRows(db,workspaceId,'shift',batch);for(const row of published.values())if(!row.deleted)add(row.scope_key,next);}
    frontier=[...next];
  }
  const scopes=groupedScopes(keys),dependencies=groupedScopes([...keys].filter(key=>!initial.has(key)));return {scopeKeys:[...keys].sort(),scopes,dependencies,ranges:selectionRanges(scopes),scopeLinks:[...links.values()].sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to))};
}

export function projectPublicationSelection(studio,projection){
  const publication=projection.mode==='publication',expanded=publication?Publication.expandScope(studio,projection):{scopes:[],dependencies:[]},keys=publication?new Set(expanded.scopes.flatMap(scope=>[...initialScopeKeys(scope)])):new Set(),value=studio.publications||Publication.empty();
  const scopeInfo={scopeKeys:[...keys].sort(),scopes:expanded.scopes,dependencies:expanded.dependencies,ranges:selectionRanges(expanded.scopes)},rows=publicationProjectionRows(studio,keys,projection.calendar,normalizedLinks(value.scopeLinks).filter(link=>keys.has(link.from)&&keys.has(link.to)));return {rows,scopeInfo};
}

function publicationProjectionRows(studio,keys,calendar,links=[]){
  if(calendar)windowPeriod(calendar.from,calendar.to);const value=studio.publications||Publication.empty();if(Publication.validate(value).length)throw invalid();const meta=windowValue('state',{present:Object.hasOwn(studio,'publications'),value});meta.value.scopeLinks=clone(links);const result=[{kind:'state',id:'state',value:meta}];
  for(const [id,slot]of Object.entries(value.slots).sort(([a],[b])=>a.localeCompare(b)))if(keys.has(id)||calendar&&slot.from<=calendar.to&&slot.to>=calendar.from){result.push({kind:'scope',id,value:windowValue('scope',{value:slot})});for(const shift of slot.shifts)if(keys.has(id)||calendar&&shift.date>=calendar.from&&shift.date<=calendar.to)result.push({kind:'shift',id:shift.id,value:{scopeKey:id,shift:clone(shift)}});}return result;
}

/* A window is a read projection, never an authoritative publication replacement. */
export function projectPublicationWindow(studio,{from,to}){
  windowPeriod(from,to);const present=Object.hasOwn(studio||{},'publications'),value=studio?.publications||Publication.empty();if(Publication.validate(value).length)throw invalid();const result=[{kind:'state',id:'state',value:windowValue('state',{present,value})}];
  for(const [id,slot]of Object.entries(value.slots).sort(([one],[two])=>one.localeCompare(two)))if(slot.from<=to&&slot.to>=from){
    result.push({kind:'scope',id,value:windowValue('scope',{value:slot})});
    for(const shift of slot.shifts.filter(item=>item.date>=from&&item.date<=to).sort((one,two)=>one.id.localeCompare(two.id)))result.push({kind:'shift',id:shift.id,value:{scopeKey:id,shift:clone(shift)}});
  }
  return result;
}

async function decodeWindow(kind,row){
  if(!Number.isSafeInteger(row.version)||row.version<1||row.window_version!==row.version)throw invalid();
  let envelope;try{envelope=JSON.parse(row.window_config);}catch{throw invalid();}
  if(!record(envelope)||!record(envelope.value)||typeof envelope.sha256!=='string'||await checksum(canonical(envelope.value))!==envelope.sha256)throw invalid();
  const value=envelope.value;
  if(kind==='state'){
    if(typeof value.present!=='boolean'||value.value?.version!==1||!Number.isSafeInteger(row.sequence)||row.sequence<0||row.sequence>=Number.MAX_SAFE_INTEGER||value.value.sequence!==row.sequence||!Array.isArray(value.value.scopeLinks)||value.value.scopeLinks.length)throw invalid();
  }else{
    const slot=value.value;if(!record(slot)||slot.from!==row.from_date||slot.to!==row.to_date||slot.site!==row.site||!Array.isArray(value.shiftOrder)||value.shiftOrder.length||value.shiftsDigest!==''||Publication.validate({version:1,sequence:0,records:[],slots:{[row.scope_key]:{...slot,shifts:[]}}}).length)throw invalid();
  }
  return value;
}

async function readWindowHeaders(db,workspaceId,kind,headers){
  const store=stores[kind],result=new Map(),expected=headers.map(row=>({id:idFor(kind,row),version:row.version,token:row.write_token}));
  if(!expected.length)return result;
  const columns=store.fields.filter(field=>field!=='config').map(field=>'target.'+field).join(',');
  const selected=await rows(db,`SELECT ${columns},CASE WHEN target.window_version=target.version AND target.window_config<>'' THEN NULL ELSE target.config END AS config FROM json_each(?) chosen CROSS JOIN ${store.table} target WHERE target.workspace_id=? ${store.key?'AND target.'+store.key+"=json_extract(chosen.value,'$.id')":''} AND target.version=json_extract(chosen.value,'$.version') AND target.write_token=json_extract(chosen.value,'$.token') AND length(CAST(target.window_config AS BLOB))<=${PUBLICATION_CHUNK_BYTES} AND length(CAST(target.config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,JSON.stringify(expected),workspaceId);
  if(selected.length!==headers.length)throw conflict();
  for(const row of selected){
    if(row.window_version!==row.version||!row.window_config){
      // Upgrading an older normalized row is fenced and affects only the requested
      // headings. Warm reads never download its full shiftOrder/global metadata.
      const config=await windowConfig(kind,await unpack(db,workspaceId,kind,row)),written=await db.batch([statement(db,`UPDATE ${store.table} SET window_config=?,window_version=version WHERE workspace_id=? ${store.key?'AND '+store.key+'=?':''} AND version=? AND write_token=?`,config,workspaceId,...(store.key?[row[store.key]]:[]),row.version,row.write_token)]);
      if(written[0]?.meta?.changes!==1)throw conflict();row.window_config=config;row.window_version=row.version;
    }
    result.set(idFor(kind,row),await decodeWindow(kind,row));
  }
  return result;
}

export async function ensurePublicationWindowMetadata({db,workspaceId}){
  const state=await first(db,'SELECT version,sequence,write_token FROM workspace_publication_state WHERE workspace_id=?',workspaceId);if(!state)throw conflict();
  return (await readWindowHeaders(db,workspaceId,'state',[state])).get('state');
}

/* Metadata-first keyset pages. The outer studio reader pins plan and absence
 * generations across pages and retries a concurrent replacement. An individual
 * existing long description may exceed the soft byte budget; it is never cut. */
export async function publicationWindowPage(options){
  const {from,to}=options;windowPeriod(from,to);return publicationReadPage({...options,scopeFilter:{sql:'from_date<=? AND to_date>=?',values:[to,from]},shiftFilter:{sql:'work_date>=? AND work_date<=?',values:[from,to]},withAbsences:true});
}

export async function publicationSelectionPage({selection,calendar,...options}){
  const keys=selection?.scopeKeys||[];if(!Array.isArray(keys)||keys.length>10000)throw selectionTooLarge();for(const key of keys)scopeParts(key);if(calendar)windowPeriod(calendar.from,calendar.to);
  const chosen=JSON.stringify(keys),scopeFilter={sql:'scope_key IN (SELECT value FROM json_each(?))',values:[chosen]},shiftFilter={...scopeFilter};
  if(calendar){scopeFilter.sql='('+scopeFilter.sql+' OR (from_date<=? AND to_date>=?))';scopeFilter.values=[chosen,calendar.to,calendar.from];shiftFilter.sql='('+shiftFilter.sql+' OR (work_date>=? AND work_date<=?))';shiftFilter.values=[chosen,calendar.from,calendar.to];}
  return publicationReadPage({...options,scopeFilter,shiftFilter,scopeLinks:selection?.scopeLinks||[],fullScopeKeys:selection?.scopeKeys||[],withAbsences:false});
}

export async function publicationAvailabilityPage({db,workspaceId,ranges,cursor=null,maxRows=500,maxBytes=1024*1024,allowOversized=true}){
  if(!Array.isArray(ranges)||ranges.length>20000||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>500||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>2*1024*1024||cursor!==null&&(!record(cursor)||typeof cursor.date!=='string'||typeof cursor.id!=='string'||!cursor.id||cursor.id.length>512||Object.keys(cursor).some(key=>!['date','id'].includes(key)))){const error=new Error('Planvisningens sidehenvisning er ugyldig.');error.status=400;error.code='invalid_publication_availability_cursor';throw error;}
  for(const range of ranges){if(!record(range)||typeof range.from!=='string'||typeof range.to!=='string'||range.from>range.to||range.from<Data.minDate||range.to>Data.maxDate||![range.from,range.to].every(day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day))throw invalid();}
  const headers=await rows(db,`SELECT DISTINCT target.id,target.person_id,target.work_date,target.site,target.start_time,target.end_time FROM json_each(?) chosen CROSS JOIN workspace_published_shifts target INDEXED BY workspace_published_shifts_window WHERE target.workspace_id=? AND target.deleted=0 AND target.work_date>=json_extract(chosen.value,'$.from') AND target.work_date<=json_extract(chosen.value,'$.to') ${cursor?'AND (target.work_date,target.id)>(?,?)':''} ORDER BY target.work_date,target.id LIMIT ?`,JSON.stringify(ranges),workspaceId,...(cursor?[cursor.date,cursor.id]:[]),maxRows+1);
  const result=[];let bytes=0,last=null;
  for(const row of headers){const item={kind:'availability',id:JSON.stringify(['published',row.id]),value:{kind:'published',id:row.id,value:{id:row.id,person:row.person_id,site:row.site,date:row.work_date,start:row.start_time,end:row.end_time}}},size=encode.encode(JSON.stringify(item)).length;if((result.length||!allowOversized)&&(result.length===maxRows||bytes+size>maxBytes))break;result.push(item);bytes+=size;last=row;}
  if(headers.length&&!result.length)return {auxRows:[],nextCursor:cursor,blocked:true};
  return {auxRows:result,nextCursor:headers.length>result.length?{date:last.work_date,id:last.id}:null};
}

async function publicationReadPage({db,workspaceId,from,to,cursor=null,maxRows=500,maxBytes=1024*1024,scopeFilter,shiftFilter,scopeLinks=[],withAbsences,instructions,fullScopeKeys=[],allowOversized=true}){
  const compactScopes=new Set(fullScopeKeys),compact=header=>instructions==='deferred'&&!compactScopes.has(header.scope_key);
  const stages=withAbsences?['state','scope','shift','absence']:['state','scope','shift'];
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>(withAbsences&&instructions==='deferred'?1000:500)||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>2*1024*1024||cursor!==null&&(!record(cursor)||!stages.includes(cursor.stage)||typeof cursor.after!=='string'||Object.keys(cursor).some(key=>!['stage','after'].includes(key)))){const error=new Error('Kalenderens sideangivelse er ugyldig.');error.status=400;error.code='invalid_calendar_cursor';throw error;}
  const result=[],auxRows=[];let stage=cursor?.stage||'state',after=cursor?.after||'',used=0;
  const size=()=>result.length+auxRows.length;
  const append=(target,value)=>{const bytes=encode.encode(JSON.stringify(value)).length;if((size()||!allowOversized)&&(size()>=maxRows||used+bytes>maxBytes))return false;target.push(value);used+=bytes;return true;};
  const page=nextCursor=>({rows:result,auxRows,nextCursor,...(nextCursor&&!size()?{blocked:true}:{})});
  if(stage==='state'){
    const value=await ensurePublicationWindowMetadata({db,workspaceId});value.value.scopeLinks=clone(scopeLinks);if(!append(result,{kind:'state',id:'state',value}))return page({stage,after});stage='scope';after='';
  }
  while(true){
    if(size()>=maxRows||used>=maxBytes)return page({stage,after});
    const remaining=maxRows-size(),whereAfter=after?' AND '+(stage==='scope'?'scope_key':'id')+'>?':'';
    let headers;
    if(stage==='scope')headers=await rows(db,`SELECT scope_key,from_date,to_date,site,version,write_token,window_version,length(CAST(window_config AS BLOB)) AS window_bytes FROM workspace_publication_scopes WHERE workspace_id=? AND deleted=0 AND (${scopeFilter.sql})${whereAfter} ORDER BY scope_key LIMIT ?`,workspaceId,...scopeFilter.values,...(after?[after]:[]),remaining+1);
    else if(stage==='shift')headers=await rows(db,`SELECT ${employeeColumns},deleted,byte_length,chunk_count,payload_version FROM workspace_published_shifts WHERE workspace_id=? AND deleted=0 AND (${shiftFilter.sql})${whereAfter} ORDER BY id LIMIT ?`,workspaceId,...shiftFilter.values,...(after?[after]:[]),remaining+1);
    else headers=await rows(db,`SELECT id,person_id,from_date,to_date,type,status,version,length(CAST(json_extract(config,'$.days') AS BLOB)) AS days_bytes FROM workspace_absences WHERE workspace_id=? AND status IN ('approved','pending') AND from_date<=? AND to_date>=?${whereAfter} ORDER BY id LIMIT ?`,workspaceId,to,from,...(after?[after]:[]),remaining+1);
    if(!headers.length){if(stage===stages.at(-1))return page(null);stage=stages[stages.indexOf(stage)+1];after='';continue;}
    const selected=[];let estimate=used;
    for(const header of headers){const estimated=(stage==='scope'?(header.window_version===header.version&&header.window_bytes?header.window_bytes:PUBLICATION_CHUNK_BYTES):stage==='shift'?(compact(header)?512:header.byte_length):header.days_bytes+encode.encode(JSON.stringify(header)).length)+512;if(size()+selected.length>=maxRows||(size()+selected.length||!allowOversized)&&estimate+estimated>maxBytes)break;selected.push(header);estimate+=estimated;}
    if(!selected.length)return page({stage,after});
    let loaded;
    if(stage==='scope')loaded=await readWindowHeaders(db,workspaceId,'scope',selected);
    else if(stage==='shift'){
      const summarized=selected.filter(compact),full=selected.filter(header=>!compact(header));loaded=await hydratePayloads(db,workspaceId,'shift',full);await employeeDescriptors(db,workspaceId,summarized);
      const pauses=await readPublishedTimeShifts({db,workspaceId,ids:summarized.map(row=>row.id)}),pauseById=new Map(pauses.map(shift=>[shift.id,shift.plannedBreakMinutes]));
      if(summarized.length){const matching=await first(db,`SELECT COUNT(*) n FROM json_each(?) chosen CROSS JOIN workspace_published_shifts current WHERE current.workspace_id=? AND current.id=json_extract(chosen.value,'$.id') AND current.version=json_extract(chosen.value,'$.version') AND current.write_token=json_extract(chosen.value,'$.token') AND current.deleted=0`,JSON.stringify(summarized.map(row=>({id:row.id,version:row.version,token:row.write_token}))),workspaceId);if(matching?.n!==summarized.length)throw conflict();}
      for(const row of summarized){if(!pauseById.has(row.id))throw conflict();loaded.set(row.id,{row,value:{id:row.id,person:row.person_id,date:row.work_date,site:row.site,start:row.start_time,end:row.end_time,plannedBreakMinutes:pauseById.get(row.id),_instructions:{token:row.instruction_token,hasDescription:row.has_description===1}}});}
    }
    else{
      const found=await rows(db,`SELECT a.id,a.person_id,a.from_date,a.to_date,a.type,a.status,a.version,json_extract(a.config,'$.days') AS days FROM json_each(?) chosen CROSS JOIN workspace_absences a WHERE a.workspace_id=? AND a.id=json_extract(chosen.value,'$.id') AND a.version=json_extract(chosen.value,'$.version') AND length(CAST(json_extract(a.config,'$.days') AS BLOB))<=json_extract(chosen.value,'$.days_bytes') ORDER BY a.id`,JSON.stringify(selected.map(({id,version,days_bytes})=>({id,version,days_bytes}))),workspaceId);
      if(found.length!==selected.length)throw conflict();loaded=new Map(found.map(row=>[row.id,row]));
    }
    for(const header of selected){
      const id=stage==='scope'?header.scope_key:header.id;let value;
      if(stage==='scope')value={kind:'scope',id,value:loaded.get(id)};
      else if(stage==='shift'){
        const {row,value:shift}=loaded.get(id);if(!record(shift)||shift.id!==id||shift.person!==row.person_id||shift.date!==row.work_date||shift.site!==row.site||shift.start!==row.start_time||shift.end!==row.end_time)throw invalid();
        value={kind:'shift',id,value:{scopeKey:row.scope_key,shift}};
      }else{
        const row=loaded.get(id);let days;try{days=JSON.parse(row.days);}catch{throw invalid();}
        if(!Array.isArray(days)||!days.length||days.length>366||days[0]!==row.from_date||days.at(-1)!==row.to_date||days.some(day=>typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)))throw invalid();
        value={kind:'absence',id,value:{id,p:row.person_id,type:row.type,status:row.status,version:row.version,days,dates:row.from_date===row.to_date?row.from_date:row.from_date+' – '+row.to_date}};
      }
      if(!append(stage==='absence'?auxRows:result,value))return page({stage,after});after=id;
    }
    if(selected.length<headers.length)return page({stage,after});
    if(stage===stages.at(-1))return page(null);stage=stages[stages.indexOf(stage)+1];after='';
  }
}

function batches(values){const result=[];let current=[],size=0;for(const value of values){const bytes=encode.encode(JSON.stringify(value)).byteLength;if(current.length&&(current.length>=128||size+bytes>PUBLICATION_CHUNK_BYTES)){result.push(current);current=[];size=0;}current.push(value);size+=bytes;}if(current.length)result.push(current);return result;}
function upserts(db,workspaceId,kind,values,condition,importing){
  const store=stores[kind],columns=['workspace_id',...store.fields],updates=store.fields.filter(field=>field!==store.key).map(field=>`${field}=excluded.${field}`).join(','),result=[];
  for(const batch of batches(values)){const query=`INSERT INTO ${store.table} (${columns.join(',')}) SELECT ?,${store.fields.map(field=>`json_extract(source.value,'$.${field}')`).join(',')} FROM json_each(?) source WHERE ${condition.sql} ON CONFLICT(workspace_id${store.key?','+store.key:''}) ${importing||kind==='record'?'DO NOTHING':`DO UPDATE SET ${updates} WHERE ${store.table}.version=excluded.version-1`}`;result.push(statement(db,query,workspaceId,JSON.stringify(batch),...condition.values));}return result;
}
function chunkWrites(db,workspaceId,kind,items,condition,token){
  const result=[],store=stores[kind];
  for(const item of items)for(let index=0;index<item.parts.length;index++)result.push(statement(db,`INSERT INTO workspace_publication_chunks (workspace_id,entity_type,entity_id,version,chunk_index,content)
    SELECT ?,?,?,?,?,? WHERE ${condition.sql} AND EXISTS (SELECT 1 FROM ${store.table} committed WHERE committed.workspace_id=? ${store.key?'AND committed.'+store.key+'=?':''} AND committed.write_token=?) ON CONFLICT DO NOTHING`,workspaceId,kind,item.id,item.version,index,item.parts[index],...condition.values,workspaceId,...(store.key?[item.id]:[]),token));
  return result;
}
function cleanup(db,workspaceId,kind,condition,token){const store=stores[kind];return statement(db,`DELETE FROM workspace_publication_chunks WHERE workspace_id=? AND entity_type=? AND ${condition.sql} AND EXISTS (SELECT 1 FROM ${store.table} current WHERE current.workspace_id=workspace_publication_chunks.workspace_id ${store.key?'AND current.'+store.key+'=workspace_publication_chunks.entity_id':''} AND current.write_token=? AND workspace_publication_chunks.version<>${kind==='state'?'current.version':'current.payload_version'})`,workspaceId,kind,...condition.values,token);}
function guarded(statements,guard){Object.defineProperty(statements,'guard',{value:guard,enumerable:false});return statements;}
const and=guards=>({sql:guards.length?guards.map(value=>'('+value.sql+')').join(' AND '):'1=1',values:guards.flatMap(value=>value.values)});
function guardDocuments(values){
  const documents=[];let current=[],bytes=2;
  for(const value of values){const serialized=JSON.stringify(value),size=encode.encode(serialized).byteLength;if(size+2>512*1024)throw new RangeError('Udgivelsens post-id er for stort til sikker versionskontrol.');if(current.length&&bytes+size+1>512*1024){documents.push('['+current.join(',')+']');current=[];bytes=2;}current.push(serialized);bytes+=size+1;}
  if(current.length||!documents.length)documents.push('['+current.join(',')+']');return documents;
}
function rowGuard(workspaceId,kind,current,ids){
  const store=stores[kind],expected=ids.map(id=>{const row=current.get(id);return {id,version:row?.version||0,deleted:row?.deleted??1,token:row?.write_token||'',exists:Boolean(row)};});
  const documents=guardDocuments(expected),source=documents.map(()=>'SELECT value FROM json_each(?)').join(' UNION ALL ');
  return {sql:`NOT EXISTS (SELECT 1 FROM (${source}) expected LEFT JOIN ${store.table} current ON current.workspace_id=? AND current.${store.key}=json_extract(expected.value,'$.id') WHERE (current.${store.key} IS NOT NULL)<>json_extract(expected.value,'$.exists') OR COALESCE(current.version,0)<>json_extract(expected.value,'$.version') OR COALESCE(current.deleted,1)<>json_extract(expected.value,'$.deleted') OR COALESCE(current.write_token,'')<>json_extract(expected.value,'$.token'))`,values:[...documents,workspaceId]};
}

async function prepare({db,workspaceId,before,after,condition,token,at,importing}){
  if(!condition||typeof condition.sql!=='string'||!Array.isArray(condition.values)||typeof token!=='string'||!token||typeof at!=='string')throw new TypeError('Udgivelsens versionskontrol mangler.');
  const old=checked(before).value,next=checked(after).value,oldMeta=metadata(before),nextMeta=metadata(after),beforeScopes=new Map(),afterScopes=new Map();
  for(const [key,slot]of Object.entries(old.slots))beforeScopes.set(key,await scopePayload(slot));for(const [key,slot]of Object.entries(next.slots))afterScopes.set(key,await scopePayload(slot));
  const changedScopes=[...new Set([...beforeScopes.keys(),...afterScopes.keys()])].filter(key=>!same(beforeScopes.get(key)||null,afterScopes.get(key)||null));
  const shiftMap=value=>new Map(Object.entries(value.slots).flatMap(([key,slot])=>slot.shifts.map(shift=>[shift.id,{key,value:shift}]))),beforeShifts=shiftMap(old),afterShifts=shiftMap(next),changedShifts=[...new Set([...beforeShifts.keys(),...afterShifts.keys()])].filter(id=>!same(beforeShifts.get(id)||null,afterShifts.get(id)||null));
  const state=await first(db,`SELECT * FROM workspace_publication_state WHERE workspace_id=? AND length(CAST(config AS BLOB))<=${PUBLICATION_CHUNK_BYTES+1024}`,workspaceId),scopeRows=await currentRows(db,workspaceId,'scope',changedScopes),shiftRows=await currentRows(db,workspaceId,'shift',changedShifts),recordRows=await currentRows(db,workspaceId,'record',next.records.map(item=>item.id));
  const scopeValues=importing?new Map():await hydratePayloads(db,workspaceId,'scope',[...scopeRows.values()].filter(row=>beforeScopes.has(row.scope_key)&&!row.deleted)),shiftValues=importing?new Map():await hydratePayloads(db,workspaceId,'shift',[...shiftRows.values()].filter(row=>beforeShifts.has(row.id)&&!row.deleted)),recordValues=await hydratePayloads(db,workspaceId,'record',[...recordRows.values()]);
  const guards=[];let stale=false;
  if(!importing){if(!state||!same(await unpack(db,workspaceId,'state',state),oldMeta))stale=true;else guards.push({sql:'EXISTS (SELECT 1 FROM workspace_publication_state WHERE workspace_id=? AND version=? AND write_token=?)',values:[workspaceId,state.version,state.write_token]});
    for(const [kind,current,stored,expected,ids]of [['scope',scopeRows,scopeValues,beforeScopes,changedScopes],['shift',shiftRows,shiftValues,beforeShifts,changedShifts]]){for(const id of ids){const row=current.get(id),value=expected.get(id);if(value){if(!row||row.deleted||!same(stored.get(id)?.value,kind==='shift'?value.value:value))stale=true;}else if(row&&!row.deleted)stale=true;}guards.push(rowGuard(workspaceId,kind,current,ids));}}
  const max=await first(db,'SELECT COALESCE(MAX(position),-1) AS position FROM workspace_publication_records WHERE workspace_id=?',workspaceId);if(!Number.isSafeInteger(max.position)||max.position< -1)throw invalid();let position=max.position;
  const newRecords=[];for(const value of next.records){const current=recordRows.get(value.id);if(current){if(!same(recordValues.get(value.id)?.value,value))stale=true;}else newRecords.push({value,position:++position});}
  if(newRecords.length&&!importing)guards.push({sql:'COALESCE((SELECT MAX(position) FROM workspace_publication_records WHERE workspace_id=?),-1)=?',values:[workspaceId,max.position]});
  if(stale)return guarded([],{sql:'0=1',values:[]});
  const statements=[],employeeDescriptors=[],payloads={state:[],scope:[],shift:[],record:[]},headers={state:[],scope:[],shift:[],record:[]};
  if(importing||!same(oldMeta,nextMeta)){const version=nextVersion(state),packed=await pack(nextMeta);headers.state.push({version,sequence:next.sequence,...packed,write_token:token,updated_at:at,window_config:await windowConfig('state',nextMeta),window_version:version});payloads.state.push({id:'state',version,parts:packed.parts});}
  for(const key of changedScopes){const current=scopeRows.get(key),value=afterScopes.get(key);if(!value)continue;const version=nextVersion(current),packed=await pack(value),slot=value.value;headers.scope.push({scope_key:key,from_date:slot.from,to_date:slot.to,site:slot.site,version,deleted:0,...packed,payload_version:version,write_token:token,updated_at:at,window_config:await windowConfig('scope',value),window_version:version});payloads.scope.push({id:key,version,parts:packed.parts});}
  for(const id of changedShifts){const current=shiftRows.get(id),chosen=afterShifts.get(id);if(!chosen)continue;const version=nextVersion(current),packed=await pack(chosen.value),shift=chosen.value,descriptor=await publishedEmployeeDescriptor(shift,version);employeeDescriptors.push({id,descriptor});headers.shift.push({id,scope_key:chosen.key,person_id:shift.person,work_date:shift.date,site:shift.site,start_time:shift.start,end_time:shift.end,version,deleted:0,...packed,payload_version:version,write_token:token,updated_at:at,time_config:await timeConfig(shift),time_version:version,...descriptor.fields});payloads.shift.push({id,version,parts:packed.parts});}
  for(const {value,position}of newRecords){const packed=await pack(value);headers.record.push({id:value.id,position,at:value.at,...packed,write_token:token});payloads.record.push({id:value.id,version:1,parts:packed.parts});}
  // parts are deliberately kept out of JSON header batches.
  for(const kind of Object.keys(headers)){statements.push(...upserts(db,workspaceId,kind,headers[kind].map(({parts,...row})=>row),condition,importing));statements.push(...chunkWrites(db,workspaceId,kind,payloads[kind],condition,token));}
  statements.push(...publishedEmployeeIndexStatements({db,workspaceId,descriptors:employeeDescriptors,deletedIds:changedShifts.filter(id=>!afterShifts.has(id)),condition}));
  if(headers.state.length){const indexed={sql:`(${condition.sql}) AND EXISTS (SELECT 1 FROM workspace_publication_state current WHERE current.workspace_id=? AND current.version=? AND current.write_token=?)`,values:[...condition.values,workspaceId,headers.state[0].version,token]};statements.push(...linkStatements(db,workspaceId,normalizedLinks(nextMeta.value.scopeLinks),indexed));}
  for(const [kind,current,ids,afterValues]of [['scope',scopeRows,changedScopes,afterScopes],['shift',shiftRows,changedShifts,afterShifts]]){const removed=ids.filter(id=>!afterValues.has(id)&&current.get(id)?.deleted===0);for(const id of removed)nextVersion(current.get(id));for(const batch of groups(removed)){const store=stores[kind];statements.push(statement(db,`UPDATE ${store.table} SET deleted=1,version=version+1,write_token=?,updated_at=? WHERE workspace_id=? AND ${store.key} IN (SELECT value FROM json_each(?)) AND ${condition.sql}`,token,at,workspaceId,JSON.stringify(batch),...condition.values));}}
  for(const kind of ['state','scope','shift'])if(headers[kind].length)statements.push(cleanup(db,workspaceId,kind,condition,token));
  return guarded(statements,and(guards));
}

export async function publicationImportStatements({db,workspaceId,studio,condition,token,at}){
  const occupied=await first(db,`SELECT 1 AS occupied WHERE EXISTS (SELECT 1 FROM workspace_publication_state WHERE workspace_id=?) OR EXISTS (SELECT 1 FROM workspace_publication_scopes WHERE workspace_id=?) OR EXISTS (SELECT 1 FROM workspace_published_shifts WHERE workspace_id=?) OR EXISTS (SELECT 1 FROM workspace_publication_records WHERE workspace_id=?) OR EXISTS (SELECT 1 FROM workspace_publication_chunks WHERE workspace_id=?)`,workspaceId,workspaceId,workspaceId,workspaceId,workspaceId);
  if(occupied){const error=new Error('Udgivelsesimporten er allerede startet. Kontrollér den samlede planimport.');error.code='publication_import_conflict';throw error;}
  const result=await prepare({db,workspaceId,before:{},after:studio,condition,token,at,importing:true});
  return result;
}
export async function publicationWriteStatements({db,workspaceId,before,after,condition,token,at}){return prepare({db,workspaceId,before,after,condition,token,at,importing:false});}
