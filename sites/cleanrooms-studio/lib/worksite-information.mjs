/* Current access guidance is tied to current/upcoming work, not a historic job. */
import Time from '../src/timekeeping-model.js';
import Series from '../src/series-engine.js';
export function mayReadWorksiteInfo(shift,{today=Time.localNow().date,preview=false,entry=null}={}){
  if(preview)return true;
  if(entry&&['running','paused'].includes(entry.status))return true;
  return Time.validDate(shift?.date)&&Time.validDate(today)&&(shift.date>=today||Series.shiftDates(shift).includes(today));
}
