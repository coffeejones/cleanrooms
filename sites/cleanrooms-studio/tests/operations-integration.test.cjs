const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Coverage = require('../src/coverage-engine.js');
const Demo = require('../src/demo-fixtures.js');

const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf("  staff.forEach(person => { const option");
const undoHandler = source.match(/q\('#cs-undo'\)\.addEventListener\('click',([^\n]+)\);/);
const saveNeedStart = source.indexOf('  function saveNeedForm(event) {');
const saveNeedEnd = source.indexOf("\n  q('#cs-need-save').addEventListener",saveNeedStart);
assert.ok(boundary > 0 && undoHandler && saveNeedStart > boundary && saveNeedEnd > saveNeedStart,'The operations harness must find the production setup boundary, undo action and explicit need-save handler.');
const saveNeedSource = source.slice(saveNeedStart,saveNeedEnd);
const plain = value => JSON.parse(JSON.stringify(value));

// Use the real operation, transaction and lifecycle functions. Only DOM painting
// and external persistence are isolated; production sources gain no test hooks.
function application() {
  const controls = new Map(), accountCalls=[];
  const control = selector => {
    if (!controls.has(selector)) controls.set(selector,{
      value:'',hidden:true,disabled:false,dataset:{},isConnected:true,valid:true,children:[],get options(){return this.children;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
      setAttribute(){},removeAttribute(){},focus(){this.focused=true;},scrollIntoView(options){this.scrollOptions=options;},
      reportValidity(){this.validityChecks=(this.validityChecks || 0) + 1;return this.valid;}
    });
    return controls.get(selector);
  };
  const root = {querySelector:control,querySelectorAll:()=>[]};
  const context = vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,accountCalls,
    window:{},document:{getElementById:()=>root,createElement:()=>control('created-'+controls.size),createTextNode:text=>({textContent:String(text),children:[]})},
    CleanRoomsSeries:require('../src/series-engine.js'),
    CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),
    CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsDemo:Demo,CleanRoomsCoverage:Coverage,CleanRoomsCalendar:{revealDay(){}}
  });
  vm.runInContext(source.slice(0,boundary) + `
    render = () => {}; save = async () => true; notify = () => {};
    cloudLoaded=true;cloudCapabilities={...cloudCapabilities,plan:true};
    closeEditor = () => {}; closeGroupEditor = () => {}; closeBulkEditor = () => {};
    closeChanges = () => {}; closeReview = () => {}; closeOperationsSheets = () => {};
    closeDemoSheets = () => {}; renderOperations = () => {}; renderNeeds = () => {};
    state.demoSeed=true;
    persistence={publish:async()=>{throw Error('Blocked publication must not reach persistence.');},action:async(action,payload)=>{
      accountCalls.push({action,payload:clone(payload)});
      if(action!=='leaveDecide')throw Error('Unexpected account action in operations harness: '+action);
      const request=leaveRequests.find(item=>item.id===payload.id);
      if(!request||payload.version!==(request.version||1))return {ok:false,status:409,message:'Stale absence request'};
      return {ok:true,request:{...clone(request),status:payload.status,version:(request.version||1)+1,decision:{status:payload.status,reason:payload.reason,decidedBy:{userId:'server-planner',name:'Planlægger'},decidedAt:'2026-11-03T00:00:00.000Z'}}};
    }};
    const operationOpenings = [];
    openOperations = trigger => operationOpenings.push(trigger);
    ${saveNeedSource}
    const undoAction = ${undoHandler[1]};
    globalThis.operationsTest = {
      state,snapshot,shiftsInRange,weekPlan,changesForWeek,coverageReport,operationsModel,
      replacementContext,replacementProposal,replacementCandidates,applyReplacement,
      applyNeedRule,removeNeedRule,decideLeave,validCoverageRules,validDemoSession,saveNeedForm,
      setNeedDays:days => needDays = new Set(days),
      installDemoFixture,exitDemo,restore,weekReview,publishReviewedWeek,undo:undoAction,
      getOperationOpenings:() => operationOpenings,
      getUndo:() => lastUndo,setUndo:value => lastUndo = clone(value)
    };
  })();`,context,{filename:'app.js (operations integration)'});
  const app = context.operationsTest;
  return {...app,control,accountCalls,at:(day,person) => app.shiftsInRange(day,day).find(shift => shift.person === person)};
}

