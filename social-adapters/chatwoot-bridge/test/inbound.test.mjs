import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterIndex, resolveInboxMap } from '../src/inbox-map.mjs';
import { createInboundBridge } from '../src/inbound.mjs';
import { readVerifiedSendPulsePageRoom } from '../src/sendpulse-page-roster.mjs';
import { stableContactIdentifier } from '../src/contract.mjs';
import { silentLogger } from '../src/logger.mjs';
import {
  API_INBOXES,
  REF_A,
  REF_B,
  ROSTER,
  buildHostRow,
  contactFor,
  createFakeChatwoot,
  createFakeHost,
} from './fixtures/synthetic.mjs';

async function setup({ chatwoot = createFakeChatwoot(), host = createFakeHost(), options = {} } = {}) {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  const inbound = createInboundBridge({
    host,
    chatwoot,
    mapping: resolved.mapping,
    roster: ROSTER,
    logger: silentLogger,
    ...options,
  });
  return { inbound, chatwoot, host, resolved };
}

function frameFor(row) {
  return { data: JSON.stringify(row) };
}

test('official SendPulse Page receipt proof only for outbound, original MID and actual opened/delivered time',async()=>{
  const at=Date.now()-50000;
  const binding={botId:'b'.repeat(32),pageId:'1203748086150141'};
  const room={botId:binding.botId,pageId:binding.pageId,
    contactId:'a'.repeat(24),peer:'12345678901234567',name:'Synthetic Page Contact'};
  const id=n=>'11111111-2222-3333-4444-'+String(n).padStart(12,'0');
  const make=(n,direction,status,extra={})=>({
    bot_id:binding.botId,contact_id:room.contactId,id:id(n),direction,status,
    created_at:new Date(at).toISOString(),data:{text:'Synthetic message '+n},...extra
  });
  const reader={readMessages:async()=>({
    verifiedBotId:binding.botId,verifiedPageId:binding.pageId,
    raw:{success:true,data:[
      make(1,2,4,{opened_at:new Date(at+2500).toISOString()}),
      make(2,2,3,{delivered_at:new Date(at+1500).toISOString()}),
      make(3,1,4,{opened_at:new Date(at+1600).toISOString()}),
      make(4,2,4,{opened_at:null}),
    ]}})};
  const data=await readVerifiedSendPulsePageRoom({
    reader,binding,room,accountRef:'3'.repeat(32),roomRef:'5'.repeat(32)});
  assert.equal(data.verifiedReceiptProvider,'SENDPULSE_OFFICIAL_REST_API');
  const rows=Object.fromEntries(data.messages.map(row=>[row.mid,row]));
  assert.equal(rows[id(1)].providerReceipt.status,'read');
  assert.equal(rows[id(2)].providerReceipt.status,'delivered');
  assert.equal(rows[id(3)].providerReceipt,undefined);
  assert.equal(rows[id(4)].providerReceipt,undefined);
});

