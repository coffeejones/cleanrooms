const test = require('node:test');
const assert = require('node:assert/strict');
const Coverage = require('../src/coverage-engine.js');

const rule = overrides => ({id:'need',site:0,weekdays:[0],start:'07:00',end:'14:00',required:1,...overrides});
const shift = (id,overrides={}) => ({id,person:id,date:'2026-10-26',site:0,start:'07:00',end:'14:00',note:'',...overrides});
const options = overrides => ({rules:[rule()],from:'2026-10-26',to:'2026-10-26',shifts:[],blockedDates:[],...overrides});
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('five fresh defaults expand to stable weekday and Saturday slots with no Sunday demand',()=>{
  const rules=Coverage.defaultRules();assert.equal(rules.length,5);rules.forEach(item=>assert.deepEqual(Coverage.validateRule(item),[]));
  const result=Coverage.expand({rules,from:'2026-10-26',to:'2026-11-01'});assert.equal(result.valid,true);assert.equal(result.slots.length,16);
  assert.equal(result.slots.filter(slot=>slot.date==='2026-10-28').length,3);assert.ok(result.slots.filter(slot=>slot.date==='2026-10-28').every(slot=>slot.required===7));
  assert.equal(result.slots.filter(slot=>slot.date==='2026-10-31').length,1);assert.equal(result.slots.filter(slot=>slot.date==='2026-11-01').length,0);
  result.slots.forEach(slot=>assert.equal(slot.id,slot.ruleId+'@'+slot.date));
  rules[0].weekdays.push(6);rules[0].required=1;assert.equal(Coverage.defaultRules()[0].required,7);assert.equal(Coverage.defaultRules()[0].weekdays.includes(6),false);
});

test('partial coverage reports the worst gap and exact missing head-minutes',()=>{
  const result=Coverage.coverage(options({rules:[rule({required:3})],shifts:[shift('p0',{end:'10:00'}),shift('p1',{end:'10:00'})]}));
  const slot=result.slots[0];assert.equal(result.valid,true);assert.equal(slot.filled,0);assert.equal(slot.missing,3);assert.equal(slot.covered,false);assert.equal(slot.deficitMinutes,900);
  assert.deepEqual(slot.segments,[{start:'07:00',end:'10:00',covered:2,missing:1,people:['p0','p1']},{start:'10:00',end:'14:00',covered:0,missing:3,people:[]}]);
  assert.deepEqual(result.totals,{requiredMinutes:1260,coveredMinutes:360,deficitMinutes:900,missingSlots:1,slotCount:1});
});

test('adjacent deficits with the same missing count merge even when the people change',()=>{
  const slot=Coverage.coverage(options({rules:[rule({required:2})],shifts:[shift('p0',{end:'10:00'}),shift('p1',{start:'10:00'})]})).slots[0];
  assert.equal(slot.segments.length,2);assert.deepEqual(slot.deficits,[{start:'07:00',end:'14:00',missing:1,filled:1}]);assert.equal(slot.deficitMinutes,420);
});

test('a cross-site overlap removes the person only during that overlapping interval',()=>{
  const slot=Coverage.coverage(options({shifts:[shift('a',{person:'p0'}),shift('b',{person:'p0',site:1,start:'10:00',end:'12:00'})]})).slots[0];
  assert.deepEqual(slot.segments.map(segment=>[segment.start,segment.end,segment.covered]),[['07:00','10:00',1],['10:00','12:00',0],['12:00','14:00',1]]);
  assert.deepEqual(slot.deficits,[{start:'10:00',end:'12:00',missing:1,filled:0}]);assert.equal(slot.deficitMinutes,120);
});

test('same-site duplicate assignments count one unique head, including partially overlapping shifts',()=>{
  const shifts=[shift('a',{person:'p0'}),shift('b',{person:'p0'}),shift('c',{person:'p0',start:'08:00',end:'12:00'})];
  let slot=Coverage.coverage(options({rules:[rule({required:2})],shifts})).slots[0];assert.equal(slot.filled,1);assert.equal(slot.missing,1);assert.ok(slot.segments.every(segment=>segment.people.length===1));
  shifts.push(shift('d',{person:'p1'}));slot=Coverage.coverage(options({rules:[rule({required:2})],shifts})).slots[0];assert.equal(slot.filled,2);assert.equal(slot.covered,true);
});

test('approved leave excludes the whole day and unassigned shifts never count',()=>{
  const result=Coverage.coverage(options({rules:[rule({required:2})],shifts:[shift('a'),shift('b'),shift('open',{person:''})],blockedDates:[{person:'a',date:'2026-10-26'},{person:'b',date:'2026-10-27'}]}));
  assert.equal(result.slots[0].filled,1);assert.deepEqual(result.slots[0].segments[0].people,['b']);assert.equal(result.slots[0].missing,1);
  assert.equal(Coverage.coverage(options({shifts:[shift('open',{person:''})]})).slots[0].filled,0);
});

test('other dates and touching cross-site boundaries do not invalidate eligible heads',()=>{
  const shifts=[shift('a',{person:'p0'}),shift('before',{person:'p0',site:1,start:'06:00',end:'07:00'}),shift('after',{person:'p0',site:1,start:'14:00',end:'16:00'}),shift('other-day',{person:'p0',site:2,date:'2026-10-27'})];
  assert.equal(Coverage.coverage(options({shifts})).slots[0].covered,true);
});

