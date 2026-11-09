/* Operation reads contain writable full records and separate read-only schedule templates. */
import Scope from '../src/planning-scope.js';
import Planning from '../src/planning-records.js';
import Window from '../src/planning-window.js';
import {currentCalendarSummary,packCalendarSummary,calendarSummaryChunks} from './planning-calendar-summary.mjs';
import Data from '../src/studio-data.js';
import {decodePlanningRecord,PlanningStoreError,planWindowFields,readPlanningRecords} from './planning-store.mjs';
import {storedScheduleErrors} from './planning-validation.mjs';
import {draftWindowPage,windowMetadata,projectStudioWindow} from './planning-window-store.mjs';
import {publicationSelection,publicationSelectionPage,projectPublicationSelection,publicationAvailabilityPage,projectPublicationWindow} from './publication-store.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX_ROWS=500,MAX_BYTES=1024*1024;
const statement=(db,sql,...values)=>{if(values.length>100||values.some(value=>typeof value==='string'&&encoder.encode(value).length>2*1024*1024))throw new PlanningStoreError(413,'planning_selection_too_large','Handlingen indeholder for mange afgrænsninger.');return db.prepare(sql).bind(...values);};
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(...args)=>(await rows(...args))[0]||null;
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const fail=(status,code,message)=>{throw new PlanningStoreError(status,code,message);};
const conflict=()=>fail(409,'planning_selection_conflict','Planen eller fraværet er ændret. Hent det berørte område igen.');
const phases=['calendar','own','publication-draft','catalog','availability','published-availability','publication','absence'];
const anchorParent=id=>Scope.validDate(id.slice(-10))&&id.at(-11)==='@'?id.slice(0,-11):null;
const rowKey=row=>Planning.key(row.kind,row.id);
const afterSQL=after=>after?' AND (record.kind>? OR (record.kind=? AND record.id>?))':'';
const afterValues=after=>after?[after.kind,after.kind,after.id]:[];

function decodeSummary(row){
  if(row.schedule_version!==row.version||typeof row.schedule_config!=='string'||encoder.encode(row.schedule_config).length>16*1024)fail(500,'planning_schedule_invalid','Planens tidsoversigt er ikke opdateret.');
  let value;try{value=JSON.parse(row.schedule_config);}catch{fail(500,'planning_schedule_invalid','Planens tidsoversigt er ugyldig.');}
  if(value.kind!==row.kind||value.id!==row.id||typeof value.hasDescription!=='boolean'||Planning.canonical(Scope.compact(value.kind,value.id,value.value))!==Planning.canonical(value.value))fail(500,'planning_schedule_invalid','Planens tidsoversigt kunne ikke valideres.');
  if(storedScheduleErrors(value.kind,value.id,value.value).length)fail(409,'planning_schedule_repair_required','Den gemte '+(value.kind==='series'?'vagtserie':'vagt')+' '+value.id+' har ugyldige tider eller datoer. Ret eller fjern posten.');
  return value;
}

export async function ensurePlanningSchedules({db,workspaceId,ranges,personId}){
  for(let pass=0;pass<100000;pass++){
    let pending;
    if(ranges){pending=[];let after=null;do{const query=scheduleQuery(workspaceId,ranges,after,{personId}),found=await rows(db,query.sql,...query.values);for(const row of found.slice(0,500))if(row.schedule_version!==row.version){pending.push(row);if(pending.length===50)break;}after=found.length>500?{kind:found[499].kind,id:found[499].id}:null;}while(after&&pending.length<50);}else pending=await rows(db,'SELECT kind,id,version,deleted,write_token FROM workspace_plan_records WHERE workspace_id=? AND schedule_version=0 ORDER BY kind,id LIMIT 50',workspaceId);
    if(!pending.length)return;
    for(const header of pending){const row=await first(db,'SELECT * FROM workspace_plan_records WHERE workspace_id=? AND kind=? AND id=? AND version=? AND length(CAST(config AS BLOB))<=524288',workspaceId,header.kind,header.id,header.version);if(!row||header.write_token!==undefined&&header.write_token!==row.write_token)conflict();const value=row.deleted?null:await decodePlanningRecord(db,workspaceId,row),schedule=await packCalendarSummary(row.kind,row.id,value),person=row.kind==='shift'?value?.edit:value,condition={sql:'EXISTS (SELECT 1 FROM workspace_plan_records current WHERE current.workspace_id=? AND current.kind=? AND current.id=? AND current.version=? AND current.write_token=?)',values:[workspaceId,row.kind,row.id,row.version,row.write_token]};await db.batch([statement(db,'UPDATE workspace_plan_records SET schedule_config=?,schedule_version=version,person_id=COALESCE(?,person_id),site_index=COALESCE(?,site_index) WHERE workspace_id=? AND kind=? AND id=? AND version=? AND write_token=?',schedule.config,person?.person??null,person?.site??null,workspaceId,row.kind,row.id,row.version,row.write_token),...calendarSummaryChunks({db,workspaceId,kind:row.kind,id:row.id,version:row.version,payload:schedule,condition,token:row.write_token})]);}
  }
  conflict();
}

