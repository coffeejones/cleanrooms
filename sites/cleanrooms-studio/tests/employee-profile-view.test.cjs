const test=require('node:test');
const assert=require('node:assert/strict');
const View=require('../src/employee-profile-view.js');
const Calendar=require('../src/employee-profile-calendar.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.style={};this.handlers={};this.className='';this.text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.scrollTop=0;}
  set innerHTML(value){throw Error('Profile content must remain literal text.');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.text='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  fire(type,extra={}){return Promise.all((this.handlers[type]||[]).map(handler=>handler({target:this,currentTarget:this,preventDefault(){},...extra})));}
  click(){if(!this.disabled){this.focus();return this.fire('click');}}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>part.startsWith('.')?node.className.split(' ').includes(part.slice(1)):node.tagName===part.toUpperCase()));}
  contains(node){return walk(this).includes(node);}
  focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
}
const person={id:'p0',name:'Jonas Larsen',initials:'JL',role:'Servicemedarbejder',site:0,target:35,active:true};
const sites=[{name:'Kontor Nord',address:'Nordvej 12'},{name:'Klinikken',address:'Park Allé 8'}];
const shift=(id,date,patch={})=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'',...patch});
function app({shifts=[shift('a','2026-10-31')],callbacks={},canEdit=true}={}){
  const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc),controller=View.mount({element:host,...callbacks});
  const render=(patch={})=>controller.render({person,sites,canEdit,canViewPayroll:true,today:'2026-10-31',month:'2026-10',calendar:Calendar.build({person,month:'2026-10',today:'2026-10-31',shifts}),...patch});render();
  const nodes=()=>walk(host),byClass=name=>nodes().find(item=>item.className.split(' ').includes(name)),key=value=>nodes().find(item=>item.dataset.profileFocus===value),field=value=>nodes().find(item=>item.id?.endsWith('-'+value));
  return {host,doc,controller,render,nodes,byClass,key,field,shifts};
}

test('calendar shows actual person-specific monthly totals, compact cards and a selected-day agenda beside facts',()=>{
  const fixture=app({shifts:[shift('a','2026-10-31'),shift('b','2026-10-31',{site:1,start:'16:00',end:'18:00'}),shift('other','2026-10-31',{person:'p1'}),shift('outside','2026-11-01')]});
  assert.deepEqual(fixture.byClass('cs-employee-profile-month-summary').children.map(item=>item.children.map(child=>child.textContent)),[['Planlagte timer','10 t'],['Vagter','2'],['Arbejdsdage','1']]);assert.equal(fixture.byClass('cs-employee-profile-aside').children[0].className.includes('agenda'),true);
  const events=fixture.nodes().filter(item=>item.className==='cs-employee-profile-calendar-shift');assert.equal(events.length,3);assert.equal(events[0].text,'');assert.equal(events[0].children.length,2);assert.equal(events[0].getAttribute('aria-label'),'07:00–15:00 · Kontor Nord');
  assert.equal(fixture.nodes().filter(item=>item.className==='cs-employee-profile-agenda-shift').length,2);assert.equal(fixture.byClass('cs-employee-profile-facts').textContent.includes('Initialer'),false);assert.equal(fixture.doc.activeElement.className,'cs-employee-profile-name');
});

test('the employee profile calendar and agenda consistently show net planned work and its unpaid break',()=>{
  const fixture=app({shifts:[shift('pause','2026-10-31',{plannedBreakMinutes:30})]});
  assert.match(fixture.byClass('cs-employee-profile-month-summary').textContent,/7,5 t/);
  assert.match(fixture.byClass('cs-employee-profile-agenda-duration').textContent,/7,5 t arbejdstid/);
  assert.match(fixture.byClass('cs-employee-profile-agenda-shift').textContent,/30 min ulønnet pause/);
});

test('month navigation emits YYYY-MM and Today also selects today inside the existing month',async()=>{
  const calls=[];let fixture;fixture=app({callbacks:{onMonthChange:month=>{calls.push(month);fixture.render({month,calendar:Calendar.build({person,month,today:'2026-10-31',shifts:fixture.shifts})});}}});
  await fixture.key('day:2026-10-29').click();assert.ok(fixture.byClass('cs-employee-profile-agenda-head').textContent.includes('29. oktober'));
  await fixture.key('month:today').click();assert.equal(calls[0],'2026-10');assert.equal(fixture.key('day:2026-10-31').getAttribute('aria-pressed'),'true');
  await fixture.key('month:next').click();assert.equal(calls[1],'2026-11');assert.equal(fixture.byClass('cs-employee-profile-month').textContent,'November 2026');assert.equal(fixture.doc.activeElement.dataset.profileFocus,'month:next');
  await fixture.key('month:prev').click();assert.equal(calls[2],'2026-10');
});

