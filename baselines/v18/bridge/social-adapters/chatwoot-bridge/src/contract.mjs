/**
 * YENRA <-> Chatwoot protocol contract (pure functions only).
 *
 * This module contains no I/O, no timers, no sockets and no storage. It is the
 * only place where the field contract lives, so the same functions are used by
 * the live bridge and by the synthetic unit tests.
 *
 * Responsibilities:
 *  - stable account-scoped contact identity (same formula as the already
 *    verified Stage J/L/M bindings: "yenra-" + sha256(accountRef + ":" + roomRef)[0..40])
 *  - Host event row validation (only INBOUND rows may be mirrored)
 *  - inbound Chatwoot message payload (source_id + external_created_at +
 *    yenra_original_platform_mid + yenra_history_import)
 *  - Chatwoot webhook signature verification (HMAC-SHA256 of "<ts>.<body>")
 *  - outgoing webhook decision (only real, non-private outgoing messages)
 *  - request shape for the ONE existing Host Sender
 *  - ACK -> Chatwoot status plan (documented, not wired in this delivery)
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CHANNELS = Object.freeze(['Personal', 'Page', 'WhatsApp']);
export const REF_PATTERN = /^[a-f0-9]{32}$/u;
export const MID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,180}$/u;
export const MAX_TEXT = 4000;
export const MAX_CHATWOOT_CONTENT = 4000;
const MIN_PLATFORM_MS = Date.UTC(2000, 0, 1);
const MAX_PLATFORM_FUTURE_MS = 5 * 60 * 1000;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const OWNER_SESSION_PATTERN = /^session-[a-f0-9-]{36}$/u;

export class ContractError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ContractError';
    this.code = code;
  }
}

export function isAccountRef(value) {
  return typeof value === 'string' && REF_PATTERN.test(value);
}

export function isChannel(value) {
  return CHANNELS.includes(value);
}

/**
 * Stable per-account contact identity. MUST stay byte-identical to the formula
 * already used to create the 303 verified staging contacts, otherwise the
 * bridge would create a second contact for the same conversation.
 */
export function stableContactIdentifier(accountRef, roomRef) {
  if (!isAccountRef(accountRef) || !isAccountRef(roomRef)) {
    throw new ContractError('IDENTIFIER_SCOPE_INVALID');
  }
  return `yenra-${createHash('sha256').update(`${accountRef}:${roomRef}`, 'utf8').digest('hex').slice(0, 40)}`;
}

/** Human label used for the four API inbox names (Stage M convention). */
export function inboxLabel({ channel, whatsappOrdinal = 1 }) {
  if (channel === 'Personal') return 'FB Personal';
  if (channel === 'Page') return 'FB Page';
  if (channel === 'WhatsApp') {
    if (!Number.isSafeInteger(whatsappOrdinal) || whatsappOrdinal < 1) {
      throw new ContractError('WHATSAPP_ORDINAL_INVALID');
    }
    return `WhatsApp ${whatsappOrdinal}`;
  }
  throw new ContractError('CHANNEL_INVALID', String(channel));
}

/**
 * Normalise an original platform timestamp to whole Unix seconds.
 * Accepts Unix seconds, Unix milliseconds and ISO-8601 strings (same rules as
 * the Chatwoot fork's normalize_platform_time).
 */
export function normalizePlatformTime(raw, { now = Date.now() } = {}) {
  let ms;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    ms = raw > 1e12 ? raw : raw * 1000;
  } else if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (/^\d{10,13}$/u.test(trimmed)) {
      const numeric = Number(trimmed);
      ms = trimmed.length === 13 ? numeric : numeric * 1000;
    } else {
      ms = Date.parse(trimmed);
    }
  } else {
    throw new ContractError('PLATFORM_TIME_INVALID');
  }
  if (!Number.isFinite(ms)) throw new ContractError('PLATFORM_TIME_INVALID');
  if (ms < MIN_PLATFORM_MS || ms > now + MAX_PLATFORM_FUTURE_MS) {
    throw new ContractError('PLATFORM_TIME_OUT_OF_RANGE');
  }
  return {
    unixSeconds: Math.floor(ms / 1000),
    unixMilliseconds: Math.floor(ms),
    iso: new Date(ms).toISOString(),
  };
}

