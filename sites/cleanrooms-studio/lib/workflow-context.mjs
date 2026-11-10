/* Workflow authority is selected by request/occurrence identities, never a company plan. */
import {isScoped,siteAllowed,personPredicate} from './department-access.mjs';
import Data from '../src/studio-data.js';
import Time from '../src/timekeeping-model.js';
import Series from '../src/series-engine.js';
import Scope from '../src/planning-scope.js';
import Planning from '../src/planning-records.js';
import Directory from '../src/directory-records.js';
import {readPlanningRecords} from './planning-store.mjs';
import {ensurePlanningSchedules,readPlanningScheduleSummaries} from './planning-selection-store.mjs';
import {readPublishedEmployeePage,readEmployeePublishedShift,readPublicationCommandContext} from './publication-store.mjs';
import {publishedConflictNeighbors} from './publication-command.mjs';
import {readDirectoryRecords} from './directory-store.mjs';
import {directoryPlanningContext} from './directory-references.mjs';
import {initializeTimekeepingContext,assertTimekeepingContext} from './timekeeping-context.mjs';
import {ensureAbsences} from './absence-store.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const encodeCursor=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const decodeCursor=value=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),letter=>letter.charCodeAt(0))));
const query=(db,sql,...values)=>db.prepare(sql).bind(...values),all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[];
const chunks=(values,size=100)=>Array.from({length:Math.ceil(values.length/size)},(_,index)=>values.slice(index*size,(index+1)*size));
const week=day=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const from=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {from,to:date.toISOString().slice(0,10)};};

