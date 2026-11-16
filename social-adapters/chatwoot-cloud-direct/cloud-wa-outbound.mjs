/**
 * Thin Chatwoot Cloud API-channel -> EXISTING DSH Host Sender adapter.
 * No new sender, login, chat store or background listener.
 * The local claim files hold ONLY a Cloud message id and a no-retry marker,
 * not message text, history, contacts, credentials or a second chat database.
 * Cloud remains the message authority. UNKNOWN never auto-resends.
 */
import {createHash} from 'node:crypto';
import {mkdir,open,appendFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
import {MAX_TEXT} from '../chatwoot-bridge/src/contract.mjs';
import {verifyCloudApiChannelCallback} from './cloud-api-channel-callback.mjs';
import {snapshotOriginalWhatsAppOutbox,recoverSubmittedOriginalWhatsAppMid}
 from './cloud-wa-original-mid-recovery.mjs';

const NUM=x=>Number.isSafeInteger(x)&&x>0;
function extractMessageList(payload){
 const rows=Array.isArray(payload)?payload:
  Array.isArray(payload?.payload)?payload.payload:
  Array.isArray(payload?.payload?.messages)?payload.payload.messages:null;
 if(!rows)throw Error('CLOUD_WA_MESSAGE_LIST_SHAPE_INVALID');
 return rows;
}
function checkRemoteMessage({event,message,selection,now,activatedAt}){
 if(!message||message.id!==event.messageId)throw Error('CLOUD_WA_MESSAGE_NOT_FOUND');
 if(Number(message.conversation_id)!==event.conversationId||
    Number(message.inbox_id)!==selection.cloudInboxId||
    ![1,'outgoing'].includes(message.message_type)||
    message.private===true||message.source_id||
    !NUM(Number(message.sender?.id))||
    typeof message.content!=='string'||!message.content.trim()||
    message.content.length>MAX_TEXT||message.content!==event.content||
    (message.attachments??[]).length>0||
    ![0,'text',null,undefined].includes(message.content_type))
   throw Error('CLOUD_WA_OUTBOUND_NOT_VERIFIED');
 // Cloud history projection is display-only, never a new platform send.
 // Keep this protection even if a provider normalizes source_id away.
 let attributes=message.content_attributes;
 if(typeof attributes==='string'){try{attributes=JSON.parse(attributes)}catch{attributes=null}}
 if(attributes?.yenra_history_import===true||attributes?.yenra_history_import==='true'||
    typeof attributes?.yenra_original_platform_mid==='string')
   throw Error('CLOUD_WA_VERIFIED_HISTORY_NEVER_SEND');
 const t=typeof message.created_at==='number'
  ?message.created_at*1000:Date.parse(String(message.created_at));
 if(!Number.isFinite(t)||Math.abs(now-t)>15*60_000)
   throw Error('CLOUD_WA_OUTBOUND_EVENT_NOT_FRESH');
 // A newly activated Cloud Sender must NOT transmit messages created while
 // the channel was marked as not connected, even if a webhook gets retried.
 if(t<activatedAt)throw Error('CLOUD_WA_PRE_ACTIVATION_OUTBOUND_REFUSED');
 return message.content;
}
// Existing claims must never be mistaken for platform success.
async function readClaimReplayResult(path,{inboxId,conversationId,messageId,text}={}){
 try{
  const raw=await readFile(path,'utf8');
  if(!raw||raw.length>4096)return 'unknown-no-retry';
  const lines=raw.trim().split('\n');
  const first=JSON.parse(lines[0]);
  const last=JSON.parse(lines.at(-1));
  // Legacy claims sometimes contain only platformMidPresent:true, with no
  // provider MID hash. Such claims cannot prove the exact platform message
  // to the native ACK handler; never let replay return HTTP 200 for them.
  if(first?.v!==1||first.account!==196799||first.inbox!==inboxId||
     first.conversationId!==conversationId||first.messageId!==messageId||
     first.state!=='CLAIMED_BEFORE_SEND'||
     first.contentSha256!==createHash('sha256').update(text).digest('hex'))
   return 'unknown-no-retry';
  if(last?.state==='SUBMITTED_UNCONFIRMED'&&last.platformMidPresent===true&&
     typeof last.providerMidSha256==='string'&&/^[a-f0-9]{64}$/.test(last.providerMidSha256))
   return 'already-claimed';
  // The ORIGINAL single-Socket Sender can confirm transport submission before
  // returning its provider MID. This is not provider delivery/READ; keep the
  // immutable once-only claim, but do not turn a genuine submission into 503.
  if(last?.state==='TRANSPORT_SUBMITTED_MID_PENDING'&&
     last.transportAccepted===true&&last.platformMidPresent===false&&
     last.providerMidSha256===undefined)
   return 'submitted-mid-pending';
 }catch{}
 return 'unknown-no-retry';
}
// Authorize the actual Cloud sender in BOTH the paid account and this inbox.
// Fixed user IDs are not a valid authorization model for a two-seat account.
// The signed callback and exact Cloud message still gate the single native Sender.
function verifiedMemberIds(payload,reason){
 const list=Array.isArray(payload)?payload:
   Array.isArray(payload?.payload)?payload.payload:null;
 if(!list||!list.length||list.length>100)throw Error(reason);
 const ids=list.map(row=>Number(row?.id??row?.user_id));
 if(ids.some(id=>!NUM(id))||new Set(ids).size!==ids.length)
   throw Error(reason);
 return new Set(ids);
}
async function verifyCloudSenderSeat({cloud,senderId,inboxId}){
 const id=Number(senderId);
 if(!NUM(id)||cloud?.accountId!==196799||
    cloud?.apiBase!=='/api/v1/accounts/196799')
   throw Error('CLOUD_WA_OUTBOUND_AGENT_SCOPE_INVALID');
 const [agents,members]=await Promise.all([
   cloud.request('GET',cloud.apiBase+'/agents'),
   cloud.request('GET',cloud.apiBase+'/inbox_members/'+inboxId),
 ]);
 if(!verifiedMemberIds(agents,'CLOUD_WA_ACCOUNT_AGENTS_UNVERIFIED').has(id)||
    !verifiedMemberIds(members,'CLOUD_WA_INBOX_MEMBERS_UNVERIFIED').has(id))
   throw Error('CLOUD_WA_OUTBOUND_AGENT_NOT_MEMBER');
}
export function createCloudWaOutbound({
 cloud,hostSender,host=null,index,scopes,logger,claimDirectory,
 verify=verifyCloudApiChannelCallback,now=Date.now,activatedAt=Date.now(),
 allowedInboxIds=new Set([155901,155902])
}={}){
 if(!(allowedInboxIds instanceof Set)||allowedInboxIds.size===0||
    allowedInboxIds.size>6||
    [...allowedInboxIds].some(id=>!NUM(id)||id===155865))
   throw Error('CLOUD_API_SENDER_ALLOWED_INBOX_SCOPE_INVALID');
 if(!cloud?.request||!hostSender?.send||!index?.byIdentifier?.get||
    !Array.isArray(scopes)||!logger?.warn||
    typeof claimDirectory!=='string'||!claimDirectory||!/^([a-zA-Z]:[\\/]|\\\\)/u.test(claimDirectory))
   throw Error('CLOUD_WA_OUTBOUND_DEPENDENCIES_REQUIRED');
 const stats={verified:0,submitted:0,midPending:0,midRecovered:0,duplicate:0,refused:0,unknown:0};
 const pending=new Map(),roomFlights=new Map();
 async function process({rawBody,headers}={}){
  const result=await verify({rawBody,headers,permitVerifiedOutbound:true,allowedInboxIds});
  if(result.kind==='ignore')return {kind:'ignored'};
  if(result.kind!=='verified-outgoing'||
     !(allowedInboxIds instanceof Set)||!allowedInboxIds.has(result.inbox)||result.inbox===155865||
     !NUM(result.conversationId)||!NUM(result.messageId))
    throw Error('CLOUD_WA_OUTBOUND_UNVERIFIED_CALLBACK');
  const key=String(result.messageId);
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   // The URL, webhook ID and contact name are never authorization.
   const bound=await resolveCloudNativeConversation({
     cloud,index,scopes,conversationId:result.conversationId,apiInboxIds:allowedInboxIds});
   const expectedChannel=result.inbox===155900?'Personal':'WhatsApp';
   if(!bound.ok||bound.selection.channel!==expectedChannel||
      bound.selection.cloudInboxId!==result.inbox)
     throw Error('CLOUD_WA_OUTBOUND_IDENTITY_NOT_VERIFIED');
   const m0=await cloud.request('GET',
     cloud.apiBase+'/conversations/'+result.conversationId+'/messages');
   const matched=extractMessageList(m0).filter(m=>m.id===result.messageId);
   if(matched.length!==1)throw Error('CLOUD_WA_OUTBOUND_MESSAGE_NOT_UNIQUE');
   // Original WhatsApp history was already sent on its real platform.
   // Acknowledge the signed Cloud callback but NEVER send it again. This
   // also keeps the native historical bubble from incorrectly showing failed.
   const past=matched[0];
   let attrs=past.content_attributes;
   if(typeof attrs==='string'){try{attrs=JSON.parse(attrs)}catch{attrs=null}}
   if(past.source_id&&attrs?.yenra_history_import===true&&
      attrs?.yenra_original_platform_mid===past.source_id&&
      past.message_type===1&&past.private!==true){
     return {kind:'ignored-history',messageId:result.messageId};
   }
   const text=checkRemoteMessage({
      event:result,message:matched[0],selection:bound.selection,now:now(),activatedAt});
   await verifyCloudSenderSeat({cloud,senderId:matched[0].sender?.id,inboxId:result.inbox});
   stats.verified++;
   // Create an exclusive, durable marker BEFORE calling the only platform
   // Sender. Replays, process crashes and unknown network results never resend.
   const accountFolder=join(claimDirectory,'account-196799');
   await mkdir(accountFolder,{recursive:true});
   const claimPath=join(accountFolder,key+'.jsonl');
   let handle;
   try{handle=await open(claimPath,'wx',0o600)}
   catch(e){
    if(e?.code==='EEXIST'){
     stats.duplicate++;
     const kind=await readClaimReplayResult(claimPath,{
       inboxId:result.inbox,conversationId:result.conversationId,
       messageId:result.messageId,text,
     });
     return {kind,messageId:result.messageId};
    }
    throw e;
   }
   const fingerprint=createHash('sha256').update(text).digest('hex');
   try{
     await handle.writeFile(JSON.stringify({v:1,account:196799,inbox:result.inbox,
       conversationId:result.conversationId,messageId:result.messageId,
       contentSha256:fingerprint,state:'CLAIMED_BEFORE_SEND',at:now()})+'\n');
     await handle.sync();
   }finally{await handle.close()}
   // Concurrent Cloud callbacks for the same original room may carry the
   // same text. Serialize their pre/post-Socket snapshots so a second MID
   // can never be mistaken for this first once-only claim.
   const roomKey=bound.selection.accountRef+'|'+bound.selection.roomRef;
   const previous=roomFlights.get(roomKey);
   if(previous)await previous;
   let unlock;
   const roomHeld=new Promise(resolve=>{unlock=resolve});
   roomFlights.set(roomKey,roomHeld);
   try{
     const originalScope={channel:expectedChannel,
       accountRef:bound.selection.accountRef,roomRef:bound.selection.roomRef};
     const before=expectedChannel==='WhatsApp'
       ?await snapshotOriginalWhatsAppOutbox({host,scope:originalScope}):null;
     const sendStartedAt=now();
     const receipt=await hostSender.send({channel:expectedChannel,
       accountRef:bound.selection.accountRef,
       roomRef:bound.selection.roomRef,text});
     // This is NOT merely Cloud accepting a bubble: the one ORIGINAL DSH-IM
     // Sender must have independently acknowledged transport submission and
     // the native Host must have verified the exact account and room scope.
     if(receipt?.submitted!==true||receipt?.transportAccepted!==true||
        receipt.deliveryStatus!=='UNKNOWN'||receipt.delivered!==false||
        receipt.channel!==expectedChannel||
        receipt.accountRef!==bound.selection.accountRef||
        receipt.roomRef!==bound.selection.roomRef)
       throw Error('CLOUD_WA_ORIGINAL_TRANSPORT_RECEIPT_UNVERIFIED');
     let providerMid=receipt.providerMessageId;
     if(providerMid!=null&&(typeof providerMid!=='string'||!providerMid.trim()))
       throw Error('CLOUD_WA_ORIGINAL_PROVIDER_MID_INVALID');
     if(!providerMid&&before){
       // Strict same-room pre/post transport MID comparison. This is the
       // existing original Socket outbox, not a second Sender or a guess from
       // the Cloud message timestamp. Missing/ambiguous stays MID pending.
       providerMid=await recoverSubmittedOriginalWhatsAppMid({
         host,scope:originalScope,before,text,sendStartedAt,now});
       if(providerMid)stats.midRecovered++;
     }
     if(providerMid){
       await appendFile(claimPath,JSON.stringify({state:'SUBMITTED_UNCONFIRMED',
         platformMidPresent:true,
         providerMidSha256:createHash('sha256').update(providerMid).digest('hex'),
         at:now()})+'\n');
     }else{
       // The original Socket returned a verified submission without its MID.
       // Cloud should NOT display a retryable failure for a real submission;
       // keep MID/ACK pending, and never infer delivery or re-send.
       await appendFile(claimPath,JSON.stringify({state:'TRANSPORT_SUBMITTED_MID_PENDING',
         transportAccepted:true,platformMidPresent:false,at:now()})+'\n');
       stats.midPending++;
     }
     stats.submitted++;
     return{kind:providerMid?'submitted-unconfirmed':'submitted-mid-pending',
       messageId:result.messageId,providerMidPresent:Boolean(providerMid),delivered:false};
   }catch(error){
     stats.unknown++;
     await appendFile(claimPath,JSON.stringify({state:'UNKNOWN_NO_RETRY',at:now()})+'\n').catch(()=>{});
     logger.warn('cloud.wa_outbound_unknown_no_retry',{code:String(error?.code??error?.message??'UNKNOWN').slice(0,64)});
     throw Error('CLOUD_WA_OUTBOUND_UNKNOWN_NO_RETRY');
   }finally{
     if(roomFlights.get(roomKey)===roomHeld)roomFlights.delete(roomKey);
     unlock();
   }
  })();
  pending.set(key,task);
  try{return await task}finally{pending.delete(key)}
 }
 return{process,stats};
}
