/* Week visibility comes from layout, independently of the calendar's data cache. */
(() => {
  'use strict';
  const saved=new Map(),MAX_CONTEXTS=16;
  function stateFor(key){let value=saved.get(key);if(!value){value={heights:new Map(),anchor:null,backwards:false};saved.set(key,value);while(saved.size>MAX_CONTEXTS)saved.delete(saved.keys().next().value);}else{saved.delete(key);saved.set(key,value);}return value;}
  const add=(day,count)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
  function observe({element,key='calendar',onVisibleWeeks,restoreAnchor=true,env=globalThis}={}){
    if(!element||typeof onVisibleWeeks!=='function')throw new TypeError('Kalenderens synlige uger mangler.');
    const state=stateFor(String(key)),raf=env.requestAnimationFrame?.bind(env)||((callback)=>env.setTimeout(callback,16)),cancel=env.cancelAnimationFrame?.bind(env)||env.clearTimeout?.bind(env);
    let started=false,disposed=false,frame=null,resize=null,signature=null,restore=restoreAnchor&&state.anchor?{...state.anchor}:null,lastTop=Number(element.scrollTop)||0,lastSnapshot=null;
    const sections=()=>[...element.querySelectorAll('.cs-board-week')];
    function measure(){
      if(!element.isConnected)return null;
      const bounds=element.getBoundingClientRect(),height=Number.isFinite(element.clientHeight)?element.clientHeight:Number(bounds.height)||bounds.bottom-bounds.top;
      if(!Number.isFinite(height)||height<=0)return null;
      const top=bounds.top+(Number(element.clientTop)||0),bottom=top+height,rows=sections().map(section=>({section,date:section.dataset.start,rect:section.getBoundingClientRect()}));
      for(const row of rows){const height=Number(row.rect.height)||row.rect.bottom-row.rect.top;if(Number.isFinite(height)&&height>0)state.heights.set(row.date,height);}
      const visible=rows.filter(row=>row.rect.bottom>top+1&&row.rect.top<bottom-1);if(!visible.length)return null;
      const anchor={date:visible[0].date,offset:visible[0].rect.top-top};state.anchor=anchor;
      return {rows,visible,top,anchor};
    }
    function moved(){return Math.abs((Number(element.scrollTop)||0)-lastTop)>.5;}
    function cancelRestore(){restore=null;}
    function restorePosition(){
      if(!restore)return;
      // A newer scroll always wins, including one arriving before our first RAF.
      if(moved()){cancelRestore();return;}
      if(!element.isConnected||element.clientHeight<=0)return;
      const bounds=element.getBoundingClientRect(),section=sections().find(section=>section.dataset.start===restore.date);
      if(section){const difference=section.getBoundingClientRect().top-bounds.top-(Number(element.clientTop)||0)-restore.offset;if(Number.isFinite(difference))element.scrollTop=Math.max(0,(Number(element.scrollTop)||0)+difference);}
      restore=null;lastTop=Number(element.scrollTop)||0;
    }
    function capture(){
      // An unmeasurable/interrupted mount must not replace its date anchor with
      // coordinates from a board whose pending correction has not run yet.
      if(restore&&!moved())return {...restore};
      if(moved())state.backwards=(Number(element.scrollTop)||0)<lastTop;
      const value=measure();if(value)lastSnapshot={date:value.anchor.date,offset:value.anchor.offset};return lastSnapshot?{...lastSnapshot}:state.anchor?{...state.anchor}:null;
    }
    function update(){
      frame=null;if(disposed||!started||!element.isConnected)return;
      restorePosition();
      const value=measure();if(!value)return;lastSnapshot={...value.anchor};
      const dates=value.visible.map(row=>row.date),first=value.rows.indexOf(value.visible[0]),last=value.rows.indexOf(value.visible.at(-1)),top=Number(element.scrollTop)||0;if(moved())state.backwards=top<lastTop;lastTop=top;
      const backwards=state.backwards;
      const neighbor=backwards?(value.rows[first-1]||value.rows[last+1]):(value.rows[last+1]||value.rows[first-1]),prefetch=neighbor?[neighbor.date]:[],next=JSON.stringify([dates,prefetch]);
      if(next===signature)return;signature=next;
      onVisibleWeeks({from:dates[0],to:add(dates.at(-1),6),visible:dates,prefetch,anchor:{...value.anchor}});
    }
    function schedule(){if(!disposed&&started&&frame===null)frame=raf(update);}
    function watchSections(){if(!resize)return;resize.disconnect();resize.observe(element);for(const section of sections())resize.observe(section);}
    function patch(run){
      if(disposed)return false;
      restorePosition();
      if(moved())state.backwards=(Number(element.scrollTop)||0)<lastTop;
      const before=measure();lastTop=Number(element.scrollTop)||0;
      const result=run();
      if(before&&element.isConnected){
        const bounds=element.getBoundingClientRect(),section=sections().find(section=>section.dataset.start===before.anchor.date);
        if(section){const difference=section.getBoundingClientRect().top-bounds.top-(Number(element.clientTop)||0)-before.anchor.offset;
          // Keep the live scroll element and its native momentum. A write is
          // necessary only if patched content above the current week resized.
          if(Number.isFinite(difference)&&Math.abs(difference)>.5)element.scrollTop=Math.max(0,(Number(element.scrollTop)||0)+difference);
        }
        lastTop=Number(element.scrollTop)||0;const after=measure();if(after)lastSnapshot={...after.anchor};
      }
      watchSections();schedule();return result;
    }
    function scroll(){if(restore&&moved())cancelRestore();schedule();}
    function keyInput(event){if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))cancelRestore();}
    function start(){if(disposed||started)return;started=true;
      // The board is already mounted. Correct its geometry before paint and
      // before a second reconciliation render can capture intermediate layout.
      restorePosition();element.addEventListener('scroll',scroll,{passive:true});for(const type of ['wheel','touchstart','pointerdown'])element.addEventListener(type,cancelRestore,{passive:true});element.addEventListener('keydown',keyInput);env.addEventListener?.('resize',schedule,{passive:true});if(typeof env.ResizeObserver==='function'){resize=new env.ResizeObserver(schedule);watchSections();}schedule();}
    function dispose(){if(disposed)return;capture();disposed=true;if(frame!==null)cancel?.(frame);frame=null;resize?.disconnect();element.removeEventListener('scroll',scroll);for(const type of ['wheel','touchstart','pointerdown'])element.removeEventListener(type,cancelRestore);element.removeEventListener('keydown',keyInput);env.removeEventListener?.('resize',schedule);}
    return {start,capture,dispose,cancelRestore,patch};
  }
  const api=Object.freeze({observe,heightFor:(key,date)=>stateFor(String(key)).heights.get(date)||null});globalThis.CleanRoomsCalendarViewport=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
