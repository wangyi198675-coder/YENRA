/**
 * P0-D: verified provider ACK -> Chatwoot native message status.
 * Never guesses a platform MID from text/time, never sends messages, and never
 * stores a second ACK database. Chatwoot is the sole persistence authority.
 * Only outbound rows with a DURABLY persisted provider MID are eligible.
 */
import { stableContactIdentifier, isAccountRef, MID_PATTERN } from './contract.mjs';

export function validateVerifiedAck(ack) {
  if (!ack || typeof ack !== 'object' || Array.isArray(ack)) return 'ACK_INVALID';
  if (!['WhatsApp', 'Personal'].includes(ack.channel)) return 'ACK_CHANNEL_UNSUPPORTED';
  if (!isAccountRef(ack.accountRef) || !isAccountRef(ack.roomRef)) return 'ACK_SCOPE_INVALID';
  if (typeof ack.mid !== 'string' || !MID_PATTERN.test(ack.mid)) return 'ACK_MID_INVALID';
  if (ack.channel === 'Personal' && !ack.mid.startsWith('$')) return 'ACK_PERSONAL_MID_INVALID';
  if (!['DELIVERED', 'READ', 'PLAYED'].includes(ack.ackKind)) return 'ACK_KIND_UNSUPPORTED';
  if (ack.providerAccepted !== true || ack.providerDelivered !== true) return 'ACK_PROVIDER_PROOF_MISSING';
  if (['READ', 'PLAYED'].includes(ack.ackKind) && ack.providerRead !== true) return 'ACK_READ_PROOF_MISSING';
  if (ack.channel === 'Personal' && ack.ackKind !== 'READ') return 'ACK_PERSONAL_ONLY_READ';
  return null;
}

export function verifiedAckStatus(ack) {
  return ack.ackKind === 'DELIVERED' ? 'delivered' : 'read';
}

function outgoing(message) {
  return message?.message_type === 'outgoing' || message?.message_type === 1;
}

function persistedProviderMid(message, { allowProvisional = false } = {}) {
  const attrs = message?.content_attributes;
  // The native verified MID remains highest-authority. A provisional MID
  // may be used ONLY when a committed native send claim exists AND the
  // incoming ACK carries its own fully verified provider proof.
  if (typeof attrs?.yenra_verified_outbound_provider_mid === 'string') {
    return { mid: attrs.yenra_verified_outbound_provider_mid, verified: true };
  }
  if (allowProvisional &&
      typeof attrs?.yenra_outbound_provider_mid === 'string' &&
      typeof attrs?.yenra_send_claim?.claim_id === 'string' &&
      /^[0-9a-f-]{36}$/u.test(attrs.yenra_send_claim.claim_id) &&
      !message?.source_id) {
    return { mid: attrs.yenra_outbound_provider_mid, verified: false };
  }
  return null;
}

const PRIORITY = Object.freeze({ sent: 0, delivered: 1, read: 2 });

/** Resolve exactly ONE native Chatwoot message by original platform MID.
 * No in-memory sender correlation, timestamp heuristic or cross-account lookup.
 */
