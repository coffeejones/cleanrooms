/* Company-owned absence requests. Snapshot fields are compatibility projections only. */
import {isScoped,personPredicate,assertPersonAccess} from './department-access.mjs';
import Data from '../src/studio-data.js';
import Time from '../src/timekeeping-model.js';
import Series from '../src/series-engine.js';
import {StudioError} from './studio-store.mjs';
import {archiveStatements} from './activity-store.mjs';
import {employeeReferenceGuard} from './directory-references.mjs';
import {readDirectoryRecords} from './directory-store.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[];
const first=async(...args)=>(await all(...args))[0]||null;
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export const ABSENCE_ENTRY_BYTES=512*1024,ABSENCE_PAGE_BYTES=1536*1024;
const encode=new TextEncoder();
const decode=row=>{try{const entry=JSON.parse(row.config);if(!entry||typeof entry!=='object'||entry.id!==row.id||entry.p!==row.person_id||entry.version!==row.version||entry.status!==row.status||entry.type!==row.type||!Array.isArray(entry.days)||entry.days.length<1||entry.days.length>366||entry.days[0]!==row.from_date||entry.days.at(-1)!==row.to_date)throw Error('shape');return entry;}catch{fail(500,'absence_invalid','Fraværet kunne ikke læses. Eksisterende data er bevaret.');}};
const period=days=>({from:days[0],to:days.at(-1)});
export const readAbsenceImportHeader=(db,workspaceId)=>first(db,'SELECT * FROM workspace_absence_imports WHERE workspace_id=?',workspaceId);
async function peopleFor(db,workspaceId,requests){
  const ids=[...new Set(requests.map(entry=>entry.p))];if(!ids.length)return [];
  const loaded=await readDirectoryRecords({db,workspaceId,kind:'employee',ids,catalog:true});
  return loaded.records.filter(row=>row.value).map(({value})=>({id:value.id,name:value.name,initials:value.initials}));
}
const cursorEncode=value=>btoa(String.fromCharCode(...encode.encode(JSON.stringify(value))));
function cursorDecode(value){try{if(typeof value!=='string'||value.length>8192)throw Error();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),letter=>letter.charCodeAt(0))));}catch{fail(400,'leave_cursor_invalid','Sidehenvisningen er ugyldig.');}}
async function readFence(db,workspaceId){const [absence,directory]=await Promise.all([readAbsenceImportHeader(db,workspaceId),first(db,'SELECT version FROM workspace_directory_state WHERE workspace_id=?',workspaceId)]);if(!absence||!directory)fail(409,'leave_changed','Fraværet eller medarbejderne er ændret. Hent listen igen.');return {absence:absence.version,directory:directory.version};}

async function absencePage(db,clauses,values,{limit=40,bytes=ABSENCE_PAGE_BYTES,cursor=null}={}){
  const where=[...clauses],args=[...values];
  if(cursor){where.push('(from_date<? OR (from_date=? AND id<?))');args.push(cursor[0],cursor[0],cursor[1]);}
  // Size metadata comes first: never materialize hundreds of long comments in D1.
  const metadata=await all(db,`SELECT id,from_date,version,length(CAST(config AS BLOB)) AS bytes FROM workspace_absences WHERE ${where.join(' AND ')} ORDER BY from_date DESC,id DESC LIMIT ?`,...args,limit+1);
  const selected=[];let used=0;
  for(const item of metadata){if(selected.length===limit||used+item.bytes>bytes)break;if(item.bytes>ABSENCE_ENTRY_BYTES)fail(413,'leave_entry_too_large','En ældre fraværsanmodning er for stor. Kontakt administratoren for sikker arkivering.');selected.push(item);used+=item.bytes;}
  if(metadata.length&&!selected.length)fail(413,'leave_entry_too_large','En ældre fraværsanmodning er for stor. Kontakt administratoren for sikker arkivering.');
  // A concurrent decision must not replace a size-checked row with a larger one.
  // CROSS JOIN keeps the small metadata list outermost and uses the tenant/id
  // primary key, rather than scanning a company's rows for every JSON element.
  const rows=selected.length?await all(db,`SELECT a.* FROM json_each(?) chosen CROSS JOIN workspace_absences a
    WHERE a.workspace_id=? AND a.id=json_extract(chosen.value,'$.id') AND a.version=json_extract(chosen.value,'$.version')
    AND length(CAST(a.config AS BLOB))<=json_extract(chosen.value,'$.bytes')
    ORDER BY a.from_date DESC,a.id DESC`,JSON.stringify(selected),values[0]):[];
  if(rows.length!==selected.length)fail(409,'leave_changed','Fraværet er ændret. Hent listen igen.');
  const last=selected.at(-1),hasMore=metadata.length>selected.length;
  return {requests:rows.map(decode),hasMore,nextCursor:hasMore?btoa(JSON.stringify([last.from_date,last.id])):null,bytes:used};
}

