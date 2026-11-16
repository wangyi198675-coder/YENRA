/**
 * Host-authorized resolution of a Chatwoot conversation back to the original
 * Host scope (accountRef / roomRef).
 *
 * This is the ONE place that turns "which conversation is open in the Chatwoot
 * iframe" (a display_id observed by the deployment-layer proxy) into the Host
 * account/room identity the right-hand Brain already knows. It is read-only:
 * no writes, no cache, no second roster. The only mapping used is the in-memory
 * identifier index derived from the verified Host roster (buildRosterIndex), so
 * a conversation can never resolve to a contact outside that verified roster —
 * this is what prevents the four accounts from crossing.
 */
import { webhookContactIdentifier } from './contract.mjs';

/**
 * @param {object} options
 * @param {import('./chatwoot-client.mjs').ChatwootClient} options.chatwoot
 * @param {{ byIdentifier: Map<string, object> }} options.index buildRosterIndex() result
 * @param {number} options.accountId Chatwoot account id (validated, must match bridge account)
 * @param {number} options.displayId Chatwoot conversation display id
 * @returns {Promise<{ok:boolean, selection?:object, error?:string, code?:string}>}
 */
export async function resolveConversationSelection({ chatwoot, index, accountId, displayId }) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return { ok: false, error: 'ACCOUNT_ID_INVALID' };
  if (!Number.isSafeInteger(displayId) || displayId <= 0) return { ok: false, error: 'DISPLAY_ID_INVALID' };

  let conversation;
  try {
    conversation = await chatwoot.getConversation(displayId);
  } catch (error) {
    return { ok: false, error: 'CONVERSATION_LOOKUP_FAILED', code: error?.code ?? 'UNKNOWN' };
  }
  if (!conversation || typeof conversation !== 'object') return { ok: false, error: 'CONVERSATION_NOT_FOUND' };
  // A valid YENRA contact identifier does not authorize an otherwise
  // unrelated Cloud account or Inbox. Bind the actual stored conversation
  // before its scope is passed to Brain, avatars, media or Sender.
  // Chatwoot's per-account display_id may differ from its internal database id.
  // When display_id is present it is authoritative for the UI selection;
  // the internal id is only a compatibility fallback for older API payloads.
  // Never accept a matching internal id when an explicit display_id differs.
  const addressedId = conversation.display_id == null
    ? Number(conversation.id) : Number(conversation.display_id);
  if (!Number.isSafeInteger(addressedId) || addressedId !== displayId ||
      conversation.account_id !== accountId)
    return { ok: false, error: 'CONVERSATION_ACCOUNT_SCOPE_MISMATCH' };

  // Same extraction the outbound webhook path already trusts (contact meta
  // sender identifier first, then contact_inbox source_id); only "yenra-*".
  const identifier = webhookContactIdentifier({ conversation });
  if (!identifier) return { ok: false, error: 'NO_YENRA_CONTACT_IDENTIFIER' };

  const scope = index?.byIdentifier?.get(identifier);
  if (!scope) return { ok: false, error: 'IDENTIFIER_NOT_IN_ROSTER' };
  if (typeof scope.accountRef !== 'string' || typeof scope.roomRef !== 'string') {
    return { ok: false, error: 'ROSTER_SCOPE_INVALID' };
  }
  const storedInboxId=Number(conversation.inbox_id??conversation.inbox?.id);
  if (!Number.isSafeInteger(scope.inboxId) || storedInboxId !== scope.inboxId)
    return { ok: false, error: 'CONVERSATION_INBOX_SCOPE_MISMATCH' };

  return {
    ok: true,
    selection: {
      accountRef: scope.accountRef,
      roomRef: scope.roomRef,
      channel: scope.channel,
      inboxId: scope.inboxId,
      label: scope.label,
      // Chatwoot's own contact ID from this verified, current conversation.
      // Avoid an extra rate-limited /contacts/search on avatar hydration.
      ...(Number.isSafeInteger(conversation?.meta?.sender?.id)
        ? {contactId:conversation.meta.sender.id}:
        Number.isSafeInteger(conversation?.contact_id)
          ? {contactId:conversation.contact_id}:{}),
    },
  };
}
