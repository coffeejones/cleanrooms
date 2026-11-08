/* Exercise the actual browser persistence/cache over the real route adapter.
 * MessageChannel is local and deterministic: no network or browser-heap claim. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createContext,runInContext} from 'node:vm';
import {add,bytes,PERIOD} from './benchmark-fixtures.mjs';

export async function viewportBenchmark(sourceRoot,api){
  const require=createRequire(join(sourceRoot,'package.json'));
  const source=await readFile(join(sourceRoot,'src/studio-persistence.js'),'utf8');
  const shared={CleanRoomsPlanningRecords:require('./src/planning-records.js'),CleanRoomsPlanningScope:require('./src/planning-scope.js'),CleanRoomsPlanningWindow:require('./src/planning-window.js')};
  try{shared.CleanRoomsPlanningViewport=require('./src/planning-viewport.js');shared.CleanRoomsPlanningReconcile=require('./src/planning-reconcile.js');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
  const week=index=>({mode:'calendar',from:add(PERIOD.from,index*7),to:add(PERIOD.from,index*7+6)});
  const windowRange=(from,to)=>({mode:'calendar',from:week(from).from,to:week(to).to}),bounds=windowRange(0,7);
  function client(){
    let calls=[],responseBytes=0,maxCachedBytes=0,maxCachedWeeks=0,maxAuthorityBytes=0;
    let held=null;
    class Port{start(){}close(){this.closed=true;}postMessage(value){const copied=JSON.parse(JSON.stringify(value));queueMicrotask(()=>{if(!this.closed&&!this.peer.closed)this.peer.onmessage?.({data:copied});});}}
    class Channel{constructor(){this.port1=new Port();this.port2=new Port();this.port1.peer=this.port2;this.port2.peer=this.port1;}}
    const context=createContext({...shared,MessageChannel:Channel,TextEncoder,TextDecoder,setTimeout,clearTimeout,parent:{postMessage(_message,_origin,[port]){
      port.onmessage=async event=>{
        const message=event.data;assert.equal(message.action,'read','The scroll benchmark must not save a snapshot or fetch the whole company');assert.equal(message.projection?.mode,'calendar');
        const result=await api('studio',{query:{projection:'calendar',from:message.projection.from,to:message.projection.to,instructions:'deferred',...(message.cursor?{cursor:message.cursor}:{})}});
        calls.push({from:message.projection.from,to:message.projection.to,cursor:Boolean(message.cursor),status:result.status});responseBytes+=result.payloadBytes;
        if(held){const barrier=held;held=null;barrier.started();await barrier.wait;}
        port.postMessage({...result.body,ok:result.status===200,status:result.status,id:message.id});
      };
      port.postMessage({type:'cleanrooms-storage-ready'});
    }}});
    runInContext(source,context,{filename:'studio-persistence.js (route benchmark)'});
    const persistence=context.CleanRoomsPersistence.create();
    function observe(result){assert.equal(result.ok,true,JSON.stringify(result));const cache=persistence.viewportCache;if(cache){maxCachedBytes=Math.max(maxCachedBytes,cache.bytes);maxCachedWeeks=Math.max(maxCachedWeeks,cache.weeks);}maxAuthorityBytes=Math.max(maxAuthorityBytes,bytes(result.studio));return result;}
    return {persistence,load:async index=>observe(await persistence.load({projection:week(index)})),full:async()=>observe(await persistence.load({projection:{mode:'calendar',from:PERIOD.from,to:add(PERIOD.from,55)}})),move:async index=>observe(await persistence.viewport(week(index))),range:async(from,to)=>observe(await persistence.viewport(windowRange(from,to),{bounds})),rawRange:(from,to,options={})=>persistence.viewport(windowRange(from,to),{bounds,...options}),observe,pauseNext(){assert.equal(held,null);let start,release;const started=new Promise(resolve=>{start=resolve;}),wait=new Promise(resolve=>{release=resolve;});held={started:start,wait};return {started,release};},reset(){calls=[];responseBytes=0;maxCachedBytes=0;maxCachedWeeks=0;maxAuthorityBytes=0;},result(){return {status:200,payloadBytes:responseBytes,pages:calls.length,logicalReads:calls.filter(call=>!call.cursor).length,requests:calls,cache:{maxWeeks:maxCachedWeeks,maxSerializedBytes:maxCachedBytes,retained:persistence.viewportCache??null,maxAuthoritySerializedBytes:maxAuthorityBytes,measurement:'UTF-8 JSON working-set proxy; not JavaScript heap or browser rendering memory'}};}};
  }
  const prepared=(run,prepare)=>Object.assign(run,{prepare});
  return {
    week,
    operations(mode){
      if(mode==='bulk')return [['calendar_client_eight_weeks',prepared(async value=>{await value.full();return value.result();},async()=>client())]];
      assert.ok(['viewport','scrolling'].includes(mode));assert.ok(shared.CleanRoomsPlanningViewport,'The viewport protocol requires its actual shared cache');
      if(mode==='scrolling'){
        const traverse=async value=>{await value.load(0);await value.range(0,2);for(let index=1;index<=5;index++)await value.range(index,index+2);};
        return [
          ['scroll_first_week',prepared(async value=>{await value.load(0);return value.result();},async()=>client())],
          ['scroll_visible_plus_adjacent',prepared(async value=>{await value.load(0);await value.range(0,2);return value.result();},async()=>client())],
          ['scroll_traverse_eight_weeks',prepared(async value=>{await traverse(value);const before=value.result().pages;await value.range(4,6);await value.range(5,7);assert.equal(value.result().pages,before,'Nearby reverse navigation must hit retained weeks');const result=value.result();assert.ok(result.cache.maxWeeks<=4);return {...result,cacheHitRequests:0};},async()=>client())],
          ['scroll_reverse_evicted_range',prepared(async value=>{await value.range(0,2);const result=value.result();assert.ok(result.pages>0);assert.ok(result.cache.maxWeeks<=4);return result;},async()=>{const value=client();await traverse(value);value.reset();return value;})],
          ['scroll_superseded_inflight_range',prepared(async value=>{let current=true;const barrier=value.pauseNext(),old=value.rawRange(1,3,{isCurrent:()=>current,canRetain:()=>true});await barrier.started;current=false;barrier.release();const abandoned=await old;assert.equal(abandoned.ok,false);assert.equal(abandoned.superseded,true);assert.deepEqual(JSON.parse(JSON.stringify(value.persistence.projection)),week(0),'Obsolete work may populate a private cache but must not adopt old UI authority');value.observe(await value.rawRange(2,4));assert.deepEqual(JSON.parse(JSON.stringify(value.persistence.projection)),windowRange(2,4));return {...value.result(),superseded:true,measurementNote:'Same-context UI intent changes while the first old HTTP response is held; old work settles before the latest overlapping range starts, matching app serialization. No artificial sleep or network latency is added'};},async()=>{const value=client();await value.load(0);value.reset();return value;})]
        ];
      }
      return [
        ['calendar_viewport_first_week',prepared(async value=>{await value.load(0);return value.result();},async()=>client())],
        ['calendar_viewport_next_missing_week',prepared(async value=>{await value.move(1);return value.result();},async()=>{const value=client();await value.load(0);value.reset();return value;})],
        ['calendar_viewport_traverse_eight_weeks',prepared(async value=>{await value.load(0);for(let index=1;index<8;index++)await value.move(index);const before=value.result().pages;await value.move(6);assert.equal(value.result().pages,before,'A retained recent week must not fetch again');await value.move(7);assert.equal(value.result().pages,before);const result=value.result();assert.ok(result.cache.maxWeeks<=4);assert.equal(value.persistence.viewportCovers(week(0)),false,'A retained template cannot certify an evicted week');return result;},async()=>client())],
        ['calendar_viewport_evicted_week_reload',prepared(async value=>{await value.move(0);const result=value.result();assert.ok(result.pages>0,'An evicted week must fetch again');return result;},async()=>{const value=client();await value.load(0);for(let index=1;index<8;index++)await value.move(index);value.reset();return value;})]
      ];
    }
  };
}
