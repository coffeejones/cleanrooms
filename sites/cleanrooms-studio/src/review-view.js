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
  function rejection({element,request,onDecision,trigger,onClose}){
    const doc=element.ownerDocument,{node,button,field}=kit(doc),previous=trigger||doc.activeElement,layer=node('dialog','cs-review-modal'),panel=node('section','cs-review-dialog');
    layer.setAttribute('aria-label','Afvis fraværsanmodning');layer.setAttribute('aria-modal','true');panel.tabIndex=-1;
    let busy=false,closed=false;const reason=node('textarea','cs-review-textarea');reason.rows=5;reason.required=true;reason.setAttribute('aria-label','Begrundelse for afvisning');reason.placeholder='Forklar kort, hvorfor anmodningen afvises.';
    const error=node('p','cs-review-error');error.setAttribute('role','alert');error.hidden=true;
    let observer=null;const close=(options={})=>{if(closed||busy&&options.force!==true)return;closed=true;observer?.disconnect();if(typeof layer.close==='function'&&layer.open)layer.close();layer.remove();if(options.restoreFocus!==false){const target=previous?.isConnected?previous:element.isConnected?element.querySelector?.('button,input,select,[tabindex]')||element:null;target?.focus?.({preventScroll:true});}onClose?.();};
    const cancel=button('Annuller',()=>close()),confirm=button('Afvis anmodning',async()=>{
      if(busy)return;const value=text(reason.value);if(!value){error.textContent='Skriv en begrundelse, som medarbejderen kan se.';error.hidden=false;reason.setAttribute('aria-invalid','true');reason.focus();return;}
      busy=true;cancel.disabled=confirm.disabled=reason.disabled=true;confirm.textContent='Gemmer…';error.hidden=true;panel.setAttribute('aria-busy','true');panel.focus();
      let result;try{result=await onDecision(request.id,'rejected',value);}catch{result={ok:false,error:'Afvisningen kunne ikke gemmes. Prøv igen.'};}
      if(closed)return;busy=false;cancel.disabled=confirm.disabled=reason.disabled=false;confirm.textContent='Afvis anmodning';panel.setAttribute('aria-busy','false');
      if(result?.ok)close();else{error.textContent=result?.error||result?.message||'Afvisningen kunne ikke gemmes.';error.hidden=false;}
    },'cs-button cs-primary');
    const actions=node('div','cs-review-dialog-actions');actions.append(cancel,confirm);
    panel.append(node('h3','', 'Afvis anmodning'),node('p','cs-review-muted',request.name+' · '+request.type+' · '+request.dates),field('Begrundelse · synlig for medarbejderen',reason),error,actions);layer.append(panel);const owner=element.closest?.('#cleanrooms-studio')||element;owner.append(layer);if(typeof layer.showModal==='function')layer.showModal();else layer.setAttribute('open','');const initialPage=owner.dataset?.page,initialRole=owner.dataset?.role,Observer=doc.defaultView?.MutationObserver;if(Observer){observer=new Observer(()=>{if(!element.isConnected||owner.dataset?.page!==initialPage||owner.dataset?.role!==initialRole)close({force:true,restoreFocus:false});});observer.observe(owner,{attributes:true,attributeFilter:['data-page','data-role'],childList:true,subtree:true});}
    layer.addEventListener('cancel',event=>{event.preventDefault();close();});reason.addEventListener('input',()=>reason.removeAttribute('aria-invalid'));layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const first=reason,last=confirm;if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}}});reason.focus();return {close,get closed(){return closed;}};
  }
  function requestAbsence({element,people=[],personId=null,today,onSubmit}){
    const doc=element.ownerDocument,{node,button,field,input,select}=kit(doc),previous=doc.activeElement,layer=node('dialog','cs-review-modal'),panel=node('form','cs-review-dialog'),person=select('Medarbejder',people.filter(p=>p.active!==false).map(p=>[p.id,p.name]),personId||people[0]?.id),type=select('Fraværstype',[['Ferie','Ferie'],['Friønske','Friønske'],['Sygdom','Sygdom'],['Andet','Andet']],'Ferie'),from=input('date','Fra dato'),to=input('date','Til dato'),comment=node('textarea','cs-review-textarea'),error=node('p','cs-review-error');
    let busy=false;from.value=to.value=today;from.required=to.required=true;comment.rows=4;comment.setAttribute('aria-label','Kommentar');comment.placeholder='Valgfri besked til planlæggeren';error.hidden=true;error.setAttribute('role','alert');layer.setAttribute('aria-label',personId?'Anmod om fravær':'Opret fraværsanmodning');
    const close=()=>{if(busy)return;layer.close?.();layer.remove();previous?.isConnected&&previous.focus?.();};
    const cancel=button('Annuller',close),submit=node('button','cs-button cs-primary','Send anmodning');submit.type='submit';
    const actions=node('div','cs-review-dialog-actions');actions.append(cancel,submit);panel.append(node('h3','',personId?'Anmod om fravær':'Opret fraværsanmodning'));
    if(!personId)panel.append(field('Medarbejder',person));panel.append(field('Type',type),field('Fra',from),field('Til',to),field('Kommentar · valgfri',comment),error,actions);layer.append(panel);element.append(layer);
    layer.addEventListener('cancel',event=>{event.preventDefault();close();});
    panel.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;if(!validDate(from.value)||!validDate(to.value)||to.value<from.value){error.textContent='Vælg en gyldig periode.';error.hidden=false;return;}busy=true;submit.disabled=cancel.disabled=true;submit.textContent='Gemmer…';error.hidden=true;let result;try{result=await onSubmit({personId:personId||person.value,from:from.value,to:to.value,type:type.value,comment:comment.value});}catch{result={ok:false,message:'Anmodningen kunne ikke gemmes.'};}busy=false;submit.disabled=cancel.disabled=false;submit.textContent='Send anmodning';if(result?.ok)close();else{error.textContent=result?.message||'Anmodningen kunne ikke gemmes.';error.hidden=false;}});
    if(layer.showModal)layer.showModal();else layer.setAttribute('open','');(personId?from:person).focus();return {close};
  }
  function mountLeave({element,onDecision,onCreate,onQuery}){
    const doc=element.ownerDocument,{node,button,field,input,select}=kit(doc),page=node('section','cs-leave-review-page'),tools=node('div','cs-review-tools'),search=input('search','Søg medarbejder'),type=select('Fraværstype',[['all','Alle typer']]),from=input('date','Fravær fra dato'),to=input('date','Fravær til dato'),tabs=node('div','cs-review-statuses'),results=node('div','cs-review-results'),feedback=node('p','cs-review-error');
    page.setAttribute('aria-label','Anmodninger og fravær');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Fraværsstatus');feedback.setAttribute('role','status');feedback.hidden=true;
    const createActions=node('div','cs-leave-create-actions');if(onCreate)createActions.append(button('Opret fravær',onCreate,'cs-button cs-primary'));else createActions.hidden=true;
    let data={requests:[],canDecide:false},status='pending',offset=0,modal=null,modalRequestId=null,destroyed=false,generation=0,queryGeneration=0,records=[],counts=null,nextCursor=null,hasMore=false,busy=false,loaded=false,error='',timer=null,pageIndex=0,pages=[{cursor:null,start:0}];
    const limit=40,statusButtons={},server=()=>typeof onQuery==='function'&&data.server!==false,filters=()=>Object.fromEntries(Object.entries({q:search.value.trim(),status,type:type.value,from:from.value,to:to.value}).filter(([,value])=>value&&value!=='all'));
    search.placeholder='Søg medarbejder';
    const closeModal=()=>{modal?.close({force:true,restoreFocus:false});modal=null;modalRequestId=null;};
    function resetQuery(){clearTimeout(timer);timer=null;queryGeneration++;records=[];counts=null;nextCursor=null;hasMore=false;busy=false;loaded=false;error='';pageIndex=0;pages=[{cursor:null,start:0}];}
    function refreshTypes(){const current=type.value;type.replaceChildren();const names=server()?['Ferie','Friønske','Sygdom','Andet']:[...new Set(data.requests.map(item=>item.type))];for(const name of ['all',...names]){const option=node('option','',name==='all'?'Alle typer':name);option.value=name;type.append(option);}type.value=[...type.options].some(item=>item.value===current)?current:'all';}
    async function decision(id,next,reason){
      const key=data.contextKey,mode=server();let result;try{result=await onDecision(id,next,reason);}catch{result={ok:false,message:'Beslutningen kunne ikke gemmes.'};}
      if(result?.ok&&!destroyed&&mode&&server()&&data.contextKey===key)await load('reset');return result;
    }
    function draw(){
      const active={q:search.value,status,type:type.value,from:from.value,to:to.value},invalid=active.from&&active.to&&active.from>active.to;
      feedback.textContent=invalid?'Fra-dato skal være før til-dato.':error;feedback.hidden=!feedback.textContent;
      for(const [key,el]of Object.entries(statusButtons)){const count=server()?counts?.[key]:data.requests.filter(item=>key==='all'||item.status===key).length;el.textContent=(STATUS[key]||'Alle')+(count===undefined?'':' '+count);el.setAttribute('aria-pressed',String(status===key));}
      results.replaceChildren();results.setAttribute('aria-busy',String(busy));if(invalid)return;
      const rows=server()?records:filterLeave(data.requests,active);if(!server())offset=Math.min(offset,Math.max(0,Math.floor((rows.length-1)/limit)*limit));
      const total=server()?counts?.[status==='all'?'all':status]:rows.length,top=node('div','cs-review-result-head');top.append(node('h3','',STATUS[status]||'Alle anmodninger'),node('span','cs-review-muted',busy?'Henter anmodninger…':total===undefined?rows.length+' vist':total+' '+(total===1?'anmodning':'anmodninger')));
      refresh.hidden=!server();refresh.disabled=busy;results.append(top);
      if(!rows.length){if(!busy&&!error)results.append(node('p','cs-review-empty','Ingen anmodninger matcher dine filtre.'));return;}
      const table=node('table','cs-review-table'),thead=node('thead'),tr=node('tr');for(const copy of ['Medarbejder','Periode','Type','Status',''])tr.append(node('th','',copy));thead.append(tr);table.append(thead);const body=node('tbody');
      for(const request of server()?rows:rows.slice(offset,offset+limit)){
        const nameText=text(request.name)||text(data.people?.find(person=>person.id===request.p)?.name)||'Medarbejder',row=node('tr'),name=node('td'),identity=node('div','cs-review-person'),avatar=node('span','cs-avatar',request.initials||nameText.split(/\s+/).slice(0,2).map(value=>value[0]).join(''));identity.append(avatar,node('strong','',nameText));name.append(identity);
        const stateCell=node('td'),badge=node('span','cs-review-badge',STATUS[request.status]||request.status);badge.dataset.state=request.status;stateCell.append(badge);const actions=node('td','cs-review-row-actions');
        if(request.status==='pending'&&data.canDecide){let pending=false;const approve=button('Godkend',async()=>{if(pending||destroyed||!data.canDecide)return;const token=generation;pending=true;approve.disabled=reject.disabled=true;const result=await decision(request.id,'approved','');if(destroyed||token!==generation)return;if(!result?.ok){feedback.textContent=result?.error||result?.message||'Godkendelsen kunne ikke gemmes.';feedback.hidden=false;approve.disabled=reject.disabled=false;}pending=false;}),reject=button('Afvis',()=>{if(destroyed||!data.canDecide)return;closeModal();modalRequestId=request.id;modal=rejection({element,request:{...request,name:nameText},onDecision:decision,trigger:reject,onClose:()=>{modal=null;modalRequestId=null;}});});actions.append(approve,reject);}
        else if(request.decision){const details=node('details','cs-review-decision'),summary=node('summary','','Vis svar');details.append(summary);if(request.decision.reason)details.append(node('p','cs-review-reason',request.decision.reason));details.append(node('p','cs-review-muted',(request.decision.decidedBy?.name||'Planlægger')+' · '+stamp(request.decision.decidedAt)));actions.append(details);}
        row.append(name,node('td','cs-review-period',request.dates||request.days.map(dateLabel).join(' – ')),node('td','',request.type),stateCell,actions);body.append(row);
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
      if(modal&&(!data.canDecide||!records.some(item=>item.id===modalRequestId&&item.status==='pending')))closeModal();draw();
    }
    function changed(debounce=false){
      offset=0;error='';if(!server()){draw();return;}
      resetQuery();draw();if(debounce){timer=setTimeout(()=>load('reset'),180);return;}return load('reset');
    }
    for(const key of ['pending','approved','rejected','all']){const el=button('',()=>{status=key;return changed();},'cs-review-status');statusButtons[key]=el;tabs.append(el);}
    const datesPanel=node('div','cs-review-extra-filters'),datesToggle=button('Periode',()=>{datesPanel.hidden=!datesPanel.hidden;datesToggle.setAttribute('aria-expanded',String(!datesPanel.hidden));if(!datesPanel.hidden)from.focus();});datesPanel.hidden=true;datesToggle.setAttribute('aria-expanded','false');datesToggle.setAttribute('aria-label','Filtrér fravær efter periode');
    const reset=button('Nulstil',()=>{search.value='';type.value='all';from.value=to.value='';status='pending';datesToggle.textContent='Periode';return changed();},'cs-button cs-quiet');
    const refresh=button('Opdater',()=>load('reset'));refresh.hidden=true;
    datesPanel.append(field('Fra',from),field('Til',to),button('Luk periode',()=>{datesPanel.hidden=true;datesToggle.setAttribute('aria-expanded','false');datesToggle.focus();}));
    const filterRail=node('div','cs-filter-rail cs-review-filter-rail');filterRail.setAttribute('role','group');filterRail.setAttribute('aria-label','Filtrér fravær');filterRail.append(field('Medarbejder',search),field('Type',type));
    for(const control of [datesToggle,reset,refresh])control.className+=' cs-chrome-quiet';
    tools.className+=' cs-review-compact-tools';tools.append(filterRail,datesToggle,reset,refresh);
    for(const control of [from,to])control.addEventListener('change',()=>{datesToggle.textContent=from.value||to.value?[from.value?dateLabel(from.value):'Alle',to.value?dateLabel(to.value):'Frem'].join(' – '):'Periode';});
    for(const control of [search,type,from,to])control.addEventListener(control===search?'input':'change',()=>changed(control===search));const navigation=node('div','cs-leave-navigation');navigation.append(tabs,createActions);page.append(navigation,tools,datesPanel,feedback,results);element.replaceChildren(page);
    return {render(options){
      if(destroyed)return;const oldMode=server(),oldContext=data.contextKey,oldRefresh=data.refreshKey;generation++;data={...data,...options};
      const contextChanged=oldContext!==data.contextKey||oldMode!==server();if(contextChanged){closeModal();resetQuery();search.value=from.value=to.value='';type.value='all';status='pending';offset=0;}
      if(modal&&(!data.canDecide||!(server()?records:data.requests).some(item=>item.id===modalRequestId&&item.status==='pending')))closeModal();
      refreshTypes();if(server()&&(!loaded||contextChanged||oldRefresh!==data.refreshKey))return load('reset');draw();
    },refresh(){return server()?load('reset'):draw();},destroy(){destroyed=true;generation++;resetQuery();closeModal();page.remove();}};
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
  const api={filterLeave,validDate,mountLeave,mountHistory,rejection,requestAbsence};if(typeof module==='object'&&module.exports)module.exports=api;scope.CleanRoomsReview=api;
})(globalThis);
