const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {publicationImportStatements,publicationWindowPage,projectPublicationWindow,publicationHydrate}=require('../lib/publication-store.mjs');
const day='2026-11-02',end='2026-11-08',stamp='2026-11-02T10:00:00.000Z';
const add=(value,count)=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
const monday=value=>{const date=new Date(value+'T12:00:00Z');return add(value,-((date.getUTCDay()+6)%7));};
const shift=(id,patch={})=>({id,person:'p0',site:0,date:day,start:'07:00',end:'15:00',note:'Instruction '+id,...patch});
function model(shifts){const slots={};for(const item of shifts){const from=monday(item.date),key=from+'|'+item.site;slots[key]??={from,to:add(from,6),site:item.site,location:{index:item.site,id:'site-'+item.site,name:'Site '+item.site,address:'Address',color:'#446688'},publicationId:'publication-1',at:stamp,actor:{userId:'owner',name:'Owner'},shifts:[]};slots[key].shifts.push(item);}return {publications:{version:1,sequence:1,slots,records:[]}};}
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));
  const db={sqlite,queries:[],beforeBatch:null,maxResultBytes:0,prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{assert.ok(values.length<=100);db.queries.push({sql,values});const query=sqlite.prepare(sql);if(query.columns().length){const found=query.all(...values);db.maxResultBytes=Math.max(db.maxResultBytes,Buffer.byteLength(JSON.stringify(found)));return {results:found,meta:{changes:0}};}return {results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
async function seed(db,studio,name='one'){
  const owner='owner-'+name,workspaceId='workspace-'+name;db.sqlite.prepare('INSERT INTO studio_states (owner_id,revision,write_token,chunk_count,byte_length,updated_at) VALUES (?,1,?,0,0,?)').run(owner,'source-'+name,stamp);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId,owner,owner,stamp);
  const condition={sql:'1=1',values:[]};await db.batch(await publicationImportStatements({db,workspaceId,studio,condition,token:'import-'+name,at:stamp}));return {workspaceId};
}
async function collect(db,context,options={}){
  const publicationRows=[],auxRows=[],pages=[];let cursor=null;
  do{const page=await publicationWindowPage({db,...context,from:day,to:end,...options,cursor});assert.ok(page.rows.length+page.auxRows.length>0||page.nextCursor===null,'a page must advance');publicationRows.push(...page.rows);auxRows.push(...page.auxRows);pages.push(page);cursor=page.nextCursor;assert.ok(pages.length<5000);}while(cursor);
  return {publicationRows,auxRows,pages};
}

test('warm publication windows read only matching events and compact headings, with no history or outside-period chunks',async()=>{
  const db=database(),studio=model([shift('visible-a'),shift('visible-b',{person:'p1'}),shift('outside',{date:add(day,35),note:'OUTSIDE_SECRET'.repeat(100000)})]);
  studio.publications.extra='GLOBAL_SECRET'.repeat(100000);studio.publications.slots[day+'|0'].extra='SCOPE_EXTRA'.repeat(100000);studio.publications.scopeLinks=[{from:day+'|0',to:add(day,35)+'|0'}];
  const context=await seed(db,studio);await seed(db,model([shift('foreign',{note:'FOREIGN_SECRET'})]),'other');db.queries=[];db.maxResultBytes=0;
  const result=await collect(db,context,{maxRows:2,maxBytes:4096});
  assert.deepEqual(result.publicationRows.filter(row=>row.kind==='shift').map(row=>row.id),['visible-a','visible-b']);assert.deepEqual(result.auxRows,[]);assert.ok(result.pages.length>=2);
  const state=result.publicationRows.find(row=>row.kind==='state');assert.deepEqual(state.value,{present:true,value:{version:1,sequence:1,scopeLinks:[]}});
  const encoded=JSON.stringify(result);for(const secret of ['OUTSIDE_SECRET','GLOBAL_SECRET','SCOPE_EXTRA','FOREIGN_SECRET'])assert.equal(encoded.includes(secret),false,secret);
  assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_publication_chunks')),false);assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_publication_records')),false);assert.ok(db.maxResultBytes<10000);
  const expected=projectPublicationWindow(studio,{from:day,to:end});assert.deepEqual(result.publicationRows.sort((a,b)=>(a.kind+a.id).localeCompare(b.kind+b.id)),expected.sort((a,b)=>(a.kind+a.id).localeCompare(b.kind+b.id)));db.sqlite.close();
});

test('one existing long instruction remains complete on its own soft-budget page',async()=>{
  const db=database(),note='Å🧽'.repeat(450000),context=await seed(db,model([shift('long',{note,noteRich:note}),shift('short')]));db.queries=[];db.maxResultBytes=0;
  const result=await collect(db,context,{maxRows:100,maxBytes:4096}),long=result.publicationRows.find(row=>row.id==='long');assert.equal(long.value.shift.note,note);assert.equal(long.value.shift.noteRich,note);
  const page=result.pages.find(item=>item.rows.some(row=>row.id==='long'));assert.equal(page.rows.length,1);assert.deepEqual(page.auxRows,[]);assert.ok(Buffer.byteLength(JSON.stringify(page))>4096);assert.ok(db.maxResultBytes<1200*1024);db.sqlite.close();
});

