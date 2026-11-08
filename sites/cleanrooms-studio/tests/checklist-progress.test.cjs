const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Description = require('../src/description-model.js');
const Checklist = require('../src/checklist-progress.js');

const text = (value,marks) => ({type:'text',text:value,...(marks ? {marks} : {})});
const paragraph = (...content) => ({type:'paragraph',content});
const task = label => ({type:'taskItem',attrs:{checked:true},content:[paragraph(text(label))]});
const doc = (...items) => ({type:'doc',content:[{type:'taskList',content:items}]});
const rich = (...labels) => Description.encode(doc(...labels.map(task)));
const shift = overrides => ({id:'series@2026-10-27',seriesId:'series',person:'p0',date:'2026-10-27',site:0,start:'07:00',end:'15:00',note:'Rengør køkkenet\nLås døren',noteRich:rich('Rengør køkkenet','Lås døren'),...overrides});
const freeze = value => { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };
const clone = value => JSON.parse(JSON.stringify(value));
function toggle(progress,current,index,checked=true) {
  const view=Checklist.read(progress,current);
  return Checklist.set(progress,current,{key:view.tasks[index].key,checked,signature:view.signature,person:current.person});
}
function completed(current,indices=[0,1]) {
  let progress={};
  for(const index of indices) {
    const result=toggle(progress,current,index);assert.equal(result.ok,true);progress=result.progress;
  }
  return progress;
}

test('tasks have stable canonical paths in DOM preorder without rewriting template attributes',()=>{
  const parent=task('Parent');parent.content.push({type:'taskList',content:[task('Nested 🧽')]});
  const raw=freeze(doc(parent,task('Sibling'))),before=JSON.stringify(raw),items=Checklist.tasks(raw);
  assert.deepEqual(items.map(item=>item.key),['0.0','0.0.1.0','0.1']);
  assert.deepEqual(items.map(item=>item.path),items.map(item=>item.key));
  assert.deepEqual(items.map(item=>item.text),['Parent','Nested 🧽','Sibling']);
  assert.ok(items.every(item=>typeof item.signature==='string'&&item.signature.length>0));
  assert.equal(JSON.stringify(raw),before);
  assert.equal(raw.content[0].content[0].attrs.checked,true);
  assert.deepEqual(Checklist.tasks(JSON.stringify(raw)),items);
});

test('fresh assigned occurrences ignore checked template attributes and start incomplete',()=>{
  const current=freeze(shift({noteRich:JSON.stringify(doc(task('One'),task('Two')))})),before=JSON.stringify(current);
  const view=Checklist.read({},current);
  assert.equal(view.valid,true);assert.equal(view.checked,0);assert.equal(view.total,2);assert.equal(view.complete,false);
  assert.ok(view.tasks.every(item=>item.checked===false));
  assert.equal(JSON.stringify(current),before);
});

test('checking and unchecking persist exact tasks immutably and remove empty occurrence records',()=>{
  const current=freeze(shift()),empty=freeze({});
  const first=toggle(empty,current,0);
  assert.equal(first.ok,true);assert.equal(first.changed,true);
  assert.equal(first.view.checked,1);assert.equal(first.view.complete,false);
  const before=JSON.stringify(first.progress);freeze(first.progress);
  const second=toggle(first.progress,current,1);
  assert.equal(second.view.checked,2);assert.equal(second.view.complete,true);
  assert.equal(JSON.stringify(first.progress),before);
  assert.deepEqual(empty,{});
  const same=toggle(second.progress,current,1);assert.equal(same.changed,false);
  const third=toggle(second.progress,current,0,false),last=toggle(third.progress,current,1,false);
  assert.equal(last.view.checked,0);assert.deepEqual(last.progress,{});
});

test('other series occurrences and copies start fresh while moving the same occurrence retains completion',()=>{
  const current=shift(),progress=completed(current,[1]);
  const moved={...current,date:'2026-11-05',site:2,start:'08:00',end:'16:00'};
  assert.equal(Checklist.read(progress,moved).checked,1);
  assert.equal(Checklist.read(progress,{...current,id:'series@2026-10-29',date:'2026-10-29'}).checked,0);
  assert.equal(Checklist.read(progress,{...current,id:'copy-occurrence',seriesId:undefined}).checked,0);
  assert.equal(Checklist.read(progress,{...current,id:'new-series@2026-10-27',seriesId:'new-series'}).checked,0);
  assert.equal(Checklist.read(progress,{...current,person:'p1'}).checked,0);
});

