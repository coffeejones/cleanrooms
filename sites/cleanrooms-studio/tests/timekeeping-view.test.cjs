const test=require('node:test'),assert=require('node:assert/strict');globalThis.CleanRoomsTimekeeping=require('../src/timekeeping-model.js');const View=require('../src/timekeeping-view.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.className='';this.text='';this.value='';this.checked=false;this.disabled=false;this.scrollTop=0;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].filter(Boolean).join(' ');}};}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
 async fire(type){for(const handler of this.listeners[type]||[])await handler({target:this,currentTarget:this,preventDefault(){}});}
 async click(){if(!this.disabled)return this.fire('click');}
 matches(selector){if(selector[0]==='.')return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-time-focus]')return !!this.dataset.timeFocus;return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>node.matches(part.trim())));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 contains(node){return walk(this).includes(node);}focus(){this.ownerDocument.activeElement=this;}
}
const entry=(patch={})=>({id:'time-1',version:2,shiftId:'shift-1',personId:'emma',date:'2026-11-02',site:0,plannedStart:'07:00',plannedEnd:'15:00',start:'07:00',end:'15:00',breakMinutes:30,workedMinutes:450,plannedMinutes:480,deltaMinutes:-30,status:'submitted',flags:[],...patch});
function app(props={},callbacks={}){
 const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),calls=[];
 let controller;const initial={entries:[entry()],people:[{id:'emma',name:'Emma Nielsen',initials:'EN'}],sites:[{name:'Kontor Nord'}],canManage:true,canViewPayroll:true,...props};
 controller=View.mount({element:host,onAction:async(action,payload)=>{calls.push({action,payload});return {ok:true,entry:entry({status:payload.operation==='approve'?'approved':'submitted',version:payload.version+1})};},...callbacks});
 controller.render(initial);const nodes=()=>walk(host),key=value=>nodes().find(el=>el.dataset.timeFocus===value),byText=value=>nodes().find(el=>el.tagName==='BUTTON'&&el.textContent===value),byClass=value=>nodes().find(el=>el.className.split(' ').includes(value));
 return {controller,host,calls,nodes,key,byText,byClass,render:patch=>controller.render(patch),input:async(name,value)=>{const input=key('field:'+name);input.value=value;await input.fire('input');}};
}
test('approval eligibility excludes incomplete, non-submitted and overlapping records',()=>{
 assert.equal(View.approvable(entry()),true);assert.equal(View.approvable(entry({end:null,status:'running'})),false);assert.equal(View.approvable(entry({flags:['overlap']})),false);assert.equal(View.approvable(entry({status:'approved'})),false);assert.equal(View.approvable(entry({workedMinutes:0})),false);
});
test('salary values are absent from every rendered surface without payroll permission',async()=>{
 const salary={totalCents:99999123,baseCents:99999000,supplementCents:123,sourceLabel:'Private lønaftale',monthlyBaseCents:3450000};
 const fixture=app({entries:[entry({payroll:salary})],canViewPayroll:false});assert.equal(fixture.byText('Løngrundlag'),undefined);await fixture.key('inspect:time-1').click();assert.equal(fixture.host.textContent.includes('Private lønaftale'),false);assert.equal(fixture.host.textContent.includes('999.991'),false);assert.equal(fixture.byClass('cs-time-pay-detail'),undefined);
});
test('approval is explicit, uses captured entry version and locks correction until reopening',async()=>{
 const fixture=app();assert.equal(fixture.calls.length,0);await fixture.key('inspect:time-1').click();assert.equal(fixture.calls.length,0);await fixture.key('entry:approve').click();assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].action,'timeWrite');assert.equal(fixture.calls[0].payload.operation,'approve');assert.equal(fixture.calls[0].payload.version,2);assert.equal(fixture.calls[0].payload.entryId,'time-1');assert.equal(fixture.key('entry:edit'),undefined);assert.ok(fixture.key('entry:reopen'));
});
test('corrections require a reason, retain failed drafts and block stale versions before dispatch',async()=>{
 const fixture=app({}, {onAction:async()=>({ok:false,status:503,message:'Forbindelsen mangler.'})});await fixture.key('inspect:time-1').click();await fixture.key('entry:edit').click();await fixture.key('draft:save').click();assert.ok(fixture.host.textContent.includes('begrundelse'));await fixture.input('reason','Medarbejderen glemte at stemple ud.');await fixture.input('end','15:30');await fixture.key('draft:save').click();assert.ok(fixture.host.textContent.includes('Forbindelsen mangler.'));assert.equal(fixture.key('field:end').value,'15:30');fixture.render({entries:[entry({version:3})]});assert.equal(fixture.key('draft:save').disabled,true);assert.ok(fixture.host.textContent.includes('seneste version'));
});

