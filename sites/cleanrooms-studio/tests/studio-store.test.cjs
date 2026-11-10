const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const Store = require('../lib/studio-store.mjs');
const Departments = require('../src/department-model.js');
const capabilities = {manageDepartments:true};

// The D1-shaped adapter executes the generated migration and actual prepared SQL
// in SQLite transactions, including rollback if any batched statement fails.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = path.join(__dirname,'../drizzle');
  const migrations = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length,'Generate the production Drizzle migration before testing storage.');
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(directory,file),'utf8'));
  const adapter = {
    sqlite,failAt:null,batches:[],
    prepare:sql => ({bind:(...values) => ({sql,values})}),
    async batch(statements) {
      adapter.batches.push(statements);
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({sql,values},index) => {
          if (adapter.failAt === index) { adapter.failAt = null; throw new Error('Injected storage failure'); }
          const statement = sqlite.prepare(sql);
          if (/^\s*SELECT\b/i.test(sql)) return {success:true,results:statement.all(...values),meta:{changes:0}};
          const result = statement.run(...values);
          return {success:true,results:[],meta:{changes:Number(result.changes)}};
        });
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return adapter;
}
const studio = (changes = {}) => ({storageVersion:1,series:[],edits:{},deleted:[],weekPlans:{},requests:{},coverageRules:[],checklistProgress:{},...changes,
  ...(changes.edits?{edits:Object.fromEntries(Object.entries(changes.edits).map(([id,shift])=>[id,shift&&typeof shift==='object'&&!Array.isArray(shift)?{id,person:'p0',site:0,date:'2026-10-27',start:'07:00',end:'15:00',...shift}:shift]))}:{})});
const recurring = (changes = {}) => ({id:'series-cleaning',person:'p0',site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:'Faste vagter',...changes});
const request = (method,body,headers = {}) => new Request('https://cleanrooms.example/api/studio',{
  method,headers:{'oai-authenticated-user-id':'owner-a',...(method === 'PUT' ? {'Origin':'https://cleanrooms.example','Content-Type':'application/json'} : {}),...headers},
  ...(body === undefined ? {} : {body:typeof body === 'string' ? body : JSON.stringify(body)})
});
const route = (db,method,body,headers) => Store.handleStudioRequest(request(method,body,headers),db);

test('planned pauses survive storage and stale clients cannot silently remove the new agreement',async()=>{
  const db=database(),original=studio({series:[recurring({plannedBreakMinutes:30,dayTimes:{1:{start:'07:00',end:'15:00',plannedBreakMinutes:20}}})],edits:{one:{id:'one',person:'p0',site:0,date:'2026-10-27',start:'07:00',end:'15:00',plannedBreakMinutes:30}}});
  assert.equal((await Store.writeStudio(db,'owner-a',0,original)).ok,true);assert.deepEqual((await Store.readStudio(db,'owner-a')).studio,original);
  const staleSeries=structuredClone(original);delete staleSeries.series[0].plannedBreakMinutes;await assert.rejects(Store.writeStudio(db,'owner-a',1,staleSeries),/planlagte pause mangler/);
  const staleShift=structuredClone(original);delete staleShift.edits.one.plannedBreakMinutes;await assert.rejects(Store.writeStudio(db,'owner-a',1,staleShift),/planlagte pause mangler/);
  const cleared=structuredClone(original);cleared.series[0].plannedBreakMinutes=0;cleared.series[0].dayTimes={};cleared.edits.one.plannedBreakMinutes=0;assert.equal((await Store.writeStudio(db,'owner-a',1,cleared)).ok,true);
  for(const value of [null,'30',-1,1.5,480]){const invalid=structuredClone(cleared);invalid.edits.one.plannedBreakMinutes=value;assert.throws(()=>Store.validateStudio(invalid),/planlagte pause/);}
  const nested=studio({series:[recurring({dayTimes:{1:{start:'07:00',end:'15:00',plannedBreakMinutes:20}}})]});assert.equal((await Store.writeStudio(db,'owner-b',0,nested)).ok,true);const lost=structuredClone(nested);delete lost.series[0].dayTimes[1].plannedBreakMinutes;await assert.rejects(Store.writeStudio(db,'owner-b',1,lost),/Ugedagens planlagte pause mangler/);lost.series[0].plannedBreakMinutes=0;assert.equal((await Store.writeStudio(db,'owner-b',1,lost)).ok,true);
  db.sqlite.close();
});

