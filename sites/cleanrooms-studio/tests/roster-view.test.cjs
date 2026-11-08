const test=require('node:test');
const assert=require('node:assert/strict');
const View=require('../src/roster-view.js');
const Planning=require('../src/roster-planning.js');
const sites=require('../src/department-model.js').defaultOrganization().sites;
const person=(id,name,patch={})=>({id,name,initials:name[0],target:30,site:0,role:'Servicemedarbejder',active:true,...patch});
const walk=node=>[node,...node.children.flatMap(walk)];
class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.value='';this.checked=false;this.className='';this.text='';}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
  dispatch(type,extra={}){return Promise.all((this.listeners[type]||[]).map(handler=>handler({target:this,preventDefault(){},...extra})));}
  click(){if(!this.disabled)return this.dispatch('click');}
  querySelectorAll(selector){const selectors=selector.split(',');return walk(this).slice(1).filter(node=>selectors.some(value=>value.startsWith('.')?node.className.split(' ').includes(value.slice(1)):node.tagName===value.toUpperCase()));}
  focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
  scrollIntoView(options){this.scrollOptions=options;}
}
function application(staff,callbacks={}){
  const doc={createElement:tag=>new Element(tag,doc)},element=new Element('div',doc),calls=[];
  const controller=View.mount({element,sites,onSave:async(next,metadata)=>{calls.push({next,metadata});return {ok:true};},...callbacks});
  controller.render({staff,sites,canEdit:true});
  const nodes=()=>walk(element),byClass=name=>nodes().find(node=>node.className.split(' ').includes(name)),button=label=>nodes().find(node=>node.tagName==='BUTTON'&&node.textContent===label),field=name=>nodes().find(node=>node.id?.endsWith('-'+name));
  return {controller,element,calls,nodes,byClass,button,field};
}

