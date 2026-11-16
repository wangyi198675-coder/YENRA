/** YENRA original DSH-IM inbox read projection and a user-triggered
 * manual-send bridge through the SAME mature DSH-IM Sender.
 * Account, recipient JID, inbox path and credentials remain Host-side.
 * No second Sender, Socket, message database, web server or cache.
 */
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {getSavedWhatsAppManualContact} from './whatsapp-contact-prefs-commands.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'

const PREFIX='YENRA_SOCIAL_V1:'
const SEND_PREFIX='YENRA_SOCIAL_SEND_V1:'
import {isTrustedNativeWorkspace} from './trusted-native-workspace.ts'
const REF=/^[a-f0-9]{32}$/
const BOT_ID=/^[A-Za-z0-9_-]{1,128}$/
const JID=/^(?:[0-9]{5,32}@(s\.whatsapp\.net|lid)|[0-9]{5,32}-[0-9]{1,20}@g\.us)$/
const normalize=(v:string|undefined)=>(v??'').replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase()
const fingerprint=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,32)
export const accountRef=(botId:string)=>fingerprint('WA-account:'+botId)
export const roomRef=(botId:string,jid:string)=>fingerprint('WA-room:'+botId+'\0'+jid)
const reject=(s:string)=>({kind:'error' as const,text:s})
const ok=(value:unknown)=>({kind:'success' as const,text:PREFIX+JSON.stringify(value)})
type ImService={listBots():Promise<Array<{botId:string;channel:string}>>;
 /** Read the existing DSH-IM registered Socket, not its retired HTTP management route. */
 whatsappCurrentlyAuthorized?:(botId:string)=>Promise<boolean>;
 availableInboxMedia?:(botId:string,jid:string,ids:string[])=>Promise<string[]>;
 readInboxMedia?:(botId:string,jid:string,mid:string,options?:{signal?:AbortSignal})=>Promise<{type:string;mime:string;bytes:Buffer}>;
 readOwnAccountIdentity?:(botId:string)=>Promise<{displayName:string|null;ownPhone:string|null}|null>;
 readOwnAccountAvatarUrl?:(botId:string)=>Promise<string|null>;
 readContactAvatarUrl?:(botId:string,jid:string)=>Promise<string|null>;
 manualSendMedia?:(botId:string,target:{kind:'user'|'group';route:{jid:string}},media:{kind:'image'|'document';mime:string;fileName:string;bytes:Buffer;requestId:string},options?:{signal?:AbortSignal})=>Promise<{submitted:boolean;deliveryStatus:string;providerMessageId:string|null}>;
 manualSend?:(botId:string,route:{kind:'user'|'group';route:{jid:string}},text:string,options?:{signal?:AbortSignal})=>Promise<{submitted:boolean;deliveryStatus:string;providerMessageId:string|null}>;
 reactToOriginalInboxMessage?:(botId:string,message:{jid:string;mid:string;direction:'INBOUND'|'OUTBOUND';emoji:string},options?:{signal?:AbortSignal})=>Promise<{submitted:boolean;deliveryStatus:string}>}
type InboxMessage={id:string;text:string;direction:'INBOUND'|'OUTBOUND';timestamp:number;
 nativeMediaType?:string;mimeType?:string;
 verifiedDeliveryStatus?:'DELIVERED'|'READ';
 verifiedAckKind?:'DELIVERED'|'READ'|'PLAYED';
 verifiedAckSource?:'ORIGINAL_DSH_IM_SINGLE_SOCKET_VERIFIED';
 verifiedAckObservedAt?:number}
type InboxChat={jid:string;name:string;phoneFallback?:string;timestamp:number;messages:InboxMessage[]}
type Inbox={updatedAt:string|null;chats:InboxChat[]}
function safeMessage(value:unknown):value is InboxMessage{
 if(!value||typeof value!=='object')return false
 const v=value as Record<string,unknown>
 return typeof v.id==='string'&&v.id.length>0&&v.id.length<=180&&
   typeof v.text==='string'&&['INBOUND','OUTBOUND'].includes(String(v.direction))&&
   Number.isFinite(v.timestamp)&&Number(v.timestamp)>=0
}
export async function currentBots(service:ImService){
 const bots=await service.listBots()
 if(!Array.isArray(bots))throw Error('原生 IM 服务没有返回有效账号列表')
 return bots.filter(b=>b.channel==='whatsapp'&&BOT_ID.test(b.botId)).slice(0,12)
}
/** Direct original DSH-IM Socket authorization, scoped to server-registered bots.
 * No botId, raw JID, credentials or guessed online status leave the Host.
 */
