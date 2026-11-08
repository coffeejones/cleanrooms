const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Description = require('../src/description-model.js');

const doc = (...content) => ({type:'doc',content});
const text = (value,marks) => ({type:'text',text:value,...(marks ? {marks} : {})});
const paragraph = (...content) => ({type:'paragraph',...(content.length ? {content} : {})});
const walk = node => [node,...(node.content || []).flatMap(walk)];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

class Element {
  constructor(tag,ownerDocument) {
    this.tagName = tag; this.ownerDocument = ownerDocument; this.children = [];
    this.attributes = {}; this.dataset = {}; this.style = {}; this.className = ''; this.handlers = new Map(); this._text = '';
    this.classList = {toggle:(name,on) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (on) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    }};
  }
  set innerHTML(value) { throw new Error('HTML parsing is forbidden: ' + value); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name,value) { this.attributes[name] = String(value); }
  addEventListener(name,callback) { this.handlers.set(name,callback); }
  change(checked) { this.checked = checked; this.handlers.get('change')?.({target:this}); }
}
function container() {
  const document = {
    createElement:tag => new Element(tag,document),
    createTextNode:value => ({nodeType:3,textContent:String(value),children:[]})
  };
  return document.createElement('div');
}
const descendants = node => [node,...(node.children || []).flatMap(descendants)];
const elements = (node,tag) => descendants(node).filter(child => child.tagName === tag);
const tasks = (...labels) => doc({type:'taskList',content:labels.map(label => ({type:'taskItem',attrs:{checked:true},content:[paragraph(text(label))]}))});

test('the toolbar constants are shared frozen exact allowlists',()=>{
  assert.deepEqual(Description.FONT_FAMILIES,['sans-serif','Arial','Georgia','Courier New']);
  assert.deepEqual(Description.FONT_SIZES,['12px','14px','16px','18px','24px','32px']);
  assert.deepEqual(Description.COLORS,['#30353c','#5d6672','#bb594f','#b1843e','#527bb6','#8d79a8']);
  assert.deepEqual(Description.HIGHLIGHTS,['#fff2bf','#e5edf8','#eee7f6','#f6e4df']);
  for (const values of [Description.FONT_FAMILIES,Description.FONT_SIZES,Description.COLORS,Description.HIGHLIGHTS]) assert.ok(Object.isFrozen(values));
  assert.ok(Object.isFrozen(Description));
});

test('plain text preserves indentation, empty lines, CRLF, Unicode and trailing blank lines exactly',()=>{
  for (const original of ['', '\n', '  indented\n\n\tNæste 😀\n\n', 'før\r\nefter\r\n', 'en\rto']) {
    const rich = Description.fromText(original);
    assert.equal(Description.text(rich),original);
    assert.equal(rich.content.length,original.split('\n').length);
    assert.equal(Description.text(Description.normalize(rich)),original);
  }
});

test('long text has no character cap and literal markup remains literal text',()=>{
  const original = '  Start\n<script>alert("x")</script>\n' + 'langt-ord-😀'.repeat(30000) + '\n\n';
  const rich = Description.fromText(original), encoded = Description.encode(rich);
  assert.ok(encoded.length > 250000);
  assert.equal(Description.text(encoded),original);
  assert.equal(Description.hasContent(encoded),true);
  const target = container(); Description.render(target,encoded);
  assert.equal(elements(target,'script').length,0);
  assert.ok(target.textContent.includes('<script>alert("x")</script>'));
});

test('empty and whitespace-only descriptions encode empty while a horizontal rule is meaningful',()=>{
  for (const original of ['', ' \t\n\r\n ']) {
    assert.equal(Description.hasContent(Description.fromText(original)),false);
    assert.equal(Description.encode(Description.fromText(original)),'');
  }
  assert.equal(Description.hasContent(doc({type:'horizontalRule'})),true);
  assert.ok(Description.encode(doc({type:'horizontalRule'})));
  assert.equal(Description.encode(tasks('   ')),'');
});

test('invalid roots and malformed content fail closed without requiring a DOM',()=>{
  for (const raw of [null,undefined,42,[],{},'', 'not json','{"type":"doc","content":{}}',paragraph(text('wrong root')),doc({type:'paragraph',content:'invalid'})]) {
    assert.equal(Description.normalize(raw),null);
    assert.equal(Description.encode(raw),'');
    assert.equal(Description.text(raw),'');
    assert.equal(Description.hasContent(raw),false);
  }
});

