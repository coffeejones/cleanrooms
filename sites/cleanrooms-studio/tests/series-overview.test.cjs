const test=require('node:test');
const assert=require('node:assert/strict');
const Overview=require('../src/series-overview.js');
const today='2026-10-30';
const series=(id,patch={})=>({id,person:id,site:0,startDate:'2026-10-01',endDate:'2026-11-30',weekdays:[1,3],start:'07:00',end:'15:00',note:'',...patch});
const shift=(id,date,patch={})=>({id,person:id,site:0,date,start:'07:00',end:'15:00',note:'',...patch});
const freeze=value=>{Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return value;};
const walk=node=>[node,...node.children.flatMap(walk)];
class Element {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.className='';this.dataset={};this.attributes={};this.handlers={};this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){throw Error('Series content must be rendered as text.');}
  append(...children){this.children.push(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key];}
  getBoundingClientRect(){return {top:0,bottom:0,height:0};}
  addEventListener(type,handler){this.handlers[type]=handler;}
  click(){this.handlers.click?.({currentTarget:this});}
  focus(){this.ownerDocument.activeElement=this;}
  contains(target){return walk(this).includes(target);}
}
function document(){const doc={createElement:tag=>new Element(tag,doc)};return doc;}
function fixture(patch={}){
  const definitions=[series('active'),series('upcoming',{startDate:'2026-11-10',endDate:'2026-12-10'}),series('ended',{endDate:'2026-10-20'}),series('moved',{endDate:'2026-10-20'}),series('empty')];
  const occurrences={active:[shift('active-old','2026-10-27'),shift('active-next','2026-11-03')],upcoming:[shift('upcoming-next','2026-11-10')],ended:[shift('ended-last','2026-10-20')],moved:[shift('moved-next','2026-11-02',{person:'replacement',site:1,start:'10:00',end:'12:00'})],empty:[]};
  return {series:definitions,today,shiftsForSeries:item=>occurrences[item.id],personName:id=>({active:'Anna',upcoming:'Ulla',ended:'Erik',moved:'Mikkel',empty:'Zara',replacement:'Afløser'})[id]||id,sites:[{name:'Kontor Nord'},{name:'Klinikken'}],...patch};
}
const byClass=(root,name)=>walk(root).filter(node=>node.className.split(' ').includes(name));
const openPeriods=root=>{const details=byClass(root,'cs-series-timeline')[0];details.open=true;details.handlers.toggle();return details;};

test('status filters distinguish future periods, ended work, moved upcoming exceptions and a current cancelled period',()=>{
  const options=fixture(),view=Overview.model(options);assert.deepEqual(view.counts,{active:3,upcoming:1,ended:1,all:5});assert.equal(view.status,'active');assert.deepEqual(view.visible.map(entry=>entry.series.id),['moved','active','empty']);
  assert.deepEqual(Overview.model({...options,status:'upcoming'}).visible.map(entry=>entry.series.id),['upcoming']);assert.deepEqual(Overview.model({...options,status:'ended'}).visible.map(entry=>entry.series.id),['ended']);assert.equal(Overview.model({...options,status:'all'}).visible.length,5);
  assert.equal(view.entries.find(entry=>entry.series.id==='moved').status,'active');assert.equal(view.entries.find(entry=>entry.series.id==='empty').status,'active');assert.equal(view.entries.find(entry=>entry.series.id==='empty').upcoming.length,0);
});

test('next occurrence, remaining counts and row detail use actual dates and reassignment rather than the template',()=>{
  const options=fixture(),view=Overview.model(options),entry=view.entries.find(entry=>entry.series.id==='moved');assert.equal(entry.next.id,'moved-next');assert.equal(entry.next.date,'2026-11-02');assert.equal(entry.upcoming.length,1);
  const root=Overview.render({...options,document:document(),status:'all',exceptionCount:item=>item.id==='moved'?{count:2}:0}),row=byClass(root,'cs-series-row').find(row=>row.dataset.seriesId==='moved');
  assert.ok(row.textContent.includes('10:00–12:00'));assert.ok(row.textContent.includes('Klinikken'));assert.ok(row.textContent.includes('Afløser'));assert.equal(row.textContent.includes('1 kommende vagt'),false);assert.ok(row.textContent.includes('2 undtagelser'));assert.ok(row.textContent.includes('Seneste rytme'));openPeriods(row);assert.ok(row.textContent.includes('1 kommende vagt'));
});

