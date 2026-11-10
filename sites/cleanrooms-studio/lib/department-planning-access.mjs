/* Planner scope is authority, independent of the requested cache projection. */
import Data from '../src/studio-data.js';
import Planning from '../src/planning-records.js';
import {isScoped,siteAllowed,sitePredicate,personPredicate,assertSiteAccess} from './department-access.mjs';
const fail=()=>{throw Object.assign(new Error('Handlingen ligger uden for dine afdelinger.'),{status:403,code:'department_scope_forbidden'});};
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
export function planningScopeStamp(context){return isScoped(context)?JSON.stringify([context.member.userId,context.member.version,context.role?.version,context.access.departmentIds,context.access.siteIds,context.access.directoryVersion,context.access.directoryToken]):null;}
const unassigned=column=>`(${column} IS NULL OR ${column}='')`;
/** Typed indexes filter bodies before paging. Tombstones inherit their retained
 * site/person columns or their authoritative recurrence parent. */
export function planningRecordPredicate(context,alias='record'){
 if(!isScoped(context))return {sql:'1=1',values:[]};
 const site=sitePredicate(context,alias+'.site_index'),person=personPredicate(context,alias+'.person_id'),parentSite=sitePredicate(context,'scope_parent.site_index'),parentPerson=personPredicate(context,'scope_parent.person_id'),seedPerson=personPredicate(context,'scope_seed.id');
 const direct=`(${site.sql}) AND (${unassigned(alias+'.person_id')} OR (${person.sql}))`;
 const parent=`EXISTS(SELECT 1 FROM workspace_plan_records scope_parent WHERE scope_parent.workspace_id=${alias}.workspace_id AND scope_parent.kind='series' AND scope_parent.id=${alias}.parent_id AND (${parentSite.sql}) AND (${unassigned('scope_parent.person_id')} OR (${parentPerson.sql})))`;
 const seed=`EXISTS(SELECT 1 FROM workspace_directory_records scope_seed WHERE scope_seed.workspace_id=${alias}.workspace_id AND scope_seed.kind='employee' AND scope_seed.deleted=0 AND ${alias}.id=scope_seed.id||'-'||${alias}.origin_date AND (${seedPerson.sql}))`;
 return {sql:`(${alias}.kind='week' OR (${direct}) OR (${alias}.kind='shift' AND ${alias}.site_index IS NULL AND ((${parent}) OR (${seed}))))`,values:[...site.values,...person.values,...parentSite.values,...parentPerson.values,...seedPerson.values]};
}
export function filterPlanningRows(context,records,studio={}){
 if(!isScoped(context))return records;
 const people=new Set((studio.roster||[]).filter(person=>siteAllowed(context,person.site)).map(person=>person.id)),visible=shift=>shift&&siteAllowed(context,shift.site)&&(!shift.person||people.has(shift.person));
 return records.flatMap(row=>{
  if(!row.value)return [row];
  if(row.kind==='week'){const value=Object.fromEntries(['published','baselineKind'].filter(name=>Object.hasOwn(row.value,name)).map(name=>[name,row.value[name]]));value.changes=0;if(Array.isArray(row.value.baseline))value.baseline=row.value.baseline.filter(visible);return [{...row,value}];}
  const shift=row.kind==='shift'?row.value.edit:row.value;
  return !shift||visible(shift)?[row]:[];
 });
}
async function assertPeople({db,context,personIds}){
 if(!isScoped(context))return;const ids=[...new Set(personIds.filter(Boolean))];if(!ids.length)return;
 const access=personPredicate(context,'chosen.value'),result=await db.batch([query(db,`SELECT COUNT(*) n FROM json_each(?) chosen WHERE (${access.sql})`,JSON.stringify(ids),...access.values)]);
 if(result[0]?.results?.[0]?.n!==ids.length)fail();
}
export function assertPlanningScopesAccess(context,selection){
 if(!isScoped(context))return;
 for(const scope of [...(selection?.scopes||[]),...(selection?.dependencies||[])])for(const site of scope.siteIds||[])assertSiteAccess(context,site);
 for(const key of selection?.scopeKeys||[]){const site=Number(key.slice(key.lastIndexOf('|')+1));assertSiteAccess(context,site);}
}
export async function assertPlanningCommandAccess({db,context,before,changes,publication}){
 if(!isScoped(context))return;
 if(publication)for(const site of publication.siteIds||[])assertSiteAccess(context,site);
 const previous=new Map(Planning.flatten(before||{}).map(row=>[Planning.key(row.kind,row.id),row.value])),people=[];
 // A first override has no stored shift header yet. Resolve legacy generated
 // identities against current employee metadata, never the default demo roster.
 const seedIds=before?.demoSeed===false?[]:[...new Set(changes.filter(change=>change.kind==='shift'&&!previous.get(Planning.key('shift',change.id))?.edit&&/^p(?:[0-9]|1[0-9]|2[01])-\d{4}-\d{2}-\d{2}$/.test(change.id)).map(change=>change.id.slice(0,-11)))];
 const seeds=seedIds.length?(await db.batch([query(db,"SELECT id,site_index AS site FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND deleted=0 AND id IN (SELECT value FROM json_each(?))",context.workspace.id,JSON.stringify(seedIds))]))[0]?.results||[]:[];
 const original={...before,roster:seeds,deleted:[]};
 const inspect=shift=>{if(!shift)fail();assertSiteAccess(context,shift.site);if(shift.person)people.push(shift.person);};
 for(const change of changes){
  if(change.kind==='week'){
   if(!publication&&!changes.some(item=>item.kind!=='week'))fail();
   if(change.value&&Object.keys(change.value).some(key=>!['published','changes','baseline','baselineKind'].includes(key)))fail();
   // Existing global baselines are retained by rebaseWeek. Only newly supplied
   // baseline rows are authority-bearing; an unchanged hidden baseline is internal.
   if(change.value?.baseline&&!previous.has(Planning.key('week',change.id)))for(const shift of change.value.baseline)inspect(shift);
   continue;
  }
  const old=previous.get(Planning.key(change.kind,change.id)),oldShift=change.kind==='shift'?old?.edit:old;
  if(oldShift)inspect(oldShift);
  else if(change.kind==='shift'){
   const implicit=Data.shiftById(change.id,original);
   if(implicit||old||change.value?.suppressed||change.value===null)inspect(implicit);
  }
  const nextShift=change.kind==='shift'?change.value?.edit:change.value;if(nextShift)inspect(nextShift);
 }
 await assertPeople({db,context,personIds:people});
}
export async function assertPlanningHeadersAccess({db,context,headers}){
 if(!isScoped(context))return;const parents=new Map(headers.filter(row=>row.kind==='series').map(row=>[row.id,row])),people=[];
 const missing=[...new Set(headers.filter(row=>row.kind==='shift'&&row.site_index==null&&row.parent_id&&!parents.has(row.parent_id)).map(row=>row.parent_id))];
 if(missing.length){const loaded=await db.batch([query(db,"SELECT id,site_index,person_id FROM workspace_plan_records WHERE workspace_id=? AND kind='series' AND id IN (SELECT value FROM json_each(?))",context.workspace.id,JSON.stringify(missing))]);for(const row of loaded[0]?.results||[])parents.set(row.id,row);}
 for(const row of headers){if(row.kind==='week')continue;let origin=row.site_index==null?parents.get(row.parent_id):row;
  if(!origin&&row.kind==='shift'&&row.origin_date){const found=await db.batch([query(db,"SELECT id AS person_id,site_index FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND deleted=0 AND ?=id||'-'||?",context.workspace.id,row.id,row.origin_date)]);origin=found[0]?.results?.[0];}
  if(!origin)fail();assertSiteAccess(context,origin.site_index);if(origin.person_id)people.push(origin.person_id);
 }
 await assertPeople({db,context,personIds:people});
}
