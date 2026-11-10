const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf("  staff.forEach(person => { const option");
const saveStart = source.indexOf('  function saveShift(event)');
const saveEnd = source.indexOf('  departmentView =',saveStart);
assert.ok(boundary > 0 && saveStart > boundary && saveEnd > saveStart,'Find the actual editor setup and save function without production hooks.');
const plain = value => JSON.parse(JSON.stringify(value));
const Description = require('../src/description-model.js');
const undoHandler=source.match(/q\('#cs-undo'\)\.addEventListener\('click',([^\n]+)\);/);
const rich = note => ({note,noteRich:Description.encode({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:note,marks:[{type:'bold'}]}]}]})});

// The production draft, scope, opening, preview, staffing and save functions
// run unchanged. This small DOM only records their controls and safe output;
// page painting and external persistence are irrelevant to these transactions.
function application() {
  class Element {
    constructor(tag='div') {
      this.tagName=tag.toUpperCase();this.value='';this.checked=false;this.hidden=true;
      this.disabled=false;this.dataset={};this.children=[];this.attributes=new Map();
      this.isConnected=true;this.scrollTop=0;this.open=false;this._text='';
      const classes=new Set();this.classList={toggle:(name,force)=>{const yes=force??!classes.has(name);yes?classes.add(name):classes.delete(name);return yes;},contains:name=>classes.has(name)};
    }
    addEventListener(type,handler){(this.events??=new Map()).set(type,handler);}
    append(...items){this.children.push(...items);}
    prepend(...items){this.children.unshift(...items);}
    replaceChildren(...items){this._text='';this.children=[...items];}
    set textContent(value){this._text=String(value);this.children=[];}
    get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent||'').join('');}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    removeAttribute(name){this.attributes.delete(name);}
    getAttribute(name){return this.attributes.get(name)??null;}
    querySelectorAll(selector){const descendants=this.children.flatMap(child=>child instanceof Element?[child,...child.querySelectorAll('*')]:[]);return descendants.filter(child=>selector==='*'||selector.startsWith('.')?selector==='*'||String(child.className||'').split(' ').includes(selector.slice(1)):(()=>{const match=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);if(!match)return child.tagName===selector.toUpperCase();const key=match[1].replace(/-([a-z])/g,(_all,letter)=>letter.toUpperCase());return Object.hasOwn(child.dataset,key)&&(match[2]===undefined||child.dataset[key]===match[2]);})());}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){this.focused=true;}
    scrollIntoView(){}
    reportValidity(){return true;}
  }
  const controls=new Map();
  const control=selector=>{if(!controls.has(selector))controls.set(selector,new Element());return controls.get(selector);};
  control('#cs-edit-scope').options=['one','future','all'].map(value=>({value}));
  const root={querySelector:control,querySelectorAll:()=>[],dataset:{}};
  let description={note:''};
  const editor={getData:()=>plain(description),setContent:value=>{description={note:value.note||'',...(value.noteRich?{noteRich:value.noteRich}:{})};}};
  let publicationControls=null;const reviewed=[];
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    CleanRoomsSeries:require('../src/series-engine.js'),
    CleanRoomsSeriesPlanner:require('../src/series-planner.js'),
    CleanRoomsSeriesLifecycle:require('../src/series-lifecycle.js'),
    CleanRoomsSeriesCalendar:require('../src/series-calendar.js'),
    CleanRoomsSeriesExamples:require('../src/series-examples.js'),
    CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),
    CleanRoomsCalendar:{revealDay(){}},
    CleanRoomsPlanningRecords:require('../src/planning-records.js'),
    CleanRoomsPlanningScope:require('../src/planning-scope.js'),
    CleanRoomsPlanningReconcile:require('../src/planning-reconcile.js'),
    CleanRoomsPublicationRange:{...require('../src/publication-range.js'),mount:options=>{publicationControls=options;return {render(){},dispose(){},valid:true};}},
    CleanRoomsPublicationReview:{mount:()=>({render:options=>reviewed.push(plain(options)),dispose(){}})},
    CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCoverage:require('../src/coverage-engine.js'),
    CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsDescription:Description,
    CleanRoomsRichEditor:{mount:()=>editor},
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{},document:{getElementById:()=>root,createElement:tag=>new Element(tag),createElementNS:(_namespace,tag)=>new Element(tag),createTextNode:text=>({textContent:String(text)})}
  });
  const instrumentation=`
    render=()=>{};renderDemoEditorGuide=()=>{};renderPlannerChecklist=()=>{};
    closeOperationsSheets=()=>{};closeBulkEditor=()=>{};closeGroupEditor=()=>{};closeChanges=()=>{};
    let persisted=0;save=()=>{persisted++;return Promise.resolve(true);};notify=()=>{};
    let renderedWindows=0,reviewedWindows=0;
    globalThis.seriesEditorTest={
      state,openEditor,openSeriesEditor,captureEditorDraft,applyEditorDraft,changeEditorScope,configureRepeat,chooseSeriesLength,
      editorCutoff,readSeriesDraft,scopeDraft,snapshot,shiftsInRange,seriesOccurrences,proposalError,updatePreview,
      saveShift,commit,copySeriesEditor,extendSeriesEditor,restoredSeriesMetadata,restoredPauseEdits,addSeriesExamples,
      reconcile:reconcilePlanning,deleteEditedShift,undo:${undoHandler[1]},getUndo:()=>lastUndo,
      applyNeedRule,removeNeedRule,
      openGroupEditor,saveGroup,saveBulk,group:()=>activeGroup,bulk:()=>activeBulk,
      openBulk:(members,operation)=>{visibleShifts=clone(members);selectedIds=new Set(members.map(member=>member.id));openBulkEditor(operation,q('#fixture-bulk'));},
      seriesStatus:()=>seriesStatus,expanded:()=>expandedSeriesGroups,
      dayTimes:value=>{editorDayTimes=value;q('#cs-day-times-enabled').checked=true;},
      source:()=>sourceSeries(),active:()=>activeEdit,
      installWindow:api=>{persistence=api;cloudLoaded=true;cloudCapabilities={plan:true};sessionViewer={userId:'planner'};state.role='admin';state.page='schedule';state.demoSession=null;},
      planningRead:readPlanningProjection,needsPlanningProjection,withCompletePlanning,visiblePlanningProjection,retryCloud,
      planningStatus:()=>({busy:planningReadBusy,blocked:planningReadBlocked,holds:[...planningFullHolds,...planningScopeHolds.keys()],retry:Boolean(planningRetryWork)}),
      planningGate:()=>{render=()=>{if(!needsPlanningProjection())renderedWindows++;};},
      painted:()=>renderedWindows,
      reviewGate:()=>{},reviewed:()=>reviewedWindows,
      openChanges,publishReviewedWeek,closeEditor,updateBulkPreview,renderChanges,conflictShiftsInRange,conflictShiftsForWeeks,staffingContext,seriesCalendarAssessment,editorProjection,seriesProjection,publicationProjection,
      traceConflictReads:()=>{const reads=[],original=conflictShiftsInRange;conflictShiftsInRange=(from,to,data)=>{reads.push({from,to});return original(from,to,data);};return reads;},
      management:()=>editorSeriesManagement,persisted:()=>persisted,
      discardDraft:()=>{closeEditor();editorDiscard?.accept();},
      days:days=>{repeatDays=new Set(days);},
      scope:value=>{q('#cs-edit-scope').value=value;changeEditorScope();},
      begin:(shift,options={})=>openEditor(shift,q('#fixture-open'),options)
    };
  `;
  vm.runInContext(source.slice(0,boundary)+source.slice(saveStart,saveEnd)+instrumentation+'\n})();',context,{filename:'app.js (series editor integration)'});
  return {...context.seriesEditorTest,control,editor,
    reviewed:()=>reviewed.length,changePublicationRange:range=>publicationControls.onChange(range),
    currentDescription:()=>plain(editor.getData()),
    at:(day,person='p0')=>context.seriesEditorTest.shiftsInRange(day,day).find(shift=>shift.person===person),
    save:()=>context.seriesEditorTest.saveShift({preventDefault(){}})
  };
}

test('the actual editor saves an open-ended template and keeps future calendar reads bounded',()=>{
 const app=application(),Engine=require('../src/series-engine.js');app.state.demoSeed=false;
 app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));app.scope('all');app.chooseSeriesLength(null);
 const draft=app.readSeriesDraft();assert.equal(draft.openEnded,true);assert.equal(draft.endDate,Engine.OPEN_END);
 assert.equal(app.control('#cs-repeat-end').disabled,true);assert.equal(app.control('#cs-repeat-end').required,false);assert.equal(app.control('#cs-repeat-end-field').hidden,true);assert.equal(app.control('#cs-repeat-unlimited-hint').hidden,false);
 assert.match(app.control('#cs-series-preview').textContent,/Uden slutdato/);assert.doesNotMatch(app.control('#cs-series-preview').textContent,/2100/);
 const projection=app.editorProjection();assert.ok(projection.ranges.every(range=>(Date.parse(range.to)-Date.parse(range.from))/86400000<366&&range.to<'2030'));
 app.save();assert.equal(app.persisted(),1);assert.equal(app.state.series.length,1);assert.equal(app.state.series[0].openEnded,true);
 assert.equal(app.shiftsInRange('2031-01-01','2031-01-07').filter(shift=>shift.seriesId===draft.id).length,2);
});

