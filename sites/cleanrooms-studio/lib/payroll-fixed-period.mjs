/* A configured monthly pay cycle pays one monthly rate, regardless of month lengths. */
import Time from '../src/timekeeping-model.js';
const safe=value=>Number.isSafeInteger(value)&&value>=0;
export function monthlyPeriodPay(resolved,from,to){
 if(!Time.validDate(from)||!Time.validDate(to)||from>to)throw new RangeError('Vælg en gyldig lønperiode.');
 const cycleDays=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 if(cycleDays>32)throw new RangeError('Vælg én hel månedlig lønperiode.');
 const groups=new Map();
 for(let day=from;day<=to;day=Time.addDays(day,1)){
  const agreement=resolved.payroll.agreements.filter(item=>item.from<=day).at(-1);
  const components=[...(agreement?.type==='monthly'?[{...agreement,label:'Fast månedsløn',kind:'base'}]:[]),...resolved.payroll.supplements.filter(item=>item.type==='monthly'&&item.from<=day&&(!item.to||item.to>=day)).map(item=>({...item,label:item.name,kind:'supplement'}))];
  for(const component of components){if(!safe(component.amountCents))throw new RangeError('Månedsbeløbet er ugyldigt.');const key=JSON.stringify([component.kind,component.id,component.amountCents]),old=groups.get(key);if(old){old.days++;old.to=day;old.activeDates.push(day);}else groups.set(key,{activeDates:[day],label:component.label,type:component.kind,calculation:'monthly',from:day,to:day,rateCents:component.amountCents,days:1,cycleDays,allocationBasis:'payroll-cycle'});}
 }
 // Round the complete cycle once and allocate remaining øre deterministically.
 // Even renamed/replaced agreements at the same rate cannot inflate a full cycle.
 const denominator=BigInt(cycleDays),lines=[...groups.values()].map((line,index)=>{const numerator=BigInt(line.rateCents)*BigInt(line.days);return {line,index,numerator,cents:numerator/denominator,remainder:numerator%denominator};});
 const numerator=lines.reduce((sum,line)=>sum+line.numerator,0n),target=(numerator+denominator/2n)/denominator;
 if(target>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Periodens månedsbeløb er for stort.');
 let remaining=target-lines.reduce((sum,line)=>sum+line.cents,0n);
 const ranked=[...lines].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
 for(const item of ranked){if(remaining<=0n)break;item.cents++;remaining--;}
 return lines.map(({line,cents})=>{const {activeDates,...value}=line;return {...value,quantity:value.days/cycleDays,amountCents:Number(cents),cycleFrom:from,cycleTo:to,allocationVersion:1,allocationAmountCents:Number(cents),allocationDays:activeDates.length,allocationSegments:dateSegments(activeDates)};});
}


/** Compact, ordered active dates preserve gaps and dated allowance changes. */
function dateSegments(dates){const result=[];for(const date of dates){const prior=result.at(-1);if(prior&&Time.addDays(prior.to,1)===date)prior.to=date;else result.push({from:date,to:date});}return result;}
function segmentDates(segments){
 if(!Array.isArray(segments)||segments.length>32)throw new RangeError('Lønfordelingen kunne ikke læses sikkert.');
 const dates=[];
 for(const segment of segments){if(!segment||!Time.validDate(segment.from)||!Time.validDate(segment.to)||segment.from>segment.to)throw new RangeError('Lønfordelingen har ugyldige datoer.');
  for(let date=segment.from;;date=Time.addDays(date,1)){if(dates.length>=32||dates.length&&date<=dates.at(-1))throw new RangeError('Lønfordelingens datoer overlapper.');dates.push(date);if(date===segment.to)break;}
 }
 return dates;
}

/** Clip frozen integer cents; never resolve current rates for already closed dates.
 * Cumulative rounding distributes the original amount across its active days.
 * Every date has one fixed amount, so arbitrary disjoint subsets recombine exactly.
 */
export function clipMonthlyAllocation(line,from,to,excludedDates=new Set()){
 if(!Time.validDate(from)||!Time.validDate(to)||from>to)throw new RangeError('Vælg et gyldigt datointerval.');
 if(line.allocationVersion!==undefined&&line.allocationVersion!==1)throw new RangeError('Lønfordelingens version understøttes ikke.');
 const segments=line.allocationSegments??[{from:line.from,to:line.to}],dates=segmentDates(segments),amount=line.allocationAmountCents??line.amountCents;
 if(!safe(amount)||!dates.length||line.allocationDays!==undefined&&line.allocationDays!==dates.length||line.allocationDays===undefined&&line.days!==dates.length)throw new RangeError('Den fastlåste lønfordeling kunne ikke bekræftes.');
 const denominator=BigInt(dates.length),cents=BigInt(amount),rounded=n=>(cents*BigInt(n)+denominator/2n)/denominator;
 const selected=[];let total=0n;
 dates.forEach((date,index)=>{if(date>=from&&date<=to&&!excludedDates.has(date)){selected.push(date);total+=rounded(index+1)-rounded(index);}});
 if(!selected.length)return null;
 const cycleDays=line.cycleDays??line.monthDays;
 if(!Number.isSafeInteger(cycleDays)||cycleDays<dates.length||cycleDays>32)throw new RangeError('Lønperiodens fordelingsgrundlag er ugyldigt.');
 return {...line,from:selected[0],to:selected.at(-1),days:selected.length,quantity:selected.length/cycleDays,amountCents:Number(total),cycleDays,monthDays:cycleDays,
  allocationVersion:1,allocationAmountCents:amount,allocationDays:dates.length,allocationSegments:segments};
}
