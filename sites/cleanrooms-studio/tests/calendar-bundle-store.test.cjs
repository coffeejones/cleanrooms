const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Planning=require('../src/planning-records.js'),Window=require('../src/planning-window.js'),Departments=require('../src/department-model.js');
const {publicationWindowPage,publicationSelectionPage}=require('../lib/publication-store.mjs');
const range={from:'2026-11-02',to:'2026-11-15'},firstWeek={from:range.from,to:'2026-11-08'},secondWeek={from:'2026-11-09',to:range.to};
const shift=(id,date,extra={})=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'Instructions for '+id,...extra});
const series=(id,from,to)=>({id,person:'p0',site:0,startDate:from,endDate:to,weekdays:[0,1,2,3,4],start:'07:00',end:'15:00',note:'Series '+id});
const source=extra=>({storageVersion:1,demoSeed:false,calendarAnchor:range.from,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{},...extra});
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',name),'utf8'));
  const db={sqlite,queries:[],beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(({sql,values})=>{assert.ok(values.length<=100);for(const value of values)if(typeof value==='string')assert.ok(Buffer.byteLength(value)<=2*1024*1024);const query=sqlite.prepare(sql),result=query.columns().length?{results:query.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(query.run(...values).changes)}};db.queries.push({sql,values,rows:result.results});return result;});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;
}
async function setup(studio){const db=database(),owner='bundle-owner',workspaceId='bundle-workspace';await Store.writeStudio(db,owner,0,studio);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId,owner,owner,'2026-11-02T12:00:00.000Z');return {db,owner,workspaceId};}
async function collect(db,owner,{period=range,instructions='deferred'}={}){
  const collector=Window.collector({mode:'calendar',...period}),pages=[];let cursor=null;do{const page={ok:true,...await Store.readStudioWindow(db,owner,{...period,cursor,...(instructions?{instructions}:{})})};pages.push(page);cursor=collector.add(page);assert.ok(pages.length<100);}while(cursor);return {pages,result:collector.finish()};
}
function publications(shifts){const slots={};for(const item of shifts){const from=item.date<=firstWeek.to?firstWeek.from:secondWeek.from,to=item.date<=firstWeek.to?firstWeek.to:secondWeek.to,key=from+'|0';slots[key]??={from,to,site:0,location:{index:0,id:'site-0',name:'Worksite',address:'',color:'#446688'},publicationId:'published',at:'2026-11-01T12:00:00.000Z',actor:{userId:'owner',name:'Owner'},shifts:[]};slots[key].shifts.push(item);}return {version:1,sequence:1,slots,records:[]};}

test('a deferred two-week bundle fits one page where independent weekly reads need two',async()=>{
  const edits=Object.fromEntries(Array.from({length:600},(_,index)=>{const id='shift-'+String(index).padStart(4,'0');return [id,shift(id,index<300?firstWeek.from:secondWeek.from)];}));const {db,owner}=await setup(source({edits}));
  const together=await collect(db,owner),left=await collect(db,owner,{period:firstWeek}),right=await collect(db,owner,{period:secondWeek});
  assert.equal(together.pages.length,1);assert.equal(left.pages.length+right.pages.length,2);assert.equal(together.pages[0].records.length,600);assert.equal(Object.keys(together.result.studio.edits).length,600);
  assert.deepEqual(new Set(Object.keys(together.result.studio.edits)),new Set([...Object.keys(left.result.studio.edits),...Object.keys(right.result.studio.edits)]));
  for(const page of together.pages){assert.deepEqual(Object.keys(page.planning.recordWindows).sort(),Object.keys(page.planning.versions).sort());for(const [key,geometry]of Object.entries(page.planning.recordWindows)){assert.deepEqual(Object.keys(geometry).sort(),['from','to','origin','parent'].sort());const id=JSON.parse(key)[1];assert.deepEqual(geometry,{from:edits[id].date,to:edits[id].date,origin:null,parent:null});}}
  db.sqlite.close();
});

