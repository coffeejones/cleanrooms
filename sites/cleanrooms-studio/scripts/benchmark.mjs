#!/usr/bin/env node
/* Local route/SQL-shape measurements, not a production load or SLA test. */
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {database,seed,routes,PERIOD,WORKER,CLOCK} from './benchmark-fixtures.mjs';
import {viewportBenchmark} from './benchmark-viewport.mjs';

const args=process.argv.slice(2),options={};for(let index=0;index<args.length;index++){assert.match(args[index],/^--[a-z-]+$/);options[args[index].slice(2)]=args[++index];}
const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(options['source-root']||repoRoot),counts=(options.staff||'100,500').split(',').map(Number),repetitions=Number(options.repetitions||5);
assert.ok(counts.length&&counts.every(value=>Number.isInteger(value)&&value>=2&&value<=500));assert.ok(Number.isInteger(repetitions)&&repetitions>=1&&repetitions<=7);
assert.ok(options['employee-protocol']===undefined||['legacy','scoped'].includes(options['employee-protocol']));
assert.ok(options['planner-protocol']===undefined||['full','deferred'].includes(options['planner-protocol']));
assert.ok(options['calendar-protocol']===undefined||['bulk','viewport','scrolling'].includes(options['calendar-protocol']));
async function sourceManifest(){
  const files=new Map();async function scan(file){if(files.has(file))return;const content=await readFile(join(sourceRoot,file),'utf8');files.set(file,createHash('sha256').update(content).digest('hex'));for(const match of content.matchAll(/(?:from\s*|require\(\s*)['"](\.[^'"]+)['"]/g)){const dependency=resolve(sourceRoot,dirname(file),match[1]);await scan(dependency.slice(sourceRoot.length+1));}}
  await scan('lib/workspace-store.mjs');await scan('lib/studio-store.mjs');await scan('lib/publication-store.mjs');for(const file of ['department-model.js','publication-model.js','series-engine.js','shift-workflow-model.js','checklist-progress.js'])await scan('src/'+file);
  if(options['calendar-protocol'])for(const file of ['studio-persistence.js','planning-window.js','planning-scope.js','planning-records.js',...(['viewport','scrolling'].includes(options['calendar-protocol'])?['planning-viewport.js','planning-reconcile.js']:[])])await scan('src/'+file);
  for(const file of (await readdir(join(sourceRoot,'drizzle'))).filter(value=>value.endsWith('.sql')))files.set('drizzle/'+file,createHash('sha256').update(await readFile(join(sourceRoot,'drizzle',file))).digest('hex'));
  const entries=[...files].sort(([a],[b])=>a.localeCompare(b)),hash=createHash('sha256');for(const [file,version]of entries)hash.update(file+'\0'+version+'\0');return {hash:hash.digest('hex'),files:Object.fromEntries(entries)};
}
const OriginalDate=globalThis.Date;globalThis.Date=class extends OriginalDate{constructor(...values){super(...(values.length?values:[CLOCK]));}static now(){return OriginalDate.parse(CLOCK);}};
const load=async file=>import(pathToFileURL(join(sourceRoot,file)).href),require=createRequire(join(sourceRoot,'package.json'));
const modules={Store:await load('lib/studio-store.mjs'),Workspace:await load('lib/workspace-store.mjs'),PublicationStore:await load('lib/publication-store.mjs'),Departments:require('./src/department-model.js'),Publication:require('./src/publication-model.js'),Series:require('./src/series-engine.js'),Workflow:require('./src/shift-workflow-model.js'),Checklist:require('./src/checklist-progress.js')};
let revision;try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{revision=options.revision||'archived-source';}
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const round=value=>Math.round(value*100)/100;
async function measure(db,run){const prepared=await run.prepare?.();db.reset();const cpu=process.cpuUsage(),start=performance.now();try{const result=await run(prepared),elapsedMs=round(performance.now()-start),used=process.cpuUsage(cpu),verify=result.verify;delete result.verify;verify?.();return {elapsedMs,localCpuMs:round((used.user+used.system)/1000),...db.stats,...result,rssMiB:round(process.memoryUsage().rss/1024/1024)};}catch(error){const used=process.cpuUsage(cpu);return {elapsedMs:round(performance.now()-start),localCpuMs:round((used.user+used.system)/1000),...db.stats,error:error.message,status:0};}}
function aggregate(samples){const valid=samples.filter(sample=>!sample.error&&sample.status>=200&&sample.status<300),keys=['payloadBytes','statements','resultRows','resultBytes','batches','pages','logicalReads'];return {successful:valid.length,attempts:samples.length,p50Ms:valid.length?round(percentile(valid.map(value=>value.elapsedMs),.5)):null,p95Ms:valid.length?round(percentile(valid.map(value=>value.elapsedMs),.95)):null,localCpuP50Ms:valid.length?round(percentile(valid.map(value=>value.localCpuMs),.5)):null,localCpuP95Ms:valid.length?round(percentile(valid.map(value=>value.localCpuMs),.95)):null,...Object.fromEntries(keys.map(key=>[key,valid.length?round(valid.reduce((sum,value)=>sum+(value[key]||0),0)/valid.length):null])),samples};}
const manifest=await sourceManifest(),report={schema:1,label:options.label||'current',revision,sourceHash:manifest.hash,sourceFiles:manifest.files,sourceRoot,employeeProtocol:options['employee-protocol']||'scoped',plannerProtocol:options['planner-protocol']||'full',calendarProtocol:options['calendar-protocol']||'route-only',plannerDetailContract:options['planner-protocol']==='deferred'?'Actual plannerDetail request after a calendar receipt':'Instructions are prefetched with the calendar; opening a shift requires no extra HTTP request, so no detail route latency is measured',fixedClock:CLOCK,repetitions,generatedAt:new OriginalDate().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch},methodology:'Sequential actual route calls over isolated migrated node:sqlite databases. Timing includes route work and HTTP JSON serialization/reading, excludes fixture seeding. Local process.cpuUsage milliseconds include native SQLite and Node work and are not Cloudflare Worker CPU billing. SQL rows/bytes are values returned to JavaScript, not engine rows scanned or Cloudflare billed rows. First call is not an OS cold-cache guarantee. p95 with <=7 samples is descriptive only.',fixtures:[]};
for(const employees of counts){
  process.stderr.write('Seeding '+employees+' employees from '+sourceRoot+'\n');const db=await database(sourceRoot);
  try{
    const fixture=await seed(db,modules,employees,{onProgress:message=>process.stderr.write(employees+': '+message+'\n')}),api=routes(db,modules.Workspace),result={fixture,operations:[]};let calendarReceipt=null;
    const single=async(kind,options)=>{const value=await api(kind,options);return {status:value.status,payloadBytes:value.payloadBytes,...(value.status>=400?{error:value.body.message||value.body.error}:{}),responseCounts:{employeeShifts:value.body.employee?.shifts?.length,entries:value.body.entries?.length,requests:value.body.requests?.length,notifications:value.body.notifications?.length,deliveries:value.body.deliveries?.length,ownShifts:value.body.ownShifts?.length,openShifts:value.body.openShifts?.length}};};
    const operations=[
      ['calendar_eight_weeks',async()=>{let cursor=null,payloadBytes=0,pages=0;do{const page=await api('studio',{query:{projection:'calendar',from:PERIOD.from,to:'2026-12-27',...(options['planner-protocol']==='deferred'?{instructions:'deferred'}:{}),...(cursor?{cursor}:{})}});payloadBytes+=page.payloadBytes;pages++;if(page.status!==200)return {status:page.status,error:page.body.message||page.body.error,payloadBytes,pages};if(!cursor)calendarReceipt={revision:page.body.revision,directoryRevision:page.body.directory?.revision};cursor=page.body.nextCursor;assert.ok(pages<1000);}while(cursor);return {status:200,payloadBytes,pages};}],
      ['hours_week',()=>single('account',{action:'timeRead',payload:{from:'2026-10-26',to:'2026-11-01'}})],
      ['absence_page',()=>single('account',{action:'leaveRead',payload:{status:'pending',from:PERIOD.from,to:PERIOD.to,limit:40}})],
      ['employee_bootstrap',()=>single('studio',{actor:WORKER})],
      ['employee_month',()=>options['employee-protocol']==='legacy'?single('studio',{actor:WORKER}):single('account',{actor:WORKER,action:'employeeRead',payload:{from:PERIOD.from,to:PERIOD.to,limit:40}})],
      ['employee_detail',()=>options['employee-protocol']==='legacy'?single('studio',{actor:WORKER}):single('account',{actor:WORKER,action:'employeeShift',payload:{shiftId:fixture.detailShiftId}})],
      ['workflow_manager',()=>single('account',{action:'workflowRead',payload:{...PERIOD,limit:40}})],
      ['workflow_employee',()=>single('account',{actor:WORKER,action:'workflowRead',payload:{...PERIOD,limit:40}})],
      ['workflow_badges',()=>single('account',{action:'workflowRead',payload:{summary:true,...PERIOD,limit:40}})]
    ];
    if(options['calendar-protocol'])operations.splice(1,0,...(await viewportBenchmark(sourceRoot,api)).operations(options['calendar-protocol']));
    if(options['planner-protocol']==='deferred')operations.splice(1,0,['planner_detail_extra',async()=>{
      assert.ok(Number.isSafeInteger(calendarReceipt?.revision)&&Number.isSafeInteger(calendarReceipt?.directoryRevision),'A planner detail needs its observed calendar receipt');const value=await api('account',{action:'plannerDetail',payload:{...calendarReceipt,shiftIds:[fixture.detailShiftId]}});
      if(value.status!==200)return {status:value.status,payloadBytes:value.payloadBytes,error:value.body.message||value.body.error};return {status:200,payloadBytes:value.payloadBytes,instructionsVerified:true,taskCount:fixture.tasksPerLongDescription,verify(){const detail=value.body.detailShifts?.find(shift=>shift.id===fixture.detailShiftId),hash=text=>'sha256:'+createHash('sha256').update(text).digest('hex');assert.ok(detail,'The requested concrete occurrence must be returned');assert.equal(hash(detail.note),fixture.expectedDetailHashes.note,'Long plain description was changed or truncated');assert.equal(hash(detail.noteRich),fixture.expectedDetailHashes.noteRich,'Rich instructions were changed or truncated');assert.equal(modules.Checklist.read(value.body.progress||{},detail).total,fixture.tasksPerLongDescription,'The complete checklist must survive lazy loading');}};
    }]);
    for(const [name,run]of operations){process.stderr.write(employees+': '+name+'\n');globalThis.gc?.();const first=await measure(db,run),samples=[];for(let repeat=0;repeat<repetitions;repeat++)samples.push(await measure(db,run));result.operations.push({name,firstCall:first,warm:aggregate(samples)});}
    report.fixtures.push(result);
  }finally{await db.close();globalThis.gc?.();}
}
const finished=await sourceManifest();report.changedSourceFiles=[...new Set([...Object.keys(manifest.files),...Object.keys(finished.files)])].filter(file=>manifest.files[file]!==finished.files[file]);report.sourceChangedDuringRun=manifest.hash!==finished.hash;const json=JSON.stringify(report,null,2)+'\n';if(options.out){await writeFile(resolve(options.out),json);process.stderr.write('Wrote '+resolve(options.out)+'\n');}else process.stdout.write(json);
