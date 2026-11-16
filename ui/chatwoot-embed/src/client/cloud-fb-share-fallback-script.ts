/** Official Facebook shared public photo preview inside the existing Chatwoot fallback bubble. */
export const CLOUD_FB_SHARE_FALLBACK_SCRIPT=String.raw`(()=>{
 if(location.origin!=='https://app.chatwoot.com')return false;
 const key='__yenraCloudFbShareFallbackV1';
 if(window[key]?.set){window[key].paint();return true}
 let conversationId=0,links=[],queued=false;
 const changedTexts=new Map();
 const restoreLabels=()=>{
   for(const [node,original] of changedTexts){
     if(node.isConnected&&['Facebook \u7167\u7247\u5206\u4eab','Facebook \u89c6\u9891\u5206\u4eab','Facebook \u5206\u4eab\u5185\u5bb9'].includes(node.textContent))node.textContent=original;
   }
   changedTexts.clear();
 };
 const drop=()=>{
   document.querySelectorAll('[data-yenra-fb-share-link],[data-yenra-fb-photo-preview]').forEach(el=>el.remove());
   restoreLabels();
 };
 const localize=(target,link)=>{
   const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);
   const nodes=[];
   while(walker.nextNode()){
     const n=walker.currentNode;
     if(n.textContent.trim()==='Attachment Unavailable')nodes.push(n);
   }
   const label=link.photoId?'Facebook \u7167\u7247\u5206\u4eab':
     /^https:\/\/www\.facebook\.com\/(?:videos|reel|watch)\//u.test(link.url)?'Facebook \u89c6\u9891\u5206\u4eab':
     'Facebook \u5206\u4eab\u5185\u5bb9';
   for(const node of nodes){changedTexts.set(node,node.textContent);node.textContent=label;}
 };
 const paint=()=>{
   queued=false;
   const match=/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/u.exec(location.pathname);
   if(!match||Number(match[1])!==conversationId){drop();return}
   const validIds=new Set(links.map(x=>String(x.messageId)));
   for(const el of document.querySelectorAll('[data-yenra-fb-share-link],[data-yenra-fb-photo-preview]')){
     if(!validIds.has(el.getAttribute('data-yenra-msg'))||
       !el.closest('[data-message-id="'+el.getAttribute('data-yenra-msg')+'"]'))el.remove();
   }
   for(const link of links){
     const row=document.querySelector('[data-message-id="'+link.messageId+'"]');
     const target=row?.querySelector('[data-bubble-name="fallback"]');
     if(!target)continue;
     localize(target,link);
     let anchor=target.querySelector('[data-yenra-fb-share-link]');
     if(!anchor){
       anchor=document.createElement('a');
       anchor.setAttribute('data-yenra-fb-share-link','1');
       anchor.setAttribute('data-yenra-msg',String(link.messageId));
       anchor.setAttribute('target','_blank');
       anchor.setAttribute('rel','noopener noreferrer');
       anchor.textContent='\u67e5\u770b Facebook \u539f\u5e16';
       anchor.style.cssText='display:block;margin-top:6px;text-decoration:underline;font-size:12px;overflow-wrap:anywhere;color:inherit';
       target.appendChild(anchor);
     }
     if(anchor.getAttribute('href')!==link.url)anchor.setAttribute('href',link.url);
     let preview=target.querySelector('[data-yenra-fb-photo-preview]');
     if(link.photoId&&/^\d{10,25}$/u.test(link.photoId)){
       if(preview?.getAttribute('data-photo-id')!==link.photoId){preview?.remove();preview=null}
       if(!preview){
         const url=new URL('https://www.facebook.com/plugins/post.php');
         url.searchParams.set('href','https://www.facebook.com/photo/?fbid='+link.photoId);
         url.searchParams.set('show_text','false');
         url.searchParams.set('width','320');
         preview=document.createElement('iframe');
         preview.setAttribute('data-yenra-fb-photo-preview','1');
         preview.setAttribute('data-yenra-msg',String(link.messageId));
         preview.setAttribute('data-photo-id',link.photoId);
         preview.setAttribute('title','Facebook \u7167\u7247\u9884\u89c8');
         preview.setAttribute('loading','lazy');
         preview.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
         preview.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups');
         preview.setAttribute('src',url.href);
         preview.setAttribute('width','320');
         preview.setAttribute('height','540');
         preview.style.cssText='display:block;border:0;max-width:100%;width:320px;height:540px;margin:8px 0 2px;background:transparent';
         target.insertBefore(preview,anchor);
       }
     }else if(preview)preview.remove();
   }
 };
 const schedule=()=>{if(queued)return;queued=true;queueMicrotask(paint)};
 const observer=new MutationObserver(schedule);
 observer.observe(document.documentElement,{childList:true,subtree:true});
 window[key]={
   set(id,input){
     if(!Number.isSafeInteger(id)||id<=0||!Array.isArray(input)||input.length>20){
       conversationId=0;links=[];drop();return false;
     }
     const out=[];
     for(const item of input){
       if(!Number.isSafeInteger(item?.messageId)||item.messageId<=0||
          typeof item.url!=='string'||item.url.length>450)continue;
       let u;try{u=new URL(item.url)}catch{continue}
       if(u.protocol!=='https:'||u.hostname!=='www.facebook.com'||
          !(/^\/share\/(?:[A-Za-z0-9]+|[pv]\/[A-Za-z0-9]+)\/?$/u.test(u.pathname)&&!u.search||
            /^\/photo\/?$/u.test(u.pathname)&&/^\d{10,25}$/u.test(u.searchParams.get('fbid')??'')&&
              [...u.searchParams.keys()].every(k=>k==='fbid')||
            /^\/(?:reel|videos|posts)\/\d{8,25}\/?$/u.test(u.pathname)&&!u.search||
            /^\/watch\/?$/u.test(u.pathname)&&/^\d{8,25}$/u.test(u.searchParams.get('v')??'')&&
              [...u.searchParams.keys()].every(k=>k==='v')))continue;
       const photoId=typeof item.photoId==='string'&&/^\d{10,25}$/u.test(item.photoId)?item.photoId:null;
       out.push({messageId:item.messageId,url:u.href,photoId});
     }
     if(conversationId===id&&JSON.stringify(links)===JSON.stringify(out)){schedule();return true}
     conversationId=id;links=out;drop();schedule();return true;
   },
   paint:schedule,
   clear(){conversationId=0;links=[];drop()},
   disconnect(){observer.disconnect();this.clear()},
   inspect(){return {conversationId,links:links.length,
      painted:document.querySelectorAll('[data-yenra-fb-share-link]').length,
      photoPreviews:document.querySelectorAll('[data-yenra-fb-photo-preview]').length}}
 };
 schedule();
 return true;
})()`;
