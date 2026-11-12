const test=require('node:test');
const assert=require('node:assert/strict');
const Publication=require('../src/publication-model.js');
const Departments=require('../src/department-model.js');
const Description=require('../src/description-model.js');
const actor={userId:'real-owner',name:'Planlægger'},at='2026-10-30T12:00:00.000Z';
const week={from:'2026-10-26',to:'2026-11-01',siteIds:[0]};
const shift=(id='one',changes={})=>({id,person:'p0',site:0,date:'2026-10-27',start:'07:00',end:'15:00',note:'Udgivet instruktion',...changes});
const studio=(changes={})=>({storageVersion:1,demoSeed:false,organization:Departments.defaultOrganization(),series:[],edits:{one:shift()},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{},...changes});
const publish=(value,scope=week)=>Publication.publish(value,{...scope,actor,at}).studio;

test('legacy draft flags and entire unpublised plans never become employee shifts automatically',()=>{
  const draft=studio({weekPlans:{0:{published:true,baselineKind:'published',baseline:[shift()]}}});
  assert.deepEqual(Publication.publishedShifts(draft),[]);
  assert.equal(Publication.scopeStatus(draft,week).published,false);
  const saved=publish(draft);assert.deepEqual(Publication.publishedShifts(saved,'p0'),[shift()]);
  assert.equal(Publication.scopeStatus(saved,week).published,true);
  assert.equal(Publication.scopeStatus(saved,{...week,siteIds:[0,1]}).published,false);
});

test('overnight shifts publish in their starting week while equal-time shifts remain invalid',()=>{
  const night=shift('night',{date:'2026-11-01',start:'22:00',end:'06:00',plannedBreakMinutes:30}),saved=publish(studio({edits:{night}}));
  assert.deepEqual(Publication.publishedShifts(saved,'p0'),[night]);
  assert.deepEqual(Publication.validate(saved.publications),[]);
  assert.equal(saved.publications.slots['2026-10-26|0'].shifts[0].date,'2026-11-01');
  assert.equal(saved.publications.slots['2026-11-02|0'],undefined);
  assert.equal(Publication.scopeStatus(saved,week).published,true);
  for(const end of ['22:00','bad'])assert.throws(()=>publish(studio({edits:{night:{...night,end}}})),TypeError);
});

test('draft assignment, instructions, movement and deletion leave published occurrences unchanged',()=>{
  const original=publish(studio()),draft=structuredClone(original);
  draft.edits.one={...draft.edits.one,person:'p1',date:'2026-10-28',start:'08:00',note:'DRAFT SECRET'};draft.deleted=['one'];
  assert.deepEqual(Publication.publishedShifts(draft,'p0'),[shift()]);assert.deepEqual(Publication.publishedShifts(draft,'p1'),[]);
  const status=Publication.scopeStatus(draft,week);assert.equal(status.published,false);assert.equal(status.changes[0].type,'removed');
  const next=publish(draft);assert.deepEqual(Publication.publishedShifts(next),[]);assert.equal(Publication.scopeStatus(next,week).published,true);
});

test('published locations remain frozen until an explicit publication includes their scope',()=>{
  const saved=publish(studio()),draft=structuredClone(saved);
  Object.assign(draft.organization.sites[0],{_directoryVersion:2,worksiteInfo:{parking:'Ny parkering'}});
  assert.equal(Publication.scopeStatus(draft,week).published,true,'live worksite details and directory versions do not need a new publication');
  draft.organization.sites[0].name='Draft arbejdssted';draft.organization.sites[0].address='DRAFT ADDRESS';
  assert.equal(Publication.publishedSites(draft,'p0')[0].name,'Kontor Nord');
  const status=Publication.scopeStatus(draft,week);assert.equal(status.published,false);assert.equal(status.locationChanges.length,1);
  assert.equal(Publication.publishedSites(publish(draft),'p0')[0].name,'Draft arbejdssted');
});

test('cross-week and cross-site moves require the exact related scope and never duplicate occurrence IDs',()=>{
  const saved=publish(studio()),draft=structuredClone(saved);draft.edits.one={...draft.edits.one,date:'2026-11-03',site:1};
  const destination={from:'2026-11-02',to:'2026-11-08',siteIds:[1]};
  assert.deepEqual(Publication.expandScope(draft,destination).dependencies,[week]);
  assert.throws(()=>publish(draft,destination),error=>error.dependencies?.length===1);
  const next=publish(draft,{...destination,includeDependencies:true});
  assert.deepEqual(Publication.publishedShifts(next),[draft.edits.one]);assert.equal(next.publications.slots['2026-10-26|0'].shifts.length,0);
  assert.deepEqual(next.publications.records.at(-1).scopes,[week,destination]);
  assert.deepEqual(Publication.validate(next.publications),[]);
});

