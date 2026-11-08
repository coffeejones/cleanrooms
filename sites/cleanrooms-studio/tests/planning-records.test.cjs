const test=require('node:test'),assert=require('node:assert/strict');
const Planning=require('../src/planning-records.js');
const shift=(id,patch={})=>({id,person:'p1',date:'2026-11-03',site:0,start:'07:00',end:'15:00',...patch});
const series=(id,patch={})=>({id,groupId:id,person:'p1',weekdays:[1],startDate:'2026-11-01',endDate:'2027-01-01',start:'07:00',end:'15:00',...patch});
const plan=patch=>({storageVersion:1,series:[],edits:{},deleted:[],weekPlans:{},coverageRules:[],...patch});
const versions=(...rows)=>Object.fromEntries(rows.map(([kind,id,version])=>[Planning.key(kind,id),version]));

test('flatten/apply preserves recurrence order and overlapping shift edit/suppression without duplicated records',()=>{
 const original=plan({series:[series('second'),series('first')],edits:{a:shift('a'),b:shift('b')},deleted:['b','a','only-suppressed'],weekPlans:{'-1':{published:false,changes:1}}}),rows=Planning.flatten(original);
 assert.equal(rows.filter(row=>row.kind==='shift').length,3);assert.deepEqual(rows.find(row=>row.kind==='shift'&&row.id==='b').value,{edit:shift('b'),suppressed:true});
 assert.deepEqual(Planning.apply(plan(),rows),original);
 const unhidden=Planning.apply(original,[{kind:'shift',id:'b',value:{edit:shift('b',{start:'08:00'}),suppressed:false}}]);assert.equal(unhidden.edits.b.start,'08:00');assert.deepEqual(unhidden.deleted,['a','only-suppressed']);assert.equal(Planning.flatten(Planning.apply(unhidden,[{kind:'shift',id:'b',value:null}])).some(row=>row.kind==='shift'&&row.id==='b'),false);
});

test('diff is value-based and commands retain tombstone versions for recreation',()=>{
 const before=plan({series:[series('one'),series('two')],edits:{a:shift('a')}}),after=plan({series:[series('two'),series('one')],edits:{a:shift('a',{start:'08:00'}),restored:shift('restored')}}),v=versions(['shift','a',2],['shift','restored',8]);
 assert.deepEqual(Planning.commands(before,after,v),[{kind:'shift',id:'a',expectedVersion:2,value:{edit:after.edits.a,suppressed:false}},{kind:'shift',id:'restored',expectedVersion:8,value:{edit:after.edits.restored,suppressed:false}}]);
 assert.equal(Planning.commands(before,{...before,series:[before.series[1],before.series[0]]},v).length,0);
});

test('metadata and compact payload separate private preferences and server ownership from plan records',()=>{
 const base=plan({roster:[{id:'p1'}],organization:{version:1},workspaceSettings:{name:'CleanRooms'},role:'admin',page:'schedule',publications:{secret:'server'},activity:[{}],requests:{b:'pending'},leaveDecisions:{},checklistProgress:{},shiftWorkflow:{},absences:[{}],capabilities:{plan:true}}),next={...base,page:'hours',role:'employee',publications:{secret:'new'},checklistProgress:{checked:true}};
 assert.deepEqual(Planning.metadata(base),Planning.metadata(next));assert.deepEqual(Planning.metadata(base),Planning.metadata({...base,roster:[{id:'p2'}],organization:{version:2},directorySchema:1,directory:{revision:99}}),'Directory observations have their own versions rather than changing planning metadata');assert.notDeepEqual(Planning.metadata(base),Planning.metadata({...base,workspaceSettings:{name:'Changed settings'}}));
 const payload=Planning.payloadStudio(next);assert.equal(payload.page,'hours');for(const name of [...Planning.RECORD_FIELDS,...Planning.SERVER_FIELDS,'capabilities'])assert.equal(Object.hasOwn(payload,name),false);
});

test('chat grants and conversation data never enter shared planning metadata or payloads',()=>{
 const base=plan({workspaceSettings:{name:'CleanRooms'}}),untrusted={...base,chat:{messages:[{text:'Private conversation'}]},manageChat:true};
 assert.deepEqual(Planning.metadata(untrusted),Planning.metadata(base));
 assert.deepEqual(Planning.payloadStudio(untrusted),Planning.payloadStudio(base));
 assert.equal(JSON.stringify(Planning.payloadStudio(untrusted)).includes('Private conversation'),false);
 assert.deepEqual(Planning.commands(base,untrusted),[]);
});

