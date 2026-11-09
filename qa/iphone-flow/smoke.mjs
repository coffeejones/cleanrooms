/* Separate disposable HTTP fixture. Never contacts or mutates the phone's 8791 fixture. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const origin='http://127.0.0.1:8792';
try{await fetch(origin+'/qa/status',{method:'POST',headers:{'x-cleanrooms-qa':'local-only'},signal:AbortSignal.timeout(500)});throw Error('8792 already serves a fixture; stop it before running smoke.');}catch(error){if(!['TypeError','TimeoutError'].includes(error.name))throw error;}
const child=spawn(process.execPath,[path.join(here,'server.mjs'),'--smoke','--reset'],{stdio:['ignore','pipe','pipe']});
let diagnostics='',ready=false;
child.stderr.on('data',data=>{diagnostics+=data;});
const startup=new Promise((resolve,reject)=>{
 let output='';child.stdout.on('data',data=>{output+=data;if(output.includes('"event":"qa_ready"')){ready=true;resolve();}});
 child.once('exit',code=>{if(!ready)reject(Error('Fixture startup failed '+code+': '+diagnostics));});
 setTimeout(()=>{if(!ready)reject(Error('Fixture startup timeout: '+diagnostics));},20000).unref();
});
let token;
async function raw(route,payload,{authenticated=true}={}){const response=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json',...(route.startsWith('/qa/')?{'x-cleanrooms-qa':'local-only'}:{}),...(authenticated&&token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});return{status:response.status,body:await response.json()};}
async function ok(route,payload){const result=await raw(route,payload);assert.equal(result.status,200,JSON.stringify(result));return result.body;}
const admin=(name,payload={})=>ok('/qa/'+name,payload),mobile=payload=>ok('/api/mobile-auth',payload);
try{
 await startup;
 const status=await admin('status');
 const login=await mobile({action:'login',email:status.credentials.email,password:status.credentials.password});token=login.token;assert.ok(token);
 const schedule={action:'publishedSchedule',from:status.period.from,to:status.period.to,cursor:null};
 assert.deepEqual((await mobile(schedule)).shifts,[],'Drafts must remain private');
 await admin('publish',{weeks:1,includeDistant:true});
 const shifts=(await mobile(schedule)).shifts;assert.ok(shifts.some(shift=>shift.id===status.shiftId));assert.ok(shifts.every(shift=>shift.personId===status.employee.personId));
 await admin('change',{shiftId:status.distantShiftId,start:'11:00',end:'12:00'});
 const inbox=await mobile({action:'employeeInbox',cursor:null,limit:50});assert.ok(inbox.notifications.some(message=>message.after?.id===status.distantShiftId),'Event-time inbox includes distant shift changes');
 const detail=(await mobile({action:'publishedShift',shiftId:status.shiftId})).shift;assert.equal(detail.checklist.length,3);
 await mobile({action:'employeeChecklist',shiftId:detail.id,taskId:detail.checklist[0].id,checklistToken:detail.checklistToken,checked:true});
 const location={...status.gps,accuracyMeters:5,timestamp:Date.now()};delete location.radiusMeters;
 const clock=(operation,version,extra={})=>mobile({action:'shiftTime',operation,shiftId:detail.id,version,comment:null,location:null,...extra});
 let entry=(await clock('start',0,{location})).entry;assert.equal(entry.status,'running');
 assert.equal((await mobile({action:'employeeActiveTime'})).shift.entry.version,entry.version);
 await admin('clock',{advanceMinutes:20});entry=(await clock('pause',entry.version)).entry;
 await admin('clock',{advanceMinutes:5});entry=(await clock('resume',entry.version)).entry;
 await admin('clock',{advanceMinutes:35});await admin('fault',{afterCommit:'finish'});
 const dropped=await raw('/api/mobile-auth',{action:'shiftTime',operation:'finish',shiftId:detail.id,version:entry.version,comment:'QA smoke: original server clock evidence.',location:null});assert.equal(dropped.status,503);
 let after=(await mobile({action:'publishedShift',shiftId:detail.id})).shift.entry;assert.equal(after.status,'submitted');
 assert.equal((await mobile({action:'employeeActiveTime'})).shift,null);
 const retry=await raw('/api/mobile-auth',{action:'shiftTime',operation:'finish',shiftId:detail.id,version:entry.version,comment:null,location:null});assert.equal(retry.status,409,'Retry cannot duplicate committed attendance');
 let review=await admin('review');assert.equal(review.entries.length,1);assert.equal(review.entries[0].version,after.version);assert.ok(review.entries[0].breakMinutes>=5);const entryId=review.entries[0].id;
 const originalClockIn=after.clockIn,originalClockOut=after.clockOut;
 await admin('reject',{entryId,reason:'QA smoke: bekæft indstempling.'});
 after=(await mobile({action:'publishedShift',shiftId:detail.id})).shift.entry;assert.equal(after.status,'rejected');assert.equal(after.rejectionReason,'QA smoke: bekæft indstempling.');
 after=(await clock('submit',after.version,{comment:'QA smoke: teamlederen har bekræftet fremmøde.'})).entry;assert.equal(after.status,'submitted');assert.equal(after.clockIn,originalClockIn);assert.equal(after.clockOut,originalClockOut);
 const approved=await admin('approve',{entryId});const frozen=approved.result.entry.payroll;assert.ok(frozen.totalCents>0);
 let hours=await mobile({action:'employeeHours',...status.period});assert.equal(hours.summary.approvedCents,frozen.totalCents);
 await admin('personal-rate',{hourlyCents:20000});hours=await mobile({action:'employeeHours',...status.period});assert.equal(hours.summary.approvedCents,frozen.totalCents,'Approved pay remains frozen after rate changes');
 review=await admin('review');assert.deepEqual(review.entries[0].payroll,frozen);
 const rooms=await mobile({action:'chatList',cursor:null,limit:50});assert.ok(rooms.rooms.some(room=>room.id===status.roomId));
 const sent=await mobile({action:'chatSend',roomId:status.roomId,clientId:'qa-smoke-send',text:'Isolated HTTP employee message'});
 const repeated=await mobile({action:'chatSend',roomId:status.roomId,clientId:'qa-smoke-send',text:'Isolated HTTP employee message'});assert.equal(repeated.message.id,sent.message.id);
 const read=await mobile({action:'chatRead',roomId:status.roomId,before:null,limit:50});assert.ok(read.messages.some(message=>message.id===sent.message.id));
 await admin('fault',{offline:true});assert.equal((await raw('/api/mobile-auth',{action:'employeeActiveTime'})).status,503);await admin('fault',{offline:false});assert.equal((await mobile({action:'employeeActiveTime'})).shift,null);
 console.log(JSON.stringify({ok:true,origin,checks:['draft privacy','published own shifts','distant-change inbox','checklist','GPS clock-in','active attendance','pause/resume','lost finish receipt + CAS reconciliation','reject + comment-only resubmit','planner approval + frozen group pay','chat shared read + idempotent send','offline recovery'],workedMinutes:review.entries[0].workedMinutes,breakMinutes:review.entries[0].breakMinutes,approvedCents:frozen.totalCents,hostClockChanged:false},null,2));
}finally{
 try{if(ready)await admin('shutdown');}catch{}
 if(child.exitCode===null)child.kill('SIGTERM');
}
