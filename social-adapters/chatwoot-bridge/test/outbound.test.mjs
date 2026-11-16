import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterIndex, resolveInboxMap } from '../src/inbox-map.mjs';
import { createOutboundHandler } from '../src/outbound.mjs';
import { createHostSender, SenderGateError } from '../src/sender-gate.mjs';
import { silentLogger } from '../src/logger.mjs';
import { stableContactIdentifier } from '../src/contract.mjs';
import {
  API_INBOXES,
  FAKE_SECRET,
  FAKE_SESSION_ID,
  REF_A,
  REF_B,
  REF_D,
  REF_E,
  ROSTER,
  buildOutgoingWebhook,
  signWebhook,
} from './fixtures/synthetic.mjs';

const IDENTIFIER = stableContactIdentifier(REF_A, REF_B);
const WA_IDENTIFIER = stableContactIdentifier(REF_D, REF_E);

function fakeNativeDeliveryAuthority() {
  return {
    async claim() { return { claimed:true, claimId:'22222222-2222-4222-8222-222222222222' }; },
    async recordReceipt() { return { bound:true }; },
  };
}

async function setup({ sender = null, deliveryAuthority = fakeNativeDeliveryAuthority(),
  secrets = { default: FAKE_SECRET, byInbox: {} }, payload, host = null } = {}) {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  const index = buildRosterIndex(ROSTER, resolved.mapping);
  const outbound = createOutboundHandler({ sender, deliveryAuthority, host, index, logger: silentLogger,
    secrets, toleranceSeconds: 300, nowSeconds: () => 1700000700 });
  // Only the original DSH-IM WhatsApp route may use the enabled Sender.
  // Personal/Page remain represented by explicit rejection fixtures.
  const body = JSON.stringify(payload ?? (sender
    ? buildOutgoingWebhook({ identifier: WA_IDENTIFIER, inboxId: 3 })
    : buildOutgoingWebhook({ identifier: IDENTIFIER, inboxId: 2 })));
  const timestamp = '1700000700';
  const inboxId = JSON.parse(body).inbox?.id;
  const signingSecret = secrets.byInbox?.[inboxId] ?? secrets.default ?? 'unused';
  const headers = {
    'content-type': 'application/json',
    'x-chatwoot-timestamp': timestamp,
    'x-chatwoot-signature': signWebhook({ secret: signingSecret, timestamp, rawBody: body }),
  };
  return { outbound, body, timestamp, headers, index };
}

function createFakeSender({ throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async send(input) {
      calls.push(input);
      if (throws) throw throws;
      return {
        submitted: true,
        deliveryStatus: 'UNKNOWN',
        delivered: false,
        providerMessageId: 'wamid.synthetic.1',
        channel: input.channel,
        accountRef: input.accountRef,
        roomRef: input.roomRef,
      };
    },
  };
}

test('outbound returns non-2xx when disabled so Chatwoot marks local-only outgoing FAILED', async () => {
  const { outbound, body, headers } = await setup({ sender: null });
  const result = await outbound.handle({ rawBody: body, headers });
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.status, 'SKIPPED_REAL_SEND_DISABLED');
  assert.equal(result.body.realSendAttempted, false);
  assert.equal(result.body.delivered, false);
  assert.equal(result.body.plan.channel, 'Personal');
  assert.equal(result.body.plan.textLength, 'Synthetic reply text for tests only.'.length);
  assert.equal('text' in result.body.plan, false);
  assert.equal(JSON.stringify(result.body).includes('Synthetic reply text'), false);
});

test('outbound rejects a bad signature before any decision', async () => {
  const { outbound, body, headers } = await setup();
  const tampered = { ...headers, 'x-chatwoot-signature': 'sha256=deadbeef' };
  const result = await outbound.handle({ rawBody: body, headers: tampered });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'SIGNATURE_MISMATCH');
});

