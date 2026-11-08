/* Planner read status is organised by recipient, then by the messages they received. */
(() => {
  'use strict';
  const list=value=>Array.isArray(value)?value:[];
  const safeText=value=>typeof value==='string'?value.trim():'';
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const validStamp=value=>typeof value==='string'&&validDate(value.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
  const stamp=value=>validStamp(value)?new Date(value).toLocaleString('da-DK',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Copenhagen'}):'Ukendt tidspunkt';
  const date=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}):'Dato mangler';
  const clock=shift=>shift?.start&&shift?.end?shift.start+'–'+shift.end:'Tid mangler';
  const kindLabel=kind=>({new:'Ny vagt',changed:'Ændret vagt',moved:'Flyttet vagt',cancelled:'Aflyst vagt',request:'Svar på anmodning'})[kind]||'Vagtbesked';
  function changeSummary(message){
    const before=message.before,after=message.after,shift=after||before;
    if(!shift)return safeText(message.summary)||'Se beskeden for detaljer.';
    if(before&&after){
      if(before.date!==after.date)return date(before.date)+' '+clock(before)+' → '+date(after.date)+' '+clock(after);
      if(clock(before)!==clock(after))return date(after.date)+' · '+clock(before)+' → '+clock(after);
      if(before.site!==after.site)return date(after.date)+' · '+(before.siteName||'Tidligere arbejdssted')+' → '+(after.siteName||'Nyt arbejdssted');
    }
    return date(shift.date)+' · '+clock(shift)+(shift.siteName?' · '+shift.siteName:'');
  }
  const compareMessages=(a,b)=>(validStamp(b.createdAt)?Date.parse(b.createdAt):0)-(validStamp(a.createdAt)?Date.parse(a.createdAt):0)||String(b.id||'').localeCompare(String(a.id||''));
  function recipients(deliveries,people=[]){
    const unique=new Map(),names=new Map(list(people).map(person=>[person.id||person.personId,safeText(person.name)]));
    for(const [index,item]of list(deliveries).entries()){
      if(!item||typeof item!=='object')continue;
      const key=safeText(item.id)||'missing-message-'+index,previous=unique.get(key);
      // Read receipts are monotonic: a valid receipt wins over a stale unread copy.
      if(!previous||validStamp(item.readAt)&&(!validStamp(previous.readAt)||Date.parse(item.readAt)>Date.parse(previous.readAt)))unique.set(key,item);
    }
    const groups=new Map();
    for(const item of unique.values()){
      const id=safeText(item.personId)||'unknown-recipient';
      if(!groups.has(id))groups.set(id,{id,name:safeText(item.personName)||names.get(id)||'Medarbejder uden navn',messages:[],unread:0,read:0,total:0,lastSent:null});
      const group=groups.get(id);if(group.name==='Medarbejder uden navn'&&safeText(item.personName))group.name=safeText(item.personName);
      group.messages.push(item);group.total++;if(validStamp(item.readAt))group.read++;else group.unread++;
      if(validStamp(item.createdAt)&&(!group.lastSent||Date.parse(item.createdAt)>Date.parse(group.lastSent)))group.lastSent=item.createdAt;
    }
    return [...groups.values()].map(group=>({...group,messages:group.messages.slice().sort(compareMessages)})).sort((a,b)=>Number(b.unread>0)-Number(a.unread>0)||b.unread-a.unread||a.name.localeCompare(b.name,'da-DK')||a.id.localeCompare(b.id));
  }

  function mount({element,onOpenMessage,onRefresh}={}){
    if(!element?.ownerDocument)throw new TypeError('Læsestatus kræver et indholdsfelt.');
    const doc=element.ownerDocument,page=doc.createElement('section');page.className='cs-read-status';page.setAttribute('aria-label','Læsestatus pr. medarbejder');
    element.replaceChildren(page);
    let options={},scope='',filter='unread',query='',recipientPage=0,messagePage=0,messageFilter='unread',selectedPerson=null,disposed=false,refreshing=false,error='',epoch=0,returnFocus=null;
    const node=(tag,cls='',text)=>{const el=doc.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
    const busy=()=>refreshing||options.loading===true;
    const button=(text,action,key,cls='cs-read-button')=>{const el=node('button',cls,text);el.type='button';el.dataset.workflowFocus=key;el.disabled=busy();el.addEventListener('click',()=>{if(!disposed&&!el.disabled)action(el);});return el;};
    const bundle=()=>options.bundle||{};
    const groups=()=>recipients(bundle().deliveries,[...list(bundle().colleagues),...list(bundle().demoPeople)]);
    const version=value=>Number.isSafeInteger(value?.demoVersion)?value.demoVersion:Number.isSafeInteger(value?.revision)?value.revision:null;
    async function refresh(){
      if(busy()||typeof onRefresh!=='function')return;
      const started=epoch;refreshing=true;error='';paint();
      try{const result=await onRefresh();if(disposed||started!==epoch)return;if(result?.ok===false)error=result.message||'Læsestatus kunne ikke hentes.';else{const next=result?.bundle||(Array.isArray(result?.deliveries)?result:null);if(next&&(version(next)===null||version(bundle())===null||version(next)>=version(bundle())))options={...options,bundle:next};}}
      catch(problem){if(started===epoch)error=problem?.message||'Læsestatus kunne ikke hentes.';}
      finally{if(started===epoch){refreshing=false;if(!disposed)paint('readstatus:refresh');}}
    }
    function filterButtons(parent,definitions,current,prefix,onChange){
      const group=node('div','cs-read-filters');group.setAttribute('role','group');group.setAttribute('aria-label',prefix==='recipients'?'Filtrer modtagere':'Filtrer medarbejderens beskeder');
      for(const [key,text,count]of definitions){const control=button('',()=>onChange(key),prefix+':filter:'+key,'cs-read-filter');control.setAttribute('aria-pressed',String(current===key));control.append(node('span','',text));if(count!==undefined)control.append(node('span','cs-read-count',count));group.append(control);}parent.append(group);
    }
    function toolbar(parent,definitions,current,prefix,onChange,{search=false}={}){
      const bar=node('div','cs-read-tools');filterButtons(bar,definitions,current,prefix,onChange);
      if(search){const label=node('label','cs-read-search'),input=node('input','cs-read-input');input.type='search';input.value=query;input.placeholder='Søg medarbejder';input.setAttribute('aria-label','Søg i modtagere');input.dataset.workflowFocus='recipients:search';input.disabled=busy();input.addEventListener('input',()=>{query=input.value;recipientPage=0;paint('recipients:search');});label.append(input);bar.append(label);}
      if(typeof onRefresh==='function')bar.append(button('Opdater',refresh,'readstatus:refresh','cs-read-button cs-read-refresh'));parent.append(bar);
    }
    function makeTable(labels,name){const table=node('table','cs-read-table'),head=node('thead'),tr=node('tr'),body=node('tbody');table.setAttribute('aria-label',name);for(const label of labels){const th=node('th','',label);th.scope='col';tr.append(th);}head.append(tr);table.append(head,body);return {table,body};}
    function cell(label,cls=''){const el=node('td',cls);el.dataset.label=label;return el;}
    function empty(title,copy){const box=node('div','cs-read-empty');box.append(node('h4','',title));if(copy)box.append(node('p','cs-read-muted',copy));page.append(box);}
    function pagination(parent,total,current,prefix,change){
      const count=Math.max(1,Math.ceil(total/20)),pager=node('nav','cs-read-pagination');pager.setAttribute('aria-label',prefix==='recipients'?'Sider med modtagere':'Sider med beskeder');
      pager.append(node('span','cs-read-muted',total?current*20+1+'–'+Math.min(total,(current+1)*20)+' af '+total:'0 vist'));
      if(count>1){const prev=button('Forrige',()=>change(current-1),prefix+':page:prev'),next=button('Næste',()=>change(current+1),prefix+':page:next');prev.disabled=busy()||current===0;next.disabled=busy()||current===count-1;pager.append(prev,next);}parent.append(pager);
    }
    function paintRecipients(all){
      const unread=all.filter(group=>group.unread>0).length;
      const intro=node('div','cs-read-intro');intro.append(node('p','cs-read-overview',all.length+(all.length===1?' modtager':' modtagere')+' · '+unread+' mangler at læse'));page.append(intro);
      toolbar(page,[['unread','Mangler at læse',unread],['all','Alle',all.length],['read','Alt læst',all.length-unread]],filter,'recipients',value=>{filter=value;recipientPage=0;paint('recipients:filter:'+value);},{search:true});
      const term=query.trim().toLocaleLowerCase('da-DK'),items=all.filter(group=>(filter==='all'||filter==='unread'&&group.unread>0||filter==='read'&&group.unread===0)&&(!term||group.name.toLocaleLowerCase('da-DK').includes(term)));
      if(!items.length){empty(!all.length?'Ingen beskeder sendt endnu':filter==='unread'&&!term?'Alle beskeder er læst':'Ingen modtagere matcher',!all.length?'Når du udgiver ændringer, kan du følge modtagernes læsestatus her.':term?'Prøv en anden søgning.':'Vælg Alle for at se samtlige modtagere.');return;}
      recipientPage=Math.min(recipientPage,Math.max(0,Math.ceil(items.length/20)-1));
      const {table,body}=makeTable(['Medarbejder','Læsestatus','Senest sendt',''],'Modtagere og læsestatus');
      for(const group of items.slice(recipientPage*20,(recipientPage+1)*20)){
        const row=node('tr');row.dataset.personId=group.id;const person=cell('Medarbejder','cs-read-person');person.append(node('strong','',group.name));
        const status=cell('Læsestatus','cs-read-progress');status.dataset.unread=String(group.unread>0);status.append(node('strong','',group.unread?group.unread+(group.unread===1?' ulæst besked':' ulæste beskeder'):'Alt læst'),node('span','cs-read-muted',group.read+' af '+group.total+' læst'));
        const latest=cell('Senest sendt','cs-read-date');latest.append(node('span','',stamp(group.lastSent)));const action=cell('Handling','cs-read-action'),open=button('Vis beskeder',()=>{selectedPerson=group.id;messagePage=0;messageFilter=group.unread?'unread':'all';paint('recipients:back');},'recipient:'+group.id);open.setAttribute('aria-label','Vis beskeder til '+group.name);action.append(open);row.append(person,status,latest,action);body.append(row);
      }
      page.append(table);pagination(page,items.length,recipientPage,'recipients',value=>{recipientPage=value;paint('recipients:page:'+(value?'next':'prev'));});
    }
    function paintPerson(group){
      const back=button('Tilbage til modtagere',()=>{const id=selectedPerson;selectedPerson=null;paint('recipient:'+id);},'recipients:back','cs-read-back');page.append(back);
      const head=node('div','cs-read-person-head');head.append(node('h3','cs-read-title',group.name),node('p','cs-read-muted',group.unread+(group.unread===1?' ulæst besked':' ulæste beskeder')+' · '+group.read+' læst'));page.append(head);
      toolbar(page,[['unread','Ulæste',group.unread],['all','Alle',group.total]],messageFilter,'messages',value=>{messageFilter=value;messagePage=0;paint('messages:filter:'+value);});
      const items=group.messages.filter(item=>messageFilter==='all'||!validStamp(item.readAt));
      if(!items.length){empty('Ingen ulæste beskeder','Vælg Alle for at se medarbejderens læste beskeder.');return;}
      messagePage=Math.min(messagePage,Math.max(0,Math.ceil(items.length/20)-1));
      const {table,body}=makeTable(['Ændring','Sendt','Åbnet',''],'Beskeder til '+group.name);table.className+=' cs-read-message-table';
      for(const item of items.slice(messagePage*20,(messagePage+1)*20)){
        const row=node('tr');row.dataset.messageId=String(item.id);const change=cell('Ændring','cs-read-change');change.append(node('strong','',kindLabel(item.kind)),node('span','cs-read-message-summary',changeSummary(item)));
        const sent=cell('Sendt','cs-read-date');sent.append(node('span','',stamp(item.createdAt)));const opened=cell('Åbnet','cs-read-date');opened.append(node('span',validStamp(item.readAt)?'':'cs-read-not-open',validStamp(item.readAt)?stamp(item.readAt):'Ikke åbnet'));
        const action=cell('Handling','cs-read-action'),open=button('Se ændring',()=>{returnFocus='delivery:'+item.id;onOpenMessage?.(item);},'delivery:'+item.id);open.setAttribute('aria-label','Se '+kindLabel(item.kind).toLocaleLowerCase('da-DK')+' til '+group.name+' · '+changeSummary(item));action.append(open);row.append(change,sent,opened,action);body.append(row);
      }
      page.append(table);pagination(page,items.length,messagePage,'messages',value=>{messagePage=value;paint('messages:page:'+(value?'next':'prev'));});
    }
    function paint(focusKey){
      if(disposed)return;const active=doc.activeElement,focus=focusKey||returnFocus||(element.contains?.(active)?active?.dataset?.workflowFocus:null);returnFocus=null;page.replaceChildren();page.setAttribute('aria-busy',String(busy()));
      if(error||options.error){const notice=node('p','cs-read-error',error||options.error);notice.setAttribute('role','alert');page.append(notice);}
      if(options.loading){empty('Henter læsestatus…');return;}
      const all=groups(),group=all.find(item=>item.id===selectedPerson);if(selectedPerson&&!group){selectedPerson=null;messagePage=0;}if(group)paintPerson(group);else paintRecipients(all);
      if(focus){const target=[...page.querySelectorAll('[data-workflow-focus]')].find(el=>el.dataset.workflowFocus===focus);target?.focus?.({preventScroll:true});}
    }
    return {render(next={}){
      if(disposed)return;const merged={...options,...next},data=merged.bundle||{},nextScope=String(merged.scopeKey??'')+'|'+Boolean(data.demo)+'|'+(data.demo?data.serverNow||'':'');
      if(scope&&nextScope!==scope){epoch++;refreshing=false;filter='unread';query='';recipientPage=0;messagePage=0;messageFilter='unread';selectedPerson=null;returnFocus=null;error='';}
      if(nextScope===scope&&next.bundle&&version(next.bundle)!==null&&version(bundle())!==null&&version(next.bundle)<version(bundle()))merged.bundle=bundle();
      options=merged;scope=nextScope;paint();
    },dispose(){disposed=true;epoch++;element.replaceChildren();}};
  }
  const api=Object.freeze({mount,recipients,validStamp,stamp,changeSummary});globalThis.CleanRoomsWorkflowReadStatus=api;if(typeof module==='object'&&module.exports)module.exports=api;
})();
