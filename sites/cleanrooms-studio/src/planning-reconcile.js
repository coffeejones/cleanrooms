/* Patch acknowledged plan records without closing editors, changing view preferences or undoing peers. */
(() => {
  'use strict';
  const Planning=globalThis.CleanRoomsPlanningRecords||(typeof require==='function'?require('./planning-records.js'):null);
  const Data=globalThis.CleanRoomsData||(typeof require==='function'?require('./studio-data.js'):null);
  const Instructions=globalThis.CleanRoomsInstructions||Planning?.instructionState;
  const Scope=globalThis.CleanRoomsPlanningScope||(typeof require==='function'?require('./planning-scope.js'):null);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  function semantic(value){
    if(Array.isArray(value))return value.map(semantic);if(!value||typeof value!=='object')return value;
    const instruction=Instructions&&(Instructions.isDeferred(value)||Object.hasOwn(value,'note')||Object.hasOwn(value,'noteRich')),result=Object.fromEntries(Object.entries(value).filter(([key])=>!instruction||!['note','noteRich','_instructions'].includes(key)).map(([key,item])=>[key,semantic(item)]));
    if(instruction)result._instructionToken=Instructions.signature(value);return result;
  }
  const semanticCanonical=value=>Planning.canonical(semantic(value));
  function hydrateUndo(undo,incoming,context){
    if(!undo||!context.detailHydration)return undo;const before=new Map(Planning.flatten(context.previous||context.submitted||{}).map(row=>[Planning.key(row.kind,row.id),row.value])),rows=Planning.flatten(incoming),changes=[];
    for(const row of Planning.flatten(undo)){const key=Planning.key(row.kind,row.id),next=rows.find(item=>Planning.key(item.kind,item.id)===key);if(next&&Planning.canonical(semantic(row.value))===Planning.canonical(semantic(before.get(key))))changes.push(next);}
    return Planning.apply(undo,changes);
  }
  function promoteViewport(current,incoming,context={}){
    if(!context.viewport||context.samePlanningGeneration!==true||!Scope||!Instructions)return incoming;
    const prior=new Map(Planning.flatten(context.previous||{}).map(row=>[Planning.key(row.kind,row.id),row])),local=new Map(Planning.flatten(current).map(row=>[Planning.key(row.kind,row.id),row])),upgrades=[];
    for(const row of Planning.flatten(incoming)){
      if(!['series','shift'].includes(row.kind)||!Instructions.contains(row.value))continue;
      const key=Planning.key(row.kind,row.id),before=prior.get(key),actual=local.get(key),version=context.previousPlanningVersions?.[key];
      if(!before||!actual||!Number.isSafeInteger(version)||version<1||context.planningVersions?.[key]!==version||Instructions.contains(before.value)||Planning.canonical(actual.value)!==Planning.canonical(before.value))continue;
      try{
        const one=row.kind==='shift'?before.value?.edit:before.value,two=row.kind==='shift'?row.value?.edit:row.value;
        if(!one||!two||!Instructions.equal(one,two)||Planning.canonical(Scope.compact(row.kind,row.id,before.value))!==Planning.canonical(Scope.compact(row.kind,row.id,row.value)))continue;
        upgrades.push({...row,value:clone(before.value)});
      }catch{}
    }
    return upgrades.length?Planning.apply(incoming,upgrades):incoming;
  }
  function reconcile(current,incoming,lastUndo=null,context={}){
    // Preserve hydrated bodies only while the same record is still in view.
    const promoted=promoteViewport(current,incoming,context);
    if(promoted!==incoming){incoming=promoted;context={...context,acknowledged:promoteViewport(current,context.acknowledged||incoming,context)};}
    current=hydrateUndo(current,incoming,context);
    lastUndo=hydrateUndo(lastUndo,incoming,context);
    const state=clone(current),metadata=Planning.metadata(incoming);
    for(const field of Object.keys(Planning.metadata(current)))if(!Object.hasOwn(metadata,field))delete state[field];
    Object.assign(state,clone(metadata));
    for(const field of Planning.RECORD_FIELDS)state[field]=clone(incoming[field]??(field==='series'||field==='deleted'?[]:{}));
    const inverse=lastUndo?Planning.diff(current,lastUndo):[],localRows=new Map(Planning.flatten(current).map(row=>[Planning.key(row.kind,row.id),row.value])),incomingRows=new Map(Planning.flatten(incoming).map(row=>[Planning.key(row.kind,row.id),row.value]));
    const submittedRows=context.submitted?new Map(Planning.flatten(context.submitted).map(row=>[Planning.key(row.kind,row.id),row.value])):null,ackRows=context.acknowledged?new Map(Planning.flatten(context.acknowledged).map(row=>[Planning.key(row.kind,row.id),row.value])):null;
    const conflicted=inverse.some(change=>{if(change.kind==='week')return false;const id=Planning.key(change.kind,change.id),local=Planning.canonical(localRows.get(id)??null);return Planning.canonical(incomingRows.get(id)??null)!==local||submittedRows&&ackRows&&Planning.canonical(submittedRows.get(id)??null)!==Planning.canonical(ackRows.get(id)??null)&&Planning.canonical(ackRows.get(id)??null)!==local;});
    const undo=lastUndo&&!conflicted?Planning.apply(state,inverse):null;
    if(undo){
      // snapshot() is intentionally partial. Restore only captured editable fields,
      // and only while the acknowledged value still matches our local value.
      const before=Planning.metadata(lastUndo),local=Planning.metadata(current);
      for(const field of Object.keys(before))if(Planning.canonical(before[field])!==Planning.canonical(local[field])&&Planning.canonical(metadata[field])===Planning.canonical(local[field]))undo[field]=clone(before[field]);
    }
    return {state,undo};
  }
  const selectedShift=shift=>shift?Object.fromEntries(['id','person','site','date','start','end','plannedBreakMinutes','seriesId','note','noteRich','_instructions'].filter(field=>shift[field]!==undefined).map(field=>[field,clone(shift[field])])):null;
  function parents(studio,ids,seriesId){
    const found=new Set(seriesId?[seriesId]:[]);
    for(const id of ids){const shift=Data.shiftById(id,studio);if(shift?.seriesId)found.add(shift.seriesId);for(const series of studio.series||[])if(id.startsWith(series.id+'@'))found.add(series.id);}
    return found;
  }
  function oneProjection(studio,selection){
    const parentIds=parents(studio,selection.ids,selection.seriesId),byId=new Map((studio.series||[]).map(series=>[series.id,series]));
    return {shifts:selection.ids.map(id=>[id,selectedShift(Data.shiftById(id,studio))]),series:[...parentIds].sort().map(id=>[id,clone(byId.get(id)||null)])};
  }
  function groupProjection(studio,selection){
    const groupIds=new Set(selection.groupIds),explicit=parents(studio,selection.ids,selection.seriesId);
    for(const series of studio.series||[])if(explicit.has(series.id))groupIds.add(series.groupId||series.id);
    const series=(studio.series||[]).filter(series=>groupIds.has(series.groupId||series.id)),ids=new Set(series.map(series=>series.id));
    const rows=Planning.flatten(studio).filter(row=>row.kind==='shift'&&(ids.has(row.value.edit?.seriesId)||series.some(series=>row.id.startsWith(series.id+'@'))));
    return {groups:[...groupIds].sort(),series:series.map(item=>clone(item)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),shifts:rows.map(({id,value})=>[id,value]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)};
  }
  function capture(studio,{shifts=[],seriesId=null,groupId=null}={}){
    const ids=[...new Set(shifts.map(shift=>typeof shift==='string'?shift:shift?.id).filter(id=>typeof id==='string'&&id))].sort(),groupIds=new Set(groupId?[groupId]:[]);
    const selectedParents=parents(studio,ids,seriesId);for(const series of studio.series||[])if(selectedParents.has(series.id))groupIds.add(series.groupId||series.id);
    const selection={ids,seriesId,groupIds:[...groupIds].sort()};
    return freeze({selection,baselineOne:oneProjection(studio,selection),baselineSeries:groupProjection(studio,selection),staleOne:false,staleSeries:false});
  }
  function advance(captured,{submitted,acknowledged}={}){
    if(!captured||!submitted||!acknowledged)return captured;
    const one=oneProjection(acknowledged,captured.selection),group=groupProjection(acknowledged,captured.selection);
    return freeze({...clone(captured),staleOne:captured.staleOne||(semanticCanonical(oneProjection(submitted,captured.selection))!==semanticCanonical(one)&&semanticCanonical(captured.baselineOne)!==semanticCanonical(one)),staleSeries:captured.staleSeries||(semanticCanonical(groupProjection(submitted,captured.selection))!==semanticCanonical(group)&&semanticCanonical(captured.baselineSeries)!==semanticCanonical(group))});
  }
  function upgradeCapture(captured,context={}){
    if(!captured||!context.submitted||!context.acknowledged)return captured;
    const {submitted,acknowledged,previousProjection}=context,advanced=advance(captured,context),selection=clone(captured.selection);
    const before=groupProjection(submitted,selection),after=groupProjection(acknowledged,selection),baseline=captured.baselineSeries;
    const rows=value=>new Map([...value.series.map(item=>[Planning.key('series',item.id),item]),...value.shifts.map(([id,value])=>[Planning.key('shift',id),value])]);
    const observed=rows(before),current=rows(after),original=rows(baseline);
    let changed=false;
    for(const [id,value]of observed)if(semanticCanonical(value)!==semanticCanonical(current.get(id)??null)&&semanticCanonical(original.get(id)??null)!==semanticCanonical(current.get(id)??null)){changed=true;break;}
    const calendar=previousProjection?.mode==='calendar'?previousProjection:previousProjection?.calendar;
    const covered=day=>typeof day==='string'&&calendar&&day>=calendar.from&&day<=calendar.to;
    if(calendar)for(const [key,value]of current){
      if(observed.has(key))continue;
      const [kind,id]=JSON.parse(key),inside=kind==='series'?value.startDate<=calendar.to&&value.endDate>=calendar.from:covered(id.slice(-10))||covered(value?.edit?.date);
      if(inside){changed=true;break;}
    }
    return freeze({selection,baselineOne:oneProjection(acknowledged,selection),baselineSeries:after,staleOne:advanced.staleOne,staleSeries:captured.staleSeries||advanced.staleOne||changed});
  }
  const stale=(captured,scope='one')=>Boolean(captured&&(scope==='one'?captured.staleOne:captured.staleSeries));
  const api=Object.freeze({reconcile,promoteViewport,capture,advance,upgradeCapture,stale});globalThis.CleanRoomsPlanningReconcile=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
