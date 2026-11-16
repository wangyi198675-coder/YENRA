import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {createHash} from 'node:crypto';
import {cloudPageMemoryScope,cloudPageManagedAccountRef} from './cloud-page-memory-scope.mjs';
import {createCloudPageReader} from './cloud-api-reader.mjs';
import {verifiedCloudFacebookShareLinks} from './cloud-fb-share-fallback.mjs';
import {enrichVerifiedFacebookPhotoLinks} from './cloud-fb-photo-preview.mjs';
import {resolveCloudRemoteWhatsAppConversation} from './cloud-remote-wa-scope.mjs';
const API_CHANNELS=new Set([155900,155901,155902]);
const valid=x=>Number.isSafeInteger(x)&&x>0;
/** Cloud URL is never authorization. Every selection is re-read from Cloud and
 * re-bound to the authenticated original Host roster before entering DSH Brain. */
export async function resolveCloudNativeConversation({
 cloud,index,scopes,conversationId,expectedAccountId=196799,pageReader=createCloudPageReader(),
 apiInboxIds=API_CHANNELS
}={}){
 if(expectedAccountId!==196799||!valid(conversationId)||!index?.byIdentifier?.get||
    !Array.isArray(scopes))return {ok:false,code:'CLOUD_SELECTION_INPUT_INVALID'};
 let conversation;
 try{conversation=await cloud.getConversation(conversationId)}
 catch{return {ok:false,code:'CLOUD_CONVERSATION_NOT_FOUND'}}
 if(!conversation||conversation.account_id!==196799||conversation.id!==conversationId)
   return {ok:false,code:'CLOUD_CONVERSATION_ACCOUNT_INVALID'};
 const inboxId=Number(conversation.inbox_id??conversation.inbox?.id);
 // Verify every additional Page against the owner-authenticated Cloud inbox
 // registry. Non-Page API channels still use the existing original DSH roster.
 const legacyPage=inboxId===155865;
 let authorizedPage=legacyPage;
 if(!legacyPage&&valid(inboxId)&&typeof cloud.listInboxes==='function'){
   try{
     const inboxes=await cloud.listInboxes();
     authorizedPage=Array.isArray(inboxes)&&inboxes.some(x=>Number(x?.id)===inboxId&&
       (x.channelType??x.channel_type)==='Channel::FacebookPage');
   }catch{return {ok:false,code:'CLOUD_PAGE_INBOX_AUTH_UNAVAILABLE'};}
 }
 if(authorizedPage){
   // Page is an official Messenger Inbox, NOT a Channel::Api. Its identity is
   // the Cloud-confirmed Page-specific PSID, never a guessed original roomRef.
   const verified=await pageReader.verifyMessengerPeer({conversationId,expectedInboxId:inboxId}).catch(()=>null);
   if(!verified||verified.cloudConversationId!==conversationId||
      verified.cloudInboxId!==inboxId||
      Number(verified.cloudContactId)!==Number(conversation?.meta?.sender?.id)||
      !/^\d{10,24}$/.test(verified.metaPsid??''))
     return {ok:false,code:'CLOUD_PAGE_PS_IDENTITY_NOT_VERIFIED'};
   const account=legacyPage?scopes.find(x=>x.channel==='Page'&&x.cloudInboxId===155865):null;
   if(legacyPage&&(!account||scopes.filter(x=>x.channel==='Page'&&x.cloudInboxId===155865).length!==1||
      !index.byAccountRef?.has(account.accountRef)||
      index.byAccountRef.get(account.accountRef)?.channel!=='Page'))
     return {ok:false,code:'CLOUD_PAGE_OWNER_ACCOUNT_MISMATCH'};
   // Cloud-authorized Pages never reuse another Page or WhatsApp memory.
   const originalAccountRef=legacyPage?account.accountRef:cloudPageManagedAccountRef(inboxId);
   const memoryScope=cloudPageMemoryScope({originalAccountRef,
     cloudInboxId:inboxId,cloudContactId:verified.cloudContactId,metaPsid:verified.metaPsid});
   const pageIdentityHash=memoryScope.pageIdentityHash;
   const raw=await pageReader.readMessages(conversationId).catch(()=>null);
   if(!Array.isArray(raw)||raw.length>100)
     return {ok:false,code:'CLOUD_PAGE_HISTORY_NOT_VERIFIED'};
   const shareLinks=await enrichVerifiedFacebookPhotoLinks(verifiedCloudFacebookShareLinks(conversation,raw));
   const messages=raw.filter(m=>m&&m.private!==true&&[0,1].includes(m.message_type)&&
       Number.isSafeInteger(m.id)&&m.id>0&&typeof m.content==='string'&&m.content.trim()&&
       Number.isFinite(m.created_at))
     .slice(-30).map(m=>({id:m.id,direction:m.message_type===0?'INBOUND':'OUTBOUND',
       text:m.content.trim().slice(0,700),timestamp:m.created_at,
       // A Meta 551 rejection is a real FAILED provider message. The Brain
       // must not interpret failed Cloud Page drafts as successfully sent.
       // Never upgrade this to sent/delivered/read without a Meta MID.
       status:['sent','delivered','read','failed'].includes(m.status)?m.status:'unknown'}));
   return {ok:true,selection:{
     kind:'CLOUD_PAGE',cloudAccountId:196799,cloudInboxId:inboxId,
     cloudConversationId:conversationId,cloudContactId:verified.cloudContactId,
     pageIdentityHash,memoryAccountRef:memoryScope.memoryAccountRef,
     memoryRoomRef:memoryScope.memoryRoomRef,
     contactName:String(conversation?.meta?.sender?.name??'').slice(0,110),
     messages,shareLinks
   }};
 }
 // A friend-owned WhatsApp Cloud Inbox must NOT be bound to the owner's
 // local DSH-IM roster. Use a separate Cloud-verified, read-only Brain scope;
 // outgoing messages still route via the friend's existing original Sender.
 if(!authorizedPage&&valid(inboxId)&&!(apiInboxIds instanceof Set&&apiInboxIds.has(inboxId))&&
    typeof cloud.listInboxes==='function'){
   let inboxes;
   try{inboxes=await cloud.listInboxes()}
   catch{return {ok:false,code:'CLOUD_REMOTE_WA_INBOX_AUTH_UNAVAILABLE'}}
   const candidate=Array.isArray(inboxes)&&inboxes.some(item=>
     Number(item?.id)===inboxId&&
     /^YENRA · WhatsApp · [a-f0-9]{14}$/u.test(item.name??'')&&
     (item.channelType??item.channel_type)==='Channel::Api');
   if(candidate){
     const contactId=Number(conversation?.meta?.sender?.id);
     return resolveCloudRemoteWhatsAppConversation({
       cloud,conversation,inboxId,contactId,knownInboxes:inboxes,
     });
   }
 }
 if(!(apiInboxIds instanceof Set)||!apiInboxIds.has(inboxId)||authorizedPage)
   return {ok:false,code:'CLOUD_NON_API_CHANNEL_DEFERRED'};
 const contactId=Number(conversation?.meta?.sender?.id??conversation?.contact_id);
 if(!valid(contactId))return {ok:false,code:'CLOUD_CONTACT_ID_UNVERIFIED'};
 let contact;
 try{contact=await cloud.getContactById(contactId)}
 catch{return {ok:false,code:'CLOUD_CONTACT_NOT_VERIFIED'}}
 const identifier=contact?.identifier;
 if(typeof identifier!=='string'||!/^yenra-[a-f0-9]{40}$/.test(identifier))
   return {ok:false,code:'CLOUD_ORIGINAL_IDENTIFIER_UNVERIFIED'};
 const indexed=index.byIdentifier.get(identifier);
 if(!indexed||typeof indexed.accountRef!=='string'||typeof indexed.roomRef!=='string'||
    stableContactIdentifier(indexed.accountRef,indexed.roomRef)!==identifier)
   return {ok:false,code:'CLOUD_CONTACT_NOT_IN_AUTHORIZED_DSH_ROSTER'};
 const scope=scopes.find(x=>x.accountRef===indexed.accountRef);
 if(!scope||scope.cloudInboxId!==inboxId||scope.channel!==indexed.channel||
    !['Personal','WhatsApp'].includes(scope.channel))
   return {ok:false,code:'CLOUD_CROSS_CHANNEL_SELECTION_REJECTED'};
 const bindings=Array.isArray(contact.contact_inboxes)?contact.contact_inboxes:[];
 if(!bindings.some(ci=>Number(ci?.inbox?.id??ci?.inbox_id)===inboxId&&ci.source_id===identifier))
   return {ok:false,code:'CLOUD_CONTACT_INBOX_SOURCE_ID_MISMATCH'};
 return {ok:true,selection:{
   cloudAccountId:196799,cloudInboxId:inboxId,cloudConversationId:conversationId,
   cloudContactId:contactId,accountRef:indexed.accountRef,roomRef:indexed.roomRef,
   channel:indexed.channel,
 }};
}
