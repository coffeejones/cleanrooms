const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {publicationHydrate,publicationImportStatements,publicationWriteStatements,PUBLICATION_CHUNK_BYTES}=require('../lib/publication-store.mjs');
const Publication=require('../src/publication-model.js');
const baseAt='2026-11-02T10:00:00.000Z',actor={userId:'planner',name:'Planlægger'},day='2026-11-02';
const week=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return date.toISOString().slice(0,10);};
const add=(value,count)=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
const shift=(id='stable',patch={})=>({id,person:'p0',site:0,date:day,start:'07:00',end:'15:00',plannedBreakMinutes:30,note:'Arbejdsinstruktion',...patch});
function model(shifts=[shift()],sequence=1,records){
  const at=new Date(Date.parse(baseAt)+sequence*60000).toISOString(),slots={};for(const item of shifts){const from=week(item.date),key=from+'|'+item.site;slots[key]??={from,to:add(from,6),site:item.site,location:{index:item.site,id:'site-'+item.site,name:'Kunde '+item.site,address:'Adresse '+item.site,color:'#446688'},publicationId:'publication-'+sequence,at,actor,shifts:[]};slots[key].shifts.push(item);}
  const scopes=Object.values(slots).map(slot=>({from:slot.from,to:slot.to,siteIds:[slot.site]})),entry={id:'publication-'+sequence,at,actor,from:day,to:add(day,6),siteIds:[0],scopes,shiftCount:shifts.length,counts:{added:shifts.length,changed:0,removed:0}};
  const result={publications:{version:1,sequence,slots,records:records||[entry]}};assert.deepEqual(Publication.validate(result.publications),[]);return result;
}
function evolve(before,shifts){const next=model(shifts,before.publications.sequence+1);next.publications.records=[...before.publications.records,next.publications.records[0]].slice(-100);return next;}
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const db={sqlite,beforeBatch:null,maxBindings:0,maxParameterBytes:0,maxPublicationResultBytes:0,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{db.maxBindings=Math.max(db.maxBindings,values.length);assert.ok(values.length<=100,'D1 bind count must remain bounded');for(const value of values)if(typeof value==='string')db.maxParameterBytes=Math.max(db.maxParameterBytes,Buffer.byteLength(value));const query=sqlite.prepare(sql);if(query.columns().length){const found=query.all(...values);if(sql.includes('workspace_publication')||sql.includes('workspace_published'))db.maxPublicationResultBytes=Math.max(db.maxPublicationResultBytes,found.reduce((sum,row)=>sum+Object.values(row).reduce((total,value)=>total+(typeof value==='string'?Buffer.byteLength(value):8),0),0));return {results:found,meta:{changes:0}};}return {results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
function tenant(db,id='a'){
  const owner='owner-'+id,workspaceId='workspace-'+id;
  db.sqlite.prepare('INSERT INTO studio_states (owner_id,revision,write_token,chunk_count,byte_length,updated_at) VALUES (?,1,?,0,0,?)').run(owner,'legacy-'+id,baseAt);
  db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId,owner,owner,baseAt);return {workspaceId,owner};
}
async function imported(db,context,studio){
  if(db.sqlite.prepare('SELECT 1 FROM workspace_plan_imports WHERE workspace_id=?').get(context.workspaceId))return;
  const header=db.sqlite.prepare('SELECT * FROM studio_states WHERE owner_id=?').get(context.owner),condition={sql:'EXISTS (SELECT 1 FROM studio_states WHERE owner_id=? AND revision=? AND write_token=?) AND NOT EXISTS (SELECT 1 FROM workspace_plan_imports WHERE workspace_id=?)',values:[context.owner,header.revision,header.write_token,context.workspaceId]},token=crypto.randomUUID();
  const statements=await publicationImportStatements({db,...context,studio,condition,token,at:baseAt});
  await db.batch([...statements,db.prepare(`INSERT INTO workspace_plan_imports SELECT ?,?,?,? WHERE ${condition.sql}`).bind(context.workspaceId,header.revision,header.write_token,baseAt,...condition.values)]);
}
async function prepared(db,context,before,after){
  const header=db.sqlite.prepare('SELECT * FROM studio_states WHERE owner_id=?').get(context.owner),token=crypto.randomUUID(),next=header.revision+1,condition={sql:'EXISTS (SELECT 1 FROM studio_states WHERE owner_id=? AND revision=? AND write_token=?)',values:[context.owner,next,token]},statements=await publicationWriteStatements({db,...context,before,after,condition,token,at:baseAt});
  return {header,token,next,statements};
}
async function commit(db,context,before,after,intercept){
  const value=await prepared(db,context,before,after);if(intercept)await intercept(value);
  const result=await db.batch([db.prepare(`UPDATE studio_states SET revision=?,write_token=? WHERE owner_id=? AND revision=? AND (${value.statements.guard.sql})`).bind(value.next,value.token,context.owner,value.header.revision,...value.statements.guard.values),...value.statements]);return result[0].meta.changes===1;
}
const hydrate=(db,context,studio={},extra={})=>publicationHydrate({db,...context,studio,...extra});

test('published state round-trips without putting shift descriptions in scope headers and absent publications remain absent',async()=>{
  const db=database(),context=tenant(db),studio=model([shift('second'),shift('first',{person:'p1'})]);studio.publications.scopeLinks=[{from:'2026-11-02|0',to:'2026-11-09|1'}];await imported(db,context,studio);
  assert.deepEqual(await hydrate(db,context),studio);const scopes=db.sqlite.prepare('SELECT config FROM workspace_publication_scopes').all();assert.equal(scopes.some(row=>row.config.includes('Arbejdsinstruktion')),false);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_published_shifts').get().n,2);
  const untouched=tenant(db,'none');await imported(db,untouched,{});assert.deepEqual(await hydrate(db,untouched,{marker:'untouched'}),{marker:'untouched'});db.sqlite.close();
});

test('UTF8 chunks preserve descriptions and rich content larger than a D1 row and verify every payload checksum',async()=>{
  const db=database(),context=tenant(db),description='Å🧽'.repeat(450000),studio=model([shift('long',{note:description,noteRich:JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:description}]}]})})]);
  studio.publications.slots['2026-11-02|0'].extra=description;studio.publications.extra=description;await imported(db,context,studio);assert.deepEqual(await hydrate(db,context),studio);
  const chunks=db.sqlite.prepare('SELECT content FROM workspace_publication_chunks').all();assert.ok(chunks.length>20);assert.ok(chunks.every(row=>Buffer.byteLength(row.content)<=PUBLICATION_CHUNK_BYTES));assert.ok(db.maxPublicationResultBytes<1200*1024);assert.ok(db.maxParameterBytes<600*1024);
  const chunk=db.sqlite.prepare("SELECT entity_type,entity_id,version,chunk_index,content FROM workspace_publication_chunks WHERE entity_type='shift' LIMIT 1").get();db.sqlite.prepare('UPDATE workspace_publication_chunks SET content=? WHERE workspace_id=? AND entity_type=? AND entity_id=? AND version=? AND chunk_index=?').run('X'+chunk.content.slice(1),context.workspaceId,chunk.entity_type,chunk.entity_id,chunk.version,chunk.chunk_index);
  await assert.rejects(()=>hydrate(db,context),error=>error.code==='publication_storage_invalid');db.sqlite.close();
});

