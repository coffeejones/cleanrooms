const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
// Keep the actual MessageChannel/persistence fixture. Only expose zero-delay
// background yields and status callbacks; transport deadlines remain pending.
let fixture=fs.readFileSync(require.resolve('./planning-viewport-service.test.cjs'),'utf8').split('\ntest(')[0];
const replace=(before,after)=>{assert.ok(fixture.includes(before),before);fixture=fixture.replace(before,after);};
replace('function harness(){','function harness({viewport=Viewport}={}){');
replace('const requests=[],contexts=[],reconciled=[]','const statuses=[],requests=[],contexts=[],reconciled=[]');
replace('CleanRoomsPlanningViewport:Viewport,','CleanRoomsPlanningViewport:viewport,');
replace('create({onReconciled:','create({onStatus:value=>statuses.push(copy(value)),onReconciled:');
replace('return {api,requests,reads,writes,reply,load,contexts,reconciled};','return {api,requests,reads,writes,reply,load,contexts,reconciled,statuses,tick:async()=>{for(const [id,timer]of [...timers])if(timer.delay===0){timers.delete(id);timer.callback();}await drain();}};');
const {harness,page,row,week,range,copy,drain,Planning,Scope,Viewport,Window,hash}=Function('require',fixture+'\nreturn {harness,page,row,week,range,copy,drain,Planning,Scope,Viewport,Window,hash};')(require);
const bounds=range(0,7);
function batch(from,to=from,options={}){
 const value=page(from,options);value.planning.projection={mode:'calendar',...range(from,to)};value.records=Array.from({length:to-from+1},(_,index)=>row(from+index,options.version||1)).map(item=>({...item,value:Scope.compact(item.kind,item.id,item.value)}));value.planning.versions=Object.fromEntries(value.records.map(item=>[Planning.key(item.kind,item.id),item.version]));value.planning.deferred=Object.keys(value.planning.versions);value.planning.recordWindows=Object.fromEntries(value.records.map(item=>[Planning.key(item.kind,item.id),{from:item.value.edit.date,to:item.value.edit.date,origin:item.value.edit.date,parent:null}]));return value;
}
async function answer(h,from,to=from,options={}){assert.deepEqual(copy(h.reads().at(-1).data.projection),{mode:'calendar',...range(from,to)});await h.reply(h.reads().at(-1),batch(from,to,options));await h.tick();}

test('one-week bootstrap stays fast and six-week warming uses private complete two-week batches without changing authority or status',async()=>{
 const h=harness();await h.load(batch(0));assert.equal(h.reads().length,1);assert.deepEqual(copy(h.reads()[0].data.projection),week(0));assert.equal(h.api.viewportCache.maxWeeks,4);const statuses=h.statuses.length,projection=copy(h.api.projection),stamp=h.api.calendarGeneration;
 const warming=h.api.warmViewport(range(0,5),{bounds});await drain();assert.equal(h.api.viewportCache.maxWeeks,12);assert.equal(h.api.viewportCached(week(1)),false);await answer(h,1,2);assert.equal(h.api.viewportCached(week(2)),true);assert.deepEqual(copy(h.api.projection),projection);assert.equal(h.contexts.length,0);await answer(h,3,4);await answer(h,5);const result=await warming;assert.equal(result.ok,true);assert.equal(result.complete,true);assert.deepEqual(copy(result.cached),Array.from({length:6},(_,index)=>week(index).from));assert.equal(h.reads().length,4);assert.equal(h.api.viewportCache.weeks,6);assert.equal(h.api.calendarGeneration,stamp);assert.deepEqual(copy(h.api.projection),projection);assert.equal(h.api.viewportCovers(week(5)),false);assert.equal(h.statuses.length,statuses);assert.equal(h.contexts.length,0);assert.equal(h.writes().length,0);
 const count=h.reads().length;assert.equal((await h.api.viewport(range(4,5),{bounds})).ok,true);assert.equal(h.reads().length,count,'Warmed weeks become visible without another request');assert.equal(h.api.viewportCache.weeks,6);
});

test('duplicate warming shares one job and cancelled in-flight work prevents a second background RPC until it settles',async()=>{
 const h=harness();await h.load(batch(0));const first=h.api.warmViewport(range(0,5),{bounds}),same=h.api.warmViewport(range(0,5),{bounds});assert.equal(first,same);await drain();assert.equal(h.reads().length,2);h.api.cancelWarmViewport();const busy=await h.api.warmViewport(range(1,6),{bounds});assert.equal(busy.busy,true);assert.equal(busy.cancelled,true);assert.equal(busy.retryAfter,300);assert.equal(h.reads().length,2);await h.reply(h.reads()[1],batch(1,2));assert.equal((await first).superseded,true);assert.deepEqual(copy(h.api.viewportCache.keys),[week(0).from]);
 const retry=h.api.warmViewport(range(0,1),{bounds});await drain();await answer(h,1);assert.equal((await retry).complete,true);assert.equal(h.contexts.length,0);
});

