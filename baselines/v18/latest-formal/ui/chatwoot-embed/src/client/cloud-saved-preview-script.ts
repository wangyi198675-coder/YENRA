/**
 * Display-only Cloud native conversation list snippet view.
 * No API credentials or outbound calls; receives Cloud-saved zh_CN plus
 * verified latest-message descriptors for cache-only existing DSH lookup.
 * Never rewrites native message records, routing, avatars or click handlers.
 */
export const CLOUD_SAVED_PREVIEW_SCRIPT=String.raw`(()=>{
 if(!/^\/app\/accounts\/196799\//u.test(location.pathname))return false;
 const key='__yenraCloudSavedPreviewV1';
 if(window[key]?.refresh&&window[key].version===2){window[key].refresh();return true}
 // An older guest observer cannot acquire the new DSH cache methods just
 // by refresh(). Retire it in place; do not reload Cloud or lose drafts.
 window[key]?.disconnect?.()
 const tidy=value=>String(value??'').trim().replace(/\s+/gu,' ');
 let rows=[],mounted=null,signature='',queued=false,lastSignal=0;
 const liveMap=new WeakMap();
 const signal=()=>{
   const now=Date.now();
   if(now-lastSignal<2400)return;
   lastSignal=now;
   console.info('YENRA_CLOUD_SAVED_PREVIEW_DIRTY');
 };
 const refresh=()=>{
   queued=false;
   const list=document.querySelector('.conversations-list');
   if(!list)return;
   const nodes=[...list.querySelectorAll('.conversation')];
   const unique=new Map();
   for(const row of rows){
     const name=tidy(row.name),original=tidy(row.original);
     // A missing translation still participates in ambiguity detection:
     // another person's identical name+text must not inherit this Chinese.
     if(!name||!original)continue;
     const k=name+'\u0001'+original;
     if(unique.has(k))unique.set(k,null);
     else unique.set(k,row);
   }
   const seen=[];
   const visibleCounts=new Map();
   for(const el of nodes){
     const span=el.children?.[1]?.children?.[2]?.querySelector('span:last-child');
     const name=tidy(el.querySelector('.conversation--user')?.textContent);
     if(!span||!name)continue;
     const state=liveMap.get(span);
     const current=tidy(span.textContent);
     const original=state&&name===state.name&&current===tidy(state.translation)
       ?state.original:current;
     const key=name+'\u0001'+tidy(original);
     visibleCounts.set(key,(visibleCounts.get(key)??0)+1);
   }
   for(const el of nodes){
     const preview=el.children?.[1]?.children?.[2];
     const span=preview?.querySelector('span:last-child');
     const name=tidy(el.querySelector('.conversation--user')?.textContent);
     if(!span||!name)continue;
     const state=liveMap.get(span);
     const current=tidy(span.textContent);
     // A virtualized row may be recycled for another person or a new message.
     // A previous YENRA title is NOT proof of the currently rendered message.
     const previousStillCurrent=!!state&&name===state.name&&
       current===tidy(state.translation);
     // If native virtualizer has changed the contact but has not yet
     // replaced our text, NEVER display the old person's translation.
     if(state&&name!==state.name&&current===tidy(state.translation)){
       span.textContent='';
       if(span.title?.startsWith('原文：'))span.removeAttribute('title');
       liveMap.delete(span);
       continue;
     }
     if(state&&!previousStillCurrent){
       if(span.title?.startsWith('原文：'))span.removeAttribute('title');
       liveMap.delete(span);
     }
     const original=previousStillCurrent?state.original:current;
     const k=name+'\u0001'+original;
     seen.push(k);
     const match=visibleCounts.get(k)===1?unique.get(k):null;
     if(!match||!tidy(match.translation)||!original){
       if(previousStillCurrent){
         span.textContent=state.original;
         if(span.title?.startsWith('原文：'))span.removeAttribute('title');
         liveMap.delete(span);
       }
       continue;
     }
     if(current!==tidy(match.translation)){
       span.textContent=match.translation;
       span.title='原文：'+original;
     }
     liveMap.set(span,{name,original,translation:match.translation,
       messageId:match.messageId});
   }
   const s=seen.join('\u0002');
   if(signature&&s!==signature)signal();
   signature=s;
 };
 const schedule=()=>{
   if(queued)return;
   queued=true;
   queueMicrotask(refresh);
 };
 const targetObserver=new MutationObserver(schedule);
 const rootObserver=new MutationObserver(mutations=>{
   if(mounted?.isConnected)return;
   const list=document.querySelector('.conversations-list');
   if(list&&list!==mounted){
     targetObserver.disconnect();
     targetObserver.observe(list,{subtree:true,childList:true,characterData:true});
     mounted=list;
     signature='';
     schedule();signal();
   }
 });
 rootObserver.observe(document.body,{childList:true,subtree:true});
 const attach=()=>{
   const list=document.querySelector('.conversations-list');
   if(list&&list!==mounted){
     targetObserver.disconnect();
     targetObserver.observe(list,{subtree:true,childList:true,characterData:true});
     mounted=list;signature='';
   }
   schedule();
 };
 window[key]={
   version:2,
   set(input){
     if(!Array.isArray(input)||input.length>240)return false;
     const previous=new Map(rows.filter(x=>x.cachedOnly===true&&tidy(x.translation)).map(x=>[
       x.conversationId+':'+x.contactId+':'+x.messageId+':'+x.name+':'+x.original,x.translation]));
     rows=input.filter(x=>Number.isSafeInteger(x.conversationId)&&x.conversationId>0&&
       Number.isSafeInteger(x.contactId)&&x.contactId>0&&
       Number.isSafeInteger(x.messageId)&&x.messageId>0&&
       typeof x.name==='string'&&typeof x.original==='string'&&
       typeof x.translation==='string').map(x=>{
       // Cache-only DSH text is UI state, never a second authority. Reuse it
       // only when the latest Cloud MID, contact and original are unchanged.
       if(tidy(x.translation))return x;
       const cached=previous.get(x.conversationId+':'+x.contactId+':'+x.messageId+':'+x.name+':'+x.original);
       return cached?{...x,translation:cached,cachedOnly:true}:{...x,cachedOnly:false};
     });
     attach();return true;
   },
   visibleMissing(limit=16){
     const list=document.querySelector('.conversations-list');
     if(!list)return [];
     const visible=new Map();
     for(const el of list.querySelectorAll('.conversation')){
       const span=el.children?.[1]?.children?.[2]?.querySelector('span:last-child');
       const name=tidy(el.querySelector('.conversation--user')?.textContent);
       if(!span||!name)continue;
       const state=liveMap.get(span);
       const original=state&&state.name===name&&
         tidy(span.textContent)===tidy(state.translation)?state.original:tidy(span.textContent);
       const key=name+'\u0001'+tidy(original);
       visible.set(key,(visible.get(key)??0)+1);
     }
     const byText=new Map();
     for(const row of rows){
       if(tidy(row.translation))continue;
       const key=tidy(row.name)+'\u0001'+tidy(row.original);
       if(byText.has(key))byText.set(key,null);
       else byText.set(key,row);
     }
     return [...byText.entries()].filter(([key,row])=>row&&visible.get(key)===1)
       .map(([,row])=>row).slice(0,Math.min(24,Math.max(1,Number(limit)||16)));
   },
   mergeCached(input){
     if(!Array.isArray(input)||input.length>24)return 0;
     let accepted=0;
     for(const item of input){
       if(!item||!Number.isSafeInteger(item.conversationId)||
         !Number.isSafeInteger(item.contactId)||!Number.isSafeInteger(item.messageId)||
         typeof item.name!=='string'||typeof item.original!=='string'||
         typeof item.translation!=='string'||item.translation.length>2000||
         !/[\u3400-\u9fff]/u.test(item.translation))continue;
       const row=rows.find(x=>x.conversationId===item.conversationId&&
         x.contactId===item.contactId&&x.messageId===item.messageId&&
         x.name===item.name&&x.original===item.original);
       if(!row||tidy(row.translation))continue;
       row.translation=item.translation;row.cachedOnly=true;accepted++;
     }
     if(accepted)attach();
     return accepted;
   },
   refresh:attach,
   inspect:()=>({cached:rows.length,mounted:!!mounted?.isConnected,visibleCards:document.querySelectorAll(".conversations-list .conversation").length}),
   disconnect(){targetObserver.disconnect();rootObserver.disconnect()}
 };
 attach();signal();
 return true;
})()`;