test('sorting prioritizes actual next dates then start times and names without changing input order',()=>{
  const definitions=freeze([series('z'),series('a'),series('early'),series('late')]);
  const rows=freeze({z:[shift('z','2026-11-03')],a:[shift('a','2026-11-03')],early:[shift('early','2026-11-02',{start:'09:00'})],late:[shift('late','2026-11-02',{start:'10:00'})]});
  const before=JSON.stringify({definitions,rows}),options={series:definitions,today,shiftsForSeries:item=>rows[item.id],personName:id=>({z:'Zara',a:'Anna',early:'Oliver',late:'Bea'})[id]};
  assert.deepEqual(Overview.model(options).visible.map(entry=>entry.series.id),['early','late','a','z']);Overview.render({...options,document:document()});assert.equal(JSON.stringify({definitions,rows}),before);
});

test('status controls expose counts, selected state, and exact status callbacks',()=>{
  const selected=[],root=Overview.render({...fixture(),document:document(),status:'upcoming',onStatusChange:value=>selected.push(value)}),tabs=byClass(root,'cs-series-status');
  assert.equal(tabs.length,4);assert.equal(tabs.find(tab=>tab.dataset.seriesStatus==='upcoming').getAttribute('aria-pressed'),'true');assert.equal(tabs.find(tab=>tab.dataset.seriesStatus==='active').getAttribute('aria-label'),'I gang · 3 serier');
  tabs.find(tab=>tab.dataset.seriesStatus==='ended').click();assert.deepEqual(selected,['ended']);assert.ok(tabs.every(tab=>tab.type==='button'&&tab.dataset.productFocus==='series:status:'+tab.dataset.seriesStatus));
});

test('row callbacks retain exact series, effective next occurrence and stable focus trigger identities',()=>{
  const events=[],options=fixture({onEdit:(...args)=>events.push(['edit',...args]),onShow:(...args)=>events.push(['show',...args])}),root=Overview.render({...options,document:document()}),row=byClass(root,'cs-series-row').find(row=>row.dataset.seriesId==='moved');
  const edit=walk(row).find(node=>node.dataset.productFocus==='series:moved:edit'),show=walk(row).find(node=>node.dataset.productFocus==='series:moved:show');edit.click();show.click();
  assert.equal(events[0][1],options.series.find(item=>item.id==='moved'));assert.equal(events[0][2],edit);assert.equal(events[1][1],events[0][1]);assert.equal(events[1][2].id,'moved-next');assert.equal(events[1][2].person,'replacement');assert.equal(events[1][3].dataset.productFocus,'series:moved:more','Closing a menu returns to its visible summary, rather than a hidden item.');
  assert.equal(edit.getAttribute('aria-label'),'Rediger vagtserien for Mikkel');assert.equal(show.getAttribute('aria-label'),'Vis vagtserien for Mikkel i planen');
});

test('empty active filter offers All while a genuinely empty company offers creation and global filter emptiness does neither',()=>{
  const events=[],ended=series('ended',{endDate:'2026-10-20'}),options={document:document(),today,series:[ended],shiftsForSeries:()=>[],personName:()=> 'Anna',onStatusChange:value=>events.push(value),onCreate:trigger=>events.push(trigger)};
  const filtered=Overview.render(options),all=walk(filtered).find(node=>node.textContent==='Vis alle serier');assert.ok(all);all.click();assert.equal(events[0],'all');assert.equal(walk(filtered).some(node=>node.dataset.productFocus==='series:create'),false);
  const empty=Overview.render({...options,series:[],totalSeries:0}),create=walk(empty).find(node=>node.dataset.productFocus==='series:create');assert.ok(create);create.click();assert.equal(events[1],create);
  const globalEmpty=Overview.render({...options,series:[],totalSeries:5});assert.ok(globalEmpty.textContent.includes('Ingen serier matcher filtrene'));assert.equal(walk(globalEmpty).some(node=>node.dataset.productFocus==='series:create'||node.dataset.productFocus==='series:show-all'),false);
});

