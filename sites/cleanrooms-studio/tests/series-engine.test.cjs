const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/series-engine.js');

const series = overrides => ({id:'jonas-tue-thu', person:'p0', site:0, start:'07:00', end:'15:00', note:'Fast rul', startDate:'2026-10-27', endDate:'2027-04-27', weekdays:[1,3], ...overrides});
const shift = overrides => ({id:'a', person:'p0', site:0, date:'2026-10-27', start:'07:00', end:'15:00', ...overrides});

test('Tuesday/Thursday repeats through six calendar months, including both endpoints', () => {
  const input = series();
  assert.equal(engine.addMonths(input.startDate, 6), input.endDate);
  const result = engine.enumerate(input);
  assert.equal(result.length, 53);
  assert.deepEqual(result[0], {id:'jonas-tue-thu@2026-10-27', seriesId:input.id, person:'p0', site:0, date:'2026-10-27', start:'07:00', end:'15:00', note:'Fast rul'});
  assert.equal(result.at(-1).date, '2027-04-27');
  assert.ok(result.every(item => [2,4].includes(new Date(item.date + 'T00:00:00Z').getUTCDay())));
});

test('month arithmetic clamps to actual month ends and supports leap years and subtraction', () => {
  assert.equal(engine.addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(engine.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(engine.addMonths('2028-02-29', 12), '2029-02-28');
  assert.equal(engine.addMonths('2027-03-31', -1), '2027-02-28');
  assert.equal(engine.addMonths('2026-10-31', 6), '2027-04-30');
  assert.throws(() => engine.addMonths('2026-02-29', 1), TypeError);
  assert.throws(() => engine.addMonths('2026-10-27', 1.5), TypeError);
});

test('validation rejects empty or invalid weekdays and impossible calendar dates', () => {
  assert.match(engine.validate(series({weekdays:[]})).join(' '), /mindst én ugedag/);
  for (const weekdays of [[7], [-1], [1.5], ['1']]) assert.ok(engine.validate(series({weekdays})).length);
  for (const startDate of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-2-01', 'no-date']) assert.match(engine.validate(series({startDate})).join(' '), /startdato/);
  assert.deepEqual(engine.validate(series({startDate:'2028-02-29',endDate:'2028-02-29'})), []);
  assert.ok(engine.validate(series({startDate:'2027-05-01'})).some(message => message.includes('Slutdatoen')));
});

test('dates are inclusive, Monday is zero, and duplicate weekdays do not duplicate shifts', () => {
  const monday = series({startDate:'2026-10-26', endDate:'2026-10-26', weekdays:[0,0]});
  assert.equal(engine.enumerate(monday).length, 1);
  assert.equal(engine.enumerate({...monday, weekdays:[1]}).length, 0);
  assert.equal(engine.enumerate(series(), {from:'2026-10-29',to:'2026-10-29'})[0].date, '2026-10-29');
  assert.deepEqual(engine.enumerate(series(), {from:'2027-05-01',to:'2027-05-10'}), []);
  assert.throws(() => engine.enumerate(series(), {from:'2026-10-30',to:'2026-10-29'}), RangeError);
  assert.throws(() => engine.enumerate(series(), {from:'2026-02-30'}), TypeError);
});

test('validation requires fields, accepts numeric site zero, and checks distinct sub-24-hour time boundaries', () => {
  assert.deepEqual(engine.validate(series()), []);
  for (const field of ['id','person','site','startDate','endDate','start','end']) assert.ok(engine.validate(series({[field]:''})).length, field);
  for (const times of [{start:'15:00',end:'15:00'},{start:'7:00'},{end:'24:00'},{start:'08:60'}]) assert.ok(engine.validate(series(times)).length);
  assert.deepEqual(engine.validate(series({start:'00:00',end:'23:59'})), []);
});

test('range permits at most 366 inclusive days, and enumeration rejects invalid series', () => {
  const daily = series({startDate:'2028-01-01',endDate:'2028-12-31',weekdays:[0,1,2,3,4,5,6]});
  assert.equal(engine.enumerate(daily).length, 366);
  assert.deepEqual(engine.validate({...daily,endDate:'2029-01-01'}), []);
  assert.equal(engine.enumerate({...daily,endDate:'2029-01-01'},{from:'2029-01-01',to:'2029-01-01'}).length,1);
  assert.throws(()=>engine.enumerate(daily,{from:'2028-01-01',to:'2029-01-01'}),RangeError);
  assert.throws(() => engine.enumerate({...daily,endDate:'2029-01-01'}), RangeError);
  assert.throws(() => engine.enumerate(series({weekdays:[]})), RangeError);
});

test('overlap requires the same assigned person and date, but can cross sites', () => {
  const proposed = shift();
  const existing = [shift({id:'different-person',person:'p1'}), shift({id:'different-date',date:'2026-10-28'}), shift({id:'cross-site',site:2,start:'14:00',end:'16:00'})];
  assert.deepEqual(engine.conflicts([proposed], existing).map(item => [item.other.id,item.type]), [['cross-site','overlap']]);
  assert.deepEqual(engine.conflicts(shift({person:''}), [shift({id:'unassigned',person:''})]), []);
});

test('touching boundaries, self and excluded shifts are clear; containment is a conflict', () => {
  const proposed = shift();
  const existing = [shift(), shift({id:'before',start:'06:00',end:'07:00'}), shift({id:'after',start:'15:00',end:'16:00'}), shift({id:'inside',start:'10:00',end:'11:00'}), shift({id:'excluded'}), shift({id:'contains',start:'06:00',end:'16:00'})];
  assert.deepEqual(engine.conflicts(proposed, existing, ['excluded']).map(item => item.other.id), ['contains','inside']);
});

test('results are deterministic and operations preserve frozen caller data', () => {
  const input = Object.freeze({...series(),weekdays:Object.freeze([3,1])});
  engine.validate(input);
  engine.enumerate(input);
  const proposed = Object.freeze([Object.freeze(shift({id:'later',start:'12:00'})),Object.freeze(shift({id:'first'}))]);
  const existing = Object.freeze([Object.freeze(shift({id:'z'})),Object.freeze(shift({id:'b'}))]);
  const result = engine.conflicts(proposed,existing);
  assert.deepEqual(result.map(item => [item.shift.id,item.other.id]), [['first','b'],['first','z'],['later','b'],['later','z']]);
  assert.equal(proposed[0].id,'later');
  assert.equal(existing[0].id,'z');
  assert.equal(globalThis.CleanRoomsSeries, engine);
});

test('series occurrences retain long rich-description templates exactly without mutating the definition', () => {
  const noteRich=JSON.stringify({version:1,blocks:[
    {type:'paragraph',text:'    ÆØÅ 🧽 – <b>rengør</b> køkkenet\n'.repeat(2000),bold:true},
    {type:'checklist',items:[{id:'lock',text:'Lås døren'}]}
  ]});
  assert.ok(noteRich.length>50000);
  const input=Object.freeze({...series({note:'Rengør køkkenet\nLås døren',noteRich}),weekdays:Object.freeze([1,3])});
  const before=JSON.stringify(input);
  assert.deepEqual(engine.validate(input),[]);
  const shifts=engine.enumerate(input);
  assert.equal(shifts.length,53);
  assert.ok(shifts.every(shift=>shift.noteRich===noteRich&&shift.note===input.note));
  shifts[0].noteRich='';
  assert.equal(shifts[1].noteRich,noteRich);
  assert.equal(JSON.stringify(input),before);
});

test('empty rich metadata remains optional and non-string metadata is rejected', () => {
  for(const noteRich of [undefined,null,'']) {
    const input=series({noteRich});
    assert.deepEqual(engine.validate(input),[]);
    assert.ok(engine.enumerate(input).every(shift=>!Object.hasOwn(shift,'noteRich')));
  }
  for(const noteRich of [{blocks:[]},[],false,42]) {
    assert.match(engine.validate(series({noteRich})).join(' '),/formaterede beskrivelse/);
    assert.throws(()=>engine.enumerate(series({noteRich})),RangeError);
  }
});

test('all-series edits preserve manual overrides and deletions without mutating frozen inputs',()=>{
  const source=Object.freeze(series()),first=engine.enumerate(source)[0],second=engine.enumerate(source)[1];
  const edited=Object.freeze({...first,date:'2026-10-26',person:'person-new',note:'  Undtagelse 🧽\n',noteRich:'literal-rich'});
  const options=Object.freeze({source,replacement:Object.freeze({...source,start:'08:00',end:'16:00'}),scope:'all',edits:Object.freeze({[first.id]:edited,unrelated:Object.freeze({id:'unrelated',date:'2026-11-01'})}),deleted:Object.freeze([second.id])});
  const before=JSON.stringify(options),result=engine.preserveExceptions(options);
  assert.equal(result.preview.count,2);assert.equal(result.preview.edited,1);assert.equal(result.preview.deleted,1);assert.deepEqual(result.edits[first.id],edited);assert.deepEqual(result.deleted,[second.id]);assert.equal(result.edits.unrelated.id,'unrelated');assert.equal(JSON.stringify(options),before);
});

test('future split follows original occurrence anchors even when manual occurrences moved across the cutoff',()=>{
  const source=series(),occurrences=engine.enumerate(source),prior=occurrences[0],future=occurrences[2],cutoff=future.date;
  const edits={[prior.id]:{...prior,date:'2027-03-01'},[future.id]:{...future,date:'2026-10-26',note:'Moved backwards'}};
  const replacement={...source,id:'split-series',startDate:cutoff,start:'09:00',end:'17:00'};
  const result=engine.preserveExceptions({source,replacement,scope:'future',cutoff,edits,deleted:[occurrences[3].id]});
  assert.deepEqual(result.edits[prior.id],edits[prior.id]);assert.equal(result.edits['split-series@'+cutoff].date,'2026-10-26');assert.equal(result.edits['split-series@'+cutoff].seriesId,'split-series');assert.equal(result.edits[future.id],undefined);
  assert.deepEqual(result.deleted,['split-series@'+occurrences[3].date]);assert.deepEqual(result.remappedIds.map(item=>item.from),[future.id,occurrences[3].id]);assert.equal(result.preview.count,2);
});

test('manual occurrences that no longer match the pattern survive as standalone assignments',()=>{
  const source=series(),shift=engine.enumerate(source)[0],edited={...shift,date:'2027-05-10',note:'Keep special visit',noteRich:'format'};
  const result=engine.preserveExceptions({source,replacement:{...source,weekdays:[2]},edits:{[shift.id]:edited},deleted:[]});
  assert.equal(result.edits[shift.id].id,shift.id);assert.equal(result.edits[shift.id].date,'2027-05-10');assert.equal(result.edits[shift.id].noteRich,'format');assert.equal(Object.hasOwn(result.edits[shift.id],'seriesId'),false);assert.deepEqual(result.detachedIds,[shift.id]);
});

test('exception counts are unique, scope checks are strict, and ID collisions fail instead of losing data',()=>{
  const source=series(),shift=engine.enumerate(source)[0];assert.deepEqual(engine.exceptionPreview({source,edits:{[shift.id]:shift},deleted:[shift.id,shift.id]}),{count:1,edited:1,deleted:1,ids:[shift.id]});
  assert.throws(()=>engine.exceptionPreview({source,scope:'future',cutoff:'invalid'}),TypeError);
  assert.throws(()=>engine.exceptionPreview({source,scope:'one'}),TypeError);
  assert.throws(()=>engine.preserveExceptions({source,replacement:{...source,id:'new'},edits:{[shift.id]:shift,['new@'+shift.date]:{...shift,id:'new@'+shift.date}},deleted:[]}),RangeError);
});

test('selected weekdays can use different times while missing overrides retain the legacy fallback and occurrence IDs',()=>{
  const input=series({startDate:'2026-10-26',endDate:'2026-11-08',dayTimes:{'3':{start:'09:00',end:'13:30'}},groupId:'agreement:cleaning-north'});
  assert.deepEqual(engine.validate(input),[]);const shifts=engine.enumerate(input);
  assert.deepEqual(shifts.map(({date,start,end})=>({date,start,end})),[
    {date:'2026-10-27',start:'07:00',end:'15:00'},{date:'2026-10-29',start:'09:00',end:'13:30'},
    {date:'2026-11-03',start:'07:00',end:'15:00'},{date:'2026-11-05',start:'09:00',end:'13:30'}
  ]);assert.equal(shifts[1].id,input.id+'@2026-10-29');assert.equal(shifts[1].seriesId,input.id);assert.equal(Object.hasOwn(shifts[1],'dayTimes'),false);assert.equal(Object.hasOwn(shifts[1],'groupId'),false);
  assert.deepEqual(engine.enumerate({...input,dayTimes:{}}),engine.enumerate({...input,dayTimes:undefined}));
});

test('weekday time overrides strictly validate selected canonical day keys, exact fields and distinct valid clocks',()=>{
  class Times {constructor(){this.start='09:00';this.end='13:00';}}
  for(const dayTimes of [null,[],new Map(),new Date(),{'01':{start:'07:00',end:'15:00'}},{'0':{start:'07:00',end:'15:00'}},{'7':{start:'07:00',end:'15:00'}},{'3':{start:'09:00'}},{'3':{start:'09:00',end:'13:00',extra:true}},{'3':{start:'9:00',end:'13:00'}},{'3':{start:'13:00',end:'13:00'}},{'3':new Times()}]){
    assert.ok(engine.validate(series({dayTimes})).length,String(dayTimes));assert.throws(()=>engine.enumerate(series({dayTimes})),RangeError);
  }
  assert.ok(engine.validate(series({start:'invalid',dayTimes:{'1':{start:'07:00',end:'15:00'},'3':{start:'09:00',end:'13:00'}}})).length,'Legacy fallback remains valid even when every selected day has an override.');
  const map=Object.create(null);map['3']=Object.assign(Object.create(null),{start:'09:00',end:'13:00'});assert.deepEqual(engine.validate(series({dayTimes:map})),[]);
});

test('JSON maps from another JavaScript realm are valid while invalid logical agreement IDs are rejected',()=>{
  const vm=require('node:vm'),dayTimes=vm.runInNewContext("({'3':{start:'09:00',end:'13:00'}})");assert.deepEqual(engine.validate(series({dayTimes})),[]);
  for(const groupId of [null,'',' bad','bad ','with space','ÆØÅ','group/unsafe',12,{},'g'.repeat(161)])assert.ok(engine.validate(series({groupId})).length,JSON.stringify(groupId));
  for(const groupId of [undefined,'group-1','agreement:site_2.2027','g'.repeat(160)])assert.deepEqual(engine.validate(series({groupId})),[]);
});

test('per-day changes preserve exact manual exceptions and frozen template metadata',()=>{
  const dayTimes=Object.freeze({'3':Object.freeze({start:'09:00',end:'13:00'})}),source=Object.freeze({...series({dayTimes,groupId:'agreement'}),weekdays:Object.freeze([1,3])}),first=engine.enumerate(source)[0];
  const edits=Object.freeze({[first.id]:Object.freeze({...first,start:'17:00',end:'19:00',note:'Manual time'})});
  const before=JSON.stringify({source,edits}),replacement={...source,dayTimes:{'1':{start:'08:00',end:'16:00'},'3':{start:'10:00',end:'14:00'}}};
  const result=engine.preserveExceptions({source,replacement,edits,deleted:[]});assert.equal(result.edits[first.id].start,'17:00');assert.equal(result.edits[first.id].end,'19:00');assert.equal(JSON.stringify({source,edits}),before);
});
