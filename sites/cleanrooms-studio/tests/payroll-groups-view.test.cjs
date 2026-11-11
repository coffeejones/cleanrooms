const test=require('node:test');
const assert=require('node:assert/strict');
const View=require('../src/payroll-groups-view.js');
const Model=require('../src/payroll-groups-model.js');
const walk=node=>[node,...node.children.flatMap(walk)];
let clock;
test.beforeEach(t=>{clock=t.mock.timers;clock.enable({apis:['setTimeout']});});
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.handlers={};this.className='';this.text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;}
  set innerHTML(value){throw Error('Policy text must not become HTML.');}
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
  showModal(){this.open=true;}
  close(){this.open=false;}
}
const blank=()=>({schema:1,groups:[],links:[]});
const pay=(amount=18550,patch={})=>({currency:'DKK',agreements:[{id:'personal-rate',from:'2026-01-01',type:'hourly',amountCents:amount}],supplements:[],...patch});
const rule=(id='night',patch={})=>({id,name:'Nattillæg',type:'hourly',amountCents:3000,from:'2026-01-01',to:null,weekdays:[0,1,2,3,4],start:'22:00',end:'06:00',...patch});
const group=(id='g1',patch={})=>({id,name:'Rengøring',archived:false,revisions:[{id:'revision-'+id,from:'2026-01-01',payroll:pay(17500,{supplements:[rule()]})}],...patch});
const link=(personId,patch={})=>({personId,from:'2026-01-01',groupId:'g1',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[],...patch});
const persons=()=>[{personId:'p0',name:'Jonas Larsen',version:2,payroll:pay(18550,{supplements:[rule('personal-evening')]})},{personId:'p1',name:'Emma Nielsen',version:0,payroll:null}];
function app({policy=blank(),version=1,people=persons(),canView=true,canManage=true,callbacks={}}={}){
  const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc),previews=[],saves=[];let snapshot=Model.normalize(policy),snapshotVersion=version;
  const controller=View.mount({element:host,onPreview:async request=>{previews.push(request);return {ok:true,preview:Model.preview({before:snapshot,after:request.policy,people,date:request.date}),previewToken:'receipt-'+previews.length};},onSave:async request=>{saves.push(request);snapshot=Model.normalize(request.policy);snapshotVersion++;return {ok:true,policy:snapshot,version:snapshotVersion,people,history:[]};},...callbacks});
  const render=patch=>controller.render({policy,version,people,canView,canManage,loading:false,error:'',today:'2026-10-31',...patch});render();const nodes=()=>walk(host),key=value=>nodes().find(node=>node.dataset.paygroupsFocus===value),field=value=>key('field:'+value),byClass=value=>nodes().find(node=>node.className.split(' ').includes(value));
  const input=async(key,value)=>{const control=field(key);assert.ok(control,'field '+key);control.value=value;await control.fire(control.tagName==='SELECT'||control.type==='date'||control.type==='time'?'change':'input');};
  const review=async()=>{clock.tick(320);for(let i=0;i<12;i++)await Promise.resolve();};
  return {host,doc,controller,render,nodes,key,field,byClass,input,review,previews,saves};
}

test('private policy and salary data are absent without view permission; readonly never exposes write actions',()=>{
  const fixture=app({policy:{schema:1,groups:[group('g1',{name:'<img src=x>'})],links:[]},canView:false});assert.ok(fixture.host.textContent.includes('ikke adgang'));assert.equal(fixture.host.textContent.includes('175,00'),false);assert.equal(fixture.nodes().some(node=>node.tagName==='BUTTON'),false);
  fixture.render({canView:true,canManage:false});assert.ok(fixture.host.textContent.includes('<img src=x>'));assert.ok(fixture.host.textContent.includes('175,00'));assert.equal(fixture.key('group:new'),undefined);assert.equal(fixture.saves.length,0);
});

test('group creation has exact Danish cents and requires an authoritative preview token before saving',async()=>{
  const fixture=app();await fixture.key('group:new').click();await fixture.input('group-name','Timeløn');await fixture.input('group-amount','185,50');assert.equal(fixture.key('preview'),undefined);assert.equal(fixture.key('commit').disabled,true);await fixture.review();assert.equal(fixture.key('commit').disabled,false);assert.equal(fixture.saves.length,0);assert.equal(fixture.previews.length,1);assert.equal(fixture.previews[0].version,1);assert.equal(fixture.previews[0].date,'2026-10-31');assert.equal(fixture.previews[0].policy.groups[0].revisions[0].payroll.agreements[0].amountCents,18550);assert.ok(fixture.key('commit'));
  await fixture.key('commit').click();assert.equal(fixture.saves.length,1);assert.equal(fixture.saves[0].previewToken,'receipt-1');assert.equal(fixture.saves[0].version,1);assert.deepEqual(fixture.saves[0].policy,fixture.previews[0].policy);assert.ok(fixture.host.textContent.includes('Ændringen er gemt.'));assert.equal(fixture.doc.activeElement,fixture.key('detail:title'));assert.equal(fixture.key('detail:title').tagName,'H2');
});