export async function ensureAbsences(db,context,h){
  const workspaceId=context.workspace.id;
  let header=await readAbsenceImportHeader(db,workspaceId);
  if(!header){
    if(h.ensureOperationalSource)await h.ensureOperationalSource(context);
    const stamp=new Date().toISOString(),guard=h.actorGuard(context),studio=context.saved.studio||{};
    const savedSource=context.saved.source,directory=await first(db,'SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?',workspaceId);
    if(!savedSource||savedSource.workspaceId!==workspaceId||!directory)fail(409,'absence_import_required','Fraværets oprindelige oplysninger skal indlæses, før de kan overføres.');
    const sourceGuard={sql:'EXISTS (SELECT 1 FROM studio_states WHERE owner_id=? AND revision=? AND write_token=?) AND EXISTS (SELECT 1 FROM workspace_directory_state WHERE workspace_id=? AND version=? AND write_token=?)',values:[context.workspace.snapshotOwnerId,savedSource.revision,savedSource.token,workspaceId,directory.version,directory.write_token]};
    const importGuard={sql:'('+guard.sql+') AND ('+sourceGuard.sql+')',values:[...guard.values,...sourceGuard.values]};
    const legacy=Data.leaveRequests(),people=await all(db,"SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND deleted=0 AND id IN (SELECT value FROM json_each(?))",workspaceId,JSON.stringify(legacy.map(item=>item.p))),known=new Set(people.map(person=>person.id)),source=legacy.filter(item=>known.has(item.p));
    const condition={sql:'EXISTS (SELECT 1 FROM workspace_absence_imports WHERE workspace_id=?) AND '+importGuard.sql,values:[workspaceId,...importGuard.values]};
    const statements=[query(db,`INSERT INTO workspace_absence_imports (workspace_id,version,imported_at) SELECT ?,0,? WHERE ${importGuard.sql} ON CONFLICT DO NOTHING`,workspaceId,stamp,...importGuard.values)];
    for(const item of source){
      const decision=studio.leaveDecisions?.[item.id],entry={...item,status:studio.requests?.[item.id]||item.status,version:1,comment:'',legacy:true,...(decision?{decision:clone(decision)}:{})},range=period(item.days);
      statements.push(query(db,`INSERT INTO workspace_absences (workspace_id,id,person_id,from_date,to_date,type,status,version,config,write_token,updated_at)
        SELECT ?,?,?,?,?,?,?,1,?,'legacy',? WHERE ${condition.sql} ON CONFLICT DO NOTHING`,workspaceId,item.id,item.p,range.from,range.to,item.type,entry.status,JSON.stringify(entry),stamp,...condition.values));
    }
    await db.batch(statements);header=await readAbsenceImportHeader(db,workspaceId);
    if(!header){await h.assertContext?.(db,context);fail(409,'absence_import_changed','De oprindelige oplysninger er ændret. Hent fraværet igen.');}
  }
  context.absenceVersion=header.version;
  return header;
}

