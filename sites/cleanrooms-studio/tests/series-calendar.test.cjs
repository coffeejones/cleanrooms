const test=require('node:test');const assert=require('node:assert/strict');
const Calendar=require('../src/series-calendar.js');
const shift=(id,date,person='p0',start='07:00',end='15:00')=>({id,date,person,start,end,site:0});
test('effective calendar assessment checks preserved actual assignees, full dates and internal overlaps',()=>{
  const main=shift('new','2026-11-03'),moved=shift('manual','2026-10-28','p6','18:00','20:00'),duplicate=shift('second','2026-11-03','p0','14:00','17:00');
  const result=Calendar.assess({shifts:[main,moved,duplicate],existing:[main,moved,duplicate,shift('outside','2026-11-03','p0','08:00','12:00')],blockedDates:[{person:'p6',date:'2026-10-28'}],pendingRequests:[{person:'p6',date:'2026-10-28',type:'Friønske'},{person:'p7',date:'2026-10-28'}]});
  assert.ok(result.conflicts.some(issue=>issue.type==='leave'&&issue.shift.id==='manual'));assert.ok(result.conflicts.some(issue=>issue.other?.id==='outside'));assert.equal(result.conflicts.filter(issue=>[issue.shift.id,issue.other?.id].sort().join(',')==='new,second').length,1);assert.equal(result.pendingRequests.length,1);
});
test('calendar starts on the first conflict across months and keeps explicit month/date selection',()=>{
  const shifts=[shift('first','2026-10-27'),shift('second','2026-11-03')],conflict={type:'overlap',date:'2026-11-03',shift:shifts[1]};
  const options={draft:{startDate:'2026-10-26',endDate:'2026-12-20'},shifts,conflicts:[conflict],today:'2026-10-30'};
  const initial=Calendar.model(options);assert.equal(initial.month,'2026-11-01');assert.equal(initial.selected,'2026-11-03');assert.equal(initial.issues.length,1);assert.equal(initial.previous,true);assert.equal(initial.next,true);
  const selected=Calendar.model({...options,state:{month:'2026-10-01',selected:'2026-10-27'}});assert.equal(selected.month,'2026-10-01');assert.equal(selected.selected,'2026-10-27');assert.equal(selected.previous,false);
});
test('pending leave is informational and exact-day conflicts remain blocking',()=>{
  const shifts=[shift('first','2026-11-03')],assessment=Calendar.assess({shifts,pendingRequests:[{person:'p0',date:'2026-11-03',type:'Friønske'}]});assert.equal(assessment.conflicts.length,0);
  const value=Calendar.model({draft:{startDate:'2026-11-01',endDate:'2026-11-30'},shifts,...assessment,today:'2026-10-30'});assert.equal(value.warnings.length,1);assert.equal(value.issues.length,0);
});
test('marked unavailability remains a separate advisory and includes an overnight second day without inventing leave',()=>{
  const shifts=[shift('night','2026-11-03','p0','22:00','06:00')],value=Calendar.model({draft:{startDate:'2026-11-01',endDate:'2026-11-30'},shifts,unavailableDates:['2026-11-04'],today:'2026-11-01'});
  assert.equal(value.issues.length,0);assert.equal(value.warnings.length,1);assert.equal(value.warnings[0].date,'2026-11-04');assert.equal(value.days.get('2026-11-04').unavailable,true);assert.equal(value.days.get('2026-11-04').pending.length,0);assert.equal(value.days.get('2026-11-03').shifts.length,1);
});
