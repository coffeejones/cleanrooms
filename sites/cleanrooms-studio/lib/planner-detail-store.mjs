/* Point hydration is an explicit barrier before a compact calendar can edit,
 * move or copy an occurrence. Neither instruction tokens nor caller scopes are
 * write authority: the observed plan and directory generations must still match. */
import Planning from '../src/planning-records.js';
import Data from '../src/studio-data.js';
import Series from '../src/series-engine.js';
import {readPlanningRecords} from './planning-store.mjs';
import {readDirectoryRecords} from './directory-store.mjs';
import {initializeEmployeeReadContext,assertEmployeeReadContext} from './employee-read-store.mjs';
import {readChecklistProgress} from './engagement-store.mjs';
import {readRawStudio,StudioError} from './studio-store.mjs';
const encoder=new TextEncoder(),query=(db,sql,...values)=>db.prepare(sql).bind(...values),rows=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[];
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=512&&id===id.trim()&&!['__proto__','constructor','prototype'].includes(id)&&!/[\u0000-\u001f\u007f]/.test(id);
const batches=values=>{const result=[];for(let offset=0;offset<values.length;offset+=250)result.push(values.slice(offset,offset+250));return result;};
async function headersFor(db,workspaceId,identities){const result=[];for(const batch of batches(identities))result.push(...await rows(db,`SELECT item.kind,item.id,item.version,item.deleted,item.parent_id,item.sort_order,json_extract(item.config,'$.bytes') AS bytes FROM json_each(?) chosen CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind=json_extract(chosen.value,'$.kind') AND item.id=json_extract(chosen.value,'$.id')`,JSON.stringify(batch),workspaceId));return result;}
export async function handlePlannerDetail({db,context,payload,helpers:h}){
  if(!h.capabilities(context).plan)fail(403,'planner_detail_forbidden','Du har ikke adgang til planlægningens instruktioner.');
  const {shiftIds=[],seriesIds=[]}=payload;if(!Array.isArray(shiftIds)||!Array.isArray(seriesIds)||shiftIds.length>500||seriesIds.length>500||!shiftIds.length&&!seriesIds.length||[...shiftIds,...seriesIds].some(id=>!validId(id))||!Number.isSafeInteger(payload.revision)||!Number.isSafeInteger(payload.directoryRevision))fail(400,'planner_detail_invalid','Vælg højst 500 vagter eller vagtserier med deres aktuelle planversion.');
  const frame=await initializeEmployeeReadContext({db,context,helpers:h});if(payload.revision!==frame.planRevision||payload.directoryRevision!==frame.directoryRevision)fail(409,'planner_detail_changed','Planen eller medarbejderne er ændret. Hent kalenderperioden igen, før vagten ændres.');
  const workspaceId=context.workspace.id,owner=context.workspace.snapshotOwnerId,raw=await readRawStudio(db,owner);if(raw.revision!==frame.planRevision||raw.source.token!==frame.planToken)fail(409,'planner_detail_changed','Vagtplanen er ændret. Hent kalenderperioden igen.');
  const ids=[...new Set(shiftIds)],explicitSeries=[...new Set(seriesIds)],children=await headersFor(db,workspaceId,ids.map(id=>({kind:'shift',id}))),parents=new Set(explicitSeries);
  for(const child of children)if(child.parent_id)parents.add(child.parent_id);
  for(const id of ids)for(let index=id.indexOf('@');index>=0;index=id.indexOf('@',index+1))if(index>0)parents.add(id.slice(0,index));
  if(parents.size>5000)fail(413,'planner_detail_full','Der er for mange serieafhængigheder i én åbning. Vælg færre vagter.');
  const parentHeaders=await headersFor(db,workspaceId,[...parents].map(id=>({kind:'series',id}))),headers=[...children,...parentHeaders];let total=0;for(const header of headers){if(!Number.isSafeInteger(header.bytes)||header.bytes<1)fail(500,'planner_detail_invalid_source','En af vagtens planposter kunne ikke læses sikkert.');total+=header.deleted?0:header.bytes;}if(total>64*1024*1024)fail(413,'planner_detail_full','De valgte instruktioner fylder for meget til én åbning. Vælg færre vagter.');
  const identities=[...ids.map(id=>({kind:'shift',id})),...parentHeaders.map(({kind,id})=>({kind,id})),...explicitSeries.map(id=>({kind:'series',id}))],loaded=await readPlanningRecords({db,workspaceId,identities}),versions={...loaded.versions};for(const identity of identities){const key=Planning.key(identity.kind,identity.id);versions[key]??=0;}
  const seedIds=ids.filter(id=>/^p(?:[0-9]|1[0-9]|2[01])-\d{4}-\d{2}-\d{2}$/.test(id)).map(id=>id.slice(0,-11)),people=seedIds.length?(await readDirectoryRecords({db,workspaceId,kind:'employee',ids:[...new Set(seedIds)],catalog:true})).records.flatMap(row=>row.value?[row.value]:[]):[],data=Planning.apply({...raw.studio,roster:people,series:[],edits:{},deleted:[],weekPlans:{}},loaded.records),deleted=new Set(data.deleted),detailShifts=[];
  for(const id of ids){if(deleted.has(id))fail(409,'planner_detail_changed','Vagten er slettet. Hent kalenderperioden igen.');let shift=Object.hasOwn(data.edits,id)?data.edits[id]:null;if(!shift){const series=data.series.find(item=>id.startsWith(item.id+'@')),day=id.slice(-10),validDay=/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>=Data.minDate&&day<=Data.maxDate&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;if(series&&validDay)shift=Series.enumerate(series,{from:day,to:day}).find(value=>value.id===id);else if(!series&&validDay)shift=Data.seededShifts(day,day,data).find(value=>value.id===id);}if(!shift)fail(404,'planner_shift_missing','Vagten findes ikke længere i planen.');detailShifts.push(shift);}
  const progress=await readChecklistProgress(db,context,{shifts:detailShifts});await assertEmployeeReadContext({db,context,frame,helpers:h});
  const metadataHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(Planning.canonical(Planning.metadata(raw.studio||{})))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');return {revision:frame.planRevision,directoryRevision:frame.directoryRevision,records:loaded.records,planning:{schema:1,versions,metadataHash},detailShifts,progress};
}
