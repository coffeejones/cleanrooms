const test=require('node:test');
const assert=require('node:assert/strict');
const View=require('../src/payroll-view.js');
const Model=require('../src/payroll-model.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.handlers={};this.className='';this.text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;}
  set innerHTML(value){throw Error('Payroll must render literal text.');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.text='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  fire(type){return Promise.all((this.handlers[type]||[]).map(handler=>handler({target:this,currentTarget:this,preventDefault(){}})));}
  click(){if(!this.disabled){this.focus();if(this.type==='checkbox'){this.checked=!this.checked;return this.fire('change');}return this.fire('click');}}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>part.startsWith('.')?node.className.split(' ').includes(part.slice(1)):node.tagName===part.toUpperCase()));}
  contains(node){return walk(this).includes(node);}
  focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
}
const person={id:'p0',name:'Jonas Larsen'},empty=()=>({currency:'DKK',agreements:[],supplements:[]});
const rate=(id='rate-1',patch={})=>({id,from:'2026-01-01',type:'hourly',amountCents:18550,...patch});
const allowance=(id='allowance-1',patch={})=>({id,name:'Aftentillæg',type:'hourly',amountCents:2500,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4,5,6],start:'18:00',end:'22:00',...patch});
const config=(patch={})=>({currency:'DKK',agreements:[rate()],supplements:[],...patch});
const shift=(id,date,patch={})=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'',...patch});
function app({payroll=null,version=0,canView=true,canManage=true,callbacks={},extra={}}={}){
  const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc),calls=[];
  const controller=View.mount({element:host,onSave:async(next,beforeVersion)=>{calls.push({config:next,version:beforeVersion});return {ok:true,payroll:next,version:beforeVersion+1};},...callbacks});
  const render=patch=>controller.render({person,month:'2026-11',payroll,version,loading:false,error:'',canView,canManage,today:'2026-10-31',estimate:payroll?Model.estimate({config:payroll,personId:person.id,month:'2026-11',shifts:[]}):null,...extra,...patch});render();
  const nodes=()=>walk(host),byClass=name=>nodes().find(item=>item.className.split(' ').includes(name)),key=value=>nodes().find(item=>item.dataset.payrollFocus===value),field=value=>nodes().find(item=>item.id?.endsWith('-'+value));
  return {host,doc,controller,calls,render,nodes,byClass,key,field};
}

test('Danish money parsing and formatting round-trip exact integer cents, including the safe upper boundary',()=>{
  for(const [input,cents] of [['185,50',18550],['185,5',18550],['185',18500],['1.234,56',123456],['1 234,56',123456],['0,00',0],['90071992547409,91',Number.MAX_SAFE_INTEGER]])assert.deepEqual(View.parseCents(input),{ok:true,cents});
  for(const input of ['', '185.50','1,234','-1,00','1.23,45','90071992547409,92','Infinity','<b>185</b>'])assert.equal(View.parseCents(input).ok,false,input);
  assert.equal(View.formatMoney(18550),'185,50 kr.');assert.equal(View.formatMoney(123456),'1.234,56 kr.');assert.equal(View.formatMoney(Number.MAX_SAFE_INTEGER),'90.071.992.547.409,91 kr.');assert.equal(View.formatMoney(undefined),'—');
});

test('view permission gates all amounts even when a complete private payload and management flag are supplied',()=>{
  const payroll=config({agreements:[rate('secret',{amountCents:99999})]}),fixture=app({payroll,canView:false,canManage:true});
  assert.ok(fixture.host.textContent.includes('ikke adgang'));assert.equal(fixture.host.textContent.includes('999,99'),false);assert.equal(fixture.nodes().some(item=>['INPUT','SELECT','BUTTON'].includes(item.tagName)),false);
  fixture.render({canView:true,canManage:false,payroll});assert.ok(fixture.host.textContent.includes('999,99'));assert.equal(fixture.key('agreement:add'),undefined);assert.equal(fixture.key('agreement:secret:edit'),undefined);assert.equal(fixture.key('supplement:add'),undefined);
});

