const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),Store=require('../lib/studio-store.mjs'),Planning=require('../src/planning-records.js'),Window=require('../src/planning-window.js'),Scope=require('../src/planning-scope.js'),Data=require('../src/studio-data.js'),Publication=require('../src/publication-model.js'),Departments=require('../src/department-model.js');
const clone=value=>JSON.parse(JSON.stringify(value)),calendar={from:'2026-11-02',to:'2026-11-08'};
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,queries:[],prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);db.queries.push(...statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const query=sqlite.prepare(sql);return query.columns().length?{success:true,results:query.all(...values),meta:{changes:0}}:{success:true,results:[],meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
const shift=(id,date,patch={})=>({id,person:'p0',site:0,date,start:'07:00',end:'15:00',note:'',...patch});
const series=(id,from,to,patch={})=>({id,person:'p0',site:0,startDate:from,endDate:to,weekdays:[0,1,2,3,4],start:'07:00',end:'15:00',note:'',...patch});
const base=(patch={})=>({storageVersion:1,demoSeed:false,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[],...patch});
async function setup(studio=base()){const db=database(),owner='selection-owner',workspaceId='ws-selection';await Store.writeStudio(db,owner,0,studio);db.sqlite.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId,owner,owner,'2026-11-02T12:00:00.000Z');return {db,owner,workspaceId};}
async function collect(db,owner,projection){const collector=Window.collector(projection),pages=[];let cursor=null;do{const page=await Store.readStudioSelection(db,owner,{...projection,...(cursor?{cursor}:{})});pages.push(page);cursor=collector.add(page);}while(cursor);return {result:collector.finish(),pages};}

test('scope normalization is canonical and idempotent across a union longer than one series',()=>{
 const input={mode:'series',seriesId:'phase',ranges:[{from:'2026-01-01',to:'2026-12-31'},{from:'2026-12-01',to:'2027-11-30'}],calendar},normalized=Scope.normalize(input);assert.deepEqual(Scope.normalize(normalized),normalized);assert.ok(normalized.ranges.every(range=>(Date.parse(range.to)-Date.parse(range.from))/86400000<366));assert.throws(()=>Scope.normalize({...input,ranges:[{from:'2026-01-01',to:'2027-01-02'}]}));assert.throws(()=>Scope.normalize({mode:'publication',...calendar,siteIds:[0],includeDependencies:true,calendar,unexpected:true}));
});

test('complete group authority includes every phase, moved exception, suppression and tombstone while neighbors stay compact',async()=>{
 const initial=base({series:[series('phase-old','2025-01-01','2025-01-31',{groupId:'agreement'}),series('phase-reverted','2024-01-01','2024-01-31',{groupId:'agreement'}),series('phase-next','2027-01-01','2027-03-31',{groupId:'agreement'}),series('neighbor','2027-01-01','2027-03-31',{person:'p1',note:'PRIVATE-NEIGHBOR-'+('🧽'.repeat(200000))})],edits:{'phase-old@2025-01-06':shift('phase-old@2025-01-06','2029-04-02',{seriesId:'phase-old',note:'Own moved instructions'}),'phase-old@2025-01-07':shift('phase-old@2025-01-07','2025-01-07',{seriesId:'phase-old'}),calendar:shift('calendar','2026-11-03')},deleted:['phase-old@2025-01-08']});
 const {db,owner}=await setup(initial),full=await Store.readStudio(db,owner),next=clone(full.studio);delete next.edits['phase-old@2025-01-07'];next.series=next.series.filter(item=>item.id!=='phase-reverted');await Store.writeStudio(db,owner,full.revision,next);const current=await Store.readStudio(db,owner),projection={mode:'series',seriesId:'phase-next',ranges:[{from:'2027-01-01',to:'2027-03-31'}],calendar};await collect(db,owner,projection);
 db.beforeBatch=async statements=>{for(const query of statements)if(query.sql.includes('FROM workspace_plan_record_chunks'))assert.notEqual(query.values[2],'neighbor','An availability neighbor must never fetch its long instructions.');};
 const {result,pages}=await collect(db,owner,projection);assert.deepEqual(result.selection.groupIds,['agreement']);assert.ok(result.studio.series.some(item=>item.id==='phase-old'));assert.ok(result.studio.series.some(item=>item.id==='phase-next'));assert.equal(result.studio.series.some(item=>item.id==='neighbor'),false);assert.equal(result.studio.edits['phase-old@2025-01-06'].date,'2029-04-02');assert.ok(result.studio.deleted.includes('phase-old@2025-01-08'));assert.equal(result.planning.versions[Planning.key('shift','phase-old@2025-01-07')],2);assert.equal(result.planning.versions[Planning.key('series','phase-reverted')],2);assert.equal(db.sqlite.prepare('SELECT group_id FROM workspace_plan_records WHERE id=?').get('phase-reverted').group_id,'agreement');assert.equal(Planning.groupSignature(result.studio,result.planning.versions,'agreement'),Planning.groupSignature(current.studio,current.planning.versions,'agreement'));assert.ok(result.availability.series.some(item=>item.id==='neighbor'));assert.ok(!JSON.stringify(result.availability).includes('PRIVATE-NEIGHBOR'));assert.ok(result.selection.ranges.some(range=>range.from<='2029-04-02'&&range.to>='2029-04-02'));assert.deepEqual(Data.shiftsInRange(calendar.from,calendar.to,result.studio),Data.shiftsInRange(calendar.from,calendar.to,current.studio));assert.ok(pages.slice(1).every(page=>page.studio===undefined&&page.selection===undefined));db.sqlite.close();
});

test('catalog pages preserve all agreement summaries and description indicators without note authority',async()=>{
 const {db,owner}=await setup(base({series:Array.from({length:620},(_,index)=>series('series-'+String(index).padStart(4,'0'),'2027-01-01','2027-12-31',{person:'p'+index,note:index===0?'Instructions':''})),deleted:['series-0000@2027-01-04']}));const {result,pages}=await collect(db,owner,{mode:'series-list',calendar});assert.equal(result.catalog.series.length,620);assert.equal(result.catalog.series[0].hasDescription,true);assert.equal(result.catalog.series[0].note,undefined);assert.ok(result.catalog.deleted.includes('series-0000@2027-01-04'));assert.equal(result.studio.series.length,0);assert.equal(Object.keys(result.planning.versions).length,0);assert.ok(pages.every(page=>page.records.length+page.auxRows.length+page.publicationRows.length<=500));db.sqlite.close();
});

test('500 employees across one year return 500 recurrence templates rather than expanded daily occurrences',async()=>{
 const {db,owner}=await setup(base({series:Array.from({length:500},(_,index)=>series('person-'+index,'2027-01-01','2027-12-31',{person:'person-'+index,note:'Not needed for availability'}))}));const {result,pages}=await collect(db,owner,{mode:'series',ranges:[{from:'2027-01-01',to:'2027-12-31'}],calendar});assert.equal(result.availability.series.length,500);assert.equal(result.studio.series.length,0);assert.equal(pages.flatMap(page=>page.auxRows).filter(row=>row.kind==='availability').length,500);assert.ok(!JSON.stringify(result.availability).includes('Not needed'));db.sqlite.close();
});

test('rolling writer summaries are repaired and absence-only changes invalidate selection continuations',async()=>{
 const {db,owner,workspaceId}=await setup(base({series:[series('phase','2027-01-01','2027-01-31')]}));await Store.readStudio(db,owner);db.sqlite.prepare('UPDATE workspace_plan_records SET version=version+1').run();assert.equal(db.sqlite.prepare('SELECT schedule_version FROM workspace_plan_records').get().schedule_version,0);const projection={mode:'series',seriesId:'phase',ranges:[{from:'2027-01-01',to:'2027-01-31'}],calendar},first=await Store.readStudioSelection(db,owner,projection);assert.ok(first.nextCursor);assert.equal(db.sqlite.prepare('SELECT schedule_version FROM workspace_plan_records').get().schedule_version,2);db.sqlite.prepare('INSERT INTO workspace_absence_imports VALUES (?,?,?)').run(workspaceId,1,'2026-11-02T12:00:00.000Z');await assert.rejects(()=>Store.readStudioSelection(db,owner,{...projection,cursor:first.nextCursor}),error=>error.status===409);db.sqlite.close();
});

test('publication selection follows moved-id closure and retains sparse exact-commit acknowledgment projections',async()=>{
 let studio=base({series:[series('unrelated-site-series','2027-02-01','2027-02-07',{site:2,note:'Do not fetch unrelated site instructions'})],edits:{moved:shift('moved','2026-11-03'),untouched:shift('untouched','2028-01-04',{note:'Unloaded instructions'}),otherSite:shift('otherSite','2027-02-03',{site:2,note:'Do not fetch unrelated shift instructions'})}});studio=Publication.publish(studio,{...calendar,siteIds:[0],actor:{userId:'planner',name:'Planner'},at:'2026-11-01T12:00:00.000Z'}).studio;studio.edits.moved.date='2027-02-02';studio.edits.moved.site=1;
 const {db,owner}=await setup(studio),projection={mode:'publication',...calendar,siteIds:[0],includeDependencies:false,calendar},full=await Store.readStudio(db,owner),{result}=await collect(db,owner,projection);assert.ok(result.selection.scopeKeys.includes('2027-02-01|1'));assert.ok(result.selection.dependencies.some(scope=>scope.from==='2027-02-01'));assert.equal(result.studio.edits.moved.date,'2027-02-02');assert.equal(result.studio.edits.untouched,undefined);assert.deepEqual(Publication.expandScope(result.studio,projection),Publication.expandScope(full.studio,projection));const ack=Store.projectStudioSelection(full.studio,full.planning,projection,[]);assert.equal(ack.studio.edits.untouched,undefined);assert.equal(ack.studio.absences,undefined);assert.ok(ack.availability.edits.moved);assert.deepEqual(ack.selection.scopeKeys,result.selection.scopeKeys);assert.deepEqual(Planning.flatten(ack.studio),Planning.flatten(result.studio));assert.ok(!JSON.stringify(ack.studio).includes('Do not fetch unrelated'));assert.equal(ack.studio.edits.otherSite,undefined);assert.ok(result.availability.edits.otherSite,'Cross-site conflict context stays available as a note-free summary.');db.sqlite.close();
});

test('warm selection reads reuse metadata even when repairing only derived schedule summaries',async()=>{
 const {db,owner}=await setup(base({series:[series('source',calendar.from,calendar.to)]})),projection={mode:'series-list',calendar};await collect(db,owner,projection);const before=(await Store.readRawStudio(db,owner)).source.token;
 db.sqlite.prepare('UPDATE workspace_plan_records SET schedule_version=0').run();db.queries=[];const page=await Store.readStudioSelection(db,owner,projection);assert.equal(page.revision,1);
 assert.equal(db.queries.filter(query=>query.sql.includes('FROM studio_state_chunks')).length,1,'Derived-summary repairs must not reload the unchanged request-local metadata.');
 assert.ok(db.queries.some(query=>query.sql.startsWith('UPDATE workspace_plan_records SET schedule_config=')));assert.equal(db.sqlite.prepare('SELECT schedule_version FROM workspace_plan_records').get().schedule_version,1);assert.equal((await Store.readRawStudio(db,owner)).source.token,before);db.sqlite.close();
});

test('selection initialization rereads after actual directory/window migrations and preserves the resulting generation',async()=>{
 const {db,owner}=await setup(base({series:[series('source',calendar.from,calendar.to)],workspaceSettings:{companyName:'Retained metadata'}})),before=await Store.readRawStudio(db,owner),projection={mode:'series',seriesId:'source',ranges:[calendar],calendar};
 const {result,pages}=await collect(db,owner,projection),after=await Store.readRawStudio(db,owner);assert.notEqual(after.source.token,before.source.token);assert.equal(after.studio.directorySchema,1);assert.equal(after.studio.organization,undefined);assert.equal(after.studio.series.length,0);
 assert.equal(result.studio.series.find(item=>item.id==='source').start,'07:00');assert.equal(result.studio.workspaceSettings.companyName,'Retained metadata');assert.ok(pages.every(page=>page.revision===1));db.sqlite.close();
});

test('selection metadata reuse still retries a source change racing the schedule-summary initialization',async()=>{
 const {db,owner}=await setup(base({series:[series('source',calendar.from,calendar.to)]})),projection={mode:'series',seriesId:'source',ranges:[calendar],calendar};await collect(db,owner,projection);let changed=false;
 db.beforeBatch=async statements=>{if(changed||!statements.some(query=>query.sql.includes('schedule_version=0 ORDER BY')))return;changed=true;db.beforeBatch=null;const current=await Store.readStudio(db,owner);current.studio.series[0].start='08:00';assert.equal((await Store.writeStudio(db,owner,current.revision,current.studio)).ok,true);};
 const {result,pages}=await collect(db,owner,projection);assert.equal(changed,true);assert.equal(result.revision,2);assert.equal(result.studio.series.find(item=>item.id==='source').start,'08:00');assert.ok(pages.every(page=>page.revision===2));db.sqlite.close();
});

async function collectDeferred(db,owner,projection){
 const collector=Window.collector(projection),pages=[],cursors=new Set();let cursor=null;
 do{const page=await Store.readStudioSelection(db,owner,{...projection,instructions:'deferred',...(cursor?{cursor}:{})});pages.push(page);const count=page.records.length+page.publicationRows.length+page.auxRows.length,bytes=Buffer.byteLength(JSON.stringify({records:page.records,publicationRows:page.publicationRows,auxRows:page.auxRows}));assert.ok(count<=500);assert.ok(bytes<=1024*1024||count===1,'Only an existing single long record may exceed the shared byte budget.');cursor=collector.add(page);if(cursor){assert.equal(cursors.has(cursor),false);cursors.add(cursor);}assert.ok(pages.length<100);}while(cursor);
 return {pages,result:collector.finish()};
}

function editorPublications(shifts){
 return {version:1,sequence:1,records:[],slots:{[calendar.from+'|0']:{...calendar,site:0,location:{...Departments.defaultOrganization().sites[0],index:0},publicationId:'editor-publication',at:'2026-11-01T12:00:00.000Z',actor:{userId:'planner',name:'Planner'},shifts}}};
}

test('deferred publication review shares a response while retaining draft changes and conflict context',async()=>{
 const scope={mode:'publication',...calendar,siteIds:[0],includeDependencies:false,calendar};
 const own=series('published-series',calendar.from,calendar.to,{note:'Instruktioner til vagten'});
 const neighbor=shift('neighbor','2026-11-03',{site:1,person:'p1'});
 const actor={userId:'planner',name:'Planner'},at='2026-11-01T12:00:00.000Z';
 const studio=Publication.publish(base({series:[own],edits:{neighbor}}),{...scope,siteIds:[0,1],actor,at}).studio;
 studio.series[0].start='08:00';
 const {db,owner,workspaceId}=await setup(studio);
 await collect(db,owner,scope);
 db.sqlite.prepare('INSERT INTO workspace_absence_imports VALUES (?,0,?)').run(workspaceId,at);
 const absence={id:'approved',p:'p1',days:['2026-11-03'],type:'Ferie',status:'approved'};
 db.sqlite.prepare('INSERT INTO workspace_absences VALUES (?,?,?,?,?,?,?,1,?,?,?)').run(workspaceId,absence.id,absence.p,absence.days[0],absence.days[0],absence.type,absence.status,JSON.stringify(absence),'fixture',at);
 const legacy=await collect(db,owner,scope),deferred=await collectDeferred(db,owner,scope);
 assert.ok(legacy.pages.length>1);
 assert.equal(deferred.pages.length,1);
 const status=Publication.scopeStatus(deferred.result.studio,scope);
 assert.equal(status.changed,5);
 assert.deepEqual(status,Publication.scopeStatus(legacy.result.studio,scope));
 assert.deepEqual(deferred.result.selection,legacy.result.selection);
 assert.deepEqual(deferred.result.availability,legacy.result.availability);
 assert.deepEqual(deferred.result.studio.absences,legacy.result.studio.absences);
 assert.deepEqual(deferred.result.studio.absences.map(item=>item.id),['approved']);
 assert.equal(deferred.result.availability.published.some(item=>item.id===neighbor.id),true);
 db.sqlite.close();
});

test('the deferred editor coalesces complete phases while promoting own instructions and retaining all conflict context',async()=>{
 const rich=JSON.stringify({type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Lock building'}]}]}]}]}),own=series('own',calendar.from,'2027-01-31',{plannedBreakMinutes:30,note:'Complete own instructions',noteRich:rich}),neighbor=series('neighbor',calendar.from,'2027-01-31',{person:'p1',note:'PRIVATE_NEIGHBOR '+('N'.repeat(300000))}),published=[shift('pub-own','2026-11-03'),shift('pub-peer','2026-11-04',{person:'p1'})],{db,owner,workspaceId}=await setup(base({series:[own,neighbor],edits:{'own@2026-11-04':shift('own@2026-11-04','2026-11-05',{seriesId:'own',note:'Own exception'})},deleted:['own@2026-11-06'],publications:editorPublications(published)})),projection={mode:'series',seriesId:'own',ranges:[{from:own.startDate,to:own.endDate}],calendar};
 await collectDeferred(db,owner,projection);db.sqlite.prepare('INSERT INTO workspace_absence_imports VALUES (?,0,?)').run(workspaceId,'2026-11-02T12:00:00.000Z');const absence=db.sqlite.prepare('INSERT INTO workspace_absences VALUES (?,?,?,?,?,?,?,1,?,?,?)');for(const item of [{id:'approved',p:'p1',days:['2026-11-04'],type:'Ferie',status:'approved'},{id:'pending',p:'p0',days:['2027-01-11'],type:'Friønske',status:'pending'}])absence.run(workspaceId,item.id,item.p,item.days[0],item.days[0],item.type,item.status,JSON.stringify(item),'fixture','2026-11-02T12:00:00.000Z');
 db.beforeBatch=statements=>{for(const query of statements)if(query.sql.includes('FROM workspace_plan_record_chunks'))assert.equal(query.values.includes('neighbor'),false);};
 const {pages,result}=await collectDeferred(db,owner,projection);assert.equal(pages.length,1);const selected=result.studio.series.find(item=>item.id==='own');assert.equal(selected.note,own.note);assert.equal(selected.noteRich,rich);assert.equal(selected.plannedBreakMinutes,30);assert.equal(result.studio.edits['own@2026-11-04'].note,'Own exception');assert.ok(result.studio.deleted.includes('own@2026-11-06'));assert.ok(!result.planning.deferred.includes(Planning.key('series','own')));assert.ok(result.planning.deferred.includes(Planning.key('series','neighbor')));
 assert.ok(result.availability.series.some(item=>item.id==='neighbor'));assert.equal(result.availability.published.length,2);assert.equal(Publication.publishedShifts(result.studio).length,2);assert.deepEqual(result.studio.absences.map(item=>item.id).sort(),['approved','pending']);assert.equal(JSON.stringify(result.availability).includes('PRIVATE_NEIGHBOR'),false);db.beforeBatch=null;
 const full=await Store.readStudio(db,owner);assert.equal(Planning.groupSignature(result.studio,result.planning.versions,'own'),Planning.groupSignature(full.studio,full.planning.versions,'own'));db.sqlite.close();
});

test('shared 500-row editor pages cross phase boundaries without losing published availability or events',async()=>{
 const published=Array.from({length:700},(_,index)=>shift('published-'+String(index).padStart(4,'0'),'2026-11-03')),own=series('own',calendar.from,'2027-01-31'),{db,owner}=await setup(base({series:[own],publications:editorPublications(published)})),projection={mode:'series',seriesId:'own',ranges:[{from:own.startDate,to:own.endDate}],calendar}, {pages,result}=await collectDeferred(db,owner,projection);
 assert.ok(pages.length>=3);assert.ok(pages.some(page=>page.records.length&&page.auxRows.length));assert.ok(pages.some(page=>page.publicationRows.length&&page.auxRows.length));assert.equal(result.availability.published.length,700);assert.equal(new Set(result.availability.published.map(item=>item.id)).size,700);assert.equal(Publication.publishedShifts(result.studio).length,700);assert.equal(result.planning.versions[Planning.key('series','own')],1);db.sqlite.close();
});

test('combined own phases retain all long descriptions under one shared decoded-source budget',async()=>{
 const phases=[series('phase-a','2025-01-01','2025-03-31',{groupId:'agreement',note:'A'.repeat(600000)}),series('phase-b','2025-04-01','2025-06-30',{groupId:'agreement',note:'B'.repeat(600000)}),series('phase-c','2025-07-01','2025-09-30',{groupId:'agreement',note:'C'.repeat(600000)})],{db,owner}=await setup(base({series:phases,edits:{visible:shift('visible','2026-11-03')}})),projection={mode:'series',seriesId:'phase-a',ranges:[{from:'2025-01-01',to:'2025-09-30'}],calendar},{pages,result}=await collectDeferred(db,owner,projection);
 for(const page of pages){const full=page.records.filter(row=>row.kind==='series'&&row.value?.note);assert.ok(full.reduce((sum,row)=>sum+Buffer.byteLength(row.value.note),0)<=1024*1024);}
 assert.equal(result.studio.series.length,3);for(const phase of phases)assert.equal(result.studio.series.find(item=>item.id===phase.id).note,phase.note);assert.ok(pages.length>=3);db.sqlite.close();
});

test('a corrupt selected instruction fails the entire coalesced response after a valid calendar phase',async()=>{
 const own=series('own',calendar.from,'2027-01-31',{note:'Required own instructions'}),{db,owner}=await setup(base({series:[own],edits:{visible:shift('visible','2026-11-03')}})),projection={mode:'series',seriesId:'own',ranges:[{from:own.startDate,to:own.endDate}],calendar};await collectDeferred(db,owner,projection);
 db.sqlite.prepare("UPDATE workspace_plan_records SET config=json_set(config,'$.sha256',?) WHERE kind='series' AND id='own'").run('0'.repeat(64));
 await assert.rejects(()=>Store.readStudioSelection(db,owner,{...projection,instructions:'deferred'}),error=>error.status===500&&error.code==='invalid_planning_records');db.sqlite.close();
});
