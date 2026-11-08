const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Engine=require('../src/series-engine.js');
const Lifecycle=require('../src/series-lifecycle.js');
const phase=patch=>({id:'phase-one',person:'p0',site:0,startDate:'2026-01-01',endDate:'2026-06-30',weekdays:[1,3],start:'07:00',end:'15:00',note:'Standard',...patch});
const freeze=value=>{Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return value;};

test('legacy series remain independent while explicit phases join the root identity without changing occurrence IDs',()=>{
  const original=phase({id:'legacy'}),next=phase({id:'next',groupId:'legacy',startDate:'2026-07-01',endDate:'2026-12-31'}),other=phase({id:'other'});
  assert.deepEqual(Lifecycle.validate([original,next,other]),[]);const groups=Lifecycle.groupSeries([next,other,original],{today:'2026-10-30'});
  assert.equal(groups.length,2);const group=groups.find(group=>group.id==='legacy');assert.equal(group.groupId,'legacy');assert.equal(group.phases.length,2);assert.equal(group.representative.id,'next');assert.equal(group.latest.id,'next');assert.equal(group.startDate,'2026-01-01');assert.equal(group.endDate,'2026-12-31');
  const prior=Engine.enumerate(original);assert.ok(prior.every(before=>group.shifts.some(after=>after.id===before.id&&after.start===before.start)));assert.equal(group.total,Engine.enumerate(original).length+Engine.enumerate(next).length);
});

test('phase validation rejects duplicate IDs and inclusive date overlaps within a group even if weekdays differ',()=>{
  const original=phase({id:'root'}),overlap=phase({id:'next',groupId:'root',startDate:'2026-06-30',endDate:'2026-12-01',weekdays:[0]});
  assert.ok(Lifecycle.validate([original,overlap]).some(error=>error.includes('overlappe')));assert.ok(Lifecycle.validate([original,{...original}]).some(error=>error.includes('flere gange')));
  assert.deepEqual(Lifecycle.validate([original,{...overlap,startDate:'2026-07-01'}]),[]);assert.deepEqual(Lifecycle.validate([original,{...overlap,groupId:'other'}]),[]);
  assert.ok(Lifecycle.validate(null).length);assert.throws(()=>Lifecycle.groupSeries([original,overlap],{today:'2026-10-30'}),TypeError);
});

test('representative uses the current phase, then the nearest future phase, then the latest ended phase',()=>{
  const phases=[phase({id:'first',groupId:'agreement'}),phase({id:'second',groupId:'agreement',startDate:'2026-08-01',endDate:'2026-12-31'}),phase({id:'third',groupId:'agreement',startDate:'2027-01-01',endDate:'2027-06-30'})];
  for(const [today,representative,status]of [['2025-12-01','first','upcoming'],['2026-05-10','first','active'],['2026-07-15','second','active'],['2026-10-30','second','active'],['2027-03-10','third','active'],['2028-01-01','third','ended']]){
    const [group]=Lifecycle.groupSeries(phases,{today});assert.equal(group.representative.id,representative,today);assert.equal(group.latest.id,'third');assert.equal(group.status,status);
  }
  assert.throws(()=>Lifecycle.groupSeries(phases,{}),TypeError);assert.throws(()=>Lifecycle.groupSeries(phases,{today:'2026-02-30'}),TypeError);
});

