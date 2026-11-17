/** Cloud UI display adapter: all model calls remain in the original DSH Host. */
export const CLOUD_DSH_TRANSLATOR_SCRIPT=String.raw`(()=>{
 if(!/^\/app\/accounts\/196799\//u.test(location.pathname))return false;
 const key='__yenraDshCloudTranslatorV1';
 const state={busy:false,allowOnce:false,source:'',conversationId:0,notifyAt:0,
  adoption:null,translations:new Map()};
 const conversation=()=>{
  const m=/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/u.exec(location.pathname);
  return m?Number(m[1]):null;
 };
 const editor=()=>document.querySelector('.ProseMirror[contenteditable="true"]');
 const send=()=>[...document.querySelectorAll('button')].find(b=>
  /^(发送|Send)(?:\s*\(|\s*$)/iu.test((b.textContent??'').trim())&&
  !b.disabled);
 const content=()=>String(editor()?.innerText??editor()?.textContent??'').trim();
 const han=s=>/[\u3400-\u9fff]/u.test(s);
 // Native Cloud Copilot is an independent response surface, not a message
 // bubble. Keep every original-language recommendation and its official
 // "Use this" button untouched. Translation is display-only, outside that
 // button's answer container, using the SAME original DSH translator.
 const copilotNodes=()=>{
  const id=conversation();
  if(!id)return null;
  const buttons=[...document.querySelectorAll('button')]
   .filter(b=>/^(?:使用此|Use this)$/iu.test((b.textContent??'').trim()));
  const answer=buttons.at(-1)?.parentElement?.parentElement;
  if(!answer?.classList.contains('text-n-slate-12'))return null;
  const texts=[...answer.querySelectorAll('p')]
   .filter(p=>!p.closest('[data-yenra-copilot-zh]'))
   .map(p=>String(p.textContent??'').trim()).filter(Boolean);
  if(!texts.length||texts.length>5||texts.some(s=>
   s.length>850||han(s)||!/\p{L}/u.test(s))||
   texts.join('').length>1800)return null;
  return {conversationId:id,answer,texts};
 };
 const copilotSuggestions=()=>{
  const current=copilotNodes();
  return current?{conversationId:current.conversationId,texts:current.texts}:null;
 };
 const paintCopilot=(conversationId,sources,items)=>{
  const current=copilotNodes();
  if(!current||current.conversationId!==conversationId||
   !Array.isArray(sources)||!Array.isArray(items)||
   JSON.stringify(current.texts)!==JSON.stringify(sources)||
   sources.length!==items.length)return false;
  const translations=[];
  for(let i=0;i<sources.length;i++){
   const item=items[i];
   if(item?.id!==i+1||typeof item.translation!=='string'||
    !han(item.translation)||item.translation.length>3500)return false;
   translations.push(item.translation.trim());
  }
  const wrapper=document.createElement('section');
  wrapper.setAttribute('data-yenra-copilot-zh','');
  wrapper.setAttribute('aria-label','Copilot 中文译文');
  wrapper.style.cssText='margin:8px 0 14px;padding:10px 11px;border-radius:8px;background:rgba(128,128,128,.09);font-size:13px;line-height:1.55;overflow-wrap:anywhere;';
  for(let i=0;i<translations.length;i++){
   const line=document.createElement('p');
   line.style.cssText='margin:0 0 9px;white-space:pre-wrap;';
   const heading=document.createElement('span');
   heading.style.cssText='opacity:.72;font-size:11px;margin-right:5px;';
   heading.textContent='中文 '+(i+1)+'.';
   line.append(heading,document.createTextNode(translations[i]));
   wrapper.appendChild(line);
  }
  const previous=current.answer.nextElementSibling;
  if(previous?.hasAttribute('data-yenra-copilot-zh')){
   const existing=[...previous.querySelectorAll('p')].map(p=>p.textContent??'');
   if(existing.length===translations.length&&existing.every((value,i)=>
    value==='中文 '+(i+1)+'.'+translations[i]))return true;
   previous.remove();
  }
  current.answer.insertAdjacentElement('afterend',wrapper);
  return true;
 };
 const adoptDraft=(conversationId,text)=>{
  if(conversationId!==conversation()||state.busy||state.allowOnce||
     window[key]?.draft?.()||typeof text!=='string'||!text.trim()||
     text.length>2000||han(text))return false;
  const el=editor();
  if(!el||!el.isConnected||el.closest('[inert]'))return false;
  const value=text.trim();
  if(content()===value){window[key]?.recordAdopt?.(conversationId);return true;}
  if(content())return false;
  el.focus();
  const range=document.createRange();range.selectNodeContents(el);
  const selection=window.getSelection();
  if(!selection)return false;
  selection.removeAllRanges();selection.addRange(range);
  if(!document.execCommand('insertText',false,value))return false;
  const accepted=conversation()===conversationId&&content()===value;
  if(accepted)window[key]?.recordAdopt?.(conversationId);
  return accepted;
 };
 // Restore Chatwoot's right-click Translate even when its optional Google
 // integration is disabled. The action is only a candidate MID; the original
 // DSH Host verifies the exact Cloud conversation, contact and message.
 // Reuse the SAME existing Cloud/DSH translation cache and bubble renderer.
 const manualKey='__yenraDshCloudManualTranslateV1';
 if(!window[manualKey]){
  const manual={
   last:null,
   feedback:(cid,mid,value,problem=false)=>{
    if(conversation()!==cid)return false;
    const row=document.querySelector('[data-message-id="'+mid+'"]');
    if(!row)return false;
    let label=row.querySelector('[data-yenra-manual-translation-status]');
    // Completion is represented by the actual bilingual message content,
    // never a free-floating status appended to the whole message row.
    if(!problem&&/^(?:翻译完成|译文已保存)/u.test(String(value??''))){
     label?.remove();return true;
    }
    const body=getParts(row)?.body;
    if(!body)return false;
    if(!label){
     label=document.createElement('span');
     label.setAttribute('data-yenra-manual-translation-status','');
     label.setAttribute('role','status');
     label.style.cssText='display:block;font-size:11px;line-height:1.4;opacity:.72;margin:0;color:inherit;';
     body.appendChild(label);
    }
    const notice=String(value??'').slice(0,100);
    label.textContent=notice;
    label.style.color=problem?'#e18484':'inherit';
    // The original Host now aborts a manual request after 45 seconds.
    // A lost callback must not pin a permanent busy status in the guest.
    if(/^正在通过 YENRA 翻译/u.test(notice)){
     setTimeout(()=>{
      if(conversation()!==cid||!label?.isConnected||
         row.querySelector('[data-yenra-manual-translation-status]')!==label||
         label.textContent!==notice)return;
      label.textContent='翻译等待超时，请重试';
      label.style.color='inherit';
      setTimeout(()=>{if(label.isConnected&&label.textContent==='翻译等待超时，请重试')label.remove()},6000);
     },48000);
    }else if(problem){
     // Failures are transient hints, not permanent red badges.
     setTimeout(()=>{if(label.isConnected&&label.textContent===notice)label.remove()},6000);
    }
    return true;
   }
  };
  document.addEventListener('contextmenu',event=>{
   const el=event.target?.closest?.('[data-message-id]');
   const id=Number(el?.getAttribute?.('data-message-id'));
   const cid=conversation();
   manual.last=(cid&&Number.isSafeInteger(id)&&id>0&&
    el?.querySelector?.('[data-bubble-name="text"]'))
     ?{conversationId:cid,messageId:id,when:Date.now()}:null;
  },true);
  document.addEventListener('click',event=>{
   const active=manual.last;
   if(!active||Date.now()-active.when>12000||
      active.conversationId!==conversation()){manual.last=null;return;}
   let node=event.target,matched=false;
   for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
    if(/^(?:翻译|Translate)$/iu.test(String(node.textContent??'').trim())){
     matched=true;break;
    }
   }
   if(!matched)return;
   manual.last=null;
   console.info('YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:'+
    active.conversationId+':'+active.messageId);
   manual.feedback(active.conversationId,active.messageId,'正在通过 YENRA 翻译…');
   // Allow the native menu to dismiss normally. Its disabled Google handler
   // cannot create an authoritative translation; DSH provides the result.
  },true);
  window[manualKey]=manual;
 }
 // Chatwoot Cloud may not render a native Translate action when its optional
 // Google integration is unavailable. Listening for an absent menu click
 // cannot recover the command. Show one explicit, theme-aware fallback action
 // on a verified TEXT bubble only when no enabled native action is visible.
 // Do not prevent the native context menu, intercept Copy, or call the model
 // until the owner actually clicks the fallback button. The existing manual
 // MID logger/Host verification remains the sole translation entry point.
 const fallbackKey='__yenraDshCloudTranslateActionV19';
 if(!window[fallbackKey]){
  let action=null;
  const hide=()=>{action?.remove();action=null;};
  document.addEventListener('contextmenu',event=>{
   hide();
   const row=event.target?.closest?.('[data-message-id]');
   const mid=Number(row?.getAttribute?.('data-message-id'));
   const cid=conversation();
   if(!cid||!Number.isSafeInteger(mid)||mid<=0||
      !row?.querySelector?.('[data-bubble-name="text"]'))return;
   const x=Number.isFinite(event.clientX)?event.clientX:8;
   const y=Number.isFinite(event.clientY)?event.clientY:8;
   setTimeout(()=>{
    const active=window[manualKey]?.last;
    if(!active||active.conversationId!==cid||active.messageId!==mid||
       cid!==conversation()||Date.now()-active.when>12000)return;
    const native=[...document.querySelectorAll('[role="menuitem"],button')].some(node=>{
     if(!/^(?:翻译|Translate)$/iu.test(String(node.textContent??'').trim())||
        node.disabled||node.getAttribute?.('aria-disabled')==='true')return false;
     return (node.getClientRects?.().length??0)>0;
    });
    if(native)return;
    const button=document.createElement('button');
    button.type='button';
    button.textContent='翻译';
    button.title='通过 YENRA 原生翻译';
    button.setAttribute('data-yenra-cloud-translate-action','');
    const left=Math.min(Math.max(8,x),Math.max(8,(window.innerWidth||1360)-116));
    const top=Math.min(Math.max(8,y),Math.max(8,(window.innerHeight||720)-50));
    button.style.cssText='position:fixed;left:'+left+'px;top:'+top+
      'px;z-index:2147483646;padding:8px 16px;border:1px solid currentColor;'+
      'border-radius:8px;background:var(--color-surface,Canvas);'+
      'color:var(--color-text,CanvasText);font:inherit;cursor:pointer;'+
      'box-shadow:0 5px 18px rgb(0 0 0 / 12%)';
    document.body.appendChild(button);
    action=button;
   },100);
  },true);
  document.addEventListener('click',event=>{
   if(!event.target?.closest?.('[data-yenra-cloud-translate-action]'))
    hide();
   else setTimeout(hide,0);
  },false);
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape')hide();
  },true);
  window[fallbackKey]={hide};
 }
 // Upgrade the existing Cloud guest in place: no reload, lost draft or
 // duplicate translation listeners during the DSH client hot reload.
 if(window[key]?.refresh){
  window[key].adoptDraft=adoptDraft;
  window[key].copilotSuggestions=copilotSuggestions;
  window[key].paintCopilot=paintCopilot;
  window[key].refresh();
  return true;
 }

 // Chatwoot owns its translated bubble and View original action.
 const hasNativeTranslation=el=>[...el.querySelectorAll('span,button,a')].some(node=>{
  if(node.closest('[data-yenra-dsh-chinese]')||node.children.length)return false;
  return /^(?:查看原始内容|查看原文|查看译文|查看翻译|View original(?:\s*\([^)]*\))?|View translated(?:\s*\([^)]*\))?)$/iu.test(
   (node.textContent??'').trim());
 });
 const getParts=el=>{
  // Incoming grid uses bubble first; outgoing has a preceding avatar cell.
  // Resolve the actual Chatwoot [grid-area:bubble] rather than indexing
  // children[0], or right-click on a sent message paints into the avatar.
  const grid=el?.children?.[0];
  const region=[...(grid?.children??[])].find(node=>
   String(node.className??'').includes('[grid-area:bubble]'));
  const bubble=region?.children?.[0];
  // Cloud quoted replies render a separate quoted-message preview BEFORE
  // the genuine text body. Never treat that preview as the new message, or
  // skip the entire row (which also breaks manual right-click painting).
  const body=[...(bubble?.children??[])].find(node=>
   node.classList?.contains('gap-3')&&node.classList?.contains('flex'));
  if(!body)return null;
  // DSH translation is inserted above the immutable original. Never
  // mistake that translation node for the Cloud-owned message content.
  const original=[...body.children].find(n=>
   n.getAttribute?.('data-yenra-dsh-chinese')==null&&
   n.getAttribute?.('data-yenra-manual-translation-status')==null);
  return original?{bubble,body,original}:null;
 };
 const originalStyles=new WeakMap();
 const removeOverlay=el=>{
  const parts=getParts(el),source=parts?.original;
  if(source?.getAttribute('data-yenra-dsh-original-hidden')==='1'){
   source.style.removeProperty('display');
   source.removeAttribute('data-yenra-dsh-original-hidden');
  }
  if(source?.getAttribute('data-yenra-dsh-original-styled')==='1'){
   const previous=originalStyles.get(source);
   if(previous){
    source.style.fontSize=previous.fontSize;
    source.style.lineHeight=previous.lineHeight;
    source.style.opacity=previous.opacity;
   }else{
    source.style.removeProperty('font-size');
    source.style.removeProperty('line-height');
    source.style.removeProperty('opacity');
   }
   originalStyles.delete(source);
   source.removeAttribute('data-yenra-dsh-original-styled');
  }
  for(const node of el.querySelectorAll('[data-yenra-dsh-chinese]'))node.remove();
 };
 const reconcile=()=>{
  for(const row of document.querySelectorAll('[data-message-id].justify-start,[data-message-id].justify-end')){
   const parts=getParts(row);
   if(!parts)continue;
   const original=parts.original;
   const added=row.querySelector('[data-yenra-dsh-chinese]');
   if(hasNativeTranslation(row)||
     (added&&added.getAttribute('data-yenra-message-id')!==row.getAttribute('data-message-id'))){
    removeOverlay(row);continue;
   }
   if(!added&&(original?.getAttribute('data-yenra-dsh-original-hidden')==='1'||
       original?.getAttribute('data-yenra-dsh-original-styled')==='1'))
    removeOverlay(row);
  }
 };
 // Same-document SPA A→B→A replay: Cloud virtualized rows are destroyed and
 // remounted without invalidating the original DSH translation. Retain only a
 // bounded ephemeral view cache, keyed by exact contact/MID/original text.
 const replayCached=()=>{
  const c=conversation();if(!c||!state.translations.size)return 0;
  const replay=[];
  for(const row of document.querySelectorAll('[data-message-id].justify-start,[data-message-id].justify-end')){
   if(hasNativeTranslation(row)||row.querySelector('[data-yenra-dsh-chinese]'))continue;
   const id=Number(row.getAttribute('data-message-id'));
   if(!Number.isSafeInteger(id)||id<=0)continue;
   const key=c+':'+id,hit=state.translations.get(key);
   if(!hit)continue;
   const original=getParts(row)?.original;
   if(!original||typeof hit.source!=='string'||
      hit.source!==String(original.textContent??'')){
    state.translations.delete(key);continue;
   }
   replay.push({id,translation:hit.translation});
  }
  return replay.length?window[key]?.paint?.(c,replay)??0:0;
 };
 const status=(value,problem=false)=>{
  let label=document.querySelector('[data-yenra-model-translation-status]');
  if(!label){
   label=document.createElement('span');
   label.setAttribute('data-yenra-model-translation-status','');
   label.setAttribute('role','status');
   label.style.cssText='font:12px sans-serif;opacity:.9;padding:3px 7px;display:block;';
   const el=editor();
   (el?.parentElement??document.body).appendChild(label);
  }
  label.textContent=value;
  label.style.color=problem?'#d85e5e':'#a58bdb';
 };
 const request=()=>{
  const id=conversation(),value=content();
  if(!id||!value||!han(value)||state.allowOnce||state.busy)return false;
  if(value.length>1200){status('中文草稿过长，已阻止未经翻译直接发送。',true);return true}
  state.busy=true;state.source=value;state.conversationId=id;
  status('正在通过 YENRA 的 ChatGPT 翻译草稿…');
  console.info('YENRA_CLOUD_DSH_DRAFT_TRANSLATE');
  return true;
 };
 document.addEventListener('click',event=>{
  if(!conversation()||state.allowOnce)return;
  const b=event.target?.closest?.('button');
  if(!b||b!==send())return;
  if(!han(content()))return;
  event.preventDefault();event.stopImmediatePropagation();request();
 },true);
 document.addEventListener('keydown',event=>{
  if(!conversation()||state.allowOnce)return;
  if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||
    event.metaKey||event.isComposing||!editor()?.contains(event.target))return;
  if(!han(content()))return;
  event.preventDefault();event.stopImmediatePropagation();request();
 },true);
 // Observe ONLY Chatwoot's existing outgoing delivery/read icons. The
 // guest emits an untrusted candidate; the original Host must still recheck
 // Cloud message, Meta MID, contact and the adopted DSH Memory entry.
 // No provider polling, independent sender, new table or new Agent.
 const receiptMarks=new Map();
 const receiptRank=row=>{
  const icon=[...row.querySelectorAll('span[class]')].find(el=>
   /(?:^|\s)i-lucide-check(?:-check)?(?:\s|$)/u.test(el.className??''));
  if(!icon)return 0;
  const classes=String(icon.className??'');
  if(!/(?:^|\s)i-lucide-check-check(?:\s|$)/u.test(classes))return 1;
  return classes.includes('text-[#7EB6FF]')?3:2;
 };
 const inspectReceiptChanges=()=>{
  const cid=conversation();
  if(!cid){receiptMarks.clear();return;}
  const visible=[...document.querySelectorAll('[data-message-id].justify-end')].slice(-35);
  const keys=new Set();
  for(const row of visible){
   const id=Number(row.getAttribute('data-message-id'));
   if(!Number.isSafeInteger(id)||id<=0)continue;
   const rank=receiptRank(row),key=cid+':'+id;
   keys.add(key);
   // Vue may mount the bubble first and its status icon a moment later.
   // An icon first appearing is NOT a delivery transition. Preserve any
   // previous nonzero rank across momentary icon replacement instead.
   if(rank===0)continue;
   const previous=receiptMarks.get(key);
   // A transition must exist within the SAME live guest document. Merely
   // mounting already-read historical bubbles is not a new receipt event.
   if(previous!==undefined&&rank>previous&&rank>=2)
    console.info('YENRA_CLOUD_PAGE_RECEIPT_CHANGED:'+cid+':'+id);
   receiptMarks.set(key,rank);
  }
  for(const key of receiptMarks.keys())if(!keys.has(key))receiptMarks.delete(key);
 };
 const recordAdopt=(conversationId)=>{
  if(conversationId!==conversation()||!Number.isSafeInteger(conversationId))return false;
  const before=new Set([...document.querySelectorAll('[data-message-id].justify-end')]
   .map(row=>Number(row.getAttribute('data-message-id')))
   .filter(id=>Number.isSafeInteger(id)&&id>0));
  state.adoption={conversationId,before,expires:Date.now()+45*60*1000};
  return true;
 };
 const inspectAdoptOutgoing=()=>{
  const adopted=state.adoption;
  if(!adopted)return;
  if(conversation()!==adopted.conversationId||Date.now()>adopted.expires){state.adoption=null;return;}
  for(const row of document.querySelectorAll('[data-message-id].justify-end')){
   const id=Number(row.getAttribute('data-message-id'));
   if(!Number.isSafeInteger(id)||id<=0||adopted.before.has(id))continue;
   // A guest DOM signal is NEVER delivery proof: original Host verifies
   // Cloud contact, source MID, status and adopted MemoryService entry.
   state.adoption=null;
   console.info('YENRA_CLOUD_ADOPT_SENT_CANDIDATE:'+adopted.conversationId+':'+id);
   return;
  }
 };
 let observer=null,dirty=false;
 const changed=records=>{
  // The original translation observer still owns message child mutations.
  // Ignore unrelated document-wide class churn (menus/hover/typing): only
  // receipt icon class updates in a real outgoing bubble need extra work.
  if(Array.isArray(records)&&!records.some(r=>
   r.type==='childList'||
   (r.type==='attributes'&&
    r.target?.closest?.('[data-message-id].justify-end')&&
    /(?:^|\s)i-lucide-check(?:-check)?(?:\s|$)/u.test(
      r.target.getAttribute('class')??''))))return;
  if(dirty)return;dirty=true;
  setTimeout(()=>{
   dirty=false;
   reconcile();
   replayCached();
   inspectAdoptOutgoing();
   inspectReceiptChanges();
   if(conversation()&&Date.now()-state.notifyAt>2000){
    state.notifyAt=Date.now();console.info('YENRA_CLOUD_DSH_INCOMING_CHANGED');
   }
  },450);
 };
 observer=new MutationObserver(changed);
 // Original Chatwoot changes its existing receipt icons by replacing
 // children OR updating icon classes; both must wake this bounded scanner.
 observer.observe(document.body,{childList:true,subtree:true,
  attributes:true,attributeFilter:['class']});
 window[key]={
  recordAdopt,
  copilotSuggestions,
  paintCopilot,
  refresh:()=>{reconcile();replayCached();changed()},
  // Explicit Adopt reuses the same ProseMirror helper, never Sender.
  adoptDraft,
  visible:(limit=8)=>{
   reconcile();
   return {
    conversationId:conversation(),
    // Both directions share the same bilingual renderer. Outgoing was
    // previously omitted here, so users had to right-click every sent line.
    ids:[...document.querySelectorAll('[data-message-id].justify-start,[data-message-id].justify-end')]
     .filter(el=>{
      if(hasNativeTranslation(el)||el.querySelector('[data-yenra-dsh-chinese]'))return false;
      const parts=getParts(el);
      if(!parts||!parts.original)return false;
      if(han(parts.original.textContent??''))return false;
      // Phone numbers, emoji, identifiers and other non-linguistic data
      // need no paid translation; including them can fail an entire batch.
      const originalText=String(parts.original.textContent??'').trim();
      if(!/\p{L}/u.test(originalText))return false;
      // A standalone short alphanumeric ID/typo is not natural language.
      if(/^[\p{L}\p{N}_-]{2,28}$/u.test(originalText)&&
         /\p{L}/u.test(originalText)&&/\p{N}/u.test(originalText))return false;
      if(parts.original.querySelector('img,video,audio'))return false;
      return true;
     })
     .map(el=>Number(el.getAttribute('data-message-id')))
     .filter(n=>Number.isSafeInteger(n)&&n>0)
     .slice(-Math.min(30,Math.max(1,Number.isSafeInteger(limit)?limit:8))),
   };
  },
  paint:(conversationId,items)=>{
   if(conversationId!==conversation()||!Array.isArray(items))return false;
   reconcile();
   let count=0;
   for(const x of items){
    if(!Number.isSafeInteger(x.id)||typeof x.translation!=='string'||
      !han(x.translation))continue;
    const el=document.querySelector('[data-message-id="'+x.id+'"].justify-start,[data-message-id="'+x.id+'"].justify-end');
    if(!el||hasNativeTranslation(el)||el.querySelector('[data-yenra-dsh-chinese]'))continue;
    const parts=getParts(el);
    if(!parts?.original||han(parts.original.textContent??'')||
      parts.original.querySelector('img,video,audio'))continue;
    const source=parts.original,content=parts.body;
    // Reuse the existing Chatwoot bubble's content column. Keep its
    // original message DOM permanently visible, directly BELOW Chinese.
    // No hand-built replacement bubble, toggle, or floating success banner.
    const wrapper=document.createElement('div');
    wrapper.setAttribute('data-yenra-dsh-chinese','');
    wrapper.setAttribute('data-yenra-message-id',String(x.id));
    wrapper.style.cssText='color:inherit;min-width:0;font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:-6px;';
    wrapper.textContent=x.translation;
    originalStyles.set(source,{
     fontSize:source.style.fontSize??'',
     lineHeight:source.style.lineHeight??'',
     opacity:source.style.opacity??''
    });
    source.style.removeProperty('display');
    source.removeAttribute('data-yenra-dsh-original-hidden');
    source.style.fontSize='12px';
    source.style.lineHeight='1.4';
    source.style.opacity='.78';
    source.setAttribute('data-yenra-dsh-original-styled','1');
    // Save a replayable copy only after the exact current row was verified;
    // route changes cannot leak one contact's Chinese into another contact.
    const cacheKey=conversationId+':'+x.id;
    state.translations.delete(cacheKey);
    state.translations.set(cacheKey,{source:String(source.textContent??''),
      translation:x.translation});
    while(state.translations.size>400)
      state.translations.delete(state.translations.keys().next().value);
    content.insertBefore(wrapper,source);
    count++;
   }
   return count;
  },
  draft:()=>{
   if(!state.busy||state.conversationId!==conversation()||
     state.source!==content())return null;
   return {conversationId:state.conversationId,draft:state.source};
  },
  fail:(reason)=>{
   if(!state.busy)return false;
   state.busy=false;
   status(reason||'自有模型翻译失败，中文未发送。',true);
   return true;
  },
  sendTranslated:(conversationId,source,translated)=>{
   if(!state.busy||conversationId!==conversation()||
     conversationId!==state.conversationId||state.source!==source||
     content()!==source||typeof translated!=='string'||!translated.trim()||
     han(translated))return false;
   const el=editor(),button=send();
   if(!el||!button){state.busy=false;status('翻译完成，但发送框不可用。',true);return false}
   el.focus();
   const range=document.createRange();range.selectNodeContents(el);
   const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
   if(!document.execCommand('insertText',false,translated)){
    state.busy=false;status('翻译完成，输入框未接受内容；已阻止发送。',true);return false
   }
   if(content()!==translated.trim()){
    state.busy=false;status('翻译文本校验失败，已阻止发送。',true);return false
   }
   status('翻译完成，正在通过 Chatwoot 原生发送…');
   state.allowOnce=true;
   setTimeout(()=>{
    if(conversation()===conversationId&&content()===translated.trim()){
      button.click();
      status('已提交 Chatwoot，实际送达状态以平台回执为准。');
    }else status('联系人或草稿已变化，取消自动发送。',true);
    state.allowOnce=false;state.busy=false;state.source='';
   },180);
   return true;
  },
 };
 changed();
 return true;
})()`;
