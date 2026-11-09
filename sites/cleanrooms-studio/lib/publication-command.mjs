/* Targeted authoritative publication contexts; the outer plan CAS owns commit. */
import Publication from '../src/publication-model.js';
import Data from '../src/studio-data.js';
import {seriesCoreErrors} from './planning-validation.mjs';
import Time from '../src/timekeeping-model.js';
import Series from '../src/series-engine.js';
import {readPublicationDraftContext} from './planning-selection-store.mjs';
import {readPublicationCommandContext,readPublicationMetadata} from './publication-store.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[];
const fail=(status,code,message)=>{const error=new Error(message);error.status=status;error.code=code;throw error;};
const groups=(values,size=128)=>Array.from({length:Math.ceil(values.length/size)},(_,index)=>values.slice(index*size,(index+1)*size));
const week=day=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return date.toISOString().slice(0,10);};
const scopeKey=shift=>week(shift.date)+'|'+shift.site;

export async function publishedConflictNeighbors({db,workspaceId,shifts}){
  const pairs=[...new Map(shifts.filter(shift=>shift.person).map(shift=>[JSON.stringify([shift.person,shift.date]),{person:shift.person,date:shift.date}])).values()],result=new Map();
  for(const batch of groups(pairs)){let after='';while(true){const rows=await all(db,`SELECT DISTINCT target.id,target.person_id,target.work_date,target.site,target.start_time,target.end_time FROM json_each(?) chosen CROSS JOIN workspace_published_shifts target INDEXED BY workspace_published_shifts_person WHERE target.workspace_id=? AND target.deleted=0 AND target.person_id=json_extract(chosen.value,'$.person') AND target.work_date=json_extract(chosen.value,'$.date') AND target.id>? ORDER BY target.id LIMIT 500`,JSON.stringify(batch),workspaceId,after);
      for(const row of rows){result.set(row.id,{id:row.id,person:row.person_id,date:row.work_date,site:row.site,start:row.start_time,end:row.end_time});if(result.size>50000)fail(413,'publication_context_too_large','Udgivelsen berører for mange vagter. Vælg en mindre periode.');}if(rows.length<500)break;after=rows.at(-1).id;}}
  return [...result.values()];
}

