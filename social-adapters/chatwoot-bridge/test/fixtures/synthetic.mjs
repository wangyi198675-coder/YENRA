/**
 * Synthetic fixtures ONLY. No real account, contact, phone number, message or
 * credential is used anywhere in this test suite. All refs are 32-hex strings
 * made of repeated letters; all texts are clearly synthetic.
 */
import { createHmac } from 'node:crypto';
import { normalizeRoster } from '../../src/host-client.mjs';

export const REF_A = 'a'.repeat(32);
export const REF_B = 'b'.repeat(32);
export const REF_C = 'c'.repeat(32);
export const REF_D = 'd'.repeat(32);
export const REF_E = 'e'.repeat(32);
export const REF_F = 'f'.repeat(32);

export const RAW_ROSTER = {
  ok: true,
  roster: {
    schema: 1,
    source: 'YENRA_AGGREGATED_NATIVE',
    readOnly: true,
    canSend: false,
    partial: false,
    accounts: [
      {
        channel: 'Personal',
        accountRef: REF_A,
        source: 'YENRA_FB_OFFICIAL',
        readOnly: true,
        canSend: false,
        rooms: [
          { roomRef: REF_B, name: 'Synthetic Personal Room One', nameKnown: true, lastMessageAt: 1700000200000, messageCount: 3 },
          { roomRef: REF_C, name: null, nameKnown: false, lastMessageAt: 1700000100000, messageCount: 0 },
        ],
      },
      {
        channel: 'WhatsApp',
        accountRef: REF_D,
        source: 'DSH_IM_EXISTING_INBOX',
        readOnly: true,
        canSend: false,
        rooms: [{ roomRef: REF_E, name: 'Synthetic WhatsApp One', nameKnown: true, lastMessageAt: 1700000300000, messageCount: 2 }],
      },
      {
        channel: 'WhatsApp',
        accountRef: REF_F,
        source: 'DSH_IM_EXISTING_INBOX',
        readOnly: true,
        canSend: false,
        rooms: [
          { roomRef: '1'.repeat(32), name: 'Synthetic WhatsApp Two A', nameKnown: true, lastMessageAt: 1700000400000, messageCount: 1 },
          { roomRef: '2'.repeat(32), name: null, nameKnown: false, lastMessageAt: 1700000500000, messageCount: 1 },
        ],
      },
      {
        channel: 'Page',
        accountRef: '3'.repeat(32),
        displayId: '4'.repeat(32),
        source: 'YENRA_FB_OFFICIAL',
        readOnly: true,
        canSend: false,
        rooms: [
          { roomRef: '5'.repeat(32), name: 'Synthetic Page Room One', nameKnown: true, lastMessageAt: 1700000600000, messageCount: 4 },
          { roomRef: '6'.repeat(32), name: 'Synthetic Page Room Two', nameKnown: true, lastMessageAt: 1700000050000, messageCount: 1 },
        ],
      },
    ],
    failures: [],
  },
};

export const ROSTER = normalizeRoster(RAW_ROSTER);

export const API_INBOXES = [
  { id: 1, name: 'Not The Right One', channelType: 'Channel::WebWidget' },
  { id: 2, name: 'YENRA Stage FB Personal', channelType: 'Channel::Api' },
  { id: 3, name: 'YENRA Stage WhatsApp 1', channelType: 'Channel::Api' },
  { id: 4, name: 'YENRA Stage WhatsApp 2', channelType: 'Channel::Api' },
  { id: 5, name: 'YENRA Stage FB Page', channelType: 'Channel::Api' },
];

export function contactFor({ id, identifier, inboxId }) {
  return {
    id,
    identifier,
    contact_inboxes: [{ id: id * 10, inbox: { id: inboxId }, source_id: identifier }],
  };
}

/**
 * In-memory Chatwoot double. It reproduces the fork's message identity rule:
 * the same (conversation display id, source_id) returns the SAME message.
 * This is a test double for the upstream guarantee, not adapter logic.
 */