test('empty setup contains no invented zero salary and a failed read offers retry instead of creation',()=>{
  const fixture=app({callbacks:{onReload:async()=>{}}});assert.ok(fixture.host.textContent.includes('Løn er ikke sat op'));assert.ok(fixture.key('agreement:create'));assert.equal(fixture.byClass('cs-payroll-total'),undefined);assert.equal(fixture.calls.length,0);
  fixture.render({payroll:null,error:'Hentning mislykkedes.',canManage:false});assert.ok(fixture.key('reload'));assert.equal(fixture.key('agreement:create'),undefined);assert.equal(fixture.byClass('cs-payroll-total'),undefined);
  fixture.render({payroll:config(),loading:true});assert.ok(fixture.host.textContent.includes('Henter lønoplysninger'));assert.equal(fixture.host.textContent.includes('185,50'),false);
});

test('creating a rate saves only after explicit action, passes the captured version and keeps exact cents',async()=>{
  const fixture=app();await fixture.key('agreement:create').click();assert.equal(fixture.calls.length,0);assert.equal(fixture.field('amount').value,'');fixture.field('amount').value='185,50';fixture.field('from').value='2026-11-01';await fixture.key('save').click();
  assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].version,0);assert.equal(fixture.calls[0].config.agreements.length,1);assert.equal(fixture.calls[0].config.agreements[0].amountCents,18550);assert.equal(fixture.calls[0].config.agreements[0].from,'2026-11-01');assert.equal(Model.validate(fixture.calls[0].config).length,0);assert.ok(fixture.host.textContent.includes('Lønaftalen er gemt.'));assert.equal(fixture.doc.activeElement,fixture.key('agreement:add'));assert.deepEqual(fixture.doc.activeElement.focusOptions,{preventScroll:true});
});

test('a new dated change retains older agreements and input errors do not dispatch writes',async()=>{
  const original=config(),before=JSON.stringify(original),fixture=app({payroll:original,version:4});await fixture.key('agreement:add').click();fixture.field('amount').value='200.50';fixture.field('from').value='2026-12-01';await fixture.key('save').click();assert.equal(fixture.calls.length,0);assert.ok(fixture.byClass('cs-payroll-editor').textContent.includes('komma'));
  fixture.field('amount').value='200,50';await fixture.key('save').click();assert.equal(fixture.calls[0].version,4);assert.equal(fixture.calls[0].config.agreements.length,2);assert.deepEqual(fixture.calls[0].config.agreements[0],original.agreements[0]);assert.equal(JSON.stringify(original),before);
});

test('hourly allowance weekdays are Monday-first and an overnight window remains an explicit rule',async()=>{
  const fixture=app({payroll:config(),version:2});await fixture.key('supplement:add').click();fixture.field('name').value='Nattillæg';fixture.field('amount').value='30,25';fixture.field('from').value='2026-11-01';fixture.nodes().find(item=>item.dataset.day==='0').checked=true;fixture.nodes().find(item=>item.dataset.day==='6').checked=true;await fixture.key('limit-time').click();fixture.field('start').value='22:00';fixture.field('end').value='06:00';await fixture.key('save').click();
  const item=fixture.calls[0].config.supplements[0];assert.deepEqual(item.weekdays,[0,6]);assert.equal(item.start,'22:00');assert.equal(item.end,'06:00');assert.equal(item.amountCents,3025);assert.ok(fixture.host.textContent.includes('Man, Søn · 22:00–06:00 · over midnat'));
});

test('a monthly allowance ignores retained hourly widgets and is persisted without weekdays or times',async()=>{
  const fixture=app({payroll:config({supplements:[allowance()]}),version:3});await fixture.key('supplement:allowance-1:edit').click();fixture.field('type').value='monthly';await fixture.field('type').fire('change');fixture.field('amount').value='1.000,00';fixture.field('to').value='2026-12-31';await fixture.key('save').click();
  const item=fixture.calls[0].config.supplements.at(-1);assert.notEqual(item.id,'allowance-1');assert.equal(fixture.calls[0].config.supplements[0].to,'2026-10-30');assert.equal(item.type,'monthly');assert.deepEqual(item.weekdays,[]);assert.equal(item.start,null);assert.equal(item.end,null);assert.equal(item.amountCents,100000);assert.ok(fixture.host.textContent.includes('Fast månedligt tillæg'));
});