test('only verified Page provider MID advances native historical OUTBOUND receipt; never resends',async()=>{
  const accountRef='3'.repeat(32),roomRef='5'.repeat(32),at=Date.now()-30000;
  const mid='11111111-2222-3333-4444-555555555555';
  const roster=structuredClone(ROSTER);
  const room=roster.accounts.find(a=>a.channel==='Page').rooms.find(r=>r.roomRef===roomRef);
  room.source='SENDPULSE_OFFICIAL_REST_API';
  const identifier=stableContactIdentifier(accountRef,roomRef);
  const chatwoot=createFakeChatwoot({contacts:[contactFor({id:321,identifier,inboxId:5})]});
  const cv=await chatwoot.createConversation({inboxId:5,contactId:321,sourceId:identifier});
  const original=await chatwoot.createIncomingMessage(cv.display_id,{
    source_id:mid,message_type:'outgoing',private:false,
    content_attributes:{yenra_history_import:true}});
  original.status='sent';
  const writes=[];
  chatwoot.listConversationMessages=async display=>
    chatwoot.messages.filter(x=>x.conversationDisplayId===display).map(x=>({
      ...x.message,message_type:x.payload.message_type,private:x.payload.private,
      source_id:x.payload.source_id,content_attributes:x.payload.content_attributes}));
  chatwoot.updateMessageStatus=async(display,id,status)=>{
    writes.push({display,id,status});
    original.status=status;
    return {id,status};
  };
  const originalRoom={accountRef,roomRef,verifiedReceiptProvider:'SENDPULSE_OFFICIAL_REST_API',
    messages:[{mid,direction:'OUTBOUND',text:'Original provider reply',
      timestamp:at,providerReceipt:{
        source:'SENDPULSE_OFFICIAL_REST_API',status:'read',confirmedAt:at+2000}}]};
  const host=createFakeHost({rooms:new Map([[accountRef+'|'+roomRef,originalRoom]])});
  const resolved=await resolveInboxMap({roster,inboxes:API_INBOXES});
  const bridge=createInboundBridge({host,chatwoot,mapping:resolved.mapping,
    roster,logger:silentLogger,now:()=>at+6000});
  const first=await bridge.openPageRoomOnDemand({accountRef,roomRef,maxMessages:20});
  const again=await bridge.openPageRoomOnDemand({accountRef,roomRef,maxMessages:20});
  assert.equal(first.receiptsUpdated,1);
  assert.equal(again.receiptsUpdated,0);
  assert.deepEqual(writes,[{display:cv.display_id,id:original.id,status:'read'}]);
  assert.equal(chatwoot.calls.createContact,0);
  assert.equal(chatwoot.calls.createConversation,1);
  assert.equal(chatwoot.messages.length,1);
  assert.equal(bridge.stats.posted,0);

  room.source='LEGACY_PAGE';
  original.status='sent';
  const disabled=await bridge.openPageRoomOnDemand({accountRef,roomRef,maxMessages:20});
  assert.equal(disabled.receiptsUpdated,0);
  assert.equal(writes.length,1);
});

test('Page verified legacy alias reuses original canonical contact and conversation instead of duplicate placeholder', async()=>{
  const accountRef='3'.repeat(32),roomRef='5'.repeat(32);
  const legacy=stableContactIdentifier(accountRef,roomRef);
  const canonicalId='yenra-'+'a'.repeat(40);
  const canonical={id:325,name:'Synthetic Page Room One',identifier:canonicalId,
    additional_attributes:{yenra_legacy_identifier:legacy},
    contact_inboxes:[{source_id:canonicalId,inbox:{id:5}}]};
  const placeholder={id:347,name:'Synthetic Page Room One',identifier:legacy,
    contact_inboxes:[{source_id:legacy,inbox:{id:5}}]};
  const chatwoot=createFakeChatwoot({contacts:[canonical,placeholder]});
  chatwoot.searchContacts=async query=>[canonical,placeholder].filter(c=>c.name===query||c.identifier===query);
  const prior=await chatwoot.createConversation({inboxId:5,contactId:325,sourceId:canonicalId});
  const {inbound}=await setup({chatwoot});
  const row=buildHostRow({accountRef,roomRef,mid:'verified_alias_page_mid_123456'});
  assert.equal(inbound.handleFrame(frameFor(row)).kind,'queued');
  await inbound.drain();
  assert.equal(chatwoot.messages.length,1);
  assert.equal(chatwoot.messages[0].conversationDisplayId,prior.display_id);
  assert.equal(chatwoot.calls.createContact,0);
  assert.equal(chatwoot.calls.createConversation,1);
  assert.equal(chatwoot.messages[0].payload.source_id,row.mid);
});

test('Page same-name match without exact saved legacy identifier is never merged',async()=>{
  const accountRef='3'.repeat(32),roomRef='5'.repeat(32);
  const legacy=stableContactIdentifier(accountRef,roomRef);
  const wrong={id:325,name:'Synthetic Page Room One',
    identifier:'yenra-'+'a'.repeat(40),
    additional_attributes:{yenra_legacy_identifier:'yenra-'+'f'.repeat(40)},
    contact_inboxes:[{source_id:'yenra-'+'a'.repeat(40),inbox:{id:5}}]};
  const chatwoot=createFakeChatwoot({contacts:[wrong]});
  chatwoot.searchContacts=async query=>[wrong].filter(c=>c.name===query||c.identifier===query);
  const {inbound}=await setup({chatwoot});
  assert.equal(inbound.handleFrame(frameFor(buildHostRow({accountRef,roomRef,mid:'unrelated_name_mid_12345'}))).kind,'queued');
  await inbound.drain();
  assert.equal(chatwoot.calls.createContact,1);
  assert.notEqual(chatwoot.written.contacts[0].identifier,wrong.identifier);
  assert.equal(chatwoot.written.contacts[0].identifier,legacy);
});

