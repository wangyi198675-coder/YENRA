/**
 * P0: Original Host provider ACK -> the SAME verified Chatwoot Cloud message.
 * Reuses native DSH/Messenger receipts; no Sender, second DB or automatic send.
 * Cloud API returns its own status; neither a Cloud 'sent' bubble nor a claim
 * containing only a platform MID *presence* proves delivery or read.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {validateVerifiedAck,verifiedAckStatus} from '../chatwoot-bridge/src/platform-ack.mjs';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';

const valid=x=>Number.isSafeInteger(x)&&x>0;
const outgoing=m=>m?.message_type===1||m?.message_type==='outgoing';
const sha=s=>createHash('sha256').update(s).digest('hex');
const rank=Object.freeze({failed:-1,submitted:0,sent:0,delivered:1,read:2});

async function readCloudRows(cloud,conversationId){
 const found=[],seen=new Set();let before=null;
 for(let page=0;page<12;page++){
  const path=cloud.apiBase+'/conversations/'+conversationId+'/messages'+
    (before===null?'':'?before='+before);
  const batch=listRows(await cloud.request('GET',path));
  if(!Array.isArray(batch)||batch.length>30)throw Error('CLOUD_ACK_MESSAGE_PAGE_INVALID');
  for(const m of batch){
   if(!valid(m?.id))throw Error('CLOUD_ACK_MESSAGE_ID_INVALID');
   if(!seen.has(m.id)){seen.add(m.id);found.push(m)}
  }
  if(batch.length<20)return found;
  const next=Math.min(...batch.map(m=>m.id));
  if(!valid(next)||(before!==null&&next>=before))throw Error('CLOUD_ACK_CURSOR_INVALID');
  before=next;
 }
 throw Error('CLOUD_ACK_HISTORY_BOUNDED_READ_REQUIRED');
}
async function committedClaim({claimDirectory,cloudInboxId,conversationId,message,source,mid}){
 if(!claimDirectory||!valid(message.id)||message.source_id!=null||!source.text||
    message.content!==source.text)return false;
 try{
  const text=await readFile(join(claimDirectory,'account-196799',String(message.id)+'.jsonl'),'utf8');
  if(text.length>8192)return false;
  const lines=text.trim().split('\n').map(s=>JSON.parse(s));
  const first=lines[0];
  return first?.v===1&&first.account===196799&&first.inbox===cloudInboxId&&
    first.conversationId===conversationId&&first.messageId===message.id&&
    first.state==='CLAIMED_BEFORE_SEND'&&first.contentSha256===sha(source.text)&&
    lines.some(x=>x.state==='SUBMITTED_UNCONFIRMED'&&
      x.platformMidPresent===true&&x.providerMidSha256===sha(mid));
 }catch{return false}
}
export function createCloudPlatformAck({host,cloud,roster,scopes,logger,claimDirectory}={}){
 if(!host?.readRoom||cloud?.accountId!==196799||
    cloud?.apiBase!=='/api/v1/accounts/196799'||!cloud?.request||
    !cloud?.getConversation||!cloud?.getContactById||
    !Array.isArray(roster?.accounts)||!Array.isArray(scopes)||!logger?.warn)
   throw Error('CLOUD_ACK_DEPENDENCIES_REQUIRED');
 const stats={seen:0,updated:0,duplicate:0,rejected:0,errors:0};
 // Serialize same original MID; concurrently arriving READ/DELIVERED may
 // otherwise read stale status and apply a late DELIVERED after READ.
 const pendingByOriginalMid=new Map();
 async function handleOnce(ack){
  stats.seen++;
  const reason=validateVerifiedAck(ack);
  if(reason){stats.rejected++;return {ok:false,code:reason}}
  try{
   const owner=roster.accounts.filter(a=>a.accountRef===ack.accountRef&&
     a.channel===ack.channel&&a.rooms?.some(r=>r.roomRef===ack.roomRef));
   const bindings=scopes.filter(s=>s.accountRef===ack.accountRef&&s.channel===ack.channel&&
     valid(s.cloudInboxId)&&s.cloudInboxId!==155865);
   if(owner.length!==1||bindings.length!==1||
      (ack.channel==='Personal'&&bindings[0].cloudInboxId!==155900)||
      (ack.channel==='WhatsApp'&&bindings[0].cloudInboxId===155900))
     return {ok:false,code:'CLOUD_ACK_ORIGINAL_SCOPE_REJECTED'};
   const inboxId=bindings[0].cloudInboxId;
   const original=await host.readRoom({channel:ack.channel,
     accountRef:ack.accountRef,roomRef:ack.roomRef});
   if(original?.accountRef!==ack.accountRef||original?.roomRef!==ack.roomRef||
      !Array.isArray(original.messages))
     return {ok:false,code:'CLOUD_ACK_ORIGINAL_HOST_ROOM_UNAVAILABLE'};
   const sourceMatches=original.messages.filter(m=>
     m?.direction==='OUTBOUND'&&m.mid===ack.mid);
   if(sourceMatches.length!==1)
     return {ok:false,code:'CLOUD_ACK_PLATFORM_MID_NOT_UNIQUE'};
   const source=sourceMatches[0];
   const identifier=stableContactIdentifier(ack.accountRef,ack.roomRef);
   const contact=await cloud.findContactByIdentifier(identifier);
   if(!valid(contact?.id)||contact.identifier!==identifier||
      !contact.contact_inboxes?.some(ci=>
        Number(ci?.inbox?.id??ci?.inbox_id)===inboxId&&ci.source_id===identifier))
     return {ok:false,code:'CLOUD_ACK_CONTACT_SCOPE_REJECTED'};
   const conversations=await cloud.listContactConversations(contact.id);
   const matches=conversations.filter(c=>
     Number(c?.inbox_id??c?.inbox?.id)===inboxId);
   if(matches.length!==1||!valid(matches[0].id))
     return {ok:false,code:'CLOUD_ACK_CONVERSATION_AMBIGUOUS'};
   const cid=matches[0].id,c=await cloud.getConversation(cid);
   if(c?.id!==cid||c.account_id!==196799||
      Number(c.inbox_id??c.inbox?.id)!==inboxId||
      Number(c.meta?.sender?.id??c.contact_id)!==contact.id)
     return {ok:false,code:'CLOUD_ACK_CONVERSATION_CHANGED'};
   const rows=await readCloudRows(cloud,cid);
   const candidates=[];
   for(const m of rows){
    if(!outgoing(m)||m.private===true||
       (valid(Number(m.conversation_id))&&Number(m.conversation_id)!==cid)||
       (valid(Number(m.inbox_id))&&Number(m.inbox_id)!==inboxId))continue;
    if(m.source_id===ack.mid){
      // A genuine original MID in Cloud + exact original Host outgoing proof.
      if(typeof source.text==='string'&&source.text.trim()&&
         !source.nativeMediaType&&source.text!==m.content)continue;
      candidates.push(m);continue;
    }
    // Cloud API outgoing has no source_id. Bind it to the actual original
    // provider MID only through a durable SHA-256 receipt in its one-shot claim.
    if(['WhatsApp','Personal'].includes(ack.channel)&&await committedClaim({
      claimDirectory,cloudInboxId:inboxId,conversationId:cid,
      message:m,source,mid:ack.mid
    }))candidates.push(m);
   }
   if(candidates.length!==1)
     return {ok:false,code:candidates.length?'CLOUD_ACK_MESSAGE_AMBIGUOUS':'CLOUD_ACK_DURABLE_MID_NOT_FOUND'};
   const target=candidates[0],status=verifiedAckStatus(ack);
   if(rank[target.status]!==undefined&&rank[target.status]>=rank[status]){
     stats.duplicate++;return {ok:true,duplicate:true,status:target.status};
   }
   await cloud.updateMessageStatus(cid,target.id,status);
   stats.updated++;
   return {ok:true,updated:true,status,messageId:target.id};
  }catch(e){
   stats.errors++;
   logger.warn('cloud.platform_ack_unavailable',{code:String(e?.code??e?.message??'UNKNOWN').slice(0,82)});
   return {ok:false,code:'CLOUD_ACK_UPDATE_UNCONFIRMED'};
  }
 }
 async function handle(ack){
  const key=[ack?.channel,ack?.accountRef,ack?.roomRef,ack?.mid].join('|');
  const prior=pendingByOriginalMid.get(key)??Promise.resolve();
  const task=prior.catch(()=>{}).then(()=>handleOnce(ack));
  pendingByOriginalMid.set(key,task);
  try{return await task}finally{
   if(pendingByOriginalMid.get(key)===task)pendingByOriginalMid.delete(key);
  }
 }
 return {handle,stats};
}
