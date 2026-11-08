/* Compact, read-only wage details. Salary policies remain on the server. */
(() => {
  'use strict';
  let sequence=0;
  const money=value=>Number.isSafeInteger(value)&&value>=0?(value/100).toLocaleString('da-DK',{minimumFractionDigits:2,maximumFractionDigits:2})+' kr.':'—';
  const hours=value=>Number.isFinite(value)&&value>=0?(value/60).toLocaleString('da-DK',{maximumFractionDigits:2})+' t':'—';
  const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short'}).format(new Date(value+'T12:00:00Z')):'';
  function mount({element,onClose,onRetry}={}){
    if(!element?.ownerDocument)throw new TypeError('Løndetaljer kræver et indholdsfelt.');
    const doc=element.ownerDocument,id='cs-planning-cost-'+ ++sequence;
    const node=(tag,cls,text)=>{const result=doc.createElement(tag);if(cls)result.className=cls;if(text!==undefined)result.textContent=String(text);return result;};
    const button=(label,action,cls='cs-button')=>{const result=node('button',cls,label);result.type='button';result.addEventListener('click',()=>{if(!disposed&&opened&&result.isConnected)action();});return result;};
    let disposed=false,opened=false,options={},trigger=null,scopeKey='',query='',page=0;
    const layer=node('div','cs-planning-cost-layer');layer.hidden=true;
    const backdrop=button('Luk løndetaljer',()=>close(),'cs-planning-cost-backdrop');backdrop.tabIndex=-1;backdrop.setAttribute('aria-hidden','true');
    const panel=node('section','cs-planning-cost-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby',id+'-title');panel.tabIndex=-1;
    const header=node('header','cs-planning-cost-header'),heading=node('div'),title=node('h3','cs-planning-cost-title','Vagtbaseret løn'),context=node('p','cs-planning-cost-context');
    title.id=id+'-title';heading.append(title,context);
    const dismiss=button('×',()=>close(),'cs-planning-cost-close');dismiss.setAttribute('aria-label','Luk løndetaljer');header.append(heading,dismiss);
    const body=node('div','cs-planning-cost-body'),footer=node('footer','cs-planning-cost-footer');
    panel.append(header,body,footer);layer.append(backdrop,panel);element.append(layer);

    function close({restoreFocus=true}={}){
      if(!opened)return;
      opened=false;layer.hidden=true;options={};body.replaceChildren();footer.replaceChildren();
      if(restoreFocus&&trigger?.isConnected)trigger.focus?.({preventScroll:true});
      trigger=null;onClose?.();
    }
    function identity(next){return [next.from||next.week?.from,next.to||next.week?.to,next.scopeLabel].join('|');}
    function paint(){
      if(disposed||!opened)return;
      const active=doc.activeElement,searching=active?.dataset?.planningCostFocus==='search',selection=searching?[active.selectionStart,active.selectionEnd]:null;
      const model=options.week,from=options.from||model?.from,to=options.to||model?.to;
      context.textContent=[options.scopeLabel,day(from)+(to?' – '+day(to):''),'Estimat før skat'].filter(Boolean).join(' · ');
      body.replaceChildren();footer.replaceChildren();
      panel.setAttribute('aria-busy',String(['loading','saving'].includes(options.state)));
      if(options.state!=='ready'||!model){
        const message=node('p','cs-planning-cost-state',options.state==='error'?(options.error||'Lønnen kunne ikke beregnes.') : options.state==='saving'?'Gemmer vagtændringer og opdaterer estimatet…':'Beregner vagtløn…');
        message.setAttribute('role',options.state==='error'?'alert':'status');body.append(message);
        if(options.state==='error'&&typeof onRetry==='function')body.append(button('Prøv igen',()=>onRetry({from,to}),'cs-button cs-planning-cost-retry'));
        return;
      }
      const rows=Array.isArray(model.people)?model.people:[],term=query.trim().toLocaleLowerCase('da-DK');
      const matching=rows.filter(person=>!term||String(person.name||'').toLocaleLowerCase('da-DK').includes(term));
      if(rows.length>12){
        const input=node('input','cs-planning-cost-search');input.type='search';input.placeholder='Søg medarbejder';input.value=query;input.dataset.planningCostFocus='search';input.setAttribute('aria-label','Søg i lønfordelingen');
        input.addEventListener('input',()=>{query=input.value;page=0;paint();});body.append(input);
      }
      const size=20,pages=Math.max(1,Math.ceil(matching.length/size));page=Math.min(page,pages-1);
      if(matching.length){
        const container=node('div','cs-planning-cost-table-scroll'),table=node('table','cs-planning-cost-table');table.setAttribute('aria-label','Løn fordelt på medarbejdere');
        const head=node('thead'),labels=node('tr'),data=node('tbody');
        for(const label of ['Medarbejder','Timer','Grundløn','Tillæg','I alt']){const cell=node('th','',label);cell.scope='col';labels.append(cell);}head.append(labels);
        for(const person of matching.slice(page*size,(page+1)*size)){
          const row=node('tr'),name=node('th','cs-planning-cost-person');name.scope='row';name.append(node('span','',person.name||'Medarbejder'));
          const annotations=[];
          if(person.missingShiftCount)annotations.push('Mangler lønsats');
          if(person.monthly)annotations.push('Fast løn ikke medregnet');
          if(person.fixedSupplement)annotations.push('Fast tillæg ikke medregnet');
          if(annotations.length)name.append(node('small','cs-planning-cost-person-note',annotations.join(' · ')));
          const unknown=person.totalCents===0&&person.shiftCount>0&&person.missingShiftCount===person.shiftCount&&!person.monthly;
          row.append(name,node('td','',hours(person.minutes)),node('td','',unknown||person.monthly&&!person.baseCents?'—':money(person.baseCents)),node('td','',money(person.supplementCents)),node('td','cs-planning-cost-person-total',unknown?'—':money(person.totalCents)));
          data.append(row);
        }
        table.append(head,data);container.append(table);body.append(container);
      }else body.append(node('p','cs-planning-cost-empty',rows.length?'Ingen medarbejdere matcher søgningen.':'Ingen prissatte medarbejdervagter i denne uge.'));
      if(pages>1){
        const navigation=node('div','cs-planning-cost-pagination'),previous=button('Forrige',()=>{page--;paint();}),next=button('Næste',()=>{page++;paint();});
        previous.disabled=page===0;next.disabled=page===pages-1;
        navigation.append(node('span','',(page*size+1)+'–'+Math.min((page+1)*size,matching.length)+' af '+matching.length),previous,next);body.append(navigation);
      }
      const warnings=[];
      if(model.missingShiftCount)warnings.push(model.missingShiftCount+' '+(model.missingShiftCount===1?'vagt mangler':'vagter mangler')+' lønsats.');
      if(model.openShiftCount)warnings.push(model.openShiftCount+' '+(model.openShiftCount===1?'ledig vagt er':'ledige vagter er')+' ikke prissat.');
      if(model.overlapShiftCount)warnings.push('Der er overlap mellem planlagte vagter.');
      if(model.monthlyPersonCount||model.fixedSupplementPersonCount)warnings.push('Fast månedsløn og faste månedlige tillæg er ikke medregnet.');
      if(warnings.length){const warning=node('p','cs-planning-cost-warning',warnings.join(' '));body.append(warning);}
      const allUnknown=model.totalCents===0&&model.shiftCount>0&&model.missingShiftCount+model.openShiftCount===model.shiftCount;
      const total=node('div','cs-planning-cost-total'),label=node('span','',allUnknown?'Lønsatser mangler':warnings.length||model.complete===false?'Beregnet del':'Estimeret i alt');total.append(label,node('strong','',allUnknown?'—':money(model.totalCents)));
      const detail=node('p','cs-planning-cost-total-detail',allUnknown?'Grundløn — · Tillæg —':'Grundløn '+money(model.baseCents)+' · Tillæg '+money(model.supplementCents));
      const note=node('p','cs-planning-cost-footnote','Ulønnede pauser er fratrukket og placeret sidst i vagten ved beregning af tillæg. Pension, feriepenge og arbejdsgiverudgifter indgår ikke.');
      footer.append(total,detail,note);
      if(searching){const input=body.querySelector?.('.cs-planning-cost-search');input?.focus?.({preventScroll:true});if(selection&&typeof input?.setSelectionRange==='function')try{input.setSelectionRange(...selection);}catch{}}
    }
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
      if(event.key!=='Tab')return;
      const controls=[...panel.querySelectorAll('button,input')].filter(control=>!control.disabled&&!control.hidden),first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();panel.focus();return;}
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
    });
    return Object.freeze({
      open(next={}){if(disposed)return;const changed=identity(next)!==scopeKey;options={...next};scopeKey=identity(next);if(changed){query='';page=0;}trigger=next.trigger||doc.activeElement;opened=true;layer.hidden=false;paint();dismiss.focus?.({preventScroll:true});},
      update(next={}){if(disposed||!opened)return;const updated={...options,...next},changed=identity(updated)!==scopeKey;options=updated;scopeKey=identity(updated);if(changed){query='';page=0;}paint();},
      close,
      destroy(){if(disposed)return;close({restoreFocus:false});disposed=true;layer.remove();},
      get isOpen(){return opened;}
    });
  }
  const api=Object.freeze({mount,money});globalThis.CleanRoomsPlanningCostView=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
