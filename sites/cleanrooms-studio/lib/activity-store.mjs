/* Append-only workspace audit. Recovery snapshots stay bounded; this ledger does not. */
import Data from '../src/studio-data.js';
import Time from '../src/timekeeping-model.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const areasForField={series:'planning',edits:'planning',deleted:'planning',coverageRules:'planning',requests:'leave',leaveDecisions:'leave',roster:'people',organization:'departments',workspaceSettings:'settings',demoSeed:'settings'};
const safeFields=value=>value?Object.fromEntries(['start','end','endDate','breakMinutes','status','comment'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])):null;
const timeLabels={start:'Vagt startet',finish:'Vagt afsluttet',pause:'Pause startet',resume:'Pause afsluttet',correct:'Tid rettet',comment:'Kommentar til timer',approve:'Timer godkendt',reject:'Timer sendt tilbage',reopen:'Timer genåbnet',demo:'Demouge indlæst'};
function decorated(entry){
  const safe=clone(entry),areas=new Set(safe.areas||[]),people=new Set(safe.personIds||[]),requests=new Map(Data.leaveRequests().map(item=>[item.id,item]));
  if(safe.personId)people.add(safe.personId);
  if(safe.kind==='publication')areas.add('planning');
  if(safe.kind==='time')areas.add('time');
  if(safe.kind==='checklist')areas.add('checklist');
  for(const change of safe.changes||[]){
    if(areasForField[change.field])areas.add(areasForField[change.field]);
    if(change.field==='roster'&&change.id)people.add(change.id);
    if(change.field==='requests'&&requests.has(change.id))people.add(requests.get(change.id).p);
    for(const value of [change.before,change.after])if(record(value)){if(value.person)people.add(value.person);if(value.personId)people.add(value.personId);}
  }
  safe.areas=[...areas];safe.personIds=[...people];return safe;
}
export function archiveStatements({db,workspaceId,entries,condition={sql:'1 = 1',values:[]}}){
  if(!entries.length)return [];
  // Bound SQL bindings by bytes as well as event count (comments can be long).
  const encoder=new TextEncoder(),batches=[];let batch=[],bytes=2;
  for(const entry of entries.map(decorated)){
    const size=encoder.encode(JSON.stringify(entry)).byteLength+1;
    if(batch.length&&(bytes+size>512*1024||batch.length>=100)){batches.push(batch);batch=[];bytes=2;}
    batch.push(entry);bytes+=size;
  }
  if(batch.length)batches.push(batch);
  return batches.map(items=>db.prepare(`INSERT INTO workspace_activity (workspace_id,id,at,actor_id,actor_name,kind,areas,person_ids,entry)
    SELECT ?,json_extract(source.value,'$.id'),json_extract(source.value,'$.at'),json_extract(source.value,'$.actor.userId'),
      json_extract(source.value,'$.actor.name'),json_extract(source.value,'$.kind'),json_extract(source.value,'$.areas'),
      json_extract(source.value,'$.personIds'),source.value FROM json_each(?) source
    WHERE ${condition.sql} ON CONFLICT(workspace_id,id) DO NOTHING`).bind(workspaceId,JSON.stringify(items),...condition.values));
}
function eventKey(entry,event){return event.id||JSON.stringify([entry.id,event.at,event.actor,event.operation,event.reason||'',safeFields(event.before),safeFields(event.after)]);}
function timeEvent(entry,event,id){
  return {id,at:event.at,actor:clone(event.actor),kind:'time',summary:timeLabels[event.operation]||'Tidsregistrering ændret',personId:entry.personId,personIds:[entry.personId],date:entry.date,shiftId:entry.shiftId,timeEntryId:entry.id,timeOperation:event.operation,demo:entry.demo===true,reason:event.reason||'',revision:0,counts:{total:1},changes:[{field:'time',id:entry.id,before:safeFields(event.before),after:safeFields(event.after)}],recoverable:false,areas:['time']};
}
export function timeActivityStatements({db,context,next,previous,condition}){
  const existing=new Set((previous.entries||[]).flatMap(entry=>(entry.audit||[]).map(event=>eventKey(entry,event)))),entries=[];
  for(const entry of next.entries||[])for(const event of entry.audit||[]){
    if(!event.id||existing.has(eventKey(entry,event)))continue;
    entries.push(timeEvent(entry,event,event.id));
  }
  return archiveStatements({db,workspaceId:context.workspace.id,entries,condition});
}
async function legacyTimeId(entry,event){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(eventKey(entry,event)));
  return 'legacy-time-'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function legacyTimeActivityStatements({db,context,entries,condition}){
  const result=[];let pending=[];
  for(const entry of entries)for(const event of entry.audit||[]){
    if(!event.actor?.userId||!event.actor?.name||!event.at)continue;
    pending.push(timeEvent(entry,event,event.id||await legacyTimeId(entry,event)));
    if(pending.length===50){result.push(...archiveStatements({db,workspaceId:context.workspace.id,entries:pending,condition}));pending=[];}
  }
  if(pending.length)result.push(...archiveStatements({db,workspaceId:context.workspace.id,entries:pending,condition}));
  return result;
}
async function backfill(db,context,h){
  const acl=h.actorGuard(context,['plan']),condition={sql:acl.sql,values:acl.values};
  const imported=await h.first(db,'SELECT * FROM workspace_activity_imports WHERE workspace_id = ?',context.workspace.id);
  const retained=context.saved.studio?.activity||[];
  if(imported?.plan_revision!==context.saved.revision&&retained.length)await db.batch(archiveStatements({db,workspaceId:context.workspace.id,entries:retained,condition}));
  const header=await h.first(db,'SELECT version FROM workspace_timekeeping WHERE workspace_id = ?',context.workspace.id);
  const timeVersion=header?.version||0;
  const ledger=imported?.time_version===timeVersion?null:await h.first(db,'SELECT config FROM workspace_timekeeping WHERE workspace_id = ?',context.workspace.id);
  if(ledger){
    let document;try{document=JSON.parse(ledger.config);if(document.schema!==2&&!Array.isArray(document.entries))throw Error('invalid');}catch{h.fail(500,'time_ledger_invalid','Tidsregistreringernes historik kunne ikke læses.');}
    let pending=[];
    for(const entry of document.entries||[])for(const event of entry.audit||[]){
      if(!event.actor?.userId||!event.actor?.name||!event.at)continue;
      const id=event.id||await legacyTimeId(entry,event);pending.push(timeEvent(entry,event,id));
      if(pending.length===50){await db.batch(archiveStatements({db,workspaceId:context.workspace.id,entries:pending,condition}));pending=[];}
    }
    if(pending.length)await db.batch(archiveStatements({db,workspaceId:context.workspace.id,entries:pending,condition}));
  }
  if(imported?.plan_revision!==context.saved.revision||imported?.time_version!==timeVersion)await db.batch([db.prepare(`INSERT INTO workspace_activity_imports (workspace_id,plan_revision,time_version)
    SELECT ?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id) DO UPDATE SET plan_revision = excluded.plan_revision,time_version = excluded.time_version`).bind(context.workspace.id,context.saved.revision,timeVersion,...condition.values)]);
}
const boundedText=(value,max=512)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function dayStart(value){
  const wall=Date.parse(value+'T00:00:00Z');let instant=wall;
  for(let i=0;i<3;i++)instant=wall-Time.copenhagenOffset(instant)*60000;
  return new Date(instant).toISOString();
}
export async function readActivity({db,context,payload,helpers:h}){
  if(!h.capabilities(context).plan)h.fail(403,'activity_forbidden','Kun planlæggere kan se arbejdsområdets historik.');
  const filters=payload.filters??{};if(!record(filters))h.fail(400,'activity_filter_invalid','Historikkens filtre er ugyldige.');
  const allowed=new Set(['from','to','actorId','personId','area','kind','q']);
  if(Object.keys(filters).some(key=>!allowed.has(key)))h.fail(400,'activity_filter_invalid','Historikkens filtre er ugyldige.');
  const limit=payload.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)h.fail(400,'activity_limit_invalid','Vælg højst 100 historikposter ad gangen.');
  for(const key of ['from','to'])if(filters[key]&&!validDate(filters[key]))h.fail(400,'activity_date_invalid','Vælg en gyldig periode.');
  if(filters.to==='9999-12-31')h.fail(400,'activity_date_invalid','Vælg en gyldig slutdato.');
  if(filters.from&&filters.to&&filters.to<filters.from)h.fail(400,'activity_date_invalid','Slutdato skal ligge efter startdato.');
  for(const key of ['actorId','personId','area','kind','q'])if(filters[key]!==undefined&&!boundedText(filters[key],key==='q'?300:512))h.fail(400,'activity_filter_invalid','Et historikfilter er ugyldigt.');
  let cursor=null;if(payload.cursor){try{cursor=JSON.parse(atob(payload.cursor));if(!Array.isArray(cursor)||cursor.length!==2||typeof cursor[0]!=='string'||!Number.isFinite(Date.parse(cursor[0]))||!boundedText(cursor[1],1024))throw Error('invalid');}catch{h.fail(400,'activity_cursor_invalid','Historikkens sidehenvisning er ugyldig.');}}
  await h.assertContext(db,context);await backfill(db,context,h);
  const clauses=['workspace_id = ?'],values=[context.workspace.id],add=(sql,value)=>{clauses.push(sql);values.push(value);};
  const caps=h.capabilities(context),canReadAccess=caps.manageUsers||caps.manageRoles;
  if(!canReadAccess)clauses.push("kind <> 'access'");
  if(filters.from)add('at >= ?',dayStart(filters.from));
  if(filters.to)add('at < ?',dayStart(Time.addDays(filters.to,1)));
  if(filters.actorId&&filters.actorId!=='all')add('actor_id = ?',filters.actorId);
  if(filters.personId&&filters.personId!=='all')add('EXISTS (SELECT 1 FROM json_each(person_ids) person WHERE person.value = ?)',filters.personId);
  if(filters.area&&filters.area!=='all')add('EXISTS (SELECT 1 FROM json_each(areas) area WHERE area.value = ?)',filters.area);
  if(filters.kind&&filters.kind!=='all')add('kind = ?',filters.kind);
  if(filters.q?.trim()){
    const q='%'+filters.q.trim().replace(/[\\%_]/g,'\\$&')+'%';
    clauses.push("(actor_name LIKE ? ESCAPE '\\' OR json_extract(entry,'$.summary') LIKE ? ESCAPE '\\' OR json_extract(entry,'$.reason') LIKE ? ESCAPE '\\')");values.push(q,q,q);
  }
  if(cursor){clauses.push('(at < ? OR (at = ? AND id < ?))');values.push(cursor[0],cursor[0],cursor[1]);}
  const result=await h.rows(db,`SELECT id,at,entry FROM workspace_activity WHERE ${clauses.join(' AND ')} ORDER BY at DESC,id DESC LIMIT ?`,...values,limit+1);
  const actors=await h.rows(db,"SELECT actor_id AS userId,MAX(actor_name) AS name FROM workspace_activity WHERE workspace_id = ?"+(canReadAccess?'':" AND kind <> 'access'")+" GROUP BY actor_id ORDER BY name,actor_id",context.workspace.id);
  await h.assertContext(db,context);
  const hasMore=result.length>limit,selected=result.slice(0,limit),last=selected.at(-1);
  return {entries:selected.map(item=>JSON.parse(item.entry)),hasMore,nextCursor:hasMore&&last?btoa(JSON.stringify([last.at,last.id])):null,actors,legacyNotice:'Ældre historik omfatter de poster, der stadig var bevaret ved opdateringen. Nye handlinger gemmes løbende i det samlede historikarkiv.'};
}
