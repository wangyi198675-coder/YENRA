// Shared pure data and state machine. Used by Host, Client and regression tests.
export const VERSION = '1.1.1';
export const DOMAIN_NAME = 'yenra_private_themes';
export const PALETTES = [
  {id:'atelier-ivory',scheme:'light',name:'ivory',base:'#EEEAE2',panel:'#F8F5EF',raised:'#E6E0D5',overlay:'#FCFAF6',input:'#F1ECE3',sidebar:'#E7E1D7',text:'#302D28',secondary:'#5E574C',muted:'#645B50',accent:'#79603A',accentHover:'#644D2E',onAccent:'#FAF7F0',border:'#D5CDBF',strong:'#B6A993',bubble:'#E3DACB',selected:'#DED3C1',hover:'#EAE3D8'},
  {id:'atelier-porcelain',scheme:'light',name:'porcelain',base:'#E9EEEA',panel:'#F5F8F4',raised:'#DCE5DD',overlay:'#F9FBF7',input:'#EAF0E9',sidebar:'#E0E8E1',text:'#25382F',secondary:'#4F6257',muted:'#4D6053',accent:'#365E4B',accentHover:'#294B3B',onAccent:'#F5F8F4',border:'#CAD7CC',strong:'#9CAF9F',bubble:'#DCE8DD',selected:'#CDDFD1',hover:'#E2EBE2'},
  {id:'atelier-obsidian',scheme:'dark',name:'obsidian',base:'#1B1C1B',panel:'#232522',raised:'#30332D',overlay:'#2B2E28',input:'#2A2D27',sidebar:'#1F211E',text:'#ECE8DF',secondary:'#BDB8AC',muted:'#B5B0A4',accent:'#CBB58B',accentHover:'#DDC9A3',onAccent:'#25271F',border:'#3B3E35',strong:'#656958',bubble:'#33372E',selected:'#414537',hover:'#30342B'},
  {id:'atelier-dusk',scheme:'dark',name:'dusk',base:'#1D1D25',panel:'#262630',raised:'#33333F',overlay:'#30303C',input:'#2E2E39',sidebar:'#22222B',text:'#E9E7EF',secondary:'#BFBBCE',muted:'#B9B3C9',accent:'#BEB0D8',accentHover:'#D0C2E5',onAccent:'#292333',border:'#41404F',strong:'#686379',bubble:'#383442',selected:'#484052',hover:'#34313F'}
];
export const MODES = ['light','dark','system'];
export const DEFAULT_STATE = {version:2,revision:0,enabled:false,day:'atelier-ivory',night:'atelier-obsidian',mode:'system',favourites:[],baseline:null};
export function palette(id) { const p=PALETTES.find(p=>p.id===id); if(!p) throw new Error('Unknown theme: '+id); return p; }
export function normalizeState(value) {
  const v=value && typeof value==='object'?value:{};
  const pick=(id,scheme,fallback)=>PALETTES.some(p=>p.id===id && p.scheme===scheme)?id:fallback;
  const basic=x=>({enabled:x.enabled===true,day:pick(x.day,'light',DEFAULT_STATE.day),night:pick(x.night,'dark',DEFAULT_STATE.night),mode:MODES.includes(x.mode)?x.mode:'system'});
  return {...DEFAULT_STATE,...basic(v),revision:Number.isSafeInteger(v.revision)&&v.revision>=0?v.revision:0,favourites:[...new Set(Array.isArray(v.favourites)?v.favourites.filter(id=>PALETTES.some(p=>p.id===id)):[])],baseline:v.baseline && typeof v.baseline==='object'?basic(v.baseline):null};
}
export function transition(value,request) {
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
export function tokens(p) {
  const values={'bg-base':p.base,'bg-layer-1':p.panel,'bg-layer-2':p.raised,'bg-layer-3':p.selected,'bg-module-platform':p.base,'bg-overlay':p.overlay,'border-l1':p.border,'border-l2':p.strong,'border-l3':p.strong,'brand-primary':p.accent,'label-primary':p.text,'label-secondary':p.secondary,'label-tertiary':p.muted,'label-caption':p.muted,'label-primary-foreground':p.onAccent,'label-primary-inverted':p.onAccent,'button-primary-hover':p.accentHover,'button-elevated-fill':p.raised,'button-floating-fill':p.overlay,'button-floating-hover':p.hover,'button-ghost-active-fill':p.selected,'button-ghost-active-hover':p.hover,'button-info-fill':p.selected,'button-info-hover':p.hover,'fill-l1':p.raised,'fill-l2':p.selected,'interactive-bg-active':p.selected,'interactive-bg-hover':p.hover,'interactive-bg-hover-solid':p.hover,'markdown-code-block':p.sidebar,'markdown-code-block-banner':p.raised,'markdown-inline-code':p.selected,'markdown-tag':p.selected,'menu-icon':p.secondary};
  return {...Object.fromEntries(Object.entries(values).map(([k,v])=>['--dsw-alias-'+k,v])),
    '--dsw-menu-surface-fill':p.overlay,'--dsw-menu-backdrop-filter':'none','--dsw-specific-bubble':p.bubble,'--dsw-specific-bubble-highlight':p.selected,'--dsw-specific-input-major':p.input,'--dsw-specific-login-input':p.input,'--dsw-specific-menu':p.overlay,'--dsw-specific-selector':p.input,'--dsw-specific-sidebar-fill':p.sidebar,'--dsw-specific-sidebar-nav-item-active':p.selected,'--dsw-specific-sidebar-nav-item-hover':p.hover,'--dsw-specific-tip':p.overlay};
}
export function tokenPairs(value) {
  const s=normalizeState(value),light=tokens(palette(s.day)),dark=tokens(palette(s.night));
  return Object.fromEntries(Object.keys(light).map(name=>[name,{light:light[name],dark:dark[name]}]));
}
// A pure decision, not a theme/change -> preference-write feedback loop.
export function needsOverlay(snapshot,pairs) {
  return Object.entries(pairs).some(([key,modes])=>snapshot.active.tokens[key]!==modes[snapshot.active.colorScheme]);
}
