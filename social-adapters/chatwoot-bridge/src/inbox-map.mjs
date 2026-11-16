/**
 * accountRef -> Chatwoot API inbox resolution and the inverse identity index.
 *
 * Why this file exists: Chatwoot knows a conversation only by its own contact
 * identifier ("yenra-<sha256 fragment>"), which is deliberately one-way. The
 * outbound path therefore needs an index from that identifier back to the Host
 * scope. The index is DERIVED from the Host's read-only roster on startup and
 * kept in memory only: no database, no cache file, no second source of truth.
 *
 * The inbox mapping itself is verified against Chatwoot's own contact_inboxes
 * bindings (a contact created for account A must be bound to A's inbox), so a
 * roster order change or a renamed inbox fails closed instead of silently
 * mixing two accounts.
 */
import { inboxLabel, isAccountRef, stableContactIdentifier } from './contract.mjs';

function apiInboxes(inboxes) {
  return (Array.isArray(inboxes) ? inboxes : []).filter((inbox) => inbox?.channelType === 'Channel::Api');
}

function nameMatches(name, expectedLabel) {
  if (typeof name !== 'string' || !name) return false;
  if (name === expectedLabel) return true;
  if (name.endsWith(` ${expectedLabel}`)) return true;
  if (name.endsWith(` ${expectedLabel.replace(/^FB /u, '')}`)) return true;
  return false;
}

function overrideFor(override, account) {
  if (!override || typeof override !== 'object') return null;
  const keys = [account.accountRef, inboxLabel({ channel: account.channel, whatsappOrdinal: account.whatsappOrdinal })];
  if (account.channel === 'WhatsApp') keys.push('WhatsApp', 'WhatsApp ' + account.whatsappOrdinal);
  for (const key of keys) {
    if (Number.isSafeInteger(override[key])) return override[key];
  }
  return null;
}

/**
 * @param {object} options
 * @param {object} options.roster normalised Host roster (host-client.normalizeRoster)
 * @param {Array<object>} options.inboxes ChatwootClient.listInboxes() result
 * @param {Record<string, number>} [options.override] CHATWOOT_INBOX_MAP
 * @param {{findContactByIdentifier: Function}} [options.chatwoot] used for binding verification
 * @param {number} [options.sampleRooms] rooms per account used for verification
 * @returns {Promise<object>} { ok, entries, mapping, failures }
 */
