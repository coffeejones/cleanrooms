/* Date-level inspection of an unsaved recurrence. No plan state is mutated. */
(() => {
  'use strict';
  const Engine=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'));
  const date=value=>new Date(value+'T12:00:00Z');
  const addDays=(value,count)=>{const result=date(value);result.setUTCDate(result.getUTCDate()+count);return result.toISOString().slice(0,10);};
  const monthStep=(value,count)=>{const result=date(value.slice(0,7)+'-01');result.setUTCMonth(result.getUTCMonth()+count);return result.toISOString().slice(0,10);};
  const label=value=>date(value).toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  function assess({shifts=[],existing=[],blockedDates=[],pendingRequests=[]}={}) {
    const ids=new Set(shifts.map(shift=>shift.id)),conflicts=[],seen=new Set();
    Engine.conflicts(shifts,[...existing.filter(shift=>!ids.has(shift.id)),...shifts]).forEach(issue=>{const key=[issue.shift.id,issue.other.id].sort().join('|');if(!seen.has(key)){seen.add(key);conflicts.push({...issue,date:issue.shift.date});}});
    shifts.forEach(shift=>{const hit=blockedDates.find(item=>item.person===shift.person&&Engine.shiftDates(shift).includes(item.date));if(hit)conflicts.push({type:'leave',date:hit.date,shift});});
    return {conflicts:conflicts.sort((a,b)=>a.date.localeCompare(b.date)),pendingRequests:pendingRequests.filter(item=>shifts.some(shift=>shift.person===item.person&&Engine.shiftDates(shift).includes(item.date)))};
  }
  function model({draft={},shifts=[],conflicts=[],pendingRequests=[],unavailableDates=[],today,state={}}={}) {
    const days=new Map(),get=value=>{if(!days.has(value))days.set(value,{date:value,shifts:[],conflicts:[],pending:[],unavailable:false});return days.get(value);};
    shifts.forEach(shift=>get(shift.date).shifts.push(shift));
    conflicts.forEach(issue=>get(issue.date).conflicts.push(issue));
    pendingRequests.forEach(issue=>get(issue.date).pending.push(issue));
    unavailableDates.filter(validDate).forEach(day=>get(day).unavailable=true);
    const issues=[...days.values()].filter(day=>day.conflicts.length).sort((a,b)=>a.date.localeCompare(b.date));
    const warnings=[...days.values()].filter(day=>(day.pending.length||day.unavailable)&&!day.conflicts.length).sort((a,b)=>a.date.localeCompare(b.date));
    const upcoming=shifts.find(shift=>shift.date>=today),initial=issues[0]?.date||upcoming?.date||shifts[0]?.date||draft.startDate;
    const first=[draft.startDate,...days.keys()].filter(validDate).sort()[0]||initial,last=[draft.endDate,...days.keys()].filter(validDate).sort().at(-1)||initial;
    const chosen=days.has(state.selected)?state.selected:initial;
    let month=validDate(state.month)?state.month.slice(0,7)+'-01':validDate(chosen)?chosen.slice(0,7)+'-01':null;
    if(month&&first&&month.slice(0,7)<first.slice(0,7))month=first.slice(0,7)+'-01';
    if(month&&last&&month.slice(0,7)>last.slice(0,7))month=last.slice(0,7)+'-01';
    return {days,issues,warnings,selected:chosen,month,first,last,previous:Boolean(month&&first&&month.slice(0,7)>first.slice(0,7)),next:Boolean(month&&last&&month.slice(0,7)<last.slice(0,7))};
  }
  function render(options) {
    const {element,document,sites=[],onChange=()=>{}}=options,value=model(options),state=options.state||{};
    const el=(tag,className,text)=>{const result=document.createElement(tag);if(className)result.className=className;if(text!==undefined)result.textContent=text;return result;};
    const button=(text,title,key,action)=>{const result=el('button','cs-series-calendar-control',text);result.type='button';result.setAttribute('aria-label',title);result.dataset.seriesCalendarFocus=key;result.addEventListener('click',action);return result;};
    element.replaceChildren();if(!value.month)return;
    const title=date(value.month).toLocaleDateString('da-DK',{month:'long',year:'numeric',timeZone:'UTC'}),head=el('div','cs-series-calendar-head');
    const previous=button('‹','Forrige måned','previous',()=>onChange({...state,month:monthStep(value.month,-1),selected:value.selected}));previous.disabled=!value.previous;
    const next=button('›','Næste måned','next',()=>onChange({...state,month:monthStep(value.month,1),selected:value.selected}));next.disabled=!value.next;
    head.append(previous,el('h4',null,title),next);element.append(head);
    const grid=el('div','cs-series-calendar-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','Vagter i '+title);
    ['M','T','O','T','F','L','S'].forEach(day=>grid.append(el('span','cs-series-calendar-weekday',day)));
    const offset=(date(value.month).getUTCDay()+6)%7;for(let index=0;index<offset;index++)grid.append(el('span','cs-series-calendar-blank'));
    for(let day=value.month;day.slice(0,7)===value.month.slice(0,7);day=addDays(day,1)) {
      const entry=value.days.get(day),hasShift=Boolean(entry?.shifts.length),blocked=Boolean(entry?.conflicts.length),pending=Boolean(entry?.pending.length),unavailable=entry?.unavailable===true;
      if(!hasShift&&!blocked&&!pending&&!unavailable){grid.append(el('span','cs-series-calendar-date',String(Number(day.slice(-2)))));continue;}
      const cell=button(String(Number(day.slice(-2))),label(day)+(blocked?' · konflikt':unavailable?' · utilgængelig':pending?' · afventende friønske':' · vagt'),'date-'+day,()=>onChange({...state,month:value.month,selected:day}));
      cell.className='cs-series-calendar-date has-shift'+(blocked?' has-conflict':pending||unavailable?' has-pending':'');cell.setAttribute('aria-pressed',String(value.selected===day));cell.dataset.date=day;grid.append(cell);
    }
    element.append(grid);
    if(value.issues.length||value.warnings.length){
      const notices=el('div','cs-series-calendar-notices');
      if(value.issues.length){const first=value.issues[0].date,issue=button(value.issues.length+(value.issues.length===1?' dato med konflikt':' datoer med konflikter'),'Vis første konflikt','conflicts',()=>onChange({...state,month:first.slice(0,7)+'-01',selected:first}));issue.className='cs-series-calendar-issue-link';notices.append(issue);}
      const unavailable=value.warnings.filter(day=>day.unavailable).length,pending=value.warnings.filter(day=>day.pending.length).length;
      if(unavailable)notices.append(el('p','cs-series-calendar-pending-note',unavailable+(unavailable===1?' dato er markeret utilgængelig':' datoer er markeret utilgængelige')));
      if(pending)notices.append(el('p','cs-series-calendar-pending-note',pending+(pending===1?' dato med afventende friønske':' datoer med afventende friønsker')));
      element.append(notices);
    }
    const selected=value.selected?.slice(0,7)===value.month.slice(0,7) ? value.days.get(value.selected) : null;
    if(selected){
      const detail=el('section','cs-series-date-detail');detail.setAttribute('aria-label','Detaljer for '+label(value.selected));detail.append(el('h5',null,label(value.selected)));
      selected.shifts.forEach(shift=>detail.append(el('p','cs-series-date-shift',shift.start+'–'+shift.end+(shift.end<shift.start?' +1 dag':'')+' · '+(options.personName?.(shift.person)||'')+' · '+(sites[shift.site]?.name||'Arbejdssted')+(shift.plannedBreakMinutes?' · '+shift.plannedBreakMinutes+' min pause':''))));
      const seen=new Set();selected.conflicts.forEach(issue=>{
        const text=issue.type==='leave'?'Godkendt fravær på denne dato.':'Overlap med '+(issue.other?.start||'')+'–'+(issue.other?.end||'')+' hos '+(sites[issue.other?.site]?.name||'et andet arbejdssted')+'.';
        if(!seen.has(text)){seen.add(text);detail.append(el('p','cs-series-date-conflict',text));}
      });
      if(selected.pending.length)detail.append(el('p','cs-series-date-pending','Afventende friønske. Planlægning er mulig, indtil fraværet godkendes.'));
      if(selected.unavailable)detail.append(el('p','cs-series-date-pending','Medarbejderen har markeret sig utilgængelig. Vagten kan stadig planlægges.'));
      if(!selected.conflicts.length&&!selected.pending.length&&!selected.unavailable)detail.append(el('p','cs-series-date-clear',!options.draft.person?'Vælg en medarbejder for at kontrollere tilgængelighed.':options.availabilityStatus==='loading'?'Tjekker tilgængelighed…':['error','unknown'].includes(options.availabilityStatus)?'Tilgængelighed kunne ikke kontrolleres.':'Ingen registrerede konflikter.'));
      element.append(detail);
    }
  }
  const api=Object.freeze({assess,model,render});globalThis.CleanRoomsSeriesCalendar=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
