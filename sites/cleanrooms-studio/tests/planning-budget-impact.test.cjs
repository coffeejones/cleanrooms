const test=require('node:test'),assert=require('node:assert/strict');
const Impact=require('../src/planning-budget-impact.js');
const from='2026-11-02',to='2026-11-08';
const shift=(id,site=0,extra={})=>({id,site,date:'2026-11-03',start:'08:00',end:'16:00',person:'p0',...extra});
const input=extra=>({budget:{period:'week',hours:20},from,to,loaded:true,shifts:[shift('a',0,{plannedBreakMinutes:30}),shift('open',1,{person:''})],after:shift('new'),...extra});
test('preview counts open shifts and net unpaid pauses against the selected area',()=>{
 const result=Impact.preview(input({siteIds:[0]}));assert.equal(result.currentMinutes,450);assert.equal(result.deltaMinutes,480);assert.equal(result.remainingMinutes,270);
 const all=Impact.preview(input({}));assert.equal(all.currentMinutes,930);assert.equal(all.remainingMinutes,-210);
});
test('editing replaces the existing occurrence rather than charging it twice, including a worksite move',()=>{
 const before=shift('a',0,{plannedBreakMinutes:30});
 const result=Impact.preview(input({before,after:shift('a',0,{end:'17:00',plannedBreakMinutes:30}),siteIds:[0]}));assert.equal(result.deltaMinutes,60);assert.equal(result.plannedMinutes,510);
 const moving=Impact.preview(input({before,after:shift('a',1),siteIds:[0]}));assert.equal(moving.deltaMinutes,-450);assert.equal(moving.plannedMinutes,0);
});
test('moving into another week preserves all its existing shifts and removes no source-week minutes',()=>{
 const result=Impact.preview(input({before:shift('a',0,{date:'2026-10-27'}),shifts:[shift('destination')]}));assert.equal(result.currentMinutes,480);assert.equal(result.deltaMinutes,480);
});
test('missing coverage, monthly budgets, malformed times and duplicate identities produce no misleading total',()=>{
 for(const extra of [{loaded:false},{budget:null},{budget:{period:'month',hours:100}},{after:shift('bad',0,{end:'07:00'})},{shifts:[shift('a'),shift('a')]}])assert.equal(Impact.preview(input(extra)),null);
 const zero=Impact.preview(input({budget:{period:'week',hours:0},shifts:[]}));assert.equal(zero.remainingMinutes,-480);
});
