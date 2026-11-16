/**
 * Read-only client for the ONE current DSH Host social plugin
 * (@yenra/desktop-ui-candidate, http://127.0.0.1:60474).
 *
 * Read requests use GET. A single selected-chat presence subscription uses
 * the original Socket via a verified local POST; it cannot send messages.
 * The unique Sender is reached by outbound.mjs through the Host's owner-click route
 * and only when ENABLE_REAL_SEND is explicitly true.
 *
 * No polling loop, no second Socket, no second login, no cache file. The roster
 * is a read projection returned by the Host; the SSE stream is the Host's own
 * existing single event feed.
 */
import { isAccountRef, ContractError } from './contract.mjs';
import { readMediaResponse } from './media-transfer.mjs';
import { readVerifiedSendPulsePageRoom } from './sendpulse-page-roster.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const ROSTER_KEYS = new Set(['', 'refresh', 'verifiedW25']);
const EMPTY_TIMEOUT = 'HOST_TIMEOUT';

/** Discover only the currently authorized ORIGINAL DSH desktop Host on loopback.
 * The installed v6+ Host executable is YENRA.exe, whereas pre-install preview
 * builds use electron.exe. Never assume the former still runs as electron.exe,
 * and never accept a second Host, unrelated listener, or inspector port.
 * This script is read-only and is used only after a network failure.
 */
export function officialHostRecoveryPowerShell() {
  return [
    "$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -in @('electron.exe','YENRA.exe') -and $_.CommandLine -like '*dsh-desktop-host*' -and $_.CommandLine -like '*profiles\\desktop*' -and $_.CommandLine -like '*--expose-internals*'})",
    "if($p.Count -ne 1){exit 2}",
    "$l=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object {$_.OwningProcess -eq $p[0].ProcessId -and $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -notin @(32649,32650,9230)})",
    "if($l.Count -ne 1){exit 3}",
    "Write-Output $l[0].LocalPort",
  ].join(';');
}

