window.__ModuleLoader__.load({
  id:'@local/yenra-private-themes',
  factory(require) {
    const React=require('react'),h=React.createElement;
    // Shared pure data and state machine. Used by Host, Client and regression tests.
const VERSION = '1.1.1';
const DOMAIN_NAME = 'yenra_private_themes';
const PALETTES = [
  {id:'atelier-ivory',scheme:'light',name:'ivory',base:'#EEEAE2',panel:'#F8F5EF',raised:'#E6E0D5',overlay:'#FCFAF6',input:'#F1ECE3',sidebar:'#E7E1D7',text:'#302D28',secondary:'#5E574C',muted:'#645B50',accent:'#79603A',accentHover:'#644D2E',onAccent:'#FAF7F0',border:'#D5CDBF',strong:'#B6A993',bubble:'#E3DACB',selected:'#DED3C1',hover:'#EAE3D8'},
  {id:'atelier-porcelain',scheme:'light',name:'porcelain',base:'#E9EEEA',panel:'#F5F8F4',raised:'#DCE5DD',overlay:'#F9FBF7',input:'#EAF0E9',sidebar:'#E0E8E1',text:'#25382F',secondary:'#4F6257',muted:'#4D6053',accent:'#365E4B',accentHover:'#294B3B',onAccent:'#F5F8F4',border:'#CAD7CC',strong:'#9CAF9F',bubble:'#DCE8DD',selected:'#CDDFD1',hover:'#E2EBE2'},
  {id:'atelier-obsidian',scheme:'dark',name:'obsidian',base:'#1B1C1B',panel:'#232522',raised:'#30332D',overlay:'#2B2E28',input:'#2A2D27',sidebar:'#1F211E',text:'#ECE8DF',secondary:'#BDB8AC',muted:'#B5B0A4',accent:'#CBB58B',accentHover:'#DDC9A3',onAccent:'#25271F',border:'#3B3E35',strong:'#656958',bubble:'#33372E',selected:'#414537',hover:'#30342B'},
  {id:'atelier-dusk',scheme:'dark',name:'dusk',base:'#1D1D25',panel:'#262630',raised:'#33333F',overlay:'#30303C',input:'#2E2E39',sidebar:'#22222B',text:'#E9E7EF',secondary:'#BFBBCE',muted:'#B9B3C9',accent:'#BEB0D8',accentHover:'#D0C2E5',onAccent:'#292333',border:'#41404F',strong:'#686379',bubble:'#383442',selected:'#484052',hover:'#34313F'}
];
const MODES = ['light','dark','system'];
const DEFAULT_STATE = {version:2,revision:0,enabled:false,day:'atelier-ivory',night:'atelier-obsidian',mode:'system',favourites:[],baseline:null};
function palette(id) { const p=PALETTES.find(p=>p.id===id); if(!p) throw new Error('Unknown theme: '+id); return p; }
function normalizeState(value) {
  const v=value && typeof value==='object'?value:{};
  const pick=(id,scheme,fallback)=>PALETTES.some(p=>p.id===id && p.scheme===scheme)?id:fallback;
  const basic=x=>({enabled:x.enabled===true,day:pick(x.day,'light',DEFAULT_STATE.day),night:pick(x.night,'dark',DEFAULT_STATE.night),mode:MODES.includes(x.mode)?x.mode:'system'});
  return {...DEFAULT_STATE,...basic(v),revision:Number.isSafeInteger(v.revision)&&v.revision>=0?v.revision:0,favourites:[...new Set(Array.isArray(v.favourites)?v.favourites.filter(id=>PALETTES.some(p=>p.id===id)):[])],baseline:v.baseline && typeof v.baseline==='object'?basic(v.baseline):null};
}
function transition(value,request) {
  const s=normalizeState(value);
  if(request.action==='get') return s;
  if(request.expectedRevision!==undefined && request.expectedRevision!==s.revision) throw new Error('REVISION_CONFLICT: reload the current theme settings');
  const next={...s,revision:s.revision+1};
  if(request.action==='select') {
    const p=palette(request.id);
    if(!s.baseline) next.baseline={enabled:s.enabled,day:s.day,night:s.night,mode:!s.enabled&&MODES.includes(request.previousMode)?request.previousMode:s.mode};
    next.enabled=true;next[p.scheme==='light'?'day':'night']=p.id;next.mode=p.scheme;
  } else if(request.action==='commit') {
    if(!s.enabled) throw new Error('No private theme is active');
    next.baseline=null;
  } else if(request.action==='restore') {
    if(!s.baseline) throw new Error('No trial to undo');
    Object.assign(next,s.baseline,{baseline:null});
  } else if(request.action==='disable') {
    next.enabled=false;next.baseline=null;
  } else if(request.action==='favourite') {
    palette(request.id);
    if(typeof request.enabled!=='boolean') throw new Error('Favourite requires an explicit enabled boolean');
    next.favourites=request.enabled?[...new Set([...s.favourites,request.id])]:s.favourites.filter(id=>id!==request.id);
  } else if(request.action==='mode') {
    if(!MODES.includes(request.mode)) throw new Error('Unknown appearance mode');
    next.mode=request.mode;
  } else throw new Error('Unknown theme action');
  return normalizeState(next);
}
function tokens(p) {
  const values={'bg-base':p.base,'bg-layer-1':p.panel,'bg-layer-2':p.raised,'bg-layer-3':p.selected,'bg-module-platform':p.base,'bg-overlay':p.overlay,'border-l1':p.border,'border-l2':p.strong,'border-l3':p.strong,'brand-primary':p.accent,'label-primary':p.text,'label-secondary':p.secondary,'label-tertiary':p.muted,'label-caption':p.muted,'label-primary-foreground':p.onAccent,'label-primary-inverted':p.onAccent,'button-primary-hover':p.accentHover,'button-elevated-fill':p.raised,'button-floating-fill':p.overlay,'button-floating-hover':p.hover,'button-ghost-active-fill':p.selected,'button-ghost-active-hover':p.hover,'button-info-fill':p.selected,'button-info-hover':p.hover,'fill-l1':p.raised,'fill-l2':p.selected,'interactive-bg-active':p.selected,'interactive-bg-hover':p.hover,'interactive-bg-hover-solid':p.hover,'markdown-code-block':p.sidebar,'markdown-code-block-banner':p.raised,'markdown-inline-code':p.selected,'markdown-tag':p.selected,'menu-icon':p.secondary};
  return {...Object.fromEntries(Object.entries(values).map(([k,v])=>['--dsw-alias-'+k,v])),
    '--dsw-menu-surface-fill':p.overlay,'--dsw-menu-backdrop-filter':'none','--dsw-specific-bubble':p.bubble,'--dsw-specific-bubble-highlight':p.selected,'--dsw-specific-input-major':p.input,'--dsw-specific-login-input':p.input,'--dsw-specific-menu':p.overlay,'--dsw-specific-selector':p.input,'--dsw-specific-sidebar-fill':p.sidebar,'--dsw-specific-sidebar-nav-item-active':p.selected,'--dsw-specific-sidebar-nav-item-hover':p.hover,'--dsw-specific-tip':p.overlay};
}
function tokenPairs(value) {
  const s=normalizeState(value),light=tokens(palette(s.day)),dark=tokens(palette(s.night));
  return Object.fromEntries(Object.keys(light).map(name=>[name,{light:light[name],dark:dark[name]}]));
}
// A pure decision, not a theme/change -> preference-write feedback loop.
function needsOverlay(snapshot,pairs) {
  return Object.entries(pairs).some(([key,modes])=>snapshot.active.tokens[key]!==modes[snapshot.active.colorScheme]);
}

    // Pure service adapter. No React, DOM, timers, localStorage, or preference writes from change events.
function createAppearanceController({theme,subscribe,onExternalMode=()=>{},onChanged=()=>{}}) {
  let state=null,pairs=null,disposeLayer=null,busy=false,stopped=false,lastPreference=theme.getTheme().preference;
  const source='@local/yenra-private-themes';
  function updateLayer(snapshot) {
    if(!pairs || busy || stopped)return;
    if(!Object.entries(pairs).some(([key,modes])=>snapshot.active.tokens[key]!==modes[snapshot.active.colorScheme]))return;
    busy=true;
    try {
      const previous=disposeLayer;
      disposeLayer=theme.overrideTokens(source,pairs);
      previous?.(); // old disposer cannot remove a newer layer of the same source.
    } finally {busy=false;}
  }
  const off=subscribe(snapshot=>{
    if(busy || stopped)return;
    updateLayer(snapshot);
    const pref=theme.getTheme().preference;
    if(state?.enabled && pref!==lastPreference && ['light','dark','system'].includes(pref))onExternalMode(pref);
    lastPreference=pref;
    onChanged();
  });
  return {
    apply(next,nextPairs) {
      if(stopped)return;
      const syncMode=next.enabled ? state?.enabled!==true || state.mode!==next.mode : state?.enabled===true && state.mode!==next.mode;
      state=next;pairs=next.enabled?nextPairs:null;
      busy=true;
      try {
        if(syncMode && theme.getTheme().preference!==next.mode)theme.setTheme(next.mode);
        if(!pairs){disposeLayer?.();disposeLayer=null;}
      } finally {busy=false;}
      updateLayer(theme.getTheme());
      lastPreference=theme.getTheme().preference;
      onChanged();
    },
    dispose() {stopped=true;off();disposeLayer?.();disposeLayer=null;}
  };
}

    return {
      inject:['theme','slots','locale'],
      apply(ctx) {
        const ns='yenra-private-atelier',endpoint='/api/yenra-private-themes';
        const zh={title:'私人定制',eyebrow:'PRIVATE ATELIER · 1.1',intro:'白天清晰，夜晚沉静。先试用，再决定是否保留。',ivory:'象牙香槟',porcelain:'雾瓷松绿',obsidian:'黑曜香槟',dusk:'暮紫铂银',ivoryDesc:'暖白 · 古铜 · 纸感层次',porcelainDesc:'瓷白 · 松绿 · 清爽安静',obsidianDesc:'炭黑 · 香槟 · 温润低眩光',duskDesc:'灰紫 · 铂银 · 克制暮色',day:'日间',night:'夜间',try:'试用',active:'正在使用',configured:'已设为此模式',save:'保存并使用',undo:'撤销本轮试用',disable:'使用宿主外观',favourite:'收藏',unfavourite:'取消收藏',mode:'明暗模式',light:'白天',dark:'夜晚',system:'跟随系统',materials:'材质与阅读',materialBody:'实心底色、分层输入区与代码区；宿主菜单毛玻璃已通过主题参数关闭。不再用强调色铺满正文。原外观插件的独立透明度滑块未修改。',persistence:'方案和收藏由本机服务保存，重启换端口后仍可读取。',trial:'试用中 · 可随时撤销',kept:'已保存',host:'当前使用宿主外观',loading:'正在读取已保存方案…',offline:'尚未连接本机主题服务；未提交更改。',working:'正在保存…',failed:'操作失败：',conflict:'设置已在另一处更改，已重新读取，请重试。',checking:'配色覆盖检查中',covered:'运行时配色参数一致',mismatch:'检测到其他样式覆盖',limit:'参数一致不等于视觉验收；此处不检测屏幕像素。',old:'原外观插件应保持停用，以免两套外观规则同时覆盖。',retry:'重新读取'};
        const en={title:'Private Atelier',eyebrow:'PRIVATE ATELIER · 1.1',intro:'Clarity by day. Quiet by night. Try before you keep.',ivory:'Ivory & Champagne',porcelain:'Porcelain & Pine',obsidian:'Obsidian & Champagne',dusk:'Dusk & Platinum',ivoryDesc:'Warm ivory · Bronze · Paper-like layers',porcelainDesc:'Porcelain · Pine · Quiet clarity',obsidianDesc:'Charcoal · Champagne · Low glare',duskDesc:'Grey violet · Platinum · Muted dusk',day:'Day collection',night:'Night collection',try:'Try',active:'In use',configured:'Set for this mode',save:'Save and use',undo:'Undo this trial',disable:'Use host appearance',favourite:'Keep favourite',unfavourite:'Remove favourite',mode:'Appearance',light:'Day',dark:'Night',system:'Follow system',materials:'Material & reading',materialBody:'Opaque surfaces, layered composer and code surfaces. The host menu glass filter is disabled through theme tokens. Accents are not used as body text. The old appearance plugin’s separate opacity sliders are unchanged.',persistence:'Themes and favourites are stored by the local Host and survive port changes after restart.',trial:'Trial · undo available',kept:'Saved',host:'Using host appearance',loading:'Loading saved themes…',offline:'Theme service is not connected; no changes submitted.',working:'Saving…',failed:'Could not apply: ',conflict:'Settings changed elsewhere. Reloaded; please try again.',checking:'Checking token coverage',covered:'Runtime colour tokens match',mismatch:'Another override was detected',limit:'Token agreement is not a screenshot or visual acceptance test.',old:'Keep the old appearance plugin disabled to avoid competing overrides.',retry:'Reload'};
        ctx.effect(()=>ctx.locale.register(ns,'zh',zh));ctx.effect(()=>ctx.locale.register(ns,'en',en));
        const t=ctx.locale.bind(ns),listeners=new Set(),aborters=new Set();
        const clientId=globalThis.crypto?.randomUUID?.()||'atelier-'+Date.now()+'-'+Math.random().toString(16).slice(2);
        let view={state:null,online:false,error:'',busy:false,coverage:null},stopped=false,reportTimer,tail=Promise.resolve();
        const emit=patch=>{if(stopped)return;view={...view,...patch};for(const fn of listeners)fn();};
        const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
        async function api(path,body) {
          if(stopped)throw new Error('Theme plugin stopped');
          const abort=new AbortController();aborters.add(abort);
          const timeout=setTimeout(()=>abort.abort(),8000);
          try {
            const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'content-type':'application/json'}:{accept:'application/json'},body:body?JSON.stringify(body):undefined,signal:abort.signal,cache:'no-store'});
            const value=await response.json();
            if(!response.ok || value.ok!==true){const error=new Error(value.message||'HTTP '+response.status);error.result=value;throw error;}
            return value;
          } finally {clearTimeout(timeout);aborters.delete(abort);}
        }
        function report() {
          clearTimeout(reportTimer);
          reportTimer=setTimeout(()=>{
            if(stopped||!view.state)return;
            const snapshot=ctx.theme.getTheme(),pairs=tokenPairs(view.state);
            const mismatches=view.state.enabled?Object.entries(pairs).filter(([key,modes])=>snapshot.active.tokens[key]!==modes[snapshot.active.colorScheme]).map(([key])=>key):[];
            emit({coverage:mismatches});
            api(endpoint+'/diagnostic',{clientId,version:VERSION,revision:view.state.revision,preference:snapshot.preference,scheme:snapshot.active.colorScheme,enabled:view.state.enabled,mismatches,fontSize:snapshot.fontSizes.text}).catch(()=>{});
          },80);
        }
        const appearance=createAppearanceController({theme:ctx.theme,subscribe:fn=>ctx.on('theme/change',fn),onChanged:()=>{emit({});report();},onExternalMode:mode=>{if(view.state?.enabled)act({action:'mode',mode}).catch(()=>{});}});
        function accept(value) {
          if(!value?.state||stopped)return;
          const next=normalizeState(value.state);
          if(view.state && next.revision<view.state.revision)return;
          if(view.state && next.revision===view.state.revision){emit({online:true,error:''});return;}
          emit({state:next,online:true,error:''});appearance.apply(next,tokenPairs(next));
        }
        async function reload() {try{accept(await api(endpoint));}catch(error){emit({online:false,error:String(error.message||error)});}}
        function act(request) {
          const job=tail.then(async()=>{
            if(stopped)throw new Error('Theme plugin stopped');
            if(!view.state)throw new Error(t('offline'));
            emit({busy:true,error:''});
            try {
              const value=await api(endpoint,{...request,expectedRevision:view.state.revision});
              accept(value);return value;
            } catch(error) {
              if(error.result?.state)accept(error.result);
              emit({error:error.result?.code==='conflict'?t('conflict'):t('failed')+String(error.message||error)});
              throw error;
            } finally {emit({busy:false});}
          });
          tail=job.catch(()=>{});return job;
        }
        const events=new EventSource(endpoint+'/events',{withCredentials:true});
        events.onmessage=event=>{try{accept(JSON.parse(event.data));}catch(error){emit({error:String(error.message||error)});}};
        events.onerror=()=>emit({online:false});
        const onOnline=()=>reload();
        window.addEventListener('online',onOnline);
        // One baseline acquisition; subsequent state is pushed, not command-log polling.
        reload();
        ctx.effect(()=>()=>{stopped=true;clearTimeout(reportTimer);events.close();window.removeEventListener('online',onOnline);for(const a of aborters)a.abort();appearance.dispose();listeners.clear();});
        function View() {
          React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());
          const data=React.useSyncExternalStore(subscribe,()=>view),s=data.state,snapshot=ctx.theme.getTheme();
          const run=request=>{act(request).catch(()=>{});};
          const button=(text,request,props={})=>h('button',{type:'button',className:'yat-action',disabled:!s||data.busy||!data.online,onClick:()=>run(request),...props},text);
          const row=(scheme)=>h('section',{className:'yat-collection',key:scheme},
            h('h3',{className:'yat-label'},t(scheme==='light'?'day':'night')),
            PALETTES.filter(p=>p.scheme===scheme).map((p,i)=>{
              const configured=s?.[scheme==='light'?'day':'night']===p.id,active=s?.enabled&&configured&&snapshot.active.colorScheme===scheme;
              return h('article',{className:'yat-choice'+(active?' yat-selected':''),key:p.id},
                h('div',{className:'yat-swatches','aria-hidden':true,style:{background:p.base}},[p.sidebar,p.panel,p.bubble,p.accent].map((c,index)=>h('i',{key:index,style:{background:c,borderColor:p.border}}))),
                h('div',{className:'yat-choice-copy'},h('div',{className:'yat-choice-title'},h('span',null,t(p.name)),s?.favourites.includes(p.id)?h('span',{'aria-hidden':true},' ◇'):null),h('p',null,t(p.name+'Desc')),
                  h('div',{className:'yat-choice-actions'},button(t(active?'active':'try'),{action:'select',id:p.id,previousMode:MODES.includes(snapshot.preference)?snapshot.preference:snapshot.active.colorScheme},{'aria-pressed':active}),
                    button(s?.favourites.includes(p.id)?'◆':'◇',{action:'favourite',id:p.id,enabled:!s?.favourites.includes(p.id)},{'aria-label':t(p.name)+' · '+t(s?.favourites.includes(p.id)?'unfavourite':'favourite'),'aria-pressed':!!s?.favourites.includes(p.id),className:'yat-action yat-quiet'})))
              );
            }));
          return h('section',{className:'yat-root'},
            h('style',null,`.yat-root{color:var(--dsw-alias-label-primary);max-width:720px;padding:8px 0 24px;line-height:1.65}.yat-eyebrow{font-size:10px;letter-spacing:.2em;color:var(--dsw-alias-label-secondary);margin:0 0 10px}.yat-root h2{font-size:23px;letter-spacing:.04em;font-weight:550;margin:0 0 6px}.yat-intro{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0 0 22px}.yat-status{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.yat-label{font-size:11px;font-weight:500;letter-spacing:.12em;color:var(--dsw-alias-label-secondary);margin:22px 0 10px}.yat-choice{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yat-swatches{display:grid;grid-template-columns:1fr 1fr;gap:4px;align-content:center;flex:0 0 76px;padding:8px;border-radius:5px}.yat-swatches i{height:24px;border:1px solid;border-radius:2px}.yat-choice-copy{flex:1;min-width:0}.yat-choice-title{font-size:15px;font-weight:550}.yat-choice p{font-size:12px;color:var(--dsw-alias-label-secondary);margin:3px 0 10px}.yat-choice-actions,.yat-footer,.yat-modes{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.yat-action{font:inherit;font-size:12px;line-height:1.5;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.yat-action:hover{background:var(--dsw-alias-bg-layer-2)}.yat-action[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 2px 0 var(--dsw-alias-brand-primary)}.yat-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.yat-action:disabled{opacity:.45;cursor:default}.yat-quiet{border-color:transparent;padding-inline:8px}.yat-primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);border-color:var(--dsw-alias-brand-primary)}.yat-primary:hover{background:var(--dsw-alias-button-primary-hover)}.yat-footer{margin:24px 0 18px}.yat-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0;line-height:1.8}.yat-error{font-size:12px;color:var(--dsw-alias-label-primary);border-left:2px solid var(--dsw-alias-brand-primary);padding-left:10px;margin:12px 0}.yat-coverage{font-size:11px;color:var(--dsw-alias-label-secondary);margin:18px 0 4px}`),
            h('p',{className:'yat-eyebrow'},t('eyebrow')),h('h2',null,t('title')),h('p',{className:'yat-intro'},t('intro')),
            h('div',{className:'yat-status',role:'status'},s?h('span',null,t(s.enabled?(s.baseline?'trial':'kept'):'host')):t('loading'),data.busy?h('span',null,t('working')):null),
            !data.online?h('div',{className:'yat-error'},t('offline'),' ',h('button',{className:'yat-action',onClick:reload,type:'button'},t('retry'))):null,
            data.error?h('p',{className:'yat-error',role:'alert'},data.error):null,
            row('light'),row('dark'),
            h('div',{className:'yat-footer'},button(t('save'),{action:'commit'},{className:'yat-action yat-primary',disabled:!s?.enabled||!s?.baseline||data.busy||!data.online}),button(t('undo'),{action:'restore'},{disabled:!s?.baseline||data.busy||!data.online}),button(t('disable'),{action:'disable'},{className:'yat-action yat-quiet',disabled:!s?.enabled||data.busy||!data.online})),
            h('h3',{className:'yat-label'},t('mode')),h('div',{className:'yat-modes'},['light','dark','system'].map(mode=>button(t(mode),{action:'mode',mode},{key:mode,'aria-pressed':snapshot.preference===mode,disabled:!s?.enabled||data.busy||!data.online}))),
            h('h3',{className:'yat-label'},t('materials')),h('p',{className:'yat-note'},t('materialBody')),h('p',{className:'yat-note'},t('persistence')),h('p',{className:'yat-note'},t('old')),
            s?.enabled?h('p',{className:'yat-coverage'},t(data.coverage===null?'checking':data.coverage.length?'mismatch':'covered')):null,
            h('p',{className:'yat-note'},t('limit')));
        }
        // One owner and one View: no duplicate full panel in General, no per-view saved state.
        ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'yenra-private-atelier',order:2,label:()=>t('title')},View));
      }
    };
  }
});