test('long descriptions and literal HTML remain safe and concise without leaking raw notes into the overview',()=>{
  const note=('<script>alert(1)</script>\nÆØÅ 🧽 ').repeat(1500),definition=series('literal',{note,noteRich:'literal-rich'}),root=Overview.render({document:document(),series:[definition],today,shiftsForSeries:()=>[shift('literal-next','2026-11-03')],personName:()=>'<img src=x onerror=alert(1)>',sites:[{name:'<b>Kontor</b>'}],descriptionIndicator:()=>new Element('span',document())});
  assert.ok(root.textContent.includes('<img src=x onerror=alert(1)>'));assert.ok(root.textContent.includes('<b>Kontor</b>'));assert.ok(root.textContent.includes('Beskrivelse'));assert.equal(root.textContent.includes(note),false);assert.equal(walk(root).some(node=>['script','img','b'].includes(node.tagName)),false);
  assert.ok(Overview.model({series:[definition],today,shiftsForSeries:()=>[],exceptionCount:()=>-5}).entries[0].exceptions===0);assert.ok(Object.isFrozen(Overview));
});

function lifecycle(){
  const previous=globalThis.CleanRoomsSeriesLifecycle;
  const value=require('../src/series-lifecycle.js');
  if(previous===undefined)delete globalThis.CleanRoomsSeriesLifecycle;else globalThis.CleanRoomsSeriesLifecycle=previous;
  return value;
}
function agreementFixture(patch={}){
  const phases=[
    series('phase-a',{groupId:'agreement',person:'anna',site:0,startDate:'2026-10-19',endDate:'2026-10-25',weekdays:[0]}),
    series('phase-b',{groupId:'agreement',person:'emma',site:1,startDate:'2026-10-26',endDate:'2026-11-01',weekdays:[1,3],start:'08:00',end:'16:00'}),
    series('phase-c',{groupId:'agreement',person:'jonas',site:0,startDate:'2026-11-02',endDate:'2026-11-08',weekdays:[0,4],start:'09:00',end:'14:00',dayTimes:{4:{start:'10:00',end:'13:00'}}})
  ];
  return {series:phases,today,lifecycle:lifecycle(),personName:id=>({anna:'Anna',emma:'Emma',jonas:'Jonas',replacement:'Afløser'})[id]||id,sites:[{name:'Kontor Nord'},{name:'Klinikken'}],edits:{'phase-a@2026-10-19':shift('phase-a@2026-10-19','2026-11-04',{seriesId:'phase-a',person:'replacement',site:1,start:'11:00',end:'12:00'})},deleted:['phase-b@2026-10-29'],...patch};
}

test('canonical lifecycle groups phases into one agreement with representative, aggregate actual shifts and exception counts',()=>{
  const options=agreementFixture(),before=JSON.stringify(options.series),view=Overview.model(options);
  assert.equal(view.entries.length,1);assert.deepEqual(view.counts,{active:1,upcoming:0,ended:0,all:1});
  const entry=view.entries[0];assert.equal(entry.id,'agreement');assert.equal(entry.series.id,'phase-b');assert.equal(entry.latest.id,'phase-c');assert.equal(entry.phases.length,3);
  assert.equal(entry.next.id,'phase-c@2026-11-02');assert.equal(entry.upcoming.length,3);assert.deepEqual(entry.upcoming.map(item=>item.date),['2026-11-02','2026-11-04','2026-11-06']);
  assert.equal(entry.exceptions,2);assert.equal(entry.exceptionDetails.edited,1);assert.equal(entry.exceptionDetails.deleted,1);assert.equal(entry.daysToEnd,9);assert.equal(entry.expiring,true);
  const root=Overview.render({...options,document:document()});assert.equal(byClass(root,'cs-series-row').length,1);assert.equal(byClass(root,'cs-series-upcoming').length,0);openPeriods(root);assert.equal(byClass(root,'cs-series-upcoming')[0].textContent,'3 kommende vagter');assert.equal(byClass(root,'cs-series-exception-count')[0].textContent,'2 undtagelser');
  assert.equal(JSON.stringify(options.series),before);
});