test('editing any field invalidates the receipt and repeated previews keep stable raw record IDs',async()=>{
  const fixture=app();await fixture.key('group:new').click();await fixture.input('group-name','Team');await fixture.input('group-amount','190');await fixture.review();const first=fixture.previews[0].policy.groups[0];await fixture.input('group-amount','191,25');assert.equal(fixture.key('commit').disabled,true);await fixture.review();const second=fixture.previews[1].policy.groups[0];assert.equal(second.id,first.id);assert.equal(second.revisions[0].id,first.revisions[0].id);assert.equal(second.revisions[0].payroll.agreements[0].id,first.revisions[0].payroll.agreements[0].id);await fixture.key('commit').click();assert.equal(fixture.saves[0].previewToken,'receipt-2');assert.equal(fixture.saves[0].policy.groups[0].revisions[0].payroll.agreements[0].amountCents,19125);
});

test('a changed draft waits for the old preview and only the newest receipt enables saving',async()=>{
  const waiting=[],fixture=app({callbacks:{onPreview:request=>new Promise(resolve=>waiting.push({request,resolve}))}});
  await fixture.key('group:new').click();
  await fixture.input('group-name','Team');
  await fixture.input('group-amount','190');
  await fixture.review();
  assert.equal(waiting.length,1);
  await fixture.input('group-amount','200');
  await fixture.review();
  assert.equal(waiting.length,1);
  waiting[0].resolve({ok:true,preview:{rows:[]},previewToken:'old'});
  await fixture.review();
  assert.equal(waiting.length,2);
  assert.equal(fixture.key('commit').disabled,true);
  waiting[1].resolve({ok:true,preview:{rows:[]},previewToken:'current'});
  await fixture.review();
  await fixture.key('commit').click();
  assert.equal(fixture.saves.length,1);
  assert.equal(fixture.saves[0].previewToken,'current');
  assert.equal(fixture.saves[0].policy.groups[0].revisions[0].payroll.agreements[0].amountCents,20000);
});

test('new dated revisions preserve older and scheduled future revisions without mutating raw inputs',async()=>{
  const old=group(),future={id:'future',from:'2027-01-01',payroll:pay(21000)};old.revisions.push(future);const policy={schema:1,groups:[old],links:[]},before=JSON.stringify(policy),fixture=app({policy});await fixture.key('group:g1').click();await fixture.key('detail:setup').click();await fixture.key('group:g1:revision').click();await fixture.input('group-from','2026-11-01');await fixture.input('group-amount','195,75');await fixture.review();const revisions=fixture.previews[0].policy.groups[0].revisions;assert.equal(revisions.length,3);assert.deepEqual(revisions[0],Model.normalize(policy).groups[0].revisions[0]);assert.deepEqual(revisions[2],future);assert.equal(revisions[1].payroll.agreements.at(-1).amountCents,19575);assert.equal(revisions[1].payroll.supplements[0].id,'night');assert.equal(JSON.stringify(policy),before);assert.equal(revisions.some(item=>item.id.startsWith('pgb-')),false);
});

test('past periods have no edit action and a new revision cannot backdate or overwrite another date',async()=>{
  const fixture=app({policy:{schema:1,groups:[group()],links:[]}});await fixture.key('group:g1').click();await fixture.key('detail:history').click();assert.equal(fixture.key('revision:revision-g1:edit'),undefined);await fixture.key('detail:setup').click();await fixture.key('group:g1:revision').click();await fixture.input('group-from','2026-01-01');await fixture.input('group-amount','200');await fixture.review();assert.equal(fixture.previews.length,0);assert.ok(fixture.host.textContent.includes('Tidligere perioder kan ikke ændres'));
});

test('group allowance draft supports Monday-first overnight rules and remains raw until group review',async()=>{
  const fixture=app();await fixture.key('group:new').click();await fixture.input('group-name','Nat');await fixture.input('group-amount','185');await fixture.key('allowance:add').click();await fixture.input('allowance-name','Nattearbejde');await fixture.input('allowance-amount','30,25');await fixture.key('allowance:limit').click();await fixture.input('allowance-start','22:00');await fixture.input('allowance-end','06:00');await fixture.key('allowance:store').click();assert.equal(fixture.saves.length,0);assert.ok(fixture.host.textContent.includes('Man, Tir, Ons, Tor, Fre · 22:00–06:00'));await fixture.review();const stored=fixture.previews[0].policy.groups[0].revisions[0].payroll.supplements[0];assert.deepEqual(stored.weekdays,[0,1,2,3,4]);assert.equal(stored.amountCents,3025);assert.equal(stored.end,'06:00');
});

test('assignment preserves existing personal bases and exclusions, uses group base for unconfigured people, clears old-group overrides',async()=>{
  const original={schema:1,groups:[group(),group('g2')],links:[link('p0',{baseMode:'personal',excludedPersonalSupplementIds:['personal-evening'],supplementOverrides:[{id:'night',mode:'off',supplement:null}]})]},before=JSON.stringify(original),fixture=app({policy:original});await fixture.key('tab:assignment').click();await fixture.key('assignment:start').click();await fixture.input('assignment-group','g2');await fixture.key('assignment:person:p0').click();await fixture.key('assignment:person:p1').click();await fixture.review();const candidate=fixture.previews[0].policy,jonas=Model.linkFor(candidate,'p0','2026-10-31'),emma=Model.linkFor(candidate,'p1','2026-10-31');assert.equal(jonas.baseMode,'personal');assert.equal(emma.baseMode,'group');assert.deepEqual(jonas.excludedPersonalSupplementIds,['personal-evening']);assert.deepEqual(jonas.supplementOverrides,[]);assert.equal(candidate.links.filter(item=>item.personId==='p0').length,2);assert.equal(JSON.stringify(original),before);assert.ok(fixture.host.textContent.includes('Personlig grundløn bevares.'));
});

