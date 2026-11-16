/** Read-only original Host / native Chatwoot message proof, no Sender.
 * The account/room MUST resolve from the one trusted original Host roster and
 * Chatwoot's own contact identifier, never the renderer supplied values.
 */
import { resolveConversationSelection } from './selection.mjs'

const REF=/^[a-f0-9]{32}$/
const MID=/^[^\x00-\x20\x7f]{1,180}$/
const int=n=>Number.isSafeInteger(n)&&n>0

export async function verifyVisibleTranslationMessage({
  chatwoot,index,expectedAccountId,request,
}={}){
  const {accountId,conversationId,inboxId,messageId,accountRef,roomRef,
    sourceId,text,channel}=request??{}
  if (![accountId,conversationId,inboxId,messageId].every(int) ||
      accountId!==expectedAccountId || !REF.test(accountRef??'') ||
      !REF.test(roomRef??'') || !MID.test(sourceId??'') ||
      typeof text!=='string' || !text.trim() || text.length>1200 ||
      !['Page','Personal','WhatsApp'].includes(channel))
    return {ok:false,code:'INVALID_TRANSLATION_PROOF'}
  const selection=await resolveConversationSelection({
    chatwoot,index,accountId,displayId:conversationId,
  })
  if(!selection.ok || selection.selection?.accountRef!==accountRef ||
      selection.selection?.roomRef!==roomRef ||
      selection.selection?.inboxId!==inboxId ||
      selection.selection?.channel!==channel)
    return {ok:false,code:'TRANSLATION_SCOPE_MISMATCH'}
  const rows=await chatwoot.listConversationMessages(conversationId)
  const found=rows.filter(m=>m?.id===messageId)
  if(found.length!==1)return {ok:false,code:'MESSAGE_NOT_IN_NATIVE_CHATWOOT_SCREEN'}
  const row=found[0]
  const originalMid=row.source_id??row.sourceId??row.content_attributes?.yenra_original_platform_mid
  // Both sides belong to the same signed-in owner conversation. Chatwoot
  // API Channel marks original Page/WA outbound echoes as 'outgoing'.
  // The exact original platform MID, body, account, inbox, conversation and
  // non-private identity checks below remain mandatory for either direction.
  if(!['incoming',0,'outgoing',1].includes(row.message_type??row.messageType) ||
      row.private===true || row.content!==text || originalMid!==sourceId ||
      (row.inbox_id!==undefined && row.inbox_id!==inboxId) ||
      (row.account_id!==undefined && row.account_id!==accountId))
    return {ok:false,code:'ORIGINAL_NATIVE_MESSAGE_NOT_VERIFIED'}
  return {ok:true,verified:true}
}
