/* Effective series previews use the same occurrence identities and exceptions as saving. */
(() => {
  'use strict';
  const Engine=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  // Strings (including long rich descriptions) are immutable. Copy containers
  // without repeatedly serializing the same description for every occurrence.
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1&&Number.isFinite(new Date(value+'T00:00:00Z').getTime())&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const order=(left,right)=>left.date.localeCompare(right.date)||left.start.localeCompare(right.start)||left.id.localeCompare(right.id);
  function inputs(edits,deleted){
    if(!record(edits)||!Array.isArray(deleted)||deleted.some(id=>typeof id!=='string'))throw new TypeError('Seriens manuelle ændringer er ugyldige.');
  }
  function checkShift(shift,id){
    if(!record(shift)||shift.id!==id||!validDate(shift.date))throw new TypeError('En manuel ændring i serien er ugyldig.');
    const errors=Engine.validate({id,person:shift.person||'unassigned',site:shift.site,startDate:shift.date,endDate:shift.date,weekdays:[0],start:shift.start,end:shift.end,plannedBreakMinutes:shift.plannedBreakMinutes,noteRich:shift.noteRich});
    if(errors.length||typeof shift.person!=='string'||shift.note!=null&&typeof shift.note!=='string')throw new TypeError(errors[0]||'En manuel ændring i serien er ugyldig.');
  }
  function occurrences(series,{edits={},deleted=[],from,to,today}={}){
    inputs(edits,deleted);
    const range=from!==undefined||to!==undefined||Engine.requiresRange(series)?Engine.operationRange(series,{from,to,today}):null;
    const map=new Map(Engine.enumerate(series,range||{}).map(shift=>[shift.id,shift])),removed=new Set(deleted);
    for(const [id,shift]of Object.entries(edits)){
      if(!map.has(id)){const anchor=Engine.occurrenceAnchor(id,series.id);if(!range||!anchor||!Engine.occursOn(series,anchor)||shift?.date<range.from||shift?.date>range.to)continue;}
      checkShift(shift,id);
      if(!shift.seriesId||shift.seriesId===series.id)map.set(id,clone(shift));
    }
    return [...map.values()].filter(shift=>!removed.has(shift.id)).map(clone).sort(order);
  }
  function chooseFutureAnchor(series,{today,edits={},deleted=[],preferredId}={}){
    if(!validDate(today))throw new TypeError('Vælg en gyldig dagsdato.');
    const errors=Engine.validate(series);if(errors.length)throw new TypeError(errors.join(' '));inputs(edits,deleted);
    const removed=new Set(deleted),candidate=day=>{
      if(day<today||!Engine.occursOn(series,day))return null;
      const id=series.id+'@'+day;if(removed.has(id))return null;
      const base=Engine.enumerate(series,{from:day,to:day})[0];let effective=base;
      if(Object.hasOwn(edits,id)){checkShift(edits[id],id);if(!edits[id].seriesId||edits[id].seriesId===series.id)effective=edits[id];}
      return effective.date>=today?{id,anchor:day,shift:clone(effective),base:clone(base)}:null;
    };
    const preferred=Engine.occurrenceAnchor(preferredId,series.id);if(preferred){const result=candidate(preferred);if(result)return result;}
    // At most the finite exception set can suppress recurring dates. Never
    // materialize the agreement simply to locate its next editable occurrence.
    for(let day=Engine.nextOccurrenceDate(series,today);day;){
      const result=candidate(day);if(result)return result;
      if(day===series.endDate)break;const next=new Date(day+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);day=Engine.nextOccurrenceDate(series,next.toISOString().slice(0,10));
    }
    return null;
  }
  function sameShift(left,right){
    return Engine.plannedBreakMinutes(left)===Engine.plannedBreakMinutes(right)&&['person','site','date','start','end','note','noteRich'].every(field=>(left[field]??'')===(right[field]??''));
  }
  const empty=errors=>({valid:false,errors,total:0,rawCount:0,upcoming:0,past:0,first:null,last:null,shifts:[],attached:[],detached:[],affectedCount:0,preservedCount:0,deletedCount:0,removedCount:0,createdCount:0,updatedCount:0,unchangedCount:0,changedCount:0,exceptions:{count:0,edited:0,deleted:0,ids:[]}});
  function preview({draft,source=null,scope='all',cutoff,edits={},deleted=[],preserve=true,today,from,to}={}){
    const errors=[...Engine.validate(draft)];
    if(!validDate(today))errors.push('Vælg en gyldig dagsdato.');
    if(!['all','future'].includes(scope))errors.push('Vælg hele serien eller kommende vagter.');
    if(typeof preserve!=='boolean')errors.push('Vælg om manuelle ændringer skal bevares.');
    if(source!==null&&source!==undefined&&!record(source))errors.push('Vælg en gyldig eksisterende vagtserie.');
    if(source){const sourceErrors=Engine.validate(source);errors.push(...sourceErrors);if(!sourceErrors.length&&scope==='future'&&(!validDate(cutoff)||cutoff<source.startDate||cutoff>source.endDate))errors.push('Vælg en gyldig dato i vagtseriens periode som start for kommende vagter.');}
    else if(scope==='future')errors.push('Kommende vagter kræver en eksisterende vagtserie.');
    if(source&&scope==='future'&&validDate(cutoff)&&draft?.startDate<cutoff)errors.push('Startdatoen kan ikke ligge før den valgte vagt.');
    if(errors.length)return empty(errors);
    try{
      inputs(edits,deleted);
      const limited=Engine.requiresRange(draft)||Boolean(source&&Engine.requiresRange(source))||from!==undefined||to!==undefined,range=limited?Engine.operationRange(draft,{from:from===undefined&&scope==='future'?cutoff:from,to,today}):null;
      const raw=Engine.enumerate(draft,range||{}),before=source?occurrences(source,{edits,deleted,...(range||{})}).filter(shift=>scope!=='future'||Engine.occurrenceAnchor(shift.id,source.id)>=cutoff):[];
      const exceptions=source?Engine.exceptionPreview({source,scope,cutoff,edits,deleted}):{count:0,edited:0,deleted:0,ids:[]};
      const preserved=source&&preserve?Engine.preserveExceptions({source,replacement:draft,scope,cutoff,edits,deleted}):null;
      const nextEdits=preserved?.edits||{},nextDeleted=preserved?.deleted||[],removed=new Set(nextDeleted);
      const attached=occurrences(draft,{edits:nextEdits,deleted:nextDeleted,...(range||{})});
      const detached=(preserved?.detachedIds||[]).filter(id=>!removed.has(id)&&(!range||nextEdits[id]?.date>=range.from&&nextEdits[id]?.date<=range.to)).map(id=>{checkShift(nextEdits[id],id);return clone(nextEdits[id]);});
      const shifts=[...attached,...detached].sort(order),resultIds=new Set(shifts.map(shift=>shift.id));
      if(resultIds.size!==shifts.length)throw new TypeError('En forekomst forekommer flere gange i resultatet.');
      const remapped=new Map((preserved?.remappedIds||[]).map(item=>[item.from,item.to]));
      const preservedCount=preserved?exceptions.ids.filter(id=>Object.hasOwn(edits,id)&&!deleted.includes(id)&&resultIds.has(remapped.get(id)||id)).length:0;
      const prior=new Map(before.map(shift=>[shift.id,shift]));
      // A previously detached manual occurrence is still existing work, even
      // though it is no longer counted as an attached occurrence of the source.
      for(const id of exceptions.ids)if(edits[id]&&!deleted.includes(id)&&(!range||edits[id].date>=range.from&&edits[id].date<=range.to||Engine.occurrenceAnchor(id,source.id)>=range.from&&Engine.occurrenceAnchor(id,source.id)<=range.to)){checkShift(edits[id],id);prior.set(id,edits[id]);}
      const result=new Map(shifts.map(shift=>{const anchor=source&&Engine.occurrenceAnchor(shift.id,draft.id);return [anchor?source.id+'@'+anchor:shift.id,shift];}));
      const removedCount=[...prior.keys()].filter(id=>!result.has(id)).length;
      let createdCount=0,updatedCount=0,unchangedCount=0;
      for(const [id,shift]of result){if(!prior.has(id))createdCount++;else if(sameShift(prior.get(id),shift))unchangedCount++;else updatedCount++;}
      return {valid:true,errors:[],...(range?{limited:true,range,openEnded:Engine.isOpenEnded(draft)}:{}),total:shifts.length,rawCount:raw.length,upcoming:shifts.filter(shift=>shift.date>=today).length,past:shifts.filter(shift=>shift.date<today).length,first:shifts[0]?clone(shifts[0]):null,last:shifts.length?clone(shifts.at(-1)):null,shifts,attached,detached,affectedCount:before.length,preservedCount,deletedCount:preserved?exceptions.deleted:0,removedCount,createdCount,updatedCount,unchangedCount,changedCount:removedCount+createdCount+updatedCount,exceptions:clone(exceptions)};
    }catch(error){return empty([error?.message||'Vagtseriens resultat kunne ikke beregnes.']);}
  }
  const api=Object.freeze({occurrences,chooseFutureAnchor,preview});
  globalThis.CleanRoomsSeriesPlanner=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
