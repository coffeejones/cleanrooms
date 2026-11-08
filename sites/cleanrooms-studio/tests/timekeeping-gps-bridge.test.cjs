const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const fix={latitude:55.61,longitude:12.1,accuracyMeters:13,timestamp:1793865600123};
const start={operation:'start',shiftId:'assigned-shift',personId:'assigned-person',version:0};
const reply=(status,error)=>({status,ok:status===200,json:async()=>error?{error}:{entry:{id:'time-entry'}}});

async function bridge(fetchResult,getPosition){
  const source=fs.readFileSync(new URL('../app/storage-bridge/route.ts',`file://${__filename}`),'utf8');
  const code=require('esbuild').transformSync(source,{loader:'ts',format:'cjs',target:'es2022'}).code;
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,Response});
  const html=await module.exports.GET().text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const calls=[],messages=[],parent={};let connected,handler,positionRequests=0;
  vm.runInNewContext(script,{parent,location:{origin:'https://cleanrooms.example'},AbortController,setTimeout,clearTimeout,
    addEventListener:(event,callback)=>{connected=callback;},navigator:{geolocation:{getCurrentPosition:(success,fail,options)=>{
      positionRequests++;assert.equal(options.maximumAge,0);getPosition(success,fail);
    }}},fetch:async(url,options)=>{
      assert.equal(url,'/api/accounts');assert.equal(options.credentials,'same-origin');
      const body=JSON.parse(options.body);calls.push(body);return fetchResult(body);
    }});
  connected({source:parent,origin:'https://cleanrooms.example',data:{type:'cleanrooms-storage-connect'},ports:[{
    addEventListener:(event,callback)=>{handler=callback;},postMessage:message=>messages.push(message),start(){}
  }]});
  return {calls,messages,get requests(){return positionRequests;},send:(payload,id=1)=>handler({data:{id,action:'account',operation:'timeWrite',payload}})};
}

test('a GPS challenge sends a fresh browser fix once and never passes it into the sandbox',async()=>{
  const client=await bridge(body=>body.location?reply(200):reply(400,'time_location_required'),
    success=>success({coords:{latitude:fix.latitude,longitude:fix.longitude,accuracy:fix.accuracyMeters},timestamp:fix.timestamp}));
  await client.send({...start,demo:true,location:{latitude:0,longitude:0}});
  assert.deepEqual(client.calls,[{...start,demo:true,action:'timeWrite'},{...start,demo:true,action:'timeWrite',location:fix}]);
  assert.equal(client.requests,1);
  assert.equal(client.messages.at(-1).ok,true);
  assert.equal(JSON.stringify(client.messages).includes('latitude'),false);
});

test('regular clock-ins, finishes, and denied GPS access do not transmit a location',async()=>{
  const noGps=await bridge(()=>reply(200),()=>assert.fail('Location should not be requested'));
  await noGps.send(start);await noGps.send({...start,demo:true,location:fix},2);assert.equal(noGps.requests,0);
  assert.equal(noGps.calls.some(body=>body.location),false);
  const denied=await bridge(()=>reply(400,'time_location_required'),(success,fail)=>fail({code:1}));
  await denied.send({...start,operation:'finish'});
  assert.equal(denied.requests,0);
  await denied.send(start,3);
  assert.equal(denied.requests,1);
  assert.equal(denied.calls.length,2);
  assert.equal(denied.calls.some(body=>body.location),false);
  assert.equal(denied.messages.at(-1).error,'time_location_denied');
  assert.match(denied.messages.at(-1).message,/Tillad placering/);
});
