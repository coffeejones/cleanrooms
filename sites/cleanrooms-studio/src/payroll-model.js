/* Planned gross amounts only. No attendance, tax, pension or statutory assumptions. */
(() => {
  'use strict';
  const DAY=86400000,MAX_COMPONENTS=1000;
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const text=(value,limit)=>typeof value==='string'&&value.length>0&&value===value.trim()&&value.length<=limit&&!/[\u0000-\u001f\u007f]/.test(value);
  const time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
  const clock=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const order=(a,b)=>compare(a.date,b.date)||compare(a.start,b.start)||compare(a.end,b.end)||compare(a.id,b.id);
  const exactKeys=(value,keys)=>Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(value,key));
  function date(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [year,month,day]=value.split('-').map(Number),result=new Date(0);
    if(year<1||month<1||month>12||day<1||day>31)return null;
    result.setUTCHours(12,0,0,0);result.setUTCFullYear(year,month-1,day);
    return result.getUTCFullYear()===year&&result.getUTCMonth()===month-1&&result.getUTCDate()===day?result:null;
  }
  const iso=value=>value.getUTCFullYear()<1||value.getUTCFullYear()>9999?null:value.toISOString().slice(0,10);
  function addDays(value,count){const result=date(value);result.setUTCDate(result.getUTCDate()+count);return iso(result);}
  const days=(from,to)=>Math.round((date(to)-date(from))/DAY)+1;
  const weekday=value=>(date(value).getUTCDay()+6)%7;
  function safe(value){if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Det beregnede beløb er for stort til at kunne vises sikkert.');return Number(value);}
  const rounded=(numerator,denominator)=>safe((numerator*2n+denominator)/(denominator*2n));
  const amount=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

  function validate(config){
    if(config==null)return [];
    const errors=[];
    if(!record(config))return ['Lønopsætningen skal være et objekt.'];
    if(!exactKeys(config,['currency','agreements','supplements']))errors.push('Lønopsætningen skal indeholde præcis valuta, aftaler og tillæg.');
    if(config.currency!=='DKK')errors.push('Valutaen skal være DKK.');
    for(const [key,label] of [['agreements','Lønaftaler'],['supplements','Tillæg']])if(!Array.isArray(config[key])||config[key].length>MAX_COMPONENTS)errors.push(label+' skal være en liste med højst '+MAX_COMPONENTS+' poster.');
    const ids=new Set(),starts=new Set();
    if(Array.isArray(config.agreements))config.agreements.forEach((agreement,index)=>{
      const label='Lønaftale '+(index+1)+': ';
      if(!record(agreement)){errors.push(label+'Oplysningerne er ugyldige.');return;}
      if(!exactKeys(agreement,['id','from','type','amountCents']))errors.push(label+'Aftalen skal indeholde præcis id, startdato, type og beløb.');
      if(!text(agreement.id,160)||ids.has(agreement.id))errors.push(label+'Vælg et entydigt id på højst 160 tegn.');else ids.add(agreement.id);
      if(!date(agreement.from)||starts.has(agreement.from))errors.push(label+'Startdatoen skal være gyldig og forskellig fra andre aftalers startdato.');else starts.add(agreement.from);
      if(!['hourly','monthly'].includes(agreement.type))errors.push(label+'Vælg timeløn eller månedsløn.');
      if(!amount(agreement.amountCents))errors.push(label+'Beløbet skal være et ikke-negativt helt antal øre inden for et sikkert talinterval.');
    });
    ids.clear();
    if(Array.isArray(config.supplements))config.supplements.forEach((supplement,index)=>{
      const label='Tillæg '+(index+1)+': ';
      if(!record(supplement)){errors.push(label+'Oplysningerne er ugyldige.');return;}
      if(!exactKeys(supplement,['id','name','type','amountCents','from','to','weekdays','start','end']))errors.push(label+'Tillægget skal indeholde præcis id, navn, type, beløb, gyldighed, ugedage og tidsrum.');
      if(!text(supplement.id,160)||ids.has(supplement.id))errors.push(label+'Vælg et entydigt id på højst 160 tegn.');else ids.add(supplement.id);
      if(!text(supplement.name,120))errors.push(label+'Navnet skal være udfyldt uden ydre mellemrum og højst være 120 tegn.');
      if(!amount(supplement.amountCents))errors.push(label+'Beløbet skal være et ikke-negativt helt antal øre inden for et sikkert talinterval.');
      if(!date(supplement.from)||supplement.to!==null&&(!date(supplement.to)||supplement.to<supplement.from))errors.push(label+'Vælg en gyldig startdato og en eventuel slutdato på eller efter startdatoen.');
      if(!['hourly','monthly'].includes(supplement.type))errors.push(label+'Vælg tillæg pr. time eller pr. måned.');
      if(supplement.type==='monthly'){
        if(!Array.isArray(supplement.weekdays)||supplement.weekdays.length||supplement.start!==null||supplement.end!==null)errors.push(label+'Et månedligt tillæg skal have tomme ugedage og intet tidsrum.');
      }else if(supplement.type==='hourly'){
        if(!Array.isArray(supplement.weekdays)||!supplement.weekdays.length||supplement.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(supplement.weekdays).size!==supplement.weekdays.length)errors.push(label+'Vælg mindst én entydig ugedag fra mandag til søndag.');
        if(!(supplement.start===null&&supplement.end===null)&&(!time(supplement.start)||!time(supplement.end)||supplement.start===supplement.end))errors.push(label+'Vælg enten hele dagen eller to forskellige gyldige klokkeslæt.');
      }
    });
    return errors;
  }
  function normalize(config){
    if(config==null)return {currency:'DKK',agreements:[],supplements:[]};
    const errors=validate(config);if(errors.length)throw new TypeError(errors.join(' '));
    return {currency:'DKK',agreements:config.agreements.map(clone).sort((a,b)=>compare(a.from,b.from)||compare(a.id,b.id)),
      supplements:config.supplements.map(value=>({...clone(value),weekdays:[...value.weekdays].sort((a,b)=>a-b)})).sort((a,b)=>compare(a.from,b.from)||compare(a.id,b.id))};
  }
  function same(a,b){
    if(a===b)return true;
    if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>same(value,b[index]));
    if(!record(a)||!record(b))return false;
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);
    return [...keys].every(key=>same(['note','noteRich','seriesId'].includes(key)?a[key]??'':a[key],['note','noteRich','seriesId'].includes(key)?b[key]??'':b[key]));
  }
  function validateHistory(before,after,today){
    if(!date(today))throw new TypeError('Vælg en gyldig dato for lønændringen.');
    if(before==null)return [];
    const cutoff=addDays(today,-1),past=value=>{
      const config=normalize(value);
      return {agreements:config.agreements.filter(item=>item.from<today),supplements:config.supplements.filter(item=>item.from<today).map(item=>({...item,to:item.to===null||item.to>cutoff?cutoff:item.to}))};
    };
    return same(past(before),past(after))?[]:['Tidligere grundløn og tillæg kan ikke ændres eller fjernes. Opret en ny ændring fra i dag eller senere; afslut et løbende tillæg fra denne dato.'];
  }
  function supplementMinutes(supplement,shift){
    const within=anchor=>anchor&&anchor>=supplement.from&&(supplement.to===null||anchor<=supplement.to)&&supplement.weekdays.includes(weekday(anchor));
    // The planned pause has no placement. Like corrected attendance, the
    // estimate allocates it at the end of the shift, including supplements.
    const start=minute(shift.start),end=minute(shift.end)-(shift.plannedBreakMinutes??0),intersection=(from,to)=>Math.max(0,Math.min(end,to)-Math.max(start,from));
    if(supplement.start===null)return within(shift.date)?end-start:0;
    const windowStart=minute(supplement.start),windowEnd=minute(supplement.end);
    if(windowEnd>windowStart)return within(shift.date)?intersection(windowStart,windowEnd):0;
    return (within(shift.date)?intersection(windowStart,1440):0)+(within(addDays(shift.date,-1))?intersection(0,windowEnd):0);
  }
  function estimate({config,personId,month,shifts=[]}={}){
    const normalized=normalize(config);
    if(!text(personId,160))throw new TypeError('Vælg et gyldigt medarbejder-id.');
    if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||!date(month+'-01'))throw new TypeError('Vælg en gyldig måned i formatet ÅÅÅÅ-MM.');
    if(!Array.isArray(shifts))throw new TypeError('Vagterne skal være en liste.');
    const first=date(month+'-01'),last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1,0);
    const from=iso(first),to=iso(last),monthDays=last.getUTCDate(),unique=new Map();
    for(const shift of shifts){
      if(!record(shift)||typeof shift.person!=='string')throw new TypeError('En vagt har ugyldige medarbejderoplysninger.');
      if(shift.person!==personId)continue;
      if(!text(shift.id,500)||!date(shift.date)||!time(shift.start)||!time(shift.end)||shift.end<=shift.start||!Number.isInteger(shift.site)||shift.site<0
        ||['note','noteRich','seriesId'].some(key=>shift[key]!=null&&typeof shift[key]!=='string'))throw new TypeError('En vagt har ugyldigt id, dato, klokkeslæt, arbejdssted eller beskrivelse.');
      if(shift.plannedBreakMinutes!==undefined&&(!Number.isSafeInteger(shift.plannedBreakMinutes)||shift.plannedBreakMinutes<0||shift.plannedBreakMinutes>=minute(shift.end)-minute(shift.start)))throw new TypeError('Den planlagte pause skal være et ikke-negativt helt antal minutter og kortere end vagten.');
      const prior=unique.get(shift.id);if(prior&&!same(prior,shift))throw new TypeError('Samme vagt-id forekommer med forskellige oplysninger. Hent planen igen.');
      if(!prior)unique.set(shift.id,shift);
    }
    const selected=[...unique.values()].filter(shift=>shift.date>=from&&shift.date<=to).sort(order).map(shift=>({...clone(shift),grossMinutes:minute(shift.end)-minute(shift.start),plannedBreakMinutes:shift.plannedBreakMinutes??0,minutes:minute(shift.end)-minute(shift.start)-(shift.plannedBreakMinutes??0),baseCents:0,supplementCents:0,totalCents:0,agreementId:null,baseType:null,supplements:[]}));
    const agreements=normalized.agreements,lines=[],uncovered=new Set(),overlaps=[];
    const agreementFor=day=>{let current=null;for(const agreement of agreements){if(agreement.from>day)break;current=agreement;}return current;};
    for(const shift of selected){const agreement=agreementFor(shift.date);if(!agreement)uncovered.add(shift.date);else{shift.agreementId=agreement.id;shift.baseType=agreement.type;}}
    for(let index=0;index<selected.length;index++)for(let next=index+1;next<selected.length;next++){
      const shift=selected[index],other=selected[next];if(other.date!==shift.date||other.start>=shift.end)break;
      if(shift.start<other.end)overlaps.push({date:shift.date,shiftId:shift.id,otherId:other.id,start:clock(Math.max(minute(shift.start),minute(other.start))),end:clock(Math.min(minute(shift.end),minute(other.end)))});
    }
    function hourly(line,contributions,supplement){
      const units=contributions.map(({shift,minutes})=>{const numerator=BigInt(line.rateCents)*BigInt(minutes);return {shift,minutes,cents:numerator/60n,remainder:numerator%60n};});
      const numerator=units.reduce((sum,item)=>sum+BigInt(line.rateCents)*BigInt(item.minutes),0n);
      line.minutes=units.reduce((sum,item)=>sum+item.minutes,0);line.quantity=line.minutes/60;line.amountCents=rounded(numerator,60n);
      let remaining=BigInt(line.amountCents)-units.reduce((sum,item)=>sum+item.cents,0n);
      const ranked=[...units].sort((a,b)=>a.remainder===b.remainder?order(a.shift,b.shift):a.remainder>b.remainder?-1:1);
      for(const item of ranked){if(remaining<=0n)break;item.cents++;remaining--;}
      for(const item of units){const cents=safe(item.cents);if(supplement){item.shift.supplementCents=safe(BigInt(item.shift.supplementCents)+item.cents);item.shift.supplements.push({id:supplement.id,name:supplement.name,minutes:item.minutes,rateCents:line.rateCents,amountCents:cents});}else item.shift.baseCents=cents;}
      lines.push(line);
    }
    for(let index=0;index<agreements.length;index++){
      const agreement=agreements[index],next=agreements[index+1],periodFrom=agreement.from>from?agreement.from:from,periodTo=next&&next.from<=to?addDays(next.from,-1):to;
      if(periodFrom>periodTo||periodFrom>to)continue;
      const line={id:'base:'+agreement.id,label:agreement.type==='monthly'?'Månedsløn':'Timeløn',type:'base',calculation:agreement.type,agreementId:agreement.id,from:periodFrom,to:periodTo,rateCents:agreement.amountCents,minutes:0,amountCents:0,quantity:0};
      if(agreement.type==='monthly'){line.days=days(periodFrom,periodTo);line.monthDays=monthDays;line.quantity=line.days/monthDays;line.amountCents=rounded(BigInt(agreement.amountCents)*BigInt(line.days),BigInt(monthDays));lines.push(line);}
      else hourly(line,selected.filter(shift=>shift.agreementId===agreement.id).map(shift=>({shift,minutes:shift.minutes})));
    }
    for(const supplement of normalized.supplements){
      if(supplement.type==='monthly'){
        const periodFrom=supplement.from>from?supplement.from:from,periodTo=supplement.to&&supplement.to<to?supplement.to:to;if(periodFrom>periodTo)continue;
        const count=days(periodFrom,periodTo);lines.push({id:'supplement:'+supplement.id,label:supplement.name,type:'supplement',calculation:'monthly',supplementId:supplement.id,from:periodFrom,to:periodTo,rateCents:supplement.amountCents,minutes:0,days:count,monthDays,quantity:count/monthDays,amountCents:rounded(BigInt(supplement.amountCents)*BigInt(count),BigInt(monthDays))});
      }else{
        const contributions=selected.map(shift=>({shift,minutes:supplementMinutes(supplement,shift)})).filter(item=>item.minutes>0);if(!contributions.length)continue;
        hourly({id:'supplement:'+supplement.id,label:supplement.name,type:'supplement',calculation:'hourly',supplementId:supplement.id,from:contributions[0].shift.date,to:contributions.at(-1).shift.date,rateCents:supplement.amountCents},contributions,supplement);
      }
    }
    for(const shift of selected)shift.totalCents=safe(BigInt(shift.baseCents)+BigInt(shift.supplementCents));
    const sum=type=>safe(lines.filter(line=>line.type===type).reduce((total,line)=>total+BigInt(line.amountCents),0n));
    const baseCents=sum('base'),supplementCents=sum('supplement'),activeAgreement=agreementFor(to);
    return {label:'Planlagt løn',currency:'DKK',month,from,to,minutes:selected.reduce((total,shift)=>total+shift.minutes,0),plannedBreakMinutes:selected.reduce((total,shift)=>total+shift.plannedBreakMinutes,0),breakAllocation:'end-of-shift',breakAssumption:'Planlagte pauser er placeret sidst i vagten i dette skøn. Faktisk løn følger de registrerede pauser.',shiftCount:selected.length,baseCents,supplementCents,totalCents:safe(BigInt(baseCents)+BigInt(supplementCents)),
      complete:Boolean(activeAgreement)&&!uncovered.size&&!overlaps.length,uncoveredDates:[...uncovered].sort(),overlaps,lines,shifts:selected,agreements:clone(agreements),activeAgreement:clone(activeAgreement)};
  }
  const api=Object.freeze({normalize,validate,validateHistory,estimate});globalThis.CleanRoomsPayroll=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
