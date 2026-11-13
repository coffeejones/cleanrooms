const test=require('node:test'),assert=require('node:assert/strict');
const View=require('../src/shift-workflow-view.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.className='';this.text='';this.value='';this.disabled=false;this.scrollTop=0;}
 append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.text='';this.append(...nodes);}
 set textContent(value){for(const child of this.children)child.parentElement=null;this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
 async fire(type){for(const handler of this.listeners[type]||[])await handler({target:this,currentTarget:this,preventDefault(){}});}
 async click(){if(!this.disabled)return this.fire('click');}
 matches(selector){if(selector[0]==='.')return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-workflow-focus]')return !!this.dataset.workflowFocus;return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 contains(node){return walk(this).includes(node);}focus(){this.ownerDocument.activeElement=this;}
}
const shift=(patch={})=>({id:'shift-a',person:'emma',site:0,date:'2026-11-04',start:'07:00',end:'15:00',siteName:'Kontor Nord',fingerprint:'source-v1',...patch});
const request=(patch={})=>({id:'request-a',version:2,kind:'offer',status:'pending',fromPersonId:'emma',toPersonId:'noah',fromName:'Emma Nielsen',toName:'Noah Andersen',shift:shift(),createdAt:'2026-11-02T12:00:00Z',updatedAt:'2026-11-02T12:00:00Z',comment:'Kan du tage denne vagt?',...patch});
const notification=(patch={})=>({id:'notice-a',personId:'emma',kind:'changed',before:shift(),after:shift({start:'08:00',end:'16:00'}),createdAt:'2026-11-02T12:00:00Z',readAt:null,...patch});
function fixture(props={},callbacks={}){
 const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),calls=[],opened=[];
 const base={personId:'emma',canManage:false,preview:false,notifications:[],requests:[],openShifts:[],ownShifts:[shift()],colleagues:[{id:'noah',name:'Noah Andersen'}],deliveries:[],unreadCount:0};
 const view=View.mount({element:host,onAction:async(action,payload)=>{calls.push({action,payload});return {ok:true};},onOpenShift:(...args)=>opened.push(args),...callbacks});
 view.render({mode:'messages',bundle:{...base,...props.bundle},...props});
 const nodes=()=>walk(host),key=value=>nodes().find(el=>el.dataset.workflowFocus===value),byClass=cls=>nodes().find(el=>el.className.split(' ').includes(cls));
 return {view,host,calls,opened,nodes,key,byClass,render:patch=>view.render(patch),input:async(keyValue,value,event='input')=>{const el=key(keyValue);el.value=value;await el.fire(event);}};
}
test('change summaries name before and after times or dates and retain cancellation context',()=>{
 assert.match(View.summaryFor(notification()),/07:00–15:00 → 08:00–16:00/);
 assert.match(View.summaryFor(notification({after:shift({date:'2026-11-05'})})),/4.*07:00–15:00 →.*5.*07:00–15:00/);
 assert.match(View.summaryFor(notification({kind:'cancelled',after:null})),/07:00–15:00/);
});
test('opening a message marks only that message read after the server accepts it',async()=>{
 const item=notification();const sample=fixture({bundle:{notifications:[item],personId:'emma'}},{onAction:async(action,payload)=>{sample.calls.push({action,payload});return {ok:true,bundle:{notifications:[{...item,readAt:'2026-11-02T12:10:00Z'}],personId:'emma'}};}});
 await sample.key('message:notice-a').click();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(sample.calls,[{action:'workflowReadMessage',payload:{messageId:'notice-a'}}]);assert.ok(sample.host.textContent.includes('08:00–16:00'));assert.equal(sample.key('message:read'),undefined);await sample.key('message:shift').click();assert.equal(sample.opened[0][0],'shift-a');
});
test('a failed read receipt stays unread and can be retried without losing the message',async()=>{
 const sample=fixture({bundle:{notifications:[notification()],personId:'emma'}},{onAction:async()=>({ok:false,status:503,message:'Forbindelsen mangler.'})});await sample.key('message:notice-a').click();await new Promise(resolve=>setImmediate(resolve));assert.ok(sample.host.textContent.includes('Forbindelsen mangler.'));assert.ok(sample.key('message:read'));assert.ok(sample.host.textContent.includes('08:00–16:00'));
});
test('cancelled messages remain readable without a misleading link to an existing shift',async()=>{
 const sample=fixture({bundle:{notifications:[notification({kind:'cancelled',after:null,readAt:'2026-11-02T12:10:00Z'})],personId:'emma'}});await sample.key('message:notice-a').click();assert.ok(sample.host.textContent.includes('Vagten er aflyst'));assert.ok(sample.host.textContent.includes('07:00–15:00'));assert.equal(sample.key('message:shift'),undefined);
});
test('planner employee previews are read-only across messages, claims and offers',async()=>{
 const sample=fixture({bundle:{preview:true,notifications:[notification()],personId:'emma',openShifts:[shift({person:''})]}});await sample.key('message:notice-a').click();assert.equal(sample.calls.length,0);assert.equal(sample.key('message:read'),undefined);
 sample.render({mode:'employee',bundle:{preview:true,personId:'emma',openShifts:[shift({person:''})]}});assert.equal(sample.key('offer:new').disabled,false);await sample.key('open:shift-a').click();assert.equal(sample.key('claim:send').disabled,true);assert.equal(sample.calls.length,0);
});
test('a claim requires the server shift fingerprint and duplicate active claims open their request instead',async()=>{
 const sample=fixture({mode:'employee',bundle:{personId:'emma',openShifts:[shift({person:''})]}});await sample.key('open:shift-a').click();await sample.input('claim:comment','Jeg kan tage vagten.');await sample.key('claim:send').click();assert.deepEqual(sample.calls[0],{action:'workflowRequest',payload:{kind:'claim',shiftId:'shift-a',fingerprint:'source-v1',comment:'Jeg kan tage vagten.'}});
 sample.render({bundle:{personId:'emma',openShifts:[shift({person:''})],requests:[request({kind:'claim',fromPersonId:'emma',toPersonId:'emma'})]}});await sample.key('open:shift-a').click();assert.ok(sample.key('claim:existing'));assert.equal(sample.key('claim:send'),undefined);
});
test('offering a shift validates the selection and sends only the chosen own shift and colleague',async()=>{
 const sample=fixture({mode:'employee'});await sample.key('offer:new').click();await sample.key('offer:send').click();assert.ok(sample.host.textContent.includes('Vælg en vagt og en kollega.'));assert.equal(sample.calls.length,0);
 await sample.input('offer:shift','shift-a','change');await sample.input('offer:person','noah','change');await sample.input('offer:comment','Kan du hjælpe?');await sample.key('offer:send').click();assert.deepEqual(sample.calls[0],{action:'workflowRequest',payload:{kind:'offer',shiftId:'shift-a',toPersonId:'noah',comment:'Kan du hjælpe?',fingerprint:'source-v1'}});
});
test('incoming offers require the recipient response and do not expose planner approval',async()=>{
 const item=request({status:'awaiting_colleague'}),sample=fixture({mode:'employee',bundle:{personId:'noah',requests:[item]}});await sample.key('tab:incoming').click();await sample.key('request:request-a').click();assert.ok(sample.key('request:accept'));assert.equal(sample.key('request:approve'),undefined);await sample.key('request:accept').click();assert.deepEqual(sample.calls[0],{action:'workflowRespond',payload:{requestId:'request-a',version:2,decision:'accept'}});
});
test('planner rejection needs a reason and uses the captured request version',async()=>{
 const sample=fixture({mode:'manager',bundle:{canManage:true,requests:[request()]}});await sample.key('request:request-a').click();await sample.key('request:reject').click();await sample.key('reject:save').click();assert.equal(sample.calls.length,0);assert.ok(sample.host.textContent.includes('Skriv en begrundelse'));
 await sample.input('reject:reason','Vi har brug for den nuværende bemanding.');await sample.key('reject:save').click();assert.deepEqual(sample.calls[0],{action:'workflowDecide',payload:{requestId:'request-a',version:2,decision:'reject',reason:'Vi har brug for den nuværende bemanding.'}});
});
test('an awaiting colleague request or known conflict cannot be approved by a planner',async()=>{
 const sample=fixture({mode:'manager',bundle:{canManage:true,requests:[request({status:'awaiting_colleague'})]}});await sample.key('queue:colleague').click();await sample.key('request:request-a').click();assert.equal(sample.key('request:approve'),undefined);
 sample.render({bundle:{canManage:true,requests:[request({canApprove:false,conflicts:['Overlap med en anden vagt.']})]}});assert.equal(sample.key('request:approve').disabled,true);assert.ok(sample.host.textContent.includes('Overlap med en anden vagt.'));assert.equal(sample.calls.length,0);
});
test('a new version invalidates an open rejection draft and server conflicts preserve readable context',async()=>{
 const sample=fixture({mode:'manager',bundle:{canManage:true,requests:[request()]}},{onAction:async()=>({ok:false,status:409,message:'Vagten er ændret. Hent de seneste oplysninger.'})});await sample.key('request:request-a').click();await sample.key('request:reject').click();await sample.input('reject:reason','En gammel begrundelse');sample.render({bundle:{canManage:true,requests:[request({version:3})]}});assert.equal(sample.key('reject:save'),undefined);assert.ok(sample.host.textContent.includes('Anmodningen er ændret'));await sample.key('request:approve').click();assert.ok(sample.host.textContent.includes('Vagten er ændret. Hent de seneste oplysninger.'));assert.ok(sample.host.textContent.includes('Emma Nielsen'));
});
test('large delivery lists group recipients, paginate and search without marking messages for the planner',async()=>{
 const deliveries=Array.from({length:47},(_,i)=>notification({id:'m-'+i,personId:'person-'+i,personName:'Person '+i,readAt:i%2?'2026-11-02T12:01:00Z':null})),sample=fixture({mode:'manager',bundle:{canManage:true,deliveries}});
 await sample.key('tab:deliveries').click();
 const recipientButtons=()=>sample.nodes().filter(el=>String(el.dataset.workflowFocus||'').startsWith('recipient:'));
 assert.equal(recipientButtons().length,20);assert.ok(sample.key('recipients:page:next'));
 await sample.input('recipients:search','Person 46');assert.equal(recipientButtons().length,1);await sample.key('recipient:person-46').click();assert.ok(sample.key('delivery:m-46'));await sample.key('delivery:m-46').click();
 assert.ok(sample.host.textContent.includes('Person 46'));assert.equal(sample.calls.length,0);assert.equal(sample.key('message:read'),undefined);
 await sample.key('back').click();assert.ok(sample.key('delivery:m-46'));assert.equal(sample.calls.length,0);
});
test('disposed views ignore further renders and mutations',async()=>{
 const sample=fixture({mode:'employee'}),old=sample.key('offer:new');sample.view.dispose();await old.click();sample.render({mode:'manager'});assert.equal(sample.host.children.length,0);assert.equal(sample.calls.length,0);
});
test('request and read-status tabs keep their own useful filters',async()=>{
 const sample=fixture({mode:'manager',bundle:{canManage:true,requests:[],deliveries:[notification()]}});
 assert.equal(sample.key('queue:ready').getAttribute('aria-pressed'),'true');await sample.key('queue:colleague').click();
 await sample.key('tab:deliveries').click();assert.ok(sample.key('recipients:filter:all'));assert.ok(sample.key('recipients:filter:unread'));await sample.key('recipients:filter:all').click();
 await sample.key('tab:requests').click();assert.equal(sample.key('queue:colleague').getAttribute('aria-pressed'),'true');assert.equal(sample.key('queue:ready').getAttribute('aria-pressed'),'false');
});
test('unknown and invalid calendar dates remain unknown and never generate a shift link',async()=>{
 assert.equal(View.dateLabel(undefined),'Dato mangler');assert.equal(View.dateLabel('2026-02-31'),'Dato mangler');assert.ok(View.summaryFor().length>0);
 const sample=fixture({bundle:{personId:'emma',notifications:[notification({after:shift({date:''}),readAt:'2026-11-02T12:01:00Z'})]}});await sample.key('message:notice-a').click();assert.equal(sample.key('message:shift'),undefined);assert.ok(sample.host.textContent.includes('Dato mangler'));
});
test('late responses cannot replace another employee context or retain the previous offer draft',async()=>{
 let resolve;const operation=new Promise(done=>{resolve=done;}),sample=fixture({bundle:{personId:'emma',revision:1,notifications:[notification()]}},{onAction:()=>operation});await sample.key('message:notice-a').click();sample.render({bundle:{personId:'noah',revision:1,notifications:[notification({id:'noah-message',personId:'noah',readAt:'2026-11-02T12:10:00Z'})]}});resolve({ok:true,bundle:{personId:'emma',revision:2,notifications:[notification()]}});await new Promise(done=>setImmediate(done));assert.ok(sample.key('message:noah-message'));assert.equal(sample.key('message:notice-a'),undefined);
 sample.render({mode:'employee',bundle:{personId:'emma',ownShifts:[shift()],colleagues:[{id:'noah',name:'Noah'}]}});await sample.key('offer:new').click();await sample.input('offer:comment','Emma private draft');sample.render({bundle:{personId:'noah',ownShifts:[shift({person:'noah'})],colleagues:[{id:'emma',name:'Emma'}]}});assert.equal(sample.key('offer:comment'),undefined);assert.equal(sample.host.textContent.includes('Emma private draft'),false);
});
test('repeated renders preserve drafts and an older refresh cannot roll back a newer bundle',async()=>{
 const own={personId:'emma',revision:4,ownShifts:[shift()],colleagues:[{id:'noah',name:'Noah'}]},sample=fixture({mode:'employee',bundle:own});await sample.key('offer:new').click();await sample.input('offer:comment','Gem dette udkast');sample.render({bundle:own,loading:true});sample.render({bundle:own,loading:false});assert.equal(sample.key('offer:comment').value,'Gem dette udkast');
 let resolve;const operation=new Promise(done=>{resolve=done;}),refreshSample=fixture({bundle:{personId:'emma',revision:4,notifications:[notification({id:'old'})]}},{onRefresh:()=>operation});const refreshing=refreshSample.key('refresh').click();refreshSample.render({bundle:{personId:'emma',revision:6,notifications:[notification({id:'new',readAt:'2026-11-02T12:01:00Z'})]}});resolve({ok:true,bundle:{personId:'emma',revision:5,notifications:[notification({id:'old'})]}});await refreshing;assert.ok(refreshSample.key('message:new'));assert.equal(refreshSample.key('message:old'),undefined);refreshSample.render({bundle:{personId:'emma',revision:3,notifications:[]}});assert.ok(refreshSample.key('message:new'));
});
test('a server-known obsolete shift blocks acceptance and approval while explaining why',async()=>{
 const item=request({blockedReason:'Vagten er ændret eller er allerede startet.'}),sample=fixture({mode:'manager',bundle:{canManage:true,requests:[item]}});await sample.key('request:request-a').click();assert.equal(sample.key('request:approve').disabled,true);assert.ok(sample.host.textContent.includes(item.blockedReason));assert.ok(sample.key('request:reject'));
 sample.render({mode:'employee',bundle:{personId:'noah',requests:[{...item,status:'awaiting_colleague'}]}});await sample.key('tab:incoming').click();await sample.key('request:request-a').click();assert.equal(sample.key('request:accept').disabled,true);assert.equal(sample.key('request:decline').disabled,false);
});
test('request notifications link to the request before ownership transfers, then to the approved recipient shift',async()=>{
 const item=request({status:'awaiting_colleague'}),notice=notification({kind:'request',requestId:item.id,after:item.shift,readAt:'2026-11-02T12:10:00Z'}),sample=fixture({bundle:{personId:'noah',notifications:[notice],requests:[item]}});await sample.key('message:notice-a').click();assert.equal(sample.key('message:shift'),undefined);assert.ok(sample.key('message:request'));
 sample.render({bundle:{personId:'noah',notifications:[notice],requests:[{...item,status:'approved'}]}});assert.ok(sample.key('message:shift'));sample.render({bundle:{personId:'emma',notifications:[{...notice,personId:'emma'}],requests:[{...item,status:'approved'}]}});await sample.key('message:notice-a').click();assert.equal(sample.key('message:shift'),undefined);assert.ok(sample.key('message:request'));
});

