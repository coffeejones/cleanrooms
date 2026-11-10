/* Attendance reads use compact schedules and directory identities, never a full plan. */
import {siteAllowed,sitePredicate} from './department-access.mjs';
import Time from '../src/timekeeping-model.js';
import Data from '../src/studio-data.js';
import Series from '../src/series-engine.js';
import Scope from '../src/planning-scope.js';
import {ensurePlanningImported} from './planning-store.mjs';
import {ensurePlanWindowIndex} from './planning-window-store.mjs';
import {ensurePlanningSchedules,readPlanningScheduleSummaries} from './planning-selection-store.mjs';
import {splitSnapshot} from './studio-store.mjs';
import {readDirectoryHeader,readDirectoryPage,readDirectoryRecords} from './directory-store.mjs';
const query=(db,sql,...values)=>db.prepare(sql).bind(...values),all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[],first=async(...args)=>(await all(...args))[0]||null;

export async function initializeTimekeepingContext({db,context,helpers:h}){
  const workspaceId=context.workspace.id,owner=context.workspace.snapshotOwnerId,imported=await first(db,'SELECT workspace_id FROM workspace_plan_imports WHERE workspace_id=?',workspaceId),indexed=await first(db,'SELECT schema FROM workspace_plan_window_imports WHERE workspace_id=?',workspaceId);
  if(!imported||indexed?.schema!==1){const raw=await (h.ensureOperationalPlanningSource||h.ensureOperationalSource)(context);if(!await ensurePlanningImported({db,workspaceId,owner,source:raw.source,studio:raw.studio})||!await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot}))h.fail(409,'time_plan_changed','Vagtplanen er ændret. Hent timerne igen.');await ensurePlanningSchedules({db,workspaceId});}
  let head=await first(db,'SELECT revision,write_token,demo_seed,demo_seed_revision FROM studio_states WHERE owner_id=?',owner);if(!head||head.revision!==context.saved.revision)h.fail(409,'time_plan_changed','Vagtplanen er ændret. Hent timerne igen.');
  // A rolling older worker may change the snapshot without maintaining derived
  // columns. Trust the flag only at its exact source revision; repair once.
  if(![0,1].includes(head.demo_seed)||head.demo_seed_revision!==head.revision){const raw=await h.ensureOperationalSource(context);if(raw.revision!==head.revision||raw.source?.token!==head.write_token)h.fail(409,'time_plan_changed','Vagtplanen er ændret. Hent timerne igen.');await db.batch([query(db,'UPDATE studio_states SET demo_seed=?,demo_seed_revision=? WHERE owner_id=? AND revision=? AND write_token=? AND (demo_seed_revision IS NULL OR demo_seed_revision<>revision OR demo_seed IS NULL OR demo_seed NOT IN (0,1))',Number(raw.studio?.demoSeed!==false),head.revision,owner,head.revision,head.write_token)]);head=await first(db,'SELECT revision,write_token,demo_seed,demo_seed_revision FROM studio_states WHERE owner_id=?',owner);}
  if(!head||head.revision!==context.saved.revision||head.demo_seed_revision!==head.revision||![0,1].includes(head.demo_seed))h.fail(409,'time_plan_changed','Vagtplanen kunne ikke indlæses sikkert. Hent timerne igen.');
  const directory=await readDirectoryHeader({db,workspaceId});if(!directory)h.fail(409,'time_directory_changed','Medarbejderne kunne ikke indlæses. Hent timerne igen.');return {planRevision:head.revision,planToken:head.write_token,demoSeed:head.demo_seed===1,directoryRevision:directory.version,directoryToken:directory.write_token};
}

export async function assertTimekeepingContext({db,context,frame,helpers:h}){const head=await first(db,'SELECT revision,write_token FROM studio_states WHERE owner_id=?',context.workspace.snapshotOwnerId),directory=await readDirectoryHeader({db,workspaceId:context.workspace.id});if(!head||head.revision!==frame.planRevision||head.write_token!==frame.planToken||directory?.version!==frame.directoryRevision||directory.write_token!==frame.directoryToken)h.fail(409,'time_context_changed','Vagtplanen eller medarbejderne er ændret. Hent timerne igen.');await h.assertContext(db,context);}

export async function timekeepingPeople({db,context,personIds,firstActive=0}){
  const workspaceId=context.workspace.id;if(firstActive){const access=sitePredicate(context,'site_index');const chosen=await all(db,`SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND deleted=0 AND active=1 AND (${access.sql}) ORDER BY position,id LIMIT ?`,workspaceId,...access.values,firstActive);personIds=chosen.map(row=>row.id);}
  const records=[];if(personIds){const ids=[...new Set(personIds.filter(Boolean))];for(let offset=0;offset<ids.length;offset+=500)records.push(...(await readDirectoryRecords({db,workspaceId,kind:'employee',ids:ids.slice(offset,offset+500),catalog:true})).records);}else{let cursor=null;do{const page=await readDirectoryPage({db,workspaceId,kind:'employee',catalog:true,cursor});records.push(...page.records);cursor=page.nextCursor;}while(cursor);}return records.filter(row=>row.value&&siteAllowed(context,row.value.site)).map(row=>row.value);
}

/* Enumerate one recurrence at a time. A year across 5000 people never becomes
 * one giant concrete-shift array, and manual moved/suppressed identities win. */
export async function timekeepingPlannedRows({db,context,frame,from,to,personId}){
  await ensurePlanningSchedules({db,workspaceId:context.workspace.id,ranges:[{from,to}],personId});
  const summaries=await readPlanningScheduleSummaries(db,context.workspace.id,[{from,to}],{personId}),draft=Scope.summaryStudio(summaries),personIds=personId?[personId]:[...new Set([...draft.series.map(series=>series.person),...Object.values(draft.edits).map(shift=>shift.person),...(frame.demoSeed?Data.staff.map(person=>person.id):[])].filter(Boolean))],people=await timekeepingPeople({db,context,personIds}),known=new Map(people.map(person=>[person.id,person])),minutes=new Map(),deleted=new Set(draft.deleted),manual=new Set(Object.keys(draft.edits)),include=shift=>{if(siteAllowed(context,shift.site)&&(!personId||shift.person===personId)&&known.get(shift.person)?.active!==false&&known.has(shift.person)){const value=Series.plannedMinutes(shift);if(Number.isFinite(value))minutes.set(shift.person,(minutes.get(shift.person)||0)+value);}},ranges=[];for(let first=from;first<=to;first=Time.addDays(first,366)){const end=Time.addDays(first,365);ranges.push({from:first,to:end<to?end:to});}
  const seed={roster:people,demoSeed:frame.demoSeed};for(const range of ranges){for(const shift of Data.seededShifts(range.from,range.to,seed))if(!deleted.has(shift.id)&&!manual.has(shift.id))include(shift);for(const series of draft.series)for(const shift of Series.enumerate(series,range))if(!deleted.has(shift.id)&&!manual.has(shift.id))include(shift);}for(const shift of Object.values(draft.edits))if(shift.date>=from&&shift.date<=to&&!deleted.has(shift.id))include(shift);return {people,plannedRows:[...minutes].map(([personId,plannedMinutes])=>({personId,plannedMinutes}))};
}
