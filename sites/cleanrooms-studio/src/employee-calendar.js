/* Date periods and time placement shared by the employee calendar views. */
(() => {
  'use strict';

  const DAY = 86400000,MIN_DATE = '0001-01-01',MAX_DATE = '9999-12-31';
  const VIEWS = new Set(['month','week','day']);
  const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const minutes = value => Number(value.slice(0,2))*60+Number(value.slice(3));
  function parse(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year,month,day] = value.split('-').map(Number),date = new Date(0);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    date.setUTCHours(12,0,0,0);date.setUTCFullYear(year,month-1,day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day ? date : null;
  }
  const validDate = value => Boolean(parse(value));
  function iso(value) {
    if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) throw new RangeError('Kalenderperioden ligger uden for det understøttede datointerval.');
    return value.toISOString().slice(0,10);
  }
  function requireDate(value) {
    const date = parse(value);if (!date) throw new TypeError('Vælg en gyldig dato i formatet ÅÅÅÅ-MM-DD.');return date;
  }
  function requireView(view) { if (!VIEWS.has(view)) throw new TypeError('Vælg måned, uge eller dag.'); }
  function addDays(value,count) { const date=requireDate(value);date.setUTCDate(date.getUTCDate()+count);return iso(date); }
  const mondayOffset = date => (date.getUTCDay()+6)%7;

  function clamp(value,minDate=MIN_DATE,maxDate=MAX_DATE) {
    requireDate(value);requireDate(minDate);requireDate(maxDate);
    if (minDate > maxDate) throw new RangeError('Kalenderens slutdato skal være på eller efter startdatoen.');
    return value < minDate ? minDate : value > maxDate ? maxDate : value;
  }

  function isoWeek(value) {
    const thursday=requireDate(value);thursday.setUTCDate(thursday.getUTCDate()+3-mondayOffset(thursday));
    const year=thursday.getUTCFullYear(),first=new Date(0);first.setUTCHours(12,0,0,0);first.setUTCFullYear(year,0,1);
    return {year,week:Math.ceil(((thursday-first)/DAY+1)/7)};
  }

  function range(view,focusDate) {
    requireView(view);const focus=requireDate(focusDate);
    let from=focusDate,to=focusDate,periodFrom=focusDate,periodTo=focusDate;
    if (view === 'month') {
      const first=new Date(focus),last=new Date(focus);first.setUTCDate(1);last.setUTCFullYear(focus.getUTCFullYear(),focus.getUTCMonth()+1,0);
      periodFrom=iso(first);periodTo=iso(last);
      from=addDays(periodFrom,-mondayOffset(first));to=addDays(periodTo,6-mondayOffset(last));
    } else if (view === 'week') {
      from=addDays(focusDate,-mondayOffset(focus));to=addDays(from,6);periodFrom=from;periodTo=to;
    }
    const count=Math.round((requireDate(to)-requireDate(from))/DAY)+1;
    const days=Array.from({length:count},(_,index)=>addDays(from,index));
    return {view,focusDate,from,to,days,periodFrom,periodTo,weeks:Math.ceil(count/7),isoWeek:isoWeek(focusDate)};
  }

  function navigate(view,focusDate,delta) {
    requireView(view);const focus=requireDate(focusDate);
    if (!Number.isSafeInteger(delta)) throw new TypeError('Antallet af kalenderperioder skal være et helt tal.');
    if (view === 'month') {
      const index=focus.getUTCFullYear()*12+focus.getUTCMonth()+delta,year=Math.floor(index/12),month=((index%12)+12)%12;
      if (year < 1) return MIN_DATE;if (year > 9999) return MAX_DATE;
      const last=new Date(focus);last.setUTCFullYear(year,month+1,0);
      focus.setUTCDate(1);focus.setUTCFullYear(year,month,Math.min(Number(focusDate.slice(-2)),last.getUTCDate()));
      return iso(focus);
    }
    const target=focus.getTime()+delta*(view === 'week' ? 7 : 1)*DAY;
    if (target < parse(MIN_DATE).getTime()) return MIN_DATE;
    if (target > parse(MAX_DATE).getTime()) return MAX_DATE;
    return iso(new Date(target));
  }

  function canNavigate(view,focusDate,delta,minDate=MIN_DATE,maxDate=MAX_DATE) {
    const current=clamp(focusDate,minDate,maxDate),next=clamp(navigate(view,current,delta),minDate,maxDate);
    try { return range(view,current).periodFrom !== range(view,next).periodFrom; }
    catch (error) { if (error instanceof RangeError) return false;throw error; }
  }

  function layout(shifts,day) {
    const errors=[],empty=()=>({valid:false,errors,startMinute:360,endMinute:1320,totalMinutes:960,items:[]});
    if (!validDate(day)) errors.push('Vælg en gyldig dato for tidsvisningen.');
    if (!Array.isArray(shifts)) { errors.push('Vagterne skal være en liste.');return empty(); }
    const ids=new Set();
    for (const shift of shifts) {
      if (!shift || typeof shift !== 'object' || typeof shift.id !== 'string' || !shift.id.trim() || !validDate(shift.date)
        || !time(shift.start) || !time(shift.end) || shift.end <= shift.start) errors.push('En vagt har ugyldig dato, tid eller identitet.');
      else if (ids.has(shift.id)) errors.push('Vagt-id forekommer flere gange: '+shift.id);
      else ids.add(shift.id);
    }
    if (errors.length) return empty();
    const startMinute=Math.min(360,...shifts.map(shift=>Math.floor(minutes(shift.start)/60)*60));
    const endMinute=Math.max(1320,...shifts.map(shift=>Math.ceil(minutes(shift.end)/60)*60)),totalMinutes=endMinute-startMinute;
    const ordered=shifts.filter(shift=>shift.date===day).slice().sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end)||(a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const items=[];let cluster=[],laneEnds=[],clusterEnd=-1;
    function finish() {
      for (const item of cluster) { item.laneCount=laneEnds.length;item.left=item.lane/item.laneCount;item.width=1/item.laneCount; }
      cluster=[];laneEnds=[];clusterEnd=-1;
    }
    for (const shift of ordered) {
      const start=minutes(shift.start),end=minutes(shift.end);
      if (cluster.length && start >= clusterEnd) finish();
      let lane=laneEnds.findIndex(value=>value<=start);if (lane<0) lane=laneEnds.length;
      laneEnds[lane]=end;clusterEnd=Math.max(clusterEnd,end);
      const item={shift,id:shift.id,date:shift.date,startMinute:start,endMinute:end,durationMinutes:end-start,lane,laneCount:1,
        top:(start-startMinute)/totalMinutes,height:(end-start)/totalMinutes,left:0,width:1};
      cluster.push(item);items.push(item);
    }
    finish();return {valid:true,errors:[],startMinute,endMinute,totalMinutes,items};
  }

  const api=Object.freeze({MIN_DATE,MAX_DATE,validDate,clamp,isoWeek,range,navigate,canNavigate,layout});
  globalThis.CleanRoomsEmployeeCalendar=api;
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
})();
