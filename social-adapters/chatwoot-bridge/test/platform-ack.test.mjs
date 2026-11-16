import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformAckHandler, validateVerifiedAck } from '../src/platform-ack.mjs';
import { stableContactIdentifier } from '../src/contract.mjs';

const accountRef = 'a'.repeat(32), roomRef = 'b'.repeat(32);
const identifier = stableContactIdentifier(accountRef, roomRef);
const mkAck = (overrides = {}) => ({
  channel: 'WhatsApp', accountRef, roomRef, mid: 'wamid.test_123',
  ackKind: 'READ', providerAccepted: true, providerDelivered: true,
  providerRead: true, ...overrides,
});
function harness({ binding = true, otherInbox = false, status = 'sent', duplicate = false, history = false } = {}) {
  const patches = [];
  const index = { byIdentifier: new Map([[identifier,
    { channel: 'WhatsApp', accountRef, roomRef, inboxId: 3 }]]) };
  const chatwoot = {
    async findContactByIdentifier(v) { assert.equal(v, identifier); return { id: 90 }; },
    async listContactConversations() { return [{ id: 19, display_id: 44, inbox_id: otherInbox ? 4 : 3 }]; },
    async listConversationMessages() {
      const msg = { id: 98, message_type: 'outgoing', private: false, status,
        content_attributes: { yenra_verified_outbound_provider_mid: binding ? 'wamid.test_123' : undefined,
          ...(history ? { yenra_history_import: true } : {}) } };
      return duplicate ? [msg, { ...msg, id: 99 }] : [msg];
    },
    async updateMessageStatus(conv, id, to) { patches.push([conv, id, to]); },
  };
  const logger = { warn() {} };
  return { patches, index, chatwoot, logger };
}
test('verified ACK rejects unsupported Page and absent provider proofs', () => {
  assert.equal(validateVerifiedAck(mkAck({ channel: 'Page' })), 'ACK_CHANNEL_UNSUPPORTED');
  assert.equal(validateVerifiedAck(mkAck({ providerRead: false })), 'ACK_READ_PROOF_MISSING');
  assert.equal(validateVerifiedAck(mkAck({ providerDelivered: false })), 'ACK_PROVIDER_PROOF_MISSING');
  assert.equal(validateVerifiedAck(mkAck({ ackKind: 'DELIVERED', providerRead: false })), null);
});
test('durable original MID plus exact account/inbox permits native status PATCH', async () => {
  const h = harness(), ack = createPlatformAckHandler(h);
  assert.deepEqual(await ack.handle(mkAck()), { ok: true, updated: true, status: 'read' });
  assert.deepEqual(h.patches, [[44, 98, 'read']]);
});
test('replayed ACK is already applied; never patches again', async () => {
  const h = harness({ status: 'read' });
  assert.equal((await createPlatformAckHandler(h).handle(mkAck())).duplicate, true);
  assert.equal(h.patches.length, 0);
});
test('no verified durable MID means NO status guess/write', async () => {
  const h = harness({ binding: false });
  assert.equal((await createPlatformAckHandler(h).handle(mkAck())).code, 'ACK_DURABLE_MID_BINDING_NOT_FOUND');
  assert.equal(h.patches.length, 0);
});
test('wrong account, inbox, ambiguous MID, historical outgoing all fail closed', async () => {
  const cases = [
    [harness(), mkAck({ accountRef: 'c'.repeat(32) }), 'ACK_SCOPE_NOT_IN_ROSTER'],
    [harness({ otherInbox: true }), mkAck(), 'ACK_DURABLE_MID_BINDING_NOT_FOUND'],
    [harness({ duplicate: true }), mkAck(), 'ACK_DURABLE_MID_BINDING_AMBIGUOUS'],
    [harness({ history: true }), mkAck(), 'ACK_DURABLE_MID_BINDING_NOT_FOUND'],
  ];
  for (const [h, a, expected] of cases) {
    assert.equal((await createPlatformAckHandler(h).handle(a)).code, expected);
    assert.equal(h.patches.length, 0);
  }
});
test('Personal only accepts verified read with native Matrix MID', () => {
  assert.equal(validateVerifiedAck(mkAck({ channel: 'Personal', mid: 'wamid.bad' })), 'ACK_PERSONAL_MID_INVALID');
  assert.equal(validateVerifiedAck(mkAck({ channel: 'Personal', mid: '$good', ackKind: 'DELIVERED' })), 'ACK_PERSONAL_ONLY_READ');
  assert.equal(validateVerifiedAck(mkAck({ channel: 'Personal', mid: '$good', ackKind: 'READ' })), null);
});

