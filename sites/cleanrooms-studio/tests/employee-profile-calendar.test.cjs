const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Calendar=require('../src/employee-profile-calendar.js');
const shift=(id,date='2026-10-31',extra={})=>({id,date,person:'p0',site:0,start:'07:00',end:'15:00',note:'',...extra});
const options=extra=>({person:{id:'p0',name:'Jonas'},month:'2026-10',today:'2026-10-31',shifts:[],...extra});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('natural Monday-first month grids have four, five or six complete weeks and correct neighboring months',()=>{
  for(const [month,from,to,rows] of [['2027-02','2027-02-01','2027-02-28',4],['2026-10','2026-09-28','2026-11-01',5],['2026-08','2026-07-27','2026-09-06',6]]){
    const result=Calendar.build(options({month})),days=result.weeks.flat();
    assert.equal(result.from,from);assert.equal(result.to,to);assert.equal(result.weeks.length,rows);assert.ok(result.weeks.every(week=>week.length===7));
    assert.equal(new Date(from+'T12:00:00Z').getUTCDay(),1);assert.equal(new Date(to+'T12:00:00Z').getUTCDay(),0);
    assert.equal(days.length,new Set(days.map(day=>day.date)).size);assert.ok(days.every(day=>result.byDate[day.date]===day));
    assert.equal(result.totalMinutes,0);assert.equal(result.shiftCount,0);assert.equal(result.workingDays,0);
  }
  const october=Calendar.build(options());assert.equal(october.label,'Oktober 2026');assert.equal(october.previousMonth,'2026-09');assert.equal(october.nextMonth,'2026-11');assert.equal(october.byDate['2026-10-31'].isToday,true);assert.equal(october.byDate['2026-11-01'].inMonth,false);
});

test('monthly totals exclude neighboring grid dates, other employees and unassigned shifts while retaining full grid work',()=>{
  const result=Calendar.build(options({shifts:[shift('before','2026-09-28'),shift('first','2026-10-01',{start:'07:15',end:'09:45'}),shift('last','2026-10-31',{start:'22:00',end:'23:59'}),shift('neighbor','2026-11-01'),shift('outside','2026-11-02'),shift('other','2026-10-01',{person:'p1'}),shift('unassigned','2026-10-01',{person:''})]}));
  assert.deepEqual(result.shifts.map(item=>item.id),['first','last']);assert.equal(result.totalMinutes,269);assert.equal(result.shiftCount,2);assert.equal(result.workingDays,2);
  assert.equal(result.byDate['2026-09-28'].minutes,480);assert.equal(result.byDate['2026-11-01'].minutes,480);assert.equal(result.byDate['2026-11-02'],undefined);assert.equal(result.byDate['2026-10-01'].shifts.length,1);
});

test('actual moved and reassigned occurrences retain anchors but use their actual date, person and site',()=>{
  const moved=shift('series@2027-03-09','2026-10-03',{seriesId:'series',site:2,note:'Flyttet fra marts'}),movedOut=shift('series@2026-10-06','2026-11-03',{seriesId:'series'}),reassigned=shift('series@2026-10-08','2026-10-08',{seriesId:'series',person:'p1'});
  const result=Calendar.build(options({shifts:[movedOut,reassigned,moved]}));
  assert.deepEqual(result.shifts,[moved]);assert.equal(result.byDate['2026-10-03'].shifts[0].site,2);assert.equal(result.byDate['2026-10-06'].minutes,0);assert.equal(result.byDate['2026-10-08'].minutes,0);assert.equal(result.totalMinutes,480);assert.equal(result.workingDays,1);
});

test('exact repeated records are counted once, contradictory duplicate IDs fail closed and multiple same-day shifts remain',()=>{
  const first=shift('first','2026-10-31',{start:'08:00',end:'10:00'}),overlap=shift('overlap','2026-10-31',{start:'09:00',end:'11:00'}),touching=shift('touching','2026-10-31',{start:'11:00',end:'12:00'});
  const result=Calendar.build(options({shifts:[touching,first,{...first},overlap]}));
  assert.deepEqual(result.shifts.map(item=>item.id),['first','overlap','touching']);assert.equal(result.totalMinutes,300);assert.equal(result.shiftCount,3);assert.equal(result.workingDays,1);assert.equal(result.byDate['2026-10-31'].minutes,300);
  for(const patch of [{date:'2026-11-01'},{person:'p1'},{site:1},{start:'07:00'},{note:'Ændret beskrivelse'},{noteRich:'{"type":"doc"}'},{seriesId:'changed'}])assert.throws(()=>Calendar.build(options({shifts:[first,{...first,...patch}]})),/Samme vagt-id/);
});