test('outbound uses a per-inbox secret when configured', async () => {
  const secrets = { default: 'wrong-default', byInbox: { 2: FAKE_SECRET } };
  const { outbound, body, headers } = await setup({ secrets });
  const result = await outbound.handle({ rawBody: body, headers });
  assert.equal(result.status, 409);
});

test('outbound ignores private notes, incoming messages and non-create events', async () => {
  let context = await setup({ payload: buildOutgoingWebhook({ identifier: IDENTIFIER, isPrivate: true }) });
  assert.equal((await context.outbound.handle({ rawBody: context.body, headers: context.headers })).body.reason, 'PRIVATE_NOTE');

  context = await setup({ payload: buildOutgoingWebhook({ identifier: IDENTIFIER, messageType: 'incoming' }) });
  assert.equal((await context.outbound.handle({ rawBody: context.body, headers: context.headers })).body.reason, 'NOT_OUTGOING');

  context = await setup({ payload: buildOutgoingWebhook({ identifier: IDENTIFIER, event: 'message_updated' }) });
  assert.equal((await context.outbound.handle({ rawBody: context.body, headers: context.headers })).body.reason, 'EVENT_NOT_MESSAGE_CREATED');
});

test('outbound fails closed for unknown identifiers and inbox scope mismatch', async () => {
  const unknown = await setup({ payload: buildOutgoingWebhook({ identifier: 'yenra-' + '9'.repeat(40) }) });
  const unknownResult = await unknown.outbound.handle({ rawBody: unknown.body, headers: unknown.headers });
  assert.equal(unknownResult.status, 409);
  assert.equal(unknownResult.body.error, 'UNKNOWN_CONTACT_IDENTIFIER');
  assert.equal(unknownResult.body.realSendAttempted, false);

  const mismatched = await setup({ payload: buildOutgoingWebhook({ identifier: IDENTIFIER, inboxId: 3 }) });
  const mismatchResult = await mismatched.outbound.handle({ rawBody: mismatched.body, headers: mismatched.headers });
  assert.equal(mismatchResult.status, 409);
  assert.equal(mismatchResult.body.error, 'INBOX_SCOPE_MISMATCH');
});

test('outbound with an enabled sender submits exactly once and collapses duplicate deliveries', async () => {
  const sender = createFakeSender();
  const { outbound, body, headers } = await setup({ sender });

  const first = await outbound.handle({ rawBody: body, headers });
  assert.equal(first.status, 200);
  assert.equal(first.body.submitted, true);
  assert.equal(first.body.deliveryStatus, 'UNKNOWN');
  assert.equal(first.body.delivered, false);
  assert.equal(first.body.willRetryAutomatically, false);

  const second = await outbound.handle({ rawBody: body, headers });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.submitted, true);
  assert.equal(second.body.delivered, false);
  assert.equal(second.body.deliveryStatus, 'UNKNOWN');
  assert.equal(sender.calls.length, 1);
  assert.deepEqual(sender.calls[0], {
    channel: 'WhatsApp',
    accountRef: REF_D,
    roomRef: REF_E,
    text: 'Synthetic reply text for tests only.',
  });
  assert.equal(outbound.correlations.size, 1);
});

test('original DSH-IM read binds the one fresh real MID when manual Sender receipt omits it', async () => {
  const text = 'Synthetic reply text for tests only.';
  let sent = false;
  const originalMid = '3EB0123456789ABCDEF0';
  const readCalls = [];
  const host = { async readRoom(scope) {
    readCalls.push(scope);
    return { accountRef: REF_D, roomRef: REF_E, messages: sent ? [{
      direction:'OUTBOUND', mid:originalMid, text, timestamp:Date.now(),
    }] : [] };
  } };
  const sender = { calls:[], async send(args) {
    this.calls.push(args); sent = true;
    return {submitted:true, delivered:false, deliveryStatus:'UNKNOWN',
      providerMessageId:null, platformAccepted:false,transportAccepted:true };
  } };
  const deliveryAuthority = {async claim(){ return {claimed:true,claimId:'22222222-2222-4222-8222-222222222222'}; },
    async recordReceipt({receipt}) {
      assert.equal(receipt.providerMessageId,originalMid);
      assert.equal(receipt.platformAccepted,false);
      assert.equal(receipt.transportAccepted,true);
      return {bound:true};
    }};
  const {outbound,body,headers} = await setup({host,sender,deliveryAuthority});
  const result=await outbound.handle({rawBody:body,headers});
  assert.equal(result.status,200);
  assert.equal(result.body.providerMessageId,originalMid);
  assert.equal(result.body.delivered,false);
  assert.equal(sender.calls.length,1);
  assert.equal(readCalls.length,2);
});