export async function resolvePersistedAckTarget({ ack, index, chatwoot, allowProvisional = false, nativeDelivery = null }) {
  const reason = validateVerifiedAck(ack);
  if (reason) return { ok: false, code: reason };
  const identifier = stableContactIdentifier(ack.accountRef, ack.roomRef);
  const scope = index?.byIdentifier?.get(identifier);
  if (!scope || scope.channel !== ack.channel ||
      scope.accountRef !== ack.accountRef || scope.roomRef !== ack.roomRef ||
      !Number.isSafeInteger(scope.inboxId)) return { ok: false, code: 'ACK_SCOPE_NOT_IN_ROSTER' };
  // Current Chatwoot /conversations/:id/messages only exposes a recent
  // page. A mature contact may have an ACK for a MUCH OLDER outgoing MID.
  // The native single-PG-row query searches all committed messages, not the UI
  // screen, and enforces the same account/inbox/contact/claim.
  if (typeof nativeDelivery?.lookupAckTarget === 'function') {
    return nativeDelivery.lookupAckTarget({identifier,inboxId:scope.inboxId,mid:ack.mid});
  }
  const contact = await chatwoot.findContactByIdentifier(identifier);
  if (!contact) return { ok: false, code: 'ACK_CONTACT_NOT_PERSISTED' };
  const conversations = await chatwoot.listContactConversations(contact.id);
  const matched = [];
  for (const conversation of conversations) {
    const inboxId = conversation?.inbox_id ?? conversation?.inbox?.id;
    if (inboxId !== scope.inboxId) continue;
    const displayId = conversation?.display_id ?? conversation?.id;
    if (!Number.isSafeInteger(displayId) || displayId <= 0) continue;
    const messages = await chatwoot.listConversationMessages(displayId);
    for (const message of messages) {
      if (!Number.isSafeInteger(message?.id) || !outgoing(message) ||
          message?.private === true ||
          message?.content_attributes?.yenra_history_import === true) continue;
      const binding = persistedProviderMid(message, { allowProvisional });
      if (binding?.mid !== ack.mid) continue;
      matched.push({ chatwootMessageId: message.id, conversationDisplayId: displayId,
        status: message.status, verifiedBinding: binding.verified,
        inboxId: scope.inboxId, identifier });
    }
  }
  if (!matched.length) return { ok: false, code: 'ACK_DURABLE_MID_BINDING_NOT_FOUND' };
  if (matched.length !== 1) return { ok: false, code: 'ACK_DURABLE_MID_BINDING_AMBIGUOUS' };
  return { ok: true, ...matched[0], statusToWrite: verifiedAckStatus(ack) };
}

export function createPlatformAckHandler({ index, chatwoot, logger, nativeDelivery = null }) {
  if (!index?.byIdentifier || !chatwoot || !logger) throw Error('ACK_DEPENDENCIES_REQUIRED');
  return {
    async handle(ack) {
      let target;
      try { target = await resolvePersistedAckTarget({ ack, index, chatwoot,
        allowProvisional: typeof nativeDelivery?.writeVerifiedAck === 'function',
        nativeDelivery }); }
      catch (error) {
        logger.warn('ack.lookup_failed', { code: error?.code ?? 'ACK_NATIVE_LOOKUP_FAILED' });
        return { ok: false, code: 'ACK_NATIVE_LOOKUP_FAILED' };
      }
      if (!target.ok) return target;
      const current = PRIORITY[target.status];
      const desired = PRIORITY[target.statusToWrite];
      if (current !== undefined && current >= desired && target.verifiedBinding === true) {
        return { ok: true, duplicate: true, status: target.status };
      }
      try {
        if (target.externalOriginal===true) {
          if(ack.channel!=='WhatsApp'||
             typeof nativeDelivery?.writeVerifiedExternalAck!=='function')
            return {ok:false,code:'EXTERNAL_ORIGINAL_ACK_NOT_AVAILABLE'};
          const result=await nativeDelivery.writeVerifiedExternalAck({
            plan:{chatwootMessageId:target.chatwootMessageId,
              chatwootConversationId:target.conversationDisplayId,
              inboxId:target.inboxId,identifier:target.identifier},
            scope:{inboxId:target.inboxId},ack});
          return {ok:true,updated:result.updated===true,status:result.status};
        }
        if (typeof nativeDelivery?.writeVerifiedAck === 'function') {
          const result = await nativeDelivery.writeVerifiedAck({
            plan: {
              chatwootMessageId: target.chatwootMessageId,
              chatwootConversationId: target.conversationDisplayId,
              inboxId: target.inboxId,
              identifier: target.identifier,
            },
            scope: { inboxId: target.inboxId },
            ack,
          });
          return { ok: true, updated: result.updated === true, status: result.status };
        }
        // Legacy status writes are only for already-VERIFIED bindings.
        if (!target.verifiedBinding) return { ok:false, code:'ACK_VERIFIED_BINDING_REQUIRED' };
        await chatwoot.updateMessageStatus(target.conversationDisplayId,
          target.chatwootMessageId, target.statusToWrite);
        return { ok: true, updated: true, status: target.statusToWrite };
      } catch (error) {
        logger.warn('ack.update_failed', { code: error?.code ?? 'ACK_NATIVE_UPDATE_FAILED' });
        return { ok: false, code: 'ACK_NATIVE_UPDATE_FAILED' };
      }
    },
  };
}