test('explicit group base and dropping personal allowances replace only the same dated snapshot',async()=>{
  const original={schema:1,groups:[group()],links:[link('p0',{from:'2026-10-31',baseMode:'personal',supplementOverrides:[{id:'night',mode:'off',supplement:null}]})]},fixture=app({policy:original});await fixture.key('tab:assignment').click();await fixture.key('assignment:start').click();await fixture.input('assignment-group','g1');await fixture.input('assignment-base','group');await fixture.key('assignment:keep-personal').click();await fixture.key('assignment:person:p0').click();await fixture.review();const links=fixture.previews[0].policy.links;assert.equal(links.length,1);assert.equal(links[0].baseMode,'group');assert.deepEqual(links[0].excludedPersonalSupplementIds,['personal-evening']);assert.deepEqual(links[0].supplementOverrides,[{id:'night',mode:'off',supplement:null}]);
});

test('archiving is a previewed metadata change; archived groups cannot be newly assigned',async()=>{
  const policy={schema:1,groups:[group()],links:[link('p0')]},fixture=app({policy});await fixture.key('group:g1').click();await fixture.key('detail:setup').click();await fixture.key('group:g1:archive').click();assert.equal(fixture.saves.length,0);await fixture.review();assert.equal(fixture.previews[0].policy.groups[0].archived,true);assert.deepEqual(fixture.previews[0].policy.links,policy.links);await fixture.key('commit').click();await fixture.key('detail:close').click();await fixture.key('tab:assignment').click();await fixture.key('assignment:start').click();assert.equal(fixture.field('assignment-group').children.some(node=>node.value==='g1'),false);await fixture.input('assignment-group','g1');await fixture.key('assignment:person:p1').click();await fixture.review();assert.equal(fixture.previews.length,1);assert.ok(fixture.host.textContent.includes('Vælg en aktiv løngruppe'));
});

test('failed or unconfirmed previews never unlock save; 409 retains draft and requires explicit reload',async()=>{
  let fixture;fixture=app({callbacks:{onPreview:async()=>({ok:false,status:409,message:'En anden administrator har ændret gruppen.'}),onReload:async()=>fixture.render({policy:blank(),version:2})}});await fixture.key('group:new').click();await fixture.input('group-name','Mit hold');await fixture.input('group-amount','199,25');await fixture.review();assert.equal(fixture.key('commit').disabled,true);assert.equal(fixture.field('group-amount').value,'199,25');assert.equal(fixture.key('preview'),undefined);assert.equal(fixture.key('commit').disabled,true);assert.ok(fixture.host.textContent.includes('anden administrator'));await fixture.key('reload').click();assert.equal(fixture.field('group-name'),undefined);assert.ok(fixture.key('group:new'));
});

test('failed commits keep exact drafts but consume preview receipts; re-preview is needed for explicit retry',async()=>{
  const writes=[],fixture=app({callbacks:{onSave:async request=>{writes.push(request);return {ok:false,error:'Forbindelsen blev afbrudt.'};}}});await fixture.key('group:new').click();await fixture.input('group-name','Mit hold');await fixture.input('group-amount','199,25');await fixture.review();await fixture.key('commit').click();assert.equal(writes.length,1);assert.equal(fixture.key('commit').disabled,true);assert.equal(fixture.field('group-amount').value,'199,25');await fixture.key('preview').click();await fixture.review();assert.equal(fixture.key('commit').disabled,false);assert.equal(fixture.previews[1].policy.groups[0].id,writes[0].policy.groups[0].id);
});

test('newer snapshots and revoked permissions cannot be replaced by a late successful save',async()=>{
  let resolve;const fixture=app({callbacks:{onSave:()=>new Promise(done=>resolve=done)}});await fixture.key('group:new').click();await fixture.input('group-name','Old draft');await fixture.input('group-amount','190');await fixture.review();const saving=fixture.key('commit').click();const latest={schema:1,groups:[group('latest',{name:'Nyere gruppe'})],links:[]};fixture.render({policy:latest,version:4});resolve({ok:true,version:2,policy:fixture.previews[0].policy});await saving;assert.equal(fixture.field('group-name').value,'Old draft');assert.equal(fixture.key('preview'),undefined);assert.equal(fixture.key('commit').disabled,true);assert.ok(fixture.host.textContent.includes('seneste oplysninger'));
  fixture.render({canView:false,canManage:true});assert.equal(fixture.field('group-name'),undefined);assert.equal(fixture.host.textContent.includes('190,00'),false);fixture.controller.destroy();assert.equal(fixture.host.children.length,0);
});

test('a forbidden API response clears private policy and a readonly permission change ignores a pending preview',async()=>{
  let resolve;const fixture=app({policy:{schema:1,groups:[group()],links:[]},callbacks:{onPreview:()=>new Promise(done=>resolve=done)}});await fixture.key('group:new').click();await fixture.input('group-name','Privat');await fixture.input('group-amount','299');await fixture.review();fixture.render({canManage:false});resolve({ok:true,preview:{rows:[],counts:{}},previewToken:'late'});await fixture.review();assert.equal(fixture.key('commit'),undefined);assert.equal(fixture.field('group-amount'),undefined);
  const denied=app({callbacks:{onPreview:async()=>({ok:false,status:403,message:'Adgang fjernet.'})}});await denied.key('group:new').click();await denied.input('group-name','Privat');await denied.input('group-amount','299');await denied.review();assert.ok(denied.host.textContent.includes('ikke adgang'));assert.equal(denied.host.textContent.includes('299'),false);
});

