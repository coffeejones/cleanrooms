const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf("  staff.forEach(person => { const option");
const saveStart = source.indexOf('  function saveShift(event) {');
const saveEnd = source.indexOf("  q('#cs-operations-tabs')",saveStart);
const undoHandler = source.match(/q\('#cs-undo'\)\.addEventListener\('click',([^\n]+)\);/);
assert.ok(boundary > 0 && saveStart > boundary && saveEnd > saveStart && undoHandler,
  'The description harness must find the actual editor save and undo functions.');
const plain = value => JSON.parse(JSON.stringify(value));
const publishedShift=(app,id)=>require('../src/publication-model.js').publishedShifts(app.state).find(shift=>shift.id===id);
const assertDescription = (actual,expected) => {
  assert.equal(typeof actual,'string');
  assert.equal(actual.length,expected.length,'The complete description length must survive.');
  assert.ok(actual===expected,'The complete description, whitespace and Unicode must survive exactly.');
};

// Include indentation, trailing newlines, combining characters, surrogate pairs
// and literal markup. This is intentionally much larger than a short note.
const longDescription = ('    ÆØÅ – rengør køkken 🧽 / 漢字 / e\u0301\n' +
  '<script>globalThis.descriptionWasExecuted = true</script>\n' +
  '<img src=x onerror="alert(1)"> &lt;tekst&gt; "nøgle"\n').repeat(220) +
  '    Afslut med lås og alarm.\n\n';
const nextDescription = longDescription.replaceAll('rengør køkken','rengør mødelokale');
assert.ok(longDescription.length >= 20000 && nextDescription.length <= 50000);

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

// Keep editor initialization, draft reading, series scopes, save, transactions,
// history, publication and undo real. Painting and staffing preview are isolated
// because descriptions do not change availability; production validation still
// runs through proposalError on every save.
function application({richEditor=false}={}) {
  let editorData={note:'',noteRich:''};
  const controls=new Map();
  const control=selector=>{
    if(!controls.has(selector)) controls.set(selector,document.createElement('input'));
    return controls.get(selector);
  };
  const root={querySelector:control,querySelectorAll:()=>[]};
  const document={getElementById:()=>root,createElement:tag=>{const element=new Element(tag);element.ownerDocument=document;return element;},createTextNode:text=>({textContent:String(text),children:[]})};
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    CleanRoomsPublicationRange:require('../src/publication-range.js'),
    CleanRoomsPublicationReview:require('../src/publication-review-view.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{},document,
    CleanRoomsSeries:require('../src/series-engine.js'),
    CleanRoomsPlanningScope:require('../src/planning-scope.js'),
    CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),
    CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCoverage:require('../src/coverage-engine.js'),
    ...(richEditor ? {CleanRoomsRichEditor:{mount:()=>({
      setContent:shift=>{editorData={note:shift.note||'',noteRich:shift.noteRich||''};},
      getData:()=>({...editorData})
    })}} : {}),
    CleanRoomsCalendar:{revealDay(){}}
  });
  const instrumentation=`
    render=()=>{}; updatePreview=()=>{}; updateBulkPreview=()=>{};
    renderDemoEditorGuide=()=>{}; closeOperationsSheets=()=>{};
    refreshStaffing=()=>{ selectedStaffing=null; };

    let serverPublished;
    persistence={save:async()=>true,publish:async(studio,scope)=>{
      serverPublished=Publication.publish(studio,{...scope,actor:{userId:'fixture-planner',name:'Testplanlægger'},at:'2026-10-30T12:00:00.000Z'}).studio;
      return {ok:true};
    }};
    initializeCloud=async()=>{Object.assign(state,clone(serverPublished));};
    const undoAction=${undoHandler[1]};
    globalThis.descriptionTest={
      state,snapshot,restore,shiftsInRange,seriesOccurrences,openEditor,sameAssignment,
      configureRepeat,changeEditorScope,readDescriptionData,saveShift,weekPlan,changesForWeek,publicationStatus,renderChanges,
      bulkProposal,saveBulk,publishReviewedWeek,undo:undoAction,
      setWeekdays:days=>{repeatDays=new Set(days);},
      select:(members,operation,copyIds)=>{
        activeBulk={members:clone(members),operation,
          firstDate:members.map(shift=>shift.date).sort()[0],copyIds:copyIds||{}};
        q('#cs-bulk-layer').hidden=false;
      }
    };
  `;
  vm.runInContext(source.slice(0,boundary)+source.slice(saveStart,saveEnd)+instrumentation+'\n})();',
    context,{filename:'app.js (description integration)'});
  const app=context.descriptionTest;
  return {...app,control,
    setRich:(note,noteRich)=>{editorData={note,noteRich};},
    getRich:()=>({...editorData}),
    at:(day,person)=>app.shiftsInRange(day,day).find(shift=>shift.person===person),
    save:()=>app.saveShift({preventDefault(){}}),
    edit:(shift,description,scope='one')=>{
      app.openEditor(shift,null,{scope}); control('#cs-edit-note').value=description;
    },
    beginBulk:(members,operation,{target='',copyIds={}}={})=>{
      app.select(members,operation,copyIds); control('#cs-bulk-date').value=target;
    },
    saveBulkAction:()=>app.saveBulk({preventDefault(){}})
  };
}

