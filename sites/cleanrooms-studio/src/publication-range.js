/* Whole-week publication ranges, shared by the dialog and its review summary. */
(() => {
  'use strict';
  const DAY=86400000,MAX_WEEKS=52,DEFAULT_MIN='2000-01-01',DEFAULT_MAX='2100-12-31';
  const dateRangeFormat = new Intl.DateTimeFormat('da-DK', {
    day:'numeric', month:'long', year:'numeric', timeZone:'UTC'
  });
  const date=value=>new Date(value+'T12:00:00Z');
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date(value).getTime())&&date(value).toISOString().slice(0,10)===value;
  const addDays=(value,days)=>{if(!validDate(value)||!Number.isSafeInteger(days))throw new TypeError('Datoen er ugyldig.');const result=date(value);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10);};
  const monday=value=>addDays(value,-((date(value).getUTCDay()+6)%7));
  function normalize({from,to=from,minDate=DEFAULT_MIN,maxDate=DEFAULT_MAX}={}) {
    if(!validDate(from)||!validDate(to))throw new TypeError('Vælg en gyldig start- og slutuge.');
    if(!validDate(minDate)||!validDate(maxDate)||minDate>maxDate)throw new TypeError('Kalenderens datogrænser er ugyldige.');
    const start=monday(from),end=addDays(monday(to),6);
    if(start>end)throw new TypeError('Slutugen skal ligge efter eller i startugen.');
    if((date(end)-date(start))/DAY>=MAX_WEEKS*7)throw new TypeError('Vælg højst 52 uger ad gangen.');
    if(start<minDate||end>maxDate)throw new TypeError('Hele perioden skal ligge inden for kalenderen.');
    return {from:start,to:end};
  }
  const countWeeks=(from,to)=>{const range=normalize({from,to});return Math.round((date(range.to)-date(range.from))/DAY+1)/7;};
  function weekNumber(value) {
    if(!validDate(value))throw new TypeError('Datoen er ugyldig.');
    const thursday=date(value);thursday.setUTCDate(thursday.getUTCDate()+3-((thursday.getUTCDay()+6)%7));
    const year=thursday.getUTCFullYear(),first=new Date(Date.UTC(year,0,4,12));first.setUTCDate(first.getUTCDate()+3-((first.getUTCDay()+6)%7));
    return {week:1+Math.round((thursday-first)/DAY/7),year};
  }
  function summary(scope) {
    const range=normalize(scope),weeks=countWeeks(range.from,range.to),sameYear=range.from.slice(0,4)===range.to.slice(0,4);
    const format=(value,year)=>date(value).toLocaleDateString('da-DK',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});
    return weeks+(weeks===1?' uge':' uger')+' · '+format(range.from,!sameYear)+' – '+format(range.to,true);
  }
  function overview(studio,scope,selectedWeeks){
    const range=normalize(scope),Publication=globalThis.CleanRoomsPublication||(typeof require==='function'?require('./publication-model.js'):null);
    if(!Publication)throw new TypeError('Udgivelsesmodellen mangler.');
    const scopes=selectedWeeks??Array.from({length:countWeeks(range.from,range.to)},(_,index)=>{
      const from=addDays(range.from,index*7);
      return {from,to:addDays(from,6),siteIds:scope.siteIds};
    });
    const comparisons=Publication.compareWeeks(studio,scopes);
    return scopes.map(({from,to},index)=>{
      const status=comparisons[index],counts={added:0,changed:0,removed:0};
      for(const change of status.changes)counts[change.type]++;
      return {from,to,...weekNumber(from),shiftCount:status.count,...counts,openCount:status.openCount,published:status.published,hasPublished:status.hasPublished,locationChanges:status.locationChanges};
    });
  }

  function mount({element,onChange=()=>{},onValidityChange=()=>{}}={}) {
    if(!element?.ownerDocument)throw new TypeError('Udgivelsesperioden kræver et indholdsfelt.');
    const doc = element.ownerDocument;
    const node = (tag, className, text) => {
      const el = doc.createElement(tag);
      if(className)el.className = className;
      if(text !== undefined)el.textContent = text;
      return el;
    };
    const option = (value, label) => {
      const el = node('option', '', label);
      el.value = String(value);
      return el;
    };
    const select = (name, label) => {
      const el = node('select', 'cs-publication-range-input');
      el.dataset.publicationRange = name;
      el.setAttribute('aria-label', label);
      return el;
    };

    const root = node('section', 'cs-publication-range');
    root.setAttribute('aria-label', 'Periode');
    const heading = node('h4', 'cs-publication-range-title', 'Periode');
    const fields = node('div', 'cs-publication-range-fields');
    const week = select('week', 'Startuge');
    const duration = select('duration', 'Antal uger');
    const year = select('year', 'År for startuge');
    const yearField = node('label', 'cs-publication-range-year');
    yearField.append(node('span', '', 'År'), year);
    yearField.hidden = true;
    const status = node('p', 'cs-publication-range-summary');
    status.setAttribute('aria-live', 'polite');
    const error = node('p', 'cs-publication-range-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    fields.append(week, duration);
    root.append(heading, fields, status, yearField, error);
    element.replaceChildren(root);

    const durations = Array.from({length:MAX_WEEKS}, (_, index) => {
      const count = index + 1;
      return option(count, count === 1 ? '1 uge' : count + ' uger');
    });
    duration.append(...durations);
    let options = {minDate:DEFAULT_MIN, maxDate:DEFAULT_MAX, disabled:false};
    let value = null, draftFrom = '', draftCount = 1, valid = true, disposed = false;
    let menuYear, firstWeek, lastWeek, firstYear, lastYear;
    let choosingYear = false, awaitingWeek = false, renderError = false, weekMenuKey, yearMenuKey;

    function validity(next,message='') {
      const changed = valid !== next || error.textContent !== message;
      valid = next;
      error.textContent = message;
      error.hidden = next;
      if(changed)onValidityChange({valid:next,message});
    }

    function updateBounds() {
      firstWeek = lastWeek = firstYear = lastYear = undefined;
      if(!validDate(options.minDate) || !validDate(options.maxDate) || options.minDate > options.maxDate) {
        throw new TypeError('Kalenderens datogrænser er ugyldige.');
      }
      const first = monday(options.minDate);
      const last = monday(options.maxDate);
      firstWeek = first < options.minDate ? addDays(first, 7) : first;
      lastWeek = addDays(last, 6) > options.maxDate ? addDays(last, -7) : last;
      if(firstWeek > lastWeek)throw new TypeError('Kalenderen indeholder ingen hele uger.');
      firstYear = weekNumber(firstWeek).year;
      lastYear = weekNumber(lastWeek).year;
    }

    function weeksAvailable(from) {
      if(!validDate(from) || !firstWeek || from < firstWeek || from > lastWeek || monday(from) !== from)return 0;
      return Math.min(MAX_WEEKS, Math.floor((date(lastWeek) - date(from)) / (7 * DAY)) + 1);
    }

    function renderWeekMenu() {
      const key = JSON.stringify([menuYear, firstWeek, lastWeek]);
      if(key === weekMenuKey)return;
      weekMenuKey = key;
      const placeholder = option('', 'Vælg uge');
      placeholder.disabled = true;
      const groups = [placeholder];
      for(let candidate = Math.max(firstYear, menuYear - 1); candidate <= Math.min(lastYear, menuYear + 1); candidate++) {
        const group = node('optgroup');
        group.label = String(candidate);
        const yearStart = monday(String(candidate).padStart(4, '0') + '-01-04');
        let start = yearStart < firstWeek ? firstWeek : yearStart;
        while(start <= lastWeek && weekNumber(start).year === candidate) {
          group.append(option(start, 'Uge ' + weekNumber(start).week));
          start = addDays(start, 7);
        }
        groups.push(group);
      }
      if(firstYear < menuYear - 1 || lastYear > menuYear + 1)groups.push(option('other-year', 'Vælg andet år…'));
      week.replaceChildren(...groups);
    }

    function renderYearMenu() {
      const key = JSON.stringify([firstYear, lastYear]);
      if(key === yearMenuKey)return;
      yearMenuKey = key;
      const placeholder = option('', 'Vælg år');
      placeholder.disabled = true;
      const choices = [placeholder];
      for(let candidate = firstYear; candidate <= lastYear; candidate++)choices.push(option(candidate, candidate));
      year.replaceChildren(...choices);
    }

    function sync() {
      if(disposed)return;
      renderWeekMenu();
      const available = weeksAvailable(draftFrom);
      durations.forEach((item, index) => { item.disabled = Boolean(available) && index >= available; });
      week.value = draftFrom;
      duration.value = draftCount ? String(draftCount) : '';
      week.disabled = duration.disabled = year.disabled = options.disabled === true || firstYear === undefined;
      week.setAttribute('aria-invalid', String(!valid && !available));
      duration.setAttribute('aria-invalid', String(!valid && Boolean(available)));
      yearField.hidden = !choosingYear;
      if(choosingYear) {
        renderYearMenu();
        year.value = awaitingWeek ? String(menuYear) : '';
      }
      status.hidden = !valid || !value;
      const text = status.hidden ? '' : dateRangeFormat.formatRange(date(value.from), date(value.to));
      if(status.textContent !== text)status.textContent = text;
    }

    function commit(source) {
      const available = weeksAvailable(draftFrom);
      if(!available) {
        validity(false, awaitingWeek ? 'Vælg en uge i ' + menuYear + '.' : 'Vælg en startuge.');
      } else if(!Number.isInteger(draftCount) || draftCount < 1 || draftCount > MAX_WEEKS) {
        validity(false, 'Vælg antal uger.');
      } else if(draftCount > available) {
        validity(false, 'Vælg færre uger for at holde perioden inden for kalenderen.');
      } else {
        const next = {from:draftFrom, to:addDays(draftFrom, draftCount * 7 - 1)};
        const changed = !value || value.from !== next.from || value.to !== next.to;
        value = next;
        validity(true);
        sync();
        if(changed && !disposed)onChange({...value}, {source});
        return;
      }
      sync();
    }

    week.addEventListener('change', () => {
      if(disposed || options.disabled)return;
      if(week.value === 'other-year') {
        choosingYear = true;
        sync();
        year.focus?.({preventScroll:true});
        return;
      }
      draftFrom = week.value;
      if(weeksAvailable(draftFrom)) {
        menuYear = weekNumber(draftFrom).year;
        choosingYear = awaitingWeek = false;
      }
      commit('week');
    });
    duration.addEventListener('change', () => {
      if(disposed || options.disabled)return;
      draftCount = Number(duration.value);
      commit('duration');
    });
    year.addEventListener('change', () => {
      if(disposed || options.disabled || !choosingYear)return;
      const selected = Number(year.value);
      if(!Number.isInteger(selected) || selected < firstYear || selected > lastYear)return;
      menuYear = selected;
      draftFrom = '';
      awaitingWeek = true;
      commit('year');
      week.focus?.({preventScroll:true});
    });

    function render(next={}) {
      if(disposed)return;
      options = {...options, ...next};
      try {
        updateBounds();
        const from = next.from ?? value?.from ?? monday(new Date().toISOString().slice(0, 10));
        const to = next.to ?? value?.to ?? from;
        const range = normalize({...options, from, to});
        const changed = !value || value.from !== range.from || value.to !== range.to;
        if(changed || renderError) {
          value = range;
          draftFrom = range.from;
          draftCount = countWeeks(range.from, range.to);
          menuYear = weekNumber(range.from).year;
          choosingYear = awaitingWeek = false;
          validity(true);
        }
        renderError = false;
      } catch(problem) {
        menuYear ??= firstYear;
        renderError = true;
        validity(false, problem.message);
      }
      sync();
    }
    return {render,dispose(){disposed=true;element.replaceChildren();},get value(){return value?{...value}:null;},get valid(){return valid;}};
  }
  const api=Object.freeze({MAX_WEEKS,validDate,addDays,normalize,countWeeks,weekNumber,summary,overview,mount});
  globalThis.CleanRoomsPublicationRange=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
