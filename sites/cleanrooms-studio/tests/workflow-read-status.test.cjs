const test=require('node:test'),assert=require('node:assert/strict');
const View=require('../src/workflow-read-status.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.className='';this.text='';this.value='';this.disabled=false;}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
 async fire(type){for(const handler of this.listeners[type]||[])await handler({target:this,currentTarget:this,preventDefault(){}});}
 async click(){if(!this.disabled)return this.fire('click');}
 matches(selector){if(selector[0]==='.')return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-workflow-focus]')return !!this.dataset.workflowFocus;return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 contains(node){return walk(this).includes(node);}focus(){this.ownerDocument.activeElement=this;}
}
const shift=(patch={})=>({id:'shift-1',person:'emma',date:'2026-11-04',start:'07:00',end:'15:00',site:0,siteName:'Kontor Nord',...patch});
const message=(patch={})=>({id:'m1',personId:'emma',personName:'Emma Nielsen',kind:'changed',before:shift(),after:shift({start:'08:00',end:'16:00'}),createdAt:'2026-11-02T12:00:00Z',readAt:null,...patch});
function fixture(deliveries=[],callbacks={}){
 const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),opened=[];
 const view=View.mount({element:host,onOpenMessage:item=>opened.push(item),...callbacks});
 const bundle={deliveries,revision:1};view.render({bundle,scopeKey:'live'});
 const nodes=()=>walk(host),key=value=>nodes().find(el=>el.dataset.workflowFocus===value),byClass=cls=>nodes().find(el=>el.className.split(' ').includes(cls)),rows=()=>byClass('cs-read-table')?.querySelector('tbody')?.children||[];
 return {view,host,opened,nodes,key,byClass,rows,render:patch=>view.render(patch),input:async(value)=>{const input=key('recipients:search');input.value=value;await input.fire('input');}};
}