export async function readOriginalWhatsAppSocketStatuses(service:ImService){
 if(typeof service.whatsappCurrentlyAuthorized!=='function')
  throw Error('ORIGINAL_DSH_IM_SOCKET_STATUS_CAPABILITY_UNAVAILABLE')
 const bots=await currentBots(service)
 return Promise.all(bots.map(async bot=>{
  const ref=accountRef(bot.botId)
  try{
   const connected=await service.whatsappCurrentlyAuthorized!(bot.botId)
   return {accountRef:ref,connected:connected===true,
    state:connected===true?'connected' as const:'offline' as const}
  }catch{
   return {accountRef:ref,connected:false,state:'unknown' as const}
  }
 }))
}
export async function readInbox(botId:string):Promise<Inbox>{
 // Reuse mature DSH-IM's own DSH_HOME / ~/.dsh resolution in packaged Electron.
 // Only original Host-listed bot IDs can reach these same official inbox files.
 const home=process.env.DSH_HOME || join(homedir(),'.dsh')
 const file=join(home,'integrations','dsh-whatsapp','bots',botId,'inbox.json')
 let value:unknown
 try{value=JSON.parse(await readFile(file,'utf8'))}
 catch(e){if((e as NodeJS.ErrnoException)?.code==='ENOENT')return {updatedAt:null,chats:[]};throw e}
 if(!value||typeof value!=='object')throw Error('成熟 WhatsApp 收件箱文件结构无效')
 const source=value as {updatedAt?:unknown;chats?:unknown}
 const seen=new Set<string>()
 const chats:InboxChat[]=[]
 for(const row of Array.isArray(source.chats)?source.chats.slice(0,500):[]){
  if(!row||typeof row!=='object')continue
  const c=row as Record<string,unknown>
  if(typeof c.jid!=='string'||!JID.test(c.jid)||seen.has(c.jid))continue
  seen.add(c.jid)
  const messages=Array.isArray(c.messages)?c.messages.filter(safeMessage).slice(-50).map(m=>({
   id:m.id,text:m.text.slice(0,4000),direction:m.direction,timestamp:m.timestamp,
   // Persisted only by the original DSH-IM inbox after its live Baileys
   // verifier matched this OUTBOUND MID and exact JID. No synthetic ACK.
   ...(m.direction==='OUTBOUND'&&
      m.verifiedAckSource==='ORIGINAL_DSH_IM_SINGLE_SOCKET_VERIFIED'&&
      ['DELIVERED','READ'].includes(String(m.verifiedDeliveryStatus))&&
      ['DELIVERED','READ','PLAYED'].includes(String(m.verifiedAckKind))&&
      (m.verifiedDeliveryStatus!=='READ'||
        m.verifiedAckKind==='READ'||(m.verifiedAckKind==='PLAYED'&&
        m.nativeMediaType==='audio'))?{
      verifiedDeliveryStatus:m.verifiedDeliveryStatus,
      verifiedAckKind:m.verifiedAckKind,
      verifiedAckSource:m.verifiedAckSource,
      ...(Number.isSafeInteger(m.verifiedAckObservedAt)&&
          Number(m.verifiedAckObservedAt)>0?
          {verifiedAckObservedAt:m.verifiedAckObservedAt}:{})}:{}),
   ...(['image','video','audio','file'].includes(String(m.nativeMediaType))?{
    nativeMediaType:m.nativeMediaType,
    mimeType:typeof m.mimeType==='string'?m.mimeType.slice(0,120):''}:{}),
  })):[]
  chats.push({jid:c.jid,name:typeof c.name==='string'?c.name.slice(0,100):'',
   ...(typeof c.phoneFallback==='string'&&/^\+\d{5,15}$/.test(c.phoneFallback)
        ?{phoneFallback:c.phoneFallback}:{}),
   timestamp:Number.isFinite(c.timestamp)?Number(c.timestamp):0,messages})
 }
 chats.sort((a,b)=>b.timestamp-a.timestamp)
 return {updatedAt:typeof source.updatedAt==='string'?source.updatedAt:null,chats}
}
function readRequest(raw:string):{accountRef:string;roomRef:string}{
 if(raw.length>512)throw Error('只读会话请求过长')
 const value:unknown=JSON.parse(raw)
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效的会话请求')
 const v=value as Record<string,unknown>
 if(Object.keys(v).length!==2||typeof v.accountRef!=='string'||typeof v.roomRef!=='string'||
    !/^[a-f0-9]{32}$/.test(v.accountRef)||!/^[a-f0-9]{32}$/.test(v.roomRef))
  throw Error('只接受已返回的账号与会话引用')
 return {accountRef:v.accountRef,roomRef:v.roomRef}
}
function readManualMedia(raw:string){
 if(typeof raw!=='string'||raw.length>11_300_000||raw.length<40)
  throw Error('WHATSAPP_MEDIA_REQUEST_TOO_LARGE');
 const value:unknown=JSON.parse(raw);
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('WHATSAPP_MEDIA_REQUEST_INVALID');
 const q=value as Record<string,unknown>;
 if(Object.keys(q).sort().join('|')!=='accountRef|fileName|media|mediaType|mimeType|roomRef'||
    typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
    typeof q.roomRef!=='string'||!REF.test(q.roomRef)||
    typeof q.media!=='string'||typeof q.mediaType!=='string'||
    typeof q.mimeType!=='string'||typeof q.fileName!=='string')
  throw Error('WHATSAPP_MEDIA_ACCOUNT_OR_INPUT_INVALID');
 if(!['image','document'].includes(q.mediaType))
  throw Error('WHATSAPP_VIDEO_VOICE_MANUAL_SEND_UNVERIFIED_KEEP_DRAFT');
 const mime=q.mimeType.toLowerCase();
 const images=['image/jpeg','image/png','image/webp','image/gif'];
 const docs=['application/pdf','text/plain','audio/mpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
 if(q.mediaType==='image'?!images.includes(mime):!docs.includes(mime))
  throw Error('ORIGINAL_WHATSAPP_MEDIA_MIME_UNSUPPORTED');
 if(q.fileName.length<3||q.fileName.length>140||
   /[\\/\x00-\x1f\x7f]/.test(q.fileName)||q.fileName.includes('..'))
  throw Error('WHATSAPP_MEDIA_FILENAME_INVALID');
 const base64=q.media;
 if(!base64||base64.length>Math.ceil(8*1024*1024*4/3)+4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||base64.length%4)
  throw Error('WHATSAPP_MEDIA_BASE64_INVALID');
 const bytes=Buffer.from(base64,'base64');
 if(!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64')!==base64)
  throw Error('WHATSAPP_MEDIA_BYTES_INVALID');
 const valid=mime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):
  mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
  mime==='image/webp'?bytes.subarray(0,4).toString('ascii')==='RIFF'&&
    bytes.subarray(8,12).toString('ascii')==='WEBP':
  mime==='image/gif'?['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)):
  mime==='application/pdf'?bytes.subarray(0,5).toString('ascii')==='%PDF-':
  mime==='text/plain'?!bytes.includes(0):
  // MP3 is sent via the ORIGINAL DSH-IM file/document method, never PTT.
  mime==='audio/mpeg'?/\.mp3$/i.test(q.fileName)&&
    (bytes.subarray(0,3).toString('ascii')==='ID3'||
      (bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)):
  bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]));
 if(!valid)throw Error('WHATSAPP_MEDIA_SIGNATURE_INVALID');
 return {accountRef:q.accountRef,roomRef:q.roomRef,
  kind:q.mediaType as 'image'|'document',mime,fileName:q.fileName,bytes};
}
function readManualSend(raw:string):{accountRef:string;roomRef:string;text:string}{
 if(raw.length>4800)throw Error('发送文本超出单条限制')
 const v:unknown=JSON.parse(raw)
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('无效的手动发送请求')
 const x=v as Record<string,unknown>
 if(Object.keys(x).length!==3||typeof x.accountRef!=='string'||typeof x.roomRef!=='string'||
  !/^[a-f0-9]{32}$/.test(x.accountRef)||!/^[a-f0-9]{32}$/.test(x.roomRef)||
  typeof x.text!=='string'||!x.text.trim()||x.text.length>4000)throw Error('发送参数未通过账号、会话与文本验证')
 return {accountRef:x.accountRef,roomRef:x.roomRef,text:x.text}
}
/* Single verified read projection shared by native DSH Commands and the
 * existing Host WebServer. Passive inbox reads must not enter Brain Session. */
