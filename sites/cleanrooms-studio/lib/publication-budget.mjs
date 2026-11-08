import Data from '../src/studio-data.js';
import Scope from '../src/planning-scope.js';
import Range from '../src/publication-range.js';
import Series from '../src/series-engine.js';
import Directory from '../src/directory-records.js';
import Roster from '../src/roster-model.js';
import {readPlanningScheduleSummaries} from './planning-selection-store.mjs';
import {readDirectoryHeader,readDirectoryRecords} from './directory-store.mjs';
import {assertTimekeepingContext,initializeTimekeepingContext,timekeepingPeople} from './timekeeping-context.mjs';

const nextMonth=day=>{
  const date=new Date(day+'T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+1);
  return date.toISOString().slice(0,10);
};

function requestedRanges({from,to,extraWeeks=[]}){
  const bounds={minDate:Data.minDate,maxDate:Data.maxDate};
  const range=Range.normalize({from,to,...bounds});
  if(range.from!==from||range.to!==to||!Array.isArray(extraWeeks)||extraWeeks.length>Range.MAX_WEEKS)throw new TypeError();
  return [range,...extraWeeks.map(start=>{
    const week=Range.normalize({from:start,...bounds});
    if(week.from!==start)throw new TypeError();
    return week;
  })];
}

function periodsFor(ranges,{period,hours}){
  const periods=new Map();
  const step=period==='week'?day=>Scope.add(day,7):nextMonth;
  for(const range of ranges){
    const first=period==='week'?range.from:range.from.slice(0,7)+'-01';
    for(let from=first;from<=range.to;from=step(from)){
      const to=Scope.add(step(from),-1);
      if(!periods.has(from))periods.set(from,{from,to,plannedMinutes:0,budgetHours:hours});
    }
  }
  return [...periods.values()].sort((a,b)=>a.from.localeCompare(b.from));
}

function requestedScope(value){
  if(value===undefined)return {kind:'company'};
  if(!value||typeof value!=='object'||Array.isArray(value)||!['company','department','site'].includes(value.kind)||Object.keys(value).some(key=>!['kind','id'].includes(key)))throw new TypeError();
  if(value.kind==='company'){
    if(value.id!==undefined)throw new TypeError();
    return {kind:'company'};
  }
  if(!Directory.validId(value.kind,value.id))throw new TypeError();
  return {kind:value.kind,id:value.id};
}

export async function readPublicationBudget({db,context,payload,helpers:h}){
  if(!h.capabilities(context).plan)h.fail(403,'publication_budget_forbidden','Din rolle har ikke adgang til timebudgettet for vagtplanen.');
  let selected,scope;
  try{selected=requestedRanges(payload);}
  catch{h.fail(400,'publication_budget_range_invalid','Vælg hele uger inden for vagtplanens periode.');}
  try{scope=requestedScope(payload.scope);}
  catch{h.fail(400,'publication_budget_scope_invalid','Vælg virksomheden, en afdeling eller et arbejdssted.');}

  const saved=await h.ensureOperationalSource(context);
  const directory=await readDirectoryHeader({db,workspaceId:context.workspace.id});
  if(!directory)h.fail(409,'publication_budget_directory_changed','Virksomhedens timebudgetter er ændret. Prøv igen.');
  let budget=saved.studio?.workspaceSettings?.workHoursBudget,siteIndices=null;
  if(scope.kind!=='company'){
    const found=await readDirectoryRecords({db,workspaceId:context.workspace.id,kind:scope.kind,ids:[scope.id],catalog:true});
    if(found.directory.revision!==directory.version)h.fail(409,'publication_budget_directory_changed','Virksomhedens timebudgetter er ændret. Prøv igen.');
    const record=found.records.find(item=>item.id===scope.id&&item.value);
    if(!record)h.fail(404,'publication_budget_scope_missing','Afdelingen eller arbejdsstedet findes ikke længere.');
    budget=record.value.workHoursBudget;
    siteIndices=new Set(scope.kind==='site'?[record.siteIndex]:record.value.siteIds);
    if([...siteIndices].some(index=>!Number.isInteger(index)||index<0||index>=directory.next_site_index))h.fail(500,'publication_budget_scope_invalid','Timebudgettets arbejdssteder kunne ikke læses.');
  }
  if(budget!=null&&!Roster.validWorkHoursBudget(budget))h.fail(500,'publication_budget_invalid','Det lagrede timebudget kunne ikke læses.');
  if(!budget){
    await h.ensureOperationalSource(context);
    const current=await readDirectoryHeader({db,workspaceId:context.workspace.id});
    if(current?.version!==directory.version||current?.write_token!==directory.write_token)h.fail(409,'publication_budget_directory_changed','Virksomhedens timebudgetter er ændret. Prøv igen.');
    await h.assertContext(db,context);
    return {revision:saved.revision,directoryRevision:directory.version,scope,budget:null};
  }

  const frame=await initializeTimekeepingContext({db,context,helpers:h});
  if(frame.directoryRevision!==directory.version||frame.directoryToken!==directory.write_token)h.fail(409,'publication_budget_directory_changed','Virksomhedens timebudgetter er ændret. Prøv igen.');
  const periods=periodsFor(selected,budget);
  const ranges=Scope.mergeRanges(periods.map(({from,to})=>({
    from:from<Data.minDate?Data.minDate:from,to:to>Data.maxDate?Data.maxDate:to
  })));
  const summaries=await readPlanningScheduleSummaries(db,context.workspace.id,ranges);
  const {series,edits,deleted}=Scope.summaryStudio(summaries);
  const suppressed=new Set(deleted);
  const seeded=frame.demoSeed?await timekeepingPeople({db,context,personIds:Data.staff.map(({id})=>id)}):[];
  const byDay=new Map();
  for(const period of periods){
    for(let day=period.from;day<=period.to;day=Scope.add(day,1))byDay.set(day,period);
  }
  const add=shift=>{
    const period=byDay.get(shift.date);
    if(!period||suppressed.has(shift.id)||siteIndices&&!siteIndices.has(shift.site))return;
    const minutes=Series.plannedMinutes(shift);
    if(!Number.isFinite(minutes))h.fail(500,'publication_budget_shift_invalid','En planlagt vagts arbejdstid kunne ikke beregnes.');
    period.plannedMinutes+=minutes;
  };
  const addOriginal=shift=>{if(!Object.hasOwn(edits,shift.id))add(shift);};
  // Retain only one recurrence's concrete shifts in memory. A moved exception
  // replaces its original identity even when the move crosses budget periods.
  for(const range of ranges){
    for(let from=range.from;from<=range.to;from=Scope.add(from,366)){
      const last=Scope.add(from,365),to=last<range.to?last:range.to;
      if(frame.demoSeed){
        for(const shift of Data.seededShifts(from,to,{roster:seeded,demoSeed:true}))addOriginal(shift);
      }
      for(const agreement of series){
        if(agreement.startDate>to||agreement.endDate<from)continue;
        for(const shift of Series.enumerate(agreement,{from,to}))addOriginal(shift);
      }
    }
  }
  for(const shift of Object.values(edits))add(shift);
  await assertTimekeepingContext({db,context,frame,helpers:h});
  return {revision:frame.planRevision,directoryRevision:frame.directoryRevision,scope,budget:{period:budget.period,periods}};
}
