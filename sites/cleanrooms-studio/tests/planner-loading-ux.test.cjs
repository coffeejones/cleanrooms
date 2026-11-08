const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let index=0;index<24;index++)await Promise.resolve();};

// Run the production editor, cloud-status, input cancellation and warm scheduler.
// Only unrelated page painting and the controllable network boundary are replaced.
const fixtureFile=fs.readFileSync(path.join(__dirname,'series-editor-integration.test.cjs'),'utf8');
let fixture=fixtureFile.slice(0,fixtureFile.indexOf('\ntest('));
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const inputBindings=source.split('\n').filter(line=>line.startsWith('  root.addEventListener(')&&line.includes('cancelPlannerDetails()')).join('\n');
assert.ok(inputBindings.includes("'pointerdown'"));
const replace=(before,after)=>{assert.ok(fixture.includes(before),before);fixture=fixture.replace(before,after);};
replace('function application() {',`function application() {
  const timers=new Map();let timerId=0;
  const setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;};
  const clearTimeout=id=>timers.delete(id);`);
replace('addEventListener(type,handler){(this.events??=new Map()).set(type,handler);}', 'addEventListener(type,handler){this.events??=new Map();if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(handler);}');
replace('const root={querySelector:control,querySelectorAll:()=>[],dataset:{}};', `const root=new Element();root.querySelector=control;root.querySelectorAll=selector=>['.cs-event[data-shift]','[data-shift]'].includes(selector)?root.fixtureCards||[]:[];`);
replace('const context=vm.createContext({','const context=vm.createContext({setTimeout,clearTimeout,');
replace('state,openEditor,openSeriesEditor,', `state,openEditor,openSeriesEditor,
      renderStatus:renderCloudStatus,setLoaded:value=>{cloudLoaded=value;},detailState:()=>({busy:plannerDetailBusy,epoch:plannerDetailEpoch}),
      setCards:value=>{root.fixtureCards=value;},input:(type,values={})=>{const event={type,preventDefault(){this.defaultPrevented=true;},...values};for(const callback of root.events?.get(type)||[])callback(event);return event;},
      warm:schedulePlannerWarm,cancelWarm:cancelPlannerWarm,setWanted:range=>{plannerViewport.key=viewportKey();plannerViewport.wanted=range;},setViewportBusy:value=>{plannerViewport.busy=value;},`);
replace('  `;\n  vm.runInContext(', '  `;\n  const inputBindings='+JSON.stringify(inputBindings)+';\n  vm.runInContext(');
replace("+instrumentation+'\\n})();',context", "+instrumentation+inputBindings+'\\n})();',context");
replace('return {...context.seriesEditorTest,control,editor,', `return {...context.seriesEditorTest,control,editor,timers,
    async nextTimer(){const entry=timers.entries().next().value;assert.ok(entry,'An idle warm timer must exist');timers.delete(entry[0]);const result=entry[1].callback();await Promise.resolve();return {delay:entry[1].delay,result};},`);
const makeApplication=Function('require','__dirname',fixture+'\nreturn application;')(require,__dirname);
const first='2026-11-02',last='2026-12-27';
const shift=(id,date='2026-11-03')=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'Instructions '+id});
function setup({needs=false}={}){
 const app=makeApplication(),reads=[],scopes=[],warms=[];let needsDetail=needs,generation='generation-1',cancelledWarms=0;
 Object.assign(app.state,{demoSeed:false,page:'schedule',role:'admin',view:'week',week:1,search:'',site:'all',onlyOpen:false,series:[],edits:{one:shift('one'),two:shift('two','2026-11-04')},deleted:[],weekPlans:{},requests:{}});
 const api={isPartial:true,coverageValid:true,get calendarGeneration(){return generation;},viewport:async()=>({ok:true}),viewportCovers:()=>true,covers:()=>true,coversScope:()=>true,
  needsDetails:()=>needsDetail,details:(selection,options)=>new Promise(resolve=>reads.push({selection:plain(selection),options,resolve})),
  scope:projection=>new Promise(resolve=>scopes.push({projection:plain(projection),resolve})),window:async()=>({ok:true}),ensureFull:async()=>assert.fail('This flow must not fetch the entire plan'),action:async()=>({ok:true}),
  warmViewport:(range,options)=>new Promise(resolve=>warms.push({range:plain(range),options,resolve})),cancelWarmViewport:()=>{cancelledWarms++;},invalidateCoverage:()=>{api.coverageValid=false;}};
 app.installWindow(api);
 const card=app.control('#fixture-one'),other=app.control('#fixture-two');card.dataset.shift='one';other.dataset.shift='two';app.setCards([card,other]);
 const reply=async(index,response={ok:true})=>{needsDetail=false;reads[index].resolve(response);await settle();};
 return {app,api,reads,scopes,warms,card,other,reply,needs:value=>{needsDetail=value;},generation:()=>{generation+='-next';},cancelledWarms:()=>cancelledWarms};
}