test('DST review offers explicit recorded UTC instants and sends a reasoned resolution without allowing unsafe approval',async()=>{
 const fixture=app({entries:[entry({date:'2026-10-25',endDate:'2026-10-25',start:'01:30',end:'03:30',clockStartAt:'2026-10-24T23:30:00.000Z',clockEndAt:'2026-10-25T02:30:00.000Z',flags:['dst_transition'],dstUnresolved:true})]});
 await fixture.key('inspect:time-1').click();assert.equal(fixture.key('entry:approve'),undefined);await fixture.key('entry:edit').click();assert.equal(fixture.key('field:actual-start').value,'2026-10-24T23:30:00.000Z');assert.equal(fixture.key('field:actual-end').value,'2026-10-25T02:30:00.000Z');assert.ok(fixture.host.textContent.includes('Europe/Copenhagen'));
 await fixture.input('actual-start','02:30');await fixture.input('reason','Stemplinger afklaret');await fixture.key('draft:save').click();assert.equal(fixture.calls.length,0);assert.ok(fixture.host.textContent.includes('UTC'));
 await fixture.input('actual-start','2026-10-24T23:30:00.000Z');await fixture.key('draft:save').click();assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].payload.actualStartAt,'2026-10-24T23:30:00.000Z');assert.equal(fixture.calls[0].payload.actualEndAt,'2026-10-25T02:30:00.000Z');assert.equal(fixture.calls[0].payload.endDate,'2026-10-25');assert.equal(fixture.calls[0].payload.reason,'Stemplinger afklaret');
});
test('demo and ordinary salary totals remain separate while both are in the server bundle',async()=>{
 const fixture=app({demo:{active:true,personId:'emma',from:'2026-11-02',to:'2026-11-08'},entries:[entry({id:'demo-1',demo:true,status:'approved',payroll:{totalCents:10000,baseCents:9000,supplementCents:1000,sourceLabel:'Demo'}}),entry({id:'real-1',status:'approved',payroll:{totalCents:20000,baseCents:20000,supplementCents:0,sourceLabel:'Almindelig'}})]});
 await fixture.key('tab:payroll').click();assert.ok(fixture.host.textContent.includes('100,00'));assert.equal(fixture.host.textContent.includes('200,00'),false);await fixture.key('demo:scope').click();assert.ok(fixture.host.textContent.includes('200,00'));assert.equal(fixture.host.textContent.includes('100,00'),false);
});
test('read-only reviewers cannot change or approve time records',async()=>{
 const fixture=app({canManage:false});await fixture.key('inspect:time-1').click();assert.equal(fixture.key('entry:approve'),undefined);assert.equal(fixture.key('entry:edit'),undefined);assert.equal(fixture.key('demo:load'),undefined);assert.equal(fixture.calls.length,0);
});

test('incomplete payroll is counted as missing and its placeholder cents never enter totals',async()=>{
 const fixture=app({entries:[entry({id:'priced',status:'approved',payroll:{totalCents:10000,baseCents:9000,supplementCents:1000,sourceLabel:'Gruppe A'}}),entry({id:'missing',status:'approved',payroll:{totalCents:99999,baseCents:99999,supplementCents:0,sourceLabel:'Ingen lønaftale',unavailableReason:'Der mangler en lønaftale.'}})]});
 await fixture.key('tab:payroll').click();const metrics=fixture.byClass('cs-time-metrics');assert.equal(metrics.children[1].querySelector('dd').textContent,View.money(10000));assert.equal(metrics.children[2].querySelector('dd').textContent,'1');const rows=fixture.byClass('cs-time-payroll-table').querySelector('tbody').children;assert.deepEqual(rows[1].children.slice(3,6).map(cell=>cell.textContent),['—','—','—']);assert.ok(fixture.host.textContent.includes('Løngrundlag mangler'));assert.equal(fixture.host.textContent.includes(View.money(99999)),false);
 await fixture.key('payroll:missing').click();assert.equal(fixture.host.textContent.includes(View.money(99999)),false);assert.deepEqual(fixture.byClass('cs-time-pay-detail').querySelectorAll('dd').map(item=>item.textContent),['—','—','—']);
});
test('an entirely incomplete approved payroll period displays an unknown total rather than zero',async()=>{
 const fixture=app({entries:[entry({status:'approved',payroll:{totalCents:0,baseCents:0,supplementCents:0,unavailableReason:'Ingen aftale'}})]});await fixture.key('tab:payroll').click();assert.equal(fixture.byClass('cs-time-metrics').children[1].querySelector('dd').textContent,'—');
});

test('rejected entries without an end count as unfinished and never display zero net or delta',async()=>{
 const fixture=app({entries:[entry({id:'missing-end',status:'rejected',end:null,workedMinutes:0,deltaMinutes:0,flags:['missing_end']}),entry({id:'finished',status:'submitted'})]});assert.equal(fixture.key('queue:attention').querySelector('.cs-time-review-count').textContent,'2');const table=fixture.byClass('cs-time-entries-table'),row=table.querySelector('tbody').children.find(item=>item.dataset.entryId==='missing-end');assert.ok(row.children[3].textContent.includes('Afventer afslutning'));assert.equal(row.children[3].textContent.includes('0 t netto'),false);assert.equal(row.children[5].querySelector('.cs-time-delta-value').textContent,'—');assert.equal(row.children[5].querySelector('.cs-time-delta-description').textContent,'Afventer afslutning');assert.ok(fixture.host.textContent.includes('Afvigelse'));assert.ok(fixture.host.textContent.includes('Kræver opmærksomhed'));
 assert.equal(fixture.nodes().filter(node=>node.tagName==='SELECT').length,0);await fixture.key('inspect:missing-end').click();assert.ok(fixture.byClass('cs-time-comparison').textContent.includes('Afventer afslutning'));
});

test('manual break allocation is explained and clocked breaks retain their interval description',async()=>{
 const fixture=app({entries:[entry({breakAllocation:'end-of-shift'})]});await fixture.key('inspect:time-1').click();assert.ok(fixture.host.textContent.includes('Samlet pause placeres ved vagtens slutning'));await fixture.key('entry:edit').click();assert.ok(fixture.byClass('cs-time-form').textContent.includes('Den samlede pause placeres ved vagtens slutning'));fixture.render({entries:[entry({breakAllocation:'clocked'})]});await fixture.key('draft:cancel').click();assert.ok(fixture.host.textContent.includes('Stemplede pauser følger de faktiske pauseintervaller'));
});
test('sending a submitted record back requires a reason and preserves the employee comment',async()=>{
 const calls=[],comment='Jeg sluttede senere efter aftale med teamlederen.';const fixture=app({entries:[entry({comment})]},{onAction:async(action,payload)=>{calls.push({action,payload});return {ok:true,entry:entry({version:3,status:'rejected',comment,audit:[{operation:'reject',reason:payload.reason,at:'2026-11-02T16:00:00Z',actor:{name:'Planlægger'}}]})};}});
 await fixture.key('inspect:time-1').click();assert.ok(fixture.host.textContent.includes(comment));await fixture.key('entry:reject').click();assert.equal(fixture.key('field:start'),undefined);await fixture.key('draft:save').click();assert.equal(calls.length,0);await fixture.input('reason','Bekræft venligst, hvornår pausen blev holdt.');await fixture.key('draft:save').click();assert.equal(calls.length,1);assert.equal(calls[0].payload.operation,'reject');assert.equal(calls[0].payload.version,2);assert.equal(calls[0].payload.reason,'Bekræft venligst, hvornår pausen blev holdt.');assert.ok(fixture.host.textContent.includes('Tilbagemelding til medarbejderen'));assert.ok(fixture.host.textContent.includes(comment));assert.equal(fixture.key('entry:approve'),undefined);
});

