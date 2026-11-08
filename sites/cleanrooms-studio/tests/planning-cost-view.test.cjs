const test=require('node:test');
const assert=require('node:assert/strict');
const View=require('../src/planning-cost-view.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.handlers={};this.className='';this.text='';this.value='';this.disabled=false;this.hidden=false;}
  set innerHTML(value){throw Error('Wage details must render literal text.');}
  set textContent(value){this.text=String(value);this.children.forEach(child=>child.parentElement=null);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  get isConnected(){return this.connectedRoot||Boolean(this.parentElement?.isConnected);}
  append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];this.text='';this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  fire(type,values={}){const event={target:this,currentTarget:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const handler of this.handlers[type]||[])handler(event);return event;}
  click(){if(!this.disabled){this.focus();this.fire('click');}}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>part.startsWith('.')?node.className.split(' ').includes(part.slice(1)):node.tagName===part.toUpperCase()));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
}
const person=(index=0,patch={})=>({personId:'p'+index,name:'Medarbejder '+index,shiftCount:1,minutes:420,baseCents:140000,supplementCents:5000,totalCents:145000,missingShiftCount:0,monthly:false,fixedSupplement:false,...patch});
const week=(patch={})=>({from:'2026-11-02',to:'2026-11-08',shiftCount:1,totalCents:145000,baseCents:140000,supplementCents:5000,missingShiftCount:0,openShiftCount:0,monthlyPersonCount:0,fixedSupplementPersonCount:0,complete:true,people:[person()],...patch});
function setup(){const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc);host.connectedRoot=true;const trigger=new Element('button',doc);host.append(trigger);trigger.focus();let closes=0;const retries=[];const view=View.mount({element:host,onClose:()=>closes++,onRetry:range=>retries.push(range)});return {host,doc,view,trigger,retries,get closes(){return closes;},get:(cls)=>walk(host).find(node=>node.className.split(' ').includes(cls)),all:cls=>walk(host).filter(node=>node.className.split(' ').includes(cls))};}