export function publicationCommandConflict({afterShifts,publishedNeighbors,scopes}){
  const selected=new Set(scopes.flatMap(scope=>scope.siteIds.map(site=>scope.from+'|'+site))),groups=new Map(),values=[...afterShifts,...publishedNeighbors.filter(shift=>!selected.has(scopeKey(shift)))];
  for(const shift of values){if(!shift.person)continue;const key=JSON.stringify([shift.person,shift.date]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(shift);}
  for(const shifts of groups.values()){shifts.sort((a,b)=>a.start.localeCompare(b.start));for(let index=0;index<shifts.length;index++)for(let prior=0;prior<index;prior++)if(shifts[prior].id!==shifts[index].id&&shifts[prior].end>shifts[index].start&&(selected.has(scopeKey(shifts[prior]))||selected.has(scopeKey(shifts[index]))))return [shifts[prior],shifts[index]];}return null;
}

async function assertSource(db,raw,workspaceId){
  const rows=await all(db,'SELECT state.revision,state.write_token FROM workspaces company JOIN studio_states state ON state.owner_id=company.snapshot_owner_id WHERE company.id=?',workspaceId),header=rows[0];
  if(!header||header.revision!==raw.revision||header.write_token!==raw.source.token)fail(409,'publication_context_changed','Planen er ændret. Gennemgå udgivelsen igen.');
}

export async function readPublicationPlanningContext({db,workspaceId,raw,scope,changes=[]}){
  const draft=await readPublicationDraftContext({db,workspaceId,raw,scope,changes}),publicationContext=await readPublicationCommandContext({db,workspaceId,scopeKeys:draft.selection.scopeKeys}),before={...draft.before},after={...draft.after};
  delete before.publications;delete after.publications;if(publicationContext.meta.present){before.publications=clone(publicationContext.studio.publications);after.publications=clone(publicationContext.studio.publications);}
  const shifts=draft.selection.scopes.flatMap(part=>Data.shiftsInRange(part.from,part.to,after).filter(shift=>part.siteIds.includes(shift.site))),publishedNeighbors=await publishedConflictNeighbors({db,workspaceId,shifts});
  await assertSource(db,raw,workspaceId);return {...draft,before,after,publicationContext,publishedNeighbors};
}

export async function readPublicationLineage({db,workspaceId,before,after}){
  const changed=(before.series||[]).filter(source=>JSON.stringify(source)!==JSON.stringify((after.series||[]).find(item=>item.id===source.id)));
  if(!changed.length)return {before:{},after:{},changed:false};
  const {meta}=await readPublicationMetadata({db,workspaceId}),headers=new Map();
  for(const source of changed){let cursor='';while(true){const rows=await all(db,`SELECT id,scope_key,person_id,work_date,site,start_time,end_time FROM workspace_published_shifts WHERE workspace_id=? AND deleted=0 AND id>=? AND id<? AND id>? ORDER BY id LIMIT 500`,workspaceId,source.id+'@',source.id+'A',cursor);for(const row of rows)if(Series.occurrenceAnchor(row.id,source.id)){headers.set(row.id,row);if(headers.size>50000)fail(413,'publication_context_too_large','Ændringen berører for mange udgivne vagter. Vælg en mindre aftale.');}if(rows.length<500)break;cursor=rows.at(-1).id;}}
  // An unpublished legacy record can be repaired/deleted without expanding its
  // invalid recurrence. No published occurrence means there is no lineage to add.
  if(!headers.size)return {before:{},after:{},changed:false};
  // Only frozen scope headings are read. Synthetic shifts need no instruction
  // content: withLineage compares identities/dates/sites, never descriptions.
  const slots={};for(const batch of groups([...new Set([...headers.values()].map(row=>row.scope_key))])){
    const rows=await all(db,`SELECT scope_key,from_date,to_date,site FROM workspace_publication_scopes WHERE workspace_id=? AND deleted=0 AND scope_key IN (SELECT value FROM json_each(?))`,workspaceId,JSON.stringify(batch));
    for(const row of rows)slots[row.scope_key]={from:row.from_date,to:row.to_date,site:row.site,location:{index:row.site,id:'lineage',name:'',address:'',color:''},publicationId:'lineage',at:'2000-01-01T00:00:00.000Z',actor:{userId:'lineage',name:''},shifts:[]};
  }
  for(const row of headers.values()){if(!slots[row.scope_key])fail(500,'publication_storage_invalid','Udgivelsens vagt mangler sit arbejdssted.');slots[row.scope_key].shifts.push({id:row.id,person:row.person_id,date:row.work_date,site:row.site,start:row.start_time,end:row.end_time,note:''});}
  const publication={...meta.value,slots,records:[]};
  // A bad historical template must not be re-enumerated during explicit repair.
  // Frozen publication rows below are the exact surviving occurrence evidence.
  // The temporary no-occurrence template is used only for lineage calculation;
  // neither the stored record nor its unknown metadata is replaced by it.
  const safeBefore={...before,series:(before.series||[]).map(source=>{
    if(!changed.includes(source)||!seriesCoreErrors(source).length)return source;
    const frozen=[...headers.values()].filter(row=>Series.occurrenceAnchor(row.id,source.id));
    const day=Time.validDate(source.startDate)&&source.startDate>='2000-01-01'&&source.startDate<='2100-12-31'?source.startDate:frozen[0]?.work_date;
    if(!day)fail(409,'planning_series_repair_required','Den gemte vagtserie '+source.id+' skal gennemgås, før udgivne perioder ændres.');
    const weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
    return {...source,person:frozen[0]?.person_id||'legacy',site:frozen[0]?.site??0,startDate:day,endDate:day,weekdays:[(weekday+1)%7],start:'07:00',end:'15:00',plannedBreakMinutes:0,dayTimes:{},openEnded:false,note:'',noteRich:undefined};
  })};
  const linked=Publication.withLineage({...safeBefore,publications:publication},{...after,publications:publication}).publications;
  const old={...meta.value,slots:{},records:[]},next={...linked,slots:{},records:[]};return {before:{publications:old},after:{publications:next},changed:JSON.stringify(old.scopeLinks||[])!==JSON.stringify(next.scopeLinks||[])};
}
