const test=require('node:test'),assert=require('node:assert/strict');
const Window=require('../src/planning-window.js'),Planning=require('../src/planning-records.js');
const projection={mode:'calendar',from:'2026-11-02',to:'2026-12-27'},metadata={storageVersion:1,series:[],edits:{},deleted:[],weekPlans:{},roster:[{id:'p1',name:'Emma'}],coverageRules:[],workspaceSettings:{companyName:'CleanRooms'},page:'schedule'};
const shift=(id,patch={})=>({id,person:'p1',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:'',...patch});
const row=(id,patch={})=>({kind:'shift',id,value:{edit:shift(id),suppressed:false},sortOrder:0,version:1,...patch});
const page=(rows,patch={})=>({ok:true,revision:7,planning:{schema:1,partial:true,projection,metadataHash:'a'.repeat(64),versions:Object.fromEntries(rows.map(row=>[Planning.key(row.kind,row.id),row.version]))},records:rows,publicationRows:patch.studio?[{kind:'state',id:'state',value:{present:false,value:{version:1,sequence:0,scopeLinks:[]}}}]:[],auxRows:[],nextCursor:null,...patch});

test('the collector activates only complete same-revision pages and assembles scoped publication, absence and progress data',()=>{
 const collector=Window.collector(projection),one=page([row('a')],{studio:metadata,nextCursor:'second',workflowSummary:{pendingCount:2},workspace:{id:'workspace'},publicationRows:[{kind:'state',id:'state',value:{present:true,value:{version:1,sequence:5,scopeLinks:[]}}},{kind:'scope',id:'2026-11-02|0',value:{value:{from:'2026-11-02',to:'2026-11-08',site:0,location:{name:'Nord'}},shiftOrder:[],shiftsDigest:''}}],progress:{task:{version:1}}});
 assert.equal(collector.add(one),'second');assert.throws(()=>collector.finish(),/færdigindlæst/);assert.equal(collector.complete,false);
 const absent={id:'absence-1',p:'p1',type:'Ferie',days:['2026-11-04'],status:'approved',version:1};collector.add(page([row('b')],{publicationRows:[{kind:'shift',id:'b',value:{scopeKey:'2026-11-02|0',shift:shift('b')}},{kind:'shift',id:'a',value:{scopeKey:'2026-11-02|0',shift:shift('a')}}],auxRows:[{kind:'absence',id:absent.id,value:absent}]}));
 const result=collector.finish();assert.deepEqual(Object.keys(result.studio.edits).sort(),['a','b']);assert.deepEqual(result.studio.publications.slots['2026-11-02|0'].shifts.map(shift=>shift.id),['a','b']);assert.deepEqual(result.studio.absences,[absent]);assert.deepEqual(result.studio.requests,{'absence-1':'approved'});assert.deepEqual(result.studio.checklistProgress,{task:{version:1}});assert.deepEqual(result.workflowSummary,{pendingCount:2});assert.equal(result.records,undefined);assert.equal(Object.keys(result.planning.versions).length,2);assert.equal(result.planning.partial,true);
});

test('empty windows explicitly contain no absence fixtures and a tombstone does not invent an active event',()=>{
 const collector=Window.collector(projection);collector.add(page([row('deleted',{value:null,version:3})],{studio:metadata}));const result=collector.finish();assert.deepEqual(result.studio.absences,[]);assert.deepEqual(result.studio.requests,{});assert.deepEqual(result.studio.edits,{});assert.equal(result.planning.versions[Planning.key('shift','deleted')],3);assert.equal(result.studio.publications,undefined);
});

test('calendar bounds reject invalid dates, oversized intervals and unspecified selectors',()=>{
 assert.deepEqual(Window.normalize(projection),projection);for(const value of [{...projection,to:'2026-12-28'},{...projection,from:'2026-02-30'},{...projection,to:'2026-01-01'},{...projection,mode:'full'},{...projection,siteId:1}])assert.throws(()=>Window.normalize(value));assert.equal(Window.covers(projection,'2026-11-03','2026-11-09'),true);assert.equal(Window.covers(projection,'2026-12-28'),false);
});