test('canonical no-op saves may retain their version only when current, receipt and returned policies all match',async()=>{
  const policy={schema:1,groups:[group()],links:[link('p0',{from:'2026-10-31',baseMode:'personal'})]},fixture=app({policy,callbacks:{onSave:async request=>({ok:true,policy:request.policy,version:1})}});await fixture.key('tab:assignment').click();await fixture.key('assignment:start').click();await fixture.input('assignment-group','g1');await fixture.key('assignment:person:p0').click();await fixture.review();await fixture.key('commit').click();assert.ok(fixture.host.textContent.includes('Ingen ændringer at gemme.'));assert.equal(fixture.field('assignment-group'),undefined);
  const rejected=app({callbacks:{onSave:async request=>({ok:true,policy:request.policy,version:1})}});await rejected.key('group:new').click();await rejected.input('group-name','Ny gruppe');await rejected.input('group-amount','199');await rejected.review();await rejected.key('commit').click();assert.equal(rejected.field('group-name').value,'Ny gruppe');assert.equal(rejected.key('preview'),undefined);assert.equal(rejected.key('commit').disabled,true);assert.ok(rejected.host.textContent.includes('Gemningen kunne ikke bekræftes'));
});

test('a parent render of the saved receipt during an in-flight commit does not flash conflict or lose the draft',async()=>{
  let fixture;fixture=app({callbacks:{onSave:async request=>{fixture.render({policy:request.policy,version:2});assert.equal(fixture.host.textContent.includes('Løngrupperne er ændret'),false);return {ok:true,policy:request.policy,version:2};}}});await fixture.key('group:new').click();await fixture.input('group-name','Nyt hold');await fixture.input('group-amount','199');await fixture.review();await fixture.key('commit').click();assert.ok(fixture.host.textContent.includes('Ændringen er gemt.'));assert.equal(fixture.field('group-name'),undefined);
});

test('unaffected employees are collapsed and missing pay for unrelated staff does not become a new-group warning',async()=>{
  const fixture=app({people:[{personId:'p1',name:'Emma',payroll:null,version:0}]});await fixture.key('group:new').click();await fixture.input('group-name','Fremtidig gruppe');await fixture.input('group-amount','190');await fixture.review();assert.ok(fixture.byClass('cs-paygroups-unchanged'));assert.equal(fixture.byClass('cs-paygroups-unchanged').tagName,'DETAILS');assert.equal(fixture.byClass('cs-paygroups-unchanged').open,false);assert.equal(fixture.byClass('cs-paygroups-warning'),undefined);assert.ok(fixture.byClass('cs-paygroups-preview-empty').textContent.includes('Ingen medarbejderaftaler påvirkes'));
});

test('saved past, current and future periods have no editor and a new revision never replaces their identities or dates',async()=>{
  const old=group('g1',{revisions:[{id:'old',from:'2026-01-01',payroll:pay(17500)},{id:'today',from:'2026-10-31',payroll:pay(18000)},{id:'future',from:'2026-12-01',payroll:pay(21000)}]}),policy={schema:1,groups:[old],links:[]},fixture=app({policy});
  await fixture.key('group:g1').click();await fixture.key('detail:history').click();for(const id of ['old','today','future'])assert.equal(fixture.key('revision:'+id+':edit'),undefined);assert.ok(fixture.host.textContent.includes('skrivebeskyttede'));await fixture.key('history:new-change').click();assert.equal(fixture.field('group-from').value,'2026-11-01');await fixture.input('group-from','2026-12-01');await fixture.review();assert.equal(fixture.previews.length,0);assert.ok(fixture.host.textContent.includes('ikke allerede har en lønperiode'));
  await fixture.input('group-from','2026-12-02');await fixture.input('group-amount','31.000,50');await fixture.review();const revisions=fixture.previews[0].policy.groups[0].revisions;assert.equal(revisions.length,4);for(const saved of old.revisions)assert.deepEqual(revisions.find(revision=>revision.id===saved.id),saved);assert.equal(revisions.at(-1).from,'2026-12-02');assert.equal(revisions.at(-1).payroll.agreements.at(-1).amountCents,3100050);
});