test('large publication batches have bounded parameters and preserve untouched occurrence versions',async()=>{
  const db=database(),context=tenant(db),shifts=Array.from({length:350},(_,index)=>shift('bulk-'+index,{person:'p'+index})),before=model(shifts);await imported(db,context,before);
  const after=evolve(before,shifts.map(item=>item.id==='bulk-170'?{...item,start:'08:00'}:item));assert.equal(await commit(db,context,before,after),true);
  assert.equal(db.sqlite.prepare('SELECT version FROM workspace_published_shifts WHERE id=?').get('bulk-170').version,2);assert.equal(db.sqlite.prepare('SELECT version FROM workspace_published_shifts WHERE id=?').get('bulk-171').version,1);assert.ok(db.maxBindings<=100);assert.deepEqual(await hydrate(db,context),after);db.sqlite.close();
});

test('moving, cancelling and reintroducing the same occurrence preserves its stable key and monotonically increasing version',async()=>{
  const db=database(),context=tenant(db),original=model();await imported(db,context,original);
  const moved=evolve(original,[shift('stable',{person:'p1',site:1,date:add(day,7)})]);assert.equal(await commit(db,context,original,moved),true);let row=db.sqlite.prepare('SELECT * FROM workspace_published_shifts WHERE id=?').get('stable');assert.equal(row.version,2);assert.equal(row.scope_key,'2026-11-09|1');assert.equal(row.person_id,'p1');assert.equal(db.sqlite.prepare("SELECT version,deleted FROM workspace_publication_scopes WHERE scope_key='2026-11-02|0'").get().deleted,1);
  const removed=evolve(moved,[]);assert.equal(await commit(db,context,moved,removed),true);row=db.sqlite.prepare('SELECT * FROM workspace_published_shifts WHERE id=?').get('stable');assert.equal(row.version,3);assert.equal(row.deleted,1);assert.equal(row.payload_version,2);
  const restored=evolve(removed,[shift('stable',{note:'Ny udgivelse'})]);assert.equal(await commit(db,context,removed,restored),true);row=db.sqlite.prepare('SELECT * FROM workspace_published_shifts WHERE id=?').get('stable');assert.equal(row.version,4);assert.equal(row.deleted,0);assert.deepEqual(await hydrate(db,context),restored);assert.equal(db.sqlite.prepare("SELECT version FROM workspace_publication_scopes WHERE scope_key='2026-11-02|0'").get().version,3);db.sqlite.close();
});