test('compact draft and published keyset pages advance beyond 1001 without losing rows or hydrating instructions',async()=>{
  const items=Array.from({length:1205},(_,index)=>shift('shift-'+String(index).padStart(4,'0'),index%2?firstWeek.from:secondWeek.from)),edits=Object.fromEntries(items.map(item=>[item.id,item]));edits.outside=shift('outside','2027-01-04',{note:'UNRELATED_'+('🧽'.repeat(180000))});
  const {db,owner}=await setup(source({edits,publications:publications(items)}));await collect(db,owner);db.queries=[];const {pages,result}=await collect(db,owner);
  assert.equal(pages.length,3);assert.equal(pages[0].records.length,1000);assert.equal(pages[1].records.length,205);assert.ok(pages.some(page=>page.publicationRows.filter(row=>row.kind==='shift').length>500));assert.ok(pages.every(page=>page.records.length+page.publicationRows.length+page.auxRows.length<=1000));
  assert.equal(Object.keys(result.studio.edits).length,1205);assert.equal(Object.keys(result.planning.versions).length,1205);assert.equal(Object.values(result.studio.publications.slots).flatMap(slot=>slot.shifts).length,1205);
  assert.equal(new Set(pages.flatMap(page=>page.records.map(row=>row.id))).size,1205);assert.equal(new Set(pages.flatMap(page=>page.publicationRows.filter(row=>row.kind==='shift').map(row=>row.id))).size,1205);assert.equal(result.studio.edits.outside,undefined);
  assert.ok(db.queries.filter(query=>query.sql.includes('WITH candidates(kind,id)')).every(query=>query.values.at(-1)===1001));
  assert.equal(db.queries.some(query=>query.sql.includes('FROM workspace_plan_record_chunks')||query.sql.includes('FROM workspace_publication_chunks')),false,'Warm compact pages never load instruction chunks.');
  assert.equal(JSON.stringify(pages).includes('Instructions for'),false);assert.equal(JSON.stringify(db.queries.map(query=>query.rows)).includes('UNRELATED_'),false);
  for(const page of pages)assert.deepEqual(Object.keys(page.planning.recordWindows).sort(),page.records.map(row=>Planning.key(row.kind,row.id)).sort());
  db.sqlite.close();
});

test('typed geometry retains both ends of moves, out-of-range parents, suppressions, tombstones and absolute weeks',async()=>{
  const parent=series('old-parent','2025-01-01','2025-01-31'),live=series('live',range.from,range.to),movedIn=shift('old-parent@2025-01-06',secondWeek.from,{seriesId:'old-parent'}),movedOut=shift('live@2026-11-03','2027-01-04',{seriesId:'live'}),ordinary=shift('physical',secondWeek.from);
  const published=publications([shift('published-first',firstWeek.from),shift('published-second',secondWeek.from)]);published.slots[secondWeek.from+'|1']={...published.slots[secondWeek.from+'|0'],site:1,location:{index:1,id:'site-1',name:'Empty worksite',address:'',color:'#446688'},shifts:[]};
  const {db,owner,workspaceId}=await setup(source({series:[parent,live],edits:{[movedIn.id]:movedIn,[movedOut.id]:movedOut,physical:ordinary},deleted:['live@2026-11-04'],weekPlans:{99:{published:false,changes:1,baseline:[shift('baseline',secondWeek.from)]}},publications:published}));
  const full=await Store.readStudio(db,owner);delete full.studio.edits.physical;assert.equal((await Store.writeStudio(db,owner,full.revision,full.studio)).ok,true);
  db.sqlite.prepare('INSERT INTO workspace_absence_imports VALUES (?,2,?)').run(workspaceId,'2026-11-02T12:00:00.000Z');const insert=db.sqlite.prepare('INSERT INTO workspace_absences VALUES (?,?,?,?,?,?,?,1,?,?,?)');for(const entry of [{id:'first-only',p:'p0',days:[firstWeek.from],type:'Ferie',status:'approved'},{id:'cross-week',p:'p1',days:[firstWeek.from,secondWeek.from,'2026-11-16'],type:'Ferie',status:'pending'}])insert.run(workspaceId,entry.id,entry.p,entry.days[0],entry.days.at(-1),entry.type,entry.status,JSON.stringify({...entry,comment:'PRIVATE_ABSENCE_COMMENT'}),'absence-token','2026-11-02T12:00:00.000Z');
  const {pages,result}=await collect(db,owner),windows=Object.assign({},...pages.map(page=>page.planning.recordWindows));
  assert.deepEqual(windows[Planning.key('series','old-parent')],{from:parent.startDate,to:parent.endDate,origin:null,parent:parent.id});
  assert.deepEqual(windows[Planning.key('shift',movedIn.id)],{from:secondWeek.from,to:secondWeek.from,origin:'2025-01-06',parent:parent.id});assert.deepEqual(windows[Planning.key('shift',movedOut.id)],{from:'2027-01-04',to:'2027-01-04',origin:'2026-11-03',parent:live.id});
  assert.deepEqual(windows[Planning.key('shift','live@2026-11-04')],{from:null,to:null,origin:'2026-11-04',parent:live.id});assert.deepEqual(windows[Planning.key('shift','physical')],{from:secondWeek.from,to:secondWeek.from,origin:null,parent:null});
  assert.deepEqual(windows[Planning.key('week','99')],{from:secondWeek.from,to:secondWeek.to,origin:null,parent:null});assert.ok(pages.flatMap(page=>page.records).some(row=>row.id==='physical'&&row.value===null&&row.version===2));
  const Viewport=require('../src/planning-viewport.js'),parts=Viewport.split(result);for(let index=0;index<parts.length;index++){const separate=(await collect(db,owner,{period:index?secondWeek:firstWeek})).result;assert.deepEqual(parts[index].studio,separate.studio);assert.deepEqual({...parts[index].planning,deferred:[...parts[index].planning.deferred].sort()},{...separate.planning,deferred:[...separate.planning.deferred].sort()});assert.deepEqual(parts[index].directory,separate.directory);}
  const cache=Viewport.create();cache.putRange(result);assert.deepEqual(cache.assemble(firstWeek).studio,parts[0].studio);assert.deepEqual(cache.assemble(secondWeek).planning,parts[1].planning);assert.equal(JSON.stringify(parts).includes('PRIVATE_ABSENCE_COMMENT'),false);db.sqlite.close();
});

