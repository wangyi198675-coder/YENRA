/**
 * Narrow anti-entropy for the ORIGINAL authorized WhatsApp rooms.
 * Cloud remains the only chat store and the original DSH SSE remains primary.
 * Native Cloud selection / changed verified Host roster may trigger bounded
 * recent history readback. No second Socket, Sender, history DB or login.
 */
import {stableContactIdentifier,buildHistoricalPageOutgoingMessage} from '../chatwoot-bridge/src/contract.mjs';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
import {readFile} from 'node:fs/promises';
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
 const stats={scans:0,missingIncoming:0,missingOutgoing:0,incoming:0,outgoing:0,already:0,correctedSent:0,correctedIncoming:0,matchedSubmitted:0,ambiguousSubmitted:0,errors:0,mediaSkipped:0};
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
   const validMatches=[];
   for(const m of candidates){
     try{
       const raw=await readFile(join(claimDirectory,'account-196799',String(m.id)+'.jsonl'),'utf8');
       if(raw.length>8192)continue;
       const lines=raw.trim().split('\n').map(s=>JSON.parse(s)),claim=lines[0];
       if(claim?.v!==1||claim.account!==196799||claim.inbox!==selection.cloudInboxId||
         claim.conversationId!==selection.cloudConversationId||claim.messageId!==m.id||
         claim.state!=='CLAIMED_BEFORE_SEND'||
         claim.contentSha256!==createHash('sha256').update(row.text).digest('hex')||
         !lines.some(x=>x.state==='SUBMITTED_UNCONFIRMED'&&
           x.platformMidPresent===true&&
           x.providerMidSha256===createHash('sha256').update(row.mid).digest('hex'))||
         lines.at(-1)?.state==='UNKNOWN_NO_RETRY')continue;
       // The original Host must contain exactly ONE candidate in this room
       // and time window. Identical rapid sends remain ambiguous, not deduped.
       const originals=originalRows.filter(x=>x?.direction==='OUTBOUND'&&
         x.text===row.text&&typeof x.mid==='string'&&
         Number.isFinite(x.timestamp)&&Math.abs(x.timestamp-m.created_at*1000)<=60000);
       if(originals.length!==1||originals[0].mid!==row.mid)continue;
       // Text/time and a legacy SUBMITTED flag can never prove the exact
       // provider MID; only the committed hashed MID above can do so.
       validMatches.push(m);
     }catch{/* Missing claim cannot authorize a new history bubble either. */}
   }
   // Even with no valid proof, there is a plausible pre-existing outgoing:
   // hold for manual reconciliation, never fabricate a second Cloud message.
   return candidates.length===1&&validMatches.length===1?
     {kind:'matched',message:validMatches[0]}:{kind:'ambiguous'};
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
   const summary={scanned:recent.length,incoming:0,outgoing:0,already:0,corrected:0,matchedSubmitted:0,ambiguousSubmitted:0,errors:0,mediaSkipped:0};
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
          // The original Host has the exact outgoing MID and committed claim.
          // Chatwoot's failed webhook state is not proof of platform failure.
          // Repair at most to 'sent'; never invent delivered/read.
          if(claimed.message.status==='failed'){
            await cloud.updateMessageStatus(cid,claimed.message.id,'sent');
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
 return {reconcile,byOriginalRoom,stats,drain:()=>Promise.allSettled([...pending.values()])};
}