test('failed saves preserve the draft and stable generated id for an explicit retry',async()=>{
  const calls=[];const fixture=app({callbacks:{onSave:async(candidate,version)=>{calls.push({candidate,version});return calls.length===1?{ok:false,error:'Netværket afviste gemningen.'}:{ok:true,payroll:candidate,version:version+1};}}});
  await fixture.key('agreement:create').click();fixture.field('amount').value='190,75';fixture.field('from').value='2026-11-01';await fixture.key('save').click();assert.equal(fixture.field('amount').value,'190,75');assert.ok(fixture.host.textContent.includes('Netværket afviste'));await fixture.key('save').click();assert.equal(calls.length,2);assert.equal(calls[0].candidate.agreements[0].id,calls[1].candidate.agreements[0].id);assert.equal(calls[0].version,calls[1].version);
});

test('CAS conflicts retain the draft, block another write, and require a manual reload before a fresh edit',async()=>{
  let fixture;const writes=[],latest=config({supplements:[allowance('concurrent')]});fixture=app({payroll:config(),version:1,callbacks:{onSave:async(candidate,version)=>{writes.push({candidate,version});return {ok:false,status:409,conflict:true,error:'Versionen er ændret.'};},onReload:async()=>fixture.render({payroll:latest,version:2,error:''})}});
  await fixture.key('agreement:rate-1:edit').click();fixture.field('amount').value='200,00';await fixture.key('save').click();assert.equal(fixture.field('amount').value,'200,00');assert.equal(fixture.key('save').disabled,true);await fixture.key('save').click();assert.equal(writes.length,1);assert.ok(fixture.host.textContent.includes('lukkes din kladde'));
  await fixture.key('reload').click();assert.equal(fixture.field('amount'),undefined);assert.ok(fixture.key('supplement:concurrent:edit'));await fixture.key('agreement:rate-1:edit').click();assert.equal(fixture.field('amount').value,'185,50');
});

test('an incoming version change blocks an unsaved older draft before any API write',async()=>{
  const fixture=app({payroll:config(),version:1});await fixture.key('agreement:rate-1:edit').click();fixture.field('amount').value='220,00';fixture.render({payroll:config({supplements:[allowance('new')]}),version:2});assert.equal(fixture.field('amount').value,'220,00');assert.equal(fixture.key('save').disabled,true);assert.equal(fixture.calls.length,0);assert.ok(fixture.key('reload')===undefined);assert.ok(fixture.host.textContent.includes('seneste version'));
});

test('supplement removal is a reviewable draft and cancellation does not persist a deletion',async()=>{
  const payroll=config({supplements:[allowance()]}),fixture=app({payroll,version:5});await fixture.key('supplement:allowance-1:remove').click();assert.equal(fixture.calls.length,0);assert.ok(fixture.host.textContent.includes('afsluttes fra'));await fixture.key('remove:cancel').click();assert.ok(fixture.key('supplement:allowance-1:edit'));assert.equal(fixture.calls.length,0);assert.equal(fixture.doc.activeElement,fixture.key('supplement:allowance-1:remove'));
  await fixture.key('supplement:allowance-1:remove').click();await fixture.key('remove:save').click();assert.equal(fixture.calls[0].version,5);assert.equal(fixture.calls[0].config.supplements.length,1);assert.equal(fixture.calls[0].config.supplements[0].to,'2026-10-30');assert.equal(payroll.supplements[0].to,null);
});

test('monthly planned gross uses model totals rather than summing shift allocations, and incomplete models remain labelled',()=>{
  const payroll=config({agreements:[rate('monthly',{type:'monthly',amountCents:3000000})]}),fixture=app({payroll,extra:{estimate:Model.estimate({config:payroll,personId:'p0',month:'2026-11',shifts:[]})}});assert.equal(fixture.byClass('cs-payroll-total').textContent,'30.000,00 kr.');assert.ok(fixture.host.textContent.includes('Pension og feriepenge er ikke medregnet'));
  const partial=config({agreements:[rate('late',{from:'2026-11-02'})]}),estimate=Model.estimate({config:partial,personId:'p0',month:'2026-11',shifts:[shift('uncovered','2026-11-01'),shift('overlap-a','2026-11-02'),shift('overlap-b','2026-11-02',{start:'14:00',end:'17:00'})]});fixture.render({payroll:partial,estimate});assert.ok(fixture.byClass('cs-payroll-warning').textContent.includes('ufuldstændig'));assert.ok(fixture.byClass('cs-payroll-warning').textContent.includes('mangler'));assert.ok(fixture.byClass('cs-payroll-warning').textContent.includes('overlap'));
});