async function readSocialRoster(bots:Array<{botId:string;channel:string}>,service?:ImService){
 const accounts=[]
 for(const bot of bots){
  const inbox=await readInbox(bot.botId)
  accounts.push({channel:'WhatsApp',accountRef:accountRef(bot.botId),
    mediaSendSupported:typeof service?.manualSendMedia==='function',
   source:'DSH_IM_EXISTING_INBOX',readOnly:true,canSend:false,
   updatedAt:inbox.updatedAt,
   rooms:inbox.chats.map(c=>({
    roomRef:roomRef(bot.botId,c.jid),name:c.name||null,
    nameKnown:Boolean(c.name),
    ...(c.phoneFallback?{phoneFallback:c.phoneFallback}:{}),providerPeerKind:c.jid.endsWith('@lid')?'lid':
     c.jid.endsWith('@g.us')?'group':'number',
    lastMessageAt:c.timestamp||null,messageCount:c.messages.length,
    latestText:c.messages.at(-1)?.text.slice(0,240)??null,
    // Exact original MID and source text, not an invented "preview" ID.
    // Used only by the existing DSH translation route's Host verification.
    ...(c.messages.at(-1)?.text && c.messages.at(-1)!.text.length<=1200
      ?{latestMessageId:c.messages.at(-1)!.id,
        latestMessageSource:c.messages.at(-1)!.text}:{}),
   }))})
 }
 return {schema:1,readOnly:true,partial:true,source:'DSH_IM_EXISTING_INBOX',
  accounts,configuredBotCount:bots.length,canSend:false}
}
export async function readSocialRoom(ctx:Context,service:ImService,bots:Array<{botId:string;channel:string}>,request:{accountRef:string;roomRef:string}){
 const bot=bots.find(b=>accountRef(b.botId)===request.accountRef)
 if(!bot)throw Error('账号已失效或未经当前 Host 认证')
 const inbox=await readInbox(bot.botId)
 const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===request.roomRef)
 if(!room){
  const local=await getSavedWhatsAppManualContact(ctx,bot.botId,request.accountRef,request.roomRef)
  if(!local)throw Error('此账号中没有对应的已验证会话或本地保存联系人')
  return {schema:1,channel:'WhatsApp',accountRef:request.accountRef,
   roomRef:request.roomRef,source:'DSH_IM_EXISTING_INBOX',
   updatedAt:inbox.updatedAt,readOnly:true,partial:true,canSend:false,
   name:local.displayName,nameKnown:true,messages:[]}
 }
 // This same live Socket can read only its original, currently-held media
 // events. Do not invent URLs for older text-only snapshot entries.
 const ids=room.messages.filter(m=>m.nativeMediaType).map(m=>m.id)
 const available=new Set(ids.length&&service.availableInboxMedia?
   await service.availableInboxMedia(bot.botId,room.jid,ids):[])
 return {schema:1,channel:'WhatsApp',accountRef:request.accountRef,
  roomRef:request.roomRef,source:'DSH_IM_EXISTING_INBOX',
  updatedAt:inbox.updatedAt,readOnly:true,partial:true,canSend:false,
  name:room.name||null,nameKnown:Boolean(room.name),
  messages:room.messages.map(m=>({mid:m.id,text:m.text,
   direction:m.direction,timestamp:m.timestamp,
   ...(m.direction==='OUTBOUND'&&m.verifiedAckSource&&
      m.verifiedDeliveryStatus&&m.verifiedAckKind?{
     verifiedAckSource:m.verifiedAckSource,
     verifiedDeliveryStatus:m.verifiedDeliveryStatus,
     verifiedAckKind:m.verifiedAckKind,
     ...(m.verifiedAckObservedAt?{verifiedAckObservedAt:m.verifiedAckObservedAt}:{})
   }:{}),
   ...(m.nativeMediaType?{nativeMediaType:m.nativeMediaType,
     hasNativeMedia:available.has(m.id),
     ...(available.has(m.id)?{nativeMediaPath:'/api/yenra/social-read?mode=media&accountRef='+
       request.accountRef+'&roomRef='+request.roomRef+'&mid='+encodeURIComponent(m.id)}:{})}:{}),
  }))}
}
/** Verify a translation against the SAME original DSH-IM account and inbox.
 * This is one read-only Host-side lookup, never a caller-supplied room claim.
 * Drafts are authored locally, so only their destination room is verified.
 */