test('view-only saves preserve an in-flight warm job while authoritative changes still preempt it',async()=>{
 const h=harness(),initial=batch(0);initial.records=[row(0)];initial.planning.deferred=[];const loaded=await h.load(initial),warming=h.api.warmViewport(range(0,5),{bounds});await drain();const view={...copy(loaded.studio),search:'Jonas'},saved=h.api.save(view);h.api.retry();await drain();const preference=h.requests.find(item=>item.data.operation==='preferences');assert.ok(preference);
 await answer(h,1,2);await answer(h,3,4);await answer(h,5);assert.equal((await warming).complete,true);assert.equal(h.api.viewportCache.weeks,6);await h.reply(preference,{ok:true});assert.equal(await saved,true);
 const next=h.api.warmViewport(range(1,6),{bounds});await drain();const request=h.reads().at(-1),local={...copy(loaded.studio),search:'Jonas'};local.edits['shift-0'].start='08:00';h.api.save(local);await h.reply(request,batch(6));assert.equal((await next).superseded,true);
});

test('foreground calendar navigation sends immediately while an obsolete background response is still held',async()=>{
 const h=harness();await h.load(batch(0));const warm=h.api.warmViewport(range(0,5),{bounds});await drain();const background=h.reads()[1],foreground=h.api.viewport(range(3,3),{bounds});await drain();assert.equal(h.reads().length,3,'The visible request must not wait for the background RPC');await answer(h,3,4);assert.equal((await foreground).ok,true);await h.reply(background,batch(1,2));assert.equal((await warm).superseded,true);assert.deepEqual(copy(h.api.projection),week(3));assert.equal(h.api.viewportCached(week(1)),false);assert.equal(h.contexts.length,1);assert.equal(h.writes().length,0);
});

test('opening instructions sends its point request before a held warmer reply and old progress cannot overwrite it',async()=>{
 const h=harness();await h.load(batch(0));const warm=h.api.warmViewport(range(0,5),{bounds});await drain();const background=h.reads()[1],opening=h.api.details({shiftIds:['shift-0']});await drain();const request=h.requests.find(item=>item.data.operation==='plannerDetail');assert.ok(request,'The editor must not wait for the warmer');const full=row(0);await h.reply(request,{ok:true,revision:7,directoryRevision:3,records:[full],planning:{schema:1,versions:{[Planning.key('shift','shift-0')]:1},metadataHash:hash},detailShifts:[full.value.edit],progress:{}});assert.equal((await opening).ok,true);await h.reply(background,batch(1,2));assert.equal((await warm).superseded,true);assert.deepEqual(copy(h.api.projection),week(0));assert.equal(h.api.viewportCached(week(1)),false);assert.equal(h.reads().length,2);
});

test('a pending draft preempts the warmer and no incomplete page or stale generation can enter its cache',async()=>{
 const h=harness(),initial=batch(0);initial.records=[row(0)];initial.planning.deferred=[];const loaded=await h.load(initial),warm=h.api.warmViewport(range(0,5),{bounds});await drain();const background=h.reads()[1],local=copy(loaded.studio);local.edits['shift-0'].start='08:00';const saved=h.api.save(local);h.api.retry();await drain();assert.equal(h.writes().length,1,'Writes must not queue behind background reads');const partial=batch(1,2);partial.nextCursor='do-not-fetch';await h.reply(background,partial);assert.equal((await warm).superseded,true);assert.equal(h.reads().length,2);const full=row(0,2,'08:00');await h.reply(h.writes()[0],{ok:true,revision:8,recordPatch:true,reconciledRecords:[full],planning:{schema:1,partial:true,projection:week(0),versions:{[Planning.key('shift','shift-0')]:2},metadataHash:hash}});assert.equal(await saved,true);assert.equal(h.api.viewportCached(week(1)),false);assert.equal(h.api.viewportCache.weeks,0);
});

test('complete earlier batches survive cancellation but an unfinished later page never becomes cached authority',async()=>{
 const h=harness();await h.load(batch(0));let current=true;const warm=h.api.warmViewport(range(0,5),{bounds,isCurrent:()=>current});await drain();await answer(h,1,2);const next=h.reads().at(-1);assert.deepEqual(copy(next.data.projection),{mode:'calendar',...range(3,4)});current=false;const partial=batch(3,4);partial.nextCursor='not-allowed';await h.reply(next,partial);const result=await warm;assert.equal(result.superseded,true);assert.deepEqual(copy(result.cached),[week(0).from,week(1).from,week(2).from]);assert.equal(h.reads().length,3);assert.equal(h.contexts.length,0);assert.deepEqual(copy(h.api.projection),week(0));
});