export async function resolveInboxMap({ roster, inboxes, override = {}, chatwoot = null, sampleRooms = 2 } = {}) {
  if (!roster || !Array.isArray(roster.accounts)) {
    return { ok: false, entries: [], mapping: new Map(), failures: ['ROSTER_NOT_NORMALISED'] };
  }
  const apis = apiInboxes(inboxes);
  if (!apis.length) return { ok: false, entries: [], mapping: new Map(), failures: ['NO_CHATWOOT_API_INBOX'] };

  const failures = [];
  const usedInboxIds = new Set();
  const entries = [];

  for (const account of roster.accounts) {
    const label = inboxLabel({ channel: account.channel, whatsappOrdinal: account.whatsappOrdinal });
    const explicit = overrideFor(override, account);
    let candidates;
    let source;
    if (explicit !== null) {
      candidates = apis.filter((inbox) => inbox.id === explicit);
      source = 'CHATWOOT_INBOX_MAP';
    } else {
      candidates = apis.filter((inbox) => nameMatches(inbox.name, label));
      source = 'INBOX_NAME';
    }
    // Renaming an Inbox to its real account name must not break routing.
    // Resolve a previously bound channel through native Chatwoot contacts.
    if (explicit === null && candidates.length !== 1 && chatwoot?.findContactByIdentifier) {
      const boundIds = new Set();
      for (const room of pickSampleRooms(account, 3)) {
        try {
          const contact = await chatwoot.findContactByIdentifier(stableContactIdentifier(account.accountRef, room.roomRef));
          const ids = (Array.isArray(contact?.contact_inboxes) ? contact.contact_inboxes : [])
            .map((binding) => binding?.inbox?.id ?? binding?.inbox_id)
            .filter((id) => apis.some((inbox) => inbox.id === id));
          ids.forEach((id) => boundIds.add(id));
        } catch {
          failures.push(`INBOX_BINDING_LOOKUP_FAILED:${label}`);
          break;
        }
      }
      if (boundIds.size === 1) {
        candidates = apis.filter((inbox) => boundIds.has(inbox.id));
        source = 'VERIFIED_CONTACT_INBOX';
      }
    }
    if (candidates.length !== 1) {
      failures.push(
        candidates.length === 0
          ? `INBOX_NOT_FOUND:${label}`
          : `INBOX_AMBIGUOUS:${label}`,
      );
      continue;
    }
    const inbox = candidates[0];
    if (usedInboxIds.has(inbox.id)) {
      failures.push(`INBOX_USED_TWICE:${inbox.id}`);
      continue;
    }
    usedInboxIds.add(inbox.id);
    entries.push({
      channel: account.channel,
      accountRef: account.accountRef,
      label,
      inboxId: inbox.id,
      inboxName: inbox.name,
      resolvedBy: source,
      contactSampleFound: false,
      bindingVerified: false,
    });
  }

  // Binding verification against Chatwoot's own contact_inboxes records.
  if (chatwoot && typeof chatwoot.findContactByIdentifier === 'function') {
    for (const entry of entries) {
      const account = roster.accounts.find((item) => item.accountRef === entry.accountRef);
      if (!account) continue;
      const samples = pickSampleRooms(account, sampleRooms);
      let checked = 0;
      for (const room of samples) {
        let identifier;
        try {
          identifier = stableContactIdentifier(account.accountRef, room.roomRef);
        } catch {
          continue;
        }
        let contact = null;
        try {
          contact = await chatwoot.findContactByIdentifier(identifier);
        } catch (error) {
          failures.push(`CONTACT_LOOKUP_FAILED:${entry.label}:${error?.code ?? 'UNKNOWN'}`);
          break;
        }
        if (!contact) continue;
        checked += 1;
        entry.contactSampleFound = true;
        const bindings = Array.isArray(contact.contact_inboxes) ? contact.contact_inboxes : [];
        const boundInboxIds = bindings
          .map((binding) => binding?.inbox?.id ?? binding?.inbox_id)
          .filter((id) => Number.isSafeInteger(id));
        if (!boundInboxIds.includes(entry.inboxId)) {
          failures.push(`CONTACT_BOUND_TO_OTHER_INBOX:${entry.label}`);
          break;
        }
        entry.bindingVerified = true;
      }
      entry.contactSamplesChecked = checked;
    }
  }

  const ok = failures.length === 0 && entries.length === roster.accounts.length;
  const mapping = new Map(entries.map((entry) => [entry.accountRef, entry]));
  return { ok, entries, mapping, failures };
}

function pickSampleRooms(account, limit) {
  const rooms = Array.isArray(account.rooms) ? account.rooms.slice() : [];
  rooms.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  const take = Math.max(0, limit);
  const samples = rooms.slice(0, take);
  // Page is roster-first: the newest contacts may not yet have a Chatwoot row.
  // Include two older stable samples before calling the verified Inbox unbound.
  if (account.channel === 'Page' && take > 0 && rooms.length > take) {
    for (const i of [Math.floor(rooms.length / 2), rooms.length - 1]) {
      const candidate = rooms[i];
      if (candidate && !samples.some((room) => room.roomRef === candidate.roomRef)) samples.push(candidate);
    }
  }
  return samples;
}

/**
 * Build the identifier -> Host scope index used by the outbound webhook path.
 * Purely derived from the Host roster; rebuilt on every start, never persisted.
 */
export function buildRosterIndex(roster, mapping) {
  if (!roster || !Array.isArray(roster.accounts)) throw new Error('ROSTER_NOT_NORMALISED');
  const byIdentifier = new Map();
  const byAccountRef = new Map();
  for (const account of roster.accounts) {
    const entry = mapping?.get?.(account.accountRef) ?? null;
    byAccountRef.set(account.accountRef, {
      channel: account.channel,
      accountRef: account.accountRef,
      whatsappOrdinal: account.whatsappOrdinal,
      inboxId: entry?.inboxId ?? null,
      label: entry?.label ?? null,
      rooms: account.rooms.map((room) => room.roomRef),
    });
    for (const room of account.rooms) {
      if (!isAccountRef(room.roomRef)) continue;
      const identifier = stableContactIdentifier(account.accountRef, room.roomRef);
      byIdentifier.set(identifier, {
        channel: account.channel,
        accountRef: account.accountRef,
        roomRef: room.roomRef,
        inboxId: entry?.inboxId ?? null,
        label: entry?.label ?? null,
      });
    }
  }
  return { byIdentifier, byAccountRef, size: byIdentifier.size };
}
