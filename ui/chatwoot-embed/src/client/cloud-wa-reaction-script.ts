/** One thin reaction affordance on Cloud's ORIGINAL message rows.
 * No message UI replacement, no platform call, no fake delivery state.
 * The parent DSH desktop verifies Cloud + original WhatsApp before sending.
 */
export function cloudWaReactionScript(eligibleConversationId:number):string{
  return '('+installCloudWaReaction.toString()+')('+
    JSON.stringify(eligibleConversationId)+')';
}
function installCloudWaReaction(eligibleConversationId:number){
  if(location.origin!=='https://app.chatwoot.com')return false;
  const key='__yenraCloudWaReactionV1';
  const scope=window as unknown as Record<string,any>;
  if(scope[key]?.set){scope[key].set(eligibleConversationId);return true;}
  const emojis=['👍','❤️','😂','😮','😢','🙏'];
  const route=()=>Number(/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/.exec(location.pathname)?.[1]||0);
  let active=eligibleConversationId;
  const marker='data-yenra-wa-reaction';
  const eligible=()=>active>0&&active===route();
  const remove=()=>document.querySelectorAll('['+marker+']').forEach(n=>n.remove());
  const rows=()=>document.querySelectorAll('[data-message-id].justify-start,[data-message-id].justify-end');
  function paint(conversationId:number,messageId:number,ok:boolean){
    if(!eligible()||conversationId!==active)return false;
    const root=document.querySelector('['+marker+'="'+messageId+'"]');
    const status=root?.querySelector('[data-yenra-wa-reaction-status]');
    if(!status)return false;
    status.textContent=ok?'已提交 · 未确认送达':'未成功，请重试';
    return true;
  }
  function refresh(){
    if(!eligible()){remove();return;}
    for(const stale of document.querySelectorAll('['+marker+']')){
      const messageId=stale.getAttribute(marker);
      if(!stale.closest('[data-message-id="'+messageId+'"]'))stale.remove();
    }
    for(const row of rows()){
      const messageId=Number(row.getAttribute('data-message-id'));
      if(!Number.isSafeInteger(messageId)||messageId<=0||
         row.querySelector('['+marker+']'))continue;
      const anchor=row.querySelector('[class*="grid-area:meta"]')||
        row.querySelector('[data-bubble-name="text"]');
      if(!anchor)continue;
      const holder=document.createElement('span');
      holder.setAttribute(marker,String(messageId));
      // Keep the reaction menu available via right-click, but do not inject
      // a smiley into every native Chatwoot message bubble.
      holder.style.cssText='position:relative;display:inline-flex;align-items:center;gap:4px;margin-left:0;font:11px/16px Segoe UI,system-ui,sans-serif;';
      const menu=document.createElement('span');
      menu.setAttribute('data-yenra-wa-reaction-menu','1');
      menu.style.cssText='position:absolute;bottom:100%;left:0;display:none;z-index:120;gap:2px;padding:5px;border-radius:9px;border:1px solid #68717d;background:#18222e;box-shadow:0 5px 16px #0007;';
      for(let i=0;i<emojis.length;i++){
        const b=document.createElement('button');
        b.type='button';b.textContent=emojis[i];
        b.setAttribute('aria-label','回应 '+emojis[i]);
        b.style.cssText='border:0;background:transparent;cursor:pointer;padding:3px;border-radius:6px;font-size:18px;';
        b.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();
          if(!eligible())return;
          menu.style.display='none';
          const status=holder.querySelector('[data-yenra-wa-reaction-status]');
          if(status)status.textContent='正在提交…';
          console.info('YENRA_CLOUD_WA_REACT:'+active+':'+messageId+':'+i);
        });
        menu.appendChild(b);
      }
      const status=document.createElement('span');
      status.setAttribute('data-yenra-wa-reaction-status','1');
      status.style.cssText='font-size:10px;opacity:.75;';
      holder.append(menu,status);
      anchor.appendChild(holder);
    }
  }
  let queued=false;
  const observer=new MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes].some(n=>
      n instanceof Element&&!n.closest('['+marker+']')&&
      (n.matches('[data-message-id]')||Boolean(n.querySelector('[data-message-id]')))))){
      if(queued)return;queued=true;
      requestAnimationFrame(()=>{queued=false;refresh()});
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  const onClick=(event:MouseEvent)=>{
    const target=event.target;
    if(!(target instanceof Element)||target.closest('['+marker+']'))return;
    document.querySelectorAll('[data-yenra-wa-reaction-menu]').forEach(menu=>
      (menu as HTMLElement).style.display='none');
  };
  // Add only a quick-reaction strip on native right-click. Do not stop the
  // event or override Chatwoot's ORIGINAL context menu and click handlers.
  const onContextMenu=(event:MouseEvent)=>{
    if(!eligible()||!(event.target instanceof Element))return;
    const row=event.target.closest('[data-message-id]');
    if(!row)return;
    const n=Number(row.getAttribute('data-message-id'));
    if(!Number.isSafeInteger(n)||n<=0)return;
    const wrap=row.querySelector('['+marker+'="'+n+'"]');
    const popup=wrap?.querySelector('[data-yenra-wa-reaction-menu]');
    if(!(popup instanceof HTMLElement))return;
    popup.style.position='fixed';popup.style.bottom='auto';
    popup.style.left=Math.max(0,Math.min(event.clientX,window.innerWidth-245))+'px';
    popup.style.top=Math.max(0,event.clientY-47)+'px';
    popup.style.display='flex';
  };
  document.addEventListener('click',onClick);
  document.addEventListener('contextmenu',onContextMenu,true);
  window.addEventListener('pagehide',()=>{
    observer.disconnect();
    document.removeEventListener('click',onClick);
    document.removeEventListener('contextmenu',onContextMenu,true);
  },{once:true});
  scope[key]={set:(conversationId:number)=>{active=conversationId;refresh()},paint};
  refresh();
  return true;
}
