const test = require('node:test');
const assert = require('node:assert/strict');
const Combobox = require('../src/publication-combobox.js');

class Element extends EventTarget {
  constructor(tag, document) {
    super();
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = this.disabled = false;
    this.scrollTop = 0;
    this.textContent = this.value = '';
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      this.children.push(child);
      child.parentElement = this;
    }
  }
  after(element) {
    this.insertNext(element, 1);
  }
  before(element) {
    this.insertNext(element, 0);
  }
  insertNext(element, offset) {
    const parent = this.parentElement;
    element.remove();
    parent.children.splice(parent.children.indexOf(this) + offset, 0, element);
    element.parentElement = parent;
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector === node.tagName.toLowerCase() || node.className?.split(' ').includes(selector.slice(1))) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    return descendants(this).slice(1).filter(node => node.tagName === 'SELECT' &&
      (selector === 'select' || (selector === 'select[data-cs-select-source]' && node.hasAttribute('data-cs-select-source'))));
  }
  contains(element) { return descendants(this).includes(element); }
  getBoundingClientRect() { return {top: 0, bottom: 0, height: 0}; }
  get label() { return this.textContent; }
  get labels() { return this.closest('label') ? [this.closest('label')] : []; }
  get options() { return descendants(this).filter(element => element.tagName === 'OPTION'); }
  get value() { return this.currentValue; }
  set value(value) { this.currentValue = String(value); }
  get selectedIndex() { return this.options.findIndex(option => option.value === this.value); }
  set selectedIndex(index) { this.value = this.options[index]?.value || ''; }
  get selectedOptions() { return this.options.filter(option => option.value === this.value); }
  get selected() {
    const select = this.parentElement?.tagName === 'OPTGROUP' ? this.parentElement.parentElement : this.parentElement;
    return this.value === select?.value;
  }
  focus() { this.ownerDocument.activeElement = this; }
  select() {}
}

const descendants = element => [element, ...element.children.flatMap(descendants)];
const dispatch = (target, type, properties = {}) => {
  const event = Object.assign(new Event(type, {cancelable: true}), properties);
  target.dispatchEvent(event);
  return event;
};

function fixture() {
  const doc = new EventTarget();
  doc.defaultView = Object.assign(new EventTarget(), {Event});
  let report;
  doc.defaultView.MutationObserver = class {
    constructor(callback) { report = callback; }
    observe() {}
    disconnect() { report = undefined; }
  };
  doc.createElement = tag => new Element(tag, doc);
  const parent = doc.createElement('div');
  const select = doc.createElement('select');
  const label = doc.createElement('label');
  label.textContent = 'Vælg';
  label.setAttribute('for', 'native-select');
  parent.append(label, select);
  const option = (value, text, disabled = false) => {
    const item = doc.createElement('option');
    Object.assign(item, {value, textContent: text, disabled});
    return item;
  };
  const withClass = name => descendants(parent).filter(element => element.className === 'cs-publication-combobox-' + name);
  return {doc, parent, select, label, option, withClass, create: doc.createElement, mutate: (...records) => report(records)};
}

test('search across week and year commits only the selected enabled result', () => {
  const {select, option, withClass, create} = fixture();
  for (const year of [2025, 2026]) {
    const group = create('optgroup');
    group.textContent = String(year);
    group.append(option(year + '-46', 'Uge 46'), option(year + '-47', 'Uge 47'));
    select.append(group);
  }
  select.append(option('other-year', 'Vælg andet år…'));
  select.value = '2026-46';
  let changes = 0;
  select.addEventListener('change', () => changes++);
  const combo = Combobox.enhance(select, {label: 'Startuge'});
  const [input] = withClass('input');
  assert.equal(select.hasAttribute('data-cs-select-source'), true);
  assert.equal(select.hidden, false);
  assert.equal(input.value, 'Uge 46');

  dispatch(input, 'keydown', {key: 'ArrowDown'});
  assert.equal(withClass('option-label').at(-1).textContent, 'Vælg andet år…');
  input.value = '47 2026';
  dispatch(input, 'input');
  assert.deepEqual(withClass('option-label').map(item => item.textContent), ['Uge 47']);
  assert.equal(select.value, '2026-46');
  assert.equal(dispatch(input, 'keydown', {key: 'Escape'}).defaultPrevented, true);
  assert.equal(input.value, 'Uge 46');
  assert.equal(changes, 0);

  input.value = '47 2026';
  dispatch(input, 'input');
  dispatch(input, 'keydown', {key: 'Enter'});
  assert.equal(select.value, '2026-47');
  assert.equal(input.value, 'Uge 47');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(changes, 1);
  combo.dispose();
});