test('creating an employee while the directory is filtered keeps all other staff and shows literal text safely',async()=>{
  const staff=[person('person-anna','Anna'),person('person-bob','Bob')],app=application(staff);
  app.field('search').value='Anna';await app.field('search').dispatch('input');assert.equal(app.byClass('cs-roster-shown').textContent,'1 vist');
  await app.button('Opret medarbejder').click();app.field('name').value='<img src=x onerror=alert(1)>';app.field('target').value='32.5';await app.button('Gem medarbejder').click();
  assert.equal(app.calls.length,1);assert.equal(app.calls[0].next.length,3);assert.deepEqual(app.calls[0].next.slice(0,2),staff);assert.equal(app.calls[0].metadata.kind,'create');assert.equal(app.calls[0].metadata.person.name,'<img src=x onerror=alert(1)>');assert.equal(app.calls[0].metadata.person.target,32.5);assert.equal(app.byClass('cs-roster-editor').hidden,true);
  app.field('search').value='';await app.field('search').dispatch('input');assert.ok(app.element.textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(app.nodes().some(node=>node.tagName==='IMG'),false);
});

test('archiving preserves the record and its ID; a changed captured employee cannot be silently overwritten',async()=>{
  const staff=[person('person-anna','Anna'),person('person-bob','Bob')],app=application(staff);
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Rediger Anna').click();app.field('active').checked=false;await app.button('Gem medarbejder').click();
  assert.equal(app.calls[0].metadata.kind,'archive');assert.equal(app.calls[0].next.length,2);assert.equal(app.calls[0].next[0].id,'person-anna');assert.equal(app.calls[0].next[0].active,false);
  app.controller.render({staff,sites,canEdit:true});await app.nodes().find(node=>node.getAttribute('aria-label')==='Rediger Anna').click();app.controller.render({staff:[{...staff[0],target:35},staff[1]],sites,canEdit:true});app.field('name').value='Overwrite';await app.button('Gem medarbejder').click();assert.equal(app.calls.length,1);assert.match(app.byClass('cs-roster-editor').textContent,/ændret siden/);
});

test('a company budget does not affect new staff, existing agreements or CSV imports',async()=>{
  const staff=[person('person-anna','Anna')],app=application(staff);
  const cancel=()=>app.byClass('cs-roster-editor').querySelectorAll('button').find(item=>item.textContent==='Annuller').click();
  app.controller.render({staff,sites,canEdit:true,workHoursBudget:{period:'month',hours:3200}});
  await app.button('Opret medarbejder').click();assert.equal(app.field('target').value,'37');
  await cancel();
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Rediger Anna').click();
  assert.equal(app.field('target').value,'30');await cancel();
  await app.button('Importér CSV').click();app.field('csv').value='ID;Navn;Timer\nperson-anna;Anna;\n;Bo;\n;Camilla;0';
  await app.button('Kontrollér import').click();await app.button('Gem import').click();
  assert.deepEqual(app.calls[0].next.map(item=>item.target),[30,37,0]);
});

test('CSV import requires a successful preview, includes unfiltered existing staff, and rejects a stale preview',async()=>{
  const staff=[person('person-anna','Anna')],app=application(staff);
  await app.button('Importér CSV').click();app.field('csv').value='Navn;Timer;Arbejdssted\nCamilla;25;Klinikken';await app.button('Kontrollér import').click();assert.equal(app.button('Gem import').hidden,false);assert.equal(app.calls.length,0);await app.button('Gem import').click();assert.equal(app.calls.length,1);assert.equal(app.calls[0].metadata.kind,'import');assert.equal(app.calls[0].next.length,2);assert.equal(app.calls[0].next[0].id,'person-anna');assert.equal(app.calls[0].next[1].site,1);
  await app.button('Importér CSV').click();app.field('csv').value='Navn\nDorte';await app.button('Kontrollér import').click();app.controller.render({staff:[...staff,person('person-bob','Bob')],sites,canEdit:true});await app.button('Gem import').click();assert.equal(app.calls.length,1);assert.match(app.byClass('cs-roster-import').textContent,/listen er ændret/);
});

test('failed saves keep the editable draft and readonly rendering exposes no write actions',async()=>{
  const app=application([person('person-anna','Anna')],{onSave:async()=>({ok:false,error:'Serveren afviste ændringen.'})});await app.button('Opret medarbejder').click();app.field('name').value='Camilla';await app.button('Gem medarbejder').click();assert.equal(app.byClass('cs-roster-editor').hidden,false);assert.equal(app.field('name').value,'Camilla');assert.match(app.byClass('cs-roster-editor').textContent,/Serveren afviste/);
  app.controller.render({canEdit:false});assert.equal(app.button('Opret medarbejder').hidden,true);assert.equal(app.byClass('cs-roster-editor').hidden,true);assert.equal(app.nodes().some(node=>node.getAttribute('aria-label')==='Rediger Anna'),false);
});

const scheduled=(id,person,date,start,end,site=0)=>({id,person,date,start,end,site});
function planningFor(staff){return Planning.build({staff,weekStart:'2026-10-26',today:'2026-10-30',horizonEnd:'2026-11-27',weeklyShifts:[scheduled('a1','person-anna','2026-10-26','07:00','15:00'),scheduled('a2','person-anna','2026-10-27','07:00','15:00'),scheduled('b1','person-bob','2026-10-30','07:00','12:00',1)],upcomingShifts:[scheduled('a3','person-anna','2026-11-02','08:00','12:00',1),scheduled('a4','person-anna','2026-11-03','09:00','13:00'),scheduled('a5','person-anna','2026-11-04','10:00','14:00'),scheduled('a6','person-anna','2026-11-05','11:00','15:00')]});}

test('dedicated employee navigation forwards the real identity and retains directory filters without opening the old aside',async()=>{
  const staff=[person('person-anna','Anna'),person('person-bob','Bob')],opened=[],app=application(staff,{onOpenPerson:value=>{opened.push(value);value.name='Changed outside the view';}});
  app.field('search').value='Anna';await app.field('search').dispatch('input');
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Åbn profil for Anna').click();
  assert.equal(opened[0].id,'person-anna');assert.equal(app.field('search').value,'Anna');assert.equal(app.byClass('cs-roster-shown').textContent,'1 vist');
  assert.equal(app.byClass('cs-roster-side').hidden,true);assert.ok(app.byClass('cs-roster-table').textContent.includes('Anna'));assert.equal(app.calls.length,0);
});

test('directory fills the page initially and status tabs, hidden filter, worksite and search compose',async()=>{
  const staff=[person('person-anna','Anna'),person('person-bob','Bob',{site:1}),person('person-camilla','Camilla',{active:false,site:1})],app=application(staff);
  assert.equal(app.byClass('cs-roster-side').hidden,true);assert.equal(app.byClass('cs-roster-workspace').dataset.asideOpen,'false');assert.equal(app.nodes().some(node=>node.className==='cs-roster-guide'),false);assert.equal(app.field('filter').hidden,true);
  assert.equal(app.byClass('cs-roster-count').textContent,'3 medarbejdere · 2 aktive · 1 arkiveret');assert.equal(app.byClass('cs-roster-shown').textContent,'2 vist');
  await app.nodes().find(node=>node.dataset.status==='all').click();assert.equal(app.field('filter').value,'all');assert.equal(app.byClass('cs-roster-shown').textContent,'3 vist');
  app.field('site-filter').value='1';await app.field('site-filter').dispatch('change');assert.equal(app.byClass('cs-roster-shown').textContent,'2 vist');
  app.field('search').value='Cam';await app.field('search').dispatch('input');assert.equal(app.byClass('cs-roster-shown').textContent,'1 vist');
  app.field('filter').value='active';await app.field('filter').dispatch('change');assert.equal(app.byClass('cs-roster-shown').textContent,'0 vist');assert.equal(app.nodes().find(node=>node.dataset.status==='active').getAttribute('aria-pressed'),'true');
  app.field('search').value='';app.field('site-filter').value='all';app.controller.render({staff:staff.slice(0,2),sites,canEdit:true});await app.nodes().find(node=>node.dataset.status==='archived').click();assert.ok(app.byClass('cs-roster-empty').textContent.includes('Ingen arkiverede medarbejdere'));assert.ok(app.byClass('cs-roster-empty').textContent.includes('Tidligere vagter bevares.'));
});

test('real planning supplies weekly totals, neutral/over-target meters and the first three actual upcoming shifts',async()=>{
  const staff=[person('person-anna','Anna',{target:16}),person('person-bob','Bob',{target:4,site:1})],events=[],app=application(staff,{onShowPlan:(...args)=>events.push(args)}),planning=planningFor(staff);
  app.controller.render({staff,sites,canEdit:true,planning});
  assert.equal(app.byClass('cs-roster-week-legend').textContent,'Planlagt / aftalt');
  const rows=app.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId),anna=rows.find(node=>node.dataset.personId==='person-anna'),bob=rows.find(node=>node.dataset.personId==='person-bob');
  assert.ok(anna.textContent.includes('16 / 16 t'));assert.ok(bob.textContent.includes('5 / 4 t'));assert.ok(bob.textContent.includes('1 t over aftalt'));assert.equal(app.nodes().filter(node=>node.className==='cs-roster-meter')[1].dataset.state,'over');
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Åbn profil for Anna').click();assert.equal(app.byClass('cs-roster-side').hidden,false);assert.equal(app.byClass('cs-roster-profile').hidden,false);assert.equal(app.byClass('cs-roster-workspace').dataset.asideOpen,'true');
  const upcoming=app.byClass('cs-roster-upcoming-list');assert.equal(upcoming.children.length,3);assert.ok(upcoming.textContent.includes('08:00–12:00'));assert.ok(upcoming.textContent.includes('Klinikken'));assert.equal(upcoming.textContent.includes('11:00–15:00'),false);
  await app.button('Vis i vagtplan').click();assert.equal(events[0][0].id,'person-anna');assert.equal(events[0][1].id,'a3');
  assert.equal(app.byClass('cs-roster-profile-name').focusOptions.preventScroll,true);assert.equal(app.byClass('cs-roster-profile').scrollOptions,undefined);
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Luk medarbejderprofil').click();assert.equal(app.byClass('cs-roster-side').hidden,true);assert.equal(app.element.ownerDocument.activeElement.getAttribute('aria-label'),'Åbn profil for Anna');
});