test('all shifts remain available through the day agenda and its root-editor focus keys',async()=>{
  const calls=[],note='<img src=x onerror=alert(1)>'.repeat(1000),shifts=Array.from({length:5},(_,index)=>shift('many-'+index,'2026-10-31',{start:String(7+index).padStart(2,'0')+':00',end:String(8+index).padStart(2,'0')+':00',note}));
  const fixture=app({shifts,callbacks:{onOpenShift:(...args)=>calls.push(args)}});assert.equal(fixture.nodes().filter(item=>item.className==='cs-employee-profile-calendar-shift').length,3);assert.equal(fixture.key('more:2026-10-31').textContent,'+2 vagter');
  await fixture.key('more:2026-10-31').click();assert.equal(fixture.nodes().filter(item=>item.className==='cs-employee-profile-agenda-shift').length,5);
  const open=fixture.key('open-shift:many-4');await open.click();assert.equal(calls[0][0].id,'many-4');assert.equal(calls[0][1],open);assert.equal(open.dataset.productFocus,'employee-profile:open-shift:many-4');assert.equal(fixture.host.textContent.includes(note),false);
});

test('selecting a day keeps the calendar, scroll position and clicked control in place while updating its agenda',async()=>{
  const fixture=app({shifts:[shift('first','2026-10-02'),shift('second','2026-10-08')]}),calendar=fixture.byClass('cs-employee-profile-calendar'),header=fixture.byClass('cs-employee-profile-header'),page=fixture.byClass('cs-employee-profile-page'),control=fixture.key('shift:second');
  page.scrollTop=160;await control.click();
  assert.equal(fixture.byClass('cs-employee-profile-calendar'),calendar);assert.equal(fixture.byClass('cs-employee-profile-header'),header);assert.equal(fixture.doc.activeElement,control);assert.equal(page.scrollTop,160);
  assert.equal(fixture.key('day:2026-10-08').getAttribute('aria-pressed'),'true');assert.equal(fixture.key('day:2026-10-31').getAttribute('aria-pressed'),'false');assert.ok(fixture.byClass('cs-employee-profile-agenda-head').textContent.includes('8. oktober'));
});

test('read-only information and pay tabs display real data without fabricated salary controls',async()=>{
  const fixture=app({canEdit:false});assert.equal(fixture.key('edit'),undefined);await fixture.key('tab:information').click();assert.ok(fixture.byClass('cs-employee-profile-information').textContent.includes('35 timer'));assert.ok(fixture.byClass('cs-employee-profile-information').textContent.includes('Nordvej 12'));assert.equal(fixture.key('information:edit'),undefined);
  await fixture.key('tab:pay').click();assert.ok(fixture.byClass('cs-employee-profile-pay').textContent.includes('Løn er ikke sat op'));assert.equal(fixture.nodes().some(item=>item.tagName==='INPUT'||item.tagName==='SELECT'),false);assert.equal(fixture.key('tab:pay').getAttribute('aria-pressed'),'true');
});

test('local editing preserves drafts through failed saves, cancellation and a stale incoming record',async()=>{
  const calls=[],fixture=app({callbacks:{onSave:async(...args)=>{calls.push(args);return {ok:false,error:'Gemning afvist.'};}}});await fixture.key('edit').click();fixture.field('target').value='36';await fixture.key('edit:save').click();assert.equal(calls.length,1);assert.equal(calls[0][0].target,36);assert.deepEqual(calls[0][1],person);assert.equal(fixture.field('target').value,'36');assert.equal(fixture.byClass('cs-employee-profile-error').textContent,'Gemning afvist.');
  fixture.render({person:{...person,role:'Teamleder'}});assert.equal(fixture.field('target').value,'36');await fixture.key('edit:save').click();assert.equal(calls.length,1);assert.ok(fixture.byClass('cs-employee-profile-error').textContent.includes('ændret siden'));
  await fixture.key('edit:cancel').click();assert.equal(fixture.field('target'),undefined);assert.ok(fixture.byClass('cs-employee-profile-information').textContent.includes('Teamleder'));assert.equal(fixture.doc.activeElement.dataset.profileFocus,'tab:information');
});

