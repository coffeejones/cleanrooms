/* Closed daily allocation is authoritative; open coverage uses complete pay cycles. */
import {StudioError,readRawStudio} from './studio-store.mjs';
import Time from '../src/timekeeping-model.js';
import Period from '../src/payroll-period-model.js';
import Groups from '../src/payroll-groups-model.js';
import {monthlyPeriodPay,clipMonthlyAllocation} from './payroll-fixed-period.mjs';
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results??[];
const first=async(...args)=>(await all(...args))[0]??null;
const fail=()=>{throw new StudioError(503,'mobile_monthly_allocation_invalid','Lønperiodens fastlåste fordeling kunne ikke læses sikkert. Kontakt planlæggeren.');};
const days=(from,to)=>{const result=[];for(let date=from;date<=to;date=Time.addDays(date,1))result.push(date);return result;};
function validCycle(period){return Time.validDate(period.period_from)&&Time.validDate(period.period_to)&&period.period_from<=period.period_to&&(Date.parse(period.period_to)-Date.parse(period.period_from))/86400000<32;}

export async function readEmployeeMonthlyPay({db,workspaceId,personId,from,to,policy,payroll}){
 const periods=await all(db,'SELECT period_from,period_to,status,version,revision,updated_at FROM workspace_payroll_periods WHERE workspace_id=? AND period_from<=? AND period_to>=? ORDER BY period_from,period_to',workspaceId,to,from),closed=periods.filter(period=>period.status==='closed'),covered=new Set(),result=[];
 const selectedDates=days(from,to),mark=period=>{for(const date of selectedDates)if(date>=period.period_from&&date<=period.period_to)covered.add(date);};
 function add(line){if(!line)return;if(result.length>=5000)throw new StudioError(413,'mobile_monthly_period_full','Vælg et kortere interval for at se alle løndele.');result.push(line);}
 for(let index=0;index<closed.length;index++){
  const period=closed[index];if(!validCycle(period)||index>0&&closed[index-1].period_to>=period.period_from)fail();
  let after='';
  for(;;){const page=await all(db,`SELECT row.row_id,row.config FROM workspace_payroll_export_rows row INDEXED BY workspace_payroll_export_person
   WHERE row.workspace_id=? AND row.period_from=? AND row.period_to=? AND row.revision=? AND json_extract(row.config,'$.employeeId')=?
    AND json_extract(row.config,'$.lineKind') IN ('monthly_base','monthly_supplement') AND row.row_id>? ORDER BY row.row_id LIMIT 200`,workspaceId,period.period_from,period.period_to,period.revision,personId,after);
   for(const row of page){let value;try{value=JSON.parse(row.config);const line={label:value.label,type:value.lineKind==='monthly_base'?'base':'supplement',calculation:'monthly',from:value.from,to:value.to,rateCents:value.rateCents,days:value.days,cycleDays:value.cycleDays??value.monthDays,amountCents:value.amountCents,quantity:value.quantity,allocationBasis:value.allocationBasis??'payroll-cycle',cycleFrom:value.cycleFrom??period.period_from,cycleTo:value.cycleTo??period.period_to,allocationVersion:value.allocationVersion??undefined,allocationAmountCents:value.allocationAmountCents??undefined,allocationDays:value.allocationDays??undefined,allocationSegments:value.allocationSegments??undefined};add(clipMonthlyAllocation(line,from,to));}catch(error){if(error instanceof StudioError)throw error;fail();}}
   if(page.length<200)break;after=page.at(-1).row_id;
  }
  // Even a person with no frozen monthly rows has closed coverage worth zero.
  // A later imported salary must not create new money in an already closed period.
  mark(period);
 }
 const estimate=period=>{
  if(!validCycle(period))fail();
  if(!selectedDates.some(date=>date>=period.period_from&&date<=period.period_to&&!covered.has(date)))return;
  const resolved=Groups.resolve({policy,personId,payroll,from:period.period_from,to:period.period_to});
  for(const line of monthlyPeriodPay(resolved,period.period_from,period.period_to))add(clipMonthlyAllocation(line,from,to,covered));
  mark(period);
 };
 // A reopened historical cycle retains its original boundaries even if the
 // company's start day changed later. Prefer the explicitly selected exact cycle.
 const opened=periods.filter(period=>period.status==='open').sort((a,b)=>Number(b.period_from===from&&b.period_to===to)-Number(a.period_from===from&&a.period_to===to)||b.updated_at.localeCompare(a.updated_at));
 for(const period of opened)estimate(period);
 if(covered.size<selectedDates.length){
  const company=await first(db,'SELECT snapshot_owner_id FROM workspaces WHERE id=?',workspaceId);if(!company)throw new StudioError(403,'mobile_employee_inactive','Virksomheden findes ikke længere.');
  const metadata=await readRawStudio(db,company.snapshot_owner_id),config=Period.normalize(metadata.studio?.workspaceSettings?.payrollPeriod);
  let cycle=Period.periodFor(from,config);
  while(cycle.from<=to){estimate({period_from:cycle.from,period_to:cycle.to});if(cycle.to>=to)break;cycle=Period.periodFor(Time.addDays(cycle.to,1),config);}
 }
 return result.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.type.localeCompare(b.type)||a.label.localeCompare(b.label));
}