test('editing one task text or its formatting resets that task and keeps unchanged siblings completed',()=>{
  const current=shift(),progress=completed(current);
  const edited={...current,noteRich:rich('Rengør køkkenet','Lås hoveddøren')};
  assert.deepEqual(Checklist.read(progress,edited).tasks.map(item=>item.checked),[true,false]);
  const formatted=doc(task('Rengør køkkenet'),task('Lås døren'));
  formatted.content[0].content[1].content[0].content[0].marks=[{type:'bold'}];
  assert.deepEqual(Checklist.read(progress,{...current,noteRich:Description.encode(formatted)}).tasks.map(item=>item.checked),[true,false]);
  const cleaned=Checklist.reconcile(progress,[edited]);
  assert.equal(Checklist.read(cleaned,edited).checked,1);
  assert.equal(Checklist.read(cleaned,current).checked,1,'A removed signature must not resurrect when old wording returns.');
});

test('nested task edits do not invalidate completed parent or sibling tasks',()=>{
  const parent=task('Parent');parent.content.push({type:'taskList',content:[task('Nested')]});
  const current=shift({noteRich:Description.encode(doc(parent,task('Sibling')))}),progress=completed(current,[0,1,2]);
  const edited={...current,noteRich:current.noteRich.replace('Nested','Changed nested')};
  assert.deepEqual(Checklist.read(progress,edited).tasks.map(item=>item.checked),[true,false,true]);
});

test('task insertions and removals reset topology rather than transferring completion to identical new labels',()=>{
  const current=shift({noteRich:rich('Same','Same')}),progress=completed(current,[0]);
  assert.equal(Checklist.read(progress,{...current,noteRich:rich('Same','Same','Same')}).checked,0);
  assert.equal(Checklist.read(progress,{...current,noteRich:rich('Same')}).checked,0);
  const removed=Checklist.reconcile(progress,[{...current,noteRich:rich('Same')}]);
  assert.deepEqual(removed,{});
});

test('stale list signatures, changed assignees and invalid toggles cannot alter saved completion',()=>{
  const current=shift(),progress=freeze(completed(current,[0])),before=JSON.stringify(progress),captured=Checklist.read(progress,current);
  const input={key:captured.tasks[1].key,checked:true,signature:captured.signature,person:current.person};
  const cases=[
    [{...current,noteRich:rich('Changed','Lås døren')},input],
    [{...current,person:'p1'},input],
    [current,{...input,key:'missing'}],
    [current,{...input,checked:1}],
    [current,{...input,signature:undefined}],
    [current,{...input,person:undefined}]
  ];
  for(const [fresh,options] of cases) {
    const result=Checklist.set(progress,fresh,options);
    assert.equal(result.ok,false);assert.equal(result.changed,false);assert.ok(result.reason);
    assert.deepEqual(result.progress,progress);
  }
  assert.equal(JSON.stringify(progress),before);
});

test('reconciliation prunes changed assignees and explicit deletions while preserving unseen weeks',()=>{
  const current=shift(),unseen=shift({id:'series@2027-03-04',date:'2027-03-04'});
  let progress=completed(current,[0]);progress=toggle(progress,unseen,1).progress;
  freeze(progress);const before=JSON.stringify(progress);
  const reassigned=Checklist.reconcile(progress,[{...current,person:'p1'}]);
  assert.equal(Checklist.read(reassigned,current).checked,0);
  assert.equal(Checklist.read(reassigned,{...current,person:'p1'}).checked,0);
  assert.equal(Checklist.read(reassigned,unseen).checked,1);
  const deleted=Checklist.reconcile(progress,[],{deletedIds:[current.id]});
  assert.equal(Checklist.read(deleted,current).checked,0);assert.equal(Checklist.read(deleted,unseen).checked,1);
  const unassigned=Checklist.reconcile(progress,[{...current,person:''}]);
  assert.equal(Checklist.read(unassigned,current).checked,0);assert.equal(Checklist.read(unassigned,unseen).checked,1);
  assert.equal(JSON.stringify(progress),before);
});