test('agreement filtering runs after grouping so changed employees and sites do not hide phases or counts',()=>{
  const options=agreementFixture(),seen=[];
  const view=Overview.model({...options,filterAgreement:entry=>{seen.push(entry.phases.length);return entry.phases.some(phase=>phase.person==='anna'&&phase.site===0);}});
  assert.deepEqual(seen,[3]);assert.equal(view.entries.length,1);assert.equal(view.entries[0].series.person,'emma');assert.equal(view.entries[0].upcoming.length,3);
  const empty=Overview.render({...options,document:document(),filterAgreement:()=>false,onCreate:()=>assert.fail('Filtered agreements are not a new company.')});
  assert.ok(empty.textContent.includes('Ingen serier matcher filtrene'));assert.equal(byClass(empty,'cs-series-row').length,0);assert.equal(walk(empty).some(node=>node.dataset.productFocus==='series:create'),false);
});

test('expiry uses the final phase and independent legacy IDs remain separate even with identical people and patterns',()=>{
  const options=agreementFixture(),phases=options.series.map(phase=>phase.id==='phase-c'?{...phase,endDate:'2026-12-31'}:phase);
  const group=Overview.model({...options,series:phases}).entries[0];assert.equal(group.expiring,false);assert.equal(group.endDate,'2026-12-31');
  const single=series('separate',{person:'emma'}),both=Overview.model({...options,series:[...phases,single]});assert.equal(both.entries.length,2);
  const closed=Overview.model({...options,today:'2026-11-09'});assert.equal(closed.entries[0].status,'ended');assert.equal(closed.entries[0].expiring,false);
});

test('copy edits the relevant phase, extension appends after the last phase, and each timeline period can be edited',()=>{
  const events=[],options=agreementFixture({onEdit:(...args)=>events.push(['edit',...args]),onCopy:(...args)=>events.push(['copy',...args]),onExtend:(...args)=>events.push(['extend',...args])});
  const root=Overview.render({...options,document:document()}),row=byClass(root,'cs-series-row')[0];
  const primary=walk(row).find(node=>node.dataset.productFocus==='series:agreement:edit'),copy=walk(row).find(node=>node.dataset.productFocus==='series:agreement:copy'),extend=walk(row).find(node=>node.dataset.productFocus==='series:agreement:extend');
  primary.click();copy.click();extend.click();
  assert.equal(events[0][1].id,'phase-b');assert.equal(events[0][2],primary);assert.equal(events[1][1].id,'phase-b');assert.equal(events[1][2].dataset.productFocus,'series:agreement:more');assert.equal(events[1][3].id,'agreement');assert.equal(events[2][1].id,'phase-c');assert.equal(events[2][2],events[1][2]);assert.equal(events[2][3].phases.length,3);
  assert.equal(extend.dataset.expiring,'true');assert.equal(byClass(row,'cs-series-period').length,0);openPeriods(row);assert.equal(byClass(row,'cs-series-period').length,3);
  const historical=walk(row).find(node=>node.dataset.productFocus==='series:phase-a:edit-period');historical.click();assert.equal(events[3][1].id,'phase-a');assert.equal(events[3][2],historical);
});

