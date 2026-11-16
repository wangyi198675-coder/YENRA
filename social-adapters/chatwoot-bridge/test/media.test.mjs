import test from 'node:test';
import assert from 'node:assert/strict';
import { HostClient, classifySseFrame } from '../src/host-client.mjs';
import { parseHostEventRow, buildInboundMessage } from '../src/contract.mjs';
import { readMediaResponse, postNativeAttachment } from '../src/media-transfer.mjs';
import { createInboundBridge } from '../src/inbound.mjs';
import { resolveInboxMap } from '../src/inbox-map.mjs';
import { silentLogger } from '../src/logger.mjs';
import { ROSTER, API_INBOXES, REF_A, REF_B, buildHostRow, createFakeChatwoot } from './fixtures/synthetic.mjs';
const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
const row = () => ({ ...buildHostRow(), text: '', nativeMediaType: 'image' });
const media = { bytes, mime: 'image/png' };

test('Personal, Page and both WhatsApp unnamed INBOUND frames retain media metadata', () => {
  for (const channel of ['Personal', 'Page', 'WhatsApp']) {
    const result = classifySseFrame({ data: JSON.stringify({ ...row(), channel }) });
    assert.equal(result.kind, 'message');
    assert.equal(parseHostEventRow(result.row).row.nativeMediaType, 'image');
  }
  assert.equal(classifySseFrame({ event: 'personal-preview', data: JSON.stringify(row()) }).kind, 'ignore');
  assert.equal(classifySseFrame({ data: JSON.stringify({ ...row(), direction: 'OUTBOUND' }) }).kind, 'ignore');
});

test('media-only payload preserves empty caption, original MID and platform time', () => {
  assert.equal(parseHostEventRow(row()).ok, true);
  const payload = buildInboundMessage(row());
  assert.equal(payload.content, '');
  assert.equal(payload.source_id, row().mid);
  assert.ok(payload.content_attributes.external_created_at > 0);
  assert.equal(parseHostEventRow({ ...row(), nativeMediaType: 'sticker' }).ok, false);
});

test('Personal and WhatsApp media use existing Host GET; malformed Page MID is rejected before fetch', async () => {
  const calls = [];
  const host = new HostClient({ baseUrl: 'http://127.0.0.1:60474', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  } });
  for (const channel of ['Personal', 'WhatsApp']) {
    const read = await host.readMedia({ channel, accountRef: REF_A, roomRef: REF_B, mid: '$synthetic-media' });
    assert.deepEqual(read.bytes, bytes);
  }
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(new URL(calls[0].url).pathname, '/api/yenra/facebook-media');
  assert.equal(new URL(calls[1].url).searchParams.get('mode'), 'media');
  await assert.rejects(host.readMedia({ channel:'Page', accountRef: REF_A, roomRef: REF_B, mid: 'synthetic' }), { code:'PAGE_MID_INVALID' });
  assert.equal(calls.length, 2);
});

test('Host media body validates MIME, size, truncation, emptiness and no partial responses', async () => {
  const read = await readMediaResponse(new Response(bytes, { headers:{ 'content-type':'image/png' } }));
  assert.deepEqual(read, media);
  await assert.rejects(readMediaResponse(new Response(bytes, { status:206, headers:{'content-type':'image/png'} })), { code:'HOST_MEDIA_HTTP_206' });
  await assert.rejects(readMediaResponse(new Response(bytes, { headers:{'content-type':'text/html'} })), { code:'HOST_MEDIA_MIME_UNSUPPORTED' });
  await assert.rejects(readMediaResponse(new Response(bytes, { headers:{'content-type':'image/png'} }), {maxBytes:2}), { code:'HOST_MEDIA_TOO_LARGE' });
  await assert.rejects(readMediaResponse(new Response(bytes, { headers:{'content-type':'image/png', 'content-length':'9'} })), { code:'HOST_MEDIA_TRUNCATED' });
  await assert.rejects(readMediaResponse(new Response('', { headers:{'content-type':'image/png'} })), { code:'HOST_MEDIA_EMPTY' });
});

function nativeClient(capture) {
  return { baseUrl:'http://127.0.0.1:31907', apiBase:'/api/v1/accounts/1', token:'synthetic',
    fetchImpl: async (url, init) => { capture.push({url, init}); return Response.json({id:71, attachments:[{id:72}]}); } };
}

