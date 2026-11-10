const test = require('node:test');
const assert = require('node:assert/strict');
const Bulk = require('../src/bulk-actions.js');

const shift = (id, overrides = {}) => ({id,person:'p0',date:'2026-10-29',site:0,start:'07:00',end:'15:00',note:'Bevar noten',...overrides});
const options = overrides => {
  const members=[shift('a'),shift('b',{date:'2026-10-30',person:'p1'})];
  return {members,existing:members.map(item=>({...item})),operation:'move',offsetDays:7,minDate:'2026-01-01',maxDate:'2027-12-31',personName:id=>id==='p0'?'Jonas':'Emma',...overrides};
};
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('time edits apply only explicit multi-date members and preserve all metadata',()=>{
  const input=options({operation:'time',start:'08:10',end:'16:10'});input.members[0].seriesId='series';input.members[0].custom='retain';input.existing=input.members.map(item=>({...item}));
  input.existing.push(shift('unselected',{person:'p2'}));
  const result=Bulk.plan(input);assert.equal(result.ok,true);assert.equal(result.changed,true);assert.equal(result.error,null);
  assert.deepEqual(result.proposed,input.members.map(member=>({...member,start:'08:10',end:'16:10'})));
});

test('moves cross week and month boundaries while preserving occurrence IDs and anchors',()=>{
  const member=shift('series@2026-10-29',{seriesId:'series'}),input=options({members:[member],existing:[{...member}],offsetDays:7});
  const result=Bulk.plan(input);assert.equal(result.ok,true);assert.deepEqual(result.proposed,[{...member,date:'2026-11-05'}]);
});

test('copying a series occurrence creates a standalone ID and keeps original metadata',()=>{
  const member=shift('series@2026-10-29',{seriesId:'series',custom:'retain'});
  const result=Bulk.plan(options({members:[member],existing:[{...member}],operation:'copy',copyIds:{[member.id]:'copy-a'}}));
  assert.equal(result.ok,true);assert.equal(result.changed,true);assert.deepEqual(result.proposed,[{id:'copy-a',person:'p0',date:'2026-11-05',site:0,start:'07:00',end:'15:00',note:'Bevar noten',custom:'retain'}]);assert.equal(member.seriesId,'series');
});

test('move excludes all replaced originals but copy still conflicts with selected originals',()=>{
  const members=[shift('a'),shift('b',{date:'2026-10-30'})],input=options({members,existing:members.map(item=>({...item})),offsetDays:1});
  assert.equal(Bulk.plan(input).ok,true);
  const result=Bulk.plan({...input,operation:'copy',copyIds:{a:'copy-a',b:'copy-b'}});assert.equal(result.ok,false);assert.ok(result.issues.some(issue=>issue.id==='a'&&issue.code==='overlap'));assert.match(result.error,/07:00–15:00/);
});

test('all captured fields, including seriesId, block stale multi-selection transactions',()=>{
  for(const [field,value]of Object.entries({id:'changed',person:'p2',date:'2026-10-28',site:1,start:'06:00',end:'14:00',note:'changed',seriesId:'new-series'})){
    const input=options();input.existing[0][field]=value;const result=Bulk.plan(input);assert.equal(result.ok,false,field);assert.ok(result.issues.some(issue=>issue.id==='a'&&issue.code==='stale'),field);
  }
  const input=options();input.existing.pop();assert.equal(Bulk.plan(input).ok,false);
});

test('empty selections, duplicate members and impossible source dates are rejected',()=>{
  assert.equal(Bulk.plan(options({members:[]})).issues[0].code,'empty');
  const input=options();input.members.push({...input.members[0]});assert.ok(Bulk.plan(input).issues.some(issue=>issue.code==='members'));
  const member=shift('a',{date:'2026-02-30'});assert.equal(Bulk.plan(options({members:[member],existing:[member]})).issues[0].code,'date');
});

test('copy IDs must be supplied, unique and absent from source and target schedules',()=>{
  for(const copyIds of [undefined,{a:'same',b:'same'},{a:'a',b:'new-b'},{a:'',b:'new-b'},{a:'hidden',b:'new-b'}]){
    const input=options({operation:'copy',copyIds});input.existing.push(shift('hidden',{person:'p3',date:'2026-11-05'}));const result=Bulk.plan(input);assert.equal(result.ok,false);assert.ok(result.issues.some(issue=>issue.code==='ids'));
  }
});

test('invalid operations, times and equal start and end times cannot be committed',()=>{
  assert.equal(Bulk.plan(options({operation:'delete'})).issues[0].code,'operation');
  for(const times of [{start:'7:00',end:'15:00'},{start:'07:00',end:'24:00'},{start:'15:00',end:'15:00'}])assert.equal(Bulk.plan(options({operation:'time',...times})).issues[0].code,'time');
  const member=shift('a',{start:'7:00'});assert.ok(Bulk.plan(options({members:[member],existing:[member]})).issues.some(issue=>issue.code==='time'));
});

