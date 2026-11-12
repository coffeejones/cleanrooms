/* Search and choose a value from an existing publication select. */
(() => {
  'use strict';

  let nextId = 0;
  const fold = text => String(text).toLocaleLowerCase('da-DK')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('ø', 'o').replaceAll('æ', 'ae');

  function enhance(select, {label, labelElement, describeOption} = {}) {
    const doc = select.ownerDocument;
    const win = doc.defaultView;
    const prefix = 'cs-publication-combobox-' + ++nextId;
    const node = (tag, name, text) => {
      const element = doc.createElement(tag);
      element.className = 'cs-publication-combobox' + (name ? '-' + name : '');
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const wrapper = node('div', '');
    const input = node('input', 'input');
    const toggle = node('button', 'toggle');
    const menu = node('div', 'menu');
    const list = node('div', 'list');
    const empty = node('p', 'empty', 'Ingen resultater');
    const name = label || select.getAttribute('aria-label') || labelElement?.textContent || 'Vælg';
    const scrollArea = select.closest('.cs-group-fields');
    const wasHidden = select.hidden;
    const labelFor = labelElement?.getAttribute('for');
    const canFloat = typeof menu.showPopover === 'function';
    let open = false;
    let disposed = false;
    let query = '';
    let rows = [];
    let active = -1;

    input.id = prefix;
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.placeholder = name;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', name);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', prefix + '-list');
    toggle.type = 'button';
    toggle.tabIndex = -1;
    toggle.setAttribute('aria-label', 'Vis valgmuligheder for ' + name.toLocaleLowerCase('da-DK'));
    toggle.setAttribute('aria-controls', prefix + '-list');
    toggle.setAttribute('aria-expanded', 'false');
    list.id = prefix + '-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', name);
    empty.setAttribute('role', 'status');
    menu.hidden = empty.hidden = true;
    if (canFloat) menu.setAttribute('popover', 'manual');
    menu.append(list, empty);
    wrapper.append(input, toggle, menu);
    select.after(wrapper);
    select.hidden = true;
    labelElement?.setAttribute('for', input.id);

    function selectedOption() {
      return select.selectedOptions[0];
    }

    function resetInput() {
      const selected = selectedOption();
      input.value = selected?.value ? selected.label : '';
    }

    function positionMenu() {
      if (!open || !menu.hasAttribute('popover')) return;
      const viewport = win.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? win.innerWidth;
      const height = viewport?.height ?? win.innerHeight;
      const rect = input.getBoundingClientRect();
      const inset = 8;
      const gap = 5;
      const menuWidth = Math.max(0, Math.min(Math.max(rect.width, describeOption ? 228 : 176), width - inset * 2));
      const below = top + height - rect.bottom - gap - inset;
      const above = rect.top - top - gap - inset;
      const flip = below < 188 && above > below;
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      menu.style.width = menuWidth + 'px';
      menu.style.left = clamp(rect.left, left + inset, left + width - inset - menuWidth) + 'px';
      menu.style.top = flip ? 'auto' : clamp(rect.bottom + gap, top + inset, top + height - inset) + 'px';
      menu.style.bottom = flip ? win.innerHeight - clamp(rect.top - gap, top + inset, top + height - inset) + 'px' : 'auto';
      menu.style.maxHeight = Math.max(0, Math.min(288, flip ? above : below)) + 'px';
    }

    function reveal(row, center) {
      if (!row) return;
      const bounds = menu.getBoundingClientRect();
      const target = row.getBoundingClientRect();
      if (center) menu.scrollTop += target.top - bounds.top - (bounds.height - target.height) / 2;
      else if (target.top < bounds.top) menu.scrollTop -= bounds.top - target.top;
      else if (target.bottom > bounds.bottom) menu.scrollTop += target.bottom - bounds.bottom;
    }

    function highlight(index, center = false) {
      rows[active]?.element.removeAttribute('data-active');
      active = index;
      const row = rows[index]?.element;
      if (!row) {
        input.removeAttribute('aria-activedescendant');
        return;
      }
      row.dataset.active = 'true';
      input.setAttribute('aria-activedescendant', row.id);
      reveal(row, center);
    }

    function renderOptions(preferredValue, center = false) {
      const words = fold(query).trim().split(/\s+/).filter(Boolean);
      const groups = new Map();
      const elements = [];
      rows = [];
      active = -1;
      for (const option of select.options) {
        const group = option.parentElement;
        const grouped = group?.tagName === 'OPTGROUP';
        if (option.disabled || option.hidden || (grouped && (group.disabled || group.hidden))) continue;
        const groupLabel = grouped ? group.label : '';
        const meta = describeOption?.(option);
        const labelText = fold(option.label + ' ' + groupLabel);
        const searchable = labelText + (meta ? ' ' + fold(meta) : '');
        if (!words.every(word => searchable.includes(word))) continue;

        const row = node('div', 'option');
        const copy = node('span', 'option-copy');
        copy.append(node('span', 'option-label', option.label));
        if (meta) copy.append(node('span', 'option-meta', meta));
        row.id = prefix + '-option-' + rows.length;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected));
        row.append(copy);
        row.addEventListener('click', () => choose(option));
        const labelWords = labelText.match(/[\p{L}\p{N}]+/gu) || [];
        const exactMatch = words.length > 0 && words.every(word => labelWords.includes(word));
        rows.push({element: row, option, exactMatch});

        if (grouped) {
          if (!groups.has(group)) {
            const container = node('div', 'group');
            const heading = node('div', 'group-label', groupLabel);
            heading.id = prefix + '-group-' + groups.size;
            container.setAttribute('role', 'group');
            container.setAttribute('aria-labelledby', heading.id);
            container.append(heading);
            groups.set(group, container);
            elements.push(container);
          }
          groups.get(group).append(row);
        } else {
          elements.push(row);
        }
      }
      list.replaceChildren(...elements);
      empty.hidden = Boolean(rows.length);
      positionMenu();
      const group = selectedOption()?.parentElement;
      const sameGroup = item => item.option.parentElement === group;
      const bestMatch = [
        rows.findIndex(item => item.option.value === preferredValue),
        rows.findIndex(item => item.exactMatch && sameGroup(item)),
        rows.findIndex(item => item.exactMatch),
        rows.findIndex(item => item.option.value === select.value),
        rows.findIndex(sameGroup)
      ].find(index => index >= 0);
      highlight(bestMatch ?? (rows.length ? 0 : -1), center);
    }

    function outside(event) {
      if (!wrapper.contains(event.target)) close();
    }

    function reposition(event) {
      if (event.target?.nodeType && menu.contains(event.target)) return;
      if (scrollArea && event.target === scrollArea) {
        const field = input.getBoundingClientRect();
        const bounds = scrollArea.getBoundingClientRect();
        if (field.bottom <= bounds.top || field.top >= bounds.bottom) {
          close();
          return;
        }
      }
      positionMenu();
    }

    function watchMenu(listen) {
      const method = listen ? 'addEventListener' : 'removeEventListener';
      doc[method]('pointerdown', outside, true);
      doc[method]('focusin', outside, true);
      win[method]('resize', reposition);
      win[method]('scroll', reposition, true);
      win.visualViewport?.[method]('resize', positionMenu);
      win.visualViewport?.[method]('scroll', positionMenu);
    }

    function openMenu(term = '') {
      if (open || disposed || input.disabled) return;
      open = true;
      query = term;
      menu.hidden = false;
      wrapper.dataset.open = 'true';
      input.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      if (menu.hasAttribute('popover')) {
        try {
          menu.showPopover();
        } catch {
          menu.removeAttribute('popover');
        }
      }
      watchMenu(true);
      renderOptions(undefined, true);
    }

    function close() {
      if (!open) return;
      open = false;
      query = '';
      watchMenu(false);
      if (menu.hasAttribute('popover')) menu.hidePopover();
      menu.hidden = true;
      wrapper.removeAttribute('data-open');
      input.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      list.replaceChildren();
      rows = [];
      active = -1;
      resetInput();
    }

    function choose(option) {
      if (!open || select.disabled || option.disabled || option.parentElement?.disabled || !select.contains(option)) return;
      close();
      input.focus({preventScroll: true});
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new win.Event('change', {bubbles: true}));
      }
      sync();
    }

    function sync() {
      if (disposed) return;
      input.disabled = toggle.disabled = select.disabled;
      for (const attribute of ['aria-invalid', 'aria-describedby']) {
        const value = select.getAttribute(attribute);
        if (value === null) input.removeAttribute(attribute);
        else input.setAttribute(attribute, value);
      }
      if (input.disabled) close();
      if (open) renderOptions(rows[active]?.option.value);
      else resetInput();
    }

    function focus({open: showMenu = false} = {}) {
      if (disposed || input.disabled) return;
      input.focus();
      if (showMenu && !open) {
        input.select();
        openMenu();
      }
    }

    function changeQuery(event) {
      if (event.isComposing) return;
      if (!open) openMenu(input.value);
      else {
        query = input.value;
        menu.scrollTop = 0;
        renderOptions();
      }
    }

    input.addEventListener('focus', () => { if (!open) input.select(); });
    input.addEventListener('click', () => {
      if (open) return;
      input.select();
      openMenu();
    });
    input.addEventListener('input', changeQuery);
    input.addEventListener('compositionend', changeQuery);
    input.addEventListener('blur', event => {
      if (event.relatedTarget && !wrapper.contains(event.relatedTarget)) close();
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      switch (event.key) {
        case 'Escape':
          if (!open) return;
          event.preventDefault();
          close();
          input.select();
          break;
        case 'Tab':
          close();
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          event.preventDefault();
          if (!open) openMenu();
          else if (rows.length) highlight(Math.min(rows.length - 1, Math.max(0, active + (event.key === 'ArrowDown' ? 1 : -1))));
          break;
        case 'Enter':
          event.preventDefault();
          if (!open) openMenu();
          else if (rows[active]) choose(rows[active].option);
          break;
      }
    });
    // Keep focus on the text input when selecting an option with a pointer.
    toggle.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('mousedown', event => event.preventDefault());
    toggle.addEventListener('click', () => {
      if (open) close();
      else focus({open: true});
    });

    sync();
    return {
      sync, focus, close,
      dispose() {
        if (disposed) return;
        close();
        disposed = true;
        wrapper.remove();
        select.hidden = wasHidden;
        if (labelFor != null) labelElement.setAttribute('for', labelFor);
        else labelElement?.removeAttribute('for');
      }
    };
  }

  const api = Object.freeze({enhance});
  globalThis.CleanRoomsPublicationCombobox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