test('coverage surplus is reported as heads but cannot inflate required covered minutes',()=>{
  const result=Coverage.coverage(options({shifts:[shift('a'),shift('b'),shift('c')]}));
  assert.equal(result.slots[0].filled,3);assert.equal(result.slots[0].missing,0);assert.equal(result.totals.coveredMinutes,420);assert.equal(result.totals.requiredMinutes,420);
});

test('minute boundaries remain exact instead of rounding to hours',()=>{
  const slot=Coverage.coverage(options({rules:[rule({start:'07:10',end:'08:25'})],shifts:[shift('a',{start:'07:20',end:'08:00'})]})).slots[0];
  assert.equal(slot.deficitMinutes,35);assert.deepEqual(slot.deficits,[{start:'07:10',end:'07:20',missing:1,filled:0},{start:'08:00',end:'08:25',missing:1,filled:0}]);
});

test('rule validation enforces head limits, valid sites, unique weekdays and same-day times',()=>{
  for(const changes of[{id:''},{site:2000},{site:'0'},{weekdays:[]},{weekdays:[0,0]},{weekdays:[7]},{start:'7:00'},{end:'24:00'},{start:'15:00',end:'07:00'},{required:0},{required:31},{required:1.5}])assert.ok(Coverage.validateRule(rule(changes)).length,JSON.stringify(changes));
});

test('duplicate rule IDs and same-site overlapping demand fail closed while touching rules are allowed',()=>{
  assert.equal(Coverage.expand(options({rules:[rule(),rule({site:1})]})).valid,false);
  assert.equal(Coverage.expand(options({rules:[rule(),rule({id:'other',start:'13:00',end:'16:00'})]})).valid,false);
  assert.equal(Coverage.expand(options({rules:[rule(),rule({id:'other',start:'14:00',end:'16:00'})]})).valid,true);
  assert.equal(Coverage.expand(options({rules:[rule(),rule({id:'other',site:1})]})).valid,true);
  assert.equal(Coverage.expand(options({rules:[rule(),rule({id:'other',weekdays:[1]})]})).valid,true);
});

test('inclusive date expansion supports leap years and caps a request at 366 days',()=>{
  const rules=[rule({weekdays:[0,1,2,3,4,5,6]})];
  assert.equal(Coverage.expand({rules,from:'2028-01-01',to:'2028-12-31'}).slots.length,366);
  for(const dates of[{from:'2028-01-01',to:'2029-01-01'},{from:'2026-02-30',to:'2026-03-02'},{from:'2026-10-27',to:'2026-10-26'}])assert.equal(Coverage.expand({rules,...dates}).valid,false);
});

test('invalid shifts, conflicting duplicate IDs and invalid leave never produce misleading coverage',()=>{
  for(const input of[null,[],42,'bad']){assert.equal(Coverage.expand(input).valid,false);assert.equal(Coverage.coverage(input).valid,false);}
  for(const input of[{shifts:undefined},{shifts:[shift('bad',{date:'2026-02-30'})]},{shifts:[shift('bad',{end:'24:00'})]},{shifts:[shift('bad',{site:2000})]},{shifts:[shift('same'),shift('same',{site:1})]},{blockedDates:[{person:'p0',date:'bad'}]}]){
    const result=Coverage.coverage(options(input));assert.equal(result.valid,false);assert.ok(result.errors.length);assert.deepEqual(result.slots,[]);assert.equal(result.totals.coveredMinutes,0);
  }
});

test('empty demand is valid and an empty assigned schedule reports the entire unmet need',()=>{
  assert.deepEqual(Coverage.coverage(options({rules:[]})).totals,{requiredMinutes:0,coveredMinutes:0,deficitMinutes:0,missingSlots:0,slotCount:0});
  const slot=Coverage.coverage(options()).slots[0];assert.equal(slot.covered,false);assert.equal(slot.missing,1);assert.equal(slot.deficitMinutes,420);assert.deepEqual(slot.deficits,[{start:'07:00',end:'14:00',missing:1,filled:0}]);
});

test('exact duplicate schedule union entries do not double count or mutate frozen caller data',()=>{
  const a=shift('a'),input=options({shifts:[a,{...a}],blockedDates:[]});freeze(input);const before=JSON.stringify(input);
  const result=Coverage.coverage(input);assert.equal(result.valid,true);assert.equal(result.slots[0].filled,1);assert.equal(JSON.stringify(input),before);assert.equal(globalThis.CleanRoomsCoverage,Coverage);
});


test('appended worksites participate in coverage and cross-site conflicts',()=>{
  const report=Coverage.coverage(options({rules:[rule({site:3,required:1})],shifts:[shift('new',{site:3,person:'worker'})]}));
  assert.equal(report.valid,true);assert.equal(report.totals.deficitMinutes,0);
  const conflict=Coverage.coverage(options({rules:[rule({site:3,required:1})],shifts:[shift('new',{site:3,person:'worker'}),shift('other',{site:0,person:'worker'})]}));
  assert.equal(conflict.valid,true);assert.ok(conflict.totals.deficitMinutes>0);
});
