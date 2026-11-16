/**
 * Read-only Cloud Facebook Personal (inbox 155900) contact scope for the
 * existing original DSH Brain. Never creates a Sender, socket or database.
 * This is intentionally distinct from remote WhatsApp and Page identities.
 */
import {createHash} from 'node:crypto';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
const ACCOUNT=196799,INBOX=155900,NAME='Facebook Personal',TYPE='Channel::Api';
const CONTACT_IDENTIFIER=/^yenra-[a-f0-9]{40}$/u;
const HEX32=/^[a-f0-9]{32}$/u,HEX64=/^[a-f0-9]{64}$/u;
const goodId=x=>Number.isSafeInteger(x)&&x>0;
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');

export function cloudRemotePersonalMemoryScope({inboxId,contactId,identifier}={}){
 if(inboxId!==INBOX||!goodId(contactId)||!CONTACT_IDENTIFIER.test(identifier??''))
  throw Error('CLOUD_REMOTE_PERSONAL_MEMORY_IDENTITY_INVALID');
 const prefix='YENRA_CLOUD_REMOTE_PERSONAL_V1|'+ACCOUNT+'|'+INBOX+'|';
 return Object.freeze({
  memoryAccountRef:hash(prefix+'account').slice(0,32),
  memoryRoomRef:contactId.toString(16).padStart(12,'0')+
    hash(prefix+'contact|'+contactId+'|'+identifier).slice(0,20),
  cloudIdentityHash:hash(prefix+'identity|'+contactId+'|'+identifier),
 });
}
export async function verifiedCloudPersonalInbox(cloud,{knownInboxes}={}){
 if(cloud?.accountId!==ACCOUNT||typeof cloud?.listInboxes!=='function'||typeof cloud?.request!=='function')
  return {ok:false,code:'CLOUD_REMOTE_PERSONAL_AUTHORITY_UNAVAILABLE'};
 let rows=knownInboxes;
 if(!rows){try{rows=await cloud.listInboxes()}catch{return {ok:false,code:'CLOUD_REMOTE_PERSONAL_INBOX_UNAVAILABLE'}}}
 if(!Array.isArray(rows)||rows.length>250)return {ok:false,code:'CLOUD_REMOTE_PERSONAL_INBOX_UNAVAILABLE'};
 const hits=rows.filter(row=>Number(row?.id)===INBOX);
 if(hits.length!==1||hits[0].name!==NAME||
   (hits[0].channelType??hits[0].channel_type)!==TYPE)
  return {ok:false,code:'CLOUD_REMOTE_PERSONAL_INBOX_NOT_AUTHORIZED'};
 let raw;
 try{raw=await cloud.request('GET',cloud.apiBase+'/inboxes/'+INBOX)}
 catch{return {ok:false,code:'CLOUD_REMOTE_PERSONAL_INBOX_UNAVAILABLE'}}
 const entry=raw?.payload?.inbox??raw?.inbox??raw?.payload??raw;
 if(Number(entry?.id)!==INBOX||entry?.name!==NAME||
   (entry?.channel_type??entry?.channelType)!==TYPE||
   entry?.hmac_mandatory!==true||
   typeof entry?.secret!=='string'||!/^[A-Za-z0-9_-]{20,180}$/u.test(entry.secret))
  return {ok:false,code:'CLOUD_REMOTE_PERSONAL_INBOX_NOT_AUTHORIZED'};
 // Chatwoot may omit an outbound callback from the API inbox readback.
 // Never infer a sender or invent a callback from this read-only scope.
 return {ok:true,inboxId:INBOX};
}
function matchedIdentifier(contact,contactId){
 if(Number(contact?.id)!==contactId||!CONTACT_IDENTIFIER.test(contact?.identifier??''))return null;
 const bindings=Array.isArray(contact.contact_inboxes)?contact.contact_inboxes:[];
 const matches=bindings.filter(x=>Number(x?.inbox?.id??x?.inbox_id)===INBOX);
 if(matches.length!==1||matches[0]?.source_id!==contact.identifier)return null;
 return contact.identifier;
}
export async function resolveCloudRemotePersonalConversation({
 cloud,conversation,inboxId,contactId,knownInboxes,readMessages=true
}={}){
 if(cloud?.accountId!==ACCOUNT||inboxId!==INBOX||!goodId(contactId)||
   conversation?.account_id!==ACCOUNT||!goodId(conversation?.id)||
   Number(conversation?.inbox_id??conversation?.inbox?.id)!==INBOX||
   Number(conversation?.meta?.sender?.id)!==contactId)
  return {ok:false,code:'CLOUD_REMOTE_PERSONAL_SELECTION_INVALID'};
 const authorized=await verifiedCloudPersonalInbox(cloud,{knownInboxes});
 if(!authorized.ok)return authorized;
 let contact;
 try{contact=await cloud.getContactById(contactId)}
 catch{return {ok:false,code:'CLOUD_REMOTE_PERSONAL_CONTACT_UNAVAILABLE'}}
 const identifier=matchedIdentifier(contact,contactId);
 if(!identifier)return {ok:false,code:'CLOUD_REMOTE_PERSONAL_SOURCE_MISMATCH'};
 const scope=cloudRemotePersonalMemoryScope({inboxId,contactId,identifier});
 let messages=[];
 if(readMessages){
  let response;
  try{response=await cloud.request('GET',cloud.apiBase+'/conversations/'+conversation.id+'/messages')}
  catch{return {ok:false,code:'CLOUD_REMOTE_PERSONAL_HISTORY_UNAVAILABLE'}}
  const all=listRows(response);
  if(!Array.isArray(all)||all.length>200)
   return {ok:false,code:'CLOUD_REMOTE_PERSONAL_HISTORY_UNAVAILABLE'};
  messages=all.filter(m=>m&&m.private!==true&&[0,1].includes(m.message_type)&&
    (m.conversation_id===undefined||Number(m.conversation_id)===conversation.id)&&
    (m.inbox_id===undefined||Number(m.inbox_id)===INBOX)&&
    goodId(m.id)&&typeof m.content==='string'&&m.content.trim()&&
    Number.isFinite(m.created_at))
   .slice(-30).map(m=>({
    id:m.id,direction:m.message_type===0?'INBOUND':'OUTBOUND',
    text:m.content.trim().slice(0,700),timestamp:m.created_at,
    status:['sent','delivered','read'].includes(m.status)?m.status:'unknown',
   }));
 }
 return {ok:true,selection:{
  kind:'CLOUD_PERSONAL_REMOTE',channel:'Personal',
  cloudAccountId:ACCOUNT,cloudInboxId:INBOX,
  cloudConversationId:conversation.id,cloudContactId:contactId,
  ...scope,contactName:String(conversation?.meta?.sender?.name??contact?.name??'').slice(0,110),
  messages,sendVia:'CLOUD_ORIGINAL_PERSONAL_SENDER_ONLY',
 }};
}
export async function verifyCloudRemotePersonalMemoryScope({
 cloud,accountRef,roomRef,cloudIdentityHash,expectedInboxId
}={}){
 if(expectedInboxId!==INBOX||!HEX32.test(accountRef??'')||!HEX32.test(roomRef??'')||
   !HEX64.test(cloudIdentityHash??''))return false;
 const id=Number.parseInt(roomRef.slice(0,12),16);
 if(!goodId(id))return false;
 const proof=await verifiedCloudPersonalInbox(cloud);
 if(!proof.ok)return false;
 let contact;
 try{contact=await cloud.getContactById(id)}catch{return false}
 const identifier=matchedIdentifier(contact,id);
 if(!identifier)return false;
 const expected=cloudRemotePersonalMemoryScope({inboxId:INBOX,contactId:id,identifier});
 return expected.memoryAccountRef===accountRef&&expected.memoryRoomRef===roomRef&&
  expected.cloudIdentityHash===cloudIdentityHash;
}
