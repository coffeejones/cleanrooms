const test = require('node:test');
const assert = require('node:assert/strict');
const Actions = require('../src/schedule-actions.js');

const shift = (id, overrides = {}) => ({id, person:id, date:'2026-10-29', site:0, start:'07:00', end:'15:00', note:'Nøgle i receptionen', ...overrides});
const group = overrides => {
  const members = [shift('p0'), shift('p1')];
  return {members, existing:members.map(item => ({...item})), start:'08:00', end:'16:00', personName:id => id === 'p0' ? 'Jonas' : 'Emma', ...overrides};
};
const move = overrides => {
  const current = shift('p0');
  return {shift:{...current}, current, targetDate:'2026-10-30', existing:[], minDate:'2026-01-01', maxDate:'2027-12-31', personName:() => 'Jonas', ...overrides};
};
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('calendar validation rejects rollover, malformed and impossible dates', () => {
  for (const value of ['2026-02-29','2026-04-31','2026-13-01','2026-2-01','0000-01-01','date',null]) assert.equal(Actions.validDate(value),false,String(value));
  for (const value of ['2028-02-29','2026-10-29','0001-01-01']) assert.equal(Actions.validDate(value),true);
});

test('valid bulk plan preserves every field and changes exactly explicit members', () => {
  const options=group(); options.members[0].seriesId='jonas-plan'; options.members[0].custom={training:'A'};
  options.existing=options.members.map(item=>({...item}));
  const differentEnd=shift('p2',{end:'14:00'}); options.existing.push(differentEnd);
  const result=Actions.planGroup(options);
  assert.equal(result.ok,true); assert.equal(result.changed,true); assert.equal(result.error,null);
  assert.deepEqual(result.proposed.map(item=>item.id),['p0','p1']);
  result.proposed.forEach((item,index)=>assert.deepEqual(item,{...options.members[index],start:'08:00',end:'16:00'}));
  assert.equal(differentEnd.end,'14:00'); assert.equal(result.proposed[0].seriesId,'jonas-plan');
});

test('same times produce a valid unchanged plan', () => {
  const result=Actions.planGroup(group({start:'07:00',end:'15:00'}));
  assert.equal(result.ok,true); assert.equal(result.changed,false); assert.equal(result.proposed.length,2);
});

test('empty and invalid bulk times never create a committable plan', () => {
  assert.equal(Actions.planGroup(group({members:[]})).issues[0].code,'empty');
  for (const times of [{start:''},{start:'7:00'},{end:'24:00'},{start:'15:00',end:'15:00'}]) {
    const result=Actions.planGroup(group(times)); assert.equal(result.ok,false); assert.equal(result.issues[0].code,'time'); assert.ok(result.error);
  }
});

test('all snapshot fields detect stale or missing members and block the whole group', () => {
  for (const [field,value] of Object.entries({id:'renamed',date:'2026-10-30',person:'different',site:2,start:'06:00',end:'14:00',note:'Ny note'})) {
    const options=group(); options.existing[0][field]=value;
    const result=Actions.planGroup(options); assert.equal(result.ok,false,field); assert.ok(result.issues.some(issue=>issue.id==='p0'&&issue.code==='stale'),field);
  }
  const options=group(); options.existing.pop(); assert.equal(Actions.planGroup(options).ok,false);
});

test('empty notes normalize and duplicate or invalid-date members cannot be skipped silently', () => {
  const member=shift('p0',{note:undefined}); assert.equal(Actions.planGroup(group({members:[member],existing:[{...member,note:''}]})).ok,true);
  const options=group(); options.members.push({...options.members[0]}); assert.equal(Actions.planGroup(options).issues[0].code,'members');
  assert.equal(Actions.planGroup(group({members:[shift('p0',{date:'2026-02-30'})]})).issues[0].code,'date');
});

test('unfiltered existing conflict blocks all members and names the conflicting time', () => {
  const options=group(); options.existing.push(shift('hidden',{person:'p0',site:2,start:'15:30',end:'17:00'}));
  const result=Actions.planGroup(options); assert.equal(result.ok,false);
  assert.ok(result.issues.some(issue=>issue.id==='p0'&&issue.code==='overlap'));
  assert.match(result.error,/Jonas/); assert.match(result.error,/15:30–17:00/);
});

test('replaced IDs are excluded externally but internal same-person overlaps remain blocked', () => {
  const members=[shift('a',{person:'p0'}),shift('b',{person:'p0'})];
  const result=Actions.planGroup(group({members,existing:members.map(item=>({...item}))}));
  assert.equal(result.ok,false); assert.ok(result.issues.some(issue=>issue.code==='overlap')); assert.match(result.error,/08:00–16:00/);
});

test('approved leave blocks assigned members while open shifts remain allowed', () => {
  const blockedDates=[{person:'p0',date:'2026-10-29'}];
  const result=Actions.planGroup(group({blockedDates})); assert.equal(result.ok,false); assert.equal(result.issues[0].code,'leave');
  const member=shift('open',{person:''});
  assert.equal(Actions.planGroup(group({members:[member],existing:[{...member},shift('other-open',{person:''})],blockedDates:[{person:'',date:member.date}]})).ok,true);
});

