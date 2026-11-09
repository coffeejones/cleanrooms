/* Whole-company payroll closure. Every total and export comes from the server. */
(() => {
  'use strict';
  let sequence=0;
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const day=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'—';
  const addDays=(value,count)=>{const result=new Date(value+'T12:00:00Z');result.setUTCDate(result.getUTCDate()+count);return result.toISOString().slice(0,10);};
  const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK'}).format(value/100):'—';
  const minutes=value=>Number.isSafeInteger(value)?Math.floor(value/60)+' t'+(value%60?' '+value%60+' min':''):'—';
  const stamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('da-DK',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Copenhagen'}):'';};
  function open({element,date,onAction,onChanged,onClose}={}) {
    if(!element?.ownerDocument||typeof onAction!=='function')throw new TypeError('Lønperioden kræver adgang til kontoen.');
    const doc=element.ownerDocument,previous=doc.activeElement,id='cs-payroll-period-'+ ++sequence;
    let profilePanel=null,profileGeneration=0,profiles=[],profileId='standard-v1',profileError='';
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
      if(disposed||busy)return;selection=typeof next==='string'?{date:next}:{from:next.from,to:next.to};anchor=selection.date||selection.from;const token=++epoch,profileToken=++profileGeneration;busy=true;data=null;error='';message='';confirmation=null;reason='';paint();
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
      previousPeriod.setAttribute('aria-label','Forrige lønperiode');nextPeriod.setAttribute('aria-label','Næste lønperiode');previousPeriod.disabled=nextPeriod.disabled=busy||!data;
      let period=node('strong','cs-payroll-period-range',data?day(data.from)+' – '+day(data.to):'Henter lønperiode…');
      if(data&&Array.isArray(data.recentPeriods)&&data.recentPeriods.length){
        period=node('select','cs-payroll-period-range');period.setAttribute('aria-label','Vælg lønperiode');period.disabled=busy;
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
        const blockers=node('section','cs-payroll-period-blockers');blockers.append(node('h4','','Afklar før afslutning'));const list=node('ul');for(const item of data.blockers){const line=node('li');line.append(node('span','',item.message),node('strong','',String(item.count)));list.append(line);}blockers.append(list);body.append(blockers);
      }else body.append(node('p','cs-payroll-period-caption',data.canClose?'Perioden er klar. Afslutning låser registreringerne og gemmer løngrundlaget.':'Perioden kan ikke afsluttes endnu.'));
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
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
      if(event.key==='Tab'){const controls=[...panel.querySelectorAll('button,input,textarea,select,summary')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}}
    });
    void load();panel.focus({preventScroll:true});
    return Object.freeze({destroy(){close(true);},get busy(){return busy;}});
  }
  const api=Object.freeze({open});globalThis.CleanRoomsPayrollPeriodView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
