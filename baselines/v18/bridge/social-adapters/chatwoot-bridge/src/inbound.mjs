/**
 * Inbound direction: current DSH Host verified message row -> Chatwoot API inbox.
 *
 * Hard boundaries enforced here:
 *  - only direction INBOUND rows are mirrored (no echo of Chatwoot-originated
 *    outgoing messages back into Chatwoot);
 *  - exactly-once is delegated to Chatwoot's unique (account, inbox, source_id)
 *    index. There is NO client-side dedup store: a repeat POST is expected to
 *    return the same native message. The bounded in-flight map below only
 *    coalesces simultaneous frames for the same platform message in one process;
 *    it is not a durable dedup engine.
 *  - text/contact data never goes to a log sink;
 *  - native media uses original Host authorized bytes and Chatwoot attachments;
 *    unavailable media is counted as failure, never replaced by invented text;
 *  - dry-run mode performs reads only.
 */
import { buildInboundMessage, buildHistoricalPageOutgoingMessage, parseHostEventRow, parseVerifiedPageHistoryRow, stableContactIdentifier } from './contract.mjs';
import { classifySseFrame } from './host-client.mjs';
import { MEDIA_TYPES, postNativeAttachment } from './media-transfer.mjs';

function asInt(value, fallback) {
  return Number.isSafeInteger(value) ? value : fallback;
}

