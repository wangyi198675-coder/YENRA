window.__ModuleLoader__.load({id:'@local/yenra-typography-fix',factory(require){
  const React=require('react'),h=React.createElement;
  /*__TYPOGRAPHY__*/
  return{inject:['theme','slots','locale'],apply(ctx){
    const endpoint='/api/yenra-typography',clientId=globalThis.crypto.randomUUID(),listeners=new Set(),waits=new Map(),requests=new Set();
    let stopped=false,inFlight=false,restoreTo=null,testSize=null,probe=null,reportTimer,last=null,cloud=null;
    const notify=()=>{for(const fn of listeners)fn();};
    const wait=ms=>new Promise(resolve=>{if(stopped)return resolve(false);const timer=setTimeout(()=>{waits.delete(timer);resolve(!stopped);},ms);waits.set(timer,resolve);});
    const family=raw=>raw.toLowerCase().replace(/["']/g,'').replace(/\s+/g,'');
    function measure(){
      const snapshot=ctx.theme.getTheme(),base=snapshot.fontSizes.text,roles=scale(base),samples=[],missing=[];
      const expectedFamily=probe?getComputedStyle(probe).fontFamily:null;
      for(const spec of SAMPLES){
        const candidates=[...document.querySelectorAll(spec.selector)];
        const element=candidates.find(visibleElement);
        if(!element){missing.push(spec.id);continue;}
        const style=getComputedStyle(element),size=Number.parseFloat(style.fontSize),expected=roles[spec.role];
        samples.push({id:spec.id,size,expected,family:style.fontFamily,lineHeight:style.lineHeight,pass:Math.abs(size-expected)<.1&&expectedFamily!==null&&family(style.fontFamily)===family(expectedFamily)});
      }
      if(cloud&&cloud.base===base&&Date.now()-cloud.seenAt<60000){for(const item of cloud.samples){if(samples.some(s=>s.id===item.id))continue;const sample={...item,pass:Math.abs(item.size-item.expected)<.1&&expectedFamily!==null&&family(item.family)===family(expectedFamily)};samples.push(sample);const at=missing.indexOf(item.id);if(at>=0)missing.splice(at,1);}}
      return{clientId,version:VERSION,base,samples,missing};
    }
    async function send(value){
      if(stopped)return;const abort=new AbortController();requests.add(abort);const timeout=setTimeout(()=>abort.abort(),4000);
      try{const response=await fetch(endpoint+'/report',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:abort.signal});if(!response.ok)throw Error('Typography report HTTP '+response.status);}
      finally{clearTimeout(timeout);requests.delete(abort);}
    }
    function report(){clearTimeout(reportTimer);reportTimer=setTimeout(()=>{if(!stopped&&probe){last=measure();notify();send(last).catch(()=>{});}},100);}
    function restore(){
      if(restoreTo!==null&&ctx.theme.getTheme().fontSizes.text===testSize)ctx.theme.setFontSize('text',restoreTo);
      restoreTo=null;testSize=null;
    }
    async function verify(requestId){
      if(inFlight||stopped)return;inFlight=true;notify();
      const before=measure(),original=before.base,bump=original===22?21:original+1;
      let during=null,after=null,message='',interrupted=false;
      try{
        restoreTo=original;testSize=bump;ctx.theme.setFontSize('text',bump);
        if(!await wait(350))throw Error('Client unloaded during check');
        during=measure();
        if(during.base!==bump){interrupted=true;message='Setting changed or the test write was rejected';}
      }catch(error){message=String(error.message||error);}
      finally{
        // Never overwrite a different setting chosen by the user during this bounded check.
        if(ctx.theme.getTheme().fontSizes.text!==bump&&ctx.theme.getTheme().fontSizes.text!==original)interrupted=true;
        restore();await wait(350);after=measure();inFlight=false;
      }
      const changed=[],unchanged=[];
      if(during)for(const item of before.samples){const next=during.samples.find(s=>s.id===item.id);if(!next)continue;(next.size!==item.size?changed:unchanged).push(item.id);}
      const covered=[before,during,after].every(hasCoverage);
      const passed=!message&&!interrupted&&checkPhases(before,during,after,original,changed);
      if(!message)message=passed?'Visible contact/chat/AI font roles followed the native setting and the original setting was restored':!covered?'One or more contact/chat/AI regions were not visible; missing roles are not tested':'One or more computed font roles did not match the native setting';
      last={...after,...(requestId?{requestId}:{}),verification:{passed,restored:after.base===original,originalSize:original,testSize:bump,message,changed,unchanged}};notify();if(!stopped)await send(last).catch(()=>{});return last;
    }
    const cloudListener=event=>{const value=event.detail;if(!value||!Number.isFinite(value.base)||!Array.isArray(value.samples)||value.samples.length>12)return;cloud={base:value.base,seenAt:Date.now(),samples:value.samples.filter(s=>['contact','preview','chat','original','composer','time'].includes(s.id)&&Number.isFinite(s.size)&&Number.isFinite(s.expected)&&typeof s.family==='string'&&typeof s.lineHeight==='string')};report();};
    window.addEventListener('yenra:cloud-typography',cloudListener);
    const off=ctx.on('theme/change',()=>report());
    const events=new EventSource(endpoint+'/events?id='+encodeURIComponent(clientId));
    events.onmessage=event=>{try{const value=JSON.parse(event.data);if(value.kind==='verify')verify(value.requestId).catch(()=>{});else report();}catch{}};
    function Bridge(){
      const ref=React.useCallback(element=>{probe=element;if(element)report();},[]);
      React.useEffect(()=>{report();const timer=setInterval(report,30000);return()=>clearInterval(timer);},[]);
      return h(React.Fragment,null,h('style',{'data-yenra-typography':VERSION},CSS),h('span',{ref,'aria-hidden':true,style:{position:'fixed',width:0,height:0,overflow:'hidden',visibility:'hidden',pointerEvents:'none',fontFamily:'var(--dsw-font-family)'}},'Aa'));
    }
    const dictionaries={zh:{title:'统一字体与字号',description:'上方正文字体和字号统一控制联系人、聊天与 AI 区域。正文、翻译和时间保留阅读层级；代码与终端仍使用各自设置。',check:'检查设置联动',checking:'检查中，字号将短暂变化后恢复…',passed:'检查通过，原字号已恢复。',failed:'检查未通过或有区域未显示，请展开聊天及 AI 区域后重试。'},en:{title:'Unified typography',description:'The text font and size above control contacts, chat and AI. Reading roles keep their hierarchy; code and terminal settings remain independent.',check:'Check setting linkage',checking:'Checking; the size briefly changes, then returns…',passed:'Check passed; original size restored.',failed:'Check incomplete or failed. Show chat and AI, then retry.'}};
    for(const [language,dict] of Object.entries(dictionaries))ctx.effect(()=>ctx.locale.register('yenra-typography',language,dict));
    const t=ctx.locale.bind('yenra-typography');
    function Help(){
      React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());
      React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>last);
      return h('div',{className:'ytype-help'},h('strong',null,t('title')),h('p',null,t('description')),h('button',{type:'button',disabled:inFlight,onClick:()=>verify().catch(()=>{})},t(inFlight?'checking':'check')),last?.verification?h('p',{role:'status'},t(last.verification.passed?'passed':'failed')):null);
    }
    ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'yenra.unified-typography',order:100},Bridge));
    ctx.slots.inject('settings.general.item',()=>ctx.slots.register({name:'settings.general.item',id:'yenra-unified-typography',order:12},Help));
    ctx.effect(()=>()=>{stopped=true;clearTimeout(reportTimer);off();window.removeEventListener('yenra:cloud-typography',cloudListener);events.close();restore();for(const [timer,resolve]of waits){clearTimeout(timer);resolve(false);}waits.clear();for(const abort of requests)abort.abort();listeners.clear();});
  }};
}});
