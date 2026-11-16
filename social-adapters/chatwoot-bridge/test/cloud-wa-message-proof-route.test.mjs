import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer} from '../src/server.mjs';

test('WA message proof route is owner-only, never a Sender, and fail closed',async()=>{
 let proofs=0, platformSends=0;
 const {server}=createBridgeServer({
  outbound:{handle:async()=>{platformSends++;return{status:503,body:{ok:false}}}},
  logger:{warn:()=>{},error:()=>{}},
  verifyCloudWaReaction:async p=>{
   proofs++;
   return {ok:true,selection:{
    channel:'WhatsApp',cloudConversationId:p.conversationId,
    cloudMessageId:p.messageId,emoji:p.emoji,cloudInboxId:155901,
    accountRef:'a'.repeat(32),roomRef:'b'.repeat(32),
    originalMid:'real-verified-id',direction:'INBOUND'
   }};
  }
 });
 try {
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const url='http://127.0.0.1:'+server.address().port+'/yenra-cloud/verify-wa-reaction';
  const request={accountId:196799,conversationId:9,messageId:91,emoji:'👍'};
  const send=async(body,headers={})=>{
    const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},
      body:JSON.stringify(body)});
    return {status:res.status,json:await res.json()};
  };
  const missing=await send(request);
  assert.equal(missing.status,403);
  assert.equal(proofs,0);
  const headers={'x-yenra-original-dsh-cloud-reaction':'1'};
  const forged=await send({...request,emoji:'😈'},headers);
  assert.equal(forged.status,400);assert.equal(proofs,0);
  const changed=await send({...request,conversationId:0},headers);
  assert.equal(changed.status,400);assert.equal(proofs,0);
  const good=await send(request,headers);
  assert.equal(good.status,200);assert.equal(good.json.ok,true);
  assert.equal(good.json.selection.originalMid,'real-verified-id');
  assert.equal(proofs,1);
  assert.equal(platformSends,0);
 }finally{
  await new Promise(resolve=>server.close(resolve));
 }
});
