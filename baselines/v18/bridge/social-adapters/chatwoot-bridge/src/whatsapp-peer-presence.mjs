/** Real provider peer presence to native Chatwoot ActionCable, not a fake UI.
 * One selected user chat only; no persistence, second socket or browser script.
 */
import {stableContactIdentifier,isAccountRef} from './contract.mjs';
export function createSelectedWhatsAppPresence({chatwoot,index,logger,now=Date.now}={}) {
  if(typeof chatwoot?.writeVerifiedPeerTyping!=='function' || !index?.byIdentifier)
    throw Error('NATIVE_PEER_PRESENCE_DEPENDENCIES_MISSING');
  let selected=null, timer=null, lastOnAt=0, lastSentAt=0;
  const clear=()=>{if(timer)clearTimeout(timer);timer=null;};
  function expiry(scope) {
    clear();
    timer=setTimeout(()=>{
      timer=null;
      if(selected!==scope)return;
      if(now()-lastOnAt<6500){expiry(scope);return;}
      void write('off',scope).catch(error=>
        logger?.warn?.('wa.peer_presence_timeout_off_unavailable',
          {code:error?.code??'UNKNOWN'}));
    },7000);
    timer.unref?.();
  }
  function select(selection,displayId) {
    clear();
    if(!selection||selection.channel!=='WhatsApp'||
       !Number.isSafeInteger(displayId)||displayId<=0) {selected=null;return;}
    selected={...selection,displayId,at:now()};
    lastSentAt=0;lastOnAt=0;
  }
  async function write(status,scope) {
    const identifier=stableContactIdentifier(scope.accountRef,scope.roomRef);
    await chatwoot.writeVerifiedPeerTyping({
      conversationDisplayId:scope.displayId,inboxId:scope.inboxId,identifier,status,
    });
  }
  async function handle(p) {
    if(!selected || p?.source!=='ORIGINAL_BAILEYS_PRESENCE' ||
       p?.channel!=='WhatsApp' ||
       !isAccountRef(p.accountRef)||!isAccountRef(p.roomRef)||
       !['on','off'].includes(p.status)||!Number.isFinite(p.observedAt)||
       Math.abs(now()-p.observedAt)>12000 ||
       p.accountRef!==selected.accountRef || p.roomRef!==selected.roomRef)
      return {ok:false,reason:'NOT_AUTHENTICATED_SELECTED_WA_PRESENCE'};
    const identifier=stableContactIdentifier(p.accountRef,p.roomRef);
    const original=index.byIdentifier.get(identifier);
    if(original?.channel!=='WhatsApp'||original.inboxId!==selected.inboxId||
       original.accountRef!==p.accountRef||original.roomRef!==p.roomRef)
      return {ok:false,reason:'WA_PRESENCE_ROSTER_SCOPE_MISMATCH'};
    const target=selected;
    if(p.status==='on' && now()-lastSentAt<1500) {
      lastOnAt=now();expiry(target);return {ok:true,coalesced:true};
    }
    try {
      await write(p.status,target);
      lastSentAt=now();
      if(p.status==='on') {
        lastOnAt=now();
        expiry(target);
      } else clear();
      return {ok:true,status:p.status};
    }catch(error){
      logger?.warn?.('wa.peer_presence_native_unavailable',
        {code:error?.code??'UNKNOWN'});
      return {ok:false,reason:'NATIVE_PEER_TYPING_NOT_AVAILABLE'};
    }
  }
  return {select,handle,close(){clear();selected=null;}};
}
