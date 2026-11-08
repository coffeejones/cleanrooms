const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Calendar = require('../src/employee-calendar.js');

const shift = (id,start,end,extra={}) => ({id,date:'2026-10-27',person:'p0',site:0,start,end,note:'Bevar instruktionen',...extra});
const freeze = value => { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };

test('exact dates and caller bounds reject rollover and malformed values without timezone assumptions',()=>{
  for(const value of ['0001-01-01','9999-12-31','2028-02-29','2026-10-30']) assert.equal(Calendar.validDate(value),true);
  for(const value of [null,undefined,'0000-01-01','2026-02-29','2026-04-31','2026-2-01','2026-13-01','10000-01-01','date']) assert.equal(Calendar.validDate(value),false);
  assert.equal(Calendar.clamp('2026-10-01','2026-10-26','2027-10-31'),'2026-10-26');
  assert.equal(Calendar.clamp('2027-11-01','2026-10-26','2027-10-31'),'2027-10-31');
  assert.equal(Calendar.clamp('2026-10-30','2026-10-26','2027-10-31'),'2026-10-30');
  assert.throws(()=>Calendar.clamp('2026-02-30'),TypeError);
  assert.throws(()=>Calendar.clamp('2026-10-30','2027-01-01','2026-01-01'),RangeError);
});

test('month grids contain every complete Monday-first week and all actual dates, with28/35/42 cells',()=>{
  for(const [focus,from,to,count] of [
    ['2027-02-14','2027-02-01','2027-02-28',28],
    ['2026-10-30','2026-09-28','2026-11-01',35],
    ['2026-08-31','2026-07-27','2026-09-06',42],
    ['2028-02-29','2028-01-31','2028-03-05',35]
  ]) {
    const result=Calendar.range('month',focus);
    assert.equal(result.from,from);assert.equal(result.to,to);assert.equal(result.days.length,count);assert.equal(result.weeks,count/7);
    assert.equal(new Date(from+'T12:00:00Z').getUTCDay(),1);
    assert.equal(new Date(to+'T12:00:00Z').getUTCDay(),0);
    assert.equal(new Set(result.days).size,count);
    assert.equal(result.periodFrom,focus.slice(0,7)+'-01');
    assert.ok(result.days.includes(result.periodFrom)&&result.days.includes(result.periodTo));
    assert.ok(result.days.every(Calendar.validDate));
  }
  const leap=Calendar.range('month','2028-02-29');assert.equal(leap.periodTo,'2028-02-29');
  assert.equal(leap.days.filter(day=>day==='2028-02-29').length,1);
});

test('week and day ranges cross years and daylight-saving boundaries using inclusive calendar days',()=>{
  const week=Calendar.range('week','2027-01-01');
  assert.equal(week.from,'2026-12-28');assert.equal(week.to,'2027-01-03');assert.equal(week.days.length,7);
  assert.equal(week.periodFrom,week.from);assert.equal(week.periodTo,week.to);
  assert.deepEqual(week.isoWeek,{year:2026,week:53});
  const dst=Calendar.range('week','2027-03-28');
  assert.deepEqual(dst.days,['2027-03-22','2027-03-23','2027-03-24','2027-03-25','2027-03-26','2027-03-27','2027-03-28']);
  const day=Calendar.range('day','2028-02-29');
  assert.deepEqual(day.days,['2028-02-29']);assert.equal(day.from,day.to);assert.equal(day.weeks,1);
});

test('ISO week numbers retain the week year independently of the calendar year',()=>{
  for(const [date,year,week] of [['2020-12-31',2020,53],['2021-01-01',2020,53],['2021-01-04',2021,1],['2014-12-29',2015,1],['2026-10-30',2026,44]]) {
    assert.deepEqual(Calendar.isoWeek(date),{year,week});
  }
});

test('month navigation clamps month ends and leap years while week/day navigation keeps exact offsets',()=>{
  for(const [focus,delta,expected] of [
    ['2027-01-31',1,'2027-02-28'],['2028-01-31',1,'2028-02-29'],
    ['2027-03-31',-1,'2027-02-28'],['2028-02-29',12,'2029-02-28'],
    ['2026-12-31',1,'2027-01-31'],['2026-10-31',0,'2026-10-31']
  ]) assert.equal(Calendar.navigate('month',focus,delta),expected);
  assert.equal(Calendar.navigate('week','2026-12-29',1),'2027-01-05');
  assert.equal(Calendar.navigate('day','2027-03-28',1),'2027-03-29');
  assert.equal(Calendar.navigate('day','2028-03-01',-1),'2028-02-29');
  assert.equal(Calendar.navigate('day',Calendar.MIN_DATE,-1),Calendar.MIN_DATE);
  assert.equal(Calendar.navigate('week',Calendar.MAX_DATE,1),Calendar.MAX_DATE);
  assert.equal(Calendar.navigate('month',Calendar.MIN_DATE,-1),Calendar.MIN_DATE);
  assert.equal(Calendar.navigate('month',Calendar.MAX_DATE,1),Calendar.MAX_DATE);
});

test('bounded navigation reaches partial boundary periods once and disables repeated navigation within them',()=>{
  const min='2026-10-26',max='2026-12-10';
  assert.equal(Calendar.canNavigate('month','2026-10-30',-1,min,max),false);
  assert.equal(Calendar.canNavigate('month','2026-10-30',1,min,max),true);
  assert.equal(Calendar.canNavigate('month','2026-11-30',1,min,max),true);
  assert.equal(Calendar.clamp(Calendar.navigate('month','2026-11-30',1),min,max),'2026-12-10');
  assert.equal(Calendar.canNavigate('month','2026-12-08',1,min,max),false);
  assert.equal(Calendar.canNavigate('week',min,-1,min,max),false);
  assert.equal(Calendar.canNavigate('week','2026-12-07',1,min,max),false);
  assert.equal(Calendar.canNavigate('day',max,1,min,max),false);
  assert.equal(Calendar.canNavigate('day',min,1,min,max),true);
  assert.equal(Calendar.canNavigate('day',min,0,min,max),false);
});