const detailPolicy=()=>({schema:1,groups:[group('g1',{name:'Daghold',revisions:[{id:'current',from:'2026-01-01',payroll:pay(17500,{supplements:[rule()]})},{id:'future',from:'2026-12-01',payroll:pay(19000,{supplements:[rule()]})}]}),group('g2',{name:'Teamledere'})],links:[link('p0',{baseMode:'personal'}),link('p1')]});
test('opening a group replaces the directory with a dedicated member page and back restores the overview search',async()=>{
  const fixture=app({policy:detailPolicy()});await fixture.input('group-search','Dag');assert.ok(fixture.key('group:g1'));assert.equal(fixture.key('group:g2'),undefined);await fixture.key('group:g1').click();
  assert.equal(fixture.byClass('cs-paygroups-detail-page')?.className.includes('cs-paygroups-detail-page'),true);assert.equal(fixture.key('group:g1'),undefined);assert.equal(fixture.key('group:new'),undefined);assert.equal(fixture.key('tab:groups'),undefined);assert.equal(fixture.key('detail:title').tagName,'H2');assert.equal(fixture.key('detail:title').textContent,'Daghold');assert.equal(fixture.key('detail:members').getAttribute('aria-pressed'),'true');
  await fixture.key('detail:close').click();assert.equal(fixture.field('group-search').value,'Dag');assert.ok(fixture.key('group:g1'));assert.equal(fixture.key('group:g2'),undefined);assert.equal(fixture.previews.length,0);assert.equal(fixture.saves.length,0);
});
test('member rows show actual personal rates and extras instead of claiming all group-base members follow every allowance',async()=>{
  const personal=persons(),fixture=app({policy:detailPolicy(),people:personal});await fixture.key('group:g1').click();const table=fixture.byClass('cs-paygroups-members-table');
  assert.ok(table.textContent.includes('185,50 kr. / time'));assert.ok(table.textContent.includes('Gruppens sats 175,00 kr. / time → 185,50 kr. / time'));assert.ok(table.textContent.includes('personligt ekstra'));assert.ok(table.textContent.includes('Personlige undtagelser'));assert.ok(table.textContent.includes('Følger gruppen'));
  const rows=fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId);assert.deepEqual(rows.map(row=>[row.dataset.personId,row.dataset.state]),[['p0','personal'],['p1','group']]);assert.ok(fixture.key('members:filter:personal').textContent.endsWith('1'));
  await fixture.key('members:filter:personal').click();assert.deepEqual(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).map(row=>row.dataset.personId),['p0']);await fixture.input('member-search','Emma');assert.ok(fixture.host.textContent.includes('Ingen medarbejdere matcher'));assert.equal(fixture.saves.length,0);
});
test('group allowance amount replacements and opt-outs are named explicitly in the members table',async()=>{
  const people=[{personId:'p0',name:'Freja',payroll:null,version:0},{personId:'p1',name:'Sara',payroll:null,version:0}],policy={schema:1,groups:[group()],links:[link('p0',{supplementOverrides:[{id:'night',mode:'personal',supplement:rule('night',{amountCents:4000})}]}),link('p1',{supplementOverrides:[{id:'night',mode:'off',supplement:null}]})]},fixture=app({policy,people});await fixture.key('group:g1').click();
  const table=fixture.byClass('cs-paygroups-members-table');assert.ok(table.textContent.includes('Gruppen 30,00 kr. / time → 40,00 kr. / time'));assert.ok(table.textContent.includes('Gruppen 30,00 kr. / time → Fravalgt'));assert.equal(fixture.key('members:filter:personal').textContent,'Personlige undtagelser · 2');assert.equal(fixture.key('members:filter:group').textContent,'Følger gruppen · 0');
});
test('inspection dates resolve future group rates while preserving personal exceptions, without any write',async()=>{
  const fixture=app({policy:detailPolicy()});await fixture.key('group:g1').click();assert.ok(fixture.byClass('cs-paygroups-summary-rate').textContent.includes('175,00 kr.'));assert.ok(fixture.host.textContent.includes('Kommende ændring 1. dec. 2026'));
  await fixture.input('reference-date','2026-12-01');assert.ok(fixture.byClass('cs-paygroups-summary-rate').textContent.includes('190,00 kr.'));assert.ok(fixture.byClass('cs-paygroups-members-table').textContent.includes('185,50 kr.'));assert.equal(fixture.previews.length,0);assert.equal(fixture.saves.length,0);assert.equal(fixture.controller.context().date,'2026-12-01');
});
test('opening a person provides restorable group context including filters and reference date',async()=>{
  const opened=[],fixture=app({policy:detailPolicy(),callbacks:{onOpenPerson:(personId,context)=>opened.push({personId,context})}});assert.equal(fixture.controller.openGroup('unknown'),false);assert.equal(fixture.controller.openGroup('g1',{date:'2026-12-01',detail:'members',memberFilter:'personal',memberSearch:'Jonas'}),true);await fixture.key('member:p0').click();
  assert.deepEqual(opened,[{personId:'p0',context:{groupId:'g1',date:'2026-12-01',detail:'members',memberSearch:'Jonas',memberFilter:'personal',memberPage:0,memberPageSize:25}}]);
  const restored=app({policy:detailPolicy()});assert.equal(restored.controller.openGroup(opened[0].context.groupId,opened[0].context),true);assert.equal(restored.field('member-search').value,'Jonas');assert.equal(restored.key('members:filter:personal').getAttribute('aria-pressed'),'true');assert.equal(restored.field('reference-date').value,'2026-12-01');
});
test('assignment launched from a group returns to that group after cancellation or reviewed saving',async()=>{
  const policy=detailPolicy();policy.links=policy.links.filter(link=>link.personId!=='p1');
  const fixture=app({policy});await fixture.key('group:g1').click();await fixture.key('group:g1:assign').click();assert.equal(fixture.byClass('cs-paygroups-dialog').open,true);assert.equal(fixture.field('assignment-group'),undefined);assert.equal(fixture.key('assignment:person:p0'),undefined);await fixture.key('draft:cancel').click();assert.equal(fixture.key('detail:title').textContent,'Daghold');assert.equal(fixture.key('detail:members').getAttribute('aria-pressed'),'true');
  await fixture.key('group:g1:assign').click();await fixture.key('assignment:person:p1').click();await fixture.review();await fixture.key('commit').click();assert.equal(fixture.key('detail:title').textContent,'Daghold');assert.equal(fixture.key('detail:members').getAttribute('aria-pressed'),'true');assert.equal(fixture.byClass('cs-paygroups-table'),undefined);
  assert.equal(Model.linkFor(fixture.saves[0].policy,'p1','2026-10-31').groupId,'g1');
});
test('missing bases have their own status and filter rather than inflating either normal category',async()=>{
  const people=[{personId:'p0',name:'Mangler',version:0,payroll:null}],policy={schema:1,groups:[group()],links:[link('p0',{baseMode:'personal'})]},fixture=app({policy,people});await fixture.key('group:g1').click();assert.equal(fixture.key('members:filter:group').textContent,'Følger gruppen · 0');assert.equal(fixture.key('members:filter:personal').textContent,'Personlige undtagelser · 0');assert.equal(fixture.key('members:filter:missing').textContent,'Mangler grundløn · 1');assert.ok(fixture.byClass('cs-paygroups-warning'));assert.ok(fixture.byClass('cs-paygroups-members-table').textContent.includes('Grundløn mangler'));assert.ok(fixture.byClass('cs-paygroups-members-table').textContent.includes('Ingen gældende grundløn'));assert.equal(fixture.byClass('cs-paygroups-members-table').textContent.includes('Følger gruppens grundløn og alle tillæg'),false);
});
test('readonly details keep date and filter navigation while permission revocation removes every private detail and context',async()=>{
  const fixture=app({policy:detailPolicy(),canManage:false});await fixture.key('group:g1').click();assert.ok(fixture.field('reference-date'));assert.ok(fixture.key('members:filter:personal'));assert.equal(fixture.key('group:g1:assign'),undefined);await fixture.key('detail:setup').click();assert.equal(fixture.key('group:g1:revision'),undefined);assert.equal(fixture.key('group:g1:archive'),undefined);
  fixture.render({canView:false});assert.equal(fixture.key('detail:title'),undefined);assert.equal(fixture.controller.context(),null);assert.equal(fixture.byClass('cs-paygroups-detail-page'),undefined);assert.equal(fixture.host.textContent.includes('185,50'),false);
});