test('1, 3 and 6 month choices leave the open-ended mode and a finite conversion can be saved',()=>{
 const app=application(),Engine=require('../src/series-engine.js');app.state.demoSeed=false;Object.assign(app.state.series[0],{openEnded:true,endDate:Engine.OPEN_END});
 app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));app.scope('all');
 for(const months of [1,3,6]){app.chooseSeriesLength(null);app.chooseSeriesLength(months);const draft=app.readSeriesDraft();assert.equal(draft.openEnded,false);assert.equal(draft.endDate,Engine.addMonths(draft.startDate,months));assert.equal(app.control('#cs-repeat-end').disabled,false);assert.equal(app.control('#cs-repeat-end-field').hidden,false);assert.equal(app.control('#cs-repeat-unlimited-hint').hidden,true);}
 assert.match(app.control('#cs-series-preview').textContent,/Serien afsluttes/);assert.doesNotMatch(app.control('#cs-series-preview').textContent,/Ingen vagter ændres/);
 app.save();assert.equal(app.persisted(),1);assert.equal(app.state.series[0].openEnded,false);assert.equal(app.shiftsInRange('2031-01-01','2031-01-07').length,0);
});

test('future editing an open agreement after several years retains its long historical phase',()=>{
 const app=application(),Engine=require('../src/series-engine.js');app.state.demoSeed=false;Object.assign(app.state.series[0],{startDate:'2023-01-01',openEnded:true,endDate:Engine.OPEN_END});
 const original=plain(app.state.series[0]);app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));
 const cutoff=app.control('#cs-repeat-start').value;app.control('#cs-edit-start').value='08:00';app.updatePreview();app.save();
 assert.equal(app.persisted(),1);assert.equal(app.state.series.length,2);const prior=app.state.series.find(phase=>phase.id===original.id),future=app.state.series.find(phase=>phase.id!==original.id);
 assert.equal(prior.startDate,original.startDate);assert.ok(prior.endDate<cutoff);assert.equal(prior.openEnded,false);assert.deepEqual(Engine.validate(prior),[]);assert.equal(future.openEnded,true);
 assert.ok(app.shiftsInRange('2024-01-01','2024-01-07').every(shift=>shift.start==='07:00'));assert.ok(app.shiftsInRange('2031-01-01','2031-01-07').every(shift=>shift.start==='08:00'));
});

test('choosing open-ended duration on an incomplete new form exposes validation without a range exception',()=>{
 const app=application();app.begin({person:'',site:0,date:'2026-11-02',start:'07:00',end:'15:00',note:''},{repeat:true});
 assert.doesNotThrow(()=>app.chooseSeriesLength(null));assert.equal(app.readSeriesDraft().openEnded,true);assert.equal(app.control('#cs-save').disabled,true);assert.match(app.control('#cs-series-preview').textContent,/medarbejder/i);assert.equal(app.persisted(),0);
});

test('single-occurrence and series rich drafts remain independent when changing scope and switching back',()=>{
  const app=application(),series=app.state.series[0];Object.assign(series,rich('Seriens oprindelige instruktion'));
  const shift=app.at('2026-11-03');app.state.edits[shift.id]={...shift,...rich('En særlig instruktion til denne vagt')};
  app.begin(app.state.edits[shift.id]);
  const single=rich('  Min enkeltvagt\n\nBehold indryk og formatering  ');
  app.editor.setContent(single);app.control('#cs-edit-start').value='09:00';app.control('#cs-edit-end').value='17:00';
  app.scope('all');
  assert.deepEqual(app.currentDescription(),rich('Seriens oprindelige instruktion'));
  assert.equal(app.control('#cs-edit-start').value,'07:00','An exceptional occurrence must not become the whole-series pattern by switching scope.');
  const shared=rich('Ny fælles instruktion');app.editor.setContent(shared);app.control('#cs-edit-start').value='08:00';
  app.scope('one');assert.deepEqual(app.currentDescription(),single);assert.equal(app.control('#cs-edit-start').value,'09:00');
  app.scope('all');assert.deepEqual(app.currentDescription(),shared);assert.equal(app.control('#cs-edit-start').value,'08:00');
  assert.equal(app.persisted(),0);assert.equal(app.state.series[0].note,'Seriens oprindelige instruktion','Scope changes are only drafts.');
});

test('future and whole-series drafts share pattern changes while retaining their own date ranges',()=>{
  const app=application(),series=app.state.series[0];app.openSeriesEditor(series,app.control('#fixture-open'));
  assert.equal(app.control('#cs-edit-scope').value,'future');
  app.control('#cs-repeat-start').value='2026-11-04';app.control('#cs-repeat-end').value='2027-01-15';
  app.control('#cs-edit-start').value='08:30';app.control('#cs-edit-end').value='16:30';app.days([0,2,4]);app.editor.setContent(rich('Fælles mønster A'));
  app.scope('all');
  assert.equal(app.control('#cs-repeat-start').value,series.startDate);assert.equal(app.control('#cs-repeat-end').value,series.endDate);
  assert.equal(app.control('#cs-edit-start').value,'08:30');assert.deepEqual(Array.from(app.captureEditorDraft().weekdays),[0,2,4]);
  app.control('#cs-repeat-start').value='2026-10-27';app.control('#cs-repeat-end').value='2027-03-15';app.control('#cs-edit-start').value='09:00';app.editor.setContent(rich('Fælles mønster B'));app.control('#cs-preserve-exceptions').checked=false;
  app.scope('future');
  assert.equal(app.control('#cs-repeat-start').value,'2026-11-04');assert.equal(app.control('#cs-repeat-end').value,'2027-01-15');
  assert.equal(app.control('#cs-edit-start').value,'09:00');assert.deepEqual(app.currentDescription(),rich('Fælles mønster B'));assert.equal(app.control('#cs-preserve-exceptions').checked,false);
  app.scope('all');assert.equal(app.control('#cs-repeat-start').value,'2026-10-27');assert.equal(app.control('#cs-repeat-end').value,'2027-03-15');assert.equal(app.persisted(),0);
});

test('visiting a new series scope through single mode retains the latest series-family draft',()=>{
  const app=application(),series=app.state.series[0];Object.assign(series,rich('Oprindelig serieskabelon'));
  app.begin(app.at('2026-11-03'));
  const single=rich('Min enkeltvagt'),shared=rich('Min redigerede fælles instruktion');
  app.editor.setContent(single);app.scope('future');app.editor.setContent(shared);app.control('#cs-edit-start').value='08:30';app.days([0,2,4]);
  app.control('#cs-repeat-end').value='2027-01-15';app.scope('one');assert.deepEqual(app.currentDescription(),single);
  app.scope('all');
  assert.deepEqual(app.currentDescription(),shared,'An unvisited whole-series scope must inherit the latest series draft, not discard it for source defaults.');
  assert.equal(app.control('#cs-edit-start').value,'08:30');assert.deepEqual(Array.from(app.captureEditorDraft().weekdays),[0,2,4]);
  assert.equal(app.control('#cs-repeat-start').value,series.startDate);assert.equal(app.control('#cs-repeat-end').value,series.endDate);
  app.scope('future');assert.deepEqual(app.currentDescription(),shared);assert.equal(app.control('#cs-repeat-end').value,'2027-01-15');
});

test('series management starts at a future anchor rather than a past anchor or a moved actual date',()=>{
  const app=application(),series=app.state.series[0],past=app.at('2026-10-27'),future=app.at('2026-11-03');
  app.state.edits[past.id]={...past,date:'2026-11-10'};app.state.edits[future.id]={...future,date:'2026-11-12'};
  app.openSeriesEditor(series,app.control('#fixture-open'));
  assert.equal(app.management(),true);assert.equal(app.active().id,future.id);assert.equal(app.control('#cs-repeat-start').value,'2026-11-03');assert.equal(app.editorCutoff(series,'future'),'2026-11-03');
  app.control('#cs-repeat-start').value='2026-11-04';assert.equal(app.editorCutoff(series,'future'),'2026-11-04','Management explicitly allows an effective date between occurrences.');
  app.discardDraft();app.begin(app.state.edits[future.id],{scope:'future'});
  assert.equal(app.management(),false);assert.equal(app.control('#cs-edit-date').value,'2026-11-12');assert.equal(app.control('#cs-repeat-start').value,'2026-11-03');
  app.control('#cs-repeat-start').value='2026-11-06';assert.equal(app.editorCutoff(series,'future'),'2026-11-03','Calendar editing keeps the original occurrence cutoff even if the replacement pattern starts later.');
});

test('management of a fully cancelled active series falls back to today, and ended series opens whole scope',()=>{
  const app=application(),series=app.state.series[0];app.state.deleted=app.seriesOccurrences(series).map(shift=>shift.id);
  app.openSeriesEditor(series,app.control('#fixture-open'));assert.equal(app.control('#cs-edit-scope').value,'future');assert.equal(app.control('#cs-repeat-start').value,'2026-10-30');
  assert.equal(app.editorCutoff(series,'future'),'2026-10-30');
  series.endDate='2026-10-29';app.openSeriesEditor(series,app.control('#fixture-open'));
  assert.equal(app.control('#cs-edit-scope').value,'all');assert.equal(app.control('#cs-repeat-start').value,series.startDate);
});

