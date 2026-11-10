const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const Time=require('../src/timekeeping-model.js');
const Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js'),Directory=require('../src/directory-records.js'),Publication=require('../src/publication-model.js');
function fixture(file,expose){const filename=path.join(__dirname,file),source=fs.readFileSync(filename,'utf8');return new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+'\nreturn {'+expose+'};')(createRequire(filename),__dirname);}
const F=fixture('workspace-access.test.cjs','database,studio,bootstrap,join,accounts,json,route,request,owner'),Mobile=fixture('mobile-route-employee.test.cjs','setup,owner');
const worker={id:'worksite-worker',email:'worker@example.test'},planner={id:'worksite-planner',email:'planner@example.test'},manager={id:'worksite-manager',email:'manager@example.test'};
const info={contactName:'Receptionen',contactPhone:'+45 12 34 56 78',parking:'Brug indkørslen mod øst.',accessInstructions:'Henvend dig i receptionen.\nBrug personaleindgangen efter kl. 18.'};
const clone=value=>JSON.parse(JSON.stringify(value));
const dir=async(db,payload,actor=F.owner)=>F.json(await Workspace.handleDirectoryRequest(F.request('/api/directory','POST',payload,actor),db));
const account=async(db,action,payload={},actor=worker)=>F.json(await F.accounts(db,{action,...payload},actor));
const change=(patch,expectedVersion=1,id='site-nord')=>({kind:'site',id,expectedVersion,patch});
async function setup(t,{date=Time.localNow().date,start='07:00',end='15:00'}={}){
 const db=F.database();t.after(()=>db.sqlite.close());const organization=Departments.defaultOrganization();organization.sites[0].worksiteInfo=info;organization.sites[1].worksiteInfo={accessInstructions:'FOREIGN SITE PRIVATE INSTRUCTIONS'};
 const week=Time.addDays(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)),period={from:week,to:Time.addDays(week,13)};
 const roster=[{id:'p0',name:'Own employee',initials:'OE',target:37,site:0,role:'Service',active:true},{id:'p1',name:'Other employee',initials:'PE',target:37,site:1,role:'Service',active:true}],edits={own:{id:'own',person:'p0',date,site:0,start,end,note:'Shift-specific instructions'},foreign:{id:'foreign',person:'p1',date,site:1,start:'07:00',end:'15:00',note:''},open:{id:'open',person:'',date:Time.addDays(date,1),site:1,start:'07:00',end:'15:00',note:''}};
 const source=Publication.publish(F.studio({demoSeed:false,organization,roster,edits}),{...period,siteIds:[0,1,2],includeDependencies:true,actor:{userId:F.owner.id,name:'Owner'},at:new Date().toISOString()}).studio;
 const loaded=await F.bootstrap(db,F.owner,source);await F.join(db,worker,{roleId:'employee',personId:'p0'});return {db,loaded,workspaceId:loaded.workspace.id,period,date};
}

test('worksite info accepts long literal guidance, is omitted from catalogs and requires explicit patches to change',()=>{
 const large={...info,parking:'P'.repeat(180000),accessInstructions:'Adgang 🧽\n'.repeat(10000)};
 assert.deepEqual(Departments.validateWorksiteInfo(large),[]);assert.deepEqual(Departments.normalizeWorksiteInfo({contactName:'  Receptionen  ',parking:' '}),{contactName:'Receptionen'});assert.equal(Departments.normalizeWorksiteInfo({}),null);
 for(const invalid of [{other:'x'},{contactName:'x'.repeat(121)},{contactPhone:'Line\nBreak'},{parking:[]},{accessInstructions:'x'.repeat(200001)}])assert.ok(Departments.validateWorksiteInfo(invalid).length);
 const site={...Departments.defaultOrganization().sites[0],worksiteInfo:large};assert.equal(Directory.catalog('site',site).worksiteInfo,undefined);
 const before=F.studio({organization:Departments.defaultOrganization()}),after=clone(before);before.organization.sites[0].worksiteInfo=info;after.organization.sites[0].name='Changed name';const changes=Directory.commands(before,after,{});assert.equal(Object.hasOwn(changes[0].patch,'worksiteInfo'),false);
 after.organization.sites[0].worksiteInfo=null;assert.equal(Directory.commands(before,after,{})[0].patch.worksiteInfo,null);assert.deepEqual(Directory.validateChanges([change({worksiteInfo:info})]),[]);
});