test('a new assignee write removes prior owners and occurrence keys cannot collide through delimiters',()=>{
  const first=shift({id:'quoted, ["id"]',person:'p0|p1'}),second={...first,person:'p0'};
  let progress=completed(first,[0]);progress=toggle(progress,second,1).progress;
  assert.equal(Checklist.read(progress,first).checked,0);
  assert.equal(Checklist.read(progress,second).checked,1);
  assert.equal(Object.keys(progress).length,1);
  const third=shift({id:'__proto__',person:'constructor'});
  progress=toggle(progress,third,0).progress;
  assert.equal(Checklist.read(progress,third).checked,1);
  assert.equal(Checklist.read(progress,second).checked,1);
  assert.equal(Object.getPrototypeOf(progress),Object.prototype);
});

test('sanitization validates persisted entries and returns independent serializable objects',()=>{
  const current=shift(),valid=completed(current,[0]),key=Object.keys(valid)[0],entry=valid[key];
  const malformed=[null,[],42,{'bad-key':entry},
    {[key]:{...entry,version:2}},
    {[key]:{...entry,person:''}},
    {[key]:{...entry,structure:'bad json'}},
    {[key]:{...entry,structure:'["__proto__"]'}},
    {[key]:{...entry,structure:'["0.0","0.0"]'}},
    {[key]:{...entry,checked:[]}},
    {[key]:{...entry,checked:{'0.0':true}}}
  ];
  for(const value of malformed) assert.deepEqual(Checklist.sanitize(value),{});
  const saved=freeze(clone(valid)),restored=Checklist.sanitize(saved);
  assert.deepEqual(restored,valid);assert.notStrictEqual(restored[key],saved[key]);
  assert.notStrictEqual(restored[key].checked,saved[key].checked);
  restored[key].checked['0.0']='changed';
  assert.equal(Checklist.read(saved,current).checked,1);
  assert.equal(Checklist.read(clone(valid),current).checked,1);
});

test('long Unicode and literal markup task text retains exact signatures without modifying templates',()=>{
  const label='  ÆØÅ 🧽 <script>alert(1)</script>\n'.repeat(2000),current=freeze(shift({note:label,noteRich:rich(label)}));
  assert.ok(current.noteRich.length>50000);
  const before=JSON.stringify(current),progress=completed(current,[0]),restored=Checklist.sanitize(clone(progress));
  assert.equal(Checklist.read(restored,current).checked,1);
  assert.equal(Checklist.tasks(current.noteRich)[0].text,label.trim());
  assert.equal(JSON.stringify(current),before);
  assert.ok(!current.noteRich.includes('"checked":true'));
});

test('invalid or unassigned shifts fail closed and ordinary descriptions have zero tasks without fake completion',()=>{
  for(const current of [null,{},shift({id:''}),shift({person:''}),shift({noteRich:{}}),shift({noteRich:'not json'})]) {
    const view=Checklist.read({},current);assert.equal(view.valid,false);assert.equal(view.complete,false);
    assert.equal(Checklist.set({},current,{}).ok,false);
  }
  for(const noteRich of [undefined,null,'',Description.encode(Description.fromText('Only text'))]) {
    const view=Checklist.read({},shift({noteRich}));
    assert.equal(view.valid,true);assert.equal(view.total,0);assert.equal(view.checked,0);assert.equal(view.complete,false);
  }
  assert.deepEqual(Checklist.tasks('invalid'),[]);
});

test('the module exports the same browser API without CommonJS',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../src/description-model.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/checklist-progress.js'),'utf8'),context);
  assert.equal(typeof context.CleanRoomsChecklist.read,'function');
  assert.equal(context.CleanRoomsChecklist.tasks(rich('One')).length,1);
  assert.equal(globalThis.CleanRoomsChecklist,Checklist);assert.ok(Object.isFrozen(Checklist));
});
