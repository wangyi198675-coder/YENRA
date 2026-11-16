/**
 * A thin authenticated client of the EXISTING Chatwoot Rails/API inbox.
 * Each operation writes the same native PostgreSQL Message row; never creates
 * a second sender, DB, background queue, retry worker or platform session.
 *
 * IMPORTANT: requires the separately reviewed additive Rails native routes.
 * This client must NEVER bypass the existing ENABLE_REAL_SEND fail-closed gate.
 */
import { MID_PATTERN } from './contract.mjs';

export class NativeDeliveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function requestScope({ plan, scope } = {}) {
  if (!Number.isSafeInteger(plan?.chatwootMessageId) || plan.chatwootMessageId <= 0 ||
      !Number.isSafeInteger(plan?.chatwootConversationId) || plan.chatwootConversationId <= 0 ||
      !Number.isSafeInteger(scope?.inboxId) || scope.inboxId <= 0 ||
      typeof plan?.identifier !== 'string' || !/^yenra-[a-f0-9]{40}$/u.test(plan.identifier)) {
    throw new NativeDeliveryError('NATIVE_CLAIM_SCOPE_INVALID');
  }
  if (plan.inboxId !== scope.inboxId) throw new NativeDeliveryError('NATIVE_CLAIM_INBOX_MISMATCH');
  return {
    conversationId: plan.chatwootConversationId,
    payload: {
      inbox_id: scope.inboxId,
      message_id: plan.chatwootMessageId,
      identifier: plan.identifier,
    },
  };
}

