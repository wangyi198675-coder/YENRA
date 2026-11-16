import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer} from '../src/server.mjs';
test('Cloud selection verifies in original Bridge and cannot be forged by browser URL',async()=>{
 let calls=0;
 const {server}=createBridgeServer({
  outbound:{handle:async()=>({ok:false})},
  logger:{info(){},warn(){},error(){}},
  resolveCloudSelection:async({conversationId})=>{calls++;return {ok:true,selection:{cloudConversationId:conversationId,channel:'WhatsApp'}}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/yenra-cloud/resolve';
 try {
  const invalid=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{"accountId":196799,"conversationId":8}'});
  assert.equal(invalid.status,403);
  const response=await fetch(url,{method:'POST',
   headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-selection':'1'},
   body:'{"accountId":196799,"conversationId":8}'});
  assert.equal(response.status,200);assert.equal((await response.json()).selection.cloudConversationId,8);assert.equal(calls,1);
  const other=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-selection':'1'},
   body:'{"accountId":1,"conversationId":8}'});
  assert.equal(other.status,400);assert.equal(calls,1);
 } finally {await new Promise((res,rej)=>server.close(e=>e?rej(e):res()))}
});
