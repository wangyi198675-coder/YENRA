/**
 * Read-only, on-demand export of an already owner-verified Cloud attachment.
 * The Cloud Guest is already logged in; it alone owns its cookies.
 * This script cannot send a message, select a contact or access local files.
 */
export const CLOUD_EXPORT_MEDIA_SCRIPT=String.raw`(()=>{
  if(location.origin!=='https://app.chatwoot.com')return false;
  const key='__yenraCloudExportMediaV1';
  if(window[key]?.readAsset)return true;
  window[key]={
    async readAsset(conversationId,rawUrl,limit){
      const match=/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/u.exec(location.pathname);
      if(!match||Number(match[1])!==conversationId||
         !Number.isSafeInteger(conversationId)||conversationId<=0||
         !Number.isSafeInteger(limit)||limit<=0||limit>32*1024*1024)
        throw Error('CLOUD_MEDIA_CONTEXT_INVALID');
      const url=new URL(String(rawUrl));
      const host=url.hostname;
      if(url.protocol!=='https:'||
         !(host==='app.chatwoot.com'||host.endsWith('.chatwoot.com')||
           host.endsWith('.amazonaws.com')||host.endsWith('.cloudfront.net')))
        throw Error('CLOUD_MEDIA_HOST_INVALID');
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),22000);
      try{
        const response=await fetch(url.href,{
          credentials:url.origin===location.origin?'include':'omit',
          signal:ctrl.signal
        });
        if(!response.ok||response.type==='opaque'||
           Number(response.headers.get('content-length')||0)>limit)
          throw Error('CLOUD_MEDIA_FETCH_FAILED');
        const blob=await response.blob();
        if(!blob.size||blob.size>limit)throw Error('CLOUD_MEDIA_SIZE_LIMIT');
        return await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result);
          reader.onerror=()=>reject(Error('CLOUD_MEDIA_READ_FAILED'));
          reader.readAsDataURL(blob);
        });
      }finally{clearTimeout(timer)}
    }
  };
  return true;
})()`;