/**
 * The bridge's own local HTTP surface. It is NOT a social listener: it only
 * receives Chatwoot's API-inbox webhook callback and exposes a health readout.
 *
 * - only a verified WhatsApp read projection may reuse the original Host room; never opens a second session;
 * - binds to a single configured address/port, default 127.0.0.1;
 * - rejects non-loopback peers unless BRIDGE_ALLOW_CIDR explicitly lists the
 *   isolated Docker/WSL network (needed when Chatwoot runs in its own container);
 * - verifies the Chatwoot HMAC before any decision is made;
 * - returns JSON only and never echoes message text or scope refs.
 */
import { createServer } from 'node:http';

const MAX_BODY_BYTES = 1_000_000;

/** IPv4 CIDR containment for whitelisted container networks. */
export function ipv4InCidr(address, cidr) {
  if (typeof address !== 'string' || typeof cidr !== 'string') return false;
  const [network, bitsRaw] = cidr.split('/');
  const bits = Number.parseInt(bitsRaw ?? '32', 10);
  const toInt = (value) => {
    const parts = value.split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (const part of parts) {
      const num = Number(part);
      if (!Number.isSafeInteger(num) || num < 0 || num > 255) return null;
      out = (out << 8) | num;
    }
    return out >>> 0;
  };
  const addressInt = toInt(address);
  const networkInt = toInt(network);
  if (addressInt === null || networkInt === null) return false;
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addressInt & mask) === (networkInt & mask);
}

export function isAllowedSource(remoteAddress, allowCidrs = []) {
  const address = String(remoteAddress ?? '').replace(/^::ffff:/u, '');
  if (!address) return true; // in-process / test shim
  if (['127.0.0.1', '::1'].includes(address)) return true;
  return (Array.isArray(allowCidrs) ? allowCidrs : []).some((cidr) => ipv4InCidr(address, cidr));
}

async function readBody(request, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limit) {
      const error = new Error('BODY_TOO_LARGE');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  response.end(body);
}

/** Only a loopback renderer (the DSH window on 60474/60480) may read responses. */
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/u;

function applyLoopbackCors(request, response) {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && LOOPBACK_ORIGIN.test(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
  }
}

/**
 * @param {object} options
 * @param {object} options.outbound createOutboundHandler() result
 * @param {() => object} [options.health] safe status snapshot
 * @param {object} options.logger
 * @param {string[]} [options.allowCidrs]
 * @param {(params:{accountId:number, displayId:number}) => Promise<object>} [options.resolveSelection]
 * @param {(params:{accountId:number, contactId:number}) => Promise<object>} [options.openPageContact]
 * @param {(params:{accountId:number,displayId:number}) => Promise<object>} [options.syncPageConversation]
 * @param {(params:{accountRef:string,roomRef:string}) => Promise<object>} [options.readVerifiedWhatsAppRoom]
 */
