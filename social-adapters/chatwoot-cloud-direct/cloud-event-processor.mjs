import {verifyCloudWebhook} from './cloud-webhook-contract.mjs';
/**
 * Callable from the EXISTING Host/Bridge HTTP router only. Not a server,
 * sender, poller or database. 'deliver' must be the existing native inbox
 * authority and must enforce accountRef/PSID mapping + MID idempotence.
 */
export function createCloudPageWebhookProcessor({secret,reader,deliver,now=Date.now,onVerifiedIncoming}={}){
  if(!reader||typeof reader.verifyMessengerPeer!=='function'||
     typeof reader.readMessages!=='function'||typeof deliver!=='function')
    throw Error('CLOUD_REUSE_EXISTING_BRIDGE_REQUIRED');
  return async function handle({rawBody,headers}={}){
    const proof=verifyCloudWebhook({body:rawBody,headers,secret,nowMs:now()});
    if(proof.kind!=='candidate')return proof;
    const peer=await reader.verifyMessengerPeer({conversationId:proof.cloudConversationId});
    if(peer.cloudInboxId!==155865||peer.cloudConversationId!==proof.cloudConversationId)
      throw Error('CLOUD_PEER_SCOPE_REJECTED');
    const messages=await reader.readMessages(proof.cloudConversationId);
    if(!Array.isArray(messages)||messages.length>200)throw Error('CLOUD_MESSAGES_UNVERIFIED');
    const source=messages.filter(m=>m?.id===proof.cloudMessageId&&m?.source_id===proof.providerMid&&m?.private!==true);
    if(source.length!==1)throw Error('CLOUD_ORIGINAL_MID_UNVERIFIED');
    const message=source[0];
    const direction=message.message_type===0?'INBOUND':message.message_type===1?'OUTBOUND':null;
    if(direction!==proof.direction)throw Error('CLOUD_DIRECTION_CONFLICT');
    const content=String(message.content??'');
    if(content.length>4000)throw Error('CLOUD_CONTENT_TOO_LARGE');
    if(!content.trim() && !Array.isArray(message.attachments))
      return {kind:'deferred',reason:'CLOUD_MEDIA_UNSUPPORTED'};
    const at=typeof message.created_at==='number'?message.created_at*1000:
      Date.parse(String(message.created_at??''));
    if(!Number.isFinite(at)||at<Date.UTC(2000,0,1)||at>now()+300000)
      throw Error('CLOUD_TIMESTAMP_INVALID');
    // Note: Cloud message status is not authoritative Meta read ACK.
    // Official Cloud Page + signed Meta MID are now independently verified.
    // Emit a nonblocking presentation hint even when old CE shadow metadata
    // cannot resolve; Cloud remains the sole message authority.
    if(direction==='INBOUND'&&typeof onVerifiedIncoming==='function'){
      try{void Promise.resolve(onVerifiedIncoming({cloudInboxId:155865,
        cloudConversationId:proof.cloudConversationId,cloudContactId:peer.cloudContactId,
        cloudMessageId:message.id,occurredAtMs:at,
        messageText:content,mediaType:message.attachments?.[0]?.file_type??message.attachments?.[0]?.content_type??null})).catch(()=>{});
      }catch{/* Toast failure cannot change signed webhook processing. */}
    }
    const result=await deliver({cloudMessageId:message.id,cloudConversationId:proof.cloudConversationId,
      cloudContactId:peer.cloudContactId,metaPsid:peer.metaPsid,
      source:'CHATWOOT_CLOUD_META_DIRECT_VERIFIED',channel:'Page',
      direction,providerMid:proof.providerMid,timestamp:at,text:content,
      attachments:Array.isArray(message.attachments)?message.attachments:[],
      contactThumbnail:peer.thumbnail,event:proof.event});
    return {kind:'accepted',cloudVerified:result?.ok===true,
      deliveredToNative:result?.nativeWritten===true};
  };
}
