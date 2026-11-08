/* Compact planner-only absence entry; the host performs all durable writes. */
(() => {
  'use strict';
  let sequence=0;
  function open({element,person,shift,sites=[],onSubmit,onReplace,onClose}={}) {
    if(!element?.ownerDocument||!person?.id||!shift?.date||typeof onSubmit!=='function')throw new TypeError('Vælg en medarbejder og en vagt.');
    const doc=element.ownerDocument,suffix='-sickness-'+ ++sequence,previous=doc.activeElement;
    let busy=false,saved=false,disposed=false,expanded=false,affected=[];
    const node=(tag,className,text)=>{const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
    const button=(label,action,className='cs-button')=>{const el=node('button',className,label);el.type='button';el.addEventListener('click',action);return el;};
    const layer=node('div','cs-sickness-layer'),backdrop=button('Luk sygemelding',()=>close(),'cs-backdrop');
    const dialog=node('section','cs-sickness-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','cs-sickness-title'+suffix);
    const head=node('header','cs-sickness-head'),title=node('h3','','Meld syg'),dismiss=button('×',()=>close(),'cs-icon-button cs-quiet');title.id='cs-sickness-title'+suffix;dismiss.setAttribute('aria-label','Luk sygemelding');head.append(title,dismiss);
    const body=node('div','cs-sickness-body'),identity=node('p','cs-sickness-person',person.name),form=node('div','cs-sickness-fields');
    const dates=node('div','cs-sickness-dates'),from=node('input'),to=node('input');from.type=to.type='date';from.value=to.value=shift.date;
    const field=(label,control)=>{const el=node('label','cs-field');el.append(node('span','cs-field-label',label),control);return el;};
    dates.append(field('Fra',from),field('Til',to));
    const help=node('p','cs-sickness-help','Registreres som fravær. Vagterne bevares, indtil du vælger en afløser.');
    const error=node('p','cs-sickness-error');error.hidden=true;error.setAttribute('role','alert');
    const result=node('div','cs-sickness-result');result.hidden=true;const summary=node('p','cs-sickness-summary'),list=node('div','cs-sickness-shifts');list.setAttribute('role','list');list.setAttribute('aria-label','Vagter der skal dækkes');
    const more=button('Vis flere vagter',()=>{expanded=true;paintAffected();},'cs-button cs-quiet');more.hidden=true;
    result.append(summary,list,more);
    form.append(dates,help);body.append(identity,form,result,error);
    const footer=node('footer','cs-sickness-footer'),cancel=button('Annuller',()=>close(),'cs-button cs-quiet'),save=button('Registrer sygemelding',submit,'cs-button cs-primary');footer.append(cancel,save);
    dialog.append(head,body,footer);layer.append(backdrop,dialog);element.append(layer);
    function addDays(value,count){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
    function updateDates(){to.min=from.value;if(from.value){to.max=addDays(from.value,30);if(to.value<from.value||to.value>to.max)to.value=from.value;}}
    from.addEventListener('change',()=>{updateDates();error.hidden=true;});to.addEventListener('change',()=>{error.hidden=true;});updateDates();
    function close(){if(disposed||busy)return;disposed=true;layer.remove();onClose?.();if(previous?.isConnected)previous.focus?.({preventScroll:true});}
    function setBusy(value){busy=value;[from,to,save,cancel,dismiss,backdrop].forEach(control=>control.disabled=value);save.textContent=value?'Registrerer…':'Registrer sygemelding';dialog.setAttribute('aria-busy',String(value));}
    function paintAffected(){
      list.replaceChildren();
      for(const item of expanded?affected:affected.slice(0,3)){
        const row=node('div','cs-sickness-shift');row.setAttribute('role','listitem');const copy=node('div'),day=new Date(item.date+'T12:00:00Z').toLocaleDateString('da-DK',{day:'numeric',month:'short'});
        copy.append(node('strong','',day+' · '+item.start+'–'+item.end),node('span','',sites[item.site]?.name||'Arbejdssted'));
        const replace=button('Find afløser',()=>{if(disposed)return;close();onReplace?.(item);});row.append(copy,replace);list.append(row);
      }
      more.hidden=expanded||affected.length<=3;more.textContent='Vis '+(affected.length-3)+' øvrige vagter';
    }
    async function submit(){
      if(busy||saved||disposed)return;
      if(!from.value||!to.value||to.value<from.value||to.value>addDays(from.value,30)||!from.validity.valid||!to.validity.valid){error.textContent='Vælg en gyldig periode på højst 31 dage.';error.hidden=false;return;}
      setBusy(true);error.hidden=true;
      try{
        const response=await onSubmit({personId:person.id,from:from.value,to:to.value});
        if(disposed)return;
        if(!response?.ok){error.textContent=response?.error||response?.message||'Sygemeldingen kunne ikke registreres.';error.hidden=false;return;}
        saved=true;affected=response.shifts||[];title.textContent='Sygemelding registreret';form.hidden=true;result.hidden=false;save.hidden=true;cancel.textContent='Luk';
        summary.textContent=response.shiftsUnavailable?'Vagterne kunne ikke hentes. Du kan finde dem i Vagtplan.':affected.length===0?'Ingen vagter i perioden.':affected.length===1?'1 vagt skal dækkes':affected.length+' vagter skal dækkes';
        paintAffected();cancel.focus({preventScroll:true});
      }catch{if(!disposed){error.textContent='Forbindelsen blev afbrudt. Kontrollér Fravær, før du prøver igen.';error.hidden=false;}}
      finally{if(!disposed){setBusy(false);if(saved){save.hidden=true;cancel.textContent='Luk';cancel.focus({preventScroll:true});}}}
    }
    layer.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
      if(event.key==='Tab'){
        const controls=[...dialog.querySelectorAll('button,input')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length),first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    dismiss.focus({preventScroll:true});
    return Object.freeze({close,destroy(){busy=false;close();},get isOpen(){return !disposed;}});
  }
  const api=Object.freeze({open});globalThis.CleanRoomsSickness=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
