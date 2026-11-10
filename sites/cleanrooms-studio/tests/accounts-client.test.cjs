const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Description = require('../src/description-model.js');
const Checklist = require('../src/checklist-progress.js');
const source = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary = source.indexOf('  staff.forEach(person => { const option');
assert.ok(boundary > 0,'The account-client harness must find the production setup boundary.');
const plain = value => JSON.parse(JSON.stringify(value));

function application() {
  const controls=new Map(),views=[],actions=[],fullSaves=[],widgetWrites=[];
  const control=selector=>{
    if(!controls.has(selector))controls.set(selector,{value:'',hidden:true,checked:false,disabled:false,dataset:{},children:[],get options(){return this.children;},isConnected:true,
      events:{},addEventListener(type,callback){(this.events[type]??=[]).push(callback);},fire(type){return Promise.all((this.events[type]||[]).map(callback=>callback({target:this,currentTarget:this,preventDefault(){},stopPropagation(){}})));},click(){if(!this.disabled)return this.fire('click');},setAttribute(){},removeAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},focus(){},scrollIntoView(){},reportValidity(){return true;}});
    return controls.get(selector);
  };
  const noteRich=Description.encode({type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Lås døren'}]}]}]}]});
  const shift={id:'server-own-shift',person:'p0',site:2,date:'2026-11-03',start:'07:00',end:'15:00',note:Description.text(noteRich),noteRich};
  let progress={};
  const receipt={ok:true,revision:9,viewer:{userId:'real-employee',name:'Medarbejder',email:'employee@example.com',role:'employee',personId:'p0',preferences:{employeeView:'week',employeeDate:shift.date}},
    capabilities:{plan:false,manageDepartments:false,manageUsers:false,previewEmployees:false},workspace:{id:'shared-workspace'},
    employee:{person:{id:'p0',name:'Jonas Larsen',initials:'JL'},shifts:[shift],sites:[{index:2,id:'site-havn',name:'Eget arbejdssted',address:'Egen adresse',color:'var(--cs-orange)'}],progress,minDate:'2025-10-27',maxDate:'2027-10-31'},
    studio:{role:'admin',employeePerson:'p1',capabilities:{plan:true,manageUsers:true},organization:{sites:[{name:'PRIVATE_SITE_SECRET'}]},edits:{foreign:{id:'foreign',person:'p1',note:'PRIVATE_PLAN_SECRET'}},series:[{id:'private-series'}]}};
  const persistence={load:async()=>plain(receipt),save:async studio=>{fullSaves.push(plain(studio));return true;},retry(){},action:async(action,payload)=>{
    actions.push({action,payload:plain(payload)});
    if(action==='checklist') {
      const result=Checklist.set(progress,shift,{...payload,person:'p0'});
      assert.equal(result.ok,true);progress=result.progress;
      return {ok:true,revision:10,progress:plain(progress),receipt:{shiftId:shift.id,key:payload.key,checked:payload.checked}};
    }
    return {ok:true,preferences:payload.preferences};
  }};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00Z']));}static now(){return Date.parse('2026-10-30T12:00:00Z');}}
  const root={querySelector:control,querySelectorAll:()=>[]};
  const context=vm.createContext({Date:FixedDate,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{openai:{setWidgetState:value=>{widgetWrites.push(plain(value));return Promise.resolve();}}},
    document:{getElementById:()=>root,createElement:()=>control('created-'+controls.size),createTextNode:value=>({textContent:String(value)})},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:Description,CleanRoomsChecklist:Checklist,
    CleanRoomsDepartments:require('../src/department-model.js'),CleanRoomsData:require('../src/studio-data.js'),
    CleanRoomsEmployeeCalendar:require('../src/employee-calendar.js'),CleanRoomsEmployee:{render:(host,options)=>views.push(options)},
    CleanRoomsRichEditor:{mount:()=>({setContent(){},getData:()=>({note:'',noteRich:''})})},
    CleanRoomsPersistence:{create:()=>persistence}
  });
  vm.runInContext(source.slice(0,boundary)+`
    render=()=>{if(state.role==='employee')renderEmployee();};
    closeDemoSheets=()=>{};
    persistence=globalThis.CleanRoomsPersistence.create();
    globalThis.accountClientTest={state,initializeCloud,renderEmployee,setRole,save,toggleEmployeeTask,checklistView};
  })();`,context,{filename:'app.js (account client integration)'});
  return {...context.accountClientTest,actions,fullSaves,widgetWrites,views,shift,receipt,last:()=>views.at(-1)};
}

test('trusted employee initialization clears prior planner state and ignores a forged admin snapshot',async()=>{
  const app=application();app.state.edits={old:{id:'old',note:'OLD_PRIVATE_SECRET'}};app.state.weekPlans={private:{}};
  await app.initializeCloud();
  assert.equal(app.state.role,'employee');assert.equal(app.state.employeePerson,'p0');assert.equal(app.state.organization,null);
  for(const key of ['edits','weekPlans','requests','checklistProgress'])assert.deepEqual(plain(app.state[key]),{});
  for(const key of ['series','deleted','coverageRules'])assert.deepEqual(plain(app.state[key]),[]);
  assert.equal(app.state.employeeView,'week');assert.equal(app.state.employeeDate,app.shift.date);
  assert.deepEqual(plain(app.last().shifts),[app.shift]);
  for(const secret of ['PRIVATE_PLAN_SECRET','PRIVATE_SITE_SECRET','OLD_PRIVATE_SECRET','private-series'])assert.equal(JSON.stringify(app.last()).includes(secret),false);
  assert.equal(app.fullSaves.length,0);assert.equal(app.widgetWrites.length,0);
  app.setRole('admin');assert.equal(app.state.role,'employee');assert.equal(app.actions.length,0);
});

test('employee date and view callbacks save only personal preferences through the account API',async()=>{
  const app=application();await app.initializeCloud();
  assert.equal(app.last().onDateChange('2027-01-01',{view:'day'}),true);
  assert.equal(app.last().onViewChange('month'),true);await Promise.resolve();
  assert.equal(app.actions.length,2);assert.ok(app.actions.every(call=>call.action==='preferences'));
  const preferences=app.actions.at(-1).payload.preferences;
  assert.equal(preferences.employeeDate,'2027-01-01');assert.equal(preferences.employeeView,'month');assert.equal(preferences.employeePerson,'p0');
  assert.equal(Object.hasOwn(preferences,'edits'),false);assert.equal(Object.hasOwn(preferences,'organization'),false);
  assert.equal(app.fullSaves.length,0);assert.equal(app.widgetWrites.length,0);
});

test('employee checklist callback sends the actual own occurrence and applies only acknowledged progress',async()=>{
  const app=application();await app.initializeCloud();
  const before=app.shift.noteRich,view=app.last().progressFor(app.shift),task=view.tasks[0];
  assert.equal(await app.last().onToggleTask('foreign',task.key,true,view.signature),false);
  assert.equal(await app.last().onToggleTask(app.shift.id,task.key,true,'forged-signature'),false);assert.equal(app.actions.length,0);
  assert.equal(await app.last().onToggleTask(app.shift.id,task.key,true,view.signature),true);
  assert.deepEqual(app.actions,[{action:'checklist',payload:{shiftId:app.shift.id,key:task.key,checked:true,signature:view.signature}}]);
  assert.equal(app.last().progressFor(app.shift).checked,1);assert.equal(app.last().saveStatus.state,'saved');
  assert.equal(app.shift.noteRich,before);assert.deepEqual(plain(app.state.checklistProgress),{});
  assert.equal(app.fullSaves.length,0);assert.equal(app.widgetWrites.length,0);
});


test('roles-only accounts use the account page without a plan or staff identity',async()=>{
  const app=application();app.receipt.viewer={userId:'role-manager',name:'Rolleansvarlig',role:'employee',roleName:'Rolleansvarlig',personId:null,preferences:{}};
  app.receipt.capabilities={plan:false,manageRoles:true,manageUsers:false,manageDepartments:false,previewEmployees:false};app.receipt.employee=null;
  await app.initializeCloud();assert.equal(app.state.page,'accounts');assert.equal(app.state.role,'admin');assert.equal(app.state.organization,null);assert.deepEqual(plain(app.state.edits),{});assert.equal(app.views.length,0);
  await app.save();assert.equal(app.fullSaves.length,0);assert.deepEqual(app.actions,[{action:'preferences',payload:{preferences:{page:'accounts'}}}]);
  app.setRole('employee');assert.equal(app.state.page,'accounts');assert.equal(app.state.role,'admin');
});

test('custom role names never turn a no-plan role into a planning account',async()=>{
  const app=application();app.receipt.viewer.role='admin';app.receipt.viewer.roleName='Administrator';app.receipt.viewer.permissions=['plan'];
  app.receipt.capabilities={plan:false,manageRoles:false,manageUsers:false,manageDepartments:false,previewEmployees:false};
  await app.initializeCloud();assert.equal(app.state.role,'employee');assert.deepEqual(plain(app.last().shifts),[app.shift]);await app.save();assert.equal(app.fullSaves.length,0);
});

// A small DOM that never parses HTML; account form state and actual event payloads
// are the subject of this test, while browser layout is covered separately.
function accountsViewDOM() {
  const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
  const dataKey=value=>value.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  class Element {
    constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.attributes={};this.dataset={};this.className='';this._text='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.events={};this.style={};this.classList={add:(...names)=>{this.className+=' '+names.join(' ');}};}
    set innerHTML(value){throw Error('HTML parsing is forbidden: '+value);}
    set textContent(value){this._text=String(value);this.replaceChildren();}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    get isConnected(){return this===this.ownerDocument.body||Boolean(this.parentElement?.isConnected);}
    append(...children){for(let child of children){if(typeof child==='string')child=this.ownerDocument.createTextNode(child);child.parentElement=this;this.children.push(child);}}
    prepend(...children){for(const child of children.reverse()){child.parentElement=this;this.children.unshift(child);}}
    replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];if(children.length)this._text='';this.append(...children);}
    setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);if(key.startsWith('data-'))this.dataset[dataKey(key.slice(5))]=String(value);}
    getAttribute(key){if(key==='id')return this.id??null;if(key.startsWith('data-'))return this.dataset[dataKey(key.slice(5))]??null;return this.attributes[key]??null;}
    addEventListener(name,callback){(this.events[name]??=[]).push(callback);}
    fire(name){const event={target:this,currentTarget:this,preventDefault(){},stopPropagation(){}};for(const callback of this.events[name]||[])callback(event);}
    click(){if(this.disabled)return;this.focus();this.fire('click');}
    focus(){if(!this.disabled)this.ownerDocument.activeElement=this;}
    scrollIntoView(){}
    contains(item){return item===this||descendants(this).includes(item);}
    matches(selector){const attrs=[...selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)],plain=selector.replace(/\[[^\]]+\]/g,''),tag=plain.match(/^[a-z]+/i)?.[0],identifier=plain.match(/#([\w-]+)/)?.[1],classes=[...plain.matchAll(/\.([\w-]+)/g)].map(match=>match[1]);return (!tag||this.tagName===tag.toUpperCase())&&(!identifier||this.id===identifier)&&classes.every(name=>this.className.split(/\s+/).includes(name))&&attrs.every(([,key,value])=>{const actual=this.getAttribute(key)??this[key];return value===undefined?actual!==undefined&&actual!==null:String(actual)===value;});}
    querySelectorAll(selector){return descendants(this).filter(child=>selector.split(',').some(part=>child.matches(part.trim())));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  }
  const doc={activeElement:null,defaultView:{}};doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_,tag)=>new Element(tag,doc);doc.createTextNode=value=>{const item=new Element('#text',doc);item.textContent=value;return item;};doc.body=doc.createElement('body');const element=doc.createElement('main');doc.body.append(element);return element;
}