test('read status groups messages by recipient and counts only people who received messages',()=>{
 const deliveries=[message(),message({id:'m2',readAt:'2026-11-02T12:30:00Z'}),message({id:'m3',personId:'noah',personName:'Noah Andersen',readAt:'2026-11-02T12:40:00Z'})],groups=View.recipients(deliveries);
 assert.equal(groups.length,2);assert.deepEqual(groups.map(group=>[group.id,group.total,group.read,group.unread]),[['emma',2,1,1],['noah',1,1,0]]);assert.equal(groups[0].lastSent,'2026-11-02T12:00:00Z');assert.equal(deliveries[0].readAt,null);
});
test('duplicate message IDs count once, valid read receipts win, and identical names do not merge people',()=>{
 const deliveries=[message({personName:'Alex Hansen'}),message({readAt:'2026-11-02T12:30:00Z',personName:'Alex Hansen'}),message({id:'m2',personId:'noah',personName:'Alex Hansen'})],groups=View.recipients(deliveries);
 assert.equal(groups.length,2);assert.equal(groups.reduce((sum,group)=>sum+group.total,0),2);assert.equal(groups.find(group=>group.id==='emma').unread,0);assert.equal(groups.find(group=>group.id==='noah').unread,1);
});
test('invalid read timestamps remain unread and unknown send times never masquerade as real dates',()=>{
 assert.equal(View.validStamp('2026-02-31T12:00:00Z'),false);assert.equal(View.validStamp('2026-11-02'),false);assert.equal(View.validStamp('nonsense'),false);
 const group=View.recipients([message({personName:'',createdAt:null,readAt:'2026-02-31T12:00:00Z'})])[0];assert.equal(group.name,'Medarbejder uden navn');assert.equal(group.read,0);assert.equal(group.unread,1);assert.equal(group.lastSent,null);assert.equal(View.stamp(group.lastSent),'Ukendt tidspunkt');
});
test('message summaries identify time, date and workplace changes while retaining cancellation context',()=>{
 assert.match(View.changeSummary(message()),/07:00–15:00 → 08:00–16:00/);
 assert.match(View.changeSummary(message({after:shift({date:'2026-11-05'})})),/4.*07:00–15:00 →.*5.*07:00–15:00/);
 assert.match(View.changeSummary(message({after:shift({site:1,siteName:'Klinikken'})})),/Kontor Nord → Klinikken/);
 assert.match(View.changeSummary(message({kind:'cancelled',after:null})),/4.*07:00–15:00.*Kontor Nord/);
});
test('recipient filters show counts with named columns and a compact status instead of repeating messages',async()=>{
 const sample=fixture([message(),message({id:'m2'}),message({id:'m3',personId:'noah',personName:'Noah Andersen',readAt:'2026-11-02T12:30:00Z'})]);
 assert.equal(sample.rows().length,1);assert.equal(sample.rows()[0].dataset.personId,'emma');assert.equal(sample.key('recipients:filter:unread').textContent,'Mangler at læse1');assert.equal(sample.key('recipients:filter:all').textContent,'Alle2');assert.ok(sample.host.textContent.includes('2 ulæste beskeder'));assert.ok(sample.host.textContent.includes('0 af 2 læst'));assert.deepEqual(sample.byClass('cs-read-table').querySelectorAll('th').map(item=>item.textContent),['Medarbejder','Læsestatus','Senest sendt','']);
 await sample.key('recipients:filter:all').click();assert.equal(sample.rows().length,2);await sample.key('recipients:filter:read').click();assert.equal(sample.rows().length,1);assert.ok(sample.host.textContent.includes('Alt læst'));assert.equal(sample.rows()[0].dataset.personId,'noah');
});
test('recipient search narrows names without searching other employees message text',async()=>{
 const sample=fixture([message(),message({id:'noah-message',personId:'noah',personName:'Noah Andersen',summary:'Emma requested this change.'})]);await sample.input('Emma');assert.equal(sample.rows().length,1);assert.equal(sample.rows()[0].dataset.personId,'emma');await sample.input('nobody');assert.equal(sample.rows().length,0);assert.ok(sample.host.textContent.includes('Ingen modtagere matcher'));
});
test('recipient and message pages are bounded to twenty items and search returns to the first page',async()=>{
 const deliveries=Array.from({length:47},(_,index)=>message({id:'m'+index,personId:'person'+index,personName:'Person '+String(index).padStart(2,'0')})),sample=fixture(deliveries);assert.equal(sample.rows().length,20);assert.equal(sample.key('recipients:page:prev').disabled,true);await sample.key('recipients:page:next').click();assert.equal(sample.rows().length,20);await sample.key('recipients:page:next').click();assert.equal(sample.rows().length,7);assert.equal(sample.key('recipients:page:next').disabled,true);await sample.input('Person 46');assert.equal(sample.rows().length,1);assert.ok(sample.key('recipient:person46'));
 const personal=fixture(Array.from({length:25},(_,index)=>message({id:'many'+index})));await personal.key('recipient:emma').click();assert.equal(personal.rows().length,20);await personal.key('messages:page:next').click();assert.equal(personal.rows().length,5);
});
test('a recipient drilldown shows sent and opened timestamps, and only opens the selected message',async()=>{
 const unread=message(),read=message({id:'read',readAt:'2026-11-02T12:30:00Z'}),sample=fixture([unread,read]);await sample.key('recipient:emma').click();assert.equal(sample.rows().length,1);assert.ok(sample.host.textContent.includes('Ikke åbnet'));assert.deepEqual(sample.byClass('cs-read-message-table').querySelectorAll('th').map(el=>el.textContent),['Ændring','Sendt','Åbnet','']);
 await sample.key('messages:filter:all').click();assert.equal(sample.rows().length,2);assert.ok(sample.host.textContent.includes(View.stamp(read.readAt)));await sample.key('delivery:m1').click();assert.equal(sample.opened.length,1);assert.equal(sample.opened[0],unread);assert.equal(unread.readAt,null);assert.equal(sample.nodes().some(el=>el.dataset.workflowFocus==='message:read'),false);
});
test('opening an individual message and parent refresh preserve the selected recipient and filters',async()=>{
 const sample=fixture([message(),message({id:'m2',personId:'noah',personName:'Noah Andersen'})]);await sample.input('Emma');await sample.key('recipient:emma').click();await sample.key('messages:filter:all').click();sample.render({bundle:{deliveries:[message({readAt:'2026-11-02T12:30:00Z'})],revision:2}});assert.ok(sample.byClass('cs-read-message-table'));assert.equal(sample.key('messages:filter:all').getAttribute('aria-pressed'),'true');assert.equal(sample.key('messages:filter:unread').textContent,'Ulæste0');assert.equal(sample.key('messages:filter:all').textContent,'Alle1');await sample.key('recipients:back').click();assert.equal(sample.key('recipients:search').value,'Emma');assert.equal(sample.rows().length,0);assert.ok(sample.host.textContent.includes('Ingen modtagere matcher'));
});
test('scope changes clear the previous recipient and query while stale bundles cannot replace newer ones',async()=>{
 const sample=fixture([message()]);await sample.key('recipient:emma').click();sample.render({scopeKey:'other-workspace',bundle:{deliveries:[message({id:'noah',personId:'noah',personName:'Noah Andersen'})],revision:5}});assert.equal(sample.byClass('cs-read-message-table'),undefined);assert.ok(sample.key('recipient:noah'));sample.render({bundle:{deliveries:[message()],revision:3}});assert.ok(sample.key('recipient:noah'));assert.equal(sample.key('recipient:emma'),undefined);
});
test('a late refresh cannot populate another scope and a removed recipient returns safely to the directory',async()=>{
 let resolve;const sample=fixture([message()],{onRefresh:()=>new Promise(done=>{resolve=done;})});const refreshing=sample.key('readstatus:refresh').click();sample.render({scopeKey:'demo',bundle:{deliveries:[message({id:'demo',personId:'demo-person',personName:'Demo Person'})],revision:3}});resolve({ok:true,bundle:{deliveries:[message()],revision:7}});await refreshing;assert.ok(sample.key('recipient:demo-person'));assert.equal(sample.key('recipient:emma'),undefined);await sample.key('recipient:demo-person').click();sample.render({bundle:{deliveries:[],revision:4}});assert.equal(sample.byClass('cs-read-message-table'),undefined);assert.ok(sample.host.textContent.includes('Ingen beskeder sendt endnu'));
});
test('demo reset scope clears the recipient, loading disables controls, and disposed views never open messages',async()=>{
 const item=message(),sample=fixture([item]);sample.render({bundle:{deliveries:[item],demo:true,demoVersion:1,serverNow:'2026-11-02T12:00:00Z'}});await sample.key('recipient:emma').click();const old=sample.key('delivery:m1');sample.render({bundle:{deliveries:[item],demo:true,demoVersion:2,serverNow:'2026-11-02T13:00:00Z'}});assert.equal(sample.byClass('cs-read-message-table'),undefined);sample.render({loading:true});assert.ok(sample.host.textContent.includes('Henter læsestatus'));sample.render({loading:false});sample.view.dispose();await old.click();assert.equal(sample.opened.length,0);assert.equal(sample.host.children.length,0);
});