test('versioned info patches preserve GPS and budget, GPS-only writes preserve info, and stale saves fail',async t=>{
 const {db}=await setup(t),site=(await dir(db,{action:'read',kind:'site',ids:['site-nord']})).body.records[0];
 const saved=await dir(db,{action:'write',changes:[change({worksiteInfo:{...info,parking:'Ny parkering'}},site.version)]});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.records[0].version,site.version+1);
 const stale=await dir(db,{action:'write',changes:[change({worksiteInfo:{parking:'STALE'}},site.version)]});assert.equal(stale.status,409);
 const gps={enabled:false,latitude:55.5,longitude:12.5,radiusMeters:200};const updated=await dir(db,{action:'write',changes:[change({gps,workHoursBudget:{period:'week',hours:100}},saved.body.records[0].version)]});assert.equal(updated.status,200,JSON.stringify(updated));assert.equal(updated.body.records[0].value.worksiteInfo.parking,'Ny parkering');
 const changed=await dir(db,{action:'write',changes:[change({worksiteInfo:{contactName:'Vagten'}},updated.body.records[0].version)]});assert.equal(changed.status,200);assert.deepEqual(changed.body.records[0].value.gps,gps);assert.deepEqual(changed.body.records[0].value.workHoursBudget,{period:'week',hours:100});
 const catalog=await dir(db,{action:'read',kind:'site',catalog:true});assert.equal(JSON.stringify(catalog).includes('Vagten'),false);assert.equal(catalog.body.records[0].value.worksiteInfo,undefined);
});

test('department managers can edit site info while ordinary planners and employees cannot; GPS retains its stricter gate',async t=>{
 const {db}=await setup(t);await F.join(db,planner,{roleId:'planner'});await F.join(db,manager,{roleId:'planner-departments'});
 for(const actor of [worker,planner])assert.equal((await dir(db,{action:'write',changes:[change({worksiteInfo:{parking:'Forbidden'}})]},actor)).status,403);
 const saved=await dir(db,{action:'write',changes:[change({worksiteInfo:{parking:'Allowed'}})]},manager);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.capabilities.manageDepartments,true);assert.equal(saved.body.capabilities.manageSiteGps,false);
 const gps=await dir(db,{action:'write',changes:[change({gps:Departments.defaultGps()},2)]},manager);assert.equal(gps.status,403);
 assert.equal((await dir(db,{action:'read',kind:'site',ids:['site-klinik']},worker)).status,403);
});

test('own web details get current selected-site information without republishing or exposing it in calendar/foreign shifts',async t=>{
 const {db,period}=await setup(t),before=await account(db,'employeeShift',{shiftId:'own'});assert.equal(before.status,200);assert.deepEqual(before.body.site.worksiteInfo,info);
 const changed={...info,parking:'UPDATED LIVE INFORMATION'};assert.equal((await dir(db,{action:'write',changes:[change({worksiteInfo:changed,address:'New unpublished address'})]})).status,200);
 const after=await account(db,'employeeShift',{shiftId:'own'});assert.equal(after.status,200);assert.deepEqual(after.body.site.worksiteInfo,changed);assert.equal(after.body.site.address,'Nordvej 12 · 8000 Aarhus C');assert.equal(after.body.shift.note,'Shift-specific instructions');
 const list=await account(db,'employeeRead',period);assert.equal(list.status,200);for(const marker of ['UPDATED LIVE','Receptionen','FOREIGN SITE PRIVATE'])assert.equal(JSON.stringify(list.body).includes(marker),false);
 for(const shiftId of ['foreign','open']){const denied=await account(db,'employeeShift',{shiftId});assert.equal(denied.status,404);assert.equal(JSON.stringify(denied.body).includes('PRIVATE'),false);}
});