test('no-plan user managers can edit existing bindings but cannot invite an employee',async()=>{
  const element=accountsViewDOM(),calls=[],manager={userId:'manager',permissions:['users.manage']};
  const employeeRole={id:'employee',name:'Medarbejder',permissions:[],version:1,isSystem:true};
  const model={roles:[employeeRole],permissionCatalog:require('../src/role-model.js').catalog(),staff:[{id:'p-live',name:'Jonas',initials:'JL',active:true},{id:'p-archived',name:'Lea',initials:'LH',active:false}],members:[{userId:'member',name:'Lea konto',email:'lea@example.com',roleId:'employee',personId:'p-archived',status:'active',version:4,isOwner:false}],invites:[]};
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);
  const controller=context.CleanRoomsAccountsView.mount({element,staff:[],onAction:async(action,payload)=>{calls.push({action,payload:plain(payload)});if(action==='list')return {ok:true,...plain(model)};return {ok:true};}});
  const settle=()=>new Promise(resolve=>setImmediate(resolve)),find=selector=>element.querySelector(selector);
  controller.render({viewer:manager,capabilities:{manageUsers:true,plan:false}});await settle();
  const inviteName=find('#cs-account-invite-name'),inviteEmail=find('#cs-account-invite-email'),inviteSend=find('#cs-account-invite-send');
  assert.equal(find('#cs-account-invite-person'),null);assert.equal(inviteSend.disabled,true);
  assert.match(find('#cs-account-invite-help').textContent,/adgang til planlægning/);
  inviteName.value='Ny konto';inviteEmail.value='new@example.com';
  model.staff.push({id:'p-imported',name:'Importeret medarbejder',initials:'IM',active:true});await controller.open();
  assert.equal(inviteName.value,'Ny konto');assert.equal(inviteEmail.value,'new@example.com');
  find('[data-user-id="member"]').querySelector('button').click();const editPerson=find('#cs-account-edit-person');
  assert.ok(editPerson.querySelector('option[value="p-imported"]'),'Editing can use the server roster even when mount staff is empty.');
  assert.equal(editPerson.value,'p-archived');assert.equal(editPerson.querySelector('option[value="p-archived"]').disabled,false);assert.match(editPerson.querySelector('option[value="p-archived"]').textContent,/arkiveret/);
  find('#cs-account-edit-name').value='Lea opdateret';model.staff[1].name='Lea nyt navn';await controller.open();
  assert.equal(find('#cs-account-edit-name').value,'Lea opdateret');assert.equal(editPerson.value,'p-archived');assert.match(editPerson.querySelector('option[value="p-archived"]').textContent,/Lea nyt navn/);
  find('#cs-account-edit-save').click();await settle();const update=calls.find(call=>call.action==='updateMember');assert.equal(update.payload.personId,'p-archived');assert.equal(update.payload.version,4);
  inviteSend.click();await settle();assert.equal(calls.filter(call=>call.action==='invite').length,0);
  controller.render({viewer:{userId:'roles-only',permissions:['roles.manage']},capabilities:{manageRoles:true}});await settle();assert.equal(editPerson.querySelector('option[value="p-imported"]'),null,'Roster data must be cleared when user-management capability is absent.');controller.destroy();
});