test('per-day times are visible, title each selected weekday and survive grouped timeline rendering without changing frozen data',()=>{
  const options=agreementFixture(),phases=freeze(options.series.map(phase=>phase.id==='phase-b'?{...phase,dayTimes:{3:{start:'10:00',end:'12:00'}}}:phase));
  const before=JSON.stringify(phases),root=Overview.render({...options,series:phases,document:document()});
  assert.equal(byClass(root,'cs-series-row-time')[0].textContent,'Varierende tider');assert.equal(byClass(root,'cs-series-pattern-times')[0].textContent,'Tir 08:00–16:00 · Tor 10:00–12:00');
  assert.equal(byClass(root,'cs-series-weekday')[3].title,'Torsdag 10:00–12:00');openPeriods(root);assert.ok(byClass(root,'cs-series-period').find(item=>item.dataset.phaseId==='phase-c').textContent.includes('Fre 10:00–13:00'));
  assert.equal(JSON.stringify(phases),before);
});

test('controlled disclosure state is not mutated and uncontrolled state survives a render for focus restoration',()=>{
  const options=agreementFixture(),expanded=new Set(['agreement']),events=[],doc=document();
  const root=Overview.render({...options,document:doc,expandedGroups:expanded,onToggleGroup:(...args)=>events.push(args)}),details=byClass(root,'cs-series-timeline')[0];
  assert.equal(details.open,true);details.open=false;details.handlers.toggle();assert.deepEqual(events,[['agreement',false]]);assert.deepEqual([...expanded],['agreement']);
  const local=Overview.render({...options,document:doc}),localDetails=byClass(local,'cs-series-timeline')[0];localDetails.open=true;localDetails.handlers.toggle();
  assert.equal(byClass(Overview.render({...options,document:doc}),'cs-series-timeline')[0].open,true);
});

test('the register exposes one edit action, a dismissible overflow menu and only meaningful main-row facts',()=>{
  const events=[],doc=document(),options=fixture({document:doc,onEdit:(...args)=>events.push(args),onShow(){},onCopy:(...args)=>events.push(args),onExtend(){}}),root=Overview.render(options),rows=byClass(root,'cs-series-row');
  assert.equal(byClass(root,'cs-series-register-columns')[0].textContent,'Medarbejder / arbejdsstedUgeplanPeriodeOverblik');
  const row=rows.find(item=>item.dataset.seriesId==='active'),actions=byClass(row,'cs-series-row-actions')[0];
  assert.equal(actions.children.filter(item=>item.tagName==='button').length,1);assert.equal(actions.children[0].textContent,'Rediger');
  assert.equal(byClass(row,'cs-series-exception-count').length,0);assert.equal(byClass(row,'cs-series-upcoming').length,0);
  const menu=byClass(row,'cs-series-row-menu')[0],trigger=byClass(row,'cs-series-more')[0];
  menu.open=true;menu.handlers.toggle();const other=byClass(rows.find(item=>item!==row),'cs-series-row-menu')[0];other.open=true;other.handlers.toggle();assert.equal(menu.open,false);assert.equal(other.open,true);
  menu.open=true;let prevented=false;menu.handlers.keydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){}});assert.equal(prevented,true);assert.equal(menu.open,false);assert.equal(doc.activeElement,trigger);
  menu.open=true;walk(menu).find(item=>item.dataset.productFocus==='series:active:copy').click();assert.equal(menu.open,false);assert.equal(events[0][1],trigger);
});

test('period details build once on demand and show the next change without repeating the next-vagter count in the row',()=>{
  const root=Overview.render({...agreementFixture(),document:document()}),timeline=byClass(root,'cs-series-timeline')[0],body=byClass(root,'cs-series-agreement-details')[0];
  assert.equal(body.children.length,0);assert.equal(byClass(root,'cs-series-period').length,0);
  assert.ok(byClass(root,'cs-series-next-change')[0].textContent.includes('2. nov. 2026'));assert.ok(timeline.textContent.startsWith('Vis 3 perioder2 undtagelser'));
  timeline.open=true;timeline.handlers.toggle();const original=[...body.children];assert.equal(byClass(body,'cs-series-period').length,3);assert.equal(byClass(body,'cs-series-upcoming')[0].textContent,'3 kommende vagter');
  timeline.open=false;timeline.handlers.toggle();timeline.open=true;timeline.handlers.toggle();assert.ok(original.every((item,index)=>body.children[index]===item));
});