test('an ordinary editor opening reuses an already satisfied detail read without forcing another request',()=>{
 const {app,reads}=setup();app.begin(app.state.edits.one);assert.equal(reads.length,0);assert.equal(app.active().id,'one');assert.equal(app.control('#cs-edit-note').value,'Instructions one');assert.equal(app.persisted(),0);
});

test('a pending detail marks only its card and keeps the existing page visible and interactive',async()=>{
 const {app,reads,card,other,reply}=setup({needs:true});const opening=app.begin(app.state.edits.one);
 assert.equal(reads.length,1);assert.equal(reads[0].options.force,false);assert.equal(app.detailState().busy,true);assert.equal(app.control('#cs-storage-loading').hidden,true);assert.equal(app.control('.cs-main').inert,false);assert.equal(card.getAttribute('aria-busy'),'true');assert.equal(other.getAttribute('aria-busy'),null);
 await reply(0);await opening;assert.equal(app.active().id,'one');assert.equal(app.detailState().busy,false);assert.equal(card.getAttribute('aria-busy'),null);assert.equal(app.control('#cs-storage-loading').hidden,true);assert.equal(app.persisted(),0);
});

test('initial bootstrap retains its loading screen while later scoped reads use local status and preserve their edit guard',async()=>{
 const {app,scopes}=setup();app.setLoaded(false);app.renderStatus();assert.equal(app.control('#cs-storage-loading').hidden,false);
 app.setLoaded(true);const reading=app.planningRead({mode:'calendar',from:first,to:'2026-11-08'});assert.equal(scopes.length,1);assert.equal(app.control('#cs-storage-loading').hidden,true);assert.equal(app.control('.cs-main').inert,true);assert.equal(app.control('.cs-page-head').getAttribute('data-reading'),'true');
 scopes[0].resolve({ok:true});await reading;assert.equal(app.control('.cs-main').inert,false);assert.equal(app.control('.cs-page-head').getAttribute('data-reading'),'false');assert.equal(app.control('#cs-storage-loading').hidden,true);
});

test('new pointer or keyboard intent cancels a delayed editor opening before it can replace a newly typed shift',async()=>{
 for(const [type,values]of [['pointerdown',{}],['keydown',{key:'Enter'}],['keydown',{key:' '}],['keydown',{key:'Escape'}]]){
  const {app,reply}=setup({needs:true}),opening=app.begin(app.state.edits.one);assert.equal(app.detailState().busy,true);app.input(type,values);assert.equal(app.detailState().busy,false,type+' '+(values.key||''));
  app.begin({...shift(undefined),date:'2026-11-05'});app.control('#cs-edit-start').value='09:30';app.editor.setContent({note:'New unsaved instructions'});await reply(0);assert.equal(await opening,false);assert.equal(app.active().id,undefined);assert.equal(app.control('#cs-edit-start').value,'09:30');assert.equal(app.currentDescription().note,'New unsaved instructions');assert.equal(app.persisted(),0);
 }
});

test('a later occurrence selection wins even when its earlier detail response arrives last',async()=>{
 const {app,reads,reply}=setup({needs:true}),firstOpen=app.begin(app.state.edits.one);app.input('pointerdown');const secondOpen=app.begin(app.state.edits.two);assert.equal(reads.length,2);await reply(1);await secondOpen;assert.equal(app.active().id,'two');app.control('#cs-edit-start').value='10:15';await reply(0);assert.equal(await firstOpen,false);assert.equal(app.active().id,'two');assert.equal(app.control('#cs-edit-start').value,'10:15');
});

