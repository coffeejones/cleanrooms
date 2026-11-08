const test=require('node:test'),assert=require('node:assert/strict'),Viewport=require('../src/calendar-viewport.js');
const add=(day,count)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
let nextKey=0;
function fixture({key='viewport-'+(++nextKey),height=500,heights=Array(8).fill(724),scrollTop=0,restoreAnchor=true,dynamic=false}={}){
 const events=new Map(),windowEvents=new Map(),frames=new Map(),calls=[],observers=[];let nextFrame=0;
 const element={isConnected:true,clientHeight:height,clientTop:0,scrollTop,addEventListener:(type,callback,options)=>events.set(type,{callback,options}),removeEventListener:type=>events.delete(type),getBoundingClientRect:()=>({top:100,bottom:100+element.clientHeight,height:element.clientHeight,left:0,right:1000})};
 let start=0;const sections=heights.map((height,index)=>{const top=start;start+=height;return {dataset:{start:add('2026-10-26',index*7)},getBoundingClientRect:()=>{const y=dynamic?heights.slice(0,index).reduce((sum,value)=>sum+value,0):top,h=dynamic?heights[index]:height;return {top:100+y-element.scrollTop,bottom:100+y+h-element.scrollTop,height:h};}};});
 element.querySelectorAll=selector=>selector==='.cs-board-week'?sections:[];
 const env={requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),addEventListener:(type,callback)=>windowEvents.set(type,callback),removeEventListener:type=>windowEvents.delete(type),ResizeObserver:class{constructor(callback){this.callback=callback;this.targets=[];this.disconnected=false;observers.push(this);}observe(value){this.targets.push(value);}disconnect(){this.disconnected=true;}}};
 const controller=Viewport.observe({element,key,env,restoreAnchor,onVisibleWeeks:value=>calls.push(value)}),flush=()=>{const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback();};
 return {key,element,sections,events,windowEvents,frames,calls,observers,controller,flush,scroll:top=>{element.scrollTop=top;events.get('scroll')?.callback();}};
}

test('visible-week requests use layout and one neighbor without eagerly requesting the eight-week scaffold',()=>{
 const view=fixture();assert.equal(view.calls.length,0);view.controller.start();assert.equal(view.frames.size,1);view.flush();assert.equal(view.calls.length,1);assert.deepEqual(view.calls[0].visible,['2026-10-26']);assert.deepEqual(view.calls[0].prefetch,['2026-11-02']);assert.equal(view.calls[0].from,'2026-10-26');assert.equal(view.calls[0].to,'2026-11-01');assert.deepEqual(view.calls[0].anchor,{date:'2026-10-26',offset:0});assert.equal(view.events.get('scroll').options.passive,true);assert.equal(view.observers[0].targets.length,9);view.controller.dispose();
});

test('passive scroll events are coalesced and only a changed visible range requests more data',()=>{
 const view=fixture();view.controller.start();view.flush();for(let index=0;index<20;index++)view.scroll(800);assert.equal(view.frames.size,1);view.flush();assert.equal(view.calls.length,2);assert.deepEqual(view.calls[1].visible,['2026-11-02']);assert.deepEqual(view.calls[1].prefetch,['2026-11-09']);assert.deepEqual(view.calls[1].anchor,{date:'2026-11-02',offset:-76});view.scroll(820);view.flush();assert.equal(view.calls.length,2);assert.deepEqual(view.controller.capture(),{date:'2026-11-02',offset:-96});view.controller.dispose();
});

test('resize geometry can request several actually visible weeks while keeping a single prefetch neighbor',()=>{
 const view=fixture();view.controller.start();view.flush();view.element.clientHeight=1600;view.observers[0].callback();view.observers[0].callback();assert.equal(view.frames.size,1);view.flush();assert.deepEqual(view.calls.at(-1).visible,['2026-10-26','2026-11-02','2026-11-09']);assert.deepEqual(view.calls.at(-1).prefetch,['2026-11-16']);assert.equal(view.calls.at(-1).to,'2026-11-15');view.controller.dispose();
});

test('rerender restores a date and offset when earlier week heights change, with explicit navigation able to opt out',()=>{
 const first=fixture({scrollTop:800});first.controller.start();first.flush();first.controller.dispose();assert.equal(Viewport.heightFor(first.key,'2026-10-26'),724);
 const second=fixture({key:first.key,scrollTop:800,heights:[900,...Array(7).fill(724)]});second.controller.start();second.flush();assert.equal(second.element.scrollTop,976);assert.deepEqual(second.controller.capture(),{date:'2026-11-02',offset:-76});second.controller.dispose();
 const navigation=fixture({key:first.key,scrollTop:0,restoreAnchor:false});navigation.controller.start();navigation.flush();assert.equal(navigation.element.scrollTop,0);assert.equal(navigation.calls[0].anchor.date,'2026-10-26');navigation.controller.dispose();
});

test('disposal disconnects every watcher and cancels pending or stale geometry callbacks',()=>{
 const view=fixture();view.controller.start();view.controller.dispose();view.controller.dispose();assert.equal(view.frames.size,0);assert.equal(view.events.size,0);assert.equal(view.windowEvents.size,0);assert.equal(view.observers[0].disconnected,true);view.observers[0].callback();view.flush();assert.equal(view.calls.length,0);
});

test('a detached or zero-height board requests nothing until its real viewport becomes measurable',()=>{
 const view=fixture({height:0});view.element.isConnected=false;view.controller.start();view.flush();assert.equal(view.calls.length,0);view.element.isConnected=true;view.element.clientHeight=500;view.observers[0].callback();view.flush();assert.equal(view.calls.length,1);assert.equal(view.calls[0].visible.length,1);view.controller.dispose();
});

