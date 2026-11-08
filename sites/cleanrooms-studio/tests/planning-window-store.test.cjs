const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Planning=require('../src/planning-records.js'),Window=require('../src/planning-window.js'),Data=require('../src/studio-data.js'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js');
const clone=value=>JSON.parse(JSON.stringify(value)),scope={from:'2026-11-02',to:'2026-11-08'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,queries:[],prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);db.queries.push(...statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);return query.columns().length?{success:true,results:query.all(...values),meta:{changes:0}}:{success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const shift=(id,date,patch={})=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'',...patch});
const series=(id,from,to,patch={})=>({id,person:'p0',site:0,startDate:from,endDate:to,weekdays:[0,1,2,3,4],start:'07:00',end:'15:00',note:'',...patch});
const base=(patch={})=>({storageVersion:1,demoSeed:false,calendarAnchor:'2026-10-26',organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[],...patch});
async function setup(studio=base()){const db=database(),owner='window-owner',workspaceId='ws-window';await Store.writeStudio(db,owner,0,studio);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId,owner,owner,'2026-11-02T12:00:00.000Z');return {db,owner,workspaceId};}
async function collect(db,owner,range=scope){const collector=Window.collector({mode:'calendar',...range});let cursor=null,pages=[];do{const page=await Store.readStudioWindow(db,owner,{...range,...(cursor?{cursor}:{})});pages.push(page);cursor=collector.add(page);}while(cursor);return {result:collector.finish(),pages};}

test('indexed calendar projection equals full expansion for moved-in/out overrides, suppressions and outside-period parents',async()=>{
 const initial=base({series:[series('live','2026-11-02','2026-11-20'),series('old-parent','2025-01-01','2025-01-31'),series('unrelated-old','2024-01-01','2024-01-31',{note:'OUTSIDE-SERIES-'+('🧽'.repeat(180000))})],edits:{'live@2026-11-03':shift('live@2026-11-03','2026-12-01',{seriesId:'live'}),'old-parent@2025-01-06':shift('old-parent@2025-01-06','2026-11-04',{seriesId:'old-parent',person:'p1'}),outside:shift('outside','2027-03-01',{note:'OUTSIDE-SHIFT-'+('Æ'.repeat(180000))}),visible:shift('visible','2026-11-05',{person:'p2'})},deleted:['live@2026-11-02'],weekPlans:{99:{published:false,changes:2,baseline:[shift('baseline','2026-11-04')]},0:{published:false,changes:1,baseline:[shift('old-baseline','2025-01-06')]}}});
 const {db,owner}=await setup(initial),full=await Store.readStudio(db,owner);const expected=Data.shiftsInRange(scope.from,scope.to,full.studio).sort((a,b)=>a.id.localeCompare(b.id));await collect(db,owner);const trimmed=await Store.readRawStudio(db,owner);assert.ok(db.sqlite.prepare('SELECT byte_length FROM studio_states').get().byte_length<10000);assert.deepEqual(trimmed.studio.series,[]);assert.deepEqual(trimmed.studio.edits,{});
 db.beforeBatch=async statements=>{for(const query of statements)if(query.sql.includes('FROM workspace_plan_record_chunks'))assert.equal(['unrelated-old','outside'].includes(query.values[2]),false,'No unrelated note chunks may be read on the warm path.');};
 const {result,pages}=await collect(db,owner),actual=Data.shiftsInRange(scope.from,scope.to,result.studio).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(actual,expected);assert.ok(result.studio.series.some(item=>item.id==='old-parent'),'A moved-in override retains its original parent definition.');assert.equal(result.studio.series.some(item=>item.id==='unrelated-old'),false);assert.equal(result.studio.edits.outside,undefined);assert.equal(result.studio.edits['live@2026-11-03'].date,'2026-12-01');assert.ok(result.studio.deleted.includes('live@2026-11-02'));assert.equal(result.planning.versions[Planning.key('shift','outside')],undefined);assert.equal(result.planning.versions[Planning.key('series','unrelated-old')],undefined);assert.equal(result.planning.versions[Planning.key('series','old-parent')],1);assert.ok(result.studio.weekPlans['99']);assert.equal(result.studio.weekPlans['0'],undefined,'The baseline absolute week, not the account anchor, selects advisory caches.');assert.ok(pages.every(page=>page.records.length<=500));db.sqlite.close();
});

