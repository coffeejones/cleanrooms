const test=require('node:test'),assert=require('node:assert/strict'),Review=require('../src/review-view.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.handlers={};this.className='';this.text='';this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.tabIndex=0;}
  set textContent(value){this.text=String(value);this.replaceChildren();}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('No HTML parsing');}
  get options(){return this.tagName==='SELECT'?this.children:undefined;}
  get isConnected(){return this===this.ownerDocument.body||Boolean(this.parentElement?.isConnected);}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];if(children.length)this.text='';this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  fire(type,patch={}){return Promise.all((this.handlers[type]||[]).map(handler=>handler({target:this,currentTarget:this,preventDefault(){},stopPropagation(){},...patch})));}
  click(){if(this.disabled)return Promise.resolve();this.focus();return this.fire('click');}
  focus(){if(!this.disabled)this.ownerDocument.activeElement=this;}
  contains(node){return walk(this).includes(node);}
  matches(selector){const cls=selector.match(/\.([\w-]+)/)?.[1],id=selector.match(/#([\w-]+)/)?.[1],tag=selector.match(/^[a-z]+/i)?.[0];return (!cls||this.className.split(' ').includes(cls))&&(!id||this.id===id)&&(!tag||this.tagName===tag.toUpperCase());}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>node.matches(part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
function fixture(){const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('div');doc.body.id='cleanrooms-studio';const host=doc.createElement('main');doc.body.append(host);const findLabel=label=>walk(doc.body).find(node=>node.getAttribute('aria-label')===label),button=label=>walk(doc.body).find(node=>node.tagName==='BUTTON'&&node.textContent===label);return {doc,host,findLabel,button};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const entry=(id,summary=id)=>({id,at:'2026-11-02T08:00:00.000Z',kind:'save',actor:{userId:'admin',name:'Planlægger'},summary});
const response=(entries,patch={})=>({ok:true,entries,hasMore:false,nextCursor:null,...patch});
const request={id:'leave-1',name:'Søren Jensen',initials:'SJ',status:'pending',type:'Ferie',days:['2026-11-03'],dates:'3. november'};

test('absence rejection requires a reason, submits it literally and returns focus after success',async()=>{
  const f=fixture(),decisions=[],view=Review.mountLeave({element:f.host,onDecision:async(...args)=>{decisions.push(args);return {ok:true};}});view.render({requests:[request],canDecide:true});await f.button('Afvis').click();const reason=f.findLabel('Begrundelse for afvisning');await f.button('Afvis anmodning').click();assert.equal(decisions.length,0);assert.equal(f.doc.activeElement,reason);reason.value='  Ferieønsket overlapper allerede aftalt fri. <script>  ';await f.button('Afvis anmodning').click();assert.deepEqual(decisions,[['leave-1','rejected','Ferieønsket overlapper allerede aftalt fri. <script>']]);assert.equal(Boolean(f.doc.body.querySelector('.cs-review-modal')),false);assert.equal(f.doc.activeElement,f.button('Afvis'));
});

test('leaving Fravær removes an open rejection modal even while the decision is pending',async()=>{
  const f=fixture();let resolve;const view=Review.mountLeave({element:f.host,onDecision:()=>new Promise(done=>resolve=done)});view.render({requests:[request],canDecide:true});await f.button('Afvis').click();f.findLabel('Begrundelse for afvisning').value='Bemanning mangler';const saving=f.button('Afvis anmodning').click();view.destroy();assert.equal(Boolean(f.doc.body.querySelector('.cs-review-modal')),false);resolve({ok:false,error:'Ingen adgang'});await saving;assert.equal(f.host.children.length,0);assert.equal(Boolean(f.doc.body.querySelector('.cs-review-modal')),false);
});

test('invalidating history dates prevents an older pending query from rendering stale records',async()=>{
  const f=fixture(),waiting=[];const view=Review.mountHistory({element:f.host,onQuery:query=>new Promise(resolve=>waiting.push({query,resolve}))});view.render({people:[]});await settle();f.findLabel('Historik fra dato').value='2026-11-10';f.findLabel('Historik til dato').value='2026-11-01';await f.findLabel('Historik til dato').fire('change');waiting[0].resolve(response([entry('stale-record')]));await settle();assert.equal(f.host.textContent.includes('stale-record'),false);assert.match(f.host.textContent,/Fra-dato skal være før til-dato/);
});

test('a failed new history filter cannot keep the old cursor available for pagination',async()=>{
  const f=fixture(),queries=[];let count=0;const view=Review.mountHistory({element:f.host,onQuery:async query=>{queries.push(query);return ++count===1?response([entry('old-filter-record')],{hasMore:true,nextCursor:'old-cursor'}):{ok:false,message:'Forbindelsen blev afbrudt'};}});view.render({people:[]});await settle();assert.equal(f.button('Vis flere').hidden,false);f.findLabel('Område').value='hours';await f.findLabel('Område').fire('change');await settle();const more=f.button('Vis flere');assert.ok(more.hidden||more.disabled,'Old cursor must not be usable under the new filters');assert.equal(f.host.textContent.includes('old-filter-record'),false);assert.equal(queries[1].cursor,null);
});

test('a failed restore is handled without an unhandled rejection and unlocks its action',async()=>{
  const f=fixture(),view=Review.mountHistory({element:f.host,onQuery:async()=>response([{...entry('restorable'),recoverable:true}]),onRestore:async()=>{throw Error('Connection lost');}});view.render({people:[],canRestore:true});await settle();await assert.doesNotReject(()=>f.button('Fortryd ændring').click());assert.equal(f.button('Fortryd ændring').disabled,false);assert.match(f.host.textContent,/kunne ikke/);
});

test('revoking absence decision permission closes the modal and a late response cannot steal focus',async()=>{
  const f=fixture();let resolve;const view=Review.mountLeave({element:f.host,onDecision:()=>new Promise(done=>resolve=done)});view.render({requests:[request],canDecide:true});await f.button('Afvis').click();f.findLabel('Begrundelse for afvisning').value='Vi mangler en afløser';const saving=f.button('Afvis anmodning').click();view.render({canDecide:false});assert.equal(Boolean(f.doc.body.querySelector('.cs-review-modal')),false);const search=f.findLabel('Søg medarbejder');search.focus();resolve({ok:true});await saving;assert.equal(f.doc.activeElement,search);assert.equal(f.button('Afvis'),undefined);
});

test('history details retain literal absence reasons and authoritative decision attribution',async()=>{
  const f=fixture(),reason='Der mangler en afløser.\n<script>Dette er tekst</script>',view=Review.mountHistory({element:f.host,onQuery:async()=>response([{...entry('leave-change'),changes:[{field:'requests',id:'leave-1',before:'pending',after:'rejected',decision:{status:'rejected',reason,decidedBy:{name:'Jonas Hansen'},decidedAt:'2026-11-02T08:00:00.000Z'}}]}])});view.render({people:[]});await settle();assert.ok(f.host.textContent.includes(reason));assert.match(f.host.textContent,/Jonas Hansen/);assert.match(f.host.textContent,/09\.00/);
});

test('generic rejection supports forced cleanup during a save outside the leave page',async()=>{
  const f=fixture();let resolve;const modal=Review.rejection({element:f.host,request,onDecision:()=>new Promise(done=>resolve=done)});f.findLabel('Begrundelse for afvisning').value='Ingen afløser';const saving=f.button('Afvis anmodning').click();modal.close();assert.equal(modal.closed,false);modal.close({force:true,restoreFocus:false});assert.equal(modal.closed,true);assert.equal(Boolean(f.doc.body.querySelector('.cs-review-modal')),false);resolve({ok:false,error:'Forsinket fejl'});await saving;assert.equal(Boolean(f.doc.body.querySelector('.cs-review-modal')),false);
});

test('a restore response after navigation is ignored instead of reloading a destroyed history view',async()=>{
  const f=fixture();let resolve,count=0;const view=Review.mountHistory({element:f.host,onQuery:async()=>{count++;return response([{...entry('restorable'),recoverable:true}]);},onRestore:()=>new Promise(done=>resolve=done)});view.render({people:[],canRestore:true});await settle();const restoring=f.button('Fortryd ændring').click();view.destroy();resolve({ok:true});await restoring;assert.equal(count,1);assert.equal(f.host.children.length,0);
});

test('collapsed history filters retain visible active filters and remove them without a stale cursor',async()=>{
  const f=fixture(),queries=[],view=Review.mountHistory({element:f.host,onQuery:async query=>{queries.push(query);return response([entry('filtered')]);}});view.render({people:[]});await settle();
  const panel=f.host.querySelector('.cs-review-extra-filters');assert.equal(panel.hidden,true);await f.button('Filtre').click();assert.equal(panel.hidden,false);
  f.findLabel('Historik fra dato').value='2026-11-02';await f.findLabel('Historik fra dato').fire('change');await settle();await f.button('Luk filtre').click();assert.equal(panel.hidden,true);assert.equal(queries.at(-1).filters.from,'2026-11-02');
  const chip=f.host.querySelector('.cs-review-filter-chip');assert.ok(chip);assert.match(chip.getAttribute('aria-label'),/^Fjern filter: Fra /);await chip.click();await settle();assert.equal(queries.at(-1).filters.from,undefined);assert.equal(queries.at(-1).cursor,null);assert.equal(f.host.querySelector('.cs-review-filter-chips').hidden,true);
});

test('the compact absence period control preserves its filter when closed and resets it explicitly',async()=>{
  const f=fixture(),view=Review.mountLeave({element:f.host,onDecision:async()=>({ok:true})});view.render({requests:[request],canDecide:true});const panel=f.host.querySelector('.cs-review-extra-filters');assert.equal(panel.hidden,true);
  await f.findLabel('Filtrér fravær efter periode').click();assert.equal(panel.hidden,false);f.findLabel('Fravær fra dato').value='2026-12-01';await f.findLabel('Fravær fra dato').fire('change');await f.button('Luk periode').click();assert.equal(panel.hidden,true);assert.match(f.host.textContent,/Ingen anmodninger matcher/);await f.button('Nulstil').click();assert.equal(f.findLabel('Fravær fra dato').value,'');assert.ok(f.button('Afvis'));
});

const leaveResponse=(requests,patch={})=>({ok:true,requests,counts:{pending:requests.length,approved:0,rejected:0,all:requests.length},hasMore:false,nextCursor:null,...patch});

test('server absence filters call the real query callback with flat filters and authoritative counts instead of filtering the initial snapshot',async()=>{
  const f=fixture(),queries=[],serverRequest={...request,id:'server-request',name:'Server Anna'},view=Review.mountLeave({element:f.host,onQuery:async query=>{queries.push(query);return leaveResponse([serverRequest],{counts:{pending:150,approved:7,rejected:2,all:159}});}});
  await view.render({server:true,contextKey:'company-a/user-a',refreshKey:0,requests:[{...request,name:'Local-only demo'}],canDecide:false});assert.deepEqual(queries[0],{status:'pending',cursor:null,limit:40});assert.match(f.host.textContent,/Afventer 150/);assert.equal(f.host.textContent.includes('Local-only demo'),false);assert.match(f.host.textContent,/Server Anna/);
  f.findLabel('Fraværstype').value='Sygdom';await f.findLabel('Fraværstype').fire('change');assert.equal(queries.at(-1).type,'Sygdom');assert.equal(queries.at(-1).cursor,null);
  f.findLabel('Søg medarbejder').value='Anna';await f.findLabel('Søg medarbejder').fire('input');await new Promise(resolve=>setTimeout(resolve,210));assert.equal(queries.at(-1).q,'Anna');assert.equal(queries.at(-1).type,'Sygdom');
  await view.render({server:true,contextKey:'company-a/user-a',refreshKey:0,requests:[]});const before=queries.length;await view.render({refreshKey:1});assert.equal(queries.length,before+1);view.destroy();
});

test('server absence paging keeps one page at a time and previous/next use server cursors rather than retaining the full history',async()=>{
  const f=fixture(),queries=[],view=Review.mountLeave({element:f.host,onQuery:async query=>{queries.push(query);return query.cursor==='page-two'?leaveResponse([{...request,id:'second',name:'Second page'}],{hasMore:true,nextCursor:'page-three',counts:{pending:3,approved:0,rejected:0,all:3}}):leaveResponse([{...request,id:'first',name:'First page'}],{hasMore:true,nextCursor:'page-two',counts:{pending:3,approved:0,rejected:0,all:3}});}});
  await view.render({server:true,contextKey:'a',refreshKey:0});await f.button('Næste').click();assert.equal(queries.at(-1).cursor,'page-two');assert.match(f.host.textContent,/Second page/);assert.equal(f.host.textContent.includes('First page'),false);assert.match(f.host.textContent,/2–2 af 3/);
  await f.button('Forrige').click();assert.equal(queries.at(-1).cursor,null);assert.match(f.host.textContent,/First page/);assert.equal(f.host.textContent.includes('Second page'),false);view.destroy();
});

test('a late absence query cannot repopulate another account, a local demo or a destroyed view',async()=>{
  const f=fixture(),waiting=[],view=Review.mountLeave({element:f.host,onQuery:query=>new Promise(resolve=>waiting.push({query,resolve}))});
  const first=view.render({server:true,contextKey:'company-a/user-a',refreshKey:0});const second=view.render({server:true,contextKey:'company-b/user-b',refreshKey:0});waiting[0].resolve(leaveResponse([{...request,name:'SECRET COMPANY A'}]));await first;assert.equal(f.host.textContent.includes('SECRET COMPANY A'),false);
  waiting[1].resolve(leaveResponse([{...request,name:'Company B'}]));await second;assert.match(f.host.textContent,/Company B/);
  const pending=view.refresh();view.render({server:false,contextKey:'demo',requests:[{...request,name:'Local demo'}]});waiting[2].resolve(leaveResponse([{...request,name:'LATE SERVER DATA'}]));await pending;assert.match(f.host.textContent,/Local demo/);assert.equal(f.host.textContent.includes('LATE SERVER DATA'),false);
  const last=view.render({server:true,contextKey:'company-b/user-b',refreshKey:1});view.destroy();waiting[3].resolve(leaveResponse([{...request,name:'AFTER DESTROY'}]));await last;assert.equal(f.host.children.length,0);
});

test('invalid absence dates invalidate older queries, and a failed filter removes its old cursor until explicit retry',async()=>{
  const f=fixture(),waiting=[],view=Review.mountLeave({element:f.host,onQuery:query=>new Promise(resolve=>waiting.push({query,resolve}))});
  const first=view.render({server:true,contextKey:'a'});f.findLabel('Fravær fra dato').value='2026-11-10';f.findLabel('Fravær til dato').value='2026-11-01';await f.findLabel('Fravær til dato').fire('change');waiting[0].resolve(leaveResponse([{...request,name:'STALE DATE RESULT'}],{hasMore:true,nextCursor:'old-cursor'}));await first;assert.equal(waiting.length,1);assert.equal(f.host.textContent.includes('STALE DATE RESULT'),false);assert.match(f.host.textContent,/Fra-dato skal være før til-dato/);
  f.findLabel('Fravær til dato').value='2026-11-30';const corrected=f.findLabel('Fravær til dato').fire('change');waiting[1].resolve(leaveResponse([request],{hasMore:true,nextCursor:'valid-cursor'}));await corrected;
  f.findLabel('Fraværstype').value='Sygdom';const failure=f.findLabel('Fraværstype').fire('change');waiting[2].resolve({ok:false,message:'Forbindelsen blev afbrudt'});await failure;assert.equal(f.host.textContent.includes(request.name),false);assert.equal(f.button('Næste'),undefined);assert.match(f.host.textContent,/Forbindelsen blev afbrudt/);
  const retry=f.button('Opdater').click();assert.equal(waiting[3].query.cursor,null);assert.equal(waiting[3].query.type,'Sygdom');waiting[3].resolve(leaveResponse([]));await retry;view.destroy();
});

test('a server-page decision uses the request identity and refreshes the pending list after the saved result',async()=>{
  const f=fixture(),decisions=[],queries=[];let saved=false;const view=Review.mountLeave({element:f.host,onDecision:async(...args)=>{decisions.push(args);saved=true;return {ok:true};},onQuery:async query=>{queries.push(query);return saved?leaveResponse([],{counts:{pending:0,approved:1,rejected:0,all:1}}):leaveResponse([{...request,id:'old-history-page',version:8}]);}});
  await view.render({server:true,contextKey:'a',canDecide:true});await f.button('Godkend').click();assert.deepEqual(decisions,[['old-history-page','approved','']]);assert.equal(queries.length,2);assert.equal(f.button('Godkend'),undefined);assert.match(f.host.textContent,/Godkendt 1/);view.destroy();
});

test('a stale absence continuation restarts at the first page once with the same filters and matching pagination labels',async()=>{
 const f=fixture(),queries=[];let firstReads=0;const view=Review.mountLeave({element:f.host,onQuery:async query=>{queries.push(query);if(query.cursor)return {ok:false,status:409,message:'Directory changed'};firstReads++;return leaveResponse([{...request,name:'Generation '+firstReads}],{hasMore:true,nextCursor:'continuation-'+firstReads,counts:{pending:5,approved:0,rejected:0,all:5}});}});
 await view.render({server:true,contextKey:'account-a'});f.findLabel('Fraværstype').value='Ferie';await f.findLabel('Fraværstype').fire('change');await f.button('Næste').click();assert.equal(queries.at(-2).cursor,'continuation-2');assert.equal(queries.at(-1).cursor,null);assert.equal(queries.at(-1).type,'Ferie');assert.match(f.host.textContent,/Generation 3/);assert.match(f.host.textContent,/1–1 af 5/);assert.equal(f.button('Forrige').disabled,true);view.destroy();
});