function descendants(element) {
  return element.children.flatMap(child=>[child,...descendants(child)]);
}

test('a long multiline description saves and reopens exactly, and literal HTML stays text in history',()=>{
  const app=application(),shift=app.at('2026-10-28','');
  app.edit(shift,longDescription); app.save();
  const saved=app.at(shift.date,'');
  assertDescription(saved.note,longDescription);
  app.openEditor(saved); assertDescription(app.control('#cs-edit-note').value,longDescription);
  const [change]=app.changesForWeek();
  assert.deepEqual(plain(change.fields),['note']);
  assert.equal(change.before.note,''); assertDescription(change.after.note,longDescription);
  app.renderChanges();
  const key=value=>descendants(app.control('#cs-changes-list')).find(item=>item.dataset?.publicationReviewFocus===value);
  key('search').value='Ledig vagt';key('search').fire('input');
  const row=descendants(app.control('#cs-changes-list')).find(item=>item.className==='cs-publication-review-row'&&item.dataset.changeId===String(shift.id));
  assert.ok(row);assert.equal(row.textContent.includes(longDescription),false,'Long instructions are loaded only when the planner opens their detail.');
  assert.ok(row.attributes['aria-label'].length<500);assert.ok(!row.attributes['aria-label'].includes('<script>'));
  row.fire('click');
  const instruction=descendants(app.control('#cs-changes-list')).find(item=>item.className==='cs-publication-review-instructions');
  assert.ok(instruction);assert.equal(instruction.children.length,1);instruction.open=true;instruction.fire('toggle');
  const notes=descendants(instruction).filter(item=>item.className==='cs-publication-review-note cs-rich-content');
  assert.ok(notes.some(note=>note.textContent===longDescription));assert.ok(!descendants(instruction).some(item=>['script','img'].includes(item.tagName)));

});

