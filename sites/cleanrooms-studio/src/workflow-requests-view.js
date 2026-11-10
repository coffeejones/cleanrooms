/* Planner request queues describe the recipient, shift and next decision separately. */
(() => {
  'use strict';
  const READY=new Set(['pending','accepted']);
  const CLOSED={approved:'Godkendt',rejected:'Afvist',declined:'Afslået af kollega',cancelled:'Trukket tilbage',stale:'Vagten er ændret'};
  const list=value=>Array.isArray(value)?value:[];
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dateLabel=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',timeZone:'UTC'}):'Dato mangler';
  const clock=shift=>typeof shift?.start==='string'&&typeof shift?.end==='string'?shift.start+'–'+shift.end+(shift.end<shift.start?' +1 dag':''):'Tid mangler';
  const queueFor=request=>READY.has(request.status)?'ready':request.status==='awaiting_colleague'?'colleague':'closed';
  const beneficiary=request=>request.kind==='offer'?request.toName||'Medarbejder':request.fromName||'Medarbejder';
  const blocked=request=>Boolean(request.blockedReason||request.shiftCurrent===false||request.canApprove===false||list(request.conflicts).length);
  const statusLabel=request=>READY.has(request.status)?blocked(request)?'Kræver afklaring':'Klar til godkendelse':request.status==='awaiting_colleague'?'Afventer svar':CLOSED[request.status]||'Afsluttet';
  const plural=(count,one,many)=>count+' '+(count===1?one:many);
  function mount({element,onOpenRequest,onRefresh}={}){
    if(!element?.ownerDocument)throw new TypeError('Vagtanmodninger kræver et indholdsfelt.');
    const doc=element.ownerDocument,root=doc.createElement('section');root.className='cs-requests-directory';root.setAttribute('aria-label','Anmodningsoversigt');element.replaceChildren(root);
    let options={},queue='ready',query='',pageIndex=0,scope='',generation=0,pending=false,disposed=false,refreshError='';
    const node=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
    const busy=()=>pending||options.loading===true;
    const records=()=>list(options.bundle?.requests);
    const staleBundle=(next,current=options.bundle)=>{if(!next||!current)return false;const key=next.demo===true&&current.demo===true?'demoVersion':'revision';return Number.isSafeInteger(next[key])&&Number.isSafeInteger(current[key])&&next[key]<current[key];};
    const button=(label,handler,key,cls='cs-button cs-requests-button')=>{const el=node('button',cls,label),created=generation;el.type='button';el.disabled=busy();if(key)el.dataset.workflowFocus=key;el.addEventListener('click',()=>{if(!disposed&&created===generation&&!el.disabled)handler();});return el;};
    const currentScope=value=>[value.scopeKey||'',value.bundle?.demo===true?'demo':'live',value.bundle?.personId||'',value.bundle?.preview===true?'preview':'account'].join('|');
    function open(id){const current=records().find(request=>request.id===id);if(current&&typeof onOpenRequest==='function')onOpenRequest(current);}
    async function refresh(){
      if(busy()||typeof onRefresh!=='function')return;const started=generation;pending=true;refreshError='';paint('refresh');
      try{const result=await onRefresh();if(disposed||started!==generation)return;if(result?.ok===false)refreshError=result.message||'Anmodningerne kunne ikke opdateres.';else if(result?.bundle&&!staleBundle(result.bundle))options={...options,bundle:result.bundle};}
      catch(error){if(started===generation)refreshError=error?.message||'Anmodningerne kunne ikke opdateres.';}
      finally{if(!disposed&&started===generation){pending=false;paint('refresh');}}
    }
    function paint(focusKey){
      if(disposed)return;
      const active=doc.activeElement,focus=focusKey||(element.contains?.(active)?active?.dataset?.workflowFocus:null),caret=active?.dataset?.workflowFocus==='search'&&Number.isInteger(active.selectionStart)?[active.selectionStart,active.selectionEnd]:null;
      root.replaceChildren();root.setAttribute('aria-busy',String(busy()));
      const all=records(),counts={ready:0,colleague:0,closed:0,all:all.length};for(const request of all)counts[queueFor(request)]++;
      const controls=node('div','cs-requests-tools'),queues=node('div','cs-requests-queues');queues.setAttribute('role','group');queues.setAttribute('aria-label','Anmodningsstatus');
      for(const [key,label]of [['ready','Til godkendelse'],['colleague','Afventer kollega'],['closed','Afsluttede'],['all','Alle']]){
        const el=button('',()=>{queue=key;pageIndex=0;paint('queue:'+key);},'queue:'+key,'cs-requests-queue');el.setAttribute('aria-label',label+' · '+counts[key]);el.setAttribute('aria-pressed',String(queue===key));el.append(node('span','',label),node('span','cs-requests-count',counts[key]));queues.append(el);
      }
      controls.append(queues);
      const searchLabel=node('label','cs-requests-search'),search=node('input','cs-requests-input');search.type='search';search.value=query;search.placeholder='Søg medarbejder eller arbejdssted';search.disabled=busy();search.dataset.workflowFocus='search';search.setAttribute('aria-label','Søg i vagtanmodninger');search.addEventListener('input',()=>{query=search.value;pageIndex=0;paint('search');});searchLabel.append(node('span','cs-requests-sr','Søg i vagtanmodninger'),search);controls.append(searchLabel);
      if(typeof onRefresh==='function')controls.append(button('Opdater',refresh,'refresh','cs-button cs-requests-button cs-requests-refresh'));root.append(controls);
      const selected=all.filter(request=>queue==='all'||queueFor(request)===queue),term=query.trim().toLocaleLowerCase('da-DK'),items=selected.filter(request=>!term||[request.fromName,request.kind==='offer'?request.toName:'',dateLabel(request.shift?.date),clock(request.shift),request.shift?.siteName,request.kind==='claim'?'Ledig vagt':'Overdragelse',statusLabel(request)].join(' ').toLocaleLowerCase('da-DK').includes(term)).sort((a,b)=>String(a.shift?.date||'').localeCompare(String(b.shift?.date||''))||String(a.shift?.start||'').localeCompare(String(b.shift?.start||''))||beneficiary(a).localeCompare(beneficiary(b),'da-DK')||String(a.id).localeCompare(String(b.id)));
      let summary=queue==='ready'?plural(counts.ready,'anmodning venter','anmodninger venter')+' på din beslutning.':queue==='colleague'?plural(counts.colleague,'anmodning afventer','anmodninger afventer')+' en kollegas svar.':queue==='closed'?plural(counts.closed,'afsluttet anmodning','afsluttede anmodninger')+'.':plural(all.length,'anmodning','anmodninger')+' i alt.';
      if(queue==='ready'){const attention=selected.filter(blocked).length;if(attention)summary+=' '+attention+' kræver afklaring.';}
      const introduction=node('p','cs-requests-summary',query.trim()?items.length+' af '+selected.length+' matcher søgningen.':summary);introduction.setAttribute('aria-live','polite');root.append(introduction);
      if(refreshError||options.error){const error=node('p','cs-requests-error',refreshError||options.error);error.setAttribute('role','alert');root.append(error);}
      if(options.loading){root.append(node('p','cs-requests-empty','Henter anmodninger…'));restoreFocus(focus,caret);return;}
      if(!items.length){const empty=node('div','cs-requests-empty');empty.append(node('h3','',term?'Ingen anmodninger matcher søgningen':queue==='ready'?'Ingen anmodninger til godkendelse':queue==='colleague'?'Ingen anmodninger afventer en kollega':queue==='closed'?'Ingen afsluttede anmodninger':'Ingen vagtanmodninger endnu'));root.append(empty);restoreFocus(focus,caret);return;}
      const table=node('table','cs-requests-table');table.setAttribute('aria-label','Vagtanmodninger');table.setAttribute('role','table');const head=node('thead'),headRow=node('tr'),body=node('tbody');
      for(const label of ['Medarbejder','Vagt','Type','Status','']){const cell=node('th','',label);cell.scope='col';headRow.append(cell);}head.append(headRow);
      const size=20,pages=Math.max(1,Math.ceil(items.length/size));pageIndex=Math.min(pageIndex,pages-1);
      for(const request of items.slice(pageIndex*size,(pageIndex+1)*size)){
        const row=node('tr','cs-requests-row');row.dataset.requestId=String(request.id);row.dataset.queue=queueFor(request);row.dataset.blocked=String(blocked(request));
        const identity=node('td','cs-requests-person');identity.dataset.label='Medarbejder';identity.append(node('strong','',beneficiary(request)));if(request.kind==='offer')identity.append(node('span','cs-requests-secondary','Fra '+(request.fromName||'en kollega')));
        const shift=node('td','cs-requests-shift');shift.dataset.label='Vagt';shift.append(node('strong','',dateLabel(request.shift?.date)+' · '+clock(request.shift)),node('span','cs-requests-secondary',request.shift?.siteName||'Arbejdssted'));
        const type=node('td','cs-requests-type',request.kind==='claim'?'Ledig vagt':'Overdragelse');type.dataset.label='Type';
        const state=node('td','cs-requests-state');state.dataset.label='Status';const status=node('span','cs-requests-status',statusLabel(request));status.dataset.state=READY.has(request.status)?blocked(request)?'attention':'ready':request.status;const reason=request.blockedReason||list(request.conflicts).map(item=>typeof item==='string'?item:item.message||item.label||'').filter(Boolean).join(' ');if(reason)status.title=reason;state.append(status);
        const action=node('td','cs-requests-action'),inspect=button('Gennemgå',()=>open(request.id),'request:'+request.id);inspect.setAttribute('aria-label','Gennemgå anmodning for '+beneficiary(request)+' '+dateLabel(request.shift?.date));action.append(inspect);row.append(identity,shift,type,state,action);body.append(row);
      }
      table.append(head,body);root.append(table);
      const foot=node('nav','cs-requests-pagination');foot.setAttribute('aria-label','Sider med vagtanmodninger');foot.append(node('span','cs-requests-secondary',(pageIndex*size+1)+'–'+Math.min((pageIndex+1)*size,items.length)+' af '+items.length));
      if(pages>1){const prev=button('Forrige',()=>{pageIndex--;paint('page:prev');},'page:prev'),next=button('Næste',()=>{pageIndex++;paint('page:next');},'page:next');prev.disabled=busy()||pageIndex===0;next.disabled=busy()||pageIndex===pages-1;foot.append(prev,next);}root.append(foot);restoreFocus(focus,caret);
    }
    function restoreFocus(key,caret){if(!key)return;const target=[...root.querySelectorAll('[data-workflow-focus]')].find(el=>el.dataset.workflowFocus===key);target?.focus?.({preventScroll:true});if(caret&&typeof target?.setSelectionRange==='function')try{target.setSelectionRange(...caret);}catch{}}
    return {render(next={}){if(disposed)return;const merged={...options,...next},key=currentScope(merged),changed=scope&&scope!==key;if(changed){queue='ready';query='';pageIndex=0;pending=false;refreshError='';generation++;}else if(next.bundle&&staleBundle(next.bundle))merged.bundle=options.bundle;scope=key;options=merged;paint();},dispose(){if(disposed)return;disposed=true;generation++;element.replaceChildren();}};
  }
  const api=Object.freeze({mount,queueFor,beneficiary,statusLabel,dateLabel});globalThis.CleanRoomsWorkflowRequests=api;if(typeof module==='object'&&module.exports)module.exports=api;
})();