test('merged actual occurrences include moved assignments, cancellations and weekday-specific times across all phases',()=>{
  const first=phase({id:'first',groupId:'agreement'}),second=phase({id:'second',groupId:'agreement',startDate:'2026-07-01',endDate:'2026-12-31',dayTimes:{'3':{start:'09:00',end:'13:00'}}}),before=Engine.enumerate(first)[0],cancelled=Engine.enumerate(second)[0];
  const manual={...before,person:'p1',site:2,date:'2027-01-15',start:'10:00',end:'12:00',note:'Manual'};
  const [group]=Lifecycle.groupSeries([first,second],{today:'2026-10-30',edits:{[manual.id]:manual},deleted:[cancelled.id]});
  assert.equal(group.total,Engine.enumerate(first).length+Engine.enumerate(second).length-1);assert.ok(group.shifts.some(shift=>shift.id===manual.id&&shift.date==='2027-01-15'&&shift.person==='p1'));assert.ok(!group.shifts.some(shift=>shift.id===cancelled.id));assert.equal(group.next.date,'2026-11-03');assert.equal(group.shifts.find(shift=>shift.date==='2026-11-05').start,'09:00');
  assert.equal(group.exceptions.count,2);assert.equal(group.exceptions.edited,1);assert.equal(group.exceptions.deleted,1);assert.equal(group.upcomingCount,group.upcoming.length);assert.equal(group.status,'active');
  const endedButMoved=Lifecycle.groupSeries([first],{today:'2026-10-30',edits:{[manual.id]:manual}})[0];assert.equal(endedButMoved.status,'active');assert.equal(endedButMoved.next.date,'2027-01-15');
});

test('expiry uses the latest phase period and a 28-day inclusive window rather than the last actual exception',()=>{
  const source=phase({endDate:'2026-06-30'}),first=Engine.enumerate(source)[0],edits={[first.id]:{...first,date:'2027-01-01'}};
  for(const [today,days,expiring]of [['2026-06-01',29,false],['2026-06-02',28,true],['2026-06-30',0,true],['2026-07-01',-1,false]]){
    const [group]=Lifecycle.groupSeries([source],{today,edits});assert.equal(group.daysToEnd,days);assert.equal(group.expiring,expiring);
  }
  const extension=phase({id:'later',groupId:source.id,startDate:'2026-07-01',endDate:'2026-12-31'});assert.equal(Lifecycle.groupSeries([source,extension],{today:'2026-06-20'})[0].expiring,false);
});

test('copying creates a fresh agreement from template data without exceptions, ownership progress or publication state',()=>{
  const noteRich=JSON.stringify({type:'doc',text:'    ÆØÅ 🧽 <b>literal</b>\n'.repeat(1600)}),source=freeze(phase({groupId:'original-agreement',note:'Plain instruction',noteRich,dayTimes:{'3':{start:'09:00',end:'13:00'}},edits:{secret:{}},deleted:['cancelled'],checklistProgress:{completed:true},publications:{secret:true}}));
  const before=JSON.stringify(source),result=Lifecycle.copyDraft(source,{id:'copy',startDate:'2027-01-01',endDate:'2027-06-30',person:'person-new',site:2});assert.equal(result.ok,true,result.error);assert.equal(result.draft.id,'copy');assert.equal(result.draft.groupId,'copy');assert.equal(result.draft.person,'person-new');assert.equal(result.draft.site,2);assert.equal(result.draft.noteRich,noteRich);assert.equal(result.draft.note,source.note);assert.deepEqual(result.draft.dayTimes,source.dayTimes);
  for(const field of ['edits','deleted','checklistProgress','publications'])assert.equal(Object.hasOwn(result.draft,field),false);
  result.draft.dayTimes['3'].start='10:00';result.draft.weekdays.push(4);assert.equal(JSON.stringify(source),before);
  for(const id of [source.id,source.groupId])assert.equal(Lifecycle.copyDraft(source,{id,startDate:'2027-01-01',endDate:'2027-06-30'}).ok,false);
});

test('extension appends after the latest actual phase, clamps calendar month ends and carries only template metadata',()=>{
  const old=phase({id:'old',groupId:'agreement',startDate:'2027-01-01',endDate:'2027-06-30'}),latest=phase({id:'latest',groupId:'agreement',startDate:'2027-08-01',endDate:'2028-01-31',dayTimes:{'3':{start:'09:00',end:'13:00'}},noteRich:'rich-template',checklistProgress:{secret:true}}),source=freeze({phases:[latest,old],latest:old});
  const before=JSON.stringify(source),result=Lifecycle.extensionDraft(source,{id:'extension',months:1});assert.equal(result.ok,true,result.error);assert.equal(result.draft.startDate,'2028-02-01');assert.equal(result.draft.endDate,'2028-02-29');assert.equal(result.draft.groupId,'agreement');assert.equal(result.draft.noteRich,'rich-template');assert.deepEqual(result.draft.dayTimes,latest.dayTimes);assert.equal(Object.hasOwn(result.draft,'checklistProgress'),false);assert.deepEqual(Lifecycle.validate([...source.phases,result.draft]),[]);assert.equal(JSON.stringify(source),before);
});

