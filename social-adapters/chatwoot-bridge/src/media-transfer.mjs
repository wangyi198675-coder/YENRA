/** Protocol-only media transport. Bytes stay in bounded memory; Chatwoot owns storage/UI. */
export const MEDIA_LIMIT_BYTES = 20 * 1024 * 1024;
export const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'file']);

function fail(code) { throw Object.assign(new Error(code), { code }); }

/** Read a complete, non-redirected Host response with an enforced streaming limit. */
export async function readMediaResponse(response, { maxBytes = MEDIA_LIMIT_BYTES } = {}) {
  if (response.status !== 200) { await response.body?.cancel(); fail(`HOST_MEDIA_HTTP_${response.status}`); }
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!/^(image|video|audio|application|text)\/[a-z0-9.+-]+$/u.test(mime) ||
      /(?:html|javascript|svg|xml)/u.test(mime)) { await response.body?.cancel(); fail('HOST_MEDIA_MIME_UNSUPPORTED'); }
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) { await response.body?.cancel(); fail('HOST_MEDIA_TOO_LARGE'); }
  if (!response.body) fail('HOST_MEDIA_EMPTY');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); fail('HOST_MEDIA_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!total) fail('HOST_MEDIA_EMPTY');
  if (Number.isFinite(length) && length > 0 && length !== total) fail('HOST_MEDIA_TRUNCATED');
  return { bytes: Buffer.concat(chunks, total), mime };
}

const EXTENSIONS = { 'image/jpeg':'jpg', 'image/png':'png', 'image/gif':'gif', 'image/webp':'webp',
  'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov', 'audio/ogg':'ogg',
  'audio/mpeg':'mp3', 'audio/mp4':'m4a', 'audio/wav':'wav', 'audio/webm':'webm',
  'audio/flac':'flac', 'application/pdf':'pdf', 'text/plain':'txt', 'application/zip':'zip' };

/** Native Rails multipart attachments[]; source_id/time are preserved in the SAME message. */
export async function postNativeAttachment(chatwoot, conversationDisplayId, payload, media) {
  if (!Number.isSafeInteger(conversationDisplayId) || conversationDisplayId <= 0) fail('CONVERSATION_ID_INVALID');
  const historicalOutgoing = payload?.message_type === 'outgoing' && payload?.content_attributes?.yenra_history_import === true;
  if ((payload?.message_type !== 'incoming' && !historicalOutgoing) || typeof payload.source_id !== 'string') fail('INBOUND_PAYLOAD_INVALID');
  if (!media?.bytes?.length || media.bytes.length > MEDIA_LIMIT_BYTES) fail('MEDIA_BYTES_INVALID');
  const form = new FormData();
  form.set('content', payload.content);
  form.set('message_type', payload.message_type);
  form.set('private', 'false');
  form.set('source_id', payload.source_id);
  form.set('content_attributes', JSON.stringify(payload.content_attributes));
  // Deliberately no original filename: Host does not expose one reliably; never use caption as filename.
  form.append('attachments[]', new Blob([media.bytes], { type: media.mime }), `attachment.${EXTENSIONS[media.mime] ?? 'bin'}`);
  let response;
  try {
    response = await chatwoot.fetchImpl(`${chatwoot.baseUrl.replace(/\/+$/u, '')}${chatwoot.apiBase}/conversations/${conversationDisplayId}/messages`, {
      method: 'POST', redirect: 'error',
      headers: { api_access_token: chatwoot.token, accept: 'application/json' },
      signal: AbortSignal.timeout(chatwoot.timeoutMs ?? 20000), body: form,
    });
  } catch { fail('CHATWOOT_MEDIA_NETWORK_ERROR'); }
  if (!response.ok) fail(`CHATWOOT_MEDIA_HTTP_${response.status}`);
  let message;
  try { message = await response.json(); } catch { fail('CHATWOOT_MEDIA_RESPONSE_INVALID'); }
  if (!Number.isSafeInteger(message?.id)) fail('CHATWOOT_MEDIA_RESPONSE_INVALID');
  // An earlier text-only row with this source_id cannot be silently called a media success.
  if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
    // Chatwoot natively deduplicates by source_id and returns a prior message
    // unchanged. A historical text-only row with this MID cannot be repaired
    // by POSTing again; the existing native message needs a one-time attachment
    // backfill via the original Chatwoot model (never a second new message).
    fail(message.source_id === payload.source_id
      ? 'CHATWOOT_MEDIA_EXISTING_TEXT_ONLY_MID'
      : 'CHATWOOT_MEDIA_ATTACHMENT_MISSING');
  }
  return message;
}
