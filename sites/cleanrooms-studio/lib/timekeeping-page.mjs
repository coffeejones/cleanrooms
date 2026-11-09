/* Opt-in planner queues. Scan compact review facts in bounded batches; hydrate only the visible page. */
import Time from '../src/timekeeping-model.js';
import Groups from '../src/payroll-groups-model.js';
import {readPublishedTimeShifts} from './publication-time-store.mjs';

const BATCH=500,PAGE_BYTES=1536*1024,queues=new Set(['all','attention','ready','progress','approved']);
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results||[];
const first=async(...args)=>(await rows(...args))[0]||null;
const caches=new WeakMap();
const counts=()=>({all:0,attention:0,ready:0,progress:0,approved:0});
const totals=personId=>({...(personId?{personId}:{}),counts:counts(),registeredMinutes:0,approvedMinutes:0,approvedCents:0,baseCents:0,supplementCents:0,missingPayrollCount:0});
const validMoney=value=>Number.isSafeInteger(value)&&value>=0;
const personPolicy=(policy,personId)=>{const links=policy.links.filter(link=>link.personId===personId),ids=new Set(links.map(link=>link.groupId));return {schema:policy.schema,groups:policy.groups.filter(group=>ids.has(group.id)),links};};
const sum=(target,key,value)=>{const next=target[key]+value;if(!Number.isSafeInteger(next))throw new RangeError('Periodens timer eller lønbeløb er for stort til at kunne vises præcist.');target[key]=next;};
const compactFields=['id','version','shiftId','personId','date','site','plannedStart','plannedEnd','plannedBreakMinutes','start','end','endDate','breakMinutes','breaks','breakAllocation','status','demo','clockStartAt','clockEndAt','resolvedStartAt','resolvedEndAt','timingResolved','dstUnresolved'];
const whitespace='char('+[9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279].join(',')+')';
const fieldSql=key=>{const value="json_extract(attendance.config,'$."+key+"')";return ['demo','timingResolved','dstUnresolved'].includes(key)?"CASE json_type(attendance.config,'$."+key+"') WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') ELSE "+value+" END":value;};
const compact=`json_object(${compactFields.flatMap(key=>["'"+key+"'",fieldSql(key)]).join(',')},'comment',CASE WHEN trim(COALESCE(json_extract(attendance.config,'$.comment'),''),${whitespace})<>'' THEN 'Kommentar' ELSE '' END,'correctionReason',CASE WHEN trim(COALESCE(json_extract(attendance.config,'$.correctionReason'),''),${whitespace})<>'' THEN 'Rettet' ELSE '' END,'payroll',CASE WHEN json_type(attendance.config,'$.payroll')='object' THEN json_object('totalCents',json_extract(attendance.config,'$.payroll.totalCents'),'baseCents',json_extract(attendance.config,'$.payroll.baseCents'),'supplementCents',json_extract(attendance.config,'$.payroll.supplementCents'),'unavailableReason',json_extract(attendance.config,'$.payroll.unavailableReason')) ELSE NULL END)`;
const overlap=`EXISTS (SELECT 1 FROM workspace_time_entries other WHERE other.workspace_id=attendance.workspace_id AND other.person_id=attendance.person_id AND other.demo=attendance.demo AND other.work_date>=date(attendance.work_date,'-2 days') AND other.work_date<=date(attendance.work_date,'+2 days') AND other.id<>attendance.id AND other.interval_start<attendance.interval_end AND other.interval_end>attendance.interval_start)`;