test('multi-year agreements append 365/366-day phases while every older occurrence ID and manual record remains intact',()=>{
  const original=phase({id:'root',startDate:'2027-01-01',endDate:'2027-12-31'}),manual=Engine.enumerate(original)[0],edits={[manual.id]:{...manual,date:'2029-01-10',note:'Manual visit'}};
  const first=Lifecycle.extensionDraft(original,{id:'year-two',months:12});assert.equal(first.ok,true,first.error);assert.equal(first.draft.startDate,'2028-01-01');assert.equal(first.draft.endDate,'2028-12-31');assert.equal((new Date(first.draft.endDate)-new Date(first.draft.startDate))/86400000+1,366);
  const second=Lifecycle.extensionDraft({phases:[original,first.draft]},{id:'year-three',months:12});assert.equal(second.ok,true,second.error);assert.equal(second.draft.startDate,'2029-01-01');assert.equal(second.draft.endDate,'2029-12-31');
  const [group]=Lifecycle.groupSeries([original,first.draft,second.draft],{today:'2028-06-01',edits});assert.equal(group.phases.length,3);assert.equal(group.groupId,'root');assert.ok(group.shifts.some(shift=>shift.id===manual.id&&shift.note==='Manual visit'));assert.ok(group.total>300);assert.deepEqual(Engine.enumerate(original).map(shift=>shift.id).filter(id=>id!==manual.id),group.shifts.filter(shift=>shift.seriesId===original.id&&shift.id!==manual.id).sort((a,b)=>a.id.localeCompare(b.id)).map(shift=>shift.id));
});

test('stale extension drafts are rejected by validation against the fresh group and invalid copy periods fail clearly',()=>{
  const original=phase({id:'root'}),stale=Lifecycle.extensionDraft(original,{id:'stale',months:6});assert.equal(stale.ok,true);
  const concurrent=phase({id:'concurrent',groupId:'root',startDate:'2026-07-01',endDate:'2027-03-01'});assert.ok(Lifecycle.validate([original,concurrent,stale.draft]).some(error=>error.includes('overlappe')));
  for(const months of [0,-1,1.5,13,'6'])assert.equal(Lifecycle.extensionDraft(original,{id:'new',months}).ok,false);
  assert.equal(Lifecycle.extensionDraft({phases:[original,phase({id:'other'})]},{id:'new',months:6}).ok,false);assert.equal(Lifecycle.extensionDraft(original,{id:original.id,months:6}).ok,false);
  assert.equal(Lifecycle.copyDraft(original,{id:'copy',startDate:'2026-02-30',endDate:'2026-08-30'}).ok,false);assert.equal(Lifecycle.copyDraft(original,{id:'copy',startDate:'2026-01-01',endDate:'2027-12-31',openEnded:true}).ok,false);
});

test('group outputs are independent copies and browser scripts export the same frozen lifecycle API',()=>{
  const source=freeze([phase({dayTimes:{'3':{start:'09:00',end:'13:00'}}})]),before=JSON.stringify(source),[group]=Lifecycle.groupSeries(source,{today:'2026-05-01'});group.phases[0].dayTimes['3'].start='10:00';group.representative.name='Changed';group.shifts[0].note='Changed';assert.equal(JSON.stringify(source),before);assert.notEqual(group.occurrences[0].note,'Changed');assert.ok(Object.isFrozen(Lifecycle));
  const context=vm.createContext({});for(const filename of ['series-engine.js','series-planner.js','series-lifecycle.js'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+filename),'utf8'),context);assert.deepEqual(Object.keys(context.CleanRoomsSeriesLifecycle).sort(),['copyDraft','extensionDraft','groupSeries','summarizeSeries','validate']);assert.ok(Object.isFrozen(context.CleanRoomsSeriesLifecycle));assert.equal(context.CleanRoomsSeriesLifecycle.groupSeries(source,{today:'2026-05-01'}).length,1);
});
