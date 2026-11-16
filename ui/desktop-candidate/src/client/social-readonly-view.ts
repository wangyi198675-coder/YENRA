/** Fast, tolerant display decoder for the existing authenticated DSH-IM Commands.
 * No SDK, sender, credentials, Socket, database or cached history.
 */
export const SOCIAL_RESPONSE='YENRA_SOCIAL_V1:'
export type SocialRoomSummary={
  roomRef:string;name:string|null;nameKnown:boolean;phoneFallback?:string;
  providerPeerKind:'lid'|'group'|'number'|'matrix-room'|'page-conversation'|'unknown';lastMessageAt:number|null;
  messageCount:number;latestText:string|null;
  latestMessageId?:string;latestMessageSource?:string;
  contactPreferences?:{pinned:boolean;muted:boolean;archived:boolean;manualUnread:boolean}
}
export type SocialAccount={
  channel:'WhatsApp';accountRef:string;source:'DSH_IM_EXISTING_INBOX';
  readOnly:true;canSend:false;partial?:boolean;updatedAt:string|null;rooms:SocialRoomSummary[]
}
export type SocialRoster={
  schema:1;readOnly:true;partial:boolean;canSend:false;
  source:'DSH_IM_EXISTING_INBOX'|'YENRA_AGGREGATED_NATIVE';configuredBotCount:number;accounts:SocialAccount[]
}
export type SocialMessage={
  mid:string;text:string;direction:'INBOUND'|'OUTBOUND';timestamp:number
  /** Verified Host metadata for existing DSH context; NOT decoded image/video. */
  mediaContext?:string
}
export type SocialRoom={
  schema:1;channel:'WhatsApp';source:'DSH_IM_EXISTING_INBOX';
  accountRef:string;roomRef:string;name:string|null;nameKnown:boolean;
  readOnly:true;partial:boolean;canSend:false;updatedAt:string|null;messages:SocialMessage[]
}
const ref=/^[a-f0-9]{32}$/
const obj=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)
const fail=():never=>{throw Error('原生社交命令返回不符合账号隔离契约，拒绝显示')}
const str=(v:unknown)=>typeof v==='string'
const time=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0
export function socialKey(accountRef:string,roomRef:string){return accountRef+':'+roomRef}
export function socialName(r:Pick<SocialRoomSummary,'name'|'nameKnown'|'roomRef'|'phoneFallback'>){
  // roomRef is opaque and must never be shown as a name. A verified original
  // WhatsApp number is a legitimate display fallback, not a personal name.
  if(r.nameKnown&&r.name?.trim())return r.name.trim()
  return typeof r.phoneFallback==='string'&&/^\+\d{5,15}$/.test(r.phoneFallback)
    ?r.phoneFallback:'未知联系人'
}
export function socialTime(v:number|null|undefined){
  if(v===null||v===undefined||!time(v)||v===0)return ''
  const ms=v<1e11?v*1000:v
  const date=new Date(ms)
  return Number.isNaN(date.valueOf())?'':date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
}
export function parseSocialResponse(text:string|undefined):unknown{
  if(!text?.startsWith(SOCIAL_RESPONSE))throw Error('未收到可信 DSH-IM 只读数据')
  let data:unknown
  try{data=JSON.parse(text.slice(SOCIAL_RESPONSE.length))}catch{fail()}
  if(!obj(data)||data.schema!==1||data.source!=='DSH_IM_EXISTING_INBOX'||
     data.readOnly!==true||data.canSend!==false)fail()
  return data
}
export function parseSocialRoster(value:unknown):SocialRoster{
  if(!obj(value)||!Array.isArray(value.accounts))fail()
  const accounts:SocialAccount[]=[]
  const ids=new Set<string>()
  for(const a of value.accounts){
    if(!obj(a)||a.channel!=='WhatsApp'||a.source!=='DSH_IM_EXISTING_INBOX'||
       typeof a.accountRef!=='string'||!ref.test(a.accountRef)||ids.has(a.accountRef))continue
    ids.add(a.accountRef)
    const rooms:SocialRoomSummary[]=[]
    const seen=new Set<string>()
    for(const r of Array.isArray(a.rooms)?a.rooms:[]){
      if(!obj(r)||typeof r.roomRef!=='string'||!ref.test(r.roomRef)||seen.has(r.roomRef))continue
      seen.add(r.roomRef)
      const name=typeof r.name==='string'?r.name:null
      rooms.push({roomRef:r.roomRef,name,
        ...(typeof r.phoneFallback==='string'&&/^\+\d{5,15}$/.test(r.phoneFallback)
          ?{phoneFallback:r.phoneFallback}:{}),
        nameKnown:typeof r.nameKnown==='boolean'?r.nameKnown:Boolean(name?.trim()),
        providerPeerKind:['lid','group','number'].includes(String(r.providerPeerKind))
          ?r.providerPeerKind as SocialRoomSummary['providerPeerKind']:'unknown',
        lastMessageAt:time(r.lastMessageAt)?r.lastMessageAt as number:null,
        messageCount:Number.isSafeInteger(r.messageCount)&&Number(r.messageCount)>=0?r.messageCount as number:0,
        latestText:typeof r.latestText==='string'?r.latestText:null,
        ...(typeof r.latestMessageId==='string'&&typeof r.latestMessageSource==='string'?{
          latestMessageId:r.latestMessageId,latestMessageSource:r.latestMessageSource}:{}),
        ...(obj(r.contactPreferences)?{contactPreferences:{
          pinned:r.contactPreferences.pinned===true,muted:r.contactPreferences.muted===true,
          archived:r.contactPreferences.archived===true,manualUnread:r.contactPreferences.manualUnread===true}}:{})})
    }
    accounts.push({...a,readOnly:true,canSend:false,
      updatedAt:typeof a.updatedAt==='string'?a.updatedAt:null,rooms} as SocialAccount)
  }
  return {...value,readOnly:true,canSend:false,accounts,
    configuredBotCount:Number.isSafeInteger(value.configuredBotCount)&&Number(value.configuredBotCount)>=0
      ?value.configuredBotCount:accounts.length} as SocialRoster
}
export function parseSocialRoom(value:unknown,accountRef:string,roomRef:string):SocialRoom{
  // Current Host-issued account + room must still match exactly. A damaged
  // optional field or individual record must not hide the whole conversation.
  if(!obj(value)||value.channel!=='WhatsApp'||value.accountRef!==accountRef||
     value.roomRef!==roomRef)fail()
  const messages:SocialMessage[]=[]
  for(const m of Array.isArray(value.messages)?value.messages:[]){
    if(!obj(m)||typeof m.mid!=='string'||!m.mid)continue
    if(m.direction!=='INBOUND'&&m.direction!=='OUTBOUND')continue
    messages.push({
      mid:m.mid,
      text:typeof m.text==='string'?m.text:'',
      direction:m.direction,
      timestamp:time(m.timestamp)?m.timestamp as number:0,
      ...(m.hasNativeMedia===true && ['image','video','audio','file'].includes(String(m.nativeMediaType))
        ?{mediaContext:'原生'+({image:'图片',video:'视频',audio:'语音或音频',file:'附件'} as Record<string,string>)[String(m.nativeMediaType)]+'已存在；尚未解析文件内容'}:{}),
    })
  }
  const name=typeof value.name==='string'?value.name:null
  return {...value,accountRef,roomRef,name,
    nameKnown:typeof value.nameKnown==='boolean'?value.nameKnown:Boolean(name?.trim()),
    updatedAt:typeof value.updatedAt==='string'?value.updatedAt:null,
    messages,readOnly:true,canSend:false} as SocialRoom
}


