const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf("  staff.forEach(person => { const option");
const undoHandler = source.match(/q\('#cs-undo'\)\.addEventListener\('click',([^\n]+)\);/);
assert.ok(boundary > 0 && undoHandler,'The integration harness must find the app setup boundary and actual undo handler.');
const plain = value => JSON.parse(JSON.stringify(value));

// Execute the actual planning functions in isolation. Only painting and preview
// DOM work are replaced; commit, baselines, publication, bulk planning and undo
// are all taken from app.js. No hooks are added to production sources.
function application() {
  const controls = new Map();
  const control = selector => {
    if (!controls.has(selector)) controls.set(selector,{
      value:'',hidden:true,dataset:{},disabled:false,isConnected:true,
      setAttribute(){},removeAttribute(){},focus(){},reportValidity:()=>true
    });
    return controls.get(selector);
  };
  const root = {querySelector:control,querySelectorAll:()=>[]};
  const context = vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    CleanRoomsPublicationRange:require('../src/publication-range.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{},document:{getElementById:()=>root},
    CleanRoomsSeries:require('../src/series-engine.js'),
    CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),
    CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCalendar:{revealDay(){}}
  });
  const instrumentation = `
    render = () => {};
    updateBulkPreview = () => {};

    let serverPublished;
    persistence={save:async()=>true,publish:async(studio,scope)=>{
      serverPublished=Publication.publish(studio,{...scope,actor:{userId:'fixture-planner',name:'Testplanlægger'},at:'2026-10-30T12:00:00.000Z'}).studio;
      return {ok:true};
    }};
    initializeCloud=async()=>{Object.assign(state,clone(serverPublished));};
    const undoAction = ${undoHandler[1]};
    globalThis.planningTest = {
      state, snapshot, weekPlan, changesForWeek, publicationStatus, shiftsInRange,
      bulkProposal, saveBulk, publishReviewedWeek, undo:undoAction,
      getUndo:() => lastUndo,
      select:(members,operation,copyIds) => {
        activeBulk = {members:clone(members),operation,firstDate:members.map(shift=>shift.date).sort()[0],copyIds:copyIds || {}};
        q('#cs-bulk-layer').hidden = false;
      }
    };
  `;
  vm.runInContext(source.slice(0,boundary) + instrumentation + '\n})();',context,{filename:'app.js (transaction integration)'});
  const app = context.planningTest;
  return {
    ...app,control,
    at:(day,person) => app.shiftsInRange(day,day).find(shift=>shift.person===person),
    save:() => app.saveBulk({preventDefault(){}}),
    begin:(members,operation,{start='',end='',target='',copyIds={}}={}) => {
      app.select(members,operation,copyIds);
      control('#cs-bulk-start').value=start;control('#cs-bulk-end').value=end;control('#cs-bulk-date').value=target;
    }
  };
}

test('bulk time edits capture untouched baselines for every affected week before applying changes',()=>{
  const app=application(),members=[app.at('2026-10-27','p0'),app.at('2026-11-03','p0')];
  assert.deepEqual(Object.keys(app.state.weekPlans),[]);
  app.begin(members,'time',{start:'08:10',end:'16:10'});app.save();
  for(const [index,member]of members.entries()){
    const plan=app.weekPlan(index),diff=app.changesForWeek(index);
    assert.equal(plan.baseline.find(shift=>shift.id===member.id).start,'07:00');
    assert.equal(diff.length,1);assert.equal(diff[0].type,'changed');
    assert.equal(diff[0].before.start,'07:00');assert.equal(diff[0].after.start,'08:10');
    assert.equal(diff[0].after.seriesId,'jonas-plan');
  }
  app.undo();
  assert.equal(Object.keys(app.state.edits).length,0);
  assert.equal(app.changesForWeek(0).length,0);assert.equal(app.changesForWeek(1).length,0);
  assert.equal(app.getUndo(),null);
});

test('a bulk move captures an unseen destination baseline and diffs both source and destination',()=>{
  const app=application(),member=app.at('2026-10-27','p0');
  assert.equal(app.state.weekPlans['39'],undefined);
  app.begin([member],'move',{target:'2027-07-27'});assert.equal(app.bulkProposal().ok,true);app.save();
  const source=app.changesForWeek(0),destination=app.changesForWeek(39);
  assert.equal(source.length,1);assert.equal(source[0].type,'removed');assert.equal(source[0].before.id,member.id);
  assert.equal(destination.length,1);assert.equal(destination[0].type,'added');assert.equal(destination[0].after.id,member.id);
  assert.equal(destination[0].after.date,'2027-07-27');assert.equal(destination[0].after.seriesId,'jonas-plan');
  assert.ok(!app.weekPlan(39).baseline.some(shift=>shift.id===member.id));
  app.undo();assert.equal(app.at('2026-10-27','p0').id,member.id);assert.equal(app.at('2027-07-27','p0'),undefined);
  assert.equal(app.changesForWeek(0).length,0);assert.equal(app.changesForWeek(39).length,0);
});