/**
 * Build the exact Chatwoot API message payload for a mirrored inbound message.
 * Exactly-once is provided by Chatwoot's unique (account, inbox, source_id)
 * index, NOT by any client-side set.
 */
export function buildInboundMessage({ mid, text, nativeMediaType, direction = 'INBOUND', timestamp, historyImport = false, now = Date.now() }) {
  if (direction !== 'INBOUND') throw new ContractError('DIRECTION_NOT_INBOUND', String(direction));
  if (typeof mid !== 'string' || !MID_PATTERN.test(mid)) throw new ContractError('MID_INVALID');
  const hasMedia = ['image', 'video', 'audio', 'file'].includes(nativeMediaType);
  if (typeof text !== 'string' || (!text.trim() && !hasMedia)) throw new ContractError('TEXT_EMPTY');
  if (text.length > MAX_TEXT) throw new ContractError('TEXT_TOO_LONG');
  if (CONTROL_CHARS.test(text)) throw new ContractError('TEXT_HAS_CONTROL_CHARS');
  const time = normalizePlatformTime(timestamp, { now });
  return {
    content: text,
    message_type: 'incoming',
    private: false,
    source_id: mid,
    content_attributes: {
      external_created_at: time.unixSeconds,
      yenra_original_platform_mid: mid,
      yenra_history_import: historyImport === true,
    },
  };
}

/**
 * Validate a Host SSE / room row before mirroring it.
 * Accept INBOUND text or a known native media kind, never an OUTBOUND echo.
 * Media-only content stays empty; the transport must supply native attachments.
 */
export function parseHostEventRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, reason: 'ROW_NOT_OBJECT' };
  if (!isAccountRef(row.accountRef)) return { ok: false, reason: 'ACCOUNT_REF_INVALID' };
  if (!isAccountRef(row.roomRef)) return { ok: false, reason: 'ROOM_REF_INVALID' };
  if (typeof row.mid !== 'string' || !MID_PATTERN.test(row.mid)) return { ok: false, reason: 'MID_INVALID' };
  if (row.direction !== 'INBOUND') {
    return { ok: false, reason: row.direction === 'OUTBOUND' ? 'OUTBOUND_IGNORED' : 'DIRECTION_INVALID' };
  }
  const hasMedia = ['image', 'video', 'audio', 'file'].includes(row.nativeMediaType);
  if (row.nativeMediaType != null && !hasMedia) return { ok: false, reason: 'MEDIA_TYPE_UNSUPPORTED' };
  if (typeof row.text !== 'string' || (!row.text.trim() && !hasMedia)) return { ok: false, reason: 'TEXT_EMPTY_NOT_FORWARDED' };
  if (row.text.length > MAX_TEXT) return { ok: false, reason: 'TEXT_TOO_LONG' };
  if (CONTROL_CHARS.test(row.text)) return { ok: false, reason: 'TEXT_HAS_CONTROL_CHARS' };
  if (!Number.isFinite(row.timestamp) || row.timestamp <= 0) return { ok: false, reason: 'TIMESTAMP_INVALID' };
  return {
    ok: true,
    row: {
      accountRef: row.accountRef,
      roomRef: row.roomRef,
      mid: row.mid,
      text: row.text,
      direction: 'INBOUND',
      timestamp: row.timestamp,
      ...(typeof row.nativeMediaType === 'string' ? { nativeMediaType: row.nativeMediaType } : {}),
    },
  };
}

/**
 * Only the original Host room read for an authenticated Page contact may use
 * this parser. Live SSE mirroring remains INBOUND-ONLY.
 */