test('site-info read races reject mixed directory generations and compatibility saves cannot erase an omitted field',async t=>{
 const {db,workspaceId}=await setup(t);let raced=false;db.beforeBatch=statements=>{if(!raced&&statements.some(row=>row.sql.startsWith('SELECT id,version,config,byte_length,chunk_count FROM workspace_directory_records'))){raced=true;db.beforeBatch=null;db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1,write_token=? WHERE workspace_id=?').run('directory-race',workspaceId);}};
 const read=await account(db,'employeeShift',{shiftId:'own'});assert.equal(raced,true);assert.equal(read.status,409);assert.equal(read.body.site,undefined);
 const loaded=(await F.json(await F.route(db))).body,updated=clone(loaded.studio);delete updated.organization.sites[0].worksiteInfo;updated.workspaceSettings={...updated.workspaceSettings,companyName:'Renamed company'};
 const saved=await F.json(await F.route(db,'PUT',{revision:loaded.revision,studio:updated}));assert.equal(saved.status,200,JSON.stringify(saved));
 const current=await dir(db,{action:'read',kind:'site',ids:['site-nord']});assert.deepEqual(current.body.records[0].value.worksiteInfo,info);
});

test('mobile details expose current info only to the assigned employee and keep schedule/colleague responses compact',async t=>{
 const m=await Mobile.setup(t),owner={id:Mobile.owner,email:'owner@example.test'},saved=await dir(m.db,{action:'write',changes:[change({worksiteInfo:info})]},owner);assert.equal(saved.status,200,JSON.stringify(saved));
 const details=await m.call({action:'publishedShift',shiftId:'route-own'},m.token);assert.equal(details.status,200,JSON.stringify(details));assert.deepEqual(details.body.shift.site.worksiteInfo,info);
 const list=await m.call({action:'publishedSchedule',from:'2090-01-09',to:'2090-01-15',cursor:null},m.token);assert.equal(list.status,200);assert.equal(JSON.stringify(list.body).includes('Receptionen'),false);
 const peers=await m.call({action:'employeeColleagues',shiftId:'route-own',limit:50,cursor:null},m.token);assert.equal(peers.status,200);assert.equal(JSON.stringify(peers.body).includes('Receptionen'),false);
 const denied=await m.call({action:'publishedShift',shiftId:'route-peer'},m.token);assert.equal(denied.status,200);assert.equal(denied.body.shift,null);assert.equal(JSON.stringify(denied.body).includes('Receptionen'),false);
 const changed=await dir(m.db,{action:'write',changes:[change({worksiteInfo:{accessInstructions:'NEW LIVE GUIDE'}},2)]},owner);assert.equal(changed.status,200);
 assert.deepEqual((await m.call({action:'publishedShift',shiftId:'route-own'},m.token)).body.shift.site.worksiteInfo,{accessInstructions:'NEW LIVE GUIDE'});
});

test('current guidance is withdrawn from historical employee shifts while planner previews and current nights retain access',async t=>{
 const today=Time.localNow().date,{db}=await setup(t,{date:Time.addDays(today,-2)}),past=await account(db,'employeeShift',{shiftId:'own'});assert.equal(past.status,200);assert.equal(past.body.site.worksiteInfo,undefined);assert.equal(past.body.shift.note,'Shift-specific instructions');
 const preview=await account(db,'employeeShift',{shiftId:'own',personId:'p0'},F.owner);assert.equal(preview.status,200);assert.deepEqual(preview.body.site.worksiteInfo,info);
 const night=await setup(t,{date:Time.addDays(today,-1),start:'22:00',end:'06:00'});assert.deepEqual((await account(night.db,'employeeShift',{shiftId:'own'})).body.site.worksiteInfo,info);
 const midnight=await setup(t,{date:Time.addDays(today,-1),start:'22:00',end:'00:00'});assert.equal((await account(midnight.db,'employeeShift',{shiftId:'own'})).body.site.worksiteInfo,undefined);
});

test('mobile historical shifts retain frozen descriptions but cannot reveal updated current workplace instructions',async t=>{
 const m=await Mobile.setup(t,{day:Time.addDays(Time.localNow().date,-3)}),owner={id:Mobile.owner,email:'owner@example.test'};assert.equal((await dir(m.db,{action:'write',changes:[change({worksiteInfo:info})]},owner)).status,200);
 const details=await m.call({action:'publishedShift',shiftId:'route-own'},m.token);assert.equal(details.status,200);assert.ok(details.body.shift);assert.equal(details.body.shift.site.worksiteInfo,undefined);assert.ok(details.body.shift.checklist.length);
});

test('normal GPS/site policy reads never hydrate long guidance, while an explicit eligible detail preserves it intact',async t=>{
 const {db,workspaceId}=await setup(t),long={accessInstructions:'Long live worksite guide 🧽\n'.repeat(5000)};assert.equal((await dir(db,{action:'write',changes:[change({worksiteInfo:long})]})).status,200);
 const DAO=require('../lib/directory-store.mjs');db.queries=[];const compact=await DAO.readDirectorySite({db,workspaceId,siteIndex:0});assert.equal(compact.worksiteInfo,undefined);assert.equal(db.queries.some(row=>row.sql.includes('workspace_directory_chunks')),false);assert.equal(JSON.stringify(db.queries).includes('Long live worksite guide'),false);
 const detail=await DAO.readDirectorySite({db,workspaceId,siteIndex:0,includeWorksiteInfo:true});assert.deepEqual(detail.worksiteInfo,long);
});

test('own active late-night attendance keeps current guidance after its calendar days and recovery summaries stay compact',async t=>{
 const day=Time.addDays(Time.localNow().date,-2),m=await Mobile.setup(t,{day,start:'22:00',end:'21:00'}),owner={id:Mobile.owner,email:'owner@example.test'};assert.equal((await dir(m.db,{action:'write',changes:[change({worksiteInfo:info})]},owner)).status,200);
 const created=await m.web('timeWrite',{operation:'correct',shiftId:'route-own',personId:'person-route-own',version:0,start:'22:00',end:'21:00',endDate:Time.addDays(day,1),breakMinutes:0,reason:'Confirmed previous night'}),entry={...created.entry,status:'running',start:'20:00',end:null,clockStartAt:new Date(Time.instantForLocal(Time.addDays(day,1),'20:00')).toISOString()};delete entry.clockEndAt;delete entry.resolvedStartAt;delete entry.resolvedEndAt;delete entry.timingResolved;
 m.sqlite.prepare('UPDATE workspace_time_entries SET status=?,config=?,interval_end=NULL WHERE workspace_id=? AND id=?').run(entry.status,JSON.stringify(entry),m.workspaceId,entry.id);
 const webEmployee={id:'worksite-active-employee',email:'active-web@example.test'};await F.join(m.db,webEmployee,{roleId:'employee',personId:'person-route-own'},owner);
 assert.deepEqual((await account(m.db,'employeeShift',{shiftId:'route-own'},webEmployee)).body.site.worksiteInfo,info);
 assert.deepEqual((await m.call({action:'publishedShift',shiftId:'route-own'},m.token)).body.shift.site.worksiteInfo,info);
 m.sqlite.prepare("UPDATE workspace_published_shifts SET deleted=1,version=version+1 WHERE workspace_id=? AND id='route-own'").run(m.workspaceId);
 const recovery=await m.call({action:'publishedShift',shiftId:'route-own'},m.token);assert.equal(recovery.status,200,JSON.stringify(recovery));assert.deepEqual(recovery.body.shift.site.worksiteInfo,info);
 const summary=await m.call({action:'employeeActiveTime'},m.token);assert.equal(summary.status,200,JSON.stringify(summary));assert.equal(JSON.stringify(summary.body).includes('Receptionen'),false);
});