test('window page cursors retain every row, page-only versions and a stable source generation',async()=>{
 const edits=Object.fromEntries(Array.from({length:1100},(_,index)=>{const id='visible-'+String(index).padStart(4,'0');return [id,shift(id,'2026-11-03',{note:'N'.repeat(1400)})];}));edits.outside=shift('outside','2027-01-01',{note:'Not selected'});const {db,owner}=await setup(base({edits})),{result,pages}=await collect(db,owner);assert.ok(pages.length>=3);assert.equal(Object.keys(result.studio.edits).length,1100);assert.equal(Object.keys(result.planning.versions).length,1100);assert.equal(result.studio.edits.outside,undefined);assert.ok(pages.slice(1).every(page=>page.studio===undefined));assert.ok(pages.every(page=>Object.keys(page.planning.versions).length===page.records.length));assert.equal(new Set(pages.map(page=>page.revision)).size,1);
 const before=db.sqlite.prepare('SELECT revision,write_token FROM studio_states').get();await collect(db,owner);assert.deepEqual(db.sqlite.prepare('SELECT revision,write_token FROM studio_states').get(),before,'Warm reads do not rewrite a source token.');db.sqlite.close();
});

test('physical tombstones retain indexed geometry and scoped versions without resurrecting deleted shifts',async()=>{
 const {db,owner}=await setup(base({edits:{target:shift('target','2026-11-04')}})),full=await Store.readStudio(db,owner),removed=clone(full.studio);delete removed.edits.target;assert.equal((await Store.writeStudio(db,owner,1,removed)).ok,true);const {result,pages}=await collect(db,owner);assert.equal(result.studio.edits.target,undefined);assert.equal(result.planning.versions[Planning.key('shift','target')],2);assert.ok(pages.flatMap(page=>page.records).some(row=>row.kind==='shift'&&row.id==='target'&&row.value===null&&row.version===2));assert.equal(db.sqlite.prepare('SELECT window_from FROM workspace_plan_records WHERE id=?').get('target').window_from,'2026-11-04');db.sqlite.close();
});

test('legacy typed-index backfill is idempotent, source-fenced and repairs an older normalized writer',async()=>{
 const {db,owner,workspaceId}=await setup(base({series:[series('source','2026-11-02','2026-11-20')]}));await Store.readStudio(db,owner);db.sqlite.prepare('UPDATE workspace_plan_records SET window_schema=0,window_version=0,window_from=NULL,window_to=NULL').run();const initial=db.sqlite.prepare('SELECT revision FROM studio_states').get().revision;await collect(db,owner);assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states').get().revision,initial);assert.equal(db.sqlite.prepare('SELECT window_schema FROM workspace_plan_records').get().window_schema,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_plan_window_imports').get().n,1);
 db.sqlite.prepare('UPDATE workspace_plan_records SET version=version+1 WHERE workspace_id=?').run(workspaceId);assert.equal(db.sqlite.prepare('SELECT window_schema FROM workspace_plan_records').get().window_schema,0,'An older writer cannot leave a falsely current index.');const fixed=await collect(db,owner);assert.equal(fixed.result.planning.versions[Planning.key('series','source')],2);assert.equal(db.sqlite.prepare('SELECT window_version FROM workspace_plan_records').get().window_version,2);db.sqlite.close();
});