test('inbound posts the exact fork payload once for a fresh INBOUND row', async () => {
  const { inbound, chatwoot } = await setup();
  const row = buildHostRow();
  const outcome = inbound.handleFrame(frameFor(row));
  assert.equal(outcome.kind, 'queued');
  await inbound.drain();

  assert.equal(inbound.stats.posted, 1);
  assert.equal(chatwoot.messages.length, 1);
  const written = chatwoot.messages[0];
  assert.equal(written.payload.message_type, 'incoming');
  assert.equal(written.payload.source_id, row.mid);
  assert.equal(written.payload.content_attributes.yenra_original_platform_mid, row.mid);
  assert.equal(written.payload.content_attributes.yenra_history_import, false);
  assert.equal(Number.isSafeInteger(written.payload.content_attributes.external_created_at), true);
  assert.equal(written.conversationDisplayId, 500);
});

test('repeat delivery for the same platform MID relies on Chatwoot identity, not a local set', async () => {
  const { inbound, chatwoot } = await setup();
  const row = buildHostRow({ mid: '$synthetic-repeat-1' });
  inbound.handleFrame(frameFor(row));
  inbound.handleFrame(frameFor(row));
  await inbound.drain();
  await inbound.syncRow(row);
  await inbound.drain();

  // The adapter sent every time (no client-side dedup engine)...
  assert.ok(chatwoot.calls.createIncomingMessage >= 2);
  // ...while Chatwoot's own identity kept exactly one native message.
  assert.equal(chatwoot.messages.length, 1);
  assert.equal(inbound.stats.posted >= 2, true);
});

test('inbound ignores OUTBOUND rows, stale events and empty non-media rows', async () => {
  const { inbound, chatwoot } = await setup();
  assert.equal(inbound.handleFrame(frameFor(buildHostRow({ direction: 'OUTBOUND' }))).reason, 'NOT_INBOUND');

  const stale = buildHostRow({ timestamp: Date.now() - 60 * 60 * 1000 });
  assert.equal(inbound.handleFrame(frameFor(stale)).reason, 'STALE_EVENT_SKIPPED');

  const mediaOnly = buildHostRow({ text: '', mid: '$media-1' });
  // Empty content without a verified native media kind remains invalid.
  assert.equal(inbound.handleFrame(frameFor(mediaOnly)).reason, 'TEXT_EMPTY_NOT_FORWARDED');

  await inbound.drain();
  assert.equal(chatwoot.calls.createIncomingMessage, 0);
});

test('verified external SendPulse Page OUTBOUND is historical only, deduplicated and never a Sender call', async()=>{
  const {inbound,chatwoot}=await setup();
  const written=[];
  const original=chatwoot.createIncomingMessage.bind(chatwoot);
  chatwoot.createHistoricalOutgoingMessage=async(id,payload)=>{
    written.push(payload);return original(id,payload);
  };
  const row=buildHostRow({
    accountRef:'3'.repeat(32),roomRef:'5'.repeat(32),
    mid:'sendpulse_provider_external_123456',direction:'OUTBOUND',timestamp:Date.now(),
  });
  const frame={
    event:'page-external-outgoing',
    data:JSON.stringify({...row,channel:'Page',source:'SENDPULSE_OFFICIAL_REST_API_VERIFIED'})
  };
  assert.equal(inbound.handleFrame(frame).kind,'queuedExternalPageOutgoing');
  await inbound.drain();
  assert.equal(written.length,1);
  assert.equal(written[0].message_type,'outgoing');
  assert.equal(written[0].content_attributes.yenra_history_import,true);
  assert.equal(written[0].source_id,row.mid);
  assert.equal(chatwoot.messages.length,1);
  assert.equal(inbound.handleFrame(frame).kind,'queuedExternalPageOutgoing');
  await inbound.drain();
  assert.equal(chatwoot.messages.length,1);
  const forged={...row,source:'UNVERIFIED_PAGE_SOURCE',channel:'Page'};
  assert.equal(inbound.handleFrame({event:'page-external-outgoing',data:JSON.stringify(forged)}).kind,'ignore');
  assert.equal(inbound.handleFrame(frameFor(row)).kind,'ignore');
  await inbound.drain();
});

