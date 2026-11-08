const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary > 0,'The staffing harness must find the actual app setup boundary.');

// Exercise the real editor draft construction and assessment without painting
// the picker or adding test hooks to the application itself.
function application() {
  const controls = new Map();
  const control = selector => {
    if (!controls.has(selector)) controls.set(selector,{value:'',checked:false,hidden:true,disabled:false,dataset:{},setAttribute(){},removeAttribute(){}});
    return controls.get(selector);
  };
  const root = {querySelector:control,querySelectorAll:()=>[]};
  const context = vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{},document:{getElementById:()=>root},
    CleanRoomsSeries:require('../src/series-engine.js'),
    CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),
    CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsPlanningAvailability:require('../src/planning-availability.js')
  });
  const instrumentation = `
    globalThis.staffingTest = {
      state,staff,staffingContext,shiftsInRange,
      status:staffingStatus,reason:staffingReason,issues:scheduleIssues,previewMove,
      useAvailability:reader=>{cloudLoaded=true;cloudCapabilities={plan:true};chatWorkspaceId='test-workspace';sessionViewer={userId:'planner'};planningAvailability=reader;},
      assess:(id,context) => assessStaffing(personFor(id),context),
      begin:(shift,options = {}) => {
        activeEdit = {...shift};
        editorSeriesId = 'staffing-preview-series';
        repeatDays = new Set(options.weekdays || [1,3]);
        q('#cs-edit-person').value = options.person ?? shift.person ?? '';
        q('#cs-edit-site').value = String(options.site ?? shift.site ?? 0);
        q('#cs-edit-date').value = options.date ?? shift.date;
        q('#cs-edit-start').value = options.start ?? shift.start ?? '07:00';
        q('#cs-edit-end').value = options.end ?? shift.end ?? '15:00';
        q('#cs-edit-note').value = options.note ?? shift.note ?? '';
        q('#cs-edit-scope').value = options.scope || 'one';
        q('#cs-edit-repeat').checked = options.repeat === true;
        q('#cs-repeat-start').value = options.from || shift.date;
        q('#cs-repeat-end').value = options.to || shift.date;
      }
    };
  `;
  vm.runInContext(source.slice(0,boundary) + instrumentation + '\n})();',context,{filename:'app.js (staffing integration)'});
  const app = context.staffingTest;
  return {...app,control,at:(day,person) => app.shiftsInRange(day,day).find(shift => shift.person === person)};
}

function standalone(date, start = '16:00', end = '18:00') {
  return {person:'',site:0,date,start,end,note:''};
}

test('editing an existing assignment counts the current shift once and replaces it once',()=>{
  const app = application(), shift = app.at('2026-10-27','p0');
  app.begin(shift);
  const context = app.staffingContext(), result = app.assess('p0',context);
  assert.equal(context.valid,true);
  assert.equal(context.weekStart,'2026-10-26');
  assert.deepEqual(Array.from(context.removedIds),[shift.id]);
  assert.equal(result.status,'available');
  assert.equal(result.currentMinutes,16 * 60);
  assert.equal(result.projectedMinutes,16 * 60);
  assert.equal(result.overTargetWeeks.length,0);
});

