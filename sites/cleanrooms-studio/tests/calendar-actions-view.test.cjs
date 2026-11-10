const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Events {
  constructor() { this.handlers = new Map(); }
  addEventListener(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  dispatch(type, values = {}) {
    const event = {type,target:this,preventDefault() { this.defaultPrevented = true; },stopPropagation() { this.stopped = true; },stopImmediatePropagation() { this.stopped = true; },...values};
    [...(this.handlers.get(type) || [])].forEach(callback => callback(event));
    return event;
  }
  listenerCount() { return [...this.handlers.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}

class Element extends Events {
  constructor(tag) {
    super(); this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.className = ''; this._text = ''; this.parentNode = null;
    this.style = {setProperty() {}};
    this.classList = {
      add:(...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' '); },
      remove:(...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
      contains:name => this.className.split(' ').includes(name)
    };
  }
  set textContent(text) { this._text = String(text); this.children.forEach(child => child.parentNode = null); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get parentElement() { return this.parentNode; }
  get isConnected() { return this.connectedRoot || Boolean(this.parentNode?.isConnected); }
  append(...children) { children.forEach(child => { child.remove(); child.parentNode = this; this.children.push(child); }); }
  replaceChild(next,previous) { const index=this.children.indexOf(previous);if(index<0)throw new Error('Missing child');next.remove();previous.parentNode=null;next.parentNode=this;this.children[index]=next;return previous; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '[data-shift]') return this.dataset.shift !== undefined;
    return this.tagName === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(part => part.trim());
    return this.children.flatMap(child => [...(selectors.some(part => child.matches(part)) ? [child] : []),...child.querySelectorAll(selector)]);
  }
  getBoundingClientRect() { return {left:0,top:0,right:1200,bottom:800}; }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

function setup(extra = {}) {
  const document = new Events(), globalEvents = new Events();
  const body = new Element('body'); body.connectedRoot = true;
  const root = new Element('div'); root.id = 'cleanrooms-studio'; body.append(root);
  document.createElement = tag => new Element(tag);
  document.createElementNS = (namespace,tag) => new Element(tag);
  document.querySelectorAll = selector => body.querySelectorAll(selector);
  const context = {document,CleanRoomsCalendarViewport:extra.viewport,addEventListener:globalEvents.addEventListener.bind(globalEvents),removeEventListener:globalEvents.removeEventListener.bind(globalEvents)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/calendar-view.js'),'utf8'), context);
  const shifts = extra.shifts || [{id:'one',person:'p0',date:'2026-10-26',site:0,start:'07:00',end:'15:00'}];
  const moves = [], rejected = [], previews = [];
  const options = {
    from:'2026-10-26',weeks:1,zoom:1,shifts,personName:id => 'Medarbejder ' + id,sites:[{name:'Kontor',color:'#888'}],
    onMove:(shift,date) => { moves.push({shift,date}); return false; },
    onMoveRejected:reason => rejected.push(reason),
    onMovePreview:(shift,date) => { previews.push(date); return {allowed:date !== shift.date,status:date === shift.date ? 'same' : 'allowed',reason:date === shift.date ? 'Samme dag' : 'Ledig dag'}; },
    ...extra
  };
  const result = context.CleanRoomsCalendar.render(options); root.append(result.element);
  const cells = result.element.querySelectorAll('.cs-board-day');
  const card = result.element.querySelectorAll('.cs-event')[0];
  const storage = new Map();
  const transfer = {
    get types() { return [...storage.keys()]; },
    setData:(key,value) => storage.set(key,value),getData:key => storage.get(key) || '',
    setDragImage(image) { this.image = image; }
  };
  const start = () => card.dispatch('dragstart',{dataTransfer:transfer});
  const over = index => cells[index].dispatch('dragover',{dataTransfer:transfer});
  const drop = index => cells[index].dispatch('drop',{dataTransfer:transfer});
  return {document,globalEvents,root,result,cells,card,transfer,moves,rejected,previews,start,over,drop,options,api:context.CleanRoomsCalendar};
}

function rerender(view, options = {}) {
  const next = view.api.render({...view.options,...options});
  view.result.element.remove(); view.root.append(next.element);
  return next;
}

test('group action includes filtered matching members beyond the daily display cap', () => {
  const shifts = Array.from({length:21}, (_, index) => ({id:'shift-' + index,person:'p' + index,date:'2026-10-26',site:index % 2,start:'07:00',end:'15:00'}));
  shifts.push({id:'different-end',person:'other',date:'2026-10-26',site:0,start:'07:00',end:'16:00'});
  const calls = [];
  const view = setup({shifts,onEditGroup:(group,button) => calls.push({group,button})});
  const header = view.result.element.querySelectorAll('.cs-time-group-header')[0];
  assert.equal(view.result.shown.length,12);
  assert.equal(header.tagName,'button');
  assert.equal(header.getAttribute('role'),null);
  assert.equal(header.getAttribute('aria-haspopup'),'dialog');
  assert.equal(header.dataset.groupDate,'2026-10-26');
  assert.equal(header.querySelectorAll('.cs-time-group-count')[0].textContent,'21');
  header.dispatch('click');
  assert.equal(calls.length,1);
  assert.equal(calls[0].button,header);
  assert.equal(calls[0].group.shifts.length,21);
  assert.ok(calls[0].group.shifts.every(shift => shift.end === '15:00'));
});

test('drag preview caches a target day and blocked drops never mutate', () => {
  const calls = [];
  const view = setup({onMovePreview:(shift,date) => { calls.push(date); return {allowed:false,status:date === shift.date ? 'same' : 'blocked',reason:'Medarbejderen har en anden vagt.'}; }});
  view.start(); view.over(1); view.over(1);
  assert.equal(calls.filter(date => date === '2026-10-27').length,1);
  assert.ok(view.cells[1].classList.contains('is-drop-invalid'));
  assert.equal(view.transfer.dropEffect,'none');
  const status = view.root.querySelectorAll('.cs-drag-status')[0];
  assert.equal(status.dataset.state,'blocked');
  assert.match(status.querySelectorAll('.cs-drag-reason')[0].textContent,/anden vagt/);
  assert.equal(view.result.element.querySelectorAll('.cs-drag-status').length,0);
  view.drop(1);
  assert.equal(calls.filter(date => date === '2026-10-27').length,2);
  assert.equal(view.moves.length,0);
  assert.equal(view.rejected.length,1);
  assert.equal(view.root.querySelectorAll('.cs-drag-status').length,0);
  assert.equal(view.root.querySelectorAll('.cs-drag-ghost').length,0);
  assert.equal(view.document.listenerCount(),0);
  assert.equal(view.globalEvents.listenerCount(),0);
});

test('allowed drops request exactly one move and source-day drops remain neutral', () => {
  const view = setup(); view.start(); view.over(1);
  assert.ok(view.cells[1].classList.contains('is-drop-target'));
  assert.equal(view.transfer.dropEffect,'move');
  const drop = view.drop(1);
  assert.equal(drop.stopped,true);
  assert.equal(view.moves.length,1);
  assert.equal(view.moves[0].date,'2026-10-27');
  view.start(); view.over(0);
  assert.ok(view.cells[0].classList.contains('is-drop-same'));
  assert.equal(view.transfer.dropEffect,'none');
  view.drop(0);
  assert.equal(view.moves.length,1);
  assert.equal(view.rejected.length,0);
});

test('drop revalidates after a target changes from allowed to blocked', () => {
  let allowed = true;
  const view = setup({onMovePreview:(shift,date) => ({allowed,status:allowed ? 'allowed' : 'blocked',reason:'Planen er ændret.'})});
  view.start(); view.over(1); allowed = false; view.drop(1);
  assert.equal(view.moves.length,0);
  assert.deepEqual(view.rejected,['Planen er ændret.']);
});

test('drag start preserves native transfer state and uses the native row image', () => {
  const view = setup(), effects = [];
  let dropEffect = 'none';
  Object.defineProperty(view.transfer,'dropEffect',{get:() => dropEffect,set:value => { effects.push(value); dropEffect = value; }});
  view.transfer.setDragImage = () => { throw new Error('A native row drag must not require a custom drag image.'); };
  view.start();
  assert.equal(view.transfer.effectAllowed,'move');
  assert.deepEqual(effects,[]);
  assert.equal(view.root.querySelectorAll('.cs-drag-ghost').length,0);
  assert.ok(view.cells[0].classList.contains('is-drop-same'));
  view.over(1);
  assert.deepEqual(effects,['move']);
  view.card.dispatch('dragend');
});

test('window blur keeps the local drag identity while transfer reads are protected', () => {
  const view = setup(); view.start();
  view.transfer.getData = () => '';
  view.globalEvents.dispatch('blur');
  const over = view.over(1);
  assert.equal(over.defaultPrevented,true);
  assert.ok(view.cells[1].classList.contains('is-drop-target'));
  assert.equal(view.root.querySelectorAll('.cs-drag-status')[0].dataset.state,'allowed');
  view.drop(1);
  assert.equal(view.moves.length,1);
  assert.equal(view.moves[0].shift.id,'one');
  assert.equal(view.moves[0].date,'2026-10-27');
  assert.equal(view.document.listenerCount(),0);
});

test('disposal and Escape remove external overlays and active drag listeners', () => {
  const view = setup(); view.start(); view.over(1);
  assert.equal(view.root.querySelectorAll('.cs-drag-status').length,1);
  assert.equal(view.root.querySelectorAll('.cs-drag-ghost').length,0);
  assert.ok(view.document.listenerCount() > 0);
  view.result.dispose(); view.result.dispose();
  assert.equal(view.root.querySelectorAll('.cs-drag-status, .cs-drag-ghost').length,0);
  assert.equal(view.result.element.querySelectorAll('.is-dragging, .is-drop-target, .is-drop-invalid, .is-drop-same').length,0);
  assert.equal(view.document.listenerCount(),0);
  assert.equal(view.globalEvents.listenerCount(),0);
  view.start(); view.over(1); view.document.dispatch('keydown',{key:'Escape'});
  assert.equal(view.root.querySelectorAll('.cs-drag-status, .cs-drag-ghost').length,0);
  assert.equal(view.document.listenerCount(),0);
});

test('leaving the board clears feedback, and revealDay exposes every employee', () => {
  const view = setup(); view.start(); view.over(1);
  view.result.element.dispatch('dragleave',{relatedTarget:null,clientX:-1,clientY:-1});
  assert.equal(view.root.querySelectorAll('.cs-drag-status, .cs-drag-ghost').length,0);
  assert.equal(view.result.element.querySelectorAll('.is-drop-target, .is-drop-invalid, .is-drop-same').length,0);
  view.card.dispatch('dragend');
  const shifts = Array.from({length:20}, (_, index) => ({id:'all-' + index,person:'p' + index,date:'2026-10-26',site:0,start:'07:00',end:'15:00'}));
  assert.equal(view.api.revealDay('invalid'),false);
  assert.equal(view.api.revealDay('2026-10-26'),true);
  const expanded = view.api.render({from:'2026-10-26',weeks:1,shifts,personName:id => id});
  assert.equal(expanded.shown.length,20);
});

test('regular clicks still edit while Ctrl and Meta clicks select explicit employees', () => {
  const selected = [], opened = [];
  const view = setup({onSelect:(shift,detail,button) => selected.push({shift,detail,button}),onOpen:shift => opened.push(shift.id)});
  assert.equal(view.card.tagName.toLowerCase(),'button');
  assert.equal(view.card.getAttribute('role'),null);
  assert.equal(view.card.getAttribute('aria-pressed'),null);
  view.card.dispatch('click',{detail:0});
  assert.deepEqual(opened,['one']);
  assert.equal(selected.length,0);
  view.card.dataset.selected = 'true';
  view.card.dispatch('click',{ctrlKey:true});
  view.card.dispatch('click',{metaKey:true});
  assert.equal(selected.length,2);
  assert.ok(selected.every(call => call.shift.id === 'one' && call.detail.additive && call.detail.rangeIds.length === 0 && call.button === view.card));
  assert.deepEqual(opened,['one']);
  assert.equal(view.card.dataset.selected,'true');
  assert.equal(view.card.draggable,true);
});

test('selection mode supports keyboard activation and disables drag and Alt movement', () => {
  const selected = [], opened = [];
  const view = setup({selectionMode:true,onSelect:(shift,detail) => selected.push({shift,detail}),onOpen:shift => opened.push(shift.id)});
  assert.equal(view.result.element.dataset.selectionMode,'true');
  assert.equal(view.card.getAttribute('aria-pressed'),'false');
  assert.equal(view.card.draggable,false);
  assert.equal(view.card.handlers.has('dragstart'),false);
  const key = view.card.dispatch('keydown',{key:'ArrowRight',altKey:true});
  assert.equal(key.defaultPrevented,true);
  assert.equal(view.moves.length,0);
  const click = view.card.dispatch('click',{detail:0});
  assert.equal(click.defaultPrevented,true);
  assert.equal(selected.length,1);
  assert.equal(selected[0].detail.additive,false);
  assert.equal(selected[0].detail.rangeIds.length,0);
  assert.equal(opened.length,0);
});

test('selected and changed markers accept arrays or Sets without reusing editor state', () => {
  const shifts = [
    {id:'one',person:'p0',date:'2026-10-26',site:0,start:'07:00',end:'15:00'},
    {id:'two',person:'p1',date:'2026-10-26',site:0,start:'07:00',end:'15:00'}
  ];
  const view = setup({shifts,selectedIds:['one'],changedIds:new Set(['two']),onSelect() {}});
  const [one,two] = view.result.element.querySelectorAll('.cs-event');
  assert.equal(one.dataset.multiSelected,'true');
  assert.equal(one.getAttribute('aria-pressed'),'true');
  assert.ok(one.classList.contains('is-multi-selected'));
  assert.equal(one.querySelectorAll('.cs-event-select-mark')[0].textContent,'✓');
  assert.equal(one.dataset.selected,undefined);
  assert.equal(two.dataset.multiSelected,'false');
  assert.equal(two.getAttribute('aria-pressed'),null);
  assert.equal(two.dataset.changed,'true');
  assert.match(two.getAttribute('aria-label'),/Ændret siden seneste udgivelse/);
  assert.doesNotMatch(one.getAttribute('aria-label'),/Ændret siden seneste udgivelse/);
  const marker = two.querySelectorAll('.cs-event-change-mark')[0];
  assert.equal(marker.title,'Ændret siden seneste udgivelse');
  assert.equal(marker.getAttribute('aria-hidden'),'true');
  assert.equal(one.querySelectorAll('.cs-event-change-mark').length,0);
  const next = rerender(view,{selectedIds:new Set(['two']),changedIds:['one']});
  assert.equal(next.element.querySelectorAll('.cs-event')[1].getAttribute('aria-pressed'),'true');
});

test('long descriptions get a marker and remain available to editing without flooding labels or tooltips', () => {
  const note=('    Særlige instruktioner 🧽 ÆØÅ / 漢字\n'+
    '<script>globalThis.descriptionRan=true</script><img src=x onerror="alert(1)">\n').repeat(300);
  assert.ok(note.length>=30000&&note.length<=50000);
  const shift=Object.freeze({id:'with-description',person:'p0',date:'2026-10-26',site:0,start:'07:00',end:'15:00',note});
  const opened=[];
  const view=setup({shifts:[shift,{...shift,id:'without-description',date:'2026-10-27',note:''}],onOpen:current=>opened.push(current)});
  const [card,empty]=view.result.element.querySelectorAll('.cs-event');
  const markers=card.querySelectorAll('.cs-description-indicator');
  assert.equal(markers.length,1);
  assert.equal(markers[0].getAttribute('aria-hidden'),'true');
  assert.equal(markers[0].title,'Har beskrivelse');
  assert.equal(markers[0].querySelectorAll('svg').length,1);
  for(const label of [card.getAttribute('aria-label'),card.title,card.dataset.tooltip]) {
    assert.ok(label.length<400);
    assert.match(label,/Har beskrivelse/);
    assert.match(label,/07:00.*15:00/);
    assert.doesNotMatch(label,/Særlige instruktioner|<script>|<img|descriptionRan/);
  }
  assert.doesNotMatch(card.textContent,/Særlige instruktioner|<script>|<img/);
  assert.equal(empty.querySelectorAll('.cs-description-indicator').length,0);
  assert.doesNotMatch(empty.getAttribute('aria-label'),/Har beskrivelse/);
  card.dispatch('click',{detail:0});
  assert.equal(opened.length,1); assert.equal(opened[0].id,shift.id);
  assert.equal(opened[0].note.length,note.length);
  assert.ok(opened[0].note===note);
});

test('issue callbacks can expose real hidden-site overlaps without changing edit or selection actions', () => {
  const Engine = require('../src/series-engine.js');
  const fullSchedule = [
    {id:'visible',person:'p0',date:'2026-10-26',site:0,start:'07:00',end:'15:00'},
    {id:'hidden',person:'p0',date:'2026-10-26',site:1,start:'14:00',end:'16:00'}
  ];
  const checked = [], opened = [], selected = [];
  const view = setup({
    shifts:fullSchedule.filter(shift => shift.site === 0),
    onOpen:shift => opened.push(shift.id),
    onSelect:shift => selected.push(shift.id),
    issueFor:shift => {
      checked.push(shift.id);
      const overlap = Engine.conflicts([shift],fullSchedule)[0];
      return overlap ? {label:'Overlap',detail:'Har også en vagt kl. ' + overlap.other.start + '–' + overlap.other.end + ' på et andet arbejdssted.',kind:'overlap'} : null;
    }
  });
  assert.equal(view.result.shown.length,1);
  assert.deepEqual(checked,['visible']);
  assert.equal(view.card.dataset.issue,'overlap');
  assert.ok(view.card.classList.contains('has-issue'));
  const copy = view.card.querySelectorAll('.cs-event-copy')[0], warning = view.card.querySelectorAll('.cs-event-issue')[0];
  assert.equal(warning.parentNode,copy);
  assert.equal(copy.children.at(-1),warning);
  assert.equal(warning.textContent,'Overlap');
  assert.equal(warning.getAttribute('aria-hidden'),'true');
  for (const description of [view.card.getAttribute('aria-label'),view.card.title,view.card.dataset.tooltip]) {
    assert.match(description,/Overlap/);
    assert.match(description,/14:00–16:00 på et andet arbejdssted/);
  }
  assert.equal(view.card.draggable,true);
  assert.ok(view.card.handlers.has('dragstart'));
  view.card.dispatch('click',{detail:0});
  view.card.dispatch('click',{ctrlKey:true});
  assert.deepEqual(opened,['visible']);
  assert.deepEqual(selected,['visible']);
});

test('leave issues are labeled per shift and issue-free cards have no warning DOM', () => {
  const shifts = [
    {id:'leave-day',person:'p6',date:'2026-10-28',site:0,start:'07:00',end:'14:00'},
    {id:'free-day',person:'p6',date:'2026-10-29',site:0,start:'07:00',end:'14:00'}
  ];
  const approved = [{person:'p6',date:'2026-10-28'}];
  const view = setup({shifts,issueFor:shift => approved.some(item => item.person === shift.person && item.date === shift.date)
    ? {label:'Fravær',detail:'Medarbejderen har godkendt ferie denne dag.',kind:'leave'} : null});
  const [leave,clear] = view.result.element.querySelectorAll('.cs-event');
  assert.equal(leave.dataset.issue,'leave');
  assert.equal(leave.querySelectorAll('.cs-event-issue')[0].textContent,'Fravær');
  assert.match(leave.getAttribute('aria-label'),/Fravær · Medarbejderen har godkendt ferie denne dag/);
  assert.equal(clear.dataset.issue,undefined);
  assert.equal(clear.classList.contains('has-issue'),false);
  assert.equal(clear.querySelectorAll('.cs-event-issue').length,0);
  assert.doesNotMatch(clear.getAttribute('aria-label'),/Fravær|godkendt ferie/);
  const refreshed = rerender(view,{issueFor:() => null});
  assert.equal(refreshed.element.querySelectorAll('.cs-event-issue').length,0);
  assert.ok(refreshed.element.querySelectorAll('.cs-event').every(card => card.dataset.issue === undefined && !card.classList.contains('has-issue')));
});

test('Shift ranges survive selection rerenders and exclude hidden employees', () => {
  const shifts = Array.from({length:21}, (_, index) => ({id:'row-' + String(index).padStart(2,'0'),person:'p' + String(index).padStart(2,'0'),date:'2026-10-26',site:0,start:'07:00',end:'15:00'}));
  shifts.push({id:'later',person:'later',date:'2026-10-27',site:0,start:'07:00',end:'15:00'});
  const calls = [];
  const view = setup({shifts,onSelect:(shift,detail) => calls.push({shift,detail})});
  view.card.dispatch('click',{ctrlKey:true});
  const next = rerender(view,{selectedIds:new Set(['row-00'])});
  const cards = next.element.querySelectorAll('.cs-event');
  cards.find(card => card.dataset.shift === 'later').dispatch('click',{shiftKey:true});
  const range = Array.from(calls[1].detail.rangeIds);
  assert.deepEqual(range,Array.from(next.shown,shift => shift.id));
  assert.equal(range.length,13);
  assert.ok(!range.includes('row-12') && !range.includes('row-20'));
  assert.equal(calls[1].detail.additive,false);
  cards.find(card => card.dataset.shift === 'row-03').dispatch('click',{shiftKey:true,metaKey:true});
  assert.deepEqual(Array.from(calls[2].detail.rangeIds),['row-00','row-01','row-02','row-03']);
  assert.equal(calls[2].detail.additive,true);
});

test('a selection anchor disappears when its employee leaves the rendered input', () => {
  const shifts = [
    {id:'one',person:'p0',date:'2026-10-26',site:0,start:'07:00',end:'15:00'},
    {id:'two',person:'p1',date:'2026-10-26',site:0,start:'07:00',end:'15:00'}
  ];
  const calls = [], view = setup({shifts,onSelect:(shift,detail) => calls.push(detail)});
  view.card.dispatch('click',{ctrlKey:true});
  const filtered = rerender(view,{shifts:[shifts[1]]});
  filtered.element.querySelectorAll('.cs-event')[0].dispatch('click',{shiftKey:true});
  assert.equal(calls[1].rangeIds.length,0);
});

test('unloaded weeks keep all dates and columns without inventing counts, hours, editable events or drop actions',()=>{
 const view=setup({weeks:2,shifts:[{id:'one',person:'p0',date:'2026-10-26',site:0,start:'07:00',end:'15:00'},{id:'unknown',person:'p1',date:'2026-11-02',site:0,start:'07:00',end:'15:00'}],weekState:day=>({loaded:day==='2026-10-26',loading:day!=='2026-10-26'})}),weeks=view.result.element.querySelectorAll('.cs-board-week'),pending=weeks[1];assert.equal(weeks.length,2);assert.equal(pending.querySelectorAll('.cs-board-day').length,7);assert.equal(pending.getAttribute('aria-busy'),'true');assert.equal(pending.querySelectorAll('.cs-event').length,0);assert.equal(pending.querySelectorAll('.cs-board-add').length,0);assert.equal(pending.querySelectorAll('.cs-board-hours').length,0);assert.ok(pending.querySelectorAll('.cs-board-count').every(value=>value.textContent==='—'));assert.ok(pending.querySelectorAll('.cs-board-date').every(value=>value.tagName==='div'));assert.match(pending.textContent,/Indlæser/);assert.doesNotMatch(pending.textContent,/0 vagter|0 timer/);assert.deepEqual(Array.from(view.result.shown,shift=>shift.id),['one']);view.start();view.over(7);view.drop(7);assert.equal(view.moves.length,0);view.result.dispose();
});

test('failed weeks expose a guarded retry while retaining the same scaffold and loaded neighbor',()=>{
 let pending={loaded:false,loading:false,error:'Offline'};const calls=[],view=setup({weeks:2,weekState:day=>day==='2026-10-26'?{loaded:true}:pending,onWeekRetry:day=>calls.push(day)}),weeks=view.result.element.querySelectorAll('.cs-board-week'),retry=weeks[1].querySelectorAll('.cs-calendar-week-retry')[0];assert.ok(retry);assert.equal(weeks[0].querySelectorAll('.cs-event').length,1);assert.equal(weeks[1].querySelectorAll('.cs-board-day').length,7);retry.dispatch('click');assert.deepEqual(calls,['2026-11-02']);pending={loaded:false,loading:true};retry.dispatch('click');assert.equal(calls.length,1);view.result.dispose();pending={loaded:false,error:'Offline'};retry.dispatch('click');assert.equal(calls.length,1);
});

test('existing actions recheck coverage after eviction and never mutate a now unknown week',()=>{
 let loaded=true;const opens=[],creates=[],groups=[],days=[],view=setup({weekState:()=>({loaded}),onOpen:shift=>opens.push(shift.id),onCreate:day=>creates.push(day),onEditGroup:group=>groups.push(group),onDay:day=>days.push(day)});loaded=false;view.card.dispatch('click');view.result.element.querySelectorAll('.cs-time-group-header')[0].dispatch('click');view.result.element.querySelectorAll('.cs-board-add')[0].dispatch('click');view.result.element.querySelectorAll('.cs-board-date')[0].dispatch('click');view.card.dispatch('keydown',{altKey:true,key:'ArrowRight'});view.start();view.over(1);view.drop(1);assert.equal(opens.length+creates.length+groups.length+days.length+view.moves.length,0);assert.equal(view.root.querySelectorAll('.cs-drag-status').length,0);view.result.dispose();
});

test('a loaded drag source cannot drop into a target week evicted after rendering',()=>{
 let secondLoaded=true;const view=setup({weeks:2,weekState:day=>({loaded:day==='2026-10-26'||secondLoaded})});view.start();secondLoaded=false;view.over(7);assert.equal(view.transfer.dropEffect,'none');view.drop(7);assert.equal(view.moves.length,0);assert.match(view.rejected[0],/Indlæs ugen/);view.result.dispose();
});

test('viewport observation starts only after mounting and unknown weeks retain their measured height',()=>{
 const calls=[],viewport={heightFor:(_key,date)=>date==='2026-11-02'?1234:null,observe:options=>{calls.push(options);return {start:()=>calls.push('start'),capture:()=>({date:'2026-11-02',offset:-20}),dispose:()=>calls.push('dispose')};}},view=setup({weeks:2,viewport,viewportKey:'account:filters:zoom',weekState:day=>({loaded:day==='2026-10-26'}),onVisibleWeeks:()=>{}});assert.equal(calls.length,0);assert.equal(view.result.element.querySelectorAll('.cs-board-week')[1].style.minHeight,'1234px');view.result.observeViewport({restore:false});view.result.observeViewport();assert.equal(calls.length,2);assert.equal(calls[0].key,'account:filters:zoom');assert.equal(calls[0].restoreAnchor,false);assert.deepEqual(view.result.captureViewport(),{date:'2026-11-02',offset:-20});view.result.dispose();view.result.dispose();assert.equal(calls.filter(value=>value==='dispose').length,1);
});

test('the presentation remains an eight-week scaffold even if a caller requests an entire year',()=>{
 const view=setup({weeks:52});assert.equal(view.result.element.querySelectorAll('.cs-board-week').length,8);view.result.dispose();
});

test('week headings show company planned hours with an optional weekly budget',()=>{
  const withBudget=setup({weekHours:()=>({plannedMinutes:1800,budgetHours:102})});
  const amount=withBudget.result.element.querySelectorAll('.cs-week-planned-hours')[0];
  assert.equal(amount.textContent,'30 / 102 timer');
  assert.equal(amount.getAttribute('aria-label'),'30 af 102 timer planlagt · Hele virksomheden');
  assert.equal(amount.dataset.over,'false');
  assert.equal(withBudget.result.element.querySelectorAll('.cs-week-hours-limit').length,1);

  const withoutBudget=setup({weekHours:()=>({plannedMinutes:1830,budgetHours:null})});
  const noLimit=withoutBudget.result.element.querySelectorAll('.cs-week-planned-hours')[0];
  assert.equal(noLimit.textContent,'30,5 timer');
  assert.equal(noLimit.getAttribute('aria-label'),'30,5 timer planlagt · Hele virksomheden');
  assert.equal(withoutBudget.result.element.querySelectorAll('.cs-week-hours-limit').length,0);
  withBudget.result.dispose();withoutBudget.result.dispose();
});

test('scoped budget headings identify the chosen area in accessible text and tooltip',()=>{
  const view=setup({weekHours:()=>({plannedMinutes:1800,budgetHours:40,scopeLabel:'Nord · Kontor Nord'})});
  const amount=view.result.element.querySelectorAll('.cs-week-planned-hours')[0];
  assert.equal(amount.textContent,'30 / 40 timer');
  assert.equal(amount.getAttribute('aria-label'),'30 af 40 timer planlagt · Nord · Kontor Nord');
  assert.match(amount.title,/Nord · Kontor Nord/);
  assert.match(amount.title,/Ugebudget for det valgte område/);
  assert.doesNotMatch(amount.title,/virksomhedens samlede/);
  view.result.dispose();
});

test('a zero-hour budget stays visible and only a strict excess is marked over budget',()=>{
  for(const [plannedMinutes,budgetHours,expected,over] of [
    [0,0,'0 / 0 timer','false'],
    [60,0,'1 / 0 timer','true'],
    [1800,30,'30 / 30 timer','false'],
    [1830,30,'30,5 / 30 timer','true']
  ]){
    const view=setup({weekHours:()=>({plannedMinutes,budgetHours})});
    const amount=view.result.element.querySelectorAll('.cs-week-planned-hours')[0];
    assert.equal(amount.textContent,expected);
    assert.equal(amount.dataset.over,over);
    view.result.dispose();
  }
});

test('an unloaded week never invents a planned total or asks for its budget',()=>{
  const reads=[];
  const view=setup({weeks:2,weekState:day=>({loaded:day==='2026-10-26',loading:day!=='2026-10-26'}),weekHours:day=>{
    reads.push(day);
    return {plannedMinutes:0,budgetHours:102};
  }});
  const weeks=view.result.element.querySelectorAll('.cs-board-week');
  assert.equal(weeks[0].querySelectorAll('.cs-week-planned-hours')[0].textContent,'0 / 102 timer');
  assert.equal(weeks[1].querySelectorAll('.cs-week-planned-hours').length,0);
  assert.match(weeks[1].textContent,/Indlæser/);
  assert.ok(reads.every(day=>day==='2026-10-26'));
  view.result.dispose();
});

test('a budget-only change patches the heading while retaining cards, days and scroll',()=>{
  const observed=[],patches=[];
  const viewport={heightFor:()=>null,observe:options=>{
    observed.push(options);
    return {start(){},dispose(){},patch:run=>{patches.push(true);run();}};
  }};
  const view=setup({viewport,onVisibleWeeks(){},weekHours:()=>({plannedMinutes:1800,budgetHours:102})});
  view.result.observeViewport();
  const root=view.result.element,week=root.querySelectorAll('.cs-board-week')[0];
  const heading=week.querySelectorAll('.cs-board-week-label')[0],day=week.querySelectorAll('.cs-board-day')[0],card=view.card;
  let scrollWrites=0;
  Object.defineProperty(root,'scrollTop',{get:()=>600,set:()=>{scrollWrites++;}});
  assert.equal(view.result.update({...view.options,weekHours:()=>({plannedMinutes:1800,budgetHours:20})}),true);
  assert.equal(root.querySelectorAll('.cs-board-week')[0],week);
  assert.equal(week.querySelectorAll('.cs-board-day')[0],day);
  assert.equal(root.querySelectorAll('.cs-event')[0],card);
  assert.notEqual(week.querySelectorAll('.cs-board-week-label')[0],heading);
  assert.equal(week.querySelectorAll('.cs-week-planned-hours')[0].textContent,'30 / 20 timer');
  assert.equal(week.querySelectorAll('.cs-week-planned-hours')[0].dataset.over,'true');
  assert.equal(observed.length,1);
  assert.equal(patches.length,1);
  assert.equal(scrollWrites,0);
  view.result.dispose();
});

test('wage headers are optional, never expose a total for an unloaded week and mark partial estimates',()=>{
  const missingCallback=setup({weekCost:()=>({state:'ready',totalCents:1845000})});
  assert.equal(missingCallback.result.element.querySelectorAll('.cs-week-planned-cost').length,0);missingCallback.result.dispose();
  const reads=[],calls=[];
  const view=setup({weeks:2,weekState:day=>({loaded:day==='2026-10-26'}),weekCost:day=>{reads.push(day);return {state:'ready',totalCents:1845000,monthlyPersonCount:1,complete:false};},onOpenWeekCost:(week,button)=>calls.push({week,button})});
  const controls=view.result.element.querySelectorAll('.cs-week-planned-cost');
  assert.equal(controls.length,1);assert.equal(controls[0].textContent,'18.450 kr.*');assert.equal(controls[0].type,'button');
  assert.match(controls[0].getAttribute('aria-label'),/Delvist estimat/);assert.equal(controls[0].getAttribute('aria-haspopup'),'dialog');
  assert.ok(reads.every(day=>day==='2026-10-26'));controls[0].dispatch('click');assert.equal(calls[0].week,'2026-10-26');assert.equal(calls[0].button,controls[0]);view.result.dispose();
});

test('wage updates patch just the header, keep zero accurate, and fence detached or disposed actions',()=>{
  const calls=[],view=setup({weekCost:()=>({state:'loading'}),onOpenWeekCost:()=>calls.push('old')});
  const root=view.result.element,week=root.querySelectorAll('.cs-board-week')[0],card=view.card,initial=root.querySelectorAll('.cs-week-planned-cost')[0];
  assert.equal(initial.textContent,'Løn…');assert.doesNotMatch(initial.textContent,/0 kr/);
  let scrollWrites=0;Object.defineProperty(root,'scrollTop',{get:()=>450,set:()=>scrollWrites++});
  view.result.update({...view.options,weekCost:()=>({state:'ready',totalCents:0,complete:true}),onOpenWeekCost:()=>calls.push('new')});
  const zero=root.querySelectorAll('.cs-week-planned-cost')[0];assert.equal(zero.textContent,'0 kr.');assert.equal(root.querySelectorAll('.cs-board-week')[0],week);assert.equal(root.querySelectorAll('.cs-event')[0],card);assert.equal(scrollWrites,0);
  initial.dispatch('click');assert.deepEqual(calls,[]);zero.dispatch('click');assert.deepEqual(calls,['new']);
  view.result.update({...view.options,weekCost:()=>({state:'error',totalCents:12345})});assert.equal(root.querySelectorAll('.cs-week-planned-cost')[0].textContent,'Løn · prøv igen');
  view.result.update({...view.options,weekCost:()=>({state:'saving',totalCents:12345})});assert.equal(root.querySelectorAll('.cs-week-planned-cost')[0].textContent,'Løn opdateres…');
  const last=root.querySelectorAll('.cs-week-planned-cost')[0];view.result.dispose();last.dispatch('click');assert.deepEqual(calls,['new']);
});

test('entirely unknown wage headers do not pretend to be zero and distinguish fixed monthly exclusions',()=>{
  const view=setup({weekCost:()=>({state:'ready',shiftCount:4,totalCents:0,missingShiftCount:3,openShiftCount:1,complete:false}),onOpenWeekCost(){}});
  assert.equal(view.result.element.querySelectorAll('.cs-week-planned-cost')[0].textContent,'Mangler lønsatser');
  view.result.update({...view.options,weekCost:()=>({state:'ready',shiftCount:4,totalCents:0,missingShiftCount:0,openShiftCount:0,monthlyPersonCount:1,complete:false})});
  assert.equal(view.result.element.querySelectorAll('.cs-week-planned-cost')[0].textContent,'0 kr.*');
  view.result.update({...view.options,weekCost:()=>({state:'ready',shiftCount:4,totalCents:12345,missingShiftCount:3,openShiftCount:1,complete:false})});
  assert.equal(view.result.element.querySelectorAll('.cs-week-planned-cost')[0].textContent,'123 kr.*');view.result.dispose();
});

test('persistent updates keep the scroll root, observer and unchanged week/cards while adopting only a changed neighbor',()=>{
 const observed=[],patches=[];let started=0,disposed=0;const viewport={heightFor:()=>null,observe:options=>{observed.push(options);return {start:()=>started++,dispose:()=>disposed++,patch:run=>{patches.push(true);run();}};}};
 const first={id:'first',person:'p0',site:0,date:'2026-10-26',start:'07:00',end:'15:00',note:'Keep'},second={...first,id:'second',date:'2026-11-02'},view=setup({weeks:2,shifts:[first,second],viewport,onVisibleWeeks(){}});view.result.observeViewport();
 const root=view.result.element,weeks=root.querySelectorAll('.cs-board-week'),card=weeks[0].querySelectorAll('.cs-event')[0];let scrollWrites=0,top=700;Object.defineProperty(root,'scrollTop',{get:()=>top,set:value=>{scrollWrites++;top=value;}});
 assert.equal(view.result.update({...view.options,onOpen:()=>{},onVisibleWeeks:()=>{},shifts:[{...first},{...second}]}),true);assert.equal(root.querySelectorAll('.cs-board-week')[0],weeks[0]);assert.equal(root.querySelectorAll('.cs-board-week')[1],weeks[1]);assert.equal(root.querySelectorAll('.cs-event')[0],card);
 assert.equal(view.result.update({...view.options,shifts:[{...first},{...second,start:'08:00'}]}),true);assert.equal(view.result.element,root);assert.equal(root.querySelectorAll('.cs-board-week')[0],weeks[0]);assert.notEqual(root.querySelectorAll('.cs-board-week')[1],weeks[1]);assert.equal(card.isConnected,true);assert.equal(view.result.shown.find(shift=>shift.id==='second').start,'08:00');assert.equal(observed.length,1);assert.equal(started,1);assert.equal(disposed,0);assert.equal(patches.length,2);assert.equal(scrollWrites,0);
 assert.equal(view.result.update({...view.options,viewportKey:'different-context'}),false);assert.equal(root.querySelectorAll('.cs-board-week')[0],weeks[0]);view.result.dispose();assert.equal(disposed,1);assert.equal(view.result.update(view.options),false);
});

test('retained cards and time groups resolve current records and callbacks even when nonvisual metadata changes',()=>{
 const opened=[],grouped=[],old=[];const original={id:'one',person:'p0',site:0,date:'2026-10-26',start:'07:00',end:'15:00',note:'Instructions',custom:{version:'old'}},view=setup({shifts:[original],onOpen:shift=>old.push(shift),onEditGroup:group=>old.push(group)}),card=view.card,group=view.result.element.querySelectorAll('.cs-time-group-header')[0],fresh={...original,custom:{version:'new'}};
 assert.equal(view.result.update({...view.options,shifts:[fresh],onOpen:shift=>opened.push(shift),onEditGroup:value=>grouped.push(value)}),true);assert.equal(view.result.element.querySelectorAll('.cs-event')[0],card);assert.equal(view.result.element.querySelectorAll('.cs-time-group-header')[0],group);card.dispatch('click',{detail:0});group.dispatch('click');assert.equal(old.length,0);assert.equal(opened[0],fresh);assert.equal(grouped[0].shifts[0],fresh);
 card.remove();view.root.append(card);card.dispatch('click',{detail:0});assert.equal(opened.length,1,'A connected foreign card is not owned by the live board.');
});

test('replaced cards, groups and day controls cannot mutate through saved detached event handlers',()=>{
 const opened=[],selected=[],groups=[],created=[],days=[];const original={id:'one',person:'p0',site:0,date:'2026-10-26',start:'07:00',end:'15:00',note:'Old instructions'},view=setup({shifts:[original],onOpen:shift=>opened.push(shift),onSelect:shift=>selected.push(shift),onEditGroup:value=>groups.push(value),onCreate:day=>created.push(day),onDay:day=>days.push(day)}),oldCard=view.card,oldGroup=view.result.element.querySelectorAll('.cs-time-group-header')[0],oldAdd=view.result.element.querySelectorAll('.cs-board-add')[0],oldDay=view.result.element.querySelectorAll('.cs-board-date')[0];
 const latest={...original,note:'New instructions',noteRich:'formatted new instructions'};view.result.update({...view.options,shifts:[latest]});assert.equal(oldCard.isConnected,false);assert.equal(oldGroup.isConnected,false);oldCard.dispatch('click',{detail:0});oldCard.dispatch('click',{ctrlKey:true});oldCard.dispatch('keydown',{altKey:true,key:'ArrowRight'});assert.equal(oldCard.dispatch('dragstart',{dataTransfer:view.transfer}).defaultPrevented,true);oldGroup.dispatch('click');oldAdd.dispatch('click');oldDay.dispatch('click');assert.deepEqual([opened.length,selected.length,groups.length,created.length,days.length,view.moves.length],[0,0,0,0,0,0]);
 const current=view.result.element.querySelectorAll('.cs-event')[0];current.dispatch('click',{detail:0});assert.equal(opened[0],latest);assert.equal(opened[0].noteRich,'formatted new instructions');
});

test('loading and error status changes keep unloaded day nodes and the loaded neighbor intact',()=>{
 let phase={loaded:false,loading:false,error:''};const retries=[],view=setup({weeks:2,shifts:[{id:'one',person:'p0',site:0,date:'2026-10-26',start:'07:00',end:'15:00'}],weekState:date=>date==='2026-10-26'?{loaded:true}:phase,onWeekRetry:date=>retries.push(date)}),root=view.result.element,weeks=root.querySelectorAll('.cs-board-week'),days=weeks[1].querySelectorAll('.cs-board-day'),card=view.card;
 phase={loaded:false,loading:true,error:''};view.result.update(view.options);assert.equal(root.querySelectorAll('.cs-board-week')[0],weeks[0]);assert.equal(root.querySelectorAll('.cs-board-week')[1],weeks[1]);assert.equal(weeks[1].querySelectorAll('.cs-board-day')[0],days[0]);assert.equal(root.querySelectorAll('.cs-event')[0],card);assert.equal(weeks[1].getAttribute('aria-busy'),'true');
 phase={loaded:false,loading:false,error:'Offline'};view.result.update(view.options);const retry=weeks[1].querySelectorAll('.cs-calendar-week-retry')[0];assert.ok(retry);retry.dispatch('click');assert.deepEqual(retries,['2026-11-02']);phase={loaded:false,loading:false,error:''};view.result.update(view.options);retry.dispatch('click');assert.deepEqual(retries,['2026-11-02']);assert.equal(weeks[1].querySelectorAll('.cs-board-day')[0],days[0]);
});

test('eviction and reload reserve measured border-box height, while explicit expansion and collapse can change it',()=>{
 let loaded=true;const view=setup({weekState:()=>({loaded}),shifts:[{id:'one',person:'p0',site:0,date:'2026-10-26',start:'07:00',end:'15:00'}]}),root=view.result.element;root.querySelectorAll('.cs-board-week')[0].getBoundingClientRect=()=>({top:0,bottom:910,height:910});loaded=false;view.result.update(view.options);let section=root.querySelectorAll('.cs-board-week')[0];assert.equal(section.style.minHeight,'910px');assert.equal(section.style.boxSizing,'border-box');section.getBoundingClientRect=()=>({top:0,bottom:910,height:910});loaded=true;view.result.update(view.options);section=root.querySelectorAll('.cs-board-week')[0];assert.equal(section.style.minHeight,'910px');assert.equal(section.style.boxSizing,'border-box');
 const entries=Array.from({length:13},(_,index)=>({id:'extra-'+index,person:'p'+index,site:0,date:'2026-10-27',start:'07:00',end:'15:00'})),expanded=setup({shifts:entries}),board=expanded.result.element;board.querySelectorAll('.cs-board-week')[0].getBoundingClientRect=()=>({top:0,bottom:900,height:900});board.querySelectorAll('.cs-board-more')[0].dispatch('click');assert.equal(expanded.result.shown.length,13);let week=board.querySelectorAll('.cs-board-week')[0];week.getBoundingClientRect=()=>({top:0,bottom:1600,height:1600});week.querySelectorAll('.cs-board-more')[0].dispatch('click');assert.equal(expanded.result.shown.length,12);assert.equal(board.querySelectorAll('.cs-board-week')[0].style.minHeight,'');
});


test('asynchronous wage or budget headings preserve a protected native drag and revalidate its next target',()=>{
 const view=setup({weekCost:()=>({state:'loading'})});view.start();view.transfer.getData=()=>'';view.over(1);
 const before=view.previews.length;assert.equal(view.card.classList.contains('is-dragging'),true);
 view.result.update({...view.options,weekCost:()=>({state:'ready',totalCents:123400,complete:true})});
 assert.equal(view.card.classList.contains('is-dragging'),true);assert.equal(view.result.element.querySelectorAll('.cs-event')[0],view.card);
 view.over(2);assert.equal(view.previews.length,before+1);assert.equal(view.previews.at(-1),'2026-10-28');view.drop(2);assert.equal(view.moves.length,1);
});

test('overnight cards keep their start-day placement and a shared next-day time band while day totals split',()=>{
 const shifts=[{id:'night-a',person:'p0',date:'2026-10-26',site:0,start:'22:00',end:'06:00',plannedBreakMinutes:30},{id:'night-b',person:'p1',date:'2026-10-26',site:0,start:'22:00',end:'06:00'}];
 const view=setup({shifts,dayHours:day=>day==='2026-10-26'?240:day==='2026-10-27'?690:0});
 assert.equal(view.cells[0].querySelectorAll('.cs-event').length,2);assert.equal(view.cells[1].querySelectorAll('.cs-event').length,0);assert.match(view.cells[0].querySelectorAll('.cs-time-group-label')[0].textContent,/22:00.*06:00.*\+1 dag/);assert.match(view.card.getAttribute('aria-label'),/\+1 dag/);assert.match(view.cells[0].querySelectorAll('.cs-board-hours')[0].textContent,/4 timer/);assert.match(view.cells[1].querySelectorAll('.cs-board-hours')[0].textContent,/11,5 timer/);view.result.dispose();
});