test('series exceptions publish by actual date and preserve long rich instructions exactly',()=>{
  const note='  Meget lang instruktion\n'.repeat(15000)+'\n',noteRich=Description.encode(Description.fromText(note));
  const series={id:'series',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-08',weekdays:[1],start:'07:00',end:'15:00',note:'Basis'};
  const moved={...shift('series@2026-10-27',{date:'2026-11-04',note,noteRich}),seriesId:'series'};
  const value=studio({series:[series],edits:{[moved.id]:moved},deleted:['series@2026-11-03']});
  const saved=publish(value,{from:'2026-11-02',to:'2026-11-08',siteIds:[0]});
  assert.deepEqual(Publication.publishedShifts(saved),[moved]);assert.equal(Publication.publishedShifts(saved)[0].note,note);
});

test('publication metadata retention does not evict still-published snapshots',()=>{
  let value=studio();
  for(let index=0;index<105;index++)value=Publication.publish(value,{...week,actor,at:new Date(Date.parse(at)+index*1000).toISOString()}).studio;
  assert.equal(value.publications.records.length,100);assert.equal(value.publications.sequence,105);assert.deepEqual(Publication.publishedShifts(value),[shift()]);
  assert.equal(value.publications.slots['2026-10-26|0'].publicationId,'publication-105');
});

test('malformed snapshots and partial-week publication scopes fail closed',()=>{
  for(const scope of [{...week,from:'2026-10-27'},{...week,to:'2026-10-30'},{...week,siteIds:[]},{...week,siteIds:[0,0]},{...week,siteIds:[99]}])assert.throws(()=>publish(studio(),scope),TypeError);
  assert.throws(()=>Publication.normalize({}),TypeError);
  const saved=publish(studio()),bad=structuredClone(saved.publications);bad.slots['2026-10-26|0'].shifts.push(shift());assert.ok(Publication.validate(bad).length);
  bad.slots['2026-10-26|0'].shifts=[null];assert.doesNotThrow(()=>Publication.validate(bad));assert.ok(Publication.validate(bad).length);
});

test('durable recovery reverses exact changed records and preserves unrelated newer edits',()=>{
  const before=studio(),after=studio({edits:{one:{...shift(),start:'08:00'}}}),changes=Publication.activityChanges(before,after),entry={kind:'plan',recoverable:true,changes};
  after.edits.unrelated=shift('unrelated',{date:'2026-10-28'});
  const result=Publication.restoreActivity(after,entry);assert.equal(result.ok,true);assert.deepEqual(result.studio.edits.one,before.edits.one);assert.ok(result.studio.edits.unrelated);
  after.edits.one.end='16:00';assert.equal(Publication.restoreActivity(after,entry).ok,false);
  assert.equal(Publication.restoreActivity(after,{...entry,kind:'publication'}).ok,false);
  assert.equal(Publication.restoreActivity(after,{...entry,recoverable:false}).ok,false);
});

test('activity recovery explicitly clears planned pause metadata without changing restored weekday inheritance',()=>{
  const source={id:'series',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1],start:'07:00',end:'15:00',note:''};
  for(const changed of [{...source,plannedBreakMinutes:30},{...source,dayTimes:{1:{start:'07:00',end:'15:00',plannedBreakMinutes:30}}}]){
    const before=studio({series:[source]}),after=studio({series:[changed],edits:{one:{...shift(),plannedBreakMinutes:30}}}),entry={kind:'plan',recoverable:true,changes:Publication.activityChanges(before,after)},restored=Publication.restoreActivity(after,entry);
    assert.equal(restored.ok,true);assert.equal(restored.studio.series[0].plannedBreakMinutes,0);assert.equal(restored.studio.edits.one.plannedBreakMinutes,0);
    assert.ok(require('../src/series-engine.js').enumerate(restored.studio.series[0]).every(item=>!item.plannedBreakMinutes));
  }
  const before=studio({series:[{...source,plannedBreakMinutes:20,dayTimes:{1:{start:'07:00',end:'15:00'}}}]}),after=studio({series:[{...source,plannedBreakMinutes:20,dayTimes:{1:{start:'07:00',end:'15:00',plannedBreakMinutes:30}}}]}),restored=Publication.restoreActivity(after,{kind:'plan',recoverable:true,changes:Publication.activityChanges(before,after)});
  assert.equal(restored.studio.series[0].plannedBreakMinutes,20);assert.equal(require('../src/series-engine.js').enumerate(restored.studio.series[0])[0].plannedBreakMinutes,20);
});