test('changed revisions, hashes, duplicate records, repeated cursors and missing publication scopes fail closed',()=>{
 for(const mutate of [page=>{page.revision++;},page=>{page.planning.metadataHash='b'.repeat(64);},page=>{page.records[0].value.edit.start='09:00';},page=>{page.planning.projection={...projection,to:'2026-12-20'};},page=>{page.nextCursor='next';}]){
  const collector=Window.collector(projection);collector.add(page([row('a')],{studio:metadata,nextCursor:'next'}));const next=page([row('a')]);mutate(next);assert.throws(()=>collector.add(next));assert.throws(()=>collector.finish());
 }
 const collector=Window.collector(projection);collector.add(page([],{studio:metadata,publicationRows:[{kind:'shift',id:'a',value:{scopeKey:'missing',shift:shift('a')}}]}));assert.throws(()=>collector.finish());
});

test('window memory budgets fail explicitly rather than presenting truncated coverage',()=>{
 const records=Window.collector(projection,{maxRecords:1});assert.throws(()=>records.add(page([row('a'),row('b')],{studio:metadata})),/mange poster/);assert.throws(()=>records.finish());const bytes=Window.collector(projection,{maxBytes:200});assert.throws(()=>bytes.add(page([row('a')],{studio:metadata})),/mange data/);assert.throws(()=>bytes.finish());
});

test('series projections collect compact availability and catalog separately from editable records and versions',()=>{
 const scope={mode:'series',groupId:'agreement',ranges:[{from:'2027-01-01',to:'2027-06-30'}],calendar:{from:projection.from,to:projection.to}},selection={groupIds:['agreement'],ranges:[{from:'2026-12-28',to:'2027-07-04'}]},collector=Window.collector(scope);
 const summary={id:'other-series',groupId:'other-agreement',person:'p2',site:1,startDate:'2027-01-01',endDate:'2027-06-30',weekdays:[1,3],start:'08:00',end:'16:00',note:'Never turn this summary into a plan write',noteRich:'private-rich'},editable=row('own');
 collector.add({...page([editable],{studio:metadata,nextCursor:'second'}),selection,planning:{...page([editable]).planning,projection:scope},auxRows:[{kind:'availability',id:'summary-series',value:{kind:'series',id:summary.id,value:summary}},{kind:'catalog',id:'catalog-series',value:{kind:'series',id:summary.id,value:summary,hasDescription:true}}]});
 const old=shift('suppressed',{note:'Read-only exception',seriesId:summary.id}),published=shift('published',{note:'Published private note'});
 collector.add({...page([]),planning:{...page([]).planning,projection:scope},auxRows:[{kind:'availability',id:'summary-shift',value:{kind:'shift',id:old.id,value:{edit:old,suppressed:true}}},{kind:'availability',id:'summary-published',value:{kind:'published',id:published.id,value:published}},{kind:'catalog',id:'catalog-shift',value:{kind:'shift',id:old.id,value:{edit:old,suppressed:true},hasDescription:true}}]});
 const result=collector.finish();assert.deepEqual(result.selection,selection);assert.deepEqual(Object.keys(result.studio.edits),['own']);assert.equal(result.studio.series.length,0);assert.deepEqual(Object.keys(result.planning.versions),[Planning.key('shift','own')]);
 assert.equal(result.availability.series[0].groupId,'other-agreement');assert.equal(result.availability.series[0].note,undefined);assert.equal(result.availability.series[0].noteRich,undefined);assert.equal(result.availability.edits.suppressed.note,undefined);assert.deepEqual(result.availability.deleted,['suppressed']);assert.equal(result.availability.published[0].id,'published');assert.equal(result.availability.published[0].note,undefined);assert.equal(result.availability.demoSeed,false);
 assert.equal(result.catalog.series[0].hasDescription,true);assert.equal(result.catalog.edits.suppressed.hasDescription,true);assert.equal(result.catalog.series[0].note,undefined);assert.equal(result.studio.availability,undefined);assert.equal(Planning.metadata(result.studio).catalog,undefined);
});