test('plan, directory, absence, metadata or identity changes never mix background rows into the current generation',async()=>{
 for(const change of [{revision:8},{directory:4},{absence:3},{metadataHash:'b'.repeat(64)},{workspaceId:'other'},{viewerId:'other'}]){
  const h=harness();await h.load(batch(0));const stamp=h.api.calendarGeneration,warm=h.api.warmViewport(range(0,5),{bounds});await drain();await h.reply(h.reads().at(-1),batch(1,2,change));const result=await warm;assert.equal(result.changed,true);assert.equal(result.requiresRefresh,true);assert.deepEqual(copy(h.api.viewportCache.keys),[week(0).from]);assert.equal(h.api.calendarGeneration,stamp);assert.equal(h.contexts.length,0);assert.equal(h.writes().length,0);
 }
});

test('warming has a six-week and visual-boundary limit, with no bootstrap or invalidation side effects',async()=>{
 const h=harness();for(const [selected,options]of [[range(0,6),{bounds}],[range(0,5),{bounds:range(0,4)}],[{from:'not-a-date',to:'2026-12-13'},{bounds}]])assert.equal((await h.api.warmViewport(selected,options)).status,400);assert.equal(h.reads().length,0);await h.load(batch(0));const warm=h.api.warmViewport(range(0,5),{bounds});await drain();h.api.invalidateCoverage();await h.reply(h.reads().at(-1),batch(1,2));assert.equal((await warm).superseded,true);assert.equal(h.api.viewportCache.weeks,0);assert.equal(h.contexts.length,0);
});

test('a small byte budget stops quietly instead of repeatedly refetching evicted optional weeks',async()=>{
 const collector=Window.collector(week(0));collector.add(batch(0));const budget=Math.floor(Buffer.byteLength(JSON.stringify(collector.finish()))*2.5),viewport={...Viewport,create:options=>Viewport.create({...options,maxBytes:budget})},h=harness({viewport});await h.load(batch(0));const before=h.statuses.length,warm=h.api.warmViewport(range(0,5),{bounds});await drain();await answer(h,1,2);const result=await warm;assert.equal(result.ok,true);assert.equal(result.tooLarge,true);assert.equal(result.complete,false);assert.equal(h.reads().length,2);assert.equal(h.api.viewportCovers(week(0)),true);assert.equal(h.api.viewportCache.keys.includes(week(0).from),true);assert.ok(h.api.viewportCache.bytes<=budget);assert.equal(h.contexts.length,0);assert.equal(h.statuses.length,before);
});

test('sliding six-week warming retains the earlier eight-week scaffold for a request-free round trip',async()=>{
 const h=harness();await h.load(batch(0));const initial=h.api.warmViewport(range(0,5),{bounds});await drain();await answer(h,1,2);await answer(h,3,4);await answer(h,5);assert.equal((await initial).complete,true);const count=h.reads().length;assert.equal((await h.api.viewport(range(4,5),{bounds})).ok,true);assert.equal(h.reads().length,count);
 const forward=h.api.warmViewport(range(2,7),{bounds});await drain();await answer(h,6,7);assert.equal((await forward).complete,true);assert.equal(h.api.viewportCache.maxWeeks,12);assert.equal(h.api.viewportCache.weeks,8);const warmed=h.reads().length;assert.equal((await h.api.viewport(week(0),{bounds})).ok,true);assert.equal(h.reads().length,warmed,'Scrolling back to the first week must not refetch it');assert.equal((await h.api.warmViewport(range(0,5),{bounds})).complete,true);assert.equal(h.reads().length,warmed,'Rewarming the old area must also be a cache hit');assert.equal(h.writes().length,0);
});

test('twelve-week retention is bounded independently of the eight-week projection and six-week warming limits',()=>{
 const cache=Viewport.create({maxWeeks:12}),complete=index=>{const collector=Window.collector(week(index));collector.add(batch(index));return collector.finish();};for(let index=0;index<12;index++)cache.put(complete(index));assert.equal(cache.inspect.weeks,12);assert.equal(cache.covers(week(0)),true);cache.put(complete(12));assert.equal(cache.inspect.weeks,12);assert.equal(cache.covers(week(0)),false);assert.equal(cache.covers(week(12)),true);assert.throws(()=>Viewport.create({maxWeeks:13}));assert.throws(()=>Viewport.normalize(range(0,8)),'Retaining twelve individual weeks does not authorize a wider active projection');
});