export async function hydrateAbsences(db,context,h){
  const workspaceId=context.workspace.id,header=await ensureAbsences(db,context,h);
  const clauses=['workspace_id=?'],args=[workspaceId];if(!h.capabilities(context).plan){clauses.push('person_id=?');args.push(context.member.personId);}
  // The three compatibility examples remain available to older editors. Real
  // requests are a bounded first-page projection; leaveRead reaches all history.
  const legacyIds=Data.leaveRequests().map(item=>item.id),legacy=await absencePage(db,[...clauses,'id IN (SELECT value FROM json_each(?))'],[...args,JSON.stringify(legacyIds)],{limit:legacyIds.length,bytes:ABSENCE_ENTRY_BYTES});
  const recent=await absencePage(db,[...clauses,'id NOT IN (SELECT value FROM json_each(?))'],[...args,JSON.stringify(legacyIds)],{limit:100,bytes:ABSENCE_PAGE_BYTES-legacy.bytes});
  context.absenceVersion=header.version;
  if(context.saved.studio){
    const absences=[...recent.requests,...legacy.requests],requests=Object.fromEntries(absences.map(item=>[item.id,item.status])),decisions=Object.fromEntries(absences.filter(item=>item.decision).map(item=>[item.id,item.decision]));
    context.saved={...context.saved,studio:{...context.saved.studio,absences,requests,leaveDecisions:decisions,absenceHasMore:recent.hasMore}};
  }
}

export function absenceGuard(context){return {sql:'EXISTS (SELECT 1 FROM workspace_absence_imports WHERE workspace_id=? AND version=?)',values:[context.workspace.id,context.absenceVersion]};}

// Legacy planners can still save decisions with their plan; archive and rows commit together.
export function absencePlanStatements({db,context,before,next,condition}){
  const entries=Data.leaveRequests(before),byId=new Map(entries.map(item=>[item.id,item])),changes=[];
  for(const [id,status]of Object.entries(next.requests||{})){
    const old=byId.get(id);if(!old){if(id.startsWith('absence-'))continue;fail(404,'leave_missing','Fraværsanmodningen findes ikke. Hent siden igen.');}
    if(status===old.status)continue;
    const entry={...old,status,version:old.version+1,decision:clone(next.leaveDecisions[id])};changes.push(entry);
  }
  const statements=[];
  for(const entry of changes)statements.push(query(db,`UPDATE workspace_absences SET status=?,version=?,config=?,write_token=?,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${condition.sql}`,
    entry.status,entry.version,JSON.stringify(entry),entry.decision.decidedAt,entry.decision.decidedAt,context.workspace.id,entry.id,entry.version-1,...condition.values));
  if(changes.length)statements.push(query(db,`UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=? AND ${condition.sql}`,context.workspace.id,...condition.values));
  next.absences=entries.map(item=>changes.find(change=>change.id===item.id)||item);return statements;
}

export async function assertNoPublishedAbsence(db,workspaceId,shifts){
  for(let offset=0;offset<shifts.length;offset+=1000){
    const selected=shifts.slice(offset,offset+1000).filter(shift=>shift.person).flatMap(shift=>Series.shiftDates(shift).map(date=>({person:shift.person,date})));
    if(!selected.length)continue;
    const conflict=await first(db,`SELECT a.id,a.from_date FROM workspace_absences a JOIN json_each(?) s
      ON a.person_id=json_extract(s.value,'$.person') AND json_extract(s.value,'$.date') BETWEEN a.from_date AND a.to_date
      WHERE a.workspace_id=? AND a.status='approved' LIMIT 1`,JSON.stringify(selected),workspaceId);
    if(conflict)fail(400,'publication_leave','En medarbejder har godkendt fravær i perioden. Ret vagten, før perioden udgives.');
  }
}