test('preview offers can be inspected while sending remains disabled',async()=>{
 const sample=fixture({mode:'employee',bundle:{preview:true,personId:'emma',ownShifts:[shift()],colleagues:[{id:'noah',name:'Noah'}]}});await sample.key('offer:new').click();assert.ok(sample.key('offer:shift'));await sample.input('offer:shift','shift-a','change');await sample.input('offer:person','noah','change');assert.equal(sample.key('offer:send').disabled,true);await sample.key('offer:send').click();assert.equal(sample.calls.length,0);
});

test('manager review identifies the current and future employee before comment, clarification and decision',async()=>{
 const item=request({blockedReason:'Noah har godkendt fravær på denne dato.'}),sample=fixture({mode:'manager',bundle:{canManage:true,requests:[item]}});
 await sample.key('request:request-a').click();
 const detail=sample.byClass('cs-workflow-request-detail'),people=sample.byClass('cs-workflow-request-people');
 assert.equal(detail.getAttribute('aria-label'),'Anmodningens oplysninger');
 assert.equal(sample.byClass('cs-requests-status').textContent,'Kræver afklaring');
 assert.deepEqual(people.querySelectorAll('dt').map(el=>el.textContent),['Nuværende medarbejder','Overtager vagten']);
 assert.deepEqual(people.querySelectorAll('dd').map(el=>el.textContent),['Emma Nielsen','Noah Andersen']);
 const comment=sample.byClass('cs-workflow-note'),clarification=sample.byClass('cs-workflow-clarification'),decision=sample.byClass('cs-workflow-decision');
 assert.ok(detail.children.indexOf(comment)<detail.children.indexOf(clarification));assert.ok(detail.children.indexOf(clarification)<detail.children.indexOf(decision));
 assert.ok(comment.textContent.includes('Kommentar fra medarbejderen'));assert.ok(clarification.textContent.includes(item.blockedReason));assert.equal(decision.getAttribute('aria-label'),'Næste trin');
 assert.ok(decision.contains(sample.key('request:approve')));assert.ok(decision.contains(sample.key('request:reject')));assert.equal(sample.key('request:approve').disabled,true);assert.equal(sample.calls.length,0);
});