test('null, missing and zero move offsets are valid unchanged no-ops; noninteger offsets fail',()=>{
  for(const offsetDays of [null,undefined,0]){const result=Bulk.plan(options({offsetDays}));assert.equal(result.ok,true);assert.equal(result.changed,false);assert.deepEqual(result.proposed.map(shift=>shift.date),['2026-10-29','2026-10-30']);}
  for(const offsetDays of ['7',0.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(Bulk.plan(options({offsetDays})).issues[0].code,'offset');
});

test('hidden full-schedule conflicts at another site reject the entire selection',()=>{
  const input=options();input.existing.push(shift('hidden',{date:'2026-11-05',site:2,start:'14:00',end:'16:00'}));const result=Bulk.plan(input);assert.equal(result.ok,false);assert.match(result.error,/Jonas.*14:00–16:00/);assert.equal(result.proposed.length,2);
});

test('internal collisions are detected after assigning a shared time across selected shifts',()=>{
  const members=[shift('a',{start:'07:00',end:'10:00'}),shift('b',{start:'10:00',end:'13:00'})];
  const result=Bulk.plan(options({members,existing:members.map(item=>({...item})),operation:'time',start:'08:00',end:'12:00'}));assert.equal(result.ok,false);assert.ok(result.issues.every(issue=>issue.code==='overlap'));assert.match(result.error,/08:00–12:00/);
});

test('approved leave blocks time, move and copy proposals but not unassigned shifts',()=>{
  for(const operation of ['time','move','copy']){
    const input=options({operation,start:'08:00',end:'16:00',copyIds:{a:'copy-a',b:'copy-b'},blockedDates:[{person:'p0',date:operation==='time'?'2026-10-29':'2026-11-05'}]});
    assert.ok(Bulk.plan(input).issues.some(issue=>issue.id==='a'&&issue.code==='leave'));
  }
  const member=shift('open',{person:''});const result=Bulk.plan(options({members:[member],existing:[member],blockedDates:[{person:'',date:'2026-11-05'}]}));assert.equal(result.ok,true);
});

test('date bounds and overflow reject the whole operation while leap day arithmetic works',()=>{
  assert.equal(Bulk.plan(options({offsetDays:1000})).ok,false);assert.equal(Bulk.plan(options({minDate:'bad'})).issues[0].code,'bounds');assert.equal(Bulk.plan(options({offsetDays:Number.MAX_SAFE_INTEGER})).ok,false);
  const member=shift('leap',{date:'2028-02-28'});const result=Bulk.plan(options({members:[member],existing:[member],offsetDays:1,minDate:'2028-01-01',maxDate:'2028-12-31'}));assert.equal(result.ok,true);assert.equal(result.proposed[0].date,'2028-02-29');
});

test('copy offset zero respects originals: assigned conflicts, open copies are allowed',()=>{
  assert.equal(Bulk.plan(options({operation:'copy',offsetDays:0,copyIds:{a:'copy-a',b:'copy-b'}})).ok,false);
  const member=shift('open',{person:''});const result=Bulk.plan(options({members:[member],existing:[member],operation:'copy',offsetDays:0,copyIds:{open:'copy-open'}}));assert.equal(result.ok,true);assert.equal(result.changed,true);assert.equal(result.proposed[0].id,'copy-open');
});

test('touching shifts do not overlap and same time settings can be unchanged',()=>{
  const input=options();input.existing.push(shift('touching',{date:'2026-11-05',start:'15:00',end:'16:00'}));assert.equal(Bulk.plan(input).ok,true);
  const result=Bulk.plan(options({operation:'time',start:'07:00',end:'15:00'}));assert.equal(result.ok,true);assert.equal(result.changed,false);
});

test('allowed and blocked plans never mutate frozen inputs',()=>{
  for(const input of[options(),options({operation:'copy',copyIds:{a:'copy-a',b:'copy-b'}}),options({operation:'time',start:'08:00',end:'16:00'}),options({blockedDates:[{person:'p0',date:'2026-11-05'}]})]){freeze(input);const before=JSON.stringify(input);Bulk.plan(input);assert.equal(JSON.stringify(input),before);}
  assert.equal(globalThis.CleanRoomsBulk,Bulk);
});

test('bulk time, move and standalone copy preserve rich template strings and never change originals',()=>{
  const noteRich=JSON.stringify({version:1,blocks:[{type:'checklist',items:[{id:'alarm',text:'Slå alarmen til ÆØÅ 🧽'}]}]});
  const member=shift('series@2026-10-29',{seriesId:'series',note:'Slå alarmen til ÆØÅ 🧽',noteRich});
  for(const operation of ['time','move','copy']) {
    const input=freeze(options({members:[member],existing:[{...member}],operation,start:'08:00',end:'16:00',copyIds:{[member.id]:'copy-rich'}}));
    const before=JSON.stringify(input),result=Bulk.plan(input);
    assert.equal(result.ok,true,operation);
    assert.equal(result.proposed[0].noteRich,noteRich);
    assert.equal(result.proposed[0].note,member.note);
    assert.equal(result.proposed[0].id,operation==='copy'?'copy-rich':member.id);
    assert.equal(result.proposed[0].seriesId,operation==='copy'?undefined:'series');
    assert.equal(JSON.stringify(input),before);
  }
});

test('formatting-only stale changes block every bulk operation and missing rich values equal empty values',()=>{
  const captured=JSON.stringify({text:'Samme tekst'}),fresh=JSON.stringify({text:'Samme tekst',bold:true});
  for(const operation of ['time','move','copy']) {
    const member=shift('a',{note:'Samme tekst',noteRich:captured});
    const result=Bulk.plan(options({members:[member],existing:[{...member,noteRich:fresh}],operation,start:'08:00',end:'16:00',copyIds:{a:'copy-a'}}));
    assert.equal(result.ok,false,operation); assert.equal(result.issues[0].code,'stale');
  }
  for(const before of [undefined,null,'']) for(const after of [undefined,null,'']) {
    const member=shift('a',{noteRich:before});
    assert.equal(Bulk.plan(options({members:[member],existing:[{...member,noteRich:after}]})).ok,true);
  }
});

test('bulk actions reject non-string rich metadata rather than copying malformed values',()=>{
  for(const noteRich of [{blocks:[]},[],false,42]) {
    const member=shift('a',{noteRich});
    const result=Bulk.plan(options({members:[member],existing:[{...member}],operation:'copy',copyIds:{a:'copy-a'}}));
    assert.equal(result.ok,false); assert.equal(result.issues[0].code,'description');
  }
});
