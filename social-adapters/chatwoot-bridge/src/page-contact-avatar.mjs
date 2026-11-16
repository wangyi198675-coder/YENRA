/** Original Host-verified Page contact avatar -> native Chatwoot Active Storage.
 * This is an on-demand, non-blocking native contact update. No new avatar DB,
 * provider URL forwarding, second identity service or bulk roster scraping.
 */
import {stableContactIdentifier} from './contract.mjs';
export function createVerifiedPageAvatarSync({host,chatwoot,index,logger}={}){
  if(!host?.readFacebookContactAvatar||!chatwoot?.getContactById||
     !chatwoot?.uploadVerifiedContactAvatar||!index?.byIdentifier)
    throw Error('PAGE_AVATAR_NATIVE_DEPENDENCY_MISSING');
  const active=new Map(),completed=new Set();
  const sync=async({accountRef,roomRef,contactId=null}={})=>{
    const identifier=stableContactIdentifier(accountRef,roomRef);
    const scope=index.byIdentifier.get(identifier);
    if(!scope||scope.channel!=='Page'||scope.accountRef!==accountRef||scope.roomRef!==roomRef)
      return {ok:false,code:'PAGE_AVATAR_SCOPE_NOT_VERIFIED'};
    if(completed.has(identifier))return {ok:true,cached:true};
    if(active.has(identifier))return active.get(identifier);
    const task=(async()=>{
      const record=Number.isSafeInteger(contactId)&&contactId>0
        ?await chatwoot.getContactById(contactId)
        :await chatwoot.findContactByIdentifier(identifier);
      if(!record||record.identifier!==identifier||!Number.isSafeInteger(record.id))
        return {ok:false,code:'PAGE_AVATAR_CONTACT_BINDING_INVALID'};
      const bound=Array.isArray(record.contact_inboxes)?record.contact_inboxes:[];
      if(!bound.some(x=>(x?.inbox_id??x?.inbox?.id)===scope.inboxId))
        return {ok:false,code:'PAGE_AVATAR_INBOX_MISMATCH'};
      if((typeof record.avatar_url==='string'&&record.avatar_url.trim())||
         (typeof record.thumbnail==='string'&&record.thumbnail.trim())){
        completed.add(identifier);
        return {ok:true,alreadyAttached:true};
      }
      const image=await host.readFacebookContactAvatar({accountRef,roomRef});
      if(!image)return {ok:false,code:'PAGE_ORIGINAL_AVATAR_UNAVAILABLE'};
      await chatwoot.uploadVerifiedContactAvatar(record.id,image);
      completed.add(identifier);
      logger?.info?.('page.contact_avatar_saved',{channel:'Page',inboxId:scope.inboxId});
      return {ok:true,uploaded:true};
    })().catch(error=>{
      logger?.warn?.('page.contact_avatar_unavailable',{code:error?.code??'UNKNOWN'});
      return {ok:false,code:'PAGE_AVATAR_SYNC_FAILED'};
    }).finally(()=>active.delete(identifier));
    active.set(identifier,task);
    return task;
  };
  return Object.freeze({sync});
}