const need = (overrides = {}) => ({id:'saturday-north',site:0,weekdays:[5],start:'09:00',end:'13:00',required:1,...overrides});
const shift = (id,person,date,start,end,site = 0) => ({id,person,date,start,end,site,note:''});
const coverageTarget = app => app.operationsModel().items.find(item => item.kind === 'coverage');

test('need changes and removal are undoable without inventing shift changes or publication changes',()=>{
  const app = application(); app.state.coverageRules = [];
  const shifts = plain(app.shiftsInRange('2026-10-26','2026-11-01'));
  const plan = app.weekPlan(); plan.published = true; plan.baselineKind = 'published';
  const plans = plain(app.state.weekPlans);
  assert.equal(app.applyNeedRule(need()).ok,true);
  assert.deepEqual(plain(app.state.coverageRules),[need()]);
  assert.deepEqual(plain(app.shiftsInRange('2026-10-26','2026-11-01')),shifts);
  assert.deepEqual(plain(app.state.weekPlans),plans);
  assert.equal(app.changesForWeek().length,0);
  app.undo(); assert.deepEqual(plain(app.state.coverageRules),[]);
  app.applyNeedRule(need());
  assert.equal(app.applyNeedRule(need({required:2})).ok,true);
  assert.equal(app.state.coverageRules[0].required,2);
  app.undo(); assert.equal(app.state.coverageRules[0].required,1);
  assert.equal(app.removeNeedRule(need().id),true);
  assert.equal(app.state.coverageRules.length,0);
  app.undo(); assert.deepEqual(plain(app.state.coverageRules),[need()]);
  const before = plain(app.snapshot()), undo = plain(app.getUndo());
  assert.equal(app.removeNeedRule('unknown'),false);
  assert.deepEqual(plain(app.snapshot()),before); assert.deepEqual(plain(app.getUndo()),undo);
});

test('need rules reject true same-site intersections while allowing touching times and other days or sites',()=>{
  const app = application(); app.state.coverageRules = [need()];
  const before = plain(app.snapshot());
  assert.equal(app.applyNeedRule(need({id:'overlap',start:'12:00',end:'14:00'})).ok,false);
  assert.deepEqual(plain(app.snapshot()),before); assert.equal(app.getUndo(),null);
  for (const rule of [need({id:'touching',start:'13:00',end:'15:00'}),need({id:'sunday',weekdays:[6]}),need({id:'other-site',site:1})]) {
    assert.equal(app.applyNeedRule(rule).ok,true);
  }
  assert.equal(app.validCoverageRules([need(),need({id:'bad',start:'12:00',end:'14:00'})]),false);
});

