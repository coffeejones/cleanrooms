/* Read-only recurring templates with their actual, materialized occurrences. */
(() => {
  'use strict';
  const statuses = Object.freeze([['active','I gang'],['upcoming','Kommende'],['ended','Afsluttede'],['all','Alle']]);
  const days = ['Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag','Søndag'];
  const shortDays = ['Man','Tir','Ons','Tor','Fre','Lør','Søn'];
  const weekdayLetters = ['M','T','O','T','F','L','S'];
  const formatter = new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const str = value => value == null ? '' : String(value);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z'));
  const formatDate = value => validDate(value) ? formatter.format(new Date(value+'T12:00:00Z')) : 'Dato mangler';
  const isOpenEnded = phase => phase?.openEnded === true && phase.endDate === '2100-12-31';
  const endLabel = phase => isOpenEnded(phase) ? 'Uden slutdato' : formatDate(phase.endDate);
  const shiftOrder = (a,b) => str(a.date).localeCompare(str(b.date)) || str(a.start).localeCompare(str(b.start)) || str(a.id).localeCompare(str(b.id));
  const disclosures = new WeakMap();
  const phaseOrder = (a,b) => str(a.startDate).localeCompare(str(b.startDate)) || str(a.endDate).localeCompare(str(b.endDate)) || str(a.id).localeCompare(str(b.id));
  const patternTimes = phase => [...new Set(Array.isArray(phase.weekdays) ? phase.weekdays : [])].filter(day => Number.isInteger(day) && day >= 0 && day < 7).sort((a,b) => a-b).map(day => ({day,start:phase.dayTimes?.[day]?.start || phase.start,end:phase.dayTimes?.[day]?.end || phase.end,plannedBreakMinutes:phase.dayTimes?.[day]?.plannedBreakMinutes??phase.plannedBreakMinutes??0}));
  const pauseLabel=phase=>{const pauses=[...new Set(patternTimes(phase).map(item=>item.plannedBreakMinutes))].sort((a,b)=>a-b);return pauses.some(value=>value>0)?(pauses.length===1?pauses[0]+' min ulønnet pause':pauses[0]+'–'+pauses.at(-1)+' min pause · varierer pr. dag'):'';};
  const patternLabel = phase => { const times = patternTimes(phase), unique = [...new Set(times.map(time => str(time.start)+'–'+str(time.end)))]; return unique.length > 1 ? 'Varierende tider' : unique[0] || str(phase.start)+'–'+str(phase.end); };

  function fallbackGroups(phases,options,today) {
    const grouped = new Map();
    phases.forEach(phase => { const id = str(phase.groupId || phase.id); if (!grouped.has(id)) grouped.set(id,[]); grouped.get(id).push(phase); });
    return [...grouped].map(([id,items]) => {
      const periods = items.slice().sort(phaseOrder), current = periods.find(phase => phase.startDate <= today && phase.endDate >= today);
      const representative = current || periods.find(phase => phase.startDate > today) || periods[periods.length-1];
      const latest = periods.slice().sort((a,b) => str(b.endDate).localeCompare(str(a.endDate)) || phaseOrder(b,a))[0];
      const shifts = new Map(), exceptions = {count:0,edited:0,deleted:0};
      periods.forEach(phase => {
        const source = typeof options.shiftsForSeries === 'function' ? options.shiftsForSeries(phase) : [];
        (Array.isArray(source) ? source : []).filter(shift => shift && validDate(shift.date)).forEach(shift => shifts.set(shift.id,shift));
        const value = options.exceptionCount?.(phase), count = Number(value && typeof value === 'object' ? value.count : value);
        if (Number.isInteger(count) && count > 0) exceptions.count += count;
        if (value && typeof value === 'object') { exceptions.edited += Number(value.edited) || 0; exceptions.deleted += Number(value.deleted) || 0; }
      });
      return {id,groupId:id,phases:periods,representative,latest,startDate:periods[0].startDate,endDate:latest.endDate,shifts:[...shifts.values()],exceptions};
    });
  }

  function model(options = {}) {
    const today = validDate(options.today) ? options.today : '0001-01-01';
    const phases = (Array.isArray(options.series) ? options.series : []).filter(Boolean), lifecycle = options.lifecycle || globalThis.CleanRoomsSeriesLifecycle;
    const groups = Array.isArray(options.agreements) ? options.agreements : typeof lifecycle?.groupSeries === 'function' ? lifecycle.groupSeries(phases,{today,edits:options.edits || {},deleted:options.deleted || []}) : fallbackGroups(phases,options,today);
    const allEntries = groups.filter(group => group?.representative).map(group => {
      const series = group.representative, periods = group.phases.slice().sort(phaseOrder),latest=group.latest || periods[periods.length-1],openEnded=group.openEnded===true||isOpenEnded(latest);
      const summarized=group.summary===true;
      const occurrences = summarized?null:(Array.isArray(group.shifts) ? group.shifts : Array.isArray(group.occurrences) ? group.occurrences : []).filter(shift => shift && validDate(shift.date)).slice().sort(shiftOrder);
      const upcoming = summarized?null:occurrences.filter(shift => shift.date >= today),next=summarized?group.next||null:upcoming[0]||null,upcomingCount=openEnded?null:summarized?group.upcomingCount:upcoming.length;
      const status = group.startDate > today ? 'upcoming' : !openEnded && group.endDate < today && !next ? 'ended' : 'active';
      const raw = group.exceptions;
      const count = Number(raw && typeof raw === 'object' ? raw.count : raw);
      const daysToEnd = !openEnded && validDate(group.endDate) ? Math.round((Date.parse(group.endDate+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000) : null;
      return {...group,id:str(group.id || group.groupId || series.id),series,phases:periods,latest,openEnded,...(summarized?{}:{occurrences,upcoming}),upcomingCount,next,status,daysToEnd,expiring:daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 28,name:str(options.personName?.(series.person) || 'Ledig vagt'),exceptions:Number.isInteger(count) && count > 0 ? count : 0,exceptionDetails:raw || {count:0}};
    });
    const entries = typeof options.filterAgreement === 'function' ? allEntries.filter(entry => options.filterAgreement(entry)) : allEntries;
    const rank = {active:0,upcoming:1,ended:2};
    entries.sort((a,b) => rank[a.status]-rank[b.status]
      || (a.status === 'ended' ? str(b.endDate).localeCompare(str(a.endDate)) : str(a.next?.date || '9999-12-31').localeCompare(str(b.next?.date || '9999-12-31')))
      || str(a.next?.start).localeCompare(str(b.next?.start)) || a.name.localeCompare(b.name,'da-DK') || str(a.series.id).localeCompare(str(b.series.id)));
    const status = statuses.some(([key]) => key === options.status) ? options.status : 'active';
    return {status,entries,total:allEntries.length,visible:entries.filter(entry => status === 'all' || entry.status === status),counts:Object.fromEntries(statuses.map(([key]) => [key,key === 'all' ? entries.length : entries.filter(entry => entry.status === key).length]))};
  }

  function render(options = {}) {
    const doc = options.document || globalThis.document;
    if (!doc?.createElement) throw new TypeError('Vagtserieoversigten kræver et dokument.');
    const view = model(options);
    if (!disclosures.has(doc)) disclosures.set(doc,new Set());
    const localExpanded = disclosures.get(doc), expanded = options.expandedGroups || localExpanded;
    const node = (tag,className,text) => { const item = doc.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = str(text); return item; };
    const button = (text,action,className='cs-button') => { const item = node('button',className,text); item.type = 'button'; item.addEventListener('click',event => action?.(event.currentTarget || item)); return item; };
    const siteName = index => str(options.sites?.[index]?.name || 'Ukendt arbejdssted');
    const field = (label,className) => { const item = node('div','cs-series-row-field '+className); item.append(node('span','cs-series-row-label',label)); return item; };
    const surface = node('section','cs-series-overview'); surface.setAttribute('aria-label','Vagtserier');
    const head = node('header','cs-series-overview-head'), tabs = node('div','cs-series-statuses'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','Filtrer vagtserier efter periode');
    statuses.forEach(([key,label]) => {
      const tab = button(label,() => options.onStatusChange?.(key),'cs-series-status'); tab.id = 'cs-series-status-'+key;
      tab.dataset.seriesStatus = key; tab.dataset.productFocus = 'series:status:'+key; tab.setAttribute('aria-pressed',String(key === view.status));
      tab.setAttribute('aria-label',label+' · '+view.counts[key]+(view.counts[key] === 1 ? ' serie' : ' serier')); tabs.append(tab);
    });
    const result = node('span','cs-sr',view.visible.length+(view.visible.length === 1 ? ' vagtserie vises.' : ' vagtserier vises.')); result.setAttribute('role','status'); head.append(tabs,result);
    const examples = options.demoExamples;
    if (examples && typeof examples === 'object') {
      const add = button(examples.installed ? 'Eksempler indlæst' : 'Tilføj eksempelserier',trigger => { if (!add.disabled && !examples.installed) examples.onAdd?.(trigger); });
      add.className += ' cs-chrome-quiet'; add.id = 'cs-series-demo-examples'; add.dataset.productFocus = 'series:demo-examples'; add.disabled = Boolean(examples.installed) || typeof examples.onAdd !== 'function';
      add.title = examples.installed ? 'Eksemplerne er allerede tilføjet.' : 'Tilføj eksempler på ugedage, perioder og forlængelse.';
      head.append(add);
    }
    surface.append(head);
    const list = node('div','cs-series-overview-list'); list.setAttribute('role','list'); list.setAttribute('aria-label','Faste vagtserier'); surface.append(list);
    if (!view.visible.length) {
      const total = Number.isInteger(options.totalAgreements) ? options.totalAgreements : Number.isInteger(options.totalSeries) ? options.totalSeries : view.total, noSeries = total === 0, empty = node('div','cs-series-overview-empty');
      const title = noSeries ? 'Ingen vagtserier endnu' : !view.entries.length ? 'Ingen serier matcher filtrene' : view.status === 'active' ? 'Ingen vagtserier er i gang' : view.status === 'upcoming' ? 'Ingen kommende vagtserier' : 'Ingen afsluttede vagtserier';
      const copy = noSeries ? 'Opret faste ugedage, tid og periode for en medarbejder.' : !view.entries.length ? 'Tilpas søgningen eller vælg et andet arbejdssted ovenfor.' : 'Se de øvrige perioder under Alle.';
      empty.append(node('h3','cs-series-empty-title',title),node('p','cs-series-empty-copy',copy));
      if (noSeries && typeof options.onCreate === 'function') { const create = button('Opret vagtserie',trigger => options.onCreate(trigger),'cs-button cs-primary'); create.dataset.productFocus = 'series:create'; empty.append(create); }
      else if (view.entries.length && view.status !== 'all') { const all = button('Vis alle serier',() => options.onStatusChange?.('all')); all.dataset.productFocus = 'series:show-all'; empty.append(all); }
      list.append(empty); return surface;
    }
    const columns=node('div','cs-series-register-columns');columns.setAttribute('aria-hidden','true');
    for(const label of ['Medarbejder / arbejdssted','Ugeplan','Periode','Overblik','Handlinger'])columns.append(node('span',null,label));
    list.append(columns);
    const menus=[],rows=node('div','cs-series-register-rows');rows.setAttribute('role','presentation');list.append(rows);
    const appendEntry=(entry,position)=>{
      const {series,next} = entry, row = node('article','cs-series-row'); row.dataset.seriesId = str(series.id); row.dataset.agreementId = entry.id; row.dataset.status = entry.status; row.setAttribute('role','listitem');row.setAttribute('aria-posinset',String(position));row.setAttribute('aria-setsize',String(view.visible.length));
      const identity = node('div','cs-series-row-identity'), avatar = node('span','cs-series-row-avatar',options.personInitials?.(series.person) || entry.name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join('') || '—'); avatar.setAttribute('aria-hidden','true');
      const copy = node('div','cs-series-row-copy'); copy.append(node('h3','cs-series-row-name',entry.name),node('p','cs-series-row-site',siteName(series.site)));
      const exampleLabel = examples?.labelFor?.(entry);
      if (typeof exampleLabel === 'string' && exampleLabel.trim()) { const label = node('span','cs-series-example-label',exampleLabel); label.setAttribute('aria-label','Eksempel: '+exampleLabel); label.title = 'Eksempel'; copy.append(label); }
      identity.append(avatar,copy); row.append(identity);
      const pattern = field(series.startDate > options.today ? 'Næste rytme' : !isOpenEnded(series) && series.endDate < options.today ? 'Seneste rytme' : 'Nuværende rytme','cs-series-row-pattern'); pattern.append(node('strong','cs-series-row-time',patternLabel(series)));
      const selected = new Set(Array.isArray(series.weekdays) ? series.weekdays : []), week = node('div','cs-series-week-pattern'); week.setAttribute('role','img'); week.setAttribute('aria-label','Gentages: '+days.filter((_,index) => selected.has(index)).join(', '));
      weekdayLetters.forEach((day,index) => { const item = node('span','cs-series-weekday',day); item.title=days[index]; item.dataset.active = String(selected.has(index)); item.setAttribute('aria-hidden','true'); if (selected.has(index)) { const time = series.dayTimes?.[index] || series; item.title = days[index]+' '+str(time.start)+'–'+str(time.end); } week.append(item); }); pattern.append(week);
      if (patternLabel(series) === 'Varierende tider') { const times=node('span','cs-series-pattern-times',patternTimes(series).map(time => shortDays[time.day]+' '+str(time.start)+'–'+str(time.end)).join(' · '));times.title=times.textContent;pattern.append(times); }
      if(pauseLabel(series))pattern.append(node('span','cs-series-planned-break',pauseLabel(series)));
      row.append(pattern);
      const period = field('Samlet periode','cs-series-row-period'),range=node('span','cs-series-row-value');
      range.append(node('span','cs-series-period-start',formatDate(entry.startDate)),node('span','cs-series-period-end',entry.openEnded?'Uden slutdato':'– '+formatDate(entry.endDate)));period.append(range);
      row.append(period);
      const nextField = field('Overblik','cs-series-row-next'),future=entry.phases.find(phase=>phase.startDate>options.today&&phase.id!==series.id);
      nextField.append(node('span','cs-series-row-state',{active:'I gang',upcoming:'Kommende',ended:'Afsluttet'}[entry.status]));
      if(future) nextField.append(node('span','cs-series-next-change','Ny periode '+formatDate(future.startDate)));
      else if(next){nextField.append(node('span','cs-series-next-label','Næste vagt '+formatDate(next.date)),node('span','cs-series-next-time',str(next.start)+'–'+str(next.end)));if(next.site!==series.site)nextField.append(node('span','cs-series-next-site',siteName(next.site)));if(next.person!==series.person)nextField.append(node('span','cs-series-next-site',options.personName?.(next.person)||'Ledig vagt'));}
      else if(entry.status==='ended')nextField.append(node('span','cs-series-next-label','Ingen kommende vagter'));
      else nextField.append(node('span','cs-series-next-label','Ingen planlagte vagter'));
      if(entry.expiring)nextField.append(node('span','cs-series-expiry',entry.daysToEnd===0?'Udløber i dag':'Udløber om '+entry.daysToEnd+(entry.daysToEnd===1?' dag':' dage')));
      row.append(nextField);
      const actions = node('div','cs-series-row-actions');
      if (typeof options.onEdit === 'function') { const edit = button('Rediger',trigger => options.onEdit(series,trigger),'cs-button cs-series-edit-action'); edit.dataset.productFocus = 'series:'+entry.id+':edit'; edit.setAttribute('aria-label','Rediger vagtserien for '+entry.name); actions.append(edit); }
      if([options.onShow,options.onCopy,...(!entry.openEnded?[options.onExtend]:[])].some(action=>typeof action==='function')){
        const menu=node('details','cs-series-row-menu'),trigger=node('summary','cs-series-more','⋯'),items=node('div','cs-series-menu-items');
        trigger.setAttribute('aria-label','Flere handlinger for '+entry.name);trigger.dataset.productFocus='series:'+entry.id+':more';
        const run=action=>{menu.open=false;action(trigger);};
        if(typeof options.onShow==='function'){const show=button('Vis i planen',()=>run(origin=>options.onShow(series,next,origin)),'cs-button cs-quiet');show.dataset.productFocus='series:'+entry.id+':show';show.setAttribute('aria-label','Vis vagtserien for '+entry.name+' i planen');items.append(show);}
        if(typeof options.onCopy==='function'){const copy=button('Kopiér',()=>run(origin=>options.onCopy(series,origin,entry)),'cs-button cs-quiet');copy.dataset.productFocus='series:'+entry.id+':copy';copy.setAttribute('aria-label','Kopiér vagtserien for '+entry.name);items.append(copy);}
        if(!entry.openEnded&&typeof options.onExtend==='function'){const extend=button('Forlæng',()=>run(origin=>options.onExtend(entry.latest,origin,entry)),'cs-button cs-quiet');extend.dataset.productFocus='series:'+entry.id+':extend';extend.setAttribute('aria-label','Forlæng vagtserien for '+entry.name);if(entry.expiring)extend.dataset.expiring='true';items.append(extend);}
        menu.append(trigger,items);menus.push(menu);menu.addEventListener('toggle',()=>{if(menu.open){for(const other of menus)if(other!==menu)other.open=false;const bounds=trigger.getBoundingClientRect?.(),height=items.getBoundingClientRect?.().height||142,viewport=doc.defaultView?.innerHeight;menu.dataset.placement=bounds&&viewport&&bounds.bottom+height+12>viewport&&bounds.top>height+12?'up':'down';}});
        menu.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();event.stopPropagation();menu.open=false;trigger.focus?.({preventScroll:true});}});actions.append(menu);
      }
      row.append(actions);
      const timeline = node('details','cs-series-timeline'); timeline.dataset.agreementId = entry.id; timeline.open = typeof expanded.has === 'function' ? expanded.has(entry.id) : Array.isArray(expanded) && expanded.includes(entry.id);
      const summary = node('summary','cs-series-timeline-summary');summary.append(node('span','cs-series-disclosure-label','Se perioder'),node('span','cs-series-period-count',entry.phases.length+(entry.phases.length===1?' periode':' perioder')));summary.dataset.productFocus='series:'+entry.id+':periods';
      if(entry.exceptions>0){const exceptions=node('span','cs-series-exception-count',entry.exceptions+(entry.exceptions===1?' undtagelse':' undtagelser'));exceptions.title='Manuelt redigerede eller slettede forekomster';summary.append(exceptions);}
      if(series.hasDescription||series.note||series.noteRich){const description=node('span','cs-series-row-description'),indicator=options.descriptionIndicator?.(series);if(indicator)description.append(indicator);description.append(node('span',null,'Beskrivelse'));summary.append(description);}
      const body=node('div','cs-series-agreement-details');let built=false;
      const buildPeriods=()=>{
       if(built)return;built=true;
       const facts=node('div','cs-series-expanded-facts'),count=entry.upcomingCount??entry.upcoming?.length??0;
       facts.append(node('span','cs-series-upcoming',entry.openEnded?'Gentages uden slutdato':count+(count===1?' kommende vagt':' kommende vagter')));
       if(next)facts.append(node('span','cs-series-expanded-next','Næste vagt: '+formatDate(next.date)+' · '+str(next.start)+'–'+str(next.end)+' · '+(options.personName?.(next.person)||'Ledig vagt')+' · '+siteName(next.site)));
       body.append(facts);
       const periods=node('ol','cs-series-periods');
       entry.phases.forEach(phase => {
        const item = node('li','cs-series-period'); item.dataset.phaseId = str(phase.id);
        const range = node('div','cs-series-period-range'); range.append(node('strong',null,formatDate(phase.startDate)+' – '+endLabel(phase)),node('span','cs-series-period-state',phase.startDate > options.today ? 'Kommende periode' : !isOpenEnded(phase) && phase.endDate < options.today ? 'Afsluttet periode' : 'Gældende periode'));
        const person = node('div','cs-series-period-person'); person.append(node('strong',null,options.personName?.(phase.person) || 'Ledig vagt'),node('span',null,siteName(phase.site)));
        const rhythm = node('div','cs-series-period-rhythm'); rhythm.append(node('strong',null,patternLabel(phase)),node('span',null,patternTimes(phase).map(time => shortDays[time.day]+(patternLabel(phase) === 'Varierende tider' ? ' '+str(time.start)+'–'+str(time.end) : '')).join(' · ')));
        if(pauseLabel(phase))rhythm.append(node('span','cs-series-planned-break',pauseLabel(phase)));
        item.append(range,person,rhythm);
        if (typeof options.onEdit === 'function') { const edit = button('Rediger periode',trigger => options.onEdit(phase,trigger),'cs-button cs-quiet'); edit.dataset.productFocus = 'series:'+str(phase.id)+':edit-period'; edit.setAttribute('aria-label','Rediger perioden '+(isOpenEnded(phase)?'fra '+formatDate(phase.startDate)+' uden slutdato':formatDate(phase.startDate)+' til '+formatDate(phase.endDate))+' for '+(options.personName?.(phase.person) || 'Ledig vagt')); item.append(edit); }
        periods.append(item);
       });
       body.append(periods);
      };
      timeline.append(summary,body);if(timeline.open)buildPeriods();
      timeline.addEventListener('toggle',()=>{if(timeline.open){buildPeriods();localExpanded.add(entry.id);}else localExpanded.delete(entry.id);options.onToggleGroup?.(entry.id,timeline.open);});row.append(timeline);rows.append(row);
    };
    const filterKey=JSON.stringify([view.status,view.visible.length,view.visible[0]?.id,view.visible.at(-1)?.id]),previous=doc.querySelector?.('.cs-series-overview'),focused=doc.activeElement?.dataset?.productFocus;
    let limit=previous?.dataset?.filterKey===filterKey?Math.max(50,Number(previous.dataset.renderedCount)||0):50;
    view.visible.forEach((entry,index)=>{if((typeof expanded.has==='function'?expanded.has(entry.id):Array.isArray(expanded)&&expanded.includes(entry.id))||focused?.startsWith('series:'+entry.id+':'))limit=Math.max(limit,Math.ceil((index+1)/50)*50);});
    const footer=node('div','cs-series-register-footer'),progress=node('span','cs-series-register-progress'),more=button('Vis flere',()=>{appendBatch(50);(more.hidden?progress:more).focus?.({preventScroll:true});},'cs-button cs-chrome-quiet');more.dataset.productFocus='series:show-more';progress.tabIndex=-1;
    let shown=0;const appendBatch=amount=>{const end=Math.min(view.visible.length,shown+amount);for(;shown<end;shown++)appendEntry(view.visible[shown],shown+1);surface.dataset.renderedCount=String(shown);progress.textContent=shown+' af '+view.visible.length+' serier';more.hidden=shown>=view.visible.length;};
    surface.dataset.filterKey=filterKey;appendBatch(limit);footer.append(progress,more);if(view.visible.length>50)list.append(footer);
    surface.addEventListener('pointerdown',event=>{for(const menu of menus)if(menu.open&&typeof menu.contains==='function'&&!menu.contains(event.target))menu.open=false;});
    return surface;
  }
  const api = Object.freeze({render,model}); globalThis.CleanRoomsSeriesOverview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
