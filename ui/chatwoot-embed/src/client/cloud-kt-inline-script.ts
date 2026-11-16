/** Manual KT lookup UI limited to the already authenticated Cloud Guest.
 * It never calls a provider and never sends a chat message. */
export const CLOUD_KT_INLINE_SCRIPT=String.raw`(()=>{
  if(location.origin!=='https://app.chatwoot.com')return false;
  const key='__yenraCloudKtV1',scope=window;
  const conversation=()=>Number(/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/.exec(location.pathname)?.[1]||0);
  if(scope[key]?.refresh){scope[key].refresh();return true;}
  // Keep only this Cloud document's message-bound results across SPA A→B→A.
  const results=new Map();
  const buttonClass='yenra-kt-check-button';
  // Only owner-confirmed ISO country codes, scoped to the Cloud contact ID.
  // Uses the existing Electron Browser Guest storage; no second database.
  // Legacy v1 only stored "FR"/"IT" without evidence that a person
  // selected it. Its provenance cannot be established, so it is NEVER
  // silently trusted for an actual KT query. A real manual confirmation
  // creates v2 scoped to this verified Cloud contact.
  const countryKey=id=>'yenra:kt:confirmed-country:v2:196799:'+id;
  const legacyCountryKey=id=>'yenra:kt:confirmed-country:v1:196799:'+id;
  const countryFor=(c,id)=>{
    if(c!==conversation()||!Number.isSafeInteger(id)||id<=0)return null;
    try{
      const entry=JSON.parse(localStorage.getItem(countryKey(id))||'null');
      return entry?.v===2&&entry?.source==='manual-ui'&&
        entry?.contactId===id&&typeof entry.iso2==='string'&&
        /^[A-Z]{2}$/.test(entry.iso2)&&
        Number.isSafeInteger(entry.confirmedAt)&&entry.confirmedAt>0&&
        entry.confirmedAt<=Date.now()?entry.iso2:null;
    }catch{return null}
  };
  const rememberCountry=(c,id,iso2)=>{
    if(c!==conversation()||!Number.isSafeInteger(id)||id<=0||
       typeof iso2!=='string'||!/^[A-Z]{2}$/.test(iso2))return false;
    try{
      const entry={v:2,source:'manual-ui',contactId:id,
        iso2,confirmedAt:Date.now()};
      localStorage.setItem(countryKey(id),JSON.stringify(entry));
      // Only retire an unprovable v1 hint AFTER a fresh manual confirmation.
      localStorage.removeItem(legacyCountryKey(id));
      return countryFor(c,id)===iso2;
    }catch{return false}
  };

  function section(id){
    if(!conversation())return null;
    const el=document.querySelector('[data-message-id="'+id+'"].justify-start');
    return el instanceof HTMLElement?el:null;
  }
  function numberVisible(row){
    const original=row.querySelector('[processedmessagecontent]')?.getAttribute('processedmessagecontent')||'';
    const bubble=row.querySelector('[data-bubble-name="text"]');
    const text=original+' '+(bubble?.textContent||'');
    // Keep the visible lookup affordance in sync with the native parser:
    // +39, 39， and other comma-separated international numbers are valid.
    // Most European local mobiles have 8–10 digits, but some verified
    // national plans use only 6–7. Show a manual lookup entry for 6–15
    // digits; Host still verifies original Cloud message and country.
    return [...text.matchAll(/(?<!\d)(?:\+|00)?\d[\d\s.(),，\-]{4,26}\d(?!\d)/gu)]
      .some(x=>{const n=(x[0].match(/\d/g)||[]).length;return n>=6&&n<=15});
  }
  function paint(id,value){
    const row=section(id);if(!row)return false;
    const panel=row.querySelector('[data-yenra-kt-result]');
    if(!panel)return false;
    results.set(conversation()+':'+id,value);
    panel.replaceChildren();
    const add=(tag,text)=>{
      const node=document.createElement(tag);node.textContent=text;
      panel.appendChild(node);return node;
    };
    if(!value?.ok){
      const code=String(value?.code||'KT_LOOKUP_UNAVAILABLE');
      if(['KT_PHONE_COUNTRY_OR_FORMAT_UNVERIFIED',
          'AMBIGUOUS_NUMBER_COUNTRY','UNSUPPORTED_NUMBER_COUNTRY'].includes(code)){
        add('span',code==='AMBIGUOUS_NUMBER_COUNTRY'
          ?'此区号多个国家共用，请填两字母国家代码：'
          :'需要确认号码所属国家：');
        const input=add('input','');
        input.placeholder=code==='AMBIGUOUS_NUMBER_COUNTRY'?'例如 IT':'例如 IT / DE / 49';
        input.setAttribute('aria-label','国家代码，例如 IT、DE 或 49');
        input.style.cssText='max-width:110px;background:transparent;border:1px solid #7a8493;border-radius:4px;padding:2px 5px;color:inherit';
        const submit=add('button','确认国家');
        submit.addEventListener('click',()=>{
          const country=input.value.trim();
          if(/^(?:[A-Za-z]{2}|\+?\d{1,4}|00\d{1,4})$/.test(country))
            console.info('YENRA_CLOUD_KT_COUNTRY:'+conversation()+':'+id+':'+country);
        });
      }else add('span',({
        KT_CLOUD_MESSAGE_NOT_FOUND:'Cloud 尚未返回这条原消息',
        KT_INBOUND_ORIGINAL_REQUIRED:'只有对方发来的文字号码可以查重',
        KT_CLOUD_SOURCE_UNAVAILABLE:'Cloud 读取失败，点击重试',
        KT_SESSION_EXPIRED:'KT 登录已过期，请在 KT 登录后重试',
        KT_ORIGINAL_NETWORK_UNAVAILABLE:'KT 网络不可用，请稍后重试',
        KT_LOOKUP_UNAVAILABLE:'KT 查询服务暂时不可用，请重试；若持续失败请检查桌面连接',
        KT_NATIVE_RUNTIME_NOT_INSTALLED:'KT 查重组件缺失，请更新正式安装包',
        KT_CLOUD_SOURCE_UNVERIFIED:'Cloud 原消息校验失败，请重新打开会话',
        KT_PROVIDER_RESULT_UNVERIFIED:'KT 未返回有效查重结果，请重试',
      })[code]||('查重未完成：'+code));
      return true;
    }
    if(value.mode==='inspect'){
      add('span','选择要查询的号码：');
      for(let i=0;i<value.numbers.length;i++){
        const num=value.numbers[i],choice=add('button',String(num.number));
        choice.style.cssText='padding:3px 6px;border:1px solid currentColor;border-radius:5px;margin:3px';
        choice.addEventListener('click',()=>console.info(
          'YENRA_CLOUD_KT_SELECT:'+conversation()+':'+id+':'+i));
      }
      return true;
    }
    const label=value.status==='duplicate'?'重复 '+value.repeatCount+' 次':
      value.status==='not_duplicate'?'未重复 · 0 次':
      value.status==='unknown'?'KT 未知结果（不能当作 0 次）':
      'KT 暂不可用：'+(value.reason||'请重试');
    add('span',(value.masked||'号码')+' · '+label);
    return true;
  }
  function refresh(){
    const current=conversation();
    for(const stale of document.querySelectorAll('[data-yenra-kt-inline]')){
      if(!current||!section(stale.getAttribute('data-yenra-kt-message')))stale.remove();
    }
    if(!current)return;
    for(const row of document.querySelectorAll('[data-message-id].justify-start')){
      const id=Number(row.getAttribute('data-message-id'));
      if(!Number.isSafeInteger(id)||id<=0||!numberVisible(row))continue;
      if(row.querySelector('[data-yenra-kt-message]'))continue;
      const wrap=document.createElement('div');
      wrap.setAttribute('data-yenra-kt-inline','1');
      wrap.setAttribute('data-yenra-kt-message',String(id));
      wrap.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:2px 0 6px 8px;font-size:11px;color:var(--color-text, #aab2c2)';
      const button=document.createElement('button');
      button.className=buttonClass;button.type='button';button.textContent='查此号码';
      button.style.cssText='padding:2px 7px;border:1px solid #677487;border-radius:7px;color:inherit;background:transparent;cursor:pointer';
      const result=document.createElement('span');result.setAttribute('data-yenra-kt-result','1');
      button.addEventListener('click',()=>{
        result.textContent='正在从 KT 查询…';
        console.info('YENRA_CLOUD_KT_CLICK:'+conversation()+':'+id);
      });
      wrap.append(button,result);
      const placement=row.querySelector('[class*="grid-area:meta"]')||
        row.querySelector('[data-bubble-name="text"]');
      if(placement){
        placement.appendChild(wrap);
        const previous=results.get(current+':'+id);
        if(previous)paint(id,previous);
      }
    }
  }
  let queued=false;
  // React can populate an existing message row without adding a new row node.
  // A microtask (not requestAnimationFrame) also runs while a Guest is hidden:
  // its DOM is prepared when the owner returns A→B→A. No new KT queries.
  const scheduleRefresh=()=>{
    if(queued)return;queued=true;
    queueMicrotask(()=>{queued=false;refresh()});
  };
  const observer=new MutationObserver(m=>{
    if(m.some(x=>{
      const target=x.target instanceof Element?x.target:x.target.parentElement;
      if(target?.closest?.('[data-yenra-kt-inline]'))return false;
      const inMessage=!!target?.closest?.('[data-message-id].justify-start');
      if(x.type==='attributes')return inMessage||target?.hasAttribute?.('data-message-id');
      return inMessage||[...x.addedNodes].some(n=>n instanceof Element&&
        (n.matches?.('[data-message-id]')||n.querySelector?.('[data-message-id]')));
    }))scheduleRefresh();
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,
    attributeFilter:['data-message-id','processedmessagecontent','data-bubble-name']});
  // Existing bounded fallback checks visible rows only, with no network work.
  const watchdog=setInterval(()=>{if(!document.hidden&&conversation())refresh()},1200);
  const onVisible=()=>{if(!document.hidden)scheduleRefresh()};
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('focus',onVisible);
  window.addEventListener('popstate',scheduleRefresh);
  window.addEventListener('pageshow',scheduleRefresh);
  window.addEventListener('pagehide',()=>{
    observer.disconnect();clearInterval(watchdog);
    document.removeEventListener('visibilitychange',onVisible);
    window.removeEventListener('focus',onVisible);
    window.removeEventListener('popstate',scheduleRefresh);
    window.removeEventListener('pageshow',scheduleRefresh);
  },{once:true});
  scope[key]={refresh,paint:(c,id,v)=>c===conversation()&&paint(id,v),
    // Export only already-completed results from THIS live Cloud conversation.
    // No new KT request, persistence store, raw phone number or cross-contact reuse.
    snapshot:(c)=>{
      if(c!==conversation()||!Number.isSafeInteger(c)||c<=0)return [];
      const out=[];
      for(const [scopeId,value] of results){
        const prefix=c+':';
        if(!scopeId.startsWith(prefix)||value?.ok!==true||value.mode==='inspect')continue;
        const messageId=Number(scopeId.slice(prefix.length));
        if(!Number.isSafeInteger(messageId)||messageId<=0||
          !['duplicate','not_duplicate','unknown'].includes(value.status))continue;
        const repeatCount=Number(value.repeatCount);
        out.push({messageId,status:value.status,
          masked:typeof value.masked==='string'?value.masked.slice(0,40):'',
          repeatCount:Number.isSafeInteger(repeatCount)&&repeatCount>=0?repeatCount:null});
        if(out.length>=150)break;
      }
      return out;
    },countryFor,rememberCountry};
  refresh();return true;
})()`;
