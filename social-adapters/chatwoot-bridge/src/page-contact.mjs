/**
 * The Chatwoot contact id comes from a click, not from an authority.
 * Validate through the native Chatwoot API and the ONE original Host roster,
 * then hydrate ONLY a Page contact that belongs to the mapped API inbox.
 */
export async function openVerifiedPageContact({
  chatwoot, index, inbound, contactId, accountId, expectedAccountId,
  hydrateAvatar = null,
} = {}) {
  if (!Number.isSafeInteger(accountId) || accountId !== expectedAccountId ||
      !Number.isSafeInteger(contactId) || contactId < 1) {
    return { ok: false, code: 'PAGE_CONTACT_SCOPE_INVALID' };
  }
  if (!chatwoot?.getContactById || !index?.byIdentifier || !inbound?.openPageRoomOnDemand) {
    return { ok: false, code: 'PAGE_CONTACT_RESOLVER_NOT_READY' };
  }
  let contact;
  try {
    contact = await chatwoot.getContactById(contactId);
  } catch {
    return { ok: false, code: 'PAGE_CONTACT_LOOKUP_FAILED' };
  }
  if (!contact || contact.id !== contactId) return { ok: false, code: 'PAGE_CONTACT_IDENTITY_MISMATCH' };
  const scope = index.byIdentifier.get(contact.identifier);
  if (!scope || scope.channel !== 'Page' || !Number.isSafeInteger(scope.inboxId)) {
    return { ok: false, code: 'NOT_A_VERIFIED_PAGE_CONTACT' };
  }
  const boundInboxes = Array.isArray(contact.contact_inboxes) ? contact.contact_inboxes : [];
  if (!boundInboxes.some(binding => (binding?.inbox_id ?? binding?.inbox?.id) === scope.inboxId)) {
    return { ok: false, code: 'PAGE_CONTACT_INBOX_MISMATCH' };
  }
  // Avatar hydration is strictly scoped and never blocks first-screen messages.
  if(typeof hydrateAvatar==='function')
    void Promise.resolve().then(()=>hydrateAvatar({
      accountRef:scope.accountRef,roomRef:scope.roomRef,contactId,
    })).catch(()=>{});
  // Chatwoot is the sole authoritative message store. One verified native
  // message is already a valid screen: requiring exactly 20 pointlessly calls
  // the retired Page SDK for normal 1-19-message conversations, causing
  // timeouts and provider rate limits. Older W25 history is optional and must
  // never hold up the existing Cloud conversation's first screen.
  if (typeof chatwoot.listContactConversations === 'function' &&
      typeof chatwoot.listConversationMessages === 'function') {
    try {
      const conversations = await chatwoot.listContactConversations(contactId);
      const existing = conversations
        .filter(item => item?.account_id === accountId && item?.inbox_id === scope.inboxId &&
          Number.isSafeInteger(item?.id) && item.id > 0)
        .sort((a, b) => (b?.timestamp ?? 0) - (a?.timestamp ?? 0))[0];
      if (existing) {
        const messages = await chatwoot.listConversationMessages(existing.id);
        const latest = Array.isArray(messages)?messages.slice(-20):[];
        const ids=latest.map(message=>message?.id);
        if (latest.length>0&&ids.every(id=>Number.isSafeInteger(id)&&id>0)&&
            new Set(ids).size===latest.length&&
            latest.every(message=>
              (message.message_type===0||message.message_type===1||
               message.message_type==='incoming'||message.message_type==='outgoing')&&
              message.private!==true&&
              (message.conversation_id==null||message.conversation_id===existing.id))) {
          return {
            ok: true, imported: 0, skipped: 0, hasOlder: null,
            conversationDisplayId: existing.id, reusedNativeScreen: true,
          };
        }
      }
    } catch {
      // Transient native API failure never suppresses this verified contact's
      // explicit Host-on-demand path. No other contacts or rooms are touched.
    }
  }
  const result = await inbound.openPageRoomOnDemand({
    accountRef: scope.accountRef, roomRef: scope.roomRef, maxMessages: 20,
  });
  if (!result.ok) return result;
  return {
    ok: true, imported: result.imported, skipped: result.skipped, hasOlder: result.hasOlder,
    conversationDisplayId: Number.isSafeInteger(result.conversationDisplayId)
      ? result.conversationDisplayId : null,
  };
}
