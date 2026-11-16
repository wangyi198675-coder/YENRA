/** Verified per-Page/contact projection for the installed DSH MemoryService.
 * Legacy Page 155865 retains byte-identical keys. New Cloud-authorized
 * Messenger Pages use an inbox-derived account namespace. */
import {createHash} from 'node:crypto';
const REF=/^[a-f0-9]{32}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const goodId=n=>Number.isSafeInteger(n)&&n>0&&n<=0xffffffffffff;
const digest=s=>createHash('sha256').update(s).digest('hex');
const LEGACY_INBOX=155865;
export function cloudPageManagedAccountRef(cloudInboxId){
 if(!goodId(cloudInboxId)||cloudInboxId===LEGACY_INBOX)
   throw Error('CLOUD_MANAGED_PAGE_INBOX_INVALID');
 return digest('YENRA_CLOUD_PAGE_OWNER_V1|196799|'+cloudInboxId).slice(0,32);
}
export function cloudPageMemoryScope({
 originalAccountRef,cloudInboxId=LEGACY_INBOX,cloudContactId,metaPsid
}={}){
 if(!REF.test(originalAccountRef??'')||!goodId(cloudInboxId)||
    !goodId(cloudContactId)||!/^\d{10,24}$/u.test(metaPsid??''))
   throw Error('CLOUD_PAGE_MEMORY_IDENTITY_INVALID');
 const prefix='YENRA_CLOUD_PAGE_MEMORY_V1|196799|'+cloudInboxId+'|';
 return Object.freeze({
   memoryAccountRef:digest(prefix+'account|'+originalAccountRef).slice(0,32),
   memoryRoomRef:cloudContactId.toString(16).padStart(12,'0')+
     digest(prefix+'contact|'+originalAccountRef+'|'+cloudContactId+'|'+metaPsid).slice(0,20),
   pageIdentityHash:digest('yenra:cloud:196799:'+cloudInboxId+':'+metaPsid)
 });
}
export async function verifyCloudPageMemoryScope({
 cloud,scopes,index,accountRef,roomRef,pageIdentityHash,expectedInboxId
}={}){
 if(!REF.test(accountRef??'')||!REF.test(roomRef??'')||
    !HASH.test(pageIdentityHash??'')||!cloud?.getContactById||
    !Array.isArray(scopes)||!index?.byAccountRef||
    (expectedInboxId!==undefined&&!goodId(expectedInboxId)))return false;
 const contactId=Number.parseInt(roomRef.slice(0,12),16);
 if(!goodId(contactId))return false;
 let contact;
 try{contact=await cloud.getContactById(contactId,{allowPageWithoutIdentifier:true})}catch{return false}
 if(Number(contact?.id)!==contactId)return false;
 const bindings=Array.isArray(contact.contact_inboxes)?contact.contact_inboxes:[];
 const candidates=bindings.filter(x=>goodId(Number(x?.inbox?.id??x?.inbox_id))&&
   /^\d{10,24}$/u.test(x?.source_id??''));
 let authorizedNewIds=new Set();
 if(typeof cloud.listInboxes==='function'&&candidates.some(x=>Number(x?.inbox?.id??x?.inbox_id)!==LEGACY_INBOX)){
   try{
     const rows=await cloud.listInboxes();
     if(Array.isArray(rows))authorizedNewIds=new Set(rows.filter(row=>
       (row?.channelType??row?.channel_type)==='Channel::FacebookPage'&&
       goodId(Number(row.id))&&Number(row.id)!==LEGACY_INBOX).map(row=>Number(row.id)));
   }catch{return false}
 }
 for(const binding of candidates){
   const inboxId=Number(binding?.inbox?.id??binding?.inbox_id);
   if(expectedInboxId!==undefined&&inboxId!==expectedInboxId)continue;
   // Duplicated PSID bindings for the same inbox must fail closed.
   if(candidates.filter(x=>Number(x?.inbox?.id??x?.inbox_id)===inboxId).length!==1)continue;
   let originalAccountRef;
   if(inboxId===LEGACY_INBOX){
     const pages=scopes.filter(x=>x.channel==='Page'&&x.cloudInboxId===LEGACY_INBOX);
     if(pages.length!==1||index.byAccountRef.get(pages[0].accountRef)?.channel!=='Page')continue;
     originalAccountRef=pages[0].accountRef;
   }else{
     if(!authorizedNewIds.has(inboxId))continue;
     originalAccountRef=cloudPageManagedAccountRef(inboxId);
   }
   let candidate;
   try{candidate=cloudPageMemoryScope({originalAccountRef,cloudInboxId:inboxId,
     cloudContactId:contactId,metaPsid:binding.source_id})}catch{continue}
   if(candidate.memoryAccountRef===accountRef&&candidate.memoryRoomRef===roomRef&&
      candidate.pageIdentityHash===pageIdentityHash)return true;
 }
 return false;
}
