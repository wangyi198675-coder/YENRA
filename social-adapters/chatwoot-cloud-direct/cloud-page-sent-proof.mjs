/** Existing Chatwoot Cloud readback + native DSH Page identity, no new Sender,
 * polling process or database. This is evidence for adopted-draft learning only.
 */
import {createHash} from 'node:crypto'
import {verifyCloudPageMemoryScope} from './cloud-page-memory-scope.mjs'
const good=n=>Number.isSafeInteger(n)&&n>0
export async function proveNativeCloudPageSent({
  cloud,scopes,index,readCloudExportPage,accountRef,roomRef,pageIdentityHash,
  conversationId,messageId,upgrade=false,now=Date.now()
}={}){
  if(!good(conversationId)||!good(messageId)||
     typeof upgrade!=='boolean'||typeof readCloudExportPage!=='function'||
     !/^[a-f0-9]{32}$/u.test(accountRef??'')||
     !/^[a-f0-9]{32}$/u.test(roomRef??'')||
     !/^[a-f0-9]{64}$/u.test(pageIdentityHash??''))
    return {ok:false,code:'PAGE_SEND_PROOF_INPUT_INVALID'}
  const record=await readCloudExportPage({accountId:196799,conversationId})
  if(record?.ok!==true||!good(record.inboxId)||
     record.contactId!==Number.parseInt(roomRef.slice(0,12),16))
    return {ok:false,code:'PAGE_SEND_PROOF_CONVERSATION_REJECTED'}
  if(!await verifyCloudPageMemoryScope({cloud,scopes,index,accountRef,roomRef,pageIdentityHash,
     expectedInboxId:record.inboxId}))
    return {ok:false,code:'PAGE_SEND_PROOF_SCOPE_REJECTED'}
  const candidates=record.rows?.filter(row=>row.id===messageId)??[]
  if(candidates.length!==1)return {ok:false,code:'PAGE_SEND_PROOF_MESSAGE_NOT_CURRENT'}
  const m=candidates[0]
  // Original Facebook Page sender returns Meta 'm_' MID after provider
  // acceptance. Chatwoot sent + a REAL Meta MID confirms provider handoff,
  // NOT recipient delivery or read; only delivered/read supports that claim.
  // A client-supplied or synthetic Cloud ID is never trusted, and imported
  // historical timestamps cannot be mistaken for a fresh send.
  if(m.message_type!==1||m.private===true||m.attachments?.length||
     typeof m.content!=='string'||!m.content.trim()||m.content.length>1800||
     typeof m.source_id!=='string'||
     !/^m_[A-Za-z0-9_-]{32,180}$/u.test(m.source_id)||
     !['sent','delivered','read'].includes(m.status)||
     (Number.isFinite(m.original_timestamp)&&m.original_timestamp>0)||
     !Number.isFinite(m.created_at)||
     Math.abs(now-m.created_at*1000)>(upgrade?14*24*60*60*1000:90*60*1000))
    return {ok:false,code:'PAGE_SEND_PROOF_NOT_PROVIDER_CONFIRMED'}
  return {ok:true,cloudAccountId:196799,cloudInboxId:record.inboxId,
    conversationId,messageId,text:m.content.trim(),
    occurredAtMs:m.created_at*1000,status:m.status,
    confirmationLevel:m.status==='sent'?'provider-accepted':'delivery-confirmed',
    providerMidHash:createHash('sha256').update(m.source_id).digest('hex')}
}
