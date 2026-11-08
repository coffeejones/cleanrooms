const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Window=require('../src/planning-window.js'),Planning=require('../src/planning-records.js'),Scope=require('../src/planning-scope.js'),Departments=require('../src/department-model.js');
const MAX_BYTES=1024*1024,calendar={from:'2026-11-02',to:'2026-11-08'},bytes=value=>Buffer.byteLength(JSON.stringify(value));
const shift=(id,date,patch={})=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'',...patch});
const series=(note='')=>({id:'own-series',person:'p0',site:0,startDate:'2027-01-04',endDate:'2027-01-31',weekdays:[0,2],start:'07:00',end:'15:00',note});
const base=patch=>({storageVersion:1,demoSeed:false,calendarAnchor:calendar.from,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[],...patch});
const projection={mode:'series',seriesId:'own-series',ranges:[{from:'2027-01-04',to:'2027-01-31'}],calendar};
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
  const db={sqlite,beforeBatch:null,queries:[],prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{
    await db.beforeBatch?.(statements);db.queries.push(...statements);sqlite.exec('BEGIN IMMEDIATE');
    try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);return query.columns().length?{success:true,results:query.all(...values),meta:{changes:0}}:{success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  };
  return db;
}
async function setup(studio){
  const db=database(),owner='coalesced-boundary-owner',workspaceId='ws-coalesced-boundary';
  assert.equal((await Store.writeStudio(db,owner,0,studio)).ok,true);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId,owner,owner,'2026-11-02T12:00:00.000Z');
  return {db,owner,workspaceId};
}
async function collect(db,owner,first){
  const collector=Window.collector(projection),pages=[],seen=new Set();let page=first,cursor=null;
  do{
    page=page||await Store.readStudioSelection(db,owner,{...projection,instructions:'deferred',...(cursor?{cursor}:{})});pages.push(page);
    cursor=collector.add(page);if(cursor){assert.equal(seen.has(cursor),false,'Every continuation must advance rather than repeat a blocked phase.');seen.add(cursor);}
    assert.ok(pages.length<20,'A bounded series context must finish without a cursor loop.');page=null;
  }while(cursor);
  return {result:collector.finish(),pages};
}
const decodeCursor=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));

test('a source commit racing calendar-to-own coalescing retries the whole first response before exposing any mixed records',async()=>{
  const {db,owner}=await setup(base({series:[series('Old own instructions')],edits:{visible:shift('visible','2026-11-03',{note:'Calendar instructions'})}}));
  try{
    await collect(db,owner);let calendarSeen=false,changed=false;
    db.beforeBatch=async statements=>{
      if(statements.some(query=>query.sql.includes('WITH candidates(kind,id)')))calendarSeen=true;
      if(changed||!statements.some(query=>query.sql.startsWith('SELECT record.kind,record.id,record.version,record.deleted,record.sort_order,length(CAST(record.config AS BLOB)) stored_bytes')))return;
      assert.equal(calendarSeen,true,'The mutation occurs after the calendar phase and before selected full records.');changed=true;db.beforeBatch=null;
      const current=await Store.readStudio(db,owner);current.studio.series.find(item=>item.id==='own-series').note='New committed own instructions';
      assert.equal((await Store.writeStudio(db,owner,current.revision,current.studio)).ok,true);
    };
    const {result,pages}=await collect(db,owner);
    assert.equal(changed,true);assert.equal(result.revision,2);assert.ok(pages.every(page=>page.revision===2));
    assert.equal(result.studio.series.find(item=>item.id==='own-series').note,'New committed own instructions');
    assert.equal(JSON.stringify(result).includes('Old own instructions'),false);assert.ok(result.studio.edits.visible._instructions);
  }finally{db.sqlite.close();}
});

test('a full own description larger than one page waits behind a nonempty calendar and is emitted alone without being skipped',async()=>{
  const note='Lang instruktion 🔑\n'.repeat(75000),{db,owner}=await setup(base({series:[series(note)],edits:{visible:shift('visible','2026-11-03')}}));
  try{
    const first=await Store.readStudioSelection(db,owner,{...projection,instructions:'deferred'});
    assert.ok(first.records.some(row=>row.id==='visible'));assert.equal(first.records.some(row=>row.id==='own-series'),false);
    assert.ok(first.nextCursor);assert.equal(decodeCursor(first.nextCursor).phase,'own');assert.equal(decodeCursor(first.nextCursor).after,null);
    const {result,pages}=await collect(db,owner,first),ownPage=pages.find(page=>page.records.some(row=>row.id==='own-series'&&row.value?.note===note));
    assert.ok(ownPage);assert.equal(ownPage.records.length+ownPage.publicationRows.length+ownPage.auxRows.length,1);
    assert.ok(bytes({records:ownPage.records,publicationRows:ownPage.publicationRows,auxRows:ownPage.auxRows})>MAX_BYTES,'The established single-record soft budget must preserve long notes.');
    assert.equal(result.studio.series.find(item=>item.id==='own-series').note,note);
    assert.equal(result.planning.deferred.includes(Planning.key('series','own-series')),false);
    assert.ok(pages.length>=3,'The oversized record must not absorb later context phases.');
  }finally{db.sqlite.close();}
});

function nearlyFullWeek(){
  const week={published:false,changes:0,baseline:[]},row={kind:'week',id:'0',value:Scope.compact('week','0',week),sortOrder:0,version:1},target=MAX_BYTES-800;
  let size=bytes(row),index=0;
  for(;;){
    const item=shift('baseline-'+index,'2026-11-03'),compact=Scope.compact('published',item.id,item),extra=bytes(compact)+(index?1:0);
    if(size+extra>target)break;week.baseline.push(item);size+=extra;index++;
  }
  week.baseline.at(-1).id+='x'.repeat(target-size);
  assert.equal(bytes({...row,value:Scope.compact('week','0',week)}),target);
  return week;
}

test('less than 1KiB remaining after a compact calendar row defers the next phase at a progressing cursor',async()=>{
  const week=nearlyFullWeek(),{db,owner}=await setup(base({series:[series('Selected instructions')],weekPlans:{0:week}}));
  try{
    const first=await Store.readStudioSelection(db,owner,{...projection,instructions:'deferred'}),payloadBytes=bytes({records:first.records,publicationRows:first.publicationRows,auxRows:first.auxRows});
    assert.equal(first.records.length,1);assert.equal(first.records[0].kind,'week');assert.ok(MAX_BYTES-payloadBytes>0&&MAX_BYTES-payloadBytes<1024);
    assert.ok(first.nextCursor);assert.equal(decodeCursor(first.nextCursor).phase,'own');assert.equal(decodeCursor(first.nextCursor).after,null);
    const {result,pages}=await collect(db,owner,first);
    assert.equal(result.studio.weekPlans['0'].baseline.length,week.baseline.length);
    assert.equal(result.studio.series.find(item=>item.id==='own-series').note,'Selected instructions');
    assert.ok(pages.slice(1).some(page=>page.records.some(row=>row.id==='own-series')));
  }finally{db.sqlite.close();}
});
