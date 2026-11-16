/**
 * Narrow anti-entropy for the ORIGINAL authorized WhatsApp rooms.
 * Cloud remains the only chat store and the original DSH SSE remains primary.
 * Native Cloud selection / changed verified Host roster may trigger bounded
 * recent history readback. No second Socket, Sender, history DB or login.
 */
import {stableContactIdentifier,buildHistoricalPageOutgoingMessage} from '../chatwoot-bridge/src/contract.mjs';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
import {readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const valid=x=>Number.isSafeInteger(x)&&x>0;
const MAX_AGE_MS=72*60*60*1000;
const CHANNEL_BY_CLOUD_INBOX=new Map([[155900,'Personal'],[155901,'WhatsApp'],[155902,'WhatsApp']]);
export function createCloudWaRecentSync({host,cloud,roster,scopes,cloudInbound,logger,now=Date.now,claimDirectory=null}={}){
 if(!host?.readRoom||!cloud?.getConversation||!cloud?.request||!cloudInbound?.deliver||
    !Array.isArray(roster?.accounts)||!Array.isArray(scopes)||!logger?.warn)
   throw Error('CLOUD_WA_RECENT_SYNC_DEPENDENCIES_INVALID');
 const pending=new Map(),lastRun=new Map();
 const stats={scans:0,missingIncoming:0,missingOutgoing:0,incoming:0,outgoing:0,already:0,correctedSent:0,correctedIncoming:0,matchedSubmitted:0,recoveredPendingMid:0,ambiguousSubmitted:0,errors:0,mediaSkipped:0};
 // Cloud API-channel messages have no provider MID until original Host readback.
 // A verified durable claim correlates their already-submitted platform MID;
 // importing that Host row again would create a duplicate Cloud bubble.
 async function findClaimedCloudSubmission(row,existing,selection,originalRows){
   // A Cloud API bubble without MID may ALREADY be the original platform send
   // even if Chatwoot says "failed" (e.g. webhook timeout). Treat such rows
   // as possible ownership, never blindly create a second outgoing bubble.
   const candidates=existing.filter(m=>valid(m.id)&&m.message_type===1&&m.private!==true&&
     !m.source_id&&m.content===row.text&&
     ['sent','delivered','read','failed'].includes(m.status)&&
     Number.isFinite(m.created_at)&&Math.abs(m.created_at*1000-row.timestamp)<=60000);
   if(!candidates.length)return {kind:'none'};
   if(typeof claimDirectory!=='string'||!claimDirectory)return {kind:'ambiguous'};
   // A single original platform MID cannot be assigned to two Cloud
   // messages, even when the text and timestamps are identical.
   if(candidates.length!==1)return {kind:'ambiguous'};
   const m=candidates[0];
   const path=join(claimDirectory,'account-196799',String(m.id)+'.jsonl');
   try{
     const raw=await readFile(path,'utf8');
     if(raw.length>8192)return {kind:'ambiguous'};
     const lines=raw.trim().split('\n').map(s=>JSON.parse(s));
     const claim=lines[0],last=lines.at(-1),midHash=createHash('sha256').update(row.mid).digest('hex');
     if(claim?.v!==1||claim.account!==196799||claim.inbox!==selection.cloudInboxId||
       claim.conversationId!==selection.cloudConversationId||claim.messageId!==m.id||
       claim.state!=='CLAIMED_BEFORE_SEND'||
       claim.contentSha256!==createHash('sha256').update(row.text).digest('hex')||
       last?.state==='UNKNOWN_NO_RETRY')return {kind:'ambiguous'};
     // The original authorized Host must contain one and only one exact
     // MID/text matching this Cloud bubble. Never infer from a provider API
     // response, webhook HTTP 200, or a historical unverified claim.
     const originals=originalRows.filter(x=>x?.direction==='OUTBOUND'&&
       x.text===row.text&&typeof x.mid==='string'&&
       Number.isFinite(x.timestamp)&&Math.abs(x.timestamp-m.created_at*1000)<=60000);
     if(originals.length!==1||originals[0].mid!==row.mid)return {kind:'ambiguous'};
     if(lines.some(x=>x.state==='SUBMITTED_UNCONFIRMED'&&
       x.platformMidPresent===true&&x.providerMidSha256===midHash))
       return {kind:'matched',message:m};
     // V18 could submit successfully but return no MID before the original
     // Socket outbox populated. Reconcile only the explicit, scoped,
     // transport-accepted MID_PENDING claim. NEVER recover UNKNOWN_NO_RETRY
     // or match a different-contact/Sender record.
     if(selection.channel!=='WhatsApp'||last?.state!=='TRANSPORT_SUBMITTED_MID_PENDING'||
       last.transportAccepted!==true||last.platformMidPresent!==false||
       !Number.isFinite(claim.at)||!Number.isFinite(last.at)||last.at<claim.at||
       row.timestamp<claim.at-5000||row.timestamp>last.at+90000)
       return {kind:'ambiguous'};
     // A second original outbound of ANY text in this transport window
     // prevents assuming which provider MID belongs to the Cloud message.
     const overlapping=originalRows.filter(x=>x?.direction==='OUTBOUND'&&
       typeof x.mid==='string'&&Number.isFinite(x.timestamp)&&
       x.timestamp>=claim.at-5000&&x.timestamp<=last.at+90000);
     if(overlapping.length!==1||overlapping[0].mid!==row.mid)
       return {kind:'ambiguous'};
     const durable={state:'SUBMITTED_UNCONFIRMED',
       transportAccepted:true,platformMidPresent:true,providerMidSha256:midHash,
       recoveredVia:'ONE_ORIGINAL_HOST_ROOM_MID',at:now()};
     await appendFile(path,JSON.stringify(durable)+'\n');
     const verified=(await readFile(path,'utf8')).trim().split('\n').at(-1);
     const tail=JSON.parse(verified);
     if(tail?.state!==durable.state||tail?.providerMidSha256!==midHash)
       return {kind:'ambiguous'};
     stats.recoveredPendingMid++;
     return {kind:'matched',message:m,recoveredPendingMid:true};
   }catch(error){
     // Disk error or missing original claim: no silent status patch, no
     // duplicate history message and above all no automatic platform resend.
     logger.warn('wa.recent_pending_mid_not_verified',
       {code:String(error?.code??error?.message??'UNKNOWN').slice(0,64)});
   }
   return {kind:'ambiguous'};
 }
 function authenticated(selection){
   if(!selection||selection.cloudAccountId!==196799||!valid(selection.cloudConversationId)||
      !CHANNEL_BY_CLOUD_INBOX.has(selection.cloudInboxId)||
      selection.channel!==CHANNEL_BY_CLOUD_INBOX.get(selection.cloudInboxId))
     throw Error('CLOUD_API_RECENT_SELECTION_INVALID');
   const a=roster.accounts.find(x=>x.accountRef===selection.accountRef&&x.channel===selection.channel);
   const b=scopes.find(x=>x.accountRef===selection.accountRef&&x.cloudInboxId===selection.cloudInboxId&&x.channel===selection.channel);
   if(!a||!b||!a.rooms.some(x=>x.roomRef===selection.roomRef))throw Error('CLOUD_WA_RECENT_SCOPE_NOT_VERIFIED');
   return a;
 }
 async function listNativeMessages(id){
   const found=[],ids=new Set();let before=null;
   for(let i=0;i<8;i++){
    const raw=await cloud.request('GET',cloud.apiBase+'/conversations/'+id+'/messages'+(before?'?before='+before:''));
    const batch=listRows(raw);
    if(!Array.isArray(batch)||batch.length>30)throw Error('CLOUD_WA_NATIVE_LIST_INVALID');
    for(const row of batch){if(valid(row.id)&&!ids.has(row.id)){ids.add(row.id);found.push(row)}}
    if(batch.length<20)return found;
    const cursor=Math.min(...batch.map(x=>x.id));
    if(!valid(cursor)||(before!==null&&cursor>=before))throw Error('CLOUD_WA_NATIVE_CURSOR_INVALID');
    before=cursor;
   }
   throw Error('CLOUD_WA_NATIVE_HISTORY_CURSOR_EXHAUSTED');
 }
 async function run(selection){
   const account=authenticated(selection);
   const cid=selection.cloudConversationId;
   const c=await cloud.getConversation(cid);
   if(c?.id!==cid||c.account_id!==196799||
      Number(c.inbox_id??c.inbox?.id)!==selection.cloudInboxId||
      Number(c.meta?.sender?.id??c.contact_id)!==selection.cloudContactId)
     throw Error('CLOUD_WA_RECENT_CONVERSATION_CHANGED');
   const contact=await cloud.getContactById(selection.cloudContactId);
   const identifier=stableContactIdentifier(selection.accountRef,selection.roomRef);
   if(contact?.identifier!==identifier||!contact.contact_inboxes?.some(ci=>
     Number(ci?.inbox?.id??ci?.inbox_id)===selection.cloudInboxId&&ci.source_id===identifier))
     throw Error('CLOUD_WA_RECENT_CONTACT_CHANGED');
   const original=await host.readRoom({accountRef:selection.accountRef,roomRef:selection.roomRef,channel:selection.channel});
   if(original?.accountRef!==selection.accountRef||original?.roomRef!==selection.roomRef||
      !Array.isArray(original.messages))throw Error('CLOUD_WA_RECENT_VERIFIED_HOST_ROOM_UNAVAILABLE');
   const existing=await listNativeMessages(cid),nativeByMid=new Map(existing.filter(m=>typeof m.source_id==='string').map(m=>[m.source_id,m]));
   const cutoff=now()-MAX_AGE_MS;
   const recent=original.messages.filter(m=>['INBOUND','OUTBOUND'].includes(m?.direction)&&
     Number.isFinite(m.timestamp)&&m.timestamp>=cutoff&&m.timestamp<=now()+300000&&
     typeof m.mid==='string'&&typeof m.text==='string').slice(-40);
   const summary={scanned:recent.length,incoming:0,outgoing:0,already:0,corrected:0,matchedSubmitted:0,recoveredPendingMid:0,ambiguousSubmitted:0,errors:0,mediaSkipped:0};
   stats.scans++;
   const claimedCloudIdsSeen=new Set();
   for(const row of recent){
    const current=nativeByMid.get(row.mid);
    if(current){
      summary.already++;stats.already++;
      // These rows were sent on WhatsApp BEFORE Cloud import. A missing
      // Cloud callback is not evidence of provider failure.
      if(row.direction==='OUTBOUND'&&current.message_type===1&&
         current.status==='failed'&&current.content_attributes?.yenra_history_import===true&&
         current.content===row.text){
        try{await cloud.updateMessageStatus(cid,current.id,'sent');summary.corrected++;stats.correctedSent++}
        catch(e){logger.warn('wa.recent_status_not_updated',{code:e?.code??'UNKNOWN'})}
      }
      // Cloud API Channel can mark a previously imported incoming MID as
      // "failed" if its callback times out. That is not a platform-send
      // failure: the one original Host already RECEIVED this exact MID.
      // Correct only a verified, historical, non-private incoming with exact
      // Host room, MID, direction and content. Never touch pending outbounds.
      if(row.direction==='INBOUND'&&current.message_type===0&&
         current.private!==true&&current.status==='failed'&&
         current.source_id===row.mid&&row.text.trim()&&current.content===row.text&&
         current.content_attributes?.yenra_history_import===true&&
         current.content_attributes?.yenra_original_platform_mid===row.mid){
        try{await cloud.updateMessageStatus(cid,current.id,'sent');summary.corrected++;stats.correctedIncoming++}
        catch(e){logger.warn('wa.recent_inbound_status_not_updated',{code:e?.code??'UNKNOWN'})}
      }
      continue;
    }
    const nativeMedia=['image','video','audio','file'].includes(row.nativeMediaType);
    const mediaRefs=Array.isArray(row.media)&&row.media.length>0;
    // Original INBOUND media can be recovered via the one authorized Host
    // media read and a single Cloud attachment, as verified historical data.
    // OUTBOUND media has no authorized Cloud -> platform media Sender; skip.
    if((row.direction==='OUTBOUND'&&(nativeMedia||mediaRefs))||
       (mediaRefs&&!nativeMedia)||row.text.length>4000||
       (!row.text.trim()&&!nativeMedia)){
      summary.mediaSkipped++;stats.mediaSkipped++;continue;
    }
    try{
      if(row.direction==='INBOUND'){
        stats.missingIncoming++;
        // On-demand bounded recovery is historical, even when recent. Do not
        // raise a fresh unread/Toast alert for an old original-platform MID.
        const imported=await cloudInbound.deliver({...row,historyImport:true,
          accountRef:selection.accountRef,roomRef:selection.roomRef});
        if(imported?.ok!==true)throw Error('CLOUD_WA_RECENT_INBOUND_NOT_CONFIRMED');
        stats.incoming++;summary.incoming++;
      }else{
        const claimed=await findClaimedCloudSubmission(row,existing,selection,original.messages);
        if(claimed.kind==='matched'&&claimedCloudIdsSeen.has(claimed.message.id)){
          stats.ambiguousSubmitted++;summary.ambiguousSubmitted++;
          logger.warn('wa.recent_submitted_claim_reused');
          continue;
        }
        if(claimed.kind==='matched'){
          claimedCloudIdsSeen.add(claimed.message.id);
          if(claimed.recoveredPendingMid)summary.recoveredPendingMid++;
          // The original Host has the exact outgoing MID and committed claim.
          // Chatwoot's failed webhook state is not proof of platform failure.
          // Repair at most to 'sent'; never invent delivered/read.
          if(claimed.message.status==='failed'){
            await cloud.updateMessageStatus(cid,claimed.message.id,'sent');
            // A successful PATCH/HTTP 200 alone does not prove durable Cloud
            // status. Re-read the same Cloud message; if it is still red the
            // sync remains failed and later owner-controlled recovery can
            // retry the STATUS ONLY, never resend via platform Socket.
            const confirmed=await listNativeMessages(cid);
            const exact=confirmed.filter(m=>m.id===claimed.message.id);
            if(exact.length!==1||!['sent','delivered','read'].includes(exact[0].status))
              throw Error('CLOUD_WA_SENT_STATUS_PERSISTENCE_UNVERIFIED');
            summary.corrected++;stats.correctedSent++;
          }
          nativeByMid.set(row.mid,claimed.message);
          stats.matchedSubmitted++;summary.matchedSubmitted++;
          continue;
        }
        if(claimed.kind==='ambiguous'){
          // Identical rapid sends: do not guess a relationship or import twice.
          stats.ambiguousSubmitted++;summary.ambiguousSubmitted++;
          logger.warn('wa.recent_submitted_identity_ambiguous');
          continue;
        }
        stats.missingOutgoing++;
        const payload=buildHistoricalPageOutgoingMessage({...row,accountRef:selection.accountRef,roomRef:selection.roomRef},{now:now()});
        if(payload.source_id!==row.mid||payload.content_attributes?.yenra_history_import!==true)
          throw Error('CLOUD_WA_HISTORY_PAYLOAD_NOT_SAFE');
        const raw=await cloud.createHistoricalOutgoingMessage(cid,payload),m=raw?.payload??raw;
        if(!valid(m.id)||![1,'outgoing'].includes(m.message_type)||m.source_id!==row.mid)
          throw Error('CLOUD_WA_HISTORY_MESSAGE_NOT_CONFIRMED');
        // This is a prior original platform outgoing MID; patch the display
        // state to sent, NEVER claim delivered/read or resubmit to the Sender.
        if(m.status==='failed'){await cloud.updateMessageStatus(cid,m.id,'sent').catch(()=>{})}
        stats.outgoing++;summary.outgoing++;
      }
      nativeByMid.set(row.mid,{id:1,source_id:row.mid});
    }catch(e){
      // On unknown Cloud network results refuse automatic replay of this
      // exact MID until a later fresh Cloud readback proves it absent.
      stats.errors++;summary.errors++;
      logger.warn('wa.recent_sync_failed',{code:String(e?.code??e?.message??'UNKNOWN').slice(0,90)});
      break;
    }
   }
   return {ok:summary.errors===0,...summary};
 }
 // Owner-only status repair for a single proven failed Cloud outbound.
 // Reuses exactly the same original-Host claim binding as live anti-entropy;
 // unlike full recent sync it NEVER imports any historical messages.
 async function repairExactFailedOutgoing({selection,cloudMessageId}={}){
   const account=authenticated(selection);
   if(account.channel!=='WhatsApp'||!valid(cloudMessageId)||
      ![155901,155902].includes(selection.cloudInboxId))
     throw Error('CLOUD_WA_EXACT_REPAIR_SCOPE_INVALID');
   const cid=selection.cloudConversationId;
   const conversation=await cloud.getConversation(cid);
   if(conversation?.id!==cid||conversation.account_id!==196799||
      Number(conversation.inbox_id??conversation.inbox?.id)!==selection.cloudInboxId||
      Number(conversation.meta?.sender?.id??conversation.contact_id)!==selection.cloudContactId)
     throw Error('CLOUD_WA_EXACT_REPAIR_CONVERSATION_CHANGED');
   const contact=await cloud.getContactById(selection.cloudContactId);
   const identifier=stableContactIdentifier(selection.accountRef,selection.roomRef);
   if(contact?.identifier!==identifier||
      !contact.contact_inboxes?.some(ci=>
        Number(ci?.inbox?.id??ci?.inbox_id)===selection.cloudInboxId&&
        ci.source_id===identifier))
     throw Error('CLOUD_WA_EXACT_REPAIR_CONTACT_CHANGED');
   const cloudRows=await listNativeMessages(cid);
   const match=cloudRows.filter(m=>m?.id===cloudMessageId);
   if(match.length!==1||match[0].message_type!==1||match[0].private===true||
      match[0].source_id!=null||typeof match[0].content!=='string')
     throw Error('CLOUD_WA_EXACT_REPAIR_MESSAGE_NOT_AUTHORIZED');
   if(match[0].status!=='failed')
     return {ok:true,unchanged:true,status:match[0].status};
   const original=await host.readRoom({channel:'WhatsApp',
     accountRef:selection.accountRef,roomRef:selection.roomRef});
   if(original?.accountRef!==selection.accountRef||original?.roomRef!==selection.roomRef||
      !Array.isArray(original.messages))
     throw Error('CLOUD_WA_EXACT_REPAIR_HOST_ROOM_UNAVAILABLE');
   const source=original.messages.filter(m=>m?.direction==='OUTBOUND'&&
     typeof m.mid==='string'&&m.text===match[0].content&&
     Number.isFinite(m.timestamp)&&Number.isFinite(match[0].created_at)&&
     Math.abs(m.timestamp-match[0].created_at*1000)<=60000);
   if(source.length!==1)
     throw Error('CLOUD_WA_EXACT_REPAIR_ORIGINAL_MID_AMBIGUOUS');
   const claimed=await findClaimedCloudSubmission(
     source[0],cloudRows,selection,original.messages);
   if(claimed.kind!=='matched'||claimed.message?.id!==cloudMessageId)
     throw Error('CLOUD_WA_EXACT_REPAIR_DURABLE_CLAIM_NOT_VERIFIED');
   await cloud.updateMessageStatus(cid,cloudMessageId,'sent');
   const after=await listNativeMessages(cid);
   const verified=after.filter(m=>m.id===cloudMessageId);
   if(verified.length!==1||!['sent','delivered','read'].includes(verified[0].status))
     throw Error('CLOUD_WA_EXACT_REPAIR_STATUS_NOT_PERSISTED');
   stats.correctedSent++;
   return {ok:true,corrected:true,status:verified[0].status,
     recoveredPendingMid:claimed.recoveredPendingMid===true,
     // No provider MID or contact identifiers are ever returned.
     providerMidBound:true,platformSenderInvoked:false};
 }
 async function reconcile(selection,{force=false}={}){
   const account=authenticated(selection),key=selection.accountRef+'|'+selection.roomRef;
   if(pending.has(key))return pending.get(key);
   if(!force&&now()-(lastRun.get(key)??0)<12000)return {ok:true,skippedCooldown:true};
   lastRun.set(key,now());
   const task=run(selection);
   pending.set(key,task);
   try{return await task}finally{if(pending.get(key)===task)pending.delete(key)}
 }
 async function byOriginalRoom({accountRef,roomRef}={}){
   const account=roster.accounts.find(a=>['WhatsApp','Personal'].includes(a.channel)&&
     a.accountRef===accountRef&&a.rooms.some(r=>r.roomRef===roomRef));
   const binding=scopes.find(s=>s.channel===account?.channel&&s.accountRef===accountRef&&
     CHANNEL_BY_CLOUD_INBOX.get(s.cloudInboxId)===account.channel);
   if(!account||!binding)throw Error('CLOUD_WA_RECENT_ORIGINAL_ROOM_NOT_VERIFIED');
   const identifier=stableContactIdentifier(accountRef,roomRef);
   const contact=await cloud.findContactByIdentifier(identifier);
   if(!contact)return {ok:true,noCloudContactYet:true};
   const list=await cloud.listContactConversations(contact.id);
   const matching=list.filter(c=>Number(c.inbox_id??c.inbox?.id)===binding.cloudInboxId);
   if(matching.length!==1)return {ok:true,unresolvedConversation:true};
   return reconcile({cloudAccountId:196799,cloudInboxId:binding.cloudInboxId,
     cloudConversationId:matching[0].id,cloudContactId:contact.id,channel:account.channel,accountRef,roomRef});
 }
 return {reconcile,byOriginalRoom,repairExactFailedOutgoing,stats,
   drain:()=>Promise.allSettled([...pending.values()])};
}