test('summary-only agreements render in bounded batches and retain revealed rows across same-filter rerenders',()=>{
  const doc=document(),templates=Array.from({length:123},(_,index)=>series('bounded-'+String(index).padStart(3,'0'),{startDate:'2026-01-01',endDate:'2026-12-31',weekdays:[0,1,2,3,4]})),agreements=lifecycle().summarizeSeries(templates,{today}),options={document:doc,agreements,today,status:'all',personName:id=>id,onEdit(){}};
  assert.equal(agreements.every(item=>item.shifts===undefined&&item.upcoming===undefined),true);
  const root=Overview.render(options);assert.equal(byClass(root,'cs-series-row').length,50);assert.equal(byClass(root,'cs-series-period').length,0);assert.equal(byClass(root,'cs-series-status')[3].getAttribute('aria-label'),'Alle · 123 serier');
  const more=walk(root).find(item=>item.dataset.productFocus==='series:show-more'),progress=byClass(root,'cs-series-register-progress')[0];assert.equal(progress.textContent,'50 af 123 serier');more.click();assert.equal(byClass(root,'cs-series-row').length,100);assert.equal(progress.textContent,'100 af 123 serier');
  doc.querySelector=()=>root;let refreshed=Overview.render(options);assert.equal(byClass(refreshed,'cs-series-row').length,100);
  more.click();assert.equal(byClass(root,'cs-series-row').length,123);assert.equal(more.hidden,true);assert.equal(doc.activeElement,progress);
  const timeline=byClass(root,'cs-series-timeline')[0];timeline.open=true;timeline.handlers.toggle();assert.ok(byClass(root,'cs-series-upcoming')[0].textContent.includes('kommende vagter'));
  refreshed=Overview.render({...options,status:'active'});assert.equal(byClass(refreshed,'cs-series-row').length,50,'Changing filters starts at the first bounded batch.');
});

test('demo examples are opt-in, dispatch their exact trigger and stay locked once installed',()=>{
  const options=fixture(),normal=Overview.render({...options,document:document()});
  assert.equal(walk(normal).some(node=>node.id==='cs-series-demo-examples'),false);assert.equal(byClass(normal,'cs-series-example-label').length,0);
  const calls=[],root=Overview.render({...options,document:document(),demoExamples:{installed:false,onAdd:trigger=>calls.push(trigger),labelFor:entry=>entry.series.id==='active'?'Tider pr. ugedag':''}});
  const add=walk(root).find(node=>node.id==='cs-series-demo-examples');assert.equal(add.textContent,'Tilføj eksempelserier');assert.equal(add.type,'button');assert.equal(add.disabled,false);assert.equal(add.dataset.productFocus,'series:demo-examples');assert.ok(add.title.includes('eksempler'));add.click();assert.deepEqual(calls,[add]);
  const labels=byClass(root,'cs-series-example-label');assert.equal(labels.length,1);assert.equal(labels[0].textContent,'Tider pr. ugedag');assert.equal(labels[0].getAttribute('aria-label'),'Eksempel: Tider pr. ugedag');
  const installed=Overview.render({...options,document:document(),demoExamples:{installed:true,onAdd:()=>assert.fail('Installed examples must not dispatch.')}}),locked=walk(installed).find(node=>node.id==='cs-series-demo-examples');
  assert.equal(locked.textContent,'Eksempler indlæst');assert.equal(locked.disabled,true);locked.click();
});