test('outbound never retries an unconfirmed send, even when the webhook is redelivered', async () => {
  const failure = Object.assign(new SenderGateError('HOST_SENDER_TIMEOUT_UNCONFIRMED'), { code: 'HOST_SENDER_TIMEOUT_UNCONFIRMED' });
  const sender = createFakeSender({ throws: failure });
  const { outbound, body, headers } = await setup({ sender });

  const first = await outbound.handle({ rawBody: body, headers });
  assert.equal(first.status, 409);
  assert.equal(first.body.status, 'UNKNOWN_NEEDS_MANUAL_RECONCILIATION');
  assert.equal(first.body.manualReviewRequired, true);
  assert.equal(first.body.willRetryAutomatically, false);
  assert.equal(first.body.submitted, false);

  const second = await outbound.handle({ rawBody: body, headers });
  assert.equal(second.status, 409);
  assert.equal(second.body.ok, false);
  assert.equal(second.body.status, 'UNKNOWN_NO_RETRY');
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.manualReviewRequired, true);
  assert.equal(sender.calls.length, 1);
});

test('createHostSender refuses to exist unless real send is explicitly enabled', () => {
  assert.throws(
    () => createHostSender({ baseUrl: 'http://127.0.0.1:60474', enabled: false, ownerSessionId: FAKE_SESSION_ID }),
    (error) => error.code === 'REAL_SEND_DISABLED_AT_CONSTRUCTION',
  );
  assert.throws(
    () => createHostSender({ baseUrl: 'http://127.0.0.1:60474', enabled: true, ownerSessionId: 'session-invalid' }),
    (error) => error.code === 'OWNER_SESSION_ID_INVALID',
  );
});

test('createHostSender posts only the documented route and body, and never fabricates delivery', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        receipt: {
          schema: 1,
          channel: 'WhatsApp',
          sent: true,
          submitted: true,
          deliveryStatus: 'UNKNOWN',
          delivered: false,
          providerMessageId: 'wamid.synthetic.2',
          accountRef: REF_A,
          roomRef: REF_B,
        },
      }),
    };
  };
  const sender = createHostSender({
    baseUrl: 'http://127.0.0.1:60474',
    enabled: true,
    ownerSessionId: FAKE_SESSION_ID,
    fetchImpl,
  });
  const receipt = await sender.send({ channel: 'WhatsApp', accountRef: REF_A, roomRef: REF_B, text: 'Synthetic.' });
  assert.equal(receipt.submitted, true);
  assert.equal(receipt.delivered, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].url, /\/api\/yenra\/social-text-send$/);
  const sentBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(sentBody).sort(), ['accountRef', 'channel', 'roomRef', 'sessionId', 'text']);
  assert.equal(sentBody.sessionId, FAKE_SESSION_ID);
});

test('createHostSender rejects a Host receipt that claims platform delivery', async () => {
  const sender = createHostSender({
    baseUrl: 'http://127.0.0.1:60474',
    enabled: true,
    ownerSessionId: FAKE_SESSION_ID,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, receipt: { sent: true, submitted: true, deliveryStatus: 'DELIVERED', delivered: true } }),
    }),
  });
  await assert.rejects(
    () => sender.send({ channel: 'Page', accountRef: REF_A, roomRef: REF_B, text: 'Synthetic.' }),
    (error) => error.code === 'HOST_SENDER_RECEIPT_SHAPE_UNEXPECTED',
  );
});