test('description is optional, including whitespace-only input; clearing can be undone after publication',async()=>{
  const app=application(),shift=app.at('2026-10-28','');
  app.edit(shift,longDescription); app.save(); await app.publishReviewedWeek();
  assertDescription(publishedShift(app,shift.id).note,longDescription);
  app.edit(app.at(shift.date,''),' \n\t  \n'); app.save();
  assert.equal(app.at(shift.date,'').note,'');
  app.openEditor(app.at(shift.date,'')); assert.equal(app.control('#cs-edit-note').value,'');
  const [change]=app.changesForWeek();
  assertDescription(change.before.note,longDescription); assert.equal(change.after.note,'');
  app.renderChanges();
  const row=descendants(app.control('#cs-changes-list')).find(item=>item.className==='cs-publication-review-row'&&item.dataset.changeId===String(shift.id));
  row.fire('click');const instruction=descendants(app.control('#cs-changes-list')).find(item=>item.className==='cs-publication-review-instructions');
  instruction.open=true;instruction.fire('toggle');const notes=descendants(instruction).filter(item=>item.className==='cs-publication-review-note cs-rich-content');
  assertDescription(notes[0].textContent,longDescription);assert.equal(notes[1].textContent,'Ingen instruktioner.');
  app.undo(); assertDescription(app.at(shift.date,'').note,longDescription);
  assert.equal(app.publicationStatus().published,true); assert.equal(app.changesForWeek().length,0);
  app.edit(app.at(shift.date,''),''); app.save();
  assert.equal(app.at(shift.date,'').note,'');
});

test('editing an entire series propagates the complete description to all 52 occurrences and undo restores it',()=>{
  const app=application(),before=plain(app.snapshot());
  app.edit(app.at('2026-10-27','p0'),longDescription,'all'); app.save();
  assert.equal(app.state.series.length,1); assertDescription(app.state.series[0].note,longDescription);
  const occurrences=app.seriesOccurrences(app.state.series[0]);
  assert.equal(occurrences.length,52); assert.ok(occurrences.every(shift=>shift.note===longDescription));
  app.openEditor(occurrences.at(-1),null,{scope:'all'});
  assertDescription(app.control('#cs-edit-note').value,longDescription);
  assertDescription(app.changesForWeek(0)[0].after.note,longDescription);
  assertDescription(app.changesForWeek(25)[0].after.note,longDescription);
  app.undo(); assert.deepEqual(plain(app.state.series),before.series.map(series=>({...series,plannedBreakMinutes:series.plannedBreakMinutes??0})));
  assert.ok(app.seriesOccurrences(app.state.series[0]).every(shift=>shift.note===''));
});

test('future-series description edits preserve prior descriptions, use the occurrence cutoff, and undo atomically',()=>{
  const app=application(); app.state.series[0].note=longDescription;
  const cutoff='2027-01-05',before=plain(app.snapshot());
  app.edit(app.at(cutoff,'p0'),nextDescription,'future'); app.save();
  assert.equal(app.state.series.length,2);
  const occurrences=app.shiftsInRange('2026-10-26','2027-04-26').filter(shift=>shift.person==='p0');
  assert.equal(occurrences.length,52);
  const prior=occurrences.filter(shift=>shift.date<cutoff),future=occurrences.filter(shift=>shift.date>=cutoff);
  assert.equal(prior.length,20); assert.equal(future.length,32);
  assert.ok(prior.every(shift=>shift.note===longDescription));
  assert.ok(future.every(shift=>shift.note===nextDescription));
  app.openEditor(app.at(cutoff,'p0')); assertDescription(app.control('#cs-edit-note').value,nextDescription);
  app.undo(); assert.deepEqual(plain(app.state.series),before.series);
  assert.deepEqual(plain(app.state.edits),before.edits);
  assert.ok(app.seriesOccurrences(app.state.series[0]).every(shift=>shift.note===longDescription));
});

for(const operation of ['copy','move']) test('bulk '+operation+' preserves the full description in records, week history and undo',()=>{
  const app=application(); app.state.series[0].note=longDescription;
  const member=app.at('2026-10-27','p0'),target='2027-07-27';
  app.beginBulk([member],operation,{target,copyIds:{[member.id]:'copy-description'}});
  assert.equal(app.bulkProposal().ok,true); app.saveBulkAction();
  const destination=app.at(target,'p0');
  assertDescription(destination.note,longDescription);
  assert.equal(destination.id,operation==='copy'?'copy-description':member.id);
  assert.equal(destination.seriesId,operation==='copy'?undefined:'jonas-plan');
  assertDescription(app.changesForWeek(39)[0].after.note,longDescription);
  if(operation==='move') assertDescription(app.changesForWeek(0)[0].before.note,longDescription);
  else assertDescription(app.at(member.date,'p0').note,longDescription);
  app.undo(); assert.equal(app.at(target,'p0'),undefined);
  assertDescription(app.at(member.date,'p0').note,longDescription);
  assert.equal(app.changesForWeek(39).length,0);
});