export function createNativeDeliveryAuthority({ chatwoot } = {}) {
  if (!chatwoot || typeof chatwoot.request !== 'function' || typeof chatwoot.apiBase !== 'string') {
    throw new NativeDeliveryError('NATIVE_CHATWOOT_CLIENT_REQUIRED');
  }
  const pathFor = (displayId, action) =>
    `${chatwoot.apiBase}/conversations/${displayId}/yenra_delivery_${action}`;

  return {
    async lookupAckTarget({ identifier, inboxId, mid }) {
      if (typeof identifier !== 'string' || !/^yenra-[a-f0-9]{40}$/u.test(identifier) ||
          !Number.isSafeInteger(inboxId) || inboxId <= 0 ||
          typeof mid !== 'string' || !MID_PATTERN.test(mid)) {
        throw new NativeDeliveryError('NATIVE_ACK_LOOKUP_SCOPE_INVALID');
      }
      let data;
      try {
        data = await chatwoot.request('POST', `${chatwoot.apiBase}/yenra_delivery_mid_target`, {
          identifier, inbox_id: inboxId, provider_mid: mid,
        });
      } catch(error) {
        if (error?.code === 'CHATWOOT_HTTP_404') {
          return {ok:false,code:'ACK_DURABLE_MID_BINDING_NOT_FOUND'};
        }
        if (error?.code === 'CHATWOOT_HTTP_409') {
          return {ok:false,code:'ACK_DURABLE_MID_BINDING_AMBIGUOUS'};
        }
        throw new NativeDeliveryError('NATIVE_ACK_LOOKUP_UNCONFIRMED');
      }
      if (data?.ok !== true || !Number.isSafeInteger(data.message_id) ||
          data.message_id <= 0 || !Number.isSafeInteger(data.conversation_display_id) ||
          data.conversation_display_id <= 0 || data.inbox_id !== inboxId ||
          typeof data.status !== 'string' || typeof data.verified_binding !== 'boolean' ||
          (data.external_original!==undefined && typeof data.external_original !== 'boolean')) {
        throw new NativeDeliveryError('NATIVE_ACK_LOOKUP_RESPONSE_INVALID');
      }
      return {ok:true,chatwootMessageId:data.message_id,
        conversationDisplayId:data.conversation_display_id,status:data.status,
        inboxId,identifier,verifiedBinding:data.verified_binding,
        externalOriginal:data.external_original};
    },

    /** A platform-verified ACK for an original message sent in the official
     * WhatsApp app, imported natively by its immutable source_id MID.
     * Does not make a Sender claim or create a second storage authority. */
    async writeVerifiedExternalAck({plan,scope,ack}) {
      const {conversationId,payload}=requestScope({plan,scope});
      if(![3,4].includes(scope.inboxId)||typeof ack?.mid!=='string'||
         !MID_PATTERN.test(ack.mid)||!['DELIVERED','READ','PLAYED'].includes(ack.ackKind)||
         ack.providerAccepted!==true||ack.providerDelivered!==true||
         (ack.ackKind!=='DELIVERED'&&ack.providerRead!==true))
        throw new NativeDeliveryError('EXTERNAL_WA_ACK_UNVERIFIED');
      const data=await chatwoot.request('POST',
        `${chatwoot.apiBase}/conversations/${conversationId}/yenra_external_original_ack`,
        {...payload,provider_mid:ack.mid,ack_kind:ack.ackKind,
          provider_accepted:true,provider_delivered:true,
          provider_read:ack.providerRead===true});
      if(data?.ok!==true||data?.applied!==true||data?.verified_mid_persisted!==true)
        throw new NativeDeliveryError('EXTERNAL_WA_ACK_WRITE_UNCONFIRMED');
      return {updated:true,status:data.status};
    },

    async claim({ plan, scope }) {
      const { conversationId, payload } = requestScope({ plan, scope });
      try {
        const data = await chatwoot.request('POST', pathFor(conversationId, 'claim'), payload);
        if (data?.ok !== true || data?.claimed !== true ||
            typeof data.claim_id !== 'string' || !/^[0-9a-f-]{36}$/u.test(data.claim_id)) {
          throw new NativeDeliveryError('NATIVE_CLAIM_NOT_CONFIRMED');
        }
        return { claimed: true, claimId: data.claim_id };
      } catch (error) {
        if (error?.code === 'CHATWOOT_HTTP_409') {
          return { claimed: false, reason: 'ALREADY_CLAIMED' };
        }
        throw new NativeDeliveryError('NATIVE_CLAIM_UNCONFIRMED');
      }
    },

    async recordReceipt({ plan, scope, claimId, receipt }) {
      const { conversationId, payload } = requestScope({ plan, scope });
      if (typeof claimId !== 'string' || !/^[0-9a-f-]{36}$/u.test(claimId) ||
          typeof receipt?.providerMessageId !== 'string' ||
          !MID_PATTERN.test(receipt.providerMessageId) ||
          (receipt.platformAccepted !== true && receipt.transportAccepted !== true)) {
        throw new NativeDeliveryError('NATIVE_RECEIPT_PROOF_MISSING');
      }
      let data;
      try {
        data = await chatwoot.request('POST', pathFor(conversationId, 'receipt'), {
          ...payload, claim_id: claimId,
          provider_mid: receipt.providerMessageId,
          platform_accepted: receipt.platformAccepted === true,
          transport_accepted: receipt.transportAccepted === true,
        });
      } catch {
        throw new NativeDeliveryError('NATIVE_RECEIPT_UNCONFIRMED');
      }
      if (data?.ok !== true || data?.bound !== true) {
        throw new NativeDeliveryError('NATIVE_RECEIPT_UNCONFIRMED');
      }
      return { bound: true, platformAccepted: data.platform_accepted === true };
    },

    async writeVerifiedAck({ plan, scope, ack }) {
      const { conversationId, payload } = requestScope({ plan, scope });
      if (typeof ack?.mid !== 'string' || !MID_PATTERN.test(ack.mid) ||
          !['DELIVERED', 'READ', 'PLAYED'].includes(ack.ackKind) ||
          ack.providerAccepted !== true || ack.providerDelivered !== true ||
          (ack.ackKind !== 'DELIVERED' && ack.providerRead !== true)) {
        throw new NativeDeliveryError('NATIVE_ACK_UNVERIFIED');
      }
      let data;
      try {
        data = await chatwoot.request('POST', pathFor(conversationId, 'ack'), {
          ...payload,
          provider_mid: ack.mid, ack_kind: ack.ackKind,
          provider_accepted: true,
          provider_delivered: true,
          provider_read: ack.providerRead === true,
        });
      } catch {
        throw new NativeDeliveryError('NATIVE_ACK_UPDATE_UNCONFIRMED');
      }
      if (data?.ok !== true || data?.applied !== true || data?.verified_mid_persisted !== true) {
        throw new NativeDeliveryError('NATIVE_ACK_UPDATE_UNCONFIRMED');
      }
      return { updated: true, status: data.status };
    },
  };
}