test('merge preserves queued local record/metadata deltas and private preferences while including peer records',()=>{
 const base=plan({edits:{a:shift('a'),b:shift('b')},workspaceSettings:{name:'Before'},page:'schedule'}),local={...base,edits:{...base.edits,a:shift('a',{start:'08:00'})},workspaceSettings:{name:'Local'},page:'hours'},remote={...base,edits:{...base.edits,b:shift('b',{start:'09:00'})},workspaceSettings:{name:'Peer'},activity:[{id:'server'}]};
 const result=Planning.merge(base,local,remote);assert.equal(result.edits.a.start,'08:00');assert.equal(result.edits.b.start,'09:00');assert.equal(result.workspaceSettings.name,'Local');assert.equal(result.page,'hours');assert.deepEqual(result.activity,[{id:'server'}]);
});

test('parent-series dependencies allow disjoint occurrences and reject a concurrently changed parent',()=>{
 const base=plan({series:[series('s')]}),v=versions(['series','s',1]),changes=[{kind:'shift',id:'s@2026-11-03',expectedVersion:0,value:{edit:shift('s@2026-11-03',{seriesId:'s'}),suppressed:false}}],deps=Planning.dependencies(base,changes,v);
 assert.deepEqual(deps.series,[{id:'s',expectedVersion:1}]);assert.equal(Planning.checkDependencies({...base,edits:{'s@2026-11-04':shift('s@2026-11-04',{seriesId:'s'})}},{...v,...versions(['shift','s@2026-11-04',1])},deps,changes).ok,true);
 assert.equal(Planning.checkDependencies(base,{...v,...versions(['series','s',2])},deps,changes).ok,false);
});

test('series group signature includes every phase and active/tombstoned occurrence without blocking unrelated groups',()=>{
 const base=plan({series:[series('s'),series('phase',{groupId:'s'}),series('other')],edits:{'s@2026-11-03':shift('s@2026-11-03',{seriesId:'s'})}}),v=versions(['series','s',1],['series','phase',2],['series','other',1],['shift','s@2026-11-03',1],['shift','phase@2026-12-01',4]),next={...base,series:base.series.map(item=>item.id==='s'?{...item,start:'08:00'}:item)},changes=Planning.commands(base,next,v),deps=Planning.dependencies(base,changes,v);
 assert.ok(deps.groups[0].signature.includes('phase@2026-12-01'));assert.equal(Planning.checkDependencies({...base,edits:{...base.edits,'other@2026-11-04':shift('other@2026-11-04',{seriesId:'other'})}},{...v,...versions(['shift','other@2026-11-04',1])},deps,changes).ok,true);
 assert.equal(Planning.checkDependencies(base,{...v,...versions(['shift','phase@2026-12-01',5])},deps,changes).ok,false);
 assert.equal(Planning.checkDependencies({...base,series:[...base.series,series('newphase',{groupId:'s'})]},{...v,...versions(['series','newphase',1])},deps,changes).ok,false);
 assert.equal(Planning.checkDependencies({...base,edits:{...base.edits,'s@2026-11-05':shift('s@2026-11-05',{seriesId:'s'})}},{...v,...versions(['shift','s@2026-11-05',1])},deps,changes).ok,false);
 assert.equal(Planning.checkDependencies(base,v,{series:[],groups:[]},changes).ok,false,'Required dependency coverage cannot be omitted');
});

test('strict command validation rejects id substitution, duplicates, unsafe JSON and invalid versions',()=>{
 const good={kind:'shift',id:'x',expectedVersion:0,value:{edit:shift('x'),suppressed:true}};assert.deepEqual(Planning.validateChanges([good]),[]);
 for(const candidate of [{...good,expectedVersion:-1},{...good,value:{...good.value,edit:shift('other')}},{kind:'series',id:'s',expectedVersion:0,value:series('other')},{...good,id:'__proto__'},{...good,value:{edit:null,suppressed:false}},{...good,extra:true}])assert.ok(Planning.validateChanges([candidate]).length);
 assert.ok(Planning.validateChanges([good,good]).length);assert.ok(Planning.validateChanges([JSON.parse('{"kind":"shift","id":"x","expectedVersion":0,"value":{"edit":null,"suppressed":true,"__proto__":{}}}')]).length);
 assert.deepEqual(Planning.validatePlanning({version:1,changes:[good],metadataChanged:false,metadataBase:'a'.repeat(64),dependencies:{series:[],groups:[]}}),[]);
 assert.deepEqual(Planning.validateChanges([{kind:'week',id:'-1',expectedVersion:0,value:{published:false,changes:1}}]),[]);
});

test('week cache rebasing preserves the current baseline and tolerates independent increments without granting publication authority',()=>{
 const current={published:false,changes:2,baseline:[shift('a')],baselineKind:'initial'},proposed={published:true,changes:2,baseline:[shift('b')],baselineKind:'published'};assert.deepEqual(Planning.rebaseWeek(current,proposed),current);assert.deepEqual(Planning.rebaseWeek(current,null),current);assert.equal(Planning.rebaseWeek(current,{changes:3,published:false}).changes,3);
});
