const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Planning=require('../src/planning-records.js'),Window=require('../src/planning-window.js'),Departments=require('../src/department-model.js');
const owner={id:'catalog-owner',email:'owner@catalog.example'},at='2026-11-03T10:00:00.000Z',calendar={from:'2026-11-02',to:'2026-12-13'},projection={mode:'series-list',calendar,catalogOnly:true};
const clone=value=>JSON.parse(JSON.stringify(value)),series=(id,patch={})=>({id,groupId:id,person:'p0',site:0,startDate:'2026-06-01',endDate:'2027-05-30',weekdays:[0,2,4],start:'07:00',end:'15:00',plannedBreakMinutes:30,note:'',...patch});
const shift=(id,patch={})=>({id,person:'p0',site:0,date:calendar.from,start:'07:00',end:'15:00',note:'',...patch});
const base=patch=>({storageVersion:1,demoSeed:false,calendarAnchor:calendar.from,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[],...patch});
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
 const db={sqlite,queries:[],beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
 db.batch=async statements=>{await db.beforeBatch?.(statements);db.queries.push(...statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{assert.ok(values.length<=100);const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
async function api(db,{scope=projection,cursor,actor=owner,body}={}){
 const params=new URLSearchParams({projection:scope.mode,selection:JSON.stringify(scope),instructions:'deferred',...(cursor?{cursor}:{})}),response=await Workspace.handleWorkspaceStudioRequest(new Request('https://catalog.example/api/studio'+(body?'':'?'+params),{method:body?'PUT':'GET',headers:{'oai-authenticated-user-id':actor.id,'oai-authenticated-user-email':actor.email,...(body?{origin:'https://catalog.example','content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),db);
 return {status:response.status,body:await response.json()};
}
async function setup(initial=base({series:[series('phase')]})){
 const db=database();assert.equal((await Store.writeStudio(db,owner.id,0,initial)).ok,true);const first=await api(db);assert.equal(first.status,200,JSON.stringify(first));db.queries=[];return {db,workspaceId:first.body.workspace.id};
}
async function collect(db,scope=projection){
 const collector=Window.collector(scope),pages=[];let cursor=null;
 do{const page=await api(db,{scope,cursor});assert.equal(page.status,200,JSON.stringify(page));pages.push(page.body);cursor=collector.add(page.body);assert.ok(pages.length<50);}while(cursor);
 return {pages,result:collector.finish()};
}

test('catalog-only reads return templates and exception summaries without calendar or editable authority',async()=>{
 const organization=Departments.defaultOrganization(),published=shift('published',{note:'PRIVATE_PUBLISHED_INSTRUCTIONS'}),initial=base({series:[series('phase',{note:'PRIVATE_SERIES_INSTRUCTIONS'}),series('ended',{startDate:'2023-01-01',endDate:'2023-02-01'})],edits:{'phase@2026-11-04':shift('phase@2026-11-04',{seriesId:'phase',date:'2026-11-05',note:'PRIVATE_EXCEPTION_INSTRUCTIONS'}),ordinary:shift('ordinary',{note:'PRIVATE_ORDINARY_INSTRUCTIONS'})},deleted:['phase@2026-11-06'],publications:{version:1,sequence:1,records:[],slots:{'2026-11-02|0':{from:'2026-11-02',to:'2026-11-08',site:0,location:{...organization.sites[0],index:0},publicationId:'publication',at,actor:{userId:owner.id,name:'Owner'},shifts:[published]}}}}),{db}=await setup(initial);
 const {pages,result}=await collect(db);assert.equal(pages.length,1);const page=pages[0];assert.equal(page.selection.catalogOnly,true);assert.deepEqual(page.selection.ranges,[]);assert.deepEqual(page.records,[]);assert.deepEqual(page.publicationRows,[]);assert.deepEqual(page.planning.versions,{});assert.ok(page.auxRows.every(row=>row.kind==='catalog'));
 assert.equal(result.catalog.series.length,2);assert.equal(result.catalog.series.find(item=>item.id==='phase').hasDescription,true);assert.equal(result.catalog.edits['phase@2026-11-04'].hasDescription,true);assert.ok(result.catalog.deleted.includes('phase@2026-11-06'));assert.equal(result.catalog.edits.ordinary,undefined);assert.equal(result.availability,undefined);assert.equal(result.studio.series.length,0);assert.deepEqual(result.studio.edits,{});assert.equal(result.studio.publications,undefined);assert.equal(Window.covers(result.planning.projection,calendar.from),false);
 assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(db.queries.some(query=>/FROM workspace_publication|FROM workspace_plan_record_chunks/.test(query.sql)),false,'A warm catalog does not hydrate calendar publications or instructions.');
 const full=await Store.readStudio(db,owner.id),pure=Store.projectStudioSelection(full.studio,full.planning,projection);assert.deepEqual(pure.catalog,result.catalog);assert.deepEqual(pure.planning.versions,{});assert.equal(pure.availability,undefined);assert.equal(pure.studio.series.length,0);db.sqlite.close();
});

test('catalog cursors retain all summaries under bounded pages without extending editable coverage',async()=>{
 const {db}=await setup(base({series:Array.from({length:1100},(_,index)=>series('phase-'+String(index).padStart(4,'0')))})),{pages,result}=await collect(db);assert.equal(pages.length,3);assert.equal(result.catalog.series.length,1100);assert.equal(new Set(result.catalog.series.map(item=>item.id)).size,1100);
 assert.ok(pages.every(page=>page.auxRows.length<=500&&page.records.length===0&&page.publicationRows.length===0&&Object.keys(page.planning.versions).length===0));assert.ok(pages.slice(1).every(page=>page.studio===undefined&&page.selection===undefined));assert.ok(pages.slice(0,-1).every(page=>JSON.parse(Buffer.from(page.nextCursor,'base64url').toString()).phase==='catalog'));db.sqlite.close();
});

test('catalog summary repair stays within the selected source-byte budget and skips unrelated records',async()=>{
 const {db}=await setup(base({series:[series('phase-a',{note:'A'.repeat(620000)}),series('phase-b',{note:'B'.repeat(620000)}),series('phase-c',{note:'C'.repeat(620000)})],edits:{ordinary:shift('ordinary',{note:'UNRELATED_NOTE'.repeat(60000)})}}));db.sqlite.prepare('UPDATE workspace_plan_records SET schedule_version=0').run();db.queries=[];
 const first=await api(db);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.auxRows.length,1);assert.ok(first.body.nextCursor);assert.equal(db.sqlite.prepare("SELECT schedule_version FROM workspace_plan_records WHERE id='phase-a'").get().schedule_version,1);assert.equal(db.sqlite.prepare("SELECT schedule_version FROM workspace_plan_records WHERE id='phase-b'").get().schedule_version,0);assert.equal(db.sqlite.prepare("SELECT schedule_version FROM workspace_plan_records WHERE id='ordinary'").get().schedule_version,0);
 assert.equal(db.queries.some(query=>query.sql.includes('schedule_version=0 ORDER BY')),false,'The catalog must not sweep all stale summaries before its bounded page.');assert.equal(db.queries.some(query=>/FROM workspace_plan_record_chunks/.test(query.sql)&&query.values.includes('ordinary')),false);db.sqlite.close();
});

test('catalog continuation rejects source, absence, directory, scope, phase and tenant changes',async t=>{
 for(const race of ['source','absence','directory','scope','phase','tenant'])await t.test(race,async()=>{
  const {db,workspaceId}=await setup(base({series:Array.from({length:510},(_,index)=>series('phase-'+String(index).padStart(4,'0')))})),first=await api(db);assert.ok(first.body.nextCursor);let cursor=first.body.nextCursor,scope=projection,actor=owner;
  if(race==='source')db.sqlite.prepare("UPDATE studio_states SET write_token=write_token||'-changed' WHERE owner_id=?").run(owner.id);
  if(race==='absence')db.sqlite.prepare('UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=?').run(workspaceId);
  if(race==='directory')db.sqlite.prepare("UPDATE workspace_directory_state SET version=version+1,write_token=write_token||'-changed' WHERE workspace_id=?").run(workspaceId);
  if(race==='scope')scope={mode:'series-list',calendar};
  if(race==='phase'){const forged=JSON.parse(Buffer.from(cursor,'base64url').toString());forged.phase='availability';cursor=Buffer.from(JSON.stringify(forged)).toString('base64url');}
  if(race==='tenant'){actor={id:'other-catalog-owner',email:'other@catalog.example'};assert.equal((await Store.writeStudio(db,actor.id,0,base({series:[]}))).ok,true);assert.equal((await api(db,{actor})).status,200);}
  const rejected=await api(db,{scope,cursor,actor});assert.equal(rejected.status,409,JSON.stringify(rejected));assert.equal(rejected.body.studio,undefined);assert.equal(rejected.body.auxRows,undefined);db.sqlite.close();
 });
});

test('catalog final fences still reject absence, directory and role changes during summary reads',async t=>{
 for(const race of ['absence','directory','role'])await t.test(race,async()=>{
  const {db,workspaceId}=await setup();let changed=false;
  db.beforeBatch=statements=>{if(changed||!statements.some(query=>query.sql.includes('schedule_bytes')))return;changed=true;
   if(race==='absence')db.sqlite.prepare('UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=?').run(workspaceId);
   if(race==='directory')db.sqlite.prepare("UPDATE workspace_directory_state SET version=version+1,write_token=write_token||'-changed' WHERE workspace_id=?").run(workspaceId);
   if(race==='role')db.sqlite.prepare("UPDATE workspace_roles SET version=version+1 WHERE workspace_id=? AND id='admin'").run(workspaceId);
  };
  const result=await api(db);assert.equal(changed,true);assert.equal(result.status,race==='role'?403:409,JSON.stringify(result));assert.equal(result.body.auxRows,undefined);db.sqlite.close();
 });
});

test('catalog scope rejects planning commands and publication while metadata-only settings remain usable',async()=>{
 const {db}=await setup(),full=await Store.readStudio(db,owner.id),changed=clone(full.studio);changed.edits.injected=shift('injected');const changes=Planning.commands(full.studio,changed,full.planning.versions),body={revision:full.revision,directoryRevision:full.directory.revision,studio:Planning.payloadStudio(changed),planning:{version:1,changes,metadataChanged:false,metadataBase:full.planning.metadataHash,dependencies:Planning.dependencies(full.studio,changes,full.planning.versions)},projection};
 for(const payload of [body,{...body,planning:{...body.planning,changes:[]},publication:{from:'2026-11-02',to:'2026-11-08',siteIds:[0]}}]){const denied=await api(db,{body:payload});assert.equal(denied.status,409);assert.equal(denied.body.error,'planning_catalog_readonly');}
 assert.equal((await Store.readRawStudio(db,owner.id)).revision,full.revision);
 const next=clone(full.studio);next.workspaceSettings={...(next.workspaceSettings||{}),companyName:'Updated company'};const metadata={...body,studio:Planning.payloadStudio(next),planning:{...body.planning,changes:[],metadataChanged:true}};
 const saved=await api(db,{body:metadata});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.planning.projection.catalogOnly,true);assert.deepEqual(saved.body.planning.versions,{});assert.equal(saved.body.availability,undefined);assert.equal((await Store.readRawStudio(db,owner.id)).studio.workspaceSettings.companyName,'Updated company');db.sqlite.close();
});