export async function createWorkflowContext({db,context,payload,helpers:h,local}){
  const workspaceId=context.workspace.id,owner=context.workspace.snapshotOwnerId,scopedManager=context.role.permissions.includes('plan')&&isScoped(context);
  const accessContext=scopedManager?context:undefined;
  const period=payload.from!==undefined||payload.to!==undefined?{from:payload.from,to:payload.to}:null;
  if(period&&(!Time.validDate(period.from)||!Time.validDate(period.to)||period.from<Data.minDate||period.to>Data.maxDate||period.from>period.to||(Date.parse(period.to)-Date.parse(period.from))/86400000>=56))h.fail(400,'workflow_period_invalid','Vælg højst 56 gyldige kalenderdage.');
  const limit=payload.limit??500;if(!Number.isInteger(limit)||limit<1||limit>500)h.fail(400,'workflow_limit_invalid','Vælg højst 500 poster ad gangen.');
  let frame=await initializeTimekeepingContext({db,context,helpers:h});await ensureAbsences(db,context,h);
  const people=new Map(),members=new Map(),published=new Map(),planRows=new Map(),planVersions={},sites=[];let draft={series:[],edits:{},deleted:[],weekPlans:{}},workingBytes=0;
  async function loadPeople(ids){
    for(const batch of chunks([...new Set(ids.filter(id=>Directory.validId('employee',id)))].filter(id=>!people.has(id)),500)){
      const loaded=await readDirectoryRecords({db,workspaceId,kind:'employee',ids:batch,catalog:true});
      for(const row of loaded.records)if(row.value&&(!scopedManager||siteAllowed(context,row.value.site)))people.set(row.id,row.value);
      const accounts=await all(db,`SELECT m.user_id,m.person_id,m.version,m.role_id,r.version AS role_version FROM json_each(?) chosen CROSS JOIN workspace_members m JOIN workspace_roles r ON r.workspace_id=m.workspace_id AND r.id=m.role_id WHERE m.workspace_id=? AND m.person_id=chosen.value AND m.status='active' AND NOT EXISTS (SELECT 1 FROM json_each(r.permissions) permission WHERE permission.value='plan')`,JSON.stringify(batch),workspaceId);
      for(const member of accounts)members.set(member.person_id,member);
      const mobile=await all(db,`SELECT credential.person_id,credential.version FROM json_each(?) chosen
        CROSS JOIN workspace_mobile_credentials credential WHERE credential.workspace_id=?
          AND credential.person_id=chosen.value AND credential.revoked_at IS NULL`,JSON.stringify(batch),workspaceId);
      for(const member of mobile)if(!members.has(member.person_id))members.set(member.person_id,{
        ...member,kind:'mobile',user_id:'mobile-employee:'+member.person_id,role_id:'mobile-employee',role_version:1,
      });
    }
  }
  function acceptPage(page){for(const site of page.sites)sites[site.index]=site;for(const shift of page.shifts)published.set(shift.id,shift);}
  async function summaryIds(ids){for(const batch of chunks([...new Set(ids.filter(Boolean))],500)){const page=await readPublishedEmployeePage({db,workspaceId,context:accessContext,ids:batch,limit:500});acceptPage(page);}}
  async function loadPlan(identities){const needed=identities.filter(item=>!planRows.has(Planning.key(item.kind,item.id)));if(!needed.length)return;
    for(const batch of chunks(needed)){const headers=await all(db,`SELECT record.kind,record.id,COALESCE(json_extract(record.config,'$.bytes'),length(CAST(record.config AS BLOB))) AS bytes FROM json_each(?) chosen CROSS JOIN workspace_plan_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id')`,JSON.stringify(batch),workspaceId);for(const row of headers){if(!Number.isSafeInteger(row.bytes)||row.bytes<0)h.fail(500,'workflow_plan_invalid','Den berørte vagt kunne ikke læses sikkert.');workingBytes+=row.bytes;}if(workingBytes>64*1024*1024)h.fail(413,'workflow_context_too_large','Anmodningerne indeholder for mange instruktioner til én side. Vælg en mindre side eller periode.');const loaded=await readPlanningRecords({db,workspaceId,identities:batch});Object.assign(planVersions,loaded.versions);for(const item of batch)planRows.set(Planning.key(item.kind,item.id),{...item,value:null});for(const row of loaded.records)planRows.set(Planning.key(row.kind,row.id),row);}
    draft=Planning.apply({series:[],edits:{},deleted:[],weekPlans:{}},[...planRows.values()]);
  }
  async function draftIds(ids){const selected=[...new Set(ids.filter(Boolean))];await loadPlan(selected.map(id=>({kind:'shift',id})));const parents=new Set();for(const id of selected){const edit=draft.edits[id];if(edit?.seriesId)parents.add(edit.seriesId);for(let index=id.indexOf('@');index>=0;index=id.indexOf('@',index+1))if(index)parents.add(id.slice(0,index));}await loadPlan([...parents].map(id=>({kind:'series',id})));await loadPeople([...selected.map(id=>published.get(id)?.person),...(frame.demoSeed?Data.staff.map(person=>person.id):[])]);}
  function draftShift(id){if(draft.deleted.includes(id))return null;if(draft.edits[id])return draft.edits[id];for(const series of draft.series){const anchor=Series.occurrenceAnchor(id,series.id);if(anchor)return Series.enumerate(series,{from:anchor,to:anchor}).find(shift=>shift.id===id)||null;}return Data.shiftById(id,{series:[],edits:{},deleted:[],demoSeed:frame.demoSeed,roster:[...people.values()]});}
  async function prepareRequests(requests,extraIds=[]){await summaryIds([...requests.map(request=>request.shift.id),...extraIds]);await draftIds([...requests.filter(request=>['awaiting_colleague','pending'].includes(request.status)).map(request=>request.shift.id),...extraIds]);await loadPeople(requests.flatMap(request=>[request.fromPersonId,request.toPersonId]));}
  async function shiftPage(personId,cursor){
    let continuation=cursor??null,scanned=0;const visited=new Set();
    for(;;){
      if(continuation&&visited.has(continuation))h.fail(409,'workflow_changed','Vagterne er ændret. Hent listen igen.');if(continuation)visited.add(continuation);
      const page=await readPublishedEmployeePage({db,workspaceId,context:accessContext,...(period||{from:local.date,to:Data.maxDate}),personId,limit,cursor:continuation});scanned+=page.shifts.length;
      if(scanned>50000)h.fail(413,'workflow_context_too_large','Perioden indeholder for mange vagter. Vælg en mindre periode.');
      const future=page.shifts.filter(shift=>shift.date>local.date||shift.date===local.date&&shift.start>local.time);
      // A page of today's finished shifts must not hide later available shifts
      // behind an empty-state screen. Keep only future rows in the working set.
      if(future.length||!page.nextCursor){acceptPage({...page,shifts:future});return {shifts:future,nextCursor:page.nextCursor};}
      continuation=page.nextCursor;
    }
  }
  async function colleaguePage(exclude){const scope=personPredicate(accessContext,'employee.id');const search=payload.colleagueQuery??'';if(typeof search!=='string'||search.length>120)h.fail(400,'workflow_colleague_query_invalid','Søg efter et navn på højst 120 tegn.');let after=null;if(payload.colleagueCursor){try{after=decodeCursor(payload.colleagueCursor);if(!Array.isArray(after)||after.length!==2||after.some(value=>typeof value!=='string'||value.length>512))throw Error();}catch{h.fail(400,'workflow_cursor_invalid','Sidehenvisningen er ugyldig.');}}const found=await all(db,`SELECT employee.id,employee.name_sort FROM workspace_directory_records employee WHERE employee.workspace_id=? AND employee.kind='employee' AND employee.deleted=0 AND employee.active=1 AND employee.id<>? AND (${scope.sql}) ${search.trim()?'AND instr(employee.name_sort,?)>0':''} ${after?'AND (employee.name_sort>? OR (employee.name_sort=? AND employee.id>?))':''} AND (EXISTS (SELECT 1 FROM workspace_members member JOIN workspace_roles role ON role.workspace_id=member.workspace_id AND role.id=member.role_id WHERE member.workspace_id=employee.workspace_id AND member.person_id=employee.id AND member.status='active' AND NOT EXISTS (SELECT 1 FROM json_each(role.permissions) permission WHERE permission.value='plan')) OR EXISTS (SELECT 1 FROM workspace_mobile_credentials credential WHERE credential.workspace_id=employee.workspace_id AND credential.person_id=employee.id AND credential.revoked_at IS NULL)) ORDER BY employee.name_sort,employee.id LIMIT ?`,workspaceId,exclude||'',...scope.values,...(search.trim()?[search.trim().toLocaleLowerCase('da-DK')]:[]),...(after?[after[0],after[0],after[1]]:[]),limit+1);await loadPeople(found.slice(0,limit).map(row=>row.id));const last=found[Math.min(found.length,limit)-1];return {people:found.slice(0,limit).map(row=>people.get(row.id)).filter(Boolean).map(({id,name,initials})=>({id,name,initials})),nextCursor:found.length>limit?encodeCursor([last.name_sort,last.id]):null};}
  async function conflicts(shift,personId){const range={from:Time.addDays(shift.date,-1),to:Time.addDays(shift.date,1)};await ensurePlanningSchedules({db,workspaceId,ranges:[range],personId});const summaries=await readPlanningScheduleSummaries(db,workspaceId,[range],{personId}),schedule=Scope.summaryStudio(summaries);await loadPeople([personId]);return [...Data.shiftsInRange(range.from,range.to,{...schedule,demoSeed:frame.demoSeed,roster:people.has(personId)?[people.get(personId)]:[]}),...await publishedConflictNeighbors({db,workspaceId,shifts:[{person:personId,date:shift.date}]})];}
  async function prepareApproval(id,toPersonId){const raw=await h.ensureOperationalSource(context);if(raw.revision!==frame.planRevision)h.fail(409,'workflow_plan_changed','Vagtplanen er ændret. Hent den seneste version.');const full=await readEmployeePublishedShift({db,workspaceId,shiftId:id});if(!full)h.fail(409,'workflow_shift_changed','Vagten findes ikke længere.');await draftIds([id]);const scope=week(full.shift.date),scopeKey=scope.from+'|'+full.shift.site,pub=await readPublicationCommandContext({db,workspaceId,scopeKeys:[scopeKey]});const directory=await directoryPlanningContext({db,workspaceId,studio:Planning.apply({...raw.studio,publications:pub.studio.publications,series:[],edits:{},deleted:[],weekPlans:{}},[...planRows.values()]),personIds:[full.shift.person,toPersonId].filter(Boolean)});const saved={revision:raw.revision,studio:directory.studio};Object.defineProperty(saved,'source',{value:raw.source});Object.defineProperty(saved,'planning',{value:{schema:1,versions:{...planVersions}}});Object.defineProperty(saved,'directory',{value:directory.directory});published.clear();for(const slot of Object.values(pub.studio.publications.slots))for(const shift of slot.shifts)published.set(shift.id,shift);await assertTimekeepingContext({db,context,frame,helpers:h});return {saved,studio:saved.studio,scopeKey};}
  return {people,members,sites,period,limit,published:()=>[...published.values()],publishedShift:id=>published.get(id),draftShift,loadPeople,summaryIds,draftIds,prepareRequests,shiftPage,colleaguePage,conflicts,prepareApproval,get frame(){return frame;},assert:()=>assertTimekeepingContext({db,context,frame,helpers:h}),async committed(revision){context.saved={revision,studio:{}};frame=await initializeTimekeepingContext({db,context,helpers:h});published.clear();planRows.clear();workingBytes=0;draft={series:[],edits:{},deleted:[],weekPlans:{}};}};
}