test('inbound dry-run performs no Chatwoot writes', async () => {
  const { inbound, chatwoot } = await setup({ options: { dryRun: true } });
  inbound.handleFrame(frameFor(buildHostRow({ mid: '$dry-run-1' })));
  await inbound.drain();
  assert.equal(inbound.stats.planned, 1);
  assert.equal(inbound.stats.posted, 0);
  assert.equal(chatwoot.calls.createContact, 0);
  assert.equal(chatwoot.calls.createConversation, 0);
  assert.equal(chatwoot.calls.createIncomingMessage, 0);
});

test('inbound room re-verification skips a MID the Host room does not contain', async () => {
  const host = createFakeHost({ onReadRoom: () => ({ messages: [] }) });
  const { inbound, chatwoot } = await setup({ host, options: { verifyRoomBeforePost: true } });
  inbound.handleFrame(frameFor(buildHostRow({ mid: '$unverified-1' })));
  await inbound.drain();
  assert.equal(chatwoot.calls.createIncomingMessage, 0);
  assert.equal(inbound.stats.byReason.MID_NOT_IN_HOST_ROOM, 1);

  const goodHost = createFakeHost({ onReadRoom: ({ accountRef, roomRef }) => ({ accountRef, roomRef, messages: [{ mid: '$verified-1', direction: 'INBOUND', text: buildHostRow().text }] }) });
  const second = await setup({ host: goodHost, options: { verifyRoomBeforePost: true } });
  second.inbound.handleFrame(frameFor(buildHostRow({ mid: '$verified-1' })));
  await second.inbound.drain();
  assert.equal(second.chatwoot.calls.createIncomingMessage, 1);
});

test('inbound creates a named contact from the Host room and a placeholder otherwise', async () => {
  const { inbound, chatwoot } = await setup();
  inbound.handleFrame(frameFor(buildHostRow({ accountRef: REF_A, roomRef: REF_B, mid: '$named-1' })));
  await inbound.drain();
  assert.equal(chatwoot.written.contacts[0].name, 'Synthetic Personal Room One');

  const unnamedRoom = 'c'.repeat(32);
  assert.equal(ROSTER.accounts[0].rooms.find((room) => room.roomRef === unnamedRoom).name, null);
  inbound.handleFrame(frameFor(buildHostRow({ accountRef: REF_A, roomRef: unnamedRoom, mid: '$unnamed-1' })));
  await inbound.drain();
  assert.match(chatwoot.written.contacts[1].name, /^YENRA contact /);
});

test('inbound reuses an existing conversation for the same contact and inbox', async () => {
  const { inbound, chatwoot } = await setup();
  inbound.handleFrame(frameFor(buildHostRow({ mid: '$conv-1' })));
  await inbound.drain();
  inbound.handleFrame(frameFor(buildHostRow({ mid: '$conv-2' })));
  await inbound.drain();
  assert.equal(chatwoot.calls.createConversation, 1);
  assert.equal(chatwoot.messages.length, 2);
});

test('inbound records Chatwoot failures without throwing or leaking text', async () => {
  const failure = Object.assign(new Error('synthetic failure'), { code: 'CHATWOOT_HTTP_500' });
  const chatwoot = createFakeChatwoot({ failCreateMessage: failure });
  const { inbound } = await setup({ chatwoot });
  inbound.handleFrame(frameFor(buildHostRow({ mid: '$fail-1' })));
  await inbound.drain();
  assert.equal(inbound.stats.failed, 1);
  assert.equal(inbound.stats.byReason.CHATWOOT_HTTP_500, 1);
});

