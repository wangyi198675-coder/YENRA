import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConversationSelection } from '../src/selection.mjs';
import { buildRosterIndex } from '../src/inbox-map.mjs';
import { stableContactIdentifier } from '../src/contract.mjs';

function makeScope() {
  const accountRefA = 'a'.repeat(32);
  const accountRefB = 'b'.repeat(32);
  const roomA = '1'.repeat(32);
  const roomB = '2'.repeat(32);
  const roster = {
    accounts: [
      { channel: 'Personal', accountRef: accountRefA, whatsappOrdinal: 1, rooms: [{ roomRef: roomA, lastMessageAt: 1 }] },
      { channel: 'WhatsApp', accountRef: accountRefB, whatsappOrdinal: 1, rooms: [{ roomRef: roomB, lastMessageAt: 1 }] },
    ],
  };
  const mapping = new Map([
    [accountRefA, { inboxId: 2, label: 'FB Personal' }],
    [accountRefB, { inboxId: 3, label: 'WhatsApp 1' }],
  ]);
  return { index: buildRosterIndex(roster, mapping), accountRefA, accountRefB, roomA, roomB };
}

test('resolves a conversation display_id to the verified host scope', async () => {
  const { index, accountRefA, roomA } = makeScope();
  const identifier = stableContactIdentifier(accountRefA, roomA);
  const chatwoot = {
    async getConversation(displayId) {
      assert.equal(displayId, 123);
      return { id: 123, account_id:1, inbox_id:2, meta: { sender: { identifier } }, contact_inbox: { source_id: identifier } };
    },
  };
  const result = await resolveConversationSelection({ chatwoot, index, accountId: 1, displayId: 123 });
  assert.equal(result.ok, true);
  assert.equal(result.selection.accountRef, accountRefA);
  assert.equal(result.selection.roomRef, roomA);
  assert.equal(result.selection.channel, 'Personal');
  assert.equal(result.selection.inboxId, 2);
});

test('uses contact_inbox.source_id when sender identifier is absent', async () => {
  const { index, accountRefB, roomB } = makeScope();
  const identifier = stableContactIdentifier(accountRefB, roomB);
  const chatwoot = {
    async getConversation() {
      return { id: 456, account_id:1, inbox_id:3, meta: {}, contact_inbox: { source_id: identifier } };
    },
  };
  const result = await resolveConversationSelection({ chatwoot, index, accountId: 1, displayId: 456 });
  assert.equal(result.ok, true);
  assert.equal(result.selection.accountRef, accountRefB);
  assert.equal(result.selection.channel, 'WhatsApp');
});

test('fails closed when identifier is not in the roster', async () => {
  const { index } = makeScope();
  const chatwoot = { async getConversation() { return { id: 9, account_id:1, inbox_id:2, meta: { sender: { identifier: 'yenra-not-in-roster' } } }; } };
  const result = await resolveConversationSelection({ chatwoot, index, accountId: 1, displayId: 9 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'IDENTIFIER_NOT_IN_ROSTER');
});

test('fails closed when conversation has no yenra identifier', async () => {
  const { index } = makeScope();
  const chatwoot = { async getConversation() { return { id: 7, account_id:1, inbox_id:2, meta: { sender: { identifier: 'some-phone-number' } } }; } };
  const result = await resolveConversationSelection({ chatwoot, index, accountId: 1, displayId: 7 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_YENRA_CONTACT_IDENTIFIER');
});

test('same contact identifier cannot cross paid Cloud account, inbox or conversation ID',async()=>{
 const {index,accountRefA,roomA}=makeScope();
 const identifier=stableContactIdentifier(accountRefA,roomA);
 for(const [account_id,inbox_id,id,reason] of [
  [196799,2,123,'CONVERSATION_ACCOUNT_SCOPE_MISMATCH'],
  [1,3,123,'CONVERSATION_INBOX_SCOPE_MISMATCH'],
  [1,2,124,'CONVERSATION_ACCOUNT_SCOPE_MISMATCH'],
 ]){
  const chatwoot={getConversation:async()=>({id,account_id,inbox_id,
   meta:{sender:{identifier}},contact_inbox:{source_id:identifier}})};
  const result=await resolveConversationSelection({chatwoot,index,accountId:1,displayId:123});
  assert.equal(result.ok,false);
  assert.equal(result.error,reason);
 }
});
test('rejects invalid account/display ids without calling Chatwoot', async () => {
  const { index } = makeScope();
  const chatwoot = { async getConversation() { throw new Error('should not be called'); } };
  assert.equal((await resolveConversationSelection({ chatwoot, index, accountId: 0, displayId: 1 })).error, 'ACCOUNT_ID_INVALID');
  assert.equal((await resolveConversationSelection({ chatwoot, index, accountId: 1, displayId: 0 })).error, 'DISPLAY_ID_INVALID');
});

test('surfaces Chatwoot lookup failures without leaking scope', async () => {
  const { index } = makeScope();
  const chatwoot = {
    async getConversation() { const e = new Error('boom'); e.code = 'CHATWOOT_HTTP_404'; throw e; },
  };
  const result = await resolveConversationSelection({ chatwoot, index, accountId: 1, displayId: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'CONVERSATION_LOOKUP_FAILED');
  assert.equal(result.code, 'CHATWOOT_HTTP_404');
});


test('Chatwoot display_id resolves even when the internal conversation id is different', async () => {
  const {index, accountRefA, roomA}=makeScope();
  const identifier=stableContactIdentifier(accountRefA,roomA);
  const chatwoot={getConversation:async()=>({id:48,display_id:16,account_id:1,inbox_id:2,
    meta:{sender:{identifier}},contact_inbox:{source_id:identifier}})};
  const result=await resolveConversationSelection({chatwoot,index,accountId:1,displayId:16});
  assert.equal(result.ok,true);
  assert.equal(result.selection.roomRef,roomA);
});

test('explicit mismatched display_id never falls back to an equal internal id', async () => {
  const {index,accountRefA,roomA}=makeScope();
  const identifier=stableContactIdentifier(accountRefA,roomA);
  const chatwoot={getConversation:async()=>({id:16,display_id:999,account_id:1,inbox_id:2,
    meta:{sender:{identifier}},contact_inbox:{source_id:identifier}})};
  const result=await resolveConversationSelection({chatwoot,index,accountId:1,displayId:16});
  assert.equal(result.ok,false);
  assert.equal(result.error,'CONVERSATION_ACCOUNT_SCOPE_MISMATCH');
});