test('the explicit need-save handler validates native fields and rule conflicts before consuming editor input',()=>{
  const app = application(); app.state.coverageRules = [need()];
  const form = app.control('#cs-needs-form'), error = app.control('#cs-need-error');
  const fields = {'#cs-need-id':'from-ui','#cs-need-site':'0','#cs-need-start':'12:00','#cs-need-end':'14:00','#cs-need-count':'3'};
  for (const [selector,value] of Object.entries(fields)) app.control(selector).value = value;
  app.setNeedDays([5]);
  const before = plain(app.snapshot());
  let prevented = 0;
  const event = {preventDefault(){prevented += 1;}};
  form.valid = false;
  app.saveNeedForm(event);
  assert.equal(prevented,1); assert.equal(form.validityChecks,1);
  assert.deepEqual(plain(app.snapshot()),before); assert.equal(app.getUndo(),null);
  assert.equal(app.control('#cs-need-id').value,'from-ui','Native validation failure must preserve draft input.');
  form.valid = true;
  app.saveNeedForm(event);
  assert.equal(prevented,2); assert.equal(form.validityChecks,2);
  assert.deepEqual(plain(app.snapshot()),before); assert.equal(app.getUndo(),null);
  assert.equal(error.hidden,false); assert.match(error.textContent,/overlapper/);
  assert.deepEqual(plain(error.scrollOptions),{block:'nearest'});
  app.control('#cs-need-site').value = '2';
  app.control('#cs-need-start').value = '15:00'; app.control('#cs-need-end').value = '17:00';
  app.setNeedDays([6,5]);
  app.saveNeedForm(event);
  assert.equal(prevented,3); assert.equal(form.validityChecks,3);
  assert.deepEqual(plain(app.state.coverageRules),[need(),need({id:'from-ui',site:2,weekdays:[5,6],start:'15:00',end:'17:00',required:3})]);
  assert.deepEqual(plain(app.getUndo()),before);
  assert.equal(error.hidden,true); assert.equal(error.textContent,'');
  assert.equal(app.control('#cs-need-id').value,'','Successful saves reset the form for the next rule.');
  assert.equal(app.control('#cs-need-count').value,'1');
  assert.deepEqual(plain(app.control('#cs-needs-list').scrollOptions),{block:'start'});
  assert.equal(app.control('#cs-needs-close').focused,true);
});

test('a partial coverage deficit creates only its uncovered segment and a stale repeat cannot create duplicates',()=>{
  const app = application(); app.state.coverageRules = [need()];
  app.state.edits.support = shift('support','p0','2026-10-31','09:00','11:00');
  const target = coverageTarget(app), context = app.replacementContext(target);
  assert.equal(target.start,'11:00'); assert.equal(target.end,'13:00');
  assert.equal(context.mode,'create'); assert.equal(context.shift.start,'11:00'); assert.equal(context.shift.end,'13:00');
  assert.equal(app.replacementContext(target).shift.id,context.shift.id,'Preview identity must remain stable before creation.');
  app.weekPlan(); const before = plain(app.snapshot());
  const result = app.applyReplacement(target,'p4',context);
  assert.equal(result.ok,true);
  assert.equal(result.shift.id,context.shift.id); assert.equal(result.shift.seriesId,undefined);
  assert.equal(app.coverageReport('2026-10-31','2026-10-31').totals.deficitMinutes,0);
  assert.equal(app.shiftsInRange('2026-10-31','2026-10-31').filter(item => item.id === result.shift.id).length,1);
  const filled = plain(app.snapshot());
  assert.equal(app.applyReplacement(target,'p3',context).ok,false);
  assert.deepEqual(plain(app.snapshot()),filled);
  app.undo(); assert.deepEqual(plain(app.snapshot()),before);
});

test('coverage filling reuses a covering open shift without adding another shift or trimming its time',()=>{
  const app = application(); app.state.coverageRules = [need()];
  app.state.edits.open = shift('existing-open','','2026-10-31','08:00','14:00');
  app.state.edits.support = shift('support','p0','2026-10-31','09:00','11:00');
  const target = coverageTarget(app), context = app.replacementContext(target);
  assert.equal(context.mode,'assign'); assert.equal(context.shift.id,'existing-open');
  const count = app.shiftsInRange(target.date,target.date).length;
  assert.equal(app.applyReplacement(target,'p4',context).ok,true);
  const reused = app.shiftsInRange(target.date,target.date).find(item => item.id === 'existing-open');
  assert.equal(reused.person,'p4'); assert.equal(reused.start,'08:00'); assert.equal(reused.end,'14:00');
  assert.equal(app.shiftsInRange(target.date,target.date).length,count);
});