test('saving from an arbitrary effective date retains earlier occurrences and splits only the future definition',()=>{
  const app=application(),series=app.state.series[0],prior=plain(app.at('2026-11-03'));
  app.openSeriesEditor(series,app.control('#fixture-open'));
  app.control('#cs-repeat-start').value='2026-11-04';app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.editor.setContent(rich('Ny plan fra onsdag'));
  app.updatePreview();app.save();
  assert.equal(app.persisted(),1);assert.equal(app.state.series.length,2);
  assert.equal(app.state.series.find(item=>item.id===series.id).endDate,'2026-11-03');
  assert.deepEqual(plain(app.at('2026-11-03')),prior);
  const replacement=app.at('2026-11-05');assert.notEqual(replacement.seriesId,series.id);assert.equal(replacement.start,'08:00');assert.equal(replacement.note,'Ny plan fra onsdag');
  assert.equal(app.state.series.find(item=>item.id===replacement.seriesId).startDate,'2026-11-04');
});

test('effective live preview and transaction preserve detached exceptions and cancellations when weekdays change',()=>{
  const app=application(),series=app.state.series[0],special=app.at('2026-11-03'),cancelled=app.at('2026-11-05');
  app.state.edits[special.id]={...special,start:'17:00',end:'19:00',...rich('Særbesøg')};app.state.deleted=[cancelled.id];
  app.begin(special,{scope:'all'});app.days([0]);app.updatePreview();
  const summary=app.control('#cs-series-preview').textContent;
  assert.equal(app.control('#cs-series-preview').dataset.valid,'true');assert.match(summary,/1 særændring og 1 aflysning bevares/);
  const draft=app.readSeriesDraft(),preview=require('../src/series-planner.js').preview({draft:plain(draft),source:plain(series),scope:'all',edits:plain(app.state.edits),deleted:Array.from(app.state.deleted),preserve:true,today:'2026-10-30'});
  assert.ok(preview.detached.some(shift=>shift.id===special.id));assert.match(summary,new RegExp('^'+preview.total+'vagter efter gemning'));
  app.save();assert.equal(app.persisted(),1);assert.equal(app.state.edits[special.id].seriesId,undefined);assert.equal(app.state.edits[special.id].note,'Særbesøg');
  assert.equal(app.shiftsInRange(series.startDate,series.endDate).filter(shift=>shift.person==='p0').length,preview.total);
});

test('a preserved exception far beyond the pattern range is checked in bounded weeks and survives saving',()=>{
  const app=application(),series=app.state.series[0],shift=app.at('2026-11-03');
  app.state.edits[shift.id]={...shift,date:'2028-05-02',start:'17:00',end:'19:00',...rich('Besøg flyttet langt frem')};
  app.begin(shift,{scope:'all'});app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';
  assert.doesNotThrow(()=>app.save());assert.equal(app.persisted(),1);
  const actual=app.at('2028-05-02');assert.equal(actual.id,shift.id);assert.equal(actual.note,'Besøg flyttet langt frem');assert.equal(actual.start,'17:00');
});

test('a detached exception cannot make an empty recurrence look savable, and single-mode staffing resets the save state',()=>{
  const app=application(),special=app.at('2026-11-03');app.state.edits[special.id]={...special,start:'17:00',end:'19:00',...rich('Bevar særbesøget')};
  app.begin(special,{scope:'all'});app.control('#cs-repeat-start').value='2026-11-04';app.control('#cs-repeat-end').value='2026-11-04';app.days([1]);app.updatePreview();
  assert.equal(app.control('#cs-series-preview').dataset.valid,'false');assert.match(app.control('#cs-series-preview').textContent,/ingen planlagte vagter/);
  assert.equal(app.control('#cs-save').disabled,true);assert.equal(app.control('#cs-series-next-dates').children.some(row=>row.tagName==='LI'&&row.children.length>0),false);
  assert.equal(app.persisted(),0);
  app.scope('one');assert.equal(app.control('#cs-save').disabled,false,'The real staffing refresh must release a valid single edit from the series preview state.');
});

test('opening an untouched management draft cannot create a redundant future split or persistence operation',()=>{
  const app=application(),before=plain(app.state);app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));
  assert.equal(app.control('#cs-edit-scope').value,'future');assert.equal(app.control('#cs-save').disabled,true);
  app.save();
  assert.equal(app.persisted(),0);assert.deepEqual(plain(app.state),before,'Even a direct save call must preserve the original definitions and exceptions.');
  assert.equal(app.active(),null,'A no-op save closes the editor without a transaction.');
});

test('shortening a series remains savable even when only end-date metadata changes',()=>{
  for(const endDate of ['2027-01-15','2027-04-25']){
    const app=application(),series=app.state.series[0],before=app.seriesOccurrences(series).filter(shift=>shift.date>='2026-11-03').length;
    app.openSeriesEditor(series,app.control('#fixture-open'));app.control('#cs-repeat-end').value=endDate;app.updatePreview();
    assert.equal(app.control('#cs-save').disabled,false,endDate+' must not be mistaken for an untouched future draft.');
    app.save();assert.equal(app.persisted(),1);
    const future=app.state.series.find(item=>item.id!==series.id);assert.equal(future.endDate,endDate);
    const after=app.seriesOccurrences(future).length;
    if(endDate==='2027-04-25')assert.equal(after,before,'The Sunday end date changes the definition without changing the last Thursday occurrence.');
    else assert.ok(after<before,'A genuinely shorter period removes the later occurrences.');
  }
});

test('extension appends only a new grouped phase and preserves all old IDs, exceptions and completion',()=>{
  const app=application(),series=app.state.series[0],special=app.at('2026-11-03');
  app.state.edits[special.id]={...special,start:'17:00',end:'19:00',note:'Særbesøg'};app.state.checklistProgress={example:{checked:['one']}};
  const before=plain(app.state),old=plain(app.seriesOccurrences(series));
  app.extendSeriesEditor(series,app.control('#fixture-open'));
  assert.equal(app.control('#cs-editor-title').textContent,'Forlæng vagtserie');assert.equal(app.control('#cs-repeat-start').readOnly,true);
  const draft=plain(app.readSeriesDraft());assert.equal(draft.startDate,'2027-04-27');assert.equal(draft.endDate,'2027-07-26');assert.equal(draft.groupId,series.id);
  app.save();assert.equal(app.persisted(),1);assert.equal(app.state.series.length,2);
  assert.deepEqual(plain(app.state.series.find(item=>item.id===series.id)),before.series[0]);assert.deepEqual(plain(app.seriesOccurrences(series)),old);assert.deepEqual(plain(app.state.edits),before.edits);assert.deepEqual(plain(app.state.checklistProgress),before.checklistProgress);
  const groups=require('../src/series-lifecycle.js').groupSeries(plain(app.state.series),{today:'2026-10-30',edits:plain(app.state.edits),deleted:plain(app.state.deleted)});assert.equal(groups.length,1);assert.equal(groups[0].phases.length,2);
});

test('stale extension is rejected if the agreement was extended while the editor stayed open',()=>{
  const app=application(),series=app.state.series[0];app.extendSeriesEditor(series,app.control('#fixture-open'));
  const extra=require('../src/series-lifecycle.js').extensionDraft(plain(series),{id:'other-new-phase',months:1}).draft;app.state.series.push(extra);
  app.save();assert.equal(app.persisted(),0);assert.match(app.control('#cs-edit-error').textContent,/Serien er ændret/);assert.equal(app.state.series.length,2);
});

test('copy opens an unassigned independent draft carrying rich instructions and daily times only',()=>{
  const app=application(),series=app.state.series[0];Object.assign(series,rich('Instruktion til kopien'),{dayTimes:{1:{start:'18:00',end:'20:00'},3:{start:'18:00',end:'21:00'}}});
  const special=app.at('2026-11-03');app.state.edits[special.id]={...special,start:'18:00',end:'20:00'};app.state.deleted=[app.at('2026-11-05').id];const before=plain(app.state);
  app.copySeriesEditor(series,app.control('#fixture-open'));assert.equal(app.control('#cs-editor-title').textContent,'Kopiér vagtserie');assert.equal(app.control('#cs-edit-person').value,'');assert.equal(app.persisted(),0);
  app.control('#cs-edit-person').value='p21';app.control('#cs-edit-site').value='2';app.control('#cs-repeat-start').value='2027-05-01';app.control('#cs-repeat-end').value='2027-06-01';app.updatePreview();const draft=plain(app.readSeriesDraft());
  assert.notEqual(draft.id,series.id);assert.equal(draft.groupId,draft.id);assert.deepEqual(draft.dayTimes,Object.fromEntries(Object.entries(series.dayTimes).map(([day,times])=>[day,{...times,plannedBreakMinutes:0}])));assert.equal(draft.noteRich,series.noteRich);
  app.save();assert.equal(app.persisted(),1,app.control('#cs-edit-error').textContent);assert.equal(app.state.series.length,2);assert.deepEqual(plain(app.state.edits),before.edits);assert.deepEqual(plain(app.state.deleted),before.deleted);assert.ok(app.seriesOccurrences(draft).length>0);
});