test('Chatwoot native multipart contains attachment, not a URL or placeholder; same source/time', async () => {
  const capture = [];
  const payload = buildInboundMessage({ ...row(), historyImport:true });
  const posted = await postNativeAttachment(nativeClient(capture), 3, payload, media);
  assert.equal(posted.id,71);
  const { init, url } = capture[0];
  assert.match(url, /conversations\/3\/messages$/);
  assert.equal(init.headers['content-type'], undefined); // fetch owns multipart boundary
  assert.equal(init.headers.api_access_token,'synthetic');
  assert.equal(init.body.get('source_id'), payload.source_id);
  assert.equal(init.body.get('content'), '');
  // Real isolated Rails API returned a typed object with boolean history
  // when this multipart field contained one JSON value. Its json column
  // serialization differs from the API representation: assert transport,
  // not the raw PostgreSQL jsonb_typeof() of a json column.
  assert.deepEqual(JSON.parse(init.body.get('content_attributes')),payload.content_attributes);
  assert.equal(init.body.get('content_attributes[yenra_history_import]'),null);
  assert.equal(init.body.get('attachments[]').type, 'image/png');
  assert.deepEqual(Buffer.from(await init.body.get('attachments[]').arrayBuffer()), bytes);
});

test('media inbound uploads attachment; unavailable bytes produce NO text-only write or entity creation', async () => {
  const resolved = await resolveInboxMap({roster:ROSTER, inboxes:API_INBOXES});
  const capture = [];
  const chatwoot = Object.assign(createFakeChatwoot(), nativeClient(capture));
  const host = { readMedia:async () => media };
  const inbound = createInboundBridge({host, chatwoot, roster:ROSTER, mapping:resolved.mapping, logger:silentLogger});
  await inbound.syncRow(row());
  assert.equal(inbound.stats.posted,1);
  assert.equal(capture.length,1);
  assert.equal(chatwoot.calls.createIncomingMessage,0);
  const second = createFakeChatwoot();
  const failed = createInboundBridge({host:{readMedia:async()=>{throw Object.assign(new Error('unavailable'),{code:'HOST_MEDIA_HTTP_404'});}}, chatwoot:second, roster:ROSTER, mapping:resolved.mapping, logger:silentLogger});
  await failed.syncRow(row());
  assert.equal(failed.stats.byReason.HOST_MEDIA_HTTP_404,1);
  assert.equal(second.calls.createContact,0);
  assert.equal(second.calls.createIncomingMessage,0);
});

test('all four Host native kinds use native attachments, not placeholder text', async () => {
  for (const [nativeMediaType,mime] of [['image','image/png'],['video','video/mp4'],['audio','audio/ogg'],['file','application/pdf']]) {
    const capture = [];
    const payload = buildInboundMessage({...row(),nativeMediaType});
    await postNativeAttachment(nativeClient(capture),3,payload,{bytes,mime});
    assert.equal(capture[0].init.body.get('attachments[]').type,mime);
    assert.equal(capture[0].init.body.get('content'),'');
  }
});

test('same-MID text-only existing row is not mislabeled as successful media; no retries', async () => {
  let calls=0;
  const client=nativeClient([]);
  client.fetchImpl=async()=>{calls++;return Response.json({id:71,attachments:[]});};
  await assert.rejects(postNativeAttachment(client,3,buildInboundMessage(row()),media),{code:'CHATWOOT_MEDIA_ATTACHMENT_MISSING'});
  assert.equal(calls,1);
  const duplicate = nativeClient([]);
  duplicate.fetchImpl=async()=>Response.json({id:71,source_id:row().mid,attachments:[]});
  await assert.rejects(postNativeAttachment(duplicate,3,buildInboundMessage(row()),media),
    {code:'CHATWOOT_MEDIA_EXISTING_TEXT_ONLY_MID'});
});

test('dry-run media performs no media download/upload', async () => {
  const resolved = await resolveInboxMap({roster:ROSTER, inboxes:API_INBOXES});
  let reads = 0;
  const inbound = createInboundBridge({host:{readMedia:async()=>{reads++;}}, chatwoot:createFakeChatwoot(), roster:ROSTER, mapping:resolved.mapping, logger:silentLogger, dryRun:true});
  await inbound.syncRow(row());
  assert.equal(reads,0);
  assert.equal(inbound.stats.planned,1);
});

