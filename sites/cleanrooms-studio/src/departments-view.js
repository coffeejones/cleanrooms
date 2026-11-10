/* Organization controls keep worksite indexes intact; persistence belongs to the caller. */
(() => {
  'use strict';
  let instance=0;
  function mount({element,portal,onSelect,onSave}={}) {
    if(!element?.ownerDocument||!portal?.append)throw new TypeError('Afdelingsvælgeren kræver et felt og et panelfelt.');
    const doc=element.ownerDocument,win=doc.defaultView,uid=++instance,suffix=uid===1?'':'-'+uid;
    let organization={version:1,sites:[],departments:[]},selectedId=null,canManage=false,scopeRestricted=false,busy=false,pending=false,menuOpen=false,managerOpen=false,editingId=null,editingVersion=null,query='',returnFocus=null,saveGeneration=0,disposed=false;
    const inertBefore=new Map();
    const node=(tag,className,text)=>{const item=doc.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;};
    const id=(item,name)=>{item.id='cs-department-'+name+suffix;return item;};
    const icon=kind=>{const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),path=doc.createElementNS(svg.namespaceURI,'path');Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}).forEach(([key,value])=>svg.setAttribute(key,String(value)));path.setAttribute('d',kind==='close'?'m6 6 12 12M6 18 18 6':'m6 9 6 6 6-6');svg.append(path);return svg;};
    const button=(label,className,action,text=label)=>{const item=node('button',className);item.type='button';item.setAttribute('aria-label',label);if(text!==null)item.textContent=text;item.addEventListener('click',action);return item;};
    const kindLabel=value=>value==='customer'?'Kunde':'Filial';
    const sites=()=>Array.isArray(organization.sites)?organization.sites:[];
    const departments=()=>Array.isArray(organization.departments)?organization.departments:[];
    const siteIdsFor=department=>[...new Set((Array.isArray(department?.siteIds)?department.siteIds:[]).filter(index=>Number.isInteger(index)&&index>=0&&index<sites().length))];
    const metaFor=department=>{const count=siteIdsFor(department).length;return kindLabel(department.kind)+' · '+count+(count===1?' arbejdssted':' arbejdssteder');};
    const allLabel=()=>scopeRestricted?'Dine afdelinger':'Alle afdelinger';
    const disabled=()=>busy||pending;
    const setDisabled=()=>{
      trigger.disabled=busy;
      dialog.setAttribute('aria-busy',String(disabled()));
      for(const control of dialog.querySelectorAll('button,input,select,textarea'))control.disabled=disabled();
      save.disabled=disabled()||!canManage;
      save.textContent=pending?'Gemmer…':'Gem afdeling';
      if(!addSite.checked){newSiteName.disabled=true;newSiteAddress.disabled=true;}
      manage.disabled=disabled();
    };
    const visibleFocusable=container=>[...container.querySelectorAll('button,input,select,textarea,a[href]')].filter(item=>!item.disabled&&!item.hidden&&item.tabIndex!==-1&&!item.closest('[hidden]'));
    const restoreFocus=()=>{const target=returnFocus?.isConnected&&!returnFocus.disabled?returnFocus:trigger;if(target.isConnected&&!target.disabled)target.focus({preventScroll:true});};
    const applyInert=()=>{
      const root=portal.closest('#cleanrooms-studio')||element.closest('#cleanrooms-studio');
      for(const region of root?.querySelectorAll('.cs-sidebar,.cs-main')||[]){if(region.contains(portal))continue;if(!inertBefore.has(region))inertBefore.set(region,Boolean(region.inert));region.inert=true;}
    };
    const releaseInert=()=>{for(const [region,value]of inertBefore)region.inert=value;inertBefore.clear();};

    const wrapper=node('div','cs-department-control');
    const trigger=id(button('Vælg afdeling','cs-button cs-department-trigger',()=>menuOpen?closeMenu(true):openMenu(),null),'trigger');
    const triggerName=node('span','cs-department-trigger-name','Alle afdelinger');trigger.append(triggerName,icon('down'));trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');wrapper.append(trigger);element.replaceChildren(wrapper);
    element.classList.add('cs-department-slot');portal.classList.add('cs-department-portal');
    const popover=id(node('section','cs-department-popover'),'popover');popover.hidden=true;popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Vælg afdeling');trigger.setAttribute('aria-controls',popover.id);
    const searchLabel=node('label','cs-department-search-label'),search=id(node('input','cs-department-search'),'search');search.type='search';search.placeholder='Søg afdeling';search.autocomplete='off';searchLabel.append(node('span','cs-sr','Søg efter en afdeling'),search);
    const options=id(node('div','cs-department-options'),'options'),empty=node('p','cs-department-empty','Ingen afdelinger matcher søgningen.');empty.hidden=true;
    const manage=id(button('Administrer afdelinger','cs-button cs-department-manage',()=>openManager(),'Administrer afdelinger'),'manage');
    const menuFooter=node('div','cs-department-popover-footer');menuFooter.append(manage);popover.append(searchLabel,options,empty,menuFooter);
    const layer=id(node('div','cs-department-layer'),'layer');layer.hidden=true;
    const backdrop=button('Luk afdelingsadministration','cs-department-backdrop',()=>{if(!pending)closeManager(true);},'');backdrop.tabIndex=-1;backdrop.setAttribute('aria-hidden','true');
    const dialog=id(node('section','cs-department-dialog'),'dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1;
    const head=node('header','cs-department-head'),headCopy=node('div','cs-department-head-copy'),title=id(node('h3','','Afdelinger'),'title'),caption=node('p','cs-department-caption','Saml arbejdssteder under en filial eller en kunde.');dialog.setAttribute('aria-labelledby',title.id);headCopy.append(title,caption);
    const closeButton=id(button('Luk afdelingsadministration','cs-icon-button',()=>closeManager(true),null),'close');closeButton.append(icon('close'));head.append(headCopy,closeButton);
    const form=id(node('form','cs-department-form'),'form');form.noValidate=true;
    const body=node('div','cs-department-body'),listHead=node('div','cs-department-list-head'),listTitle=node('h4','','Dine afdelinger'),create=id(button('Opret en ny afdeling','cs-button',()=>{if(!disabled()){setDraft(null);name.focus();}},'Opret afdeling'),'create');listHead.append(listTitle,create);
    const list=id(node('div','cs-department-list'),'list'),formTitle=id(node('h4','cs-department-form-title','Opret afdeling'),'form-title');
    const field=(label,input)=>{const holder=node('label','cs-department-field');holder.append(node('span','cs-department-field-label',label),input);return holder;};
    const name=id(node('input','cs-department-input'),'name');name.type='text';name.autocomplete='off';name.required=true;
    const kind=id(node('select','cs-department-input'),'kind');[['branch','Filial'],['customer','Kunde']].forEach(([value,label])=>{const item=node('option','',label);item.value=value;kind.append(item);});
    const pair=node('div','cs-department-field-pair');pair.append(field('Navn',name),field('Type',kind));
    const worksiteField=node('fieldset','cs-department-worksites'),legend=node('legend','cs-department-field-label','Arbejdssteder'),worksiteHelp=id(node('p','cs-department-help','Vælg de arbejdssteder, der hører til afdelingen. Du kan vælge flere.'),'sites-help'),worksiteOptions=id(node('div','cs-department-site-options'),'sites');worksiteField.setAttribute('aria-describedby',worksiteHelp.id);worksiteField.append(legend,worksiteHelp,worksiteOptions);
    const noSitesNote=node('p','cs-department-empty-note','En afdeling uden arbejdssteder er tom. Den viser først vagter, når du tilknytter et arbejdssted.');
    const addSiteLabel=node('label','cs-department-add-site'),addSite=id(node('input',''),'new-site');addSite.type='checkbox';addSiteLabel.append(addSite,node('span','','Opret nyt arbejdssted'));
    const newSiteFields=node('div','cs-department-new-site-fields');newSiteFields.hidden=true;
    const newSiteName=id(node('input','cs-department-input'),'site-name');newSiteName.type='text';newSiteName.autocomplete='off';
    const newSiteAddress=id(node('textarea','cs-department-input'),'site-address');newSiteAddress.rows=2;newSiteAddress.autocomplete='street-address';newSiteFields.append(field('Arbejdsstedets navn',newSiteName),field('Adresse',newSiteAddress),node('p','cs-department-help','Det nye arbejdssted oprettes og tilknyttes denne afdeling, når du gemmer.'));
    const error=id(node('p','cs-department-error'),'error');error.hidden=true;error.setAttribute('role','alert');
    body.append(listHead,list,formTitle,pair,worksiteField,noSitesNote,addSiteLabel,newSiteFields,error);
    const footer=node('footer','cs-department-footer'),cancel=id(button('Annuller afdelingsredigering','cs-button',()=>closeManager(true),'Annuller'),'cancel'),save=id(node('button','cs-button cs-primary','Gem afdeling'),'save');save.type='button';footer.append(cancel,save);form.append(body,footer);dialog.append(head,form);layer.append(backdrop,dialog);portal.append(popover,layer);

    function renderMenu(){
      const needle=query.trim().toLocaleLowerCase('da-DK');options.replaceChildren();
      const appendOption=(department)=>{
        const active=department?String(department.id)===String(selectedId):selectedId===null;
        const option=button(department?department.name+', '+metaFor(department):allLabel(),'cs-department-option',()=>{closeMenu(true);onSelect?.(department?.id??null);},null);option.dataset.departmentId=department?.id??'';option.setAttribute('aria-pressed',String(active));
        const copy=node('span','cs-department-option-copy');copy.append(node('span','cs-department-option-name',department?.name||allLabel()),node('span','cs-department-option-meta',department?metaFor(department):scopeRestricted?'Vis dine arbejdssteder':'Vis alle arbejdssteder'));option.append(copy,node('span','cs-department-option-check',active?'✓':''));options.append(option);
      };
      if(!needle||'alle afdelinger'.includes(needle))appendOption(null);
      for(const department of departments()){
        const haystack=[department.name,kindLabel(department.kind),...siteIdsFor(department).map(index=>sites()[index].name)].join(' ').toLocaleLowerCase('da-DK');if(!needle||haystack.includes(needle))appendOption(department);
      }
      empty.hidden=options.children.length>0;menuFooter.hidden=!canManage;
    }
    function positionMenu(){
      if(!menuOpen)return;const rect=trigger.getBoundingClientRect(),viewportWidth=win?.innerWidth||doc.documentElement.clientWidth,viewportHeight=win?.innerHeight||doc.documentElement.clientHeight,width=Math.max(0,Math.min(320,viewportWidth-24));
      popover.style.width=width+'px';popover.style.left=Math.max(12,Math.min(rect.left,viewportWidth-width-12))+'px';
      const below=viewportHeight-rect.bottom-20,above=rect.top-20,openAbove=below<200&&above>below;
      popover.style.top=openAbove?'auto':Math.max(12,rect.bottom+6)+'px';popover.style.bottom=openAbove?Math.max(12,viewportHeight-rect.top+6)+'px':'auto';popover.style.maxHeight=Math.max(100,Math.min(430,openAbove?above:below))+'px';
    }
    function outside(event){if(menuOpen&&!popover.contains(event.target)&&!trigger.contains(event.target))closeMenu(false);}
    function focusOutside(event){if(menuOpen&&!popover.contains(event.target)&&!trigger.contains(event.target))closeMenu(false);}
    function menuKeys(event){
      if(!menuOpen)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
      if(!popover.contains(event.target)&&event.target!==trigger)return;
      if(!['ArrowDown','ArrowUp'].includes(event.key))return;
      const choices=[...options.querySelectorAll('button')];if(!choices.length)return;event.preventDefault();const index=choices.indexOf(doc.activeElement),next=index<0?(event.key==='ArrowDown'?0:choices.length-1):(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[next].focus();
    }
    function openMenu(){if(disposed||managerOpen||busy)return;query='';search.value='';renderMenu();menuOpen=true;popover.hidden=false;trigger.setAttribute('aria-expanded','true');positionMenu();doc.addEventListener('pointerdown',outside,true);doc.addEventListener('focusin',focusOutside,true);doc.addEventListener('keydown',menuKeys,true);win?.addEventListener('resize',positionMenu);win?.addEventListener('scroll',positionMenu,true);search.focus({preventScroll:true});}
    function closeMenu(restore){if(!menuOpen)return;menuOpen=false;popover.hidden=true;trigger.setAttribute('aria-expanded','false');doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',focusOutside,true);doc.removeEventListener('keydown',menuKeys,true);win?.removeEventListener('resize',positionMenu);win?.removeEventListener('scroll',positionMenu,true);if(restore&&trigger.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});}
    function renderList(){
      list.replaceChildren();if(!departments().length){list.append(node('p','cs-department-empty','Der er endnu ingen afdelinger. Opret den første nedenfor.'));return;}
      for(const department of departments()){
        const row=node('div','cs-department-row'),copy=node('div','cs-department-row-copy');copy.append(node('strong','cs-department-row-name',department.name),node('span','cs-department-row-meta',metaFor(department)));
        const edit=button('Rediger '+department.name,'cs-button cs-department-edit',()=>{if(!disabled()){setDraft(department.id);name.focus();}},'Rediger');edit.dataset.editDepartment=department.id;row.dataset.active=String(String(editingId)===String(department.id));row.append(copy,edit);list.append(row);
      }
    }
    function renderWorksites(selected){
      const chosen=new Set(selected);worksiteOptions.replaceChildren();
      sites().forEach((site,index)=>{if(site.restricted)return;const label=node('label','cs-department-site-option'),checkbox=node('input',''),copy=node('span','cs-department-site-copy');checkbox.type='checkbox';checkbox.checked=chosen.has(index);checkbox.dataset.departmentSite=String(index);copy.append(node('span','cs-department-site-name',site.name));if(site.address)copy.append(node('span','cs-department-site-address',site.address));label.append(checkbox,copy);worksiteOptions.append(label);});
      if(!sites().length)worksiteOptions.append(node('p','cs-department-help','Der er endnu ingen arbejdssteder. Opret et nedenfor, eller gem en tom afdeling.'));
    }
    function setDraft(departmentId){
      const department=departments().find(item=>String(item.id)===String(departmentId));editingId=department?.id??null;editingVersion=department?._directoryVersion??null;name.value=department?.name||'';kind.value=department?.kind==='customer'?'customer':'branch';addSite.checked=false;newSiteFields.hidden=true;newSiteName.value='';newSiteAddress.value='';formTitle.textContent=department?'Rediger afdeling':'Opret afdeling';error.hidden=true;error.textContent='';renderWorksites(siteIdsFor(department));renderList();setDisabled();
    }
    function trap(event){
      if(!managerOpen)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!pending)closeManager(true);return;}
      if(event.key!=='Tab')return;
      const targets=visibleFocusable(dialog),first=targets[0],last=targets.at(-1);if(!first){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey&&(doc.activeElement===first||!dialog.contains(doc.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(doc.activeElement===last||!dialog.contains(doc.activeElement))){event.preventDefault();first.focus();}
    }
    function openManager(departmentId){
      if(disposed||!canManage||disabled())return;
      if(scopeRestricted&&departmentId==null)departmentId=departments()[0]?.id;
      returnFocus=menuOpen?trigger:doc.activeElement;closeMenu(false);managerOpen=true;layer.hidden=false;applyInert();setDraft(departmentId);body.scrollTop=0;doc.addEventListener('keydown',trap,true);closeButton.focus({preventScroll:true});
    }
    function closeManager(restore){
      if(!managerOpen)return;managerOpen=false;saveGeneration++;layer.hidden=true;doc.removeEventListener('keydown',trap,true);releaseInert();if(restore)restoreFocus();
    }
    addSite.addEventListener('change',()=>{newSiteFields.hidden=!addSite.checked;setDisabled();if(addSite.checked)newSiteName.focus();});
    search.addEventListener('input',()=>{query=search.value;renderMenu();});
    async function submitDraft(event){
      event.preventDefault();if(disabled()||!canManage)return;
      const draft={id:editingId,...(Number.isSafeInteger(editingVersion)?{expectedVersion:editingVersion}:{}),name:name.value.trim(),kind:kind.value==='customer'?'customer':'branch',siteIds:[...worksiteOptions.querySelectorAll('input[data-department-site]')].filter(input=>input.checked).map(input=>Number(input.dataset.departmentSite)),newSite:addSite.checked?{name:newSiteName.value.trim(),address:newSiteAddress.value.trim()}:null};
      const fail=(message,input)=>{error.textContent=message;error.hidden=false;if(input)input.focus();else error.scrollIntoView?.({block:'nearest'});};
      if(!draft.name){fail('Skriv et navn til afdelingen.',name);return;}
      if(draft.newSite&&!draft.newSite.name){fail('Skriv et navn til det nye arbejdssted.',newSiteName);return;}
      if(typeof onSave!=='function'){fail('Afdelingen kan ikke gemmes lige nu. Prøv igen.');return;}
      pending=true;const generation=++saveGeneration;error.hidden=true;setDisabled();
      try{
        const result=await onSave(draft);
        if(disposed||generation!==saveGeneration)return;
        if(result?.organization&&Array.isArray(result.organization.sites)&&Array.isArray(result.organization.departments))organization=result.organization;
        if(!result?.ok){
          if(result?.department?.id){editingId=result.department.id;formTitle.textContent='Rediger afdeling';addSite.checked=false;newSiteFields.hidden=true;newSiteName.value='';newSiteAddress.value='';renderWorksites(siteIdsFor(result.department));renderList();updateTrigger();renderMenu();}
          fail(typeof result?.error==='string'&&result.error?result.error:'Afdelingen kunne ikke gemmes. Prøv igen.');return;
        }
        updateTrigger();renderMenu();closeManager(true);
      }catch{if(!disposed&&generation===saveGeneration)fail('Afdelingen kunne ikke gemmes. Kontrollér forbindelsen, og prøv igen.');}
      finally{pending=false;if(!disposed)setDisabled();}
    }
    save.addEventListener('click',submitDraft);
    form.addEventListener('submit',submitDraft);
    form.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing||event.target.tagName==='BUTTON')return;
      if(event.target.tagName==='TEXTAREA'&&!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();submitDraft(event);
    });
    function updateTrigger(){const selected=departments().find(item=>String(item.id)===String(selectedId));triggerName.textContent=selected?.name||allLabel();trigger.title=selected?selected.name+', '+metaFor(selected):allLabel();trigger.setAttribute('aria-label','Vælg afdeling: '+triggerName.textContent);}
    function render(next={}){
      if(disposed)return;
      if(next.organization&&Array.isArray(next.organization.sites)&&Array.isArray(next.organization.departments))organization=next.organization;
      selectedId=next.selectedId??null;canManage=Boolean(next.canManage);scopeRestricted=Boolean(next.scopeRestricted);create.hidden=scopeRestricted;addSiteLabel.hidden=scopeRestricted;busy=Boolean(next.busy);updateTrigger();renderMenu();
      if(managerOpen){if(!canManage)closeManager(true);else{const chosen=[...worksiteOptions.querySelectorAll('input[data-department-site]')].filter(item=>item.checked).map(item=>Number(item.dataset.departmentSite));renderList();renderWorksites(chosen);applyInert();}}
      setDisabled();if(menuOpen)positionMenu();
    }
    function close(){closeMenu(false);closeManager(true);}
    function destroy(){if(disposed)return;close();disposed=true;saveGeneration++;popover.remove();layer.remove();element.replaceChildren();}
    render();return Object.freeze({render,openManager,close,destroy});
  }
  const api=Object.freeze({mount});globalThis.CleanRoomsDepartmentView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
