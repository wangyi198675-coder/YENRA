/**
 * Outbound direction: Chatwoot webhook -> the ONE existing Host Sender.
 *
 * Default posture is REFUSE: without an injected, explicitly constructed sender
 * (sender-gate.mjs requires ENABLE_REAL_SEND=true plus a real owner Session id)
 * every accepted outgoing message is answered with 202 SKIPPED_REAL_SEND_DISABLED
 * and NO network write happens anywhere.
 *
 * Echo / MID handling (see README for the full contract):
 *  - inbound mirroring only ever accepts direction INBOUND, so a Chatwoot reply
 *    can never be re-imported as an incoming message (no echo loop);
 *  - Chatwoot-originated messages carry no platform MID; the platform MID is
 *    only known after the Host Sender accepts the message. The receipt MID is
 *    correlated in memory (bounded) for a future ACK write-back; it is not
 *    persisted because this adapter is not allowed to own a second store;
 *  - duplicate webhook deliveries within one process are collapsed by Chatwoot
 *    message id. This is a delivery guard, not a message-identity engine: real
 *    exactly-once message identity in the inbound direction remains Chatwoot's
 *    unique (account, inbox, source_id) index.
 */
import { MID_PATTERN, outboundDecision, verifyChatwootSignature } from './contract.mjs';

const MAX_BODY_BYTES = 1_000_000;
const PROCESSED_LIMIT = 512;
const CORRELATION_LIMIT = 256;

