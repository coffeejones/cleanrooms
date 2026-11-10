/* Employee engagement is row-scoped: its writes never replace a planning snapshot. */
import {isScoped,personPredicate,jsonSitePredicate} from './department-access.mjs';
import Workflow from '../src/shift-workflow-model.js';
import Checklist from '../src/checklist-progress.js';
import Publication from '../src/publication-model.js';
import {StudioError} from './studio-store.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[];
const first=async(db,sql,...values)=>(await all(db,sql,...values))[0]||null;
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const ACTIVE="('awaiting_colleague','pending')";
const hash=async value=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const bounded=value=>{const json=JSON.stringify(value);if(new TextEncoder().encode(json).byteLength>512*1024)fail(413,'engagement_record_full','En besked eller anmodning indeholder for mange data.');return json;};
function taskDocuments(tasks){
  const documents=[];let items=[],bytes=2;const encoder=new TextEncoder();
  for(const task of tasks){const value=JSON.stringify(task),size=encoder.encode(value).length;if(size+2>512*1024)fail(413,'checklist_structure_full','En opgaves struktur er for stor til sikker udgivelse.');if(items.length&&bytes+size+1>512*1024){documents.push('['+items.join(',')+']');items=[];bytes=2;}items.push(value);bytes+=size+1;}
  if(items.length||!documents.length)documents.push('['+items.join(',')+']');return documents;
}
export const engagementPlanGuard=context=>({sql:'COALESCE((SELECT revision FROM studio_states WHERE owner_id = ?),0) = ?',values:[context.workspace.snapshotOwnerId,context.saved.revision]});
const and=(...guards)=>({sql:guards.filter(Boolean).map(g=>'('+g.sql+')').join(' AND ')||'1=1',values:guards.filter(Boolean).flatMap(g=>g.values)});

export function messageStatements({db,workspaceId,messages,condition,preserveIds=false}){
  return messages.map(original=>{const message=preserveIds?original:{...original,id:'message-'+crypto.randomUUID()};return query(db,`INSERT INTO workspace_shift_messages (workspace_id,id,person_id,kind,created_at,config)
    SELECT ?,?,?,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id,id) DO NOTHING`,workspaceId,message.id,message.personId,message.kind,message.createdAt,bounded(message),...condition.values);});
}
export function requestStatement({db,workspaceId,request,previous,token,condition}){
  const fields=[request.shift.id,request.kind,request.fromPersonId,request.toPersonId,request.status,request.version,bounded(request),request.updatedAt,token];
  return previous?query(db,`UPDATE workspace_shift_requests SET shift_id=?,kind=?,from_person_id=?,to_person_id=?,status=?,version=?,config=?,updated_at=?,write_token=?
    WHERE workspace_id=? AND id=? AND version=? AND ${condition.sql}`,...fields,workspaceId,request.id,previous.version,...condition.values):query(db,`INSERT INTO workspace_shift_requests
    (shift_id,kind,from_person_id,to_person_id,status,version,config,updated_at,write_token,workspace_id,id)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id,id) DO NOTHING`,...fields,workspaceId,request.id,...condition.values);
}
export function requestVersionGuard(workspaceId,requests){
  if(!requests.length)return {sql:'1=1',values:[]};
  // One JSON binding keeps a transfer with hundreds of competing claims below D1's 100-parameter limit.
  return {sql:`NOT EXISTS (SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS (SELECT 1 FROM workspace_shift_requests actual
    WHERE actual.workspace_id=? AND actual.id=json_extract(expected.value,'$.id') AND actual.version=json_extract(expected.value,'$.version')))`,values:[JSON.stringify(requests.map(({id,version})=>({id,version}))),workspaceId]};
}