test('leap years, DST days and year navigation retain exact calendar days without UTC drift',()=>{
  const leap=Calendar.build(options({month:'2028-02',today:'2028-02-29',shifts:[shift('leap','2028-02-29',{start:'07:15',end:'08:45'})]}));
  assert.equal(leap.from,'2028-01-31');assert.equal(leap.to,'2028-03-05');assert.equal(leap.byDate['2028-02-29'].isToday,true);assert.equal(leap.totalMinutes,90);
  const march=Calendar.build(options({month:'2027-03',today:'2027-03-28',shifts:[shift('dst','2027-03-28',{start:'01:00',end:'04:00'})]}));assert.equal(march.byDate['2027-03-28'].minutes,180);assert.equal(march.weeks.flat().length,35);
  const december=Calendar.build(options({month:'2026-12'})),january=Calendar.build(options({month:'2027-01'}));assert.equal(december.nextMonth,'2027-01');assert.equal(january.previousMonth,'2026-12');assert.equal(january.from,'2026-12-28');assert.equal(january.to,'2027-01-31');
});

test('invalid identity, month, exact date, clocks and malformed lists throw rather than showing fabricated hours',()=>{
  for(const patch of [{person:null},{person:{id:''}},{person:{id:' p0'}},{month:'2026-2'},{month:'2026-13'},{month:'0000-01'},{month:'2026-02-01'},{today:'2026-02-29'},{today:'2026-04-31'},{shifts:null},{sites:{}}])assert.throws(()=>Calendar.build(options(patch)),TypeError,JSON.stringify(patch));
  for(const patch of [{id:''},{id:' x'},{person:null},{date:'2026-02-30'},{date:'2026-10-1'},{site:-1},{site:'0'},{start:'7:00'},{end:'24:00'},{start:'15:00',end:'07:00'},{start:'15:00',end:'15:00'},{note:{}},{noteRich:[]}])assert.throws(()=>Calendar.build(options({shifts:[shift('invalid','2026-10-31',patch)]})),TypeError,JSON.stringify(patch));
  assert.throws(()=>Calendar.build(options({month:'9999-12'})),RangeError);
});

test('same-day ordering is deterministic and minute totals describe scheduled work independent of today',()=>{
  const shifts=[shift('later','2026-10-01',{start:'10:00',end:'11:00'}),shift('b','2026-10-01',{start:'07:00',end:'09:00'}),shift('a','2026-10-01',{start:'07:00',end:'09:00'}),shift('short','2026-10-01',{start:'07:00',end:'08:00'})];
  const result=Calendar.build(options({today:'2027-01-01',shifts}));assert.deepEqual(result.shifts.map(item=>item.id),['short','a','b','later']);assert.equal(result.totalMinutes,360);assert.equal(result.workingDays,1);assert.ok(result.weeks.flat().every(day=>!day.isToday));assert.equal(Calendar.build(options({shifts:[...shifts].reverse()})).totalMinutes,result.totalMinutes);
});

test('frozen metadata including long literal descriptions survives intact without mutating inputs or another result',()=>{
  const note=('  ÆØÅ 🧽 <script>literal</script>\n').repeat(1000),input=freeze(options({shifts:[shift('rich','2026-10-31',{note,noteRich:'{"type":"doc"}',seriesId:'series',metadata:{tags:['clean']}})],sites:[{id:'site-nord',name:'Nord'}]})),before=JSON.stringify(input);
  const result=Calendar.build(input);assert.equal(result.shifts[0].note,note);assert.equal(result.shifts[0].noteRich,'{"type":"doc"}');assert.equal(result.shifts[0].seriesId,'series');
  result.shifts[0].metadata.tags.push('changed');result.byDate['2026-10-31'].shifts[0].note='Changed';assert.equal(JSON.stringify(input),before);assert.equal(Calendar.build(input).shifts[0].note,note);
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/employee-profile-calendar.js'),'utf8'),context);assert.ok(Object.isFrozen(context.CleanRoomsEmployeeProfileCalendar));assert.deepEqual(Object.keys(Calendar),['build']);assert.equal(globalThis.CleanRoomsEmployeeProfileCalendar,Calendar);assert.equal(context.CleanRoomsEmployeeProfileCalendar.build(options()).weeks.length,5);
});

test('planned unpaid breaks reduce daily and monthly work while legacy zero remains compatible',()=>{
  const paid=shift('pause','2026-10-31',{plannedBreakMinutes:30}),legacy=shift('legacy','2026-10-30'),explicitZero={...legacy,plannedBreakMinutes:0};
  const result=Calendar.build(options({shifts:[paid,legacy,explicitZero]}));
  assert.equal(result.byDate['2026-10-31'].minutes,450);assert.equal(result.totalMinutes,930);assert.equal(result.shiftCount,2);assert.equal(result.shifts.find(item=>item.id==='pause').plannedBreakMinutes,30);
  assert.throws(()=>Calendar.build(options({shifts:[paid,{...paid,plannedBreakMinutes:45}]})),/Samme vagt-id/);
  for(const pause of [-1,0.5,'30',null,480,999])assert.throws(()=>Calendar.build(options({shifts:[{...paid,plannedBreakMinutes:pause}]})),TypeError,String(pause));
});
