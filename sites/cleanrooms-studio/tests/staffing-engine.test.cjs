const test = require('node:test');
const assert = require('node:assert/strict');
const Staffing = require('../src/staffing-engine.js');

const shift = (id, overrides={}) => ({id,person:'p0',date:'2026-10-27',site:0,start:'07:00',end:'15:00',note:'',...overrides});
const options = overrides => ({person:{id:'p0',target:37},proposed:[shift('candidate')],existing:[],removedIds:[],blockedDates:[],pendingRequests:[],weekStart:'2026-10-26',...overrides});
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('editing an occurrence uses original current hours and replaces it once in projected hours',()=>{
  const current=shift('a',{start:'07:00',end:'14:00'}),proposed={...current,start:'08:10',end:'16:20'};
  const result=Staffing.assess(options({existing:[current],proposed:[proposed]}));
  assert.equal(result.valid,true);assert.equal(result.available,true);assert.equal(result.status,'available');
  assert.equal(result.currentMinutes,420);assert.equal(result.projectedMinutes,490);assert.equal(result.targetMinutes,2220);
  assert.equal(result.weekStart,'2026-10-26');assert.equal(result.weekEnd,'2026-11-01');assert.equal(result.weekCount,1);
});

test('availability inspects every proposed week and all sites even outside the preview week',()=>{
  const proposed=[shift('a'),shift('b',{date:'2026-11-03'})],existing=[shift('hidden',{date:'2026-11-03',site:2,start:'14:00',end:'17:00'})];
  const result=Staffing.assess(options({proposed,existing}));assert.equal(result.valid,true);assert.equal(result.status,'blocked');assert.equal(result.available,false);
  assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].type,'overlap');assert.equal(result.conflicts[0].date,'2026-11-03');assert.equal(result.conflicts[0].other.id,'hidden');
  assert.equal(result.weekCount,2);assert.equal(result.currentMinutes,0);assert.equal(result.projectedMinutes,480);
});

test('internal overlaps are blocking and listed once per pair; boundary touching is allowed',()=>{
  const proposed=[shift('a'),shift('b',{start:'14:00',end:'17:00'})];
  let result=Staffing.assess(options({proposed}));assert.equal(result.available,false);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].type,'internal');
  proposed[1].start='15:00';result=Staffing.assess(options({proposed}));assert.equal(result.available,true);assert.equal(result.conflicts.length,0);
});

test('approved leave blocks availability while matching pending requests are advisory only',()=>{
  const pendingRequests=[{person:'p0',date:'2026-10-27',type:'Friønske'},{person:'p1',date:'2026-10-27',type:'Ferie'},{person:'p0',date:'2026-10-28',type:'Ferie'}];
  let result=Staffing.assess(options({pendingRequests}));assert.equal(result.available,true);assert.deepEqual(result.pendingRequests,[pendingRequests[0]]);
  result=Staffing.assess(options({pendingRequests,blockedDates:[{person:'p0',date:'2026-10-27'},{person:'p0',date:'2026-10-27'}]}));assert.equal(result.status,'blocked');assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].type,'leave');
});

test('removed IDs free both availability and projected hours without changing current totals',()=>{
  const existing=[shift('old'),shift('other',{date:'2026-10-28',start:'08:00',end:'12:00'})];
  const result=Staffing.assess(options({existing,removedIds:['old'],proposed:[shift('new',{end:'13:00'})]}));
  assert.equal(result.available,true);assert.equal(result.currentMinutes,720);assert.equal(result.projectedMinutes,600);
});

test('reassignment across people adds hours to the new employee and removes them from the old one',()=>{
  const existing=[shift('reassigned'),shift('existing-p1',{person:'p1',date:'2026-10-28'})];
  const result=Staffing.assess(options({person:{id:'p1',target:37},existing,removedIds:['reassigned'],proposed:[shift('reassigned',{person:'p1'})]}));
  assert.equal(result.available,true);assert.equal(result.currentMinutes,480);assert.equal(result.projectedMinutes,960);
  const old=Staffing.assess(options({existing,removedIds:['reassigned'],proposed:[]}));assert.equal(old.valid,true);assert.equal(old.status,'incomplete');assert.equal(old.currentMinutes,480);assert.equal(old.projectedMinutes,0);
});

