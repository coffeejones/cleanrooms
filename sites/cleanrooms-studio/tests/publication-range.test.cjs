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
test('presets emit explicit complete ranges and keep the end field on the final week start',()=>{
 const fixture=app();assert.equal(fixture.changes.length,0);fixture.field('preset:4').click();assert.deepEqual(fixture.changes[0],{scope:{from:'2026-11-02',to:'2026-11-29'},meta:{source:'preset'}});assert.equal(fixture.field('from').value,'2026-11-02');assert.equal(fixture.field('to').value,'2026-11-23');assert.equal(fixture.field('preset:4').getAttribute('aria-pressed'),'true');assert.match(fixture.byClass('cs-publication-range-summary').textContent,/4 uger/);
 fixture.field('preset:4').click();assert.equal(fixture.changes.length,1);
});
test('the dropdown selects additional complete weeks and reflects manual ranges',()=>{
 const fixture=app({from:'2026-12-28',to:'2027-01-03'}),more=fixture.field('more');
 fixture.change('more','12');
 assert.deepEqual(fixture.changes[0].scope,{from:'2026-12-28',to:'2027-03-21'});
 assert.equal(fixture.field('to').value,'2027-03-15');
 assert.equal(more.value,'12');
 fixture.change('more','52');
 assert.equal(Range.countWeeks(fixture.controller.value.from,fixture.controller.value.to),52);
 fixture.field('preset:4').click();
 assert.equal(more.value,'');
 fixture.change('to','2027-02-01');
 assert.equal(more.value,'6');
});
test('date editing never publishes partial weeks and invalid drafts preserve the previously reviewed scope',()=>{
 const fixture=app();fixture.change('to','2026-11-25');assert.deepEqual(fixture.changes[0].scope,{from:'2026-11-02',to:'2026-11-29'});assert.equal(fixture.field('to').value,'2026-11-23');
 fixture.change('from','2026-12-01');assert.equal(fixture.controller.valid,false);assert.equal(fixture.changes.length,1);assert.deepEqual(fixture.controller.value,{from:'2026-11-02',to:'2026-11-29'});assert.equal(fixture.field('from').value,'2026-12-01');assert.equal(fixture.field('from').getAttribute('aria-invalid'),'true');assert.equal(fixture.byClass('cs-publication-range-error').hidden,false);assert.match(fixture.byClass('cs-publication-range-summary').textContent,/Ret perioden/);
 fixture.controller.render({from:'2026-11-02',to:'2026-11-29'});assert.equal(fixture.field('from').value,'2026-12-01');assert.equal(fixture.controller.valid,false);
 fixture.change('to','2026-12-07');assert.equal(fixture.controller.valid,true);assert.deepEqual(fixture.changes[1].scope,{from:'2026-11-30',to:'2026-12-13'});assert.deepEqual(fixture.validities.map(value=>value.valid),[false,true]);
});
test('calendar boundaries disable only presets that cannot fit and limit inputs to complete weeks',()=>{
 const fixture=app({minDate:'2026-10-29',maxDate:'2026-11-30'});assert.equal(fixture.field('from').min,'2026-11-02');assert.equal(fixture.field('to').max,'2026-11-23');assert.equal(fixture.field('preset:4').disabled,false);assert.equal(fixture.field('preset:8').disabled,true);fixture.field('preset:8').click();assert.equal(fixture.changes.length,0);
 const more=fixture.field('more');
 assert.equal(more.children.find(option=>option.value==='3').disabled,false);
 assert.equal(more.children.find(option=>option.value==='5').disabled,true);
 fixture.change('more','5');assert.equal(fixture.changes.length,0);
 fixture.change('from','2026-11-16');assert.equal(more.disabled,true);
});
test('disabled and disposed selectors cannot dispatch changes; invalid initial options render a repairable error',()=>{
 const fixture=app({disabled:true});fixture.field('preset:4').click();fixture.change('to','2026-11-23');assert.equal(fixture.changes.length,0);assert.equal(fixture.field('from').disabled,true);fixture.controller.render({disabled:false});const input=fixture.field('to');fixture.controller.dispose();input.value='2026-11-23';input.fire('change');assert.equal(fixture.host.children.length,0);assert.equal(fixture.changes.length,0);
 const invalid=app({from:'invalid',to:'invalid'});assert.equal(invalid.controller.valid,false);assert.equal(invalid.controller.value,null);assert.equal(invalid.byClass('cs-publication-range-error').hidden,false);
});
test('overview compares each chosen week with its own publication, including cancellation and new weeks',()=>{
 const one={id:'one',person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:''},two={id:'two',person:'',site:0,date:'2026-11-10',start:'08:00',end:'16:00',note:''},three={id:'three',person:'p1',site:1,date:'2026-11-11',start:'08:00',end:'16:00',note:''};
 let studio={storageVersion:1,demoSeed:false,organization:Departments.defaultOrganization(),series:[],edits:{one},deleted:[],requests:{},coverageRules:[],weekPlans:{},checklistProgress:{}};
 studio=Publication.publish(studio,{from:'2026-11-02',to:'2026-11-08',siteIds:[0],actor:{userId:'owner',name:'Planlægger'},at:'2026-11-01T12:00:00.000Z'}).studio;studio.edits.two=two;studio.edits.three=three;studio.deleted=['one'];const before=JSON.stringify(studio),weeks=Range.overview(studio,{from:'2026-11-02',to:'2026-11-15',siteIds:[0]});
 assert.deepEqual(weeks.map(({week,shiftCount,added,changed,removed,openCount,hasPublished})=>({week,shiftCount,added,changed,removed,openCount,hasPublished})),[{week:45,shiftCount:0,added:0,changed:0,removed:1,openCount:0,hasPublished:true},{week:46,shiftCount:1,added:1,changed:0,removed:0,openCount:1,hasPublished:false}]);assert.equal(JSON.stringify(studio),before);
});