const readyEntry=(patch={})=>entry({breakMinutes:0,workedMinutes:480,deltaMinutes:0,payroll:{totalCents:148400,baseCents:148400,supplementCents:0,sourceLabel:'Service'},...patch});
const linkedShift=record=>({id:record.shiftId,person:record.personId,date:record.date,site:record.site,start:record.plannedStart,end:record.plannedEnd,...(record.demo?{demo:true}:{})});
const reviewFixture=(records,extra={},callbacks={})=>app({entries:records,shifts:records.map(linkedShift),serverNow:'2026-11-02T12:00:00Z',...extra},callbacks);
const rowIds=fixture=>fixture.byClass('cs-time-entries-table')?.querySelector('tbody').children.map(row=>row.dataset.entryId)||[];
test('large time lists stay bounded while page selection and quick approval retain their distinct scopes',async()=>{
 const records=Array.from({length:125},(_,index)=>readyEntry({id:'record-'+String(index).padStart(3,'0'),shiftId:'shift-'+index})),fixture=reviewFixture(records);
 assert.equal(rowIds(fixture).length,50);assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'1–50 af 125');assert.equal(fixture.key('page:entries:previous').disabled,true);
 await fixture.key('page:entries:next').click();assert.equal(rowIds(fixture)[0],'record-050');fixture.key('select:all').checked=true;await fixture.key('select:all').fire('change');assert.equal(fixture.key('bulk:approve').textContent,'Godkend 50 valgte');
 await fixture.key('page:entries:next').click();assert.equal(rowIds(fixture).length,25);fixture.key('select:all').checked=true;await fixture.key('select:all').fire('change');assert.equal(fixture.key('bulk:approve').textContent,'Godkend 75 valgte');assert.equal(fixture.key('page:entries:next').disabled,true);
 await fixture.key('page:entries:previous').click();assert.equal(fixture.key('select:all').checked,true);await fixture.key('bulk:approve').click();assert.match(fixture.byClass('cs-time-bulk-confirm').textContent,/75 registreringer/);assert.equal(fixture.calls.length,0);
 await fixture.input('search','Emma');assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'1–50 af 125');assert.equal(fixture.key('bulk:approve'),undefined);
});
test('quick approval includes all filtered pages and performs one final authoritative refresh',async()=>{
 const records=Array.from({length:125},(_,index)=>readyEntry({id:'record-'+String(index).padStart(3,'0'),shiftId:'shift-'+index})),writes=[];let refreshes=0;
 const fixture=reviewFixture(records,{}, {onAction:async(_action,payload)=>{writes.push(payload);return {ok:true,entry:{...records.find(record=>record.id===payload.entryId),version:3,status:'approved'}};},onRefresh:async()=>{refreshes++;}});
 assert.equal(fixture.key('bulk:ready').textContent,'Godkend 125 der følger planen');await fixture.key('bulk:ready').click();assert.match(fixture.byClass('cs-time-bulk-confirm').textContent,/Alle registreringer med de valgte filtre/);await fixture.key('bulk:confirm').click();
 assert.equal(writes.length,125);assert.ok(writes.every(payload=>payload.onlyIfMatchesPlan===true));assert.equal(new Set(writes.map(payload=>payload.entryId)).size,125);assert.equal(refreshes,1);assert.match(fixture.host.textContent,/125 af 125 registreringer er godkendt/);
});
test('weekly and payroll tables are bounded without truncating aggregate totals',async()=>{
 const records=Array.from({length:125},(_,index)=>readyEntry({id:'record-'+index,shiftId:'shift-'+index,status:'approved',personId:'person-'+index})),people=records.map((record,index)=>({id:record.personId,name:'Person '+index,target:37})),fixture=reviewFixture(records,{people,plannedRows:people.map(person=>({...person,personId:person.id,plannedMinutes:480}))});
 await fixture.key('tab:week').click();assert.equal(fixture.byClass('cs-time-week-table').querySelector('tbody').children.length,50);await fixture.key('page:week:next').click();assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'51–100 af 125');
 await fixture.key('tab:payroll').click();assert.equal(fixture.byClass('cs-time-payroll-table').querySelector('tbody').children.length,50);assert.equal(fixture.byClass('cs-time-metrics').children[0].querySelector('dd').textContent,'1000 t');assert.equal(fixture.byClass('cs-time-metrics').children[1].querySelector('dd').textContent,View.money(148400*125));
 await fixture.key('page:payroll:next').click();fixture.render({from:'2026-11-09',to:'2026-11-15'});assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'1–50 af 125');
});
test('server paging requests one next or previous page and discards selection from replaced records',async()=>{
 const records=Array.from({length:50},(_,index)=>readyEntry({id:'server-'+String(index).padStart(3,'0'),shiftId:'shift-'+index})),pageCalls=[];let finish;
 const fixture=reviewFixture(records,{pagination:{server:true,page:0,hasNext:true,hasPrevious:false,totalCount:620},serverFilter:{queue:'ready',search:'',scope:'real'},summary:{counts:{all:620,attention:120,ready:450,progress:20,approved:30}}},{onPageChange:direction=>{pageCalls.push(direction);return new Promise(resolve=>{finish=resolve;});}});
 assert.equal(rowIds(fixture).length,50);assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'1–50 af 620');assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'450');fixture.key('select:server-000').checked=true;await fixture.key('select:server-000').fire('change');
 const next=fixture.key('page:entries:next').click();assert.equal(fixture.controller.busy,true);assert.equal(fixture.key('page:entries:next').disabled,true);assert.equal(fixture.key('bulk:approve'),undefined);await fixture.key('page:entries:next').click();assert.deepEqual(pageCalls,['next']);
 const nextRecord=readyEntry({id:'server-050',shiftId:'shift-50'});fixture.render({entries:[nextRecord],shifts:[linkedShift(nextRecord)],pagination:{server:true,page:1,hasPrevious:true,hasNext:false,totalCount:51}});finish();await next;assert.equal(fixture.controller.busy,false);assert.deepEqual(rowIds(fixture),['server-050']);assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'51–51 af 51');assert.equal(fixture.key('bulk:approve'),undefined);
 const previous=fixture.key('page:entries:previous').click();assert.deepEqual(pageCalls,['next','previous']);finish();await previous;
});
test('server pagination uses actual row offsets when byte-limited pages contain fewer than fifty records',()=>{
 const records=Array.from({length:31},(_,index)=>readyEntry({id:'server-'+index,shiftId:'shift-'+index})),fixture=reviewFixture(records,{pagination:{server:true,page:0,offset:0,hasNext:true,hasPrevious:false,totalCount:95},serverFilter:{queue:'ready',search:'',scope:'real'}});
 assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'1–31 af 95');fixture.render({pagination:{server:true,page:1,offset:31,hasPrevious:true,hasNext:true,totalCount:95}});assert.equal(fixture.byClass('cs-time-pagination').children[0].textContent,'32–62 af 95');
});
test('demo weekly planning uses the complete server planned rows rather than shifts from the current page',async()=>{
 const record=readyEntry({id:'demo-a',shiftId:'shift-a',demo:true}),fixture=reviewFixture([record],{demo:{active:true,personId:'emma',from:'2026-11-02',to:'2026-11-08'},pagination:{server:true,page:1,offset:31,hasPrevious:true,hasNext:true},serverFilter:{queue:'all',search:'',scope:'demo'},plannedRows:[{personId:'emma',name:'Emma Nielsen',plannedMinutes:2250,target:37},{personId:'future',name:'Medarbejder uden timer endnu',plannedMinutes:450,target:20}],summary:{counts:{all:90,attention:0,ready:90,progress:0,approved:0},people:[{personId:'emma',registeredMinutes:1800,approvedMinutes:0}]}});
 await fixture.key('tab:week').click();const rows=fixture.byClass('cs-time-week-table').querySelector('tbody').children;assert.equal(rows.length,2);assert.equal(rows[0].children[1].textContent,'37 t 30 min');assert.equal(rows[0].children[3].textContent,'30 t');assert.equal(rows[1].children[1].textContent,'7 t 30 min');assert.equal(rows[1].children[3].textContent,'0 t');
});
test('server filters run against unloaded records and bulk approval explicitly covers the current page only',async()=>{
 const records=Array.from({length:50},(_,index)=>readyEntry({id:'server-'+String(index).padStart(3,'0'),shiftId:'shift-'+index})),filters=[],writes=[];
 const fixture=reviewFixture(records,{pagination:{server:true,page:0,hasNext:true,hasPrevious:false},serverFilter:{queue:'ready',search:'',scope:'real'},summary:{counts:{all:800,attention:100,ready:700,progress:0,approved:0}}},{onFilterChange:filter=>filters.push(filter),onAction:async(_action,payload)=>{writes.push(payload);return {ok:true,entry:{...records.find(record=>record.id===payload.entryId),version:3,status:'approved'}};}});
 assert.equal(fixture.key('bulk:ready').textContent,'Godkend viste der følger planen');await fixture.key('bulk:ready').click();assert.match(fixture.byClass('cs-time-bulk-confirm').textContent,/50 registreringer/);assert.match(fixture.byClass('cs-time-bulk-confirm').textContent,/Kun de viste registreringer/);await fixture.key('bulk:confirm').click();assert.equal(writes.length,50);
 await fixture.key('queue:attention').click();assert.deepEqual(filters.at(-1),{queue:'attention',search:'',scope:'real'});await fixture.input('search','En medarbejder på en senere side');assert.deepEqual(filters.at(-1),{queue:'attention',search:'En medarbejder på en senere side',scope:'real'});assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'—','A summary for an old search is never shown as the new result count.');
});
test('server aggregates cover the full period while payroll loads only its approved page and restores the previous queue',async()=>{
 const a=readyEntry({id:'a',shiftId:'sa'}),filters=[],fixture=reviewFixture([a],{pagination:{server:true,page:0,hasNext:true,hasPrevious:false},serverFilter:{queue:'attention',search:'',scope:'real'},plannedRows:[{personId:'emma',name:'Emma Nielsen',target:37,plannedMinutes:480}],summary:{counts:{all:500,attention:50,ready:100,progress:50,approved:300},registeredMinutes:18000,approvedMinutes:12000,approvedCents:8888000,missingPayrollCount:3,people:[{personId:'emma',registeredMinutes:18000,approvedMinutes:12000}] }},{onFilterChange:value=>filters.push(value)});
 await fixture.key('tab:week').click();const weekly=fixture.byClass('cs-time-week-table').querySelector('tbody').children[0];assert.equal(weekly.children[3].textContent,'300 t');assert.equal(weekly.children[4].textContent,'200 t');
 await fixture.key('tab:payroll').click();assert.equal(filters.at(-1).queue,'approved');const metrics=fixture.byClass('cs-time-metrics');assert.equal(metrics.children[0].querySelector('dd').textContent,'200 t');assert.equal(metrics.children[1].querySelector('dd').textContent,View.money(8888000));assert.equal(metrics.children[2].querySelector('dd').textContent,'3');assert.match(fixture.host.textContent,/Ingen godkendte registreringer på denne side/);await fixture.key('tab:entries').click();assert.equal(filters.at(-1).queue,'attention');
});
test('time draft and pending status are exposed for non-destructive freshness checks',async()=>{
 const fixture=reviewFixture([readyEntry()]);assert.equal(fixture.controller.hasDraft,false);assert.equal(fixture.controller.busy,false);await fixture.key('inspect:time-1').click();await fixture.key('entry:edit').click();assert.equal(fixture.controller.hasDraft,true);await fixture.input('reason','Bevar min rettelse');fixture.render({serverNow:'2026-11-02T14:00:00Z'});assert.equal(fixture.key('field:reason').value,'Bevar min rettelse');assert.equal(fixture.controller.hasDraft,true);await fixture.key('draft:cancel').click();assert.equal(fixture.controller.hasDraft,false);
});
test('review queues prioritise unfinished and changed intervals without treating equal net hours as following plan',async()=>{
 const clean=readyEntry({id:'clean',shiftId:'shift-clean'}),shifted=readyEntry({id:'shifted',shiftId:'shift-shifted',start:'08:00',end:'16:00'}),missing=entry({id:'missing',shiftId:'shift-missing',end:null,status:'rejected',workedMinutes:0,flags:['missing_end']}),approved=readyEntry({id:'done',shiftId:'shift-done',status:'approved'}),active=entry({id:'active',shiftId:'shift-active',end:null,status:'running',workedMinutes:0,flags:['missing_end']});
 const fixture=reviewFixture([clean,shifted,missing,approved,active]);
 assert.deepEqual(rowIds(fixture),['missing','shifted']);assert.equal(fixture.key('queue:attention').getAttribute('aria-pressed'),'true');assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'1');assert.equal(fixture.key('queue:progress').querySelector('.cs-time-review-count').textContent,'1');assert.ok(fixture.byClass('cs-time-entries-table').querySelector('tbody').children.find(row=>row.dataset.entryId==='shifted').querySelector('.cs-time-delta').title.includes('Starttiden afviger fra planen.'));await fixture.key('inspect:shifted').click();assert.ok(fixture.byClass('cs-time-detail').textContent.includes('Starttiden afviger fra planen.'));assert.ok(fixture.byClass('cs-time-detail').textContent.includes('Sluttiden afviger fra planen.'));await fixture.key('detail:close').click();
 await fixture.key('queue:ready').click();assert.deepEqual(rowIds(fixture),['clean']);assert.ok(fixture.key('bulk:ready'));await fixture.key('queue:approved').click();assert.deepEqual(rowIds(fixture),['done']);assert.equal(fixture.key('select:done'),undefined);
});
test('quick approval requires an explicit count and hour review and sends only matching current visible versions',async()=>{
 const a=readyEntry({id:'a',shiftId:'sa'}),b=readyEntry({id:'b',shiftId:'sb',personId:'noah'}),issue=readyEntry({id:'issue',shiftId:'sc',start:'08:00',end:'16:00'}),records=[a,b,issue];
 const calls=[],fixture=reviewFixture(records,{people:[{id:'emma',name:'Emma Nielsen'},{id:'noah',name:'Noah Andersen'}]},{onAction:async(action,payload)=>{calls.push({action,payload});return {ok:true,entry:{...records.find(record=>record.id===payload.entryId),status:'approved',version:payload.version+1}};}});
 await fixture.key('queue:ready').click();await fixture.key('bulk:ready').click();assert.equal(calls.length,0);assert.ok(fixture.byClass('cs-time-bulk-confirm').textContent.includes('2 registreringer · 16 t'));await fixture.key('bulk:confirm').click();assert.deepEqual(calls.map(call=>[call.payload.entryId,call.payload.version,call.payload.onlyIfMatchesPlan]),[['a',2,true],['b',2,true]]);assert.ok(fixture.host.textContent.includes('2 af 2 registreringer er godkendt.'));assert.equal(fixture.key('bulk:confirm'),undefined);
});
test('quick approval obeys search and scope and excludes pauses, changed shifts and hidden rows',async()=>{
 const a=readyEntry({id:'a',shiftId:'sa'}),b=readyEntry({id:'b',shiftId:'sb',personId:'noah'}),paused=entry({id:'pause',shiftId:'sp'}),changed=readyEntry({id:'changed',shiftId:'sch'}),demo=readyEntry({id:'demo',shiftId:'sd',demo:true}),records=[a,b,paused,changed,demo],calls=[];
 const shifts=records.map(linkedShift);shifts.find(shift=>shift.id==='sch').end='16:00';
 const fixture=reviewFixture(records,{shifts,people:[{id:'emma',name:'Emma Nielsen'},{id:'noah',name:'Noah Andersen'}],demo:{active:true,from:'2026-11-02',to:'2026-11-08',personId:'emma'}},{onAction:async(action,payload)=>{calls.push(payload);return {ok:true,entry:{...records.find(record=>record.id===payload.entryId),status:'approved',version:3}};}});
 await fixture.key('demo:scope').click();await fixture.key('queue:ready').click();assert.deepEqual(rowIds(fixture),['a','b']);await fixture.input('search','Noah');assert.deepEqual(rowIds(fixture),['b']);await fixture.key('bulk:ready').click();assert.ok(fixture.byClass('cs-time-bulk-confirm').textContent.includes('1 registrering · 8 t'));await fixture.key('bulk:confirm').click();assert.deepEqual(calls.map(call=>call.entryId),['b']);assert.equal(calls[0].demo,undefined);
});
test('changing search or scope clears bulk review and selection before it can approve a hidden record',async()=>{
 const a=readyEntry({id:'a',shiftId:'sa'}),demo=readyEntry({id:'demo',shiftId:'sd',demo:true});const fixture=reviewFixture([a,demo],{demo:{active:true,from:'2026-11-02',to:'2026-11-08',personId:'emma'}});
 await fixture.key('queue:ready').click();await fixture.key('bulk:ready').click();assert.ok(fixture.key('bulk:confirm'));await fixture.input('search','Emma');assert.equal(fixture.key('bulk:confirm'),undefined);fixture.key('select:demo').checked=true;await fixture.key('select:demo').fire('change');assert.ok(fixture.key('bulk:approve'));await fixture.key('demo:scope').click();assert.equal(fixture.key('bulk:approve'),undefined);assert.equal(fixture.calls.length,0);
});
test('a newer version after quick review is not silently approved and requires another review',async()=>{
 const original=readyEntry();const fixture=reviewFixture([original]);await fixture.key('bulk:ready').click();fixture.render({entries:[{...original,version:3}]});await fixture.key('bulk:confirm').click();assert.equal(fixture.calls.length,0);assert.ok(fixture.host.textContent.includes('ændret siden dit valg'));assert.ok(fixture.host.textContent.includes('0 af 1 registrering er godkendt.'));
});
test('partial quick approval stops at a changed record and truthfully reports completed work',async()=>{
 const a=readyEntry({id:'a',shiftId:'sa'}),b=readyEntry({id:'b',shiftId:'sb'}),c=readyEntry({id:'c',shiftId:'sc'}),records=[a,b,c],calls=[];let fixture;
 fixture=reviewFixture(records,{}, {onAction:async(action,payload)=>{calls.push(payload);if(payload.entryId==='a')fixture.render({entries:[a,{...b,version:3},c]});return {ok:true,entry:{...a,status:'approved',version:3}};}});
 await fixture.key('bulk:ready').click();await fixture.key('bulk:confirm').click();assert.deepEqual(calls.map(call=>call.entryId),['a']);assert.ok(fixture.host.textContent.includes('1 af 3 registreringer er godkendt.'));assert.ok(fixture.host.textContent.includes('resterende registreringer er ikke godkendt'));
});
test('bulk approval stops when server rejects a record and keeps later records untouched',async()=>{
 const records=[readyEntry({id:'a',shiftId:'sa'}),readyEntry({id:'b',shiftId:'sb'}),readyEntry({id:'c',shiftId:'sc'})],calls=[];const fixture=reviewFixture(records,{}, {onAction:async(action,payload)=>{calls.push(payload);return payload.entryId==='b'?{ok:false,status:409,message:'Planen er ændret.'}:{ok:true,entry:{...records[0],status:'approved',version:3}};}});
 await fixture.key('bulk:ready').click();await fixture.key('bulk:confirm').click();assert.deepEqual(calls.map(call=>call.entryId),['a','b']);assert.ok(fixture.host.textContent.includes('1 af 3 registreringer er godkendt.'));assert.ok(fixture.host.textContent.includes('Planen er ændret.'));
});
test('select all is limited to the current filtered rows and selected versions are invalidated on change',async()=>{
 const records=[readyEntry({id:'a',shiftId:'sa'}),readyEntry({id:'b',shiftId:'sb',personId:'noah'}),readyEntry({id:'blocked',shiftId:'sd',flags:['dst_transition']})];const fixture=reviewFixture(records,{people:[{id:'emma',name:'Emma Nielsen'},{id:'noah',name:'Noah Andersen'}]});
 await fixture.key('queue:ready').click();await fixture.input('search','Noah');const all=fixture.key('select:all');all.checked=true;await all.fire('change');assert.equal(fixture.key('select:b').checked,true);assert.equal(fixture.key('select:a'),undefined);assert.ok(fixture.byText('Godkend 1 valgt'));fixture.render({entries:records.map(record=>record.id==='b'?{...record,version:3}:record)});assert.equal(fixture.key('bulk:approve'),undefined);assert.equal(fixture.key('select:b').checked,false);assert.equal(fixture.calls.length,0);
});
test('read-only reviewers have attention queues but no approval or selection controls',async()=>{
 const fixture=reviewFixture([readyEntry()],{canManage:false});assert.ok(fixture.key('queue:ready'));assert.equal(fixture.key('bulk:ready'),undefined);assert.equal(fixture.key('select:all'),undefined);assert.equal(fixture.key('select:time-1'),undefined);assert.equal(fixture.calls.length,0);
});
test('manual approval excludes DST ambiguity and invalid actual intervals',()=>{
 assert.equal(View.approvable(entry({flags:['dst_transition']})),false);assert.equal(View.approvable(entry({start:'17:00',end:'15:00'})),false);assert.equal(View.approvable(entry({breakMinutes:480})),false);
});
test('manual bulk review names selected exceptions before explicit approval',async()=>{
 const clean=readyEntry({id:'clean',shiftId:'sc'}),issue=entry({id:'issue',shiftId:'si'}),fixture=reviewFixture([clean,issue]);
 const all=fixture.key('select:all');all.checked=true;await all.fire('change');await fixture.key('bulk:approve').click();assert.equal(fixture.calls.length,0);assert.ok(fixture.byClass('cs-time-bulk-warning').textContent.includes('1 af de valgte registreringer har afvigelser'));assert.ok(fixture.byClass('cs-time-bulk-confirm').textContent.includes('Kontrollér dem før godkendelse.'));
});
test('the comparison shows the current planned times when the plan changed after registration',async()=>{
 const record=readyEntry(),fixture=reviewFixture([record],{shifts:[{...linkedShift(record),start:'08:00',end:'16:00'}]});const row=fixture.byClass('cs-time-entries-table').querySelector('tbody').children[0];assert.ok(row.children[2].textContent.includes('08:00–16:00'));assert.ok(row.children[3].textContent.includes('07:00–15:00'));await fixture.key('inspect:time-1').click();assert.deepEqual(fixture.byClass('cs-time-comparison').querySelector('tbody').children.slice(0,2).map(row=>row.children.map(cell=>cell.textContent)),[['Start','08:00','07:00'],['Slut','16:00','15:00']]);
});
test('revoking approval access during a batch stops the remaining writes',async()=>{
 const records=[readyEntry({id:'a',shiftId:'sa'}),readyEntry({id:'b',shiftId:'sb'})],calls=[];let fixture;fixture=reviewFixture(records,{}, {onAction:async(action,payload)=>{calls.push(payload);fixture.render({canManage:false});return {ok:true,entry:{...records[0],status:'approved',version:3}};}});await fixture.key('bulk:ready').click();await fixture.key('bulk:confirm').click();assert.deepEqual(calls.map(call=>call.entryId),['a']);assert.ok(fixture.host.textContent.includes('Adgangen eller visningen er ændret'));
});

