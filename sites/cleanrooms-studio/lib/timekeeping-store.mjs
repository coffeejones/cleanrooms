/* Attendance has its own guarded ledger; a plan save cannot replace it. */
import Time from '../src/timekeeping-model.js';
import Groups from '../src/payroll-groups-model.js';
import Directory from '../src/directory-records.js';
import {readDirectorySite} from './directory-store.mjs';
import {ensureTimeEntries,findTimeEntry,readTimeEntries,entryInterval,TIME_ENTRY_BYTES} from './time-entry-store.mjs';
import {readPublishedTimeShifts} from './publication-time-store.mjs';
import {initializeTimekeepingContext,assertTimekeepingContext,timekeepingPeople,timekeepingPlannedRows} from './timekeeping-context.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const validText=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const summaryFields=e=>e?{start:e.start,end:e.end,endDate:e.endDate,breakMinutes:e.breakMinutes,status:e.status,comment:e.comment||''}:null;
const frozenPlan=shift=>Object.fromEntries(['id','person','date','site','start','end','endDate','plannedBreakMinutes'].filter(key=>shift[key]!==undefined).map(key=>[key,shift[key]]));
const monday=value=>Time.addDays(value,-((new Date(value+'T12:00:00Z').getUTCDay()+6)%7));

const EARTH_RADIUS_METERS=6_371_000;
const MAX_LOCATION_AGE_MS=30_000,MAX_CLOCK_SKEW_MS=5_000,MAX_LOCATION_ACCURACY_METERS=50;
const radians=degrees=>degrees*Math.PI/180;
const coordinate=(value,limit)=>Number.isFinite(value)&&Math.abs(value)<=limit;
function checkClockInLocation(site,location,receivedAt,fail){
  if(!site)fail(409,'time_location_policy_invalid','Arbejdsstedets GPS-indstilling kunne ikke bekræftes. Kontakt planlæggeren.');
  const gps=site.gps;
  if(!gps?.enabled)return;
  if(location===undefined)fail(400,'time_location_required','Du skal dele din aktuelle placering for at stemple ind på dette arbejdssted.');
  if(!location||typeof location!=='object'||Array.isArray(location)||!coordinate(location.latitude,90)||!coordinate(location.longitude,180)||!Number.isSafeInteger(location.timestamp))fail(400,'time_location_invalid','GPS-placeringen kunne ikke læses. Prøv igen.');
  const age=receivedAt-location.timestamp;
  if(age>MAX_LOCATION_AGE_MS||age < -MAX_CLOCK_SKEW_MS)fail(400,'time_location_stale','GPS-placeringen er ikke aktuel. Prøv igen.');
  const {accuracyMeters}=location;
  if(!Number.isFinite(accuracyMeters)||accuracyMeters<0||accuracyMeters>Math.min(MAX_LOCATION_ACCURACY_METERS,gps.radiusMeters))fail(400,'time_location_imprecise','Placeringen er for upræcis. Slå præcis placering til, eller find bedre GPS-signal, og prøv igen.');
  const latitudeDelta=radians(location.latitude-gps.latitude),longitudeDelta=radians(location.longitude-gps.longitude);
  const haversine=Math.sin(latitudeDelta/2)**2+Math.cos(radians(gps.latitude))*Math.cos(radians(location.latitude))*Math.sin(longitudeDelta/2)**2;
  const distance=2*EARTH_RADIUS_METERS*Math.asin(Math.sqrt(Math.min(1,haversine)));
  if(distance>gps.radiusMeters)fail(400,'time_location_outside',`Du er for langt fra arbejdsstedet. Gå inden for ${gps.radiusMeters} m og prøv igen.`);
  if(distance+accuracyMeters>gps.radiusMeters)fail(400,'time_location_imprecise','Placeringen er for tæt på grænsen til at kunne bekræftes. Gå tættere på arbejdsstedet og prøv igen.');
}

