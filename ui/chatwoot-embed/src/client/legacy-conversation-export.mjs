/**
 * Chatwoot embed -> ORIGINAL YENRA/ChatLume v1.8.6 exporter.
 * Explicit user action only; no new message store, Sender, channel connection,
 * background history task, or Chatwoot upstream fork.
 */
import { messagesFromHost } from '../../../../social-adapters/oss-candidates/existing-host-generic-mapping.mjs';
import { exportAuthorizedConversation } from '../../../../social-adapters/oss-candidates/messaging-inbox/src/lib/yenra-export/run-export.mjs';

const REF = /^[a-f0-9]{32}$/;
const CHANNELS = new Set(['WhatsApp', 'Personal', 'Page']);

function assertScope(scope) {
  if (!REF.test(scope?.accountRef ?? '') || !REF.test(scope?.roomRef ?? '')) {
    throw Error('当前联系人尚未通过原 Host 身份核验，不能导出');
  }
}
function live(cancelled) {
  if (cancelled()) throw Error('导出已取消或联系人已经切换');
}
async function getJson(url, cancelled, timeoutMs = 35000) {
  live(cancelled);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw Error('原 Host 只读数据请求失败 (HTTP ' + response.status + ')');
    const value = await response.json();
    live(cancelled);
    if (value?.ok !== true) throw Error('原 Host 当前无法提供完整授权数据');
    return value;
  } finally {
    clearTimeout(timer);
  }
}
function sameRoom(a, b) {
  return a.accountRef === b.accountRef && a.roomRef === b.roomRef;
}
export async function exportSelectedLegacyConversation({
  scope, format = 'zip', cancelled = () => false, onProgress = () => {},
} = {}) {
  assertScope(scope);
  if (format !== 'zip' && format !== 'html') throw Error('导出格式无效');
  const exact = { accountRef: scope.accountRef, roomRef: scope.roomRef };
  // This is the very same cached original Host roster used by YENRA's
  // Chatwoot identity resolver. NEVER trust a browser-supplied channel label.
  const roster = await getJson('/api/yenra/oss-roster', cancelled, 5000);
  const matches = [];
  for (const account of roster?.roster?.accounts ?? []) {
    if (account?.accountRef !== exact.accountRef || !CHANNELS.has(account?.channel)) continue;
    for (const room of account.rooms ?? []) {
      if (room?.roomRef === exact.roomRef) matches.push({ account, room });
    }
  }
  if (matches.length !== 1) throw Error('当前账号或联系人无法在原始授权名册中唯一核实');
  const { account, room } = matches[0];
  let messages = null;
  const mediaUrls = new Map();
  const translations = {};
  const base = 'accountRef=' + encodeURIComponent(exact.accountRef)
    + '&roomRef=' + encodeURIComponent(exact.roomRef);
  const provider = {
    // Old original Host SDK exposes a single already-bounded room snapshot,
    // not cursor pagination. We do not invent a multi-page history source.
    async findMessagesPaginated(_instance, roomRef, { page }) {
      live(cancelled);
      if (roomRef !== exact.roomRef || page !== 1 || messages !== null) {
        throw Error('导出分页上下文不匹配');
      }
      const isWhatsApp = account.channel === 'WhatsApp';
      const uri = isWhatsApp
        ? '/api/yenra/social-read?mode=room&' + base
        : '/api/yenra/facebook-room?' + base;
      const payload = await getJson(uri, cancelled);
      const expectedPrefix = isWhatsApp ? 'YENRA_SOCIAL_V1:' : 'YENRA_FACEBOOK_V1:';
      if (typeof payload.text !== 'string' || !payload.text.startsWith(expectedPrefix)) {
        throw Error('原 Host 会话数据来源无效');
      }
      const source = JSON.parse(payload.text.slice(expectedPrefix.length));
      if (!sameRoom(source, exact) || source.channel !== account.channel ||
          source.schema !== 1 || !Array.isArray(source.messages)) {
        throw Error('导出消息与当前账号或联系人不一致');
      }
      messages = messagesFromHost(source, exact.accountRef, exact.roomRef);
      for (const message of messages) {
        const url = message.metadata?.nativeMediaPath;
        if (typeof url === 'string' && url.startsWith('/api/yenra/')) {
          mediaUrls.set(message.id, url);
        } else if (account.channel === 'Personal' && message.hasMedia &&
                   message.id.startsWith('$')) {
          mediaUrls.set(message.id, '/api/yenra/facebook-media?' + base +
            '&mid=' + encodeURIComponent(message.id));
        } else if (account.channel === 'Page' &&
                   typeof message.mediaData?.url === 'string' &&
                   message.mediaData.url.startsWith('https://')) {
          mediaUrls.set(message.id, message.mediaData.url);
        }
        const saved = message.metadata?.verifiedTranslation;
        if (typeof saved === 'string' && saved.trim()) translations[message.id] = saved.trim();
      }
      onProgress({ stage: 'messages', received: messages.length, total: messages.length });
      return { messages, pagination: { hasMore: false, total: messages.length } };
    },
    async getMediaUrl(instance, mediaId, roomRef) {
      live(cancelled);
      if (instance !== exact.accountRef || roomRef !== exact.roomRef ||
          !mediaUrls.has(mediaId)) throw Error('媒体引用不属于当前验证会话');
      return mediaUrls.get(mediaId);
    },
  };
  const avatarUri = account.channel === 'WhatsApp'
    ? '/api/yenra/social-read?mode=avatar&' + base
    : '/api/yenra/facebook-avatar?' + base;
  // ChatLume is the original mature renderer, ZIP packager and downloader.
  // Partial original history must remain described as such in its summary.
  return exportAuthorizedConversation({
    provider, instance: exact.accountRef, roomRef: exact.roomRef,
    contactName: (room.nameKnown && room.name?.trim()) ||
      (typeof room.phoneFallback === 'string' ? room.phoneFallback : '') || '联系人',
    avatarUri, translations, format, cancelled, onProgress,
  });
}