test('an authenticated first read is empty and complete plans/checklist progress survive durable writes',async()=>{
  const db = database(), original = studio({
    edits:{one:{id:'one',note:'  Nøgle 🔑\nAnden linje\n',noteRich:'{"type":"doc","content":[]}' }},
    checklistProgress:{one:{person:'p0',template:'tasks-v1',checked:[0,2]}},requests:{b:'approved'}
  });
  const empty = await route(db,'GET'); assert.equal(empty.status,200); assert.deepEqual(await empty.json(),{revision:0,studio:null,capabilities});
  const saved = await route(db,'PUT',{revision:0,studio:original}); assert.equal(saved.status,200); assert.deepEqual(await saved.json(),{revision:1});
  const reloaded = await route(db,'GET'); assert.deepEqual(await reloaded.json(),{revision:1,studio:original,capabilities});
  assert.match(reloaded.headers.get('cache-control'),/no-store/);
  assert.match(reloaded.headers.get('vary'),/oai-authenticated-user-id/);
  db.sqlite.close();
});

test('snapshots larger than a D1 row split at safe UTF-8 boundaries and reconstruct exactly',async()=>{
  const db = database(), note = '  Æøå🔑😀'.repeat(150000) + '\n\n', original = studio({edits:{long:{id:'long',note}}});
  assert.ok(new TextEncoder().encode(JSON.stringify(original)).length > 2000000);
  const split = Store.splitSnapshot(JSON.stringify(original));
  assert.ok(split.chunks.length > 4); assert.equal(split.chunks.join(''),JSON.stringify(original));
  assert.ok(split.chunks.every(chunk => new TextEncoder().encode(chunk).length <= Store.CHUNK_BYTES));
  assert.equal((await Store.writeStudio(db,'owner-a',0,original)).ok,true);
  const result = await Store.readStudio(db,'owner-a'); assert.equal(result.studio.edits.long.note,note);
  assert.equal(result.studio.edits.long.note.length,note.length);
  const rows = db.sqlite.prepare('SELECT content FROM studio_state_chunks').all();
  assert.equal(rows.length,split.chunks.length);
  db.sqlite.close();
});

test('optimistic concurrency rejects a stale writer and returns the latest complete state',async()=>{
  const db = database(), first = studio({requests:{b:'approved'}}), stale = studio({requests:{b:'rejected'}});
  await Store.writeStudio(db,'owner-a',0,first);
  const batches = db.batches.length, conflict = await route(db,'PUT',{revision:0,studio:stale});
  assert.equal(conflict.status,409); assert.deepEqual(await conflict.json(),{error:'revision_conflict',revision:1,studio:first});
  assert.equal(db.batches.length,batches + 1,'A known stale revision only reads the latest snapshot once.');
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:first});
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM studio_state_chunks').get().count,1);
  const next = await route(db,'PUT',{revision:1,studio:stale}); assert.equal(next.status,200);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:2,studio:stale});
  assert.deepEqual(db.sqlite.prepare('SELECT DISTINCT revision FROM studio_state_chunks').all().map(row => row.revision),[2]);
  db.sqlite.close();
});

test('simultaneous same-revision saves have one winner and never mix chunk sets',async()=>{
  const db = database(), a = studio({edits:{a:{id:'a',note:'A'.repeat(700000)}}}), b = studio({edits:{b:{id:'b',note:'B'.repeat(700000)}}});
  const outcomes = await Promise.all([Store.writeStudio(db,'owner-a',0,a),Store.writeStudio(db,'owner-a',0,b)]);
  assert.equal(outcomes.filter(result => result.ok).length,1);
  const winner = outcomes[0].ok ? a : b, loser = outcomes.find(result => !result.ok);
  assert.deepEqual(loser,{ok:false,revision:1,studio:winner});
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:winner});
  db.sqlite.close();
});

test('a failing chunk insert rolls back both revision and data, preserving the prior plan',async()=>{
  const db = database(), original = studio({requests:{b:'approved'}});
  await Store.writeStudio(db,'owner-a',0,original);
  db.failAt = 3;
  const result = await route(db,'PUT',{revision:1,studio:studio({edits:{long:{note:'X'.repeat(1200000)}}})});
  assert.equal(result.status,500);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:original});
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM studio_state_chunks').get().count,1);
  db.sqlite.close();
});