test('a multi-person gap requires a fresh context after each assignment and never duplicates a person',()=>{
  const app = application(); app.state.coverageRules = [need({required:2})];
  const target = coverageTarget(app), first = app.replacementContext(target);
  assert.equal(app.applyReplacement(target,'p4',first).ok,true);
  const afterFirst = plain(app.snapshot());
  assert.equal(app.applyReplacement(target,'p3',first).ok,false,'A still-open segment does not authorize reusing a stale creation identity.');
  assert.deepEqual(plain(app.snapshot()),afterFirst);
  const fresh = app.replacementContext(target);
  assert.equal(fresh.valid,true); assert.notEqual(fresh.shift.id,first.shift.id);
  assert.equal(app.applyReplacement(target,'p4',fresh).ok,false,'The first employee cannot be counted twice in the same segment.');
  assert.equal(app.applyReplacement(target,'p3',fresh).ok,true);
  const report = app.coverageReport('2026-10-31','2026-10-31');
  assert.equal(report.totals.deficitMinutes,0);
  const assigned = app.shiftsInRange('2026-10-31','2026-10-31').filter(item => item.id === first.shift.id || item.id === fresh.shift.id);
  assert.equal(assigned.length,2); assert.equal(new Set(assigned.map(item => item.person)).size,2);
});

test('replacing a series occurrence changes only that occurrence and preserves another shift on the same day',()=>{
  const app = application(), original = app.at('2026-10-27','p0'), target = {kind:'shift',shift:plain(original)};
  app.state.edits.extra = shift('extra','p0',original.date,'18:00','19:00');
  const series = plain(app.state.series), next = plain(app.at('2026-10-29','p0'));
  assert.equal(app.replacementProposal(target,'p0').ok,false);
  app.weekPlan(); const before = plain(app.snapshot());
  const result = app.applyReplacement(target,'p4',app.replacementContext(target));
  assert.equal(result.ok,true); assert.equal(result.shift.id,original.id); assert.equal(result.shift.seriesId,original.seriesId);
  assert.deepEqual(plain(app.state.series),series);
  assert.deepEqual(plain(app.at('2026-10-29','p0')),next);
  assert.equal(app.state.edits.extra.person,'p0');
  assert.equal(app.shiftsInRange(original.date,original.date).find(item => item.id === original.id).person,'p4');
  app.undo(); assert.deepEqual(plain(app.snapshot()),before);
});

test('replacement candidates use hidden all-site work and approved leave while target hours remain advisory',()=>{
  const app = application(), open = app.shiftsInRange('2026-10-28','2026-10-28').find(item => !item.person);
  const target = {kind:'shift',shift:plain(open)};
  app.state.site = '1'; app.state.search = 'Lea'; app.state.onlyOpen = true;
  app.state.edits.hidden = shift('hidden','p0',open.date,'08:00','09:00',2);
  const overlap = app.replacementProposal(target,'p0');
  assert.equal(overlap.ok,false); assert.equal(overlap.assessment.conflicts[0].other.site,2);
  assert.equal(app.replacementProposal(target,'p6').ok,false);
  assert.ok(app.replacementProposal(target,'p6').assessment.conflicts.some(item => item.type === 'leave'));
  delete app.state.edits.hidden;
  const available = app.replacementProposal(target,'p0');
  assert.equal(available.ok,true); assert.equal(available.assessment.currentMinutes,16 * 60); assert.equal(available.assessment.projectedMinutes,23 * 60);
  assert.equal(available.assessment.overTargetWeeks.length,1);
});

test('stale captured assignments and changed needs reject replacements without mutating state or undo',()=>{
  const app = application(), original = app.at('2026-10-27','p0'), target = {kind:'shift',shift:plain(original)};
  const context = app.replacementContext(target);
  app.state.edits[original.id] = {...original,note:'Changed after picker opened'};
  const before = plain(app.snapshot());
  assert.equal(app.applyReplacement(target,'p4',context).ok,false);
  assert.deepEqual(plain(app.snapshot()),before); assert.equal(app.getUndo(),null);
  app.state.coverageRules = [need()];
  const gap = coverageTarget(app), expected = app.replacementContext(gap);
  app.state.coverageRules[0].required = 2;
  const changed = plain(app.snapshot());
  assert.equal(app.applyReplacement(gap,'p4',expected).ok,false);
  assert.deepEqual(plain(app.snapshot()),changed);
});