test('inbound routes verified named ACK to one handler and drain waits for it', async () => {
  const { createInboundBridge } = await import('../src/inbound.mjs');
  let resolveAck;
  const awaited = new Promise(resolve => { resolveAck = resolve; });
  const bridge = createInboundBridge({
    chatwoot: {}, mapping: new Map(), logger: { warn() {}, info() {} },
    ackHandler: { async handle(ack) {
      assert.equal(ack.accountRef, accountRef);
      assert.equal(ack.ackKind, 'READ');
      await awaited;
      return { ok: true, updated: true };
    } },
  });
  const result = bridge.handleFrame({
    event: 'delivery-ack', data: JSON.stringify(mkAck()),
  });
  assert.deepEqual(result, { kind: 'ack', acted: true });
  let drained = false;
  const waiting = bridge.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  resolveAck();
  await waiting;
  assert.equal(bridge.stats.acksSeen, 1);
  assert.equal(bridge.stats.acksUpdated, 1);
});
test('ACK without authorized handler remains explicitly unwired', async () => {
  const { createInboundBridge } = await import('../src/inbound.mjs');
  const bridge = createInboundBridge({
    chatwoot: {}, mapping: new Map(), logger: { warn() {}, info() {} },
  });
  const result = bridge.handleFrame({ event: 'delivery-ack', data: JSON.stringify(mkAck()) });
  assert.equal(result.acted, false);
  assert.equal(bridge.stats.byReason.ACK_NOT_WIRED, 1);
});

test('verified WhatsApp ACK upgrades a committed provisional MID via native PG endpoint',async()=>{
  const h=harness({binding:false});
  h.chatwoot.listConversationMessages=async()=>[{
    id:98,message_type:'outgoing',private:false,source_id:null,status:'sent',
    content_attributes:{
      yenra_send_claim:{claim_id:'33333333-3333-4333-8333-333333333333'},
      yenra_outbound_provider_mid:'wamid.test_123',
    },
  }];
  const calls=[];
  const nativeDelivery={
    async writeVerifiedAck({plan,scope,ack}) {
      calls.push({plan,scope,ack});
      return {updated:true,status:'read'};
    }
  };
  const result=await createPlatformAckHandler({...h,nativeDelivery}).handle(mkAck());
  assert.deepEqual(result,{ok:true,updated:true,status:'read'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].plan.chatwootMessageId,98);
  assert.equal(calls[0].plan.chatwootConversationId,44);
  assert.equal(calls[0].plan.inboxId,3);
  assert.equal(calls[0].plan.identifier,identifier);
  assert.deepEqual(h.patches,[]);
});

test('provisional MID without native-claim metadata is NEVER a verified ACK binding',async()=>{
  const h=harness({binding:false});
  h.chatwoot.listConversationMessages=async()=>[{
    id:98,message_type:'outgoing',private:false,source_id:null,status:'sent',
    content_attributes:{yenra_outbound_provider_mid:'wamid.test_123'},
  }];
  const nativeDelivery={async writeVerifiedAck(){throw Error('must not be called')}};
  const result=await createPlatformAckHandler({...h,nativeDelivery}).handle(mkAck());
  assert.equal(result.code,'ACK_DURABLE_MID_BINDING_NOT_FOUND');
  assert.equal(h.patches.length,0);
});

test('ACK resolves native MID through complete PostgreSQL history, not latest-message page',async()=>{
 const h=harness({binding:false,status:'sent'});
 h.chatwoot.findContactByIdentifier=async()=>{throw Error('old recent screen must not run')};
 h.chatwoot.listConversationMessages=async()=>{throw Error('old recent screen must not run')};
 const writes=[];
 const nativeDelivery={
   async lookupAckTarget({identifier:found,inboxId,mid}) {
     assert.equal(found,identifier);assert.equal(inboxId,3);assert.equal(mid,'wamid.test_123');
     return {ok:true,chatwootMessageId:98,conversationDisplayId:44,
       inboxId:3,identifier,status:'sent',verifiedBinding:false};
   },
   async writeVerifiedAck(input) {writes.push(input);return{updated:true,status:'read'};}
 };
 const result=await createPlatformAckHandler({...h,nativeDelivery}).handle(mkAck());
 assert.equal(result.updated,true);
 assert.equal(writes.length,1);
 assert.equal(writes[0].plan.chatwootMessageId,98);
});
test('native MID discovery refuses missing ACK without guessing from message time or text',async()=>{
 const h=harness();
 const nativeDelivery={async lookupAckTarget(){return{ok:false,code:'ACK_DURABLE_MID_BINDING_NOT_FOUND'}},
   async writeVerifiedAck(){throw Error('must not be called')}};
 assert.equal((await createPlatformAckHandler({...h,nativeDelivery}).handle(mkAck())).code,
   'ACK_DURABLE_MID_BINDING_NOT_FOUND');
 assert.equal(h.patches.length,0);
});
