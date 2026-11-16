/**
 * Thin DSH Host read-only attachment relay over the EXISTING Cloud Bridge.
 * Every request revalidates account/conversation/contact through the original
 * Cloud export-page route. No new login, database, cache or sender.
 */
const ID=x=>Number.isSafeInteger(x)&&x>0;
const ALLOWED_HOST=x=>
  x==='app.chatwoot.com'||x.endsWith('.chatwoot.com')||
  x.endsWith('.amazonaws.com')||x.endsWith('.cloudfront.net');
const MAX_BYTES=32*1024*1024;
const safeAssetUrl=input=>{
  const url=new URL(String(input??''));
  if(url.protocol!=='https:'||!ALLOWED_HOST(url.hostname))
    throw Error('CLOUD_ASSET_UNTRUSTED_HOST');
  return url;
};
function inspectArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
     args.accountId!==196799||!ID(args.conversationId)||
     !(args.before===undefined||ID(args.before)))
    throw Error('CLOUD_ASSET_SCOPE_INVALID');
  const keys=Object.keys(args).sort().join(',');
  if(args.avatar===true){
    if(keys!=='accountId,avatar,conversationId'&&
       keys!=='accountId,avatar,before,conversationId')
      throw Error('CLOUD_ASSET_AVATAR_SCOPE_INVALID');
  }else{
    if(!ID(args.messageId)||!(ID(args.attachmentId)||
       (Number.isSafeInteger(args.attachmentIndex)&&
        args.attachmentIndex>=0&&args.attachmentIndex<12)))
      throw Error('CLOUD_ASSET_MESSAGE_INVALID');
    const allowed=new Set(['accountId','conversationId','before','messageId',
      'attachmentId','attachmentIndex']);
    if(Object.keys(args).some(k=>!allowed.has(k)))
      throw Error('CLOUD_ASSET_MESSAGE_SCOPE_INVALID');
  }
  return args;
}
async function verifiedDownload(url,fetchImpl,maxBytes){
  let asset=safeAssetUrl(url);
  for(let hop=0;hop<4;hop++){
    const response=await fetchImpl(asset.href,{
      method:'GET',redirect:'manual',cache:'no-store',
      signal:AbortSignal.timeout(24000),
    });
    if([301,302,303,307,308].includes(response.status)){
      const next=response.headers.get('location');
      if(!next)throw Error('CLOUD_ASSET_REDIRECT_MISSING');
      asset=safeAssetUrl(new URL(next,asset).href);
      continue;
    }
    if(!response.ok)throw Error('CLOUD_ASSET_FETCH_FAILED');
    const mime=String(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    if(!/^(?:image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime)|audio\/[\w.+-]+|application\/(?:pdf|octet-stream|zip))$/u.test(mime))
      throw Error('CLOUD_ASSET_MIME_REJECTED');
    if(Number(response.headers.get('content-length')||0)>maxBytes)
      throw Error('CLOUD_ASSET_SIZE_LIMIT');
    const parts=[];let received=0;
    if(!response.body)throw Error('CLOUD_ASSET_BODY_MISSING');
    const reader=response.body.getReader();
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      received+=value.byteLength;
      if(received>maxBytes){
        await reader.cancel().catch(()=>{});
        throw Error('CLOUD_ASSET_SIZE_LIMIT');
      }
      parts.push(value);
    }
    if(!received)throw Error('CLOUD_ASSET_EMPTY');
    const bytes=Buffer.concat(parts.map(p=>Buffer.from(p)),received);
    return {bytes,mime};
  }
  throw Error('CLOUD_ASSET_TOO_MANY_REDIRECTS');
}
export async function readVerifiedCloudAsset({args,bridgeOrigin,fetchImpl=fetch}={}){
  const selection=inspectArgs(args);
  const pageArgs={accountId:196799,conversationId:selection.conversationId,
    ...(selection.before?{before:selection.before}:{})};
  const pageReply=await fetchImpl(new URL('/yenra-cloud/export-page',bridgeOrigin),{
    method:'POST',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(15000),
    headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-export':'1'},
    body:JSON.stringify(pageArgs),
  });
  if(!pageReply.ok)throw Error('CLOUD_ASSET_SOURCE_UNAVAILABLE');
  const page=await pageReply.json();
  if(page?.ok!==true||page.accountId!==196799||
     page.conversationId!==selection.conversationId||
     !ID(page.contactId)||!ID(page.inboxId)||
     !Array.isArray(page.rows)||page.rows.length>30)
    throw Error('CLOUD_ASSET_SOURCE_NOT_VERIFIED');
  let assetUrl;
  if(selection.avatar===true)assetUrl=page.avatarUrl;
  else{
    const message=page.rows.find(m=>m?.id===selection.messageId);
    if(!message||!Array.isArray(message.attachments))throw Error('CLOUD_ASSET_MESSAGE_NOT_FOUND');
    const found=ID(selection.attachmentId)
      ?message.attachments.find(a=>a?.id===selection.attachmentId)
      :message.attachments[selection.attachmentIndex];
    assetUrl=found?.url;
  }
  return verifiedDownload(assetUrl,fetchImpl,MAX_BYTES);
}
