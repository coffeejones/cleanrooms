/* Calendar caches are derived and versioned independently of their instruction
 * bodies. Large week baselines keep their schedules in UTF-8 bounded chunks. */
import Scope from '../src/planning-scope.js';
import Instructions from '../src/instruction-state.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),CHUNK_BYTES=256*1024,MAX_BYTES=64*1024*1024;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const invalid=()=>{throw Object.assign(new Error('Kalenderens kompakte indeks er ugyldigt.'),{status:500,code:'planning_calendar_summary_invalid'});};
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
export function currentCalendarSummary(kind,id,config){try{const value=JSON.parse(config);if(kind==='week')return value.calendarSchema===1&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&typeof value.sha256==='string';if(value.kind!==kind||value.id!==id)return false;const item=kind==='shift'?value.value?.edit:value.value;if(value.value===null||kind==='shift'&&!item)return true;return Instructions.isDeferred(item)&&Instructions.valid(item._instructions);}catch{return false;}}
export async function packCalendarSummary(kind,id,value){
  const summary=Scope.summary(kind,id,value),serialized=JSON.stringify(summary),bytes=encoder.encode(serialized);if(kind!=='week')return {config:serialized,chunks:[]};
  if(bytes.length>MAX_BYTES)throw Object.assign(new RangeError('Ugens kompakte oversigt fylder for meget. Vælg færre vagter.'),{status:413,code:'planning_calendar_summary_full'});
  const envelope={calendarSchema:1,bytes:bytes.length,sha256:await digest(serialized)};if(bytes.length<=CHUNK_BYTES)return {config:JSON.stringify({...envelope,value:summary}),chunks:[]};
  const chunks=[];for(let offset=0;offset<bytes.length;){let end=Math.min(offset+CHUNK_BYTES,bytes.length);while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;chunks.push(decoder.decode(bytes.subarray(offset,end)));offset=end;}return {config:JSON.stringify({...envelope,chunkCount:chunks.length}),chunks};
}
export function calendarSummaryChunks({db,workspaceId,kind,id,version,payload,condition,token}){
  if(kind!=='week')return [];
  const namespace='week',written=`${condition.sql} AND EXISTS (SELECT 1 FROM workspace_plan_records written WHERE written.workspace_id=? AND written.kind='week' AND written.id=? AND written.version=? AND written.write_token=?)`,values=[...condition.values,workspaceId,id,version,token];
  return [...payload.chunks.map((content,index)=>statement(db,`INSERT INTO workspace_plan_calendar_chunks (workspace_id,kind,id,version,chunk_index,content) SELECT ?,?,?,?,?,? WHERE ${written} ON CONFLICT(workspace_id,kind,id,version,chunk_index) DO UPDATE SET content=excluded.content`,workspaceId,namespace,id,version,index,content,...values)),statement(db,`DELETE FROM workspace_plan_calendar_chunks WHERE workspace_id=? AND kind=? AND id=? AND (version<>? OR chunk_index>=?) AND ${written}`,workspaceId,namespace,id,version,payload.chunks.length,...values)];
}
export async function unpackCalendarSummary({db,workspaceId,row}){
  let parsed;try{parsed=JSON.parse(row.schedule_config);}catch{invalid();}
  if(row.kind==='week'){
    if(parsed.calendarSchema!==1||!Number.isSafeInteger(parsed.bytes)||parsed.bytes<1||parsed.bytes>MAX_BYTES||typeof parsed.sha256!=='string')invalid();let serialized;
    if(Object.hasOwn(parsed,'value'))serialized=JSON.stringify(parsed.value);else{
      if(!Number.isInteger(parsed.chunkCount)||parsed.chunkCount<1||parsed.chunkCount>MAX_BYTES/CHUNK_BYTES+1)invalid();const parts=[];
      for(let offset=0;offset<parsed.chunkCount;offset+=4){const selected=(await db.batch([statement(db,'SELECT chunk_index,content FROM workspace_plan_calendar_chunks WHERE workspace_id=? AND kind=? AND id=? AND version=? AND chunk_index>=? AND chunk_index<? ORDER BY chunk_index',workspaceId,'week',row.id,row.version,offset,Math.min(offset+4,parsed.chunkCount))]))[0]?.results||[];if(selected.length!==Math.min(4,parsed.chunkCount-offset))invalid();for(const chunk of selected){if(chunk.chunk_index!==parts.length||typeof chunk.content!=='string'||encoder.encode(chunk.content).length>CHUNK_BYTES)invalid();parts.push(chunk.content);}}
      serialized=parts.join('');
    }
    if(encoder.encode(serialized).length!==parsed.bytes||await digest(serialized)!==parsed.sha256)invalid();try{parsed=JSON.parse(serialized);}catch{invalid();}
  }
  if(parsed.kind!==row.kind||parsed.id!==row.id||typeof parsed.hasDescription!=='boolean')invalid();try{if(JSON.stringify(Scope.compact(row.kind,row.id,parsed.value))!==JSON.stringify(parsed.value))invalid();}catch{invalid();}return parsed;
}
