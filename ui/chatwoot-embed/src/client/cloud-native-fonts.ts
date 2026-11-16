// Added to the existing Cloud component's owned, origin-gated theme bridge.
export function cloudTypography(host:HTMLElement):string {
  const style=getComputedStyle(host),raw=Number.parseFloat(style.getPropertyValue('--dsh-content-font-size'));
  const base=Number.isFinite(raw)?Math.max(10,Math.min(22,raw)):14;
  const family=style.getPropertyValue('--dsw-font-family').trim()||'"Segoe UI","Microsoft YaHei",system-ui,sans-serif';
  const codeFamily=style.getPropertyValue('--ds-font-family-code').trim()||'monospace';
  const rawCode=Number.parseFloat(style.getPropertyValue('--dsh-code-font-size')),codeSize=Number.isFinite(rawCode)?Math.max(10,Math.min(16,rawCode)):11;
  return `html:root{--yenra-font-code-family:${codeFamily};--yenra-font-code-size:${codeSize}px;--yenra-font-body:${base}px;--yenra-font-secondary:${Math.max(10,base-1)}px;--yenra-font-caption:${Math.max(10,base-3)}px;--yenra-font-family:${family}}
html:root body,html:root :is(button,input,textarea,select,.ProseMirror){font-family:var(--yenra-font-family)!important}
html:root body{font-size:var(--yenra-font-body)!important}
html:root .conversations-list .conversation--user{font-family:var(--yenra-font-family)!important;font-size:var(--yenra-font-body)!important;line-height:1.45!important;font-weight:600!important}
html:root .conversations-list .conversation>div:nth-child(2)>div:nth-child(3),html:root .conversations-list .conversation>div:nth-child(2)>div:nth-child(3) :is(p,span){font-family:var(--yenra-font-family)!important;font-size:var(--yenra-font-secondary)!important;line-height:1.5!important}
html:root .conversations-list .conversation>div:nth-child(2){grid-template-rows:auto auto!important}
html:root .conversations-list .conversation{height:auto!important;min-height:max(64px,calc(var(--yenra-font-body)*3 + 22px))!important}
html:root [data-bubble-name="text"],html:root [data-bubble-name="text"] :is(p,.prose),html:root [data-yenra-dsh-chinese]{font-family:var(--yenra-font-family)!important;font-size:var(--yenra-font-body)!important;line-height:1.55!important;font-weight:400!important}
html:root [data-yenra-dsh-original-styled="1"],html:root [data-yenra-dsh-original-styled="1"] :is(p,span){font-family:var(--yenra-font-family)!important;font-size:var(--yenra-font-secondary)!important;line-height:1.5!important;opacity:1!important}
html:root .ProseMirror,html:root .ProseMirror p{font-family:var(--yenra-font-family)!important;font-size:var(--yenra-font-body)!important;line-height:1.5!important}
html:root [data-bubble-name="text"] :is(pre,code,kbd,samp){font-family:var(--yenra-font-code-family)!important;font-size:var(--yenra-font-code-size)!important}
`;
}
export const CLOUD_FONT_PROBE_SCRIPT=String.raw`(()=>{
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none'&&(!el.checkVisibility||el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
  const root=getComputedStyle(document.documentElement),base=parseFloat(root.getPropertyValue('--yenra-font-body'));
  if(!Number.isFinite(base))return null;
  const roles={body:base,secondary:Math.max(10,base-1),caption:Math.max(10,base-3)};
  const specs=[
    ['contact','.conversations-list .conversation--user','body'],
    ['preview','.conversations-list .conversation>div:nth-child(2)>div:nth-child(3)','secondary'],
    ['chat','[data-yenra-dsh-chinese],[data-bubble-name="text"] p:not([data-yenra-dsh-original-styled])','body'],
    ['original','[data-yenra-dsh-original-styled="1"]','secondary'],
    ['composer','.ProseMirror[contenteditable="true"]','body']
  ];
  const samples=[],missing=[];
  for(const [id,selector,role]of specs){const el=[...document.querySelectorAll(selector)].find(visible);if(!el){missing.push(id);continue;}const s=getComputedStyle(el);samples.push({id,size:parseFloat(s.fontSize),expected:roles[role],family:s.fontFamily,lineHeight:s.lineHeight});}
  return{base,samples,missing};
})()`;
