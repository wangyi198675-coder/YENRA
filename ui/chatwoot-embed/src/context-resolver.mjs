import { createHash } from 'node:crypto'
export const CONTEXT_PATH = '/api/yenra/chatwoot-context/resolve'
export const RELAY_PATH = '/api/yenra/chatwoot-context/relay'
const positive = value => Number.isSafeInteger(value) && value > 0
const REF = /^[a-f0-9]{32}$/
export function parseContext(raw) {
  if (!raw || ![raw.accountId,raw.conversationId,raw.contactId,raw.inboxId].every(positive) ||
    typeof raw.identifier !== 'string' || !/^yenra-[a-f0-9]{40}$/.test(raw.identifier)) throw Error('INVALID_CONTEXT')
  return {accountId:raw.accountId,conversationId:raw.conversationId,contactId:raw.contactId,
    inboxId:raw.inboxId,identifier:raw.identifier}
}
export function stableIdentifier(accountRef,roomRef) {
  return 'yenra-'+createHash('sha256').update(accountRef+':'+roomRef).digest('hex').slice(0,40)
}
/** All supplied views are Host GET responses, never browser-provided records. */
export function resolveVerifiedContext(raw, { accountId, inboxMap, roster, conversation, contact }) {
  const value=parseContext(raw)
  const entries=Object.entries(inboxMap??{});if(!entries.length||entries.some(([ref,id])=>!REF.test(ref)||!positive(id))||new Set(entries.map(([,id])=>id)).size!==entries.length)
    throw Error('TRUSTED_INBOX_MAP_MISMATCH')
  if(value.accountId!==accountId)throw Error('ACCOUNT_MISMATCH')
  if(conversation?.id!==value.conversationId||conversation?.inbox_id!==value.inboxId||
    (conversation?.account_id!==undefined&&conversation.account_id!==accountId)||
    conversation?.meta?.sender?.id!==value.contactId||contact?.id!==value.contactId||
    contact?.identifier!==value.identifier)throw Error('CHATWOOT_CONTEXT_MISMATCH')
  if(!Array.isArray(contact.contact_inboxes)||!contact.contact_inboxes.some(binding=>
    (binding.inbox?.id??binding.inbox_id)===value.inboxId))throw Error('CONTACT_INBOX_MISMATCH')
  const matches=[]
  for(const account of roster?.accounts??[])for(const room of account.rooms??[]){
    if(REF.test(account.accountRef)&&REF.test(room.roomRef)&&
      stableIdentifier(account.accountRef,room.roomRef)===value.identifier)
      matches.push({accountRef:account.accountRef,roomRef:room.roomRef})
  }
  if(matches.length!==1)throw Error('ROSTER_SCOPE_NOT_UNIQUE')
  const selection=matches[0]
  if(inboxMap?.[selection.accountRef]!==value.inboxId)throw Error('TRUSTED_INBOX_MAP_MISMATCH')
  return selection
}
export function isLocalSameOrigin(request, origin) {
  const address=String(request.socket?.remoteAddress??'')
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))return false
  if(request.headers?.origin===origin && request.headers?.['sec-fetch-site']==='same-origin') return true
  // The official Electron dsh-app://app/ proxy strips Origin and Sec-Fetch-Site,
  // then attaches the Host-issued session cookie. It allows only requests from
  // its secured app scheme; require a deliberate custom header as an extra gate.
  return request.headers?.origin===undefined && request.headers?.['sec-fetch-site']===undefined &&
    request.headers?.['x-yenra-desktop-origin']==='dsh-app://app'
}
/** No provider reconnection. Reuses original cached roster GET; CW read-only API. */
export async function resolveFromHost(raw,{origin,chatwootOrigin,accountId,inboxMap,token,fetchImpl=fetch}){
  if(!raw||![raw.accountId,raw.conversationId].every(positive))throw Error('INVALID_CONTEXT')
  if(raw.accountId!==accountId)throw Error('ACCOUNT_MISMATCH')
  if(!token)throw Error('CHATWOOT_TOKEN_ENV_UNAVAILABLE')
  if(!Object.keys(inboxMap??{}).length)throw Error('TRUSTED_INBOX_MAP_UNCONFIGURED')
  const get=async(url,headers={})=>{
    const response=await fetchImpl(url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)})
    if(!response.ok)throw Error('HOST_READ_UNAVAILABLE')
    return response.json()
  }
  // Never append refresh/verifiedW25: cached original Storage Domain only.
  const rosterPayload=await get(`${origin}/api/yenra/oss-roster`)
  if(rosterPayload?.ok!==true)throw Error('ORIGINAL_ROSTER_UNAVAILABLE')
  const headers={api_access_token:token,accept:'application/json'}
  const base=`${chatwootOrigin}/api/v1/accounts/${accountId}`
  const conversationPayload=await get(`${base}/conversations/${raw.conversationId}`,headers)
  const conversation=conversationPayload.payload??conversationPayload
  const contactId=conversation?.meta?.sender?.id
  if(!positive(contactId))throw Error('CHATWOOT_CONTEXT_MISMATCH')
  const contactPayload=await get(`${base}/contacts/${contactId}`,headers)
  const contact=contactPayload.payload??contactPayload
  const context=parseContext({accountId,conversationId:raw.conversationId,contactId,
    inboxId:conversation.inbox_id,identifier:contact?.identifier})
  // Dashboard relay supplies additional hints; route-only reporter deliberately does not.
  for(const key of ['contactId','inboxId','identifier'])if(raw[key]!==undefined&&raw[key]!==context[key])
    throw Error('CHATWOOT_CONTEXT_MISMATCH')
  return resolveVerifiedContext(context,{accountId,inboxMap,roster:rosterPayload.roster,conversation,contact})
}

