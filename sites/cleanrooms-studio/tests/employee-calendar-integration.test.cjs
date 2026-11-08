const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Calendar = require('../src/employee-calendar.js');
const Description = require('../src/description-model.js');
const Checklist = require('../src/checklist-progress.js');

const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary > 0,'The employee-calendar harness must find the real app setup boundary.');
const plain = value => JSON.parse(JSON.stringify(value));

// Keep production date/view callbacks, data loading, migration, and save/restore.
// Capture the renderer's actual inputs instead of replacing renderEmployee.
function application(today = '2026-10-30') {
  const controls = new Map(), views = [], writes = [];
  const control = selector => {
    if (!controls.has(selector)) controls.set(selector,{
      value:'',hidden:true,checked:false,disabled:false,dataset:{},children:[],isConnected:true,get options(){return this.children;},
      setAttribute(){},removeAttribute(){},append(...children){this.children.push(...children);},
      replaceChildren(...children){this.children=children;},focus(){},scrollIntoView(){},reportValidity(){return true;}
    });
    return controls.get(selector);
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [today + 'T12:00:00Z'])); }
    static now() { return new Date(today + 'T12:00:00Z').getTime(); }
  }
  const root = {querySelector:control,querySelectorAll:()=>[]};
  const context = vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    Date:FixedDate,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{openai:{setWidgetState:value=>{writes.push(plain(value));return Promise.resolve();}}},
    document:{getElementById:()=>root,createElement:()=>control('created-' + controls.size),createTextNode:text=>({textContent:String(text),children:[]})},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:Description,CleanRoomsChecklist:Checklist,
    CleanRoomsEmployeeCalendar:Calendar,CleanRoomsEmployee:{render:(host,options)=>views.push(options)},
    CleanRoomsRichEditor:{mount:()=>({setContent(){},getData:()=>({note:'',noteRich:''})})}
  });
  vm.runInContext(source.slice(0,boundary) + `
    render = () => { if (state.role === 'employee') renderEmployee(); };
    closeDemoSheets = () => {};
    globalThis.employeeCalendarTest = {
      publishFixture:()=>{
        const role=state.role;state.role='admin';
        for(const from of ['2025-10-27','2026-10-26','2027-10-25']){
          state.publications=Publication.publish(state,{from,to:addDays(from,363),siteIds:[0,1,2],includeDependencies:true,actor:{userId:'fixture-planner',name:'Testplanlægger'},at:'2026-10-30T12:00:00.000Z'}).studio.publications;
        }
        state.role=role;
      },

      state,save,restore,renderEmployee,validEmployeeDate,changeEmployeeDate,changeEmployeeView,
      setRole,shiftsInRange,shiftById,checklistView
    };
  })();`,context,{filename:'app.js (employee calendar integration)'});
  const app = context.employeeCalendarTest; app.publishFixture();
  return {...app,views,writes,control,last:()=>views.at(-1),at:(day,person='p0')=>app.shiftsInRange(day,day).find(shift=>shift.person===person)};
}

