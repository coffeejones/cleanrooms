const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Instructions=require('../src/instruction-state.js'),Checklist=require('../src/checklist-progress.js'),Description=require('../src/description-model.js');
const clone=value=>JSON.parse(JSON.stringify(value)),settle=async()=>{for(let index=0;index<16;index++)await Promise.resolve();};

// Reuse the established DOM fixture, not its tests. Add access to production
// functions only; editor, calendar actions, reconciliation and undo stay real.
const file=fs.readFileSync(path.join(__dirname,'series-editor-integration.test.cjs'),'utf8'),end=file.indexOf('\ntest(');assert.ok(end>0);
let fixture=file.slice(0,end);
const replace=(before,after)=>{assert.ok(fixture.includes(before),before);fixture=fixture.replace(before,after);};
replace('const context=vm.createContext({','const context=vm.createContext({setTimeout:()=>0,clearTimeout(){},');
replace('CleanRoomsPlanningRecords:require(',"CleanRoomsInstructions:require('../src/instruction-state.js'),CleanRoomsChecklist:require('../src/checklist-progress.js'),CleanRoomsPlanningRecords:require(");
replace('state,openEditor,openSeriesEditor,','state,moveShift,previewMove,changesForWeek,cancelPlannerDetails,detailStatus:()=>plannerDetailBusy,openEditor,openSeriesEditor,');
const application=Function('require','__dirname',fixture+'\nreturn application;')(require,__dirname);
function rich(label){const note=label+' '+('Instruktioner og adgang. ').repeat(80);return {note,noteRich:Description.encode({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:note}]},{type:'taskList',content:['Materialer','Rengøring','Afslutning'].map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:label+' '+text}]}]}))}]})};}
function compact(value){const result={...clone(value),_instructions:Instructions.metadata(value)};delete result.note;delete result.noteRich;return result;}
function setup(){
 const app=application(),a={id:'lazy-a',person:'p0',date:'2026-11-03',site:0,start:'07:00',end:'15:00',plannedBreakMinutes:0,...rich('A')},b={id:'lazy-b',person:'p1',date:'2026-11-03',site:0,start:'07:00',end:'15:00',plannedBreakMinutes:0,...rich('B')};let progress={};for(const shift of [a,b]){const view=Checklist.read({},shift);progress=Checklist.set(progress,shift,{person:shift.person,key:view.tasks[0].key,signature:view.signature,checked:true}).progress;}
 Object.assign(app.state,{demoSeed:false,series:[],edits:{[a.id]:compact(a),[b.id]:compact(b)},deleted:[],weekPlans:{},page:'schedule',week:1,search:'Behold filter',requests:{},checklistProgress:clone(progress)});const full={...clone(app.state),edits:{[a.id]:a,[b.id]:b},checklistProgress:progress},reads=[];
 const api={isPartial:true,coverageValid:true,covers:()=>true,coversScope:()=>true,window:async()=>{assert.fail('An in-window action must not reload the whole calendar');},ensureFull:async()=>{assert.fail('Point hydration must not expand the company plan');},needsDetails:selection=>(selection.shiftIds||[]).some(id=>Instructions.isDeferred(app.state.edits[id])),details:selection=>new Promise(resolve=>reads.push({selection:clone(selection),resolve})),action:async()=>({ok:true})};app.installWindow(api);
 async function reply(index,{ok=true,message='Changed while loading'}={}){const read=reads[index];assert.ok(read);if(ok){const before=clone(app.state),incoming=clone(before);for(const id of read.selection.shiftIds)if(full.edits[id])incoming.edits[id]=clone(full.edits[id]);incoming.checklistProgress=clone(full.checklistProgress);app.reconcile(incoming,{submitted:before,acknowledged:incoming,detailHydration:true});}read.resolve(ok?{ok:true}:{ok:false,status:409,message});await settle();}
 return {app,full,reads,reply,a,b};
}

test('opening a compact shift awaits its full description without dirtying the plan, then time edits preserve tasks and undo',async()=>{
 const {app,reads,reply,a}=setup(),opening=app.begin(app.state.edits[a.id]);assert.equal(reads.length,1);assert.equal(app.active(),null);assert.equal(app.detailStatus(),true);assert.equal(app.persisted(),0);await reply(0);await opening;assert.equal(app.currentDescription().noteRich,a.noteRich);assert.equal(app.currentDescription().note,a.note);assert.equal(app.persisted(),0);assert.equal(app.getUndo(),null);app.control('#cs-edit-start').value='08:00';app.control('#cs-edit-end').value='16:00';app.save();assert.equal(app.persisted(),1);assert.equal(app.state.edits[a.id].noteRich,a.noteRich);assert.equal(Checklist.read(app.state.checklistProgress,app.state.edits[a.id]).checked,1);app.undo();assert.equal(app.state.edits[a.id].start,'07:00');assert.equal(app.state.edits[a.id].noteRich,a.noteRich);assert.equal(Checklist.read(app.state.checklistProgress,app.state.edits[a.id]).checked,1);
});