function scheduleQuery(workspaceId,ranges,after=null,{catalog=false,personId}={}){
  if(catalog)return {sql:`SELECT record.kind,record.id,record.version,record.deleted,record.schedule_version,length(CAST(record.schedule_config AS BLOB)) schedule_bytes FROM workspace_plan_records record WHERE record.workspace_id=? AND (record.kind='series' OR record.kind='shift' AND record.parent_id IS NOT NULL) AND record.deleted=0${afterSQL(after)} ORDER BY record.kind,record.id LIMIT 501`,values:[workspaceId,...afterValues(after)]};
  if(personId){const sql=`WITH ranges AS (SELECT json_extract(value,'$.from') first,json_extract(value,'$.to') last FROM json_each(?)), own_series AS (
    SELECT DISTINCT item.id FROM ranges wanted CROSS JOIN workspace_plan_records item INDEXED BY workspace_plan_person_period WHERE item.workspace_id=? AND item.kind='series' AND item.person_id=? AND item.window_to>=wanted.first AND item.window_from<=wanted.last
  ), candidates(kind,id) AS (
    SELECT 'series',id FROM own_series
    UNION SELECT item.kind,item.id FROM ranges wanted CROSS JOIN workspace_plan_records item INDEXED BY workspace_plan_person_period WHERE item.workspace_id=? AND item.kind='shift' AND item.person_id=? AND item.window_to>=wanted.first AND item.window_from<=wanted.last
    UNION SELECT item.kind,item.id FROM own_series parent CROSS JOIN workspace_plan_records item INDEXED BY workspace_plan_parent CROSS JOIN ranges wanted WHERE item.workspace_id=? AND item.kind='shift' AND item.parent_id=parent.id AND item.origin_date>=wanted.first AND item.origin_date<=wanted.last
    UNION SELECT item.kind,item.id FROM own_series parent CROSS JOIN workspace_plan_records item CROSS JOIN ranges wanted WHERE item.workspace_id=? AND item.kind='shift' AND item.id>=parent.id||'@' AND item.id<parent.id||'A' AND item.origin_date>=wanted.first AND item.origin_date<=wanted.last
    UNION SELECT item.kind,item.id FROM ranges wanted CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind='shift' AND item.id>=? AND item.id<? AND item.origin_date>=wanted.first AND item.origin_date<=wanted.last
  ), selected(kind,id) AS (SELECT kind,id FROM candidates UNION SELECT 'series',item.parent_id FROM candidates chosen CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind=chosen.kind AND item.id=chosen.id AND item.parent_id IS NOT NULL)
  SELECT record.kind,record.id,record.version,record.deleted,record.schedule_version,length(CAST(record.schedule_config AS BLOB)) schedule_bytes FROM selected chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=chosen.kind AND record.id=chosen.id${afterSQL(after)} ORDER BY record.kind,record.id LIMIT 501`;return {sql,values:[JSON.stringify(ranges),workspaceId,personId,workspaceId,personId,workspaceId,workspaceId,workspaceId,personId+'-',personId+'.',workspaceId,workspaceId,...afterValues(after)]};}
  const rangeJSON=JSON.stringify(ranges),sql=`WITH ranges AS (SELECT json_extract(value,'$.from') AS first,json_extract(value,'$.to') AS last FROM json_each(?)), candidates(kind,id) AS (
    SELECT item.kind,item.id FROM ranges wanted CROSS JOIN workspace_plan_records item INDEXED BY workspace_plan_window_to WHERE item.workspace_id=? AND item.kind='series' AND item.window_schema=1 AND item.window_to>=wanted.first AND item.window_from<=wanted.last
    UNION SELECT item.kind,item.id FROM ranges wanted CROSS JOIN workspace_plan_records item INDEXED BY workspace_plan_window_from WHERE item.workspace_id=? AND item.kind='shift' AND item.window_schema=1 AND item.window_from>=wanted.first AND item.window_from<=wanted.last
    UNION SELECT item.kind,item.id FROM ranges wanted CROSS JOIN workspace_plan_records item INDEXED BY workspace_plan_window_origin WHERE item.workspace_id=? AND item.kind='shift' AND item.window_schema=1 AND item.origin_date>=wanted.first AND item.origin_date<=wanted.last
  ), selected(kind,id) AS (SELECT kind,id FROM candidates UNION SELECT 'series',item.parent_id FROM candidates chosen CROSS JOIN workspace_plan_records item WHERE item.workspace_id=? AND item.kind=chosen.kind AND item.id=chosen.id AND item.kind='shift' AND item.parent_id IS NOT NULL)
  SELECT record.kind,record.id,record.version,record.deleted,record.schedule_version,length(CAST(record.schedule_config AS BLOB)) schedule_bytes FROM selected chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=chosen.kind AND record.id=chosen.id${afterSQL(after)} ORDER BY record.kind,record.id LIMIT 501`;
  return {sql,values:[rangeJSON,workspaceId,workspaceId,workspaceId,workspaceId,workspaceId,...afterValues(after)]};
}

async function summariesInRanges(db,workspaceId,ranges,options={}){
  const result=[];let after=null,bytes=0;
  do{const page=await summaryPage({db,workspaceId,ranges,after,...options});for(const value of page.values){bytes+=encoder.encode(JSON.stringify(value)).byteLength;if(result.length>=(options.maxRecords??Infinity)||bytes>(options.maxBytes??Infinity))fail(413,'planning_summary_too_large','Periodens tidsoversigt fylder for meget. Vælg en kortere periode.');result.push(value);}after=page.nextAfter;}while(after);
  return result;
}
export function readPlanningScheduleSummaries(db,workspaceId,ranges,options={}){return summariesInRanges(db,workspaceId,ranges,{...options,maxRecords:Math.min(options.maxRecords??50000,50000),maxBytes:Math.min(options.maxBytes??16*1024*1024,16*1024*1024)});}

