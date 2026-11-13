/* A 24-hour selection, committed only after confirmation. */
(() => {
  'use strict';

  let nextId = 0;
  const pad = value => String(value).padStart(2, '0');

  function render({panel, input, select}) {
    const doc = panel.ownerDocument;
    const prefix = 'cs-shift-time-' + ++nextId;
    const initial = /^(\d{2}):(\d{2})/.exec(input.value) || ['', '07', '00'];
    const draft = [Number(initial[1]), Number(initial[2])];
    const node = (tag, className, text) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const columns = node('div', 'cs-shift-time-columns');

    function column(title, size, part) {
      const wrapper = node('div', 'cs-shift-time-column');
      const label = node('div', 'cs-shift-time-label', title);
      const list = node('div', 'cs-shift-time-list');
      label.id = prefix + '-label-' + part;
      list.tabIndex = 0;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-labelledby', label.id);
      const options = Array.from({length: size}, (_, value) => {
        const option = node('div', 'cs-shift-time-option', pad(value));
        option.id = prefix + '-' + part + '-' + value;
        option.setAttribute('role', 'option');
        option.addEventListener('click', () => {
          choose(value);
          list.focus({preventScroll: true});
        });
        return option;
      });
      list.append(...options);
      wrapper.append(label, list);
      columns.append(wrapper);

      function reveal() {
        const option = options[draft[part]];
        const bounds = list.getBoundingClientRect();
        const target = option.getBoundingClientRect();
        if (target.top < bounds.top) list.scrollTop += target.top - bounds.top;
        else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom;
      }

      function paint() {
        const chosen = options[draft[part]];
        for (const option of options) option.setAttribute('aria-selected', String(option === chosen));
        list.setAttribute('aria-activedescendant', chosen.id);
      }

      function choose(value) {
        draft[part] = Math.max(0, Math.min(size - 1, value));
        paint();
        reveal();
      }

      list.addEventListener('keydown', event => {
        const value = draft[part];
        const next = {ArrowDown: value + 1, ArrowUp: value - 1, Home: 0, End: size - 1};
        if (!Object.hasOwn(next, event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        choose(next[event.key]);
      });
      draft[part] = Math.min(draft[part], size - 1);
      paint();
      return {list, center() {
        const option = options[draft[part]], bounds = list.getBoundingClientRect(), target = option.getBoundingClientRect();
        list.scrollTop += target.top - bounds.top - Math.floor(list.clientHeight / target.height / 2) * target.height;
      }};
    }

    const hours = column('Timer', 24, 0);
    const minutes = column('Minutter', 60, 1);
    const actions = node('div', 'cs-shift-time-actions');
    const confirm = node('button', 'cs-button cs-primary', 'Vælg tid');
    confirm.type = 'button';
    confirm.addEventListener('click', () => select(draft.map(pad).join(':')));
    actions.append(confirm);
    panel.replaceChildren(columns, actions);
    doc.defaultView.requestAnimationFrame(() => {
      if (hours.list.isConnected) { hours.center(); minutes.center(); }
    });
    return hours.list;
  }

  globalThis.CleanRoomsShiftTimeOptions = Object.freeze({render});
})();
