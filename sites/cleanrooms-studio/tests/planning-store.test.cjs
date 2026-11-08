const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const Store=require('../lib/studio-store.mjs'),Planning=require('../src/planning-records.js'),Departments=require('../src/department-model.js');

function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
 const db={sqlite,beforeBatch:null,failWhen:null,prepare:sql=>({bind:(...values)=>({sql,values})})};
 db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{if(db.failWhen?.(sql)){db.failWhen=null;throw Error('Injected transaction failure');}const query=sqlite.prepare(sql);if(query.columns().length)return {success:true,results:query.all(...values),meta:{changes:0}};return {success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
const source=(patch={})=>({storageVersion:1,demoSeed:false,organization:Departments.defaultOrganization(),series:[{id:'series-one',person:'p0',site:0,startDate:'2026-11-02',endDate:'2026-12-31',weekdays:[0,2],start:'07:00',end:'15:00',note:'Fast aftale'}],edits:{'shift-one':{id:'shift-one',person:'p0',site:0,date:'2026-11-03',start:'09:00',end:'13:00',note:'Undtagelse'},'shift-two':{id:'shift-two',person:'p1',site:1,date:'2026-11-04',start:'08:00',end:'16:00',note:''}},deleted:['shift-two','shift-one'],weekPlans:{0:{published:false,changes:2}},requests:{},checklistProgress:{},coverageRules:[],...patch});
async function setup(initial=source()){
 const db=database(),owner='plan-owner',workspaceId='ws-plan';assert.equal((await Store.writeStudio(db,owner,0,initial)).ok,true);db.sqlite.prepare('INSERT INTO workspaces (id,owner_user_id,snapshot_owner_id,created_at) VALUES (?,?,?,?)').run(workspaceId,owner,owner,'2026-11-02T12:00:00.000Z');return {db,owner,workspaceId,initial};
}
const getRow=(db,kind,id)=>db.sqlite.prepare('SELECT * FROM workspace_plan_records WHERE kind = ? AND id = ?').get(kind,id);

test('source-fenced import preserves legacy projection, suppression order, long UTF-8 notes and independent record versions',async()=>{
 const text='Æøå 🧽🔑\n'.repeat(120000),initial=source();initial.series[0].note=text;initial.series[0].noteRich=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
 const {db,owner,workspaceId}=await setup(initial),legacy=(await Store.readRawStudio(db,owner)).source;
 const loaded=await Store.readStudio(db,owner);assert.deepEqual(loaded,{revision:1,studio:initial});assert.deepEqual(Object.keys(loaded),['revision','studio']);assert.equal(Object.keys(loaded.planning.versions).length,4);assert.equal(loaded.planning.versions[Planning.key('series','series-one')],1);assert.deepEqual(loaded.studio.deleted,['shift-two','shift-one']);
 assert.equal(db.sqlite.prepare('SELECT source_revision FROM workspace_plan_imports WHERE workspace_id = ?').get(workspaceId).source_revision,1);assert.equal(db.sqlite.prepare('SELECT source_token FROM workspace_plan_imports').get().source_token,legacy.token);
 const next=structuredClone(loaded.studio);next.series[0].start='08:00';const written=await Store.writeStudio(db,owner,1,next);assert.equal(written.ok,true);assert.equal(written.planning.versions[Planning.key('series','series-one')],2);assert.equal(written.planning.versions[Planning.key('shift','shift-one')],1);assert.equal(written.planning.metadataHash,loaded.planning.metadataHash);
 const raw=await Store.readRawStudio(db,owner);assert.deepEqual(raw.studio.series,[]);assert.deepEqual(raw.studio.edits,{});assert.deepEqual(raw.studio.deleted,[]);assert.deepEqual(raw.studio.weekPlans,{});assert.ok(db.sqlite.prepare('SELECT MAX(length(CAST(config AS BLOB))) bytes FROM workspace_plan_records').get().bytes<=512*1024);assert.ok(db.sqlite.prepare('SELECT MAX(length(CAST(content AS BLOB))) bytes FROM workspace_plan_record_chunks').get().bytes<=256*1024);assert.ok(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_record_chunks').get().count>4);
 assert.deepEqual(await Store.readStudio(db,owner),{revision:2,studio:next});const marker=db.sqlite.prepare('SELECT * FROM workspace_plan_imports').get();await Store.readStudio(db,owner);assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_plan_imports').get(),marker);db.sqlite.close();
});

test('tombstones prevent ABA and metadata-only saves do not rewrite record versions',async()=>{
 const {db,owner}=await setup(),first=await Store.readStudio(db,owner),removed={...first.studio,series:[]};assert.equal((await Store.writeStudio(db,owner,1,removed)).ok,true);assert.equal(getRow(db,'series','series-one').deleted,1);assert.equal(getRow(db,'series','series-one').version,2);assert.equal((await Store.readStudio(db,owner)).planning.versions[Planning.key('series','series-one')],2);
 const restored=await Store.writeStudio(db,owner,2,first.studio);assert.equal(restored.ok,true);assert.equal(restored.planning.versions[Planning.key('series','series-one')],3);assert.equal(getRow(db,'series','series-one').deleted,0);
 const metadata={...first.studio,workspaceSettings:{companyName:'CleanRooms Drift'}};const updated=await Store.writeStudio(db,owner,3,metadata);assert.equal(updated.ok,true);assert.equal(updated.planning.versions[Planning.key('series','series-one')],3);assert.notEqual(updated.planning.metadataHash,first.planning.metadataHash);assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_records').get().count,4);db.sqlite.close();
});

test('a source revision changed before import never leaves stale imported children or an obsolete marker',async()=>{
 const {db,owner,workspaceId}=await setup(),newer=source({series:[{...source().series[0],id:'new-series',note:'Latest only'}]});let raced=false;
 db.beforeBatch=async statements=>{if(!raced&&statements.some(item=>item.sql.startsWith('INSERT INTO workspace_plan_records'))){raced=true;db.beforeBatch=null;const split=Store.splitSnapshot(JSON.stringify(newer));db.sqlite.prepare('UPDATE studio_states SET revision = 2,write_token = ?,chunk_count = ?,byte_length = ? WHERE owner_id = ?').run('new-source',split.chunks.length,split.byteLength,owner);db.sqlite.prepare('DELETE FROM studio_state_chunks WHERE owner_id = ?').run(owner);for(const [index,content]of split.chunks.entries())db.sqlite.prepare('INSERT INTO studio_state_chunks VALUES (?,?,?,?)').run(owner,2,index,content);}};
 const loaded=await Store.readStudio(db,owner);assert.equal(raced,true);assert.deepEqual(loaded,{revision:2,studio:newer});assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_records WHERE id = ?').get('series-one').count,0);assert.equal(db.sqlite.prepare('SELECT source_revision FROM workspace_plan_imports WHERE workspace_id = ?').get(workspaceId).source_revision,2);db.sqlite.close();
});

test('failed import and failed normalized write roll back rows, chunks, metadata, marker and audit together',async()=>{
 const {db,owner}=await setup();db.failWhen=sql=>sql.startsWith('INSERT INTO workspace_plan_imports');await assert.rejects(()=>Store.readStudio(db,owner),/Injected transaction failure/);assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_records').get().count,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_imports').get().count,0);assert.equal((await Store.readRawStudio(db,owner)).revision,1);
 const loaded=await Store.readStudio(db,owner),beforeRows=db.sqlite.prepare('SELECT * FROM workspace_plan_records ORDER BY kind,id').all(),next=structuredClone(loaded.studio);next.series[0].note='A new note';db.failWhen=sql=>sql.startsWith('INSERT INTO workspace_plan_records');await assert.rejects(()=>Store.writeStudio(db,owner,1,next),/Injected transaction failure/);assert.deepEqual(await Store.readStudio(db,owner),loaded);assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_plan_records ORDER BY kind,id').all(),beforeRows);db.sqlite.close();
});

test('record CAS is checked before header mutation and an acknowledgement contains only its own committed generation',async()=>{
 const {db,owner}=await setup(),loaded=await Store.readStudio(db,owner),next=structuredClone(loaded.studio);next.series[0].note='Writer one';
 db.beforeBatch=async statements=>{if(statements.some(item=>item.sql.startsWith('UPDATE studio_states SET revision'))){db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_plan_records SET version = version + 1 WHERE kind = ? AND id = ?').run('series','series-one');}};
 const failed=await Store.writeStudio(db,owner,1,next);assert.equal(failed.ok,false);assert.equal(failed.revision,1);assert.equal((await Store.readRawStudio(db,owner)).revision,1);assert.equal((await Store.readStudio(db,owner)).studio.series[0].note,'Fast aftale');
 const latest=await Store.readStudio(db,owner),own=structuredClone(latest.studio);own.series[0].note='Own committed note';const committed=await Store.writeStudio(db,owner,latest.revision,own);assert.equal(committed.ok,true);const ownReceipt=structuredClone(committed.planning);
 const peer=structuredClone(own);peer.series[0].note='Later peer note';assert.equal((await Store.writeStudio(db,owner,committed.revision,peer)).ok,true);assert.deepEqual(committed.planning,ownReceipt);assert.equal(committed.planning.versions[Planning.key('series','series-one')]+1,(await Store.readStudio(db,owner)).planning.versions[Planning.key('series','series-one')]);db.sqlite.close();
});

test('actor revocation fences the complete normalized write and long-record chunk cleanup is transactional',async()=>{
 const initial=source();initial.series[0].note='Long 🧽'.repeat(90000);const {db,owner,workspaceId}=await setup(initial);await Store.readStudio(db,owner);const at='2026-11-02T12:00:00.000Z';
 db.sqlite.prepare('INSERT INTO workspace_roles (workspace_id,id,name,permissions,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(workspaceId,'planner','Planner','["plan"]',1,at,at);db.sqlite.prepare('INSERT INTO workspace_members (user_id,workspace_id,email,name,role,role_id,version,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(owner,workspaceId,'owner@example.com','Owner','planner','planner',1,'active',at,at);
 const guard={userId:owner,workspaceId,version:1,roleId:'planner',roleVersion:1,permissions:['plan']},next=structuredClone(initial);next.series[0].note='Short note';const before=db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_record_chunks').get().count;assert.ok(before>0);
 db.beforeBatch=async statements=>{if(statements.some(item=>item.sql.startsWith('UPDATE studio_states SET revision'))){db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_members SET status = ?,version = version + 1 WHERE user_id = ?').run('disabled',owner);}};
 await assert.rejects(()=>Store.writeStudio(db,owner,1,next,guard),error=>error.status===403);assert.equal((await Store.readRawStudio(db,owner)).revision,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_record_chunks').get().count,before);assert.equal((await Store.readStudio(db,owner)).studio.series[0].note,initial.series[0].note);
 assert.equal((await Store.writeStudio(db,owner,1,next)).ok,true);assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_record_chunks').get().count,0);assert.deepEqual((await Store.readStudio(db,owner)).studio,next);db.sqlite.close();
});

test('normalized records and integrity-checked chunks remain tenant-isolated and fail closed on corruption',async()=>{
 const first=await setup(),{db,owner}=first;await Store.readStudio(db,owner);const other='other-owner',second=source({series:[]});await Store.writeStudio(db,other,0,second);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('ws-other',other,other,'2026-11-02T12:00:00.000Z');await Store.readStudio(db,other);
 const changed=structuredClone(second);changed.edits['shift-one'].note='Other tenant';assert.equal((await Store.writeStudio(db,other,1,changed)).ok,true);assert.equal((await Store.readStudio(db,owner)).studio.edits['shift-one'].note,'Undtagelse');
 const row=getRow(db,'series','series-one'),config=JSON.parse(row.config);config.value.note='Corrupted';db.sqlite.prepare('UPDATE workspace_plan_records SET config = ? WHERE workspace_id = ? AND kind = ? AND id = ?').run(JSON.stringify(config),first.workspaceId,'series','series-one');await assert.rejects(()=>Store.readStudio(db,owner),error=>error.status===500&&error.code==='invalid_planning_records');assert.equal((await Store.readStudio(db,other)).studio.edits['shift-one'].note,'Other tenant');db.sqlite.close();
});

test('concurrent first imports are idempotent and a reader retries when a newer commit replaces chunks mid-read',async()=>{
 const initial=source();initial.series[0].note='Original 🧽'.repeat(70000);const {db,owner}=await setup(initial);
 const copies=await Promise.all([Store.readStudio(db,owner),Store.readStudio(db,owner)]);assert.deepEqual(copies[0].studio,initial);assert.deepEqual(copies[1].studio,initial);assert.equal(getRow(db,'series','series-one').version,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM workspace_plan_imports').get().count,1);
 const next=structuredClone(initial);next.series[0].note='Replacement 🔑'.repeat(70000);next.workspaceSettings={companyName:'New metadata'};let raced=false;
 db.beforeBatch=async statements=>{if(!raced&&statements.some(item=>item.sql.startsWith('SELECT chunk_index,content FROM workspace_plan_record_chunks'))){raced=true;db.beforeBatch=null;assert.equal((await Store.writeStudio(db,owner,1,next)).ok,true);}};
 const loaded=await Store.readStudio(db,owner);assert.equal(raced,true);assert.deepEqual(loaded,{revision:2,studio:next});assert.equal(loaded.planning.versions[Planning.key('series','series-one')],2);db.sqlite.close();
});

test('independent long records can exceed the former aggregate snapshot limit without growing the metadata snapshot',async()=>{
 const {db,owner}=await setup(),first=await Store.readStudio(db,owner),one=structuredClone(first.studio);one.series[0].note='a'.repeat(8*1024*1024);assert.equal((await Store.writeStudio(db,owner,1,one)).ok,true);
 const two=structuredClone(one);two.edits['shift-one'].note='b'.repeat(8*1024*1024);assert.ok(new TextEncoder().encode(JSON.stringify(two)).length>Store.MAX_BODY_BYTES);const committed=await Store.writeStudio(db,owner,2,two);assert.equal(committed.ok,true);assert.equal(committed.planning.versions[Planning.key('series','series-one')],2);assert.equal(committed.planning.versions[Planning.key('shift','shift-one')],2);
 const header=db.sqlite.prepare('SELECT byte_length FROM studio_states WHERE owner_id = ?').get(owner);assert.ok(header.byte_length<20000);const loaded=await Store.readStudio(db,owner);assert.equal(loaded.studio.series[0].note.length,8*1024*1024);assert.equal(loaded.studio.edits['shift-one'].note.length,8*1024*1024);db.sqlite.close();
});

test('large expected-version guards split JSON bindings below D1 limits without losing a conflicting record',async()=>{
 const {preparePlanningWrite}=require('../lib/planning-store.mjs'),before=source({series:[],edits:{},deleted:[],weekPlans:{}}),{db,owner,workspaceId}=await setup(before),after=structuredClone(before);await Store.readStudio(db,owner);
 for(let index=0;index<4300;index++){const id='shift-'+String(index).padStart(5,'0')+'-'+'x'.repeat(498);after.edits[id]={id,person:'p0',site:0,date:'2026-11-03',start:'07:00',end:'15:00',note:''};}
 const unbounded=JSON.stringify(Object.keys(after.edits).map(id=>({kind:'shift',id,version:0})));assert.ok(Buffer.byteLength(unbounded)>2_000_000,'The fixture must exceed D1 single-value size if serialized as one guard document');
 const rawBefore=await Store.readRawStudio(db,owner),prepared=await preparePlanningWrite({db,workspaceId,before,after,versions:{},condition:{sql:'1=1',values:[]},token:'guard-test',at:'2026-11-03T00:00:00.000Z'}),documents=prepared.guard.values.filter(value=>typeof value==='string'&&value.startsWith('['));
 assert.ok(documents.length>1);assert.ok(documents.every(value=>Buffer.byteLength(value)<=256*1024));assert.equal(documents.flatMap(value=>JSON.parse(value)).length,4300);assert.ok(prepared.guard.values.length<=100);for(const statement of prepared.statements)for(const value of statement.values)if(typeof value==='string')assert.ok(Buffer.byteLength(value)<=2_000_000);
 const check=db.sqlite.prepare('SELECT CASE WHEN '+prepared.guard.sql+' THEN 1 ELSE 0 END AS allowed');assert.equal(check.get(...prepared.guard.values).allowed,1);
 db.sqlite.exec('SAVEPOINT simulate_competing_record');try{const insert=prepared.statements.find(statement=>statement.sql.includes('INSERT INTO workspace_plan_records'));db.sqlite.prepare(insert.sql).run(...insert.values);assert.equal(check.get(...prepared.guard.values).allowed,0,'Splitting cannot hide a mismatched version in any document');}finally{db.sqlite.exec('ROLLBACK TO simulate_competing_record; RELEASE simulate_competing_record');}
 assert.deepEqual(await Store.readRawStudio(db,owner),rawBefore);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_plan_records WHERE workspace_id=?').get(workspaceId).n,0);db.sqlite.close();
});
