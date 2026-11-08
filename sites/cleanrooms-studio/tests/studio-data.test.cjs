const test=require('node:test');
const assert=require('node:assert/strict');
const Data=require('../src/studio-data.js');

test('Copenhagen today and Monday anchor follow local midnight, year changes and daylight-saving boundaries',()=>{
  for(const [instant,today,anchor] of [
    ['2027-01-03T23:30:00Z','2027-01-04','2027-01-04'],
    ['2027-01-03T22:30:00Z','2027-01-03','2026-12-28'],
    ['2028-02-29T12:00:00Z','2028-02-29','2028-02-28'],
    ['2027-03-28T22:30:00Z','2027-03-29','2027-03-29'],
    ['2027-10-31T23:30:00Z','2027-11-01','2027-11-01']
  ]){assert.equal(Data.todayFor(new Date(instant)),today);assert.equal(Data.anchorFor(new Date(instant)),anchor);}
  assert.throws(()=>Data.todayFor('not-a-date'),TypeError);
  assert.equal(Data.minDate,'2000-01-01');assert.equal(Data.maxDate,'2100-12-31');
  assert.equal(Data.today,Data.todayFor());assert.equal(Data.anchor,Data.anchorFor());
});

test('explicit rosters include archived history and intentional emptiness without silently falling back',()=>{
  const roster=Object.freeze([Object.freeze({...Data.staff[0],active:false})]);assert.equal(Data.staffFor({roster}),roster);assert.equal(Data.staffFor({}),Data.staff);assert.deepEqual(Data.staffFor({roster:[]}),[]);
  for(const roster of [null,{},''])assert.throws(()=>Data.staffFor({roster}),TypeError);
});

test('legacy demo seeding follows stable identities and preserves archived assignments without inventing new employees shifts',()=>{
  const roster=[{id:'person-new',name:'New employee',site:0,active:true},{...Data.staff[2],site:0},{...Data.staff[1],active:false}];
  const shifts=Data.seededShifts('2035-01-01','2035-01-01',{roster});assert.equal(shifts.length,2);assert.equal(shifts[0].person,'p2');assert.equal(shifts[0].site,0);assert.equal(shifts[0].start,'07:00');assert.equal(shifts[1].person,'p1');
  assert.deepEqual(Data.seededShifts('2035-01-03','2035-01-03',{roster:[roster[0]]}),[]);
  assert.deepEqual(Data.seededShifts('2035-01-01','2035-01-07',{demoSeed:false}),[]);
  assert.deepEqual(Data.seededShifts('2035-01-01','2035-01-07',{roster:[]}),[]);
});

test('production mode expands only explicit plans, preserving archived assignments, moved series anchors and rich descriptions',()=>{
  const day='2042-04-01',series={id:'future-series',person:'person-new',site:2,startDate:day,endDate:day,weekdays:[1],start:'07:00',end:'14:00',note:'Future',noteRich:'{"type":"doc"}'};
  const id=series.id+'@'+day,edit={id,seriesId:series.id,person:series.person,site:2,date:'2042-04-02',start:'08:00',end:'15:00',note:'Moved',noteRich:'literal-rich'};
  const data=Object.freeze({demoSeed:false,roster:Object.freeze([{id:series.person,active:false}]),series:Object.freeze([Object.freeze(series)]),edits:Object.freeze({[id]:Object.freeze(edit)}),deleted:Object.freeze([])});
  assert.deepEqual(Data.shiftsInRange(day,day,data),[]);assert.deepEqual(Data.shiftsInRange(edit.date,edit.date,data),[edit]);assert.deepEqual(Data.shiftById(id,data),edit);
  assert.deepEqual(Data.shiftsInRange(day,edit.date,{...data,deleted:[id]}),[]);
});

test('range expansion stays bounded even with century-wide supported navigation dates',()=>{
  assert.throws(()=>Data.shiftsInRange(Data.minDate,Data.maxDate,{demoSeed:false}),RangeError);
  assert.throws(()=>Data.seededShifts('2030-01-01','2031-01-02'),RangeError);
  assert.throws(()=>Data.shiftsInRange('2030-02-30','2030-03-01'),RangeError);
  assert.deepEqual(Data.shiftsInRange('2099-12-31','2100-01-01',{demoSeed:false}),[]);
});