test('unsupported wrappers retain only sanitized safe children and valid block structure',()=>{
  const raw = doc(
    {type:'unsafeWidget',attrs:{onload:'execute'},content:[text('outside'),{type:'paragraph',attrs:{onclick:'bad'},content:[text('<img src=x onerror=alert(1)>')]}]},
    {type:'image',attrs:{src:'javascript:alert(1)'}},
    {type:'script',text:'never converted from an unknown text property'},
    {type:'listItem',content:[paragraph(text('lifted item'))]}
  );
  const safe = Description.normalize(raw);
  assert.deepEqual(safe,doc(paragraph(text('outside')),paragraph(text('<img src=x onerror=alert(1)>')),paragraph(text('lifted item'))));
  assert.ok(!JSON.stringify(safe).includes('onclick'));
});

test('headings and alignment are bounded, while unsupported indentation and arbitrary attributes are stripped',()=>{
  const safe = Description.normalize(doc(
    {type:'heading',attrs:{level:9,textAlign:'center',indent:3,class:'x',style:'position:fixed'},content:[text('Title')]},
    {type:'paragraph',attrs:{textAlign:'left',indent:0,id:'x'},content:[text('Left')]},
    {type:'paragraph',attrs:{textAlign:'evil',indent:99},content:[text('Default')]},
    {type:'blockquote',attrs:{textAlign:'right',indent:2},content:[paragraph(text('Quote'))]},
    {type:'codeBlock',attrs:{textAlign:'center',indent:1},content:[text('Code')]}
  ));
  assert.deepEqual(safe.content[0].attrs,{level:3,textAlign:'center'});
  assert.equal(safe.content[1].attrs,undefined);
  assert.equal(safe.content[2].attrs,undefined);
  assert.equal(safe.content[3].attrs,undefined);
  assert.equal(safe.content[4].attrs,undefined);
  const target = container(); Description.render(target,safe);
  assert.equal(elements(target,'h3')[0].style.textAlign,'center');
  assert.equal(elements(target,'h3')[0].style.marginInlineStart,undefined);
});

test('lists repair unsupported children and guarantee a paragraph first in every item',()=>{
  const raw = doc({type:'orderedList',attrs:{start:4,reversed:true},content:[
    {type:'listItem',content:[{type:'heading',attrs:{level:2},content:[text('Heading item')]}]},
    paragraph(text('A stray paragraph')),
    {type:'taskItem',attrs:{checked:true},content:[paragraph(text('Converted item'))]}
  ]});
  const safe = Description.normalize(raw), list = safe.content[0];
  assert.deepEqual(list.attrs,{start:4});
  assert.equal(list.content.length,3);
  assert.ok(list.content.every(item => item.type === 'listItem' && item.content[0].type === 'paragraph'));
  assert.ok(!JSON.stringify(safe).includes('checked'));
  assert.equal(Description.text(safe),'\nHeading item\nA stray paragraph\nConverted item');
  const target = container(); Description.render(target,safe);
  assert.equal(elements(target,'ol')[0].attributes.start,'4');
});

test('code blocks drop language, marks and other unsafe attributes while retaining complete text',()=>{
  const raw = doc({type:'codeBlock',attrs:{language:'javascript',onclick:'x'},content:[text('  <script>\n',{type:'bold'}),{type:'hardBreak'},text('tail')]});
  const safe = Description.normalize(raw);
  assert.equal(safe.content[0].attrs,undefined);
  assert.deepEqual(safe.content[0].content,[text('  <script>\n\ntail')]);
  const target = container(); Description.render(target,safe);
  assert.equal(elements(target,'pre').length,1); assert.equal(elements(target,'script').length,0);
  assert.equal(elements(target,'code')[0].textContent,'  <script>\n\ntail');
});

