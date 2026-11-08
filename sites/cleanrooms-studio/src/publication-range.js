/* Whole-week publication ranges, shared by the dialog and its review summary. */
(() => {
  'use strict';
  const DAY=86400000,MAX_WEEKS=52,DEFAULT_MIN='2000-01-01',DEFAULT_MAX='2100-12-31';
  const date=value=>new Date(value+'T12:00:00Z');
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date(value).getTime())&&date(value).toISOString().slice(0,10)===value;
  const addDays=(value,days)=>{if(!validDate(value)||!Number.isSafeInteger(days))throw new TypeError('Datoen er ugyldig.');const result=date(value);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10);};
  const monday=value=>addDays(value,-((date(value).getUTCDay()+6)%7));
  function normalize({from,to=from,minDate=DEFAULT_MIN,maxDate=DEFAULT_MAX}={}) {
    if(!validDate(from)||!validDate(to))throw new TypeError('Vælg en gyldig start- og slutuge.');
    if(!validDate(minDate)||!validDate(maxDate)||minDate>maxDate)throw new TypeError('Kalenderens datogrænser er ugyldige.');
    const start=monday(from),end=addDays(monday(to),6);
    if(start>end)throw new TypeError('Slutugen skal ligge efter eller i startugen.');
    if((date(end)-date(start))/DAY>=MAX_WEEKS*7)throw new TypeError('Vælg højst 52 uger ad gangen.');
    if(start<minDate||end>maxDate)throw new TypeError('Hele perioden skal ligge inden for kalenderen.');
    return {from:start,to:end};
  }
  const countWeeks=(from,to)=>{const range=normalize({from,to});return Math.round((date(range.to)-date(range.from))/DAY+1)/7;};
  function weekNumber(value) {
    if(!validDate(value))throw new TypeError('Datoen er ugyldig.');
    const thursday=date(value);thursday.setUTCDate(thursday.getUTCDate()+3-((thursday.getUTCDay()+6)%7));
    const year=thursday.getUTCFullYear(),first=new Date(Date.UTC(year,0,4,12));first.setUTCDate(first.getUTCDate()+3-((first.getUTCDay()+6)%7));
    return {week:1+Math.round((thursday-first)/DAY/7),year};
  }
  function summary(scope) {
    const range=normalize(scope),weeks=countWeeks(range.from,range.to),sameYear=range.from.slice(0,4)===range.to.slice(0,4);
    const format=(value,year)=>date(value).toLocaleDateString('da-DK',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});
    return weeks+(weeks===1?' uge':' uger')+' · '+format(range.from,!sameYear)+' – '+format(range.to,true);
  }
  function overview(studio,scope,selectedWeeks){
    const range=normalize(scope),Publication=globalThis.CleanRoomsPublication||(typeof require==='function'?require('./publication-model.js'):null);
    if(!Publication)throw new TypeError('Udgivelsesmodellen mangler.');
    const scopes=selectedWeeks??Array.from({length:countWeeks(range.from,range.to)},(_,index)=>{
      const from=addDays(range.from,index*7);
      return {from,to:addDays(from,6),siteIds:scope.siteIds};
    });
    const comparisons=Publication.compareWeeks(studio,scopes);
    return scopes.map(({from,to},index)=>{
      const status=comparisons[index],counts={added:0,changed:0,removed:0};
      for(const change of status.changes)counts[change.type]++;
      return {from,to,...weekNumber(from),shiftCount:status.count,...counts,openCount:status.openCount,published:status.published,hasPublished:status.hasPublished,locationChanges:status.locationChanges};
    });
  }

  function mount({element,onChange=()=>{},onValidityChange=()=>{}}={}) {
    if(!element?.ownerDocument)throw new TypeError('Udgivelsesperioden kræver et indholdsfelt.');
    const doc=element.ownerDocument,root=doc.createElement('section');root.className='cs-publication-range';root.setAttribute('aria-label','Udgivelsesperiode');
    let options={minDate:DEFAULT_MIN,maxDate:DEFAULT_MAX,disabled:false},value=null,draftFrom='',draftTo='',valid=true,disposed=false;
    const node=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
    const heading=node('div','cs-publication-range-head'),label=node('h4','cs-publication-range-title','Udgivelsesperiode'),presets=node('div','cs-publication-range-presets');presets.setAttribute('role','group');presets.setAttribute('aria-label','Antal uger');
    const controls=new Map();
    const startingWeek=()=>validDate(draftFrom)?monday(draftFrom):value?.from;
    const chooseWeeks=count=>{
      const from=startingWeek();
      if(!disposed&&!options.disabled&&from)commit(from,addDays(from,count*7-1),'preset');
    };
    for(const count of [1,2,4,8]){const control=node('button','cs-publication-range-preset',count+(count===1?' uge':' uger'));control.type='button';control.dataset.publicationRange='preset:'+count;control.addEventListener('click',()=>{if(!control.disabled)chooseWeeks(count);});controls.set(count,control);presets.append(control);}
    const more=node('div','cs-publication-range-more'),select=node('select','cs-publication-range-more-select');
    select.dataset.publicationRange='more';
    select.setAttribute('aria-label','Flere ugevalg');
    const placeholder=node('option','','Flere');placeholder.value='';placeholder.disabled=true;
    select.append(placeholder);
    const extraCounts=new Map();
    for(let count=3;count<=MAX_WEEKS;count++){
      if(controls.has(count))continue;
      const option=node('option','',count+' uger');option.value=String(count);
      extraCounts.set(count,option);select.append(option);
    }
    select.addEventListener('change',()=>{
      const count=Number(select.value),choice=extraCounts.get(count);
      if(!select.disabled&&choice&&!choice.disabled)chooseWeeks(count);
    });
    more.append(select);presets.append(more);
    heading.append(label,presets);
    const fields=node('div','cs-publication-range-fields');
    const makeField=(name,text)=>{const holder=node('label','cs-publication-range-field'),input=node('input','cs-publication-range-input');input.type='date';input.dataset.publicationRange=name;input.setAttribute('aria-label',text);holder.append(node('span','',text),input);fields.append(holder);return input;};
    const start=makeField('from','Fra uge'),end=makeField('to','Til uge');
    const status=node('p','cs-publication-range-summary');status.setAttribute('aria-live','polite');
    const error=node('p','cs-publication-range-error');error.setAttribute('role','alert');error.hidden=true;
    root.append(heading,fields,status,error);element.replaceChildren(root);
    function validity(next,message='') {
      const changed=valid!==next||error.textContent!==message;valid=next;error.textContent=message;error.hidden=next;start.setAttribute('aria-invalid',String(!next));end.setAttribute('aria-invalid',String(!next));
      if(changed)onValidityChange({valid:next,message});
    }
    function sync() {
      if(disposed)return;
      start.value=draftFrom;end.value=draftTo;start.disabled=end.disabled=options.disabled===true;
      const min=validDate(options.minDate)?options.minDate:DEFAULT_MIN,max=validDate(options.maxDate)?options.maxDate:DEFAULT_MAX,first=monday(min),minimum=first<min?addDays(first,7):first,last=monday(max),maximum=addDays(last,6)>max?addDays(last,-7):last;
      start.min=end.min=minimum;start.max=end.max=maximum;
      const from=startingWeek(),selectedCount=valid&&value?countWeeks(value.from,value.to):0;
      const availableWeeks=from&&from>=minimum&&from<=maximum?Math.min(MAX_WEEKS,1+Math.round((date(maximum)-date(from))/(7*DAY))):0;
      for(const [count,control]of controls){const allowed=count<=availableWeeks;control.disabled=options.disabled===true||!allowed;control.setAttribute('aria-pressed',String(selectedCount===count));control.title=allowed?'':'Perioden ligger uden for kalenderen.';}
      for(const [count,option]of extraCounts)option.disabled=count>availableWeeks;
      select.disabled=options.disabled===true||availableWeeks<3;
      select.value=extraCounts.has(selectedCount)?String(selectedCount):'';
      more.dataset.selected=String(select.value!=='');
      status.textContent=valid&&value?summary(value):'Ret perioden, før du udgiver.';
    }
    function commit(from,to,source) {
      draftFrom=from;draftTo=to;
      let next;try{next=normalize({from,to,minDate:options.minDate,maxDate:options.maxDate});}
      catch(problem){validity(false,problem.message);sync();return;}
      const changed=!value||value.from!==next.from||value.to!==next.to;
      value=next;draftFrom=value.from;draftTo=monday(value.to);validity(true);sync();
      if(changed&&!disposed)onChange({...value},{source});
    }
    start.addEventListener('change',()=>{if(!disposed&&!options.disabled)commit(start.value,end.value,'date');});
    end.addEventListener('change',()=>{if(!disposed&&!options.disabled)commit(start.value,end.value,'date');});
    function render(next={}) {
      if(disposed)return;options={...options,...next};
      try{
        const from=next.from??value?.from??monday(new Date().toISOString().slice(0,10)),to=next.to??value?.to??from,range=normalize({...options,from,to});
        const changed=!value||value.from!==range.from||value.to!==range.to;
        if(changed){value=range;draftFrom=value.from;draftTo=monday(value.to);validity(true);}
      }catch(problem){validity(false,problem.message);}
      sync();
    }
    return {render,dispose(){disposed=true;element.replaceChildren();},get value(){return value?{...value}:null;},get valid(){return valid;}};
  }
  const api=Object.freeze({MAX_WEEKS,validDate,addDays,normalize,countWeeks,weekNumber,summary,overview,mount});
  globalThis.CleanRoomsPublicationRange=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