export function createBridgeServer({ outbound, health = () => ({}), logger, allowCidrs = [], resolveSelection, openPageContact, syncPageConversation, readVerifiedWhatsAppRoom, verifyVisibleTranslation, cloudPageWebhook, cloudApiCallback, cloudApiSenderHandler, resolveCloudSelection, verifyCloudPageMemory, verifyCloudRemoteWaMemory, verifyCloudRemotePersonalMemory, provePageAdoptSent, readCloudExportPage, readCloudPreviewList, verifyCloudWaReaction, cloudNoticeFeed, registerFriendWhatsApp } = {}) {
  if (!outbound || typeof outbound.handle !== 'function') throw new Error('OUTBOUND_HANDLER_REQUIRED');
  if (!logger) throw new Error('LOGGER_REQUIRED');

  async function handleRequest(request, response) {
    applyLoopbackCors(request, response);
    const url = new URL(String(request.url ?? '/'), 'http://localhost');
    if (!isAllowedSource(request.socket?.remoteAddress, allowCidrs)) {
      sendJson(response, 403, { ok: false, error: 'LOCAL_ONLY' });
      return;
    }
    // ONLY on a friend edition and ONLY from the same machine's native DSH-IM.
    // This is an activation signal, not a user-supplied WhatsApp identity.
    if(url.pathname==='/yenra-cloud-friend-register'){
      const peer=String(request.socket?.remoteAddress??'').replace(/^::ffff:/,'');
      if(!['127.0.0.1','::1'].includes(peer)){
        sendJson(response,403,{ok:false,code:'FRIEND_REGISTER_LOOPBACK_ONLY'});return;
      }
      if(request.method!=='POST'){
        sendJson(response,405,{ok:false,code:'POST_ONLY'});return;
      }
      if(typeof registerFriendWhatsApp!=='function'){
        sendJson(response,503,{ok:false,code:'FRIEND_REGISTER_NOT_ENABLED'});return;
      }
      if(!String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,415,{ok:false,code:'JSON_REQUIRED'});return;
      }
      try{
        const raw=await readBody(request,4096);
        const payload=JSON.parse(raw);
        if(!/^[a-zA-Z0-9_-]{6,128}$/.test(String(payload?.botId??'')))
          throw Error('FRIEND_BOT_ID_INVALID');
        const ownPhone=typeof payload.ownPhone==='string'&&/^\+[1-9][0-9]{4,14}$/.test(payload.ownPhone)
          ?payload.ownPhone:null;
        const outcome=await registerFriendWhatsApp({botId:payload.botId,ownPhone});
        sendJson(response,outcome?.ok===true?200:503,{
          ok:outcome?.ok===true,code:outcome?.code??null,
          inboxId:Number.isSafeInteger(outcome?.inboxId)?outcome.inboxId:null,
        });
      }catch(error){
        logger.warn('friend.register_deferred',{code:String(error?.code??error?.message??'UNKNOWN').slice(0,60)});
        sendJson(response,503,{ok:false,code:'FRIEND_REGISTER_DEFERRED'});
      }
      return;
    }
    // Read-only, transient SSE: only the native DSH owner with the on-disk
    // per-process capability sees signed/verified Cloud message presentation.
    if(url.pathname==='/yenra-cloud/notice-events'){
      if(!cloudNoticeFeed){sendJson(response,503,{ok:false,code:'NOTICE_FEED_UNAVAILABLE'});return}
      cloudNoticeFeed.subscribe(request,response);return;
    }
    // Meta → Chatwoot Cloud → original YENRA Bridge, same HTTP server.
    // Signed Cloud requests are verified against the Cloud account's own
    // per-webhook secret before any Cloud API or native CE access.
    if(url.pathname==='/yenra-cloud-page/webhook'){
      if(request.method!=='POST'){
        sendJson(response,405,{ok:false,code:'CLOUD_POST_ONLY'});return;
      }
      if(typeof cloudPageWebhook!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_CALLBACK_NOT_INSTALLED'});return;
      }
      if(!String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,415,{ok:false,code:'CLOUD_JSON_REQUIRED'});return;
      }
      try {
        const body=await readBody(request,180000);
        const result=await cloudPageWebhook({rawBody:body,headers:request.headers});
        // Official Cloud already stores the verified Meta message. ACK the
        // signed webhook; never require a retired CE mirror to return 200.
        const status=result?.kind==='accepted'?200:202;
        sendJson(response,status,{ok:true,kind:result?.kind??'ignored',nativeWritten:result?.deliveredToNative===true});
      } catch(error) {
        logger.warn('cloud.webhook_rejected',{code:error?.message?.slice(0,78)??'UNKNOWN'});
        const code=String(error?.message??'');
        const status=/SIGNATURE|EXPIRED|BAD_JSON|BODY_INVALID|SCOPE_REJECTED|INVALID/.test(code)?401:503;
        sendJson(response,status,{ok:false,code:'CLOUD_VERIFICATION_OR_NATIVE_UNAVAILABLE'});
      }
      return;
    }
    // Three Cloud API inboxes (Personal, WA1, WA2) share this existing Bridge.
    // Platform Sender is intentionally DISABLED until original DSH scope,
    // Cloud message and one-way delivery claim are proven, never a fake ACK.
    if(url.pathname==='/yenra-cloud-api-channel/callback'){
      if(request.method!=='POST'){sendJson(response,405,{ok:false,code:'POST_ONLY'});return}
      if(!String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,415,{ok:false,code:'JSON_REQUIRED'});return
      }
      if(typeof cloudApiCallback!=='function'){
        sendJson(response,503,{ok:false,code:'API_CALLBACK_NOT_READY'});return
      }
      try{
        const rawBody=await readBody(request,180000);
        const handler=typeof cloudApiSenderHandler==='function'?cloudApiSenderHandler:cloudApiCallback;
        const out=await handler({rawBody,headers:request.headers});
        if(out.kind==='blocked'){
          sendJson(response,503,{ok:false,code:'CLOUD_SENDER_CUTOVER_PENDING'});return
        }
        if(out.kind==='unknown-no-retry'){
          sendJson(response,503,{ok:false,code:'CLOUD_WA_SEND_UNKNOWN_NO_RETRY'});return
        }
        if(out.kind==='submitted-unconfirmed'||out.kind==='already-claimed'||
           out.kind==='submitted-mid-pending'){
          // HTTP 200 means the ORIGINAL transport submitted, not Cloud-only
          // acceptance and never recipient delivery/READ. Missing MID remains
          // explicitly pending; the UI must not offer an unsafe resend.
          sendJson(response,200,{ok:true,kind:out.kind,delivered:false,
            providerMidVerified:out.kind==='submitted-mid-pending'?false:undefined,
            willRetryAutomatically:false});return
        }
        sendJson(response,202,{ok:true,kind:'ignored'});return
      }catch(error){
        const code=String(error?.message??'UNKNOWN');
        logger.warn('cloud.api_channel_callback_denied',{code:code.slice(0,74)});
        if(/SIGNATURE|EXPIRED|CALLBACK_BODY|CALLBACK_JSON|CROSS_ACCOUNT_OR_INBOX/.test(code)){
          sendJson(response,401,{ok:false,code:'CLOUD_API_CALLBACK_UNVERIFIED'});return
        }
        if(code==='CLOUD_WA_OUTBOUND_UNKNOWN_NO_RETRY'){
          sendJson(response,503,{ok:false,code:'CLOUD_WA_SEND_UNKNOWN_NO_RETRY'});return
        }
        sendJson(response,503,{ok:false,code:'CLOUD_WA_CALLBACK_NOT_READY'});return
      }
    }
    // Read-only Cloud conversation ID → original verified DSH room. URL and
    // client-supplied contact IDs are never identity proof.
    if(url.pathname==='/yenra-cloud/resolve'){
      const local=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(local)||
         request.headers.origin||
         request.headers['x-yenra-original-dsh-cloud-selection']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'TRUSTED_DSH_ONLY'});return
      }
      if(typeof resolveCloudSelection!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_SELECTION_NOT_READY'});return
      }
      try {
        const raw=await readBody(request,400);
        const body=JSON.parse(raw);
        if(Object.keys(body).sort().join(',')!=='accountId,conversationId'||
           body.accountId!==196799||!Number.isSafeInteger(body.conversationId)||
           body.conversationId<=0){
          sendJson(response,400,{ok:false,code:'CLOUD_SELECTION_INVALID'});return
        }
        const result=await resolveCloudSelection({conversationId:body.conversationId});
        sendJson(response,result?.ok===true?200:409,result);
      }catch(error){
        logger.warn('cloud.conversation_scope_unavailable',{code:String(error?.message??'UNKNOWN').slice(0,75)});
        sendJson(response,503,{ok:false,code:'CLOUD_SCOPE_AUTHORITY_UNAVAILABLE'});
      }
      return
    }
    // This is only a signed-Cloud-readback EVIDENCE query for the original
    // DSH MemoryService. It never sends, imports or stores social messages.
    if(url.pathname==='/yenra-cloud/page-adopt-sent-proof'){
      const local=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(local)||
         request.headers.origin||request.headers['x-yenra-original-dsh-cloud-memory']!=='1'||
         request.headers['x-yenra-page-sent-proof']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'TRUSTED_DSH_ONLY'});return;
      }
      if(typeof provePageAdoptSent!=='function'){
        sendJson(response,503,{ok:false,code:'PAGE_SEND_PROOF_UNAVAILABLE'});return;
      }
      try{
        const raw=await readBody(request,400),body=JSON.parse(raw)
        const fields=Object.keys(body??{}).sort().join(',')
        if(!['accountRef,conversationId,messageId,pageIdentityHash,roomRef',
              'accountRef,conversationId,messageId,pageIdentityHash,roomRef,upgrade'].includes(fields)||
           (body.upgrade!==undefined&&body.upgrade!==true)||
           !/^[a-f0-9]{32}$/u.test(body.accountRef??'')||
           !/^[a-f0-9]{32}$/u.test(body.roomRef??'')||
           !/^[a-f0-9]{64}$/u.test(body.pageIdentityHash??'')||
           !Number.isSafeInteger(body.conversationId)||body.conversationId<=0||
           !Number.isSafeInteger(body.messageId)||body.messageId<=0){
          sendJson(response,400,{ok:false,code:'PAGE_SEND_PROOF_BAD_INPUT'});return;
        }
        const result=await provePageAdoptSent(body)
        sendJson(response,result?.ok===true?200:409,result)
      }catch(error){
        logger.warn('cloud.page_adopt_sent_proof_unavailable',
          {code:String(error?.message??'UNKNOWN').slice(0,65)})
        sendJson(response,503,{ok:false,code:'PAGE_SEND_PROOF_READ_UNAVAILABLE'})
      }
      return
    }
    // Existing Cloud authority: exact contact re-verification before each native
    // MemoryService access. No second memory store, Page provider or Sender.
    if(url.pathname==='/yenra-cloud/memory-verify'){
      const local=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(local)||
         request.headers.origin||
         request.headers['x-yenra-original-dsh-cloud-memory']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'TRUSTED_DSH_ONLY'});return;
      }
      if(typeof verifyCloudPageMemory!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_PAGE_MEMORY_AUTHORITY_MISSING'});return;
      }
      try{
        const raw=await readBody(request,250),body=JSON.parse(raw);
        if(Object.keys(body??{}).sort().join(',')!=='accountRef,pageIdentityHash,roomRef'||
           !/^[a-f0-9]{32}$/u.test(body.accountRef??'')||
           !/^[a-f0-9]{32}$/u.test(body.roomRef??'')||
           !/^[a-f0-9]{64}$/u.test(body.pageIdentityHash??'')){
          sendJson(response,400,{ok:false,code:'CLOUD_PAGE_MEMORY_SCOPE_INVALID'});return;
        }
        const proof=await verifyCloudPageMemory(body);
        sendJson(response,proof?.ok===true?200:409,{ok:proof?.ok===true});
      }catch{
        sendJson(response,503,{ok:false,code:'CLOUD_PAGE_MEMORY_VERIFICATION_UNAVAILABLE'});
      }
      return;
    }
    // The SAME native DSH MemoryService can verify a remote friend WhatsApp
    // namespace via Cloud; it must never claim the owner's original WA Socket.
    if(url.pathname==='/yenra-cloud/remote-wa-memory-verify'){
      const local=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(local)||
         request.headers.origin||
         request.headers['x-yenra-original-dsh-cloud-memory']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'TRUSTED_DSH_ONLY'});return;
      }
      if(typeof verifyCloudRemoteWaMemory!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_REMOTE_WA_MEMORY_AUTHORITY_MISSING'});return;
      }
      try{
        const raw=await readBody(request,275),body=JSON.parse(raw);
        if(Object.keys(body??{}).sort().join(',')!==
             'accountRef,cloudIdentityHash,expectedInboxId,roomRef'||
           !/^[a-f0-9]{32}$/u.test(body.accountRef??'')||
           !/^[a-f0-9]{32}$/u.test(body.roomRef??'')||
           !/^[a-f0-9]{64}$/u.test(body.cloudIdentityHash??'')||
           !Number.isSafeInteger(body.expectedInboxId)||body.expectedInboxId<=0){
          sendJson(response,400,{ok:false,code:'CLOUD_REMOTE_WA_MEMORY_SCOPE_INVALID'});return;
        }
        const ok=await verifyCloudRemoteWaMemory(body);
        sendJson(response,ok===true?200:409,{ok:ok===true});
      }catch{
        sendJson(response,503,{ok:false,code:'CLOUD_REMOTE_WA_MEMORY_VERIFICATION_UNAVAILABLE'});
      }
      return;
    }
    // Reuse the SAME original Host memory service for verified Cloud Personal.
    // The Personal API inbox is NOT a WhatsApp Sender or a Messenger Page.
    if(url.pathname==='/yenra-cloud/remote-personal-memory-verify'){
      const local=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(local)||
         request.headers.origin||
         request.headers['x-yenra-original-dsh-cloud-memory']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'TRUSTED_DSH_ONLY'});return;
      }
      if(typeof verifyCloudRemotePersonalMemory!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_REMOTE_PERSONAL_AUTHORITY_MISSING'});return;
      }
      try{
        const raw=await readBody(request,275),body=JSON.parse(raw);
        if(Object.keys(body??{}).sort().join(',')!==
             'accountRef,cloudIdentityHash,expectedInboxId,roomRef'||
           !/^[a-f0-9]{32}$/u.test(body.accountRef??'')||
           !/^[a-f0-9]{32}$/u.test(body.roomRef??'')||
           !/^[a-f0-9]{64}$/u.test(body.cloudIdentityHash??'')||
           body.expectedInboxId!==155900){
          sendJson(response,400,{ok:false,code:'CLOUD_REMOTE_PERSONAL_SCOPE_INVALID'});return;
        }
        const verified=await verifyCloudRemotePersonalMemory(body);
        sendJson(response,verified===true?200:409,{ok:verified===true});
      }catch{
        sendJson(response,503,{ok:false,code:'CLOUD_REMOTE_PERSONAL_VERIFY_UNAVAILABLE'});
      }
      return;
    }
    // Explicit, owner-authenticated Cloud transcript export. The existing
    // local Bridge uses its own DPAPI Cloud credential; no browser token,
    // cookie, or media history is copied into a second store.
    // Owner Cloud list previews: only saved zh_CN, never AI translation.
    if(url.pathname==='/yenra-cloud/preview-list'){
      const remote=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(remote)||
        request.headers.origin||
        request.headers['x-yenra-original-dsh-cloud-preview']!=='1'||
        !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'OWNER_PREVIEW_ONLY'});return
      }
      if(typeof readCloudPreviewList!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_PREVIEW_UNAVAILABLE'});return
      }
      try{
        const raw=await readBody(request,100),args=JSON.parse(raw);
        if(Object.keys(args??{}).sort().join(',')!=='accountId,page'||
          args.accountId!==196799||!Number.isSafeInteger(args.page)||
          args.page<1||args.page>8)throw Error('PREVIEW_BAD_REQUEST');
        const output=await readCloudPreviewList(args);
        if(!output?.ok||output.accountId!==196799||!Array.isArray(output.rows)||
          !Array.isArray(output.candidates)||output.rows.length>30||
          output.candidates.length>30||
          output.rows.length+output.candidates.length>30)
          throw Error('PREVIEW_RESPONSE_INVALID');
        sendJson(response,200,output);
      }catch(error){
        logger.warn('cloud.preview_unavailable',{code:String(error?.message??'UNKNOWN').slice(0,60)});
        sendJson(response,422,{ok:false,code:'CLOUD_PREVIEW_NOT_VERIFIED'});
      }
      return
    }
    // Verified Cloud WhatsApp message proof for a future owner-click platform
    // reaction. Read-only: this route never calls Baileys or any Sender.
    if(url.pathname==='/yenra-cloud/verify-wa-reaction'){
      const remote=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(remote)||
         request.headers.origin||
         request.headers['x-yenra-original-dsh-cloud-reaction']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'OWNER_WA_REACTION_PROOF_ONLY'});return
      }
      if(typeof verifyCloudWaReaction!=='function'){
        sendJson(response,503,{ok:false,code:'WA_REACTION_PROOF_UNAVAILABLE'});return
      }
      try{
        const body=JSON.parse(await readBody(request,160));
        if(Object.keys(body??{}).sort().join(',')!=='accountId,conversationId,emoji,messageId'||
           body.accountId!==196799||
           !Number.isSafeInteger(body.conversationId)||body.conversationId<=0||
           !Number.isSafeInteger(body.messageId)||body.messageId<=0||
           !['👍','❤️','😂','😮','😢','🙏'].includes(body.emoji)){
          sendJson(response,400,{ok:false,code:'WA_REACTION_PROOF_REQUEST_INVALID'});return
        }
        const proof=await verifyCloudWaReaction(body);
        if(proof?.ok!==true||proof.selection?.channel!=='WhatsApp'){
          sendJson(response,409,{ok:false,code:'WA_REACTION_ORIGINAL_NOT_VERIFIED'});return
        }
        sendJson(response,200,proof);
      }catch(error){
        logger.warn('cloud.wa_reaction_proof_failed',
          {code:String(error?.code??error?.message??'UNKNOWN').slice(0,70)});
        sendJson(response,503,{ok:false,code:'WA_REACTION_PROOF_NOT_READY'});
      }
      return
    }
    if(url.pathname==='/yenra-cloud/export-page'){
      const remote=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST'||!['127.0.0.1','::1'].includes(remote)||
         request.headers.origin||
         request.headers['x-yenra-original-dsh-cloud-export']!=='1'||
         !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'OWNER_EXPORT_ONLY'});return
      }
      if(typeof readCloudExportPage!=='function'){
        sendJson(response,503,{ok:false,code:'CLOUD_EXPORT_UNAVAILABLE'});return
      }
      try{
        const raw=await readBody(request,500),body=JSON.parse(raw);
        const names=Object.keys(body).sort().join(',');
        if(!['accountId,conversationId','accountId,before,conversationId'].includes(names)||
           body.accountId!==196799||!Number.isSafeInteger(body.conversationId)||
           body.conversationId<=0||
           !(body.before===undefined||(Number.isSafeInteger(body.before)&&body.before>0))){
          sendJson(response,400,{ok:false,code:'CLOUD_EXPORT_BAD_REQUEST'});return
        }
        const result=await readCloudExportPage(body);
        sendJson(response,200,result);
      }catch(error){
        logger.warn('cloud.export_unavailable',{code:String(error?.message??'UNKNOWN').slice(0,78)});
        sendJson(response,422,{ok:false,code:'CLOUD_EXPORT_SCOPE_OR_PAGE_UNAVAILABLE'});
      }
      return
    }
    if (url.pathname === '/healthz') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, error: 'GET_ONLY' });
        return;
      }
      sendJson(response, 200, { ok: true, ...health() });
      return;
    }
    if (url.pathname === '/translation-proof') {
      // Read-only proof for the SINGLE original DSH translator. The only
      // authority is Chatwoot's persisted original inbound source_id + body,
      // correlated with the current original Host verified roster/contact.
      const address=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST' || !['127.0.0.1','::1'].includes(address) ||
          request.headers.origin || request.headers['x-yenra-original-dsh-translation']!=='1' ||
          !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'TRUSTED_DSH_ONLY'});return
      }
      if(typeof verifyVisibleTranslation!=='function'){
        sendJson(response,503,{ok:false,code:'TRANSLATION_NATIVE_PROOF_NOT_READY'});return
      }
      let payload
      try{payload=JSON.parse(await readBody(request,3200))}
      catch{sendJson(response,400,{ok:false,code:'TRANSLATION_PROOF_BODY_INVALID'});return}
      try{
        const result=await verifyVisibleTranslation(payload)
        sendJson(response,result?.ok===true?200:422,
          {ok:result?.ok===true,verified:result?.verified===true,
            code:result?.ok===true?'VERIFIED':'MESSAGE_PROOF_REJECTED'})
      }catch(error){
        logger.warn('translation.proof_failed',{code:error?.code??'UNKNOWN'})
        sendJson(response,503,{ok:false,code:'NATIVE_MESSAGE_PROOF_UNAVAILABLE'})
      }
      return
    }
    if (url.pathname === '/page-contact/open') {
      // Only the already authenticated Chatwoot iframe, verified by the
      // local reverse proxy, can request a Page room's first screen.
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'POST_ONLY' });
        return;
      }
      if (request.headers.origin !== 'http://127.0.0.1:31908' ||
          request.headers['x-yenra-page-contact-click'] !== '1' ||
          !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        sendJson(response, 403, { ok: false, error: 'PAGE_CLICK_AUTH_REQUIRED' });
        return;
      }
      if (typeof openPageContact !== 'function') {
        sendJson(response, 503, { ok: false, error: 'PAGE_OPEN_NOT_WIRED' });
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(request, 1024));
      } catch {
        sendJson(response, 400, { ok: false, error: 'PAGE_CLICK_BODY_INVALID' });
        return;
      }
      const accountId = body?.accountId;
      const contactId = body?.contactId;
      if (!Number.isSafeInteger(accountId) || accountId < 1 ||
          !Number.isSafeInteger(contactId) || contactId < 1) {
        sendJson(response, 400, { ok: false, error: 'PAGE_CLICK_ID_INVALID' });
        return;
      }
      try {
        const result = await openPageContact({ accountId, contactId });
        sendJson(response, result?.ok ? 200 : 404, result ?? { ok: false, code: 'PAGE_OPEN_EMPTY' });
      } catch (error) {
        logger.warn('page.open_failed', { code: error?.code ?? 'UNKNOWN' });
        sendJson(response, 500, { ok: false, error: 'PAGE_CONTACT_OPEN_FAILED' });
      }
      return;
    }
    if (url.pathname === '/page-conversation/sync') {
      // Existing Chatwoot session is verified by the ONE local frame proxy;
      // Bridge independently resolves the Page scope from its Host roster.
      const address=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if(request.method!=='POST' || !['127.0.0.1','::1'].includes(address) ||
        request.headers.origin!=='http://127.0.0.1:31908' ||
        request.headers['x-yenra-page-thread-refresh']!=='1' ||
        !String(request.headers['content-type']??'').startsWith('application/json')){
        sendJson(response,403,{ok:false,code:'VERIFIED_PAGE_THREAD_ONLY'});return;
      }
      if(typeof syncPageConversation!=='function'){
        sendJson(response,503,{ok:false,code:'PAGE_SYNC_UNAVAILABLE'});return;
      }
      let params;
      try{params=JSON.parse(await readBody(request,512))}
      catch{sendJson(response,400,{ok:false,code:'PAGE_THREAD_BODY_INVALID'});return;}
      if(!Number.isSafeInteger(params?.accountId)||params.accountId<1||
        !Number.isSafeInteger(params?.displayId)||params.displayId<1){
        sendJson(response,400,{ok:false,code:'PAGE_THREAD_ID_INVALID'});return;
      }
      try{
        const result=await syncPageConversation(params);
        sendJson(response,result?.ok?200:404,result??{ok:false,code:'PAGE_SYNC_NO_RESULT'});
      }catch(error){
        logger.warn('page.thread_sync_failed',{code:error?.code??'UNKNOWN'});
        sendJson(response,503,{ok:false,code:'PAGE_THREAD_SYNC_FAILED'});
      }
      return;
    }
    if (url.pathname === '/verified-wa-room') {
      // Isolated DSH 60480 does not run DSH-IM: the ONE authorized 60474
      // Host still owns both WhatsApp personal accounts and their histories.
      // Only this loopback renderer can request a roster-bound read projection.
      const local=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
      if (request.method!=='GET') {
        sendJson(response,405,{ok:false,error:'GET_ONLY'});return;
      }
      if (!['127.0.0.1','::1'].includes(local) ||
          request.headers.origin!=='http://127.0.0.1:60480') {
        sendJson(response,403,{ok:false,error:'ISOLATED_DSH_ORIGIN_REQUIRED'});return;
      }
      if (typeof readVerifiedWhatsAppRoom!=='function') {
        sendJson(response,503,{ok:false,error:'WHATSAPP_ROOM_READ_NOT_WIRED'});return;
      }
      try{
        const handlerStarted=performance.now();
        const result=await readVerifiedWhatsAppRoom({
          accountRef:url.searchParams.get('accountRef'),
          roomRef:url.searchParams.get('roomRef'),
        });
        const bridgeHandlerMs=Math.max(0,Math.round(performance.now()-handlerStarted));
        const hostReadMs=Number.isFinite(result?.hostReadMs)?Math.max(0,Math.round(result.hostReadMs)):null;
        // Identify a slow ORIGINAL Host read vs local Bridge handling without
        // logging any account refs, contacts, messages or provider identifiers.
        if(result?.ok&&bridgeHandlerMs>=1500)
          logger.warn('wa.room_read_slow',{bridgeHandlerMs,hostReadMs});
        if(result?.ok&&hostReadMs!==null){
          response.setHeader('server-timing',`host;dur=${hostReadMs},bridge;dur=${bridgeHandlerMs}`);
          response.setHeader('access-control-expose-headers','server-timing');
        }
        sendJson(response,result?.ok?200:404,result??{ok:false,error:'WA_ROOM_EMPTY'});
      }catch(error){
        logger.warn('wa.room_read_failed',{code:error?.code??'UNKNOWN'});
        sendJson(response,503,{ok:false,error:'ORIGINAL_WA_HOST_UNAVAILABLE'});
      }
      return;
    }
    if (url.pathname === '/selection') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, error: 'GET_ONLY' });
        return;
      }
      if (typeof resolveSelection !== 'function') {
        sendJson(response, 501, { ok: false, error: 'SELECTION_RESOLVER_UNAVAILABLE' });
        return;
      }
      const accountId = Number(url.searchParams.get('accountId'));
      const displayId = Number(url.searchParams.get('displayId'));
      if (!Number.isSafeInteger(accountId) || !Number.isSafeInteger(displayId) || accountId <= 0 || displayId <= 0) {
        sendJson(response, 400, { ok: false, error: 'ACCOUNT_OR_DISPLAY_ID_INVALID' });
        return;
      }
      try {
        const result = await resolveSelection({ accountId, displayId });
        sendJson(response, result?.ok ? 200 : 404, result ?? { ok: false, error: 'SELECTION_RESOLVE_EMPTY' });
      } catch (error) {
        logger.error('selection.resolve_crashed', { code: error?.code ?? 'UNKNOWN' });
        sendJson(response, 500, { ok: false, error: 'SELECTION_RESOLVE_FAILED' });
      }
      return;
    }
    if (url.pathname === '/webhooks/chatwoot') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'POST_ONLY' });
        return;
      }
      const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.startsWith('application/json')) {
        sendJson(response, 415, { ok: false, error: 'JSON_REQUIRED' });
        return;
      }
      let rawBody;
      try {
        rawBody = await readBody(request);
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE') {
          sendJson(response, 413, { ok: false, error: 'WEBHOOK_BODY_TOO_LARGE' });
          return;
        }
        sendJson(response, 400, { ok: false, error: 'WEBHOOK_BODY_UNREADABLE' });
        return;
      }
      try {
        const result = await outbound.handle({ rawBody, headers: request.headers });
        sendJson(response, result.status, result.body);
      } catch (error) {
        logger.error('webhook.handler_crashed', { code: error?.code ?? 'UNKNOWN' });
        sendJson(response, 500, { ok: false, error: 'WEBHOOK_HANDLER_FAILED', willRetryAutomatically: false });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'BRIDGE_REQUEST_FAILED' });
      else response.end();
    });
  });

  return { server, handleRequest };
}
