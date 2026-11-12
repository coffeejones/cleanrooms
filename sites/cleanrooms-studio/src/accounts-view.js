/* Users and role permissions are supplied by the server, never inferred from saved UI state. */
(() => {
  'use strict';
  let sequence=0;
  const permissionKeys=new Set(['plan','departments.manage','users.manage','roles.manage','payroll.view','payroll.manage','payroll.groups.manage','chat.manage']);
  function mount({element,onAction,onOpenEmployee,staff=[],externalHelp=false}={}){
    if(!element?.ownerDocument)throw new TypeError('Brugersiden kræver et indholdsfelt.');
    const doc=element.ownerDocument,win=doc.defaultView,suffix=++sequence===1?'':'-'+sequence;
    let viewer=null,capabilities={},authorized=false,canUsers=false,canRoles=false,identity='',mounted=false,disposed=false,pending=false,epoch=0,loaded=false,tab='users';
    let staffCandidates=Array.isArray(staff)?staff.slice():[],inviteSites=[],accessDepartments=[];
    let members=[],invites=[],roles=[],catalog=[],editingId=null,editVersion=null,inviteUrl='',inviteResultId=null,createdPersonId=null,roleEditingId=null,roleEditVersion=null,roleDraft=new Set();
    let canAppLogins=false,appLogins=[];
    const node=(tag,className,text)=>{const item=doc.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;};
    const id=(item,name)=>{item.id='cs-account-'+name+suffix;return item;};
    const button=(label,action,className='cs-button')=>{const item=node('button',className,label);item.type='button';item.addEventListener('click',action);return item;};
    const glyph=kind=>{const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const shapes={admin:['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z','m8.5 12 2.5 2.5 4.5-5'],person:['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z','M4 21v-2a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v2'],calendar:['M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2Z','M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 17h3'],branch:['M3 21h18M5 21V4h10v17M15 9h4v12M8 8h4M8 12h4M8 16h4'],custom:['M12 3 3 8l9 5 9-5-9-5Z','m3 12 9 5 9-5M3 16l9 5 9-5'],users:['M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z','M5 21v-3a6 6 0 0 1 12 0v3M18 5a3 3 0 0 1 0 6M19 15a5 5 0 0 1 3 4v2'],refresh:['M20 7a9 9 0 1 0 1 8M20 3v5h-5'],lock:['M6 10h12v11H6z','M8 10V7a4 4 0 0 1 8 0v3M12 14v3'],plus:['M12 5v14M5 12h14']}[kind]||[];for(const value of shapes){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',value);svg.append(path);}return svg;};
    const symbol=kind=>{const item=node('span','cs-accounts-symbol');item.dataset.kind=kind;item.append(glyph(kind));return item;};
    const shortPermission=key=>({'plan':'Vagtplan','departments.manage':'Afdelinger','users.manage':'Konti','roles.manage':'Roller','payroll.view':'Se løn','payroll.manage':'Rediger løn','payroll.groups.manage':'Løngrupper','chat.manage':'Chatrum'}[key]||key);
    const permissionTags=permissions=>{const list=node('span','cs-accounts-permission-tags');for(const key of permissions.length?permissions:['personal']){const tag=node('span','cs-accounts-permission-tag');tag.dataset.permission=key;tag.title=key==='personal'?'Adgang til egne vagter og tjeklister':permissionLabel(key);tag.append(node('span','cs-accounts-permission-dot'),node('span','',key==='personal'?'Egne vagter':shortPermission(key)));list.append(tag);}return list;};
    const sectionTitle=(heading,description)=>{const group=node('div','cs-accounts-section-title');group.append(heading,node('p','cs-accounts-caption',description));return group;};
    const field=(label,control)=>{const item=node('label','cs-accounts-field');item.append(node('span','cs-accounts-label',label),control);return item;};
    const message=result=>typeof result?.message==='string'&&result.message?result.message:typeof result?.error==='string'&&result.error?result.error:result?.error?.message||'Handlingen kunne ikke gennemføres. Prøv igen.';
    const staffList=()=>staffCandidates;
    const canCreateEmployee=()=>canAppLogins&&canUsers&&capabilities.plan===true&&inviteSites.length>0;
    const personName=value=>staffList().find(person=>String(person.id)===String(value))?.name||'Ikke tilknyttet';
    const roleFor=value=>roles.find(role=>String(role.id)===String(value));
    const permissionsFor=role=>Array.isArray(role?.permissions)?role.permissions:[];
    const needsEmployee=role=>Boolean(role)&&!permissionsFor(role).length;
    const permissionLabel=key=>catalog.find(permission=>permission.key===key)?.label||({'plan':'Vagtplan','departments.manage':'Administrer afdelinger','users.manage':'Administrer brugere','roles.manage':'Administrer roller','payroll.view':'Se lønoplysninger','payroll.manage':'Administrer løn og tillæg','payroll.groups.manage':'Administrer løngrupper','chat.manage':'Administrer chatrum'}[key]||key);
    const permissionSummary=role=>!role?'Rettighederne er ikke tilgængelige':permissionsFor(role).length?permissionsFor(role).map(permissionLabel).join(' · '):'Egne vagter og tjeklister';
    const nameFor=record=>record.roleName||roleFor(record.roleId)?.name||'Rollen er ikke tilgængelig';
    const grantSet=()=>new Set(Array.isArray(viewer?.permissions)?viewer.permissions:Array.isArray(viewer?.role?.permissions)?viewer.role.permissions:Object.entries({'plan':capabilities.plan,'departments.manage':capabilities.manageDepartments,'users.manage':capabilities.manageUsers,'roles.manage':capabilities.manageRoles,'payroll.view':capabilities.viewPayroll,'payroll.manage':capabilities.managePayroll,'payroll.groups.manage':capabilities.managePayrollGroups,'chat.manage':capabilities.manageChat}).filter(([,allowed])=>allowed===true).map(([key])=>key));
    const requiredFor=key=>{const requires=catalog.find(permission=>permission.key===key)?.requires;return [...new Set([...(Array.isArray(requires)?requires:[]),...(key==='departments.manage'||key==='payroll.view'?['plan']:key==='payroll.manage'?['plan','payroll.view']:key==='payroll.groups.manage'?['plan','payroll.view','payroll.manage']:[])])];};
    const canGrant=key=>{const own=grantSet();return own.has(key)&&requiredFor(key).every(required=>own.has(required));};
    const canAssign=role=>Boolean(role)&&permissionsFor(role).every(key=>grantSet().has(key));
    const defaultRole=()=>roles.find(role=>canAssign(role)&&!permissionsFor(role).length)||roles.find(canAssign);
    const memberPermissions=member=>member.isOwner?'Alle rettigheder · Ejer':permissionSummary(roleFor(member.roleId))+(member.personId?' · '+personName(member.personId):'');
    const body=node('div','cs-accounts-page');
    const toolbar=node('div','cs-accounts-toolbar'),overview=node('div','cs-accounts-overview'),total=node('span','cs-accounts-total','Henter adgangsoplysninger…'),refresh=button('Opdater listen',()=>load(),'cs-button cs-accounts-refresh cs-chrome-quiet');
    overview.append(node('span','cs-accounts-eyebrow','Adgangsstyring'),total);
    refresh.replaceChildren(glyph('refresh'),node('span','','Opdater listen'));
    const createUserButton=id(button('Opret bruger',openCreation,'cs-button cs-primary'),'user-create');
    createUserButton.replaceChildren(glyph('plus'),node('span','','Opret bruger'));
    createUserButton.setAttribute('aria-haspopup','dialog');
    createUserButton.setAttribute('aria-expanded','false');
    const helpButton=id(button('?',()=>openHelp(),'cs-button cs-accounts-help-button'),'help-open');
    helpButton.setAttribute('aria-label','Hjælp til brugere og roller');helpButton.setAttribute('aria-haspopup','dialog');helpButton.setAttribute('aria-expanded','false');
    const toolbarActions=node('div','cs-accounts-toolbar-actions');
    toolbarActions.append(refresh,createUserButton);
    if(!externalHelp)toolbarActions.append(helpButton);
    toolbar.append(symbol('admin'),overview,toolbarActions);
    const tabs=id(node('div','cs-accounts-tabs'),'tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Brugere og roller');
    const usersTab=id(button('Brugere',()=>selectTab('users'),'cs-accounts-tab'),'tab-users'),rolesTab=id(button('Roller',()=>selectTab('roles'),'cs-accounts-tab'),'tab-roles');
    const usersCount=node('span','cs-accounts-tab-count','0'),rolesCount=node('span','cs-accounts-tab-count','0');usersCount.setAttribute('aria-hidden','true');rolesCount.setAttribute('aria-hidden','true');usersTab.replaceChildren(glyph('users'),node('span','','Brugere'),usersCount);rolesTab.replaceChildren(glyph('admin'),node('span','','Roller'),rolesCount);
    const invitesTab=id(button('Invitationer',()=>selectTab('invites'),'cs-accounts-tab'),'tab-invites');
    const invitesCount=node('span','cs-accounts-tab-count','0');
    invitesCount.setAttribute('aria-hidden','true');
    invitesTab.replaceChildren(glyph('person'),node('span','','Invitationer'),invitesCount);
    const usersPanel=id(node('div','cs-accounts-tab-panel'),'users-panel'),rolesPanel=id(node('div','cs-accounts-tab-panel'),'roles-panel'),invitesPanel=id(node('div','cs-accounts-tab-panel'),'invites-panel');
    const accountTabs=[['users',usersTab,usersPanel,()=>canUsers],['roles',rolesTab,rolesPanel,()=>canRoles],['invites',invitesTab,invitesPanel,()=>canUsers]];
    for(const [,control,panel] of accountTabs){
      control.setAttribute('role','tab');control.setAttribute('aria-controls',panel.id);
      panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',control.id);tabs.append(control);
    }
    tabs.addEventListener('keydown',event=>{
      if(pending||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const choices=accountTabs.filter(([,control])=>!control.hidden);if(!choices.length)return;
      event.preventDefault();
      const index=Math.max(0,choices.findIndex(([,control])=>control===doc.activeElement));
      const [value,control]=event.key==='Home'?choices[0]:event.key==='End'?choices.at(-1):choices[(index+(event.key==='ArrowRight'?1:-1)+choices.length)%choices.length];
      selectTab(value);control.focus();
    });
    const status=id(node('p','cs-accounts-status'),'status');status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const globalError=id(node('p','cs-accounts-error'),'error');globalError.hidden=true;globalError.setAttribute('role','alert');
    const usersSection=node('section','cs-accounts-section cs-accounts-member-section'),usersHeading=id(node('h3','cs-accounts-heading','Personer med adgang'),'users-heading'),users=id(node('div','cs-accounts-users'),'users');usersSection.setAttribute('aria-labelledby',usersHeading.id);usersSection.append(sectionTitle(usersHeading,'Overblik over konti, roller og adgang til virksomheden.'),users);
    const editPanel=id(node('section','cs-accounts-edit-panel'),'edit-panel');editPanel.hidden=true;editPanel.setAttribute('aria-labelledby','cs-account-edit-title'+suffix);
    const editHeading=id(node('h3','cs-accounts-heading','Rediger bruger'),'edit-title'),editCaption=node('p','cs-accounts-caption'),editForm=makeUserForm('edit',false),editError=id(node('p','cs-accounts-error'),'edit-error');editError.hidden=true;editError.setAttribute('role','alert');
    const editActions=node('div','cs-accounts-form-actions'),editCancel=button('Annuller',()=>closeMember(true)),editSave=id(button('Gem ændringer',()=>saveMember(),'cs-button cs-primary'),'edit-save');editActions.append(editCancel,editSave);editForm.form.append(editError,editActions);editPanel.append(editHeading,editCaption,editForm.form);
    const createDialog=id(node('dialog','cs-accounts-help-dialog cs-accounts-create-dialog'),'create-dialog');
    createDialog.hidden=true;createDialog.setAttribute('aria-modal','true');
    const inviteHeading=id(node('h3','cs-accounts-help-title','Opret bruger'),'invite-title');
    const inviteDescription=id(node('p','cs-accounts-caption','Opret en medarbejder med app-login, eller invitér en bruger til web.'),'invite-description');
    createDialog.setAttribute('aria-labelledby',inviteHeading.id);
    createDialog.setAttribute('aria-describedby',inviteDescription.id);
    createUserButton.setAttribute('aria-controls',createDialog.id);
    const createHeader=node('header','cs-accounts-help-head');
    const createClose=id(button('Luk',()=>closeCreation(true),'cs-button cs-quiet'),'create-close');
    createHeader.append(inviteHeading,createClose);
    const createContent=node('div','cs-accounts-help-content cs-accounts-create-content');
    const accessNotice=node('p','cs-accounts-hosting-note','Del selv invitationslinket. Der sendes ikke en e-mail. Modtageren skal også have adgang til den private webapp i Sites.');
    const inviteForm=makeUserForm('invite',true),inviteError=id(node('p','cs-accounts-error'),'invite-error');
    inviteError.hidden=true;inviteError.setAttribute('role','alert');
    const inviteActions=node('div','cs-accounts-form-actions');
    const inviteCancel=id(button('Annuller',()=>closeCreation(true)),'invite-cancel');
    const inviteSend=id(button('Opret invitationslink',submitNewUser,'cs-button cs-primary'),'invite-send');
    inviteActions.append(inviteCancel,inviteSend);inviteForm.form.append(inviteError,inviteActions);
    const invitationResult=id(node('div','cs-accounts-invite-result'),'invite-result');invitationResult.hidden=true;const resultTitle=node('strong','cs-accounts-result-title','Invitationslinket er klar'),resultCopy=node('p','cs-accounts-caption'),link=id(node('input','cs-accounts-input'),'invite-link');link.type='text';link.readOnly=true;const linkLabel=field('Invitationslink',link),copy=id(button('Kopiér link',()=>copyLink()),'invite-copy'),linkRow=node('div','cs-accounts-link-row'),copyStatus=node('p','cs-accounts-copy-status');copyStatus.setAttribute('role','status');copyStatus.setAttribute('aria-live','polite');linkRow.append(linkLabel,copy);invitationResult.append(resultTitle,resultCopy,linkRow,copyStatus);
    const employeeResult=id(node('div','cs-accounts-invite-result'),'employee-result');employeeResult.hidden=true;
    const employeeResultCopy=node('p','cs-accounts-caption');
    const employeeProfileLink=id(button('Åbn medarbejderprofil',()=>{
      if(!createdPersonId||pending||!canAppLogins)return;
      const personId=createdPersonId;
      closeCreation();
      onOpenEmployee?.(personId);
    },'cs-button cs-primary'),'open-employee-profile');
    employeeResult.append(node('strong','cs-accounts-result-title','Medarbejderen er oprettet'),employeeResultCopy,employeeProfileLink);
    createContent.append(inviteDescription,inviteForm.form,employeeResult);
    createDialog.append(createHeader,createContent);
    const pendingSection=node('section','cs-accounts-section cs-accounts-pending-section'),pendingHeading=id(node('h3','cs-accounts-heading','Ventende invitationer'),'invites-heading'),pendingList=id(node('div','cs-accounts-invites'),'invites');
    pendingSection.setAttribute('aria-labelledby',pendingHeading.id);
    pendingSection.append(sectionTitle(pendingHeading,'Personlige invitationslinks til webadgang.'),pendingList);
    const invitesWorkspace=node('div','cs-accounts-workspace cs-accounts-invites-workspace');
    invitesWorkspace.append(invitationResult,pendingSection);invitesPanel.append(invitesWorkspace);
    const usersWorkspace=node('div','cs-accounts-workspace cs-accounts-users-workspace');
    const usersMain=node('div','cs-accounts-main-column'),usersSide=node('aside','cs-accounts-side-column');
    usersSide.setAttribute('aria-labelledby',editHeading.id);usersWorkspace.dataset.editor='false';usersSide.hidden=true;
    usersMain.append(usersSection);usersSide.append(editPanel);
    usersWorkspace.append(usersMain,usersSide);usersPanel.append(usersWorkspace);

    const rolesSection=node('section','cs-accounts-section cs-accounts-role-section'),roleHead=node('div','cs-accounts-role-head'),rolesHeading=id(node('h3','cs-accounts-heading','Virksomhedens roller'),'roles-heading'),createRoleButton=id(button('Opret rolle',()=>openRole(null),'cs-button cs-primary'),'role-create');createRoleButton.replaceChildren(glyph('plus'),node('span','','Opret rolle'));roleHead.append(sectionTitle(rolesHeading,'Saml ansvar og rettigheder i roller, der passer til jeres team.'),createRoleButton);rolesSection.setAttribute('aria-labelledby',rolesHeading.id);
    const roleList=id(node('div','cs-accounts-role-list'),'role-list');rolesSection.append(roleHead,roleList);
    const rolePanel=id(node('section','cs-accounts-edit-panel cs-accounts-role-editor'),'role-editor');rolePanel.hidden=true;
    const roleTitle=id(node('h3','cs-accounts-heading','Opret rolle'),'role-title');rolePanel.setAttribute('aria-labelledby',roleTitle.id);
    const roleForm=id(node('form','cs-accounts-form'),'role-form');roleForm.noValidate=true;const roleName=id(node('input','cs-accounts-input'),'role-name');roleName.type='text';roleName.autocomplete='off';roleName.required=true;
    const permissionField=node('fieldset','cs-accounts-permission-field'),permissionLegend=node('legend','cs-accounts-label','Rettigheder'),permissionHelp=id(node('p','cs-accounts-permission-help','Giv dine egne rettigheder videre. Uden valg får rollen kun egne vagter og tjeklister.'),'role-help'),permissionOptions=id(node('div','cs-accounts-permission-options'),'role-permissions');permissionField.setAttribute('aria-describedby',permissionHelp.id);permissionField.append(permissionLegend,permissionHelp,permissionOptions);
    const roleError=id(node('p','cs-accounts-error'),'role-error');roleError.hidden=true;roleError.setAttribute('role','alert');const roleActions=node('div','cs-accounts-form-actions'),roleCancel=id(button('Annuller',()=>closeRole(true)),'role-cancel'),roleSave=id(button('Gem rolle',()=>saveRole(),'cs-button cs-primary'),'role-save');roleActions.append(roleCancel,roleSave);roleName.placeholder='F.eks. Teamleder';roleForm.append(field('Rollenavn',roleName),permissionField,roleError,roleActions);rolePanel.append(sectionTitle(roleTitle,'Vælg præcis det ansvar, rollen skal have.'),node('p','cs-accounts-role-consequence','En ændring i en rolle gælder for alle, der har rollen.'),roleForm);
    const helpDialog=id(node('dialog','cs-accounts-help-dialog'),'help-dialog');helpDialog.hidden=true;helpDialog.setAttribute('role','dialog');helpDialog.setAttribute('aria-modal','true');
    const helpHeading=id(node('h3','cs-accounts-help-title','Brugere og roller'),'help-title');helpDialog.setAttribute('aria-labelledby',helpHeading.id);helpButton.setAttribute('aria-controls',helpDialog.id);
    const helpClose=id(button('Luk',()=>closeHelp(true),'cs-button cs-quiet'),'help-close'),helpHead=node('header','cs-accounts-help-head');helpHead.append(helpHeading,helpClose);
    const helpContent=node('div','cs-accounts-help-content'),roleGuide=node('section','cs-accounts-help-section');roleGuide.append(node('h4','','Sådan bruger du roller'),node('p','','En ændring i en rolle gælder for alle, der har rollen.'));
    const guideSteps=node('ol','cs-accounts-help-steps');for(const [title,copy] of [['Opret en rolle','Sæt navn på et ansvar i virksomheden.'],['Vælg rettigheder','Bestem, hvad rollen må se og redigere. Du kan kun give rettigheder, du selv har.'],['Tildel til brugere','Vælg rollen, når du inviterer eller redigerer en bruger.']]){const step=node('li');step.append(node('strong','',title),node('p','',copy));guideSteps.append(step);}roleGuide.append(guideSteps,node('p','','Standardroller er låst. Opret din egen rolle, når du vil tilpasse adgangen.'));
    const invitationGuide=node('section','cs-accounts-help-section');invitationGuide.append(node('h4','','Oprettelse af brugere'),node('p','','Angiv navn, e-mail, rolle og arbejdssted for en ny medarbejder. App-login bruger den samme e-mail. Administratoren kan administrere adgangen under Oplysninger → App-login på medarbejderprofilen.'),node('p','','Til roller med webadgang opretter du et invitationslink.'),accessNotice);
    const ownAccess=node('section','cs-accounts-help-section cs-accounts-guide-access');helpContent.append(roleGuide,invitationGuide,ownAccess);helpDialog.append(helpHead,helpContent);
    const rolesWorkspace=node('div','cs-accounts-workspace cs-accounts-roles-workspace'),rolesSide=node('aside','cs-accounts-side-column');
    const roleEmpty=node('section','cs-accounts-section cs-accounts-inspector-empty');
    const roleEmptyHeading=id(node('h3','cs-accounts-heading','Rollens rettigheder'),'role-inspector-title');
    roleEmpty.append(sectionTitle(roleEmptyHeading,'Rediger en brugerdefineret rolle, eller opret en ny.'));
    rolesSide.setAttribute('aria-labelledby',roleEmptyHeading.id);rolesWorkspace.dataset.editor='false';
    rolesWorkspace.append(rolesSection,rolesSide);rolesSide.append(roleEmpty,rolePanel);rolesPanel.append(rolesWorkspace);
    const workbenchBar=node('div','cs-accounts-workbench-bar');workbenchBar.append(tabs,toolbar);
    bindForm(roleForm,saveRole,()=>closeRole(true));body.append(workbenchBar,status,globalError,usersPanel,rolesPanel,invitesPanel,createDialog);if(!externalHelp)body.append(helpDialog);
    function openCreation(){
      if(disposed||!authorized||!canUsers||pending||!createDialog.hidden)return;
      resetInvite();
      inviteError.hidden=true;
      inviteDescription.hidden=false;
      inviteForm.form.hidden=false;
      createDialog.hidden=false;
      if(typeof createDialog.showModal==='function')createDialog.showModal();
      else createDialog.setAttribute('open','');
      createUserButton.setAttribute('aria-expanded','true');
      inviteForm.name.focus({preventScroll:true});
    }
    function closeCreation(restoreFocus=false){
      if(createDialog.hidden||restoreFocus&&pending)return;
      if(typeof createDialog.close==='function'&&createDialog.open)createDialog.close();
      else createDialog.removeAttribute?.('open');
      createDialog.hidden=true;
      createUserButton.setAttribute('aria-expanded','false');
      inviteError.hidden=true;
      employeeResult.hidden=true;
      employeeResultCopy.textContent='';
      createdPersonId=null;
      resetInvite();
      if(restoreFocus&&createUserButton.isConnected)createUserButton.focus({preventScroll:true});
    }
    createDialog.addEventListener('cancel',event=>{event.preventDefault();closeCreation(true);});
    createDialog.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.isComposing||event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();closeCreation(true);
    });
    let helpReturnFocus=null;
    function openHelp(){if(externalHelp||disposed||!authorized||!helpDialog.hidden)return;helpReturnFocus=doc.activeElement;helpDialog.hidden=false;if(typeof helpDialog.showModal==='function')helpDialog.showModal();else helpDialog.setAttribute('open','');helpButton.setAttribute('aria-expanded','true');helpClose.focus({preventScroll:true});}
    function closeHelp(restoreFocus=false){if(helpDialog.hidden)return;if(typeof helpDialog.close==='function'&&helpDialog.open)helpDialog.close();helpDialog.hidden=true;helpButton.setAttribute('aria-expanded','false');if(restoreFocus&&(helpReturnFocus?.isConnected??true))helpReturnFocus?.focus({preventScroll:true});helpReturnFocus=null;}
    helpDialog.addEventListener('cancel',event=>{event.preventDefault();closeHelp(true);});
    helpDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeHelp(true);return;}if(event.key==='Tab'){const controls=[...helpDialog.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')].filter(control=>!control.disabled&&!control.hidden&&control.tabIndex!==-1),first=controls[0],last=controls.at(-1);if(!first)return;if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}}});
    helpDialog.addEventListener('click',event=>{if(event.target!==helpDialog||typeof helpDialog.getBoundingClientRect!=='function')return;const rect=helpDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeHelp(true);});

    function bindForm(form,save,escape){
      form.addEventListener('submit',event=>{event.preventDefault();save();});
      form.addEventListener('keydown',event=>{
        if(event.defaultPrevented||event.isComposing)return;
        if(event.key==='Escape'&&escape){event.preventDefault();if(!pending)escape();return;}
        if(event.key!=='Enter'||event.target.tagName==='BUTTON')return;
        const shortcut=event.ctrlKey||event.metaKey;
        const textInput=event.target.tagName==='INPUT'&&!['checkbox','radio','button'].includes(event.target.type)&&event.target.getAttribute?.('role')!=='combobox';
        if(shortcut||textInput){event.preventDefault();save();}
      });
    }
    function employeeCreationNote(){
      if(capabilities.plan!==true)return 'Du skal have adgang til planlægning for at oprette en medarbejder.';
      if(!canAppLogins)return 'En administrator kan oprette medarbejdere med app-login.';
      if(!inviteSites.length)return 'Opret et arbejdssted, før du opretter en medarbejder.';
      return 'Medarbejderprofil og app-login oprettes sammen. Startkoden findes på profilen.';
    }
    function scopeLabel(value){
      if(value?.mode!=='departments')return 'Alle afdelinger';
      const names=(value.departmentIds||[]).map(id=>accessDepartments.find(item=>item.id===id)?.name||'Utilgængelig afdeling');return names.slice(0,2).join(' · ')+(names.length>2?' · +'+(names.length-2):'');
    }
    function makeScopeField(prefix){
      const group=node('fieldset','cs-accounts-scope-field'),legend=node('legend','cs-accounts-label','Adgangsområde'),mode=id(node('select','cs-accounts-input'),prefix+'-scope-mode');mode.setAttribute('aria-label','Adgangsområde');
      for(const [value,label]of [['all','Alle afdelinger'],['departments','Udvalgte afdelinger']]){const option=node('option','',label);option.value=value;mode.append(option);}mode.value='all';
      const details=node('div','cs-accounts-scope-details'),search=id(node('input','cs-accounts-input'),prefix+'-scope-search');search.type='search';search.placeholder='Find afdeling…';search.setAttribute('aria-label','Find afdeling til adgang');
      const list=node('div','cs-accounts-scope-options'),summary=node('p','cs-accounts-caption');list.setAttribute('aria-label','Afdelinger med adgang');details.append(search,list,summary);group.append(legend,mode,node('p','cs-accounts-caption','Rollen bestemmer rettighederne. Området bestemmer, hvor de gælder.'),details);
      let selected=new Set(),enabled=true;
      const current=()=>({mode:mode.value,departmentIds:mode.value==='departments'?[...selected].sort():[]});
      function update(){
        const restricted=capabilities.scopeRestricted===true;mode.children[0].disabled=restricted;
        if(restricted&&mode.value==='all'){mode.value='departments';selected=new Set(viewer?.accessScope?.departmentIds||capabilities.allowedDepartmentIds||[]);}
        mode.disabled=pending||!canUsers||!enabled;details.hidden=mode.value!=='departments';search.disabled=pending||!enabled;
        for(const input of list.querySelectorAll('input'))input.disabled=pending||!canUsers||!enabled;
        summary.textContent=selected.size+' '+(selected.size===1?'afdeling valgt':'afdelinger valgt');
      }
      function paint(){
        const query=search.value.trim().toLocaleLowerCase('da-DK');list.replaceChildren();
        for(const department of accessDepartments.filter(item=>!query||item.name.toLocaleLowerCase('da-DK').includes(query))){const label=node('label','cs-accounts-scope-option'),check=node('input');check.type='checkbox';check.value=department.id;check.checked=selected.has(department.id);check.dataset.departmentScope=department.id;check.addEventListener('change',()=>{if(pending||!enabled)return;if(check.checked)selected.add(department.id);else selected.delete(department.id);update();});label.append(check,node('span','',department.name));list.append(label);}
        if(!list.children.length)list.append(node('p','cs-accounts-caption',accessDepartments.length?'Ingen afdelinger matcher.':'Der er ingen afdelinger at vælge.'));update();
      }
      mode.addEventListener('change',update);search.addEventListener('input',paint);
      return {element:group,mode,current,update,paint,set(value){mode.value=value?.mode==='departments'?'departments':'all';selected=new Set(value?.departmentIds||[]);search.value='';paint();},show(value){enabled=value;group.hidden=!value;update();},valid(){return mode.value==='all'?capabilities.scopeRestricted!==true:selected.size>0&&[...selected].every(id=>accessDepartments.some(item=>item.id===id));}};
    }
    function makeUserForm(prefix,includeEmail){
      const form=id(node('form','cs-accounts-form'),prefix+'-form');form.noValidate=true;
      const input=(type,name)=>{const item=id(node('input','cs-accounts-input'),prefix+'-'+name);item.type=type;return item;};
      const name=input('text','name');name.autocomplete='name';name.required=true;const email=input('email','email');email.autocomplete='email';email.required=true;
      const top=node('div','cs-accounts-field-pair');top.append(field('Navn',name));if(includeEmail)top.append(field('E-mail',email));form.append(top);
      const role=id(node('select','cs-accounts-input'),prefix+'-role');
      const row=node('div','cs-accounts-field-pair');row.append(field('Rolle',role));form.append(row);
      const help=id(node('p','cs-accounts-role-help'),prefix+'-help');role.setAttribute('aria-describedby',help.id);form.append(help);const scope=makeScopeField(prefix);form.append(scope.element);
      if(includeEmail){
        const site=id(node('select','cs-accounts-input'),prefix+'-worksite'),siteField=field('Arbejdssted',site);
        row.append(siteField);
        function updateInvitation(){
          const chosen=roleFor(role.value),required=needsEmployee(chosen),canCreate=canCreateEmployee();
          help.textContent=chosen?'Rettigheder: '+permissionSummary(chosen):'Vælg en rolle.';
          if(chosen&&!canAssign(chosen))help.textContent+=' Du kan ikke tildele denne rolle.';
          else if(loaded&&required)help.textContent=employeeCreationNote();
          scope.show(!required);
          role.disabled=pending||!canUsers||!roles.length;
          siteField.hidden=!required||!canCreate;site.required=required&&canCreate;site.disabled=pending||!site.required;
          inviteSend.disabled=pending||!canUsers||!canAssign(chosen)||required&&!canCreate;
          inviteSend.textContent=pending?'Vent venligst…':required?'Opret medarbejder':'Opret invitationslink';
        }
        role.addEventListener('change',updateInvitation);bindForm(form,submitNewUser);
        return {form,name,email,role,site,scope,update:updateInvitation};
      }
      const statusSelect=id(node('select','cs-accounts-input'),prefix+'-status');
      for(const [value,label] of [['active','Aktiv'],['disabled','Deaktiveret']]){const option=node('option','',label);option.value=value;statusSelect.append(option);}
      statusSelect.value='active';row.append(field('Status',statusSelect));
      const person=id(node('select','cs-accounts-input'),prefix+'-person'),personField=field('Tilknyttet medarbejder',person),personLabel=personField.children[0];
      const empty=node('option','','Ingen tilknytning');empty.value='';person.append(empty);person.value='';
      const binding={assignedId:''},bindingHelp=id(node('p','cs-accounts-binding-help'),prefix+'-binding-help');
      person.setAttribute('aria-describedby',bindingHelp.id);form.append(personField,bindingHelp);
      function update(){
        const chosen=roleFor(role.value),required=needsEmployee(chosen);scope.show(!required);
        help.textContent=chosen?'Rettigheder: '+permissionSummary(chosen):'Vælg en rolle.';
        if(chosen&&!canAssign(chosen))help.textContent+=' Du kan ikke tildele denne rolle, da den indeholder rettigheder, du ikke selv har.';
        personLabel.textContent='Tilknyttet medarbejder'+(required?'':' · valgfrit');
        person.required=required;empty.textContent=required?'Vælg medarbejder':'Ingen tilknytning';
        bindingHelp.textContent=required?'Brugeren skal være tilknyttet en medarbejder for at se egne vagter.':'En medarbejdertilknytning er valgfri for denne rolle.';
        const selected=staffList().find(member=>String(member.id)===String(person.value));
        if(person.value&&!selected)bindingHelp.textContent='Den valgte medarbejder er ikke længere tilgængelig. Vælg en aktiv medarbejder eller fjern tilknytningen, hvis rollen tillader det.';
        else if(selected?.active===false)bindingHelp.textContent=String(selected.id)===binding.assignedId?'Medarbejderen er arkiveret. Den eksisterende tilknytning kan bevares.':'Medarbejderen er arkiveret. Vælg en aktiv medarbejder til den nye tilknytning.';
        person.disabled=pending||!canUsers;role.disabled=pending||!canUsers||!roles.length;
      }
      role.addEventListener('change',update);person.addEventListener('change',update);bindForm(form,saveMember,()=>closeMember(true));
      return {form,name,role,status:statusSelect,person,empty,binding,scope,update};
    }
    function populateRoles(form){const selected=form.role.value;form.role.replaceChildren();roles.forEach(role=>{const option=node('option','',role.name);option.value=role.id;option.disabled=!canAssign(role);form.role.append(option);});form.role.value=roles.some(role=>String(role.id)===String(selected))?selected:defaultRole()?.id||'';form.update();}
    function populatePeople(form,assignedId='',preferred=form.person.value){
      const selected=String(preferred||'');form.binding.assignedId=String(assignedId||'');
      const options=[];for(const member of staffList()){
        const current=String(member.id)===selected,existing=String(member.id)===form.binding.assignedId;
        if(member.active===false&&!existing&&!current)continue;
        const option=node('option','',member.name+(member.active===false?' · arkiveret':''));option.value=member.id;option.disabled=member.active===false&&!existing;options.push(option);
      }
      if(selected&&!staffList().some(member=>String(member.id)===selected)){const unavailable=node('option','','Medarbejderen er ikke længere tilgængelig');unavailable.value=selected;unavailable.disabled=true;options.push(unavailable);}
      form.person.replaceChildren(form.empty,...options);form.person.value=selected;form.update();
    }
    function populateInviteSites(preferred=inviteForm.site.value){
      const placeholder=node('option','','Vælg arbejdssted');placeholder.value='';
      const options=inviteSites.map(site=>{const option=node('option','',site.name);option.value=String(site.index);return option;});
      inviteForm.site.replaceChildren(placeholder,...options);
      inviteForm.site.value=options.some(option=>option.value===preferred)?preferred:options.length===1?options[0].value:'';
    }
    function resetInvite(){
      inviteForm.name.value='';inviteForm.email.value='';inviteForm.role.value=defaultRole()?.id||'';
      populateInviteSites('');inviteForm.scope.set(capabilities.scopeRestricted?viewer?.accessScope:undefined);inviteForm.update();
    }
    function showError(target,text){target.textContent=text;target.hidden=false;target.scrollIntoView?.({block:'nearest'});}
    function validateUser(form,target){
      if(!form.name.value.trim()){showError(target,'Skriv brugerens navn.');form.name.focus();return false;}
      const chosen=roleFor(form.role.value);if(!chosen||!canAssign(chosen)){showError(target,'Vælg en rolle, som du har adgang til at tildele.');form.role.focus();return false;}
      if(!needsEmployee(chosen)&&!form.scope.valid()){showError(target,'Vælg mindst én afdeling inden for din adgang.');form.scope.mode.focus();return false;}
      if(form.site){
        if(!needsEmployee(chosen))return true;
        if(!canCreateEmployee()){showError(target,employeeCreationNote());form.role.focus();return false;}
        if(!inviteSites.some(site=>String(site.index)===form.site.value)){showError(target,'Vælg et arbejdssted til medarbejderen.');form.site.focus();return false;}
        return true;
      }
      if(needsEmployee(chosen)&&!form.person.value){showError(target,'Vælg den medarbejder, som brugeren skal tilknyttes.');form.person.focus();return false;}
      if(form.person.value){const selected=staffList().find(member=>String(member.id)===String(form.person.value));if(!selected||selected.active===false&&String(selected.id)!==form.binding.assignedId){showError(target,'Vælg en aktiv medarbejder. En arkiveret medarbejder kan kun beholde sin eksisterende tilknytning.');form.person.focus();return false;}}
      return true;
    }
    function updateTabs(){
      if(!accountTabs.some(([value,,,allowed])=>tab===value&&allowed()))tab=accountTabs.find(([, , ,allowed])=>allowed())?.[0]||'users';
      for(const [value,control,panel,allowed] of accountTabs){
        const selected=tab===value&&allowed();
        control.hidden=!allowed();panel.hidden=!selected;
        control.setAttribute('aria-selected',String(selected));control.tabIndex=selected?0:-1;control.disabled=pending;
      }
      const customCount=roles.filter(role=>!role.isSystem).length,inviteCount=invites.filter(item=>item.status==='pending').length;
      const userCount=members.length+mobileUsers().length;
      if(tab==='roles')total.textContent=roles.length+(roles.length===1?' rolle':' roller')+' · '+customCount+(customCount===1?' brugerdefineret':' brugerdefinerede');
      else if(tab==='invites')total.textContent=inviteCount+(inviteCount===1?' ventende invitation':' ventende invitationer');
      else total.textContent=userCount+(userCount===1?' bruger':' brugere');
      usersCount.textContent=String(userCount);rolesCount.textContent=String(roles.length);invitesCount.textContent=String(inviteCount);
      createUserButton.hidden=!canUsers||tab==='roles';
      createUserButton.disabled=pending||!loaded||!roles.some(canAssign);
      ownAccess.replaceChildren(node('h4','','Dine rettigheder'),permissionTags([...grantSet()]));
    }
    function selectTab(value){
      if(pending||!accountTabs.some(([name,,,allowed])=>value===name&&allowed()))return;
      tab=value;updateTabs();
    }
    function setBusy(value){pending=value;body.setAttribute('aria-busy',String(value));for(const control of body.querySelectorAll('button,input,select'))control.disabled=value||!authorized;inviteForm.update();editForm.update();editSave.disabled=value||!canUsers;createRoleButton.disabled=value||!canRoles||!catalog.length;roleName.disabled=value||!canRoles;
      for(const checkbox of permissionOptions.querySelectorAll('input[data-role-permission]'))checkbox.disabled=value||!canRoles||!canGrant(checkbox.dataset.rolePermission);
      roleSave.disabled=value||!canRoles||!catalog.length||[...roleDraft].some(key=>!canGrant(key));roleCancel.disabled=value||!canRoles;for(const row of roleList.querySelectorAll('[data-role-id]')){const edit=row.querySelector('button');if(edit)edit.disabled=value||!canRoles||!canAssign(roleFor(row.dataset.roleId));}editSave.textContent=value?'Vent venligst…':'Gem ændringer';roleSave.textContent=value?'Vent venligst…':'Gem rolle';
      employeeProfileLink.disabled=value||!canAppLogins||typeof onOpenEmployee!=='function';
      updateTabs();
    }
    async function call(action,payload){if(typeof onAction!=='function')throw Error('Brugerstyringen er ikke tilgængelig lige nu.');const result=await onAction(action,payload);if(result?.ok===false)throw Error(message(result));return result?.data&&typeof result.data==='object'?result.data:result||{};}
    function applyList(result){roles=Array.isArray(result.roles)?result.roles:[];const normalizedCatalog=new Map();for(const item of Array.isArray(result.permissionCatalog)?result.permissionCatalog:[]){const key=item?.key??item?.id;if(permissionKeys.has(key))normalizedCatalog.set(key,{...item,key,requires:Array.isArray(item.requires)?item.requires.filter(required=>permissionKeys.has(required)):[]});}catalog=[...normalizedCatalog.values()];staffCandidates=(canUsers||canAppLogins)&&Array.isArray(result.staff)?result.staff.filter(member=>member&&typeof member.id==='string').map(member=>({...member})):[];members=canUsers&&Array.isArray(result.members)?result.members:[];invites=canUsers&&Array.isArray(result.invites)?result.invites:[];
      appLogins=canAppLogins&&Array.isArray(result.appLogins)?result.appLogins.map(readAppLogin).filter(Boolean):[];
      inviteSites=canUsers&&capabilities.plan===true&&Array.isArray(result.sites)?result.sites.filter(site=>Number.isSafeInteger(site?.index)&&site.index>=0&&typeof site.name==='string'):[];
      accessDepartments=Array.isArray(result.departments)?result.departments.filter(item=>typeof item?.id==='string'&&typeof item.name==='string'):[];inviteForm.scope.paint();editForm.scope.paint();
      loaded=true;populateRoles(inviteForm);populateRoles(editForm);populateInviteSites();
      populatePeople(editForm,members.find(member=>member.userId===editingId)?.personId||'');renderLists();renderRoleChoices();
    }
    async function refreshAfterMutation(token){try{const result=await call('list',{});if(!disposed&&authorized&&token===epoch)applyList(result);}catch(error){if(!disposed&&authorized&&token===epoch)showError(globalError,'Ændringen er gemt, men listen kunne ikke opdateres. '+error.message);}}
    async function perform(action,payload,target,success,afterSuccess){
      const userAction=['invite','createEmployeeUser','updateMember','revokeInvite'].includes(action),roleAction=['createRole','updateRole'].includes(action);
      if(!authorized||pending||disposed||userAction&&!canUsers||roleAction&&!canRoles||action==='createEmployeeUser'&&!canAppLogins)return;const token=++epoch;target.hidden=true;globalError.hidden=true;status.hidden=true;setBusy(true);
      let completed=false;try{const result=await call(action,payload);if(disposed||!authorized||token!==epoch)return;await success(result,token);completed=true;}catch(error){if(!disposed&&authorized&&token===epoch)showError(target,error?.message||'Handlingen kunne ikke gennemføres. Prøv igen.');}
      finally{if(!disposed&&authorized&&token===epoch){setBusy(false);if(completed)afterSuccess?.();}}
    }
    async function load(){await perform('list',{},globalError,async result=>{applyList(result);});}
    function makeTable(labels){const table=node('table','cs-accounts-table'),head=node('thead',''),row=node('tr','');labels.forEach(label=>{const th=node('th','',label);th.scope='col';row.append(th);});head.append(row);const rows=node('tbody','');table.append(head,rows);return {table,rows};}
    function accountIdentity(account){return account.personId+'\n'+String(account.email||'').toLowerCase();}
    function mobileUsers(){
      const webUsers=new Set(members.filter(member=>member.personId).map(accountIdentity));
      return appLogins.filter(account=>!webUsers.has(accountIdentity(account)));
    }
    function userIdentity(nameText,email,own=false){
      const user=node('td','cs-accounts-user-cell'),name=node('strong','cs-accounts-member-name',nameText);
      if(own)name.append(node('span','cs-accounts-you','dig'));
      const identity=node('div','cs-accounts-identity'),identityCopy=node('div','cs-accounts-identity-copy');
      const initials=nameText.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase();
      const avatar=node('span','cs-accounts-symbol cs-accounts-initials',initials);avatar.setAttribute('aria-hidden','true');
      identityCopy.append(name,node('span','cs-accounts-member-email',email||''));identity.append(avatar,identityCopy);user.append(identity);return user;
    }
    function userStatus(active,label=active?'Aktiv':'Deaktiveret'){
      const state=node('td','cs-accounts-state-cell'),stateLabel=node('span','cs-accounts-state-label',label);
      state.dataset.state=active?'active':'disabled';stateLabel.dataset.state=state.dataset.state;state.append(stateLabel);return state;
    }
    function profileButton(person){
      if(!person||capabilities.plan!==true||typeof onOpenEmployee!=='function')return null;
      const open=button('Åbn profil',()=>onOpenEmployee(person.id),'cs-button cs-account-edit-button');
      open.setAttribute('aria-label','Åbn medarbejderprofil for '+person.name);
      return open;
    }
    function renderLists(){
      users.replaceChildren();pendingList.replaceChildren();
      if(canUsers){
        const appUsers=mobileUsers();
        if(!members.length&&!appUsers.length)users.append(node('p','cs-accounts-empty','Der er endnu ingen brugere at vise.'));
        else{
          const {table,rows}=makeTable(['Bruger','Rolle og rettigheder','Status','']);
          const currentId=viewer?.userId??viewer?.id;
          const people=new Map(staffList().map(person=>[person.id,person]));
          const loginByIdentity=new Map(appLogins.map(account=>[accountIdentity(account),account]));
          for(const member of members){
            const row=node('tr','cs-account-member-row');
            row.dataset.userId=member.userId;row.dataset.selected=String(editingId===member.userId);
            const user=userIdentity(member.name||member.email||'Bruger',member.email,String(member.userId)===String(currentId));
            const login=loginByIdentity.get(accountIdentity(member));
            const appAccess=login?login.status==='active'?' · App-login':' · App-login lukket':'';
            const role=node('td','cs-accounts-role-cell');
            role.append(node('span','cs-accounts-member-role',nameFor(member)),node('span','cs-accounts-member-permissions',memberPermissions(member)+appAccess),node('span','cs-accounts-member-permissions cs-accounts-scope-summary',scopeLabel(member.accessScope)));
            const action=node('td','cs-accounts-action-cell');
            const profile=profileButton(people.get(member.personId));
            const controls=profile?node('div','cs-accounts-user-actions'):action;
            if(member.isOwner){
              const owner=node('span','cs-accounts-owner','Ejer');owner.prepend(glyph('lock'));controls.append(owner);
            }else{
              const edit=button('Rediger',()=>openMember(member.userId),'cs-button cs-account-edit-button');
              edit.setAttribute('aria-label','Rediger '+(member.name||member.email));controls.append(edit);
            }
            if(profile){controls.append(profile);action.append(controls);}
            row.append(user,role,userStatus(member.status!=='disabled'),action);rows.append(row);
          }
          for(const account of appUsers){
            const person=people.get(account.personId),active=account.status==='active';
            const row=node('tr','cs-account-member-row');row.dataset.appUserId=account.personId;
            const role=node('td','cs-accounts-role-cell');role.append(node('span','cs-accounts-member-role','Medarbejder'),node('span','cs-accounts-member-permissions','App-login'));
            const action=node('td','cs-accounts-action-cell');
            const profile=profileButton(person);if(profile)action.append(profile);
            const personActive=Boolean(person&&person.active!==false);
            const state=userStatus(active&&personActive,active?(personActive?'Aktiv':'Medarbejder arkiveret'):'Lukket');
            row.append(userIdentity(person?.name||'Medarbejder',account.email),role,state,action);rows.append(row);
          }
          users.append(table);
        }
        const waiting=invites.filter(item=>item.status==='pending');if(!waiting.length)pendingList.append(node('p','cs-accounts-empty','Ingen ventende invitationer.'));
        waiting.forEach(invite=>{const row=node('div','cs-accounts-invite-row');row.dataset.inviteId=invite.id;const copy=node('div','cs-accounts-invite-copy');copy.append(node('strong','cs-accounts-member-name',invite.name||invite.email),node('span','cs-accounts-member-email',invite.email),node('span','cs-accounts-member-permissions',nameFor(invite)+(invite.personId?' · '+personName(invite.personId):'')),node('span','cs-accounts-member-permissions cs-accounts-scope-summary',scopeLabel(invite.accessScope)));if(invite.expiresAt){const expires=new Date(invite.expiresAt);if(Number.isFinite(expires.getTime()))copy.append(node('span','cs-accounts-invite-expiry','Udløber '+expires.toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric'})));}const revoke=button('Tilbagekald',()=>revokeInvite(invite.id));revoke.setAttribute('aria-label','Tilbagekald invitation til '+invite.email);row.append(copy,revoke);pendingList.append(row);});
      }
      if(editingId&&!members.some(member=>member.userId===editingId&&!member.isOwner))closeMember();
      renderRoleList();updateTabs();for(const control of users.querySelectorAll('button'))control.disabled=pending||!canUsers;for(const control of pendingList.querySelectorAll('button'))control.disabled=pending||!canUsers;
    }

    function readAppLogin(account){
      if(!account||typeof account.personId!=='string'||typeof account.email!=='string'||!['active','revoked'].includes(account.status)||!Number.isSafeInteger(account.version))return null;
      return {personId:account.personId,email:account.email,status:account.status,version:account.version};
    }
    function renderRoleList(){
      roleList.replaceChildren();if(!canRoles)return;if(!roles.length){roleList.append(node('p','cs-accounts-empty','Der er endnu ingen roller at vise.'));return;}
      const showCounts=roles.some(role=>Number.isFinite(role.assignedCount)),{table,rows}=makeTable(showCounts?['Rolle','Rettigheder','Brugere','']:['Rolle','Rettigheder','']);table.classList.add('cs-accounts-roles-table');
      roles.forEach(role=>{const row=node('tr','cs-account-role-row');row.dataset.roleId=role.id;row.dataset.selected=String(roleEditingId===role.id);const name=node('td','cs-accounts-role-name-cell'),identity=node('div','cs-accounts-identity'),identityCopy=node('div','cs-accounts-identity-copy'),perms=permissionsFor(role),kind=!role.isSystem?'custom':perms.includes('roles.manage')?'admin':perms.includes('departments.manage')?'branch':perms.includes('plan')?'calendar':'person';identityCopy.append(node('strong','cs-accounts-member-name',role.name),node('span','cs-accounts-standard-role',role.isSystem?'Standardrolle':'Brugerdefineret'));identity.append(symbol(kind),identityCopy);name.append(identity);
        const permissions=node('td','cs-accounts-role-permissions-cell');permissions.append(permissionTags(perms));permissions.dataset.label='Rettigheder';row.append(name,permissions);if(showCounts){const count=node('td','cs-accounts-role-count-cell',Number.isFinite(role.assignedCount)?String(role.assignedCount):'—');count.dataset.label='Brugere';row.append(count);}
        const action=node('td','cs-accounts-action-cell');if(role.isSystem){const locked=node('span','cs-accounts-owner','Låst');locked.prepend(glyph('lock'));locked.title='Standardroller kan ikke ændres';action.append(locked);}else{const edit=button('Rediger',()=>openRole(role.id),'cs-button cs-account-edit-button');edit.setAttribute('aria-label','Rediger rollen '+role.name);edit.disabled=pending||!canAssign(role);if(!canAssign(role)){edit.title='Du kan kun redigere roller med rettigheder, som du selv har.';edit.setAttribute('aria-label','Rollen '+role.name+' kan ikke redigeres: den indeholder rettigheder, du ikke selv har.');}action.append(edit);}row.append(action);rows.append(row);
      });roleList.append(table);
    }
    function renderRoleChoices(){
      permissionOptions.replaceChildren();for(const permission of catalog){const label=node('label','cs-accounts-permission-option'),checkbox=node('input',''),copy=node('span','cs-accounts-permission-copy');checkbox.type='checkbox';checkbox.dataset.rolePermission=permission.key;checkbox.checked=roleDraft.has(permission.key);checkbox.disabled=pending||!canRoles||!canGrant(permission.key);copy.append(node('span','cs-accounts-permission-name',permission.label));if(permission.description)copy.append(node('span','cs-accounts-permission-description',permission.description));const requirements=requiredFor(permission.key);if(requirements.length)copy.append(node('span','cs-accounts-permission-description','Kræver: '+requirements.map(permissionLabel).join(', ')+'.'));if(!canGrant(permission.key))copy.append(node('span','cs-accounts-permission-unavailable','Du har ikke selv adgang til at tildele denne rettighed.'));label.dataset.available=String(canGrant(permission.key));label.append(checkbox,copy);permissionOptions.append(label);
        checkbox.addEventListener('change',()=>{if(pending||!canRoles||!canGrant(permission.key)){checkbox.checked=roleDraft.has(permission.key);return;}if(checkbox.checked){roleDraft.add(permission.key);const addRequirements=key=>{for(const required of requiredFor(key))if(!roleDraft.has(required)){roleDraft.add(required);addRequirements(required);}};addRequirements(permission.key);}else{roleDraft.delete(permission.key);let changed=true;while(changed){changed=false;for(const key of roleDraft)if(requiredFor(key).some(required=>!roleDraft.has(required))){roleDraft.delete(key);changed=true;}}}for(const input of permissionOptions.querySelectorAll('input[data-role-permission]'))input.checked=roleDraft.has(input.dataset.rolePermission);setBusy(false);});
      }
    }
    function focusRow(list,key,value,fallback){const row=[...list.querySelectorAll('tr')].find(item=>item.dataset[key]===String(value)),target=row?.querySelector('button')||fallback;target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'nearest',inline:'nearest'});}
    function openMember(userId){
      if(!canUsers||pending)return;
      const member=members.find(item=>item.userId===userId);if(!member||member.isOwner)return;
      editingId=member.userId;editVersion=member.version;editForm.name.value=member.name||'';editForm.role.value=member.roleId||'';
      editForm.status.value=member.status==='disabled'?'disabled':'active';editForm.scope.set(member.accessScope);
      populatePeople(editForm,member.personId||'',member.personId||'');editForm.update();editCaption.textContent=member.email||'';
      editError.hidden=true;editPanel.hidden=false;usersSide.hidden=false;usersWorkspace.dataset.editor='true';
      for(const row of users.querySelectorAll('[data-user-id]'))row.dataset.selected=String(row.dataset.userId===String(editingId));
      editForm.name.scrollIntoView?.({block:'nearest'});editForm.name.focus({preventScroll:true});
    }
    function openRole(roleId){
      if(!canRoles||pending)return;
      const role=roleId?roleFor(roleId):null;if(roleId&&(!role||role.isSystem||!canAssign(role)))return;
      roleEditingId=role?.id??null;roleEditVersion=role?.version??null;roleDraft=new Set(permissionsFor(role));roleName.value=role?.name||'';
      roleTitle.textContent=role?'Rediger rolle':'Opret rolle';roleError.hidden=true;rolePanel.hidden=false;roleEmpty.hidden=true;
      rolesSide.setAttribute('aria-labelledby',roleTitle.id);rolesWorkspace.dataset.editor='true';
      for(const row of roleList.querySelectorAll('[data-role-id]'))row.dataset.selected=String(row.dataset.roleId===String(roleEditingId));
      renderRoleChoices();setBusy(false);roleName.scrollIntoView?.({block:'nearest'});roleName.focus({preventScroll:true});
    }
    function closeMember(restoreFocus=false){
      const previous=editingId;editingId=null;editPanel.hidden=true;editError.hidden=true;usersSide.hidden=true;
      usersWorkspace.dataset.editor='false';
      for(const row of users.querySelectorAll('[data-user-id]'))row.dataset.selected='false';
      if(restoreFocus)focusRow(users,'userId',previous,usersTab);
    }
    function closeRole(restoreFocus=false){
      const previous=roleEditingId;roleEditingId=null;roleEditVersion=null;roleDraft=new Set();rolePanel.hidden=true;roleEmpty.hidden=false;
      rolesSide.setAttribute('aria-labelledby',roleEmptyHeading.id);rolesWorkspace.dataset.editor='false';roleError.hidden=true;
      for(const row of roleList.querySelectorAll('[data-role-id]'))row.dataset.selected='false';
      if(restoreFocus)focusRow(roleList,'roleId',previous,createRoleButton);
    }
    async function saveMember(){
      if(!editingId||pending||!canUsers||!validateUser(editForm,editError))return;const payload={name:editForm.name.value.trim(),roleId:editForm.role.value,personId:editForm.person.value||null,userId:editingId,version:editVersion,status:editForm.status.value==='disabled'?'disabled':'active',...(!needsEmployee(roleFor(editForm.role.value))?{accessScope:editForm.scope.current()}:{})};
      await perform('updateMember',payload,editError,async(result,token)=>{closeMember();status.textContent='Brugerens adgang er opdateret.';status.hidden=false;await refreshAfterMutation(token);},()=>focusRow(users,'userId',payload.userId,usersTab));
    }
    async function submitNewUser(){
      if(createDialog.hidden||inviteForm.form.hidden||pending||!canUsers||!validateUser(inviteForm,inviteError))return;const email=inviteForm.email.value.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showError(inviteError,'Skriv en gyldig e-mailadresse.');inviteForm.email.focus();return;}
      const name=inviteForm.name.value.trim(),roleId=inviteForm.role.value;
      if(needsEmployee(roleFor(roleId))){
        await perform('createEmployeeUser',{name,email,roleId,site:Number(inviteForm.site.value)},inviteError,async(result,token)=>{
          const employee=result.createdEmployee,account=readAppLogin(result.account);
          if(typeof employee?.id!=='string'||!employee.id||account?.personId!==employee.id)throw Error('Medarbejderen og app-login kunne ikke bekræftes. Opdater listen.');
          createdPersonId=employee.id;
          staffCandidates=[...staffList().filter(person=>person.id!==employee.id),employee];
          appLogins=[...appLogins.filter(item=>item.personId!==account.personId),account];
          renderLists();
          employeeResultCopy.textContent='App-login er klar til '+account.email+'. Startkoden findes under Oplysninger → App-login på profilen.';
          inviteDescription.hidden=true;
          inviteForm.form.hidden=true;
          employeeResult.hidden=false;
          resetInvite();
          status.textContent='Medarbejderen og app-login er oprettet.';
          status.hidden=false;
          await refreshAfterMutation(token);
        },()=>{
          if(createDialog.hidden)return;
          const target=employeeProfileLink.disabled?createClose:employeeProfileLink;
          target.focus({preventScroll:true});
        });
        return;
      }
      await perform('invite',{name,email,roleId,newUser:true,accessScope:inviteForm.scope.current()},inviteError,async(result,token)=>{
        clearCreationResult();
        inviteResultId=result.invite?.id??null;inviteUrl=typeof result.inviteUrl==='string'?result.inviteUrl:'';
        link.value=inviteUrl;invitationResult.hidden=!inviteUrl;copyStatus.textContent='';
        resultCopy.textContent='Del det personlige link med '+email+'.';
        status.textContent='Invitationen er oprettet.';
        status.hidden=Boolean(inviteUrl);
        await refreshAfterMutation(token);
      },()=>{
        closeCreation();
        selectTab('invites');
        const target=inviteUrl?copy:invitesTab;
        target.focus({preventScroll:true});
        target.scrollIntoView?.({block:'nearest'});
      });
    }
    function clearCreationResult(){
      inviteUrl='';inviteResultId=null;link.value='';invitationResult.hidden=true;
      createdPersonId=null;employeeResultCopy.textContent='';employeeResult.hidden=true;
    }
    async function revokeInvite(inviteId){const invite=invites.find(item=>item.id===inviteId);await perform('revokeInvite',{inviteId,...(invite?.version!==undefined?{version:invite.version}:{})},globalError,async(result,token)=>{if(inviteResultId===inviteId){inviteResultId=null;inviteUrl='';link.value='';invitationResult.hidden=true;copyStatus.textContent='';}status.textContent='Invitationen er tilbagekaldt.';status.hidden=false;await refreshAfterMutation(token);});}

    async function saveRole(){
      if(!canRoles||pending)return;const name=roleName.value.trim(),permissions=catalog.filter(permission=>roleDraft.has(permission.key)).map(permission=>permission.key);if(!name){showError(roleError,'Skriv et navn til rollen.');roleName.focus();return;}if(permissions.some(key=>!canGrant(key))){showError(roleError,'Du kan kun tildele rettigheder, som du selv har.');return;}if(permissions.some(key=>requiredFor(key).some(required=>!permissions.includes(required)))){showError(roleError,'Vælg også de rettigheder, som de valgte rettigheder kræver.');return;}
      const updating=roleEditingId!==null,payload={name,permissions,...(updating?{roleId:roleEditingId,version:roleEditVersion}:{})};await perform(updating?'updateRole':'createRole',payload,roleError,async(result,token)=>{closeRole();status.textContent=updating?'Rollen er opdateret.':'Rollen er oprettet og kan nu vælges til brugere.';status.hidden=false;await refreshAfterMutation(token);},()=>focusRow(roleList,'roleId',payload.roleId,createRoleButton));
    }
    async function copyLink(){if(!inviteUrl||pending||!canUsers)return;try{if(win?.navigator?.clipboard?.writeText){await win.navigator.clipboard.writeText(inviteUrl);copyStatus.textContent='Linket er kopieret.';return;}}catch{}link.focus();link.select();try{if(doc.execCommand?.('copy')){copyStatus.textContent='Linket er kopieret.';return;}}catch{}copyStatus.textContent='Linket er markeret. Kopiér det med Ctrl+C eller ⌘C.';}
    function close(){closeCreation();closeHelp(false);closeMember();closeRole();}
    function render(next={}){
      if(disposed)return;viewer=next.viewer||null;capabilities=next.capabilities||{};canUsers=capabilities.manageUsers===true;canRoles=capabilities.manageRoles===true;canAppLogins=capabilities.manageAppLogins===true;const allowed=canUsers||canRoles,key=String(viewer?.userId??viewer?.id??viewer?.email??'')+'|'+JSON.stringify([canUsers,canRoles,canAppLogins,capabilities.plan===true,viewer?.accessScope,capabilities.allowedDepartmentIds,[...grantSet()].sort()]);
      if(!allowed){authorized=false;epoch++;pending=false;loaded=false;mounted=false;members=[];invites=[];roles=[];catalog=[];staffCandidates=[];inviteSites=[];accessDepartments=[];appLogins=[];close();resetInvite();clearCreationResult();element.replaceChildren();return;}
      const changed=!authorized||identity!==key;authorized=true;identity=key;if(changed){epoch++;pending=false;loaded=false;members=[];invites=[];roles=[];catalog=[];staffCandidates=[];inviteSites=[];accessDepartments=[];appLogins=[];close();tab=canUsers?'users':'roles';clearCreationResult();inviteForm.role.replaceChildren();editForm.role.replaceChildren();resetInvite();inviteError.hidden=true;copyStatus.textContent='';globalError.hidden=true;status.hidden=true;renderLists();}
      if(!mounted||!element.contains(body)){element.replaceChildren(body);mounted=true;}setBusy(pending);if(!loaded&&!pending)load();
    }
    function open(){if(authorized&&!pending)return load();}
    function destroy(){if(disposed)return;close();clearCreationResult();disposed=true;authorized=false;epoch++;element.replaceChildren();}
    function helpData(){return authorized?{roleName:viewer?.roleName||roleFor(viewer?.roleId)?.name||'',permissions:[...grantSet()].map(key=>({key,label:permissionLabel(key)}))}:{roleName:'',permissions:[]};}
    return Object.freeze({render,open,close,destroy,helpData});
  }
  const api=Object.freeze({mount});globalThis.CleanRoomsAccountsView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