async function repairSelectedSummary(db,workspaceId,row,sourceHeader=null){
  if(row.deleted||row.schedule_version===row.version&&currentCalendarSummary(row.kind,row.id,row.schedule_config))return row;
  const header=sourceHeader||await first(db,"SELECT write_token,json_extract(config,'$.bytes') AS bytes FROM workspace_plan_records WHERE workspace_id=? AND kind=? AND id=? AND version=?",workspaceId,row.kind,row.id,row.version);if(!header||!Number.isSafeInteger(header.bytes)||header.bytes<1)conflict();
  const full=await first(db,'SELECT kind,id,version,deleted,write_token,config FROM workspace_plan_records WHERE workspace_id=? AND kind=? AND id=? AND version=? AND write_token=? AND length(CAST(config AS BLOB))<=524288',workspaceId,row.kind,row.id,row.version,header.write_token);if(!full)conflict();const value=await decodePlanningRecord(db,workspaceId,full),packed=await packCalendarSummary(row.kind,row.id,value),written=await db.batch([statement(db,'UPDATE workspace_plan_records SET schedule_config=?,schedule_version=version WHERE workspace_id=? AND kind=? AND id=? AND version=? AND write_token=?',packed.config,workspaceId,row.kind,row.id,row.version,header.write_token)]);if(written[0]?.meta?.changes!==1)conflict();return {...row,schedule_config:packed.config,schedule_version:row.version};
}

async function summaryPage({db,workspaceId,ranges,after=null,catalog=false,personId,maxRows=MAX_ROWS,maxBytes=MAX_BYTES,maxSourceBytes=MAX_BYTES,allowOversized=true,wireKind}){
  const query=scheduleQuery(workspaceId,ranges,after,{catalog,personId}),headers=await rows(db,query.sql,...query.values),selected=[];let bytes=0;
  for(const row of headers.slice(0,maxRows)){if(!Number.isSafeInteger(row.schedule_bytes)||row.schedule_bytes<0||row.schedule_bytes>16*1024)fail(500,'planning_schedule_invalid','Planens tidsoversigt er ikke opdateret.');const size=(row.schedule_bytes||512)+(wireKind?encoder.encode(row.id).length+150:0);if((selected.length||!allowOversized)&&bytes+size>maxBytes)break;selected.push(row);bytes+=size;}
  const found=[];for(let offset=0;offset<selected.length;offset+=250)found.push(...await rows(db,`SELECT record.kind,record.id,record.version,record.deleted,record.schedule_config,record.schedule_version FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id') AND record.version=json_extract(chosen.value,'$.version') AND length(CAST(record.schedule_config AS BLOB))<=16384`,JSON.stringify(selected.slice(offset,offset+250).map(({kind,id,version})=>({kind,id,version}))),workspaceId));if(found.length!==selected.length)conflict();const mapped=new Map(found.map(row=>[rowKey(row),row])),values=[];let sourceBytes=0,last=null,processed=0;
  let wireBytes=0;
  for(const header of selected){let row=mapped.get(rowKey(header));if(!row.deleted){if(row.schedule_version!==row.version||!currentCalendarSummary(row.kind,row.id,row.schedule_config)){const source=await first(db,"SELECT write_token,json_extract(config,'$.bytes') AS bytes FROM workspace_plan_records WHERE workspace_id=? AND kind=? AND id=? AND version=?",workspaceId,row.kind,row.id,row.version);if(!source||!Number.isSafeInteger(source.bytes)||source.bytes<1)conflict();if((processed||!allowOversized)&&sourceBytes+source.bytes>maxSourceBytes)break;row=await repairSelectedSummary(db,workspaceId,row,source);sourceBytes+=source.bytes;}const value=decodeSummary(row),size=wireKind?encoder.encode(JSON.stringify({kind:wireKind,id:rowKey(value),value})).length:0;if(wireKind&&(values.length||!allowOversized)&&wireBytes+size>maxBytes)break;values.push(value);wireBytes+=size;}processed++;last=header;}
  return {values,sourceBytes,blocked:headers.length>0&&processed===0,nextAfter:headers.length>processed&&last?{kind:last.kind,id:last.id}:null};
}

