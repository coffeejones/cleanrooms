const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../src/series-engine.js'),Planner=require('../src/series-planner.js'),Lifecycle=require('../src/series-lifecycle.js'),Data=require('../src/studio-data.js'),Scope=require('../src/planning-scope.js');
const open=patch=>({id:'open-series',person:'p0',site:0,startDate:'2026-01-01',endDate:Engine.OPEN_END,openEnded:true,weekdays:[0,2,4],start:'07:00',end:'15:00',note:'Rengøring',...patch});

test('open recurrence templates have an explicit end mode and require bounded expansion',()=>{
 const series=open();assert.deepEqual(Engine.validate(series),[]);assert.equal(Engine.isOpenEnded(series),true);assert.equal(Engine.requiresRange(series),true);
 for(const options of [undefined,{from:'2031-01-01'},{to:'2031-01-31'},{from:'2031-01-01',to:'2032-01-02'}])assert.throws(()=>Engine.enumerate(series,options),RangeError);
 for(const patch of [{openEnded:'true'},{openEnded:1},{openEnded:true,endDate:'2030-01-01'}])assert.ok(Engine.validate(open(patch)).length);
 const result=Engine.enumerate(series,{from:'2031-01-01',to:'2031-01-31'});assert.ok(result.length>10);assert.ok(result.every(item=>item.date.startsWith('2031-01')&&item.id==='open-series@'+item.date));
 const compact=Scope.compact('series',series.id,series);assert.equal(compact.openEnded,true);assert.equal(compact.endDate,Engine.OPEN_END);
});

test('closed historical phases longer than a year retain their real boundary but still require bounded expansion',()=>{
 const series=open({openEnded:false,endDate:'2033-12-31'});assert.deepEqual(Engine.validate(series),[]);assert.equal(Engine.isOpenEnded(series),false);assert.equal(Engine.requiresRange(series),true);assert.throws(()=>Engine.enumerate(series),RangeError);
 assert.ok(Engine.enumerate(series,{from:'2033-12-01',to:'2033-12-31'}).length);assert.deepEqual(Engine.enumerate(series,{from:'2034-01-01',to:'2034-01-31'}),[]);
 const next=open({id:'new-phase',groupId:'agreement',startDate:'2034-01-01'});assert.deepEqual(Lifecycle.validate([{...series,groupId:'agreement'},next]),[]);
});

test('calendar point reads and six-month previews work years after the original start without all-plan expansion',()=>{
 const series=open(),state={demoSeed:false,series:[series],edits:{},deleted:[]};
 const shift=Data.shiftById('open-series@2031-01-01',state);assert.equal(shift.date,'2031-01-01');assert.equal(Data.shiftById('open-series@2031-01-02',state),null);
 assert.deepEqual(Data.shiftsInRange('2031-01-01','2031-01-01',state),[shift]);
 assert.deepEqual(Engine.operationRange({...series,person:'',start:'',end:''},{today:'2031-01-01'}),{from:'2031-01-01',to:'2031-07-01'});
 const preview=Planner.preview({draft:series,today:'2031-01-01'});assert.equal(preview.valid,true,preview.errors.join(' '));assert.equal(preview.limited,true);assert.equal(preview.openEnded,true);assert.deepEqual(preview.range,{from:'2031-01-01',to:'2031-07-01'});assert.ok(preview.total>70&&preview.total<100);assert.ok(preview.shifts.every(item=>item.date>=preview.range.from&&item.date<=preview.range.to));
 const picked=Planner.chooseFutureAnchor(series,{today:'2031-01-01'});assert.equal(picked.anchor,'2031-01-01');
 const future=Planner.preview({source:series,draft:{...series,id:'future-phase',startDate:'2031-01-01'},scope:'future',cutoff:'2031-01-01',today:'2031-01-01'});assert.equal(future.valid,true);assert.equal(future.changedCount,0);
});

test('manual exceptions beyond the preview horizon are remapped or detached by anchor membership without enumeration',()=>{
 const source=open(),day='2040-01-02',manual=Engine.enumerate(source,{from:day,to:day})[0];assert.ok(manual);manual.note='Personlig instruktion';
 const edits={[manual.id]:manual},replacement={...source,id:'replacement'};const preserved=Engine.preserveExceptions({source,replacement,scope:'future',cutoff:'2031-01-01',edits});
 assert.equal(preserved.edits['replacement@'+day].note,manual.note);assert.equal(preserved.edits['replacement@'+day].seriesId,'replacement');assert.equal(preserved.edits[manual.id],undefined);
 const detached=Engine.preserveExceptions({source,replacement:{...replacement,weekdays:[1]},scope:'future',cutoff:'2031-01-01',edits});assert.deepEqual(detached.detachedIds,[manual.id]);assert.equal(detached.edits[manual.id].seriesId,undefined);
 assert.equal(edits[manual.id].seriesId,source.id);
});

test('open agreements show no false expiry or finite lifetime counts and cannot be extended',()=>{
 const source=open(),[summary]=Lifecycle.summarizeSeries([source],{today:'2031-01-01'});assert.equal(summary.openEnded,true);assert.equal(summary.status,'active');assert.equal(summary.total,null);assert.equal(summary.upcomingCount,null);assert.equal(summary.daysToEnd,null);assert.equal(summary.expiring,false);assert.equal(summary.next.date,'2031-01-01');
 const [group]=Lifecycle.groupSeries([source],{today:'2031-01-01'});assert.equal(group.total,null);assert.equal(group.upcomingCount,null);assert.ok(group.shifts.length<100);assert.equal(group.daysToEnd,null);assert.equal(group.expiring,false);
 assert.equal(Lifecycle.extensionDraft(source,{id:'new-phase',months:6}).ok,false);
 const copy=Lifecycle.copyDraft(source,{id:'copy',startDate:'2032-01-01',endDate:Engine.OPEN_END});assert.equal(copy.ok,true);assert.equal(copy.draft.openEnded,true);
 const finite=Lifecycle.copyDraft(source,{id:'finite-copy',startDate:'2032-01-01',endDate:'2032-07-01',openEnded:false});assert.equal(finite.ok,true);assert.equal(Engine.isOpenEnded(finite.draft),false);
});

test('bounded occurrence reads include moves into the requested window from a distant recurrence anchor',()=>{
 const series=open(),base=Engine.enumerate(series,{from:'2026-01-02',to:'2026-01-02'})[0],moved={...base,date:'2031-01-02'},edits={[base.id]:moved};
 const shifts=Planner.occurrences(series,{edits,from:'2031-01-01',to:'2031-01-03'});assert.ok(shifts.some(item=>item.id===base.id&&item.date===moved.date));
 const anchor=Planner.chooseFutureAnchor(series,{today:'2031-01-01',deleted:['open-series@2031-01-01']});assert.equal(anchor.anchor,'2031-01-03');
});
