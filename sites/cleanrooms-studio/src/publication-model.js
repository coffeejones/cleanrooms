/* Published week/site snapshots are separate from the editable plan. */
(() => {
  'use strict';
  const Instructions=globalThis.CleanRoomsInstructions||(typeof require==='function'?require('./instruction-state.js'):null);
  const Data=globalThis.CleanRoomsData||(typeof require==='function'?require('./studio-data.js'):null);
  const Changes=globalThis.CleanRoomsChanges||(typeof require==='function'?require('./plan-changes.js'):null);
  const Departments=globalThis.CleanRoomsDepartments||(typeof require==='function'?require('./department-model.js'):null);
  const Series=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const MAX_RECORDS=100,MAX_SLOTS=10000;
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const stable=value=>JSON.stringify(value===undefined?null:Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
  const same=(a,b)=>stable(a)===stable(b);
  const date=value=>new Date(value+'T12:00:00Z');
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date(value).getTime())&&date(value).toISOString().slice(0,10)===value;
  const add=(value,days)=>{const result=date(value);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10);};
  const monday=value=>add(value,-((date(value).getUTCDay()+6)%7));
  const slotKey=(from,site)=>from+'|'+site;
  const keySlot=key=>{if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}\|\d{1,4}$/.test(key))return null;const [from,value]=key.split('|'),site=Number(value);return validDate(from)&&monday(from)===from&&site<2000?{from,to:add(from,6),site}:null;};
  const actorValid=value=>record(value)&&typeof value.userId==='string'&&value.userId.trim()&&value.userId.length<=512&&typeof value.name==='string'&&value.name.length<=200;
  const timestamp=value=>typeof value==='string'&&Number.isFinite(new Date(value).getTime())&&new Date(value).toISOString()===value;
  const empty=()=>({version:1,sequence:0,slots:{},records:[]});
  const sitesFor=studio=>studio.organization?.sites||Departments.defaultOrganization().sites;
  function locationDetails(site){
    // Clock-in uses the current worksite policy, independently of publication.
    const location={...site};
    delete location.gps;
    delete location.workHoursBudget;
    return location;
  }
  function cleanShift(shift){
    const result={};for(const key of ['id','person','site','date','start','end','plannedBreakMinutes','note','noteRich','seriesId','_instructions'])if(shift[key]!==undefined)result[key]=clone(shift[key]);
    if(result.note===undefined&&!Instructions?.isDeferred(result))result.note='';return result;
  }
  function validShift(shift,slot){
    const clock=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    return record(shift)&&typeof shift.id==='string'&&shift.id.trim()&&typeof shift.person==='string'&&Number.isInteger(shift.site)&&shift.site===slot.site
      &&validDate(shift.date)&&shift.date>=slot.from&&shift.date<=slot.to&&clock(shift.start)&&clock(shift.end)&&Series.shiftInterval(shift)!==null&&Series.validPlannedBreak(shift)
      &&(shift.note===undefined||typeof shift.note==='string')&&(shift.noteRich===undefined||typeof shift.noteRich==='string')&&(shift.seriesId===undefined||typeof shift.seriesId==='string');
  }
  function validate(value){
    if(!record(value)||value.version!==1||!Number.isSafeInteger(value.sequence)||value.sequence<0||value.sequence>=Number.MAX_SAFE_INTEGER||!record(value.slots)||!Array.isArray(value.records))return ['Udgivelsesdata er ugyldige.'];
    const errors=[],ids=new Set();
    if(Object.keys(value.slots).length>MAX_SLOTS||value.records.length>MAX_RECORDS)return ['Der er for mange udgivelsesposter.'];
    if(value.scopeLinks!==undefined&&(!Array.isArray(value.scopeLinks)||value.scopeLinks.length>20000||value.scopeLinks.some(link=>!record(link)||!keySlot(link.from)||!keySlot(link.to))))errors.push('Forbundne udgivelsesperioder er ugyldige.');
    for(const [key,slot]of Object.entries(value.slots)){
      if(!record(slot)||!validDate(slot.from)||monday(slot.from)!==slot.from||slot.to!==add(slot.from,6)||!Number.isInteger(slot.site)||slot.site<0||slot.site>=2000||key!==slotKey(slot.from,slot.site)
        ||!actorValid(slot.actor)||!timestamp(slot.at)||typeof slot.publicationId!=='string'||!record(slot.location)||slot.location.index!==slot.site
        ||!['id','name','address','color'].every(field=>typeof slot.location[field]==='string')||!Array.isArray(slot.shifts)){errors.push('En udgivet uge eller et arbejdssted er ugyldigt.');continue;}
      for(const shift of slot.shifts){if(!validShift(shift,slot)||ids.has(shift?.id))errors.push('En udgivet vagt er ugyldig eller forekommer flere gange.');if(record(shift))ids.add(shift.id);}
    }
    for(const item of value.records){
      if(!record(item)||typeof item.id!=='string'||!actorValid(item.actor)||!timestamp(item.at)||!Array.isArray(item.scopes)||item.scopes.length>MAX_SLOTS||!record(item.counts)||!Number.isSafeInteger(item.shiftCount)||item.shiftCount<0
        ||['added','changed','removed'].some(key=>!Number.isSafeInteger(item.counts?.[key])||item.counts[key]<0)){errors.push('Udgivelseshistorikken er ugyldig.');continue;}
      if(item.scopes.some(scope=>!record(scope)||!validDate(scope.from)||monday(scope.from)!==scope.from||scope.to!==add(scope.from,6)||!Array.isArray(scope.siteIds)||!scope.siteIds.length||scope.siteIds.some(site=>!Number.isInteger(site)||site<0||site>=2000)))errors.push('En historisk udgivelsesperiode er ugyldig.');
    }
    return errors;
  }
  function checked(value){if(value===undefined)return empty();const errors=validate(value);if(errors.length)throw new TypeError(errors[0]);return value;}
  function normalize(value){return clone(checked(value));}
  function requested(studio,scope){
    if(!record(scope)||!validDate(scope.from)||!validDate(scope.to)||scope.from>scope.to||monday(scope.from)!==scope.from||scope.to!==add(monday(scope.to),6)||(date(scope.to)-date(scope.from))/86400000>=366)throw new TypeError('Vælg hele uger, højst 366 dage ad gangen.');
    if(scope.from<Data.minDate||scope.to>Data.maxDate)throw new TypeError('Udgivelsesperioden ligger uden for kalenderen.');
    const sites=sitesFor(studio);
    if(!Array.isArray(scope.siteIds)||!scope.siteIds.length||new Set(scope.siteIds).size!==scope.siteIds.length||scope.siteIds.some(site=>!Number.isInteger(site)||site<0||site>=sites.length))throw new TypeError('Vælg mindst ét gyldigt arbejdssted.');
    const keys=new Map();for(let from=scope.from;from<=scope.to;from=add(from,7))for(const site of scope.siteIds)keys.set(slotKey(from,site),{from,to:add(from,6),site});
    if(keys.size>MAX_SLOTS)throw new TypeError('Vælg færre uger eller arbejdssteder.');return keys;
  }
  function grouped(keys){
    const weeks=new Map();for(const slot of keys.values()){if(!weeks.has(slot.from))weeks.set(slot.from,{from:slot.from,to:slot.to,siteIds:[]});weeks.get(slot.from).siteIds.push(slot.site);}
    return [...weeks.values()].sort((a,b)=>a.from.localeCompare(b.from)).map(scope=>({...scope,siteIds:scope.siteIds.sort((a,b)=>a-b)}));
  }
  function draftFor(studio,keys){
    const shifts=[];for(const scope of grouped(keys))shifts.push(...Data.shiftsInRange(scope.from,scope.to,studio).filter(shift=>scope.siteIds.includes(shift.site)).map(cleanShift));return shifts;
  }
  function withLineage(before,after){
    const publications=checked(after.publications),links=new Map();
    const publishedOrigins=new Set(Object.values(publications.slots).flatMap(slot=>slot.shifts).map(shift=>shift.id+'|'+shift.date+'|'+shift.site)),linkedScopes=new Set((publications.scopeLinks||[]).flatMap(link=>[link.from,link.to]));
    const connect=(left,right)=>{if(left===right)return;const pair=[left,right].sort(),key=pair.join('>');links.set(key,{from:pair[0],to:pair[1]});};
    for(const link of publications.scopeLinks||[])connect(link.from,link.to);
    const previous=before?.series||[],next=after.series||[],beforeIds=new Set(previous.map(series=>series.id)),added=next.filter(series=>!beforeIds.has(series.id)),cache=new Map();
    // A recurrence can have no end date. Lineage only connects already known
    // published scopes, their original occurrence weeks and moved exceptions;
    // it must never materialize the recurrence's remaining decades.
    const knownWeeks=new Set();
    const rememberWeek=day=>{if(validDate(day))knownWeeks.add(monday(day));};
    for(const slot of Object.values(publications.slots)){rememberWeek(slot.from);for(const shift of slot.shifts){rememberWeek(shift.date);rememberWeek(shift.id.slice(-10));}}
    for(const key of linkedScopes)rememberWeek(keySlot(key)?.from);
    for(const data of [before,after])for(const shift of Object.values(data?.edits||{})){rememberWeek(shift.date);rememberWeek(shift.id.slice(-10));}
    for(const series of added)rememberWeek(series.startDate);
    const knownRanges=[];for(const from of [...knownWeeks].sort()){const prior=knownRanges.at(-1),to=add(from,6);if(prior&&from===add(prior.to,1)&&(date(to)-date(prior.from))/86400000<366)prior.to=to;else knownRanges.push({from,to});}
    const occurrences=(series,data)=>{
      const key=(data===before?'before:':'after:')+series.id;if(cache.has(key))return cache.get(key);
      const bounded=Series.requiresRange(series),values=new Map((bounded?knownRanges.flatMap(range=>Series.enumerate(series,range)):Series.enumerate(series)).map(shift=>[shift.id,shift]));
      for(const shift of Object.values(data.edits||{}))if(Series.occurrenceAnchor(shift.id,series.id))values.set(shift.id,shift);
      const result=[...values.values()].filter(shift=>!(data.deleted||[]).includes(shift.id));cache.set(key,result);return result;
    };
    for(const source of previous){
      const current=next.find(series=>series.id===source.id);if(same(source,current))continue;
      const cutoff=current&&current.endDate<source.endDate?add(current.endDate,1):source.startDate;
      const replacements=[...(current?[current]:[]),...added.filter(series=>series.startDate>=cutoff)];
      const candidates=replacements.flatMap(series=>occurrences(series,after));
      const origins=new Map();
      for(const old of [...occurrences(source,before),...Object.values(publications.slots).flatMap(slot=>slot.shifts).filter(shift=>Series.occurrenceAnchor(shift.id,source.id))])origins.set(old.id+'|'+old.date+'|'+old.site,old);
      for(const old of origins.values()){
        const oldScope=slotKey(monday(old.date),old.site),direct=Data.shiftById(old.id,after);
        if(!publishedOrigins.has(old.id+'|'+old.date+'|'+old.site)&&!linkedScopes.has(oldScope))continue;
        if(direct){connect(oldScope,slotKey(monday(direct.date),direct.site));continue;}
        const original=Series.occurrenceAnchor(old.id,source.id)||old.date;
        const matching=candidates.filter(shift=>monday(Series.occurrenceAnchor(shift.id,shift.seriesId)||shift.date)===monday(original));
        const rangeCovered=replacements.some(series=>series.startDate<=original&&series.endDate>=original);
        for(const shift of matching.length?matching:rangeCovered?[]:candidates)connect(oldScope,slotKey(monday(shift.date),shift.site));
      }
    }
    if(links.size>20000)throw new TypeError('For mange forbundne serieændringer. Udgiv en mindre periode først.');
    return {...after,publications:{...publications,scopeLinks:[...links.values()]}};
  }
  function expandScope(studio,scope){
    const publications=checked(studio.publications),initial=requested(studio,scope),keys=new Map(initial),oldIndex=new Map();
    for(const [key,slot]of Object.entries(publications.slots))for(const shift of slot.shifts)oldIndex.set(shift.id,{key,slot});
    let changed=true;
    while(changed){
      changed=false;
      const addSlot=slot=>{const key=slotKey(slot.from,slot.site);if(!keys.has(key)){keys.set(key,{from:slot.from,to:add(slot.from,6),site:slot.site});changed=true;}};
      for(const link of publications.scopeLinks||[]){if(keys.has(link.from))addSlot(keySlot(link.to));if(keys.has(link.to))addSlot(keySlot(link.from));}
      for(const shift of draftFor(studio,keys)){const old=oldIndex.get(shift.id);if(old&&!keys.has(old.key))addSlot(old.slot);}
      for(const [key]of keys)for(const before of publications.slots[key]?.shifts||[]){
        const current=Data.shiftById(before.id,studio);if(!current||!validDate(current.date))continue;
        const from=monday(current.date),site=current.site;
        if(!Number.isInteger(site)||site<0||site>=sitesFor(studio).length)throw new TypeError('En flyttet vagt har et ugyldigt arbejdssted.');
        addSlot({from,site});
      }
      if(keys.size>MAX_SLOTS)throw new TypeError('For mange forbundne uger eller arbejdssteder til én udgivelse.');
    }
    const extra=new Map([...keys].filter(([key])=>!initial.has(key)));
    return {scopes:grouped(keys),dependencies:grouped(extra)};
  }
  function compareScope(studio,publications,keys){
    const before=[...keys.keys()].flatMap(key=>publications.slots[key]?.shifts||[]),after=draftFor(studio,keys),changes=Changes.diff(before,after);
    const locations=sitesFor(studio),locationChanges=[...keys].filter(([key,slot])=>publications.slots[key]&&!same(locationDetails(publications.slots[key].location),{index:slot.site,...locationDetails(locations[slot.site])})).map(([,slot])=>({from:slot.from,site:slot.site}));
    const hasPublished=[...keys.keys()].every(key=>Boolean(publications.slots[key]));
    return {published:hasPublished&&!changes.length&&!locationChanges.length,hasPublished,changed:changes.length,changes,locationChanges,count:after.length,openCount:after.filter(shift=>!shift.person).length};
  }
  function scopeStatus(studio,scope){
    const expanded=expandScope(studio,scope),publications=studio.publications??empty();
    const keys=scope.includeDependencies===true?new Map(expanded.scopes.flatMap(item=>[...requested(studio,item)])):requested(studio,scope);
    return {...compareScope(studio,publications,keys),scopes:grouped(keys),expandedScopes:expanded.scopes,dependencies:expanded.dependencies};
  }
  function compareWeeks(studio,scopes){
    const publications=checked(studio.publications);
    return scopes.map(scope=>compareScope(studio,publications,requested(studio,scope)));
  }
  function publish(studio,scope){
    const publications=normalize(studio.publications),expanded=expandScope(studio,scope);
    if(expanded.dependencies.length&&scope.includeDependencies!==true){const error=new TypeError('Flyttede vagter forbinder andre uger eller arbejdssteder. Medtag de viste relaterede perioder.');error.dependencies=expanded.dependencies;throw error;}
    if(!actorValid(scope.actor)||!timestamp(scope.at))throw new TypeError('Udgivelsen kræver en gyldig afsender og tidspunkt.');
    const scopes=scope.includeDependencies===true?expanded.scopes:grouped(requested(studio,scope)),keys=new Map(scopes.flatMap(item=>[...requested(studio,item)])),status=scopeStatus(studio,{...scope,includeDependencies:true});
    const sequence=publications.sequence+1,id='publication-'+sequence,locations=sitesFor(studio),shifts=draftFor(studio,keys),actor={userId:scope.actor.userId,name:scope.actor.name},people=new Set(Data.staffFor(studio).map(person=>person.id));
    if(shifts.some(shift=>shift.person&&!people.has(shift.person)))throw new TypeError('En vagt er tildelt en medarbejder, der ikke findes i medarbejderlisten.');
    const counts={added:status.changes.filter(item=>item.type==='added').length,changed:status.changes.filter(item=>item.type==='changed').length,removed:status.changes.filter(item=>item.type==='removed').length};
    const entry={id,at:scope.at,actor,from:scope.from,to:scope.to,siteIds:[...scope.siteIds],scopes:clone(scopes),shiftCount:shifts.length,counts};
    publications.sequence=sequence;
    for(const [key,slot]of keys){const snapshot=shifts.filter(shift=>shift.site===slot.site&&shift.date>=slot.from&&shift.date<=slot.to);const item={...slot,location:{index:slot.site,...clone(locationDetails(locations[slot.site]))},publicationId:id,at:scope.at,actor:clone(actor),shifts:snapshot};if(snapshot.some(shift=>!validShift(shift,item)))throw new TypeError('Planen indeholder en ugyldig vagt.');publications.slots[key]=item;}
    if(Object.keys(publications.slots).length>MAX_SLOTS)throw new TypeError('Der er for mange udgivne uger og arbejdssteder.');
    publications.records=[...publications.records,entry].slice(-MAX_RECORDS);
    publications.scopeLinks=(publications.scopeLinks||[]).filter(link=>!keys.has(link.from)||!keys.has(link.to));
    return {studio:{...clone(studio),publications},record:entry};
  }
  function publishedShifts(studio,personId){return Object.values(checked(studio.publications).slots).flatMap(slot=>slot.shifts).filter(shift=>personId===undefined||shift.person===personId).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id)).map(cleanShift);}
  function publishedSites(studio,personId){
    const slots=Object.values(checked(studio.publications).slots),used=new Set(slots.flatMap(slot=>slot.shifts).filter(shift=>personId===undefined||shift.person===personId).map(shift=>shift.site)),sites=new Map();
    slots.sort((a,b)=>a.at.localeCompare(b.at)||(Number(a.publicationId.replace('publication-',''))||0)-(Number(b.publicationId.replace('publication-',''))||0)).forEach(slot=>{if(used.has(slot.site))sites.set(slot.site,clone(locationDetails(slot.location)));});return [...sites.values()].sort((a,b)=>a.index-b.index);
  }
  const ARRAY_FIELDS=['series','coverageRules','roster'],MAP_FIELDS=['edits','requests'],VALUE_FIELDS=['workspaceSettings','organization','demoSeed'];
  function activityChanges(before,after){
    const changes=[];
    for(const field of ARRAY_FIELDS){const left=new Map((field==='roster'?Data.staffFor(before||{}):before?.[field]||[]).map(item=>[item.id,item])),right=new Map((field==='roster'?Data.staffFor(after||{}):after?.[field]||[]).map(item=>[item.id,item]));for(const id of new Set([...left.keys(),...right.keys()]))if(!same(left.get(id),right.get(id)))changes.push({field,id,before:clone(left.get(id)??null),after:clone(right.get(id)??null)});}
    for(const field of MAP_FIELDS){const left=before?.[field]||{},right=after?.[field]||{};for(const id of new Set([...Object.keys(left),...Object.keys(right)]))if(!same(left[id],right[id]))changes.push({field,id,before:clone(left[id]??null),after:clone(right[id]??null)});}
    const leftDeleted=new Set(before?.deleted||[]),rightDeleted=new Set(after?.deleted||[]);for(const id of new Set([...leftDeleted,...rightDeleted]))if(leftDeleted.has(id)!==rightDeleted.has(id))changes.push({field:'deleted',id,before:leftDeleted.has(id),after:rightDeleted.has(id)});
    for(const field of VALUE_FIELDS){const effective=value=>field==='workspaceSettings'?value?.[field]||{}:field==='organization'?value?.[field]||Departments.defaultOrganization():value?.[field]!==false;if(!same(effective(before),effective(after)))changes.push({field,before:clone(effective(before)),after:clone(effective(after))});}
    return changes;
  }
  function restoreActivity(studio,entry){
    const fail=error=>({ok:false,studio:null,error});
    if(!record(entry)||entry.kind!=='plan'||entry.recoverable!==true||!Array.isArray(entry.changes)||!entry.changes.length)return fail('Denne historikpost kan ikke gendannes.');
    const allowed=new Set([...ARRAY_FIELDS,...MAP_FIELDS,'deleted','workspaceSettings']),next=clone(studio);
    for(const change of entry.changes){
      if(!allowed.has(change.field)||!Object.hasOwn(change,'before')||!Object.hasOwn(change,'after'))return fail('Historikposten indeholder ændringer, der ikke kan gendannes.');
      let current;if(ARRAY_FIELDS.includes(change.field))current=(next[change.field]||[]).find(item=>item.id===change.id)??null;else if(MAP_FIELDS.includes(change.field))current=next[change.field]?.[change.id]??null;else if(change.field==='deleted')current=(next.deleted||[]).includes(change.id);else current=next[change.field]??null;
      if(!same(current,change.after))return fail('Nyere ændringer berører samme data. Ingen ændringer er gendannet.');
    }
    for(const change of entry.changes){
      const {field,id,before}=change;
      if(ARRAY_FIELDS.includes(field)){
        const values=next[field]||[];next[field]=values.filter(item=>item.id!==id);
        if(before!==null){
          const restored=clone(before);
          // An explicit reset preserves legacy behavior without looking like
          // an older editor silently dropping newer recurrence metadata.
          if(field==='series'&&record(change.after)){
            if(Object.hasOwn(change.after,'dayTimes')&&!Object.hasOwn(restored,'dayTimes'))restored.dayTimes={};
            if(Object.hasOwn(change.after,'groupId')&&!Object.hasOwn(restored,'groupId'))restored.groupId=restored.id;
            if((Object.hasOwn(change.after,'plannedBreakMinutes')||Object.values(change.after.dayTimes||{}).some(times=>Series.plannedBreakMinutes(times)>0))&&!Object.hasOwn(restored,'plannedBreakMinutes'))restored.plannedBreakMinutes=0;
            if(Object.hasOwn(change.after,'openEnded')&&!Object.hasOwn(restored,'openEnded'))restored.openEnded=false;
          }
          next[field].push(restored);
        }
      }
      else if(MAP_FIELDS.includes(field)){next[field]={...(next[field]||{})};if(before===null)delete next[field][id];else{const restored=clone(before);if(field==='edits'&&record(change.after)&&Object.hasOwn(change.after,'plannedBreakMinutes')&&!Object.hasOwn(restored,'plannedBreakMinutes'))restored.plannedBreakMinutes=0;next[field][id]=restored;}}
      else if(field==='deleted'){next.deleted=(next.deleted||[]).filter(value=>value!==id);if(before)next.deleted.push(id);}
      else if(before===null)delete next[field];else next[field]=clone(before);
    }
    return {ok:true,studio:next,error:null};
  }
  const api=Object.freeze({MAX_RECORDS,MAX_SLOTS,empty,validate,normalize,withLineage,expandScope,scopeStatus,compareWeeks,publish,publishedShifts,publishedSites,locationDetails,activityChanges,restoreActivity});
  globalThis.CleanRoomsPublication=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