/* Import exactly once. Marker, source revision fence and all child inserts are one D1 batch. */
export async function ensureEngagement(db,context,h){
  const workspaceId=context.workspace.id;
  if(await first(db,'SELECT token FROM workspace_engagement_imports WHERE workspace_id=?',workspaceId))return;
  if(h.ensureOperationalSource)await h.ensureOperationalSource(context);
  const studio=context.saved.studio||{},workflow=Workflow.normalize(studio.shiftWorkflow),token=crypto.randomUUID(),stamp=new Date().toISOString();
  const guard=and(h.actorGuard(context),engagementPlanGuard(context));
  const condition={sql:'EXISTS (SELECT 1 FROM workspace_engagement_imports WHERE workspace_id=? AND token=?)',values:[workspaceId,token]};
  const statements=[query(db,`INSERT INTO workspace_engagement_imports (workspace_id,plan_revision,token)
    SELECT ?,?,? WHERE ${guard.sql} ON CONFLICT(workspace_id) DO NOTHING`,workspaceId,context.saved.revision,token,...guard.values)];
  for(const entry of Object.values(Checklist.sanitize(studio.checklistProgress))){
    const structure=await hash(entry.structure);
    for(const [key,signature]of Object.entries(entry.checked))statements.push(query(db,`INSERT INTO workspace_checklist_tasks
      (workspace_id,shift_id,person_id,task_key,signature,structure,checked,version,updated_at)
      SELECT ?,?,?,?,?,?,1,1,? WHERE ${condition.sql} ON CONFLICT DO NOTHING`,workspaceId,entry.shiftId,entry.person,key,await hash(signature),structure,stamp,...condition.values));
  }
  statements.push(...messageStatements({db,workspaceId,messages:workflow.notifications,condition,preserveIds:true}));
  for(const message of workflow.notifications)if(message.readAt)statements.push(query(db,`INSERT INTO workspace_message_receipts (workspace_id,message_id,person_id,read_at)
    SELECT ?,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id,message_id) DO NOTHING`,workspaceId,message.id,message.personId,message.readAt,...condition.values));
  for(const request of workflow.requests)statements.push(requestStatement({db,workspaceId,request,token,condition}));
  await db.batch(statements);
  await h.assertContext(db,context);
  if(!await first(db,'SELECT token FROM workspace_engagement_imports WHERE workspace_id=?',workspaceId))fail(409,'engagement_import_changed','Planen er ændret. Hent den seneste version.');
}

