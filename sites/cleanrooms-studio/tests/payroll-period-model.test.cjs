const test=require('node:test');
const assert=require('node:assert/strict');
const Period=require('../src/payroll-period-model.js');
const Data=require('../src/studio-data.js');
const {validateStudio}=require('../lib/studio-store.mjs');

test('payroll period keeps the legacy default and validates explicit company boundaries',()=>{
  assert.deepEqual(Period.normalize(),{startDay:26});
  assert.deepEqual(Data.payrollPeriodFor({}),{startDay:26});
  assert.deepEqual(Data.payrollPeriodFor({workspaceSettings:{payrollPeriod:{startDay:1}}}),{startDay:1});
  for(const value of [null,{},[],{startDay:0},{startDay:32},{startDay:1.5},{startDay:'26'},{startDay:26,extra:true}]){
    assert.equal(Period.valid(value),false);assert.throws(()=>Period.normalize(value),RangeError);
  }
});

test('monthly periods contain the selected date and navigate across calendar years',()=>{
  assert.deepEqual(Period.periodFor('2026-11-25'),{from:'2026-10-26',to:'2026-11-25'});
  assert.deepEqual(Period.periodFor('2026-11-26'),{from:'2026-11-26',to:'2026-12-25'});
  assert.deepEqual(Period.periodFor('2026-12-31',{startDay:1},1),{from:'2027-01-01',to:'2027-01-31'});
  assert.deepEqual(Period.periodFor('2027-01-01',{startDay:26},-1),{from:'2026-11-26',to:'2026-12-25'});
  assert.deepEqual(Period.periodFor('2028-02-18',{startDay:1}),{from:'2028-02-01',to:'2028-02-29'});
});

test('29th–31st boundaries clamp independently without gaps or overlapping periods',()=>{
  for(const startDay of [29,30,31]){
    for(const day of ['2027-01-31','2027-02-28','2027-03-30','2028-02-29']){
      const current=Period.periodFor(day,{startDay}),next=Period.periodFor(day,{startDay},1);
      assert.ok(current.from<=day&&day<=current.to);
      const afterEnd=new Date(current.to+'T00:00:00Z');afterEnd.setUTCDate(afterEnd.getUTCDate()+1);
      assert.equal(afterEnd.toISOString().slice(0,10),next.from);
    }
  }
  assert.deepEqual(Period.periodFor('2027-03-30',{startDay:31}),{from:'2027-02-28',to:'2027-03-30'});
  assert.deepEqual(Period.periodFor('2028-02-28',{startDay:31}),{from:'2028-01-31',to:'2028-02-28'});
  assert.deepEqual(Period.periodFor('2028-02-29',{startDay:31}),{from:'2028-02-29',to:'2028-03-30'});
  for(const date of ['2027-02-29','2028-02-30','2026-13-01','not-a-date'])assert.throws(()=>Period.periodFor(date),RangeError);
});

test('studio accepts only a valid optional payroll-period setting',()=>{
  const base={storageVersion:1,series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[]};
  const input={...base,workspaceSettings:{companyName:'Example',payrollPeriod:{startDay:31}}};
  assert.deepEqual(validateStudio(input),input);
  for(const value of [null,{}, {startDay:0},{startDay:32},{startDay:'1'},{startDay:1,untrusted:true}]){
    assert.throws(()=>validateStudio({...base,workspaceSettings:{payrollPeriod:value}}),{code:'invalid_studio'});
  }
});
