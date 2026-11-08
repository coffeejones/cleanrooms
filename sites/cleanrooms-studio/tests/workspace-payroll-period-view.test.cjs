const test=require('node:test');const assert=require('node:assert/strict');const Guide=require('../src/workspace-guide.js');
const walk=element=>[element,...element.children.flatMap(walk)];
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.className='';this.dataset={};this.attributes={};this.handlers={};this.text='';this.value='';this.hidden=false;this.disabled=false;this.classList={add:(...names)=>{this.className=[this.className,...names].filter(Boolean).join(' ');}};}
  set innerHTML(value){throw Error('Render settings as literal text');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  get firstChild(){return this.children[0];}
  append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}
  prepend(...children){for(const child of children.reverse()){child.remove();child.parentElement=this;this.children.unshift(child);}}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];this.text='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  async fire(type){for(const handler of this.handlers[type]||[])await handler({target:this,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));}
  async click(){if(!this.disabled)await this.fire('click');}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>node.tagName===part.toUpperCase()));}
  contains(element){return walk(this).includes(element);}
  focus(){this.ownerDocument.activeElement=this;}
  scrollIntoView(){}
}
function setup({settings={},canEdit=true,save}={}){
  const doc={activeElement:null,createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),saves=[];
  const view=Guide.mount({element:host,onSave:async draft=>{saves.push(draft);return save?save(draft):{ok:true,settings:draft};}});
  const render=next=>view.render({settings,canEdit,sites:[],departments:[],stats:{demoEnabled:false},...next});render();
  const byId=key=>walk(host).find(element=>element.id?.startsWith('cs-workspace-'+key));
  return {host,view,saves,render,mode:()=>byId('payroll-period-mode'),start:()=>byId('payroll-period-start'),preview:()=>byId('payroll-period-preview'),save:()=>byId('settings-save'),clamp:()=>walk(host).find(element=>element.className.includes('cs-settings-payroll-clamp'))};
}
test('legacy settings use the 26th and ordinary identity saves retain period and time budget',async()=>{
  const app=setup({settings:{companyName:'Firma',workHoursBudget:{period:'week',hours:120}}});assert.equal(app.mode().value,'custom');assert.equal(app.start().value,'26');assert.match(app.preview().textContent,/Denne periode: 26.*25/);await app.save().click();assert.deepEqual(app.saves[0].payrollPeriod,{startDay:26});assert.deepEqual(app.saves[0].workHoursBudget,{period:'week',hours:120});app.view.destroy();
});
test('calendar month hides the custom day field and saves startDay one',async()=>{
  const app=setup();app.mode().value='calendar';await app.mode().fire('change');assert.equal(app.start().parentElement.hidden,true);assert.match(app.preview().textContent,/Denne periode: 1\./);await app.save().click();assert.deepEqual(app.saves[0].payrollPeriod,{startDay:1});app.view.destroy();
});
test('a configured 31st is kept, explains short months, and failed saves retain the selection',async()=>{
  let attempts=0;const app=setup({settings:{payrollPeriod:{startDay:31}},save:draft=>++attempts===1?{ok:false,error:'Forbindelsen er afbrudt.'}:{ok:true,settings:draft}});assert.equal(app.start().value,'31');assert.equal(app.clamp().hidden,false);assert.match(app.preview().textContent,/Denne periode:/);await app.save().click();assert.equal(app.start().value,'31');assert.match(app.host.textContent,/Forbindelsen er afbrudt/);await app.save().click();assert.deepEqual(app.saves[1].payrollPeriod,{startDay:31});app.view.destroy();
});
test('read-only settings and invalid injected day values cannot save a payroll period',async()=>{
  const readonly=setup({canEdit:false});assert.equal(readonly.mode().disabled,true);assert.equal(readonly.start().disabled,true);await readonly.save().click();assert.equal(readonly.saves.length,0);readonly.view.destroy();
  const app=setup();app.start().value='32';await app.start().fire('change');await app.save().click();assert.equal(app.saves.length,0);assert.match(app.host.textContent,/mellem 1 og 31/);app.view.destroy();
});
test('unrelated refreshes preserve an in-progress payroll period draft',async()=>{
  const app=setup();app.start().value='15';await app.start().fire('change');app.render({settings:{companyName:'Nyt navn',payrollPeriod:{startDay:26}}});assert.equal(app.start().value,'15');assert.match(app.preview().textContent,/Denne periode: 15.*14/);await app.save().click();assert.deepEqual(app.saves[0].payrollPeriod,{startDay:15});app.view.destroy();
});
test('the period preview uses actual clamped boundaries rather than claiming every 31st ends on the 30th',()=>{
  assert.equal(Guide.payrollPeriodPreview(31,'2026-04-15'),'Denne periode: 31. mar. – 29. apr.');assert.equal(Guide.payrollPeriodPreview(31,'2026-03-15'),'Denne periode: 28. feb. – 30. mar.');assert.equal(Guide.payrollPeriodPreview(1,'2028-02-15'),'Denne periode: 1. feb. – 29. feb.');
});
