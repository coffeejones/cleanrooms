const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=fs.readFileSync(require.resolve('./planning-viewport-service.test.cjs'),'utf8').split("\ntest(")[0];
const {harness,page,row,week,range,copy,drain,Planning,Scope}=Function('require',fixture+'\nreturn {harness,page,row,week,range,copy,drain,Planning,Scope};')(require);
const bounds=range(0,7);
function batch(from,to=from,options={}){
 const response=page(from,options);response.planning.projection={mode:'calendar',...range(from,to)};
 response.records=Array.from({length:to-from+1},(_,offset)=>row(from+offset,options.version||1,options.start||'07:00')).map(item=>({...item,value:Scope.compact(item.kind,item.id,item.value)}));
 response.planning.versions=Object.fromEntries(response.records.map(item=>[Planning.key(item.kind,item.id),item.version]));response.planning.deferred=Object.keys(response.planning.versions);
 response.planning.recordWindows=Object.fromEntries(response.records.map(item=>[Planning.key(item.kind,item.id),{from:item.value.edit.date,to:item.value.edit.date,origin:item.value.edit.date,parent:null}]));return response;
}
async function answer(h,from,to=from,options={}){const request=h.reads().at(-1);assert.deepEqual(copy(request.data.projection),{mode:'calendar',...range(from,to)});await h.reply(request,batch(from,to,options));}

test('a miss fetches two bounded weeks, retains one read-ahead week privately and the next scroll reuses it without HTTP',async()=>{
 const h=harness();await h.load(batch(0));const first=h.api.viewport(range(0,1),{bounds});await drain();await answer(h,1,2);assert.equal((await first).ok,true);assert.equal(h.reads().length,2);assert.deepEqual(copy(h.api.viewportCache.keys),[week(0).from,week(1).from,week(2).from]);assert.equal(h.api.viewportCovers(range(2,2)),false);assert.deepEqual(Object.keys(h.reconciled.at(-1).edits).sort(),['shift-0','shift-1']);
 assert.equal((await h.api.viewport(range(1,2),{bounds})).ok,true);assert.equal(h.reads().length,2);assert.deepEqual(Object.keys(h.reconciled.at(-1).edits).sort(),['shift-1','shift-2']);
 const next=h.api.viewport(range(2,3),{bounds});await drain();await answer(h,3,4);assert.equal((await next).ok,true);assert.equal(h.api.viewportCache.weeks,4);assert.equal(h.api.viewportCovers(range(4,4)),false);assert.equal(h.writes().length,0);
});

test('read-ahead respects the calendar edge, reverses direction on backward scroll, and rejects invalid bounds without a request',async()=>{
 const h=harness();await h.load(batch(0));const last=h.api.viewport(range(7,7),{bounds});await drain();await answer(h,7);assert.equal((await last).ok,true);const back=h.api.viewport(range(4,4),{bounds});await drain();await answer(h,3,4);assert.equal((await back).ok,true);assert.equal(h.api.viewportCovers(range(3,3)),false);const count=h.reads().length;assert.equal((await h.api.viewport(range(8,8),{bounds})).status,400);assert.equal(h.reads().length,count);
});

test('generation changes discard old cache and restart the required range using complete consistent batches',async()=>{
 for(const update of [{revision:8},{directory:4},{absence:3},{workspaceId:'other-workspace'},{viewerId:'other-viewer'}]){
  const h=harness();await h.load(batch(0));const reading=h.api.viewport(range(0,2),{bounds});await drain();await answer(h,1,2,update);await answer(h,0,0,update);assert.equal((await reading).ok,true);assert.deepEqual(copy(h.api.projection),{mode:'calendar',...range(0,2)});assert.equal(h.contexts.at(-1).samePlanningGeneration,false);assert.equal(h.writes().length,0);
 }
});

test('a complete superseded scroll batch may warm the cache without changing active authority and overlapping scroll needs no repeat read',async()=>{
 const h=harness();await h.load(batch(0));let current=true;const reading=h.api.viewport(range(0,1),{bounds,isCurrent:()=>current,canRetain:()=>true});await drain();current=false;await answer(h,1,2);assert.equal((await reading).superseded,true);assert.equal(h.contexts.length,0);assert.deepEqual(copy(h.api.projection),week(0));assert.equal(h.api.viewportCovers(range(1,2)),false);assert.equal(h.api.viewportCache.weeks,3);const before=h.reads().length;assert.equal((await h.api.viewport(range(1,2),{bounds})).ok,true);assert.equal(h.reads().length,before);
});

