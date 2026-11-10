/* Identical blocker rules for closing and the planner's filtered review list. */
import Time from '../src/timekeeping-model.js';

const safe=value=>Number.isSafeInteger(value)&&value>=0;
export const payrollProblemKeys=Object.freeze(['unapproved','invalid_time','missing_payroll']);

export function completeApprovedPayroll(pay){
  if(!pay||pay.unavailableReason||pay.currency!==undefined&&pay.currency!=='DKK'||!safe(pay.baseCents)||!safe(pay.supplementCents)||!safe(pay.totalCents)||BigInt(pay.baseCents)+BigInt(pay.supplementCents)!==BigInt(pay.totalCents)||!Array.isArray(pay.lines))return false;
  let base=0n,supplement=0n;
  for(const line of pay.lines){
    if(!line||!['base','supplement'].includes(line.type)||typeof line.label!=='string'||line.quantity!==undefined&&(!Number.isFinite(line.quantity)||line.quantity<0||line.quantity>Number.MAX_SAFE_INTEGER)||line.calculation!==undefined&&(typeof line.calculation!=='string'||line.calculation.length>40)||!safe(line.amountCents)||!safe(line.minutes)||!safe(line.rateCents))return false;
    if(line.type==='base')base+=BigInt(line.amountCents);else supplement+=BigInt(line.amountCents);
  }
  return base===BigInt(pay.baseCents)&&supplement===BigInt(pay.supplementCents);
}

export function classifyPayrollEntry(entry,{overlap=false,now=Date.now()}={}){
  if(entry.status!=='approved')return 'unapproved';
  const interval=Time.absoluteInterval(entry),summary=Time.summary(entry);
  if(overlap||Time.validate(entry).length||Time.hasDSTAmbiguity(entry)||!interval||interval.end>now||!safe(summary.workedMinutes))return 'invalid_time';
  return completeApprovedPayroll(entry.payroll)?null:'missing_payroll';
}
