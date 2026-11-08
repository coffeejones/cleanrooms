const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Description = require('../src/description-model.js');

const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf("  staff.forEach(person => { const option");
const saveStart=source.indexOf('  function saveShift(event) {');
const saveEnd=source.indexOf("  q('#cs-operations-tabs')",saveStart);
const deleteStart=source.indexOf("  q('#cs-delete').addEventListener('click',");
const deleteEnd=source.indexOf("  q('#cs-close')",deleteStart);
const undoHandler=source.match(/q\('#cs-undo'\)\.addEventListener\('click',([^\n]+)\);/);
assert.ok(boundary>0&&saveStart>boundary&&saveEnd>saveStart&&deleteStart>saveStart&&deleteEnd>deleteStart&&undoHandler,
  'The employee harness must find production setup, editor save/delete and undo.');
const plain=value=>JSON.parse(JSON.stringify(value));

class Element {
  constructor() { this.value='';this.hidden=true;this.checked=false;this.dataset={};this.children=[];this.handlers=new Map();this.disabled=false;this.isConnected=true; }
  get options() { return this.children; }
  setAttribute() {}
  removeAttribute() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=children; }
  addEventListener(type,handler) { this.handlers.set(type,handler); }
  click() { this.handlers.get('click')?.({preventDefault(){}}); }
  focus() {}
  scrollIntoView() {}
  reportValidity() { return true; }
}

// Production persistence payloads, checklist writes, commit reconciliation,
// editor saves/deletes, demo lifecycle and undo run unchanged. Only painting,
// the rich-editor widget and availability preview DOM are replaced.
function application() {
  const controls=new Map(),writes=[];let editorData={note:'',noteRich:''};
  const control=selector=>{if(!controls.has(selector))controls.set(selector,new Element());return controls.get(selector);};
  const root={querySelector:control,querySelectorAll:()=>[]};
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    CleanRoomsPlanningScope:require('../src/planning-scope.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{openai:{setWidgetState:payload=>{writes.push(plain(payload));return Promise.resolve();}}},
    document:{getElementById:()=>root,createElement:()=>new Element(),createTextNode:text=>({textContent:String(text),children:[]})},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:Description,
    CleanRoomsChecklist:require('../src/checklist-progress.js'),CleanRoomsCalendar:{revealDay(){}},
    CleanRoomsRichEditor:{mount:()=>({setContent:shift=>{editorData={note:shift.note||'',noteRich:shift.noteRich||''};},getData:()=>({...editorData})})}
  });
  const instrumentation=`
    render=()=>{};renderEmployee=()=>{};renderCloudStatus=()=>{};
    updatePreview=()=>{};updateBulkPreview=()=>{};renderDemoEditorGuide=()=>{};closeDemoSheets=()=>{};
    refreshStaffing=()=>{selectedStaffing=null;};
    const undoAction=${undoHandler[1]};
    globalThis.employeeTest={
      publishFixture:()=>{
        const role=state.role;state.role='admin';
        for(const from of ['2025-10-27','2026-10-26','2027-10-25']){
          state.publications=Publication.publish(state,{from,to:addDays(from,363),siteIds:[0,1,2],includeDependencies:true,actor:{userId:'fixture-planner',name:'Testplanlægger'},at:'2026-10-30T12:00:00.000Z'}).studio.publications;
        }
        state.role=role;
      },
state,save,restore,snapshot,shiftsInRange,shiftById,checklistView,
      toggleEmployeeTask,setRole,ensureEmployeeExamples,weekPlan,changesForWeek,openEditor,saveShift,
      bulkProposal,saveBulk,installDemoFixture,exitDemo,undo:undoAction,getUndo:()=>lastUndo,
      setCloud:(loaded,status)=>{cloudLoaded=loaded;cloudStatus={state:status};},
      select:(members,operation,copyIds)=>{activeBulk={members:clone(members),operation,
        firstDate:members.map(shift=>shift.date).sort()[0],copyIds:copyIds||{}};q('#cs-bulk-layer').hidden=false;}
    };
  `;
  vm.runInContext(source.slice(0,boundary)+source.slice(saveStart,saveEnd)+source.slice(deleteStart,deleteEnd)+instrumentation+'\n})();',
    context,{filename:'app.js (employee integration)'});
  const app=context.employeeTest;
  return {...app,control,writes,
    at:(day,person='p0')=>app.shiftsInRange(day,day).find(shift=>shift.person===person),
    setRich:noteRich=>{editorData={note:Description.text(noteRich),noteRich};},
    saveShiftAction:()=>app.saveShift({preventDefault(){}}),
    beginBulk:(members,operation,target)=>{app.select(members,operation,Object.fromEntries(members.map((member,index)=>[member.id,'copy-employee-'+index])));control('#cs-bulk-date').value=target;},
    saveBulkAction:()=>app.saveBulk({preventDefault(){}}),
    toggle:async(shift,index,checked=true)=>{
      app.state.employeePerson=shift.person;app.setRole('employee');
      const view=app.checklistView(shift);
      return app.toggleEmployeeTask(shift.id,view.tasks[index].key,checked,view.signature);
    }
  };
}