async function ownGroup(db,workspaceId,projection){
  if(projection.mode!=='series')return {groupIds:[],seriesIds:[],headers:[]};
  let groupId=projection.groupId;
  if(projection.seriesId){const series=await first(db,"SELECT id,group_id,deleted FROM workspace_plan_records WHERE workspace_id=? AND kind='series' AND id=?",workspaceId,projection.seriesId);if(!series||series.deleted)fail(404,'planning_series_missing','Vagtserien findes ikke længere.');if(groupId&&groupId!==(series.group_id||series.id))fail(400,'planning_group_mismatch','Vagtserien tilhører ikke den valgte aftale.');groupId=series.group_id||series.id;}
  if(!groupId)return {groupIds:[],seriesIds:[],headers:[]};
  const series=[];let afterId='';while(true){const page=await rows(db,"SELECT kind,id,version,deleted,sort_order,parent_id,group_id,window_from,window_to,origin_date FROM workspace_plan_records INDEXED BY workspace_plan_group WHERE workspace_id=? AND kind='series' AND group_id=? AND id>? ORDER BY id LIMIT 500",workspaceId,groupId,afterId);series.push(...page);if(page.length<500)break;afterId=page.at(-1).id;}const ids=series.map(row=>row.id);
  if(!series.some(row=>!row.deleted))fail(404,'planning_series_missing','Aftalen findes ikke længere.');
  const shifts=new Map();for(let offset=0;offset<ids.length;offset+=250){let after='';while(true){const page=await rows(db,`WITH chosen AS (SELECT value id FROM json_each(?)), selected(kind,id) AS (
    SELECT record.kind,record.id FROM chosen parent CROSS JOIN workspace_plan_records record INDEXED BY workspace_plan_parent WHERE record.workspace_id=? AND record.kind='shift' AND record.parent_id=parent.id
    UNION SELECT record.kind,record.id FROM chosen parent CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind='shift' AND record.id>=parent.id||'@' AND record.id<parent.id||'A'
  ) SELECT record.kind,record.id,record.version,record.deleted,record.sort_order,record.parent_id,record.group_id,record.window_from,record.window_to,record.origin_date FROM selected chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=chosen.kind AND record.id=chosen.id AND record.id>? ORDER BY record.id LIMIT 500`,JSON.stringify(ids.slice(offset,offset+250)),workspaceId,workspaceId,workspaceId,after);for(const row of page)shifts.set(rowKey(row),row);if(page.length<500)break;after=page.at(-1).id;}}
  return {groupIds:[groupId],seriesIds:ids,headers:[...series,...shifts.values()]};
}

function effectiveContext(db,workspaceId,studio,changes=[]){
  const rangeCache=new Map();
  const overlay=new Map(changes.filter(change=>change.kind==='series'||change.kind==='shift').map(change=>[rowKey(change),change]));
  const read=async ranges=>{const key=JSON.stringify(ranges);if(!rangeCache.has(key))rangeCache.set(key,summariesInRanges(db,workspaceId,ranges).then(values=>{const mapped=new Map(values.map(value=>[rowKey(value),value]));for(const [id,change]of overlay){if(change.value===null)mapped.delete(id);else mapped.set(id,Scope.summary(change.kind,change.id,change.value));}return [...mapped.values()];}));return rangeCache.get(key);};
  return {read,draftForScopes:async scopes=>{const ranges=Scope.mergeRanges(scopes.map(scope=>({from:scope.from,to:scope.to}))),summaries=await read(ranges),data={...studio,...Scope.summaryStudio(summaries),demoSeed:studio.demoSeed},result=new Map();for(const scope of scopes)for(const shift of Data.shiftsInRange(scope.from,scope.to,data))if(scope.siteIds.includes(shift.site))result.set(shift.id,shift);return [...result.values()];},currentForIds:async ids=>{
    const result=new Map(),edits=new Map(),parents=new Set();
    for(let offset=0;offset<ids.length;offset+=500){const found=await rows(db,"SELECT record.kind,record.id,record.version,record.deleted,record.schedule_config,record.schedule_version FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind='shift' AND record.id=chosen.value",JSON.stringify(ids.slice(offset,offset+500)),workspaceId);for(const row of found)if(!row.deleted)edits.set(row.id,decodeSummary(await repairSelectedSummary(db,workspaceId,row)).value);}for(const change of changes)if(change.kind==='shift')edits.set(change.id,change.value);
    for(const id of ids){const parent=anchorParent(id);if(parent)parents.add(parent);}
    const series=new Map();for(let offset=0,values=[...parents];offset<values.length;offset+=500){const found=await rows(db,"SELECT record.kind,record.id,record.version,record.deleted,record.schedule_config,record.schedule_version FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind='series' AND record.id=chosen.value",JSON.stringify(values.slice(offset,offset+500)),workspaceId);for(const row of found)if(!row.deleted)series.set(row.id,decodeSummary(await repairSelectedSummary(db,workspaceId,row)).value);}for(const change of changes)if(change.kind==='series')series.set(change.id,change.value);
    for(const id of ids){const edit=edits.get(id);if(edit?.suppressed){result.set(id,null);continue;}if(edit?.edit){result.set(id,edit.edit);continue;}const parent=anchorParent(id),day=id.slice(-10);if(!Scope.validDate(day)){result.set(id,null);continue;}const data={...studio,series:parent&&series.get(parent)?[series.get(parent)]:[],edits:{},deleted:[]};result.set(id,Data.shiftById(id,data));}return result;
  }};
}

function publicationDraftKeys(summaries,publication,studio){
  const series=new Map(summaries.filter(row=>row.kind==='series').map(row=>[row.id,row.value])),inside=(day,site)=>publication.scopes.some(scope=>day>=scope.from&&day<=scope.to&&scope.siteIds.includes(site)),chosen=new Set();
  for(const row of summaries){
    if(row.kind==='series'){if(publication.scopes.some(scope=>scope.siteIds.includes(row.value.site)&&row.value.startDate<=scope.to&&row.value.endDate>=scope.from))chosen.add(rowKey(row));continue;}
    const edit=row.value?.edit,parent=anchorParent(row.id),origin=row.id.slice(-10),originalSite=series.get(parent)?.site??(Scope.validDate(origin)?Data.seededShifts(origin,origin,studio).find(shift=>shift.id===row.id)?.site:undefined);
    if(edit&&inside(edit.date,edit.site)||Scope.validDate(origin)&&originalSite!==undefined&&inside(origin,originalSite)){chosen.add(rowKey(row));if(parent&&series.has(parent))chosen.add(Planning.key('series',parent));if(edit?.seriesId&&series.has(edit.seriesId))chosen.add(Planning.key('series',edit.seriesId));}
  }
  return chosen;
}

