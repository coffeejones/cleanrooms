/* Isolated phone QA: real handlers, synthetic accounts, loopback HTTP and disposable SQLite. */
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync,chmodSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),studioRoot=path.join(root,'sites/cleanrooms-studio');
const require=createRequire(import.meta.url);
const Workspace=await import(path.join(studioRoot,'lib/workspace-store.mjs'));
const Store=await import(path.join(studioRoot,'lib/studio-store.mjs'));
const {handleMobileAuthRequest}=await import(path.join(studioRoot,'lib/mobile-auth-route.mjs'));
const {handleGatewayRequest}=await import(path.join(root,'sites/cleanrooms-app-api/worker/index.js'));
const Departments=require(path.join(studioRoot,'src/department-model.js'));
const Planning=require(path.join(studioRoot,'src/planning-records.js'));
const Time=require(path.join(studioRoot,'src/timekeeping-model.js'));
const RealDate=globalThis.Date,isSmoke=process.argv.includes('--smoke'),port=isSmoke?8792:8791,owner='qa-iphone-owner';
const runtime=path.join(here,isSmoke?'.smoke-runtime':'.runtime'),databasePath=path.join(runtime,'fixture.sqlite'),manifestPath=path.join(runtime,'manifest.json');
const startCodeSecret='c'.repeat(64),gatewayKey='d'.repeat(64),siteGate='isolated-qa-site-gate';
const gps={latitude:55.6761,longitude:12.5683,radiusMeters:200};
mkdirSync(runtime,{recursive:true,mode:0o700});
if(process.argv.includes('--reset'))for(const file of [databasePath,databasePath+'-wal',databasePath+'-shm',manifestPath])if(existsSync(file))unlinkSync(file);
if(existsSync(databasePath)!==existsSync(manifestPath))throw Error('Incomplete QA fixture. Restart with --reset; only qa/iphone-flow/.runtime is affected.');
const fresh=!existsSync(databasePath),sqlite=new DatabaseSync(databasePath);chmodSync(databasePath,0o600);sqlite.exec('PRAGMA foreign_keys=ON');
if(fresh)for(const file of readdirSync(path.join(studioRoot,'drizzle')).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(path.join(studioRoot,'drizzle',file),'utf8'));
const db={prepare:sql=>({bind:(...values)=>({sql,values})}),async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(({sql,values})=>{assert.ok(values.length<=100);const query=sqlite.prepare(sql);return query.columns().length?{results:query.all(...values)}:{meta:{changes:Number(query.run(...values).changes)}};});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
let state=fresh?{version:1,clockOffsetMs:0,offline:false,failAfterCommit:null,runId:crypto.randomUUID()}:JSON.parse(readFileSync(manifestPath,'utf8'));
let queue=Promise.resolve();const calls=[];
function persist(){writeFileSync(manifestPath,JSON.stringify(state,null,2),{mode:0o600});}
const now=()=>RealDate.now()+state.clockOffsetMs;
const clock=()=>({now:new RealDate(now()).toISOString(),local:Time.localNow(new RealDate(now())),offsetMinutes:state.clockOffsetMs/60000,hostClockChanged:false});
function serialized(operation){const job=queue.then(async()=>{const offset=state.clockOffsetMs;const fixtureNow=()=>RealDate.now()+offset;globalThis.Date=new Proxy(RealDate,{construct(target,args){return Reflect.construct(target,args.length?args:[fixtureNow()]);},apply(){return new RealDate(fixtureNow()).toString();},get(target,key,receiver){return key==='now'?fixtureNow:Reflect.get(target,key,receiver);}});try{return await operation();}finally{globalThis.Date=RealDate;}});queue=job.catch(()=>{});return job;}
const headers={origin:'https://qa-studio.test','content-type':'application/json','oai-authenticated-user-id':owner,'oai-authenticated-user-email':'qa.planner@example.test','oai-authenticated-user-full-name':'QA Planlægger'};
async function unpack(response){return{status:response.status,body:await response.json()};}
async function ensure(response,label){const result=await unpack(response);if(result.status<200||result.status>=300)throw Error(label+': '+result.status+' '+JSON.stringify(result.body));return result.body;}
const plan=async(method='GET',body)=>ensure(await Workspace.handleWorkspaceStudioRequest(new Request('https://qa-studio.test/api/studio',{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),db),'plan '+method);
const account=async(action,payload={})=>ensure(await Workspace.handleAccountsRequest(new Request('https://qa-studio.test/api/accounts',{method:'POST',headers,body:JSON.stringify({action,...payload})}),db,startCodeSecret),'account '+action);
async function save(next,publication){const current=await plan(),changes=Planning.commands(current.studio,next,current.planning.versions);return plan('PUT',{revision:current.revision,directoryRevision:current.directory.revision,commandReceipt:'records',studio:Planning.payloadStudio(next),planning:{version:1,changes,metadataChanged:Planning.canonical(Planning.metadata(current.studio))!==Planning.canonical(Planning.metadata(next)),metadataBase:current.planning.metadataHash,dependencies:Planning.dependencies(current.studio,changes,current.planning.versions)},...(publication?{publication}:{})});}
const weekFor=day=>{const from=Time.addDays(day,-((new RealDate(day+'T12:00:00Z').getUTCDay()+6)%7));return{from,to:Time.addDays(from,6)};};
const hhmm=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
const payroll=amount=>({currency:'DKK',agreements:[{id:'qa-hourly',from:state.day,type:'hourly',amountCents:amount}],supplements:[{id:'qa-service',name:'Servicetillæg',type:'hourly',amountCents:1200,from:state.day,to:null,weekdays:[0,1,2,3,4,5,6],start:null,end:null}]});
async function policySave(policy,version){const preview=await account('payrollPolicyPreview',{policy,version,date:state.day});return account('payrollPolicySave',{policy,version,date:state.day,previewToken:preview.previewToken});}
async function publish({weeks=1,includeDistant=false}={}){if(!Number.isInteger(weeks)||weeks<1||weeks>2)throw Error('Choose 1 or 2 fixture weeks.');const scope={from:state.from,to:Time.addDays(state.from,weeks*7-1),siteIds:[0,1],includeDependencies:true};await save((await plan()).studio,scope);if(includeDistant){const far=weekFor(state.distantDay);await save((await plan()).studio,{...far,siteIds:[1],includeDependencies:true});}return review();}
async function seed(){
 const local=Time.localNow(),minute=Time.minute(local.time);if(minute>22*60)throw Error('Daytime phone QA starts before 22:00 Copenhagen; run tomorrow or choose a separate explicit overnight fixture.');
 state.day=local.date;Object.assign(state,weekFor(state.day));state.to=Time.addDays(state.from,13);state.distantDay=Time.addDays(state.day,40);
 const start=Math.max(6*60,minute),end=Math.min(23*60-30,start+60),nonStart=end+10,nonEnd=Math.min(23*60+59,nonStart+30);
 state.start=hhmm(start);state.end=hhmm(end);state.nonGpsStart=hhmm(nonStart);state.nonGpsEnd=hhmm(nonEnd);
 const organization=Departments.defaultOrganization();organization.sites[0]={...organization.sites[0],name:'QA Hovedkontor',address:'Syntetisk GPS-arbejdssted',gps:{enabled:true,...gps},workHoursBudget:{period:'week',hours:30}};organization.sites[1]={...organization.sites[1],name:'QA Servicecenter',address:'Syntetisk arbejdssted uden GPS',gps:{enabled:false,latitude:null,longitude:null,radiusMeters:150}};
 const studio={storageVersion:1,demoSeed:false,roster:[],organization,workspaceSettings:{companyName:'CleanRooms Lokal QA',payrollPeriod:{startDay:1},workHoursBudget:{period:'week',hours:30}},series:[],edits:{},deleted:[],requests:{},weekPlans:{},coverageRules:[],checklistProgress:{}};
 assert.equal((await Store.writeStudio(db,owner,0,studio)).ok,true);await plan();
 const employee=await account('createEmployeeUser',{name:'QA Freja',email:'qa.iphone@example.test',site:0,roleId:'employee'}),colleague=await account('createEmployeeUser',{name:'QA Martin',email:'qa.colleague@example.test',site:0,roleId:'employee'});
 state.personId=employee.createdEmployee.id;state.colleagueId=colleague.createdEmployee.id;state.email='qa.iphone@example.test';state.password=(await account('revealAppStartCode',{personId:state.personId,version:employee.account.version})).temporaryPassword;
 state.policy={schema:1,groups:[{id:'qa-service-team',name:'QA Servicehold',archived:false,revisions:[{id:'qa-group-v1',from:state.day,payroll:payroll(18000)}]}],links:[state.personId,state.colleagueId].map(personId=>({personId,from:state.day,groupId:'qa-service-team',baseMode:'group',excludedPersonalSupplementIds:[],supplementOverrides:[]}))};
 await policySave(state.policy,0);state.policyVersion=1;
 const noteRich=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Test med rigtige kontodata i en helt isoleret QA-database.'}]},{type:'taskList',content:['Kontrollér indgangen','Fyld sæbe op','Lås døren'].map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]});
 const next=structuredClone((await plan()).studio);next.series.push({id:'qa-iphone-series',person:state.personId,site:0,startDate:state.day,endDate:state.to,weekdays:[0,1,2,3,4,5,6],start:state.start,end:state.end,plannedBreakMinutes:5,note:'Opgaver til QA-vagten',noteRich});
 state.shiftId='qa-iphone-series@'+state.day;state.nonGpsShiftId='qa-non-gps-today';state.distantShiftId='qa-distant-change';
 next.edits[state.nonGpsShiftId]={id:state.nonGpsShiftId,person:state.personId,site:1,date:state.day,start:state.nonGpsStart,end:state.nonGpsEnd,plannedBreakMinutes:0,note:'Denne vagt skal kunne startes uden GPS.'};
 next.edits['qa-colleague-today']={id:'qa-colleague-today',person:state.colleagueId,site:0,date:state.day,start:state.start,end:state.end,note:'Kollega på samme arbejdssted'};
 next.edits[state.distantShiftId]={id:state.distantShiftId,person:state.personId,site:1,date:state.distantDay,start:'10:00',end:'11:00',plannedBreakMinutes:0,note:'Besked om en vagt 40 dage frem skal være synlig nu.'};
 next.edits['qa-open-tomorrow']={id:'qa-open-tomorrow',person:'',site:1,date:Time.addDays(state.day,1),start:'16:00',end:'17:00',note:'Ledig vagt til anmodningsflowet'};
 await save(next);
 state.roomId=(await account('chatCreate',{departmentId:'dep-nord',name:'QA Afdeling'})).room.id;
 await account('chatSend',{roomId:state.roomId,clientId:'qa-welcome',text:'Velkommen til den isolerede QA-samtale. Denne besked kommer fra planlæggerens rigtige handler.'});
 persist();
}
async function review(){const source=await plan(),times=await account('timeRead',{from:state.from,to:state.to,personId:state.personId}),budget=await account('publicationBudgetRead',{from:state.from,to:Time.addDays(state.from,6),siteIds:[0,1],includeDependencies:true});
 return{runId:state.runId,clock:clock(),employee:{name:'QA Freja',email:state.email,personId:state.personId},period:{from:state.from,to:state.to},shiftId:state.shiftId,nonGpsShiftId:state.nonGpsShiftId,distantShiftId:state.distantShiftId,roomId:state.roomId,gps,revision:source.revision,entries:times.entries.filter(entry=>entry.personId===state.personId).map(entry=>({id:entry.id,shiftId:entry.shiftId,version:entry.version,status:entry.status,start:entry.start,end:entry.end,date:entry.date,workedMinutes:entry.workedMinutes,breakMinutes:entry.breakMinutes,review:Time.review(entry,{shift:times.shifts.find(shift=>shift.id===entry.shiftId),canViewPayroll:true,today:Time.localNow().date}),payroll:entry.payroll??null})),budget,offline:state.offline,failAfterCommit:state.failAfterCommit};}
async function decide(operation,body={}){const times=await account('timeRead',{from:state.from,to:state.to,personId:state.personId}),entry=times.entries.find(entry=>entry.personId===state.personId&&(body.entryId?entry.id===body.entryId:entry.shiftId===(body.shiftId??state.shiftId)));if(!entry)throw Error('No matching attendance entry: select its entryId/shiftId from review after the phone clock action.');const payload={operation,entryId:entry.id,version:entry.version};if(operation==='approve')payload.onlyIfMatchesPlan=body.onlyIfMatchesPlan===true;else if(operation==='reject')payload.reason=body.reason??'QA: Bekræft indstemplingen med planlæggeren.';else if(operation==='correct')Object.assign(payload,{start:body.start??entry.start,end:body.end??entry.end,endDate:entry.endDate,breakMinutes:body.breakMinutes??entry.breakMinutes,reason:body.reason??'QA: rettet efter medarbejderens forklaring.'});const result=await account('timeWrite',payload);return{result,review:await review()};}
async function admin(name,body){if(name==='status')return{...await review(),credentials:{email:state.email,password:state.password},recentCalls:calls.slice(-20)};
 if(name==='publish')return publish(body);
 if(name==='clock'){if(!Number.isFinite(body.advanceMinutes)||body.advanceMinutes<0||body.advanceMinutes>180||state.clockOffsetMs+body.advanceMinutes*60000>12*3600000)throw Error('Advance 0..180 minutes per call, maximum 12 fixture hours in total.');state.clockOffsetMs+=Math.round(body.advanceMinutes*60000);persist();return clock();}
 if(name==='review')return review();if(['approve','reject','correct'].includes(name))return decide(name,body);
 if(name==='fault'){if(body.offline!==undefined){if(typeof body.offline!=='boolean')throw Error('offline must be boolean');state.offline=body.offline;}if(body.afterCommit!==undefined){if(body.afterCommit!==null&&!['start','pause','resume','finish','submit'].includes(body.afterCommit))throw Error('Choose a real shiftTime operation or null');state.failAfterCommit=body.afterCommit;}persist();return{offline:state.offline,afterCommit:state.failAfterCommit};}
 if(name==='chat')return account('chatSend',{roomId:state.roomId,clientId:'qa-admin-'+crypto.randomUUID(),text:body.text??'En ny besked fra QA-planlæggeren.'});
 if(name==='change'){const source=(await plan()).studio,target=body.shiftId??'qa-iphone-series@'+Time.addDays(state.day,1),shift=target===state.distantShiftId?source.edits[target]:{...source.series.find(series=>series.id==='qa-iphone-series'),id:target,date:Time.addDays(state.day,1),seriesId:'qa-iphone-series'};if(!shift)throw Error('Fixture shift not found');source.edits[target]={...shift,start:body.start??hhmm(Time.minute(shift.start)+60),end:body.end??hhmm(Time.minute(shift.end)+60)};await save(source);const scope=weekFor(source.edits[target].date);await save((await plan()).studio,{...scope,siteIds:[source.edits[target].site],includeDependencies:true});return review();}
 if(name==='personal-rate'){if(!Number.isInteger(body.hourlyCents)||body.hourlyCents<0||body.hourlyCents>100000)throw Error('hourlyCents must be 0..100000');const current=await account('payrollRead',{personId:state.personId});const result=await account('payrollSave',{personId:state.personId,version:current.version,policyVersion:current.policyVersion,payroll:{currency:'DKK',agreements:[{id:'qa-personal-rate',from:state.day,type:'hourly',amountCents:body.hourlyCents}],supplements:[]}});state.policy=result.policy;state.policyVersion=result.policyVersion;persist();return review();}
 throw Error('Unknown QA command');}
async function readBody(request){let bytes=0,parts=[];for await(const part of request){bytes+=part.length;if(bytes>64*1024)throw Error('Body too large');parts.push(part);}return Buffer.concat(parts);}
function send(response,status,body,extra={}){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-cleanrooms-qa':'isolated-local-fixture',...extra});response.end(typeof body==='string'?body:JSON.stringify(body));}
const server=http.createServer(async(request,response)=>{try{if(!['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress))return send(response,403,{error:'loopback_only'});const url=new URL(request.url,'http://127.0.0.1:'+port);if(url.search)return send(response,404,{error:'not_found'});const raw=request.method==='POST'?await readBody(request):Buffer.alloc(0);
 if(url.pathname.startsWith('/qa/')){if(request.headers['x-cleanrooms-qa']!=='local-only')return send(response,403,{error:'local_control_header_required'});const name=url.pathname.slice(4);if(name==='shutdown'){send(response,200,{ok:true});server.close(()=>{sqlite.close();process.exit(0);});return;}const result=await serialized(()=>admin(name,raw.length?JSON.parse(raw):{}));return send(response,200,result);}
 if(url.pathname!=='/api/mobile-auth'||request.method!=='POST')return send(response,404,{error:'not_found'});
 const result=await serialized(async()=>{if(state.offline)return Response.json({error:'qa_offline',message:'QA: testserveren er midlertidigt offline.'},{status:503});let payload;try{payload=JSON.parse(raw);}catch{payload={};}
 const upstream=await handleGatewayRequest(new Request('http://127.0.0.1:'+port+'/api/mobile-auth',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'127.0.0.1',...(request.headers.authorization?{authorization:request.headers.authorization}:{})},body:raw}),{MOBILE_GATEWAY_KEY:gatewayKey,STUDIO_SITE_ACCESS_TOKEN:siteGate,STUDIO_ORIGIN:'https://qa-studio.test'},async(_url,options)=>{assert.equal(options.headers.get('OAI-Sites-Authorization'),'Bearer '+siteGate);assert.equal(options.headers.get('oai-authenticated-user-id'),null);return handleMobileAuthRequest(new Request('https://qa-studio.test/api/mobile-auth',options),db,gatewayKey);});
 calls.push({at:new RealDate(now()).toISOString(),action:payload.action,status:upstream.status});if(calls.length>100)calls.shift();
 if(payload.action==='shiftTime'&&payload.operation===state.failAfterCommit&&upstream.ok){state.failAfterCommit=null;persist();return Response.json({error:'qa_after_commit_timeout',message:'QA: svaret blev tabt efter commit.'},{status:503});}return upstream;});
 const body=await result.text(),extra={};for(const key of ['retry-after','x-request-id'])if(result.headers.has(key))extra[key]=result.headers.get(key);return send(response,result.status,body,extra);
 }catch(error){console.error(JSON.stringify({event:'qa_request_failed',message:error.message}));send(response,500,{error:'qa_failure',message:error.message});}});
if(fresh)await serialized(seed);
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'qa_ready',url:'http://127.0.0.1:'+port,pid:process.pid,day:state.day,email:state.email,password:state.password,gps,fixtureDirectory:runtime,clock:clock(),published:false})));
process.on('SIGTERM',()=>server.close(()=>{persist();sqlite.close();process.exit(0);}));
