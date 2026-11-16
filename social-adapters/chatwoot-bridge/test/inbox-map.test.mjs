import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterIndex, resolveInboxMap } from '../src/inbox-map.mjs';
import {
  API_INBOXES,
  RAW_ROSTER,
  ROSTER,
  REF_A,
  REF_B,
  contactFor,
  createFakeChatwoot,
} from './fixtures/synthetic.mjs';

test('resolveInboxMap maps the four accounts to the four API inboxes by name', async () => {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.entries.length, 4);
  assert.deepEqual(
    resolved.entries.map((entry) => [entry.label, entry.inboxId]),
    [
      ['FB Personal', 2],
      ['WhatsApp 1', 3],
      ['WhatsApp 2', 4],
      ['FB Page', 5],
    ],
  );
  assert.equal(resolved.mapping.get(REF_A).inboxId, 2);
});

test('resolveInboxMap verifies contact_inboxes bindings against Chatwoot', async () => {
  const { inboxLabel, stableContactIdentifier } = await import('../src/contract.mjs');
  const contacts = [];
  let id = 1;
  for (const account of ROSTER.accounts) {
    const label = inboxLabel({ channel: account.channel, whatsappOrdinal: account.whatsappOrdinal });
    const inbox = API_INBOXES.find((box) => box.name === `YENRA Stage ${label}`);
    const room = [...account.rooms].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))[0];
    contacts.push(contactFor({ id: id++, identifier: stableContactIdentifier(account.accountRef, room.roomRef), inboxId: inbox.id }));
  }
  const chatwoot = createFakeChatwoot({ contacts });
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES, chatwoot });
  assert.equal(resolved.ok, true);
  assert.ok(resolved.entries.every((entry) => entry.bindingVerified === true));
});

test('resolveInboxMap fails closed when a contact is bound to a different inbox', async () => {
  const { stableContactIdentifier } = await import('../src/contract.mjs');
  const room = [...ROSTER.accounts[0].rooms].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))[0];
  const chatwoot = createFakeChatwoot({
    contacts: [contactFor({ id: 1, identifier: stableContactIdentifier(ROSTER.accounts[0].accountRef, room.roomRef), inboxId: 5 })],
  });
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES, chatwoot });
  assert.equal(resolved.ok, false);
  assert.ok(resolved.failures.includes('CONTACT_BOUND_TO_OTHER_INBOX:FB Personal'));
});

test('resolveInboxMap rejects ambiguous or missing inbox names', async () => {
  const duplicated = [...API_INBOXES, { id: 9, name: 'YENRA Stage FB Personal', channelType: 'Channel::Api' }];
  const ambiguous = await resolveInboxMap({ roster: ROSTER, inboxes: duplicated });
  assert.equal(ambiguous.ok, false);
  assert.ok(ambiguous.failures.includes('INBOX_AMBIGUOUS:FB Personal'));

  const missing = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES.filter((box) => box.id !== 5) });
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.includes('INBOX_NOT_FOUND:FB Page'));
});

test('resolveInboxMap honours an explicit accountRef override', async () => {
  const inboxes = [...API_INBOXES, { id: 6, name: 'YENRA Dedicated Override', channelType: 'Channel::Api' }];
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes, override: { [REF_A]: 6 } });
  assert.equal(resolved.ok, true);
  const entry = resolved.entries.find((item) => item.accountRef === REF_A);
  assert.equal(entry.inboxId, 6);
  assert.equal(entry.resolvedBy, 'CHATWOOT_INBOX_MAP');
});

test('resolveInboxMap requires at least one API inbox', async () => {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: [{ id: 1, name: 'x', channelType: 'Channel::WebWidget' }] });
  assert.deepEqual(resolved.failures, ['NO_CHATWOOT_API_INBOX']);
});

test('buildRosterIndex is derived from the roster and resolves identifiers back to scope', async () => {
  const resolved = await resolveInboxMap({ roster: ROSTER, inboxes: API_INBOXES });
  const index = buildRosterIndex(ROSTER, resolved.mapping);
  assert.equal(index.size, 7);
  const { stableContactIdentifier } = await import('../src/contract.mjs');
  const scope = index.byIdentifier.get(stableContactIdentifier(REF_A, REF_B));
  assert.deepEqual(scope, { channel: 'Personal', accountRef: REF_A, roomRef: REF_B, inboxId: 2, label: 'FB Personal' });
  assert.equal(index.byAccountRef.get(REF_A).rooms.length, 2);
  assert.throws(() => buildRosterIndex({}, resolved.mapping), /ROSTER_NOT_NORMALISED/);
});


test('Page verifies a previously bound contact when newest roster contacts are unimported', async () => {
  const { stableContactIdentifier } = await import('../src/contract.mjs');
  const original = ROSTER.accounts.find((a) => a.channel === 'Page');
  const rooms = Array.from({ length: 8 }, (_, i) => ({ roomRef: (i + 10).toString(16).padStart(32, '0'), lastMessageAt: 1000 - i }));
  const roster = { ...ROSTER, accounts: ROSTER.accounts.map((a) => a.channel === 'Page' ? { ...a, rooms } : a) };
  const known = contactFor({ id: 991, identifier: stableContactIdentifier(original.accountRef, rooms[4].roomRef), inboxId: 5 });
  const result = await resolveInboxMap({ roster, inboxes: API_INBOXES, chatwoot: createFakeChatwoot({ contacts: [known] }) });
  const page = result.entries.find((a) => a.channel === 'Page');
  assert.equal(result.ok, true);
  assert.equal(page.bindingVerified, true);
  assert.equal(page.contactSamplesChecked, 1);
});
