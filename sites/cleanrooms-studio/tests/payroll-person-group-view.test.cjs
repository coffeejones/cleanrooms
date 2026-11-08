const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const View=require('../src/payroll-person-group-view.js');
const Groups=require('../src/payroll-groups-model.js');
const Payroll=require('../src/payroll-model.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.handlers={};this.className='';this.text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;}
  set innerHTML(value){throw Error('Person pay settings must use literal text.');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.text='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  fire(type){return Promise.all((this.handlers[type]||[]).map(handler=>handler({target:this,currentTarget:this,preventDefault(){}})));}
  click(){if(!this.disabled){this.focus();if(this.type==='checkbox'){this.checked=!this.checked;return this.fire('change');}return this.fire('click');}}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>part.startsWith('.')?node.className.split(' ').includes(part.slice(1)):node.tagName===part.toUpperCase()));}
  contains(node){return walk(this).includes(node);}
  focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
}
const base=(amountCents=18550)=>({id:'base',from:'2026-01-01',type:'hourly',amountCents});
const addon=(id='night',extra={})=>({id,name:'Nattillæg',type:'hourly',amountCents:2500,from:'2026-01-01',to:null,weekdays:[0,1,2],start:'22:00',end:'06:00',...extra});
const pay=(extra={})=>({currency:'DKK',agreements:[base(20000)],supplements:[addon('personal',{name:'Personlig bonus',start:null,end:null})],...extra});
const group=(id='g1')=>({id,name:'Standardgruppen',archived:false,revisions:[{id:'r1',from:'2026-01-01',payroll:{currency:'DKK',agreements:[base()],supplements:[addon()]}}]});
const link=(from='2026-01-01',groupId='g1')=>({personId:'p0',from,groupId,baseMode:groupId?'group':'personal',excludedPersonalSupplementIds:[],supplementOverrides:[]});
const policy=()=>({schema:1,groups:[group()],links:[link()]});
const person={id:'p0',name:'Jonas Larsen'};
function app({data=policy(),raw=pay(),version=4,policyVersion=2,canManage=true,callbacks={}}={}){
  const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc),calls=[],opens=[];
  const controller=View.mount({element:host,onOpenGroups:id=>opens.push(id),onSave:async payload=>{calls.push(payload);return {ok:true,version:payload.version,policyVersion:payload.policyVersion+1,policy:Groups.normalize({...data,links:[...data.links.filter(item=>item.personId!==payload.personId||item.from!==payload.link.from),payload.link]})};},...callbacks});
  const render=patch=>controller.render({person,policy:data,policyVersion,payroll:raw,version,canManage,today:'2026-10-31',...patch});render();
  const key=value=>walk(host).find(item=>item.dataset.personPayFocus===value),change=async(name,value)=>{const control=key(name);assert.ok(control,'control '+name);control.value=value;await control.fire(control.type==='text'?'input':'change');};
  return {host,doc,controller,calls,opens,key,change,render,nodes:()=>walk(host)};
}

test('read-only group context shows the source but exposes no mutation and unassigned employees open groups instead',async()=>{
  const fixture=app({canManage:false});assert.match(fixture.host.textContent,/Standardgruppen/);assert.match(fixture.host.textContent,/Grundløn fra gruppen/);assert.equal(fixture.key('edit'),undefined);assert.equal(fixture.key('save'),undefined);assert.equal(fixture.calls.length,0);
  const none=app({data:{schema:1,groups:[group()],links:[]}});assert.match(none.host.textContent,/Ingen løngruppe/);assert.equal(none.key('edit'),undefined);await none.key('groups').click();assert.deepEqual(none.opens,['p0']);assert.equal(none.calls.length,0);
});

