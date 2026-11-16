export const VERSION='1.0.1';
export function hasCoverage(report){return !!report&&report.samples.some(s=>s.id==='contact')&&report.samples.some(s=>['chat','original'].includes(s.id))&&report.samples.some(s=>s.id.startsWith('ai-'));}
export function checkPhases(before,during,after,original,changed){return [before,during,after].every(r=>hasCoverage(r)&&r.samples.every(s=>s.pass))&&changed.length>0&&after.base===original;}
export function visibleElement(el){const s=getComputedStyle(el);return el.getClientRects().length>0&&s.visibility!=='hidden'&&s.display!=='none'&&(!el.checkVisibility||el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));}
export const SAMPLES=[
  {id:'contact',selector:'.yenra-social-shell .yenra-contact-name',role:'body'},
  {id:'preview',selector:'.yenra-social-shell .yenra-contact-preview',role:'secondary'},
  {id:'chat',selector:'.yenra-social-shell .yenra-message-surface p[class~="wa:whitespace-pre-wrap"]:not([data-testid="yenra-original-text"]):not([data-testid="yenra-original-caption"])',role:'body'},
  {id:'original',selector:'.yenra-social-shell .yenra-message-surface p[data-testid="yenra-original-text"],.yenra-social-shell .yenra-message-surface p[data-testid="yenra-original-caption"]',role:'secondary'},
  {id:'time',selector:'.yenra-social-shell [data-testid="message-time"]',role:'caption'},
  {id:'ai-original',selector:'#yenra-brain-panel .yenra-native-reply-original',role:'body'},
  {id:'ai-translation',selector:'#yenra-brain-panel .yenra-native-reply-translation',role:'secondary'},
  {id:'ai-prose',selector:'#yenra-brain-panel [data-chat-group-part="response"] p:not(.yenra-native-reply-original):not(.yenra-native-reply-translation)',role:'body'},
  {id:'composer',selector:'.yenra-social-shell textarea,.yenra-social-shell [contenteditable="true"]',role:'body'}
];
export function scale(base){return {body:base,secondary:Math.max(10,base-1),caption:Math.max(10,base-3)};}
export const CSS=String.raw`
/* The official General settings are the only source of font preferences. */
body :is(.yenra-v2,.yenra-social-shell,.yat-root){
  --ytype-body:var(--dsh-content-font-size,14px);
  --ytype-secondary:max(10px,calc(var(--dsh-content-font-size,14px) - 1px));
  --ytype-caption:max(10px,calc(var(--dsh-content-font-size,14px) - 3px));
  font-family:var(--dsw-font-family,"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif)!important;
  font-size:var(--ytype-body);font-weight:400;
}
body .yenra-social-shell :is(button,input,textarea,select,[contenteditable="true"]),
body .yat-root :is(button,input,textarea,select){font-family:var(--dsw-font-family)!important;font-size:var(--ytype-body)!important;line-height:1.5!important}
body .yenra-social-shell .yenra-contact-name{font-family:var(--dsw-font-family)!important;font-size:var(--ytype-body)!important;font-weight:600!important;line-height:1.45!important}
body .yenra-social-shell .yenra-contact-preview{font-family:var(--dsw-font-family)!important;font-size:var(--ytype-secondary)!important;font-weight:400!important;line-height:1.5!important;color:var(--dsw-alias-label-secondary)!important}
body .yenra-social-shell .yenra-message-surface p[class~="wa:whitespace-pre-wrap"]{font-family:var(--dsw-font-family)!important;font-size:var(--ytype-body)!important;font-weight:400!important;line-height:1.55!important;letter-spacing:normal!important}
body .yenra-social-shell .yenra-message-surface :is(p[data-testid="yenra-original-text"],p[data-testid="yenra-original-caption"]){font-size:var(--ytype-secondary)!important;line-height:1.5!important;color:var(--dsw-alias-label-secondary)!important;opacity:1!important;margin-top:.35em!important}
body .yenra-social-shell .yenra-message-surface [data-testid="message-time"]{font-family:var(--dsw-font-family)!important;font-size:var(--ytype-caption)!important;line-height:1.4!important;color:var(--dsw-alias-label-secondary)!important}
body #yenra-brain-panel{--ytype-body:var(--dsh-content-font-size,14px);--ytype-secondary:max(10px,calc(var(--dsh-content-font-size,14px) - 1px));--ytype-caption:max(10px,calc(var(--dsh-content-font-size,14px) - 3px));font-family:var(--dsw-font-family)!important;font-size:var(--ytype-body)!important}
body #yenra-brain-panel [data-chat-group-part="response"] :is(p,li,blockquote){font-family:var(--dsw-font-family)!important;font-size:var(--ytype-body)!important;font-weight:400!important;line-height:1.55!important}
body #yenra-brain-panel .yenra-native-reply-candidates p.yenra-native-reply-original{font-family:var(--dsw-font-family)!important;font-size:var(--ytype-body)!important;font-weight:400!important;line-height:1.55!important}
body #yenra-brain-panel .yenra-native-reply-candidates p.yenra-native-reply-translation{font-family:var(--dsw-font-family)!important;font-size:var(--ytype-secondary)!important;font-weight:400!important;line-height:1.5!important;color:var(--dsw-alias-label-secondary)!important}
body #yenra-brain-panel :is(button,input,textarea,select){font-family:var(--dsw-font-family)!important;font-size:var(--ytype-secondary)!important}
/* Restore the independent code role after prose rules; never touch terminal/Monaco. */
body #yenra-brain-panel [data-chat-group-part="response"] :is(pre,code,kbd,samp){font-family:var(--ds-font-family-code,monospace)!important;font-size:var(--dsh-code-font-size,11px)!important}
body .yat-root :is(.yat-note,.yat-intro,.yat-choice p,.yat-status){font-size:var(--ytype-secondary)!important}
body .yat-root :is(.yat-label,.yat-eyebrow,.yat-coverage){font-size:var(--ytype-caption)!important}
body .yat-root .yat-choice-title{font-size:var(--ytype-body)!important}
.ytype-help{font-family:var(--dsw-font-family);font-size:var(--dsh-content-font-size,14px);padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);line-height:1.6;color:var(--dsw-alias-label-primary)}
.ytype-help p{margin:4px 0;color:var(--dsw-alias-label-secondary);font-size:max(10px,calc(var(--dsh-content-font-size,14px) - 1px))}
.ytype-help button{font:inherit;font-size:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:inherit;padding:4px 9px;margin-top:6px;cursor:pointer}
`;