test('a vacant-shift request names the interested employee without implying an existing owner',async()=>{
 const sample=fixture({mode:'manager',bundle:{canManage:true,requests:[request({kind:'claim',fromPersonId:'emma',toPersonId:'emma',shift:shift({person:''})})]}});
 await sample.key('request:request-a').click();const identities=sample.byClass('cs-workflow-request-people');
 assert.deepEqual(identities.querySelectorAll('dt').map(el=>el.textContent),['Ønsker vagten']);assert.deepEqual(identities.querySelectorAll('dd').map(el=>el.textContent),['Emma Nielsen']);
 assert.equal(identities.querySelector('dd').textContent,'Emma Nielsen');assert.equal(sample.calls.length,0);
});

test('returning from a request retains the chosen queue and search while approval uses its refreshed version',async()=>{
 const pending=request(),closed=request({id:'closed',status:'rejected',fromName:'Sara Ahmed',toName:'Emma Nielsen'}),sample=fixture({mode:'manager',bundle:{canManage:true,requests:[pending,closed],revision:2}});
 await sample.key('queue:closed').click();await sample.input('search','Sara');sample.byClass('cs-workflow-body').scrollTop=240;sample.key('request:closed').focus();await sample.key('request:closed').click();await sample.key('back').click();assert.equal(sample.byClass('cs-workflow-body').scrollTop,240);assert.equal(sample.host.ownerDocument.activeElement.dataset.workflowFocus,'request:closed');
 assert.equal(sample.key('queue:closed').getAttribute('aria-pressed'),'true');assert.equal(sample.key('search').value,'Sara');assert.ok(sample.key('request:closed'));assert.equal(sample.key('request:request-a'),undefined);
 await sample.key('queue:ready').click();await sample.input('search','');sample.render({bundle:{canManage:true,requests:[{...pending,version:4},closed],revision:3}});
 await sample.key('request:request-a').click();await sample.key('request:approve').click();assert.deepEqual(sample.calls[0],{action:'workflowDecide',payload:{requestId:'request-a',version:4,decision:'approve'}});
});

