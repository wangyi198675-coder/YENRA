window.__ModuleLoader__.load({
  id:'@local/yenra-private-themes',
  factory(require) {
    const React=require('react'),h=React.createElement;
    /*__CORE__*/
    /*__APPEARANCE__*/
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
