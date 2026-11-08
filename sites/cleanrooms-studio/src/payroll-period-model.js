/* Calendar-month payroll periods share one boundary rule across web and mobile. */
(() => {
  'use strict';
  const defaultStartDay=26;
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  function valid(value) {
    return record(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'startDay')
      &&Number.isSafeInteger(value.startDay)&&value.startDay>=1&&value.startDay<=31;
  }
  function normalize(value) {
    if(value===undefined)return {startDay:defaultStartDay};
    if(!valid(value))throw new RangeError('Vælg en startdag fra 1 til 31.');
    return {startDay:value.startDay};
  }
  function utc(year,month,day) {
    const result=new Date(0);result.setUTCHours(0,0,0,0);result.setUTCFullYear(year,month,day);return result;
  }
  function iso(value) {
    if(value.getUTCFullYear()<1||value.getUTCFullYear()>9999)throw new RangeError('Lønperioden ligger uden for de understøttede datoer.');
    return value.toISOString().slice(0,10);
  }
  function start(year,month,day) {
    const monthStart=utc(year,month,1),last=utc(year,month+1,0).getUTCDate();
    return utc(monthStart.getUTCFullYear(),monthStart.getUTCMonth(),Math.min(day,last));
  }
  function periodFor(date,config,offset=0) {
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new RangeError('Vælg en gyldig dato.');
    const [year,month,day]=date.split('-').map(Number),instant=utc(year,month-1,day);
    if(iso(instant)!==date||!Number.isSafeInteger(offset)||Math.abs(offset)>120000)throw new RangeError('Vælg en gyldig dato og periode.');
    const {startDay}=normalize(config);
    const monthIndex=month-1-(instant<start(year,month-1,startDay)?1:0)+offset;
    const from=start(year,monthIndex,startDay),next=start(year,monthIndex+1,startDay);
    next.setUTCDate(next.getUTCDate()-1);
    return {from:iso(from),to:iso(next)};
  }
  const api=Object.freeze({defaultStartDay,valid,normalize,periodFor});
  globalThis.CleanRoomsPayrollPeriod=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