test('createHostSender fails closed on an unconfirmed HTTP error', async () => {
  const sender = createHostSender({
    baseUrl: 'http://127.0.0.1:60474',
    enabled: true,
    ownerSessionId: FAKE_SESSION_ID,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: 'x' }) }),
  });
  await assert.rejects(
    () => sender.send({ channel: 'Page', accountRef: REF_A, roomRef: REF_B, text: 'Synthetic.' }),
    (error) => error.code === 'HOST_SENDER_HTTP_400',
  );
});

test('Host scope mismatch is refused before any received MID is trusted', async () => {
  const sender = createHostSender({
    baseUrl: 'http://127.0.0.1:60474',
    enabled: true,
    ownerSessionId: FAKE_SESSION_ID,
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, receipt: {
        sent: true, submitted: true, deliveryStatus: 'UNKNOWN', delivered: false,
        channel: 'WhatsApp', accountRef: 'c'.repeat(32), roomRef: REF_B,
        providerMessageId: 'wamid.good',
      } }),
    }),
  });
  await assert.rejects(
    () => sender.send({ channel: 'WhatsApp', accountRef: REF_A, roomRef: REF_B, text: 'Test.' }),
    (error) => error.code === 'HOST_SENDER_RECEIPT_SCOPE_MISMATCH',
  );
});
test('WhatsApp socket submission cannot be advertised as verified platform delivery', async () => {
  const sender = createHostSender({
    baseUrl: 'http://127.0.0.1:60474',
    enabled: true,
    ownerSessionId: FAKE_SESSION_ID,
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, receipt: {
        sent: true, submitted: true, deliveryStatus: 'UNKNOWN', delivered: false,
        channel: 'WhatsApp', accountRef: REF_A, roomRef: REF_B,
        providerMessageId: 'wamid.good',
      } }),
    }),
  });
  const receipt = await sender.send({ channel: 'WhatsApp', accountRef: REF_A, roomRef: REF_B, text: 'Test.' });
  assert.equal(receipt.platformAccepted, false);
  assert.equal(receipt.deliveryStatus, 'UNKNOWN');
  assert.equal(receipt.transportAccepted, true);
});

test('media-only and caption+media webhook never fall through to text Sender', async () => {
  for (const content of ['', 'This caption must NOT be sent alone']) {
    const sender = createFakeSender();
    const payload = {
      ...buildOutgoingWebhook({ identifier: IDENTIFIER }),
      content,
      attachments: [{ id: 123, file_type: 'image', data_url: 'https://invalid.example/image' }],
    };
    const { outbound, body, headers } = await setup({ sender, payload });
    const result = await outbound.handle({ rawBody: body, headers });
    assert.equal(result.status, 422);
    assert.equal(result.body.status, 'MEDIA_OUTBOUND_NOT_WIRED');
    assert.equal(result.body.platformAccepted, false);
    assert.equal(result.body.realSendAttempted, false);
    assert.equal(result.body.willRetryAutomatically, false);
    assert.equal(sender.calls.length, 0);
    assert.equal(JSON.stringify(result.body).includes('invalid.example'), false);
  }
});

test('historical outgoing can never re-send to a real platform if native webhook suppression regresses', async () => {
  const variants = [
    { content_attributes: { yenra_history_import: true } },
    { content_attributes: { yenra_history_import: 'true' } },
    { content_attributes: JSON.stringify({ yenra_history_import: true }) },
    { source_id: 'wamid.history.123', content_attributes: { yenra_original_platform_mid: 'wamid.history.123' } },
  ];
  for (const variant of variants) {
    const sender = createFakeSender();
    const payload = { ...buildOutgoingWebhook({ identifier: IDENTIFIER }), ...variant };
    const { outbound, body, headers } = await setup({ sender, payload });
    const result = await outbound.handle({ rawBody: body, headers });
    assert.equal(result.status, 200);
    assert.equal(result.body.ignored, true);
    assert.equal(result.body.reason, 'HISTORICAL_PLATFORM_OUTBOUND');
    assert.equal(sender.calls.length, 0);
  }
});