export class HostClientError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'HostClientError';
    this.code = code;
  }
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/u, '')}${path}`;
}

/** Incremental SSE frame parser (CRLF tolerant, multi-line data, comments). */
export class SseParser {
  constructor() {
    this.buffer = '';
  }

  /**
   * Feed a text chunk; returns complete frames.
   * A frame is {event?: string, data?: string, comments: string[]}.
   */
  push(chunk) {
    if (typeof chunk !== 'string' || !chunk) return [];
    this.buffer += chunk;
    const frames = [];
    for (;;) {
      const match = /\r?\n\r?\n/u.exec(this.buffer);
      if (!match) break;
      const raw = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** Trailing content that never got its blank-line terminator. */
  flush() {
    const raw = this.buffer;
    this.buffer = '';
    const frame = parseFrame(raw);
    return frame ? [frame] : [];
  }
}

export function parseFrame(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const frame = { comments: [], event: undefined, data: undefined };
  const dataLines = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (!line) continue;
    if (line.startsWith(':')) {
      frame.comments.push(line.slice(1).trim());
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') frame.event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length) frame.data = dataLines.join('\n');
  if (frame.event === undefined && frame.data === undefined) {
    return frame.comments.length ? { comments: frame.comments } : null;
  }
  return frame;
}

/**
 * Classify one SSE frame into a bridge action.
 *  - message: an inbound message row from the Host's own verified feed
 *  - ack: a Host-verified delivery/read receipt (reply plans only for now)
 *  - ignore: baseline previews, unknown named events, comments
 */
export function classifySseFrame(frame) {
  if (!frame || typeof frame !== 'object') return { kind: 'ignore', reason: 'FRAME_INVALID' };
  if (frame.data === undefined) return { kind: 'ignore', reason: 'COMMENT_OR_HEARTBEAT' };
  let payload;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return { kind: 'ignore', reason: 'SSE_DATA_NOT_JSON' };
  }
  // Original DSH-IM emits external sends as a NAMED event.
  // Never treat them as inbound or resend them to the platform.
  if (frame.event === 'whatsapp-external-outgoing') {
    const e=payload;
    if(e?.channel!=='WhatsApp'||e?.source!=='ORIGINAL_DSH_IM_ATOMIC_INBOX'||
      e?.direction!=='OUTBOUND'||!isAccountRef(e?.accountRef)||
      !isAccountRef(e?.roomRef)||typeof e?.mid!=='string'||
      !e.mid||e.mid.length>180||!Number.isFinite(e?.timestamp)||
      e.timestamp<Date.now()-15*60_000||e.timestamp>Date.now()+300000)
      return {kind:'ignore',reason:'UNVERIFIED_WA_EXTERNAL_OUTGOING'};
    return {kind:'message',row:e};
  }  if (frame.event === 'whatsapp-peer-presence') {
    const e=payload;
    if(e?.channel!=='WhatsApp'||e?.source!=='ORIGINAL_BAILEYS_PRESENCE'||
       !isAccountRef(e?.accountRef)||!isAccountRef(e?.roomRef)||
       !['on','off'].includes(e?.status)||
       !Number.isFinite(e?.observedAt))
      return {kind:'ignore',reason:'WA_PRESENCE_SOURCE_INVALID'};
    return {kind:'presence',presence:e};
  }
  if (frame.event === 'personal-preview') return { kind: 'ignore', reason: 'PERSONAL_BASELINE_PREVIEW' };
  if (frame.event === 'delivery-ack') {
    return {
      kind: 'ack',
      ack: {
        channel: 'WhatsApp',
        accountRef: payload?.accountRef,
        roomRef: payload?.roomRef,
        mid: payload?.mid,
        ackKind: payload?.ackKind,
        providerAccepted: payload?.providerAccepted === true,
        providerDelivered: payload?.providerDelivered === true,
        providerRead: payload?.providerRead === true,
        observedAt: Number.isFinite(payload?.observedAt) ? payload.observedAt : null,
      },
    };
  }
  if (frame.event === 'personal-read-ack') {
    return {
      kind: 'ack',
      ack: {
        channel: 'Personal',
        accountRef: payload?.accountRef,
        roomRef: payload?.roomRef,
        mid: payload?.mid,
        ackKind: payload?.ackKind,
        providerAccepted: payload?.providerAccepted === true,
        providerDelivered: payload?.providerDelivered === true,
        providerRead: payload?.providerRead === true,
        observedAt: Number.isFinite(payload?.observedAt) ? payload.observedAt : null,
      },
    };
  }
  if (frame.event === 'page-external-outgoing') {
    if (payload?.channel !== 'Page' || payload?.direction !== 'OUTBOUND' ||
        payload?.source !== 'SENDPULSE_OFFICIAL_REST_API_VERIFIED')
      return { kind: 'ignore', reason: 'PAGE_OUTGOING_NOT_PROVIDER_VERIFIED' };
    return {kind:'externalPageOutgoing',row:payload};
  }
  if (frame.event) return { kind: 'ignore', reason: 'UNKNOWN_NAMED_EVENT', event: frame.event };
  if (payload?.kind === 'preview') return { kind: 'ignore', reason: 'PERSONAL_PREVIEW_ROW' };
  if (payload?.kind !== undefined && payload.kind !== 'live') {
    return { kind: 'ignore', reason: 'UNKNOWN_ROW_KIND' };
  }
  if (payload?.direction !== 'INBOUND') return { kind: 'ignore', reason: 'NOT_INBOUND' };
  return { kind: 'message', row: payload };
}

/** Normalise a raw roster payload into the bridge's minimal read projection. */
export function normalizeRoster(payload) {
  const roster = payload?.roster ?? payload;
  if (!roster || typeof roster !== 'object' || !Array.isArray(roster.accounts)) {
    throw new HostClientError('ROSTER_SHAPE_INVALID');
  }
  let whatsappOrdinal = 0;
  const accounts = roster.accounts.map((account) => {
    if (!isAccountRef(account?.accountRef)) throw new HostClientError('ROSTER_ACCOUNT_REF_INVALID');
    if (!['Personal', 'Page', 'WhatsApp'].includes(account?.channel)) {
      throw new HostClientError('ROSTER_CHANNEL_INVALID');
    }
    const channel = account.channel;
    const ordinal = channel === 'WhatsApp' ? ++whatsappOrdinal : null;
    const rooms = (Array.isArray(account.rooms) ? account.rooms : []).filter((room) => isAccountRef(room?.roomRef));
    return {
      channel,
      accountRef: account.accountRef,
      // Page identity is sourced from the original verified commercial SDK.
      // This is display-only; never use a label as a routing key.
      accountLabel: typeof account.accountLabel === 'string' ? account.accountLabel.slice(0, 128) : null,
      whatsappOrdinal: ordinal,
      roomCount: rooms.length,
      rooms: rooms.map((room) => ({
        roomRef: room.roomRef,
        // Contact display data is needed to name a newly created Chatwoot
        // contact; it is held in memory only and never logged.
        name: typeof room.name === 'string' && room.name.trim() ? room.name.trim().slice(0, 260) : null,
        nameKnown: room.nameKnown === true,
        // Preserve only a verified native E.164 WhatsApp phone. The peer's
        // opaque LID, display name and synthetic identifiers are NOT phones.
        ...(channel === 'WhatsApp' && typeof room.phoneFallback === 'string' &&
          /^\+[1-9][0-9]{6,14}$/u.test(room.phoneFallback)
          ? {phoneFallback: room.phoneFallback} : {}),
        lastMessageAt: Number.isFinite(room.lastMessageAt) ? room.lastMessageAt : null,
        messageCount: Number.isSafeInteger(room.messageCount) ? room.messageCount : 0,
      })),
    };
  });
  return {
    readOnly: true,
    partial: roster.partial === true,
    failures: Array.isArray(roster.failures) ? roster.failures.map(String) : [],
    accounts,
    totalRooms: accounts.reduce((sum, account) => sum + account.rooms.length, 0),
  };
}

export class HostClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl
   * @param {typeof fetch} [options.fetchImpl]
   * @param {number} [options.timeoutMs]
   */
  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 20000, resolveHostBaseUrl = null } = {}) {
    if (typeof baseUrl !== 'string' || !baseUrl) throw new HostClientError('HOST_BASE_URL_INVALID');
    if (typeof fetchImpl !== 'function') throw new HostClientError('FETCH_IMPL_MISSING');
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    // One ephemeral scope-bound Page read from the ORIGINAL authorized Host.
    // Reuse within the same contact-open transaction to avoid a second
    // provider request/429. No disk cache, second roster, or authority.
    this.lastVerifiedPageRoom = null;
    this.hostPortRefresh = null;
    // Optional friend-only discovery of this same original DSH Host after
    // restart; official owner Bridge keeps its existing port resolver.
    this.resolveHostBaseUrl = typeof resolveHostBaseUrl === 'function' ? resolveHostBaseUrl : null;
    this.verifiedSendPulsePage = null;
  }

  /** The already-authorized official SendPulse Page is the current provider.
   * Add a verified, read-only source projection; never authorize sending. */
  adoptVerifiedPageProvider({reader,binding,accountRef,rooms}={}) {
    if(!reader||typeof reader.readMessages!=='function'||
       binding?.verifiedBy!=='SENDPULSE_OFFICIAL_REST_API'||
       !isAccountRef(accountRef)||!(rooms instanceof Map)||rooms.size<1||
       rooms.size>300)throw new HostClientError('SENDPULSE_REGISTRY_SCOPE_INVALID');
    this.verifiedSendPulsePage={reader,binding,accountRef,rooms};
  }

  // Same native DSH Desktop owner that the original start-bridge.ps1 already
  // verifies. Resolve ONLY after a network disconnect (not on every contact
  // open, no second Host, no recurring discovery/polling).
  async #recoverCurrentDshHost() {
    if (process.platform !== 'win32') return false;
    if (this.hostPortRefresh) return this.hostPortRefresh;
    const script = officialHostRecoveryPowerShell();
    this.hostPortRefresh = (async () => {
      if(this.resolveHostBaseUrl){
        try {
          const candidate=await this.resolveHostBaseUrl();
          const parsed=new URL(candidate);
          if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||
             !/^[0-9]{4,5}$/.test(parsed.port)||parsed.pathname!=='/' ||
             !parsed.port||parsed.search||parsed.hash)return false;
          if(candidate===this.baseUrl)return false;
          this.baseUrl=candidate;return true;
        }catch{return false}
      }
      try {
        const { stdout } = await execFileAsync('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 11000, windowsHide: true, maxBuffer: 1024 });
        const port = stdout.trim();
        if (!/^\d{4,5}$/u.test(port) || Number(port) > 65535) return false;
        const baseUrl = 'http://127.0.0.1:' + port;
        if (baseUrl === this.baseUrl) return false;
        this.baseUrl = baseUrl;
        return true;
      } catch {
        return false;
      }
    })().finally(() => { this.hostPortRefresh = null; });
    return this.hostPortRefresh;
  }

  async #getJson(path) {
    const request = () => this.fetchImpl(joinUrl(this.baseUrl, path), {
      method: 'GET', redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    let response;
    try {
      response = await request();
    } catch (firstError) {
      if (firstError?.name === 'AbortError' || firstError?.name === 'TimeoutError' ||
          !(await this.#recoverCurrentDshHost())) {
        throw new HostClientError(firstError?.name === 'TimeoutError' ? EMPTY_TIMEOUT : 'HOST_NETWORK_ERROR', path);
      }
      try {
        response = await request();
      } catch (error) {
        throw new HostClientError(error?.name === 'TimeoutError' ? EMPTY_TIMEOUT : 'HOST_NETWORK_ERROR', path);
      }
    }
    if (!response.ok) throw new HostClientError(`HOST_HTTP_${response.status}`, path);
    try {
      return await response.json();
    } catch {
      throw new HostClientError('HOST_RESPONSE_NOT_JSON', path);
    }
  }

  /** Native Page/Personal contact portrait: original DSH owner-verifies the
   * exact account+room binding and reads only a trusted, bounded image. */
  async readFacebookContactAvatar({accountRef,roomRef}) {
    if(!isAccountRef(accountRef)||!isAccountRef(roomRef))
      throw new HostClientError('CONTACT_AVATAR_SCOPE_INVALID');
    if(this.verifiedSendPulsePage?.accountRef===accountRef &&
       this.verifiedSendPulsePage.rooms.has(roomRef))return null;
    const request = () => this.fetchImpl(joinUrl(this.baseUrl,
      '/api/yenra/facebook-avatar?'+new URLSearchParams({accountRef,roomRef})),{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(12000)
      });
    let response;
    try { response=await request(); }
    catch {
      if(!(await this.#recoverCurrentDshHost()))return null;
      try { response=await request(); } catch {return null;}
    }
    if(response.status===204)return null;
    // 503 means the ORIGINAL authorized Pancake SDK failed, not "this
    // contact has no photo". Keep its cause visible to the existing
    // Page-avatar sync error logger; do not invent a placeholder or retry
    // by calling an unverified provider.
    if(!response.ok)throw new HostClientError('CONTACT_AVATAR_HOST_HTTP_'+response.status);
    const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
    if(!['image/jpeg','image/png','image/webp'].includes(mime))return null;
    const advertised=Number(response.headers.get('content-length')||0);
    if(advertised>1_500_000)return null;
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<100||bytes.length>1_500_000)return null;
    return {mime,bytes};
  }

  /** Read only the Host's already-authorized media route. Never follow provider URLs. */
  async readMedia({ channel, accountRef, roomRef, mid }) {
    if (!isAccountRef(accountRef) || !isAccountRef(roomRef)) throw new HostClientError('MEDIA_SCOPE_INVALID');
    if (typeof mid !== 'string' || !mid || mid.length > 180 || /[\x00-\x20\x7f]/u.test(mid)) throw new HostClientError('MID_INVALID');
    if (!['Personal', 'WhatsApp', 'Page'].includes(channel)) throw new HostClientError('MEDIA_CHANNEL_UNSUPPORTED');
    if (channel === 'Personal' && (!mid.startsWith('$') || mid.length < 5)) throw new HostClientError('MID_INVALID');
    if (channel === 'Page') {
      // The original authenticated Page Host already verified account, room,
      // sender and MID, and exposes bounded HTTPS media references. Never
      // accept a CDN URL from an incoming Webhook or from the caller.
      if (!mid.startsWith('pancake:')) throw new HostClientError('PAGE_MID_INVALID');
      const recent = this.lastVerifiedPageRoom;
      const record = recent && recent.accountRef === accountRef &&
        recent.roomRef === roomRef && recent.expiresAt > Date.now()
        ? recent.record : await this.readRoom({ channel, accountRef, roomRef });
      if (record?.historicalOnly === true || record?.source !== 'YENRA_FB_OFFICIAL') {
        throw new HostClientError('PAGE_MEDIA_NOT_PROVIDER_VERIFIED');
      }
      const matches = (Array.isArray(record.messages) ? record.messages : []).filter(
        (message) => message?.mid === mid && ['INBOUND', 'OUTBOUND'].includes(message?.direction),
      );
      if (matches.length !== 1) throw new HostClientError('PAGE_MEDIA_MID_NOT_UNIQUE');
      const attached = Array.isArray(matches[0].media) ? matches[0].media : [];
      if (attached.length !== 1) throw new HostClientError('PAGE_MEDIA_SINGLE_ATTACHMENT_REQUIRED');
      const mediaRef = attached[0];
      if (!['image', 'video', 'audio', 'file', 'sticker'].includes(mediaRef?.type)) {
        throw new HostClientError('PAGE_MEDIA_TYPE_INVALID');
      }
      let url;
      try { url = new URL(mediaRef.url); } catch { throw new HostClientError('PAGE_MEDIA_URL_INVALID'); }
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !(host === 'content.pancake.vn' || host === 'cdn.fbsbx.com' ||
            host === 'fbcdn.net' || host.endsWith('.fbcdn.net'))) {
        throw new HostClientError('PAGE_MEDIA_URL_NOT_TRUSTED');
      }
      // Signed URL is returned by the existing owner-authenticated SDK.
      // No cookies, redirects, second login or raw URL in logs/errors.
      let response;
      try {
        response = await this.fetchImpl(url.href, {
          method: 'GET', redirect: 'error', headers: { accept: '*/*' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch { throw new HostClientError('PAGE_MEDIA_NETWORK_ERROR'); }
      return readMediaResponse(response);
    }
    const query = new URLSearchParams({ accountRef, roomRef, mid });
    const path = channel === 'Personal' ? '/api/yenra/facebook-media?' : '/api/yenra/social-read?mode=media&';
    let response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl, path + query), {
        method: 'GET', redirect: 'error', headers: { accept: '*/*' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { throw new HostClientError('HOST_MEDIA_NETWORK_ERROR'); }
    return readMediaResponse(response);
  }

  /** GET /api/yenra/oss-roster (cached snapshot by default). */
  /** Existing DSH-IM own-account identity; never a contact/profile guess. */
  async readOwnWhatsAppProfile(accountRef) {
    if (!isAccountRef(accountRef)) throw new HostClientError('ACCOUNT_PROFILE_SCOPE_INVALID');
    const result = await this.#getJson(`/api/yenra/social-read?accountRef=${accountRef}&mode=profile`);
    if (result?.ok !== true || result.accountRef !== accountRef) throw new HostClientError('ACCOUNT_PROFILE_NOT_VERIFIED');
    return {
      displayName: typeof result.displayName === 'string' ? result.displayName.trim().slice(0, 75) : null,
      ownPhone: typeof result.ownPhone === 'string' && /^\+[1-9][0-9]{4,14}$/u.test(result.ownPhone) ? result.ownPhone : null,
    };
  }

  /** Bytes from the original authorized Socket, never a new WhatsApp login. */
  async readOwnWhatsAppAvatar(accountRef) {
    if (!isAccountRef(accountRef)) throw new HostClientError('ACCOUNT_AVATAR_SCOPE_INVALID');
    let response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl,
        `/api/yenra/social-read?accountRef=${accountRef}&mode=account-avatar`), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      });
    } catch { return null; }
    if (response.status === 204) return null;
    if (!response.ok) return null;
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return null;
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 2_000_000) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 10 || bytes.length > 2_000_000) return null;
    return { bytes, mime };
  }

  /** Only after native Chatwoot selection verification: request the
   * original Baileys Socket's single peer presence subscription.
   * Not a message send and never a blanket contact roster subscription.
   */
  async subscribeSelectedWhatsAppPresence({accountRef,roomRef}) {
    if(!isAccountRef(accountRef)||!isAccountRef(roomRef))
      throw new HostClientError('ORIGINAL_WA_PRESENCE_SCOPE_INVALID');
    let response;
    try {
      response=await this.fetchImpl(joinUrl(this.baseUrl,
        '/api/yenra/social-presence-subscribe'),{
        method:'POST',redirect:'error',
        headers:{'content-type':'application/json',
          'x-yenra-verified-chatwoot-room':'1'},
        body:JSON.stringify({accountRef,roomRef}),
        signal:AbortSignal.timeout(4200),
      });
    }catch {throw new HostClientError('ORIGINAL_WA_PRESENCE_SUBSCRIBE_TIMEOUT');}
    if(!response.ok)return false;
    return (await response.json().catch(()=>null))?.ok===true;
  }

  /** Existing authenticated DSH-IM peer avatar, account+room scoped.
   * Bytes only; do not expose provider CDN URLs to Chatwoot or the browser.
   */
  async readVerifiedWhatsAppContactAvatar({accountRef,roomRef}) {
    if (!isAccountRef(accountRef) || !isAccountRef(roomRef))
      throw new HostClientError('WHATSAPP_AVATAR_SCOPE_INVALID');
    let response;
    try {
      const query=new URLSearchParams({mode:'avatar',accountRef,roomRef});
      response=await this.fetchImpl(joinUrl(this.baseUrl,
        '/api/yenra/social-read?'+query.toString()),{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(9000),
      });
    }catch{throw new HostClientError('WHATSAPP_AVATAR_READ_UNAVAILABLE');}
    if(response.status===204)return null;
    if(!response.ok)throw new HostClientError('WHATSAPP_AVATAR_HTTP_'+response.status);
    const mime=(response.headers.get('content-type')??'').split(';')[0].toLowerCase();
    if(!['image/jpeg','image/png','image/webp'].includes(mime))
      throw new HostClientError('WHATSAPP_AVATAR_MIME_INVALID');
    const len=Number(response.headers.get('content-length')??0);
    if(len>1_500_000)throw new HostClientError('WHATSAPP_AVATAR_TOO_LARGE');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<100||bytes.length>1_500_000)
      throw new HostClientError('WHATSAPP_AVATAR_SIZE_INVALID');
    return {mime,bytes};
  }

  async readRoster({ refresh = false, whatsappOnly = false, verifiedW25 = false } = {}) {
    const query = verifiedW25 ? '?verifiedW25=1' : whatsappOnly ? '?refresh=wa' : refresh ? '?refresh=1' : '';
    const payload = await this.#getJson(`/api/yenra/oss-roster${query}`);
    if (payload?.ok !== true) throw new HostClientError('HOST_ROSTER_NOT_OK');
    return normalizeRoster(payload);
  }

  /**
   * Read one verified room.
   * WhatsApp: GET /api/yenra/social-read?mode=room&accountRef&roomRef
   *           -> {ok:true, text:"YENRA_SOCIAL_V1:"+json}
   * Personal/Page: GET /api/yenra/facebook-room?accountRef&roomRef
   *           -> {ok:true, text:"YENRA_FACEBOOK_V1:"+json}
   */
  async readRoom({ accountRef, roomRef, channel }) {
    if (!isAccountRef(accountRef) || !isAccountRef(roomRef)) throw new HostClientError('ROOM_SCOPE_INVALID');
    const sendPulse=this.verifiedSendPulsePage;
    if(channel==='Page' && sendPulse?.accountRef===accountRef && sendPulse.rooms.has(roomRef)) {
      return readVerifiedSendPulsePageRoom({reader:sendPulse.reader,binding:sendPulse.binding,
        room:sendPulse.rooms.get(roomRef),accountRef,roomRef});
    }
    const prefix = channel === 'WhatsApp' ? 'YENRA_SOCIAL_V1:' : 'YENRA_FACEBOOK_V1:';
    const path =
      channel === 'WhatsApp'
        ? `/api/yenra/social-read?mode=room&accountRef=${accountRef}&roomRef=${roomRef}`
        : `/api/yenra/facebook-room?accountRef=${accountRef}&roomRef=${roomRef}`;
    const payload = await this.#getJson(path);
    if (payload?.ok !== true || typeof payload.text !== 'string' || !payload.text.startsWith(prefix)) {
      throw new HostClientError('HOST_ROOM_ENVELOPE_INVALID');
    }
    let record;
    try {
      record = JSON.parse(payload.text.slice(prefix.length));
    } catch {
      throw new HostClientError('HOST_ROOM_PAYLOAD_NOT_JSON');
    }
    if (record?.accountRef !== accountRef || record?.roomRef !== roomRef) {
      throw new HostClientError('HOST_ROOM_SCOPE_MISMATCH');
    }
    if (channel === 'Page' && record.source === 'YENRA_FB_OFFICIAL' &&
        record.historicalOnly !== true && Array.isArray(record.messages)) {
      this.lastVerifiedPageRoom = { accountRef, roomRef, record, expiresAt:Date.now()+20000 };
    }
    return record;
  }

  /**
   * Subscribe to the Host's own single SSE feed (GET /api/yenra/social-events).
   * Returns a handle with close(). Reconnects with bounded backoff, because the
   * Host may be restarted; it is still the same single event source.
   */
  openEventStream({ onFrame, onError = () => {}, signal, retryBaseMs = 1000, retryMaxMs = 30000 } = {}) {
    if (typeof onFrame !== 'function') throw new HostClientError('SSE_HANDLER_MISSING');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    let closed = false;
    const run = async () => {
      let attempt = 0;
      while (!closed && !controller.signal.aborted) {
        try {
          const response = await this.fetchImpl(joinUrl(this.baseUrl, '/api/yenra/social-events'), {
            method: 'GET',
            redirect: 'error',
            headers: { accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new HostClientError(`HOST_SSE_HTTP_${response.status}`);
          attempt = 0;
          const parser = new SseParser();
          const decoder = new TextDecoder();
          for await (const chunk of response.body) {
            if (closed) return;
            for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
              try {
                onFrame(frame);
              } catch (error) {
                onError(error);
              }
            }
          }
          if (closed) return;
          throw new HostClientError('HOST_SSE_ENDED');
        } catch (error) {
          if (closed || controller.signal.aborted) return;
          attempt += 1;
          onError(error);
          // The formal Electron webServer port changes after a desktop restart.
          // Resolve only when the old SSE socket ended or disconnected;
          // the same authorized DSH Host stays the sole event authority.
          if (await this.#recoverCurrentDshHost()) attempt = 0;
          const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(attempt, 5));
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, delay);
            timer.unref?.();
          });
        }
      }
    };
    void run();
    return {
      close() {
        closed = true;
        controller.abort();
        if (signal) signal.removeEventListener?.('abort', abort);
      },
      get closed() {
        return closed;
      },
    };
  }
}