test('full dated exceptions require a local review and explicit save while preserving raw personal pay',async()=>{
  const raw=pay(),data=policy(),beforeRaw=JSON.stringify(raw),beforePolicy=JSON.stringify(data),fixture=app({data,raw});await fixture.key('edit').click();
  assert.equal(fixture.key('save'),undefined);await fixture.change('base-mode','personal');await fixture.change('mode:night','personal');await fixture.change('amount:night','31,75');await fixture.key('personal:personal').click();assert.equal(fixture.calls.length,0);await fixture.key('preview').click();
  assert.match(fixture.host.textContent,/Før ændringen/);assert.match(fixture.host.textContent,/Efter ændringen/);assert.match(fixture.host.textContent,/31,75/);assert.ok(fixture.key('save'));await fixture.key('save').click();
  assert.equal(fixture.calls.length,1);const captured=fixture.calls[0];assert.equal(captured.personId,'p0');assert.equal(captured.version,4);assert.equal(captured.policyVersion,2);assert.equal(captured.link.from,'2026-10-31');assert.equal(captured.link.groupId,'g1');assert.equal(captured.link.baseMode,'personal');assert.deepEqual(captured.link.excludedPersonalSupplementIds,['personal']);assert.deepEqual(captured.link.supplementOverrides,[{id:'night',mode:'personal',supplement:{...addon(),amountCents:3175}}]);assert.equal(JSON.stringify(raw),beforeRaw);assert.equal(JSON.stringify(data),beforePolicy);assert.match(fixture.host.textContent,/er gemt/);assert.match(fixture.host.textContent,/31,75/);assert.match(fixture.host.textContent,/Personligt beløb/);assert.match(fixture.host.textContent,/Fravalgt/);
});

test('readonly allowance rows disclose inherited, excluded and individually priced rules without hiding personal-extra exclusions',()=>{
  const data=policy();data.groups[0].revisions[0].payroll.supplements.push(addon('off',{name:'Fravalgt regel'}),addon('follow',{name:'Fælles regel'}));data.links[0].supplementOverrides=[{id:'night',mode:'personal',supplement:{...addon(),amountCents:3000}},{id:'off',mode:'off',supplement:null}];data.links[0].excludedPersonalSupplementIds=['personal'];
  const fixture=app({data,canManage:false}),rows=fixture.nodes().filter(item=>item.className==='cs-person-pay-read-rule');assert.equal(rows.length,4);assert.ok(rows.some(row=>row.textContent.includes('Nattillæg')&&row.textContent.includes('30,00')&&row.textContent.includes('Personligt beløb')));assert.ok(rows.some(row=>row.textContent.includes('Fravalgt regel')&&row.textContent.includes('Fravalgt')));assert.ok(rows.some(row=>row.textContent.includes('Fælles regel')&&row.textContent.includes('Fra gruppen')));assert.ok(rows.some(row=>row.textContent.includes('Personlig bonus')&&row.textContent.includes('Fravalgt')));assert.equal(fixture.key('edit'),undefined);
});

test('display and personal amount editing preserve every cent at the safe integer upper boundary',async()=>{
  const data=policy();data.links[0].supplementOverrides=[{id:'night',mode:'personal',supplement:{...addon(),amountCents:Number.MAX_SAFE_INTEGER}}];const fixture=app({data});assert.match(fixture.host.textContent,/90\.071\.992\.547\.409,91/);await fixture.key('edit').click();assert.equal(fixture.key('amount:night').value,'90071992547409,91');await fixture.key('preview').click();await fixture.key('save').click();assert.equal(fixture.calls[0].link.supplementOverrides[0].supplement.amountCents,Number.MAX_SAFE_INTEGER);
});

test('follow/off choices retain whole rule identity and any further edit invalidates the reviewed save',async()=>{
  const fixture=app();await fixture.key('edit').click();await fixture.change('mode:night','off');await fixture.key('preview').click();assert.ok(fixture.key('save'));await fixture.change('base-mode','personal');assert.equal(fixture.key('save'),undefined);await fixture.key('preview').click();await fixture.key('save').click();assert.deepEqual(fixture.calls[0].link.supplementOverrides,[{id:'night',mode:'off',supplement:null}]);
  const next=app();await next.key('edit').click();await next.change('mode:night','off');await next.change('mode:night','follow');await next.key('preview').click();await next.key('save').click();assert.deepEqual(next.calls[0].link.supplementOverrides,[]);
});

