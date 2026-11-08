/* Time budgets are independent for the company, each department and each worksite. */
(() => {
  'use strict';

  const Roster = globalThis.CleanRoomsRoster || (typeof require === 'function' ? require('./roster-model.js') : null);
  const labels = {company: 'Virksomhed', department: 'Afdeling', site: 'Arbejdssted'};
  const resultLimit = 50;
  let sequence = 0;

  function mount({element, onSave} = {}) {
    if (!element?.ownerDocument) throw new TypeError('Timebudgetter kræver et indholdsfelt.');
    const doc = element.ownerDocument;
    const suffix = '-budgets-' + ++sequence;
    const drafts = new Map();
    const selectedIds = {department: '', site: ''};
    let data = {settings: {}, sites: [], departments: [], versions: {}, canEdit: false, ready: false};
    let catalogs = {department: new Map(), site: new Map()};
    let kind = 'company';
    let disposed = false;

    function node(tag, className, text) {
      const item = doc.createElement(tag);
      if (className) item.className = className;
      if (text !== undefined) item.textContent = text;
      return item;
    }
    function option(value, label) {
      const item = node('option', '', label);
      item.value = value;
      return item;
    }
    function button(label, action, className = 'cs-button') {
      const item = node('button', className, label);
      item.type = 'button';
      item.addEventListener('click', action);
      return item;
    }
    function field(label, control) {
      const holder = node('label', 'cs-product-field');
      holder.append(node('span', 'cs-product-field-label', label), control);
      return holder;
    }
    function budget(value) {
      return Roster?.validWorkHoursBudget(value) ? {period: value.period, hours: value.hours} : null;
    }
    const sameBudget = (left, right) => left?.period === right?.period && left?.hours === right?.hours;
    const keyFor = (scope, id = '') => scope + ':' + id;
    const selectedId = () => kind === 'company' ? '' : selectedIds[kind];
    const ready = () => typeof data.ready === 'object' ? Boolean(data.ready?.[kind]) : Boolean(data.ready);
    const canEdit = () => typeof data.canEdit === 'object' ? Boolean(data.canEdit?.[kind]) : Boolean(data.canEdit);
    function source(scope, id) {
      const entity = scope === 'company' ? data.settings : catalogs[scope].get(id);
      const versions = data.versions?.[scope];
      const version = versions instanceof Map ? versions.get(id) : versions?.[id];
      return {
        exists: scope === 'company' || Boolean(entity),
        name: scope === 'company' ? data.settings?.companyName || 'Hele virksomheden' : entity?.name || labels[scope],
        budget: budget(entity?.workHoursBudget),
        version: Number.isSafeInteger(version) && version >= 0 ? version : null
      };
    }
    function resetDraft(draft, current) {
      draft.baseBudget = current.budget;
      draft.baseVersion = current.version;
      draft.period = current.budget?.period || 'week';
      draft.hours = current.budget ? String(current.budget.hours) : '';
      draft.dirty = false;
      draft.error = '';
      draft.status = '';
      draft.conflicted = false;
      draft.awaiting = false;
      draft.invalid = false;
    }
    function currentDraft() {
      const id = selectedId();
      if (kind !== 'company' && !id) return null;
      const key = keyFor(kind, id);
      if (!drafts.has(key)) {
        const draft = {kind, id, saving: false};
        resetDraft(draft, source(kind, id));
        drafts.set(key, draft);
      }
      return drafts.get(key);
    }
    function stale(draft, current) {
      return draft.conflicted || !current.exists ||
        (draft.kind !== 'company' && current.version !== draft.baseVersion) ||
        !sameBudget(current.budget, draft.baseBudget);
    }
    function synchronizeDrafts() {
      for (const draft of drafts.values()) {
        const current = source(draft.kind, draft.id);
        if (draft.saving) continue;
        if (draft.awaiting) {
          if (sameBudget(current.budget, draft.baseBudget)) {
            const status = draft.status;
            resetDraft(draft, current);
            draft.status = status;
          }
        } else if (!draft.dirty && !draft.conflicted) {
          const status = draft.status;
          resetDraft(draft, current);
          draft.status = status;
        }
      }
    }

    const page = node('section', 'cs-workspace-budgets cs-settings-section');
    const heading = node('div', 'cs-settings-section-heading');
    heading.append(
      node('h3', 'cs-product-heading', 'Timebudgetter'),
      node('p', 'cs-product-caption', 'Sæt det samlede antal timer, I har råd til at planlægge. Hvert område har sit eget budget.')
    );
    const form = node('form', 'cs-workspace-budgets-form cs-settings-section-fields');
    form.noValidate = true;
    const area = node('select', 'cs-product-input');
    area.id = 'cs-workspace-budget-area' + suffix;
    for (const [value, label] of Object.entries(labels)) area.append(option(value, label));
    const areaField = field('Budget for', area);
    const entityFields = node('div', 'cs-workspace-budgets-entity-fields');
    const search = node('input', 'cs-product-input');
    search.type = 'search';
    search.id = 'cs-workspace-budget-search' + suffix;
    search.autocomplete = 'off';
    search.spellcheck = false;
    const searchField = field('Søg', search);
    const entity = node('select', 'cs-product-input');
    entity.id = 'cs-workspace-budget-entity' + suffix;
    const entityField = field('Vælg område', entity);
    const entityLabel = entityField.firstChild;
    const catalogHelp = node('p', 'cs-product-help cs-workspace-budgets-catalog-help');
    catalogHelp.id = 'cs-workspace-budget-catalog' + suffix;
    catalogHelp.setAttribute('role', 'status');
    entity.setAttribute('aria-describedby', catalogHelp.id);
    entityFields.append(searchField, entityField, catalogHelp);

    const editor = node('div', 'cs-workspace-budgets-editor');
    const summary = node('div', 'cs-workspace-budgets-summary');
    const title = node('h4', 'cs-workspace-budgets-title');
    const saved = node('p', 'cs-workspace-budgets-saved');
    summary.append(title, saved);
    const period = node('select', 'cs-product-input');
    period.id = 'cs-workspace-budget-period' + suffix;
    period.append(option('week', 'Pr. uge'), option('month', 'Pr. måned'));
    const hours = node('input', 'cs-product-input');
    hours.type = 'number';
    hours.id = 'cs-workspace-budget-hours' + suffix;
    hours.min = '0';
    hours.max = String(Roster?.workHoursBudgetLimit || 4000000);
    hours.step = '0.01';
    hours.inputMode = 'decimal';
    hours.placeholder = 'Intet maksimum';
    const pair = node('div', 'cs-product-field-pair cs-workspace-budgets-values');
    pair.append(field('Periode', period), field('Timer i alt', hours));
    const help = node('p', 'cs-product-help', 'Lad timer stå tomt for at fjerne maksimum for dette område.');
    help.id = 'cs-workspace-budget-help' + suffix;
    hours.setAttribute('aria-describedby', help.id);
    const notice = node('div', 'cs-workspace-budgets-notice');
    const noticeText = node('p', 'cs-product-help');
    const reload = button('Hent seneste', () => {
      const draft = currentDraft();
      if (!draft || draft.saving) return;
      resetDraft(draft, source(draft.kind, draft.id));
      paint();
    });
    notice.setAttribute('role', 'status');
    notice.append(noticeText, reload);
    const error = node('p', 'cs-product-error');
    error.id = 'cs-workspace-budget-error' + suffix;
    error.setAttribute('role', 'alert');
    const status = node('p', 'cs-product-save-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = node('div', 'cs-workspace-budgets-actions');
    const cancel = button('Annuller ændringer', () => {
      const draft = currentDraft();
      if (!draft || draft.saving || draft.awaiting) return;
      resetDraft(draft, source(draft.kind, draft.id));
      paint();
    });
    const save = button('Gem timebudget', () => saveBudget(), 'cs-button cs-primary');
    actions.append(cancel, save);
    const permission = node('p', 'cs-product-help cs-workspace-budgets-permission');
    editor.append(summary, pair, help, notice, error, status, permission, actions);
    const empty = node('p', 'cs-product-help cs-workspace-budgets-empty');
    form.append(areaField, entityFields, empty, editor);
    page.append(heading, form);
    element.append(page);

    function paintEntities() {
      const scoped = kind !== 'company';
      entityFields.hidden = !scoped;
      if (!scoped) return;
      const singular = kind === 'department' ? 'afdeling' : 'arbejdssted';
      search.placeholder = 'Søg efter ' + singular + '…';
      entityLabel.textContent = 'Vælg ' + singular;
      const query = search.value.trim().toLocaleLowerCase('da-DK');
      const all = [...catalogs[kind].values()];
      const matching = query ? all.filter(item => String(item.name || '').toLocaleLowerCase('da-DK').includes(query)) : all;
      const visible = matching.slice(0, resultLimit);
      const id = selectedId();
      const selected = catalogs[kind].get(id);
      if (selected && !visible.some(item => item.id === id)) visible.unshift(selected);
      entity.replaceChildren(option('', 'Vælg ' + singular + '…'));
      for (const item of visible) entity.append(option(item.id, item.name || singular));
      entity.value = selected ? id : '';
      catalogHelp.hidden = matching.length <= resultLimit && matching.length > 0;
      catalogHelp.textContent = !all.length ? 'Der er endnu ingen ' + (kind === 'department' ? 'afdelinger.' : 'arbejdssteder.') :
        !matching.length ? 'Ingen resultater. Prøv en anden søgning.' :
          'Viser de første ' + resultLimit + ' af ' + matching.length.toLocaleString('da-DK') + '. Søg for at finde et bestemt område.';
      entity.disabled = !ready() || !all.length;
      search.disabled = !ready() || !all.length;
    }
    function paint() {
      if (disposed) return;
      area.value = kind;
      area.disabled = disposed;
      const draft = currentDraft();
      const current = source(kind, selectedId());
      const hasSelection = Boolean(draft && current.exists);
      editor.hidden = !hasSelection;
      empty.hidden = hasSelection;
      empty.textContent = !ready() ? 'Indlæser timebudgetter…' :
        draft && !current.exists ? 'Området er ikke længere tilgængeligt. Vælg et andet område.' :
          'Vælg ' + (kind === 'department' ? 'en afdeling' : 'et arbejdssted') + ' for at se og ændre timebudgettet.';
      if (!hasSelection) return;
      const isStale = stale(draft, current);
      const editable = ready() && canEdit() && !draft.saving;
      title.textContent = current.name;
      const stored = current.budget;
      saved.textContent = stored ? stored.hours.toLocaleString('da-DK', {maximumFractionDigits: 2}) + ' timer pr. ' + (stored.period === 'week' ? 'uge' : 'måned') : 'Intet maksimum angivet';
      if (period.value !== draft.period) period.value = draft.period;
      if (hours.value !== draft.hours) hours.value = draft.hours;
      period.disabled = hours.disabled = !editable || draft.awaiting;
      form.setAttribute('aria-busy', String(draft.saving));
      notice.hidden = !isStale || draft.awaiting;
      noticeText.textContent = 'Budgettet er ændret, siden du begyndte. Dine ændringer er bevaret. Hent seneste værdier, før du gemmer.';
      reload.hidden = false;
      reload.disabled = draft.saving || !ready();
      error.textContent = draft.error;
      error.hidden = !draft.error;
      hours.setAttribute('aria-invalid', String(Boolean(draft.invalid)));
      if (draft.invalid) hours.setAttribute('aria-errormessage', error.id);
      else hours.removeAttribute('aria-errormessage');
      status.textContent = draft.saving ? 'Gemmer…' : draft.awaiting ? 'Gemt. Afventer seneste postversion…' : draft.status;
      status.hidden = !status.textContent;
      permission.textContent = !ready() ? 'Indlæser seneste oplysninger…' : !canEdit() ? 'Du har ikke tilladelse til at ændre timebudgetter.' : '';
      permission.hidden = !permission.textContent;
      cancel.hidden = !draft.dirty;
      cancel.disabled = !editable || draft.awaiting;
      save.textContent = draft.saving ? 'Gemmer…' : 'Gem timebudget';
      save.disabled = !editable || !draft.dirty || isStale || draft.awaiting ||
        (kind !== 'company' && current.version === null);
      if (kind !== 'company' && current.version === null && ready()) {
        notice.hidden = false;
        reload.hidden = true;
        noticeText.textContent = 'Postversionen mangler. Genindlæs siden for at hente de seneste oplysninger.';
      }
    }
    function edit() {
      const draft = currentDraft();
      if (!draft || draft.saving || draft.awaiting || !canEdit() || !ready()) return;
      draft.period = period.value;
      draft.hours = hours.value;
      draft.dirty = draft.period !== (draft.baseBudget?.period || 'week') || draft.hours !== (draft.baseBudget ? String(draft.baseBudget.hours) : '') || hours.validity.badInput;
      draft.invalid = false;
      draft.error = '';
      draft.status = '';
      paint();
    }
    area.addEventListener('change', () => {
      kind = area.value;
      search.value = '';
      paintEntities();
      paint();
    });
    search.addEventListener('input', paintEntities);
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') event.preventDefault();
    });
    entity.addEventListener('change', () => {
      selectedIds[kind] = entity.value;
      paint();
    });
    period.addEventListener('change', edit);
    hours.addEventListener('input', edit);
    async function saveBudget() {
      const draft = currentDraft();
      if (!draft || save.disabled || typeof onSave !== 'function') return;
      const current = source(draft.kind, draft.id);
      if (stale(draft, current)) { paint(); return; }
      const value = draft.hours.trim() === '' ? null : {period: draft.period, hours: Number(draft.hours)};
      if (hours.validity.badInput || value !== null && !Roster?.validWorkHoursBudget(value)) {
        draft.invalid = true;
        draft.error = 'Angiv et gyldigt timeantal fra 0 til ' + Number(hours.max).toLocaleString('da-DK') + ' med højst to decimaler.';
        paint();
        hours.focus();
        return;
      }
      const payload = {kind: draft.kind, workHoursBudget: value, before: draft.baseBudget};
      if (draft.kind !== 'company') {
        payload.id = draft.id;
        payload.expectedVersion = draft.baseVersion;
      }
      draft.saving = true;
      draft.error = '';
      paint();
      try {
        const result = await onSave(payload);
        if (disposed) return;
        if (!result?.ok) {
          draft.error = typeof result?.error === 'string' ? result.error : result?.message || 'Timebudgettet kunne ikke gemmes. Prøv igen.';
          draft.conflicted = result?.status === 409 || result?.code === 'CONFLICT';
        } else {
          const latest = source(draft.kind, draft.id);
          resetDraft(draft, sameBudget(latest.budget, value) ? latest : {...latest, budget: value, version: draft.baseVersion});
          draft.awaiting = !sameBudget(latest.budget, value);
          draft.status = 'Timebudgettet er gemt.';
        }
      } catch (cause) {
        if (disposed) return;
        draft.error = typeof cause?.message === 'string' ? cause.message : 'Timebudgettet kunne ikke gemmes. Prøv igen.';
      } finally {
        draft.saving = false;
        paint();
      }
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      return saveBudget();
    });

    return {
      render(next = {}) {
        if (disposed) return;
        data = {...data, ...next};
        catalogs = {
          department: new Map((data.departments || []).map(item => [item.id, item])),
          site: new Map((data.sites || []).map(item => [item.id, item]))
        };
        synchronizeDrafts();
        paintEntities();
        paint();
      },
      destroy() {
        disposed = true;
        drafts.clear();
        page.remove();
      }
    };
  }

  const api = Object.freeze({mount});
  globalThis.CleanRoomsWorkspaceBudgets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