test('hydrating and closing an unchanged occurrence does not create pending publication changes against a compact baseline',async()=>{
 const {app,reply,a,b}=setup();app.state.weekPlans['1']={published:true,changes:0,baselineKind:'legacy',baseline:[compact(a),compact(b)]};const before=clone(app.changesForWeek(1));const opening=app.begin(app.state.edits[a.id]);await reply(0);await opening;app.closeEditor();assert.deepEqual(clone(app.changesForWeek(1)),before);assert.equal(app.state.weekPlans['1'].published,true);assert.equal(app.state.weekPlans['1'].changes,0);assert.equal(app.persisted(),0);
});

test('closing or changing page during a delayed point read cannot reopen an editor',async()=>{
 for(const close of [true,false]){const {app,reply,a}=setup(),opening=app.begin(app.state.edits[a.id]);if(close)app.closeEditor();else app.state.page='hours';await reply(0);assert.equal(await opening,false);assert.equal(app.active(),null);assert.equal(app.persisted(),0);assert.equal(app.detailStatus(),false);}
});

test('a slower previous shift lookup cannot replace the newer opened editor',async()=>{
 const {app,reply,a,b}=setup(),first=app.begin(app.state.edits[a.id]),second=app.begin(app.state.edits[b.id]);await reply(1);await second;assert.equal(app.active().id,b.id);assert.equal(app.currentDescription().noteRich,b.noteRich);await reply(0);assert.equal(await first,false);assert.equal(app.active().id,b.id);assert.equal(app.currentDescription().noteRich,b.noteRich);assert.equal(app.persisted(),0);
});

test('a rejected hydration cannot move a shift, and a successful drag keeps its own instructions and completion',async()=>{
 const failed=setup(),moving=failed.app.moveShift(failed.app.state.edits[failed.a.id],'2026-11-04');assert.equal(failed.reads.length,1);assert.equal(failed.app.state.edits[failed.a.id].date,'2026-11-03');assert.equal(failed.app.persisted(),0);await failed.reply(0,{ok:false});assert.equal(await moving,false);assert.equal(failed.app.persisted(),0);assert.equal(failed.app.state.edits[failed.a.id].date,'2026-11-03');
 const {app,reply,a}=setup(),success=app.moveShift(app.state.edits[a.id],'2026-11-04');await reply(0);assert.equal(await success,true);assert.equal(app.state.edits[a.id].date,'2026-11-04');assert.equal(app.state.edits[a.id].noteRich,a.noteRich);assert.equal(Checklist.read(app.state.checklistProgress,app.state.edits[a.id]).checked,1);app.undo();assert.equal(app.state.edits[a.id].date,'2026-11-03');assert.equal(app.state.edits[a.id].noteRich,a.noteRich);
});

test('a time group hydrates all members before editing and preserves each different rich description',async()=>{
 const {app,reads,reply,a,b}=setup(),opening=app.openGroupEditor({date:a.date,start:a.start,end:a.end,shifts:[app.state.edits[a.id],app.state.edits[b.id]]},app.control('#group-trigger'));assert.equal(reads.length,1);assert.equal(app.group(),null);assert.deepEqual(reads[0].selection.shiftIds,[a.id,b.id]);await reply(0);await opening;assert.equal(app.group().members[0].noteRich,a.noteRich);assert.equal(app.group().members[1].noteRich,b.noteRich);app.control('#cs-group-start').value='08:00';app.control('#cs-group-end').value='16:00';app.saveGroup({preventDefault(){}});assert.equal(app.state.edits[a.id].noteRich,a.noteRich);assert.equal(app.state.edits[b.id].noteRich,b.noteRich);assert.equal(app.state.edits[a.id].start,'08:00');assert.equal(app.state.edits[b.id].start,'08:00');assert.equal(app.persisted(),1);
});

test('bulk copies wait for all instructions, retain distinct tasks and start completion at zero on their new identities',async()=>{
 const {app,reads,reply,a,b}=setup();app.openBulk([app.state.edits[a.id],app.state.edits[b.id]],'copy');assert.equal(reads.length,1);assert.equal(app.bulk(),null);await reply(0);assert.ok(app.bulk());app.control('#cs-bulk-date').value='2026-11-10';app.saveBulk({preventDefault(){}});const copies=Object.values(app.state.edits).filter(shift=>![a.id,b.id].includes(shift.id));assert.equal(copies.length,2);for(const source of [a,b]){const copied=copies.find(shift=>shift.person===source.person);assert.equal(copied.noteRich,source.noteRich);assert.equal(Checklist.read(app.state.checklistProgress,copied).total,3);assert.equal(Checklist.read(app.state.checklistProgress,copied).checked,0);assert.equal(Checklist.read(app.state.checklistProgress,app.state.edits[source.id]).checked,1);}assert.equal(app.persisted(),1);app.undo();assert.deepEqual(Object.keys(app.state.edits).sort(),[a.id,b.id].sort());
});