test('a losing per-occurrence version guard cannot commit the plan header or any other publication row',async()=>{
  const db=database(),context=tenant(db),before=model([shift('one'),shift('two',{person:'p1'})]);await imported(db,context,before);const after=evolve(before,[shift('one',{start:'08:00'}),shift('two',{start:'09:00',person:'p1'})]),head=db.sqlite.prepare('SELECT * FROM studio_states').get();
  const accepted=await commit(db,context,before,after,()=>{db.sqlite.prepare("UPDATE workspace_published_shifts SET version=version+1,write_token='racing-token' WHERE id='one'").run();});assert.equal(accepted,false);assert.deepEqual(db.sqlite.prepare('SELECT * FROM studio_states').get(),head);assert.equal(db.sqlite.prepare("SELECT version FROM workspace_published_shifts WHERE id='two'").get().version,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_publication_records').get().n,1);db.sqlite.close();
});

test('a failed row import rolls back companion plan records, the publication namespace and the shared import marker together',async()=>{
  const db=database(),context=tenant(db),studio=model(),header=db.sqlite.prepare('SELECT * FROM studio_states').get(),condition={sql:'EXISTS (SELECT 1 FROM studio_states WHERE owner_id=? AND revision=? AND write_token=?)',values:[context.owner,header.revision,header.write_token]},token=crypto.randomUUID(),statements=await publicationImportStatements({db,...context,studio,condition,token,at:baseAt});
  db.sqlite.exec("CREATE TRIGGER fail_published_shift BEFORE INSERT ON workspace_published_shifts BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  await assert.rejects(()=>db.batch([db.prepare("INSERT INTO workspace_plan_records (workspace_id,kind,id,version,deleted,config,write_token,sort_order,updated_at) VALUES (?,'series','companion',1,0,'{}',?,0,?)").bind(context.workspaceId,token,baseAt),...statements,db.prepare('INSERT INTO workspace_plan_imports VALUES (?,?,?,?)').bind(context.workspaceId,1,'legacy',baseAt)]));
  for(const table of ['workspace_plan_records','workspace_publication_state','workspace_publication_scopes','workspace_published_shifts','workspace_publication_records','workspace_publication_chunks','workspace_plan_imports'])assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);assert.deepEqual(db.sqlite.prepare('SELECT * FROM studio_states').get(),header);db.sqlite.close();
});

test('the shared import marker makes migration idempotent and an orphan namespace fails closed',async()=>{
  const db=database(),context=tenant(db),studio=model();await imported(db,context,studio);const before=db.sqlite.prepare('SELECT * FROM workspace_publication_state').get();await imported(db,context,model([shift('replacement')]));assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_publication_state').get(),before);assert.deepEqual(await hydrate(db,context),studio);
  db.sqlite.prepare('DELETE FROM workspace_plan_imports').run();await assert.rejects(()=>imported(db,context,studio),error=>error.code==='publication_import_conflict');assert.deepEqual(await hydrate(db,context),studio);db.sqlite.close();
});

test('history summaries remain append-only beyond the UI last-hundred window and saved receipts are not rewritten',async()=>{
  const db=database(),context=tenant(db),records=Array.from({length:100},(_,index)=>model([],index+1).publications.records[0]);let before=model([shift()],100,records);await imported(db,context,before);
  db.sqlite.prepare('INSERT INTO workspace_time_entries (workspace_id,id,shift_id,person_id,work_date,end_date,status,demo,version,config,write_token,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(context.workspaceId,'approved-time','stable','p0',day,day,'approved',0,1,JSON.stringify({payroll:{totalCents:135000,personVersion:1},status:'approved'}),'frozen-time',baseAt);const receipt=db.sqlite.prepare('SELECT * FROM workspace_time_entries').get();
  for(let index=0;index<5;index++){const after=evolve(before,[shift('stable',{note:'Udgivelse '+index})]);assert.equal(await commit(db,context,before,after),true);before=after;}
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_publication_records').get().n,105);const hydrated=await hydrate(db,context);assert.equal(hydrated.publications.records.length,100);assert.equal(hydrated.publications.records[0].id,'publication-6');assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_time_entries').get(),receipt);
  const forged=structuredClone(before);forged.publications.records[0].actor.name='FORGED';assert.equal(await commit(db,context,before,forged),false);assert.deepEqual(db.sqlite.prepare('SELECT * FROM workspace_time_entries').get(),receipt);db.sqlite.close();
});

