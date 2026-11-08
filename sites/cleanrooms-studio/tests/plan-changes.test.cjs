const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const changes = require('../src/plan-changes.js');

const shift = overrides => ({id:'jonas@2026-10-27', date:'2026-10-27', person:'p0', site:0, start:'07:00', end:'15:00', note:'', ...overrides});
const fields = ['date', 'person', 'site', 'start', 'end', 'note'];
const week = (shifts, from, to) => shifts.filter(item => item.date >= from && item.date <= to);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('first publication compares edits with the seeded plan, not an empty plan', () => {
  const seed = [shift(), shift({id:'emma',person:'p1'})];
  const current = [{...seed[0],start:'08:00',end:'16:00'}, seed[1]];
  assert.deepEqual(changes.diff(seed, current).map(item => ({id:item.id,type:item.type,fields:item.fields})), [
    {id:seed[0].id,type:'changed',fields:['start','end']}
  ]);
  assert.deepEqual(changes.diff(seed, seed), []);
});

test('a cross-week move is removed from the source week and added to its destination', () => {
  const baseline = [shift({id:'jonas-plan@2026-11-01',date:'2026-11-01',seriesId:'jonas-plan'})];
  const current = [{...baseline[0],date:'2026-11-02'}];
  const source = changes.diff(week(baseline,'2026-10-26','2026-11-01'), week(current,'2026-10-26','2026-11-01'));
  const destination = changes.diff(week(baseline,'2026-11-02','2026-11-08'), week(current,'2026-11-02','2026-11-08'));
  assert.equal(source[0].type, 'removed');
  assert.equal(source[0].before.id, baseline[0].id);
  assert.equal(source[0].after, null);
  assert.equal(destination[0].type, 'added');
  assert.equal(destination[0].after.id, baseline[0].id);
  assert.equal(destination[0].before, null);
  assert.deepEqual(changes.diff(baseline, current)[0].fields, ['date']);
});

test('added and removed shifts retain complete records and list every relevant field', () => {
  const removed = shift({id:'removed',note:'Nøgle hos receptionen'});
  const added = shift({id:'added',person:'',site:'2',start:'08:00',end:'12:00'});
  const entries = changes.diff([removed], [added]);
  assert.deepEqual(entries, [
    {id:'removed',type:'removed',before:removed,after:null,fields},
    {id:'added',type:'added',before:null,after:added,fields}
  ]);
  assert.notStrictEqual(entries[0].before, removed);
  assert.notStrictEqual(entries[1].after, added);
});

test('cancelling a change, an addition or a deletion returns to the baseline', () => {
  const baseline = [shift()];
  assert.equal(changes.diff(baseline, [{...baseline[0],site:2}]).length, 1);
  assert.equal(changes.diff(baseline, []).length, 1);
  assert.equal(changes.diff(baseline, [...baseline,shift({id:'temporary'})]).length, 1);
  assert.deepEqual(changes.diff(baseline, [{...baseline[0]}]), []);
  assert.deepEqual(changes.diff([], []), []);
});

test('note comparison treats missing and null notes as empty but preserves real text', () => {
  const before = shift(); delete before.note;
  assert.deepEqual(changes.diff([before], [shift({note:null})]), []);
  const changed = changes.diff([before], [shift({note:'Lås bagdøren'})])[0];
  assert.deepEqual(changed.fields, ['note']);
  assert.equal(Object.hasOwn(changed.before, 'note'), false);
  assert.equal(changed.after.note, 'Lås bagdøren');
  assert.deepEqual(changes.diff([shift({note:'a'})], [shift({note:'a '})])[0].fields, ['note']);
});

test('formatting-only edits compare exact rich strings without rewriting plaintext or caller snapshots', () => {
  const note='Rengør køkkenet\nLås døren',noteRich=JSON.stringify({text:note,bold:false}),updatedRich=JSON.stringify({text:note,bold:true});
  const before=freeze([shift({note,noteRich})]),current=freeze([shift({note,noteRich:updatedRich})]);
  const original=JSON.stringify([before,current]),entries=changes.diff(before,current);
  assert.equal(entries.length,1); assert.equal(entries[0].type,'changed');
  assert.deepEqual(entries[0].fields,['noteRich']);
  assert.equal(entries[0].before.noteRich,noteRich); assert.equal(entries[0].after.noteRich,updatedRich);
  assert.equal(entries[0].before.note,note); assert.equal(entries[0].after.note,note);
  entries[0].after.noteRich='';
  assert.equal(JSON.stringify([before,current]),original);
});

