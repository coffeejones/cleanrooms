const test=require('node:test'),assert=require('node:assert/strict');
const Series=require('../src/series-engine.js'),Employee=require('../src/employee-calendar.js'),Profile=require('../src/employee-profile-calendar.js'),Roster=require('../src/roster-planning.js'),Budget=require('../src/planning-budget-impact.js'),Preview=require('../src/series-calendar.js');
const night=(patch={})=>({id:'night',person:'p0',site:0,date:'2026-11-01',start:'22:00',end:'06:00',plannedBreakMinutes:30,...patch});
test('day placement clips overnight work into both dates and keeps a touching morning in a separate cluster',()=>{
 const shift=night(),first=Employee.layout([shift],shift.date),next=Employee.layout([shift,{...night(),id:'morning',date:'2026-11-02',start:'06:00',end:'07:00',plannedBreakMinutes:0}],'2026-11-02');
 assert.equal(first.valid,true);assert.equal(first.items[0].startMinute,1320);assert.equal(first.items[0].endMinute,1440);assert.equal(first.items[0].durationMinutes,120);
 assert.equal(next.valid,true);assert.equal(next.items[0].startMinute,0);assert.equal(next.items[0].endMinute,360);assert.equal(next.items[0].laneCount,1);assert.equal(next.items[1].laneCount,1);assert.equal(next.items[0].shift,shift);
 assert.equal(Employee.layout([night({end:'00:00'})],'2026-11-02').items.length,0);
});
test('employee month totals allocate net paid minutes across month/year edges without losing the previous night',()=>{
 const shift=night({date:'2026-12-31'}),base={person:{id:'p0'},today:'2027-01-01',shifts:[shift]};
 const december=Profile.build({...base,month:'2026-12'}),january=Profile.build({...base,month:'2027-01'});
 assert.equal(december.totalMinutes,120);assert.equal(january.totalMinutes,330);assert.equal(december.totalMinutes+january.totalMinutes,450);assert.equal(january.shiftCount,1);assert.equal(january.workingDays,1);assert.equal(january.byDate['2027-01-01'].shifts[0].id,shift.id);assert.equal(january.byDate['2027-01-01'].minutes,330);
});
test('roster week totals clip Sunday carry-in and upcoming keeps a night still active after midnight',()=>{
 const shift=night(),base={staff:[{id:'p0',target:37}],weekStart:'2026-11-02',today:'2026-11-02',nowTime:'02:00',horizonEnd:'2026-11-29',weeklyShifts:[shift],upcomingShifts:[shift]};
 const result=Roster.build(base);assert.equal(result.byPerson.p0.plannedMinutes,330);assert.equal(result.byPerson.p0.nextShift.id,shift.id);assert.equal(Roster.build({...base,nowTime:'06:00'}).byPerson.p0.nextShift,null);
});
test('inline budget uses the same clipped net minutes for Sunday edit and Monday carry-in',()=>{
 const before=night(),base={budget:{period:'week',hours:10},loaded:true,siteIds:[0],shifts:[before],before};
 const sunday=Budget.preview({...base,from:'2026-10-26',to:'2026-11-01',after:night({start:'21:00'})});assert.equal(sunday.currentMinutes,120);assert.equal(sunday.deltaMinutes,60);assert.equal(sunday.plannedMinutes,180);
 const monday=Budget.preview({...base,from:'2026-11-02',to:'2026-11-08',after:night({date:'2026-11-02',start:'22:00',end:'06:00'})});assert.equal(monday.currentMinutes,330);assert.equal(monday.deltaMinutes,450-330);
});
test('series preview marks following-day absence and pending request on the actual affected date',()=>{
 const shift=night(),result=Preview.assess({shifts:[shift],existing:[],blockedDates:[{person:'p0',date:'2026-11-02'}],pendingRequests:[{person:'p0',date:'2026-11-02'}]});assert.equal(result.conflicts[0].type,'leave');assert.equal(result.conflicts[0].date,'2026-11-02');assert.equal(result.pendingRequests.length,1);
 assert.equal(Preview.assess({shifts:[night({end:'00:00'})],blockedDates:[{person:'p0',date:'2026-11-02'}]}).conflicts.length,0);
});
test('identical clock times remain invalid rather than becoming a 24-hour shift',()=>{
 const invalid=night({start:'22:00',end:'22:00'});assert.equal(Series.shiftInterval(invalid),null);assert.equal(Employee.layout([invalid],invalid.date).valid,false);assert.throws(()=>Profile.build({person:{id:'p0'},today:invalid.date,month:'2026-11',shifts:[invalid]}));
});
