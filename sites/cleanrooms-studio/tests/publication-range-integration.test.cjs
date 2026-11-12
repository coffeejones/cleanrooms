const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Range=require('../src/publication-range.js'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),boundary=source.indexOf('  staff.forEach(person => { const option');assert.ok(boundary>0);
const plain=value=>JSON.parse(JSON.stringify(value)),walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.dataset={};this.listeners={};this.className='';this.text='';this.value='';this.disabled=false;this.hidden=true;this.checked=false;this.isConnected=true;}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}fire(type){for(const handler of this.listeners[type]||[])handler({target:this,currentTarget:this});}
 click(){if(!this.disabled)this.fire('click');}focus(){this.ownerDocument.activeElement=this;}scrollIntoView(){}reportValidity(){return true;}
 matches(selector){if(selector[0]==='.')return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-publication-review-focus]')return !!this.dataset.publicationReviewFocus;return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}contains(node){return walk(this).includes(node);}
}
function application({secondWeekConflict=false,cold=false,budget=false}={}){
 const controls=new Map(),publications=[],notices=[],reloads=[],doc={createElement:tag=>new Element(tag,doc),createTextNode:text=>{const el=new Element('text',doc);el.textContent=text;return el;}};
 const control=selector=>{if(!controls.has(selector))controls.set(selector,new Element('div',doc));return controls.get(selector);};
 const root={querySelector:control,querySelectorAll:()=>[],dataset:{}};doc.getElementById=()=>root;
 const loads=[],budgetLoads=[],budgetPaints=[];
 let loadedScope=null;
 const persistence={publish:async(studio,scope)=>{publications.push({studio:plain(studio),scope:plain(scope)});return{ok:true};}};
 if(cold)Object.assign(persistence,{isPartial:true,window(){},ensureFull(){},coversScope:scope=>JSON.stringify(scope)===loadedScope,scope:scope=>new Promise(resolve=>loads.push({scope,finish(ok=true){if(ok)loadedScope=JSON.stringify(scope);resolve({ok});}}))});
 if(budget)Object.assign(persistence,{revision:1,action:(name,scope)=>new Promise(resolve=>budgetLoads.push({name,scope:plain(scope),resolve}))});
 const globals={CleanRoomsPublicationBudget:budget?{render:(_,next)=>budgetPaints.push(next)}:undefined,Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,Intl,window:{},document:doc,CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-11-02',today:'2026-11-02'},CleanRoomsPublication:Publication,CleanRoomsPublicationRange:Range,CleanRoomsPublicationReview:require('../src/publication-review-view.js'),CleanRoomsDepartments:Departments,CleanRoomsRoster:require('../src/roster-model.js'),CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:require('../src/description-model.js'),CleanRoomsChecklist:require('../src/checklist-progress.js'),CleanRoomsRichEditor:{mount:()=>({setContent(){},getData:()=>({note:'',noteRich:''})})},publicationStub:persistence,notices,reloads};
 const context=vm.createContext(globals);
 vm.runInContext(source.slice(0,boundary)+`
   render=()=>{};closeOperationsSheets=()=>{};closeEditor=()=>{};closeGroupEditor=()=>{};closeBulkEditor=()=>{};closeReview=()=>{};clearSelection=()=>{};notify=value=>notices.push(value);initializeCloud=async()=>reloads.push(true);
   persistence=publicationStub;cloudLoaded=true;cloudCapabilities={plan:true};
   globalThis.rangeIntegration={state,openChanges,closeChanges,renderChanges,publicationScope,publicationStatus,publishReviewedWeek,renderCloudStatus,
    setCloudState:value=>{cloudStatus={state:value};renderCloudStatus();}};
 })();`,context,{filename:'app.js (multiweek publication integration)'});
 const app=context.rangeIntegration,one={id:'one',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:''},two={id:'two',person:'p1',site:0,date:'2026-11-10',start:'07:00',end:'15:00',note:''};
 Object.assign(app.state,{demoSeed:false,series:[],edits:{one,two},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}});
 if(budget)app.state.workspaceSettings={workHoursBudget:{period:'week',hours:10}};
 if(secondWeekConflict)app.state.edits.overlap={...two,id:'overlap',start:'08:00',end:'16:00'};
 app.state.publications=Publication.publish(app.state,{from:'2026-11-02',to:'2026-11-08',siteIds:[0,1,2],actor:{userId:'planner',name:'Planlægger'},at:'2026-11-01T12:00:00.000Z'}).studio.publications;
 const rangeField=key=>walk(control('#cs-publication-range-slot')).find(el=>el.dataset.publicationRange===key);
 return {...app,root,control,rangeField,publications,notices,reloads,loads,budgetLoads,budgetPaints,change(name,value){const input=rangeField(name);input.value=value;input.fire('change');}};
}

