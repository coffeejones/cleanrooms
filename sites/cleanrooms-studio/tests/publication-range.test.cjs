const test=require('node:test'),assert=require('node:assert/strict');
const Range=require('../src/publication-range.js'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js');
const walk=node=>[node,...node.children.flatMap(walk)];
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.dataset={};this.listeners={};this.className='';this.text='';this.value='';this.disabled=false;this.hidden=false;}
 set innerHTML(value){throw Error('Range content must stay literal text.');}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
 fire(type){for(const handler of this.listeners[type]||[])handler({target:this,currentTarget:this});}
 click(){if(!this.disabled)this.fire('click');}
}
function app(options={}){const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),changes=[],validities=[],controller=Range.mount({element:host,onChange:(scope,meta)=>changes.push({scope,meta}),onValidityChange:value=>validities.push(value)});controller.render({from:'2026-11-02',to:'2026-11-08',...options});const nodes=()=>walk(host),field=name=>nodes().find(el=>el.dataset.publicationRange===name),byClass=name=>nodes().find(el=>el.className===name);return{host,controller,changes,validities,nodes,field,byClass,change(name,value){const input=field(name);input.value=value;input.fire('change');}};}

test('ranges normalize whole ISO weeks and preserve the last week across year boundaries',()=>{
 assert.deepEqual(Range.normalize({from:'2026-12-30',to:'2027-01-05'}),{from:'2026-12-28',to:'2027-01-10'});
 assert.equal(Range.countWeeks('2026-12-28','2027-01-10'),2);
 assert.deepEqual(Range.weekNumber('2026-12-28'),{week:53,year:2026});assert.deepEqual(Range.weekNumber('2027-01-03'),{week:53,year:2026});assert.deepEqual(Range.weekNumber('2027-01-04'),{week:1,year:2027});
 assert.equal(Range.addDays('2028-02-28',1),'2028-02-29');assert.equal(Range.addDays('2028-02-29',1),'2028-03-01');
});
test('invalid dates, reverse ranges, incomplete boundary weeks and oversized ranges never become scopes',()=>{
 for(const scope of [{from:'2026-02-30'},{from:'2026-11-09',to:'2026-11-08'},{from:'2026-11-02',to:'2027-11-07'},{from:'2026-11-02',minDate:'2026-11-03'},{from:'2026-11-02',maxDate:'2026-11-07'}])assert.throws(()=>Range.normalize(scope),TypeError);
 assert.equal(Range.countWeeks('2026-11-02',Range.addDays('2026-11-02',52*7-1)),52);
 assert.throws(()=>Range.addDays('2026-02-30',1),TypeError);
});
test('summary states both years when the chosen weeks cross the year boundary',()=>{
 assert.match(Range.summary({from:'2026-11-02',to:'2026-11-29'}),/^4 uger · 2\. nov\. – 29\. nov\. 2026$/);
 assert.match(Range.summary({from:'2026-12-28',to:'2027-01-10'}),/2026.*2027/);
 assert.match(Range.summary({from:'2026-11-02'}),/^1 uge ·/);
});
test('week and duration controls select whole weeks and show the resulting dates once',()=>{
 const fixture=app(),caption=fixture.byClass('cs-publication-range-summary');
 assert.equal(fixture.field('week').value,'2026-11-02');
 assert.equal(fixture.field('duration').value,'1');
 assert.equal(caption.textContent,'2.–8. november 2026');
 fixture.change('duration','4');
 assert.deepEqual(fixture.changes[0],{scope:{from:'2026-11-02',to:'2026-11-29'},meta:{source:'duration'}});
 fixture.change('week','2026-11-09');
 assert.deepEqual(fixture.changes[1],{scope:{from:'2026-11-09',to:'2026-12-06'},meta:{source:'week'}});
 assert.equal(fixture.field('duration').value,'4');
 assert.match(caption.textContent,/^9\. november\s*–\s*6\. december 2026$/);
 fixture.change('duration','4');
 assert.equal(fixture.changes.length,2);
});
test('the week menu respects ISO years and a duration can cross the year boundary',()=>{
 const fixture=app({from:'2026-12-28',to:'2027-01-03'});
 const groups=fixture.field('week').children.filter(node=>node.tagName==='OPTGROUP');
 assert.equal(groups.find(group=>group.label==='2026').children.at(-1).textContent,'Uge 53');
 assert.equal(groups.find(group=>group.label==='2027').children[0].value,'2027-01-04');
 fixture.change('duration','2');
 assert.deepEqual(fixture.controller.value,{from:'2026-12-28',to:'2027-01-10'});
 assert.match(fixture.byClass('cs-publication-range-summary').textContent,/december 2026.*januar 2027/);
 fixture.change('duration','52');
 assert.equal(Range.countWeeks(fixture.controller.value.from,fixture.controller.value.to),52);
});
test('browsing a distant year leaves the reviewed scope intact until a complete week is chosen',()=>{
 const fixture=app(),yearField=fixture.byClass('cs-publication-range-year');
 assert.equal(yearField.hidden,true);
 fixture.change('week','other-year');
 assert.equal(yearField.hidden,false);
 assert.equal(fixture.controller.valid,true);
 assert.equal(fixture.changes.length,0);
 assert.equal(fixture.field('week').value,'2026-11-02');
 fixture.change('year','2040');
 assert.equal(fixture.controller.valid,false);
 assert.deepEqual(fixture.controller.value,{from:'2026-11-02',to:'2026-11-08'});
 assert.equal(fixture.changes.length,0);
 const week=fixture.field('week').children.find(node=>node.label==='2040').children[0];
 fixture.change('week',week.value);
 assert.equal(fixture.controller.valid,true);
 assert.equal(yearField.hidden,true);
 assert.equal(fixture.changes[0].scope.from,week.value);
});
test('calendar boundaries hide partial weeks and block an incompatible duration until corrected',()=>{
 const options={minDate:'2026-10-29',maxDate:'2026-11-30'};
 const fixture=app(options),weeks=walk(fixture.field('week')).filter(node=>node.tagName==='OPTION'&&node.value);
 assert.deepEqual(weeks.map(week=>week.value),['2026-11-02','2026-11-09','2026-11-16','2026-11-23']);
 assert.equal(fixture.field('duration').children.find(option=>option.value==='5').disabled,true);
 fixture.change('duration','4');
 fixture.change('week','2026-11-16');
 assert.equal(fixture.controller.valid,false);
 assert.equal(fixture.field('duration').getAttribute('aria-invalid'),'true');
 assert.match(fixture.byClass('cs-publication-range-error').textContent,/Vælg færre uger/);
 assert.equal(fixture.byClass('cs-publication-range-summary').hidden,true);
 fixture.controller.render({from:'2026-11-02',to:'2026-11-29',...options});
 assert.equal(fixture.field('week').value,'2026-11-16');
 assert.deepEqual(fixture.controller.value,{from:'2026-11-02',to:'2026-11-29'});
 fixture.change('duration','2');
 assert.deepEqual(fixture.changes.map(entry=>entry.scope),[
  {from:'2026-11-02',to:'2026-11-29'},
  {from:'2026-11-16',to:'2026-11-29'}
 ]);
 assert.deepEqual(fixture.validities.map(value=>value.valid),[false,true]);
});
test('disabled and disposed selectors cannot dispatch changes and an invalid period is repairable',()=>{
 const fixture=app({disabled:true});
 fixture.change('duration','4');
 fixture.change('week','2026-11-23');
 assert.equal(fixture.changes.length,0);
 assert.equal(fixture.field('week').disabled,true);
 fixture.controller.render({disabled:false});
 const week=fixture.field('week');
 fixture.controller.dispose();
 week.value='2026-11-23';
 week.fire('change');
 assert.equal(fixture.host.children.length,0);
 assert.equal(fixture.changes.length,0);

 const invalid=app({from:'invalid',to:'invalid'});
 assert.equal(invalid.controller.valid,false);
 assert.equal(invalid.controller.value,null);
 assert.equal(invalid.byClass('cs-publication-range-error').hidden,false);
 invalid.change('week','2026-11-09');
 assert.deepEqual(invalid.controller.value,{from:'2026-11-09',to:'2026-11-15'});
});
test('overview compares each chosen week with its own publication, including cancellation and new weeks',()=>{
 const one={id:'one',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:''},two={id:'two',person:'',site:0,date:'2026-11-10',start:'08:00',end:'16:00',note:''},three={id:'three',person:'p1',site:1,date:'2026-11-11',start:'08:00',end:'16:00',note:''};
 let studio={storageVersion:1,demoSeed:false,organization:Departments.defaultOrganization(),series:[],edits:{one},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}};
 studio=Publication.publish(studio,{from:'2026-11-02',to:'2026-11-08',siteIds:[0],actor:{userId:'owner',name:'Planlægger'},at:'2026-11-01T12:00:00.000Z'}).studio;studio.edits.two=two;studio.edits.three=three;studio.deleted=['one'];const before=JSON.stringify(studio),weeks=Range.overview(studio,{from:'2026-11-02',to:'2026-11-15',siteIds:[0]});
 assert.deepEqual(weeks.map(({week,shiftCount,added,changed,removed,openCount,hasPublished})=>({week,shiftCount,added,changed,removed,openCount,hasPublished})),[{week:45,shiftCount:0,added:0,changed:0,removed:1,openCount:0,hasPublished:true},{week:46,shiftCount:1,added:1,changed:0,removed:0,openCount:1,hasPublished:false}]);assert.equal(JSON.stringify(studio),before);
});
