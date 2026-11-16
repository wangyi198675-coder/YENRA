import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer} from '../src/server.mjs';
test('API Channel callback is fail closed, verified request not silently sent',async()=>{
 let count=0;
 const {server}=createBridgeServer({outbound:{handle:async()=>({ok:false})},
 logger:{warn(){},info(){},error(){}},cloudApiCallback:async()=>{count++;return{kind:'blocked'}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const path='http://127.0.0.1:'+server.address().port+'/yenra-cloud-api-channel/callback';
 try{
  const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'CLOUD_SENDER_CUTOVER_PENDING');
  assert.equal(count,1);
  const f=await fetch(path);assert.equal(f.status,405);
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});


test('Cloud API unknown-no-retry claim is HTTP 503, never a false sent response',async()=>{
 const {server}=createBridgeServer({outbound:{handle:async()=>({ok:false})},
  logger:{warn(){},info(){},error(){}},
  cloudApiCallback:async()=>({kind:'ignored'}),
  cloudApiSenderHandler:async()=>({kind:'unknown-no-retry'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/yenra-cloud-api-channel/callback',
   {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{ok:false,code:'CLOUD_WA_SEND_UNKNOWN_NO_RETRY'});
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});

test('verified persisted submission callback never advertises platform delivery',async()=>{
 const {server}=createBridgeServer({outbound:{handle:async()=>({ok:false})},
  logger:{warn(){},info(){},error(){}},
  cloudApiCallback:async()=>({kind:'ignored'}),
  cloudApiSenderHandler:async()=>({kind:'submitted-unconfirmed'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/yenra-cloud-api-channel/callback',
   {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,kind:'submitted-unconfirmed',delivered:false,
    willRetryAutomatically:false});
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});

test('original WhatsApp transport submitted without MID: HTTP 200 is NOT delivery and no retry',async()=>{
 const {server}=createBridgeServer({outbound:{handle:async()=>({ok:false})},
  logger:{warn(){},info(){},error(){}},
  cloudApiCallback:async()=>({kind:'ignored'}),
  cloudApiSenderHandler:async()=>({kind:'submitted-mid-pending'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/yenra-cloud-api-channel/callback',
   {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,kind:'submitted-mid-pending',
   delivered:false,providerMidVerified:false,willRetryAutomatically:false});
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});