test('serialized shifts, series and publication baselines retain descriptions on restoration and reopening',async()=>{
  const app=application(); app.state.series[0].note=longDescription;
  const shift=app.at('2026-10-28',''); app.edit(shift,nextDescription); app.save(); await app.publishReviewedWeek();
  const saved=plain(app.state),resumed=application();
  resumed.restore({privateContent:{studio:saved}});
  assertDescription(resumed.state.series[0].note,longDescription);
  assertDescription(resumed.state.edits[shift.id].note,nextDescription);
  assertDescription(publishedShift(resumed,shift.id).note,nextDescription);
  assert.equal(resumed.changesForWeek().length,0);
  resumed.openEditor(resumed.at(shift.date,''));
  assertDescription(resumed.control('#cs-edit-note').value,nextDescription);
});

const richTemplate=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Instruktioner',marks:[{type:'bold'}]}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Lås døren'}]}]}]}]});
const richPlain='Instruktioner\nLås døren';

test('rich single-shift save, reopen, publication, clear and undo retain the actual editor payload',async()=>{
  const app=application({richEditor:true}),shift=app.at('2026-10-28','');
  app.openEditor(shift);app.setRich(richPlain,richTemplate);app.save();
  assert.equal(app.at(shift.date,'').noteRich,richTemplate);
  app.openEditor(app.at(shift.date,''));assert.deepEqual(app.getRich(),{note:richPlain,noteRich:richTemplate});
  await app.publishReviewedWeek();assert.equal(publishedShift(app,shift.id).noteRich,richTemplate);
  const resumed=application({richEditor:true});resumed.restore({privateContent:{studio:plain(app.state)}});
  resumed.openEditor(resumed.at(shift.date,''));assert.deepEqual(resumed.getRich(),app.getRich());
  app.setRich('','');app.save();assert.equal(app.at(shift.date,'').note,'');assert.equal(app.at(shift.date,'').noteRich,undefined);
  assert.ok(app.changesForWeek()[0].fields.includes('noteRich'));
  app.undo();assert.equal(app.at(shift.date,'').noteRich,richTemplate);
});

test('rich formatting-only edits are tracked and invalidate captured replacement contexts',async()=>{
  const app=application({richEditor:true}),shift=app.at('2026-10-28','');
  app.openEditor(shift);app.setRich(richPlain,richTemplate);app.save();await app.publishReviewedWeek();
  const before=plain(app.at(shift.date,'')),formatted=richTemplate.replace('bold','italic');
  app.openEditor(before);app.setRich(richPlain,formatted);app.save();
  assert.deepEqual(plain(app.changesForWeek()[0].fields),['noteRich']);
  assert.equal(app.sameAssignment(before,app.at(shift.date,'')),false);
  assert.equal(app.sameAssignment({...before,noteRich:null},{...before,noteRich:undefined}),true);
});

for(const scope of ['all','future']) test('rich '+scope+' series edits preserve templates and undo the complete transaction',()=>{
  const app=application({richEditor:true});app.state.series[0].note=richPlain;app.state.series[0].noteRich=richTemplate;
  for(let week=0;week<=26;week++) app.weekPlan(week);
  const before=plain(app.snapshot()),cutoff='2027-01-05',changed=richTemplate.replace('Lås døren','Lås hoveddøren');
  app.openEditor(app.at(cutoff,'p0'),null,{scope});app.setRich(richPlain.replace('Lås døren','Lås hoveddøren'),changed);app.save();
  const occurrences=app.shiftsInRange('2026-10-26','2027-04-26').filter(shift=>shift.person==='p0');
  assert.equal(occurrences.length,52);
  assert.ok(occurrences.filter(shift=>scope==='all'||shift.date>=cutoff).every(shift=>shift.noteRich===changed));
  if(scope==='future') assert.ok(occurrences.filter(shift=>shift.date<cutoff).every(shift=>shift.noteRich===richTemplate));
  app.undo();assert.deepEqual(plain(app.snapshot()),scope==='all'?{...before,series:before.series.map(series=>({...series,plannedBreakMinutes:series.plannedBreakMinutes??0}))}:before);
});