test('Page media reads ONLY the exact MID from original Host verified room and allowlisted signed CDN', async () => {
  const mid = 'pancake:verified:media1';
  const calls = [];
  const trustedUrl = 'https://content.pancake.vn/authorized.jpeg?sig=synthetic';
  const makeRoom = (media = [{type:'image',url:trustedUrl}], extra = {}) => ({
    accountRef:REF_A,roomRef:REF_B,source:'YENRA_FB_OFFICIAL',
    messages:[{mid,direction:'INBOUND',media}],...extra
  });
  let room = makeRoom();
  const host = new HostClient({baseUrl:'http://127.0.0.1:60474',fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if (String(url).startsWith('http://127.0.0.1:60474')) return Response.json({
      ok:true,text:'YENRA_FACEBOOK_V1:'+JSON.stringify(room)
    });
    return new Response(bytes,{headers:{'content-type':'image/png'}});
  }});
  const read=await host.readMedia({channel:'Page',accountRef:REF_A,roomRef:REF_B,mid});
  assert.deepEqual(read.bytes,bytes);
  assert.equal(calls.length,2);
  assert.equal(new URL(calls[0].url).pathname,'/api/yenra/facebook-room');
  assert.equal(new URL(calls[0].url).searchParams.get('accountRef'),REF_A);
  assert.equal(new URL(calls[0].url).searchParams.get('roomRef'),REF_B);
  assert.equal(calls[1].url,trustedUrl);
  assert.equal(calls[1].init.redirect,'error');
  assert.equal(calls[1].init.headers.authorization,undefined);
  const checks=[
    [makeRoom([{type:'image',url:'https://evil.example/secret'}]),'PAGE_MEDIA_URL_NOT_TRUSTED'],
    [makeRoom([{type:'image',url:'http://content.pancake.vn/file'}]),'PAGE_MEDIA_URL_NOT_TRUSTED'],
    [makeRoom([{type:'image',url:trustedUrl},{type:'video',url:trustedUrl}]),'PAGE_MEDIA_SINGLE_ATTACHMENT_REQUIRED'],
    [makeRoom([{type:'file',url:trustedUrl}],{historicalOnly:true}),'PAGE_MEDIA_NOT_PROVIDER_VERIFIED'],
    [makeRoom([],{}),'PAGE_MEDIA_SINGLE_ATTACHMENT_REQUIRED'],
    [makeRoom([{type:'image',url:trustedUrl}],{source:'W25_HISTORICAL'}),'PAGE_MEDIA_NOT_PROVIDER_VERIFIED'],
    [{...makeRoom(),messages:[{mid:'pancake:wrong',direction:'INBOUND',media:[{type:'image',url:trustedUrl}]}]},'PAGE_MEDIA_MID_NOT_UNIQUE'],
  ];
  // Same original Host read can be consumed exactly once for the clicked
  // Page room without re-fetching its provider messages for each attachment.
  room=makeRoom();host.lastVerifiedPageRoom=null;
  const countBefore=calls.length;
  await host.readRoom({channel:'Page',accountRef:REF_A,roomRef:REF_B});
  await host.readMedia({channel:'Page',accountRef:REF_A,roomRef:REF_B,mid});
  assert.equal(calls.length,countBefore+2,'one Host read plus one CDN read');
  for (const [candidate,code] of checks) {
    room=candidate;host.lastVerifiedPageRoom=null;const before=calls.length;
    await assert.rejects(host.readMedia({channel:'Page',accountRef:REF_A,roomRef:REF_B,mid}),{code});
    assert.equal(calls.length,before+1,'reject before any CDN download');
  }
});

test('Page on-contact-click uses SDK media kind to upload the native attachment, never a text-only placeholder', async()=>{
  const accountRef='3'.repeat(32),roomRef='5'.repeat(32);
  const mid='pancake:synthetic:photo';
  const message={accountRef,roomRef,mid,direction:'INBOUND',timestamp:Date.now()-50000,
    text:'[Photo]',media:[{type:'image',url:'https://content.pancake.vn/signed'}]};
  const host={readRoom:async()=>({accountRef,roomRef,source:'YENRA_FB_OFFICIAL',messages:[message]}),
    readMedia:async()=>media};
  const capture=[];
  const chatwoot=Object.assign(createFakeChatwoot(),nativeClient(capture));
  const mapping=(await resolveInboxMap({roster:ROSTER,inboxes:API_INBOXES})).mapping;
  const bridge=createInboundBridge({host,chatwoot,roster:ROSTER,mapping,logger:silentLogger});
  const result=await bridge.openPageRoomOnDemand({accountRef,roomRef,maxMessages:1});
  assert.equal(result.ok,true);
  assert.equal(result.imported,1);
  assert.equal(capture.length,1);
  assert.equal(capture[0].init.body.get('source_id'),mid);
  assert.equal(capture[0].init.body.get('attachments[]').type,'image/png');
  assert.equal(chatwoot.calls.createIncomingMessage,0);
});

test('natural Page SSE media carries native media type; imports attachment instead of placeholder', async()=>{
  const accountRef='3'.repeat(32),roomRef='5'.repeat(32);
  const mid='pancake:synthetic:live-photo';
  const frame={data:JSON.stringify({accountRef,roomRef,mid,direction:'INBOUND',
    timestamp:Date.now()-1000,text:'[Photo]',media:[{type:'image',url:'https://content.pancake.vn/signed'}]})};
  const capture=[];
  const host={readMedia:async()=>media};
  const chatwoot=Object.assign(createFakeChatwoot(),nativeClient(capture));
  const mapping=(await resolveInboxMap({roster:ROSTER,inboxes:API_INBOXES})).mapping;
  const bridge=createInboundBridge({host,chatwoot,roster:ROSTER,mapping,logger:silentLogger});
  assert.equal(bridge.handleFrame(frame).kind,'queued');
  await bridge.drain();
  assert.equal(bridge.stats.posted,1);
  assert.equal(capture.length,1);
  assert.equal(capture[0].init.body.get('source_id'),mid);
  assert.equal(capture[0].init.body.get('attachments[]').type,'image/png');
  assert.equal(chatwoot.calls.createIncomingMessage,0);
});