test('a plan change or another tenant invalidates a continuation before any mixed-generation projection is exposed',async()=>{
 const edits=Object.fromEntries(Array.from({length:650},(_,index)=>{const id='many-'+index;return [id,shift(id,'2026-11-03')];}));const {db,owner}=await setup(base({edits}));const first=await Store.readStudioWindow(db,owner,scope);assert.ok(first.nextCursor);const full=await Store.readStudio(db,owner),next=clone(full.studio);next.edits.unloaded=shift('unloaded','2028-02-01');await Store.writeStudio(db,owner,full.revision,next);await assert.rejects(()=>Store.readStudioWindow(db,owner,{...scope,cursor:first.nextCursor}),error=>error.status===409&&error.code==='planning_window_conflict');
 const other='other-window-owner';await Store.writeStudio(db,other,0,base());db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('ws-other',other,other,'2026-11-02T12:00:00.000Z');await collect(db,other);await assert.rejects(()=>Store.readStudioWindow(db,other,{...scope,cursor:first.nextCursor}),error=>error.status===409);db.sqlite.close();
});

test('one oversized existing description is preserved on a soft-budget page without pulling outside-period chunks',async()=>{
 const note='Lang beskrivelse 🔑\n'.repeat(90000),{db,owner}=await setup(base({edits:{big:shift('big','2026-11-03',{note}),outside:shift('outside','2027-01-01',{note:'Excluded'})}}));const {result,pages}=await collect(db,owner);assert.equal(result.studio.edits.big.note,note);assert.equal(result.studio.edits.outside,undefined);assert.ok(pages.some(page=>new TextEncoder().encode(JSON.stringify(page)).length>1024*1024));assert.equal(pages.flatMap(page=>page.records).length,1);db.sqlite.close();
});

test('exact committed window acknowledgements include touched out-of-window records while leaving independent overlays absent',async()=>{
 let studio=base({edits:{visible:shift('visible','2026-11-03'),outside:shift('outside','2027-01-05',{note:'Outside secret'})}});studio=Publication.publish(studio,{from:'2026-11-02',to:'2026-11-08',siteIds:[0],actor:{userId:'planner',name:'Planner'},at:'2026-11-01T12:00:00.000Z'}).studio;
 const {db,owner}=await setup(studio),full=await Store.readStudio(db,owner);full.studio.checklistProgress={'["visible","p0"]':{ok:true},'["outside","p0"]':{secret:true}};full.studio.absences=[{id:'private',p:'p0',days:['2026-11-03'],comment:'Never in ACK',status:'approved'}];
 const projected=Store.projectStudioWindow(full.studio,full.planning,scope,[{kind:'shift',id:'outside'}]);assert.equal(projected.studio.edits.outside.note,'Outside secret','Own explicitly touched records retain their exact acknowledgement even outside the viewport.');assert.equal(projected.planning.partial,true);assert.equal(projected.studio.absences,undefined);assert.equal(projected.studio.requests,undefined);assert.equal(projected.studio.leaveDecisions,undefined);assert.deepEqual(Object.keys(projected.studio.checklistProgress),['["visible","p0"]']);assert.deepEqual(projected.studio.publications.records,[]);assert.equal(projected.planning.versions[Planning.key('shift','outside')],1);db.sqlite.close();
});

test('warm compact windows load source metadata once while retaining batched index and ending generation checks',async()=>{
 const {db,owner}=await setup(base({edits:{visible:shift('visible',scope.from)}}));await collect(db,owner);db.queries=[];const batches=[];db.beforeBatch=async statements=>{batches.push(statements);};
 const page=await Store.readStudioWindow(db,owner,{...scope,instructions:'deferred'});assert.equal(page.records.find(row=>row.id==='visible').value.edit.id,'visible');
 assert.equal(db.queries.filter(query=>query.sql.includes('FROM studio_state_chunks')).length,1,'The already-trimmed directory and current window index must reuse the validated request-local source.');
 assert.equal(db.queries.some(query=>/^(UPDATE|INSERT INTO|DELETE FROM) studio_state/.test(query.sql)),false);
 const index=batches.filter(batch=>batch.some(query=>query.sql.includes('SELECT schema FROM workspace_plan_window_imports')));assert.equal(index.length,1);assert.equal(index[0].length,2);assert.ok(index[0].some(query=>query.sql.includes('window_schema = 0')));
 const final=batches.filter(batch=>batch.some(query=>query.sql==='SELECT revision,write_token FROM studio_states WHERE owner_id=?'));assert.equal(final.length,1);assert.equal(final[0].length,2);assert.ok(final[0].some(query=>query.sql.includes('SELECT version FROM workspace_absence_imports')));db.sqlite.close();
});