export async function verifyWhatsAppTranslationSource(service:ImService,args:{
 accountRef:string;roomRef:string;direction:'to-zh'|'to-de';
 items:Array<{id:string;text:string}>
}):Promise<void>{
 const bots=await currentBots(service)
 const bot=bots.find(b=>accountRef(b.botId)===args.accountRef)
 if(!bot)throw Error('WHATSAPP_ACCOUNT_NOT_AUTHENTICATED')
 const inbox=await readInbox(bot.botId)
 const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===args.roomRef)
 if(!room)throw Error('WHATSAPP_ROOM_NOT_AUTHENTICATED')
 if(args.direction==='to-zh'&&args.items.some(item=>
   !room.messages.some(m=>m.id===item.id&&m.text===item.text)))
   throw Error('WHATSAPP_MESSAGE_NOT_IN_VERIFIED_ROOM')
}
/** Original verified DSH-IM bot roster, reused by the mature OSS display snapshot. */
export async function readExistingWhatsAppRosterForOss(service:ImService){
  return readSocialRoster(await currentBots(service),service)
}
/** Host-only manual bytes dispatch: one account, one original inbox JID,
 * one original DSH-IM Sender. No new Socket, inbox or media downloader.
 */
export async function sendVerifiedWhatsAppMediaClick(
 service:ImService,raw:string,signal?:AbortSignal,ctx?:Context
){
 const q=readManualMedia(raw)
 const bots=await currentBots(service)
 const bot=bots.find(b=>accountRef(b.botId)===q.accountRef)
 if(!bot)throw Error('WHATSAPP_MEDIA_ACCOUNT_CHANGED_KEEP_DRAFT')
 const inbox=await readInbox(bot.botId)
 const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===q.roomRef)
 const local=!room&&ctx?await getSavedWhatsAppManualContact(ctx,bot.botId,q.accountRef,q.roomRef):null
 if(!room&&!local)throw Error('WHATSAPP_MEDIA_ROOM_CHANGED_KEEP_DRAFT')
 const recipientJid=room?.jid??local!.jid
 if(typeof service.manualSendMedia!=='function')
  throw Error('ORIGINAL_DSH_IM_MEDIA_SEND_NOT_INSTALLED_KEEP_DRAFT')
 const result=await service.manualSendMedia(bot.botId,{
  kind:recipientJid.endsWith('@g.us')?'group':'user',route:{jid:recipientJid},
 },{
  kind:q.kind,mime:q.mime,fileName:q.fileName,
  bytes:q.bytes,requestId:randomUUID(),
 },{signal})
 if(result?.submitted!==true)
  throw Error('ORIGINAL_DSH_IM_MEDIA_SUBMISSION_UNCONFIRMED_DO_NOT_RETRY')
 return {
  schema:1,channel:'WhatsApp' as const,accountRef:q.accountRef,roomRef:q.roomRef,
  sent:true,submitted:true,deliveryStatus:'UNKNOWN',
  delivered:false,providerMessageId:result.providerMessageId??null
 }
}
/** Exactly the existing DSH-IM single-Socket text Sender, callable from
 * either the native Command or an authenticated owner-click Host route.
 * The route doesn't record a new event in the owner's Work Session. */