test('owner identity comes only from the authenticated header and SQL partitions every operation',async()=>{
  const db = database(), a = studio({requests:{a:'approved'}}), b = studio({ownerId:'owner-a',requests:{b:'rejected'}});
  await Store.writeStudio(db,'owner-a',0,a);
  const empty = await route(db,'GET',undefined,{'oai-authenticated-user-id':"owner-b' OR 1=1 --"});
  assert.deepEqual(await empty.json(),{revision:0,studio:null,capabilities});
  await route(db,'PUT',{revision:0,studio:b},{'oai-authenticated-user-id':'owner-b'});
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:a});
  assert.deepEqual(await Store.readStudio(db,'owner-b'),{revision:1,studio:b});
  db.sqlite.close();
});

test('department capabilities belong to the authenticated snapshot owner, never supplied studio roles or flags',async()=>{
  const db = database(), organization = Departments.defaultOrganization();
  const original = studio({organization,role:'employee',capabilities:{manageDepartments:false},ownerId:'owner-b'});
  assert.equal((await route(db,'PUT',{revision:0,studio:original})).status,200);
  const read = await route(db,'GET');
  assert.deepEqual(await read.json(),{revision:1,studio:original,capabilities});
  const forged = studio({organization,role:'admin',capabilities:{manageDepartments:true},ownerId:'owner-a'});
  assert.equal((await route(db,'PUT',{revision:0,studio:forged},{'oai-authenticated-user-id':'owner-b'})).status,200);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:original});
  assert.deepEqual(await Store.readStudio(db,'owner-b'),{revision:1,studio:forged});
  const fresh = await route(db,'GET',undefined,{'oai-authenticated-user-id':'owner-c'});
  assert.deepEqual(await fresh.json(),{revision:0,studio:null,capabilities});
  db.sqlite.close();
});

test('malformed organizations reject before database access, while legacy snapshots remain valid',async()=>{
  let accessed = 0; const db = () => { accessed += 1; throw new Error('Should not access database'); };
  const badReference = Departments.defaultOrganization(); badReference.departments[0].siteIds = [3];
  const tooManySites = Departments.defaultOrganization();
  for (let index = 3; index <= 2000; index++) tooManySites.sites.push({id:'site-'+index,name:'Sted '+index,address:'',color:'var(--cs-blue)'});
  const tooManyDepartments = Departments.defaultOrganization();
  for (let index = 3; index <= 1000; index++) tooManyDepartments.departments.push({id:'dep-'+index,name:'Afdeling '+index,kind:'branch',siteIds:[]});
  for (const organization of [null,{}, {...Departments.defaultOrganization(),version:2},badReference,tooManySites,tooManyDepartments]) {
    const response = await route(db,'PUT',{revision:0,studio:studio({organization})});
    assert.equal(response.status,400); assert.equal((await response.json()).error,'invalid_studio');
  }
  assert.equal(accessed,0); assert.equal(Store.validateStudio(studio()).storageVersion,1);
});

test('saved site indices cannot be removed, reordered, replaced or erased by an old tab',async()=>{
  const db = database(), organization = Departments.defaultOrganization();
  organization.sites.push({id:'site-east',name:'Øst',address:'',color:'var(--cs-orange)'},{id:'site-west',name:'Vest',address:'',color:'var(--cs-blue)'});
  const original = studio({organization,edits:{original:{id:'original',site:3}}});
  assert.equal((await Store.writeStudio(db,'owner-a',0,original)).ok,true);
  const dropped = Departments.normalize(organization); dropped.sites.pop();
  const reordered = Departments.normalize(organization); [reordered.sites[3],reordered.sites[4]] = [reordered.sites[4],reordered.sites[3]];
  const replaced = Departments.normalize(organization); replaced.sites[3].id = 'site-imposter';
  for (const next of [studio(),studio({organization:dropped}),studio({organization:reordered}),studio({organization:replaced})]) {
    assert.equal((await route(db,'PUT',{revision:1,studio:next})).status,400);
    assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:original});
  }
  const stale = await route(db,'PUT',{revision:0,studio:studio()});
  assert.equal(stale.status,409,'An outdated tab receives the latest state before organization preservation is evaluated.');
  assert.equal((await stale.json()).studio.organization.sites[3].id,'site-east');
  db.sqlite.close();
});