/** Facebook references are issued by the trusted original Matrix and Pancake Host only. */
export const FACEBOOK_RESPONSE='YENRA_FACEBOOK_V1:'
export function parseFacebookResponse(text:string|undefined):unknown{
 if(!text?.startsWith(FACEBOOK_RESPONSE))throw Error('未收到可信 Facebook Host 数据')
 let value:unknown
 try{value=JSON.parse(text.slice(FACEBOOK_RESPONSE.length))}catch{fail()}
 if(!obj(value)||value.schema!==1||value.source!=='YENRA_FB_OFFICIAL')fail()
 return value
}
export function parseFacebookRoster(value:unknown):SocialAccount[]{
 if(!obj(value)||!Array.isArray(value.accounts))fail()
 const accounts:SocialAccount[]=[]
 const ids=new Set<string>()
 for(const a of value.accounts){
  if(!obj(a)||!['Personal','Page'].includes(String(a.channel))||
    a.source!=='YENRA_FB_OFFICIAL'||typeof a.accountRef!=='string'||
    !ref.test(a.accountRef)||ids.has(a.accountRef))continue
  ids.add(a.accountRef)
  const rooms:SocialRoomSummary[]=[]
  const seen=new Set<string>()
  for(const r of Array.isArray(a.rooms)?a.rooms:[]){
   if(!obj(r)||typeof r.roomRef!=='string'||!ref.test(r.roomRef)||seen.has(r.roomRef))continue
   seen.add(r.roomRef)
   const name=typeof r.name==='string'?r.name:null
   rooms.push({roomRef:r.roomRef,name,
     nameKnown:typeof r.nameKnown==='boolean'?r.nameKnown:Boolean(name?.trim()),
     providerPeerKind:['matrix-room','page-conversation'].includes(String(r.providerPeerKind))
       ?r.providerPeerKind as SocialRoomSummary['providerPeerKind']:'unknown',
     lastMessageAt:time(r.lastMessageAt)?r.lastMessageAt as number:null,
     messageCount:Number.isSafeInteger(r.messageCount)&&Number(r.messageCount)>=0?r.messageCount as number:0,
     latestText:typeof r.latestText==='string'?r.latestText:null})
  }
  accounts.push({...a,readOnly:true,canSend:false,
    updatedAt:typeof a.updatedAt==='string'?a.updatedAt:null,rooms} as unknown as SocialAccount)
 }
 return accounts
}
export function parseFacebookRoom(value:unknown,accountRef:string,roomRef:string):SocialRoom{
 // Ref identity is essential. Optional display metadata is never a gate for
 // showing verified Facebook Personal/Page history.
 if(!obj(value)||value.schema!==1||value.source!=='YENRA_FB_OFFICIAL'||
   !['Personal','Page'].includes(String(value.channel))||
   value.accountRef!==accountRef||value.roomRef!==roomRef)fail()
 const messages=[]
 for(const m of Array.isArray(value.messages)?value.messages:[]){
   if(!obj(m)||typeof m.mid!=='string'||!m.mid)continue
   if(m.direction!=='INBOUND'&&m.direction!=='OUTBOUND')continue
   messages.push({
     mid:m.mid,
     text:typeof m.text==='string'?m.text:'',
     direction:m.direction,
     timestamp:time(m.timestamp)?m.timestamp:0,
     translation:typeof m.translation==='string'?m.translation:null,
     ...(()=>{
       const parts:string[]=[]
       if(m.hasNativeMedia===true&&['image','video','audio','file'].includes(String(m.nativeMediaType)))
         parts.push('原生媒体：'+String(m.nativeMediaType)+'；内容尚未读取')
       if(Array.isArray(m.media)&&m.media.length)
         parts.push('原生媒体类型：'+m.media.slice(0,5)
           .filter((item:unknown)=>obj(item)&&['image','video','audio','file','sticker'].includes(String(item.type)))
           .map((item:any)=>String(item.type)).join('、')+'；内容尚未解析')
       if(value.channel==='Page'&&Array.isArray(m.sharePreviews)){
         for(const s of m.sharePreviews.slice(0,3)){
           if(!obj(s)||typeof s.url!=='string')continue
           try{
             const u=new URL(s.url)
             if(u.protocol!=='https:'||!['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch'].includes(u.hostname.toLowerCase()))continue
             parts.push('Facebook 分享链接：'+u.href.slice(0,260)+
               (typeof s.title==='string'?'；原帖标题：'+s.title.slice(0,150):'')+
               (typeof s.source==='string'?'；来源：'+s.source.slice(0,90):'')+
               (typeof s.description==='string'?'；原帖摘要：'+s.description.slice(0,220):'')+
               '；未解析封面图像内容')
           }catch{}
         }
       }
       return parts.length?{mediaContext:parts.join('；').slice(0,650)}:{}
     })(),
   })
 }
 const name=typeof value.name==='string'?value.name:null
 return {...value,accountRef,roomRef,name,
   nameKnown:typeof value.nameKnown==='boolean'?value.nameKnown:Boolean(name?.trim()),
   readOnly:true,canSend:false,messages} as SocialRoom
}