for(const operation of ['copy','move']) test('rich templates survive actual bulk '+operation+' and undo',()=>{
  const app=application({richEditor:true});app.state.series[0].note=richPlain;app.state.series[0].noteRich=richTemplate;
  const member=app.at('2026-10-27','p0'),target='2027-07-27';
  app.beginBulk([member],operation,{target,copyIds:{[member.id]:'copy-rich'}});app.saveBulkAction();
  assert.equal(app.at(target,'p0').noteRich,richTemplate);
  assert.equal(app.changesForWeek(39)[0].after.noteRich,richTemplate);
  app.undo();assert.equal(app.at(target,'p0'),undefined);assert.equal(app.at(member.date,'p0').noteRich,richTemplate);
});

test('restoring malformed rich metadata keeps the original shift and plain description usable',async()=>{
  const app=application(),shift=app.at('2026-10-28','');app.edit(shift,'Bevar instruktionen');app.save();await app.publishReviewedWeek();
  const saved=plain(app.state);saved.edits[shift.id].noteRich={unsafe:true};saved.series[0].noteRich=[];
  saved.weekPlans['0'].baseline.find(item=>item.id===shift.id).noteRich={type:'doc'};
  const resumed=application();resumed.restore({privateContent:{studio:saved}});
  assert.equal(resumed.at(shift.date,'').note,'Bevar instruktionen');
  assert.equal(resumed.at(shift.date,'').noteRich,undefined);
  assert.equal(resumed.state.series.length,1);assert.equal(resumed.state.series[0].noteRich,undefined);
  assert.doesNotThrow(()=>resumed.changesForWeek());assert.equal(resumed.changesForWeek().length,0);
  assert.deepEqual(saved.edits[shift.id].noteRich,{unsafe:true},'Restoration must not mutate the saved payload.');
});

test('plain editor fallback preserves rich data on unrelated edits and clears it when text changes',()=>{
  const app=application(),shift=app.at('2026-10-28','');shift.note=richPlain;shift.noteRich=richTemplate;
  app.openEditor(shift);app.control('#cs-edit-start').value='08:00';app.save();
  assert.equal(app.at(shift.date,'').noteRich,richTemplate);
  app.edit(app.at(shift.date,''),'Ny almindelig tekst');app.save();
  assert.equal(app.at(shift.date,'').noteRich,undefined);
});

test('all-series edits preserve manual moved assignments, complete descriptions and deleted occurrences by default',()=>{
  const app=application(),first=app.at('2026-10-27','p0'),removed=app.at('2026-10-29','p0');
  const exception={...plain(first),person:'p1',date:'2026-10-25',note:longDescription,noteRich:'literal-rich'};
  app.state.edits[first.id]=exception;app.state.deleted.push(removed.id);
  app.edit(app.at('2026-11-03','p0'),'New standard instructions','all');app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.save();
  assert.deepEqual(plain(app.state.edits[first.id]),exception);assert.ok(app.state.deleted.includes(removed.id));assert.equal(app.at('2026-10-27','p0'),undefined);assert.equal(app.at('2026-10-29','p0'),undefined);
  assert.equal(app.at('2026-11-03','p0').note,'New standard instructions');assertDescription(app.at('2026-10-25','p1').note,longDescription);
});

