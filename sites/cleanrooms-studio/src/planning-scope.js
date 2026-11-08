/* Read-only operation projections never grant authority over omitted records. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const add=(day,count)=>{const value=new Date(day+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+count);return value.toISOString().slice(0,10);};
  const monday=day=>add(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!['__proto__','prototype','constructor'].includes(value)&&!/[\u0000-\u001f\u007f]/.test(value);
  function interval(value,maxDays=366){if(!record(value)||Object.keys(value).some(key=>!['from','to'].includes(key))||!validDate(value.from)||!validDate(value.to)||value.to<value.from||(Date.parse(value.to)-Date.parse(value.from))/86400000>=maxDays)throw new TypeError('Vælg en gyldig afgrænset periode.');return {from:value.from,to:value.to};}
  function mergeRanges(values){const sorted=values.map(value=>interval(value,40000)).sort((one,two)=>one.from.localeCompare(two.from)||one.to.localeCompare(two.to)),result=[];for(const range of sorted){const previous=result.at(-1);if(previous&&range.from<=add(previous.to,1)){if(range.to>previous.to)previous.to=range.to;}else result.push({...range});}return result;}
  function normalize(value){
    if(!record(value))throw new TypeError('Vælg en gyldig planvisning.');
    if(value.mode==='calendar'){if(Object.keys(value).some(key=>!['mode','from','to'].includes(key)))throw new TypeError('Kalenderens afgrænsning er ugyldig.');return {mode:'calendar',...interval({from:value.from,to:value.to},56)};}
    const allowed=value.mode==='series-list'?['mode','calendar','catalogOnly']:value.mode==='series'?['mode','seriesId','groupId','ranges','calendar']:value.mode==='publication'?['mode','from','to','siteIds','includeDependencies','calendar']:null;
    if(!allowed||Object.keys(value).some(key=>!allowed.includes(key)))throw new TypeError('Planvisningens afgrænsning er ugyldig.');
    const calendar=interval(value.calendar,56);
    if(value.mode==='series-list'){if(value.catalogOnly!==undefined&&value.catalogOnly!==true)throw new TypeError('Vælg en gyldig serieoversigt.');return {mode:value.mode,calendar,...(value.catalogOnly===true?{catalogOnly:true}:{})};}
    if(value.mode==='series'){
      for(const key of ['seriesId','groupId'])if(value[key]!==undefined&&!validId(value[key]))throw new TypeError('Vælg en gyldig vagtserie.');
      if(!Array.isArray(value.ranges)||value.ranges.length>20000)throw new TypeError('Vælg gyldige perioder til vagtserien.');
      const ranges=[];for(const merged of mergeRanges(value.ranges.map(range=>interval(range))))for(let from=merged.from;from<=merged.to;from=add(from,366)){const end=add(from,365);ranges.push({from,to:end<merged.to?end:merged.to});}
      return {mode:value.mode,...(value.seriesId!==undefined?{seriesId:value.seriesId}:{}),...(value.groupId!==undefined?{groupId:value.groupId}:{}),ranges,calendar};
    }
    const range=interval({from:value.from,to:value.to});
    if(monday(range.from)!==range.from||range.to!==add(monday(range.to),6)||!Array.isArray(value.siteIds)||!value.siteIds.length||value.siteIds.length>2000||value.siteIds.some(site=>!Number.isInteger(site)||site<0||site>=2000)||new Set(value.siteIds).size!==value.siteIds.length||typeof value.includeDependencies!=='boolean')throw new TypeError('Vælg hele uger og gyldige arbejdssteder til udgivelsen.');
    return {mode:value.mode,...range,siteIds:[...value.siteIds].sort((a,b)=>a-b),includeDependencies:value.includeDependencies,calendar};
  }
  const calendar=projection=>projection.mode==='calendar'?{from:projection.from,to:projection.to}:{...projection.calendar};
  function ranges(projection,extra=[]){const normalized=normalize(projection),base=normalized.mode==='series'?normalized.ranges:normalized.mode==='publication'?[{from:normalized.from,to:normalized.to}]:[calendar(normalized)];return mergeRanges([...base,...extra].map(range=>({from:monday(range.from)<'2000-01-01'?'2000-01-01':monday(range.from),to:add(monday(range.to),6)>'2100-12-31'?'2100-12-31':add(monday(range.to),6)})));}
  const fields=(value,names)=>Object.fromEntries(names.filter(name=>value?.[name]!==undefined).map(name=>[name,clone(value[name])]));
  function compact(kind,id,value){
    if(value===null)return null;
    const compactValue=(source,names)=>({...fields(source,names),...(Instructions?{_instructions:Instructions.metadata(source)}:{})});
    if(kind==='series')return compactValue(value,['id','person','site','startDate','endDate','openEnded','weekdays','start','end','plannedBreakMinutes','dayTimes','groupId']);
    if(kind==='shift')return {edit:value?.edit?compactValue(value.edit,['id','person','site','date','start','end','plannedBreakMinutes','seriesId']):null,suppressed:value?.suppressed===true};
    if(kind==='published')return compactValue(value,['id','person','site','date','start','end','plannedBreakMinutes','seriesId']);
    if(kind==='week')return {...clone(value),...(Array.isArray(value.baseline)?{baseline:value.baseline.map(shift=>compact('published',shift.id,shift))}:{})};
    return null;
  }
  function summary(kind,id,value){const source=kind==='shift'?value?.edit:value;return {kind,id,value:compact(kind,id,value),hasDescription:Instructions?Instructions.metadata(source).hasDescription:typeof source?.note==='string'&&Boolean(source.note.trim())||Boolean(source?.noteRich)};}
  function summaryStudio(values){const result={series:[],edits:{},deleted:[],published:[],demoSeed:false};for(const item of values||[]){if(item.kind==='series'&&item.value)result.series.push(clone(item.value));else if(item.kind==='shift'&&item.value){if(item.value.edit)result.edits[item.id]=clone(item.value.edit);if(item.value.suppressed)result.deleted.push(item.id);}else if(item.kind==='published'&&item.value)result.published.push(clone(item.value));}return result;}
  const api=Object.freeze({normalize,calendar,ranges,mergeRanges,compact,summary,summaryStudio,validDate,validId,monday,add});globalThis.CleanRoomsPlanningScope=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
