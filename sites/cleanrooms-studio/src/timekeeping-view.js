/* Time review is a view over server-owned records; drafts never grant approval. */
(() => {
  'use strict';
  const STATUS={running:'I gang',paused:'På pause',submitted:'Afventer godkendelse',approved:'Godkendt',rejected:'Afventer afklaring'};
  const FLAGS={late_start:'Sen start',overtime:'Ekstra arbejdstid',long_break:'Lang pause',missing_end:'Mangler afslutning',corrected:'Rettet registrering',employee_comment:'Kommentar',overlap:'Overlap',dst_transition:'Skift mellem sommer- og vintertid'};
  const OPERATIONS={start:'Vagt startet',pause:'Pause startet',resume:'Vagt genoptaget',finish:'Vagt afsluttet',correct:'Registrering rettet',comment:'Kommentar tilføjet',submit:'Sendt til godkendelse',approve:'Timer godkendt',reopen:'Registrering genåbnet',reject:'Bedt om forklaring'};
  const safeNumber=value=>Number.isFinite(Number(value))?Number(value):0;
  const dateLabel=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',timeZone:'UTC'}):'Dato mangler';
  const stamp=value=>{const valueDate=new Date(value);return Number.isFinite(valueDate.getTime())?valueDate.toLocaleString('da-DK',{dateStyle:'medium',timeStyle:'short'}):'';};
  const minutes=value=>{if(!Number.isFinite(value))return '—';const sign=value<0?'−':'',number=Math.round(Math.abs(value));return sign+Math.floor(number/60)+' t'+(number%60?' '+number%60+' min':'');};
  const differenceLabel=value=>{if(!Number.isFinite(value))return '—';const amount=Math.round(Math.abs(value));return amount<60?amount+' min':Math.floor(amount/60)+' t'+(amount%60?' '+amount%60+' min':'');};
  const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK'}).format(value/100):'—';
  const initials=name=>String(name||'').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]||'').join('').toUpperCase();
  const time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const inferredEndDate=(date,start,end)=>{if(!validDate(date)||!time(start)||!time(end)||end>=start)return date;const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);return next.toISOString().slice(0,10);};
  const daySuffix=(date,endDate)=>{if(!validDate(date)||!validDate(endDate)||date===endDate)return '';const count=Math.round((Date.parse(endDate+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000);return count>0?' · +'+count+(count===1?' dag':' dage'):' · '+dateLabel(endDate);};
  const completePayroll=payroll=>Boolean(payroll&&!payroll.unavailableReason&&Number.isSafeInteger(payroll.totalCents));
  const model=()=>globalThis.CleanRoomsTimekeeping;
  const recordedStartAt=entry=>entry.timingResolved?entry.resolvedStartAt:entry.breakAllocation==='clocked'?entry.clockStartAt:null;
  const recordedEndAt=entry=>entry.timingResolved?entry.resolvedEndAt:entry.breakAllocation==='clocked'?entry.clockEndAt:null;
  const actualDate=(instant,fallback)=>model()?.validInstant?.(instant)?model().localNow(new Date(instant)).date:fallback;
  const uniqueInstant=(date,clock,recorded)=>{if(model()?.validInstant?.(recorded)){const point=model().localNow(new Date(recorded));if(point.date===date&&point.time===clock)return recorded;}const value=model()?.instantForLocal?.(date,clock);return Number.isFinite(value)?new Date(value).toISOString():null;};
  const approvable=entry=>entry?.status==='submitted'&&time(entry.start)&&time(entry.end)&&!entry.flags?.some(flag=>['overlap','dst_transition'].includes(flag))&&Number.isFinite(entry.workedMinutes)&&entry.workedMinutes>0&&typeof model()?.validate==='function'&&model().validate(entry).length===0;
  const QUEUES={attention:'Kræver opmærksomhed',ready:'Følger planen',progress:'I gang',approved:'Godkendte'};
  const REVIEW_REASON={
    missing_end:'Mangler afslutning',
    invalid_worked_time:'Arbejdstid skal kontrolleres',
    shift_missing:'Vagten mangler i planen',
    person_changed:'Medarbejder er ændret',
    date_changed:'Datoen er ændret',
    site_changed:'Arbejdsstedet er ændret',
    plan_invalid:'Vagtplanen skal kontrolleres',
    plan_changed:'Vagten er ændret i planen',
    start_difference:'Afvigende starttid',
    end_difference:'Afvigende sluttid',
    end_date_difference:'Afvigende afslutningsdato',
    pause:'Afvigende pause',
    employee_comment:'Kommentar fra medarbejder',
    corrected:'Rettet registrering',
    payroll_missing:'Løngrundlag mangler',
    rejected:'Afventer afklaring'
  };
  const PERIOD_PROBLEMS={unapproved:'Afventer godkendelse',invalid_time:'Registreringer til rettelse',missing_payroll:'Mangler løngrundlag'};

  function mount({element,onAction,onOpenEmployee,onOpenShift,onRefresh,onDemoEmployee,onPageChange,onFilterChange,onPayrollPeriodAction,onPayrollPeriodChanged,onPayrollPeriodNavigate,onClearPeriodFocus,onCloseFocusedEntry}={}) {
    if(!element?.ownerDocument)throw new TypeError('Timeregistrering kræver et indholdsfelt.');
    const doc=element.ownerDocument,page=doc.createElement('div');page.className='cs-timekeeping-page';element.replaceChildren(page);
    let periodPanel=null;
    let options={},tab='entries',status=null,search='',selectedId=null,selected=new Map(),draft=null,mode=null,pending=false,pagePending=false,disposed=false,message='',error='',conflict=false,viewScope='real',demoWasActive=false,bulkConfirm=null,rangeKey='',reviewOptions=null,reviewScope=null,reviewCache=new WeakMap(),shiftIndex=new Map(),reviewToday,listScroll=0,detailSections=new Set();
    const PAGE_SIZE=50,pages={entries:0,week:0,payroll:0};
    let personSource,plannedPersonSource,personIndex=new Map(),serverViewKey='',queueBeforePayroll='all',periodFocusKey='',openedFocusKey='';
    const node=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
    const differenceNode=(value,{unavailable='Kan ikke sammenlignes',reasons=[]}={})=>{
      const el=node('span','cs-time-delta'),known=Number.isFinite(value),amount=known?Math.round(Math.abs(value)):null,direction=!known?'unknown':!amount?'equal':value>0?'more':'less';
      const description=!known?unavailable:!amount?'Ingen forskel i samlet arbejdstid':differenceLabel(value)+(value>0?' mere end planlagt':' mindre end planlagt');
      el.dataset.direction=direction;el.title=[description,...reasons.map(reason=>reason.label)].filter(Boolean).join('. ');
      if(direction==='more'||direction==='less'){const arrow=node('span','cs-time-delta-arrow',direction==='more'?'↑':'↓');arrow.setAttribute('aria-hidden','true');el.append(arrow);}
      const quantity=node('strong','cs-time-delta-value',differenceLabel(value));quantity.setAttribute('aria-hidden','true');el.append(quantity,node('span','cs-time-delta-description',description));return el;
    };
    const button=(label,action,cls='cs-button',key)=>{const el=node('button',cls,label);el.type='button';el.disabled=blocked();if(key)el.dataset.timeFocus=key;el.addEventListener('click',event=>{if(!disposed&&!el.disabled)return action(event.currentTarget||el);});return el;};
    const serverPaged=()=>options.pagination?.server===true;
    const blocked=()=>pending||pagePending||options.loading===true||options.pagination?.loading===true;
    const entries=()=>Array.isArray(options.entries)?options.entries:[];
    const scopedEntries=()=>entries().filter(entry=>(entry.demo===true)===(viewScope==='demo'));
    const scopeShifts=()=>Array.isArray(options.shifts)?options.shifts.filter(shift=>(shift.demo===true)===(viewScope==='demo')):[];
    function person(id){
      if(personSource!==options.people||plannedPersonSource!==options.plannedRows){personSource=options.people;plannedPersonSource=options.plannedRows;personIndex=new Map();for(const item of options.plannedRows||[])personIndex.set(item.personId||item.id,item);for(const item of options.people||[])personIndex.set(item.id||item.personId,item);}
      return personIndex.get(id)||{name:'Medarbejder',personId:id};
    }
    const siteLabel=index=>options.sites?.[index]?.name||'Arbejdssted';
    const nameFor=entry=>entry.personName||person(entry.personId).name||'Medarbejder';
    function statusNode(entry,result){
      let label=STATUS[entry.status]||'Ikke registreret';
      if(result?.bucket==='ready')label='Klar til godkendelse';
      else if(result?.bucket==='attention'&&entry.status==='submitted')label='Skal gennemgås';
      const el=node('span','cs-time-status',label);
      el.dataset.state=entry.status;
      if(result)el.dataset.review=result.bucket;
      return el;
    }
    const field=(name,label,type,value)=>{const holder=node('label','cs-time-field'),input=node(type==='textarea'?'textarea':'input','cs-time-input');if(type!=='textarea')input.type=type;else input.rows=3;input.dataset.timeFocus='field:'+name;input.value=value??'';input.disabled=blocked();holder.append(node('span','cs-time-label',label),input);return {holder,input};};
    function ensureReviews(){
      if(reviewOptions===options&&reviewScope===viewScope)return;
      reviewOptions=options;reviewScope=viewScope;reviewCache=new WeakMap();shiftIndex=new Map(scopeShifts().map(shift=>[shift.id,shift]));
      reviewToday=viewScope==='demo'?(options.demo?.demoClockDate||options.demo?.clockDate):options.today;
      if(!reviewToday&&model()?.localNow)reviewToday=model().localNow(options.serverNow?new Date(options.serverNow):new Date()).date;
    }
    function review(entry){
      ensureReviews();
      if(reviewCache.has(entry))return reviewCache.get(entry);
      const supplied=serverPaged()&&Object.hasOwn(QUEUES,entry.review?.bucket)&&Array.isArray(entry.review.reasons)?entry.review:null;
      const result=supplied||model()?.review?.(entry,{shift:shiftIndex.get(entry.shiftId),canViewPayroll:options.canViewPayroll===true,today:reviewToday})||{bucket:entry.status==='approved'?'approved':'attention',priority:1,reasons:[{code:'review_unavailable',label:'Registreringen skal gennemgås'}]};
      reviewCache.set(entry,result);return result;
    }
    function plannedFacts(entry){
      ensureReviews();const current=entry.status==='approved'?null:shiftIndex.get(entry.shiftId),start=current?.start||entry.plannedStart,end=current?.end||entry.plannedEnd;
      const planned={start,end,plannedBreakMinutes:(current||entry).plannedBreakMinutes},pause=model()?.plannedBreak?.(planned)??(planned.plannedBreakMinutes===undefined?0:Number.isSafeInteger(planned.plannedBreakMinutes)&&planned.plannedBreakMinutes>=0?planned.plannedBreakMinutes:null);
      const begin=model()?.minute?.(start),finish=model()?.minute?.(end);let duration=null;
      if(typeof model()?.plannedMinutes==='function')duration=model().plannedMinutes(planned);
      else if(Number.isFinite(begin)&&Number.isFinite(finish)){const gross=finish>begin?finish-begin:finish<begin?finish+1440-begin:0;duration=pause!==null&&pause<gross?gross-pause:null;}
      return {start,end,breakMinutes:pause,minutes:duration};
    }
    function matchingEntries(){
      const query=search.trim().toLocaleLowerCase('da-DK');
      return scopedEntries().filter(entry=>!query||[nameFor(entry),siteLabel(entry.site),entry.date,dateLabel(entry.date)].join(' ').toLocaleLowerCase('da-DK').includes(query));
    }
    function filteredEntries(matching=matchingEntries()){
      return matching.filter(entry=>{const result=review(entry);return status==='all'||status==='issues'&&result.bucket==='attention'||status==='unfinished'&&!entry.end||status==='submitted'&&entry.status==='submitted'||status==='rejected'&&entry.status==='rejected'||result.bucket===status;}).sort((a,b)=>(status==='attention'||status==='issues'?(review(b).priority||0)-(review(a).priority||0):0)||String(a.date).localeCompare(String(b.date))||nameFor(a).localeCompare(nameFor(b),'da-DK')||String(a.id).localeCompare(String(b.id)));
    }
    function filterChanged(){if(serverPaged()&&typeof onFilterChange==='function')onFilterChange({queue:status||'all',search,scope:viewScope});}
    function changeFilter(value,focus){status=value;pages.entries=0;selected.clear();bulkConfirm=null;selectedId=null;clearDraft();message='';error='';const body=page.querySelector('.cs-timekeeping-body');if(body)body.scrollTop=0;paint(focus);filterChanged();}
    function currentEntry(){return entries().find(item=>String(item.id)===String(selectedId));}
    function clearDraft(){draft=null;mode=null;conflict=false;}
    function openEntry(entry){listScroll=page.querySelector('.cs-timekeeping-body')?.scrollTop||0;selectedId=entry.id;detailSections.clear();clearDraft();error='';paint('detail:close');const body=page.querySelector('.cs-timekeeping-body');if(body)body.scrollTop=0;}
    function closeEntry(entry){const focused=periodFocus();selectedId=null;detailSections.clear();clearDraft();paint('entry:'+entry.id);const body=page.querySelector('.cs-timekeeping-body');if(body)body.scrollTop=listScroll;if(focused&&String(options.requestedEntryId)===String(entry.id)&&typeof onCloseFocusedEntry==='function')return onCloseFocusedEntry(entry.id);}
    function periodFocus(){
      const focus=options.periodFocus;
      if(!focus||!options.canViewPayroll||viewScope!=='real'||focus.problem!=null&&!Object.hasOwn(PERIOD_PROBLEMS,focus.problem)||!/^\d{4}-\d{2}-\d{2}$/.test(focus.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(focus.to||'')||focus.to<focus.from||focus.from!==options.from||focus.to!==options.to)return null;
      return focus;
    }
    function paintPeriodFocus(){
      const focus=periodFocus();if(!focus)return;
      const strip=node('div','cs-time-period-focus'),context=node('div','cs-time-period-focus-context');strip.setAttribute('role','region');strip.setAttribute('aria-label','Fra lønperioden');
      const range=new Date(focus.from+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})+' – '+new Date(focus.to+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
      context.append(node('strong','',PERIOD_PROBLEMS[focus.problem]||'Lønperiode'),node('span','cs-time-caption',range));
      if(focus.problem==='missing_payroll')context.append(node('span','cs-time-period-focus-hint','Ret lønaftalen, og genåbn og godkend registreringen igen.'));
      strip.append(context);if(typeof onClearPeriodFocus==='function')strip.append(button('Vis alle timer',()=>onClearPeriodFocus(),'cs-button cs-quiet','period:clear'));page.append(strip);
    }
    async function refresh(){if(blocked()||typeof onRefresh!=='function')return;pending=true;error='';paint();try{await onRefresh();}catch(problem){error=problem?.message||'Registreringerne kunne ikke hentes.';}finally{pending=false;paint();}}
    async function invoke(action,payload,success){
      if(blocked()||typeof onAction!=='function')return false;pending=true;error='';message='';paint();
      try{
        const result=await onAction(action,payload);
        if(disposed)return false;
        if(!result||result.ok===false){error=result?.message||result?.error||'Ændringen kunne ikke gemmes.';conflict=result?.status===409;return false;}
        if(result?.entry){options={...options,entries:entries().map(item=>item.id===result.entry.id?result.entry:item)};}
        if(typeof onRefresh==='function')await onRefresh();
        clearDraft();message=success||'Ændringen er gemt.';return true;
      }catch(problem){if(!disposed)error=problem?.message||'Ændringen kunne ikke gemmes.';return false;}
      finally{pending=false;if(!disposed)paint();}
    }
    const writePayload=(entry,operation,extra={})=>({operation,entryId:entry.id,version:entry.version,shiftId:entry.shiftId,personId:entry.personId,...(entry.demo===true?{demo:true}:{}),...extra});
    async function approve(entry){if(!options.canManage||!approvable(entry))return;await invoke('timeWrite',writePayload(entry,'approve'),'Timerne er godkendt. Løngrundlaget er gemt på registreringen.');}
    function prepareApproval(onlyIfMatchesPlan=false){
      if(blocked()||!options.canManage)return;
      const filtered=filteredEntries(),visible=serverPaged()?pageRows(filtered,'entries'):filtered,candidates=onlyIfMatchesPlan?visible.filter(entry=>approvable(entry)&&review(entry).bucket==='ready'):visible.filter(entry=>approvable(entry)&&selected.get(entry.id)===entry.version);
      if(!candidates.length)return;
      bulkConfirm={items:candidates.map(entry=>({id:entry.id,version:entry.version})),onlyIfMatchesPlan,scope:viewScope,filter:status,query:search,attention:candidates.filter(entry=>review(entry).bucket==='attention').length,total:candidates.reduce((sum,entry)=>sum+safeNumber(entry.workedMinutes),0)};
      selectedId=null;clearDraft();error='';message='';paint('bulk:confirm');
    }
    async function approveSelected(){
      if(blocked()||!options.canManage||!bulkConfirm?.items.length||typeof onAction!=='function')return;
      const batch=bulkConfirm;
      if(batch.scope!==viewScope||batch.filter!==status||batch.query!==search){bulkConfirm=null;error='Filtrene er ændret. Gennemgå udvalget igen.';paint();return;}
      pending=true;error='';message='';paint();let count=0;
      try{
        for(const captured of batch.items){
          if(disposed||options.canManage!==true||batch.scope!==viewScope){error='Adgangen eller visningen er ændret. De resterende registreringer er ikke godkendt.';break;}
          const entry=scopedEntries().find(item=>item.id===captured.id);
          if(!entry||entry.version!==captured.version||!approvable(entry)||(batch.onlyIfMatchesPlan&&review(entry).bucket!=='ready')){error='En registrering er ændret siden dit valg. De resterende registreringer er ikke godkendt. Gennemgå listen igen.';conflict=true;break;}
          const result=await onAction('timeWrite',writePayload(entry,'approve',{version:captured.version,...(batch.onlyIfMatchesPlan?{onlyIfMatchesPlan:true}:{})}));
          if(disposed)return;
          if(!result||result.ok===false){error=result?.message||result?.error||'En registrering kunne ikke godkendes. De resterende registreringer er bevaret.';conflict=result?.status===409;break;}
          if(result?.entry)options={...options,entries:entries().map(item=>item.id===result.entry.id?result.entry:item)};
          selected.delete(captured.id);count++;
        }
        message=count+' af '+batch.items.length+(batch.items.length===1?' registrering er godkendt.':' registreringer er godkendt.');
      }catch(problem){error=problem?.message||'Godkendelsen blev afbrudt. Hent den seneste liste.';message=count+' af '+batch.items.length+(batch.items.length===1?' registrering er godkendt.':' registreringer er godkendt.');}
      finally{bulkConfirm=null;try{if(!disposed&&typeof onRefresh==='function')await onRefresh();}catch(problem){error=error||problem?.message||'Hent listen igen for at se den seneste status.';}pending=false;if(!disposed)paint('filter:status');}
    }
    function edit(entry,kind){if(!options.canManage||blocked())return;mode=kind;conflict=false;error='';const start=entry.start||entry.plannedStart||'',end=entry.end||'',startDate=actualDate(recordedStartAt(entry),entry.date),inferred=inferredEndDate(startDate,start,end);draft={version:entry.version,start,end,startDate,preciseStart:startDate!==entry.date,endDate:entry.end&&entry.endDate||inferred,endDateExplicit:Boolean(entry.end&&entry.endDate&&entry.endDate!==inferred),breakMinutes:entry.breakMinutes??0,reason:'',resolveDST:entry.flags?.includes('dst_transition')===true,actualStartAt:entry.resolvedStartAt||entry.clockStartAt||'',actualEndAt:entry.resolvedEndAt||entry.clockEndAt||''};paint('field:'+(kind==='reopen'||kind==='reject'?'reason':'start'));page.querySelector?.('.cs-time-form')?.scrollIntoView?.({block:'nearest',inline:'nearest'});}
    async function saveDraft(){
      const entry=currentEntry();if(!entry||!draft||blocked()||!options.canManage)return;
      if(entry.version!==draft.version){conflict=true;error='Registreringen er ændret. Luk redigeringen og hent den seneste version.';paint();return;}
      if(!draft.reason.trim()){error='Skriv en begrundelse, så ændringen kan spores.';paint('field:reason');return;}
      if(mode==='reject'){await invoke('timeWrite',writePayload(entry,'reject',{reason:draft.reason.trim()}),'Medarbejderen er bedt om at supplere sin forklaring.');return;}
      if(mode==='reopen'){await invoke('timeWrite',writePayload(entry,'reopen',{reason:draft.reason.trim()}),'Godkendelsen er ophævet. Registreringen skal godkendes igen.');return;}
      if(!time(draft.start)||!time(draft.end)){error='Angiv en gyldig start- og sluttid.';paint();return;}
      const pause=Number(draft.breakMinutes);if(!Number.isSafeInteger(pause)||pause<0||pause>1440){error='Angiv pausen som et helt antal minutter.';paint('field:break');return;}
      if(draft.resolveDST&&(!model()?.validInstant?.(draft.actualStartAt)||!model()?.validInstant?.(draft.actualEndAt))){error='Angiv start og slut som entydige UTC-tidspunkter, fx 2026-10-25T00:30:00.000Z.';paint('field:actual-start');return;}
      let precise=draft.resolveDST?{actualStartAt:draft.actualStartAt,actualEndAt:draft.actualEndAt}:{};
      if(draft.preciseStart&&!draft.resolveDST){
        if(!validDate(draft.startDate)||!validDate(draft.endDate)){error='Angiv gyldige start- og afslutningsdatoer.';paint('field:start-date');return;}
        const actualStartAt=uniqueInstant(draft.startDate,draft.start,recordedStartAt(entry)),actualEndAt=uniqueInstant(draft.endDate,draft.end,recordedEndAt(entry));
        if(!actualStartAt||!actualEndAt){draft.resolveDST=true;error='Tidspunktet ligger ved et skift mellem sommer- og vintertid. Kontrollér de præcise UTC-tidspunkter.';paint('field:actual-start');return;}
        precise={actualStartAt,actualEndAt};
      }
      await invoke('timeWrite',writePayload(entry,'correct',{date:entry.date,start:draft.start,end:draft.end,endDate:draft.endDate,breakMinutes:pause,reason:draft.reason.trim(),...precise}),'Registreringen er rettet og sendt til godkendelse.');
    }
    function paint(requestedFocus){
      if(disposed)return;
      const active=doc.activeElement,focus=requestedFocus||(element.contains?.(active)?active?.dataset?.timeFocus:null),oldScroll=page.querySelector?.('.cs-timekeeping-body')?.scrollTop||0;
      const searchSelection=active?.dataset?.timeFocus==='field:search'&&Number.isInteger(active.selectionStart)?[active.selectionStart,active.selectionEnd]:null;
      page.replaceChildren();page.setAttribute('aria-busy',String(blocked()));
      if(!options.canViewPayroll&&tab==='payroll')tab='entries';
      const demo=options.demo||{};let demoBar=null;
      if(demo.active){
        demoBar=node('div','cs-time-demo-banner');demoBar.setAttribute('aria-label','Eksempelvisning');
        demoBar.append(node('span','',viewScope==='demo'?'Eksempeluge · '+dateLabel(demo.from)+' – '+dateLabel(demo.to):'Almindelige registreringer'));
        const demoActions=node('div','cs-time-actions');demoActions.append(button(viewScope==='demo'?'Vis almindelige timer':'Vis eksempelugen',()=>{viewScope=viewScope==='demo'?'real':'demo';status=serverPaged()?'all':null;pages.entries=pages.week=pages.payroll=0;selected.clear();bulkConfirm=null;selectedId=null;clearDraft();message='';error='';chooseDefaultQueue();paint();filterChanged();},'cs-button cs-quiet cs-chrome-quiet','demo:scope'));
        if(viewScope==='demo'&&typeof onDemoEmployee==='function')demoActions.append(button('Prøv Mine vagter',()=>onDemoEmployee(demo.personId),'cs-button cs-quiet cs-chrome-quiet','demo:employee'));
        demoBar.append(demoActions);
      }
      const tabs=node('div','cs-time-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Timer og løngrundlag');
      for(const [value,label] of [['entries','Registreringer'],['week','Ugens overblik'],...(options.canViewPayroll?[['payroll','Løngrundlag']]:[])]){
        const control=button(label,()=>{const previous=tab;tab=value;selectedId=null;bulkConfirm=null;selected.clear();clearDraft();const body=page.querySelector('.cs-timekeeping-body');if(body)body.scrollTop=0;if(serverPaged()&&value==='payroll'&&previous!=='payroll'){queueBeforePayroll=status||'all';status='approved';paint('tab:'+value);filterChanged();}else if(serverPaged()&&previous==='payroll'&&value!=='payroll'){status=queueBeforePayroll;paint('tab:'+value);filterChanged();}else paint('tab:'+value);},'cs-time-tab','tab:'+value);control.setAttribute('role','tab');control.setAttribute('aria-selected',String(tab===value));tabs.append(control);
      }
      const navigation=node('div','cs-time-navigation');navigation.append(tabs);if(demoBar)navigation.append(demoBar);page.append(navigation);
      paintPeriodFocus();
      if(message){const statusBox=node('p','cs-time-message',message);statusBox.setAttribute('role','status');page.append(statusBox);}
      if(error||options.error||options.pagination?.error){const errorBox=node('div','cs-time-error');errorBox.setAttribute('role','alert');errorBox.append(node('p','',error||options.error||options.pagination.error));if(!blocked())errorBox.append(button('Hent registreringer igen',refresh,'cs-button','reload:error'));page.append(errorBox);}
      const body=node('div','cs-timekeeping-body');body.dataset.timeTab=tab;body.setAttribute('role','tabpanel');body.setAttribute('aria-label',tab==='week'?'Ugens overblik':tab==='payroll'?'Løngrundlag':'Registreringer');
      if(options.loading){const loading=node('p','cs-time-empty','Henter tidsregistreringer…');loading.setAttribute('role','status');body.append(loading);}
      else if(tab==='week')paintWeek(body);
      else if(tab==='payroll'&&options.canViewPayroll)paintPayroll(body);
      else paintEntries(body);
      page.append(body);body.scrollTop=oldScroll;
      if(focus){
        const target=[...page.querySelectorAll('[data-time-focus]')].find(el=>el.dataset.timeFocus===focus);
        target?.focus?.({preventScroll:true});
        if(focus==='field:search'&&searchSelection)target?.setSelectionRange?.(...searchSelection);
      }
    }
    function metricStrip(items){const strip=node('dl','cs-time-metrics');for(const [label,value,detail] of items){const item=node('div');item.append(node('dt','',label),node('dd','',value));if(detail)item.append(node('span','cs-time-caption',detail));strip.append(item);}return strip;}
    function pageRows(items,key){if(serverPaged()&&key!=='week')return items.slice(0,PAGE_SIZE);pages[key]=Math.min(pages[key],Math.max(0,Math.ceil(items.length/PAGE_SIZE)-1));return items.slice(pages[key]*PAGE_SIZE,(pages[key]+1)*PAGE_SIZE);}
    async function changeServerPage(direction,key='entries'){
      if(blocked()||typeof onPageChange!=='function')return;selected.clear();bulkConfirm=null;selectedId=null;clearDraft();error='';message='';pagePending=true;paint();
      try{const result=await onPageChange(direction);if(result?.ok===false)error=result.message||'Registreringerne kunne ikke hentes.';}catch(problem){error=problem?.message||'Registreringerne kunne ikke hentes.';}
      finally{pagePending=false;if(!disposed){const body=page.querySelector('.cs-timekeeping-body');if(body)body.scrollTop=0;paint('page:'+key+':'+direction);}}
    }
    function pagination(count,key){
      if(serverPaged()&&key!=='week'){
        const state=options.pagination,index=Math.max(0,Number.isSafeInteger(state.page)?state.page:0),hasPrevious=state.hasPrevious===true,hasNext=state.hasNext===true;
        if(!hasPrevious&&!hasNext&&!index)return null;
        const nav=node('nav','cs-time-pagination cs-time-actions');nav.setAttribute('aria-label','Sider i '+(key==='payroll'?'løngrundlaget':'tidsregistreringer'));
        const knownTotal=Number.isSafeInteger(state.totalCount)&&state.totalCount>=0?state.totalCount:null,start=Number.isSafeInteger(state.offset)&&state.offset>=0?state.offset:index*PAGE_SIZE,range=node('span','cs-time-caption',(count?start+1+'–'+(start+Math.min(PAGE_SIZE,count)):'Ingen')+(knownTotal===null?'':' af '+knownTotal));range.setAttribute('role','status');
        const previous=button('Forrige',()=>changeServerPage('previous',key),'cs-button cs-quiet','page:'+key+':previous'),next=button('Næste',()=>changeServerPage('next',key),'cs-button cs-quiet','page:'+key+':next');previous.disabled=blocked()||!hasPrevious;next.disabled=blocked()||!hasNext;nav.append(range,previous,next);return nav;
      }
      if(count<=PAGE_SIZE)return null;
      const nav=node('nav','cs-time-pagination cs-time-actions');nav.setAttribute('aria-label','Sider i '+(key==='week'?'ugens overblik':key==='payroll'?'løngrundlaget':'tidsregistreringer'));
      const start=pages[key]*PAGE_SIZE,change=(direction,focus)=>{pages[key]+=direction;const body=page.querySelector('.cs-timekeeping-body');if(body)body.scrollTop=0;paint(focus);};
      const previous=button('Forrige',()=>change(-1,'page:'+key+':previous'),'cs-button cs-quiet','page:'+key+':previous'),next=button('Næste',()=>change(1,'page:'+key+':next'),'cs-button cs-quiet','page:'+key+':next');previous.disabled=blocked()||pages[key]===0;next.disabled=blocked()||start+PAGE_SIZE>=count;
      const range=node('span','cs-time-caption',start+1+'–'+Math.min(start+PAGE_SIZE,count)+' af '+count);range.setAttribute('role','status');nav.append(range,previous,next);return nav;
    }
    function chooseDefaultQueue(){
      if(status!==null||options.loading)return;
      if(serverPaged()){status=options.serverFilter?.queue||'all';return;}
      const all=scopedEntries();status=all.some(entry=>review(entry).bucket==='attention')?'attention':all.some(entry=>review(entry).bucket==='ready')?'ready':'all';
    }
    function serverSummary(){
      if(!serverPaged()||!options.summary||options.summary.stale===true)return null;
      const filter=options.serverFilter;if(filter&&((filter.search||'')!==search||(filter.scope||'real')!==viewScope))return null;
      return options.summary;
    }
    function paintReviewToolbar(body,all,counts){
      const summaryData=serverSummary();
      const filters=node('div','cs-time-review-summary');
      filters.setAttribute('role','group');
      filters.setAttribute('aria-label','Filtrér tidsregistreringer efter status');
      for(const [key,label] of [['all','Alle'],...Object.entries(QUEUES)]){
        const onPage=key==='all'?all.length:counts[key];
        const authoritative=summaryData?.counts?.[key];
        const total=Number.isSafeInteger(authoritative)?authoritative:serverPaged()?(onPage?onPage+'+':'—'):onPage;
        const focus=key==='all'?'filter:status':'queue:'+key;
        const control=button('',()=>changeFilter(key,focus),'cs-time-review-queue',focus);
        control.dataset.bucket=key;
        control.dataset.empty=String(total===0);
        control.setAttribute('aria-pressed',String(status===key));
        control.setAttribute('aria-label',label+' · '+total);
        control.append(node('span','cs-time-review-title',label),node('strong','cs-time-review-count',total));
        filters.append(control);
      }
      const toolbar=node('div','cs-time-review-toolbar');
      const tools=node('div','cs-time-tools');
      const searchField=field('search','Søg i registreringer','search',search);
      searchField.holder.classList.add('cs-time-search');
      searchField.input.placeholder='Søg medarbejder, arbejdssted eller dato…';
      searchField.input.maxLength=120;
      searchField.input.addEventListener('input',()=>{
        search=searchField.input.value;
        pages.entries=0;
        selected.clear();
        bulkConfirm=null;
        selectedId=null;
        clearDraft();
        paint('field:search');
        filterChanged();
      });
      tools.append(searchField.holder,button('Opdater',refresh,'cs-button cs-quiet','reload'));
      toolbar.append(filters,tools);
      body.append(toolbar);
    }
    function paintApproval(main,ready){
      if(!options.canManage)return;
      if(bulkConfirm){
        const count=bulkConfirm.items.length;
        const confirmation=node('section','cs-time-bulk-confirm');
        confirmation.setAttribute('aria-label','Bekræft samlet godkendelse');
        const scope=bulkConfirm.onlyIfMatchesPlan
          ? (serverPaged()?'Kun de viste registreringer, der følger planen.':'Alle registreringer med de valgte filtre, der følger planen.')
          : 'Kun de registreringer, du har valgt.';
        confirmation.append(
          node('strong','',count+(count===1?' registrering · ':' registreringer · ')+minutes(bulkConfirm.total)),
          node('p','cs-time-caption',scope+' Timerne låses ved godkendelse.'+(bulkConfirm.scope==='demo'?' Eksempeluge.':''))
        );
        if(!bulkConfirm.onlyIfMatchesPlan&&bulkConfirm.attention){
          confirmation.append(node('p','cs-time-bulk-warning',bulkConfirm.attention+' af de valgte registreringer har afvigelser. Kontrollér dem før godkendelse.'));
        }
        const actions=node('div','cs-time-actions');
        actions.append(
          button('Annuller',()=>{
            const returnFocus=bulkConfirm.onlyIfMatchesPlan?'bulk:ready':'bulk:approve';
            bulkConfirm=null;
            paint(returnFocus);
          },'cs-button','bulk:cancel'),
          button('Godkend '+count+(count===1?' registrering':' registreringer'),approveSelected,'cs-button cs-primary','bulk:confirm')
        );
        confirmation.append(actions);
        main.append(confirmation);
        return;
      }
      if(!selected.size&&!ready.length)return;
      const bar=node('div','cs-time-approval-bar');
      const actions=node('div','cs-time-actions');
      if(selected.size){
        bar.append(node('strong','',selected.size+(selected.size===1?' registrering valgt':' registreringer valgt')));
        actions.append(
          button('Ryd valg',()=>{selected.clear();paint('filter:status');},'cs-button cs-quiet','bulk:clear'),
          button('Godkend '+selected.size+(selected.size===1?' valgt':' valgte'),()=>prepareApproval(false),'cs-button cs-primary','bulk:approve')
        );
      }else{
        const total=ready.reduce((sum,entry)=>sum+safeNumber(entry.workedMinutes),0);
        const label=ready.length+' følger planen · '+minutes(total)+(serverPaged()?' på denne side':'');
        bar.append(node('strong','',label));
        actions.append(button('Godkend '+ready.length+' der følger planen',()=>prepareApproval(true),'cs-button cs-primary','bulk:ready'));
      }
      bar.append(actions);
      main.append(bar);
    }
    function paintEntryTable(main,shown){
      const eligible=options.canManage?shown.filter(approvable):[];
      const columns=[
        ...(eligible.length?[['','selection']]:[]),
        ['Medarbejder','person'],['Tider','times'],['Arbejdstid','duration'],['Status','status'],['','action']
      ];
      const {table,rows}=makeTable(columns.map(([label])=>label));
      table.classList.add('cs-time-entries-table');
      table.querySelectorAll('th').forEach((head,index)=>head.classList.add('cs-time-col-'+columns[index][1]));
      if(eligible.length){
        const check=node('input');
        check.type='checkbox';
        check.checked=eligible.every(entry=>selected.get(entry.id)===entry.version);
        check.indeterminate=!check.checked&&eligible.some(entry=>selected.has(entry.id));
        check.disabled=blocked();
        check.dataset.timeFocus='select:all';
        check.setAttribute('aria-label','Vælg alle viste registreringer, der kan godkendes');
        check.addEventListener('change',()=>{
          for(const entry of eligible){
            if(check.checked)selected.set(entry.id,entry.version);
            else selected.delete(entry.id);
          }
          bulkConfirm=null;
          paint('select:all');
        });
        table.querySelector('th').append(check);
      }
      const selectable=new Set(eligible);
      for(const entry of shown){
        const result=review(entry);
        const row=node('tr');
        row.dataset.entryId=String(entry.id);
        row.dataset.selected=String(selected.get(entry.id)===entry.version);
        row.dataset.review=result.bucket;
        if(eligible.length){
          const selection=node('td','cs-time-selection-cell');
          if(selectable.has(entry)){
            const check=node('input');
            check.type='checkbox';
            check.checked=selected.get(entry.id)===entry.version;
            check.disabled=blocked();
            check.setAttribute('aria-label','Vælg registreringen for '+nameFor(entry)+' '+dateLabel(entry.date));
            check.dataset.timeFocus='select:'+entry.id;
            check.addEventListener('change',()=>{
              if(check.checked)selected.set(entry.id,entry.version);
              else selected.delete(entry.id);
              bulkConfirm=null;
              paint('select:'+entry.id);
            });
            selection.append(check);
          }
          row.append(selection);
        }
        const identity=node('td','cs-time-person-cell');
        const identityButton=button('',()=>openEntry(entry),'cs-time-person','entry:'+entry.id);
        identityButton.setAttribute('aria-label','Åbn registrering for '+nameFor(entry)+' '+dateLabel(entry.date));
        const avatar=node('span','cs-time-avatar',person(entry.personId).initials||initials(nameFor(entry)));
        avatar.setAttribute('aria-hidden','true');
        const copy=node('span','cs-time-person-copy');
        copy.append(node('strong','',nameFor(entry)),node('span','cs-time-caption',dateLabel(entry.date)+' · '+siteLabel(entry.site)));
        identityButton.append(avatar,copy);
        identity.append(identityButton);

        const planned=plannedFacts(entry);
        const times=node('td','cs-time-number cs-time-shift-times');
        times.dataset.label='Tider';
        const actualRange=entry.start?entry.start+'–'+(entry.end||'…')+(entry.end?daySuffix(entry.date,entry.endDate):''):'Ikke registreret';
        const plannedRange=planned.start&&planned.end
          ? planned.start+'–'+planned.end+daySuffix(entry.date,inferredEndDate(entry.date,planned.start,planned.end))
          : '—';
        times.append(node('strong','cs-time-actual-range',actualRange),node('span','cs-time-caption cs-time-planned-range','Planlagt '+plannedRange));

        const duration=node('td','cs-time-number cs-time-work-duration');
        duration.dataset.label='Arbejdstid';
        const net=node('div','cs-time-work-net');
        const delta=entry.end&&Number.isFinite(planned.minutes)?entry.workedMinutes-planned.minutes:NaN;
        net.append(
          node('strong','cs-time-net-time',entry.end?minutes(entry.workedMinutes):'—'),
          differenceNode(delta,{unavailable:entry.end?'Kan ikke sammenlignes':entry.start?'Afventer afslutning':'Ikke registreret',reasons:result.reasons||[]})
        );
        duration.append(net,node('span','cs-time-caption cs-time-pause-value',safeNumber(entry.breakMinutes)+' min pause'));

        const state=node('td','cs-time-state-cell');
        state.dataset.label='Status';
        state.append(statusNode(entry,result));
        const reason=result.reasons?.[0];
        if(result.bucket==='attention'&&reason&&reason.code!=='rejected'){
          const label=Object.hasOwn(REVIEW_REASON,reason.code)?REVIEW_REASON[reason.code]:Object.hasOwn(FLAGS,reason.code)?FLAGS[reason.code]:reason.label;
          const caption=node('span','cs-time-review-reason',label);
          caption.title=reason.label;
          state.append(caption);
        }
        const action=node('td','cs-time-row-action');
        const label=result.bucket==='attention'?'Gennemgå':result.bucket==='ready'&&options.canManage?'Se og godkend':'Se timer';
        action.append(button(label,()=>openEntry(entry),'cs-button','inspect:'+entry.id));
        row.append(identity,times,duration,state,action);
        rows.append(row);
      }
      main.append(table);
    }
    function paintEntries(body){
      const opened=currentEntry();
      if(opened){body.append(inspector(opened));return;}
      chooseDefaultQueue();
      const all=matchingEntries(),counts={attention:0,ready:0,progress:0,approved:0};
      for(const entry of all)counts[review(entry).bucket]++;
      paintReviewToolbar(body,all,counts);
      const visible=filteredEntries(all),shown=pageRows(visible,'entries');
      const ready=(serverPaged()?shown:visible).filter(entry=>approvable(entry)&&review(entry).bucket==='ready');
      const main=node('section','cs-time-directory');
      main.setAttribute('aria-label','Tidsregistreringer');
      paintApproval(main,ready);
      if(shown.length)paintEntryTable(main,shown);
      else{
        const summary=serverSummary();
        const total=summary?.counts?.all;
        let empty='Der er endnu ingen registrerede timer i perioden.';
        if(search.trim())empty='Ingen registreringer matcher din søgning.';
        else if(status==='attention')empty='Ingen registreringer kræver opmærksomhed.';
        else if(status==='ready')empty='Ingen registreringer er klar til samlet godkendelse.';
        else if(status==='progress')empty='Ingen vagter er i gang.';
        else if(status==='approved')empty='Ingen registreringer er godkendt.';
        else if(all.length||total>0)empty='Ingen registreringer på denne side.';
        main.append(node('p','cs-time-empty',empty));
      }
      const pager=pagination(visible.length,'entries');
      if(pager)main.append(pager);
      body.append(main);
    }
    function makeTable(labels){const table=node('table','cs-time-table'),head=node('thead'),line=node('tr'),rows=node('tbody');labels.forEach(label=>{const th=node('th','',label);th.scope='col';line.append(th);});head.append(line);table.append(head,rows);return {table,rows};}
    function paintWeek(body){
      const rows=Array.isArray(options.plannedRows)?options.plannedRows:[],totals=new Map();
      for(const entry of scopedEntries()){const value=totals.get(entry.personId)||{registered:0,approved:0,planned:0};value.registered+=safeNumber(entry.workedMinutes);if(entry.status==='approved')value.approved+=safeNumber(entry.workedMinutes);value.planned+=safeNumber(entry.plannedMinutes);totals.set(entry.personId,value);}
      const aggregate=serverSummary(),aggregatePeople=aggregate?.people||aggregate?.byPerson;
      if(Array.isArray(aggregatePeople)){totals.clear();for(const item of aggregatePeople)totals.set(item.personId,{registered:safeNumber(item.registeredMinutes),approved:safeNumber(item.approvedMinutes),planned:0});}
      const completeDemoPlan=viewScope==='demo'&&Array.isArray(options.plannedRows);
      let people=completeDemoPlan||rows.length?rows:(options.people||[]).map(item=>({personId:item.id||item.personId,...item}));
      if(serverPaged()&&search.trim()){const query=search.trim().toLocaleLowerCase('da-DK');people=people.filter(item=>totals.has(item.personId||item.id)||String(item.name||'').toLocaleLowerCase('da-DK').includes(query));}
      if(viewScope==='demo'&&!completeDemoPlan){
        const planned=new Map();for(const shift of scopeShifts()){const id=shift.personId||shift.person,start=String(shift.start||'').split(':').map(Number),end=String(shift.end||'').split(':').map(Number);let duration=end[0]*60+end[1]-start[0]*60-start[1];if(duration<0)duration+=1440;const pause=shift.plannedBreakMinutes===undefined?0:shift.plannedBreakMinutes;planned.set(id,(planned.get(id)||0)+(Number.isFinite(duration)&&Number.isSafeInteger(pause)&&pause>=0&&pause<duration?duration-pause:0));}
        people=people.filter(item=>totals.has(item.personId||item.id)).map(item=>({...item,plannedMinutes:planned.get(item.personId||item.id)??totals.get(item.personId||item.id).planned}));
      }
      const intro=node('div','cs-time-section-head');
      intro.append(node('h3','cs-time-heading','Timer pr. medarbejder'),node('p','cs-time-caption','Planlagt tid er efter aftalte, ulønnede pauser.'));
      body.append(intro);
      if(serverPaged()&&!Array.isArray(aggregatePeople))body.append(node('p','cs-time-caption','Registreret og godkendt tid vises for de indlæste registreringer.'));
      if(!people.length){body.append(node('p','cs-time-empty','Ingen medarbejdere i den valgte periode.'));return;}
      const {table,rows:tableRows}=makeTable(['Medarbejder','Planlagt','Aftalt pr. uge','Registreret','Godkendt']);table.classList.add?.('cs-time-week-table');
      for(const member of pageRows(people,'week')){const total=totals.get(member.personId||member.id),planned=safeNumber(member.plannedMinutes),registered=total?.registered||0,approved=total?.approved||0,row=node('tr'),personCell=node('td','cs-time-person-cell'),name=node('strong','',member.name||'Medarbejder');personCell.append(name);if(member.role)personCell.append(node('span','cs-time-caption',member.role));row.append(personCell);
        for(const [label,value] of [['Planlagt',minutes(planned)],['Aftalt pr. uge',minutes(safeNumber(member.target)*60)],['Registreret',minutes(registered)],['Godkendt',minutes(approved)]]){const cell=node('td','cs-time-number',value);cell.dataset.label=label;row.append(cell);}tableRows.append(row);}
      body.append(table);const pager=pagination(people.length,'week');if(pager)body.append(pager);
    }
    function paintPayroll(body){
      const approved=scopedEntries().filter(entry=>entry.status==='approved'),priced=approved.filter(entry=>completePayroll(entry.payroll)),total=priced.reduce((sum,entry)=>sum+entry.payroll.totalCents,0);
      const aggregate=serverSummary(),count=Number.isSafeInteger(aggregate?.counts?.approved)?aggregate.counts.approved:approved.length,missing=Number.isSafeInteger(aggregate?.missingPayrollCount)?aggregate.missingPayrollCount:approved.length-priced.length,approvedMinutes=Number.isFinite(aggregate?.approvedMinutes)?aggregate.approvedMinutes:approved.reduce((sum,entry)=>sum+safeNumber(entry.workedMinutes),0),cents=Number.isSafeInteger(aggregate?.approvedCents)?aggregate.approvedCents:total;
      body.append(metricStrip([['Godkendte timer',minutes(approvedMinutes)],['Timebaseret løngrundlag',count>missing?money(cents):count?'—':money(0),'inkl. tidsbestemte tillæg'],['Mangler lønaftale',String(missing),'godkendte registreringer']]));
      if(serverPaged()&&!aggregate)body.append(node('p','cs-time-caption','Løngrundlaget vises for de indlæste registreringer.'));
      const payrollHead=node('div','cs-time-payroll-heading');payrollHead.append(node('h3','cs-time-heading','Godkendt løngrundlag'));
      if(viewScope==='real'&&options.companyPayroll!==false&&typeof onPayrollPeriodAction==='function'&&globalThis.CleanRoomsPayrollPeriodView)payrollHead.append(button('Lønperiode og eksport',()=>{
        periodPanel?.destroy?.();periodPanel=globalThis.CleanRoomsPayrollPeriodView.open({element:element.closest?.('#cleanrooms-studio')||element,date:options.from,onAction:onPayrollPeriodAction,onChanged:onPayrollPeriodChanged,onNavigate:onPayrollPeriodNavigate,onClose:()=>{periodPanel=null;}});
      },'cs-button cs-quiet','payroll:period'));
      body.append(payrollHead,node('p','cs-time-caption','Satser og tillæg fastlåses ved godkendelse. Faste månedsbeløb afregnes pr. måned.'));
      if(!approved.length){body.append(node('p','cs-time-empty',serverPaged()&&count?'Ingen godkendte registreringer på denne side.':'Godkend registreringer, før de indgår i løngrundlaget.'));const pager=pagination(0,'payroll');if(pager)body.append(pager);return;}
      const {table,rows}=makeTable(['Medarbejder og dato','Grundlag','Timer','Grundløn','Tillæg','I alt','']);table.classList.add?.('cs-time-payroll-table');
      for(const entry of pageRows(approved,'payroll')){const row=node('tr'),identity=node('td','cs-time-person-cell');identity.append(node('strong','',nameFor(entry)),node('span','cs-time-caption',dateLabel(entry.date)));const source=node('td');source.append(node('strong','',entry.payroll?.sourceLabel||'Ingen lønaftale'));if(entry.payroll?.monthlyBaseCents)source.append(node('span','cs-time-caption','Fast månedsløn '+money(entry.payroll.monthlyBaseCents)));if(entry.payroll?.monthlySupplementCents)source.append(node('span','cs-time-caption','Faste månedlige tillæg '+money(entry.payroll.monthlySupplementCents)));if(!completePayroll(entry.payroll))source.append(node('span','cs-time-pay-incomplete','Løngrundlag mangler'),node('span','cs-time-caption',entry.payroll?.unavailableReason||'Der mangler en lønaftale for registreringen.'));row.append(identity,source);
        for(const [label,value] of [['Timer',minutes(entry.workedMinutes)],['Grundløn',money(completePayroll(entry.payroll)?entry.payroll.baseCents:undefined)],['Tillæg',money(completePayroll(entry.payroll)?entry.payroll.supplementCents:undefined)],['I alt',money(completePayroll(entry.payroll)?entry.payroll.totalCents:undefined)]]){const cell=node('td','cs-time-number',value);cell.dataset.label=label;row.append(cell);}const action=node('td','cs-time-row-action');action.append(button('Se',()=>{tab='entries';openEntry(entry);},'cs-button','payroll:'+entry.id));row.append(action);rows.append(row);}body.append(table);const pager=pagination(approved.length,'payroll');if(pager)body.append(pager);
    }
    function inspector(entry){
      const detail=node('section','cs-time-detail cs-time-detail-focused');detail.setAttribute('aria-label','Registrering for '+nameFor(entry));
      const reviewResult=review(entry);
      const back=button('Tilbage til registreringer',()=>closeEntry(entry),'cs-button cs-quiet cs-time-detail-back cs-chrome-quiet','detail:close');back.setAttribute('aria-label','Luk registrering');detail.append(back);
      const head=node('header','cs-time-detail-head'),identity=node('div','cs-time-detail-identity'),avatar=node('span','cs-time-avatar',person(entry.personId).initials||initials(nameFor(entry))),copy=node('div');avatar.setAttribute('aria-hidden','true');copy.append(node('h3','cs-time-heading',nameFor(entry)),node('p','cs-time-caption',dateLabel(entry.date)+' · '+siteLabel(entry.site)));identity.append(avatar,copy);head.append(identity,statusNode(entry,reviewResult));detail.append(head);
      if(entry.status==='approved'){
        const approval=[entry.approvedAt?stamp(entry.approvedAt):'',entry.approvedBy?.name||(typeof entry.approvedBy==='string'?entry.approvedBy:'')].filter(Boolean);
        if(approval.length)detail.append(node('p','cs-time-lock-note','Godkendt · '+approval.join(' · ')));
      }
      const reviewLayout=node('div','cs-time-review-layout'),factsColumn=node('div','cs-time-review-facts');
      if(options.canManage)reviewLayout.dataset.hasActions='true';
      reviewLayout.append(factsColumn);
      detail.append(reviewLayout);
      const plannedData=plannedFacts(entry),comparison=node('section','cs-time-comparison-section');comparison.setAttribute('aria-label','Tider og pause');comparison.append(node('h4','cs-time-detail-section-title','Tider og pause'));
      const facts=node('table','cs-time-comparison'),thead=node('thead'),header=node('tr'),tbody=node('tbody');facts.setAttribute('aria-label','Planlagt og registreret tid');
      for(const label of ['','Planlagt','Registreret']){const cell=node('th','',label);cell.scope='col';header.append(cell);}thead.append(header);
      const endWithDate=(end,endDate)=>!end?'Afventer afslutning':end+(endDate&&endDate!==entry.date?' · '+dateLabel(endDate):'');
      const plannedEndDate=inferredEndDate(entry.date,plannedData.start,plannedData.end);
      const actualStartDate=actualDate(recordedStartAt(entry),entry.date);
      for(const [key,label,planned,actual] of [
        ['start','Start',plannedData.start||'—',entry.start?entry.start+daySuffix(entry.date,actualStartDate):'Ikke registreret'],
        ['end','Slut',plannedData.end?plannedData.end+daySuffix(entry.date,plannedEndDate):'—',entry.start?endWithDate(entry.end,entry.endDate):'Ikke registreret'],
        ['pause','Pause',plannedData.breakMinutes===null?'—':plannedData.breakMinutes+' min · ulønnet',safeNumber(entry.breakMinutes)+' min'],
        ['net','Arbejdstid',minutes(plannedData.minutes),entry.end?minutes(entry.workedMinutes):'Afventer afslutning']
      ]){const row=node('tr');row.dataset.fact=key;const labelCell=node('th','',label);labelCell.scope='row';const plannedCell=node('td','',planned),actualCell=node('td','',actual);actualCell.dataset.changed=String(key==='start'?Boolean(entry.start&&plannedData.start&&entry.start!==plannedData.start):key==='end'?Boolean(entry.end&&plannedData.end&&(entry.end!==plannedData.end||entry.endDate&&entry.endDate!==plannedEndDate)):key==='pause'?plannedData.breakMinutes!==null&&entry.breakMinutes!==plannedData.breakMinutes:Boolean(entry.end&&Number.isFinite(plannedData.minutes)&&entry.workedMinutes!==plannedData.minutes));row.append(labelCell,plannedCell,actualCell);tbody.append(row);}facts.append(thead,tbody);comparison.append(facts);
      if(entry.end&&Number.isFinite(plannedData.minutes)){const result=node('p','cs-time-comparison-result');result.append(node('span','','Afvigelse'),differenceNode(entry.workedMinutes-plannedData.minutes));comparison.append(result);}
      factsColumn.append(comparison);
      const rejection=[...(entry.audit||[])].reverse().find(item=>(item.operation||item.action)==='reject');
      if(reviewResult.reasons?.length||entry.comment||entry.correctionReason||entry.status==='rejected'&&rejection?.reason){
        const context=node('section','cs-time-review-context');context.setAttribute('aria-label','Grundlag for gennemgang');context.append(node('h4','cs-time-detail-section-title','Afvigelser og kommentarer'));
        if(reviewResult.reasons?.length){const reasons=node('ul','cs-time-detail-reasons');reasons.setAttribute('aria-label','Årsager til gennemgang');for(const reason of reviewResult.reasons){const item=node('li','cs-time-review-reason',reason.label);item.dataset.priority=String(reviewResult.priority||0);reasons.append(item);}context.append(reasons);}
        for(const [title,value] of [['Medarbejderens kommentar',entry.comment],['Tilbagemelding til medarbejderen',entry.status==='rejected'?rejection?.reason:null],['Seneste begrundelse',entry.correctionReason]])if(value){const note=node('div','cs-time-comment-block');note.append(node('h5','cs-time-subheading',title),node('p','cs-time-note',value));context.append(note);}
        factsColumn.append(context);
      }
      if(options.canManage){
        const decision=node('section','cs-time-decision');decision.setAttribute('aria-label','Behandling af registrering');decision.append(node('h4','cs-time-detail-section-title','Behandl registreringen'));
        if(draft&&mode){const form=node('form','cs-time-form');form.noValidate=true;form.addEventListener('submit',event=>{event.preventDefault();saveDraft();});form.append(node('h5','cs-time-subheading',mode==='reopen'?'Genåbn registrering':mode==='reject'?'Bed om forklaring':'Ret registrering'));
          if(mode==='reopen')form.append(node('p','cs-time-caption','Godkendelsen ophæves, og timerne skal gennemgås og godkendes igen.'));
          else if(mode==='reject')form.append(node('p','cs-time-caption','Bed medarbejderen supplere sin forklaring. Selve tiderne kan kun rettes af planlæggeren.'));
          else{
            const pair=node('div','cs-time-field-pair'),start=field('start','Start','time',draft.start),end=field('end','Slut','time',draft.end),pause=field('break','Pause i minutter','number',draft.breakMinutes),date=field('end-date','Afslutningsdato','date',draft.endDate);
            start.input.step=end.input.step='60';pause.input.min='0';pause.input.max='1440';pause.input.step='1';
            for(const [control,key] of [[start.input,'start'],[end.input,'end'],[pause.input,'breakMinutes']])control.addEventListener('input',()=>{draft[key]=control.value;if(key!=='breakMinutes'&&!draft.endDateExplicit&&time(draft.start)&&time(draft.end)){draft.endDate=inferredEndDate(draft.startDate,draft.start,draft.end);date.input.value=draft.endDate;}});pair.append(start.holder,end.holder);form.append(pair,pause.holder,node('p','cs-time-caption','Den samlede pause placeres ved vagtens slutning ved beregning af tillæg. Stemplede pauser bruger ellers de faktiske pauseintervaller.'));
            if(draft.preciseStart){const startDate=field('start-date','Startdato','date',draft.startDate);startDate.input.addEventListener('input',()=>{draft.startDate=startDate.input.value;if(!draft.endDateExplicit&&validDate(draft.startDate)){draft.endDate=inferredEndDate(draft.startDate,draft.start,draft.end);date.input.value=draft.endDate;}});form.append(startDate.holder);}
            date.input.addEventListener('input',()=>{draft.endDate=date.input.value;draft.endDateExplicit=true;});form.append(date.holder);
            if(draft.resolveDST){
              form.append(node('p','cs-time-caption','Vagten er afsluttet sikkert. Afklar start og slut i UTC før løngodkendelse. De lokale tider ovenfor vises i Europe/Copenhagen.'));
              for(const [key,label,name]of [['actualStartAt','Start i UTC','actual-start'],['actualEndAt','Slut i UTC','actual-end']]){const precise=field(name,label,'text',draft[key]);precise.input.placeholder='2026-10-25T00:30:00.000Z';precise.input.addEventListener('input',()=>{draft[key]=precise.input.value.trim();});form.append(precise.holder);}
            }
          }
          const reason=field('reason','Begrundelse for ændringen','textarea',draft.reason);reason.input.required=true;reason.input.rows=2;reason.input.addEventListener('input',()=>{draft.reason=reason.input.value;});form.append(reason.holder);
          if(conflict||entry.version!==draft.version)form.append(node('p','cs-time-error','Registreringen er ændret. Luk redigeringen og hent den seneste version.'));
          const actions=node('div','cs-time-actions');actions.append(button('Annuller',()=>{clearDraft();paint();},'cs-button','draft:cancel'));const save=button(mode==='reopen'?'Genåbn registrering':mode==='reject'?'Bed om forklaring':'Gem og send til godkendelse',saveDraft,'cs-button cs-primary','draft:save');save.disabled=blocked()||conflict||entry.version!==draft.version;actions.append(save);form.append(actions);decision.append(form);
        }else{
          if(entry.status==='approved')decision.append(node('p','cs-time-caption','Timerne er låst efter godkendelse. Genåbn for at rette.'));
          else if(reviewResult.bucket==='ready')decision.append(node('p','cs-time-caption','Timerne følger den planlagte vagt.'));
          else if(!entry.end)decision.append(node('p','cs-time-caption','Timerne kan godkendes, når registreringen har en sluttid.'));
          const actions=node('div','cs-time-detail-actions');
          if(approvable(entry))actions.append(button('Godkend timer',()=>approve(entry),'cs-button cs-primary','entry:approve'));
          if(entry.status==='approved')actions.append(button('Genåbn registrering',()=>edit(entry,'reopen'),'cs-button','entry:reopen'));
          else{
            actions.append(button('Ret registrering',()=>edit(entry,'correct'),'cs-button','entry:edit'));
            if(entry.status==='submitted')actions.append(button('Bed om forklaring',()=>edit(entry,'reject'),'cs-button','entry:reject'));
          }
          decision.append(actions);
        }reviewLayout.append(decision);
      }
      const disclosure=(key,title,cls)=>{const el=node('details',cls),summary=node('summary','',title);el.open=detailSections.has(key);summary.dataset.timeFocus='section:'+key;el.addEventListener('toggle',()=>{if(disposed||el.isConnected===false)return;if(el.open)detailSections.add(key);else detailSections.delete(key);});el.append(summary);return el;};
      if(options.canViewPayroll&&entry.payroll){
        const payroll=disclosure('payroll',entry.status==='approved'?'Fastlåst løngrundlag':'Forventet løngrundlag','cs-time-pay-detail cs-time-secondary');payroll.append(node('p','cs-time-caption',entry.payroll.sourceLabel||'Lønaftale'));
        if(!completePayroll(entry.payroll))payroll.append(node('p','cs-time-pay-incomplete','Løngrundlag mangler'),node('p','cs-time-caption',entry.payroll.unavailableReason||'Der mangler en lønaftale for registreringen.'));
        const amounts=node('dl','cs-time-facts');for(const [label,value] of [['Grundløn',money(completePayroll(entry.payroll)?entry.payroll.baseCents:undefined)],['Tillæg',money(completePayroll(entry.payroll)?entry.payroll.supplementCents:undefined)],['Timebaseret i alt',money(completePayroll(entry.payroll)?entry.payroll.totalCents:undefined)]]){const item=node('div');item.append(node('dt','',label),node('dd','',value));amounts.append(item);}payroll.append(amounts);
        if(entry.payroll.monthlyBaseCents)payroll.append(node('p','cs-time-caption','Fast månedsløn: '+money(entry.payroll.monthlyBaseCents)+'. Afregnes pr. måned.'));
        if(entry.payroll.monthlySupplementCents)payroll.append(node('p','cs-time-caption','Faste månedlige tillæg: '+money(entry.payroll.monthlySupplementCents)+'. Afregnes pr. måned.'));
        if(entry.breakMinutes>0)payroll.append(node('p','cs-time-caption cs-time-break-help',entry.breakAllocation==='end-of-shift'||entry.payroll?.breakAllocation==='end-of-shift'?'Samlet pause placeres ved vagtens slutning ved beregning af tillæg.':'Stemplede pauser følger de faktiske pauseintervaller ved beregning af tillæg.'));
        const provenance=[];if(entry.payroll.policyVersion!==undefined)provenance.push('Løngrupper v'+entry.payroll.policyVersion);if(entry.payroll.personVersion!==undefined)provenance.push('Personlig aftale v'+entry.payroll.personVersion);if(provenance.length)payroll.append(node('p','cs-time-caption',provenance.join(' · ')));detail.append(payroll);
      }else if(entry.breakMinutes>0){const calculation=disclosure('calculation','Beregning af pauser','cs-time-secondary');calculation.append(node('p','cs-time-caption cs-time-break-help',entry.breakAllocation==='end-of-shift'?'Samlet pause placeres ved vagtens slutning ved beregning af tillæg.':'Stemplede pauser følger de faktiske pauseintervaller ved beregning af tillæg.'));detail.append(calculation);}
      if(entry.audit?.length){const audit=disclosure('audit','Registreringens historik · '+entry.audit.length,'cs-time-audit cs-time-secondary'),list=node('ol');for(const event of [...entry.audit].reverse()){const item=node('li');item.append(node('strong','',OPERATIONS[event.operation||event.action]||event.summary||'Registrering ændret'),node('span','cs-time-caption',[stamp(event.at||event.createdAt),event.actor?.name||event.actor?.email||event.actorName||''].filter(Boolean).join(' · ')));if(event.reason)item.append(node('p','cs-time-note',event.reason));list.append(item);}audit.append(list);detail.append(audit);}
      if(typeof onOpenEmployee==='function'||typeof onOpenShift==='function'){const links=node('nav','cs-time-detail-links');links.setAttribute('aria-label','Relateret til registreringen');if(typeof onOpenEmployee==='function')links.append(button('Åbn medarbejder',()=>onOpenEmployee(entry.personId),'cs-button cs-quiet','entry:employee'));if(typeof onOpenShift==='function')links.append(button('Vis vagten i planen',()=>onOpenShift(entry),'cs-button cs-quiet','entry:shift'));detail.append(links);}
      return detail;
    }
    function render(next={}){
      if(disposed)return;
      options={...options,...next};
      const nextScope=serverPaged()?(options.serverFilter?.scope==='demo'?'demo':'real'):options.demo?.active?(!demoWasActive?'demo':viewScope):'real',nextRange=(options.from||'')+'|'+(options.to||'');
      if(nextScope!==viewScope||rangeKey!==nextRange){status=null;pages.entries=pages.week=pages.payroll=0;selected.clear();bulkConfirm=null;selectedId=null;clearDraft();}
      viewScope=nextScope;rangeKey=nextRange;demoWasActive=!!options.demo?.active;
      if(serverPaged()){
        const filter=options.serverFilter||{},key=JSON.stringify([options.pagination.page||0,filter.queue||'all',filter.search||'',filter.scope||viewScope,filter.problem||'',filter.entryId||'',nextRange]);
        if(key!==serverViewKey){selected.clear();bulkConfirm=null;selectedId=null;clearDraft();status=filter.queue||'all';if(typeof filter.search==='string')search=filter.search;if(filter.scope==='real'||filter.scope==='demo')viewScope=filter.scope;serverViewKey=key;}
      }else serverViewKey='';
      const current=new Map(scopedEntries().filter(approvable).map(item=>[item.id,item.version]));selected=new Map([...selected].filter(([id,version])=>current.get(id)===version));
      if(selectedId&&!currentEntry()&&!options.loading&&options.pagination?.loading!==true){selectedId=null;clearDraft();}
      if(options.canManage!==true){selected.clear();bulkConfirm=null;clearDraft();}
      if(!options.canViewPayroll||options.companyPayroll===false){periodPanel?.destroy?.();periodPanel=null;}
      const focused=periodFocus(),focusKey=focused?JSON.stringify([focused.from,focused.to,focused.problem,focused.personId||'',focused.entryId||'',options.requestedEntryId||'']):'';
      if(focusKey!==periodFocusKey){if(periodFocusKey){selectedId=null;clearDraft();}periodFocusKey=focusKey;openedFocusKey='';if(focused?.problem||focused&&options.requestedEntryId)tab='entries';}
      if(focused&&options.requestedEntryId&&(!focused.entryId||focused.entryId===options.requestedEntryId)&&openedFocusKey!==focusKey&&!options.loading&&options.pagination?.loading!==true){
        const filter=options.serverFilter||{},matchesFilter=!serverPaged()||filter.scope!=='demo'&&filter.problem===focused.problem&&filter.entryId===options.requestedEntryId;
        const requested=matchesFilter&&scopedEntries().find(item=>item.id===options.requestedEntryId&&item.date>=focused.from&&item.date<=focused.to&&(!focused.personId||item.personId===focused.personId));
        if(requested){tab='entries';selectedId=requested.id;detailSections.clear();clearDraft();error='';listScroll=0;openedFocusKey=focusKey;}
      }
      chooseDefaultQueue();paint();
    }
    function destroy(){disposed=true;periodPanel?.destroy?.();periodPanel=null;options={};selected.clear();draft=null;element.replaceChildren();}
    return {render,destroy,get hasDraft(){return Boolean(draft);},get busy(){return blocked();}};
  }
  const api=Object.freeze({mount,statusLabel:value=>STATUS[value]||value,flagLabel:value=>FLAGS[value]||value,minutes,money,approvable,differenceLabel});globalThis.CleanRoomsTimekeepingView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