/**
 * Route-driven native conversation -> existing Bridge's Host-verifiable mapping.
 * DSH performs the same-origin owner check before calling this. The Bridge owns
 * the Chatwoot API credential and original account/room roster verification.
 * No new Sender, token copy or client-supplied accountRef/roomRef.
 */
export async function resolveFromBridge(raw,{accountId,bridgeOrigin,fetchImpl=fetch}={}) {
  if(!raw||![raw.accountId,raw.conversationId].every(positive))throw Error('INVALID_CONTEXT')
  if(raw.accountId!==accountId)throw Error('ACCOUNT_MISMATCH')
  if(typeof bridgeOrigin!=='string'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(bridgeOrigin))throw Error('BRIDGE_ORIGIN_INVALID')
  const url=new URL('/selection',bridgeOrigin)
  url.searchParams.set('accountId',String(accountId))
  url.searchParams.set('displayId',String(raw.conversationId))
  let payload
  try {
    const response=await fetchImpl(url.href,{method:'GET',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}})
    if(!response.ok)throw Error('BRIDGE_SELECTION_UNAVAILABLE')
    payload=await response.json()
  }catch{throw Error('BRIDGE_SELECTION_UNAVAILABLE')}
  const selection=payload?.selection
  if(payload?.ok!==true||!REF.test(selection?.accountRef??'')||!REF.test(selection?.roomRef??''))throw Error('BRIDGE_SCOPE_NOT_VERIFIED')
  return {accountRef:selection.accountRef,roomRef:selection.roomRef}
}

export const CLOUD_CONTEXT_PATH = '/api/yenra/cloud-context/resolve'
/**
 * DSH's authenticated same-origin Host is the only caller of the Bridge's
 * local Cloud/DSH identity resolver. Browser navigation is merely a hint.
 * Cloud credentials remain in the original local Bridge's DPAPI store.
 */
