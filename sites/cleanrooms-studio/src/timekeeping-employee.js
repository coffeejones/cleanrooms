/* Personal time records are rendered safely; writes remain server-authorized. */
(() => {
  'use strict';
  const drafts=new WeakMap();
  const statuses={running:'I gang',paused:'På pause',submitted:'Afventer godkendelse',approved:'Godkendt',rejected:'Afventer afklaring'};
  const flags={late_start:'Sen start',overtime:'Ekstra arbejdstid',long_break:'Længere pause',missing_end:'Mangler udstempling',corrected:'Rettet registrering',employee_comment:'Kommentar til planlæggeren',overlap:'Overlap i registreringer'};
  const operations={start:'Vagten blev startet',pause:'Pause startet',resume:'Pause afsluttet',finish:'Vagten blev afsluttet',correct:'Planlæggeren rettede registreringen',comment:'Kommentar tilføjet',submit:'Sendt til godkendelse',approve:'Timerne blev godkendt',reopen:'Godkendelsen blev genåbnet',reject:'Planlæggeren bad om en forklaring',demo:'Demo oprettet'};
  const text=value=>typeof value==='string'?value:'';
  const minutesLabel=value=>{if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return '—';const minutes=Math.max(0,Math.round(Number(value)));return Math.floor(minutes/60)+' t'+(minutes%60?' '+minutes%60+' min':'');};
  const entryFor=(entries,shift)=>(Array.isArray(entries)?entries:[]).find(entry=>entry&&String(entry.shiftId)===String(shift?.id)&&String(entry.personId)===String(shift?.person))||null;
  const statusLabel=entry=>statuses[entry?.status]||'Ikke startet';
  const dateTime=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('da-DK',{dateStyle:'medium',timeStyle:'short'}):'';};
  const actorName=value=>typeof value==='string'?value:value&&typeof value.name==='string'?value.name:'';
  const plannedFacts=shift=>{
    const clock=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
    const start=clock(shift.start),end=clock(shift.end),pause=shift.plannedBreakMinutes===undefined?0:shift.plannedBreakMinutes,gross=start!==null&&end!==null?end-start+(end<=start?1440:0):null;
    return {pause:Number.isSafeInteger(pause)&&pause>=0&&gross!==null&&pause<gross?pause:null,net:Number.isSafeInteger(pause)&&pause>=0&&gross!==null&&pause<gross?gross-pause:null};
  };

  function render(doc,options={}) {
    if(!doc?.createElement)throw new TypeError('Tidsregistrering kræver et dokument.');
    const shift=options.shift||{},given=options.entry;
    const entry=given&&String(given.shiftId)===String(shift.id)&&String(given.personId)===String(shift.person)?given:null;
    const demo=shift.demo===true,canDemo=demo&&options.canDemoEdit===true;
    const writable=options.enabled===true&&typeof options.onAction==='function'&&(demo?canDemo:options.preview!==true);
    const approved=entry?.status==='approved',inProgress=['running','paused'].includes(entry?.status),today=text(options.today),future=!!today&&text(shift.date)>today;
    const blocked=options.loading===true||options.busy===true;
    let states=drafts.get(doc);if(!states){states=new Map();drafts.set(doc,states);}
    const key=String(shift.person)+'|'+String(shift.id),version=Number.isSafeInteger(entry?.version)?entry.version:0;
    let state=states.get(key);
    if(!state||state.version!==version){state={version,editing:null,comment:'',pending:false,error:'',success:''};states.set(key,state);}
    const node=(tag,className,value)=>{const element=doc.createElement(tag);if(className)element.className=className;if(value!==undefined)element.textContent=String(value);return element;};
    const section=node('section','cs-time-employee');section.setAttribute('aria-label','Tidsregistrering');section.dataset.state=entry?.status||'planned';if(demo)section.dataset.demo='true';
    const header=node('div','cs-time-employee-head'),heading=node('h4','cs-time-employee-title','Tidsregistrering'),status=node('span','cs-time-employee-status',options.loading?'Henter registrering…':statusLabel(entry));status.dataset.state=entry?.status||'planned';header.append(heading,status);section.append(header);
    if(demo)section.append(node('p','cs-time-employee-demo','Stemplinger følger eksempelvagtens klokke.'));
    const planShift=approved?{start:entry.plannedStart||shift.start,end:entry.plannedEnd||shift.end,plannedBreakMinutes:entry.plannedBreakMinutes}:shift,plan=plannedFacts(planShift),values=node('dl','cs-time-employee-values');
    for(const [label,value] of [['Planlagt',text(planShift.start)+'–'+text(planShift.end)],['Planlagt arbejdstid',minutesLabel(plan.net)],['Planlagt pause',plan.pause===null?'—':plan.pause+' min · ulønnet'],['Registreret',entry?.start?entry.start+'–'+(entry.end||'…')+(entry.endDate&&entry.endDate>shift.date?' (+1 dag)':''):'—'],['Arbejdstid',entry?(inProgress?'Beregnes ved afslutning':minutesLabel(entry.workedMinutes)):'—'],['Registreret pause',entry?minutesLabel(entry.breakMinutes):'—']]){const metric=node('div');metric.append(node('dt','',label),node('dd','',value));values.append(metric);}section.append(values);
    if(plan.pause>0)section.append(node('p','cs-time-employee-help cs-time-employee-planned-pause','Den planlagte pause er ulønnet og fratrækkes kun de planlagte timer. Registrér den pause, du faktisk holder; den indsættes ikke automatisk.'));
    if(Number(entry?.breakMinutes)>0){
      const aggregate=entry.breakAllocation==='end-of-shift'||entry.breakAllocation==='end'||entry.pauseAllocation==='aggregate_end';
      section.append(node('p','cs-time-employee-help cs-time-employee-pause-basis',aggregate?'Pausen er angivet samlet og placeret ved vagtens slutning i beregningen af tillæg.':'Den stemplede pauses faktiske tidspunkt bruges i beregningen af tillæg.'));
    }
    const warningKeys=(Array.isArray(entry?.flags)?entry.flags:[]).filter(value=>Object.hasOwn(flags,value)&&!(inProgress&&value==='missing_end')&&!(value==='long_break'&&entry.breakMinutes===plan.pause));
    if(warningKeys.length){const list=node('ul','cs-time-employee-flags');list.setAttribute('aria-label','Bemærkninger til registreringen');for(const flag of [...new Set(warningKeys)]){const item=node('li','',flags[flag]);item.dataset.flag=flag;list.append(item);}section.append(list);}
    if(entry?.comment){const note=node('div','cs-time-employee-comment');note.append(node('span','cs-time-employee-label','Din kommentar'),node('p','',entry.comment));section.append(note);}
    if(approved){const by=actorName(entry.approvedBy),at=dateTime(entry.approvedAt);section.append(node('p','cs-time-employee-lock','Timerne er godkendt'+(by?' af '+by:'')+(at?' · '+at:'')+'. Kontakt planlæggeren, hvis noget skal rettes.'));}
    else if(entry?.status==='rejected'){
      const latest=(Array.isArray(entry.audit)?entry.audit:[]).slice().reverse().find(item=>(item.operation||item.action)==='reject'&&text(item.reason).trim());
      const returned=node('div','cs-time-employee-returned');returned.append(node('strong','','Planlæggeren har brug for en forklaring'),node('p','',text(latest?.reason)||text(entry.correctionReason)||'Tilføj en kommentar med de oplysninger, planlæggeren mangler.'));section.append(returned);
    }
    else if(entry?.status==='submitted')section.append(node('p','cs-time-employee-help','Sendt til godkendelse. Kontakt planlæggeren via en kommentar, hvis stemplingen er forkert.'));
    else if(entry?.status==='paused')section.append(node('p','cs-time-employee-help','Pausen er i gang og bliver trukket fra arbejdstiden.'));
    else if(entry?.status==='running')section.append(node('p','cs-time-employee-help','Vagten er i gang. Afslut vagten, når arbejdet er færdigt.'));
    const feedback=node('p','cs-time-employee-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    const error=node('p','cs-time-employee-error');error.setAttribute('role','alert');
    const controls=[],actions=node('div','cs-time-employee-actions'),prefix='cs-time-employee-'+encodeURIComponent(String(shift.id))+'-';
    const setStatus=()=>{error.textContent=state.error||text(options.error);error.hidden=!error.textContent;feedback.textContent=state.pending==='start'?'Starter vagt…':state.pending?'Gemmer registrering…':state.success;feedback.hidden=!feedback.textContent;for(const control of controls)control.disabled=blocked||Boolean(state.pending)||!writable;};
    const button=(label,action,primary=false)=>{const element=node('button','cs-button'+(primary?' cs-primary':''),label);element.type='button';element.id=prefix+'action-'+controls.length;element.addEventListener('click',action);controls.push(element);return element;};
    const basePayload=operation=>({operation,shiftId:String(shift.id),personId:String(shift.person),version,...(entry?.id?{entryId:entry.id}:{}),...(demo?{demo:true}:{})});
    const perform=async(operation,extra={})=>{
      if(!writable||blocked||state.pending||approved)return;
      state.error='';state.success='';state.pending=operation;setStatus();
      try{const result=await options.onAction({...basePayload(operation),...extra});if(!result?.ok)state.error=result?.message||result?.error||'Registreringen kunne ikke gemmes. Prøv igen.';else{state.success='Registreringen er gemt.';state.editing=null;state.comment='';form.hidden=true;actions.hidden=false;}}
      catch{state.error='Registreringen kunne ikke gemmes. Prøv igen.';}
      finally{state.pending=false;state.refresh?.();}
    };
    const form=node('form','cs-time-employee-form');form.noValidate=true;form.hidden=!state.editing;
    const formTitle=node('h5','cs-time-employee-form-title'),comment=node('textarea');comment.id=prefix+'comment';comment.rows=4;comment.value=state.comment;comment.placeholder='Fx: Jeg glemte at stemple ind, men mødte kl. 08:00.';comment.addEventListener('input',()=>{state.comment=comment.value;});controls.push(comment);
    const commentField=node('label','cs-time-employee-field');commentField.append(node('span','cs-time-employee-label','Kommentar til planlæggeren'),comment);
    const formHelp=node('p','cs-time-employee-help','Skriv her, hvis stemplingen er forkert. Planlæggeren gennemgår kommentaren og retter eventuelt tiden.');
    const formActions=node('div','cs-time-employee-form-actions');let finishButton=null,commentButton=null;
    const closeForm=()=>{state.editing=null;state.error='';form.hidden=true;actions.hidden=false;setStatus();(finishButton||commentButton)?.focus();};
    const sendComment=()=>{
      if(state.editing==='comment'&&!comment.value.trim()){state.error='Skriv en kommentar til planlæggeren.';setStatus();comment.focus();return;}
      perform(state.editing==='finish'?'finish':'comment',{comment:comment.value});
    };
    const cancel=button('Annuller',closeForm),send=button('Stempl ud og afslut',sendComment,true);formActions.append(cancel,send);form.append(formTitle,commentField,formHelp,formActions);
    form.addEventListener('submit',event=>{event.preventDefault();sendComment();});
    const openForm=(kind,restore=false)=>{
      state.editing=kind;if(!restore)state.error='';formTitle.textContent=kind==='finish'?'Afslut vagt':'Tilføj kommentar';
      commentField.children[0].textContent='Kommentar til planlæggeren'+(kind==='finish'?' · valgfrit':'');comment.required=kind==='comment';
      send.textContent=kind==='finish'?'Stempl ud og afslut':'Send kommentar';form.hidden=false;actions.hidden=true;setStatus();if(!restore)comment.focus();
    };
    if(writable&&!approved){
      if(!entry){
        if(canDemo||!today||shift.date===today)actions.append(button('Start vagt',()=>perform('start'),true));
        else section.append(node('p','cs-time-employee-help',future?'Du kan starte vagten på dens dato.':'Kontakt planlæggeren, hvis en tidligere vagt mangler registrering.'));
      }else if(entry.status==='running'){
        finishButton=button('Afslut vagt',()=>openForm('finish'),true);actions.append(button('Start pause',()=>perform('pause')),finishButton);
      }else if(entry.status==='paused'){
        finishButton=button('Afslut vagt',()=>openForm('finish'));actions.append(button('Fortsæt vagt',()=>perform('resume'),true),finishButton);
      }else if(['submitted','rejected'].includes(entry.status)){
        commentButton=button('Tilføj kommentar',()=>openForm('comment'),entry.status==='rejected');actions.append(commentButton);
      }
    }else if(!approved&&!options.loading){section.append(node('p','cs-time-employee-preview',demo?'Demoregistreringerne kan prøves fra planlæggerens demouge.':'Forhåndsvisning · medarbejderen registrerer tid fra sin egen konto.'));}
    if(state.editing)openForm(state.editing,true);
    actions.hidden=Boolean(state.editing);section.append(actions,form,error,feedback);
    const audit=Array.isArray(entry?.audit)?entry.audit:[];
    if(audit.length){const details=node('details','cs-time-employee-audit'),summary=node('summary','','Registreringens historik'),list=node('ol');summary.id=prefix+'audit';for(const item of audit.slice(-20).reverse()){const row=node('li'),actor=actorName(item.actor||item.by),at=dateTime(item.at||item.createdAt);row.append(node('strong','',operations[item.operation||item.action]||text(item.summary)||'Registreringen blev opdateret'),node('span','',[at,actor].filter(Boolean).join(' · ')));if(item.reason)row.append(node('p','',item.reason));list.append(row);}details.append(summary,list);section.append(details);}
    state.refresh=()=>{if(section.isConnected)setStatus();};setStatus();return section;
  }
  const api=Object.freeze({render,entryFor,statusLabel,minutesLabel});globalThis.CleanRoomsTimekeepingEmployee=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