export async function readChecklistProgress(db,context,{personId=null,shifts:providedShifts}={}){
  const studio=context.saved.studio||{},shifts=providedShifts===undefined?Publication.publishedShifts(studio,personId||undefined):providedShifts.filter(shift=>!personId||shift.person===personId),ids=shifts.map(s=>s.id);
  if(!ids.length)return {};
  const shiftById=new Map(shifts.map(shift=>[shift.id,shift])),views=new Map(),progress={};
  for(let start=0;start<ids.length;start+=128){
    const chosen=ids.slice(start,start+128);let after=null;
    while(true){
      // A long checklist can contain many checked tasks. Keep each D1 result and
      // ID document bounded rather than downloading every task in one query.
      const rows=await all(db,`SELECT shift_id,person_id,task_key,signature,structure FROM workspace_checklist_tasks WHERE workspace_id=? AND checked=1
        AND shift_id IN (SELECT value FROM json_each(?))${personId?' AND person_id=?':''}${after?' AND (shift_id,person_id,task_key)>(?,?,?)':''} ORDER BY shift_id,person_id,task_key LIMIT 250`,context.workspace.id,JSON.stringify(chosen),...(personId?[personId]:[]),...(after?[after.shift_id,after.person_id,after.task_key]:[]));
      for(const row of rows){
        const shift=shiftById.get(row.shift_id);if(!shift||shift.person!==row.person_id)continue;
        let view=views.get(shift.id);if(!view){const current=Checklist.read({},shift);view={...current,structure:JSON.stringify(current.tasks.map(task=>task.key)),tasksByKey:new Map(current.tasks.map(task=>[task.key,task]))};view.structureHash=await hash(view.structure);views.set(shift.id,view);}
        const task=view.tasksByKey.get(row.task_key);
        if(!task||view.structureHash!==row.structure||await hash(task.signature)!==row.signature)continue;
        const key=JSON.stringify([shift.id,shift.person]);progress[key]||={version:1,shiftId:shift.id,person:shift.person,structure:view.structure,checked:{}};progress[key].checked[task.key]=task.signature;
      }
      if(rows.length<250)break;after=rows.at(-1);
    }
  }
  return progress;
}
const decodeRow=row=>{try{return JSON.parse(row.config);}catch{fail(500,'engagement_invalid','Beskederne eller anmodningerne kunne ikke læses. Eksisterende data er bevaret.');}};
export async function workflowRequest(db,workspaceId,id){const row=await first(db,'SELECT * FROM workspace_shift_requests WHERE workspace_id=? AND id=?',workspaceId,id);return row?decodeRow(row):null;}
export async function workflowRequestsForShift(db,workspaceId,shiftId){
  const result=[];let after='';while(true){const headers=await all(db,`SELECT id,version,length(CAST(config AS BLOB)) bytes FROM workspace_shift_requests WHERE workspace_id=? AND shift_id=? AND status IN ${ACTIVE} AND id>? ORDER BY id LIMIT 500`,workspaceId,shiftId,after),selected=[];let bytes=0;for(const row of headers){if(selected.length&&bytes+row.bytes>1536*1024)break;if(!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>512*1024)fail(413,'engagement_record_full','En vagtanmodning er for stor til sikker indlæsning.');selected.push(row);bytes+=row.bytes;}if(!selected.length)break;const found=await all(db,`SELECT target.* FROM json_each(?) chosen CROSS JOIN workspace_shift_requests target WHERE target.workspace_id=? AND target.id=json_extract(chosen.value,'$.id') AND target.version=json_extract(chosen.value,'$.version') AND length(CAST(target.config AS BLOB))<=json_extract(chosen.value,'$.bytes') ORDER BY target.id`,JSON.stringify(selected),workspaceId);if(found.length!==selected.length)fail(409,'workflow_changed','Vagtanmodningerne er ændret. Hent listen igen.');result.push(...found.map(decodeRow));if(result.length>Workflow.MAX_REQUESTS)fail(413,'workflow_requests_full','Der er for mange åbne anmodninger på denne vagt. Behandl nogle anmodninger først.');after=selected.at(-1).id;if(selected.length===headers.length&&headers.length<500)break;}return result;
}
export function workflowDepartmentScope(context,{messageAlias='m',requestAlias='workspace_shift_requests'}={}){
 if(!isScoped(context))return {messages:{sql:'1=1',values:[]},requests:{sql:'1=1',values:[]}};
 const recipient=personPredicate(context,messageAlias+'.person_id'),before=jsonSitePredicate(context,messageAlias+'.config','$.before.site'),after=jsonSitePredicate(context,messageAlias+'.config','$.after.site'),site=jsonSitePredicate(context,requestAlias+'.config','$.shift.site'),from=personPredicate(context,requestAlias+'.from_person_id'),to=personPredicate(context,requestAlias+'.to_person_id');
 return {messages:{sql:`(${recipient.sql}) AND (json_type(${messageAlias}.config,'$.before.site')='integer' OR json_type(${messageAlias}.config,'$.after.site')='integer') AND (json_type(${messageAlias}.config,'$.before') IS NULL OR json_type(${messageAlias}.config,'$.before')='null' OR (${before.sql})) AND (json_type(${messageAlias}.config,'$.after') IS NULL OR json_type(${messageAlias}.config,'$.after')='null' OR (${after.sql}))`,values:[...recipient.values,...before.values,...after.values]},requests:{sql:`(${site.sql}) AND (COALESCE(${requestAlias}.from_person_id,'')='' OR (${from.sql})) AND (COALESCE(${requestAlias}.to_person_id,'')='' OR (${to.sql}))`,values:[...site.values,...from.values,...to.values]}};
}
export async function readWorkflow(db,workspaceId,{personId=null,manager=false,limit=500,messageCursor=null,requestCursor=null,from,to,context}={}){
  if(!Number.isInteger(limit)||limit<1||limit>500)fail(400,'workflow_limit_invalid','Vælg højst 500 beskeder eller anmodninger ad gangen.');
  const cursor=value=>{if(value==null)return null;try{const c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),character=>character.charCodeAt(0))));if(!Array.isArray(c)||c.length!==3||![0,1].includes(c[0])||!c.slice(1).every(v=>typeof v==='string'&&v.length<=512)||!Number.isFinite(Date.parse(c[1])))throw Error();return c;}catch{fail(400,'workflow_cursor_invalid','Sidehenvisningen er ugyldig.');}};
  const access=workflowDepartmentScope(context);
  const mc=cursor(messageCursor),rc=cursor(requestCursor),messageScope=(manager?" AND m.kind NOT IN ('reminder','checkout_reminder')":' AND m.person_id=?')+(from&&to?" AND ((json_extract(m.config,'$.before.date') BETWEEN ? AND ?) OR (json_extract(m.config,'$.after.date') BETWEEN ? AND ?))":'')+' AND ('+access.messages.sql+')',messageArgs=[...(manager?[]:[personId]),...(from&&to?[from,to,from,to]:[]),...access.messages.values],requestScope=(manager?'':' AND (from_person_id=? OR to_person_id=?)')+(from&&to?" AND json_extract(config,'$.shift.date') BETWEEN ? AND ?":'')+' AND ('+access.requests.sql+')',requestArgs=[...(manager?[]:[personId,personId]),...(from&&to?[from,to]:[]),...access.requests.values];
  const rows=await db.batch([
    query(db,`SELECT m.id,m.created_at,length(CAST(m.config AS BLOB)) AS bytes,COALESCE(r.read_at,json_extract(m.config,'$.readAt')) AS effective_read_at,CASE WHEN COALESCE(r.read_at,json_extract(m.config,'$.readAt')) IS NULL THEN 1 ELSE 0 END AS priority FROM workspace_shift_messages m${manager?' INDEXED BY workspace_shift_messages_planner':''} LEFT JOIN workspace_message_receipts r ON r.workspace_id=m.workspace_id AND r.message_id=m.id AND r.person_id=m.person_id
      WHERE m.workspace_id=?${messageScope}${mc?' AND (priority<? OR (priority=? AND (m.created_at<? OR (m.created_at=? AND m.id<?))))':''} ORDER BY priority DESC,m.created_at DESC,m.id DESC LIMIT ?`,workspaceId,...messageArgs,...(mc?[mc[0],mc[0],mc[1],mc[1],mc[2]]:[]),limit+1),
    query(db,`SELECT id,version,updated_at,length(CAST(config AS BLOB)) AS bytes,CASE WHEN status IN ${ACTIVE} THEN 1 ELSE 0 END AS priority FROM workspace_shift_requests WHERE workspace_id=?${requestScope}${rc?' AND (priority<? OR (priority=? AND (updated_at<? OR (updated_at=? AND id<?))))':''} ORDER BY priority DESC,updated_at DESC,id DESC LIMIT ?`,workspaceId,...requestArgs,...(rc?[rc[0],rc[0],rc[1],rc[1],rc[2]]:[]),limit+1),
    query(db,`SELECT COUNT(*) AS n FROM workspace_shift_messages m${manager?' INDEXED BY workspace_shift_messages_planner':''} LEFT JOIN workspace_message_receipts r ON r.workspace_id=m.workspace_id AND r.message_id=m.id AND r.person_id=m.person_id WHERE m.workspace_id=?${messageScope} AND r.read_at IS NULL AND json_extract(m.config,'$.readAt') IS NULL`,workspaceId,...messageArgs)
  ]);
  async function hydrate(metadata,kind){const selected=[];let bytes=0;for(const row of metadata){if(selected.length===limit||selected.length&&bytes+row.bytes>1536*1024)break;if(!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>512*1024)fail(413,'engagement_record_full','En besked eller anmodning er for stor til sikker indlæsning.');selected.push(row);bytes+=row.bytes;}const table=kind==='messages'?'workspace_shift_messages':'workspace_shift_requests',loaded=selected.length?await all(db,`SELECT target.* FROM json_each(?) chosen CROSS JOIN ${table} target WHERE target.workspace_id=? AND target.id=json_extract(chosen.value,'$.id') ${kind==='requests'?"AND target.version=json_extract(chosen.value,'$.version')":''} AND length(CAST(target.config AS BLOB))<=json_extract(chosen.value,'$.bytes')`,JSON.stringify(selected),workspaceId):[];if(loaded.length!==selected.length)fail(409,'workflow_changed','Beskederne eller anmodningerne er ændret. Hent listen igen.');const values=new Map(loaded.map(row=>[row.id,row]));return {selected,values};}
  const messages=rows[0]?.results||[],requests=rows[1]?.results||[],messagePage=await hydrate(messages,'messages'),requestPage=await hydrate(requests,'requests');
  const next=(list,page,time)=>list.length>page.selected.length?btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([page.selected.at(-1).priority,page.selected.at(-1)[time],page.selected.at(-1).id])))):null;
  return {version:1,sequence:0,notifications:messagePage.selected.map(row=>({...decodeRow(messagePage.values.get(row.id)),readAt:row.effective_read_at||null})),requests:requestPage.selected.map(row=>decodeRow(requestPage.values.get(row.id))),unreadCount:Number(rows[2]?.results?.[0]?.n||0),pagination:{messages:next(messages,messagePage,'created_at'),requests:next(requests,requestPage,'updated_at')}};
}

