import {createHash} from 'node:crypto';
import {buildInboundMessage,parseHostEventRow,stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {postNativeAttachment,MEDIA_TYPES} from '../chatwoot-bridge/src/media-transfer.mjs';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
import {createCloudWhatsAppAvatarSync} from './cloud-whatsapp-avatar-sync.mjs';

const ACTIVE_CHANNELS=new Set(['Personal','WhatsApp']);
const INBOXES=new Set([155900,155901,155902]);
const MAX_SCAN_PAGES=12;
const current=x=>Number.isSafeInteger(x)&&x>0;
function validateScope(roster,scopes,ref,roomRef,allowedInboxIds){
 const a=roster.accounts.find(x=>x.accountRef===ref);
 const b=scopes.find(x=>x.accountRef===ref);
 if(!a||!b||!ACTIVE_CHANNELS.has(a.channel)||b.channel!==a.channel||
    !a.rooms.some(x=>x.roomRef===roomRef)||b.cloudInboxId===155865||
    !(allowedInboxIds instanceof Set)||!allowedInboxIds.has(b.cloudInboxId))
   throw Error('CLOUD_INBOUND_SCOPE_NOT_VERIFIED');
 return {account:a,binding:b,room:a.rooms.find(x=>x.roomRef===roomRef)};
}
export function createCloudInboundProjection({
 host,cloud,roster,scopes,logger,enabledAccountRefs=[],now=Date.now,onVerifiedIncoming,onVerifiedNewRoom,
 allowedInboxIds=INBOXES,
}={}){
 if(!host||!cloud||!Array.isArray(roster?.accounts)||!Array.isArray(scopes)||!logger)
   throw Error('CLOUD_INGRESS_EXISTING_SERVICE_DEPENDENCIES_REQUIRED');
 const enabled=new Set(enabledAccountRefs);
 if(enabled.size!==enabledAccountRefs.length)throw Error('CLOUD_INGRESS_ENABLED_SCOPE_DUPLICATE');
 for(const ref of enabled) {
   const account=roster.accounts.find(x=>x.accountRef===ref);
   if(!account||!ACTIVE_CHANNELS.has(account.channel)||
      scopes.filter(x=>x.accountRef===ref&&x.channel===account.channel&&
        allowedInboxIds instanceof Set&&allowedInboxIds.has(x.cloudInboxId)&&x.cloudInboxId!==155865).length!==1)
       throw Error('CLOUD_INGRESS_CUTOVER_NOT_AUTHORIZED');
 }
 // A newly authorized WhatsApp room can arrive after this Bridge booted.
 // Refresh ONLY after a scope miss, from the same original Host authority;
 // a display name, LID or Cloud webhook cannot create an identity here.
 async function resolveVerifiedScope(accountRef,roomRef){
  try{return validateScope(roster,scopes,accountRef,roomRef,allowedInboxIds)}
  catch(error){if(error?.message!=='CLOUD_INBOUND_SCOPE_NOT_VERIFIED')throw error}
  if(typeof host.readRoster!=='function')throw Error('CLOUD_NEW_CONTACT_HOST_ROSTER_UNAVAILABLE');
  const fresh=await host.readRoster({whatsappOnly:true});
  const currentAccount=roster.accounts.find(a=>a.accountRef===accountRef);
  const authentic=fresh?.accounts?.find(a=>a.accountRef===accountRef);
  if(!currentAccount||!authentic||authentic.channel!==currentAccount.channel||
     !['WhatsApp','Personal'].includes(authentic.channel)||
     !Array.isArray(authentic.rooms))throw Error('CLOUD_NEW_CONTACT_ACCOUNT_NOT_VERIFIED');
  const room=authentic.rooms.find(r=>r.roomRef===roomRef);
  if(!room)throw Error('CLOUD_NEW_CONTACT_ROOM_NOT_VERIFIED');
  if(!currentAccount.rooms.some(r=>r.roomRef===roomRef)){
    currentAccount.rooms.push(room);
    if(Number.isSafeInteger(roster.totalRooms))roster.totalRooms++;
    if(typeof onVerifiedNewRoom==='function')onVerifiedNewRoom({accountRef,roomRef,channel:authentic.channel});
  }
  return validateScope(roster,scopes,accountRef,roomRef,allowedInboxIds);
 }
 const inflight=new Map(),unknown=new Map(),destinations=new Map();
 const phonePending=new Map(),phoneAttempted=new Map();
 const avatarSync=createCloudWhatsAppAvatarSync({host,cloud,logger,now,allowedInboxIds});
 function scheduleVerifiedPhone({contactId,inboxId,accountRef,roomRef,phone}){
  if(!Number.isSafeInteger(contactId)||!allowedInboxIds.has(inboxId)||
     typeof phone!=='string'||!/^\+[1-9][0-9]{6,14}$/u.test(phone))return;
  const key=accountRef+'|'+roomRef;
  if(phonePending.has(key)||now()-(phoneAttempted.get(key)??-Infinity)<3600000)return;
  phoneAttempted.set(key,now());
  if(phoneAttempted.size>600)phoneAttempted.delete(phoneAttempted.keys().next().value);
  const task=Promise.resolve().then(async()=>{
    const identifier=stableContactIdentifier(accountRef,roomRef);
    const contact=await cloud.getContactById(contactId);
    const linked=Array.isArray(contact.contact_inboxes)&&contact.contact_inboxes.some(ci=>
      Number(ci?.inbox?.id??ci?.inbox_id)===inboxId&&ci.source_id===identifier);
    if(contact.identifier!==identifier||!linked)throw Error('WA_PHONE_CONTACT_SCOPE_CONFLICT');
    if(contact.phone_number===phone)return;
    if(contact.phone_number)return; // Never overwrite an existing Cloud number.
    await cloud.request('PUT',cloud.apiBase+'/contacts/'+contactId,{phone_number:phone});
    const after=await cloud.getContactById(contactId);
    if(after.id!==contactId||after.identifier!==identifier||after.phone_number!==phone)
      throw Error('WA_PHONE_PERSISTENCE_UNVERIFIED');
  }).catch(error=>logger.warn('cloud.wa_contact_phone_deferred',{
    code:String(error?.code??error?.message??'UNKNOWN').slice(0,80)
  })).finally(()=>phonePending.delete(key));
  phonePending.set(key,task);
 }
 const stats={seen:0,shadow:0,posted:0,duplicate:0,failed:0,media:0,unknown:0};
 const isOwned=(accountRef)=>enabled.has(accountRef);
 async function destination(row,scope){
  const {account,room,binding}=scope;
  const id=stableContactIdentifier(row.accountRef,row.roomRef);
  let contact=await cloud.findContactByIdentifier(id);
  if(contact && (!Array.isArray(contact.contact_inboxes)||
      !contact.contact_inboxes.some(ci=>Number(ci?.inbox?.id??ci?.inbox_id)===binding.cloudInboxId)))
    throw Error('CLOUD_CONTACT_FOUND_OUTSIDE_EXPECTED_INBOX');
  if(!contact){
    contact=await cloud.createContact({
      name:room.nameKnown&&room.name?.trim()?room.name.trim().slice(0,260):'YENRA contact '+id.slice(-8),
      identifier:id,inboxId:binding.cloudInboxId,sourceId:id});
  }
  if(!current(contact.id))throw Error('CLOUD_CONTACT_ID_INVALID');
  // Original Host phone identity is persisted in native Chatwoot only, never
  // in a second local contact store. It cannot delay inbound MID/ACK.
  if(account.channel==='WhatsApp')scheduleVerifiedPhone({
    contactId:contact.id,inboxId:binding.cloudInboxId,
    accountRef:row.accountRef,roomRef:row.roomRef,phone:room.phoneFallback
  });
  const conversations=await cloud.listContactConversations(contact.id);
  const matches=conversations.filter(c=>Number(c?.inbox_id??c?.inbox?.id)===binding.cloudInboxId);
  let conversation=matches.sort((a,b)=>(b?.last_activity_at??0)-(a?.last_activity_at??0))[0];
  if(!conversation)conversation=await cloud.createConversation({
   inboxId:binding.cloudInboxId,contactId:contact.id,sourceId:id
  });
  const displayId=conversation.id; // Cloud Application API uses global conversation id.
  if(!current(displayId))throw Error('CLOUD_CONVERSATION_ID_INVALID');
  return {contactId:contact.id,displayId,inboxId:binding.cloudInboxId};
 }
 async function alreadyStored(conversationId,mid,{requireAttachment=false}={}) {
  const path=cloud.apiBase+'/conversations/'+conversationId+'/messages';
  let cursor=null;
  for(let i=0;i<MAX_SCAN_PAGES;i++){
    const data=await cloud.request('GET',path+(cursor===null?'':'?before='+cursor));
    const rows=listRows(data);
    if(!Array.isArray(rows)||rows.length>20)throw Error('CLOUD_MESSAGES_LIST_INVALID');
    const exact=rows.filter(x=>x.source_id===mid);
    if(exact.some(x=>x.message_type!==0))throw Error('CLOUD_ORIGINAL_MID_DIRECTION_CONFLICT');
    if(exact.length>1)throw Error('CLOUD_ORIGINAL_MID_DUPLICATE_IN_CLOUD');
    if(exact.length===1){
      // A prior text-only Cloud bubble is NOT successful media delivery.
      // Never create a second bubble with the same original platform MID.
      if(requireAttachment&&(!Array.isArray(exact[0].attachments)||!exact[0].attachments.length))
        throw Error('CLOUD_MEDIA_EXISTING_TEXT_ONLY_MID');
      return true;
    }
    if(rows.length<20)return false;
    const min=Math.min(...rows.map(x=>x.id));
    if(!current(min)||(cursor!==null&&min>=cursor))throw Error('CLOUD_MESSAGE_CURSOR_STUCK');
    cursor=min;
  }
  throw Error('CLOUD_MESSAGE_SEARCH_INCOMPLETE_REFUSE_DUPLICATE');
 }
 async function deliver(row){
  stats.seen++;
  // Only bounded, verified recent-history recovery sets this marker. A real
  // SSE arrival remains live; historical backfill must never raise new alerts.
  const historyImport=row?.historyImport===true;
  const parsed=parseHostEventRow(row);
  if(!parsed.ok)throw Error('CLOUD_HOST_EVENT_'+parsed.reason);
  const original=parsed.row;
  const scope=await resolveVerifiedScope(original.accountRef,original.roomRef);
  if(!enabled.has(original.accountRef))throw Error('CLOUD_INGRESS_NOT_YET_CUT_OVER');
  // Real original Host-owned session check, no other transport/provider authority.
  const hostRoom=await host.readRoom({accountRef:original.accountRef,roomRef:original.roomRef,channel:scope.account.channel});
  if(hostRoom?.accountRef!==original.accountRef||hostRoom?.roomRef!==original.roomRef)
    throw Error('CLOUD_ORIGINAL_HOST_ROOM_SCOPE_MISMATCH');
  const matches=(hostRoom.messages??[]).filter(m=>m.mid===original.mid&&m.direction==='INBOUND');
  if(matches.length!==1||matches[0].text!==original.text)
    throw Error('CLOUD_ORIGINAL_HOST_MID_TEXT_MISMATCH');
  // Original Host room is the authoritative media source. A lost SSE media
  // tag must NOT transform an image/video/voice into a text-only Cloud bubble.
  const source=matches[0];
  const declared=source.nativeMediaType;
  const attached=Array.isArray(source.media)?source.media:[];
  const inferred=attached.length===1?attached[0]?.type:null;
  if((declared!=null&&!MEDIA_TYPES.has(declared))||
     (inferred!=null&&!MEDIA_TYPES.has(inferred))||
     (declared&&inferred&&declared!==inferred))
    throw Error('CLOUD_ORIGINAL_HOST_MEDIA_KIND_INVALID');
  const hostKind=declared??inferred??null;
  if(original.nativeMediaType&&hostKind&&original.nativeMediaType!==hostKind)
    throw Error('CLOUD_SSE_MEDIA_TYPE_CONFLICT_WITH_ORIGINAL');
  const nativeMediaType=hostKind??original.nativeMediaType??null;
  const hasMedia=MEDIA_TYPES.has(nativeMediaType);
  if(!hasMedia&&(source.hasNativeMedia===true||attached.length>0))
    throw Error('CLOUD_ORIGINAL_MEDIA_TYPE_MISSING_REFUSE_TEXT');
  let media=null;
  if(hasMedia){
    // Download exact authorized original bytes BEFORE creating any Cloud
    // message. No text-only downgrade for an attachment-only inbound.
    media=await host.readMedia({channel:scope.account.channel,accountRef:original.accountRef,
      roomRef:original.roomRef,mid:original.mid});
    if(!media?.bytes?.length)throw Error('CLOUD_MEDIA_BYTES_NOT_AVAILABLE');
  }
  const payload=buildInboundMessage({...original,
    ...(hasMedia?{nativeMediaType}:{}),historyImport,now:now()});
  const destKey=original.accountRef+'|'+original.roomRef;
  let destTask=destinations.get(destKey);
  if(!destTask){
    destTask=destination(original,scope);
    destinations.set(destKey,destTask);
    void destTask.finally(()=>{if(destinations.get(destKey)===destTask)destinations.delete(destKey)}).catch(()=>{});
  }
  const target=await destTask;
  // Cloud avatar is a nonblocking native contact update; never delay incoming
  // message creation or duplicate the original WhatsApp profile downloader.
  avatarSync.schedule({channel:scope.account.channel,accountRef:original.accountRef,
    roomRef:original.roomRef,contactId:target.contactId,inboxId:target.inboxId});
  if(await alreadyStored(target.displayId,original.mid,{requireAttachment:hasMedia})){
    stats.duplicate++;return{ok:true,alreadyCloud:true}
  }
  const message=media
    ?await postNativeAttachment(cloud,target.displayId,payload,media)
    :await cloud.createIncomingMessage(target.displayId,payload);
  if(!current(message?.id)||message.source_id!==original.mid||
      message.message_type!==0)
    throw Error('CLOUD_INBOUND_MESSAGE_CONFIRMATION_INVALID');
  stats.posted++;if(media)stats.media++;
  // Notify only AFTER the original MID is persisted and read back by Cloud.
  // Never block the real incoming message or open a parallel Sender.
  if(!historyImport&&typeof onVerifiedIncoming==='function'){
    try{void Promise.resolve(onVerifiedIncoming({cloudInboxId:target.inboxId,
      cloudConversationId:target.displayId,cloudContactId:target.contactId,
      cloudMessageId:message.id,occurredAtMs:original.timestamp,
      messageText:typeof message.content==='string'?message.content:original.text,
      mediaType:hasMedia?original.nativeMediaType:null})).catch(()=>{});
    }catch{/* Notification presentation cannot fail the real incoming message. */}
  }
  return {ok:true,cloudMessageId:message.id,cloudInboxId:target.inboxId};
 }
 function handle(row){
  if(!row||!enabled.has(row.accountRef))return false;
  const k=row.accountRef+'|'+row.roomRef+'|'+row.mid;
  if(unknown.has(k))return true; // unknown network outcome: no blind retry
  if(inflight.has(k))return true;
  const task=deliver(row).catch(err=>{
    stats.failed++;
    if(/NETWORK|TIMEOUT|HTTP_5\d\d|CONFIRMATION/.test(String(err?.message??''))){
      unknown.set(k,now());stats.unknown++;
      while(unknown.size>100)unknown.delete(unknown.keys().next().value);
    }
    logger.warn('cloud.inbound_unavailable',{code:String(err?.message??'UNKNOWN').slice(0,100)});
  }).finally(()=>inflight.delete(k));
  inflight.set(k,task);
  return true;
 }
 // Existing Cloud contacts must not need a fresh incoming message before
 // their verified original WhatsApp phone/avatar can be restored. Reuse the
 // SAME inbound contact-authority and native DSH Host; never create a second
 // contact, conversation, sender or external profile cache.
 function scheduleExistingWhatsAppContact({channel,accountRef,roomRef,cloudContactId,cloudInboxId}={}){
  if(channel!=='WhatsApp'||!enabled.has(accountRef)||!current(cloudContactId))return false;
  let scope;
  try{scope=validateScope(roster,scopes,accountRef,roomRef,allowedInboxIds)}
  catch{return false}
  if(scope.account.channel!=='WhatsApp'||scope.binding.cloudInboxId!==cloudInboxId)return false;
  scheduleVerifiedPhone({contactId:cloudContactId,inboxId:cloudInboxId,accountRef,roomRef,
   phone:scope.room.phoneFallback});
  return avatarSync.schedule({channel,accountRef,roomRef,
   contactId:cloudContactId,inboxId:cloudInboxId});
 }
 const waRosterHydration={scanned:0,matched:0,scheduled:0,missing:0,
   createdContacts:0,createdConversations:0,failed:0};
 let hydrationCursor=0,hydrationBusy=false;
 async function reconcileExistingWhatsAppContacts({batchSize=2}={}){
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>4)
   throw Error('WA_EXISTING_CONTACT_BATCH_INVALID');
  if(hydrationBusy)return {busy:true};
  const entries=roster.accounts.filter(a=>a.channel==='WhatsApp'&&enabled.has(a.accountRef))
   .flatMap(a=>a.rooms.map(r=>({accountRef:a.accountRef,roomRef:r.roomRef})));
  if(!entries.length)return {scanned:0,scheduled:0};
  hydrationBusy=true;
  const count=Math.min(batchSize,entries.length);
  let scheduled=0;
  try{
   for(let i=0;i<count;i++){
    const row=entries[hydrationCursor++%entries.length];
    const scope=validateScope(roster,scopes,row.accountRef,row.roomRef,allowedInboxIds);
    waRosterHydration.scanned++;
    try{
     const identifier=stableContactIdentifier(row.accountRef,row.roomRef);
     let contact=await cloud.findContactByIdentifier(identifier);
     // An old original DSH WhatsApp room with no recent inbound may have
     // no Cloud contact at all. Use the same native createContact authority as
     // the existing inbound path, never create one by name or phone guesses.
     if(!contact){
       if(typeof cloud.createContact!=='function')throw Error('WA_ROSTER_CLOUD_CONTACT_CREATE_UNAVAILABLE');
       const name=scope.room.nameKnown&&scope.room.name?.trim()
        ?scope.room.name.trim().slice(0,260):'YENRA contact '+identifier.slice(-8);
       contact=await cloud.createContact({name,identifier,
         inboxId:scope.binding.cloudInboxId,sourceId:identifier});
       if(!current(contact?.id))throw Error('WA_ROSTER_CONTACT_CREATE_UNCONFIRMED');
       waRosterHydration.createdContacts++;
     }
     // Never trust an API create response or attach a phone/avatar to a
     // contact with a different original account, inbox, or source_id.
     const verified=await cloud.getContactById(contact.id);
     if(!current(verified?.id)||verified.id!==contact.id||
        verified.identifier!==identifier||
        !Array.isArray(verified.contact_inboxes)||
        !verified.contact_inboxes.some(ci=>
          Number(ci?.inbox?.id??ci?.inbox_id)===scope.binding.cloudInboxId&&
          ci.source_id===identifier)){
       waRosterHydration.missing++;continue;
     }
     // Create the single native API-channel conversation only if there is
     // none. This is contact recovery, not a synthetic text message, history
     // import, or a second Sender.
     const existing=await cloud.listContactConversations(verified.id);
     if(!Array.isArray(existing))throw Error('WA_ROSTER_CONVERSATION_LIST_INVALID');
     const linked=existing.filter(cv=>Number(cv.inbox_id??cv.inbox?.id)===scope.binding.cloudInboxId);
     if(linked.length>1)throw Error('WA_ROSTER_CONVERSATION_AMBIGUOUS');
     if(!linked.length){
       if(typeof cloud.createConversation!=='function')throw Error('WA_ROSTER_CLOUD_CONVERSATION_CREATE_UNAVAILABLE');
       const cv=await cloud.createConversation({inboxId:scope.binding.cloudInboxId,
         contactId:verified.id,sourceId:identifier});
       if(!current(cv?.id))throw Error('WA_ROSTER_CONVERSATION_CREATE_UNCONFIRMED');
       waRosterHydration.createdConversations++;
     }
     contact=verified;
     waRosterHydration.matched++;
     if(scheduleExistingWhatsAppContact({channel:'WhatsApp',
       accountRef:row.accountRef,roomRef:row.roomRef,cloudContactId:contact.id,
       cloudInboxId:scope.binding.cloudInboxId})){
      scheduled++;waRosterHydration.scheduled++;
     }
    }catch(error){
     waRosterHydration.failed++;
     logger.warn('cloud.wa_existing_contact_deferred',
       {code:String(error?.code??error?.message??'UNKNOWN').slice(0,80)});
    }
   }
  }finally{hydrationBusy=false}
  return {scanned:count,scheduled};
 }
 return {handle,isOwned,stats,avatarStats:avatarSync.stats,
   waRosterHydration,scheduleExistingWhatsAppContact,reconcileExistingWhatsAppContacts,deliver,
   drain:async()=>{
     await Promise.allSettled([...inflight.values()]);
     return Promise.allSettled([...phonePending.values(),avatarSync.drain()]);
   }};
}