test('every matching absence remains reachable without hydrating long comments or relying on the latest hundred',async()=>{
  const db=database(),context=await seed(db,model([shift('visible')]));const insert=db.sqlite.prepare('INSERT INTO workspace_absences (workspace_id,id,person_id,from_date,to_date,type,status,version,config,write_token,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)');
  for(let index=0;index<180;index++){const id='absence-'+String(index).padStart(4,'0'),status=index%2?'pending':'approved',value={id,p:'p'+index,days:[day,end],type:'Ferie',status,version:1,comment:'PRIVATE_COMMENT'.repeat(6000)};insert.run(context.workspaceId,id,value.p,day,end,value.type,status,JSON.stringify(value),'absence',stamp);}
  insert.run(context.workspaceId,'rejected','p0',day,end,'Ferie','rejected',JSON.stringify({days:[day,end]}),'absence',stamp);insert.run(context.workspaceId,'outside','p0',add(day,100),add(day,101),'Ferie','approved',JSON.stringify({days:[add(day,100),add(day,101)]}),'absence',stamp);
  db.queries=[];db.maxResultBytes=0;const result=await collect(db,context,{maxRows:17,maxBytes:4096});assert.equal(result.auxRows.length,180);assert.equal(new Set(result.auxRows.map(row=>row.id)).size,180);assert.equal(JSON.stringify(result).includes('PRIVATE_COMMENT'),false);assert.ok(result.pages.every(page=>page.rows.length+page.auxRows.length<=17));assert.ok(db.maxResultBytes<1200*1024);db.sqlite.close();
});

test('older compact headers backfill only selected scopes and cannot change their authoritative generation',async()=>{
  const db=database(),studio=model([shift('visible'),shift('outside',{date:add(day,35)})]),context=await seed(db,studio);
  db.sqlite.exec("UPDATE workspace_publication_state SET window_config='',window_version=0; UPDATE workspace_publication_scopes SET window_config='',window_version=0");const before=db.sqlite.prepare('SELECT version,write_token,config FROM workspace_publication_scopes WHERE scope_key=?').get(day+'|0');db.queries=[];
  await collect(db,context);assert.deepEqual(db.sqlite.prepare('SELECT version,write_token,config FROM workspace_publication_scopes WHERE scope_key=?').get(day+'|0'),before);assert.equal(db.sqlite.prepare('SELECT window_version FROM workspace_publication_scopes WHERE scope_key=?').get(day+'|0').window_version,before.version);assert.equal(db.sqlite.prepare('SELECT window_version FROM workspace_publication_scopes WHERE scope_key=?').get(add(day,35)+'|0').window_version,0);
  assert.deepEqual(await publicationHydrate({db,...context,studio:{}}),model([shift('visible'),shift('outside',{date:add(day,35)})]));db.sqlite.close();
});

test('a concurrent generation replacement cannot commit stale compact metadata',async()=>{
  const db=database(),context=await seed(db,model([shift('visible')]));db.sqlite.exec("UPDATE workspace_publication_state SET window_config='',window_version=0");let changed=false;
  db.beforeBatch=async statements=>{if(!changed&&statements.some(query=>query.sql.startsWith('UPDATE workspace_publication_state SET window_config'))){changed=true;db.sqlite.exec("UPDATE workspace_publication_state SET version=version+1,write_token='concurrent'");}};
  await assert.rejects(()=>collect(db,context),error=>error.status===409&&error.code==='publication_read_conflict');assert.equal(changed,true);assert.equal(db.sqlite.prepare('SELECT window_version FROM workspace_publication_state').get().window_version,0);db.sqlite.close();
});

test('window inputs reject impossible dates, excess span and malformed keyset state',async()=>{
  const db=database(),context=await seed(db,model([]));
  for(const options of [{from:'2026-02-30',to:'2026-03-02'},{from:day,to:add(day,56)},{from:end,to:day},{cursor:{stage:'shift',after:'',foreign:true}},{maxRows:501},{maxBytes:2*1024*1024+1}])await assert.rejects(()=>publicationWindowPage({db,...context,from:day,to:end,...options}),error=>error.status===400);
  assert.equal((await collect(db,context,{to:add(day,55)})).publicationRows.length,1);db.sqlite.close();
});

test('page-scoped checklist progress streams checked tasks in bounded queries without losing completion',async()=>{
  const {readChecklistProgress}=require('../lib/engagement-store.mjs'),Checklist=require('../src/checklist-progress.js'),db=database(),context=await seed(db,model([]));
  const noteRich=JSON.stringify({type:'doc',content:[{type:'taskList',content:Array.from({length:1200},(_,index)=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Task '+index}]}]}))}]}),item=shift('many-tasks',{noteRich}),view=Checklist.read({},item),hash=async value=>'sha256:'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex'),structure=await hash(JSON.stringify(view.tasks.map(task=>task.key))),insert=db.sqlite.prepare('INSERT INTO workspace_checklist_tasks VALUES (?,?,?,?,?,?,1,1,?)');
  for(const task of view.tasks)insert.run(context.workspaceId,item.id,item.person,task.key,await hash(task.signature),structure,stamp);
  const native=db.batch,counts=[];db.batch=async statements=>{const result=await native(statements);for(let index=0;index<statements.length;index++)if(statements[index].sql.includes('FROM workspace_checklist_tasks'))counts.push(result[index].results.length);return result;};
  const progress=await readChecklistProgress(db,{workspace:{id:context.workspaceId},saved:{studio:{}}},{shifts:[item]});assert.equal(Checklist.read(progress,item).checked,1200);assert.ok(counts.length>=5);assert.ok(counts.every(count=>count<=250));db.sqlite.close();
});
