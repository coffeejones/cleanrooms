const test=require('node:test'),assert=require('node:assert/strict');
const View=require('../src/workflow-requests-view.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.listeners={};this.dataset={};this.className='';this.text='';this.value='';this.disabled=false;}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
 async fire(type){for(const handler of this.listeners[type]||[])await handler({target:this,currentTarget:this,preventDefault(){}});}
 async click(){if(!this.disabled)await this.fire('click');}
 matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-workflow-focus]')return !!this.dataset.workflowFocus;return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 contains(node){return walk(this).includes(node);}focus(){this.ownerDocument.activeElement=this;}
}
const request=(patch={})=>({id:'request-a',version:2,kind:'offer',status:'pending',fromPersonId:'emma',toPersonId:'noah',fromName:'Emma Nielsen',toName:'Noah Andersen',shift:{date:'2026-11-04',start:'07:00',end:'15:00',siteName:'Kontor Nord'},...patch});
function fixture(requests=[request()],callbacks={}){
 const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),opened=[],view=View.mount({element:host,onOpenRequest:item=>opened.push(item),...callbacks});view.render({scopeKey:'live-manager',bundle:{requests}});
 const nodes=()=>walk(host),key=value=>nodes().find(el=>el.dataset.workflowFocus===value),byClass=value=>nodes().find(el=>el.className.split(' ').includes(value));
 return {view,host,doc,opened,nodes,key,byClass,rows:()=>nodes().filter(el=>el.className==='cs-requests-row'),input:async value=>{const search=key('search');search.value=value;await search.fire('input');}};
}
test('separate queues distinguish planner decisions, colleague consent and closed requests with accurate counts',async()=>{
 const rows=[request({id:'ready'}),request({id:'accepted',status:'accepted'}),request({id:'blocked',blockedReason:'Overlap'}),request({id:'colleague',status:'awaiting_colleague'}),request({id:'approved',status:'approved'}),request({id:'rejected',status:'rejected'})],sample=fixture(rows);
 assert.equal(sample.key('queue:ready').getAttribute('aria-label'),'Til godkendelse · 3');assert.equal(sample.key('queue:colleague').getAttribute('aria-label'),'Afventer kollega · 1');assert.equal(sample.key('queue:closed').getAttribute('aria-label'),'Afsluttede · 2');assert.equal(sample.key('queue:all').getAttribute('aria-label'),'Alle · 6');assert.equal(sample.rows().length,3);assert.equal(sample.byClass('cs-requests-summary').textContent,'1 kræver afklaring.');
 await sample.key('queue:colleague').click();assert.deepEqual(sample.rows().map(row=>row.dataset.requestId),['colleague']);assert.match(sample.rows()[0].textContent,/Afventer svar/);
 await sample.key('queue:closed').click();assert.deepEqual(sample.rows().map(row=>row.dataset.requestId).sort(),['approved','rejected']);
});
test('a semantic table labels recipient, shift, type, status and one review action',()=>{
 const sample=fixture();assert.deepEqual(sample.byClass('cs-requests-table').querySelector('thead').querySelectorAll('th').map(cell=>cell.textContent),['Medarbejder','Vagt','Type','Status','']);
 const row=sample.rows()[0];assert.equal(row.children[0].textContent,'Noah AndersenFra Emma Nielsen');assert.equal(row.children[1].textContent,'4. nov. · 07:00–15:00Kontor Nord');assert.equal(row.children[2].textContent,'Overdragelse');assert.match(row.children[3].textContent,/Klar til godkendelse/);assert.equal(sample.key('request:request-a').getAttribute('aria-label'),'Gennemgå anmodning for Noah Andersen 4. nov.');assert.equal(sample.host.textContent.includes('Emma Nielsen → Noah Andersen'),false);
 const claim=fixture([request({kind:'claim',toPersonId:'emma',toName:'Emma Nielsen'})]);assert.equal(claim.rows()[0].children[0].textContent,'Emma Nielsen');assert.equal(claim.rows()[0].children[2].textContent,'Ledig vagt');
});
test('blocked or stale pending requests remain reviewable and never imply they are safe to approve',()=>{
 for(const patch of [{blockedReason:'Overlap med en anden vagt.'},{shiftCurrent:false},{canApprove:false},{conflicts:['Godkendt fravær'] }]){const sample=fixture([request(patch)]);assert.equal(sample.byClass('cs-requests-status').textContent,'Kræver afklaring');assert.equal(sample.key('request:request-a').disabled,false);assert.equal(sample.nodes().some(node=>node.tagName==='BUTTON'&&/Godkend|Afvis/.test(node.textContent)),false);}
});
test('search covers the former owner, recipient, worksite and request type without changing the current queue',async()=>{
 const sample=fixture([request({id:'offer'}),request({id:'claim',kind:'claim',fromName:'Sara Ahmed',shift:{date:'2026-11-05',start:'08:00',end:'16:00',siteName:'Klinikken'}})]);
 await sample.input('Emma Nielsen');assert.deepEqual(sample.rows().map(row=>row.dataset.requestId),['offer']);await sample.input('Noah Andersen');assert.equal(sample.rows().length,1);await sample.input('Klinikken');assert.deepEqual(sample.rows().map(row=>row.dataset.requestId),['claim']);await sample.input('Ledig vagt');assert.equal(sample.rows().length,1);await sample.input('ingen');assert.equal(sample.rows().length,0);assert.match(sample.host.textContent,/Ingen anmodninger matcher søgningen/);assert.equal(sample.key('queue:ready').getAttribute('aria-pressed'),'true');
});
test('opening a request passes the current complete object and version, including after a parent refresh',async()=>{
 const original=request(),sample=fixture([original]);await sample.key('request:request-a').click();assert.equal(sample.opened[0],original);
 const updated=request({version:4,blockedReason:'Vagten er ændret'});sample.view.render({bundle:{requests:[updated]}});await sample.key('request:request-a').click();assert.equal(sample.opened[1],updated);assert.equal(sample.opened[1].version,4);
});
test('large queues show twenty rows and scope changes reset filters while same-scope refresh retains them',async()=>{
 const records=Array.from({length:47},(_,index)=>request({id:'request-'+index,toName:'Person '+String(index).padStart(2,'0')})),sample=fixture(records);
 assert.equal(sample.rows().length,20);assert.equal(sample.key('page:prev').disabled,true);await sample.key('page:next').click();assert.equal(sample.rows().length,20);await sample.key('page:next').click();assert.equal(sample.rows().length,7);assert.equal(sample.key('page:next').disabled,true);
 sample.view.render({bundle:{requests:records}});assert.equal(sample.rows().length,7);await sample.input('Person 46');assert.equal(sample.rows().length,1);sample.view.render({bundle:{requests:records}});assert.equal(sample.key('search').value,'Person 46');
 await sample.key('queue:closed').click();sample.view.render({scopeKey:'demo-manager',bundle:{demo:true,requests:records}});assert.equal(sample.key('queue:ready').getAttribute('aria-pressed'),'true');assert.equal(sample.key('search').value,'');assert.equal(sample.rows().length,20);
});
test('loading and disposal cannot dispatch a stale review callback or lose keyboard focus',async()=>{
 const sample=fixture(),old=sample.key('request:request-a');await sample.key('queue:all').click();assert.equal(sample.doc.activeElement.dataset.workflowFocus,'queue:all');await sample.input('Noah');assert.equal(sample.doc.activeElement.dataset.workflowFocus,'search');
 sample.view.render({loading:true});assert.equal(sample.key('search').disabled,true);assert.equal(sample.rows().length,0);sample.view.render({loading:false});assert.equal(sample.key('search').value,'Noah');sample.view.dispose();await old.click();assert.equal(sample.opened.length,0);sample.view.render({bundle:{requests:[request()]}});assert.equal(sample.host.children.length,0);
});
test('refresh failures keep the list and a slower refresh cannot replace newer or another-scope data',async()=>{
 let resolve;const promise=new Promise(done=>resolve=done),sample=fixture([request()],{onRefresh:()=>promise});sample.view.render({bundle:{requests:[request()],revision:4}});const refreshing=sample.key('refresh').click();assert.equal(sample.key('request:request-a').disabled,true);sample.view.render({bundle:{requests:[request({id:'new'})],revision:6}});resolve({ok:true,bundle:{requests:[request({id:'old'})],revision:5}});await refreshing;assert.ok(sample.key('request:new'));assert.equal(sample.key('request:old'),undefined);
 const failed=fixture([request()],{onRefresh:async()=>({ok:false,message:'Forbindelsen mangler.'})});await failed.key('refresh').click();assert.ok(failed.key('request:request-a'));assert.match(failed.host.textContent,/Forbindelsen mangler/);
 let finish;const later=new Promise(done=>finish=done),changed=fixture([request()],{onRefresh:()=>later}),waiting=changed.key('refresh').click();changed.view.render({scopeKey:'new-workspace',bundle:{requests:[request({id:'other'})]}});finish({ok:true,bundle:{requests:[request({id:'old'})]}});await waiting;assert.ok(changed.key('request:other'));assert.equal(changed.key('request:old'),undefined);
});
test('invalid dates and literal untrusted names remain readable without interpreting markup',()=>{
 assert.equal(View.dateLabel('2026-02-31'),'Dato mangler');const sample=fixture([request({toName:'<img src=x onerror=alert(1)>',fromName:'<script>name</script>',shift:{date:'bad',start:'07:00',end:'15:00',siteName:'<b>Kontor</b>'}})]);assert.match(sample.host.textContent,/Dato mangler/);assert.ok(sample.host.textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(sample.nodes().some(node=>['IMG','SCRIPT','B'].includes(node.tagName)),false);
});
