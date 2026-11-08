/* Company budget compares draft paid minutes with each configured period. */
(() => {
  'use strict';
  const hoursFormat = new Intl.NumberFormat('da-DK', {maximumFractionDigits: 2});
  const monthFormat = new Intl.DateTimeFormat('da-DK', {month: 'long', year: 'numeric', timeZone: 'UTC'});
  // A hundredth of a minute keeps comparisons exact for budgets entered with two decimals.
  const unitsPerHour = 6000;
  const hours = units => hoursFormat.format(units / unitsPerHour);
  const time = units => units > 0 && units < 60 ? 'under 0,01 t' : hours(units) + ' t';
  const remaining = delta => delta > 0 ? time(delta) + ' over budget'
    : delta < 0 ? time(-delta) + ' tilbage'
    : 'Budgettet er nået';
  function periodLabel(from, unit) {
    if (unit === 'month') return monthFormat.format(new Date(from + 'T12:00:00Z'));
    const week = globalThis.CleanRoomsPublicationRange.weekNumber(from);
    return 'Uge ' + week.week + ', ' + week.year;
  }
  function amounts(period) {
    const planned = period.plannedMinutes * 100;
    const limit = Math.round(period.budgetHours * 100) * 60;
    return {planned, limit, delta: planned - limit};
  }
  function periodSummary(period) {
    const {planned, limit, delta} = amounts(period);
    return {remaining:remaining(delta),totals:hours(planned)+' / '+hours(limit)+' t',over:delta>0};
  }

  function render(element, {state, budget, message, onRetry} = {}) {
    const doc = element.ownerDocument;
    const node = (tag, className, text) => {
      const item = doc.createElement(tag);
      if (className) item.className = className;
      if (text !== undefined) item.textContent = text;
      return item;
    };
    const title = node('div', 'cs-publication-budget-title');
    title.append(node('h4', '', 'Timebudget'), node('span', '', 'Hele virksomheden'));
    const children = [title];
    if (state !== 'ready' || !budget?.periods?.length) {
      const statusText = state === 'loading' ? 'Beregner planlagte timer…'
        : state === 'error' ? 'Timebudgettet kunne ikke beregnes.'
        : 'Angiv et timebudget under Indstillinger → Virksomhed.';
      const status = node('p', 'cs-publication-budget-note', message || statusText);
      status.setAttribute('role', 'status');
      children.push(status);
      if (state === 'error' && onRetry) {
        const retry = node('button', 'cs-button cs-publication-budget-retry', 'Prøv igen');
        retry.type = 'button';
        retry.addEventListener('click', onRetry);
        children.push(retry);
      }
      element.replaceChildren(...children);
      return;
    }

    const monthly = budget.period === 'month';
    const periods = budget.periods.map(period => ({label:periodLabel(period.from,budget.period),...amounts(period)}));
    const totals = periods.reduce((sum, period) => ({planned: sum.planned + period.planned, limit: sum.limit + period.limit}), {planned: 0, limit: 0});
    const over = periods.filter(period => period.delta > 0).length;
    const single = periods.length === 1;
    const unit = monthly ? 'måneder' : 'uger';
    const overview = node('div', 'cs-publication-budget-overview');
    const numbers = node('div', 'cs-publication-budget-numbers');
    numbers.append(node('strong', '', hours(totals.planned) + ' / ' + hours(totals.limit) + ' t'), node('span', '', 'planlagt / budget'));
    const status = node('span', 'cs-publication-budget-status', !single && over
      ? over + ' af ' + periods.length + ' ' + unit + ' over budget'
      : remaining(totals.planned - totals.limit));
    status.dataset.over = String(over > 0);
    overview.append(numbers, status);
    children.push(overview);
    const description = single ? periods[0].label : monthly ? 'Hele kalendermåneder' : periods.length + ' uger i gennemgangen';
    children.push(node('p', 'cs-publication-budget-note', description + ' · Inkl. ledige vagter, fratrukket ulønnede pauser'));

    if (!single) {
      const details = node('details', 'cs-publication-budget-details');
      details.open = element.querySelector('details')?.open === true;
      details.append(node('summary', '', monthly ? 'Se budget pr. måned' : 'Se budget pr. uge'));
      const list = node('ul', 'cs-publication-budget-periods');
      for (const period of periods) {
        const row = node('li');
        const delta = node('span', 'cs-publication-budget-status', remaining(period.delta));
        delta.dataset.over = String(period.delta > 0);
        row.append(node('strong', '', period.label), node('span', '', hours(period.planned) + ' / ' + hours(period.limit) + ' t'), delta);
        list.append(row);
      }
      details.append(list);
      children.push(details);
    }
    element.replaceChildren(...children);
  }

  globalThis.CleanRoomsPublicationBudget = Object.freeze({render,periodLabel,periodSummary});
})();