test('signed webhook lacking exact Inbox or conversation cannot authorize any account Sender', async () => {
  const wa = buildOutgoingWebhook({ identifier: WA_IDENTIFIER, inboxId: 3 });
  const cases = [
    [{ ...wa, inbox: undefined }, 'INBOX_SCOPE_MISMATCH'],
    [{ ...wa, conversation: { ...wa.conversation, id: null } }, 'CONVERSATION_SCOPE_MISSING'],
    [{ ...wa, conversation: undefined }, 'CONTACT_IDENTIFIER_NOT_YENRA'],
  ];
  for (const [payload, error] of cases) {
    const sender = createFakeSender();
    const { outbound, body, headers } = await setup({ sender, payload });
    const result = await outbound.handle({ rawBody: body, headers });
    assert.equal(result.status, error === 'CONTACT_IDENTIFIER_NOT_YENRA' ? 422 : 409);
    assert.equal(result.body.error, error);
    assert.equal(result.body.realSendAttempted, false);
    assert.equal(sender.calls.length, 0);
  }
});

test('a Sender without Chatwoot native durable claim authority cannot be constructed', async () => {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  const index = buildRosterIndex(ROSTER, resolved.mapping);
  assert.throws(() => createOutboundHandler({ sender:createFakeSender(), index, logger:silentLogger }),
    /NATIVE_DURABLE_DELIVERY_AUTHORITY_REQUIRED/);
});

test('native PostgreSQL claim must precede the ONLY Host Sender request and receipt persistence', async () => {
  const order=[];
  const sender={
    calls:[],
    async send(input) {
      order.push('host-send');
      this.calls.push(input);
      return { providerMessageId:'wamid.test', transportAccepted:true, platformAccepted:false,
        submitted:true, deliveryStatus:'UNKNOWN', delivered:false };
    }
  };
  const deliveryAuthority={
    async claim({plan,scope}) {
      assert.equal(plan.chatwootMessageId>0,true);
      assert.equal(scope.inboxId,3);
      order.push('postgres-claim-committed');
      return {claimed:true,claimId:'22222222-2222-4222-8222-222222222222'};
    },
    async recordReceipt({claimId,receipt}) {
      assert.equal(claimId,'22222222-2222-4222-8222-222222222222');
      assert.equal(receipt.providerMessageId,'wamid.test');
      order.push('postgres-mid-committed');
      return {bound:true};
    }
  };
  const {outbound,body,headers}=await setup({sender,deliveryAuthority});
  const first=await outbound.handle({rawBody:body,headers});
  assert.equal(first.status,200);
  assert.deepEqual(order,['postgres-claim-committed','host-send','postgres-mid-committed']);
  assert.equal(sender.calls.length,1);
});

test('lost claim confirmation or duplicate native claim cannot start a platform send', async () => {
  for (const authority of [
    {claim: async()=>{throw Object.assign(Error('timeout'),{code:'NATIVE_CLAIM_UNCONFIRMED'});},
     recordReceipt:async()=>({bound:true})},
    {claim:async()=>({claimed:false,reason:'ALREADY_CLAIMED'}),recordReceipt:async()=>({bound:true})}
  ]) {
    const sender=createFakeSender();
    const {outbound,body,headers}=await setup({sender,deliveryAuthority:authority});
    const first=await outbound.handle({rawBody:body,headers});
    assert.equal(first.status,409);
    assert.equal(first.body.realSendAttempted,false);
    assert.equal(first.body.willRetryAutomatically,false);
    assert.equal(sender.calls.length,0);
    const repeat=await outbound.handle({rawBody:body,headers});
    assert.equal(repeat.status,409);
    assert.equal(repeat.body.ok,false);
    assert.equal(repeat.body.status,'UNKNOWN_NO_RETRY');
    assert.equal(repeat.body.duplicate,true);
    assert.equal(sender.calls.length,0);
  }
});

