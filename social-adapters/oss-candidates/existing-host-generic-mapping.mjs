/**
 * YENRA phase-1 read-only wire mapping for upstream messaging-inbox generic-server.
 * Converts existing authorized Host command results only. No login, socket, server,
 * state, database, sender or invented media/unread status.
 */
const REF=/^[a-f0-9]{32}$/;
const ALLOWED=new Set(['Personal','Page','WhatsApp']);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function requireRef(s){if(typeof s!=='string'||!REF.test(s))throw Error('INVALID_HOST_REFERENCE');return s}
function requireAccount(a){
 if(!a||!ALLOWED.has(a.channel)||!Array.isArray(a.rooms))throw Error('INVALID_HOST_ACCOUNT');
 requireRef(a.accountRef);return a;
}
function instant(t){
 if(!Number.isFinite(t)||t<=0)return undefined;
 const date=new Date(t<1e11?t*1000:t);
 return Number.isFinite(date.valueOf())?date.toISOString():undefined;
}
export function devicesFromHost(facebook,whatsapp){
 if(!Array.isArray(facebook?.accounts)||!Array.isArray(whatsapp?.accounts))throw Error('INVALID_ROSTER');
 const accounts=[...facebook.accounts,...whatsapp.accounts].map(requireAccount);
 const keys=new Set();
 return accounts.map(a=>{
  if(keys.has(a.accountRef))throw Error('DUPLICATE_ACCOUNT_REF');
  keys.add(a.accountRef);
  return {id:a.accountRef,channel:a.channel,label:a.channel,accountRef:a.accountRef,
   providerType:'generic-server',readonly:true,capabilities:{
    templates:false,messagingWindow24h:false,pushToTalk:false,
    interactiveButtons:false,deleteForEveryone:false,markAsRead:false,
    conversationInitiation:{canInitiate:false,identifierType:'opaque'}
   },roomCount:a.rooms.length};
 });
}
export function chatsFromHost(account){
 requireAccount(account);
 const keys=new Set();
 return account.rooms.map(r=>{
  const ref=requireRef(r.roomRef);
  if(keys.has(ref))throw Error('DUPLICATE_ROOM_REF');
  keys.add(ref);
  // True last-message TEXT is already in the verified Host roster. Direction
  // is often unknown; do not guess inbound and do not display a false sent tick.
  const lastMessage=typeof r.latestText==='string'&&r.latestText.trim()
    ?{content:r.latestText,direction:'unknown',type:'text',
       ...(typeof r.latestMessageId==='string'&&typeof r.latestMessageSource==='string'
         ?{latestMessageId:r.latestMessageId,latestMessageSource:r.latestMessageSource}:{}),
       ...(typeof r.latestTranslation==='string'&&r.latestTranslation.trim()
         ?{verifiedTranslation:r.latestTranslation.trim()}:{}),
      }:undefined;
  // The same authorized WhatsApp account can expose a real E.164 number
  // through its original LID mapping even when it has not supplied a name.
  // Never pretend a number is a person's name in the source roster.
  const fallback=account.channel==='WhatsApp'&&typeof r.phoneFallback==='string'&&
    /^\+\d{5,15}$/.test(r.phoneFallback)?r.phoneFallback:null;
  const c={id:ref,phoneNumber:ref,
   ...(account.channel==='WhatsApp'&&r.contactOrigin?{contactOrigin:r.contactOrigin}:{}),
   ...(account.channel==='WhatsApp'&&r.localNameSaved===true?{localNameSaved:true}:{}),
   contactName:r.nameKnown&&typeof r.name==='string'&&r.name.trim()?r.name:
     fallback??'未知联系人'};
  const ts=instant(r.lastMessageAt);
  if(ts)c.lastActiveAt=ts;
  if(lastMessage)c.lastMessage=lastMessage;
  if(r.contactPreferences&&typeof r.contactPreferences==='object'){
   const p=r.contactPreferences;
   c.contactPreferences={pinned:p.pinned===true,muted:p.muted===true,
    archived:p.archived===true,manualUnread:p.manualUnread===true};
  }
  return c;
 });
}
export function messagesFromHost(room,accountRef,roomRef){
 requireRef(accountRef);requireRef(roomRef);
 if(!room||!ALLOWED.has(room.channel)||room.accountRef!==accountRef||room.roomRef!==roomRef||
    !Array.isArray(room.messages))throw Error('ROOM_SCOPE_MISMATCH');
 const ids=new Set();
 return room.messages.map(m=>{
  if(typeof m.mid!=='string'||!m.mid||m.mid.length>180)throw Error('INVALID_MESSAGE_ID');
  if(ids.has(m.mid))throw Error('DUPLICATE_MESSAGE_ID');
  ids.add(m.mid);
  if(m.direction!=='INBOUND'&&m.direction!=='OUTBOUND')throw Error('INVALID_DIRECTION');
  const ts=instant(m.timestamp);
  if(!ts)throw Error('MESSAGE_TIMESTAMP_UNAVAILABLE');
  const body=typeof m.text==='string'?m.text:'';
  // Use only HTTPS URLs already validated by the mature Page SDK.
  // The upstream MessageView natively renders images, videos and voice notes.
  const media=(Array.isArray(m.media)?m.media:[]).filter(x=>
    x&&['image','sticker','video','audio','file'].includes(x.type)&&
    typeof x.url==='string'&&x.url.startsWith('https://')).slice(0,8);
  const main=media[0],type=main?.type==='file'?'document':main?.type;
  // The Page SDK and Host independently validated these original Facebook
  // links. Preserve only actual source fields; missing preview assets stay absent.
  const pageShares=room.channel==='Page'&&Array.isArray(m.sharePreviews)?
    m.sharePreviews.slice(0,4).filter(s=>{
      if(!s||typeof s.url!=='string')return false;
      try{
       const u=new URL(s.url);
       return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
         ['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch'].includes(u.hostname.toLowerCase());
      }catch{return false}
    }).map(s=>({
      url:s.url,...(typeof s.title==='string'?{title:s.title}:{}),
      ...(typeof s.source==='string'?{source:s.source}:{}),
      ...(typeof s.description==='string'?{description:s.description}:{}),
      ...(typeof s.image==='string'&&/^https:\/\//.test(s.image)?{image:s.image}:{})
    })): [];
  const nativeType=(room.channel==='Personal'||room.channel==='WhatsApp')&&m.hasNativeMedia===true&&
    ['image','video','audio','file'].includes(m.nativeMediaType)?
    (m.nativeMediaType==='file'?'document':m.nativeMediaType):null;
  // Original Matrix IDs come from the already verified Personal room only.
  // A missing quoted event is still shown as a reference with no invented
  // content; no cross-room lookup, alternate mapping or new database.
  const quotedId=room.channel==='Personal'&&typeof m.quotedMessageId==='string'&&
    m.quotedMessageId.startsWith('$')&&m.quotedMessageId.length<=180&&
    m.quotedMessageId!==m.mid&&!/[\x00-\x20\x7f]/.test(m.quotedMessageId)?
    m.quotedMessageId:null;
  const quotedContent=quotedId&&typeof m.quotedContent==='string'?
    m.quotedContent.slice(0,2000):null;
  // Any historical-only or explicitly non-fresh Page snapshot is NOT an
  // authenticated current provider echo. Fail closed when flags disagree.
  const historicalOnly=room.channel==='Page'&&
    room.historicalOnly===true&&room.officialFresh===false;
  // Contradictory or incomplete historical flags must not create a fresh
  // Page echo/sent tick, nor falsely claim a verified historical archive.
  const ambiguousHistory=room.channel==='Page'&&
    (room.historicalOnly===true)!==(room.officialFresh===false);
  const pageHistoryAccepted=room.channel==='Page'&&m.direction==='OUTBOUND'&&
    !historicalOnly&&!ambiguousHistory;
  // Only the original DSH-IM Socket may project a persisted provider
  // DELIVERED/READ receipt for this exact original WhatsApp outbound MID.
  // A Sender submitted/accepted value or local timestamp never qualifies.
  const waKind=m.verifiedAckKind;
  const waState=m.verifiedDeliveryStatus;
  const verifiedWhatsApp=room.channel==='WhatsApp'&&
    m.direction==='OUTBOUND'&&
    m.verifiedAckSource==='ORIGINAL_DSH_IM_SINGLE_SOCKET_VERIFIED'&&
    ['DELIVERED','READ','PLAYED'].includes(waKind)&&
    ['DELIVERED','READ'].includes(waState)&&
    (waState!=='READ'||waKind==='READ'||(waKind==='PLAYED'&&m.nativeMediaType==='audio'));
  // Only the verified original Pancake Page/customer read watermark qualifies.
  const verifiedPageRead=room.channel==='Page'&&m.direction==='OUTBOUND'&&
    !historicalOnly&&!ambiguousHistory&&
    m.verifiedAckSource==='PANCAKE_OFFICIAL_CUSTOMER_READ_WATERMARK'&&
    m.verifiedDeliveryStatus==='READ'&&m.verifiedAckKind==='READ'&&
    typeof m.mid==='string'&&m.mid.startsWith('pancake:');
  const metadata={
    // This is an already-visible original Pancake provider history record,
    // with its genuine MID, NOT a SendResult and NOT proof of delivery/read.
    ...(pageHistoryAccepted?{originalPageHistoryEcho:true}:{}),
    ...(verifiedPageRead?{originalVerifiedAck:'READ',
      originalProviderAckSource:'PANCAKE_OFFICIAL_CUSTOMER_READ_WATERMARK',
      ...(Number.isSafeInteger(m.verifiedAckObservedAt)&&m.verifiedAckObservedAt>0?
        {originalProviderAckObservedAt:m.verifiedAckObservedAt}:{})}:{}),
    ...(historicalOnly?{pageHistoricalOnly:true}:{}),
    ...(verifiedWhatsApp?{
      originalVerifiedAck:waKind,
      originalProviderAckSource:'ORIGINAL_DSH_IM_SINGLE_SOCKET_VERIFIED',
      ...(Number.isSafeInteger(m.verifiedAckObservedAt)&&m.verifiedAckObservedAt>0?
        {originalProviderAckObservedAt:m.verifiedAckObservedAt}:{})
    }:{}),
    ...(m.translation?{verifiedTranslation:m.translation}:{}),
    ...(pageShares.length?{originalFacebookShares:pageShares}:{}),
    ...(media.length>1?{extraAuthenticatedMedia:media.slice(1)}:{}),
    ...(nativeType?{mediaId:m.mid}:{}),
    ...(room.channel==='WhatsApp'&&nativeType&&typeof m.nativeMediaPath==='string'&&
       m.nativeMediaPath.startsWith('/api/yenra/social-read?mode=media&')?
       {nativeMediaPath:m.nativeMediaPath}:{})
  };
  return {id:m.mid,direction:m.direction==='OUTBOUND'?'outbound':'inbound',
   // One tick only: the original provider HISTORY has this outgoing MID.
   // The independent DELIVERED/READ evidence is absent; never promote it.
   ...(verifiedWhatsApp?{status:waState==='READ'?'read':'delivered'}:
       verifiedPageRead?{status:'read'}:
       pageHistoryAccepted?{status:'sent'}:{}),
   content:body,createdAt:ts,phoneNumber:roomRef,
   ...(quotedId?{quotedMessageId:quotedId,
      ...(quotedContent!==null?{quotedContent}:{})}:{}),
   hasMedia:Boolean(main||nativeType),messageType:type??nativeType??(body?'text':'unknown'),
   ...(main?{mediaData:{url:main.url}}:{}),
   ...(Object.keys(metadata).length?{metadata}:{})};
 });
}
/** Bind the mature OSS DeviceConfig.translateDraftToGerman to the ONE
 * existing DSH Host translation route. The passed Session is the existing
 * official YENRA owner Session; server always re-verifies Session and room.
 * The UI can preview, adopt or edit; this callback NEVER sends a chat message.
 */
export function nativeGermanDraftTranslator({channel,accountRef,sessionId,fetchImpl}){
 if(!ALLOWED.has(channel))throw Error('INVALID_TRANSLATION_CHANNEL');
 requireRef(accountRef);
 if(typeof sessionId!=='string'||!/^session-[a-f0-9-]{36}$/.test(sessionId))
  throw Error('OFFICIAL_DSH_SESSION_REQUIRED');
 const request=fetchImpl??globalThis.fetch;
 if(typeof request!=='function')throw Error('ORIGINAL_DSH_HOST_FETCH_UNAVAILABLE');
 return async ({roomRef,sourceText})=>{
  requireRef(roomRef);
  if(typeof sourceText!=='string'||!sourceText.trim()||sourceText.length>1200||
    !/[\u4e00-\u9fff]/.test(sourceText))
   throw Error('INVALID_CHINESE_DRAFT');
  const response=await request('/api/yenra/translate',{
   method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
   body:JSON.stringify({channel,accountRef,roomRef,sessionId,direction:'to-de',
    items:[{id:'draft',text:sourceText.trim()}]})
  });
  const data=await response.json();
  if(!response.ok||data?.ok!==true||
     typeof data.text!=='string'||!data.text.startsWith('YENRA_TRANSLATION_V1:'))
   throw Error(data?.error||'ORIGINAL_DSH_TRANSLATION_FAILED');
  const result=JSON.parse(data.text.slice('YENRA_TRANSLATION_V1:'.length));
  if(result.accountRef!==accountRef||result.roomRef!==roomRef||
     result.direction!=='to-de'||result.items?.length!==1||
     result.items[0]?.id!=='draft'||typeof result.items[0]?.translation!=='string'||
     !result.items[0].translation.trim())
   throw Error('ORIGINAL_DSH_TRANSLATION_SCOPE_MISMATCH');
  return result.items[0].translation.trim();
 };
}

/** Bind only the CURRENT visible authentic Host MIDs to the existing
 * DSH translation route + Storage Domain. No extra translation engine.
 * The actual Host re-checks the account/room/text before any model expense.
 */
export function nativeChineseMessageTranslator({channel,accountRef,sessionId,fetchImpl}){
 if(!ALLOWED.has(channel))throw Error('INVALID_TRANSLATION_CHANNEL');
 requireRef(accountRef);
 if(typeof sessionId!=='string'||!/^session-[a-f0-9-]{36}$/.test(sessionId))
  throw Error('OFFICIAL_DSH_SESSION_REQUIRED');
 const request=fetchImpl??globalThis.fetch;
 if(typeof request!=='function')throw Error('ORIGINAL_DSH_HOST_FETCH_UNAVAILABLE');
 return async ({roomRef,items,cacheOnly=false,cachedOnly=false,signal})=>{
  requireRef(roomRef);
  if(cachedOnly===true&&cacheOnly===true)throw Error('PREVIEW_AND_BATCH_CACHE_MODES_CONFLICT');
  if(!Array.isArray(items)||items.length<1||items.length>8||
    items.some(x=>!x||typeof x.id!=='string'||!x.id||x.id.length>180||
      typeof x.text!=='string'||!x.text.trim()||x.text.length>1200)||
    items.reduce((n,x)=>n+x.text.length,0)>2400||
    new Set(items.map(x=>x.id)).size!==items.length)
   throw Error('INVALID_VISIBLE_MESSAGE_TRANSLATION');
  const response=await request('/api/yenra/translate',{
   method:'POST',cache:'no-store',headers:{'content-type':'application/json'},signal,
   body:JSON.stringify({channel,accountRef,roomRef,sessionId,direction:'to-zh',items,
    ...(cacheOnly===true?{preview:true}:{}),
    ...(cachedOnly===true?{cachedOnly:true}:{})})
  });
  const data=await response.json();
  if(!response.ok||data?.ok!==true||
    typeof data.text!=='string'||!data.text.startsWith('YENRA_TRANSLATION_V1:'))
   throw Error(data?.error||'ORIGINAL_DSH_TRANSLATION_FAILED');
  const result=JSON.parse(data.text.slice('YENRA_TRANSLATION_V1:'.length));
  if(result.accountRef!==accountRef||result.roomRef!==roomRef||
    result.direction!=='to-zh'||!Array.isArray(result.items)||
    result.items.length!==items.length)
   throw Error('ORIGINAL_DSH_TRANSLATION_SCOPE_MISMATCH');
  const byId=new Map();
  for(const row of result.items){
   if(typeof row?.id!=='string'||typeof row?.translation!=='string'||
     (cachedOnly!==true&&!row.translation.trim())||byId.has(row.id))
    throw Error('ORIGINAL_DSH_TRANSLATION_ITEM_INVALID');
   byId.set(row.id,row.translation.trim());
  }
  if(items.some(item=>!byId.has(item.id)))throw Error('ORIGINAL_DSH_TRANSLATION_ID_MISMATCH');
  return items.map(item=>({id:item.id,translation:byId.get(item.id)}));
 };
}

export function paginateMessages(messages,page=1,pageSize=50){
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)
  throw Error('INVALID_PAGINATION');
 const total=messages.length,totalPages=Math.max(1,Math.ceil(total/pageSize));
 const newest=[...messages].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
 const slice=newest.slice((page-1)*pageSize,page*pageSize).reverse();
 return {messages:slice,pagination:{currentPage:page,totalPages,total,hasMore:page<totalPages}};
}