export async function handleAbsenceAction({db,context,payload,principal,helpers:h}){
  const manager=h.capabilities(context).plan,workspaceId=context.workspace.id,stamp=new Date().toISOString(),personId=manager?payload.personId:context.member.personId;
  if(!manager&&!personId)fail(403,'leave_forbidden','Kontoen skal være knyttet til en medarbejder.');
  if(!manager&&payload.personId&&payload.personId!==personId)fail(403,'leave_forbidden','Du kan kun se dit eget fravær.');
  if(manager&&personId)await assertPersonAccess({db,context,personId});
  if(payload.action==='leaveRead'){
    const fence=await readFence(db,workspaceId);
    const limit=payload.limit??100;if(!Number.isInteger(limit)||limit<1||limit>500)fail(400,'leave_limit_invalid','Vælg højst 500 anmodninger ad gangen.');
    const clauses=['workspace_id=?'],values=[workspaceId];
    if(manager&&isScoped(context)){const access=personPredicate(context,'workspace_absences.person_id');clauses.push(access.sql);values.push(...access.values);}
    if(personId&&(typeof personId!=='string'||!await first(db,"SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=? AND deleted=0",workspaceId,personId)))fail(404,'leave_person_invalid','Medarbejderen findes ikke i arbejdsområdet.');
    if(personId){clauses.push('person_id=?');values.push(personId);}
    for(const [key,sql]of [['from','to_date>=?'],['to','from_date<=?']])if(payload[key]){if(!Time.validDate(payload[key])||payload[key]<Data.minDate||payload[key]>Data.maxDate)fail(400,'leave_date_invalid','Vælg en gyldig dato.');clauses.push(sql);values.push(payload[key]);}
    if(payload.from&&payload.to&&payload.from>payload.to)fail(400,'leave_date_invalid','Fra-dato skal være før til-dato.');
    if(payload.type&&payload.type!=='all'){if(!['Ferie','Friønske','Sygdom','Andet'].includes(payload.type))fail(400,'leave_type_invalid','Vælg en gyldig fraværstype.');clauses.push('type=?');values.push(payload.type);}
    if(payload.q!==undefined){if(!text(payload.q,120))fail(400,'leave_search_invalid','Søg efter et medarbejdernavn på højst 120 tegn.');const search=payload.q.trim().toLocaleLowerCase('da-DK');if(search){clauses.push("person_id IN (SELECT id FROM workspace_directory_records employee WHERE employee.workspace_id=? AND employee.kind='employee' AND employee.deleted=0 AND instr(employee.name_sort,?)>0)");values.push(workspaceId,search);}}
    const counts={pending:0,approved:0,rejected:0,all:0};for(const row of await all(db,`SELECT status,COUNT(*) AS total FROM workspace_absences WHERE ${clauses.join(' AND ')} GROUP BY status`,...values)){if(Object.hasOwn(counts,row.status))counts[row.status]=row.total;counts.all+=row.total;}
    if(payload.status&&payload.status!=='all'){if(!['pending','approved','rejected'].includes(payload.status))fail(400,'leave_status_invalid','Vælg en gyldig status.');clauses.push('status=?');values.push(payload.status);}
    const scope=JSON.stringify({...(manager&&isScoped(context)?{access:context.accessScope,memberVersion:context.member.version,roleVersion:context.role.version}:{}),personId:personId||null,from:payload.from||null,to:payload.to||null,type:payload.type||'all',status:payload.status||'all',q:(payload.q||'').trim().toLocaleLowerCase('da-DK')});
    let cursor=null;if(payload.cursor){const value=cursorDecode(payload.cursor);if(Array.isArray(value))cursor=value;else{if(!value||value.v!==2||!Array.isArray(value.after))fail(400,'leave_cursor_invalid','Sidehenvisningen er ugyldig.');if(value.workspace!==workspaceId||value.scope!==scope||value.absence!==fence.absence||value.directory!==fence.directory)fail(409,'leave_changed','Fraværet eller filtrene er ændret. Hent listen igen.');cursor=value.after;}if(cursor.length!==2||!Time.validDate(cursor[0])||!text(cursor[1],512))fail(400,'leave_cursor_invalid','Sidehenvisningen er ugyldig.');}
    const page=await absencePage(db,clauses,values,{limit,cursor});
    const people=await peopleFor(db,workspaceId,page.requests),current=await readFence(db,workspaceId);if(current.absence!==fence.absence||current.directory!==fence.directory)fail(409,'leave_changed','Fraværet eller medarbejderne er ændret. Hent listen igen.');
    const nextCursor=page.nextCursor?cursorEncode({v:2,workspace:workspaceId,scope,...fence,after:JSON.parse(atob(page.nextCursor))}):null;
    await h.assertContext(db,context);return {requests:page.requests,people,hasMore:page.hasMore,nextCursor,counts};
  }
  const actor=h.actorGuard(context,manager?['plan']:[]),plan={sql:'EXISTS (SELECT 1 FROM studio_states WHERE owner_id=? AND revision=?)',values:[context.workspace.snapshotOwnerId,context.saved.revision]},token=crypto.randomUUID();
  const acl={sql:actor.sql+' AND '+plan.sql,values:[...actor.values,...plan.values]};let entry,write;
  if(payload.action==='leaveCreate'){
    const sickness=payload.recordSickness===true;
    if(sickness&&!manager)fail(403,'leave_sickness_forbidden','Kun planlæggeren kan registrere en sygemelding.');
    if(sickness&&payload.type!=='Sygdom')fail(400,'leave_sickness_invalid','En sygemelding skal have typen Sygdom.');
    if(!await first(db,"SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=? AND deleted=0 AND active=1",workspaceId,personId))fail(400,'leave_person_invalid','Vælg en aktiv medarbejder.');
    if(!Time.validDate(payload.from)||!Time.validDate(payload.to)||payload.from<Data.minDate||payload.to>Data.maxDate||payload.to<payload.from||(Date.parse(payload.to)-Date.parse(payload.from))/86400000>365)fail(400,'leave_date_invalid','Vælg en gyldig periode på højst 366 dage.');
    if(!['Ferie','Friønske','Sygdom','Andet'].includes(payload.type)||!text(payload.comment||'',100000))fail(400,'leave_request_invalid','Vælg fraværstype og en gyldig kommentar.');
    const days=[];for(let day=payload.from;;day=Time.addDays(day,1)){days.push(day);if(day===payload.to)break;}
    if(sickness&&await first(db,"SELECT id FROM workspace_absences WHERE workspace_id=? AND person_id=? AND type='Sygdom' AND status='approved' AND from_date<=? AND to_date>=? LIMIT 1",workspaceId,personId,payload.to,payload.from))fail(409,'leave_sickness_exists','Der er allerede registreret sygdom i perioden. Åbn Fravær for at se registreringen.');
    entry={id:'absence-'+crypto.randomUUID(),p:personId,days,dates:payload.from===payload.to?payload.from:payload.from+' – '+payload.to,type:payload.type,status:sickness?'approved':'pending',version:1,comment:(payload.comment||'').trim(),createdAt:stamp,createdBy:{userId:principal.userId,name:principal.name},...(sickness?{decision:{status:'approved',reason:'',decidedBy:{userId:principal.userId,name:principal.name},decidedAt:stamp}}:{})};
    const person=employeeReferenceGuard({workspaceId,personIds:[personId],active:true});
    const duplicate=sickness?{sql:" AND NOT EXISTS (SELECT 1 FROM workspace_absences WHERE workspace_id=? AND person_id=? AND type='Sygdom' AND status='approved' AND from_date<=? AND to_date>=?)",values:[workspaceId,personId,payload.to,payload.from]}:{sql:'',values:[]};
    write=query(db,`INSERT INTO workspace_absences (workspace_id,id,person_id,from_date,to_date,type,status,version,config,write_token,updated_at) SELECT ?,?,?,?,?,?,?,1,?,?,? WHERE ${acl.sql} AND ${person.sql}${duplicate.sql}`,workspaceId,entry.id,personId,payload.from,payload.to,entry.type,entry.status,JSON.stringify(entry),token,stamp,...acl.values,...person.values,...duplicate.values);
  }else if(payload.action==='leaveDecide'){
    if(!manager)fail(403,'leave_forbidden','Kun planlæggeren kan behandle fravær.');
    const header=await first(db,'SELECT id,version,length(CAST(config AS BLOB)) AS bytes FROM workspace_absences WHERE workspace_id=? AND id=?',workspaceId,payload.id);
    if(!header)fail(404,'leave_missing','Anmodningen findes ikke.');
    if(header.bytes>ABSENCE_ENTRY_BYTES)fail(413,'leave_entry_too_large','Fraværsanmodningen er for stor til at kunne behandles sikkert. Kontakt administratoren.');
    const row=await first(db,'SELECT * FROM workspace_absences WHERE workspace_id=? AND id=? AND version=? AND length(CAST(config AS BLOB))<=?',workspaceId,payload.id,header.version,header.bytes);
    if(!row)fail(409,'leave_changed','Anmodningen er ændret. Hent den igen.');
    await assertPersonAccess({db,context,personId:row.person_id});
    if(!Number.isSafeInteger(payload.version)||payload.version!==row.version)fail(409,'leave_changed','Anmodningen er ændret. Hent den igen.');
    if(row.status!=='pending')fail(409,'leave_changed','Anmodningen er allerede behandlet.');
    if(!['approved','rejected'].includes(payload.status)||!text(payload.reason||'',16000))fail(400,'leave_status_invalid','Vælg et gyldigt svar.');
    if(payload.status==='rejected'&&!payload.reason?.trim())fail(400,'leave_reason_required','Skriv en begrundelse for afvisningen.');
    entry={...decode(row),version:row.version+1,status:payload.status,decision:{status:payload.status,reason:(payload.reason||'').trim(),decidedBy:{userId:principal.userId,name:principal.name},decidedAt:stamp}};
    write=query(db,`UPDATE workspace_absences SET status=?,version=?,config=?,write_token=?,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${acl.sql}`,entry.status,entry.version,JSON.stringify(entry),token,stamp,workspaceId,entry.id,row.version,...acl.values);
  }else fail(400,'leave_operation_invalid','Ukendt fraværshandling.');
  const condition={sql:'EXISTS (SELECT 1 FROM workspace_absences WHERE workspace_id=? AND id=? AND write_token=?)',values:[workspaceId,entry.id,token]};
  if(encode.encode(JSON.stringify(entry)).byteLength>ABSENCE_ENTRY_BYTES)fail(413,'leave_entry_too_large','Fraværsanmodningen fylder for meget til én handling.');
  const audit={id:'absence-event-'+token,at:stamp,actor:{userId:principal.userId,name:principal.name},kind:'leave',summary:payload.action==='leaveCreate'?payload.recordSickness===true?'Sygemelding registreret':'Fraværsanmodning oprettet':entry.status==='approved'?'Fravær godkendt':'Fravær afvist',personIds:[entry.p],areas:['leave'],reason:entry.decision?.reason||'',counts:{total:1},changes:[{field:'requests',id:entry.id,after:entry.status}],revision:0,recoverable:false};
  const result=await db.batch([write,query(db,`UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=? AND ${condition.sql}`,workspaceId,...condition.values),...archiveStatements({db,workspaceId,entries:[audit],condition})]);
  if(result[0]?.meta?.changes!==1)fail(409,'leave_changed','Anmodningen, planen eller din adgang er ændret. Hent siden igen.');
  const people=await peopleFor(db,workspaceId,[entry]);await h.assertContext(db,context);return {request:entry,people};
}
