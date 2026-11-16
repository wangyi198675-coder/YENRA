import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createBridgeServer} from '../chatwoot-bridge/src/server.mjs';
const accountRef='a'.repeat(32),roomRef='b'.repeat(32),cloudIdentityHash='c'.repeat(64);
const expectedInboxId=155900;
const body=JSON.stringify({accountRef,roomRef,cloudIdentityHash,expectedInboxId});
function harness(verify=async()=>true){
 let count=0;
 const server=createBridgeServer({outbound:{handle:async()=>({ok:true})},
  logger:{warn(){},info(){},error(){}},
  verifyCloudRemotePersonalMemory:async args=>{count++;return verify(args)}});
 return {server,count:()=>count};
}
async function request(server,{payload=body,headers={},remoteAddress='127.0.0.1',method='POST'}={}){
 const req=Readable.from([payload]);
 req.url='/yenra-cloud/remote-personal-memory-verify';
 req.method=method;req.socket={remoteAddress};
 req.headers={'content-type':'application/json','x-yenra-original-dsh-cloud-memory':'1',...headers};
 const result={status:0,data:null,setHeader(){},writeHead(status){this.status=status},end(x){this.data=JSON.parse(x)}};
 await server.handleRequest(req,result);
 return result;
}
test('official DSH Personal memory proof is read-only',async()=>{
 const h=harness(async args=>JSON.stringify(args)===body);
 const r=await request(h.server);
 assert.equal(r.status,200);assert.deepEqual(r.data,{ok:true});assert.equal(h.count(),1);
});
test('untrusted network, origin, missing Host capability are rejected',async()=>{
 const h=harness();
 for(const opt of [
  {remoteAddress:'203.0.113.7'},{headers:{origin:'https://untrusted.example'}},
  {headers:{'x-yenra-original-dsh-cloud-memory':'0'}},{method:'GET'}
 ])assert.notEqual((await request(h.server,opt)).status,200);
 assert.equal(h.count(),0);
});
test('wrong inbox, extra body fields, switched contact identity fail closed',async()=>{
 const h=harness(async()=>false);
 for(const v of [
  {accountRef,roomRef,cloudIdentityHash,expectedInboxId:155901},
  {accountRef,roomRef,cloudIdentityHash:'0',expectedInboxId},
  {accountRef,roomRef,cloudIdentityHash,expectedInboxId,extra:true}
 ])assert.equal((await request(h.server,{payload:JSON.stringify(v)})).status,400);
 const refused=await request(h.server);
 assert.equal(refused.status,409);assert.equal(h.count(),1);
});
