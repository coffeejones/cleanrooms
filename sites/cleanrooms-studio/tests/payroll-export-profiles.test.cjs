const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const Model=require('../src/payroll-export-profile-model.js'),Store=require('../lib/studio-store.mjs'),Workspace=require('../lib/workspace-store.mjs'),Departments=require('../src/department-model.js');
const owner={id:'profile-owner',email:'owner@example.test'},other={id:'profile-other',email:'other@example.test'};
const person=(id,name,active=true)=>({id,name,initials:name.slice(0,2),target:30,site:0,role:'Service',active});
const people=[person('person-anna','Anna Hansen'),person('person-bob','Bob Jensen',false)];
const sample=(patch={})=>({employeeId:'person-anna',name:'Anna Hansen',date:'2026-10-15',sourceEntryId:'entry-a',lineKind:'base',label:'Timeløn',workedMinutes:0,minutes:55,quantity:55/60,calculation:'hourly',rateCents:18000,amountCents:16500,currency:'DKK',from:'2026-10-15',to:'2026-10-15',days:0,monthDays:0,periodFrom:'2026-10-01',periodTo:'2026-10-31',revision:1,...patch});
const config=(patch={})=>({...Model.defaults(),employeeNumbers:{'person-anna':'001','person-bob':'002'},wageCodes:[{kind:'base',label:'',code:'100'},{kind:'supplement',label:'',code:'200'}],...patch});
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(__dirname,'../drizzle')).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));const db={sqlite,beforeBatch:null,prepare:sql=>({bind:(...values)=>({sql,values})})};db.batch=async statements=>{await db.beforeBatch?.(statements);sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{const prepared=sqlite.prepare(sql);return prepared.columns().length?{results:prepared.all(...values),meta:{changes:0}}:{results:[],meta:{changes:Number(prepared.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}};return db;}
function request(action,payload={},principal=owner){return new Request('https://studio.test/api/accounts',{method:'POST',headers:{origin:'https://studio.test','content-type':'application/json','oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email},body:JSON.stringify({action,...payload})});}
async function api(db,action,payload={},principal=owner){const response=await Workspace.handleAccountsRequest(request(action,payload,principal),db);return{status:response.status,body:await response.json()};}
async function setup(db=database(),principal=owner,staff=people){await Store.writeStudio(db,principal.id,0,{storageVersion:1,demoSeed:false,roster:staff,organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{}});const response=await Workspace.handleWorkspaceStudioRequest(new Request('https://studio.test/api/studio',{headers:{'oai-authenticated-user-id':principal.id,'oai-authenticated-user-email':principal.email}}),db);assert.equal(response.status,200,await response.clone().text());const state=await response.json();return{db,workspaceId:state.workspace.id};}
async function saved(db,value=config(),version=0,profileId){const result=await api(db,'payrollExportProfileSave',{version,profile:value,...(profileId?{profileId}:{})});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.profile;}
function seedClosed(db,workspaceId,rows=[sample(),sample({lineKind:'attendance',label:'Arbejdstid',workedMinutes:55,minutes:0,rateCents:0,amountCents:0}),sample({employeeId:'person-bob',name:'Bob Jensen',sourceEntryId:'entry-b',lineKind:'supplement',label:'Aftentillæg',minutes:30,rateCents:1000,amountCents:500})]){const from='2026-10-01',to='2026-10-31',at='2026-11-01T12:00:00Z';db.sqlite.prepare("INSERT INTO workspace_payroll_periods VALUES (?,?,?,'closed',1,1,'fixture',?)").run(workspaceId,from,to,at);db.sqlite.prepare('INSERT INTO workspace_payroll_closures VALUES (?,?,?,1,?,?,?)').run(workspaceId,from,to,JSON.stringify({rowCount:rows.length,totals:{},closedBy:{name:'Fixture'}}),'fixture',at);rows.forEach((row,index)=>db.sqlite.prepare('INSERT INTO workspace_payroll_export_rows VALUES (?,?,?,1,?,?)').run(workspaceId,from,to,String(index).padStart(10,'0'),JSON.stringify(row)));return{from,to,revision:1};}

test('custom CSV renders exact decimal quantities, DKK units and explicit source fields in selected order',()=>{
  const profile=config({columns:[{field:'employeeNumber',header:'Ansat'},{field:'hours',header:'Timer'},{field:'rateDKK',header:'Sats'},{field:'amountDKK',header:'Beløb'},{field:'constant',header:'Afdeling',value:'Kontor'}]});
  assert.equal(Model.serialize([sample()],profile),'\uFEFF"Ansat";"Timer";"Sats";"Beløb";"Afdeling"\r\n"001";"0,9167";"180,00";"165,00";"Kontor"\r\n');
  const maximum=Model.decimalInteger(Number.MAX_SAFE_INTEGER,100,2,',');assert.equal(maximum,'90071992547409,91');
  assert.equal(Model.decimalInteger(-16501,100,2,'.'),'-165.01');
  assert.equal(Model.serialize([sample()],{...profile,delimiter:',',decimal:'.',header:false,hoursDecimals:2}),'"001","0.92","180.00","165.00","Kontor"\r\n');
});

test('wage-code exact label rules override type defaults and attendance rows are excluded by default',()=>{
  const profile=config({wageCodes:[{kind:'base',label:'',code:'100'},{kind:'base',label:'Timeløn',code:'101'}],columns:[{field:'wageCode',header:'Kode'}]});
  assert.equal(Model.serialize([sample(),sample({label:'Anden grundløn'}),sample({lineKind:'attendance'})],profile),'\uFEFF"Kode"\r\n"101"\r\n"100"\r\n');
  assert.throws(()=>Model.serialize([sample({lineKind:'supplement',label:'Nat'})],profile),/Udfyld lønart for Nat/);
  assert.throws(()=>Model.serialize([sample({employeeId:'person-missing',name:'Mangler'})],config()),/Udfyld lønnummer for Mangler/);
});

test('CSV protects formulas and delimiters without interpreting field names or constants as executable expressions',()=>{
  const profile=config({columns:[{field:'name',header:'=overskrift'},{field:'constant',header:'Tekst',value:' +SUM(1;2)'},{field:'amountDKK',header:'Beløb'}]});
  const result=Model.serialize([sample({name:'\u0000=HYPERLINK("https://untrusted.test")',amountCents:-123})],profile);
  assert.match(result,/"'=overskrift"/);assert.match(result,/"'=HYPERLINK\(""https:\/\/untrusted.test""\)"/);assert.match(result,/"' \+SUM\(1;2\)"/);assert.match(result,/"-1,23"/);
  for(const field of ['__proto__','constructor','name.toUpperCase()','=eval()'])assert.throws(()=>Model.normalize(config({columns:[{field,header:'Unsafe'}]})),/kolonner/);
  assert.throws(()=>Model.normalize(config({columns:[{field:'constant',header:'X',value:'a\nb'}]})),/kolonner/);
});

test('profile bounds reject duplicate payroll numbers, duplicate wage rules and unbounded or malformed schemas',()=>{
  for(const employeeNumbers of [{'person-anna':'001','person-bob':'001'},{'person-anna':' 001 ','person-bob':'001'}])assert.throws(()=>Model.normalize(config({employeeNumbers})),/flere medarbejdere/);
  assert.deepEqual(Object.values(Model.normalize(config({employeeNumbers:{'person-anna':'001','person-bob':'1'}})).employeeNumbers),['001','1'],'Leading zeroes are identifiers, not guessed numbers.');
  for(const patch of [{expression:'anything'},{delimiter:'|'},{decimal:';'},{hoursDecimals:3},{rowKinds:[]},{rowKinds:['base','base']},{columns:Array(33).fill({field:'name',header:'Name'})},{wageCodes:[{kind:'base',label:'',code:'100'},{kind:'base',label:' ',code:'200'}]}])assert.throws(()=>Model.normalize(config(patch)));
});

test('Antal uses the approved quantity for mixed wage types, with decimal rounding independent of money',()=>{
  const profile=config({columns:[{field:'quantity',header:'Antal'},{field:'calculation',header:'Type'},{field:'amountDKK',header:'Beløb'}]});
  const result=Model.serialize([sample({quantity:1,calculation:'fixed',amountCents:5000}),sample({quantity:17/31,calculation:'monthly',lineKind:'monthly_base',amountCents:1645161})],profile);
  assert.match(result,/"1,0000";"fixed";"50,00"/);assert.match(result,/"0,5484";"monthly";"16451,61"/);
  assert.equal(Model.decimalQuantity(0.61505,4,'.'),'0.6151');assert.equal(Model.decimalQuantity(1e-7,4,','),'0,0000');assert.equal(Model.decimalQuantity(Number.MAX_SAFE_INTEGER,4,'.'),'9007199254740991.0000');
  assert.throws(()=>Model.serialize([sample({quantity:undefined})],profile),/godkendt antal/);
});

test('retrying the same new-profile creation command returns its existing revision without creating a duplicate',async()=>{
  const {db}=await setup(),payload={version:0,creationId:'12345678-1234-4567-89ab-123456789012',profile:config()},first=await api(db,'payrollExportProfileSave',payload),retry=await api(db,'payrollExportProfileSave',payload);
  assert.equal(first.status,200);assert.equal(retry.status,200);assert.equal(first.body.profile.id,retry.body.profile.id);assert.equal(retry.body.profile.version,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_payroll_export_profiles').get().n,1);
  assert.equal((await api(db,'payrollExportProfileSave',{...payload,profile:config({name:'Andet format'})})).status,409);db.sqlite.close();
});

test('concurrent copies of a new-profile command receive one authoritative profile and one immutable revision',async()=>{
  const {db}=await setup(),payload={version:0,creationId:'22345678-1234-4567-89ab-123456789012',profile:config()};
  const results=await Promise.all([api(db,'payrollExportProfileSave',payload),api(db,'payrollExportProfileSave',payload)]);assert.ok(results.every(item=>item.status===200),JSON.stringify(results));assert.equal(results[0].body.profile.id,results[1].body.profile.id);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_payroll_export_profile_revisions').get().n,1);db.sqlite.close();
});

test('actual account API stores versioned private profiles and frozen exports pin the selected mapping revision across pages',async()=>{
  const {db,workspaceId}=await setup(),period=seedClosed(db,workspaceId),first=await saved(db),head=await api(db,'payrollExportProfilesRead');assert.equal(head.status,200);assert.equal(head.body.profiles[0].id,'standard-v1');assert.equal(head.body.profiles[1].id,first.id);
  const page=await api(db,'payrollPeriodExport',{...period,profileId:first.id,limit:1});assert.equal(page.status,200,JSON.stringify(page.body));assert.equal(page.body.profileVersion,1);assert.match(page.body.text,/"001";"100"/);assert.ok(page.body.nextCursor);
  const changed=await saved(db,config({employeeNumbers:{'person-anna':'901','person-bob':'902'},wageCodes:[{kind:'base',label:'',code:'900'},{kind:'supplement',label:'',code:'920'}]}),1,first.id);assert.equal(changed.version,2);
  const old=await api(db,'payrollPeriodExport',{...period,profileId:first.id,profileVersion:1,cursor:page.body.nextCursor,limit:500});assert.equal(old.status,200,JSON.stringify(old.body));assert.equal(old.body.profileVersion,1);assert.match(old.body.text,/"002";"200"/);assert.doesNotMatch(old.body.text,/902|920/);
  const current=await api(db,'payrollPeriodExport',{...period,profileId:first.id});assert.equal(current.status,200);assert.equal(current.body.profileVersion,2);assert.match(current.body.text,/"901";"900"/);
  const stale=await api(db,'payrollExportProfileSave',{profileId:first.id,version:1,profile:config()});assert.equal(stale.status,409);
  assert.throws(()=>db.sqlite.prepare("UPDATE workspace_payroll_export_profile_revisions SET config='{}' WHERE workspace_id=?").run(workspaceId),/immutable/);
  assert.throws(()=>db.sqlite.prepare("INSERT OR REPLACE INTO workspace_payroll_export_profile_revisions SELECT workspace_id,profile_id,version,'{}',created_at,created_by FROM workspace_payroll_export_profile_revisions WHERE workspace_id=? AND version=1").run(workspaceId),/immutable/);
  assert.equal(JSON.parse(db.sqlite.prepare('SELECT config FROM workspace_payroll_export_profile_revisions WHERE workspace_id=? AND profile_id=? AND version=1').get(workspaceId,first.id).config).employeeNumbers['person-anna'],'001');db.sqlite.close();
});

test('archiving removes a selectable profile while preserving its historical export version',async()=>{
  const {db,workspaceId}=await setup(),period=seedClosed(db,workspaceId),profile=await saved(db),archived=await api(db,'payrollExportProfileArchive',{profileId:profile.id,version:1});assert.equal(archived.status,200);assert.equal(archived.body.profile.archived,true);
  assert.equal((await api(db,'payrollExportProfilesRead')).body.profiles.length,1);
  assert.equal((await api(db,'payrollPeriodExport',{...period,profileId:profile.id})).status,409);
  const historic=await api(db,'payrollPeriodExport',{...period,profileId:profile.id,profileVersion:1});assert.equal(historic.status,200);assert.match(historic.body.text,/"001";"100"/);db.sqlite.close();
});

test('required mappings block an export and foreign or duplicate employee numbers cannot be saved',async()=>{
  const {db,workspaceId}=await setup(),period=seedClosed(db,workspaceId),profile=await saved(db,config({employeeNumbers:{}}));
  const missing=await api(db,'payrollPeriodExport',{...period,profileId:profile.id});assert.equal(missing.status,422,JSON.stringify(missing.body));assert.match(missing.body.message,/lønnummer/);
  const foreign=await api(db,'payrollExportProfileSave',{version:0,profile:config({employeeNumbers:{'person-foreign':'333'}})});assert.equal(foreign.status,400);
  const duplicate=await api(db,'payrollExportProfileSave',{version:0,profile:config({employeeNumbers:{'person-anna':'001','person-bob':'001'}})});assert.equal(duplicate.status,400);assert.match(duplicate.body.message,/flere medarbejdere/);db.sqlite.close();
});

test('profiles and employee cursors are workspace scoped, and payroll.view is required independently from manage',async()=>{
  const {db}=await setup(),profile=await saved(db);await setup(db,other);
  assert.equal((await api(db,'payrollExportProfileRead',{profileId:profile.id},other)).status,404);
  const role=await api(db,'createRole',{name:'Lønvisning',permissions:['plan','payroll.view']}),viewer={id:'profile-viewer',email:'viewer@example.test'};
  const invite=await api(db,'invite',{email:viewer.email,roleId:role.body.role.id});assert.equal(invite.status,200);assert.equal((await api(db,'acceptInvite',{token:new URL(invite.body.inviteUrl).searchParams.get('token')},viewer)).status,200);
  assert.equal((await api(db,'payrollExportProfilesRead',{},viewer)).status,200);assert.equal((await api(db,'payrollExportProfileSave',{version:0,profile:config()},viewer)).status,403);
  assert.equal((await api(db,'payrollExportProfileArchive',{profileId:profile.id,version:1},viewer)).status,403);db.sqlite.close();
});

test('employee mapping search is bounded and reaches 500+ staff, including archived identities needed by historical closures',async()=>{
  const staff=Array.from({length:510},(_,index)=>person('person-'+String(index).padStart(4,'0'),'Medarbejder '+String(index).padStart(4,'0'),index!==509));
  const {db}=await setup(database(),owner,staff),ids=[];let cursor=null,pages=0;
  do{const result=await api(db,'payrollExportProfileEmployees',{limit:25,cursor});assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.people.length<=25);ids.push(...result.body.people.map(row=>row.id));cursor=result.body.nextCursor;pages++;}while(cursor);
  assert.equal(ids.length,509);assert.equal(new Set(ids).size,509);assert.equal(pages,21);
  const archived=await api(db,'payrollExportProfileEmployees',{query:'0509',includeArchived:true,limit:25});assert.equal(archived.status,200);assert.equal(archived.body.people.length,1);assert.equal(archived.body.people[0].archived,true);
  const mapped=await saved(db,config({employeeNumbers:{'person-0509':'OLD-509'}}));assert.equal(mapped.config.employeeNumbers['person-0509'],'OLD-509');
  const first=await api(db,'payrollExportProfileEmployees',{limit:1});db.sqlite.prepare('UPDATE workspace_directory_state SET version=version+1').run();assert.equal((await api(db,'payrollExportProfileEmployees',{limit:1,cursor:first.body.nextCursor})).status,409);db.sqlite.close();
});

test('revoking payroll rights during the write cannot leave a new profile or revision behind',async()=>{
  const {db}=await setup();let changed=false;db.beforeBatch=async statements=>{if(!changed&&statements.some(row=>row.sql.startsWith('INSERT INTO workspace_payroll_export_profiles'))){changed=true;db.beforeBatch=null;db.sqlite.prepare("UPDATE workspace_roles SET version=version+1,permissions='[]' WHERE id='admin'").run();}};
  const result=await api(db,'payrollExportProfileSave',{version:0,profile:config()});assert.ok([403,409].includes(result.status),JSON.stringify(result.body));assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_payroll_export_profiles').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM workspace_payroll_export_profile_revisions').get().n,0);db.sqlite.close();
});

test('a 500+ employee mapping larger than the ordinary account body cap can be saved with exact leading-zero numbers',async()=>{
  const staff=Array.from({length:520},(_,index)=>person('person-'+ 'x'.repeat(106)+String(index).padStart(7,'0'),'Medarbejder '+index));
  const {db}=await setup(database(),owner,staff),employeeNumbers=Object.fromEntries(staff.map((item,index)=>[item.id,String(index).padStart(60,'0')])),profile=config({employeeNumbers}),payload={version:0,profile};
  assert.ok(Buffer.byteLength(JSON.stringify(payload))>64*1024);const result=await api(db,'payrollExportProfileSave',payload);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(Object.keys(result.body.profile.config.employeeNumbers).length,520);
  assert.equal(result.body.profile.config.employeeNumbers[staff[3].id],String(3).padStart(60,'0'));
  const tooLargeRead=await api(db,'payrollExportProfileRead',{profileId:result.body.profile.id,extra:'x'.repeat(70000)});assert.equal(tooLargeRead.status,413);db.sqlite.close();
});