test('committed leave decisions expose assigned occurrences without rewriting shifts and cannot be casually undone',async()=>{
  const app = application(); app.state.week = 1;
  const shifts = plain(app.shiftsInRange('2026-11-02','2026-11-08')), series = plain(app.state.series), before = plain(app.snapshot());
  assert.equal(app.operationsModel().counts.request,1);
  assert.equal((await app.decideLeave('b','approved')).ok,true);
  assert.deepEqual(plain(app.accountCalls),[{action:'leaveDecide',payload:{id:'b',version:1,status:'approved',reason:''}}]);
  const model = app.operationsModel(), affected = model.items.filter(item => item.kind === 'leave');
  assert.equal(model.counts.request,0); assert.equal(affected.length,2);
  assert.deepEqual(Array.from(affected,item => item.date),['2026-11-03','2026-11-04']);
  assert.ok(affected.every(item => item.shift.person === 'p1'));
  assert.deepEqual(plain(app.shiftsInRange('2026-11-02','2026-11-08')),shifts); assert.deepEqual(plain(app.state.series),series);
  const approved = plain(app.snapshot()), undo = plain(app.getUndo());
  assert.equal((await app.decideLeave('b','rejected','Efterfølgende forsøg')).ok,false); assert.equal((await app.decideLeave('missing','approved')).ok,false);
  assert.deepEqual(plain(app.snapshot()),approved); assert.deepEqual(plain(app.getUndo()),undo);
  assert.equal(app.getUndo(),null,'A committed absence decision is not a reversible planning draft.');
  app.undo();assert.deepEqual(plain(app.snapshot()),approved);assert.deepEqual(plain(app.state.leaveDecisions.b),{status:'approved',reason:'',decidedBy:{userId:'server-planner',name:'Planlægger'},decidedAt:'2026-11-03T00:00:00.000Z'});
  const rejected=application();rejected.state.week=1;const rejectedShifts=plain(rejected.shiftsInRange('2026-11-02','2026-11-08'));
  assert.equal((await rejected.decideLeave('b','rejected','   ')).ok,false);assert.equal(rejected.state.requests.b,undefined);
  assert.equal((await rejected.decideLeave('b','rejected','Der er ikke bemanding til at dække vagterne.')).ok,true);assert.equal(rejected.operationsModel().counts.leave,0);
  assert.deepEqual(plain(rejected.accountCalls),[{action:'leaveDecide',payload:{id:'b',version:1,status:'rejected',reason:'Der er ikke bemanding til at dække vagterne.'}}]);
  assert.deepEqual(plain(rejected.shiftsInRange('2026-11-02','2026-11-08')),rejectedShifts);assert.deepEqual(plain(rejected.state.leaveDecisions.b),{status:'rejected',reason:'Der er ikke bemanding til at dække vagterne.',decidedBy:{userId:'server-planner',name:'Planlægger'},decidedAt:'2026-11-03T00:00:00.000Z'});
  rejected.undo();assert.equal(rejected.state.requests.b,'rejected');
});

test('publication with newly approved absence opens operations without creating or changing a baseline or undo',async()=>{
  for (const existingBaseline of [false,true]) {
    const app = application(); app.state.week = 1;
    if (existingBaseline) app.weekPlan();
    assert.equal((await app.decideLeave('b','approved')).ok,true);
    assert.equal(app.weekReview().absences.length,2);
    assert.equal(app.weekReview().overlaps.length,0,'This guard must be exercised by approved absence alone.');
    const before = plain(app.snapshot()), undo = plain(app.getUndo());
    await app.publishReviewedWeek();
    assert.equal(app.getOperationOpenings().length,1);
    assert.equal(app.getOperationOpenings()[0],app.control('#cs-publish'));
    assert.deepEqual(plain(app.snapshot()),before);
    assert.deepEqual(plain(app.getUndo()),undo);
    if (existingBaseline) {
      assert.equal(app.state.weekPlans['1'].published,false);
      assert.equal(app.state.weekPlans['1'].baselineKind,'initial');
    } else {
      assert.equal(app.state.weekPlans['1'],undefined,'Blocked publication must not lazily create a plan or capture a baseline.');
    }
  }
});