test('future series splits and another draft move retain server-derived publication scope lineage',()=>{
  const source={id:'original',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:''};
  const scope={from:'2026-11-02',to:'2026-11-08',siteIds:[0]},saved=publish(studio({series:[source],edits:{}}),scope);
  const retained={...source,endDate:'2026-11-02'},future={...source,id:'future',startDate:'2026-11-03',site:1};
  const split=Publication.withLineage(saved,{...saved,series:[retained,future]});
  assert.deepEqual(Publication.expandScope(split,{...scope,siteIds:[1]}).dependencies,[scope]);
  const movedAgain=Publication.withLineage(split,{...split,series:[retained,{...future,site:2}]});
  assert.deepEqual(Publication.expandScope(movedAgain,{...scope,siteIds:[2]}).dependencies,[{...scope,siteIds:[0,1]}]);
  const next=publish(movedAgain,{...scope,siteIds:[2],includeDependencies:true});
  assert.equal(Publication.publishedShifts(next).length,2);assert.ok(Publication.publishedShifts(next).every(shift=>shift.seriesId==='future'&&shift.site===2));assert.deepEqual(next.publications.scopeLinks,[]);
});

test('future split resetting a moved/deleted draft exception links its still-published actual week',()=>{
  const source={id:'original',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-08',weekdays:[1],start:'07:00',end:'15:00',note:''};
  const moved=shift('original@2026-11-03',{seriesId:'original',date:'2026-12-01'});
  const oldScope={from:'2026-11-30',to:'2026-12-06',siteIds:[0]},saved=publish(studio({series:[source],edits:{[moved.id]:moved}}),oldScope);
  const before={...saved,deleted:[moved.id]},after={...before,series:[{...source,endDate:'2026-11-02'},{...source,id:'future',startDate:'2026-11-03',site:1}],edits:{},deleted:[]};
  const linked=Publication.withLineage(before,after),target={from:'2026-11-02',to:'2026-11-08',siteIds:[1]};
  assert.ok(Publication.expandScope(linked,target).dependencies.some(scope=>scope.from===oldScope.from&&scope.siteIds.includes(0)));
  const next=publish(linked,{...target,includeDependencies:true});
  assert.deepEqual(Publication.publishedShifts(next).map(shift=>shift.id),['future@2026-11-03']);
});

test('open-ended lineage compares only published/origin weeks and preserves a moved future occurrence across a split',()=>{
  const source={id:'open-original',person:'p0',site:0,startDate:'2026-10-26',endDate:'2100-12-31',openEnded:true,weekdays:[1,3],start:'07:00',end:'15:00',note:''},futureScope={from:'2030-11-04',to:'2030-11-10',siteIds:[0]},saved=publish(studio({series:[source],edits:{}}),futureScope),retained={...source,endDate:'2029-12-31',openEnded:false},future={...source,id:'open-future',startDate:'2030-01-01',site:1};
  const split=Publication.withLineage(saved,{...saved,series:[retained,future]});assert.deepEqual(Publication.expandScope(split,{...futureScope,siteIds:[1]}).dependencies,[futureScope]);
  const movedAgain=Publication.withLineage(split,{...split,series:[retained,{...future,site:2}]});assert.deepEqual(Publication.expandScope(movedAgain,{...futureScope,siteIds:[2]}).dependencies,[{...futureScope,siteIds:[0,1]}]);
  const published=publish(movedAgain,{...futureScope,siteIds:[2],includeDependencies:true});assert.equal(Publication.publishedShifts(published).length,2);assert.ok(Publication.publishedShifts(published).every(item=>item.seriesId==='open-future'&&item.site===2));assert.deepEqual(published.publications.scopeLinks,[]);
});

test('recovery restores an explicit finite end after an open-ended edit without dropping new metadata',()=>{
  const source={id:'open-recovery',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1],start:'07:00',end:'15:00',note:''},before=studio({series:[source]}),after=studio({series:[{...source,endDate:'2100-12-31',openEnded:true}]}),restored=Publication.restoreActivity(after,{kind:'plan',recoverable:true,changes:Publication.activityChanges(before,after)});
  assert.equal(restored.ok,true);assert.equal(restored.studio.series[0].openEnded,false);assert.equal(restored.studio.series[0].endDate,source.endDate);
});
