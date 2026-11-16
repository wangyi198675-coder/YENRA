/** Existing WhatsApp single-socket avatar -> Chatwoot's native Active Storage.
 * Selected, authenticated room only. No new database, cache or background fetch.
 */
import {stableContactIdentifier} from './contract.mjs';
export function createVerifiedWhatsAppAvatarSync({host,chatwoot,index,logger}={}) {
  if(typeof host?.readVerifiedWhatsAppContactAvatar!=='function' ||
     typeof chatwoot?.findContactByIdentifier!=='function' ||
     typeof chatwoot?.uploadVerifiedContactAvatar!=='function')
    throw Error('WA_ORIGINAL_AVATAR_DEPENDENCY_MISSING');
  const pending=new Map(), completed=new Set();
  async function sync({accountRef,roomRef,contactId=null}={}) {
    const identifier=stableContactIdentifier(accountRef,roomRef);
    const scope=index.byIdentifier.get(identifier);
    if(scope?.channel!=='WhatsApp'||scope.accountRef!==accountRef||scope.roomRef!==roomRef)
      return {ok:false,code:'WA_AVATAR_SCOPE_NOT_VERIFIED'};
    if(completed.has(identifier))return {ok:true,cached:true};
    if(pending.has(identifier))return pending.get(identifier);
    const task=(async()=>{
      const record=Number.isSafeInteger(contactId)&&contactId>0
        ?await chatwoot.getContactById(contactId)
        :await chatwoot.findContactByIdentifier(identifier);
      if(!record||record.identifier!==identifier||!Number.isSafeInteger(record.id))
        return {ok:false,code:'WA_AVATAR_CONTACT_MISMATCH'};
      const refs=Array.isArray(record.contact_inboxes)?record.contact_inboxes:[];
      if(!refs.some(v=>(v?.inbox_id??v?.inbox?.id)===scope.inboxId))
        return {ok:false,code:'WA_AVATAR_INBOX_MISMATCH'};
      if((typeof record.avatar_url==='string'&&record.avatar_url.trim())||
         (typeof record.thumbnail==='string'&&record.thumbnail.trim())) {
        completed.add(identifier);return {ok:true,alreadyAttached:true};
      }
      const image=await host.readVerifiedWhatsAppContactAvatar({accountRef,roomRef});
      if(!image)return {ok:false,code:'WA_ORIGINAL_AVATAR_NOT_AVAILABLE'};
      await chatwoot.uploadVerifiedContactAvatar(record.id,image);
      completed.add(identifier);
      logger?.info?.('wa.contact_avatar_saved',{inboxId:scope.inboxId});
      return {ok:true,uploaded:true};
    })().catch(err=>{
      logger?.warn?.('wa.contact_avatar_unavailable',{code:err?.code??err?.message??'UNKNOWN'});
      return {ok:false,code:'WA_ORIGINAL_AVATAR_SYNC_FAILED'};
    }).finally(()=>pending.delete(identifier));
    pending.set(identifier,task);
    return task;
  }
  return Object.freeze({sync});
}