test('weekday times survive scope changes, materialize correctly and can be explicitly cleared',()=>{
  const app=application(),series=app.state.series[0];app.openSeriesEditor(series,app.control('#fixture-open'));app.scope('all');
  app.dayTimes({1:{start:'06:30',end:'11:30'},3:{start:'10:00',end:'14:30'}});app.updatePreview();app.save();assert.equal(app.persisted(),1);
  assert.equal(app.at('2026-11-03').start,'06:30');assert.equal(app.at('2026-11-05').start,'10:00');
  app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));app.scope('all');assert.equal(app.control('#cs-day-times-enabled').checked,true);
  app.control('#cs-day-times-enabled').checked=false;app.updatePreview();app.save();assert.equal(app.persisted(),2);assert.deepEqual(plain(app.state.series[0].dayTimes),{});assert.equal(app.at('2026-11-03').start,'07:00');
});

test('a weekday override without an occurrence still changes the stored template',()=>{
  const app=application(),series=app.state.series[0];series.endDate='2026-10-27';app.openSeriesEditor(series,app.control('#fixture-open'));app.dayTimes({1:{start:'07:00',end:'15:00'},3:{start:'09:00',end:'13:00'}});app.updatePreview();
  assert.equal(app.control('#cs-save').disabled,false);app.save();assert.equal(app.persisted(),1);assert.equal(app.state.series[0].dayTimes[3].start,'09:00');
});

test('editing a phase cannot overlap a later phase of the same agreement',()=>{
  const app=application(),series=app.state.series[0];const extra=require('../src/series-lifecycle.js').extensionDraft(plain(series),{id:'next-phase',months:1}).draft;app.state.series.push(extra);
  app.openSeriesEditor(series,app.control('#fixture-open'));app.control('#cs-repeat-end').value='2027-05-15';app.updatePreview();assert.equal(app.control('#cs-save').disabled,true);
  app.save();assert.equal(app.persisted(),0);assert.match(app.control('#cs-edit-error').textContent,/Perioder.*overlappe/);
});

test('undo of the first metadata upgrade emits explicit clears rather than dropping schema fields',()=>{
  const app=application(),old=plain(app.state.series[0]),current={...old,groupId:old.id,dayTimes:{1:{start:'08:00',end:'12:00'}}};
  const restored=plain(app.restoredSeriesMetadata([old],[current]));assert.equal(restored[0].groupId,old.id);assert.deepEqual(restored[0].dayTimes,{});assert.equal(old.dayTimes,undefined);
});

test('an untouched partial weekday override does not create a redundant future phase',()=>{
  const app=application(),series=app.state.series[0];series.dayTimes={3:{start:'10:00',end:'14:00'}};app.openSeriesEditor(series,app.control('#fixture-open'));assert.equal(app.control('#cs-save').disabled,true);app.save();assert.equal(app.persisted(),0);assert.equal(app.state.series.length,1);
});

test('preserved reassigned exceptions expose their actual approved absence before saving',()=>{
  const app=application(),series=app.state.series[0],original=app.at('2026-11-03');app.state.edits[original.id]={...original,person:'p6',date:'2026-10-28',start:'18:00',end:'20:00'};
  app.begin(original,{scope:'all'});app.control('#cs-edit-start').value='08:00';app.updatePreview();assert.equal(app.control('#cs-save').disabled,true);assert.match(app.control('#cs-series-calendar').textContent,/Godkendt fravær/);app.save();assert.equal(app.persisted(),0);assert.match(app.control('#cs-edit-error').textContent,/godkendt fravær/);
});


test('demo series append in one undoable draft without replacing existing series, exceptions or publication',()=>{
  const app=application(),before=plain(app.state);app.state.search='ukendt';app.state.site='2';app.addSeriesExamples();
  assert.equal(app.persisted(),1);assert.equal(app.state.series.length,before.series.length+7);assert.deepEqual(plain(app.state.series[0]),before.series[0]);assert.deepEqual(plain(app.state.edits),before.edits);assert.deepEqual(plain(app.state.deleted),before.deleted);assert.deepEqual(plain(app.state.checklistProgress),before.checklistProgress);
  assert.equal(app.state.search,'');assert.equal(app.state.site,'all');assert.equal(app.seriesStatus(),'all');assert.ok(app.expanded().has('demo-series-periods'));
  const current=plain(app.state.series);app.addSeriesExamples();assert.equal(app.persisted(),1);assert.deepEqual(plain(app.state.series),current);
});

test('series examples cannot be installed into own-data mode or an active guided scenario',()=>{
  for(const mode of ['own','scenario']){const app=application(),before=plain(app.state.series);if(mode==='own')app.state.demoSeed=false;else app.state.demoSession={scenario:'series'};app.addSeriesExamples();assert.equal(app.persisted(),0);assert.deepEqual(plain(app.state.series),before);}
});

test('single shift saves an explicit planned pause without changing the rest of its series',()=>{
  const app=application(),shift=app.at('2026-11-03'),before=plain(app.state.series);
  app.begin(shift);app.control('#cs-edit-break').value='30';app.updatePreview();
  assert.equal(app.control('#cs-edit-net-time').textContent,'7 t 30 min planlagt arbejdstid');
  app.save();assert.equal(app.persisted(),1,app.control('#cs-edit-error').textContent);
  assert.equal(app.state.edits[shift.id].plannedBreakMinutes,30);assert.deepEqual(plain(app.state.series),before);
  app.begin(app.at('2026-11-03'));assert.equal(app.control('#cs-edit-break').value,'30');
});

test('series pause-only changes update occurrences and can be explicitly cleared',()=>{
  const app=application(),series=app.state.series[0];app.openSeriesEditor(series,app.control('#fixture-open'));app.scope('all');
  app.control('#cs-edit-break').value='30';app.updatePreview();assert.equal(app.control('#cs-save').disabled,false);app.save();
  assert.equal(app.persisted(),1,app.control('#cs-edit-error').textContent);assert.equal(app.at('2026-11-03').plannedBreakMinutes,30);
  app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));app.scope('all');app.control('#cs-edit-break').value='0';app.updatePreview();app.save();
  assert.equal(app.persisted(),2,app.control('#cs-edit-error').textContent);assert.equal(app.state.series[0].plannedBreakMinutes,0);assert.equal(app.at('2026-11-03').plannedBreakMinutes??0,0);
});

test('weekday pauses survive scope changes and materialize independently',()=>{
  const app=application(),series=app.state.series[0];app.openSeriesEditor(series,app.control('#fixture-open'));app.scope('all');app.control('#cs-edit-break').value='30';
  app.dayTimes({1:{start:'07:00',end:'15:00',plannedBreakMinutes:15},3:{start:'07:00',end:'15:00',plannedBreakMinutes:45}});app.updatePreview();
  app.scope('future');app.scope('all');const draft=plain(app.readSeriesDraft());assert.equal(draft.plannedBreakMinutes,30);assert.equal(draft.dayTimes[1].plannedBreakMinutes,15);assert.equal(draft.dayTimes[3].plannedBreakMinutes,45);
  app.save();assert.equal(app.persisted(),1,app.control('#cs-edit-error').textContent);assert.equal(app.at('2026-11-03').plannedBreakMinutes,15);assert.equal(app.at('2026-11-05').plannedBreakMinutes,45);
});

test('invalid planned pauses never save and undo emits explicit clears for old records',()=>{
  for(const pause of ['480','-1','30.5']){const app=application(),shift=app.at('2026-11-03');app.begin(shift);app.control('#cs-edit-break').value=pause;app.updatePreview();app.save();assert.equal(app.persisted(),0);assert.match(app.control('#cs-edit-error').textContent,/pause/i);}
  const app=application(),old=plain(app.state.series[0]);assert.equal(app.restoredSeriesMetadata([old],[{...old,plannedBreakMinutes:30}])[0].plannedBreakMinutes,0);
  const shift=app.at('2026-11-03'),oldEdits={[shift.id]:shift};assert.equal(app.restoredPauseEdits(oldEdits,{[shift.id]:{...shift,plannedBreakMinutes:30}})[shift.id].plannedBreakMinutes,0);assert.equal(oldEdits[shift.id].plannedBreakMinutes,undefined);
});

function reconciliationFixture(){
 const app=application(),shift=(id,person,date='2026-11-03')=>({id,person,date,site:0,start:'07:00',end:'15:00',plannedBreakMinutes:0,note:''});
 Object.assign(app.state,{demoSeed:false,series:[],edits:{a:shift('a','p0'),b:shift('b','p1'),c:shift('c','p2','2026-11-04')},deleted:[],weekPlans:{},page:'schedule',week:1,search:'Mit filter'});return app;
}

test('a rebased acknowledgement keeps an unrelated open draft and view while undo reverses only our own shift',()=>{
 const app=reconciliationFixture();app.begin(app.state.edits.a);app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.save();assert.equal(app.state.edits.a.start,'08:00');
 app.begin(app.state.edits.c);app.control('#cs-edit-start').value='10:45';app.control('#cs-edit-end').value='18:45';app.editor.setContent(rich('Ikke gemt endnu'));
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.b.start='09:00';acknowledged.edits.b.end='17:00';acknowledged.week=30;acknowledged.search='En anden persons filter';acknowledged.workspaceSettings={companyName:'Fælles nyt navn'};
 app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.state.edits.b.start,'09:00');assert.equal(app.state.week,1);assert.equal(app.state.search,'Mit filter');assert.equal(app.control('#cs-edit-start').value,'10:45');assert.deepEqual(app.currentDescription(),rich('Ikke gemt endnu'));assert.equal(app.control('#cs-save').disabled,false);
 app.undo();assert.equal(app.state.edits.a.start,'07:00');assert.equal(app.state.edits.b.start,'09:00','Undo must retain the peer change.');assert.equal(app.state.workspaceSettings.companyName,'Fælles nyt navn');assert.equal(app.state.week,1);assert.equal(app.getUndo(),null);
});