test('navigation or selection cancellation stops pagination and never caches an incomplete or unwanted batch',async()=>{
 const h=harness();await h.load(batch(0));let current=true,retain=true;const reading=h.api.viewport(range(0,1),{bounds,isCurrent:()=>current,canRetain:()=>retain});await drain();current=false;retain=false;const partial=batch(1,2);partial.nextCursor='page-2';await h.reply(h.reads().at(-1),partial);assert.equal((await reading).superseded,true);assert.equal(h.reads().length,2);assert.equal(h.api.viewportCache.weeks,1);assert.equal(h.contexts.length,0);assert.equal(h.writes().length,0);
});

test('a batch failure or malformed geometry leaves prior authority/cache intact and never sends deletions',async()=>{
 for(const response of [{ok:false,status:503,message:'Offline'},(()=>{const value=batch(1,2);delete value.planning.recordWindows[Planning.key('shift','shift-2')];return value;})()]){
  const h=harness();await h.load(batch(0));const reading=h.api.viewport(range(0,1),{bounds});await drain();await h.reply(h.reads().at(-1),response);assert.equal((await reading).ok,false);assert.equal(h.api.viewportCache.weeks,1);assert.deepEqual(copy(h.api.projection),week(0));assert.equal(h.writes().length,0);
 }
});

test('an oversized optional batch falls back to individual required weeks, keeping a usable week loadable',async()=>{
 const h=harness();await h.load(batch(0));const reading=h.api.viewport(range(0,1),{bounds});await drain();await h.reply(h.reads().at(-1),{ok:false,status:413,message:'Choose fewer weeks'});await answer(h,1);assert.equal((await reading).ok,true);assert.equal(h.api.viewportCache.weeks,2);assert.equal(h.api.viewportCovers(range(2,2)),false);
});

test('reusable scroll data is cached only after its final consistent page, not after a partial batch',async()=>{
 const h=harness();await h.load(batch(0));let current=true;const reading=h.api.viewport(range(0,1),{bounds,isCurrent:()=>current,canRetain:()=>true});await drain();current=false;const partial=batch(1,2);partial.nextCursor='last-page';await h.reply(h.reads().at(-1),partial);assert.equal(h.api.viewportCache.weeks,1);assert.equal(h.contexts.length,0);assert.equal(h.reads().length,3);assert.equal(h.reads().at(-1).data.cursor,'last-page');
 const last=batch(1,2);last.records=[];last.planning.versions={};last.planning.recordWindows={};last.planning.deferred=[];delete last.studio;await h.reply(h.reads().at(-1),last);assert.equal((await reading).superseded,true);assert.equal(h.api.viewportCache.weeks,3);assert.deepEqual(copy(h.api.projection),week(0));assert.equal(h.contexts.length,0);
});

test('the private-cache hint certifies every requested week in the current generation without adopting it or making a request',async()=>{
 const h=harness();await h.load(batch(0));assert.equal(h.api.viewportCached(week(0)),true);assert.equal(h.api.viewportCached(week(1)),false);
 const reading=h.api.viewport(range(0,1),{bounds});await drain();await answer(h,1,2);assert.equal((await reading).ok,true);const count=h.reads().length;
 assert.equal(h.api.viewportCached(week(2)),true);assert.equal(h.api.viewportCovers(week(2)),false);assert.equal(h.api.viewportCached(range(0,3)),false);assert.equal(h.api.viewportCached({from:'invalid',to:'invalid'}),false);assert.equal(h.reads().length,count);
 h.api.invalidateCoverage();assert.equal(h.api.viewportCached(week(2)),false);assert.equal(h.reads().length,count);assert.equal(h.writes().length,0);
});

test('a retained batch from a newer generation cannot advertise cached coverage for the still older active authority',async()=>{
 const h=harness();await h.load(batch(0));let current=true;const reading=h.api.viewport(range(0,1),{bounds,isCurrent:()=>current,canRetain:()=>true});await drain();current=false;await answer(h,1,2,{revision:8});assert.equal((await reading).superseded,true);
 assert.equal(h.api.viewportCache.weeks,2);assert.equal(h.api.viewportCached(week(1)),false);assert.equal(h.api.viewportCovers(week(1)),false);assert.deepEqual(copy(h.api.projection),week(0));assert.equal(h.writes().length,0);
});
