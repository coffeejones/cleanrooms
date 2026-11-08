/* Pure attendance arithmetic. Approval and authority remain on the server. */
(() => {
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const minute=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
  const clock=value=>String(Math.floor(value/60)%24).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const addDays=(value,count)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);};
  const weekday=value=>(new Date(value+'T12:00:00Z').getUTCDay()+6)%7;
  const localFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function localNow(value=new Date()){
    const parts=Object.fromEntries(localFormatter.formatToParts(value).map(p=>[p.type,p.value]));
    return {date:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute};
  }
  function copenhagenOffset(value){
    const instant=new Date(value);if(!Number.isFinite(instant.getTime()))return null;
    const parts=Object.fromEntries(localFormatter.formatToParts(instant).map(p=>[p.type,p.value]));
    return Math.round((Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute))-Math.floor(instant.getTime()/60000)*60000)/60000);
  }
  const crossesOffsetChange=(from,to)=>copenhagenOffset(from)!==null&&copenhagenOffset(to)!==null&&copenhagenOffset(from)!==copenhagenOffset(to);
  const validInstant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z');
  function exactInstants(entry){
    if(entry.demo===true)return null;
    const start=entry.timingResolved?entry.resolvedStartAt:entry.breakAllocation==='clocked'?entry.clockStartAt:null,end=entry.timingResolved?entry.resolvedEndAt:entry.breakAllocation==='clocked'?entry.clockEndAt:null;
    return validInstant(start)&&validInstant(end)?{start:Math.floor(Date.parse(start)/60000)*60000,end:Math.floor(Date.parse(end)/60000)*60000}:null;
  }
  function instantForLocal(date,time){
    if(!validDate(date)||minute(time)===null)return null;
    const wall=Date.parse(date+'T'+time+':00Z'),offsets=new Set([copenhagenOffset(wall-43200000),copenhagenOffset(wall+43200000)]),matches=[];
    for(const offset of offsets){const instant=wall-offset*60000,local=localNow(new Date(instant));if(local.date===date&&local.time===time)matches.push(instant);}
    return matches.length===1?matches[0]:null;
  }
  function absoluteInterval(entry){
    if(!entry.end)return null;const exact=exactInstants(entry);
    if(exact)return exact.end>exact.start&&exact.end-exact.start<=2160*60000?exact:null;
    const start=instantForLocal(entry.date,entry.start),end=instantForLocal(entry.endDate||entry.date,entry.end);
    return start!==null&&end!==null&&end>start&&end-start<=2160*60000?{start,end}:null;
  }
  function hasDSTAmbiguity(entry){
    if(entry.dstUnresolved===true)return true;
    if(entry.timingResolved&&exactInstants(entry))return false;
    if(entry.breakAllocation==='clocked'&&entry.clockStartAt&&entry.clockEndAt)return crossesOffsetChange(entry.clockStartAt,entry.clockEndAt);
    const range=span(entry);if(!range)return false;
    for(let d=0;d<=Math.floor(range.end/1440);d++){
      const day=addDays(entry.date,d);
      if(crossesOffsetChange(day+'T00:00:00Z',day+'T12:00:00Z')&&range.start<=d*1440+180&&range.end>=d*1440+120)return true;
    }
    return false;
  }
  function span(entry){
    const start=minute(entry.start),end=minute(entry.end);if(start===null||end===null)return null;
    const endDate=entry.endDate||entry.date;if(!validDate(entry.date)||!validDate(endDate))return null;
    const exact=exactInstants(entry);if(exact){const elapsed=(exact.end-exact.start)/60000;return elapsed>0&&elapsed<=2160?{start,end:start+elapsed,minutes:elapsed}:null;}
    const days=Math.round((Date.parse(endDate+'T12:00:00Z')-Date.parse(entry.date+'T12:00:00Z'))/86400000),finish=end+days*1440;
    return finish>start&&finish-start<=2160?{start,end:finish,minutes:finish-start}:null;
  }
  function breaks(entry,range=span(entry)){
    if(!range)return [];
    if(Array.isArray(entry.breaks)&&entry.breaks.length)return entry.breaks.map(b=>({start:b.start,end:b.end})).filter(b=>Number.isInteger(b.start)&&Number.isInteger(b.end)&&b.start>=range.start&&b.end<=range.end&&b.end>b.start).sort((a,b)=>a.start-b.start);
    const count=Number.isSafeInteger(entry.breakMinutes)?entry.breakMinutes:0;
    // Manually entered total pauses are allocated from the end of the interval,
    // visibly identified in the receipt. Clocked pauses retain exact positions.
    return count>0?[{start:range.end-count,end:range.end}]:[];
  }
  function plannedGrossMinutes(value){
    const start=minute(value?.plannedStart??value?.start),end=minute(value?.plannedEnd??value?.end);
    if(start===null||end===null)return null;
    return end>start?end-start:end<start?end+1440-start:0;
  }
  function plannedBreak(value){
    const pause=value?.plannedBreakMinutes===undefined?0:value.plannedBreakMinutes;
    if(!Number.isSafeInteger(pause)||pause<0)return null;
    const gross=plannedGrossMinutes(value);
    return gross===null?(pause===0?0:null):gross>0&&pause<gross?pause:null;
  }
  function plannedMinutes(value){const gross=plannedGrossMinutes(value),pause=plannedBreak(value);return gross===null||pause===null?null:gross-pause;}
  function validate(entry,{allowOpen=false}={}){
    const errors=[];if(!validDate(entry.date)||minute(entry.start)===null)errors.push('Vælg en gyldig dato og starttid.');
    if(!Number.isSafeInteger(entry.breakMinutes)||entry.breakMinutes<0||entry.breakMinutes>2160)errors.push('Pauser skal være et ikke-negativt antal hele minutter.');
    if(entry.plannedBreakMinutes!==undefined&&plannedBreak(entry)===null)errors.push('Den planlagte pause skal være et helt antal minutter, der er kortere end den planlagte vagt.');
    if(!entry.end){if(!allowOpen)errors.push('Afslut vagten, før timerne kan godkendes.');return errors;}
    const range=span(entry);if(!range)errors.push('Sluttiden skal være efter starttiden; en registrering må højst vare 36 timer.');
    if(range){if(entry.breakMinutes>=range.minutes)errors.push('Pauserne skal være kortere end arbejdstiden.');const list=breaks(entry,range);if(Array.isArray(entry.breaks)&&entry.breaks.length&&(list.length!==entry.breaks.length||list.some((b,i)=>i>0&&b.start<list[i-1].end)||list.reduce((n,b)=>n+b.end-b.start,0)!==entry.breakMinutes))errors.push('Pauserne ligger uden for vagten eller overlapper.');}
    return errors;
  }
  function summary(entry){
    const range=span(entry),planned=plannedMinutes(entry)??0,plannedPause=plannedBreak(entry),workedMinutes=range?Math.max(0,range.minutes-entry.breakMinutes):0,flags=[];
    if(minute(entry.start)!==null&&minute(entry.plannedStart)!==null&&minute(entry.start)>minute(entry.plannedStart))flags.push('late_start');
    if(!entry.end)flags.push('missing_end');
    if(range&&workedMinutes>planned)flags.push('overtime');
    if(entry.breakMinutes>Math.max(30,plannedPause??0))flags.push('long_break');
    if(entry.correctionReason)flags.push('corrected');
    if(typeof entry.comment==='string'&&entry.comment.trim())flags.push('employee_comment');
    return {plannedMinutes:planned,plannedBreakMinutes:plannedPause??entry.plannedBreakMinutes,plannedGrossMinutes:plannedGrossMinutes(entry)??0,workedMinutes,deltaMinutes:range?workedMinutes-planned:0,flags};
  }
  function overlaps(entry,other){if(entry.personId!==other.personId||entry.id===other.id)return false;const a=absoluteInterval(entry),b=absoluteInterval(other);return Boolean(a&&b&&a.start<b.end&&b.start<a.end);}
  function review(entry,{shift,canViewPayroll=false,today}={}){
    if(!entry||typeof entry!=='object')return {bucket:'attention',reasons:[{code:'invalid',label:'Registreringen kan ikke læses.'}],priority:100};
    if(entry.status==='approved')return {bucket:'approved',reasons:[],priority:0};
    const flags=Array.isArray(entry.flags)?entry.flags:summary(entry).flags,knownFlags=new Set(['late_start','overtime','long_break','missing_end','corrected','overlap','dst_transition','employee_comment']);
    const currentDate=validDate(today)?today:localNow().date;
    const active=['running','paused'].includes(entry.status)&&!entry.end&&validDate(entry.date)&&entry.date>=currentDate&&minute(entry.start)!==null;
    if(active&&!flags.some(flag=>flag==='overlap'||flag==='dst_transition'||!knownFlags.has(flag)))return {bucket:'progress',reasons:[],priority:5};
    const reasons=[],weights=new Map();let priority=10;
    const add=(code,label,weight)=>{if(!reasons.some(reason=>reason.code===code))reasons.push({code,label});weights.set(code,Math.max(weights.get(code)||0,weight));priority=Math.max(priority,weight);};
    if(!entry.end)add('missing_end','Vagten mangler en afslutning.',100);
    if(entry.status==='rejected')add('rejected','Planlæggeren afventer afklaring af registreringen.',80);
    else if(!['submitted','running','paused'].includes(entry.status))add('invalid_status','Registreringen er ikke klar til godkendelse.',100);
    const errors=validate(entry,{allowOpen:!entry.end});
    if(errors.length)add('invalid',errors[0],100);
    if(entry.end&&(!Number.isFinite(entry.workedMinutes)||entry.workedMinutes<=0))add('invalid_worked_time','Den betalte arbejdstid skal kontrolleres.',100);
    const expectedPause=shift?plannedBreak(shift):null,capturedPause=plannedBreak(entry);
    if(!shift||shift.id!==entry.shiftId){add('shift_missing','Vagten findes ikke i den aktuelle udgivne plan.',100);}
    else{
      const plannedPerson=shift.person??shift.personId;
      if(plannedPerson!==entry.personId)add('person_changed','Vagten er nu tildelt en anden medarbejder.',100);
      if(shift.date!==entry.date)add('date_changed','Vagtens dato er ændret i planen.',80);
      if(shift.site!==entry.site)add('site_changed','Arbejdsstedet er ændret i planen.',80);
      if(!validDate(shift.date)||minute(shift.start)===null||minute(shift.end)===null)add('plan_invalid','Vagtens planlagte tidsrum skal kontrolleres.',100);
      else{
        const expectedEndDate=shift.endDate||(minute(shift.end)<=minute(shift.start)?addDays(shift.date,1):shift.date);
        if(entry.plannedStart!==shift.start||entry.plannedEnd!==shift.end)add('plan_changed','Vagtens tidsrum er ændret siden registreringen.',80);
        if(expectedPause===null)add('plan_invalid','Vagtens planlagte pause skal kontrolleres.',100);
        else if(capturedPause!==null&&capturedPause!==expectedPause)add('plan_changed','Den planlagte pause er ændret siden registreringen.',80);
        if(entry.start!==shift.start)add('start_difference','Starttiden afviger fra planen.',60);
        if(entry.end&&entry.end!==shift.end)add('end_difference','Sluttiden afviger fra planen.',60);
        if(entry.end&&(entry.endDate||entry.date)!==expectedEndDate)add('end_date_difference','Afslutningsdatoen afviger fra planen.',80);
      }
    }
    if(Number.isSafeInteger(entry.breakMinutes)&&expectedPause!==null&&entry.breakMinutes!==expectedPause)add('pause',expectedPause===0?'Pause på '+entry.breakMinutes+' min er ikke angivet i planen.':'Registreret pause er '+entry.breakMinutes+' min; planlagt pause er '+expectedPause+' min.',40);
    else if(Number.isSafeInteger(entry.breakMinutes)&&entry.breakMinutes>0&&expectedPause===null)add('pause','Pause på '+entry.breakMinutes+' min skal gennemgås.',40);
    if(typeof entry.comment==='string'&&entry.comment.trim())add('employee_comment','Medarbejderen har tilføjet en kommentar.',50);
    if(typeof entry.correctionReason==='string'&&entry.correctionReason.trim())add('corrected','Registreringen er rettet og skal gennemgås.',60);
    for(const flag of flags){
      if(flag==='missing_end'){add('missing_end','Vagten mangler en afslutning.',100);continue;}
      if(flag==='employee_comment'){add('employee_comment','Medarbejderen har tilføjet en kommentar.',50);continue;}
      if(flag==='corrected'){add('corrected','Registreringen er rettet og skal gennemgås.',60);continue;}
      if(flag==='late_start'&&reasons.some(reason=>reason.code==='start_difference'))continue;
      if(flag==='long_break'&&(reasons.some(reason=>reason.code==='pause')||expectedPause!==null&&entry.breakMinutes===expectedPause))continue;
      if(flag==='overtime'&&reasons.some(reason=>['start_difference','end_difference','pause'].includes(reason.code)))continue;
      const label={late_start:'Sen start.',overtime:'Ekstra arbejdstid.',long_break:'Lang pause.',overlap:'Registreringen overlapper en anden vagt.',dst_transition:'Skift mellem sommer- og vintertid skal afklares.'}[flag];
      add(knownFlags.has(flag)?flag:'unknown_flag',label||'Registreringen har en advarsel, der skal gennemgås.',flag==='overlap'||flag==='dst_transition'||!knownFlags.has(flag)?100:60);
    }
    if(canViewPayroll===true&&entry.end&&(!entry.payroll||entry.payroll.unavailableReason||!Number.isSafeInteger(entry.payroll.totalCents)))add('payroll_missing','Lønaftalen dækker ikke hele registreringen.',30);
    reasons.sort((a,b)=>weights.get(b.code)-weights.get(a.code));
    return {bucket:reasons.length?'attention':'ready',reasons,priority};
  }
  function payroll(entry,resolved,{policyVersion=0,personVersion=0,calculatedAt=new Date().toISOString()}={}){
    const range=span(entry);if(validate(entry).length||!range||hasDSTAmbiguity(entry))return {baseCents:0,supplementCents:0,totalCents:0,lines:[],sourceLabel:'Afventer fuld registrering',policyVersion,personVersion,unavailableReason:hasDSTAmbiguity(entry)?'Skift mellem sommer- og vintertid kræver præcise UTC-tidspunkter og planlæggerens afklaring.':'Afslut og kontrollér tidsregistreringen.'};
    const config=resolved.payroll,pauses=breaks(entry,range),groups=new Map(),monthlyLines=[];
    const agreementFor=day=>config.agreements.filter(a=>a.from<=day).at(-1);
    const available=(s,day)=>day>=s.from&&(s.to===null||day<=s.to)&&s.weekdays.includes(weekday(day));
    function matches(s,day,m){if(s.start===null)return available(s,day);const from=minute(s.start),to=minute(s.end);return to>from?available(s,day)&&m>=from&&m<to:(available(s,day)&&m>=from)||(available(s,addDays(day,-1))&&m<to);}
    function add(id,label,type,rateCents){const key=type+':'+id;let line=groups.get(key);if(!line){line={id:key,label,type,calculation:'hourly',rateCents,minutes:0,amountCents:0};groups.set(key,line);}line.minutes++;}
    let missing=false;
    const exact=entry.timingResolved?exactInstants(entry):null;
    for(let offset=range.start;offset<range.end;offset++){
      if(pauses.some(p=>offset>=p.start&&offset<p.end))continue;
      const instantLocal=exact?localNow(new Date(exact.start+(offset-range.start)*60000)):null;
      const day=instantLocal?.date||addDays(entry.date,Math.floor(offset/1440)),m=instantLocal?minute(instantLocal.time):offset%1440,agreement=agreementFor(day);
      if(!agreement||resolved.missingBasePeriods?.some(p=>day>=p.from&&day<=p.to))missing=true;
      else if(agreement.type==='hourly')add(agreement.id,'Timeløn','base',agreement.amountCents);
      for(const supplement of config.supplements)if(supplement.type==='hourly'&&matches(supplement,day,m))add(supplement.id,supplement.name,'supplement',supplement.amountCents);
    }
    const rounded=(rate,minutes)=>{const value=(BigInt(rate)*BigInt(minutes)+30n)/60n;if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Lønbeløbet er for stort.');return Number(value);};
    const lines=[...groups.values()].map(line=>({...line,quantity:line.minutes/60,amountCents:rounded(line.rateCents,line.minutes)}));
    const agreement=agreementFor(entry.date);if(agreement?.type==='monthly')monthlyLines.push({id:agreement.id,label:'Fast månedsløn',type:'base',calculation:'monthly',amountCents:agreement.amountCents});
    for(const s of config.supplements)if(s.type==='monthly'&&s.from<=entry.date&&(s.to===null||s.to>=entry.date))monthlyLines.push({id:s.id,label:s.name,type:'supplement',calculation:'monthly',amountCents:s.amountCents});
    const safeSum=values=>{const total=values.reduce((n,value)=>n+BigInt(value),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Lønbeløbet er for stort.');return Number(total);};
    const sum=type=>safeSum(lines.filter(l=>l.type===type).map(l=>l.amountCents)),baseCents=sum('base'),supplementCents=sum('supplement');
    const sources=Object.values(resolved.sources?.agreements||{}),personal=sources.some(s=>s.origin==='personal'),personalExtras=Object.values(resolved.sources?.supplements||{}).some(s=>s.origin==='personal'||s.override)||Boolean(resolved.currentLink?.supplementOverrides?.length||resolved.currentLink?.excludedPersonalSupplementIds?.length),group=resolved.currentGroup?.name||resolved.group?.name;
    return {currency:'DKK',baseCents,supplementCents,totalCents:safeSum([baseCents,supplementCents]),lines,monthlyLines,monthlyBaseCents:safeSum(monthlyLines.filter(l=>l.type==='base').map(l=>l.amountCents)),monthlySupplementCents:safeSum(monthlyLines.filter(l=>l.type==='supplement').map(l=>l.amountCents)),sourceLabel:group?(group+(personal?' · personlig grundløn':personalExtras?' · personlige tillæg':'')):personal?'Personlig lønaftale':'Ingen lønaftale',sources:clone(resolved.sources||{}),policyVersion,personVersion,calculatedAt,breakAllocation:entry.breakAllocation||'clocked',...(missing?{unavailableReason:'Der mangler en lønaftale for hele eller dele af arbejdstiden.'}:{})};
  }
  const formatMinutes=value=>{const n=Math.round(Math.abs(value||0));return (value<0?'−':'')+Math.floor(n/60)+' t'+(n%60?' '+n%60+' min':'');};
  const statusLabel=value=>({running:'I gang',paused:'På pause',submitted:'Afventer godkendelse',approved:'Godkendt',rejected:'Afventer afklaring'}[value]||'Ikke startet');
  const flagLabel=value=>({late_start:'Sen start',overtime:'Ekstra tid',long_break:'Lang pause',missing_end:'Mangler afslutning',corrected:'Rettet',employee_comment:'Kommentar',overlap:'Overlap',dst_transition:'Skift mellem sommer- og vintertid'}[value]||value);
  const api=Object.freeze({validDate,validInstant,minute,clock,addDays,localNow,copenhagenOffset,crossesOffsetChange,hasDSTAmbiguity,instantForLocal,absoluteInterval,span,breaks,plannedGrossMinutes,plannedBreak,plannedMinutes,validate,summary,overlaps,review,payroll,formatMinutes,statusLabel,flagLabel});globalThis.CleanRoomsTimekeeping=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
