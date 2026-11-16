import test from 'node:test';
import assert from 'node:assert/strict';
import { openVerifiedPageContact } from '../src/page-contact.mjs';
import { createInboundBridge } from '../src/inbound.mjs';
import { stableContactIdentifier } from '../src/contract.mjs';
import { resolveInboxMap, buildRosterIndex } from '../src/inbox-map.mjs';
import { silentLogger } from '../src/logger.mjs';
import {
  ROSTER, API_INBOXES, REF_A, REF_B, buildHostRow,
  createFakeChatwoot, createFakeHost, contactFor,
} from './fixtures/synthetic.mjs';

const PAGE_ACCOUNT = '3'.repeat(32);
const PAGE_ROOM = '5'.repeat(32);

async function setup({ ownerChannel = 'Page', wrongInbox = false } = {}) {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  const index = buildRosterIndex(ROSTER, resolved.mapping);
  const accountRef = ownerChannel === 'Page' ? PAGE_ACCOUNT : REF_A;
  const roomRef = ownerChannel === 'Page' ? PAGE_ROOM : REF_B;
  const contact = contactFor({
    id: 811, identifier: stableContactIdentifier(accountRef, roomRef),
    inboxId: wrongInbox ? 2 : resolved.mapping.get(accountRef).inboxId,
  });
  const chatwoot = createFakeChatwoot({ contacts: [contact] });
  let contactReads = 0;
  chatwoot.getContactById = async id => {
    contactReads += 1;
    return id === contact.id ? contact : null;
  };
  const row = buildHostRow({
    accountRef, roomRef, mid: '$page-user-click-synthetic',
    timestamp: Date.now() - 8 * 60 * 60 * 1000,
  });
  const host = createFakeHost({
    onReadRoom: ({ accountRef: a, roomRef: r }) => ({
      accountRef: a, roomRef: r, messages: [row],
    }),
  });
  const inbound = createInboundBridge({
    host, chatwoot, mapping: resolved.mapping, roster: ROSTER,
    logger: silentLogger,
  });
  return { index, inbound, chatwoot, host, contactReads: () => contactReads };
}

test('verified Page contact click hydrates only its own original Host room', async () => {
  const { index, inbound, chatwoot, host, contactReads } = await setup();
  assert.equal(host.reads.length, 0);
  const result = await openVerifiedPageContact({
    chatwoot, index, inbound, contactId: 811, accountId: 1, expectedAccountId: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);
  assert.equal(result.conversationDisplayId, 500);
  assert.equal(contactReads(), 1);
  assert.equal(host.reads.length, 1);
  assert.equal(host.reads[0].roomRef, PAGE_ROOM);
  assert.equal(chatwoot.calls.createConversation, 1);
});

test('a Personal contact click is not a Page history import', async () => {
  const { index, inbound, chatwoot, host } = await setup({ ownerChannel: 'Personal' });
  const result = await openVerifiedPageContact({
    chatwoot, index, inbound, contactId: 811, accountId: 1, expectedAccountId: 1,
  });
  assert.equal(result.code, 'NOT_A_VERIFIED_PAGE_CONTACT');
  assert.equal(host.reads.length, 0);
  assert.equal(chatwoot.calls.createConversation, 0);
});

test('wrong account, contact and inbox cannot initiate Page room reads', async () => {
  const { index, inbound, chatwoot, host, contactReads } = await setup({ wrongInbox: true });
  assert.equal((await openVerifiedPageContact({
    chatwoot, index, inbound, contactId: 811, accountId: 2, expectedAccountId: 1,
  })).code, 'PAGE_CONTACT_SCOPE_INVALID');
  assert.equal((await openVerifiedPageContact({
    chatwoot, index, inbound, contactId: 812, accountId: 1, expectedAccountId: 1,
  })).code, 'PAGE_CONTACT_IDENTITY_MISMATCH');
  assert.equal((await openVerifiedPageContact({
    chatwoot, index, inbound, contactId: 811, accountId: 1, expectedAccountId: 1,
  })).code, 'PAGE_CONTACT_INBOX_MISMATCH');
  assert.equal(contactReads(), 2);
  assert.equal(host.reads.length, 0);
});

test('complete Chatwoot native Page screen reopens with no Host historical reread', async () => {
  const { index, inbound, chatwoot, host } = await setup();
  const scope = [...index.byIdentifier.values()].find(x => x.channel === 'Page');
  let nativeReads = 0;
  chatwoot.listContactConversations = async id => {
    assert.equal(id, 811);
    return [{ id: 500, account_id: 1, inbox_id: scope.inboxId, timestamp: 12 }];
  };
  chatwoot.listConversationMessages = async id => {
    nativeReads += 1; assert.equal(id, 500);
    return Array.from({ length: 20 }, (_, i) => ({ id:301+i,message_type:0, source_id: 'page-mid-' + i }));
  };
  const result = await openVerifiedPageContact({ chatwoot, index, inbound,
    contactId: 811, accountId: 1, expectedAccountId: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.reusedNativeScreen, true);
  assert.equal(result.conversationDisplayId, 500);
  assert.equal(nativeReads, 1);
  assert.equal(host.reads.length, 0);
  assert.equal(chatwoot.calls.createConversation, 0);
});

test('Page short native Cloud screens with 1, 8 or 19 messages never query retired SDK',async()=>{
 for(const count of [1,8,19]){
  const {index,inbound,chatwoot,host}=await setup();
  const scope=[...index.byIdentifier.values()].find(x=>x.channel==='Page');
  chatwoot.listContactConversations=async()=>[{
   id:500,account_id:1,inbox_id:scope.inboxId,timestamp:1
  }];
  chatwoot.listConversationMessages=async()=>Array.from({length:count},(_,i)=>({
   id:900+i,conversation_id:500,message_type:i%2,
   private:false,source_id:i%2===0?'m_original_'+i:null
  }));
  const result=await openVerifiedPageContact({chatwoot,index,inbound,
   contactId:811,accountId:1,expectedAccountId:1});
  assert.equal(result.ok,true);
  assert.equal(result.reusedNativeScreen,true);
  assert.equal(result.conversationDisplayId,500);
  assert.equal(host.reads.length,0,'Cloud first, no old SDK for '+count+' messages');
 }
});
test('duplicate-native Page message identity falls back to verified Host', async () => {
  const { index, inbound, chatwoot, host } = await setup();
  const scope = [...index.byIdentifier.values()].find(x => x.channel === 'Page');
  chatwoot.listContactConversations = async () =>
    [{ id: 500, account_id: 1, inbox_id: scope.inboxId, timestamp: 1 }];
  chatwoot.listConversationMessages = async () =>
    Array.from({ length: 20 }, () => ({ id:33,message_type:0,source_id: 'same-not-unique' }));
  const result = await openVerifiedPageContact({ chatwoot, index, inbound,
    contactId: 811, accountId: 1, expectedAccountId: 1 });
  assert.equal(result.ok, true);
  assert.notEqual(result.reusedNativeScreen, true);
  assert.equal(host.reads.length, 1);
});

test('native Page screen from wrong inbox cannot bypass Host scope', async () => {
  const { index, inbound, chatwoot, host } = await setup();
  chatwoot.listContactConversations = async () =>
    [{ id: 999, account_id: 1, inbox_id: 2, timestamp: 1 }];
  chatwoot.listConversationMessages = async () => { throw Error('WRONG_INBOX_WAS_READ'); };
  const result = await openVerifiedPageContact({ chatwoot, index, inbound,
    contactId: 811, accountId: 1, expectedAccountId: 1 });
  assert.equal(result.ok, true);
  assert.equal(host.reads.length, 1);
});