test('employee creation includes app access and profile navigation while administrative roles still use web invitations',async()=>{
  const element=accountsViewDOM(),context=vm.createContext({}),calls=[],opened=[];
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);
  const staff=[{id:'p-live',name:'Eksisterende kollega',active:true}];
  const sites=[{index:0,id:'site-first',name:'Ringsted'},{index:3,id:'site-second',name:'Nykøbing'}];
  const roles=[{id:'employee',name:'Medarbejder',permissions:[]},{id:'planner',name:'Planlægger',permissions:['plan']}];
  const appLogins=[];
  const controller=context.CleanRoomsAccountsView.mount({element,onOpenEmployee:personId=>opened.push(personId),onAction:async(action,payload)=>{
    calls.push({action,payload:plain(payload)});
    if(action==='list')return {ok:true,staff,sites,roles,appLogins};
    if(action==='createEmployeeUser'){
      const createdEmployee={id:'p-new',name:payload.name,active:true},account={personId:'p-new',email:payload.email,status:'active',version:1};
      staff.push(createdEmployee);appLogins.push(account);return {ok:true,createdEmployee,account};
    }
    return {ok:true,invite:{id:'invite-new'},inviteUrl:'https://example.com/join?token=synthetic'};
  }});
  const settle=()=>new Promise(resolve=>setImmediate(resolve)),find=selector=>element.querySelector(selector);
  controller.render({viewer:{userId:'admin',permissions:['plan','users.manage']},capabilities:{plan:true,manageUsers:true,manageAppLogins:true}});await settle();
  const site=find('#cs-account-invite-worksite'),name=find('#cs-account-invite-name'),email=find('#cs-account-invite-email'),send=find('#cs-account-invite-send');
  assert.equal(find('#cs-account-invite-person'),null);assert.equal(site.parentElement.hidden,false);assert.equal(site.value,'');
  name.value='  Anna Andersen  ';email.value='anna@example.com';send.click();await settle();
  assert.equal(calls.filter(call=>call.action==='createEmployeeUser').length,0);assert.match(find('#cs-account-invite-error').textContent,/Vælg et arbejdssted/);assert.equal(element.ownerDocument.activeElement,site);
  site.value='0';await controller.open();assert.equal(site.value,'0');
  send.click();await settle();
  assert.deepEqual(calls.find(call=>call.action==='createEmployeeUser').payload,{name:'Anna Andersen',roleId:'employee',site:0,email:'anna@example.com'});
  assert.equal(calls.filter(call=>call.action==='invite').length,0);
  assert.match(find('#cs-account-status').textContent,/Medarbejderen og app-login er oprettet/);
  assert.equal(find('#cs-account-invite-result').hidden,true);
  assert.match(find('[data-app-user-id="p-new"]').textContent,/anna@example.com/);
  find('#cs-account-open-employee-profile').click();assert.deepEqual(opened,['p-new']);
  assert.equal(name.value,'');assert.equal(site.value,'');
  const role=find('#cs-account-invite-role');role.value='planner';role.fire('change');
  assert.equal(site.required,false);assert.equal(site.parentElement.hidden,true);assert.equal(site.disabled,true);
  name.value='Kun planlægger';email.value='planner@example.com';send.click();await settle();
  assert.deepEqual(calls.filter(call=>call.action==='invite').at(-1).payload,{name:'Kun planlægger',roleId:'planner',newUser:true,email:'planner@example.com',accessScope:{mode:'all',departmentIds:[]}});
  assert.equal(find('#cs-account-employee-result').hidden,true);
  assert.equal(find('#cs-account-invite-link').value,'https://example.com/join?token=synthetic');
  controller.destroy();
});

