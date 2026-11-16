/**
 * Remote, independently authorized DSH-IM WhatsApp contact: Cloud-only read
 * projection for the ORIGINAL DSH Brain and memory. No WhatsApp socket,
 * second Sender, owner-host roster spoofing, local chat DB or Cloud writes.
 *
 * The friend-owned DSH-IM Host must first have provisioned its OWN signed
 * Chatwoot API inbox using the original YENRA Cloud Bridge. Account 196799
 * remains the unique source of chat/contact/history truth.
 */
import {createHash} from 'node:crypto';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';

const ACCOUNT=196799;
const RESERVED=new Set([155865,155900]);
// Original owner WA Inboxes remain available to an equally authorized second PC.
const LEGACY_REMOTE_WA=new Set([155901,155902]);
const IDENT=/^yenra-[a-f0-9]{40}$/u;
const INBOX_NAME=/^YENRA · WhatsApp · [a-f0-9]{14}$/u;
const CALLBACK=/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\/yenra-friend-cw-[a-f0-9]{48}$/u;
const LEGACY_CALLBACK=/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\/yenra-cw-api-[a-f0-9]{32,64}$/u;
const REF=/^[a-f0-9]{32}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const goodId=x=>Number.isSafeInteger(x)&&x>0&&x<=0xffffffffffff;
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');

export function cloudRemoteWhatsAppMemoryScope({inboxId,contactId,identifier}={}){
 if(!goodId(inboxId)||RESERVED.has(inboxId)||!goodId(contactId)||!IDENT.test(identifier??''))
   throw Error('CLOUD_REMOTE_WA_MEMORY_SCOPE_INVALID');
 const prefix='YENRA_CLOUD_REMOTE_WA_MEMORY_V1|'+ACCOUNT+'|'+inboxId+'|';
 return Object.freeze({
  memoryAccountRef:digest(prefix+'account').slice(0,32),
  memoryRoomRef:contactId.toString(16).padStart(12,'0')+
    digest(prefix+'contact|'+contactId+'|'+identifier).slice(0,20),
  cloudIdentityHash:digest(prefix+'identity|'+contactId+'|'+identifier),
 });
}

export async function verifiedFriendCloudInbox(cloud,inboxId,{rows}={}){
 if(!goodId(inboxId)||RESERVED.has(inboxId)||!cloud?.request||!cloud?.listInboxes)
  return {ok:false,code:'CLOUD_REMOTE_WA_INBOX_NOT_AUTHORIZED'};
 const inboxes=rows??await cloud.listInboxes().catch(()=>null);
 if(!Array.isArray(inboxes)||inboxes.length>250)
  return {ok:false,code:'CLOUD_REMOTE_WA_INBOX_LIST_UNAVAILABLE'};
 const matching=inboxes.filter(x=>Number(x?.id)===inboxId);
 if(matching.length!==1||!(INBOX_NAME.test(matching[0].name??'')||LEGACY_REMOTE_WA.has(inboxId))||
    (matching[0].channelType??matching[0].channel_type)!=='Channel::Api')
  return {ok:false,code:'CLOUD_REMOTE_WA_INBOX_NOT_AUTHORIZED'};
 let entry;
 try{entry=await cloud.request('GET',cloud.apiBase+'/inboxes/'+inboxId)}
 catch{return {ok:false,code:'CLOUD_REMOTE_WA_INBOX_DETAIL_UNAVAILABLE'}}
 const detail=entry?.payload?.inbox??entry?.inbox??entry?.payload??entry;
 const callback=detail?.channel?.webhook_url??detail?.webhook_url;
 if(Number(detail?.id)!==inboxId||detail?.name!==matching[0].name||
    (detail?.channel_type??detail?.channelType)!=='Channel::Api'||
    detail?.hmac_mandatory!==true||!(CALLBACK.test(callback??'')||
     LEGACY_REMOTE_WA.has(inboxId)&&LEGACY_CALLBACK.test(callback??''))||
    typeof detail?.secret!=='string'||!(/^[A-Za-z0-9_-]{20,180}$/u.test(detail.secret)))
  return {ok:false,code:'CLOUD_REMOTE_WA_INBOX_SIGNED_BINDING_INVALID'};
 return {ok:true,inboxId,name:detail.name};
}

function matchContact({contact,contactId,inboxId}){
 if(Number(contact?.id)!==contactId||!IDENT.test(contact?.identifier??''))
  return null;
 const ci=Array.isArray(contact.contact_inboxes)?contact.contact_inboxes:[];
 const hits=ci.filter(b=>Number(b?.inbox?.id??b?.inbox_id)===inboxId);
 if(hits.length!==1||hits[0]?.source_id!==contact.identifier)return null;
 return contact.identifier;
}

