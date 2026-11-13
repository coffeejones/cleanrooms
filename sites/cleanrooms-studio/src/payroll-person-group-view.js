/* One employee's dated exceptions. Group assignment and raw personal pay stay separate. */
(() => {
  'use strict';
  const Model=globalThis.CleanRoomsPayrollGroups||(typeof require==='function'?require('./payroll-groups-model.js'):null);
  const Payroll=globalThis.CleanRoomsPayroll||(typeof require==='function'?require('./payroll-model.js'):null);
  const clone=value=>JSON.parse(JSON.stringify(value)),weekdays=['Man','Tir','Ons','Tor','Fre','Lør','Søn'];let sequence=0;
  const money=value=>new Intl.NumberFormat('da-DK').format(BigInt(value)/100n)+','+String(BigInt(value)%100n).padStart(2,'0')+' kr.';
  const inputMoney=value=>String(BigInt(value)/100n)+','+String(BigInt(value)%100n).padStart(2,'0');
  function cents(raw){const value=String(raw??'').trim(),match=value.length<=64&&value.match(/^((?:\d{1,3}(?:\.\d{3})+)|(?:\d{1,3}(?:[ \u00a0]\d{3})+)|\d+)(?:,(\d{1,2}))?$/);if(!match)throw Error('Skriv et beløb med komma og højst to decimaler, fx 25,50.');const result=BigInt(match[1].replace(/[. \u00a0]/g,''))*100n+BigInt((match[2]||'').padEnd(2,'0'));if(result>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Beløbet er for stort.');return Number(result);}
  const rate=value=>value?money(value.amountCents)+(value.type==='monthly'?' pr. måned':' pr. time'):'Grundløn mangler';
  const dateLabel=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'—';
  const activeOn=(value,date)=>value.from<=date&&(!value.to||value.to>=date);
  const rule=value=>value.type==='monthly'?'Fast månedligt tillæg':value.weekdays.map(day=>weekdays[day]).join(', ')+' · '+(value.start?value.start+'–'+value.end+(value.end<value.start?' · over midnat':''):'hele dagen');
  function validDate(value){try{Model.linkFor(null,'validation',value);return true;}catch{return false;}}
  function mount({element,onSave,onOpenGroups,onChangeGroup,onReload,onEditingChange}={}){
    if(!element?.ownerDocument||!Model||!Payroll)throw new TypeError('Individuelle lønvalg kræver et indholdsfelt og lønmodellerne.');
    const doc=element.ownerDocument,prefix='cs-person-pay-'+(++sequence)+'-',page=doc.createElement('section');page.className='cs-person-pay-group';element.replaceChildren(page);
    let options={},policy=Model.normalize(null),personal=Payroll.normalize(null),personId=null,date='',contextDate='',version=0,policyVersion=0,draft=null,review=null,pending=false,conflict=false,invalid=false,error='',notice='',disposed=false,epoch=0,reportedEditing=false;
    const node=(tag,className,text)=>{const item=doc.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=String(text);return item;};
    const button=(label,action,key,primary=false)=>{const item=node('button','cs-button cs-person-pay-button'+(primary?' cs-person-pay-primary':''),label);item.type='button';item.dataset.personPayFocus=key;item.addEventListener('click',event=>{if(!item.disabled&&!disposed)return action(event.currentTarget||item);});return item;};
    const writable=()=>options.canManage===true&&!pending&&!conflict&&!invalid&&Boolean(personId);
    function invalidate(){review=null;error='';notice='';}
    function field(name,label,type,value,action){const wrap=node('label','cs-person-pay-field'),control=node('input','cs-person-pay-input');control.id=prefix+name;control.type=type;control.value=value;control.dataset.personPayFocus=name;wrap.htmlFor=control.id;wrap.append(node('span','cs-person-pay-label',label),control);control.addEventListener(type==='text'?'input':'change',()=>{if(pending||disposed)return;action(control.value);invalidate();paint(name);});return {wrap,control};}
    function select(name,label,value,choices,action){const wrap=node('label','cs-person-pay-field'),control=node('select','cs-person-pay-input');control.id=prefix+name;control.dataset.personPayFocus=name;wrap.htmlFor=control.id;for(const [id,text] of choices){const option=node('option','',text);option.value=id;control.append(option);}control.value=value;wrap.append(node('span','cs-person-pay-label',label),control);control.addEventListener('change',()=>{if(pending||disposed)return;action(control.value);invalidate();paint(name);});return {wrap,control};}
    const linkAt=()=>Model.linkFor(policy,personId,date);
    const groupAt=()=>{const link=linkAt();return link?.groupId?Model.groupFor(policy,link.groupId,date):null;};
    function open(){if(!writable()||date<options.today)return;const link=linkAt();if(!link?.groupId)return;draft={personId,version,policyVersion,groupId:link.groupId,baseMode:link.baseMode,excluded:new Set(link.excludedPersonalSupplementIds),overrides:clone(link.supplementOverrides),amounts:Object.fromEntries(link.supplementOverrides.filter(item=>item.mode==='personal').map(item=>[item.id,inputMoney(item.supplement.amountCents)]))};review=null;error='';notice='';paint('base-mode');}
    function cancel(){if(pending)return;draft=null;review=null;conflict=false;error='';paint('edit');}
    function candidate(){
      if(!draft||!validDate(date)||date<options.today)throw Error('Tidligere datoer kan ses, men ikke ændres. Vælg i dag eller en kommende dato.');
      const current=linkAt();if(current?.groupId!==draft.groupId)throw Error('Medarbejderen har en anden løngruppe på denne dato. Ingen tildeling ændres her. Annuller og åbn valgene for den ønskede dato.');
      const overrides=draft.overrides.map(item=>{if(item.mode==='off')return clone(item);return {...clone(item),supplement:{...clone(item.supplement),amountCents:cents(draft.amounts[item.id])}};});
      const link={personId,from:date,groupId:draft.groupId,baseMode:draft.baseMode,excludedPersonalSupplementIds:[...draft.excluded].sort(),supplementOverrides:overrides};
      const next=Model.normalize({...clone(policy),links:[...policy.links.filter(item=>item.personId!==personId||item.from!==date),link]});
      return {link:Model.linkFor(next,personId,date),policy:next};
    }
    function preview(){if(!writable()||!draft)return;try{const next=candidate();review={...next,before:Model.resolve({policy,personId,payroll:personal,from:date,to:date}),after:Model.resolve({policy:next.policy,personId,payroll:personal,from:date,to:date})};error='';paint('save');}catch(problem){review=null;error=problem.message;paint();}}
    async function save(){
      if(!writable()||!draft||!review)return;if(draft.version!==version||draft.policyVersion!==policyVersion){conflict=true;error='Lønoplysningerne er ændret. Hent seneste oplysninger, før du gemmer.';paint();return;}
      const captured=draft,submitted=clone(review),token=++epoch;pending=true;error='';paint('save');
      try{
        if(typeof onSave!=='function')throw Error('De individuelle lønvalg kan ikke gemmes lige nu.');
        const result=await onSave({personId:captured.personId,version:captured.version,policyVersion:captured.policyVersion,link:clone(submitted.link)});
        if(disposed||token!==epoch||personId!==captured.personId)return;pending=false;
        if(result?.ok!==true){conflict=Boolean(result?.conflict||result?.status===409);error=result?.error||result?.message||'Valgene kunne ikke gemmes.';paint();return;}
        if(result.version!==captured.version||![captured.policyVersion,captured.policyVersion+1].includes(result.policyVersion)||version!==captured.version||policyVersion>result.policyVersion)throw Error('Gemningen kunne ikke bekræftes. Hent seneste oplysninger.');
        const confirmed=Model.normalize(result.policy||submitted.policy);
        if(JSON.stringify(confirmed)!==JSON.stringify(submitted.policy)||result.policyVersion===captured.policyVersion&&(!result.policy||JSON.stringify(policy)!==JSON.stringify(confirmed)))throw Error('Gemningen kunne ikke bekræftes. Hent seneste oplysninger.');
        if(policyVersion===result.policyVersion&&JSON.stringify(policy)!==JSON.stringify(confirmed))throw Error('En anden ændring er modtaget. Hent seneste oplysninger.');
        policy=confirmed;policyVersion=result.policyVersion;options={...options,policy,policyVersion};draft=null;review=null;conflict=false;notice='De individuelle lønvalg er gemt fra '+date+'.';paint('edit');
      }catch(problem){if(disposed||token!==epoch)return;pending=false;error=problem.message||'Valgene kunne ikke gemmes.';if(/bekræftes|seneste|anden ændring/.test(error))conflict=true;paint();}
    }
    async function reload(){if(pending||typeof onReload!=='function')return;const token=++epoch;pending=true;error='';paint();try{await onReload();if(disposed||token!==epoch)return;pending=false;draft=null;review=null;conflict=false;notice='Lønoplysningerne er hentet igen.';paint('edit');}catch(problem){if(disposed||token!==epoch)return;pending=false;error=problem.message||'Oplysningerne kunne ikke hentes.';paint();}}
    function paint(requestedFocus){
      if(disposed)return;if(Boolean(draft)!==reportedEditing){reportedEditing=Boolean(draft);onEditingChange?.(reportedEditing);}const active=element.contains?.(doc.activeElement)?doc.activeElement:null,focus=requestedFocus||active?.dataset?.personPayFocus,selection=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
      const parts=[],head=node('header','cs-person-pay-head'),headActions=node('div','cs-person-pay-head-actions');
      head.append(node('h3','cs-person-pay-title',draft?'Individuelle lønvalg':'Aktuel lønaftale'));
      if(typeof onOpenGroups==='function'){const openGroups=button(validDate(date)&&personId&&Model.linkFor(policy,personId,date)?.groupId?'Åbn løngruppe':'Åbn løngrupper',()=>onOpenGroups(personId,{groupId:validDate(date)?Model.linkFor(policy,personId,date)?.groupId||null:null,date}),'groups');openGroups.disabled=pending;headActions.append(openGroups);}
      if(typeof onChangeGroup==='function'&&options.canManageGroups===true){const changeGroup=button('Skift løngruppe',()=>onChangeGroup(personId),'change-group');changeGroup.disabled=pending||Boolean(draft);headActions.append(changeGroup);}head.append(headActions);parts.push(head);
      if(!personId){parts.push(node('p','cs-person-pay-help','Vælg en medarbejder.'));finish();return;}
      if(invalid){parts.push(node('p','cs-person-pay-error',error||'Lønvalgene kunne ikke læses sikkert.'));finish();return;}
      const agreementPanel=node('section','cs-person-pay-agreement');
      const dateField=field('date',draft?'Gælder fra':'Aftale pr. dato','date',date,value=>date=value);
      dateField.control.disabled=pending;
      const dateBar=node('div','cs-person-pay-datebar');
      dateBar.append(dateField.wrap);
      if(validDate(date)&&date<options.today)dateBar.append(node('p','cs-person-pay-help','Tidligere dato · oplysningerne er skrivebeskyttede.'));
      agreementPanel.append(dateBar);
      parts.push(agreementPanel);
      if(error){const message=node('div','cs-person-pay-error');message.setAttribute('role','alert');message.append(node('p','',error));if(conflict&&draft)message.append(node('p','cs-person-pay-help','Din kladde er bevaret. Hentning af de seneste oplysninger lukker kladden.'));if(typeof onReload==='function'){const retry=button('Hent seneste oplysninger',reload,'reload');retry.disabled=pending;message.append(retry);}parts.push(message);}
      if(notice){const message=node('p','cs-person-pay-success',notice);message.setAttribute('role','status');parts.push(message);}
      if(!validDate(date)){parts.push(node('p','cs-person-pay-error','Vælg en gyldig dato.'));finish();return;}
      const current=linkAt(),group=groupAt(),resolved=Model.resolve({policy,personId,payroll:personal,from:date,to:date}),agreement=resolved.payroll.agreements.at(-1),summary=node('div','cs-person-pay-summary');
      const rawAgreement=(resolved.personalBase?personal.agreements:group?.revision?.payroll.agreements||[]).filter(value=>value.from<=date).at(-1),effectiveFrom=[rawAgreement?.from,current?.from,...(!resolved.personalBase?[group?.revision?.from]:[])].filter(Boolean).sort().at(-1);
      const baseSummary=node('div','cs-person-pay-base');baseSummary.append(node('span','cs-person-pay-label','Grundløn'),node('strong','cs-person-pay-base-amount',resolved.missingBasePeriods.length?'Grundløn mangler':rate(agreement)));
      const facts=node('dl','cs-person-pay-facts');for(const [label,value] of [['Løngruppe',group?.name||'Ingen løngruppe'],['Kilde',resolved.personalBase?'Personlig grundløn':'Grundløn fra gruppen'],['Gælder fra',effectiveFrom?dateLabel(effectiveFrom):'Ikke oprettet']]){const fact=node('div');fact.append(node('dt','',label),node('dd','',value));facts.append(fact);}summary.append(baseSummary,facts);if(group?.archived)summary.append(node('p','cs-person-pay-help','Arkiveret gruppe · tidligere tilknytning bevares'));
      agreementPanel.append(summary);
      if(!draft){
        const allowances=node('section','cs-person-pay-read-rules'),allowanceHead=node('div','cs-person-pay-allowance-head');allowanceHead.append(node('h4','cs-person-pay-subtitle','Tillæg på aftalen'));if(group&&options.canManage===true&&date>=options.today){const edit=button('Rediger individuelle valg',open,'edit');edit.disabled=!writable();allowanceHead.append(edit);}allowances.append(allowanceHead);
        let allowanceCount=0;
        const appendAllowance=(supplement,value,state,source)=>{if(!activeOn(value,date))return;allowanceCount++;const row=node('div','cs-person-pay-read-rule'),identity=node('div'),amount=node('div','cs-person-pay-read-amount');row.dataset.state=state;identity.append(node('strong','',supplement.name),node('span','cs-person-pay-help',rule(value)),node('span','cs-person-pay-period',dateLabel(value.from)+(value.to?' – '+dateLabel(value.to):' og frem')));amount.append(node('strong','',rate(value)),node('span','cs-person-pay-state',source));row.append(identity,amount);allowances.append(row);};
        for(const supplement of group?.revision?.payroll.supplements||[]){const override=current.supplementOverrides.find(item=>item.id===supplement.id),value=override?.mode==='personal'?override.supplement:supplement,state=override?.mode||'follow';appendAllowance(supplement,value,state,state==='personal'?'Personligt beløb':state==='off'?'Fravalgt':'Fra gruppen');}
        for(const supplement of personal.supplements){const excluded=current?.excludedPersonalSupplementIds.includes(supplement.id);appendAllowance(supplement,supplement,excluded?'off':'personal',excluded?'Fravalgt':'Personligt ekstra');}
        if(!allowanceCount)allowances.append(node('p','cs-person-pay-help cs-person-pay-no-allowances','Ingen tillæg på den valgte dato.'));parts.push(allowances);
        finish();return;
      }
      const form=node('div','cs-person-pay-form');form.setAttribute('aria-busy',String(pending));
      const base=select('base-mode','Grundløn',draft.baseMode,[['group','Følg gruppens grundløn'],['personal','Behold personlig grundløn']],value=>draft.baseMode=value);base.control.disabled=!writable();form.append(base.wrap,node('p','cs-person-pay-help','Valget ændrer hele grundlønnen. Den personlige lønaftale bliver ikke overskrevet.'));
      if(draft.baseMode==='personal'&&!personal.agreements.some(agreement=>agreement.from<=date))form.append(node('p','cs-person-pay-warning','Der er ingen personlig grundløn på den valgte dato. Valget giver et ufuldstændigt løngrundlag. Opret en personlig lønaftale, eller følg gruppens grundløn.'));
      const rules=node('fieldset','cs-person-pay-rules');rules.append(node('legend','cs-person-pay-subtitle','Gruppens tillæg'));
      for(const supplement of group.revision?.payroll.supplements||[]){
        const override=draft.overrides.find(item=>item.id===supplement.id),mode=override?.mode||'follow',row=node('div','cs-person-pay-rule'),identity=node('div');identity.append(node('strong','',supplement.name),node('span','cs-person-pay-help',rule(supplement)),node('span','cs-person-pay-help',rate(supplement)));row.append(identity);
        const choice=select('mode:'+supplement.id,'Valg for '+supplement.name,mode,[['follow','Følg gruppen'],['off','Fravælg'],['personal','Personligt beløb']],value=>{const existing=draft.overrides.find(item=>item.id===supplement.id);draft.overrides=draft.overrides.filter(item=>item.id!==supplement.id);if(value==='off')draft.overrides.push({id:supplement.id,mode:'off',supplement:null});if(value==='personal'){const replacement=existing?.mode==='personal'?existing.supplement:clone(supplement);draft.overrides.push({id:supplement.id,mode:'personal',supplement:clone(replacement)});draft.amounts[supplement.id]??=inputMoney(replacement.amountCents);}});choice.control.disabled=!writable();row.append(choice.wrap);
        if(mode==='personal'){const amount=field('amount:'+supplement.id,'Personligt beløb i kroner','text',draft.amounts[supplement.id]||'',value=>draft.amounts[supplement.id]=value);amount.control.inputMode='decimal';amount.control.maxLength=64;amount.control.disabled=!writable();row.append(amount.wrap,node('p','cs-person-pay-help','Ugedage, tidsrum og gyldighed bevares fra den kopierede regel.'));}rules.append(row);
      }
      if(!(group.revision?.payroll.supplements||[]).length)rules.append(node('p','cs-person-pay-help','Ingen gruppetillæg gælder på datoen.'));form.append(rules);
      const extras=node('fieldset','cs-person-pay-rules');extras.append(node('legend','cs-person-pay-subtitle','Personlige ekstratillæg'));
      for(const supplement of personal.supplements){const label=node('label','cs-person-pay-check'),check=node('input');check.type='checkbox';check.checked=!draft.excluded.has(supplement.id);check.disabled=!writable();check.dataset.personPayFocus='personal:'+supplement.id;check.addEventListener('change',()=>{if(!writable())return;if(check.checked)draft.excluded.delete(supplement.id);else draft.excluded.add(supplement.id);invalidate();paint('personal:'+supplement.id);});const text=node('span');text.append(node('strong','',supplement.name),node('span','cs-person-pay-help',rate(supplement)+' · '+rule(supplement)));label.append(check,text);extras.append(label);}
      if(!personal.supplements.length)extras.append(node('p','cs-person-pay-help','Ingen personlige ekstratillæg er registreret.'));form.append(extras);
      const actions=node('div','cs-person-pay-actions'),cancelButton=button('Annuller',cancel,'cancel'),previewButton=button('Se ændringer',preview,'preview');cancelButton.disabled=pending;previewButton.disabled=!writable()||date<options.today;actions.append(cancelButton,previewButton);form.append(actions);parts.push(form);
      if(review){const previewBox=node('section','cs-person-pay-preview');previewBox.append(node('h5','cs-person-pay-subtitle','Ændring fra '+date));const columns=node('div','cs-person-pay-preview-columns');for(const [label,value] of [['Før ændringen',review.before],['Efter ændringen',review.after]]){const side=node('div');side.append(node('span','cs-person-pay-label',label),node('strong','',value.missingBasePeriods.length?'Grundløn mangler':rate(value.payroll.agreements.at(-1))),node('span','cs-person-pay-help',value.personalBase?'Personlig grundløn':'Gruppens grundløn'));for(const supplement of value.payroll.supplements)side.append(node('span','cs-person-pay-help',supplement.name+' · '+rate(supplement)));columns.append(side);}previewBox.append(columns);if(review.after.missingBasePeriods.length)previewBox.append(node('p','cs-person-pay-warning','Der mangler personlig grundløn fra denne dato. Den planlagte løn er ufuldstændig.'));const saveButton=button(pending?'Gemmer…':'Gem individuelle valg',save,'save',true);saveButton.disabled=!writable();previewBox.append(saveButton);parts.push(previewBox);}
      finish();
      function finish(){page.replaceChildren(...parts);if(focus){const control=[...page.querySelectorAll('button,input,select')].find(item=>item.dataset.personPayFocus===focus);control?.focus({preventScroll:true});if(selection&&control?.setSelectionRange)try{control.setSelectionRange(...selection);}catch{}}}
    }
    function render(next={}){
      if(disposed)return;options={...options,...next};const nextPerson=options.person?.id||null,nextContext=validDate(options.contextDate)?options.contextDate:options.today||'';
      if(nextPerson!==personId){epoch++;personId=nextPerson;draft=null;review=null;pending=false;conflict=false;error='';notice='';date=nextContext;}
      else if(!draft&&contextDate!==nextContext)date=nextContext;
      contextDate=nextContext;
      try{policy=Model.normalize(options.policy);personal=Payroll.normalize(options.payroll);invalid=!validDate(options.today)||!Number.isSafeInteger(options.version??0)||!Number.isSafeInteger(options.policyVersion??0)||(options.version??0)<0||(options.policyVersion??0)<0;if(invalid)throw Error();version=options.version??0;policyVersion=options.policyVersion??0;}
      catch{invalid=true;error='Lønvalgene kunne ikke læses sikkert. Hent oplysningerne igen.';}
      if(options.canManage!==true){epoch++;draft=null;review=null;pending=false;conflict=false;}
      else if(draft&&!pending&&(draft.version!==version||draft.policyVersion!==policyVersion)){conflict=true;review=null;error='Lønoplysningerne er ændret. Hent seneste oplysninger, før du gemmer.';}
      paint();
    }
    return Object.freeze({render,destroy(){disposed=true;epoch++;if(reportedEditing){reportedEditing=false;onEditingChange?.(false);}options={};policy=Model.normalize(null);personal=Payroll.normalize(null);draft=null;review=null;element.replaceChildren();}});
  }
  const api=Object.freeze({mount});globalThis.CleanRoomsPayrollPersonGroupView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