export async function resolveCloudContextFromBridge(raw,{bridgeOrigin,fetchImpl=fetch}={}){
  if(!raw||raw.accountId!==196799||!positive(raw.conversationId)||
      Object.keys(raw).sort().join(',')!=='accountId,conversationId')
    throw Error('CLOUD_SELECTION_INVALID')
  if(typeof bridgeOrigin!=='string'||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(bridgeOrigin))
    throw Error('BRIDGE_ORIGIN_INVALID')
  const response=await fetchImpl(new URL('/yenra-cloud/resolve',bridgeOrigin),{
    method:'POST',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(12000),
    headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-selection':'1'},
    body:JSON.stringify({accountId:196799,conversationId:raw.conversationId}),
  })
  if(!response.ok)throw Error('CLOUD_BRIDGE_SCOPE_UNAVAILABLE')
  const result=await response.json()
  const selection=result?.selection
  if(result?.ok!==true||selection?.cloudAccountId!==196799||
    selection?.cloudConversationId!==raw.conversationId)
    throw Error('CLOUD_BRIDGE_SCOPE_NOT_VERIFIED')
  if(selection.kind==='CLOUD_PAGE'){
    const shareLinks=selection.shareLinks??[]
    if(!Array.isArray(shareLinks)||shareLinks.length>20||
      !shareLinks.every(x=>positive(x?.messageId)&&typeof x?.url==='string'&&
        x.url.length<=450&&/^https:\/\/(?:www\.|m\.)?facebook\.com\//u.test(x.url)&&
        (x.photoId===undefined||typeof x.photoId==='string'&&/^\d{10,25}$/u.test(x.photoId))))
      throw Error('CLOUD_PAGE_SHARE_LINKS_INVALID')
    if(!positive(selection.cloudInboxId)||!positive(selection.cloudContactId)||
      !/^[a-f0-9]{64}$/.test(selection.pageIdentityHash??'')||
      !REF.test(selection.memoryAccountRef??'')||
      !REF.test(selection.memoryRoomRef??'')||
      typeof selection.contactName!=='string'||selection.contactName.length>110||
      !Array.isArray(selection.messages)||selection.messages.length>30||
      !selection.messages.every(m=>positive(m?.id)&&
        ['INBOUND','OUTBOUND'].includes(m?.direction)&&
        typeof m?.text==='string'&&m.text.length<=700&&
        Number.isFinite(m?.timestamp)))
      throw Error('CLOUD_PAGE_HISTORY_SCOPE_INVALID')
    return {kind:'CLOUD_PAGE',cloudAccountId:196799,
      cloudInboxId:selection.cloudInboxId,cloudContactId:selection.cloudContactId,
      cloudConversationId:raw.conversationId,
      pageIdentityHash:selection.pageIdentityHash,
      memoryAccountRef:selection.memoryAccountRef,memoryRoomRef:selection.memoryRoomRef,
      contactName:selection.contactName,messages:selection.messages,shareLinks}
  }
  // The remote WhatsApp Cloud conversation uses the same ORIGINAL Bridge and
  // Sender, never a newly connected WhatsApp socket or a synthesized local room.
  if(selection.kind==='CLOUD_WHATSAPP_REMOTE'||selection.kind==='CLOUD_PERSONAL_REMOTE'){
    const isPersonal=selection.kind==='CLOUD_PERSONAL_REMOTE'
    if(selection.channel!==(isPersonal?'Personal':'WhatsApp')||!positive(selection.cloudInboxId)||
      (isPersonal?selection.cloudInboxId!==155900:[155865,155900].includes(selection.cloudInboxId))||
      !positive(selection.cloudContactId)||
      !REF.test(selection.memoryAccountRef??'')||
      !REF.test(selection.memoryRoomRef??'')||
      !/^[a-f0-9]{64}$/.test(selection.cloudIdentityHash??'')||
      selection.accountRef!==undefined||selection.roomRef!==undefined||
      selection.sendVia!==(isPersonal?'CLOUD_ORIGINAL_PERSONAL_SENDER_ONLY':'CLOUD_ORIGINAL_FRIEND_SENDER_ONLY')||
      typeof selection.contactName!=='string'||selection.contactName.length>110||
      !Array.isArray(selection.messages)||selection.messages.length>30||
      !selection.messages.every(m=>positive(m?.id)&&
        ['INBOUND','OUTBOUND'].includes(m?.direction)&&
        typeof m?.text==='string'&&m.text.length<=700&&Number.isFinite(m?.timestamp)))
      throw Error('CLOUD_REMOTE_CHANNEL_SCOPE_NOT_VERIFIED')
    return {kind:selection.kind,channel:selection.channel,cloudAccountId:196799,
      cloudInboxId:selection.cloudInboxId,cloudContactId:selection.cloudContactId,
      cloudConversationId:raw.conversationId,
      cloudIdentityHash:selection.cloudIdentityHash,
      memoryAccountRef:selection.memoryAccountRef,memoryRoomRef:selection.memoryRoomRef,
      contactName:selection.contactName,messages:selection.messages,
      sendVia:isPersonal?'CLOUD_ORIGINAL_PERSONAL_SENDER_ONLY':'CLOUD_ORIGINAL_FRIEND_SENDER_ONLY'}
  }
  if(!REF.test(selection?.accountRef??'')||!REF.test(selection?.roomRef??''))
    throw Error('CLOUD_BRIDGE_SCOPE_NOT_VERIFIED')
  return {accountRef:selection.accountRef,roomRef:selection.roomRef,
    cloudAccountId:196799,cloudConversationId:raw.conversationId}
}