test('legacy plans can adopt departments and append sites without changing existing numeric references',async()=>{
  const db = database(), original = studio({edits:{shift:{id:'shift',site:2}}});
  await Store.writeStudio(db,'owner-a',0,original);
  const organization = Departments.defaultOrganization();
  organization.sites[0].name = 'Kontor Nord opdateret';
  organization.sites.push({id:'site-east',name:'Øst',address:'Nyvej 1',color:'var(--cs-blue)'});
  organization.departments.push({id:'dep-east',name:'Østafdelingen',kind:'branch',siteIds:[0,3]});
  const next = {...original,organization};
  assert.equal((await route(db,'PUT',{revision:1,studio:next})).status,200);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:2,studio:next});
  const stale = Departments.normalize(organization); stale.sites.push({id:'site-stale',name:'Gammel fane',address:'',color:'var(--cs-purple)'});
  assert.equal((await route(db,'PUT',{revision:1,studio:{...next,organization:stale}})).status,409);
  const appended = Departments.normalize(organization); appended.sites.push({id:'site-new',name:'Nyt sted',address:'',color:'var(--cs-purple)'});
  const saved = {...next,organization:appended};
  assert.equal((await route(db,'PUT',{revision:2,studio:saved})).status,200);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:3,studio:saved});
  db.sqlite.close();
});

test('concurrent organization appends use CAS and cannot replace the winning numeric site index on retry',async()=>{
  const db = database(), organization = Departments.defaultOrganization();
  await Store.writeStudio(db,'owner-a',0,studio({organization}));
  const plans = ['east','west'].map(suffix => {
    const next = Departments.normalize(organization);
    next.sites.push({id:'site-'+suffix,name:suffix,address:'',color:'var(--cs-blue)'});
    return studio({organization:next});
  });
  const results = await Promise.all(plans.map(plan => Store.writeStudio(db,'owner-a',1,plan)));
  assert.equal(results.filter(result => result.ok).length,1);
  const loserIndex = results.findIndex(result => !result.ok), winner = plans[1 - loserIndex];
  assert.deepEqual(results[loserIndex],{ok:false,revision:2,studio:winner});
  await assert.rejects(()=>Store.writeStudio(db,'owner-a',2,plans[loserIndex]),error => error.status === 400);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:2,studio:winner});
  db.sqlite.close();
});

test('missing identity and cross-origin write attempts fail before any database access',async()=>{
  let accessed = 0; const db = () => { accessed += 1; throw new Error('Should not access database'); };
  const anonymous = await route(db,'GET',undefined,{'oai-authenticated-user-id':''}); assert.equal(anonymous.status,401);
  for (const headers of [{origin:'https://evil.example'},{origin:'null'},{origin:''},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}]) {
    assert.equal((await route(db,'PUT',{revision:0,studio:studio()},headers)).status,403);
  }
  assert.equal(accessed,0);
});

test('invalid versions, plan containers, values and revision numbers never reach D1',async()=>{
  let accessed = 0; const db = () => { accessed += 1; throw new Error('Should not access database'); };
  for (const value of [null,[],{},studio({storageVersion:2}),studio({checklistProgress:[]}),studio({edits:{bad:null}}),studio({requests:{x:'maybe'}})]) {
    assert.equal((await route(db,'PUT',{revision:0,studio:value})).status,400);
  }
  for (const value of [-1,0.5,'0',null,Number.MAX_SAFE_INTEGER]) assert.equal((await route(db,'PUT',{revision:value,studio:studio()})).status,400);
  assert.equal((await route(db,'PUT','{"revision":0,"studio":')).status,400);
  assert.equal((await route(db,'PUT',{revision:0,studio:studio()},{'content-type':'text/plain'})).status,415);
  assert.equal(accessed,0);
  const cyclic = studio(); cyclic.cyclic = cyclic;
  assert.throws(()=>Store.validateStudio(cyclic),error => error.status === 400);
  assert.throws(()=>Store.validateStudio(studio({invalid:NaN})),error => error.status === 400);
  assert.throws(()=>Store.validateStudio(studio({invalid:undefined})),error => error.status === 400);
});

test('per-weekday times and logical agreement ids survive exact durable roundtrips with legacy fallback',async()=>{
  const db=database(),series=recurring({groupId:'agreement-cleaning',dayTimes:{3:{start:'09:30',end:'17:15'}}}),original=studio({series:[series]});
  assert.equal((await route(db,'PUT',{revision:0,studio:original})).status,200);
  assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:original});
  assert.deepEqual((await (await route(db,'GET')).json()).studio.series,[series]);
  const Data=require('../src/studio-data.js'),shifts=Data.shiftsInRange('2026-11-02','2026-11-08',{...original,demoSeed:false});
  assert.deepEqual(shifts.map(shift=>[shift.date,shift.start,shift.end]),[['2026-11-03','07:00','15:00'],['2026-11-05','09:30','17:15']]);
  const unchanged={...original,requests:{b:'approved'}};assert.equal((await route(db,'PUT',{revision:1,studio:unchanged})).status,200);
  assert.deepEqual((await Store.readStudio(db,'owner-a')).studio.series,[series]);
  db.sqlite.close();
});