export async function sendVerifiedWhatsAppTextClick(
 ctx:Context,service:ImService,raw:string,signal?:AbortSignal
){
 const commandStarted=performance.now()
 const request=readManualSend(raw)
 const bots=await currentBots(service)
 const bot=bots.find(b=>accountRef(b.botId)===request.accountRef)
 if(!bot)return reject('账号已失效或不属于当前已认证的 WhatsApp Host')
 const inbox=await readInbox(bot.botId)
 const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===request.roomRef)
 const local=room?null:await getSavedWhatsAppManualContact(ctx,bot.botId,request.accountRef,request.roomRef)
 if(!room&&!local)return reject('原生收件箱和本地联系人均无该账号对应的收件人，拒绝发送')
 const recipientJid=room?.jid??local!.jid
 if(typeof service.manualSend!=='function')return reject('DSH-IM 手动发送兼容接口尚未启用，草稿保持不变')
 const originalSenderStarted=performance.now()
 const result=await service.manualSend(bot.botId,{
  kind:recipientJid.endsWith('@g.us')?'group':'user',route:{jid:recipientJid},
 },request.text,{signal})
 const originalSenderReturned=performance.now()
 if(result?.submitted!==true)return reject('DSH-IM 未确认提交；请核实原渠道，不要自动重发')
 const mid=result.providerMessageId
 const providerMessageId=typeof mid==='string'&&
  /^[A-Za-z0-9_.:-]{1,180}$/.test(mid)?mid:null
 return {kind:'success' as const,text:SEND_PREFIX+JSON.stringify({
  schema:1,channel:'WhatsApp',sent:true,
  accountRef:request.accountRef,roomRef:request.roomRef,
  submitted:true,deliveryStatus:'UNKNOWN',delivered:false,
  providerMessageId,
  submissionTiming:{
   originalHostPreflightMs:Number((originalSenderStarted-commandStarted).toFixed(2)),
   originalSenderWaitMs:Number((originalSenderReturned-originalSenderStarted).toFixed(2)),
   originalHostTotalMs:Number((performance.now()-commandStarted).toFixed(2)),
  },
 })}
}
export function registerSocialReadOnlyCommands(ctx:Context):void{
 // Match the existing working /oss-roster lifecycle: register HTTP when the
 // Host webServer is ready, then use only the currently injected DSH-IM handle.
 // The HTTP route must not disappear merely because the Socket reconnects.
 let originalDshIm:ImService|undefined
 ctx.inject(['dshIm'],imCtx=>imCtx.effect(()=>{
  const service=(imCtx as unknown as {dshIm?:ImService}).dshIm
  originalDshIm=service
  if(!service||typeof service.listBots!=='function')return()=>{originalDshIm=undefined}
  const names=['yenra-social-roster','yenra-social-room','yenra-social-manual-send'] as const
  const disposers=names.map(name=>ctx.commands.register({
   name,description:name.includes('manual-send')?'Explicit owner-click original DSH-IM sender; no autonomous dispatch':'Read authenticated YENRA original DSH-IM inbox',
   ...(name==='yenra-social-room'||name==='yenra-social-manual-send'?{input:{hint:'verified account and room references'}}:{}),
   recordInput:false,
   handler:async({agent,rawInput,signal})=>{
    try{
     if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))
      return reject('未确认主人 DSH 工作区，拒绝读取联系人')
     if(name==='yenra-social-manual-send')
      return await sendVerifiedWhatsAppTextClick(ctx,service,rawInput.trim(),signal)
     const bots=await currentBots(service)
     if(name==='yenra-social-roster')return ok(await readSocialRoster(bots,service))
     return ok(await readSocialRoom(ctx,service,bots,readRequest(rawInput.trim())))
    }catch(e){return reject('原生只读收件箱暂不可用：'+(e instanceof Error?e.message:String(e)))}
   },
  }))
  return()=>{if(originalDshIm===service)originalDshIm=undefined;for(const dispose of disposers.reverse())dispose()}
 },'YENRA owner-only social history read via existing DSH-IM'))
 // Passive ChatScope loads use the SAME Host account/room projections without
 // creating tool events in the user's ongoing native Brain Session.
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/social-read',
  handler:async(request,response)=>{
   const send=(status:number,value:unknown)=>{
    response.writeHead(status,{'content-type':'application/json; charset=utf-8',
     'cache-control':'no-store','x-content-type-options':'nosniff'})
    response.end(JSON.stringify(value))
   }
   if(request.method!=='GET'){send(405,{ok:false,error:'METHOD_NOT_ALLOWED'});return}
   const addr=String(request.socket?.remoteAddress??'')
   if(addr&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr)){send(403,{ok:false,error:'LOCAL_ONLY'});return}
   const site=String(request.headers['sec-fetch-site']??'')
   if(site&&!['same-origin','none'].includes(site)){send(403,{ok:false,error:'SAME_ORIGIN_ONLY'});return}
   const origin=String(request.headers.origin??'')
   if(origin&&origin!=='null'&&origin!=='dsh-app://app'){send(403,{ok:false,error:'SAME_ORIGIN_ONLY'});return}
   try{
    const url=new URL(String(request.url??''),'http://localhost')
    const mode=url.searchParams.get('mode')
    const keys=[...url.searchParams.keys()].sort().join(',')
    if(mode!=='roster'&&mode!=='room'&&mode!=='media'&&mode!=='avatar'&&mode!=='profile'&&mode!=='account-avatar'&&mode!=='connection-status'){
     send(400,{ok:false,error:'INVALID_MODE'});return
    }
    const expectedKeys=mode==='roster'||mode==='connection-status'?'mode':mode==='profile'||mode==='account-avatar'?
      'accountRef,mode':mode==='room'||mode==='avatar'?
      'accountRef,mode,roomRef':'accountRef,mid,mode,roomRef'
    if(keys!==expectedKeys){send(400,{ok:false,error:'INVALID_QUERY'});return}
    const service=originalDshIm ?? (scope.get('dshIm') as ImService|undefined)
    if(!service||typeof service.listBots!=='function'){
     send(503,{ok:false,error:'NATIVE_DSH_IM_UNAVAILABLE'});return
    }
    const bots=await currentBots(service)
    if(mode==='connection-status'){
      if(typeof service.whatsappCurrentlyAuthorized!=='function'){
        send(503,{ok:false,error:'ORIGINAL_DSH_IM_SOCKET_STATUS_CAPABILITY_UNAVAILABLE'});return
      }
      // Reuse the same registered DSH-IM Socket for both accounts. A failed
      // per-account read is unknown, never an invented offline verdict.
      const accounts=await readOriginalWhatsAppSocketStatuses(service)
      send(200,{ok:true,source:'ORIGINAL_DSH_IM_SINGLE_SOCKET',accounts});return
    }
    if(mode==='profile'){
      const requested=url.searchParams.get('accountRef')??''
      if(!REF.test(requested)){send(400,{ok:false,error:'INVALID_ACCOUNT_REF'});return}
      const bot=bots.find(item=>accountRef(item.botId)===requested)
      if(!bot){send(404,{ok:false,error:'VERIFIED_ACCOUNT_NOT_FOUND'});return}
      if(typeof service.readOwnAccountIdentity!=='function'){
        send(503,{ok:false,error:'ORIGINAL_ACCOUNT_IDENTITY_CAPABILITY_UNAVAILABLE'});return
      }
      const info=await service.readOwnAccountIdentity(bot.botId)
      if(!info){send(404,{ok:false,error:'ORIGINAL_ACCOUNT_IDENTITY_NOT_FOUND'});return}
      const displayName=typeof info.displayName==='string'?info.displayName.slice(0,100):null
      const ownPhone=typeof info.ownPhone==='string'&&/^\+[0-9]{5,15}$/.test(info.ownPhone)
        ?info.ownPhone:null
      send(200,{ok:true,accountRef:requested,displayName,ownPhone});return
    }
    if(mode==='avatar'||mode==='account-avatar'){
      // Both paths use the original authenticated Baileys Socket.
      // account-avatar never accepts an arbitrary JID or room and can only
      // read THIS logged-in account's own profile photo.
      const requested=url.searchParams.get('accountRef')??''
      if(!REF.test(requested)){send(400,{ok:false,error:'INVALID_ACCOUNT_REF'});return}
      const bot=bots.find(b=>accountRef(b.botId)===requested)
      if(!bot){send(404,{ok:false,error:'VERIFIED_ACCOUNT_NOT_FOUND'});return}
      let source:string|null=null
      if(mode==='account-avatar'){
        if(typeof service.readOwnAccountAvatarUrl!=='function'){
          response.writeHead(204);response.end();return
        }
        source=await service.readOwnAccountAvatarUrl(bot.botId).catch(()=>null)
      }else{
        const args=readRequest(JSON.stringify({
          accountRef:requested,roomRef:url.searchParams.get('roomRef')??'',
        }))
        const inbox=await readInbox(bot.botId)
        const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===args.roomRef)
        const local=!room?await getSavedWhatsAppManualContact(ctx,bot.botId,args.accountRef,args.roomRef):null
        const avatarJid=room?.jid??local?.jid
        if(!avatarJid){send(404,{ok:false,error:'VERIFIED_ROOM_NOT_FOUND'});return}
        if(typeof service.readContactAvatarUrl!=='function'){
          response.writeHead(204,{'cache-control':'private, no-store'});response.end();return
        }
        source=await service.readContactAvatarUrl(bot.botId,avatarJid).catch(()=>null)
      }
      if(!source){response.writeHead(204,{'cache-control':'private, max-age=120'});response.end();return}
      let photo:URL
      try{photo=new URL(source)}catch{
        response.writeHead(204);response.end();return
      }
      const hostname=photo.hostname.toLowerCase()
      if(photo.protocol!=='https:'||photo.username||photo.password||photo.port||
         !(hostname==='pps.whatsapp.net'||hostname.endsWith('.whatsapp.net')||
           hostname==='fbcdn.net'||hostname.endsWith('.fbcdn.net'))){
        send(403,{ok:false,error:'UNTRUSTED_ORIGINAL_AVATAR_URL'});return
      }
      // Original profile photo CDN, single image, no independent socket,
      // background crawl, persistent cache, model or additional credential.
      // Some official photo URLs redirect to another WhatsApp/Facebook CDN.
      // Follow only bounded HTTPS redirects within the same trusted domains.
      let address=photo.href
      let upstream:Response|undefined
      const signal=AbortSignal.timeout(7000)
      for(let hops=0;hops<3;hops++){
        upstream=await fetch(address,{redirect:'manual',signal})
        if(![301,302,303,307,308].includes(upstream.status))break
        const location=upstream.headers.get('location')
        if(!location){response.writeHead(204);response.end();return}
        let next:URL
        try{next=new URL(location,address)}catch{
          send(403,{ok:false,error:'INVALID_AVATAR_REDIRECT'});return
        }
        const domain=next.hostname.toLowerCase()
        if(next.protocol!=='https:'||next.username||next.password||next.port||
           !(domain==='pps.whatsapp.net'||domain.endsWith('.whatsapp.net')||
             domain==='fbcdn.net'||domain.endsWith('.fbcdn.net'))){
          send(403,{ok:false,error:'UNTRUSTED_AVATAR_REDIRECT'});return
        }
        if(hops===2){response.writeHead(204);response.end();return}
        address=next.href
      }
      if(!upstream){response.writeHead(204);response.end();return}
      const mime=upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if(!upstream.ok||!mime||!['image/jpeg','image/png','image/webp','image/gif'].includes(mime)){
        response.writeHead(204,{'cache-control':'private, max-age=120'});response.end();return
      }
      const declared=Number(upstream.headers.get('content-length')??'0')
      if(declared>1_500_000){
        send(413,{ok:false,error:'AVATAR_TOO_LARGE'});return
      }
      const chunks:Buffer[]=[]
      let size=0
      if(!upstream.body){response.writeHead(204);response.end();return}
      for await(const chunk of upstream.body){
        const bytes=Buffer.from(chunk)
        size+=bytes.length
        if(size>1_500_000){send(413,{ok:false,error:'AVATAR_TOO_LARGE'});return}
        chunks.push(bytes)
      }
      if(size<100){response.writeHead(204);response.end();return}
      const picture=Buffer.concat(chunks,size)
      const signature=mime==='image/jpeg'?
        picture[0]===255&&picture[1]===216&&picture[2]===255:
        mime==='image/png'?
        picture.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
        mime==='image/webp'?
        picture.toString('ascii',0,4)==='RIFF'&&picture.toString('ascii',8,12)==='WEBP':
        ['GIF87a','GIF89a'].includes(picture.toString('ascii',0,6))
      if(!signature){response.writeHead(204);response.end();return}
      response.writeHead(200,{'content-type':mime,'content-length':size,
        'cache-control':'private, max-age=3600','x-content-type-options':'nosniff'})
      response.end(picture);return
    }
    if(mode==='media'){
     // Original DSH-IM same-Socket media stream. Every request rechecks the
     // original authorized account, room and event in its existing inbox.
     const args=readRequest(JSON.stringify({
      accountRef:url.searchParams.get('accountRef')??'',
      roomRef:url.searchParams.get('roomRef')??'',
     }))
     const mid=url.searchParams.get('mid')??''
     if(!mid||mid.length>180){send(400,{ok:false,error:'INVALID_MESSAGE_ID'});return}
     const bot=bots.find(b=>accountRef(b.botId)===args.accountRef)
     if(!bot){send(404,{ok:false,error:'VERIFIED_ACCOUNT_NOT_FOUND'});return}
     const inbox=await readInbox(bot.botId)
     const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===args.roomRef)
     if(!room||!room.messages.some(m=>m.id===mid&&m.nativeMediaType)){
      send(404,{ok:false,error:'NATIVE_MEDIA_NOT_IN_VERIFIED_ROOM'});return
     }
     if(!service.readInboxMedia||!service.availableInboxMedia){
      send(503,{ok:false,error:'ORIGINAL_DSH_IM_MEDIA_CAPABILITY_UNAVAILABLE'});return
     }
     const available=await service.availableInboxMedia(bot.botId,room.jid,[mid])
     if(!available.includes(mid)){
      send(404,{ok:false,error:'ORIGINAL_LIVE_MEDIA_EVENT_UNAVAILABLE'});return
     }
     const media=await service.readInboxMedia(bot.botId,room.jid,mid)
     if(!Buffer.isBuffer(media.bytes)||!media.bytes.length||
        !['image','video','audio','file'].includes(media.type)){
      send(503,{ok:false,error:'ORIGINAL_MEDIA_INVALID'});return
     }
     const safeMime=typeof media.mime==='string'&&
       /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(media.mime)?media.mime:'application/octet-stream'
     const length=media.bytes.length
     const range=String(request.headers.range??'')
     const bounds=range?(/^bytes=(\d+)-(\d*)$/.exec(range)):null
     if(range&&!bounds){response.writeHead(416,{'content-range':'bytes */'+length});response.end();return}
     const start=bounds?Number(bounds[1]):0
     const end=bounds?Math.min(length-1,bounds[2]?Number(bounds[2]):length-1):length-1
     if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
       start<0||end<start||start>=length){
      response.writeHead(416,{'content-range':'bytes */'+length});response.end();return
     }
     const part=Boolean(bounds),data=media.bytes.subarray(start,end+1)
     response.writeHead(part?206:200,{
      'content-type':safeMime,'content-length':data.length,'accept-ranges':'bytes',
      ...(part?{'content-range':'bytes '+start+'-'+end+'/'+length}:{}),
      'cache-control':'private, no-store','x-content-type-options':'nosniff',
      'content-disposition':media.type==='file'?'attachment':'inline'
     })
     response.end(data);return
    }
    const data=mode==='roster'?await readSocialRoster(bots):
     await readSocialRoom(ctx,service,bots,readRequest(JSON.stringify({
      accountRef:url.searchParams.get('accountRef')??'',
      roomRef:url.searchParams.get('roomRef')??'',
     })))
    send(200,{ok:true,text:ok(data).text})
   }catch{send(503,{ok:false,error:'NATIVE_WHATSAPP_HISTORY_UNAVAILABLE'})}
  },
 }), 'YENRA verified DSH-IM passive inbox read without Brain Session log'))
 // Cloud-first owner click -> verified Cloud MID -> the ORIGINAL DSH-IM
 // Socket. No second sender, credentials in the renderer, or fake ACK.
 const inflight=new Map<string,Promise<unknown>>()
 const recentlySubmitted=new Map<string,number>()
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/cloud-wa/react',
  handler:async(request,response)=>{
   const send=(code:number,value:unknown)=>{
    response.writeHead(code,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store, private','x-content-type-options':'nosniff'})
    response.end(JSON.stringify(value))
   }
   const remote=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'')
   const origin=String(request.headers.origin??'')
   const site=String(request.headers['sec-fetch-site']??'')
   const desktop=String(request.headers['x-yenra-desktop-origin']??'')
   const hostOrigin=scope.webServer.getOrigin()
   if(!['127.0.0.1','::1'].includes(remote)||
      !(origin==='dsh-app://app'||origin===hostOrigin||
        (!origin&&desktop==='dsh-app://app'))||
      (site&&site!=='same-origin'&&site!=='none')){
    send(403,{ok:false,code:'WA_REACTION_DESKTOP_OWNER_REQUIRED'});return
   }
   if(request.method!=='POST'||
      !String(request.headers['content-type']??'').startsWith('application/json')){
    send(405,{ok:false,code:'WA_REACTION_POST_JSON_ONLY'});return
   }
   try{
    let raw=''
    for await(const part of request){
     raw+=part.toString()
     if(raw.length>160)throw Error('WA_REACTION_REQUEST_TOO_LARGE')
    }
    const value=JSON.parse(raw) as Record<string,unknown>
    if(Object.keys(value??{}).sort().join(',')!=='accountId,conversationId,emoji,messageId'||
       value.accountId!==196799||
       !Number.isSafeInteger(value.conversationId)||Number(value.conversationId)<=0||
       !Number.isSafeInteger(value.messageId)||Number(value.messageId)<=0||
       !['👍','❤️','😂','😮','😢','🙏'].includes(String(value.emoji))){
      send(400,{ok:false,code:'WA_REACTION_INPUT_INVALID'});return
    }
    const key=String(value.conversationId)+':'+String(value.messageId)
    if(inflight.has(key)){send(409,{ok:false,code:'WA_REACTION_ALREADY_IN_FLIGHT'});return}
    if(Date.now()-(recentlySubmitted.get(key)??0)<30_000){
      send(409,{ok:false,code:'WA_REACTION_ALREADY_SUBMITTED'});return
    }
    const task=(async()=>{
      // Never trust Cloud DOM source_id/contact. The Bridge re-reads Cloud
      // messages and original DSH Host room for every user-initiated action.
      const base=new URL(process.env.YENRA_BRIDGE_ORIGIN??'http://127.0.0.1:31917')
      if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.username||
         base.password||!base.port||base.pathname!=='/'||
         base.search||base.hash)throw Error('WA_REACTION_TRUSTED_BRIDGE_REQUIRED')
      const proofResponse=await fetch(new URL('/yenra-cloud/verify-wa-reaction',base),{
        method:'POST',redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json',
          'x-yenra-original-dsh-cloud-reaction':'1'},
        body:JSON.stringify(value)
      })
      if(!proofResponse.ok)throw Error('WA_REACTION_CLOUD_PROOF_REJECTED')
      const result=await proofResponse.json()
      const proof=result?.selection
      if(result?.ok!==true||proof?.channel!=='WhatsApp'||
         ![155901,155902].includes(proof.cloudInboxId)||
         proof.cloudConversationId!==value.conversationId||
         proof.cloudMessageId!==value.messageId||
         proof.emoji!==value.emoji||
         !REF.test(proof.accountRef)||!REF.test(proof.roomRef)||
         !['INBOUND','OUTBOUND'].includes(proof.direction)||
         typeof proof.originalMid!=='string'||!proof.originalMid||
         proof.originalMid.length>180)
        throw Error('WA_REACTION_CLOUD_PROOF_INVALID')
      const service=originalDshIm ?? scope.get('dshIm') as ImService|undefined
      if(!service?.listBots||!service.reactToOriginalInboxMessage)
        throw Error('WA_REACTION_EXISTING_SOCKET_CAPABILITY_UNAVAILABLE')
      const bots=await currentBots(service)
      const bot=bots.find(b=>accountRef(b.botId)===proof.accountRef)
      if(!bot)throw Error('WA_REACTION_ORIGINAL_ACCOUNT_NOT_FOUND')
      const inbox=await readInbox(bot.botId)
      const room=inbox.chats.find(c=>roomRef(bot.botId,c.jid)===proof.roomRef)
      const original=room?.messages.filter(m=>m.id===proof.originalMid&&
        m.direction===proof.direction)??[]
      if(!room||original.length!==1||
         !/^[0-9]{5,32}@(s[.]whatsapp[.]net|lid)$/.test(room.jid))
        throw Error('WA_REACTION_ORIGINAL_INBOX_MESSAGE_UNVERIFIED')
      const receipt=await service.reactToOriginalInboxMessage(bot.botId,{
        jid:room.jid,mid:proof.originalMid,
        direction:proof.direction,emoji:String(value.emoji)
      })
      if(receipt?.submitted!==true||receipt.deliveryStatus!=='UNKNOWN')
        throw Error('WA_REACTION_SUBMISSION_UNCONFIRMED')
      recentlySubmitted.set(key,Date.now())
      if(recentlySubmitted.size>100)recentlySubmitted.delete(recentlySubmitted.keys().next().value!)
      return {ok:true,submitted:true,deliveryStatus:'UNKNOWN'}
    })()
    inflight.set(key,task)
    try{send(200,await task)}
    catch{send(422,{ok:false,code:'WA_REACTION_PLATFORM_OPERATION_UNAVAILABLE'})}
    finally{if(inflight.get(key)===task)inflight.delete(key)}
   }catch{send(422,{ok:false,code:'WA_REACTION_REQUEST_UNAVAILABLE'})}
  }
 }), 'YENRA explicit Cloud WhatsApp original MID reaction via existing Socket'))
 // Read-only conversation eligibility hint. Never exposes JID, MID or refs.
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/cloud-wa/reaction-eligible',
  handler:async(request,response)=>{
    const send=(code:number,result:unknown)=>{
      response.writeHead(code,{'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store, private','x-content-type-options':'nosniff'})
      response.end(JSON.stringify(result))
    }
    const addr=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'')
    const origin=String(request.headers.origin??'')
    const desktop=String(request.headers['x-yenra-desktop-origin']??'')
    const site=String(request.headers['sec-fetch-site']??'')
    if(!['127.0.0.1','::1'].includes(addr)||
       !(origin==='dsh-app://app'||origin===scope.webServer.getOrigin()||
         (!origin&&desktop==='dsh-app://app'))||
       (site&&site!=='same-origin'&&site!=='none')||request.method!=='GET'){
      send(403,{ok:false,eligible:false});return
    }
    try{
      const url=new URL(String(request.url??''),'http://localhost')
      if([...url.searchParams.keys()].join(',')!=='conversationId')
        throw Error('QUERY_NOT_ALLOWED')
      const cid=Number(url.searchParams.get('conversationId'))
      if(!Number.isSafeInteger(cid)||cid<=0)throw Error('INVALID_CONVERSATION')
      const base=new URL(process.env.YENRA_BRIDGE_ORIGIN??'http://127.0.0.1:31917')
      if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||
         base.username||base.password||base.pathname!=='/'||base.search||base.hash)
        throw Error('TRUSTED_BRIDGE_REQUIRED')
      const reply=await fetch(new URL('/yenra-cloud/resolve',base),{
        method:'POST',redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(12000),
        headers:{'content-type':'application/json',
          'x-yenra-original-dsh-cloud-selection':'1'},
        body:JSON.stringify({accountId:196799,conversationId:cid})
      })
      if(!reply.ok)throw Error('CLOUD_SELECTION_UNAVAILABLE')
      const item=await reply.json()
      const s=item?.selection
      send(200,{ok:true,eligible:item?.ok===true&&
        s?.cloudAccountId===196799&&s.cloudConversationId===cid&&
        s.channel==='WhatsApp'&&[155901,155902].includes(s.cloudInboxId)})
    }catch{send(422,{ok:false,eligible:false})}
  }
 }), 'Cloud WhatsApp original room eligibility hint, no identity or message read'))
}
