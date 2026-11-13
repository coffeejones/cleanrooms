(() => {
  'use strict';

  function mount(form, icon) {
    const date = globalThis.CleanRoomsShiftDateCalendar;
    const time = globalThis.CleanRoomsShiftTimeOptions;
    if (!form || !date || !time) return null;
    const doc = form.ownerDocument, win = doc.defaultView;
    const panel = doc.createElement('div');
    if (typeof panel.showPopover !== 'function') return null;
    panel.id = 'cs-shift-picker';
    panel.className = 'cs-shift-picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('popover', 'manual');
    panel.hidden = true;
    form.append(panel);
    let current = null;

    function position() {
      if (!current) return;
      const {trigger, wrapper, input} = current;
      if (!trigger.getClientRects().length || input.disabled || input.readOnly) { close(); return; }
      const rect = wrapper.getBoundingClientRect();
      const viewport = win.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? win.innerWidth), bottom = top + (viewport?.height ?? win.innerHeight);
      const scrollArea = form.querySelector('.cs-editor-fields').getBoundingClientRect();
      if (rect.bottom <= scrollArea.top || rect.top >= scrollArea.bottom) { close(); return; }
      const inset = 8, gap = 6;
      const width = Math.min(panel.dataset.kind === 'date' ? 288 : 208, right - left - inset * 2);
      panel.style.inlineSize = width + 'px';
      const below = bottom - rect.bottom - gap - inset, above = rect.top - top - gap - inset;
      const flip = below < panel.scrollHeight && above > below;
      const anchor = rect.width >= width ? rect.right - width : rect.left;
      panel.style.left = Math.min(Math.max(anchor, left + inset), right - width - inset) + 'px';
      panel.style.top = flip ? 'auto' : Math.max(top + inset, rect.bottom + gap) + 'px';
      panel.style.bottom = flip ? win.innerHeight - Math.min(rect.top - gap, bottom - inset) + 'px' : 'auto';
      panel.style.maxHeight = Math.max(0, flip ? above : below) + 'px';
    }

    function close(restoreFocus = false) {
      if (!current) return;
      const {trigger} = current;
      current = null;
      trigger.setAttribute('aria-expanded', 'false');
      if (panel.matches(':popover-open')) panel.hidePopover();
      panel.hidden = true;
      panel.replaceChildren();
      if (restoreFocus && trigger.getClientRects().length) trigger.focus({preventScroll: true});
    }

    function attach(input) {
      if (!input || input.parentElement.classList.contains('cs-shift-picker-field')) return;
      const kind = input.type === 'date' ? 'date' : 'time';
      const wrapper = doc.createElement('div'), trigger = doc.createElement('button');
      wrapper.className = 'cs-shift-picker-field';
      trigger.type = 'button';
      trigger.className = 'cs-shift-picker-trigger';
      trigger.dataset.kind = kind;
      trigger.append(icon(kind === 'date' ? 'calendar-days' : 'clock-3'));
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', panel.id);
      trigger.setAttribute('aria-expanded', 'false');
      const updateLabel = () => {
        const name = input.getAttribute('aria-label') || [...input.labels].map(label => label.firstChild?.textContent.trim()).filter(Boolean).join(' ');
        const label = (kind === 'date' ? 'Vælg dato' : 'Vælg klokkeslæt') + (name ? ': ' + name : '');
        trigger.setAttribute('aria-label', label);
        return label;
      };
      input.before(wrapper);
      wrapper.append(input, trigger);
      updateLabel();
      // An editor scope can rename Startdato to Gælder fra.
      if (input.id === 'cs-repeat-start') {
        const label = input.labels[0];
        if (label) new win.MutationObserver(updateLabel).observe(label, {childList: true});
      }
      trigger.addEventListener('click', () => {
        if (current?.trigger === trigger) { close(true); return; }
        close();
        if (input.disabled || input.readOnly) return;
        current = {input, wrapper, trigger};
        wrapper.append(panel);
        panel.dataset.kind = kind;
        panel.setAttribute('aria-label', updateLabel());
        trigger.setAttribute('aria-expanded', 'true');
        const target = (kind === 'date' ? date : time).render({panel, input, select(value) {
          close(true);
          if (value === input.value) return;
          input.value = value;
          input.dispatchEvent(new win.Event('input', {bubbles: true}));
          input.dispatchEvent(new win.Event('change', {bubbles: true}));
        }});
        panel.hidden = false;
        panel.showPopover();
        position();
        target.focus({preventScroll: true});
      });
    }

    form.querySelectorAll('input[type="date"],input[type="time"]').forEach(attach);
    doc.addEventListener('pointerdown', event => {
      if (current && !panel.contains(event.target) && !current.trigger.contains(event.target)) close();
    }, true);
    doc.addEventListener('focusin', event => {
      if (current && !panel.contains(event.target) && current.trigger !== event.target) close();
    });
    form.addEventListener('keydown', event => {
      if (current && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    win.addEventListener('resize', position);
    win.addEventListener('scroll', position, true);
    win.visualViewport?.addEventListener('resize', position);
    win.visualViewport?.addEventListener('scroll', position);
    return {attach, close};
  }

  globalThis.CleanRoomsShiftEditorPickers = Object.freeze({mount});
})();
