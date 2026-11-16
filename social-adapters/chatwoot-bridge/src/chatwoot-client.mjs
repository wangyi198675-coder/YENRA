/**
 * Thin client for the Chatwoot v4.19.1 fork REST API.
 *
 * Only the endpoints required to project the verified Host roster and messages
 * into Chatwoot are implemented; no Chatwoot feature is re-implemented here and
 * no state is kept locally. Exactly-once message identity is Chatwoot's own
 * (account, inbox, source_id) unique index; this client simply forwards
 * source_id and lets the server decide.
 *
 * The API token is never logged, never embedded in error messages and never
 * returned to a caller.
 */
import { ContractError } from './contract.mjs';

export class ChatwootClientError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ChatwootClientError';
    this.code = code;
  }
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/u, '')}${path}`;
}

/** Chatwoot list endpoints return either an array or {payload:[...]}. */
export function listRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.payload)) return payload.payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.payload?.messages)) return payload.payload.messages;
  if (Array.isArray(payload?.payload?.contacts)) return payload.payload.contacts;
  return null;
}

export class ChatwootClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl
   * @param {number} options.accountId
   * @param {string} options.token
   * @param {typeof fetch} [options.fetchImpl]
   * @param {number} [options.timeoutMs]
   */
  constructor({ baseUrl, accountId, token, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    if (typeof baseUrl !== 'string' || !baseUrl) throw new ChatwootClientError('CHATWOOT_BASE_URL_INVALID');
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new ChatwootClientError('CHATWOOT_ACCOUNT_ID_INVALID');
    if (typeof token !== 'string' || !token) throw new ChatwootClientError('CHATWOOT_API_TOKEN_MISSING');
    if (typeof fetchImpl !== 'function') throw new ChatwootClientError('FETCH_IMPL_MISSING');
    this.baseUrl = baseUrl;
    this.accountId = accountId;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get apiBase() {
    return `/api/v1/accounts/${this.accountId}`;
  }

  async request(method, path, body, { timeoutMs } = {}) {
    const url = joinUrl(this.baseUrl, path);
    const init = {
      method,
      redirect: 'error',
      headers: {
        api_access_token: this.token,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ChatwootClientError('CHATWOOT_TIMEOUT', method);
      }
      throw new ChatwootClientError('CHATWOOT_NETWORK_ERROR', method);
    }
    const text = await response.text().catch(() => '');
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      throw new ChatwootClientError(`CHATWOOT_HTTP_${response.status}`, `${method} ${path.split('?')[0]}`);
    }
    return payload;
  }

  /** GET /inboxes — the four isolated API inboxes. */
  async listInboxes() {
    const rows = listRows(await this.request('GET', `${this.apiBase}/inboxes`));
    if (!Array.isArray(rows)) throw new ChatwootClientError('CHATWOOT_INBOX_LIST_SHAPE_INVALID');
    return rows
      .filter((row) => row && Number.isSafeInteger(row.id))
      .map((row) => ({
        id: row.id,
        name: typeof row.name === 'string' ? row.name : '',
        channelType: row.channel_type ?? null,
        avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
      }));
  }

  /** Update native Inbox presentation only. No channel type or Sender changes. */
  async updateInboxIdentity({ inboxId, name, avatar = null }) {
    if (!Number.isSafeInteger(inboxId) || inboxId <= 0) throw new ChatwootClientError('INBOX_ID_INVALID');
    if (typeof name !== 'string' || !name.trim() || name.length > 120) {
      throw new ChatwootClientError('INBOX_DISPLAY_NAME_INVALID');
    }
    const path = `${this.apiBase}/inboxes/${inboxId}`;
    if (!avatar) return this.request('PATCH', path, { name });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(avatar.mime) ||
        !(avatar.bytes instanceof Uint8Array) || avatar.bytes.length < 10 || avatar.bytes.length > 2_000_000) {
      throw new ChatwootClientError('INBOX_AVATAR_INVALID');
    }
    const body = new FormData();
    body.append('name', name);
    body.append('avatar', new Blob([avatar.bytes], { type: avatar.mime }),
      `account.${avatar.mime === 'image/png' ? 'png' : avatar.mime === 'image/webp' ? 'webp' : 'jpg'}`);
    let response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
        method: 'PATCH', redirect: 'error',
        headers: { api_access_token: this.token, accept: 'application/json' },
        body, signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { throw new ChatwootClientError('INBOX_AVATAR_UPLOAD_NETWORK_ERROR'); }
    if (!response.ok) throw new ChatwootClientError(`CHATWOOT_INBOX_AVATAR_HTTP_${response.status}`);
    return response.json().catch(() => ({}));
  }

  /** GET /contacts/search?q= — exact identifier match is applied locally. */
  async searchContacts(query) {
    if (typeof query !== 'string' || !query) throw new ChatwootClientError('CONTACT_QUERY_INVALID');
    const rows = listRows(await this.request('GET', `${this.apiBase}/contacts/search?q=${encodeURIComponent(query)}`));
    if (!Array.isArray(rows)) throw new ChatwootClientError('CHATWOOT_CONTACT_SEARCH_SHAPE_INVALID');
    return rows;
  }

  async findContactByIdentifier(identifier) {
    const rows = await this.searchContacts(identifier);
    const exact = rows.filter((row) => row?.identifier === identifier);
    if (exact.length > 1) throw new ChatwootClientError('CHATWOOT_CONTACT_IDENTIFIER_DUPLICATE');
    return exact[0] ?? null;
  }

  /**
   * POST /contacts — Stage M verified shape:
   * {name, identifier, inbox_id, source_id}
   */
  async createContact({ name, identifier, inboxId, sourceId = identifier }) {
    if (typeof identifier !== 'string' || !identifier) throw new ChatwootClientError('CONTACT_IDENTIFIER_INVALID');
    if (!Number.isSafeInteger(inboxId) || inboxId <= 0) throw new ChatwootClientError('CONTACT_INBOX_INVALID');
    const payload = await this.request('POST', `${this.apiBase}/contacts`, {
      name: typeof name === 'string' && name.trim() ? name.slice(0, 260) : identifier,
      identifier,
      inbox_id: inboxId,
      source_id: sourceId,
    });
    const contact = payload?.contact ?? payload?.payload?.contact ?? payload?.payload ?? payload;
    if (!contact || !Number.isSafeInteger(contact.id)) throw new ChatwootClientError('CHATWOOT_CONTACT_CREATE_NO_ID');
    return contact;
  }

  /** Original Host-verified Page bytes into native Chatwoot Active Storage.
   * Never import arbitrary provider URLs or create a separate avatar cache. */
  async uploadVerifiedContactAvatar(contactId, avatar) {
    if (!Number.isSafeInteger(contactId) || contactId <= 0 ||
        !avatar || !['image/jpeg','image/png','image/webp'].includes(avatar.mime) ||
        !(avatar.bytes instanceof Uint8Array) ||
        avatar.bytes.length < 100 || avatar.bytes.length > 1_500_000)
      throw new ChatwootClientError('VERIFIED_CONTACT_AVATAR_INVALID');
    const form = new FormData();
    form.append('avatar', new Blob([avatar.bytes], {type:avatar.mime}),
      avatar.mime === 'image/png' ? 'page-contact.png' :
        avatar.mime === 'image/webp' ? 'page-contact.webp' : 'page-contact.jpg');
    let response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl,
        `${this.apiBase}/contacts/${contactId}`), {
        method:'PUT',redirect:'error',
        headers:{api_access_token:this.token,accept:'application/json'},
        body:form,signal:AbortSignal.timeout(this.timeoutMs),
      });
    } catch {throw new ChatwootClientError('CONTACT_AVATAR_UPLOAD_NETWORK_ERROR');}
    if(!response.ok)
      throw new ChatwootClientError('CONTACT_AVATAR_UPLOAD_HTTP_'+response.status);
    return response.json().catch(()=>({}));
  }

  /** One native contact lookup; the browser's contact ID is never an authority. */
  async getContactById(contactId,{allowPageWithoutIdentifier=false}={}) {
    if (!Number.isSafeInteger(contactId) || contactId <= 0) {
      throw new ChatwootClientError('CONTACT_ID_INVALID');
    }
    const payload = await this.request('GET', `${this.apiBase}/contacts/${contactId}?include_contact_inboxes=true`);
    const contact = payload?.contact ?? payload?.payload?.contact ?? payload?.payload ?? payload;
    if (!contact || contact.id !== contactId || (typeof contact.identifier !== 'string' && !(allowPageWithoutIdentifier===true && contact.identifier===null))) {
      throw new ChatwootClientError('CHATWOOT_CONTACT_IDENTITY_INVALID');
    }
    return contact;
  }

  /** GET /contacts/:id/conversations (account API nested route). */
  async listContactConversations(contactId) {
    const rows = listRows(await this.request('GET', `${this.apiBase}/contacts/${contactId}/conversations`));
    if (!Array.isArray(rows)) throw new ChatwootClientError('CHATWOOT_CONTACT_CONVERSATIONS_SHAPE_INVALID');
    return rows;
  }

  /**
   * POST /conversations — Stage M/R verified shape:
   * {inbox_id, contact_id, source_id, status}
   */
  async createConversation({ inboxId, contactId, sourceId }) {
    if (!Number.isSafeInteger(inboxId) || !Number.isSafeInteger(contactId)) {
      throw new ChatwootClientError('CONVERSATION_SCOPE_INVALID');
    }
    const payload = await this.request('POST', `${this.apiBase}/conversations`, {
      inbox_id: inboxId,
      contact_id: contactId,
      source_id: sourceId,
      status: 'open',
    });
    const conversation = payload?.conversation ?? payload?.payload ?? payload;
    if (!conversation || !Number.isSafeInteger(conversation.id)) {
      throw new ChatwootClientError('CHATWOOT_CONVERSATION_CREATE_NO_ID');
    }
    return conversation;
  }

  async getConversation(conversationDisplayId) {
    if (!Number.isSafeInteger(conversationDisplayId)) throw new ChatwootClientError('CONVERSATION_ID_INVALID');
    const payload = await this.request('GET', `${this.apiBase}/conversations/${conversationDisplayId}`);
    return payload?.conversation ?? payload?.payload ?? payload;
  }

  /** Read Chatwoot's OWN persisted latest screen before any optional Host backfill. */
  async listConversationMessages(conversationDisplayId) {
    if (!Number.isSafeInteger(conversationDisplayId) || conversationDisplayId <= 0) {
      throw new ChatwootClientError('CONVERSATION_ID_INVALID');
    }
    const payload = await this.request('GET',
      `${this.apiBase}/conversations/${conversationDisplayId}/messages`);
    const rows = payload?.payload ?? payload?.messages ?? payload;
    if (!Array.isArray(rows)) throw new ChatwootClientError('NATIVE_MESSAGE_SCREEN_INVALID');
    return rows;
  }

  /**
   * POST /conversations/:display_id/messages
   * Body is built by contract.buildInboundMessage (source_id is mandatory).
   */
  async createIncomingMessage(conversationDisplayId, messagePayload) {
    if (!Number.isSafeInteger(conversationDisplayId) || conversationDisplayId <= 0) {
      throw new ChatwootClientError('CONVERSATION_ID_INVALID');
    }
    if (!messagePayload || messagePayload.message_type !== 'incoming' || typeof messagePayload.source_id !== 'string') {
      throw new ChatwootClientError('INBOUND_PAYLOAD_INVALID');
    }
    return this.request('POST', `${this.apiBase}/conversations/${conversationDisplayId}/messages`, messagePayload);
  }

  /** Page history only: Chatwoot native outgoing bubble; the fork suppresses
   * send/reopen/webhook for content_attributes.yenra_history_import=true.
   */
  async createHistoricalOutgoingMessage(conversationDisplayId, payload) {
    if (!Number.isSafeInteger(conversationDisplayId) || conversationDisplayId <= 0 ||
        payload?.message_type !== 'outgoing' || payload.private !== false ||
        payload.content_attributes?.yenra_history_import !== true ||
        typeof payload.source_id !== 'string' || !payload.source_id) {
      throw new ChatwootClientError('PAGE_HISTORY_OUTBOUND_INVALID');
    }
    return this.request('POST', `${this.apiBase}/conversations/${conversationDisplayId}/messages`, payload);
  }

  /** Verified, same-account original-Socket composing/paused event to the
   * native Chatwoot Contact-actor ActionCable typing feature. No fake message.
   */
  async writeVerifiedPeerTyping({conversationDisplayId,inboxId,identifier,status}) {
    if(!Number.isSafeInteger(conversationDisplayId)||conversationDisplayId<=0||
       !Number.isSafeInteger(inboxId)||inboxId<=0||
       typeof identifier!=='string'||!/^yenra-[a-f0-9]{40}$/.test(identifier)||
       !['on','off'].includes(status))
      throw new ChatwootClientError('VERIFIED_PEER_TYPING_SCOPE_INVALID');
    return this.request('POST',
      `${this.apiBase}/conversations/${conversationDisplayId}/yenra_peer_presence`,
      {inbox_id:inboxId,identifier,typing_status:status,
        original_source:'ORIGINAL_BAILEYS_PRESENCE'}, {timeoutMs:4000});
  }

  /** PATCH /conversations/:display_id/messages/:id (API inbox only). */
  async updateMessageStatus(conversationDisplayId, chatwootMessageId, status) {
    if (!['submitted', 'sent', 'delivered', 'read', 'failed'].includes(status)) {
      throw new ContractError('CHATWOOT_STATUS_INVALID', String(status));
    }
    return this.request(
      'PATCH',
      `${this.apiBase}/conversations/${conversationDisplayId}/messages/${chatwootMessageId}`,
      { status },
    );
  }
}