test('legacy and operation projections retain their 500-row ceiling and omit the deferred calendar receipt',async()=>{
  const items=Array.from({length:1100},(_,index)=>shift('shift-'+String(index).padStart(4,'0'),firstWeek.from)),{db,owner,workspaceId}=await setup(source({edits:Object.fromEntries(items.map(item=>[item.id,item])),publications:publications(items)}));
  const legacy=await collect(db,owner,{instructions:null});assert.ok(legacy.pages.length>=5);assert.ok(legacy.pages.every(page=>page.records.length+page.publicationRows.length+page.auxRows.length<=500&&page.planning.recordWindows===undefined));
  await assert.rejects(()=>publicationWindowPage({db,workspaceId,...range,maxRows:501}),error=>error.status===400);await assert.rejects(()=>publicationSelectionPage({db,workspaceId,selection:{scopeKeys:[firstWeek.from+'|0']},instructions:'deferred',maxRows:501}),error=>error.status===400);await assert.rejects(()=>publicationWindowPage({db,workspaceId,...range,instructions:'deferred',maxRows:1001}),error=>error.status===400);db.sqlite.close();
});

test('larger compact pages retain the byte budget and plan, absence, directory, tenant and range cursor fences',async()=>{
  const edits=Object.fromEntries(Array.from({length:1250},(_,index)=>{const id='shift-'+String(index).padStart(4,'0')+'æ'.repeat(200);return [id,shift(id,index%2?firstWeek.from:secondWeek.from)];})),{db,owner,workspaceId}=await setup(source({edits}));
  const {pages,result}=await collect(db,owner);assert.ok(pages[0].records.length<1000&&pages.length>=2,'Repeated long identities exhaust bytes before the 1000-row limit.');assert.equal(Object.keys(result.studio.edits).length,1250);for(const page of pages){const selectedBytes=Buffer.byteLength(JSON.stringify(page.records))+Buffer.byteLength(JSON.stringify(page.planning.recordWindows));assert.ok(selectedBytes<1024*1024+10);}
  db.sqlite.prepare('INSERT INTO workspace_absence_imports VALUES (?,0,?)').run(workspaceId,'2026-11-02T12:00:00.000Z');const first=await Store.readStudioWindow(db,owner,{...range,instructions:'deferred'});assert.ok(first.nextCursor);const continuation=()=>Store.readStudioWindow(db,owner,{...range,instructions:'deferred',cursor:first.nextCursor});
  await assert.rejects(()=>Store.readStudioWindow(db,owner,{...firstWeek,instructions:'deferred',cursor:first.nextCursor}),error=>error.status===409);
  db.sqlite.prepare('UPDATE workspace_absence_imports SET version=version+1 WHERE workspace_id=?').run(workspaceId);await assert.rejects(continuation,error=>error.status===409);db.sqlite.prepare('UPDATE workspace_absence_imports SET version=version-1 WHERE workspace_id=?').run(workspaceId);
  db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1 WHERE workspace_id=?').run(workspaceId);await assert.rejects(continuation,error=>error.status===409);db.sqlite.prepare('UPDATE workspace_directory_state SET version=version-1 WHERE workspace_id=?').run(workspaceId);
  const sourceToken=db.sqlite.prepare('SELECT write_token FROM studio_states WHERE owner_id=?').get(owner).write_token;db.sqlite.prepare('UPDATE studio_states SET write_token=? WHERE owner_id=?').run(sourceToken+'-changed',owner);await assert.rejects(continuation,error=>error.status===409);db.sqlite.prepare('UPDATE studio_states SET write_token=? WHERE owner_id=?').run(sourceToken,owner);
  const other='other-owner';await Store.writeStudio(db,other,0,source());db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('other-workspace',other,other,'2026-11-02T12:00:00.000Z');await collect(db,other);await assert.rejects(()=>Store.readStudioWindow(db,other,{...range,instructions:'deferred',cursor:first.nextCursor}),error=>error.status===409);db.sqlite.close();
});
