/**
 * One-shot presentation sync of authorized social accounts to native Chatwoot
 * Inbox fields. Runs after the trusted accountRef->inbox binding is proven.
 * No extra login, queue, Sender, database or periodic polling.
 */
function clean(value, max = 75) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/gu, '').trim().slice(0, max) : '';
}

export function deriveInboxName(account, profile = null) {
  if (account?.channel === 'WhatsApp') {
    const name = clean(profile?.displayName);
    const phone = /^\+[1-9][0-9]{4,14}$/u.test(profile?.ownPhone ?? '') ? profile.ownPhone : '';
    const fallback = Number.isSafeInteger(account.whatsappOrdinal) ? `账号 ${account.whatsappOrdinal}` : '个人账号';
    return `WhatsApp · ${name || phone || fallback}${name && phone ? ` · ${phone}` : ''}`.slice(0, 120);
  }
  if (account?.channel === 'Page') {
    const raw = clean(account.accountLabel, 100);
    // Original Host label is "Page · real page name · last 4 ID digits".
    const name = raw.replace(/^Page\s*·\s*/iu, '').replace(/\s*·\s*[0-9]{4}$/u, '').trim();
    return `Messenger · ${name || 'Facebook Page'}`.slice(0, 120);
  }
  if (account?.channel === 'Personal') {
    const name = clean(account.accountLabel);
    return `Facebook 个人 · ${name || '已连接账号'}`.slice(0, 120);
  }
  return null;
}

export async function syncAccountInboxPresentation({ host, chatwoot, roster, resolved, inboxes, logger }) {
  const byId = new Map(inboxes.map(item => [item.id, item]));
  const byRef = new Map(roster.accounts.map(account => [account.accountRef, account]));
  for (const entry of resolved.entries) {
    const account = byRef.get(entry.accountRef);
    const original = byId.get(entry.inboxId);
    if (!account || !original || original.channelType !== 'Channel::Api' || entry.bindingVerified !== true) {
      logger?.warn?.('inbox_presentation.skipped_unverified', { inboxId: entry.inboxId });
      continue;
    }
    let profile = null;
    if (account.channel === 'WhatsApp') {
      try { profile = await host.readOwnWhatsAppProfile(account.accountRef); }
      catch { /* The original account connection may be offline; never invent its identity. */ }
    }
    // Preserve the last verified account name if its native Socket is offline.
    if (account.channel === 'WhatsApp' && !profile?.displayName && !profile?.ownPhone &&
        !/Stage/u.test(original.name)) continue;
    const name = deriveInboxName(account, profile);
    if (!name) continue;
    let avatar = null;
    if (account.channel === 'WhatsApp' && !original.avatarUrl) {
      try { avatar = await host.readOwnWhatsAppAvatar(account.accountRef); }
      catch { /* Native platform photo absent: brand icon is the honest fallback. */ }
    }
    if (name === original.name && !avatar) continue;
    try {
      await chatwoot.updateInboxIdentity({ inboxId: entry.inboxId, name, avatar });
      logger?.info?.('inbox_presentation.updated', {
        inboxId: entry.inboxId, channel: account.channel,
        nameUpdated: name !== original.name, avatarUploaded: Boolean(avatar),
      });
    } catch (error) {
      logger?.warn?.('inbox_presentation.native_update_failed', {
        inboxId: entry.inboxId, code: error?.code ?? 'UNKNOWN',
      });
    }
  }
}