// Checking rate coverage does not need minute-by-minute wage lines. Pause-only
// dates do not require a rate, exactly as in Time.payroll's paid-minute loop.
export function payrollCoverage(entry,resolved){
  const range=Time.span(entry);if(!range||Time.validate(entry).length||Time.hasDSTAmbiguity(entry))return false;
  const pauses=Time.breaks(entry,range),agreements=resolved.payroll.agreements;
  const exact=entry.timingResolved?entry.resolvedStartAt:entry.breakAllocation==='clocked'?entry.clockStartAt:null;
  if(exact&&Time.validInstant(exact)&&Time.crossesOffsetChange(exact,entry.resolvedEndAt||entry.clockEndAt)){
    // Rare resolved DST crossings need the existing exact-instant arithmetic.
    return !Time.payroll(entry,resolved).unavailableReason;
  }
  for(let day=Math.floor(range.start/1440);day<=Math.floor((range.end-1)/1440);day++){
    const from=Math.max(range.start,day*1440),to=Math.min(range.end,(day+1)*1440),paused=pauses.reduce((sum,pause)=>sum+Math.max(0,Math.min(to,pause.end)-Math.max(from,pause.start)),0);
    if(to-from<=paused)continue;
    const date=Time.addDays(entry.date,day);
    if(!agreements.some(agreement=>agreement.from<=date)||resolved.missingBasePeriods?.some(period=>date>=period.from&&date<=period.to))return false;
  }
  return true;
}
function normalized(payload,fail){
  const queue=payload.queue,search=payload.search??'',scope=payload.scope??'real',pageSize=payload.pageSize??50;
  if(!queues.has(queue)||typeof search!=='string'||search.length>120||/[\u0000-\u001f\u007f]/.test(search)||!['real','demo'].includes(scope)||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>50)fail(400,'time_page_invalid','Vælg et gyldigt filter og højst 50 registreringer pr. side.');
  return {queue,search:search.trim().toLocaleLowerCase('da-DK'),scope,pageSize};
}
function add(target,entry,bucket,canViewPayroll){
  target.counts.all++;target.counts[bucket]++;
  sum(target,'registeredMinutes',entry.workedMinutes);
  if(entry.status==='approved'){
    sum(target,'approvedMinutes',entry.workedMinutes);
    if(canViewPayroll&&entry.payroll&&!entry.payroll.unavailableReason&&validMoney(entry.payroll.totalCents)){
      sum(target,'approvedCents',entry.payroll.totalCents);
      sum(target,'baseCents',validMoney(entry.payroll.baseCents)?entry.payroll.baseCents:0);
      sum(target,'supplementCents',validMoney(entry.payroll.supplementCents)?entry.payroll.supplementCents:0);
    }
  }
  if(canViewPayroll&&entry.status==='approved'&&entry.end&&(!entry.payroll||entry.payroll.unavailableReason||!validMoney(entry.payroll.totalCents)))target.missingPayrollCount++;
}
export async function readPlannerTimePage({db,context,payload,range,frame,header,document,helpers:h,caps,stamp,hydrate}){
  const filter=normalized(payload,h.fail),workspaceId=context.workspace.id;
  const ledgerVersion=header?.version||0;
  const salaryHead=caps.viewPayroll?await first(db,`SELECT COALESCE((SELECT version FROM workspace_payroll_policies WHERE workspace_id=?),0) AS policy_version,COALESCE(SUM(version),0) AS person_versions,COUNT(*) AS people FROM workspace_payroll WHERE workspace_id=?`,workspaceId,workspaceId):null;
  const generation=JSON.stringify([workspaceId,context.member.userId||context.member.id,caps.viewPayroll===true,ledgerVersion,header?.write_token||'',frame.planRevision,frame.planToken,frame.directoryRevision,frame.directoryToken,salaryHead,range.from,range.to,payload.personId||'',{search:filter.search,scope:filter.scope},Time.localNow(new Date(stamp)).date,Time.copenhagenOffset(stamp)]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(generation+JSON.stringify([filter.queue,filter.pageSize]))),key=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  let after=null;
  if(payload.cursor!==undefined&&payload.cursor!==null){if(typeof payload.cursor!=='string'||payload.cursor.length>16384)h.fail(400,'time_page_invalid','Hent den første side af registreringerne igen.');try{const cursor=JSON.parse(payload.cursor);if(cursor?.schema!==1||cursor.key!==key||!Array.isArray(cursor.after)||cursor.after.length!==2||!Time.validDate(cursor.after[0])||typeof cursor.after[1]!=='string'||cursor.after[1].length>512)throw Error('invalid');after=cursor.after;}catch{h.fail(409,'time_page_changed','Listen eller filtrene er ændret. Hent den første side igen.');}}
  let cache=caches.get(db);if(!cache){cache=new Map();caches.set(db,cache);}
  const summaryKey=generation;
  const cached=cache.get(summaryKey),reuse=cached&&Date.now()-cached.at<15000;
  const summary=reuse?cached.summary:totals(),people=reuse?null:new Map(),selected=[],selectedReviews=new Map(),selectedOverlaps=new Map();
  let position=reuse?after:null,more=false,bytes=0,selectionClosed=false;
  const resolvedCache=new Map();let resolvedBytes=0;
  const demoShifts=new Map((document.demo?.shifts||[]).map(shift=>[shift.id,shift]));
  const demoPlanned=new Map();if(filter.scope==='demo')for(const shift of demoShifts.values())if(shift.date>=range.from&&shift.date<=range.to&&(!payload.personId||shift.person===payload.personId)){const minutes=Time.plannedMinutes(shift);if(Number.isFinite(minutes))demoPlanned.set(shift.person,(demoPlanned.get(shift.person)||0)+minutes);}
  for(;;){
    const where=['attendance.workspace_id=?','attendance.work_date>=?','attendance.work_date<=?','attendance.demo=?'],values=[workspaceId,range.from,range.to,filter.scope==='demo'?1:0];
    if(payload.personId){where.push('attendance.person_id=?');values.push(payload.personId);}
    if(position){where.push('(attendance.work_date>? OR (attendance.work_date=? AND attendance.id>?))');values.push(position[0],position[0],position[1]);}
    if(filter.search){where.push(`(instr(lower(COALESCE((SELECT directory.name_sort FROM workspace_directory_records directory WHERE directory.workspace_id=attendance.workspace_id AND directory.kind='employee' AND directory.id=attendance.person_id),'')),?)>0 OR instr(attendance.work_date,?)>0 OR instr(lower(COALESCE((SELECT site.name_sort FROM workspace_directory_records site WHERE site.workspace_id=attendance.workspace_id AND site.kind='site' AND site.site_index=json_extract(attendance.config,'$.site')),'')),?)>0)`);values.push(filter.search,filter.search,filter.search);}
    const metadata=await rows(db,`SELECT attendance.id,attendance.work_date,attendance.version,length(CAST(attendance.config AS BLOB)) AS bytes FROM workspace_time_entries attendance WHERE ${where.join(' AND ')} ORDER BY attendance.work_date,attendance.id LIMIT ?`,...values,BATCH);
    if(!metadata.length)break;
    let scanBytes=0;const chosen=[];for(const item of metadata){if(scanBytes+item.bytes>PAGE_BYTES)break;chosen.push(item);scanBytes+=item.bytes;}
    if(!chosen.length)h.fail(413,'time_entry_full','En tidsregistrering fylder for meget. Kontakt administratoren.');
    const batch=await rows(db,`SELECT attendance.id,attendance.person_id,attendance.work_date,attendance.version,length(CAST(attendance.config AS BLOB)) AS bytes,${compact} AS facts,${overlap} AS has_overlap FROM json_each(?) chosen CROSS JOIN workspace_time_entries attendance WHERE attendance.workspace_id=? AND attendance.id=json_extract(chosen.value,'$.id') AND attendance.version=json_extract(chosen.value,'$.version') AND length(CAST(attendance.config AS BLOB))<=json_extract(chosen.value,'$.bytes') ORDER BY attendance.work_date,attendance.id`,JSON.stringify(chosen),workspaceId);
    if(batch.length!==chosen.length)h.fail(409,'time_conflict','Registreringerne ændrede sig under indlæsningen. Hent timerne igen.');
    const facts=batch.map(row=>{const entry=JSON.parse(row.facts);for(const name of compactFields)if(entry[name]===null)delete entry[name];if(entry.id!==row.id||entry.personId!==row.person_id||entry.date!==row.work_date||entry.version!==row.version)h.fail(500,'time_ledger_invalid','Tidsregistreringerne kunne ikke læses sikkert.');Object.assign(entry,Time.summary(entry));if(row.has_overlap)entry.flags.push('overlap');if(!entry.demo&&(Time.hasDSTAmbiguity(entry)||entry.clockStartAt&&!entry.clockEndAt&&Time.crossesOffsetChange(entry.clockStartAt,stamp)))entry.flags.push('dst_transition');return entry;});
    const shifts=filter.scope==='demo'?demoShifts:new Map((await readPublishedTimeShifts({db,workspaceId,ids:[...new Set(facts.map(entry=>entry.shiftId))]})).map(shift=>[shift.id,shift]));
    const needRates=caps.viewPayroll?facts.filter(entry=>entry.end&&!entry.payroll&&Time.validate(entry).length===0&&!entry.flags.includes('dst_transition')):[];
    const bundle=needRates.length?await h.payrollBundle(db,context,{personIds:[...new Set(needRates.map(entry=>entry.personId))]}):null;
    const needs=new Set(needRates),personalById=new Map((bundle?.people||[]).map(person=>[person.personId,person])),scopedPolicies=new Map();
    for(let index=0;index<facts.length;index++){
      const entry=facts[index],meta=batch[index];
      if(bundle&&needs.has(entry)){const personal=personalById.get(entry.personId),rateKey=JSON.stringify([entry.personId,personal?.version||0,entry.date,entry.endDate||entry.date]);let resolved=resolvedCache.get(rateKey)?.value;if(!resolved){if(!scopedPolicies.has(entry.personId))scopedPolicies.set(entry.personId,personPolicy(bundle.policy,entry.personId));resolved=Groups.resolve({policy:scopedPolicies.get(entry.personId),personId:entry.personId,payroll:personal?.payroll||null,from:entry.date,to:entry.endDate||entry.date});const bytes=JSON.stringify(resolved).length;if(bytes<=1024*1024){resolvedCache.set(rateKey,{value:resolved,bytes});resolvedBytes+=bytes;while(resolvedCache.size>16||resolvedBytes>1024*1024){const oldest=resolvedCache.keys().next().value;resolvedBytes-=resolvedCache.get(oldest).bytes;resolvedCache.delete(oldest);}}}entry.payroll=entry.status==='approved'?Time.payroll(entry,resolved):payrollCoverage(entry,resolved)?{totalCents:0}:{totalCents:0,unavailableReason:'Lønaftalen dækker ikke hele registreringen.'};}
      const review=Time.review(entry,{shift:shifts.get(entry.shiftId),canViewPayroll:caps.viewPayroll===true,today:filter.scope==='demo'?(document.demo?.demoClockDate||document.demo?.clockDate):Time.localNow(new Date(stamp)).date});
      if(!reuse){add(summary,entry,review.bucket,caps.viewPayroll);if(!people.has(entry.personId))people.set(entry.personId,totals(entry.personId));add(people.get(entry.personId),entry,review.bucket,caps.viewPayroll);}
      if(after&&(meta.work_date<after[0]||meta.work_date===after[0]&&meta.id<=after[1]))continue;
      if(filter.queue!=='all'&&review.bucket!==filter.queue)continue;
      if(selectionClosed||selected.length>=filter.pageSize||bytes+meta.bytes>PAGE_BYTES){selectionClosed=true;if(!selected.length)h.fail(413,'time_entry_full','En tidsregistrering fylder for meget. Kontakt administratoren.');more=true;continue;}
      selected.push({id:meta.id,version:meta.version,bytes:meta.bytes});selectedReviews.set(meta.id,review);selectedOverlaps.set(meta.id,batch[index].has_overlap===1);bytes+=meta.bytes;
    }
    position=[batch.at(-1).work_date,batch.at(-1).id];
    if(reuse&&more)break;
  }
  if(!reuse){summary.people=[...people.values()];summary.canViewPayroll=caps.viewPayroll===true;if(!caps.viewPayroll)for(const item of [summary,...summary.people]){delete item.approvedCents;delete item.baseCents;delete item.supplementCents;delete item.missingPayrollCount;}if(JSON.stringify(summary).length<2*1024*1024){cache.set(summaryKey,{at:Date.now(),summary});while(cache.size>4)cache.delete(cache.keys().next().value);}}
  const data=selected.length?await rows(db,`SELECT attendance.config FROM json_each(?) chosen CROSS JOIN workspace_time_entries attendance WHERE attendance.workspace_id=? AND attendance.id=json_extract(chosen.value,'$.id') AND attendance.version=json_extract(chosen.value,'$.version') AND length(CAST(attendance.config AS BLOB))<=json_extract(chosen.value,'$.bytes') ORDER BY attendance.work_date,attendance.id`,JSON.stringify(selected),workspaceId):[];
  if(data.length!==selected.length)h.fail(409,'time_conflict','Registreringerne ændrede sig under indlæsningen. Hent timerne igen.');
  const rawEntries=data.map(row=>{const entry=JSON.parse(row.config);entry._hasOverlap=selectedOverlaps.get(entry.id);return entry;});
  const entries=(await hydrate(rawEntries)).map(entry=>({...entry,review:selectedReviews.get(entry.id)}));
  const shifts=filter.scope==='demo'?[...demoShifts.values()].filter(shift=>entries.some(entry=>entry.shiftId===shift.id)):await readPublishedTimeShifts({db,workspaceId,ids:entries.map(entry=>entry.shiftId)});
  const last=entries.at(-1),nextCursor=more&&last?JSON.stringify({schema:1,key,after:[last.date,last.id]}):null;
  const current=await first(db,'SELECT version,write_token FROM workspace_timekeeping WHERE workspace_id=?',workspaceId);
  const finalSalary=caps.viewPayroll?await first(db,`SELECT COALESCE((SELECT version FROM workspace_payroll_policies WHERE workspace_id=?),0) AS policy_version,COALESCE(SUM(version),0) AS person_versions,COUNT(*) AS people FROM workspace_payroll WHERE workspace_id=?`,workspaceId,workspaceId):null;
  if((current?.version||0)!==ledgerVersion||(current?.write_token||'')!==(header?.write_token||'')||JSON.stringify(salaryHead)!==JSON.stringify(finalSalary))h.fail(409,'time_conflict','Registreringerne eller lønsatserne ændrede sig under indlæsningen. Hent timerne igen.');
  return {entries,shifts,nextCursor,summary,...(filter.scope==='demo'?{plannedRows:[...demoPlanned].map(([personId,plannedMinutes])=>({personId,plannedMinutes}))}:{}),matchedCount:summary.counts[filter.queue],page:{...filter},ledgerVersion};
}