test('marks use a canonical order, strip attributes, merge adjacent matching text and respect code exclusion',()=>{
  const safe = Description.normalize(doc(paragraph(
    text('a',[{type:'italic',attrs:{evil:1}},{type:'bold'},{type:'bold'},{type:'unknown'}]),
    text('b',[{type:'bold'},{type:'italic'}]),
    text('code',[{type:'bold'},{type:'code'},{type:'link',attrs:{href:'https://example.com'}}]),
    text('under and strike',[{type:'strike'},{type:'underline'}])
  )));
  assert.deepEqual(safe.content[0].content,[
    text('ab',[{type:'bold'},{type:'italic'}]),text('code',[{type:'code'}]),text('under and strike',[{type:'underline'},{type:'strike'}])
  ]);
  const target = container(); Description.render(target,safe);
  assert.equal(elements(target,'strong')[0].textContent,'ab'); assert.equal(elements(target,'em')[0].textContent,'ab');
  assert.equal(elements(target,'u')[0].textContent,'under and strike'); assert.equal(elements(target,'s')[0].textContent,'under and strike');
});

test('text style attributes accept only the agreed fonts, sizes and two exact palettes',()=>{
  const raw = doc(paragraph(
    text('styled',[{type:'textStyle',attrs:{fontFamily:'"Courier New"',fontSize:'24px',color:'#BB594F',backgroundColor:'#E5EDF8',position:'fixed'}}]),
    text('system',[{type:'textStyle',attrs:{fontFamily:'system',fontSize:12}}]),
    text('plain',[{type:'textStyle',attrs:{fontFamily:'url(x)',fontSize:'1000px',color:'red',backgroundColor:'url(x)'}}])
  ));
  const safe = Description.normalize(raw), children = safe.content[0].content;
  assert.deepEqual(children[0].marks,[{type:'textStyle',attrs:{fontFamily:'Courier New',fontSize:'24px',color:'#bb594f',backgroundColor:'#e5edf8'}}]);
  assert.deepEqual(children[1].marks,[{type:'textStyle',attrs:{fontFamily:'sans-serif',fontSize:'12px'}}]);
  assert.equal(children[2].marks,undefined);
  const target = container(); Description.render(target,safe);
  assert.deepEqual(elements(target,'span')[0].style,{fontFamily:'Courier New',fontSize:'24px',color:'#bb594f',backgroundColor:'#e5edf8'});
});

test('palette-equivalent RGB and opaque RGBA canonicalize to hex without admitting other colors',()=>{
  const colorAttrs = attrs => Description.normalize(doc(paragraph(text('sample',[{type:'textStyle',attrs}])))).content[0].content[0].marks?.[0]?.attrs;
  assert.deepEqual(colorAttrs({color:'RGB(187, 89, 79)',backgroundColor:'rgba(229, 237, 248, 1)'}),{color:'#bb594f',backgroundColor:'#e5edf8'});
  assert.deepEqual(colorAttrs({color:' rgb(48 53 60) ',backgroundColor:'rgba(255 242 191 / 1.0)'}),{color:'#30353c',backgroundColor:'#fff2bf'});
  assert.deepEqual(colorAttrs({color:'rgba(82.0, 123.00, 182, 1.00)',backgroundColor:'rgb(238 231 246 / 1)'}),{color:'#527bb6',backgroundColor:'#eee7f6'});
  for (const color of ['rgb(255, 0, 0)','rgba(187, 89, 79, 0.5)','rgba(187, 89, 79, 0)','rgb(-69, 89, 79)','rgb(187.1, 89, 79)','rgb(443, 89, 79)','rgb(187, 89, 79, 1)','rgba(187, 89, 79)','rgb(187,89,79) url(x)','red']) {
    assert.equal(colorAttrs({color}),undefined,color);
  }
  assert.equal(colorAttrs({backgroundColor:'rgb(48, 53, 60)'}),undefined,'A text color is not automatically a permitted highlight.');
  const safe = doc(paragraph(text('sample',[{type:'textStyle',attrs:{color:'rgb(187,89,79)',backgroundColor:'rgba(229,237,248,1)'}}])));
  const once = Description.encode(safe);
  assert.equal(once,Description.encode(once));
  assert.ok(!once.includes('rgb'));
});

test('only safe explicit link schemes survive and rendered links always isolate their new tab',()=>{
  for (const value of ['javascript:alert(1)','data:text/html,hello','//example.com','/relative','https:\n//example.com','mailto:','tel:']) {
    const safe = Description.normalize(doc(paragraph(text('link',[{type:'link',attrs:{href:value}}]))));
    assert.equal(safe.content[0].content[0].marks,undefined,value);
  }
  for (const value of ['https://example.com/path?q=1','http://example.com','mailto:jonas@example.com','tel:+4512345678']) {
    const safe = Description.normalize(doc(paragraph(text('link',[{type:'link',attrs:{href:value,target:'_self',rel:'opener',onclick:'execute'}}]))));
    const mark = safe.content[0].content[0].marks[0];
    assert.equal(mark.attrs.target,'_blank'); assert.equal(mark.attrs.rel,'noopener noreferrer');
    const target = container(); Description.render(target,safe);
    assert.deepEqual(elements(target,'a')[0].attributes,mark.attrs);
  }
});

