/* Continuous calendar presentation. Mutations remain in the application. */
(() => {
  'use strict';

  const DAY = 86400000;
  const TRANSFER_TYPE = 'application/x-cleanrooms-shift';
  const WEEKDAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  const AVATAR_COLORS = ['#e7e9f7', '#e6efe8', '#f4e8df', '#ece5f2', '#e1edf3', '#f3e5e9'];
  let instanceNumber = 0;
  let suppressNativeClickUntil = 0;
  let activeDragCleanup = null;
  let activeViewportCleanup = null;
  let selectionAnchor = null;
  const expandedDays = new Set();

  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const result = new Date(value + 'T12:00:00Z');
    return Number.isFinite(result.getTime()) && result.toISOString().slice(0, 10) === value ? result : null;
  }

  function addDays(value, count) {
    const result = parseDate(value);
    result.setUTCDate(result.getUTCDate() + count);
    return result.toISOString().slice(0, 10);
  }

  function fullDate(value) {
    return parseDate(value).toLocaleDateString('da-DK', {weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  }

  function shortDate(value) {
    return parseDate(value).toLocaleDateString('da-DK', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  }

  function isoWeek(value) {
    const thursday = parseDate(value);
    thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
    const first = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1, 12));
    return Math.ceil(((thursday - first) / DAY + 1) / 7);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function seriesMarker() {
    const marker = node('span', 'cs-series-indicator', '↻');
    marker.setAttribute('aria-label', 'Del af en vagtserie');
    marker.title = 'Del af en vagtserie';
    return marker;
  }

  function descriptionMarker() {
    const marker = node('span','cs-description-indicator'); marker.setAttribute('aria-hidden','true'); marker.title = 'Har beskrivelse';
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns,'svg'), path = document.createElementNS(ns,'path');
    Object.entries({viewBox:'0 0 24 24',width:12,height:12,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round',focusable:'false','aria-hidden':'true'}).forEach(([name,value]) => svg.setAttribute(name,String(value)));
    path.setAttribute('d','M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h6');
    svg.append(path); marker.append(svg); return marker;
  }

  function avatarColor(personId) {
    let index = 0;
    for (const character of String(personId)) index = (index * 31 + character.codePointAt(0)) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
  }

  function render(options = {}) {
    if (activeDragCleanup) activeDragCleanup();
    if (activeViewportCleanup) activeViewportCleanup();
    const first = parseDate(options.from);
    if (!first || first.getUTCDay() !== 1) throw new TypeError('Kalenderens startdato skal være en gyldig mandag.');
    const weeks = Math.max(1, Math.min(8, Math.floor(Number(options.weeks) || 8)));
    const zoom = [1, 2, 4].includes(Number(options.zoom)) ? Number(options.zoom) : 1;
    const maximum = 12;
    const lastDate = addDays(options.from, weeks * 7 - 1);
    function stateFor(day){if(typeof options.weekState!=='function')return {loaded:true,loading:false};const date=parseDate(day);if(!date)return {loaded:false,loading:false};date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));try{return options.weekState(date.toISOString().slice(0,10))||{loaded:false,loading:false};}catch{return {loaded:false,loading:false,error:'Ugen kunne ikke indlæses.'};}}
    const weekLoaded=day=>stateFor(day).loaded===true;
    let shifts=[],byId=new Map(),byDay=new Map(),issues=new Map(),sites=[],selectionMode=false,canSelect=false,selectedIds=new Set(),changedIds=new Set(),canMove=false,shown=[];
    const nameFor = shift => shift.person ? String(options.personName?.(shift.person) || 'Medarbejder') : 'Ledig vagt';
    const siteFor = shift => sites[Number(shift.site)] || {name:'Ukendt arbejdssted',color:'currentColor'};
    const viewport=globalThis.CleanRoomsCalendarViewport,viewportKey=String(options.viewportKey||options.from+'|'+zoom);
    let disposed=false,viewportObserver=null;
    let draggedId = null;
    let lastPreviewKey = null, lastPreview = null, removeDragWatchers = null;

    function derive(){
      shifts=(Array.isArray(options.shifts)?options.shifts:[]).filter(shift=>shift&&parseDate(shift.date)&&shift.date>=options.from&&shift.date<=lastDate&&weekLoaded(shift.date));
      byId=new Map(shifts.map(shift=>[String(shift.id),shift]));byDay=new Map();issues=new Map();sites=Array.isArray(options.sites)?options.sites:[];selectionMode=options.selectionMode===true;canSelect=typeof options.onSelect==='function';selectedIds=new Set(Array.from(options.selectedIds||[],String));changedIds=new Set(Array.from(options.changedIds||[],String));canMove=typeof options.onMove==='function'&&!selectionMode;
      if(selectionAnchor!==null&&!byId.has(selectionAnchor))selectionAnchor=null;
      shifts.forEach(shift=>{const items=byDay.get(shift.date)||[];items.push(shift);byDay.set(shift.date,items);});
      byDay.forEach(items=>items.sort((a,b)=>String(a.start).localeCompare(String(b.start))||String(a.end).localeCompare(String(b.end))||nameFor(a).localeCompare(nameFor(b),'da-DK')||String(a.id).localeCompare(String(b.id))));
      shown=[];for(let index=0;index<weeks*7;index++){const day=addDays(options.from,index),items=byDay.get(day)||[];shown.push(...items.slice(0,expandedDays.has(day)?items.length:maximum));}
    }
    derive();

    const element = node('div', 'cs-board-scroll');
    const available=(day,control)=>!disposed&&element.isConnected&&(!control||control.isConnected&&element.contains(control))&&weekLoaded(day);
    const currentShift=(id,control)=>{const shift=byId.get(String(id));return shift&&available(shift.date,control)?shift:null;};
    element.dataset.zoom = String(zoom);
    element.dataset.from = options.from;
    element.dataset.selectionMode = String(selectionMode);
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', 'Vagtplan fra ' + shortDate(options.from) + ' til ' + shortDate(lastDate));
    element.tabIndex = 0;
    element.addEventListener('click', event => {
      if (Date.now() < suppressNativeClickUntil && event.detail !== 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    const helpId = 'cs-calendar-move-help-' + (++instanceNumber);
    const help = node('span', 'cs-sr', 'Flyt vagten med Alt og piletaster: venstre eller højre flytter én dag, op eller ned flytter én uge.');
    help.id = helpId;
    element.append(help);
    const dragStatus = node('div', 'cs-drag-status');
    dragStatus.hidden = true;
    dragStatus.setAttribute('role', 'status');
    dragStatus.setAttribute('aria-live', 'polite');
    dragStatus.setAttribute('aria-atomic', 'true');
    const dragName = node('span', 'cs-drag-name');
    const dragTarget = node('span', 'cs-drag-target');
    const dragReason = node('span', 'cs-drag-reason');
    dragStatus.append(dragName, dragTarget, dragReason);

    function clearDragFeedback() {
      element.querySelectorAll('.is-dragging, .is-drop-target, .is-drop-invalid, .is-drop-same').forEach(item => {
        item.classList.remove('is-dragging', 'is-drop-target', 'is-drop-invalid', 'is-drop-same');
        item.removeAttribute('data-dragging');
      });
      dragStatus.hidden = true;
      dragStatus.removeAttribute('data-state');
      dragName.textContent = dragTarget.textContent = dragReason.textContent = '';
      dragStatus.remove();
      lastPreviewKey = null; lastPreview = null;
    }

    function clearDragState() {
      if (draggedId !== null) suppressNativeClickUntil = Date.now() + 400;
      draggedId = null;
      clearDragFeedback();
      if (removeDragWatchers) { const remove = removeDragWatchers; removeDragWatchers = null; remove(); }
      if (activeDragCleanup === finishDrag) activeDragCleanup = null;
    }

    function finishDrag() { suppressNativeClickUntil = Date.now() + 400; clearDragState(); }

    function watchDrag() {
      const cancel = event => { if (event.key === 'Escape') finishDrag(); };
      document.addEventListener('dragend', finishDrag, true);
      document.addEventListener('keydown', cancel, true);
      const observer = typeof MutationObserver === 'function' && element.parentNode ? new MutationObserver(() => { if (!element.isConnected) finishDrag(); }) : null;
      if (observer) observer.observe(element.parentNode, {childList:true});
      removeDragWatchers = () => {
        document.removeEventListener('dragend', finishDrag, true);
        document.removeEventListener('keydown', cancel, true);
        observer?.disconnect();
      };
      activeDragCleanup = finishDrag;
    }

    function draggedShift(event) {
      let id = draggedId;
      if (!id) { try { id = event.dataTransfer?.getData(TRANSFER_TYPE); } catch {} }
      return id ? byId.get(String(id)) : null;
    }

    function previewMove(shift, day, force = false) {
      if(!available(shift.date)||!weekLoaded(day))return {allowed:false,status:'blocked',reason:'Indlæs ugen, før du flytter vagten hertil.'};
      const key = String(shift.id) + '|' + day;
      if (!force && key === lastPreviewKey) return lastPreview;
      let result;
      try { result = options.onMovePreview?.(shift, day); }
      catch { result = {allowed:false,status:'blocked',reason:'Flytningen kunne ikke kontrolleres.'}; }
      if (day === shift.date || result?.status === 'same') result = {allowed:false,status:'same',reason:result?.reason || 'Vagten ligger allerede på denne dag.'};
      else if (result && (result.allowed !== true || result.status === 'blocked')) result = {allowed:false,status:'blocked',reason:result.reason || 'Vagten kan ikke flyttes til denne dag.'};
      else result = {allowed:true,status:'allowed',reason:result?.reason || 'Slip for at flytte vagten.'};
      lastPreviewKey = key; lastPreview = result;
      return result;
    }

    function showPreview(shift, day, cell, event, force = false) {
      const result = previewMove(shift, day, force);
      if (!dragStatus.isConnected) (element.closest('#cleanrooms-studio') || element.parentElement || element).append(dragStatus);
      element.querySelectorAll('.is-drop-target, .is-drop-invalid, .is-drop-same').forEach(item => item.classList.remove('is-drop-target', 'is-drop-invalid', 'is-drop-same'));
      cell.classList.add(result.status === 'allowed' ? 'is-drop-target' : result.status === 'same' ? 'is-drop-same' : 'is-drop-invalid');
      dragStatus.dataset.state = result.status;
      dragName.textContent = nameFor(shift) + ' · ' + shift.start + ' – ' + shift.end;
      dragTarget.textContent = 'Til ' + fullDate(day);
      dragReason.textContent = result.reason;
      dragStatus.hidden = false;
      if (event.dataTransfer && event.type !== 'dragstart') event.dataTransfer.dropEffect = result.allowed ? 'move' : 'none';
      return result;
    }

    function acceptsDrag(event) {
      return !disposed&&element.isConnected&&canMove && (draggedId !== null || Array.from(event.dataTransfer?.types || []).includes(TRANSFER_TYPE));
    }

    element.addEventListener('dragleave', event => {
      if (!draggedId || (event.relatedTarget && element.contains(event.relatedTarget))) return;
      const bounds = element.getBoundingClientRect();
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return;
      clearDragFeedback();
    });

    function issueFor(shift){const id=String(shift.id);if(!issues.has(id))issues.set(id,typeof options.issueFor==='function'?options.issueFor(shift):null);return issues.get(id);}
    function eventCard(shift) {
      const selected = selectedIds.has(String(shift.id)), changed = changedIds.has(String(shift.id));
      const issue = issueFor(shift);
      const button = node('button', 'cs-event' + (!shift.person ? ' is-open' : '') + (selected ? ' is-multi-selected' : '') + (changed ? ' is-changed' : '') + (issue ? ' has-issue' : ''));
      const name = nameFor(shift), site = siteFor(shift);
      const description = name + ', ' + fullDate(shift.date) + ', ' + shift.start + ' – ' + shift.end + ', ' + site.name + (shift.plannedBreakMinutes?'. Planlagt pause '+shift.plannedBreakMinutes+' minutter':'') + ((shift.note || shift.noteRich || shift._instructions?.hasDescription) ? '. Har beskrivelse' : '') + (changed ? '. Ændret siden seneste udgivelse' : '') + (issue ? '. ' + issue.label + (issue.detail ? ' · ' + issue.detail : '') : '');
      button.type = 'button';
      button.id = 'cs-calendar-event-' + encodeURIComponent(String(shift.id));
      button.dataset.shift = String(shift.id);
      button.dataset.multiSelected = String(selected);
      button.dataset.changed = String(changed);
      if (issue) button.dataset.issue = String(issue.kind);
      if (selectionMode || selected) button.setAttribute('aria-pressed', String(selected));
      button.style.setProperty('--cs-shift-color', site.color || 'currentColor');
      button.setAttribute('aria-label', description);
      button.title = description;
      button.dataset.tooltip = description;
      button.draggable = canMove;
      if (canMove) button.setAttribute('aria-describedby', helpId);
      const meta = node('span', 'cs-event-meta');
      const dot = node('span', 'cs-event-site-dot'); dot.setAttribute('aria-hidden', 'true');
      meta.append(dot, node('span', 'cs-event-site', site.name));
      if (shift.note || shift.noteRich || shift._instructions?.hasDescription) meta.append(descriptionMarker());
      const person = node('span', 'cs-event-person');
      const initials = shift.person ? name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('') : '+';
      const avatar = node('span', 'cs-event-avatar', initials); avatar.setAttribute('aria-hidden', 'true');
      avatar.style.setProperty('--cs-avatar-color', shift.person ? avatarColor(shift.person) : '#f0f1f3');
      const copy = node('span', 'cs-event-copy'); copy.append(node('span', 'cs-event-name', name), meta);
      if (issue) {
        const warning = node('span', 'cs-event-issue', issue.label);
        warning.setAttribute('aria-hidden', 'true'); copy.append(warning);
      }
      person.append(avatar, copy);
      if (canSelect || selectionMode) {
        const mark = node('span', 'cs-event-select-mark', selected ? '✓' : '');
        mark.setAttribute('aria-hidden', 'true'); button.append(mark);
      }
      button.append(person);
      if (shift.seriesId) button.append(seriesMarker());
      if (changed) {
        const mark = node('span', 'cs-event-change-mark');
        mark.setAttribute('aria-hidden', 'true'); mark.title = 'Ændret siden seneste udgivelse'; button.append(mark);
      }
      button.addEventListener('click', event => {
        event.stopPropagation();
        const current=currentShift(shift.id,button);if(!current){event.preventDefault();return;}shift=current;
        if (selectionMode || (canSelect && (event.ctrlKey || event.metaKey || event.shiftKey))) {
          event.preventDefault();
          if (!canSelect) return;
          const ids = shown.map(item => String(item.id));
          const anchorIndex = ids.indexOf(selectionAnchor), targetIndex = ids.indexOf(String(shift.id));
          const rangeIds = event.shiftKey && anchorIndex >= 0 && targetIndex >= 0 ? ids.slice(Math.min(anchorIndex,targetIndex),Math.max(anchorIndex,targetIndex) + 1) : [];
          if (!event.shiftKey || anchorIndex < 0) selectionAnchor = String(shift.id);
          options.onSelect(shift, {rangeIds,additive:Boolean(event.ctrlKey || event.metaKey)}, button);
          return;
        }
        options.onOpen?.(shift, button);
      });
      if (selectionMode) button.addEventListener('keydown', event => {
        if (event.altKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
      });
      if (canMove) {
        button.addEventListener('keydown', event => {
          const offset = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
          if (!event.altKey || event.ctrlKey || event.metaKey || offset === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          const current=currentShift(shift.id,button);if(!current)return;shift=current;
          if (!event.repeat) {
            const refocus = moved => {
              if (moved !== true) return;
              const fresh = [...document.querySelectorAll('[data-shift]')].find(item => item.dataset.shift === String(shift.id));
              fresh?.focus({preventScroll:true});
              fresh?.scrollIntoView({block:'nearest',inline:'nearest'});
            };
            const targetDate = addDays(shift.date, offset);
            if(!weekLoaded(targetDate)){options.onMoveRejected?.('Indlæs ugen, før du flytter vagten hertil.');return;}
            expandedDays.add(targetDate);
            const moved = options.onMove(shift, targetDate);
            if (moved && typeof moved.then === 'function') moved.then(refocus, () => {});
            else refocus(moved);
          }
        });
        button.addEventListener('dragstart', event => {
          const current=currentShift(shift.id,button);if(!current){event.preventDefault();return;}shift=current;
          if (!event.dataTransfer) { event.preventDefault(); return; }
          if (removeDragWatchers) finishDrag();
          draggedId = String(shift.id);
          suppressNativeClickUntil = Date.now() + 60000;
          button.classList.add('is-dragging');
          button.dataset.dragging = 'true';
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(TRANSFER_TYPE, draggedId);
          event.dataTransfer.setData('text/plain', draggedId);
          event.stopPropagation();
          watchDrag();
          const source = [...element.querySelectorAll('.cs-board-day')].find(day => day.dataset.date === shift.date);
          if (source) showPreview(shift, shift.date, source, event);
        });
        button.addEventListener('dragend', finishDrag);
      }
      return button;
    }

    function weekHours(day) {
      const value=options.weekHours?.(day);
      return value&&Number.isFinite(value.plannedMinutes)?value:null;
    }
    function weekCost(day) {
      const value=options.weekCost?.(day);
      if(!value||!['ready','loading','saving','error'].includes(value.state))return null;
      return {state:value.state,totalCents:Number.isSafeInteger(value.totalCents)&&value.totalCents>=0?value.totalCents:null,
        shiftCount:value.shiftCount||0,missingShiftCount:value.missingShiftCount||0,openShiftCount:value.openShiftCount||0,
        monthlyPersonCount:value.monthlyPersonCount||0,fixedSupplementPersonCount:value.fixedSupplementPersonCount||0,overlapShiftCount:value.overlapShiftCount||0,complete:value.complete!==false};
    }
    function buildWeekHeading(weekDate,weekState) {
      const loaded=weekState.loaded===true,weekLast=addDays(weekDate,6);
      const weekCount=shifts.filter(shift=>shift.date>=weekDate&&shift.date<=weekLast).length;
      const heading=node('div','cs-board-week-label'),identity=node('div','cs-week-identity'),metrics=node('div','cs-week-metrics');
      const title=node('div','cs-week-title-row');
      title.append(node('h3',null,'Uge '+isoWeek(weekDate)));
      const hours=loaded?weekHours(weekDate):null;
      if(hours){
        const format=value=>value.toLocaleString('da-DK',{maximumFractionDigits:2});
        const amount=node('span','cs-week-planned-hours');
        const maximum=Number.isFinite(hours.budgetHours)?hours.budgetHours:null;
        amount.dataset.over=String(maximum!==null&&hours.plannedMinutes*100>Math.round(maximum*100)*60);
        amount.append(node('strong',null,format(hours.plannedMinutes/60)));
        if(maximum!==null){
          const separator=node('span','cs-week-hours-separator',' / ');
          separator.setAttribute('aria-hidden','true');
          amount.append(separator,node('span','cs-week-hours-limit',format(maximum)));
        }
        amount.append(node('span','cs-week-hours-unit',' timer'));
        const scope=hours.scopeLabel||'Hele virksomheden';
        amount.setAttribute('aria-label',format(hours.plannedMinutes/60)+(maximum!==null?' af '+format(maximum):'')+' timer planlagt · '+scope);
        amount.title=scope+' · Inkl. ledige vagter, fratrukket ulønnede pauser'+(maximum!==null?' · Ugebudget for det valgte område':'');
        metrics.append(amount);
      }
      const cost=loaded?weekCost(weekDate):null;
      if(cost&&typeof options.onOpenWeekCost==='function'){
        const available=cost.state==='ready'&&cost.totalCents!==null;
        const incomplete=!cost.complete||cost.missingShiftCount>0||cost.openShiftCount>0||cost.monthlyPersonCount>0||cost.fixedSupplementPersonCount>0||cost.overlapShiftCount>0;
        const allUnknown=available&&cost.totalCents===0&&cost.shiftCount>0&&cost.missingShiftCount+cost.openShiftCount===cost.shiftCount;
        const label=allUnknown?'Mangler lønsatser':available?(cost.totalCents/100).toLocaleString('da-DK',{maximumFractionDigits:0})+' kr.':cost.state==='error'?'Løn · prøv igen':cost.state==='saving'?'Løn opdateres…':'Løn…';
        const control=node('button','cs-week-planned-cost',label);
        control.type='button';control.dataset.state=cost.state;control.setAttribute('aria-haspopup','dialog');
        control.title=available?'Estimeret vagtløn'+(incomplete?' · Se afgrænsning og manglende satser':' · Se grundløn og tillæg'):'Estimeret vagtløn · '+(cost.state==='error'?'Kunne ikke beregnes':'Opdateres');
        control.setAttribute('aria-label','Estimeret vagtløn for uge '+isoWeek(weekDate)+': '+label+(available&&incomplete?' · Delvist estimat':''));
        if(available&&incomplete&&!allUnknown){const marker=node('span','cs-week-cost-incomplete','*');marker.setAttribute('aria-hidden','true');control.append(marker);}
        control.addEventListener('click',()=>{
          if(!disposed&&control.isConnected&&element.isConnected&&stateFor(weekDate).loaded===true&&weekCost(weekDate))options.onOpenWeekCost?.(weekDate,control);
        });
        metrics.append(control);
      }
      identity.append(title,node('span','cs-board-week-range',shortDate(weekDate)+' – '+shortDate(weekLast)));
      const summary=node('span','cs-board-week-summary',loaded?weekCount+(weekCount===1?' vagt':' vagter'):weekState.error?'Kunne ikke indlæses':weekState.loading?'Indlæser…':'Ikke indlæst');
      if(!loaded&&weekState.error&&typeof options.onWeekRetry==='function'){
        const retry=node('button','cs-calendar-week-retry','Prøv igen');
        retry.type='button';
        retry.setAttribute('aria-label','Indlæs uge '+isoWeek(weekDate)+' igen');
        retry.addEventListener('click',()=>{
          const current=stateFor(weekDate);
          if(!disposed&&retry.isConnected&&element.isConnected&&!current.loaded&&!current.loading&&current.error)options.onWeekRetry(weekDate);
        });
        const status=node('span','cs-board-week-state');
        status.append(summary,retry);metrics.append(status);
      }else metrics.append(summary);
      heading.append(identity,metrics);
      return heading;
    }

    function buildWeek(week) {
      const weekDate = addDays(options.from, week * 7);
      const section = node('section', 'cs-board-week');
      section.dataset.week = String(isoWeek(weekDate));
      section.dataset.start = weekDate;
      const weekLast = addDays(weekDate, 6);
      const weekState=stateFor(weekDate),loaded=weekState.loaded===true;
      section.dataset.loaded=String(loaded);section.setAttribute('aria-busy',String(!loaded&&weekState.loading===true));
      if(!loaded)section.classList.add('is-unloaded');const height=viewport?.heightFor(viewportKey,weekDate);if(height){section.style.minHeight=height+'px';section.style.boxSizing='border-box';}
      const heading=buildWeekHeading(weekDate,weekState);
      section.setAttribute('aria-label', 'Uge ' + isoWeek(weekDate) + ', ' + shortDate(weekDate) + ' til ' + shortDate(weekLast));
      section.append(heading);
      const days = node('div', 'cs-board-days');
      for (let index = 0; index < 7; index += 1) {
        const day = addDays(weekDate, index), items = byDay.get(day) || [];
        const cell = node('div', 'cs-board-day' + (day === options.today ? ' is-today' : '') + (day === options.selectedDate ? ' is-selected' : '') + (index > 4 ? ' is-weekend' : ''));
        cell.dataset.date = day;
        cell.setAttribute('aria-label', fullDate(day));
        const dayHead = node('div', 'cs-board-day-head');
        const calendarDate = parseDate(day);
        const dateText = String(calendarDate.getUTCDate());
        const dateButton = node(loaded?'button':'div', 'cs-board-date');
        dateButton.append(node('span', 'cs-board-day-name', WEEKDAYS[index]), node('span', 'cs-board-day-number', dateText), node('span', 'cs-board-day-month', calendarDate.toLocaleDateString('da-DK', {month:'short',timeZone:'UTC'})));
        dateButton.type = 'button';
        dateButton.setAttribute('aria-label', 'Vis vagter ' + fullDate(day));
        if (day === options.today) dateButton.setAttribute('aria-current', 'date');
        if(loaded)dateButton.addEventListener('click', () => {if(available(day,dateButton))options.onDay?.(day);});
        dayHead.append(dateButton, node('span', 'cs-board-count', loaded?items.length+(items.length===1?' vagt':' vagter'):'—'));
        cell.append(dayHead);
        const events = node('div', 'cs-board-events');
        if(!loaded){const placeholder=node('div','cs-board-placeholder');placeholder.setAttribute('aria-hidden','true');placeholder.append(node('span'),node('span'),node('span'));events.append(placeholder);cell.append(events);days.append(cell);continue;}
        const expanded = expandedDays.has(day);
        const timeGroups = new Map();
        items.slice(0, expanded ? items.length : maximum).forEach(shift => {
          const key = String(shift.start) + '|' + String(shift.end);
          if (!timeGroups.has(key)) timeGroups.set(key, {start:shift.start,end:shift.end,shifts:[]});
          timeGroups.get(key).shifts.push(shift);
        });
        let groupIndex = 0;
        timeGroups.forEach(timeGroup => {
          const group = node('div', 'cs-time-group');
          const fullGroup = items.filter(shift => shift.start === timeGroup.start && shift.end === timeGroup.end);
          const canEditGroup = typeof options.onEditGroup === 'function';
          const header = node(canEditGroup ? 'button' : 'div', 'cs-time-group-header');
          header.id = helpId + '-time-' + day + '-' + groupIndex++;
          if (canEditGroup) {
            header.type = 'button';
            header.dataset.groupDate = day; header.dataset.groupStart = timeGroup.start; header.dataset.groupEnd = timeGroup.end;
            header.setAttribute('aria-haspopup', 'dialog'); header.setAttribute('aria-expanded', 'false');
            const label = 'Rediger tidsgruppe ' + timeGroup.start + ' – ' + timeGroup.end + ', ' + fullGroup.length + (fullGroup.length === 1 ? ' vagt, ' : ' vagter, ') + fullDate(day);
            header.setAttribute('aria-label', label); header.title = label;
            header.addEventListener('click', event => { event.stopPropagation();if(available(day,header)){const current=(byDay.get(day)||[]).filter(shift=>shift.start===timeGroup.start&&shift.end===timeGroup.end);if(current.length)options.onEditGroup?.({date:day,start:timeGroup.start,end:timeGroup.end,shifts:current},header);} });
          } else { header.setAttribute('role', 'heading'); header.setAttribute('aria-level', '4'); }
          header.append(node('span', 'cs-time-group-label', timeGroup.start + ' – ' + timeGroup.end));
          const groupCount = node('span', 'cs-time-group-count', String(fullGroup.length));
          groupCount.setAttribute('aria-label', fullGroup.length + (fullGroup.length === 1 ? ' vagt' : ' vagter') + ' i tidsgruppen');
          header.append(groupCount);
          group.setAttribute('role', 'group');
          group.setAttribute('aria-labelledby', header.id);
          const rows = node('div', 'cs-time-group-events');
          timeGroup.shifts.forEach(shift => rows.append(eventCard(shift)));
          group.append(header, rows);
          events.append(group);
        });
        if (items.length > maximum) {
          const more = node('button', 'cs-board-more', expanded ? 'Vis færre' : 'Vis alle ' + items.length + ' vagter');
          more.type = 'button';
          more.dataset.expandDate = day;
          more.setAttribute('aria-expanded', String(expanded));
          more.setAttribute('aria-label', (expanded ? 'Vis færre vagter ' : 'Vis alle ' + items.length + ' vagter ') + fullDate(day));
          more.addEventListener('click', () => {
            if(!available(day,more))return;
            const top = element.scrollTop, left = element.scrollLeft;
            const originalMoreTop = more.getBoundingClientRect().top;
            if (expanded) expandedDays.delete(day); else expandedDays.add(day);
            const restoreFocus = () => {
              const freshBoard = [...document.querySelectorAll('.cs-board-scroll')].find(board => board.dataset.from === options.from);
              if (!freshBoard) return;
              freshBoard.scrollTop = top; freshBoard.scrollLeft = left;
              const freshMore = [...freshBoard.querySelectorAll('.cs-board-more')].find(button => button.dataset.expandDate === day);
              if (expanded && freshMore) freshBoard.scrollTop += freshMore.getBoundingClientRect().top - originalMoreTop;
              const extra = !expanded ? [...freshBoard.querySelectorAll('[data-shift]')].find(button => button.dataset.shift === String(items[maximum].id)) : null;
              (extra || freshMore)?.focus({preventScroll:true});
            };
            if (typeof options.onExpand === 'function') {
              const result = options.onExpand(day, !expanded);
              if (result && typeof result.then === 'function') result.then(restoreFocus, () => {}); else restoreFocus();
            } else {
              update(options);restoreFocus();
            }
          });
          events.append(more);
        }
        cell.append(events);
        const footer = node('div', 'cs-board-day-footer');
        const add = node('button', 'cs-board-add', '+ Vagt');
        add.type = 'button';
        add.setAttribute('aria-label', 'Opret vagt ' + fullDate(day));
        add.addEventListener('click', () => {if(available(day,add))options.onCreate?.(day, add);});
        footer.append(add);
        const hours = items.filter(shift => shift.person).reduce((sum, shift) => {
          const [startHour, startMinute] = String(shift.start).split(':').map(Number);
          const [endHour, endMinute] = String(shift.end).split(':').map(Number);
          const duration = endHour + endMinute / 60 - startHour - startMinute / 60 - (shift.plannedBreakMinutes??0)/60;
          return sum + (Number.isFinite(duration) ? Math.max(0, duration) : 0);
        }, 0);
        footer.append(node('div', 'cs-board-hours', Number(hours.toFixed(2)).toLocaleString('da-DK') + ' timer'));
        cell.append(footer);
        if (canMove) {
          cell.addEventListener('dragover', event => {
            if (!cell.isConnected||!element.contains(cell)||!acceptsDrag(event)) return;
            const shift = draggedShift(event); if (!shift) return;
            event.preventDefault();
            showPreview(shift, day, cell, event);
          });
          cell.addEventListener('dragleave', event => {
            if (!event.relatedTarget || !cell.contains(event.relatedTarget)) cell.classList.remove('is-drop-target', 'is-drop-invalid', 'is-drop-same');
          });
          cell.addEventListener('drop', event => {
            if (!cell.isConnected||!element.contains(cell)||!acceptsDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            const shift = draggedShift(event);
            const preview = shift ? previewMove(shift, day, true) : null;
            finishDrag();
            if (preview?.allowed) options.onMove(shift, day);
            else if (preview?.status === 'blocked') options.onMoveRejected?.(preview.reason);
          });
        }
        days.append(cell);
      }
      section.append(days);
      return section;
    }
    const weekEntries=new Map();
    const same=(one,two)=>{if(one===two)return true;if(!one||!two||typeof one!=='object'||typeof two!=='object'||Array.isArray(one)!==Array.isArray(two))return false;const keys=Object.keys(one);return keys.length===Object.keys(two).length&&keys.every(key=>Object.hasOwn(two,key)&&same(one[key],two[key]));};
    const contextKey=value=>JSON.stringify([String(value.viewportKey||value.from+'|'+([1,2,4].includes(Number(value.zoom))?Number(value.zoom):1)),value.from,Math.max(1,Math.min(8,Math.floor(Number(value.weeks)||8))),[1,2,4].includes(Number(value.zoom))?Number(value.zoom):1]);
    const mountedKey=contextKey(options);
    function presentation(index){
      const date=addDays(options.from,index*7),state=stateFor(date),items=[],expansion=[];
      for(let offset=0;offset<7;offset++){const day=addDays(date,offset);expansion.push(expandedDays.has(day));items.push([day,expandedDays.has(day),(byDay.get(day)||[]).map(shift=>{const site=siteFor(shift);return [String(shift.id),shift.person,shift.site,shift.date,shift.start,shift.end,shift.plannedBreakMinutes,shift.seriesId,shift.note,shift.noteRich,shift._instructions?{token:shift._instructions.token,hasDescription:shift._instructions.hasDescription}:null,nameFor(shift),site.name,site.color,selectedIds.has(String(shift.id)),changedIds.has(String(shift.id)),issueFor(shift)?{...issueFor(shift)}:null];})]);}
      return {body:[state.loaded===true,options.today>=date&&options.today<=addDays(date,6)?options.today:null,options.selectedDate>=date&&options.selectedDate<=addDays(date,6)?options.selectedDate:null,selectionMode,canSelect,canMove,typeof options.onEditGroup==='function',items],expansion,status:[state.loaded===true,state.loaded!==true&&state.loading===true,state.loaded!==true?state.error||'':'',state.loaded!==true&&Boolean(state.error)&&typeof options.onWeekRetry==='function',state.loaded===true?weekHours(date):null,state.loaded===true?weekCost(date):null,typeof options.onOpenWeekCost==='function']};
    }
    for(let index=0;index<weeks;index++){const section=buildWeek(index);element.append(section);weekEntries.set(index,{section,model:presentation(index)});}
    function patchStatus(entry,index,model){
      const state=stateFor(addDays(options.from,index*7));entry.section.setAttribute('aria-busy',String(state.loaded!==true&&state.loading===true));
      // Loading/error text never needs to replace existing event or day nodes.
      const heading=buildWeekHeading(addDays(options.from,index*7),state),old=entry.section.querySelectorAll('.cs-board-week-label')[0];
      entry.section.replaceChild(heading,old);entry.model=model;
    }
    function update(nextOptions={}){
      if(disposed||contextKey(nextOptions)!==mountedKey)return false;
      const apply=()=>{
        options=nextOptions;derive();element.dataset.selectionMode=String(selectionMode);
        const models=Array.from({length:weeks},(_,index)=>presentation(index));
        if(models.some((model,index)=>!same(weekEntries.get(index).model.body,model.body)))clearDragState();
        else {lastPreviewKey=null;lastPreview=null;}
        for(let index=0;index<weeks;index++){
          const entry=weekEntries.get(index),model=models[index];if(same(entry.model,model))continue;
          if(same(entry.model.body,model.body)){patchStatus(entry,index,model);continue;}
          const height=entry.section.getBoundingClientRect().height||viewport?.heightFor(viewportKey,addDays(options.from,index*7)),section=buildWeek(index);
          if(same(entry.model.expansion,model.expansion)&&Number.isFinite(height)&&height>0){section.style.minHeight=height+'px';section.style.boxSizing='border-box';}else if(!same(entry.model.expansion,model.expansion))section.style.minHeight='';
          element.replaceChild(section,entry.section);weekEntries.set(index,{section,model});
        }
      };
      if(viewportObserver?.patch)viewportObserver.patch(apply);else apply();return true;
    }
    function dispose(){if(disposed)return;viewportObserver?.dispose();disposed=true;clearDragState();if(activeViewportCleanup===dispose)activeViewportCleanup=null;}
    function observeViewport(control={}){if(disposed||!viewport||typeof options.onVisibleWeeks!=='function')return;if(!viewportObserver){viewportObserver=viewport.observe({element,key:viewportKey,onVisibleWeeks:value=>options.onVisibleWeeks?.(value),restoreAnchor:control.restore??options.restoreViewport!==false});viewportObserver.start();activeViewportCleanup=dispose;}else if(control.restore===false)viewportObserver.cancelRestore?.();}
    return {element,get shown(){return shown;},update,dispose,observeViewport,captureViewport:()=>viewportObserver?.capture()||null};
  }

  function revealDay(day) { if (!parseDate(day)) return false; expandedDays.add(day); return true; }
  globalThis.CleanRoomsCalendar = Object.freeze({render,revealDay});
})();