test('past dates and another dated group context cannot be written or converted into a new assignment',async()=>{
  const data=policy();data.groups.push(group('g2'));data.links.push(link('2026-11-15','g2'));const fixture=app({data});await fixture.change('date','2026-10-30');assert.equal(fixture.key('edit'),undefined);assert.match(fixture.host.textContent,/skrivebeskyttede/);
  await fixture.change('date','2026-10-31');await fixture.key('edit').click();await fixture.change('date','2026-11-15');await fixture.key('preview').click();assert.match(fixture.host.textContent,/anden løngruppe/);assert.equal(fixture.key('save'),undefined);assert.equal(fixture.calls.length,0);
  await fixture.change('date','2026-10-30');assert.equal(fixture.key('preview').disabled,true);assert.equal(fixture.calls.length,0);
});

test('invalid money blocks a preview and missing personal base is shown explicitly before save',async()=>{
  const fixture=app({raw:pay({agreements:[]})});await fixture.key('edit').click();await fixture.change('mode:night','personal');await fixture.change('amount:night','31.75');await fixture.key('preview').click();assert.match(fixture.host.textContent,/komma/);assert.equal(fixture.key('save'),undefined);
  await fixture.change('amount:night','31,75');await fixture.change('base-mode','personal');assert.match(fixture.host.textContent,/ingen personlig grundløn/);await fixture.key('preview').click();assert.match(fixture.host.textContent,/Grundløn mangler/);assert.match(fixture.host.textContent,/ufuldstændig/);assert.ok(fixture.key('save'));assert.equal(fixture.calls.length,0);
});

test('the viewed agreement follows month context while an open dated draft keeps its selected date and values',async()=>{
  const data=policy();data.groups[0].revisions.push({id:'november',from:'2026-11-01',payroll:{currency:'DKK',agreements:[base(19000)],supplements:[addon()]}});const fixture=app({data});assert.equal(fixture.key('date').value,'2026-10-31');assert.match(fixture.host.textContent,/Aftale pr. dato/);
  fixture.render({contextDate:'2026-11-01'});assert.equal(fixture.key('date').value,'2026-11-01');assert.match(fixture.host.textContent,/190,00/);await fixture.key('edit').click();assert.match(fixture.host.textContent,/Gælder fra/);await fixture.change('mode:night','personal');await fixture.change('amount:night','35,25');fixture.render({contextDate:'2026-12-01'});assert.equal(fixture.key('date').value,'2026-11-01');assert.equal(fixture.key('amount:night').value,'35,25');assert.equal(fixture.calls.length,0);
});

test('incoming versions preserve the draft but block saving until explicit reload',async()=>{
  let fixture;fixture=app({callbacks:{onReload:async()=>fixture.render({policyVersion:3})}});await fixture.key('edit').click();await fixture.change('mode:night','personal');await fixture.change('amount:night','36,25');fixture.render({policyVersion:3});assert.equal(fixture.key('amount:night').value,'36,25');assert.equal(fixture.key('preview').disabled,true);assert.match(fixture.host.textContent,/kladd[e]/);assert.equal(fixture.calls.length,0);await fixture.key('reload').click();assert.equal(fixture.key('amount:night'),undefined);assert.ok(fixture.key('edit'));
});

test('a save conflict retains values for review and changing employee or permission removes the draft',async()=>{
  const fixture=app({callbacks:{onSave:async()=>({ok:false,status:409,conflict:true,error:'Politikken er ændret.'})}});await fixture.key('edit').click();await fixture.change('mode:night','personal');await fixture.change('amount:night','29,25');await fixture.key('preview').click();await fixture.key('save').click();assert.equal(fixture.key('amount:night').value,'29,25');assert.equal(fixture.key('save').disabled,true);assert.match(fixture.host.textContent,/Politikken er ændret/);
  fixture.render({canManage:false});assert.equal(fixture.key('amount:night'),undefined);assert.equal(fixture.key('save'),undefined);fixture.render({person:{id:'p1',name:'Emma'}});assert.match(fixture.host.textContent,/Ingen løngruppe/);assert.equal(fixture.key('save'),undefined);
});