test('idle warm-up targets six weeks inside the existing visual bounds and deduplicates repeated paints',async()=>{
 const {app,warms}=setup();app.warm();app.warm();assert.equal(app.timers.size,1);const timer=await app.nextTimer();assert.equal(timer.delay,160);assert.equal(warms.length,1);assert.deepEqual(warms[0].range,{from:first,to:'2026-12-13'});assert.deepEqual(plain(warms[0].options.bounds),{from:first,to:last});assert.equal(warms[0].options.isCurrent(),true);warms[0].resolve({ok:true,complete:true});await timer.result;app.warm();assert.equal(app.timers.size,0);assert.equal(warms.length,1);
 app.setWanted({from:'2026-12-14',to:last});app.warm();await app.nextTimer();assert.equal(warms.length,2);assert.deepEqual(warms[1].range,{from:'2026-11-16',to:last});
});

test('warm-up yields to a foreground editor or visible-period load and retries cancelled work without a tight loop',async()=>{
 const {app,warms}=setup();app.warm();const timer=await app.nextTimer();app.begin(app.state.edits.one);assert.equal(warms[0].options.isCurrent(),false);app.warm();assert.equal(app.timers.size,0);warms[0].resolve({ok:false,cancelled:true});await timer.result;assert.equal(app.timers.size,0,'An open editor keeps optional warming paused');
 app.closeEditor();app.warm();const retry=await app.nextTimer();assert.equal(warms.length,2);warms[1].resolve({ok:false,busy:true,cancelled:true,retryAfter:300});await retry.result;assert.equal(app.timers.size,1);assert.equal([...app.timers.values()][0].delay,300);app.setViewportBusy(true);app.warm();assert.equal(app.timers.size,1);await app.nextTimer();assert.equal(warms.length,2,'A new foreground period load suppresses the queued background retry');
});

test('optional warm failures and limits do not repeatedly fetch or replace the current editor or planning state',async()=>{
 for(const result of [{ok:false,status:503,message:'Offline'},{ok:true,complete:false,tooLarge:true}]){
  const {app,warms}=setup(),before=plain(app.state);app.warm();const timer=await app.nextTimer();warms[0].resolve(result);await timer.result;for(let index=0;index<5;index++)app.warm();assert.equal(app.timers.size,0);assert.equal(warms.length,1);assert.deepEqual(plain(app.state),before);assert.equal(app.persisted(),0);
 }
});

test('a warm generation change invalidates only its still-current planner context and cannot replace newer input',async()=>{
 const live=setup(),before=plain(live.app.state);live.app.warm();const timer=await live.app.nextTimer();live.warms[0].resolve({ok:false,requiresRefresh:true});await timer.result;
 assert.equal(live.api.coverageValid,false);assert.deepEqual(plain(live.app.state),before);for(let index=0;index<5;index++)live.app.warm();assert.equal(live.app.timers.size,0,'The foreground refresh owns recovery; warming must not retry a stale generation in a loop');assert.equal(live.warms.length,1);assert.equal(live.app.persisted(),0);
 for(const change of [app=>{app.state.page='hours';},app=>{app.begin(app.state.edits.one);app.control('#cs-edit-start').value='09:45';app.editor.setContent({note:'Keep this draft'});}]){
  const h=setup();h.app.warm();const pending=await h.app.nextTimer();change(h.app);assert.equal(h.warms[0].options.isCurrent(),false);const latest=plain(h.app.state);h.warms[0].resolve({ok:false,requiresRefresh:true});await pending.result;
  assert.equal(h.api.coverageValid,true,'An obsolete warm job cannot invalidate a different page or an open editor');assert.deepEqual(plain(h.app.state),latest);assert.equal(h.app.timers.size,0);assert.equal(h.app.persisted(),0);if(h.app.active()){assert.equal(h.app.active().id,'one');assert.equal(h.app.control('#cs-edit-start').value,'09:45');assert.equal(h.app.currentDescription().note,'Keep this draft');}
 }
});
