window.__ModuleLoader__.load({id:'@local/yenra-personal-chrome',factory(require){
 const React=require('react'),ReactDOM=require('react-dom'),h=React.createElement;
 const CSS=/*__CAPTION_CSS__*/;
 return{inject:['theme','slots'],apply(ctx){
  const clientId=crypto.randomUUID(),aborts=new Set();let stopped=false,probes=null,timer,contacts={enabled:false,reason:'not-reported'},contactsAt=0,signature='',sentAt=0,invalidateChrome=null;
  async function report(){
   clearTimeout(timer);if(stopped||!probes)return;
   const value={clientId,version:'1.0.1',nativeWindows:document.documentElement.hasAttribute('data-windows-titlebar'),mergedCloud:!!document.querySelector('.yenra-v2[data-yenra-cloud-chat="true"][data-yenra-merged-header="true"]'),captionFill:getComputedStyle(probes[0]).backgroundColor,headerFill:getComputedStyle(probes[1]).backgroundColor,contactsEnabled:contacts.enabled===true,contactsState:typeof contacts.reason==='string'?contacts.reason:'not-reported',contactsAgeMs:contactsAt?Math.max(0,Date.now()-contactsAt):86400000};
   const key=JSON.stringify({...value,contactsAgeMs:0});if(key===signature&&Date.now()-sentAt<15000)return;
   signature=key;sentAt=Date.now();const abort=new AbortController();aborts.add(abort);const timeout=setTimeout(()=>abort.abort(),4000);
   try{await fetch('/api/yenra-personal-chrome/report',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:abort.signal});}catch{}finally{clearTimeout(timeout);aborts.delete(abort);}
  }
  const schedule=()=>{invalidateChrome?.();clearTimeout(timer);timer=setTimeout(report,100);};
  const onContacts=event=>{if(!event.detail||typeof event.detail.enabled!=='boolean'||typeof event.detail.reason!=='string'||event.detail.reason.length>80)return;contacts=event.detail;contactsAt=Date.now();schedule();};
  window.addEventListener('yenra:personal-chrome',onContacts);
  const off=ctx.on('theme/change',schedule);
  const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-yenra-cloud-chat','data-yenra-merged-header']});
  function Bridge(){
   const refs=React.useRef([]),[merged,setMerged]=React.useState(()=>!!document.querySelector('.yenra-v2[data-yenra-cloud-chat="true"][data-yenra-merged-header="true"]'));
   React.useEffect(()=>{window.dispatchEvent(new Event('yenra:personal-chrome-request'));invalidateChrome=()=>setMerged(!!document.querySelector('.yenra-v2[data-yenra-cloud-chat="true"][data-yenra-merged-header="true"]'));probes=refs.current;schedule();const heartbeat=setInterval(()=>{window.dispatchEvent(new Event('yenra:personal-chrome-request'));schedule();},15000);return()=>{clearInterval(heartbeat);probes=null;invalidateChrome=null;};},[]);
   const hidden={position:'fixed',width:0,height:0,overflow:'hidden',visibility:'hidden',pointerEvents:'none'};
   return h(React.Fragment,null,ReactDOM.createPortal(h('style',{'data-yenra-personal-caption':'1'},CSS+'\n/* merged-cloud:'+merged+' */'),document.head),h('span',{ref:el=>refs.current[0]=el,'aria-hidden':true,style:{...hidden,backgroundColor:'var(--dsw-specific-sidebar-fill)'}}),h('span',{ref:el=>refs.current[1]=el,'aria-hidden':true,style:{...hidden,backgroundColor:'var(--dsw-alias-bg-layer-1)'}}));
  }
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'yenra.personal-chrome',order:101},Bridge));
  ctx.effect(()=>()=>{stopped=true;clearTimeout(timer);off();observer.disconnect();window.removeEventListener('yenra:personal-chrome',onContacts);for(const abort of aborts)abort.abort();aborts.clear();});
 }};
}});