test('a peer change to the open shift keeps dirty inputs but blocks saving and deletion until reopening',()=>{
 const app=reconciliationFixture();app.begin(app.state.edits.a);app.control('#cs-edit-start').value='10:15';app.control('#cs-edit-end').value='18:15';app.editor.setContent(rich('Bevar denne kladde'));
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.a.start='08:30';acknowledged.edits.a.end='16:30';app.reconcile(acknowledged,{submitted,acknowledged});
 assert.equal(app.control('#cs-edit-start').value,'10:15');assert.deepEqual(app.currentDescription(),rich('Bevar denne kladde'));assert.equal(app.control('#cs-save').disabled,true);assert.equal(app.control('#cs-delete').disabled,true);assert.equal(app.control('#cs-series-delete-apply').disabled,true);assert.match(app.control('#cs-edit-error').textContent,/andet vindue/);
 app.save();app.deleteEditedShift();assert.equal(app.persisted(),0);assert.equal(app.state.edits.a.start,'08:30');assert.equal(app.state.deleted.includes('a'),false);app.updatePreview();assert.equal(app.control('#cs-save').disabled,true);
 app.discardDraft();app.begin(app.state.edits.a);assert.equal(app.control('#cs-save').disabled,false);assert.equal(app.control('#cs-delete').disabled,false);app.control('#cs-edit-start').value='09:00';app.control('#cs-edit-end').value='17:00';app.save();assert.equal(app.state.edits.a.start,'09:00');assert.equal(app.persisted(),1);
});

test('a parent-series change stales an open series editor without replacing its unsaved pattern',()=>{
 const app=application(),series=app.state.series[0];app.openSeriesEditor(series);app.control('#cs-edit-start').value='09:45';app.control('#cs-edit-end').value='17:45';app.editor.setContent(rich('Ny mønsterkladde'));
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.series[0].start='08:00';acknowledged.series[0].end='16:00';app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.control('#cs-edit-start').value,'09:45');assert.deepEqual(app.currentDescription(),rich('Ny mønsterkladde'));assert.equal(app.control('#cs-save').disabled,true);app.save();app.deleteEditedShift();assert.equal(app.persisted(),0);assert.equal(app.state.series[0].start,'08:00');assert.equal(app.state.series.length,1);
});

test('a newly changed exception blocks a later series-wide scope while leaving the unaffected single occurrence usable',()=>{
 const app=application(),shift=app.at('2026-11-03');app.begin(shift);app.editor.setContent(rich('Enkeltvagtens kladde'));
 const submitted=plain(app.state),acknowledged=plain(submitted),other=app.at('2026-11-05');acknowledged.edits[other.id]={...plain(other),start:'10:00',end:'18:00'};app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.control('#cs-save').disabled,false);
 app.scope('all');assert.equal(app.control('#cs-save').disabled,true);assert.deepEqual(app.currentDescription(),rich('Enkeltvagtens kladde'));app.save();assert.equal(app.persisted(),0);assert.equal(app.state.edits[other.id].start,'10:00');
 app.scope('one');assert.equal(app.control('#cs-save').disabled,false);app.save();assert.equal(app.persisted(),1);assert.equal(app.state.edits[other.id].start,'10:00');
});

test('open group and bulk transactions cannot overwrite a member changed by a peer',()=>{
 for(const kind of ['group','bulk']){
  const app=reconciliationFixture(),members=[app.state.edits.a,app.state.edits.b];if(kind==='group')app.openGroupEditor({date:members[0].date,start:'07:00',end:'15:00',shifts:members},app.control('#fixture-open'));else app.openBulk(members,'time');
  app.control('#cs-'+kind+'-start').value='09:30';app.control('#cs-'+kind+'-end').value='17:30';const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.b.start='08:15';acknowledged.edits.b.end='16:15';app.reconcile(acknowledged,{submitted,acknowledged});
  assert.equal(app.control('#cs-'+kind+'-start').value,'09:30');assert.equal(app.control('#cs-'+kind+'-save').disabled,true);assert.match(app.control('#cs-'+kind+'-error').textContent,/andet vindue/);app[kind==='group'?'saveGroup':'saveBulk']({preventDefault(){}});assert.equal(app.persisted(),0);assert.equal(app.state.edits.b.start,'08:15');assert.equal(app.state.edits.a.start,'07:00');
 }
});

test('an unrelated peer edit and our own queued changes do not falsely stale a group',()=>{
 const app=reconciliationFixture(),members=[app.state.edits.a,app.state.edits.b];app.openGroupEditor({date:members[0].date,start:'07:00',end:'15:00',shifts:members},app.control('#fixture-open'));app.control('#cs-group-start').value='09:30';app.control('#cs-group-end').value='17:30';
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.c.start='08:15';acknowledged.edits.c.end='16:15';app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.control('#cs-group-save').disabled,false);app.saveGroup({preventDefault(){}});assert.equal(app.persisted(),1);assert.equal(app.state.edits.a.start,'09:30');assert.equal(app.state.edits.b.start,'09:30');assert.equal(app.state.edits.c.start,'08:15');
});

test('an own coverage-rule acknowledgement retains undo while preserving peer shifts and company settings',()=>{
 const app=reconciliationFixture(),before=plain(app.state.coverageRules),rule={id:'own-evening',site:0,weekdays:[0],start:'18:00',end:'20:00',required:2};assert.equal(app.applyNeedRule(rule).ok,true);
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.b.start='08:30';acknowledged.workspaceSettings={companyName:'Peer company settings'};app.reconcile(acknowledged,{submitted,acknowledged});assert.ok(app.getUndo());app.undo();assert.deepEqual(plain(app.state.coverageRules),before);assert.equal(app.state.edits.b.start,'08:30');assert.equal(app.state.workspaceSettings.companyName,'Peer company settings');
});

test('an intervening peer change to coverage rules disables the stale metadata-only undo',()=>{
 const app=reconciliationFixture(),rule={id:'own-evening',site:0,weekdays:[0],start:'18:00',end:'20:00',required:2};assert.equal(app.applyNeedRule(rule).ok,true);const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.coverageRules.push({id:'peer-evening',site:1,weekdays:[1],start:'18:00',end:'20:00',required:2});app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.getUndo(),null);assert.ok(app.state.coverageRules.some(value=>value.id==='peer-evening'));assert.ok(app.state.coverageRules.some(value=>value.id==='own-evening'));
});

test('a peer change to the last saved undo target disables undo instead of replacing that peer value',()=>{
 const app=reconciliationFixture();app.begin(app.state.edits.a);app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.save();assert.ok(app.getUndo());
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.a.start='09:00';acknowledged.edits.a.end='17:00';app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.getUndo(),null);app.undo();assert.equal(app.state.edits.a.start,'09:00');
});

test('one peer-modified member invalidates an entire bulk undo while retaining all acknowledged values',()=>{
 const app=reconciliationFixture(),members=[app.state.edits.a,app.state.edits.b];app.openGroupEditor({date:members[0].date,start:'07:00',end:'15:00',shifts:members},app.control('#fixture-open'));app.control('#cs-group-start').value='08:00';app.control('#cs-group-end').value='16:00';app.saveGroup({preventDefault(){}});assert.ok(app.getUndo());
 const submitted=plain(app.state),acknowledged=plain(submitted);acknowledged.edits.b.start='09:00';acknowledged.edits.b.end='17:00';app.reconcile(acknowledged,{submitted,acknowledged});assert.equal(app.getUndo(),null);app.undo();assert.equal(app.state.edits.a.start,'08:00');assert.equal(app.state.edits.b.start,'09:00');
});

const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
function periodClient(app,{from='2026-11-02',to='2026-12-27'}={}){
 const Scope=require('../src/planning-scope.js');let projection={mode:'calendar',from,to},availability=null,catalog=null,selection=null;const reads=[],actions=[],publications=[];
 const api={
  get isPartial(){return projection!==null;},get projection(){return projection&&plain(projection);},
  get availability(){return availability&&plain(availability);},get catalog(){return catalog&&plain(catalog);},get selection(){return selection&&plain(selection);},
  covers:range=>{if(projection?.catalogOnly)return false;const calendar=projection&&Scope.calendar(projection);return !projection||range.from>=calendar.from&&range.to<=calendar.to;},
  coversScope:scope=>!projection||JSON.stringify(Scope.normalize(scope))===JSON.stringify(projection),
  scope:scope=>read(Scope.normalize(scope)),window:scope=>read(scope),ensureFull:()=>read(null),
  action:async(...args)=>{actions.push(args);return {ok:true};},
  publish:async(...args)=>{publications.push(args);return {ok:false,message:'Test publication boundary'};}
 };
 function read(scope){let resolve;const promise=new Promise(done=>resolve=done);reads.push({scope:scope&&plain(scope),submitted:plain(app.state),resolve});return promise;}
 async function reply(index,{ok=true,studio=plain(app.state),scopeExpansion=true,availability:nextAvailability=null,catalog:nextCatalog=null,selection:nextSelection=null,...rest}={}){
  const item=reads[index];assert.ok(item,'An actual application guard must request the data before it is supplied');
  if(ok){const previousProjection=projection;projection=item.scope;availability=nextAvailability;catalog=nextCatalog;selection=nextSelection;app.reconcile(studio,{submitted:item.submitted,acknowledged:studio,scopeReplacement:true,scopeExpansion:scopeExpansion&&Boolean(previousProjection),projection,previousProjection,availability,catalog,selection});}
  item.done=true;item.resolve({ok,...(ok?{studio}:{}),...rest});await settle();
 }
 app.installWindow(api);return {api,reads,actions,publications,reply};
}