export function createFakeChatwoot({ inboxes = API_INBOXES, contacts = [], failCreateMessage = null } = {}) {
  const contactMap = new Map(contacts.map((contact) => [contact.identifier, contact]));
  const conversations = [];
  const messages = [];
  let nextContactId = 100;
  let nextConversationDisplayId = 500;
  let nextMessageId = 9000;
  const calls = { listInboxes: 0, searchContacts: 0, createContact: 0, createConversation: 0, createIncomingMessage: 0, updateMessageStatus: 0 };
  const written = { contacts: [], conversations: [], messages: [] };

  return {
    calls,
    written,
    contactMap,
    conversations,
    messages,
    async listInboxes() {
      calls.listInboxes += 1;
      return inboxes;
    },
    async searchContacts(query) {
      calls.searchContacts += 1;
      return [...contactMap.values()].filter((contact) => String(contact.identifier).includes(query));
    },
    async findContactByIdentifier(identifier) {
      calls.searchContacts += 1;
      return contactMap.get(identifier) ?? null;
    },
    async createContact({ name, identifier, inboxId, sourceId }) {
      calls.createContact += 1;
      const contact = contactFor({ id: ++nextContactId, identifier, inboxId });
      contact.name = name;
      contact.source_id = sourceId;
      contactMap.set(identifier, contact);
      written.contacts.push(contact);
      return contact;
    },
    async listContactConversations(contactId) {
      return conversations.filter((conversation) => conversation.contact_id === contactId);
    },
    async createConversation({ inboxId, contactId, sourceId }) {
      calls.createConversation += 1;
      const conversation = {
        id: nextConversationDisplayId,
        display_id: nextConversationDisplayId,
        inbox_id: inboxId,
        contact_id: contactId,
        source_id: sourceId,
        status: 'open',
      };
      nextConversationDisplayId += 1;
      conversations.push(conversation);
      written.conversations.push(conversation);
      return conversation;
    },
    async createIncomingMessage(conversationDisplayId, payload) {
      calls.createIncomingMessage += 1;
      if (failCreateMessage) throw failCreateMessage;
      const existing = messages.find(
        (message) => message.conversationDisplayId === conversationDisplayId && message.payload.source_id === payload.source_id,
      );
      if (existing) return existing.message;
      const message = { id: ++nextMessageId, source_id: payload.source_id, content_attributes: payload.content_attributes };
      messages.push({ conversationDisplayId, payload, message });
      written.messages.push({ conversationDisplayId, payload, message });
      return message;
    },
    async updateMessageStatus(conversationDisplayId, chatwootMessageId, status) {
      calls.updateMessageStatus += 1;
      return { id: chatwootMessageId, status };
    },
  };
}

export function createFakeHost({ roster = ROSTER, rooms = new Map(), onReadRoom = null } = {}) {
  const reads = [];
  return {
    reads,
    async readRoster() {
      return roster;
    },
    async readRoom({ accountRef, roomRef, channel }) {
      reads.push({ accountRef, roomRef, channel });
      if (typeof onReadRoom === 'function') return onReadRoom({ accountRef, roomRef, channel });
      return rooms.get(`${accountRef}|${roomRef}`) ?? { accountRef, roomRef, channel, messages: [] };
    },
    openEventStream() {
      return { close() {} };
    },
  };
}

export const FAKE_SESSION_ID = 'session-11111111-2222-3333-4444-555555555555';
export const FAKE_SECRET = 'synthetic-webhook-secret';

export function signWebhook({ secret = FAKE_SECRET, timestamp, rawBody }) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
}

export function buildOutgoingWebhook({
  identifier,
  text = 'Synthetic reply text for tests only.',
  inboxId = 2,
  messageId = 4242,
  conversationId = 77,
  event = 'message_created',
  messageType = 'outgoing',
  isPrivate = false,
} = {}) {
  return {
    event,
    id: messageId,
    content: text,
    message_type: messageType,
    private: isPrivate,
    created_at: 1700000700,
    inbox: { id: inboxId, channel_type: 'Channel::Api' },
    conversation: {
      id: conversationId,
      inbox_id: inboxId,
      contact_inbox: { id: 1, inbox_id: inboxId, source_id: identifier },
      meta: { sender: { id: 1, identifier } },
    },
  };
}

export function buildHostRow({
  accountRef = REF_A,
  roomRef = REF_B,
  mid = '$synthetic-event-1',
  text = 'Synthetic inbound text for tests only.',
  direction = 'INBOUND',
  timestamp = Date.now(),
} = {}) {
  return { accountRef, roomRef, mid, text, direction, timestamp };
}

/** Minimal fake response for the bridge HTTP handler. */
export function createResponseShim() {
  const state = { status: 0, headers: {}, body: '' };
  return {
    state,
    setHeader(name, value) {
      state.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      state.status = status;
      state.headers = { ...state.headers, ...headers };
    },
    end(body = '') {
      state.body = typeof body === 'string' ? body : String(body ?? '');
    },
    get headersSent() {
      return state.status !== 0;
    },
    json() {
      return state.body ? JSON.parse(state.body) : null;
    },
  };
}

/** Minimal async-iterable request for the bridge HTTP handler. */
export function createRequestShim({ method = 'GET', url = '/', headers = {}, body = '', remoteAddress = '127.0.0.1' } = {}) {
  const chunks = body ? [Buffer.from(body, 'utf8')] : [];
  return {
    method,
    url,
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}
