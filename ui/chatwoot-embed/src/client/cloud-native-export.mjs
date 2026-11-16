/**
 * Chatwoot Cloud -> the existing ChatLume v1.8.6 HTML / offline ZIP renderer.
 * No second message store, sender, UI renderer, or model request.
 * The Cloud page reader upstream has already checked owner/account/room.
 */
import { exportChatAsHTML } from '../../../../social-adapters/oss-candidates/messaging-inbox/src/lib/vendor/chatlume/export.js';

const ACCOUNT_ID=196799;
const MAX_MEDIA_BYTES=32*1024*1024;
const MAX_TOTAL_BYTES=180*1024*1024;
const MAX_HTML_BYTES=48*1024*1024;
const SAFE_HOST=/^(?:app\.chatwoot\.com|[a-z0-9.-]+\.chatwoot\.com|[a-z0-9.-]+\.amazonaws\.com|[a-z0-9.-]+\.cloudfront\.net)$/i;
const cleanName=s=>String(s??'联系人').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').trim().slice(0,72)||'联系人';
const dateOf=x=>{
  const n=Number(x),ms=n>1e12?n:n*1000;
  const t=new Date(ms);
  return Number.isFinite(ms)&&ms>0&&Number.isFinite(t.getTime())?t:null;
};
const safeLink=value=>{
  try{const u=new URL(String(value??''));return u.protocol==='https:'&&SAFE_HOST.test(u.hostname)?u.href:null;}
  catch{return null;}
};
const stop=signal=>{if(signal?.aborted)throw Error('EXPORT_CANCELLED');};
const labelFor=(a,index)=>String(a?.name??('附件-'+(index+1))).slice(0,160);
const mediaKind=a=>{
  const type=String(a?.type??'').toLowerCase();
  if(type.includes('image'))return 'image';
  if(type.includes('video'))return 'video';
  if(type.includes('audio')||type.includes('voice'))return 'audio';
  const name=String(a?.name??'');
  if(/\.(png|jpe?g|webp|gif)$/i.test(name))return 'image';
  if(/\.(mp4|mov|webm)$/i.test(name))return 'video';
  if(/\.(mp3|ogg|wav|m4a)$/i.test(name))return 'audio';
  return 'document';
};
async function readCloudAsset(url,signal,limit=MAX_MEDIA_BYTES,assetReader=null){
  const verified=safeLink(url);
  if(!verified)throw Error('MEDIA_URL_NOT_TRUSTED');
  if(typeof assetReader==='function'){
    try{
      const blob=await assetReader(verified,limit);
      if(!(blob instanceof Blob)||!blob.size||blob.size>limit)
        throw Error('GUEST_MEDIA_SIZE_INVALID');
      stop(signal);
      return blob;
    }catch(error){if(signal?.aborted)throw error;/* Attempt signed-URL CORS next. */}
  }
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,22000);
  try{
    stop(signal);
    const r=await fetch(verified,{signal:controller.signal,credentials:'omit',mode:'cors'});
    if(!r.ok||r.type==='opaque')throw Error('MEDIA_FETCH_FAILED');
    if(Number(r.headers.get('content-length')||0)>limit)throw Error('MEDIA_TOO_LARGE');
    const blob=await r.blob();
    if(!blob.size||blob.size>limit)throw Error('MEDIA_SIZE_INVALID');
    stop(signal);
    return blob;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function inlineImage(blob){
  const b=await blob.arrayBuffer();
  if(b.byteLength>2*1024*1024)return null;
  const arr=new Uint8Array(b);
  let data='';
  for(let i=0;i<arr.length;i+=16384)
    data+=String.fromCharCode(...arr.subarray(i,i+16384));
  return 'data:'+blob.type+';base64,'+btoa(data);
}
export async function exportCloudConversationReport({
  accountId=ACCOUNT_ID,conversationId,contactName,messages,avatarUrl=null,
  format='html',signal,onProgress=()=>{},assetReader=null,ktResults=[]
}={}){
  if(accountId!==ACCOUNT_ID||!Number.isSafeInteger(conversationId)||
     conversationId<=0||!Array.isArray(messages)||messages.length>4000||
     !['html','zip'].includes(format))throw Error('CLOUD_REPORT_SCOPE_INVALID');
  stop(signal);
  const seen=new Set(),items=[],assets=[],now=new Date(),date=now.toISOString().slice(0,10);
  const ktByMessage=new Map();
  for(const result of Array.isArray(ktResults)?ktResults.slice(0,150):[]){
    if(!Number.isSafeInteger(result?.messageId)||result.messageId<=0||
       !['duplicate','not_duplicate','unknown'].includes(result?.status)||
       typeof result.masked!=='string'||result.masked.length>40)continue;
    const n=Number(result.repeatCount);
    ktByMessage.set(result.messageId,{
      status:result.status,masked:result.masked,
      count:Number.isSafeInteger(n)&&n>=0&&n<100000?n:null});
  }
  const ordered=[...messages].sort((a,b)=>
    (dateOf(a.original_timestamp||a.created_at)?.getTime()??0)-
    (dateOf(b.original_timestamp||b.created_at)?.getTime()??0)||
    Number(a.id)-Number(b.id));
  let previousDay='',count=0,incoming=0,outgoing=0;
  for(const m of ordered){
    stop(signal);
    if(!Number.isSafeInteger(m?.id)||m.id<=0||seen.has(m.id)||
       ![0,1,2,3].includes(m.message_type))continue;
    seen.add(m.id);count++;
    const at=dateOf(m.original_timestamp||m.created_at);
    const day=at?at.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'}):'时间未知';
    if(day!==previousDay){items.push({type:'date',label:day});previousDay=day;}
    if(m.message_type===2||m.message_type===3){
      items.push({type:'system',text:String(m.content||'系统消息')});continue;
    }
    const mine=m.message_type===1;
    if(mine)outgoing++;else incoming++;
    const original=String(m.content??'');
    const translated=typeof m.savedZh==='string'?m.savedZh.trim():'';
    let text=translated&&translated!==original?original+'\n译文：'+translated:original;
    // KT is a separate verified user-requested lookup, never a chat message.
    // Bind only an existing finished result to the exact inbound Cloud MID.
    const kt=!mine?ktByMessage.get(m.id):null;
    if(kt){
      const outcome=kt.status==='duplicate'&&kt.count!==null?'重复 '+kt.count+' 次':
        kt.status==='not_duplicate'?'未重复 · 0 次':'KT 未知结果（不能当成 0 次）';
      text+='\nKT 查询结果（导出时已完成）：'+(kt.masked||'号码')+' · '+outcome;
    }
    const attachments=Array.isArray(m.attachments)?m.attachments:[];
    const media=attachments.slice(0,12).map((a,i)=>{
      const id='cloud-'+conversationId+'-'+m.id+'-'+(Number.isSafeInteger(a?.id)?a.id:i);
      const info={id,kind:mediaKind(a),name:labelFor(a,i)};
      assets.push({...info,url:safeLink(a?.url)});
      return info;
    });
    items.push({type:'msg',sender:mine?'我':String(contactName??'联系人'),
      time:at?at.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'',
      isMe:mine,text, ...(media.length?{media}:{}),
    });
  }
  if(!count)throw Error('CLOUD_REPORT_NO_MESSAGES');
  const mediaStore=new Map(),failures=[];
  let bytes=0;
  const add=(id,name,blob)=>{
    bytes+=blob.size;
    if(bytes>MAX_TOTAL_BYTES||(format==='html'&&bytes>MAX_HTML_BYTES))
      throw Error('MEDIA_EXPORT_LIMIT_REACHED');
    mediaStore.set(id,{name,mime:blob.type||'application/octet-stream',
      entry:{async getData(){return blob;}}});
  };
  let avatar=null;
  const trustedAvatar=safeLink(avatarUrl);
  if(trustedAvatar){
    try{
      const blob=await readCloudAsset(trustedAvatar,signal,2*1024*1024,assetReader);
      if(/^image\/(png|jpeg|webp|gif)$/i.test(blob.type)){
        avatar={id:'cloud-'+conversationId+'-avatar',kind:'image',name:'contact-avatar.jpg'};
        add(avatar.id,avatar.name,blob);
      }
    }catch(e){if(signal?.aborted)throw e;}
  }
  if(format==='zip'||format==='html'){
    for(let i=0;i<assets.length;i++){
      stop(signal);
      const a=assets[i];
      if(!a.url){failures.push({id:a.id,reason:'附件无可下载地址'});continue;}
      try{
        const blob=await readCloudAsset(a.url,signal,
          format==='html'?20*1024*1024:MAX_MEDIA_BYTES,assetReader);
        add(a.id,a.name,blob);
      }catch(e){
        if(signal?.aborted)throw e;
        failures.push({id:a.id,reason:e?.message||'媒体下载失败'});
      }
      onProgress({stage:'media',received:i+1,total:assets.length});
    }
  }
  const notes=['来源：当前授权的 Chatwoot Cloud 会话；只包含 Cloud 返回的记录，不会虚构缺失历史。'];
  if(format==='html'&&assets.length)
    notes.push('本 HTML 内嵌可获取的媒体；超大或无法读取的附件会保留占位。');
  if(failures.length)
    notes.push('有 '+failures.length+' 项附件无法下载，ZIP 不代表完整媒体备份。');
  // Count only true natural-language translation misses, not phone numbers,
  // emoji-only messages, media placeholders or already-Chinese originals.
  const missingZh=ordered.filter(m=>[0,1].includes(m.message_type)&&
    m.private!==true&&typeof m.content==='string'&&m.content.trim()&&
    /\p{L}/u.test(m.content)&&!/[\u3400-\u9fff]/u.test(m.content)&&
    !(typeof m.savedZh==='string'&&/[\u3400-\u9fff]/u.test(m.savedZh))).length;
  if(missingZh)notes.push('有 '+missingZh+' 条消息没有可用的已保存中文译文；原文已保留。');
  const filename='YENRA-'+cleanName(contactName)+'-'+date+'.'+(format==='zip'?'zip':'html');
  const result=await exportChatAsHTML({
    filename,theme:'whatsapp',colorScheme:'light',title:String(contactName??'联系人'),
    messages:[{type:'system',text:notes.join(' ')},...items],messageCount:count,
    includeAttachments:format==='zip',embedMedia:format==='html',mediaStore,avatar,
    exportSummary:{source:'Chatwoot Cloud',accountId,conversationId,exportedMessages:count,
      incoming,outgoing,attachments:assets.length,downloadedAttachments:assets.length-failures.length,
      missingMedia:failures,partialHistoryPossible:true},
    isCancelled:()=>Boolean(signal?.aborted),download:false
  });
  if(!(result.blob instanceof Blob)||!result.blob.size)throw Error('CLOUD_REPORT_BUILD_FAILED');
  return {filename:result.filename??filename,blob:result.blob,messageCount:count,
    attachmentLinks:assets.length,attachmentCount:result.attachmentCount,
    missingAttachments:failures.length,format};
}