test('duration controls react immediately while a changed series horizon waits for scoped data',async()=>{
 const app=application(),client=periodClient(app);app.state.demoSeed=false;
 app.openSeriesEditor(app.state.series[0],app.control('#fixture-open'));await client.reply(0);
 app.chooseSeriesLength(null);assert.equal(client.reads.length,2);assert.equal(app.planningStatus().busy,true);
 assert.equal(app.control('#cs-repeat-unlimited').getAttribute('aria-pressed'),'true');assert.equal(app.control('#cs-repeat-end-field').hidden,true);assert.equal(app.control('#cs-repeat-end').disabled,true);assert.equal(app.control('#cs-repeat-end').required,false);assert.equal(app.control('#cs-repeat-unlimited-hint').hidden,false);assert.equal(app.control('#cs-save').disabled,true);
 await client.reply(1);assert.match(app.control('#cs-series-preview').textContent,/Uden slutdato/);assert.equal(app.planningStatus().busy,false);assert.equal(app.persisted(),0);
});

test('period loading keeps an in-window single-occurrence edit local without expanding the plan',async()=>{
 const app=reconciliationFixture(),client=periodClient(app);app.begin(app.state.edits.a);
 app.control('#cs-edit-start').value='08:15';app.control('#cs-edit-end').value='16:15';app.editor.setContent(rich('En lokal enkeltvagt'));
 app.updatePreview();app.save();await settle();
 assert.equal(client.reads.length,0);assert.equal(app.persisted(),1);assert.equal(app.state.edits.a.start,'08:15');assert.equal(app.state.edits.b.start,'07:00');assert.equal(client.api.isPartial,true);
});

test('changing a partial occurrence to a whole-series scope waits for scoped context and retains both dirty drafts',async()=>{
 const app=application();app.state.week=1;const shift=app.at('2026-11-03'),client=periodClient(app);app.begin(shift);
 app.control('#cs-edit-start').value='09:15';app.control('#cs-edit-end').value='17:15';app.editor.setContent(rich('Den usendte enkeltvagt'));
 app.scope('all');assert.equal(client.reads.length,1);assert.equal(client.reads[0].scope.mode,'series');assert.equal(app.planningStatus().busy,true);assert.equal(app.persisted(),0);
 assert.equal(app.control('#cs-edit-start').value,'09:15');assert.deepEqual(app.currentDescription(),rich('Den usendte enkeltvagt'));
 const expanded=plain(app.state);expanded.edits['outside@2027-02-01']={id:'outside@2027-02-01',date:'2027-02-01',person:'p1',site:0,start:'07:00',end:'15:00',note:''};
 await client.reply(0,{studio:expanded});assert.equal(client.api.isPartial,true);assert.equal(app.control('#cs-edit-scope').value,'all');assert.equal(app.control('#cs-save').disabled,true,'An unchanged series pattern remains a no-op after loading scoped context.');
 app.control('#cs-edit-start').value='08:30';app.control('#cs-edit-end').value='16:30';app.editor.setContent(rich('Seriens usendte mønster'));app.scope('one');
 assert.equal(app.control('#cs-edit-start').value,'09:15');assert.deepEqual(app.currentDescription(),rich('Den usendte enkeltvagt'));app.scope('all');assert.equal(app.control('#cs-edit-start').value,'08:30');assert.deepEqual(app.currentDescription(),rich('Seriens usendte mønster'));assert.equal(app.persisted(),0);
});

test('opening a partial series resolves the current shift again after the awaited full read',async()=>{
 const app=application(),original=app.at('2026-11-03'),client=periodClient(app);app.begin(original,{scope:'all'});
 assert.equal(client.reads.length,1);assert.equal(app.active(),null);
 const fresh=plain(app.state);fresh.edits[original.id]={...plain(original),start:'10:00',end:'18:00',note:'Opdateret før formularen blev åbnet'};
 await client.reply(0,{studio:fresh,scopeExpansion:false});
 assert.equal(app.active().start,'10:00','The continuation cannot reuse an old captured occurrence with fresh row versions.');assert.equal(app.control('#cs-edit-scope').value,'all');assert.equal(app.persisted(),0);
});

test('a failed complete read blocks the main view and retries the pending editor operation without losing inputs',async()=>{
 const app=application(),client=periodClient(app);app.begin(app.at('2026-11-03'));app.control('#cs-edit-start').value='09:45';app.editor.setContent(rich('Bevar kladden ved netværksfejl'));app.scope('all');
 await client.reply(0,{ok:false,status:503});assert.equal(app.planningStatus().busy,false);assert.equal(app.planningStatus().blocked,JSON.stringify(client.reads[0].scope));assert.equal(app.control('.cs-main').inert,true);assert.equal(client.api.isPartial,true);assert.equal(app.planningStatus().retry,true);assert.equal(app.control('#cs-storage-status').hidden,false,'A returned read failure must expose the retry control as well as blocking the old view.');assert.match(app.control('#cs-storage-message').textContent,/indlæses|bevaret/);
 app.save();assert.equal(app.persisted(),0);assert.equal(app.control('#cs-edit-start').value,'09:45');
 app.retryCloud();await settle();assert.equal(client.reads.length,2);assert.deepEqual(app.currentDescription(),rich('Bevar kladden ved netværksfejl'));
 await client.reply(1);assert.equal(app.planningStatus().blocked,'');assert.equal(app.control('.cs-main').inert,false);assert.equal(app.control('#cs-storage-status').hidden,true);assert.equal(app.control('#cs-edit-scope').value,'all');app.scope('one');assert.equal(app.control('#cs-edit-start').value,'09:45');assert.deepEqual(app.currentDescription(),rich('Bevar kladden ved netværksfejl'));assert.equal(app.persisted(),0);
});

test('an outside-window single-date commit waits for complete conflicts while retaining the typed draft',async()=>{
 const app=reconciliationFixture(),client=periodClient(app);app.begin(app.state.edits.a);app.control('#cs-edit-date').value='2027-01-05';app.control('#cs-edit-start').value='10:30';app.control('#cs-edit-end').value='18:30';app.editor.setContent(rich('Flyt til januar'));
 app.save();assert.equal(client.reads.length,1);assert.equal(app.persisted(),0);assert.equal(app.state.edits.a.date,'2026-11-03');assert.equal(app.control('#cs-edit-date').value,'2027-01-05');
 const full=plain(app.state);full.edits.remote={id:'remote',person:'p0',date:'2027-01-05',site:0,start:'10:00',end:'19:00',note:''};await client.reply(0,{studio:full});
 assert.equal(app.persisted(),0,'A remote overlap outside the former cache must block the resumed commit');assert.equal(app.state.edits.a.date,'2026-11-03');assert.equal(app.control('#cs-edit-start').value,'10:30');assert.deepEqual(app.currentDescription(),rich('Flyt til januar'));assert.match(app.control('#cs-edit-error').textContent,/overlap|allerede|anden vagt/i);
});

test('an outside-window bulk commit independently waits even without a prior preview event',async()=>{
 const app=reconciliationFixture(),client=periodClient(app),members=[app.state.edits.a,app.state.edits.b];app.openBulk(members,'move');app.control('#cs-bulk-date').value='2027-01-05';
 app.saveBulk({preventDefault(){}});assert.equal(client.reads.length,1);assert.equal(app.persisted(),0);assert.equal(app.state.edits.a.date,'2026-11-03');
 const full=plain(app.state);full.edits.remote={id:'remote',person:'p0',date:'2027-01-05',site:0,start:'06:00',end:'16:00',note:''};await client.reply(0,{studio:full});
 assert.equal(app.persisted(),0);assert.equal(app.state.edits.a.date,'2026-11-03');assert.equal(app.control('#cs-bulk-date').value,'2027-01-05');assert.equal(app.control('#cs-bulk-save').disabled,true);
});

test('publication from a partial cache opens a fresh scope-only review and never auto-publishes it',async()=>{
 const app=reconciliationFixture(),client=periodClient(app);app.openChanges();assert.equal(client.reads.length,1);assert.equal(client.reads[0].scope.mode,'publication');assert.equal(client.publications.length,0);assert.equal(app.reviewed(),0);assert.equal(app.control('#cs-changes-publish').disabled,true);
 await client.reply(0);assert.equal(app.reviewed(),1);assert.equal(app.control('#cs-changes-layer').hidden,false);assert.equal(client.publications.length,0,'Loading a review scope requires a new explicit confirmation.');assert.equal(client.api.isPartial,true);
});