async function prepareSelection({db,workspaceId,raw,projection,changes=[]}){
  const own=await ownGroup(db,workspaceId,projection),context=effectiveContext(db,workspaceId,raw.studio,changes),calendar=Scope.calendar(projection);let publication=null;
  if(projection.mode==='publication')publication=await publicationSelection({db,workspaceId,projection,...context});
  const extra=own.headers.filter(row=>row.kind==='shift').flatMap(row=>[row.window_from,row.origin_date].filter(Scope.validDate).map(day=>({from:day,to:day})));
  const ranges=Scope.ranges(projection,[calendar,...extra,...(publication?.ranges||[])]),selection={schema:1,mode:projection.mode,calendar,groupIds:own.groupIds,seriesIds:own.seriesIds,ranges,scopes:publication?.scopes||[],dependencies:publication?.dependencies||[],scopeKeys:publication?.scopeKeys||[],catalog:projection.mode==='series-list',demoSeed:raw.studio.demoSeed!==false};
  let draft=[];
  if(publication){const summaries=await context.read(Scope.mergeRanges(publication.ranges)),chosen=publicationDraftKeys(summaries,publication,raw.studio);
    draft=[...chosen].map(key=>{const [kind,id]=JSON.parse(key);return {kind,id};});
  }
  return {own,context,publication,selection,draft};
}

/* Publishing needs the closure's authoritative draft, not the background
 * calendar. Pending commands participate in both sides of moved-ID discovery. */
export async function readPublicationDraftContext({db,workspaceId,raw,scope,changes=[]}){
  const calendar=scope.calendar||{from:scope.from,to:Scope.add(scope.from,55)<scope.to?Scope.add(scope.from,55):scope.to},projection=Scope.normalize({mode:'publication',from:scope.from,to:scope.to,siteIds:scope.siteIds,includeDependencies:scope.includeDependencies===true,calendar}),prepared=await prepareSelection({db,workspaceId,raw,projection,changes}),loaded=await readPlanningRecords({db,workspaceId,identities:[...prepared.draft,...changes.map(({kind,id})=>({kind,id}))]}),before=Planning.apply({...raw.studio,series:[],edits:{},deleted:[],weekPlans:{}},loaded.records),after=Planning.apply(before,changes),header=await first(db,'SELECT state.revision,state.write_token FROM workspaces workspace JOIN studio_states state ON state.owner_id=workspace.snapshot_owner_id WHERE workspace.id=?',workspaceId);
  if(!header||header.revision!==raw.revision||header.write_token!==raw.source.token)conflict();
  return {before,after,selection:prepared.publication,planning:{schema:1,versions:loaded.versions,metadataHash:await hash(Planning.canonical(Planning.metadata(raw.studio)))},context:prepared.context};
}

async function fullRecordsPage({db,workspaceId,identities,after,maxRows,maxBytes,maxSourceBytes=Infinity,allowOversized=true}){
  const ordered=identities.filter(item=>!after||item.kind>after.kind||item.kind===after.kind&&item.id>after.id).sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:a.id<b.id?-1:a.id>b.id?1:0),slice=ordered.slice(0,maxRows+1),headers=[];
  for(let offset=0;offset<slice.length;offset+=250)headers.push(...await rows(db,`SELECT record.kind,record.id,record.version,record.deleted,record.sort_order,length(CAST(record.config AS BLOB)) stored_bytes,json_extract(record.config,'$.bytes') payload_bytes FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id')`,JSON.stringify(slice.slice(offset,offset+250)),workspaceId));
  if(headers.length!==slice.length)conflict();
  headers.sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:a.id<b.id?-1:a.id>b.id?1:0);const selected=[];let bytes=0,selectedSourceBytes=0;
  for(const row of headers){if(!Number.isSafeInteger(row.payload_bytes)||row.payload_bytes<1||row.stored_bytes>512*1024)fail(500,'planning_selection_record_invalid','En planpost kunne ikke læses sikkert.');const source=row.deleted?0:row.payload_bytes,size=(row.deleted?4:row.payload_bytes)+encoder.encode(row.id).length+150;if(selected.length>=maxRows||(selected.length||!allowOversized)&&(bytes+size>maxBytes||selectedSourceBytes+source>maxSourceBytes))break;selected.push(row);bytes+=size;selectedSourceBytes+=source;}
  const found=[];for(let offset=0;offset<selected.length;offset+=250)found.push(...await rows(db,`SELECT record.* FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id') AND record.version=json_extract(chosen.value,'$.version')`,JSON.stringify(selected.slice(offset,offset+250).map(({kind,id,version})=>({kind,id,version}))),workspaceId));if(found.length!==selected.length)conflict();const byKey=new Map(found.map(row=>[rowKey(row),row])),records=[];let wireBytes=0,sourceBytes=0;
  for(const header of selected){const row=byKey.get(rowKey(header)),value=row.deleted?null:await decodePlanningRecord(db,workspaceId,row),item={kind:row.kind,id:row.id,value,sortOrder:row.sort_order,version:row.version},size=encoder.encode(JSON.stringify(item)).length;sourceBytes+=row.deleted?0:header.payload_bytes;if((records.length||!allowOversized)&&wireBytes+size>maxBytes)break;records.push(item);wireBytes+=size;}
  const last=records.at(-1);return {records,sourceBytes,blocked:ordered.length>0&&records.length===0,nextAfter:ordered.length>records.length&&last?{kind:last.kind,id:last.id}:null};
}