test('inbound syncRow marks old catch-up rows as history import', async () => {
  const { inbound, chatwoot } = await setup({ options: { historyAgeMinutes: 60 } });
  const oldRow = buildHostRow({ mid: '$history-1', timestamp: Date.now() - 3 * 60 * 60 * 1000 });
  await inbound.syncRow(oldRow);
  await inbound.drain();
  assert.equal(chatwoot.messages[0].payload.content_attributes.yenra_history_import, true);

  const freshRow = buildHostRow({ mid: '$live-1', timestamp: Date.now() });
  await inbound.syncRow(freshRow);
  await inbound.drain();
  assert.equal(chatwoot.messages[1].payload.content_attributes.yenra_history_import, false);
});

test('verified Personal W25 translation uses native attributes; forged fields and text mismatch are rejected', async()=>{
  const row=buildHostRow({mid:'$verified-w25',translation:'forged'});
  const host=createFakeHost({onReadRoom:()=>({accountRef:row.accountRef,roomRef:row.roomRef,messages:[{...row,translation:'已核验中文'}]})});
  const {inbound,chatwoot}=await setup({host,options:{verifyRoomBeforePost:true}});
  await inbound.syncRow(row);
  const payload=chatwoot.messages[0].payload;
  assert.equal(payload.content,row.text);
  assert.deepEqual(payload.content_attributes.translations,{zh:'已核验中文'});
  assert.equal(payload.source_id,row.mid);
  const unverified=await setup();await unverified.inbound.syncRow(row);
  assert.equal(unverified.chatwoot.messages[0].payload.content_attributes.translations,undefined);
  const changed=await setup({host:createFakeHost({onReadRoom:()=>({messages:[{...row,text:'different source'}]})}),options:{verifyRoomBeforePost:true}});
  const outcome=await changed.inbound.syncRow(row);
  assert.equal(outcome.code,'HOST_MESSAGE_TEXT_MISMATCH');
  assert.equal(changed.chatwoot.messages.length,0);
});

test('verified Page W25 Chinese reaches native Chatwoot attributes without trusting a forged SSE translation', async () => {
  const accountRef = '3'.repeat(32);
  const roomRef = '5'.repeat(32);
  const row = buildHostRow({ accountRef, roomRef, mid: '$page-verified-zh', translation: '伪造的译文' });
  const host = createFakeHost({ onReadRoom: () => ({
    accountRef, roomRef,
    messages: [{ mid: row.mid, text: row.text, direction: 'INBOUND', translation: 'Page 已验证中文' }],
  }) });
  const { inbound, chatwoot } = await setup({ host, options: { verifyRoomBeforePost: true } });
  const result = inbound.handleFrame(frameFor(row));
  assert.equal(result.kind, 'queued');
  await inbound.drain();
  assert.equal(chatwoot.messages.length, 1);
  const payload = chatwoot.messages[0].payload;
  assert.equal(payload.content, row.text);
  assert.equal(payload.source_id, row.mid);
  assert.deepEqual(payload.content_attributes.translations, { zh: 'Page 已验证中文' });
  assert.equal(payload.content_attributes.translation_provider, 'Original Host verified W25');
  const noProof = await setup();
  noProof.inbound.handleFrame(frameFor(row));
  await noProof.inbound.drain();
  assert.equal(noProof.chatwoot.messages[0].payload.content_attributes.translations, undefined);
});

test('inbound index is still usable for outbound scope resolution', async () => {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  const index = buildRosterIndex(ROSTER, resolved.mapping);
  assert.equal(index.byIdentifier.size, 7);
});


test('Page roster-only: an operator bulk-history sync cannot auto-create a Page conversation', async () => {
  const accountRef = '3'.repeat(32);
  const roomRef = '5'.repeat(32);
  const { inbound, chatwoot, host } = await setup();
  const row = buildHostRow({ accountRef, roomRef, mid: '$page-old-synthetic', timestamp: Date.now() - 86400000 });
  const result = await inbound.syncRow(row, { forceHistoryImport: true });
  assert.equal(result.code, 'PAGE_HISTORY_ON_DEMAND_ONLY');
  assert.equal(chatwoot.calls.createContact, 0);
  assert.equal(chatwoot.calls.createConversation, 0);
  assert.equal(chatwoot.calls.createIncomingMessage, 0);
  assert.equal(host.reads.length, 0);
});

