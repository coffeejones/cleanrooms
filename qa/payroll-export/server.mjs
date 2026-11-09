/* Disposable loopback UI QA; actual source views, transport and real account handlers. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),studio=path.join(root,'sites/cleanrooms-studio');
const esbuild=require(path.join(studio,'node_modules/esbuild'));
const {createPayrollPeriodFixture}=require(path.join(studio,'tests/helpers/payroll-period-fixture.cjs'));
const fixture=await createPayrollPeriodFixture({withPending:false});
const {handleMobileAuthRequest}=await import(path.join(studio,'lib/mobile-auth-route.mjs'));
const {handleGatewayRequest}=await import(path.join(root,'sites/cleanrooms-app-api/worker/index.js'));
const gatewayKey='d'.repeat(64),siteGate='isolated-payroll-reminder-qa';
async function mobile(payload,token){return handleGatewayRequest(new Request('http://127.0.0.1:8794/api/mobile-auth',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'127.0.0.1',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)}),{MOBILE_GATEWAY_KEY:gatewayKey,STUDIO_SITE_ACCESS_TOKEN:siteGate,STUDIO_ORIGIN:'https://qa-studio.test'},(_url,options)=>handleMobileAuthRequest(new Request('https://qa-studio.test/api/mobile-auth',options),fixture.db,gatewayKey));}
const appLogin=await fixture.account('createAppLogin',{personId:fixture.people[1].id,email:'qa.mobile-payroll@example.test'});if(appLogin.status!==200)throw Error('Synthetic app login failed: '+appLogin.status+' '+(appLogin.body.error||appLogin.body.message||''));
const signedIn=await (await mobile({action:'login',email:'qa.mobile-payroll@example.test',password:appLogin.body.temporaryPassword})).json();
for(const key of ['shiftReminders','checkoutReminders']){const prefs=await (await mobile({action:'employeePreferences'},signedIn.token)).json();const changed=await mobile({action:'employeePreference',version:prefs.version,key,value:true},signedIn.token);if(!changed.ok)throw Error('Synthetic reminder preference failed');}

const origin='http://127.0.0.1:8794',read=name=>fs.readFileSync(path.join(studio,name),'utf8'),escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function bridge(){const module={exports:{}};Function('module','exports','Response',esbuild.transformSync(read('app/storage-bridge/route.ts'),{loader:'ts',format:'cjs'}).code)(module,module.exports,Response);return module.exports.GET();}
function page(){
 const names=read('scripts/build.py').match(/css = [\s\S]*?for name in \[([\s\S]*?)\]\)/)[1].match(/'([^']+)'/g).map(value=>value.slice(1,-1));
 const css=names.map(name=>read('src/'+name)).join('\n');
 const modules=['payroll-export-profile-model.js','payroll-export-profile-view.js','payroll-period-view.js'].map(name=>read('src/'+name)).join('\n');
 const client=`const callbacks=new Map();let id=0;const channel=new MessageChannel();channel.port1.onmessage=event=>{const data=event.data;if(data?.type==='cleanrooms-storage-ready'){document.querySelector('#open').disabled=false;return;}const pending=callbacks.get(data.id);if(pending){callbacks.delete(data.id);pending(data);}};channel.port1.start();parent.postMessage({type:'cleanrooms-storage-connect'},'*',[channel.port2]);const onAction=(operation,payload)=>new Promise(resolve=>{const ticket=++id;callbacks.set(ticket,resolve);channel.port1.postMessage({id:ticket,action:'account',operation,payload});});document.querySelector('#open').onclick=()=>CleanRoomsPayrollPeriodView.open({element:document.querySelector('#cleanrooms-studio'),date:${JSON.stringify(fixture.date)},onAction});`;
 const inner=`<!doctype html><html lang="da"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${css}\nhtml,body{margin:0;height:100%;font-family:Arial,sans-serif}#cleanrooms-studio{position:relative;height:100vh;min-height:100vh;background:#fff;padding:32px;box-sizing:border-box;display:block}</style><div id="cleanrooms-studio" data-page="hours" data-role="planner"><h2>Timer</h2><p>Løngrundlag · isoleret QA</p><button id="open" class="cs-button" disabled>Lønperiode og eksport</button></div><script>${modules}\n${client}</script></html>`;
 return `<!doctype html><html><head><meta charset="utf-8"><title>CleanRooms · Lønperiode QA</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block}</style></head><body><iframe id="codex-visualization" sandbox="allow-scripts" srcdoc="${escape(inner)}"></iframe><script>${read('src/storage-parent.js')}</script></body></html>`;
}
const server=http.createServer(async(req,res)=>{try{
 if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return;}
 if(req.url==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'});res.end(page());return;}
 if(req.url==='/storage-bridge'&&req.method==='GET'){const response=await bridge();res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;}
 if(req.url==='/api/mobile-auth'&&req.method==='POST'){
  let size=0,parts=[];for await(const part of req){size+=part.length;if(size>64*1024)throw Error('Too large');parts.push(part);}const payload=JSON.parse(Buffer.concat(parts)),authorization=req.headers.authorization;
  const response=await mobile(payload,authorization?.startsWith('Bearer ')?authorization.slice(7):undefined);res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});res.end(await response.text());return;
 }
 if(req.url==='/api/accounts'&&req.method==='POST'){
  if(req.headers.origin!==origin){res.writeHead(403);res.end();return;}let size=0,parts=[];for await(const part of req){size+=part.length;if(size>2*1024*1024)throw Error('Too large');parts.push(part);}const body=JSON.parse(Buffer.concat(parts)),{action,...payload}=body;
  if(!String(action).startsWith('payroll')&&!['timeRead','timeWrite'].includes(action)){res.writeHead(400);res.end();return;}
  const result=await fixture.account(action,payload);res.writeHead(result.status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result.body));return;
 }
 res.writeHead(404);res.end();
}catch(error){console.error(error.message);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({message:'Isoleret QA-fejl: '+error.message}));}});
server.listen(8794,'127.0.0.1',()=>console.log(JSON.stringify({url:origin,range:fixture.range,synthetic:true,mobile:{email:'qa.mobile-payroll@example.test',password:appLogin.body.temporaryPassword},people:fixture.people.map(person=>({id:person.id,name:person.name}))})));
process.on('SIGINT',()=>server.close(()=>{fixture.close();process.exit(0);}));