test('person changes, revoked view permission and disposal ignore late save receipts',async()=>{
  let resolve;const fixture=app({callbacks:{onSave:()=>new Promise(done=>{resolve=done;})}});await fixture.key('agreement:create').click();fixture.field('amount').value='185,50';fixture.field('from').value='2026-11-01';const saving=fixture.key('save').click();fixture.render({person:{id:'p1',name:'Emma'},payroll:config({agreements:[rate('emma',{amountCents:99900})]}),version:3});resolve({ok:true,payroll:config(),version:1});await saving;assert.ok(fixture.host.textContent.includes('999,00'));assert.equal(fixture.field('amount'),undefined);
  fixture.render({canView:false,canManage:true});assert.equal(fixture.host.textContent.includes('999,00'),false);assert.equal(fixture.nodes().some(item=>item.tagName==='INPUT'),false);fixture.controller.destroy();assert.equal(fixture.host.children.length,0);
});

test('a partial person switch clears cached salary, estimate, version and update metadata before another record is loaded',()=>{
  const payroll=config({agreements:[rate('private',{type:'monthly',amountCents:9876543})]}),fixture=app({payroll,version:12,extra:{updatedAt:'2026-10-31T12:00:00Z'}});assert.ok(fixture.host.textContent.includes('98.765,43'));
  fixture.controller.render({person:{id:'p1',name:'Emma'},canView:true});assert.equal(fixture.host.textContent.includes('98.765,43'),false);assert.equal(fixture.byClass('cs-payroll-total'),undefined);assert.equal(fixture.byClass('cs-payroll-updated'),undefined);assert.equal(fixture.key('agreement:private:edit'),undefined);assert.ok(fixture.host.textContent.includes('Henter lønoplysninger'));
});

test('a late older save receipt cannot replace a newer rendered CAS snapshot',async()=>{
  let resolve;const fixture=app({payroll:config(),version:1,callbacks:{onSave:()=>new Promise(done=>{resolve=done;})}});await fixture.key('agreement:rate-1:edit').click();fixture.field('amount').value='200,00';const saving=fixture.key('save').click();
  const latest=config({agreements:[rate('rate-1',{amountCents:21000})],supplements:[allowance('newer')]});fixture.render({payroll:latest,version:3});resolve({ok:true,payroll:config({agreements:[rate('rate-1',{amountCents:20000})]}),version:2});await saving;
  assert.equal(fixture.field('amount').value,'200,00');assert.equal(fixture.key('save').disabled,true);assert.ok(fixture.host.textContent.includes('210,00 kr.'));assert.ok(fixture.key('supplement:newer:edit'));assert.ok(fixture.host.textContent.includes('seneste version'));
});

test('inherited salary renders estimates without inventing a personal rate or showing an unconfigured empty state',async()=>{
  const effective=config(),estimate=Model.estimate({config:effective,personId:person.id,month:'2026-11',shifts:[shift('work','2026-11-02')]});
  const fixture=app({extra:{linked:true,policyVersion:4,estimate}});
  assert.equal(fixture.host.textContent.includes('Løn er ikke sat op'),false);assert.equal(fixture.byClass('cs-payroll-total').textContent,'1.484,00 kr.');assert.ok(fixture.host.textContent.includes('Personlige lønaftaler'));assert.ok(fixture.host.textContent.includes('Ingen personlig grundløn'));assert.equal(fixture.calls.length,0);
  await fixture.key('agreement:add').click();fixture.field('amount').value='200,00';fixture.field('from').value='2026-12-01';
  fixture.render({policyVersion:5});assert.equal(fixture.key('save').disabled,true);await fixture.key('save').click();assert.equal(fixture.calls.length,0);assert.equal(fixture.field('amount').value,'200,00');
});
test('personal save captures the group version with the raw salary draft, including while the authoritative render arrives',async()=>{
  let fixture,received;fixture=app({payroll:config(),version:2,extra:{policyVersion:7,linked:true},callbacks:{onSave:async(next,version,policyVersion)=>{received={next,version,policyVersion};fixture.render({payroll:next,version:3,policyVersion:8});return {ok:true,payroll:next,version:3,policyVersion:8};}}});
  await fixture.key('agreement:add').click();fixture.field('amount').value='205,25';fixture.field('from').value='2026-12-01';await fixture.key('save').click();
  assert.equal(received.policyVersion,7);assert.equal(received.version,2);assert.equal(received.next.agreements.length,2);assert.equal(fixture.key('save'),undefined);assert.ok(fixture.host.textContent.includes('Lønaftalen er gemt.'));
});