export function parseVerifiedPageHistoryRow(row) {
  if (row?.direction !== 'OUTBOUND') return parseHostEventRow(row);
  // Reuse ALL existing MID/media/text/time validation, then restore the
  // original direction. Never label an outgoing platform row as incoming.
  const checked = parseHostEventRow({ ...row, direction: 'INBOUND' });
  return checked.ok ? { ok: true, row: { ...checked.row, direction: 'OUTBOUND' } } : checked;
}

/** Display-only historical outgoing bubble, never a platform Sender request. */
export function buildHistoricalPageOutgoingMessage(row, { now = Date.now() } = {}) {
  if (row?.direction !== 'OUTBOUND') throw new ContractError('HISTORY_OUTBOUND_DIRECTION_INVALID');
  const checked = buildInboundMessage({ ...row, direction: 'INBOUND', historyImport: true, now });
  return { ...checked, message_type: 'outgoing' };
}

/**
 * Verify the Chatwoot webhook signature exactly as the fork emits it:
 *   X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<X-Chatwoot-Timestamp>.<raw body>")
 * plus a replay window on the timestamp.
 */
export function verifyChatwootSignature({
  rawBody,
  timestamp,
  signature,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
} = {}) {
  if (typeof rawBody !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') {
    return { ok: false, reason: 'SIGNATURE_HEADERS_MISSING' };
  }
  if (typeof secret !== 'string' || !secret) return { ok: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'SIGNATURE_TIMESTAMP_INVALID' };
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) return { ok: false, reason: 'SIGNATURE_TIMESTAMP_OUT_OF_WINDOW' };
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  return { ok: true };
}

/** Extract the YENRA scoped contact identifier from a Chatwoot webhook. */
export function webhookContactIdentifier(payload) {
  const conversation = payload?.conversation;
  const fromContactInbox = conversation?.contact_inbox?.source_id;
  const fromSender = conversation?.meta?.sender?.identifier;
  // Chatwoot's own contact_inbox.source_id is the platform peer id for these
  // API inboxes, so the YENRA identifier normally arrives on the contact meta.
  // Accept either field, but only the YENRA-scoped identifier is valid.
  const candidates = [fromSender, fromContactInbox];
  const candidate = candidates.find(
    (value) => typeof value === 'string' && value.startsWith('yenra-') && value.length <= 80,
  );
  return candidate ?? null;
}

/**
 * Decide what to do with one Chatwoot webhook payload.
 * Only a real, non-private, non-empty outgoing message may ever reach a Sender.
 */
export function outboundDecision(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { action: 'ignore', reason: 'PAYLOAD_NOT_OBJECT' };
  }
  if (payload.event !== 'message_created') return { action: 'ignore', reason: 'EVENT_NOT_MESSAGE_CREATED' };
  if (payload.message_type !== 'outgoing') return { action: 'ignore', reason: 'NOT_OUTGOING' };
  if (payload.private === true) return { action: 'ignore', reason: 'PRIVATE_NOTE' };
  // Historical platform OUTBOUND messages belong to the original channel.
  // Never re-send them if a Chatwoot webhook fires despite native history
  // suppression (or if Rails multipart stored attributes as a JSON string).
  let attrs = payload.content_attributes;
  if (typeof attrs === 'string' && attrs.length <= 16000) {
    try { attrs = JSON.parse(attrs); } catch { attrs = null; }
  }
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) &&
      (attrs.yenra_history_import === true || attrs.yenra_history_import === 'true' ||
       (typeof attrs.yenra_original_platform_mid === 'string' &&
        attrs.yenra_original_platform_mid === payload.source_id))) {
    return { action: 'ignore', reason: 'HISTORICAL_PLATFORM_OUTBOUND' };
  }
  if (!Number.isSafeInteger(payload.id) || payload.id <= 0) {
    return { action: 'reject', reason: 'CHATWOOT_MESSAGE_ID_INVALID' };
  }
  // Chatwoot API-inbox media is not yet wired to the one platform media Sender.
  // NEVER treat an attachment-only bubble as a successful blank-text send, or
  // silently send its caption without its attachment.
  if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
    return { action: 'unsupported_media', reason: 'CHATWOOT_NATIVE_MEDIA_OUTBOUND_NOT_WIRED' };
  }
  const content = payload.content;
  if (typeof content !== 'string' || !content.trim()) return { action: 'ignore', reason: 'CONTENT_EMPTY' };
  if (content.length > MAX_CHATWOOT_CONTENT) return { action: 'reject', reason: 'CONTENT_TOO_LONG' };
  if (CONTROL_CHARS.test(content)) return { action: 'reject', reason: 'CONTENT_HAS_CONTROL_CHARS' };
  const identifier = webhookContactIdentifier(payload);
  if (!identifier) return { action: 'reject', reason: 'CONTACT_IDENTIFIER_NOT_YENRA' };
  const conversation = payload.conversation ?? {};
  const conversationDisplayId = Number.isSafeInteger(conversation.id) ? conversation.id : null;
  const inboxId = Number.isSafeInteger(payload.inbox?.id) ? payload.inbox.id : null;
  return {
    action: 'send',
    plan: {
      chatwootMessageId: payload.id,
      chatwootConversationId: conversationDisplayId,
      inboxId,
      identifier,
      text: content,
      chatwootCreatedAt: Number.isFinite(payload.created_at) ? payload.created_at : null,
    },
  };
}