test('employee marked days remain visible advisories in editor, calendar and move preview without changing the plan',()=>{
  const app=application(),before=JSON.stringify(app.state),requests=[];
  app.useAvailability({setContext(){},reset(){},status:()=> 'ready',isUnavailable:(id,day)=>id==='p0'&&day==='2026-11-02',ensure:scope=>{requests.push(scope);return Promise.resolve({ok:true});}});
  app.begin(standalone('2026-11-02'),{person:'p0'});const result=app.assess('p0',app.staffingContext());
  assert.equal(result.available,true);assert.equal(result.conflicts.length,0);assert.deepEqual(Array.from(result.unavailableDates),['2026-11-02']);assert.equal(app.status(result),'Utilgængelig');assert.match(app.reason(result),/Utilgængelig den 2\. nov/);
  const original=app.at('2026-10-27','p0'),moved=app.previewMove(original,'2026-11-02');assert.equal(moved.allowed,true);assert.match(moved.reason,/utilgængelig/);assert.equal(requests[0].from,'2026-11-02');assert.equal(requests[0].to,'2026-11-02');assert.deepEqual(Array.from(requests[0].personIds),['p0']);
  const issues=app.issues([{...original,id:'preview',date:'2026-11-02'}]);assert.equal(issues.get('preview').kind,'unavailable');assert.equal(JSON.stringify(app.state),before);
});
test('pending or failed availability never claims a candidate is checked and overnight markers use the actual unavailable day',()=>{
  const app=application();let status='loading';app.useAvailability({setContext(){},reset(){},status:()=>status,isUnavailable:(id,day)=>day==='2026-11-03',ensure:()=>Promise.resolve({ok:true})});app.begin(standalone('2026-11-02'),{person:'p0'});
  const assessment=()=>app.assess('p0',app.staffingContext());assert.equal(app.status(assessment()),'Tjekker tilgængelighed…');status='error';assert.equal(app.status(assessment()),'Ikke kontrolleret');assert.match(app.reason(assessment()),/kunne ikke kontrolleres/);
  const night={id:'night',person:'p0',site:0,date:'2026-11-02',start:'22:00',end:'06:00'},warning=app.issues([night]).get('night');assert.equal(warning.kind,'unavailable');assert.match(warning.detail,/3\. nov/);assert.equal(app.issues([{...night,end:'00:00'}]).has('night'),false);
});

test('reassignment assesses each candidate against their own original and projected weekly hours',()=>{
  const app = application(), shift = app.at('2026-10-27','p0');
  app.begin(shift,{person:'p1',start:'16:00',end:'18:00'});
  const context = app.staffingContext(), replacement = app.assess('p1',context), original = app.assess('p0',context);
  assert.equal(replacement.status,'available');
  assert.equal(replacement.currentMinutes,35 * 60);
  assert.equal(replacement.projectedMinutes,37 * 60);
  assert.equal(original.currentMinutes,16 * 60);
  assert.equal(original.projectedMinutes,10 * 60);
  assert.equal(app.at('2026-10-27','p0').id,shift.id,'A read-only assessment must preserve the actual assignment.');
  assert.equal(app.control('#cs-edit-person').value,'p1','Assessing another candidate must not change the editor selection.');
});

test('moving a single occurrence uses the destination week and does not add its original week hours',()=>{
  const app = application(), shift = app.at('2026-10-27','p0');
  app.state.week = 35;
  app.begin(shift,{date:'2026-11-02'});
  const context = app.staffingContext(), result = app.assess('p0',context);
  assert.equal(context.referenceDate,'2026-11-02');
  assert.equal(context.weekStart,'2026-11-02');
  assert.equal(result.status,'available');
  assert.equal(result.currentMinutes,16 * 60);
  assert.equal(result.projectedMinutes,24 * 60);
  assert.equal(result.overTargetWeeks[0].weekStart,'2026-11-02');
  assert.ok(!context.existing.some(item => item.id === shift.id));
});

test('future scope uses occurrence anchors and retains an earlier exception moved into the proposal period',()=>{
  const app = application();
  const prior = app.at('2026-10-27','p0'), selected = app.at('2026-10-29','p0');
  app.state.edits[prior.id] = {...prior,date:'2026-11-03'};
  app.state.edits[selected.id] = {...selected,date:'2026-11-10'};
  app.begin(app.state.edits[selected.id],{scope:'future',from:'2026-10-29',to:'2026-11-12'});
  const context = app.staffingContext(), result = app.assess('p0',context);
  assert.equal(context.valid,true);
  assert.equal(context.referenceDate,'2026-10-29','The future cutoff comes from the occurrence identity, not its moved date.');
  assert.ok(context.removedIds.includes(selected.id));
  assert.ok(!context.removedIds.includes(prior.id));
  assert.equal(result.status,'blocked');
  assert.ok(result.conflicts.some(issue => issue.date === '2026-11-03' && issue.other.id === prior.id));
  assert.ok(!result.conflicts.some(issue => issue.other?.id === selected.id));
});