test('an agreed unpaid pause is compared visibly and can join quick approval at its net planned hours',async()=>{
  const agreed=readyEntry({plannedBreakMinutes:30,breakMinutes:30,workedMinutes:450,plannedMinutes:450,deltaMinutes:0}),fixture=reviewFixture([agreed],{shifts:[{...linkedShift(agreed),plannedBreakMinutes:30}]});
  assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'1');
  const row=fixture.byClass('cs-time-entries-table').querySelector('tbody').children[0];
  assert.equal(row.children[2].textContent,'07:00–15:00');assert.equal(row.children[4].textContent,'30 min');
  assert.equal(row.children[5].querySelector('.cs-time-delta-value').textContent,'0 min');
  await fixture.key('inspect:time-1').click();assert.deepEqual(fixture.byClass('cs-time-comparison').querySelector('tbody').children.find(row=>row.dataset.fact==='pause').children.map(cell=>cell.textContent),['Pause','30 min · ulønnet','30 min']);
  await fixture.key('detail:close').click();await fixture.key('bulk:ready').click();assert.match(fixture.byClass('cs-time-bulk-confirm').textContent,/1 registrering · 7 t 30 min/);
  await fixture.key('bulk:confirm').click();assert.equal(fixture.calls[0].payload.onlyIfMatchesPlan,true);assert.equal(fixture.calls[0].payload.plannedBreakMinutes,undefined);
});

