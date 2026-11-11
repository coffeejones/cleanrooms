/* Shared, dated pay agreements. Draft policies are never written without an authoritative preview. */
(() => {
  'use strict';
  const root=globalThis,Payroll=root.CleanRoomsPayroll||(typeof require==='function'?require('./payroll-model.js'):null);
  const Money=root.CleanRoomsPayrollView||(typeof require==='function'?require('./payroll-view.js'):null);
  const clone=value=>JSON.parse(JSON.stringify(value)),days=['Man','Tir','Ons','Tor','Fre','Lør','Søn'];
  const empty=()=>({schema:1,groups:[],links:[]});
  let sequence=0;
  const id=kind=>kind+'-'+(root.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+(++sequence));
  const money=value=>Money?.formatMoney(value)||'—';
  const amountInput=value=>Number.isSafeInteger(value)?String(BigInt(value)/100n)+','+String(BigInt(value)%100n).padStart(2,'0'):'';
  const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Dato mangler';
  function today(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(key=>parts.find(item=>item.type===key).value).join('-');}
  function mount({element,onPreview,onSave,onReload,onOpenPerson,onHelp}={}){
    const Model=root.CleanRoomsPayrollGroups||(typeof require==='function'?require('./payroll-groups-model.js'):null),Members=root.CleanRoomsPayrollGroupMembers||(typeof require==='function'?require('./payroll-group-members.js'):null);
    if(!element?.ownerDocument||!Model||!Members||!Payroll||!Money)throw new TypeError('Løngrupper kræver et indholdsfelt og lønmodellerne.');
    const doc=element.ownerDocument,prefix='cs-paygroups-'+(++sequence)+'-';
    let options={},policy=empty(),version=0,tab='groups',selected=null,detail='members',referenceDate='',memberFilter='all',memberSearch='',groupSearch='',groupStatus='all',returnTab='groups',draft=null,receipt=null,pending=false,reloading=false,conflict=false,invalid=false,disposed=false,epoch=0,notice='',error='';
    let reviewTimer=null,reviewEpoch=0,reviewRequest=null,reviewBusy=false,reviewIssue='',reviewExpanded=false,unchangedExpanded=false,personalExpanded=false;
    let reviewArea=null,saveControl=null,reviewStatus=null;
    const memberView={page:0,size:25},assignmentView={search:'',filterGroup:'all',filterStatus:'all',page:0,size:25},reviewView={page:0,size:25},unchangedView={page:0,size:25};
    const summaryCache=new Map();
    const page=doc.createElement('div');page.className='cs-paygroups-page';
    const node=(tag,className,text)=>{const item=doc.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=String(text);return item;};
    const button=(label,action,key,className='cs-button')=>{const item=node('button',className,label);item.type='button';if(key){item.dataset.paygroupsFocus=key;item.dataset.productFocus='paygroups:'+key;}item.addEventListener('click',()=>{if(!disposed&&!item.disabled)return action(item);});return item;};
    const blocked=()=>pending||reloading||options.loading===true;
    const writable=()=>options.canView===true&&options.canManage===true&&!blocked()&&!conflict&&!invalid;
    const people=()=>Array.isArray(options.people)?options.people:[];
    const personName=personId=>people().find(person=>person.personId===personId)?.name||personId;
    const currentDate=()=>options.today||today();
    const groupRaw=groupId=>policy.groups.find(group=>group.id===groupId);
    const dialog=node('dialog','cs-paygroups-dialog'),dialogBody=node('div','cs-paygroups-dialog-body');
    dialog.setAttribute('aria-labelledby',prefix+'dialog-title');
    dialog.addEventListener('cancel',event=>{event.preventDefault();cancelDraft();});
    element.replaceChildren(page,dialog);
    const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
    const inspectDate=()=>validDate(referenceDate)?referenceDate:currentDate();
    const summaries=(date=currentDate())=>{if(!summaryCache.has(date)){if(summaryCache.size>8)summaryCache.clear();summaryCache.set(date,Members.build({policy,people:people(),date}));}return summaryCache.get(date);};
    const summaryFor=(groupId,date=inspectDate())=>summaries(date).groups.find(group=>group.id===groupId);
    const context=()=>selected?{groupId:selected,date:inspectDate(),detail,memberSearch,memberFilter,memberPage:memberView.page,memberPageSize:memberView.size}:null;
    function openGroup(groupId,view={}){if(disposed||options.canView!==true||options.loading||!groupRaw(groupId)||draft)return false;returnTab=tab;selected=groupId;detail=['members','setup','history'].includes(view.detail)?view.detail:'members';referenceDate=validDate(view.date)?view.date:currentDate();memberSearch=typeof view.memberSearch==='string'?view.memberSearch:'';memberFilter=['all','group','personal','missing'].includes(view.memberFilter)?view.memberFilter:'all';memberView.page=Number.isSafeInteger(view.memberPage)&&view.memberPage>=0?view.memberPage:0;memberView.size=[25,50,100].includes(view.memberPageSize)?view.memberPageSize:25;error='';notice='';paint('detail:title');return true;}
    function backToGroups(){if(blocked()||draft)return;const groupId=selected;selected=null;tab=returnTab;paint(tab==='groups'?'group:'+groupId:'tab:assignment');}
    function openPerson(personId){if(typeof onOpenPerson==='function')onOpenPerson(personId,context()||{});}

    const baseAt=(config,date)=>config?.agreements?.filter(item=>item.from<=date).at(-1)||null;
    const rateLabel=item=>item?money(item.amountCents)+(item.type==='monthly'?' / måned':' / time'):'Ingen gældende grundløn';
    const ruleLabel=item=>item.type==='monthly'?'Fast pr. måned':item.weekdays.map(day=>days[day]).join(', ')+' · '+(item.start?item.start+'–'+item.end+(item.end<item.start?' · over midnat':''):'Hele dagen');
    function field(key,label,type='text',value='',change,affectsDraft=true){const wrap=node('label','cs-paygroups-field'),control=node(type==='select'?'select':'input','cs-paygroups-input');control.id=prefix+key;control.dataset.paygroupsFocus='field:'+key;control.dataset.field=key;if(type!=='select')control.type=type;control.value=value;control.disabled=blocked();wrap.append(node('span','cs-paygroups-label',label),control);if(change)control.addEventListener(type==='select'||type==='date'||type==='time'?'change':'input',()=>{change(control.value);if(affectsDraft)invalidate();});return {wrap,control};}
    function selectField(key,label,value,choices,change,affectsDraft=true){const result=field(key,label,'select','',change,affectsDraft);for(const [choice,text,disabled] of choices){const option=node('option','',text);option.value=choice;option.disabled=Boolean(disabled);result.control.append(option);}result.control.value=value;return result;}
    function check(label,value,key,change){const wrap=node('label','cs-paygroups-check'),input=node('input');input.type='checkbox';input.checked=value;input.disabled=blocked();input.dataset.paygroupsFocus=key;input.addEventListener('change',()=>{change(input.checked);invalidate();});wrap.append(input,node('span','',label));return {wrap,input};}
    function section(title,caption){const surface=node('section','cs-paygroups-surface'),head=node('header','cs-paygroups-section-head'),copy=node('div');copy.append(node('h3','cs-paygroups-section-title',title));if(caption)copy.append(node('p','cs-paygroups-caption',caption));head.append(copy);surface.append(head);return {surface,head};}
    function resetReview(){
      clearTimeout(reviewTimer);
      reviewTimer=null;
      reviewEpoch++;
      reviewBusy=false;
      reviewIssue='';
      receipt=null;
    }
    function invalidate(){
      resetReview();
      notice='';
      if(!conflict)error='';
      queueReview();
      updateReview();
    }
    function beginDraft(value,focus){
      draft={...value,returnFocus:doc.activeElement?.dataset?.paygroupsFocus||null};
      reviewExpanded=Boolean(value.personId);
      unchangedExpanded=false;
      personalExpanded=false;
      invalidate();
      paint(focus);
    }
    function nextAvailableDate(group){
      let value=currentDate();const used=new Set(group?.revisions.map(revision=>revision.from)||[]);
      while(used.has(value)){const next=new Date(value+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);value=next.toISOString().slice(0,10);}
      return value;
    }
    function startGroup(group=null){
      if(!writable())return;if(!group)returnTab=tab;
      const from=nextAvailableDate(group),active=group?Model.groupFor(policy,group.id,from)?.revision:null,config=Payroll.normalize(active?.payroll),base=baseAt(config,from)||config.agreements[0];
      beginDraft({kind:'group',beforeVersion:version,basePolicy:clone(policy),groupId:group?.id||id('paygroup'),revisionId:id('revision'),name:group?.name||'',date:from,type:base?.type||'hourly',amount:base?amountInput(base.amountCents):'',baseId:id('group-rate'),payroll:config,supplements:clone(config.supplements),supplement:null},'field:group-name');
    }
    function startArchive(group){
      if(!writable())return;
      beginDraft({kind:'archive',beforeVersion:version,basePolicy:clone(policy),groupId:group.id,date:currentDate(),archived:!group.archived},'draft:cancel');
    }
    function startAssignment(groupId=null,personId=null){
      if(!writable()||draft)return false;
      const person=personId?people().find(item=>item.personId===personId):null;
      if(personId&&!person)return false;
      const firstRate=groupRaw(groupId)?.revisions[0]?.from;
      const date=firstRate&&firstRate>currentDate()?firstRate:currentDate();
      beginDraft({kind:'assignment',beforeVersion:version,basePolicy:clone(policy),date,groupId,originGroup:groupId,personId,baseMode:'existing',keepPersonal:true,selected:person?[personId]:[],search:'',filterGroup:groupId?'outside':'all',filterStatus:'all',page:0,size:25},person?'field:assignment-group':'field:assignment-search');
      return true;
    }
    function openAssignment(personId){return startAssignment(null,personId);}
    function cancelDraft(){
      if(blocked()||!draft)return;
      const focus=draft.returnFocus||(selected?'detail:title':tab==='groups'?'group:new':'assignment:start');
      draft=null;resetReview();error='';notice='';paint(focus);
    }
    function supplementEditor(item=null){if(!draft||draft.kind!=='group'||!writable())return;draft.supplement={id:item?.id||id('group-allowance'),name:item?.name||'',type:item?.type||'hourly',amount:item?amountInput(item.amountCents):'',from:item?.from||draft.date,to:item?.to||'',weekdays:clone(item?.weekdays||[0,1,2,3,4]),limited:Boolean(item?.start),start:item?.start||'',end:item?.end||''};invalidate();paint('field:allowance-name');}
    function storeSupplement(){if(!draft?.supplement||!writable())return;const item=draft.supplement,parsed=Money.parseCents(item.amount);if(!parsed.ok){error=parsed.error;paint('field:allowance-amount');return;}const value={id:item.id,name:item.name.trim(),type:item.type,amountCents:parsed.cents,from:item.from,to:item.to||null,weekdays:item.type==='monthly'?[]:[...item.weekdays].sort(),start:item.type==='monthly'||!item.limited?null:item.start,end:item.type==='monthly'||!item.limited?null:item.end};const candidate={currency:'DKK',agreements:[],supplements:[value]},problems=Payroll.validate(candidate);if(problems.length){error=problems[0];paint();return;}draft.supplements=draft.supplements.filter(existing=>existing.id!==value.id);draft.supplements.push(value);draft.supplement=null;invalidate();paint('allowance:add');}
    function candidate(){
      if(!draft)throw new Error('Opret en kladde først.');if(draft.beforeVersion!==version)throw new Error('Løngrupperne er ændret. Hent seneste oplysninger, før du fortsætter.');
      const next=clone(draft.basePolicy),date=draft.date;
      if(draft.kind==='group'){
        if(draft.supplement)throw new Error('Tilføj eller annullér tillægget for at gemme lønændringen.');
        const parsed=Money.parseCents(draft.amount);if(!parsed.ok)throw new Error(parsed.error);if(!draft.name.trim())throw new Error('Skriv et navn til løngruppen.');
        const existing=next.groups.find(group=>group.id===draft.groupId);if(date<currentDate())throw new Error('Tidligere perioder kan ikke ændres. Vælg i dag eller en kommende dato.');
        if(existing?.revisions.some(item=>item.from===date||item.id===draft.revisionId))throw new Error('Gemte lønperioder er skrivebeskyttede. Vælg en dato, der ikke allerede har en lønperiode.');
        const raw=clone(draft.payroll);raw.agreements=raw.agreements.filter(item=>item.from!==date&&item.id!==draft.baseId);raw.agreements.push({id:draft.baseId,from:date,type:draft.type,amountCents:parsed.cents});raw.supplements=clone(draft.supplements);const payroll=Payroll.normalize(raw),revision={id:draft.revisionId,from:date,payroll};
        if(existing){existing.name=draft.name.trim();existing.revisions.push(revision);}else next.groups.push({id:draft.groupId,name:draft.name.trim(),archived:false,revisions:[revision]});
      }else if(draft.kind==='archive'){
        const group=next.groups.find(item=>item.id===draft.groupId);if(!group)throw new Error('Løngruppen findes ikke længere.');group.archived=draft.archived;
      }else{
        if(!draft.selected.length)throw new Error('Vælg mindst én medarbejder.');
        if(draft.groupId===null)throw new Error('Vælg den nye løngruppe.');
        if(!validDate(date)||date<currentDate())throw new Error('Vælg i dag eller en kommende dato.');
        const group=next.groups.find(item=>item.id===draft.groupId);if(draft.groupId&&(!group||group.archived))throw new Error('Vælg en aktiv løngruppe.');
        const selectedIds=new Set(draft.selected),byPerson=new Map(people().map(person=>[person.personId,person]));
        const activeLinks=new Map();
        for(const link of next.links){
          if(!selectedIds.has(link.personId)||link.from>date)continue;
          if(!activeLinks.has(link.personId)||activeLinks.get(link.personId).from<link.from)activeLinks.set(link.personId,link);
        }
        next.links=next.links.filter(link=>!selectedIds.has(link.personId)||link.from!==date);
        for(const personId of selectedIds){
          const person=byPerson.get(personId);
          if(!person)throw new Error('En medarbejder findes ikke længere. Hent oplysningerne igen.');
          const previous=activeLinks.get(personId),sameGroup=previous?.groupId===(draft.groupId||null);
          const personal=Payroll.normalize(person.payroll),hasPersonal=Boolean(baseAt(personal,date));
          next.links.push({
            personId,from:date,groupId:draft.groupId||null,
            baseMode:!draft.groupId||draft.baseMode==='existing'&&hasPersonal?'personal':'group',
            excludedPersonalSupplementIds:draft.keepPersonal?clone(previous?.excludedPersonalSupplementIds||[]):personal.supplements.map(item=>item.id),
            supplementOverrides:sameGroup?clone(previous?.supplementOverrides||[]):[]
          });
        }
      }
      return {policy:Model.normalize(next),date};
    }
    function fail(result,fallback){
      resetReview();
      error=result?.error||result?.message||fallback;
      conflict=Boolean(result?.conflict||result?.status===409);
      if(result?.status===403||result?.status===401){
        options={canView:false,canManage:false};
        policy=empty();draft=null;epoch++;
      }
      paint();
    }
    function queueReview(){
      if(!writable()||!draft||typeof onPreview!=='function')return;
      const token=reviewEpoch;
      reviewTimer=setTimeout(()=>{reviewTimer=null;void preview(token);},320);
    }
    async function preview(token){
      const current=()=>!disposed&&token===reviewEpoch&&draft&&writable();
      // A changed draft can be edited while the server reads the previous one.
      // Only send the newest queued draft after that request has settled.
      if(reviewRequest)await reviewRequest.catch(()=>{});
      if(!current())return;
      let next;
      try{next=candidate();}
      catch(problem){reviewIssue=problem.message;updateReview();return;}
      const captured=draft;
      reviewBusy=true;
      error='';
      updateReview();
      const request=Promise.resolve().then(()=>onPreview({version:captured.beforeVersion,policy:clone(next.policy),date:next.date}));
      reviewRequest=request;
      try{
        const result=await request;
        if(!current())return;
        if(result?.ok===false){fail(result,'Ændringen kunne ikke kontrolleres.');return;}
        if(version!==captured.beforeVersion){fail({conflict:true},'Løngrupperne er ændret. Hent de seneste oplysninger.');return;}
        if(!Array.isArray(result?.preview?.rows)||typeof result.previewToken!=='string'||!result.previewToken){
          fail(null,'Kontrollen kunne ikke bekræftes. Prøv igen.');return;
        }
        reviewView.page=0;
        unchangedView.page=0;
        receipt={...next,preview:clone(result.preview),previewToken:result.previewToken,version:captured.beforeVersion};
      }catch(problem){
        if(current())fail(problem,'Ændringen kunne ikke kontrolleres.');
      }finally{
        if(reviewRequest===request)reviewRequest=null;
        if(token===reviewEpoch&&draft){reviewBusy=false;updateReview();}
      }
    }
    async function commit(){
      if(!writable()||!draft||!receipt||typeof onSave!=='function')return;
      const captured=receipt,token=++epoch;pending=true;error='';paint('commit');
      try{
        const result=await onSave({version:captured.version,policy:clone(captured.policy),date:captured.date,previewToken:captured.previewToken});
        if(disposed||token!==epoch)return;pending=false;
        if(result?.ok===false){fail(result,'Ændringen kunne ikke gemmes.');return;}
        const saved=Model.normalize(result?.policy),samePolicy=JSON.stringify(saved)===JSON.stringify(policy),sameDraft=JSON.stringify(saved)===JSON.stringify(captured.policy),noChange=result?.version===captured.version&&samePolicy&&sameDraft;
        if(!Number.isSafeInteger(result?.version)||(result.version!==captured.version+1&&!noChange)||result.version<version){fail({conflict:true},'Gemningen kunne ikke bekræftes. Hent de seneste oplysninger.');return;}
        if(result.version===version&&!samePolicy){fail({conflict:true},'Der er kommet en nyere ændring. Hent de seneste oplysninger.');return;}
        policy=saved;summaryCache.clear();version=result.version;options={...options,policy:clone(policy),version,people:result.people||options.people,history:result.history||options.history};
        const focus=draft.returnFocus;
        if(draft.kind==='group'){selected=draft.groupId;tab='groups';detail='setup';referenceDate=draft.date;}
        draft=null;resetReview();conflict=false;notice=noChange?'Ingen ændringer at gemme.':'Ændringen er gemt.';
        paint(selected?'detail:title':focus||'assignment:start');
      }catch(problem){if(disposed||token!==epoch)return;pending=false;fail(problem,'Ændringen kunne ikke gemmes.');}
    }
    async function reload(){if(blocked()||typeof onReload!=='function')return;const token=++epoch;draft=null;resetReview();reloading=true;error='';paint();try{await onReload();if(disposed||token!==epoch)return;reloading=false;conflict=false;notice='Oplysningerne er hentet igen.';paint();}catch(problem){if(disposed||token!==epoch)return;reloading=false;error=problem?.message||'Oplysningerne kunne ikke hentes.';paint();}}
    function renderAllowanceForm(parent){const item=draft.supplement;if(!item)return;const box=node('section','cs-paygroups-allowance-editor');box.append(node('h4','cs-paygroups-subtitle','Tillæg i kladden'));const name=field('allowance-name','Navn på tillæg','text',item.name,value=>item.name=value);name.control.maxLength=120;const type=selectField('allowance-type','Tillægstype',item.type,[['hourly','Pr. time'],['monthly','Fast pr. måned']],value=>{item.type=value;paint('field:allowance-type');}),amount=field('allowance-amount','Beløb i kroner','text',item.amount,value=>item.amount=value);amount.control.inputMode='decimal';const pair=node('div','cs-paygroups-field-pair');pair.append(type.wrap,amount.wrap);const from=field('allowance-from','Gælder fra','date',item.from,value=>item.from=value),to=field('allowance-to','Gælder til · valgfrit','date',item.to,value=>item.to=value),dates=node('div','cs-paygroups-field-pair');dates.append(from.wrap,to.wrap);box.append(name.wrap,pair,dates);
      if(item.type==='hourly'){const set=node('fieldset','cs-paygroups-weekdays-field');set.append(node('legend','cs-paygroups-label','Ugedage'));const row=node('div','cs-paygroups-weekdays');days.forEach((day,index)=>{const choice=check(day,item.weekdays.includes(index),'allowance:day:'+index,value=>{item.weekdays=item.weekdays.filter(key=>key!==index);if(value)item.weekdays.push(index);});choice.wrap.className='cs-paygroups-weekday';row.append(choice.wrap);});set.append(row);box.append(set);const limit=check('Begræns til et tidsrum',item.limited,'allowance:limit',value=>{item.limited=value;paint('allowance:limit');});box.append(limit.wrap);if(item.limited){const times=node('div','cs-paygroups-field-pair');times.append(field('allowance-start','Fra kl.','time',item.start,value=>item.start=value).wrap,field('allowance-end','Til kl.','time',item.end,value=>item.end=value).wrap);box.append(times,node('p','cs-paygroups-help','Tidsrummet kan gå over midnat, fx 22:00–06:00. Ugedagen er den dag, tidsrummet starter.'));}}
      else box.append(node('p','cs-paygroups-help','Et fast månedligt tillæg fordeles efter kalenderdage. Ugedage og klokkeslæt bruges ikke.'));
      const buttons=node('div','cs-paygroups-inline-actions'),cancel=button('Annuller tillæg',()=>{draft.supplement=null;invalidate();paint('allowance:add');},'allowance:cancel','cs-button cs-quiet'),add=button('Tilføj til kladde',storeSupplement,'allowance:store');cancel.disabled=add.disabled=blocked();buttons.append(cancel,add);box.append(buttons);parent.append(box);
    }
    function renderGroupDraft(){const body=node('div','cs-paygroups-form');const name=field('group-name','Løngruppens navn','text',draft.name,value=>draft.name=value);name.control.maxLength=120;const date=field('group-from','Gælder fra','date',draft.date,value=>draft.date=value);date.control.min=currentDate();const first=node('div','cs-paygroups-field-pair');first.append(name.wrap,date.wrap);const type=selectField('group-type','Grundløn',draft.type,[['hourly','Timeløn'],['monthly','Månedsløn']],value=>draft.type=value),amount=field('group-amount','Beløb i kroner','text',draft.amount,value=>draft.amount=value);amount.control.inputMode='decimal';const pair=node('div','cs-paygroups-field-pair');pair.append(type.wrap,amount.wrap);body.append(first,pair);
      const subhead=node('div','cs-paygroups-section-heading');subhead.append(node('h4','cs-paygroups-subtitle','Gruppens tillæg'));const add=button('Tilføj tillæg',()=>supplementEditor(),'allowance:add');add.disabled=blocked()||Boolean(draft.supplement);subhead.append(add);body.append(subhead,node('p','cs-paygroups-help','Flere matchende tillæg lægges sammen. Personlige tillæg håndteres særskilt.'));
      for(const item of draft.supplements){const row=node('div','cs-paygroups-rule'),copy=node('div');copy.append(node('strong','',item.name),node('span','',rateLabel(item)),node('span','',ruleLabel(item)),node('span','',dateLabel(item.from)+(item.to?' – '+dateLabel(item.to):' og frem')));const controls=node('div','cs-paygroups-inline-actions'),edit=button('Rediger',()=>supplementEditor(item),'allowance:'+item.id+':edit','cs-button cs-quiet'),remove=button('Fjern',()=>{draft.supplements=draft.supplements.filter(rule=>rule.id!==item.id);invalidate();paint('allowance:add');},'allowance:'+item.id+':remove','cs-button cs-quiet');edit.disabled=remove.disabled=blocked()||Boolean(draft.supplement);controls.append(edit,remove);row.append(copy,controls);body.append(row);}if(!draft.supplements.length)body.append(node('p','cs-paygroups-list-empty','Ingen gruppetillæg.'));renderAllowanceForm(body);return body;}
    function assignmentMembers(view,date=currentDate()){
      const query=view.search.trim().toLocaleLowerCase('da-DK');
      return summaries(validDate(date)?date:currentDate()).members.filter(member=>{
        if(query&&!member.name.toLocaleLowerCase('da-DK').includes(query)&&!(member.groupName||'').toLocaleLowerCase('da-DK').includes(query))return false;
        if(view.filterGroup==='outside'&&member.groupId===view.groupId)return false;
        if(view.filterGroup==='unassigned'&&member.groupId!==null)return false;
        if(!['all','outside','unassigned'].includes(view.filterGroup)&&member.groupId!==view.filterGroup)return false;
        return view.filterStatus==='all'||view.filterStatus==='unassigned'&&!member.groupId||view.filterStatus==='personal'&&Boolean(member.groupId)&&member.status==='personal'||!['personal','unassigned'].includes(view.filterStatus)&&member.status===view.filterStatus;
      });
    }
    function resultPage(view,matches){const count=Math.max(1,Math.ceil(matches.length/view.size));view.page=Math.max(0,Math.min(view.page,count-1));const start=view.page*view.size;return {count,start,rows:matches.slice(start,start+view.size)};}
    function assignmentFilters(view,key,date){
      const tools=node('div','cs-paygroups-assignment-tools cs-filter-rail');
      const search=field(key+'-search','Søg medarbejder','search',view.search,value=>{view.search=value;view.page=0;paint('field:'+key+'-search');},false);search.control.placeholder='Søg efter navn eller løngruppe';
      const groups=[['all','Alle løngrupper'],['unassigned','Ingen løngruppe'],...policy.groups.map(group=>[group.id,group.name])];
      if(view.groupId)groups.unshift(['outside','Uden for '+groupRaw(view.groupId)?.name]);
      const group=selectField(key+'-filter-group','Nuværende løngruppe',view.filterGroup,groups,value=>{view.filterGroup=value;view.page=0;paint('field:'+key+'-filter-group');},false);
      const status=selectField(key+'-filter-status','Aftale',view.filterStatus,[['all','Alle aftaler'],['group','Følger gruppen'],['personal','Personlige undtagelser'],['unassigned','Ingen løngruppe'],['missing','Grundløn mangler']],value=>{view.filterStatus=value;view.page=0;paint('field:'+key+'-filter-status');},false);tools.append(search.wrap,group.wrap,status.wrap);return tools;
    }
    function pagination(view,matches,key){
      const current=resultPage(view,matches),bar=node('nav','cs-paygroups-pagination');bar.setAttribute('aria-label',key==='assignment'?'Sider i medarbejdervalg':key==='members'?'Sider i løngruppens medlemmer':key==='review'?'Sider i konsekvensvisning':key==='review-unchanged'?'Sider i uændrede medarbejdere':'Sider i tildeling');
      const label=node('p','cs-paygroups-result-count',matches.length?(current.start+1)+'–'+Math.min(current.start+view.size,matches.length)+' af '+matches.length+' medarbejdere':'0 medarbejdere');label.setAttribute('role','status');bar.append(label);
      const size=selectField(key+'-page-size','Vis pr. side',String(view.size),[['25','25'],['50','50'],['100','100']],value=>{view.size=[25,50,100].includes(Number(value))?Number(value):25;view.page=0;paint('field:'+key+'-page-size');},false);bar.append(size.wrap);
      const controls=node('div','cs-paygroups-page-buttons'),first=button('Første',()=>{view.page=0;paint(key+':page:first');},key+':page:first','cs-button cs-quiet cs-chrome-quiet'),previous=button('Forrige',()=>{view.page--;paint(key+':page:previous');},key+':page:previous','cs-button cs-quiet cs-chrome-quiet'),next=button('Næste',()=>{view.page++;paint(key+':page:next');},key+':page:next','cs-button cs-quiet cs-chrome-quiet'),last=button('Sidste',()=>{view.page=current.count-1;paint(key+':page:last');},key+':page:last','cs-button cs-quiet cs-chrome-quiet');first.disabled=previous.disabled=blocked()||view.page===0;next.disabled=last.disabled=blocked()||view.page===current.count-1;controls.append(first,previous,node('span','cs-paygroups-page-label',(view.page+1)+' / '+current.count),next,last);bar.append(controls);return bar;
    }
    function renderAssignmentSelection(){
      const selection=node('section','cs-paygroups-assignment-step');
      selection.append(node('h4','cs-paygroups-subtitle','Medarbejdere'),assignmentFilters(draft,'assignment',draft.date));
      const matches=assignmentMembers(draft,draft.date),current=resultPage(draft,matches),chosen=new Set(draft.selected),visibleIds=current.rows.map(member=>member.personId),allVisible=visibleIds.length>0&&visibleIds.every(id=>chosen.has(id)),actionsRow=node('div','cs-paygroups-selection-tools');
      const choosePage=button(allVisible?'Fjern valget på denne side':'Vælg denne side ('+visibleIds.length+')',()=>{for(const id of visibleIds)allVisible?chosen.delete(id):chosen.add(id);draft.selected=[...chosen];invalidate();paint('assignment:select-page');},'assignment:select-page','cs-button cs-quiet');choosePage.disabled=blocked()||!visibleIds.length;actionsRow.append(choosePage);
      const chooseResult=button('Vælg alle '+matches.length+' i resultatet',()=>{draft.selected=[...new Set([...draft.selected,...matches.map(member=>member.personId)])];invalidate();paint('assignment:select-result');},'assignment:select-result','cs-button cs-quiet');chooseResult.disabled=blocked()||!matches.length||matches.every(member=>chosen.has(member.personId));if(matches.length>visibleIds.length)actionsRow.append(chooseResult);selection.append(actionsRow);
      const list=node('div','cs-paygroups-person-picker cs-paygroups-paged-picker');list.setAttribute('aria-label','Vælg medarbejdere');
      for(const member of current.rows){
        const row=check(member.name,chosen.has(member.personId),'assignment:person:'+member.personId,value=>{
          draft.selected=draft.selected.filter(id=>id!==member.personId);
          if(value)draft.selected.push(member.personId);
          paint('assignment:person:'+member.personId);
        });
        row.wrap.className='cs-paygroups-person-choice';row.wrap.dataset.personId=member.personId;
        row.wrap.append(node('small','',member.groupName||'Ingen løngruppe'));
        list.append(row.wrap);
      }
      if(!current.rows.length)list.append(node('p','cs-paygroups-list-empty','Ingen medarbejdere matcher de valgte filtre.'));
      selection.append(list,pagination(draft,matches,'assignment'));
      const resultIds=new Set(matches.map(member=>member.personId)),hidden=draft.selected.filter(id=>!resultIds.has(id)).length,summary=node('div','cs-paygroups-selection-summary');
      summary.append(node('strong','',draft.selected.length===1?'1 medarbejder valgt':draft.selected.length+' medarbejdere valgt'));
      if(hidden)summary.append(node('span','cs-paygroups-help',hidden+' valgte er uden for det aktuelle filter.'));
      if(draft.selected.length){
        const clear=button('Ryd valg',()=>{draft.selected=[];invalidate();paint('field:assignment-search');},'assignment:clear','cs-button cs-quiet');
        clear.disabled=blocked();summary.append(clear);
      }
      selection.append(summary);
      return selection;
    }
    function renderAssignment(review){
      const body=node('div','cs-paygroups-assignment-workflow'+(draft.personId?' cs-paygroups-single-assignment':''));
      const settings=node('section','cs-paygroups-assignment-step cs-paygroups-assignment-settings');
      if(draft.personId){
        const member=summaries(validDate(draft.date)?draft.date:currentDate()).members.find(item=>item.personId===draft.personId);
        const identity=node('div','cs-paygroups-transfer-person');
        identity.append(node('strong','',personName(draft.personId)),node('span','cs-paygroups-help',member?.groupName?'Nuværende løngruppe · '+member.groupName:'Ingen nuværende løngruppe'));
        settings.append(identity);
      }else{
        body.append(renderAssignmentSelection());
        settings.append(node('h4','cs-paygroups-subtitle','Ny lønaftale'));
      }
      const controls=node('div','cs-paygroups-assignment-fields');
      if(draft.originGroup){
        const destination=node('div','cs-paygroups-fixed-destination');
        destination.append(node('span','cs-paygroups-label','Løngruppe'),node('strong','',groupRaw(draft.originGroup)?.name||'Løngruppe'));
        controls.append(destination);
      }else{
        const choices=[[' ','Vælg løngruppe',true],...policy.groups.filter(group=>!group.archived).map(group=>[group.id,group.name]),['','Ingen løngruppe · personlig løn']];
        const group=selectField('assignment-group','Ny løngruppe',draft.groupId??' ',choices,value=>{
          draft.groupId=value===' '?null:value;
          draft.page=0;paint('field:assignment-group');
        });
        controls.append(group.wrap);
      }
      const from=field('assignment-from','Gælder fra','date',draft.date,value=>{draft.date=value;draft.page=0;if(validDate(value))paint('field:assignment-from');});
      from.control.min=currentDate();
      controls.append(from.wrap);
      settings.append(controls);
      const personal=node('details','cs-paygroups-personal-options');
      personal.open=personalExpanded;
      personal.append(node('summary','','Personlig grundløn og tillæg'));
      const base=selectField('assignment-base','Grundløn',draft.baseMode,[['existing','Bevar personlig grundløn, hvor den findes'],['group','Følg gruppens grundløn']],value=>draft.baseMode=value);
      base.control.disabled=blocked()||!draft.groupId;
      personal.append(base.wrap,check('Bevar personlige tillæg',draft.keepPersonal,'assignment:keep-personal',value=>draft.keepPersonal=value).wrap,
        node('p','cs-paygroups-help','Ved skift følger den gamle gruppes tillæg og undtagelser til dem ikke med. Tidligere aftaler bevares.'));
      personal.addEventListener('toggle',()=>{personalExpanded=personal.open;});
      settings.append(personal,review);
      body.append(settings);
      return body;
    }
    function renderPreview(){
      if(!receipt)return null;
      const {surface}=section('Ændringer fra '+dateLabel(receipt.date));surface.className+=' cs-paygroups-preview';
      const preview=receipt.preview,all=preview.rows||[],assignment=draft.kind==='assignment',targetIds=new Set(assignment?draft.selected:[]);
      const relevant=item=>item.changed||(assignment?targetIds.has(item.personId):draft.groupId&&(item.before?.groupId===draft.groupId||item.after?.groupId===draft.groupId));
      const shown=all.filter(item=>relevant(item)&&(item.changed||item.personalPreserved||item.missingBase));
      const shownIds=new Set(shown.map(item=>item.personId));
      const rest=all.filter(item=>!shownIds.has(item.personId)&&(!assignment||relevant(item))),affected=all.filter(item=>item.changed),preserved=all.filter(item=>relevant(item)&&item.personalPreserved),missing=all.filter(item=>relevant(item)&&item.missingBase);
      const summary=node('p','cs-paygroups-preview-summary');
      summary.append(node('strong','',affected.length===1?'1 medarbejder ændres':affected.length+' ændres'));
      if(preserved.length)summary.append(node('span','',preserved.length===1?'1 personlig grundløn bevares':preserved.length+' personlige grundlønninger bevares'));
      surface.append(summary);
      if(missing.length)surface.append(node('p','cs-paygroups-warning',missing.length+' af de berørte medarbejdere mangler et fuldt løngrundlag. Kontrollér de markerede rækker.'));
      const rows=node('div','cs-paygroups-preview-list');
      function personRow(item){
        const row=node('article','cs-paygroups-preview-person');row.dataset.changed=String(Boolean(item.changed));
        const heading=node('div','cs-paygroups-preview-heading');heading.append(node('strong','',item.name||personName(item.personId)),node('span','',item.changed?'Ændres':'Uændret'));row.append(heading);
        if(item.effectiveFrom&&item.effectiveFrom!==receipt.date)row.append(node('p','cs-paygroups-help','Første ændring '+dateLabel(item.effectiveFrom)));
        const columns=node('div','cs-paygroups-preview-columns');
        for(const [label,value] of [['Før',item.before],['Efter',item.after]]){
          const side=node('div');side.append(node('span','cs-paygroups-eyebrow',label),node('strong','',rateLabel(value?.base)),node('span','',value?.groupName||'Ingen løngruppe'),node('span','',value?.baseMode==='personal'?'Personlig grundløn':'Gruppens grundløn'));
          for(const rule of value?.supplements||[])side.append(node('span','',rule.name+' · '+rateLabel(rule)));
          if(value?.missingBase)side.append(node('span','cs-paygroups-issue','Grundløn mangler'));columns.append(side);
        }
        row.append(columns);if(item.personalPreserved)row.append(node('p','cs-paygroups-help','Personlig grundløn bevares.'));return row;
      }
      shown.sort((a,b)=>Number(b.changed)-Number(a.changed));
      for(const item of resultPage(reviewView,shown).rows)rows.append(personRow(item));
      if(!shown.length)rows.append(node('p','cs-paygroups-preview-empty','Ingen medarbejderaftaler påvirkes.'));
      let container=surface;
      if(shown.length&&!draft.personId){
        const details=node('details','cs-paygroups-changed');
        details.open=reviewExpanded;
        details.append(node('summary','','Se før og efter'));
        details.addEventListener('toggle',()=>{reviewExpanded=details.open;});
        surface.append(details);
        container=details;
      }
      container.append(rows);
      if(shown.length>25)container.append(pagination(reviewView,shown,'review'));
      if(rest.length&&!draft.personId){const unchanged=node('details','cs-paygroups-unchanged');unchanged.open=unchangedExpanded;unchanged.append(node('summary','',rest.length+' uændrede medarbejdere'));if(unchangedExpanded){for(const item of resultPage(unchangedView,rest).rows)unchanged.append(personRow(item));if(rest.length>25)unchanged.append(pagination(unchangedView,rest,'review-unchanged'));}unchanged.addEventListener('toggle',()=>{if(unchanged.open!==unchangedExpanded){unchangedExpanded=unchanged.open;paint();}});surface.append(unchanged);}
      return surface;
    }
    function errorBox(message){
      const box=node('section','cs-paygroups-error'),copy=node('p','',message);
      copy.setAttribute('role','alert');box.append(copy);
      if(conflict&&draft)box.append(node('p','cs-paygroups-help','Din kladde er bevaret. Når du henter oplysningerne igen, lukkes den.'));
      if((conflict||!draft)&&typeof onReload==='function'){
        const retry=button('Hent seneste oplysninger',reload,'reload');retry.disabled=blocked();box.append(retry);
      }else if(draft&&!conflict){
        const retry=button('Kontrollér igen',invalidate,'preview');retry.disabled=!writable();box.append(retry);
      }
      return box;
    }
    function updateReview(){
      if(!draft||!reviewArea||!reviewStatus||!saveControl)return;
      const preview=renderPreview();
      reviewArea.replaceChildren(...(preview?[preview]:[]));
      const affected=receipt?.preview.rows.filter(row=>row.changed).length;
      const message=receipt?(affected===1?'1 medarbejder påvirkes':affected?affected+' medarbejdere påvirkes':'Ingen medarbejderaftaler ændres')+' · fra '+dateLabel(receipt.date):reviewBusy?'Kontrollerer lønaftaler…':reviewIssue||'Afventer kontrol…';
      if(error)reviewStatus.replaceChildren(errorBox(error));
      else reviewStatus.textContent=message;
      saveControl.disabled=!writable()||!receipt||typeof onSave!=='function';
    }
    function renderDialog(focus){
      const scrollTop=dialogBody.scrollTop||0;
      const oldPicker=dialogBody.querySelectorAll('.cs-paygroups-person-picker')[0],pickerScroll=oldPicker?.scrollTop||0;
      const group=groupRaw(draft.groupId);
      reviewArea=node('div','cs-paygroups-dialog-review');
      let title,subtitle,fields,saveLabel='Gem ændring';
      if(draft.kind==='assignment'){
        const source=draft.personId&&Model.linkFor(policy,draft.personId,currentDate());
        title=draft.personId?(source?.groupId?'Skift løngruppe':'Tildel løngruppe'):draft.originGroup?'Tilføj medarbejdere':'Tildel løngruppe';
        fields=renderAssignment(reviewArea);
        saveLabel=draft.personId?(source?.groupId?'Gem gruppeskift':'Gem tildeling'):draft.originGroup?'Gem medarbejdere':'Gem tildeling';
      }else if(draft.kind==='group'){
        title=group?'Ny lønændring':'Opret løngruppe';
        subtitle=group?.name||'';
        fields=renderGroupDraft();
        if(!group)saveLabel='Opret løngruppe';
      }else{
        title=draft.archived?'Arkiver løngruppe':'Genaktiver løngruppe';
        subtitle=group?.name||'';
        fields=node('p','cs-paygroups-archive-copy',draft.archived?'Gruppen lukkes for nye tildelinger. Eksisterende aftaler og historik bevares.':'Gruppen kan igen vælges til nye tildelinger.');
        saveLabel=title;
      }
      const header=node('header','cs-paygroups-dialog-head'),heading=node('div'),label=node('h2','',title);
      label.id=prefix+'dialog-title';
      heading.append(label);
      if(subtitle)heading.append(node('p','cs-paygroups-caption',subtitle));
      const close=button('×',cancelDraft,'draft:close','cs-paygroups-dialog-close cs-button cs-quiet');
      close.setAttribute('aria-label','Luk dialog');close.disabled=blocked();
      header.append(heading,close);
      dialogBody.replaceChildren(fields,...(draft.kind==='assignment'?[]:[reviewArea]));
      const footer=node('footer','cs-paygroups-dialog-footer');
      reviewStatus=node('div','cs-paygroups-dialog-status');reviewStatus.setAttribute('role','status');
      const controls=node('div','cs-paygroups-inline-actions'),cancel=button('Annuller',cancelDraft,'draft:cancel','cs-button cs-quiet');
      cancel.disabled=blocked();
      saveControl=button(pending?'Gemmer…':saveLabel,commit,'commit','cs-button cs-primary');
      saveControl.id=prefix+'save';
      controls.append(cancel,saveControl);
      footer.append(reviewStatus,controls);
      dialog.className='cs-paygroups-dialog'+(draft.kind==='assignment'&&!draft.personId?' cs-paygroups-dialog-wide':'');
      dialog.replaceChildren(header,dialogBody,footer);
      updateReview();
      dialog.hidden=false;
      if(!dialog.open){
        if(typeof dialog.showModal==='function')dialog.showModal();
        else dialog.setAttribute('open','');
      }
      dialogBody.scrollTop=scrollTop;
      const picker=dialogBody.querySelectorAll('.cs-paygroups-person-picker')[0];
      if(picker&&!/assignment-(search|filter|page-size|from)|assignment:page:/.test(focus||''))picker.scrollTop=pickerScroll;
    }
    function closeDialog(){
      if(dialog.open&&typeof dialog.close==='function')dialog.close();
      else dialog.removeAttribute?.('open');
      dialog.hidden=true;
      dialog.replaceChildren();
      dialogBody.replaceChildren();
      dialogBody.scrollTop=0;
      reviewArea=null;reviewStatus=null;saveControl=null;
    }
    function statusBadge(state,label){const badge=node('span','cs-paygroups-member-status',label);badge.dataset.state=state;return badge;}
    function renderGroups(){
      const {surface,head}=section('Løngrupper'),all=summaries(),date=currentDate();
      surface.className+=' cs-paygroups-directory-surface';
      const groups=policy.groups.map(group=>{
        const revision=group.revisions.filter(item=>item.from<=date).at(-1);
        return {group,revision,status:group.archived?'archived':revision?'active':'future'};
      });
      const assigned=all.members.filter(member=>member.groupId).length,overview=node('div','cs-paygroups-directory-metrics');
      overview.setAttribute('aria-label','Overblik over løngrupper');
      for(const [value,label] of [[groups.filter(row=>row.status==='active').length,'Aktive grupper'],[assigned,'Med løngruppe'],[all.members.length-assigned,'Uden løngruppe']]){
        const item=node('div');item.append(node('strong','',value),node('span','',label));overview.append(item);
      }
      surface.append(overview);
      if(options.canManage===true){const create=button('Ny løngruppe',()=>startGroup(),'group:new','cs-button cs-primary');create.disabled=!writable();head.append(create);}
      const tools=node('div','cs-paygroups-directory-tools');
      const search=field('group-search','Søg løngruppe','search',groupSearch,value=>{groupSearch=value;paint('field:group-search');},false);
      search.control.placeholder='Søg efter navn';search.wrap.className+=' cs-filter-rail';
      const filter=selectField('group-status','Status',groupStatus,[['all','Alle'],['active','Aktive'],['future','Kommende'],['archived','Arkiverede']],value=>{groupStatus=value;paint('field:group-status');},false);
      tools.append(search.wrap,filter.wrap);surface.append(tools);
      const wrap=node('div','cs-paygroups-table-wrap'),table=node('table','cs-paygroups-table'),thead=node('thead'),tr=node('tr');
      for(const label of ['Løngruppe','Grundløn og tillæg','Medarbejdere',''])tr.append(node('th','',label));
      thead.append(tr);table.append(thead);
      const body=node('tbody'),query=groupSearch.trim().toLocaleLowerCase('da-DK');
      const statusOrder={active:0,future:1,archived:2},labels={active:'Aktiv',future:'Kommende',archived:'Arkiveret'};
      const matches=groups.filter(row=>(groupStatus==='all'||row.status===groupStatus)&&row.group.name.toLocaleLowerCase('da-DK').includes(query))
        .sort((a,b)=>statusOrder[a.status]-statusOrder[b.status]||a.group.name.localeCompare(b.group.name,'da-DK'));
      for(const {group,revision,status} of matches){
        const info=all.groups.find(item=>item.id===group.id),counts=info?.counts||{total:0,group:0,personal:0,missing:0},row=node('tr'),name=node('td');
        name.dataset.label='Løngruppe';
        const state=node('span','cs-paygroups-status',labels[status]);state.dataset.state=status;
        const meta=node('span','cs-paygroups-cell-detail');meta.append(state);
        if(status==='future')meta.append(node('span','','Fra '+dateLabel(group.revisions[0].from)));
        name.append(button(group.name,()=>openGroup(group.id),'group:'+group.id,'cs-paygroups-name'),meta);
        const rate=node('td','cs-paygroups-directory-rate');rate.dataset.label='Grundløn og tillæg';
        const shownDate=status==='future'?group.revisions[0].from:date,shownPayroll=(revision||group.revisions[0])?.payroll;
        const rules=(shownPayroll?.supplements||[]).filter(rule=>rule.from<=shownDate&&(!rule.to||rule.to>=shownDate));
        rate.append(node('strong','',rateLabel(info?.base||baseAt(shownPayroll,shownDate))),node('span','cs-paygroups-cell-detail',rules.length?rules.length+' fælles tillæg':'Ingen fælles tillæg'));
        const count=node('td','cs-paygroups-count-cell');count.dataset.label='Medarbejdere';
        count.append(node('strong','',counts.total+' '+(counts.total===1?'medarbejder':'medarbejdere')));
        const details=node('span','cs-paygroups-cell-detail');
        if(counts.group)details.append(node('span','',counts.group+' følger gruppen'));
        if(counts.personal)details.append(node('span','',counts.personal+' med personlige undtagelser'));
        if(counts.missing)details.append(node('span','cs-paygroups-issue',counts.missing+' mangler grundløn'));
        count.append(details);
        const action=node('td','cs-paygroups-directory-actions');
        if(options.canManage===true&&!group.archived){
          const assign=button('Tilføj medarbejdere',()=>startAssignment(group.id),'directory:'+group.id+':assign','cs-button cs-quiet');
          assign.setAttribute('aria-label','Tilføj medarbejdere til '+group.name);assign.disabled=!writable();action.append(assign);
        }
        action.append(button('Åbn',()=>openGroup(group.id),'group:'+group.id+':open','cs-button cs-quiet cs-chrome-quiet'));
        row.append(name,rate,count,action);body.append(row);
      }
      table.append(body);wrap.append(table);surface.append(wrap);
      if(!policy.groups.length)surface.append(node('p','cs-paygroups-empty','Der er endnu ingen løngrupper.'));
      else if(!matches.length)surface.append(node('p','cs-paygroups-preview-empty','Ingen løngrupper matcher søgningen eller status.'));
      return surface;
    }
    function renderDetailHeader(group,compact=false){
      const header=node('header','cs-paygroups-group-header'),crumb=node('nav','cs-paygroups-breadcrumb');crumb.setAttribute('aria-label','Tilbage til løngrupper');const back=button('Alle løngrupper',backToGroups,'detail:close','cs-paygroups-back cs-chrome-quiet');back.disabled=blocked()||Boolean(draft);crumb.append(back,node('span','',group.name));if(typeof onHelp==='function'){const help=button('?',trigger=>onHelp(trigger),'detail:help','cs-page-help-trigger');help.setAttribute('aria-label','Hjælp til denne side');help.setAttribute('aria-haspopup','dialog');crumb.append(help);}header.append(crumb);
      const main=node('div','cs-paygroups-group-heading'),copy=node('div'),title=node('h2','cs-paygroups-group-title',group.name);title.tabIndex=-1;title.dataset.paygroupsFocus='detail:title';copy.append(title,node('p','cs-paygroups-caption','Fælles lønaftale og medarbejdernes individuelle valg'));
      const ready=Boolean(Model.groupFor(policy,group.id,inspectDate())?.revision);main.append(copy,statusBadge(group.archived?'neutral':ready?'group':'neutral',group.archived?'Arkiveret':ready?'Aktiv løngruppe':'Kommende løngruppe'));header.append(main);
      if(!compact){const date=field('reference-date','Aftaler pr.','date',inspectDate(),value=>{if(validDate(value)){referenceDate=value;memberView.page=0;paint('field:reference-date');}});date.wrap.className+=' cs-paygroups-reference-date';header.append(date.wrap);}
      return header;
    }
    function renderSummary(group,info){
      const summary=node('section','cs-paygroups-group-summary');summary.setAttribute('aria-label','Løngruppens overblik');const base=node('div','cs-paygroups-summary-rate');base.append(node('span','cs-paygroups-eyebrow','Gruppens grundløn'),node('strong','',rateLabel(info?.base)),node('span','cs-paygroups-help','Gældende pr. '+dateLabel(inspectDate())));summary.append(base);
      for(const [kind,label,value] of [['total','Medlemmer',info.counts.total],['group','Følger gruppen',info.counts.group],['personal','Personlige undtagelser',info.counts.personal]]){const metric=node('div','cs-paygroups-summary-count');metric.dataset.state=kind;metric.append(node('span','cs-paygroups-eyebrow',label),node('strong','',value));summary.append(metric);}return summary;
    }
    function exceptionText(item){
      const groupRule=Number.isSafeInteger(item.groupAmountCents)?'Gruppen '+rateLabel({amountCents:item.groupAmountCents,type:item.groupType||item.type}):'Intet aktivt gruppetillæg';
      if(item.kind==='supplement-personal'&&!Number.isSafeInteger(item.amountCents))return item.label+' · '+groupRule;
      if(item.kind==='base')return 'Gruppens sats '+(Number.isSafeInteger(item.groupAmountCents)?rateLabel({amountCents:item.groupAmountCents,type:item.groupType||item.type}):'mangler')+' → '+rateLabel(item);
      if(item.kind==='supplement-off')return groupRule+' → Fravalgt';
      if(item.kind==='supplement-personal')return groupRule+' → '+rateLabel(item);
      return rateLabel(item)+' · personligt ekstra';
    }
    function renderMemberContent(group,info){
      const {surface,head}=section('Medlemmer');surface.className+=' cs-paygroups-members-surface';
      if(options.canManage===true){const assign=button('Tilføj medarbejdere',()=>startAssignment(group.id),'group:'+group.id+':assign','cs-button cs-primary');assign.disabled=!writable()||group.archived;head.append(assign);}
      const tools=node('div','cs-paygroups-members-tools'),search=field('member-search','Søg medarbejder','search',memberSearch,value=>{memberSearch=value;memberView.page=0;paint('field:member-search');});search.control.placeholder='Søg efter navn';search.wrap.className+=' cs-filter-rail';tools.append(search.wrap);
      const filters=node('div','cs-paygroups-member-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filtrér medlemmer');
      const choices=[['all','Alle',info.counts.total],['group','Følger gruppen',info.counts.group],['personal','Personlige undtagelser',info.counts.personal],...(info.counts.missing?[['missing','Mangler grundløn',info.counts.missing]]:[])];
      for(const [value,label,count] of choices){const choice=button(label+' · '+count,()=>{memberFilter=value;memberView.page=0;paint('members:filter:'+value);},'members:filter:'+value,'cs-paygroups-member-filter');choice.setAttribute('aria-pressed',String(memberFilter===value));filters.append(choice);}tools.append(filters);surface.append(tools);
      const query=memberSearch.trim().toLocaleLowerCase('da-DK'),members=info.members.filter(member=>(memberFilter==='all'||member.status===memberFilter)&&member.name.toLocaleLowerCase('da-DK').includes(query));
      const wrap=node('div','cs-paygroups-members-table-wrap'),table=node('table','cs-paygroups-members-table'),thead=node('thead'),titles=node('tr');for(const title of ['Medarbejder','Grundløn','Tillæg og personlige undtagelser','Aftale',''])titles.append(node('th','',title));thead.append(titles);table.append(thead);const body=node('tbody');
      for(const member of resultPage(memberView,members).rows){
        const row=node('tr');row.dataset.personId=member.personId;row.dataset.state=member.status;
        const identity=node('td','cs-paygroups-member-identity');identity.dataset.label='Medarbejder';identity.append(node('strong','',member.name),node('span','cs-paygroups-cell-detail','Tilknyttet fra '+dateLabel(member.activeFrom)));
        const base=node('td','cs-paygroups-member-base');base.dataset.label='Grundløn';base.append(node('strong','',member.base?.origin==='missing'?'Grundløn mangler':rateLabel(member.base)),node('span','cs-paygroups-cell-detail',member.base?.origin==='personal'?'Personlig grundløn':member.base?.origin==='group'?'Fra gruppen':'Kræver en lønaftale'));
        const adjustments=node('td','cs-paygroups-member-adjustments');adjustments.dataset.label='Tillæg og personlige undtagelser';
        if(!member.exceptions.length)adjustments.append(node('span','cs-paygroups-inherits',member.status==='missing'?'Ingen gældende grundløn. Kontrollér medarbejderens lønaftale.':'Følger gruppens grundløn og alle tillæg'));
        for(const item of member.exceptions){const line=node('div','cs-paygroups-exception');line.dataset.kind=item.kind;line.append(node('strong','',item.kind==='base'?'Personlig grundløn':item.name||item.label),node('span','',exceptionText(item)));adjustments.append(line);}
        if(member.upcoming)adjustments.append(node('p','cs-paygroups-upcoming','Kommende ændring '+dateLabel(member.upcoming.date)+(member.upcoming.groupId!==group.id?' · '+(member.upcoming.groupName||'Personlig lønaftale'):'')));
        const status=node('td');status.dataset.label='Aftale';status.append(statusBadge(member.status,member.label));
        const action=node('td','cs-paygroups-member-actions');if(options.canManage===true){const move=button('Skift løngruppe',()=>openAssignment(member.personId),'member:'+member.personId+':transfer','cs-button cs-quiet');move.disabled=!writable();action.append(move);}if(typeof onOpenPerson==='function')action.append(button('Åbn medarbejder',()=>openPerson(member.personId),'member:'+member.personId,'cs-button cs-quiet cs-chrome-quiet'));
        row.append(identity,base,adjustments,status,action);body.append(row);
      }
      table.append(body);wrap.append(table);surface.append(wrap,pagination(memberView,members,'members'));
      if(!members.length)surface.append(node('p','cs-paygroups-preview-empty',info.members.length?'Ingen medarbejdere matcher de valgte filtre.':'Ingen medarbejdere er tildelt gruppen på den valgte dato.'));
      if(info.counts.missing)surface.append(node('p','cs-paygroups-warning',info.counts.missing+' medarbejdere mangler en gældende grundløn. De tælles særskilt fra dem, der følger gruppen eller har personlige undtagelser.'));
      return surface;
    }
    function renderSetup(group,info){
      const active=Model.groupFor(policy,group.id,inspectDate()),{surface,head}=section('Satser og tillæg','Fælles aftale pr. '+dateLabel(inspectDate()));
      if(options.canManage===true){const actions=node('div','cs-paygroups-inline-actions'),edit=button('Tilføj lønændring',()=>startGroup(group),'group:'+group.id+':revision'),archive=button(group.archived?'Genaktiver gruppe':'Arkiver gruppe',()=>startArchive(group),'group:'+group.id+':archive','cs-button cs-quiet');edit.disabled=!writable()||group.archived;archive.disabled=!writable();actions.append(edit,archive);head.append(actions);}
      const body=node('div','cs-paygroups-detail-body'),base=node('div','cs-paygroups-setup-base');base.append(node('span','cs-paygroups-eyebrow','Grundløn'),node('strong','cs-paygroups-detail-rate',rateLabel(info.base)));if(active?.revision)base.append(node('p','cs-paygroups-help','Lønperiode fra '+dateLabel(active.revision.from)));body.append(base);
      const rules=(active?.revision?.payroll?.supplements||[]).filter(rule=>rule.from<=inspectDate()&&(!rule.to||rule.to>=inspectDate()));
      const list=node('div','cs-paygroups-setup-rules');for(const rule of rules){const row=node('article','cs-paygroups-setup-rule'),copy=node('div');copy.append(node('h4','',rule.name),node('p','cs-paygroups-help',ruleLabel(rule)),node('p','cs-paygroups-help','Fra '+dateLabel(rule.from)+(rule.to?' til '+dateLabel(rule.to):'')));row.append(copy,node('strong','',rateLabel(rule)));list.append(row);}if(!rules.length)list.append(node('p','cs-paygroups-help','Ingen fælles tillæg er gældende på den valgte dato.'));body.append(list);surface.append(body);return surface;
    }
    function renderHistory(group){
      const {surface,head}=section('Historik','Gemte lønperioder er skrivebeskyttede. Rettelser oprettes som en ny, dateret lønændring.'),body=node('div','cs-paygroups-detail-body');
      if(options.canManage===true){const create=button('Opret ny lønændring',()=>startGroup(group),'history:new-change','cs-button');create.disabled=!writable()||group.archived;head.append(create);}
      for(const revision of [...group.revisions].sort((a,b)=>b.from.localeCompare(a.from))){const row=node('div','cs-paygroups-history-row'),copy=node('div');copy.append(node('strong','',dateLabel(revision.from)),node('span','',rateLabel(baseAt(revision.payroll,revision.from))),node('span','',revision.payroll.supplements.length+' tillæg'));row.append(copy);row.append(node('span','cs-paygroups-history-locked',revision.from>currentDate()?'Kommende · skrivebeskyttet':revision.from===currentDate()?'Gældende fra i dag · skrivebeskyttet':'Gemt · skrivebeskyttet'));body.append(row);}
      const history=Array.isArray(options.history)?options.history:[];if(history.length){const log=node('details','cs-paygroups-audit');log.append(node('summary','','Gemte ændringer i lønopsætningen'));for(const entry of history){const row=node('p','cs-paygroups-help'),when=entry.createdAt||entry.updatedAt||entry.at;row.textContent=[when&&Number.isFinite(Date.parse(when))?new Date(when).toLocaleString('da-DK',{timeZone:'Europe/Copenhagen',dateStyle:'medium',timeStyle:'short'}):'',entry.actor?.name||entry.actorName||entry.name||'',entry.summary||entry.action||'Lønopsætning gemt'].filter(Boolean).join(' · ');log.append(row);}body.append(log);}surface.append(body);return surface;
    }
    function renderDetail(){
      const group=groupRaw(selected);if(!group)return null;const info=summaryFor(group.id),view=node('div','cs-paygroups-group-view');view.append(renderDetailHeader(group),renderSummary(group,info));
      const tabs=node('nav','cs-paygroups-detail-tabs');tabs.setAttribute('aria-label','Løngruppens indhold');for(const [value,label] of [['members','Medlemmer'],['setup','Satser og tillæg'],['history','Historik']]){const action=button(label,()=>{detail=value;paint('detail:'+value);},'detail:'+value,'cs-paygroups-detail-tab');action.setAttribute('aria-pressed',String(detail===value));tabs.append(action);}view.append(tabs);
      view.append(detail==='members'?renderMemberContent(group,info):detail==='setup'?renderSetup(group,info):renderHistory(group));return view;
    }
    function renderAssignmentsRead(){
      const {surface,head}=section('Medarbejdernes løngrupper');
      if(options.canManage===true){const assign=button('Tildel løngruppe',()=>startAssignment(),'assignment:start','cs-button cs-primary');assign.disabled=!writable();head.append(assign);}
      surface.append(assignmentFilters(assignmentView,'assignment-overview',currentDate()));
      const matches=assignmentMembers(assignmentView),current=resultPage(assignmentView,matches),list=node('div','cs-paygroups-assignment-list cs-paygroups-assignment-table-wrap'),table=node('table','cs-paygroups-assignment-table'),thead=node('thead'),titles=node('tr');for(const title of ['Medarbejder','Løngruppe','Grundløn','Aftale',''])titles.append(node('th','',title));thead.append(titles);table.append(thead);const body=node('tbody');
      for(const member of current.rows){
        const row=node('tr','cs-paygroups-assignment-row');row.dataset.personId=member.personId;const identity=node('td');identity.dataset.label='Medarbejder';identity.append(node('strong','',member.name));
        const group=node('td');group.dataset.label='Løngruppe';if(member.groupId)group.append(button(member.groupName,()=>openGroup(member.groupId),'assignment:group:'+member.personId,'cs-paygroups-group-link'));else group.append(node('span','cs-paygroups-help','Ingen løngruppe'));
        const base=node('td');base.dataset.label='Grundløn';base.append(node('strong','',member.base.origin==='missing'?'Grundløn mangler':rateLabel(member.base)),node('span','cs-paygroups-cell-detail',member.base.origin==='group'?'Fra gruppen':member.base.origin==='personal'?'Personlig grundløn':'Kræver en lønaftale'));
        const status=node('td');status.dataset.label='Aftale';status.append(statusBadge(member.status,member.status==='missing'?'Grundløn mangler':member.groupId?member.label:'Personlig lønaftale'));
        const action=node('td','cs-paygroups-member-actions');if(options.canManage===true){const move=button(member.groupId?'Skift løngruppe':'Tildel løngruppe',()=>openAssignment(member.personId),'assignment:transfer:'+member.personId,'cs-button cs-quiet');move.disabled=!writable();action.append(move);}if(typeof onOpenPerson==='function')action.append(button('Åbn medarbejder',()=>openPerson(member.personId),'assignment:open:'+member.personId,'cs-button cs-quiet cs-chrome-quiet'));row.append(identity,group,base,status,action);body.append(row);
      }
      table.append(body);list.append(table);surface.append(list);if(!matches.length)surface.append(node('p','cs-paygroups-preview-empty',people().length?'Ingen medarbejdere matcher de valgte filtre.':'Der er ingen medarbejdere at tildele.'));surface.append(pagination(assignmentView,matches,'assignment-overview'));return surface;
    }
    function paint(requestedFocus){
      if(disposed)return;
      const active=element.contains?.(doc.activeElement)?doc.activeElement:null,focus=requestedFocus||active?.dataset?.paygroupsFocus,selection=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
      function restoreFocus(container){
        if(!focus)return;
        const target=[...container.querySelectorAll('button,input,select,h2,h3')].find(item=>item.dataset.paygroupsFocus===focus);
        target?.focus({preventScroll:true});
        if(selection&&target?.setSelectionRange)try{target.setSelectionRange(...selection);}catch{}
      }
      if(draft&&options.canView===true&&options.canManage===true){
        renderDialog(focus);restoreFocus(dialog);return;
      }
      closeDialog();
      page.className='cs-paygroups-page'+(selected&&groupRaw(selected)?' cs-paygroups-detail-page':'');
      if(options.canView!==true){page.className='cs-paygroups-page';page.replaceChildren(node('p','cs-paygroups-help','Du har ikke adgang til løngrupper.'));return;}const parts=[],tabs=node('nav','cs-paygroups-tabs');tabs.setAttribute('aria-label','Løn og tillæg');for(const [value,label] of [['groups','Løngrupper'],['assignment','Medarbejdere']]){const action=button(label,()=>{tab=value;paint('tab:'+value);},'tab:'+value,'cs-paygroups-tab');action.setAttribute('aria-pressed',String(tab===value));action.disabled=blocked();tabs.append(action);}if(!selected)parts.push(tabs);
      if(options.loading||reloading){const loading=node('p','cs-paygroups-loading','Henter løngrupper…');loading.setAttribute('role','status');parts.push(loading);finish();return;}
      if(error||options.error){parts.push(errorBox(error||options.error));if(invalid||options.error&&options.policy==null){finish();return;}}
      if(notice){const message=node('p','cs-paygroups-success',notice);message.setAttribute('role','status');parts.push(message);}
      if(selected&&groupRaw(selected))parts.push(renderDetail());else if(tab==='groups')parts.push(renderGroups());else parts.push(renderAssignmentsRead());
      finish();
      function finish(){page.replaceChildren(...parts);restoreFocus(page);}
    }
    function render(next={}){
      if(disposed)return;
      summaryCache.clear();options={...options,...next};
      if(options.canView!==true){
        epoch++;policy=empty();version=0;draft=null;resetReview();pending=false;reloading=false;selected=null;notice='';error='';conflict=false;
        options={...options,policy:null,people:[],history:[]};paint();return;
      }
      try{policy=Model.normalize(options.policy);invalid=false;}
      catch{policy=empty();invalid=true;error='Løngrupperne kunne ikke læses sikkert. Hent oplysningerne igen.';}
      version=options.version??0;
      if(selected&&!groupRaw(selected)){selected=null;tab=returnTab;}
      if(options.canManage!==true){epoch++;draft=null;resetReview();pending=false;conflict=false;}
      else if(draft&&!pending&&draft.beforeVersion!==version){
        conflict=true;resetReview();error='Løngrupperne er ændret. Hent seneste oplysninger, før du gemmer.';
      }
      paint();
    }
    return Object.freeze({render,openGroup,openAssignment,context,destroy(){disposed=true;epoch++;options={};policy=empty();draft=null;resetReview();closeDialog();element.replaceChildren();}});
  }
  const api=Object.freeze({mount});root.CleanRoomsPayrollGroupsView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
