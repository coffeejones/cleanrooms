const test=require('node:test'),assert=require('node:assert/strict');
const Planning=require('../src/planning-records.js'),Scope=require('../src/planning-scope.js'),Reconcile=require('../src/planning-reconcile.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(kind){
 const id=kind==='series'?'series-main':'shift-main',key=Planning.key(kind,id),value={id,person:'person-main',site:0,start:'08:00',end:'16:00',note:'Lock the building.',noteRich:'<p>Lock the building.</p>',customMetadata:{preserve:true},...(kind==='series'?{groupId:id,startDate:'2026-11-02',endDate:'2027-01-31',weekdays:[1]}:{date:'2026-11-03'})};
 const base={storageVersion:1,demoSeed:false,series:[],edits:{},deleted:[],weekPlans:{},coverageRules:[]},row={kind,id,value:kind==='shift'?{edit:value,suppressed:false}:value},current=Planning.apply(base,[row]),undo=copy(current);
 (kind==='series'?undo.series[0]:undo.edits[id]).start='07:00';
 const incoming=Planning.apply(base,[{...row,value:Scope.compact(kind,id,row.value)}]),context={viewport:true,scopeReplacement:true,samePlanningGeneration:true,previous:copy(current),submitted:copy(current),acknowledged:copy(incoming),previousPlanningVersions:{[key]:4},planningVersions:{[key]:4}};
 return {kind,id,key,current,undo,incoming,context};
}
test('same-version compact viewport rows retain acknowledged bodies and their own undo without mutating inputs',()=>{
 for(const kind of ['series','shift']){
  const f=fixture(kind),before=copy(f),result=Reconcile.reconcile(f.current,f.incoming,f.undo,f.context),body=kind==='series'?result.state.series[0]:result.state.edits[f.id],old=kind==='series'?result.undo.series[0]:result.undo.edits[f.id];
  assert.equal(body.note,'Lock the building.');assert.deepEqual(body.customMetadata,{preserve:true});assert.equal(body.start,'08:00');assert.equal(old.start,'07:00');assert.deepEqual(f,before);
 }
});
test('compact promotion fails closed on generation, record, instruction, schedule or local-authority differences',()=>{
 const changes=[
  ['directory generation',f=>{f.context.samePlanningGeneration=false;}],
  ['absence generation',f=>{f.context.samePlanningGeneration=false;}],
  ['tenant generation',f=>{f.context.samePlanningGeneration=false;}],
  ['peer record version',f=>{f.context.planningVersions[f.key]=5;}],
  ['missing version',f=>{delete f.context.previousPlanningVersions[f.key];}],
  ['zero version',f=>{f.context.previousPlanningVersions[f.key]=f.context.planningVersions[f.key]=0;}],
  ['changed instruction',f=>{const changed=copy(f.current.series[0]);changed.note='Peer instructions';f.incoming.series[0]=Scope.compact('series',f.id,changed);}],
  ['changed schedule',f=>{f.incoming.series[0].start='10:00';}],
  ['unacknowledged local body',f=>{f.current.series[0].note='Queued local instructions';}],
  ['ordinary scope switch',f=>{f.context.viewport=false;}],
 ];
 for(const [name,mutate]of changes){const f=fixture('series');mutate(f);const result=Reconcile.reconcile(f.current,f.incoming,f.undo,f.context);assert.equal(result.undo,null,name);assert.ok(result.state.series[0]._instructions,name);assert.equal(result.state.series[0].note,undefined,name);}
});
test('evicting an undo target never retains its record or a partial bulk inverse',()=>{
 const f=fixture('series'),other={id:'shift-other',person:'person-main',site:0,date:'2026-11-03',start:'08:00',end:'16:00',note:''};f.current.edits[other.id]=copy(other);f.undo.edits[other.id]={...other,start:'07:00'};f.incoming.series=[];f.incoming.edits[other.id]=copy(other);
 const result=Reconcile.reconcile(f.current,f.incoming,f.undo,f.context);assert.equal(result.undo,null);assert.deepEqual(result.state.series,[]);assert.equal(result.state.edits[other.id].start,'08:00');
});