test('pending comparisons use the current agreed pause while approved records retain captured planned values',async()=>{
  const captured=readyEntry({plannedBreakMinutes:30,breakMinutes:30,workedMinutes:450,plannedMinutes:450,deltaMinutes:0}),fixture=reviewFixture([captured],{shifts:[{...linkedShift(captured),plannedBreakMinutes:15}]});
  const pending=fixture.byClass('cs-time-entries-table').querySelector('tbody').children[0];
  assert.equal(pending.children[2].textContent,'07:00–15:00');assert.equal(pending.children[4].textContent,'30 min');assert.equal(pending.children[5].querySelector('.cs-time-delta-value').textContent,'15 min');assert.equal(pending.children[5].querySelector('.cs-time-delta').dataset.direction,'less');
  fixture.render({entries:[{...captured,status:'approved'}]});await fixture.key('queue:approved').click();
  const approved=fixture.byClass('cs-time-entries-table').querySelector('tbody').children[0];
  assert.equal(approved.children[2].textContent,'07:00–15:00');assert.equal(approved.children[4].textContent,'30 min');assert.equal(approved.children[5].querySelector('.cs-time-delta-value').textContent,'0 min');
});

test('demo weekly totals deduct each shift planned pause instead of its actual pause',async()=>{
  const a=readyEntry({id:'demo-a',shiftId:'shift-a',demo:true,plannedBreakMinutes:30,breakMinutes:75,workedMinutes:405}),b=readyEntry({id:'demo-b',shiftId:'shift-b',demo:true,date:'2026-11-03'});
  const fixture=reviewFixture([a,b],{demo:{active:true,personId:'emma',from:'2026-11-02',to:'2026-11-08'},shifts:[{...linkedShift(a),plannedBreakMinutes:30},linkedShift(b)]});
  await fixture.key('tab:week').click();const row=fixture.byClass('cs-time-week-table').querySelector('tbody').children[0];
  assert.equal(row.children[1].textContent,'15 t 30 min');assert.equal(row.children[3].textContent,'14 t 45 min');
});