test('unconfirmed native MID persist keeps claim UNKNOWN without replaying the Sender', async()=>{
  const sender=createFakeSender();
  const deliveryAuthority={
    claim:async()=>({claimed:true,claimId:'22222222-2222-4222-8222-222222222222'}),
    recordReceipt:async()=>{throw Object.assign(Error('native store down'),{code:'NATIVE_RECEIPT_UNCONFIRMED'})}
  };
  const {outbound,body,headers}=await setup({sender,deliveryAuthority});
  const result=await outbound.handle({rawBody:body,headers});
  assert.equal(result.status,409);
  assert.equal(result.body.status,'UNKNOWN_NEEDS_MANUAL_RECONCILIATION');
  assert.equal(result.body.willRetryAutomatically,false);
  assert.equal(sender.calls.length,1);
  await outbound.handle({rawBody:body,headers});
  assert.equal(sender.calls.length,1);
});

test('Personal Matrix accepted receipt binds its original $event MID for later verified read ACK',async()=>{
  const mid='$testmatrixaccepted20261111';
  const sender=createHostSender({
    baseUrl:'http://127.0.0.1:60474', enabled:true,
    ownerSessionId:FAKE_SESSION_ID,
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:true,receipt:{
      channel:'Personal',accountRef:REF_A,roomRef:REF_B,
      sent:true,submitted:true,deliveryStatus:'UNKNOWN',delivered:false,
      matrixAccepted:true,matrixEventId:mid,providerMessageId:null,
    }})})
  });
  const result=await sender.send({channel:'Personal',accountRef:REF_A,roomRef:REF_B,text:'QA only'});
  assert.equal(result.providerMessageId,mid);
  assert.equal(result.transportAccepted,true);
  assert.equal(result.platformAccepted,false);
  assert.equal(result.delivered,false);
});
test('Personal sender refuses an invalid Matrix MID instead of inventing an ACK identity',async()=>{
  const sender=createHostSender({
    baseUrl:'http://127.0.0.1:60474',enabled:true,ownerSessionId:FAKE_SESSION_ID,
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:true,receipt:{
      channel:'Personal',accountRef:REF_A,roomRef:REF_B,
      sent:true,submitted:true,deliveryStatus:'UNKNOWN',delivered:false,
      matrixAccepted:true,matrixEventId:'unsafe-no-dollar',providerMessageId:null,
    }})})
  });
  await assert.rejects(sender.send({channel:'Personal',accountRef:REF_A,roomRef:REF_B,text:'QA only'}),
    {code:'HOST_SENDER_PROVIDER_MID_INVALID'});
});


test('native receipt returning bound:false cannot advertise successful submission or retry', async () => {
  const sender=createFakeSender();
  const deliveryAuthority={
    claim:async()=>({claimed:true,claimId:'22222222-2222-4222-8222-222222222222'}),
    recordReceipt:async()=>({bound:false}),
  };
  const {outbound,body,headers}=await setup({sender,deliveryAuthority});
  const first=await outbound.handle({rawBody:body,headers});
  assert.equal(first.status,409);
  assert.equal(first.body.status,'UNKNOWN_NEEDS_MANUAL_RECONCILIATION');
  assert.equal(first.body.submitted,false);
  const repeated=await outbound.handle({rawBody:body,headers});
  assert.equal(repeated.status,409);
  assert.equal(repeated.body.status,'UNKNOWN_NO_RETRY');
  assert.equal(repeated.body.manualReviewRequired,true);
  assert.equal(repeated.body.delivered,false);
  assert.equal(sender.calls.length,1);
});