test('person and period projections expose only that employee’s published occurrences and immutable site context',async()=>{
  const db=database(),context=tenant(db),studio=model([shift('own'),shift('peer',{person:'p1',note:'SECRET PEER'}),shift('later',{date:add(day,7),site:1,note:'LATER OWN'})]);studio.publications.privateExtra='SECRET GLOBAL';await imported(db,context,studio);const other=tenant(db,'other');await imported(db,other,model([shift('foreign',{note:'SECRET OTHER COMPANY'})]));
  const own=await hydrate(db,context,{}, {personId:'p0',from:day,to:add(day,6)});assert.deepEqual(Publication.publishedShifts(own).map(item=>item.id),['own']);assert.deepEqual(own.publications.records,[]);assert.equal(own.publications.privateExtra,undefined);for(const secret of ['SECRET PEER','SECRET GLOBAL','SECRET OTHER COMPANY','LATER OWN'])assert.equal(JSON.stringify(own).includes(secret),false,secret);assert.deepEqual(Publication.validate(own.publications),[]);db.sqlite.close();
});

test('core reads retry a failed old chunk checksum when a concurrent valid generation replaces its publication',async()=>{
  const Store=require('../lib/studio-store.mjs'),db=database(),context={workspaceId:'core-workspace',owner:'core-owner'},before={storageVersion:1,series:[],edits:{},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{},...model([shift('chunked',{note:'A'.repeat(350000)})])};
  assert.equal((await Store.writeStudio(db,context.owner,0,before)).ok,true);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(context.workspaceId,context.owner,context.owner,baseAt);
  const initialized=await Store.readStudio(db,context.owner),after=structuredClone(initialized.studio);after.publications.slots['2026-11-02|0'].shifts[0].note='B'.repeat(350000);
  const native=db.batch;let replaced=false;
  db.batch=async statements=>{const result=await native(statements);const index=statements.findIndex(item=>item.sql.startsWith('SELECT chunk_index,content FROM workspace_publication_chunks')&&item.values[1]==='shift');if(!replaced&&index>=0){replaced=true;assert.equal((await Store.writeStudio(db,context.owner,initialized.revision,after)).ok,true);const old=result[index].results[0];old.content='X'+old.content.slice(1);}return result;};
  const loaded=await Store.readStudio(db,context.owner);assert.equal(replaced,true);assert.equal(loaded.revision,initialized.revision+1);assert.deepEqual(loaded.studio,after);
  const current=db.sqlite.prepare("SELECT content FROM workspace_publication_chunks WHERE entity_type='shift' LIMIT 1").get();assert.ok(current);assert.equal(Publication.publishedShifts(loaded.studio)[0].note,'B'.repeat(350000));db.sqlite.close();
});

test('long-id bulk version fences use byte-bounded JSON documents rather than an oversized single D1 parameter',async()=>{
  const db=database(),context=tenant(db),before=model([]);await imported(db,context,before);
  const changes=Array.from({length:4500},(_,index)=>shift('long-'+String(index).padStart(5,'0')+'-'+('x'.repeat(480)),{person:'p'+index})),after=evolve(before,changes),preparedWrite=await prepared(db,context,before,after),guard=preparedWrite.statements.guard;
  assert.ok(guard.sql.includes('UNION ALL'));assert.ok(guard.values.filter(value=>typeof value==='string'&&value.startsWith('[')).length>3);assert.ok(guard.values.every(value=>typeof value!=='string'||Buffer.byteLength(value)<=512*1024));
  for(const query of preparedWrite.statements)assert.ok(query.values.every(value=>typeof value!=='string'||Buffer.byteLength(value)<2*1024*1024));
  const result=await db.batch([db.prepare('SELECT CASE WHEN '+guard.sql+' THEN 1 ELSE 0 END AS allowed').bind(...guard.values)]);assert.equal(result[0].results[0].allowed,1);assert.ok(db.maxBindings<=100);db.sqlite.close();
});
