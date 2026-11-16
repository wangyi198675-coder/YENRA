import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer} from '../src/server.mjs';
test('Cloud endpoint uses only one existing Bridge HTTP handler and rejects invalid methods',async()=>{
 const delivered=[];
 const {server}=createBridgeServer({
  outbound:{handle:async()=>({ok:true})},
  logger:{warn(){},info(){},error(){}},health:()=>({ok:true}),
  cloudPageWebhook:async({rawBody,headers})=>{delivered.push({rawBody,headers});return {kind:'accepted',deliveredToNative:false}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/yenra-cloud-page/webhook';
 try{
  const fail=await fetch(base,{method:'GET'});
  assert.equal(fail.status,405);
  const bad=await fetch(base,{method:'POST',body:'x',headers:{'content-type':'text/plain'}});
  assert.equal(bad.status,415);
  const ok=await fetch(base,{method:'POST',body:'{"event":"message_created"}',headers:{'content-type':'application/json'}});
  // 200 acknowledges an accepted, already-persisted Cloud webhook, NOT platform delivery.
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).nativeWritten,false);
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].rawBody,'{"event":"message_created"}');
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});