export async function handleTimekeepingAction({db,context,payload,principal,helpers:h}){
  const caps=h.capabilities(context),manager=caps.plan,personId=context.member.personId,workspaceId=context.workspace.id,stamp=new Date().toISOString(),local=Time.localNow();
  if(!manager&&!personId)h.fail(403,'time_forbidden','Kontoen skal være knyttet til en medarbejder.');
  const range={from:payload.from||monday(local.date),to:payload.to||Time.addDays(monday(local.date),6)};
  if(!Time.validDate(range.from)||!Time.validDate(range.to)||range.to<range.from||(Date.parse(range.to)-Date.parse(range.from))/86400000>366)h.fail(400,'time_range_invalid','Vælg en periode på højst ét år.');
  if(payload.personId&&!manager&&payload.personId!==personId)h.fail(403,'time_person_forbidden','Du kan kun se dine egne registreringer.');
  if(payload.personId!==undefined&&!Directory.validId('employee',payload.personId))h.fail(400,'time_person_invalid','Vælg en gyldig medarbejder.');
  const frame=await initializeTimekeepingContext({db,context,helpers:h});
  let {row,document}=await ensureTimeEntries({db,workspaceId,helpers:h,context}),published=[];
  const scopedPerson=manager?payload.personId:personId;
  let bundlePromise=null,salaryPeople=[];
  async function salary(entry){
    // Cache the promise before awaiting it: concurrent DTOs share one policy/person query batch.
    if(!bundlePromise)bundlePromise=h.payrollBundle(db,context,{personIds:[...new Set([...salaryPeople,entry.personId])]});
    const bundle=await bundlePromise;
    const personal=bundle.people.find(p=>p.personId===entry.personId);
    const resolved=Groups.resolve({policy:bundle.policy,personId:entry.personId,payroll:personal?.payroll||null,from:entry.date,to:entry.endDate||entry.date});
    return {snapshot:Time.payroll(entry,resolved,{policyVersion:bundle.version,personVersion:personal?.version||0,calculatedAt:stamp}),bundle};
  }
  async function dto(entry){
    const safe=clone(entry);delete safe.pauseAt;delete safe._hasOverlap;
    Object.assign(safe,Time.summary(entry));
    if(!entry.demo&&(Time.hasDSTAmbiguity(entry)||entry.clockStartAt&&!entry.clockEndAt&&Time.crossesOffsetChange(entry.clockStartAt,stamp)))safe.flags.push('dst_transition');
    if(entry._hasOverlap&&!safe.flags.includes('overlap'))safe.flags.push('overlap');
    if(caps.viewPayroll){if(!safe.payroll&&entry.end&&Time.validate(entry).length===0&&!safe.flags.includes('dst_transition'))safe.payroll=(await salary(entry)).snapshot;}else{delete safe.payroll;delete safe.approvalHistory;delete safe.reopenedApproval;safe.audit=safe.audit.map(({payroll,...item})=>item);}
    return safe;
  }
  async function readBundle(entry=null){
    const beforeHeader=await h.first(db,'SELECT version FROM workspace_timekeeping WHERE workspace_id = ?',workspaceId);
    let page;try{page=await readTimeEntries({db,workspaceId,...range,personId:manager?payload.personId:personId,includeDemo:manager,limit:payload.pageSize??5000,cursor:payload.cursor??null});}catch(error){h.fail(error.status||400,error.code||'time_page_invalid',error.message);}
    // A forgotten older checkout must remain reachable even outside the employee's current calendar month.
    if(!manager&&!payload.cursor){const running=await h.first(db,"SELECT config FROM workspace_time_entries WHERE workspace_id = ? AND person_id = ? AND demo = 0 AND status IN ('running','paused') LIMIT 1",workspaceId,personId);if(running){const active=JSON.parse(running.config);if(!page.entries.some(item=>item.id===active.id))page.entries.push(active);}}
    row=await h.first(db,'SELECT * FROM workspace_timekeeping WHERE workspace_id = ?',workspaceId);
    if((beforeHeader?.version||0)!==(row?.version||0))h.fail(409,'time_conflict','Registreringerne ændrede sig, mens de blev hentet. Prøv igen.');
    if(row)document=JSON.parse(row.config);
    const firstPage=!payload.cursor;if(firstPage)published=await readPublishedTimeShifts({db,workspaceId,...range,...(scopedPerson?{personId:scopedPerson}:{})});
    const shifts=[...published,...(firstPage&&manager?document.demo?.shifts||[]:[])].filter(s=>(manager||s.person===personId)&&(!payload.personId||s.person===payload.personId)&&s.date>=range.from&&s.date<=range.to);
    if(!manager){const missing=page.entries.filter(historical=>!shifts.some(shift=>shift.id===historical.shiftId)),current=await readPublishedTimeShifts({db,workspaceId,ids:[...new Set(missing.map(entry=>entry.shiftId))]});for(const historical of missing){const live=current.find(shift=>shift.id===historical.shiftId);if(!firstPage&&live?.person===personId&&live.date>=range.from&&live.date<=range.to)continue;const frozen=historical.frozenShift||{id:historical.shiftId,person:historical.personId,date:historical.date,site:historical.site,start:historical.plannedStart,end:historical.plannedEnd,plannedBreakMinutes:historical.plannedBreakMinutes||0};shifts.push({...clone(frozen),recovered:true,cancelled:!live,note:frozen.note||''});}}
    salaryPeople=page.entries.map(entry=>entry.personId);bundlePromise=null;
    const planned=firstPage&&manager?await timekeepingPlannedRows({db,context,frame,...range,personId:scopedPerson}):null;
    const result={from:range.from,to:range.to,entries:await Promise.all(page.entries.map(dto)),nextCursor:page.nextCursor,ledgerVersion:row?.version||0,planRevision:frame.planRevision,directoryRevision:frame.directoryRevision,...(firstPage||shifts.length?{shifts:clone(shifts)}:{}),...(planned?{plannedRows:planned.plannedRows}:{}),demo:manager&&document.demo?{...clone(document.demo),shifts:undefined,active:true}:{active:false},canManage:manager,canViewPayroll:caps.viewPayroll===true,serverNow:stamp};
    if(entry&&(manager||entry.personId===personId&&!entry.demo))result.entry=await dto(entry);
    await assertTimekeepingContext({db,context,frame,helpers:h});return result;
  }
  function commitGuard(rateBundle,ratePerson){
    const own=h.actorGuard(context,manager?['plan']:[]),guards=[own,{sql:'EXISTS (SELECT 1 FROM studio_states time_plan WHERE time_plan.owner_id = ? AND time_plan.revision = ?)',values:[context.workspace.snapshotOwnerId,frame.planRevision]},{sql:'EXISTS (SELECT 1 FROM workspace_directory_state directory WHERE directory.workspace_id=? AND directory.version=? AND directory.write_token=?)',values:[workspaceId,frame.directoryRevision,frame.directoryToken]}];
    if(rateBundle){guards.push(h.policyVersionGuard(context,rateBundle.version),h.personVersionsGuard(context,[{personId:ratePerson,version:rateBundle.people.find(p=>p.personId===ratePerson)?.version||0}]));}
    return {sql:guards.map(g=>'('+g.sql+')').join(' AND '),values:guards.flatMap(g=>g.values)};
  }
  async function commitEntry(entry,current,rateBundle=null){
    const auditSource=clone(entry),bytes=()=>new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    // All full events are archived atomically below. Keep a bounded recent view on the attendance row.
    while(entry.audit.length>1&&bytes()>TIME_ENTRY_BYTES){entry.audit.shift();entry.auditArchived=true;}
    if(bytes()>TIME_ENTRY_BYTES)for(const event of entry.audit)for(const key of ['before','after'])if(typeof event[key]?.comment==='string'){
      const text=event[key].comment,digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));event[key]={...event[key],commentLength:text.length,commentSha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};delete event[key].comment;entry.auditArchived=true;
    }
    const serialized=JSON.stringify(entry);if(bytes()>TIME_ENTRY_BYTES)h.fail(413,'time_entry_full','Registreringen fylder for meget til én sikker handling. Kontakt administratoren for sikker arkivering; eksisterende data er bevaret.');
    const guard=commitGuard(rateBundle,entry.personId),token=crypto.randomUUID(),interval=entryInterval(entry);
    let condition=guard.sql,values=[...guard.values];
    if(interval&&['submitted','approved'].includes(entry.status)){
      condition+=` AND NOT EXISTS (SELECT 1 FROM workspace_time_entries other WHERE other.workspace_id = ? AND other.person_id = ? AND other.demo = ? AND other.work_date >= ? AND other.work_date <= ? AND other.id <> ? AND other.interval_start < ? AND other.interval_end > ?)`;
      values.push(workspaceId,entry.personId,entry.demo?1:0,Time.addDays(entry.date,-2),Time.addDays(entry.date,2),entry.id,interval.end,interval.start);
    }
    const fields=[entry.shiftId,entry.personId,entry.date,entry.endDate||entry.date,entry.status,entry.demo?1:0,entry.version,serialized,token,stamp,interval?.start??null,interval?.end??null];
    const query=current?h.statement(db,`UPDATE workspace_time_entries SET shift_id = ?,person_id = ?,work_date = ?,end_date = ?,status = ?,demo = ?,version = ?,config = ?,write_token = ?,updated_at = ?,interval_start = ?,interval_end = ? WHERE workspace_id = ? AND id = ? AND version = ? AND ${condition}`,...fields,workspaceId,entry.id,current.version,...values):h.statement(db,`INSERT INTO workspace_time_entries (workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at,interval_start,interval_end) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(workspace_id,id) DO NOTHING`,workspaceId,entry.id,...fields,...values);
    const receipt={sql:'EXISTS (SELECT 1 FROM workspace_time_entries WHERE workspace_id = ? AND id = ? AND write_token = ?)',values:[workspaceId,entry.id,token]};
    // Header version is a publication/workflow fence, not a CAS shared by unrelated employee writes.
    const header=h.statement(db,`INSERT INTO workspace_timekeeping (workspace_id,config,version,write_token,updated_at) SELECT ?,?,1,?,? WHERE ${receipt.sql} ON CONFLICT(workspace_id) DO UPDATE SET version = workspace_timekeeping.version + 1,write_token = excluded.write_token,updated_at = excluded.updated_at`,workspaceId,JSON.stringify({schema:2,entries:[],demo:null}),token,stamp,...receipt.values);
    const audit=h.timeActivityStatements?.({db,context,next:{entries:[auditSource]},previous:{entries:current?[current]:[]},condition:receipt})||[];
    let written;try{written=await db.batch([query,header,...audit]);}catch(error){if(/UNIQUE constraint|constraint failed/i.test(String(error)))h.fail(409,'time_conflict','Medarbejderen har allerede en igangværende eller ændret registrering. Hent timerne igen.');throw error;}
    await h.assertContext(db,context);
    if(written[0]?.meta?.changes!==1)h.fail(409,'time_conflict','Registreringen overlapper andre timer, eller registreringen, vagtplanen eller lønsatserne er ændret. Hent den seneste version.');
  }
  async function commitDemo(next){
    const guard=commitGuard(),token=crypto.randomUUID(),header={schema:2,entries:[],demo:next.demo};
    const update=row?h.statement(db,`UPDATE workspace_timekeeping SET config = ?,version = version + 1,write_token = ?,updated_at = ? WHERE workspace_id = ? AND version = ? AND ${guard.sql}`,JSON.stringify(header),token,stamp,workspaceId,row.version,...guard.values):h.statement(db,`INSERT INTO workspace_timekeeping (workspace_id,config,version,write_token,updated_at) SELECT ?,?,1,?,? WHERE ${guard.sql} ON CONFLICT(workspace_id) DO NOTHING`,workspaceId,JSON.stringify(header),token,stamp,...guard.values);
    const receipt={sql:'EXISTS (SELECT 1 FROM workspace_timekeeping WHERE workspace_id = ? AND write_token = ?)',values:[workspaceId,token]};
    const statements=[update,h.statement(db,`DELETE FROM workspace_time_entries WHERE workspace_id = ? AND demo = 1 AND ${receipt.sql}`,workspaceId,...receipt.values)];
    for(const entry of next.entries){const interval=entryInterval(entry);statements.push(h.statement(db,`INSERT INTO workspace_time_entries (workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at,interval_start,interval_end) SELECT ?,?,?,?,?,?,?,1,?,?,?,?,?,? WHERE ${receipt.sql}`,workspaceId,entry.id,entry.shiftId,entry.personId,entry.date,entry.endDate||entry.date,entry.status,entry.version,JSON.stringify(entry),token,stamp,interval?.start??null,interval?.end??null,...receipt.values));}
    const written=await db.batch(statements);await h.assertContext(db,context);if(written[0]?.meta?.changes!==1)h.fail(409,'time_conflict','Tidsdemoen er ændret. Hent den igen.');document=header;
  }
  if(payload.action==='timeRead')return readBundle();
  if(payload.action==='timeDemo'){
    if(!manager)h.fail(403,'time_demo_forbidden','Kun en planlægger kan åbne tidsdemoen.');
    const operation=payload.operation||'load';if(!['load','reset','clear'].includes(operation))h.fail(400,'time_operation_invalid','Vælg en gyldig demohandling.');
    if(operation==='load'&&document.demo)return readBundle();
    const next={entries:[],demo:null};
    if(operation!=='clear'){
      // Demo membership is based only on the public roster, never on private salary exceptions.
      const active=await timekeepingPeople({db,context,firstActive:2}),primary=active[0];
      if(!primary)h.fail(400,'time_demo_roster_empty','Opret en medarbejder, før demougen indlæses.');
      const from=monday(local.date),to=Time.addDays(from,6),demoId='time-demo-'+crypto.randomUUID(),shifts=[],scenarios=[];
      const cases=[['normal','Normal vagt med aftalt pause','07:00','15:00','07:00','15:00',30,30],['late_start','Sen start','07:00','15:00','07:20','15:00',0,0],['long_break','Længere pause end aftalt','07:00','15:00','07:00','15:00',75,30],['overtime','Ekstra arbejdstid','07:00','15:00','07:00','16:00',0,0],['missing_end','Glemt udstempling','07:00','15:00','07:00',null,0,0],['corrected','Rettet registrering','07:00','15:00','07:05','15:05',0,0],['clock','Prøv start og afslut','09:00','13:00',null,null,0,0]];
      cases.forEach(([scenario,label,plannedStart,plannedEnd,start,end,pause,plannedPause],i)=>{
        const date=Time.addDays(from,i),shift={id:demoId+'-shift-'+i,person:primary.id,date,site:primary.site||0,start:plannedStart,end:plannedEnd,plannedBreakMinutes:plannedPause,note:label,demo:true,timeScenario:scenario};shifts.push(shift);scenarios.push({id:scenario,label,date,personId:primary.id,shiftId:shift.id});
        if(start)next.entries.push({id:demoId+'-entry-'+i,version:1,shiftId:shift.id,personId:primary.id,date,site:shift.site,plannedStart,plannedEnd,plannedBreakMinutes:plannedPause,start,end,endDate:date,breakMinutes:pause,breaks:[],breakAllocation:'end-of-shift',status:end?'submitted':'rejected',comment:scenario==='late_start'?'Jeg glemte at stemple ind, men mødte kl. 07:00.':'',correctionReason:scenario==='corrected'?'Udstemplingen blev rettet efter aftale med medarbejderen.':'',demo:true,scenario,createdAt:stamp,updatedAt:stamp,approvedAt:null,approvedBy:null,audit:[{at:stamp,actor:{userId:principal.userId,name:principal.name},operation:'demo',reason:'Demouge indlæst',before:null,after:{start,end,breakMinutes:pause,status:end?'submitted':'rejected'}}]});
      });
      const secondary=active[1];
      if(secondary){const date=Time.addDays(from,5),shift={id:demoId+'-comparison',person:secondary.id,date,site:secondary.site||0,start:'07:00',end:'15:00',plannedBreakMinutes:30,note:'Sammenligning med 30 min aftalt pause',demo:true,timeScenario:'group-comparison'};shifts.push(shift);next.entries.push({id:demoId+'-comparison-entry',version:1,shiftId:shift.id,personId:secondary.id,date,site:shift.site,plannedStart:shift.start,plannedEnd:shift.end,plannedBreakMinutes:30,start:shift.start,end:shift.end,endDate:date,breakMinutes:30,breaks:[],breakAllocation:'end-of-shift',status:'submitted',comment:'',correctionReason:'',demo:true,scenario:'group-comparison',createdAt:stamp,updatedAt:stamp,approvedAt:null,approvedBy:null,audit:[]});}
      next.demo={id:demoId,from,to,personId:primary.id,clockDate:to,demoClockDate:to,scenarios,shifts};
    }
    await commitDemo(next);return readBundle();
  }
  if(payload.action!=='timeWrite')h.fail(400,'time_operation_invalid','Ukendt tidsregistrering.');
  const operation=payload.operation,allowed=['start','pause','resume','finish','correct','approve','reopen','submit','reject','comment'];
  if(!allowed.includes(operation))h.fail(400,'time_operation_invalid','Vælg en gyldig handling.');
  if(!Number.isSafeInteger(payload.version)||payload.version<0)h.fail(400,'time_version_invalid','Hent registreringen igen.');
  const current=await findTimeEntry({db,workspaceId,id:payload.entryId,shiftId:payload.shiftId});
  const isDemo=Boolean(current?.demo||document.demo?.shifts.some(s=>s.id===payload.shiftId));
  if(isDemo&&(!manager||payload.demo!==true))h.fail(403,'time_demo_forbidden','Demoen kan kun redigeres af en planlægger i demovisning.');
  if(!manager&&current&&current.personId!==personId)h.fail(403,'time_person_forbidden','Du kan kun registrere dine egne vagter.');
  if(['correct','submit'].includes(operation)&&!manager)h.fail(403,'time_correction_forbidden','Kun en planlægger kan rette registrerede tider. Send en kommentar, hvis stemplingen skal gennemgås.');
  if(['approve','reopen','reject'].includes(operation)&&!manager)h.fail(403,'time_approval_forbidden','Kun en planlægger kan godkende eller genåbne timer.');
  if(!isDemo)published=await readPublishedTimeShifts({db,workspaceId,ids:[current?.shiftId||payload.shiftId].filter(Boolean)});
  const liveShift=(isDemo?document.demo?.shifts||[]:published).find(s=>s.id===(current?.shiftId||payload.shiftId));
  // An existing record owns its historical assignment/plan even after a later cancellation or a legacy reassignment.
  const shift=current?(current.frozenShift||{id:current.shiftId,person:current.personId,date:current.date,site:current.site,start:current.plannedStart,end:current.plannedEnd,plannedBreakMinutes:current.plannedBreakMinutes||0}):liveShift;
  if(!shift||!shift.person||!current&&!(await timekeepingPeople({db,context,personIds:[shift.person]})).some(p=>p.id===shift.person))h.fail(404,'time_shift_missing','Den udgivne vagt findes ikke længere.');
  if(!manager&&shift.person!==personId)h.fail(403,'time_shift_forbidden','Vagten er ikke tildelt din konto.');
  if(payload.personId&&payload.personId!==shift.person)h.fail(403,'time_person_forbidden','Registreringen og medarbejderen stemmer ikke overens.');
  if(payload.version!==(current?.version||0))h.fail(409,'time_conflict','Registreringen er ændret. Hent den seneste version.');
  if(current?.status==='approved'&&operation!=='reopen')h.fail(409,'time_approved_locked','Godkendte timer er låst. En planlægger skal genåbne registreringen med en begrundelse.');
  if(['correct','reopen','reject'].includes(operation)&&(!validText(payload.reason,4000)||!payload.reason.trim()))h.fail(400,'time_reason_required','Skriv en begrundelse for rettelsen.');
  if(payload.comment!==undefined&&!validText(payload.comment,100000))h.fail(400,'time_note_invalid','Kommentaren indeholder ugyldige tegn eller er for lang.');
  const entry=current?clone(current):{id:'time-'+crypto.randomUUID(),version:0,shiftId:shift.id,personId:shift.person,date:shift.date,site:shift.site,plannedStart:shift.start,plannedEnd:shift.end,plannedBreakMinutes:shift.plannedBreakMinutes===undefined?0:shift.plannedBreakMinutes,start:null,end:null,endDate:shift.date,breakMinutes:0,breaks:[],breakAllocation:'clocked',status:'running',comment:'',correctionReason:'',demo:isDemo,createdAt:stamp,updatedAt:stamp,approvedAt:null,approvedBy:null,audit:[]};
  if(!entry.frozenShift)entry.frozenShift=frozenPlan(shift);
  const before=summaryFields(current);
  function clockPoint(){
    if(!isDemo){const dayDelta=Math.round((Date.parse(local.date)-Date.parse(entry.date))/86400000),elapsed=entry.clockStartAt?Math.floor(Date.parse(stamp)/60000)-Math.floor(Date.parse(entry.clockStartAt)/60000):null;return {date:local.date,time:local.time,offset:elapsed===null?dayDelta*1440+Time.minute(local.time):Time.minute(entry.start)+elapsed};}
    const begin=Time.minute(entry.start)||Time.minute(entry.plannedStart),offset=operation==='start'?Time.minute(entry.plannedStart):operation==='pause'?(entry.lastClockOffset??begin)+120:operation==='resume'?(entry.pauseOffset||begin)+30:operation==='finish'?Math.max(Time.minute(entry.plannedEnd),entry.lastClockOffset?entry.lastClockOffset+60:begin+240):begin;
    return {date:Time.addDays(entry.date,Math.floor(offset/1440)),time:Time.clock(offset),offset};
  }
  const point=clockPoint();
  const dstMessage='Vagten krydser et skift mellem sommer- og vintertid. Timerne kan ikke beregnes sikkert her; bed planlæggeren afklare de præcise tidspunkter før lønbehandling.';
  if(operation==='comment'&&(!validText(payload.comment,100000)||!payload.comment.trim()))h.fail(400,'time_comment_required','Skriv en kommentar til planlæggeren.');
  if(payload.comment!==undefined&&!['finish','comment','correct'].includes(operation))h.fail(400,'time_note_operation','Kommentarer kan kun tilføjes ved afslutning eller som en supplerende kommentar.');
  if(operation==='start'){
    if(current)h.fail(409,'time_already_started','Vagten har allerede en tidsregistrering.');
    if(!isDemo&&shift.date!==local.date)h.fail(400,'time_start_date','Start vagten på dens dato. Kontakt planlæggeren, hvis en tidligere vagt mangler registrering.');
    if(await h.first(db,"SELECT id FROM workspace_time_entries WHERE workspace_id = ? AND person_id = ? AND demo = ? AND status IN ('running','paused') LIMIT 1",workspaceId,entry.personId,isDemo?1:0))h.fail(409,'time_running_exists','Afslut eller ret medarbejderens igangværende vagt først.');
    if(!isDemo){
      // Read the live workplace policy. The write also checks the captured directory generation.
      const site=await readDirectorySite({db,workspaceId,siteIndex:shift.site});
      checkClockInLocation(site,payload.location,Date.parse(stamp),h.fail);
    }
    entry.start=point.time;entry.clockStartAt=stamp;entry.timeZone='Europe/Copenhagen';
  }else if(operation==='pause'){
    if(!current||entry.status!=='running')h.fail(409,'time_state_invalid','Vagten skal være i gang for at holde pause.');entry.status='paused';entry.pauseAt=stamp;entry.pauseOffset=point.offset;
  }else if(operation==='resume'||operation==='finish'){
    if(!current||!['running','paused'].includes(entry.status))h.fail(409,'time_state_invalid','Vagten er ikke i gang.');
    if(entry.status==='paused'){
      const duration=point.offset-entry.pauseOffset;if(duration<0)h.fail(400,'time_clock_invalid','Pausens sluttid ligger før start.');
      if(duration>0)entry.breaks.push({start:entry.pauseOffset,end:point.offset});entry.breakMinutes+=duration;delete entry.pauseAt;delete entry.pauseOffset;
    }
    entry.status=operation==='finish'?'submitted':'running';
    if(operation==='finish'){entry.end=point.time;entry.endDate=point.date;entry.clockEndAt=stamp;entry.dstUnresolved=!isDemo&&Time.crossesOffsetChange(entry.clockStartAt,entry.clockEndAt);}
  }else if(operation==='correct'){
    if(!isDemo&&shift.date>local.date)h.fail(400,'time_future_entry','Fremtidige vagter kan ikke registreres endnu.');
    if(payload.date!==undefined&&payload.date!==entry.date)h.fail(400,'time_date_invalid','Registreringen skal blive på vagtens dato.');
    entry.start=payload.start;entry.end=payload.end||null;entry.endDate=payload.endDate||entry.date;entry.breakMinutes=payload.breakMinutes;entry.breaks=[];entry.breakAllocation='end-of-shift';entry.status=entry.end?'submitted':'rejected';entry.correctionReason=payload.reason.trim();delete entry.pauseAt;delete entry.pauseOffset;delete entry.payroll;
    delete entry.resolvedStartAt;delete entry.resolvedEndAt;delete entry.timingResolved;delete entry.dstUnresolved;
    if(payload.actualStartAt!==undefined||payload.actualEndAt!==undefined){
      if(!Time.validInstant(payload.actualStartAt)||!Time.validInstant(payload.actualEndAt))h.fail(400,'time_instants_required','Angiv både start og slut som præcise UTC-tidspunkter, fx 2026-10-25T00:30:00.000Z.');
      const actualStart=Time.localNow(new Date(payload.actualStartAt)),actualEnd=Time.localNow(new Date(payload.actualEndAt));
      if(actualStart.date!==entry.date||actualStart.time!==entry.start||actualEnd.date!==entry.endDate||actualEnd.time!==entry.end||Date.parse(payload.actualEndAt)>Date.parse(stamp))h.fail(400,'time_instants_mismatch','UTC-tidspunkterne skal passe til vagtens lokale dato og tider og må ikke ligge i fremtiden.');
      entry.resolvedStartAt=new Date(payload.actualStartAt).toISOString();entry.resolvedEndAt=new Date(payload.actualEndAt).toISOString();entry.timingResolved=true;entry.timeZone='Europe/Copenhagen';
      if(current?.breakAllocation==='clocked'&&current.breakMinutes===entry.breakMinutes&&Math.floor(Date.parse(current.clockStartAt)/60000)===Math.floor(Date.parse(entry.resolvedStartAt)/60000)&&Math.floor(Date.parse(current.clockEndAt)/60000)===Math.floor(Date.parse(entry.resolvedEndAt)/60000)){
        entry.breakAllocation='clocked';entry.breaks=clone(current.breaks||[]);
      }
    }
    entry.dstUnresolved=!isDemo&&Time.hasDSTAmbiguity(entry);
  }else if(operation==='reopen'){
    if(!current||entry.status!=='approved')h.fail(409,'time_state_invalid','Kun godkendte timer kan genåbnes.');entry.status='submitted';delete entry.payroll;entry.approvedAt=null;entry.approvedBy=null;
  }else if(operation==='reject'){
    if(!current||entry.status!=='submitted')h.fail(409,'time_state_invalid','Kun indsendte timer kan sendes retur.');entry.status='rejected';
  }else if(operation==='comment'){
    if(!current||!['submitted','rejected'].includes(entry.status))h.fail(409,'time_state_invalid','Afslut vagten, før du tilføjer en supplerende kommentar.');
    const addition=payload.comment.trim();entry.comment=[entry.comment?.trim(),addition].filter(Boolean).join('\n\n');
    if(entry.comment.length>100000)h.fail(413,'time_note_full','Kommentaren fylder for meget. Kontakt planlæggeren for at give flere oplysninger.');
    if(entry.end)entry.status='submitted';
  }else if(operation==='submit'){
    if(!current||!['rejected','submitted'].includes(entry.status))h.fail(409,'time_state_invalid','Afslut eller ret registreringen, før den indsendes.');entry.status='submitted';
  }else if(operation==='approve'){
    if(!current||entry.status!=='submitted')h.fail(409,'time_state_invalid','Kun afsluttede og indsendte timer kan godkendes.');
    if(!isDemo&&Time.hasDSTAmbiguity(entry))h.fail(400,'time_dst_transition',dstMessage);
    if(payload.onlyIfMatchesPlan===true&&Time.review(await dto(entry),{shift:liveShift,canViewPayroll:caps.viewPayroll,today:local.date}).bucket!=='ready')h.fail(409,'time_plan_review_required','Registreringen kræver gennemgang. Hent den seneste liste, og gennemgå timerne enkeltvis.');
    entry.status='approved';entry.approvedAt=stamp;entry.approvedBy={userId:principal.userId,name:principal.name};
  }
  if(payload.comment!==undefined&&['finish','correct'].includes(operation))entry.comment=payload.comment.trim();
  if(isDemo)entry.lastClockOffset=point.offset;
  const errors=Time.validate(entry,{allowOpen:['running','paused','rejected'].includes(entry.status)});if(errors.length)h.fail(400,'time_validation',errors[0]);
  const interval=entryInterval(entry);
  if(interval&&['submitted','approved'].includes(entry.status)&&await h.first(db,'SELECT id FROM workspace_time_entries WHERE workspace_id = ? AND person_id = ? AND demo = ? AND work_date >= ? AND work_date <= ? AND id <> ? AND interval_start < ? AND interval_end > ? LIMIT 1',workspaceId,entry.personId,isDemo?1:0,Time.addDays(entry.date,-2),Time.addDays(entry.date,2),entry.id,interval.end,interval.start))h.fail(409,'time_overlap','Registreringen overlapper en anden registrering for medarbejderen.');
  let rateBundle=null;if(operation==='approve'){const salaryResult=await salary(entry);entry.payroll=salaryResult.snapshot;entry.approvalHistory=[...(entry.approvalHistory||[]),{at:stamp,actor:clone(entry.approvedBy),snapshot:clone(entry.payroll)}];rateBundle=salaryResult.bundle;}
  entry.version++;entry.updatedAt=stamp;entry.audit.push({id:'time-event-'+crypto.randomUUID(),at:stamp,actor:{userId:principal.userId,name:principal.name},operation,reason:payload.reason?.trim()||'',before,after:summaryFields(entry)});entry.audit=entry.audit.slice(-200);
  await commitEntry(entry,current,rateBundle);const header=await h.first(db,'SELECT version FROM workspace_timekeeping WHERE workspace_id=?',workspaceId);return {entry:await dto(entry),from:range.from,to:range.to,ledgerVersion:header?.version||0,planRevision:frame.planRevision,directoryRevision:frame.directoryRevision,canManage:manager,canViewPayroll:caps.viewPayroll===true,serverNow:stamp};
}