export function createInboundBridge({
  host,
  chatwoot,
  mapping,
  roster,
  logger,
  concurrency = 4,
  freshnessMinutes = 15,
  historyAgeMinutes = 60,
  verifyRoomBeforePost = false,
  dryRun = false,
  ackHandler = null,
  onVerifiedPageContact = null,
  now = () => Date.now(),
} = {}) {
  if (!chatwoot) throw new Error('CHATWOOT_CLIENT_REQUIRED');
  if (!mapping || typeof mapping.get !== 'function') throw new Error('INBOX_MAPPING_REQUIRED');
  if (!logger) throw new Error('LOGGER_REQUIRED');

  const workers = Math.max(1, asInt(concurrency, 4));
  const stats = {
    frames: 0,
    messagesSeen: 0,
    posted: 0,
    planned: 0,
    skipped: 0,
    failed: 0,
    acksSeen: 0,
    acksUpdated: 0,
    byReason: Object.create(null),
  };
  const inFlight = new Map();
  // Unforgeable, invocation-local proof: only a Host-verified Page open may
  // supply cached translations without repeating one Host read per message.
  const pageOpenProof = Symbol('verified-page-open');
  const ackInFlight = new Set();
  // Coalesce one room's first contact/conversation creation across worker jobs.
  // This is not a persistent index; Chatwoot remains the sole source of truth.
  const destinationInFlight = new Map();
  const queue = [];
  let running = 0;
  let idleResolvers = [];

  function bump(reason) {
    stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
  }

  function accountFor(accountRef) {
    const entry = mapping.get(accountRef);
    if (entry) return entry;
    const account = roster?.accounts?.find?.((item) => item.accountRef === accountRef);
    return account ? { ...account, inboxId: null, label: null } : null;
  }

  function roomMeta(accountRef, roomRef) {
    const account = roster?.accounts?.find?.((item) => item.accountRef === accountRef);
    const room = account?.rooms?.find?.((item) => item.roomRef === roomRef);
    return { account: account ?? null, room: room ?? null };
  }

  function withPageNativeMediaType(row) {
    if (accountFor(row?.accountRef)?.channel !== 'Page' || !Array.isArray(row?.media) ||
        row.media.length === 0 || row.nativeMediaType) return row;
    // Only the media TYPE is inferred from original Host metadata. No provider
    // URL enters the incoming Chatwoot payload; the read adapter separately
    // authorizes room + exact MID + signed-CDN origin before downloading.
    const kind = row.media.map((item) => item?.type === 'sticker' ? 'image' : item?.type)
      .find((type) => MEDIA_TYPES.has(type));
    return kind ? { ...row, nativeMediaType: kind } : row;
  }

  async function ensureContact({ accountRef, roomRef, inboxId, identifier }) {
    const existing = await chatwoot.findContactByIdentifier(identifier);
    const { room } = roomMeta(accountRef, roomRef);
    const verifiedName = typeof room?.name === 'string' && room.name.trim() ? room.name.trim().slice(0, 260) : null;
    // Legacy Page roomRefs remain in the old Host roster after a Page contact
    // is migrated to the OFFICIAL SendPulse identity. A verified migration
    // preserves its exact old contact.identifier in this native Chatwoot
    // contact's additional_attributes.yenra_legacy_identifier. Reuse that
    // original conversation rather than creating an empty duplicate contact.
    // The name is only a lookup hint, never identity proof. Match the full
    // saved former identifier AND the exact Page inbox source binding.
    if (accountFor(accountRef)?.channel === 'Page' && verifiedName &&
        (!existing || !existing.last_activity_at) &&
        typeof chatwoot.searchContacts === 'function') {
      const matches = await chatwoot.searchContacts(verifiedName);
      const aliases = matches.filter(c => c?.name === verifiedName &&
        c?.identifier !== identifier &&
        c?.additional_attributes?.yenra_legacy_identifier === identifier &&
        Array.isArray(c?.contact_inboxes) &&
        c.contact_inboxes.some(ci => ci?.inbox?.id === inboxId &&
          ci?.source_id === c.identifier));
      if (aliases.length > 1) throw Error('PAGE_VERIFIED_LEGACY_ALIAS_AMBIGUOUS');
      if (aliases.length === 1) return aliases[0];
    }
    if (existing) {
      // Original authenticated channel roster can resolve a previously
      // generated YENRA placeholder after the first inbound event. Repair
      // ONLY our exact generated placeholder, never a user-renamed contact.
      // Preserve native avatar, account/inbox identity and message history.
      if (['Page','Personal','WhatsApp'].includes(accountFor(accountRef)?.channel) && room?.nameKnown === true &&
          verifiedName && typeof existing.name === 'string' &&
          /^YENRA contact [a-f0-9]{8}$/iu.test(existing.name) &&
          typeof chatwoot.request === 'function' && Number.isSafeInteger(existing.id)) {
        try {
          await chatwoot.request('PUT', `${chatwoot.apiBase}/contacts/${existing.id}`,
            { name: verifiedName });
          existing.name = verifiedName;
        } catch (error) {
          // Name repair must NEVER hold up delivery of a real message.
          logger.warn('contact.verified_placeholder_name_unavailable',
            { code: error?.code ?? 'UNKNOWN' });
        }
      }
      return existing;
    }
    const placeholder = `YENRA contact ${identifier.slice(-8)}`;
    return chatwoot.createContact({
      name: verifiedName ?? placeholder,
      identifier,
      inboxId,
      sourceId: identifier,
    });
  }

  async function ensureConversation({ contact, inboxId, identifier }) {
    const conversations = await chatwoot.listContactConversations(contact.id);
    const open = conversations
      .filter((conversation) => (conversation?.inbox_id ?? conversation?.inbox?.id) === inboxId)
      .sort((a, b) => (b?.timestamp ?? b?.created_at ?? 0) - (a?.timestamp ?? a?.created_at ?? 0));
    if (open.length) return open[0];
    return chatwoot.createConversation({ inboxId, contactId: contact.id, sourceId: identifier });
  }

  function ensureDestination({ accountRef, roomRef, inboxId, identifier }) {
    const key = `${accountRef}|${roomRef}`;
    const existing = destinationInFlight.get(key);
    if (existing) return existing;
    const task = (async () => {
      const contact = await ensureContact({ accountRef, roomRef, inboxId, identifier });
      const conversation = await ensureConversation({ contact, inboxId, identifier });
      return { contact, conversation };
    })();
    destinationInFlight.set(key, task);
    void task.finally(() => {
      if (destinationInFlight.get(key) === task) destinationInFlight.delete(key);
    }).catch(() => {});
    return task;
  }

  async function verifyAgainstHost(row) {
    const account = accountFor(row.accountRef);
    if (!account) return { ok: false, reason: 'ACCOUNT_NOT_IN_ROSTER' };
    try {
      const record = await host.readRoom({ accountRef: row.accountRef, roomRef: row.roomRef, channel: account.channel });
      const messages = Array.isArray(record?.messages) ? record.messages : [];
      const match = messages.find((message) => message?.mid === row.mid && message?.direction === 'INBOUND');
      if (!match) return { ok: false, reason: 'MID_NOT_IN_HOST_ROOM' };
      if (match.text !== row.text) return { ok: false, reason: 'HOST_MESSAGE_TEXT_MISMATCH' };
      // Personal and Page's original Host rooms expose only exact MID/text/scope
      // verified W25 Chinese. Never trust translation from an SSE row or caller.
      const translation = ['Personal', 'Page'].includes(account.channel) && typeof match.translation === 'string'
        && match.translation.trim() && match.translation.length <= 16000
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(match.translation)
        ? match.translation : null;
      return { ok: true, translation };
    } catch (error) {
      return { ok: false, reason: `HOST_ROOM_READ_FAILED:${error?.code ?? 'UNKNOWN'}` };
    }
  }

  async function postOne(row, { historyImport = false, verifiedPageTranslation = null } = {}) {
    const account = accountFor(row.accountRef);
    if (!account) {
      bump('ACCOUNT_NOT_IN_ROSTER');
      return { ok: false, code: 'ACCOUNT_NOT_IN_ROSTER' };
    }
    const inboxId = account.inboxId;
    if (!Number.isSafeInteger(inboxId)) {
      bump('ACCOUNT_WITHOUT_INBOX');
      return { ok: false, code: 'ACCOUNT_WITHOUT_INBOX' };
    }
    // Only a verified, explicitly opened Page room may import its old
    // outgoing bubbles. Live SSE never reaches this branch.
    // Verified external WhatsApp sends are imported as original outgoing
    // history, never routed through the Sender or mislabelled as incoming.
    const historicalOutbound = historyImport === true &&
      ['Page','WhatsApp'].includes(account.channel) && row.direction === 'OUTBOUND';
    let payload;
    try {
      payload = historicalOutbound
        ? buildHistoricalPageOutgoingMessage(row, { now: now() })
        : buildInboundMessage({
          mid: row.mid,
          text: row.text,
          nativeMediaType: row.nativeMediaType,
          direction: row.direction,
          timestamp: row.timestamp,
          historyImport,
          now: now(),
        });
    } catch (error) {
      bump(error?.code ?? 'PAYLOAD_INVALID');
      stats.skipped += 1;
      return { ok: false, code: error?.code ?? 'PAYLOAD_INVALID' };
    }
    if (verifyRoomBeforePost) {
      const verified = await verifyAgainstHost(row);
      if (!verified.ok) {
        bump(verified.reason);
        stats.skipped += 1;
        return { ok: false, code: verified.reason };
      }
      if (verified.translation) {
        // Native Chatwoot create-time translation display; no model invocation,
        // cache write, duplicate message, or modification of original content.
        payload.content_attributes.translations = { zh: verified.translation };
        payload.content_attributes.translation_provider = 'Original Host verified W25';
      }
    } else if (account.channel === 'Page' && historyImport && row.direction === 'INBOUND' &&
      typeof verifiedPageTranslation === 'string' && verifiedPageTranslation.trim() &&
      verifiedPageTranslation.length <= 3500 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(verifiedPageTranslation)) {
      // Read only once when opening this exact verified Page room. Original
      // content and unique platform MID are retained by Chatwoot unchanged.
      payload.content_attributes.translations = { zh: verifiedPageTranslation };
      payload.content_attributes.translation_provider = 'Original Host verified W25';
    }
    const identifier = stableContactIdentifier(row.accountRef, row.roomRef);
    if (dryRun) {
      stats.planned += 1;
      logger.info('inbound.planned', {
        channel: account.channel,
        accountRef: row.accountRef,
        roomRef: row.roomRef,
        inboxId,
        historyImport,
        sourceIdShape: row.mid.includes(':') ? 'namespaced' : 'opaque',
      });
      return { ok: true, planned: true };
    }
    try {
      // Read bytes before creating any Chatwoot entity. Failure never degrades a
      // media row into a text-only message (which would consume its unique MID).
      const media = MEDIA_TYPES.has(row.nativeMediaType)
        ? await host.readMedia({ channel: account.channel, accountRef: row.accountRef, roomRef: row.roomRef, mid: row.mid })
        : null;
      const { contact, conversation } = await ensureDestination({
        accountRef: row.accountRef, roomRef: row.roomRef, inboxId, identifier,
      });
      if(account.channel==='Page' && typeof onVerifiedPageContact==='function')
        void Promise.resolve().then(()=>onVerifiedPageContact({
          accountRef:row.accountRef,roomRef:row.roomRef,contactId:contact.id,
        })).catch(()=>{});
      const displayId = Number.isSafeInteger(conversation.display_id) ? conversation.display_id : conversation.id;
      const message = media
        ? await postNativeAttachment(chatwoot, displayId, payload, media)
        : historicalOutbound
          ? await chatwoot.createHistoricalOutgoingMessage(displayId, payload)
          : await chatwoot.createIncomingMessage(displayId, payload);
      stats.posted += 1;
      logger.info('inbound.posted', {
        channel: account.channel,
        accountRef: row.accountRef,
        roomRef: row.roomRef,
        inboxId,
        conversationDisplayId: displayId,
        chatwootMessageId: Number.isSafeInteger(message?.id) ? message.id : null,
        historyImport,
      });
      return { ok: true, conversationDisplayId: displayId, chatwootMessageId: message?.id ?? null };
    } catch (error) {
      stats.failed += 1;
      const code = error?.code ?? 'INBOUND_POST_FAILED';
      bump(code);
      logger.warn('inbound.failed', {
        channel: account.channel,
        accountRef: row.accountRef,
        roomRef: row.roomRef,
        code,
      });
      return { ok: false, code };
    }
  }

  function enqueue(row, options) {
    const key = `${row.accountRef}|${row.mid}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const task = new Promise((resolve) => {
      queue.push({ row, options, resolve });
      pump();
    }).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, task);
    return task;
  }

  function pump() {
    while (running < workers && queue.length) {
      const job = queue.shift();
      running += 1;
      Promise.resolve()
        .then(() => postOne(job.row, job.options))
        .then(job.resolve, (error) => {
          stats.failed += 1;
          bump(error?.code ?? 'INBOUND_TASK_CRASH');
          job.resolve({ ok: false, code: error?.code ?? 'INBOUND_TASK_CRASH' });
        })
        .finally(() => {
          running -= 1;
          if (running === 0 && queue.length === 0) {
            const resolvers = idleResolvers;
            idleResolvers = [];
            for (const resolve of resolvers) resolve();
          }
          pump();
        });
    }
  }

  /** Inspect the event row and queue it when it is a fresh inbound message. */
  function handleFrame(frame) {
    stats.frames += 1;
    const classified = classifySseFrame(frame);
    if (classified.kind === 'ack') {
      stats.acksSeen += 1;
      // Native status writes occur ONLY for an exact persisted provider MID.
      // No sender-memory fallback, timestamp guess, or Page read inference.
      if (!ackHandler) { bump('ACK_NOT_WIRED'); return { kind: 'ack', acted: false }; }
      const task = Promise.resolve().then(() => ackHandler.handle(classified.ack)).then((result) => {
        if (result?.updated === true) stats.acksUpdated += 1;
        else if (!result?.ok) bump(result?.code ?? 'ACK_UNRESOLVED');
      }).catch(() => bump('ACK_PROCESS_FAILED'));
      ackInFlight.add(task);
      void task.finally(() => ackInFlight.delete(task));
      return { kind: 'ack', acted: true };
    }
    if (classified.kind === 'externalPageOutgoing') {
      // Official SendPulse REST already verified the exact source MID,
      // bot/Page/contact/PSID and OUTBOUND direction in the ONE Host.
      // Import only a native history bubble; never invoke the platform Sender.
      const parsed = parseVerifiedPageHistoryRow(
        withPageNativeMediaType(classified.row));
      const source = accountFor(parsed.ok ? parsed.row.accountRef : null);
      const meta = parsed.ok ? roomMeta(parsed.row.accountRef,parsed.row.roomRef) : null;
      const ageMs = parsed.ok ? now() - parsed.row.timestamp : Infinity;
      if (!parsed.ok || source?.channel !== 'Page' || !meta?.room ||
          ageMs < -300000 || ageMs > freshnessMinutes*60000) {
        stats.skipped += 1;
        bump(parsed.ok ? 'UNVERIFIED_OR_STALE_PAGE_OUTGOING' : parsed.reason);
        return {kind:'skip',reason:parsed.ok?'UNVERIFIED_OR_STALE_PAGE_OUTGOING':parsed.reason};
      }
      stats.messagesSeen += 1;
      void enqueue(parsed.row, {historyImport:true});
      return {kind:'queuedExternalPageOutgoing'};
    }
    if (classified.kind !== 'message') {
      bump(classified.reason ?? 'IGNORED');
      return { kind: 'ignore', reason: classified.reason };
    }
    const parsed = parseHostEventRow(withPageNativeMediaType(classified.row));
    if (!parsed.ok) {
      stats.skipped += 1;
      bump(parsed.reason);
      return { kind: 'skip', reason: parsed.reason };
    }
    const ageMs = now() - parsed.row.timestamp;
    if (ageMs > freshnessMinutes * 60 * 1000) {
      stats.skipped += 1;
      bump('STALE_EVENT_SKIPPED');
      return { kind: 'skip', reason: 'STALE_EVENT_SKIPPED' };
    }
    stats.messagesSeen += 1;
    void enqueue(parsed.row, { historyImport: false });
    return { kind: 'queued' };
  }

  /**
   * Explicit catch-up / backfill entry point (operator-invoked, not a loop).
   * Rows older than historyAgeMinutes are marked yenra_history_import so the
   * fork keeps their real time but triggers no notification, reopen or webhook.
   */
  async function syncRow(row, { forceHistoryImport = null, pageContactOpened = false,
    whatsappVerifiedRoomOpened = false, pageVerifiedProof = null } = {}) {
    const typed = withPageNativeMediaType(row);
    // This direction-aware parser is used ONLY after a verified, scoped room
    // read, never for arbitrary SSE or untrusted browser-supplied rows.
    const parsed = pageContactOpened === true || whatsappVerifiedRoomOpened === true
      ? parseVerifiedPageHistoryRow(typed) : parseHostEventRow(typed);
    if (!parsed.ok) {
      stats.skipped += 1;
      bump(parsed.reason);
      return { ok: false, code: parsed.reason };
    }
    const account = accountFor(parsed.row.accountRef);
    // Page is roster-only by default. Merely listing/refreshing its contacts
    // must never synthesize conversations or import old message history.
    // A real incoming SSE event uses handleFrame above and remains live.
    if (account?.channel === 'Page' && pageContactOpened !== true) {
      stats.skipped += 1;
      bump('PAGE_HISTORY_ON_DEMAND_ONLY');
      return { ok: false, code: 'PAGE_HISTORY_ON_DEMAND_ONLY' };
    }
    const ageMs = now() - parsed.row.timestamp;
    const historyImport =
      forceHistoryImport === null ? ageMs > historyAgeMinutes * 60 * 1000 : forceHistoryImport === true;
    const verifiedPageTranslation = pageContactOpened === true && pageVerifiedProof === pageOpenProof &&
      account?.channel === 'Page' && parsed.row.direction === 'INBOUND' &&
      parsed.row.mid === row.mid && parsed.row.text === row.text ? row.translation : null;
    return enqueue(parsed.row, { historyImport, verifiedPageTranslation });
  }

  /** One bounded, owner-selected WhatsApp room read. Import only original
   * OUTBOUND MIDs missing from Chatwoot (e.g. sent on official WhatsApp).
   * A native Chatwoot reply has its original MID in content_attributes,
   * so it is NEVER copied as a second bubble. No send, second login or poll.
   */
  async function openWhatsAppRoomOnDemand({ accountRef, roomRef, maxMessages = 24 } = {}) {
    const { account, room } = roomMeta(accountRef, roomRef);
    if (account?.channel !== 'WhatsApp' || !room ||
        !Number.isSafeInteger(accountFor(accountRef)?.inboxId) ||
        !Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 40) {
      return { ok:false, code:'VERIFIED_WA_ROOM_NOT_IN_ROSTER' };
    }
    let record;
    try { record = await host.readRoom({ accountRef, roomRef, channel:'WhatsApp' }); }
    catch { return { ok:false, code:'ORIGINAL_WA_ROOM_READ_UNAVAILABLE' }; }
    if (record?.accountRef !== accountRef || record?.roomRef !== roomRef ||
        !Array.isArray(record.messages))
      return {ok:false,code:'ORIGINAL_WA_ROOM_SCOPE_MISMATCH'};
    const identifier=stableContactIdentifier(accountRef,roomRef);
    const contact=await chatwoot.findContactByIdentifier(identifier);
    if (!contact) return {ok:false,code:'NATIVE_WA_CONTACT_NOT_FOUND'};
    const conversations=await chatwoot.listContactConversations(contact.id);
    const nativeConversation=conversations.find(item =>
      (item?.inbox_id??item?.inbox?.id)===accountFor(accountRef).inboxId);
    const displayId=nativeConversation?.display_id??nativeConversation?.id;
    if (!Number.isSafeInteger(displayId) || displayId<=0)
      return {ok:false,code:'NATIVE_WA_CONVERSATION_NOT_FOUND'};
    // If Chatwoot cannot read its own MIDs, refuse rather than risk duplicate
    // imports of a YENRA-originated message after a Bridge restart.
    const nativeRows=await chatwoot.listConversationMessages(displayId);
    const already=new Set();
    for (const row of nativeRows) {
      for (const mid of [row?.source_id,row?.content_attributes?.yenra_outbound_provider_mid,
        row?.content_attributes?.yenra_verified_outbound_provider_mid]) {
        if(typeof mid==='string' && mid) already.add(mid);
      }
    }
    const outgoing=record.messages.slice(-maxMessages).filter(row =>
      row?.direction==='OUTBOUND' && typeof row.mid==='string' && !already.has(row.mid));
    // Only the selected conversation, small batch. Existing native source_id
    // and history_import keep re-selection idempotent and silent.
    const results=await Promise.all(outgoing.slice(-12).map(row=>
      syncRow({...row,accountRef,roomRef},{forceHistoryImport:true,
        whatsappVerifiedRoomOpened:true})));
    return {ok:true,imported:results.filter(x=>x?.ok===true).length,
      skipped:results.filter(x=>x?.ok!==true).length,displayId};
  }

  /** Explicit caller-only Page conversation open. Does nothing during roster load. */
  async function openPageRoomOnDemand({ accountRef, roomRef, maxMessages = 20, onlyOutbound = false } = {}) {
    const { account, room } = roomMeta(accountRef, roomRef);
    if (!account || account.channel !== 'Page' || !room ||
        !Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 200) {
      return { ok: false, code: 'PAGE_OPEN_SCOPE_INVALID' };
    }
    if (!host || typeof host.readRoom !== 'function') {
      return { ok: false, code: 'PAGE_HOST_ROOM_UNAVAILABLE' };
    }
    let record;
    try {
      record = await host.readRoom({ accountRef, roomRef, channel: 'Page' });
    } catch {
      return { ok: false, code: 'PAGE_HOST_ROOM_READ_FAILED' };
    }
    if (record?.accountRef !== accountRef || record?.roomRef !== roomRef ||
        !Array.isArray(record.messages)) {
      return { ok: false, code: 'PAGE_HOST_ROOM_SCOPE_INVALID' };
    }
    // First screen only; keep original Host as source for older pages. This
    // remains a read-on-click path, not a background backfill or second DB.
    const recent = record.messages.slice(-maxMessages);
    // Page SSE does not cover every external Meta send / reconnect. Both
    // verified message directions are eligible, deduplicated by the SAME
    // authoritative platform MID as Chatwoot's native source_id.
    const selected = onlyOutbound === true
      ? recent.filter(message => message?.direction === 'OUTBOUND') : recent;
    let existingDisplayId = null;
    let alreadyInNative = new Set();
    const nativeOutgoingByMid = new Map();
    try {
      const identifier = stableContactIdentifier(accountRef, roomRef);
      const contact = await chatwoot.findContactByIdentifier(identifier);
      if (contact) {
        const conversations = await chatwoot.listContactConversations(contact.id);
        const conversation = conversations.find(item =>
          (item?.inbox_id ?? item?.inbox?.id) === accountFor(accountRef)?.inboxId);
        const id = conversation?.display_id ?? conversation?.id;
        if (Number.isSafeInteger(id) && id > 0) {
          existingDisplayId = id;
          if (typeof chatwoot.listConversationMessages === 'function') {
            const nativeRows = await chatwoot.listConversationMessages(id);
            alreadyInNative = new Set(nativeRows.map(row => row?.source_id)
              .filter(mid => typeof mid === 'string' && mid));
            for(const row of nativeRows){
              if(typeof row?.source_id==='string'&&
                  (row?.message_type==='outgoing'||row?.message_type===1)&&
                  Number.isSafeInteger(row?.id)&&row?.private!==true&&
                  row?.content_attributes?.yenra_history_import===true){
                nativeOutgoingByMid.set(row.source_id,{id:row.id,status:row.status});
              }
            }
          }
        }
      }
    } catch (error) {
      // A native list failure must not hide verified provider messages:
      // Chatwoot's original MID idempotence remains the final safeguard.
      logger.warn('page.native_message_dedup_unavailable',
        { code: error?.code ?? 'UNKNOWN' });
    }
    const missing = selected.filter(message =>
      typeof message?.mid === 'string' && !alreadyInNative.has(message.mid));
    // Page's original authorized SDK preserves the media metadata but does
    // not emit nativeMediaType. Derive only at this explicitly clicked room;
    // the HostClient will independently re-read/verify exact MID and CDN URL.
    // Never import a provider-media row as text-only if its bytes are missing.
    const outcomes = await Promise.all(missing.map((message) => {
      const nativeTypes = Array.isArray(message.media) ? message.media.map((item) =>
        item?.type === 'sticker' ? 'image' : item?.type).filter((type) => MEDIA_TYPES.has(type)) : [];
      const row = { ...message, accountRef, roomRef,
        ...(nativeTypes.length > 0 ? { nativeMediaType: nativeTypes[0] } : {}) };
      return syncRow(row, { forceHistoryImport: true, pageContactOpened: true,
        pageVerifiedProof: pageOpenProof });
    }));
    const imported = outcomes.filter((outcome) => outcome.ok).length;
    const skipped = outcomes.length - imported;
    let conversationDisplayId = outcomes.find(outcome =>
      outcome.ok && Number.isSafeInteger(outcome.conversationDisplayId))?.conversationDisplayId ?? existingDisplayId;
    // A contact with no historic rows can still have a real live conversation.
    // Reuse it without inventing a new one for an empty Page contact.
    if (!conversationDisplayId) {
      const identifier = stableContactIdentifier(accountRef, roomRef);
      const contact = await chatwoot.findContactByIdentifier(identifier);
      if (contact) {
        const conversations = await chatwoot.listContactConversations(contact.id);
        const existing = conversations.find(item =>
          (item?.inbox_id ?? item?.inbox?.id) === accountFor(accountRef)?.inboxId);
        const id = existing?.display_id ?? existing?.id;
        if (Number.isSafeInteger(id) && id > 0) conversationDisplayId = id;
      }
    }
    // Page receipt is provider evidence, not a Chatwoot local "sent" row.
    // Use ONLY an officially verified SendPulse Page room, bound outgoing
    // history, the exact original provider MID and a monotone status change.
    // Neither old Pancake room data nor a pending YENRA Sender claim qualifies.
    let receiptsUpdated=0,receiptsFailed=0;
    if(room.source==='SENDPULSE_OFFICIAL_REST_API' &&
        record.verifiedReceiptProvider==='SENDPULSE_OFFICIAL_REST_API' &&
        Number.isSafeInteger(conversationDisplayId) &&
        typeof chatwoot.updateMessageStatus==='function'){
      for(let i=0;i<missing.length;i++){
        if(missing[i]?.direction==='OUTBOUND' &&
            outcomes[i]?.ok===true && Number.isSafeInteger(outcomes[i]?.chatwootMessageId)){
          nativeOutgoingByMid.set(missing[i].mid,{
            id:outcomes[i].chatwootMessageId,status:'sent'});
        }
      }
      const rank={sent:0,delivered:1,read:2};
      const providerReceipts=selected.filter(row=>
        row?.direction==='OUTBOUND' &&
        row?.providerReceipt?.source==='SENDPULSE_OFFICIAL_REST_API' &&
        ['delivered','read'].includes(row.providerReceipt.status) &&
        Number.isFinite(row.providerReceipt.confirmedAt) &&
        Number.isFinite(row.timestamp) &&
        row.providerReceipt.confirmedAt>=row.timestamp &&
        row.providerReceipt.confirmedAt<=now()+300000).slice(-6);
      for(const row of providerReceipts){
        const target=nativeOutgoingByMid.get(row.mid);
        if(!target||!Number.isSafeInteger(target.id)||
            !(target.status in rank)||
            rank[target.status]>=rank[row.providerReceipt.status])continue;
        try{
          await chatwoot.updateMessageStatus(conversationDisplayId,
            target.id,row.providerReceipt.status);
          target.status=row.providerReceipt.status;
          receiptsUpdated++;
        }catch(error){
          receiptsFailed++;
          logger.warn('page.provider_receipt_unavailable',
            {code:error?.code??'UNKNOWN'});
        }
      }
      if(receiptsUpdated)logger.info('page.provider_receipts_synced',
        {receiptsUpdated,channel:'Page'});
    }
    return {
      ok: true, imported, skipped, alreadyNative: selected.length - missing.length,
      conversationDisplayId,receiptsUpdated,receiptsFailed,
      hasOlder: record.messages.length > recent.length,
      source: 'original-host-on-contact-click',
    };
  }

  /**
   * ONE bounded nonblocking catch-up after Desktop/Bridge cold start.
   * The original Host owns the Page roster; only its recently active rooms
   * may create REAL native Chatwoot conversations from verified source MIDs.
   * This repairs missed activity during shutdown without replaying 300 Page
   * histories, and also replaces old autogenerated placeholder contact names.
   */
  async function reconcileRecentPageRooms() {
    if (dryRun) return { ok: true, skippedDryRun: true };
    const stamp = now();
    const cutoff = stamp - 72 * 60 * 60 * 1000;
    const toTime = (value) => Number.isFinite(value)
      ? value > 1e11 ? value : value > 1e9 ? value * 1000 : 0 : 0;
    const latest = (roster?.accounts ?? [])
      .filter((account) => account.channel === 'Page' &&
        Number.isSafeInteger(accountFor(account.accountRef)?.inboxId))
      .flatMap((account) => (account.rooms ?? [])
        .filter(room => room.source !== 'SENDPULSE_OFFICIAL_REST_API')
        .map((room) => ({
        accountRef: account.accountRef, room,
        inboxId: accountFor(account.accountRef).inboxId,
        at: toTime(room.lastMessageAt),
      })))
      .filter((scope) => scope.at > cutoff && scope.at <= stamp + 300_000)
      .sort((a, b) => b.at - a.at).slice(0, 40);
    const summary = { considered: latest.length, alreadyNative: 0,
      newConversations: 0, newlyImported: 0, repairedNames: 0, failures: 0 };
    let consecutiveFailures = 0;
    for (const { accountRef, room, inboxId } of latest) {
      try {
        const identifier = stableContactIdentifier(accountRef, room.roomRef);
        const existing = await chatwoot.findContactByIdentifier(identifier);
        if (existing) {
          const previousName = existing.name;
          const wasPlaceholder = /^YENRA contact [a-f0-9]{8}$/iu.test(previousName ?? '');
          const refreshed = await ensureContact({accountRef, roomRef: room.roomRef,
            inboxId, identifier});
          if (wasPlaceholder && refreshed?.name !== previousName) summary.repairedNames++;
          const conversations = await chatwoot.listContactConversations(refreshed?.id ?? existing.id);
          if (conversations.some((c) => (c?.inbox_id ?? c?.inbox?.id) === inboxId)) {
            summary.alreadyNative++;
            consecutiveFailures = 0;
            continue;
          }
        }
        const outcome = await openPageRoomOnDemand({
          accountRef, roomRef: room.roomRef, maxMessages: 5, onlyOutbound: false,
        });
        if (outcome?.ok === true &&
            Number.isSafeInteger(outcome.conversationDisplayId)) {
          summary.newConversations++;
          summary.newlyImported += outcome.imported ?? 0;
          consecutiveFailures = 0;
        } else {
          summary.failures++;
          consecutiveFailures++;
        }
      } catch {
        summary.failures++;
        consecutiveFailures++;
      }
      // Fail closed on sustained original SDK errors/429; never retry all
      // 300 Page histories in a loop or block fresh real-time SSE.
      if (consecutiveFailures >= 3) break;
    }
    return {ok:true, ...summary};
  }

  async function drain() {
    if (running !== 0 || queue.length !== 0) {
      await new Promise((resolve) => {
        idleResolvers.push(resolve);
        pump();
      });
    }
    // Graceful isolated shutdown must also wait for in-progress native ACK
    // status writes, without introducing another durable queue or database.
    await Promise.allSettled([...ackInFlight]);
  }

  return { handleFrame, syncRow, openPageRoomOnDemand, openWhatsAppRoomOnDemand,
    reconcileRecentPageRooms, drain, stats, inFlight };
}