test('bulk copies retain originals and produce only destination additions with standalone IDs',()=>{
  const app=application(),member=app.at('2026-10-27','p0');
  app.begin([member],'copy',{target:'2027-07-27',copyIds:{[member.id]:'copy-jonas'}});app.save();
  assert.equal(app.at('2026-10-27','p0').id,member.id);
  const copied=app.at('2027-07-27','p0');assert.equal(copied.id,'copy-jonas');assert.equal(copied.seriesId,undefined);
  assert.equal(app.changesForWeek(0).length,0);assert.equal(app.changesForWeek(39).length,1);
  assert.equal(app.changesForWeek(39)[0].type,'added');
  app.undo();assert.equal(app.at('2027-07-27','p0'),undefined);assert.equal(app.changesForWeek(39).length,0);
});

test('publication records the current plan as baseline and later edits compare against that publication',async()=>{
  const app=application(),member=app.at('2026-10-27','p0');
  app.begin([member],'time',{start:'08:00',end:'16:00'});app.save();
  assert.equal(app.changesForWeek().length,1);
  await app.publishReviewedWeek();
  assert.equal(app.publicationStatus().published,true);
  assert.equal(app.changesForWeek().length,0);
  assert.equal(require('../src/publication-model.js').publishedShifts(app.state).find(shift=>shift.id===member.id).start,'08:00');
  const published=plain(app.snapshot());
  app.begin([app.at('2026-10-27','p0')],'time',{start:'09:00',end:'17:00'});app.save();
  const diff=app.changesForWeek();assert.equal(diff.length,1);assert.equal(diff[0].before.start,'08:00');assert.equal(diff[0].after.start,'09:00');assert.equal(app.publicationStatus().published,false);
  app.undo();assert.deepEqual(plain(app.snapshot()),published);assert.equal(app.publicationStatus().published,true);assert.equal(app.changesForWeek().length,0);
});

test('publication clears draft undo and cannot be rolled back by the local undo action',async()=>{
  const app=application(),member=app.at('2026-10-27','p0');
  app.begin([member],'time',{start:'08:00',end:'16:00'});app.save();
  await app.publishReviewedWeek();assert.equal(app.changesForWeek().length,0);
  const published=plain(app.snapshot()),publications=plain(app.state.publications);assert.equal(app.getUndo(),null);app.undo();
  assert.deepEqual(plain(app.snapshot()),published);assert.deepEqual(plain(app.state.publications),publications);assert.equal(app.at('2026-10-27','p0').start,'08:00');
  assert.equal(require('../src/publication-model.js').publishedShifts(app.state).find(shift=>shift.id===member.id).start,'08:00');
  assert.equal(app.changesForWeek().length,0);assert.equal(app.publicationStatus().published,true);
});

test('a hidden other-site conflict blocks the entire bulk transaction and leaves undo and baselines untouched',()=>{
  const app=application(),members=[app.at('2026-10-29','p0'),app.at('2026-10-29','p9')];
  app.state.site='0';
  app.state.edits.hidden={id:'hidden',person:'p9',date:'2026-10-29',site:2,start:'17:00',end:'19:00',note:''};
  app.begin(members,'time',{start:'16:00',end:'18:00'});
  const before=plain(app.snapshot()),undo=app.getUndo();assert.equal(app.bulkProposal().ok,false);app.save();
  assert.deepEqual(plain(app.snapshot()),before);assert.equal(app.getUndo(),undo);
  for(const member of members)assert.equal(app.state.edits[member.id],undefined);
});

test('legacy plans outside the affected view do not prevent commits and affected legacy baselines are captured before edits',()=>{
  const app=application(),members=[app.at('2026-10-27','p0'),app.at('2026-11-03','p0')];
  app.state.weekPlans['40']={published:false,changes:3};
  app.state.weekPlans['1']={published:true,changes:0};
  app.begin(members,'time',{start:'08:00',end:'16:00'});
  assert.doesNotThrow(()=>app.save());
  assert.deepEqual(plain(app.state.weekPlans['40']),{published:false,changes:3});
  assert.equal(app.weekPlan(1).baselineKind,'published');
  assert.equal(app.weekPlan(1).baseline.find(shift=>shift.id===members[1].id).start,'07:00');
  assert.equal(app.changesForWeek(1)[0].before.start,'07:00');
  assert.equal(app.changesForWeek(1)[0].after.start,'08:00');
  assert.equal(app.weekPlan(1).published,false);
  app.undo();
  assert.equal(app.weekPlan(1).published,true);assert.equal(app.changesForWeek(1).length,0);
});

test('an existing legacy baseline without provenance receives an initial baseline kind',()=>{
  const app=application();
  const baseline=plain(app.shiftsInRange('2026-10-26','2026-11-01'));
  app.state.weekPlans['0']={published:false,changes:0,baseline};
  assert.equal(app.weekPlan().baselineKind,'initial');
  assert.deepEqual(plain(app.weekPlan().baseline),baseline);
  assert.equal(app.changesForWeek().length,0);
});
