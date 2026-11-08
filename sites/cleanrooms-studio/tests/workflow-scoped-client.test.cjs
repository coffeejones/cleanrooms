const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),boundary=source.indexOf('  staff.forEach(person => { const option');assert.ok(boundary>0);
const copy=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const shift=(id,person='p1')=>({id,person,site:0,date:'2090-01-10',start:'07:00',end:'15:00',siteName:'Frozen worksite',fingerprint:'s1-0000000000000000'});
const bundle=(patch={})=>({revision:8,directoryRevision:3,canManage:false,preview:false,personId:'p1',notifications:[{id:'message-old'}],deliveries:[{id:'delivery-old'}],requests:[{id:'request-old'}],ownShifts:[shift('own-old')],openShifts:[shift('open-old','')],colleagues:[{id:'p2',name:'Known colleague'}],unreadCount:1,pagination:{messages:'messages-next',requests:'requests-next',ownShifts:{nextCursor:'own-next'},openShifts:{nextCursor:'open-next'},colleagues:{nextCursor:'people-next'}},...patch});
function application(read,{preview=false,workspace='exchanges'}={}){
 const controls=new Map(),actions=[],views=[];let created=0;
 const control=selector=>{if(!controls.has(selector))controls.set(selector,{value:'',hidden:true,dataset:{},children:[],isConnected:true,style:{setProperty(){}},get options(){return this.children;},setAttribute(){},removeAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(){},focus(){}});return controls.get(selector);};
 const root={querySelector:control,querySelectorAll:()=>[],dataset:{}};
 const context=vm.createContext({Date,Intl,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,Promise,TextEncoder,TextDecoder,window:{},document:{getElementById:()=>root,createElement:()=>control('created-'+(++created)),createTextNode:value=>({textContent:String(value)})},CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-11-03'},CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:require('../src/description-model.js'),CleanRoomsChecklist:require('../src/checklist-progress.js'),CleanRoomsDepartments:require('../src/department-model.js'),CleanRoomsPublication:require('../src/publication-model.js'),CleanRoomsRoster:require('../src/roster-model.js'),CleanRoomsEmployeeCalendar:require('../src/employee-calendar.js'),CleanRoomsRichEditor:{mount:()=>({setContent(){},getData:()=>({note:'',noteRich:''})})},CleanRoomsShiftWorkflowView:{mount:callbacks=>({render:options=>views.push({...options,callbacks}),dispose(){}})}});
 context.testTransport={action:async(action,payload)=>{actions.push({action,payload:copy(payload)});return read(action,payload);}};context.testPreview=preview;context.testWorkspace=workspace;
 vm.runInContext(source.slice(0,boundary)+`
   persistence=globalThis.testTransport;cloudLoaded=true;cloudCapabilities={plan:globalThis.testPreview};sessionViewer={userId:globalThis.testPreview?'planner':'worker',personId:globalThis.testPreview?null:'p1',preferences:{}};
   state.role='employee';state.employeePerson='p1';employeeWorkspace=globalThis.testWorkspace;render=()=>{};
   globalThis.workflowScopedTest={loadMoreWorkflow,renderWorkflow,loadWorkflow,
     seed:value=>{workflowBundle=value;workflowKey=workflowContext();workflowLoadedKey=workflowKey;workflowLoading=false;workflowError='';},
     inspect:()=>({bundle:workflowBundle,loading:workflowLoading,error:workflowError,context:workflowContext()}),
     switchContext:(person,workspace)=>{clearWorkflow();state.employeePerson=person;sessionViewer={...sessionViewer,personId:globalThis.testPreview?null:person};employeeWorkspace=workspace;}
   };
 })();`,context,{filename:'app.js (scoped workflow pagination integration)'});
 return {...context.workflowScopedTest,actions,views,control};
}

test('actual workflow load-more merges only the requested collection and advances only that cursor',async()=>{
 const names={messages:'messageCursor',requests:'requestCursor',ownShifts:'ownCursor',openShifts:'openCursor',colleagues:'colleagueCursor'};
 for(const kind of Object.keys(names)){
  const old=bundle({preview:true}),page=bundle({ok:true,notifications:[{id:'message-new'}],deliveries:[{id:'delivery-new'}],requests:[{id:'request-new'}],ownShifts:[shift('own-new')],openShifts:[shift('open-new','')],colleagues:[{id:'p3',name:'New colleague'}],pagination:{[kind]:null}}),app=application(async()=>page,{preview:true});app.seed(copy(old));
  assert.equal(await app.loadMoreWorkflow(kind),true);assert.deepEqual(app.actions,[{action:'workflowRead',payload:{personId:'p1',[names[kind]]:typeof old.pagination[kind]==='string'?old.pagination[kind]:old.pagination[kind].nextCursor}}]);
  const actual=copy(app.inspect().bundle),fields=kind==='messages'?['notifications','deliveries']:[kind];for(const field of ['notifications','deliveries','requests','ownShifts','openShifts','colleagues'])assert.deepEqual(actual[field],fields.includes(field)?[...old[field],...page[field]]:old[field],kind+': '+field);assert.equal(actual.pagination[kind],null);for(const other of Object.keys(names).filter(value=>value!==kind))assert.deepEqual(actual.pagination[other],old.pagination[other]);assert.equal(actual.revision,8);assert.equal(actual.directoryRevision,3);assert.equal(app.inspect().loading,false);assert.equal(app.views.at(-1).callbacks.onLoadMore,app.loadMoreWorkflow);
 }
});

test('a changed plan or directory generation discards the cursor page and refreshes before displaying new records',async()=>{
 for(const field of ['revision','directoryRevision']){
  const fresh=bundle({ok:true,[field]:field==='revision'?9:4,requests:[{id:'fresh-first-page'}],pagination:{requests:null}}),page={...fresh,requests:[{id:'unsafe-cursor-page'}]},app=application(async(action,payload)=>payload.requestCursor?page:fresh);app.seed(bundle());const result=await app.loadMoreWorkflow('requests');assert.equal(result.ok,true);assert.deepEqual(app.actions.map(call=>call.payload),[{requestCursor:'requests-next'},{}]);assert.deepEqual(copy(app.inspect().bundle.requests),[{id:'fresh-first-page'}]);assert.equal(JSON.stringify(app.views.map(view=>view.bundle)).includes('unsafe-cursor-page'),false);assert.equal(app.inspect().bundle[field],fresh[field]);assert.equal(app.inspect().loading,false);assert.equal(app.inspect().error,'');
 }
});

test('late pagination responses cannot replace another employee or workspace context',async()=>{
 for(const changed of ['person','workspace']){
  const delayed=deferred(),app=application(()=>delayed.promise,{preview:true});app.seed(bundle({preview:true}));const loading=app.loadMoreWorkflow('ownShifts');const person=changed==='person'?'p2':'p1',workspace=changed==='workspace'?'messages':'exchanges';app.switchContext(person,workspace);app.seed(bundle({personId:person,preview:true,ownShifts:[shift('new-context',person)]}));delayed.resolve(bundle({ok:true,preview:true,ownShifts:[shift('old-private-occurrence')]}));assert.equal(await loading,false);assert.equal(app.inspect().bundle.personId,person);assert.deepEqual(copy(app.inspect().bundle.ownShifts),[shift('new-context',person)]);assert.equal(JSON.stringify(app.inspect().bundle).includes('old-private-occurrence'),false);assert.equal(app.inspect().loading,false);assert.equal(app.inspect().context,'employee:'+person+':'+workspace);
 }
});

const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.listeners={};this.dataset={};this.attributes={};this.className='';this.value='';this.disabled=false;this.text='';this.scrollTop=0;}
 append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.text='';this.append(...nodes);}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}async click(){if(!this.disabled)for(const handler of this.listeners.click||[])await handler({currentTarget:this,target:this,preventDefault(){}});}
 matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):selector==='[data-workflow-focus]'?Boolean(this.dataset.workflowFocus):this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}contains(node){return walk(this).includes(node);}focus(){this.ownerDocument.activeElement=this;}
}
test('actual workflow view exposes only the current list and offer-context pagination buttons',async()=>{
 const View=require('../src/shift-workflow-view.js'),doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),called=[],view=View.mount({element:host,onLoadMore:kind=>called.push(kind)}),key=value=>walk(host).find(node=>node.dataset.workflowFocus===value),data=bundle();
 view.render({mode:'messages',bundle:data});assert.ok(key('more:messages'));assert.equal(key('more:requests'),undefined);await key('more:messages').click();
 view.render({mode:'employee',bundle:data});assert.ok(key('more:openShifts'));assert.equal(key('more:messages'),undefined);await key('more:openShifts').click();await key('offer:new').click();assert.ok(key('more:ownShifts'));assert.ok(key('more:colleagues'));assert.equal(key('more:openShifts'),undefined);await key('more:ownShifts').click();await key('more:colleagues').click();assert.deepEqual(called,['messages','openShifts','ownShifts','colleagues']);
 view.render({mode:'employee',loading:true,bundle:data});assert.equal(walk(host).some(node=>node.dataset.workflowFocus?.startsWith('more:')),false);view.dispose();assert.equal(host.children.length,0);
});