test('planning absence and failures show only actual agreed targets, while readonly profiles stay readable across updates',async()=>{
  const staff=[person('person-anna','Anna',{target:16})],app=application(staff,{onShowPlan:()=>{}});
  assert.ok(app.byClass('cs-roster-table').textContent.includes('Aftalt pr. uge'));assert.equal(app.nodes().filter(node=>node.className==='cs-roster-meter').length,0);
  app.controller.render({staff,sites,canEdit:false,planning:planningFor(staff)});await app.nodes().find(node=>node.getAttribute('aria-label')==='Åbn profil for Anna').click();assert.equal(app.byClass('cs-roster-profile').hidden,false);
  app.controller.render({staff,sites,canEdit:false,planning:undefined,planningError:'Ugens plan kunne ikke beregnes.'});assert.equal(app.byClass('cs-roster-profile').hidden,false);assert.equal(app.byClass('cs-roster-planning-notice').hidden,false);assert.ok(app.byClass('cs-roster-profile').textContent.includes('Vagtdata er ikke indlæst'));assert.ok(app.byClass('cs-roster-table').textContent.includes('16 t aftalt'));assert.equal(app.byClass('cs-roster-table').textContent.includes('0 /'),false);
  assert.equal(app.nodes().some(node=>node.getAttribute('aria-label')==='Rediger Anna'),false);assert.equal(app.nodes().some(node=>node.textContent==='Rediger medarbejder'),false);assert.ok(app.button('Vis i vagtplan'));
});

