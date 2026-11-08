/* One personal calendar window and one lazily loaded shift; no company plan. */
(() => {
  'use strict';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const failure=(message,status=503)=>({ok:false,status,message});
  function create({transport,onChange=()=>{}}={}){
    if(typeof transport?.action!=='function')throw new TypeError('Medarbejderkalenderens forbindelse mangler.');
    let data=null,key='',pendingKey='',pending=null,epoch=0,detailEpoch=0,detail=null,loading=false,error='',firstPage=null;
    const scopeKey=scope=>JSON.stringify([scope.personId,scope.from,scope.to]);
    const emit=()=>onChange({data:clone(data),loading,error});
    function seed(value){if(!value?.person?.id||!value.from||!value.to)return false;epoch++;detailEpoch++;pending=null;pendingKey='';loading=false;data=clone(value);if(value.nextShift?.person===value.person.id)data.shifts=[...new Map([...(data.shifts||[]),clone(value.nextShift)].map(shift=>[shift.id,shift])).values()];key=scopeKey({personId:value.person.id,from:value.from,to:value.to});firstPage=value.nextCursor?clone(value):null;detail=null;error='';return true;}
    async function load(scope,{force=false}={}){
      const selected=scopeKey(scope);if(pending&&pendingKey===selected)return pending;
      if(!force&&key===selected&&!firstPage)return {ok:!error,data:clone(data),message:error,cached:true};
      const generation=++epoch;detailEpoch++;detail=null;loading=true;error='';pendingKey=selected;
      const work=(async()=>{
        let result;
        for(let attempt=0;attempt<2;attempt++){
          const first=attempt===0&&firstPage&&key===selected?firstPage:await transport.action('employeeRead',scope),shifts=new Map(),sites=new Map(),tasks={},seen=new Set();let page=first,bytes=0;
          while(page?.ok!==false&&page?.person){
            if(generation!==epoch)return {ok:false,superseded:true};
            if(page.person.id!==scope.personId||page.from!==scope.from||page.to!==scope.to||['planRevision','directoryRevision'].some(field=>page[field]!==first[field])||!Array.isArray(page.shifts)){page=failure('Vagterne er ændret under indlæsningen. Prøv igen.',409);break;}
            bytes+=new TextEncoder().encode(JSON.stringify(page)).byteLength;
            for(const shift of page.shifts){if(shift.person!==scope.personId){page=failure('Kalenderens medarbejder stemmer ikke overens.',409);break;}shifts.set(shift.id,clone(shift));}
            if(page.ok===false)break;
            for(const site of page.sites||[])sites.set(site.index,clone(site));Object.assign(tasks,clone(page.taskSummaries||{}));
            if(shifts.size>50000||bytes>64*1024*1024){page=failure('Kalenderperioden fylder for meget. Vælg en kortere periode.',413);break;}
            if(!page.nextCursor)break;
            if(typeof page.nextCursor!=='string'||seen.has(page.nextCursor)){page=failure('Kalenderens sidehenvisning er ændret. Prøv igen.',409);break;}
            seen.add(page.nextCursor);page=await transport.action('employeeRead',{...scope,cursor:page.nextCursor});
          }
          if(generation!==epoch)return {ok:false,superseded:true};
          if(page?.ok===false){result=page;if(page.status===409&&attempt===0){firstPage=null;continue;}break;}
          if(!page?.person){result=failure('Dine vagter kunne ikke indlæses.');break;}
          if(first.nextShift){if(first.nextShift.person!==scope.personId){result=failure('Den næste vagt er ændret.',409);break;}shifts.set(first.nextShift.id,clone(first.nextShift));}
          result={...clone(first),ok:true,shifts:[...shifts.values()],sites:[...sites.values()],taskSummaries:tasks,nextCursor:null,progress:{}};break;
        }
        if(generation!==epoch)return {ok:false,superseded:true};
        key=selected;firstPage=null;loading=false;pending=null;pendingKey='';
        if(result?.ok){data=clone(result);error='';}else{data=null;error=result?.message||'Dine vagter kunne ikke indlæses.';}
        emit();return result?clone(result):failure(error);
      })().catch(cause=>{if(generation!==epoch)return {ok:false,superseded:true};key=selected;firstPage=null;loading=false;pending=null;pendingKey='';data=null;error=cause?.message||'Dine vagter kunne ikke indlæses.';emit();return failure(error);});
      pending=work;emit();return work;
    }
    async function open({personId,shiftId}){
      const generation=++detailEpoch,calendarEpoch=epoch;let result;try{result=await transport.action('employeeShift',{personId,shiftId});}catch(cause){result=failure(cause?.message||'Vagten kunne ikke indlæses.');}
      if(generation!==detailEpoch||calendarEpoch!==epoch)return {ok:false,superseded:true};
      if(!result.ok)return result;
      if(result.shift?.person!==personId||result.shift?.id!==shiftId)return failure('Vagten er ikke længere tildelt denne medarbejder.',409);
      detail=clone(result);return result;
    }
    function cancelDetail(){detailEpoch++;detail=null;}
    function reset(){epoch++;detailEpoch++;data=null;detail=null;key='';pendingKey='';pending=null;firstPage=null;loading=false;error='';}
    return Object.freeze({load,open,seed,cancelDetail,reset,invalidate(){key='';firstPage=null;},get data(){return clone(data);},get detail(){return clone(detail);},get loading(){return loading;},get error(){return error;}});
  }
  const api=Object.freeze({create});globalThis.CleanRoomsEmployeePersistence=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