test('a group inspected before its first revision is upcoming rather than active',async()=>{
  const fixture=app({policy:detailPolicy()});fixture.controller.openGroup('g1',{date:'2025-12-31'});assert.ok(fixture.byClass('cs-paygroups-group-header').textContent.includes('Kommende løngruppe'));assert.equal(fixture.byClass('cs-paygroups-group-header').textContent.includes('Aktiv løngruppe'),false);assert.equal(fixture.key('members:filter:all').textContent,'Alle · 0');
});
test('inactive personal replacements and inactive group baselines show their meaning instead of a dash rate',async()=>{
  const people=[{personId:'p0',name:'Senere tillæg',version:0,payroll:null},{personId:'p1',name:'Eget aktivt tillæg',version:0,payroll:null}];
  const current=group('g1',{revisions:[{id:'r1',from:'2026-01-01',payroll:pay(17500,{supplements:[rule('late-own'),rule('late-group',{from:'2026-11-01'})]})}]});
  const policy={schema:1,groups:[current],links:[link('p0',{supplementOverrides:[{id:'late-own',mode:'personal',supplement:rule('late-own',{from:'2026-11-15'})}]}),link('p1',{supplementOverrides:[{id:'late-group',mode:'personal',supplement:rule('late-group',{amountCents:4000})}]})]};
  const fixture=app({policy,people});await fixture.key('group:g1').click();const table=fixture.byClass('cs-paygroups-members-table');assert.ok(table.textContent.includes('Personligt tillæg starter senere · Gruppen 30,00 kr. / time'));assert.ok(table.textContent.includes('Intet aktivt gruppetillæg → 40,00 kr. / time'));assert.equal(table.textContent.includes('— / time'),false);
});

test('unlinked employees without a rate are labelled missing rather than claiming a personal agreement exists',async()=>{
  const fixture=app({people:[{personId:'unlinked',name:'Uden lønaftale',version:0,payroll:null}]});await fixture.key('tab:assignment').click();const assignments=fixture.byClass('cs-paygroups-assignment-list');assert.ok(assignments.textContent.includes('Grundløn mangler'));assert.equal(assignments.textContent.includes('Personlig lønaftale'),false);assert.equal(fixture.saves.length,0);
});

