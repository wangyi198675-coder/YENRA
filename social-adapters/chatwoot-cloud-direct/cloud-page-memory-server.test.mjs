import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createBridgeServer} from '../chatwoot-bridge/src/server.mjs';
const ref='a'.repeat(32),room='b'.repeat(32),hash='c'.repeat(64);
const body=JSON.stringify({accountRef:ref,roomRef:room,pageIdentityHash:hash});
function harness(proof){
 let count=0;
 const bridge=createBridgeServer({outbound:{handle:async()=>({ok:true})},
   logger:{warn(){},info(){},error(){}},
   verifyCloudPageMemory:async args=>{++count;return proof(args)}});
 return {bridge,calls:()=>count};
}
async function request(bridge,{payload=body,headers={},method='POST',remoteAddress='127.0.0.1'}={}){
 const req=Readable.from([payload]);
 req.url='/yenra-cloud/memory-verify';req.method=method;req.socket={remoteAddress};
 req.headers={'content-type':'application/json','x-yenra-original-dsh-cloud-memory':'1',...headers};
 const res={status:0,data:null,setHeader(){},writeHead(status){this.status=status},end(data){this.data=JSON.parse(data)}};
 await bridge.handleRequest(req,res);
 return res;
}
test('native verified Page memory is routed to the one Cloud Bridge authority',async()=>{
 const h=harness(async x=>JSON.stringify(x)===body?{ok:true}:{ok:false});
 const v=await request(h.bridge);
 assert.equal(v.status,200);assert.deepEqual(v.data,{ok:true});assert.equal(h.calls(),1);
});
test('local process without Host proof header or wrong network cannot query memory',async()=>{
 const h=harness(async()=>({ok:true}));
 assert.equal((await request(h.bridge,{headers:{'x-yenra-original-dsh-cloud-memory':'0'}})).status,403);
 assert.equal((await request(h.bridge,{headers:{origin:'http://127.0.0.1:31917'}})).status,403);
 assert.equal((await request(h.bridge,{remoteAddress:'192.0.2.1'})).status,403);
 assert.equal(h.calls(),0);
});
test('invalid scoped fields and mismatched identity fail closed',async()=>{
 const h=harness(async()=>({ok:false}));
 assert.equal((await request(h.bridge,{payload:JSON.stringify({accountRef:ref,roomRef:room,pageIdentityHash:'wrong'})})).status,400);
 assert.equal((await request(h.bridge,{payload:JSON.stringify({accountRef:ref,roomRef:room,pageIdentityHash:hash,extra:1})})).status,400);
 assert.equal((await request(h.bridge)).status,409);
 assert.equal(h.calls(),1);
});