test('a parent render of the accepted policy while saving is not treated as a concurrent conflict',async()=>{
  let fixture;fixture=app({callbacks:{onSave:async payload=>{const next=Groups.normalize({...policy(),links:[link(),payload.link]});fixture.render({policy:next,policyVersion:3});return {ok:true,version:4,policyVersion:3,policy:next};}}});await fixture.key('edit').click();await fixture.change('base-mode','personal');await fixture.key('preview').click();await fixture.key('save').click();assert.match(fixture.host.textContent,/er gemt/);assert.equal(fixture.key('save'),undefined);assert.equal(fixture.key('edit').disabled,false);
});

test('a canonical no-op receipt may keep policyVersion and an unconfirmed no-op cannot dismiss a change',async()=>{
  const data=policy();data.links=[link('2026-10-31')];const valid=app({data,callbacks:{onSave:async()=>({ok:true,version:4,policyVersion:2,policy:data})}});await valid.key('edit').click();await valid.key('preview').click();await valid.key('save').click();assert.match(valid.host.textContent,/er gemt/);
  const invalid=app({data,callbacks:{onSave:async()=>({ok:true,version:4,policyVersion:2,policy:data})}});await invalid.key('edit').click();await invalid.change('base-mode','personal');await invalid.key('preview').click();await invalid.key('save').click();assert.match(invalid.host.textContent,/ikke bekræftes/);assert.equal(invalid.key('save').disabled,true);
});

test('literal private labels are safe and destroying the view ignores a late receipt',async()=>{
  const data=policy();data.groups[0].name='<img src=x onerror=alert(1)>';let resolve;const waiting=new Promise(yes=>resolve=yes),fixture=app({data,callbacks:{onSave:()=>waiting}});assert.match(fixture.host.textContent,/<img src=x/);await fixture.key('edit').click();await fixture.key('preview').click();const saving=fixture.key('save').click();fixture.controller.destroy();resolve({ok:true,version:4,policyVersion:3,policy:data});await saving;assert.equal(fixture.host.textContent,'');
  const context=vm.createContext({CleanRoomsPayroll:Payroll,CleanRoomsPayrollGroups:Groups});vm.runInContext(fs.readFileSync(require.resolve('../src/payroll-person-group-view.js'),'utf8'),context);assert.ok(Object.isFrozen(context.CleanRoomsPayrollPersonGroupView));assert.equal(typeof context.CleanRoomsPayrollPersonGroupView.mount,'function');
});

test('agreement overview keeps the effective base, source and date together and shows only allowances active on the viewed date',()=>{
  const data=policy();data.links=[link('2026-10-15')];data.groups[0].revisions[0].payroll.supplements.push(addon('future',{name:'Fremtidigt tillæg',from:'2026-12-01'}),addon('ended',{name:'Tidligere tillæg',to:'2026-10-01'}));
  const fixture=app({data,raw:pay({supplements:[]}),canManage:false}),summary=fixture.nodes().find(item=>item.className==='cs-person-pay-summary');
  assert.match(summary.textContent,/Grundløn185,50 kr. pr. time/);assert.match(summary.textContent,/LøngruppeStandardgruppen/);assert.match(summary.textContent,/KildeGrundløn fra gruppen/);assert.match(summary.textContent,/Gælder fra15\. okt\. 2026/);
  const rows=fixture.nodes().filter(item=>item.className==='cs-person-pay-read-rule');assert.equal(rows.length,1);assert.match(rows[0].textContent,/Nattillæg/);assert.equal(fixture.host.textContent.includes('Fremtidigt tillæg'),false);assert.equal(fixture.host.textContent.includes('Tidligere tillæg'),false);
});

test('employees without a group still see active personal allowances and individual editing state is reported until cancellation or permission loss',async()=>{
  const none=app({data:{schema:1,groups:[],links:[]}});assert.match(none.host.textContent,/Personlig bonus/);assert.match(none.host.textContent,/Personligt ekstra/);assert.equal(none.key('edit'),undefined);
  const states=[],fixture=app({callbacks:{onEditingChange:active=>states.push(active)}});await fixture.key('edit').click();assert.deepEqual(states,[true]);await fixture.key('cancel').click();assert.deepEqual(states,[true,false]);await fixture.key('edit').click();fixture.render({canManage:false});assert.deepEqual(states,[true,false,true,false]);assert.equal(fixture.key('save'),undefined);
});