test('render waits for the requested calendar projection and evicts a complete cache on returning to the calendar',async()=>{
 const app=reconciliationFixture(),client=periodClient(app);app.planningGate();
 assert.equal(app.needsPlanningProjection(),false);app.state.week=10;assert.equal(app.needsPlanningProjection(),true);assert.equal(client.reads.length,1);assert.equal(app.control('.cs-main').inert,true);assert.equal(app.painted(),0);
 app.state.week=11;assert.equal(app.needsPlanningProjection(),true);assert.equal(client.reads.length,1,'Renders during a read must not start parallel reads.');
 await client.reply(0);assert.equal(client.reads.length,2,'The continuation must notice a newer requested period instead of painting the old one.');assert.equal(app.painted(),0);
 await client.reply(1);assert.equal(app.painted(),1);assert.equal(client.api.projection.from,app.visiblePlanningProjection().from);
 app.state.page='activity';assert.equal(app.needsPlanningProjection(),true);assert.equal(client.reads.at(-1).scope,null);await client.reply(2);assert.equal(client.api.isPartial,false);const prior=app.painted();
 app.state.page='schedule';assert.equal(app.needsPlanningProjection(),true);assert.notEqual(client.reads.at(-1).scope,null);await client.reply(3);assert.equal(client.api.isPartial,true);assert.equal(app.painted(),prior+1);
});

async function finishScopedReads(client,options={}){
 for(let count=0;count<6;count++){
  const index=client.reads.findIndex(item=>!item.done);if(index<0)return;
  assert.notEqual(client.reads[index].scope,null,'Series operations must never use a full-plan fallback');await client.reply(index,options);
 }
 assert.fail('The operation is requesting the same scopes in a loop instead of opening the editor');
}

test('series management, copying and extension open with bounded operation reads and preserve independent semantics',async()=>{
 for(const operation of ['manage','copy','extend']){
  const app=application(),series=app.state.series[0];Object.assign(series,rich('Hele den eksisterende instruktion'));const before=plain(app.state),client=periodClient(app);
  if(operation==='manage')app.openSeriesEditor(series);else if(operation==='copy')app.copySeriesEditor(series);else app.extendSeriesEditor(series);
  assert.equal(client.reads.length,1);assert.equal(client.reads[0].scope.mode,'series');assert.equal(app.persisted(),0);await finishScopedReads(client);
  assert.equal(app.planningStatus().busy,false);assert.equal(app.control('#cs-editor-layer').hidden,false);assert.deepEqual(app.currentDescription(),rich('Hele den eksisterende instruktion'));assert.ok(client.reads.length<=2,operation+': The source group and independent target coverage require at most two projections: '+JSON.stringify(client.reads.map(item=>item.scope)));assert.deepEqual(plain(app.state.series),before.series);assert.equal(app.persisted(),0);
  if(operation==='manage'){assert.equal(app.management(),true);assert.equal(client.reads.length,1,'Management must not alternate between empty and source date ranges');assert.equal(app.control('#cs-edit-scope').value,'future');}
  if(operation==='copy'){assert.equal(app.control('#cs-edit-person').value,'');assert.notEqual(app.readSeriesDraft().id,series.id);assert.notEqual(app.readSeriesDraft().groupId,series.groupId||series.id);}
  if(operation==='extend'){assert.equal(app.readSeriesDraft().groupId,series.id);assert.equal(app.control('#cs-repeat-start').value,'2027-04-27');assert.equal(app.control('#cs-repeat-start').readOnly,true);}
 }
});

test('off-calendar availability templates block a conflicting series without entering its editable state',async()=>{
 const app=application(),source=app.state.series[0],client=periodClient(app),other={id:'neighbor',person:'p0',site:1,startDate:'2027-01-01',endDate:'2027-02-01',weekdays:[1],start:'08:00',end:'12:00'};
 app.begin(app.at('2026-11-03'),{scope:'all'});await finishScopedReads(client,{availability:{series:[other],edits:{},deleted:[],published:[],demoSeed:false}});
 assert.equal(app.state.series.some(item=>item.id==='neighbor'),false);app.control('#cs-edit-start').value='10:00';app.control('#cs-edit-end').value='18:00';app.updatePreview();app.save();
 assert.equal(app.persisted(),0);assert.equal(app.state.series.find(item=>item.id===source.id).start,'07:00');assert.equal(app.control('#cs-save').disabled,true);assert.match(app.control('#cs-staffing-detail').textContent+app.control('#cs-edit-error').textContent,/overlap|optaget|vagt/i);assert.equal(client.reads.every(item=>item.scope.mode==='series'),true);
});

test('extending the typed series date range loads only the new operation coverage and retains long unsaved instructions',async()=>{
 const app=application(),client=periodClient(app);app.begin(app.at('2026-11-03'),{scope:'all'});await finishScopedReads(client);const first=client.reads.length,note=rich('Min usendte instruktion '.repeat(400));app.editor.setContent(note);app.control('#cs-edit-start').value='09:15';app.control('#cs-edit-end').value='17:15';app.control('#cs-repeat-end').value='2027-05-25';app.updatePreview();
 assert.equal(client.reads.length,first+1);assert.equal(client.reads.at(-1).scope.mode,'series');assert.equal(client.reads.at(-1).scope.ranges.at(-1).to,'2027-05-25');assert.equal(app.control('#cs-save').disabled,true);assert.equal(app.persisted(),0);
 await finishScopedReads(client);assert.equal(app.control('#cs-repeat-end').value,'2027-05-25');assert.equal(app.control('#cs-edit-start').value,'09:15');assert.deepEqual(app.currentDescription(),note);assert.equal(app.persisted(),0);assert.equal(client.api.isPartial,true);
});

test('publication range changes load a new scope before rendering its review and leave the old publish action disabled',async()=>{
 const app=reconciliationFixture(),client=periodClient(app);app.openChanges();await client.reply(0);assert.equal(app.reviewed(),1);
 app.changePublicationRange({from:'2026-11-02',to:'2026-11-29'});assert.equal(client.reads.length,2);assert.equal(client.reads[1].scope.mode,'publication');assert.equal(client.reads[1].scope.to,'2026-11-29');assert.equal(app.control('#cs-changes-publish').disabled,true);assert.equal(app.reviewed(),1,'An incomplete replacement cannot repaint a new period using old rows');
 await app.publishReviewedWeek();assert.equal(client.publications.length,0);await client.reply(1);assert.equal(app.reviewed(),2);assert.equal(client.api.projection.to,'2026-11-29');assert.equal(client.reads.some(item=>item.scope===null),false);assert.equal(client.publications.length,0);
});

test('the series list loads compact catalog coverage and returns to the calendar without a full-plan read',async()=>{
 const app=reconciliationFixture(),client=periodClient(app);app.planningGate();app.state.page='series';assert.equal(app.needsPlanningProjection(),true);assert.equal(client.reads[0].scope.mode,'series-list');assert.equal(client.reads[0].scope.catalogOnly,true);
 const catalog={series:[{id:'catalog-only',person:'p1',site:0,startDate:'2027-01-01',endDate:'2027-06-01',weekdays:[1],start:'07:00',end:'15:00',hasDescription:true}],edits:{},deleted:[]};await client.reply(0,{catalog});assert.equal(client.api.covers({from:'2026-11-02',to:'2026-11-08'}),false);assert.equal(client.api.catalog.series.length,1);assert.equal(app.state.series.some(item=>item.id==='catalog-only'),false);assert.equal(app.painted(),1);
 app.state.page='schedule';assert.equal(app.needsPlanningProjection(),true);assert.equal(client.reads[1].scope.mode,'calendar');await client.reply(1);assert.equal(client.api.catalog,null);assert.equal(app.painted(),2);assert.equal(client.reads.some(item=>item.scope===null),false);
});

test('first complete group loading after an unrelated peer revision preserves the dirty occurrence without false series conflict',async()=>{
 const app=application(),client=periodClient(app);app.begin(app.at('2026-11-03'));app.control('#cs-edit-start').value='09:45';app.editor.setContent(rich('Min usendte enkeltvagt'));app.scope('all');
 const expanded=plain(app.state),source=expanded.series[0],id=source.id+'@2027-02-02';expanded.edits[id]={id,seriesId:source.id,person:'p0',site:0,date:'2027-02-02',start:'10:00',end:'18:00',note:'Gammel hidtil uindlæst undtagelse'};
 await client.reply(0,{studio:expanded,scopeExpansion:false});assert.equal(app.control('#cs-edit-scope').value,'all');app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.updatePreview();assert.equal(app.control('#cs-edit-error').hidden,true);assert.equal(app.control('#cs-save').disabled,false);
 app.scope('one');assert.equal(app.control('#cs-edit-start').value,'09:45');assert.deepEqual(app.currentDescription(),rich('Min usendte enkeltvagt'));assert.equal(app.persisted(),0);
});

test('the first group upgrade still rejects a real peer change to an already observed exception',async()=>{
 const app=application(),other=app.at('2026-11-05');app.state.edits[other.id]={...plain(other),note:'Observeret undtagelse'};const client=periodClient(app);app.begin(app.at('2026-11-03'));app.editor.setContent(rich('Bevar min kladde'));app.scope('all');
 const changed=plain(app.state);changed.edits[other.id].start='10:00';changed.edits[other.id].end='18:00';await client.reply(0,{studio:changed,scopeExpansion:false});assert.equal(app.control('#cs-save').disabled,true);assert.match(app.control('#cs-edit-error').textContent,/andet vindue/);assert.deepEqual(app.currentDescription(),rich('Bevar min kladde'));app.save();assert.equal(app.persisted(),0);assert.equal(app.state.edits[other.id].start,'10:00');
});