test('open-ended agreements show no technical end date, expiry or fabricated remaining count',()=>{
  const open=series('open',{openEnded:true,endDate:'2100-12-31'}),finite=series('finite',{endDate:'2027-04-30'});
  const agreement=(phase,patch={})=>({id:phase.id,groupId:phase.id,summary:true,phases:[phase],representative:phase,latest:phase,startDate:phase.startDate,endDate:phase.endDate,upcomingCount:40,next:shift(phase.id+'@2026-11-03','2026-11-03'),exceptions:{count:0},...patch});
  const options={today,agreements:[agreement(open,{openEnded:true,upcomingCount:null}),agreement(finite)],personName:id=>id,sites:[{name:'Kontor Nord'}],onEdit(){},onCopy(){},onExtend(){},expandedGroups:new Set(['open','finite'])};
  const view=Overview.model(options),openEntry=view.entries.find(entry=>entry.id==='open'),finiteEntry=view.entries.find(entry=>entry.id==='finite');
  assert.equal(openEntry.openEnded,true);assert.equal(openEntry.status,'active');assert.equal(openEntry.daysToEnd,null);assert.equal(openEntry.expiring,false);assert.equal(openEntry.upcomingCount,null);
  assert.equal(finiteEntry.openEnded,false);assert.equal(finiteEntry.upcomingCount,40);assert.equal(finiteEntry.expiring,false);assert.equal(finiteEntry.endDate,'2027-04-30');
  const root=Overview.render({...options,document:document()}),openRow=byClass(root,'cs-series-row').find(row=>row.dataset.seriesId==='open'),finiteRow=byClass(root,'cs-series-row').find(row=>row.dataset.seriesId==='finite');
  assert.equal(byClass(openRow,'cs-series-period-end')[0].textContent,'Uden slutdato');
  assert.equal(byClass(openRow,'cs-series-upcoming')[0].textContent,'Gentages uden slutdato');
  assert.equal(openRow.textContent.includes('2100'),false);assert.equal(openRow.textContent.includes('0 kommende vagter'),false);assert.equal(byClass(openRow,'cs-series-expiry').length,0);
  const phaseEdit=walk(openRow).find(node=>node.dataset.productFocus==='series:open:edit-period');
  assert.equal(phaseEdit.getAttribute('aria-label'),'Rediger perioden fra 1. okt. 2026 uden slutdato for open');
  assert.equal(walk(openRow).some(node=>node.dataset.productFocus==='series:open:extend'),false);
  assert.ok(walk(finiteRow).some(node=>node.dataset.productFocus==='series:finite:extend'));
  assert.equal(byClass(finiteRow,'cs-series-period-end')[0].textContent,'– 30. apr. 2027');assert.equal(byClass(finiteRow,'cs-series-upcoming')[0].textContent,'40 kommende vagter');
  const nearBoundary=Overview.model({...options,today:'2100-12-20',agreements:[agreement(open,{openEnded:true,upcomingCount:null,next:null})]}).entries[0];
  assert.equal(nearBoundary.status,'active');assert.equal(nearBoundary.expiring,false);assert.equal(nearBoundary.daysToEnd,null);
});

test('fallback overview derives open-endedness from the explicit latest phase flag and never leaves an empty extend-only menu',()=>{
  const open=series('open-fallback',{openEnded:true,endDate:'2100-12-31'}),options={series:[open],lifecycle:{},today,shiftsForSeries:()=>[],personName:id=>id,onExtend(){},expandedGroups:new Set(['open-fallback'])};
  const entry=Overview.model(options).entries[0];assert.equal(entry.openEnded,true);assert.equal(entry.upcomingCount,null);
  const root=Overview.render({...options,document:document()});assert.equal(byClass(root,'cs-series-row-menu').length,0);assert.equal(byClass(root,'cs-series-upcoming')[0].textContent,'Gentages uden slutdato');
  const unflagged=Overview.model({...options,series:[series('legacy-finite',{endDate:'2100-12-31'})]}).entries[0];
  assert.equal(unflagged.openEnded,false,'A date value alone cannot turn a finite agreement into an endless one.');assert.equal(unflagged.upcomingCount,0);
});
