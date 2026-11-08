const test=require('node:test'),assert=require('node:assert/strict');
const Reconcile=require('../src/planning-reconcile.js'),Data=require('../src/studio-data.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const shift=(id,patch={})=>({id,person:'p1',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:'',...patch});
const series=(id,patch={})=>({id,groupId:id,person:'p1',site:0,startDate:'2026-11-01',endDate:'2026-12-31',weekdays:[1],start:'07:00',end:'15:00',note:'',...patch});
const state=patch=>({storageVersion:1,demoSeed:false,series:[],edits:{a:shift('a'),b:shift('b')},deleted:[],weekPlans:{},coverageRules:[],roster:[],workspaceSettings:{companyName:'Before'},page:'schedule',search:'local',activity:[{id:'local-server-cache'}],...patch});

test('reconciliation updates only plan records/editable metadata and retains UI preferences and server projections',()=>{
 const current=state({page:'hours',search:'Emma',employeeShift:'a',publications:{local:true},checklistProgress:{own:true}}),incoming=state({edits:{a:shift('a',{start:'08:00'}),peer:shift('peer')},workspaceSettings:{companyName:'Peer'},page:'people',search:'',activity:[{id:'peer-cache'}],publications:{peer:true},checklistProgress:{peer:true}}),before=clone(current),result=Reconcile.reconcile(current,incoming);
 assert.equal(result.state.edits.a.start,'08:00');assert.ok(result.state.edits.peer);assert.equal(result.state.workspaceSettings.companyName,'Peer');assert.equal(result.state.page,'hours');assert.equal(result.state.search,'Emma');assert.equal(result.state.employeeShift,'a');assert.deepEqual(result.state.activity,current.activity);assert.deepEqual(result.state.publications,current.publications);assert.deepEqual(result.state.checklistProgress,current.checklistProgress);assert.equal(result.undo,null);assert.deepEqual(current,before);
});

test('undo applies only the inverse of our last record edit onto the peer-inclusive acknowledged projection',()=>{
 const previous=state(),current=state({edits:{...previous.edits,a:shift('a',{start:'08:00'})}}),incoming=state({edits:{...current.edits,b:shift('b',{start:'09:00'}),peer:shift('peer')},workspaceSettings:{companyName:'Peer'}}),result=Reconcile.reconcile(current,incoming,previous);
 assert.equal(result.undo.edits.a.start,'07:00');assert.equal(result.undo.edits.b.start,'09:00');assert.ok(result.undo.edits.peer);assert.equal(result.undo.workspaceSettings.companyName,'Peer');assert.equal(result.undo.search,'local');assert.equal(result.state.edits.a.start,'08:00');assert.equal(previous.edits.peer,undefined);
});

test('actual selected-shift peer changes stale the editor and stay sticky until reopened',()=>{
 const original=state(),captured=Reconcile.capture(original,{shifts:[original.edits.a]}),ack=clone(original);ack.edits.a.start='09:00';const updated=Reconcile.advance(captured,{submitted:original,acknowledged:ack});assert.equal(Reconcile.stale(updated),true);assert.equal(Reconcile.stale(captured),false);assert.equal(Reconcile.stale(Reconcile.advance(updated,{submitted:ack,acknowledged:original})),true);assert.equal(Reconcile.stale(Reconcile.capture(ack,{shifts:[ack.edits.a]})),false);
});

test('our own acknowledged save and unrelated peer changes do not stale an open editor',()=>{
 const original=state(),captured=Reconcile.capture(original,{shifts:[original.edits.a]}),submitted=clone(original);submitted.edits.a.start='08:00';const ack=clone(submitted);ack.edits.b.start='09:00';const updated=Reconcile.advance(captured,{submitted,acknowledged:ack});assert.equal(Reconcile.stale(updated),false);assert.equal(Reconcile.stale(updated,'all'),false);
});

test('parent series changes stale a selected occurrence even if its manual override is unchanged',()=>{
 const id='s@2026-11-03',original=state({series:[series('s')],edits:{[id]:shift(id,{seriesId:'s'})}}),captured=Reconcile.capture(original,{shifts:[original.edits[id]],seriesId:'s'}),ack=clone(original);ack.series[0].person='p2';const updated=Reconcile.advance(captured,{submitted:original,acknowledged:ack});assert.equal(Reconcile.stale(updated),true);assert.equal(Reconcile.stale(updated,'future'),true);
});

test('a new exception in the same logical group stales all/future scope while the selected occurrence remains safe',()=>{
 const original=state({series:[series('s'),series('phase',{groupId:'s',startDate:'2027-01-01',endDate:'2027-02-01'})]}),selected=Data.shiftById('s@2026-11-03',original),captured=Reconcile.capture(original,{shifts:[selected],seriesId:'s'}),ack=clone(original);ack.edits['s@2026-11-10']=shift('s@2026-11-10',{seriesId:'s',date:'2026-11-10',start:'09:00'});const updated=Reconcile.advance(captured,{submitted:original,acknowledged:ack});assert.equal(Reconcile.stale(updated,'one'),false);assert.equal(Reconcile.stale(updated,'future'),true);assert.equal(Reconcile.stale(updated,'all'),true);
});

test('group captures notice newly added phases and suppressions without reacting to other groups',()=>{
 const original=state({series:[series('s'),series('other')]}),captured=Reconcile.capture(original,{groupId:'s'}),unrelated=clone(original);unrelated.edits['other@2026-11-10']=shift('other@2026-11-10',{seriesId:'other'});assert.equal(Reconcile.stale(Reconcile.advance(captured,{submitted:original,acknowledged:unrelated}),'all'),false);
 const suppressed=clone(original);suppressed.deleted=['s@2026-11-03'];assert.equal(Reconcile.stale(Reconcile.advance(captured,{submitted:original,acknowledged:suppressed}),'all'),true);
 const phase=clone(original);phase.series.push(series('new-phase',{groupId:'s'}));assert.equal(Reconcile.stale(Reconcile.advance(captured,{submitted:original,acknowledged:phase}),'all'),true);
});

test('bulk selection is stale when any selected shift changes, not when another employee changes',()=>{
 const original=state(),captured=Reconcile.capture(original,{shifts:[original.edits.a,original.edits.b]}),unrelated=clone(original);unrelated.edits.peer=shift('peer',{person:'p2'});assert.equal(Reconcile.stale(Reconcile.advance(captured,{submitted:original,acknowledged:unrelated})),false);const ack=clone(unrelated);delete ack.edits.b;assert.equal(Reconcile.stale(Reconcile.advance(captured,{submitted:original,acknowledged:ack})),true);
});

test('independent creation/template copies without captured identities remain usable across a peer rebase',()=>{
 const original=state(),captured=Reconcile.capture(original),ack=state({series:[series('peer')],edits:{a:shift('a',{start:'09:00'})}});const updated=Reconcile.advance(captured,{submitted:original,acknowledged:ack});assert.equal(Reconcile.stale(updated),false);assert.equal(Reconcile.stale(updated,'all'),false);
});

test('a captured metadata-only undo survives our acknowledgement without reverting uncaptured peer settings',()=>{
 const current=state({coverageRules:[{id:'ours'}],demoSeed:false}),partialUndo={series:[],edits:clone(current.edits),deleted:[],weekPlans:{},coverageRules:[],demoSeed:true},incoming=state({...current,workspaceSettings:{companyName:'Peer settings'},roster:[{id:'peer-person'}]});
 const result=Reconcile.reconcile(current,incoming,partialUndo);assert.deepEqual(result.undo.coverageRules,[]);assert.equal(result.undo.demoSeed,true);assert.deepEqual(result.undo.workspaceSettings,incoming.workspaceSettings);assert.deepEqual(result.undo.roster,current.roster,'Plan acknowledgements do not replace the independently versioned directory cache');assert.deepEqual(result.state.roster,current.roster);assert.deepEqual(result.state.coverageRules,current.coverageRules);
});

test('a peer change to the same metadata field is preserved instead of applying an old inverse',()=>{
 const current=state({coverageRules:[{id:'ours'}]}),partialUndo={series:[],edits:clone(current.edits),deleted:[],weekPlans:{},coverageRules:[]},incoming=state({...current,coverageRules:[{id:'ours'},{id:'peer'}]});
 assert.deepEqual(Reconcile.reconcile(current,incoming,partialUndo).undo.coverageRules,incoming.coverageRules);
});

test('a later peer change to our undo target invalidates the entire inverse transaction',()=>{
 const previous=state(),current=state({edits:{...previous.edits,a:shift('a',{start:'08:00'})}}),incoming=state({edits:{...current.edits,a:shift('a',{start:'09:00'})}}),result=Reconcile.reconcile(current,incoming,previous);assert.equal(result.undo,null);assert.equal(result.state.edits.a.start,'09:00');
 const bulk=state({edits:{a:shift('a',{start:'08:00'}),b:shift('b',{start:'08:00'})}}),peer=state({edits:{...bulk.edits,b:shift('b',{start:'10:00'})}});assert.equal(Reconcile.reconcile(bulk,peer,previous).undo,null,'One changed target invalidates the whole bulk undo, not just that member.');
});

test('queued local values do not hide a peer change to an undo target in the actual acknowledgement',()=>{
 const previous=state(),submitted=state({edits:{...previous.edits,a:shift('a',{start:'08:00'})}}),queued=state({edits:{...submitted.edits,a:shift('a',{start:'09:00'})}}),ack=state({edits:{...submitted.edits,a:shift('a',{start:'10:00'})}}),merged=state({...queued,edits:{...queued.edits,b:shift('b',{start:'11:00'})}});
 assert.equal(Reconcile.reconcile(queued,merged,submitted,{submitted,acknowledged:ack}).undo,null);assert.ok(Reconcile.reconcile(queued,queued,submitted,{submitted,acknowledged:submitted}).undo,'Our own acknowledgement may safely undo a newer queued edit.');
});

test('first group expansion can learn historical off-window exceptions after an unrelated revision without false staleness',()=>{
 const original=state({series:[series('s')]}),selected=Data.shiftById('s@2026-11-03',original),captured=Reconcile.capture(original,{shifts:[selected],seriesId:'s'}),ack=clone(original);ack.edits.b.start='09:00';ack.edits['s@2026-12-22']=shift('s@2026-12-22',{seriesId:'s',date:'2026-12-22',start:'10:00'});
 const context={submitted:original,acknowledged:ack,previousProjection:{mode:'calendar',from:'2026-11-02',to:'2026-11-08'}},upgraded=Reconcile.upgradeCapture(captured,context);
 assert.equal(Reconcile.stale(upgraded),false);assert.equal(Reconcile.stale(upgraded,'all'),false);assert.equal(upgraded.baselineSeries.shifts.some(([id])=>id==='s@2026-12-22'),true);
 const later=clone(ack);later.edits['s@2026-12-22'].start='11:00';assert.equal(Reconcile.stale(Reconcile.advance(upgraded,{submitted:ack,acknowledged:later}),'all'),true,'After learning the complete group, all subsequent exception changes must be guarded.');
});

test('first group expansion preserves real peer changes to observed exceptions, parent series and newly created in-window exceptions',()=>{
 const id='s@2026-11-05',original=state({series:[series('s')],edits:{[id]:shift(id,{seriesId:'s',date:'2026-11-05'})}}),selected=Data.shiftById('s@2026-11-03',original),captured=Reconcile.capture(original,{shifts:[selected],seriesId:'s'}),previousProjection={mode:'calendar',from:'2026-11-02',to:'2026-11-08'};
 for(const mutate of [ack=>{ack.edits[id].start='10:00';},ack=>{delete ack.edits[id];},ack=>{ack.series[0].start='08:00';},ack=>{ack.deleted.push('s@2026-11-03');},ack=>{ack.edits['s@2026-11-04']=shift('s@2026-11-04',{seriesId:'s',date:'2026-11-04'});}]){
  const ack=clone(original);mutate(ack);assert.equal(Reconcile.stale(Reconcile.upgradeCapture(captured,{submitted:original,acknowledged:ack,previousProjection}),'all'),true);
 }
 const changed=clone(original);changed.edits[id].start='09:00';const sticky=Reconcile.advance(captured,{submitted:original,acknowledged:changed});assert.equal(Reconcile.stale(Reconcile.upgradeCapture(sticky,{submitted:changed,acknowledged:original,previousProjection}),'all'),true,'An already stale group never becomes writable just because scope coverage grows.');
});