const largePeople=count=>Array.from({length:count},(_,index)=>({personId:'large-'+String(index).padStart(3,'0'),name:'Medarbejder '+String(index).padStart(3,'0'),payroll:null,version:0}));
const tableRows=(fixture,name)=>fixture.nodes().filter(node=>node.tagName==='TR'&&node.className===name);
const pickerRows=fixture=>fixture.nodes().filter(node=>node.className==='cs-paygroups-person-choice');
test('500-person assignment overview renders one bounded page, exposes final people and resets pages when searching or filtering',async()=>{
  const people=largePeople(500),policy={schema:1,groups:[group()],links:people.slice(0,300).map(person=>link(person.personId))},fixture=app({policy,people});await fixture.key('tab:assignment').click();
  assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').length,25);assert.ok(fixture.host.textContent.includes('1–25 af 500 medarbejdere'));assert.equal(fixture.key('assignment-overview:page:first').disabled,true);await fixture.key('assignment-overview:page:last').click();assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').at(-1).dataset.personId,'large-499');assert.ok(fixture.host.textContent.includes('476–500 af 500 medarbejdere'));
  await fixture.input('assignment-overview-search','499');assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').length,1);assert.equal(tableRows(fixture,'cs-paygroups-assignment-row')[0].dataset.personId,'large-499');assert.ok(fixture.host.textContent.includes('1–1 af 1 medarbejdere'));
  await fixture.input('assignment-overview-search','');await fixture.input('assignment-overview-filter-group','g1');assert.ok(fixture.host.textContent.includes('1–25 af 300 medarbejdere'));await fixture.input('assignment-overview-page-size','100');assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').length,100);await fixture.input('assignment-overview-filter-status','unassigned');assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').length,0);assert.equal(fixture.saves.length,0);
});
test('large-team picker preserves explicit selections across pages and filters while bounding every rendered page',async()=>{
  const people=largePeople(500),fixture=app({policy:{schema:1,groups:[group()],links:[]},people});await fixture.key('tab:assignment').click();await fixture.key('assignment:start').click();assert.equal(pickerRows(fixture).length,25);await fixture.key('assignment:person:large-000').click();await fixture.key('assignment:page:last').click();assert.equal(pickerRows(fixture).at(-1).dataset.personId,'large-499');await fixture.key('assignment:person:large-499').click();await fixture.input('assignment-search','Medarbejder 001');assert.equal(pickerRows(fixture).length,1);assert.ok(fixture.host.textContent.includes('2 valgte er uden for det aktuelle filter'));await fixture.key('assignment:select-page').click();await fixture.input('assignment-group','g1');await fixture.review();assert.deepEqual(fixture.previews[0].policy.links.map(link=>link.personId).sort(),['large-000','large-001','large-499']);
  await fixture.input('assignment-search','');assert.equal(fixture.key('commit').disabled,false,'Searching does not alter the reviewed assignment.');await fixture.key('assignment:clear').click();assert.ok(fixture.host.textContent.includes('0 medarbejdere valgt'));assert.equal(fixture.saves.length,0);
});
test('bulk result selection explicitly names its full result count and preview renders at most one person page',async()=>{
  const people=largePeople(500),fixture=app({policy:{schema:1,groups:[group()],links:[]},people});await fixture.key('tab:assignment').click();await fixture.key('assignment:start').click();assert.equal(fixture.key('assignment:select-result').textContent,'Vælg alle 500 i resultatet');assert.ok(fixture.host.textContent.includes('0 medarbejdere valgt'));await fixture.key('assignment:select-result').click();assert.ok(fixture.host.textContent.includes('500 medarbejdere valgt'));await fixture.input('assignment-group','g1');await fixture.review();assert.equal(fixture.previews[0].policy.links.length,500);assert.equal(fixture.nodes().filter(node=>node.className==='cs-paygroups-preview-person').length,25);assert.ok(fixture.host.textContent.includes('500 ændres'));await fixture.key('review:page:last').click();assert.equal(fixture.nodes().filter(node=>node.className==='cs-paygroups-preview-person').length,25);assert.ok(fixture.byClass('cs-paygroups-preview-list').textContent.includes('Medarbejder 499'));assert.equal(fixture.saves.length,0);assert.equal(fixture.key('commit').disabled,false);await fixture.input('review-page-size','50');assert.equal(fixture.nodes().filter(node=>node.className==='cs-paygroups-preview-person').length,50);assert.equal(fixture.key('commit').disabled,false,'Viewing a different review page size keeps its authoritative receipt.');
});
test('unchanged people stay out of preview DOM until explicitly opened, then remain separately paginated',async()=>{
  const fixture=app({people:largePeople(500)});await fixture.key('group:new').click();await fixture.input('group-name','Ny gruppe');await fixture.input('group-amount','185');await fixture.review();assert.equal(fixture.nodes().filter(node=>node.className==='cs-paygroups-preview-person').length,0);const unchanged=fixture.byClass('cs-paygroups-unchanged');unchanged.open=true;await unchanged.fire('toggle');assert.equal(fixture.nodes().filter(node=>node.className==='cs-paygroups-preview-person').length,25);await fixture.key('review-unchanged:page:last').click();assert.equal(fixture.nodes().filter(node=>node.className==='cs-paygroups-preview-person').length,25);assert.ok(fixture.byClass('cs-paygroups-unchanged').textContent.includes('Medarbejder 499'));assert.equal(fixture.previews.length,1);assert.equal(fixture.saves.length,0);
});
test('readonly assignment browsing offers bounded filters and pages but never selection or mutation controls',async()=>{
  const fixture=app({people:largePeople(500),canManage:false});await fixture.key('tab:assignment').click();assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').length,25);assert.ok(fixture.field('assignment-overview-search'));assert.ok(fixture.key('assignment-overview:page:last'));assert.equal(fixture.key('assignment:start'),undefined);assert.equal(fixture.key('assignment:select-page'),undefined);await fixture.key('assignment-overview:page:last').click();assert.equal(tableRows(fixture,'cs-paygroups-assignment-row').at(-1).dataset.personId,'large-499');
});