test('invalid views, dates, period offsets and unrepresentable full weeks fail explicitly',()=>{
  for(const view of ['list','',null]) assert.throws(()=>Calendar.range(view,'2026-10-30'),TypeError);
  assert.throws(()=>Calendar.range('month','2026-02-30'),TypeError);
  for(const delta of [1.5,'1',Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>Calendar.navigate('month','2026-10-30',delta),TypeError);
  assert.throws(()=>Calendar.range('month',Calendar.MAX_DATE),RangeError);
  assert.throws(()=>Calendar.range('week',Calendar.MAX_DATE),RangeError);
});

test('overlapping shifts receive distinct reusable lanes and independent clusters regain full width',()=>{
  const shifts=[shift('a','07:00','10:00'),shift('b','08:00','09:00'),shift('c','08:30','11:00'),shift('reuse','09:00','10:30'),shift('after','11:00','12:00')];
  const result=Calendar.layout(shifts,'2026-10-27');assert.equal(result.valid,true);assert.equal(result.items.length,5);
  assert.deepEqual(result.items.map(item=>[item.id,item.lane,item.laneCount]),[['a',0,3],['b',1,3],['c',2,3],['reuse',1,3],['after',0,1]]);
  for(const item of result.items.slice(0,4)) { assert.equal(item.width,1/3);assert.equal(item.left,item.lane/3); }
  assert.equal(result.items.at(-1).width,1);
  for(let i=0;i<result.items.length;i++) for(let j=i+1;j<result.items.length;j++) {
    const a=result.items[i],b=result.items[j];
    if(a.startMinute<b.endMinute&&b.startMinute<a.endMinute) assert.notEqual(a.lane,b.lane);
  }
});

test('touching boundaries share full-width lanes and same-start containment stays deterministic',()=>{
  const touching=Calendar.layout([shift('a','07:00','08:00'),shift('b','08:00','09:00')],'2026-10-27');
  assert.ok(touching.items.every(item=>item.lane===0&&item.laneCount===1&&item.width===1));
  const shifts=[shift('short','07:00','08:00'),shift('long','07:00','12:00')];
  const forward=Calendar.layout(shifts,'2026-10-27'),backward=Calendar.layout([...shifts].reverse(),'2026-10-27');
  assert.deepEqual(forward.items.map(item=>[item.id,item.lane]),[['long',0],['short',1]]);
  assert.deepEqual(backward.items,forward.items);
});

test('all supplied dates share expanded hour bounds while placement retains exact minute durations',()=>{
  const shifts=[shift('early','00:30','01:10'),shift('late','21:30','23:59',{date:'2026-10-28'}),shift('precise','07:15','07:45')];
  const first=Calendar.layout(shifts,'2026-10-27'),next=Calendar.layout(shifts,'2026-10-28'),empty=Calendar.layout(shifts,'2026-10-29');
  for(const result of [first,next,empty]) { assert.equal(result.startMinute,0);assert.equal(result.endMinute,1440);assert.equal(result.totalMinutes,1440); }
  assert.equal(first.items.length,2);assert.equal(next.items.length,1);assert.equal(empty.items.length,0);
  const precise=first.items.find(item=>item.id==='precise');
  assert.equal(precise.startMinute,435);assert.equal(precise.endMinute,465);assert.equal(precise.durationMinutes,30);
  assert.equal(precise.top,435/1440);assert.equal(precise.height,30/1440);
  const fallback=Calendar.layout([],'2026-10-27');
  assert.equal(fallback.startMinute,360);assert.equal(fallback.endMinute,1320);assert.equal(fallback.valid,true);
});

test('invalid times, dates and duplicate identities cannot silently hide part of a day',()=>{
  const good=shift('valid','07:00','15:00');
  for(const bad of [null,shift('','07:00','15:00'),shift('bad','7:00','15:00'),shift('bad','15:00','07:00'),shift('bad','15:00','15:00'),shift('bad','07:00','24:00'),shift('bad','07:00','15:00',{date:'2026-02-30'}),{...good}]) {
    const result=Calendar.layout([good,bad],'2026-10-27');
    assert.equal(result.valid,false);assert.ok(result.errors.length);assert.deepEqual(result.items,[]);
  }
  assert.equal(Calendar.layout(null,'2026-10-27').valid,false);
  assert.equal(Calendar.layout([],'not-a-date').valid,false);
});

test('layout preserves frozen caller metadata and input order and exports a browser API without dependencies',()=>{
  const shifts=freeze([shift('later','10:00','12:00',{noteRich:'{"type":"doc"}',seriesId:'series'}),shift('earlier','07:00','09:00')]),before=JSON.stringify(shifts);
  const result=Calendar.layout(shifts,'2026-10-27');
  assert.equal(JSON.stringify(shifts),before);assert.equal(result.items[0].shift,shifts[1]);
  assert.equal(result.items[1].shift.noteRich,shifts[0].noteRich);assert.equal(result.items[1].shift.seriesId,'series');
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/employee-calendar.js'),'utf8'),context);
  assert.equal(context.CleanRoomsEmployeeCalendar.range('week','2026-10-30').days.length,7);
  assert.equal(globalThis.CleanRoomsEmployeeCalendar,Calendar);assert.ok(Object.isFrozen(Calendar));
});
