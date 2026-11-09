const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { handleMobileAuthRequest } = require('../lib/mobile-auth-route.mjs');
const { drainPushOutbox, handlePushDispatchRequest } = require('../lib/push-dispatch.mjs');
const { handleMobilePush } = require('../lib/mobile-push-store.mjs');
const Auth = require('../lib/mobile-auth-store.mjs');
const source = fs.readFileSync(require.resolve('./mobile-route-employee.test.cjs'), 'utf8').split("test('mobile employee HTTP routes")[0];
const { setup, key, personId, peerId } = Function('require','__dirname', source + '\nreturn {setup,key,personId,peerId};')(require,__dirname);
const projectId = '99999999-9999-4999-8999-999999999999';
const install = '11111111-1111-4111-8111-111111111111';
const peerInstall = '22222222-2222-4222-8222-222222222222';
const expoToken = 'ExpoPushToken[synthetic-device-token-0123456789]';
async function fixture(t) {
  const result = await setup(t);
  const { db, sqlite, workspaceId, token } = result;
  const call = async (payload, authToken = token, options = { projectId }) => {
    const response = await handleMobileAuthRequest(new Request('https://studio.test/api/mobile-auth',{method:'POST',headers:{'content-type':'application/json','x-cleanrooms-gateway-key':key,authorization:'Bearer '+authToken},body:JSON.stringify(payload)}),db,key,options);
    return { status: response.status, body: await response.json() };
  };
  const register = (installationId=install, authToken=token, pushToken=expoToken) => call({action:'employeePushRegister',installationId,expoPushToken:pushToken,platform:'ios',projectId},authToken);
  function message(id='new-push',person=personId,kind='new') {
    const row=sqlite.prepare('SELECT * FROM workspace_published_shifts WHERE workspace_id=? AND person_id=? AND deleted=0 LIMIT 1').get(workspaceId,person);
    const after={id:row.id,person,date:row.work_date,site:row.site,start:row.start_time,end:row.end_time,fingerprint:row.workflow_fingerprint};
    const at=new Date(Date.now()+100).toISOString();
    const entry={id,personId:person,kind,createdAt:at,readAt:null,summary:'PRIVATE employee text',before:kind==='cancelled'?after:null,after:kind==='cancelled'?null:after};
    sqlite.prepare('INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config) VALUES(?,?,?,?,?,?)').run(workspaceId,id,person,kind,at,JSON.stringify(entry));
    return sqlite.prepare('SELECT * FROM workspace_push_events WHERE workspace_id=? AND source_id=?').get(workspaceId,id);
  }
  const requests=[];
  const provider=async (url,options)=>{ requests.push({url,options,body:JSON.parse(options.body)});return Response.json({data:requests.at(-1).body.map((_,index)=>({status:'ok',id:'ticket-'+index}))}); };
  const drain = (options={}) => drainPushOutbox({db,projectId,requestProvider:provider,now:Date.now()+200,...options});
  return {...result,call,register,message,requests,drain,provider};
}

test('push HTTP registration is session-scoped, validates project and never accepts account authority',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call({action:'employeePushRegister',installationId:install,expoPushToken:expoToken,platform:'ios',projectId},f.token,{})).status,503);
  assert.equal((await f.call({action:'employeePushRegister',installationId:install,expoPushToken:expoToken,platform:'ios',projectId:'88888888-8888-4888-8888-888888888888'})).status,400);
  assert.equal((await f.call({action:'employeePushRegister',installationId:install,expoPushToken:expoToken,platform:'ios',projectId,personId:peerId})).status,400);
  assert.equal((await f.register()).status,200);
  assert.equal((await f.register()).status,200);
  assert.equal(f.sqlite.prepare('SELECT version FROM workspace_push_devices').get().version,1,'idempotent foreground registration keeps its generation');
  assert.equal((await f.register(install,f.peerToken)).status,409);
  assert.equal((await f.register(peerInstall,f.peerToken)).status,409,'a second account cannot steal an active Expo address');
  assert.equal(f.sqlite.prepare('SELECT person_id FROM workspace_push_devices').get().person_id,personId);
});

