/* Company settings use the same persisted identity fields as the planning workspace. */
(() => {
  'use strict';
  const Roster=globalThis.CleanRoomsRoster||(typeof require==='function'?require('./roster-model.js'):null);
  const PayrollPeriod=globalThis.CleanRoomsPayrollPeriod||(typeof require==='function'?require('./payroll-period-model.js'):null);
  const Time=globalThis.CleanRoomsTimekeeping||(typeof require==='function'?require('./timekeeping-model.js'):null);
  function payrollPeriodPreview(startDay,referenceDate=Time.localNow().date){
    const period=PayrollPeriod.periodFor(referenceDate,{startDay}),label=value=>new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
    return 'Denne periode: '+label(period.from)+' – '+label(period.to);
  }
  let sequence=0;
  function mount({element,onSave,onNavigate,onDemoChange,onSaveSiteGps,onLookupSiteAddress,onSaveBudget}={}){
    if(!element?.ownerDocument)throw new TypeError('Indstillinger kræver et indholdsfelt.');
    const doc=element.ownerDocument,suffix=++sequence===1?'':'-'+sequence,keys=['companyName','productName','contactName','contactEmail','contactPhone','brandNote'];
    let settings={},stats={},canEdit=false,pending=false,demoPending=false,disposed=false,dirty=false,loaded=false,epoch=0,demoEpoch=0,snapshot='';
    element.classList.add('cs-product-host');
    const node=(tag,className,text)=>{const item=doc.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;};
    const button=(label,action,className='cs-button')=>{const item=node('button',className,label);item.type='button';item.addEventListener('click',action);return item;};
    const cleanSettings=value=>({
      ...Object.fromEntries(keys.map(key=>[key,typeof value?.[key]==='string'?value[key]:''])),
      workHoursBudget:Roster.validWorkHoursBudget(value?.workHoursBudget)?value.workHoursBudget:null,
      payrollPeriod:{startDay:Number.isInteger(value?.payrollPeriod?.startDay)&&value.payrollPeriod.startDay>=1&&value.payrollPeriod.startDay<=31?value.payrollPeriod.startDay:26}
    });
    const page=node('div','cs-workspace-guide cs-product-page'),setup=node('div','cs-workspace-setup cs-settings-layout');setup.id='cs-workspace-setup'+suffix;page.append(setup);
    const form=node('form','cs-workspace-settings-form cs-settings-form');form.id='cs-workspace-settings-form'+suffix;form.noValidate=true;const fields={};
    const error=node('p','cs-product-error');error.id='cs-workspace-settings-error'+suffix;error.hidden=true;error.setAttribute('role','alert');
    const saveStatus=node('p','cs-product-save-status');saveStatus.hidden=true;saveStatus.setAttribute('role','status');saveStatus.setAttribute('aria-live','polite');
    const incomingNote=node('p','cs-product-notice');incomingNote.hidden=true;incomingNote.setAttribute('role','status');const permissionNote=node('p','cs-product-help');
    const field=(key,label,type='text',placeholder='')=>{const holder=node('label','cs-product-field'),input=node(type==='textarea'?'textarea':'input','cs-product-input');input.id='cs-workspace-'+key+suffix;if(type==='textarea')input.rows=4;else input.type=type;input.placeholder=placeholder;input.autocomplete=key==='companyName'?'organization':key==='contactName'?'name':key==='contactEmail'?'email':key==='contactPhone'?'tel':'off';holder.append(node('span','cs-product-field-label',label),input);fields[key]=input;input.addEventListener('input',()=>{dirty=true;saveStatus.hidden=true;error.hidden=true;});return holder;};
    function section(title,caption){const section=node('section','cs-settings-section'),heading=node('div','cs-settings-section-heading'),content=node('div','cs-settings-section-fields');heading.append(node('h3','cs-product-heading',title),node('p','cs-product-caption',caption));section.append(heading,content);return {section,content};}
    const identity=section('Virksomhed','Navnet vises i navigationen og identificerer jeres arbejdsområde.');identity.section.id='cs-workspace-settings'+suffix;
    const names=node('div','cs-product-field-pair');names.append(field('companyName','Virksomhedsnavn','text','CleanRooms'),field('productName','Produktnavn','text','CleanRooms Studio'));identity.content.append(names,field('brandNote','Beskrivelse · valgfrit','textarea','En kort beskrivelse af virksomheden'));
    const contact=section('Kontaktoplysninger','Valgfrie oplysninger om den interne kontaktperson.');const contactPair=node('div','cs-product-field-pair');contactPair.append(field('contactName','Kontaktperson'),field('contactEmail','E-mail','email'));contact.content.append(contactPair,field('contactPhone','Telefon','tel'));
    const payrollPeriod=section('Lønperiode','Bruges til medarbejdernes timer og lønoverblik.');
    const periodMode=node('select','cs-product-input'),periodStart=node('select','cs-product-input'),periodFields=node('div','cs-product-field-pair'),periodPreview=node('p','cs-product-help cs-settings-payroll-preview'),periodClamp=node('p','cs-product-help cs-settings-payroll-clamp');
    periodMode.id='cs-workspace-payroll-period-mode'+suffix;periodStart.id='cs-workspace-payroll-period-start'+suffix;
    for(const [value,label]of [['calendar','Kalendermåned'],['custom','Fra en bestemt dato']]){const option=node('option','',label);option.value=value;periodMode.append(option);}
    for(let day=1;day<=31;day++){const option=node('option','',String(day)+'.');option.value=String(day);periodStart.append(option);}
    const periodModeField=node('label','cs-product-field'),periodStartField=node('label','cs-product-field');periodModeField.append(node('span','cs-product-field-label','Lønperiode'),periodMode);periodStartField.append(node('span','cs-product-field-label','Startdag i måneden'),periodStart);
    periodPreview.id='cs-workspace-payroll-period-preview'+suffix;periodPreview.setAttribute('aria-live','polite');periodStart.setAttribute('aria-describedby',periodPreview.id);
    periodClamp.textContent='I korte måneder bruges månedens sidste dag.';
    periodFields.append(periodModeField,periodStartField);payrollPeriod.content.append(periodFields,periodPreview,periodClamp);
    function previewPeriod(){const day=periodMode.value==='calendar'?1:Number(periodStart.value);periodStartField.hidden=periodMode.value==='calendar';periodPreview.textContent=Number.isInteger(day)&&day>=1&&day<=31?payrollPeriodPreview(day):'Vælg en gyldig startdag';periodClamp.hidden=day<29;}
    for(const input of [periodMode,periodStart])input.addEventListener('change',()=>{dirty=true;saveStatus.hidden=true;error.hidden=true;previewPeriod();});
    function fillSettings(){
      keys.forEach(key=>fields[key].value=settings[key]);
      const startDay=settings.payrollPeriod.startDay;periodMode.value=startDay===1?'calendar':'custom';periodStart.value=String(startDay===1?26:startDay);previewPeriod();
    }
    const actions=node('div','cs-product-form-actions cs-settings-save-row'),save=button('Gem oplysninger',()=>saveSettings(),'cs-button cs-primary');save.id='cs-workspace-settings-save'+suffix;actions.append(permissionNote,incomingNote,error,saveStatus,save);form.append(identity.section,payrollPeriod.section,contact.section,actions);setup.append(form);
    const budgetSection=node('div','cs-settings-budget-panel');
    const budgetView=globalThis.CleanRoomsWorkspaceBudgets?.mount({element:budgetSection,onSave:onSaveBudget});
    const gpsModel=globalThis.CleanRoomsDepartments;
    const gpsSection=section('Arbejdssteder','Vælg, hvor tæt medarbejderne skal være på arbejdsstedet, når de stempler ind.');
    gpsSection.section.classList.add('cs-settings-gps');
    const gpsForm=node('form','cs-settings-gps-form');gpsForm.noValidate=true;
    const gpsSite=node('select','cs-product-input');
    const gpsToggle=node('input'),gpsToggleLabel=node('label','cs-settings-demo-control');
    gpsToggle.type='checkbox';
    const gpsToggleText=node('span');gpsToggleText.append(node('strong','','Kræv GPS ved indstempling'),node('span','cs-product-help','Medarbejderen skal være inden for den valgte radius.'));
    gpsToggleLabel.append(gpsToggle,gpsToggleText);
    const gpsAddressControl=node('div','cs-gps-address-control'),gpsAddressAnchor=node('div','cs-gps-address-anchor'),gpsAddress=node('input','cs-product-input'),gpsRadius=node('input','cs-product-input');
    const gpsSuggestions=node('div','cs-gps-address-suggestions'),gpsAddressStatus=node('p','cs-product-help cs-gps-address-status');
    gpsAddress.type='text';gpsAddress.id='cs-gps-address'+suffix;gpsAddress.maxLength=120;gpsAddress.autocomplete='off';gpsAddress.spellcheck=false;
    gpsAddress.placeholder='Fx Duehusvej 11';
    gpsAddress.setAttribute('role','combobox');gpsAddress.setAttribute('aria-autocomplete','list');gpsAddress.setAttribute('aria-expanded','false');
    gpsSuggestions.id='cs-gps-address-suggestions'+suffix;gpsSuggestions.hidden=true;gpsSuggestions.setAttribute('role','listbox');gpsSuggestions.setAttribute('aria-label','Adresseforslag');
    gpsAddress.setAttribute('aria-controls',gpsSuggestions.id);
    gpsAddressStatus.hidden=true;gpsAddressStatus.setAttribute('role','status');
    gpsRadius.type='number';gpsRadius.inputMode='numeric';gpsRadius.min=String(gpsModel?.GPS_MIN_RADIUS_METERS??1);gpsRadius.max=String(gpsModel?.GPS_MAX_RADIUS_METERS??1000);gpsRadius.step='1';
    const gpsField=(label,control)=>{const holder=node('label','cs-product-field');holder.append(node('span','cs-product-field-label',label),control);return holder;};
    const gpsHint=node('p','cs-product-help','Søg efter en dansk adresse, og vælg den i listen.');
    gpsHint.id='cs-workspace-gps-hint'+suffix;
    gpsAddress.setAttribute('aria-describedby',gpsHint.id);
    const gpsAddressUndo=button('Brug gemt adresse',()=>{restoreAddress(gpsSites.get(gpsSite.value));updateGpsControls();});
    gpsAddressUndo.classList.add('cs-gps-address-undo');gpsAddressUndo.hidden=true;
    gpsAddressAnchor.append(gpsField('Adresse',gpsAddress),gpsSuggestions);
    gpsAddressControl.append(gpsAddressAnchor,gpsHint,gpsAddressStatus,gpsAddressUndo);
    const gpsRadiusField=gpsField('Radius (meter)',gpsRadius);gpsRadiusField.classList.add('cs-settings-gps-radius');
    const gpsActions=node('div','cs-settings-gps-actions'),gpsSave=button('Gem GPS-indstillinger',()=>saveSiteGps(),'cs-button cs-primary');
    const gpsReload=button('Hent gemte værdier',()=>fillGps(gpsSites.get(gpsSite.value)));
    const gpsError=node('p','cs-product-error'),gpsStatus=node('p','cs-product-save-status'),gpsEmpty=node('p','cs-product-help','Der er endnu ingen arbejdssteder at indstille.');
    gpsError.setAttribute('role','alert');gpsStatus.setAttribute('role','status');
    gpsActions.append(gpsReload,gpsSave);
    gpsForm.append(gpsField('Arbejdssted',gpsSite),gpsAddressControl,gpsToggleLabel,gpsRadiusField,gpsError,gpsStatus,gpsActions);
    gpsSection.content.append(gpsForm,gpsEmpty);setup.append(gpsSection.section);
    const gpsInputs=[gpsToggle,gpsRadius];
    let gpsSites=new Map(),gpsSiteSnapshot='',gpsVisible=false,gpsReady=false,gpsDirty=false,gpsPending=false,gpsVersion=0,gpsEpoch=0;
    let addressEdited=false,addressSelection=null,addressResolving=false,addressEpoch=0,addressTimer,addressOptions=[],activeAddress=-1;
    function showAddressStatus(message=''){
      gpsAddressStatus.textContent=message;gpsAddressStatus.hidden=!message;
    }
    function highlightAddress(index){
      activeAddress=index;
      [...gpsSuggestions.children].forEach((option,position)=>option.setAttribute('aria-selected',String(position===index)));
      const option=gpsSuggestions.children[index];
      if(option){
        gpsAddress.setAttribute('aria-activedescendant',option.id);
        if(option.offsetTop<gpsSuggestions.scrollTop)gpsSuggestions.scrollTop=option.offsetTop;
        const bottom=option.offsetTop+option.offsetHeight;
        if(bottom>gpsSuggestions.scrollTop+gpsSuggestions.clientHeight)gpsSuggestions.scrollTop=bottom-gpsSuggestions.clientHeight;
      }
      else gpsAddress.removeAttribute('aria-activedescendant');
    }
    function showAddressOptions(show){
      const open=show&&addressOptions.length>0;
      gpsSuggestions.hidden=!open;
      gpsAddress.setAttribute('aria-expanded',String(open));
      if(!open)highlightAddress(-1);
    }
    function cancelAddressLookup(){
      addressEpoch++;clearTimeout(addressTimer);addressResolving=false;addressOptions=[];
      gpsSuggestions.replaceChildren();showAddressOptions(false);showAddressStatus();
    }
    function restoreAddress(site){
      cancelAddressLookup();addressEdited=false;addressSelection=null;
      gpsAddress.value=site?.gps?.address||site?.address||'';
    }
    function updateGpsControls(){
      const hasSite=gpsSites.has(gpsSite.value),stale=hasSite&&(gpsDirty||addressEdited)&&gpsSites.get(gpsSite.value)._directoryVersion!==gpsVersion;
      gpsSection.section.hidden=!gpsVisible;gpsForm.hidden=!hasSite;gpsEmpty.hidden=hasSite;
      for(const input of [gpsSite,...gpsInputs])input.disabled=!gpsReady||gpsPending;
      gpsAddress.disabled=!gpsReady||gpsPending||typeof onLookupSiteAddress!=='function';
      gpsAddressUndo.hidden=!addressEdited;gpsAddressUndo.disabled=gpsAddress.disabled;
      gpsSave.disabled=!gpsReady||gpsPending||addressEdited||!gpsDirty||stale;
      gpsSave.textContent=gpsPending?'Gemmer…':'Gem GPS-indstillinger';
      gpsReload.hidden=!stale;gpsReload.disabled=gpsPending;
      if(stale&&!gpsPending&&gpsError.hidden){gpsError.textContent='Arbejdsstedet er ændret. Hent de gemte værdier, før du gemmer.';gpsError.hidden=false;}
      gpsForm.setAttribute('aria-busy',String(gpsPending));
    }
    function fillGps(site){
      const value=gpsModel.normalizeGps(site?.gps);
      restoreAddress(site);
      gpsToggle.checked=value.enabled;gpsRadius.value=String(value.radiusMeters);
      gpsVersion=site?._directoryVersion||0;gpsDirty=false;gpsError.hidden=true;gpsStatus.hidden=true;
      updateGpsControls();
    }
    function renderGps(options){
      const visible=options.canManageSiteGps===true&&Boolean(gpsModel);
      if(!visible&&gpsVisible){gpsEpoch++;gpsPending=false;gpsDirty=false;restoreAddress(null);}
      gpsVisible=visible;gpsReady=visible&&options.gpsReady===true&&typeof onSaveSiteGps==='function';
      gpsSites=new Map(visible?(options.sites||[]).map(site=>[site.id,site]):[]);
      const previous=gpsSite.value,nextSnapshot=JSON.stringify([...gpsSites.values()].map(site=>[site.id,site.name,site.address]));
      if(nextSnapshot!==gpsSiteSnapshot){
        gpsSiteSnapshot=nextSnapshot;
        gpsSite.replaceChildren(...[...gpsSites.values()].map(site=>{const option=node('option','',site.address?site.name+' · '+site.address:site.name);option.value=site.id;return option;}));
        if(gpsSites.has(previous))gpsSite.value=previous;
      }
      const site=gpsSites.get(gpsSite.value);
      if(visible&&(previous!==gpsSite.value||!gpsDirty&&!addressEdited&&!gpsPending&&(site?._directoryVersion||0)!==gpsVersion))fillGps(site);
      else updateGpsControls();
    }
    async function searchAddresses(query,token){
      showAddressStatus('Søger efter adresser…');
      try{
        const result=await onLookupSiteAddress({query});
        if(disposed||token!==addressEpoch)return;
        if(!result?.ok){showAddressStatus(result?.message||'Adresseopslaget kunne ikke gennemføres.');return;}
        addressOptions=Array.isArray(result.suggestions)?result.suggestions:[];
        if(!addressOptions.length){showAddressStatus('Ingen adresse fundet. Prøv med vejnavn og husnummer.');return;}
        const options=addressOptions.map((item,index)=>{
          const option=button(item.address,()=>chooseAddress(item),'cs-gps-address-option');
          option.id='cs-gps-address-option-'+index+suffix;option.tabIndex=-1;
          option.setAttribute('role','option');option.setAttribute('aria-selected','false');
          option.addEventListener('mousedown',event=>event.preventDefault());
          return option;
        });
        gpsSuggestions.replaceChildren(...options);
        showAddressStatus();showAddressOptions(doc.activeElement===gpsAddress);
      }catch{
        if(!disposed&&token===addressEpoch)showAddressStatus('Adresseopslaget kunne ikke gennemføres. Prøv igen om lidt.');
      }
    }
    async function chooseAddress(item){
      if(gpsAddress.disabled||addressResolving)return;
      const token=++addressEpoch;
      addressResolving=true;showAddressOptions(false);showAddressStatus('Henter den valgte adresse…');
      try{
        const result=await onLookupSiteAddress({id:item.id});
        if(disposed||token!==addressEpoch)return;
        if(!result?.ok||typeof result.address!=='string'||!Number.isFinite(result.latitude)||!Number.isFinite(result.longitude)){
          showAddressStatus(result?.message||'Adressen kunne ikke hentes. Prøv igen.');
          showAddressOptions(doc.activeElement===gpsAddress);return;
        }
        cancelAddressLookup();
        addressSelection={address:result.address,latitude:result.latitude,longitude:result.longitude};
        gpsAddress.value=result.address;addressEdited=false;gpsDirty=true;
        showAddressStatus('Adresse valgt. Gem GPS-indstillingerne for at bruge den.');
      }catch{
        if(!disposed&&token===addressEpoch){
          showAddressStatus('Adressen kunne ikke hentes. Prøv igen.');
          showAddressOptions(doc.activeElement===gpsAddress);
        }
      }finally{
        if(!disposed){if(token===addressEpoch)addressResolving=false;updateGpsControls();}
      }
    }
    async function saveSiteGps(){
      if(disposed||gpsSave.disabled)return;
      const site=gpsSites.get(gpsSite.value),saved=gpsModel.normalizeGps(site?.gps);
      const {address,latitude,longitude}=addressSelection||saved;
      const gps={enabled:gpsToggle.checked,latitude,longitude,radiusMeters:gpsRadius.valueAsNumber,...(address===undefined?{}:{address})};
      const siteAddress=addressSelection?.address;
      if(gps.enabled&&latitude===null){
        gpsError.textContent='Vælg en adresse fra forslagene, før du kræver GPS.';gpsError.hidden=false;gpsAddress.focus();return;
      }
      const errors=gpsModel.validateGps(gps);
      if(errors.length){gpsError.textContent=errors[0];gpsError.hidden=false;return;}
      const id=gpsSite.value,expectedVersion=gpsVersion,token=++gpsEpoch;
      if((siteAddress===undefined||siteAddress===site?.address)&&Object.keys(gps).every(key=>gps[key]===saved[key])){
        fillGps(gpsSites.get(id));gpsStatus.textContent='GPS-indstillingerne er uændrede.';gpsStatus.hidden=false;return;
      }
      gpsPending=true;gpsError.hidden=true;gpsStatus.hidden=true;updateGpsControls();
      try{
        const result=await onSaveSiteGps({id,expectedVersion,gps,address:siteAddress});
        if(disposed||token!==gpsEpoch)return;
        if(result?.site)gpsSites.set(id,result.site);
        if(!result?.ok){gpsError.textContent=result?.error||'GPS-indstillingerne kunne ikke gemmes.';gpsError.hidden=false;return;}
        fillGps(gpsSites.get(id));gpsStatus.textContent='GPS-indstillingerne er gemt.';gpsStatus.hidden=false;
      }catch{
        if(!disposed&&token===gpsEpoch){gpsError.textContent='GPS-indstillingerne kunne ikke gemmes. Kontrollér forbindelsen, og prøv igen.';gpsError.hidden=false;}
      }finally{
        if(!disposed&&token===gpsEpoch){gpsPending=false;updateGpsControls();}
      }
    }
    gpsSite.addEventListener('change',()=>fillGps(gpsSites.get(gpsSite.value)));
    for(const input of gpsInputs)input.addEventListener('input',()=>{gpsDirty=true;gpsError.hidden=true;gpsStatus.hidden=true;updateGpsControls();});
    function queueAddressSearch(){
      cancelAddressLookup();addressEdited=true;addressSelection=null;
      gpsError.hidden=true;gpsStatus.hidden=true;updateGpsControls();
      const query=gpsAddress.value.trim(),token=addressEpoch;
      if(query.length>=3)addressTimer=setTimeout(()=>searchAddresses(query,token),250);
    }
    gpsAddress.addEventListener('input',event=>{if(!event.isComposing)queueAddressSearch();});
    gpsAddress.addEventListener('compositionend',queueAddressSearch);
    gpsAddress.addEventListener('focus',()=>showAddressOptions(true));
    gpsAddress.addEventListener('blur',()=>showAddressOptions(false));
    gpsAddress.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if(event.key==='Escape'&&!gpsSuggestions.hidden){event.preventDefault();showAddressOptions(false);return;}
      if(event.key==='Enter'){
        event.preventDefault();
        if(!gpsSuggestions.hidden&&addressOptions[activeAddress])chooseAddress(addressOptions[activeAddress]);
        return;
      }
      if(!addressOptions.length||!['ArrowDown','ArrowUp'].includes(event.key))return;
      event.preventDefault();showAddressOptions(true);
      const offset=event.key==='ArrowDown'?1:-1;
      highlightAddress(activeAddress<0&&offset<0?addressOptions.length-1:(activeAddress+offset+addressOptions.length)%addressOptions.length);
    });
    gpsForm.addEventListener('submit',event=>{event.preventDefault();saveSiteGps();});
    gpsRadius.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();saveSiteGps();}});
    const demo=section('Eksempeldata','Vælg, om eksempelvagter skal indgå i vagtplanen.');demo.section.className+=' cs-settings-demo';
    const demoLabel=node('label','cs-settings-demo-control'),demoToggle=node('input');demoToggle.id='cs-workspace-demo-enabled'+suffix;demoToggle.type='checkbox';const demoText=node('span');demoText.append(node('strong','','Vis eksempelvagter'),node('span','cs-product-help','Dine oprettede vagter, vagtserier og medarbejdere bevares.'));demoLabel.append(demoToggle,demoText);const demoStatus=node('p','cs-product-help');demoStatus.hidden=true;demoStatus.setAttribute('role','status');demoStatus.setAttribute('aria-live','polite');demo.content.append(demoLabel,demoStatus);setup.append(demo.section);
    demoToggle.addEventListener('change',()=>saveDemo(demoToggle.checked));
    if(typeof onNavigate==='function')demo.content.append(button('Åbn eksempler',()=>onNavigate('demo')));
    const tablist=node('div','cs-settings-tabs');
    tablist.setAttribute('role','tablist');
    tablist.setAttribute('aria-label','Indstillinger');
    const sections=[
      {key:'company',label:'Virksomhed',section:form,available:()=>true},
      {key:'budgets',label:'Timebudgetter',section:budgetSection,available:()=>Boolean(budgetView)},
      {key:'sites',label:'Arbejdssteder',section:gpsSection.section,available:()=>!gpsSection.section.hidden},
      {key:'examples',label:'Eksempeldata',section:demo.section,available:()=>!demo.section.hidden}
    ];
    let activeSection='company';
    setup.prepend(tablist);
    for(const item of sections){
      const panel=node('div','cs-settings-tab-panel');
      const tab=button(item.label,()=>selectSection(item.key),'cs-settings-tab');
      tab.id='cs-settings-tab-'+item.key+suffix;
      panel.id='cs-settings-panel-'+item.key+suffix;
      tab.setAttribute('role','tab');
      tab.setAttribute('aria-controls',panel.id);
      panel.setAttribute('role','tabpanel');
      panel.setAttribute('aria-labelledby',tab.id);
      panel.append(item.section);
      tablist.append(tab);
      setup.append(panel);
      Object.assign(item,{tab,panel});
      tab.addEventListener('keydown',event=>{
        const choices=sections.filter(choice=>choice.available()),index=choices.indexOf(item);
        const next={ArrowLeft:choices.at(index-1),ArrowRight:choices[(index+1)%choices.length],Home:choices[0],End:choices.at(-1)}[event.key];
        if(!next)return;
        event.preventDefault();
        selectSection(next.key);
        next.tab.focus();
      });
    }
    function selectSection(key=activeSection){
      activeSection=sections.find(item=>item.key===key&&item.available())?.key||'company';
      for(const item of sections){
        const selected=item.key===activeSection;
        item.tab.hidden=!item.available();
        item.tab.tabIndex=selected?0:-1;
        item.tab.setAttribute('aria-selected',String(selected));
        item.panel.hidden=!selected;
      }
    }
    form.addEventListener('submit',event=>{event.preventDefault();saveSettings();});form.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing||['BUTTON','SELECT'].includes(event.target.tagName))return;if(event.target.tagName==='TEXTAREA'&&!event.ctrlKey&&!event.metaKey)return;event.preventDefault();saveSettings();});
    function updateDisabled(){for(const control of form.querySelectorAll('input,textarea,select,button'))control.disabled=pending||!canEdit;save.textContent=pending?'Gemmer…':'Gem oplysninger';form.setAttribute('aria-busy',String(pending));permissionNote.textContent=canEdit?'':'Redigering kræver adgang til både planlægning og brugerstyring.';permissionNote.hidden=canEdit;demoToggle.disabled=demoPending||!canEdit||typeof onDemoChange!=='function';demo.section.hidden=typeof stats.demoEnabled!=='boolean';if(!demoPending)demoToggle.checked=stats.demoEnabled===true;}
    async function saveSettings(){
      if(!canEdit||pending||disposed)return;const draft=Object.fromEntries(keys.map(key=>[key,fields[key].value.trim()]));if(draft.contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contactEmail)){error.textContent='Skriv en gyldig e-mailadresse, eller lad feltet stå tomt.';error.hidden=false;fields.contactEmail.focus();return;}
      draft.workHoursBudget=settings.workHoursBudget;
      draft.payrollPeriod={startDay:periodMode.value==='calendar'?1:Number(periodStart.value)};
      if(!Number.isInteger(draft.payrollPeriod.startDay)||draft.payrollPeriod.startDay<1||draft.payrollPeriod.startDay>31){error.textContent='Vælg en startdag mellem 1 og 31.';error.hidden=false;periodStart.focus();return;}
      if(typeof onSave!=='function'){error.textContent='Oplysningerne kan ikke gemmes lige nu.';error.hidden=false;return;}
      const token=++epoch;pending=true;error.hidden=true;saveStatus.hidden=true;updateDisabled();
      try{const result=await onSave(draft);if(disposed||token!==epoch)return;if(!result?.ok){error.textContent=result?.message||result?.error||'Oplysningerne kunne ikke gemmes. Prøv igen.';error.hidden=false;error.scrollIntoView?.({block:'nearest'});return;}settings=cleanSettings(result.settings||draft);snapshot=JSON.stringify(settings);dirty=false;incomingNote.hidden=true;fillSettings();saveStatus.textContent='Virksomhedsoplysningerne er gemt.';saveStatus.hidden=false;}
      catch{if(!disposed&&token===epoch){error.textContent='Oplysningerne kunne ikke gemmes. Kontrollér forbindelsen, og prøv igen.';error.hidden=false;}}
      finally{if(!disposed&&token===epoch){pending=false;updateDisabled();}}
    }
    async function saveDemo(enabled){
      if(!canEdit||demoPending||disposed||typeof onDemoChange!=='function'){updateDisabled();return;}const token=++demoEpoch;demoPending=true;demoStatus.hidden=true;updateDisabled();
      try{const result=await onDemoChange({enabled});if(disposed||token!==demoEpoch)return;if(!result?.ok){demoStatus.textContent=result?.message||result?.error||'Eksempeldata kunne ikke opdateres. Prøv igen.';}else{stats={...stats,demoEnabled:enabled};demoStatus.textContent=enabled?'Eksempelvagter vises i vagtplanen.':'Eksempelvagter er skjult.';}demoStatus.hidden=false;}
      catch{if(!disposed&&token===demoEpoch){demoStatus.textContent='Eksempeldata kunne ikke opdateres. Kontrollér forbindelsen, og prøv igen.';demoStatus.hidden=false;}}
      finally{if(!disposed&&token===demoEpoch){demoPending=false;updateDisabled();}}
    }
    function render(options={}){
      if(disposed)return;stats=options.stats||{};const incoming=cleanSettings(options.settings),nextSnapshot=JSON.stringify(incoming),nextCanEdit=options.canEdit===true;if(canEdit&&!nextCanEdit){epoch++;demoEpoch++;pending=false;demoPending=false;}canEdit=nextCanEdit;
      if(!loaded||!dirty&&!pending){settings=incoming;snapshot=nextSnapshot;fillSettings();incomingNote.hidden=true;}
      else if(nextSnapshot!==snapshot&&!pending){settings=incoming;incomingNote.textContent='Virksomhedsoplysningerne er opdateret. Din igangværende kladde er bevaret.';incomingNote.hidden=false;}
      loaded=true;updateDisabled();renderGps(options);
      budgetView?.render({settings:incoming,sites:options.sites,departments:options.departments,versions:options.budgetVersions,canEdit:{company:canEdit,department:options.canEditScopedBudget===true,site:options.canEditScopedBudget===true},ready:options.budgetsReady===true});
      selectSection();if(!element.contains(page))element.replaceChildren(page);
    }
    function close(){}
    function showPresentation(){}
    function destroy(){disposed=true;epoch++;demoEpoch++;gpsEpoch++;cancelAddressLookup();budgetView?.destroy();element.replaceChildren();}
    return Object.freeze({render,close,destroy,showPresentation});
  }
  const api=Object.freeze({mount,payrollPeriodPreview});globalThis.CleanRoomsWorkspaceGuide=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
