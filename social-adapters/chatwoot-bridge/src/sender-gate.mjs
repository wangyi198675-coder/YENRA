/**
 * The ONLY component in this adapter allowed to issue a POST to the current
 * DSH Host, and only toward the ONE existing sender route:
 *
 *   POST /api/yenra/social-text-send
 *
 * The gate fails closed at construction time:
 *  - ENABLE_REAL_SEND must be exactly "true" (checked by config/index);
 *  - a real owner Session id must be supplied by the operator (the Host verifies
 *    that Session belongs to the real owner; this bridge can neither mint nor
 *    invent one). The session id never leaves this module;
 *  - only the documented route and body shape are accepted.
 *
 * No retry is attempted here. The Host Sender deliberately returns
 * deliveryStatus "UNKNOWN" after submission; an unconfirmed result is reported
 * to the caller and never auto-resent.
 */
import { buildSenderRequest, MID_PATTERN } from './contract.mjs';

export class SenderGateError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SenderGateError';
    this.code = code;
  }
}

export const SENDER_ROUTE = '/api/yenra/social-text-send';

/**
 * @param {object} options
 * @param {string} options.baseUrl DSH Host base URL
 * @param {boolean} options.enabled must be true to create a sender at all
 * @param {string} options.ownerSessionId real Host owner session id
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {object} [options.logger]
 */
export function createHostSender({
  baseUrl,
  resolveBaseUrl = null,
  enabled = false,
  ownerSessionId = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 90000,
  logger = null,
} = {}) {
  if (enabled !== true) throw new SenderGateError('REAL_SEND_DISABLED_AT_CONSTRUCTION');
  if (typeof ownerSessionId !== 'string' || !/^session-[a-f0-9-]{36}$/u.test(ownerSessionId)) {
    throw new SenderGateError('OWNER_SESSION_ID_INVALID');
  }
  if (typeof baseUrl !== 'string' || !baseUrl) throw new SenderGateError('HOST_BASE_URL_INVALID');
  if (resolveBaseUrl !== null && typeof resolveBaseUrl !== 'function') throw new SenderGateError('HOST_RESOLVER_INVALID');
  if (typeof fetchImpl !== 'function') throw new SenderGateError('FETCH_IMPL_MISSING');

  /**
   * Send one already-verified outgoing message through the existing Host Sender.
   * @param {{channel: string, accountRef: string, roomRef: string, text: string, replyToMessageId?: string}} input
   */
  async function send(input) {
    const request = buildSenderRequest({ ...input, sessionId: ownerSessionId });
    let activeBaseUrl = baseUrl;
    if (resolveBaseUrl) {
      try { activeBaseUrl = await resolveBaseUrl(); }
      catch { throw new SenderGateError('HOST_SENDER_ACTIVE_HOST_UNAVAILABLE'); }
      // Only the existing verified DSH Host on loopback may replace the stale
      // startup port. Do not accept a remote or client-supplied Sender URL.
      if (typeof activeBaseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/u.test(activeBaseUrl)) {
        throw new SenderGateError('HOST_SENDER_ACTIVE_HOST_SCOPE_INVALID');
      }
    }
    let response;
    try {
      response = await fetchImpl(`${activeBaseUrl.replace(/\/+$/u, '')}${SENDER_ROUTE}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new SenderGateError('HOST_SENDER_TIMEOUT_UNCONFIRMED');
      }
      throw new SenderGateError('HOST_SENDER_NETWORK_UNCONFIRMED');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new SenderGateError(`HOST_SENDER_HTTP_${response.status}`, 'unconfirmed; do not auto-resend');
    }
    const receipt = payload?.receipt;
    if (!receipt || payload?.ok !== true || receipt.sent !== true || receipt.submitted !== true) {
      throw new SenderGateError('HOST_SENDER_RECEIPT_UNCONFIRMED');
    }
    if (receipt.deliveryStatus !== 'UNKNOWN' || receipt.delivered !== false) {
      // Host acceptance must not be promoted into provider delivery.
      throw new SenderGateError('HOST_SENDER_RECEIPT_SHAPE_UNEXPECTED');
    }
    if (receipt.channel !== input.channel || receipt.accountRef !== input.accountRef ||
        receipt.roomRef !== input.roomRef) {
      throw new SenderGateError('HOST_SENDER_RECEIPT_SCOPE_MISMATCH');
    }
    // Personal's one original Matrix Sender returns the verified Matrix
    // event ID as matrixEventId and providerMessageId:null. Its original
    // personal-read-ack uses that same $event ID. Dropping it here means a
    // successfully submitted Personal message can never bind its read ACK.
    const originalMid = receipt.channel === 'Personal'
      ? receipt.matrixEventId : receipt.providerMessageId;
    if (originalMid != null &&
        (typeof originalMid !== 'string' || !MID_PATTERN.test(originalMid) ||
         (receipt.channel === 'Personal' && !/^\$[^\s]{5,179}$/u.test(originalMid)))) {
      throw new SenderGateError('HOST_SENDER_PROVIDER_MID_INVALID');
    }
    logger?.info?.('sender.submitted', {
      channel: receipt.channel,
      accountRef: receipt.accountRef,
      roomRef: receipt.roomRef,
      providerMessageIdShape: typeof originalMid === 'string' ? 'present' : 'absent',
    });
    return {
      submitted: true,
      deliveryStatus: 'UNKNOWN',
      delivered: false,
      providerMessageId: typeof originalMid === 'string' ? originalMid : null,
      // Matrix acceptance is transport-only; WhatsApp socket submission is
      // likewise not a DELIVERED/READ platform receipt.
      platformAccepted: receipt.channel === 'Page' && receipt.providerAccepted === true,
      transportAccepted: receipt.channel === 'Personal' ? receipt.matrixAccepted === true : receipt.submitted === true,
      channel: receipt.channel,
      accountRef: receipt.accountRef,
      roomRef: receipt.roomRef,
    };
  }

  return { send, enabled: true, route: SENDER_ROUTE };
}