function personalWork(app) {
  app.state.coverageRules = [need({id:'personal-need',start:'15:00',end:'17:00',required:2})];
  app.state.requests = {b:'approved',c:'rejected'};
  app.state.edits.personal = shift('personal','p0','2026-11-12','18:00','20:00',2);
  app.state.edits.personal.note = 'Original work';
  app.state.series[0].note = 'Original recurring pattern';
  app.state.page = 'hours'; app.state.week = 2; app.state.day = 4; app.state.site = '2';
  const undo = plain(app.snapshot()); undo.requests.b = 'pending'; undo.coverageRules[0].required = 1;
  app.setUndo(undo);
  return {state:plain(app.state),undo};
}

test('demo entry resets need rules and demo exit restores original rules, decisions, replacements and undo exactly',async()=>{
  const app = application(), original = personalWork(app);
  assert.equal(app.installDemoFixture('overview'),true);
  assert.deepEqual(plain(app.state.coverageRules),Coverage.defaultRules());
  const open = app.shiftsInRange('2026-10-28','2026-10-28').find(item => !item.person);
  assert.equal(app.applyReplacement({kind:'shift',shift:plain(open)},'p0').ok,true);
  assert.equal(app.applyNeedRule(need({id:'demo-only',site:0,start:'18:00',end:'19:00'})).ok,true);
  assert.equal((await app.decideLeave('b','approved')).ok,true);
  assert.deepEqual(plain(app.accountCalls),[],'Demo absence decisions must never call the live API');
  app.exitDemo();
  assert.deepEqual(plain(app.state),original.state); assert.deepEqual(plain(app.getUndo()),original.undo);
});

test('serialized demo sessions retain operation edits yet restore their original state after reload',async()=>{
  const app = application(), original = personalWork(app);
  app.installDemoFixture('overview');
  app.applyNeedRule(need({id:'demo-only',site:0,start:'18:00',end:'19:00'})); await app.decideLeave('b','approved');
  const open = app.shiftsInRange('2026-10-28','2026-10-28').find(item => !item.person);
  const result = app.applyReplacement({kind:'shift',shift:plain(open)},'p0'); assert.equal(result.ok,true);
  const saved = plain(app.state), resumed = application(); resumed.restore({privateContent:{studio:saved}});
  assert.deepEqual(plain(resumed.state),saved);
  assert.equal(resumed.state.edits[result.shift.id].person,'p0');
  resumed.exitDemo(); assert.deepEqual(plain(resumed.state),original.state); assert.deepEqual(plain(resumed.getUndo()),original.undo);
});

test('restoration rejects malformed or overlapping supplied need rules while supporting legacy undo fields',()=>{
  const app = application(), original = personalWork(app); app.installDemoFixture('overview');
  const saved = plain(app.state), valid = plain(saved.demoSession);
  const legacy = plain(valid); delete legacy.backup.coverageRules; delete legacy.backupUndo.coverageRules; delete legacy.backupUndo.requests;
  assert.equal(app.validDemoSession(legacy),true);
  for (const rules of [[need({required:0})],[need(),need({id:'overlap',start:'12:00',end:'14:00'})],[need(),need()]]) {
    const invalid = plain(valid); invalid.backup.coverageRules = rules;
    assert.equal(app.validDemoSession(invalid),false);
    const resumed = application(); resumed.restore({privateContent:{studio:{...saved,demoSession:invalid}}});
    assert.equal(resumed.state.demoSession,null);
  }
  const invalidUndo = plain(valid); invalidUndo.backupUndo.requests = {b:'unknown'};
  assert.equal(app.validDemoSession(invalidUndo),false);
  const restored = application(); restored.restore({privateContent:{studio:{...original.state,coverageRules:[need({required:0})]}}});
  assert.deepEqual(plain(restored.state.coverageRules),Coverage.defaultRules());
});
