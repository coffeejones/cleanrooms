/* Period-bound wage estimates reuse compact schedules and dated, private payroll records. */
import {isScoped,assertDepartmentAccess,assertSiteAccess} from './department-access.mjs';
import Cost from '../src/planning-cost-model.js';
import Data from '../src/studio-data.js';
import Scope from '../src/planning-scope.js';
import Series from '../src/series-engine.js';
import Directory from '../src/directory-records.js';
import {readPlanningScheduleSummaries} from './planning-selection-store.mjs';
import {readDirectoryRecords} from './directory-store.mjs';
import {initializeTimekeepingContext,assertTimekeepingContext,timekeepingPeople} from './timekeeping-context.mjs';

function requestedScope(value){
  if(value===undefined)return {kind:'company'};
  if(!value||typeof value!=='object'||Array.isArray(value)||!['company','department','site'].includes(value.kind)||Object.keys(value).some(key=>!['kind','id'].includes(key))||(value.kind==='company'?value.id!==undefined:!Directory.validId(value.kind,value.id)))throw new TypeError();
  return value.kind==='company'?{kind:'company'}:{kind:value.kind,id:value.id};
}
export async function readPlanningCost({db,context,payload,helpers:h}){
  const caps=h.capabilities(context);
  if(!caps.plan||!caps.viewPayroll)h.fail(403,'planning_cost_forbidden','Din rolle har ikke adgang til vagtplanens lønestimat.');
  let range,scope;
  try{range=Cost.range(payload.from,payload.to);if(range.from<Data.minDate||range.to>Data.maxDate)throw new TypeError();}
  catch{h.fail(400,'planning_cost_range_invalid','Vælg højst otte hele uger inden for kalenderen.');}
  try{scope=requestedScope(payload.scope);}catch{h.fail(400,'planning_cost_scope_invalid','Vælg virksomheden, en afdeling eller et arbejdssted.');}
  const frame=await initializeTimekeepingContext({db,context,helpers:h});
  let siteIndices=null;
  if(scope.kind==='department')assertDepartmentAccess(context,scope.id);
  if(scope.kind!=='company'){
    const found=await readDirectoryRecords({db,workspaceId:context.workspace.id,kind:scope.kind,ids:[scope.id],catalog:true,context});
    if(found.directory.revision!==frame.directoryRevision)h.fail(409,'planning_cost_changed','Området er ændret. Hent lønestimatet igen.');
    const record=found.records.find(item=>item.id===scope.id&&item.value);
    if(!record)h.fail(404,'planning_cost_scope_missing','Afdelingen eller arbejdsstedet findes ikke længere.');
    siteIndices=new Set(scope.kind==='site'?[record.siteIndex]:record.value.siteIds);
    if(isScoped(context))for(const site of siteIndices)assertSiteAccess(context,site);
  }
  const summaries=await readPlanningScheduleSummaries(db,context.workspace.id,[range],{maxRecords:20000,maxBytes:8*1024*1024,context}),draft=Scope.summaryStudio(summaries),suppressed=new Set(draft.deleted),rows=[];
  const add=shift=>{
    if(shift.date<range.from||shift.date>range.to||suppressed.has(shift.id)||siteIndices&&!siteIndices.has(shift.site))return;
    if(rows.length>=Cost.MAX_SHIFTS)h.fail(413,'planning_cost_too_large','Vælg et mindre område til lønestimatet.');
    rows.push(Object.fromEntries(['id','person','site','date','start','end','plannedBreakMinutes'].filter(key=>shift[key]!==undefined).map(key=>[key,shift[key]])));
  };
  const original=shift=>{if(!Object.hasOwn(draft.edits,shift.id))add(shift);};
  if(frame.demoSeed){const people=await timekeepingPeople({db,context,personIds:Data.staff.map(person=>person.id)});for(const shift of Data.seededShifts(range.from,range.to,{roster:people,demoSeed:true}))original(shift);}
  for(const series of draft.series)if(series.startDate<=range.to&&series.endDate>=range.from)for(const shift of Series.enumerate(series,range))original(shift);
  for(const shift of Object.values(draft.edits))add(shift);
  const ids=[...new Set(rows.map(shift=>shift.person).filter(Boolean))];
  if(ids.length>Cost.MAX_PEOPLE)h.fail(413,'planning_cost_too_large','Vælg et mindre område til lønestimatet.');
  const people=await timekeepingPeople({db,context,personIds:ids}),bundle=await h.payrollBundle(db,context,{personIds:ids}),names=new Map(people.map(person=>[person.id,person.name]));
  let weeks;
  try{weeks=Cost.estimate({...range,shifts:rows,people:bundle.people.filter(person=>names.has(person.personId)).map(person=>({...person,name:names.get(person.personId)})),policy:bundle.policy});}
  catch{h.fail(500,'planning_cost_invalid','Lønestimatet kunne ikke beregnes sikkert. Eksisterende data er bevaret.');}
  const policy=h.policyVersionGuard(context,bundle.version),personal=h.personVersionsGuard(context,bundle.versions);
  const rates=await h.first(db,`SELECT CASE WHEN (${policy.sql}) AND (${personal.sql}) THEN 1 ELSE 0 END AS current`,...policy.values,...personal.values);
  if(!rates?.current)h.fail(409,'planning_cost_rates_changed','Lønsatserne er ændret. Hent lønestimatet igen.');
  await assertTimekeepingContext({db,context,frame,helpers:h});
  await h.assertPayrollAccess(context);
  const result={revision:frame.planRevision,directoryRevision:frame.directoryRevision,policyVersion:bundle.version,scope,calculation:'shift-based-gross',weeks};
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>4*1024*1024)h.fail(413,'planning_cost_too_large','Vælg et mindre område eller færre uger til lønestimatet.');
  return result;
}
