import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
const WA_INBOXES=new Set([155901,155902]);
const valid=x=>Number.isSafeInteger(x)&&x>0;
export function createCloudWhatsAppAvatarSync({host,cloud,logger,now=Date.now,cooldownMs=3600000,
 allowedInboxIds=WA_INBOXES}={}){
 if(!host||typeof host.readVerifiedWhatsAppContactAvatar!=='function'||
   !cloud||typeof cloud.getContactById!=='function'||typeof cloud.uploadVerifiedContactAvatar!=='function'||
   !logger||typeof logger.warn!=='function')
   throw Error('CLOUD_WA_AVATAR_ORIGINAL_DEPENDENCIES_REQUIRED');
 const pending=new Map(),attempted=new Map();
 const stats={scheduled:0,uploaded:0,alreadyPresent:0,noSource:0,failed:0};
 function schedule({channel,accountRef,roomRef,contactId,inboxId}={}){
  if(channel!=='WhatsApp'||!(allowedInboxIds instanceof Set)||!allowedInboxIds.has(inboxId)||inboxId===155865||
     !/^[a-f0-9]{32}$/.test(accountRef??'')||
     !/^[a-f0-9]{32}$/.test(roomRef??'')||!valid(contactId))return false;
  const key=accountRef+'|'+roomRef;
  if(pending.has(key)||now()-(attempted.get(key)??-Infinity)<cooldownMs)return true;
  attempted.set(key,now());
  if(attempted.size>600)attempted.delete(attempted.keys().next().value);
  stats.scheduled++;
  // Always asynchronous; a profile/avatar lookup must NEVER block the Cloud
  // message creation/ACK path, unlike old W25 avatar hydration.
  const task=Promise.resolve().then(async()=>{
   const c=await cloud.getContactById(contactId);
   const identifier=stableContactIdentifier(accountRef,roomRef);
   const linked=Array.isArray(c.contact_inboxes)&&c.contact_inboxes.some(i=>
    Number(i?.inbox?.id??i?.inbox_id)===inboxId&&i.source_id===identifier);
   if(c.identifier!==identifier||!linked)throw Error('CLOUD_WA_AVATAR_CONTACT_SCOPE_CONFLICT');
   if(c.thumbnail||c.avatar_url||c.avatar?.url){stats.alreadyPresent++;return}
   const a=await host.readVerifiedWhatsAppContactAvatar({accountRef,roomRef});
   if(!a?.bytes?.length){stats.noSource++;return}
   await cloud.uploadVerifiedContactAvatar(contactId,a);
   const fresh=await cloud.getContactById(contactId);
   if(!(fresh.thumbnail||fresh.avatar_url||fresh.avatar?.url))throw Error('CLOUD_WA_AVATAR_PERSISTENCE_UNVERIFIED');
   stats.uploaded++;
  }).catch(err=>{
    stats.failed++;
    logger.warn('cloud.wa_contact_avatar_deferred',{code:String(err?.code??err?.message??'UNKNOWN').slice(0,80)});
  }).finally(()=>pending.delete(key));
  pending.set(key,task);
  return true;
 }
 return {schedule,stats,drain:()=>Promise.allSettled([...pending.values()])};
}
