/* Bounded, advisory availability reads. No employee preferences enter plan snapshots. */
(() => {
  'use strict';
  const DAY=86400000,MAX_DAYS=56,MAX_PEOPLE=500;
  const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
  const add=(value,days)=>new Date(new Date(value+'T12:00:00Z').getTime()+days*DAY).toISOString().slice(0,10);
  function workedDates(shift){
    if(!validDate(shift?.date))return [];
    const result=[shift.date];
    if(typeof shift.start==='string'&&typeof shift.end==='string'&&shift.end<shift.start&&shift.end!=='00:00')result.push(add(shift.date,1));
    return result;
  }
  function create({request,onUpdate,now=()=>Date.now(),ttl=30000,maxPeople=5000}={}){
    let context='',epoch=0,active=0;
    const queue=[];
    const acquire=()=>new Promise(resolve=>{if(active<2){active++;resolve();}else queue.push(resolve);});
    const release=()=>{if(queue.length)queue.shift()();else active--;};
    const people=new Map(),pending=new Map(),errors=new Map();
    const within=(range,from,to)=>range.from<=from&&range.to>=to;
    const live=(ranges,from,to)=>{
      let cursor=from;
      for(const row of ranges.filter(row=>now()-row.at<ttl).sort((a,b)=>a.from.localeCompare(b.from))){
        if(row.to<cursor)continue;if(row.from>cursor)return false;cursor=add(row.to,1);if(cursor>to)return true;
      }
      return false;
    };
    function reset(value=''){context=String(value);epoch++;people.clear();pending.clear();errors.clear();}
    function setContext(value){if(String(value)!==context)reset(value);}
    const covered=(id,from,to)=>live(people.get(id)?.ranges||[],from,to);
    const inFlight=(id,from,to)=>[...pending.values()].some(row=>row.ids.includes(id)&&within(row,from,to));
    const failed=(id,from,to)=>[...errors.values()].some(row=>row.ids.includes(id)&&within(row,from,to)&&now()-row.at<10000);
    async function ensure({from,to,personIds=[]}={}){
      if(!context||typeof request!=='function'||!validDate(from)||!validDate(to)||from>to||(new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/DAY>=MAX_DAYS)return {ok:false};
      const ids=[...new Set(personIds.filter(id=>typeof id==='string'&&id.length>0))].sort();
      if(ids.length>MAX_PEOPLE)return {ok:false};
      const missing=ids.filter(id=>!covered(id,from,to)&&!inFlight(id,from,to)&&!failed(id,from,to));
      if(!missing.length)return {ok:true,cached:true};
      const key=JSON.stringify([from,to,missing]),token=epoch,scope=context,entry={from,to,ids:missing};pending.set(key,entry);
      await acquire();
      try{
        if(token!==epoch||scope!==context)return {ok:false,stale:true};
        const result=await request({from,to,personIds:missing});
        if(token!==epoch||scope!==context)return {ok:false,stale:true};
        if(!result?.ok||result.from!==from||result.to!==to||!Array.isArray(result.people)||result.people.length!==missing.length)throw new Error('availability_read_invalid');
        const requested=new Set(missing),received=new Set(),rows=[];
        for(const row of result.people){
          if(!row||!requested.has(row.personId)||received.has(row.personId)||!Number.isSafeInteger(row.version)||row.version<0||!Array.isArray(row.unavailableDates)||row.unavailableDates.length>MAX_DAYS||row.unavailableDates.some(day=>!validDate(day)||day<from||day>to)||new Set(row.unavailableDates).size!==row.unavailableDates.length)throw new Error('availability_read_invalid');
          received.add(row.personId);rows.push(row);
        }
        for(const row of rows){
          if((people.get(row.personId)?.version??-1)>row.version)continue;
          const prior=people.get(row.personId),current=prior?.version===row.version?prior:{version:row.version,dates:new Set(),ranges:[]};
          for(const day of current.dates)if(day>=from&&day<=to)current.dates.delete(day);
          row.unavailableDates.forEach(day=>current.dates.add(day));current.ranges.push({from,to,at:now()});current.ranges=current.ranges.filter(range=>now()-range.at<ttl).slice(-16);
          people.delete(row.personId);people.set(row.personId,current);
        }
        while(people.size>maxPeople)people.delete(people.keys().next().value);
        errors.delete(key);return {ok:true};
      }catch{
        if(token===epoch&&scope===context)errors.set(key,{...entry,at:now()});
        while(errors.size>32)errors.delete(errors.keys().next().value);
        return {ok:false};
      }finally{release();if(token===epoch&&scope===context){pending.delete(key);onUpdate?.();}}
    }
    return Object.freeze({setContext,reset,ensure,
      isUnavailable:(id,day)=>people.get(id)?.dates.has(day)===true,
      dates:(id,from,to)=>[...(people.get(id)?.dates||[])].filter(day=>day>=from&&day<=to).sort(),
      status:(id,from,to=from)=>covered(id,from,to)?'ready':inFlight(id,from,to)?'loading':failed(id,from,to)?'error':'unknown'
    });
  }
  const api=Object.freeze({create,workedDates,MAX_DAYS,MAX_PEOPLE});globalThis.CleanRoomsPlanningAvailability=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