function progressFixture(app) {
  const noteRich = Description.encode({type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Rengør køkkenet'}]}]}]}]});
  Object.assign(app.state.series[0],{note:Description.text(noteRich),noteRich});app.publishFixture();
  const shift = app.at('2026-10-27'), view = app.checklistView(shift);
  app.state.checklistProgress = Checklist.set({},shift,{key:view.tasks[0].key,checked:true,signature:view.signature,person:shift.person}).progress;
  return shift;
}

test('month loading includes every earlier week and cross-month cell, independent of upcoming shifts',()=>{
  for (const [focus,today] of [['2026-10-29','2026-10-30'],['2027-01-15','2027-04-20']]) {
    const app = application(today);
    Object.assign(app.state,{role:'employee',employeePerson:'p1',employeeDate:focus,employeeWeek:Calendar.range('week',focus).from,employeeView:'month'});
    app.renderEmployee();
    const options = app.last(), range = Calendar.range('month',focus);
    assert.equal(options.view,'month'); assert.equal(options.focusDate,focus); assert.equal(options.today,today);
    const expected = app.shiftsInRange(range.from,range.to).filter(shift=>shift.person==='p1').map(shift=>shift.id).sort();
    const actual = options.shifts.filter(shift=>shift.person==='p1' && shift.date>=range.from && shift.date<=range.to).map(shift=>shift.id).sort();
    assert.deepEqual(Array.from(actual),Array.from(expected));
    assert.ok(options.shifts.some(shift=>shift.person==='p1' && shift.date===range.from),'Leading cross-month Monday must be loaded, not silently omitted.');
    assert.ok(options.shifts.some(shift=>shift.person==='p1' && shift.date<options.weekStart));
    assert.equal(new Set(options.shifts.map(shift=>shift.id)).size,options.shifts.length,'Upcoming and visible ranges must merge by identity.');
  }
});

test('six-row months retain the final week and all same-day shifts without data caps',()=>{
  const app = application('2026-10-30');
  Object.assign(app.state,{role:'employee',employeeDate:'2026-08-12',employeeWeek:'2026-08-10',employeeView:'month'});
  const day = '2026-08-31';
  for (let index=0;index<8;index+=1) app.state.edits['many-'+index]={id:'many-'+index,person:'p0',date:day,site:0,start:'16:00',end:'17:00',note:''};
  app.publishFixture();app.renderEmployee(); const options = app.last(), range = Calendar.range('month','2026-08-12');
  assert.equal(range.from,'2026-07-27'); assert.equal(range.to,'2026-09-06');
  assert.equal(options.shifts.filter(shift=>shift.date===day && shift.person==='p0').length,8);
  assert.ok(options.shifts.some(shift=>shift.person==='p1' && shift.date==='2026-09-04'));
});

test('actual moved exceptions load by destination date even when their anchor lies outside the month',()=>{
  const app = application(), original = app.at('2027-01-05');
  app.state.edits[original.id]={...original,date:'2026-10-02'};app.publishFixture();
  Object.assign(app.state,{role:'employee',employeeDate:'2026-10-29',employeeWeek:'2026-10-26',employeeView:'month'});
  app.renderEmployee(); const moved = app.last().shifts.find(shift=>shift.id===original.id);
  assert.ok(moved); assert.equal(moved.date,'2026-10-02'); assert.equal(moved.seriesId,'jonas-plan');
  assert.equal(app.last().shifts.filter(shift=>shift.id===original.id).length,1);
});

test('view and date callbacks preserve the exact focus date, derive weeks and close stale detail',()=>{
  const app = application(); Object.assign(app.state,{role:'employee',employeeShift:'previous'});
  app.renderEmployee();
  assert.equal(app.last().onDateChange('2027-01-01',{view:'day'}),true);
  assert.equal(app.state.employeeDate,'2027-01-01'); assert.equal(app.state.employeeWeek,'2026-12-28'); assert.equal(app.state.employeeView,'day'); assert.equal(app.state.employeeShift,null);
  assert.equal(app.last().focusDate,'2027-01-01'); assert.equal(app.last().view,'day');
  app.state.employeeShift='previous';
  assert.equal(app.last().onViewChange('month'),true);
  assert.equal(app.state.employeeDate,'2027-01-01'); assert.equal(app.state.employeeView,'month'); assert.equal(app.state.employeeShift,null);
  assert.equal(app.last().onWeekChange('2027-01-04'),true);
  assert.equal(app.state.employeeDate,'2027-01-04'); assert.equal(app.state.employeeWeek,'2027-01-04');
  assert.equal(app.last().view,'month','The legacy week callback must not unexpectedly force a different view.');
});

test('invalid or out-of-period navigation is an unchanged no-op and month ranges are clipped to bounds',()=>{
  const app = application(); Object.assign(app.state,{role:'employee',employeeShift:'selected'}); app.renderEmployee();
  const before = plain(app.state), writes = app.writes.length, renders = app.views.length;
  for (const value of ['2026-02-30','2025-10-26','2027-11-01','not-a-date']) assert.equal(app.last().onDateChange(value),false);
  assert.equal(app.last().onDateChange('2026-12-01',{view:'year'}),false); assert.equal(app.last().onViewChange('year'),false);
  assert.deepEqual(plain(app.state),before); assert.equal(app.writes.length,writes); assert.equal(app.views.length,renders);
  for (const focus of ['2025-10-27','2027-10-31']) {
    assert.equal(app.changeEmployeeDate(focus,{view:'month'}),true);
    const options = app.last();
    assert.ok(options.shifts.every(shift=>shift.date>=options.minDate && shift.date<=options.maxDate));
  }
});

test('opening a next shift outside the month moves calendar focus before rendering while foreign shifts are refused',()=>{
  const app = application(); Object.assign(app.state,{role:'employee',employeeDate:'2026-10-29',employeeWeek:'2026-10-26'}); app.renderEmployee();
  const next = app.at('2026-12-08'); app.last().onOpenShift(next.id);
  assert.equal(app.state.employeeShift,next.id); assert.equal(app.state.employeeDate,next.date); assert.equal(app.state.employeeWeek,'2026-12-07');
  assert.equal(app.last().focusDate,next.date); assert.equal(app.last().selectedShiftId,next.id); assert.equal(app.last().view,'month');
  const before = plain(app.state), writes = app.writes.length;
  app.last().onOpenShift(app.at('2026-12-08','p1').id);
  assert.deepEqual(plain(app.state),before); assert.equal(app.writes.length,writes);
  app.last().onOpenShift(null); assert.equal(app.state.employeeShift,null); assert.equal(app.state.employeeDate,next.date);
});

test('legacy detail state migrates to a closed month focused on the occurrence actual date without losing completions',()=>{
  const app = application(), original = progressFixture(app);
  app.state.edits[original.id]={...original,date:'2027-01-05'};app.publishFixture();
  const saved = plain(app.state);
  delete saved.employeeCalendarVersion; delete saved.employeeDate; delete saved.employeeView;
  Object.assign(saved,{role:'employee',employeeShift:original.id,employeeWeek:'2026-11-02'});
  const restored = application(); restored.restore({privateContent:{studio:saved}});
  assert.equal(restored.state.employeeCalendarVersion,1); assert.equal(restored.state.employeeView,'month');
  assert.equal(restored.state.employeeShift,null); assert.equal(restored.state.employeeDate,'2027-01-05'); assert.equal(restored.state.employeeWeek,'2027-01-04');
  assert.deepEqual(plain(restored.state.checklistProgress),saved.checklistProgress);
  assert.equal(restored.checklistView(restored.shiftById(original.id)).checked,1);
  restored.renderEmployee(); assert.equal(restored.last().selectedShiftId,null);
});

test('new view/date preferences save and restore consistently with durable checklist state',async()=>{
  const app = application(); progressFixture(app); app.state.role='employee';
  app.changeEmployeeDate('2027-03-31',{view:'day'}); await app.save();
  const payload = app.writes.at(-1), restored = application(); restored.restore(payload);
  assert.equal(restored.state.employeeView,'day'); assert.equal(restored.state.employeeDate,'2027-03-31'); assert.equal(restored.state.employeeWeek,'2027-03-29');
  assert.equal(restored.state.employeeCalendarVersion,1); assert.equal(restored.state.role,'employee');
  assert.deepEqual(plain(restored.state.checklistProgress),plain(app.state.checklistProgress));
  restored.renderEmployee(); assert.equal(restored.last().view,'day'); assert.equal(restored.last().focusDate,'2027-03-31');
});

test('entering employee role clears previous details and anchors to the admin week without changing progress',()=>{
  const app = application(); progressFixture(app);
  Object.assign(app.state,{role:'admin',week:2,employeeShift:'jonas-plan@2026-10-27',employeeDate:'2027-02-10',employeeWeek:'2027-02-08',employeeView:'week'});
  const progress = plain(app.state.checklistProgress); app.setRole('employee');
  assert.equal(app.state.employeeShift,null); assert.equal(app.state.employeeDate,'2026-11-09'); assert.equal(app.state.employeeWeek,'2026-11-09');
  assert.equal(app.state.employeeView,'week'); assert.equal(app.last().selectedShiftId,null);
  assert.deepEqual(plain(app.state.checklistProgress),progress);
});
