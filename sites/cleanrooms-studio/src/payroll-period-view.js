/* Whole-company payroll closure. Every total and export comes from the server. */
(() => {
  'use strict';
  let sequence=0;
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const day=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'—';
  const addDays=(value,count)=>{const result=new Date(value+'T12:00:00Z');result.setUTCDate(result.getUTCDate()+count);return result.toISOString().slice(0,10);};
  const clock=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const inferredEndDate=(date,start,end)=>validDate(date)&&clock(start)&&clock(end)&&end<start?addDays(date,1):date;
  const nextDay=value=>clock(value.start)&&clock(value.end)&&value.end<value.start?' · +1 dag':'';
  const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK'}).format(value/100):'—';
  const minutes=value=>Number.isSafeInteger(value)?Math.floor(value/60)+' t'+(value%60?' '+value%60+' min':''):'—';
  const stamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('da-DK',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Copenhagen'}):'';};
  function open({element,date,onAction,onChanged,onClose,onNavigate}={}) {
    if(!element?.ownerDocument||typeof onAction!=='function')throw new TypeError('Lønperioden kræver adgang til kontoen.');
    const doc=element.ownerDocument,previous=doc.activeElement,id='cs-payroll-period-'+ ++sequence;
    let profilePanel=null,profileGeneration=0,profiles=[],profileId='standard-v1',profileError='';
    let manual=null,created=null;
    let disposed=false,epoch=0,busy=false,data=null,error='',message='',confirmation=null,reason='',anchor=validDate(date)?date:new Date().toISOString().slice(0,10),selection={date:anchor};
    const node=(tag,cls,text)=>{const value=doc.createElement(tag);if(cls)value.className=cls;if(text!==undefined)value.textContent=String(text);return value;};
    const button=(label,action,cls='cs-button',key)=>{const value=node('button',cls,label);value.type='button';value.disabled=busy;if(key)value.dataset.payrollPeriodFocus=key;value.addEventListener('click',()=>{if(!disposed&&!value.disabled)action();});return value;};
    const layer=node('div','cs-payroll-period-layer'),backdrop=button('Luk lønperiode',()=>close(),'cs-payroll-period-backdrop');backdrop.textContent='';backdrop.tabIndex=-1;backdrop.setAttribute('aria-hidden','true');
    const panel=node('section','cs-payroll-period-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby',id);panel.tabIndex=-1;
    const header=node('header','cs-payroll-period-header'),heading=node('div'),title=node('h3','','Afslut lønperiode'),subtitle=node('p','','Hele virksomheden');title.id=id;heading.append(title,subtitle);
    const dismiss=button('×',()=>close(),'cs-icon-button cs-quiet');dismiss.setAttribute('aria-label','Luk lønperiode');header.append(heading,dismiss);
    const body=node('div','cs-payroll-period-body'),footer=node('footer','cs-payroll-period-footer');panel.append(header,body,footer);layer.append(backdrop,panel);element.append(layer);
    function close(force=false){if(disposed||busy&&!force)return;disposed=true;epoch++;profilePanel?.destroy?.();profilePanel=null;layer.remove();onClose?.();if(previous?.isConnected)previous.focus?.({preventScroll:true});}
    function focus(key){[...panel.querySelectorAll('[data-payroll-period-focus]')].find(el=>el.dataset.payrollPeriodFocus===key)?.focus?.({preventScroll:true});}
    function accept(value){
      if(value&&typeof value==='object')value={...value,status:value.periodStatus??value.status};
      if(!value||!validDate(value.from)||!validDate(value.to)||!['open','closed'].includes(value.status)||!Array.isArray(value.blockers)||!Array.isArray(value.revisions)||!value.totals)throw Error('Lønperioden kunne ikke bekræftes. Hent den igen.');
      data=value;anchor=value.from;selection={from:value.from,to:value.to};
    }
    async function load(next=selection){
      if(disposed||busy)return;selection=typeof next==='string'?{date:next}:{from:next.from,to:next.to};anchor=selection.date||selection.from;const token=++epoch,profileToken=++profileGeneration;busy=true;data=null;error='';message='';confirmation=null;reason='';manual=null;created=null;paint();
      try{const [result,profileResult]=await Promise.all([onAction('payrollPeriodRead',selection),onAction('payrollExportProfilesRead',{})]);if(disposed||token!==epoch)return;if(profileToken===profileGeneration)acceptProfiles(profileResult);if(!result?.ok)throw Error(result?.message||'Lønperioden kunne ikke hentes.');accept(result);}
      catch(cause){if(!disposed&&token===epoch)error=cause?.message||'Lønperioden kunne ikke hentes.';}
      finally{if(!disposed&&token===epoch){busy=false;paint();}}
    }
    function acceptProfiles(result){
      if(!result?.ok||!Array.isArray(result.profiles)){profileError=result?.message||'Eksportprofiler kunne ikke opdateres.';return;}
      profiles=result.profiles.filter(profile=>profile.id!=='standard-v1');profileError='';
      if(profileId!=='standard-v1'&&!profiles.some(profile=>profile.id===profileId))profileId='standard-v1';
    }
    function editProfiles(){
      if(disposed||busy||!globalThis.CleanRoomsPayrollExportProfileView)return;
      profilePanel?.destroy?.();profilePanel=globalThis.CleanRoomsPayrollExportProfileView.open({element,profileId:profileId==='standard-v1'?undefined:profileId,onAction,onSaved:async value=>{
        if(disposed)return;const profileToken=++profileGeneration;if(value?.id&&Number.isSafeInteger(value.version)){profileId=value.id;profiles=[...profiles.filter(item=>item.id!==value.id),{id:value.id,name:value.name,version:value.version}];profileError='';paint();}
        const result=await onAction('payrollExportProfilesRead',{});if(disposed||profileToken!==profileGeneration)return;acceptProfiles(result);paint();
      },onClose:()=>{profilePanel=null;}});
    }
    function beginRegistration(shift){
      manual={shift,start:shift.start,end:shift.end,endDate:inferredEndDate(shift.date,shift.start,shift.end),endDateExplicit:false,pause:String(shift.plannedBreakMinutes??0),reason:''};created=null;error='';message='';paint();focus('manual:start');
    }
    const validManual=()=>manual&&/^([01]\d|2[0-3]):[0-5]\d$/.test(manual.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(manual.end)&&validDate(manual.endDate)&&Number.isSafeInteger(Number(manual.pause))&&Number(manual.pause)>=0&&manual.reason.trim().length>=3;
    async function saveRegistration(approve=false){
      if(disposed||busy||!data||(approve?!created:!validManual()))return;
      const token=++epoch,payload=approve?{operation:'approve',entryId:created.id,version:created.version}:{operation:'correct',shiftId:manual.shift.shiftId,personId:manual.shift.personId,version:0,start:manual.start,end:manual.end,endDate:manual.endDate,breakMinutes:Number(manual.pause),reason:manual.reason.trim()};
      busy=true;error='';message='';paint();
      try{const result=await onAction('timeWrite',payload);if(disposed||token!==epoch)return;if(!result?.ok){const failure=Error(result?.message||'Registreringen kunne ikke gemmes.');failure.confirmed=true;throw failure;}
        if(approve){created=null;manual=null;busy=false;await load(selection);if(disposed)return;message='Timerne er godkendt. Løngrundlaget er opdateret.';}
        else{const entry=result.entry;if(!entry||typeof entry.id!=='string'||!Number.isSafeInteger(entry.version)||entry.status!=='submitted'||entry.personId!==payload.personId||entry.shiftId!==payload.shiftId)throw Error('Registreringen kunne ikke bekræftes. Hent perioden igen, før du prøver igen.');const savedEntry={...entry,personName:manual.shift.personName};manual=null;busy=false;await load(selection);if(disposed)return;created=savedEntry;message='Registreringen er gemt. Kontrollér tiderne, før du godkender.';}
        onChanged?.();
      }catch(cause){if(!disposed){error=cause?.confirmed?cause.message:'Forbindelsen blev afbrudt. Registreringen kan være gemt. Hent perioden igen for at kontrollere status.';}}
      finally{if(!disposed){busy=false;paint();}}
    }
    function registrationContent(){
      const section=node('section','cs-payroll-period-registration');
      if(created){
        section.append(node('h4','','Kontrollér registreringen'),node('strong','',created.personName||'Medarbejder'),node('p','cs-payroll-period-caption',day(created.date)+' · '+created.start+'–'+created.end+(created.endDate&&created.endDate!==created.date?' · slut '+day(created.endDate):'')+' · '+created.breakMinutes+' min pause'),node('p','cs-payroll-period-caption',created.correctionReason||''));
        section.append(button('Godkend timer',()=>saveRegistration(true),'cs-button cs-primary','manual:approve'),button('Afslut uden godkendelse',()=>{created=null;void load(selection);},'cs-button cs-quiet','manual:later'));return section;
      }
      if(!manual)return null;
      section.append(node('h4','','Registrér timer'),node('strong','',manual.shift.personName),node('p','cs-payroll-period-caption',day(manual.shift.date)+' · '+manual.shift.start+'–'+manual.shift.end+nextDay(manual.shift)+' · '+manual.shift.siteName));
      const grid=node('div','cs-payroll-period-registration-grid'),inputs={};
      for(const [key,label,type] of [['start','Mødt kl.','time'],['end','Gået kl.','time'],['endDate','Slutdato','date'],['pause','Pause i minutter','number']]){
        const holder=node('label','cs-payroll-period-field'),input=node('input');input.type=type;input.value=manual[key];input.disabled=busy;input.dataset.payrollPeriodFocus='manual:'+key;inputs[key]=input;if(type==='number'){input.min='0';input.step='1';}input.addEventListener('input',()=>{manual[key]=input.value;if(key==='endDate')manual.endDateExplicit=true;else if((key==='start'||key==='end')&&!manual.endDateExplicit&&clock(manual.start)&&clock(manual.end)){manual.endDate=inferredEndDate(manual.shift.date,manual.start,manual.end);inputs.endDate.value=manual.endDate;}save.disabled=busy||!validManual();});holder.append(node('span','',label),input);grid.append(holder);
      }
      const holder=node('label','cs-payroll-period-field'),input=node('textarea');input.rows=3;input.maxLength=4000;input.value=manual.reason;input.disabled=busy;input.dataset.payrollPeriodFocus='manual:reason';input.addEventListener('input',()=>{manual.reason=input.value;save.disabled=busy||!validManual();});holder.append(node('span','','Begrundelse'),input);
      const save=button('Gem registrering',()=>saveRegistration(),'cs-button','manual:save');save.disabled=busy||!validManual();section.append(grid,holder,node('p','cs-payroll-period-caption','Gemte timer skal godkendes, før perioden kan afsluttes.'),save,button('Annuller',()=>{manual=null;paint();},'cs-button cs-quiet'));return section;
    }
    async function navigateProblem(code,target){
      if(disposed||busy||!data||typeof onNavigate!=='function'||!['unapproved','invalid_time','missing_payroll'].includes(code)||!target||!['hours','payroll-person'].includes(target.kind)||target.from!==data.from||target.to!==data.to)return;
      const token=++epoch,period={from:data.from,to:data.to};busy=true;error='';message='';paint();
      try{
        const result=await onAction('payrollPeriodRead',period);if(disposed||token!==epoch)return;if(!result?.ok){if([401,403].includes(result?.status)){data=null;manual=null;created=null;}throw Error(result?.message||'Adgangen til lønperioden kunne ikke bekræftes.');}accept(result);
        if(data.status!=='open'||data.from!==period.from||data.to!==period.to)throw Error('Lønperioden er ændret. Gennemgå den seneste version.');
        const blocker=data.blockers.find(item=>item.code===code&&item.count>0);let destination;
        if(target.entryId){const row=data.problemEntries?.[code]?.find(item=>item.entryId===target.entryId&&item.personId===target.personId);destination=row?.actions?.find(action=>action.kind===target.kind);}
        else if(target.kind==='hours')destination=blocker?.action;
        if(!blocker||!destination||destination.from!==period.from||destination.to!==period.to||target.kind==='hours'&&destination.problem!==code)throw Error('Problemet er ændret eller allerede afklaret. Listen er opdateret.');
        if(await onNavigate({...destination})===false){if(!disposed)throw Error('Siden kunne ikke åbnes. Kontrollér adgangen, og prøv igen.');return;}
        if(!disposed&&token===epoch)close(true);
      }catch(cause){if(!disposed&&token===epoch)error=cause?.message||'Problemet kunne ikke åbnes. Hent lønperioden igen.';}
      finally{if(!disposed&&token===epoch){busy=false;paint();}}
    }
    async function write(action,payload,success){
      if(disposed||busy||!data)return;const token=++epoch;busy=true;error='';message='';paint();
      try{const result=await onAction(action,payload);if(disposed||token!==epoch)return;
        if(!result?.ok){error=result?.message||'Lønperioden blev ikke ændret.';confirmation=null;return;}
        accept(result);confirmation=null;reason='';message=success;onChanged?.();
      }catch{if(!disposed&&token===epoch){error='Forbindelsen blev afbrudt. Hent perioden igen for at kontrollere, om ændringen blev gemt.';confirmation=null;}}
      finally{if(!disposed&&token===epoch){busy=false;paint();}}
    }
    async function download(revision){
      if(disposed||busy||!data)return;const token=++epoch;busy=true;error='';message='';paint();
      try{const result=await onAction('payrollPeriodDownload',{from:data.from,to:data.to,revision,profileId,...(profileId!=='standard-v1'?{profileVersion:profiles.find(item=>item.id===profileId)?.version}:{})});if(disposed||token!==epoch)return;if(!result?.ok)throw Error(result?.message||'Lønfilen kunne ikke hentes.');message='Download startet · '+(result.filename||'løngrundlag.csv');}
      catch(cause){if(!disposed&&token===epoch)error=cause?.message||'Lønfilen kunne ikke hentes.';}
      finally{if(!disposed&&token===epoch){busy=false;paint();}}
    }
    function paint(){
      if(disposed)return;body.replaceChildren();footer.replaceChildren();panel.setAttribute('aria-busy',String(busy));dismiss.disabled=backdrop.disabled=busy;
      title.textContent=data?.status==='closed'?'Afsluttet lønperiode':'Afslut lønperiode';
      const nav=node('div','cs-payroll-period-nav'),previousPeriod=button('‹',()=>load(addDays(data.from,-1)),'cs-icon-button cs-quiet','previous'),nextPeriod=button('›',()=>load(addDays(data.to,1)),'cs-icon-button cs-quiet','next');
      previousPeriod.setAttribute('aria-label','Forrige lønperiode');nextPeriod.setAttribute('aria-label','Næste lønperiode');previousPeriod.disabled=nextPeriod.disabled=busy||!data||Boolean(manual||created);
      let period=node('strong','cs-payroll-period-range',data?day(data.from)+' – '+day(data.to):'Henter lønperiode…');
      if(data&&Array.isArray(data.recentPeriods)&&data.recentPeriods.length){
        period=node('select','cs-payroll-period-range');period.setAttribute('aria-label','Vælg lønperiode');period.disabled=busy||Boolean(manual||created);
        const list=[data,...data.recentPeriods],seen=new Set();for(const item of list){const key=item.from+'|'+item.to;if(seen.has(key))continue;seen.add(key);const option=node('option','',day(item.from)+' – '+day(item.to)+(item.periodStatus==='closed'||item.status==='closed'?' · Afsluttet':''));option.value=key;period.append(option);}period.value=data.from+'|'+data.to;
        period.addEventListener('change',()=>{const [from,to]=period.value.split('|');void load({from,to});});
      }
      nav.append(previousPeriod,period,nextPeriod);body.append(nav);
      if(error){const feedback=node('div','cs-payroll-period-error');feedback.setAttribute('role','alert');feedback.append(node('p','',error),button('Hent perioden igen',()=>load(anchor),'cs-button cs-quiet','retry'));body.append(feedback);}
      if(message){const feedback=node('p','cs-payroll-period-message',message);feedback.setAttribute('role','status');body.append(feedback);}
      if(!data){if(!error){const loading=node('p','cs-payroll-period-caption','Henter godkendte timer og løngrundlag…');loading.setAttribute('role','status');body.append(loading);}footer.append(button('Luk',()=>close(),'cs-button cs-quiet','close'));return;}
      const status=node('span','cs-payroll-period-status',data.status==='closed'?'Afsluttet':'Åben');status.dataset.state=data.status;body.append(status);
      const totals=data.totals,metrics=node('dl','cs-payroll-period-metrics');
      for(const [label,value] of [['Medarbejdere',String(totals.employeeCount)],['Godkendte timer',minutes(totals.workedMinutes)],['Bruttogrundlag',money(totals.totalCents)]]){const item=node('div');item.append(node('dt','',label),node('dd','',value));metrics.append(item);}body.append(metrics);
      const breakdown=node('div','cs-payroll-period-breakdown');
      for(const [label,value] of [['Timeløn',totals.baseCents],['Tillæg',totals.supplementCents],['Faste månedsbeløb',totals.monthlyCents]]){const row=node('div');row.append(node('span','',label),node('strong','',money(value)));breakdown.append(row);}body.append(breakdown);
      if(data.status==='closed'){
        const closure=data.closure;body.append(node('p','cs-payroll-period-caption','Afsluttet '+stamp(closure?.closedAt)+(closure?.closedBy?.name?' af '+closure.closedBy.name:'')+'. Version '+closure?.revision+'.'));
      }else if(data.blockers.length){
        const blockers=node('section','cs-payroll-period-blockers');blockers.append(node('h4','','Afklar før afslutning'));const list=node('ul');for(const item of data.blockers){
          const line=node('li'),actionable=typeof onNavigate==='function'&&item.action?.kind==='hours'&&['unapproved','invalid_time','missing_payroll'].includes(item.code),copy=actionable?button('',()=>navigateProblem(item.code,item.action),'cs-payroll-period-problem','problem:'+item.code):node('div','cs-payroll-period-problem-copy');copy.append(node('span','',item.message),node('strong','',String(item.count)));if(actionable)copy.setAttribute('aria-label',item.message+' '+item.count+' · Åbn timer');line.append(copy);
          if(typeof onNavigate==='function'&&item.code==='missing_payroll'&&Array.isArray(data.problemEntries?.missing_payroll)){
            const samples=node('div','cs-payroll-period-problem-people');for(const entry of data.problemEntries.missing_payroll){const row=node('div'),identity=node('div');identity.append(node('strong','',entry.personName||'Medarbejder'),node('span','cs-payroll-period-caption',day(entry.date)));row.append(identity);for(const target of entry.actions||[]){if(!['payroll-person','hours'].includes(target.kind))continue;row.append(button(target.kind==='payroll-person'?'Se lønaftale':'Åbn registrering',()=>navigateProblem(item.code,target),'cs-payroll-period-problem-link','problem:'+item.code+':'+target.kind+':'+entry.entryId));}samples.append(row);}if(item.count>data.problemEntries.missing_payroll.length)samples.append(node('p','cs-payroll-period-caption','De første '+data.problemEntries.missing_payroll.length+' vises her. Åbn timer for at se alle.'));line.append(samples);
          }list.append(line);
        }blockers.append(list);body.append(blockers);
      }else body.append(node('p','cs-payroll-period-caption',data.canClose?'Perioden er klar. Afslutning låser registreringerne og gemmer løngrundlaget.':'Perioden kan ikke afsluttes endnu.'));
      if(data.status==='open'&&data.canManage){
        if(manual||created)body.append(registrationContent());
        else if(Array.isArray(data.missingRegistrations)&&data.missingRegistrations.length){
          const missing=node('section','cs-payroll-period-missing');missing.append(node('h4','','Vagter uden registrering'));
          for(const shift of data.missingRegistrations){const row=node('div','cs-payroll-period-missing-row'),copy=node('div');copy.append(node('strong','',shift.personName),node('span','cs-payroll-period-caption',day(shift.date)+' · '+shift.start+'–'+shift.end+nextDay(shift)+' · '+shift.siteName));row.append(copy,button('Registrér timer',()=>beginRegistration(shift),'cs-button cs-quiet','missing:'+shift.shiftId));missing.append(row);}
          if(data.missingRegistrationCount>data.missingRegistrations.length)missing.append(node('p','cs-payroll-period-caption','Viser '+data.missingRegistrations.length+' af '+data.missingRegistrationCount+'. Flere vises, når disse er afklaret.'));body.append(missing);
        }
      }
      if(confirmation){
        const confirm=node('section','cs-payroll-period-confirm');
        if(confirmation==='close'){confirm.append(node('h4','','Afslut denne periode?'),node('p','','Timer og løngrundlag gemmes i en fast version. Det er denne version, der eksporteres.'));
          confirm.append(button('Afslut periode',()=>write('payrollPeriodClose',{from:data.from,to:data.to,previewToken:data.previewToken},'Lønperioden er afsluttet.'),'cs-button cs-primary','confirm-close'));
        }else{
          const label=node('label','cs-payroll-period-field'),input=node('textarea');input.rows=3;input.maxLength=2000;input.value=reason;input.disabled=busy;input.dataset.payrollPeriodFocus='reason';input.addEventListener('input',()=>{reason=input.value;save.disabled=busy||reason.trim().length<3;});label.append(node('span','','Begrundelse'),input);
          confirm.append(node('h4','','Genåbn til rettelse'),node('p','','Den tidligere eksport bevares. En ny version indeholder hele perioden. Afstem den tidligere import i lønsystemet, før den nye fil bruges.'),label);
          const save=button('Genåbn periode',()=>write('payrollPeriodReopen',{from:data.from,to:data.to,version:data.version,reason:reason.trim()},'Perioden er genåbnet. Den tidligere version er bevaret.'),'cs-button','confirm-reopen');save.disabled=busy||reason.trim().length<3;confirm.append(save);
        }
        confirm.append(button('Annuller',()=>{confirmation=null;reason='';paint();},'cs-button cs-quiet'));body.append(confirm);
      }
      const exportTools=node('div','cs-payroll-period-export-tools'),profileField=node('label','cs-payroll-period-profile-field'),profileSelect=node('select');profileSelect.disabled=busy;profileSelect.dataset.payrollPeriodFocus='profile';
      const standard=node('option','','Standard CSV');standard.value='standard-v1';profileSelect.append(standard);
      for(const profile of profiles){const option=node('option','',profile.name);option.value=profile.id;profileSelect.append(option);}profileSelect.value=profileId;profileSelect.addEventListener('change',()=>{profileId=profileSelect.value;message='';});profileField.append(node('span','','Eksportformat'),profileSelect);exportTools.append(profileField);
      if(data.canManage&&globalThis.CleanRoomsPayrollExportProfileView)exportTools.append(button('Tilpas eksport',editProfiles,'cs-button cs-quiet','profiles'));
      body.append(exportTools);if(profileError)body.append(node('p','cs-payroll-period-caption',profileError+' Standard CSV kan stadig bruges.'));
      if(data.revisions.length){const history=node('details','cs-payroll-period-history'),summary=node('summary','','Tidligere afslutninger · '+data.revisions.length);history.append(summary);
        for(const revision of [...data.revisions].reverse()){const row=node('div'),copy=node('div');copy.append(node('strong','','Version '+revision.revision),node('span','',stamp(revision.closedAt)));row.append(copy,button('Hent CSV',()=>download(revision.revision),'cs-button cs-quiet','revision:'+revision.revision));history.append(row);}body.append(history);}
      footer.append(button('Luk',()=>close(),'cs-button cs-quiet','close'));
      if(!confirmation){
        if(data.status==='closed'){
          if(data.canManage)footer.append(button('Genåbn',()=>{confirmation='reopen';paint();focus('reason');},'cs-button cs-quiet','reopen'));
          footer.append(button('Hent CSV',()=>download(data.closure.revision),'cs-button cs-primary','download'));
        }else if(data.canManage){const closeButton=button('Afslut periode',()=>{confirmation='close';paint();focus('confirm-close');},'cs-button cs-primary','finish');closeButton.disabled=busy||!data.canClose||!data.previewToken;footer.append(closeButton);}
      }
    }
    layer.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
      if(event.key==='Tab'){const controls=[...panel.querySelectorAll('button,input,textarea,select,summary')].filter(el=>!el.disabled&&!el.hidden&&el.tabIndex!==-1&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}}
    });
    void load();panel.focus({preventScroll:true});
    return Object.freeze({destroy(){close(true);},get busy(){return busy;}});
  }
  const api=Object.freeze({open});globalThis.CleanRoomsPayrollPeriodView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