test('a 500-member group keeps its table bounded and restores page size and page in employee return context',async()=>{
  const people=largePeople(500),policy={schema:1,groups:[group()],links:people.map(person=>link(person.personId))},opened=[],fixture=app({policy,people,callbacks:{onOpenPerson:(personId,context)=>opened.push({personId,context})}});await fixture.key('group:g1').click();assert.equal(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).length,25);await fixture.key('members:page:last').click();assert.equal(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).at(-1).dataset.personId,'large-499');assert.equal(fixture.controller.context().memberPage,19);
  await fixture.input('members-page-size','50');assert.equal(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).length,50);await fixture.key('members:page:last').click();await fixture.key('member:large-499').click();assert.equal(opened[0].context.memberPage,9);assert.equal(opened[0].context.memberPageSize,50);const restored=app({policy,people,callbacks:{onOpenPerson:()=>{}}});restored.controller.openGroup('g1',opened[0].context);assert.equal(restored.controller.context().memberPage,9);assert.equal(restored.field('members-page-size').value,'50');assert.ok(restored.key('member:large-499'));
  await fixture.input('member-search','000');assert.equal(fixture.controller.context().memberPage,0);assert.equal(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).length,1);await fixture.input('member-search','');await fixture.key('members:page:last').click();await fixture.key('members:filter:personal').click();assert.equal(fixture.controller.context().memberPage,0);assert.equal(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).length,0);await fixture.key('members:filter:all').click();await fixture.key('members:page:last').click();await fixture.input('reference-date','2026-11-01');assert.equal(fixture.controller.context().memberPage,0);assert.equal(fixture.saves.length,0);
});
test('readonly large-group members remain paginated and their final member is available without write controls',async()=>{
  const people=largePeople(500),fixture=app({people,policy:{schema:1,groups:[group()],links:people.map(person=>link(person.personId))},canManage:false,callbacks:{onOpenPerson:()=>{}}});await fixture.key('group:g1').click();assert.equal(fixture.nodes().filter(node=>node.tagName==='TR'&&node.dataset.personId).length,25);await fixture.key('members:page:last').click();assert.ok(fixture.key('member:large-499'));assert.equal(fixture.key('group:g1:assign'),undefined);assert.equal(fixture.previews.length,0);assert.equal(fixture.saves.length,0);
});

test('switching one employee starts with that person only and requires reviewed dated reassignment',async()=>{
  const policy={schema:1,groups:[group(),group('g2',{name:'Aftenhold'})],links:[link('p0',{baseMode:'personal',supplementOverrides:[{id:'night',mode:'off',supplement:null}]}),link('p2',{groupId:'g2',baseMode:'personal'})]},fixture=app({policy,people:[...persons(),{personId:'p2',name:'Anden medarbejder',version:1,payroll:pay()}]});
  await fixture.key('group:g1').click();await fixture.key('member:p0:transfer').click();
  assert.equal(fixture.field('assignment-search'),undefined);assert.equal(fixture.key('assignment:person:p0'),undefined);assert.ok(fixture.byClass('cs-paygroups-transfer-person').textContent.includes('Jonas Larsen'));assert.equal(fixture.field('assignment-group').value,' ');assert.equal(fixture.saves.length,0);assert.equal(fixture.key('commit').disabled,true);
  assert.match(fixture.host.textContent,/gamle gruppes tillæg og undtagelser/);await fixture.input('assignment-group','g2');await fixture.input('assignment-from','2026-11-15');await fixture.review();
  const candidate=fixture.previews[0].policy;assert.equal(Model.linkFor(candidate,'p0','2026-11-14').groupId,'g1');assert.equal(Model.linkFor(candidate,'p0','2026-11-15').groupId,'g2');assert.deepEqual(Model.linkFor(candidate,'p0','2026-11-15').supplementOverrides,[]);assert.equal(Model.linkFor(candidate,'p1','2026-11-15'),null);assert.equal(fixture.saves.length,0);
  assert.equal(fixture.byClass('cs-paygroups-preview').textContent.includes('Anden medarbejder'),false);
  assert.equal(fixture.byClass('cs-paygroups-unchanged'),undefined);
  await fixture.key('commit').click();assert.equal(fixture.saves.length,1);assert.equal(fixture.controller.context().groupId,'g1');
});

test('the person-profile assignment entry point cannot bypass permissions or an existing draft',()=>{
  const fixture=app({policy:{schema:1,groups:[group()],links:[link('p0')]},canManage:false});
  assert.equal(fixture.controller.openAssignment('p0'),false);assert.equal(fixture.field('assignment-group'),undefined);
  fixture.render({canManage:true});assert.equal(fixture.controller.openAssignment('unknown'),false);assert.equal(fixture.controller.openAssignment('p0'),true);assert.equal(fixture.controller.openAssignment('p1'),false);assert.equal(fixture.field('assignment-search'),undefined);assert.ok(fixture.byClass('cs-paygroups-transfer-person').textContent.includes('Jonas Larsen'));
});

test('the employee overview opens a profile with an empty group context',async()=>{
  const opened=[],fixture=app({callbacks:{onOpenPerson:(personId,context)=>opened.push({personId,context})}});
  await fixture.key('tab:assignment').click();
  await fixture.key('assignment:open:p0').click();
  assert.deepEqual(opened,[{personId:'p0',context:{}}]);
});