export async function resolveCloudRemoteWhatsAppConversation({
 cloud,conversation,inboxId,contactId,readMessages=true,knownInboxes,
}={}){
 if(!cloud?.request||!cloud?.listInboxes||!cloud?.getContactById||
    cloud.accountId!==ACCOUNT||!goodId(inboxId)||!goodId(contactId)||
    conversation?.account_id!==ACCOUNT||
    Number(conversation?.inbox_id??conversation?.inbox?.id)!==inboxId||
    Number(conversation?.meta?.sender?.id)!==contactId||
    !goodId(conversation?.id))
  return {ok:false,code:'CLOUD_REMOTE_WA_SELECTION_INPUT_INVALID'};
 const verified=await verifiedFriendCloudInbox(cloud,inboxId,{rows:knownInboxes});
 if(!verified.ok)return verified;
 let contact;
 try{contact=await cloud.getContactById(contactId)}
 catch{return {ok:false,code:'CLOUD_REMOTE_WA_CONTACT_UNAVAILABLE'}}
 const identifier=matchContact({contact,contactId,inboxId});
 if(!identifier)return {ok:false,code:'CLOUD_REMOTE_WA_CONTACT_SOURCE_MISMATCH'};
 let memory;
 try{memory=cloudRemoteWhatsAppMemoryScope({inboxId,contactId,identifier})}
 catch{return {ok:false,code:'CLOUD_REMOTE_WA_MEMORY_SCOPE_INVALID'}}
 let messages=[];
 if(readMessages){
  let data;
  try{data=await cloud.request('GET',
   cloud.apiBase+'/conversations/'+conversation.id+'/messages')}
  catch{return {ok:false,code:'CLOUD_REMOTE_WA_HISTORY_UNAVAILABLE'}}
  const all=listRows(data);
  if(!Array.isArray(all)||all.length>200)
   return {ok:false,code:'CLOUD_REMOTE_WA_HISTORY_UNAVAILABLE'};
  messages=all.filter(msg=>msg&&msg.private!==true&&[0,1].includes(msg.message_type)&&
    (msg.conversation_id===undefined||Number(msg.conversation_id)===conversation.id)&&
    (msg.inbox_id===undefined||Number(msg.inbox_id)===inboxId)&&
    goodId(msg.id)&&typeof msg.content==='string'&&msg.content.trim()&&
    Number.isFinite(msg.created_at))
   .slice(-30).map(msg=>({
    id:msg.id,direction:msg.message_type===0?'INBOUND':'OUTBOUND',
    text:msg.content.trim().slice(0,700),timestamp:msg.created_at,
    status:['sent','delivered','read'].includes(msg.status)?msg.status:'unknown',
   }));
 }
 return {ok:true,selection:{
  kind:'CLOUD_WHATSAPP_REMOTE',channel:'WhatsApp',cloudAccountId:ACCOUNT,
  cloudInboxId:inboxId,cloudConversationId:conversation.id,cloudContactId:contactId,
  cloudIdentityHash:memory.cloudIdentityHash,
  memoryAccountRef:memory.memoryAccountRef,memoryRoomRef:memory.memoryRoomRef,
  contactName:String(conversation.meta.sender.name??contact?.name??'').slice(0,110),
  messages,sendVia:'CLOUD_ORIGINAL_FRIEND_SENDER_ONLY',
 }};
}

/** Cloud authenticated MemoryService proof: never trust supplied refs alone. */
export async function verifyCloudRemoteWhatsAppMemoryScope({
 cloud,accountRef,roomRef,cloudIdentityHash,expectedInboxId,
}={}){
 if(!REF.test(accountRef??'')||!REF.test(roomRef??'')||
    !HASH.test(cloudIdentityHash??'')||!cloud?.getContactById||
    !cloud?.listInboxes||!goodId(expectedInboxId))
  return false;
 const contactId=Number.parseInt(roomRef.slice(0,12),16);
 if(!goodId(contactId))return false;
 const verified=await verifiedFriendCloudInbox(cloud,expectedInboxId);
 if(!verified.ok)return false;
 let contact;
 try{contact=await cloud.getContactById(contactId)}catch{return false}
 const identifier=matchContact({contact,contactId,inboxId:expectedInboxId});
 if(!identifier)return false;
 let derived;
 try{derived=cloudRemoteWhatsAppMemoryScope({
   inboxId:expectedInboxId,contactId,identifier})}catch{return false}
 return derived.memoryAccountRef===accountRef&&
  derived.memoryRoomRef===roomRef&&derived.cloudIdentityHash===cloudIdentityHash;
}