test('canonical encoding is idempotent and normalization never mutates frozen input',()=>{
  const original = freeze(doc({type:'taskList',attrs:{ignored:1},content:[{type:'taskItem',attrs:{checked:true},content:[paragraph(text('Do it',[{type:'italic'},{type:'bold'}]))]}]}));
  const before = JSON.stringify(original), first = Description.encode(original), second = Description.encode(first);
  assert.equal(first,second);
  assert.deepEqual(Description.normalize(first),Description.normalize(original));
  assert.equal(JSON.stringify(original),before); assert.equal(original.content[0].content[0].attrs.checked,true);
});

test('all task templates reset checked to false including nested tasks',()=>{
  const raw = tasks('one');
  raw.content[0].content[0].content.push({type:'taskList',content:[{type:'taskItem',attrs:{checked:true,id:'unsafe'},content:[paragraph(text('nested'))]}]});
  const normalized = Description.normalize(raw), items = walk(normalized).filter(node => node.type === 'taskItem');
  assert.equal(items.length,2); assert.ok(items.every(item => JSON.stringify(item.attrs) === '{"checked":false}'));
  assert.equal(Description.normalize(Description.encode(raw)).content[0].content[0].attrs.checked,false);
});

test('readonly rendering disables unchecked tasks and never modifies the template',()=>{
  const raw = freeze(tasks('one','two')), before = JSON.stringify(raw), target = container(), reports = [];
  const result = Description.render(target,raw,{onTaskChange:counts => reports.push(counts)});
  assert.equal(result.element,target); assert.equal(result.checked,0); assert.equal(result.total,2);
  const checkboxes = elements(target,'input');
  assert.ok(checkboxes.every(input => input.type === 'checkbox' && input.disabled && !input.checked && !input.handlers.has('change')));
  assert.deepEqual(reports,[{checked:0,total:2}]); assert.equal(JSON.stringify(raw),before);
});

test('interactive task completion is DOM-local, reports counts and resets on a fresh render',()=>{
  const raw = freeze(tasks('first','second','third')), before = Description.encode(raw), target = container(), reports = [];
  Description.render(target,raw,{interactiveTasks:true,onTaskChange:counts => reports.push(counts)});
  const inputs = elements(target,'input'), rows = elements(target,'li');
  assert.ok(inputs.every(input => !input.disabled && !input.checked));
  inputs[1].change(true); inputs[0].change(true); inputs[1].change(false);
  assert.deepEqual(reports,[{checked:0,total:3},{checked:1,total:3},{checked:2,total:3},{checked:1,total:3}]);
  assert.equal(rows[0].dataset.checked,'true'); assert.equal(rows[0].className,'is-complete');
  assert.equal(rows[1].dataset.checked,'false'); assert.equal(rows[1].className,'');
  assert.equal(Description.encode(raw),before);
  Description.render(target,raw,{interactiveTasks:true,onTaskChange:counts => reports.push(counts)});
  assert.ok(elements(target,'input').every(input => !input.checked));
  assert.deepEqual(reports.at(-1),{checked:0,total:3});
});

test('excessive depth, cyclic content and hostile property access fail closed',()=>{
  const cyclic = doc(); cyclic.content.push(cyclic);
  let deep = paragraph(text('deep'));
  for (let level = 0; level < 80; level += 1) deep = {type:'blockquote',content:[deep]};
  const hostile = {type:'doc',get content(){throw new Error('access');}};
  for (const raw of [cyclic,doc(deep),hostile]) assert.equal(Description.normalize(raw),null);
});

test('the browser global works without CommonJS and without any document during normalization',()=>{
  const context = {URL};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/description-model.js'),'utf8'),context);
  assert.equal(context.CleanRoomsDescription.text(context.CleanRoomsDescription.fromText('safe\ntext')),'safe\ntext');
  assert.equal(context.CleanRoomsDescription.normalize('{"type":"doc"}').type,'doc');
});
