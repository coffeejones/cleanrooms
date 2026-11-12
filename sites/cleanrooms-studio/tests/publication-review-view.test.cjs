const test=require('node:test'),assert=require('node:assert/strict');
const Review=require('../src/publication-review-view.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.listeners={};this.dataset={};this.className='';this.text='';this.value='';this.disabled=false;this.open=false;}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
 async fire(type){for(const handler of this.listeners[type]||[])await handler({target:this,currentTarget:this,preventDefault(){}});}
 async click(){if(!this.disabled)await this.fire('click');}
 matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-publication-review-focus]')return !!this.dataset.publicationReviewFocus;return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 contains(node){return walk(this).includes(node);}focus(){this.ownerDocument.activeElement=this;}
}
const shift=(patch={})=>({id:'shift-a',person:'emma',site:0,date:'2026-11-03',start:'07:00',end:'15:00',plannedBreakMinutes:0,note:'',...patch});
const change=(patch={})=>({id:'shift-a',type:'changed',before:shift(),after:shift({start:'08:00',end:'16:00'}),...patch});
const newShifts=count=>Array.from({length:count},(_,index)=>{
 const id='new-'+index;
 return change({id,type:'added',before:null,after:shift({id})});
});
function fixture(changes=[change()],callbacks={}){
 const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),opened=[],view=Review.mount({element:host,onOpenChange:entry=>opened.push(entry),...callbacks});
 view.render({scopeKey:'week45',changes,people:[{id:'emma',name:'Emma Nielsen'},{id:'noah',name:'Noah Andersen'}],sites:[{name:'Kontor Nord'},{name:'Klinikken'}]});
 const nodes=()=>walk(host),key=value=>nodes().find(el=>el.dataset.publicationReviewFocus===value),byClass=value=>nodes().find(el=>el.className.split(' ').includes(value));
 return {view,host,doc,opened,nodes,key,byClass,rows:()=>nodes().filter(el=>el.className==='cs-publication-review-row'),input:async value=>{const el=key('search');el.value=value;await el.fire('input');}};
}
test('a time change lists only its concrete difference and keeps long instructions out of the initial list',()=>{
 const note='PRIVATE INSTRUCTION '.repeat(1000),sample=fixture([change({before:shift({note}),after:shift({start:'08:00',end:'16:00',note})})]);
 const row=sample.rows()[0].textContent;
 assert.match(row,/07:00–15:00 → 08:00–16:00/);
 assert.equal(row.match(/08:00–16:00/g).length,1);
 assert.equal(sample.host.textContent.includes(note),false);assert.equal(sample.host.textContent.includes('Senest udgivet'),false);assert.equal(row.includes('Pause:'),false);assert.equal(row.includes('Medarbejder:'),false);
});
test('changed people, location, date and pause remain explicit without conflating them with time changes',()=>{
 const sample=fixture([change({after:shift({date:'2026-11-04',person:'noah',site:1,plannedBreakMinutes:30})})]);
 const text=sample.rows()[0].textContent;assert.match(text,/Dato:/);assert.match(text,/Emma Nielsen → Noah Andersen/);assert.match(text,/Kontor Nord → Klinikken/);assert.match(text,/Pause: 0 → 30 min/);assert.equal(text.includes('07:00–15:00 → 07:00–15:00'),false);
 const heading=sample.byClass('cs-publication-review-day-title').textContent;
 assert.match(heading,/4.*nov/);
 assert.doesNotMatch(heading,/Uge 45/);
});
test('filters and search on larger lists find both former and new assignees or worksites',async()=>{
 const records=[change({id:'edit',after:shift({person:'noah',site:1})}),...newShifts(5),change({id:'gone',type:'removed',before:shift({id:'gone',person:'noah'}),after:null})],sample=fixture(records);
 assert.equal(sample.key('filter:all').textContent,'Alle');await sample.key('filter:changed').click();assert.equal(sample.rows().length,1);assert.equal(sample.rows()[0].dataset.changeId,'edit');
 await sample.input('Emma Nielsen');assert.equal(sample.rows().length,1);await sample.input('Klinikken');assert.equal(sample.rows().length,1);await sample.input('Ingen');assert.equal(sample.rows().length,0);assert.match(sample.host.textContent,/Ingen ændringer matcher/);
 await sample.input('');await sample.key('filter:removed').click();assert.equal(sample.rows().length,1);assert.match(sample.rows()[0].textContent,/Aflyst/);assert.equal(sample.rows()[0].textContent.includes('→'),false);
});
test('53 changes paginate in groups of twenty and search and filters cover every page',async()=>{
 const cancellation=change({id:'gone',type:'removed',before:shift({id:'gone',site:1,date:'2026-11-04'}),after:null});
 const sample=fixture([...newShifts(52),cancellation]);
 const pageLabel=()=>sample.byClass('cs-publication-review-muted')?.textContent;
 assert.equal(sample.key('filter:changed'),undefined);
 assert.equal(sample.rows().length,20);
 assert.equal(pageLabel(),'1–20 af 53');
 assert.equal(sample.key('page:previous').disabled,true);
 assert.equal(sample.key('change:gone'),undefined);
 await sample.key('page:next').click();
 assert.equal(sample.rows().length,20);
 assert.equal(pageLabel(),'21–40 af 53');
 await sample.key('page:next').click();
 assert.equal(sample.rows().length,13);
 assert.equal(pageLabel(),'41–53 af 53');
 assert.equal(sample.rows().at(-1).dataset.changeId,'gone');
 assert.equal(sample.key('page:next').disabled,true);
 assert.equal(sample.doc.activeElement.dataset.publicationReviewFocus,'page:previous');
 await sample.key('page:previous').click();
 await sample.key('page:previous').click();
 await sample.input('Klinikken');
 assert.deepEqual(sample.rows().map(row=>row.dataset.changeId),['gone']);
 assert.equal(pageLabel(),undefined);
 await sample.input('');
 assert.equal(pageLabel(),'1–20 af 53');
 await sample.key('filter:removed').click();
 assert.deepEqual(sample.rows().map(row=>row.dataset.changeId),['gone']);
 assert.equal(sample.key('page:next'),undefined);
});
test('focused comparisons contain only changed rows and preserve list focus on return',async()=>{
 const entry=change(),sample=fixture([entry]);await sample.key('change:shift-a').click();assert.equal(sample.doc.activeElement.dataset.publicationReviewFocus,'back');
 const table=sample.byClass('cs-publication-review-comparison'),rows=table.querySelector('tbody').children;assert.equal(rows.length,1);assert.equal(rows[0].dataset.field,'time');assert.deepEqual(rows[0].children.map(cell=>cell.textContent),['Arbejdstid','07:00–15:00','08:00–16:00']);assert.equal(rows[0].children[2].dataset.changed,'true');
 await sample.key('open:calendar').click();assert.equal(sample.opened[0],entry);await sample.key('back').click();assert.equal(sample.doc.activeElement.dataset.publicationReviewFocus,'change:shift-a');assert.equal(sample.rows().length,1);
});
test('instruction changes are lazy and plain text is never parsed as markup',async()=>{
 const before='<img src=x onerror=alert(1)>',after='Updated <script>never execute</script>\n'+'Long instructions '.repeat(1000),sample=fixture([change({before:shift({note:before}),after:shift({note:after})})]);assert.match(sample.rows()[0].textContent,/Instruktioner opdateret/);assert.equal(sample.host.textContent.includes(before),false);
 await sample.key('change:shift-a').click();assert.equal(sample.byClass('cs-publication-review-comparison'),undefined);const details=sample.byClass('cs-publication-review-instructions');assert.equal(details.children.length,1);assert.equal(sample.host.textContent.includes(after),false);details.open=true;await details.fire('toggle');assert.equal(sample.nodes().some(node=>['IMG','SCRIPT'].includes(node.tagName)),false);assert.ok(sample.host.textContent.includes(before));assert.ok(sample.host.textContent.includes(after));
});
test('a parent refresh keeps scope filters and details while a new period resets them',async()=>{
 const sample=fixture([change(),...newShifts(6)]);await sample.key('filter:changed').click();await sample.input('Emma');sample.view.render({scopeKey:'week45',changes:[change({after:shift({start:'09:00',end:'17:00'})}),...newShifts(1)]});assert.equal(sample.key('filter:changed').getAttribute('aria-pressed'),'true');assert.equal(sample.key('search').value,'Emma');assert.match(sample.rows()[0].textContent,/09:00–17:00/);
 await sample.key('change:shift-a').click();sample.view.render({scopeKey:'week45',changes:[change({after:shift({start:'10:00',end:'18:00'})})]});assert.ok(sample.byClass('cs-publication-review-comparison'));assert.match(sample.host.textContent,/10:00–18:00/);
 sample.view.render({scopeKey:'week46',changes:[change({id:'other',after:shift({id:'other'})})]});assert.equal(sample.view.capture().filter,'all');assert.equal(sample.key('search'),undefined);assert.equal(sample.view.capture().query,'');assert.equal(sample.byClass('cs-publication-review-comparison'),undefined);
});
test('added and cancelled shifts show complete context with no fabricated opposing shift',async()=>{
 for(const type of ['added','removed']){
  const sample=fixture([change({type,before:type==='removed'?shift():null,after:type==='added'?shift():null})]);
  assert.equal(sample.key('search'),undefined);
  assert.equal(sample.key('filter:all'),undefined);
  assert.equal(sample.byClass('cs-publication-review-pagination'),undefined);
  assert.match(sample.rows()[0].textContent,/07:00–15:00 · Kontor Nord/);
  sample.view.render({scopeKey:'week45',scopeSiteIds:[0]});
  assert.match(sample.rows()[0].textContent,/07:00–15:00/);
  assert.doesNotMatch(sample.rows()[0].textContent,/Kontor Nord/);
  await sample.key('change:shift-a').click();
  const rows=sample.byClass('cs-publication-review-comparison').querySelector('tbody').children;
  assert.equal(rows.length,5);
  assert.ok(rows.every(row=>row.children[type==='added'?1:2].textContent==='—'));
 }
});
test('unknown dates are readable and disposed views cannot dispatch callbacks',async()=>{
 assert.equal(Review.dateLabel('2026-02-31'),'Dato mangler');assert.equal(Review.dateLabel(undefined),'Dato mangler');const sample=fixture();await sample.key('change:shift-a').click();const old=sample.key('open:calendar');sample.view.dispose();await old.click();sample.view.render({changes:[change()]});assert.equal(sample.opened.length,0);assert.equal(sample.host.children.length,0);
});