export async function hydrateEngagement(db,context,h){
  await ensureEngagement(db,context,h);
  if(!context.saved.studio)return context.saved;
  const manager=context.role?.permissions?.includes('plan'),personId=manager?null:context.member.personId;
  const progress=await readChecklistProgress(db,context,{personId}),workflow=await readWorkflow(db,context.workspace.id,{manager,personId,context:manager?context:undefined});
  context.saved={...context.saved,studio:{...context.saved.studio,checklistProgress:progress,shiftWorkflow:{version:1,sequence:workflow.notifications.reduce((max,message)=>Math.max(max,Number(/^message-(\d+)$/.exec(message.id)?.[1]||0)),0),notifications:workflow.notifications,requests:workflow.requests}}};
  return context.saved;
}

export async function handleChecklistAction({db,context,payload,helpers:h}){
  if(h.capabilities(context).plan||!context.staff?.some(person=>person.id===context.member.personId))fail(403,'checklist_forbidden','Tjeklisten kan kun udfyldes af den tildelte medarbejder.');
  const assigned=h.resolveAssignedShift?await h.resolveAssignedShift(context,payload.shiftId):null;
  await ensureEngagement(db,context,h);
  const studio=context.saved.studio;if(!studio)fail(404,'shift_missing','Vagten findes ikke længere.');
  if(payload.revision!==undefined&&payload.revision!==context.saved.revision)fail(409,'revision_conflict','Planen er ændret. Hent den seneste version.');
  const shift=h.resolveAssignedShift?(assigned?.shift||assigned):Publication.publishedShifts(studio,context.member.personId).find(shift=>shift.id===payload.shiftId);
  if(!shift||shift.person!==context.member.personId)fail(403,'shift_forbidden','Vagten er ikke tildelt din konto.');
  const result=Checklist.set({},shift,{key:payload.key,checked:payload.checked,signature:payload.signature,person:context.member.personId});if(!result.ok)fail(409,'checklist_changed',result.reason);
  const view=Checklist.read({},shift),task=view.tasks.find(task=>task.key===payload.key),guard=and(h.actorGuard(context),engagementPlanGuard(context)),stamp=new Date().toISOString();
  const written=await db.batch([query(db,`INSERT INTO workspace_checklist_tasks (workspace_id,shift_id,person_id,task_key,signature,structure,checked,version,updated_at)
    SELECT ?,?,?,?,?,?,?,1,? WHERE ${guard.sql} ON CONFLICT(workspace_id,shift_id,person_id,task_key) DO UPDATE SET signature=excluded.signature,structure=excluded.structure,checked=excluded.checked,version=workspace_checklist_tasks.version+1,updated_at=excluded.updated_at WHERE ${guard.sql}`,
    context.workspace.id,shift.id,shift.person,task.key,await hash(task.signature),await hash(JSON.stringify(view.tasks.map(task=>task.key))),Number(payload.checked),stamp,...guard.values,...guard.values)]);
  await h.assertContext(db,context);if(written[0]?.meta?.changes!==1)fail(409,'checklist_changed','Planen er ændret. Hent den seneste version.');
  return {revision:context.saved.revision,progress:await readChecklistProgress(db,context,{personId:context.member.personId,shifts:[shift]}),receipt:{shiftId:shift.id,key:payload.key,checked:payload.checked}};
}