test('malformed weekday maps and agreement ids fail before storage access',async()=>{
  let accessed=0;const db=()=>{accessed++;throw new Error('Invalid series must not open storage.');};
  const clock={start:'08:00',end:'16:00'};
  const invalidTimes=[null,[],false,{'7':clock},{'01':clock},{'0':clock},{'1':null},{'1':[]},{'1':{start:'08:00'}},{'1':{start:'8:00',end:'16:00'}},{'1':{start:'16:00',end:'16:00'}},{'1':{...clock,timezone:'UTC'}}];
  for(const dayTimes of invalidTimes){const response=await route(db,'PUT',{revision:0,studio:studio({series:[recurring({dayTimes})]})});assert.equal(response.status,400,JSON.stringify(dayTimes));assert.equal((await response.json()).error,'invalid_studio');}
  for(const groupId of [null,0,'',' invalid','invalid ','invalid/group','x'.repeat(161)])assert.equal((await route(db,'PUT',{revision:0,studio:studio({series:[recurring({groupId})]})})).status,400,JSON.stringify(groupId));
  assert.equal(accessed,0);
});

test('refreshed older writers cannot omit retained series metadata and explicit uniform reset remains supported',async()=>{
  const db=database(),series=recurring({groupId:'agreement-cleaning',dayTimes:{1:{start:'06:00',end:'12:00'}}}),original=studio({series:[series]});
  await Store.writeStudio(db,'owner-a',0,original);
  for(const field of ['dayTimes','groupId']){
    const stripped={...series};delete stripped[field];
    const response=await route(db,'PUT',{revision:1,studio:studio({series:[stripped]})});assert.equal(response.status,400,field);assert.match((await response.json()).message,/seneste version/);
    assert.deepEqual(await Store.readStudio(db,'owner-a'),{revision:1,studio:original});
  }
  const stale={...series};delete stale.dayTimes;delete stale.groupId;
  assert.equal((await route(db,'PUT',{revision:0,studio:studio({series:[stale]})})).status,409,'Stale revisions still receive CAS conflict before omission checks.');
  const reset=studio({series:[{...series,dayTimes:{},groupId:series.id}]});assert.equal((await route(db,'PUT',{revision:1,studio:reset})).status,200);
  assert.deepEqual((await Store.readStudio(db,'owner-a')).studio.series,reset.series);
  const legacy=recurring({id:'legacy-series'}),separate=studio({series:[legacy]});await Store.writeStudio(db,'legacy-owner',0,separate);
  assert.equal((await Store.writeStudio(db,'legacy-owner',1,{...separate,requests:{b:'approved'}})).ok,true);
  const saved=(await Store.readStudio(db,'legacy-owner')).studio.series[0];assert.equal(Object.hasOwn(saved,'dayTimes'),false);assert.equal(Object.hasOwn(saved,'groupId'),false);
  db.sqlite.close();
});

test('explicit agreement phases cannot overlap while adjacent periods and unrelated legacy records remain compatible',async()=>{
  const first=recurring({id:'phase-a',groupId:'agreement-cleaning',endDate:'2026-11-08'}),overlap=recurring({id:'phase-b',groupId:'agreement-cleaning',startDate:'2026-11-08'});
  assert.throws(()=>Store.validateStudio(studio({series:[first,overlap]})),error=>error.status===400);
  const adjacent={...overlap,startDate:'2026-11-09'};assert.doesNotThrow(()=>Store.validateStudio(studio({series:[first,adjacent]})));
  const legacyRoot=recurring({id:'legacy-agreement',endDate:'2026-11-08'}),newPhase={...overlap,groupId:legacyRoot.id};
  assert.throws(()=>Store.validateStudio(studio({series:[legacyRoot,newPhase]})),error=>error.status===400,'New phases must also respect the matching legacy root period.');
  const legacy=studio({series:[first,adjacent,{id:'unrelated-legacy-record'}]});
  assert.doesNotThrow(()=>Store.validateStudio(legacy,{readOnly:true}),'Stored legacy payloads remain inspectable for explicit repair.');
  assert.throws(()=>Store.validateStudio(legacy),error=>error.status===400,'A new incomplete legacy-shaped series must not bypass write validation.');
});