test('Page natural new inbound remains live and can create an inbox conversation', async () => {
  const accountRef = '3'.repeat(32);
  const roomRef = '5'.repeat(32);
  const { inbound, chatwoot } = await setup();
  assert.equal(inbound.handleFrame(frameFor(buildHostRow({
    accountRef, roomRef, mid: '$page-live-synthetic', timestamp: Date.now(),
    translation: 'untrusted event translation',
  }))).kind, 'queued');
  await inbound.drain();
  assert.equal(chatwoot.calls.createConversation, 1);
  assert.equal(chatwoot.messages.length, 1);
  assert.equal(chatwoot.messages[0].payload.content_attributes.yenra_history_import, false);
  assert.equal(chatwoot.messages[0].payload.content_attributes.translations, undefined);
});

test('Page open-by-click reads exactly one verified Host room and only then hydrates its first screen', async () => {
  const accountRef = '3'.repeat(32);
  const roomRef = '5'.repeat(32);
  const otherRoomRef = '6'.repeat(32);
  const stamp = Date.now() - 86400000;
  const rows = Array.from({ length: 25 }, (_, i) => buildHostRow({
    accountRef, roomRef, mid: '$page-on-demand-synthetic-' + i,
    timestamp: stamp + i * 1000,
  }));
  rows[24].translation = '已验证 Page 缓存中文';
  const host = createFakeHost({ onReadRoom: ({ accountRef, roomRef }) => ({
    accountRef, roomRef, messages: rows,
  }) });
  const { inbound, chatwoot } = await setup({ host });
  assert.equal(chatwoot.calls.createConversation, 0);
  const result = await inbound.openPageRoomOnDemand({ accountRef, roomRef });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 20);
  assert.equal(result.hasOlder, true);
  assert.equal(host.reads.length, 1);
  assert.equal(host.reads[0].channel, 'Page');
  assert.equal(host.reads[0].roomRef, roomRef);
  assert.equal(chatwoot.calls.createConversation, 1);
  assert.equal(chatwoot.messages.length, 20);
  assert.ok(chatwoot.messages.every(message => message.payload.content_attributes.yenra_history_import === true));
  const verified = chatwoot.messages.find(message => message.payload.source_id === rows[24].mid);
  assert.deepEqual(verified.payload.content_attributes.translations, { zh: '已验证 Page 缓存中文' });
  assert.equal(verified.payload.content_attributes.translation_provider, 'Original Host verified W25');
  assert.equal(chatwoot.calls.createContact, 1);
  assert.equal(await inbound.openPageRoomOnDemand({ accountRef, roomRef: '0'.repeat(32) }).then(x => x.code), 'PAGE_OPEN_SCOPE_INVALID');
  assert.equal(host.reads.length, 1);
  assert.equal(otherRoomRef !== roomRef, true);
});

test('Page click does not invent conversations when original Host history is empty', async () => {
  const accountRef = '3'.repeat(32);
  const roomRef = '6'.repeat(32);
  const { inbound, chatwoot, host } = await setup();
  const result = await inbound.openPageRoomOnDemand({ accountRef, roomRef });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 0);
  assert.equal(chatwoot.calls.createConversation, 0);
  assert.equal(host.reads.length, 1);
});