test('empty rich values are equivalent and preserve legacy fields, while rich additions and removals include metadata', () => {
  for(const before of [undefined,null,'']) for(const after of [undefined,null,'']) {
    assert.deepEqual(changes.diff([shift({noteRich:before})],[shift({noteRich:after})]),[]);
  }
  for(const noteRich of [undefined,null,'']) {
    assert.deepEqual(changes.diff([],[shift({noteRich})])[0].fields,fields);
    assert.deepEqual(changes.diff([shift({noteRich})],[])[0].fields,fields);
  }
  const noteRich=JSON.stringify({text:'Beskrivelse',bold:true});
  const removed=shift({id:'removed',note:'Beskrivelse',noteRich}),added=shift({id:'added',note:'Beskrivelse',noteRich});
  const entries=changes.diff([removed],[added]);
  assert.ok(entries.every(entry=>entry.fields.at(-1)==='noteRich'));
  assert.equal(entries.find(entry=>entry.type==='removed').before.noteRich,noteRich);
  assert.equal(entries.find(entry=>entry.type==='added').after.noteRich,noteRich);
  assert.deepEqual(changes.diff([removed],[{...removed,noteRich:''}])[0].fields,['noteRich']);
});

test('malformed non-string rich metadata cannot silently enter publication history', () => {
  for(const noteRich of [{blocks:[]},[],false,42]) {
    assert.throws(()=>changes.diff([shift({noteRich})],[]),TypeError);
    assert.throws(()=>changes.diff([],[shift({noteRich})]),TypeError);
  }
});

test('numeric site strings compare as numbers without rewriting preview values', () => {
  assert.deepEqual(changes.diff([shift({site:0})], [shift({site:'0'})]), []);
  assert.deepEqual(changes.diff([shift({site:2})], [shift({site:' 2 '})]), []);
  const changed = changes.diff([shift({site:'0'})], [shift({site:2})])[0];
  assert.deepEqual(changed.fields, ['site']);
  assert.equal(changed.before.site, '0');
  assert.equal(changed.after.site, 2);
  for (const site of ['',null,undefined]) assert.deepEqual(changes.diff([shift({site})], [shift({site:0})])[0].fields, ['site']);
});

test('series occurrence anchor IDs identify moved or detached occurrences', () => {
  const before = shift({id:'series@2026-10-27',seriesId:'series',generated:true});
  const next = {...before,date:'2026-10-28',seriesId:'different-series',generated:false,updatedAt:'2026-10-29T12:00:00Z'};
  const entries = changes.diff([before], [next]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, before.id);
  assert.equal(entries[0].type, 'changed');
  assert.deepEqual(entries[0].fields, ['date']);
  assert.deepEqual(changes.diff([before], [{...before,seriesId:'different-series',generated:false}]), []);
});

test('field order stays fixed and unrelated metadata is ignored', () => {
  const before = shift({metadata:{source:'seed'}});
  const after = shift({date:'2026-10-28',person:'p2',site:2,start:'08:00',end:'16:00',note:'Ny note',metadata:{source:'edited'}});
  assert.deepEqual(changes.diff([before], [after])[0].fields, fields);
  assert.deepEqual(changes.diff([before], [{...before,metadata:{source:'edited'},published:true}]), []);
});

test('order is date, effective start and stable ID regardless of input order', () => {
  const before = [shift({id:'z',date:'2026-10-28'}), shift({id:'removed',date:'2026-10-26'})];
  const current = [shift({id:'z',date:'2026-10-29'}), shift({id:'b',start:'08:00'}), shift({id:'a',start:'08:00'}), shift({id:'early',start:'06:00'})];
  const expected = ['removed','early','a','b','z'];
  assert.deepEqual(changes.diff(before, current).map(item => item.id), expected);
  assert.deepEqual(changes.diff([...before].reverse(), [...current].reverse()).map(item => item.id), expected);
});

test('frozen inputs remain untouched and returned records do not share nested metadata', () => {
  const before = freeze([shift({metadata:{tags:['seed'],details:{key:'original'}}})]);
  const current = freeze([{...before[0],note:'Changed',metadata:{tags:['current'],details:{key:'current'}}}]);
  const entries = changes.diff(before, current);
  entries[0].before.metadata.tags.push('preview');
  entries[0].after.metadata.details.key = 'preview';
  entries[0].fields.push('preview');
  assert.deepEqual(before[0].metadata.tags, ['seed']);
  assert.equal(current[0].metadata.details.key, 'current');
  assert.deepEqual(changes.diff(before, current)[0].fields, ['note']);
});

test('duplicate or missing identities cannot silently discard shifts', () => {
  assert.throws(() => changes.diff([shift(),shift()], []), TypeError);
  assert.throws(() => changes.diff([], [shift({id:''})]), TypeError);
  assert.throws(() => changes.diff(null, []), TypeError);
});

test('the same module exports a browser global without CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../src/plan-changes.js'), 'utf8'), context);
  assert.equal(typeof context.CleanRoomsChanges.diff, 'function');
  assert.equal(context.CleanRoomsChanges.diff([], []).length, 0);
  assert.equal(globalThis.CleanRoomsChanges, changes);
});