test('an already published current week still opens a review that can extend into an unpublished week',async()=>{
 const app=application();assert.equal(app.publicationStatus().published,true);app.openChanges();assert.equal(app.control('#cs-changes-layer').hidden,false);assert.equal(app.control('#cs-changes-publish').disabled,true);
 assert.equal(app.control('#cs-changes-period').textContent,'Uge 45');assert.equal(app.control('#cs-publication-options').open,false);
 app.rangeField('preset:2').click();assert.deepEqual(plain(app.publicationScope(true)),{from:'2026-11-02',to:'2026-11-15',siteIds:[0,1,2],includeDependencies:false});assert.equal(app.publicationStatus().published,true,'calendar status remains scoped to the current week');assert.equal(app.control('#cs-changes-publish').disabled,false);assert.equal(app.control('#cs-changes-publish').textContent,'Udgiv 2 uger');
 await app.publishReviewedWeek();assert.equal(app.publications.length,1);assert.equal(app.publications[0].scope.to,'2026-11-15');assert.equal(app.reloads.length,1);assert.equal(app.root.inert,false);
});
test('invalid range drafts block the actual publish action and restoring the previous scope enables review again',async()=>{
 const app=application();app.openChanges();app.rangeField('preset:2').click();app.change('from','2026-12-07');assert.equal(app.control('#cs-changes-publish').disabled,true);await app.publishReviewedWeek();assert.equal(app.publications.length,0);
 assert.match(app.control('#cs-publication-feedback').textContent,/Slutugen skal ligge efter/);
 app.change('from','2026-11-02');assert.equal(app.control('#cs-changes-publish').disabled,false,'correcting an invalid input to the exact prior valid scope must not leave publish disabled');await app.publishReviewedWeek();assert.equal(app.publications.length,1);
});
test('save state updates cannot reopen publication while an invalid period is still being edited',()=>{
 const app=application();app.openChanges();app.rangeField('preset:2').click();app.setCloudState('saving');assert.equal(app.control('#cs-changes-publish').disabled,true);app.setCloudState('saved');assert.equal(app.control('#cs-changes-publish').disabled,false);app.change('to','');app.setCloudState('saved');assert.equal(app.control('#cs-changes-publish').disabled,true);
});
test('a conflict in a later selected week blocks the whole publication before any server write',async()=>{
 const app=application({secondWeekConflict:true});app.openChanges();app.rangeField('preset:2').click();
 assert.equal(app.control('#cs-changes-publish').disabled,true);
 assert.match(app.control('#cs-publication-feedback').textContent,/Ret overlap/);
 const details=app.control('#cs-changes-list').querySelector('details');
 assert.equal(details.open,false);
 assert.ok(details.querySelector('.cs-publication-conflict'),'the review links directly to an affected shift');
 await app.publishReviewedWeek();
 assert.equal(app.publications.length,0);assert.equal(app.control('#cs-changes-layer').hidden,false);
});
test('range controls are immediately available and a delayed review never displays the previous period',async()=>{
 const app=application({cold:true});
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 app.openChanges();
 assert.equal(app.control('#cs-publication-load').hidden,false);
 assert.equal(app.rangeField('preset:4').disabled,false);
 assert.equal(app.control('#cs-changes-publish').disabled,true);
 app.rangeField('preset:4').click();
 assert.equal(app.loads.length,1);
 app.loads[0].finish();
 await settle();
 assert.equal(app.loads.length,2);
 assert.equal(app.loads[1].scope.to,'2026-11-29');
 assert.equal(app.control('#cs-changes-list').children.length,0);
 assert.equal(app.control('#cs-publication-summary').hidden,true);
 app.loads[1].finish();
 await settle();
 assert.equal(app.control('#cs-publication-load').hidden,true);
 assert.equal(app.control('#cs-changes-publish').textContent,'Udgiv 4 uger');
 assert.equal(app.control('#cs-changes-publish').disabled,false);
});

test('budget results from an earlier period never replace the current review',async()=>{
 const app=application({budget:true});
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 app.openChanges();
 app.rangeField('preset:4').click();
 assert.equal(app.control('#cs-changes-publish').disabled,true);
 assert.deepEqual(app.budgetLoads.map(({name,scope})=>[name,scope.to]),[
   ['publicationBudgetRead','2026-11-08'],['publicationBudgetRead','2026-11-29']
 ]);
 app.budgetLoads[1].resolve({ok:true,revision:1,budget:{period:'week',periods:[{plannedMinutes:600}]}});
 await settle();
 assert.equal(app.control('#cs-changes-publish').disabled,false);
 app.budgetLoads[0].resolve({ok:true,revision:1,budget:{period:'week',periods:[{plannedMinutes:999}]}});
 await settle();
 assert.equal(app.budgetPaints.at(-1).budget.periods[0].plannedMinutes,600);
});
