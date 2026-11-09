/* Reusable account-backed CSV editor. The period drawer owns download and selection. */
(() => {
  'use strict';
  let sequence=0;
  const creationKey=()=>globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,character=>{const value=Math.floor(Math.random()*16);return (character==='x'?value:(value&3)|8).toString(16);});
  const kindLabels={attendance:'Arbejdstid',base:'Grundløn',supplement:'Tillæg',monthly_base:'Fast månedsløn',monthly_supplement:'Faste månedstillæg'};
  function open({element,onAction,onSaved,onClose,profileId}={}){
    const Model=globalThis.CleanRoomsPayrollExportProfileModel;
    if(!Model||!element?.ownerDocument||typeof onAction!=='function')throw new TypeError('Eksportprofiler kræver adgang til kontoen.');
    const doc=element.ownerDocument,previous=doc.activeElement,id='cs-export-profile-'+ ++sequence;
    let disposed=false,epoch=0,peopleEpoch=0,busy=false,peopleBusy=false,canManage=false,profiles=[],selected=null,draft=Model.defaults(),creationId=creationKey(),tab='format',dirty=false,error='',message='',pending=null;
    let people=[],peopleTotal=0,peopleError='',search='',searchDraft='',includeArchived=false,cursors=[null],page=0,nextCursor=null;
    const node=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
    const button=(label,action,cls='cs-button')=>{const el=node('button',cls,label);el.type='button';el.disabled=busy;el.addEventListener('click',()=>{if(!disposed&&!el.disabled)action();});return el;};
    const option=(value,label)=>{const el=node('option','',label);el.value=String(value);return el;};
    const field=(label,input)=>{const el=node('label','cs-export-profile-field');el.append(node('span','',label),input);return el;};
    const input=(value,change,{max=100,placeholder='',label}={})=>{const el=node('input');el.type='text';el.value=value??'';el.maxLength=max;el.placeholder=placeholder;el.disabled=busy||!canManage;if(label)el.setAttribute('aria-label',label);el.addEventListener('input',()=>{change(el.value);mark();});return el;};
    const select=(items,value,change,{label}={})=>{const el=node('select');el.disabled=busy||!canManage;if(label)el.setAttribute('aria-label',label);for(const [key,name] of items)el.append(option(key,name));el.value=String(value);el.addEventListener('change',()=>{change(el.value);mark();paint();});return el;};
    const checkbox=(label,checked,change)=>{const el=node('label','cs-export-profile-check'),box=node('input');box.type='checkbox';box.checked=checked;box.disabled=busy||!canManage;box.addEventListener('change',()=>{change(box.checked);mark();});el.append(box,node('span','',label));return el;};
    const layer=node('div','cs-export-profile-layer'),backdrop=button('Luk eksportprofiler',()=>requestClose(),'cs-export-profile-backdrop');backdrop.tabIndex=-1;backdrop.setAttribute('aria-hidden','true');
    const panel=node('section','cs-export-profile-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby',id);panel.tabIndex=-1;
    const heading=node('header','cs-export-profile-header'),title=node('h3','','CSV-eksport'),dismiss=button('×',()=>requestClose(),'cs-icon-button cs-quiet');title.id=id;dismiss.setAttribute('aria-label','Luk eksportprofiler');heading.append(title,dismiss);
    const body=node('div','cs-export-profile-body'),footer=node('footer','cs-export-profile-footer');panel.append(heading,body,footer);layer.append(backdrop,panel);element.append(layer);
    function mark(){dirty=true;message='';}
    function close(force=false){if(disposed||busy&&!force)return;disposed=true;epoch++;peopleEpoch++;layer.remove();onClose?.();if(previous?.isConnected)previous.focus?.({preventScroll:true});}
    function requestClose(){if(dirty){pending={kind:'close'};paint();}else close();}
    async function call(action,payload={}){const result=await onAction(action,payload);if(!result?.ok)throw Error(result?.message||'Handlingen kunne ikke gennemføres.');return result;}
    async function list(){const result=await call('payrollExportProfilesRead');if(!Array.isArray(result.profiles)||typeof result.canManage!=='boolean')throw Error('Eksportprofilerne kunne ikke bekræftes.');profiles=result.profiles.filter(item=>!item.builtIn);canManage=result.canManage;}
    function accept(value){if(!value?.profile||typeof value.profile.id!=='string'||!Number.isSafeInteger(value.profile.version))throw Error('Eksportprofilen kunne ikke bekræftes.');selected=value.profile;draft=Model.normalize(value.profile.config);canManage=value.canManage===true;dirty=false;pending=null;}
    async function loadProfile(next){
      if(disposed||busy)return;const request=++epoch;peopleEpoch++;peopleBusy=false;busy=true;error='';message='';pending=null;paint();
      try{if(next){const result=await call('payrollExportProfileRead',{profileId:next});if(disposed||request!==epoch)return;accept(result);}else{selected=null;draft=Model.defaults();creationId=creationKey();dirty=false;}people=[];search=searchDraft='';page=0;cursors=[null];nextCursor=null;}
      catch(cause){if(!disposed&&request===epoch)error=cause.message;}
      finally{if(!disposed&&request===epoch){busy=false;paint();if(tab==='employees')void loadPeople();}}
    }
    function choose(next){if(dirty){pending={kind:'choose',id:next};paint();}else void loadProfile(next);}
    async function loadPeople(){
      if(disposed||busy)return;const request=++peopleEpoch,binding=epoch;peopleBusy=true;peopleError='';paint();
      try{const result=await call('payrollExportProfileEmployees',{query:search,includeArchived,cursor:cursors[page],limit:25});if(disposed||request!==peopleEpoch||binding!==epoch)return;
        if(!Array.isArray(result.people)||!Number.isSafeInteger(result.total)||result.total<0||result.nextCursor!==null&&typeof result.nextCursor!=='string')throw Error('Medarbejderlisten kunne ikke bekræftes.');
        people=result.people;peopleTotal=result.total;nextCursor=result.nextCursor;
      }catch(cause){if(!disposed&&request===peopleEpoch&&binding===epoch){people=[];peopleError=cause.message;nextCursor=null;}}
      finally{if(!disposed&&request===peopleEpoch&&binding===epoch){peopleBusy=false;paint();}}
    }
    async function save(){
      if(disposed||busy||!canManage)return;let config;try{config=Model.normalize(draft);}catch(cause){error=cause.message;paint();return;}
      const request=++epoch;peopleEpoch++;peopleBusy=false;busy=true;error='';message='';paint();
      try{const result=await call('payrollExportProfileSave',{...(selected?{profileId:selected.id}:{creationId}),version:selected?.version??0,profile:config});if(disposed||request!==epoch)return;
        if(!result.profile||result.profile.id!==(selected?.id??'pex-'+creationId)||result.profile.version!==(selected?.version??0)+1||JSON.stringify(Model.normalize(result.profile.config))!==JSON.stringify(config))throw Error('Gemningen kunne ikke bekræftes. Hent profilen igen før næste ændring.');
        accept(result);profiles=[...profiles.filter(item=>item.id!==selected.id),selected].sort((a,b)=>a.name.localeCompare(b.name,'da-DK'));message='Profilen er gemt · version '+selected.version;try{onSaved?.(selected);}catch{/* The saved server revision remains authoritative. */}}
      catch(cause){if(!disposed&&request===epoch)error=cause.message;}
      finally{if(!disposed&&request===epoch){busy=false;paint();}}
    }
    async function archive(){
      if(disposed||busy||!canManage||!selected)return;const request=++epoch;peopleEpoch++;peopleBusy=false;busy=true;error='';message='';paint();
      try{const result=await call('payrollExportProfileArchive',{profileId:selected.id,version:selected.version});if(disposed||request!==epoch)return;if(!result.profile?.archived||result.profile.id!==selected.id||result.profile.version!==selected.version+1)throw Error('Arkiveringen kunne ikke bekræftes. Hent profilen igen.');profiles=profiles.filter(item=>item.id!==selected.id);selected=null;draft=Model.defaults();creationId=creationKey();dirty=false;pending=null;message='Profilen er arkiveret. Tidligere versioner er bevaret.';try{onSaved?.(result.profile);}catch{}}
      catch(cause){if(!disposed&&request===epoch)error=cause.message;}
      finally{if(!disposed&&request===epoch){busy=false;paint();}}
    }
    function renderFormat(){
      const format=node('section','cs-export-profile-format');format.append(field('Profilnavn',input(draft.name,value=>{draft.name=value;},{label:'Profilnavn'})));
      const settings=node('div','cs-export-profile-settings');settings.append(field('Separator',select([[';','Semikolon'],[',','Komma'],['\t','Tabulator']],draft.delimiter,value=>{draft.delimiter=value;})),field('Decimalseparator',select([[',','Komma'],['.','Punktum']],draft.decimal,value=>{draft.decimal=value;})),field('Decimaler i antal/timer',select([[2,'2 decimaler'],[4,'4 decimaler']],draft.hoursDecimals,value=>{draft.hoursDecimals=Number(value);})));format.append(settings,checkbox('Medtag kolonneoverskrifter',draft.header,value=>{draft.header=value;}));
      format.append(node('h4','','Kolonner'));const columns=node('div','cs-export-profile-columns');
      draft.columns.forEach((column,index)=>{const row=node('div','cs-export-profile-column');row.append(field('Felt',select(Model.fields,column.field,value=>{column.field=value;if(value==='constant')column.value='';else delete column.value;},{label:'Felt i kolonne '+(index+1)})),field('Overskrift',input(column.header,value=>{column.header=value;},{label:'Overskrift i kolonne '+(index+1)})));
        const actions=node('div','cs-export-profile-column-actions'),up=button('↑',()=>{[draft.columns[index-1],draft.columns[index]]=[draft.columns[index],draft.columns[index-1]];mark();paint();},'cs-icon-button cs-quiet'),down=button('↓',()=>{[draft.columns[index+1],draft.columns[index]]=[draft.columns[index],draft.columns[index+1]];mark();paint();},'cs-icon-button cs-quiet'),remove=button('×',()=>{draft.columns.splice(index,1);mark();paint();},'cs-icon-button cs-quiet');
        up.setAttribute('aria-label','Flyt kolonne '+(index+1)+' op');down.setAttribute('aria-label','Flyt kolonne '+(index+1)+' ned');remove.setAttribute('aria-label','Fjern kolonne '+(index+1));up.disabled=busy||!canManage||index===0;down.disabled=busy||!canManage||index===draft.columns.length-1;remove.disabled=busy||!canManage||draft.columns.length===1;actions.append(up,down,remove);row.append(actions);
        if(column.field==='constant')row.append(field('Fast værdi',input(column.value,value=>{column.value=value;},{max:200,label:'Fast værdi i kolonne '+(index+1)})));columns.append(row);
      });format.append(columns);if(canManage){const add=button('Tilføj kolonne',()=>{draft.columns.push({field:'constant',header:'Tekst',value:''});mark();paint();},'cs-button cs-quiet');add.disabled=busy||draft.columns.length>=32;format.append(add);}
      format.append(node('h4','','Posttyper'));const kinds=node('div','cs-export-profile-kinds');for(const kind of Model.kinds)kinds.append(checkbox(kindLabels[kind],draft.rowKinds.includes(kind),value=>{draft.rowKinds=value?[...draft.rowKinds,kind]:draft.rowKinds.filter(item=>item!==kind);}));format.append(kinds);
      const sample=node('details','cs-export-profile-preview'),summary=node('summary','','Eksempel på CSV-række');sample.append(summary);const code=node('pre');
      try{code.textContent=Model.serialize([{employeeId:'eksempel',name:'Eksempelmedarbejder',date:'2026-01-15',sourceEntryId:'eksempel-vagt',lineKind:draft.rowKinds[0]||'base',label:'Timeløn',workedMinutes:450,minutes:450,quantity:7.5,calculation:'hourly',rateCents:18000,amountCents:135000,currency:'DKK',from:'2026-01-15',to:'2026-01-15',days:1,cycleDays:31,allocationBasis:'payroll-cycle',monthDays:0,periodFrom:'2026-01-01',periodTo:'2026-01-31',revision:1}],{...draft,requireEmployeeNumbers:false,requireWageCodes:false,employeeNumbers:{...draft.employeeNumbers,eksempel:'LØNNR'},wageCodes:[...draft.wageCodes.filter(rule=>rule.kind!==(draft.rowKinds[0]||'base')),{kind:draft.rowKinds[0]||'base',label:'',code:'KODE'}]}).replace(/\t/g,'⇥');}catch(cause){code.textContent=cause.message;}sample.append(code);format.append(sample);body.append(format);
    }
    function renderEmployees(){
      body.append(checkbox('Kræv lønnummer, når kolonnen bruges',draft.requireEmployeeNumbers,value=>{draft.requireEmployeeNumbers=value;}));
      const searchRow=node('div','cs-export-profile-search'),searchInput=node('input');searchInput.type='search';searchInput.value=searchDraft;searchInput.maxLength=100;searchInput.placeholder='Søg medarbejder eller id';searchInput.setAttribute('aria-label','Søg medarbejder eller id');searchInput.disabled=busy||peopleBusy;searchInput.addEventListener('input',()=>{searchDraft=searchInput.value;});
      function applySearch(){search=searchDraft.trim();page=0;cursors=[null];void loadPeople();}searchInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applySearch();}});const searchButton=button('Søg',applySearch);searchButton.disabled=busy||peopleBusy;searchRow.append(searchInput,searchButton);body.append(searchRow);
      const archived=node('label','cs-export-profile-check'),check=node('input');check.type='checkbox';check.checked=includeArchived;check.disabled=busy||peopleBusy;check.addEventListener('change',()=>{includeArchived=check.checked;page=0;cursors=[null];void loadPeople();});archived.append(check,node('span','','Vis også arkiverede medarbejdere'));body.append(archived);
      if(peopleError){const feedback=node('p','cs-export-profile-error',peopleError);feedback.setAttribute('role','alert');body.append(feedback,button('Hent listen igen',()=>{page=0;cursors=[null];void loadPeople();},'cs-button cs-quiet'));}
      const table=node('table','cs-export-profile-people'),head=node('thead'),headRow=node('tr');headRow.append(node('th','','Medarbejder'),node('th','','Lønnummer'));head.append(headRow);const content=node('tbody');
      for(const person of people){const row=node('tr'),identity=node('td');identity.append(node('strong','',person.name));if(person.archived)identity.append(node('span','cs-export-profile-caption','Arkiveret'));identity.append(node('span','cs-export-profile-person-id',person.id));const number=node('td');number.append(input(Object.hasOwn(draft.employeeNumbers,person.id)?draft.employeeNumbers[person.id]:'',value=>{if(value.trim())draft.employeeNumbers[person.id]=value;else delete draft.employeeNumbers[person.id];},{max:60,label:'Lønnummer for '+person.name,placeholder:'Ikke angivet'}));row.append(identity,number);content.append(row);}table.append(head,content);body.append(table);
      if(peopleBusy){const loading=node('p','cs-export-profile-caption','Henter medarbejdere…');loading.setAttribute('role','status');body.append(loading);}else if(!people.length&&!peopleError)body.append(node('p','cs-export-profile-caption','Ingen medarbejdere matcher søgningen.'));
      const pager=node('div','cs-export-profile-pager'),back=button('Forrige',()=>{page--;void loadPeople();},'cs-button cs-quiet'),next=button('Næste',()=>{cursors[page+1]=nextCursor;page++;void loadPeople();},'cs-button cs-quiet');back.disabled=busy||peopleBusy||page===0;next.disabled=busy||peopleBusy||!nextCursor;pager.append(node('span','',people.length?(page*25+1)+'–'+(page*25+people.length)+' af '+peopleTotal:String(peopleTotal)+' medarbejdere'),back,next);body.append(pager);
    }
    function renderCodes(){
      body.append(checkbox('Kræv lønart, når kolonnen bruges',draft.requireWageCodes,value=>{draft.requireWageCodes=value;}),node('p','cs-export-profile-caption','En regel uden løndelsnavn gælder alle løndele af den valgte type. Et præcist navn har forrang.'));
      const rules=node('div','cs-export-profile-rules');draft.wageCodes.forEach((rule,index)=>{const row=node('div','cs-export-profile-rule');row.append(field('Type',select(Model.kinds.map(kind=>[kind,kindLabels[kind]]),rule.kind,value=>{rule.kind=value;})),field('Løndelsnavn',input(rule.label,value=>{rule.label=value;},{max:200,placeholder:'Alle af typen',label:'Løndelsnavn i regel '+(index+1)})),field('Lønart',input(rule.code,value=>{rule.code=value;},{max:60,label:'Lønart i regel '+(index+1)})));const remove=button('×',()=>{draft.wageCodes.splice(index,1);mark();paint();},'cs-icon-button cs-quiet');remove.setAttribute('aria-label','Fjern lønartsregel '+(index+1));remove.disabled=busy||!canManage;row.append(remove);rules.append(row);});body.append(rules);
      if(canManage){const add=button('Tilføj lønart',()=>{draft.wageCodes.push({kind:'base',label:'',code:''});mark();paint();},'cs-button cs-quiet');add.disabled=busy||draft.wageCodes.length>=300;body.append(add);}
      if(!draft.wageCodes.length)body.append(node('p','cs-export-profile-caption','Tilføj lønarter fra lønsystemets importopsætning.'));
    }
    function paint(){
      if(disposed)return;body.replaceChildren();footer.replaceChildren();panel.setAttribute('aria-busy',String(busy));dismiss.disabled=backdrop.disabled=busy;
      const toolbar=node('div','cs-export-profile-toolbar'),picker=node('select');picker.setAttribute('aria-label','Vælg eksportprofil');picker.disabled=busy;picker.append(option('','Ny profil'));for(const profile of profiles)picker.append(option(profile.id,profile.name));picker.value=selected?.id??'';picker.addEventListener('change',()=>choose(picker.value||null));toolbar.append(picker);if(canManage)toolbar.append(button('Ny profil',()=>choose(null),'cs-button cs-quiet'));body.append(toolbar,node('p','cs-export-profile-caption','Tilpas CSV-filen til lønsystemets importskabelon.'));
      if(error){const feedback=node('p','cs-export-profile-error',error);feedback.setAttribute('role','alert');body.append(feedback);}if(message){const feedback=node('p','cs-export-profile-message',message);feedback.setAttribute('role','status');body.append(feedback);}
      const tabs=node('nav','cs-export-profile-tabs');tabs.setAttribute('aria-label','Eksportprofil');for(const [key,label] of [['format','Format'],['employees','Medarbejdere'],['codes','Lønarter']]){const item=button(label,()=>{tab=key;paint();if(tab==='employees'&&!people.length)void loadPeople();},'cs-export-profile-tab');item.setAttribute('aria-current',tab===key?'page':'false');tabs.append(item);}body.append(tabs);
      if(tab==='format')renderFormat();else if(tab==='employees')renderEmployees();else renderCodes();
      if(pending){const confirm=node('section','cs-export-profile-confirm');if(pending.kind==='archive'){confirm.append(node('strong','','Arkivér profilen?'),node('p','','Tidligere profilversioner kan fortsat bruges til tidligere eksportfiler.'),button('Arkivér',()=>{void archive();}));}else{confirm.append(node('strong','','Forlad dine ændringer?'),button('Forlad ændringer',()=>{const target=pending;pending=null;dirty=false;if(target.kind==='close')close();else void loadProfile(target.id);}));}confirm.append(button('Annuller',()=>{pending=null;paint();},'cs-button cs-quiet'));body.append(confirm);}
      footer.append(button('Luk',()=>requestClose(),'cs-button cs-quiet'));if(selected&&canManage){const remove=button('Arkivér',()=>{pending={kind:'archive'};paint();},'cs-button cs-quiet');footer.append(remove);}if(canManage)footer.append(button(busy?'Gemmer…':selected?'Gem profil':'Opret profil',()=>{void save();},'cs-button cs-primary'));
    }
    layer.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();requestClose();}if(event.key==='Tab'){const controls=[...panel.querySelectorAll('button,input,select,textarea,summary')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}}});
    async function start(){const request=++epoch;busy=true;paint();try{await list();if(disposed||request!==epoch)return;}catch(cause){if(!disposed&&request===epoch)error=cause.message;}finally{if(!disposed&&request===epoch){busy=false;paint();}}if(!disposed&&profileId&&profileId!=='standard-v1')void loadProfile(profileId);}
    void start();panel.focus({preventScroll:true});return Object.freeze({destroy(){close(true);},get busy(){return busy;}});
  }
  const api=Object.freeze({open});globalThis.CleanRoomsPayrollExportProfileView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