test('scrolling up before the first frame after async remount wins over the old week-49 anchor',()=>{
 const before=fixture({scrollTop:5*724+50});before.controller.start();before.flush();assert.equal(before.calls.at(-1).anchor.date,'2026-11-30');before.controller.dispose();
 const after=fixture({key:before.key,scrollTop:5*724+50});after.controller.start();after.scroll(4*724+40);after.flush();assert.equal(after.element.scrollTop,4*724+40,'The pending old anchor must not pull the user back down');assert.deepEqual(after.calls.at(-1).anchor,{date:'2026-11-23',offset:-40});after.controller.dispose();
});

test('continuous upward scrolling stays monotone across repeated read-completion remounts',()=>{
 const initial=fixture({scrollTop:5*724+50});initial.controller.start();initial.flush();initial.controller.dispose();let top=initial.element.scrollTop;
 for(let index=0;index<4;index++){
  const view=fixture({key:initial.key,scrollTop:top});view.controller.start();const wanted=top-400;view.scroll(wanted);view.flush();assert.equal(view.element.scrollTop,wanted,'A later render cycle must not resurrect the previously saved position');assert.equal(view.calls.at(-1).anchor.date,add('2026-10-26',Math.floor(wanted/724)*7));view.controller.dispose();top=wanted;
 }
});

test('two read-completion renders before a frame preserve the date anchor while earlier heights change',()=>{
 const before=fixture({scrollTop:5*724+50});before.controller.start();before.flush();before.controller.dispose();const heights=[1000,...Array(7).fill(724)];
 // A service reconciliation renders, then its outer loading finally renders
 // again. The second render must use the first board's actual latest position.
 const intermediate=fixture({key:before.key,scrollTop:before.element.scrollTop,heights});intermediate.controller.start();const latestTop=intermediate.element.scrollTop;intermediate.controller.dispose();
 const after=fixture({key:before.key,scrollTop:latestTop,heights});after.controller.start();after.flush();assert.equal(after.element.scrollTop,5*724+50+276);assert.deepEqual(after.calls.at(-1).anchor,{date:'2026-11-30',offset:-50});after.controller.dispose();
});

test('new scroll intent cancels a deferred hidden-board restore without losing ordinary layout restoration',()=>{
 const before=fixture({scrollTop:5*724+50});before.controller.start();before.flush();before.controller.dispose();
 const hidden=fixture({key:before.key,height:0,scrollTop:5*724+50,heights:[1000,...Array(7).fill(724)]});hidden.controller.start();hidden.flush();assert.equal(hidden.calls.length,0);assert.equal(hidden.element.scrollTop,5*724+50,'An unmeasurable hidden board must defer its layout compensation');hidden.element.clientHeight=500;hidden.scroll(4*724+40);hidden.flush();assert.equal(hidden.element.scrollTop,4*724+40);assert.equal(hidden.calls.at(-1).anchor.date,'2026-11-16');hidden.controller.dispose();
});

test('an upward prefetch direction survives remount, height compensation and unchanged queued scroll events',()=>{
 const before=fixture({scrollTop:5*724+50});before.controller.start();before.flush();before.scroll(4*724+40);before.flush();assert.deepEqual(before.calls.at(-1).prefetch,['2026-11-16']);before.controller.dispose();
 const after=fixture({key:before.key,scrollTop:before.element.scrollTop,heights:[1000,...Array(7).fill(724)]});after.controller.start();after.scroll(after.element.scrollTop);after.flush();assert.deepEqual(after.calls.at(-1).anchor,{date:'2026-11-23',offset:-40});assert.deepEqual(after.calls.at(-1).prefetch,['2026-11-16'],'A rerender is not a new downward user movement');after.scroll(after.element.scrollTop+24);after.flush();assert.deepEqual(after.calls.at(-1).prefetch,['2026-11-30'],'A later real downward movement must still change the prefetch direction');after.controller.dispose();
});

test('in-place data patches keep the latest live scroll position and never write scrollTop when geometry is unchanged',()=>{
 const view=fixture({scrollTop:5*724+50});view.controller.start();view.flush();view.scroll(4*724+40);
 let position=view.element.scrollTop,writes=0;Object.defineProperty(view.element,'scrollTop',{get:()=>position,set:value=>{writes++;position=value;},configurable:true});
 for(let index=0;index<8;index++)assert.equal(view.controller.patch(()=>true),true);view.flush();
 assert.equal(writes,0,'Even writing the same value can interrupt a native scroll session');assert.equal(position,4*724+40);assert.deepEqual(view.controller.capture(),{date:'2026-11-23',offset:-40});assert.deepEqual(view.calls.at(-1).prefetch,['2026-11-16']);assert.equal(view.observers.length,1);view.controller.dispose();assert.equal(view.controller.patch(()=>assert.fail('Disposed patches must not run')),false);
});

test('a live patch compensates only changed height above the current week without reversing user direction',()=>{
 const heights=Array(8).fill(724),view=fixture({scrollTop:5*724+50,heights,dynamic:true});view.controller.start();view.flush();view.scroll(4*724+40);view.flush();
 let position=view.element.scrollTop,writes=0;Object.defineProperty(view.element,'scrollTop',{get:()=>position,set:value=>{writes++;position=value;},configurable:true});
 view.controller.patch(()=>{heights[0]+=276;});view.flush();assert.equal(writes,1);assert.equal(position,4*724+40+276);assert.deepEqual(view.controller.capture(),{date:'2026-11-23',offset:-40});assert.deepEqual(view.calls.at(-1).prefetch,['2026-11-16']);
 view.controller.patch(()=>{heights[6]+=300;});view.flush();assert.equal(writes,1,'Changing a later week must not move the viewport');assert.deepEqual(view.controller.capture(),{date:'2026-11-23',offset:-40});view.controller.dispose();
});
