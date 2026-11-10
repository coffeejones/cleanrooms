/* Shared web views over server-owned shift messages and transfer requests. */
(() => {
  'use strict';
  const STATUS={awaiting_colleague:'Afventer kollega',pending:'Afventer godkendelse',accepted:'Afventer godkendelse',declined:'Afslået af kollega',cancelled:'Trukket tilbage',approved:'Godkendt',rejected:'Afvist',stale:'Vagten er ændret'};
  const ACTIVE=new Set(['awaiting_colleague','pending','accepted']);
  const KIND={new:'Ny vagt',changed:'Vagten er ændret',moved:'Vagten er flyttet',cancelled:'Vagten er aflyst',request:'Svar på anmodning',reminder:'Vagtpåmindelse',checkout_reminder:'Husk at stemple ud'};
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dateLabel=(value,full=false)=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{weekday:full?'long':'short',day:'numeric',month:'short',timeZone:'UTC'}):'Dato mangler';
  const stamp=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleString('da-DK',{dateStyle:'short',timeStyle:'short'}):'';};
  const clock=shift=>shift?.start&&shift?.end?shift.start+'–'+shift.end+(shift.end<shift.start?' +1 dag':''):'—';
  const sortNewest=(a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id||'').localeCompare(String(a.id||''));
  const list=value=>Array.isArray(value)?value:[];
  const titleFor=item=>KIND[item.kind]||item.summary||'Besked om din vagt';
  const canCompare=(before,after)=>before&&after;
  const summaryFor=(item={})=>{
    const before=item.before,after=item.after,shift=after||before;
    if(!shift)return item.summary||'Åbn beskeden for at se detaljerne.';
    if(canCompare(before,after)){
      if(before.date!==after.date)return dateLabel(before.date)+' '+clock(before)+' → '+dateLabel(after.date)+' '+clock(after);
      if(clock(before)!==clock(after))return dateLabel(after.date)+': '+clock(before)+' → '+clock(after);
      if(before.site!==after.site)return dateLabel(after.date)+' · '+clock(after)+' · Nyt arbejdssted';
      return dateLabel(after.date)+' · '+clock(after);
    }
    return dateLabel(shift.date)+' · '+clock(shift);
  };

  function mount({element,onAction,onOpenShift,onRefresh,onOpenSchedule,onLoadMore}={}) {
    if(!element?.ownerDocument)throw new TypeError('Beskeder og vagtanmodninger kræver et indholdsfelt.');
    const doc=element.ownerDocument,page=doc.createElement('div');page.className='cs-workflow';element.replaceChildren(page);
    let options={},mode='messages',tab='requests',filter='all',query='',pageIndex=0,selected=null,offer=null,reject=null,pending=false,disposed=false,error='',message='',lastShift=null,generation=0,scopeKey='',requestManager=null,requestManagerElement=null,receiptManager=null,receiptManagerElement=null,inspectorReturnTop=0,inspectorReturnFocus='';
    const node=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
    const bundle=()=>options.bundle||{};
    const contextFor=value=>{const data=value.bundle||{};return [value.mode||mode,data.personId||'',data.canManage===true?'manager':'person',data.preview===true?'preview':'live',data.demo===true?'demo':'ordinary'].join('|');};
    const acceptBundle=next=>{if(!next)return;const old=bundle();if(Number.isSafeInteger(next.revision)&&Number.isSafeInteger(old.revision)&&next.revision<old.revision)return;options={...options,bundle:next};};
    const readOnly=()=>bundle().preview===true;
    const busy=()=>pending||options.loading===true;
    const allowed=()=>!busy()&&!readOnly();
    const button=(label,action,key,cls='cs-button cs-workflow-button')=>{const el=node('button',cls,label);el.type='button';el.disabled=busy();if(key)el.dataset.workflowFocus=key;el.addEventListener('click',event=>{if(!disposed&&!el.disabled)action?.(event.currentTarget||el);});return el;};
    const personName=id=>list(bundle().colleagues).find(p=>(p.id||p.personId)===id)?.name||id||'Medarbejder';
    const siteName=shift=>shift?.siteName||list(options.sites).find((s,index)=>(s.index??index)===shift?.site)?.name||'Arbejdssted';
    const badge=(label,state)=>{const el=node('span','cs-workflow-state',label);if(state)el.dataset.state=state;return el;};
    const empty=(body,title,detail)=>{const el=node('div','cs-workflow-empty');el.append(node('h3','',title));if(detail)el.append(node('p','cs-workflow-muted',detail));body.append(el);};
    const currentRequest=()=>list(bundle().requests).find(item=>item.id===selected?.id);
    const activeRequestFor=shiftId=>list(bundle().requests).find(item=>item.shift?.id===shiftId&&ACTIVE.has(item.status)&&(item.fromPersonId===bundle().personId||item.toPersonId===bundle().personId));
    function field(labelText,kind,value,key){const label=node('label','cs-workflow-field'),input=node(kind==='textarea'?'textarea':kind==='select'?'select':'input','cs-workflow-input');if(kind==='input')input.type='text';if(kind==='textarea')input.rows=4;input.value=value||'';input.disabled=busy();input.dataset.workflowFocus=key;label.append(node('span','cs-workflow-label',labelText),input);return {label,input};}
    function setTab(value){tab=value;filter=mode==='manager'&&value==='requests'?'pending':'all';selected=null;offer=null;reject=null;query='';pageIndex=0;error='';message='';const body=page.querySelector('.cs-workflow-body');if(body)body.scrollTop=0;paint('tab:'+value);}
    function captureInspectorOrigin(){inspectorReturnTop=page.querySelector('.cs-workflow-body')?.scrollTop||0;inspectorReturnFocus=doc.activeElement?.dataset?.workflowFocus||'';}
    function openRequest(item){captureInspectorOrigin();selected={type:'request',id:item.id};reject=null;error='';paint('back');}
    function openMessage(item,delivery=false){captureInspectorOrigin();selected={type:delivery?'delivery':'message',id:item.id};error='';paint('back');if(!delivery&&!item.readAt&&!readOnly()&&allowed())invoke('workflowReadMessage',{messageId:item.id},'',false);}
    async function refresh(){if(busy()||typeof onRefresh!=='function')return;const started=generation;pending=true;error='';paint();try{const result=await onRefresh();if(disposed||started!==generation)return;if(result?.bundle)acceptBundle(result.bundle);}catch(problem){if(started===generation)error=problem?.message||'Kunne ikke hente de seneste oplysninger.';}finally{if(started===generation){pending=false;if(!disposed)paint();}}}
    async function invoke(action,payload,success='',close=false){
      if(!allowed()||typeof onAction!=='function')return;
      const started=generation;pending=true;error='';message='';paint();
      try{
        const result=await onAction(action,payload);if(disposed||started!==generation)return;
        if(!result||result.ok===false){error=result?.message||'Handlingen kunne ikke gennemføres. Prøv igen.';if(result?.bundle)acceptBundle(result.bundle);return;}
        const next=result.bundle||(Array.isArray(result.notifications)?result:null);if(next)acceptBundle(next);
        message=success;if(close){offer=null;reject=null;selected=null;}
      }catch(problem){if(started===generation)error=problem?.message||'Der er ikke forbindelse. Dine oplysninger er bevaret.';}
      finally{if(started===generation){pending=false;if(!disposed)paint();}}
    }
    function tools(body,filters,refreshButton=true){
      const bar=node('div','cs-workflow-tools'),choices=node('div','cs-workflow-filters');choices.setAttribute('role','group');choices.setAttribute('aria-label','Filtrer visningen');
      for(const [value,label]of filters){const el=button(label,()=>{filter=value;pageIndex=0;paint('filter:'+value);},'filter:'+value,'cs-workflow-filter');el.setAttribute('aria-pressed',String(filter===value));choices.append(el);}bar.append(choices);
      if(mode==='manager'&&tab==='requests'||mode==='manager'&&tab==='deliveries'){
        const search=field('Søg','input',query,'search');search.input.type='search';search.input.placeholder=tab==='deliveries'?'Søg medarbejder eller vagt':'Søg medarbejder eller anmodning';search.label.className+=' cs-workflow-search';search.input.addEventListener('input',()=>{query=search.input.value;pageIndex=0;paint('search');});bar.append(search.label);
      }
      if(refreshButton&&typeof onRefresh==='function')bar.append(button('Opdater',refresh,'refresh','cs-button cs-workflow-button cs-workflow-refresh cs-chrome-quiet'));body.append(bar);
    }
    function pagination(body,items,renderRow){
      const size=20,count=Math.max(1,Math.ceil(items.length/size));pageIndex=Math.min(pageIndex,count-1);
      const rows=node('div','cs-workflow-list');items.slice(pageIndex*size,(pageIndex+1)*size).forEach(item=>rows.append(renderRow(item)));body.append(rows);
      if(items.length>size){const pager=node('nav','cs-workflow-pagination');pager.setAttribute('aria-label','Sider i listen');const prev=button('Forrige',()=>{pageIndex--;paint('page:prev');},'page:prev'),next=button('Næste',()=>{pageIndex++;paint('page:next');},'page:next');prev.disabled=busy()||pageIndex===0;next.disabled=busy()||pageIndex===count-1;pager.append(node('span','cs-workflow-muted',(pageIndex*size+1)+'–'+Math.min((pageIndex+1)*size,items.length)+' af '+items.length),prev,next);body.append(pager);}
    }
    function messageRow(item,delivery){
      const row=button('',()=>openMessage(item,delivery),'message:'+item.id,'cs-workflow-message-row');row.dataset.unread=String(!item.readAt);row.setAttribute('aria-label',(delivery?(item.personName||personName(item.personId))+': ':'')+titleFor(item)+'. '+summaryFor(item)+(!item.readAt?'. Ikke set':'. Set'));
      const marker=node('span','cs-workflow-message-marker',item.kind==='cancelled'?'−':item.kind==='new'?'+':'↗');marker.setAttribute('aria-hidden','true');marker.dataset.kind=item.kind;
      const copy=node('span','cs-workflow-row-copy');copy.append(node('strong','',delivery?(item.personName||personName(item.personId)):titleFor(item)),node('span','cs-workflow-row-summary',summaryFor(item)),node('span','cs-workflow-muted',siteName(item.after||item.before)+(item.createdAt?' · '+stamp(item.createdAt):'')));
      const end=node('span','cs-workflow-row-end');end.append(badge(item.readAt?'Set':'Ikke set',item.readAt?'read':'unread'),node('span','cs-workflow-chevron','›'));row.append(marker,copy,end);return row;
    }
    function paintMessages(body,delivery=false){
      if(delivery){
        if(!receiptManager){receiptManagerElement=node('div','cs-workflow-receipts-host');const View=globalThis.CleanRoomsWorkflowReadStatus||(typeof require==='function'?require('./workflow-read-status.js'):null);receiptManager=View.mount({element:receiptManagerElement,onOpenMessage:item=>openMessage(item,true),onRefresh});}
        body.append(receiptManagerElement);receiptManager.render({bundle:bundle(),loading:busy(),scopeKey});return;
      }
      const all=list(delivery?bundle().deliveries:bundle().notifications).slice().sort(sortNewest),unread=all.filter(item=>!item.readAt).length;
      const intro=node('div','cs-workflow-list-head');intro.append(node('p','cs-workflow-muted',delivery?all.length+' beskeder · '+unread+' ikke set':unread?unread+(unread===1?' ulæst besked':' ulæste beskeder'):'Du er opdateret'));body.append(intro);
      tools(body,[['all','Alle'],['unread',delivery?'Ikke set':'Ulæste']]);
      const term=query.trim().toLocaleLowerCase('da-DK'),items=all.filter(item=>(filter!=='unread'||!item.readAt)&&(!term||[item.personName,titleFor(item),summaryFor(item),siteName(item.after||item.before)].join(' ').toLocaleLowerCase('da-DK').includes(term)));
      if(!items.length){empty(body,filter==='unread'?'Ingen ulæste beskeder':delivery?'Ingen beskeder sendt endnu':'Ingen beskeder endnu',delivery?'Når du udgiver ændringer, kan du se her, hvem der har set dem.':'Nye vagter og ændringer i din udgivne plan vises her.');return;}
      pagination(body,items,item=>messageRow(item,delivery));
    }
    function requestRow(item){
      const row=button('',()=>openRequest(item),'request:'+item.id,'cs-workflow-request-row'),copy=node('span','cs-workflow-row-copy'),people=item.kind==='claim'?(item.fromName||personName(item.fromPersonId)):(item.fromName||personName(item.fromPersonId))+' → '+(item.toName||personName(item.toPersonId));
      copy.append(node('strong','',people),node('span','cs-workflow-row-summary',dateLabel(item.shift?.date)+' · '+clock(item.shift)+' · '+siteName(item.shift)),node('span','cs-workflow-muted',item.kind==='claim'?'Ønsker ledig vagt':'Tilbyder sin vagt'));
      const end=node('span','cs-workflow-row-end');end.append(badge(STATUS[item.status]||'Afventer',item.status),node('span','cs-workflow-chevron','›'));row.append(copy,end);return row;
    }
    function paintRequests(body){
      if(mode==='manager'){
        if(!requestManager){requestManagerElement=node('div','cs-workflow-requests-host');const View=globalThis.CleanRoomsWorkflowRequests||(typeof require==='function'?require('./workflow-requests-view.js'):null);requestManager=View.mount({element:requestManagerElement,onOpenRequest:openRequest,onRefresh});}
        body.append(requestManagerElement);requestManager.render({bundle:bundle(),loading:busy(),scopeKey});return;
      }
      const all=list(bundle().requests).slice().sort(sortNewest),mine=bundle().personId;
      let items=mode==='manager'?all:tab==='incoming'?all.filter(item=>item.toPersonId===mine&&item.kind==='offer'):all.filter(item=>item.fromPersonId===mine);
      if(mode==='manager'){tools(body,[['pending','Afventer'],['all','Alle']]);if(filter==='pending')items=items.filter(item=>['pending','accepted','awaiting_colleague'].includes(item.status));}
      const term=query.trim().toLocaleLowerCase('da-DK');items=items.filter(item=>!term||[item.fromName,item.toName,dateLabel(item.shift?.date),siteName(item.shift),STATUS[item.status]].join(' ').toLocaleLowerCase('da-DK').includes(term));
      if(!items.length){empty(body,mode==='manager'?'Ingen anmodninger til gennemgang':tab==='incoming'?'Ingen tilbud fra kolleger':'Du har ingen anmodninger endnu',mode==='manager'?'Anmodninger om ledige vagter og overdragelser samles her.':tab==='incoming'?'Når en kollega tilbyder dig en vagt, kan du svare her.':'Tilbyd en af dine vagter, eller meld dig til en ledig vagt.');return;}
      pagination(body,items,requestRow);
    }
    function paintOpenShifts(body){
      const all=list(bundle().openShifts).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start).localeCompare(String(b.start)));
      if(typeof onRefresh==='function'){const bar=node('div','cs-workflow-tools');bar.append(node('span','cs-workflow-muted',all.length+(all.length===1?' ledig vagt':' ledige vagter')),button('Opdater',refresh,'refresh','cs-button cs-workflow-button cs-workflow-refresh cs-chrome-quiet'));body.append(bar);}
      if(!all.length){empty(body,'Ingen ledige vagter lige nu','Når en udgivet vagt mangler en medarbejder, kan du melde din interesse her.');return;}
      pagination(body,all,shift=>{const row=button('',()=>{selected={type:'open',id:shift.id};error='';paint('back');},'open:'+shift.id,'cs-workflow-request-row'),copy=node('span','cs-workflow-row-copy');copy.append(node('strong','',dateLabel(shift.date,true)),node('span','cs-workflow-row-summary',clock(shift)+' · '+siteName(shift)));const end=node('span','cs-workflow-row-end');end.append(badge(activeRequestFor(shift.id)?'Anmodet':'Ledig',activeRequestFor(shift.id)?'pending':'open'),node('span','cs-workflow-chevron','›'));row.append(copy,end);return row;});
    }
    function shiftFacts(shift,label){
      const section=node('section','cs-workflow-shift-facts');if(label)section.append(node('h4','cs-workflow-section-title',label));
      const time=node('strong','cs-workflow-shift-time',clock(shift));section.append(time,node('span','cs-workflow-shift-date',dateLabel(shift?.date,true)),node('span','cs-workflow-muted',siteName(shift)));if(shift?.plannedBreakMinutes)section.append(node('span','cs-workflow-muted',shift.plannedBreakMinutes+' min planlagt pause'));return section;
    }
    function back(body,label='Tilbage'){body.append(button(label,()=>{selected=null;offer=null;reject=null;error='';paint();const scroller=page.querySelector('.cs-workflow-body');if(scroller)scroller.scrollTop=inspectorReturnTop;const target=[...page.querySelectorAll('[data-workflow-focus]')].find(el=>el.dataset.workflowFocus===inspectorReturnFocus);target?.focus?.({preventScroll:true});},'back','cs-workflow-back'));}
    function paintMessageDetail(body,delivery){
      const item=list(delivery?bundle().deliveries:bundle().notifications).find(row=>row.id===selected.id);back(body,delivery?'Tilbage til læsestatus':'Tilbage');if(!item){empty(body,'Beskeden er ikke længere i listen','Hent de seneste oplysninger.');return;}
      const section=node('section','cs-workflow-message-detail');section.setAttribute('aria-label',delivery?'Besked og læsestatus':'Besked');
      const head=node('header','cs-workflow-detail-head');head.append(node('h3','cs-workflow-title',delivery?(item.personName||personName(item.personId)):titleFor(item)),badge(item.readAt?'Åbnet':'Ikke åbnet',item.readAt?'read':'unread'));section.append(head);
      section.append(node('p','cs-workflow-detail-subtitle',delivery?titleFor(item):stamp(item.createdAt)));
      if(delivery){const metadata=node('dl','cs-workflow-message-metadata');for(const [label,value]of [['Sendt',stamp(item.createdAt)||'Tidspunkt mangler'],['Åbnet',item.readAt?stamp(item.readAt):'Ikke åbnet']]){const pair=node('div');pair.append(node('dt','',label),node('dd','',value));metadata.append(pair);}section.append(metadata);}
      if(item.summary)section.append(node('p','cs-workflow-detail-summary',item.summary));
      const before=item.before,after=item.after;
      if(before&&after){
        const context=after||before;section.append(node('p','cs-workflow-change-context',dateLabel(context.date,true)+' · '+siteName(context)));
        const table=node('table','cs-workflow-change-table'),thead=node('thead'),header=node('tr'),tbody=node('tbody');table.setAttribute('aria-label','Ændringen i vagten');for(const text of ['Oplysning','Før','Nu']){const th=node('th','',text);th.scope='col';header.append(th);}thead.append(header);
        const facts=[['Dato',dateLabel(before.date,true),dateLabel(after.date,true),before.date!==after.date],['Arbejdstid',clock(before),clock(after),clock(before)!==clock(after)],['Arbejdssted',siteName(before),siteName(after),before.site!==after.site||siteName(before)!==siteName(after)],['Planlagt pause',(before.plannedBreakMinutes||0)+' min',(after.plannedBreakMinutes||0)+' min',(before.plannedBreakMinutes||0)!==(after.plannedBreakMinutes||0)]];
        for(const [label,left,right,changed]of facts){if(!changed)continue;const row=node('tr'),name=node('th','',label);name.scope='row';row.append(name,node('td','',left),node('td','cs-workflow-change-new',right));tbody.append(row);}
        if(tbody.children.length){table.append(thead,tbody);section.append(table);}else section.append(node('p','cs-workflow-muted','Vagtens instruktioner eller øvrige oplysninger er opdateret. Åbn vagten for at se de aktuelle oplysninger.'));
      }else{const fact=after||before;if(fact)section.append(shiftFacts(fact,after?'Den nye vagt':'Den aflyste vagt'));}
      if(!delivery&&item.readAt)section.append(node('p','cs-workflow-receipt','Åbnet '+stamp(item.readAt)));
      else if(!delivery&&!readOnly())section.append(button('Markér som læst',()=>invoke('workflowReadMessage',{messageId:item.id}),'message:read'));
      const request=item.requestId&&list(bundle().requests).find(row=>row.id===item.requestId),requestLinkAllowed=item.kind!=='request'||delivery||Boolean(request&&(request.status==='approved'?request.toPersonId===bundle().personId:request.shift?.person===bundle().personId));
      const actions=node('div','cs-workflow-actions');if(requestLinkAllowed&&item.after?.id&&validDate(item.after.date)&&item.kind!=='cancelled'&&typeof onOpenShift==='function')actions.append(button('Åbn vagt',()=>onOpenShift(item.after.id,item.after),'message:shift','cs-button cs-primary cs-workflow-button'));else if(item.kind==='cancelled')section.append(node('p','cs-workflow-muted','Vagten er fjernet fra kalenderen. Beskeden bevares, så ændringen kan ses igen.'));
      if(request)actions.append(button('Se anmodning',()=>openRequest(request),'message:request'));if(actions.children.length)section.append(actions);body.append(section);
    }
    function paintRequestDetail(body){
      const item=currentRequest();back(body,mode==='manager'?'Tilbage til anmodninger':'Tilbage');if(!item){empty(body,'Anmodningen findes ikke i denne visning','Hent de seneste oplysninger.');return;}
      const detail=node('section','cs-workflow-request-detail');detail.setAttribute('aria-label','Anmodningens oplysninger');
      const head=node('header','cs-workflow-detail-head');head.append(node('h3','cs-workflow-title',item.kind==='claim'?'Anmodning om ledig vagt':'Overdragelse af vagt'),badge(STATUS[item.status]||'Afventer',item.status));detail.append(head);
      const from=item.fromName||personName(item.fromPersonId),to=item.toName||personName(item.toPersonId);
      detail.append(node('p','cs-workflow-detail-subtitle',item.kind==='claim'?from+' ønsker at tage vagten.':from+' ønsker at overdrage vagten til '+to+'.'));
      const summary=node('div','cs-workflow-request-summary'),identities=node('dl','cs-workflow-request-people');
      for(const [label,value]of item.kind==='claim'?[['Ønsker vagten',from]]:[['Nuværende medarbejder',from],['Overtager vagten',to]]){const pair=node('div');pair.append(node('dt','',label),node('dd','',value));identities.append(pair);}
      summary.append(shiftFacts(item.shift,'Vagten'),identities);detail.append(summary);
      if(item.comment){const note=node('section','cs-workflow-note');note.append(node('h4','cs-workflow-section-title','Kommentar fra medarbejderen'),node('p','',item.comment));detail.append(note);}
      if(item.blockedReason||Array.isArray(item.conflicts)&&item.conflicts.length){const warning=node('section','cs-workflow-error cs-workflow-clarification');warning.setAttribute('aria-label','Det skal afklares');warning.append(node('h4','cs-workflow-section-title','Det skal afklares'));if(item.blockedReason)warning.append(node('p','',item.blockedReason));for(const conflict of list(item.conflicts))warning.append(node('p','',typeof conflict==='string'?conflict:conflict.message||conflict.label||'Vagten kræver gennemgang.'));detail.append(warning);}
      const decision=node('section','cs-workflow-decision');decision.setAttribute('aria-label',ACTIVE.has(item.status)?'Næste trin':'Beslutning');decision.append(node('h4','cs-workflow-section-title',bundle().canManage&&['pending','accepted'].includes(item.status)?'Din beslutning':ACTIVE.has(item.status)?'Næste trin':'Beslutning'));
      if(item.decisionReason){const note=node('div','cs-workflow-decision-note');note.append(node('p','',item.decisionReason));decision.append(note);}
      const actions=node('div','cs-workflow-actions'),mine=bundle().personId;
      if(!readOnly()&&bundle().canManage&&['pending','accepted'].includes(item.status)){
        if(reject?.id===item.id){const box=node('form','cs-workflow-form');box.setAttribute('aria-label','Afvis anmodning');const reason=field('Begrundelse til medarbejderen','textarea',reject.reason,'reject:reason');reason.input.required=true;reason.input.addEventListener('input',()=>{reject.reason=reason.input.value;});box.append(reason.label);const controls=node('div','cs-workflow-actions');controls.append(button('Afvis anmodning',()=>{if(!reject.reason.trim()){error='Skriv en begrundelse til medarbejderen.';paint('reject:reason');return;}invoke('workflowDecide',{requestId:item.id,version:reject.version,decision:'reject',reason:reject.reason.trim()},'Anmodningen er afvist.',true);},'reject:save','cs-button cs-workflow-button'),button('Annuller',()=>{reject=null;paint('request:reject');},'reject:cancel'));box.append(controls);box.addEventListener('submit',event=>event.preventDefault());decision.append(box);}
        else{const approve=button('Godkend anmodning',()=>invoke('workflowDecide',{requestId:item.id,version:item.version,decision:'approve'},bundle().demo?'Anmodningen er godkendt. Eksempelvagten er opdateret.':'Anmodningen er godkendt. Vagtplanen er opdateret.',true),'request:approve','cs-button cs-primary cs-workflow-button');approve.disabled=busy()||item.shiftCurrent===false||Boolean(item.blockedReason)||item.canApprove===false||Boolean(item.conflicts?.length);actions.append(approve,button('Afvis',()=>{reject={id:item.id,version:item.version,reason:''};paint('reject:reason');},'request:reject'));decision.append(node('p','cs-workflow-muted',bundle().demo?'Godkendelsen ændrer kun demovagten. Beskeder og læsestatus gemmes i demoforløbet.':'Ved godkendelse opdateres den udgivne vagt, og de berørte medarbejdere får en besked. Overlap og godkendt fravær kontrolleres igen.'));}
      }else if(bundle().canManage&&item.status==='awaiting_colleague')decision.append(node('p','cs-workflow-muted',(item.toName||personName(item.toPersonId))+' skal først acceptere vagten. Anmodningen kommer derefter til din godkendelse.'));
      else if(!readOnly()&&item.status==='awaiting_colleague'&&item.toPersonId===mine){const accept=button('Acceptér vagten',()=>invoke('workflowRespond',{requestId:item.id,version:item.version,decision:'accept'},'Du har accepteret. Anmodningen afventer nu planlæggeren.',true),'request:accept','cs-button cs-primary cs-workflow-button');accept.disabled=busy()||item.shiftCurrent===false||Boolean(item.blockedReason);actions.append(accept,button('Afslå',()=>invoke('workflowRespond',{requestId:item.id,version:item.version,decision:'decline'},'Tilbuddet er afslået.',true),'request:decline'));}
      if(!readOnly()&&ACTIVE.has(item.status)&&item.fromPersonId===mine)actions.append(button('Træk anmodning tilbage',()=>invoke('workflowRespond',{requestId:item.id,version:item.version,decision:'cancel'},'Anmodningen er trukket tilbage.',true),'request:cancel'));
      if(item.status==='stale')decision.append(node('p','cs-workflow-muted','Vagten er ændret siden anmodningen blev sendt. Opret en ny anmodning ud fra den aktuelle vagt.'));
      if(actions.children.length)decision.append(actions);
      if(!ACTIVE.has(item.status)&&!item.decisionReason)decision.append(node('p','cs-workflow-muted',STATUS[item.status]||'Anmodningen er behandlet.'));
      detail.append(decision);
      const related=node('div','cs-workflow-related');if(mode==='manager'&&validDate(item.shift?.date)&&typeof onOpenSchedule==='function')related.append(button(bundle().demo?'Vis eksempelvagt':'Vis i vagtplan',()=>onOpenSchedule(item.shift),'request:schedule'));else if(item.shift?.id&&validDate(item.shift.date)&&typeof onOpenShift==='function'&&(item.status==='approved'?item.toPersonId===bundle().personId:item.shift.person===bundle().personId))related.append(button('Åbn vagt',()=>onOpenShift(item.shift.id,item.shift),'request:shift'));if(related.children.length)detail.append(related);
      detail.append(node('p','cs-workflow-timestamp','Oprettet '+stamp(item.createdAt)+(item.updatedAt&&item.updatedAt!==item.createdAt?' · Opdateret '+stamp(item.updatedAt):'')));body.append(detail);
    }
    function paintOpenDetail(body){
      const shift=list(bundle().openShifts).find(item=>item.id===selected.id);back(body);if(!shift){empty(body,'Vagten er ikke længere ledig','En anden medarbejder kan være blevet tildelt vagten.');return;}body.append(node('h3','cs-workflow-title','Ledig vagt'),shiftFacts(shift));const existing=activeRequestFor(shift.id);
      if(existing){body.append(node('p','cs-workflow-muted','Du har allerede en anmodning til denne vagt.'),button('Se anmodning',()=>openRequest(existing),'claim:existing'));return;}
      const note=field('Kommentar til planlæggeren · valgfrit','textarea',offer?.kind==='claim'?offer.comment:'','claim:comment');note.input.addEventListener('input',()=>{offer={kind:'claim',comment:note.input.value};});body.append(note.label,node('p','cs-workflow-muted','Vagten bliver først din, når planlæggeren har godkendt.'));
      const claim=button('Anmod om vagten',()=>invoke('workflowRequest',{kind:'claim',shiftId:shift.id,fingerprint:shift.fingerprint,comment:offer?.kind==='claim'?offer.comment:''},'Din anmodning er sendt til planlæggeren.',true),'claim:send','cs-button cs-primary cs-workflow-button');claim.disabled=busy()||readOnly()||shift.canClaim===false||!shift.fingerprint;body.append(claim);if(shift.ineligibleReason)body.append(node('p','cs-workflow-muted',shift.ineligibleReason));
    }
    function paintOffer(body){
      back(body);body.append(node('h3','cs-workflow-title','Tilbyd en vagt til en kollega'),node('p','cs-workflow-muted','Kollegaen svarer først. Planlæggeren godkender den endelige overdragelse.'));
      const shifts=list(bundle().ownShifts||options.shifts),colleagues=list(bundle().colleagues).filter(item=>(item.id||item.personId)!==bundle().personId);
      if(!shifts.length){empty(body,'Ingen kommende vagter at tilbyde','Du kan kun tilbyde dine egne, udgivne vagter.');return;}
      const form=node('form','cs-workflow-form');form.setAttribute('aria-label','Tilbyd vagt');const shiftField=field('Vælg din vagt','select',offer.shiftId,'offer:shift'),placeholder=node('option','','Vælg en vagt');placeholder.value='';shiftField.input.append(placeholder);for(const shift of shifts){const option=node('option','',dateLabel(shift.date)+' · '+clock(shift)+' · '+siteName(shift));option.value=shift.id;shiftField.input.append(option);}shiftField.input.value=offer.shiftId||'';shiftField.input.required=true;shiftField.input.addEventListener('change',()=>{offer.shiftId=shiftField.input.value;paint('offer:colleague-search');});form.append(shiftField.label);
      const colleagueSearch=field('Find kollega','input',offer.search,'offer:colleague-search');colleagueSearch.input.type='search';colleagueSearch.input.placeholder='Søg efter navn';colleagueSearch.input.addEventListener('input',()=>{offer.search=colleagueSearch.input.value;paint('offer:colleague-search');});form.append(colleagueSearch.label);
      const person=field('Kollega','select',offer.toPersonId,'offer:person'),blank=node('option','','Vælg en kollega');blank.value='';person.input.append(blank);const term=(offer.search||'').trim().toLocaleLowerCase('da-DK');for(const item of colleagues.filter(item=>!term||String(item.name).toLocaleLowerCase('da-DK').includes(term)||(item.id||item.personId)===offer.toPersonId)){const option=node('option','',item.name||'Medarbejder');option.value=item.id||item.personId;person.input.append(option);}person.input.value=offer.toPersonId||'';person.input.required=true;person.input.addEventListener('change',()=>{offer.toPersonId=person.input.value;});form.append(person.label);
      const comment=field('Kommentar til kollega og planlægger · valgfrit','textarea',offer.comment,'offer:comment');comment.input.addEventListener('input',()=>{offer.comment=comment.input.value;});form.append(comment.label);
      const send=button('Send tilbud',()=>{const shift=shifts.find(item=>item.id===offer.shiftId);if(!shift||!offer.toPersonId){error='Vælg en vagt og en kollega.';paint(!shift?'offer:shift':'offer:person');return;}if(!shift.fingerprint){error='Hent den seneste vagt, før du sender tilbuddet.';paint();return;}invoke('workflowRequest',{kind:'offer',shiftId:shift.id,toPersonId:offer.toPersonId,comment:offer.comment||'',fingerprint:shift.fingerprint},'Tilbuddet er sendt til din kollega.',true);},'offer:send','cs-button cs-primary cs-workflow-button');send.disabled=busy()||readOnly()||!colleagues.length;form.append(send);form.addEventListener('submit',event=>event.preventDefault());body.append(form);if(!colleagues.length)body.append(node('p','cs-workflow-muted','Der er ingen kolleger at tilbyde vagten til.'));
    }
    function paint(focusKey){
      if(disposed)return;const active=doc.activeElement,focus=focusKey||(element.contains?.(active)?active?.dataset?.workflowFocus:null),oldTop=page.querySelector('.cs-workflow-body')?.scrollTop||0;
      page.replaceChildren();page.dataset.mode=mode;page.setAttribute('aria-busy',String(busy()));
      if(mode!=='messages'){
        const tabs=node('div','cs-workflow-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',mode==='manager'?'Anmodninger og beskeder':'Vagtbytte og ledige vagter');
        for(const [value,label]of mode==='manager'?[['requests','Anmodninger'],['deliveries','Læsestatus']]:[['open','Ledige vagter'],['requests','Mine anmodninger'],['incoming','Tilbud til mig']]){const el=button(label,()=>setTab(value),'tab:'+value,'cs-workflow-tab');el.setAttribute('role','tab');el.setAttribute('aria-selected',String(tab===value));tabs.append(el);}page.append(tabs);
      }
      if(readOnly()){const preview=node('p','cs-workflow-preview','Forhåndsvisning · Beskeder kan læses her, men kun medarbejderens egen konto kan svare eller sende anmodninger.');preview.setAttribute('role','note');page.append(preview);}
      if(message){const notice=node('p','cs-workflow-success',message);notice.setAttribute('role','status');page.append(notice);}
      if(error||options.error){const notice=node('div','cs-workflow-error');notice.setAttribute('role','alert');notice.append(node('p','',error||options.error));if(typeof onRefresh==='function')notice.append(button('Hent seneste oplysninger',refresh,'refresh:error'));page.append(notice);}
      const body=node('div','cs-workflow-body');body.setAttribute('role','region');body.setAttribute('aria-label',mode==='messages'?'Beskeder':mode==='manager'?'Vagtanmodninger':'Vagtbytte');page.append(body);
      if(options.loading)empty(body,'Henter oplysninger…');
      else if(offer?.kind==='offer')paintOffer(body);
      else if(selected?.type==='request')paintRequestDetail(body);
      else if(selected?.type==='message'||selected?.type==='delivery')paintMessageDetail(body,selected.type==='delivery');
      else if(selected?.type==='open')paintOpenDetail(body);
      else if(mode==='messages')paintMessages(body);
      else if(mode==='manager'&&tab==='deliveries')paintMessages(body,true);
      else if(mode==='employee'&&tab==='open')paintOpenShifts(body);
      else paintRequests(body);
      if(!options.loading&&!selected&&typeof onLoadMore==='function'){
        const kinds=offer?['ownShifts','colleagues']:[mode==='messages'||mode==='manager'&&tab==='deliveries'?'messages':mode==='employee'&&tab==='open'?'openShifts':'requests'];
        for(const kind of kinds){const cursor=bundle().pagination?.[kind]?.nextCursor??bundle().pagination?.[kind];if(typeof cursor==='string'&&cursor)body.append(button(({messages:'Hent flere beskeder',requests:'Hent flere anmodninger',openShifts:'Hent flere ledige vagter',ownShifts:'Hent flere af mine vagter',colleagues:'Hent flere kolleger'})[kind],()=>onLoadMore(kind),'more:'+kind));}
      }
      if(mode==='employee'&&!selected&&!offer){const toolbar=node('div','cs-workflow-bottom-actions'),create=button('Tilbyd en vagt',()=>{offer={kind:'offer',shiftId:'',toPersonId:'',comment:'',search:''};error='';paint('offer:shift');},'offer:new','cs-button cs-primary cs-workflow-button');create.disabled=busy();toolbar.append(create);page.append(toolbar);}
      body.scrollTop=focusKey==='back'?0:oldTop;
      if(focus){const target=[...page.querySelectorAll('[data-workflow-focus]')].find(el=>el.dataset.workflowFocus===focus);target?.focus?.({preventScroll:true});}
    }
    return {render(next={}){
      if(disposed)return;
      const merged={...options,...next},nextMode=merged.mode||'messages',nextScope=contextFor(merged),contextChanged=scopeKey&&scopeKey!==nextScope;
      if(contextChanged||nextMode!==mode){requestManager?.dispose?.();requestManager=null;requestManagerElement=null;receiptManager?.dispose?.();receiptManager=null;receiptManagerElement=null;generation++;pending=false;selected=null;offer=null;reject=null;query='';pageIndex=0;error='';message='';lastShift=null;}
      if(nextMode!==mode){mode=nextMode;tab=mode==='employee'?'open':'requests';filter=mode==='manager'?'pending':'all';}
      if(!contextChanged&&next.bundle&&Number.isSafeInteger(next.bundle.revision)&&Number.isSafeInteger(bundle().revision)&&next.bundle.revision<bundle().revision)merged.bundle=bundle();
      options=merged;scopeKey=nextScope;
      if(next.selectedShiftId&&next.selectedShiftId!==lastShift&&mode==='employee'){lastShift=next.selectedShiftId;selected=null;offer={kind:'offer',shiftId:next.selectedShiftId,toPersonId:'',comment:'',search:''};}
      if(reject){const current=list(bundle().requests).find(item=>item.id===reject.id);if(!current||current.version!==reject.version){reject=null;error='Anmodningen er ændret. Gennemgå den seneste version.';}}
      paint();
    },dispose(){disposed=true;generation++;requestManager?.dispose?.();receiptManager?.dispose?.();element.replaceChildren();}};
  }
  const api=Object.freeze({mount,dateLabel,summaryFor});
  if(typeof module==='object'&&module.exports)module.exports=api;
  globalThis.CleanRoomsShiftWorkflowView=api;
})();
