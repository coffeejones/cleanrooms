const test = require('node:test');
const assert = require('node:assert/strict');
const Combobox = require('../src/publication-combobox.js');

class Element extends EventTarget {
  constructor(tag, document) {
    super();
    this.tagName = tag.toUpperCase();
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
      this.children.push(child);
      child.parentElement = this;
    }
  }
  after(element) {
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, element);
    element.parentElement = parent;
  }
  remove() {
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  closest() { return null; }
  contains(element) { return descendants(this).includes(element); }
  getBoundingClientRect() { return {top: 0, bottom: 0, height: 0}; }
  get label() { return this.textContent; }
  get options() { return descendants(this).filter(element => element.tagName === 'OPTION'); }
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
  return {select, label, option, withClass, create: doc.createElement};
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
  assert.equal(select.hidden, true);
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
  assert.equal(label.getAttribute('for'), 'native-select');
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
