/**
 * Single-Cloud verified Facebook Page projection for original DSH Brain/Memory.
 * No new Messenger sender or database; legitimate Chatwoot Cloud account is the
 * source of the Page Inbox, PSID contact binding and message history.
 * Preserves YENRA's existing per-Page hash algorithm.
 */
import {createHash} from 'node:crypto';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
const ACCOUNT=196799;
const isId=x=>Number.isSafeInteger(x)&&x>0&&x<=0xffffffffffff;
const hex32=/^[a-f0-9]{32}$/u,hex64=/^[a-f0-9]{64}$/u,psid=/^[0-9]{10,24}$/u;
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
function memoryScope(inboxId,contactId,sourceId){
 if(!isId(inboxId)||!isId(contactId)||!psid.test(sourceId??''))
  throw Error('CLOUD_CROSSDEVICE_PAGE_SCOPE_INVALID');
 // Reuse cloud-page-memory-scope's managed-Page deterministic namespace.
 // Legacy 155865 uses its own independent local MemoryService relation on
 // this second PC, never another Host's unverified local accountRef.
 const ownerRef=digest('YENRA_CLOUD_PAGE_OWNER_V1|196799|'+inboxId).slice(0,32);
 const prefix='YENRA_CLOUD_PAGE_MEMORY_V1|196799|'+inboxId+'|';
 return {
  memoryAccountRef:digest(prefix+'account|'+ownerRef).slice(0,32),
  memoryRoomRef:contactId.toString(16).padStart(12,'0')+
   digest(prefix+'contact|'+ownerRef+'|'+contactId+'|'+sourceId).slice(0,20),
  pageIdentityHash:digest('yenra:cloud:196799:'+inboxId+':'+sourceId),
 };
}
async function verifiedPageInbox(cloud,inboxId,knownInboxes){
 if(!isId(inboxId)||!cloud?.listInboxes||!cloud?.request||cloud.accountId!==ACCOUNT)return false;
 const rows=knownInboxes??await cloud.listInboxes().catch(()=>null);
 if(!Array.isArray(rows)||rows.length>250||
    rows.filter(r=>r?.id===inboxId&&
      (r.channelType??r.channel_type)==='Channel::FacebookPage').length!==1)return false;
 try{
  const detail=await cloud.request('GET',cloud.apiBase+'/inboxes/'+inboxId);
  const row=detail?.payload?.inbox??detail?.payload??detail?.inbox??detail;
  return row?.id===inboxId&&row?.channel_type==='Channel::FacebookPage';
 }catch{return false}
}
function psidOf(contact,contactId,inboxId){
 if(!contact||contact.id!==contactId)return null;
 const bindings=Array.isArray(contact.contact_inboxes)?contact.contact_inboxes:[];
 const matching=bindings.filter(b=>Number(b?.inbox?.id??b?.inbox_id)===inboxId);
 if(matching.length!==1||!psid.test(matching[0]?.source_id??''))return null;
 return matching[0].source_id;
}
export async function resolveCloudRemotePageConversation({
 cloud,conversation,inboxId,contactId,knownInboxes,
}={}){
 if(!cloud?.getContactById||!cloud?.request||cloud.accountId!==ACCOUNT||
    !isId(inboxId)||!isId(contactId)||!isId(conversation?.id)||
    conversation.account_id!==ACCOUNT||Number(conversation.inbox_id)!==inboxId||
    Number(conversation?.meta?.sender?.id)!==contactId)
  return {ok:false,code:'CLOUD_CROSSDEVICE_PAGE_CONVERSATION_INVALID'};
 if(!await verifiedPageInbox(cloud,inboxId,knownInboxes))
  return {ok:false,code:'CLOUD_CROSSDEVICE_PAGE_INBOX_NOT_AUTHORIZED'};
 let contact;
 try{contact=await cloud.getContactById(contactId,{allowPageWithoutIdentifier:true})}
 catch{return {ok:false,code:'CLOUD_CROSSDEVICE_PAGE_CONTACT_UNAVAILABLE'}}
 const sourceId=psidOf(contact,contactId,inboxId);
 if(!sourceId)return {ok:false,code:'CLOUD_CROSSDEVICE_PAGE_PSID_BINDING_INVALID'};
 const scope=memoryScope(inboxId,contactId,sourceId);
 let response;
 try{response=await cloud.request('GET',
  cloud.apiBase+'/conversations/'+conversation.id+'/messages')}
 catch{return {ok:false,code:'CLOUD_CROSSDEVICE_PAGE_HISTORY_UNAVAILABLE'}}
 const rows=listRows(response);
 if(!Array.isArray(rows)||rows.length>300)
  return {ok:false,code:'CLOUD_CROSSDEVICE_PAGE_HISTORY_UNAVAILABLE'};
 const messages=rows.filter(msg=>msg&&msg.private!==true&&
   [0,1].includes(msg.message_type)&&isId(msg.id)&&
   (msg.conversation_id===undefined||Number(msg.conversation_id)===conversation.id)&&
   (msg.inbox_id===undefined||Number(msg.inbox_id)===inboxId)&&
   typeof msg.content==='string'&&msg.content.trim()&&Number.isFinite(msg.created_at))
  .slice(-30).map(msg=>({
   id:msg.id,direction:msg.message_type===0?'INBOUND':'OUTBOUND',
   text:msg.content.trim().slice(0,700),timestamp:msg.created_at,
   status:['sent','delivered','read'].includes(msg.status)?msg.status:'unknown',
  }));
 return {ok:true,selection:{
  kind:'CLOUD_PAGE',cloudAccountId:ACCOUNT,cloudInboxId:inboxId,
  cloudConversationId:conversation.id,cloudContactId:contactId,
  ...scope,
  contactName:String(conversation.meta.sender.name??contact?.name??'').slice(0,110),
  messages,shareLinks:[],
 }};
}
export async function verifyCloudRemotePageMemoryScope({
 cloud,accountRef,roomRef,pageIdentityHash,
}={}){
 if(!hex32.test(accountRef??'')||!hex32.test(roomRef??'')||
    !hex64.test(pageIdentityHash??'')||!cloud?.getContactById||
    !cloud?.listInboxes||cloud.accountId!==ACCOUNT)return false;
 const contactId=Number.parseInt(roomRef.slice(0,12),16);
 if(!isId(contactId))return false;
 let rows,contact;
 try{
  [rows,contact]=await Promise.all([
   cloud.listInboxes(),cloud.getContactById(contactId,{allowPageWithoutIdentifier:true})]);
 }catch{return false}
 if(!Array.isArray(rows)||rows.length>250||contact?.id!==contactId)return false;
 const authorized=rows.filter(r=>(r.channelType??r.channel_type)==='Channel::FacebookPage'&&
   isId(r.id)).map(r=>r.id);
 let found=0;
 for(const inboxId of authorized){
  const psid=psidOf(contact,contactId,inboxId);
  if(!psid)continue;
  const s=memoryScope(inboxId,contactId,psid);
  if(s.memoryAccountRef===accountRef&&s.memoryRoomRef===roomRef&&
     s.pageIdentityHash===pageIdentityHash&&
     await verifiedPageInbox(cloud,inboxId,rows))found++;
 }
 return found===1;
}