test('planner message detail keeps the recipient and receipt separate from the concrete shift change',async()=>{
 const read=notification({id:'read',personName:'Emma Nielsen',readAt:'2026-11-02T12:30:00Z'}),unread=notification({id:'unread',personName:'Emma Nielsen'}),sample=fixture({mode:'manager',bundle:{canManage:true,deliveries:[read,unread]}});
 await sample.key('tab:deliveries').click();await sample.key('recipient:emma').click();await sample.key('messages:filter:all').click();sample.byClass('cs-workflow-body').scrollTop=160;sample.key('delivery:read').focus();await sample.key('delivery:read').click();
 const detail=sample.byClass('cs-workflow-message-detail'),metadata=sample.byClass('cs-workflow-message-metadata'),comparison=sample.byClass('cs-workflow-change-table');
 assert.equal(detail.getAttribute('aria-label'),'Besked og læsestatus');assert.ok(detail.textContent.includes('Emma Nielsen'));assert.deepEqual(metadata.querySelectorAll('dt').map(el=>el.textContent),['Sendt','Åbnet']);
 assert.equal(comparison.querySelector('tbody').children.length,1);assert.deepEqual(comparison.querySelector('tbody').children[0].children.map(el=>el.textContent),['Arbejdstid','07:00–15:00','08:00–16:00']);
 assert.equal(sample.key('message:read'),undefined);assert.equal(sample.calls.length,0);await sample.key('back').click();assert.ok(sample.key('delivery:read'));assert.ok(sample.key('delivery:unread'));assert.equal(sample.key('messages:filter:all').getAttribute('aria-pressed'),'true');assert.equal(sample.byClass('cs-workflow-body').scrollTop,160);assert.equal(sample.host.ownerDocument.activeElement.dataset.workflowFocus,'delivery:read');
});