const conflictFixtureAdd=(day,count)=>{const value=new Date(day+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+count);return value.toISOString().slice(0,10);};
const conflictFixtureSort=shifts=>plain(shifts).sort((left,right)=>left.id.localeCompare(right.id));
function priorWeeklyConflicts(app,weeks,data){const result=new Map();for(const first of new Set(weeks))for(const shift of app.conflictShiftsInRange(conflictFixtureAdd(first,-1),conflictFixtureAdd(first,7),data))result.set(shift.id,shift);return [...result.values()];}

test('coalesced conflict reads preserve exactly the requested week union, moved exceptions and suppressions',()=>{
 const app=application(),Engine=require('../src/series-engine.js'),first='2026-10-26',source={id:'coalesced-source',person:'p0',site:0,startDate:first,endDate:'2027-04-25',weekdays:[0,2],start:'07:00',end:'15:00',note:''},regular=Engine.enumerate(source),moved={...regular[0],date:'2028-05-03',person:'p1',site:2,note:'Moved outside the source period'};
 const neighboring={id:'coalesced-neighbor',person:'p0',site:1,startDate:first,endDate:'2027-04-25',weekdays:[0],start:'10:00',end:'12:00',note:''},gap={id:'gap-only',person:'p0',site:0,date:'2027-08-02',start:'07:00',end:'15:00',note:''};
 Object.assign(app.state,{demoSeed:false,series:[source,neighboring],edits:{[moved.id]:moved,[gap.id]:gap},deleted:[regular[1].id]});
 const weeks=[...Array.from({length:26},(_,index)=>conflictFixtureAdd(first,index*7)),'2028-05-01',first],before=plain(app.state),expected=priorWeeklyConflicts(app,weeks,app.state),reads=app.traceConflictReads(),actual=app.conflictShiftsForWeeks(weeks,app.state);
 assert.deepEqual(conflictFixtureSort(actual),conflictFixtureSort(expected));assert.equal(actual.some(shift=>shift.id===moved.id&&shift.date===moved.date),true);assert.equal(actual.some(shift=>shift.id===regular[1].id||shift.id===gap.id),false);assert.deepEqual(plain(reads),[{from:'2026-10-25',to:'2027-04-26'},{from:'2028-04-30',to:'2028-05-08'}]);assert.deepEqual(plain(app.state),before);
});

test('annual and sparse conflict ranges stay within the day limit without loading intervening unrequested weeks',()=>{
 for(const indexes of [Array.from({length:53},(_,index)=>index),[0,2,3,6,110]]){
  const app=application(),first='2026-10-26';Object.assign(app.state,{demoSeed:false,series:[],edits:{},deleted:[]});
  const weeks=indexes.map(index=>conflictFixtureAdd(first,index*7)),reads=app.traceConflictReads();assert.deepEqual(plain(app.conflictShiftsForWeeks(weeks)),[]);
  assert.ok(reads.every(range=>(Date.parse(range.to)-Date.parse(range.from))/86400000+1<=364));
  const covered=[];for(const range of reads)for(let day=conflictFixtureAdd(range.from,1);day<range.to;day=conflictFixtureAdd(day,7))covered.push(day);
  assert.deepEqual(covered,[...new Set(weeks)].sort());assert.equal(reads.length,indexes.length===53?2:4);const count=reads.length;assert.deepEqual(plain(app.conflictShiftsForWeeks([])),[]);assert.equal(reads.length,count);
 }
});

test('a six-month editor preview materializes conflict context twice while preserving actual overlap and save rules',()=>{
 const app=application(),first='2026-10-26',source={id:'preview-source',person:'p0',site:0,startDate:first,endDate:'2027-04-25',weekdays:[0,2],start:'07:00',end:'15:00',note:''};
 Object.assign(app.state,{demoSeed:false,series:[source],edits:{},deleted:[]});app.openSeriesEditor(source);app.scope('all');app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';
 const reads=app.traceConflictReads();app.updatePreview();assert.equal(reads.length,2,'Staffing and the calendar each materialize one combined range, instead of 26 weekly ranges');assert.ok(reads.every(range=>range.from==='2026-10-25'&&range.to==='2027-04-26'));assert.equal(app.control('#cs-save').disabled,false);assert.equal(app.persisted(),0);
 const collision={id:'preserved-peer',person:'p0',site:1,date:'2027-02-01',start:'10:00',end:'12:00',note:''};app.state.edits[collision.id]=collision;reads.length=0;app.updatePreview();assert.equal(reads.length,2);assert.equal(app.control('#cs-save').disabled,true);assert.match(app.control('#cs-series-calendar').textContent,/Overlap|konflikt/);app.save();assert.equal(app.persisted(),0);assert.equal(app.state.series[0].start,'07:00');
});

test('the actual series editor saves every-other-week shifts across ISO week 53 and week 1',()=>{
 const app=application();app.state.demoSeed=false;app.state.series=[];
 app.openEditor({person:'p0',site:0,date:'2026-12-29',start:'22:00',end:'06:00',note:''},app.control('#fixture-open'),{repeat:true});
 app.control('#cs-repeat-interval').value='2';app.control('#cs-repeat-end').value='2027-01-31';app.updatePreview();
 const draft=app.readSeriesDraft();assert.equal(draft.weekInterval,2);assert.equal(draft.weekAnchor,'2026-12-28');
 assert.match(app.control('#cs-series-sentence').textContent,/hver anden uge/);app.save();assert.equal(app.persisted(),1);
 assert.deepEqual(plain(app.shiftsInRange('2026-12-28','2027-01-31').map(shift=>shift.date)),['2026-12-29','2027-01-12','2027-01-26']);
});

test('a new every-other-week draft follows its chosen start week before it is saved',()=>{
 const app=application();app.state.demoSeed=false;app.state.series=[];
 app.openEditor({person:'p0',site:0,date:'2026-12-29',start:'07:00',end:'15:00',note:''},app.control('#fixture-open'),{repeat:true});
 app.control('#cs-repeat-interval').value='2';assert.equal(app.readSeriesDraft().weekAnchor,'2026-12-28');
 app.control('#cs-repeat-start').value='2027-01-05';app.control('#cs-repeat-end').value='2027-01-31';app.updatePreview();assert.equal(app.readSeriesDraft().weekAnchor,'2027-01-04');
 app.save();assert.deepEqual(plain(app.shiftsInRange('2027-01-01','2027-01-31').map(shift=>shift.date)),['2027-01-05','2027-01-19']);
});

test('editing a future period of an anchored two-week series never shifts its selected weeks',()=>{
 const app=application();app.state.demoSeed=false;
 const source={id:'two-week-editor',person:'p0',site:0,startDate:'2026-12-28',endDate:'2027-01-31',weekdays:[0],weekInterval:2,weekAnchor:'2026-12-28',start:'07:00',end:'15:00',note:''};app.state.series=[source];
 app.openSeriesEditor(source,app.control('#fixture-open'));app.control('#cs-repeat-start').value='2027-01-05';app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.updatePreview();
 assert.equal(app.readSeriesDraft().weekAnchor,'2026-12-28');app.save();assert.equal(app.persisted(),1);
 assert.deepEqual(plain(app.shiftsInRange('2026-12-28','2027-01-31').map(shift=>[shift.date,shift.start])),[['2026-12-28','07:00'],['2027-01-11','08:00'],['2027-01-25','08:00']]);
 assert.ok(app.state.series.every(phase=>phase.weekAnchor==='2026-12-28'&&phase.weekInterval===2));
});

test('undoing a cadence change restores the original weekly schedule with explicit compatible metadata',()=>{
 const app=application();app.state.demoSeed=false;const source=app.state.series[0],before=plain(app.shiftsInRange(source.startDate,'2026-11-30'));
 app.openSeriesEditor(source,app.control('#fixture-open'));app.scope('all');app.control('#cs-repeat-interval').value='2';app.updatePreview();app.save();assert.equal(app.persisted(),1);assert.equal(app.state.series[0].weekInterval,2);
 app.undo();assert.deepEqual(plain(app.shiftsInRange(source.startDate,'2026-11-30')),before);assert.equal(app.state.series[0].weekInterval,1);assert.equal(app.state.series[0].weekAnchor,require('../src/series-engine.js').weekMonday(source.startDate));
});

test('future editing retains earlier two-week phases whose first week contains no occurrence',()=>{
 const app=application();app.state.demoSeed=false;
 const source={id:'off-week-phase',person:'p0',site:0,startDate:'2027-01-04',endDate:'2027-02-28',weekdays:[0],weekInterval:2,weekAnchor:'2026-12-28',start:'07:00',end:'15:00',note:''};app.state.series=[source];
 app.openSeriesEditor(source,app.control('#fixture-open'));app.control('#cs-repeat-start').value='2027-01-26';app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.updatePreview();app.save();
 assert.equal(app.persisted(),1);assert.equal(app.state.series.length,2);
 assert.deepEqual(plain(app.shiftsInRange('2027-01-01','2027-02-28').map(shift=>[shift.date,shift.start])),[['2027-01-11','07:00'],['2027-01-25','07:00'],['2027-02-08','08:00'],['2027-02-22','08:00']]);
});