test('declared and streamed bodies beyond16MiB reject safely before storage, with no UI text cap',async()=>{
  let accessed = 0; const db = () => { accessed += 1; throw new Error('Should not access database'); };
  const declared = await route(db,'PUT',{revision:0,studio:studio()},{'content-length':String(Store.MAX_BODY_BYTES + 1)});
  assert.equal(declared.status,413);
  let cancelled = false;
  const body = new ReadableStream({start(controller){controller.enqueue(new Uint8Array(Store.MAX_BODY_BYTES + 1));},cancel(){cancelled=true;}});
  const streamed = new Request('https://cleanrooms.example/api/studio',{method:'PUT',duplex:'half',body,headers:{'oai-authenticated-user-id':'owner-a',origin:'https://cleanrooms.example','content-type':'application/json'}});
  const result = await Store.handleStudioRequest(streamed,db);
  assert.equal(result.status,413); assert.equal(cancelled,true); assert.equal(accessed,0);
  assert.throws(()=>Store.splitSnapshot('x'.repeat(Store.MAX_BODY_BYTES + 1)),error => error.status === 413);
});

test('a stale revision on a never-saved account creates neither snapshot nor chunks',async()=>{
  const db = database(), result = await Store.writeStudio(db,'new-owner',7,studio());
  assert.deepEqual(result,{ok:false,revision:0,studio:null});
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM studio_states').get().count,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM studio_state_chunks').get().count,0);
  db.sqlite.close();
});

test('missing or corrupt stored chunks fail closed instead of returning a partial or fresh plan',async()=>{
  const db = database(); await Store.writeStudio(db,'owner-a',0,studio());
  db.sqlite.prepare('DELETE FROM studio_state_chunks WHERE owner_id = ?').run('owner-a');
  await assert.rejects(()=>Store.readStudio(db,'owner-a'),error => error.status === 500 && error.code === 'invalid_saved_state');
  assert.equal((await route(db,'GET')).status,500);
  assert.equal(db.sqlite.prepare('SELECT revision FROM studio_states WHERE owner_id = ?').get('owner-a').revision,1);
  db.sqlite.close();
});

async function bridge() {
  const source = fs.readFileSync(path.join(__dirname,'../app/storage-bridge/route.ts'),'utf8');
  const compiled=require('esbuild').transformSync(source,{loader:'ts',format:'cjs',target:'es2022'}).code,module={exports:{}};
  vm.runInNewContext(compiled,{module,exports:module.exports,Response});
  const response = module.exports.GET(), html = await response.text();
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const parent = {}, calls = [], replies = [], handlers = new Map();
  let connect;
  const port = {addEventListener:(type,handler)=>handlers.set(type,handler),start(){this.started=true;},postMessage:value=>replies.push(value)};
  const context = {
    parent,URLSearchParams,location:{origin:'https://cleanrooms.example'},
    addEventListener:(type,handler)=>{if(type==='message')connect=handler;},
    fetch:async(url,options)=>{calls.push({url,options});return Response.json(options.method==='GET'?{revision:3,studio:studio(),capabilities}:{revision:4});}
  };
  vm.runInNewContext(code,context);
  return {response,parent,port,calls,replies,connect,send:value=>handlers.get('message')({data:value})};
}

