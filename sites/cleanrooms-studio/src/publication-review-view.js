/* Publication review reads immutable before/after snapshots and changes no plan data. */
(() => {
  'use strict';
  const TYPES={changed:'Ændret',added:'Ny vagt',removed:'Aflyst'};
  const FILTERS=[['all','Alle'],['changed','Ændrede'],['added','Nye'],['removed','Aflyste']];
  const PAGE_SIZE=20,SEARCH_THRESHOLD=6;
  const array=value=>Array.isArray(value)?value:[];
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dateFormat=new Intl.DateTimeFormat('da-DK',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const personOrder=new Intl.Collator('da-DK');
  const dateLabel=value=>validDate(value)?dateFormat.format(new Date(value+'T12:00:00Z')):'Dato mangler';
  const clock=shift=>shift?.start&&shift?.end?shift.start+'–'+shift.end+(shift.end<shift.start?' +1 dag':''):'Tid mangler';
  const valueFor=(shift,key)=>key==='plannedBreakMinutes'?shift?.[key]??0:key==='note'||key==='noteRich'?shift?.[key]??'':key==='site'&&shift?.[key]!==undefined?String(shift[key]):shift?.[key];
  const changed=(entry,key)=>valueFor(entry.before,key)!==valueFor(entry.after,key);
  const instructionChange=entry=>changed(entry,'note')||changed(entry,'noteRich');

  function mount({element,onOpenChange}={}) {
    if(!element?.ownerDocument)throw new TypeError('Ændringsoversigten kræver et indholdsfelt.');
    const doc=element.ownerDocument,page=doc.createElement('section');page.className='cs-publication-review';page.setAttribute('aria-label','Ændringer til udgivelse');element.replaceChildren(page);
    let filter='all',query='',pageIndex=0,selectedId=null,scopeKey=null,instructionsOpen=false,disposed=false;
    let entries=[],counts={},people=new Map(),sites=new Map(),searchIndex=new Map(),scopeSite=null;
    const node=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
    const button=(label,action,key,cls='cs-publication-review-button')=>{const el=node('button',cls,label);el.type='button';if(key)el.dataset.publicationReviewFocus=key;el.addEventListener('click',()=>{if(!disposed)action();});return el;};
    const personName=id=>!id?'Ledig vagt':people.get(id)||'Medarbejder';
    const siteName=shift=>shift?.siteName||sites.get(String(shift?.site))||'Ukendt arbejdssted';
    const current=entry=>entry.after||entry.before;
    const person=entry=>personName(current(entry)?.person);
    const status=entry=>node('span','cs-publication-review-type',entry.type==='added'?'Ny':TYPES[entry.type]);
    function rowContext(entry){
      const shift=current(entry);
      const timeChanged=entry.type==='changed'&&(changed(entry,'start')||changed(entry,'end'));
      const siteChanged=entry.type==='changed'&&changed(entry,'site');
      const parts=[];
      if(!timeChanged)parts.push(clock(shift));
      if(!siteChanged&&String(shift.site)!==scopeSite)parts.push(siteName(shift));
      return parts.join(' · ');
    }
    function differences(entry){
      if(entry.type!=='changed')return [];
      const out=[];
      if(changed(entry,'date'))out.push('Dato: '+dateLabel(entry.before?.date)+' → '+dateLabel(entry.after?.date));
      if(changed(entry,'start')||changed(entry,'end'))out.push(clock(entry.before)+' → '+clock(entry.after));
      if(changed(entry,'person'))out.push('Medarbejder: '+personName(entry.before?.person)+' → '+personName(entry.after?.person));
      if(changed(entry,'site'))out.push('Arbejdssted: '+siteName(entry.before)+' → '+siteName(entry.after));
      if(changed(entry,'plannedBreakMinutes'))out.push('Pause: '+valueFor(entry.before,'plannedBreakMinutes')+' → '+valueFor(entry.after,'plannedBreakMinutes')+' min');
      if(instructionChange(entry))out.push('Instruktioner opdateret');
      return out.length?out:['Vagtens oplysninger er opdateret'];
    }
    function open(entry){selectedId=String(entry.id);instructionsOpen=false;paint('back');}
    function close(){const previous=selectedId;selectedId=null;instructionsOpen=false;paint('change:'+previous);}
    function searchText(entry){
      if(!searchIndex.has(entry))searchIndex.set(entry,[person(entry),...(entry.before?[personName(entry.before.person),siteName(entry.before),clock(entry.before)]:[]),...(entry.after?[personName(entry.after.person),siteName(entry.after),clock(entry.after)]:[]),dateLabel(current(entry)?.date),...differences(entry)].join(' ').toLocaleLowerCase('da-DK'));
      return searchIndex.get(entry);
    }
    function renderTools(body){
      const availableFilters=FILTERS.filter(([key])=>counts[key]>0);
      const showSearch=entries.length>SEARCH_THRESHOLD||Boolean(query);
      const showFilters=availableFilters.length>2&&(entries.length>SEARCH_THRESHOLD||filter!=='all');
      if(!showSearch&&!showFilters)return;

      const tools=node('div','cs-publication-review-tools');
      if(showFilters){
        const filters=node('div','cs-publication-review-filters');
        filters.setAttribute('role','group');
        filters.setAttribute('aria-label','Filtrer ændringer');
        for(const [key,label]of availableFilters){
          const control=button(label,()=>{filter=key;pageIndex=0;paint('filter:'+key);},'filter:'+key,'cs-publication-review-filter');
          control.setAttribute('aria-pressed',String(filter===key));
          filters.append(control);
        }
        tools.append(filters);
      }
      if(showSearch){
        const search=node('input','cs-publication-review-input');
        search.type='search';
        search.value=query;
        search.placeholder='Søg i ændringer';
        search.setAttribute('aria-label','Søg i ændringer');
        search.dataset.publicationReviewFocus='search';
        search.addEventListener('input',()=>{query=search.value;pageIndex=0;paint('search');});
        tools.append(search);
      }
      body.append(tools);
    }
    function renderList(body){
      if(!counts[filter])filter='all';
      const term=query.trim().toLocaleLowerCase('da-DK');
      renderTools(body);
      const matching=entries.filter(entry=>(filter==='all'||entry.type===filter)&&(!term||searchText(entry).includes(term)));
      const totalPages=Math.max(1,Math.ceil(matching.length/PAGE_SIZE));
      pageIndex=Math.min(pageIndex,totalPages-1);
      if(!matching.length){body.append(node('p','cs-publication-review-empty',entries.length?'Ingen ændringer matcher dit valg.':'Ingen ændringer i den valgte periode.'));return;}
      const list=node('div','cs-publication-review-list');let lastDate=null,group;
      const first=pageIndex*PAGE_SIZE;
      for(const entry of matching.slice(first,first+PAGE_SIZE)){
        const day=current(entry)?.date||'';
        if(lastDate!==day){
          lastDate=day;
          group=node('section','cs-publication-review-day');
          group.append(node('h5','cs-publication-review-day-title',dateLabel(day)));
          list.append(group);
        }
        const row=button('',()=>open(entry),'change:'+String(entry.id),'cs-publication-review-row');
        row.dataset.changeId=String(entry.id);
        row.dataset.type=entry.type;
        const copy=node('span','cs-publication-review-row-copy');
        copy.append(node('strong','cs-publication-review-person',person(entry)));
        const parts=differences(entry);
        if(parts.length){
          const summary=node('span','cs-publication-review-row-summary');
          for(const part of parts)summary.append(node('span','',part));
          copy.append(summary);
        }
        const context=rowContext(entry);
        if(context)copy.append(node('span','cs-publication-review-row-context',context));
        const meta=node('span','cs-publication-review-row-meta');
        const arrow=node('span','cs-publication-review-chevron');
        arrow.setAttribute('aria-hidden','true');
        meta.append(status(entry),arrow);
        row.append(copy,meta);
        row.setAttribute('aria-label',[TYPES[entry.type],person(entry),dateLabel(day),...parts,context].filter(Boolean).join('. '));
        group.append(row);
      }
      body.append(list);
      if(totalPages===1)return;
      const foot=node('div','cs-publication-review-pagination');
      const position=node('span','cs-publication-review-muted',(first+1)+'–'+Math.min(first+PAGE_SIZE,matching.length)+' af '+matching.length);
      position.setAttribute('role','status');
      const previous=button('Forrige',()=>{pageIndex--;paint(pageIndex===0?'page:next':'page:previous');},'page:previous');
      const next=button('Næste',()=>{pageIndex++;paint(pageIndex===totalPages-1?'page:previous':'page:next');},'page:next');
      previous.disabled=pageIndex===0;
      next.disabled=pageIndex===totalPages-1;
      foot.append(position,previous,next);
      body.append(foot);
    }
    function renderInstructions(body,entry){
      const hasContent=shift=>Boolean(shift?.note||shift?.noteRich);if(!hasContent(entry.before)&&!hasContent(entry.after))return;
      const details=node('details','cs-publication-review-instructions'),summary=node('summary','','Instruktioner'+(instructionChange(entry)&&entry.type==='changed'?' · ændret':''));details.open=instructionsOpen;details.append(summary);let filled=false;
      const fill=()=>{if(filled)return;filled=true;const grid=node('div','cs-publication-review-instruction-grid');for(const [label,shift]of [['Senest udgivet',entry.before],['Ved udgivelse',entry.after]]){const section=node('section');section.append(node('h5','cs-publication-review-section-label',label));const content=node('div','cs-publication-review-note cs-rich-content');
          const Model=globalThis.CleanRoomsDescription;
          const rich=Model&&shift?.noteRich?Model.normalize(shift.noteRich):null;
          if(rich)Model.render(content,rich,{interactiveTasks:false});
          else content.textContent=shift?(shift.note||'Ingen instruktioner.'):'—';section.append(content);grid.append(section);}details.append(grid);};
      details.addEventListener('toggle',()=>{instructionsOpen=details.open;if(details.open)fill();});if(instructionsOpen)fill();body.append(details);
    }
    function renderDetail(body,entry){
      body.append(button('Tilbage til ændringer',close,'back','cs-publication-review-back'));
      const head=node('div','cs-publication-review-detail-head');head.append(node('h4','cs-publication-review-detail-title',person(entry)),status(entry));body.append(head,node('p','cs-publication-review-detail-context',dateLabel(current(entry)?.date)+' · '+clock(current(entry))+' · '+siteName(current(entry))));
      const groups=[['Dato','date',shift=>dateLabel(shift?.date)],['Arbejdstid','time',clock],['Medarbejder','person',shift=>personName(shift?.person)],['Arbejdssted','site',siteName],['Planlagt pause','pause',shift=>valueFor(shift,'plannedBreakMinutes')+' min']];
      const isChanged=key=>key==='time'?changed(entry,'start')||changed(entry,'end'):key==='pause'?changed(entry,'plannedBreakMinutes'):changed(entry,key);
      const visible=groups.filter(([,key])=>entry.type!=='changed'||isChanged(key));
      if(visible.length){const table=node('table','cs-publication-review-comparison'),head=node('thead'),row=node('tr'),rows=node('tbody');table.setAttribute('aria-label','Hvad ændres ved udgivelse');for(const label of ['Oplysning','Senest udgivet','Ved udgivelse']){const cell=node('th','',label);cell.scope='col';row.append(cell);}head.append(row);
        for(const [label,key,format]of visible){const line=node('tr'),name=node('th','',label),before=node('td','',entry.before?format(entry.before):'—'),after=node('td','',entry.after?format(entry.after):'—');name.scope='row';line.dataset.field=key;after.dataset.changed=String(entry.type==='changed'&&isChanged(key));line.append(name,before,after);rows.append(line);}table.append(head,rows);body.append(table);}
      else body.append(node('p','cs-publication-review-detail-summary','Instruktionerne er opdateret. Vagtens tid, medarbejder og arbejdssted er uændrede.'));
      renderInstructions(body,entry);
      if(typeof onOpenChange==='function'){const show=button('Vis i kalender',()=>onOpenChange(entry),'open:calendar','cs-button cs-publication-review-button');body.append(show);}
    }
    function paint(focusKey){
      if(disposed)return;const active=doc.activeElement,key=focusKey||(element.contains?.(active)?active?.dataset?.publicationReviewFocus:null),selection=active?.dataset?.publicationReviewFocus==='search'?[active.selectionStart,active.selectionEnd]:null;
      page.replaceChildren();
      const body=node('div','cs-publication-review-body');page.append(body);const entry=selectedId===null?null:entries.find(item=>String(item.id)===selectedId);
      if(selectedId!==null&&entry)renderDetail(body,entry);else{selectedId=null;renderList(body);}
      if(key){
        const target=[...page.querySelectorAll('[data-publication-review-focus]')].find(el=>el.dataset.publicationReviewFocus===key)
          ||page.querySelector('.cs-publication-review-row');
        target?.focus?.({preventScroll:true});
        if(target?.dataset.publicationReviewFocus==='search'&&selection&&typeof target.setSelectionRange==='function'){
          try{target.setSelectionRange(...selection);}catch{}
        }
      }
    }
    let options={};
    return {
      render(next={}){
        if(disposed)return;
        const incoming=String(next.scopeKey??'');
        if(scopeKey!==null&&incoming!==scopeKey){filter='all';query='';pageIndex=0;selectedId=null;instructionsOpen=false;}
        scopeKey=incoming;
        options={...options,...next};
        people=new Map(array(options.people).map(person=>[person.id||person.personId,person.name]));
        sites=new Map(array(options.sites).flatMap((site,index)=>site?[[String(site.index??index),site.name]]:[]));
        scopeSite=options.scopeSiteIds?.length===1?String(options.scopeSiteIds[0]):null;
        entries=array(options.changes).filter(entry=>entry&&Object.hasOwn(TYPES,entry.type)&&entry.id!==undefined&&(entry.before||entry.after));
        entries.sort((a,b)=>String(current(a)?.date||'').localeCompare(String(current(b)?.date||''))||String(current(a)?.start||'').localeCompare(String(current(b)?.start||''))||personOrder.compare(person(a),person(b))||String(a.id).localeCompare(String(b.id)));
        counts={all:entries.length,added:0,changed:0,removed:0};
        for(const entry of entries)counts[entry.type]++;
        searchIndex=new Map();
        paint();
      },
      capture(){return {filter,query,pageIndex,selectedId,instructionsOpen};},
      restore(saved={}){
        if(disposed)return;
        filter=FILTERS.some(([key])=>key===saved.filter)?saved.filter:'all';
        query=typeof saved.query==='string'?saved.query.slice(0,500):'';
        pageIndex=Number.isSafeInteger(saved.pageIndex)&&saved.pageIndex>=0?saved.pageIndex:0;
        selectedId=typeof saved.selectedId==='string'||typeof saved.selectedId==='number'?saved.selectedId:null;
        instructionsOpen=saved.instructionsOpen===true;
      },
      dispose(){disposed=true;element.replaceChildren();}
    };
  }
  const api=Object.freeze({mount,dateLabel,validDate});globalThis.CleanRoomsPublicationReview=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