test('account guidance lives in an accessible help dialog with focus return, Escape and permission cleanup',async()=>{
  const element=accountsViewDOM(),context=vm.createContext({}),calls=[];vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);
  const controller=context.CleanRoomsAccountsView.mount({element,onAction:async(action)=>{calls.push(action);return {ok:true,roles:[],permissionCatalog:[],staff:[],members:[],invites:[]};}});
  controller.render({viewer:{userId:'admin',permissions:['users.manage','roles.manage']},capabilities:{manageUsers:true,manageRoles:true}});await new Promise(resolve=>setImmediate(resolve));
  const help=element.querySelector('#cs-account-help-open'),dialog=element.querySelector('#cs-account-help-dialog'),close=element.querySelector('#cs-account-help-close');
  assert.equal(dialog.hidden,true);assert.equal(element.querySelector('.cs-accounts-guide'),null);assert.equal(dialog.getAttribute('aria-modal'),'true');assert.equal(help.getAttribute('aria-haspopup'),'dialog');
  help.click();assert.equal(dialog.hidden,false);assert.equal(element.ownerDocument.activeElement,close);assert.match(dialog.textContent,/Dine rettigheder/);assert.match(dialog.textContent,/Standardroller er låst/);assert.match(dialog.textContent,/Der sendes ikke en e-mail/);
  let prevented=false;for(const handler of dialog.events.keydown)handler({key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(element.ownerDocument.activeElement,close);
  for(const handler of dialog.events.keydown)handler({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(dialog.hidden,true);assert.equal(element.ownerDocument.activeElement,help);assert.deepEqual(calls,['list']);
  help.click();controller.render({viewer:{userId:'admin'},capabilities:{manageUsers:false,manageRoles:false}});assert.equal(element.children.length,0);assert.equal(dialog.hidden,true);
});

test('global help mode removes duplicate account help and exports only current server permission labels',async()=>{
  const element=accountsViewDOM(),context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);
  const controller=context.CleanRoomsAccountsView.mount({element,externalHelp:true,onAction:async()=>({ok:true,roles:[],permissionCatalog:[{key:'users.manage',label:'Konti i virksomheden'}],staff:[],members:[],invites:[]})});
  controller.render({viewer:{userId:'manager',roleName:'Brugeransvarlig',permissions:['users.manage']},capabilities:{manageUsers:true}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element.querySelector('#cs-account-help-open'),null);assert.equal(element.querySelector('#cs-account-help-dialog'),null);assert.deepEqual(plain(controller.helpData()),{roleName:'Brugeransvarlig',permissions:[{key:'users.manage',label:'Konti i virksomheden'}]});
  controller.render({viewer:{userId:'employee'},capabilities:{}});assert.deepEqual(plain(controller.helpData()),{roleName:'',permissions:[]});
});

test('users list combines app and web access and opens the employee profile for both',async()=>{
  const element=accountsViewDOM(),context=vm.createContext({}),calls=[],opened=[];
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);
  const settle=()=>new Promise(resolve=>setImmediate(resolve)),find=selector=>element.querySelector(selector);
  const staff=[{id:'p-anna',name:'Anna',active:true},{id:'p-mads',name:'Mads',active:true}];
  const viewer={userId:'admin'},capabilities={plan:true,manageUsers:true,manageRoles:true,manageAppLogins:true};
  const members=[{userId:'old-web',personId:'p-anna',email:'ANNA@example.com',name:'Anna',status:'active',version:1,roleId:'employee'}];
  const appLogins=[{personId:'p-anna',email:'anna@example.com',status:'active',version:1},{personId:'p-mads',email:'mads@example.com',status:'revoked',version:2}];
  const roles=[{id:'employee',name:'Medarbejder',permissions:[]}];
  const controller=context.CleanRoomsAccountsView.mount({element,onOpenEmployee:personId=>opened.push(personId),onAction:async action=>{
    calls.push(action);
    return {ok:true,staff,appLogins,members,roles};
  }});
  controller.render({viewer,capabilities});await settle();
  assert.deepEqual(find('#cs-account-tabs').querySelectorAll('[role="tab"]').map(tab=>tab.id),['cs-account-tab-users','cs-account-tab-roles']);
  assert.equal(find('#cs-account-app-form'),null);
  assert.equal(find('#cs-account-app-dialog'),null);
  const webUser=find('[data-user-id="old-web"]'),appUser=find('[data-app-user-id="p-mads"]');
  assert.match(webUser.textContent,/App-login/);
  assert.equal(find('[data-app-user-id="p-anna"]'),null);
  assert.match(appUser.textContent,/Lukket/);
  webUser.querySelector('button[aria-label="Åbn medarbejderprofil for Anna"]').click();
  appUser.querySelector('button[aria-label="Åbn medarbejderprofil for Mads"]').click();
  assert.deepEqual(opened,['p-anna','p-mads']);
  webUser.querySelector('button[aria-label="Rediger Anna"]').click();
  assert.equal(find('#cs-account-edit-panel').hidden,false);
  assert.deepEqual(calls,['list']);
  controller.render({viewer,capabilities:{plan:true,manageUsers:true}});await settle();
  assert.equal(find('[data-app-user-id="p-mads"]'),null);
  controller.destroy();
});


test('web invitation and member editing preserve explicit department scope with required selection',async()=>{
 const element=accountsViewDOM(),context=vm.createContext({}),calls=[];vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);
 const model={roles:[{id:'planner',name:'Planlægger',permissions:['plan']}],departments:[{id:'north',name:'Ringsted'},{id:'south',name:'Nykøbing'}],members:[{userId:'local',name:'Lokal planlægger',email:'local@example.test',roleId:'planner',status:'active',version:3,accessScope:{mode:'departments',departmentIds:['north']}}],invites:[],staff:[]};
 const view=context.CleanRoomsAccountsView.mount({element,onAction:async(action,payload)=>{calls.push({action,payload:plain(payload)});return action==='list'?{ok:true,...model}:{ok:true};}}),settle=()=>new Promise(resolve=>setImmediate(resolve)),find=selector=>element.querySelector(selector);
 view.render({viewer:{userId:'owner',permissions:['plan','users.manage']},capabilities:{plan:true,manageUsers:true}});await settle();
 find('#cs-account-invite-name').value='Ny planlægger';find('#cs-account-invite-email').value='planner@example.test';const mode=find('#cs-account-invite-scope-mode');mode.value='departments';mode.fire('change');find('#cs-account-invite-send').click();await settle();assert.equal(calls.some(call=>call.action==='invite'),false);
 const north=find('[data-department-scope="north"]');north.checked=true;north.fire('change');find('#cs-account-invite-send').click();await settle();assert.deepEqual(calls.find(call=>call.action==='invite').payload.accessScope,{mode:'departments',departmentIds:['north']});
 const member=find('[data-user-id="local"]');assert.match(member.textContent,/Ringsted/);member.querySelector('button').click();assert.equal(find('#cs-account-edit-scope-mode').value,'departments');find('#cs-account-edit-save').click();await settle();const saved=calls.find(call=>call.action==='updateMember');assert.deepEqual(saved.payload.accessScope,{mode:'departments',departmentIds:['north']});assert.equal(saved.payload.version,3);view.destroy();
});

test('a scoped user manager cannot select company-wide web access and scope changes clear former choices',async()=>{
 const element=accountsViewDOM(),context=vm.createContext({}),calls=[];vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/accounts-view.js'),'utf8'),context);let department={id:'north',name:'Ringsted'};
 const view=context.CleanRoomsAccountsView.mount({element,onAction:async(action,payload)=>{calls.push({action,payload:plain(payload)});return {ok:true,roles:[{id:'planner',name:'Planlægger',permissions:['plan']}],departments:[department],staff:[],members:[],invites:[]};}}),settle=()=>new Promise(resolve=>setImmediate(resolve));
 const render=()=>view.render({viewer:{userId:'local',permissions:['plan','users.manage'],accessScope:{mode:'departments',departmentIds:[department.id]}},capabilities:{plan:true,manageUsers:true,scopeRestricted:true,allowedDepartmentIds:[department.id]}});render();await settle();let mode=element.querySelector('#cs-account-invite-scope-mode');assert.equal(mode.value,'departments');assert.equal(mode.children[0].disabled,true);assert.match(element.textContent,/Ringsted/);
 department={id:'south',name:'Nykøbing'};render();await settle();assert.equal(element.querySelector('[data-department-scope="north"]'),null);assert.ok(element.querySelector('[data-department-scope="south"]'));view.destroy();
});