test('profile edit cancellation returns to the profile, and incoming renders while saving preserve the draft and refresh planning',async()=>{
  const staff=[person('person-anna','Anna',{target:16})],saved=[];let app;
  app=application(staff,{onSave:async(next,metadata)=>{saved.push(metadata);app.controller.render({staff:next,sites,canEdit:true,planning:planningFor(next)});assert.equal(app.field('target').value,'18');assert.equal(app.byClass('cs-roster-editor').hidden,false);return {ok:true};}});
  app.controller.render({staff,sites,canEdit:true,planning:planningFor(staff)});await app.nodes().find(node=>node.getAttribute('aria-label')==='Åbn profil for Anna').click();await app.button('Rediger medarbejder').click();assert.equal(app.byClass('cs-roster-profile').hidden,true);
  app.field('name').value='Kladde';await app.byClass('cs-roster-editor').querySelectorAll('button').find(node=>node.textContent==='Annuller').click();assert.equal(app.byClass('cs-roster-profile').hidden,false);assert.ok(app.byClass('cs-roster-profile').textContent.includes('Anna'));
  await app.button('Rediger medarbejder').click();app.field('target').value='18';await app.button('Gem medarbejder').click();assert.equal(saved.length,1);assert.equal(app.byClass('cs-roster-profile').hidden,false);assert.ok(app.byClass('cs-roster-table').textContent.includes('16 / 18 t'));assert.equal(app.element.ownerDocument.activeElement.className,'cs-roster-profile-name');
});

test('inline profiles scroll their heading into view on narrow layouts without changing the directory selection',async()=>{
  const app=application([person('person-anna','Anna')]);app.element.ownerDocument.defaultView={matchMedia:()=>({matches:true})};
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Åbn profil for Anna').click();assert.deepEqual(app.byClass('cs-roster-profile').scrollOptions,{block:'start'});assert.deepEqual(app.byClass('cs-roster-profile-name').focusOptions,{preventScroll:true});
  await app.nodes().find(node=>node.getAttribute('aria-label')==='Luk medarbejderprofil').click();assert.equal(app.byClass('cs-roster-workspace').dataset.asideOpen,'false');assert.equal(app.element.ownerDocument.activeElement.dataset.personId,'person-anna');
});