test('compact time review removes repeated guidance and keeps employee comments in the individual review',async()=>{
 const record=readyEntry({comment:'Jeg mødte kl. 07:00, men glemte at stemple ind.'}),fixture=reviewFixture([record]);
 assert.equal(fixture.key('queue:attention').querySelector('.cs-time-review-count').textContent,'1');assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'0');assert.equal(fixture.key('bulk:ready'),undefined);assert.equal(fixture.byClass('cs-time-review-detail'),undefined);assert.equal(fixture.byClass('cs-time-queue-help'),undefined);assert.equal(fixture.key('demo:load'),undefined);assert.equal(fixture.nodes().filter(node=>node.tagName==='SELECT').length,0);
 const row=fixture.byClass('cs-time-entries-table').querySelector('tbody').children[0];assert.equal(row.children[5].querySelector('.cs-time-delta-value').textContent,'0 min');assert.ok(row.children[5].querySelector('.cs-time-delta').title.includes('kommentar'));assert.equal(row.children[5].querySelector('.cs-time-review-reason'),null);assert.equal(fixture.host.textContent.includes(record.comment),false);
 await fixture.key('inspect:time-1').click();assert.ok(fixture.byClass('cs-time-detail').textContent.includes(record.comment));await fixture.key('entry:edit').click();assert.equal(fixture.key('field:comment'),undefined);
});