/* Prepare before the plan transaction, then append its statements to writeStudio's commit. */
export async function prepareEngagementPlan({db,workspaceId,before,next}){
  const previous=new Set((before.shiftWorkflow?.notifications||[]).map(message=>message.id)),messages=(next.shiftWorkflow?.notifications||[]).filter(message=>!previous.has(message.id));
  return prepareEngagementEffects({db,workspaceId,beforeShifts:Publication.publishedShifts(before),afterShifts:Publication.publishedShifts(next),messages});
}

export async function preparePublicationEngagement({db,workspaceId,beforeShifts,afterShifts,sites,beforeSites,at}){
  const messages=Workflow.publicationMessages(Workflow.empty(),beforeShifts,afterShifts,{sites,beforeSites,at}).notifications;
  return prepareEngagementEffects({db,workspaceId,beforeShifts,afterShifts,messages});
}

async function prepareEngagementEffects({db,workspaceId,beforeShifts,afterShifts,messages}){
  const was=new Map(beforeShifts.map(shift=>[shift.id,shift])),now=new Map(afterShifts.map(shift=>[shift.id,shift])),cleanups=[];
  for(const [id,old]of was){
    const current=now.get(id);if(current&&current.person===old.person&&current.noteRich===old.noteRich)continue;
    if(!current||!current.person){cleanups.push({id});continue;}
    const view=Checklist.read({},current),structure=await hash(JSON.stringify(view.tasks.map(task=>task.key))),tasks=await Promise.all(view.tasks.map(async task=>({key:task.key,signature:await hash(task.signature)})));
    cleanups.push({id,person:current.person,structure,documents:taskDocuments(tasks)});
  }
  return condition=>[
    ...messageStatements({db,workspaceId,messages,condition}),
    ...cleanups.map(clean=>clean.person?query(db,`DELETE FROM workspace_checklist_tasks WHERE workspace_id=? AND shift_id=? AND (person_id<>? OR structure<>? OR NOT EXISTS (SELECT 1 FROM (${clean.documents.map(()=>'SELECT value FROM json_each(?)').join(' UNION ALL ')}) valid_task WHERE json_extract(valid_task.value,'$.key')=task_key AND json_extract(valid_task.value,'$.signature')=signature)) AND ${condition.sql}`,workspaceId,clean.id,clean.person,clean.structure,...clean.documents,...condition.values):query(db,`DELETE FROM workspace_checklist_tasks WHERE workspace_id=? AND shift_id=? AND ${condition.sql}`,workspaceId,clean.id,...condition.values))
  ];
}