test('supporting calculations and saved personal rates are folded by default and group editing removes competing personal actions',async()=>{
  const fixture=app({payroll:config({supplements:[allowance()]})}),estimate=fixture.byClass('cs-payroll-estimate-disclosure'),records=fixture.byClass('cs-payroll-records');
  assert.equal(estimate.open,false);assert.equal(records.open,false);assert.match(estimate.children[0].textContent,/Periodens forventede løn/);assert.match(records.children[0].textContent,/Personlige satser og historik/);assert.equal(fixture.calls.length,0);
  const staleAdd=fixture.key('agreement:add');fixture.controller.setInheritanceEditing(true);assert.equal(fixture.key('agreement:add'),undefined);assert.equal(fixture.byClass('cs-payroll-estimate-disclosure'),undefined);await staleAdd.click();assert.equal(fixture.field('amount'),undefined);assert.equal(fixture.calls.length,0);
  fixture.controller.setInheritanceEditing(false);assert.ok(fixture.key('agreement:add'));assert.ok(fixture.byClass('cs-payroll-estimate-disclosure'));
});

test('historical salary actions create a new dated agreement and reject a backdated replacement before sending',async()=>{
  const original=config(),fixture=app({payroll:original,version:3});assert.equal(fixture.key('agreement:rate-1:edit').textContent,'Ny sats');
  await fixture.key('agreement:rate-1:edit').click();assert.equal(fixture.field('from').value,'2026-10-31');fixture.field('amount').value='210,00';fixture.field('from').value='2026-10-30';await fixture.key('save').click();assert.equal(fixture.calls.length,0);assert.match(fixture.host.textContent,/Tidligere grundløn og tillæg/);
  fixture.field('from').value='2026-11-01';await fixture.key('save').click();assert.equal(fixture.calls.length,1);assert.deepEqual(fixture.calls[0].config.agreements[0],original.agreements[0]);assert.notEqual(fixture.calls[0].config.agreements[1].id,original.agreements[0].id);
  await fixture.key('agreement:'+fixture.calls[0].config.agreements[1].id+':edit').click();assert.equal(fixture.field('from').value,'2026-11-01');fixture.field('amount').value='215,00';await fixture.key('save').click();assert.equal(fixture.calls[1].config.agreements.length,2);assert.equal(fixture.calls[1].config.agreements[1].id,fixture.calls[0].config.agreements[1].id);
});

test('future allowance removal can delete an unused period while ending an ongoing rule restores the full editor afterwards',async()=>{
  const fixture=app({payroll:config({supplements:[allowance('ongoing'),allowance('future',{from:'2026-12-01'})]}),version:2});
  await fixture.key('supplement:future:remove').click();assert.match(fixture.host.textContent,/fjernes først/);await fixture.key('remove:save').click();assert.deepEqual(fixture.calls[0].config.supplements.map(item=>item.id),['ongoing']);
  await fixture.key('supplement:ongoing:remove').click();fixture.field('from').value='2026-11-05';await fixture.key('remove:save').click();assert.equal(fixture.calls[1].config.supplements[0].to,'2026-11-04');
  await fixture.key('agreement:add').click();assert.ok(fixture.field('from'));assert.equal(fixture.field('from').disabled,false);fixture.field('amount').value='220';fixture.field('from').value='2026-12-01';await fixture.key('save').click();assert.equal(fixture.calls.length,3);
});

test('planned pause assumptions are shown with the salary calculation instead of silently counting gross hours',()=>{
  const payroll=config(),estimate=Model.estimate({config:payroll,personId:'p0',month:'2026-11',shifts:[shift('paused','2026-11-02',{plannedBreakMinutes:30})]}),fixture=app({payroll,extra:{estimate}});
  assert.equal(estimate.minutes,450);assert.match(fixture.host.textContent,/Planlagte pauser er placeret sidst i vagten/);assert.match(fixture.host.textContent,/Faktisk løn følger de registrerede pauser/);
});