function encodeCursor(value){return btoa(String.fromCharCode(...encoder.encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeSelectionCursor(value){if(value===undefined||value===null)return null;try{if(typeof value!=='string'||value.length>16384||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('cursor');const parsed=JSON.parse(decoder.decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),letter=>letter.charCodeAt(0))));if(parsed.v!==1||typeof parsed.workspace!=='string'||!Number.isSafeInteger(parsed.revision)||parsed.revision<0||typeof parsed.token!=='string'||!Number.isSafeInteger(parsed.absenceVersion)||parsed.absenceVersion<0||typeof parsed.scopeHash!=='string'||!phases.includes(parsed.phase)||parsed.after!==null&&(!parsed.after||typeof parsed.after!=='object'||Array.isArray(parsed.after)))throw Error('cursor');if(parsed.instructions!==undefined&&parsed.instructions!=='deferred')throw Error('cursor');if(parsed.after){const after=parsed.after;if(['calendar','own','publication-draft','catalog','availability'].includes(parsed.phase)&&(!['series','shift','week'].includes(after.kind)||!Scope.validId(after.id))||parsed.phase==='absence'&&!Scope.validId(after.id)||parsed.phase==='published-availability'&&(!Scope.validDate(after.date)||!Scope.validId(after.id)))throw Error('cursor');}return parsed;}catch{fail(400,'planning_selection_cursor_invalid','Planvisningens sidehenvisning er ugyldig.');}}

function catalogSelection(projection,studio){
  return {schema:1,mode:'series-list',calendar:Scope.calendar(projection),groupIds:[],seriesIds:[],ranges:[],scopes:[],dependencies:[],scopeKeys:[],catalog:true,catalogOnly:true,demoSeed:studio.demoSeed!==false};
}

export async function readSelectionPage({db,workspaceId,owner,raw,projection,cursor,instructions}){
  const scopeHash=await hash(Planning.canonical(projection)),absenceVersion=(await first(db,'SELECT version FROM workspace_absence_imports WHERE workspace_id=?',workspaceId))?.version||0;
  if(cursor&&(cursor.workspace!==workspaceId||cursor.revision!==raw.revision||cursor.token!==raw.source.token||cursor.scopeHash!==scopeHash||cursor.absenceVersion!==absenceVersion||cursor.instructions!==instructions))conflict();
  const catalogOnly=projection.mode==='series-list'&&projection.catalogOnly===true,activePhases=catalogOnly?['catalog']:phases;
  if(cursor&&!activePhases.includes(cursor.phase))conflict();
  const prepared=catalogOnly?{selection:catalogSelection(projection,raw.studio)}:await prepareSelection({db,workspaceId,raw,projection}),{selection}=prepared,base={v:1,workspace:workspaceId,revision:raw.revision,token:raw.source.token,absenceVersion,scopeHash,...(instructions?{instructions}:{})};let phase=cursor?.phase||activePhases[0],after=cursor?.after||null;
  const records=[],publicationRows=[],auxRows=[];let nextCursor=null,sourceBytes=0;
  // The interactive series editor and publication review can share a response
  // across completed phases. Full-instruction reads retain their paging.
  const coalesce=instructions==='deferred'&&['series','publication'].includes(projection.mode);
  for(let transitions=0;transitions<activePhases.length;transitions++){
    const count=records.length+publicationRows.length+auxRows.length,maxRows=coalesce?MAX_ROWS-count:MAX_ROWS;
    // Reserve one array separator for every remaining row as well as the exact
    // emitted wrapper. A later phase cannot use its own soft first-row allowance.
    const maxBytes=coalesce?MAX_BYTES-encoder.encode(JSON.stringify({records,publicationRows,auxRows})).length-maxRows:MAX_BYTES,maxSourceBytes=coalesce?MAX_BYTES-sourceBytes:MAX_BYTES,allowOversized=!coalesce||count===0;
    if(coalesce&&count&&(maxRows<1||maxBytes<1024||maxSourceBytes<1)){nextCursor=encodeCursor({...base,phase,after});break;}
    let continuation=null,blocked=false;
    if(phase==='calendar'){const page=await draftWindowPage({db,workspaceId,studio:raw.studio,projection:selection.calendar,after,instructions,maxRows,maxBytes,...(coalesce?{maxSourceBytes}:{})});records.push(...page.records);sourceBytes+=page.sourceBytes||0;continuation=page.nextAfter;}
    else if(phase==='own'||phase==='publication-draft'){const page=await fullRecordsPage({db,workspaceId,identities:phase==='own'?prepared.own.headers:prepared.draft,after,maxRows,maxBytes,allowOversized,...(coalesce?{maxSourceBytes}:{})});records.push(...page.records);sourceBytes+=page.sourceBytes;blocked=page.blocked;continuation=page.nextAfter;}
    else if(phase==='catalog'||phase==='availability'){
      if(phase!=='catalog'||selection.catalog){const page=await summaryPage({db,workspaceId,ranges:selection.ranges,after,catalog:phase==='catalog',maxRows,maxBytes,maxSourceBytes,allowOversized,...(coalesce?{wireKind:phase}:{})});for(const value of page.values)auxRows.push({kind:phase,id:rowKey(value),value});sourceBytes+=page.sourceBytes;blocked=page.blocked;continuation=page.nextAfter;}
    }else if(phase==='published-availability'){
      const page=await publicationAvailabilityPage({db,workspaceId,ranges:selection.ranges,cursor:after,maxRows,maxBytes,allowOversized});auxRows.push(...page.auxRows);blocked=page.blocked;continuation=page.nextCursor;
    }else if(phase==='publication'){
      const page=await publicationSelectionPage({db,workspaceId,selection:prepared.publication||{scopeKeys:[],scopeLinks:[]},calendar:selection.calendar,cursor:after,maxRows,maxBytes,allowOversized,instructions});publicationRows.push(...page.rows);auxRows.push(...page.auxRows||[]);blocked=page.blocked;continuation=page.nextCursor;
    }else{
      const query=`SELECT DISTINCT item.id,item.person_id,item.from_date,item.to_date,item.type,item.status,item.version,json_extract(item.config,'$.days') days FROM json_each(?) chosen CROSS JOIN workspace_absences item WHERE item.workspace_id=? AND item.status IN ('approved','pending') AND item.from_date<=json_extract(chosen.value,'$.to') AND item.to_date>=json_extract(chosen.value,'$.from') ${after?'AND item.id>?':''} ORDER BY item.id LIMIT ?`,found=await rows(db,query,JSON.stringify(selection.ranges),workspaceId,...(after?[after.id]:[]),maxRows+1);let bytes=0;let last=null;
      for(const row of found.slice(0,maxRows)){let days;try{days=JSON.parse(row.days);}catch{fail(500,'planning_absence_invalid','Fraværets datoer kunne ikke læses.');}if(!Array.isArray(days)||!days.length||days.length>366||days[0]!==row.from_date||days.at(-1)!==row.to_date||days.some(day=>!Scope.validDate(day)))fail(500,'planning_absence_invalid','Fraværets datoer er ugyldige.');const item={kind:'absence',id:row.id,value:{id:row.id,p:row.person_id,days,type:row.type,status:row.status,version:row.version,dates:row.from_date===row.to_date?row.from_date:row.from_date+' – '+row.to_date}},size=encoder.encode(JSON.stringify(item)).length;if((last||!allowOversized)&&bytes+size>maxBytes)break;auxRows.push(item);bytes+=size;last={id:row.id};}if(last&&found.some(row=>row.id>last.id))continuation=last;blocked=found.length>0&&!last;
    }
    // In particular, after=null must remain null when a later phase's first
    // (possibly very long) row is deferred to the next empty response.
    if(blocked){nextCursor=encodeCursor({...base,phase,after});break;}
    if(continuation){nextCursor=encodeCursor({...base,phase,after:continuation});break;}
    const index=activePhases.indexOf(phase);if(index===activePhases.length-1)break;phase=activePhases[index+1];after=null;
    if(!coalesce&&(records.length||publicationRows.length||auxRows.length)){nextCursor=encodeCursor({...base,phase,after:null});break;}
  }
  const header=await first(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',owner),latestAbsence=(await first(db,'SELECT version FROM workspace_absence_imports WHERE workspace_id=?',workspaceId))?.version||0;if(!header||header.revision!==raw.revision||header.write_token!==raw.source.token||latestAbsence!==absenceVersion)conflict();
  const versions=Object.fromEntries(records.map(row=>[rowKey(row),row.version]));return {revision:raw.revision,...(!cursor?{studio:windowMetadata(raw.studio),selection}:{}),planning:{schema:1,partial:true,projection,versions,absenceVersion,...(instructions==='deferred'?{instructions,deferred:records.filter(row=>row.kind==='series'&&row.value?._instructions||row.kind==='shift'&&row.value?.edit?._instructions).map(row=>rowKey(row))}:{}),metadataHash:await hash(Planning.canonical(Planning.metadata(raw.studio)))},records,publicationRows,auxRows,nextCursor};
}

function pureOwn(studio,projection){const source=(studio.series||[]).find(item=>item.id===projection.seriesId),groupId=projection.groupId||(source&&(source.groupId||source.id)),series=(studio.series||[]).filter(item=>groupId&&(item.groupId||item.id)===groupId),ids=new Set(series.map(item=>item.id));return {groupIds:groupId?[groupId]:[],seriesIds:[...ids],has:row=>row.kind==='series'?ids.has(row.id):row.kind==='shift'&&(ids.has(row.value?.edit?.seriesId)||[...ids].some(id=>row.id.startsWith(id+'@')))};}
function insideSummary(row,ranges){if(row.kind==='series')return ranges.some(range=>row.value.startDate<=range.to&&row.value.endDate>=range.from);if(row.kind!=='shift')return false;return ranges.some(range=>row.value?.edit?.date>=range.from&&row.value.edit.date<=range.to||row.id.slice(-10)>=range.from&&row.id.slice(-10)<=range.to);}
function publicationsFromRows(rows){const state=rows.find(row=>row.kind==='state')?.value,slots={};for(const row of rows)if(row.kind==='scope')slots[row.id]={...clone(row.value.value),shifts:[]};for(const row of rows)if(row.kind==='shift'&&slots[row.value.scopeKey])slots[row.value.scopeKey].shifts.push(clone(row.value.shift));return state?.present?{version:1,sequence:state.value.sequence,scopeLinks:clone(state.value.scopeLinks||[]),slots,records:[]}:undefined;}
export function projectStudioSelection(studio,planning,requested,touched=[]){
  const projection=Scope.normalize(requested);if(projection.mode==='calendar')return projectStudioWindow(studio,planning,projection,touched);
  if(projection.mode==='series-list'&&projection.catalogOnly===true){
    const summaries=Planning.flatten(studio).filter(row=>row.kind==='series'||row.kind==='shift'&&(row.value?.edit?.seriesId||anchorParent(row.id))).sort((one,two)=>one.kind.localeCompare(two.kind)||one.id.localeCompare(two.id)).map(row=>Scope.summary(row.kind,row.id,row.value)),collector=Window.collector(projection,{maxBytes:Infinity,maxRecords:Infinity});
    collector.add({revision:0,studio:windowMetadata(studio),selection:catalogSelection(projection,studio),planning:{schema:1,partial:true,projection,versions:{},metadataHash:planning.metadataHash,...(planning.absenceVersion!==undefined?{absenceVersion:planning.absenceVersion}:{})},records:[],publicationRows:[],auxRows:summaries.map(value=>({kind:'catalog',id:rowKey(value),value})),nextCursor:null});
    const result=collector.finish();return {studio:result.studio,planning:result.planning,catalog:result.catalog,selection:result.selection};
  }
  const calendar=Scope.calendar(projection),background=projectStudioWindow(studio,planning,calendar,touched),all=Planning.flatten(studio),own=projection.mode==='series'?pureOwn(studio,projection):{groupIds:[],seriesIds:[],has:()=>false},pub=projection.mode==='publication'?projectPublicationSelection(studio,projection):null,extra=all.filter(own.has).flatMap(row=>row.kind==='shift'?[row.value?.edit?.date,row.id.slice(-10)].filter(Scope.validDate).map(day=>({from:day,to:day})):[]),ranges=Scope.ranges(projection,[calendar,...extra,...(pub?.scopeInfo?.ranges||[])]),summaries=all.filter(row=>row.kind!=='week').map(row=>Scope.summary(row.kind,row.id,row.value)),availabilityValues=summaries.filter(row=>insideSummary(row,ranges)),parentIds=new Set(availabilityValues.filter(row=>row.kind==='shift').map(row=>row.value?.edit?.seriesId||anchorParent(row.id)).filter(Boolean));for(const row of summaries)if(row.kind==='series'&&parentIds.has(row.id)&&!availabilityValues.some(item=>item.kind==='series'&&item.id===row.id))availabilityValues.push(row);
  const publicationKeys=pub?publicationDraftKeys(summaries,pub.scopeInfo,studio):new Set(),selected=all.filter(row=>own.has(row)||publicationKeys.has(rowKey(row)));const projected=Planning.apply(background.studio,selected);for(const row of selected){const version=planning.versions[rowKey(row)];if(version)background.planning.versions[rowKey(row)]=version;}
  for(const [key,version]of Object.entries(planning.versions)){let pair;try{pair=JSON.parse(key);}catch{continue;}if(pair[0]==='shift'&&own.seriesIds.some(id=>pair[1].startsWith(id+'@'))){background.planning.versions[key]=version;}}
  const publicationRows=pub?.rows||projectPublicationWindow(studio,calendar);projected.publications=publicationsFromRows(publicationRows);if(projected.publications===undefined)delete projected.publications;
  const publishedKeys=new Set(publicationRows.filter(row=>row.kind==='shift').map(row=>JSON.stringify([row.id,row.value.shift.person])));projected.checklistProgress=Object.fromEntries(Object.entries(studio.checklistProgress||{}).filter(([key])=>publishedKeys.has(key)));delete projected.absences;delete projected.requests;delete projected.leaveDecisions;
  const availability=Scope.summaryStudio(availabilityValues);availability.demoSeed=studio.demoSeed!==false;availability.published=Object.values(studio.publications?.slots||{}).flatMap(slot=>slot.shifts).filter(shift=>ranges.some(range=>shift.date>=range.from&&shift.date<=range.to)).map(shift=>Scope.compact('published',shift.id,shift));
  const catalog=Scope.summaryStudio(projection.mode==='series-list'?summaries.filter(row=>row.kind==='series'||row.kind==='shift'&&(row.value?.edit?.seriesId||anchorParent(row.id))):[]),summaryByKey=new Map(summaries.map(row=>[rowKey(row),row]));for(const value of catalog.series)value.hasDescription=summaryByKey.get(Planning.key('series',value.id))?.hasDescription||false;for(const [id,value]of Object.entries(catalog.edits))value.hasDescription=summaryByKey.get(Planning.key('shift',id))?.hasDescription||false;
  const selection={schema:1,mode:projection.mode,calendar,groupIds:own.groupIds,seriesIds:own.seriesIds,ranges,scopes:pub?.scopeInfo?.scopes||[],dependencies:pub?.scopeInfo?.dependencies||[],scopeKeys:pub?.scopeInfo?.scopeKeys||[],catalog:projection.mode==='series-list',demoSeed:studio.demoSeed!==false};
  return {studio:projected,planning:{...background.planning,projection},availability,catalog,selection};
}
