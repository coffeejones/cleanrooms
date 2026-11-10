/* Personal calendars are published, person-scoped projections. Descriptions and
 * checklist documents are loaded only when that occurrence is opened. */
import Data from '../src/studio-data.js';
import {isScoped,assertPersonAccess} from './department-access.mjs';
import {planningScopeStamp} from './department-planning-access.mjs';
import Time from '../src/timekeeping-model.js';
import Directory from '../src/directory-records.js';
import {mayReadWorksiteInfo} from './worksite-information.mjs';
import {readDirectoryHeader,readDirectoryRecords,readDirectorySite} from './directory-store.mjs';
import {ensurePlanningImported} from './planning-store.mjs';
import {ensurePlanWindowIndex} from './planning-window-store.mjs';
import {splitSnapshot,StudioError} from './studio-store.mjs';
import {readChecklistProgress} from './engagement-store.mjs';
import {readPublishedEmployeePage,readEmployeePublishedShift} from './publication-store.mjs';
export {readEmployeePublishedShift} from './publication-store.mjs';
const query=(db,sql,...values)=>db.prepare(sql).bind(...values),all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[],first=async(...args)=>(await all(...args))[0]||null;
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
function decode(value){try{if(typeof value!=='string'||value.length>20000)throw Error();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),character=>character.charCodeAt(0))));}catch{fail(400,'employee_cursor_invalid','Sidehenvisningen er ugyldig.');}}
function sitesFor(locations){const result=new Map();for(const location of locations)if(location&&Number.isInteger(location.index)&&location.index>=0&&location.index<2000)result.set(location.index,location);return [...result.values()].sort((left,right)=>left.index-right.index);}
export async function initializeEmployeeReadContext({db,context,helpers:h}){
  const workspaceId=context.workspace.id,owner=context.workspace.snapshotOwnerId,imports=await db.batch([query(db,'SELECT workspace_id FROM workspace_plan_imports WHERE workspace_id=?',workspaceId),query(db,'SELECT schema FROM workspace_plan_window_imports WHERE workspace_id=?',workspaceId),query(db,'SELECT token FROM workspace_engagement_imports WHERE workspace_id=?',workspaceId)]);
  if(!imports[0]?.results?.length||imports[1]?.results?.[0]?.schema!==1||!imports[2]?.results?.length){
    const raw=await (h.ensureOperationalPlanningSource||h.ensureOperationalSource)(context);if(!await ensurePlanningImported({db,workspaceId,owner,source:raw.source,studio:raw.studio})||!await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot}))fail(409,'employee_plan_changed','Vagtplanen er ændret. Hent dine vagter igen.');
  }
  const head=await first(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',owner),directory=await readDirectoryHeader({db,workspaceId});if(!head||head.revision!==context.saved.revision||!directory)fail(409,'employee_plan_changed','Vagtplanen er ændret. Hent dine vagter igen.');return {planRevision:head.revision,planToken:head.write_token,directoryRevision:directory.version,directoryToken:directory.write_token};
}
export async function assertEmployeeReadContext({db,context,frame,helpers:h}){
  const head=await first(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',context.workspace.snapshotOwnerId),directory=await readDirectoryHeader({db,workspaceId:context.workspace.id});if(head?.revision!==frame.planRevision||head?.write_token!==frame.planToken||directory?.version!==frame.directoryRevision||directory?.write_token!==frame.directoryToken)fail(409,'employee_context_changed','Vagtplanen eller medarbejderoplysningerne er ændret. Hent dine vagter igen.');await h.assertContext(db,context);
}
export async function handleEmployeeRead(options){
  try{return await readEmployee(options);}catch(error){if(Number.isInteger(error?.status)&&/^(?:publication_|employee_)/.test(error.code||'')&&!(error instanceof StudioError))throw new StudioError(error.status,error.code,error.message);throw error;}
}
async function readEmployee({db,context,payload,helpers:h}){
  const caps=h.capabilities(context),preview=caps.plan===true,personId=payload.personId??context.member.personId;
  if(!Directory.validId('employee',personId)||!preview&&personId!==context.member.personId)fail(403,'employee_person_forbidden','Du kan kun se dine egne udgivne vagter.');
  if(preview)await assertPersonAccess({db,context,personId});
  const scopedContext=preview&&isScoped(context)?context:undefined;
  const frame=await initializeEmployeeReadContext({db,context,helpers:h}),chosen=await readDirectoryRecords({db,workspaceId:context.workspace.id,kind:'employee',ids:[personId],catalog:true}),person=chosen.records.find(row=>row.value)?.value;if(!person)fail(403,'person_assignment_required','Kontoen er ikke knyttet til en medarbejder.');
  const common={person,minDate:Data.minDate,maxDate:Data.maxDate,planRevision:frame.planRevision,directoryRevision:frame.directoryRevision,preview};
  if(payload.action==='employeeShift'){
    const detail=await readEmployeePublishedShift({db,workspaceId:context.workspace.id,personId,shiftId:payload.shiftId,context:scopedContext});if(!detail)fail(404,'employee_shift_missing','Vagten er ikke længere udgivet til denne medarbejder.');
    let includeWorksiteInfo=mayReadWorksiteInfo(detail.shift,{preview});
    if(!includeWorksiteInfo){const active=await first(db,"SELECT status FROM workspace_time_entries WHERE workspace_id=? AND person_id=? AND shift_id=? AND demo=0 AND status IN ('running','paused') LIMIT 1",context.workspace.id,personId,detail.shift.id);includeWorksiteInfo=mayReadWorksiteInfo(detail.shift,{entry:active});}
    const [progress,currentSite]=await Promise.all([readChecklistProgress(db,context,{personId,shifts:[detail.shift]}),includeWorksiteInfo?readDirectorySite({db,workspaceId:context.workspace.id,siteIndex:detail.shift.site,includeWorksiteInfo:true}):null]);await assertEmployeeReadContext({db,context,frame,helpers:h});return {...common,...detail,site:{...detail.site,...(currentSite?.worksiteInfo?{worksiteInfo:currentSite.worksiteInfo}:{})},progress};
  }
  if(payload.action!=='employeeRead')fail(400,'employee_action_invalid','Vælg en gyldig medarbejdervisning.');
  const {from,to}=payload;if(!Time.validDate(from)||!Time.validDate(to)||from>to||from<Data.minDate||to>Data.maxDate||(Date.parse(to)-Date.parse(from))/86400000>=56)fail(400,'employee_period_invalid','Vælg højst 56 kalenderdage.');
  let cursor=null;if(payload.cursor!=null){const value=decode(payload.cursor);if(value?.schema!==1||value.workspaceId!==context.workspace.id||value.personId!==personId||value.from!==from||value.to!==to||typeof value.after!=='string'||(value.access??null)!==planningScopeStamp(scopedContext))fail(400,'employee_cursor_invalid','Sidehenvisningen hører til en anden visning.');if(value.planRevision!==frame.planRevision||value.planToken!==frame.planToken||value.directoryRevision!==frame.directoryRevision||value.directoryToken!==frame.directoryToken)fail(409,'employee_context_changed','Vagtplanen eller medarbejderoplysningerne er ændret. Hent dine vagter igen.');cursor=value.after;}
  const page=await readPublishedEmployeePage({db,workspaceId:context.workspace.id,personId,from,to,cursor,limit:payload.limit??500,overlap:true,context:scopedContext}),firstPage=cursor===null,today=Time.localNow().date,next=firstPage?await readPublishedEmployeePage({db,workspaceId:context.workspace.id,personId,from:today,to:Data.maxDate,next:true,overlap:true,context:scopedContext}):null;
  await assertEmployeeReadContext({db,context,frame,helpers:h});
  return {...common,from,to,shifts:page.shifts,sites:sitesFor([...page.sites,...(next?.sites||[])]),taskSummaries:{...page.taskSummaries,...(next?.taskSummaries||{})},...(firstPage?{nextShift:next?.shifts[0]||null}:{}),nextCursor:page.nextCursor?encode({schema:1,workspaceId:context.workspace.id,personId,from,to,...frame,...(planningScopeStamp(scopedContext)?{access:planningScopeStamp(scopedContext)}:{}),after:page.nextCursor}):null};
}