test('publication source and outbox commit atomically, fanout is idempotent and provider payload is private',async t=>{
  const f=await fixture(t);await f.register();
  f.sqlite.exec('BEGIN');f.message('rolled-back');f.sqlite.exec('ROLLBACK');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_push_events WHERE source_id='rolled-back'").get().n,0);
  const event=f.message();await f.drain();
  assert.equal(f.requests.length,1);const payload=f.requests[0].body[0];
  assert.deepEqual(payload.data,{v:1,eventId:event.event_id,installationId:install});
  assert.equal(payload.to,expoToken);assert.equal(payload.title,'Vagtplanen er opdateret');
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE|Own Name|08:00|16:00|person-route|route-own/);
  assert.equal(f.sqlite.prepare('SELECT status FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id).status,'receipt');
  await f.drain({now:Date.now()+2000});assert.equal(f.requests.length,1,'accepted ticket is never resent during receipt wait');
  assert.deepEqual((await f.call({action:'employeePushOpen',eventId:event.event_id,installationId:install})).body,{target:{kind:'shift',shiftId:'route-own'}});
  assert.equal((await f.call({action:'employeePushOpen',eventId:event.event_id,installationId:install},f.peerToken)).status,404);
});

test('logout and revoked credentials stop queued push and account switching cannot open old events',async t=>{
  const f=await fixture(t);await f.register();const event=f.message();
  assert.equal((await f.call({action:'logout'})).status,200);
  assert.equal(f.sqlite.prepare('SELECT active FROM workspace_push_devices').get().active,0);
  await f.drain();assert.equal(f.requests.length,0);
  assert.equal((await f.register(install,f.peerToken)).status,200);
  assert.equal((await f.call({action:'employeePushOpen',eventId:event.event_id,installationId:install},f.peerToken)).status,404);
  const row=f.sqlite.prepare('SELECT version FROM workspace_mobile_credentials WHERE workspace_id=? AND person_id=?').get(f.workspaceId,peerId);
  f.sqlite.prepare('UPDATE workspace_mobile_credentials SET version=? WHERE workspace_id=? AND person_id=?').run(row.version+1,f.workspaceId,peerId);
  f.message('revoked-peer',peerId);await f.drain({now:Date.now()+3000});assert.equal(f.requests.length,0);
});

test('an old still-valid session cannot unregister its replacement session binding',async t=>{
  const f=await fixture(t);await f.register();
  const replacement=Buffer.alloc(32,7).toString('base64url'),hash=crypto.createHash('sha256').update(replacement).digest('hex');
  f.sqlite.prepare('INSERT INTO workspace_mobile_sessions SELECT ?,workspace_id,person_id,credential_version,expires_at FROM workspace_mobile_sessions WHERE token_hash=?').run(hash,crypto.createHash('sha256').update(f.token).digest('hex'));
  assert.equal((await f.register(install,replacement)).status,200);
  assert.equal((await f.call({action:'employeePushUnregister',installationId:install})).status,200);
  assert.equal(f.sqlite.prepare('SELECT active,session_hash FROM workspace_push_devices').get().active,1);
  assert.equal(f.sqlite.prepare('SELECT session_hash FROM workspace_push_devices').get().session_hash,hash);
});

test('read messages, disabled or corrupt preferences and reassigned shifts are suppressed at actual delivery',async t=>{
  const f=await fixture(t);await f.register();
  const read=f.message('already-read');
  f.sqlite.prepare('INSERT INTO workspace_message_receipts(workspace_id,message_id,person_id,read_at) VALUES(?,?,?,?)').run(f.workspaceId,read.source_id,personId,new Date().toISOString());
  f.message('reassigned');f.sqlite.prepare('UPDATE workspace_published_shifts SET person_id=? WHERE workspace_id=? AND id=?').run(peerId,f.workspaceId,'route-own');
  await f.drain();assert.equal(f.requests.length,0);
  f.sqlite.prepare('UPDATE workspace_published_shifts SET person_id=? WHERE workspace_id=? AND id=?').run(personId,f.workspaceId,'route-own');
  f.sqlite.prepare('INSERT INTO workspace_employee_preferences VALUES(?,?,1,?,?)').run(f.workspaceId,personId,JSON.stringify({notifications:false,chatNotifications:true,unavailableDates:[]}),new Date().toISOString());
  f.message('preferences-off');await f.drain({now:Date.now()+2000});assert.equal(f.requests.length,0);
  f.sqlite.prepare('UPDATE workspace_employee_preferences SET config=? WHERE workspace_id=? AND person_id=?').run('{malformed',f.workspaceId,personId);
  f.message('preferences-corrupt');await f.drain({now:Date.now()+4000});assert.equal(f.requests.length,0);
});

test('cancelled assignments open the authenticated inbox rather than another employee shift',async t=>{
  const f=await fixture(t);await f.register();const event=f.message('cancelled-own',personId,'cancelled');
  f.sqlite.prepare('UPDATE workspace_published_shifts SET person_id=? WHERE workspace_id=? AND id=?').run(peerId,f.workspaceId,'route-own');
  await f.drain();assert.equal(f.requests.length,1);
  assert.deepEqual((await f.call({action:'employeePushOpen',installationId:install,eventId:event.event_id})).body,{target:{kind:'inbox'}});
  assert.equal((await f.call({action:'employeePushUnregister',installationId:install})).status,200);
  assert.equal((await f.call({action:'employeePushOpen',installationId:install,eventId:event.event_id})).status,404);
});

test('two concurrent workers share one lease and network ambiguity never triggers blind duplicate sends',async t=>{
  const f=await fixture(t);await f.register();const event=f.message();let calls=0;
  const provider=async()=>{calls++;throw Error('synthetic timeout after provider may accept');};
  await Promise.all([f.drain({requestProvider:provider}),f.drain({requestProvider:provider})]);
  assert.equal(calls,1);assert.equal(f.sqlite.prepare('SELECT status FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id).status,'unknown');
  await f.drain({requestProvider:provider,now:Date.now()+minute()});assert.equal(calls,1);
});
const minute=()=>60_000;

test('explicit transient errors back off and malformed positional tickets are never assigned to the wrong person',async t=>{
  const f=await fixture(t);await f.register();const event=f.message();
  await f.drain({requestProvider:async()=>new Response('',{status:429})});
  const pending=f.sqlite.prepare('SELECT * FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id);assert.equal(pending.status,'pending');assert.ok(pending.due_at>Date.now());
  await f.drain({now:Date.now()+minute(),requestProvider:async()=>Response.json({data:[]})});
  assert.equal(f.sqlite.prepare('SELECT status FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id).status,'unknown');
});

test('ticket receipts confirm provider handoff and a late old-token invalidation preserves the rotated device',async t=>{
  const f=await fixture(t);await f.register();const event=f.message();await f.drain();
  const rotated='ExpoPushToken[synthetic-rotated-token-0123456789]';assert.equal((await f.register(install,f.token,rotated)).status,200);
  await f.drain({now:Date.now()+16*minute(),requestProvider:async(_url,options)=>{assert.deepEqual(JSON.parse(options.body),{ids:['ticket-0']});return Response.json({data:{'ticket-0':{status:'error',details:{error:'DeviceNotRegistered'}}}});}});
  assert.equal(f.sqlite.prepare('SELECT active,expo_token FROM workspace_push_devices').get().active,1);
  assert.equal(f.sqlite.prepare('SELECT expo_token FROM workspace_push_devices').get().expo_token,rotated);
  assert.equal(f.sqlite.prepare('SELECT status FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id).status,'failed');
});

test('a missing receipt is polled without resending and a valid receipt never becomes employee read status',async t=>{
  const f=await fixture(t);await f.register();const event=f.message();await f.drain();let calls=0;
  await f.drain({now:Date.now()+16*minute(),requestProvider:async url=>{calls++;assert.match(url,/getReceipts$/);return Response.json({data:{}});}});
  assert.equal(f.sqlite.prepare('SELECT status FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id).status,'receipt');
  await f.drain({now:Date.now()+32*minute(),requestProvider:async()=>Response.json({data:{'ticket-0':{status:'ok'}}})});
  assert.equal(calls,1);assert.equal(f.sqlite.prepare('SELECT status FROM workspace_push_deliveries WHERE event_id=?').get(event.event_id).status,'delivered');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_message_receipts WHERE message_id=?').get(event.source_id).n,0);
});

test('chat events respect current membership, muted rooms, own messages and idempotent send',async t=>{
  const f=await fixture(t);await f.register();
  const room=(await f.web('chatCreate',{departmentId:'dep-nord',name:'Push room'})).room;
  const message={action:'chatSend',roomId:room.id,clientId:'push-chat-peer',text:'PRIVATE chat text'};
  assert.equal((await f.call(message,f.peerToken)).status,200);assert.equal((await f.call(message,f.peerToken)).status,200);
  await f.drain({now:Date.now()+2000});assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.length,1);assert.equal(f.requests[0].body[0].title,'Ny besked');assert.doesNotMatch(JSON.stringify(f.requests),/PRIVATE chat/);
  const event=f.sqlite.prepare("SELECT event_id FROM workspace_push_events WHERE source_kind='chat'").get();assert.deepEqual((await f.call({action:'employeePushOpen',eventId:event.event_id,installationId:install})).body,{target:{kind:'chat',roomId:room.id}});
  await f.call({action:'chatMute',roomId:room.id,muted:true});await f.call({...message,clientId:'muted'},f.peerToken);await f.drain({now:Date.now()+4000});assert.equal(f.requests.length,1);
  f.sqlite.prepare("UPDATE workspace_directory_records SET site_index=2 WHERE workspace_id=? AND kind='employee' AND id=?").run(f.workspaceId,personId);
  assert.equal((await f.call({action:'employeePushOpen',eventId:event.event_id,installationId:install})).status,404);
});

test('service wake accepts only its own secret and a strictly empty bounded request',async t=>{
  const f=await fixture(t),secret='c'.repeat(64),env={DB:f.db,EXPO_PROJECT_ID:projectId,PUSH_DISPATCH_KEY:secret};
  const request=(body='{}',key=secret)=>new Request('https://studio.test/api/push-dispatch',{method:'POST',headers:{'content-type':'application/json','x-cleanrooms-push-key':key},body});
  assert.equal((await handlePushDispatchRequest(request('{}','d'.repeat(64)),env)).status,404);
  assert.equal((await handlePushDispatchRequest(request('{"personId":"other"}'),env)).status,400);
  assert.equal((await handlePushDispatchRequest(request(' '.repeat(3000)),env)).status,413);
  assert.deepEqual(await (await handlePushDispatchRequest(request(),env)).json(),{ok:true});
});

test('malformed notification field types return HTTP 400 rather than coercing arrays or crashing',async t=>{
  const f=await fixture(t);
  const payload={action:'employeePushRegister',installationId:install,expoPushToken:expoToken,platform:'ios',projectId};
  for(const value of [[install],null,{},7])assert.equal((await f.call({...payload,installationId:value})).status,400);
  for(const value of [[expoToken],null,{},7])assert.equal((await f.call({...payload,expoPushToken:value})).status,400);
  for(const value of [['a'.repeat(32)],null,{},7])assert.equal((await f.call({action:'employeePushOpen',installationId:install,eventId:value})).status,400);
});

test('registration retires bounded inactive history and caps active installations without a permanent lifetime lockout',async t=>{
  const f=await fixture(t);await f.register();
  f.sqlite.prepare('UPDATE workspace_push_devices SET active=0').run();
  const row=f.sqlite.prepare('SELECT * FROM workspace_push_devices').get();
  const insert=f.sqlite.prepare('INSERT INTO workspace_push_devices SELECT ?,workspace_id,person_id,session_hash,credential_version,expo_token,project_id,platform,site_index,binding_id,version,0,registered_at,updated_at FROM workspace_push_devices WHERE installation_id=?');
  for(let index=1;index<=32;index++)insert.run('33333333-3333-4333-8333-'+String(index).padStart(12,'0'),row.installation_id);
  const current='44444444-4444-4444-8444-444444444444';assert.equal((await f.register(current)).status,200);
  assert.ok(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_push_devices').get().n<=32);
  for(let index=1;index<8;index++){
    const id='55555555-5555-4555-8555-'+String(index).padStart(12,'0');
    assert.equal((await f.register(id,f.token,'ExpoPushToken[synthetic-address-number-'+index+']')).status,200);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_push_devices WHERE active=1').get().n,8);
  assert.equal((await f.register('66666666-6666-4666-8666-666666666666',f.token,'ExpoPushToken[synthetic-ninth-address-012345]')).status,409);
});

test('chat fanout uses the current department sites and creates no deliveries for unrelated departments',async t=>{
  const f=await fixture(t);await f.register();
  f.sqlite.prepare("UPDATE workspace_directory_records SET site_index=2 WHERE workspace_id=? AND kind='employee' AND id=?").run(f.workspaceId,peerId);
  assert.equal((await f.register(peerInstall,f.peerToken,'ExpoPushToken[synthetic-unrelated-0123456789]')).status,200);
  const room=(await f.web('chatCreate',{departmentId:'dep-nord',name:'Scoped push'})).room;
  await f.web('chatSend',{roomId:room.id,clientId:'department-scope-message',text:'Private departmental text'});
  await f.drain({now:Date.now()+2000});
  assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0].body.map(row=>row.to),[expoToken]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_push_deliveries WHERE person_id=?').get(peerId).n,0);
  f.sqlite.prepare("UPDATE workspace_directory_records SET site_index=1 WHERE workspace_id=? AND kind='employee' AND id=?").run(f.workspaceId,personId);
  assert.equal(f.sqlite.prepare('SELECT site_index FROM workspace_push_devices WHERE installation_id=?').get(install).site_index,1,'membership index changes in the same source transaction');
});

test('eight-device dispatch stays under the bounded D1 statement budget and a lost lease cannot transmit',async t=>{
  const f=await fixture(t);
  for(let index=0;index<8;index++)assert.equal((await f.register('77777777-7777-4777-8777-'+String(index).padStart(12,'0'),f.token,'ExpoPushToken[synthetic-eight-address-'+index+']')).status,200);
  f.message('bounded-dispatch');let statements=0;
  f.db.beforeBatch=items=>{statements+=items.length;};
  await f.drain();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.length,8);assert.ok(statements<50,'a complete send pass must stay below the conservative 50-statement budget: '+statements);
  f.db.beforeBatch=null;f.message('lost-lease');let changed=false;
  f.db.beforeBatch=items=>{if(!changed&&items.some(item=>item.sql.includes("UPDATE workspace_push_deliveries SET status='sending'"))){changed=true;f.sqlite.prepare("UPDATE workspace_push_dispatch_state SET lease_token='another-worker'").run();}};
  await f.drain({now:Date.now()+3000});assert.equal(changed,true);assert.equal(f.requests.length,1,'a worker that lost its global lease never contacts Expo');
});

test('dispatch health records operational provider failures without treating receipts as employee reads',async t=>{
  const {readPushDispatchHealth}=require('../lib/push-dispatch.mjs');
  const f=await fixture(t);await f.register();f.message('configuration-failure');
  await f.drain({requestProvider:async()=>Response.json({data:[{status:'error',details:{error:'InvalidCredentials'}}]})});
  const health=await readPushDispatchHealth(f.db);
  assert.equal(health.lastProviderError,'InvalidCredentials');assert.equal(health.needsAttention,true);
  assert.ok(Number.isSafeInteger(health.lastWakeAt));assert.ok(Number.isSafeInteger(health.lastSuccessAt));
});

test('a push self-test can only queue the current installation once per minute and accepts no recipient or text',async t=>{
  const f=await fixture(t);await f.register();
  const request={action:'employeePushTest',installationId:install};
  assert.equal((await f.call({...request,text:'forged'})).status,400);
  assert.equal((await f.call(request,f.peerToken)).status,404);
  assert.deepEqual((await f.call(request)).body,{queued:true});assert.deepEqual((await f.call(request)).body,{queued:true});
  const events=f.sqlite.prepare("SELECT * FROM workspace_push_events WHERE source_kind='test'").all();assert.equal(events.length,1);
  const delivery=f.sqlite.prepare('SELECT * FROM workspace_push_deliveries WHERE event_id=?').all(events[0].event_id);assert.equal(delivery.length,1);assert.equal(delivery[0].person_id,personId);
  await f.drain();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body[0].title,'CleanRooms');assert.equal(f.requests[0].body[0].body,'Beskeder virker på denne telefon.');
  assert.deepEqual((await f.call({action:'employeePushOpen',eventId:events[0].event_id,installationId:install})).body,{target:{kind:'inbox'}});
});

test('actual directory tombstones work with active and inactive push-device history',async t=>{
  const Directory=require('../lib/directory-store.mjs'),Store=require('../lib/studio-store.mjs');
  for(const inactive of [false,true])await t.test(inactive?'inactive device':'active device',async child=>{
    const f=await fixture(child);await f.register();
    if(inactive)assert.equal((await f.call({action:'employeePushUnregister',installationId:install})).status,200);
    const raw=await Store.readRawStudio(f.db,'mobile-route-owner');
    const before=await Directory.hydrateDirectory({db:f.db,workspaceId:f.workspaceId,studio:raw.studio,catalog:true});
    const after={...before,roster:before.roster.filter(person=>person.id!==personId)};
    const prepared=await Directory.prepareDirectorySnapshotWrite({db:f.db,workspaceId:f.workspaceId,before,after,condition:{sql:'1=1',values:[]},token:crypto.randomUUID(),at:new Date().toISOString()});
    await f.db.batch(prepared.statements);
    const employee=f.sqlite.prepare("SELECT deleted,site_index FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=?").get(f.workspaceId,personId);
    assert.equal(employee.deleted,1);assert.equal(employee.site_index,null);
    const device=f.sqlite.prepare('SELECT site_index,active FROM workspace_push_devices WHERE installation_id=?').get(install);
    assert.equal(device.site_index,null);assert.equal(device.active,0);
    assert.equal((await f.call({action:'employeePushTest',installationId:install})).status,401);
  });
});

test('an inactive installation pruned then recreated cannot be disabled by an old receipt with an ABA version',async t=>{
  const f=await fixture(t);await f.register();const event=f.message('old-registration');await f.drain();
  const original=f.sqlite.prepare('SELECT binding_id,version FROM workspace_push_devices WHERE installation_id=?').get(install);
  await f.call({action:'employeePushUnregister',installationId:install});
  const second='88888888-8888-4888-8888-888888888888';
  assert.equal((await f.register(second,f.token,'ExpoPushToken[second-installation-address-012345]')).status,200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workspace_push_devices WHERE installation_id=?').get(install).n,0,'inactive cleanup really removed the original version counter');
  assert.equal((await f.register(install,f.token,'ExpoPushToken[recreated-installation-address-012345]')).status,200);
  const recreated=f.sqlite.prepare('SELECT binding_id,version FROM workspace_push_devices WHERE installation_id=?').get(install);
  assert.equal(recreated.version,original.version);assert.notEqual(recreated.binding_id,original.binding_id);
  await f.drain({now:Date.now()+16*minute(),requestProvider:async()=>Response.json({data:{'ticket-0':{status:'error',details:{error:'DeviceNotRegistered'}}}})});
  assert.equal(f.sqlite.prepare('SELECT active FROM workspace_push_devices WHERE installation_id=?').get(install).active,1);
  assert.equal((await f.call({action:'employeePushOpen',eventId:event.event_id,installationId:install})).status,404,'retired notification bindings do not silently reattach');
});
