const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../src/description-model.js');
require('../src/checklist-progress.js');
require('../src/employee-calendar.js');
require('../src/employee-view.js');
const Description = globalThis.CleanRoomsDescription;
const Checklist = globalThis.CleanRoomsChecklist;
const Employee = globalThis.CleanRoomsEmployee;

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const descendants = element => element.children.flatMap(child => [child,...descendants(child)]);
const dataName = value => value.replace(/-([a-z])/g,(_,letter) => letter.toUpperCase());

// A deliberately small DOM: it never parses HTML or runs layout. The tests
// exercise real safe rendering, progress mapping, UI events and async locks.
class Element {
  constructor(tag,ownerDocument,namespaceURI) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.namespaceURI = namespaceURI;
    this.parentElement = null; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {setProperty:(name,value) => { this.style[name]=value; }};
    this.className = ''; this._text = ''; this.value = ''; this.checked = false; this.disabled = false;
    this.hidden = false; this.scrollTop = 0; this.clientHeight = 200; this.handlers = new Map();
    this.classList = {toggle:(name,on) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); if (on ?? !names.has(name)) names.add(name); else names.delete(name); this.className = [...names].join(' '); }};
  }
  set innerHTML(value) { throw new Error('HTML parsing is forbidden: ' + value); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  append(...children) { children.forEach(child => { if (typeof child === 'string') child = this.ownerDocument.createTextNode(child); child.parentElement = this; this.children.push(child); }); }
  prepend(...children) { children.reverse().forEach(child => { if (typeof child === 'string') child = this.ownerDocument.createTextNode(child); child.parentElement = this; this.children.unshift(child); }); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; if (children.length) this._text = ''; this.append(...children); }
  setAttribute(name,value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); if (name.startsWith('data-')) this.dataset[dataName(name.slice(5))] = String(value); }
  getAttribute(name) { if (name === 'class') return this.className; if (name === 'id') return this.id ?? null; if (name.startsWith('data-')) return this.dataset[dataName(name.slice(5))] ?? null; return this.attributes[name] ?? null; }
  addEventListener(name,handler) { if (!this.handlers.has(name)) this.handlers.set(name,[]); this.handlers.get(name).push(handler); }
  fire(name,extra={}) { const event = {target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra}; for (const handler of [...(this.handlers.get(name) || [])]) handler(event); }
  click() { if (this.disabled) return; this.focus(); if (this.type === 'checkbox') { this.checked = !this.checked; this.fire('change'); } else this.fire('click'); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  contains(element) { return element === this || descendants(this).includes(element); }
  matches(selector) {
    const attributes = [...selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g,'');
    const tag = plain.match(/^[a-z]+/i)?.[0], id = plain.match(/#([\w-]+)/)?.[1], classes = [...plain.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    return (!tag || this.tagName === tag.toUpperCase()) && (!id || this.id === id)
      && classes.every(name => this.className.split(/\s+/).includes(name))
      && attributes.every(([,name,value]) => { const actual = this.getAttribute(name) ?? this[name]; return value === undefined ? actual !== undefined && actual !== null : String(actual) === value; });
  }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
  querySelectorAll(selector) { return descendants(this).filter(child => selector.split(',').some(part => child.matches(part.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function host() {
  const document = {defaultView:{},activeElement:null};
  document.createElement = tag => new Element(tag,document);
  document.createElementNS = (namespace,tag) => new Element(tag,document,namespace);
  document.createTextNode = value => { const node = new Element('#text',document); node.textContent = String(value); return node; };
  document.body = document.createElement('body'); const element = document.createElement('main'); document.body.append(element);
  return element;
}
const paragraph = text => ({type:'paragraph',content:[{type:'text',text}]});
const task = text => ({type:'taskItem',attrs:{checked:false},content:[paragraph(text)]});
function template() {
  const parent = task('Rengør køkken'); parent.content.push({type:'taskList',content:[task('Tøm skraldespanden')]});
  return Description.encode({type:'doc',content:[{type:'taskList',content:[parent,task('Lås døren')]}]});
}
const person = freeze({id:'p0',name:'Jonas Larsen'});
const sites = freeze([{name:'Kontor Nord',address:'Nordvej 12, 8000 Aarhus C'},{name:'Klinikken',address:'Klinikvej 4, 8200 Aarhus N'}]);
const current = freeze({id:'jonas@2026-10-28',person:'p0',date:'2026-10-28',site:0,start:'07:00',end:'15:00',note:'Opgaver',noteRich:template()});
const past = freeze({...current,id:'past',date:'2026-10-26',start:'08:00',end:'12:00',note:'',noteRich:''});
const future = freeze({...current,id:'future',date:'2026-11-02',site:1,start:'08:00',end:'12:00',note:'Fremtidig vagt',noteRich:''});
const foreign = freeze({...current,id:'foreign',person:'p1',note:'DENNE MEDARBEJDERS DATA SKAL IKKE VISES',noteRich:''});
function render(target,overrides = {}) {
  const progress = overrides.progress || {};
  const options = {person,sites,shifts:[foreign,future,current,past],weekStart:'2026-10-26',today:'2026-10-28',selectedShiftId:null,progressFor:shift => Checklist.read(progress,shift),onToggleTask:() => {},saveStatus:{state:'saved',message:'Gemt'},...overrides};
  Employee.render(target,options); return options;
}
const checks = target => target.querySelectorAll('input[type="checkbox"]');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('default month grid and next shift expose only personal shifts without opening foreign details',() => {
  const target = host(),shifts = freeze([foreign,future,current,past]),before = JSON.stringify(shifts);
  render(target,{shifts,selectedShiftId:'foreign'});
  assert.deepEqual(target.querySelectorAll('[data-employee-shift]').map(row => row.dataset.employeeShift),['past',current.id]);
  assert.ok(target.querySelector('.cs-employee-next').textContent.includes('07:00–15:00'));
  assert.ok(target.textContent.includes('Nordvej 12'));
  assert.ok(!target.textContent.includes(foreign.note));
  assert.equal(target.querySelector('.cs-employee-detail'),null);
  assert.equal(target.querySelector('.cs-employee-page').dataset.view,'month');
  assert.equal(target.querySelectorAll('.cs-employee-calendar-day').length,35);
  assert.equal(JSON.stringify(shifts),before);
});

test('month/week/day controls pass exact date, view and shift callbacks',() => {
  const target=host(),dates=[],views=[],opened=[];
  render(target,{onDateChange:(...args)=>dates.push(args),onViewChange:value=>views.push(value),onOpenShift:value=>opened.push(value)});
  target.querySelector('#cs-employee-prev-period').click();target.querySelector('#cs-employee-next-period').click();target.querySelector('#cs-employee-today').click();
  const jump=target.querySelector('#cs-employee-date');jump.value='2026-11-05';jump.fire('change');
  target.querySelector('[data-employee-date="2026-10-28"]').click();
  assert.deepEqual(dates,[['2026-09-26',undefined],['2026-11-26',undefined],['2026-10-28',undefined],['2026-11-05',undefined],['2026-10-28',{view:'day'}]]);
  for(const value of ['month','week','day'])target.querySelector('[data-employee-view="'+value+'"]').click();
  assert.deepEqual(views,['month','week','day']);
  target.querySelector('#cs-employee-next-open').click();target.querySelector('[data-employee-shift="past"]').click();assert.deepEqual(opened,[current.id,'past']);
  render(target,{selectedShiftId:current.id,onOpenShift:value=>opened.push(value)});target.querySelector('#cs-employee-close').click();assert.equal(opened.at(-1),null);
  render(target,{view:'week'});assert.equal(target.querySelectorAll('.cs-employee-calendar-day').length,7);
  render(target,{view:'day',focusDate:'2026-10-28'});assert.ok(target.querySelector('.cs-employee-timeline'));assert.equal(target.querySelectorAll('[data-employee-shift]').length,1);
});

test('nested saved progress maps to DOM preorder and toggles exact keys/signature without touching templates',async () => {
  const target = host(),initial = Checklist.read({},current),progress = freeze(Checklist.set({},current,{key:initial.tasks[0].key,checked:true,signature:initial.signature,person:person.id}).progress),before = JSON.stringify({progress,current});
  const calls = [];let resolveSave;
  render(target,{selectedShiftId:current.id,progress,onToggleTask:(...args) => { calls.push(args);return new Promise(resolve => { resolveSave=resolve; }); }});
  const inputs = checks(target),view = Checklist.read(progress,current);
  assert.deepEqual(inputs.map(input => input.dataset.taskKey),view.tasks.map(task => task.key));
  assert.deepEqual(inputs.map(input => input.checked),[true,false,false]);
  assert.equal(inputs[0].closest('li').dataset.checked,'true');assert.ok(inputs[0].closest('li').className.includes('is-complete'));
  inputs[1].click();
  assert.deepEqual(calls,[[current.id,view.tasks[1].key,true,view.signature]]);
  assert.ok(inputs.every(input => input.disabled));assert.ok(target.querySelector('.cs-employee-task-count').textContent.includes('2 af 3'));
  inputs[2].click();assert.equal(calls.length,1,'A pending save must block a second click.');
  resolveSave(true);await flush();assert.ok(inputs.every(input => !input.disabled));
  assert.equal(JSON.stringify({progress,current}),before);
});

test('loading, saving, errors and incompatible task views fail closed while retry stays available',() => {
  for (const state of ['loading','saving','error']) {
    const target = host(),calls = [],retries = [];
    render(target,{selectedShiftId:current.id,saveStatus:{state,message:'Status: '+state,retry:() => retries.push(true)},onToggleTask:(...args) => calls.push(args)});
    checks(target).forEach(input => input.click());assert.equal(calls.length,0);assert.ok(checks(target).every(input => input.disabled));
    assert.ok(target.querySelector('.cs-employee-save-status').textContent.includes('Status: '+state));
    if (state === 'error') { target.querySelector('.cs-employee-save-status').querySelector('button').click();assert.equal(retries.length,1); }
  }
  const target = host();render(target,{selectedShiftId:current.id,progressFor:() => ({signature:'stale',tasks:[],total:0,checked:0})});
  assert.ok(checks(target).every(input => input.disabled));assert.match(target.querySelector('.cs-employee-save-status').textContent,/ændret/);
});

test('rejected and thrown saves restore the original checkbox and keep the uncertain list locked',async () => {
  for (const save of [() => false,() => { throw Error('offline'); },() => Promise.reject(Error('offline'))]) {
    const target = host();render(target,{selectedShiftId:current.id,onToggleTask:save});checks(target)[0].click();await flush();
    assert.equal(checks(target)[0].checked,false);assert.ok(checks(target).every(input => input.disabled));
    assert.equal(target.querySelector('.cs-employee-save-status').dataset.state,'error');
  }
});

test('authoritative rerenders restore task focus and detail/calendar scroll positions',() => {
  const target = host();render(target,{selectedShiftId:current.id});const key = checks(target)[1].dataset.taskKey;
  checks(target)[1].focus();target.querySelector('.cs-employee-detail-body').scrollTop=120;target.querySelector('.cs-employee-calendar-scroll').scrollTop=35;
  render(target,{selectedShiftId:current.id,saveStatus:{state:'saving',message:'Gemmer'}});
  assert.equal(target.querySelector('.cs-employee-detail-body').scrollTop,120);assert.equal(target.querySelector('.cs-employee-calendar-scroll').scrollTop,35);
  render(target,{selectedShiftId:current.id});assert.equal(target.ownerDocument.activeElement.dataset.taskKey,key);
  assert.equal(target.querySelector('.cs-employee-detail-body').scrollTop,120);
});

test('completion of an old save cannot mutate a newly rendered employee view',async () => {
  const target = host();let resolveSave;
  render(target,{selectedShiftId:current.id,onToggleTask:() => new Promise(resolve => { resolveSave=resolve; })});const oldPage=target.querySelector('.cs-employee-page');checks(target)[0].click();
  render(target,{person:{id:'p1',name:'Emma Nielsen'},selectedShiftId:null});const newPage=target.querySelector('.cs-employee-page'),before=newPage.textContent;
  assert.equal(oldPage.isConnected,false);resolveSave(true);await flush();assert.equal(newPage.textContent,before);assert.equal(checks(target).length,0);
});

test('long legacy instructions and address markup render literally without HTML parsing',() => {
  const target = host(),literal='<script>not executed</script>\n<img src=x onerror=bad()>\n'+'ÆØÅ🧽'.repeat(6000),shift = freeze({...current,note:literal,noteRich:''});
  render(target,{sites:[{name:'<strong>Kontor</strong>',address:'<img src=x> Nordvej'}],shifts:[shift],selectedShiftId:shift.id});
  assert.equal(target.querySelector('.cs-employee-instructions').textContent,literal.replaceAll('\n',''));
  assert.equal(target.querySelectorAll('script').length,0);assert.equal(target.querySelectorAll('img').length,0);
  assert.ok(target.textContent.includes('<img src=x> Nordvej'));assert.equal(checks(target).length,0);
  assert.equal(target.querySelector('.cs-employee-task-summary').hidden,true);
});

test('empty personal months expose navigation and the module exports its browser API',() => {
  const target=host();render(target,{focusDate:'2026-12-09'});assert.ok(target.querySelector('.cs-employee-calendar-empty'));assert.equal(target.querySelectorAll('[data-employee-shift]').length,0);
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/employee-view.js'),'utf8'),context);
  assert.equal(typeof context.CleanRoomsEmployee.render,'function');assert.ok(Object.isFrozen(Employee));
});


test('drawer is modal, traps boundary focus and restores its exact calendar or next-shift origin',() => {
  for(const selector of ['[data-employee-shift="'+current.id+'"]','#cs-employee-next-open']){
    const target=host();let selectedShiftId=null;
    const rerender=()=>render(target,{selectedShiftId,onOpenShift:id=>{selectedShiftId=id;rerender();}});
    rerender();target.querySelector(selector).click();
    const panel=target.querySelector('.cs-employee-detail'),close=target.querySelector('#cs-employee-close');
    assert.equal(panel.getAttribute('role'),'dialog');assert.equal(panel.getAttribute('aria-modal'),'true');assert.equal(target.querySelector('.cs-employee-page').inert,true);assert.equal(target.ownerDocument.activeElement,close);
    close.focus();panel.fire('keydown',{key:'Tab',shiftKey:true});assert.equal(target.ownerDocument.activeElement,checks(target).at(-1));
    panel.fire('keydown',{key:'Tab'});assert.equal(target.ownerDocument.activeElement,close);
    panel.fire('keydown',{key:'Escape'});assert.equal(target.querySelector('.cs-employee-detail'),null);assert.equal(target.ownerDocument.activeElement,target.querySelector(selector));
  }
});

test('status renders retain focused calendar controls and bounded dates cannot open adjacent cells',() => {
  const target=host();render(target,{minDate:'2026-10-10',maxDate:'2026-10-30'});
  const viewButton=target.querySelector('[data-employee-view="week"]');viewButton.focus();
  render(target,{minDate:'2026-10-10',maxDate:'2026-10-30',saveStatus:{state:'saving'}});
  assert.equal(target.ownerDocument.activeElement.dataset.employeeView,'week');
  assert.equal(target.querySelector('[data-employee-date="2026-10-09"]').disabled,true);
  assert.equal(target.querySelector('[data-employee-date="2026-10-31"]').disabled,true);
  assert.equal(target.querySelector('#cs-employee-prev-period').disabled,true);assert.equal(target.querySelector('#cs-employee-next-period').disabled,true);
});

test('timekeeping surfaces an unfinished own shift and keeps other peoples records private',()=>{
  require('../src/timekeeping-employee.js');
  const target=host(),opened=[];
  const running={id:'own-entry',version:2,shiftId:past.id,personId:person.id,date:past.date,status:'running',start:'08:00',end:null,breakMinutes:0,workedMinutes:60};
  render(target,{timekeeping:{enabled:true,entries:[{...running,shiftId:current.id,personId:'p1',comment:'PRIVATE OTHER EMPLOYEE'},running]},onTimeAction:async()=>({ok:true}),onOpenShift:id=>opened.push(id)});
  assert.match(target.querySelector('.cs-employee-next').textContent,/Igangværende vagt/);
  target.querySelector('#cs-employee-next-open').click();assert.equal(opened.at(-1),past.id);
  assert.doesNotMatch(target.textContent,/PRIVATE OTHER EMPLOYEE/);
  render(target,{selectedShiftId:past.id,timekeeping:{enabled:true,entries:[running]},onTimeAction:async()=>({ok:true})});
  assert.ok(target.querySelector('.cs-time-employee'));assert.match(target.querySelector('.cs-time-employee').textContent,/Afslut vagt/);
});

test('the checkout comment form participates in modal focus only while it is visible',()=>{
  require('../src/timekeeping-employee.js');
  const target=host(),running={id:'running',version:1,shiftId:past.id,personId:person.id,date:past.date,status:'running',start:'08:22',end:null,breakMinutes:0};
  render(target,{shifts:[past],selectedShiftId:past.id,timekeeping:{enabled:true,entries:[running]},onTimeAction:async()=>({ok:true})});
  const panel=target.querySelector('.cs-employee-detail'),close=target.querySelector('#cs-employee-close');
  const finish=target.querySelectorAll('button').find(item=>item.textContent==='Afslut vagt');assert.ok(finish);
  assert.equal(target.querySelectorAll('button').some(item=>item.textContent==='Registrér tid manuelt'),false);
  close.focus();panel.fire('keydown',{key:'Tab',shiftKey:true});assert.ok(target.ownerDocument.activeElement===finish);
  finish.click();const send=target.querySelectorAll('button').find(item=>item.textContent==='Stempl ud og afslut');assert.ok(send);
  close.focus();panel.fire('keydown',{key:'Tab',shiftKey:true});assert.ok(target.ownerDocument.activeElement===send);
  panel.fire('keydown',{key:'Tab'});assert.ok(target.ownerDocument.activeElement===close);
});

test('personal period totals and shift details show planned work after the agreed unpaid break',()=>{
  const target=host(),withBreak={...current,plannedBreakMinutes:30};render(target,{shifts:[withBreak],selectedShiftId:withBreak.id});
  assert.match(target.querySelector('.cs-employee-period-total').textContent,/7 t 30 min/);
  assert.match(target.querySelector('.cs-employee-detail-planned-pause').textContent,/30 min ulønnet pause · 7 t 30 min arbejdstid/);
  assert.equal(current.plannedBreakMinutes,undefined);
});
