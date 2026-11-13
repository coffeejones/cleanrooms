(() => {
  const root = document.getElementById('cleanrooms-studio');
  const q = selector => root.querySelector(selector);
  const staff = globalThis.CleanRoomsData.staffFor({}).map(person=>({...person}));
  let staffById=new Map(staff.map(person=>[person.id,person]));
  const rosterSelectSnapshots=new WeakMap();
  const sites = [{name:'Kontor Nord',address:'Nordvej 12 · 8000 Aarhus C',color:'var(--cs-blue)'},{name:'Klinikken',address:'Park Allé 8 · 8000 Aarhus C',color:'var(--cs-purple)'},{name:'Havnegade',address:'Havnegade 24 · 8000 Aarhus C',color:'var(--cs-orange)'}];
  const anchor = globalThis.CleanRoomsData.anchor;
  const today = globalThis.CleanRoomsData.today;
  const leaLeaveDate = '2026-10-28';
  const Engine = globalThis.CleanRoomsSeries;
  const SeriesPlanner = globalThis.CleanRoomsSeriesPlanner;
  const SeriesLifecycle = globalThis.CleanRoomsSeriesLifecycle;
  const SeriesCalendar = globalThis.CleanRoomsSeriesCalendar;
  const SeriesExamples = globalThis.CleanRoomsSeriesExamples;
  const Actions = globalThis.CleanRoomsActions;
  const Bulk = globalThis.CleanRoomsBulk;
  const Changes = globalThis.CleanRoomsChanges;
  const Staffing = globalThis.CleanRoomsStaffing;
  const Demo = globalThis.CleanRoomsDemo;
  const Coverage = globalThis.CleanRoomsCoverage;
  const Description = globalThis.CleanRoomsDescription;
  const Instructions = globalThis.CleanRoomsInstructions;
  const Checklist = globalThis.CleanRoomsChecklist;
  const EmployeeCalendar = globalThis.CleanRoomsEmployeeCalendar;
  const Departments = globalThis.CleanRoomsDepartments;
  const PlanData = globalThis.CleanRoomsData;
  const Publication = globalThis.CleanRoomsPublication;
  const Roster = globalThis.CleanRoomsRoster;
  const RosterPlanning = globalThis.CleanRoomsRosterPlanning;
  const ProfileCalendar = globalThis.CleanRoomsEmployeeProfileCalendar;
  const Payroll = globalThis.CleanRoomsPayroll;
  const PayrollGroups = globalThis.CleanRoomsPayrollGroups;
  const PlanningRecords=globalThis.CleanRoomsPlanningRecords,PlanningScope=globalThis.CleanRoomsPlanningScope;
  const PlanningReconcile=globalThis.CleanRoomsPlanningReconcile;
  const descriptionEditor = globalThis.CleanRoomsRichEditor?.mount({element:q('#cs-description-editor'),sourceInput:q('#cs-edit-note')});
  const shiftEditorPickers = globalThis.CleanRoomsShiftEditorPickers?.mount(q('#cs-edit-form'), icon);
  if (!descriptionEditor) { q('#cs-edit-note').hidden = false; q('#cs-edit-note').removeAttribute('aria-hidden'); q('#cs-edit-note').removeAttribute('tabindex'); q('#cs-edit-note').setAttribute('aria-labelledby','cs-description-label'); }
  const initialSeries = {id:'jonas-plan',person:'p0',site:0,startDate:anchor,endDate:Engine.addMonths(anchor,6),weekdays:[1,3],start:'07:00',end:'15:00',note:''};
  const leaveRequests = PlanData.leaveRequests();
  const dayNames = ['Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag','Søndag'];
  const plannerWeekFormat = new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const state = {page:'schedule',group:'people',view:'week',zoom:1,calendarLayoutVersion:2,day:2,onlyOpen:false,week:0,pageIndex:0,search:'',site:'all',edits:{},deleted:[],series:[{...initialSeries,weekdays:[1,3]}],weekPlans:{},requests:{},leaveDecisions:{},coverageRules:Coverage?.defaultRules() || [],demoSession:null,demoReturnPage:'schedule',storageVersion:1,role:'admin',employeePerson:'p0',employeeWeek:anchor,employeeDate:anchor,employeeView:'month',employeeCalendarVersion:1,employeeShift:null,checklistProgress:{},employeeExamplesVersion:0};
  const design = {rowHeight:78,showAvatars:true};
  const pageSize = 7;
  const weekday = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
  const compactViewport = globalThis.matchMedia?.('(max-width: 760px)');
  const motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let activeEdit = null, lastTrigger = null, visibleCount = 0, visibleShifts = [], lastRenderKey = null;
  let repeatDays = new Set(), editorSeriesId = '', lastUndo = null, reviewTrigger = null;
  let editorPlanCapture=null,editorDirtyBaseline=null,editorDiscard=null,saveFeedbackEpoch=0;
  let planningReadBusy=false,planningReadKey='',planningReadBlocked='',planningReadPromise=null;
  let plannerDetailBusy=false,plannerDetailEpoch=0,plannerDetailSelection=new Set();
  const plannerViewport={key:'',wanted:null,visible:[],busy:false,loadingRange:null,epoch:0,error:'',errorRange:null,restore:true};
  const plannerHeaderCache=new Map();let plannerHeaderGeneration=null;
  let plannerViewportResumeQueued=false;
  let plannerWarmTimer=null,plannerWarmKey='',plannerWarmEpoch=0;
  let planningSeriesCount=null;
  let planningRetryWork=null;
  const planningFullHolds=new Set(),planningScopeHolds=new Map();
  let planningCatalog=null;
  let seriesStatus='active', editorSeriesManagement=false, editorSeriesCreation=false, editorPreviousScope='one', editorScopeDrafts=new Map(), editorSharedSeriesDraft=null, editorWasSeries=null;
  let editorOperation='create',editorTemplate=null,editorExtension=null,editorOpenEnded=false,editorWeekAnchor=null,editorDayTimes={},seriesCalendarState={},seriesCalendarPreview=null;
  const expandedSeriesGroups=new Set();
  let activeGroup = null, calendarDispose = null, calendarViewportBoard = null;
  let selectionMode = false, selectedIds = new Set(), selectionScope = null;
  let activeBulk = null, changesTrigger = null;
  let staffPickerOpen = false, staffingContextCache = null, staffingAssessments = new Map(), selectedStaffing = null,staffPickerPage=0,staffPickerTerm='';
  let planningAvailability=null;
  let operationsFilter = 'all', operationsTrigger = null, needsTrigger = null, needDays = new Set([0,1,2,3,4]), activeReplacement = null;
  let lastNavigationMotionKey = null, navigationAnimation = null;
  let directory = null, directoryBusy = false, directoryProfileEpoch = 0, employeeDirectoryRecord = null;
  let persistence = null, cloudStatus = {state:'saved',message:'Alle ændringer er gemt'}, cloudLoaded = !globalThis.CleanRoomsPersistence;
  let departmentView = null, cloudCapabilities = {manageDepartments:false};
  let accessReloadPending=false;
  let sessionViewer = null, employeeData = null, accountsView = null, accountsElement = null;
  let chatView=null,chatElement=null,chatContextKey='',chatWorkspaceId='',chatBadgeEpoch=0,chatBadgeTimer=null,chatBadgeBusy=false,chatBadgeAt=0;
  let employeeReader=null,employeeDetailEpoch=0,employeeDetailLoading=false,employeeDetailError='',employeeDetailData=null;
  let rosterView=null,rosterElement=null,guideView=null,guideElement=null;
  let leaveView=null,leaveElement=null,historyView=null,historyElement=null,leaveBusy=false,pageHelp=null,leaveRefresh=0,leavePending=null,leaveQueryEpoch=0;
  const leaveDecisionRows=new Map();
  let employeeProfileId=null,employeeProfileMonth=today.slice(0,7),employeeProfileView=null,employeeProfileElement=null;
  let profileInformationPending=null,profileAppLogin=null,profileAppLoginEpoch=0;
  let payrollView=null,payrollElement=null,payrollEpoch=0,payrollMonth=today.slice(0,7);
  const payrollState={personId:null,payroll:null,version:0,policy:null,policyVersion:0,loaded:false,loading:false,error:'',updatedAt:null};
  let payrollPolicyView=null,payrollPolicyElement=null,payrollPolicyEpoch=0;
  let payrollProfileReturn=null,payrollPolicyPendingOpen=null,payrollProblemReturn=null;
  let payrollPersonGroupView=null,payrollPersonGroupElement=null;
  const payrollPolicyState={policy:null,version:0,people:[],history:[],loaded:false,loading:false,error:''};
  let timeFocus=null;
  let timeView=null,timeElement=null,timeEpoch=0,timeLoadedKey='',timeLoadingKey='',timeRequest=null,timeBusy=false,timeDemoEmployee=false,timeContext='',timeLastRead=0;
  const timePaging={context:'',page:0,cursors:[null],offsets:[0],nextCursor:null,generation:null,filter:{queue:'all',search:'',scope:'real'}};
  const timePageCache=new Map();let timeFilterTimer=null,timeFilterWaiters=[];
  const timeState={entries:[],shifts:[],plannedRows:[],demo:{active:false},loading:false,error:'',canManage:false,canViewPayroll:false};
  let publicationBusy=false,includeRelatedPublication=false,publicationSiteSelection=null,publicationRange=null,publicationRangeView=null,publicationRangeValid=true,publicationReviewView=null,publicationReviewElement=null;
  let publicationCanSubmit=false,publicationRead=null,publicationBudget=null,publicationResume=null;
  let publicationSubmitError='',publicationFeedback={};
  let publicationSiteCombo=null;
  const calendarBudgetCache=new Map();
  let calendarBudgetRequest=null,calendarBudgetError=null;
  const planningCostCache=new Map();
  let planningCostRequest=null,planningCostError=null,planningCostEpoch=0,planningCostView=null,planningCostSelection=null;
  let employeeWorkspace='calendar',workflowView=null,workflowElement=null,workflowMountedMode='',workflowEpoch=0,workflowKey='',workflowLoadedKey='',workflowLoading=false,workflowBundle=null,workflowError='',workflowSelectedShift=null,workflowLastRead=0,workflowPane=null,workflowChrome=null,workflowDemoActive=false,workflowDemoPerson='',workflowDemoView='employee';
  state.calendarAnchor=anchor;state.publications={version:1,sequence:0,slots:{},records:[]};state.activity=[];state.workspaceSettings={};
  state.organization = Departments?.defaultOrganization() || null; state.departmentId = 'all';

  function selectedDepartment() { return state.organization?.departments.find(item => item.id === state.departmentId) || null; }
  function availabilityReader() {
    const allowed=cloudLoaded&&cloudCapabilities.plan&&state.role!=='employee'&&!state.demoSession&&Boolean(chatWorkspaceId);
    if(!allowed){planningAvailability?.reset();return null;}
    if(!planningAvailability&&globalThis.CleanRoomsPlanningAvailability)planningAvailability=globalThis.CleanRoomsPlanningAvailability.create({request:payload=>accountAction('planningAvailability',payload),onUpdate:()=>{
      staffingAssessments.clear();
      if(activeEdit){refreshStaffing();if(editorRepeats()&&seriesCalendarPreview){const {draft,result,source,scope}=seriesCalendarPreview;seriesCalendarPreview.assessment=seriesCalendarAssessment(draft,result,source||sourceSeries(),scope||q('#cs-edit-scope').value);renderSeriesCalendar();}}
      if(activeReplacement)renderReplacement();
      if(state.page==='schedule'&&state.role!=='employee'&&!activeEdit&&!q('.is-dragging')&&effectiveView()!=='day')renderWeek();
    }});
    planningAvailability?.setContext(JSON.stringify([chatWorkspaceId,sessionViewer?.userId,cloudCapabilities.plan]));
    return planningAvailability;
  }
  function requestPlanningAvailability(templates,personIds,full=false) {
    const reader=availabilityReader();if(!reader)return;
    const days=[...new Set(templates.flatMap(planningWorkedDays))].sort(),ids=[...new Set(personIds.filter(Boolean))];
    if(!days.length||!ids.length)return;
    for(let offset=0,windows=0;offset<days.length&&windows<12;windows++){
      const from=days[offset],limit=addDays(from,55);let next=offset;
      while(next<days.length&&days[next]<=limit)next++;
      const to=days[next-1];
      for(let index=0;index<ids.length;index+=500)void reader.ensure({from,to,personIds:ids.slice(index,index+500)});
      offset=next;
      if(!full)break;
    }
  }
  function planningWorkedDays(shift){return globalThis.CleanRoomsPlanningAvailability?.workedDates(shift)||(Actions.validDate(shift?.date)?[shift.date]:[]);}
  function unavailableDatesFor(personId,templates) {
    const reader=availabilityReader();if(!reader||!personId)return [];
    return [...new Set(templates.flatMap(planningWorkedDays).filter(day=>reader.isUnavailable(personId,day)))].sort();
  }
  function withAvailability(assessment,personId,templates) {
    const reader=availabilityReader(),days=[...new Set(templates.flatMap(planningWorkedDays))],statuses=reader?days.map(day=>reader.status(personId,day)):[];
    const availabilityStatus=!reader||!days.length?'not-applicable':statuses.every(status=>status==='ready')?'ready':statuses.includes('error')?'error':statuses.includes('loading')?'loading':'unknown';
    return {...assessment,unavailableDates:unavailableDatesFor(personId,templates),availabilityStatus};
  }
  function calendarBudgetArea() {
    const department=selectedDepartment(),site=state.site!=='all'?sites[Number(state.site)]:null;
    const scope=site?{kind:'site',id:site.id}:department?{kind:'department',id:department.id}:{kind:'company'};
    const configured=site?site.workHoursBudget:department?department.workHoursBudget:state.workspaceSettings?.workHoursBudget;
    return {scope,budget:Roster.validWorkHoursBudget(configured)?configured:null,label:[...new Set([department?.name,site?.name].filter(Boolean))].join(' · ')||'Hele virksomheden'};
  }
  function allowedSite(index){return Boolean(sites[index]&&!sites[index].restricted&&(cloudCapabilities.scopeRestricted!==true||cloudCapabilities.allowedSiteIds?.includes(index)));}
  function allowedSiteIndices(){return sites.map((_,index)=>index).filter(allowedSite);}
  function inDepartment(site) { return allowedSite(site)&&(state.page !== 'schedule' || !selectedDepartment() || selectedDepartment().siteIds.includes(site)); }
  function visibleSite(site) { return inDepartment(site) && (state.site === 'all' || site === Number(state.site)); }
  function defaultShiftSite() { return state.site !== 'all' ? Number(state.site) : state.page === 'schedule' && selectedDepartment() ? selectedDepartment().siteIds.find(allowedSite) : allowedSiteIndices()[0]??0; }
  function canManageDepartments() { return cloudLoaded && state.role === 'admin' && cloudCapabilities.manageDepartments === true; }
  function realEmployee() { return Boolean(sessionViewer && !cloudCapabilities.plan); }
  function scopedEmployee(){return Boolean(employeeReader&&sessionViewer&&state.role==='employee'&&!timeDemoEmployee&&!state.demoSession);}
  function employeeScope(){const view=['month','week','day'].includes(state.employeeView)?state.employeeView:'month',range=EmployeeCalendar.range(view,state.employeeDate||currentEmployeeDate());return {personId:realEmployee()?sessionViewer.personId:state.employeePerson,from:range.from,to:range.to};}
  function adoptEmployeeRead(value){
    const id=realEmployee()?sessionViewer?.personId:state.employeePerson;
    if(state.role!=='employee'||!id)return;
    if(value.data?.person?.id===id){const leave=employeeData?.person?.id===id?employeeData.leaveRequests||[]:[];employeeData={...value.data,leaveRequests:leave};if(employeeDetailData?.shift?.person===id&&employeeDetailData.shift.id===state.employeeShift){employeeData.shifts=[...employeeData.shifts.filter(shift=>shift.id!==employeeDetailData.shift.id),employeeDetailData.shift];employeeData.progress=employeeDetailData.progress||{};}}
    else if(value.error)employeeData={person:employeeData?.person?.id===id?employeeData.person:personFor(id),shifts:[],taskSummaries:{},progress:{},sites:[],leaveRequests:employeeData?.person?.id===id?employeeData.leaveRequests||[]:[]};
    if(realEmployee()&&employeeData?.person){for(const site of employeeData.sites||[])sites[site.index]={...site};syncRoster();}
    if(cloudLoaded&&scopedEmployee())renderEmployee();
  }
  function loadEmployeeRead(force=false){return scopedEmployee()?employeeReader.load(employeeScope(),{force}):Promise.resolve({ok:true});}
  async function openEmployeeShift(id,summary=null){
    const generation=++employeeDetailEpoch,personId=realEmployee()?sessionViewer?.personId:state.employeePerson;
    employeeReader?.cancelDetail();employeeDetailData=null;employeeDetailError='';
    if(!id){state.employeeShift=null;employeeDetailLoading=false;if(scopedEmployee())adoptEmployeeRead({data:employeeReader.data});render();save();return true;}
    const shift=summary||shiftById(id);if(shift?.person&&shift.person!==personId)return false;
    state.employeeShift=id;
    if(validEmployeeDate(shift?.date)){const range=EmployeeCalendar.range(state.employeeView,state.employeeDate);if(shift.date<range.from||shift.date>range.to){state.employeeDate=shift.date;state.employeeWeek=staffingMonday(shift.date);}}
    if(!scopedEmployee()){render();save();return true;}
    employeeDetailLoading=true;render();
    const period=await loadEmployeeRead();
    if(generation!==employeeDetailEpoch||!scopedEmployee()||state.employeeShift!==id)return false;
    if(!period?.ok){employeeDetailLoading=false;employeeDetailError=period?.message||'Vagterne kunne ikke indlæses.';state.employeeShift=null;render();return false;}
    const result=await employeeReader.open({personId,shiftId:id});
    if(generation!==employeeDetailEpoch||!scopedEmployee()||state.employeeShift!==id)return false;
    employeeDetailLoading=false;
    if(result.ok){employeeDetailData=result;adoptEmployeeRead({data:employeeReader.data});}
    else{employeeDetailError=result.message||'Vagten findes ikke længere i din udgivne plan.';state.employeeShift=null;notify(employeeDetailError);}
    render();save();return result.ok;
  }
  function hasAccountAccess() { return cloudCapabilities.manageUsers === true || cloudCapabilities.manageRoles === true; }
  function currentEmployeeDate() { const value=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return validEmployeeDate(value)?value:anchor; }
  function accountPreferences() {
    if(realEmployee())return {page:state.page==='chat'?'chat':state.role==='employee'?'schedule':'accounts',...(employeeData?.person?{employeePerson:sessionViewer.personId,employeeDate:state.employeeDate,employeeView:state.employeeView}:{})};
    return {calendarAnchor:anchor,page:state.page,role:state.role,employeePerson:state.employeePerson,employeeDate:state.employeeDate,employeeView:state.employeeView,departmentId:state.departmentId,week:state.week,day:state.day,site:state.site,search:state.search,view:state.view,zoom:state.zoom,group:state.group,onlyOpen:state.onlyOpen,pageIndex:state.pageIndex};
  }
  async function accountAction(action,payload={}) {
    if(!persistence?.action)return {ok:false,message:'Kontoen er ikke indlæst.'};
    const viewerAtStart=sessionViewer;
    const result=await persistence.action(action,payload);
    if(result.superseded)return result;
    if(result.ok&&['payrollSave','payrollPolicySave','payrollPersonPolicySave'].includes(action)){planningCostEpoch++;planningCostCache.clear();planningCostError=null;}
    if(result.status===403){clearPayroll();clearPayrollPolicy();clearTimekeeping();payrollProfileReturn=null;payrollPolicyPendingOpen=null;}
    if(result.status===403||result.ok&&action==='updateRole'||result.ok&&action==='updateMember'&&payload.userId===sessionViewer?.userId)await initializeCloud();
    if(result.ok&&['invite','createEmployeeUser'].includes(action)&&result.createdEmployee&&directory?.ready&&sessionViewer===viewerAtStart){
      const updated=directory.reconcile(result);
      if(!updated.ok)await directory.get('employee',result.createdEmployee.id,{force:true});
    }
    return result;
  }
  function chatAvailable(){return Boolean(cloudLoaded&&sessionViewer&&cloudCapabilities.chat&&(cloudCapabilities.manageChat||sessionViewer.personId)&&!(state.role==='employee'&&!realEmployee()&&!cloudCapabilities.manageChat));}
  function chatPreviewPerson(){return state.role==='employee'&&!realEmployee()&&cloudCapabilities.manageChat?state.employeePerson:null;}
  function chatActive(){return state.role==='employee'?employeeWorkspace==='chat':state.page==='chat';}
  function chatBadge(value){const count=Math.max(0,Number(value)||0),el=q('#cs-chat-count');el.textContent=count>99?'99+':String(count);el.hidden=!count;}
  function clearChat(){chatBadgeEpoch++;chatView?.destroy?.();chatView=null;chatElement=null;chatContextKey='';chatBadgeBusy=false;chatBadgeAt=0;chatBadge(0);}
  async function chatAction(action,payload={}){
    const previewPersonId=chatPreviewPerson();
    if(previewPersonId&&!['chatList','chatRead','chatSync'].includes(action))return {ok:false,status:403,message:'Forhåndsvisningen er skrivebeskyttet. Brug medarbejderens egen konto for at skrive.'};
    return persistence?.action?persistence.action(action,{...payload,...(previewPersonId?{previewPersonId}:{})}):{ok:false,status:503,message:'Chatten er ikke indlæst.'};
  }
  async function refreshChatBadge(force=false){
    if(!chatAvailable()||chatBadgeBusy||chatActive()||document.visibilityState==='hidden'||!force&&Date.now()-chatBadgeAt<30000)return;
    const epoch=chatBadgeEpoch,identity=String(sessionViewer.userId)+':'+String(chatPreviewPerson());chatBadgeBusy=true;chatBadgeAt=Date.now();
    try{const result=await chatAction('chatList',{});if(epoch!==chatBadgeEpoch||identity!==String(sessionViewer?.userId)+':'+String(chatPreviewPerson()))return;if(result.ok)chatBadge(result.unreadCount??(result.rooms||[]).filter(room=>!room.muted).reduce((sum,room)=>sum+(Number(room.unread)||0),0));else if([401,403,404].includes(result.status))clearChat();}
    finally{if(epoch===chatBadgeEpoch)chatBadgeBusy=false;}
  }
  function renderChat(employee=false){
    if(!globalThis.CleanRoomsChat||!chatAvailable())return;
    const key=String(sessionViewer.userId)+':'+String(chatPreviewPerson()||'self'),host=employee?q('#cs-employee-content'):q('#cs-page-content');
    if(!chatView||key!==chatContextKey){clearChat();chatContextKey=key;chatElement=node('div','cs-chat-host');chatElement.id='cs-chat-page';chatView=globalThis.CleanRoomsChat.mount({element:chatElement,onAction:chatAction,viewer:sessionViewer,onUnread:chatBadge});}
    if(chatElement.parentElement!==host)host.replaceChildren(chatElement);
    chatView.render({viewer:sessionViewer,capabilities:cloudCapabilities,employee,readonly:Boolean(chatPreviewPerson()),active:true,workspaceId:chatWorkspaceId});chatView.setActive?.(true);
  }
  function openChat(){
    if(!chatAvailable())return;
    accountsView?.close?.();departmentView?.close();closeOperationsSheets();closeEditor();
    planningRetryWork=null;planningFullHolds.clear();planningScopeHolds.clear();state.employeeShift=null;timeDemoEmployee=false;
    if(state.role==='employee'||realEmployee()&&!cloudCapabilities.manageChat){employeeWorkspace='chat';state.role='employee';}else state.role='admin';
    state.page='chat';render();save();
  }
  function renderPageHelp(){
    if(!globalThis.CleanRoomsPageHelp)return;
    if(!pageHelp)pageHelp=globalThis.CleanRoomsPageHelp.mount({element:q('#cs-page-help-root')});
    const employee=state.role==='employee',context=employee&&employeeWorkspace==='chat'?'chat':employee&&employeeWorkspace==='messages'?'messages':employee&&employeeWorkspace==='exchanges'?'exchanges':!employee&&state.page==='people'&&employeeProfileId?(q('[data-profile-focus="tab:pay"][aria-pressed="true"]')?'payroll-person':'profile'):!employee&&state.page==='payroll'&&payrollPolicyView?.context?.()?'payroll-group':'';
    pageHelp.render({page:employee?'employee':state.page,context,viewer:sessionViewer,capabilities:cloudCapabilities,getAccountHelp:()=>accountsView?.helpData?.()});
  }
  function openPageHelp(trigger){renderPageHelp();pageHelp?.open(trigger);}
  function renderSession() {
    const employee=realEmployee(),canPlan=!sessionViewer||cloudCapabilities.plan;
    const settingsNav=q('#cs-settings-nav'),settingsParent=isCompact()?q('.cs-nav'):q('.cs-workspace');
    if(settingsNav.parentElement!==settingsParent)settingsParent.append(settingsNav);
    root.dataset.accountRole=sessionViewer?.role||'admin';
    root.querySelectorAll('.cs-nav-button[data-page]').forEach(button=>{button.hidden=state.role==='employee'&&button.dataset.page!=='accounts'?true:button.dataset.page==='accounts'?!hasAccountAccess():button.dataset.page==='payroll'?(!canViewPayroll()||cloudCapabilities.companyPayroll===false):['workspace','demo'].includes(button.dataset.page)&&cloudCapabilities.scopeRestricted===true?true:!canPlan;});
    root.querySelectorAll('[data-employee-workspace]').forEach(button=>{button.hidden=state.role!=='employee';});
    q('#cs-chat-nav').hidden=!chatAvailable();
    q('#cs-chat-nav').setAttribute('aria-current',chatActive()?'page':'false');
    q('#cs-open-admin').hidden=!canPlan;q('.cs-employee-demo-controls label').hidden=employee||sessionViewer&&!cloudCapabilities.previewEmployees;
    q('.cs-nav-divider').hidden=!canPlan||state.role==='employee';q('.cs-nav-label').textContent=state.role==='employee'?'Personligt':canPlan?'Planlægning':hasAccountAccess()?'Administration':'Personligt';
    q('#cs-open-employee').hidden=Boolean(sessionViewer&&!canPlan&&!employeeData?.person);
    q('#cs-open-employee').setAttribute('aria-label',employee?'Mine vagter':'Medarbejdervisning');
    if(sessionViewer){
      q('.cs-account-name').textContent=sessionViewer.name||sessionViewer.email;
      q('.cs-account-role').textContent=sessionViewer.roleName||({admin:'Administrator',planner:'Planlægger',employee:'Medarbejder'})[sessionViewer.role]||'';
      q('.cs-account>.cs-avatar').textContent=(sessionViewer.name||sessionViewer.email||'').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
      q('.cs-workspace-caption').textContent=state.role==='employee'?'Medarbejdervisning':canPlan?'Planlægning':hasAccountAccess()?'Administration':'Medarbejdervisning';
    }
    root.style?.setProperty('--cs-nav-items',String([...root.querySelectorAll('.cs-nav-button')].filter(button=>!button.hidden).length||1));
  }
  function renderAccounts() {
    if(!hasAccountAccess()){state.page='schedule';render();return;}
    if(!accountsElement?.isConnected){
      accountsView?.destroy?.();accountsElement=node('div','cs-secondary-page');accountsElement.id='cs-accounts-page';q('#cs-page-content').replaceChildren(accountsElement);
      accountsView=globalThis.CleanRoomsAccountsView?.mount({element:accountsElement,onAction:accountAction,staff,externalHelp:true,onOpenEmployee:personId=>openEmployeeProfile(personId,{information:true})});
    }
    accountsView?.render({viewer:sessionViewer,capabilities:cloudCapabilities});
  }
  function syncOrganization() {
    if (!state.organization) return;
    sites.splice(0,sites.length,...state.organization.sites.map(site => ({
      ...site,
      address:['site-nord','site-klinik','site-havn'].includes(site.id)?site.address?.replace(/ \(demo\)$/i,''):site.address
    })));
  }
  function canEditWorkspace(){return cloudLoaded&&cloudCapabilities.plan===true&&cloudCapabilities.manageUsers===true&&!cloudStatus.conflict;}
  function canManageSiteGps(){return cloudLoaded&&cloudCapabilities.manageSiteGps===true;}
  function syncRoster(){
    staff.splice(0,staff.length,...(realEmployee()?(employeeData?.person?[employeeData.person]:[]):PlanData.staffFor(state)).map(person=>({...person})));
    staffById=new Map(staff.map(person=>[person.id,person]));
    if(!staffById.has(state.employeePerson))state.employeePerson=staff.find(person=>person.active!==false)?.id||staff[0]?.id||'';
    const optionSignature=JSON.stringify(staff.map(person=>[person.id,person.name,person.active===false])),optionIds=new Set(staff.map(person=>String(person.id)));
    for(const selector of ['#cs-edit-person','#cs-employee-person']){
      const select=q(selector),previous=select.value,hasEmpty=selector==='#cs-edit-person';
      // Refresh staff data above, but retain native option nodes and selection
      // when only non-display fields (or the planning period) have changed.
      if(rosterSelectSnapshots.get(select)===optionSignature&&select.options.length===staff.length+(hasEmpty?1:0)&&(optionIds.has(previous)||hasEmpty&&previous===''))continue;
      select.replaceChildren();
      if(selector==='#cs-edit-person'){const empty=node('option',null,'Ledig vagt');empty.value='';select.append(empty);}
      staff.forEach(person=>{const option=node('option',null,person.name+(person.active===false?' · arkiveret':''));option.value=person.id;if(selector==='#cs-edit-person'&&person.active===false)option.disabled=true;select.append(option);});
      if([...select.options].some(option=>option.value===previous))select.value=previous;
      rosterSelectSnapshots.set(select,optionSignature);
    }
    q('.cs-nav-button[data-page="people"] .cs-nav-count').textContent=String(staff.filter(person=>person.active!==false).length);
  }
  function renderIdentity(){
    const settings=state.workspaceSettings||{},name=settings.companyName||'CleanRooms';
    q('.cs-workspace-name').textContent=name;
    q('.cs-employee-brand>div>span').textContent=name;
  }
  function applyDirectory(value){
    if(!value?.ok||!directory?.ready||realEmployee())return;
    const catalog=directory.catalog;
    state.roster=catalog.roster.map(person=>({...((employeeDirectoryRecord?.id===person.id&&employeeDirectoryRecord.version===directory.version('employee',person.id))?employeeDirectoryRecord.value:person),_directoryVersion:directory.version('employee',person.id)}));
    state.organization={...catalog.organization,sites:catalog.organization.sites.map(site=>({...site,_directoryVersion:directory.version('site',site.id)})),departments:catalog.organization.departments.map(department=>({...department,_directoryVersion:directory.version('department',department.id)}))};
    syncOrganization();syncRoster();staffingContextCache=null;staffingAssessments.clear();
    if(persistence?.directoryRevision!==null&&directory.revision!==persistence?.directoryRevision)persistence?.invalidateCoverage?.();
    if(cloudLoaded&&!directoryBusy&&!planningReadBusy)render();
  }
  function ingestDirectory(result){
    if(!directory||!result?.directory)return;
    const accepted=directory.reconcile({directory:result.directory,studio:result.studio,workspace:result.workspace,capabilities:result.capabilities||cloudCapabilities});
    if(!accepted.ok)throw new Error(accepted.message);
  }
  async function saveRoster(next,metadata){
    if(!canEditWorkspace())return {ok:false,error:'Din rolle skal have adgang til både planlægning og brugeradministration.'};
    const errors=Roster.validate(next,{sites});if(errors.length)return {ok:false,error:typeof errors[0]==='string'?errors[0]:errors[0].message};
    if(directory?.ready){
      const before={roster:state.roster,organization:state.organization},versions={...directory.versions};
      for(const person of next)if(Number.isSafeInteger(person._directoryVersion))versions[globalThis.CleanRoomsDirectoryRecords.key('employee',person.id)]=person._directoryVersion;
      if(metadata?.before?.id&&Number.isSafeInteger(metadata.before._directoryVersion))versions[globalThis.CleanRoomsDirectoryRecords.key('employee',metadata.before.id)]=metadata.before._directoryVersion;
      if(metadata?.kind==='create'&&metadata.person?.id)versions[globalThis.CleanRoomsDirectoryRecords.key('employee',metadata.person.id)]=0;
      const changes=globalThis.CleanRoomsDirectoryRecords.commands(before,{...before,roster:next},versions).filter(item=>item.kind==='employee');
      directoryBusy=true;let result;try{result=await directory.commit(changes);}finally{directoryBusy=false;}
      if(!result.ok)return {ok:false,error:result.message||'Medarbejderen kunne ikke gemmes. Åbn redigeringen igen.'};
      const detail=result.records?.find(row=>row.kind==='employee'&&row.id===employeeProfileId);if(detail)employeeDirectoryRecord=detail;applyDirectory({ok:true});render();
      notify(metadata?.kind==='import'?'Medarbejderne er importeret. Eksisterende vagter er bevaret.':'Medarbejderoversigten er gemt.');
      return {ok:true,staff:clone(state.roster),person:state.roster.find(person=>person.id===(metadata?.person?.id||employeeProfileId))};
    }
    const previous=state.roster;state.roster=clone(next);syncRoster();
    const ok=await save();if(!ok){state.roster=previous;syncRoster();persistence?.discardPending?.();return {ok:false,error:'Ændringen kunne ikke gemmes. Hent den seneste version, og prøv igen.'};}
    if(state.page==='people')renderRoster();
    notify(metadata?.kind==='import'?'Medarbejderne er importeret. Eksisterende vagter er bevaret.':'Medarbejderoversigten er gemt.');return {ok:true};
  }
  function renderRoster(){
    if(employeeProfileId&&staff.some(person=>person.id===employeeProfileId)){renderEmployeeProfile();return;}
    employeeProfileId=null;
    if(!rosterView){rosterElement=node('div','cs-secondary-page');rosterView=globalThis.CleanRoomsRosterView?.mount({element:rosterElement,onSave:saveRoster,onImport:saveRoster,sites,onOpenPerson:person=>openEmployeeProfile(person.id),onShowPlan:(person,shift)=>navigateTo(shift?.date||today,person.id)});}
    if(!rosterElement?.isConnected)q('#cs-page-content').replaceChildren(rosterElement);
    const {planning,planningError}=rosterPlanningModel();
    rosterView?.render({staff,sites,canEdit:canEditWorkspace(),planning,planningError});
  }
  function rosterPlanningModel(){
    const horizonEnd=addDays(today,27),nowTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
    let planning=null,planningError='';
    if(persistence?.isPartial&&!planningRangeLoaded(anchor,addDays(today,27)))return {planning,planningError};
    try{planning=RosterPlanning?.build({staff,weekStart:anchor,today,nowTime,horizonEnd,weeklyShifts:conflictShiftsForWeeks([anchor]),upcomingShifts:conflictShiftsInRange(addDays(today,-1),horizonEnd)})||null;}
    catch{planningError='Ugens plan kunne ikke beregnes. Medarbejderoplysningerne er stadig tilgængelige.';}
    return {planning,planningError};
  }
  function canManageProfileAppLogin(personId){
    return Boolean(personId)&&cloudLoaded&&state.role==='admin'&&state.page==='people'&&employeeProfileId===personId&&staffById.has(personId)&&cloudCapabilities.manageAppLogins===true;
  }
  function clearProfileAppLogin(){
    profileAppLoginEpoch++;profileAppLogin=null;employeeProfileView?.clearAppLoginCode?.();
  }
  async function loadProfileAppLogin(personId){
    if(!canManageProfileAppLogin(personId))return;
    const epoch=++profileAppLoginEpoch;
    profileAppLogin={status:'loading'};renderEmployeeProfile();
    const result=await accountAction('readAppLogin',{personId});
    if(epoch!==profileAppLoginEpoch||!canManageProfileAppLogin(personId))return;
    profileAppLogin=result.ok?(result.account?{status:'ready',account:result.account}:{status:'missing',email:result.suggestedEmail}):{status:'error',error:result.message};
    renderEmployeeProfile();
  }
  async function revealProfileAppLogin(personId,version){
    if(!canManageProfileAppLogin(personId))return {ok:false};
    const epoch=profileAppLoginEpoch,result=await accountAction('revealAppStartCode',{personId,version});
    if(epoch!==profileAppLoginEpoch||!canManageProfileAppLogin(personId))return {ok:false};
    if(result.status===409&&result.error==='mobile_account_conflict')await loadProfileAppLogin(personId);
    return result;
  }
  async function changeProfileAppLogin(action,{personId,email,version}){
    if(!canManageProfileAppLogin(personId)||!['createAppLogin','resetAppLogin','revokeAppLogin'].includes(action))return {ok:false};
    const current=profileAppLogin?.account,creating=action==='createAppLogin',revoking=action==='revokeAppLogin';
    if(!creating&&(!current||current.version!==version))return {ok:false,message:'App-adgangen er ændret. Opdater oplysningerne, og prøv igen.'};
    const epoch=profileAppLoginEpoch;
    const result=await accountAction(action,{personId,...(creating?{email}:{version})});
    if(epoch!==profileAppLoginEpoch||!canManageProfileAppLogin(personId))return {ok:false};
    if(!result.ok){
      if(result.status===409)await loadProfileAppLogin(personId);
      return {ok:false,message:result.message};
    }
    const account=revoking?{...current,status:'revoked',version:result.version,temporary:false,canRevealStartCode:false}:result.account;
    profileAppLogin={status:'ready',account};
    renderEmployeeProfile();
    return {ok:true,account};
  }
  async function openEmployeeProfile(personId,{returnToPayroll=null,information=false}={}){
    if(realEmployee()||!staff.some(person=>person.id===personId))return false;
    if(directory?.ready){const epoch=++directoryProfileEpoch,result=await directory.get('employee',personId,{force:true});if(epoch!==directoryProfileEpoch)return false;if(!result.ok){notify(result.message||'Medarbejderen kunne ikke indlæses.');return false;}employeeDirectoryRecord=result.record;const index=state.roster.findIndex(person=>person.id===personId);if(index<0)return false;state.roster[index]={...result.record.value,_directoryVersion:result.record.version};syncRoster();}
    clearPayroll();clearPayrollPolicy();clearProfileAppLogin();employeeProfileView?.reset?.();
    payrollProblemReturn=null;payrollProfileReturn=returnToPayroll&&canViewPayroll()?clone(returnToPayroll):null;payrollPolicyPendingOpen=null;
    employeeProfileId=personId;profileInformationPending=information?personId:null;employeeProfileMonth=payrollProfileReturn?.date?.slice(0,7)||today.slice(0,7);state.page='people';render();
    const profilePage=employeeProfileElement?.querySelector('.cs-employee-profile-page');if(profilePage)profilePage.scrollTop=0;
    employeeProfileElement?.querySelector('h2')?.focus({preventScroll:true});return true;
  }
  function closeEmployeeProfile(){
    directoryProfileEpoch++;employeeDirectoryRecord=null;const previous=employeeProfileId,returnToProblem=canViewPayroll()?payrollProblemReturn:null,returnToPayroll=canViewPayroll()?payrollProfileReturn:null;clearPayroll();clearProfileAppLogin();employeeProfileId=null;profileInformationPending=null;payrollProfileReturn=null;payrollProblemReturn=null;
    if(returnToProblem){void navigatePayrollProblem({...returnToProblem,kind:'hours',problem:'missing_payroll'});return;}
    if(returnToPayroll){payrollPolicyPendingOpen=returnToPayroll;state.page='payroll';render();save();return;}
    render();
    [...(rosterElement?.querySelectorAll('.cs-roster-name-button')||[])].find(button=>button.dataset.personId===previous)?.focus({preventScroll:true});
  }
  async function saveEmployeeProfile(draft,before){
    if(!canEditWorkspace())return {ok:false,error:'Din rolle skal have adgang til både planlægning og brugeradministration.'};
    const current=staff.find(person=>person.id===employeeProfileId);
    if(!current||draft?.id!==current.id||before?.id!==current.id)return {ok:false,error:'Medarbejderen findes ikke længere. Åbn medarbejderlisten igen.'};
    if(JSON.stringify(current)!==JSON.stringify(before))return {ok:false,error:'Medarbejderen er ændret siden du åbnede formularen. Annullér og åbn redigeringen igen.'};
    const result=Roster.propose(staff,{...draft,create:false},{sites});
    if(!result.ok)return {ok:false,error:result.error};
    const activeChanged=current.active!==result.person.active;
    const saved=await saveRoster(result.staff,{kind:activeChanged?(result.person.active?'restore':'archive'):'update',person:result.person,before:current});
    if(saved.ok&&activeChanged&&profileAppLogin)await loadProfileAppLogin(current.id);
    return saved;
  }
  function renderEmployeeProfile(){
    const person=staff.find(item=>item.id===employeeProfileId);if(!person){employeeProfileId=null;renderRoster();return;}
    if(!employeeProfileView){
      employeeProfileElement=node('div','cs-secondary-page');employeeProfileElement.id='cs-employee-profile-page';
      employeeProfileView=globalThis.CleanRoomsEmployeeProfileView?.mount({element:employeeProfileElement,onBack:closeEmployeeProfile,onSave:saveEmployeeProfile,onHelp:trigger=>openPageHelp(trigger),
        onMonthChange:month=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;employeeProfileMonth=month;payrollMonth=month;render();},
        onTabChange:tab=>{
          renderPageHelp();
          if(tab==='information'){if(!profileAppLogin)loadProfileAppLogin(employeeProfileId);return;}
          if(profileAppLogin)clearProfileAppLogin();
          if(tab==='pay')loadPayroll();
        },
        onLoadAppLogin:loadProfileAppLogin,onRevealAppLogin:revealProfileAppLogin,onChangeAppLogin:changeProfileAppLogin,
        onShowPlan:(person,shift)=>navigateTo(shift?.date||today,person.id),
        onOpenShift:(shift,trigger)=>{const current=shiftById(shift?.id);if(!current||current.person!==employeeProfileId){notify('Vagten er ændret. Kalenderen er opdateret.');renderEmployeeProfile();return;}if(!cloudLoaded||!cloudCapabilities.plan||cloudStatus.conflict){notify('Vagten kan ikke redigeres lige nu.');return;}openEditor(current,trigger);}
      });
    }
    if(!employeeProfileElement?.isConnected)q('#cs-page-content').replaceChildren(employeeProfileElement);
    let calendar=null,error='';const {planning,planningError}=rosterPlanningModel();
    try{const range=EmployeeCalendar.range('month',employeeProfileMonth+'-01');calendar=ProfileCalendar.build({person,month:employeeProfileMonth,today,shifts:conflictShiftsInRange(addDays(range.from,-1),range.to),sites});}
    catch{error='Månedens vagter kunne ikke indlæses. Medarbejderens oplysninger er stadig tilgængelige.';}
    const payElement=payrollPane(person);
    const appLogin=canManageProfileAppLogin(person.id)?profileAppLogin||{status:'loading'}:null;
    employeeProfileView?.render({person,sites,canEdit:canEditWorkspace(),canViewPayroll:canViewPayroll(),payrollElement:payElement,backLabel:canViewPayroll()&&payrollProblemReturn?'Tilbage til registreringen':canViewPayroll()&&payrollProfileReturn?'Tilbage til løngruppen':null,backAriaLabel:canViewPayroll()&&payrollProblemReturn?'Tilbage til registreringen i lønperioden':canViewPayroll()&&payrollProfileReturn?'Tilbage til '+payrollProfileReturn.name:null,planning,month:employeeProfileMonth,calendar,error:error||planningError,today,appLogin});
    if(profileInformationPending===person.id){profileInformationPending=null;employeeProfileView?.showInformation?.();}
    renderPayroll();
  }
  function canViewPayroll(){return cloudLoaded&&cloudCapabilities.plan===true&&cloudCapabilities.viewPayroll===true&&!realEmployee();}
  function canManagePayroll(){return canViewPayroll()&&cloudCapabilities.managePayroll===true;}
  function canManagePayrollGroups(){return canManagePayroll()&&cloudCapabilities.managePayrollGroups===true;}
  function clearPayroll(){
    payrollEpoch++;payrollView?.destroy?.();payrollPersonGroupView?.destroy?.();payrollPersonGroupView=null;payrollPersonGroupElement=null;payrollView=null;payrollElement=null;
    Object.assign(payrollState,{personId:null,payroll:null,version:0,policy:null,policyVersion:0,loaded:false,loading:false,error:'',updatedAt:null});
  }
  function payrollPane(person){
    if(!canViewPayroll()){if(payrollState.personId)clearPayroll();return null;}
    if(payrollState.personId!==person.id){clearPayroll();payrollState.personId=person.id;payrollMonth=employeeProfileMonth;}
    if(!payrollView){
      const personId=person.id;payrollElement=node('div');payrollElement.id='cs-payroll-pane';
      payrollPersonGroupElement=node('div');
      payrollPersonGroupView=globalThis.CleanRoomsPayrollPersonGroupView?.mount({element:payrollPersonGroupElement,onSave:savePayrollPersonPolicy,onReload:reloadPayroll,onEditingChange:active=>payrollView?.setInheritanceEditing?.(active),onChangeGroup:personId=>{if(!canManagePayrollGroups())return;payrollPolicyPendingOpen={assignment:true,personId};payrollProfileReturn=null;employeeProfileId=null;state.page='payroll';render();save();},onOpenGroups:cloudCapabilities.companyPayroll===false?undefined:(_personId,context={})=>{if(cloudCapabilities.companyPayroll===false)return;const selectedDate=Actions.validDate(context.date)?context.date:payrollMonth+'-01'>today?payrollMonth+'-01':today,groupId=PayrollGroups.linkFor(payrollState.policy,personId,selectedDate)?.groupId;payrollPolicyPendingOpen=groupId?{groupId,date:selectedDate,detail:'members'}:null;payrollProfileReturn=null;employeeProfileId=null;state.page='payroll';render();save();}});
      payrollView=globalThis.CleanRoomsPayrollView?.mount({element:payrollElement,
        onSave:(config,version,policyVersion)=>savePayroll(config,version,personId,policyVersion),
        onReload:reloadPayroll,
        onMonthChange:month=>{if(payrollState.personId!==personId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;payrollMonth=month;renderPayroll();}
      });
    }
    return payrollElement;
  }
  function renderPayroll(){
    if(!payrollView)return;
    const allowed=canViewPayroll()&&payrollState.personId===employeeProfileId,person=allowed?staff.find(item=>item.id===employeeProfileId):null;
    let estimate=null,resolved=null,error=payrollState.error;
    if(allowed&&payrollState.loaded){
      try{
        const range=EmployeeCalendar.range('month',payrollMonth+'-01');
        resolved=PayrollGroups.resolve({policy:payrollState.policy,personId:person.id,payroll:payrollState.payroll,from:range.periodFrom,to:range.periodTo});
        if(payrollState.payroll||resolved.periods.some(period=>period.group)){
          estimate=Payroll.estimate({config:resolved.payroll,personId:person.id,month:payrollMonth,shifts:conflictShiftsInRange(addDays(range.periodFrom,-1),range.periodTo)});
          if(resolved.missingBasePeriods.length){estimate.complete=false;estimate.missingBasePeriods=resolved.missingBasePeriods;}
        }
      }catch{error='Den planlagte løn kunne ikke beregnes. Lønaftalen er stadig gemt.';}
    }
    const linked=allowed&&payrollState.loaded&&payrollState.policy?.links.some(link=>link.personId===person.id);
    payrollPersonGroupView?.render({person,policy:allowed&&payrollState.loaded?payrollState.policy:null,policyVersion:allowed?payrollState.policyVersion:0,payroll:allowed&&payrollState.loaded?payrollState.payroll:null,version:allowed?payrollState.version:0,canManage:allowed&&canManagePayroll()&&payrollState.loaded,canManageGroups:allowed&&canManagePayrollGroups()&&payrollState.loaded,today,contextDate:payrollProblemReturn?.date?.slice(0,7)===payrollMonth?payrollProblemReturn.date:payrollProfileReturn?.date?.slice(0,7)===payrollMonth?payrollProfileReturn.date:payrollMonth+'-01'>today?payrollMonth+'-01':today});
    payrollView.render({person,month:payrollMonth,payroll:allowed&&payrollState.loaded?payrollState.payroll:null,version:allowed?payrollState.version:0,policyVersion:allowed?payrollState.policyVersion:0,loading:allowed&&payrollState.loading,error,canView:allowed,canManage:allowed&&canManagePayroll()&&payrollState.loaded,estimate,linked:!!linked,inheritanceElement:allowed&&payrollState.loaded?payrollPersonGroupElement:null,updatedAt:allowed?payrollState.updatedAt:null});
  }
  function personalPayrollRecord(result,personId){
    const configured=result.payroll!==null&&typeof result.payroll==='object'&&!Array.isArray(result.payroll);
    if(result.personId!==personId||!Number.isSafeInteger(result.version)||result.version<0||!(result.version===0&&result.payroll===null||result.version>0&&configured)||!Number.isSafeInteger(result.policyVersion)||result.policyVersion<0||!result.policy||typeof result.policy!=='object')throw Error('Invalid payroll response');
    return {payroll:result.payroll===null?null:Payroll.normalize(result.payroll),version:result.version,policy:PayrollGroups.normalize(result.policy),policyVersion:result.policyVersion,loaded:true,updatedAt:result.updatedAt||null,error:''};
  }
  async function loadPayroll(force=false){
    if(!canViewPayroll()||!employeeProfileId||payrollState.personId!==employeeProfileId)return;
    if(!force&&(payrollState.loading||payrollState.loaded))return;
    const personId=employeeProfileId,token=++payrollEpoch;
    Object.assign(payrollState,{payroll:null,version:0,policy:null,policyVersion:0,loaded:false,loading:true,error:'',updatedAt:null});renderPayroll();
    const result=await accountAction('payrollRead',{personId});
    if(token!==payrollEpoch||payrollState.personId!==personId||employeeProfileId!==personId||!canViewPayroll())return;
    payrollState.loading=false;
    if(!result.ok){payrollState.error=result.message||result.error||'Lønoplysningerne kunne ikke indlæses.';renderPayroll();return;}
    try{
      Object.assign(payrollState,personalPayrollRecord(result,personId));
    }catch{payrollState.error='Lønoplysningerne kunne ikke bekræftes. Hent dem igen.';}
    renderPayroll();
  }
  async function reloadPayroll(){
    const personId=employeeProfileId;
    if(!personId||!canViewPayroll())return;
    await initializeCloud();
    if(!cloudLoaded||!canViewPayroll()||employeeProfileId!==personId||!staff.some(person=>person.id===personId))return;
    state.page='people';renderEmployeeProfile();employeeProfileView?.showPayroll?.();await loadPayroll();
  }
  async function savePayroll(config,version,personId,policyVersion){
    if(!canManagePayroll()||!payrollState.loaded||payrollState.loading||employeeProfileId!==personId||payrollState.personId!==personId)return {ok:false,error:'Du har ikke adgang til at ændre denne medarbejders løn.'};
    if(version!==payrollState.version||policyVersion!==payrollState.policyVersion)return {ok:false,status:409,conflict:true,error:'Lønaftalen eller løngruppen er ændret. Hent den seneste version, før du gemmer.'};
    let normalized;try{normalized=Payroll.normalize(config);}catch(error){return {ok:false,error:error.message};}
    const token=payrollEpoch,result=await accountAction('payrollSave',{personId,version,payroll:normalized,policyVersion});
    if(token!==payrollEpoch||payrollState.personId!==personId||employeeProfileId!==personId||!canViewPayroll())return {ok:false,error:'Medarbejdervisningen er ændret. Åbn medarbejderen igen.'};
    if(!result.ok)return {ok:false,status:result.status,conflict:result.status===409,error:result.message||result.error||'Lønaftalen kunne ikke gemmes.'};
    try{
      const next=personalPayrollRecord(result,personId);
      if(next.version!==version+1||next.policyVersion<policyVersion||next.policyVersion>policyVersion+1)throw Error('Invalid payroll receipt');
      Object.assign(payrollState,next);renderPayroll();
      return {ok:true,payroll:clone(payrollState.payroll),version:payrollState.version,policyVersion:payrollState.policyVersion,updatedAt:payrollState.updatedAt};
    }catch{return {ok:false,conflict:true,error:'Gemningen kunne ikke bekræftes. Hent lønaftalen igen.'};}
  }
  async function savePayrollPersonPolicy({personId,version,policyVersion,link}){
    if(!canManagePayroll()||!payrollState.loaded||payrollState.loading||personId!==employeeProfileId||personId!==payrollState.personId)return {ok:false,error:'Du har ikke adgang til at ændre denne medarbejders aftale.'};
    if(version!==payrollState.version||policyVersion!==payrollState.policyVersion)return {ok:false,status:409,conflict:true,error:'Lønaftalen eller løngruppen er ændret. Hent den seneste version.'};
    const token=payrollEpoch,result=await accountAction('payrollPersonPolicySave',{personId,version,policyVersion,link});
    if(token!==payrollEpoch||personId!==employeeProfileId||personId!==payrollState.personId||!canViewPayroll())return {ok:false,error:'Medarbejdervisningen er ændret. Åbn medarbejderen igen.'};
    if(!result.ok)return {ok:false,status:result.status,conflict:result.status===409,error:result.message||'Den personlige aftale kunne ikke gemmes.'};
    try{
      const next=personalPayrollRecord(result,personId);
      if(next.version!==version||!(next.policyVersion===policyVersion+1||next.policyVersion===policyVersion&&JSON.stringify(next.policy)===JSON.stringify(payrollState.policy)))throw Error('Invalid policy receipt');
      Object.assign(payrollState,next);renderPayroll();return {ok:true,...next};
    }catch{return {ok:false,conflict:true,error:'Gemningen kunne ikke bekræftes. Hent oplysningerne igen.'};}
  }
  function clearPayrollPolicy(){
    payrollPolicyEpoch++;payrollPolicyView?.destroy?.();payrollPolicyView=null;payrollPolicyElement=null;
    Object.assign(payrollPolicyState,{policy:null,version:0,people:[],history:[],loaded:false,loading:false,error:''});
  }
  function policyRecord(result){
    if(!Number.isSafeInteger(result.version)||result.version<0||!result.policy||!Array.isArray(result.people)||!Array.isArray(result.history))throw Error('Invalid policy response');
    const people=result.people.map(person=>{
      if(typeof person.personId!=='string'||typeof person.name!=='string'||!Number.isSafeInteger(person.version)||person.version<0||!(person.version===0&&person.payroll===null||person.version>0&&person.payroll&&typeof person.payroll==='object'&&!Array.isArray(person.payroll)))throw Error('Invalid payroll person');
      return {...person,payroll:person.payroll===null?null:Payroll.normalize(person.payroll)};
    });
    if(new Set(people.map(person=>person.personId)).size!==people.length)throw Error('Duplicate payroll person');
    return {policy:PayrollGroups.normalize(result.policy),version:result.version,people,history:clone(result.history),loaded:true,loading:false,error:''};
  }
  function renderPayrollPolicyView(){
    payrollPolicyView?.render({...payrollPolicyState,canView:canViewPayroll(),canManage:canManagePayrollGroups()&&payrollPolicyState.loaded,today});
    if(payrollPolicyPendingOpen&&payrollPolicyState.loaded&&canViewPayroll()){
      const destination=payrollPolicyPendingOpen;payrollPolicyPendingOpen=null;
      if(destination.assignment){payrollPolicyView?.openAssignment?.(destination.personId);return;}
      if(payrollPolicyState.policy.groups.some(group=>group.id===destination.groupId))payrollPolicyView?.openGroup?.(destination.groupId,destination);
      else notify('Løngruppen findes ikke længere. Oversigten er opdateret.');
    }
  }
  function renderPayrollPolicyPage(){
    if(!canViewPayroll()){clearPayrollPolicy();payrollPolicyPendingOpen=null;payrollProfileReturn=null;state.page='schedule';render();return;}
    if(!payrollPolicyView){
      payrollPolicyElement=node('div','cs-secondary-page');payrollPolicyElement.id='cs-payroll-admin-page';
      payrollPolicyView=globalThis.CleanRoomsPayrollGroupsView?.mount({element:payrollPolicyElement,onPreview:previewPayrollPolicy,onSave:savePayrollPolicy,onReload:initializeCloud,onHelp:trigger=>openPageHelp(trigger),
        onOpenPerson:async(personId,context={})=>{
          const group=payrollPolicyState.policy?.groups.find(item=>item.id===context.groupId),date=Actions.validDate(context.date)?context.date:today;
          const destination=group?{groupId:group.id,name:group.name,date,detail:['members','setup','history'].includes(context.detail)?context.detail:'members',memberFilter:context.memberFilter,memberSearch:context.memberSearch,memberPage:Number.isSafeInteger(context.memberPage)&&context.memberPage>=0?context.memberPage:undefined,memberPageSize:[25,50,100].includes(context.memberPageSize)?context.memberPageSize:undefined}:null;
          if(!staff.some(person=>person.id===personId))await initializeCloud();
          if(!canViewPayroll()||!await openEmployeeProfile(personId,{returnToPayroll:destination}))return;
          if(planningReadBusy)await planningReadPromise;
          if(!canViewPayroll()||planningReadBlocked||state.page!=='people'||employeeProfileId!==personId)return;
          renderEmployeeProfile();
          employeeProfileView?.showPayroll?.();await loadPayroll();
        }
      });
    }
    if(!payrollPolicyElement?.isConnected)q('#cs-page-content').replaceChildren(payrollPolicyElement);
    renderPayrollPolicyView();if(!payrollPolicyState.loaded&&!payrollPolicyState.loading&&!payrollPolicyState.error)loadPayrollPolicy();
  }
  async function loadPayrollPolicy(){
    if(!canViewPayroll()||state.page!=='payroll')return;
    const token=++payrollPolicyEpoch;Object.assign(payrollPolicyState,{loading:true,error:''});renderPayrollPolicyView();
    const result=await accountAction('payrollPolicyRead',{});
    if(token!==payrollPolicyEpoch||state.page!=='payroll'||!canViewPayroll())return;
    try{if(!result.ok)throw Error(result.message||'Løngrupperne kunne ikke indlæses.');Object.assign(payrollPolicyState,policyRecord(result));}
    catch(error){Object.assign(payrollPolicyState,{loading:false,loaded:false,error:error.message||'Løngrupperne kunne ikke bekræftes.'});}
    renderPayrollPolicyView();
  }
  async function previewPayrollPolicy({version,policy,date:effectiveDate}){
    if(!canManagePayrollGroups()||!payrollPolicyState.loaded)return {ok:false,error:'Du har ikke adgang til at ændre løngrupper.'};
    if(version!==payrollPolicyState.version)return {ok:false,conflict:true,error:'Løngrupperne er ændret. Hent den seneste version.'};
    let normalized;try{normalized=PayrollGroups.normalize(policy);}catch(error){return {ok:false,error:error.message};}
    const token=payrollPolicyEpoch,result=await accountAction('payrollPolicyPreview',{version,policy:normalized,date:effectiveDate});
    if(token!==payrollPolicyEpoch||state.page!=='payroll'||!canManagePayrollGroups())return {ok:false,error:'Visningen er ændret. Åbn løngrupperne igen.'};
    if(!result.ok)return {ok:false,status:result.status,conflict:result.status===409,error:result.message||'Forhåndsvisningen kunne ikke beregnes.'};
    if(typeof result.previewToken!=='string'||!result.previewToken||!result.preview||!Array.isArray(result.preview.rows))return {ok:false,error:'Forhåndsvisningen kunne ikke bekræftes.'};
    return {ok:true,preview:result.preview,previewToken:result.previewToken};
  }
  async function savePayrollPolicy({version,policy,date:effectiveDate,previewToken}){
    if(!canManagePayrollGroups()||!payrollPolicyState.loaded)return {ok:false,error:'Du har ikke adgang til at ændre løngrupper.'};
    if(version!==payrollPolicyState.version)return {ok:false,conflict:true,error:'Løngrupperne er ændret. Hent den seneste version.'};
    let normalized;try{normalized=PayrollGroups.normalize(policy);}catch(error){return {ok:false,error:error.message};}
    const token=payrollPolicyEpoch,result=await accountAction('payrollPolicySave',{version,policy:normalized,date:effectiveDate,previewToken});
    if(token!==payrollPolicyEpoch||state.page!=='payroll'||!canViewPayroll())return {ok:false,error:'Visningen er ændret. Hent løngrupperne igen.'};
    if(!result.ok)return {ok:false,status:result.status,conflict:result.status===409,error:result.message||'Løngrupperne kunne ikke gemmes.'};
    try{const next=policyRecord(result);if(!(next.version===version+1||next.version===version&&JSON.stringify(next.policy)===JSON.stringify(payrollPolicyState.policy)))throw Error('Invalid policy receipt');Object.assign(payrollPolicyState,next);renderPayrollPolicyView();return {ok:true,...next};}
    catch{return {ok:false,conflict:true,error:'Gemningen kunne ikke bekræftes. Hent løngrupperne igen.'};}
  }
  function renderWorkspace(){
    if(!guideElement?.isConnected){
      guideView?.destroy?.();guideElement=node('div','cs-secondary-page');q('#cs-page-content').replaceChildren(guideElement);
      guideView=globalThis.CleanRoomsWorkspaceGuide?.mount({element:guideElement,onNavigate:showDemoPage,onSave:async draft=>{
        if(!canEditWorkspace())return {ok:false,error:'Du har ikke adgang til at ændre indstillinger.'};
        const before=state.workspaceSettings;state.workspaceSettings=clone(draft);const ok=await save();
        if(!ok){state.workspaceSettings=before;persistence?.discardPending?.();return {ok:false,error:'Oplysningerne kunne ikke gemmes.'};}
        renderIdentity();return {ok:true,settings:state.workspaceSettings};
      },onDemoChange:async({enabled})=>{
        if(!canEditWorkspace())return {ok:false,error:'Du har ikke adgang til at ændre indstillinger.'};
        const previous=state.demoSeed;state.demoSeed=enabled===true;const ok=await save();
        if(!ok){if(previous===undefined)delete state.demoSeed;else state.demoSeed=previous;persistence?.discardPending?.();return {ok:false,error:'Indstillingen kunne ikke gemmes.'};}
        renderIdentity();return {ok:true};
      },onLookupSiteAddress:payload=>accountAction('siteAddressLookup',payload),onSaveSiteGps:saveSiteGps,onReadSiteInfo:readSiteInfo,onSaveSiteInfo:saveSiteInfo,onSaveBudget:saveWorkspaceBudget});
    }
    const departments=state.organization?.departments||[];
    const budgetVersions=Object.fromEntries([['site',sites],['department',departments]].map(([kind,items])=>[kind,Object.fromEntries(items.map(item=>[item.id,directory?.version(kind,item.id)||0]))]));
    guideView?.render({settings:state.workspaceSettings,canEdit:canEditWorkspace(),canEditScopedBudget:canEditWorkspace()&&canManageDepartments(),budgetsReady:directory?.ready===true&&!cloudStatus.conflict,budgetVersions,departments,canManageSiteInfo:canManageDepartments(),siteInfoReady:directory?.ready===true&&!cloudStatus.conflict,canManageSiteGps:canManageSiteGps(),gpsReady:directory?.ready===true&&!cloudStatus.conflict,sites,stats:{staffCount:staff.filter(person=>person.active!==false).length,siteCount:sites.length,demoEnabled:state.demoSeed!==false}});
  }
  async function saveWorkspaceBudget({kind,id,expectedVersion,workHoursBudget,before}) {
    if(!canEditWorkspace())return {ok:false,error:'Du har ikke adgang til at ændre timebudgetter.'};
    if(workHoursBudget!==null&&!Roster.validWorkHoursBudget(workHoursBudget))return {ok:false,error:'Skriv et gyldigt timebudget med højst to decimaler.'};
    if(kind==='company'){
      const current=state.workspaceSettings?.workHoursBudget;
      if(current?.period!==before?.period||current?.hours!==before?.hours)return {ok:false,status:409,error:'Virksomhedens budget er ændret. Hent de gemte værdier, før du gemmer.'};
      const previous=state.workspaceSettings;
      state.workspaceSettings={...previous,workHoursBudget:clone(workHoursBudget)};
      const ok=await save();
      if(!ok){state.workspaceSettings=previous;persistence?.discardPending?.();return {ok:false,error:'Timebudgettet kunne ikke gemmes.'};}
      if(state.page==='workspace'&&state.role!=='employee')renderWorkspace();return {ok:true};
    }
    if(!['department','site'].includes(kind)||!canManageDepartments()||!directory?.ready||cloudStatus.conflict)return {ok:false,error:'Redigering af områdets budget kræver også adgang til at administrere afdelinger.'};
    const result=await directory.commit([{kind,id,expectedVersion,patch:{workHoursBudget}}]);
    if(!result.ok&&result.status===409){await directory.get(kind,id,{force:true});if(state.page==='workspace'&&state.role!=='employee')renderWorkspace();return {ok:false,status:409,error:'Området er ændret. Hent de gemte værdier, før du gemmer.'};}
    if(!result.ok)return {ok:false,error:result.message||'Timebudgettet kunne ikke gemmes.'};
    if(state.demoSession)state.demoSession.backup.organization=clone(state.organization);
    if(state.page==='workspace'&&state.role!=='employee')renderWorkspace();return {ok:true};
  }
  async function readSiteInfo({id,force=false}){
    if(!canManageDepartments()||cloudStatus.conflict||!directory?.ready)return {ok:false,error:'Arbejdsstedets oplysninger kan ikke hentes lige nu.'};
    const workspace=chatWorkspaceId,viewer=sessionViewer?.userId,result=await directory.get('site',id,{force});
    if(workspace!==chatWorkspaceId||viewer!==sessionViewer?.userId||!canManageDepartments())return {ok:false,error:'Adgangen er ændret. Åbn indstillingerne igen.'};
    if(!result.ok)return {ok:false,status:result.status,error:result.message||'Arbejdsstedets oplysninger kunne ikke hentes.'};
    return {ok:true,site:{...result.record.value,_directoryVersion:result.record.version}};
  }
  async function saveSiteInfo({id,expectedVersion,worksiteInfo}){
    if(!canManageDepartments()||cloudStatus.conflict||!directory?.ready)return {ok:false,error:'Arbejdsstedets oplysninger kan ikke gemmes lige nu.'};
    if(!sites.some(site=>site.id===id)||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)return {ok:false,error:'Arbejdsstedet findes ikke længere.'};
    const workspace=chatWorkspaceId,viewer=sessionViewer?.userId,result=await directory.commit([{kind:'site',id,expectedVersion,patch:{worksiteInfo}}]);
    if(workspace!==chatWorkspaceId||viewer!==sessionViewer?.userId||!canManageDepartments())return {ok:false,error:'Adgangen er ændret. Åbn indstillingerne igen.'};
    if(!result.ok)return {ok:false,status:result.status,error:result.status===409?'Arbejdsstedet er ændret. Hent de gemte oplysninger, før du gemmer.':result.message||'Arbejdsstedets oplysninger kunne ikke gemmes.'};
    const record=result.records?.find(row=>row.kind==='site'&&row.id===id);
    if(!record?.value)return {ok:false,error:'Gemningen kunne ikke bekræftes. Hent de gemte oplysninger igen.'};
    if(state.demoSession)state.demoSession.backup.organization=clone(state.organization);
    return {ok:true,site:{...record.value,_directoryVersion:record.version}};
  }
  async function saveSiteGps({id,expectedVersion,gps,address}){
    if(!canManageSiteGps()||cloudStatus.conflict||!directory?.ready)return {ok:false,error:'GPS-indstillinger kan ikke gemmes lige nu.'};
    const site=sites.find(item=>item.id===id);
    if(!site||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)return {ok:false,error:'Arbejdsstedet findes ikke længere.'};
    const errors=Departments.validateGps(gps);
    if(errors.length)return {ok:false,error:errors[0]};
    const result=await directory.commit([{kind:'site',id,expectedVersion,patch:{gps,...(address===undefined?{}:{address})}}]);
    if(!result.ok&&result.status===409){
      const latest=await directory.get('site',id,{force:true});
      return {ok:false,error:latest.ok?'Arbejdsstedet er ændret. Hent de gemte værdier, før du gemmer.':'Arbejdsstedet er ændret. Genindlæs siden for at hente de gemte værdier.',site:latest.ok?{...latest.record.value,_directoryVersion:latest.record.version}:null};
    }
    if(!result.ok)return {ok:false,error:result.message||'GPS-indstillingerne kunne ikke gemmes.'};
    if(state.demoSession)state.demoSession.backup.organization=clone(state.organization);
    return {ok:true,site:sites.find(item=>item.id===id)};
  }
  function changeDepartment(id) {
    if (id !== 'all' && !state.organization?.departments.some(item => item.id === id)) return false;
    closeDemoSheets(); state.departmentId = id; state.site = 'all'; state.pageIndex = 0;
    state.search = ''; state.onlyOpen = false; q('#cs-search').value = ''; q('#cs-site-filter').value = 'all';
    render(); save(); return true;
  }
  async function saveDepartment(draft) {
    if (!canManageDepartments() || cloudStatus.conflict || !Departments) return {ok:false,error:'Du har ikke adgang til at administrere afdelinger, eller planen skal genindlæses.'};
    const id = draft.id || 'dep-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    const proposal = {...draft,id,create:!draft.id}; if (!proposal.newSite) delete proposal.newSite;
    const result = Departments.propose(state.organization,proposal);
    if (!result.ok) return result;
    if(directory?.ready){
      const before={roster:state.roster,organization:state.organization},changes=globalThis.CleanRoomsDirectoryRecords.commands(before,{...before,organization:result.organization},directory.versions).filter(item=>item.kind!=='employee');
      for(const change of changes)if(change.kind==='department'&&change.id===id&&Number.isSafeInteger(draft.expectedVersion))change.expectedVersion=draft.expectedVersion;
      directoryBusy=true;let saved;try{saved=await directory.commit(changes);}finally{directoryBusy=false;}
      if(!saved.ok)return {ok:false,error:saved.message||'Afdelingen kunne ikke gemmes. Åbn formularen igen.'};
      applyDirectory({ok:true});state.departmentId=id;state.site='all';
      if(state.demoSession){state.demoSession.backup.organization=clone(state.organization);state.demoSession.backup.departmentId=id;}
      render();
      return {ok:true,organization:clone(state.organization),department:clone(state.organization.departments.find(item=>item.id===id))};
    }
    state.organization = result.organization; state.departmentId = result.department.id; state.site = 'all';
    if (state.demoSession) { state.demoSession.backup.organization = clone(state.organization); state.demoSession.backup.departmentId = state.departmentId; }
    syncOrganization(); render();
    const saved = await save();
    return saved ? result : {...result,ok:false,error:cloudStatus.message || 'Afdelingen er endnu ikke gemt. Prøv igen, eller brug Hent seneste version ved en konflikt.'};
  }
  function renderDepartments() {
    const slot = q('#cs-department-switcher'); slot.hidden = state.page !== 'schedule';
    departmentView?.render({organization:state.organization,selectedId:state.departmentId === 'all' ? null : state.departmentId,canManage:canManageDepartments(),scopeRestricted:cloudCapabilities.scopeRestricted===true});
    const available = sites.map((site,index) => ({site,index})).filter(({index}) => inDepartment(index));
    if (state.site !== 'all' && !available.some(({index}) => String(index) === state.site)) state.site = 'all';
    const filter = q('#cs-site-filter');
    const selectOnly = state.page === 'schedule' || state.page === 'series';
    const modeChanged = ('selectOnly' in filter.dataset) !== selectOnly;
    const previousControl = modeChanged ? globalThis.CleanRoomsCombobox?.get(filter) : null;
    const restoreFocus = previousControl && document.activeElement === previousControl.input;
    if (modeChanged) {
      previousControl?.dispose();
      if (selectOnly) filter.dataset.selectOnly = '';
      else delete filter.dataset.selectOnly;
    }
    filter.replaceChildren();
    const all = node('option',null,'Alle arbejdssteder'); all.value = 'all'; filter.append(all);
    available.forEach(({site,index}) => { const option = node('option',null,site.name); option.value = String(index); filter.append(option); }); filter.value = state.site;
    if (previousControl) {
      const control = globalThis.CleanRoomsCombobox.enhance(filter);
      if (restoreFocus) control?.input.focus({preventScroll:true});
    }
    for (const selector of ['#cs-edit-site','#cs-need-site']) {
      const select = q(selector), old = select.value; select.replaceChildren();
      sites.forEach((site,index) => { if(!allowedSite(index))return;const option = node('option',null,site.name); option.value = String(index); select.append(option); });
      select.value = /^\d+$/.test(old) && sites[Number(old)] ? old : String(defaultShiftSite() ?? 0);
    }
    const legend = q('#cs-legend'); legend.replaceChildren();
    available.forEach(({site}) => { const item = node('span','cs-legend-item'), dot = node('span','cs-site-dot'); dot.style.setProperty('--cs-shift-color',site.color); item.append(dot,document.createTextNode(site.name)); legend.append(item); });
  }

  function date(value) { return new Date(value + 'T12:00:00Z'); }
  function iso(value) { return value.toISOString().slice(0, 10); }
  function addDays(value, count) { const d = date(value); d.setUTCDate(d.getUTCDate() + count); return iso(d); }
  function dates() { return Array.from({length:7}, (_, i) => addDays(anchor, state.week * 7 + i)); }
  function selectedDate() { return dates()[state.day]; }
  function isCompact() { return compactViewport?.matches ?? globalThis.innerWidth <= 760; }
  function effectiveView() { return state.view === 'auto' ? 'week' : state.view; }
  function calendarWeeks() { return Math.max(1, Math.min(8, 53 - state.week)); }
  function calendarRange() { const first = dates()[0]; return [first, addDays(first, calendarWeeks() * 7 - 1)]; }
  function scrollCalendarTo(value) {
    plannerViewport.restore=false;
    const wrap = q('.cs-board-scroll'), first = q('.cs-board-day'), target = [...root.querySelectorAll('.cs-board-day')].find(day => day.dataset.date === value);
    if (wrap && first && target) { wrap.scrollLeft = 0; wrap.scrollTop = Math.max(0,target.offsetTop - first.offsetTop); }
  }
  function weekNumber(value) { const d = date(value); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); return Math.ceil((((d - new Date(Date.UTC(d.getUTCFullYear(),0,1,12))) / 86400000) + 1) / 7); }
  function weekPlan(index = state.week) {
    const key = String(index), first = addDays(anchor,index * 7);
    const plan = state.weekPlans[key] || (state.weekPlans[key] = {published:false,changes:0});
    if (!Array.isArray(plan.baseline)) {
      plan.baseline = clone(shiftsInRange(first,addDays(first,6)));
      plan.baselineKind = plan.published ? 'published' : plan.changes ? 'start' : 'initial';
    }
    if (!['published','initial','start'].includes(plan.baselineKind)) plan.baselineKind = plan.published ? 'published' : 'initial';
    return plan;
  }
  function changesForWeek(index = state.week) {
    const first = addDays(anchor,index * 7);
    const plan=weekPlan(index),published=Object.values(state.publications?.slots||{}).filter(slot=>slot.from===first),publishedSites=new Set(published.map(slot=>slot.site));
    const baseline=published.length?[...published.flatMap(slot=>slot.shifts),...plan.baseline.filter(shift=>!publishedSites.has(shift.site))]:plan.baseline;
    return Changes.diff(baseline,shiftsInRange(first,addDays(first,6)));
  }
  function publicationSiteChoices() {
    const allowed = allowedSiteIndices();
    const department = selectedDepartment();
    const departmentSites = department ? allowed.filter(site => department.siteIds.includes(site)) : allowed;
    const choices = new Map(allowed.map(site => [String(site), {label: sites[site].name, siteIds: [site]}]));
    let initial = 'all';
    if (department && departmentSites.length === 1) {
      initial = String(departmentSites[0]);
    } else if (department && departmentSites.length > 1 && departmentSites.length < allowed.length) {
      initial = 'department';
      choices.set(initial, {label: 'Alle arbejdssteder i ' + department.name, siteIds: departmentSites});
    } else if (!departmentSites.length) {
      initial = '';
    }
    choices.set('all', {label: 'Alle arbejdssteder', siteIds: allowed});
    if (state.site !== 'all') initial = choices.has(state.site) ? state.site : '';
    return {choices, initial};
  }
  function publicationScope(review = false) {
    const {choices, initial} = publicationSiteChoices();
    const siteIds = choices.get(review ? publicationSiteSelection ?? initial : initial)?.siteIds ?? [];
    const week = dates();
    const range = review && publicationRange ? publicationRange : {from: week[0], to: week[6]};
    return {...range, siteIds, includeDependencies: review && includeRelatedPublication};
  }
  function renderPublicationSiteSelect() {
    const {choices, initial} = publicationSiteChoices();
    const select = q('#cs-publication-scope-select');
    const requested = publicationSiteSelection ?? initial;
    const selection = choices.get(requested)?.siteIds.length ? requested : '';
    const options = [...choices];
    if (!selection) options.unshift(['', {label: 'Vælg arbejdssted', siteIds: []}]);
    const optionsKey = JSON.stringify(options);
    if (select.dataset.choices !== optionsKey) {
      select.replaceChildren(...options.map(([value, choice]) => {
        const option = node('option', null, choice.label);
        option.value = value;
        option.disabled = !choice.siteIds.length;
        return option;
      }));
      select.dataset.choices = optionsKey;
    }
    select.value = selection;
    select.disabled = publicationBusy || !choices.get('all').siteIds.length;
    if(!publicationSiteCombo){
      publicationSiteCombo=globalThis.CleanRoomsPublicationCombobox?.enhance(select, {
        labelElement:q('#cs-publication-scope-label')
      });
    }
    publicationSiteCombo?.sync();
  }
  function changePublicationSite(value) {
    if (!publicationSiteChoices().choices.get(value)?.siteIds.length) return;
    publicationSiteSelection = value;
    includeRelatedPublication = false;
    publicationSubmitError = '';
    renderChanges();
  }
  function publicationStatus(review=false){return Publication.scopeStatus(state,publicationScope(review));}
  function activityValue(field,value){
    if(value===null||value===undefined)return 'Findes ikke';
    if(field==='deleted')return value?'Slettet':'Med i planen';
    if(field==='time')return value?[(value.start||'—')+'–'+(value.end||'—'),(value.breakMinutes??0)+' min pause',value.comment].filter(Boolean).join(' · '):'Ingen registrering';
    if(field==='leaveDecisions')return value?({approved:'Godkendt',rejected:'Afvist',pending:'Afventer'}[value.status]||value.status)+(value.reason?' · '+value.reason:''):'Intet svar';
    if(field==='requests')return {approved:'Godkendt',rejected:'Afvist',pending:'Afventer'}[value]||String(value);
    if(field==='roster')return value.name+' · '+value.target+' t/uge · '+(sites[value.site]?.name||'Arbejdssted')+' · '+(value.active===false?'Arkiveret':'Aktiv');
    if(field==='edits')return personName(value.person)+' · '+shortDate(value.date)+' · '+clockLabel(value)+' · '+(sites[value.site]?.name||'Arbejdssted')+' · '+(value.plannedBreakMinutes??0)+' min pause';
    if(field==='series')return personName(value.person)+' · '+shortDate(value.startDate)+(Engine.isOpenEnded(value)?' · uden slutdato':'–'+shortDate(value.endDate))+' · '+clockLabel(value)+' · '+(sites[value.site]?.name||'Arbejdssted')+' · '+(value.plannedBreakMinutes??0)+' min pause';
    if(field==='coverageRules')return (sites[value.site]?.name||'Arbejdssted')+' · '+clockLabel(value)+' · '+value.required+' medarbejdere';
    if(field==='workspaceSettings'){
      const budget=value.workHoursBudget;
      const hours=Roster.validWorkHoursBudget(budget)?'Timebudget '+budget.hours.toLocaleString('da-DK')+' t pr. '+(budget.period==='month'?'måned':'uge'):'';
      return [value.companyName||'CleanRooms',value.productName||'CleanRooms Studio',value.contactName,value.contactEmail,value.contactPhone,hours].filter(Boolean).join(' · ');
    }
    return 'Indstillinger opdateret';
  }
  function renderActivity(){
    if(!historyView){
      historyElement=node('div','cs-secondary-page');
      historyView=globalThis.CleanRoomsReview?.mountHistory({element:historyElement,onQuery:payload=>accountAction('activityRead',payload),onBackup:()=>({...state,storageVersion:1}),formatValue:activityValue,onRestore:async entry=>{
        if(!cloudCapabilities.plan||cloudStatus.conflict)return {ok:false,error:'Hent den seneste plan, før du fortsætter.'};
        if(entry.changes?.some(change=>['roster','workspaceSettings'].includes(change.field))&&!cloudCapabilities.manageUsers)return {ok:false,error:'Din rolle kan ikke fortryde denne ændring.'};
        const result=Publication.restoreActivity(state,entry);if(!result.ok)return result;
        if(entry.changes?.some(change=>change.field==='workspaceSettings')&&state.workspaceSettings?.workHoursBudget&&!result.studio.workspaceSettings?.workHoursBudget){
          result.studio.workspaceSettings={...result.studio.workspaceSettings,workHoursBudget:null};
        }
        const before=clone(state);Object.assign(state,result.studio);syncOrganization();syncRoster();const ok=await save();
        if(!ok){Object.assign(state,before);syncOrganization();syncRoster();persistence?.discardPending?.();return {ok:false,error:'Ændringen kunne ikke gemmes. Hent den seneste plan.'};}
        lastUndo=null;notify('Ændringen er fortrudt. Udgivne vagter ændres først ved ny udgivelse.');return {ok:true};
      }});
    }
    if(!historyElement.isConnected)q('#cs-page-content').replaceChildren(historyElement);
    historyView?.render({people:staff,canRestore:cloudCapabilities.plan===true&&!cloudStatus.conflict});
  }
  function ensureRangeBaselines(ranges) {
    ranges.forEach(([from,to]) => {
      const first = Math.max(-52,Math.floor((date(from) - date(anchor)) / 604800000));
      const last = Math.min(52,Math.floor((date(to) - date(anchor)) / 604800000));
      for (let index = first; index <= last; index += 1) weekPlan(index);
    });
  }
  function calendarChangedIds() {
    const result = new Set();
    for (let index = state.week; index < state.week + calendarWeeks(); index += 1) if(calendarWeekLoaded(addDays(anchor,index*7)))changesForWeek(index).forEach(entry => { if (entry.after) result.add(entry.id); });
    return result;
  }
  function shortDate(value) { return date(value).toLocaleDateString('da-DK', {day:'numeric',month:'short',timeZone:'UTC'}); }
  function fullDate(value) { return date(value).toLocaleDateString('da-DK', {weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}); }
  function clockLabel(shift,separator='–'){return shift.start+separator+shift.end+(shift.end<shift.start?' +1 dag':'');}
  function duration(shift){const minutes=Engine.plannedMinutes(shift);return Number.isFinite(minutes)?minutes/60:0;}
  function niceHours(value) { return Number(value.toFixed(2)).toLocaleString('da-DK'); }
  function personFor(id) { return staffById.get(id); }
  function personName(id) { return personFor(id)?.name || 'Ledig vagt'; }
  function searchTerm() { return state.search.trim().toLocaleLowerCase('da-DK'); }
  function hasFilters() { return Boolean(searchTerm() || state.site !== 'all' || (state.page === 'schedule' && state.onlyOpen)); }
  function notify(message) { q('#cs-toast').hidden = false; q('#cs-toast-text').textContent = message; q('#cs-undo').hidden = !lastUndo; }
  function icons() {
    root.querySelectorAll('i[data-lucide]').forEach(placeholder => {
      const replacement = icon(placeholder.getAttribute('data-lucide'));
      const className = placeholder.getAttribute('class');
      if (className) replacement.setAttribute('class', className);
      placeholder.replaceWith(replacement);
    });
  }
  function savedFeedback(message) {
    const epoch=++saveFeedbackEpoch;
    return Promise.resolve(save()).then(ok=>{if(ok&&epoch===saveFeedbackEpoch)notify(message);return ok;});
  }
  function save() {
    state.calendarAnchor=anchor;
    if(planningReadBusy||planningReadBlocked)return Promise.resolve(false);
    if(realEmployee()&&persistence)return cloudLoaded?accountAction('preferences',{preferences:accountPreferences()}).then(result=>result.ok):Promise.resolve(false);
    if(persistence){if(!cloudLoaded)return Promise.resolve(false);const next={...state,storageVersion:1};if(!staff.some(person=>person.id===next.employeePerson))delete next.employeePerson;if(cloudCapabilities.scopeRestricted){if(!allowedSite(next.worksiteSite))delete next.worksiteSite;if(next.site!=='all'&&!allowedSite(Number(next.site)))next.site='all';if(next.departmentId!=='all'&&!state.organization?.departments.some(department=>department.id===next.departmentId))next.departmentId='all';}return persistence.save(next);}
    if (window.openai?.setWidgetState) return window.openai.setWidgetState({
      modelContent:{concept:'CleanRooms',page:state.page,view:effectiveView(),day:selectedDate(),week:state.week},
      privateContent:{studio:{...state}}
    }).then(() => true).catch(() => false);
    return Promise.resolve(true);
  }
  const stalePlanningMessage='Vagten eller serien er ændret i et andet vindue. Dine indtastninger er bevaret. Luk og åbn redigeringen igen, før du gemmer eller sletter.';
  const staleSelectionMessage='En af de valgte vagter er ændret i et andet vindue. Dine valg er bevaret. Luk og vælg vagterne igen, før du gemmer.';
  function usesViewportCalendar(){return Boolean(persistence?.viewport&&cloudCapabilities.plan&&!realEmployee()&&!state.demoSession&&state.role!=='employee'&&state.page==='schedule'&&effectiveView()!=='day');}
  function cancelPlannerWarm(){clearTimeout(plannerWarmTimer);plannerWarmTimer=null;plannerWarmKey='';plannerWarmEpoch++;persistence?.cancelWarmViewport?.();}
  function schedulePlannerWarm(delay=160){
    if(!persistence?.warmViewport||!usesViewportCalendar()||viewportPinned()||plannerViewport.busy||persistence.coverageValid===false)return;
    const [first,last]=calendarRange(),range=viewportRange(),latestStart=addDays(last,-41),from=range.from<latestStart?range.from:latestStart;
    const target={from:from<first?first:from,to:addDays(from<first?first:from,41)},bounds={from:first,to:last},context=viewportKey(),generation=persistence.calendarGeneration,key=JSON.stringify([context,generation,target]);
    if(key===plannerWarmKey)return;
    clearTimeout(plannerWarmTimer);const epoch=++plannerWarmEpoch;plannerWarmKey=key;
    const current=()=>epoch===plannerWarmEpoch&&context===viewportKey()&&generation===persistence.calendarGeneration&&usesViewportCalendar()&&!viewportPinned()&&!plannerViewport.busy;
    plannerWarmTimer=setTimeout(async()=>{
      plannerWarmTimer=null;if(!current()){if(epoch===plannerWarmEpoch)plannerWarmKey='';return;}
      try{
        const result=await persistence.warmViewport(target,{bounds,isCurrent:current});
        if(epoch!==plannerWarmEpoch)return;
        if(result.requiresRefresh&&current()){plannerWarmKey='';persistence.invalidateCoverage?.();render();}
        else if(result.busy||result.cancelled||result.superseded){plannerWarmKey='';if(current())schedulePlannerWarm(Math.max(300,result.retryAfter||0));}
      }catch{ /* Optional read-ahead failure leaves the working calendar intact. */ }
    },delay);
  }
  function viewportKey(){return JSON.stringify([sessionViewer?.userId,state.role,state.page,state.week,effectiveView(),state.zoom,state.departmentId,state.site,state.search,state.onlyOpen]);}
  function viewportRange(){const from=dates()[0];return plannerViewport.key===viewportKey()&&plannerViewport.wanted?plannerViewport.wanted:{from,to:addDays(from,6)};}
  function visiblePlanningProjection(){const from=dates()[0],lazy=persistence?.viewport&&!state.demoSession&&state.page==='schedule'&&effectiveView()!=='day';return {mode:'calendar',...(lazy?viewportRange():{from,to:effectiveView()==='day'?addDays(from,6):calendarRange()[1]})};}
  function viewportPinned(){return Boolean(activeEdit||activeGroup||activeBulk||plannerDetailBusy||planningReadBusy||publicationBusy||planningScopeHolds.size||planningFullHolds.size||['#cs-operations-layer','#cs-needs-layer','#cs-replacement-layer','#cs-review-layer','#cs-changes-layer','.cs-sickness-layer'].some(selector=>q(selector)&&!q(selector).hidden));}
  function viewportIntent(){return viewportKey()+'|'+JSON.stringify([...selectedIds].sort());}
  function calendarWeekLoaded(from){return !usesViewportCalendar()||planningRangeLoaded(from,addDays(from,6));}
  function loadedCalendarWeeks(){const [from]=calendarRange();return Array.from({length:calendarWeeks()},(_,index)=>addDays(from,index*7)).filter(calendarWeekLoaded);}
  function calendarWeekState(from){const range=plannerViewport.errorRange,loading=plannerViewport.loadingRange;return {loaded:calendarWeekLoaded(from),loading:Boolean(plannerViewport.busy&&loading&&from>=loading.from&&from<=loading.to),error:range&&from>=range.from&&from<=range.to?plannerViewport.error:''};}
  function acceptVisibleWeeks(value){
    if(!usesViewportCalendar())return;
    const [first,last]=calendarRange(),seen=(value.visible||[]).filter(day=>day>=first&&day<=last);
    if(!seen.length)return;
    const selected=[...selectedIds].map(id=>shiftById(id)?.date).filter(Boolean).map(staffingMonday),days=[...seen,...(value.prefetch||[]),...selected].filter(day=>day>=first&&day<=last).sort();
    const next={from:days[0],to:addDays(days.at(-1),6)},key=viewportKey();
    if(plannerViewport.key!==key||PlanningRecords.canonical(next)!==PlanningRecords.canonical(plannerViewport.wanted)){plannerViewport.epoch++;plannerViewport.error='';plannerViewport.errorRange=null;}
    plannerViewport.key=key;plannerViewport.wanted=next;plannerViewport.visible=seen;
    syncCalendarBudget();
    if(!persistence.viewportCovers(next)&&!viewportPinned())loadPlannerViewport(next);
  }
  async function loadPlannerViewport(range=viewportRange(),{force=false}={}){
    if(!usesViewportCalendar()||viewportPinned()||plannerViewport.busy)return false;
    if(!force&&plannerViewport.error&&PlanningRecords.canonical(plannerViewport.errorRange)===PlanningRecords.canonical(range))return false;
    const key=viewportKey(),intent=viewportIntent(),epoch=++plannerViewport.epoch;plannerViewport.busy=true;plannerViewport.loadingRange={...range};plannerViewport.error='';plannerViewport.errorRange=null;
    try{
      const [from,to]=calendarRange(),reusable=()=>key===viewportKey()&&intent===viewportIntent()&&!viewportPinned();
      const options={force,bounds:{from,to},isCurrent:()=>epoch===plannerViewport.epoch&&reusable(),canRetain:reusable};
      // A missing neighbor must not keep an already cached visible week behind
      // a loading placeholder. Both adoptions use the normal authority guards.
      const visible=plannerViewport.key===key?plannerViewport.visible:[],selected=[...selectedIds].map(id=>shiftById(id)?.date).filter(Boolean).map(staffingMonday),requiredDays=[...visible,...selected].filter(day=>day>=range.from&&day<=range.to).sort();
      const required=requiredDays.length?{from:requiredDays[0],to:addDays(requiredDays.at(-1),6)}:null;
      if(!force&&required&&!persistence.viewportCovers(required)&&persistence.viewportCached?.(required)){
        const cached=await persistence.viewport(required,options);
        if(!options.isCurrent())return false;
        if(!cached.ok){if(!cached.superseded){plannerViewport.error=cached.message||'Ugen kunne ikke hentes. Prøv igen.';plannerViewport.errorRange={...range};}return false;}
        updatePlanningSummary(cached);
      }
      const result=await persistence.viewport(range,options);
      if(key!==viewportKey()||epoch!==plannerViewport.epoch)return false;
      if(result.ok)updatePlanningSummary(result);
      else if(!result.superseded){plannerViewport.error=result.message||'Ugen kunne ikke hentes. Prøv igen.';plannerViewport.errorRange={...range};}
      return result.ok===true;
    }catch(error){if(key===viewportKey()&&epoch===plannerViewport.epoch){plannerViewport.error=error?.message||'Ugen kunne ikke hentes. Prøv igen.';plannerViewport.errorRange={...range};}return false;}
    finally{plannerViewport.busy=false;plannerViewport.loadingRange=null;if(usesViewportCalendar())render();}
  }
  function retryCalendarWeek(from){plannerViewport.error='';plannerViewport.errorRange=null;const range=viewportRange();return loadPlannerViewport({from:from<range.from?from:range.from,to:addDays(from,6)>range.to?addDays(from,6):range.to},{force:true});}
  function resumePlannerViewport(){
    if(plannerViewportResumeQueued||!usesViewportCalendar())return;
    plannerViewportResumeQueued=true;Promise.resolve().then(()=>{plannerViewportResumeQueued=false;if(usesViewportCalendar()&&!viewportPinned())render();});
  }
  function ensureBaseWeek(run,reason='operations'){
    const from=dates()[0];if(!usesViewportCalendar()||planningRangeLoaded(from,addDays(from,6)))return run();
    return withPlanningScope({mode:'calendar',from,to:addDays(from,6)},run,reason);
  }
  // Header actions keep their original base-week scope. Cached labels are read
  // only, and are discarded whenever plan, directory or absence authority changes.
  function plannerHeader(){
    const generation=persistence?.calendarGeneration;
    if(generation!==plannerHeaderGeneration){plannerHeaderCache.clear();plannerHeaderGeneration=generation;}
    const key=JSON.stringify([dates()[0],state.departmentId,state.site]);
    if(calendarWeekLoaded(dates()[0])){
      const status=publicationStatus(),plan=weekPlan(),drift=operationsModel();
      plan.changes=status.changes.length;plan.published=status.published;
      const value={published:status.published,hasPublished:status.hasPublished,changes:status.changes.length,drift:drift.total};
      plannerHeaderCache.set(key,value);return value;
    }
    return plannerHeaderCache.get(key)||{published:false,hasPublished:false,changes:null,drift:null};
  }
  function hasWindowLoading(){return Boolean(persistence?.window&&persistence?.ensureFull&&cloudCapabilities.plan&&!realEmployee());}
  function planningRangeLoaded(from,to=from){return persistence?.coverageValid!==false&&(!persistence?.isPartial||persistence.covers({from,to}));}
  function updatePlanningSummary(result){
    ingestDirectory(result);
    if(result?.selection?.catalog&&result.catalog)planningCatalog=clone(result.catalog);
    if(result?.workflowSummary&&!workflowLoadedKey){workflowBundle={requests:[],pendingCount:result.workflowSummary.pendingCount};updateWorkflowBadges();}
    if(result?.planningSummary){planningSeriesCount=result.planningSummary.seriesCount;leavePending=result.planningSummary.pendingAbsenceCount;}
  }
  async function readPlanningProjection(projection){
    const key=projection?JSON.stringify(projection):'full';
    if(planningReadBusy){await planningReadPromise;if(planningReadBusy)return {ok:false};}
    planningReadBusy=true;planningReadKey=key;planningReadBlocked='';renderCloudStatus();
    q('.cs-main').inert=true;
    planningReadPromise=(projection?(persistence.scope?persistence.scope(projection):persistence.window(projection)):persistence.ensureFull()).then(result=>{
      updatePlanningSummary(result);
      if(!result.ok){planningReadBlocked=key;cloudStatus={state:'error',conflict:cloudStatus.conflict===true,message:result.message||'Perioden kunne ikke indlæses. Din tidligere plan er bevaret.'};}
      else cloudStatus=persistence.preferenceStatus||{state:'saved',message:'Alle ændringer er gemt'};
      return result;
    }).catch(error=>{planningReadBlocked=key;cloudStatus={state:'error',message:error?.message||'Perioden kunne ikke indlæses. Prøv igen.'};return {ok:false};}).finally(()=>{planningReadBusy=false;planningReadKey='';q('.cs-main').inert=Boolean(planningReadBlocked);renderCloudStatus();});
    return planningReadPromise;
  }
  function peoplePlanningProjection(){const range=employeeProfileId?EmployeeCalendar.range('month',employeeProfileMonth+'-01'):{from:anchor,to:addDays(anchor,34)};return {mode:'calendar',from:range.from,to:range.to};}
  function needsPlanningProjection(){
    if(!cloudLoaded||!hasWindowLoading())return false;
    if(planningReadBusy||publicationBusy)return true;
    const held=[...planningScopeHolds.values()].at(-1);
    if(usesViewportCalendar()&&!held&&!planningFullHolds.size){
      const range=viewportRange();
      if(plannerViewport.key===viewportKey()&&plannerViewport.wanted&&!persistence.viewportCovers(range)&&!viewportPinned())loadPlannerViewport(range);
      return false;
    }
    // These pages read their own records or the metadata/directory supplied by
    // bootstrap. Opening them must not replace a bounded calendar with the whole
    // plan. History still needs its complete backup and recovery authority.
    if(!state.demoSession&&!held&&!planningFullHolds.size&&(state.role!=='employee'&&['hours','leave','workflow','accounts','payroll','workspace','chat'].includes(state.page)||scopedEmployee()||chatActive()))return false;
    const complete=Boolean(state.demoSession)||planningFullHolds.size>0||!held&&(state.role==='employee'||!['schedule','series','people'].includes(state.page));
    const projection=complete?null:held||(state.page==='series'?{mode:'series-list',calendar:visiblePlanningRange(),catalogOnly:true}:state.page==='people'?peoplePlanningProjection():visiblePlanningProjection()),key=complete?'full':JSON.stringify(projection);
    const ready=complete?!persistence.isPartial&&persistence.coverageValid!==false:persistence.isPartial&&Boolean(persistence.coversScope?persistence.coversScope(projection):persistence.covers(projection));
    if(ready)return false;
    if(planningReadBlocked===key)return true;
    readPlanningProjection(projection).then(result=>{if(result.ok){render();persistence.action('preferences',{preferences:accountPreferences()});}else renderCloudStatus();});
    return true;
  }
  async function withCompletePlanning(run,reason='action'){
    if(!hasWindowLoading()||!persistence.isPartial&&persistence.coverageValid!==false)return run();
    planningFullHolds.add(reason);
    const result=await readPlanningProjection(null);
    if(!result.ok){planningRetryWork={run,reason};if(reason==='action')planningFullHolds.delete(reason);return false;}
    planningRetryWork=null;
    try{return await run();}finally{if(reason==='action'){planningFullHolds.delete(reason);render();}}
  }
  function visiblePlanningRange(){const {from,to}=visiblePlanningProjection();return {from,to};}
  function scopeLoaded(projection){return !hasWindowLoading()||!persistence.isPartial&&persistence.coverageValid!==false||Boolean(persistence.coversScope?.(projection));}
  function detailSelection(shifts=[],seriesIds=[]){return {shiftIds:[...new Set(shifts.map(shift=>typeof shift==='string'?shift:shift?.id).filter(Boolean))],...(seriesIds.length?{seriesIds:[...new Set(seriesIds)]}:{})};}
  function needsPlannerDetails(selection){return Boolean(!state.demoSession&&cloudCapabilities.plan&&persistence?.needsDetails?.(selection));}
  function plannerDetailContext(){return JSON.stringify([state.role,state.page,state.week,state.view,employeeProfileId,employeeProfileMonth]);}
  function cancelPlannerDetails(){if(plannerDetailBusy){plannerDetailEpoch++;plannerDetailBusy=false;plannerDetailSelection.clear();renderCloudStatus();}}
  async function withPlannerDetails(selection,run,{force=false}={}){
    const supported=!state.demoSession&&cloudCapabilities.plan&&persistence?.details&&persistence.isPartial;
    if(!supported||!force&&!needsPlannerDetails(selection))return run();
    cancelPlannerWarm();const generation=++plannerDetailEpoch,context=plannerDetailContext();plannerDetailBusy=true;plannerDetailSelection=new Set(selection.shiftIds||[]);renderCloudStatus();
    try{
      const result=await persistence.details(selection,{force});
      if(generation!==plannerDetailEpoch||context!==plannerDetailContext())return false;
      if(!result.ok){if(result.status===409){persistence.invalidateCoverage?.();render();}notify(result.message||'Vagtdetaljerne kunne ikke hentes. Prøv igen.');return false;}
      plannerDetailBusy=false;plannerDetailSelection.clear();renderCloudStatus();return run();
    }finally{if(generation===plannerDetailEpoch){plannerDetailBusy=false;plannerDetailSelection.clear();renderCloudStatus();}}
  }
  async function withPlanningScope(projection,run,reason='editor'){
    if(!hasWindowLoading()||!persistence.scope)return withCompletePlanning(run,reason);
    planningScopeHolds.set(reason,projection);
    if(scopeLoaded(projection))return run();
    const result=await readPlanningProjection(projection);
    if(!result.ok){planningRetryWork={run,reason,projection};return false;}
    planningRetryWork=null;return run();
  }
  async function withPlanningDates(days,run,reason='action-range'){
    const weeks=[...new Set(days.filter(Actions.validDate).map(staffingMonday))].sort();
    if(!weeks.length)return false;
    const from=weeks[0],to=addDays(weeks.at(-1),6);
    try{return (date(to)-date(from))/86400000<56?await withPlanningScope({mode:'calendar',from,to},run,reason):await withCompletePlanning(run,reason);}
    finally{if(reason==='action-range')releasePlanningHold(reason);}
  }
  function seriesOperationRange(series){ return Engine.requiresRange(series)?Engine.operationRange(series,{today}):{from:series.startDate,to:series.endDate}; }
  function seriesHasOccurrences(series){return Engine.countOccurrences(series)>0;}
  function seriesProjection(source,ranges=[]){
    return PlanningScope.normalize({mode:'series',...(source?.id?{seriesId:source.id}:{}),...(source?.groupId?{groupId:source.groupId}:{}),ranges:[...(source?[seriesOperationRange(source)]:[]),...ranges],calendar:visiblePlanningRange()});
  }
  function editorProjection(){
    const draft=readSeriesDraft(),ranges=[];
    // Invalid form values are handled by the existing form validation.
    if(Actions.validDate(draft.startDate)&&Actions.validDate(draft.endDate)&&draft.endDate>=draft.startDate)ranges.push(seriesOperationRange(draft));
    return {...seriesProjection(sourceSeries(),ranges),...(editorExtension?.groupId?{groupId:editorExtension.groupId}:{})};
  }
  function ensureEditorScope(run){
    const projection=editorProjection();
    if(scopeLoaded(projection))return false;
    q('#cs-save').disabled=true;if(!planningReadBusy)withPlanningScope(projection,run,'editor');return true;
  }
  function publicationProjection(){return {mode:'publication',...publicationScope(true),calendar:visiblePlanningRange()};}
  function publicationScopeReady(){return scopeLoaded(publicationProjection());}
  // Compact schedules are read-only conflict context. Only the editable records
  // and their original tokens enter Planning.commands and the write model.
  function conflictShiftsInRange(from,to,data=state){
    const context=persistence?.availability;
    if(!persistence?.isPartial||!context)return shiftsInRange(from,to,data);
    const series=new Map((context.series||[]).map(value=>[value.id,value]));
    for(const value of state.series)series.delete(value.id);for(const value of data.series||[])series.set(value.id,value);
    const edits={...(context.edits||{})};for(const id of Object.keys(state.edits||{}))delete edits[id];Object.assign(edits,data.edits||{});
    const deleted=new Set(context.deleted||[]);for(const id of state.deleted||[])deleted.delete(id);for(const id of data.deleted||[])deleted.add(id);
    const model={...data,series:[...series.values()],edits,deleted:[...deleted]};
    return shiftsInRange(from,to,model);
  }
  function conflictShiftsForWeeks(weeks,data=state){
    const ordered=[...new Set(weeks)].sort(),ranges=[];
    for(const first of ordered){
      const previous=ranges.at(-1);
      // Merge only requested adjacent weeks. A moved exception can be years
      // away, and each materialization must stay within the 366-day limit.
      if(previous&&first===addDays(previous.to,1)&&(date(first)-date(previous.from))/86400000<357)previous.to=addDays(first,6);
      else ranges.push({from:first,to:addDays(first,6)});
    }
    const existing=new Map();for(const range of ranges)for(const shift of conflictShiftsInRange([PlanData?.minDate||'2000-01-01',addDays(range.from,-1)].sort().at(-1),[PlanData?.maxDate||Engine.OPEN_END,addDays(range.to,1)].sort()[0],data))existing.set(shift.id,shift);
    return [...existing.values()];
  }
  function publicationNeighbors(scopes){
    const draft=conflictShiftsForWeeks(scopes.map(part=>part.from));
    const sitesByWeek=new Map(scopes.map(part=>[part.from,new Set(part.siteIds)]));
    const published=(persistence?.availability?.published||[]).filter(shift=>!sitesByWeek.get(staffingMonday(shift.date))?.has(shift.site));
    return [...draft,...published];
  }
  function releasePlanningHold(reason){
    const held=planningScopeHolds.delete(reason)|planningFullHolds.delete(reason);
    if(planningRetryWork?.reason===reason)planningRetryWork=null;
    // Let the caller enqueue its commit before a period replacement flushes it.
    if(held&&hasWindowLoading())Promise.resolve().then(()=>{if(cloudLoaded&&['schedule','series','people'].includes(state.page)&&state.role!=='employee'&&!planningFullHolds.size&&!planningScopeHolds.size)render();});
  }
  function editorPlanningScope(){return editorExtension?.groupId?'all':activeEdit?.seriesId?q('#cs-edit-scope').value:'one';}
  function editorPlanningStale(){return PlanningReconcile?.stale(editorPlanCapture,editorPlanningScope())===true;}
  function paintEditorPlanningConflict(){
    const stale=editorPlanningStale();if(!stale)return false;
    q('#cs-save').disabled=true;q('#cs-delete').disabled=true;q('#cs-series-delete-apply').disabled=true;q('#cs-series-delete-confirm').hidden=true;
    q('#cs-edit-error').hidden=false;q('#cs-edit-error').textContent=stalePlanningMessage;return true;
  }
  function selectionPlanningStale(selection){return PlanningReconcile?.stale(selection?.planCapture)===true;}
  function reconcilePlanning(incoming,context={}){
    if(!PlanningReconcile||!incoming||realEmployee())return;
    if(context.directory?.complete)ingestDirectory({directory:context.directory,studio:incoming});
    if(context.selection?.catalog&&context.catalog)planningCatalog=clone(context.catalog);
    const beforeCapture=editorPlanCapture,priorProjection=context.previousProjection,nextProjection=context.projection;
    const firstGroupLoad=context.scopeReplacement&&nextProjection?.mode==='series'&&!(priorProjection?.mode==='series'&&priorProjection.seriesId===nextProjection.seriesId&&priorProjection.groupId===nextProjection.groupId);
    if(!context.scopeExpansion&&!context.detailHydration){
      editorPlanCapture=PlanningReconcile.advance(editorPlanCapture,context);
      if(activeGroup)activeGroup.planCapture=PlanningReconcile.advance(activeGroup.planCapture,context);
      if(activeBulk)activeBulk.planCapture=PlanningReconcile.advance(activeBulk.planCapture,context);
    }
    const rosterChanged=PlanningRecords.canonical(state.roster)!==PlanningRecords.canonical(incoming.roster),next=PlanningReconcile.reconcile(state,incoming,lastUndo,context);
    for(const key of Object.keys(state))if(!Object.hasOwn(next.state,key))delete state[key];Object.assign(state,next.state);
    if(context.scopeReplacement){
      for(const field of ['publications','checklistProgress','activity','absences','requests','leaveDecisions'])if(incoming[field]!==undefined)state[field]=clone(incoming[field]);
      if(Array.isArray(incoming.absences))leaveRequests.splice(0,leaveRequests.length,...PlanData.leaveRequests(incoming));
      if(firstGroupLoad&&activeEdit&&beforeCapture)editorPlanCapture=PlanningReconcile.upgradeCapture(beforeCapture,context);
      if(context.scopeExpansion){
        if(activeEdit){const fresh=PlanningReconcile.capture(state,{shifts:activeEdit.id?[activeEdit]:[],seriesId:activeEdit.seriesId||null,groupId:editorExtension?.groupId||null});editorPlanCapture={...fresh,staleOne:beforeCapture?.staleOne===true,staleSeries:beforeCapture?.staleSeries===true};}
        if(activeGroup)activeGroup.planCapture=PlanningReconcile.capture(state,{shifts:activeGroup.members});
        if(activeBulk)activeBulk.planCapture=PlanningReconcile.capture(state,{shifts:activeBulk.members});
      }
    }
    if(context.detailHydration){
      if(incoming.checklistProgress)state.checklistProgress=clone(incoming.checklistProgress);
      if(activeEdit){const fresh=PlanningReconcile.capture(state,{shifts:activeEdit.id?[activeEdit]:[],seriesId:activeEdit.seriesId||null,groupId:editorExtension?.groupId||null});editorPlanCapture={...fresh,staleOne:beforeCapture?.staleOne===true,staleSeries:beforeCapture?.staleSeries===true};}
      if(activeGroup)activeGroup.planCapture=PlanningReconcile.capture(state,{shifts:activeGroup.members});
      if(activeBulk)activeBulk.planCapture=PlanningReconcile.capture(state,{shifts:activeBulk.members});
    }
    lastUndo=next.undo&&(PlanningRecords.diff(state,next.undo).length||PlanningRecords.canonical(PlanningRecords.metadata(state))!==PlanningRecords.canonical(PlanningRecords.metadata(next.undo)))?next.undo:null;
    syncOrganization();if(rosterChanged)syncRoster();renderIdentity();staffingContextCache=null;staffingAssessments.clear();
    render();
    if(activeEdit){if(!paintEditorPlanningConflict())updatePreview();}
    if(activeGroup)updateGroupPreview();if(activeBulk)updateBulkPreview();if(activeReplacement)renderReplacement();
  }
  function renderCloudStatus() {
    q('.cs-main').inert=planningReadBusy||Boolean(planningReadBlocked);
    const reading=planningReadBusy||plannerDetailBusy,indicator=q('#cs-save-indicator');if(indicator){indicator.dataset.state=reading&&cloudStatus.state!=='error'?'reading':cloudStatus.state;indicator.textContent=reading&&cloudStatus.state!=='error'?'Henter…':cloudStatus.state==='saved'?'Gemt':cloudStatus.state==='saving'?'Gemmer…':cloudStatus.state==='loading'?'Indlæser…':'Ikke gemt';indicator.title=reading&&cloudStatus.state!=='error'?'Henter de valgte oplysninger…':cloudStatus.message||'';}
    q('.cs-page-head')?.setAttribute('data-reading',String(planningReadBusy));
    root.querySelectorAll('.cs-event[data-shift]').forEach(button=>{if(plannerDetailBusy&&plannerDetailSelection.has(button.dataset.shift))button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');});
    q('#cs-storage-loading').hidden = cloudLoaded;
    q('#cs-storage-loading span').textContent = plannerDetailBusy?'Indlæser vagtdetaljer…':cloudStatus.state === 'error' ? 'Planen kunne ikke indlæses. Prøv igen.' : 'Indlæser din plan…';
    q('#cs-storage-status').hidden = cloudStatus.state !== 'error';
    q('#cs-storage-message').textContent = cloudStatus.message || '';
    q('#cs-storage-retry').textContent = cloudStatus.conflict ? 'Hent seneste version' : 'Prøv igen';
    syncCalendarBudget();
    syncPlanningCosts();
    if(!q('#cs-changes-layer').hidden)updatePublicationButton();
  }
  function resetChangedAccess(){
    if(accessReloadPending)return;accessReloadPending=true;cloudLoaded=false;
    closeEditor({force:true});closeOperationsSheets();closeDemoSheets();accountsView?.destroy?.();accountsView=null;accountsElement=null;departmentView?.close();
    clearChat();clearWorkflow();clearPayroll();clearPayrollPolicy();clearTimekeeping();clearProfileAppLogin();directory?.reset();employeeReader?.reset();cancelPlannerDetails();planningAvailability?.reset();lastUndo=null;
    state.series=[];state.edits={};state.deleted=[];state.weekPlans={};state.publications={version:1,sequence:0,slots:{},records:[]};state.checklistProgress={};state.activity=[];state.roster=[];state.organization=null;state.coverageRules=[];state.requests={};state.leaveDecisions={};state.demoSession=null;state.demoSeed=false;state.departmentId='all';state.site='all';
    staff.splice(0,staff.length);sites.splice(0,sites.length);staffById=new Map();employeeProfileId=null;employeeProfileView?.reset?.();employeeData=null;payrollProblemReturn=null;payrollProfileReturn=null;payrollPolicyPendingOpen=null;
    q('#cs-page-content').replaceChildren();renderCloudStatus();
    Promise.resolve().then(()=>initializeCloud()).finally(()=>{accessReloadPending=false;});
  }
  async function initializeCloud() {
    if (!persistence) return;
    planningAvailability?.reset();
    cancelPlannerDetails();
    plannerViewport.epoch++;plannerViewport.key='';plannerViewport.wanted=null;plannerViewport.error='';plannerViewport.errorRange=null;
    plannerHeaderCache.clear();plannerHeaderGeneration=null;
    clearChat();clearWorkflow();clearPayroll();clearPayrollPolicy();clearTimekeeping();clearProfileAppLogin();profileInformationPending=null;historyView?.destroy?.();historyView=null;historyElement=null;leaveView?.destroy?.();leaveView=null;leaveQueryEpoch++;leaveDecisionRows.clear();employeeProfileView?.reset?.();
    cloudLoaded = false; renderCloudStatus();
    planningReadBlocked='';planningFullHolds.clear();planningScopeHolds.clear();planningCatalog=null;directory?.reset();directoryProfileEpoch++;employeeDirectoryRecord=null;employeeReader?.reset();employeeDetailEpoch++;employeeDetailLoading=false;employeeDetailError='';employeeDetailData=null;
    const first=dates()[0],bootstrap=persistence.viewport&&!state.demoSession?{mode:'calendar',from:first,to:addDays(first,6)}:visiblePlanningProjection();
    const result = await persistence.load({projection:bootstrap}); if (!result.ok) return;
    cloudCapabilities = {...result.capabilities};sessionViewer=result.viewer||null;employeeData=result.employee||null;chatWorkspaceId=result.workspace?.id||'';
    if(realEmployee()){
      closeDemoSheets();accountsView?.destroy?.();accountsView=null;accountsElement=null;q('#cs-page-content').replaceChildren();
      state.series=[];state.edits={};state.deleted=[];state.weekPlans={};state.requests={};state.leaveDecisions={};state.coverageRules=[];state.checklistProgress={};state.organization=null;state.demoSession=null;state.roster=[];state.publications={version:1,sequence:0,slots:{},records:[]};state.activity=[];state.workspaceSettings={};lastUndo=null;
      const prefs=sessionViewer.preferences||{},ownCalendar=Boolean(employeeData?.person&&(!hasAccountAccess()||prefs.page!=='accounts'));
      const startChat=prefs.page==='chat'||cloudCapabilities.manageChat&&!employeeData?.person;
      state.role=startChat&&cloudCapabilities.manageChat?'admin':hasAccountAccess()&&!ownCalendar?'admin':'employee';state.page=startChat?'chat':state.role==='admin'?'accounts':'schedule';if(startChat&&state.role==='employee')employeeWorkspace='chat';state.employeePerson=sessionViewer.personId||'p0';state.employeeShift=null;
      state.employeeView=['month','week','day'].includes(prefs.employeeView)?prefs.employeeView:'month';
      state.employeeDate=validEmployeeDate(prefs.employeeDate)?prefs.employeeDate:currentEmployeeDate();state.employeeWeek=staffingMonday(state.employeeDate);
      const used=employeeData?.sites||[],last=Math.max(0,...used.map(site=>site.index));
      sites.splice(0,sites.length,...Array.from({length:last+1},()=>({name:'Arbejdssted',address:'',color:'var(--cs-blue)'})));
      used.forEach(site=>{sites[site.index]={...site};});
    }
    else if (result.studio) { closeDemoSheets(); restore({privateContent:{studio:result.studio}});if(directory){ingestDirectory(result);if(!directory.ready){const catalog=await directory.loadCatalog();if(!catalog.ok){cloudStatus={state:'error',message:catalog.message};renderCloudStatus();return;}}applyDirectory({ok:true});} if(!cloudCapabilities.previewEmployees)state.role='admin';if(state.page==='accounts'&&!hasAccountAccess())state.page='schedule'; }
    else ensureEmployeeExamples();
    if(!cloudCapabilities.viewPayroll||realEmployee()){payrollProfileReturn=null;payrollPolicyPendingOpen=null;payrollProblemReturn=null;}
    if(cloudCapabilities.scopeRestricted&&['payroll','workspace','demo'].includes(state.page))state.page='schedule';
    if(persistence.isPartial)updatePlanningSummary(result);
    if(realEmployee()&&employeeData&&employeeReader?.seed(employeeData))employeeData={...employeeData,shifts:employeeReader.data.shifts};
    cloudLoaded = true;syncRoster();renderIdentity(); renderCloudStatus(); render();
    if(chatAvailable()&&typeof setInterval==='function'&&!chatBadgeTimer){chatBadgeTimer=setInterval(()=>refreshChatBadge(),30000);chatBadgeTimer?.unref?.();}refreshChatBadge(true);
    if(!persistence.isPartial)loadWorkflow();
    if (!result.studio&&!realEmployee()) save();
  }
  function ensureEmployeeExamples() {
    if (state.employeeExamplesVersion === 1) return;
    const previous = new Map(Object.values(state.weekPlans).flatMap(plan => plan.baseline || []).map(shift => [shift.id,shiftById(shift.id)]));
    state.employeeExamplesVersion = 1;
    state.series = state.series.map(series => !series.note && !series.noteRich ? {...series,...employeeInstructions(series.site)} : series);
    Object.values(state.weekPlans).forEach(plan => {
      if (!Array.isArray(plan.baseline) || plan.baselineKind === 'published' || plan.published) return;
      plan.baseline = plan.baseline.map(before => {
        const prior = previous.get(before.id), after = shiftById(before.id);
        return prior && !prior.note && !prior.noteRich && !before.note && !before.noteRich && after?.noteRich ? {...before,note:after.note,noteRich:after.noteRich} : before;
      });
    });
  }
  function employeeInstructions(site) {
    if(PlanData)return PlanData.employeeInstructions(site);
    const titles = ['Rengør skriveborde og kontaktflader','Rengør behandlingsrum og kontaktflader','Rengør fællesarealer og kontaktflader'];
    const doc = {type:'doc',content:[{type:'heading',attrs:{level:3},content:[{type:'text',text:'Instruktioner til vagten'}]},{type:'paragraph',content:[{type:'text',text:'Eksempel: Brug nøglekortet ved hovedindgangen. Kontakt teamlederen, hvis der mangler udstyr.'}]},{type:'taskList',content:[titles[site] || titles[0],'Tøm affald og fyld sæbe op','Kontrollér lokalerne, lås og slå alarmen til'].map(text => ({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]};
    return {note:Description?.text(doc) || '',noteRich:Description?.encode(doc) || ''};
  }
  function shiftById(id,data = state) {
    if(timeDemoEmployee&&state.role==='employee'&&data===state)return timeState.shifts.find(shift=>shift.demo&&shift.id===id)||null;
    if(scopedEmployee()&&data===state)return employeeData?.person?.id===state.employeePerson?employeeData.shifts.find(shift=>shift.id===id)||timeState.shifts.find(shift=>shift.recovered&&shift.id===id&&shift.person===state.employeePerson)||null:null;
    if(state.role==='employee'&&!realEmployee()&&data===state)return Publication.publishedShifts(state).find(shift=>shift.id===id)||null;
    if(realEmployee())return employeeData?.shifts.find(shift=>shift.id===id)||timeState.shifts.find(shift=>shift.recovered&&shift.id===id&&shift.person===sessionViewer.personId)||null;
    if(PlanData)return PlanData.shiftById(id,data);
    if (data.deleted.includes(id)) return null;
    if (data.edits[id]) return data.edits[id];
    const source = data.series.find(series => String(id).startsWith(series.id + '@'));
    if (source) return seriesOccurrences(source,data).find(shift => shift.id === id) || null;
    const day = String(id).slice(-10);
    return Actions.validDate(day) ? shiftsInRange(day,day,data).find(shift => shift.id === id) || null : null;
  }
  function checklistView(shift) { if(scopedEmployee()&&employeeDetailData?.shift?.id!==shift.id&&employeeData?.taskSummaries?.[shift.id])return {...employeeData.taskSummaries[shift.id],tasks:[],signature:''};return Checklist?.read(scopedEmployee()?employeeData?.progress||{}:realEmployee()?employeeData?.progress||{}:state.checklistProgress,shift) || {signature:'',tasks:[],checked:0,total:0,complete:false}; }
  async function toggleEmployeeTask(id,key,checked,signature) {
    if (state.role !== 'employee' || !cloudLoaded || cloudStatus.state !== 'saved') return false;
    const shift = shiftById(id);
    if (!shift || shift.person !== state.employeePerson || !Checklist) return false;
    if(realEmployee()){
      const previous=employeeData.progress||{},proposal=Checklist.set(previous,shift,{key,checked,signature,person:sessionViewer.personId});
      if(!proposal.ok)return false;
      employeeData.progress=proposal.progress;cloudStatus={state:'saving',message:'Gemmer afkrydsning…'};renderEmployee();
      const result=await accountAction('checklist',{shiftId:id,key,checked,signature});
      if(result.ok){employeeData.progress={...previous,...(result.progress||{})};if(employeeDetailData)employeeDetailData.progress=employeeData.progress;const view=Checklist.read(employeeData.progress,shift);employeeData.taskSummaries={...employeeData.taskSummaries,[id]:{checked:view.checked,total:view.total,complete:view.complete}};cloudStatus={state:'saved',message:'Afkrydsningen er gemt.'};}
      else {employeeData.progress=previous;cloudStatus={state:'error',conflict:true,message:result.message||'Afkrydsningen kunne ikke gemmes. Hent vagten igen.'};}
      renderCloudStatus();renderEmployee();return result.ok;
    }
    const result = Checklist.set(state.checklistProgress,shift,{key,checked,signature,person:state.employeePerson});
    if (!result.ok) return false;
    state.checklistProgress = result.progress;
    if (lastUndo) {
      const prior = shiftById(id,lastUndo);
      if (prior?.person === shift.person) {
        const undoResult = Checklist.set(lastUndo.checklistProgress,prior,{key,checked,signature,person:shift.person});
        if (undoResult.ok) lastUndo.checklistProgress = undoResult.progress;
      }
    }
    const saving = save(); if (!persistence) renderEmployee(); return saving;
  }
  function validEmployeeDate(value) {
    return Actions.validDate(value) && value >= addDays(anchor,-364) && value <= addDays(anchor,370);
  }
  function changeEmployeeDate(value,options = {}) {
    if (!validEmployeeDate(value)) return false;
    if (options.view !== undefined && !['month','week','day'].includes(options.view)) return false;
    employeeDetailEpoch++;employeeReader?.cancelDetail();employeeDetailData=null;employeeDetailLoading=false;employeeDetailError='';state.employeeDate = value; state.employeeWeek = staffingMonday(value); state.employeeShift = null;
    if (options.view) state.employeeView = options.view;
    render(); save(); return true;
  }
  function changeEmployeeView(view) {
    if (!['month','week','day'].includes(view)) return false;
    employeeDetailEpoch++;employeeReader?.cancelDetail();employeeDetailData=null;employeeDetailLoading=false;employeeDetailError='';state.employeeView = view; state.employeeShift = null; render(); save(); return true;
  }
  function clearWorkflow(){
    workflowEpoch++;workflowKey='';workflowLoadedKey='';workflowLoading=false;workflowBundle=null;workflowError='';workflowLastRead=0;
    workflowView?.dispose?.();workflowView=null;workflowElement=null;workflowPane=null;workflowChrome=null;workflowMountedMode='';
  }
  function isWorkflowDemo(){return workflowDemoActive&&cloudCapabilities.plan===true&&state.role!=='employee'&&state.page==='workflow';}
  function workflowContext(){return isWorkflowDemo()?'demo:'+(workflowDemoPerson||'manager'):state.role==='employee'?'employee:'+String(realEmployee()?sessionViewer?.personId:state.employeePerson)+':'+employeeWorkspace:'manager';}
  function updateWorkflowBadges(){
    const unread=state.role==='employee'?Number(workflowBundle?.unreadCount)||0:0,count=workflowBundle?.demo?0:workflowBundle?.pendingCount??(workflowBundle?.requests||[]).filter(item=>item.status==='pending').length;
    q('#cs-messages-count').textContent=String(unread);q('#cs-messages-count').hidden=!unread;
    q('#cs-workflow-count').textContent=String(count);q('#cs-workflow-count').hidden=!count;
  }
  async function loadWorkflow(force=false){
    if(!cloudLoaded||!persistence||!globalThis.CleanRoomsShiftWorkflowView||state.role==='employee'&&employeeWorkspace==='chat')return;
    const key=workflowContext();
    if(workflowLoading&&workflowKey===key||!force&&workflowLoadedKey===key&&Date.now()-workflowLastRead<(workflowError?5000:30000))return;
    if(workflowKey!==key){workflowEpoch++;workflowBundle=null;workflowLoadedKey='';workflowError='';}
    const epoch=++workflowEpoch;workflowKey=key;workflowLoading=true;workflowError='';
    const payload={...(state.role==='employee'&&!realEmployee()?{personId:state.employeePerson}:{}),...(state.role==='employee'&&employeeWorkspace==='calendar'?{summary:true}:{})};
    const result=await accountAction(isWorkflowDemo()?'workflowDemo':'workflowRead',isWorkflowDemo()?{operation:'read',...(workflowDemoPerson?{personId:workflowDemoPerson}:{})}:payload);
    if(epoch!==workflowEpoch||key!==workflowContext())return;
    workflowLoading=false;workflowLastRead=Date.now();
    workflowLoadedKey=key;if(result.ok){workflowBundle=result.bundle||result;}else workflowError=result.message||'Beskeder og anmodninger kunne ikke hentes.';
    updateWorkflowBadges();
    if(state.role==='employee'&&employeeWorkspace!=='calendar'&&employeeWorkspace!=='chat')renderWorkflow(employeeWorkspace==='messages'?'messages':'employee');else if(state.role!=='employee'&&state.page==='workflow')renderWorkflow('manager');
    return result;
  }
  async function workflowCommand(action,payload={}){
    if(workflowBundle?.preview||state.role==='employee'&&!realEmployee())return {ok:false,message:'Forhåndsvisningen er skrivebeskyttet. Medarbejderen svarer fra sin egen konto.'};
    const demo=isWorkflowDemo();
    if(action==='workflowDecide'&&!demo)root.inert=true;
    const startedKey=workflowContext(),startedEpoch=workflowEpoch;let result;
    try{
      result=await accountAction(demo?'workflowDemo':action,demo?{...payload,operation:'act',demoAction:action,demoVersion:workflowBundle?.demoVersion,...(workflowDemoPerson?{personId:workflowDemoPerson}:{})}:{...payload,...(action==='workflowDecide'&&Number.isSafeInteger(workflowBundle?.revision)?{studioRevision:workflowBundle.revision}:{})});
      if(!result.ok){if(action==='workflowDecide'&&!demo&&result.status===409){await initializeCloud();state.role='admin';state.page='workflow';render();await loadWorkflow(true);}return result;}
      if(action==='workflowDecide'&&!demo){
        await initializeCloud();state.role='admin';state.page='workflow';render();await loadWorkflow(true);
      }else{
        if(startedKey!==workflowContext()||startedEpoch!==workflowEpoch)return {ok:true,message:'Ændringen er gemt. Hent den aktuelle visning for at se resultatet.'};
        workflowBundle=result.bundle||result;workflowLoadedKey=workflowContext();workflowLastRead=Date.now();updateWorkflowBadges();
      }
      return {...result,bundle:workflowBundle};
    }finally{if(action==='workflowDecide'&&!demo)root.inert=false;}
  }
  let freshnessRequest=null,lastFreshnessCheck=0,freshnessDeferred=false;
  function refreshOnReturn(force=false){
    if(!cloudLoaded||!persistence||document.hidden||freshnessRequest)return Promise.resolve(false);
    if(publicationBusy||timeBusy||timeFilterTimer||timeView?.hasDraft||timeView?.busy||leaveBusy||persistence.hasPendingPlanSave||viewportPinned()||editorHasDirtyDraft()){freshnessDeferred=true;return Promise.resolve(false);}
    if(!force&&Date.now()-lastFreshnessCheck<30000)return Promise.resolve(false);
    lastFreshnessCheck=Date.now();freshnessDeferred=false;
    freshnessRequest=(async()=>{
      if(state.role==='employee'){if(scopedEmployee())await loadEmployeeRead(true);if(employeeWorkspace!=='chat')await loadWorkflow(true);}
      else if(state.page==='hours')await loadTimekeeping(true);
      else if(state.page==='workflow')await loadWorkflow(true);
      else if(usesViewportCalendar())await loadPlannerViewport(viewportRange(),{force:true});
      else if(state.page==='leave'){leaveRefresh++;renderLeave();}
      else if(state.page==='people'){if(employeeProfileId){const personId=employeeProfileId,result=await directory?.get('employee',personId,{force:true});if(result?.ok&&employeeProfileId===personId){employeeDirectoryRecord=result.record;const index=state.roster.findIndex(person=>person.id===personId);if(index>=0)state.roster[index]={...result.record.value,_directoryVersion:result.record.version};syncRoster();renderEmployeeProfile();}}else await directory?.loadCatalog({force:true});}
      return true;
    })().catch(()=>false).finally(()=>{freshnessRequest=null;});
    return freshnessRequest;
  }
  async function loadMoreWorkflow(kind){
    const names={messages:'messageCursor',requests:'requestCursor',ownShifts:'ownCursor',openShifts:'openCursor',colleagues:'colleagueCursor'},cursor=workflowBundle?.pagination?.[kind]?.nextCursor??workflowBundle?.pagination?.[kind];
    if(workflowLoading||!names[kind]||typeof cursor!=='string'||!cursor)return false;
    const key=workflowContext(),epoch=++workflowEpoch,previous=workflowBundle;workflowLoading=true;workflowError='';renderWorkflow(state.role==='employee'?employeeWorkspace==='messages'?'messages':'employee':'manager');
    const result=await accountAction('workflowRead',{...(state.role==='employee'&&!realEmployee()?{personId:state.employeePerson}:{}),[names[kind]]:cursor});
    if(epoch!==workflowEpoch||key!==workflowContext())return false;
    workflowLoading=false;
    if(!result.ok||result.revision!==previous.revision||result.directoryRevision!==previous.directoryRevision){workflowError=result.message||'Listen er ændret. Opdater beskeder og anmodninger.';if(result.status===409||result.ok){workflowLoadedKey='';return loadWorkflow(true);}renderWorkflow(state.role==='employee'?employeeWorkspace==='messages'?'messages':'employee':'manager');return false;}
    const fields=kind==='messages'?['notifications','deliveries']:[kind],next={...previous,pagination:{...previous.pagination,[kind]:result.pagination?.[kind]}};
    for(const field of fields)next[field]=[...new Map([...(previous[field]||[]),...(result[field]||[])].map(item=>[item.id,item])).values()];
    if(fields.reduce((sum,field)=>sum+next[field].length,0)>50000||new TextEncoder().encode(JSON.stringify(next)).byteLength>64*1024*1024){workflowError='Listen fylder for meget. Opdater visningen eller afgræns perioden.';renderWorkflow(state.role==='employee'?employeeWorkspace==='messages'?'messages':'employee':'manager');return false;}
    workflowBundle=next;workflowLoadedKey=key;workflowLastRead=Date.now();renderWorkflow(state.role==='employee'?employeeWorkspace==='messages'?'messages':'employee':'manager');return true;
  }
  async function openWorkflowShift(id,summary){
    const personId=realEmployee()?sessionViewer?.personId:state.employeePerson;
    if(employeeReader){state.role='employee';state.employeePerson=personId;employeeWorkspace='calendar';if(validEmployeeDate(summary?.date)){state.employeeDate=summary.date;state.employeeWeek=staffingMonday(summary.date);}return openEmployeeShift(id,summary);}
    await initializeCloud();
    if(!cloudLoaded)return;
    state.role='employee';state.employeePerson=personId;employeeWorkspace='calendar';
    const shift=realEmployee()?employeeData?.shifts.find(item=>item.id===id):Publication.publishedShifts(state,personId).find(item=>item.id===id);
    state.employeeShift=shift?.id||null;
    if(validEmployeeDate((shift||summary)?.date)){state.employeeDate=(shift||summary).date;state.employeeWeek=staffingMonday(state.employeeDate);}
    render();if(!shift)notify('Vagten findes ikke længere i din udgivne plan.');save();
  }
  function openEmployeeWorkspace(value){
    if(!['messages','exchanges'].includes(value)||realEmployee()&&!employeeData?.person)return;
    employeeWorkspace=value;state.page='schedule';state.role='employee';state.employeeShift=null;timeDemoEmployee=false;render();loadWorkflow(true);save();
  }
  function openDemoShift(id,summary){
    const shift=(workflowBundle?.demoShifts||[]).find(item=>item.id===id)||summary;if(!shift)return;
    const dialog=node('dialog','cs-workflow-demo-detail');dialog.setAttribute('aria-label','Eksempelvagt');
    const title=node('h3',null,'Eksempelvagt'),close=node('button','cs-button','Luk');close.type='button';close.addEventListener('click',()=>dialog.close());
    dialog.append(title,node('p','cs-workflow-muted','Isolerede eksempeldata'),node('strong','cs-workflow-shift-time',clockLabel(shift)),node('p',null,shift.date+' · '+(shift.siteName||workflowBundle?.demoSites?.[shift.site]?.name||'Arbejdssted')));
    const name=workflowBundle?.demoPeople?.find(person=>person.id===shift.person)?.name;dialog.append(node('p',null,name||'Ledig vagt'));if(shift.plannedBreakMinutes)dialog.append(node('p',null,shift.plannedBreakMinutes+' min planlagt pause'));if(shift.note)dialog.append(node('p',null,shift.note));dialog.append(close);root.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();close.focus();
  }
  function toggleWorkflowDemo(){
    workflowDemoActive=!isWorkflowDemo();workflowDemoPerson='';workflowSelectedShift=null;clearWorkflow();render();loadWorkflow(true);
  }
  async function resetWorkflowDemo(){
    if(!isWorkflowDemo()||workflowLoading)return;
    const startedKey=workflowContext(),startedEpoch=workflowEpoch;workflowLoading=true;renderWorkflow('manager');
    const result=await accountAction('workflowDemo',{operation:'reset',...(workflowDemoPerson?{personId:workflowDemoPerson}:{}),demoVersion:workflowBundle?.demoVersion});
    if(startedKey!==workflowContext()||startedEpoch!==workflowEpoch)return result;
    workflowLoading=false;if(result.ok){workflowBundle=result.bundle||result;workflowLoadedKey=workflowContext();}else workflowError=result.message||'Demoen kunne ikke nulstilles.';renderWorkflow('manager');
  }
  function renderWorkflowChrome(){
    if(!workflowChrome)return;workflowChrome.replaceChildren();
    if(state.role==='employee'||!cloudCapabilities.plan){workflowChrome.hidden=true;return;}
    workflowChrome.hidden=false;const demo=isWorkflowDemo();
    if(demo){
      workflowChrome.append(node('strong','cs-workflow-demo-label','Eksempelvisning'),node('span','cs-workflow-demo-caption','Anmodninger og beskeder i et separat prøvemiljø'));
      const label=node('label','cs-workflow-demo-person'),select=node('select');label.append(node('span',null,'Vis som'));select.setAttribute('aria-label','Vis eksempel som');const manager=node('option',null,'Planlægger');manager.value='';select.append(manager);
      for(const person of workflowBundle?.demoPeople||[]){const option=node('option',null,person.name);option.value=person.id;select.append(option);}select.value=workflowDemoPerson;select.disabled=workflowLoading;
      select.addEventListener('change',()=>{workflowDemoPerson=select.value;workflowSelectedShift=null;clearWorkflow();renderWorkflow('manager');loadWorkflow(true);});label.append(select);workflowChrome.append(label);
      if(workflowDemoPerson){const views=node('div','cs-workflow-demo-views');views.setAttribute('role','group');views.setAttribute('aria-label','Demovisning');for(const [key,text]of [['employee','Vagtbytte'],['messages','Beskeder']]){const button=node('button','cs-button cs-chrome-quiet',text);button.type='button';button.setAttribute('aria-pressed',String(key===workflowDemoView));button.addEventListener('click',()=>{workflowDemoView=key;renderWorkflow('manager');});views.append(button);}workflowChrome.append(views);}
      const reset=node('button','cs-button cs-chrome-quiet','Nulstil eksemplet'),exit=node('button','cs-button cs-chrome-quiet','Afslut eksemplet');reset.type=exit.type='button';reset.disabled=workflowLoading;reset.addEventListener('click',resetWorkflowDemo);exit.addEventListener('click',toggleWorkflowDemo);workflowChrome.append(reset,exit);
    }else{const start=node('button','cs-button cs-chrome-quiet','Prøv med eksempeldata');start.type='button';start.addEventListener('click',toggleWorkflowDemo);workflowChrome.append(start);}
  }
  function renderWorkflow(mode){
    if(mode==='manager'?(state.role==='employee'||state.page!=='workflow'):(state.role!=='employee'||!['messages','exchanges'].includes(employeeWorkspace)))return;
    const demo=isWorkflowDemo(),effectiveMode=demo&&workflowDemoPerson?workflowDemoView:mode,host=mode==='manager'?q('#cs-page-content'):q('#cs-employee-content');
    if(!workflowElement||!workflowElement.isConnected||workflowMountedMode!==effectiveMode){
      workflowView?.dispose?.();workflowElement=node('div','cs-workflow-host');workflowMountedMode=effectiveMode;workflowChrome=node('div','cs-workflow-demo-tools');workflowPane=node('div','cs-workflow-pane');workflowElement.append(workflowChrome,workflowPane);host.replaceChildren(workflowElement);
      workflowView=globalThis.CleanRoomsShiftWorkflowView?.mount({element:workflowPane,onAction:workflowCommand,onRefresh:()=>loadWorkflow(true),onLoadMore:loadMoreWorkflow,onOpenShift:(id,shift)=>demo?openDemoShift(id,shift):mode==='manager'?shift?.date&&navigateTo(shift.date,shift.person):openWorkflowShift(id,shift),onOpenSchedule:shift=>demo?openDemoShift(shift.id,shift):shift?.date&&navigateTo(shift.date,shift.person)});
    }
    loadWorkflow();renderWorkflowChrome();workflowView?.render({mode:effectiveMode,bundle:workflowBundle||{notifications:[],requests:[],openShifts:[],ownShifts:[],colleagues:[],deliveries:[],unreadCount:0,preview:state.role==='employee'&&!realEmployee(),canManage:effectiveMode==='manager'},loading:workflowLoading,error:workflowError,selectedShiftId:effectiveMode==='employee'?workflowSelectedShift:null});
  }
  function renderEmployee() {
    if(employeeWorkspace==='chat'){q('.cs-employee-brand strong').textContent='Chat';q('.cs-employee-topbar').inert=false;q('.cs-sidebar').inert=false;q('#cs-time-demo-context').hidden=true;q('#cs-employee-person').value=realEmployee()?sessionViewer.personId:state.employeePerson;renderChat(true);return;}
    if (!globalThis.CleanRoomsEmployee) return;
    loadWorkflow();
    q('.cs-employee-brand strong').textContent=employeeWorkspace==='messages'?'Beskeder':employeeWorkspace==='exchanges'?'Vagtbytte':'Mine vagter';
    if(employeeWorkspace!=='calendar'){q('.cs-employee-topbar').inert=false;q('.cs-sidebar').inert=false;q('#cs-time-demo-context').hidden=true;q('#cs-employee-person').value=realEmployee()?employeeData?.person?.id:state.employeePerson;renderWorkflow(employeeWorkspace==='messages'?'messages':'employee');return;}
    const employeeToday = timeDemoEmployee&&(timeState.demo.demoClockDate||timeState.demo.clockDate)||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const person = scopedEmployee()&&employeeData?.person?.id===state.employeePerson?employeeData.person:realEmployee()?employeeData?.person:personFor(state.employeePerson), minDate = addDays(anchor,-364), planningEnd = addDays(anchor,370);
    if(!person)return;
    const focusDate = validEmployeeDate(state.employeeDate) ? state.employeeDate : state.employeeWeek;
    const view = ['month','week','day'].includes(state.employeeView) ? state.employeeView : 'month';
    const range = EmployeeCalendar?.range(view,focusDate) || {from:state.employeeWeek,to:addDays(state.employeeWeek,6)};
    if(scopedEmployee())loadEmployeeRead();
    const from = [range.from,minDate].sort().at(-1), to = [range.to,planningEnd].sort()[0];
    const shifts = !scopedEmployee()&&from <= to ? shiftsInRange(addDays(from,-1),to) : [], upcoming = !scopedEmployee()&&employeeToday <= planningEnd ? shiftsInRange(addDays(employeeToday,-1),[addDays(employeeToday,365),planningEnd].sort()[0]) : [];
    const all = timeDemoEmployee?timeState.shifts.filter(shift=>shift.demo&&shift.person===person.id):scopedEmployee()?[...new Map([...(employeeData?.person?.id===person.id?employeeData.shifts||[]:[]),...timeState.shifts.filter(shift=>shift.recovered&&shift.person===person.id)].map(shift=>[shift.id,shift])).values()]:realEmployee()?[...new Map([...employeeData.shifts,...timeState.shifts.filter(shift=>shift.recovered&&shift.person===person.id)].map(shift=>[shift.id,shift])).values()]:[...new Map([...shifts,...upcoming].map(shift => [shift.id,shift])).values()];
    loadTimekeeping();
    q('#cs-employee-person').value = person.id;
    q('#cs-time-demo-context').hidden=!timeDemoEmployee;
    q('#cs-open-admin').textContent=timeDemoEmployee?'Tilbage til Timer':'Planlægger';
    q('.cs-employee-demo-controls label span').textContent=timeDemoEmployee?'Eksempel · Vis som':'Udgivne · Vis som';
    const detailOpen = all.some(shift => shift.id === state.employeeShift && shift.person === person.id);
    q('.cs-employee-topbar').inert = detailOpen; q('.cs-sidebar').inert = detailOpen;
    const absenceOpen=q('.cs-employee-absence')?.open===true;
    globalThis.CleanRoomsEmployee.render(q('#cs-employee-content'),{
      person,staff,sites,shifts:all,view,focusDate,weekStart:staffingMonday(focusDate),today:employeeToday,selectedShiftId:state.employeeShift,minDate,maxDate:planningEnd,
      worksiteInfo:employeeDetailData?.shift?.id===state.employeeShift?employeeDetailData.site?.worksiteInfo:undefined,
      progressFor:checklistView,saveStatus:employeeDetailLoading?{state:'loading',message:'Henter instruktioner og tjekliste…'}:{...cloudStatus,retry:retryCloud},
      calendarLoading:scopedEmployee()&&employeeReader.loading,calendarError:scopedEmployee()&&(employeeReader.error||employeeDetailError),onCalendarRetry:()=>loadEmployeeRead(true),detailLoading:employeeDetailLoading,
      timekeeping:{entries:timeState.entries.filter(entry=>entry.personId===person.id&&Boolean(entry.demo)===timeDemoEmployee).map(entry=>{const copy={...entry};delete copy.payroll;delete copy.approvalHistory;delete copy.reopenedApproval;return copy;}),loading:timeState.loading,error:timeState.error,busy:timeBusy,enabled:cloudLoaded&&!employeeDetailLoading,preview:!realEmployee(),demo:timeDemoEmployee?timeState.demo:null,canDemoEdit:timeDemoEmployee&&cloudCapabilities.plan===true,serverNow:timeState.serverNow,today:employeeToday},
      onTimeAction:payload=>timeCommand('timeWrite',payload),
      onOfferShift:!timeDemoEmployee?shift=>{workflowSelectedShift=shift.id;openEmployeeWorkspace('exchanges');}:undefined,
      onDateChange:changeEmployeeDate,onViewChange:changeEmployeeView,onWeekChange:changeEmployeeDate,
      onOpenShift:openEmployeeShift,
      onToggleTask:realEmployee()?toggleEmployeeTask:undefined,preview:!realEmployee()
    });
    if(!detailOpen){
      if(realEmployee()&&!timeDemoEmployee){const requestButton=node('button','cs-button','Anmod om fravær');requestButton.type='button';requestButton.addEventListener('click',()=>openAbsenceRequest(person.id));q('#cs-employee-content').append(requestButton);}
      const ownRequests=realEmployee()?employeeData?.leaveRequests||[]:leaveRequests.filter(item=>item.p===person.id).map(item=>({...item,status:state.requests[item.id]||item.status,decision:state.leaveDecisions?.[item.id]}));
      if(ownRequests.length){
        const section=node('details','cs-employee-absence'),summary=node('summary',null,'Mit fravær · '+ownRequests.length);section.open=absenceOpen;section.append(summary);
        for(const request of ownRequests){const row=node('div','cs-employee-absence-item'),status=node('span','cs-review-badge',({pending:'Afventer',approved:'Godkendt',rejected:'Afvist'})[request.status]||request.status);status.dataset.state=request.status;row.append(node('strong',null,request.type+' · '+request.dates),status);if(request.decision?.reason)row.append(node('p',null,request.decision.reason));section.append(row);}
        q('#cs-employee-content').append(section);
      }
    }
  }
  function setRole(role) {
    if(realEmployee()&&(role==='employee'?!employeeData?.person:!hasAccountAccess()))return;
    if(!confirmEditorLeave(()=>setRole(role)))return false;
    closeEditor({force:true});
    if(realEmployee()&&role!=='employee')state.page='accounts';
    if(role==='employee')state.page='schedule';
    employeeWorkspace='calendar';workflowSelectedShift=null;timeDemoEmployee=false;departmentView?.close(); closeDemoSheets(); state.role = role === 'employee' ? 'employee' : 'admin'; state.employeeShift = null;
    if (state.role === 'employee'&&!realEmployee()) { state.employeeDate = dates()[0]; state.employeeWeek = dates()[0]; } render(); save();
  }
  function retryCloud() { if (!persistence) return; if(planningReadBlocked){planningReadBlocked='';if(cloudStatus.conflict){initializeCloud();return;}if(planningRetryWork){const retry=planningRetryWork;planningRetryWork=null;retry.projection?withPlanningScope(retry.projection,retry.run,retry.reason):withCompletePlanning(retry.run,retry.reason);}else render();return;} if (!cloudLoaded || cloudStatus.conflict) initializeCloud(); else persistence.retry(); }
  function validDemoSession(session) {
    const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
    const shift = value => record(value) && typeof value.id === 'string' && value.id.length > 0 && typeof value.person === 'string'
      && Number.isInteger(value.site) && value.site >= 0 && value.site < sites.length
      && !Engine.validate({id:value.id,person:value.person || 'unassigned',site:value.site,startDate:value.date,endDate:value.date,weekdays:[0],start:value.start,end:value.end,noteRich:value.noteRich,...(value.plannedBreakMinutes!==undefined?{plannedBreakMinutes:value.plannedBreakMinutes}:{})}).length;
    const work = value => record(value) && Array.isArray(value.series) && value.series.every(series => !Engine.validate(series).length)
      && record(value.edits) && Object.values(value.edits).every(shift) && Array.isArray(value.deleted) && value.deleted.every(id => typeof id === 'string')
      && record(value.weekPlans) && Object.values(value.weekPlans).every(plan => record(plan) && (plan.baseline === undefined || Array.isArray(plan.baseline) && plan.baseline.every(shift)))
      && (value.coverageRules === undefined || validCoverageRules(value.coverageRules))
      && (value.requests === undefined || record(value.requests) && Object.values(value.requests).every(status => ['approved','rejected','pending'].includes(status)));
    if (!record(session) || session.version !== 1 || !['overview','overlap','leave','request','hours','series','bulk','coverage'].includes(session.scenario)) return false;
    const backup = session.backup;
    if (!work(backup) || Object.hasOwn(backup,'demoSession') || !record(backup.requests) || Object.values(backup.requests).some(status => !['approved','rejected','pending'].includes(status))) return false;
    if (!['schedule','people','leave','hours','series','accounts'].includes(backup.page) || !['people','sites'].includes(backup.group)
      || !['auto','week','day'].includes(backup.view) || ![1,2,4].includes(backup.zoom)
      || !Number.isInteger(backup.week) || backup.week < -52 || backup.week > 52 || !Number.isInteger(backup.day) || backup.day < 0 || backup.day > 6
      || !Number.isInteger(backup.pageIndex) || backup.pageIndex < 0 || backup.pageIndex > 3
      || typeof backup.search !== 'string' || !(backup.site === 'all' || typeof backup.site === 'string' && /^\d+$/.test(backup.site) && sites[Number(backup.site)]) || typeof backup.onlyOpen !== 'boolean') return false;
    return session.backupUndo === null || work(session.backupUndo);
  }
  function restoredDescription(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    const copy = {...record};
    if (copy.noteRich != null && typeof copy.noteRich !== 'string') delete copy.noteRich;
    return copy;
  }
  function restore(value) {
    const saved = value?.privateContent?.studio;
    if (!saved || typeof saved !== 'object') return;
    if (Departments) {
      state.organization = saved.organization === undefined ? Departments.defaultOrganization() : !Departments.validate(saved.organization).length ? clone(saved.organization) : state.organization;
      syncOrganization();
      state.departmentId = saved.departmentId === 'all' || state.organization.departments.some(item => item.id === saved.departmentId) ? saved.departmentId : 'all';
    }
    for (const key of ['page','group','view','zoom','day','onlyOpen','week','pageIndex','search','site','edits','deleted','requests','leaveDecisions','roster','demoSeed','workspaceSettings','publications','activity']) if (saved[key] !== undefined) state[key] = clone(saved[key]);
    if(Array.isArray(saved.absences))leaveRequests.splice(0,leaveRequests.length,...PlanData.leaveRequests(saved));
    syncRoster();renderIdentity();
    const priorAnchor=Actions.validDate(saved.calendarAnchor)?saved.calendarAnchor:'2026-10-26';
    if(priorAnchor!==anchor&&Number.isInteger(state.week))state.week+=Math.round((date(priorAnchor)-date(anchor))/604800000);
    if (!['schedule','people','leave','hours','series','demo','accounts','workspace','activity','payroll','workflow','chat'].includes(state.page)) state.page = 'schedule';
    if (!['people','sites'].includes(state.group)) state.group = 'people';
    if (!['auto','week','day'].includes(state.view)) state.view = 'week';
    if (saved.calendarLayoutVersion !== 2 || ![1,2,4].includes(Number(state.zoom))) state.zoom = 1; else state.zoom = Number(state.zoom);
    state.day = Math.max(0, Math.min(6, Math.floor(Number(state.day) || 0)));
    state.week = Math.max(-52, Math.min(52, Math.floor(Number(state.week) || 0)));
    state.pageIndex = Math.max(0, Math.min(3, Math.floor(Number(state.pageIndex) || 0)));
    state.onlyOpen = state.onlyOpen === true;
    if (typeof state.search !== 'string') state.search = '';
    if (state.site !== 'all' && !(typeof state.site === 'string' && /^\d+$/.test(state.site) && sites[Number(state.site)])) state.site = 'all';
    if (!Array.isArray(state.deleted)) state.deleted = [];
    if (!state.edits || typeof state.edits !== 'object' || Array.isArray(state.edits)) state.edits = {};
    state.edits = Object.fromEntries(Object.entries(state.edits).map(([id,shift]) => [id,restoredDescription(shift)]));
    if (!state.requests || typeof state.requests !== 'object' || Array.isArray(state.requests)) state.requests = {};
    if (!state.leaveDecisions || typeof state.leaveDecisions !== 'object' || Array.isArray(state.leaveDecisions)) state.leaveDecisions = {};
    state.coverageRules = validCoverageRules(saved.coverageRules) ? clone(saved.coverageRules) : Coverage?.defaultRules() || [];
    state.series = Array.isArray(saved.series) ? saved.series.map(restoredDescription).filter(series => !Engine.validate(series).length) : [{...initialSeries,weekdays:[1,3]}];
    if (!Array.isArray(saved.series)) migrateLegacyJonas();
    state.weekPlans = saved.weekPlans && typeof saved.weekPlans === 'object' && !Array.isArray(saved.weekPlans)
      ? saved.weekPlans : {[String(state.week)]:{published:saved.published === true,changes:Number(saved.changes) || 0}};
    state.weekPlans = Object.fromEntries(Object.entries(state.weekPlans).map(([key,plan]) => [key,plan && Array.isArray(plan.baseline) ? {...plan,baseline:plan.baseline.map(restoredDescription)} : plan]));
    if(priorAnchor!==anchor)state.weekPlans=Object.fromEntries(Object.entries(state.weekPlans).map(([key,plan])=>[String(Number(key)+Math.round((date(priorAnchor)-date(anchor))/604800000)),plan]));
    state.calendarAnchor=anchor;
    state.demoSession = validDemoSession(saved.demoSession) ? clone(saved.demoSession) : null;
    state.checklistProgress = Checklist?.sanitize(saved.checklistProgress) || {};
    state.role = saved.role === 'employee' ? 'employee' : 'admin';
    state.employeePerson = staff.some(person => person.id === saved.employeePerson) ? saved.employeePerson : 'p0';
    state.employeeWeek = Actions.validDate(saved.employeeWeek) ? staffingMonday(saved.employeeWeek) : dates()[0];
    const employeeCalendarCurrent = saved.employeeCalendarVersion === 1;
    const legacyShift = typeof saved.employeeShift === 'string' ? shiftById(saved.employeeShift) : null;
    state.employeeView = employeeCalendarCurrent && ['month','week','day'].includes(saved.employeeView) ? saved.employeeView : 'month';
    const employeeDate = employeeCalendarCurrent ? saved.employeeDate : legacyShift?.date || state.employeeWeek;
    state.employeeDate = validEmployeeDate(employeeDate) ? employeeDate : validEmployeeDate(state.employeeWeek) ? state.employeeWeek : dates()[0];
    state.employeeWeek = staffingMonday(state.employeeDate); state.employeeCalendarVersion = 1;
    state.employeeShift = employeeCalendarCurrent && typeof saved.employeeShift === 'string' ? saved.employeeShift : null;
    state.employeeExamplesVersion = saved.employeeExamplesVersion === 1 ? 1 : 0;
    state.demoReturnPage = ['schedule','people','leave','hours','series','accounts'].includes(saved.demoReturnPage) ? saved.demoReturnPage : 'schedule';
    if(saved.page==='worksite'){
      state.page='schedule';state.view='week';state.departmentId='all';state.search='';state.onlyOpen=false;state.pageIndex=0;
      if(validEmployeeDate(saved.worksiteDate)){state.week=Math.floor((date(saved.worksiteDate)-date(anchor))/604800000);state.day=(date(saved.worksiteDate).getUTCDay()+6)%7;}
      state.site=Number.isInteger(saved.worksiteSite)&&sites[saved.worksiteSite]?String(saved.worksiteSite):'all';
    }
  }
  function occurrenceAnchor(id, seriesId) {
    const prefix = seriesId + '@'; return typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : null;
  }
  function migrateLegacyJonas() {
    const recognized = new Set(Engine.enumerate(initialSeries).map(shift => 'p0-' + shift.date));
    const migrate = id => recognized.has(id) ? initialSeries.id + '@' + id.slice(3) : id;
    const edits = {};
    Object.entries(state.edits).forEach(([id, shift]) => { const nextId = migrate(id); edits[nextId] = {...shift,id:nextId,...(nextId !== id ? {seriesId:initialSeries.id} : {})}; });
    state.edits = edits; state.deleted = [...new Set(state.deleted.map(migrate))];
  }
  function seededShifts(from, to) {
    if(PlanData)return PlanData.seededShifts(from,to,state);
    const result = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const index = (date(day).getUTCDay() + 6) % 7;
      staff.forEach((person, i) => {
        if (i === 0) return;
        const workdays = i === 2 ? [0,1,3,4,5] : i === 3 ? [0,2,4] : i === 4 ? [0,1,3,4] : [0,1,2,3,4];
        if (!workdays.includes(index) || (person.id === 'p6' && day === leaLeaveDate)) return;
        let start = i === 4 ? '16:00' : i % 3 === 1 ? '06:00' : i % 3 === 2 ? '07:00' : '08:00';
        let end = i === 4 ? '21:00' : i % 3 === 1 ? '13:00' : i % 3 === 2 ? '14:00' : '15:00';
        if (index === 5) { start = '09:00'; end = '13:00'; }
        result.push({id:person.id + '-' + day,person:person.id,date:day,site:person.site,start,end,note:'',...(state.employeeExamplesVersion === 1 ? employeeInstructions(person.site) : {})});
      });
      if (index === 2) result.push({id:'open-' + day,person:'',date:day,site:1,start:'07:00',end:'14:00',note:''});
    }
    return result;
  }
  function shiftsInRange(from, to, data = state) {
    if(realEmployee())return (employeeData?.shifts||[]).filter(shift=>shift.date>=from&&shift.date<=to);
    if(state.role==='employee'&&data===state)return Publication.publishedShifts(state).filter(shift=>shift.date>=from&&shift.date<=to);
    if(PlanData)return PlanData.shiftsInRange(from,to,data);
    const length = (date(to) - date(from)) / 86400000 + 1;
    if (!Number.isFinite(length) || length < 1 || length > 366) throw new RangeError('Vælg højst 366 kalenderdage ad gangen.');
    const deleted = new Set(data.deleted), map = new Map();
    seededShifts(from, to).forEach(shift => { if (!deleted.has(shift.id)) map.set(shift.id, shift); });
    data.series.forEach(series => Engine.enumerate(series, {from,to}).forEach(shift => { if (!deleted.has(shift.id)) map.set(shift.id, shift); }));
    Object.values(data.edits).forEach(shift => {
      map.delete(shift.id);
      if (shift.date >= from && shift.date <= to && !deleted.has(shift.id)) map.set(shift.id, shift);
    });
    return [...map.values()];
  }
  function shifts() { const ds = dates(); return shiftsInRange(ds[0], ds[6]); }
  function seriesOccurrences(series, data = state, range = seriesOperationRange(series)) {
    const map = new Map(Engine.enumerate(series,range).map(shift => [shift.id, shift]));
    Object.values(data.edits).forEach(shift => { if (map.has(shift.id) && (!shift.seriesId || shift.seriesId === series.id)) map.set(shift.id, shift); });
    return [...map.values()].filter(shift => !data.deleted.includes(shift.id)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function snapshot() { return clone({demoSeed:state.demoSeed!==false,series:state.series,edits:state.edits,deleted:state.deleted,weekPlans:state.weekPlans,requests:state.requests,leaveDecisions:state.leaveDecisions,coverageRules:state.coverageRules,checklistProgress:state.checklistProgress}); }
  function affectedSeriesRanges(source, scope) {
    const cutoff = editorCutoff(source,scope);
    const working=Engine.requiresRange(source)?Engine.operationRange(source,{today,from:[cutoff||source.startDate,today].sort().at(-1)}):{from:cutoff||source.startDate,to:source.endDate};
    const ranges = [[working.from,working.to]];
    if(Engine.requiresRange(source)){const visible=visiblePlanningRange(),from=[visible.from,cutoff||source.startDate].sort().at(-1),to=[visible.to,source.endDate].sort()[0];if(from<=to)ranges.push([from,to]);}
    Object.values(state.edits).forEach(shift => {
      const anchorDate = occurrenceAnchor(shift.id,source.id);
      if (anchorDate && (!cutoff || anchorDate >= cutoff)) ranges.push([shift.date,shift.date]);
    });
    return ranges;
  }
  function clearSeriesExceptions(data, id, from = null) {
    const affected = key => { const day = occurrenceAnchor(key, id); return day && (!from || day >= from); };
    Object.keys(data.edits).forEach(key => { if (affected(key)) delete data.edits[key]; });
    data.deleted = data.deleted.filter(key => !affected(key));
  }
  function markChanged(ranges = [[dates()[0],dates()[6]]]) {
    const keys = new Set([...Object.keys(state.weekPlans), String(state.week)]);
    ranges.forEach(([from,to]) => {
      const first = Math.max(-52,Math.floor((date(from) - date(anchor)) / 604800000));
      const last = Math.min(52,Math.floor((date(to) - date(anchor)) / 604800000));
      for (let week = first; week <= last; week += 1) keys.add(String(week));
    });
    keys.forEach(key => {
      const first = addDays(anchor, Number(key) * 7), last = addDays(first, 6);
      if (!ranges.some(([from,to]) => first <= to && last >= from)) return;
      const plan = state.weekPlans[key] || (state.weekPlans[key] = {published:false,changes:0}); plan.published = false; plan.changes += 1;
    });
  }
  function commit(data, message, ranges = [[dates()[0],dates()[6]]]) {
    closeOperationsSheets();
    ensureRangeBaselines(ranges);
    lastUndo = snapshot();
    const priorAssignments = ranges.flatMap(([from,to]) => shiftsInRange(from,to));
    Object.entries(state.weekPlans).forEach(([key,plan]) => {
      if (Array.isArray(plan.baseline) && !data.weekPlans[key]?.baseline) data.weekPlans[key] = {...plan,...data.weekPlans[key],baseline:clone(plan.baseline),baselineKind:plan.baselineKind};
    });
    clearSelection(false); Object.assign(state,data);
    if (Checklist) { const current = ranges.flatMap(([from,to]) => shiftsInRange(from,to)), ids = new Set(current.map(shift => shift.id)); state.checklistProgress = Checklist.reconcile(state.checklistProgress,current.filter(shift=>!Instructions?.isDeferred(shift)),{deletedIds:priorAssignments.filter(shift => !ids.has(shift.id)).map(shift => shift.id)}); }
    markChanged(ranges); render(); closeEditor({force:true}); closeGroupEditor(); closeBulkEditor(); closeChanges(false); return savedFeedback(message);
  }
  function undoPlanning(){
    if(!lastUndo)return false;
    const changes=PlanningRecords?.diff(state,lastUndo)||[],seriesChange=changes.find(change=>change.kind==='series');
    if(seriesChange&&hasWindowLoading()&&persistence.isPartial){const source=state.series.find(series=>series.id===seriesChange.id)||lastUndo.series.find(series=>series.id===seriesChange.id),projection=seriesProjection(source);if(!scopeLoaded(projection))return withPlanningScope(projection,undoPlanning,'undo');}
    const selection=detailSelection(changes.filter(change=>change.kind==='shift').map(change=>change.id),changes.filter(change=>change.kind==='series').map(change=>change.id));
    if(needsPlannerDetails(selection))return withPlannerDetails(selection,undoPlanning);
    closeOperationsSheets();clearSelection(false);closeBulkEditor(false);closeChanges(false);
    const previous=clone(lastUndo);previous.series=restoredSeriesMetadata(previous.series,state.series);previous.edits=restoredPauseEdits(previous.edits,state.edits);lastUndo=null;Object.assign(state,previous);render();closeEditor({force:true});closeGroupEditor(false);closeReview();const saved=savedFeedback('Seneste ændring er fortrudt.');releasePlanningHold('undo');return saved;
  }
  function approvedLeaveDates() {
    return leaveRequests.filter(request => (state.requests[request.id] || request.status) === 'approved')
      .flatMap(request => request.days.map(day => ({person:request.p,date:day})));
  }
  function leaveDateIndex(entries=approvedLeaveDates()){
    const index=new Map();for(const item of entries){if(!index.has(item.person))index.set(item.person,new Set());index.get(item.person).add(item.date);}return index;
  }
  function proposalError(proposed, data) {
    if (!proposed.length) return 'Perioden og ugedagene giver ingen vagter.';
    const blocked = approvedLeaveDates(), leave = proposed.find(shift => blocked.some(item => item.person === shift.person && Engine.shiftDates(shift).includes(item.date)));
    if (leave) return personName(leave.person) + ' har godkendt fravær den ' + shortDate(leave.date) + '. Ingen vagter er gemt.';
    const existing=conflictShiftsForWeeks(proposed.map(shift=>staffingMonday(shift.date)),data);
    const overlaps = [...Engine.conflicts(proposed, existing, proposed.map(shift => shift.id)),...Engine.conflicts(proposed,proposed)];
    if (!overlaps.length) return null;
    const days = [...new Set(overlaps.map(conflict => conflict.shift.date))];
    return 'Overlap for ' + personName(overlaps[0].shift.person) + ' den ' + days.slice(0,3).map(shortDate).join(', ') + (days.length > 3 ? ' og ' + (days.length - 3) + ' andre datoer' : '') + '. Ingen ændringer er gemt.';
  }
  function personHours(id) { return shifts().filter(shift => shift.person === id).reduce((sum, shift) => sum + duration(shift), 0); }
  function filteredStaff(includeAssignments = false) {
    const term = searchTerm();
    const assigned = new Set(includeAssignments ? shifts().filter(shift => shift.site === Number(state.site)).map(shift => shift.person) : []);
    return staff.filter(person => person.name.toLocaleLowerCase('da-DK').includes(term) && (state.site === 'all' || person.site === Number(state.site) || assigned.has(person.id)));
  }
  function filteredShifts(dayOnly = false) {
    const term = searchTerm();
    return shifts().filter(shift => visibleSite(shift.site)
      && (!term || personFor(shift.person)?.name.toLocaleLowerCase('da-DK').includes(term))
      && (!state.onlyOpen || !shift.person)
      && (!dayOnly || shift.date === selectedDate()));
  }
  function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function icon(name) {
    const shapes = {
      'calendar-days': [
        ['rect', {x:3,y:5,width:18,height:16,rx:2}],
        ['path', {d:'M8 3v4M16 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01'}]
      ],
      'calendar-range': [
        ['rect', {x:3,y:5,width:18,height:16,rx:2}],
        ['path', {d:'M8 3v4M16 3v4M3 11h18M7 16h10M7 16h.01M17 16h.01'}]
      ],
      'calendar-off': [
        ['rect', {x:3,y:5,width:18,height:16,rx:2}],
        ['path', {d:'M8 3v4M16 3v4M3 11h18M2 2l20 20'}]
      ],
      'repeat-2': [
        ['path', {d:'M4 10V8a3 3 0 0 1 3-3h13M16 1l4 4-4 4M20 14v2a3 3 0 0 1-3 3H4M8 15l-4 4 4 4'}]
      ],
      'file-text': [['path', {d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h6'}]],
      'users-round': [
        ['circle', {cx:9,cy:8,r:3}],
        ['path', {d:'M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M20 21v-2a6 6 0 0 0-3-5.2'}]
      ],
      'user-round-plus': [
        ['circle', {cx:9,cy:7,r:4}],
        ['path', {d:'M2 21v-2a7 7 0 0 1 12-4.9M19 12v8M15 16h8'}]
      ],
      'clock-3': [
        ['circle', {cx:12,cy:12,r:9}],
        ['path', {d:'M12 7v5l3 2'}]
      ],
      'list-checks': [
        ['path', {d:'M3 6l1.5 1.5L7 4M10 6h11M3 13l1.5 1.5L7 11M10 13h11M3 20l1.5 1.5L7 18M10 20h11'}]
      ],
      'settings': [
        ['path', {d:'m10 3-.6 2.5-1.6.9-2.5-.7-2 3.5 1.9 1.8v2l-1.9 1.8 2 3.5 2.5-.7 1.6.9.6 2.5h4l.6-2.5 1.6-.9 2.5.7 2-3.5-1.9-1.8v-2l1.9-1.8-2-3.5-2.5.7-1.6-.9L14 3z'}],
        ['circle', {cx:12,cy:12,r:3}]
      ],
      'shield-check': [['path', {d:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11ZM9 12l2 2 4-4'}]],
      'history': [['path', {d:'M3 12a9 9 0 1 1 2.6 6.4M3 5v7h7m2-5v5l3 2'}]],
      'wallet': [['path', {d:'M20 8V5H6a3 3 0 0 0 0 6h14v9H6a3 3 0 0 1-3-3V8m17 4h-5v5h5m-3-2.5h.01'}]],
      'arrow-left-right': [['path', {d:'M4 7h16M8 3 4 7l4 4m12 6H4m12-4 4 4-4 4'}]],
      'messages-square': [['path', {d:'M3 4h15v11H8l-5 4V4Zm17 4h2v11h-4l-3 3v-3h-4v-2'}]],
      'user-round': [
        ['circle', {cx:12,cy:8,r:4}],
        ['path', {d:'M4 21v-1a8 8 0 0 1 16 0v1'}]
      ],
      'bell': [['path', {d:'M18 8a6 6 0 0 0-12 0c0 6-3 7-3 9h18c0-2-3-3-3-9Zm-8 12a2 2 0 0 0 4 0'}]],
      'check': [['path', {d:'M5 12l4 4L19 6'}]],
      'plus': [['path', {d:'M12 5v14M5 12h14'}]],
      'chevron-left': [['path', {d:'M15 18l-6-6 6-6'}]],
      'chevron-right': [['path', {d:'M9 6l6 6-6 6'}]],
      'search': [
        ['circle', {cx:10.5,cy:10.5,r:7}],
        ['path', {d:'M16 16l5 5'}]
      ],
      'circle-alert': [
        ['circle', {cx:12,cy:12,r:9}],
        ['path', {d:'M12 7v6M12 17h.01'}]
      ],
      'building-2': [
        ['rect', {x:3,y:3,width:12,height:18,rx:1}],
        ['path', {d:'M15 9h6v12M7 7h.01M11 7h.01M7 11h.01M11 11h.01M7 15h.01M11 15h.01M8 21v-3h3v3M18 13h.01M18 17h.01'}]
      ],
      'circle-check': [
        ['circle', {cx:12,cy:12,r:9}],
        ['path', {d:'M8 12l3 3 5-6'}]
      ],
      'x': [['path', {d:'M6 6l12 12M6 18L18 6'}]],
      'trash-2': [
        ['path', {d:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'}]
      ]
    };
    const namespace = 'http://www.w3.org/2000/svg';
    const element = document.createElementNS(namespace, 'svg');
    const attributes = {viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false','data-lucide':name};
    Object.entries(attributes).forEach(([key,value]) => element.setAttribute(key, String(value)));
    const fallback = [['circle', {cx:12,cy:12,r:9}], ['path', {d:'M12 8v5M12 17h.01'}]];
    (shapes[name] || fallback).forEach(([tag,values]) => {
      const shape = document.createElementNS(namespace, tag);
      Object.entries(values).forEach(([key,value]) => shape.setAttribute(key, String(value)));
      element.append(shape);
    });
    return element;
  }
  function resetFilters() {
    state.search = ''; state.site = 'all'; state.onlyOpen = false; state.pageIndex = 0;
    q('#cs-search').value = ''; q('#cs-site-filter').value = 'all';
    render(); q('#cs-search').focus({preventScroll:true}); save();
  }
  function emptyState(message) {
    const empty = node('div', 'cs-zero');
    empty.append(node('p', null, message));
    const reset = node('button', 'cs-button cursor-interaction', 'Nulstil filtre'); reset.type = 'button'; reset.addEventListener('click', resetFilters);
    empty.append(reset); return empty;
  }
  function personCell(person, showHours = true) {
    const line = node('div', 'cs-person-row');
    if (design.showAvatars) line.append(node('span', 'cs-avatar', person.initials));
    const copy = node('div'); copy.append(node('div', 'cs-person-name', person.name));
    const hours = personHours(person.id);
    copy.append(node('div', 'cs-person-hours' + (showHours && hours > person.target ? ' cs-hour-over' : ''), showHours ? niceHours(hours) + ' / ' + person.target + ' t' : person.role));
    line.append(copy); return line;
  }
  function describeShift(shift) { return personName(shift.person) + ', ' + fullDate(shift.date) + ', ' + clockLabel(shift,' til ') + ', ' + sites[shift.site].name + (shift.plannedBreakMinutes?'. Planlagt pause '+shift.plannedBreakMinutes+' minutter':'') + ((shift.note || shift.noteRich || shift._instructions?.hasDescription) ? '. Har beskrivelse' : '') + (shift.seriesId ? '. Del af en vagtserie' : ''); }
  function descriptionIndicator() {
    const marker = node('span','cs-description-indicator'); marker.append(icon('file-text'));
    marker.setAttribute('aria-hidden','true'); return marker;
  }
  function prepareShiftButton(button, shift) {
    button.type = 'button'; button.dataset.shift = shift.id; button.dataset.selected = String(activeEdit?.id === shift.id);
    button.style.setProperty('--cs-shift-color', sites[shift.site].color);
    const description=describeShift(shift);
    button.setAttribute('aria-label', description); button.dataset.tooltip=description;
    button.addEventListener('click', () => openEditor(shift, button)); return button;
  }
  function shiftCard(shift) {
    const button = prepareShiftButton(node('button', 'cs-shift cursor-interaction' + (!shift.person ? ' cs-open-shift' : '')), shift);
    button.append(node('span', 'cs-shift-time', clockLabel(shift)));
    const meta = node('span', 'cs-shift-site', !shift.person ? 'Ledig vagt' : state.group === 'sites' ? personName(shift.person).split(' ')[0] : sites[shift.site].name);
    if (shift.seriesId) { const marker = node('span', 'cs-series-indicator'); marker.append(icon('repeat-2')); marker.setAttribute('aria-label', 'Del af en vagtserie'); meta.append(marker); }
    if (shift.note || shift.noteRich || shift._instructions?.hasDescription) meta.append(descriptionIndicator());
    button.append(meta);
    return button;
  }
  function emptyCell(person, day, site) {
    const button = node('button', 'cs-empty-cell cursor-interaction'); button.type = 'button';
    button.setAttribute('aria-label', 'Opret vagt ' + fullDate(day) + (person ? ' til ' + personName(person) : ''));
    button.append(icon('plus'));
    button.addEventListener('click', () => openEditor({person:person || '',date:day,site:site ?? 0,start:'07:00',end:'14:00',note:''}, button)); return button;
  }
  function scheduleIssues(all) {
    const issues = new Map();
    Engine.conflicts(all,all).forEach(({shift,other}) => {
      if (!issues.has(shift.id)) issues.set(shift.id,{kind:'overlap',label:'Overlap',detail:personName(shift.person) + ' har også en vagt ' + clockLabel(other) + ' på ' + (sites[other.site]?.name || 'et andet arbejdssted') + ' den ' + shortDate(shift.date)});
    });
    const blocked = leaveDateIndex();
    all.forEach(shift => { if (shift.person && Engine.shiftDates(shift).some(day=>blocked.get(shift.person)?.has(day))) issues.set(shift.id,{kind:'leave',label:'Godkendt fravær',detail:personName(shift.person) + ' har godkendt fravær den ' + shortDate(shift.date)}); });
    const reader=availabilityReader();
    all.forEach(shift=>{const unavailable=shift.person&&planningWorkedDays(shift).find(day=>reader?.isUnavailable(shift.person,day));if(!issues.has(shift.id)&&unavailable)issues.set(shift.id,{kind:'unavailable',label:'Utilgængelig',detail:personName(shift.person)+' har markeret sig utilgængelig den '+shortDate(unavailable)});});
    return issues;
  }
  function renderWeek() {
    const [from] = calendarRange(), term = searchTerm(), complete = loadedCalendarWeeks().flatMap(day=>shiftsInRange(day,addDays(day,6)));
    const issueContext=new Map((persistence?.availability?.draft||[]).map(shift=>[shift.id,shift]));for(const shift of complete)issueContext.set(shift.id,shift);for(const shift of Object.values(state.edits||{}))if(issueContext.has(shift.id))issueContext.set(shift.id,shift);for(const id of state.deleted||[])issueContext.delete(id);const issues=scheduleIssues([...issueContext.values()]);
    requestPlanningAvailability(complete,complete.map(shift=>shift.person),true);
    const plannedByWeek=new Map(),plannedByDay=new Map(),planningPool=new Map((persistence?.availability?.draft||[]).map(shift=>[shift.id,shift]));
    for(const shift of complete)planningPool.set(shift.id,shift);for(const shift of Object.values(state.edits||{}))if(planningPool.has(shift.id))planningPool.set(shift.id,shift);for(const id of state.deleted||[])planningPool.delete(id);
    for(const shift of [...planningPool.values()].filter(shift=>visibleSite(shift.site))){
      for(const week of new Set(Engine.shiftDates(shift).map(staffingMonday)))plannedByWeek.set(week,(plannedByWeek.get(week)??0)+Engine.plannedMinutesInRange(shift,week,addDays(week,6)));
      if(shift.person)for(const day of Engine.shiftDates(shift))plannedByDay.set(day,(plannedByDay.get(day)??0)+Engine.plannedMinutesInRange(shift,day,day));
    }
    const {budget:configuredBudget,label:scopeLabel}=calendarBudgetArea();
    const weeklyMaximum=Roster.validWorkHoursBudget(configuredBudget)&&configuredBudget.period==='week'?configuredBudget.hours:null;
    const all = complete.filter(shift => visibleSite(shift.site)
      && (!term || personName(shift.person).toLocaleLowerCase('da-DK').includes(term)) && (!state.onlyOpen || !shift.person));
    const options = {from,weeks:calendarWeeks(),zoom:state.zoom,today,selectedDate:selectedDate(),shifts:all,personName,sites,
      weekHours:week=>({plannedMinutes:plannedByWeek.get(week)??0,budgetHours:weeklyMaximum,scopeLabel}),dayHours:day=>plannedByDay.get(day)??0,
      weekCost:planningWeekCost,onOpenWeekCost:openPlanningWeekCost,
      onOpen:(shift,button) => openEditor(shift,button),
      onCreate:(day,button) => { const site = defaultShiftSite(); if (site === undefined) { departmentView?.openManager(state.departmentId); return; } openEditor({person:'',date:day,site,start:'07:00',end:'14:00',note:''},button); },
      onDay:day => { state.view = 'day'; navigateTo(day); },
      onEditGroup:openGroupEditor,onMovePreview:previewMove,onMoveRejected:reason => notify(reason),
      selectedIds,selectionMode,onSelect:selectShift,changedIds:calendarChangedIds(),issueFor:shift => issues.get(shift.id),
      onMove:moveShift,onExpand:() => {plannerViewport.restore=false;render();},
      ...(usesViewportCalendar()?{weekState:calendarWeekState,onVisibleWeeks:acceptVisibleWeeks,onWeekRetry:retryCalendarWeek,viewportKey:viewportKey()}:{})
    };
    let board=calendarViewportBoard;
    if(!board?.element?.isConnected||!board.update?.(options)){
      calendarDispose?.();board=globalThis.CleanRoomsCalendar.render(options);
      q('#cs-page-content').replaceChildren(board.element);calendarDispose=board.dispose;calendarViewportBoard=board;
    }
    visibleCount = all.length; visibleShifts = all;
    syncPlanningCosts();
  }
  function previewMove(shift, targetDate) {
    const min = addDays(anchor,-364), max = addDays(anchor,370);
    const current = Actions.validDate(shift?.date) ? shiftsInRange(shift.date,shift.date).find(item => item.id === shift.id) : null;
    const existing = Actions.validDate(targetDate) && targetDate >= min && targetDate <= max ? conflictShiftsForWeeks([staffingMonday(targetDate)]) : [];
    const result=Actions.planMove({shift,current,targetDate,existing,minDate:min,maxDate:max,blockedDates:approvedLeaveDates(),personName});
    if(result.allowed&&result.proposed?.person){requestPlanningAvailability([result.proposed],[result.proposed.person]);const unavailable=unavailableDatesFor(result.proposed.person,[result.proposed]);if(unavailable.length)return {...result,reason:personName(result.proposed.person)+' er utilgængelig den '+shortDate(unavailable[0])+'. Flyt alligevel.'};}
    return result;
  }
  function moveShift(shift, targetDate) {
    if(hasWindowLoading()&&persistence.isPartial&&!planningRangeLoaded(staffingMonday(targetDate),addDays(staffingMonday(targetDate),6)))return withPlanningDates([shift.date,targetDate],()=>moveShift(shift,targetDate));
    const selection=detailSelection([shift]);
    if(needsPlannerDetails(selection))return withPlannerDetails(selection,()=>{if(shiftById(shift.id))return moveShift(shift,targetDate);notify('Vagten findes ikke længere.');return false;});
    const proposal = previewMove(shift,targetDate);
    if (!proposal.allowed) { if (proposal.status !== 'same') notify(proposal.reason); return false; }
    const next = proposal.proposed, data = snapshot(); data.edits[next.id] = next;
    const [from,to] = calendarRange();
    if (targetDate < from || targetDate > to) state.week = Math.floor((date(targetDate) - date(anchor)) / 604800000);
    commit(data,personName(next.person) + ' er flyttet til ' + shortDate(targetDate) + ' · ' + clockLabel(next) + (next.seriesId ? '. Kun denne vagt er ændret.' : '.'),[[shift.date,shift.date],[next.date,next.date]]);
    return true;
  }
  function agendaRow(shift) {
    const button = prepareShiftButton(node('button', 'cs-agenda-row cursor-interaction' + (!shift.person ? ' cs-agenda-open' : '')), shift);
    const avatar = node('span', 'cs-agenda-avatar', personFor(shift.person)?.initials || ''); avatar.setAttribute('aria-hidden', 'true');
    if (!shift.person) avatar.append(icon('user-round-plus'));
    avatar.style.visibility = design.showAvatars ? 'visible' : 'hidden';
    const copy = node('span', 'cs-agenda-copy'), site = node('span', 'cs-agenda-site', sites[shift.site].name);
    if (shift.seriesId) { const marker = node('span', 'cs-series-indicator'); marker.append(icon('repeat-2')); marker.setAttribute('aria-label', 'Del af en vagtserie'); site.append(marker); }
    if (shift.note || shift.noteRich || shift._instructions?.hasDescription) site.append(descriptionIndicator());
    copy.append(node('span', 'cs-agenda-name', personName(shift.person)), site);
    button.append(avatar, copy, node('span', 'cs-agenda-time', clockLabel(shift))); return button;
  }
  function renderDay() {
    const all = filteredShifts(true).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || personName(a.person).localeCompare(personName(b.person), 'da-DK'));
    visibleCount = all.length; visibleShifts = all;
    const agenda = node('div', 'cs-agenda'); agenda.setAttribute('role', 'region'); agenda.setAttribute('aria-label', 'Vagter ' + fullDate(selectedDate()));
    if (!all.length) agenda.append(emptyState(state.onlyOpen ? 'Ingen ledige vagter denne dag med de valgte filtre.' : hasFilters() ? 'Ingen vagter matcher dine filtre denne dag.' : 'Ingen vagter denne dag. Vælg en anden dag eller opret en vagt.'));
    else if (state.group === 'sites') {
      sites.forEach((site, index) => {
        const items = all.filter(shift => shift.site === index); if (!items.length) return;
        const group = node('section', 'cs-agenda-group'); group.setAttribute('aria-label', site.name);
        const heading = node('h3', 'cs-agenda-heading', site.name + ' · ' + items.length + (items.length === 1 ? ' vagt' : ' vagter')); group.append(heading);
        items.forEach(shift => group.append(agendaRow(shift))); agenda.append(group);
      });
    } else all.forEach(shift => agenda.append(agendaRow(shift)));
    q('#cs-page-content').replaceChildren(agenda);
  }
  function renderDayStrip() {
    const strip = q('#cs-day-strip'); strip.replaceChildren();
    dates().forEach((day, index) => {
      const button = node('button', 'cs-day-button cursor-interaction' + (day === today ? ' is-today' : '') + (index === state.day ? ' is-selected' : ''));
      button.type = 'button'; button.setAttribute('aria-label', fullDate(day)); button.setAttribute('aria-pressed', String(index === state.day)); button.dataset.day = String(index);
      button.append(node('span', 'cs-day-name', weekday[date(day).getUTCDay()]), node('span', 'cs-day-date', String(date(day).getUTCDate())));
      button.addEventListener('click', () => { state.day = index; render(); q('#cs-day-strip [data-day="' + index + '"]')?.focus({preventScroll:true}); save(); }); strip.append(button);
    });
  }
  function listTable(headers) {
    const wrap = node('div', 'cs-table-wrap cs-secondary-page'), table = node('table', 'cs-list'); table.style.minWidth = '550px';
    const head = node('thead'), tr = node('tr'); headers.forEach(label => { const th = node('th', null, label); th.scope = 'col'; tr.append(th); }); head.append(tr); table.append(head);
    const body = node('tbody'); table.append(body); wrap.append(table); return {wrap,body};
  }
  function adminSurface(content, title, caption, total) {
    const surface = node('section','cs-admin-surface'), head = node('header','cs-admin-surface-head'), copy = node('div','cs-admin-surface-title');
    surface.setAttribute('aria-label',title); copy.append(node('h3','cs-admin-heading',title),node('p','cs-admin-caption',caption));
    head.append(copy,node('span','cs-admin-total',total)); const body = node('div','cs-admin-surface-body'); body.append(content); surface.append(head,body);
    q('#cs-page-content').replaceChildren(surface);
  }
  function labelAdminRow(row, headers) { [...row.children].forEach((cell,index) => { cell.dataset.label = headers[index]; }); return row; }
  function pageOf(people) { visibleCount = people.length; state.pageIndex = Math.min(state.pageIndex, Math.max(0, Math.ceil(people.length / pageSize) - 1)); return people.slice(state.pageIndex * pageSize, (state.pageIndex + 1) * pageSize); }
  function renderPeople() {
    const people = filteredStaff(), visible = pageOf(people);
    const title = 'Medarbejderoversigt', caption = 'Arbejdssteder, funktioner og aftalte timer.', total = people.length + (people.length === 1 ? ' medarbejder' : ' medarbejdere');
    if (!people.length) { adminSurface(emptyState('Ingen medarbejdere matcher dine filtre.'),title,caption,total); return; }
    const headers = ['Medarbejder','Arbejdssted','Aftalt pr. uge','Funktion'], result = listTable(headers);
    visible.forEach(person => {
      const tr = node('tr','cs-admin-row'), name = node('td','cs-admin-person-cell'), identity = personCell(person,false); identity.querySelector('.cs-person-hours')?.remove(); name.append(identity); const site = node('td','cs-admin-site-cell'), tag = node('span', 'cs-tag'), dot = node('span', 'cs-site-dot');
      tr.dataset.personId = person.id;
      dot.style.setProperty('--cs-shift-color', sites[person.site].color); tag.append(dot, document.createTextNode(sites[person.site].name)); site.append(tag);
      tr.append(name, site, node('td', 'cs-number cs-admin-target-cell', person.target + ' t'), node('td','cs-admin-role-cell',person.role)); result.body.append(labelAdminRow(tr,headers));
    });
    adminSurface(result.wrap,title,caption,total);
  }
  function clearTimekeeping(){
    timeEpoch++;timeLoadedKey='';timeLoadingKey='';timeRequest=null;timeBusy=false;timeDemoEmployee=false;timeFocus=null;timeLastRead=0;timePageCache.clear();if(timeFilterTimer)clearTimeout(timeFilterTimer);timeFilterTimer=null;timeFilterWaiters.splice(0).forEach(resolve=>resolve(false));timePaging.context='';timePaging.filter={queue:'all',search:'',scope:'real'};resetTimePaging();delete timeState.summary;delete timeState.serverFilter;delete timeState.pagination;delete timeState.filterKey;
    timeView?.destroy?.();timeView=null;timeElement=null;
    Object.assign(timeState,{entries:[],shifts:[],plannedRows:[],demo:{active:false},loading:false,error:'',canManage:false,canViewPayroll:false});
  }
  function timeRange(){
    if(state.role==='employee'){
      if(timeDemoEmployee&&Actions.validDate(timeState.demo.from)&&Actions.validDate(timeState.demo.to))return {from:timeState.demo.from,to:timeState.demo.to};
      const range=EmployeeCalendar.range(state.employeeView||'month',state.employeeDate||currentEmployeeDate());return {from:range.from,to:range.to};
    }
    if(timeFocus)return {from:timeFocus.from,to:timeFocus.to};
    return {from:dates()[0],to:dates()[6]};
  }
  function timeContextKey(range=timeRange()){return JSON.stringify([chatWorkspaceId,range.from,range.to,state.role==='employee'?state.employeePerson:'all',timeDemoEmployee,sessionViewer?.userId,sessionViewer?.version,sessionViewer?.memberVersion,sessionViewer?.roleVersion,sessionViewer?.accessScope,timeFocus,Boolean(cloudCapabilities.viewPayroll)]);}
  function timeKey(range=timeRange(),page=timePaging.page){return JSON.stringify([timeContextKey(range),...(state.role==='employee'?[]:[timePaging.filter,page])]);}
  function resetTimePaging(){timePaging.page=0;timePaging.cursors=[null];timePaging.offsets=[0];timePaging.nextCursor=null;timePaging.generation=null;}
  function changeTimeFilter(filter){
    if(timeBusy)return Promise.resolve(false);
    const next={queue:['all','attention','ready','progress','approved'].includes(filter?.queue)?filter.queue:'all',search:typeof filter?.search==='string'?filter.search.slice(0,120):'',scope:filter?.scope==='demo'?'demo':'real'};
    const searchOnly=next.queue===timePaging.filter.queue&&next.scope===timePaging.filter.scope&&next.search!==timePaging.filter.search;
    if(next.scope==='demo')timeFocus=null;else if(next.queue==='approved'&&timeFocus){timeFocus={from:timeFocus.from,to:timeFocus.to};}timePaging.filter=next;resetTimePaging();timeLoadedKey='';clearTimeout(timeFilterTimer);
    // Supersede old filter reads immediately; the latest search is sent once.
    timeEpoch++;timeLoadingKey='';timeRequest=null;timeState.loading=false;
    const run=async()=>{timeFilterTimer=null;const waiters=timeFilterWaiters.splice(0),result=await loadTimekeeping();waiters.forEach(resolve=>resolve(result));return result;};
    if(!searchOnly)return run();
    return new Promise(resolve=>{timeFilterWaiters.push(resolve);timeFilterTimer=setTimeout(()=>void run(),180);});
  }
  function changeTimePage(direction){
    if(!['next','previous'].includes(direction))return Promise.resolve(false);
    if(timeBusy||timeState.loading)return Promise.resolve(false);
    const page=timePaging.page+(direction==='next'?1:-1);
    if(page<0||direction==='next'&&!timePaging.nextCursor)return Promise.resolve(false);
    if(direction==='next'){if(page>200){timeState.error='Afgræns søgningen for at se flere registreringer.';paintTimekeeping();return Promise.resolve(false);}timePaging.cursors[page]=timePaging.nextCursor;timePaging.offsets[page]=(timePaging.offsets[timePaging.page]||0)+timeState.entries.length;}
    return loadTimekeeping(false,{page});
  }
  function paintTimekeeping(){if(state.role==='employee')renderEmployee();else if(state.page==='hours')renderHours();else if(state.page==='activity')renderActivity();}
  async function loadTimekeeping(force=false,{page:requestedPage}={}){
    if(!globalThis.CleanRoomsTimekeeping||!cloudLoaded||!sessionViewer||!persistence?.action)return false;
    const range=timeRange(),context=timeContextKey(range),server=state.role!=='employee',filterKey=JSON.stringify(timePaging.filter);
    if(timePaging.context!==context){timePaging.context=context;resetTimePaging();}
    let targetPage=server?(requestedPage??timePaging.page):0,key=timeKey(range,targetPage);
    const query={...range,...(!server?{personId:state.employeePerson}:{...timePaging.filter,...(timeFocus?.problem?{problem:timeFocus.problem}:{}),...(timeFocus?.entryId?{entryId:timeFocus.entryId}:{}),...(timeFocus?.personId?{personId:timeFocus.personId}:{}),pageSize:50,...(timePaging.cursors[targetPage]?{cursor:timePaging.cursors[targetPage]}:{})})};
    if(timeLoadingKey===key&&timeRequest)return timeRequest;
    if(!force&&timeLoadedKey===key&&Date.now()-timeLastRead<(timeState.error?5000:30000))return true;
    const cached=!force&&server?timePageCache.get(key):null;
    const epoch=++timeEpoch;timeLoadingKey=key;timeState.loading=true;timeState.error='';
    if(server){timeState.serverFilter={...timePaging.filter,...(timeFocus?.problem?{problem:timeFocus.problem}:{}),...(timeFocus?.entryId?{entryId:timeFocus.entryId}:{}),...(timeFocus?.personId?{personId:timeFocus.personId}:{})};timeState.pagination={server:true,page:timePaging.page,offset:timePaging.offsets[timePaging.page]||0,hasNext:Boolean(timePaging.nextCursor),hasPrevious:timePaging.page>0,loading:true};}
    const request=(async()=>{
      let result,usedCache=false;
      if(cached&&Date.now()-cached.at<30000&&cached.generation===timePaging.generation){result=clone(cached.result);usedCache=true;}
      else for(let attempt=0;attempt<2;attempt++){
        const first=await accountAction('timeRead',query);
        if(epoch!==timeEpoch)return false;
        if(server){
          result=first;
          const generation=JSON.stringify([first.ledgerVersion,first.planRevision,first.directoryRevision]);
          if(first.ok&&(!Array.isArray(first.entries)||first.entries.length>50||new TextEncoder().encode(JSON.stringify(first)).byteLength>8*1024*1024||typeof first.nextCursor==='string'&&first.nextCursor.length>16384))result={ok:false,status:413,message:'Serverens side med timer kunne ikke bekræftes. Opdater listen.'};
          if(attempt===0&&(first.status===409||first.ok&&targetPage>0&&timePaging.generation!==generation)){
            resetTimePaging();targetPage=0;key=timeKey(range,0);delete query.cursor;timePageCache.clear();continue;
          }
        }else{
          const allEntries=[],allShifts=new Map(),seenCursors=new Set();let current=first,size=0;
          while(current.ok&&epoch===timeEpoch){
            if(!Array.isArray(current.entries)||['ledgerVersion','planRevision','directoryRevision'].some(field=>current[field]!==first[field])){current={ok:false,status:409,message:'Timerne eller deres grundlag er ændret under indlæsningen. Opdater listen.'};break;}
            size+=new TextEncoder().encode(JSON.stringify(current)).byteLength;allEntries.push(...current.entries);
            for(const shift of current.shifts||[])if(!allShifts.has(shift.id))allShifts.set(shift.id,shift);
            if(allEntries.length>50000||size>64*1024*1024){current={ok:false,status:413,message:'Perioden indeholder for mange tidsregistreringer. Vælg en kortere periode.'};break;}
            const cursor=current.nextCursor;if(!cursor)break;
            if(typeof cursor!=='string'||seenCursors.has(cursor)){current={ok:false,status:409,message:'Registreringerne ændrede sig under indlæsningen. Opdater listen.'};break;}
            seenCursors.add(cursor);current=await accountAction('timeRead',{...query,cursor});
          }
          if(!current.ok&&current.status===409&&attempt===0)continue;
          result=current.ok?{...first,entries:allEntries,shifts:[...allShifts.values()],nextCursor:null}:current;
        }
        if(result.ok&&directory?.ready&&Number.isSafeInteger(result.directoryRevision)&&directory.catalogRevision!==result.directoryRevision){
          const catalog=await directory.loadCatalog({force:true});
          if(!catalog.ok)result={ok:false,status:catalog.status,message:catalog.message||'Medarbejderoversigten kunne ikke opdateres.'};
          else if(directory.catalogRevision!==result.directoryRevision)result={ok:false,status:409,message:'Medarbejderne er ændret under indlæsningen. Opdater timerne.'};
        }
        if(!result.ok&&result.status===409&&attempt===0)continue;
        break;
      }
      if(epoch!==timeEpoch||context!==timeContextKey())return false;
      timeState.loading=false;timeLoadingKey='';timeLoadedKey=result.ok?key:timeKey(range,timePaging.page);timeLastRead=usedCache?cached.at:Date.now();
      if(result.ok){
        if(server){
          const generation=JSON.stringify([result.ledgerVersion,result.planRevision,result.directoryRevision]);
          if(timePaging.generation!==generation||force)timePageCache.clear();
          timePaging.generation=generation;timePaging.page=targetPage;timePaging.nextCursor=result.nextCursor||null;
          timePageCache.delete(key);timePageCache.set(key,{at:usedCache?cached.at:Date.now(),generation,result:clone(result),bytes:new TextEncoder().encode(JSON.stringify(result)).byteLength});while(timePageCache.size>6||[...timePageCache.values()].reduce((total,value)=>total+value.bytes,0)>16*1024*1024)timePageCache.delete(timePageCache.keys().next().value);
        }
        if(server)timeState.filterKey=filterKey;
        if(result.summary&&(!canViewPayroll()||realEmployee())){result=clone(result);for(const value of [result.summary,...(result.summary.people||[])])for(const field of ['approvedCents','baseCents','supplementCents','approvedBaseCents','approvedSupplementCents','approvedMonthlyBaseCents','approvedMonthlySupplementCents'])delete value[field];}
        const entries=Array.isArray(result.entries)?result.entries:[];
        Object.assign(timeState,result,{entries:entries.map(entry=>{if(canViewPayroll()&&!realEmployee())return entry;const copy={...entry};delete copy.payroll;delete copy.approvalHistory;return copy;}),shifts:Array.isArray(result.shifts)?result.shifts:[],plannedRows:Array.isArray(result.plannedRows)?result.plannedRows:[],demo:result.demo||{active:false},error:'',loading:false});
      }else {if(timeState.from!==range.from||timeState.to!==range.to||server&&timeState.filterKey!==filterKey)Object.assign(timeState,{entries:[],shifts:[],plannedRows:[],summary:null});timeState.error=result.message||'Timerne kunne ikke indlæses. Prøv at hente dem igen.';}
      if(server)timeState.pagination={server:true,page:timePaging.page,offset:timePaging.offsets[timePaging.page]||0,hasNext:Boolean(timePaging.nextCursor),hasPrevious:timePaging.page>0,loading:false,totalCount:timeState.summary?.counts?.[timePaging.filter.queue]};
      else{delete timeState.pagination;delete timeState.serverFilter;delete timeState.summary;}
      paintTimekeeping();return result.ok;
    })();timeRequest=request;return request;
  }
  async function timeCommand(action,payload={}){
    if(state.role==='employee'&&payload.operation==='correct')return {ok:false,message:'Tider kan kun rettes af en planlægger. Tilføj en kommentar til vagten.'};
    if(timeBusy||!cloudLoaded)return {ok:false,message:'Vent, til den igangværende handling er færdig.'};
    if(state.role==='employee'&&!realEmployee()&&!(timeDemoEmployee&&payload.demo===true))return {ok:false,message:'Forhåndsvisningen er skrivebeskyttet. Brug eksempelugen til at prøve tidsregistrering.'};
    const commandViewer=sessionViewer,focusAtStart=timeFocus,commandContext=timeContextKey();timeBusy=true;
    try{
      const result=await accountAction(action,payload);
      if(commandViewer!==sessionViewer||!cloudLoaded)return {ok:false,status:403,superseded:true,message:'Adgangen er ændret. Åbn registreringen igen.'};
      if(result.ok&&action==='timeDemo'){
        const demo=result.demo;
        if(demo?.active&&Actions.validDate(demo.from))state.week=Math.floor((date(demo.from)-date(anchor))/604800000);
      }
      if(result.ok){
        timePageCache.clear();if(timeState.summary)timeState.summary={...timeState.summary,stale:true};if(timeState.pagination)delete timeState.pagination.totalCount;
        if(result.entry&&typeof result.entry.id==='string'&&timeContextKey()===commandContext){
          if(timeFocus&&timeFocus===focusAtStart&&action==='timeWrite'&&result.entry.date>=timeFocus.from&&result.entry.date<=timeFocus.to){
            timeFocus={...timeFocus};
            if(result.entry.status!=='approved')Object.assign(timeFocus,{problem:'unapproved',entryId:result.entry.id,personId:result.entry.personId});
            else {delete timeFocus.entryId;delete timeFocus.personId;}
            timeLoadedKey='';resetTimePaging();
          }
          const entry=clone(result.entry);if(!canViewPayroll()||realEmployee()){delete entry.payroll;delete entry.approvalHistory;}
          const index=timeState.entries.findIndex(item=>item.id===entry.id);
          timeState.entries=index<0?[...timeState.entries,entry]:timeState.entries.map(item=>item.id===entry.id?entry:item);
          for(const field of ['ledgerVersion','planRevision','directoryRevision','serverNow'])if(result[field]!==undefined)timeState[field]=result[field];
        }
        if(state.role==='employee'||action==='timeDemo'){timeLoadedKey='';await loadTimekeeping(true);}
        if(action==='timeDemo'){render();save();}
      }
      else {timeState.error=result.message||'Tidsregistreringen kunne ikke gemmes.';if(result.status===409&&state.role==='employee'){timeLoadedKey='';await loadTimekeeping(true);}}
      return result;
    }finally{timeBusy=false;paintTimekeeping();}
  }
  function openTimeDemoEmployee(personId){
    const demo=timeState.demo;if(!cloudCapabilities.plan||!demo?.active||!staff.some(person=>person.id===personId))return;
    timeDemoEmployee=true;timeLoadedKey='';state.employeePerson=personId;state.employeeDate=demo.demoClockDate||demo.clockDate||demo.from;
    state.employeeWeek=staffingMonday(state.employeeDate);state.employeeView='week';state.employeeShift=null;state.role='employee';render();save();
  }
  async function payrollPeriodAction(action,payload={}){
    if(!canViewPayroll()||cloudCapabilities.companyPayroll===false)return {ok:false,status:403,message:'Din rolle har ikke adgang til virksomhedens lønperioder.'};
    const viewer=sessionViewer;
    const result=action==='timeWrite'?await timeCommand(action,payload):await accountAction(action,payload);
    if(viewer!==sessionViewer||!canViewPayroll())return {ok:false,status:403,message:'Kontoens adgang er ændret. Åbn lønperioden igen.'};
    return result;
  }
  function clearTimeFocus({entryOnly=false}={}){
    if(!timeFocus)return Promise.resolve(false);
    if(entryOnly){timeFocus={...timeFocus};delete timeFocus.entryId;delete timeFocus.personId;}else timeFocus=null;
    timeEpoch++;timeLoadedKey='';timeLoadingKey='';timeRequest=null;timePageCache.clear();resetTimePaging();
    if(state.page==='hours')render();return loadTimekeeping(true);
  }
  async function navigatePayrollProblem(target){
    const problems=['unapproved','invalid_time','missing_payroll'];
    if(!canViewPayroll()||!target||!['hours','payroll-person'].includes(target.kind)||!Actions.validDate(target.from)||!Actions.validDate(target.to)||target.to<target.from||(date(target.to)-date(target.from))/86400000>366)return false;
    if(target.problem!==undefined&&!problems.includes(target.problem)||target.entryId!==undefined&&(typeof target.entryId!=='string'||!target.entryId||target.entryId.length>512)||target.personId!==undefined&&(typeof target.personId!=='string'||!target.personId||target.personId.length>200))return false;
    const viewer=sessionViewer,focus={from:target.from,to:target.to,...(target.problem?{problem:target.problem}:{}),...(target.entryId?{entryId:target.entryId}:{}),...(target.personId?{personId:target.personId}:{})};
    if(target.kind==='payroll-person'){
      if(!target.personId||!Actions.validDate(target.date)||target.date<target.from||target.date>target.to)return false;
      if(!await openEmployeeProfile(target.personId)||viewer!==sessionViewer||!canViewPayroll())return false;
      payrollProblemReturn={...focus,date:target.date};employeeProfileMonth=target.date.slice(0,7);payrollMonth=employeeProfileMonth;
      renderEmployeeProfile();employeeProfileView?.showPayroll?.();await loadPayroll(true);
      return viewer===sessionViewer&&employeeProfileId===target.personId&&payrollState.loaded&&!payrollState.error;
    }
    directoryProfileEpoch++;employeeDirectoryRecord=null;employeeProfileId=null;payrollProblemReturn=null;payrollProfileReturn=null;clearPayroll();clearProfileAppLogin();
    timeEpoch++;timeRequest=null;timeLoadingKey='';timeLoadedKey='';timePageCache.clear();timeFocus=focus;timePaging.filter={queue:'all',search:'',scope:'real'};resetTimePaging();state.role='admin';state.page='hours';render();
    const ok=await loadTimekeeping(true);
    return Boolean(ok&&viewer===sessionViewer&&canViewPayroll()&&state.page==='hours'&&JSON.stringify(timeFocus)===JSON.stringify(focus)&&(!focus.entryId||timeState.entries.some(entry=>entry.id===focus.entryId)));
  }
  function renderHours(){
    if(!timeElement?.isConnected){
      timeView?.destroy?.();timeElement=node('div','cs-timekeeping-host');timeElement.id='cs-timekeeping-page';q('#cs-page-content').replaceChildren(timeElement);
      timeView=globalThis.CleanRoomsTimekeepingView?.mount({element:timeElement,onAction:timeCommand,onPayrollPeriodAction:payrollPeriodAction,onPayrollPeriodChanged:()=>loadTimekeeping(true),onPayrollPeriodNavigate:navigatePayrollProblem,onClearPeriodFocus:()=>clearTimeFocus(),onCloseFocusedEntry:()=>clearTimeFocus({entryOnly:true}),onRefresh:()=>loadTimekeeping(true),onPageChange:changeTimePage,onFilterChange:changeTimeFilter,onOpenEmployee:personId=>openEmployeeProfile(personId),onOpenShift:shift=>{if(shift?.demo){openTimeDemoEmployee(shift.personId);state.employeeShift=shift.shiftId;state.employeeDate=shift.date;render();}else if(shift?.date)navigateTo(shift.date,shift.person||shift.personId);},onDemoEmployee:openTimeDemoEmployee});
    }
    loadTimekeeping();
    const current=timeLoadedKey===timeKey(),plannedByPerson=new Map((current?timeState.plannedRows:[]).map(row=>[row.personId,row.plannedMinutes]));
    const plannedRows=staff.filter(person=>person.active!==false).map(person=>({personId:person.id,name:person.name,initials:person.initials,role:person.role,target:person.target,plannedMinutes:plannedByPerson.get(person.id)||0}));
    timeView?.render({...timeState,entries:current?timeState.entries:[],shifts:current?timeState.shifts:[],people:staff,sites,...timeRange(),periodFocus:timeFocus?{...timeFocus}:null,requestedEntryId:timeFocus?.entryId||null,companyPayroll:cloudCapabilities.companyPayroll!==false,plannedRows,canManage:cloudCapabilities.plan===true&&timeState.canManage===true,canViewPayroll:canViewPayroll()&&timeState.canViewPayroll===true});
  }
  function renderLegacyHours() {
    const people = filteredStaff(), visible = pageOf(people);
    const title = 'Ugens timer', caption = 'Planlagte timer på tværs af arbejdssteder · uge ' + weekNumber(dates()[0]), total = niceHours(people.reduce((sum,person) => sum + personHours(person.id),0)) + ' t planlagt';
    if (!people.length) { adminSurface(emptyState('Ingen medarbejdere matcher dine filtre.'),title,caption,total); return; }
    const headers = ['Medarbejder','Planlagt','Aftalt pr. uge','Forskel'], result = listTable(headers);
    visible.forEach(person => {
      const tr = node('tr','cs-admin-row'), name = node('td','cs-admin-person-cell'); name.append(personCell(person, false)); const hours = personHours(person.id), difference = hours - person.target, stateName = Math.abs(difference) < .005 ? 'balanced' : difference > 0 ? 'over' : 'under';
      tr.dataset.personId = person.id;
      const planned = node('td','cs-number cs-admin-planned-cell'), meter = node('span','cs-admin-hours-meter'), fill = node('span'); fill.style.width = Math.min(100,Math.max(0,person.target > 0 ? hours / person.target * 100 : hours ? 100 : 0)) + '%'; meter.dataset.state = stateName; meter.setAttribute('aria-hidden','true'); meter.append(fill); planned.append(node('strong','cs-admin-hours-value',niceHours(hours) + ' t'),meter);
      const differenceCell = node('td','cs-number cs-admin-difference-cell'), differenceLabel = node('span','cs-admin-status' + (stateName === 'over' ? ' cs-hour-over' : ''),stateName === 'balanced' ? '0 t' : (difference > 0 ? '+' : '') + niceHours(difference) + ' t'); differenceLabel.dataset.state = stateName; differenceLabel.title = stateName === 'balanced' ? 'På ugemålet' : niceHours(Math.abs(difference)) + ' t ' + (difference > 0 ? 'over' : 'under') + ' ugemålet'; differenceLabel.append(node('span','cs-sr',stateName === 'balanced' ? ' · på ugemålet' : difference > 0 ? ' · over ugemålet' : ' · under ugemålet')); differenceCell.append(differenceLabel);
      tr.append(name,planned,node('td','cs-number cs-admin-target-cell',person.target + ' t'),differenceCell); result.body.append(labelAdminRow(tr,headers));
    });
    adminSurface(result.wrap,title,caption,total);
  }
  function leaveViewRows(){
    return leaveRequests.map(request=>({...request,name:personName(request.p),initials:personFor(request.p)?.initials,status:state.requests[request.id]||request.status,decision:state.leaveDecisions?.[request.id]}));
  }
  function pendingLeaveCount(){return !state.demoSession&&leavePending!==null?leavePending:leaveRequests.filter(request=>(state.requests[request.id]||request.status)==='pending').length;}
  function openAbsenceRequest(personId=null){
    if(state.demoSession){notify('Afslut planlægningseksemplet, før du opretter en rigtig fraværsanmodning.');return;}
    globalThis.CleanRoomsReview.requestAbsence({element:root,people:staff,personId,today:PlanData.todayFor(),onSubmit:async payload=>{
      const result=await accountAction('leaveCreate',payload);
      if(result.ok){const item=result.request;leaveDecisionRows.set(item.id,item);state.requests[item.id]=item.status;leaveRefresh++;persistence?.invalidateCoverage?.();if(realEmployee()&&employeeData)employeeData.leaveRequests=[item,...(employeeData.leaveRequests||[])];render();notify('Fraværsanmodningen er gemt.');}
      return result;
    }});
  }
  function renderLeave() {
    if(!leaveView){leaveElement=node('div','cs-secondary-page');leaveView=globalThis.CleanRoomsReview?.mountLeave({element:leaveElement,onDecision:decideLeave,onCreate:()=>openAbsenceRequest(),onQuery:async query=>{
      const viewerId=sessionViewer?.userId,epoch=++leaveQueryEpoch,result=await accountAction('leaveRead',query),people=new Map((result.people||[]).map(person=>[person.id,person]));
      if(result.ok&&!state.demoSession&&viewerId===sessionViewer?.userId&&epoch===leaveQueryEpoch){
        leaveDecisionRows.clear();for(const item of result.requests||[])leaveDecisionRows.set(item.id,clone(item));
        if(!query.q&&!query.from&&!query.to&&(!query.type||query.type==='all')&&result.counts){leavePending=result.counts.pending;q('#cs-leave-count').textContent=String(leavePending);}
      }
      return {...result,requests:(result.requests||[]).map(item=>({...item,name:people.get(item.p)?.name||personName(item.p),initials:people.get(item.p)?.initials||personFor(item.p)?.initials}))};
    }});}
    if(!leaveElement.isConnected)q('#cs-page-content').replaceChildren(leaveElement);
    const requests=leaveViewRows();visibleCount=requests.length;leaveView?.render({requests,server:!state.demoSession,contextKey:String(sessionViewer?.userId||'')+':'+String(state.demoSession?.scenario||'live'),refreshKey:leaveRefresh,canDecide:cloudLoaded&&cloudCapabilities.plan===true&&!cloudStatus.conflict&&!leaveBusy});
  }
  function navigateTo(value, person = null) {
    if(!confirmEditorLeave(()=>navigateTo(value,person)))return false;
    const delta = Math.floor((date(value) - date(anchor)) / 86400000), week = Math.floor(delta / 7);
    if (!Number.isFinite(delta) || week < -52 || week > 52) { notify('Vælg en dato mellem ' + shortDate(addDays(anchor,-364)) + ' og ' + shortDate(addDays(anchor,370)) + '.'); return false; }
    if (person) state.departmentId = 'all';
    plannerViewport.restore=false;
    state.page = 'schedule'; state.week = week; state.day = ((delta % 7) + 7) % 7; state.pageIndex = 0;
    state.group = 'people'; state.onlyOpen = false; state.site = 'all'; state.search = person ? personName(person) : '';
    q('#cs-search').value = state.search; q('#cs-site-filter').value = 'all'; q('#cs-date-jump-panel').hidden = true; q('#cs-date-jump').setAttribute('aria-expanded','false');
    closeEditor(); closeGroupEditor(false); closeReview(); render(); const canvas = scrollContainer(); if (canvas) canvas.scrollTop = 0; if (effectiveView() === 'week') scrollCalendarTo(value); save(); return true;
  }
  function closeDemoSheets() { departmentView?.close(); closeOperationsSheets(); closeEditor(); closeGroupEditor(false); closeBulkEditor(false); closeChanges(false); closeReview(); clearSelection(false); }
  function showDemoPage() {
    if (state.page !== 'demo') state.demoReturnPage = state.page;
    closeDemoSheets(); state.page = 'demo'; state.pageIndex = 0; render(); q('#cs-demo-load')?.focus({preventScroll:true}); save();
  }
  function renderDemoSession() {
    const session = state.demoSession; q('#cs-demo-session-bar').hidden = !session;
    if (!session) return;
    const scenario = Demo.scenarios.find(item => item.id === session.scenario);
    q('#cs-demo-session-label').textContent = scenario ? 'Eksempel · ' + scenario.title : 'Eksempeluge aktiv';
  }
  function renderDemoPage() {
    const page = node('div','cs-demo-page'), intro = node('div','cs-demo-intro'), introCopy = node('div');
    introCopy.append(node('h3',null,'Prøv funktionerne i praksis'),node('p',null,'Vælg et eksempel, og prøv at løse situationen med de rigtige kontroller. Hvert eksempel starter med en frisk eksempeluge. Afslut eksemplet for at vende tilbage til din plan.'));
    const actions = node('div','cs-demo-intro-actions'), load = node('button','cs-button cs-primary','Indlæs eksempeluge'); load.id = 'cs-demo-load'; load.type = 'button'; load.addEventListener('click',() => launchDemo('overview')); actions.append(load); intro.append(introCopy,actions); page.append(intro);
    const cases = node('div','cs-demo-cases');
    Demo.scenarios.forEach((scenario,index) => {
      const row = node('section','cs-demo-case'), copy = node('div','cs-demo-case-copy'), heading = node('h3');
      heading.append(node('span','cs-demo-index',String(index + 1).padStart(2,'0')),document.createTextNode(scenario.title));
      copy.append(heading,node('p',null,scenario.description),node('p','cs-demo-expected',scenario.expected));
      const action = node('button','cs-button','Prøv eksempel'); action.type = 'button'; action.id = 'cs-demo-case-' + scenario.id;
      action.setAttribute('aria-label','Prøv eksempel: ' + scenario.title); action.addEventListener('click',() => launchDemo(scenario.id)); const caseActions = node('div','cs-demo-case-actions'); caseActions.append(action); row.append(copy,caseActions);
      if (scenario.id === 'overlap') { const show = node('button','cs-button cs-quiet','Vis i kalenderen'); show.id = 'cs-demo-overlap-calendar'; show.type = 'button'; show.addEventListener('click',() => launchDemo('overlap',{calendarOnly:true})); caseActions.append(show); }
      cases.append(row);
    });
    const timeCase=node('section','cs-demo-case'),timeCopy=node('div','cs-demo-case-copy'),timeActions=node('div','cs-demo-case-actions');
    timeCopy.append(node('h3',null,'Tidsregistrering og godkendelse'),node('p',null,'Prøv aftalte pauser, forsinket indstempling, medarbejderkommentarer og samlet godkendelse i en separat eksempeluge.'));
    const loadTime=node('button','cs-button','Åbn eksempeluge'),resetTime=node('button','cs-button','Nulstil eksempeluge'),clearTime=node('button','cs-button cs-quiet','Afslut eksempeluge');
    for(const [button,operation] of [[loadTime,'load'],[resetTime,'reset'],[clearTime,'clear']]){button.type='button';button.addEventListener('click',async()=>{timeActions.querySelectorAll('button').forEach(item=>item.disabled=true);const result=await timeCommand('timeDemo',{operation});if(result.ok){state.page='hours';render();save();}else{notify(result.message||'Eksempelugen kunne ikke indlæses.');timeActions.querySelectorAll('button').forEach(item=>item.disabled=false);}});timeActions.append(button);}
    timeCase.append(timeCopy,timeActions);cases.append(timeCase);
    page.append(cases); q('#cs-page-content').replaceChildren(page); visibleCount = Demo.scenarios.length+1;
  }
  function installDemoFixture(scenario) {
    if (!['overview',...Demo.scenarios.map(item => item.id)].includes(scenario)) return false;
    closeDemoSheets();
    let session = state.demoSession;
    if (!session) {
      const backup = clone(state); delete backup.demoSession; backup.page = state.page === 'demo' ? state.demoReturnPage : state.page;
      session = {version:1,backup,backupUndo:lastUndo ? clone(lastUndo) : null,scenario};
    }
    const fixture = Demo.create(scenario);
    fixture.series=restoredSeriesMetadata(fixture.series,state.series);
    Object.assign(state,fixture,{checklistProgress:{},leaveDecisions:{},role:'admin',employeeShift:null,coverageRules:Coverage?.defaultRules() || [],page:'schedule',group:'people',view:'week',zoom:1,day:2,week:0,pageIndex:0,search:'',site:'all',onlyOpen:false,demoSession:{...session,scenario}});
    q('#cs-search').value = ''; q('#cs-site-filter').value = 'all'; q('#cs-toast').hidden = true; lastUndo = null;
    return true;
  }
  function launchDemo(scenario, options = {}) {
    if(!state.demoSession&&hasWindowLoading()&&persistence.isPartial)return withCompletePlanning(()=>launchDemo(scenario,options));
    if (!installDemoFixture(scenario)) return;
    const trigger = q('#cs-settings-nav');
    if (scenario === 'coverage') { render(); openOperations(trigger); operationsFilter = 'coverage'; renderOperations(); save(); return; }
    if (scenario === 'overview') {
      render(); const wrap = scrollContainer(); if (wrap) wrap.scrollTop = 0; save(); return;
    }
    const day = scenario === 'overlap' ? '2026-10-26' : scenario === 'request' ? '2026-11-03' : ['series','bulk'].includes(scenario) ? '2026-10-27' : '2026-10-28';
    navigateTo(day,['overlap','series','bulk'].includes(scenario) ? scenario === 'overlap' ? 'p1' : 'p0' : null);
    if (scenario === 'bulk') {
      const members = shiftsInRange('2026-10-26','2026-11-01').filter(shift => shift.person === 'p0');
      selectedIds = new Set(members.map(shift => shift.id)); selectionMode = true; render();
      openBulkEditor('time',q('#cs-bulk-time')); q('#cs-bulk-start').value = '08:00'; q('#cs-bulk-end').value = '16:00';
      q('#cs-bulk-scope').textContent += ' Gem ændringen og se før/efter for de to vagter. Den kan fortrydes samlet.'; updateBulkPreview(); save(); return;
    }
    if (options.calendarOnly) { save(); return; }
    let shift;
    if (scenario === 'overlap') shift = shiftsInRange(day,day).find(item => item.id === 'demo-overlap-emma');
    else if (scenario === 'leave') shift = shiftsInRange(day,day).find(item => item.id === 'open-' + day);
    else if (scenario === 'request') shift = shiftsInRange(day,day).find(item => item.id === 'demo-request-shift');
    else if (scenario === 'hours') shift = {person:'p0',date:day,site:0,start:'07:00',end:'14:00',note:'Eksempel: ugens timer'};
    else if (scenario === 'series') shift = seriesOccurrences(state.series.find(item => item.id === 'jonas-plan'))[0];
    if (shift) openEditor(shift,trigger,{demoScenario:scenario,...(scenario === 'series' ? {scope:'all'} : {})});
    if (scenario === 'leave' || scenario === 'request') openStaffPicker(scenario === 'leave' ? 'Lea' : 'Emma');
    save();
  }
  function renderDemoEditorGuide() {
    const guide = q('#cs-demo-editor-guide'), scenario = state.demoSession && Demo.scenarios.find(item => item.id === activeEdit?.demoScenario);
    guide.hidden = !scenario; guide.replaceChildren(); if (!scenario) return;
    guide.append(node('span','cs-demo-guide-title','Eksempel · ' + scenario.title),node('p',null,scenario.expected));
  }
  function exitDemo() {
    const session = state.demoSession; if (!session) return;
    const backup = clone(session.backup), undo = session.backupUndo ? clone(session.backupUndo) : null;backup.series=restoredSeriesMetadata(backup.series,state.series);backup.edits=restoredPauseEdits(backup.edits,state.edits);
    closeDemoSheets(); state.demoSession = null; restore({privateContent:{studio:backup}}); lastUndo = undo;
    q('#cs-search').value = state.search; q('#cs-site-filter').value = state.site; q('#cs-toast').hidden = true; render(); save();
  }
  function renderSeries() {
    const catalog=persistence?.isPartial&&planningCatalog?{...state,...planningCatalog}:state;
    const matches=series=>(!searchTerm()||personName(series.person).toLocaleLowerCase('da-DK').includes(searchTerm()))&&(state.site==='all'||series.site===Number(state.site));
    const examples=SeriesExamples&&state.demoSeed!==false&&!state.demoSession&&!realEmployee()?SeriesExamples.create({today}):null;
    const exampleLabels={'demo-series-varied':'Tider pr. ugedag','demo-series-periods':'Flere perioder','demo-series-expiring':'Udløber snart','demo-series-upcoming':'Kommende aftale','demo-series-ended':'Afsluttet aftale'};
    const agreements=SeriesLifecycle?(SeriesLifecycle.summarizeSeries||SeriesLifecycle.groupSeries)(catalog.series,{today,edits:catalog.edits,deleted:catalog.deleted}):null;
    visibleCount=agreements?agreements.filter(group=>group.phases.some(matches)).length:catalog.series.filter(matches).length;
    const surface=globalThis.CleanRoomsSeriesOverview.render({document,series:catalog.series,...(agreements?{agreements}:{}),totalSeries:catalog.series.length,today,status:seriesStatus,sites,personName,edits:catalog.edits,deleted:catalog.deleted,
      filterAgreement:group=>group.phases.some(matches),expandedGroups:expandedSeriesGroups,onToggleGroup:(id,open)=>{open?expandedSeriesGroups.add(id):expandedSeriesGroups.delete(id);},
      personInitials:person=>personFor(person)?.initials||'—',shiftsForSeries:series=>seriesOccurrences(series,catalog),
      exceptionCount:source=>Engine.exceptionPreview({source,edits:catalog.edits,deleted:catalog.deleted}),descriptionIndicator,
      onStatusChange:status=>{seriesStatus=status;renderSeries();q('#cs-series-status-'+status)?.focus({preventScroll:true});},
      onEdit:(series,trigger)=>openSeriesEditor(series,trigger),onCreate:trigger=>newShift(true,trigger),
      onCopy:(series,trigger)=>copySeriesEditor(series,trigger),onExtend:(series,trigger,group)=>extendSeriesEditor(group||series,trigger),
      ...(examples?{demoExamples:{onAdd:addSeriesExamples,installed:examples.groups.every(group=>catalog.series.some(phase=>(phase.groupId||phase.id)===group.id||group.phaseIds.includes(phase.id))),labelFor:entry=>exampleLabels[entry.id]||''}}:{}),
      onShow:(series,next)=>{const shift=next||seriesOccurrences(series,catalog)[0]||Engine.enumerate(series,seriesOperationRange(series))[0];navigateTo(shift?.date||series.startDate,shift?.person||series.person);}
    });
    q('#cs-series-tools').replaceChildren(surface.querySelector('.cs-series-overview-head'));
    q('#cs-page-content').replaceChildren(surface);
  }
  function addSeriesExamples() {
    if(hasWindowLoading()&&persistence.isPartial)return withCompletePlanning(()=>addSeriesExamples());
    if(!SeriesExamples||!cloudLoaded||realEmployee()||state.demoSeed===false||state.demoSession||cloudStatus.conflict)return;
    const data=snapshot(),result=SeriesExamples.appendPlan({...data,roster:clone(staff)},{today,staff,siteCount:sites.length,blockedDates:approvedLeaveDates()});
    if(!result.changed){notify(result.skipped.length?'Eksempelserierne kunne ikke tilføjes. Kontrollér medarbejdernes tilgængelighed og arbejdssteder.':'Eksempelserierne er allerede indlæst.');return;}
    data.series=result.series;seriesStatus='all';state.search='';state.site='all';q('#cs-search').value='';q('#cs-site-filter').value='all';expandedSeriesGroups.add('demo-series-periods');
    const count=result.added.length;
    commit(data,count+' eksempelserier er tilføjet som kladde.'+(result.skipped.length?' '+result.skipped.length+' blev sprunget over på grund af eksisterende vagter eller manglende medarbejdere.':''),result.ranges);
    q('#cs-series-demo-examples')?.focus({preventScroll:true});
  }
  function seriesCreateButton() {
    const button = node('button','cs-button cs-primary cursor-interaction','Opret vagtserie'); button.type = 'button'; button.addEventListener('click',() => newShift(true,button)); return button;
  }
  function validCoverageRules(rules) {
    return Array.isArray(rules) && rules.length <= 60 && new Set(rules.map(rule => rule?.id)).size === rules.length
      && rules.every(rule => Number.isInteger(rule?.site) && rule.site >= 0 && rule.site < sites.length && (Coverage ? !Coverage.validateRule(rule).length : rule && typeof rule.id === 'string'))
      && (!Coverage || Coverage.expand({rules,from:anchor,to:addDays(anchor,6)}).valid);
  }
  function coverageReport(from = dates()[0], to = dates()[6]) {
    if (!Coverage) return {valid:false,slots:[],errors:['Bemandingskontrollen er ikke tilgængelig.']};
    return Coverage.coverage({rules:state.coverageRules,from,to,shifts:conflictShiftsInRange(addDays(from,-1),addDays(to,1)),blockedDates:approvedLeaveDates()});
  }
  function coverageItemId(slot, segment) { return slot.id + '/' + segment.start + '/' + segment.end; }
  function operationsModel(from=dates()[0],to=dates()[6]) {
    const report = coverageReport(from,to), items = [], all = shiftsInRange(from,to);
    report.slots.forEach(slot => (slot.deficits || []).forEach(segment => items.push({
      id:coverageItemId(slot,segment),kind:'coverage',slotId:slot.id,ruleId:slot.ruleId,date:slot.date,site:slot.site,start:segment.start,end:segment.end,required:slot.required,missing:segment.missing,
      title:sites[slot.site].name,detail:segment.filled + ' af ' + slot.required + ' medarbejdere · ' + segment.missing + ' mangler'
    })));
    const leave = leaveDateIndex();
    all.filter(shift => shift.person && Engine.shiftDates(shift).some(day=>leave.get(shift.person)?.has(day))).forEach(shift => items.push({id:'leave/' + shift.id,kind:'leave',date:shift.date,site:shift.site,start:shift.start,end:shift.end,shift,title:personName(shift.person),detail:'Godkendt fravær · ' + sites[shift.site].name}));
    const seen = new Set();
    Engine.conflicts(all,conflictShiftsInRange(addDays(from,-1),addDays(to,1))).forEach(({shift,other}) => {
      const key = [shift.id,other.id].sort().join('|'); if (seen.has(key)) return; seen.add(key);
      items.push({id:'overlap/' + key,kind:'overlap',date:shift.date,site:shift.site,start:shift.start,end:shift.end,shift,other,title:personName(shift.person),detail:sites[shift.site].name + ' ' + clockLabel(shift) + ' / ' + sites[other.site].name + ' ' + clockLabel(other)});
    });
    all.filter(shift => !shift.person).forEach(shift => items.push({id:'open/' + shift.id,kind:'open',date:shift.date,site:shift.site,start:shift.start,end:shift.end,shift,title:sites[shift.site].name,detail:'Ledig vagt · ingen medarbejder tildelt'}));
    leaveRequests.filter(request => (state.requests[request.id] || request.status) === 'pending' && request.days.some(day => day >= from && day <= to)).forEach(request => items.push({id:'request/' + request.id,kind:'request',date:request.days.find(day => day >= from && day <= to),request,title:personName(request.p),detail:request.type + ' · ' + request.dates + ' · afventer svar'}));
    items.sort((a,b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || '') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const counts = {coverage:0,leave:0,overlap:0,open:0,request:0}; items.forEach(item => counts[item.kind] += 1);
    return {report,items,counts,total:items.length};
  }
  function operationsPeriod() { return 'Uge ' + weekNumber(dates()[0]) + ' · ' + shortDate(dates()[0]) + ' – ' + shortDate(dates()[6]); }
  function operationsAction(label, action, className = '') { const button = node('button','cs-button ' + className,label); button.type = 'button'; button.addEventListener('click',action); return button; }
  function renderOperations() {
    const model = operationsModel(), labels = {coverage:'Bemandingshul',leave:'Godkendt fravær',overlap:'Overlap',open:'Ledig vagt',request:'Afventer svar'};
    q('#cs-operations-period').textContent = operationsPeriod() + ' · alle arbejdssteder og medarbejdere';
    q('#cs-operations-summary').textContent = model.counts.coverage + (model.counts.coverage === 1 ? ' bemandingshul' : ' bemandingshuller') + ' · ' + model.counts.leave + (model.counts.leave === 1 ? ' vagt med fravær' : ' vagter med fravær') + ' · ' + model.counts.overlap + ' overlap · ' + model.counts.open + (model.counts.open === 1 ? ' ledig vagt' : ' ledige vagter') + (model.counts.request ? ' · ' + model.counts.request + (model.counts.request === 1 ? ' friønske' : ' friønsker') : '');
    q('#cs-operations-publish-blocked').hidden = !model.counts.overlap && !model.counts.leave;
    root.querySelectorAll('[data-ops-filter]').forEach(button => { const key = button.dataset.opsFilter, count = key === 'all' ? model.total : key === 'leave' ? model.counts.leave + model.counts.request : model.counts[key]; button.setAttribute('aria-pressed',String(key === operationsFilter)); button.textContent = ({all:'Alle',coverage:'Bemanding',leave:'Fravær',overlap:'Overlap',open:'Ledige'})[key] + ' ' + count; });
    const list = q('#cs-operations-list'); list.replaceChildren();
    if (!model.report.valid) list.append(node('p','cs-ops-empty','Bemandingsbehovet kunne ikke kontrolleres. Åbn Bemandingsbehov og ret opsætningen.'));
    const items = model.items.filter(item => operationsFilter === 'all' || item.kind === operationsFilter || operationsFilter === 'leave' && item.kind === 'request');
    if (!items.length && model.report.valid) list.append(node('p','cs-ops-empty',model.total ? 'Ingen punkter i denne kategori i den valgte uge.' : state.coverageRules.length ? 'Alle opsatte bemandingsbehov er dækket. Ingen uløste punkter i denne uge.' : 'Ingen uløste punkter. Opret bemandingsbehov for at kontrollere dækningen.'));
    items.forEach(item => {
      const row = node('section','cs-ops-item'); row.dataset.kind = item.kind; row.dataset.issueId = item.id;
      const meta = node('div','cs-ops-meta'); meta.append(node('span',null,labels[item.kind]),node('span',null,shortDate(item.date) + (item.start ? ' · ' + clockLabel(item) : '')));
      row.append(meta,node('h4','cs-ops-title',item.title),node('p','cs-ops-detail',item.detail));
      const actions = node('div','cs-ops-actions');
      if (item.kind === 'request') {
        actions.append(operationsAction('Godkend',() => decideLeave(item.request.id,'approved')),operationsAction('Afvis',() => decideLeave(item.request.id,'rejected'),'cs-quiet'));
      } else {
        const target = item.kind === 'coverage' ? {...item,kind:'coverage'} : {kind:'shift',shift:clone(item.shift)};
        actions.append(operationsAction(item.kind === 'open' ? 'Find medarbejder' : 'Find afløser',event => openReplacement(target,event?.currentTarget || q('#cs-review'))));
        actions.append(operationsAction('Vis i planen',() => {
          if (item.site !== undefined && !inDepartment(item.site)) state.departmentId = 'all';
          closeOperations(false); state.view = 'week'; navigateTo(item.date,item.shift?.person || null);
          if (item.site !== undefined && !item.shift?.person) { state.site = String(item.site); q('#cs-site-filter').value = state.site; render(); scrollCalendarTo(item.date); save(); }
        },'cs-quiet'));
      }
      row.append(actions); list.append(row);
    });
  }
  function closeOperations(restoreFocus = true) {
    const wasOpen = !q('#cs-operations-layer').hidden; q('#cs-operations-layer').hidden = true;
    if(wasOpen){releasePlanningHold('operations');resumePlannerViewport();}
    if (wasOpen && restoreFocus) (operationsTrigger?.isConnected ? operationsTrigger : q('#cs-review')).focus({preventScroll:true});
  }
  function closeNeeds(restoreFocus = true) {
    const wasOpen = !q('#cs-needs-layer').hidden; q('#cs-needs-layer').hidden = true;
    if(wasOpen){releasePlanningHold('operations');resumePlannerViewport();}
    if (wasOpen && restoreFocus) openOperations(needsTrigger || q('#cs-review'),false);
  }
  function closeReplacement(restoreFocus = true) {
    const wasOpen = !q('#cs-replacement-layer').hidden; q('#cs-replacement-layer').hidden = true; activeReplacement = null;
    if (wasOpen && restoreFocus) openOperations(q('#cs-review'),false);
  }
  function closeOperationsSheets() { closeOperations(false); closeNeeds(false); closeReplacement(false); sicknessView?.close(); }
  let sicknessView=null;
  function openSickness(shift,trigger) {
    if(!cloudLoaded||!cloudCapabilities.plan||state.role==='employee'||!shift?.id||!shift.person||state.demoSession||!globalThis.CleanRoomsSickness)return;
    const person=personFor(shift.person);if(!person||person.active===false)return;
    const captured=clone(shift),workspace=chatWorkspaceId,viewer=sessionViewer?.userId;
    closeOperationsSheets();closeEditor();closeGroupEditor(false);closeBulkEditor(false);closeChanges(false);closeReview();
    sicknessView=globalThis.CleanRoomsSickness.open({element:root,person,shift:captured,sites,onClose:()=>{sicknessView=null;releasePlanningHold('sickness');resumePlannerViewport();},onReplace:current=>openReplacement({kind:'shift',shift:current,sickness:true},trigger),onSubmit:async({from,to})=>{
      if(workspace!==chatWorkspaceId||viewer!==sessionViewer?.userId||!cloudCapabilities.plan||state.role==='employee')return {ok:false,error:'Din adgang er ændret. Genindlæs siden.'};
      const current=shiftById(captured.id);
      if(!sameAssignment(current,captured))return {ok:false,error:'Vagten er ændret. Åbn den igen, før du registrerer sygdom.'};
      const result=await accountAction('leaveCreate',{personId:person.id,from,to,type:'Sygdom',recordSickness:true});
      if(!result.ok)return {ok:false,error:result.message||'Sygemeldingen kunne ikke registreres.'};
      if(workspace!==chatWorkspaceId||viewer!==sessionViewer?.userId)return {ok:true,shiftsUnavailable:true};
      const entry=result.request,index=leaveRequests.findIndex(item=>item.id===entry.id);
      if(index<0)leaveRequests.push(entry);else leaveRequests[index]=entry;
      leaveDecisionRows.set(entry.id,entry);state.requests[entry.id]=entry.status;state.leaveDecisions={...state.leaveDecisions,[entry.id]:entry.decision};state.absences=clone(leaveRequests);
      leaveRefresh++;lastUndo=null;staffingContextCache=null;staffingAssessments.clear();persistence?.invalidateCoverage?.();employeeReader?.invalidate?.();timeLoadedKey='';
      let affected;
      try{affected=await withPlanningDates([from,to],()=>shiftsInRange(from,to).filter(item=>item.person===person.id).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id)),'sickness');}
      catch{affected=null;}
      finally{releasePlanningHold('sickness');}
      render();
      return {ok:true,shifts:Array.isArray(affected)?affected:[],shiftsUnavailable:!Array.isArray(affected)};
    }});
  }
  function openOperations(trigger = q('#cs-review'), reset = true) {
    if(usesViewportCalendar()&&!calendarWeekLoaded(dates()[0]))return ensureBaseWeek(()=>openOperations(trigger,reset));
    closeOperationsSheets(); closeEditor(); closeGroupEditor(false); closeBulkEditor(false); closeChanges(false); closeReview();
    operationsTrigger = trigger; if (reset) operationsFilter = 'all'; renderOperations(); q('#cs-operations-layer').hidden = false; icons(); q('#cs-operations-close').focus({preventScroll:true});
  }
  function readNeedRule() {
    return {id:q('#cs-need-id').value || 'need-' + Date.now().toString(36),site:Number(q('#cs-need-site').value),weekdays:[...needDays].sort((a,b) => a-b),start:q('#cs-need-start').value,end:q('#cs-need-end').value,required:Number(q('#cs-need-count').value)};
  }
  function needRuleError(rule) {
    if (!Coverage) return 'Bemandingskontrollen er ikke tilgængelig.';
    const errors = Coverage.validateRule(rule); if (errors.length) return errors[0];
    if (!state.coverageRules.some(item => item.id === rule.id) && state.coverageRules.length >= 60) return 'Du kan oprette højst 60 bemandingsbehov.';
    const checked=Coverage.expand({rules:[...state.coverageRules.filter(other=>other.id!==rule.id),rule],from:today,to:today});if(!checked.valid)return checked.errors[0];
    return null;
  }
  function applyNeedRule(rule) {
    const error = needRuleError(rule); if (error) return {ok:false,reason:error};
    lastUndo = snapshot(); state.coverageRules = [...state.coverageRules.filter(item => item.id !== rule.id),clone(rule)];
    render();savedFeedback('Bemandingsbehovet er gemt. Vagterne er uændrede.');return {ok:true};
  }
  function removeNeedRule(id) {
    if (!state.coverageRules.some(rule => rule.id === id)) return false;
    lastUndo = snapshot(); state.coverageRules = state.coverageRules.filter(rule => rule.id !== id); render();savedFeedback('Bemandingsbehovet er fjernet. Du kan fortryde ændringen.');return true;
  }
  function fillNeedForm(rule = null) {
    q('#cs-need-id').value = rule?.id || ''; q('#cs-need-site').value = String(rule?.site ?? 0); q('#cs-need-start').value = rule?.start || '07:00'; q('#cs-need-end').value = rule?.end || '14:00'; q('#cs-need-count').value = String(rule?.required ?? 1);
    needDays = new Set(rule?.weekdays || [0,1,2,3,4]); root.querySelectorAll('[data-need-day]').forEach(button => button.setAttribute('aria-pressed',String(needDays.has(Number(button.dataset.needDay)))));
    q('#cs-need-error').hidden = true; q('#cs-need-save').textContent = rule ? 'Gem ændringer' : 'Tilføj behov'; q('#cs-need-form-title').textContent = rule ? 'Rediger bemandingsbehov' : 'Nyt bemandingsbehov';
  }
  function renderNeeds() {
    q('#cs-needs-period').textContent = staffingSentence('Faste behov gentages hver uge. Dækningen nedenfor gælder ' + operationsPeriod().toLocaleLowerCase('da-DK'));
    const report = coverageReport(), list = q('#cs-needs-list'); list.replaceChildren();
    if (!state.coverageRules.length) list.append(node('p','cs-ops-empty','Ingen bemandingsbehov endnu. Tilføj et arbejdssted, et tidsrum og antal medarbejdere.'));
    state.coverageRules.slice().sort((a,b) => a.site - b.site || a.start.localeCompare(b.start)).forEach(rule => {
      const slots = report.slots.filter(slot => slot.ruleId === rule.id), gaps = slots.filter(slot => !slot.covered).length;
      const row = node('section','cs-need-row'); row.dataset.needId = rule.id;
      row.append(node('h4','cs-ops-title',sites[rule.site].name),node('p','cs-ops-detail',rule.weekdays.map(day => dayNames[day].slice(0,3).toLocaleLowerCase('da-DK')).join(', ') + ' · ' + rule.start + '–' + rule.end),node('p','cs-need-status',rule.required + (rule.required === 1 ? ' medarbejder' : ' medarbejdere') + ' · ' + gaps + ' af ' + slots.length + ' tidsrum mangler bemanding denne uge'));
      const actions = node('div','cs-ops-actions'); actions.append(operationsAction('Rediger',() => { fillNeedForm(rule); q('#cs-needs-form').scrollIntoView({block:'start'}); q('#cs-need-site').focus({preventScroll:true}); }),operationsAction('Fjern',() => { removeNeedRule(rule.id); renderNeeds(); if (q('#cs-need-id').value === rule.id) fillNeedForm(); },'cs-quiet'));
      row.append(actions); list.append(row);
    });
  }
  function openNeeds(trigger = q('#cs-review')) {
    if(usesViewportCalendar()&&!calendarWeekLoaded(dates()[0]))return ensureBaseWeek(()=>openNeeds(trigger));
    needsTrigger = trigger; closeOperationsSheets(); closeEditor(); closeGroupEditor(false); closeBulkEditor(false); closeChanges(false); closeReview();
    fillNeedForm(); renderNeeds(); q('#cs-needs-layer').hidden = false; q('.cs-needs-body').scrollTop = 0; q('#cs-needs-close').focus({preventScroll:true});
  }
  async function decideLeave(id,next,reason) {
    const request=!state.demoSession&&leaveDecisionRows.get(id)||leaveRequests.find(item=>item.id===id);
    if(!request||!['approved','rejected'].includes(next)||(state.demoSession?(state.requests[id]||request.status):request.status)!=='pending')return {ok:false,error:'Anmodningen er allerede behandlet. Hent den seneste plan.'};
    if(!cloudLoaded||!cloudCapabilities.plan||cloudStatus.conflict||leaveBusy)return {ok:false,error:'Anmodningen kan ikke behandles lige nu.'};
    if(next==='rejected'&&reason===undefined){
      globalThis.CleanRoomsReview.rejection({element:root,request:{...request,name:personName(request.p)},onDecision:decideLeave,trigger:document.activeElement});return {ok:false};
    }
    if(next==='rejected'&&!String(reason||'').trim())return {ok:false,error:'Skriv en begrundelse for afvisningen.'};
    if(state.demoSession){
      state.requests[id]=next;state.leaveDecisions={...state.leaveDecisions,[id]:{status:next,reason:next==='rejected'?String(reason).trim():'',decidedBy:{userId:'demo',name:'Planlægger'},decidedAt:new Date().toISOString()}};
      lastUndo=null;render();if(!q('#cs-operations-layer').hidden)renderOperations();return {ok:true};
    }
    leaveBusy=true;const result=await accountAction('leaveDecide',{id,version:request.version||1,status:next,reason:next==='rejected'?String(reason).trim():''});leaveBusy=false;
    if(!result.ok)return {ok:false,error:result.message||'Svaret kunne ikke gemmes. Hent den seneste plan.'};
    Object.assign(request,result.request);state.requests[id]=request.status;state.leaveDecisions={...state.leaveDecisions,[id]:request.decision};leaveRefresh++;persistence?.invalidateCoverage?.();
    lastUndo=null;render();if(!q('#cs-operations-layer').hidden)renderOperations();notify(next==='approved'?'Fraværet er godkendt.':'Anmodningen er afvist med begrundelse.');return {ok:true};
  }
  function sameAssignment(a,b) { return Boolean(a && b && ['id','person','date','site','start','end','plannedBreakMinutes','seriesId'].every(key => (a[key] ?? '') === (b[key] ?? ''))&&(Instructions?Instructions.equal(a,b):['note','noteRich'].every(key=>(a[key]??'')===(b[key]??'')))); }
  function replacementContext(target) {
    if (!target || !['shift','coverage'].includes(target.kind)) return {valid:false,reason:'Vælg en vagt eller et bemandingshul.'};
    if (target.kind === 'shift') {
      const captured = target.shift;
      if (!Actions.validDate(captured?.date)) return {valid:false,reason:'Vagten er ikke længere tilgængelig.'};
      const current = shiftsInRange(captured.date,captured.date).find(shift => shift.id === captured.id);
      if (!sameAssignment(current,captured)) return {valid:false,reason:'Vagten er ændret. Åbn driftsoverblikket igen for at bruge den aktuelle plan.'};
      return {valid:true,shift:clone(current),current:clone(current),mode:current.person ? 'replace' : 'assign'};
    }
    if (!Actions.validDate(target.date)) return {valid:false,reason:'Datoen er ugyldig.'};
    const report = coverageReport(target.date,target.date), slot = report.slots.find(item => item.id === target.slotId);
    const gap = slot?.deficits.find(item => item.start === target.start && item.end === target.end && item.missing > 0);
    if (!report.valid || !slot || !gap || slot.site !== target.site || slot.required !== target.required) return {valid:false,reason:'Bemandingsbehovet har ændret sig eller er allerede dækket. Åbn driftsoverblikket igen.'};
    const open = shiftsInRange(target.date,target.date).filter(shift => !shift.person && shift.site === target.site && shift.start <= gap.start && shift.end >= gap.end).sort((a,b) => duration(a) - duration(b) || a.id.localeCompare(b.id))[0];
    const shift = open ? clone(open) : {id:'cover-' + target.slotId + '-' + gap.start.replace(':','') + '-' + gap.end.replace(':',''),person:'',date:target.date,site:target.site,start:gap.start,end:gap.end,note:'Bemandingsbehov · ' + sites[target.site].name};
    if (!open && shiftsInRange(target.date,target.date).some(item => item.id === shift.id)) shift.id += '-' + (shiftsInRange(target.date,target.date).length + 1);
    return {valid:true,shift,current:open ? clone(open) : null,mode:open ? 'assign' : 'create',missing:gap.missing,required:slot.required};
  }
  function replacementProposal(target, personId, expectedContext = null) {
    const context = replacementContext(target), person = personFor(personId);
    if (!context.valid) return {ok:false,reason:context.reason};
    if (expectedContext && (!sameAssignment(context.shift,expectedContext.shift) || context.mode !== expectedContext.mode)) return {ok:false,reason:'Planen er ændret, mens afløserforslaget var åbent. Åbn det igen.'};
    if (!person) return {ok:false,reason:'Vælg en medarbejder.'};
    if (context.current?.person === person.id) return {ok:false,reason:'Medarbejderen har allerede denne vagt.'};
    const shift = {...context.shift,person:person.id}, weekStart = staffingMonday(shift.date);
    const assessment = withAvailability(Staffing.assess({person,proposed:[shift],existing:conflictShiftsForWeeks([weekStart]),removedIds:context.current ? [context.current.id] : [],weekStart,blockedDates:approvedLeaveDates(),pendingRequests:pendingLeaveDates()}),person.id,[shift]);
    return {ok:assessment.available,reason:assessment.available ? '' : staffingReason(assessment) || 'Tildelingen kunne ikke kontrolleres.',shift,assessment,context};
  }
  function replacementCandidates(target, expectedContext = null) {
    return staff.filter(person=>person.active!==false).map(person => ({person,result:replacementProposal(target,person.id,expectedContext)})).sort((a,b) => Number(b.result.ok) - Number(a.result.ok)
      || Number(Boolean(a.result.assessment?.unavailableDates?.length))-Number(Boolean(b.result.assessment?.unavailableDates?.length))
      || Number(Boolean(a.result.assessment?.pendingRequests.length)) - Number(Boolean(b.result.assessment?.pendingRequests.length))
      || Number(Boolean(a.result.assessment?.overTargetWeeks.length)) - Number(Boolean(b.result.assessment?.overTargetWeeks.length))
      || Number(b.person.site === target.site || b.person.site === target.shift?.site) - Number(a.person.site === target.site || a.person.site === target.shift?.site)
      || (a.result.assessment?.projectedMinutes || 0) - (b.result.assessment?.projectedMinutes || 0) || a.person.name.localeCompare(b.person.name,'da-DK'));
  }
  function applyReplacement(target, personId, expectedContext = null) {
    const result = replacementProposal(target,personId,expectedContext); if (!result.ok) return result;
    const data = snapshot(); data.edits[result.shift.id] = result.shift; data.deleted = data.deleted.filter(id => id !== result.shift.id);
    commit(data,personName(personId) + ' er tildelt ' + clockLabel(result.shift) + ' på ' + sites[result.shift.site].name + '. Kun denne vagt er ændret.',[[result.shift.date,result.shift.date]]);
    return {ok:true,shift:result.shift};
  }
  function renderReplacement() {
    if (!activeReplacement) return;
    const {target,context} = activeReplacement, entries = replacementCandidates(target,context), current = replacementContext(target), list = q('#cs-replacement-list');
    if(current.valid)requestPlanningAvailability([current.shift],staff.filter(person=>person.active!==false).slice(0,500).map(person=>person.id));
    const term = q('#cs-replacement-search').value.trim().toLocaleLowerCase('da-DK'); list.replaceChildren();
    const matching=entries.filter(item=>(!target.sickness||item.result.ok)&&item.person.name.toLocaleLowerCase('da-DK').includes(term));
    q('#cs-replacement-status').textContent = current.valid ? target.sickness?entries.filter(item=>item.result.ok).length+' mulige afløsere':entries.filter(item => item.result.ok).length + ' kan tildeles. Forslag sorteres efter tilgængelighed, friønsker, aftalte timer og arbejdssted.' : current.reason;
    (target.sickness?matching.slice(0,activeReplacement.limit||5):matching).forEach(({person,result}) => {
      const row = node('button','cs-replacement-option'); row.type = 'button'; row.dataset.person = person.id; row.dataset.status = result.ok ? 'available' : 'blocked'; row.id = 'cs-replacement-option-' + person.id;
      row.dataset.unavailable=String(Boolean(result.assessment?.unavailableDates?.length));
      row.setAttribute('aria-pressed',String(activeReplacement.person === person.id)); row.setAttribute('aria-disabled',String(!result.ok));
      const heading = node('span','cs-replacement-main'); heading.append(node('span','cs-replacement-name',person.name));
      if(!target.sickness)heading.append(node('span','cs-replacement-state',result.ok ? staffingStatus(result.assessment) : result.reason.includes('fravær') ? 'Godkendt fravær' : 'Kan ikke tildeles'));row.append(heading);
      row.append(node('span','cs-replacement-meta',sites[person.site].name+(target.sickness&&result.assessment?' · '+workTime(result.assessment.projectedMinutes)+' efter tildeling':person.site===context.shift.site?' · samme arbejdssted':'')));
      if(!target.sickness&&result.assessment)row.append(node('span','cs-replacement-hours',staffingHours(result.assessment)));
      const detail = target.sickness?[result.assessment?.unavailableDates?.length?'Utilgængelig':'',result.assessment?.overTargetWeeks.length?'Over aftalte timer':'',result.assessment?.pendingRequests.length?result.assessment.pendingRequests[0].type+' afventer':''].filter(Boolean).join(' · '):result.ok ? staffingReason(result.assessment) + (result.assessment.overTargetWeeks.length ? ' Over aftalt ugentligt timetal.' : '') : result.reason;
      if (detail.trim()) row.append(node('span','cs-replacement-reason',detail.trim()));
      row.addEventListener('click',() => { if (!result.ok) return; activeReplacement.person = person.id; renderReplacement(); q('#cs-replacement-option-' + person.id)?.focus({preventScroll:true}); }); list.append(row);
    });
    if(target.sickness&&matching.length>(activeReplacement.limit||5)){const more=node('button','cs-button cs-quiet','Vis flere afløsere');more.type='button';more.addEventListener('click',()=>{activeReplacement.limit=(activeReplacement.limit||5)+20;renderReplacement();});list.append(more);}
    if (!list.children.length) list.append(node('p','cs-ops-empty',target.sickness?'Ingen ledige medarbejdere matcher din søgning.':'Ingen medarbejdere matcher din søgning.'));
    const selected = activeReplacement.person && replacementProposal(target,activeReplacement.person,context);
    q('#cs-replacement-save').disabled = !selected?.ok; q('#cs-replacement-save').textContent = activeReplacement.person ? 'Tildel ' + personName(activeReplacement.person).split(' ')[0] : 'Tildel vagt';
  }
  function openReplacement(target, trigger = q('#cs-review')) {
    const context = replacementContext(target); if (!context.valid) { notify(context.reason); return; }
    const selection=detailSelection(context.current?[context.current]:[]);
    if(needsPlannerDetails(selection))return withPlannerDetails(selection,()=>{const current=context.current&&shiftById(context.current.id);return openReplacement(target.kind==='shift'?{...target,shift:current||target.shift}:target,trigger);});
    closeOperationsSheets(); closeEditor(); closeGroupEditor(false); closeBulkEditor(false); closeChanges(false); closeReview();
    activeReplacement = {target:clone(target),context:clone(context),person:null,trigger};
    const shift = context.shift; q('#cs-replacement-context').textContent = target.sickness?personName(context.current.person)+' · '+shortDate(shift.date)+' · '+clockLabel(shift)+' · '+sites[shift.site].name:sites[shift.site].name + ' · ' + shortDate(shift.date) + ' · ' + clockLabel(shift) + '. '
      + (context.mode === 'create' ? 'Opretter én vagt til dette bemandingshul.' : context.mode === 'replace' ? 'Erstatter ' + personName(context.current.person) + ' på denne ene vagt.' : 'Bruger den eksisterende ledige vagt.')
      + ' Alle arbejdssteder og godkendt fravær kontrolleres.';
    q('#cs-replacement-search').value = ''; q('#cs-replacement-error').hidden = true; renderReplacement(); q('#cs-replacement-layer').hidden = false; q('.cs-replacement-body').scrollTop = 0; q('#cs-replacement-close').focus({preventScroll:true});
  }

  function weekReview() {
    const all = shifts(), open = all.filter(shift => !shift.person), pairs = new Map(), context=conflictShiftsForWeeks([dates()[0]]);
    Engine.conflicts(all,context).forEach(conflict => { const key = [conflict.shift.id,conflict.other.id].sort().join('|'); if (!pairs.has(key)) pairs.set(key,conflict); });
    const hoursByPerson=new Map();for(const shift of context)hoursByPerson.set(shift.person,(hoursByPerson.get(shift.person)||0)+Engine.plannedMinutesInRange(shift,dates()[0],dates()[6])/60);
    const hours = staff.map(person => ({person,hours:hoursByPerson.get(person.id)||0})).filter(item => item.hours > item.person.target);
    const leave = leaveDateIndex(), absences = all.filter(shift => shift.person && Engine.shiftDates(shift).some(day=>leave.get(shift.person)?.has(day)));
    return {all,open,overlaps:[...pairs.values()],hours,absences};
  }
  function renderReview() {
    q('.cs-review-footer>span').textContent = 'Uge ' + weekNumber(dates()[0]) + ' · ' + shortDate(dates()[0]) + ' – ' + shortDate(dates()[6]);
    const review = weekReview(), body = q('#cs-review-body'); body.replaceChildren();
    function section(title, empty) { const area = node('section','cs-review-section'); area.append(node('h3',null,title)); if (empty) area.append(node('p','cs-review-ok',empty)); body.append(area); return area; }
    function item(area, shift, title, detail) { const button = node('button','cs-review-item cursor-interaction'); button.type = 'button'; button.append(node('span',null,title),node('span','cs-review-detail',detail)); button.addEventListener('click',() => { closeReview(); openEditor(shift,q('#cs-review')); }); area.append(button); }
    const open = section('Ledige vagter · ' + review.open.length,review.open.length ? null : 'Alle ugens vagter er bemandet.');
    review.open.forEach(shift => item(open,shift,sites[shift.site].name + ' · ' + shortDate(shift.date),clockLabel(shift) + ' · Vælg en medarbejder'));
    const overlap = section('Overlap · ' + review.overlaps.length,review.overlaps.length ? null : 'Ingen medarbejdere har overlappende vagter.');
    review.overlaps.forEach(conflict => item(overlap,conflict.shift,personName(conflict.shift.person) + ' · ' + shortDate(conflict.shift.date),clockLabel(conflict.shift) + ' og ' + clockLabel(conflict.other)));
    const absence = section('Vagter med godkendt fravær · ' + review.absences.length,review.absences.length ? null : 'Ingen vagter er tildelt medarbejdere med godkendt fravær.');
    review.absences.forEach(shift => item(absence,shift,personName(shift.person) + ' · ' + shortDate(shift.date),clockLabel(shift) + ' · Find en afløser før udgivelse'));
    const hours = section('Planlægningsinfo · ugentlige timer',review.hours.length ? null : 'Ingen medarbejdere er planlagt over deres aftalte ugentlige timetal.');
    hours.append(node('p','cs-review-detail','Sammenligning med medarbejderens aftalte timetal.'));
    review.hours.forEach(entry => { const shift = review.all.find(shift => shift.person === entry.person.id); if (shift) item(hours,shift,entry.person.name,niceHours(entry.hours) + ' af ' + entry.person.target + ' timer · +' + niceHours(entry.hours - entry.person.target) + ' timer'); });
    icons();
  }
  function openReview(trigger = q('#cs-review')) { if(usesViewportCalendar()&&!calendarWeekLoaded(dates()[0]))return ensureBaseWeek(()=>openReview(trigger),'review');closeOperationsSheets(); closeBulkEditor(false); closeChanges(false); closeEditor(); closeGroupEditor(false); reviewTrigger = trigger; renderReview(); q('#cs-review-layer').hidden = false; q('#cs-review-close').focus({preventScroll:true}); }
  function closeReview() { const open = !q('#cs-review-layer').hidden; q('#cs-review-layer').hidden = true;if(open){releasePlanningHold('review');resumePlannerViewport();} if (open && reviewTrigger?.isConnected) reviewTrigger.focus({preventScroll:true}); }
  function renderKey() { return JSON.stringify([state.page,effectiveView(),state.zoom,state.group,state.week,state.day,state.pageIndex,state.search,state.site,state.departmentId,state.onlyOpen]); }
  function scrollContainer() { return q('#cs-page-content .cs-board-scroll, #cs-page-content .cs-table-wrap, #cs-page-content .cs-agenda, #cs-page-content .cs-series-overview-list, #cs-page-content .cs-demo-page'); }
  function animateNavigation() {
    const key = JSON.stringify([state.page,state.week,effectiveView(),effectiveView() === 'day' ? state.day : null]);
    if (lastNavigationMotionKey !== null && key !== lastNavigationMotionKey) {
      navigationAnimation?.cancel(); navigationAnimation = null;
      if (!motionPreference?.matches) {
        navigationAnimation = q('#cs-title').animate?.([{transform:'translateY(2px)',opacity:.8},{transform:'translateY(0)',opacity:1}],{duration:160,easing:'cubic-bezier(.2,.7,.2,1)'});
      }
    }
    lastNavigationMotionKey = key;
  }
  function render() {
    if(sicknessView&&(state.page!=='schedule'||state.role==='employee'||!cloudCapabilities.plan))sicknessView.destroy();
    if(profileAppLogin&&!canManageProfileAppLogin(employeeProfileId))clearProfileAppLogin();
    if(needsPlanningProjection())return;
    const nextTimeContext=state.role==='employee'?'employee':state.page;
    if(nextTimeContext!==timeContext){timeLoadedKey='';timeContext=nextTimeContext;}
    if(realEmployee()){if(state.role!=='employee'&&state.page==='chat'&&cloudCapabilities.manageChat)state.role='admin';else if(hasAccountAccess()&&(state.role!=='employee'||!employeeData?.person)){state.role='admin';state.page='accounts';}else state.role='employee';}
    if(employeeProfileId&&!staff.some(person=>person.id===employeeProfileId))employeeProfileId=null;
    if(payrollState.personId&&(state.page!=='people'||state.role==='employee'||payrollState.personId!==employeeProfileId||!canViewPayroll()))clearPayroll();
    if(payrollPolicyView&&(state.page!=='payroll'||state.role==='employee'||!canViewPayroll()))clearPayrollPolicy();
    chatView?.setActive?.(chatActive());renderSession();renderPageHelp();
    q('#cs-series-count').textContent=String(persistence?.isPartial&&planningSeriesCount!==null?planningSeriesCount:new Set(state.series.map(series=>series.groupId||series.id)).size);
    const employee = state.role === 'employee';
    root.dataset.role = employee ? 'employee' : 'admin'; q('#cs-employee-root').hidden = !employee; q('.cs-sidebar').hidden = false; q('.cs-sidebar').inert = false; q('.cs-main').hidden = employee; renderCloudStatus();
    root.querySelectorAll('.cs-nav-button[data-page]').forEach(button => { const current=!employee&&button.dataset.page===state.page,wasCurrent=button.getAttribute('aria-current')==='page';if(current){button.setAttribute('aria-current','page');if(isCompact()&&!wasCurrent)button.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:motionPreference?.matches?'auto':'smooth'});}else button.removeAttribute('aria-current'); });
    if (employee&&employeeWorkspace==='calendar') q('#cs-open-employee').setAttribute('aria-current','page'); else q('#cs-open-employee').removeAttribute('aria-current');
    root.querySelectorAll('[data-employee-workspace]').forEach(button=>{if(employee&&button.dataset.employeeWorkspace===employeeWorkspace)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    if (employee) { calendarDispose?.(); calendarDispose = null; renderEmployee(); return; }
    q('#cs-leave-count').textContent=String(pendingLeaveCount());
    q('.cs-head-actions').hidden=['accounts','people','hours','leave','workspace','activity','payroll','workflow','chat'].includes(state.page);
    if(['workspace','activity','people','payroll','leave','workflow','chat'].includes(state.page)){
      calendarDispose?.();calendarDispose=null;root.dataset.page=state.page;root.dataset.view=state.page;
      const labels={chat:['Chat','Samtaler i dine afdelinger'],workflow:['Vagtanmodninger','Vagtbytte, ledige vagter og læsestatus'],workspace:['Indstillinger',canManageSiteGps()?'Virksomhed, arbejdssteder og eksempeldata':'Virksomhed, kontaktoplysninger og eksempeldata'],leave:['Fravær','Anmodninger, ferie og friønsker'],activity:['Historik','Hvem ændrede hvad · og hvornår'],people:['Medarbejdere','Team, funktioner og aftalte timer'],payroll:['Løn og tillæg','Løngrupper, tildeling og personlige aftaler']};
      const [title,caption]=state.page==='people'&&employeeProfileId?['Medarbejderprofil','Kalender, oplysninger og aftaler']:labels[state.page];q('#cs-title').textContent=title;q('#cs-crumb').textContent=title;q('#cs-description').textContent=caption;
      for(const selector of ['#cs-department-switcher','#cs-week-toolbar','.cs-filters','.cs-footer','#cs-day-strip','#cs-selection-bar','#cs-demo-session-bar'])q(selector).hidden=true;
      if(state.page==='chat')renderChat();else if(state.page==='workflow')renderWorkflow('manager');else if(state.page==='workspace')renderWorkspace();else if(state.page==='activity')renderActivity();else if(state.page==='leave')renderLeave();else if(state.page==='payroll')renderPayrollPolicyPage();else renderRoster();icons();animateNavigation();return;
    }
    if(state.page==='accounts'&&hasAccountAccess()){
      calendarDispose?.();calendarDispose=null;root.dataset.page='accounts';root.dataset.view='accounts';
      q('#cs-title').textContent='Brugere og roller';q('#cs-crumb').textContent='Brugere og roller';q('#cs-description').textContent='Konti, roller og tilladelser';
      for(const selector of ['#cs-department-switcher','#cs-week-toolbar','.cs-filters','.cs-footer','#cs-day-strip','#cs-selection-bar','#cs-demo-session-bar'])q(selector).hidden=true;
      renderAccounts();icons();return;
    }
    if(state.page==='hours'){
      calendarDispose?.();calendarDispose=null;root.dataset.page='hours';root.dataset.view='hours';clearSelection(false);
      q('#cs-title').textContent='Timer';q('#cs-crumb').textContent='Timer';q('#cs-description').textContent='Tidsregistrering, godkendelse og løngrundlag';
      for(const selector of ['#cs-department-switcher','.cs-filters','.cs-footer','#cs-day-strip','#cs-selection-bar','#cs-demo-session-bar','#cs-view-switch','#cs-zoom-controls'])q(selector).hidden=true;
      const periodLabel=q('#cs-week-title'),periodTrigger=q('#cs-date-jump');if(periodLabel.parentElement!==periodTrigger)periodTrigger.append(periodLabel);
      const range=timeRange(), activeWeek=q('#cs-active-week');
      q('#cs-week-toolbar').hidden=false;
      activeWeek.hidden=true;
      activeWeek.textContent='';
      q('#cs-week-title').textContent=shortDate(range.from)+' – '+shortDate(range.to)+' '+date(range.to).getUTCFullYear();
      q('#cs-prev-week').disabled=state.week<=-52;q('#cs-next-week').disabled=state.week>=52;q('#cs-prev-week').setAttribute('aria-label','Forrige uge');q('#cs-next-week').setAttribute('aria-label','Næste uge');
      renderHours();icons();animateNavigation();return;
    }
    renderDepartments();
    const nextSelectionScope = JSON.stringify([state.page,state.week,effectiveView(),state.search,state.site,state.departmentId,state.onlyOpen]);
    if (selectionScope !== nextSelectionScope) { clearSelection(false); selectionScope = nextSelectionScope; }
    const oldScroll = scrollContainer(), scroll = oldScroll ? {top:oldScroll.scrollTop,left:oldScroll.scrollLeft} : null;
    const focusedShift = document.activeElement?.dataset?.shift, focusedDay = document.activeElement?.dataset?.day;
    const scrollWasFocused = document.activeElement === oldScroll;
    const reusableCalendar=state.page==='schedule'&&effectiveView()!=='day'&&calendarViewportBoard?.update&&calendarViewportBoard.element===oldScroll&&oldScroll?.isConnected;
    if (!reusableCalendar) { calendarDispose?.();calendarDispose=null;calendarViewportBoard=null; }
    const isSchedule = state.page === 'schedule', isDay = effectiveView() === 'day';
    const periodLabel=q('#cs-week-title'),periodTrigger=q('#cs-date-jump');if(isSchedule&&periodLabel.parentElement!==periodTrigger)periodTrigger.append(periodLabel);
    root.style.setProperty('--cs-row', design.rowHeight + 'px'); root.dataset.view = effectiveView(); root.dataset.page = state.page;
    const titles = {schedule:'Vagtplan',people:'Medarbejdere',leave:'Fravær',hours:'Timer',series:'Vagtserier',demo:'Eksempler',accounts:'Brugere og roller'};
    q('#cs-title').textContent = titles[state.page]; q('#cs-crumb').textContent = titles[state.page];
    const department = isSchedule ? selectedDepartment() : null;
    const scopeSites = department ? department.siteIds.length : allowedSiteIndices().length;
    q('#cs-description').textContent = state.page === 'accounts' ? 'Konti, invitationer og tilladelser' : state.page === 'demo' ? 'Afprøv funktionerne med realistiske eksempeldata' : state.page === 'series' ? 'Faste ugedage · én samlet redigering' : isSchedule ? (department ? (department.kind === 'customer' ? 'Kunde' : 'Filial') : 'Alle afdelinger') + ' · ' + scopeSites + (scopeSites === 1 ? ' arbejdssted' : ' arbejdssteder') : state.page === 'people' ? 'Team og arbejdssteder' : state.page === 'leave' ? 'Friønsker og godkendt fravær' : 'Planlagte timer · ugentligt overblik';
    q('.cs-filters').hidden = ['demo','accounts'].includes(state.page); q('.cs-footer').hidden = ['demo','accounts'].includes(state.page); renderDemoSession();
    root.querySelectorAll('[data-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.group === state.group)));
    root.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === effectiveView())));
    q('#cs-week-toolbar').hidden = !['schedule','hours'].includes(state.page); q('#cs-view-switch').hidden = !isSchedule; q('#cs-group-switch').hidden = true;
    q('#cs-zoom-controls').hidden = !isSchedule || isDay; q('#cs-calendar-help').hidden = !isSchedule || isDay;
    root.querySelectorAll('#cs-zoom-controls [data-zoom]').forEach(button => button.setAttribute('aria-pressed',String(Number(button.dataset.zoom) === state.zoom)));
    q('#cs-day-strip').hidden = !isSchedule || !isDay; q('#cs-new').hidden = !isSchedule && state.page !== 'series'; q('#cs-new').replaceChildren(icon('plus'),document.createTextNode(state.page === 'series' ? 'Opret vagtserie' : 'Opret vagt')); q('#cs-publish').hidden = !isSchedule; q('.cs-draft').hidden = !isSchedule;
    q('#cs-site-filter-label').hidden = state.page === 'leave'; q('#cs-legend').hidden = !isSchedule || isDay; q('#cs-plan-count').hidden = !isSchedule;
    const header=plannerHeader(),partialCalendar=usesViewportCalendar()&&loadedCalendarWeeks().length<calendarWeeks();
    q('#cs-review').hidden = !isSchedule;q('#cs-review-count').textContent = header.drift===null?'—':String(header.drift);
    q('#cs-undo').hidden = !lastUndo;
    q('#cs-attention').hidden = !isSchedule; const openCount = (isSchedule && !isDay ? loadedCalendarWeeks().flatMap(day=>shiftsInRange(day,addDays(day,6))) : shifts()).filter(shift => !shift.person && inDepartment(shift.site)).length;
    q('#cs-attention span').textContent = partialCalendar&&!openCount?'Ledige vagter':openCount + (openCount === 1 ? ' ledig vagt' : ' ledige vagter'); q('#cs-attention').setAttribute('aria-pressed', String(state.onlyOpen)); q('#cs-attention').disabled = !partialCalendar&&openCount === 0 && !state.onlyOpen;q('#cs-attention').title=partialCalendar?'Ledige vagter i indlæste uger':'';
    q('#cs-reset-filters').hidden = !hasFilters();
    q('#cs-search').placeholder = isSchedule || state.page === 'series' ? 'Medarbejder' : 'Søg medarbejder…';
    const week = dates(), activeWeek = q('#cs-active-week');
    activeWeek.hidden = !isSchedule;
    activeWeek.textContent = isSchedule ? 'Uge ' + weekNumber(week[0]) : '';
    q('#cs-week-title').textContent = isSchedule
      ? plannerWeekFormat.formatRange(date(week[0]),date(week[6]))
      : shortDate(week[0]) + ' – ' + shortDate(week[6]) + ' ' + date(week[6]).getUTCFullYear();
    const navStep = 1;
    q('#cs-prev-week').setAttribute('aria-label','Forrige ' + navStep + (navStep === 1 ? ' uge' : ' uger'));
    q('#cs-next-week').setAttribute('aria-label','Næste ' + navStep + (navStep === 1 ? ' uge' : ' uger'));
    q('#cs-prev-week').disabled = state.week <= -52; q('#cs-next-week').disabled = state.week >= 52;
    q('#cs-status').textContent = header.changes===null?'Gennemgå plan':header.published ? 'Udgivet' : !header.hasPublished ? 'Kladde' : header.changes ? header.changes + (header.changes === 1 ? ' ændret vagt' : ' ændrede vagter') + (department ? ' i alt' : '') : 'Kladde';
    q('.cs-draft').dataset.state = header.published ? 'published' : header.changes ? 'changed' : 'draft'; q('#cs-publish').dataset.state = q('.cs-draft').dataset.state;
    q('#cs-changes-count').textContent = header.changes===null?'—':String(header.changes);
    q('#cs-changes-toggle').setAttribute('aria-label','Gennemgå ændringer i uge ' + weekNumber(dates()[0]));
    q('#cs-planning-tools').hidden = !isSchedule;
    q('#cs-selection-toggle').hidden = isDay;
    q('.cs-review-label').textContent = 'Overblik'; q('#cs-review').setAttribute('aria-label','Driftsoverblik for alle afdelinger i uge ' + weekNumber(dates()[0]) + (header.drift===null?'':' · ' + header.drift + ' punkter')); q('#cs-review').title = 'Driftsoverblik for alle afdelinger i uge ' + weekNumber(dates()[0]); q('#cs-publish').disabled = publicationBusy||!cloudLoaded;
    q('#cs-leave-count').textContent = String(pendingLeaveCount());
    visibleShifts = [];
    if (isSchedule) { if (isDay) { renderDayStrip(); renderDay(); } else renderWeek(); }
    else if (state.page === 'accounts') renderAccounts(); else if (state.page === 'demo') renderDemoPage(); else if (state.page === 'series') renderSeries(); else if (state.page === 'people') renderPeople(); else if (state.page === 'hours') renderHours(); else renderLeave();
    const paged = state.page === 'people' || state.page === 'hours';
    const start = visibleCount ? state.pageIndex * pageSize + 1 : 0, end = Math.min((state.pageIndex + 1) * pageSize, visibleCount);
    q('#cs-page-label').textContent = paged ? start + '–' + end + ' af ' + visibleCount : state.page === 'leave' ? visibleCount + ' anmodninger' : isDay || state.onlyOpen ? visibleCount + (visibleCount === 1 ? ' vagt' : ' vagter') : visibleCount + ' arbejdssteder';
    q('#cs-prev-page').hidden = !paged; q('#cs-next-page').hidden = !paged;
    q('#cs-prev-page').disabled = state.pageIndex === 0; q('#cs-next-page').disabled = (state.pageIndex + 1) * pageSize >= visibleCount;
    q('.cs-pager').hidden = isSchedule || state.page === 'series';
    q('#cs-plan-count').textContent = state.onlyOpen
      ? visibleShifts.length + (visibleShifts.length === 1 ? ' ledig vagt' : ' ledige vagter') + (visibleShifts.length ? ' · ' + niceHours(visibleShifts.reduce((sum, shift) => sum + duration(shift), 0)) + ' ubesatte timer' : '')
      : visibleShifts.length + (visibleShifts.length === 1 ? ' vagt' : ' vagter') + ' · ' + niceHours(visibleShifts.filter(shift => shift.person).reduce((sum, shift) => sum + duration(shift), 0)) + ' planlagte timer';
    if(partialCalendar)q('#cs-plan-count').textContent+=' · indlæste uger';
    if (isSchedule) {
      const available = new Set(visibleShifts.map(shift => String(shift.id)));
      selectedIds = new Set([...selectedIds].filter(id => available.has(id)));
    } else clearSelection(false);
    renderSelection(); icons();
    const key = renderKey(), nextScroll = scrollContainer();
    if (scroll && key === lastRenderKey && nextScroll && nextScroll!==oldScroll) { nextScroll.scrollTop = scroll.top; nextScroll.scrollLeft = scroll.left; }
    if (focusedShift) {const target=[...root.querySelectorAll('[data-shift]')].find(button => button.dataset.shift === focusedShift);if(target&&target!==document.activeElement)target.focus({preventScroll:true});}
    else if (focusedDay !== undefined) q('#cs-day-strip [data-day="' + focusedDay + '"]')?.focus({preventScroll:true});
    else if (scrollWasFocused&&nextScroll!==document.activeElement) nextScroll?.focus({preventScroll:true});
    lastRenderKey = key;
    if(isSchedule&&!isDay)calendarViewportBoard?.observeViewport?.({restore:plannerViewport.restore});
    plannerViewport.restore=true;
    schedulePlannerWarm();
    animateNavigation();
    if (!q('#cs-operations-layer').hidden) renderOperations();
    if (!q('#cs-needs-layer').hidden) renderNeeds();
    if (!q('#cs-replacement-layer').hidden) renderReplacement();
  }
  function sourceSeries() { return state.series.find(series => series.id === activeEdit?.seriesId); }
  function editorCutoff(source,scope) {
    if(!source||scope!=='future')return null;
    return editorSeriesManagement?q('#cs-repeat-start').value:occurrenceAnchor(activeEdit?.id,source.id);
  }
  function editorCadence() {
    const source=sourceSeries()||editorTemplate,weekInterval=Number(q('#cs-repeat-interval').value||1);
    if(weekInterval===2)return {weekInterval,weekAnchor:editorWeekAnchor||Engine.weekMonday(q('#cs-repeat-start').value)};
    return source?.weekInterval!==undefined||source?.weekAnchor!==undefined||editorWeekAnchor?{weekInterval:1,...(editorWeekAnchor?{weekAnchor:editorWeekAnchor}:{})}:{};
  }
  function captureEditorDraft(scope=editorPreviousScope) {
    const original=scope==='one'?activeEdit:sourceSeries(),note=q('#cs-edit-note').value;
    const description=descriptionEditor?descriptionEditor.getData():{note:note.trim()?note:'',...(note===(original?.note||'')&&original?.noteRich?{noteRich:original.noteRich}:{})};
    return {person:q('#cs-edit-person').value,site:q('#cs-edit-site').value,start:q('#cs-edit-start').value,end:q('#cs-edit-end').value,plannedBreakMinutes:readPlannedBreak(),
      startDate:q('#cs-repeat-start').value,endDate:q('#cs-repeat-end').value,openEnded:editorOpenEnded,...editorCadence(),weekdays:[...repeatDays],dayTimes:JSON.parse(JSON.stringify(editorDayTimes)),customDayTimes:q('#cs-day-times-enabled').checked,preserve:q('#cs-preserve-exceptions').checked,...description};
  }
  function applyEditorDraft(draft) {
    q('#cs-edit-person').value=draft.person;q('#cs-edit-site').value=String(draft.site);q('#cs-edit-start').value=draft.start;q('#cs-edit-end').value=draft.end;q('#cs-edit-break').value=String(draft.plannedBreakMinutes??0);
    q('#cs-repeat-start').value=draft.startDate;q('#cs-repeat-end').value=draft.endDate;editorOpenEnded=Engine.isOpenEnded(draft);repeatDays=new Set(draft.weekdays);q('#cs-repeat-interval').value=String(draft.weekInterval??1);editorWeekAnchor=draft.weekAnchor||null;syncSeriesDurationControls();
    q('#cs-preserve-exceptions').checked=draft.preserve!==false;q('#cs-edit-note').value=draft.note||'';descriptionEditor?.setContent(draft);
    editorDayTimes=JSON.parse(JSON.stringify(draft.dayTimes||{}));q('#cs-day-times-enabled').checked=draft.customDayTimes??Object.keys(editorDayTimes).length>0;q('#cs-day-times').dataset.days='';
  }
  function editorRepeats() { return Boolean(sourceSeries() ? q('#cs-edit-scope').value !== 'one' : !activeEdit?.id && q('#cs-edit-repeat').checked); }
  function uniqueSeriesId() { return 'sr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6); }
  function readDescriptionData() {
    if (descriptionEditor) { const value = descriptionEditor.getData(); return {note:value.note,...(value.noteRich ? {noteRich:value.noteRich} : {})}; }
    const original = q('#cs-edit-scope').value !== 'one' ? sourceSeries() || activeEdit : activeEdit;
    const text = q('#cs-edit-note').value, unchanged = text === (original?.note || '');
    return {note:text.trim() ? text : '',...(unchanged && typeof original?.noteRich === 'string' && original.noteRich ? {noteRich:original.noteRich} : {})};
  }
  function readDescription() { return readDescriptionData().note; }
  function readPlannedBreak(){return Number(q('#cs-edit-break').value||0);}
  function readSeriesDraft() {
    const source = sourceSeries();
    const custom=q('#cs-day-times-enabled').checked,dayTimes={};
    if(custom)[...repeatDays].forEach(day=>{dayTimes[day]={...(editorDayTimes[day]||{start:q('#cs-edit-start').value,end:q('#cs-edit-end').value}),plannedBreakMinutes:editorDayTimes[day]?.plannedBreakMinutes??readPlannedBreak()};});
    const groupId=source?.groupId||(source&&q('#cs-edit-scope').value==='future'?source.id:editorTemplate?.groupId);
    return {id:source && q('#cs-edit-scope').value === 'all' ? source.id : editorSeriesId,person:q('#cs-edit-person').value,site:Number(q('#cs-edit-site').value),startDate:q('#cs-repeat-start').value,endDate:editorOpenEnded?Engine.OPEN_END:q('#cs-repeat-end').value,...(editorOpenEnded||source?.openEnded!==undefined||editorTemplate?.openEnded!==undefined?{openEnded:editorOpenEnded}:{}),...editorCadence(),weekdays:[...repeatDays].sort((a,b) => a-b),start:q('#cs-edit-start').value,end:q('#cs-edit-end').value,plannedBreakMinutes:readPlannedBreak(),...(groupId?{groupId}:{}),...(custom||source?.dayTimes!==undefined||editorTemplate?.dayTimes!==undefined?{dayTimes}:{}),...readDescriptionData()};
  }
  function syncDayTimeControls(repeating) {
    const custom=repeating&&q('#cs-day-times-enabled').checked,container=q('#cs-day-times'),days=[...repeatDays].sort((a,b)=>a-b),key=days.join(',');
    q('#cs-day-times-toggle').hidden=!repeating;q('#cs-uniform-times').hidden=custom;q('#cs-uniform-break').hidden=custom;q('#cs-day-break-help').hidden=!custom;container.hidden=!custom;
    q('#cs-edit-start').required=!custom;q('#cs-edit-end').required=!custom;
    q('#cs-edit-break').disabled=custom;q('#cs-edit-break').required=!custom;
    const start=q('#cs-edit-start').value,end=q('#cs-edit-end').value,overnight=Boolean(start&&end&&end<start),gross=Engine.plannedMinutes({start,end,plannedBreakMinutes:0}),pause=readPlannedBreak();
    q('#cs-edit-overnight').hidden=!overnight;q('#cs-edit-overnight').title=overnight?'Slutter '+shortDate(addDays(q('#cs-edit-date').value||today,1)):'';
    q('#cs-edit-break').max=String(Math.max(0,gross-1));q('#cs-edit-net-time').textContent=Number.isSafeInteger(pause)&&pause>=0&&pause<gross?workTime(gross-pause)+' planlagt arbejdstid':'Kontrollér tid og pause';
    if(!custom){root.querySelectorAll('[data-series-time]').forEach(input=>{input.disabled=true;input.required=false;});return;}
    if(container.dataset.days!==key){
      container.replaceChildren();container.dataset.days=key;
      const heading=node('div','cs-day-time-head');['Dag','Fra','Til','Pause · min'].forEach(label=>heading.append(node('span',null,label)));container.append(heading);
      days.forEach(day=>{
        if(!editorDayTimes[day])editorDayTimes[day]={start:q('#cs-edit-start').value,end:q('#cs-edit-end').value,plannedBreakMinutes:readPlannedBreak()};
        const row=node('div','cs-day-time-row');row.append(node('span','cs-day-time-name',dayNames[day]));
        ['start','end','plannedBreakMinutes'].forEach(field=>{const isPause=field==='plannedBreakMinutes',cell=node('div','cs-field'),input=node('input');input.type=isPause?'number':'time';input.step=isPause?'1':'60';if(isPause)input.min='0';input.value=String(editorDayTimes[day][field]??readPlannedBreak());input.dataset.seriesDay=String(day);input.dataset.seriesTime=field;input.setAttribute('aria-label',dayNames[day]+(isPause?' planlagt pause i minutter':field==='start'?' fra':' til'));input.addEventListener('input',()=>{editorDayTimes[day][field]=isPause?Number(input.value||0):input.value;updatePreview();});cell.append(input);if(!isPause)shiftEditorPickers?.attach(input);row.append(cell);});container.append(row);
      });
    }
    root.querySelectorAll('[data-series-time]').forEach(input=>{input.disabled=!custom;input.required=custom;});
    for(const row of container.querySelectorAll('.cs-day-time-row')){const end=row.querySelector('[data-series-time="end"]'),day=end?Number(end.dataset.seriesDay):null,times=editorDayTimes[day],label=row.querySelector('.cs-day-time-name');if(label&&times)label.textContent=dayNames[day]+(times.end<times.start?' · +1 dag':'');}
  }
  function seriesDraftError(draft,source,scope) {
    if(!SeriesLifecycle)return '';
    if(editorExtension){
      const group=SeriesLifecycle.groupSeries(state.series,{today,edits:state.edits,deleted:state.deleted}).find(item=>item.id===editorExtension.groupId);
      if(!group||JSON.stringify(group.latest)!==editorExtension.signature)return 'Serien er ændret, siden forlængelsen blev åbnet. Luk og vælg Forlæng igen.';
      if(draft.startDate!==addDays(group.endDate,1))return 'Forlængelsen skal starte dagen efter den seneste periode.';
    }
    const phases=state.series.filter(item=>item.id!==source?.id);
    if(source&&scope==='future'){const cutoff=editorCutoff(source,scope);if(cutoff>source.startDate){const prior={...source,endDate:addDays(cutoff,-1),...(source.openEnded!==undefined?{openEnded:false}:{})};if(!Engine.validate(prior).length&&seriesHasOccurrences(prior))phases.push(prior);}}
    phases.push(draft);return SeriesLifecycle.validate(phases)[0]||'';
  }
  function unchangedSeries(draft,source,scope,result) {
    const times=value=>JSON.stringify([...value.weekdays].sort((a,b)=>a-b).map(day=>[day,value.dayTimes?.[day]?.start||value.start,value.dayTimes?.[day]?.end||value.end,value.dayTimes?.[day]?.plannedBreakMinutes??value.plannedBreakMinutes??0]));
    return Boolean(source&&result?.valid&&!result.changedCount&&Engine.isOpenEnded(draft)===Engine.isOpenEnded(source)&&draft.endDate===source.endDate&&(scope==='future'||draft.startDate===source.startDate)
      &&['person','site','start','end','note','noteRich'].every(key=>(draft[key]??'')===(source[key]??''))&&(draft.plannedBreakMinutes??0)===(source.plannedBreakMinutes??0)
      &&Engine.weekInterval(draft)===Engine.weekInterval(source)&&(Engine.weekInterval(draft)!==2||Engine.weekAnchor(draft)===Engine.weekAnchor(source))
      &&times(draft)===times(source)
      &&[...draft.weekdays].sort().join(',')===[...source.weekdays].sort().join(','));
  }
  function syncEditorDescription(reset = false) {
    const content=readDescriptionData(),doc=descriptionEditor&&Description?.normalize(content.noteRich);
    let tasks=0;const count=item=>{if(item.type==='taskItem')tasks++;(item.content||[]).forEach(count);};if(doc)count(doc);
    const hasContent=Boolean(doc?tasks||Description.hasContent(doc):content.note?.trim());
    q('#cs-description-summary-meta').textContent=tasks?tasks+(tasks===1?' opgave':' opgaver'):hasContent?'Med beskrivelse':'';
    if(reset)q('#cs-description-details').open=!editorRepeats()&&hasContent;
  }
  function syncSeriesEditor(repeating,source) {
    q('#cs-editor-title').textContent=repeating?(editorOperation==='extend'?'Forlæng vagtserie':editorOperation==='copy'?'Kopiér vagtserie':source?'Rediger vagtserie':'Opret vagtserie'):(activeEdit?.id?'Rediger vagt':'Opret vagt');
    syncDayTimeControls(repeating);
    q('#cs-series-operation-note').hidden=!repeating||!['copy','extend'].includes(editorOperation);
    q('#cs-series-operation-note').textContent=editorOperation==='extend'
      ? 'Den nye periode begynder efter '+shortDate(editorExtension?.endDate||today)+'.'
      : 'Kopien indeholder ugemønster, beskrivelse og tjekliste. Manuelle ændringer og afkrydsninger følger ikke med.';
    const panel=q('#cs-editor-layer .cs-editor');panel.classList?.toggle('cs-series-editor',repeating);
    q('#cs-repeat-days-field').hidden=!repeating;q('#cs-repeat-interval').disabled=!repeating;q('#cs-series-planning-preview').hidden=!repeating;q('#cs-series-scope-block').hidden=!source;
    root.querySelectorAll('[data-series-only]').forEach(element=>element.hidden=!repeating);
    root.querySelectorAll('[data-single-only]').forEach(element=>element.hidden=repeating);
    syncEditorDescription(editorWasSeries!==repeating);
    editorWasSeries=repeating;
    q('#cs-edit-find-replacement').hidden=repeating||!activeEdit?.id||!activeEdit?.person;
    q('#cs-edit-sickness').hidden=repeating||!activeEdit?.id||!activeEdit?.person||state.demoSession||!cloudCapabilities.plan;
    q('#cs-repeat-field').hidden=Boolean(activeEdit?.id||source||editorSeriesCreation);
    const scope=q('#cs-edit-scope').value,oneOption=[...(q('#cs-edit-scope').options||[])].find(option=>option.value==='one');
    if(oneOption){oneOption.hidden=editorSeriesManagement;oneOption.disabled=editorSeriesManagement;}
    const future=[...(q('#cs-edit-scope').options||[])].find(option=>option.value==='future');
    if(future){future.textContent=editorSeriesManagement?'Fra en dato og frem':'Denne og kommende vagter';future.disabled=Boolean(editorSeriesManagement&&source&&today>source.endDate);}
    q('#cs-series-scope-help').hidden=!repeating||!source||scope!=='all'||source.startDate>=today;
    q('#cs-series-scope-help').textContent='Ændringen omfatter også tidligere vagter i serien.';
    q('#cs-series-start-label').textContent=source&&scope==='future'&&editorSeriesManagement?'Gælder fra':'Startdato';
    q('#cs-repeat-start').min=source&&scope==='future'?(editorSeriesManagement?[today,source.startDate].sort().at(-1):occurrenceAnchor(activeEdit.id,source.id)):'';
    q('#cs-repeat-start').max=source&&scope==='future'&&editorSeriesManagement?source.endDate:'';
    q('#cs-repeat-start').readOnly=Boolean(editorExtension);
    syncSeriesDurationControls(repeating);
  }
  function renderSeriesPlanningPreview(draft,source,scope) {
    if(!SeriesPlanner)return;
    const result=SeriesPlanner.preview({draft,source:source||null,scope:source?scope:'all',cutoff:editorCutoff(source,scope),edits:state.edits,deleted:state.deleted,preserve:q('#cs-preserve-exceptions').checked,today});
    const previewValid = result.valid && result.attached.length > 0;
    const sentence = q('#cs-series-sentence');
    const summary = q('#cs-series-preview');
    sentence.hidden = !previewValid;
    summary.replaceChildren();
    summary.dataset.valid = String(previewValid);
    if (!previewValid) {
      sentence.textContent = '';
      const message = result.errors[0] || 'Perioden indeholder ingen planlagte vagter. Vælg andre dage eller datoer.';
      const waitingForPerson = result.errors.length === 1 && !draft.person && message === 'Vælg en medarbejder.';
      summary.append(node('p', waitingForPerson ? 'cs-series-result-effect' : 'cs-series-preview-error', message));
    } else {
      const days = draft.weekdays.map(day => dayNames[day].slice(0, 3).toLocaleLowerCase('da-DK') + '.');
      const cadence = Engine.weekInterval(draft) === 2 ? ' hver anden uge' : '';
      const times = Object.keys(draft.dayTimes || {}).length ? 'Tider pr. dag' : clockLabel(draft);
      sentence.textContent = days.join(', ') + cadence + ' · ' + times;
      const total = node('div', 'cs-series-result-total');
      const noun = result.total === 1 ? 'vagt' : 'vagter';
      const target = result.limited ? noun + ' i forhåndsvisningen' : editorOperation === 'extend'
        ? (result.total === 1 ? 'ny ' : 'nye ') + noun + ' i forlængelsen' : noun + ' efter gemning';
      total.append(node('strong', null, String(result.total)), node('span', null, target));
      summary.append(total);

      const formatDate = new Intl.DateTimeFormat('da-DK', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
      const period = result.openEnded ? 'Uden slutdato · fra ' + formatDate.format(date(draft.startDate))
        : formatDate.formatRange(date(draft.startDate), date(draft.endDate));
      summary.append(node('p', 'cs-series-result-period', period));
      if (result.limited) summary.append(node('p', 'cs-series-result-effect',
        'Viser ' + formatDate.formatRange(date(result.range.from), date(result.range.to))));
      if (source) {
        const effects = [
          result.updatedCount && result.updatedCount + ' ændres',
          result.createdCount && result.createdCount + (result.createdCount === 1 ? ' ny' : ' nye'),
          result.removedCount && result.removedCount + ' udgår'
        ].filter(Boolean);
        if (Engine.isOpenEnded(source) && !Engine.isOpenEnded(draft)) effects.unshift('Serien afsluttes');
        if (effects.length) summary.append(node('p', 'cs-series-result-effect', effects.join(' · ')));
        else if (Engine.isOpenEnded(source) === Engine.isOpenEnded(draft)) {
          summary.append(node('p', 'cs-series-result-effect', result.limited ? 'Ingen ændringer i forhåndsvisningen' : 'Ingen vagter ændres'));
        }
      }
    }

    const calendar = q('#cs-series-calendar');
    const calendarAssessment = seriesCalendarAssessment(draft, result, source, scope);
    calendar.hidden = !previewValid;
    seriesCalendarPreview = previewValid ? {draft, result, assessment:calendarAssessment} : null;
    if (!previewValid) calendar.replaceChildren();
    else if (SeriesCalendar) renderSeriesCalendar();
    else {
      calendar.replaceChildren();
      const focus = result.shifts.find(shift => shift.date >= today)?.date || result.first?.date || draft.startDate;
      const first=focus.slice(0,7)+'-01',month=date(first),label=month.toLocaleDateString('da-DK',{month:'long',year:'numeric',timeZone:'UTC'}),grid=node('div','cs-series-calendar-grid');
      calendar.setAttribute('aria-label','Vagter i '+label);calendar.append(node('h4',null,label));['M','T','O','T','F','L','S'].forEach(day=>grid.append(node('span','cs-series-calendar-weekday',day)));
      const offset=(month.getUTCDay()+6)%7,marked=new Set(result.shifts.map(shift=>shift.date));
      for(let index=0;index<offset;index++)grid.append(node('span','cs-series-calendar-blank'));
      for(let day=first;day.slice(0,7)===first.slice(0,7);day=addDays(day,1)){const cell=node('span','cs-series-calendar-date'+(marked.has(day)?' has-shift':''),String(Number(day.slice(-2))));if(marked.has(day))cell.setAttribute('aria-label',fullDate(day)+' · vagt');grid.append(cell);}calendar.append(grid);
    }
    const exceptions=result.exceptions;q('#cs-series-exceptions').hidden=!exceptions.count;q('#cs-series-exceptions-title').textContent='Manuelle ændringer ('+exceptions.count+')';
    const preservation = [
      result.preservedCount && result.preservedCount + (result.preservedCount === 1 ? ' særændring' : ' særændringer'),
      result.deletedCount && result.deletedCount + (result.deletedCount === 1 ? ' aflysning' : ' aflysninger')
    ].filter(Boolean).join(' og ');
    if (preservation) q('#cs-exceptions-summary').textContent = preservation + ' bevares.';
    const exceptionList=q('#cs-series-exception-list');exceptionList.replaceChildren();exceptions.ids.slice(0,10).forEach(id=>{const shift=state.edits[id],removed=state.deleted.includes(id),day=shift?.date||occurrenceAnchor(id,source?.id);exceptionList.append(node('li',null,(day?shortDate(day):'Vagt')+' · '+(removed?'Aflyst':shift?clockLabel(shift):'Manuelt ændret')));});
    if(exceptions.ids.length>10)exceptionList.append(node('li',null,'Og '+(exceptions.ids.length-10)+' flere.'));
    const lifecycleError=previewValid?seriesDraftError(draft,source,scope):'';
    if(lifecycleError)summary.append(node('p','cs-series-preview-error',lifecycleError));
    q('#cs-save-label').textContent=editorOperation==='extend'?'Tilføj '+result.total+' vagter':editorOperation==='copy'?'Opret kopi':source?'Gem vagtserie':'Opret vagtserie';
    q('#cs-save').disabled=Boolean(!previewValid||lifecycleError||calendarAssessment.conflicts.length||selectedStaffing?.status==='blocked'||unchangedSeries(draft,source,scope,result));
  }
  function seriesCalendarAssessment(draft,result,source,scope) {
    if(!SeriesCalendar||!result.valid||!result.shifts.length)return {conflicts:[],pendingRequests:[]};
    const data=snapshot();scopeDraft(data,source,scope,draft);const existing=conflictShiftsForWeeks(result.shifts.map(shift=>staffingMonday(shift.date)),data);
    return SeriesCalendar.assess({shifts:result.shifts,existing,blockedDates:approvedLeaveDates(),pendingRequests:pendingLeaveDates()});
  }
  function renderSeriesCalendar() {
    if(!SeriesCalendar||!seriesCalendarPreview)return;
    const {draft,result,assessment}=seriesCalendarPreview;
    const calendar=q('#cs-series-calendar');
    const previous=document.activeElement?.dataset?.seriesCalendarFocus;
    SeriesCalendar.render({element:calendar,document,draft:result.limited?{...draft,startDate:result.range.from,endDate:result.range.to}:draft,shifts:result.shifts,conflicts:assessment.conflicts,pendingRequests:assessment.pendingRequests,unavailableDates:unavailableDatesFor(draft.person,result.shifts),availabilityStatus:selectedStaffing?.availabilityStatus,today,sites,personName,state:seriesCalendarState,
      onChange:next=>{seriesCalendarState=next;renderSeriesCalendar();}});
    if (previous) {
      const find = key => calendar.querySelector?.('[data-series-calendar-focus="'+key+'"]');
      const restored = find(previous);
      const fallback = previous === 'next' ? find('previous') : find('next');
      const control = restored && !restored.disabled ? restored : fallback && !fallback.disabled ? fallback
        : calendar.querySelector?.('button[aria-pressed="true"],button[data-date]');
      control?.focus({preventScroll:true});
    }
  }
  function staffingMonday(value) { return addDays(value,-((date(value).getUTCDay() + 6) % 7)); }
  function workTime(minutes) { const hours = Math.floor(minutes / 60), rest = minutes % 60; return hours + ' t' + (rest ? ' ' + rest + ' min' : ''); }
  function pendingLeaveDates() {
    return leaveRequests.filter(request => (state.requests[request.id] || request.status) === 'pending')
      .flatMap(request => request.days.map(day => ({person:request.p,date:day,type:request.type})));
  }
  function staffingContext() {
    const repeating = editorRepeats(), source = sourceSeries(), scope = q('#cs-edit-scope').value;
    let templates = [], errors = [], referenceDate = q('#cs-edit-date').value, removedIds = activeEdit?.id ? [activeEdit.id] : [];
    if (repeating) {
      const draft = {...readSeriesDraft(),person:'staffing-candidate'}; referenceDate = draft.startDate;
      errors = Engine.validate(draft);
      if (source && scope === 'future' && draft.startDate < editorCutoff(source,scope)) errors.unshift('Startdatoen kan ikke ligge før den valgte vagt.');
      if (!errors.length) templates = Engine.enumerate(draft,seriesOperationRange(draft));
      if (source && !errors.length) {
        const cutoff = editorCutoff(source,scope);
        if(scope==='future'&&(!Actions.validDate(cutoff)||cutoff<source.startDate||cutoff>source.endDate)){errors.push('Vælg en dato inden for den eksisterende serie.');templates=[];return {valid:false,error:errors[0],repeating,referenceDate,weekStart:staffingMonday(Actions.validDate(referenceDate)?referenceDate:today),templates:[],removedIds:[],existing:[]};}
        removedIds = seriesOccurrences(source).filter(shift => !cutoff || occurrenceAnchor(shift.id,source.id) >= cutoff).map(shift => shift.id);
        if(q('#cs-preserve-exceptions').checked){const preserved=new Set(Engine.exceptionPreview({source,scope,cutoff,edits:state.edits,deleted:state.deleted}).ids);templates=templates.filter(shift=>!preserved.has(source.id+'@'+occurrenceAnchor(shift.id,draft.id)));removedIds=removedIds.filter(id=>!preserved.has(id));}
      }
    } else {
      const draft = {id:activeEdit?.id || editorSeriesId + '-preview',person:'staffing-candidate',date:referenceDate,site:Number(q('#cs-edit-site').value),start:q('#cs-edit-start').value,end:q('#cs-edit-end').value,plannedBreakMinutes:readPlannedBreak(),note:readDescription()};
      errors = Engine.validate({id:draft.id,person:draft.person,site:draft.site,startDate:draft.date,endDate:draft.date,weekdays:[0],start:draft.start,end:draft.end,plannedBreakMinutes:draft.plannedBreakMinutes});
      if (!errors.length) templates = [draft];
    }
    const validReference = Actions.validDate(referenceDate), weekStart = staffingMonday(validReference ? referenceDate : Actions.validDate(activeEdit?.date) ? activeEdit.date : today);
    const weekStarts = new Set([weekStart,...templates.map(shift => staffingMonday(shift.date))]);
    const existing=conflictShiftsForWeeks(weekStarts);
    if(repeating&&source&&Engine.requiresRange(source)&&!errors.length){
      const cutoff=editorCutoff(source,scope),preserved=new Set(q('#cs-preserve-exceptions').checked?Engine.exceptionPreview({source,scope,cutoff,edits:state.edits,deleted:state.deleted}).ids:[]);
      removedIds=[...new Set([...removedIds,...existing.filter(shift=>{const anchor=occurrenceAnchor(shift.id,source.id);return anchor&&(!cutoff||anchor>=cutoff)&&!preserved.has(shift.id);}).map(shift=>shift.id)])];
    }
    return {valid:!errors.length && templates.length > 0,error:errors[0] || (!templates.length ? 'Vælg dato, tid og mindst én arbejdsdag.' : ''),repeating,limited:repeating&&Engine.requiresRange(readSeriesDraft()),referenceDate,weekStart,templates,removedIds,existing};
  }
  function assessStaffing(person, context = staffingContextCache) {
    return withAvailability(Staffing.assess({person,proposed:context.valid ? context.templates.map(shift => ({...shift,person:person.id})) : [],existing:context.existing,removedIds:context.removedIds,weekStart:context.weekStart,blockedDates:approvedLeaveDates(),pendingRequests:pendingLeaveDates()}),person.id,context.templates);
  }
  function staffingSentence(text) { return text.endsWith('.') ? text : text + '.'; }
  function staffingStatus(result) {
    if (result.status === 'incomplete') return 'Vælg dato og tid';
    if (result.status === 'available') return result.unavailableDates?.length?'Utilgængelig':result.availabilityStatus==='loading'?'Tjekker tilgængelighed…':['error','unknown'].includes(result.availabilityStatus)?'Ikke kontrolleret':'Kan tildeles';
    if (result.conflicts.length > 1) return result.conflicts.length + ' konflikter';
    return result.conflicts[0]?.type === 'leave' ? 'Godkendt fravær' : 'Overlap';
  }
  function staffingReason(result) {
    const conflict = result.conflicts[0];
    if (conflict) {
      const other = conflict.other;
      return conflict.type === 'leave' ? staffingSentence('Godkendt fravær den ' + shortDate(conflict.date))
        : (conflict.type === 'internal' ? 'De nye vagter overlapper hinanden' : 'Har allerede en vagt') + ' den ' + shortDate(conflict.date) + (other ? ' · ' + clockLabel(other) + ' · ' + (sites[other.site]?.name || 'Ukendt arbejdssted') : '') + '.';
    }
    if(result.unavailableDates?.length)return 'Utilgængelig den '+shortDate(result.unavailableDates[0])+(result.unavailableDates.length>1?' · '+result.unavailableDates.length+' datoer':'')+'.';
    const request = result.pendingRequests[0];
    return request ? staffingSentence(request.type + ' afventer svar · ' + shortDate(request.date) + (result.pendingRequests.length > 1 ? ' og ' + (result.pendingRequests.length - 1) + ' andre datoer' : '')) : result.availabilityStatus==='error'?'Tilgængelighed kunne ikke kontrolleres.':'';
  }
  function staffingHours(result) { return 'Nu ' + workTime(result.currentMinutes) + ' af ' + workTime(result.targetMinutes) + (result.status === 'incomplete' ? ' · tildeling afventer dato og tid' : ' · efter tildeling ' + workTime(result.projectedMinutes)); }
  function refreshStaffing() {
    if (!activeEdit) return;
    staffingContextCache = staffingContext(); staffingAssessments = new Map();
    const person = personFor(q('#cs-edit-person').value), context = staffingContextCache, summary = q('#cs-person-summary');
    if(person&&context.valid)requestPlanningAvailability(context.templates,[person.id],true);
    selectedStaffing = person ? assessStaffing(person,context) : null;
    if (person) staffingAssessments.set(person.id,selectedStaffing);
    q('#cs-person-selected-name').textContent = person?.name || (context.repeating ? 'Vælg medarbejder' : 'Ledig vagt');
    summary.replaceChildren(); summary.dataset.state = selectedStaffing?.status === 'blocked' ? 'blocked' : selectedStaffing?.overTargetWeeks.length ? 'over-target' : selectedStaffing?.status || 'unassigned';
    if (person) {
      if(!context.repeating&&context.valid)summary.append(node('span','cs-person-summary-hours','Uge '+weekNumber(context.weekStart)+' · '+staffingHours(selectedStaffing)));
      const reason = staffingReason(selectedStaffing);
      if (reason) { const line = node('span','cs-person-summary-warning',reason); line.dataset.state = selectedStaffing.status;if(selectedStaffing.unavailableDates?.length)line.dataset.kind='unavailable';summary.append(line); }
      else if (context.repeating||selectedStaffing.status==='incomplete'||['loading','unknown'].includes(selectedStaffing.availabilityStatus)) summary.append(node('span','cs-person-summary-title',staffingStatus(selectedStaffing)+(context.repeating&&context.valid?(context.limited?' · viste periode':' · hele perioden'):'')));
      if (selectedStaffing.overTargetWeeks.length) summary.append(node('span','cs-person-summary-warning','Med ' + (context.repeating ? 'vagterne' : 'vagten') + ' overskrides det aftalte timetal i ' + selectedStaffing.overTargetWeeks.length + (selectedStaffing.overTargetWeeks.length === 1 ? ' uge.' : ' uger.')));
    }
    q('#cs-save').disabled = Boolean(selectedStaffing?.status === 'blocked');
    if (staffPickerOpen) renderStaffPicker();
  }
  function renderStaffPicker() {
    if (!staffingContextCache) return;
    const context = staffingContextCache, search = q('#cs-person-search'), list = q('#cs-person-results');
    const term = search.value.trim().toLocaleLowerCase('da-DK'), current = q('#cs-edit-person').value;
    const searchChanged = term !== staffPickerTerm;
    if (searchChanged) { staffPickerTerm = term; staffPickerPage = 0; }
    const matching = staff.filter(person => (person.active !== false || person.id === current) && person.name.toLocaleLowerCase('da-DK').includes(term));
    const pageSize = 50, pages = Math.max(1, Math.ceil(matching.length / pageSize));
    staffPickerPage = Math.min(staffPickerPage, pages - 1);
    const offset = staffPickerPage * pageSize;
    const candidates = matching.slice(offset, offset + pageSize);
    requestPlanningAvailability(context.templates, candidates.map(person => person.id));
    const entries = candidates.map(person => {
      if (!staffingAssessments.has(person.id)) staffingAssessments.set(person.id, assessStaffing(person, context));
      return {person, result: staffingAssessments.get(person.id)};
    }).sort((a,b) => Number(a.result.status === 'blocked') - Number(b.result.status === 'blocked')
      || Number(Boolean(a.result.unavailableDates?.length)) - Number(Boolean(b.result.unavailableDates?.length))
      || a.person.name.localeCompare(b.person.name, 'da-DK'));

    const parts = [];
    if (entries.some(({result}) => result.valid && result.status !== 'blocked')) parts.push('Uge ' + weekNumber(context.weekStart) + ' · Timer efter tildeling / aftalt');
    if (entries.length && !context.valid) parts.push('Udfyld vagtens dato og tid for at se tilgængelighed.');
    if (entries.length && context.valid && context.limited) parts.push('Tilgængelighed for de viste vagter');
    if (entries.some(({result}) => result.availabilityStatus === 'loading')) parts.push('Tjekker tilgængelighed…');
    const caption = q('#cs-person-context');
    caption.textContent = parts.join(' · ');
    caption.hidden = !parts.length;

    const focused = document.activeElement;
    const previousRow = list.contains(focused) ? focused.id : null;
    const scroll = list.scrollTop;
    list.replaceChildren();
    function option(person, result) {
      const id = person?.id || '', row = node('button','cs-person-option'); row.type = 'button'; row.id = 'cs-person-option-' + (id || 'open'); row.dataset.person = id;
      const blocked = result?.status === 'blocked';
      row.dataset.status = result?.status || 'available';
      row.dataset.overTarget = String(Boolean(result?.valid && result.projectedMinutes > result.targetMinutes));
      row.dataset.unavailable = String(Boolean(result?.unavailableDates?.length));
      row.setAttribute('aria-pressed', String(current === id));
      if (blocked) row.setAttribute('aria-disabled', 'true');
      const main = node('span', 'cs-person-option-main');
      main.append(node('span', 'cs-person-name', person?.name || 'Ledig vagt'));
      if (result?.valid && !blocked) main.append(node('span', 'cs-person-option-hours', workTime(result.projectedMinutes) + ' / ' + workTime(result.targetMinutes)));
      row.append(main);
      if (result) {
        const conflict = result.conflicts[0];
        let detail = staffingReason(result);
        if (conflict?.other) {
          const {other} = conflict;
          detail = ['Overlap', shortDate(conflict.date), clockLabel(other), sites[other.site]?.name].filter(Boolean).join(' · ');
        } else if (!detail && result.availabilityStatus === 'unknown') detail = 'Tilgængelighed delvist kontrolleret';
        const warnings = detail ? [detail] : [];
        if (result.conflicts.length > 1) warnings.push('+' + (result.conflicts.length - 1) + (result.conflicts.length === 2 ? ' konflikt' : ' konflikter'));
        if (!blocked) {
          const otherWeeks = result.overTargetWeeks.filter(week => week.weekStart !== context.weekStart);
          if (otherWeeks.length === 1) warnings.push('Over aftalt tid i uge ' + weekNumber(otherWeeks[0].weekStart));
          else if (otherWeeks.length > 1) warnings.push('Over aftalt tid i ' + otherWeeks.length + ' andre uger');
        }
        if (warnings.length) row.append(node('span', 'cs-person-option-detail', warnings.join(' · ')));
      }
      row.addEventListener('click', () => {
        if (blocked) return;
        q('#cs-edit-person').value = id;
        closeStaffPicker();
        updatePreview();
      });
      list.append(row);
    }
    if (!context.repeating && (!term || 'ledig vagt'.includes(term))) option(null,null);
    entries.forEach(({person, result}) => option(person, result));
    const empty = q('#cs-person-empty');
    empty.hidden = list.children.length > 0;
    empty.textContent = empty.hidden ? '' : term ? 'Ingen søgeresultater' : 'Ingen medarbejdere';
    if (pages > 1) {
      const pager = node('div', 'cs-roster-pagination');
      pager.append(node('span', '', (offset + 1) + '–' + Math.min(matching.length, offset + pageSize) + ' af ' + matching.length));
      for (const [label, step] of [['Forrige', -1], ['Næste', 1]]) {
        const control = node('button', 'cs-button', label);
        control.type = 'button';
        control.id = step < 0 ? 'cs-person-page-previous' : 'cs-person-page-next';
        control.disabled = step < 0 ? staffPickerPage === 0 : staffPickerPage === pages - 1;
        control.addEventListener('click', () => {
          staffPickerPage += step;
          renderStaffPicker();
          list.scrollTop = 0;
          list.querySelector('.cs-person-option[data-person]:not([data-person=""])')?.focus({preventScroll: true});
        });
        pager.append(control);
      }
      list.append(pager);
    }
    list.scrollTop = searchChanged ? 0 : scroll;
    if (previousRow) {
      const replacement = [...list.querySelectorAll('button')].find(button => button.id === previousRow && !button.disabled);
      (replacement || search).focus({preventScroll: true});
      if (replacement) revealStaffOption(list, replacement);
    }
  }

  function revealStaffOption(list, option) {
    const bounds = list.getBoundingClientRect(), row = option.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }

  function openStaffPicker(term = '') {
    if (!activeEdit) return;
    const picker = q('#cs-person-picker'), trigger = q('#cs-person-trigger'), search = q('#cs-person-search');
    staffPickerOpen = true;
    staffPickerPage = 0;
    staffPickerTerm = '';
    search.value = term;
    globalThis.CleanRoomsCombobox?.closeAll(root);
    shiftEditorPickers?.close();
    picker.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    refreshStaffing();
    q('#cs-person-results').scrollTop = 0;
    picker.scrollIntoView({block: 'nearest'});
    search.focus({preventScroll:true});
  }
  function closeStaffPicker(restoreFocus = true) {
    if (!staffPickerOpen) return;
    const picker = q('#cs-person-picker'), trigger = q('#cs-person-trigger');
    staffPickerOpen = false;
    picker.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  function updatePreview() {
    if (!activeEdit) return;
    paintEditorBudgetImpact();
    const proposedDay=q('#cs-edit-date').value;
    if(editorRepeats()&&ensureEditorScope(()=>updatePreview()))return;
    if(hasWindowLoading()&&persistence.isPartial&&!editorRepeats()&&Actions.validDate(proposedDay)&&!planningRangeLoaded(staffingMonday(proposedDay),addDays(staffingMonday(proposedDay),6))){
      q('#cs-save').disabled=true;
      if(!planningReadBusy)withPlanningDates([activeEdit.date,proposedDay],()=>updatePreview(),'editor');return;
    }
    q('#cs-save').disabled=false;q('#cs-delete').disabled=false;q('#cs-series-delete-apply').disabled=false;
    q('#cs-edit-error').hidden = true;q('#cs-series-delete-confirm').hidden=true; refreshStaffing();
    renderPlannerChecklist();
    const repeating = editorRepeats(), source = sourceSeries(), scope = q('#cs-edit-scope').value;
    let exceptionView=null;try{if(source&&scope!=='one')exceptionView=Engine.exceptionPreview({source,scope,cutoff:editorCutoff(source,scope),edits:state.edits,deleted:state.deleted});}catch{}
    q('#cs-exceptions-field').hidden=!exceptionView?.count;
    q('#cs-exceptions-summary').textContent=exceptionView?.count?(q('#cs-preserve-exceptions').checked?'Tilpassede vagter og aflysninger bevares, også når du ændrer ugedage.':'Manuelle ændringer fjernes. Vagterne følger det nye mønster.'):'';
    q('#cs-series-preview').hidden = !repeating;
    q('#cs-single-date-field').hidden = repeating; q('#cs-edit-date').disabled = repeating;
    q('#cs-repeat-options').hidden = !repeating; q('#cs-repeat-start').disabled = !repeating; q('#cs-repeat-end').disabled = !repeating||editorOpenEnded;
    q('#cs-repeat-start').required = repeating; q('#cs-repeat-end').required = repeating&&!editorOpenEnded;
    root.querySelectorAll('[data-repeat-day]').forEach(button => button.setAttribute('aria-pressed',String(repeatDays.has(Number(button.dataset.repeatDay)))));
    syncSeriesEditor(repeating,source);
    const deletingSeries = source && scope !== 'one'; q('#cs-delete').replaceChildren(icon('trash-2'),document.createTextNode(deletingSeries ? scope === 'all' ? 'Slet hele serien' : 'Slet kommende vagter' : 'Slet vagt'));
    if (!repeating) { q('#cs-save-label').textContent = activeEdit.id ? 'Gem ændringer' : 'Opret vagt';paintEditorPlanningConflict(); return; }
    const draft = readSeriesDraft(), errors = Engine.validate(draft);
    if (source && scope === 'future' && draft.startDate < editorCutoff(source,scope)) errors.unshift('Startdatoen kan ikke ligge før den valgte vagt.');
    if (draft.startDate) { q('#cs-repeat-end').min = draft.startDate; q('#cs-repeat-end').max = PlanData?.maxDate||Engine.OPEN_END; }
    const proposed = errors.length ? [] : Engine.enumerate(draft,seriesOperationRange(draft));
    q('#cs-series-preview').textContent = errors[0] || (proposed.length ? proposed.length + (proposed.length === 1 ? ' vagt' : ' vagter') + ' · ' + draft.weekdays.map(day => dayNames[day].toLocaleLowerCase('da-DK')).join(', ') + ' · ' + shortDate(draft.startDate) + ' – ' + shortDate(draft.endDate) : 'Perioden indeholder ingen af de valgte ugedage.');
    if (deletingSeries) {
      const cutoff = editorCutoff(source,scope);
      const count = seriesOccurrences(source).filter(shift => !cutoff || occurrenceAnchor(shift.id,source.id) >= cutoff).length;
      q('#cs-series-preview').textContent += ' · Omfatter ' + count + (count === 1 ? ' eksisterende vagt.' : ' eksisterende vagter.');
    }
    q('#cs-save-label').textContent = (source ? 'Opdater ' : 'Opret ') + proposed.length + (proposed.length === 1 ? ' vagt' : ' vagter');
    renderSeriesPlanningPreview(draft,source,scope);
    paintEditorPlanningConflict();
  }
  function changeEditorScope() {
    if(q('#cs-edit-scope').value!=='one'&&ensureEditorScope(()=>changeEditorScope()))return;
    if(paintEditorPlanningConflict())return;
    const source=sourceSeries(),scope=q('#cs-edit-scope').value,previous=editorPreviousScope,current=captureEditorDraft(previous);
    if(!source)return;
    editorScopeDrafts.set(previous,current);
    if(previous!=='one')editorSharedSeriesDraft=current;
    const stored=editorScopeDrafts.get(scope);
    let draft;
    if(scope==='one')draft=stored||{...activeEdit,startDate:source.startDate,endDate:source.endDate,weekdays:[...source.weekdays],preserve:true};
    else draft={...source,weekdays:[...source.weekdays],preserve:true,...editorSharedSeriesDraft,
      startDate:stored?.startDate||(scope==='all'?source.startDate:editorSeriesManagement?SeriesPlanner?.chooseFutureAnchor(source,{today,edits:state.edits,deleted:state.deleted})?.anchor||[today,source.startDate].sort().at(-1):occurrenceAnchor(activeEdit.id,source.id)),endDate:stored?.endDate||source.endDate};
    closeStaffPicker(false);applyEditorDraft(draft);editorPreviousScope=scope;configureRepeat(false);
  }
  function syncSeriesDurationControls(repeating=editorRepeats()) {
    root.querySelectorAll('[data-series-months]').forEach(button=>{let selected=false;try{selected=!editorOpenEnded&&Engine.addMonths(editorExtension?.endDate||q('#cs-repeat-start').value,Number(button.dataset.seriesMonths))===q('#cs-repeat-end').value;}catch{}button.setAttribute('aria-pressed',String(selected));});
    q('#cs-repeat-unlimited').setAttribute('aria-pressed',String(editorOpenEnded));
    q('#cs-repeat-end-field').hidden=editorOpenEnded;
    q('#cs-repeat-end').disabled=!repeating||editorOpenEnded;q('#cs-repeat-end').required=repeating&&!editorOpenEnded;
  }
  function chooseSeriesLength(months) {
    if(months===null){editorOpenEnded=true;q('#cs-repeat-end').value=Engine.OPEN_END;}
    else if([1,3,6].includes(months)&&Actions.validDate(q('#cs-repeat-start').value)){editorOpenEnded=false;q('#cs-repeat-end').value=Engine.addMonths(editorExtension?.endDate||q('#cs-repeat-start').value,months);}
    else return;
    syncSeriesDurationControls();updatePreview();
  }
  function configureRepeat(resetRange = false, deferPreview = false) {
    const source = sourceSeries(), scope = q('#cs-edit-scope').value;
    q('#cs-scope-field').hidden = !source; q('#cs-repeat-field').hidden = Boolean(activeEdit?.id || source);
    if (resetRange) {
      const baseDate = q('#cs-edit-date').value || activeEdit.date;
      repeatDays = new Set(source ? source.weekdays : [(date(baseDate).getUTCDay() + 6) % 7]);
      q('#cs-repeat-start').value = source ? scope === 'future' ? editorSeriesManagement?SeriesPlanner?.chooseFutureAnchor(source,{today,edits:state.edits,deleted:state.deleted})?.anchor||[today,source.startDate].sort().at(-1):occurrenceAnchor(activeEdit.id,source.id) : source.startDate : baseDate;
      q('#cs-repeat-end').value = source ? source.endDate : Engine.addMonths(baseDate,6);editorOpenEnded=Engine.isOpenEnded(source);
    }
    q('#cs-repeat-start').min = source && scope === 'future' ? occurrenceAnchor(activeEdit.id,source.id) : '';
    syncSeriesDurationControls();if(!deferPreview)updatePreview();
  }
  function renderPlannerChecklist() {
    const box = q('#cs-checklist-planner-progress'), shift = activeEdit?.id ? shiftById(activeEdit.id) : null, view = shift ? checklistView(shift) : null;
    box.hidden = !view?.total || q('#cs-edit-scope').value !== 'one';
    box.textContent = view?.total ? 'Fremdrift på denne vagt · ' + view.checked + ' af ' + view.total + ' opgaver udført' : '';
  }
  function editorDraftFingerprint() {
    const fields=['#cs-edit-person','#cs-edit-site','#cs-edit-date','#cs-edit-start','#cs-edit-end','#cs-edit-break','#cs-repeat-start','#cs-repeat-end','#cs-edit-scope','#cs-repeat-interval'];
    return JSON.stringify({fields:fields.map(selector=>q(selector)?.value??''),repeat:q('#cs-edit-repeat').checked,preserve:q('#cs-preserve-exceptions').checked,dayTimesEnabled:q('#cs-day-times-enabled').checked,days:[...repeatDays].sort(),dayTimes:editorDayTimes,openEnded:editorOpenEnded,weekAnchor:editorWeekAnchor,description:readDescriptionData()});
  }
  function editorHasDirtyDraft(){return Boolean(activeEdit&&editorDirtyBaseline!==null&&editorDirtyBaseline!==editorDraftFingerprint());}
  function dismissEditorDiscard(){
    if(!editorDiscard)return;
    const current=editorDiscard;editorDiscard=null;current.element.hidden=true;current.element.remove?.();q('.cs-editor').inert=current.wasInert;
  }
  function confirmEditorLeave(continuation){
    if(!editorHasDirtyDraft())return true;
    if(editorDiscard)return false;
    const origin=document.activeElement,layer=node('div','cs-editor-discard-layer'),panel=node('section','cs-editor-discard'),title=node('h3',null,'Kassér ændringer?');title.id='cs-editor-discard-title';
    panel.setAttribute('role','alertdialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby',title.id);panel.setAttribute('aria-describedby','cs-editor-discard-copy');
    const copy=node('p',null,'Du har ændringer, som ikke er gemt.');copy.id='cs-editor-discard-copy';
    const actions=node('div','cs-editor-discard-actions'),cancel=node('button','cs-button cs-editor-discard-cancel','Behold kladde'),discard=node('button','cs-button cs-primary cs-editor-discard-confirm','Kassér ændringer');cancel.type=discard.type='button';
    const current={element:layer,wasInert:Boolean(q('.cs-editor').inert)};
    current.cancel=()=>{if(editorDiscard!==current)return;dismissEditorDiscard();(origin?.isConnected?origin:q('#cs-close'))?.focus?.({preventScroll:true});};
    current.accept=()=>{if(editorDiscard!==current)return;dismissEditorDiscard();closeEditor({force:true});continuation?.();};
    cancel.addEventListener('click',current.cancel);discard.addEventListener('click',current.accept);actions.append(cancel,discard);panel.append(title,copy,actions);layer.append(panel);q('#cs-editor-layer').append(layer);editorDiscard=current;q('.cs-editor').inert=true;
    layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();current.cancel();}else if(event.key==='Tab'){event.preventDefault();(document.activeElement===cancel?discard:cancel).focus({preventScroll:true});}});
    cancel.focus({preventScroll:true});return false;
  }
  function openEditor(shift, trigger, options = {}) {
    if(activeEdit&&!confirmEditorLeave(()=>{const current=shift.id?shiftById(shift.id):shift;if(current)openEditor(current,trigger,options);else notify('Vagten findes ikke længere.');}))return false;
    const wide=options.repeat||options.scope&&options.scope!=='one'||options.seriesManagement||options.extension;
    const selection=detailSelection(shift.id?[shift]:[]);
    if(!wide&&shift.id&&!options.detailsLoaded&&!state.demoSession&&cloudCapabilities.plan&&persistence?.details&&persistence.isPartial)return withPlannerDetails(selection,()=>{const current=shiftById(shift.id);if(current)return openEditor(current,trigger,{...options,detailsLoaded:true});notify('Vagten findes ikke længere.');return false;});
    if(wide){
      const source=state.series.find(item=>item.id===shift.seriesId),template=options.template||source;
      const range=template?seriesOperationRange(template):{from:shift.date,to:Engine.addMonths(shift.date,6)},from=range.from,to=range.to;
      const projection={...seriesProjection(source,[[from,to]].map(([from,to])=>({from,to}))),...(options.extension?.groupId?{groupId:options.extension.groupId}:{})};
      if(!scopeLoaded(projection))return withPlanningScope(projection,()=>{
        if(options.seriesManagement){const fresh=state.series.find(item=>item.id===shift.seriesId);if(!fresh){notify('Vagtserien findes ikke længere.');releasePlanningHold('editor');return false;}return openSeriesEditor(fresh,trigger);}
        const current=shift.id?shiftById(shift.id):shift;if(!current){notify('Vagten findes ikke længere.');releasePlanningHold('editor');return false;}
        return openEditor(current,trigger,options);
      },'editor');
      if(hasWindowLoading())planningScopeHolds.set('editor',projection);
    }
    closeOperationsSheets();
    closeStaffPicker(false); closeBulkEditor(false); closeChanges(false); closeGroupEditor(false);
    editorDirtyBaseline=null;
    activeEdit = {...shift,...(options.demoScenario ? {demoScenario:options.demoScenario} : {})}; renderDemoEditorGuide(); lastTrigger = trigger || q('#cs-new'); editorSeriesId = uniqueSeriesId();
    editorPlanCapture=PlanningReconcile?.capture(state,{shifts:shift.id?[shift]:[],seriesId:shift.seriesId||null,groupId:options.extension?.groupId||null})||null;
    editorOperation=options.operation||(shift.id?'edit':'create');editorTemplate=options.template||null;editorExtension=options.extension||null;seriesCalendarState={};seriesCalendarPreview=null;
    editorSeriesManagement=options.seriesManagement===true;editorSeriesCreation=options.repeat===true;editorScopeDrafts=new Map();editorSharedSeriesDraft=null;editorPreviousScope=options.scope||'one';editorWasSeries=null;q('#cs-description-details').open=false;q('#cs-series-delete-confirm').hidden=true;
    const cadenceSource=sourceSeries()||options.template;q('#cs-repeat-interval').value=String(cadenceSource?.weekInterval??1);editorWeekAnchor=cadenceSource?.weekAnchor||null;
    editorDayTimes=JSON.parse(JSON.stringify(sourceSeries()?.dayTimes||options.template?.dayTimes||{}));q('#cs-day-times-enabled').checked=Object.keys(editorDayTimes).length>0;q('#cs-day-times').dataset.days='';
    q('#cs-editor-title').textContent = options.repeat || shift.seriesId && options.scope === 'all' ? shift.seriesId ? 'Rediger vagtserie' : 'Opret vagtserie' : shift.id ? 'Rediger vagt' : 'Opret vagt';
    q('#cs-edit-person').value = shift.person; q('#cs-edit-site').value = String(shift.site); q('#cs-edit-date').removeAttribute('min'); q('#cs-edit-date').removeAttribute('max'); q('#cs-edit-date').value = shift.date;
    q('#cs-edit-start').value = shift.start; q('#cs-edit-end').value = shift.end; q('#cs-edit-break').value=String(shift.plannedBreakMinutes??0); q('#cs-edit-note').value = shift.note || '';
    descriptionEditor?.setContent(shift);
    q('#cs-edit-repeat').checked = Boolean(options.repeat); q('#cs-edit-scope').value = options.scope || 'one';q('#cs-preserve-exceptions').checked=true;
    q('#cs-delete').hidden = !shift.id; q('#cs-edit-error').hidden = true; q('#cs-editor-layer').hidden = false;
    q('#cs-edit-find-replacement').hidden = !shift.id || !shift.person;
    q('#cs-edit-sickness').hidden = !shift.id || !shift.person || state.demoSession || !cloudCapabilities.plan;
    configureRepeat(true,Boolean(options.template));
    if(options.template){editorSeriesId=options.template.id;applyEditorDraft(options.template);updatePreview();}
    render();editorDirtyBaseline=editorDraftFingerprint(); q('.cs-editor-fields').scrollTop = 0; q('#cs-close').focus({preventScroll:true});
  }
  function openSeriesEditor(series, trigger) {
    const projection=seriesProjection(series);if(!scopeLoaded(projection))return withPlanningScope(projection,()=>{const fresh=state.series.find(item=>item.id===series.id);if(fresh)return openSeriesEditor(fresh,trigger);notify('Vagtserien findes ikke længere.');releasePlanningHold('editor');},'editor');
    const future=SeriesPlanner?.chooseFutureAnchor(series,{today,edits:state.edits,deleted:state.deleted});
    const occurrence=future?.base||Engine.enumerate(series,seriesOperationRange(series))[0]||{id:series.id+'@'+series.startDate,seriesId:series.id,date:series.startDate};
    openEditor({...occurrence,person:series.person,site:series.site,start:series.start,end:series.end,plannedBreakMinutes:series.plannedBreakMinutes??0,note:series.note||'',...(series.noteRich?{noteRich:series.noteRich}:{})},trigger,{scope:series.endDate>=today?'future':'all',seriesManagement:true});
  }
  function copySeriesEditor(series,trigger) {
    const projection=seriesProjection(series);if(!scopeLoaded(projection))return withPlanningScope(projection,()=>{const fresh=state.series.find(item=>item.id===series.id);if(fresh)return copySeriesEditor(fresh,trigger);notify('Vagtserien findes ikke længere.');releasePlanningHold('editor');},'editor');
    if(!SeriesLifecycle)return;
    const span=Math.round((date(series.endDate)-date(series.startDate))/86400000),startDate=series.startDate>today?series.startDate:today;
    const result=SeriesLifecycle.copyDraft(series,{id:uniqueSeriesId(),startDate,endDate:Engine.isOpenEnded(series)?Engine.OPEN_END:addDays(startDate,Math.min(span,365))});
    // The empty assignment is intentional: the planner chooses the recipient in the editor.
    if(!result.ok)return notify(result.error);
    const draft={...result.draft,person:''};
    openEditor({...draft,date:draft.startDate,id:undefined,seriesId:undefined},trigger,{repeat:true,operation:'copy',template:draft});
  }
  function extendSeriesEditor(source,trigger) {
    const selected=source.phases?source.latest:source,projection={...seriesProjection(selected),groupId:source.phases?source.id:selected.groupId||selected.id};if(!scopeLoaded(projection))return withPlanningScope(projection,()=>{const fresh=state.series.find(item=>item.id===selected.id);if(fresh)return extendSeriesEditor(fresh,trigger);notify('Vagtserien findes ikke længere.');releasePlanningHold('editor');},'editor');
    if(!SeriesLifecycle)return;
    const group=source.phases?source:SeriesLifecycle.groupSeries(state.series,{today,edits:state.edits,deleted:state.deleted}).find(item=>item.id===(source.groupId||source.id));
    if(!group)return;
    const result=SeriesLifecycle.extensionDraft(group,{id:uniqueSeriesId(),months:3});
    if(!result.ok)return notify(result.error);
    const template={...result.draft,...(personFor(result.draft.person)?.active===false?{person:''}:{})};
    openEditor({...template,date:template.startDate,id:undefined,seriesId:undefined},trigger,{repeat:true,operation:'extend',template,extension:{groupId:group.id,endDate:group.endDate,signature:JSON.stringify(group.latest)}});
  }
  function newShift(repeat = false, trigger = q('#cs-new')) { if(!repeat&&usesViewportCalendar()&&!calendarWeekLoaded(dates()[0]))return ensureBaseWeek(()=>newShift(repeat,trigger),'editor');const site = defaultShiftSite(); if (site === undefined) { departmentView?.openManager(state.departmentId); return; } openEditor({person:'',date:repeat?today:effectiveView() === 'day' ? selectedDate() : dates()[2],site,start:'07:00',end:'14:00',note:''},trigger,{repeat}); }
  function closeEditor(options={}) {
    if(!options.force&&!confirmEditorLeave(()=>closeEditor({force:true})))return false;
    dismissEditorDiscard();
    shiftEditorPickers?.close();
    cancelPlannerDetails();
    releasePlanningHold('editor');
    q('#cs-demo-editor-guide').hidden = true;
    closeStaffPicker(false); staffingContextCache = null; staffingAssessments.clear(); selectedStaffing = null;
    const wasOpen = !q('#cs-editor-layer').hidden; q('#cs-editor-layer').hidden = true;q('#cs-series-delete-confirm').hidden=true; const oldId = activeEdit?.id; activeEdit = null;editorPlanCapture=null;editorDirtyBaseline=null; if (!wasOpen) return true;resumePlannerViewport();if(freshnessDeferred)Promise.resolve().then(()=>refreshOnReturn());
    root.querySelectorAll('[data-selected]').forEach(button => button.dataset.selected = 'false');
    const match = oldId ? [...root.querySelectorAll('[data-shift]')].find(button => button.dataset.shift === oldId) : null;
    const contextMatch=lastTrigger?.dataset.productFocus?[...root.querySelectorAll('[data-product-focus]')].find(button=>button.dataset.productFocus===lastTrigger.dataset.productFocus):null;
    (match||contextMatch||(lastTrigger?.isConnected?lastTrigger:q('#cs-new'))).focus({preventScroll:true});
    return true;
  }
  function groupProposal() {
    if (!activeGroup) return null;
    return Actions.planGroup({members:activeGroup.members,existing:conflictShiftsForWeeks([staffingMonday(activeGroup.date)]),
      start:q('#cs-group-start').value,end:q('#cs-group-end').value,blockedDates:approvedLeaveDates(),personName});
  }
  function updateGroupPreview() {
    if (!activeGroup) return;
    const result = groupProposal(), count = activeGroup.members.length;
    const start = q('#cs-group-start').value, end = q('#cs-group-end').value;
    const list = q('#cs-group-preview'); list.replaceChildren();
    activeGroup.members.forEach(before => {
      const after = result.proposed.find(shift => shift.id === before.id) || before;
      const issues = result.issues.filter(issue => issue.id === before.id);
      const row = node('div','cs-group-row'); row.setAttribute('role','listitem'); row.dataset.conflict = String(issues.length > 0);
      row.append(node('span','cs-group-person',personName(before.person)),node('span','cs-group-site',sites[before.site]?.name || 'Ukendt arbejdssted'));
      row.append(node('span','cs-group-times',before.start + '–' + before.end + (after.start !== before.start || after.end !== before.end ? ' → ' + after.start + '–' + after.end : '')));
      if (issues.length) row.append(node('span','cs-group-issue',[...new Set(issues.map(issue => issue.message))].join(' ')));
      list.append(row);
    });
    const summary = q('#cs-group-summary');
    if (!result.ok) summary.textContent = 'Ændringen kan ikke gemmes endnu.';
    else if (!result.changed) summary.textContent = count + (count === 1 ? ' vagt i gruppen. ' : ' vagter i gruppen. ') + 'Vælg en ny start- eller sluttid for at se ændringen.';
    else {
      const beforeHours = activeGroup.members.filter(shift => shift.person).reduce((sum,shift) => sum + duration(shift),0);
      const afterHours = result.proposed.filter(shift => shift.person).reduce((sum,shift) => sum + duration(shift),0), delta = Math.round((afterHours - beforeHours) * 60) / 60;
      summary.textContent = count + (count === 1 ? ' vagt ændres til ' : ' vagter ændres til ') + start + '–' + end + '. ' + niceHours(afterHours) + ' bemandede timer i alt' + (delta ? ' (' + (delta > 0 ? '+' : '') + niceHours(delta) + ' t)' : '') + '.';
    }
    q('#cs-group-error').hidden = result.ok;
    q('#cs-group-error').textContent = result.error ? result.error + ' Hele gruppen gemmes samlet, når problemerne er rettet.' : '';
    q('#cs-group-save').textContent = 'Opdater ' + count + (count === 1 ? ' vagt' : ' vagter');
    q('#cs-group-save').disabled = !result.ok || !result.changed;
    if(selectionPlanningStale(activeGroup)){q('#cs-group-save').disabled=true;q('#cs-group-error').hidden=false;q('#cs-group-error').textContent=staleSelectionMessage;}
  }
  function openGroupEditor(group, trigger) {
    const selection=detailSelection(group?.shifts||[]);
    if(needsPlannerDetails(selection))return withPlannerDetails(selection,()=>{const members=group.shifts.map(shift=>shiftById(shift.id));if(members.some(shift=>!shift)){notify('Tidsgruppen er ændret. Vælg vagterne igen.');return false;}return openGroupEditor({...group,shifts:members},trigger);});
    closeOperationsSheets();
    if (!Array.isArray(group?.shifts) || !group.shifts.length || !Actions.validDate(group.date)) return;
    closeBulkEditor(false); closeChanges(false); closeEditor(); closeReview(); closeGroupEditor(false);
    activeGroup = {date:group.date,start:group.start,end:group.end,members:clone(group.shifts),trigger,planCapture:PlanningReconcile?.capture(state,{shifts:group.shifts})||null};
    q('#cs-group-caption').textContent = fullDate(group.date) + ' · ' + group.start + '–' + group.end;
    const filters = [];
    if (state.site !== 'all') filters.push(sites[Number(state.site)].name);
    if (searchTerm()) filters.push('søgning: ' + state.search.trim());
    if (state.onlyOpen) filters.push('ledige vagter');
    q('#cs-group-scope').textContent = 'Ændringen gælder de ' + group.shifts.length + ' vagter på denne dato' + (filters.length ? ' med de valgte filtre (' + filters.join(' · ') + ')' : '') + '. Alle berørte vagter fremgår af listen.' + (group.shifts.some(shift => shift.seriesId) ? ' Vagter fra serier ændres som enkelte forekomster på denne dato.' : '');
    q('#cs-group-start').value = group.start; q('#cs-group-end').value = group.end;
    trigger?.setAttribute('aria-expanded','true'); q('#cs-group-layer').hidden = false;
    updateGroupPreview(); icons(); q('.cs-group-fields').scrollTop = 0; q('#cs-group-start').focus({preventScroll:true});
  }
  function closeGroupEditor(restoreFocus = true) {
    cancelPlannerDetails();
    const previous = activeGroup, wasOpen = !q('#cs-group-layer').hidden;
    q('#cs-group-layer').hidden = true; activeGroup = null;
    if(wasOpen)resumePlannerViewport();
    previous?.trigger?.setAttribute('aria-expanded','false');
    if (!wasOpen || !restoreFocus) return;
    const match = [...root.querySelectorAll('[data-group-date]')].find(button => button.dataset.groupDate === previous.date && button.dataset.groupStart === (previous.nextStart || previous.start) && button.dataset.groupEnd === (previous.nextEnd || previous.end));
    const target = match || (previous.trigger?.isConnected ? previous.trigger : q('.cs-board-scroll')) || q('#cs-new');
    target.focus({preventScroll:true});
    if (previous.saved && match) match.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function saveGroup(event) {
    event.preventDefault(); if (!activeGroup) return;
    if(planningReadBusy||planningReadBlocked)return;
    if(selectionPlanningStale(activeGroup)){updateGroupPreview();return;}
    if (!q('#cs-group-form').reportValidity()) return;
    const result = groupProposal();
    if (!result.ok || !result.changed) { updateGroupPreview(); return; }
    const data = snapshot(), count = result.proposed.length, day = activeGroup.date;
    result.proposed.forEach(shift => { data.edits[shift.id] = shift; });
    activeGroup.nextStart = q('#cs-group-start').value; activeGroup.nextEnd = q('#cs-group-end').value; activeGroup.saved = true;
    globalThis.CleanRoomsCalendar.revealDay(day);
    commit(data,count + (count === 1 ? ' vagt er opdateret den ' : ' vagter er opdateret den ') + shortDate(day) + ' · ' + clockLabel({start:activeGroup.nextStart,end:activeGroup.nextEnd}) + '.',[[day,day]]);
  }
  function clearSelection(rerender = true) {
    selectedIds.clear(); selectionMode = false;
    if (rerender) render();
  }
  function renderSelection() {
    const show = state.page === 'schedule' && effectiveView() === 'week';
    q('#cs-selection-bar').hidden = !show || !selectionMode;
    q('#cs-selection-toggle').setAttribute('aria-pressed',String(selectionMode));
    q('#cs-selection-toggle').textContent = selectionMode ? 'Afslut valg' : 'Vælg vagter';
    q('#cs-selection-count').textContent = selectedIds.size ? selectedIds.size + (selectedIds.size === 1 ? ' vagt markeret' : ' vagter markeret') : 'Klik på vagter for at markere';
    ['time','move','copy'].forEach(action => { q('#cs-bulk-' + action).disabled = !selectedIds.size; });
  }
  function selectShift(shift, detail = {}) {
    selectionMode = true;
    if (detail.rangeIds?.length) {
      if (!detail.additive) selectedIds.clear();
      detail.rangeIds.forEach(id => selectedIds.add(String(id)));
    } else {
      const id = String(shift.id);
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    }
    render();
  }
  function openBulkEditor(operation, trigger) {
    const selection=detailSelection(visibleShifts.filter(shift=>selectedIds.has(String(shift.id))));
    if(needsPlannerDetails(selection))return withPlannerDetails(selection,()=>openBulkEditor(operation,trigger));
    closeOperationsSheets();
    const members = visibleShifts.filter(shift => selectedIds.has(String(shift.id))).map(shift=>shiftById(shift.id)).filter(Boolean).sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || String(a.id).localeCompare(String(b.id)));
    if (!members.length) return;
    closeEditor(); closeGroupEditor(false); closeReview(); closeChanges(false); closeBulkEditor(false);
    const firstDate = members[0].date, stamp = Date.now().toString(36);
    activeBulk = {operation,members:clone(members),firstDate,trigger,copyIds:Object.fromEntries(members.map((shift,index) => [shift.id,'copy-' + stamp + '-' + index])),planCapture:PlanningReconcile?.capture(state,{shifts:members})||null};
    const action = {time:'Ret tid for',move:'Flyt',copy:'Kopiér'}[operation];
    q('#cs-bulk-title').textContent = action + ' ' + members.length + (members.length === 1 ? ' vagt' : ' vagter');
    const days = [...new Set(members.map(shift => shift.date))];
    q('#cs-bulk-caption').textContent = days.length + (days.length === 1 ? ' dato · ' : ' datoer · ') + shortDate(days[0]) + (days.length > 1 ? ' – ' + shortDate(days.at(-1)) : '');
    q('#cs-bulk-scope').textContent = operation === 'copy' ? 'Der oprettes selvstændige kopier af de markerede vagter. Originalerne og deres serier bevares.' : 'Kun de markerede vagter ændres. Vagter fra serier ændres som enkelte forekomster.';
    const sameTime = members.every(shift => shift.start === members[0].start && shift.end === members[0].end);
    q('#cs-bulk-start').value = sameTime ? members[0].start : ''; q('#cs-bulk-end').value = sameTime ? members[0].end : '';
    q('#cs-bulk-time-fields').hidden = operation !== 'time'; q('#cs-bulk-date-field').hidden = operation === 'time'; q('#cs-bulk-offset').hidden = operation === 'time';
    q('#cs-bulk-start').required = q('#cs-bulk-end').required = operation === 'time';
    q('#cs-bulk-date').required = operation !== 'time'; q('#cs-bulk-date').disabled = operation === 'time';
    q('#cs-bulk-start').disabled = q('#cs-bulk-end').disabled = operation !== 'time';
    q('#cs-bulk-date-label').textContent = operation === 'copy' ? 'Kopiér første dato til' : 'Flyt første dato til';
    q('#cs-bulk-date').min = addDays(anchor,-364); q('#cs-bulk-date').max = addDays(anchor,370);
    q('#cs-bulk-date').value = addDays(firstDate,operation === 'copy' ? 7 : 1);
    q('#cs-bulk-layer').hidden = false; updateBulkPreview(); icons();
    q('.cs-bulk-editor .cs-group-fields').scrollTop = 0;
    q(operation === 'time' ? '#cs-bulk-start' : '#cs-bulk-date').focus({preventScroll:true});
  }
  function bulkProposal() {
    if (!activeBulk) return null;
    const target = q('#cs-bulk-date').value, offsetDays = Actions.validDate(target) ? Math.round((date(target) - date(activeBulk.firstDate)) / 86400000) : NaN;
    const minDate = addDays(anchor,-364), maxDate = addDays(anchor,370), days = new Set(activeBulk.members.map(shift => shift.date));
    if (activeBulk.operation !== 'time' && Number.isFinite(offsetDays)) activeBulk.members.forEach(shift => { const day = addDays(shift.date,offsetDays); if (day >= minDate && day <= maxDate) days.add(day); });
    const existing = new Map(); days.forEach(day => conflictShiftsForWeeks([staffingMonday(day)]).forEach(shift => existing.set(shift.id,shift)));
    return Bulk.plan({members:activeBulk.members,existing:[...existing.values()],operation:activeBulk.operation,start:q('#cs-bulk-start').value,end:q('#cs-bulk-end').value,offsetDays,minDate,maxDate,blockedDates:approvedLeaveDates(),personName,copyIds:activeBulk.copyIds});
  }
  function updateBulkPreview() {
    if (!activeBulk) return;
    if(hasWindowLoading()&&persistence.isPartial&&activeBulk.operation!=='time'&&Actions.validDate(q('#cs-bulk-date').value)){
      const offset=Math.round((date(q('#cs-bulk-date').value)-date(activeBulk.firstDate))/86400000);
      if(activeBulk.members.some(shift=>!planningRangeLoaded(staffingMonday(addDays(shift.date,offset)),addDays(staffingMonday(addDays(shift.date,offset)),6)))){q('#cs-bulk-save').disabled=true;if(!planningReadBusy)withPlanningDates(activeBulk.members.flatMap(shift=>[shift.date,addDays(shift.date,offset)]),()=>updateBulkPreview(),'bulk');return;}
    }
    const result = bulkProposal(), list = q('#cs-bulk-preview'), count = activeBulk.members.length;
    list.replaceChildren();
    activeBulk.members.forEach(before => {
      const afterId = activeBulk.operation === 'copy' ? activeBulk.copyIds[before.id] : before.id;
      const after = result.proposed.find(shift => shift.id === afterId), issues = result.issues.filter(issue => issue.id === before.id);
      const row = node('div','cs-bulk-row'); row.setAttribute('role','listitem'); row.dataset.conflict = String(issues.length > 0);
      row.append(node('span','cs-bulk-person',personName(before.person)),node('span','cs-bulk-site',sites[before.site]?.name || 'Ukendt arbejdssted'));
      row.append(node('span','cs-bulk-before','Før · ' + shortDate(before.date) + ' · ' + before.start + '–' + before.end));
      row.append(node('span','cs-bulk-after',after ? 'Efter · ' + shortDate(after.date) + ' · ' + after.start + '–' + after.end : 'Efter · Vælg gyldige tidspunkter og datoer'));
      if (issues.length) row.append(node('span','cs-group-issue',[...new Set(issues.map(issue => issue.message))].join(' ')));
      list.append(row);
    });
    const operation = activeBulk.operation, target = q('#cs-bulk-date').value;
    const offset = Actions.validDate(target) ? Math.round((date(target) - date(activeBulk.firstDate)) / 86400000) : null;
    q('#cs-bulk-offset').textContent = offset === null ? 'Vælg en gyldig dato.' : 'Alle datoer forskydes ' + Math.abs(offset) + (Math.abs(offset) === 1 ? ' dag ' : ' dage ') + (offset < 0 ? 'tilbage.' : 'frem.') + ' Afstanden mellem vagterne bevares.';
    const verb = {time:'opdateres',move:'flyttes',copy:'kopieres'}[operation];
    q('#cs-bulk-summary').textContent = !result.ok ? 'Handlingen kan ikke gemmes endnu.' : !result.changed ? 'Vælg en ændring for de markerede vagter.' : count + (count === 1 ? ' vagt ' : ' vagter ') + verb + ' samlet. Du kan fortryde hele handlingen én gang.';
    q('#cs-bulk-error').hidden = result.ok; q('#cs-bulk-error').textContent = result.error ? result.error + ' Ingen vagter er gemt.' : '';
    q('#cs-bulk-save').textContent = {time:'Opdater',move:'Flyt',copy:'Kopiér'}[operation] + ' ' + count + (count === 1 ? ' vagt' : ' vagter');
    q('#cs-bulk-save').disabled = !result.ok || !result.changed;
    if(selectionPlanningStale(activeBulk)){q('#cs-bulk-save').disabled=true;q('#cs-bulk-error').hidden=false;q('#cs-bulk-error').textContent=staleSelectionMessage;}
  }
  function closeBulkEditor(restoreFocus = true) {
    cancelPlannerDetails();
    releasePlanningHold('bulk');
    const previous = activeBulk, wasOpen = !q('#cs-bulk-layer').hidden;
    q('#cs-bulk-layer').hidden = true; activeBulk = null;if(wasOpen)resumePlannerViewport();
    if (wasOpen && restoreFocus) (previous?.trigger?.isConnected && !previous.trigger.disabled ? previous.trigger : q('#cs-selection-toggle')).focus({preventScroll:true});
  }
  function saveBulk(event) {
    event.preventDefault(); if (!activeBulk || !q('#cs-bulk-form').reportValidity()) return;
    if(planningReadBusy||planningReadBlocked)return;
    if(hasWindowLoading()&&persistence.isPartial&&activeBulk.operation!=='time'&&Actions.validDate(q('#cs-bulk-date').value)){
      const offset=Math.round((date(q('#cs-bulk-date').value)-date(activeBulk.firstDate))/86400000);
      if(activeBulk.members.some(shift=>!planningRangeLoaded(staffingMonday(addDays(shift.date,offset)),addDays(staffingMonday(addDays(shift.date,offset)),6)))){withPlanningDates(activeBulk.members.flatMap(shift=>[shift.date,addDays(shift.date,offset)]),()=>saveBulk(event),'bulk');return;}
    }
    if(selectionPlanningStale(activeBulk)){updateBulkPreview();return;}
    const result = bulkProposal(); if (!result.ok || !result.changed) { updateBulkPreview(); return; }
    const {operation,members} = activeBulk, data = snapshot(), showDemoChanges = state.demoSession?.scenario === 'bulk';
    result.proposed.forEach(shift => { data.edits[shift.id] = shift; });
    const affected = operation === 'copy' ? result.proposed : [...members,...result.proposed];
    const ranges = [...new Set(affected.map(shift => shift.date))].map(day => [day,day]);
    result.proposed.forEach(shift => globalThis.CleanRoomsCalendar.revealDay(shift.date));
    const count = result.proposed.length, targetDate = result.proposed[0].date, [from,to] = calendarRange();
    if (targetDate < from || targetDate > to) state.week = Math.floor((date(targetDate) - date(anchor)) / 604800000);
    commit(data,count + (count === 1 ? ' vagt er ' : ' vagter er ') + {time:'opdateret',move:'flyttet',copy:'kopieret'}[operation] + '. Hele handlingen kan fortrydes.',ranges);
    if (showDemoChanges) openChanges(q('#cs-changes-toggle'));
  }
  function updatePublicationButton() {
    const button=q('#cs-changes-publish'),waiting=publicationBusy||planningReadBusy||publicationBudget?.state==='loading';
    const unsaved=cloudStatus.state!=='saved';
    button.disabled=!publicationCanSubmit||!publicationRangeValid||waiting||Boolean(planningReadBlocked)||unsaved;
    const action=publicationBusy?'Udgiver…':'Udgiv';
    if(button.textContent!==action)button.textContent=action;
    const feedback=q('#cs-publication-feedback');
    const feedbackState=publicationSubmitError?
      {state:'warning',message:publicationSubmitError}:
      !planningReadBlocked&&cloudStatus.state==='error'?
        {state:'warning',message:'Planen er ikke gemt. Luk udgivelsen, og vælg Prøv igen ved fejlbeskeden.'}:
        !publicationBusy&&cloudStatus.state==='saving'?
          {state:'muted',message:'Venter på, at ændringerne bliver gemt.'}:publicationFeedback;
    const message=feedbackState.message||'';
    if(feedback.textContent!==message)feedback.textContent=message;
    feedback.hidden=!message;
    feedback.dataset.state=feedbackState.state||'muted';
  }
  function paintEditorBudgetImpact() {
    const element=q('#cs-edit-budget-impact'),calculator=globalThis.CleanRoomsPlanningBudgetImpact;
    if(!element)return;
    element.hidden=true;
    if(!calculator||!activeEdit||editorRepeats()||state.page!=='schedule'||state.role==='employee')return;
    const {budget,scope,label}=calendarBudgetArea();
    const day=q('#cs-edit-date').value;
    if(!Actions.validDate(day))return;
    const from=staffingMonday(day),to=addDays(from,6);
    const siteIds=scope.kind==='site'?[sites.findIndex(site=>site.id===scope.id)]:scope.kind==='department'?selectedDepartment()?.siteIds: null;
    const model=calculator.preview({budget,from,to,siteIds,loaded:!persistence?.isPartial||planningRangeLoaded(from,to),shifts:conflictShiftsInRange(addDays(from,-1),to),before:activeEdit.id?activeEdit:null,after:{id:activeEdit.id||'budget-preview',date:day,site:Number(q('#cs-edit-site').value),start:q('#cs-edit-start').value,end:q('#cs-edit-end').value,plannedBreakMinutes:readPlannedBreak()}});
    if(!model)return;
    const format=minutes=>(Math.abs(minutes)/60).toLocaleString('da-DK',{maximumFractionDigits:2})+' t';
    element.textContent=(model.deltaMinutes?(model.deltaMinutes>0?'+':'−')+format(model.deltaMinutes)+' · ':'')+format(model.remainingMinutes)+(model.remainingMinutes<0?' over budget':' tilbage');
    element.dataset.over=String(model.remainingMinutes<0);element.title=label+' · Uge '+weekNumber(from);element.hidden=false;
  }
  function planningCostTarget() {
    if(!globalThis.CleanRoomsPlanningCostView||!cloudLoaded||!canViewPayroll()||state.role==='employee'||state.page!=='schedule'||effectiveView()==='day'||state.demoSession||!persistence?.ready)return null;
    const weeks=loadedCalendarWeeks();if(!weeks.length)return null;
    const {scope,label:scopeLabel}=calendarBudgetArea(),from=weeks[0],to=addDays(weeks.at(-1),6);
    const revision=persistence.revision,directoryRevision=directory?.revision??persistence.directoryRevision;
    const periodKey=JSON.stringify([chatWorkspaceId,sessionViewer?.userId,scope,from,to,planningCostEpoch]);
    return {scope,scopeLabel,from,to,weeks,revision,directoryRevision,periodKey,key:JSON.stringify([periodKey,revision,directoryRevision])};
  }
  function planningWeekCost(week) {
    const target=planningCostTarget();if(!target)return null;
    const cached=planningCostCache.get(target.periodKey),row=cached?.weeks.find(item=>item.from===week);
    const state=persistence.hasPendingPlanSave?'saving':cached?.key===target.key?'ready':planningCostError?.key===target.key?'error':'loading';
    return {...row,state};
  }
  function paintPlanningCostDialog() {
    if(!planningCostView?.isOpen||!planningCostSelection)return;
    const target=planningCostTarget();
    if(!target||target.periodKey!==planningCostSelection.periodKey){planningCostView.close({restoreFocus:false});planningCostSelection=null;return;}
    const week=planningCostCache.get(target.periodKey)?.weeks.find(item=>item.from===planningCostSelection.from);
    planningCostView.update({state:planningWeekCost(planningCostSelection.from)?.state||'loading',week,from:planningCostSelection.from,to:addDays(planningCostSelection.from,6),scopeLabel:target.scopeLabel,error:planningCostError?.message});
  }
  function openPlanningWeekCost(from,trigger) {
    const target=planningCostTarget();if(!target||!target.weeks.includes(from))return;
    if(!planningCostView)planningCostView=globalThis.CleanRoomsPlanningCostView.mount({element:root,onClose:()=>{planningCostSelection=null;},onRetry:()=>{const refresh=planningCostError?.refresh;planningCostError=null;planningCostCache.delete(planningCostTarget()?.periodKey);if(refresh){void initializeCloud();return;}syncPlanningCosts();}});
    planningCostSelection={from,periodKey:target.periodKey};
    const week=planningCostCache.get(target.periodKey)?.weeks.find(item=>item.from===from);
    planningCostView.open({state:planningWeekCost(from)?.state||'loading',week,from,to:addDays(from,6),scopeLabel:target.scopeLabel,trigger,error:planningCostError?.message});
  }
  function syncPlanningCosts() {
    const target=planningCostTarget();
    if(!target){planningCostView?.close({restoreFocus:false});planningCostSelection=null;if(!canViewPayroll()){planningCostCache.clear();planningCostError=null;}return;}
    paintPlanningCostDialog();
    if(persistence.hasPendingPlanSave||planningReadBusy||planningCostRequest)return;
    const cached=planningCostCache.get(target.periodKey);
    if(cached?.key===target.key&&Date.now()-cached.at<30000||planningCostError?.key===target.key)return;
    planningCostRequest=target;
    const finish=result=>{
      if(planningCostRequest!==target)return;
      planningCostRequest=null;
      const current=planningCostTarget();if(!current)return;
      if(current.key!==target.key){renderWeek();return;}
      if(result?.status===403){planningCostCache.clear();planningCostView?.close({restoreFocus:false});cloudCapabilities={...cloudCapabilities,viewPayroll:false};if(state.page==='schedule')renderWeek();void initializeCloud();return;}
      const weeksValid=Array.isArray(result?.weeks)&&result.weeks.length===Math.floor((date(target.to)-date(target.from))/604800000)+1&&result.weeks.every((week,index)=>week.from===addDays(target.from,index*7)&&week.to===addDays(week.from,6)&&['totalCents','baseCents','supplementCents','missingShiftCount','openShiftCount','monthlyPersonCount','fixedSupplementPersonCount'].every(key=>Number.isSafeInteger(week[key])&&week[key]>=0)&&week.totalCents===week.baseCents+week.supplementCents&&Array.isArray(week.people));
      if(result?.ok&&current.key===target.key&&result.revision===target.revision&&result.directoryRevision===target.directoryRevision&&JSON.stringify(result.scope)===JSON.stringify(target.scope)&&weeksValid){
        planningCostCache.delete(target.periodKey);planningCostCache.set(target.periodKey,{key:target.key,weeks:result.weeks,at:Date.now()});planningCostError=null;
        if(planningCostCache.size>12)planningCostCache.delete(planningCostCache.keys().next().value);
      }else if(current.key===target.key)planningCostError={key:target.key,refresh:result?.status===409||result?.ok&&(result.revision!==target.revision||result.directoryRevision!==target.directoryRevision),message:result?.message||'Lønestimatet kunne ikke opdateres. Prøv igen.'};
      if(state.page==='schedule'&&state.role!=='employee')renderWeek();
      paintPlanningCostDialog();
    };
    void persistence.action('planningCostRead',{from:target.from,to:target.to,scope:target.scope}).then(finish,()=>finish());
  }
  function calendarBudgetTarget() {
    const {budget,scope,label:scopeLabel}=calendarBudgetArea();
    if(!cloudLoaded||!cloudCapabilities.plan||state.role==='employee'||state.page!=='schedule'||state.demoSession
      ||!persistence?.ready||!Roster.validWorkHoursBudget(budget)||budget.period!=='month')return null;
    const base=dates()[0];
    const visible=effectiveView()!=='day'&&plannerViewport.key===viewportKey()?plannerViewport.visible[0]:null;
    const week=visible||base;
    const focus=week===base?(selectedDate()||base):addDays(week,3);
    const periodStart=budget.period==='month'?focus.slice(0,7)+'-01':week;
    // A full week in the month asks the shared budget reader for just that calendar month.
    const from=budget.period==='month'?staffingMonday(addDays(periodStart,6)):week;
    const periodKey=JSON.stringify([chatWorkspaceId,scope,budget.period,budget.hours,periodStart]);
    const revision=persistence.revision,directoryRevision=directory?.revision??persistence.directoryRevision;
    const key=JSON.stringify([periodKey,revision,directoryRevision]);
    return {period:budget.period,scope,scopeLabel,periodStart,periodKey,from,to:addDays(from,6),revision,directoryRevision,key};
  }
  function paintCalendarBudget(target,model,mode) {
    const element=q('#cs-calendar-budget'),view=globalThis.CleanRoomsPublicationBudget;
    const text=(selector,value)=>{const item=q(selector);if(item.textContent!==value)item.textContent=value;};
    const label=view.periodLabel(target.periodStart,target.period);
    const shortLabel=label.charAt(0).toLocaleUpperCase('da-DK')+label.slice(1).replace(/, \d{4}$/,'');
    const summary=model?view.periodSummary(model):null;
    const messages={
      ready:'Ledige vagter tæller med. Ulønnede pauser trækkes fra.',
      saving:'Gemmer vagtplanen. Budgettet opdateres, når ændringerne er gemt.',
      loading:'Henter timebudget for perioden…',
      error:'Timebudgettet kunne ikke opdateres.',
      unsaved:'Vagtændringerne er ikke gemt. Budgettet viser den senest gemte plan.'
    };
    text('#cs-calendar-budget-period',shortLabel);
    text('#cs-calendar-budget-caption',target.scopeLabel+' · '+label);
    text('#cs-calendar-budget-value',mode==='ready'?summary.remaining:mode==='saving'?'Opdaterer…':mode==='loading'?'Henter…':mode==='unsaved'?'Afventer gemning':'Prøv igen');
    text('#cs-calendar-budget-totals',summary?summary.totals+(mode==='ready'?' planlagt / budget':' · senest beregnet'):'');
    text('#cs-calendar-budget-message',messages[mode]);
    q('#cs-calendar-budget-retry').hidden=mode!=='error';
    element.dataset.state=mode==='ready'?(summary.over?'over':'ok'):mode;
    element.hidden=false;
  }
  function syncCalendarBudget() {
    const element=q('#cs-calendar-budget');
    if(!element||!globalThis.CleanRoomsPublicationBudget)return;
    const target=calendarBudgetTarget();
    if(!target){element.hidden=true;element.open=false;return;}
    const cached=calendarBudgetCache.get(target.periodKey);
    if(persistence.hasPendingPlanSave){
      paintCalendarBudget(target,cached?.model,cloudStatus.state==='error'?'unsaved':'saving');
      return;
    }
    if(cached?.key===target.key){paintCalendarBudget(target,cached.model,'ready');return;}
    if(calendarBudgetError?.key===target.key){paintCalendarBudget(target,cached?.model,'error');return;}
    paintCalendarBudget(target,cached?.model,'loading');
    if(calendarBudgetRequest)return;
    calendarBudgetRequest=target;
    const finish=result=>{
      if(calendarBudgetRequest!==target)return;
      calendarBudgetRequest=null;
      const current=calendarBudgetTarget();
      const model=result?.budget?.period===target.period?result.budget.periods?.find(item=>item.from===target.periodStart):null;
      if(result?.ok&&model&&result.revision===target.revision&&persistence.revision===target.revision
        &&(directory?.revision??persistence.directoryRevision)===target.directoryRevision&&result.directoryRevision===target.directoryRevision){
        calendarBudgetCache.delete(target.periodKey);
        calendarBudgetCache.set(target.periodKey,{key:target.key,model});
        if(calendarBudgetCache.size>12)calendarBudgetCache.delete(calendarBudgetCache.keys().next().value);
      }else if(current?.key===target.key){
        calendarBudgetError={key:target.key,refresh:result?.status===409||(result?.ok&&(result.revision!==target.revision||result.directoryRevision!==target.directoryRevision))};
      }
      syncCalendarBudget();
    };
    void persistence.action('publicationBudgetRead',{from:target.from,to:target.to,scope:target.scope}).then(finish,()=>finish());
  }
  function renderPublicationBudget(scope, reviewedScopes) {
    const view=globalThis.CleanRoomsPublicationBudget,element=q('#cs-publication-budget');
    if(!view||!element||state.demoSession||!publicationRangeValid||!scope.siteIds.length){if(element)element.hidden=true;return;}
    element.hidden=false;
    const configured=state.workspaceSettings?.workHoursBudget;
    if(!Roster.validWorkHoursBudget(configured)){
      element.hidden=true;
      publicationBudget=null;
      return;
    }
    if(scope.includeDependencies&&!reviewedScopes){element.hidden=true;return;}
    const {from,to}=scope,extraWeeks=(reviewedScopes||[]).map(part=>part.from).filter(week=>week<from||week>to);
    const revision=persistence?.revision,key=JSON.stringify([from,to,extraWeeks,revision,configured]);
    if(publicationBudget?.key===key)return;
    const request={key,state:'loading'};
    publicationBudget=request;
    view.render(element,request);
    const finish=(result)=>{
      if(publicationBudget!==request||q('#cs-changes-layer').hidden)return;
      const changed=result?.status===409||(result?.ok&&result.revision!==persistence?.revision);
      request.state=result?.ok&&!changed?'ready':'error';
      view.render(element,{state:request.state,budget:result?.budget,message:changed?'Planen er ændret. Hent planen og timebudgettet igen.':'',onRetry:()=>{
        if(changed)persistence?.invalidateCoverage?.();
        publicationBudget=null;
        renderChanges();
      }});
      updatePublicationButton();
    };
    if(!persistence?.action){finish();return;}
    void persistence.action('publicationBudgetRead',{from,to,...(extraWeeks.length?{extraWeeks}:{})}).then(finish,()=>finish());
  }
  function publicationIssues(scopes) {
    const shifts=scopes.flatMap(part=>shiftsInRange(part.from,part.to).filter(shift=>part.siteIds.includes(shift.site)));
    const leave=leaveDateIndex();
    const affected=new Map();
    const mark=(shift,reason)=>{
      const week=staffingMonday(shift.date);
      if(!affected.has(week))affected.set(week,new Map());
      const entries=affected.get(week);
      if(!entries.has(shift.id))entries.set(shift.id,{shift,reasons:new Set()});
      entries.get(shift.id).reasons.add(reason);
    };
    for(const issue of Engine.conflicts(shifts,publicationNeighbors(scopes)))mark(issue.shift,'Overlap');
    for(const shift of shifts)if(Engine.shiftDates(shift).some(day=>leave.get(shift.person)?.has(day)))mark(shift,'Godkendt fravær');
    return affected;
  }
  function showPublicationLoading(message,retry=false) {
    const load=q('#cs-publication-load');
    q('#cs-publication-load-message').textContent=message;
    q('#cs-publication-retry').hidden=!retry;
    load.hidden=!message;
    if(!message)return;
    const related=q('#cs-publication-related-slot');
    related.hidden=true;
    related.replaceChildren();
    q('#cs-changes-list').replaceChildren();
  }
  function showPublicationShift(shift,existsInDraft) {
    if(shift.date<addDays(anchor,-364)||shift.date>addDays(anchor,370)){navigateTo(shift.date);return;}
    closeChanges(false);state.view='week';
    const department=selectedDepartment();
    if(department&&!department.siteIds.includes(shift.site))state.departmentId='all';
    if(!navigateTo(shift.date))return;
    if(publicationResume)publicationResume.calendar=publicationCalendarContext();
    if(existsInDraft)globalThis.CleanRoomsCalendar.revealDay(shift.date);
    render();scrollCalendarTo(shift.date);
    const target=[...root.querySelectorAll('[data-shift]')].find(item=>item.dataset.shift===String(shift.id));
    (target||q('.cs-board-scroll'))?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function renderChanges() {
    const range=globalThis.CleanRoomsPublicationRange,scope=publicationScope(true);
    publicationCanSubmit=false;
    publicationFeedback={};
    updatePublicationButton();
    renderPublicationSiteSelect();
    if(!publicationRangeView)publicationRangeView=range.mount({
      element:q('#cs-publication-range-slot'),
      onChange:value=>{publicationRange=value;includeRelatedPublication=false;publicationSubmitError='';renderChanges();},
      onValidityChange:({valid})=>{
        publicationRangeValid=valid;
        q('#cs-changes-list').hidden=!valid;
        const related=q('#cs-publication-related-slot');
        related.hidden=!valid||!related.children.length;
        q('#cs-publication-budget').hidden=!valid||Boolean(state.demoSession)||!publicationScope(true).siteIds.length||!publicationBudget;
        updatePublicationButton();
      }
    });
    publicationRangeView.render({...scope,minDate:PlanData.minDate,maxDate:PlanData.maxDate,disabled:publicationBusy});
    renderPublicationBudget(scope);
    if(!scope.siteIds.length){
      const select=q('#cs-publication-scope-select');
      showPublicationLoading(select.disabled?'Der er ingen arbejdssteder at udgive for.':'Vælg et arbejdssted.');
      return;
    }
    const projection=publicationProjection(),key=JSON.stringify(projection);
    if(!publicationScopeReady()){
      if(planningReadBlocked===key||planningReadBlocked==='full'){showPublicationLoading('Planen for perioden kunne ikke hentes.',true);return;}
      showPublicationLoading('Henter ændringer…');
      if(!publicationRead){
        const request=planningReadBusy
          ?planningReadPromise
          :withPlanningScope(projection,()=>true,'publication');
        publicationRead=request;
        void request.finally(()=>{
          if(publicationRead!==request)return;
          publicationRead=null;
          if(!q('#cs-changes-layer').hidden)renderChanges();
        });
      }
      return;
    }
    showPublicationLoading('');
    const status=Publication.scopeStatus(state,scope),changes=status.changes;
    if(scope.includeDependencies)renderPublicationBudget(scope,status.scopes);
    const relatedSlot=q('#cs-publication-related-slot');
    relatedSlot.replaceChildren();
    relatedSlot.hidden=!publicationRangeValid||!status.dependencies.length;
    if(status.dependencies.length){
      const related=node('label','cs-publication-related'),checkbox=node('input');
      checkbox.type='checkbox';checkbox.checked=includeRelatedPublication;
      checkbox.addEventListener('change',()=>{
        includeRelatedPublication=checkbox.checked;publicationSubmitError='';renderChanges();
        (relatedSlot.hidden?q('#cs-changes-close'):relatedSlot.querySelector('input'))?.focus({preventScroll:true});
      });
      const periods=status.dependencies.map(part=>{
        const {week,year}=range.weekNumber(part.from);
        const names=part.siteIds.map(site=>sites[site]?.name||'Arbejdssted');
        return 'Uge '+week+', '+year+' · '+names.join(', ');
      });
      related.append(checkbox,node('span',null,'Medtag også de flyttede vagters andre uger eller arbejdssteder'));
      const locations=node('ul','cs-publication-location-changes');
      locations.append(...periods.map(period=>node('li',null,period)));
      relatedSlot.append(related,locations);
    }
    const issues=publicationIssues(status.scopes);
    const list=q('#cs-changes-list');
    const sections=[];
    if(issues.size){
      const conflicts=node('ul','cs-publication-conflicts');
      for(const [,entries] of [...issues].sort(([a],[b])=>a.localeCompare(b)))for(const {shift,reasons} of entries.values()){
        const row=node('li'),link=node('button','cs-publication-conflict',personName(shift.person)+' · '+shortDate(shift.date)+' · '+clockLabel(shift)+' · '+[...reasons].join(' og '));
        link.type='button';link.addEventListener('click',()=>showPublicationShift(shift,true));row.append(link);conflicts.append(row);
      }
      sections.push(conflicts);
    }
    if(!publicationReviewElement){
      publicationReviewElement=node('section','cs-publication-review-slot');
      publicationReviewView=globalThis.CleanRoomsPublicationReview.mount({element:publicationReviewElement,onOpenChange:entry=>{
        const shift=entry.after||entry.before;
        if(shift)showPublicationShift(shift,Boolean(entry.after));
      }});
    }
    const reviewFocus=publicationReviewElement.contains?.(document.activeElement)?document.activeElement:null;
    if(changes.length||status.locationChanges.length){
      const panel=node('div','cs-publication-changes');
      panel.append(node('h4','cs-publication-section-title','Ændringer'));
      if(status.locationChanges.length){
        const locations=node('ul','cs-publication-location-changes');
        for(const site of new Set(status.locationChanges.map(item=>item.site))){
          locations.append(node('li',null,(sites[site]?.name||'Arbejdssted')+' · Oplysninger opdateret'));
        }
        panel.append(locations);
      }
      if(changes.length)panel.append(publicationReviewElement);
      sections.push(panel);
    }
    list.replaceChildren(...sections);
    reviewFocus?.focus({preventScroll:true});
    if(publicationResume?.review){publicationReviewView.restore?.(publicationResume.review);publicationResume.review=null;}
    const scopeSiteIds=q('#cs-publication-scope-select').value==='all'?[]:
      [...new Set(status.scopes.flatMap(part=>part.siteIds))];
    publicationReviewView.render({changes,people:staff,sites,scopeSiteIds,scopeKey:JSON.stringify([scope.from,scope.to,scope.siteIds,scope.includeDependencies])});
    const dependenciesMissing=status.dependencies.length&&!includeRelatedPublication;
    publicationFeedback=issues.size?{state:'warning',message:'Ret overlap eller vagter under godkendt fravær, før du udgiver.'}:
      status.published?{state:'muted',message:'Allerede udgivet.'}:
      !status.count&&!changes.length?{state:'muted',message:'Ingen vagter i perioden.'}:{};
    publicationCanSubmit=!status.published&&!dependenciesMissing&&!issues.size;
    updatePublicationButton();
    if(publicationResume&&!publicationResume.scrollRestored){const resume=publicationResume;resume.scrollRestored=true;Promise.resolve().then(()=>{if(publicationResume===resume&&!q('#cs-changes-layer').hidden)q('.cs-changes-editor .cs-group-fields').scrollTop=resume.scrollTop||0;});}
  }
  function publicationContextKey(){return JSON.stringify([chatWorkspaceId,sessionViewer?.userId,state.role]);}
  function publicationCalendarContext(){return JSON.stringify([dates()[0],state.departmentId,state.site]);}
  function resumablePublicationReview() {
    const candidate = publicationResume;
    if (candidate?.key !== publicationContextKey() || candidate.calendar !== publicationCalendarContext()) return null;
    const departmentExists = candidate.departmentId === 'all' || state.organization?.departments.some(item => item.id === candidate.departmentId);
    const siteExists = candidate.site === 'all' || allowedSite(Number(candidate.site));
    return departmentExists && siteExists ? candidate : null;
  }
  function openChanges(trigger = q('#cs-changes-toggle')) {
    if(!confirmEditorLeave(()=>openChanges(trigger)))return false;
    closeOperationsSheets();
    closeEditor({force:true}); closeGroupEditor(false); closeBulkEditor(false); closeReview();
    const resume=resumablePublicationReview();publicationResume=resume;if(resume)resume.scrollRestored=false;
    if(resume){state.departmentId=resume.departmentId;state.site=resume.site;q('#cs-site-filter').value=state.site;}
    publicationSiteSelection=resume?.siteSelection??null;
    includeRelatedPublication=resume?.related||false;
    publicationRange=resume?.range?{...resume.range}:{from:dates()[0],to:dates()[6]};
    publicationRangeValid=true;publicationCanSubmit=false;publicationBudget=null;publicationRead=null;publicationSubmitError='';
    publicationRangeView?.dispose?.();publicationRangeView=null;
    publicationReviewView?.dispose?.();publicationReviewView=null;publicationReviewElement=null;
    changesTrigger=trigger;
    q('#cs-changes-layer').hidden=false;
    q('#cs-changes-list').hidden=false;
    q('.cs-changes-editor .cs-group-fields').scrollTop=resume?.scrollTop||0;
    renderChanges();
    q('#cs-changes-close').focus({preventScroll:true});
  }
  function closeChanges(restoreFocus = true) {
    releasePlanningHold('publication');
    const wasOpen = !q('#cs-changes-layer').hidden;
    publicationRangeView?.close?.();
    publicationSiteCombo?.close();
    if(wasOpen)publicationResume={
      key:publicationContextKey(),calendar:publicationCalendarContext(),departmentId:state.departmentId,site:state.site,
      range:publicationRange?{...publicationRange}:null,siteSelection:publicationSiteSelection,related:includeRelatedPublication,
      review:publicationReviewView?.capture?.()||null,scrollTop:q('.cs-changes-editor .cs-group-fields').scrollTop||0
    };
    q('#cs-changes-layer').hidden = true;
    publicationSiteSelection=null;includeRelatedPublication=false;publicationCanSubmit=false;publicationBudget=null;
    if(wasOpen&&restoreFocus){const target=changesTrigger?.isConnected?changesTrigger:q('#cs-changes-toggle');target.focus({preventScroll:true});}
  }
  async function publishReviewedWeek() {
    if(!publicationCanSubmit||publicationBusy||!cloudLoaded||!persistence||planningReadBusy||planningReadBlocked||publicationBudget?.state==='loading'||cloudStatus.state!=='saved')return;
    if(!publicationScopeReady()){renderChanges();return;}
    if(!publicationRangeValid||publicationRangeView?.valid===false)return;
    const scope=publicationScope(true),expanded=Publication.expandScope(state,scope);
    if(publicationIssues(expanded.scopes).size){
      renderChanges();
      return;
    }
    publicationRangeView?.close?.();
    publicationSiteCombo?.close();
    publicationSubmitError='';publicationBusy=true;root.inert=true;updatePublicationButton();
    const result=await persistence.publish({...state,calendarAnchor:anchor,storageVersion:1},scope);
    publicationBusy=false;root.inert=false;
    if(!result.ok){
      publicationSubmitError=result.message||'Udgivelsen kunne ikke gemmes. Kladden er bevaret.';
      renderChanges();
      const button=q('#cs-changes-publish');
      (button.disabled?q('#cs-changes-close'):button).focus({preventScroll:true});
      return;
    }
    const trigger=changesTrigger;
    closeChanges(false);publicationResume=null;
    lastUndo=null;clearSelection(false);await initializeCloud();
    notify('Vagtplanen er udgivet.');
    (trigger?.isConnected?trigger:q('#cs-changes-toggle')).focus({preventScroll:true});
  }
  function editorError(message) { q('#cs-edit-error').hidden = false; q('#cs-edit-error').textContent = message; q('#cs-edit-error').scrollIntoView({block:'nearest'}); }
  function restoredSeriesMetadata(previous,current) {
    return (previous||[]).map(series=>{const present=(current||[]).find(item=>item.id===series.id),hasPause=present?.plannedBreakMinutes!==undefined||Object.values(present?.dayTimes||{}).some(day=>day.plannedBreakMinutes!==undefined);return {...series,...(present?.openEnded!==undefined&&series.openEnded===undefined?{openEnded:false}:{}),...(present?.dayTimes!==undefined&&series.dayTimes===undefined?{dayTimes:{}}:{}),...(present?.groupId!==undefined&&series.groupId===undefined?{groupId:series.id}:{}),...(hasPause&&series.plannedBreakMinutes===undefined?{plannedBreakMinutes:0}:{}),...(present?.weekInterval!==undefined&&series.weekInterval===undefined?{weekInterval:1}:{}),...(present?.weekAnchor!==undefined&&series.weekAnchor===undefined?{weekAnchor:Engine.weekMonday(series.startDate)}:{})};});
  }
  function restoredPauseEdits(previous,current){return Object.fromEntries(Object.entries(previous||{}).map(([id,shift])=>[id,{...shift,...(current?.[id]?.plannedBreakMinutes!==undefined&&shift.plannedBreakMinutes===undefined?{plannedBreakMinutes:0}:{})}]));}
  function scopeDraft(data, source, scope, replacement = null) {
    if (!source) { if (replacement) data.series.push(replacement); return; }
    const cutoff = editorCutoff(source,scope);
    const preserved=replacement&&q('#cs-preserve-exceptions').checked?Engine.preserveExceptions({source,replacement,scope,cutoff,edits:data.edits,deleted:data.deleted}):null;
    clearSeriesExceptions(data,source.id,cutoff);
    if(preserved){data.edits=preserved.edits;data.deleted=preserved.deleted;}
    data.series = data.series.filter(series => series.id !== source.id);
    if (cutoff && cutoff > source.startDate) {
      const prior = {...source,endDate:addDays(cutoff,-1),...(source.openEnded!==undefined?{openEnded:false}:{})};
      if (!Engine.validate(prior).length && seriesHasOccurrences(prior)) data.series.push(prior);
    }
    if (replacement) data.series.push(replacement);
  }
  function deleteEditedShift() {
    if(!activeEdit?.id)return;
    if(planningReadBusy||planningReadBlocked)return;
    if(activeEdit.seriesId&&q('#cs-edit-scope').value!=='one'&&ensureEditorScope(()=>deleteEditedShift()))return;
    if(paintEditorPlanningConflict())return;
    const data=snapshot(),source=sourceSeries(),scope=q('#cs-edit-scope').value;
    if(source&&scope!=='one'){
      const cutoff=editorCutoff(source,scope);
      if(scope==='future'&&(!Actions.validDate(cutoff)||cutoff<source.startDate||cutoff>source.endDate))return editorError('Vælg en dato inden for den eksisterende serie.');
      const ranges=affectedSeriesRanges(source,scope);scopeDraft(data,source,scope);commit(data,scope==='all'?'Vagtserien er slettet.':'Vagterne fra den valgte dato er slettet.',ranges);
    }else{data.deleted=[...new Set([...data.deleted,activeEdit.id])];delete data.edits[activeEdit.id];commit(data,'Vagten er slettet i eksemplet.',[[activeEdit.date,activeEdit.date]]);}
  }
  staff.forEach(person => { const option = node('option', null, person.name); option.value = person.id; q('#cs-edit-person').append(option); });
  function saveShift(event) {
    event.preventDefault(); if (!activeEdit) return;
    if(planningReadBusy||planningReadBlocked)return;
    if(editorRepeats()&&ensureEditorScope(()=>saveShift(event)))return;
    if(hasWindowLoading()&&persistence.isPartial&&!editorRepeats()&&Actions.validDate(q('#cs-edit-date').value)&&!planningRangeLoaded(staffingMonday(q('#cs-edit-date').value),addDays(staffingMonday(q('#cs-edit-date').value),6))){withPlanningDates([activeEdit.date,q('#cs-edit-date').value],()=>saveShift(event),'editor');return;}
    if(paintEditorPlanningConflict())return;
    refreshStaffing();
    const source = sourceSeries(), scope = source ? q('#cs-edit-scope').value : 'one';
    if (editorRepeats()) {
      const draft = readSeriesDraft(), errors = Engine.validate(draft);
      if (source && scope === 'future' && draft.startDate < editorCutoff(source,scope)) errors.unshift('Startdatoen kan ikke ligge før den valgte vagt.');
      if (errors.length) return editorError(errors[0]);
      const lifecycleError=seriesDraftError(draft,source,scope);if(lifecycleError)return editorError(lifecycleError);
      if(selectedStaffing?.status==='blocked')return editorError(staffingReason(selectedStaffing));
      if (!q('#cs-edit-form').reportValidity()) return;
      if(SeriesPlanner&&unchangedSeries(draft,source,scope,SeriesPlanner.preview({draft,source:source||null,scope:source?scope:'all',cutoff:editorCutoff(source,scope),edits:state.edits,deleted:state.deleted,preserve:q('#cs-preserve-exceptions').checked,today}))){closeEditor();notify('Der var ingen ændringer at gemme.');return;}
      const data=snapshot();scopeDraft(data,source,scope,draft);
      const proposed=seriesOccurrences(draft,data);
      const error = proposalError(proposed,data); if (error) return editorError(error);
      const working=seriesOperationRange(draft),ranges = [[working.from,working.to],...(source ? affectedSeriesRanges(source,scope) : [])];
      if(state.page==='series'){
        const agreement=SeriesLifecycle?.groupSeries(data.series,{today,edits:data.edits,deleted:data.deleted}).find(group=>group.id===(draft.groupId||draft.id));
        seriesStatus=agreement?.status||(draft.startDate>today?'upcoming':draft.endDate<today?'ended':'active');
        if(agreement?.phases.length>1)expandedSeriesGroups.add(agreement.id);
        if(state.site!=='all'&&Number(state.site)!==draft.site)state.site='all';
        if(searchTerm()&&!personName(draft.person).toLocaleLowerCase('da-DK').includes(searchTerm()))state.search='';
        lastTrigger=node('button');lastTrigger.dataset.productFocus='series:'+(draft.groupId||draft.id)+':edit';
      }
      commit(data,editorOperation==='extend'?'Vagtserien er forlænget som kladde.':editorOperation==='copy'?'Kopien er oprettet som kladde.':source?'Vagtserien er opdateret som kladde.':'Vagtserien er oprettet som kladde.',ranges); return;
    }
    if(selectedStaffing?.status==='blocked')return editorError(staffingReason(selectedStaffing));
    if (!q('#cs-edit-form').reportValidity()) return;
    const next = {id:activeEdit.id || 'new-' + Date.now(),person:q('#cs-edit-person').value,site:Number(q('#cs-edit-site').value),date:q('#cs-edit-date').value,start:q('#cs-edit-start').value,end:q('#cs-edit-end').value,plannedBreakMinutes:readPlannedBreak(),...readDescriptionData(),...(source ? {seriesId:source.id} : {})};
    if(activeEdit.endDate!==undefined)next.endDate=Engine.shiftEndDate(next);
    const errors = Engine.validate({id:next.id,person:next.person || 'unassigned',site:next.site,startDate:next.date,endDate:next.date,weekdays:[0],start:next.start,end:next.end,plannedBreakMinutes:next.plannedBreakMinutes});
    if (errors.length) return editorError(errors[0]);
    const data = snapshot(); data.edits[next.id] = next; data.deleted = data.deleted.filter(id => id !== next.id);
    const error = proposalError([next],data); if (error) return editorError(error);
    commit(data,'Vagten er gemt i eksemplet.',[[activeEdit.date,activeEdit.date],[next.date,next.date]]);
  }
  departmentView = globalThis.CleanRoomsDepartmentView?.mount({element:q('#cs-department-switcher'),portal:q('#cs-department-portal'),onSelect:id => changeDepartment(id ?? 'all'),onSave:saveDepartment}) || null;
  staff.forEach(person => { const option = node('option',null,person.name); option.value = person.id; q('#cs-employee-person').append(option); });
  q('#cs-open-employee').addEventListener('click',() => setRole('employee'));
  root.querySelectorAll('[data-employee-workspace]').forEach(button=>button.addEventListener('click',()=>openEmployeeWorkspace(button.dataset.employeeWorkspace)));
  q('#cs-open-admin').addEventListener('click',() => setRole('admin'));
  q('#cs-chat-nav').addEventListener('click',openChat);
  q('#cs-companies-nav').addEventListener('click',() => {
    if(editorHasDirtyDraft()||timeView?.hasDraft){notify('Gem eller luk din kladde, før du skifter virksomhed.');return;}
    if(publicationBusy||timeView?.busy||timeBusy||leaveBusy||persistence?.hasPendingPlanSave){notify('Vent til ændringen er gemt, før du skifter virksomhed.');return;}
    window.parent.postMessage({type:'cleanrooms-open-companies'},'*');
  });
  q('#cs-employee-person').addEventListener('change',() => { clearChat();state.employeePerson = q('#cs-employee-person').value; state.employeeShift = null; clearWorkflow(); render(); save(); });
  q('#cs-storage-retry').addEventListener('click',retryCloud);
  q('#cs-operations-tabs').addEventListener('click',event => {
    const button = event.target.closest('[data-ops-filter]'); if (!button) return;
    operationsFilter = button.dataset.opsFilter; renderOperations();
  });
  ['#cs-operations-close','#cs-operations-backdrop','#cs-operations-finish'].forEach(selector => q(selector).addEventListener('click',() => closeOperations()));
  q('#cs-needs-open').addEventListener('click',event => openNeeds(event.currentTarget));
  ['#cs-needs-close','#cs-needs-backdrop'].forEach(selector => q(selector).addEventListener('click',() => closeNeeds()));
  q('#cs-need-new').addEventListener('click',() => { fillNeedForm(); q('#cs-need-site').focus({preventScroll:true}); });
  root.querySelectorAll('[data-need-day]').forEach(button => button.addEventListener('click',() => { const day = Number(button.dataset.needDay); needDays.has(day) ? needDays.delete(day) : needDays.add(day); button.setAttribute('aria-pressed',String(needDays.has(day))); }));
  function saveNeedForm(event) {
    event.preventDefault(); if (!q('#cs-needs-form').reportValidity()) return;
    const result = applyNeedRule(readNeedRule());
    q('#cs-need-error').hidden = result.ok; q('#cs-need-error').textContent = result.reason || '';
    if (result.ok) { renderNeeds(); fillNeedForm(); q('#cs-needs-list').scrollIntoView({block:'start'}); q('#cs-needs-close').focus({preventScroll:true}); }
    else q('#cs-need-error').scrollIntoView({block:'nearest'});
  }
  q('#cs-need-save').addEventListener('click',saveNeedForm);
  q('#cs-needs-form').addEventListener('submit',saveNeedForm);
  q('#cs-needs-form').addEventListener('keydown',event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveNeedForm(event); });
  ['#cs-replacement-close','#cs-replacement-backdrop','#cs-replacement-cancel'].forEach(selector => q(selector).addEventListener('click',() => closeReplacement()));
  q('#cs-replacement-search').addEventListener('input',renderReplacement);
  q('#cs-replacement-save').addEventListener('click',() => {
    if (!activeReplacement?.person) return;
    const {target,person,context} = activeReplacement, result = applyReplacement(target,person,context);
    if (result.ok) { if(target.sickness){closeReplacement(false);q('#cs-publish').focus({preventScroll:true});notify('Afløser valgt · klar til udgivelse');}else openOperations(q('#cs-review'),false);return; }
    q('#cs-replacement-error').hidden = false; q('#cs-replacement-error').textContent = result.reason; renderReplacement();
  });
  q('#cs-edit-find-replacement').addEventListener('click',event => { if (activeEdit?.id) openReplacement({kind:'shift',shift:clone(activeEdit)},event.currentTarget); });
  q('#cs-edit-sickness').addEventListener('click',event => { if(activeEdit?.id)openSickness(clone(activeEdit),event.currentTarget); });
  q('#cs-operations-layer').addEventListener('keydown',event => trapDialog(event,q('#cs-operations-layer .cs-operations-panel'),closeOperations));
  q('#cs-needs-layer').addEventListener('keydown',event => trapDialog(event,q('.cs-needs-panel'),closeNeeds));
  q('#cs-replacement-layer').addEventListener('keydown',event => trapDialog(event,q('.cs-replacement-panel'),closeReplacement));
  q('#cs-person-trigger').addEventListener('click',() => staffPickerOpen ? closeStaffPicker() : openStaffPicker());
  q('#cs-person-picker-close').addEventListener('click',() => closeStaffPicker());
  q('#cs-person-search').addEventListener('input', renderStaffPicker);
  q('#cs-person-picker').addEventListener('keydown',event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeStaffPicker(); return; }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    if (event.target === q('#cs-person-search') && !['ArrowDown','ArrowUp'].includes(event.key)) return;
    const list = q('#cs-person-results');
    const options = [...list.querySelectorAll('button:not(:disabled)')];
    if (!options.length) return;
    const index = options.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? Math.min(options.length - 1,index + 1) : index < 0 ? options.length - 1 : Math.max(0,index - 1);
    event.preventDefault();
    options[next].focus({preventScroll: true});
    revealStaffOption(list, options[next]);
  });
  root.addEventListener('click',event=>{
    if(!editorHasDirtyDraft()||q('#cs-editor-layer').contains(event.target))return;
    const target=event.target.closest?.('button,a,[role=button]')||event.target;
    if(!confirmEditorLeave(()=>{if(target.isConnected)target.click?.();})){event.preventDefault();event.stopImmediatePropagation();return;}
    closeEditor({force:true});
  },true);
  function dismissStaffPickerOutside(event) {
    if (staffPickerOpen && !q('#cs-person-picker').contains(event.target) && !q('#cs-person-trigger').contains(event.target)) closeStaffPicker(false);
  }
  root.addEventListener('click', dismissStaffPickerOutside);
  q('#cs-save').addEventListener('click',saveShift); q('#cs-edit-form').addEventListener('submit',event => event.preventDefault());
  q('#cs-edit-form').addEventListener('keydown',event => { if (!event.defaultPrevented && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveShift(event); });
  q('#cs-delete').addEventListener('click',()=>{
    if(!activeEdit?.id)return;
    if(paintEditorPlanningConflict())return;
    const source=sourceSeries(),scope=q('#cs-edit-scope').value;
    if(!source||scope==='one')return deleteEditedShift();
    const cutoff=editorCutoff(source,scope);
    if(scope==='future'&&(!Actions.validDate(cutoff)||cutoff<source.startDate||cutoff>source.endDate))return editorError('Vælg en dato inden for den eksisterende serie.');
    const exceptions=Engine.exceptionPreview({source,scope,cutoff,edits:state.edits,deleted:state.deleted});
    const ids=new Set(seriesOccurrences(source).filter(shift=>!cutoff||occurrenceAnchor(shift.id,source.id)>=cutoff).map(shift=>shift.id));
    exceptions.ids.filter(id=>state.edits[id]&&!state.deleted.includes(id)).forEach(id=>ids.add(id));
    q('#cs-series-delete-message').textContent=(Engine.requiresRange(source)?scope==='future'?'Serien afsluttes fra '+shortDate(cutoff):'Hele vagtserien slettes':ids.size+(ids.size===1?' vagt fjernes':' vagter fjernes')+(scope==='future'?' fra '+shortDate(cutoff):' i hele serien'))+'. Manuelle særændringer i dette omfang slettes også. Udgivne vagter ændres først, når planen udgives igen.';
    q('#cs-series-delete-confirm').hidden=false;q('#cs-series-delete-apply').focus({preventScroll:true});
  });
  q('#cs-series-delete-cancel').addEventListener('click',()=>{q('#cs-series-delete-confirm').hidden=true;q('#cs-delete').focus({preventScroll:true});});
  q('#cs-series-delete-apply').addEventListener('click',deleteEditedShift);
  q('#cs-close').addEventListener('click',closeEditor); q('#cs-backdrop').addEventListener('click',closeEditor);
  q('#cs-edit-note').addEventListener('input',() => { if(activeEdit)syncEditorDescription(); });
  q('#cs-edit-scope').addEventListener('change',changeEditorScope); q('#cs-edit-repeat').addEventListener('change',() => configureRepeat(true));
  q('#cs-preserve-exceptions').addEventListener('change',updatePreview);
  q('#cs-day-times-enabled').addEventListener('change',updatePreview);
  q('#cs-repeat-interval').addEventListener('change',()=>{if(Number(q('#cs-repeat-interval').value)===2&&Engine.weekInterval(sourceSeries()||editorTemplate)!==2)editorWeekAnchor=null;updatePreview();});
  root.querySelectorAll('[data-repeat-day]').forEach(button => button.addEventListener('click',() => { const day = Number(button.dataset.repeatDay); if (repeatDays.has(day)) repeatDays.delete(day); else repeatDays.add(day); updatePreview(); }));
  ['#cs-edit-date','#cs-edit-person','#cs-edit-site','#cs-edit-start','#cs-edit-end','#cs-edit-break','#cs-repeat-start','#cs-repeat-end'].forEach(selector => { q(selector).addEventListener('input',updatePreview); q(selector).addEventListener('change',updatePreview); });
  q('#cs-repeat-unlimited').addEventListener('click',()=>chooseSeriesLength(null));
  root.querySelectorAll('[data-series-months]').forEach(button=>button.addEventListener('click',()=>chooseSeriesLength(Number(button.dataset.seriesMonths))));
  function trapDialog(event, panel, close) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') { const controls = [...panel.querySelectorAll('button,input,select,textarea,[contenteditable="true"],summary')].filter(element => !element.disabled && !element.hidden && element.tabIndex !== -1 && element.getClientRects().length), first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }
  q('#cs-editor-layer').addEventListener('keydown',event => { if (event.defaultPrevented) return; if (event.key === 'Escape' && staffPickerOpen) { event.preventDefault(); closeStaffPicker(); return; } trapDialog(event,q('.cs-editor'),closeEditor); });
  q('#cs-selection-toggle').addEventListener('click',() => { if (selectionMode) clearSelection(); else { selectionMode = true; render(); } });
  q('#cs-selection-clear').addEventListener('click',() => { clearSelection(); q('#cs-selection-toggle').focus({preventScroll:true}); });
  ['time','move','copy'].forEach(operation => q('#cs-bulk-' + operation).addEventListener('click',event => openBulkEditor(operation,event.currentTarget)));
  ['#cs-bulk-start','#cs-bulk-end','#cs-bulk-date'].forEach(selector => ['input','change'].forEach(type => q(selector).addEventListener(type,updateBulkPreview)));
  q('#cs-bulk-save').addEventListener('click',saveBulk); q('#cs-bulk-form').addEventListener('submit',saveBulk);
  q('#cs-bulk-form').addEventListener('keydown',event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveBulk(event); });
  ['#cs-bulk-close','#cs-bulk-backdrop','#cs-bulk-cancel'].forEach(selector => q(selector).addEventListener('click',() => closeBulkEditor()));
  q('#cs-bulk-layer').addEventListener('keydown',event => trapDialog(event,q('.cs-bulk-editor'),closeBulkEditor));
  q('#cs-changes-toggle').addEventListener('click',event => openChanges(event.currentTarget));
  q('#cs-publication-scope-select').addEventListener('change',event=>changePublicationSite(event.currentTarget.value));
  q('#cs-publication-retry').addEventListener('click',()=>{
    if(cloudStatus.conflict){closeChanges(false);retryCloud();return;}
    planningReadBlocked='';
    renderChanges();
  });
  ['#cs-changes-close','#cs-changes-backdrop','#cs-changes-cancel'].forEach(selector => q(selector).addEventListener('click',() => closeChanges()));
  q('#cs-changes-layer').addEventListener('keydown',event => trapDialog(event,q('.cs-changes-editor'),closeChanges));
  q('#cs-changes-publish').addEventListener('click',publishReviewedWeek);
  root.addEventListener('keydown',event => { if (!event.defaultPrevented && event.key === 'Escape' && selectionMode && q('#cs-bulk-layer').hidden && q('#cs-group-layer').hidden && q('#cs-editor-layer').hidden && q('#cs-changes-layer').hidden && q('#cs-review-layer').hidden) { event.preventDefault(); clearSelection(); q('#cs-selection-toggle').focus({preventScroll:true}); } });
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&plannerDetailBusy){event.preventDefault();cancelPlannerDetails();}});
  root.addEventListener('pointerdown',()=>{cancelPlannerDetails();},true);
  root.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))cancelPlannerDetails();},true);
  q('#cs-group-form').addEventListener('submit',saveGroup);
  q('#cs-group-save').addEventListener('click',saveGroup);
  q('#cs-group-form').addEventListener('keydown',event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveGroup(event); });
  ['#cs-group-start','#cs-group-end'].forEach(selector => ['input','change'].forEach(type => q(selector).addEventListener(type,updateGroupPreview)));
  ['#cs-group-close','#cs-group-cancel','#cs-group-backdrop'].forEach(selector => q(selector).addEventListener('click',() => closeGroupEditor()));
  q('#cs-group-layer').addEventListener('keydown',event => trapDialog(event,q('.cs-group-editor'),closeGroupEditor));
  q('#cs-review-layer').addEventListener('keydown',event => trapDialog(event,q('.cs-review-panel'),closeReview));
  q('#cs-review').addEventListener('click',() => openOperations()); ['#cs-review-close','#cs-review-backdrop','#cs-review-finish'].forEach(selector => q(selector).addEventListener('click',closeReview));
  q('#cs-undo').addEventListener('click',undoPlanning);
  q('#cs-demo-examples').addEventListener('click',showDemoPage);
  q('#cs-demo-reset').addEventListener('click',() => launchDemo(state.demoSession?.scenario || 'overview'));
  q('#cs-demo-exit').addEventListener('click',exitDemo);
  root.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
    if(button.dataset.page==='accounts'?!hasAccountAccess():realEmployee())return;
    if(!confirmEditorLeave(()=>button.click()))return;
    closeEditor({force:true});
    accountsView?.close?.();
    departmentView?.close();
    state.role = 'admin'; state.employeeShift = null;
    closeOperationsSheets(); closeEditor();
    planningRetryWork=null;planningFullHolds.clear();planningScopeHolds.clear();
    directoryProfileEpoch++;employeeDirectoryRecord=null;employeeProfileId=null;payrollProfileReturn=null;payrollPolicyPendingOpen=null;
    state.page = button.dataset.page; state.pageIndex = 0; state.search = ''; state.site = 'all'; state.onlyOpen = false;
    q('#cs-search').value = ''; q('#cs-site-filter').value = 'all'; q('#cs-toast').hidden = !lastUndo; render(); save();
  }));
  root.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => { state.group = button.dataset.group; state.pageIndex = 0; render(); save(); }));
  q('#cs-zoom-controls').querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click',() => { state.zoom = Number(button.dataset.zoom); render(); save(); }));
  q('#cs-view-switch').querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.pageIndex = 0; render(); save(); }));
  q('#cs-search').addEventListener('input', () => { state.search = q('#cs-search').value; state.pageIndex = 0; render(); });
  q('#cs-site-filter').addEventListener('change', () => { state.site = q('#cs-site-filter').value; state.pageIndex = 0; render(); save(); });
  q('#cs-reset-filters').addEventListener('click', resetFilters);
  q('#cs-attention').addEventListener('click', () => {
    state.onlyOpen = !state.onlyOpen; state.pageIndex = 0;
    if (state.onlyOpen && effectiveView() === 'day') { const open = filteredShifts(); if (open.length && !open.some(shift => shift.date === selectedDate())) state.day = dates().indexOf(open[0].date); }
    render(); save();
  });
  q('#cs-prev-week').addEventListener('click', () => { timeFocus=null;state.week = Math.max(-52, state.week - 1); state.pageIndex = 0; q('#cs-toast').hidden = !lastUndo; render(); save(); });
  q('#cs-next-week').addEventListener('click', () => { timeFocus=null;state.week = Math.min(52, state.week + 1); state.pageIndex = 0; q('#cs-toast').hidden = !lastUndo; render(); save(); });
  q('#cs-today').addEventListener('click', () => {
    timeFocus=null;plannerViewport.restore=false;state.week = 0; state.day = (date(today).getUTCDay()+6)%7; state.pageIndex = 0; render();
    const wrap = scrollContainer(); if (wrap) wrap.scrollTop = 0;
    if (effectiveView() === 'week') scrollCalendarTo(today); save();
  });
  q('#cs-prev-page').addEventListener('click', () => { state.pageIndex = Math.max(0, state.pageIndex - 1); render(); save(); });
  q('#cs-next-page').addEventListener('click', () => { state.pageIndex += 1; render(); save(); });
  q('#cs-new').addEventListener('click',() => newShift(state.page === 'series'));
  q('#cs-publish').addEventListener('click',() => openChanges(q('#cs-publish')));
  q('#cs-calendar-budget-retry').addEventListener('click',()=>{
    const refresh=calendarBudgetError?.refresh;
    calendarBudgetError=null;
    if(refresh){void initializeCloud();return;}
    syncCalendarBudget();
  });
  q('#cs-calendar-budget').addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!event.currentTarget.open)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.open=false;
    event.currentTarget.querySelector('summary')?.focus({preventScroll:true});
  });
  root.addEventListener('pointerdown',event=>{const menu=q('#cs-calendar-display');if(menu?.open&&!menu.contains(event.target))menu.open=false;});
  root.addEventListener('pointerdown',event=>{const menu=q('#cs-calendar-budget');if(menu?.open&&!menu.contains(event.target))menu.open=false;});
  root.addEventListener('keydown',event=>{const menu=q('#cs-calendar-display');if(event.key==='Escape'&&menu?.open){event.preventDefault();event.stopPropagation();menu.open=false;menu.querySelector('summary').focus({preventScroll:true});}},true);
  q('#cs-calendar-display').addEventListener('click',event=>{
    if(!event.target.closest('#cs-view-switch [data-view]'))return;
    const menu=q('#cs-calendar-display'),context=JSON.stringify([state.page,state.week,state.view]);menu.open=false;
    const restoreFocus=()=>{if(context===JSON.stringify([state.page,state.week,state.view])&&!menu.open&&!planningReadBusy&&!planningReadBlocked&&([document.body,root].includes(document.activeElement)||menu.contains(document.activeElement)))menu.querySelector('summary').focus({preventScroll:true});};
    restoreFocus();if(planningReadBusy)planningReadPromise?.then(restoreFocus,()=>{});
  });
  q('#cs-calendar-display').addEventListener('focusout',event=>{const menu=q('#cs-calendar-display');if(menu.open&&event.relatedTarget&&!menu.contains(event.relatedTarget))menu.open=false;});
  q('#cs-date-jump').addEventListener('click',() => { const open = q('#cs-date-jump-panel').hidden; q('#cs-date-jump-panel').hidden = !open; q('#cs-date-jump').setAttribute('aria-expanded',String(open)); if (open) { q('#cs-jump-date').value = selectedDate(); q('#cs-jump-date').min = addDays(anchor,-364); q('#cs-jump-date').max = addDays(anchor,370); q('#cs-jump-date').focus({preventScroll:true}); } });
  q('#cs-jump-go').addEventListener('click',() => { if (q('#cs-jump-date').value && q('#cs-jump-date').reportValidity()) navigateTo(q('#cs-jump-date').value); });
  q('#cs-jump-date').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); q('#cs-jump-go').click(); } if (event.key === 'Escape') { q('#cs-date-jump-panel').hidden = true; q('#cs-date-jump').setAttribute('aria-expanded','false'); q('#cs-date-jump').focus(); } });
  restore(window.openai?.widgetState);
  if (globalThis.CleanRoomsPersistence) persistence = globalThis.CleanRoomsPersistence.create({onAccessChanged:resetChangedAccess,onReconciled:reconcilePlanning,onSaved:result=>{if(result.preferencesOnly!==true)employeeReader?.invalidate();if(result.publications)state.publications=clone(result.publications);if(result.activity)state.activity=clone(result.activity);if(result.leaveDecisions&&!state.demoSession)state.leaveDecisions=clone(result.leaveDecisions);if(result.checklistProgress)state.checklistProgress=clone(result.checklistProgress);if(result.reconciledStudio){render();paintEditorPlanningConflict();}if(!q('#cs-changes-layer').hidden&&!publicationBusy)renderChanges();},onStatus:status => { cloudStatus = status; renderCloudStatus(); if (cloudLoaded && state.role === 'employee') renderEmployee(); }});
  if(persistence?.directoryRead&&globalThis.CleanRoomsDirectory)directory=globalThis.CleanRoomsDirectory.create({transport:persistence,onReconciled:applyDirectory});
  if(persistence?.action&&globalThis.CleanRoomsEmployeePersistence)employeeReader=globalThis.CleanRoomsEmployeePersistence.create({transport:{action:accountAction},onChange:adoptEmployeeRead});
  q('#cs-page-help').addEventListener('click',event=>openPageHelp(event.currentTarget));
  q('#cs-employee-help').addEventListener('click',event=>openPageHelp(event.currentTarget));
  q('#cs-search').value = state.search; q('#cs-site-filter').value = state.site; render();
  globalThis.CleanRoomsCombobox?.enhanceAll(root);
  if (persistence) initializeCloud();
  window.addEventListener('focus',()=>void refreshOnReturn());
  window.addEventListener('online',()=>void refreshOnReturn(true));
  document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)void refreshOnReturn();});
  window.addEventListener('beforeunload',event=>{if(editorHasDirtyDraft()||timeView?.hasDraft||timeView?.busy||timeBusy||persistence?.hasPendingPlanSave){event.preventDefault();event.returnValue='';}});
  window.addEventListener('openai:set_globals', event => { if (!persistence && event.detail?.globals?.widgetState) { restore(event.detail.globals.widgetState); q('#cs-search').value = state.search; q('#cs-site-filter').value = state.site; render(); } });
  compactViewport?.addEventListener('change', () => { renderSession(); if (state.page === 'schedule') { if (state.view === 'auto') state.pageIndex = 0; render(); } });
  motionPreference?.addEventListener('change', () => { if (motionPreference.matches) { navigationAnimation?.cancel(); navigationAnimation = null; } });
  window.addEventListener('load', icons, {once:true});
  if (globalThis.Tweak) {
    const tweak = new Tweak({container:root,onChange:render});
    tweak.addSlider(design, 'rowHeight', {label:'Rækkehøjde',min:66,max:96,step:2,unit:'px'}); tweak.addToggle(design, 'showAvatars', {label:'Vis initialer'});
  }
})();