test('money keeps exact cents and unknown values never become an invented zero',()=>{
  assert.equal(View.money(1845050),'18.450,50 kr.');assert.equal(View.money(0),'0,00 kr.');assert.equal(View.money(undefined),'—');assert.equal(View.money(-1),'—');assert.equal(View.money(Infinity),'—');
});
test('loading and error details do not show cached salary amounts and retry is explicit',()=>{
  const app=setup();app.view.open({state:'loading',week:week(),scopeLabel:'Nord',trigger:app.trigger});assert.equal(app.view.isOpen,true);assert.match(app.host.textContent,/Beregner/);assert.doesNotMatch(app.host.textContent,/1.450/);assert.equal(app.get('cs-planning-cost-dialog').getAttribute('aria-modal'),'true');
  app.view.update({state:'error',error:'Forbindelsen er afbrudt.'});assert.match(app.host.textContent,/Forbindelsen/);assert.doesNotMatch(app.host.textContent,/1.450/);assert.equal(app.retries.length,0);app.get('cs-planning-cost-retry').click();assert.deepEqual(app.retries,[{from:'2026-11-02',to:'2026-11-08'}]);app.view.destroy();
});
test('ready details are read-only, render literal names, and explain exclusions next to the partial total',()=>{
  const app=setup(),model=week({people:[person(0,{name:'<script>private()</script>',monthly:true,fixedSupplement:true,missingShiftCount:1})],missingShiftCount:1,openShiftCount:2,monthlyPersonCount:1,fixedSupplementPersonCount:1,complete:false});
  app.view.open({state:'ready',week:model,scopeLabel:'Kontor Nord',trigger:app.trigger});assert.match(app.host.textContent,/<script>private\(\)<\/script>/);assert.match(app.host.textContent,/1 vagt mangler lønsats/);assert.match(app.host.textContent,/2 ledige vagter/);assert.match(app.host.textContent,/Fast månedsløn/);assert.match(app.get('cs-planning-cost-total').textContent,/Beregnet del/);assert.equal(app.all('cs-planning-cost-person').length,1);assert.equal(walk(app.host).filter(node=>node.tagName==='INPUT').length,0);assert.match(app.host.textContent,/Pension, feriepenge/);app.view.destroy();
});
test('large wage detail lists paginate and search while preserving the query through fresh totals',()=>{
  const app=setup(),model=week({people:Array.from({length:65},(_,index)=>person(index))});app.view.open({state:'ready',week:model,scopeLabel:'Alle',trigger:app.trigger});assert.equal(app.all('cs-planning-cost-person').length,20);const search=app.get('cs-planning-cost-search');search.value='Medarbejder 6';search.focus();search.setSelectionRange(13,13);search.fire('input');assert.equal(app.all('cs-planning-cost-person').length,6);assert.equal(app.get('cs-planning-cost-search').value,'Medarbejder 6');
  app.view.update({week:{...model,totalCents:200000}});assert.equal(app.all('cs-planning-cost-person').length,6);assert.equal(app.get('cs-planning-cost-search').value,'Medarbejder 6');assert.match(app.get('cs-planning-cost-total').textContent,/2.000,00/);
  app.view.update({scopeLabel:'Andet område'});assert.equal(app.get('cs-planning-cost-search').value,'');assert.equal(app.all('cs-planning-cost-person').length,20);app.view.destroy();
});
test('Escape closes once, restores the opener and destroys without stale retry actions',()=>{
  const app=setup();app.view.open({state:'error',from:'2026-11-02',to:'2026-11-08',scopeLabel:'Nord',trigger:app.trigger});const retry=app.get('cs-planning-cost-retry');const event=app.get('cs-planning-cost-dialog').fire('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(app.view.isOpen,false);assert.equal(app.doc.activeElement,app.trigger);assert.equal(app.closes,1);retry.click();assert.equal(app.retries.length,0);app.view.close();assert.equal(app.closes,1);app.view.destroy();retry.click();assert.equal(app.retries.length,0);assert.equal(app.get('cs-planning-cost-layer'),undefined);
});
test('keyboard focus is trapped within the cost dialog',()=>{
  const app=setup();app.view.open({state:'error',scopeLabel:'Nord'});const panel=app.get('cs-planning-cost-dialog'),first=app.get('cs-planning-cost-close'),last=app.get('cs-planning-cost-retry');first.focus();assert.equal(panel.fire('keydown',{key:'Tab',shiftKey:true}).defaultPrevented,true);assert.equal(app.doc.activeElement,last);assert.equal(panel.fire('keydown',{key:'Tab',shiftKey:false}).defaultPrevented,true);assert.equal(app.doc.activeElement,first);app.view.destroy();
});
test('entirely unknown wages show dashes while valid zero rates, partial estimates and monthly exclusions remain distinct',()=>{
  const app=setup(),unknown=person(0,{baseCents:0,supplementCents:0,totalCents:0,missingShiftCount:1});
  app.view.open({state:'ready',week:week({shiftCount:2,baseCents:0,supplementCents:0,totalCents:0,missingShiftCount:1,openShiftCount:1,complete:false,people:[unknown]}),scopeLabel:'Nord'});
  assert.equal(app.get('cs-planning-cost-total').textContent,'Lønsatser mangler—');assert.equal(app.get('cs-planning-cost-person-total').textContent,'—');
  assert.equal(app.get('cs-planning-cost-table').querySelectorAll('td')[1].textContent,'—');
  app.view.update({week:week({baseCents:0,supplementCents:0,totalCents:0,people:[person(0,{baseCents:0,supplementCents:0,totalCents:0})]})});
  assert.equal(app.get('cs-planning-cost-total').textContent,'Estimeret i alt0,00 kr.');assert.equal(app.get('cs-planning-cost-person-total').textContent,'0,00 kr.');
  app.view.update({week:week({baseCents:0,supplementCents:0,totalCents:0,monthlyPersonCount:1,complete:false,people:[person(0,{baseCents:0,supplementCents:0,totalCents:0,monthly:true})]})});
  assert.equal(app.get('cs-planning-cost-total').textContent,'Beregnet del0,00 kr.');assert.doesNotMatch(app.host.textContent,/Lønsatser mangler/);
  app.view.update({week:week({shiftCount:2,missingShiftCount:1,complete:false,people:[person(),unknown]})});
  assert.equal(app.get('cs-planning-cost-total').textContent,'Beregnet del1.450,00 kr.');app.view.destroy();
});