test('a copied shift retains original hours while adding the candidate once',()=>{
  const result=Staffing.assess(options({existing:[shift('original')],proposed:[shift('copy',{date:'2026-10-28'})]}));
  assert.equal(result.available,true);assert.equal(result.currentMinutes,480);assert.equal(result.projectedMinutes,960);
});

test('over-target advisories cover each affected proposal week and never block availability',()=>{
  const result=Staffing.assess(options({person:{id:'p0',target:10},existing:[shift('existing',{date:'2026-10-26'})],proposed:[shift('a'),shift('b',{date:'2026-11-03'})]}));
  assert.equal(result.available,true);assert.equal(result.weekCount,2);assert.equal(result.projectedMinutes,960);
  assert.deepEqual(result.overTargetWeeks,[{weekStart:'2026-10-26',projectedMinutes:960,targetMinutes:600}]);
  const zero=Staffing.assess(options({person:{id:'p0',target:0}}));assert.equal(zero.available,true);assert.equal(zero.overTargetWeeks[0].targetMinutes,0);
});

test('minute totals stay exact and fractional target hours are rounded once',()=>{
  const result=Staffing.assess(options({person:{id:'p0',target:37.3333},proposed:[shift('a',{start:'07:10',end:'08:25'}),shift('b',{date:'2026-10-28',start:'07:20',end:'07:55'})]}));
  assert.equal(result.projectedMinutes,110);assert.equal(result.targetMinutes,2240);assert.ok(Number.isInteger(result.projectedMinutes));
});

test('missing data, non-Mondays, impossible dates, bad targets and invalid times never report available',()=>{
  const cases=[{proposed:undefined},{existing:undefined},{weekStart:'2026-10-27'},{weekStart:'2026-02-30'},{person:{id:'p0',target:-1}},{person:{id:'p0',target:Infinity}},{person:{id:'p0',target:'37'}},{person:{target:37}},
    {proposed:[shift('a',{date:'2026-02-30'})]},{proposed:[shift('a',{start:'7:00'})]},{proposed:[shift('a',{end:'24:00'})]},{proposed:[shift('a',{end:'07:00'})]},{proposed:[shift('a',{person:'p1'})]},{existing:[shift('bad',{date:'bad'})]}];
  for(const values of cases){const result=Staffing.assess(options(values));assert.equal(result.valid,false,JSON.stringify(values));assert.equal(result.available,false);assert.equal(result.status,'incomplete');}
});

test('an empty valid proposal is incomplete but still reports accurate original and remaining hours',()=>{
  const result=Staffing.assess(options({proposed:[],existing:[shift('a')]}));assert.equal(result.valid,true);assert.equal(result.available,false);assert.equal(result.status,'incomplete');assert.equal(result.weekCount,0);assert.equal(result.currentMinutes,480);assert.equal(result.projectedMinutes,480);
});

test('duplicate proposed IDs are invalid; identical existing union entries count only once',()=>{
  const a=shift('a');assert.equal(Staffing.assess(options({proposed:[a,{...a}]})).valid,false);
  const result=Staffing.assess(options({proposed:[shift('b',{date:'2026-10-28'})],existing:[a,{...a}]}));assert.equal(result.valid,true);assert.equal(result.currentMinutes,480);assert.equal(result.projectedMinutes,960);
  assert.equal(Staffing.assess(options({existing:[a,{...a,end:'16:00'}]})).valid,false);
});

test('input arrays and shift metadata are preserved on available and blocked results',()=>{
  for(const input of[options(),options({existing:[shift('hidden')],pendingRequests:[{person:'p0',date:'2026-10-27',type:'Friønske'}]})]){freeze(input);const before=JSON.stringify(input);Staffing.assess(input);assert.equal(JSON.stringify(input),before);}
  assert.equal(globalThis.CleanRoomsStaffing,Staffing);
});
