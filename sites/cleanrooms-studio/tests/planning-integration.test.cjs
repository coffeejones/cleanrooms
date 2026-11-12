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

class Element {
  constructor(tag='input') {
    this.tagName=tag; this.value=''; this.hidden=true; this.checked=false;
    this.dataset={}; this.attributes={}; this.children=[]; this.className='';
    this.disabled=false; this.isConnected=true; this._text=''; this.listeners={};
  }
  set textContent(value) { this._text=String(value); this.children=[]; }
  get textContent() { return this._text+this.children.map(child=>child.textContent).join(''); }
  set innerHTML(value) { throw new Error('Descriptions must be rendered as text, not HTML.'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text=''; this.children=[...children]; }
  get options() { return this.children; }
  setAttribute(name,value) { this.attributes[name]=String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type,handler) { (this.listeners[type]??=[]).push(handler); }
  fire(type) { for(const handler of this.listeners[type]||[])handler({target:this,currentTarget:this,preventDefault(){}}); }
  getAttribute(name) { return this.attributes[name]??null; }
  matches(selector) { if(selector[0]==='.')return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-publication-review-focus]')return !!this.dataset.publicationReviewFocus;return this.tagName.toLowerCase()===selector.toLowerCase(); }
  querySelectorAll(selector) { return descendants(this).filter(node=>typeof node.matches==='function'&&node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
  contains(node) { return descendants(this).includes(node); }
  focus() { this.ownerDocument.activeElement=this; }
  scrollIntoView() {}
  reportValidity() { return true; }
}

function descendants(element) { return element.children.flatMap(child=>[child,...descendants(child)]); }

// Execute the actual planning functions in isolation. Only painting and preview
// DOM work are replaced; commit, baselines, publication, bulk planning and undo
// are all taken from app.js. No hooks are added to production sources.
function application() {
  const controls=new Map();
  const control=selector=>{
    if(!controls.has(selector))controls.set(selector,document.createElement('input'));
    return controls.get(selector);
  };
  const root={querySelector:control,querySelectorAll:()=>[]};
  const document={getElementById:()=>root,createElement:tag=>{const element=new Element(tag);element.ownerDocument=document;return element;},createTextNode:text=>({textContent:String(text),children:[]})};
  const context = vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    CleanRoomsPublicationRange:require('../src/publication-range.js'),
    CleanRoomsPublicationReview:require('../src/publication-review-view.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{},document,
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
      bulkProposal, saveBulk, publishReviewedWeek:async()=>{openChanges();return publishReviewedWeek();}, undo:undoAction,
      getUndo:() => lastUndo,commit,closeEditor,navigateTo,editorHasDirtyDraft,openChanges,showPublicationShift,
      setSave:callback=>{persistence.save=callback;},confirm:value=>{if(value)editorDiscard?.accept();else editorDiscard?.cancel();},dialog:()=>editorDiscard,
      beginDirtyEditor:shift=>{activeEdit=clone(shift);q('#cs-editor-layer').hidden=false;q('#cs-edit-date').value=shift.date;q('#cs-edit-start').value=shift.start;q('#cs-edit-end').value=shift.end;q('#cs-edit-note').value=shift.note||'';editorDirtyBaseline=editorDraftFingerprint();},
      draft:()=>activeEdit,publicationContext:()=>({range:publicationRange,canSubmit:publicationCanSubmit}),setPublicationRange:value=>{publicationRange=value;renderChanges();},
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


test('sandbox-compatible discard confirmation preserves a dirty draft on cancel and resumes only confirmed navigation',()=>{
 const app=application(),member=app.at('2026-10-27','p0');app.beginDirtyEditor(member);app.control('#cs-edit-start').value='08:22';const before=plain(app.state);
 assert.equal(app.editorHasDirtyDraft(),true);assert.equal(app.closeEditor(),false);assert.ok(app.dialog());assert.equal(app.control('.cs-editor').inert,true);assert.equal(app.control('#cs-editor-layer').hidden,false);app.confirm(false);assert.equal(app.dialog(),null);assert.equal(app.control('.cs-editor').inert,false);assert.equal(app.control('#cs-edit-start').value,'08:22');
 assert.equal(app.navigateTo('2026-11-10'),false);app.confirm(false);assert.deepEqual(plain(app.state),before);assert.equal(app.draft().id,member.id);
 assert.equal(app.navigateTo('2026-11-10'),false);app.confirm(true);assert.equal(app.draft(),null);assert.equal(app.state.week,2);assert.equal(app.state.day,1);assert.equal(app.control('#cs-editor-layer').hidden,true);
});

test('optimistic plan changes report successful saving only after the server acknowledgement',async()=>{
 const app=application();let resolve;app.setSave(()=>new Promise(done=>{resolve=done;}));app.control('#cs-toast').hidden=true;const saving=app.commit(app.snapshot(),'Gemt på serveren');assert.equal(app.control('#cs-toast').hidden,true);resolve(true);await saving;await Promise.resolve();assert.equal(app.control('#cs-toast-text').textContent,'Gemt på serveren');
 app.control('#cs-toast').hidden=true;app.setSave(async()=>false);await app.commit(app.snapshot(),'Falsk succes');await Promise.resolve();assert.equal(app.control('#cs-toast').hidden,true);
});
test('publication review restores its selected multiweek range after visiting a shift without restoring an old submit gate',()=>{
 const app=application();app.openChanges();app.setPublicationRange({from:'2026-10-26',to:'2026-11-22'});app.showPublicationShift({date:'2026-11-10',site:0,id:'visited'},true);app.openChanges();assert.deepEqual(plain(app.publicationContext().range),{from:'2026-10-26',to:'2026-11-22'});assert.equal(app.control('#cs-changes-layer').hidden,false);
});


test('the draft dialog uses explicit non-submit controls without enabling browser modals or changing the sandbox',()=>{
 const app=application();app.beginDirtyEditor(app.at('2026-10-27','p0'));app.control('#cs-edit-start').value='08:22';app.closeEditor();const panel=app.dialog().element.children[0],buttons=panel.querySelectorAll('button');assert.equal(panel.getAttribute('role'),'alertdialog');assert.equal(panel.getAttribute('aria-modal'),'true');assert.equal(buttons.length,2);assert.ok(buttons.every(button=>button.type==='button'));assert.equal(source.includes('window.confirm'),false);const exportHtml=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');assert.match(exportHtml,/<iframe id="codex-visualization" sandbox="allow-scripts"/);
});