test('Page reselect catches verified external OUTBOUND only and never replays incoming', async () => {
  const accountRef = '3'.repeat(32);
  const roomRef = '5'.repeat(32);
  const stamp = Date.now() - 120_000;
  const rows = [
    buildHostRow({ accountRef, roomRef, mid: '$page-existing-in-1', timestamp: stamp }),
    buildHostRow({ accountRef, roomRef, mid: '$page-external-out-1',
      direction: 'OUTBOUND', timestamp: stamp + 1000 }),
    buildHostRow({ accountRef, roomRef, mid: '$page-existing-in-2', timestamp: stamp + 2000 }),
    buildHostRow({ accountRef, roomRef, mid: '$page-external-out-2',
      direction: 'OUTBOUND', timestamp: stamp + 3000 }),
  ];
  const host = createFakeHost({ onReadRoom: ({ accountRef, roomRef }) => ({
    accountRef, roomRef, messages: rows,
  }) });
  const chatwoot = createFakeChatwoot();
  const outgoing = [];
  chatwoot.createHistoricalOutgoingMessage = async (displayId, payload) => {
    outgoing.push({ displayId, payload });
    return { id: 900 + outgoing.length };
  };
  const { inbound } = await setup({ host, chatwoot });
  const outcome = await inbound.openPageRoomOnDemand({
    accountRef, roomRef, maxMessages: 40, onlyOutbound: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.imported, 2);
  assert.equal(host.reads.length, 1);
  assert.equal(chatwoot.calls.createIncomingMessage, 0);
  assert.equal(outgoing.length, 2);
  assert.ok(outgoing.every(({ payload }) =>
    payload.message_type === 'outgoing' &&
    payload.private === false &&
    payload.content_attributes.yenra_history_import === true
  ));
  assert.deepEqual(outgoing.map(({ payload }) => payload.source_id),
    ['$page-external-out-1', '$page-external-out-2']);
});

test('recent Page native catch-up repairs ONLY verified placeholders and skips already hydrated threads', async () => {
  const { stableContactIdentifier } = await import('../src/contract.mjs');
  const roster = structuredClone(ROSTER);
  const page = roster.accounts.find(a => a.channel === 'Page');
  const stamp = Date.now();
  page.rooms[0].lastMessageAt = stamp - 60_000;
  page.rooms[1].lastMessageAt = stamp - 120_000;
  // The original Page roster can show 0 cached messages even when its
  // lastMessageAt is recent; do not mistake this for an empty Meta thread.
  page.rooms[0].messageCount = 0;
  const resolved = await resolveInboxMap({ roster, inboxes: API_INBOXES });
  const firstId = stableContactIdentifier(page.accountRef,page.rooms[0].roomRef);
  const secondId = stableContactIdentifier(page.accountRef,page.rooms[1].roomRef);
  const generated = {id:51,identifier:firstId,name:'YENRA contact '+firstId.slice(-8)};
  const renamed = {id:52,identifier:secondId,name:'Saved nickname'};
  const contacts=new Map([[firstId,generated],[secondId,renamed]]);
  const updates=[];
  const chatwoot={
    apiBase:'/api/v1/accounts/1',
    async findContactByIdentifier(identifier){return contacts.get(identifier)??null},
    async listContactConversations(){return[{inbox_id:5,display_id:29}]},
    async request(method,path,body){updates.push({method,path,body});generated.name=body.name;return{ok:true}},
  };
  const inbound=createInboundBridge({roster,mapping:resolved.mapping,chatwoot,
    host:{async readRoom(){throw Error('existing native messages must be reused')}},
    logger:silentLogger,now:()=>stamp});
  const result=await inbound.reconcileRecentPageRooms();
  assert.equal(result.considered,2);
  assert.equal(result.repairedNames,1);
  assert.equal(result.alreadyNative,2);
  assert.equal(result.newConversations,0);
  assert.equal(result.failures,0);
  assert.deepEqual(updates,[{method:'PUT',path:'/api/v1/accounts/1/contacts/51',
    body:{name:'Synthetic Page Room One'}}]);
  assert.equal(generated.name,'Synthetic Page Room One');
  assert.equal(renamed.name,'Saved nickname');
});

test('verified Page foreground catches both missing directions and skips native platform MIDs', async () => {
  const { stableContactIdentifier } = await import('../src/contract.mjs');
  const accountRef='3'.repeat(32),roomRef='5'.repeat(32);
  const identifier=stableContactIdentifier(accountRef,roomRef);
  const nativeMessages=new Set(['$already-in']);
  const rows=[
    buildHostRow({accountRef,roomRef,mid:'$already-in',timestamp:Date.now()-60000}),
    buildHostRow({accountRef,roomRef,mid:'$fresh-in',timestamp:Date.now()-30000}),
    buildHostRow({accountRef,roomRef,mid:'$fresh-out',direction:'OUTBOUND',timestamp:Date.now()-15000}),
  ];
  const host=createFakeHost({onReadRoom:()=>({accountRef,roomRef,messages:rows})});
  const chatwoot=createFakeChatwoot();
  chatwoot.contactMap.set(identifier,{id:123,identifier,name:'Known Page Person'});
  chatwoot.conversations.push({display_id:505,inbox_id:5,contact_id:123});
  const incoming=[],outgoing=[];
  chatwoot.listConversationMessages=async()=>[...nativeMessages].map(source_id=>({source_id}));
  chatwoot.createIncomingMessage=async(_id,payload)=>{
    incoming.push(payload.source_id);nativeMessages.add(payload.source_id);return{id:901};
  };
  chatwoot.createHistoricalOutgoingMessage=async(_id,payload)=>{
    outgoing.push(payload.source_id);nativeMessages.add(payload.source_id);return{id:902};
  };
  const {inbound}=await setup({host,chatwoot});
  const first=await inbound.openPageRoomOnDemand({accountRef,roomRef,maxMessages:40,onlyOutbound:false});
  assert.equal(first.ok,true);
  assert.equal(first.imported,2);
  assert.equal(first.alreadyNative,1);
  assert.equal(first.conversationDisplayId,505);
  assert.deepEqual(incoming,['$fresh-in']);
  assert.deepEqual(outgoing,['$fresh-out']);
  const second=await inbound.openPageRoomOnDemand({accountRef,roomRef,maxMessages:40,onlyOutbound:false});
  assert.equal(second.ok,true);
  assert.equal(second.imported,0);
  assert.equal(second.alreadyNative,3);
  assert.deepEqual(incoming,['$fresh-in']);
  assert.deepEqual(outgoing,['$fresh-out']);
});

test('verified WhatsApp selection imports only external original outgoing, not a second Chatwoot-sent bubble', async () => {
  const {stableContactIdentifier}=await import('../src/contract.mjs');
  const accountRef='d'.repeat(32),roomRef='e'.repeat(32);
  const identifier=stableContactIdentifier(accountRef,roomRef);
  const rows=[
    buildHostRow({accountRef,roomRef,mid:'3EB0NATIVE_ALREADY',direction:'OUTBOUND',text:'YENRA sent',timestamp:Date.now()-8000}),
    buildHostRow({accountRef,roomRef,mid:'3EB0EXTERNAL_NEW',direction:'OUTBOUND',text:'Original WhatsApp external',timestamp:Date.now()-5000}),
  ];
  const host=createFakeHost({onReadRoom:()=>({accountRef,roomRef,messages:rows})});
  const chatwoot=createFakeChatwoot();
  chatwoot.contactMap.set(identifier,{id:123,identifier,name:'Verified WhatsApp'});
  chatwoot.conversations.push({display_id:507,inbox_id:3,contact_id:123});
  const posted=[];
  chatwoot.listConversationMessages=async()=>[
    {id:504,source_id:null,content_attributes:{yenra_outbound_provider_mid:'3EB0NATIVE_ALREADY'}},
    ...posted.map(source_id=>({source_id})),
  ];
  chatwoot.createHistoricalOutgoingMessage=async(_id,payload)=>{
    posted.push(payload.source_id);
    assert.equal(payload.message_type,'outgoing');
    assert.equal(payload.content_attributes.yenra_history_import,true);
    return {id:900};
  };
  const {inbound}=await setup({host,chatwoot});
  const first=await inbound.openWhatsAppRoomOnDemand({accountRef,roomRef});
  assert.equal(first.ok,true);
  assert.equal(first.imported,1);
  assert.deepEqual(posted,['3EB0EXTERNAL_NEW']);
  const second=await inbound.openWhatsAppRoomOnDemand({accountRef,roomRef});
  assert.equal(second.imported,0);
  assert.deepEqual(posted,['3EB0EXTERNAL_NEW']);
});
