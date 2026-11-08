const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
function actual(name,next){const from=source.indexOf('  function '+name+'('),to=source.indexOf('  function '+next+'(',from);assert.ok(from>=0&&to>from);return source.slice(from,to);}
test('late workflow renders cannot replace a chat or calendar surface',()=>{
 const state={role:'admin',page:'chat'};let paints=0;
 const context=vm.createContext({state,employeeWorkspace:'chat',q:()=>{paints++;throw Error('Unexpected surface replacement');}});
 vm.runInContext(actual('renderWorkflow','renderEmployee')+';globalThis.paint=renderWorkflow;',context);
 context.paint('manager');assert.equal(paints,0);
 state.role='employee';context.paint('messages');context.paint('employee');assert.equal(paints,0);
 context.employeeWorkspace='calendar';context.paint('employee');assert.equal(paints,0);
});
test('Mine vagter leaves a persisted chat page for linked chat-only managers and employees',()=>{
 const state={role:'admin',page:'chat'},calls=[];
 const context=vm.createContext({state,realEmployee:()=>true,employeeData:{person:{id:'p0'}},hasAccountAccess:()=>false,employeeWorkspace:'chat',workflowSelectedShift:'one',timeDemoEmployee:false,departmentView:null,closeDemoSheets(){},render(){calls.push('render');},save(){calls.push('save');}});
 vm.runInContext(actual('setRole','retryCloud')+';globalThis.switchRole=setRole;',context);
 context.switchRole('employee');assert.equal(state.role,'employee');assert.equal(state.page,'schedule');assert.equal(context.employeeWorkspace,'calendar');assert.deepEqual(calls,['render','save']);
});
test('employee messages and exchanges clear chat page preferences before rendering',()=>{
 const state={role:'admin',page:'chat'},calls=[];
 const context=vm.createContext({state,realEmployee:()=>true,employeeData:{person:{id:'p0'}},employeeWorkspace:'chat',timeDemoEmployee:false,render(){calls.push(state.page);},save(){},loadWorkflow(){}});
 vm.runInContext(actual('openEmployeeWorkspace','openDemoShift')+';globalThis.open=openEmployeeWorkspace;',context);
 context.open('messages');assert.equal(state.page,'schedule');assert.equal(state.role,'employee');assert.equal(context.employeeWorkspace,'messages');assert.deepEqual(calls,['schedule']);
});
test('chat eligibility skips unlinked planners and disallowed employee previews',()=>{
 const state={role:'admin'},sessionViewer={userId:'planner',personId:null},cloudCapabilities={chat:true,manageChat:false};
 const context=vm.createContext({state,sessionViewer,cloudCapabilities,cloudLoaded:true,realEmployee:()=>false});
 vm.runInContext(actual('chatAvailable','chatPreviewPerson')+';globalThis.available=chatAvailable;',context);
 assert.equal(context.available(),false);sessionViewer.personId='p0';assert.equal(context.available(),true);
 state.role='employee';assert.equal(context.available(),false);cloudCapabilities.manageChat=true;assert.equal(context.available(),true);
});
test('expected chat access denial stays local and cannot reinitialize planning data',async()=>{
 let calls=0;const context=vm.createContext({chatPreviewPerson:()=>null,persistence:{action:async()=>{calls++;return {ok:false,status:403,message:'Ingen adgang'};}},accountAction(){throw Error('Chat must not reset the account on expected denial');}});
 const from=source.indexOf('  async function chatAction('),to=source.indexOf('  async function refreshChatBadge(',from);assert.ok(from>=0&&to>from);
 vm.runInContext(source.slice(from,to)+';globalThis.action=chatAction;',context);
 const result=await context.action('chatList');assert.equal(result.status,403);assert.equal(calls,1);
});

test('read-only employee preview can sync its selected department but cannot mark or send on behalf of staff',async()=>{
 const calls=[],context=vm.createContext({chatPreviewPerson:()=> 'p0',persistence:{action:async(action,payload)=>{calls.push({action,payload});return {ok:true};}}});
 const from=source.indexOf('  async function chatAction('),to=source.indexOf('  async function refreshChatBadge(',from);vm.runInContext(source.slice(from,to)+';globalThis.action=chatAction;',context);
 assert.equal((await context.action('chatSync',{roomId:'room',afterSeq:7,version:3})).ok,true);assert.equal(calls[0].payload.previewPersonId,'p0');assert.equal(calls[0].payload.afterSeq,7);
 assert.equal((await context.action('chatReadMark',{roomId:'room',throughSeq:8})).status,403);assert.equal((await context.action('chatSend',{roomId:'room',text:'Forbidden'})).status,403);assert.equal(calls.length,1);
});