test('an incoming render during save keeps the pending draft, then the confirmed employee replaces the form',async()=>{
  let resolve;const fixture=app({callbacks:{onSave:()=>new Promise(done=>{resolve=done;})}});await fixture.key('edit').click();fixture.field('name').value='Jonas opdateret';fixture.field('target').value='36';const saving=fixture.key('edit:save').click();
  fixture.render({person:{...person,name:'Jonas opdateret',target:36}});assert.equal(fixture.field('target').value,'36');assert.equal(fixture.key('edit:save').disabled,true);assert.equal(fixture.key('tab:calendar').disabled,true);resolve({ok:true,person:{...person,name:'Jonas opdateret',target:36}});await saving;
  assert.equal(fixture.field('target'),undefined);assert.ok(fixture.byClass('cs-employee-profile-information').textContent.includes('36 timer'));assert.equal(fixture.byClass('cs-employee-profile-name').textContent,'Jonas opdateret');assert.ok(fixture.byClass('cs-employee-profile-save-status'));
});

test('calendar errors preserve facts and literal user text, while an explicit missing person clears the old record',async()=>{
  const fixture=app();fixture.render({person:{...person,name:'<img src=x onerror=alert(1)>'},calendar:null,error:'Kalenderen kunne ikke beregnes.'});assert.ok(fixture.host.textContent.includes('Kalenderen kunne ikke beregnes.'));assert.ok(fixture.byClass('cs-employee-profile-facts').textContent.includes('Nordvej 12'));assert.equal(fixture.byClass('cs-employee-profile-month-totals'),undefined);assert.equal(fixture.nodes().some(item=>item.tagName==='IMG'),false);
  fixture.render({person:null,calendar:null});assert.equal(fixture.host.textContent.includes('Jonas'),false);assert.ok(fixture.host.textContent.includes('ikke tilgængelig'));
});

test('destroying a profile before a save resolves cannot repaint the detached page',async()=>{
  let resolve;const fixture=app({callbacks:{onSave:()=>new Promise(done=>{resolve=done;})}});fixture.controller.openEditor();fixture.field('target').value='36';const saving=fixture.key('edit:save').click();fixture.controller.destroy();resolve({ok:true});await saving;assert.equal(fixture.host.children.length,0);
});

test('group-origin profiles have an explicit return label and ordinary profiles restore the directory breadcrumb',async()=>{
  let backs=0;const fixture=app({callbacks:{onBack:()=>backs++}});fixture.render({backLabel:'Tilbage til løngruppen',backAriaLabel:'Tilbage til Demo · Daghold'});
  assert.equal(fixture.key('back').textContent,'Tilbage til løngruppen');assert.equal(fixture.key('back').getAttribute('aria-label'),'Tilbage til Demo · Daghold');assert.equal(fixture.byClass('cs-employee-profile-breadcrumb').getAttribute('aria-label'),'Tilbage til Demo · Daghold');await fixture.key('back').click();assert.equal(backs,1);
  fixture.render({backLabel:null,backAriaLabel:null});assert.equal(fixture.key('back').textContent,'Alle medarbejdere');assert.equal(fixture.key('back').getAttribute('aria-label'),'Alle medarbejdere');
});

test('profile requests a start code only on reveal and clears it after navigation or a password change',async()=>{
  const calls=[],tabs=[],copies=[];
  let resolve;
  const fixture=app({callbacks:{
    onTabChange:tab=>tabs.push(tab),
    onRevealAppLogin:(...args)=>{calls.push(args);return new Promise(done=>{resolve=done;});}
  }});
  fixture.doc.defaultView={navigator:{clipboard:{writeText:async code=>copies.push(code)}}};
  const account={personId:person.id,email:'jonas@example.test',status:'active',temporary:true,canRevealStartCode:true,version:2};
  fixture.render({appLogin:{status:'ready',account}});
  await fixture.key('facts:information').click();
  assert.deepEqual(tabs,['information']);
  assert.match(fixture.byClass('cs-employee-profile-app-login').textContent,/jonas@example\.test/);
  assert.deepEqual(calls,[]);assert.equal(fixture.key('app-login:code'),undefined);

  const opening=fixture.key('app-login:reveal').click();
  assert.deepEqual(calls,[[person.id,2]]);
  resolve({ok:true,temporaryPassword:'TempCode10'});await opening;
  assert.equal(fixture.key('app-login:code').value,'TempCode10');
  await fixture.key('app-login:copy').click();assert.deepEqual(copies,['TempCode10']);

  await fixture.key('tab:calendar').click();fixture.controller.showInformation();
  assert.equal(fixture.key('app-login:code'),undefined);
  const stale=fixture.key('app-login:reveal').click();
  fixture.render({appLogin:{status:'ready',account:{...account,temporary:false,canRevealStartCode:false,version:3}}});
  resolve({ok:true,temporaryPassword:'TempCode10'});await stale;
  assert.equal(fixture.key('app-login:code'),undefined);assert.equal(fixture.key('app-login:reveal'),undefined);
  assert.match(fixture.byClass('cs-employee-profile-app-login').textContent,/valgt sin egen adgangskode/);
  fixture.render({appLogin:null});assert.equal(fixture.byClass('cs-employee-profile-app-login'),undefined);
});