test('whole-series scope removes every replaced moved exception, including one outside the original definition',()=>{
  const app = application(), prior = app.at('2026-10-27','p0'), second = app.at('2026-11-03','p0');
  app.state.edits[prior.id] = {...prior,date:'2027-05-04'};
  app.state.edits[second.id] = {...second,date:'2026-10-28'};
  app.begin(app.state.edits[prior.id],{scope:'all',from:'2026-10-26',to:'2027-04-26'});
  const context = app.staffingContext(), result = app.assess('p0',context);
  assert.ok(context.removedIds.includes(prior.id),'Moved exceptions outside the proposal range still belong to the replaced series.');
  assert.ok(context.removedIds.includes(second.id));
  assert.equal(context.weekStart,'2026-10-26');
  assert.equal(result.status,'available');
  assert.equal(result.conflicts.length,0);
  assert.equal(result.currentMinutes,16 * 60);
  assert.equal(result.projectedMinutes,16 * 60);
});

test('availability includes hidden other-site work and approved absence across the whole draft',()=>{
  const app = application();
  app.state.site = '0'; app.state.search = 'no match'; app.state.onlyOpen = true;
  app.state.edits.hidden = {id:'hidden',person:'p0',date:'2026-11-02',site:2,start:'17:00',end:'19:00',note:''};
  app.begin(standalone('2026-11-02'));
  const overlap = app.assess('p0',app.staffingContext());
  assert.equal(overlap.status,'blocked');
  assert.ok(overlap.conflicts.some(issue => issue.type === 'overlap' && issue.other.site === 2));
  app.begin(standalone('2026-10-28','07:00','14:00'));
  const leave = app.assess('p6',app.staffingContext());
  assert.equal(leave.status,'blocked');
  assert.ok(leave.conflicts.some(issue => issue.type === 'leave' && issue.date === '2026-10-28'));
  app.begin(standalone('2026-11-03'));
  const pending = app.assess('p1',app.staffingContext());
  assert.equal(pending.status,'available','Pending leave is advisory until approved.');
  assert.equal(pending.pendingRequests[0].date,'2026-11-03');
  app.state.requests.b = 'approved';
  assert.equal(app.assess('p1',app.staffingContext()).status,'blocked');
});

test('reference weeks begin on Monday and cross a calendar-year boundary independently of navigation',()=>{
  const app = application();
  app.state.week = -20;
  for (const [day,weekStart] of [['2027-01-01','2026-12-28'],['2027-01-03','2026-12-28'],['2027-01-04','2027-01-04']]) {
    app.begin(standalone(day));
    const context = app.staffingContext(), result = app.assess('p0',context);
    assert.equal(context.weekStart,weekStart);
    assert.equal(result.status,'available');
    assert.equal(result.currentMinutes,16 * 60);
    assert.equal(result.projectedMinutes,18 * 60);
  }
});

test('a 366-day series loads separate full weeks without exceeding the range guard',()=>{
  const app = application();
  app.begin(standalone('2026-12-30'),{repeat:true,from:'2026-12-30',to:'2027-12-30',weekdays:[1,3]});
  let context;
  assert.doesNotThrow(()=>{ context = app.staffingContext(); });
  assert.equal(context.valid,true);
  assert.equal(context.weekStart,'2026-12-28');
  assert.equal(context.templates[0].date,'2026-12-31');
  assert.equal(context.templates.at(-1).date,'2027-12-30');
  const result = app.assess('p0',context);
  assert.equal(result.status,'available');
  assert.equal(result.currentMinutes,16 * 60);
  assert.equal(result.projectedMinutes,18 * 60);
  assert.ok(result.weekCount > 52);
});

test('a later future draft start still replaces the selected anchor onward and keeps earlier anchors',()=>{
  const app = application(), prior = app.at('2026-10-27','p0'), selected = app.at('2026-10-29','p0'), omitted = app.at('2026-11-03','p0');
  app.state.edits[prior.id] = {...prior,date:'2026-11-10'};
  app.state.edits[omitted.id] = {...omitted,date:'2026-11-12'};
  app.begin(selected,{scope:'future',from:'2026-11-10',to:'2026-11-24'});
  const context = app.staffingContext(), result = app.assess('p0',context);
  assert.equal(context.valid,true);
  assert.equal(context.weekStart,'2026-11-09');
  assert.ok(context.removedIds.includes(selected.id));
  assert.ok(context.removedIds.includes(omitted.id),'Occurrences before the new start but after the original cutoff are replaced too.');
  assert.ok(!context.removedIds.includes(prior.id));
  assert.equal(result.status,'blocked');
  assert.ok(result.conflicts.some(issue => issue.other.id === prior.id && issue.date === '2026-11-10'));
  assert.ok(!result.conflicts.some(issue => issue.other?.id === omitted.id));
});