test('the storage bridge accepts only its same-origin parent and forwards only fixed credentialed API actions',async()=>{
  const view = await bridge();
  assert.match(view.response.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.match(view.response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.match(view.response.headers.get('cache-control'),/no-store/);
  for (const event of [
    {source:{},origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]},
    {source:view.parent,origin:'null',data:{type:'cleanrooms-storage-connect'},ports:[view.port]},
    {source:view.parent,origin:'https://cleanrooms.example',data:{type:'other'},ports:[view.port]}
  ]) view.connect(event);
  assert.equal(view.port.started,undefined);
  view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
  assert.equal(view.port.started,true); assert.equal(view.replies[0].type,'cleanrooms-storage-ready');
  await view.send({id:1,action:'read',url:'https://evil.example'});
  assert.equal(view.calls[0].url,'/api/studio'); assert.equal(view.calls[0].options.credentials,'same-origin');
  assert.equal(view.calls[0].options.cache,'no-store');
  assert.equal(view.replies.at(-1).revision,3); assert.equal(view.replies.at(-1).ok,true);
  assert.deepEqual(view.replies.at(-1).capabilities,capabilities);
  await view.send({id:2,action:'write',revision:3,studio:studio(),url:'https://evil.example'});
  assert.equal(view.calls[1].url,'/api/studio'); assert.equal(view.calls[1].options.method,'PUT');
  assert.deepEqual(JSON.parse(view.calls[1].options.body),{revision:3,studio:studio()});
  assert.equal(view.replies.at(-1).revision,4);
  await view.send({id:3,action:'delete',url:'https://evil.example'}); assert.equal(view.calls.length,2);
});

test('the compiled typed storage bridge forwards planning commands once and drops unrelated write fields',async()=>{
  const view=await bridge();view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
  const planning={version:1,changes:[{kind:'shift',id:'one',expectedVersion:2,value:{edit:{id:'one',note:'Long instructions'},suppressed:false}}],metadataChanged:false,metadataBase:'a'.repeat(64),dependencies:{series:[],groups:[]}},publication={from:'2026-11-02',to:'2026-11-08',siteIds:[0]};
  await view.send({id:1,action:'write',revision:9,studio:{storageVersion:1,page:'schedule'},planning,publication,commandReceipt:'records',userId:'forged',url:'https://evil.example/delete',command:'DELETE ALL'});
  assert.equal(view.calls.length,1);assert.equal(view.calls[0].url,'/api/studio');assert.equal(view.calls[0].options.method,'PUT');assert.deepEqual(JSON.parse(view.calls[0].options.body),{revision:9,studio:{storageVersion:1,page:'schedule'},planning,publication,commandReceipt:'records'});
  await view.send({id:2,action:'write',revision:9,studio:{storageVersion:1,page:'schedule'},planning,commandReceipt:'full-admin-authority'});assert.equal(JSON.parse(view.calls[1].options.body).commandReceipt,undefined);
  assert.match(view.response.headers.get('content-security-policy'),/connect-src 'self'/);assert.equal(view.response.headers.get('x-frame-options'),'SAMEORIGIN');
});

test('the compiled bridge binds calendar reads to a validated period and encodes opaque continuation cursors',async()=>{
  const view=await bridge();view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
  const projection={mode:'calendar',from:'2026-11-02',to:'2026-12-27'},cursor='next+/=&?owner=other';
  await view.send({id:1,action:'read',projection,cursor,url:'https://evil.example',ownerId:'other'});
  assert.equal(view.calls.length,1);const target=new URL(view.calls[0].url,'https://cleanrooms.example');
  assert.equal(target.pathname,'/api/studio');assert.deepEqual(Object.fromEntries(target.searchParams),{projection:'calendar',from:projection.from,to:projection.to,cursor});
  assert.equal(view.calls[0].options.credentials,'same-origin');assert.equal(view.calls[0].options.cache,'no-store');
  await view.send({id:2,action:'write',revision:3,studio:studio(),projection});
  assert.deepEqual(JSON.parse(view.calls[1].options.body).projection,projection);
  const invalid=[{projection:{...projection,to:'2026-12-28'}},{projection:{...projection,from:'2026-02-30'}},{projection:{...projection,mode:'full'}},{projection:{...projection,personId:'other'}},{projection,cursor:''},{projection,cursor:'x'.repeat(16385)},{cursor:'orphan'}];
  for(const [index,payload]of invalid.entries()){
    await view.send({id:3+index,action:'read',...payload});assert.equal(view.calls.length,2,'An invalid selector never reaches fetch');
    assert.equal(view.replies.at(-1).status,400);assert.equal(view.replies.at(-1).error,'invalid_planning_projection');
  }
});

test('the bridge explicitly opts into deferred calendar instructions and fixes point details to the authenticated account route',async()=>{
  const view=await bridge();view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
  const projection={mode:'calendar',from:'2026-11-02',to:'2026-11-08'};
  await view.send({id:1,action:'read',projection,instructions:'deferred'});assert.equal(new URL(view.calls[0].url,'https://cleanrooms.example').searchParams.get('instructions'),'deferred');
  for(const [index,payload]of [{projection,instructions:'all-private'},{instructions:'deferred'},{projection,instructions:true}].entries()){await view.send({id:index+2,action:'read',...payload});assert.equal(view.calls.length,1);assert.equal(view.replies.at(-1).status,400);}
  await view.send({id:10,action:'account',operation:'plannerDetail',payload:{revision:4,directoryRevision:2,shiftIds:['one'],action:'updateMember'},url:'https://evil.example'});
  assert.equal(view.calls.length,2);assert.equal(view.calls[1].url,'/api/accounts');assert.equal(view.calls[1].options.method,'POST');assert.equal(view.calls[1].options.credentials,'same-origin');assert.deepEqual(JSON.parse(view.calls[1].options.body),{revision:4,directoryRevision:2,shiftIds:['one'],action:'plannerDetail'});
});

test('the compiled bridge transports only validated operation selectors without converting them into full reads',async()=>{
  const view=await bridge();view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
  const calendar={from:'2026-11-02',to:'2026-12-27'},selectors=[{mode:'series-list',calendar},{mode:'series',seriesId:'series-one',groupId:'group-one',ranges:[{from:'2027-01-01',to:'2027-06-30'}],calendar},{mode:'publication',from:'2026-11-02',to:'2026-11-29',siteIds:[0,1],includeDependencies:true,calendar}];
  for(const [index,projection]of selectors.entries()){
    await view.send({id:index+1,action:'read',projection,cursor:'next+/=&?'});const call=view.calls.at(-1),url=new URL(call.url,'https://cleanrooms.example');assert.equal(url.pathname,'/api/studio');assert.equal(url.searchParams.get('projection'),projection.mode);assert.deepEqual(JSON.parse(url.searchParams.get('selection')),projection);assert.equal(url.searchParams.get('cursor'),'next+/=&?');assert.equal(url.searchParams.has('ownerId'),false);assert.equal(call.options.credentials,'same-origin');
  }
  const invalid=[{...selectors[0],ownerId:'other'},{...selectors[1],groupId:'constructor'},{...selectors[1],ranges:[{from:'2027-01-01',to:'2028-01-02'}]},{...selectors[1],ranges:null},{...selectors[2],from:'2026-11-03'},{...selectors[2],siteIds:[0,0]},{...selectors[2],includeDependencies:'yes'},{...selectors[0],calendar:{from:'2026-11-02',to:'2026-12-28'}}];
  for(const [index,projection]of invalid.entries()){await view.send({id:100+index,action:'read',projection});assert.equal(view.calls.length,3);assert.equal(view.replies.at(-1).status,400);}
});

test('the compiled bridge keeps directory reads and entity patches on their own fixed authenticated endpoint',async()=>{
  const view=await bridge();view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
  const read={kind:'employee',ids:['person-one']},changes=[{kind:'employee',id:'person-one',expectedVersion:3,patch:{name:'Jonas'}}];
  await view.send({id:1,action:'directoryRead',payload:read,url:'https://evil.example',workspaceId:'forged'});assert.equal(view.calls[0].url,'/api/directory');assert.equal(view.calls[0].options.method,'POST');assert.equal(view.calls[0].options.credentials,'same-origin');assert.deepEqual(JSON.parse(view.calls[0].options.body),{action:'read',...read});
  await view.send({id:2,action:'directoryWrite',payload:{changes}});assert.equal(view.calls[1].url,'/api/directory');assert.deepEqual(JSON.parse(view.calls[1].options.body),{action:'write',changes});
  for(const [index,payload]of [{catalog:true,workspaceId:'forged'},{kind:'employee',ids:['__proto__']},{catalog:true,limit:501},{kind:'employee',ids:['person-one'],action:'delete'}].entries()){await view.send({id:3+index,action:'directoryRead',payload});assert.equal(view.calls.length,2);assert.equal(view.replies.at(-1).status,400);}
  await view.send({id:20,action:'directoryWrite',payload:{changes:[{...changes[0],expectedVersion:-1}]}});assert.equal(view.calls.length,2);assert.equal(view.replies.at(-1).error,'invalid_directory_request');
});

test('compiled bridge preserves the read-only series catalog flag without opening arbitrary projection fields',async()=>{
 const view=await bridge();view.connect({source:view.parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[view.port]});
 const projection={mode:'series-list',calendar:{from:'2026-11-02',to:'2026-12-27'},catalogOnly:true};await view.send({id:1,action:'read',projection});
 const target=new URL(view.calls[0].url,'https://cleanrooms.example');assert.equal(target.pathname,'/api/studio');assert.deepEqual(JSON.parse(target.searchParams.get('selection')),projection);assert.equal(view.calls[0].options.cache,'no-store');
 for(const [index,patch]of [{catalogOnly:false},{catalogOnly:'true'},{catalogOnly:1},{owner:'other'}].entries()){await view.send({id:index+2,action:'read',projection:{...projection,...patch}});assert.equal(view.calls.length,1);assert.equal(view.replies.at(-1).status,400);}
});
