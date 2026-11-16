import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeDeliveryAuthority } from '../src/native-delivery.mjs';

const identifier='yenra-'+'a'.repeat(40);
const scope={inboxId:3};
const plan={inboxId:3,identifier,chatwootMessageId:190,
  chatwootConversationId:55};
const claimId='33333333-3333-4333-8333-333333333333';
const receipt={providerMessageId:'wamid.synthetic',platformAccepted:false,transportAccepted:true};
const verifiedAck={mid:'wamid.synthetic',ackKind:'READ',providerAccepted:true,
  providerDelivered:true,providerRead:true};

function fakeNativeClient(handler) {
  const calls=[];
  const chatwoot={apiBase:'/api/v1/accounts/1',
    async request(method,path,body) {
      calls.push({method,path,body});
      return handler({method,path,body});
    }};
  return {calls,delivery:createNativeDeliveryAuthority({chatwoot})};
}

test('native claim, receipt and verified ACK use only the exact scoped Chatwoot API',async()=>{
  const {calls,delivery}=fakeNativeClient(({path})=>
    path.endsWith('_claim') ? {ok:true,claimed:true,claim_id:claimId} :
      path.endsWith('_receipt') ? {ok:true,bound:true,platform_accepted:false} :
        {ok:true,applied:true,verified_mid_persisted:true,status:'read'});
  const result=await delivery.claim({plan,scope});
  assert.deepEqual(result,{claimed:true,claimId});
  await delivery.recordReceipt({plan,scope,claimId,receipt});
  await delivery.writeVerifiedAck({plan,scope,ack:verifiedAck});
  assert.equal(calls.length,3);
  assert.equal(calls.every(c=>c.method==='POST'),true);
  assert.equal(calls[0].path,'/api/v1/accounts/1/conversations/55/yenra_delivery_claim');
  assert.deepEqual(calls[0].body,{inbox_id:3,message_id:190,identifier});
  assert.equal(calls[1].body.provider_mid,'wamid.synthetic');
  assert.equal(calls[1].body.transport_accepted,true);
  assert.equal(calls[1].body.platform_accepted,false);
  assert.equal(calls[2].body.provider_read,true);
});

test('native claim HTTP 409 is a duplicate, not a new Send authorization',async()=>{
  const {delivery}=fakeNativeClient(()=>{throw Object.assign(Error('conflict'),{code:'CHATWOOT_HTTP_409'})});
  assert.deepEqual(await delivery.claim({plan,scope}),{claimed:false,reason:'ALREADY_CLAIMED'});
});

test('unknown native claim result and missing receipt proof always fail closed',async()=>{
  const {delivery}=fakeNativeClient(()=>({ok:true,claimed:false}));
  await assert.rejects(delivery.claim({plan,scope}),{code:'NATIVE_CLAIM_UNCONFIRMED'});
  await assert.rejects(delivery.recordReceipt({plan,scope,claimId,
    receipt:{providerMessageId:'wamid.synthetic',platformAccepted:false,transportAccepted:false}}),
    {code:'NATIVE_RECEIPT_PROOF_MISSING'});
});

test('cross-inbox request and unverified ACK never reach native POST',async()=>{
  const {calls,delivery}=fakeNativeClient(()=>({ok:true,claimed:true,claim_id:claimId}));
  await assert.rejects(delivery.claim({plan:{...plan,inboxId:4},scope}),{code:'NATIVE_CLAIM_INBOX_MISMATCH'});
  await assert.rejects(delivery.writeVerifiedAck({plan,scope,ack:{...verifiedAck,providerRead:false}}),
    {code:'NATIVE_ACK_UNVERIFIED'});
  assert.equal(calls.length,0);
});

test('native PG lookup resolves committed original MID without any recent-screen page',async()=>{
  const {calls,delivery}=fakeNativeClient(()=>({
    ok:true,message_id:190,conversation_display_id:55,inbox_id:3,
    status:'sent',verified_binding:false,
  }));
  const found=await delivery.lookupAckTarget({identifier,inboxId:3,mid:'wamid.qa.old'});
  assert.equal(found.ok,true);
  assert.equal(found.chatwootMessageId,190);
  assert.equal(found.conversationDisplayId,55);
  assert.equal(found.verifiedBinding,false);
  assert.deepEqual(calls[0].body,{identifier,inbox_id:3,provider_mid:'wamid.qa.old'});
  assert.equal(calls[0].path,'/api/v1/accounts/1/yenra_delivery_mid_target');
});
test('native PG lookup fails closed for missing, ambiguous and cross-inbox MIDs',async()=>{
  for (const [httpCode,expected] of [[404,'ACK_DURABLE_MID_BINDING_NOT_FOUND'],
    [409,'ACK_DURABLE_MID_BINDING_AMBIGUOUS']]) {
    const {delivery}=fakeNativeClient(()=>{throw Object.assign(Error('native'),{code:`CHATWOOT_HTTP_${httpCode}`})});
    const result=await delivery.lookupAckTarget({identifier,inboxId:3,mid:'wamid.qa.old'});
    assert.equal(result.code,expected);
  }
  const {calls,delivery}=fakeNativeClient(()=>({ok:true,message_id:190,
    conversation_display_id:55,inbox_id:4,status:'sent',verified_binding:false}));
  await assert.rejects(delivery.lookupAckTarget({identifier,inboxId:3,mid:'wamid.qa.old'}),
    {code:'NATIVE_ACK_LOOKUP_RESPONSE_INVALID'});
  assert.equal(calls.length,1);
});