test('future splits preserve occurrence anchors while reparenting a manually reassigned occurrence moved before the cutoff',()=>{
  const app=application(),prior=app.at('2026-10-27','p0'),future=app.at('2026-11-03','p0');
  app.state.edits[prior.id]={...plain(prior),date:'2027-05-10',note:'Prior anchor'};
  app.state.edits[future.id]={...plain(future),person:'p1',date:'2026-10-25',note:longDescription};
  app.edit(app.state.edits[future.id],'Future template','future');app.control('#cs-edit-person').value='p0';app.save();
  const replacement=app.state.series.find(series=>series.id!=='jonas-plan');assert.ok(replacement);const id=replacement.id+'@2026-11-03';
  assert.equal(app.state.edits[future.id],undefined);assert.equal(app.state.edits[id].seriesId,replacement.id);assert.equal(app.state.edits[id].person,'p1');assert.equal(app.state.edits[id].date,'2026-10-25');assertDescription(app.state.edits[id].note,longDescription);
  assert.equal(app.state.edits[prior.id].date,'2027-05-10');assert.equal(app.seriesOccurrences(app.state.series.find(series=>series.id==='jonas-plan')).some(shift=>shift.id===id),false);
});

test('changing recurrence weekdays detaches manual exceptions without losing them or counting them under an unrelated series',()=>{
  const app=application(),first=app.at('2026-10-27','p0');app.state.edits[first.id]={...plain(first),date:'2026-10-25',note:longDescription};
  app.edit(app.at('2026-11-03','p0'),'Monday pattern','all');app.setWeekdays([0]);app.save();
  assert.equal(Object.hasOwn(app.state.edits[first.id],'seriesId'),false);assertDescription(app.at('2026-10-25','p0').note,longDescription);assert.equal(app.seriesOccurrences(app.state.series[0]).some(shift=>shift.id===first.id),false);
});

test('explicitly replacing manual exceptions clears them only after the preservation option is turned off',()=>{
  const app=application(),first=app.at('2026-10-27','p0'),removed=app.at('2026-10-29','p0');app.state.edits[first.id]={...plain(first),note:longDescription};app.state.deleted.push(removed.id);
  app.edit(app.at('2026-11-03','p0'),'Replacement','all');app.control('#cs-preserve-exceptions').checked=false;app.save();
  assert.equal(app.state.edits[first.id],undefined);assert.equal(app.state.deleted.includes(removed.id),false);assert.equal(app.at(first.date,'p0').note,'Replacement');assert.equal(app.at(removed.date,'p0').note,'Replacement');
});

for(const richEditor of [false,true])test('switching edit scope loads standard series fields and restores the manual occurrence fields'+(richEditor?' with rich editor':' with plain fallback'),()=>{
  const app=application({richEditor}),source=app.state.series[0];Object.assign(source,{note:'Standard description',noteRich:'standard-rich-template'});
  const occurrence=app.at('2026-10-27','p0'),exception={...plain(occurrence),person:'p4',site:2,start:'18:00',end:'20:00',note:'Manual description',noteRich:'manual-rich-template'};
  app.state.edits[exception.id]=exception;app.openEditor(exception);app.control('#cs-edit-scope').value='future';app.changeEditorScope();
  assert.equal(app.control('#cs-edit-person').value,'p0');assert.equal(app.control('#cs-edit-site').value,'0');assert.equal(app.control('#cs-edit-start').value,'07:00');assert.equal(app.control('#cs-edit-end').value,'15:00');assert.deepEqual(plain(app.readDescriptionData()),{note:source.note,noteRich:source.noteRich});
  app.control('#cs-edit-scope').value='one';app.changeEditorScope();assert.equal(app.control('#cs-edit-person').value,'p4');assert.equal(app.control('#cs-edit-site').value,'2');assert.equal(app.control('#cs-edit-start').value,'18:00');assert.deepEqual(plain(app.readDescriptionData()),{note:exception.note,noteRich:exception.noteRich});
});