/**
 * Exact body expected by the ONE existing Host Sender route
 * (POST /api/yenra/social-text-send). The Host re-checks account, room, text and
 * the real owner Session before the original channel Sender is used.
 */
export function buildSenderRequest({ channel, sessionId, accountRef, roomRef, text, replyToMessageId } = {}) {
  if (!isChannel(channel)) throw new ContractError('CHANNEL_INVALID', String(channel));
  if (!isAccountRef(accountRef)) throw new ContractError('ACCOUNT_REF_INVALID');
  if (!isAccountRef(roomRef)) throw new ContractError('ROOM_REF_INVALID');
  if (typeof sessionId !== 'string' || !OWNER_SESSION_PATTERN.test(sessionId)) {
    throw new ContractError('OWNER_SESSION_ID_INVALID');
  }
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
    throw new ContractError('SEND_TEXT_INVALID');
  }
  if (CONTROL_CHARS.test(text)) throw new ContractError('SEND_TEXT_HAS_CONTROL_CHARS');
  if (replyToMessageId !== undefined) {
    if (channel !== 'Personal') throw new ContractError('REPLY_ONLY_FOR_PERSONAL');
    if (typeof replyToMessageId !== 'string' || !/^\$[^\s]{5,240}$/u.test(replyToMessageId)) {
      throw new ContractError('REPLY_MESSAGE_ID_INVALID');
    }
  }
  const body = { channel, sessionId, accountRef, roomRef, text };
  if (replyToMessageId !== undefined) body.replyToMessageId = replyToMessageId;
  return { method: 'POST', path: '/api/yenra/social-text-send', body };
}

/**
 * Plan (only a plan) for writing a verified Host ACK back into Chatwoot.
 * Chatwoot only permits this on API inboxes and only forward transitions are
 * accepted by its StatusUpdateService. Not wired to the live SSE feed yet.
 */
export function buildAckPlan({ accountId, conversationDisplayId, chatwootMessageId, ackKind } = {}) {
  const statusByAck = { DELIVERED: 'delivered', READ: 'read', PLAYED: 'read' };
  const status = statusByAck[ackKind];
  if (!status) throw new ContractError('ACK_KIND_UNSUPPORTED', String(ackKind));
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new ContractError('CHATWOOT_ACCOUNT_ID_INVALID');
  if (!Number.isSafeInteger(conversationDisplayId) || conversationDisplayId <= 0) {
    throw new ContractError('CONVERSATION_ID_INVALID');
  }
  if (!Number.isSafeInteger(chatwootMessageId) || chatwootMessageId <= 0) {
    throw new ContractError('CHATWOOT_MESSAGE_ID_INVALID');
  }
  return {
    method: 'PATCH',
    path: `/api/v1/accounts/${accountId}/conversations/${conversationDisplayId}/messages/${chatwootMessageId}`,
    body: { status },
  };
}