test('a series move preserves anchor ID and all metadata, changing only actual date', () => {
  const current=shift('jonas-plan@2026-10-29',{person:'p0',seriesId:'jonas-plan',custom:'retain'});
  const result=Actions.planMove(move({shift:{...current},current}));
  assert.equal(result.allowed,true); assert.equal(result.status,'allowed');
  assert.deepEqual(result.proposed,{...current,date:'2026-10-30'});
});

test('same-day moves are neutral no-ops, and stale sources cannot be moved', () => {
  const same=Actions.planMove(move({targetDate:'2026-10-29'})); assert.equal(same.allowed,false); assert.equal(same.status,'same'); assert.equal(same.proposed,null);
  assert.equal(Actions.planMove(move({current:undefined})).status,'blocked');
  const options=move(); options.current.note='Changed'; assert.equal(Actions.planMove(options).status,'blocked');
});

test('move validation rejects exact-date errors, bounds and approved leave', () => {
  for (const targetDate of ['2026-02-30','2025-12-31','2028-01-01']) assert.equal(Actions.planMove(move({targetDate})).status,'blocked');
  assert.equal(Actions.planMove(move({minDate:'bad'})).status,'blocked');
  const result=Actions.planMove(move({blockedDates:[{person:'p0',date:'2026-10-30'}]})); assert.equal(result.status,'blocked'); assert.match(result.reason,/Jonas.*fravær/);
});

test('target-day conflicts block moves while touching boundaries and other employees allow them', () => {
  const existing=[shift('hidden',{person:'p0',date:'2026-10-30',site:2,start:'14:00',end:'16:00'})];
  const blocked=Actions.planMove(move({existing})); assert.equal(blocked.status,'blocked'); assert.match(blocked.reason,/14:00–16:00/);
  existing[0].start='15:00'; assert.equal(Actions.planMove(move({existing})).allowed,true);
  existing[0].start='14:00'; existing[0].person='p1'; assert.equal(Actions.planMove(move({existing})).allowed,true);
  const current=shift('open',{person:''}); assert.equal(Actions.planMove(move({shift:{...current},current,existing:[shift('other',{person:'',date:'2026-10-30'})]})).allowed,true);
});

test('planners preserve frozen inputs on allowed and blocked outcomes', () => {
  const groupOptions=freeze(group()),groupBefore=JSON.stringify(groupOptions); Actions.planGroup(groupOptions); assert.equal(JSON.stringify(groupOptions),groupBefore);
  const moveOptions=freeze(move()),moveBefore=JSON.stringify(moveOptions); Actions.planMove(moveOptions); assert.equal(JSON.stringify(moveOptions),moveBefore);
  const blocked=move({existing:[shift('overlap',{person:'p0',date:'2026-10-30'})]}); freeze(blocked); const before=JSON.stringify(blocked); assert.equal(Actions.planMove(blocked).allowed,false); assert.equal(JSON.stringify(blocked),before);
  assert.equal(globalThis.CleanRoomsActions,Actions);
});

test('group edits and series moves preserve rich checklist templates without mutating captured inputs', () => {
  const noteRich=JSON.stringify({version:1,blocks:[{type:'checklist',items:[{id:'lock',text:'Lås døren 🧽'}]}]});
  const member=shift('series@2026-10-29',{person:'p0',seriesId:'series',note:'Lås døren 🧽',noteRich});
  const grouped=freeze(group({members:[member],existing:[{...member}]}));
  const moving=freeze(move({shift:{...member},current:{...member}}));
  const before=[JSON.stringify(grouped),JSON.stringify(moving)];
  const groupResult=Actions.planGroup(grouped),moveResult=Actions.planMove(moving);
  assert.equal(groupResult.ok,true); assert.equal(moveResult.allowed,true);
  assert.deepEqual(groupResult.proposed,[{...member,start:'08:00',end:'16:00'}]);
  assert.deepEqual(moveResult.proposed,{...member,date:'2026-10-30'});
  assert.deepEqual([JSON.stringify(grouped),JSON.stringify(moving)],before);
});

test('formatting-only changes invalidate captured groups and moves while empty rich values normalize', () => {
  const plain=JSON.stringify({text:'Samme tekst'}),bold=JSON.stringify({text:'Samme tekst',bold:true});
  const member=shift('p0',{note:'Samme tekst',noteRich:plain}),current={...member,noteRich:bold};
  const stale=Actions.planGroup(group({members:[member],existing:[current]}));
  assert.equal(stale.ok,false); assert.equal(stale.issues[0].code,'stale');
  assert.equal(Actions.planMove(move({shift:member,current})).status,'blocked');
  for(const captured of [undefined,null,'']) for(const fresh of [undefined,null,'']) {
    const shiftBefore=shift('p0',{noteRich:captured}),shiftNow={...shiftBefore,noteRich:fresh};
    assert.equal(Actions.planGroup(group({members:[shiftBefore],existing:[shiftNow]})).ok,true);
    assert.equal(Actions.planMove(move({shift:shiftBefore,current:shiftNow})).allowed,true);
  }
});

test('non-string rich metadata cannot become a group edit or move proposal', () => {
  for(const noteRich of [{blocks:[]},[],false,42]) {
    const member=shift('p0',{noteRich});
    const grouped=Actions.planGroup(group({members:[member],existing:[{...member}]}));
    assert.equal(grouped.ok,false); assert.equal(grouped.issues[0].code,'description');
    assert.equal(Actions.planMove(move({shift:member,current:{...member}})).status,'blocked');
  }
});
