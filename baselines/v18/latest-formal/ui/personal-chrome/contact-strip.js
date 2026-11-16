// Native Chatwoot tab names/classes are recognized, never inferred from list rows.
export function queueName(value){const text=String(value).trim();if(/^(?:我的|Mine|My)$/iu.test(text))return'mine';if(/^(?:未分配(?:的)?|Unassigned)$/iu.test(text))return'unassigned';if(/^(?:所有的|所有|全部|All)$/iu.test(text))return'all';return null;}
export function nativeAllActive(classes,selected){return selected==='true'||selected==='active'||String(classes).split(/\s+/u).some(v=>['after:opacity-100','is-active','active','selected'].includes(v));}
export function validNativeTabs(s){return s.groupConnected===true&&s.groupContained===true&&s.childCount===3&&Array.isArray(s.parts)&&s.parts.length===3&&new Set(s.parts.map(p=>p.kind)).size===3&&s.parts.every(p=>['mine','unassigned','all'].includes(p.kind)&&p.connected===true&&p.contained===true&&p.actualKind===p.kind);}
export const PERSONAL_CONTACT_SCRIPT=String.raw`(()=>{
 const queueName=${queueName.toString()};
 const nativeAllActive=${nativeAllActive.toString()};
 const validNativeTabs=${validNativeTabs.toString()};
 const key='__yenraPersonalContactsV1';
 if(window[key]?.version===4)return window[key].enable();
 window[key]?.disable?.();
 const locale=()=>/^zh/iu.test(document.documentElement.lang||'zh')||!!record?.parts.some(p=>/[\u3400-\u9fff]/u.test(labelNode(p.a)?.nodeValue??directText(p.a)));
 const labels=()=>locale()?{heading:'联系人',all:'全部',hint:'全部会话（当前原生筛选范围）'}:{heading:'Contacts',all:'All',hint:'All conversations in the current native filter scope'};
 let enabled=false,frame=0,record=null,style=null,scopedWrap=null,reason='not-mounted';
 const attempted=new WeakSet();
 const name=queueName;
 const active=el=>!!el&&(nativeAllActive(el.className,el.getAttribute('aria-selected')??el.getAttribute('data-state')??el.getAttribute('data-active'))||(!!el.parentElement&&nativeAllActive(el.parentElement.className,el.parentElement.getAttribute('aria-selected'))));
 const directText=el=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.nodeValue).join('').trim();
 const css=/*__CONTACT_CSS__*/; /*
 .conversations-list-wrap [data-yenra-personal-strip]{height:32px!important;min-height:32px!important;margin:0!important;padding:0!important;flex-shrink:0;border-bottom:1px solid rgb(var(--slate-6) / .45)!important}
 .conversations-list-wrap [data-yenra-personal-tabs]{display:flex!important;align-items:center;justify-content:space-between;width:100%;min-height:32px;margin:0!important;padding:0 10px!important;overflow:visible!important}
 .conversations-list-wrap [data-yenra-personal-tabs]::after{content:attr(data-yenra-all-label);font-family:var(--yenra-font-family,inherit);font-size:var(--yenra-font-caption,11px);line-height:1.4;color:rgb(var(--slate-11));font-weight:400}
 .conversations-list-wrap [data-yenra-personal-hidden]{display:none!important}
 .conversations-list-wrap [data-yenra-personal-all]{margin:0!important;padding:0!important;flex:0 1 auto;min-width:0}
 .conversations-list-wrap [data-yenra-personal-heading]{font-family:var(--yenra-font-family,inherit)!important;font-size:max(11px,var(--yenra-font-body,14px))!important;font-weight:600!important;line-height:1.4!important;padding:0!important;color:rgb(var(--slate-12))!important;cursor:default!important;gap:6px}
 .conversations-list-wrap [data-yenra-personal-heading]::after{display:none!important}
 .conversations-list-wrap [data-yenra-personal-heading]>div{background:transparent!important;color:rgb(var(--slate-11))!important;font-size:var(--yenra-font-caption,11px)!important;font-weight:400!important;min-width:0!important;height:auto!important;padding:0!important;margin:0!important;border-radius:0!important}
 */
 function put(node,attr,value){const existing=record.changes.find(x=>x.node===node&&x.attr===attr);if(existing){existing.value=value;node.setAttribute(attr,value);return;}record.changes.push({node,attr,old:node.getAttribute(attr),value});node.setAttribute(attr,value);}
 function restore(){if(!record)return;for(const x of record.changes){if(x.node.getAttribute(x.attr)!==x.value)continue;if(x.old===null)x.node.removeAttribute(x.attr);else x.node.setAttribute(x.attr,x.old);}if(record.labelNode?.nodeValue===record.labelValue)record.labelNode.nodeValue=record.originalText;record=null;}
 function labelNode(el){for(const node of el.childNodes){if(node.nodeType===3&&name(node.nodeValue))return node;}for(const span of el.querySelectorAll('span'))for(const node of span.childNodes){if(node.nodeType===3&&name(node.nodeValue))return node;}return null;}
 function candidates(wrap){return [...wrap.querySelectorAll('a,button,[role="tab"]')].filter(a=>!a.closest('.conversations-list,.conversation')).map(a=>{const label=labelNode(a);return label?{a,label,kind:name(label.nodeValue)}:null;}).filter(Boolean);}
 function find(wrap){
  const controls=candidates(wrap);
  for(const control of controls){let group=control.a.parentElement;
   for(let depth=0;depth<3&&group&&group!==wrap;depth++,group=group.parentElement){
    if(group.querySelector('.conversations-list'))break;
    const parts=controls.filter(p=>group.contains(p.a));
    if(group.children.length!==3||parts.length!==3||new Set(parts.map(p=>p.kind)).size!==3)continue;
    for(const part of parts){let branch=part.a;while(branch.parentElement!==group)branch=branch.parentElement;part.li=branch;}
    if(new Set(parts.map(p=>p.li)).size!==3)continue;
    const strip=group.tagName==='UL'&&group.parentElement!==wrap&&group.parentElement.children.length===1?group.parentElement:group;
    return{group,strip,parts,all:parts.find(p=>p.kind==='all').a,changes:[]};
   }
  }return null;
 }
 function recordValid(wrap){if(!record||!wrap)return false;return validNativeTabs({groupConnected:record.group.isConnected,groupContained:wrap.contains(record.group),childCount:record.group.children.length,parts:record.parts.map(p=>({kind:p.kind,connected:p.a.isConnected&&p.li.isConnected,contained:record.group.contains(p.li)&&p.li.contains(p.a),actualKind:p.a===record.all&&record.labelNode?.isConnected&&p.a.contains(record.labelNode)&&record.labelNode.nodeValue===record.labelValue?'all':(p.a.isConnected?name(labelNode(p.a)?.nodeValue):null)}))});}
 function render(){
  frame=0;if(!enabled)return;
  if(location.origin!=='https://app.chatwoot.com'||!location.pathname.startsWith('/app/accounts/196799/')){restore();reason='outside-owner-account';return;}
  const wrap=document.querySelector('.conversations-list-wrap');
  if(!wrap){restore();reason='list-not-mounted';return;}
  if(scopedWrap!==wrap){scopeObserver.disconnect();scopeObserver.observe(wrap,{subtree:true,attributes:true,attributeFilter:['class','aria-selected','data-state','data-active']});scopedWrap=wrap;}
  if(record&&!recordValid(wrap))restore();
  if(!record)record=find(wrap);
  if(!record){reason='native-tab-contract-not-recognized';return;}
  const all=record.all;
  if(!active(all)||record.parts.filter(p=>active(p.a)).length!==1){
   if(record.changes.length)restore();
   if(!record){reason='native-scope-changed';return;}
   const unsafe=all.getAttribute('aria-disabled')==='true'||wrap.querySelector('input[type="checkbox"]:checked')||[...wrap.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"])')].some(el=>!!el.value.trim());
   if(!unsafe&&!attempted.has(all)){attempted.add(all);all.click();schedule();reason='waiting-for-native-all';}else reason='native-all-not-confirmed';
   return;
  }
  const text=labels();
  if(!record.labelNode?.isConnected){record.labelNode=labelNode(all);record.originalText=record.labelNode?.nodeValue;}
  if(!record.labelNode){reason='native-label-contract-not-recognized';return;}
  if(name(record.labelNode.nodeValue)==='all')record.originalText=record.labelNode.nodeValue;
  record.labelValue=text.heading;if(record.labelNode.nodeValue!==text.heading)record.labelNode.nodeValue=text.heading;
  put(record.strip,'data-yenra-personal-strip','');put(record.group,'data-yenra-personal-tabs','');put(record.group,'data-yenra-all-label',text.all);
  for(const part of record.parts)put(part.li,part.kind==='all'?'data-yenra-personal-all':'data-yenra-personal-hidden','');
  put(all,'data-yenra-personal-heading','');put(all,'title',text.hint);
  const badge=[...all.querySelectorAll('div,span')].find(el=>/^\s*[\d.,]+(?:[kKmM万])?\s*$/u.test(el.textContent));if(badge)put(badge,'data-yenra-personal-count','');
  if(!all.hasAttribute('role'))put(all,'role','heading');if(all.getAttribute('role')==='heading')put(all,'aria-level','2');
  reason='personal-contacts-active';
 }
 function schedule(){if(enabled&&!frame)frame=requestAnimationFrame(render);}
 const observer=new MutationObserver(changes=>{if(!record||!record.group.isConnected||changes.some(m=>record.strip.contains(m.target)))schedule();});
 const scopeObserver=new MutationObserver(schedule);
 const onKey=event=>{if(reason==='personal-contacts-active'&&event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.code==='KeyN'){event.preventDefault();event.stopImmediatePropagation();}};
 function enable(){if(!enabled){enabled=true;style=document.createElement('style');style.dataset.yenraPersonalContacts='1';style.textContent=css;document.head.append(style);observer.observe(document.body,{childList:true,subtree:true});const wrap=document.querySelector('.conversations-list-wrap');if(wrap)scopeObserver.observe(wrap,{subtree:true,attributes:true,attributeFilter:['class','aria-selected','data-state','data-active']});window.addEventListener('keydown',onKey,true);}schedule();return{enabled,reason};}
 function disable(){enabled=false;if(frame)cancelAnimationFrame(frame);frame=0;observer.disconnect();scopeObserver.disconnect();scopedWrap=null;window.removeEventListener('keydown',onKey,true);restore();style?.remove();style=null;reason='disabled';return{enabled,reason};}
 function status(){let state=reason;if(state==='personal-contacts-active'&&(!record||!recordValid(document.querySelector('.conversations-list-wrap'))||!active(record.all)||record.labelNode?.nodeValue!==record.labelValue||record.parts.some(p=>p.kind!=='all'&&getComputedStyle(p.li).display!=='none')))state='personal-style-incomplete';if(reason==='native-tab-contract-not-recognized'||reason==='native-all-not-confirmed'){const wrap=document.querySelector('.conversations-list-wrap');const rows=wrap?candidates(wrap).slice(0,3).map(p=>p.kind[0]+'='+p.a.tagName+'/'+p.a.parentElement.tagName+(active(p.a)?'*':'-')):[];state=('tabs:'+rows.join(',')+(rows.length?'':':none')).slice(0,80);}return{enabled,reason:state==='personal-contacts-active'?'personal-contacts-active:v4':state};}
 window[key]={version:4,enable,disable,status};window.addEventListener('pagehide',disable,{once:true});return enable();
})()`;
