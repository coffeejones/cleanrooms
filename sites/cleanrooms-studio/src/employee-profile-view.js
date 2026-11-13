/* A planner-facing employee record. Calendar data and persistence stay with the caller. */
(() => {
  'use strict';
  const clockLabel=shift=>shift.start+'–'+shift.end+(shift.end<shift.start?' +1 dag':'');
  const plannedMinutes=shift=>{const a=Number(shift.start.slice(0,2))*60+Number(shift.start.slice(3)),b=Number(shift.end.slice(0,2))*60+Number(shift.end.slice(3));return b-a+(b<a?1440:0)-(shift.plannedBreakMinutes||0);};
  let sequence=0;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const formatHours=minutes=>new Intl.NumberFormat('da-DK',{maximumFractionDigits:2}).format(minutes/60);
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'));
  const dateLabel=(value,full=false,includeYear=full)=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:full?'long':'short',...(full?{weekday:'long'}:{}),...(includeYear?{year:'numeric'}:{}),timeZone:'UTC'}):'Dato mangler';
  const compactTime=value=>String(value||'').replace(/^0/,'').replace(/:00$/,'');
  function mount({element,icon,onBack,onMonthChange,onSave,onShowPlan,onOpenShift,onTabChange,onHelp,onLoadAppLogin,onRevealAppLogin,onChangeAppLogin}={}){
    if(!element?.ownerDocument)throw new TypeError('Medarbejderprofilen kræver et indholdsfelt.');
    const doc=element.ownerDocument,prefix='cs-employee-profile-'+(++sequence)+'-';
    let options={},person=null,activeTab='calendar',selectedDay=null,editing=false,before=null,pending=false,disposed=false,epoch=0,lastMonth=null,saveMessage='';
    let startCode='',startCodeRequest=0,startCodePending=false,startCodeError='',startCodeMessage='';
    let appLoginChange=0,appLoginPending=false,appLoginConfirmation=null,appLoginDraftEmail=null,appLoginFeedback=null;
    const node=(tag,className,text)=>{const item=doc.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=String(text);return item;};
    const button=(label,action,className='cs-button',key)=>{const item=node('button',className,label);item.type='button';item.setAttribute('aria-label',label);if(key){item.dataset.profileFocus=key;item.dataset.productFocus='employee-profile:'+key;}item.addEventListener('click',event=>{if(!disposed&&!item.disabled)return action(event.currentTarget||item);});return item;};
    const decorate=(item,name,label=item.textContent)=>{if(icon)item.replaceChildren(icon(name),node('span','',label));return item;};
    const page=node('div','cs-employee-profile-page');element.replaceChildren(page);
    const form=node('form','cs-employee-profile-form');form.noValidate=true;
    const controls={};
    const field=(name,label,type='text')=>{const wrap=node('label','cs-employee-profile-field'),control=node(type==='select'?'select':'input','cs-employee-profile-input');control.id=prefix+name;control.dataset.profileFocus='field:'+name;if(type!=='select')control.type=type;controls[name]=control;wrap.append(node('span','cs-employee-profile-label',label),control);return wrap;};
    const nameField=field('name','Navn'),initialsField=field('initials','Initialer'),roleField=field('role','Funktion'),targetField=field('target','Aftalte timer pr. uge','number'),siteField=field('site','Primært arbejdssted','select');
    controls.name.required=true;controls.name.maxLength=120;controls.name.autocomplete='name';controls.initials.maxLength=8;controls.role.required=true;controls.role.maxLength=120;controls.role.autocomplete='organization-title';controls.target.min='0';controls.target.max='168';controls.target.step='0.25';
    const pair=node('div','cs-employee-profile-field-pair');pair.append(initialsField,roleField);
    const active=node('input');active.type='checkbox';active.id=prefix+'active';active.dataset.profileFocus='field:active';controls.active=active;const activeField=node('label','cs-employee-profile-check');activeField.append(active,node('span','','Aktiv medarbejder'));
    const activeHelp=node('p','cs-employee-profile-help','Arkiverede medarbejdere bevares sammen med deres tidligere vagter.');activeHelp.id=prefix+'active-help';active.setAttribute('aria-describedby',activeHelp.id);const activeGroup=node('div','cs-employee-profile-active-group');activeGroup.append(activeField,activeHelp);
    const error=node('p','cs-employee-profile-error');error.hidden=true;error.setAttribute('role','alert');
    const formActions=node('div','cs-employee-profile-form-actions'),cancel=button('Annuller',()=>{if(pending)return;editing=false;before=null;error.hidden=true;showTab('information');},'cs-button cs-quiet','edit:cancel'),save=button('Gem medarbejder',()=>savePerson(),'cs-button cs-primary','edit:save');formActions.append(cancel,save);
    const identityFields=node('section','cs-employee-profile-form-section'),agreementFields=node('section','cs-employee-profile-form-section'),agreementPair=node('div','cs-employee-profile-form-section-fields');
    identityFields.append(node('h4','cs-employee-profile-section-title','Stamoplysninger'),nameField,pair);agreementPair.append(targetField,siteField);
    agreementFields.append(node('h4','cs-employee-profile-section-title','Arbejdstid og arbejdssted'),agreementPair,activeGroup);form.append(identityFields,agreementFields,error,formActions);
    form.addEventListener('submit',event=>{event.preventDefault();savePerson();});form.addEventListener('keydown',event=>{if(event.key==='Escape'&&!pending){event.preventDefault();cancel.click();}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();savePerson();}});
    const siteFor=index=>options.sites?.[index]||{name:'Arbejdssted mangler',address:''};
    const planFor=()=>options.planning?.byPerson?.[person?.id]||null;
    function today(){if(validDate(options.today))return options.today;const marked=options.calendar?.weeks?.flat().find(day=>day.isToday);if(marked)return marked.date;if(validDate(globalThis.CleanRoomsData?.today))return globalThis.CleanRoomsData.today;const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=key=>parts.find(item=>item.type===key).value;return part('year')+'-'+part('month')+'-'+part('day');}
    function badge(){const state=node('span','cs-employee-profile-state',person.active===false?'Arkiveret':'Aktiv');state.dataset.state=person.active===false?'archived':'active';return state;}
    function details(rows){const list=node('dl','cs-employee-profile-details');for(const [label,value] of rows){const item=node('div'),valueNode=node('dd');if(label==='Status')valueNode.append(badge());else valueNode.textContent=value;item.append(node('dt','',label),valueNode);list.append(item);}return list;}
    function agreementRows(){return [['Aftalt pr. uge',formatHours(Number(person.target||0)*60)+' timer'],['Primært arbejdssted',siteFor(person.site).name],...(siteFor(person.site).address?[['Adresse',siteFor(person.site).address]]:[])];}
    function information(){return details(agreementRows());}
    function discardStartCode(){
      const changed=Boolean(startCode||startCodePending||startCodeError||startCodeMessage);
      if(startCode){
        const field=page.querySelectorAll('.cs-employee-profile-code-value')[0];
        if(field)field.value='';
      }
      startCodeRequest++;startCode='';startCodePending=false;startCodeError='';startCodeMessage='';
      return changed;
    }
    function discardAppLoginControls(){
      const changed=Boolean(appLoginPending||appLoginConfirmation||appLoginDraftEmail!==null||appLoginFeedback);
      appLoginChange++;appLoginPending=false;appLoginConfirmation=null;appLoginDraftEmail=null;appLoginFeedback=null;
      return changed;
    }
    function hideStartCode(){if(discardStartCode())paint();}
    function clearAppLoginCode(){
      const clearedCode=discardStartCode(),clearedControls=discardAppLoginControls();
      if(clearedCode||clearedControls)paint();
    }
    function onVisibilityChange(){if(doc.visibilityState==='hidden')hideStartCode();}
    doc.defaultView?.addEventListener?.('pagehide',clearAppLoginCode);
    doc.addEventListener?.('visibilitychange',onVisibilityChange);
    function showTab(key,notify=true){
      if(disposed||pending||key==='pay'&&options.canViewPayroll!==true)return;
      if(key!==activeTab){discardStartCode();discardAppLoginControls();}
      activeTab=key;paint('tab:'+key);
      if(notify)onTabChange?.(key);
    }
    async function revealStartCode(account){
      if(startCodePending||activeTab!=='information'||typeof onRevealAppLogin!=='function')return;
      const token=++startCodeRequest;
      startCodePending=true;startCodeError='';paint();
      try{
        const result=await onRevealAppLogin(person.id,account.version);
        if(token!==startCodeRequest||disposed)return;
        if(result?.ok===false||typeof result?.temporaryPassword!=='string'||!/^[!-~]{10}$/.test(result.temporaryPassword)){
          startCodeError=result?.message||'Startkoden kunne ikke vises. Prøv igen.';
        }else startCode=result.temporaryPassword;
      }catch{
        if(token!==startCodeRequest||disposed)return;
        startCodeError='Startkoden kunne ikke vises. Prøv igen.';
      }
      startCodePending=false;paint('app-login:reveal');
    }
    async function copyStartCode(input,feedback){
      if(!startCode)return;
      const token=startCodeRequest;
      try{
        const clipboard=doc.defaultView?.navigator?.clipboard;
        if(clipboard?.writeText){
          await clipboard.writeText(startCode);
          if(token!==startCodeRequest||disposed)return;
          startCodeMessage='Startkoden er kopieret.';paint('app-login:copy');
          return;
        }
      }catch{}
      if(token!==startCodeRequest||disposed)return;
      input.focus();input.select?.();
      try{
        if(doc.execCommand?.('copy')){
          startCodeMessage='Startkoden er kopieret.';paint('app-login:copy');
          return;
        }
      }catch{}
      startCodeMessage='Startkoden er markeret. Brug Ctrl+C eller ⌘C til at kopiere den.';
      feedback.textContent=startCodeMessage;
    }
    function beginAppLoginConfirmation(action,account){
      if(appLoginPending||startCodePending||typeof onChangeAppLogin!=='function'||account.personId!==person.id||options.appLogin?.account?.version!==account.version)return;
      discardStartCode();
      appLoginConfirmation={action,personId:account.personId,version:account.version};
      appLoginFeedback=null;paint('app-login:cancel');
    }
    function cancelAppLoginConfirmation(){
      if(!appLoginConfirmation)return;
      const {action}=appLoginConfirmation;appLoginConfirmation=null;paint('app-login:'+action);
    }
    async function changeAppLogin(action,personId,fields){
      if(appLoginPending||activeTab!=='information'||person?.id!==personId||!options.appLogin||typeof onChangeAppLogin!=='function')return;
      const account=options.appLogin.account;
      if(fields.version!==undefined&&(account?.personId!==personId||account.version!==fields.version))return;
      if(action==='revokeAppLogin'?account?.status!=='active':person.active===false)return;
      const token=++appLoginChange;
      discardStartCode();appLoginConfirmation=null;appLoginFeedback=null;appLoginPending=true;paint();
      let result;
      try{result=await onChangeAppLogin(action,{personId,...fields});}
      catch{result={ok:false};}
      if(disposed||token!==appLoginChange)return;
      appLoginPending=false;
      if(result?.ok){
        appLoginDraftEmail=null;
        const success=action==='revokeAppLogin'?'App-login er lukket.':action==='createAppLogin'?'App-login er oprettet.':'En ny startkode er klar.';
        appLoginFeedback={message:success,error:false};
      }else appLoginFeedback={message:result?.message||'App-login kunne ikke ændres. Prøv igen.',error:true};
      let focus=action;
      if(result?.ok)focus=options.appLogin?.account?.canRevealStartCode?'reveal':'resetAppLogin';
      else if(action==='createAppLogin')focus='email';
      paint('app-login:'+focus);
    }
    function createAppLogin(email,personId){
      if(options.appLogin?.status!=='missing'||person?.id!==personId||person.active===false)return;
      appLoginDraftEmail=email;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())||email.trim().length>320){
        appLoginFeedback={message:'Skriv en gyldig e-mailadresse.',error:true};paint('app-login:email');return;
      }
      return changeAppLogin('createAppLogin',personId,{email:email.trim()});
    }
    function appLoginCreateForm(login){
      const form=node('form','cs-employee-profile-app-login-create'),label=node('label','cs-employee-profile-field');
      const input=node('input','cs-employee-profile-input'),personId=person.id;
      input.type='email';input.required=true;input.autocomplete='email';input.maxLength=320;input.disabled=appLoginPending;
      input.value=appLoginDraftEmail??login.email??'';input.dataset.profileFocus='app-login:email';
      input.addEventListener('input',()=>{appLoginDraftEmail=input.value;});
      label.append(node('span','cs-employee-profile-label','E-mail til app-login'),input);
      const submit=button('Opret app-login',()=>createAppLogin(input.value,personId),'cs-button cs-primary','app-login:createAppLogin');
      submit.disabled=appLoginPending;
      form.addEventListener('submit',event=>{event.preventDefault();return createAppLogin(input.value,personId);});
      form.append(label,submit);return form;
    }
    function appLoginActions(account){
      const actions=node('div','cs-employee-profile-app-login-actions');
      const closed=account.status!=='active';
      const confirmation=appLoginConfirmation;
      if(confirmation?.version===account.version){
        const revoking=confirmation.action==='revokeAppLogin';
        const headingText=revoking?'Luk app-login?':closed?'Genåbn app-login?':'Nulstil adgangskoden?';
        const explanation=revoking?'Medarbejderen bliver logget ud af appen. Login kan genåbnes med en ny startkode.':closed?'Medarbejderen kan logge ind igen med den nye startkode.':'Medarbejderen bliver logget ud af appen og skal bruge den nye startkode til at logge ind igen.';
        const confirm=node('section','cs-employee-profile-app-login-confirm');
        const title=node('h5','cs-employee-profile-section-title',headingText);
        title.id=prefix+'app-login-confirm';confirm.setAttribute('aria-labelledby',title.id);
        confirm.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelAppLoginConfirmation();}});
        actions.append(
          button('Annuller',cancelAppLoginConfirmation,'cs-button cs-chrome-quiet','app-login:cancel'),
          button(revoking?'Luk app-login':closed?'Genåbn app-login':'Generér ny startkode',()=>changeAppLogin(confirmation.action,confirmation.personId,{version:confirmation.version}),
            revoking?'cs-button cs-chrome-quiet cs-employee-profile-login-danger':'cs-button cs-primary','app-login:confirm'));
        confirm.append(title,node('p','cs-employee-profile-help',explanation),actions);
        return confirm;
      }
      if(person.active!==false){
        const reset=button(closed?'Genåbn app-login':'Nulstil adgangskode',()=>beginAppLoginConfirmation('resetAppLogin',account),'cs-button cs-chrome-quiet','app-login:resetAppLogin');
        reset.disabled=appLoginPending||startCodePending;actions.append(reset);
      }
      if(!closed){
        const revoke=button('Luk app-login',()=>beginAppLoginConfirmation('revokeAppLogin',account),'cs-button cs-chrome-quiet','app-login:revokeAppLogin');
        revoke.disabled=appLoginPending||startCodePending;actions.append(revoke);
      }
      return actions;
    }
    function appendAppLoginFeedback(group){
      if(appLoginPending){
        const status=node('p','cs-employee-profile-help','Gemmer app-login…');status.setAttribute('role','status');group.append(status);
      }else if(appLoginFeedback){
        const note=node('p',appLoginFeedback.error?'cs-employee-profile-error':'cs-employee-profile-help',appLoginFeedback.message);
        note.setAttribute('role',appLoginFeedback.error?'alert':'status');group.append(note);
      }
    }
    function appLoginSection(){
      const login=options.appLogin;
      if(!login)return null;
      const group=node('section','cs-employee-profile-information-group cs-employee-profile-app-login');
      const heading=node('h4','cs-employee-profile-section-title','App-login');
      heading.id=prefix+'app-login';group.setAttribute('aria-labelledby',heading.id);group.append(heading);
      const account=login.account?.personId===person.id?login.account:null;
      if(login.status==='error'){
        const note=node('p','cs-employee-profile-help',login.error||'App-login kunne ikke indlæses.');note.setAttribute('role','alert');group.append(note);
        if(typeof onLoadAppLogin==='function')group.append(button('Prøv igen',()=>onLoadAppLogin(person.id),'cs-button cs-chrome-quiet','app-login:retry'));
        return group;
      }
      if(!account){
        const missing=login.status==='missing';
        const note=node('p','cs-employee-profile-help',missing?'Der er ikke oprettet app-login.':'Henter app-login…');note.setAttribute('role','status');group.append(note);
        if(missing&&person.active!==false&&typeof onChangeAppLogin==='function')group.append(appLoginCreateForm(login));
        appendAppLoginFeedback(group);
        return group;
      }
      const closed=account.status!=='active';
      const credentials=details([['E-mail',account.email],['Adgang',closed?'Lukket':'Aktiv']]);
      if(!closed&&person.active!==false){
        const item=node('div'),value=node('dd','cs-employee-profile-start-code');
        item.append(node('dt','','Startkode'),value);credentials.append(item);
        if(!account.temporary)value.textContent='Medarbejderen har valgt sin egen adgangskode.';
        else if(!account.canRevealStartCode||typeof onRevealAppLogin!=='function')value.textContent='Du kan nulstille adgangskoden for at få en ny startkode.';
        else{
          const actions=node('div','cs-employee-profile-start-code-actions');
          const reveal=button(startCode?'Skjul startkode':startCodePending?'Henter startkode…':'Vis startkode',()=>startCode?hideStartCode():revealStartCode(account),'cs-button cs-chrome-quiet','app-login:reveal');
          reveal.disabled=startCodePending||appLoginPending||Boolean(appLoginConfirmation);value.append(actions);
          if(startCode){
            const input=node('input','cs-employee-profile-input cs-employee-profile-code-value');
            input.type='text';input.readOnly=true;input.value=startCode;input.autocomplete='off';input.spellcheck=false;
            input.setAttribute('aria-label','Startkode');input.dataset.profileFocus='app-login:code';
            const feedback=node('p','cs-employee-profile-help',startCodeMessage);feedback.setAttribute('role','status');
            actions.append(input,button('Kopiér',()=>copyStartCode(input,feedback),'cs-button cs-chrome-quiet','app-login:copy'),reveal);
            value.append(feedback);
          }else actions.append(reveal);
          if(startCodeError){const problem=node('p','cs-employee-profile-help',startCodeError);problem.setAttribute('role','alert');value.append(problem);}
        }
      }
      group.append(credentials);
      if(typeof onChangeAppLogin==='function'&&(person.active!==false||!closed))group.append(appLoginActions(account));
      appendAppLoginFeedback(group);
      return group;
    }
    function openEditor(){if(!person||!options.canEdit||pending||disposed)return;discardStartCode();discardAppLoginControls();before=clone(person);editing=true;activeTab='information';saveMessage='';error.hidden=true;for(const key of ['name','initials','role','target'])controls[key].value=String(person[key]??'');controls.active.checked=person.active!==false;controls.site.replaceChildren();(options.sites||[]).forEach((site,index)=>{if(site.restricted)return;const option=node('option','',site.name);option.value=String(index);controls.site.append(option);});controls.site.value=String(person.site);paint('field:name');}
    async function savePerson(){
      if(!editing||pending||!options.canEdit||disposed||!before)return;
      const draft={...before,name:controls.name.value.trim(),initials:controls.initials.value.trim(),role:controls.role.value.trim(),target:controls.target.value.trim()===''?NaN:Number(controls.target.value),site:Number(controls.site.value),active:controls.active.checked};
      if(!draft.initials)draft.initials=globalThis.CleanRoomsRoster?.initials?.(draft.name)||draft.name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toLocaleUpperCase('da-DK');
      const problem=JSON.stringify(person)!==JSON.stringify(before)?'Medarbejderen er ændret siden formularen blev åbnet. Annullér og åbn den igen.':!draft.name||draft.name.length>120?'Skriv et navn på højst 120 tegn.':!draft.role||draft.role.length>120?'Skriv en funktion på højst 120 tegn.':draft.initials.length>8?'Initialer må højst være 8 tegn.':!Number.isFinite(draft.target)||draft.target<0||draft.target>168?'Aftalte timer skal være mellem 0 og 168.':!Number.isInteger(draft.site)||!options.sites?.[draft.site]?'Vælg et arbejdssted.':typeof onSave!=='function'?'Medarbejderen kan ikke gemmes lige nu.':'';
      if(problem){error.textContent=problem;error.hidden=false;return;}
      const token=++epoch;pending=true;error.hidden=true;paint('edit:save');
      try{const result=await onSave(clone(draft),clone(before));if(disposed||token!==epoch)return;pending=false;if(result?.ok===false){error.textContent=result.error||result.message||'Medarbejderen kunne ikke gemmes.';error.hidden=false;paint('edit:save');return;}person=clone(result?.person||draft);options={...options,person};editing=false;before=null;saveMessage='Medarbejderen er gemt.';showTab('information');}
      catch(problem){if(disposed||token!==epoch)return;pending=false;error.textContent=problem?.message||'Medarbejderen kunne ikke gemmes.';error.hidden=false;paint('edit:save');}
    }
    function agendaFor(calendar){
          const day=calendar.byDate?.[selectedDay],agenda=node('section','cs-employee-profile-surface cs-employee-profile-agenda'),agendaHead=node('header','cs-employee-profile-agenda-head'),agendaHeading=node('div','cs-employee-profile-agenda-heading');agendaHeading.append(node('p','cs-employee-profile-agenda-eyebrow','Valgt dag'),node('h3','cs-employee-profile-section-title',dateLabel(selectedDay,true,false)));agendaHead.append(agendaHeading);if(day?.shifts.length)agendaHead.append(node('p','cs-employee-profile-help',day.shifts.length+(day.shifts.length===1?' vagt':' vagter')+' · '+formatHours(day.minutes)+' t planlagt'));agenda.append(agendaHead);
          if(!day?.shifts.length)agenda.append(node('p','cs-employee-profile-agenda-empty','Ingen vagter denne dag.'));
          else day.shifts.forEach(shift=>{const item=node('article','cs-employee-profile-agenda-shift'),info=node('div'),shiftHead=node('div','cs-employee-profile-agenda-shift-header');shiftHead.append(node('strong','cs-employee-profile-agenda-time',clockLabel(shift)),node('span','cs-employee-profile-agenda-duration',formatHours(plannedMinutes(shift))+' t arbejdstid'));info.append(shiftHead,node('p','cs-employee-profile-agenda-site',siteFor(shift.site).name));if(shift.plannedBreakMinutes>0)info.append(node('p','cs-employee-profile-help',shift.plannedBreakMinutes+' min ulønnet pause'));if(siteFor(shift.site).address)info.append(node('p','cs-employee-profile-help',siteFor(shift.site).address));const note=typeof shift.note==='string'?shift.note.trim().replace(/\s+/g,' '):'';if(note)info.append(node('p','cs-employee-profile-instructions',note.slice(0,140)+(note.length>140?'…':'')));else if(shift.noteRich)info.append(node('p','cs-employee-profile-instructions','Beskrivelse og tjekliste tilføjet'));item.append(info);if(typeof onOpenShift==='function')item.append(button('Åbn vagt',trigger=>onOpenShift(shift,trigger),'cs-button cs-employee-profile-agenda-open','open-shift:'+shift.id));agenda.append(item);});return agenda;
    }
    function selectDay(value){
      if(!options.calendar?.byDate?.[value])return;
      const scrollTop=page.scrollTop;selectedDay=value;
      for(const cell of page.querySelectorAll('.cs-employee-profile-day')){
        const selected=cell.dataset.date===value;cell.dataset.selected=String(selected);
        const dateButton=[...cell.querySelectorAll('button')].find(item=>item.dataset.profileFocus==='day:'+cell.dataset.date);
        dateButton?.setAttribute('aria-pressed',String(selected));
      }
      const aside=page.querySelectorAll('.cs-employee-profile-aside')[0];
      if(aside){const facts=[...aside.children].filter(item=>!item.className.split(' ').includes('cs-employee-profile-agenda'));aside.replaceChildren(agendaFor(options.calendar),...facts);}
      page.scrollTop=scrollTop;
    }
    function paint(requestedFocus){
      if(disposed)return;
      const focus=requestedFocus||(element.contains?.(doc.activeElement)?doc.activeElement?.dataset?.profileFocus:null),scrollTop=page.scrollTop||0;
      if(!person){page.replaceChildren(node('p','cs-employee-profile-help','Medarbejderen er ikke tilgængelig.'));return;}
      const header=node('header','cs-employee-profile-header'),breadcrumb=node('nav','cs-employee-profile-breadcrumb'),back=decorate(button(options.backLabel||'Alle medarbejdere',trigger=>onBack?.(trigger),'cs-button cs-quiet cs-chrome-quiet cs-employee-profile-back','back'),'arrow-left');back.disabled=pending;breadcrumb.setAttribute('aria-label',options.backAriaLabel||'Tilbage til medarbejdere');if(options.backAriaLabel)back.setAttribute('aria-label',options.backAriaLabel);breadcrumb.append(back);if(typeof onHelp==='function'){const help=button('?',trigger=>onHelp(trigger),'cs-page-help-trigger','help');help.setAttribute('aria-label','Hjælp til denne side');help.setAttribute('aria-haspopup','dialog');breadcrumb.append(help);}
      const identity=node('div','cs-employee-profile-identity'),avatar=node('span','cs-employee-profile-avatar',person.initials);avatar.setAttribute('aria-hidden','true');const copy=node('div','cs-employee-profile-identity-copy'),title=node('h2','cs-employee-profile-name',person.name);title.tabIndex=-1;title.id=prefix+'title';title.dataset.profileFocus='title';
      const metadata=node('div','cs-employee-profile-metadata'),site=decorate(node('span','cs-employee-profile-worksite',siteFor(person.site).name),'map-pin');metadata.append(node('span','cs-employee-profile-role',person.role),site,badge());copy.append(title,metadata);identity.append(avatar,copy);
      const actions=node('div','cs-employee-profile-header-actions');if(options.canEdit&&!editing){const edit=decorate(button('Rediger medarbejder',openEditor,'cs-button cs-employee-profile-edit','edit'),'pencil','Rediger');edit.disabled=pending;actions.append(edit);}if(typeof onShowPlan==='function'){const show=decorate(button('Vis i vagtplan',trigger=>onShowPlan(person,planFor()?.nextShift||null,trigger),'cs-button cs-chrome-quiet cs-employee-profile-show-plan','show-plan'),'calendar-days');show.disabled=pending;actions.append(show);}const headerMain=node('div','cs-employee-profile-header-main');headerMain.append(identity,actions);header.append(breadcrumb,headerMain);
      const tabs=node('div','cs-employee-profile-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Medarbejderprofil');[['calendar','Kalender','calendar-days'],['information','Oplysninger','file-text'],['pay','Løn og tillæg','wallet']].forEach(([key,label,symbol])=>{if(key==='pay'&&options.canViewPayroll!==true)return;const tab=decorate(button(label,()=>showTab(key),'cs-employee-profile-tab','tab:'+key),symbol);tab.setAttribute('aria-pressed',String(activeTab===key));tab.disabled=pending;tabs.append(tab);});
      const content=node('section','cs-employee-profile-content');content.setAttribute('aria-label',activeTab==='calendar'?'Kalender':activeTab==='information'?'Oplysninger':'Løn og tillæg');
      if(saveMessage){const message=node('p','cs-employee-profile-save-status',saveMessage);message.setAttribute('role','status');content.append(message);}
      if(activeTab==='calendar'){
        const workspace=node('div','cs-employee-profile-workspace'),main=node('div','cs-employee-profile-main'),calendar=options.calendar;let dayAgenda=null;
        if(!calendar){const unavailable=node('section','cs-employee-profile-surface cs-employee-profile-calendar-error');unavailable.append(node('h3','cs-employee-profile-section-title','Kalenderen er ikke tilgængelig'),node('p','cs-employee-profile-help',options.error||'Vagterne kunne ikke indlæses. Medarbejderens oplysninger er stadig tilgængelige.'));main.append(unavailable);}
        else{
          const surface=node('section','cs-employee-profile-surface cs-employee-profile-calendar'),toolbar=node('header','cs-employee-profile-calendar-head'),period=node('div'),monthTitle=node('h3','cs-employee-profile-month');
          monthTitle.append(node('span','',calendar.label.slice(0,-5)+' '),node('span','cs-employee-profile-month-year',calendar.month.slice(0,4)));period.append(monthTitle);
          const tools=node('div','cs-employee-profile-calendar-tools'),prev=button('Forrige måned',()=>onMonthChange?.(calendar.previousMonth),'cs-icon-button cs-chrome-quiet','month:prev'),next=button('Næste måned',()=>onMonthChange?.(calendar.nextMonth),'cs-icon-button cs-chrome-quiet','month:next');if(icon){prev.replaceChildren(icon('chevron-left'));next.replaceChildren(icon('chevron-right'));}else{prev.textContent='‹';next.textContent='›';}prev.disabled=!calendar.previousMonth||typeof onMonthChange!=='function';next.disabled=!calendar.nextMonth||typeof onMonthChange!=='function';const current=button('I dag',()=>{selectedDay=today();const month=selectedDay.slice(0,7);if(calendar.month===month)paint('month:today');return onMonthChange?.(month);},'cs-button cs-chrome-quiet','month:today');current.disabled=typeof onMonthChange!=='function';tools.append(prev,current,next);toolbar.append(period,tools);surface.append(toolbar);
          const summary=node('dl','cs-employee-profile-month-summary cs-employee-profile-month-totals');summary.setAttribute('aria-label','Planlagt i '+calendar.label.toLocaleLowerCase('da-DK'));
          for(const [label,value,unit] of [['Planlagte timer',formatHours(calendar.totalMinutes),'t'],['Vagter',calendar.shiftCount,''],['Arbejdsdage',calendar.workingDays,'']]){const metric=node('div'),valueNode=node('dd');valueNode.append(node('strong','',value));if(unit)valueNode.append(node('span','cs-employee-profile-metric-unit',' '+unit));metric.append(node('dt','',label),valueNode);summary.append(metric);}surface.append(summary);
          const weekdays=node('div','cs-employee-profile-weekdays');['Man','Tir','Ons','Tor','Fre','Lør','Søn'].forEach((label,index)=>{const weekday=node('span','',label);weekday.dataset.weekend=String(index>4);weekdays.append(weekday);});const grid=node('div','cs-employee-profile-grid');
          calendar.weeks.flat().forEach((day,index)=>{
            const cell=node('section','cs-employee-profile-day');cell.dataset.date=day.date;cell.dataset.inMonth=String(day.inMonth);cell.dataset.today=String(day.isToday);cell.dataset.selected=String(day.date===selectedDay);cell.dataset.weekend=String(index%7>4);cell.setAttribute('aria-label',dateLabel(day.date,true));
            const choose=()=>selectDay(day.date),dateButton=button(dateLabel(day.date,true)+(day.shifts.length?', '+day.shifts.length+(day.shifts.length===1?' vagt':' vagter'):''),choose,'cs-employee-profile-day-number','day:'+day.date);dateButton.textContent=String(Number(day.date.slice(-2)));dateButton.setAttribute('aria-pressed',String(day.date===selectedDay));if(day.isToday)dateButton.setAttribute('aria-current','date');cell.append(dateButton);
            day.shifts.slice(0,3).forEach(shift=>{
              const site=siteFor(shift.site),label=clockLabel(shift)+' · '+site.name,event=button(label,choose,'cs-employee-profile-calendar-shift','shift:'+shift.id);event.title=label;
              const time=node('strong','cs-employee-profile-event-time'),short=node('span','cs-employee-profile-time-short');
              short.append(node('span','',compactTime(shift.start)),node('span','','–'+compactTime(shift.end)));if(shift.end<shift.start)short.append(node('span','cs-employee-profile-time-overnight',' +1'));
              time.append(node('span','cs-employee-profile-time-full',clockLabel(shift)),short);event.replaceChildren(time,node('span','cs-employee-profile-event-site',site.name));cell.append(event);
            });
            if(day.shifts.length>3){const more=button('Vis alle '+day.shifts.length+' vagter',choose,'cs-employee-profile-more','more:'+day.date);more.textContent='+'+(day.shifts.length-3)+' vagter';cell.append(more);}grid.append(cell);
          });surface.append(weekdays,grid);main.append(surface);
          dayAgenda=agendaFor(calendar);
        }
        const aside=node('aside','cs-employee-profile-aside');aside.setAttribute('aria-label','Valgt dag og medarbejderoplysninger');if(dayAgenda)aside.append(dayAgenda);
        const facts=node('section','cs-employee-profile-surface cs-employee-profile-facts'),factsHead=node('header','cs-employee-profile-facts-head'),showInformation=button('Se alle',()=>showTab('information'),'cs-button cs-chrome-quiet','facts:information');showInformation.disabled=pending;showInformation.setAttribute('aria-label','Se alle medarbejderoplysninger');factsHead.append(node('h3','cs-employee-profile-section-title','Aftale og arbejdssted'),showInformation);facts.append(factsHead,information());
        const plan=planFor();if(plan&&Number.isFinite(plan.plannedMinutes)){const week=node('section','cs-employee-profile-week'),meter=node('div','cs-employee-profile-week-meter'),fill=node('span'),difference=plan.plannedMinutes-plan.targetMinutes,weekState=node('p','cs-employee-profile-week-state',difference===0?'Planlagt som aftalt':formatHours(Math.abs(difference))+' t '+(difference>0?'over':'under')+' aftalt');meter.setAttribute('aria-hidden','true');meter.dataset.state=difference>0?'over':'normal';fill.style.width=(plan.targetMinutes>0?Math.min(100,Math.max(0,plan.plannedMinutes/plan.targetMinutes*100)):plan.plannedMinutes>0?100:0)+'%';meter.append(fill);weekState.dataset.state=difference>0?'over':difference===0?'balanced':'under';week.append(node('h4','cs-employee-profile-section-title','Ugens plan'),node('p','cs-employee-profile-help',dateLabel(options.planning.weekStart)+' – '+dateLabel(options.planning.weekEnd)),node('p','cs-employee-profile-week-hours',formatHours(plan.plannedMinutes)+' / '+formatHours(plan.targetMinutes)+' t'),node('p','cs-employee-profile-help','Planlagt / aftalt pr. uge'),meter,weekState);facts.append(week);}aside.append(facts);workspace.append(main,aside);content.append(workspace);
      }else if(activeTab==='information'){
        const surface=node('section','cs-employee-profile-surface cs-employee-profile-information');surface.append(node('h3','cs-employee-profile-section-title',editing?'Rediger medarbejder':'Medarbejderoplysninger'));
        if(editing){Object.values(controls).forEach(control=>{control.disabled=pending||!options.canEdit;});save.disabled=pending||!options.canEdit;cancel.disabled=pending;save.textContent=pending?'Gemmer…':'Gem medarbejder';surface.append(form);}
        else{
          const groups=node('div','cs-employee-profile-information-grid'),identityGroup=node('section','cs-employee-profile-information-group'),agreementGroup=node('section','cs-employee-profile-information-group');
          identityGroup.append(node('h4','cs-employee-profile-section-title','Stamoplysninger'),details([['Navn',person.name],['Initialer',person.initials],['Funktion',person.role],['Status',person.active===false?'Arkiveret':'Aktiv']]));
          agreementGroup.append(node('h4','cs-employee-profile-section-title','Arbejdstid og arbejdssted'),information());
          groups.append(identityGroup,agreementGroup);
          const appLogin=appLoginSection();if(appLogin)groups.append(appLogin);
          surface.append(groups);
        }
        content.append(surface);
      }else if(options.canViewPayroll===true&&options.payrollElement){content.append(options.payrollElement);}
      else{const pay=node('section','cs-employee-profile-surface cs-employee-profile-pay'),payIcon=node('span','cs-employee-profile-pay-icon','kr.');payIcon.setAttribute('aria-hidden','true');pay.append(payIcon,node('h3','cs-employee-profile-section-title','Løn er ikke sat op'),node('p','cs-employee-profile-pay-copy','Der er ikke registreret lønoplysninger eller tillæg for medarbejderen.'),node('p','cs-employee-profile-help','Du kan fortsat planlægge vagter og se de aftalte ugentlige timer under Oplysninger.'));content.append(pay);}
      page.replaceChildren(header,tabs,content);page.scrollTop=scrollTop;if(focus){const target=[...page.querySelectorAll('button,input,select,textarea,h2,h3')].find(item=>item.dataset.profileFocus===focus);target?.focus({preventScroll:true});}
    }
    function render(next={}){
      if(disposed)return;const incoming=Object.hasOwn(next,'person')?next.person:person,changed=Boolean(incoming?.id!==person?.id);
      if(changed){epoch++;pending=false;editing=false;before=null;activeTab='calendar';selectedDay=null;lastMonth=null;saveMessage='';discardStartCode();discardAppLoginControls();options={...options,appLogin:null};}
      if(incoming?.active===false&&person?.active!==false){
        discardStartCode();
        if(appLoginConfirmation?.action==='resetAppLogin')appLoginConfirmation=null;
      }
      if(Object.hasOwn(next,'appLogin')){
        const previous=options.appLogin?.account,account=next.appLogin?.account;
        if(!account?.canRevealStartCode||account.version!==previous?.version||account.personId!==previous?.personId)discardStartCode();
        if(!next.appLogin)discardAppLoginControls();
        else if(appLoginConfirmation&&account?.version!==appLoginConfirmation.version)appLoginConfirmation=null;
      }
      options={...options,...next};person=incoming?clone(incoming):null;
      if(!options.canEdit&&!pending){editing=false;before=null;}if(activeTab==='pay'&&options.canViewPayroll!==true)activeTab='calendar';
      const calendar=options.calendar;if(calendar&&(changed||calendar.month!==lastMonth||!calendar.byDate?.[selectedDay])){selectedDay=calendar.weeks.flat().find(day=>day.inMonth&&day.isToday)?.date||calendar.weeks.flat().find(day=>day.inMonth&&day.shifts.length)?.date||calendar.weeks.flat().find(day=>day.inMonth)?.date||null;lastMonth=calendar.month;}
      paint(changed?'title':undefined);
    }
    return Object.freeze({
      render,openEditor,clearAppLoginCode,
      showInformation(){showTab('information');},
      showPayroll(){showTab('pay',false);},
      reset(){clearAppLoginCode();epoch++;pending=false;editing=false;before=null;activeTab='calendar';selectedDay=null;lastMonth=null;saveMessage='';options={...options,appLogin:null};},
      destroy(){disposed=true;discardStartCode();discardAppLoginControls();epoch++;doc.defaultView?.removeEventListener?.('pagehide',clearAppLoginCode);doc.removeEventListener?.('visibilitychange',onVisibilityChange);element.replaceChildren();}
    });
  }
  const api=Object.freeze({mount});globalThis.CleanRoomsEmployeeProfileView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