test('a registration opens as one focused review with aligned comparison, context and decision sections',async()=>{
 const record=readyEntry({start:'07:20',workedMinutes:460,comment:'Jeg mødte kl. 07:00.',audit:[{operation:'finish',at:'2026-11-02T14:00:00Z',actor:{name:'Emma'}}]}),fixture=reviewFixture([record]);
 const ledger=fixture.byClass('cs-time-entries-table');assert.ok(ledger);fixture.byClass('cs-timekeeping-body').scrollTop=240;await fixture.key('inspect:time-1').click();
 assert.equal(fixture.byClass('cs-time-entries-table'),undefined);assert.equal(fixture.byClass('cs-time-review-summary'),undefined);assert.equal(fixture.byClass('cs-timekeeping-body').scrollTop,0);
 const detail=fixture.byClass('cs-time-detail');assert.deepEqual(detail.children.filter(el=>['SECTION'].includes(el.tagName)).map(section=>section.getAttribute('aria-label')),['Tider og pause','Grundlag for gennemgang','Behandling af registrering']);
 const comparison=fixture.byClass('cs-time-comparison');assert.deepEqual(comparison.querySelector('thead').querySelectorAll('th').map(cell=>cell.textContent),['','Planlagt','Registreret']);assert.deepEqual(comparison.querySelector('tbody').children.map(row=>row.children[0].textContent),['Start','Slut','Pause','Arbejdstid']);
 assert.equal(comparison.querySelector('tbody').children[0].children[2].dataset.changed,'true');assert.ok(fixture.byClass('cs-time-review-context').textContent.includes(record.comment));assert.ok(fixture.byClass('cs-time-decision').contains(fixture.key('entry:approve')));assert.equal(fixture.byClass('cs-time-pay-detail').open,false);assert.equal(fixture.byClass('cs-time-audit').open,false);
 await fixture.key('detail:close').click();assert.ok(fixture.byClass('cs-time-entries-table'));assert.equal(fixture.byClass('cs-timekeeping-body').scrollTop,240);assert.equal(fixture.host.ownerDocument.activeElement.dataset.timeFocus,'entry:time-1');
});
test('secondary payroll details remain closed until requested and stay open while the current record refreshes',async()=>{
 const fixture=reviewFixture([readyEntry()]);await fixture.key('inspect:time-1').click();const payroll=fixture.byClass('cs-time-pay-detail');assert.equal(payroll.open,false);payroll.open=true;await payroll.fire('toggle');fixture.render({serverNow:'2026-11-02T16:00:00Z'});assert.equal(fixture.byClass('cs-time-pay-detail').open,true);await fixture.key('detail:close').click();await fixture.key('inspect:time-1').click();assert.equal(fixture.byClass('cs-time-pay-detail').open,false);
});
test('work differences show time quantities while preserving direction and scheduling review',async()=>{
 assert.equal(View.differenceLabel(-20),'20 min');assert.equal(View.differenceLabel(60),'1 t');assert.equal(View.differenceLabel(120),'2 t');assert.equal(View.differenceLabel(80),'1 t 20 min');assert.equal(View.differenceLabel(0),'0 min');assert.equal(View.differenceLabel(NaN),'—');
 const shifted=readyEntry({start:'08:00',end:'16:00'}),fixture=reviewFixture([shifted]);const difference=fixture.byClass('cs-time-entries-table').querySelector('tbody').children[0].children[5];assert.equal(difference.querySelector('.cs-time-delta-value').textContent,'0 min');assert.equal(difference.querySelector('.cs-time-delta-arrow'),null);assert.ok(difference.querySelector('.cs-time-delta').title.includes('Starttiden afviger fra planen.'));assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'0');
 for(const [workedMinutes,arrow,label] of [[460,'↓','20 min mindre end planlagt'],[560,'↑','1 t 20 min mere end planlagt']]){
  const record=readyEntry({workedMinutes}),sample=reviewFixture([record]);assert.equal(sample.byClass('cs-time-delta-arrow').textContent,arrow);assert.equal(sample.byClass('cs-time-delta-arrow').getAttribute('aria-hidden'),'true');assert.equal(sample.byClass('cs-time-delta-description').textContent,label);
  await sample.key('inspect:time-1').click();const summary=sample.byClass('cs-time-comparison-result');assert.equal(summary.querySelector('.cs-time-delta-value').textContent,View.differenceLabel(workedMinutes-480));assert.equal(summary.querySelector('.cs-time-delta-arrow').textContent,arrow);
 }
});


test('a real server filter remains authoritative when loading completes with an active saved example week',()=>{
 const serverFilter={queue:'all',search:'',scope:'real'},pagination={server:true,page:0,offset:0,hasNext:false,hasPrevious:false},fixture=reviewFixture([],{loading:true,pagination:{...pagination,loading:true},serverFilter,demo:{active:false}}),record=readyEntry({id:'ordinary-entry',demo:false});
 fixture.render({loading:false,pagination:{...pagination,loading:false,totalCount:1},serverFilter,demo:{active:true,personId:'emma',from:'2026-11-02',to:'2026-11-08'},entries:[record],shifts:[linkedShift(record)],summary:{counts:{all:1,attention:0,ready:1,progress:0,approved:0}}});
 assert.deepEqual(rowIds(fixture),['ordinary-entry']);assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'1');assert.equal(fixture.key('queue:attention').querySelector('.cs-time-review-count').textContent,'0');assert.equal(fixture.host.textContent.includes('Der er endnu ingen registrerede timer'),false);
 fixture.render({serverNow:'2026-11-02T16:00:00Z'});assert.deepEqual(rowIds(fixture),['ordinary-entry']);assert.equal(fixture.key('queue:ready').querySelector('.cs-time-review-count').textContent,'1');
});
