const test=require('node:test'),assert=require('node:assert/strict');
const {monthlyPeriodPay}=require('../lib/payroll-fixed-period.mjs');
const resolved=(agreements,supplements=[])=>({payroll:{agreements,supplements}});
const salary=(from,amountCents,id='salary')=>({id,from,type:'monthly',amountCents});
const total=lines=>lines.reduce((n,l)=>n+l.amountCents,0);

test('one unchanged monthly salary is paid once across unequal months, leap February and year boundary',()=>{
 for(const [from,to,days] of [['2090-01-26','2090-02-25',31],['2090-02-26','2090-03-25',28],['2092-02-26','2092-03-25',29],['2089-12-26','2090-01-25',31],['2090-04-26','2090-05-25',30]]){
  const lines=monthlyPeriodPay(resolved([salary('2080-01-01',3100001)]),from,to);assert.equal(total(lines),3100001,from);assert.equal(lines.length,1);assert.equal(lines[0].cycleDays,days);assert.equal(lines[0].days,days);assert.equal(lines[0].quantity,1);assert.equal(lines[0].allocationBasis,'payroll-cycle');
 }
});
test('effective salary changes are weighted by days in the configured cycle, not calendar month lengths',()=>{
 const lines=monthlyPeriodPay(resolved([salary('2090-01-01',3100000),salary('2090-02-10',6200000,'new')]),'2090-01-26','2090-02-25');assert.equal(lines.length,2);assert.deepEqual(lines.map(line=>line.days),[15,16]);assert.equal(total(lines),4700000);assert.equal(lines.reduce((n,l)=>n+l.quantity,0),1);assert.deepEqual(lines.map(l=>l.cycleDays),[31,31]);
});
test('monthly allowances are included once and partial active dates use cycle days; integer allocation is deterministic',()=>{
 const config=resolved([salary('2090-01-01',3100000)],[{id:'fixed-service',name:'Fast tillæg',from:'2090-02-05',to:'2090-02-10',type:'monthly',amountCents:310000}]),lines=monthlyPeriodPay(config,'2090-01-26','2090-02-25');assert.equal(total(lines),3160000);const allowance=lines.find(l=>l.type==='supplement');assert.equal(allowance.days,6);assert.equal(allowance.amountCents,60000);assert.equal(allowance.quantity,6/31);
 const changedId=resolved([salary('2090-01-01',1,'first'),salary('2090-03-12',1,'renamed')]),a=monthlyPeriodPay(changedId,'2090-02-26','2090-03-25');assert.equal(total(a),1);assert.deepEqual(monthlyPeriodPay(changedId,'2090-02-26','2090-03-25'),a);assert.equal(a.reduce((n,l)=>n+l.days,0),28);
});
test('invalid ranges and unsafe monetary inputs are rejected',()=>{assert.throws(()=>monthlyPeriodPay(resolved([]),'2090-02-30','2090-03-25'));assert.throws(()=>monthlyPeriodPay(resolved([]),'2090-01-01','2090-03-31'));assert.throws(()=>monthlyPeriodPay(resolved([salary('2080-01-01',1.5)]),'2090-01-26','2090-02-25'));});

const {clipMonthlyAllocation}=require('../lib/payroll-fixed-period.mjs');
const Time=require('../src/timekeeping-model.js');
test('frozen day allocation conserves every cent over arbitrary splits, leap February and dated rate changes',()=>{
 for(const [from,to] of [['2090-01-26','2090-02-25'],['2090-02-26','2090-03-25'],['2092-02-26','2092-03-25'],['2089-12-26','2090-01-25']]){
  const change=Time.addDays(from,12),lines=monthlyPeriodPay(resolved([salary('2080-01-01',3100001),salary(change,4700003,'changed')],[{id:'extra',name:'Fast tillæg',from:Time.addDays(from,5),to:Time.addDays(to,-3),type:'monthly',amountCents:120001}]),from,to);
  for(let split=from;split<to;split=Time.addDays(split,1))for(const line of lines){const left=clipMonthlyAllocation(line,from,split),right=clipMonthlyAllocation(line,Time.addDays(split,1),to);assert.equal((left?.amountCents??0)+(right?.amountCents??0),line.amountCents,from+' split '+split);}
 }
});
test('allocation metadata preserves non-contiguous active dates and never pays inactive gaps',()=>{
 const config=resolved([salary('2090-01-01',3100000,'reused'),{id:'hourly-gap',from:'2090-02-01',type:'hourly',amountCents:20000},salary('2090-02-05',3100000,'reused')]),lines=monthlyPeriodPay(config,'2090-01-26','2090-02-25');assert.equal(lines.length,1);assert.equal(lines[0].days,27);assert.deepEqual(lines[0].allocationSegments,[{from:'2090-01-26',to:'2090-01-31'},{from:'2090-02-05',to:'2090-02-25'}]);assert.equal(clipMonthlyAllocation(lines[0],'2090-02-01','2090-02-04'),null);assert.equal(clipMonthlyAllocation(lines[0],'2090-01-26','2090-02-25').amountCents,2700000);
 const left=clipMonthlyAllocation(lines[0],'2090-01-26','2090-02-10'),right=clipMonthlyAllocation(lines[0],'2090-02-11','2090-02-25');assert.equal(left.amountCents+right.amountCents,2700000);
});