test('operation scopes require stable selection info and reject changed or unsafe summary rows',()=>{
 const scope={mode:'series-list',calendar:{from:projection.from,to:projection.to}},one={...page([],{studio:metadata,nextCursor:'next'}),selection:{groupIds:[]},planning:{...page([]).planning,projection:scope}},collector=Window.collector(scope);
 const missing={...one};delete missing.selection;assert.throws(()=>Window.collector(scope).add(missing));collector.add(one);
 assert.throws(()=>collector.add({...page([]),planning:{...page([]).planning,projection:scope},selection:{groupIds:['changed']}}));
 for(const value of [{kind:'series',id:'__proto__',value:{id:'__proto__'}},{kind:'shift',id:'a',value:{edit:{id:'b'},suppressed:false}},{kind:'published',id:'a',value:{id:'b'}}]){
  assert.throws(()=>Window.collector(scope).add({...one,auxRows:[{kind:'availability',id:'unsafe',value}]}));
 }
});

test('directory generation is pinned across calendar pages even while the planning revision stays unchanged',()=>{
 const collector=Window.collector(projection);collector.add(page([row('a')],{studio:metadata,directory:{schema:1,revision:7,complete:true,versions:{}},nextCursor:'two'}));assert.throws(()=>collector.add(page([row('b')],{directory:{schema:1,revision:8}})));assert.throws(()=>collector.finish());
 const valid=Window.collector(projection);valid.add(page([row('a')],{studio:metadata,directory:{schema:1,revision:7,complete:true,versions:{}},nextCursor:'two'}));valid.add(page([row('b')],{directory:{schema:1,revision:7}}));assert.equal(valid.finish().directory.revision,7);
});

test('catalog-only series projections stay read-only and activate only a complete catalog',()=>{
 const scope={mode:'series-list',calendar:{from:projection.from,to:projection.to},catalogOnly:true},series={id:'agreement',person:'p1',site:0,startDate:'2026-11-02',endDate:'2027-04-30',weekdays:[1,3],start:'07:00',end:'15:00',note:'Must not become an editable body'},selection={catalog:true,catalogOnly:true,ranges:[],groupIds:[],seriesIds:[]};
 assert.deepEqual(Window.normalize(scope),scope);assert.equal(Window.covers(scope,projection.from),false);assert.equal(Window.covers({...scope,catalogOnly:undefined},projection.from),true);
 for(const flag of [false,'true',1])assert.throws(()=>Window.normalize({...scope,catalogOnly:flag}));
 const response=(items,patch={})=>({...page([],{studio:metadata}),planning:{schema:1,partial:true,projection:scope,versions:{},metadataHash:'a'.repeat(64),absenceVersion:3},selection,publicationRows:[],auxRows:items,...patch}),catalog={kind:'catalog',id:Planning.key('series',series.id),value:{kind:'series',id:series.id,value:series,hasDescription:true}},collector=Window.collector(scope);
 assert.equal(collector.add(response([catalog],{nextCursor:'next'})),'next');assert.throws(()=>collector.finish());collector.add({...response([]),studio:undefined,selection:undefined});const result=collector.finish();
 assert.equal(result.catalog.series.length,1);assert.equal(result.catalog.series[0].hasDescription,true);assert.equal(result.catalog.series[0].note,undefined);assert.deepEqual(result.studio.series,[]);assert.deepEqual(result.studio.edits,{});assert.deepEqual(result.planning.versions,{});assert.equal(result.studio.publications,undefined);assert.equal(result.availability,undefined);
 for(const patch of [{records:[row('a')],planning:{...response([]).planning,versions:{[Planning.key('shift','a')]:1}}},{publicationRows:[{kind:'state',id:'state',value:{present:false,value:{version:1,sequence:0}}}]},{progress:{task:{checked:true}}},{auxRows:[{...catalog,kind:'availability'}]},{selection:{...selection,catalogOnly:false}}])assert.throws(()=>Window.collector(scope).add(response([],patch)));
});
