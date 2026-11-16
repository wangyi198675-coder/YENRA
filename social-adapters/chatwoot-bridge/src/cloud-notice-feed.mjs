// A single in-memory, read-only presentation feed for the EXISTING verified
// Cloud ingress. No database, polling, Sender, contact store, or provider login.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const valid=n=>Number.isSafeInteger(n)&&n>0;
export function verifiedMessagePreview(text,mediaType){
 // Display only already-verified inbound content. Strip controls/bidi overrides
 // so a contact cannot spoof the Windows toast's identity or layout.
 const cleaned=typeof text==='string'?text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim():'';
 if(cleaned){
   const chars=Array.from(cleaned);
   return chars.slice(0,160).join('')+(chars.length>160?'…':'');
 }
 const kind=typeof mediaType==='string'?mediaType.toLowerCase():'';
 if(/image|photo|jpeg|png|webp|gif/.test(kind))return '收到图片';
 if(/audio|voice|ogg|opus|mp3|aac/.test(kind))return '收到语音消息';
 if(/video|mp4|mov/.test(kind))return '收到视频';
 if(/document|file|pdf|application/.test(kind))return '收到文件';
 if(/sticker/.test(kind))return '收到贴纸';
 return '收到一条新消息';
}
const INBOXES=new Set([155865,155900,155901,155902]);
const isAllowedAvatar=value=>{
 try {
  const u=new URL(value);
  const h=u.hostname.toLowerCase();
  return u.protocol==='https:'&&!u.username&&!u.password&&
   (h==='app.chatwoot.com'||h.endsWith('.amazonaws.com')||
    h.endsWith('.cloudfront.net')||h.endsWith('.chatwoot.com'))
 }catch{return false}
};
export function createYenraCloudNoticeFeed({cloud,logger,now=Date.now,localAppData=process.env.LOCALAPPDATA}={}){
 if(typeof cloud?.getConversation!=='function'||typeof logger?.warn!=='function'||
    typeof localAppData!=='string'||!localAppData)throw Error('CLOUD_NOTICE_OWNER_AUTHORITY_REQUIRED');
 const clients=new Set(),seen=new Set();
 // Hold only a few already-verified presentation frames while Desktop restarts.
 // Purely transient, with no chat history, database, Sender or credential copy.
 const pending=[];const REPLAY_MS=45_000;const MAX_PENDING=20;
 const stats={verified:0,published:0,ignored:0,subscribers:0,queued:0,replayed:0,delivered:0};
 const token=randomBytes(32).toString('hex');
 const tokenPath=join(localAppData,'YENRA','cloud-notice-feed.v1.token');
 mkdirSync(join(localAppData,'YENRA'),{recursive:true});
 writeFileSync(tokenPath,token,{encoding:'utf8',mode:0o600});
 const matchesToken=v=>typeof v==='string'&&v.length===token.length&&
   timingSafeEqual(Buffer.from(v),Buffer.from(token));
 function subscribe(request,response){
  const address=String(request.socket?.remoteAddress??'').replace(/^::ffff:/,'');
  if(request.method!=='GET'||!['127.0.0.1','::1'].includes(address)||
     request.headers.origin||!matchesToken(request.headers['x-yenra-notice-token'])){
   response.writeHead(403,{'cache-control':'no-store'});response.end();return
  }
  response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8',
    'cache-control':'no-store, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
  response.write(': YENRA Cloud verified inbound presentation\n\n');
  clients.add(response);stats.subscribers=clients.size;
  // A verified notice emitted during the brief single-window relaunch must
  // reach the first reconnected Desktop subscriber once, not disappear.
  const moment=now();
  for(const item of pending.splice(0)){
    if(moment-item.publishedAt>REPLAY_MS||Math.abs(moment-item.at)>150_000)continue;
    if(response.destroyed)break;
    try{response.write(item.payload);stats.replayed++;stats.delivered++}catch{break}
  }
  stats.queued=pending.length;
  const pulse=setInterval(()=>{if(!response.destroyed)response.write(': keepalive\n\n')},20000);
  pulse.unref?.();
  const remove=()=>{clearInterval(pulse);clients.delete(response);stats.subscribers=clients.size};
  request.once('close',remove);response.once('close',remove);
 }
 async function publish(source){
  // The caller is the existing signed Page proof or the verified original
  // WA Host MID after successful, confirmed Chatwoot Cloud create.
  const {cloudConversationId,cloudInboxId,cloudContactId,cloudMessageId,occurredAtMs,messageText,mediaType}=source??{};
  if(![cloudConversationId,cloudInboxId,cloudContactId,cloudMessageId].every(valid)||
     !INBOXES.has(cloudInboxId)||!Number.isFinite(occurredAtMs)||
     Math.abs(now()-occurredAtMs)>150000){stats.ignored++;return false}
  const key=cloudInboxId+':'+cloudMessageId;
  if(seen.has(key)){stats.ignored++;return false}
  const conversation=await cloud.getConversation(cloudConversationId);
  const sender=conversation?.meta?.sender??{};
  if(Number(conversation?.id)!==cloudConversationId||
    Number(conversation?.account_id)!==196799||
    Number(conversation?.inbox_id??conversation?.inbox?.id)!==cloudInboxId||
    Number(sender?.id??conversation?.contact_id)!==cloudContactId){
    stats.ignored++;throw Error('CLOUD_NOTICE_CONVERSATION_SCOPE_CHANGED');
  }
  const name=String(sender?.name??'新联系人').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,65)||'新联系人';
  // Cloud can omit a thumbnail from the conversation summary even though the
  // same verified contact has a stored avatar. Reuse Cloud's native contact API
  // only when the summary has no allowable URL; never infer identity by name.
  const avatarOf=c=>[c?.thumbnail,c?.avatar_url,c?.avatar?.url].find(v=>
    typeof v==='string'&&v.length<=2500&&isAllowedAvatar(v))??null;
  let avatarUrl=avatarOf(sender);
  if(!avatarUrl&&typeof cloud.getContactById==='function'){
    try{
      const contact=await cloud.getContactById(cloudContactId,{
        allowPageWithoutIdentifier:cloudInboxId===155865
      });
      if(Number(contact?.id)===cloudContactId)avatarUrl=avatarOf(contact);
    }catch{/* Avatar retrieval must not block the message notification. */}
  }
  const event={accountId:196799,conversationId:cloudConversationId,
    inboxId:cloudInboxId,contactId:cloudContactId,messageId:cloudMessageId,
    contactName:name,avatarUrl,at:occurredAtMs,
    messagePreview:verifiedMessagePreview(messageText,mediaType)};
  seen.add(key);while(seen.size>320)seen.delete(seen.values().next().value);
  stats.verified++;
  const payload='data: '+JSON.stringify(event)+'\n\n';
  let delivered=0;
  for(const response of [...clients]){
    try{if(!response.destroyed){response.write(payload);delivered++}}catch{clients.delete(response)}
  }
  if(delivered===0){
    pending.push({payload,at:occurredAtMs,publishedAt:now()});
    while(pending.length>MAX_PENDING)pending.shift();
  }
  stats.published++;stats.delivered+=delivered;
  stats.queued=pending.length;stats.subscribers=clients.size;
  return true;
 }
 return {subscribe,publish,stats,tokenPath};
}