function template(...labels) {
  return Description.encode({type:'doc',content:[{type:'taskList',content:labels.map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]});
}
const originalTemplate=template('Rengør køkkenet 🧽','Tøm affald','Lås døren');
function instructed() {
  const app=application();Object.assign(app.state.series[0],{note:Description.text(originalTemplate),noteRich:originalTemplate});app.publishFixture();return app;
}
const checkCount=(app,id)=>app.checklistView(app.shiftById(id)).checked;

test('employee example initialization is explicit, idempotent and preserves existing planner instructions',()=>{
  const app=application();
  assert.equal(app.checklistView(app.at('2026-10-27')).total,0);
  assert.equal(app.state.employeeExamplesVersion,0);assert.deepEqual(Object.keys(app.state.weekPlans),[]);
  app.ensureEmployeeExamples();
  assert.equal(app.checklistView(app.at('2026-10-27')).total,3);
  const initialized=plain(app.state.series);app.ensureEmployeeExamples();assert.deepEqual(plain(app.state.series),initialized);
  assert.equal(app.state.employeeExamplesVersion,1);assert.equal(app.changesForWeek().length,0);
  const custom=instructed();custom.ensureEmployeeExamples();assert.equal(custom.state.series[0].noteRich,originalTemplate);
});

test('seeding instructions after initial baselines exist does not manufacture pending plan changes',()=>{
  const app=application(),weeks=[0,1,10,25];
  for(const week of weeks) app.weekPlan(week);
  const before=plain(app.state.weekPlans);
  app.ensureEmployeeExamples();
  for(const week of weeks) {
    const plan=app.weekPlan(week),initial=before[String(week)].baseline;
    assert.equal(app.changesForWeek(week).length,0);
    assert.equal(plan.changes,0);assert.equal(plan.published,false);assert.equal(plan.baselineKind,'initial');
    for(const shift of plan.baseline) {
      const previous=initial.find(item=>item.id===shift.id);
      const {note,noteRich,...actualFields}=plain(shift),{note:oldNote,noteRich:oldRich,...previousFields}=previous;
      assert.deepEqual(actualFields,previousFields);
      if(shift.person) {
        assert.ok(noteRich);assert.equal(noteRich,app.shiftById(shift.id).noteRich);
        assert.equal(note,app.shiftById(shift.id).note);assert.equal(oldNote,'');assert.equal(oldRich,undefined);
      }
    }
  }
  assert.equal(app.getUndo(),null);
});

test('instruction seeding preserves published or custom baseline descriptions and their real differences',()=>{
  for(const flags of [{published:true,baselineKind:'published'},{published:false,baselineKind:'published'},{published:true,baselineKind:'initial'}]) {
    const app=application(),plan=app.weekPlan();Object.assign(plan,flags);
    const baseline=plain(plan.baseline);app.ensureEmployeeExamples();
    assert.deepEqual(plain(plan.baseline),baseline);
    const changes=app.changesForWeek(),assignedIds=baseline.filter(shift=>shift.person).map(shift=>shift.id).sort();
    assert.deepEqual(plain(changes.map(change=>change.id)).sort(),assignedIds);
    assert.ok(changes.every(change=>change.before.person&&change.before.note===''&&change.after.noteRich));
    assert.ok(changes.every(change=>plain(change.fields).join(',')==='note,noteRich'));
  }
  const custom=application(),plan=custom.weekPlan(),record=plan.baseline.find(shift=>shift.person==='p0');
  record.note='Instruktion fra den oprindelige plan';
  const original=plain(record);custom.ensureEmployeeExamples();
  assert.deepEqual(plain(plan.baseline.find(shift=>shift.id===record.id)),original);
  assert.equal(custom.changesForWeek().find(change=>change.id===record.id).before.note,original.note);
});

test('employee checks save and restore independently of plan history, draft counters and template JSON',async()=>{
  const app=instructed(),shift=app.at('2026-10-27');app.weekPlan();
  const before=plain(app.snapshot());
  assert.equal(await app.toggle(shift,0),true);
  app.state.employeeShift=shift.id;await app.save();
  assert.equal(checkCount(app,shift.id),1);assert.equal(app.getUndo(),null);
  assert.equal(app.weekPlan().changes,0);assert.equal(app.changesForWeek().length,0);
  const after=plain(app.snapshot());delete before.checklistProgress;delete after.checklistProgress;
  assert.deepEqual(after,before);assert.equal(app.state.series[0].noteRich,originalTemplate);
  const saved=app.writes.at(-1),resumed=application();resumed.restore(saved);
  assert.equal(checkCount(resumed,shift.id),1);assert.equal(resumed.state.role,'employee');
  assert.equal(resumed.state.employeePerson,'p0');assert.equal(resumed.state.employeeShift,shift.id);
  assert.deepEqual(plain(resumed.snapshot().checklistProgress),plain(app.state.checklistProgress));
  assert.equal(resumed.changesForWeek().length,0);
});

for(const operation of ['move','copy']) test('actual series occurrence '+operation+' preserves identity rules and planner undo',async()=>{
  const app=instructed(),shift=app.at('2026-10-27'),target='2027-07-27';
  await app.toggle(shift,0);app.setRole('admin');
  app.beginBulk([shift],operation,target);assert.equal(app.bulkProposal().ok,true);app.saveBulkAction();
  const destination=app.at(target),expected=operation==='move'?1:0;
  assert.equal(app.checklistView(destination).checked,expected);
  assert.equal(destination.noteRich,originalTemplate);
  assert.equal(destination.id,operation==='move'?shift.id:'copy-employee-0');
  assert.equal(destination.seriesId,operation==='move'?'jonas-plan':undefined);
  assert.equal(app.changesForWeek(39).length,1);
  await app.toggle(destination,1);app.undo();
  assert.equal(app.at(target),undefined);
  assert.equal(checkCount(app,shift.id),operation==='move'?2:1);
  assert.equal(app.changesForWeek(39).length,0);
  if(operation==='copy') assert.ok(Object.values(app.state.checklistProgress).every(entry=>entry.shiftId!==destination.id));
});

test('task wording edits reconcile only the changed task and undo restores its prior completion',async()=>{
  const app=instructed(),shift=app.at('2026-10-27'),unseen=app.at('2027-03-04');
  await app.toggle(shift,0);await app.toggle(shift,1);await app.toggle(unseen,2);
  app.setRole('admin');app.openEditor(app.shiftById(shift.id));
  const changed=template('Rengør køkkenet 🧽','Tøm alt affald','Lås døren');app.setRich(changed);app.saveShiftAction();
  assert.deepEqual(plain(app.checklistView(app.shiftById(shift.id)).tasks.map(item=>item.checked)),[true,false,false]);
  assert.equal(checkCount(app,unseen.id),1);
  assert.ok(app.changesForWeek(0).some(entry=>entry.id===shift.id&&entry.fields.includes('noteRich')));
  app.undo();assert.equal(checkCount(app,shift.id),2);assert.equal(checkCount(app,unseen.id),1);
  assert.equal(app.shiftById(shift.id).noteRich,originalTemplate);
});

test('reassignment and actual delete prune occurrence progress while undo retains unrelated weeks',async()=>{
  const app=instructed(),shift=app.at('2026-10-27'),unseen=app.at('2027-03-04');
  await app.toggle(shift,0);await app.toggle(unseen,2);app.setRole('admin');
  app.openEditor(app.shiftById(shift.id));app.control('#cs-edit-person').value='p4';app.saveShiftAction();
  assert.equal(app.shiftById(shift.id).person,'p4');assert.equal(checkCount(app,shift.id),0);
  assert.ok(Object.values(app.state.checklistProgress).every(entry=>entry.shiftId!==shift.id));
  assert.equal(checkCount(app,unseen.id),1);app.undo();assert.equal(checkCount(app,shift.id),1);
  app.openEditor(app.shiftById(shift.id));app.control('#cs-delete').click();
  assert.equal(app.shiftById(shift.id),null);
  assert.ok(Object.values(app.state.checklistProgress).every(entry=>entry.shiftId!==shift.id));
  assert.equal(checkCount(app,unseen.id),1);app.undo();assert.equal(checkCount(app,shift.id),1);
});

for(const checked of [true,false]) test('a later employee '+(checked?'check':'uncheck')+' survives undo of an unrelated planner move',async()=>{
  const app=instructed(),unchanged=app.at('2026-10-27'),moved=app.at('2026-10-29');
  if(!checked) await app.toggle(unchanged,0);
  app.setRole('admin');app.beginBulk([moved],'move','2026-10-31');app.saveBulkAction();
  assert.ok(app.at('2026-10-31'));
  await app.toggle(app.shiftById(unchanged.id),0,checked);app.undo();
  assert.equal(checkCount(app,unchanged.id),Number(checked));
  assert.equal(app.shiftById(moved.id).date,'2026-10-29');
  assert.equal(app.getUndo(),null);
});

for(const scope of ['all','future']) test('series '+scope+' edits reconcile matching tasks and remove obsolete occurrence progress',async()=>{
  const app=instructed(),past=app.at('2026-10-27'),future=app.at('2027-01-05');
  await app.toggle(past,0);await app.toggle(future,0);await app.toggle(future,1);
  const before=plain(app.state.checklistProgress);app.setRole('admin');app.openEditor(future,null,{scope});
  app.setRich(template('Rengør køkkenet 🧽','Tøm alt affald','Lås døren'));app.saveShiftAction();
  const next=app.at(future.date);
  assert.equal(app.checklistView(next).checked,scope==='all'?1:0);
  assert.equal(checkCount(app,past.id),1);
  if(scope==='future') {
    assert.notEqual(next.id,future.id);
    assert.ok(Object.values(app.state.checklistProgress).every(entry=>entry.shiftId!==future.id));
  }
  app.undo();assert.deepEqual(plain(app.state.checklistProgress),before);
  assert.equal(checkCount(app,future.id),2);
});

test('demo switches and serialized exit restore exact original completion, employee preferences and planner undo',async()=>{
  const app=instructed(),shift=app.at('2026-10-27');await app.toggle(shift,0);
  app.setRole('admin');app.beginBulk([shift],'move','2026-10-31');app.saveBulkAction();
  await app.toggle(app.shiftById(shift.id),1);
  Object.assign(app.state,{employeeWeek:'2026-11-02',employeeDate:'2026-11-02',employeeShift:shift.id});
  const original=plain(app.state),undo=plain(app.getUndo());
  assert.equal(app.installDemoFixture('hours'),true);assert.deepEqual(plain(app.state.checklistProgress),{});
  Object.assign(app.state.series[0],{note:Description.text(originalTemplate),noteRich:originalTemplate});
  await app.toggle(app.at('2026-10-27'),2);
  app.installDemoFixture('request');assert.deepEqual(plain(app.state.checklistProgress),{});
  assert.deepEqual(plain(app.state.demoSession.backup.checklistProgress),original.checklistProgress);
  const resumed=application();resumed.restore({privateContent:{studio:plain(app.state)}});resumed.exitDemo();
  assert.deepEqual(plain(resumed.state),original);assert.deepEqual(plain(resumed.getUndo()),undo);
  resumed.undo();assert.equal(resumed.shiftById(shift.id).date,'2026-10-27');assert.equal(checkCount(resumed,shift.id),2);
});

test('admin, wrong-assignee, stale-list and unsaved-cloud toggles leave progress unchanged',async()=>{
  const app=instructed(),shift=app.at('2026-10-27'),view=app.checklistView(shift),key=view.tasks[0].key;
  assert.equal(await app.toggleEmployeeTask(shift.id,key,true,view.signature),false);
  app.setRole('employee');app.state.employeePerson='p1';
  assert.equal(await app.toggleEmployeeTask(shift.id,key,true,view.signature),false);
  app.state.employeePerson='p0';app.setCloud(false,'saved');
  assert.equal(await app.toggleEmployeeTask(shift.id,key,true,view.signature),false);
  app.setCloud(true,'error');assert.equal(await app.toggleEmployeeTask(shift.id,key,true,view.signature),false);
  app.setCloud(true,'saved');app.state.series[0].noteRich=template('Changed','Tøm affald','Lås døren');app.publishFixture();
  assert.equal(await app.toggleEmployeeTask(shift.id,key,true,view.signature),false);
  assert.deepEqual(plain(app.state.checklistProgress),{});assert.equal(app.getUndo(),null);
});
