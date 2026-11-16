/** Place the existing display-mode toggle beside Cloud's ORIGINAL contact
 * button. It emits only a UI request; the parent retains the one mode state. */
export function cloudConversationToolsScript(expanded:boolean):string{
  return '('+installConversationTools.toString()+')('+JSON.stringify(expanded)+')';
}

function installConversationTools(expanded:boolean){
  if(location.origin!=='https://app.chatwoot.com'||
      !location.pathname.startsWith('/app/accounts/196799/'))return false;
  type Controller={refresh:(expanded:boolean)=>void};
  const scope=window as unknown as Record<string,Controller|undefined>;
  const key='__yenraConversationToolsV1';
  if(scope[key]){scope[key]!.refresh(expanded);return true}
  let open=expanded;
  let queued=false;
  const selector='.yenra-cloud-conversation-tools';
  const refresh=()=>{
    queued=false;
    const route=/^\/app\/accounts\/196799\/conversations\/\d+\/?$/u.test(location.pathname);
    const wrap=route?document.querySelector('.conversation-details-wrap>div:last-child>div.absolute:has(button .i-ph-user-bold)'):null;
    for(const old of document.querySelectorAll(selector)){
      if(old.parentElement!==wrap)old.remove();
    }
    if(!wrap)return;
    let button=wrap.querySelector<HTMLButtonElement>(selector);
    if(!button){
      button=document.createElement('button');
      button.type='button';button.className='yenra-cloud-conversation-tools';
      button.textContent='\u22ee';
      button.title='聊天选项：筛选、会话状态、私人便笺与 Cloud 助手';
      button.addEventListener('click',()=>{
        const id=/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/u.exec(location.pathname)?.[1];
        if(id)console.info('YENRA_CLOUD_CONVERSATION_TOOLS_CLICK:'+id);
      });
      wrap.appendChild(button);
    }
    button.setAttribute('aria-label',open?'收起聊天选项':'展开聊天选项');
    button.setAttribute('aria-pressed',String(open));
  };
  const schedule=()=>{
    if(queued)return;
    queued=true;requestAnimationFrame(refresh);
  };
  const observer=new MutationObserver(mutations=>{
    // Observe native header replacement, not message text/stream updates.
    if(mutations.some(m=>{
      const parent=m.target instanceof Element?m.target:null;
      if(parent?.closest('.conversation-details-wrap>div:first-child')||
          parent?.matches('.conversation-details-wrap>div:last-child,div.absolute:has(button .i-ph-user-bold)'))return true;
      return [...m.addedNodes].some(n=>n instanceof Element&&
        (n.matches('.conversation-details-wrap,.conversation-details-wrap>div:last-child>div.absolute')||
         n.querySelector('.conversation-details-wrap,button .i-ph-user-bold')));
    }))schedule();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  scope[key]={refresh:(expanded:boolean)=>{open=expanded;refresh()}};
  refresh();
  return true;
}