function header(headers, name) {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * @param {object} options
 * @param {object|null} [options.sender] created by sender-gate.createHostSender, or null
 * @param {object} options.index buildRosterIndex() result
 * @param {object} options.logger
 * @param {{default?: string, byInbox?: Record<string,string>}} [options.secrets]
 * @param {number} [options.toleranceSeconds]
 * @param {() => number} [options.nowSeconds]
 */
export function createOutboundHandler({
  sender = null,
  deliveryAuthority = null,
  host = null,
  index,
  logger,
  secrets = { default: '', byInbox: {} },
  toleranceSeconds = 300,
  nowSeconds = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (!index || typeof index.byIdentifier?.get !== 'function') throw new Error('ROSTER_INDEX_REQUIRED');
  if (!logger) throw new Error('LOGGER_REQUIRED');
  // A direct Sender without an authenticated durable native Chatwoot claim is
  // forbidden even when an owner Session exists. No memory-only delivery gate.
  if (sender && (typeof deliveryAuthority?.claim !== 'function' ||
                 typeof deliveryAuthority?.recordReceipt !== 'function')) {
    throw new Error('NATIVE_DURABLE_DELIVERY_AUTHORITY_REQUIRED');
  }

  const processed = new Map();
  const inFlight = new Map();
  const correlations = new Map();

  function secretForInbox(inboxId) {
    const byInbox = secrets.byInbox ?? {};
    if (Number.isSafeInteger(inboxId) && typeof byInbox[inboxId] === 'string' && byInbox[inboxId]) return byInbox[inboxId];
    return typeof secrets.default === 'string' ? secrets.default : '';
  }

  // Retain only a bounded outcome marker. Never turn an UNKNOWN send replay
  // into a successful 2xx webhook response: Chatwoot would show a false tick.
  function rememberProcessed(messageId, state = 'unknown-no-retry') {
    processed.delete(messageId);
    processed.set(messageId, { at: nowSeconds(), state });
    while (processed.size > PROCESSED_LIMIT) processed.delete(processed.keys().next().value);
  }

  function rememberCorrelation(row) {
    if (!row.providerMessageId) return;
    correlations.set(row.providerMessageId, row);
    while (correlations.size > CORRELATION_LIMIT) correlations.delete(correlations.keys().next().value);
  }

  function summary(plan, scope) {
    return {
      channel: scope.channel,
      accountRef: scope.accountRef,
      roomRef: scope.roomRef,
      inboxId: scope.inboxId,
      textLength: plan.text.length,
      chatwootMessageId: plan.chatwootMessageId,
    };
  }

  async function originalWhatsAppOutbox(scope) {
    if (typeof host?.readRoom !== 'function' || scope.channel !== 'WhatsApp') return null;
    const record = await host.readRoom({
      channel: 'WhatsApp', accountRef: scope.accountRef, roomRef: scope.roomRef,
    });
    if (record?.accountRef !== scope.accountRef || record?.roomRef !== scope.roomRef ||
        !Array.isArray(record.messages)) throw new Error('ORIGINAL_WA_ROOM_SCOPE_MISMATCH');
    return record.messages.filter(row => row?.direction === 'OUTBOUND' &&
      typeof row.mid === 'string' && MID_PATTERN.test(row.mid));
  }

  async function deliver(plan, scope, claimId) {
    // The SAME original DSH-IM inbox is an authoritative read of socket MIDs.
    // Snapshot before the one send. A provider MID missing in a compatibility
    // receipt is recovered ONLY if exactly one new, same-room, same-text
    // original MID appears after submission. No generated IDs or resend.
    let baseline = null;
    try {
      const original = await originalWhatsAppOutbox(scope);
      if (original) baseline = new Set(original.map(row => row.mid));
    } catch (error) {
      logger.warn('outbound.original_mid_baseline_unavailable',
        { ...summary(plan, scope), code: error?.code ?? 'HOST_ROOM_READ_FAILED' });
    }
    const sendStartedAt = Date.now();
    // The gate builds the exact Host request (including the owner Session id,
    // which never leaves sender-gate.mjs) and re-validates every field.
    const receipt = await sender.send({
      channel: scope.channel,
      accountRef: scope.accountRef,
      roomRef: scope.roomRef,
      text: plan.text,
    });
    if (!receipt.providerMessageId && baseline && scope.channel === 'WhatsApp') {
      let matched = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 225));
        let current;
        try { current = await originalWhatsAppOutbox(scope); }
        catch { continue; }
        const candidates = current.filter(row =>
          !baseline.has(row.mid) && row.text === plan.text &&
          Number.isFinite(row.timestamp) && row.timestamp >= sendStartedAt - 1500 &&
          row.timestamp <= Date.now() + 1500);
        if (candidates.length > 1) throw new Error('ORIGINAL_WA_MID_AMBIGUOUS');
        if (candidates.length === 1) { matched = candidates[0]; break; }
      }
      if (matched) {
        receipt.providerMessageId = matched.mid;
        logger.info('outbound.original_mid_verified', {
          ...summary(plan, scope), providerMessageIdShape: 'present',
        });
      }
    }
    // The platform Sender can already have submitted a real message. If the
    // durable receipt cannot be proven, leave the committed claim UNKNOWN
    // for reconciliation; NEVER call the Host Sender again on a retry.
    const persisted = await deliveryAuthority.recordReceipt({ plan, scope, claimId, receipt });
    if (persisted?.bound !== true) throw Error('NATIVE_RECEIPT_UNCONFIRMED');
    rememberCorrelation({
      providerMessageId: receipt.providerMessageId,
      chatwootMessageId: plan.chatwootMessageId,
      conversationDisplayId: plan.chatwootConversationId,
      channel: scope.channel,
      roomRef: scope.roomRef,
      at: nowSeconds(),
    });
    return receipt;
  }

  /**
   * @param {object} input
   * @param {string} input.rawBody
   * @param {Record<string,string|string[]>} input.headers
   * @returns {Promise<{status:number, body:object}>}
   */
  async function handle({ rawBody, headers }) {
    if (typeof rawBody !== 'string' || !rawBody) return { status: 400, body: { ok: false, error: 'WEBHOOK_BODY_EMPTY' } };
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return { status: 413, body: { ok: false, error: 'WEBHOOK_BODY_TOO_LARGE' } };
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { ok: false, error: 'WEBHOOK_BODY_NOT_JSON' } };
    }
    const inboxId = Number.isSafeInteger(payload?.inbox?.id) ? payload.inbox.id : null;
    const verification = verifyChatwootSignature({
      rawBody,
      timestamp: header(headers, 'x-chatwoot-timestamp'),
      signature: header(headers, 'x-chatwoot-signature'),
      secret: secretForInbox(inboxId),
      toleranceSeconds,
      nowSeconds: nowSeconds(),
    });
    if (!verification.ok) {
      logger.warn('outbound.signature_rejected', { reason: verification.reason, inboxId });
      return { status: 401, body: { ok: false, error: verification.reason } };
    }

    const decision = outboundDecision(payload);
    if (decision.action === 'ignore') {
      return { status: 200, body: { ok: true, ignored: true, reason: decision.reason } };
    }
    if (decision.action === 'unsupported_media') {
      // Terminal webhook acknowledgement avoids retries; it is NOT proof of
      // platform acceptance. Keep isolated UI media sending disabled until the
      // one original media Sender has an authenticated Chatwoot attachment path.
      logger.warn('outbound.unsupported_media', { chatwootMessageId: payload.id, inboxId });
      return { status: 422, body: {
        ok: false, sent: false, delivered: false, platformAccepted: false,
        realSendAttempted: false, manualReviewRequired: true,
        willRetryAutomatically: false, status: 'MEDIA_OUTBOUND_NOT_WIRED',
        error: decision.reason,
      } };
    }
    if (decision.action !== 'send') {
      return { status: 422, body: { ok: false, error: decision.reason, realSendAttempted: false } };
    }
    const plan = decision.plan;

    const scope = index.byIdentifier.get(plan.identifier);
    if (!scope) {
      logger.warn('outbound.unknown_identifier', { chatwootMessageId: plan.chatwootMessageId, inboxId: plan.inboxId });
      return { status: 409, body: { ok: false, error: 'UNKNOWN_CONTACT_IDENTIFIER', realSendAttempted: false } };
    }
    // This P0 release restores the two original DSH-IM WhatsApp manual
    // Senders only. Facebook/Page remain blocked until their own original
    // platform submission and MID can be verified; never turn on other
    // channels merely because the global owner Session has been resolved.
    if (sender && scope.channel !== 'WhatsApp') {
      return { status: 409, body: {
        ok: false, sent: false, realSendAttempted: false, delivered: false,
        willRetryAutomatically: false, status: 'CHANNEL_SENDER_NOT_VERIFIED',
      } };
    }
    // Both native Inbox identity and conversation scope must be present and
    // equal to the Host-verified roster binding. A missing inbox is NOT a
    // wildcard authorization for any of the four real social accounts.
    if (!Number.isSafeInteger(scope.inboxId) || !Number.isSafeInteger(plan.inboxId) ||
        scope.inboxId !== plan.inboxId) {
      return { status: 409, body: { ok: false, error: 'INBOX_SCOPE_MISMATCH', realSendAttempted: false } };
    }
    if (!Number.isSafeInteger(plan.chatwootConversationId) || plan.chatwootConversationId <= 0) {
      return { status: 409, body: { ok: false, error: 'CONVERSATION_SCOPE_MISSING', realSendAttempted: false } };
    }
    const previouslyProcessed = processed.get(plan.chatwootMessageId);
    if (previouslyProcessed) {
      if (previouslyProcessed.state === 'submitted-unconfirmed') {
        return { status: 200, body: {
          ok: true, duplicate: true, submitted: true, delivered: false,
          deliveryStatus: 'UNKNOWN', realSendAttempted: false,
          willRetryAutomatically: false,
        } };
      }
      // If an earlier attempt timed out or its durable claim/receipt was
      // uncertain, a 200 here would falsely promote it to "sent" in Cloud.
      return { status: 409, body: {
        ok: false, duplicate: true, submitted: false, delivered: false,
        realSendAttempted: false, manualReviewRequired: true,
        willRetryAutomatically: false, status: 'UNKNOWN_NO_RETRY',
      } };
    }
    const pending = inFlight.get(plan.chatwootMessageId);
    if (pending) return pending;

    const run = (async () => {
      if (!sender) {
        logger.info('outbound.real_send_disabled', summary(plan, scope));
        // Chatwoot marks a 2xx API Channel webhook as 'sent'. Return a
        // terminal 409 instead so its original Webhooks::Trigger marks this
        // local-only outgoing bubble FAILED, never falsely sent to WhatsApp.
        // Chatwoot's API inbox handler does not retry this error.
        return {
          status: 409,
          body: {
            ok: false,
            delivered: false,
            realSendAttempted: false,
            willRetryAutomatically: false,
            status: 'SKIPPED_REAL_SEND_DISABLED',
            reason: 'ENABLE_REAL_SEND_NOT_TRUE',
            plan: summary(plan, scope),
          },
        };
      }
      // Native PostgreSQL claim MUST commit before the only Host Sender call.
      // If the claim response is uncertain, never invoke the Sender.
      let claim;
      try {
        claim = await deliveryAuthority.claim({ plan, scope });
      } catch (error) {
        const code = error?.code ?? 'NATIVE_CLAIM_UNCONFIRMED';
        rememberProcessed(plan.chatwootMessageId);
        logger.warn('outbound.claim_unconfirmed', { ...summary(plan, scope), code });
        return { status: 409, body: {
          ok: false, submitted: false, delivered: false,
          realSendAttempted: false, manualReviewRequired: true,
          willRetryAutomatically: false, status: 'NATIVE_CLAIM_UNCONFIRMED',
          error: code,
        } };
      }
      if (claim?.claimed !== true || typeof claim.claimId !== 'string') {
        rememberProcessed(plan.chatwootMessageId);
        // A pre-existing durable claim means a previous attempt may already
        // have reached the platform. Do not re-send or report a 2xx success.
        return { status: 409, body: {
          ok: false, submitted: false, delivered: false,
          realSendAttempted: false, manualReviewRequired: true,
          willRetryAutomatically: false, status: 'NATIVE_CLAIM_ALREADY_EXISTS',
        } };
      }
      try {
        const receipt = await deliver(plan, scope, claim.claimId);
        rememberProcessed(plan.chatwootMessageId, 'submitted-unconfirmed');
        logger.info('outbound.submitted', {
          ...summary(plan, scope),
          providerMessageIdShape: receipt.providerMessageId ? 'present' : 'absent',
        });
        return {
          status: 200,
          body: {
            ok: true,
            submitted: true,
            delivered: false,
            deliveryStatus: receipt.deliveryStatus,
            providerMessageId: receipt.providerMessageId,
            platformAccepted: receipt.platformAccepted === true,
            transportAccepted: receipt.transportAccepted === true,
            willRetryAutomatically: false,
          },
        };
      } catch (error) {
        const code = error?.code ?? 'HOST_SENDER_UNCONFIRMED';
        // An unconfirmed submission must never be retried automatically, not
        // even by a redelivered webhook: remember this Chatwoot message id so a
        // repeat delivery is reported as duplicate instead of sending twice.
        rememberProcessed(plan.chatwootMessageId);
        logger.warn('outbound.unconfirmed', { ...summary(plan, scope), code });
        // A 5xx could lead to a retry after a crash. This 409 causes
        // Chatwoot's original API-inbox webhook failure handler to mark the
        // message FAILED, never a false 'sent' tick. The committed native
        // claim still blocks duplicate platform submission on later callbacks.
        // Explicit owner reconciliation is required before any manual retry.
        return {
          status: 409,
          body: {
            ok: false,
            status: 'UNKNOWN_NEEDS_MANUAL_RECONCILIATION',
            submitted: false,
            delivered: false,
            manualReviewRequired: true,
            willRetryAutomatically: false,
            error: code,
          },
        };
      }
    })().finally(() => {
      inFlight.delete(plan.chatwootMessageId);
    });
    inFlight.set(plan.chatwootMessageId, run);
    return run;
  }

  return { handle, correlations, processedSize: () => processed.size };
}
