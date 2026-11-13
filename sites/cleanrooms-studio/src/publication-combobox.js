/* Searchable comboboxes keep a native select as the source of values and events. */
(() => {
  'use strict';

  let nextId = 0;
  const instances = new WeakMap();
  const controllers = new WeakMap();
  const sourceMarker = 'data-cs-select-source';
  const fold = text => String(text).toLocaleLowerCase('da-DK')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('ø', 'o').replaceAll('æ', 'ae');

  function eligible(select) {
    return select?.tagName === 'SELECT' && !select.multiple && !(select.size > 1) &&
      !select.hasAttribute('data-native-select') && select.getAttribute('aria-hidden') !== 'true' &&
      (!select.classList?.contains('cs-rich-select') || select.hasAttribute('data-custom-select'));
  }

  function mirrorSetter(element, name, onWrite) {
    if (Object.hasOwn(element, name)) return () => {};
    let descriptor;
    for (let proto = Object.getPrototypeOf(element); proto; proto = Object.getPrototypeOf(proto)) {
      descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor) break;
    }
    if (!descriptor?.get || !descriptor.set) return () => {};
    Object.defineProperty(element, name, {
      configurable: true,
      get: descriptor.get,
      set(value) {
        descriptor.set.call(this, value);
        onWrite();
      }
    });
    return () => { delete element[name]; };
  }

  function labelText(label) {
    if (!label.childNodes) return label.textContent?.trim();
    const parts = [];
    function read(node) {
      if (node.nodeType === 3) parts.push(node.nodeValue);
      else if (node.nodeType === 1 && !node.matches('select,input,button,textarea,.cs-publication-combobox,[aria-hidden="true"]')) {
        node.childNodes.forEach(read);
      }
    }
    label.childNodes.forEach(read);
    return parts.join(' ').trim();
  }

  function enhance(select, {label, labelElement, describeOption, searchOption, footer} = {}) {
    const previous = instances.get(select);
    if (previous) return previous;
    if (!eligible(select) || !select.parentElement) return null;
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
    const selectOnly = select.hasAttribute('data-select-only');
    const toggle = node('span', 'toggle');
    const menu = node('div', 'menu');
    const list = node('div', 'list');
    const empty = node('p', 'empty', 'Ingen resultater');
    const footerSlot = footer ? node('div', 'footer') : null;
    const labels = new Map([...(labelElement ? [labelElement] : select.labels || [])]
      .map(element => [element, element.getAttribute('for')]));
    const containingLabel = select.closest('label');
    const footerParent = footer?.parentNode;
    const footerNext = footer?.nextSibling;
    const originalFocus = Object.getOwnPropertyDescriptor(select, 'focus');
    const wasFocused = doc.activeElement === select;
    const mirroredFocusKeys = new Set();
    const canFloat = typeof menu.showPopover === 'function';
    let labelParent;
    let open = false;
    let disposed = false;
    let syncQueued = false;
    let query = '';
    let rows = [];
    let active = -1;

    input.id = prefix;
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    if (selectOnly) {
      wrapper.dataset.selectOnly = 'true';
      input.readOnly = true;
      input.inputMode = 'none';
    } else {
      input.setAttribute('aria-autocomplete', 'list');
    }
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', prefix + '-list');
    toggle.setAttribute('aria-hidden', 'true');
    list.id = prefix + '-list';
    list.setAttribute('role', 'listbox');
    empty.setAttribute('role', 'status');
    menu.hidden = empty.hidden = true;
    if (canFloat) menu.setAttribute('popover', 'manual');
    menu.append(list, empty);
    if (footerSlot) {
      footerSlot.append(footer);
      menu.append(footerSlot);
    }
    wrapper.append(input, toggle, menu);
    select.after(wrapper);
    if (containingLabel) {
      labelParent = containingLabel.parentElement;
      containingLabel.after(select);
    }
    select.setAttribute(sourceMarker, '');
    for (const element of labels.keys()) element.setAttribute('for', input.id);
    Object.defineProperty(select, 'focus', {configurable: true, value: options => input.focus(options)});
    const stopMirroring = [
      mirrorSetter(select, 'value', scheduleSync),
      mirrorSetter(select, 'selectedIndex', scheduleSync)
    ];

    function selectedOption() {
      return select.selectedOptions[0];
    }

    function resetInput() {
      const selected = selectedOption();
      input.value = selected && (!selected.disabled || selected.value || selectOnly) ? selected.label : '';
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
      const footerBounds = footerSlot?.getBoundingClientRect();
      const bottom = footerBounds?.height && footerBounds.top > bounds.top
        ? Math.min(bounds.bottom, footerBounds.top) : bounds.bottom;
      if (center) menu.scrollTop += target.top - bounds.top - (bottom - bounds.top - target.height) / 2;
      else if (target.top < bounds.top) menu.scrollTop -= bounds.top - target.top;
      else if (target.bottom > bottom) menu.scrollTop += target.bottom - bottom;
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
        const searchable = [labelText, meta, searchOption?.(option)].filter(Boolean).map(fold).join(' ');
        if (!words.every(word => searchable.includes(word))) continue;

        const row = node('div', 'option');
        const copy = node('span', 'option-copy');
        copy.append(node('span', 'option-label', option.label));
        if (meta) copy.append(node('span', 'option-meta', meta));
        row.id = prefix + '-option-' + rows.length;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected));
        row.append(copy);
        row.addEventListener('click', event => {
          // A wrapping label would otherwise forward this click to the input.
          event.preventDefault();
          choose(option);
        });
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
      if (event.type === 'scroll' && event.target?.nodeType === 1 && event.target.contains(input)) {
        const field = input.getBoundingClientRect();
        const bounds = event.target.getBoundingClientRect();
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
      if (open || disposed || input.disabled || wrapper.hidden) return;
      open = true;
      query = term;
      menu.hidden = false;
      wrapper.dataset.open = 'true';
      input.setAttribute('aria-expanded', 'true');
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
      if (menu.hasAttribute('popover') && menu.matches(':popover-open')) menu.hidePopover();
      menu.hidden = true;
      wrapper.removeAttribute('data-open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      list.replaceChildren();
      rows = [];
      active = -1;
      resetInput();
    }

    function choose(option) {
      if (!open || input.disabled || option.disabled || option.parentElement?.disabled || !select.contains(option)) return;
      close();
      input.focus({preventScroll: true});
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new win.Event('input', {bubbles: true}));
        select.dispatchEvent(new win.Event('change', {bubbles: true}));
      }
      sync();
    }

    function scheduleSync() {
      if (syncQueued || disposed) return;
      syncQueued = true;
      queueMicrotask(() => {
        syncQueued = false;
        sync();
      });
    }

    function mirrorAttribute(attribute, value = select.getAttribute(attribute)) {
      if (value === null) input.removeAttribute(attribute);
      else if (input.getAttribute(attribute) !== value) input.setAttribute(attribute, value);
    }

    function syncName() {
      const labelledBy = label ? null : select.getAttribute('aria-labelledby');
      const explicit = label || select.getAttribute('aria-label');
      const name = explicit || [...labels.keys()].map(labelText).filter(Boolean).join(' ') || select.title || 'Vælg';
      mirrorAttribute('aria-labelledby', labelledBy);
      mirrorAttribute('aria-label', explicit || (!labels.size && !labelledBy ? name : null));
      if (labelledBy) {
        list.setAttribute('aria-labelledby', labelledBy);
        list.removeAttribute('aria-label');
      } else {
        list.setAttribute('aria-label', name);
        list.removeAttribute('aria-labelledby');
      }
      input.placeholder = selectedOption()?.disabled && !selectedOption()?.value ? selectedOption().label : name;
    }

    function sync() {
      if (disposed) return;
      if (containingLabel && containingLabel.parentElement && containingLabel.parentElement !== labelParent &&
        select.parentElement === labelParent && containingLabel.contains(wrapper)) {
        labelParent = containingLabel.parentElement;
        containingLabel.after(select);
      }
      wrapper.dataset.selectId = select.id || '';
      if (select.classList?.contains('cs-rich-select')) wrapper.dataset.selectKind = 'toolbar';
      else wrapper.removeAttribute('data-select-kind');
      const hidden = select.hidden || select.style?.display === 'none';
      if (wrapper.hidden !== hidden) wrapper.hidden = hidden;
      input.disabled = select.disabled || Boolean(select.matches?.(':disabled'));
      wrapper.dataset.disabled = String(input.disabled);
      for (const attribute of ['aria-describedby', 'aria-required', 'title', 'tabindex']) mirrorAttribute(attribute);
      const invalid = select.getAttribute('aria-invalid') || (input.validity?.customError && !select.validity?.valid ? 'true' : null);
      mirrorAttribute('aria-invalid', invalid);
      if (!selectOnly && (select.validity?.valid || input.disabled)) input.setCustomValidity?.('');
      if (select.required) input.setAttribute('aria-required', 'true');
      for (const key of mirroredFocusKeys) delete input.dataset[key];
      mirroredFocusKeys.clear();
      for (const [key, value] of Object.entries(select.dataset)) {
        if (!key.endsWith('Focus')) continue;
        input.dataset[key] = value;
        mirroredFocusKeys.add(key);
      }
      syncName();
      if (input.disabled || wrapper.hidden || wrapper.closest('[hidden],[inert],dialog:not([open])')) close();
      if (open) renderOptions(rows[active]?.option.value);
      else resetInput();
    }

    function focus({open: showMenu = false} = {}) {
      if (disposed || input.disabled || wrapper.hidden) return;
      input.focus();
      if (showMenu && !open) {
        if (!selectOnly) input.select();
        openMenu();
      }
    }

    function changeQuery(event) {
      event.stopPropagation();
      if (selectOnly) { resetInput(); return; }
      if (event.isComposing) return;
      if (!open) openMenu(input.value);
      else {
        query = input.value;
        menu.scrollTop = 0;
        renderOptions();
      }
    }

    input.addEventListener('focus', () => { if (!open && !selectOnly) input.select(); });
    input.addEventListener('click', () => {
      if (open) {
        if (selectOnly) close();
        return;
      }
      if (!selectOnly) input.select();
      openMenu();
    });
    input.addEventListener('input', changeQuery);
    input.addEventListener('compositionend', changeQuery);
    input.addEventListener('change', event => event.stopPropagation());
    input.addEventListener('blur', event => {
      if (event.relatedTarget && !wrapper.contains(event.relatedTarget)) close();
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      switch (event.key) {
        case 'Escape':
          if (!open) return;
          event.preventDefault();
          event.stopPropagation();
          close();
          if (!selectOnly) input.select();
          break;
        case 'Tab': {
          const action = footer?.matches('button') ? footer : footer?.querySelector('button:not([disabled])');
          if (open && !event.shiftKey && action && !action.disabled && !action.closest('[hidden]')) {
            event.preventDefault();
            event.stopPropagation();
            action.focus();
          } else {
            close();
          }
          break;
        }
        case 'ArrowDown':
        case 'ArrowUp':
          event.preventDefault();
          if (!open) {
            openMenu();
            if (selectOnly && event.key === 'ArrowUp') highlight(rows.length - 1);
          }
          else if (rows.length) highlight(Math.min(rows.length - 1, Math.max(0, active + (event.key === 'ArrowDown' ? 1 : -1))));
          break;
        case 'Home':
        case 'End':
          if (!selectOnly) return;
          event.preventDefault();
          if (!open) openMenu();
          highlight(event.key === 'Home' ? 0 : rows.length - 1);
          break;
        case ' ':
          if (!selectOnly) return;
          event.preventDefault();
          event.stopPropagation();
          if (!open) openMenu();
          else if (rows[active]) choose(rows[active].option);
          break;
        case 'Enter':
          if (selectOnly && !open && (event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          event.stopPropagation();
          if (!open) openMenu();
          else if (rows[active]) choose(rows[active].option);
          break;
      }
    });
    // Keep focus on the text input when selecting an option with a pointer.
    toggle.addEventListener('mousedown', event => event.preventDefault());
    menu.addEventListener('mousedown', event => event.preventDefault());
    toggle.addEventListener('click', event => {
      event.preventDefault();
      if (open) close();
      else focus({open: true});
    });
    footer?.addEventListener('keydown', escapeFooter);
    select.addEventListener('change', scheduleSync);
    select.addEventListener('invalid', showValidation);

    function escapeFooter(event) {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      input.focus({preventScroll: true});
    }

    function showValidation(event) {
      event.preventDefault();
      if (wrapper.hidden || !input.getClientRects().length) return;
      input.setAttribute('aria-invalid', 'true');
      if (selectOnly) {
        input.focus();
        return;
      }
      input.setCustomValidity(select.validationMessage);
      input.reportValidity();
    }

    const controller = {
      input, sync, focus, close,
      dispose() {
        if (disposed) return;
        close();
        disposed = true;
        select.removeEventListener('change', scheduleSync);
        select.removeEventListener('invalid', showValidation);
        footer?.removeEventListener('keydown', escapeFooter);
        if (footerParent) footerParent.insertBefore(footer, footerNext?.parentNode === footerParent ? footerNext : null);
        for (const stop of stopMirroring) stop();
        if (originalFocus) Object.defineProperty(select, 'focus', originalFocus);
        else delete select.focus;
        select.removeAttribute(sourceMarker);
        if (containingLabel && select.parentElement === labelParent) {
          if (wrapper.parentElement) wrapper.before(select);
          else select.remove();
        }
        wrapper.remove();
        for (const [element, previousFor] of labels) {
          if (element.getAttribute('for') !== input.id) continue;
          if (previousFor != null) element.setAttribute('for', previousFor);
          else element.removeAttribute('for');
        }
        instances.delete(select);
      }
    };
    instances.set(select, controller);
    sync();
    if (wasFocused) input.focus({preventScroll: true});
    return controller;
  }

  function enhanceAll(root) {
    const previous = controllers.get(root);
    if (previous) return previous;
    const tracked = new Set();
    const Observer = root.ownerDocument.defaultView.MutationObserver;
    let disposed = false;

    function collect(node, selects) {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'SELECT') selects.add(node);
      else node.querySelectorAll('select').forEach(select => selects.add(select));
    }

    function update(select) {
      if (!eligible(select) || !root.contains(select)) {
        instances.get(select)?.dispose();
        tracked.delete(select);
        return;
      }
      const control = enhance(select);
      if (control) {
        tracked.add(select);
        control.sync();
      }
    }

    function sync() {
      if (disposed) return;
      const selects = new Set(tracked);
      collect(root, selects);
      selects.forEach(update);
    }

    function mutations(records) {
      const updates = new Set();
      let removed = false;
      for (const record of records) {
        const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (!node || node.closest('.cs-publication-combobox')) continue;
        const select = node.closest('select');
        if (select) updates.add(select);
        if (record.type === 'childList') {
          record.addedNodes.forEach(added => collect(added, updates));
          removed ||= record.removedNodes.length > 0;
        } else if (!select && (['hidden', 'inert', 'open'].includes(record.attributeName) ||
          (record.attributeName === 'disabled' && node.tagName === 'FIELDSET'))) {
          collect(node, updates);
          // A select moved out of an implicit label still belongs to that field.
          for (const candidate of tracked) {
            if (node.contains(instances.get(candidate)?.input)) updates.add(candidate);
          }
        }
      }
      if (removed) {
        for (const select of tracked) {
          const control = instances.get(select);
          if (!root.contains(select) || !root.contains(control?.input)) {
            control?.dispose();
            tracked.delete(select);
          }
        }
      }
      updates.forEach(update);
    }

    function reset(event) {
      queueMicrotask(() => {
        if (disposed) return;
        for (const select of tracked) {
          if (select.form === event.target) instances.get(select)?.sync();
        }
      });
    }

    const observer = Observer ? new Observer(mutations) : null;
    const controller = {
      sync,
      close: () => closeAll(root),
      dispose() {
        if (disposed) return;
        disposed = true;
        observer?.disconnect();
        root.removeEventListener('reset', reset, true);
        tracked.forEach(select => instances.get(select)?.dispose());
        tracked.clear();
        controllers.delete(root);
      }
    };
    controllers.set(root, controller);
    sync();
    observer?.observe(root, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-describedby', 'aria-hidden', 'aria-invalid', 'aria-label', 'aria-labelledby', 'aria-required',
        'class', 'data-custom-select', 'data-native-select', 'disabled', 'hidden', 'id', 'inert', 'label', 'multiple',
        'open', 'required', 'selected', 'size', 'style', 'tabindex', 'title', 'value']
    });
    root.addEventListener('reset', reset, true);
    return controller;
  }

  function closeAll(root) {
    root.querySelectorAll('select[' + sourceMarker + ']').forEach(select => instances.get(select)?.close());
  }

  const api = Object.freeze({enhance, enhanceAll, closeAll, get: select => instances.get(select)});
  globalThis.CleanRoomsCombobox = api;
  globalThis.CleanRoomsPublicationCombobox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
