import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createBridgeServer} from '../chatwoot-bridge/src/server.mjs';
const accountRef='a'.repeat(32),roomRef='b'.repeat(32),cloudIdentityHash='c'.repeat(64),expectedInboxId=190001;
const body=JSON.stringify({accountRef,roomRef,cloudIdentityHash,expectedInboxId});
function harness(verify=()=>true){
 let count=0;
 const server=createBridgeServer({outbound:{handle:async()=>({ok:true})},
  logger:{warn(){},info(){},error(){}},
  verifyCloudRemoteWaMemory:async args=>{count++;return verify(args)}});
 return {server,count:()=>count};
}
async function request(server,{payload=body,headers={},remoteAddress='127.0.0.1',method='POST'}={}){
 const req=Readable.from([payload]);
 req.url='/yenra-cloud/remote-wa-memory-verify';req.method=method;req.socket={remoteAddress};
 req.headers={'content-type':'application/json','x-yenra-original-dsh-cloud-memory':'1',...headers};
 const resp={status:0,data:null,setHeader(){},writeHead(status){this.status=status},end(x){this.data=JSON.parse(x)}};
 await server.handleRequest(req,resp);
 return resp;
}
test('original DSH MemoryService proof uses Cloud authority but no Sender',async()=>{
 const h=harness(args=>JSON.stringify(args)===body);
 const res=await request(h.server);
 assert.equal(res.status,200);assert.deepEqual(res.data,{ok:true});assert.equal(h.count(),1);
});
test('no same-host trusted caller proof no access',async()=>{
 const h=harness();
 for(const x of [
  {remoteAddress:'192.0.2.7'},
  {headers:{origin:'http://127.0.0.1:31917'}},
  {headers:{'x-yenra-original-dsh-cloud-memory':'0'}},
  {method:'GET'},
 ]){
  assert.notEqual((await request(h.server,x)).status,200);
 }
 assert.equal(h.count(),0);
});
test('wrong Inbox, swapped Cloud identity or extra fields fail before proof',async()=>{
 const h=harness(()=>false);
 for(const data of [
  {accountRef,roomRef,cloudIdentityHash,expectedInboxId:-1},
  {accountRef,roomRef,cloudIdentityHash:'f',expectedInboxId},
  {accountRef,roomRef,cloudIdentityHash,expectedInboxId,token:'forbidden'},
 ]){
  assert.equal((await request(h.server,{payload:JSON.stringify(data)})).status,400);
 }
 assert.equal((await request(h.server)).status,409);
 assert.equal(h.count(),1);
});
