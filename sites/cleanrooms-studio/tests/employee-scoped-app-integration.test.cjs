const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Data=require('../src/studio-data.js'),Calendar=require('../src/employee-calendar.js'),Description=require('../src/description-model.js'),Checklist=require('../src/checklist-progress.js');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),boundary=source.indexOf('  staff.forEach(person => { const option');
assert.ok(boundary>0,'The scoped employee harness must include the actual app functions before DOM bootstrap.');
const copy=value=>JSON.parse(JSON.stringify(value)),person={...Data.staff[1]},site={index:0,id:'frozen-site',name:'Frozen worksite',address:'Frozen address 7',color:'#123456'},summary={id:'own-visible',person:person.id,site:0,date:'2026-10-29',start:'07:00',end:'15:00',plannedBreakMinutes:30,hasDescription:true,location:site,publicationVersion:4},next={...summary,id:'own-next',date:'2026-12-08'},noteRich=Description.encode({type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Lås døren'}]}]}]}]});
const detail=id=>({ok:true,person,shift:{...(id===next.id?next:summary),id,note:'Instructions fetched on opening',noteRich},site,progress:{},planRevision:8,directoryRevision:3,publicationVersion:4});
function response(payload){return {ok:true,...payload,person,shifts:[{...summary,date:payload.from<=summary.date&&payload.to>=summary.date?summary.date:payload.from}],sites:[site],taskSummaries:{[summary.id]:{checked:1,total:2,complete:false}},nextShift:next,nextCursor:null,planRevision:8,directoryRevision:3,minDate:Data.minDate,maxDate:Data.maxDate};}
const scope=day=>{const range=Calendar.range('month',day);return {personId:'p1',from:range.from,to:range.to};};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function microtasks(){for(let index=0;index<8;index++)await Promise.resolve();}
function application(transport,{preview=false}={}){
 const controls=new Map(),views=[],writes=[],calls=[];let created=0;
 const control=selector=>{if(!controls.has(selector))controls.set(selector,{value:'',hidden:true,checked:false,disabled:false,dataset:{},children:[],isConnected:true,style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},get options(){return this.children;},setAttribute(){},removeAttribute(){},getAttribute(){return null;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(){},focus(){},scrollIntoView(){},reportValidity(){return true;}});return controls.get(selector);};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00Z']));}static now(){return new Date('2026-10-30T12:00:00Z').getTime();}}
 const root={querySelector:control,querySelectorAll:()=>[],dataset:{},style:{setProperty(){}}};
 const context=vm.createContext({Date:FixedDate,Intl,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,Promise,TextEncoder,TextDecoder,btoa,atob,console,
   CleanRoomsData:{...Data,anchor:'2026-10-26',today:'2026-10-30'},CleanRoomsRoster:require('../src/roster-model.js'),CleanRoomsPublication:{...require('../src/publication-model.js')},CleanRoomsSeries:{...require('../src/series-engine.js')},CleanRoomsActions:require('../src/schedule-actions.js'),CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:Description,CleanRoomsChecklist:Checklist,CleanRoomsEmployeeCalendar:Calendar,
   CleanRoomsEmployee:{render:(host,options)=>views.push(options)},CleanRoomsRichEditor:{mount:()=>({setContent(){},getData:()=>({note:'',noteRich:''})})},
   document:{getElementById:()=>root,createElement:()=>control('created-'+(++created)),createTextNode:text=>({textContent:String(text)})},window:{openai:{}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/employee-persistence.js'),'utf8'),context,{filename:'employee-persistence.js'});
 context.testTransport={action:async(action,payload)=>{calls.push({action,payload:copy(payload)});return transport(action,payload);},save:async value=>{writes.push(value);return true;}};
 context.testPreview=preview;
 vm.runInContext(source.slice(0,boundary)+`
   // Keep actual employee load/open/navigation/adoption functions. The independent
   // workflow and attendance loaders have their own integration suites.
   loadWorkflow=()=>Promise.resolve();loadTimekeeping=()=>Promise.resolve();
   render=()=>{if(state.role==='employee')renderEmployee();};closeDemoSheets=()=>{};
   persistence=globalThis.testTransport;cloudLoaded=true;cloudCapabilities={plan:globalThis.testPreview,manageUsers:false};
   sessionViewer={userId:globalThis.testPreview?'planner':'worker',personId:globalThis.testPreview?null:'p1',preferences:{}};
   Object.assign(state,{role:'employee',employeePerson:'p1',employeeDate:'2026-10-29',employeeWeek:'2026-10-26',employeeView:'month'});
   employeeData={person:personFor('p1'),shifts:[],sites:[],taskSummaries:{},progress:{},leaveRequests:[]};
   employeeReader=CleanRoomsEmployeePersistence.create({transport:{action:accountAction},onChange:adoptEmployeeRead});
   globalThis.scopedAppTest={state,renderEmployee,loadEmployeeRead,openEmployeeShift,changeEmployeeDate,changeEmployeeView,checklistView,
     get reader(){return employeeReader;},get data(){return employeeData;},get detail(){return employeeDetailData;},get detailLoading(){return employeeDetailLoading;},
     switchPerson:id=>{state.employeePerson=id;state.employeeShift=null;employeeDetailEpoch++;employeeReader.cancelDetail();employeeDetailData=null;employeeDetailLoading=false;render();}
   };
 })();`,context,{filename:'app.js (actual scoped employee integration)'});
 const app=context.scopedAppTest;
 function protectCompany(){for(const key of ['series','publications'])Object.defineProperty(app.state,key,{configurable:true,enumerable:true,get(){throw new Error('Unexpected company '+key+' read');}});for(const key of ['shiftsInRange','shiftById','seededShifts'])context.CleanRoomsData[key]=()=>{throw new Error('Unexpected plan expansion: '+key);};context.CleanRoomsPublication.publishedShifts=()=>{throw new Error('Unexpected full publication expansion');};context.CleanRoomsSeries.enumerate=()=>{throw new Error('Unexpected annual recurrence generation');};}
 return {...app,state:app.state,views,writes,calls,control,context,protectCompany,last:()=>views.at(-1),current:()=>({data:app.data,detail:app.detail,detailLoading:app.detailLoading}),load:force=>app.loadEmployeeRead(force)};
}

test('actual planner preview renders a bounded personal month through EmployeePersistence without any company plan expansion',async()=>{
 const app=application(async(action,payload)=>action==='employeeRead'?response(payload):{ok:true},{preview:true});app.protectCompany();app.renderEmployee();const loaded=await app.load();assert.equal(loaded.ok,true);await microtasks();const read=app.calls.filter(call=>call.action==='employeeRead');assert.equal(read.length,1);assert.deepEqual(read[0].payload,scope('2026-10-29'));assert.ok((Date.parse(read[0].payload.to)-Date.parse(read[0].payload.from))/86400000<56);assert.equal(app.calls.some(call=>call.action==='employeeShift'),false);const options=app.last();assert.equal(options.preview,true);assert.equal(options.person.id,'p1');assert.equal(options.shifts.find(shift=>shift.id===summary.id).note,undefined);assert.equal(options.shifts.filter(shift=>shift.id===next.id).length,1);assert.deepEqual(copy(options.progressFor(summary)),{checked:1,total:2,complete:false,tasks:[],signature:''});assert.equal(app.writes.length,0);
});

test('actual employee detail callback fetches only the opened occurrence and keeps instruction text out of initial rendering',async()=>{
 const app=application(async(action,payload)=>action==='employeeRead'?response(payload):action==='employeeShift'?detail(payload.shiftId):{ok:true});app.protectCompany();app.renderEmployee();await app.load();assert.equal(app.current().detail,null);assert.equal(app.last().shifts.find(shift=>shift.id===summary.id).note,undefined);assert.equal(await app.last().onOpenShift(summary.id),true);assert.deepEqual(app.calls.filter(call=>call.action==='employeeShift').map(call=>call.payload),[{personId:'p1',shiftId:summary.id}]);assert.equal(app.calls.filter(call=>call.action==='employeeRead').length,1);assert.equal(app.last().selectedShiftId,summary.id);assert.equal(app.last().shifts.find(shift=>shift.id===summary.id).note,'Instructions fetched on opening');assert.equal(app.last().progressFor(app.current().detail.shift).total,1);assert.equal(typeof app.last().onToggleTask,'function');assert.equal(app.writes.length,0,'Employee navigation persists only preferences, never a company snapshot.');assert.ok(app.calls.some(call=>call.action==='preferences'));
});

test('closing the actual employee detail during its delayed response cannot reopen the sheet or retain its instruction payload',async()=>{
 const pending=deferred(),app=application(async(action,payload)=>action==='employeeRead'?response(payload):action==='employeeShift'?pending.promise:{ok:true});app.protectCompany();app.renderEmployee();await app.load();const opening=app.last().onOpenShift(summary.id);await microtasks();assert.equal(app.calls.filter(call=>call.action==='employeeShift').length,1);assert.equal(app.current().detailLoading,true);assert.equal(await app.last().onOpenShift(null),true);pending.resolve(detail(summary.id));assert.equal(await opening,false);await microtasks();assert.equal(app.state.employeeShift,null);assert.equal(app.last().selectedShiftId,null);assert.equal(app.current().detail,null);assert.equal(app.current().detailLoading,false);assert.equal(app.last().shifts.find(shift=>shift.id===summary.id).note,undefined);assert.equal(app.calls.filter(call=>call.action==='employeeRead').length,1);
});

test('actual month navigation cancels an old detail and loads one replacement period without reviving the previous selection',async()=>{
 const pending=deferred(),app=application(async(action,payload)=>action==='employeeRead'?response(payload):action==='employeeShift'?pending.promise:{ok:true});app.protectCompany();app.renderEmployee();await app.load();const opening=app.last().onOpenShift(summary.id);await microtasks();assert.equal(app.last().onDateChange('2026-11-15',{view:'month'}),true);await app.load();pending.resolve(detail(summary.id));assert.equal(await opening,false);await microtasks();assert.equal(app.state.employeeDate,'2026-11-15');assert.equal(app.state.employeeShift,null);assert.equal(app.current().detail,null);assert.equal(app.last().focusDate,'2026-11-15');assert.deepEqual(app.calls.filter(call=>call.action==='employeeRead').map(call=>call.payload),[scope('2026-10-29'),scope('2026-11-15')]);assert.equal(app.calls.filter(call=>call.action==='employeeShift').length,1);
});
