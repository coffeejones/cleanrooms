(() => {
  'use strict';

  const firstDate = '0001-01-01';
  const lastDate = '9999-12-31';
  const asDate = value => new Date(value + 'T12:00:00Z');
  const firstInstant = asDate(firstDate).getTime();
  const lastInstant = asDate(lastDate).getTime();
  const weekdays = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
  const monthLabel = new Intl.DateTimeFormat('da-DK', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayLabel = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const localDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Copenhagen' });
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= firstDate && value <= lastDate &&
    Number.isFinite(asDate(value).getTime()) && asDate(value).toISOString().slice(0, 10) === value;
  const isoDate = value => new Date(Math.max(firstInstant, Math.min(lastInstant, value.getTime()))).toISOString().slice(0, 10);
  const monthStart = value => value.slice(0, 7) + '-01';
  const mondayIndex = value => (asDate(value).getUTCDay() + 6) % 7;

  function addDays(value, days) {
    const day = asDate(value);
    day.setUTCDate(day.getUTCDate() + days);
    return isoDate(day);
  }

  function daysInMonth(value) {
    const day = asDate(monthStart(value));
    day.setUTCMonth(day.getUTCMonth() + 1, 0);
    return day.getUTCDate();
  }

  function addMonths(value, months) {
    const shifted = asDate(monthStart(value));
    shifted.setUTCMonth(shifted.getUTCMonth() + months);
    const target = isoDate(shifted);
    shifted.setUTCDate(Math.min(asDate(value).getUTCDate(), daysInMonth(target)));
    return isoDate(shifted);
  }

  function render({ panel, input, select }) {
    const document = panel.ownerDocument;
    const selected = validDate(input.value) ? input.value : null;
    const min = validDate(input.min) ? input.min : firstDate;
    const max = validDate(input.max) ? input.max : lastDate;
    const parts = Object.fromEntries(localDay.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const withinRange = value => min <= value && value <= max;
    const clamp = value => value < min ? min : value > max ? max : value;
    let active = min <= max ? clamp(selected ?? today) : selected ?? today;
    let month = monthStart(active);
    const days = new Map();

    function element(tag, className, text) {
      const result = document.createElement(tag);
      if (className) result.className = className;
      if (text !== undefined) result.textContent = text;
      return result;
    }

    function button(label, text, className) {
      const result = element('button', className, text);
      result.type = 'button';
      result.setAttribute('aria-label', label);
      return result;
    }

    const head = element('div', 'cs-shift-date-head');
    const title = element('div', 'cs-shift-date-title');
    title.setAttribute('aria-live', 'polite');
    title.setAttribute('aria-atomic', 'true');
    const nav = element('div', 'cs-shift-date-nav');
    const previous = button('Forrige måned', '‹');
    const next = button('Næste måned', '›');
    nav.append(previous, next);
    head.append(title, nav);
    const grid = element('div', 'cs-shift-date-grid');
    grid.setAttribute('role', 'group');
    panel.replaceChildren(head, grid);

    function paint() {
      const label = monthLabel.format(asDate(month));
      title.textContent = label;
      grid.setAttribute('aria-label', 'Vælg dato i ' + label);
      previous.disabled = min > max || month <= monthStart(min);
      next.disabled = min > max || month >= monthStart(max);
      days.clear();
      const cells = [];
      for (const weekday of weekdays) {
        const cell = element('span', 'cs-shift-date-weekday', weekday);
        cell.setAttribute('aria-hidden', 'true');
        cells.push(cell);
      }
      for (let index = 0; index < mondayIndex(month); index++) {
        const cell = element('span');
        cell.setAttribute('aria-hidden', 'true');
        cells.push(cell);
      }
      const dayCount = daysInMonth(month);
      for (let index = 1; index <= dayCount; index++) {
        const date = month.slice(0, 8) + String(index).padStart(2, '0');
        const cell = button(dayLabel.format(asDate(date)), String(index), 'cs-shift-date-day');
        cell.dataset.date = date;
        cell.disabled = !withinRange(date);
        cell.tabIndex = !cell.disabled && date === active ? 0 : -1;
        cell.setAttribute('aria-pressed', String(date === selected));
        if (date === today) {
          cell.dataset.today = '';
          cell.setAttribute('aria-current', 'date');
        }
        cell.addEventListener('click', () => select(date));
        cell.addEventListener('keydown', event => moveByKey(event, date));
        days.set(date, cell);
        cells.push(cell);
      }
      grid.replaceChildren(...cells);
    }

    function setActive(value) {
      const day = clamp(value);
      const old = days.get(active);
      active = day;
      const destination = monthStart(day);
      if (destination !== month) {
        month = destination;
        paint();
      } else {
        if (old) old.tabIndex = -1;
        days.get(day).tabIndex = 0;
      }
      return days.get(day);
    }

    function moveByKey(event, value) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      let destination;
      switch (event.key) {
        case 'ArrowLeft': destination = addDays(value, -1); break;
        case 'ArrowRight': destination = addDays(value, 1); break;
        case 'ArrowUp': destination = addDays(value, -7); break;
        case 'ArrowDown': destination = addDays(value, 7); break;
        case 'Home': destination = addDays(value, -mondayIndex(value)); break;
        case 'End': destination = addDays(value, 6 - mondayIndex(value)); break;
        case 'PageUp': destination = addMonths(value, event.shiftKey ? -12 : -1); break;
        case 'PageDown': destination = addMonths(value, event.shiftKey ? 12 : 1); break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      setActive(destination).focus();
    }

    function moveMonth(direction, control) {
      control.focus();
      const day = setActive(addMonths(active, direction));
      if (control.disabled) day.focus();
    }
    previous.addEventListener('click', () => moveMonth(-1, previous));
    next.addEventListener('click', () => moveMonth(1, next));
    paint();
    if (min <= max) return days.get(active);
    panel.tabIndex = -1;
    return panel;
  }

  const api = Object.freeze({ render });
  globalThis.CleanRoomsShiftDateCalendar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
