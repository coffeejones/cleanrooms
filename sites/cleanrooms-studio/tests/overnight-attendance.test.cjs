/* Real account/mobile handlers on isolated SQLite: no production payroll. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'pilot-flow-e2e.test.cjs'),'utf8').split("test('new employee")[0];
const {setup}=Function('require','__dirname',shared+'\nreturn {setup};')(require,__dirname);
const Time=require('../src/timekeeping-model.js');
const {payrollCoverage}=require('../lib/timekeeping-page.mjs');
const range={from:'2089-12-26',to:'2090-01-25'};
const base=from=>({currency:'DKK',agreements:[{id:'old',from,type:'hourly',amountCents:18000},{id:'new',from:Time.addDays(from,1),type:'hourly',amountCents:20000}],supplements:[]});
async function publish(h,shift,period={from:'2090-01-09',to:'2090-01-22'}){
  const next=structuredClone((await h.plan()).body.studio);next.edits[shift.id]={person:h.personId,site:0,note:'',...shift};
  const saved=await h.save(next);assert.equal(saved.status,200,JSON.stringify(saved));
  const result=await h.save((await h.plan()).body.studio,{...period,siteIds:[0],includeDependencies:true});assert.equal(result.status,200,JSON.stringify(result));
}
const clock=(h,id,operation,version)=>h.request({action:'shiftTime',shiftId:id,operation,version,comment:null,location:null});

test('published Sunday night crosses midnight, pauses, follows plan, freezes dated pay and exports once',async t=>{
  const h=await setup(t),id='overnight-sunday',date='2090-01-15';
  const payroll=base(date);payroll.supplements=[
    {id:'sunday',name:'Søndag',type:'hourly',amountCents:1200,from:date,to:null,weekdays:[6],start:null,end:null},
    {id:'monday',name:'Mandag',type:'hourly',amountCents:600,from:date,to:null,weekdays:[0],start:null,end:null},
  ];
  assert.equal((await h.account('payrollSave',{personId:h.personId,version:0,payroll})).status,200);
  const next=structuredClone((await h.plan()).body.studio);
  next.series.push({id,person:h.personId,site:0,startDate:date,endDate:date,weekdays:[6],start:'22:00',end:'06:00',plannedBreakMinutes:30,note:''});
  assert.equal((await h.save(next)).status,200);
  assert.equal((await h.save((await h.plan()).body.studio,{from:'2090-01-09',to:'2090-01-22',siteIds:[0],includeDependencies:true})).status,200);
  const shiftId=id+'@'+date;
  const published=await h.request({action:'publishedSchedule',from:date,to:'2090-01-16',cursor:null});assert.equal(published.status,200);assert.equal(published.body.shifts.length,1);assert.equal(published.body.shifts[0].end,'06:00');
  const carry=await h.request({action:'publishedSchedule',from:'2090-01-16',to:'2090-01-16',cursor:null});assert.equal(carry.status,200);assert.deepEqual(carry.body.shifts.map(shift=>shift.id),[shiftId]);
  const sunday=await h.account('timeRead',{from:date,to:date,personId:h.personId});assert.equal(sunday.body.plannedRows[0].plannedMinutes,120);
  const monday=await h.account('timeRead',{from:'2090-01-16',to:'2090-01-22',personId:h.personId});assert.equal(monday.body.plannedRows[0].plannedMinutes,330,'Only the next-day paid portion enters the following week.');
  t.mock.timers.setTime(Date.parse(date+'T21:00:00Z'));assert.equal((await clock(h,shiftId,'start',0)).status,200);
  t.mock.timers.setTime(Date.parse(date+'T23:00:00Z'));assert.equal((await clock(h,shiftId,'pause',1)).status,200);
  const active=await h.request({action:'employeeActiveTime'});assert.equal(active.status,200);assert.equal(active.body.shift.id,shiftId);assert.equal(active.body.shift.entry.status,'paused');
  const progress=await h.account('timeRead',{...range,personId:h.personId});assert.equal(Time.review(progress.body.entries[0],{today:'2090-01-16'}).bucket,'progress');
  t.mock.timers.setTime(Date.parse(date+'T23:30:00Z'));assert.equal((await clock(h,shiftId,'resume',2)).status,200);
  t.mock.timers.setTime(Date.parse('2090-01-16T05:00:00Z'));const finished=await clock(h,shiftId,'finish',3);assert.equal(finished.status,200,JSON.stringify(finished));
  const read=await h.account('timeRead',{...range,personId:h.personId}),entry=read.body.entries[0];assert.equal(entry.date,date);assert.equal(entry.endDate,'2090-01-16');assert.equal(entry.workedMinutes,450);assert.equal(entry.breakMinutes,30);
  assert.equal(Time.review(entry,{shift:read.body.shifts[0],today:'2090-01-16',canViewPayroll:true}).bucket,'ready');
  const approved=await h.account('timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true});assert.equal(approved.status,200,JSON.stringify(approved));
  const frozen=structuredClone(approved.body.entry.payroll);assert.equal(frozen.baseCents,146000);assert.equal(frozen.supplementCents,5700);assert.equal(frozen.totalCents,151700);
  t.mock.timers.setTime(Date.parse('2090-01-26T08:00:00Z'));
  const preview=await h.account('payrollPeriodRead',range);assert.equal(preview.body.canClose,true,JSON.stringify(preview));
  const closed=await h.account('payrollPeriodClose',{...range,previewToken:preview.body.previewToken});assert.equal(closed.status,200,JSON.stringify(closed));assert.equal(closed.body.totals.workedMinutes,450);assert.equal(closed.body.totals.totalCents,151700);
  const exported=await h.account('payrollPeriodExport',range);assert.equal(exported.status,200);assert.ok(exported.body.rows.every(row=>row.date===date&&row.to==='2090-01-16'));assert.equal(exported.body.ownership,'work-date');
  const later=await h.account('payrollPeriodRead',{date:'2090-02-01'});assert.equal(later.body.totals.entryCount,0);assert.equal(later.body.totals.workedMinutes,0);
  assert.equal((await h.account('timeWrite',{operation:'reopen',entryId:entry.id,version:approved.body.entry.version,reason:'Låst periode'})).status,409);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,1);assert.equal(h.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('late check-in after midnight keeps the work date but receives the actual next-day wage and needs review',async t=>{
  const h=await setup(t),id='late-night',date='2090-01-15';await publish(h,{id,date,start:'22:00',end:'06:00'});
  assert.equal((await h.account('payrollSave',{personId:h.personId,version:0,payroll:base(date)})).status,200);
  t.mock.timers.setTime(Date.parse('2090-01-15T23:22:00Z'));const started=await clock(h,id,'start',0);assert.equal(started.status,200,JSON.stringify(started));
  t.mock.timers.setTime(Date.parse('2090-01-16T05:00:00Z'));assert.equal((await clock(h,id,'finish',1)).status,200);
  const read=await h.account('timeRead',{...range,personId:h.personId}),entry=read.body.entries[0];assert.equal(entry.date,date);assert.equal(entry.start,'00:22');assert.equal(entry.workedMinutes,338);assert.ok(entry.flags.includes('late_start'));
  assert.equal((await h.account('timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true})).status,409);
  const approved=await h.account('timeWrite',{operation:'approve',entryId:entry.id,version:entry.version});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.payroll.baseCents,112667);
  const future=await clock(h,id,'start',0);assert.equal(future.status,409);
});

test('a real overnight shift crossing a payroll boundary belongs wholly to its original work-date closure',async t=>{
  const h=await setup(t),id='payroll-night',date='2090-01-25';await publish(h,{id,date,start:'22:00',end:'06:00',plannedBreakMinutes:0},{from:'2090-01-23',to:'2090-01-29'});
  assert.equal((await h.account('payrollSave',{personId:h.personId,version:0,payroll:{currency:'DKK',agreements:[{id:'base',from:'2089-01-01',type:'hourly',amountCents:18000}],supplements:[]}})).status,200);
  t.mock.timers.setTime(Date.parse(date+'T21:00:00Z'));assert.equal((await clock(h,id,'start',0)).status,200);
  t.mock.timers.setTime(Date.parse(date+'T23:30:00Z'));const pending=await h.account('payrollPeriodRead',range);assert.equal(pending.body.canClose,false);assert.ok(pending.body.blockers.some(item=>item.code==='unapproved'));
  t.mock.timers.setTime(Date.parse('2090-01-26T05:00:00Z'));assert.equal((await clock(h,id,'finish',1)).status,200);
  const read=await h.account('timeRead',{...range,personId:h.personId}),entry=read.body.entries[0],approved=await h.account('timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true});assert.equal(approved.status,200,JSON.stringify(approved));
  const preview=await h.account('payrollPeriodRead',range);assert.equal(preview.body.canClose,true,JSON.stringify(preview));assert.equal(preview.body.totals.workedMinutes,480);
  assert.equal((await h.account('payrollPeriodClose',{...range,previewToken:preview.body.previewToken})).status,200);
  const next=await h.account('payrollPeriodRead',{date:'2090-02-01'});assert.equal(next.body.totals.entryCount,0);assert.equal(next.body.totals.totalCents,0);
});

test('manager corrections retain a late next-day start and reject ambiguous date changes instead of adding a day',async t=>{
  const h=await setup(t),id='correct-late-night',date='2090-01-15';await publish(h,{id,date,start:'22:00',end:'06:00'});
  t.mock.timers.setTime(Date.parse('2090-01-15T23:22:00Z'));assert.equal((await clock(h,id,'start',0)).status,200);
  t.mock.timers.setTime(Date.parse('2090-01-16T05:00:00Z'));assert.equal((await clock(h,id,'finish',1)).status,200);
  const read=await h.account('timeRead',{...range,personId:h.personId}),original=read.body.entries[0];assert.equal(original.workedMinutes,338);
  const payload={operation:'correct',entryId:original.id,version:original.version,start:'00:22',end:'06:00',breakMinutes:10,reason:'Tilføj den aftalte pause'};
  const changed=await h.account('timeWrite',payload);assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(changed.body.entry.date,date);assert.equal(changed.body.entry.endDate,'2090-01-16');assert.equal(changed.body.entry.workedMinutes,328);assert.equal(changed.body.entry.resolvedStartAt,'2090-01-15T23:22:00.000Z');assert.equal(changed.body.entry.clockStartAt,original.clockStartAt);assert.ok(changed.body.entry.flags.includes('late_start'));
  const ambiguous=await h.account('timeWrite',{...payload,version:changed.body.entry.version,start:'00:00'});assert.equal(ambiguous.status,400);assert.equal(ambiguous.body.error,'time_instants_required');
  const precise=await h.account('timeWrite',{...payload,version:changed.body.entry.version,start:'00:00',actualStartAt:'2090-01-15T23:00:00Z',actualEndAt:'2090-01-16T05:00:00Z'});assert.equal(precise.status,200,JSON.stringify(precise));assert.equal(precise.body.entry.workedMinutes,350);assert.equal(precise.body.entry.date,date);
  const foreignDate=await h.account('timeWrite',{...payload,version:precise.body.entry.version,start:'00:00',endDate:'2090-01-17',actualStartAt:'2090-01-16T23:00:00Z',actualEndAt:'2090-01-17T05:00:00Z'});assert.equal(foreignDate.status,400);assert.equal(foreignDate.body.error,'time_instants_mismatch');
});

test('a late next-day start crossing DST still requires explicit precise manager confirmation',async t=>{
  const date='2026-10-24',h=await setup(t,{now:Date.parse(date+'T06:00:00Z')}),id='late-dst';await publish(h,{id,date,start:'22:00',end:'06:00'},{from:'2026-10-19',to:'2026-11-01'});
  t.mock.timers.setTime(Date.parse(date+'T22:22:00Z'));assert.equal((await clock(h,id,'start',0)).status,200);
  t.mock.timers.setTime(Date.parse('2026-10-25T05:00:00Z'));assert.equal((await clock(h,id,'finish',1)).status,200);
  const read=await h.account('timeRead',{from:date,to:'2026-10-25',personId:h.personId}),entry=read.body.entries[0];assert.equal(entry.workedMinutes,398);assert.ok(entry.flags.includes('dst_transition'));
  const payload={operation:'correct',entryId:entry.id,version:entry.version,start:'00:22',end:'06:00',breakMinutes:0,reason:'Bekræftet ved skift til vintertid'};
  const unresolved=await h.account('timeWrite',payload);assert.equal(unresolved.status,400);assert.equal(unresolved.body.error,'time_instants_required');
  const confirmed=await h.account('timeWrite',{...payload,actualStartAt:date+'T22:22:00Z',actualEndAt:'2026-10-25T05:00:00Z'});assert.equal(confirmed.status,200,JSON.stringify(confirmed));assert.equal(confirmed.body.entry.workedMinutes,398);assert.equal(confirmed.body.entry.timingResolved,true);assert.equal(confirmed.body.entry.dstUnresolved,false);
});

test('a permitted 36h late night registration remains visible and overlap-protected three work dates later',async t=>{
  const h=await setup(t),id='long-late-night',date='2090-01-15',last='2090-01-18';
  await publish(h,{id,date,start:'22:00',end:'21:00'});await publish(h,{id:'later-overlap',date:last,start:'02:00',end:'04:00'});
  assert.equal((await h.account('payrollSave',{personId:h.personId,version:0,payroll:base(date)})).status,200);
  t.mock.timers.setTime(Date.parse('2090-01-16T14:00:00Z'));assert.equal((await clock(h,id,'start',0)).status,200);
  t.mock.timers.setTime(Date.parse(last+'T02:00:00Z'));assert.equal((await clock(h,id,'finish',1)).status,200);
  const entry=(await h.account('timeRead',{...range,personId:h.personId})).body.entries[0];assert.equal(entry.workedMinutes,2160);assert.equal(entry.date,date);assert.equal(entry.endDate,last);
  const hours=await h.request({action:'employeeHours',from:last,to:last});assert.equal(hours.status,200,JSON.stringify(hours));assert.equal(hours.body.summary.workedMinutes,180);assert.equal(hours.body.summary.earnedCents,60000);assert.ok(hours.body.rows.some(row=>row.shift.id===id));
  t.mock.timers.setTime(Date.parse(last+'T04:00:00Z'));
  const overlap=await h.account('timeWrite',{operation:'correct',shiftId:'later-overlap',version:0,start:'02:00',end:'04:00',breakMinutes:0,reason:'Efterregistrering fra tidligere på dagen'});assert.equal(overlap.status,409,JSON.stringify(overlap));assert.equal(overlap.body.error,'time_overlap');
  const workspaceId=h.sqlite.prepare('SELECT workspace_id FROM workspace_time_entries WHERE id=?').get(entry.id).workspace_id;
  const legacy={id:'legacy-overlap',shiftId:'later-overlap',personId:h.personId,date:last,endDate:last,site:0,plannedStart:'02:00',plannedEnd:'04:00',plannedBreakMinutes:0,start:'02:00',end:'04:00',breakMinutes:0,breaks:[],breakAllocation:'end-of-shift',status:'submitted',version:1,audit:[]},interval=Time.absoluteInterval(legacy);
  h.sqlite.prepare('INSERT INTO workspace_time_entries(workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at,interval_start,interval_end) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(workspaceId,legacy.id,legacy.shiftId,legacy.personId,legacy.date,legacy.endDate,legacy.status,0,1,JSON.stringify(legacy),'legacy','2090-01-18T04:00:00Z',interval.start,interval.end);
  const queued=await h.account('timeRead',{from:date,to:last,queue:'all',personId:h.personId});assert.equal(queued.status,200,JSON.stringify(queued));assert.equal(queued.body.entries.length,2);assert.ok(queued.body.entries.every(row=>row.flags.includes('overlap')));
  const approved=await h.account('timeWrite',{operation:'approve',entryId:entry.id,version:entry.version});assert.equal(approved.status,409);assert.equal(approved.body.error,'time_overlap');
});

test('night corrections infer the following day, and precise clocked wage coverage uses the actual local start day',async t=>{
  const h=await setup(t),id='correct-night',date='2090-01-15';await publish(h,{id,date,start:'22:00',end:'06:00'});
  t.mock.timers.setTime(Date.parse('2090-01-16T06:00:00Z'));const corrected=await h.account('timeWrite',{operation:'correct',shiftId:id,version:0,start:'22:00',end:'06:00',breakMinutes:0,reason:'Bekræftet nattevagt'});assert.equal(corrected.status,200,JSON.stringify(corrected));assert.equal(corrected.body.entry.endDate,'2090-01-16');assert.equal(corrected.body.entry.workedMinutes,480);
  const entry={date,start:'00:22',end:'06:00',endDate:'2090-01-16',plannedStart:'22:00',plannedEnd:'06:00',breakMinutes:0,breaks:[],breakAllocation:'clocked',clockStartAt:'2090-01-15T23:22:00Z',clockEndAt:'2090-01-16T05:00:00Z'};
  const resolved={payroll:{agreements:[{id:'only-next-day',from:'2090-01-16',type:'hourly',amountCents:18000}],supplements:[]},missingBasePeriods:[{from:date,to:date}]};
  assert.equal(payrollCoverage(entry,resolved),true);assert.equal(Time.payroll(entry,resolved).baseCents,101400);assert.equal(Time.payroll(entry,resolved).unavailableReason,undefined);
});

test('New Year overnight planning and attendance split calendar days while retaining one work-date identity',async t=>{
  const id='new-year-night',date='2090-12-31',nextDate='2091-01-01',h=await setup(t,{now:Date.parse(date+'T06:00:00Z')});
  const weekday=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7,first=Time.addDays(date,-weekday);
  await publish(h,{id,date,start:'22:00',end:'06:00'},{from:first,to:Time.addDays(first,13)});
  assert.equal((await h.account('payrollSave',{personId:h.personId,version:0,payroll:base(date)})).status,200);
  const before=await h.account('timeRead',{from:date,to:date,personId:h.personId}),after=await h.account('timeRead',{from:nextDate,to:nextDate,personId:h.personId});
  assert.equal(before.body.plannedRows[0].plannedMinutes,120);assert.equal(after.body.plannedRows[0].plannedMinutes,360);
  t.mock.timers.setTime(Date.parse(date+'T21:00:00Z'));assert.equal((await clock(h,id,'start',0)).status,200);
  t.mock.timers.setTime(Date.parse(nextDate+'T05:00:00Z'));assert.equal((await clock(h,id,'finish',1)).status,200);
  const read=await h.account('timeRead',{from:date,to:nextDate,personId:h.personId}),entry=read.body.entries[0];assert.equal(entry.date,date);assert.equal(entry.endDate,nextDate);assert.equal(entry.workedMinutes,480);
  const approved=await h.account('timeWrite',{operation:'approve',entryId:entry.id,version:entry.version,onlyIfMatchesPlan:true});assert.equal(approved.status,200,JSON.stringify(approved));assert.equal(approved.body.entry.payroll.baseCents,156000);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM workspace_time_entries').get().n,1);
});

test('DST nights retain measured elapsed minutes and require explicit planner resolution',()=>{
  for(const [date,from,to,minutes]of[
    ['2026-03-28','2026-03-28T21:00:00Z','2026-03-29T04:00:00Z',420],
    ['2026-10-24','2026-10-24T20:00:00Z','2026-10-25T05:00:00Z',540],
  ]){
    const entry={date,start:'22:00',end:'06:00',endDate:Time.addDays(date,1),plannedStart:'22:00',plannedEnd:'06:00',plannedBreakMinutes:0,breakMinutes:0,breaks:[],breakAllocation:'clocked',clockStartAt:from,clockEndAt:to,status:'submitted'};
    const resolved={payroll:{agreements:[{id:'base',from:'2026-01-01',type:'hourly',amountCents:18000}],supplements:[]}};
    assert.equal(Time.summary(entry).workedMinutes,minutes);assert.equal(Time.hasDSTAmbiguity(entry),true);assert.match(Time.payroll(entry,resolved).unavailableReason,/sommer/);
    const confirmed={...entry,timingResolved:true,resolvedStartAt:from,resolvedEndAt:to};assert.equal(Time.hasDSTAmbiguity(confirmed),false);assert.equal(Time.payroll(confirmed,resolved).baseCents,minutes*300);
  }
});
