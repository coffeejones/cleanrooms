/* Isolated, deterministic fixtures; no production database or credentials. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdir,readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';

export const CLOCK='2026-11-03T10:00:00.000Z';
export const YEAR={from:'2026-06-01',to:'2027-05-30'};
export const PERIOD={from:'2026-11-02',to:'2026-11-29'};
export const OWNER={id:'benchmark-owner',email:'owner@benchmark.example'};
export const WORKER={id:'benchmark-worker',email:'worker@benchmark.example'};
export const bytes=value=>Buffer.byteLength(JSON.stringify(value));
export const add=(day,count)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};

export async function database(sourceRoot){
  const directory=await mkdtemp(join(tmpdir(),'cleanrooms-benchmark-db-')),sqlite=new DatabaseSync(join(directory,'fixture.sqlite'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of (await readdir(join(sourceRoot,'drizzle'))).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(await readFile(join(sourceRoot,'drizzle',file),'utf8'));
  let stats={};const reset=()=>{stats={batches:0,statements:0,resultRows:0,resultBytes:0,writeStatements:0};};reset();
  const db={sqlite,reset,get stats(){return {...stats};},prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{
    stats.batches++;sqlite.exec('BEGIN IMMEDIATE');
    try{
      const output=statements.map(({sql,values})=>{
        assert.ok(values.length<=100,'D1 parameter budget exceeded');
        assert.ok(values.every(value=>typeof value!=='string'||Buffer.byteLength(value)<=2*1024*1024),'D1 bound string budget exceeded');
        stats.statements++;const query=sqlite.prepare(sql);
        if(query.columns().length){const results=query.all(...values);stats.resultRows+=results.length;stats.resultBytes+=bytes(results);return {results,meta:{changes:0}};}
        stats.writeStatements++;return {results:[],meta:{changes:Number(query.run(...values).changes)}};
      });sqlite.exec('COMMIT');return output;
    }catch(error){sqlite.exec('ROLLBACK');throw error;}
  };
  db.close=async()=>{sqlite.close();await rm(directory,{recursive:true,force:true});};return db;
}

export function routes(db,Workspace){
  return async function api(kind,{actor=OWNER,query,action,payload={}}={}){
    const path=kind==='studio'?'/api/studio':'/api/accounts',method=kind==='studio'?'GET':'POST';
    const request=new Request('https://benchmark.example'+path+(query?'?'+new URLSearchParams(query):''),{method,headers:{'oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email,'oai-authenticated-user-full-name':actor.id,...(method==='POST'?{origin:'https://benchmark.example','content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({action,...payload})}:{})});
    const response=await (kind==='studio'?Workspace.handleWorkspaceStudioRequest:Workspace.handleAccountsRequest)(request,db),text=await response.text();
    return {status:response.status,body:JSON.parse(text),payloadBytes:Buffer.byteLength(text)};
  };
}

function description(index){
  if(index%10!==0)return {note:'Rengøring og afsluttende kontrol på arbejdsstedet.'};
  const note=('Arbejdsinstruktion: Kontrollér adgang, materialer og sikkerhed. Meld mangler til den ansvarlige. ').repeat(44);
  return {note,noteRich:JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:note}]},{type:'taskList',content:['Kontrollér adgang','Rengør overflader','Tøm affald','Fyld materialer op','Kontrollér afslutningen','Lås og aktivér alarm'].map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]})};
}

export async function seed(db,modules,employees,{onProgress=()=>{}}={}){
  const {Store,Departments,PublicationStore,Publication,Series,Workflow,Checklist}=modules,api=routes(db,modules.Workspace),organization=Departments.defaultOrganization(),roster=Array.from({length:employees},(_,index)=>({id:'person-benchmark-'+String(index).padStart(4,'0'),name:'Medarbejder '+String(index+1).padStart(4,'0'),initials:'M'+index%10,site:index%3,target:37,role:index%7===0?'Teamleder':'Servicemedarbejder',active:true})),series=roster.map((person,index)=>({id:'benchmark-series-'+index,groupId:'benchmark-agreement-'+index,person:person.id,site:person.site,startDate:YEAR.from,endDate:YEAR.to,weekdays:index%2?[1,3,5]:[0,2,4],start:index%5===0?'06:00':'07:00',end:index%5===0?'14:00':'15:00',plannedBreakMinutes:30,...description(index)}));
  const studio={storageVersion:1,demoSeed:false,calendarAnchor:PERIOD.from,roster,organization,series,edits:{},deleted:[],weekPlans:{},requests:{},leaveDecisions:{},coverageRules:[],checklistProgress:{},publications:Publication.empty(),shiftWorkflow:Workflow.empty()};
  assert.equal((await Store.writeStudio(db,OWNER.id,0,studio)).ok,true);
  db.reset();let start=performance.now();const bootstrap=await api('studio');const importMeasurement={...db.stats,elapsedMs:performance.now()-start,payloadBytes:bootstrap.payloadBytes,status:bootstrap.status,context:'Cold legacy metadata/series/directory import before normalized year publication seeding'};assert.equal(bootstrap.status,200,JSON.stringify(bootstrap.body));const workspaceId=bootstrap.body.workspace.id;
  // Fixture membership uses the actual migrated schema. Timed requests still
  // resolve live identity, membership, role and tenant through real API routes.
  const member=db.sqlite.prepare("INSERT INTO workspace_members (user_id,workspace_id,email,name,role,role_id,manage_departments,person_id,status,version,preferences,created_at,updated_at) VALUES (?,?,?,?,'employee','employee',0,?,'active',1,?,?,?)");
  db.sqlite.exec('BEGIN');for(const [index,person]of roster.entries())member.run(index===0?WORKER.id:'benchmark-worker-'+index,workspaceId,index===0?WORKER.email:'worker'+index+'@benchmark.example',person.name,person.id,JSON.stringify({employeeDate:PERIOD.from,employeeView:'month'}),CLOCK,CLOCK);db.sqlite.exec('COMMIT');
  const empty={publications:Publication.empty()},attendance=db.sqlite.prepare('INSERT INTO workspace_time_entries (workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at,interval_start,interval_end) VALUES (?,?,?,?,?,?,?,0,1,?,?,?,NULL,NULL)'),messages=db.sqlite.prepare('INSERT INTO workspace_shift_messages (workspace_id,id,person_id,kind,created_at,config) VALUES (?,?,?,?,?,?)'),receipts=db.sqlite.prepare('INSERT INTO workspace_message_receipts (workspace_id,message_id,person_id,read_at) VALUES (?,?,?,?)'),requests=db.sqlite.prepare('INSERT INTO workspace_shift_requests (workspace_id,id,shift_id,kind,from_person_id,to_person_id,status,version,config,updated_at,write_token) VALUES (?,?,?,?,?,?,?,1,?,?,?)');
  let publishedCount=0,attendanceCount=0,openCount=0,checkedCount=0;const sampleFuture=[],checked=[],taskInsert=db.sqlite.prepare('INSERT INTO workspace_checklist_tasks (workspace_id,shift_id,person_id,task_key,signature,structure,checked,version,updated_at) VALUES (?,?,?,?,?,?,1,1,?)'),hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
  start=performance.now();
  for(let week=0;week<52;week++){
    const from=add(YEAR.from,week*7),to=add(from,6),slots=Object.fromEntries(organization.sites.map((site,index)=>[from+'|'+index,{from,to,site:index,location:{...site,index},publicationId:'benchmark-publication-'+week,at:CLOCK,actor:{userId:OWNER.id,name:'Benchmark owner'},shifts:[]}])) ,weekShifts=[];
    for(const source of series){const shifts=Series.enumerate(source,{from,to});for(const shift of shifts){slots[from+'|'+shift.site].shifts.push(shift);weekShifts.push(shift);if(shift.person===roster[0].id&&shift.date>=PERIOD.from&&shift.date<=PERIOD.to)checked.push(shift);if(shift.date>='2026-11-09'&&shift.date<='2026-11-15')sampleFuture.push(shift);}}
    const open={id:'benchmark-open-'+week,person:'',site:0,date:from,start:'16:00',end:'19:00',plannedBreakMinutes:0,note:'Ledig ekstra vagt'};slots[from+'|0'].shifts.push(open);openCount++;
    const after={publications:{...Publication.empty(),slots}},statements=await PublicationStore.publicationWriteStatements({db,workspaceId,before:empty,after,condition:{sql:'1=1',values:[]},token:'benchmark-week-'+week,at:CLOCK});
    const guard=statements.guard;assert.equal(db.sqlite.prepare('SELECT 1 AS allowed WHERE '+guard.sql).get(...guard.values)?.allowed,1,'Fixture publication precondition');await db.batch(statements);publishedCount+=weekShifts.length+1;
    db.sqlite.exec('BEGIN');for(const shift of weekShifts){if(week%4===0&&shift.noteRich){const view=Checklist.read({},shift),structure=hash(JSON.stringify(view.tasks.map(task=>task.key)));for(const task of view.tasks.slice(0,2)){taskInsert.run(workspaceId,shift.id,shift.person,task.key,hash(task.signature),structure,CLOCK);checkedCount++;}}if(shift.date>='2026-11-02')continue;const id='benchmark-entry-'+shift.id,status=shift.date<'2026-10-26'?'approved':'submitted',entry={id,shiftId:shift.id,personId:shift.person,date:shift.date,endDate:shift.date,site:shift.site,version:1,status,demo:false,start:shift.start,end:shift.end,plannedStart:shift.start,plannedEnd:shift.end,plannedBreakMinutes:30,breakMinutes:30,breaks:[],breakAllocation:'end-of-shift',comment:attendanceCount%25===0?'Døren var låst ved ankomst.':'',correctionReason:'',createdAt:CLOCK,updatedAt:CLOCK,approvedAt:status==='approved'?CLOCK:null,approvedBy:status==='approved'?{userId:OWNER.id,name:'Benchmark owner'}:null,audit:[],frozenShift:{id:shift.id,person:shift.person,date:shift.date,site:shift.site,start:shift.start,end:shift.end,plannedBreakMinutes:30},...(status==='approved'?{payroll:{currency:'DKK',baseCents:135000,supplementCents:0,totalCents:135000,lines:[],monthlyLines:[],sourceLabel:'Benchmark standard',policyVersion:0,personVersion:0}}:{})};attendance.run(workspaceId,id,shift.id,shift.person,shift.date,shift.date,status,JSON.stringify(entry),'benchmark-attendance',CLOCK);attendanceCount++;}db.sqlite.exec('COMMIT');
    if(week%13===12)onProgress('Published '+(week+1)+'/52 weeks');
  }
  // Engagement imports are completed by the cold bootstrap. Durable fixtures
  // intentionally exceed the historical UI cache without filling plan JSON.
  db.sqlite.exec('BEGIN');for(const [index,person]of roster.entries())for(let month=0;month<24;month++){const id='benchmark-message-'+index+'-'+month,createdAt=new Date('2026-11-03T08:00:00.000Z');createdAt.setUTCDate(createdAt.getUTCDate()-month*7);const after=Workflow.summary(sampleFuture.find(shift=>shift.person===person.id),organization.sites),message={id,personId:person.id,kind:month%3?'changed':'new',createdAt:createdAt.toISOString(),readAt:null,before:after,after,summary:month%3?'Vagten er ændret':'Ny vagt'};messages.run(workspaceId,id,person.id,message.kind,message.createdAt,JSON.stringify(message));if(month%4!==0)receipts.run(workspaceId,id,person.id,CLOCK);}
  for(let index=0;index<employees*4;index++){const person=index%employees,target=(person+1)%employees,shift=sampleFuture.find(shift=>shift.person===roster[person].id),id='benchmark-request-'+index,status=index<Math.ceil(employees/10)?'pending':index%2?'approved':'rejected',entry={id,kind:'offer',version:1,fromPersonId:roster[person].id,toPersonId:roster[target].id,status,shift:Workflow.summary(shift,organization.sites),comment:index%5?'':'Kan en kollega overtage denne vagt?',createdAt:CLOCK,updatedAt:CLOCK,decisionReason:status==='rejected'?'Ikke godkendt i denne periode.':''};requests.run(workspaceId,id,shift.id,entry.kind,entry.fromPersonId,entry.toPersonId,status,JSON.stringify(entry),CLOCK,'benchmark-request');}
  const absence=db.sqlite.prepare('INSERT INTO workspace_absences (workspace_id,id,person_id,from_date,to_date,type,status,version,config,write_token,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)');for(let index=0;index<employees*3;index++){const person=roster[index%employees],day=add('2026-10-01',index%90),id='benchmark-absence-'+index,status=index%5?'approved':'pending',entry={id,p:person.id,days:[day],dates:day,type:index%3?'Ferie':'Friønske',status,version:1,comment:index%20?'':'Aftalt ferieønske',createdAt:CLOCK,createdBy:{userId:person.id,name:person.name}};absence.run(workspaceId,id,person.id,day,day,entry.type,status,JSON.stringify(entry),'benchmark-absence',CLOCK);}
  db.sqlite.prepare("INSERT INTO workspace_timekeeping (workspace_id,config,version,write_token,updated_at) VALUES (?, '{\"schema\":2,\"entries\":[],\"demo\":null}',1,'benchmark',?)").run(workspaceId,CLOCK);db.sqlite.exec('COMMIT');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_published_shifts WHERE workspace_id=? AND deleted=0').get(workspaceId).n,publishedCount);
  const expected=description(0);
  return {workspaceId,employees,series:series.length,publishedShifts:publishedCount,openShifts:openCount,attendanceEntries:attendanceCount,checkedTasks:checkedCount,messages:employees*24,requests:employees*4,absences:employees*3,descriptionCharacters:expected.note.length,tasksPerLongDescription:6,longDescriptionPercent:10,expectedDetailHashes:{note:hash(expected.note),noteRich:hash(expected.noteRich)},year:YEAR,fixedNow:CLOCK,seedPublishedMs:performance.now()-start,coldImport:importMeasurement,detailShiftId:checked.find(shift=>shift.date>'2026-11-03')?.id,personId:roster[0].id};
}