test('window index outcomes report real source rewrites and reset on subsequent warm checks',async()=>{
 const {ensurePlanWindowIndex}=require('../lib/planning-window-store.mjs'),{db,owner,workspaceId}=await setup(base({series:[series('source',scope.from,scope.to)]}));
 await Store.readStudio(db,owner);let raw=await Store.readRawStudio(db,owner);const before=raw.source.token,outcome={sourceChanged:false};
 assert.equal(await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot:Store.splitSnapshot,outcome}),true);assert.equal(outcome.sourceChanged,true);raw=await Store.readRawStudio(db,owner);assert.notEqual(raw.source.token,before);
 assert.equal(await ensurePlanWindowIndex({db,workspaceId,owner,raw,splitSnapshot:Store.splitSnapshot,outcome}),true);assert.equal(outcome.sourceChanged,false);assert.equal((await Store.readRawStudio(db,owner)).source.token,raw.source.token);db.sqlite.close();
});

test('reused request-local metadata still retries a concurrent source change and returns only the new generation',async()=>{
 const {db,owner}=await setup(base({edits:{visible:shift('visible',scope.from,{note:'Old instructions'})}}));await collect(db,owner);let changed=false;
 db.beforeBatch=async statements=>{if(changed||!statements.some(query=>query.sql.includes('WITH candidates(kind,id)')))return;changed=true;db.beforeBatch=null;const current=await Store.readStudio(db,owner);current.studio.edits.visible.note='New instructions';assert.equal((await Store.writeStudio(db,owner,current.revision,current.studio)).ok,true);};
 const page=await Store.readStudioWindow(db,owner,scope);assert.equal(changed,true);assert.equal(page.revision,2);assert.equal(page.records.find(row=>row.id==='visible').value.edit.note,'New instructions');db.sqlite.close();
});

test('batched ending checks still reject an absence-only race without exposing a mixed calendar',async()=>{
 const {db,owner,workspaceId}=await setup();await collect(db,owner);db.sqlite.prepare('INSERT INTO workspace_absence_imports (workspace_id,version,imported_at) VALUES (?,0,?)').run(workspaceId,'2026-11-02T12:00:00.000Z');let changed=false;
 db.beforeBatch=async statements=>{if(changed||!statements.some(query=>query.sql==='SELECT revision,write_token FROM studio_states WHERE owner_id=?'))return;changed=true;db.sqlite.prepare('UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=?').run(workspaceId);};
 await assert.rejects(()=>Store.readStudioWindow(db,owner,{...scope,instructions:'deferred'}),error=>error.status===409&&error.code==='planning_window_conflict');assert.equal(changed,true);db.sqlite.close();
});

test('warm metadata reuse does not hide malformed snapshots or a missing imported directory',async t=>{
 for(const corrupt of ['snapshot-length','snapshot-json','directory-header'])await t.test(corrupt,async()=>{
  const {db,owner}=await setup();await collect(db,owner);
  if(corrupt==='snapshot-length')db.sqlite.prepare('UPDATE studio_states SET byte_length=byte_length+1 WHERE owner_id=?').run(owner);
  if(corrupt==='snapshot-json')db.sqlite.prepare("UPDATE studio_state_chunks SET content=substr(content,1,length(content)-1)||'!' WHERE owner_id=?").run(owner);
  if(corrupt==='directory-header')db.sqlite.prepare('DELETE FROM workspace_directory_state').run();
  await assert.rejects(()=>Store.readStudioWindow(db,owner,scope),error=>error.status===500&&error.code===(corrupt==='directory-header'?'directory_import_incomplete':'invalid_saved_state'));db.sqlite.close();
 });
});