test('profile provisions a legacy login and confirms reset, revoke and reopen in place',async()=>{
  const calls=[];
  let fixture,account=null;
  fixture=app({callbacks:{onChangeAppLogin:async(action,payload)=>{
    calls.push({action,payload});
    const revoked=action==='revokeAppLogin';
    account={personId:person.id,email:payload.email??account.email,status:revoked?'revoked':'active',temporary:!revoked,
      canRevealStartCode:!revoked,version:(account?.version??0)+1};
    fixture.render({appLogin:{status:'ready',account}});
    return {ok:true,account,temporaryPassword:'DoNotShow1'};
  },onRevealAppLogin:async()=>({ok:true,temporaryPassword:'TempCode10'})}});
  fixture.render({appLogin:{status:'missing',email:'prefill@example.test'}});
  fixture.controller.showInformation();
  assert.equal(fixture.key('app-login:email').value,'prefill@example.test');
  fixture.key('app-login:email').value='ugyldig';
  await fixture.key('app-login:createAppLogin').click();
  assert.deepEqual(calls,[]);assert.equal(fixture.key('app-login:email').value,'ugyldig');
  fixture.key('app-login:email').value='rettet@example.test';
  await fixture.key('app-login:createAppLogin').click();
  assert.deepEqual(calls[0],{action:'createAppLogin',payload:{personId:person.id,email:'rettet@example.test'}});
  assert.equal(fixture.key('app-login:code'),undefined);assert.equal(fixture.doc.activeElement.dataset.profileFocus,'app-login:reveal');

  await fixture.key('app-login:resetAppLogin').click();
  assert.match(fixture.byClass('cs-employee-profile-app-login-confirm').textContent,/logget ud/);
  assert.equal(calls.length,1);
  await fixture.byClass('cs-employee-profile-app-login-confirm').fire('keydown',{key:'Escape'});
  assert.equal(fixture.key('app-login:confirm'),undefined);assert.equal(calls.length,1);
  await fixture.key('app-login:resetAppLogin').click();
  await fixture.key('app-login:confirm').click();
  assert.deepEqual(calls[1],{action:'resetAppLogin',payload:{personId:person.id,version:1}});

  await fixture.key('app-login:revokeAppLogin').click();
  await fixture.key('app-login:confirm').click();
  assert.deepEqual(calls[2],{action:'revokeAppLogin',payload:{personId:person.id,version:2}});
  assert.equal(fixture.key('app-login:reveal'),undefined);
  assert.equal(fixture.key('app-login:resetAppLogin').textContent,'Genåbn app-login');
  await fixture.key('app-login:resetAppLogin').click();
  await fixture.key('app-login:confirm').click();
  assert.deepEqual(calls[3],{action:'resetAppLogin',payload:{personId:person.id,version:3}});
  await fixture.key('app-login:reveal').click();
  const displayed=fixture.key('app-login:code');assert.equal(displayed.value,'TempCode10');
  fixture.render({person:{...person,active:false},appLogin:{status:'ready',account}});
  assert.equal(displayed.value,'');
  assert.equal(fixture.key('app-login:reveal'),undefined);
  assert.equal(fixture.key('app-login:resetAppLogin'),undefined);
  assert.ok(fixture.key('app-login:revokeAppLogin'));
});

test('app-login mutations cannot repaint a profile after access is lost',async()=>{
  let resolve;
  const fixture=app({callbacks:{onChangeAppLogin:()=>new Promise(done=>{resolve=done;})}});
  const account={personId:person.id,email:'jonas@example.test',status:'active',temporary:false,canRevealStartCode:false,version:2};
  fixture.render({appLogin:{status:'ready',account}});
  fixture.controller.showInformation();
  await fixture.key('app-login:resetAppLogin').click();
  const saving=fixture.key('app-login:confirm').click();
  fixture.render({appLogin:null});
  resolve({ok:true,account:{...account,temporary:true,canRevealStartCode:true,version:3}});await saving;
  assert.equal(fixture.byClass('cs-employee-profile-app-login'),undefined);
  fixture.render({appLogin:{status:'ready',account}});
  assert.doesNotMatch(fixture.byClass('cs-employee-profile-app-login').textContent,/startkode er klar/);
});
