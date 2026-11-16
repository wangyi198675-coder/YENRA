/**
 * Friend-side adapter for the EXISTING local DSH-IM WhatsApp Socket / Sender.
 * Shared Chatwoot account 196799, one newly registered API inbox per native
 * WhatsApp account. This module creates NO socket, sender, agent or database.
 * It is composed inside the friend's ONE existing bridge; the owner computer
 * must NEVER become the sender for a friend's authenticated WhatsApp account.
 */
import {buildRosterIndex} from '../chatwoot-bridge/src/inbox-map.mjs';
import {classifySseFrame} from '../chatwoot-bridge/src/host-client.mjs';
import {createCloudInboundProjection} from './cloud-inbound-projection.mjs';
import {createCloudWaOutbound} from './cloud-wa-outbound.mjs';
import {createCloudPlatformAck} from './cloud-platform-ack.mjs';
import {verifyCloudApiChannelCallback} from './cloud-api-channel-callback.mjs';
import {friendInboxName} from './shared-friend-whatsapp-provision.mjs';

const reserved=new Set([155865,155900,155901,155902]);
const pos=x=>Number.isSafeInteger(x)&&x>0;

export async function prepareFriendWhatsAppRuntime({
 cloud,host,roster,hostAccount,inboxId,callbackUrl,hostSender,
 logger,claimDirectory,now=Date.now,onVerifiedIncoming,
}={}){
 if(cloud?.accountId!==196799||cloud.apiBase!=='/api/v1/accounts/196799'||
    !cloud?.request||!cloud?.getConversation||!host?.readRoom||
    !host?.openEventStream||!hostSender?.send||!logger?.warn||
    typeof claimDirectory!=='string'||!claimDirectory)
    throw Error('FRIEND_BRIDGE_EXISTING_DEPENDENCIES_REQUIRED');
 if(!hostAccount||hostAccount.channel!=='WhatsApp'||hostAccount.authorized!==true||
    hostAccount.online!==true||!pos(inboxId)||reserved.has(inboxId))
    throw Error('FRIEND_BRIDGE_NATIVE_AUTHORITY_NOT_READY');
 if(!Array.isArray(roster?.accounts)||roster.accounts.filter(a=>
    a.channel==='WhatsApp'&&a.accountRef===hostAccount.accountRef).length!==1)
    throw Error('FRIEND_BRIDGE_HOST_ROSTER_NOT_VERIFIED');
 const info=await cloud.request('GET',cloud.apiBase+'/inboxes/'+inboxId);
 const inbox=info?.payload?.inbox??info?.payload??info;
 if(inbox?.id!==inboxId||inbox.channel_type!=='Channel::Api'||
    inbox.name!==friendInboxName(hostAccount.accountRef)||
    (inbox.webhook_url??inbox.callback_webhook_url)!==callbackUrl)
    throw Error('FRIEND_BRIDGE_CLOUD_INBOX_NOT_BOUND');
 // API inbox webhook signing uses inbox.secret, NOT the independent
 // hmac_token used for API contact identity. Match the existing owner Bridge.
 if(inbox.hmac_mandatory!==true)throw Error('FRIEND_BRIDGE_CLOUD_HMAC_NOT_MANDATORY');
 const secret=String(inbox.secret??'');
 if(!/^[a-zA-Z0-9_-]{20,180}$/.test(secret))
    throw Error('FRIEND_BRIDGE_CLOUD_WEBHOOK_SECRET_NOT_AVAILABLE');
 // This set is scoped to THIS friend's DSH-IM account. Existing owner's WA
 // inbox IDs can never be claimed by a friend-side bridge.
 const allowedInboxIds=new Set([inboxId]);
 const scopes=[{channel:'WhatsApp',accountRef:hostAccount.accountRef,cloudInboxId:inboxId}];
 const mapping=new Map([[hostAccount.accountRef,{inboxId}]]);
 const index=buildRosterIndex(roster,mapping);
 // The native Host roster evolves when a NEW contact first messages.
 // Preserve the same Host authority and update only its in-memory projection:
 // no shadow contact DB, second WhatsApp login or new sender.
 let refreshPending=null;
 async function refreshOriginalRoster(){
   if(refreshPending)return refreshPending;
   refreshPending=(async()=>{
     if(typeof host.readRoster!=='function')throw Error('FRIEND_NATIVE_ROSTER_REFRESH_UNAVAILABLE');
     const fresh=await host.readRoster({whatsappOnly:true});
     const matches=(fresh?.accounts??[]).filter(a=>a.accountRef===hostAccount.accountRef);
     if(matches.length!==1||matches[0].channel!=='WhatsApp'||
       !Array.isArray(matches[0].rooms))throw Error('FRIEND_NATIVE_ROSTER_IDENTITY_CHANGED');
     // Mutate the roster object shared by the existing inbound projector.
     roster.accounts=fresh.accounts;
     const updated=buildRosterIndex(roster,mapping);
     index.byIdentifier.clear();
     for(const [key,value] of updated.byIdentifier)index.byIdentifier.set(key,value);
     index.byAccountRef.clear();
     for(const [key,value] of updated.byAccountRef)index.byAccountRef.set(key,value);
     index.size=updated.size;
     return true;
   })().finally(()=>{refreshPending=null});
   return refreshPending;
 }
 async function ensureKnownRoom(roomRef){
   const account=roster.accounts.find(a=>a.accountRef===hostAccount.accountRef);
   if(account?.rooms.some(r=>r.roomRef===roomRef))return true;
   await refreshOriginalRoster();
   return roster.accounts.find(a=>a.accountRef===hostAccount.accountRef)
     ?.rooms.some(r=>r.roomRef===roomRef)===true;
 }
 const inbound=createCloudInboundProjection({host,cloud,roster,scopes,logger,
    enabledAccountRefs:[hostAccount.accountRef],allowedInboxIds,now,onVerifiedIncoming});
 const verify=options=>verifyCloudApiChannelCallback({
    ...options,now,secretProvider:async()=>({[inboxId]:secret}),allowedInboxIds,
 });
 const outbound=createCloudWaOutbound({
    cloud,hostSender,index,scopes,logger,claimDirectory,verify,
    allowedInboxIds,now,activatedAt:now(),
 });
 const platformAck=createCloudPlatformAck({host,cloud,roster,scopes,logger,claimDirectory});
 // Bounded first-contact recovery uses the EXISTING inbound MID validation,
 // Chatwoot unique source_id and one original DSH-IM Host read. No bulk
 // history copy, second chat DB or unsupported outgoing-message resend.
 async function bootstrapRecentIncoming(){
   const account=roster.accounts.find(a=>a.channel==='WhatsApp'&&a.accountRef===hostAccount.accountRef);
   const rooms=[...(account?.rooms??[])].sort((a,b)=>(b.lastMessageAt??0)-(a.lastMessageAt??0)).slice(0,10);
   const cutoff=now()-72*60*60*1000;
   const summary={scannedRooms:0,verifiedIncoming:0,alreadyCloud:0,failed:0};
   for(const room of rooms){
     try{
       const verified=await host.readRoom({channel:'WhatsApp',accountRef:hostAccount.accountRef,roomRef:room.roomRef});
       if(verified?.accountRef!==hostAccount.accountRef||verified?.roomRef!==room.roomRef||
          !Array.isArray(verified.messages))throw Error('FRIEND_RECENT_ORIGINAL_ROOM_INVALID');
       summary.scannedRooms++;
       const recent=verified.messages.filter(msg=>msg?.direction==='INBOUND'&&
          typeof msg.mid==='string'&&typeof msg.text==='string'&&
          msg.text.trim()&&msg.text.length<=4000&&
          !msg.nativeMediaType&&(!Array.isArray(msg.media)||msg.media.length===0)&&
          Number.isFinite(msg.timestamp)&&msg.timestamp>=cutoff&&msg.timestamp<=now()+300000).slice(-4);
       for(const msg of recent){
         const result=await inbound.deliver({...msg,accountRef:hostAccount.accountRef,roomRef:room.roomRef});
         if(result?.alreadyCloud)summary.alreadyCloud++;
         else if(result?.ok)summary.verifiedIncoming++;
       }
     }catch(error){
       summary.failed++;
       logger.warn('friend.cloud_recent_deferred',{code:String(error?.code??error?.message??'UNKNOWN').slice(0,65)});
     }
   }
   return summary;
 }
 let stream=null;
 function startOriginalHostEvents(){
   if(stream) return stream;
   stream=host.openEventStream({onFrame:frame=>{
     let parsed;try{parsed=classifySseFrame(frame)}catch(e){logger.warn('friend.cloud_sse_event_invalid');return}
     if(parsed?.kind==='ack'&&parsed.ack?.accountRef===hostAccount.accountRef){
       // Native ACK belongs to this original WhatsApp Socket, never the owner
       // machine or retired local CE database.
       void platformAck.handle(parsed.ack).then(result=>{
         if(!result.ok)logger.warn('friend.cloud_ack_unconfirmed',{code:result.code});
       }).catch(error=>logger.warn('friend.cloud_ack_unavailable',{
         code:String(error?.code??error?.message??'UNKNOWN').slice(0,72)}));
       return;
     }
     if(parsed?.kind==='message'&&parsed.row?.direction==='INBOUND'&&
        parsed.row?.accountRef===hostAccount.accountRef){
       const roomRef=parsed.row.roomRef;
       const known=roster.accounts.find(a=>a.accountRef===hostAccount.accountRef)
         ?.rooms.some(r=>r.roomRef===roomRef);
       if(known){inbound.handle(parsed.row);return}
       // Reuse the verified native Host roster before allowing a new contact.
       // Never create an unverified Cloud contact or a second local roster.
       void ensureKnownRoom(roomRef).then(authorized=>{
         if(authorized)inbound.handle(parsed.row);
         else logger.warn('friend.cloud_new_room_not_authorized');
       }).catch(error=>logger.warn('friend.cloud_new_room_deferred',{
         code:String(error?.code??error?.message??'UNKNOWN').slice(0,65),
       }));
     }
   },onError:e=>logger.warn('friend.cloud_sse_unavailable',{
      code:String(e?.code??e?.message??'UNKNOWN').slice(0,60)})});
   return stream;
 }
 return {
  accountRef:hostAccount.accountRef,inboxId,
  verified:true,phase:'READY_FOR_ORIGINAL_HOST_EVENT_AND_SIGNED_CALLBACK',
  inbound,outbound,processCallback:outbound.process,startOriginalHostEvents,bootstrapRecentIncoming,
  stop:()=>{stream?.close();stream=null},
  status:()=>({inboxId,cloudAccountId:196799,readOnly:false,
   originalHostEventsActive:!!stream,ingress:{...inbound.stats},
   outbound:{...outbound.stats},ack:{...platformAck.stats}}),
 };
}