test('missing before snapshots do not make every new shift match vacant or unknown-worksite searches',async()=>{
 const sample=fixture([...newShifts(6),change({id:'vacant',type:'added',before:null,after:shift({id:'vacant',person:''})})]);await sample.input('Ledig vagt');assert.equal(sample.rows().length,1);assert.equal(sample.rows()[0].dataset.changeId,'vacant');await sample.input('Ukendt arbejdssted');assert.equal(sample.rows().length,0);
});


test('a closed review can restore presentation preferences without reusing publication authority or old snapshots',async()=>{
 const first=fixture([change(),...newShifts(6)]);await first.key('filter:changed').click();await first.input('Emma');await first.key('change:shift-a').click();const saved=first.view.capture();first.view.dispose();
 const second=fixture([]);second.view.restore(saved);second.view.render({scopeKey:'week45',changes:[change({after:shift({start:'10:00',end:'18:00'})}),...newShifts(1)],people:[{id:'emma',name:'Emma Nielsen'}],sites:[{name:'Kontor Nord'}]});
 assert.ok(second.byClass('cs-publication-review-comparison'));assert.match(second.host.textContent,/10:00–18:00/);await second.key('back').click();assert.equal(second.key('filter:changed').getAttribute('aria-pressed'),'true');assert.equal(second.key('search').value,'Emma');
 second.view.restore({...saved,filter:'publish',query:123,pageIndex:-1,selectedId:{id:'shift-a'}});second.view.render({scopeKey:'week45',changes:[]});assert.equal(second.view.capture().filter,'all');assert.equal(second.view.capture().query,'');assert.equal(second.key('search'),undefined);
});
