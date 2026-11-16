import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyCloudWebhook} from './cloud-webhook-contract.mjs';
import {createCloudPageReader} from './cloud-api-reader.mjs';
const secret='test-only-secret-123456789012345';
const t=1794466000;
const payload={event:'message_created',account:{id:196799},inbox:{id:155865},
  id:123,source_id:'m_AAAAAAAATESTSOURCE',message_type:'outgoing',private:false,
  conversation:{id:1}};
function sign(obj=payload,at=t){
 const body=JSON.stringify(obj);
 return {body,headers:{'x-chatwoot-timestamp':String(at),
   'x-chatwoot-signature':'sha256='+createHmac('sha256',secret).update(at+'.'+body).digest('hex')}};
}
test('signed Cloud Page message is candidate only, never an ACK',()=>{
 const v=verifyCloudWebhook({...sign(),secret,nowMs:t*1000});
 assert.equal(v.kind,'candidate');assert.equal(v.cloudInboxId,155865);
 assert.equal(v.providerMid,payload.source_id);assert.equal(v.direction,'OUTBOUND');
});
test('reject changed payload under original signature',()=>{
 const v=sign();assert.throws(()=>verifyCloudWebhook({...v,body:v.body.replace('outgoing','incoming'),secret,nowMs:t*1000}),/SIGNATURE_REJECTED/);
});
test('reject replay older than five minutes',()=>assert.throws(()=>
 verifyCloudWebhook({...sign(),secret,nowMs:(t+301)*1000}),/EXPIRED/));
test('ignore another signed Cloud inbox, reject other Cloud account',()=>{
 const otherInbox=verifyCloudWebhook({...sign({...payload,inbox:{id:1}}),secret,nowMs:t*1000});
 assert.equal(otherInbox.kind,'ignore');assert.equal(otherInbox.reason,'NOT_PAGE_INBOX');
 assert.throws(()=>verifyCloudWebhook({...sign({...payload,account:{id:1}}),secret,nowMs:t*1000}),/ACCOUNT_REJECTED/);
});
test('ignore private note',()=>assert.equal(verifyCloudWebhook({...sign({...payload,private:true}),secret,nowMs:t*1000}).kind,'ignore'));
test('API reader cannot access other paths',async()=>{const r=createCloudPageReader({fetchImpl:async()=>{throw Error('NO_NETWORK')}});assert.throws(()=>r.readConversation(-2),/CLOUD_ID_INVALID/);});

test('signed Chatwoot Cloud private note without provider MID is ignored safely',()=>{
 const p={...payload,private:true,source_id:null};
 const result=verifyCloudWebhook({...sign(p),secret,nowMs:t*1000});
 assert.equal(result.kind,'ignore');assert.equal(result.reason,'PRIVATE_NOTE');
});

test('signed Page outgoing without a Meta MID is ignored without falsely declaring send success',()=>{
 for(const event of ['message_created','message_updated']){
  const p={...payload,event,source_id:null,status:'failed'};
  const result=verifyCloudWebhook({...sign(p),secret,nowMs:t*1000});
  assert.deepEqual(result,{kind:'ignore',reason:'PAGE_OUTBOUND_PENDING_PROVIDER_MID'});
 }
});
test('missing Meta MID remains a hard rejection for signed Page inbound',()=>{
 for(const source_id of [null,'', 'short']){
  const p={...payload,source_id,message_type:'incoming'};
  assert.throws(()=>verifyCloudWebhook({...sign(p),secret,nowMs:t*1000}),
    /CLOUD_MESSAGE_ID_OR_MID_INVALID/);
 }
});
test('Page missing-MID notification never bypasses signature or exact Cloud account scope',()=>{
 const p={...payload,source_id:null};
 const v=sign(p);
 assert.throws(()=>verifyCloudWebhook({...v,body:v.body.replace('outgoing','incoming'),secret,nowMs:t*1000}),
  /CLOUD_WEBHOOK_SIGNATURE_REJECTED/);
 assert.throws(()=>verifyCloudWebhook({...sign({...p,account:{id:42}}),secret,nowMs:t*1000}),
  /CLOUD_WEBHOOK_ACCOUNT_REJECTED/);
});

test('YEN-10: signed Cloud Page Meta 551 is classified as provider refusal, not a Bridge retryable send',()=>{
 const p={...payload,source_id:null,status:'failed',
   content_attributes:{external_error:'(#551) unavailable'}};
 const result=verifyCloudWebhook({...sign(p),secret,nowMs:t*1000});
 assert.deepEqual(result,{kind:'ignore',reason:'PAGE_META_551_RECIPIENT_UNAVAILABLE'});
 const pending={...p,status:'sent'};
 assert.equal(verifyCloudWebhook({...sign(pending),secret,nowMs:t*1000}).reason,
   'PAGE_OUTBOUND_PENDING_PROVIDER_MID');
});
