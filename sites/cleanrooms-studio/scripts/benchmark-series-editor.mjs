#!/usr/bin/env node
/* Compare actual deferred series-editor collection against a local Git baseline.
 * Usage: node scripts/benchmark-series-editor.mjs <baseline-commit> [20]
 * Example: node scripts/benchmark-series-editor.mjs ca19d0d6d4a27bf8ed7c876926bff001e43d1440
 *
 * Runs 20 staff with six-month agreements and one published week, plus an annual
 * 20-staff/52-published-week fixture by default. Pass 20,100 for the larger run.
 * Both variants use current schema/shared models,
 * synthetic local SQLite databases and real route authorization/validation SQL.
 * Temporary module/database copies are removed; no production requests, tenant
 * data, credentials or source/Git mutations occur. Counts are not latency/load
 * estimates. SQL result rows/bytes count values returned to JavaScript, not
 * engine rows scanned or Cloudflare billed rows. Completed editor data and
 * authoritative versions must match exactly; pagination order hints are ignored.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { database,seed,routes,OWNER,PERIOD,YEAR,CLOCK } from './benchmark-fixtures.mjs';

const [baselineRef,staffArg='20',...extra]=process.argv.slice(2);
if(!baselineRef||extra.length){console.error('Usage: node scripts/benchmark-series-editor.mjs <baseline-commit> [20] (use 20,100 for the optional larger fixture)');process.exit(2);}
const counts=staffArg.split(',').map(Number);assert.ok(counts.length&&counts.every(value=>Number.isInteger(value)&&value>=2&&value<=500));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const baseline=git(['rev-parse','--verify','--end-of-options',baselineRef+'^{commit}']).trim(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'cleanrooms-series-editor-')),OriginalDate=globalThis.Date;
globalThis.Date=class extends OriginalDate{constructor(...values){super(...(values.length?values:[CLOCK]));}static now(){return OriginalDate.parse(CLOCK);}};
const Planning=require('../src/planning-records.js'),Window=require('../src/planning-window.js'),calendar={from:PERIOD.from,to:'2026-12-13'};

async function modules(variant){
  const dir=path.join(temp,variant);fs.mkdirSync(path.join(dir,'lib'),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');fs.symlinkSync(path.join(root,'src'),path.join(dir,'src'));
  if(variant==='baseline')for(const file of git(['ls-tree','-r','--name-only',baseline,'--','lib']).trim().split('\n').filter(file=>file.endsWith('.mjs'))){const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,git(['show',baseline+':./'+file]));}
  else fs.cpSync(path.join(root,'lib'),path.join(dir,'lib'),{recursive:true});
  const load=file=>import(pathToFileURL(path.join(dir,'lib',file)));
  return {Store:await load('studio-store.mjs'),Workspace:await load('workspace-store.mjs'),PublicationStore:await load('publication-store.mjs'),Departments:require('../src/department-model.js'),Publication:require('../src/publication-model.js'),Series:require('../src/series-engine.js'),Workflow:require('../src/shift-workflow-model.js'),Checklist:require('../src/checklist-progress.js')};
}

async function oneWeek(db,m){
  const organization=m.Departments.defaultOrganization(),roster=Array.from({length:20},(_,index)=>({id:'person-editor-'+index,name:'Demo person '+index,initials:'D'+index,site:index%3,target:37,role:'Service',active:true}));
  const note='Åbning, rengøring og afsluttende kontrol. '.repeat(20),noteRich=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:note}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Lås og aktivér alarm'}]}]}]}]});
  const phase=(id,patch={})=>({id,person:roster[0].id,site:0,startDate:PERIOD.from,endDate:'2027-04-30',weekdays:[0,2,4],start:'07:00',end:'15:00',plannedBreakMinutes:30,note,noteRich,...patch});
  let studio={storageVersion:1,demoSeed:false,calendarAnchor:PERIOD.from,roster,organization,series:[phase('editor-source',{groupId:'editor-agreement'}),phase('editor-past',{groupId:'editor-agreement',startDate:'2026-05-04',endDate:'2026-11-01'}),...roster.slice(1).map((person,index)=>phase('editor-peer-'+index,{person:person.id,site:person.site,weekdays:index%2?[0,2,4]:[1,3]}))],edits:{'editor-source@2026-11-04':{id:'editor-source@2026-11-04',seriesId:'editor-source',person:roster[0].id,site:0,date:'2026-11-05',start:'16:00',end:'18:00',note:'Bevaret undtagelse'},ordinary:{id:'ordinary',person:roster[2].id,site:2,date:'2026-11-03',start:'09:00',end:'12:00',note:'Almindelig vagt'}},deleted:['editor-source@2026-11-06'],weekPlans:{},requests:{},leaveDecisions:{},coverageRules:[],checklistProgress:{},publications:m.Publication.empty(),shiftWorkflow:m.Workflow.empty()};
  studio=m.Publication.publish(studio,{from:PERIOD.from,to:'2026-11-08',siteIds:[0,1,2],actor:{userId:OWNER.id,name:'Benchmark owner'},at:CLOCK}).studio;
  assert.equal((await m.Store.writeStudio(db,OWNER.id,0,studio)).ok,true);const initialized=await routes(db,m.Workspace)('studio');assert.equal(initialized.status,200,JSON.stringify(initialized.body));
  const workspaceId=initialized.body.workspace.id,insert=db.sqlite.prepare('INSERT INTO workspace_absences (workspace_id,id,person_id,from_date,to_date,type,status,version,config,write_token,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)');
  for(const item of [{id:'editor-leave',p:roster[1].id,days:['2026-11-04'],status:'approved'},{id:'editor-pending',p:roster[0].id,days:['2027-01-11'],status:'pending'}])insert.run(workspaceId,item.id,item.p,item.days[0],item.days[0],'Ferie',item.status,JSON.stringify({...item,type:'Ferie',version:1,comment:'Synthetic fixture'}),'fixture',CLOCK);
  return {seriesId:'editor-source',range:{from:PERIOD.from,to:'2027-04-30'},staff:20,publishedWeeks:1,publishedShifts:m.Publication.publishedShifts(studio).length};
}

function semanticView(result){
  const copy=JSON.parse(JSON.stringify(Object.fromEntries(['studio','planning','selection','availability','catalog','directory'].filter(key=>result[key]!==undefined).map(key=>[key,result[key]]))));
  // Calendar and own-record phases can repeat one record with a different
  // transport sortOrder. The immutable body/version, not that hint, is authority.
  delete copy.planning.recordOrder;
  if(copy.planning.deferred)copy.planning.deferred.sort();
  for(const value of [copy.studio,copy.availability,copy.catalog])if(value){
    for(const field of ['series','published','absences'])if(Array.isArray(value[field]))value[field].sort((one,two)=>one.id.localeCompare(two.id));
    if(Array.isArray(value.deleted))value.deleted.sort();
    for(const slot of Object.values(value.publications?.slots||{}))slot.shifts.sort((one,two)=>one.id.localeCompare(two.id));
  }
  for(const field of ['groupIds','seriesIds','scopeKeys'])if(Array.isArray(copy.selection?.[field]))copy.selection[field].sort();
  return copy;
}

async function collect(api,projection){
  const collector=Window.collector(projection,{maxBytes:64*1024*1024,maxRecords:100000}),cursors=new Set();let cursor=null,pages=0,payloadBytes=0,maxPageRows=0,maxPageDataBytes=0;
  do{
    const reply=await api('studio',{query:{projection:'series',selection:JSON.stringify(projection),instructions:'deferred',...(cursor?{cursor}:{})}});assert.equal(reply.status,200,JSON.stringify(reply.body));
    pages++;assert.ok(pages<=1000);payloadBytes+=reply.payloadBytes;const {records,publicationRows,auxRows}=reply.body,count=records.length+publicationRows.length+auxRows.length,bytes=Buffer.byteLength(JSON.stringify({records,publicationRows,auxRows}));
    assert.ok(count<=500);assert.ok(bytes<=1024*1024||count===1,'Only one pre-existing long record may exceed the soft byte budget.');maxPageRows=Math.max(maxPageRows,count);maxPageDataBytes=Math.max(maxPageDataBytes,bytes);
    cursor=collector.add(reply.body);if(cursor){assert.equal(cursors.has(cursor),false);cursors.add(cursor);}
  }while(cursor);
  const result=collector.finish(),view=semanticView(result),viewHash=createHash('sha256').update(Planning.canonical(view)).digest('hex');
  const counts={recordVersions:Object.keys(result.planning.versions).length,ownAndCalendarRecords:Planning.flatten(result.studio).length,availabilitySeries:result.availability?.series.length||0,availabilityEdits:Object.keys(result.availability?.edits||{}).length,publishedAvailability:result.availability?.published.length||0,publishedCalendarShifts:Object.values(result.studio.publications?.slots||{}).reduce((sum,slot)=>sum+slot.shifts.length,0),absences:result.studio.absences?.length||0};
  return {pages,payloadBytes,maxPageRows,maxPageDataBytes,viewHash,counts};
}

try{
  const loaded={baseline:await modules('baseline'),current:await modules('current')};
  for(const fixture of ['one-week',...counts]){
    let expected;
    for(const variant of ['baseline','current']){
      const db=await database(root),m=loaded[variant];
      try{
        const seeded=fixture==='one-week'?await oneWeek(db,m):await seed(db,m,fixture),context=fixture==='one-week'?seeded:{seriesId:'benchmark-series-0',range:YEAR,staff:fixture,publishedWeeks:52,publishedShifts:seeded.publishedShifts},api=routes(db,m.Workspace),projection={mode:'series',seriesId:context.seriesId,ranges:[context.range],calendar};
        await collect(api,projection);db.reset();const result=await collect(api,projection);assert.equal(db.stats.writeStatements,0);
        if(variant==='baseline')expected=result.viewHash;else assert.equal(result.viewHash,expected,'Completed editor data, availability and original versions changed.');
        console.log(JSON.stringify({baseline,variant,fixture,staff:context.staff,publishedWeeks:context.publishedWeeks,publishedShifts:context.publishedShifts,projection,...result,...db.stats}));
      }finally{await db.close();}
    }
  }
}finally{globalThis.Date=OriginalDate;fs.rmSync(temp,{recursive:true,force:true});}
