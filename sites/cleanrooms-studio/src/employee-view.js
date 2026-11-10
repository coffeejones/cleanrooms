/* Personal calendars read the plan; checklist writes remain owned by the caller. */
(() => {
  'use strict';
  const memory = new WeakMap();
  const date = value => new Date(value + 'T12:00:00Z');
  const iso = value => value.toISOString().slice(0,10);
  const format = (value,options) => date(value).toLocaleDateString('da-DK',{timeZone:'UTC',...options});
  const shortDate = value => format(value,{day:'numeric',month:'short'});
  const fullDate = value => format(value,{weekday:'long',day:'numeric',month:'long'});
  const engine=()=>globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const duration=shift=>engine().plannedMinutes(shift);
  const clockLabel=shift=>shift.start+'–'+shift.end+(shift.end<shift.start?' +1 dag':'');
  const hours = minutes => Math.floor(minutes/60) + (minutes%60 ? ' t ' + minutes%60 + ' min' : ' timer');
  const compactTime = time => time.endsWith(':00') ? time.slice(0,2) : time;
  const focusKey = element => element?.dataset?.taskKey ? {task:element.dataset.taskKey} : element?.dataset?.employeeShift ? {shift:element.dataset.employeeShift} : element?.dataset?.employeeView ? {view:element.dataset.employeeView} : element?.dataset?.employeeDate ? {day:element.dataset.employeeDate} : element?.id ? {id:element.id} : null;
  const inHiddenTree = element => {for(let current=element;current;current=current.parentElement)if(current.hidden)return true;return false;};

  function render(host,options = {}) {
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('Mine vagter kræver et indholdsfelt.');
    const doc=host.ownerDocument,Model=globalThis.CleanRoomsDescription,Calendar=globalThis.CleanRoomsEmployeeCalendar,Timekeeping=globalThis.CleanRoomsTimekeepingEmployee;
    if (!Calendar) throw new Error('Kalenderens datohjælper mangler.');
    const person=options.person||{},today=Calendar.validDate(options.today)?options.today:iso(new Date());
    const viewName=['month','week','day'].includes(options.view)?options.view:'month';
    const min=Calendar.validDate(options.minDate)?options.minDate:Calendar.MIN_DATE,max=Calendar.validDate(options.maxDate)?options.maxDate:Calendar.MAX_DATE;
    const focusDate=Calendar.clamp(Calendar.validDate(options.focusDate)?options.focusDate:Calendar.validDate(options.weekStart)?options.weekStart:today,min,max),period=Calendar.range(viewName,focusDate);
    const personal=(Array.isArray(options.shifts)?options.shifts:[]).filter(shift=>shift&&shift.person===person.id&&Calendar.validDate(shift.date)&&typeof shift.start==='string'&&typeof shift.end==='string').slice().sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||String(a.id).localeCompare(String(b.id)));
    const visible=personal.filter(shift=>engine().shiftDates(shift).some(day=>day>=period.from&&day<=period.to)),periodShifts=visible.filter(shift=>engine().shiftDates(shift).some(day=>day>=period.periodFrom&&day<=period.periodTo));
    const active=personal.find(shift=>['running','paused'].includes(Timekeeping?.entryFor(options.timekeeping?.entries,shift)?.status));
    const next=active||personal.find(shift=>engine().shiftDates(shift).some(day=>day>=today)),selected=personal.find(shift=>String(shift.id)===String(options.selectedShiftId));
    const previous=memory.get(host),hadSelected=previous?.selectedId,samePerson=previous?.person===person.id,sameShift=samePerson&&previous?.selectedId===selected?.id;
    const state=samePerson?previous:{person:person.id,calendarTop:0,detailTop:0,focus:null,returnFocus:null};
    const worksiteOpen=sameShift&&Boolean(previous?.detail?.querySelector?.('.cs-employee-worksite-info')?.open);
    if (previous?.page?.isConnected) {
      state.calendarTop=previous.calendar?.scrollTop||0;
      state.detailTop=previous.detail?.scrollTop||0;
      if (samePerson&&host.contains(doc.activeElement)) state.focus=focusKey(doc.activeElement)||state.focus;
    }
    const changedPeriod=!samePerson||state.view!==viewName||state.period!==period.periodFrom;
    if (changedPeriod) state.calendarTop=0;
    if (!sameShift) { state.detailTop=0;if(state.focus?.task) state.focus=null; }
    const node=(tag,className,text)=>{const element=doc.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
    const icon=direction=>{
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),path=doc.createElementNS(svg.namespaceURI,'path');
      Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}).forEach(([key,value])=>svg.setAttribute(key,String(value)));
      path.setAttribute('d',direction==='close'?'m6 6 12 12M6 18 18 6':direction==='right'?'m9 5 7 7-7 7':'m15 5-7 7 7 7');svg.append(path);return svg;
    };
    const button=(label,className,action,content=label)=>{const element=node('button',className);element.type='button';element.setAttribute('aria-label',label);element.append(typeof content==='string'?doc.createTextNode(content):content);element.addEventListener('click',action);return element;};
    const siteFor=shift=>shift.location||options.sites?.[shift.site]||{name:'Ukendt arbejdssted',address:''};
    const addressFor=site=>typeof site.address==='string'?site.address:'';
    const readFor=shift=>{try{return options.progressFor?.(shift)||{signature:'',tasks:[],checked:0,total:0,complete:false};}catch{return {signature:'',tasks:[],checked:0,total:0,complete:false};}};
    const timeFor=shift=>Timekeeping?.entryFor(options.timekeeping?.entries,shift)||null;
    const openShift=(shift,trigger)=>{state.returnFocus=focusKey(trigger||doc.activeElement);options.onOpenShift?.(shift.id);};
    const closeShift=()=>options.onOpenShift?.(null);
    const changeDate=(value,extra)=>{if(Calendar.validDate(value))options.onDateChange?.(Calendar.clamp(value,min,max),extra);};
    const shell=node('div','cs-employee-shell'),page=node('div','cs-employee-page');page.dataset.view=viewName;page.dataset.detailOpen=String(Boolean(selected));shell.append(page);

    const upcoming=node('section','cs-employee-next');upcoming.setAttribute('aria-label',active?'Din igangværende vagt':'Din næste vagt');
    const nextCopy=node('div','cs-employee-next-copy');nextCopy.append(node('span','cs-employee-eyebrow',active?'Igangværende vagt':'Næste vagt'));
    if(next){
      const site=siteFor(next),title=node('h3','cs-employee-next-time',clockLabel(next));
      title.append(node('span','cs-employee-next-date',fullDate(next.date)));nextCopy.append(title,node('p','cs-employee-next-site',site.name));
      if(addressFor(site))nextCopy.append(node('p','cs-employee-address',addressFor(site)));
      const nextRecord=timeFor(next);if(nextRecord){const registration=node('span','cs-employee-time-status',Timekeeping.statusLabel(nextRecord));registration.dataset.state=nextRecord.status;nextCopy.append(registration);}
      const nextButton=button(active?'Se din igangværende vagt':'Se din næste vagt','cs-button',event=>openShift(next,event.currentTarget),'Se vagt');nextButton.id='cs-employee-next-open';upcoming.append(nextCopy,nextButton);
    }else{nextCopy.append(node('h3','cs-employee-next-empty','Ingen kommende vagter'),node('p','cs-employee-muted','Der er ingen kommende vagter i din plan.'));upcoming.append(nextCopy);}
    page.append(upcoming);

    const toolbar=node('section','cs-employee-calendar-toolbar');toolbar.setAttribute('aria-label','Kalendernavigation');
    const periodCopy=node('div','cs-employee-period-copy');
    const title=viewName==='month'?format(focusDate,{month:'long',year:'numeric'}):viewName==='week'?'Uge '+period.isoWeek.week:fullDate(focusDate);
    const periodTitle=node('h3','cs-employee-period-title',title);periodTitle.id='cs-employee-calendar-title';
    const periodDescription=viewName==='week'?shortDate(period.periodFrom)+' – '+shortDate(period.periodTo)+' · ':'';
    periodCopy.append(periodTitle,node('span','cs-employee-period-total',periodDescription+periodShifts.length+(periodShifts.length===1?' vagt':' vagter')+' · '+hours(periodShifts.reduce((sum,shift)=>sum+engine().plannedMinutesInRange(shift,period.periodFrom,period.periodTo),0))));
    const tools=node('div','cs-employee-calendar-tools'),pair=node('div','cs-nav-pair'),periodLabel={month:'måned',week:'uge',day:'dag'}[viewName];
    const prev=button('Forrige '+periodLabel,'cs-icon-button',()=>changeDate(Calendar.navigate(viewName,focusDate,-1)),icon('left'));prev.id='cs-employee-prev-period';prev.disabled=!Calendar.canNavigate(viewName,focusDate,-1,min,max);
    const nextPeriod=button('Næste '+periodLabel,'cs-icon-button',()=>changeDate(Calendar.navigate(viewName,focusDate,1)),icon('right'));nextPeriod.id='cs-employee-next-period';nextPeriod.disabled=!Calendar.canNavigate(viewName,focusDate,1,min,max);pair.append(prev,nextPeriod);
    const current=button('Vis i dag','cs-button',()=>changeDate(today),'I dag');current.id='cs-employee-today';
    const jumpLabel=node('label','cs-employee-date-label'),jump=node('input','cs-employee-date');jump.id='cs-employee-date';jump.type='date';jump.value=focusDate;jump.min=min;jump.max=max;jumpLabel.append(node('span','cs-sr','Gå til dato'),jump);jump.addEventListener('change',()=>changeDate(jump.value));
    tools.append(pair,current,jumpLabel);
    const switcher=node('div','cs-view-switch cs-employee-view-switch');switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Kalendervisning');
    [['month','Måned'],['week','Uge'],['day','Dag']].forEach(([value,label])=>{const control=button('Vis '+label.toLowerCase(),'cs-employee-view-button',()=>options.onViewChange?.(value),label);control.dataset.employeeView=value;control.setAttribute('aria-pressed',String(value===viewName));switcher.append(control);});
    toolbar.append(periodCopy,tools,switcher);page.append(toolbar);

    const calendar=node('section','cs-employee-calendar');calendar.setAttribute('aria-labelledby','cs-employee-calendar-title');calendar.dataset.view=viewName;
    const scroll=node('div','cs-employee-calendar-scroll');scroll.id='cs-employee-calendar-scroll';calendar.append(scroll);
    const shiftCard=(shift,mode)=>{
      const site=siteFor(shift),progress=readFor(shift),label=fullDate(shift.date)+', '+clockLabel(shift)+', '+site.name+(progress.total?', '+progress.checked+' af '+progress.total+' opgaver':'');
      const row=button(label,'cs-employee-shift cs-employee-shift-'+mode,event=>openShift(shift,event.currentTarget),'');row.dataset.employeeShift=String(shift.id);row.setAttribute('aria-pressed',String(selected?.id===shift.id));row.title=label;
      const time=node('strong','cs-employee-shift-time');time.append(node('span','cs-employee-time-full',clockLabel(shift)),node('span','cs-employee-time-short',compactTime(shift.start)+'–'+compactTime(shift.end)+(shift.end<shift.start?' +1':'')));
      row.append(time,node('span','cs-employee-shift-site',site.name));
      if(progress.total){const count=node('span','cs-employee-shift-progress',progress.checked+'/'+progress.total);count.append(node('span','cs-employee-progress-label',' opgaver'));row.append(count);}
      const registration=timeFor(shift);if(registration){const label=Timekeeping.statusLabel(registration),status=node('span','cs-employee-time-status',label);status.dataset.state=registration.status;row.append(status);row.setAttribute('aria-label',row.getAttribute('aria-label')+' · '+label);}
      return row;
    };
    if(viewName==='day'){
      const dayHead=node('div','cs-employee-timeline-head');dayHead.append(node('span','',fullDate(focusDate)),node('span','cs-employee-muted',periodShifts.length?periodShifts.length+(periodShifts.length===1?' vagt':' vagter'):'Ingen vagter'));scroll.append(dayHead);
      const layout=Calendar.layout(visible,focusDate),timeline=node('div','cs-employee-timeline'),axis=node('div','cs-employee-time-axis'),canvas=node('div','cs-employee-time-canvas');
      const height=layout.totalMinutes/60*48;timeline.style.height=height+'px';
      for(let minute=layout.startMinute;minute<=layout.endMinute;minute+=60){const top=(minute-layout.startMinute)/layout.totalMinutes*100,label=node('span','cs-employee-hour',String(Math.floor(minute/60)%24).padStart(2,'0')+':00'),line=node('div','cs-employee-hour-line');label.style.top=top+'%';line.style.top=top+'%';axis.append(label);canvas.append(line);}
      for(const item of layout.items){const card=shiftCard(item.shift,'day');card.style.top=item.top*100+'%';card.style.height=item.height*100+'%';card.style.left='calc('+item.left*100+'% + 4px)';card.style.width='calc('+item.width*100+'% - 8px)';canvas.append(card);}
      timeline.append(axis,canvas);scroll.append(timeline);
      if(!layout.valid)scroll.prepend(node('p','cs-employee-calendar-empty','Vagterne kunne ikke vises i tidskalenderen.'));
      if(changedPeriod&&layout.items.length)state.calendarTop=Math.max(0,(Math.min(...layout.items.map(item=>item.startMinute))-layout.startMinute-60)/60*48);
    }else{
      const weekdays=node('div','cs-employee-weekdays');['Man','Tir','Ons','Tor','Fre','Lør','Søn'].forEach((label,index)=>{const day=node('span','',label);if(index>4)day.className='is-weekend';weekdays.append(day);});scroll.append(weekdays);
      const grid=node('div','cs-employee-calendar-grid');grid.style.setProperty('--cs-calendar-weeks',String(period.weeks));
      for(const day of period.days){
        const section=node('section','cs-employee-calendar-day');section.dataset.date=day;section.setAttribute('aria-label',fullDate(day));
        if(day.slice(0,7)!==focusDate.slice(0,7)&&viewName==='month')section.classList.toggle('is-outside',true);
        if(day===today)section.classList.toggle('is-today',true);if(day===focusDate)section.classList.toggle('is-focused-date',true);
        const dayButton=button('Vis '+fullDate(day),'cs-employee-calendar-date',()=>changeDate(day,{view:'day'}),'');dayButton.dataset.employeeDate=day;dayButton.disabled=day<min||day>max;
        dayButton.append(node('span','cs-employee-day-number',String(Number(day.slice(-2)))));
        if(day===today)dayButton.setAttribute('aria-current','date');
        if(viewName==='week')dayButton.append(node('span','cs-employee-day-month',format(day,{month:'short'})));
        const items=visible.filter(shift=>engine().shiftDates(shift).includes(day)),cards=node('div','cs-employee-day-shifts');items.forEach(shift=>cards.append(shiftCard(shift,viewName)));
        section.append(dayButton,cards);grid.append(section);
      }
      scroll.append(grid);
      if(!periodShifts.length){const empty=node('p','cs-employee-calendar-empty',viewName==='month'?'Ingen vagter i denne måned.':'Ingen vagter i denne uge.');scroll.append(empty);}
    }
    if(options.calendarLoading||options.calendarError){const notice=node('p','cs-employee-calendar-empty',options.calendarError||'Indlæser dine vagter…');notice.setAttribute('role','status');if(options.calendarError&&typeof options.onCalendarRetry==='function')notice.append(button('Prøv at hente vagterne igen','cs-button',options.onCalendarRetry,'Prøv igen'));calendar.append(notice);}
    page.append(calendar);
    let detailBody=null,detail=null,close=null;
    if(selected){
      page.inert=true;page.setAttribute('aria-hidden','true');
      const layer=node('div','cs-employee-layer'),backdrop=button('Luk vagtdetaljer','cs-employee-backdrop',closeShift,'');backdrop.tabIndex=-1;backdrop.setAttribute('aria-hidden','true');
      detail=node('section','cs-employee-detail');detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.setAttribute('aria-labelledby','cs-employee-detail-title');detail.tabIndex=-1;
      const site=siteFor(selected),view=readFor(selected),taskViews=Array.isArray(view.tasks)?view.tasks:[],status=options.saveStatus||{};
      const head=node('header','cs-employee-detail-head'),headTop=node('div','cs-employee-detail-head-top');
      const heading=node('h3','cs-employee-detail-title','Vagtdetaljer');heading.id='cs-employee-detail-title';close=button('Luk vagtdetaljer','cs-icon-button',closeShift,icon('close'));close.id='cs-employee-close';headTop.append(heading,close);head.append(headTop);
      head.append(node('p','cs-employee-detail-date',fullDate(selected.date)),node('p','cs-employee-detail-time',clockLabel(selected)),node('p','cs-employee-detail-site',site.name));
      if(Number.isSafeInteger(selected.plannedBreakMinutes)&&selected.plannedBreakMinutes>0)head.append(node('p','cs-employee-muted cs-employee-detail-planned-pause',selected.plannedBreakMinutes+' min ulønnet pause · '+hours(duration(selected))+' arbejdstid'));
      if(addressFor(site))head.append(node('p','cs-employee-address',addressFor(site)));detail.append(head);detailBody=node('div','cs-employee-detail-body');
      const worksiteInfo=options.worksiteInfo??site.worksiteInfo;
      if(worksiteInfo&&typeof worksiteInfo==='object'&&!Array.isArray(worksiteInfo)){
        const rows=[['Kontaktperson',worksiteInfo.contactName],['Telefon',worksiteInfo.contactPhone],['Parkering',worksiteInfo.parking],['Adgangsvejledning',worksiteInfo.accessInstructions]].filter(([,value])=>typeof value==='string'&&value.trim());
        if(rows.length){const information=node('details','cs-employee-worksite-info'),toggle=node('summary','','Oplysninger om arbejdsstedet'),list=node('dl','cs-employee-worksite-info-fields');for(const [label,value]of rows){const row=node('div');row.append(node('dt','',label),node('dd','',value));list.append(row);}information.open=worksiteOpen;information.append(toggle,list);detailBody.append(information);}
      }
      if(typeof options.onOfferShift==='function'&&selected.date>=today)detailBody.append(button('Tilbyd vagt til en kollega','cs-button cs-employee-offer',()=>options.onOfferShift(selected),'Tilbyd vagten til en kollega'));
      if(options.timekeeping&&Timekeeping)detailBody.append(Timekeeping.render(doc,{...options.timekeeping,shift:selected,entry:timeFor(selected),today,preview:options.preview===true||options.timekeeping.preview===true,onAction:options.onTimeAction}));
      const summary = node('div','cs-employee-task-summary'), progressText = node('strong','cs-employee-task-count'), progressBar = node('progress','cs-employee-task-bar'); progressBar.setAttribute('aria-label','Opgaver udført på denne vagt'); summary.append(progressText,progressBar);
      const saveStatus = node('div','cs-employee-save-status'), statusText = node('span','cs-employee-save-message'); statusText.setAttribute('role','status'); statusText.setAttribute('aria-live','polite'); saveStatus.dataset.state = status.state || 'saved'; saveStatus.append(statusText);
      const instructionsTitle = node('h4','cs-employee-instructions-title','Instruktioner'), instructions = node('div','cs-rich-content cs-employee-instructions');
      const raw = Model?.normalize(selected.noteRich) || Model?.fromText(selected.note || '');
      if(options.detailLoading)instructions.append(node('p','cs-employee-muted','Henter instruktioner og tjekliste…'));else if (Model) Model.render(instructions,raw,{interactiveTasks:true}); else instructions.textContent = selected.note || '';
      if (!options.detailLoading&&!Model?.hasContent(raw)) instructions.append(node('p','cs-employee-muted','Der er ikke tilføjet instruktioner til denne vagt.'));
      summary.hidden=options.detailLoading===true;
      const checks = [...instructions.querySelectorAll('input[type="checkbox"]')], compatible = !options.detailLoading&&checks.length === taskViews.length && (!checks.length || typeof view.signature === 'string' && Boolean(view.signature));
      let pending = false, localSaveState = status.state || 'saved';
      const isBlocked = () => pending || ['loading','saving','error'].includes(localSaveState) || !compatible || typeof options.onToggleTask !== 'function';
      const syncProgress = () => {
        const completed = checks.filter(input => input.checked).length;
        progressText.textContent = completed + ' af ' + checks.length + ' opgaver udført'; progressBar.max = Math.max(1,checks.length); progressBar.value = completed;
        checks.forEach(input => { input.disabled = isBlocked(); const row = input.closest('li[data-type="taskItem"]'); if (row) { row.dataset.checked = String(input.checked); row.classList.toggle('is-complete',input.checked); } });
      };
      statusText.textContent = status.message || ({loading:'Henter afkrydsninger…',saving:'Gemmer afkrydsning…',saved:'Afkrydsningerne er gemt.',error:'Afkrydsningen kunne ikke gemmes.'}[status.state] || '');
      if(options.preview)statusText.textContent='Forhåndsvisning af udgivne vagter. Kun medarbejderens egen konto kan afkrydse opgaver.';
      if (!compatible && !['loading','error'].includes(status.state)) statusText.textContent = 'Opgavelisten er ændret. Åbn vagten igen for at hente de aktuelle opgaver.';
      if (status.state === 'error' && typeof status.retry === 'function') saveStatus.append(button('Prøv at gemme afkrydsningen igen','cs-button',status.retry,'Prøv igen'));
      checks.forEach((input,index) => {
        const task = taskViews[index]; input.checked = Boolean(task?.checked); if (task?.key !== undefined) input.dataset.taskKey = String(task.key);
        input.addEventListener('change',() => {
          if (isBlocked() || !task) { input.checked = Boolean(task?.checked); syncProgress(); return; }
          const nextValue = input.checked; pending = true; localSaveState = 'saving'; state.focus = {task:String(task.key)}; statusText.textContent = 'Gemmer afkrydsning…'; saveStatus.dataset.state = 'saving'; syncProgress();
          try {
            const result = options.onToggleTask(selected.id,task.key,nextValue,view.signature);
            if (result && typeof result.then === 'function') result.then(accepted => {
              if (!page.isConnected) return;
              pending = false;
              if (accepted === false) { localSaveState = 'error'; input.checked = Boolean(task.checked); statusText.textContent = 'Opgavelisten er ændret. Åbn vagten igen.'; saveStatus.dataset.state = 'error'; }
              else { localSaveState = 'saved'; statusText.textContent = 'Afkrydsningen er gemt.'; saveStatus.dataset.state = 'saved'; }
              syncProgress();
            }).catch(() => {
              if (!page.isConnected) return;
              pending = false; localSaveState = 'error'; input.checked = Boolean(task.checked); statusText.textContent = 'Afkrydsningen kunne ikke gemmes. Åbn vagten igen og prøv igen.'; saveStatus.dataset.state = 'error'; syncProgress();
            });
            else if (result === false && page.isConnected) { pending = false; localSaveState = 'error'; input.checked = Boolean(task.checked); statusText.textContent = 'Opgavelisten er ændret. Åbn vagten igen.'; saveStatus.dataset.state = 'error'; syncProgress(); }
          } catch { pending = false; localSaveState = 'error'; input.checked = Boolean(task.checked); statusText.textContent = 'Afkrydsningen kunne ikke gemmes. Prøv igen.'; saveStatus.dataset.state = 'error'; syncProgress(); }
        });
      });
      syncProgress(); summary.hidden = !checks.length; saveStatus.hidden = !checks.length; detailBody.append(summary,saveStatus,instructionsTitle,instructions); detail.append(detailBody);
      layer.append(backdrop,detail);shell.append(layer);
      detail.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeShift();return;}
        if(event.key!=='Tab')return;
        const focusables=[...detail.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(item=>!item.disabled&&!inHiddenTree(item)&&item.tabIndex!==-1);
        const first=focusables[0],last=focusables.at(-1);if(!first){event.preventDefault();detail.focus();return;}
        if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===detail)){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&(doc.activeElement===last||!detail.contains(doc.activeElement))){event.preventDefault();first.focus();}
      });
    }
    host.replaceChildren(shell);
    state.person=person.id;state.selectedId=selected?.id;state.view=viewName;state.period=period.periodFrom;state.page=page;state.calendar=scroll;state.detail=detailBody;memory.set(host,state);
    scroll.scrollTop=state.calendarTop||0;if(detailBody)detailBody.scrollTop=state.detailTop||0;
    const resolveFocus=key=>{
      if(!key)return null;
      const elements=[...shell.querySelectorAll('button,input,select,textarea,summary,a[href],section[role="dialog"]')];
      return elements.find(element=>!element.disabled&&!inHiddenTree(element)&&(key.task?element.dataset.taskKey===key.task:key.shift?element.dataset.employeeShift===key.shift:key.view?element.dataset.employeeView===key.view:key.day?element.dataset.employeeDate===key.day:element.id===key.id));
    };
    if(selected){
      const target=sameShift?resolveFocus(state.focus):null;
      if(target&&detail.contains(target))target.focus({preventScroll:true});else if(!sameShift)close.focus({preventScroll:true});else detail.focus({preventScroll:true});
    }else if(hadSelected&&samePerson){
      (resolveFocus(state.returnFocus)||resolveFocus(state.focus)||prev).focus({preventScroll:true});state.returnFocus=null;
    }else if(samePerson&&state.focus){(resolveFocus(state.focus)||prev).focus({preventScroll:true});}
    return {element:page,dispose(){if(memory.get(host)?.page===page)memory.delete(host);}};
  }
  globalThis.CleanRoomsEmployee=Object.freeze({render});
  if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.CleanRoomsEmployee;
})();
