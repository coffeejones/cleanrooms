(function(scope){
  const STATUS={pending:'Afventer',approved:'Godkendt',rejected:'Afvist'};
  const KINDS={plan:'Planændring',publication:'Udgivelse',checklist:'Tjekliste',time:'Timer',leave:'Fravær',access:'Kontoadgang',payroll:'Løn'};
  const AREAS={planning:'Vagtplan og serier',people:'Medarbejdere',leave:'Fravær',time:'Timer',settings:'Indstillinger',departments:'Afdelinger',checklist:'Tjeklister',access:'Brugere og roller',payroll:'Løn og tillæg'};
  const CHANGE_LABELS={series:'Vagtserie',edits:'Vagt',deleted:'Vagt',coverageRules:'Bemandingskrav',requests:'Fravær',leaveDecisions:'Svar på fravær',roster:'Medarbejder',workspaceSettings:'Indstillinger',organization:'Afdelinger',time:'Timer'};
  const text=value=>String(value??'').trim();
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  function filterLeave(requests,filters={}){
    const search=text(filters.q).toLocaleLowerCase('da-DK');
    return requests.filter(item=>(!filters.status||filters.status==='all'||item.status===filters.status)&&(!filters.type||filters.type==='all'||item.type===filters.type)&&(!search||text(item.name).toLocaleLowerCase('da-DK').includes(search))&&item.days.some(day=>(!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to))).sort((a,b)=>(a.days[0]||'').localeCompare(b.days[0]||'')||text(a.name).localeCompare(text(b.name),'da'));
  }
  const dateLabel=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):text(value);
  const stamp=value=>{const time=new Date(value);return Number.isNaN(time.getTime())?'Ukendt tidspunkt':time.toLocaleString('da-DK',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Copenhagen'});};
  const historyDay=new Intl.DateTimeFormat('da-DK',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Copenhagen'});
  const historyTime=new Intl.DateTimeFormat('da-DK',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Copenhagen'});
  function kit(doc){
    const node=(tag,cls='',copy)=>{const el=doc.createElement(tag);el.className=cls;if(copy!==undefined)el.textContent=String(copy);return el;};
    const button=(copy,action,cls='cs-button')=>{const el=node('button',cls,copy);el.type='button';el.addEventListener('click',action);return el;};
    const field=(label,control)=>{const wrap=node('label','cs-review-field');wrap.append(node('span','cs-review-label',label),control);return wrap;};
    const input=(type,label)=>{const el=node('input','cs-review-input');el.type=type;el.setAttribute('aria-label',label);return el;};
    const select=(label,items,value='all')=>{const el=node('select','cs-review-input');el.setAttribute('aria-label',label);for(const [id,copy] of items){const option=node('option','',copy);option.value=id;el.append(option);}el.value=value;return el;};
    return {node,button,field,input,select};
  }
  const leaveDate=new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  function leaveDetailPeriod(request){
    const first=request.days?.[0],last=request.days?.at(-1);
    if(!validDate(first)||!validDate(last)||first>last)return text(request.dates)||'—';
    const start=new Date(first+'T12:00:00Z'),end=new Date(last+'T12:00:00Z');
    return first===last?leaveDate.format(start):leaveDate.formatRange(start,end);
  }
  function leaveDialog({element,title,tag='section',trigger,onClose,focusFallback}){
    const doc=element.ownerDocument,{node,button}=kit(doc),owner=element.closest?.('#cleanrooms-studio')||element;
    const layer=node('dialog','cs-review-modal cs-leave-modal'),panel=node(tag,'cs-review-dialog cs-leave-dialog');
    const header=node('header','cs-leave-dialog-header'),heading=node('h3','',title);
    const body=node('div','cs-leave-dialog-body'),actions=node('div','cs-review-dialog-actions cs-leave-dialog-actions');
    const error=node('p','cs-review-error');error.setAttribute('role','alert');error.hidden=true;
    let busy=false,closed=false,observer=null;
    const previous=trigger||doc.activeElement;
    function close({force=false,restoreFocus=true}={}){
      if(closed||(busy&&!force))return;
      closed=true;observer?.disconnect();
      if(layer.open)layer.close?.();
      layer.remove();
      if(restoreFocus){
        const target=previous?.isConnected?previous:focusFallback?.()||element.querySelector?.('button,input,select,[tabindex]');
        if(target?.isConnected)target.focus?.({preventScroll:true});
      }
      onClose?.();
    }
    const dismiss=button('×',()=>close(),'cs-icon-button cs-chrome-quiet cs-leave-dismiss');
    dismiss.setAttribute('aria-label','Luk '+title.toLocaleLowerCase('da-DK'));
    layer.setAttribute('aria-label',title);layer.setAttribute('aria-modal','true');panel.tabIndex=-1;
    header.append(heading,dismiss);panel.append(header,body,error,actions);layer.append(panel);
    layer.addEventListener('cancel',event=>{event.preventDefault();close();});
    layer.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();close();}});
    function open(initialFocus){
      owner.append(layer);
      if(typeof layer.showModal==='function')layer.showModal();else layer.setAttribute('open','');
      const initialPage=owner.dataset?.page,initialRole=owner.dataset?.role,Observer=doc.defaultView?.MutationObserver;
      if(Observer){
        observer=new Observer(()=>{
          if(!element.isConnected||owner.dataset?.page!==initialPage||owner.dataset?.role!==initialRole)close({force:true,restoreFocus:false});
        });
        observer.observe(owner,{attributes:true,attributeFilter:['data-page','data-role'],childList:true,subtree:true});
      }
      (initialFocus||panel).focus({preventScroll:true});
    }
    function setBusy(value){busy=value;dismiss.disabled=value;panel.setAttribute('aria-busy',String(value));if(value)panel.focus();}
    function showError(message){error.textContent=message;error.hidden=false;}
    return {layer,panel,header,heading,dismiss,body,actions,error,open,close,setBusy,showError,get busy(){return busy;},get closed(){return closed;}};
  }
  function leaveDetails({element,request,canDecide,onDecision,trigger,onClose,focusFallback,initialRejection=false}){
    const {node,button,field}=kit(element.ownerDocument);
    const title=initialRejection?'Afvis fraværsanmodning':'Fraværsanmodning';
    const dialog=leaveDialog({element,title,trigger,onClose,focusFallback});
    const canRespond=Boolean(canDecide&&typeof onDecision==='function'&&(request.status==='pending'||initialRejection));
    const name=text(request.name)||'Medarbejder',status=request.status||'pending';
    dialog.layer.className+=' cs-leave-detail-modal';
    const identity=node('div','cs-leave-identity'),copy=node('div','cs-leave-identity-copy');
    const avatar=node('span','cs-leave-avatar',request.initials||name.split(/\s+/).slice(0,2).map(part=>part[0]).join(''));
    avatar.setAttribute('aria-hidden','true');
    const badge=node('span','cs-leave-state',STATUS[status]||status);badge.dataset.state=status;
    dialog.header.replaceChildren(identity,dialog.dismiss);
    dialog.heading.textContent=name;
    copy.append(node('p','cs-leave-detail-kicker',title),dialog.heading,badge);
    identity.append(avatar,copy);
    const facts=node('dl','cs-leave-facts');
    for(const [label,value] of [['Periode',leaveDetailPeriod(request)],['Fraværstype',request.type]]){
      const fact=node('div'),detail=node('dd','',value||'—');
      if(label==='Periode'&&request.days?.length>1)detail.append(node('span','cs-leave-detail-days',request.days.length+' dage'));
      fact.append(node('dt','',label),detail);facts.append(fact);
    }
    dialog.body.append(facts);
    if(text(request.comment)){
      const note=node('section','cs-leave-message');
      note.append(node('h4','','Kommentar'),node('p','',request.comment));dialog.body.append(note);
    }
    if(request.decision){
      const {reason,decidedBy,decidedAt}=request.decision,response=node('section','cs-leave-message cs-leave-response');
      response.append(node('h4','','Svar'));
      if(text(reason))response.append(node('p','',reason));
      const actor=decidedBy?.name||'Planlægger';
      response.append(node('p','cs-review-muted',decidedAt?actor+' · '+stamp(decidedAt):actor));dialog.body.append(response);
    }
    if(!canRespond){dialog.actions.hidden=true;dialog.open();return dialog;}

    const reasonPanel=node('div','cs-leave-rejection'),reason=node('textarea','cs-review-textarea');
    reason.rows=3;reason.required=true;reason.setAttribute('aria-label','Begrundelse for afvisning');
    reasonPanel.append(field('Begrundelse',reason),node('p','cs-review-muted','Medarbejderen kan se begrundelsen.'));
    reason.addEventListener('input',()=>{reason.removeAttribute('aria-invalid');dialog.error.hidden=true;});
    dialog.body.append(reasonPanel);
    const approve=button('Godkend',()=>decide('approved',approve),'cs-button cs-primary');
    const reject=button('Afvis',()=>{showRejection(true);reason.focus();},'cs-button cs-leave-danger');
    const confirm=button('Afvis anmodning',()=>decide('rejected',confirm),'cs-button cs-leave-danger cs-leave-danger-confirm');
    const cancel=button(initialRejection?'Annuller':'Tilbage',()=>{
      if(initialRejection)dialog.close();else{showRejection(false);reject.focus();}
    },'cs-button cs-chrome-quiet');
    function showRejection(visible){
      reasonPanel.hidden=!visible;dialog.error.hidden=true;reason.removeAttribute('aria-invalid');
      dialog.actions.replaceChildren(...(visible?[cancel,confirm]:[reject,approve]));
    }
    async function decide(next,action){
      if(dialog.busy||dialog.closed)return;
      const value=next==='rejected'?text(reason.value):'';
      if(next==='rejected'&&!value){
        dialog.showError('Skriv en begrundelse for afvisningen.');reason.setAttribute('aria-invalid','true');reason.focus();return;
      }
      const actionLabel=action.textContent;
      for(const control of [approve,reject,cancel,confirm,reason])control.disabled=true;
      action.textContent='Gemmer…';dialog.error.hidden=true;dialog.setBusy(true);
      let result;
      try{result=await onDecision(request.id,next,value);}catch{result={ok:false};}
      if(dialog.closed)return;
      dialog.setBusy(false);
      for(const control of [approve,reject,cancel,confirm,reason])control.disabled=false;
      action.textContent=actionLabel;
      if(result?.ok){dialog.close();return;}
      const fallback=next==='approved'?'Godkendelsen kunne ikke gemmes.':'Afvisningen kunne ikke gemmes.';
      dialog.showError(result?.error||result?.message||fallback);action.focus();
    }
    showRejection(initialRejection);dialog.open(initialRejection?reason:null);return dialog;
  }
  function rejection(options){return leaveDetails({...options,canDecide:true,initialRejection:true});}
  function requestAbsence({element,people=[],personId=null,today,onSubmit}){
    const {node,button,field,input,select}=kit(element.ownerDocument);
    const title=personId?'Anmod om fravær':'Opret fravær',dialog=leaveDialog({element,title,tag:'form'});
    const available=people.filter(person=>person.active!==false);
    const person=select('Medarbejder',available.map(person=>[person.id,person.name]),available[0]?.id||'');
    const type=select('Fraværstype',[['Ferie','Ferie'],['Friønske','Friønske'],['Sygdom','Sygdom'],['Andet','Andet']],'Ferie');
    const from=input('date','Fra dato'),to=input('date','Til dato'),comment=node('textarea','cs-review-textarea');
    person.required=true;type.setAttribute('data-select-only','');
    from.value=to.value=today;from.required=to.required=true;comment.rows=3;comment.setAttribute('aria-label','Kommentar');
    const cancel=button('Annuller',()=>dialog.close(),'cs-button cs-chrome-quiet');
    const submit=button('Send anmodning',submitRequest,'cs-button cs-primary');
    if(!personId)dialog.body.append(field('Medarbejder',person));
    const period=node('div','cs-leave-form-dates');period.append(field('Fra',from),field('Til',to));
    dialog.body.append(field('Fraværstype',type),period,field('Kommentar (valgfri)',comment));
    dialog.actions.append(cancel,submit);
    async function submitRequest(){
      if(dialog.busy||dialog.closed)return;
      if(!validDate(from.value)||!validDate(to.value)||to.value<from.value){dialog.showError('Vælg en gyldig periode.');return;}
      const payload={personId:personId||person.value,from:from.value,to:to.value,type:type.value,comment:comment.value};
      if(!payload.personId){dialog.showError('Vælg en medarbejder.');return;}
      const controls=[person,type,from,to,comment,cancel,submit];
      for(const control of controls)control.disabled=true;
      submit.textContent='Gemmer…';dialog.error.hidden=true;dialog.setBusy(true);
      let result;
      try{result=await onSubmit(payload);}catch{result={ok:false};}
      if(dialog.closed)return;
      dialog.setBusy(false);
      for(const control of controls)control.disabled=false;
      submit.textContent='Send anmodning';
      if(result?.ok){dialog.close();return;}
      dialog.showError(result?.message||'Anmodningen kunne ikke gemmes.');submit.focus();
    }
    dialog.panel.addEventListener('submit',event=>{event.preventDefault();return submitRequest();});
    dialog.panel.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.defaultPrevented||event.isComposing||!['INPUT','SELECT'].includes(event.target?.tagName)||event.target.getAttribute('role')==='combobox')return;
      event.preventDefault();return submitRequest();
    });
    dialog.open(personId?from:person);return dialog;
  }
  function mountLeave({element,actionsHost,icon,onDecision,onCreate,onQuery}){
    const doc=element.ownerDocument,{node,button,field,input,select}=kit(doc),page=node('section','cs-leave-review-page'),tools=node('div','cs-review-tools'),search=input('search','Søg medarbejder'),type=select('Fraværstype',[['all','Alle typer']]),from=input('date','Fravær fra dato'),to=input('date','Fravær til dato'),tabs=node('div','cs-review-statuses'),results=node('div','cs-review-results'),feedback=node('p','cs-review-error');
    page.setAttribute('aria-label','Fraværsanmodninger');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Fraværsstatus');feedback.setAttribute('role','status');feedback.hidden=true;
    const createActions=node('div','cs-leave-create-actions'),create=onCreate&&button('Opret fravær',onCreate,'cs-button cs-primary');
    if(create){if(icon)create.replaceChildren(icon('plus'),node('span','','Opret fravær'));createActions.append(create);}
    if(actionsHost)actionsHost.replaceChildren(createActions);
    let data={requests:[],canDecide:false},status='pending',offset=0,modal=null,modalRequest=null,deciding=null,destroyed=false,queryGeneration=0,records=[],counts=null,nextCursor=null,hasMore=false,busy=false,loaded=false,error='',timer=null,pageIndex=0,pages=[{cursor:null,start:0}];
    const limit=40,statusButtons={},server=()=>typeof onQuery==='function'&&data.server!==false,filters=()=>Object.fromEntries(Object.entries({q:search.value.trim(),status,type:type.value,from:from.value,to:to.value}).filter(([,value])=>value&&value!=='all'));
    search.placeholder='Søg medarbejder';search.maxLength=120;type.setAttribute('data-select-only','');
    const closeModal=()=>{modal?.close({force:true,restoreFocus:false});modal=null;modalRequest=null;};
    const checkModal=rows=>{
      if(!modalRequest)return;
      if(modalRequest.canDecide&&!data.canDecide){closeModal();return;}
      if(deciding?.id===modalRequest.id)return;
      const row=rows.find(item=>item.id===modalRequest.id);
      if(!row||row.status!==modalRequest.status||row.version!==modalRequest.version)closeModal();
    };
    const periodLabel=request=>{
      const first=request.days?.[0],last=request.days?.at(-1);
      if(!validDate(first)||!validDate(last))return text(request.dates)||'Dato mangler';
      if(first===last)return dateLabel(first);
      if(first.slice(0,7)===last.slice(0,7))return Number(first.slice(8))+'.–'+dateLabel(last);
      const start=first.slice(0,4)===last.slice(0,4)?dateLabel(first).replace(/ \d{4}$/,''):dateLabel(first);
      return start+' – '+dateLabel(last);
    };
    function resetQuery(){clearTimeout(timer);timer=null;queryGeneration++;records=[];counts=null;nextCursor=null;hasMore=false;busy=false;loaded=false;error='';pageIndex=0;pages=[{cursor:null,start:0}];}
    function refreshTypes(){const current=type.value;type.replaceChildren();const names=server()?['Ferie','Friønske','Sygdom','Andet']:[...new Set(data.requests.map(item=>item.type))];for(const name of ['all',...names]){const option=node('option','',name==='all'?'Alle typer':name);option.value=name;type.append(option);}type.value=[...type.options].some(item=>item.value===current)?current:'all';}
    async function decision(id,next,reason){
      if(!data.canDecide||typeof onDecision!=='function')return {ok:false,message:'Anmodningen kan ikke behandles lige nu.'};
      const key=data.contextKey,mode=server(),refreshKey=data.refreshKey,token={id};deciding=token;
      try{
        const result=await onDecision(id,next,reason);
        if(result?.ok&&!destroyed&&mode&&server()&&data.contextKey===key&&data.refreshKey===refreshKey)await load('reset');
        return result;
      }catch{return {ok:false,message:'Beslutningen kunne ikke gemmes.'};}
      finally{if(deciding===token)deciding=null;}
    }
    function draw(){
      const active={q:search.value,status,type:type.value,from:from.value,to:to.value},invalid=active.from&&active.to&&active.from>active.to;
      feedback.textContent=invalid?'Fra-dato skal være før til-dato.':error;feedback.hidden=!feedback.textContent;
      const filtered=Boolean(active.q.trim()||active.type!=='all'||active.from||active.to),localRows=server()?null:filterLeave(data.requests,{...active,status:'all'});
      reset.hidden=!filtered;
      datesToggle.dataset.filtered=String(Boolean(active.from||active.to));
      typeWrap.dataset.filtered=String(active.type!=='all');
      for(const [key,el]of Object.entries(statusButtons)){
        const count=server()?counts?.[key]:localRows.filter(item=>key==='all'||item.status===key).length;
        el.textContent=STATUS[key]||'Alle';if(count!==undefined)el.append(node('span','cs-leave-status-count',' '+count));el.setAttribute('aria-pressed',String(status===key));
      }
      refresh.hidden=!server();refresh.disabled=busy;
      results.replaceChildren();results.setAttribute('aria-busy',String(busy));if(invalid)return;
      const rows=server()?records:localRows.filter(item=>status==='all'||item.status===status);if(!server())offset=Math.min(offset,Math.max(0,Math.floor((rows.length-1)/limit)*limit));
      const total=server()?counts?.[status]:rows.length;
      if(!rows.length){
        if(busy||!loaded&&server()&&!error){const loading=node('p','cs-review-empty','Henter fravær…');loading.setAttribute('role','status');results.append(loading);}
        else if(!error){const copy=filtered?'Ingen anmodninger matcher dine filtre.':({pending:'Ingen anmodninger afventer.',approved:'Ingen godkendte anmodninger.',rejected:'Ingen afviste anmodninger.',all:'Ingen fraværsanmodninger endnu.'})[status];results.append(node('p','cs-review-empty',copy));}
        return;
      }
      const table=node('table','cs-review-table'),thead=node('thead'),tr=node('tr');table.setAttribute('aria-label','Fraværsanmodninger');table.setAttribute('role','table');thead.setAttribute('role','rowgroup');tr.setAttribute('role','row');
      for(const copy of ['Medarbejder','Periode','Type','Status','']){const heading=node('th','',copy);heading.scope='col';heading.setAttribute('role','columnheader');if(!copy)heading.setAttribute('aria-label','Handling');tr.append(heading);}
      thead.append(tr);table.append(thead);const body=node('tbody');body.setAttribute('role','rowgroup');
      for(const request of server()?rows:rows.slice(offset,offset+limit)){
        const nameText=text(request.name)||text(data.people?.find(person=>person.id===request.p)?.name)||'Medarbejder',row=node('tr'),name=node('td','cs-leave-person-cell'),identity=node('div','cs-review-person'),avatar=node('span','cs-avatar',request.initials||nameText.split(/\s+/).slice(0,2).map(value=>value[0]).join(''));
        avatar.setAttribute('aria-hidden','true');identity.append(avatar,node('strong','',nameText));name.append(identity);
        const stateCell=node('td','cs-leave-status-cell'),badge=node('span','cs-review-badge',STATUS[request.status]||request.status);badge.dataset.state=request.status;stateCell.append(badge);
        const period=node('td','cs-review-period'),dates=periodLabel(request),days=request.days?.length||0;
        period.append(node('strong','',dates));if(days>1)period.append(node('span','cs-leave-duration',days+' dage'));
        const actions=node('td','cs-review-row-actions'),open=button('Se anmodning',()=>{
          if(destroyed)return;
          closeModal();const canDecide=Boolean(data.canDecide&&request.status==='pending'&&typeof onDecision==='function');
          modalRequest={id:request.id,status:request.status,version:request.version,canDecide};
          modal=leaveDetails({element,request:{...request,name:nameText,dates},canDecide,onDecision:decision,trigger:open,focusFallback:()=>statusButtons[status]||search,onClose:()=>{modal=null;modalRequest=null;}});
        },'cs-button cs-leave-open');
        if(icon){const arrow=node('span','cs-leave-open-arrow');arrow.append(icon('chevron-right'));open.append(arrow);}
        open.setAttribute('aria-label','Se anmodning for '+nameText);open.setAttribute('aria-haspopup','dialog');actions.append(open);
        row.setAttribute('role','row');const cells=[name,period,node('td','cs-leave-type-cell',request.type),stateCell,actions];for(const cell of cells)cell.setAttribute('role','cell');row.append(...cells);body.append(row);
      }
      table.append(body);const wrap=node('div','cs-review-table-wrap');wrap.append(table);results.append(wrap);
      if(server()&&(hasMore||pageIndex)){const pager=node('div','cs-review-pager'),prev=button('Forrige',()=>load('previous')),next=button('Næste',()=>load('next')),start=pages[pageIndex].start;prev.disabled=busy||pageIndex===0;next.disabled=busy||!hasMore;pager.append(prev,node('span','cs-review-muted',(start+1)+'–'+(start+rows.length)+(total===undefined?'':' af '+total)),next);results.append(pager);}
      else if(!server()&&rows.length>limit){const pager=node('div','cs-review-pager'),prev=button('Forrige',()=>{offset-=limit;draw();}),next=button('Næste',()=>{offset+=limit;draw();});prev.disabled=!offset;next.disabled=offset+limit>=rows.length;pager.append(prev,node('span','cs-review-muted',(offset+1)+'–'+Math.min(offset+limit,rows.length)+' af '+rows.length),next);results.append(pager);}
    }
    async function load(direction='reset',retry=true){
      if(destroyed||!server()||direction!=='reset'&&busy||direction==='next'&&(!hasMore||!nextCursor)||direction==='previous'&&!pageIndex)return;
      clearTimeout(timer);timer=null;const current=filters(),token=++queryGeneration;
      if(direction==='next'){pages=pages.slice(0,pageIndex+1);pages.push({cursor:nextCursor,start:pages[pageIndex].start+records.length});pageIndex++;}
      else if(direction==='previous')pageIndex--;
      else{pageIndex=0;pages=[{cursor:null,start:0}];counts=null;}
      records=[];hasMore=false;nextCursor=null;error='';loaded=true;
      if(current.from&&current.to&&current.from>current.to){busy=false;draw();return;}
      busy=true;draw();let result;try{result=await onQuery({...current,cursor:pages[pageIndex].cursor,limit});}catch{result={ok:false,message:'Fraværet kunne ikke indlæses. Prøv igen.'};}
      if(destroyed||token!==queryGeneration||!server())return;busy=false;
      if(!result?.ok&&result?.status===409&&pages[pageIndex].cursor&&retry)return load('reset',false);
      if(!result?.ok||!Array.isArray(result.requests)){error=result?.message||result?.error||'Fraværet kunne ikke indlæses. Prøv igen.';draw();return;}
      records=result.requests;counts=result.counts||null;hasMore=result.hasMore===true&&typeof result.nextCursor==='string'&&result.nextCursor.length>0;nextCursor=hasMore?result.nextCursor:null;
      checkModal(records);draw();
    }
    function changed(debounce=false){
      offset=0;error='';if(!server()){draw();return;}
      resetQuery();draw();if(debounce){timer=setTimeout(()=>load('reset'),180);return;}return load('reset');
    }
    for(const key of ['pending','approved','rejected','all']){const el=button('',()=>{status=key;return changed();},'cs-review-status');statusButtons[key]=el;tabs.append(el);}
    const datesPanel=node('div','cs-review-extra-filters'),datesToggle=button('Periode',()=>{setPeriodOpen(datesPanel.hidden);if(!datesPanel.hidden)from.focus();},'cs-button cs-leave-period-toggle');
    const periodText=node('span','','Periode');datesToggle.replaceChildren(...(icon?[icon('calendar-range')]:[]),periodText);
    function setPeriodOpen(value){datesPanel.hidden=!value;datesToggle.setAttribute('aria-expanded',String(value));}
    function syncPeriod(){const value=from.value&&to.value?periodLabel({days:[from.value,to.value]}):from.value?'Fra '+dateLabel(from.value):to.value?'Til '+dateLabel(to.value):'Periode';periodText.textContent=value;datesToggle.setAttribute('aria-label','Filtrér fravær efter periode'+(value==='Periode'?'':': '+value));}
    setPeriodOpen(false);syncPeriod();
    const reset=button('Nulstil',()=>{search.value='';type.value='all';from.value=to.value='';syncPeriod();search.focus();return changed();},'cs-button cs-chrome-quiet');
    const refresh=button('Opdater',()=>load('reset'),'cs-button cs-chrome-quiet cs-leave-refresh');refresh.hidden=true;
    if(icon){refresh.replaceChildren(icon('refresh-cw'),node('span','cs-sr','Opdater'));refresh.title='Opdater';}
    datesPanel.append(field('Fra',from),field('Til',to),button('Luk periode',()=>{setPeriodOpen(false);datesToggle.focus();},'cs-button cs-chrome-quiet'));
    const filterRail=node('div','cs-filter-rail cs-review-filter-rail'),searchWrap=field('Medarbejder',search),typeWrap=field('Type',type);searchWrap.className+=' cs-leave-search';typeWrap.className+=' cs-leave-type';
    if(icon)searchWrap.append(icon('search'));
    filterRail.setAttribute('role','group');filterRail.setAttribute('aria-label','Filtrér fravær');filterRail.append(searchWrap,typeWrap);
    tools.className+=' cs-review-compact-tools';tools.append(filterRail,datesToggle,reset,refresh);
    for(const control of [from,to])control.addEventListener('change',syncPeriod);
    for(const control of [search,type,from,to])control.addEventListener(control===search?'input':'change',()=>changed(control===search));const navigation=node('div','cs-leave-navigation');navigation.append(tabs,tools);if(!actionsHost)navigation.append(createActions);page.append(navigation,datesPanel,feedback,results);element.replaceChildren(page);
    return {render(options){
      if(destroyed)return;const oldMode=server(),oldContext=data.contextKey,oldRefresh=data.refreshKey;data={...data,...options};
      createActions.hidden=!create||data.canCreate===false;if(actionsHost)actionsHost.hidden=createActions.hidden;
      const contextChanged=oldContext!==data.contextKey||oldMode!==server();if(contextChanged){closeModal();resetQuery();search.value=from.value=to.value='';type.value='all';status='pending';offset=0;setPeriodOpen(false);syncPeriod();}
      if(!server()||loaded&&!busy&&oldRefresh===data.refreshKey)checkModal(server()?records:data.requests);
      else if(modalRequest?.canDecide&&!data.canDecide)closeModal();
      refreshTypes();if(server()&&(!loaded||contextChanged||oldRefresh!==data.refreshKey))return load('reset');draw();
    },refresh(){return server()?load('reset'):draw();},destroy(){destroyed=true;resetQuery();closeModal();createActions.remove();if(actionsHost)actionsHost.hidden=true;page.remove();}};
  }
  function mountHistory({element,onQuery,onRestore,formatValue=(_key,value)=>JSON.stringify(value),onBackup}){
    const doc=element.ownerDocument,{node,button,field,input,select}=kit(doc),page=node('section','cs-activity-page cs-history-review'),form=node('form','cs-review-tools cs-history-filters'),from=input('date','Historik fra dato'),to=input('date','Historik til dato'),actor=select('Udført af',[['all','Alle brugere']]),person=select('Berørt medarbejder',[['all','Alle medarbejdere']]),area=select('Område',[['all','Alle områder'],...Object.entries(AREAS)]),kind=select('Handlingstype',[['all','Alle handlinger'],...Object.entries(KINDS)]),search=input('search','Søg i historik'),feedback=node('p','cs-review-error'),notice=node('p','cs-review-muted cs-history-notice'),count=node('p','cs-review-muted cs-history-count'),list=node('div','cs-history-days'),more=button('Vis flere',()=>load(true)),refresh=button('Opdater',()=>load(false)),reset=button('Nulstil filtre',()=>{for(const control of [actor,person,area,kind])control.value='all';from.value=to.value=search.value='';load(false);},'cs-button cs-quiet');
    page.setAttribute('aria-label','Aktivitetshistorik');feedback.hidden=true;feedback.setAttribute('role','alert');count.setAttribute('role','status');search.placeholder='Søg i handlinger';search.maxLength=300;
    let data={people:[],canRestore:false},records=[],cursor=null,hasMore=false,busy=false,loaded=false,generation=0,destroyed=false,searchTimer=null;
    const expanded=new Set(),restoring=new Set();
    const filters=()=>Object.fromEntries(Object.entries({from:from.value,to:to.value,actorId:actor.value,personId:person.value,area:area.value,kind:kind.value,q:search.value.trim()}).filter(([,value])=>value&&value!=='all'));
    function actors(items){const value=actor.value;actor.replaceChildren();for(const item of [{userId:'all',name:'Alle brugere'},...items]){const option=node('option','',item.name);option.value=item.userId;actor.append(option);}if([...actor.options].some(option=>option.value===value))actor.value=value;}
    function changeDetails(change){
      const item=node('li','cs-history-change');
      item.append(node('strong','cs-history-change-type',CHANGE_LABELS[change.field]||change.field||'Ændring'));
      const values=node('dl','cs-history-values');
      for(const [key,label] of [['before','Før'],['after','Efter']]){
        if(!Object.hasOwn(change,key))continue;
        const part=node('div');part.append(node('dt','',label),node('dd','',formatValue(change.field,change[key])));values.append(part);
      }
      if(values.children.length)item.append(values);
      if(change.decision){
        const decision=node('div','cs-history-decision');
        if(change.decision.reason)decision.append(node('p','cs-review-reason',change.decision.reason));
        decision.append(node('p','cs-review-muted',(change.decision.decidedBy?.name||change.decision.decidedBy?.email||'Planlægger')+' · '+stamp(change.decision.decidedAt)));
        item.append(decision);
      }
      return item;
    }
    function historyEntry(entry,time,namesById){
      const item=node('li','cs-history-entry'),changes=Array.isArray(entry.changes)?entry.changes:[];
      const canRestore=entry.recoverable&&data.canRestore&&onRestore,hasDetails=Boolean(changes.length||entry.reason||canRestore);
      const row=node(hasDetails?'summary':'div','cs-history-row');
      const when=node('time','cs-history-time',Number.isFinite(time)?historyTime.format(time):'—');
      if(Number.isFinite(time)){when.dateTime=entry.at;when.setAttribute('aria-label',stamp(entry.at));}
      const action=node('span','cs-history-action'),affected=[...new Set((entry.personIds||[entry.personId]).map(id=>namesById.get(id)).filter(Boolean))];
      action.append(node('strong','',entry.summary||'Ændring gemt'));
      if(affected.length)action.append(node('span','cs-history-affected',affected.join(', ')));
      const who=node('span','cs-history-actor',entry.actor?.name||entry.actor?.email||'Planlægger'),type=node('span','cs-history-type',KINDS[entry.kind]||'Planændring');
      row.append(when,action,who,type);
      if(!hasDetails){item.append(row);return item;}
      const arrow=node('span','cs-history-arrow');arrow.setAttribute('aria-hidden','true');row.append(arrow);
      const details=node('details','cs-history-event'),body=node('div','cs-history-detail');
      details.open=expanded.has(entry.id);
      details.addEventListener('toggle',()=>{if(details.isConnected){if(details.open)expanded.add(entry.id);else expanded.delete(entry.id);}});
      if(changes.length){const list=node('ul','cs-history-changes');for(const change of changes)list.append(changeDetails(change));body.append(list);}
      if(entry.reason){const reason=node('div','cs-history-reason');reason.append(node('strong','','Begrundelse'),node('p','cs-review-reason',entry.reason));body.append(reason);}
      if(canRestore){
        const error=node('p','cs-review-error');error.hidden=true;error.setAttribute('role','alert');
        const restore=button('Fortryd ændring',async()=>{
          if(destroyed||restoring.has(entry.id)||!data.canRestore)return;
          const token=generation;
          restoring.add(entry.id);restore.disabled=true;error.hidden=true;
          let result;
          try{result=await onRestore(entry);}catch{result={ok:false,error:'Ændringen kunne ikke fortrydes. Kontrollér forbindelsen, og prøv igen.'};}
          restoring.delete(entry.id);
          if(destroyed||token!==generation)return;
          if(result?.ok){await load(false);return;}
          restore.disabled=false;
          if(restore.isConnected){error.textContent=result?.error||result?.message||'Ændringen kunne ikke fortrydes.';error.hidden=false;}
          else{feedback.textContent=result?.error||result?.message||'Ændringen kunne ikke fortrydes.';feedback.hidden=false;draw();}
        },'cs-button');
        restore.disabled=restoring.has(entry.id);body.append(restore,error);
      }
      details.append(row,body);item.append(details);return item;
    }
    function draw(){
      syncFilterState();
      list.replaceChildren();list.setAttribute('aria-busy',String(busy));count.textContent=busy?'Indlæser historik…':records.length+(records.length===1?' handling vist':' handlinger vist');more.hidden=!hasMore;more.disabled=busy;refresh.disabled=busy;
      if(!records.length){if(!busy&&!feedback.textContent)list.append(node('p','cs-review-empty','Ingen handlinger matcher dine filtre.'));return;}
      const columns=node('div','cs-history-row cs-history-columns');columns.setAttribute('aria-hidden','true');
      for(const label of ['Tid','Handling','Udført af','Type'])columns.append(node('span','',label));
      list.append(columns);
      const namesById=new Map(data.people.map(person=>[person.id,person.name]));
      let day=null,entries=null;
      for(const entry of records){
        const time=Date.parse(entry.at),label=Number.isFinite(time)?historyDay.format(time):'Ukendt dato';
        if(label!==day){
          day=label;
          const group=node('section','cs-history-day'),heading=node('h3','cs-history-date',label);
          entries=node('ol','cs-history-entries');entries.setAttribute('aria-label',label);group.append(heading,entries);list.append(group);
        }
        entries.append(historyEntry(entry,time,namesById));
      }
    }
    async function load(append=false){
      if(destroyed||append&&(!hasMore||busy||!cursor))return;
      clearTimeout(searchTimer);searchTimer=null;
      const token=++generation,currentFilters=filters();if(!append){records=[];cursor=null;hasMore=false;expanded.clear();}if(currentFilters.from&&currentFilters.to&&currentFilters.from>currentFilters.to){busy=false;loaded=true;feedback.textContent='Fra-dato skal være før til-dato.';feedback.hidden=false;draw();return;}
      busy=true;loaded=true;feedback.hidden=true;feedback.textContent='';draw();let result;try{result=await onQuery({filters:currentFilters,cursor:append?cursor:null,limit:50});}catch{result={ok:false,message:'Historikken kunne ikke indlæses.'};}
      if(destroyed||token!==generation)return;busy=false;
      if(!result?.ok){feedback.textContent=result?.message||'Historikken kunne ikke indlæses. Prøv igen.';feedback.hidden=false;draw();return;}
      const entries=Array.isArray(result.entries)?result.entries:[];records=append?[...new Map([...records,...entries].map(entry=>[entry.id,entry])).values()]:entries;cursor=result.nextCursor;hasMore=result.hasMore===true;if(result.actors)actors(result.actors);notice.textContent=result.legacyNotice||'';notice.hidden=!notice.textContent;draw();
    }
    const extra=node('div','cs-review-extra-filters cs-history-extra'),toggle=button('Filtre',()=>{extra.hidden=!extra.hidden;toggle.setAttribute('aria-expanded',String(!extra.hidden));if(!extra.hidden)from.focus();}),chips=node('div','cs-review-filter-chips');
    extra.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Flere historikfiltre');
    function syncFilterState(){
      const additional=[[from,'Fra '+dateLabel(from.value)],[to,'Til '+dateLabel(to.value)],[actor,[...actor.options].find(item=>item.value===actor.value)?.textContent||'Bruger'],[person,[...person.options].find(item=>item.value===person.value)?.textContent||'Medarbejder'],[kind,KINDS[kind.value]||'Handling']].filter(([control])=>control.value&&control.value!=='all');
      toggle.textContent='Filtre'+(additional.length?' · '+additional.length:'');reset.hidden=!additional.length&&area.value==='all'&&!search.value.trim();chips.replaceChildren();chips.hidden=!additional.length;
      for(const [control,label]of additional){const chip=button(label+' ×',()=>{control.value=control===from||control===to?'':'all';load(false);},'cs-review-filter-chip');chip.setAttribute('aria-label','Fjern filter: '+label);chips.append(chip);}
    }
    extra.append(field('Fra',from),field('Til',to),field('Udført af',actor),field('Medarbejder',person),field('Handling',kind),button('Luk filtre',()=>{extra.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}));
    const filterRail=node('div','cs-filter-rail cs-review-filter-rail');filterRail.setAttribute('role','group');filterRail.setAttribute('aria-label','Filtrér historik');filterRail.append(field('Søg',search),field('Område',area));
    for(const control of [toggle,refresh,reset])control.className+=' cs-chrome-quiet';
    form.className='cs-review-tools cs-history-filters cs-review-compact-tools';form.append(filterRail,toggle,refresh,reset);form.addEventListener('submit',event=>{event.preventDefault();load(false);});search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();load(false);}});for(const control of [from,to,actor,person,area,kind])control.addEventListener('change',()=>load(false));
    search.addEventListener('input',()=>{
      clearTimeout(searchTimer);generation++;cursor=null;hasMore=false;more.hidden=true;
      searchTimer=setTimeout(()=>load(false),220);
    });
    const archiveInfo=node('details','cs-history-archive-info');archiveInfo.append(node('summary','','Om historikken'),notice);
    page.append(form,extra,chips,feedback,count,list,more,archiveInfo);
    if(onBackup){const backup=node('details','cs-backup-export'),summary=node('summary','','Planbackup'),value=node('textarea');value.rows=6;value.readOnly=true;value.setAttribute('aria-label','Planbackup som JSON');backup.append(summary,node('p','','Backup indeholder medarbejder- og plandata. Opbevar den sikkert.'),value,button('Markér backup',()=>{value.focus();value.select();}));backup.addEventListener('toggle',()=>{if(backup.open)value.value=JSON.stringify(onBackup(),null,2);});page.append(backup);}
    element.replaceChildren(page);
    return {render(options){if(destroyed)return;data={...data,...options};const selected=person.value;person.replaceChildren();for(const item of [{id:'all',name:'Alle medarbejdere'},...data.people]){const option=node('option','',item.name);option.value=item.id;person.append(option);}person.value=[...person.options].some(option=>option.value===selected)?selected:'all';if(!loaded)load();else draw();},reload:()=>load(false),destroy(){destroyed=true;generation++;clearTimeout(searchTimer);page.remove();}};
  }
  const api={filterLeave,validDate,mountLeave,mountHistory,leaveDetails,rejection,requestAbsence};if(typeof module==='object'&&module.exports)module.exports=api;scope.CleanRoomsReview=api;
})(globalThis);