test('standalone options remain available and the visible control follows disabled state', () => {
  const {select, label, option, withClass} = fixture();
  select.append(option('', 'Vælg', true), option('0', 'Østerbro'), option('all', 'Alle arbejdssteder'));
  select.value = 'all';
  const combo = Combobox.enhance(select, {labelElement: label});
  const [input] = withClass('input');
  assert.equal(label.getAttribute('for'), input.id);
  combo.focus({open: true});
  assert.deepEqual(withClass('option-label').map(item => item.textContent), ['Østerbro', 'Alle arbejdssteder']);
  input.value = 'osterbro';
  dispatch(input, 'input');
  assert.deepEqual(withClass('option-label').map(item => item.textContent), ['Østerbro']);
  select.disabled = true;
  combo.sync();
  assert.equal(input.disabled, true);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.value, 'Alle arbejdssteder');
  assert.equal(select.value, 'all');
  combo.dispose();
  assert.equal(select.hidden, false);
  assert.equal(select.hasAttribute('data-cs-select-source'), false);
  assert.equal(label.getAttribute('for'), 'native-select');
});

test('shared enhancement follows dynamic selects, native setters and opt-out flags', async () => {
  const {parent, select, option, create, mutate} = fixture();
  select.setAttribute('data-native-select', '');
  const controller = Combobox.enhanceAll(parent);
  assert.equal(Combobox.get(select), undefined);

  const source = create('select');
  source.append(option('', 'Ikke tilknyttet'), option('1', 'Nørrebro'));
  source.dataset.fieldFocus = 'site';
  parent.append(source);
  mutate({type: 'childList', target: parent, addedNodes: [source], removedNodes: []});
  const instance = Combobox.get(source);
  assert.equal(instance.input.value, 'Ikke tilknyttet');
  assert.equal(instance.input.dataset.fieldFocus, 'site');
  assert.equal(Combobox.enhance(source), instance);

  source.value = '1';
  await Promise.resolve();
  assert.equal(instance.input.value, 'Nørrebro');
  source.selectedIndex = 0;
  await Promise.resolve();
  assert.equal(instance.input.value, 'Ikke tilknyttet');
  source.hidden = true;
  source.disabled = true;
  mutate({type: 'attributes', target: source, attributeName: 'hidden'});
  assert.equal(instance.input.parentElement.hidden, true);
  assert.equal(instance.input.disabled, true);

  source.remove();
  mutate({type: 'childList', target: parent, addedNodes: [], removedNodes: [source]});
  assert.equal(Combobox.get(source), undefined);
  assert.equal(parent.contains(instance.input), false);
  controller.dispose();
});

test('implicit labels continue to activate the visible input and restore the native placement', () => {
  const {doc, parent, select, label, option, withClass} = fixture();
  label.removeAttribute('for');
  label.textContent = 'Vælg arbejdssted';
  label.append(select);
  select.append(option('0', 'Kontor Nord'), option('1', 'Klinikken'));
  select.value = '0';
  select.focus();
  const combo = Combobox.enhance(select);
  assert.equal(parent.contains(select), true);
  assert.equal(label.contains(select), false);
  assert.equal(label.contains(combo.input), true);
  assert.equal(label.getAttribute('for'), combo.input.id);
  assert.equal(doc.activeElement, combo.input);
  combo.focus({open: true});
  assert.equal(dispatch(withClass('option')[1], 'click').defaultPrevented, true);
  assert.equal(select.value, '1');
  assert.equal(combo.input.getAttribute('aria-expanded'), 'false');
  combo.dispose();
  assert.equal(label.contains(select), true);
  assert.equal(label.getAttribute('for'), null);
});

test('an exact duration takes precedence over a current partial match', () => {
  const {select, option, withClass} = fixture();
  select.append(option('2', '2 uger'), option('12', '12 uger'));
  select.value = '12';
  const combo = Combobox.enhance(select, {label: 'Antal uger'});
  const [input] = withClass('input');
  input.value = '2';
  dispatch(input, 'input');
  dispatch(input, 'keydown', {key: 'Enter'});
  assert.equal(select.value, '2');
  combo.dispose();
});

test('select-only control opens and picks with the keyboard without accepting typed values', () => {
  const {select, option, withClass} = fixture();
  select.setAttribute('data-select-only', '');
  select.append(option('0', 'Kontor Nord'), option('1', 'Klinikken'), option('2', 'Havnegade', true));
  select.value = '0';
  const combo = Combobox.enhance(select, {label: 'Arbejdssted'});
  assert.equal(combo.input.readOnly, true);
  assert.equal(combo.input.inputMode, 'none');
  assert.equal(combo.input.getAttribute('aria-autocomplete'), null);
  combo.input.value = 'not an option';
  dispatch(combo.input, 'input');
  assert.equal(combo.input.value, 'Kontor Nord');
  assert.equal(combo.input.getAttribute('aria-expanded'), 'false');

  const key = value => dispatch(combo.input, 'keydown', {key: value});
  assert.equal(key(' ').defaultPrevented, true);
  assert.deepEqual(withClass('option-label').map(item => item.textContent), ['Kontor Nord', 'Klinikken']);
  key('End');
  key('Escape');
  assert.equal(select.value, '0');
  key('ArrowDown');
  key('ArrowDown');
  key('Enter');
  assert.equal(select.value, '1');
  assert.equal(combo.input.value, 'Klinikken');
  assert.equal(combo.input.getAttribute('aria-expanded'), 'false');
  assert.equal(dispatch(combo.input, 'keydown', {key: 'Enter', metaKey: true}).defaultPrevented, false);
  combo.dispose();
});
