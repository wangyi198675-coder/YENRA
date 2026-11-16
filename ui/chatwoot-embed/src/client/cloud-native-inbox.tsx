/**
 * V2 Cloud-first candidate. Only a native browser guest seat over the official
 * DSH DesktopBrowserGuests service; NO local Chatwoot mirror/credentials/agent.
 *
 * The viewer is live; viewing does not enable Cloud ingress or platform sending.
 * The Cloud account remains authoritative; navigation IDs are only untrusted
 * UI selection hints and MUST be rechecked by the original DSH Host via API.
 */
import {useEffect,useRef,useState} from 'react';
import cloudVisualCss from './cloud-native-theme.css?inline';
import cloudContactNavigationCss from './cloud-contact-navigation.css?inline';
import privateChatCss from './cloud-private-chat.css?inline';
import {cloudNativeTheme} from './cloud-native-theme';
import {CLOUD_FONT_PROBE_SCRIPT} from './cloud-native-fonts.ts';
import {CLOUD_PRIVATE_SIDEBAR_SCRIPT} from './cloud-private-sidebar-script';
import {CLOUD_CONTACT_NAVIGATION_SCRIPT} from './cloud-contact-navigation-script';
import {bindExistingCloudGuestExternalLinkOpener} from './cloud-guest-external-open';
import {CLOUD_SAVED_PREVIEW_SCRIPT} from './cloud-saved-preview-script';
import {CLOUD_DSH_TRANSLATOR_SCRIPT} from './cloud-dsh-translator-script';
import {cloudConversationToolsScript} from './cloud-conversation-tools-script';
import {CLOUD_KT_INLINE_SCRIPT} from './cloud-kt-inline-script';
import {CLOUD_EXPORT_MEDIA_SCRIPT} from './cloud-export-guest-script';
import {CLOUD_FB_SHARE_FALLBACK_SCRIPT} from './cloud-fb-share-fallback-script';
import {restoreSavedTranslationsForChatLume} from './cloud-export-translation-policy';
import {cloudWaReactionScript} from './cloud-wa-reaction-script';
import mergedHeaderCss from './cloud-merged-header.css?inline';

export type CloudConversationHint={accountId:196799;conversationId:number};
export type CloudNativeInboxProps={
  visible:boolean;
  shareConversationId?:number;
  verifiedShareLinks?:Array<{messageId:number;url:string;photoId?:string}>;
  showTools?:boolean;
  onToggleTools?:()=>void;
  onConversationLayout?:(active:boolean)=>void;
  mergedHeader?:boolean;
  captionWindowInset?:number;
  captionModeCenter?:number;
  notificationTarget?:{conversationId:number;sequence:number}|null;
  onConversationHint?:(hint:CloudConversationHint)=>void;
  onConversationExit?:()=>void;
  bindAdoptDraft?:(adopt:((conversationId:number,text:string)=>Promise<boolean>)|null)=>void;
  onAdoptSentCandidate?:(conversationId:number,messageId:number)=>Promise<boolean>;
};
type Guest=HTMLElement&{
  loadURL:(url:string)=>Promise<void>;
  getURL:()=>string;
  setZoomFactor?:(factor:number)=>void;
  insertCSS?:(css:string)=>Promise<string>;
  removeInsertedCSS?:(key:string)=>Promise<void>;
  executeJavaScript?:(script:string,userGesture?:boolean)=>Promise<unknown>;
};
type Reservation={lease:string;partition:string};
type NativeBrowser={
  acquire:(workspace:string)=>Promise<Reservation>;
  release:(lease:string)=>Promise<void>;
  onOpenRequested?:(lease:string,listener:(url:string)=>void)=>()=>void;
};
const CLOUD_ORIGIN='https://app.chatwoot.com';
const CLOUD_ACCOUNT_ID=196799 as const;
// Enter the actual Cloud conversations workspace, not Captain/analytics or
// the dashboard home. This keeps full native features accessible on demand.
const CLOUD_LANDING=CLOUD_ORIGIN+'/app/accounts/'+CLOUD_ACCOUNT_ID+'/conversations';
// Cloud Startups does not expose an account-level "hide sidebar entries" UI.
// Keep every upstream feature intact; only the YENRA desktop's Cloud guest
// presents the conversation-oriented subset. Official Cloud in the browser
// remains unmodified, and missing selectors fail open on upstream updates.
const LESS_USED_CLOUD_ROUTES=['captain/','calls','companies','reports/','campaigns/','portals/'] as const;
const COMPACT_CLOUD_MENU_CSS=LESS_USED_CLOUD_ROUTES
  .map(route=>'aside nav > ul > li:has(> a[href^="/app/accounts/196799/'+route+'"])')
  .join(',\n')+'{display:none!important}'+
  // Exact route matches keep all conversations, the four inboxes, native
  // search, contact/settings pages and in-conversation Copilot accessible.
  ['inbox-view','mentions/conversations','participating/conversations','unattended/conversations']
    .map(route=>'aside nav li:has(> a[href="/app/accounts/196799/'+route+'"])')
    .join(',\n')+'{display:none!important}';
const WORKSPACE_KEY='yenra:cloud-chatwoot:account:196799';
const CONVERSATION_PATH=/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/u;
// Scope zoom to the official authentication pages only. Never scale the
// authenticated Chatwoot dashboard, Composer, Copilot or conversation UI.
const AUTH_PATH=/^\/app\/(?:login|auth(?:\/|$)|password(?:\/|$))/u;
function loginZoom(viewportWidth:number):number{
  // 0.78 on a 1360×720 desktop lets the entire official auth page fit
  // vertically without forcing the authenticated inbox to shrink.
  return Math.max(0.72,Math.min(0.78,Math.round((viewportWidth/1375)*100)/100));
}

function browser():NativeBrowser|null{
  const exposed=(window as typeof window & {
    dshDesktop?:{browser?:NativeBrowser}
  }).dshDesktop?.browser;
  return exposed?.acquire&&exposed?.release?exposed:null;
}

export function CloudNativeInbox({visible,shareConversationId,verifiedShareLinks,showTools=false,onToggleTools,onConversationLayout,mergedHeader=false,captionWindowInset=0,captionModeCenter=0,notificationTarget,onConversationHint,onConversationExit,bindAdoptDraft,onAdoptSentCandidate}:CloudNativeInboxProps){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const visibleRef=useRef(visible);
  visibleRef.current=visible;
  const verifiedShareRef=useRef({conversationId:shareConversationId,links:verifiedShareLinks});
  verifiedShareRef.current={conversationId:shareConversationId,links:verifiedShareLinks};
  const repaintShareRef=useRef<(()=>void)|null>(null);
  const hintRef=useRef(onConversationHint);
  hintRef.current=onConversationHint;
  const exitRef=useRef(onConversationExit);
  exitRef.current=onConversationExit;
  const adoptSinkRef=useRef(bindAdoptDraft);
  adoptSinkRef.current=bindAdoptDraft;
  const adoptedSentRef=useRef(onAdoptSentCandidate);
  adoptedSentRef.current=onAdoptSentCandidate;
  const navigationRef=useRef<(()=>void)|null>(null);
  const toolsRef=useRef(showTools);
  toolsRef.current=showTools;
  const toggleToolsRef=useRef(onToggleTools);
  toggleToolsRef.current=onToggleTools;
  const conversationLayoutRef=useRef(onConversationLayout);
  conversationLayoutRef.current=onConversationLayout;
  const captionRef=useRef({mergedHeader,captionWindowInset,captionModeCenter});
  captionRef.current={mergedHeader,captionWindowInset,captionModeCenter};
  const captionVisualsRef=useRef<(()=>void)|null>(null);
  const visualsRef=useRef<(()=>void)|null>(null);
  const notificationRouteRef=useRef<((id:number)=>void)|null>(null);
  const pendingNotificationRef=useRef<number|null>(null);
  const [state,setState]=useState<'loading'|'ready'|'unavailable'|'failed'>('loading');
  const [exportConversationId,setExportConversationId]=useState<number|null>(null);
  const [exportBusy,setExportBusy]=useState(false);
  const [exportStatus,setExportStatus]=useState('');
  const [exportError,setExportError]=useState('');
  const [exportReady,setExportReady]=useState(false);
  const [exportFormat,setExportFormat]=useState<'html'|'zip'>('zip');
  const exportFileRef=useRef<{filename:string;blob:Blob}|null>(null);
  const cloudGuestRef=useRef<Guest|null>(null);
  const exportAbortRef=useRef<AbortController|null>(null);
  // Actual file download occurs directly in a trusted user click after
  // all asynchronous Cloud fetches have completed. No hidden auto-download.
  const saveCloudReport=()=>{
    const file=exportFileRef.current;
    if(!visible||!file||!exportReady)return;
    const blobUrl=URL.createObjectURL(file.blob);
    try{
      const link=document.createElement('a');
      link.href=blobUrl;link.download=file.filename;link.hidden=true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // A browser-initiated download is a terminal action for this dialog;
      // never leave a stale download/progress panel covering the inbox.
      closeCloudExport();
    }finally{window.setTimeout(()=>URL.revokeObjectURL(blobUrl),30000)}
  };
  // Reliable desktop Save As fallback if Chromium blocks repeated download
  // attempts. The native picker is invoked synchronously by the user's click;
  // only the selected transient HTML Blob is written, never Cloud credentials.
  const saveCloudReportAs=async()=>{
    const file=exportFileRef.current;
    if(!visible||!file||!exportReady)return;
    type SaveHandle={createWritable:()=>Promise<{
      write:(blob:Blob)=>Promise<void>;close:()=>Promise<void>;
    }>};
    const picker=(window as unknown as {
      showSaveFilePicker?:(options:unknown)=>Promise<SaveHandle>
    }).showSaveFilePicker;
    if(typeof picker!=='function'){
      setExportError('当前浏览器无法选择保存位置，请使用普通下载。');
      return;
    }
    try{
      const handle=await picker.call(window,{
        suggestedName:file.filename,
        types:[file.filename.endsWith('.zip')
          ?{description:'ChatLume HTML＋媒体 ZIP',accept:{'application/zip':['.zip']}}
          :{description:'ChatLume HTML 报表',accept:{'text/html':['.html']}}],
      });
      const stream=await handle.createWritable();
      await stream.write(file.blob);
      await stream.close();
      // Only a finished writable.close() counts as an actual Save As.
      // Return immediately to the same Cloud conversation after completion.
      closeCloudExport();
    }catch(error){
      if(error instanceof Error&&error.name==='AbortError')return;
      setExportError('另存为失败，请重试或改用普通下载。');
    }
  };
  const closeCloudExport=()=>{
    exportAbortRef.current?.abort();
    exportAbortRef.current=null;
    setExportBusy(false);
    setExportStatus('');
    setExportError('');
    exportFileRef.current=null;
    setExportReady(false);
    setExportFormat('zip');
    setExportConversationId(null);
  };
  const startCloudExport=async()=>{
    const selected=exportConversationId;
    if(!visible||!selected||exportBusy)return;
    const controller=new AbortController();
    exportAbortRef.current?.abort();
    exportAbortRef.current=controller;
    exportFileRef.current=null;
    setExportReady(false);
    setExportBusy(true);setExportError('');
    setExportStatus('正在从 Chatwoot Cloud 读取当前会话…');
    let lastCursor:number|undefined;
    let contactId:number|null=null,inboxId:number|null=null,contactName='',avatarUrl:string|null=null;
    const all:Array<Record<string,unknown>>=[];
    const assetBindings=new Map<string,{
      avatar?:true;messageId?:number;attachmentId?:number;
      attachmentIndex?:number;before?:number
    }>();
    try{
      for(let page=0;page<150;page++){
        if(controller.signal.aborted)throw Error('导出已取消');
        const response=await fetch('/api/yenra/cloud-export/page',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'content-type':'application/json',
            ...(window.location.origin==='dsh-app://app'
              ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
          signal:controller.signal,
          body:JSON.stringify({accountId:CLOUD_ACCOUNT_ID,conversationId:selected,
            ...(lastCursor?{before:lastCursor}:{})}),
        });
        if(!response.ok)throw Error('当前会话的 Cloud 导出权限核验失败');
        const data=await response.json();
        if(data?.ok!==true||data.accountId!==CLOUD_ACCOUNT_ID||
           data.conversationId!==selected||!Number.isSafeInteger(data.contactId)||
           !Number.isSafeInteger(data.inboxId)||
           !Array.isArray(data.rows)||data.rows.length>30)
          throw Error('Cloud 会话数据验证失败，已停止导出');
        if(contactId===null){contactId=data.contactId;inboxId=data.inboxId;
          contactName=String(data.name??'联系人').slice(0,100);
          avatarUrl=typeof data.avatarUrl==='string'?data.avatarUrl:null;}
        else if(contactId!==data.contactId||inboxId!==data.inboxId)
          throw Error('导出过程中联系人或账号已发生切换');
        // Remember the exact Cloud-verified page cursor and original message
        // ID for a future explicit read-only Host media request. Never send
        // an arbitrary user-supplied signed URL to a server.
        if(typeof data.avatarUrl==='string'&&data.avatarUrl)
          assetBindings.set(data.avatarUrl,{avatar:true,
            ...(lastCursor?{before:lastCursor}:{})});
        for(const message of data.rows){
          if(!Number.isSafeInteger(message.id)||message.id<=0||
             !Array.isArray(message.attachments))continue;
          for(let i=0;i<message.attachments.length;i++){
            const asset=message.attachments[i];
            if(!asset||typeof asset.url!=='string'||!asset.url)continue;
            assetBindings.set(asset.url,{messageId:message.id,
              ...(Number.isSafeInteger(asset.id)&&asset.id>0?
                {attachmentId:asset.id}:{attachmentIndex:i}),
              ...(lastCursor?{before:lastCursor}:{})});
          }
        }
        all.push(...data.rows);
        if(all.length>4000)throw Error('记录超过当前单次导出限制，请缩小范围');
        setExportStatus('已读取 '+all.length+' 条 Cloud 消息…');
        if(!data.hasMore)break;
        const next=data.nextCursor;
        if(!Number.isSafeInteger(next)||next<=0||(lastCursor&&next>=lastCursor)||
           page===149)throw Error('Cloud 历史分页不完整，禁止生成不完整报表');
        lastCursor=next;
      }
      if(controller.signal.aborted)throw Error('导出已取消');
      // Reuse the one authenticated Chatwoot Guest. Original Host verifies
      // Cloud conversation IDs and attachment URLs before they reach here.
      const cloudGuest=cloudGuestRef.current;
      const validGuest=()=>{
        if(controller.signal.aborted||cloudGuestRef.current!==cloudGuest||
           !cloudGuest?.executeJavaScript)return false;
        try{
          const url=new URL(cloudGuest.getURL());
          return url.origin===CLOUD_ORIGIN&&
            url.pathname.replace(/\/$/u,'')==='/app/accounts/196799/conversations/'+selected;
        }catch{return false}
      };
      let ktResults:unknown[]=[];
      if(validGuest()){
        try{
          const results=await cloudGuest!.executeJavaScript!(
            '(()=>{const cached=window.__yenraCloudKtV1?.snapshot?.('+
            JSON.stringify(selected)+')??[];if(cached.length)return cached;'+
            'return [...document.querySelectorAll("[data-yenra-kt-result]")].map(el=>{'+
            'const id=Number(el.closest("[data-message-id]")?.getAttribute("data-message-id"));'+
            'const t=el.textContent?.trim()??"";'+
            'const m=/^(.{1,40})\\s*·\\s*(重复\\s*(\\d+)\\s*次|未重复|KT\\s*未知)/u.exec(t);'+
            'if(!Number.isSafeInteger(id)||id<=0||!m)return null;'+
            'return {messageId:id,masked:m[1].trim(),'+
            'status:m[2].startsWith("重复")?"duplicate":m[2].startsWith("未重复")?"not_duplicate":"unknown",'+
            'repeatCount:m[3]?Number(m[3]):0};}).filter(Boolean)})()');
          if(Array.isArray(results))ktResults=results.slice(0,150);
        }catch{/* Export still works if KT was not previously checked. */}
      }
      const allowedMedia=new Set<string>();
      for(const row of all){
        const attachments=Array.isArray(row.attachments)?row.attachments:[];
        for(const asset of attachments){
          if(asset&&typeof asset.url==='string')allowedMedia.add(asset.url);
        }
      }
      if(avatarUrl)allowedMedia.add(avatarUrl);
      const readGuestMedia=async(assetUrl:string,limit:number):Promise<Blob>=>{
        if(!validGuest()||!allowedMedia.has(assetUrl)||
           !Number.isSafeInteger(limit)||limit<1||limit>32*1024*1024)
          throw Error('CLOUD_MEDIA_SCOPE_CHANGED');
        const trusted=new URL(assetUrl);
        if(trusted.protocol!=='https:'||
           !(trusted.hostname==='app.chatwoot.com'||trusted.hostname.endsWith('.chatwoot.com')||
             trusted.hostname.endsWith('.amazonaws.com')||trusted.hostname.endsWith('.cloudfront.net')))
          throw Error('CLOUD_MEDIA_URL_NOT_TRUSTED');
        const authority=assetBindings.get(assetUrl);
        if(authority){
          try{
            const response=await fetch('/api/yenra/cloud-export/asset',{
              method:'POST',credentials:'same-origin',cache:'no-store',
              headers:{'content-type':'application/json',
                ...(window.location.origin==='dsh-app://app'?
                  {'x-yenra-desktop-origin':'dsh-app://app'}:{})},
              signal:controller.signal,
              body:JSON.stringify({accountId:CLOUD_ACCOUNT_ID,
                conversationId:selected,...authority}),
            });
            if(response.ok&&Number(response.headers.get('content-length')||0)<=limit){
              const blob=await response.blob();
              if(validGuest()&&blob.size>0&&blob.size<=limit&&
                 /^(?:image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime)|audio\/[\w.+-]+|application\/(?:pdf|octet-stream|zip))$/iu.test(blob.type))
                return blob;
            }
          }catch(error){if(controller.signal.aborted)throw error;}
        }
        // Fallback uses the single existing Cloud Guest, never another login.
        await cloudGuest!.executeJavaScript!(CLOUD_EXPORT_MEDIA_SCRIPT);
        if(!validGuest())throw Error('CLOUD_MEDIA_CONTEXT_CHANGED');
        const raw=await cloudGuest!.executeJavaScript!(
          'window.__yenraCloudExportMediaV1.readAsset('+
          JSON.stringify(selected)+','+JSON.stringify(assetUrl)+','+JSON.stringify(limit)+')');
        if(!validGuest()||typeof raw!=='string'||raw.length>limit*1.5+256||
           !/^data:(?:image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm)|audio\/[\w.+-]+|application\/(?:pdf|octet-stream));base64,/iu.test(raw))
          throw Error('CLOUD_MEDIA_PAYLOAD_INVALID');
        const blob=await (await fetch(raw)).blob();
        if(!blob.size||blob.size>limit)throw Error('CLOUD_MEDIA_SIZE_LIMIT');
        return blob;
      };
      // Export uses saved Cloud and original DSH Storage Domain translations.
      // Read-only cache misses MUST NOT invoke any model or block the archive.
      // No second cache, translator, model gateway or standalone Sender.
      // ChatLume is an archive of existing Cloud messages, not an instruction
      // to spend tokens or fail when a model/provider is unavailable.
      const fetchExportTranslations=async(ids:number[])=>{
        const response=await fetch('/api/yenra/cloud-model-translate',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'content-type':'application/json',
            ...(window.location.origin==='dsh-app://app'?
              {'x-yenra-desktop-origin':'dsh-app://app'}:{})},
          body:JSON.stringify({accountId:CLOUD_ACCOUNT_ID,
            conversationId:selected,mode:'cached',messageIds:ids}),
          // Cache-only lookup is optional to an archive; avoid a long wait
          // if the DSH Host or Cloud history reader is temporarily offline.
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),
        });
        const data=await response.json();
        if(response.status!==200||data?.ok!==true)
          throw Error('DSH 翻译服务未完成：'+String(data?.code??response.status));
        return data;
      };
      const {missingCount,cacheUnavailable}=await restoreSavedTranslationsForChatLume({
        rows:all,conversationId:selected,readCache:fetchExportTranslations,
        signal:controller.signal,
        onProgress:(done,total)=>setExportStatus('正在读取已有 DSH 中文译文 '+
          done+'/'+total+'…'),
      });
      // Never call mode=export here. The original ChatLume exporter already
      // records missing translations while preserving every original message.
      // Translation generation is a separate explicitly authorized operation.
      setExportStatus('正在调用原版 ChatLume 生成'+(exportFormat==='zip'?'离线媒体 ZIP':'HTML 报表')+'…');
      const reportModule='/api/yenra/cloud-export/runtime.js?v=20261113-media-kt-v3';
      const {exportCloudConversationReport}=await import(/* @vite-ignore */ reportModule) as {
        exportCloudConversationReport:(args:Record<string,unknown>)=>Promise<{
          filename:string;blob:Blob;messageCount:number;attachmentLinks:number;
          missingAttachments:number;attachmentCount:number
        }>
      };
      const result=await exportCloudConversationReport({
        accountId:CLOUD_ACCOUNT_ID,conversationId:selected,contactName,messages:all,
        avatarUrl,format:exportFormat,signal:controller.signal,
        ktResults,assetReader:readGuestMedia,
        onProgress:(p:{stage:string;received:number;total:number})=>{
          if(p.stage==='media')setExportStatus('正在收集媒体 '+p.received+'/'+p.total+'…');
        },
      });
      if(controller.signal.aborted)return;
      if(!(result.blob instanceof Blob)||!result.blob.size||
         typeof result.filename!=='string')throw Error('HTML 报表文件生成失败');
      exportFileRef.current={filename:result.filename,blob:result.blob};
      setExportReady(true);
      setExportStatus('ChatLume 已生成 '+result.messageCount+' 条消息'+
        (exportFormat==='zip'?'，已打包 '+result.attachmentCount+' 个媒体附件':'')+
        (result.missingAttachments?'，有 '+result.missingAttachments+' 个媒体未能下载':'')+
        (missingCount?'，'+missingCount+' 条暂无已保存中文译文（原文已保留）':'')+
        (cacheUnavailable?'；DSH 译文缓存暂不可读取':'')+
        '，可下载或选择保存位置。');
    }catch(error){
      if(!controller.signal.aborted)
        setExportError(error instanceof Error?error.message:'Cloud 报表导出失败');
    }finally{
      if(exportAbortRef.current===controller){
        exportAbortRef.current=null;setExportBusy(false);
      }
    }
  };
  // A permanent component seat across Chat/Work; never remount on contact change.
  useEffect(()=>{
    const bridge=browser(),target=hostRef.current;
    if(!bridge||!target){setState('unavailable');return}
    let disposed=false;
    let activeLease:string|null=null;
    let guest:Guest|null=null;
    let removeExternalLinkListener=()=>{};
    // DSH adopts through the already installed Cloud translator's
    // native ProseMirror helper; no platform send or second draft database.
    const adoptDraft=async(conversationId:number,text:string):Promise<boolean>=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript||
         !Number.isSafeInteger(conversationId)||conversationId<=0||
         typeof text!=='string'||!text.trim()||text.length>2000)return false;
      const el=guest;
      try{
        const url=new URL(el.getURL());
        if(url.origin!==CLOUD_ORIGIN||
           url.pathname!==('/app/accounts/196799/conversations/'+conversationId))return false;
        await el.executeJavaScript(CLOUD_DSH_TRANSLATOR_SCRIPT);
        if(disposed||guest!==el)return false;
        const command='window.__yenraDshCloudTranslatorV1?.adoptDraft?.('+
          JSON.stringify(conversationId)+','+JSON.stringify(text)+')';
        const ok=await el.executeJavaScript(command,true);
        return !disposed&&guest===el&&ok===true;
      }catch{return false}
    };
    adoptSinkRef.current?.(adoptDraft);
    notificationRouteRef.current=(id:number)=>{
      if(!Number.isSafeInteger(id)||id<=0)return;
      pendingNotificationRef.current=id;
      if(!guest)return;
      let url:URL;
      try{url=new URL(guest.getURL())}catch{return}
      if(url.origin!=='https://app.chatwoot.com'||
         !url.pathname.startsWith('/app/accounts/196799/'))return;
      const path='/app/accounts/196799/conversations/'+id;
      pendingNotificationRef.current=null;
      if(url.pathname!==path)void guest.loadURL('https://app.chatwoot.com'+path).catch(()=>{});
    };
    let lastConversationId:number|null=null;
    let lastZoom:number|null=null;
    let authenticationPage=false;
    let lastCss='';
    let cssKey:string|null=null;
    let cssEpoch=0;
    const applyVisuals=async()=>{
      if(disposed||!guest?.insertCSS)return;
      const el=guest;
      let current:URL;
      try{current=new URL(el.getURL())}catch{return}
      if(current.origin!==CLOUD_ORIGIN||!current.pathname.startsWith('/app/accounts/196799/')){
        ++cssEpoch;
        lastCss='';
        const previous=cssKey;cssKey=null;
        if(previous)await el.removeInsertedCSS?.(previous).catch(()=>{});
        return;
      }
      const caption=captionRef.current;
      const merged=caption.mergedHeader
        ?'html{--yenra-window-controls-inset:'+Math.max(0,caption.captionWindowInset)+'px;--yenra-caption-window-inset:'+Math.max(0,caption.captionWindowInset)+'px;--yenra-caption-mode-center:'+Math.max(0,caption.captionModeCenter)+'px}'+mergedHeaderCss:'';
      const css=COMPACT_CLOUD_MENU_CSS+cloudVisualCss+cloudContactNavigationCss+cloudNativeTheme(target)+(toolsRef.current?'':privateChatCss)+merged;
      if(lastCss===css)return;
      const epoch=++cssEpoch;
      lastCss=css;
      try{
        const key=await el.insertCSS(css);
        if(disposed||guest!==el||cssEpoch!==epoch){await el.removeInsertedCSS?.(key).catch(()=>{});return}
        const previous=cssKey;cssKey=key;
        if(previous)await el.removeInsertedCSS?.(previous).catch(()=>{});
        // Read computed typography only in the existing trusted Cloud guest.
        // Do not inspect or mutate chat text, drafts, accounts or Sender.
        if(el.executeJavaScript){
          void el.executeJavaScript(CLOUD_FONT_PROBE_SCRIPT).then(detail=>{
            if(!disposed&&guest===el&&cssEpoch===epoch&&detail)
              window.dispatchEvent(new CustomEvent('yenra:cloud-typography',{detail}));
          }).catch(()=>{});
        }
      }catch{if(cssEpoch===epoch)lastCss=''}
    };
    const installContactNavigation=()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      let url:URL;
      try{url=new URL(guest.getURL())}catch{return}
      if(url.origin!==CLOUD_ORIGIN||!url.pathname.startsWith('/app/accounts/196799/conversations'))return;
      void guest.executeJavaScript(CLOUD_CONTACT_NAVIGATION_SCRIPT).catch(()=>{});
    };
    const annotatePrivateSidebar=()=>{
      if(disposed||toolsRef.current||!guest?.executeJavaScript)return;
      let url:URL;
      try{url=new URL(guest.getURL())}catch{return}
      if(url.origin!==CLOUD_ORIGIN||!url.pathname.startsWith('/app/accounts/196799/'))return;
      void guest.executeJavaScript(CLOUD_PRIVATE_SIDEBAR_SCRIPT).catch(()=>{});
    };
    let previewTimer:ReturnType<typeof setTimeout>|null=null;
    let previewLastFetch=0,previewBusy=false,previewFollowup=false;
    let previewCacheBusy=false,previewCacheFollowup=false;
    const previewCacheReadAt=new Map<string,number>();
    // A preview cache MISS must not survive a later successful translation of
    // this exact Cloud MID. Otherwise the 45s miss throttle can keep the
    // contact list untranslated after the bubble already shows Chinese.
    // Invalidate only successful verified MIDs, never all contacts or the
    // positive persisted DSH entries (which remain the single authority).
    const invalidatePreviewMisses=(conversationId:number,items:unknown)=>{
      if(!Number.isSafeInteger(conversationId)||conversationId<=0||!Array.isArray(items))return;
      const prefixes=items.filter((item):item is {id:number;translation:string}=>
        !!item&&Number.isSafeInteger(item.id)&&item.id>0&&
        typeof item.translation==='string'&&/[\u3400-\u9fff]/u.test(item.translation))
        .map(item=>conversationId+':'+item.id+':');
      if(!prefixes.length)return;
      for(const key of previewCacheReadAt.keys()){
        if(prefixes.some(prefix=>key.startsWith(prefix)))previewCacheReadAt.delete(key);
      }
    };
    // Cloud preview rows hold authoritative saved zh_CN first. For the few
    // currently visible rows without it, use ONLY the existing DSH cached
    // translation endpoint. Never generate/pay for an unopened contact.
    const restoreCachedVisiblePreviews=async(targetView:Guest)=>{
      if(disposed||!visibleRef.current||guest!==targetView)return;
      if(previewCacheBusy){previewCacheFollowup=true;return;}
      previewCacheBusy=true;
      try{
        const candidates=await targetView.executeJavaScript(
          'window.__yenraCloudSavedPreviewV1?.visibleMissing?.(24)'
        ) as Array<{conversationId:number;contactId:number;messageId:number;
          name:string;original:string}>|undefined;
        if(!Array.isArray(candidates))return;
        const now=Date.now();
        const eligible=candidates.filter(x=>Number.isSafeInteger(x.conversationId)&&
          x.conversationId>0&&Number.isSafeInteger(x.messageId)&&x.messageId>0&&
          Number.isSafeInteger(x.contactId)&&x.contactId>0&&
          typeof x.original==='string'&&x.original.length<=1200&&
          typeof x.name==='string'&&
          now-(previewCacheReadAt.get(x.conversationId+':'+x.messageId+':'+x.original)??0)>45000
        ).slice(0,18);
        for(let start=0;start<eligible.length;start+=3){
          if(disposed||!visibleRef.current||guest!==targetView)break;
          await Promise.all(eligible.slice(start,start+3).map(async x=>{
            const key=x.conversationId+':'+x.messageId+':'+x.original;
            previewCacheReadAt.set(key,Date.now());
            try{
              const result=await sendDshTranslation({mode:'cached',
                conversationId:x.conversationId,messageIds:[x.messageId]},
                AbortSignal.timeout(19000));
              const item=Array.isArray(result.items)?result.items.find(
                (value:{id?:number;translation?:string})=>value.id===x.messageId):null;
              if(result.mode!=='cached'||result.conversationId!==x.conversationId||
                typeof item?.translation!=='string'||
                !/[\u3400-\u9fff]/u.test(item.translation))return;
              if(disposed||guest!==targetView||!visibleRef.current)return;
              await targetView.executeJavaScript(
                'window.__yenraCloudSavedPreviewV1?.mergeCached?.('+
                JSON.stringify([{...x,translation:item.translation}])+')'
              ).catch(()=>{});
            }catch{/* Cache misses or a missing Host must not stall Cloud. */}
          }));
        }
        while(previewCacheReadAt.size>200)
          previewCacheReadAt.delete(previewCacheReadAt.keys().next().value!);
      }catch{/* Keep native Cloud previews if guest is unavailable. */}
      finally{
        previewCacheBusy=false;
        if(previewCacheFollowup&&!disposed){
          previewCacheFollowup=false;
          void restoreCachedVisiblePreviews(targetView);
        }
      }
    };
    const previewRetryTimers=new Set<ReturnType<typeof setTimeout>>();
    const queuePreviewTranslationRetries=()=>{
      for(const timer of previewRetryTimers)clearTimeout(timer);
      previewRetryTimers.clear();
      for(const ms of [9000,22000]){
        const timer=setTimeout(()=>{
          previewRetryTimers.delete(timer);
          if(!disposed&&visibleRef.current)scheduleSavedPreviews();
        },ms);
        previewRetryTimers.add(timer);
      }
    };
    const refreshSavedPreviews=async()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      if(previewBusy){previewFollowup=true;return}
      const targetView=guest;
      let pathname="";
      try{const u=new URL(targetView.getURL());
        if(u.origin!==CLOUD_ORIGIN)return;
        pathname=u.pathname;
      }catch{return}
      if(!pathname.startsWith("/app/accounts/196799/"))return;
      previewBusy=true;previewLastFetch=Date.now();
      const received:Array<{conversationId:number;contactId:number;messageId:number;
        name:string;original:string;translation:string}>=[];
      try{
        // Cloud itself paginates 25 conversations. Never scan empty pages.
        // Stop on failure and retain the native preview for unmatched rows.
        for(let page=1;page<=8;page++){
          if(disposed||!visibleRef.current||guest!==targetView)break;
          const response=await fetch("/api/yenra/cloud-preview/list",{
            method:"POST",credentials:"same-origin",cache:"no-store",
            headers:{"content-type":"application/json",
              ...(window.location.origin==="dsh-app://app"
                ?{"x-yenra-desktop-origin":"dsh-app://app"}:{})},
            body:JSON.stringify({accountId:196799,page}),
          });
          if(!response.ok||disposed||guest!==targetView)break;
          const data=await response.json();
          if(data?.ok!==true||data.accountId!==196799||data.page!==page||
             !Number.isSafeInteger(data.sourceCount)||data.sourceCount<0||
             data.sourceCount>30||!Array.isArray(data.rows)||
             !Array.isArray(data.candidates)||
             data.rows.length+data.candidates.length>data.sourceCount)break;
          // Untranslated last-message descriptors are still verified Cloud
          // account/contact/MIDs. They are never translations themselves.
          received.push(...data.rows,...data.candidates.map(
            (x:{conversationId:number;contactId:number;messageId:number;
              name:string;original:string})=>({...x,translation:''})));
          if(received.length>240)break;
          await targetView.executeJavaScript(
            "window.__yenraCloudSavedPreviewV1?.set("+JSON.stringify(received)+")"
          ).catch(()=>{});
          if(data.sourceCount<25)break;
        }
      }catch{/* Cloud unavailable: keep Chatwoot native original */}
      finally{
        previewBusy=false;
        if(!disposed&&visibleRef.current&&guest===targetView)
          void restoreCachedVisiblePreviews(targetView);
        if(previewFollowup){previewFollowup=false;scheduleSavedPreviews()}
      }
    };
    const scheduleSavedPreviews=()=>{
      if(disposed||!visibleRef.current||previewTimer)return;
      const delay=Math.max(120,1600-(Date.now()-previewLastFetch));
      previewTimer=setTimeout(()=>{previewTimer=null;void refreshSavedPreviews()},delay);
    };
    const installSavedPreview=()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      let url:URL;
      try{url=new URL(guest.getURL())}catch{return}
      if(url.origin!==CLOUD_ORIGIN||
        !url.pathname.startsWith('/app/accounts/196799/'))return;
      void guest.executeJavaScript(CLOUD_SAVED_PREVIEW_SCRIPT)
        .then(()=>scheduleSavedPreviews()).catch(()=>{});
    };
    // KT results are keyed to Cloud's original message; never to visible text
    // or a contact display name. All source content is verified by Host.
    const ktSelections=new Map<string,{numbers:Array<{number:string}>;country?:string}>();
    const ktPending=new Set<string>();
    const isCurrentKt=(el:Guest,c:number,m:number)=>{
      try{
        const url=new URL(el.getURL());
        return url.origin===CLOUD_ORIGIN&&
          url.pathname==='/app/accounts/196799/conversations/'+c&&
          Number.isSafeInteger(m)&&m>0;
      }catch{return false}
    };
    const paintKt=async(el:Guest,c:number,m:number,value:unknown)=>{
      if(disposed||guest!==el||!isCurrentKt(el,c,m))return;
      await el.executeJavaScript?.('window.__yenraCloudKtV1?.paint('+
        JSON.stringify(c)+','+JSON.stringify(m)+','+
        JSON.stringify(value)+')').catch(()=>{});
    };
    const queryKt=async(c:number,m:number,mode:'inspect'|'check',
      number?:string,country?:string,
      countrySource:'manual'|'saved'|'none'='none')=>{
      const el=guest;
      if(disposed||!visibleRef.current||!el?.executeJavaScript||
         !isCurrentKt(el,c,m))return;
      const key=c+':'+m;
      if(ktPending.has(key))return;
      ktPending.add(key);
      try{
        const response=await fetch('/api/yenra/cloud-kt/check',{
          method:'POST',cache:'no-store',credentials:'same-origin',
          headers:{'content-type':'application/json',
            ...(window.location.origin==='dsh-app://app'
              ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
          body:JSON.stringify({accountId:196799,conversationId:c,
            messageId:m,mode,...(number?{number}:{}),...(country?{country}:{})}),
        });
        const value=await response.json();
        if(disposed||guest!==el||!isCurrentKt(el,c,m))return;
        // A user-confirmed country is remembered for THIS verified Cloud
        // contact. A new message still goes through Host original-message
        // verification; only the country hint is reused.
        if(value?.ok===false&&mode==='inspect'&&!country&&
           value.code==='KT_PHONE_COUNTRY_OR_FORMAT_UNVERIFIED'&&
           value.conversationId===c&&value.messageId===m&&
           Number.isSafeInteger(value.contactId)&&value.contactId>0){
          const saved=await el.executeJavaScript(
            'window.__yenraCloudKtV1?.countryFor('+
            JSON.stringify(c)+','+JSON.stringify(value.contactId)+')'
          ).catch(()=>null);
          if(typeof saved==='string'&&/^[A-Z]{2}$/.test(saved)&&
             !disposed&&guest===el&&isCurrentKt(el,c,m)){
            ktPending.delete(key);
            await queryKt(c,m,'inspect',undefined,saved,'saved');
            return;
          }
        }
        // Only a real user's country-confirm button may persist an ISO.
        // A restore from legacy/unverified storage or a test must not
        // silently establish country evidence for a genuine contact.
        if(countrySource==='manual'&&value?.ok===true&&
           value.mode==='inspect'&&value.conversationId===c&&
           value.messageId===m&&Number.isSafeInteger(value.contactId)&&
           value.contactId>0&&typeof value.confirmedCountry==='string'&&
           /^[A-Z]{2}$/.test(value.confirmedCountry)){
          await el.executeJavaScript(
            'window.__yenraCloudKtV1?.rememberCountry('+
            JSON.stringify(c)+','+JSON.stringify(value.contactId)+','+
            JSON.stringify(value.confirmedCountry)+')'
          ).catch(()=>false);
        }
        if(disposed||guest!==el||!isCurrentKt(el,c,m))return;
        if(value?.ok===true&&value.mode==='inspect'&&
           Array.isArray(value.numbers)&&value.numbers.length>0&&
           value.conversationId===c&&value.messageId===m){
          ktSelections.set(key,{numbers:value.numbers,country});
          if(value.numbers.length===1){
            ktPending.delete(key);
            await queryKt(c,m,'check',value.numbers[0].number,country);
            return;
          }
        }
        await paintKt(el,c,m,value);
      }catch{
        await paintKt(el,c,m,{ok:false,code:'KT_LOOKUP_UNAVAILABLE'});
      }finally{ktPending.delete(key)}
    };
    const installKt=()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      const el=guest;
      try{
        const url=new URL(el.getURL());
        if(url.origin!==CLOUD_ORIGIN||!CONVERSATION_PATH.test(url.pathname))return;
        void el.executeJavaScript(CLOUD_KT_INLINE_SCRIPT).catch(()=>{});
      }catch{}
    };
    // One WA-only control, installed into the EXISTING Cloud message rows.
    // Eligibility is a read-only authoritative Cloud/DSH bridge resolution;
    // the Guest never chooses an account, JID, source MID or platform sender.
    let waAllowedConversationId=0,waCheckedConversationId=0,waCheckEpoch=0;
    const waActionPending=new Set<string>();
    const applyWaReaction=()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      const el=guest;
      try{
        const url=new URL(el.getURL());
        if(url.origin!==CLOUD_ORIGIN||!url.pathname.startsWith('/app/accounts/196799/'))return;
        void el.executeJavaScript(cloudWaReactionScript(waAllowedConversationId)).catch(()=>{});
      }catch{/* Guest navigation invalidated the current document. */}
    };
    const checkWaEligibility=async(id:number)=>{
      if(disposed||!visibleRef.current||!guest)return;
      if(waCheckedConversationId===id){applyWaReaction();return;}
      waCheckedConversationId=id;
      waAllowedConversationId=0;
      const epoch=++waCheckEpoch;
      applyWaReaction();
      if(!id)return;
      const el=guest;
      try{
        const response=await fetch('/api/yenra/cloud-wa/reaction-eligible?conversationId='+id,{
          method:'GET',cache:'no-store',credentials:'same-origin',
          headers:window.location.origin==='dsh-app://app'
            ?{'x-yenra-desktop-origin':'dsh-app://app'}:{}
        });
        const data=await response.json();
        if(disposed||guest!==el||epoch!==waCheckEpoch||!visibleRef.current)return;
        const current=new URL(el.getURL());
        if(current.origin!==CLOUD_ORIGIN||
          current.pathname!==('/app/accounts/196799/conversations/'+id))return;
        if(response.ok&&data?.ok===true&&data.eligible===true)
          waAllowedConversationId=id;
        applyWaReaction();
      }catch{/* Original Cloud menu still works when this optional control is unavailable. */}
    };
    const paintWaReaction=async(el:Guest,c:number,m:number,success:boolean)=>{
      if(disposed||guest!==el)return;
      await el.executeJavaScript(
        'window.__yenraCloudWaReactionV1?.paint('+
        JSON.stringify(c)+','+JSON.stringify(m)+','+JSON.stringify(success)+')'
      ).catch(()=>{});
    };
    const submitWaReaction=async(el:Guest,c:number,m:number,index:number)=>{
      const emoji=['👍','❤️','😂','😮','😢','🙏'][index];
      if(!emoji||!Number.isSafeInteger(c)||!Number.isSafeInteger(m)||
         c<=0||m<=0||waAllowedConversationId!==c||guest!==el||disposed)return;
      const key=c+':'+m;
      if(waActionPending.has(key))return;
      waActionPending.add(key);
      try{
        const url=new URL(el.getURL());
        if(url.origin!==CLOUD_ORIGIN||
           url.pathname!==('/app/accounts/196799/conversations/'+c))return;
        const response=await fetch('/api/yenra/cloud-wa/react',{
          method:'POST',cache:'no-store',credentials:'same-origin',
          headers:{'content-type':'application/json',
            ...(window.location.origin==='dsh-app://app'
              ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
          body:JSON.stringify({accountId:196799,conversationId:c,messageId:m,emoji})
        });
        const data=await response.json();
        await paintWaReaction(el,c,m,response.ok&&data?.ok===true&&
          data.submitted===true&&data.deliveryStatus==='UNKNOWN');
      }catch{await paintWaReaction(el,c,m,false)}
      finally{waActionPending.delete(key)}
    };
    const installConversationTools=()=>{
      if(disposed||!toggleToolsRef.current||!guest?.executeJavaScript)return;
      let url:URL;
      try{url=new URL(guest.getURL())}catch{return}
      if(url.origin!==CLOUD_ORIGIN||!url.pathname.startsWith('/app/accounts/196799/'))return;
      void guest.executeJavaScript(cloudConversationToolsScript(toolsRef.current)).catch(()=>{});
    };

    // Cloud DSH model translator uses the one original Host LLM, not Captain.
    let dshModelBusy=false,dshRefreshAt=0,dshDraftBusy=false,dshFailureUntil=0;
    let dshIncomingAbort:AbortController|null=null,dshIncomingEpoch=0;
    // Manual native right-click Translate reuses the same trusted Host model
    // and persisted cache, not Chatwoot's absent Google Translate hook.
    const manualTranslationInFlight=new Set<string>();
    let cachedRestoreBusy=false,cachedRestoreKey='',cachedRestoreAt=0;
    let cachedRestoreConversation=0,cachedRestoreEpoch=0;
    const sendDshTranslation=async(payload:Record<string,unknown>,signal?:AbortSignal)=>{
      const response=await fetch('/api/yenra/cloud-model-translate',{
        method:'POST',cache:'no-store',credentials:'same-origin',
        ...(signal?{signal}:{}),
        headers:{'content-type':'application/json',
          ...(window.location.origin==='dsh-app://app'
            ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
        body:JSON.stringify({accountId:196799,...payload}),
      });
      const data=await response.json();
      if(response.status!==200||data?.ok!==true)
        throw Error(String(data?.code??'MODEL_TRANSLATION_UNAVAILABLE').slice(0,80));
      return data;
    };
    // Chatwoot native Copilot reply paragraphs are not Cloud message MIDs.
    // Translate those display-only through the SAME DSH LLM endpoint. Never
    // change the native Italian draft or the official "Use this" action.
    let copilotBusy=false,copilotLastKey='',copilotLastItems:unknown[]=[],copilotFailUntil=0;
    const dshCopilotChinese=async()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript||
         copilotBusy||Date.now()<copilotFailUntil)return;
      const el=guest;
      let route:URL;try{route=new URL(el.getURL())}catch{return}
      if(route.origin!==CLOUD_ORIGIN||!CONVERSATION_PATH.test(route.pathname))return;
      copilotBusy=true;
      try{
        await el.executeJavaScript(CLOUD_DSH_TRANSLATOR_SCRIPT);
        const snapshot=await el.executeJavaScript(
          'window.__yenraDshCloudTranslatorV1?.copilotSuggestions?.()'
        ) as {conversationId:number;texts:string[]}|null;
        const selected=Number(CONVERSATION_PATH.exec(route.pathname)?.[1]);
        if(!snapshot||snapshot.conversationId!==selected||
           !Array.isArray(snapshot.texts)||!snapshot.texts.length)return;
        const key=selected+':'+JSON.stringify(snapshot.texts);
        if(key!==copilotLastKey){
          const result=await sendDshTranslation({
            mode:'copilot',conversationId:selected,copilotTexts:snapshot.texts,
          });
          if(result.mode!=='copilot'||result.conversationId!==selected||
             !Array.isArray(result.items))throw Error('COPILOT_TRANSLATION_INVALID');
          copilotLastKey=key;copilotLastItems=result.items;
        }
        if(disposed||el!==guest||!visibleRef.current||
           el.getURL()!==route.href)return;
        await el.executeJavaScript(
          'window.__yenraDshCloudTranslatorV1?.paintCopilot?.('+
          JSON.stringify(selected)+','+
          JSON.stringify(snapshot.texts)+','+
          JSON.stringify(copilotLastItems)+')'
        );
      }catch{
        copilotFailUntil=Date.now()+15000;
        // Cloud Copilot original text and its native adopt control are intact.
      }finally{copilotBusy=false;}
    };
    // On A→B→A, Cloud removes/recycles rows while the original DSH translation
    // remains safely persisted. Read cached translations ONLY; never request
    // paid model generation during a view restoration.
    const restoreCachedTranslations=async()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript||cachedRestoreBusy)return;
      const el=guest;
      let selected:number;
      try{
        const url=new URL(el.getURL());
        const match=url.origin===CLOUD_ORIGIN?CONVERSATION_PATH.exec(url.pathname):null;
        if(!match)return;
        selected=Number(match[1]);
      }catch{return}
      cachedRestoreBusy=true;
      const requestEpoch=cachedRestoreEpoch;
      try{
        await el.executeJavaScript(CLOUD_DSH_TRANSLATOR_SCRIPT);
        const status=await el.executeJavaScript(
          'window.__yenraDshCloudTranslatorV1?.visible?.(30)') as
          {conversationId?:number;ids?:number[]}|undefined;
        if(status?.conversationId!==selected||!Array.isArray(status.ids))return;
        const ids=[...new Set(status.ids.filter(x=>Number.isSafeInteger(x)&&x>0))].slice(-30);
        if(!ids.length)return;
        const signature=selected+':'+ids.join(',');
        if(signature===cachedRestoreKey&&Date.now()-cachedRestoreAt<8000)return;
        cachedRestoreKey=signature;cachedRestoreAt=Date.now();
        const result=await sendDshTranslation({
          mode:'cached',conversationId:selected,messageIds:ids,
        });
        if(disposed||el!==guest||!visibleRef.current||
           requestEpoch!==cachedRestoreEpoch){cachedRestoreKey='';return;}
        const current=new URL(el.getURL());
        if(current.origin!==CLOUD_ORIGIN||
           current.pathname!=='/app/accounts/196799/conversations/'+selected)return;
        if(Array.isArray(result.items)&&result.items.length)
          await el.executeJavaScript(
            'window.__yenraDshCloudTranslatorV1?.paint('+
            JSON.stringify(selected)+','+JSON.stringify(result.items)+')');
      }catch{
        // A failed/stale lookup must never block future A→B→A restoration.
        if(requestEpoch===cachedRestoreEpoch)cachedRestoreKey='';
      }finally{
        cachedRestoreBusy=false;
        if(!disposed&&visibleRef.current&&requestEpoch!==cachedRestoreEpoch)
          setTimeout(()=>{void restoreCachedTranslations()},0);
      }
    };
    const dshIncoming=async()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript||dshModelBusy||Date.now()<dshFailureUntil)return;
      const el=guest;
      let current:URL;
      try{current=new URL(el.getURL())}catch{return}
      if(current.origin!==CLOUD_ORIGIN||
         !CONVERSATION_PATH.test(current.pathname))return;
      const selected=Number(CONVERSATION_PATH.exec(current.pathname)?.[1]);
      if(!Number.isSafeInteger(selected)||selected<=0)return;
      const epoch=dshIncomingEpoch,abort=new AbortController();
      dshIncomingAbort=abort;
      dshModelBusy=true;dshRefreshAt=Date.now();
      try{
        await el.executeJavaScript(CLOUD_DSH_TRANSLATOR_SCRIPT);
        // Fill up to 30 visible misses in bounded native batches, not one
        // batch every 12 seconds. Never translate a stale contact after A→B.
        for(let batch=0;batch<4;batch++){
          if(disposed||abort.signal.aborted||dshIncomingEpoch!==epoch||
             !visibleRef.current||guest!==el)return;
          let active:URL;try{active=new URL(el.getURL())}catch{return}
          if(active.origin!==CLOUD_ORIGIN||active.pathname!==current.pathname)return;
          const status=await el.executeJavaScript(
            'window.__yenraDshCloudTranslatorV1?.visible?.()') as
            {conversationId?:number;ids?:number[]}|undefined;
          if(status?.conversationId!==selected||!Array.isArray(status.ids))return;
          const ids=[...new Set(status.ids.filter(x=>Number.isSafeInteger(x)&&x>0))].slice(-8);
          if(!ids.length)return;
          const result=await sendDshTranslation({
            mode:'incoming',conversationId:selected,messageIds:ids,
          },AbortSignal.any([abort.signal,AbortSignal.timeout(90000)]));
          if(disposed||abort.signal.aborted||dshIncomingEpoch!==epoch||guest!==el)return;
          const painted=await el.executeJavaScript(
            'window.__yenraDshCloudTranslatorV1?.paint('+
              JSON.stringify(selected)+','+
              JSON.stringify(result.items??[])+')').catch(()=>0);
          if(typeof painted!=='number'||painted<=0)return;
          dshRefreshAt=Date.now();
          invalidatePreviewMisses(selected,result.items);
          // The same verified MID may also be the contact-list latest message.
          // Refresh the preview without generating another translation.
          scheduleSavedPreviews();
        }
      }catch{
        if(!abort.signal.aborted&&epoch===dshIncomingEpoch)
          dshFailureUntil=Date.now()+15000; // Do not block a different contact.
      }finally{
        if(epoch===dshIncomingEpoch){dshModelBusy=false;dshIncomingAbort=null;}
      }
    };
    const dshTranslateDraft=async()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript||
         dshDraftBusy)return;
      const el=guest;dshDraftBusy=true;
      try{
        const requested=await el.executeJavaScript(
          'window.__yenraDshCloudTranslatorV1?.draft?.()') as
          {conversationId:number;draft:string}|null;
        if(!requested||!Number.isSafeInteger(requested.conversationId)||
           typeof requested.draft!=='string'||!requested.draft.trim())return;
        const result=await sendDshTranslation({
          mode:'draft',conversationId:requested.conversationId,
          draft:requested.draft,
        });
        if(disposed||el!==guest)return;
        const args=[requested.conversationId,requested.draft,result.translation];
        await el.executeJavaScript(
          'window.__yenraDshCloudTranslatorV1?.sendTranslated?.('+
            args.map(a=>JSON.stringify(a)).join(',')+')');
      }catch{
        if(guest===el)void el.executeJavaScript(
          'window.__yenraDshCloudTranslatorV1?.fail?.("ChatGPT 翻译未完成，中文草稿未发送。")'
        ).catch(()=>{});
      }finally{dshDraftBusy=false;}
    };
    const installDshTranslation=()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      let u:URL;try{u=new URL(guest.getURL())}catch{return}
      if(u.origin!==CLOUD_ORIGIN||!u.pathname.startsWith('/app/accounts/196799/'))return;
      void guest.executeJavaScript(CLOUD_DSH_TRANSLATOR_SCRIPT)
        .then(async()=>{
          await restoreCachedTranslations();
          if(Date.now()-dshRefreshAt>2500)void dshIncoming();
        }).catch(()=>{});
    };
    // Cloud can mount its virtualized bubbles after navigation events have
    // fired. Poll the lightweight visible-ID signature, not the model: a
    // cached Host read is throttled and no additional database is involved.
    const dshTranslationWatchdog=setInterval(()=>{
      if(!visibleRef.current)return;
      void restoreCachedTranslations();
      void dshCopilotChinese();
      if(Date.now()-dshRefreshAt>12000)void dshIncoming();
    },2000);
    // Reuse the official Chatwoot fallback bubble: only Cloud-verified
    // Facebook share links are added; no speculative image download.
    const installShareFallback=()=>{
      if(disposed||!visibleRef.current||!guest?.executeJavaScript)return;
      const el=guest;
      let current:URL;try{current=new URL(el.getURL())}catch{return}
      if(current.origin!==CLOUD_ORIGIN||
         !current.pathname.startsWith('/app/accounts/196799/'))return;
      void el.executeJavaScript(CLOUD_FB_SHARE_FALLBACK_SCRIPT)
        .then(()=>{
          if(disposed||guest!==el)return;
          const scope=verifiedShareRef.current;
          const id=Number.isSafeInteger(scope.conversationId)?scope.conversationId:0;
          const links=Array.isArray(scope.links)?scope.links:[];
          return el.executeJavaScript('window.__yenraCloudFbShareFallbackV1?.set('+
            JSON.stringify(id)+','+JSON.stringify(links)+')');
        }).catch(()=>{});
    };
    repaintShareRef.current=installShareFallback;
    captionVisualsRef.current=()=>{void applyVisuals()};
    visualsRef.current=()=>{void applyVisuals();installContactNavigation();annotatePrivateSidebar();installSavedPreview();installDshTranslation();installConversationTools();installKt();applyWaReaction();installShareFallback()};
    // DSH can change theme on a scoped ancestor or data-ds-theme-source,
    // not just the <html> class. Watch ONLY the existing seat's ancestor chain,
    // never Cloud's private DOM or the chat message subtree.
    const themeObserver=new MutationObserver(()=>{void applyVisuals()});
    const themeAttributes=['data-ds-theme-source','data-ds-dark-theme','class','style'];
    const themeNodes=new Set<HTMLElement>();
    for(let node:HTMLElement|null=target;node;node=node.parentElement)
      themeNodes.add(node);
    themeNodes.add(document.documentElement);
    themeNodes.add(document.body);
    for(const node of themeNodes)
      themeObserver.observe(node,{attributes:true,attributeFilter:themeAttributes});
    const applyZoom=()=>{
      if(!guest?.setZoomFactor)return;
      const next=authenticationPage?loginZoom(target.getBoundingClientRect().width):1;
      if(lastZoom===next)return;
      try{guest.setZoomFactor(next);lastZoom=next}catch{/* Guest may be navigating */}
    };
    const observer=new ResizeObserver(()=>{if(!disposed)applyZoom()});
    observer.observe(target);
    const onNavigation=()=>{
      if(disposed||!guest)return;
      let url:URL;
      try{url=new URL(guest.getURL())}catch{
        conversationLayoutRef.current?.(false);
        if(lastConversationId!==null){lastConversationId=null;exitRef.current?.()}
        return;
      }
      conversationLayoutRef.current?.(url.origin===CLOUD_ORIGIN&&
        /^\/app\/accounts\/196799\/(?:dashboard|conversations(?:\/\d+)?)\/?$/u.test(url.pathname));
      if(url.origin!==CLOUD_ORIGIN){
        if(lastConversationId!==null){lastConversationId=null;exitRef.current?.()}
        return;
      }
      authenticationPage=AUTH_PATH.test(url.pathname);
      const pending=pendingNotificationRef.current;
      if(pending!==null&&url.pathname.startsWith('/app/accounts/196799/')&&
         !authenticationPage){
        pendingNotificationRef.current=null;
        const desired='/app/accounts/196799/conversations/'+pending;
        if(url.pathname!==desired){void guest.loadURL(CLOUD_ORIGIN+desired).catch(()=>{});return}
      }
      // Invalidate pending restore requests on every real conversation
      // transition. A late result from A must not suppress B→A replay.
      const newConversation=CONVERSATION_PATH.exec(url.pathname);
      const nextId=newConversation?Number(newConversation[1]):0;
      if(nextId!==cachedRestoreConversation){
        cachedRestoreConversation=nextId;
        cachedRestoreEpoch++;
        cachedRestoreKey='';cachedRestoreAt=0;
        // A failure or slow model on contact A must not block contact B.
        dshIncomingEpoch++;
        dshIncomingAbort?.abort();dshIncomingAbort=null;
        dshModelBusy=false;dshFailureUntil=0;dshRefreshAt=0;
        copilotFailUntil=0;
      }
      applyZoom();
      void applyVisuals();
      installContactNavigation();
      annotatePrivateSidebar();
      installSavedPreview();
      installConversationTools();
      installDshTranslation();
      installKt();
      applyWaReaction();
      setState('ready');
      const found=CONVERSATION_PATH.exec(url.pathname);
      const id=found?Number(found[1]):null;
      void checkWaEligibility(id??0);
      if(id!==null&&Number.isSafeInteger(id)&&id>0){
        if(lastConversationId!==id){
          exportAbortRef.current?.abort();
          exportFileRef.current=null;setExportReady(false);setExportConversationId(null);
          ktSelections.clear();
          lastConversationId=id;
          hintRef.current?.({accountId:CLOUD_ACCOUNT_ID,conversationId:id});
        }
      }else if(lastConversationId!==null){
        exportAbortRef.current?.abort();
        exportFileRef.current=null;setExportReady(false);setExportConversationId(null);
        lastConversationId=null;
        exitRef.current?.();
      }
    };
    // A display-only recovery check for Cloud's asynchronous virtual list.
    // This does not fetch provider messages or call a translation model.
    const previewWatchdog=setInterval(()=>{
      if(visibleRef.current){installSavedPreview();scheduleSavedPreviews()}
    },60000);
    navigationRef.current=()=>{lastConversationId=null;onNavigation()};
    const boot=async()=>{
      try{
        const lease=await bridge.acquire(WORKSPACE_KEY);
        if(disposed){await bridge.release(lease.lease);return}
        activeLease=lease.lease;
        const el=document.createElement('webview') as Guest;
        guest=el;
        cloudGuestRef.current=el;
        // Chatwoot uses target=_blank for original Facebook profiles and
        // shared posts. The existing DSH BrowserGuests service DENIES a
        // second Electron window and emits an owner-scoped open request.
        // Reuse its original IPC bridge and main window's shell.openExternal.
        removeExternalLinkListener=bindExistingCloudGuestExternalLinkOpener(
          bridge,lease.lease,()=>{
            if(disposed||!visibleRef.current||guest!==el||activeLease!==lease.lease)return false;
            try{
              const current=new URL(el.getURL());
              return current.origin===CLOUD_ORIGIN&&
                current.pathname.startsWith('/app/accounts/196799/');
            }catch{return false}
          },
          url=>{window.open(url,'_blank','noopener,noreferrer')}
        );
        el.setAttribute('partition',lease.partition);
        el.setAttribute('src','about:blank#'+lease.lease);
        el.setAttribute('name','yenra-cloud-chatwoot-native');
        el.setAttribute('allowpopups','');
        // Electron's <webview> has a flex shadow iframe. Never override its
        // default display:flex with block: the host element looks full-height
        // but the guest viewport silently remains at the 150px default.
        el.style.cssText='display:flex;width:100%;height:100%;border:0;min-height:0;min-width:0';
        el.style.setProperty('-webkit-app-region','no-drag');
        el.addEventListener('dom-ready',()=>{
          if(disposed||guest!==el)return;
          // A full Cloud guest document reload also invalidates previous
          // render callbacks even when the conversation ID is unchanged.
          cachedRestoreEpoch++;
          cachedRestoreKey='';cachedRestoreAt=0;
          // Only the first inert lease bootstrap navigates. Cloud links, login,
          // attachments and Captain remain native to Chatwoot.
          if(el.getURL().startsWith('about:blank')){
            void el.loadURL(CLOUD_LANDING).catch(()=>{
              if(!disposed)setState('failed');
            });
          }else{
            // did-navigate can already insert into this same document before
            // dom-ready. Keep its key so a later tools/theme update removes it.
            lastCss='';
            onNavigation();
            // An authenticated Cloud document only: NEVER touch OAuth/login
            // views or rewrite any Chatwoot DOM, data, role or route handlers.
            try{
              const current=new URL(el.getURL());
              if(current.origin===CLOUD_ORIGIN&&
                  current.pathname.startsWith('/app/accounts/196799/')){
                void applyVisuals();annotatePrivateSidebar();installSavedPreview();installDshTranslation();applyWaReaction();
              }
            }catch{/* The guest can navigate while its document initializes. */}
          }
        });
        // Per-guest short-lived correlation only: never persist guest output.
        // Prevent concurrent confirmation writes for the exact same MID.
        const receiptInFlight=new Set<string>();
        const receiptQueued=new Set<string>();
        el.addEventListener('console-message',(event:Event)=>{
          const value=String((event as Event&{message?:string}).message??'');
          // Chatwoot's right-click Translate menu is still visible while
          // Google Translate has no integration Hook in the paid Cloud.
          // Let the existing ORIGINAL DSH translate one verified Cloud MID,
          // including sent text, with its already-persistent Chinese cache.
          const manual=/^YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:(\d+):(\d+)$/u.exec(value);
          if(manual){
            const cid=Number(manual[1]),mid=Number(manual[2]);
            if(disposed||!visibleRef.current||guest!==el||
               !Number.isSafeInteger(cid)||cid<=0||
               !Number.isSafeInteger(mid)||mid<=0)return;
            let current:URL;
            try{current=new URL(el.getURL())}catch{return}
            if(current.origin!==CLOUD_ORIGIN||
               current.pathname!=='/app/accounts/196799/conversations/'+cid)return;
            const key=cid+':'+mid;
            if(manualTranslationInFlight.has(key))return;
            manualTranslationInFlight.add(key);
            const feedback=async(text:string,failed=false)=>{
              if(disposed||guest!==el)return;
              let current:URL;
              try{current=new URL(el.getURL())}catch{return}
              if(current.origin!==CLOUD_ORIGIN||
                 current.pathname!=='/app/accounts/196799/conversations/'+cid)return;
              await el.executeJavaScript(
                'window.__yenraDshCloudManualTranslateV1?.feedback?.('+
                cid+','+mid+','+JSON.stringify(text)+','+JSON.stringify(failed)+')'
              ).catch(()=>{});
            };
            void (async()=>{
              try{
                const result=await sendDshTranslation({
                  mode:'export',conversationId:cid,messageIds:[mid],
                });
                const item=Array.isArray(result.items)?
                  result.items.find((x:{id?:number;translation?:string})=>x.id===mid):null;
                if(result.mode!=='export'||result.conversationId!==cid||
                   typeof item?.translation!=='string'||
                   !/[\u3400-\u9fff]/u.test(item.translation))
                  throw Error('MANUAL_TRANSLATION_EMPTY');
                if(disposed||guest!==el)return;
                let after:URL;try{after=new URL(el.getURL())}catch{return}
                if(after.origin!==CLOUD_ORIGIN||
                   after.pathname!=='/app/accounts/196799/conversations/'+cid)return;
                const painted=await el.executeJavaScript(
                  'window.__yenraDshCloudTranslatorV1?.paint?.('+
                  cid+','+JSON.stringify([{id:mid,translation:item.translation}])+')'
                );
                invalidatePreviewMisses(cid,[{id:mid,translation:item.translation}]);
                scheduleSavedPreviews();
                await feedback(painted===1?'翻译完成，可查看原文':'译文已保存，消息未显示时可重新打开会话',painted!==1);
              }catch{
                await feedback('翻译没有完成，请稍后重试',true);
              }finally{manualTranslationInFlight.delete(key);}
            })();
            return;
          }
          const adopted=/^YENRA_CLOUD_ADOPT_SENT_CANDIDATE:(\d+):(\d+)$/u.exec(value);
          const receipt=/^YENRA_CLOUD_PAGE_RECEIPT_CHANGED:(\d+):(\d+)$/u.exec(value);
          if(adopted||receipt){
            const candidate=adopted??receipt!;
            const cid=Number(candidate[1]),mid=Number(candidate[2]);
            if(disposed||!visibleRef.current||guest!==el||
               !Number.isSafeInteger(cid)||cid<=0||
               !Number.isSafeInteger(mid)||mid<=0)return;
            try{
              const u=new URL(el.getURL());
              if(u.origin!==CLOUD_ORIGIN||
                 u.pathname!==('/app/accounts/196799/conversations/'+cid))return;
            }catch{return}
            // Guest console is ONLY a candidate event. The existing DSH Host
            // verifies original Cloud source MID, delivery, contact binding
            // and the same native MemoryService adopted draft before writing.
            const receiptKey=cid+':'+mid;
            if(receiptInFlight.has(receiptKey)){
              if(receipt)receiptQueued.add(receiptKey);
              return;
            }
            receiptInFlight.add(receiptKey);
            void (async()=>{
              try{
              // Native MemoryService adopt may persist AFTER original Cloud
              // delivery: production evidence showed 50.846s write-behind.
              // This bounded ~3-minute retry window is intentionally longer
              // than that lag; it does not send a message, create a poller,
              // or accept a guest event as proof without the original Host.
              const delays=adopted
                ?[0,1500,3500,7000,11000,18000,25000,30000,30000,30000,30000]
                // Existing Cloud receipt icon changed in-place: no new
                // send/adoption is expected. Only the original DSH Host may
                // confirm a later Cloud-delivered/read provider receipt.
                :[0,2500,6500];
              for(const delay of delays){
                if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
                if(disposed||guest!==el||!visibleRef.current)return;
                let current:URL;
                try{current=new URL(el.getURL())}catch{return}
                if(current.origin!==CLOUD_ORIGIN||
                   current.pathname!==('/app/accounts/196799/conversations/'+cid))return;
                if(await adoptedSentRef.current?.(cid,mid).catch(()=>false))return;
              }
              }finally{
                receiptInFlight.delete(receiptKey);
                if(receiptQueued.delete(receiptKey)&&!disposed&&guest===el&&visibleRef.current){
                  let stillSame=false;
                  try{const url=new URL(el.getURL());stillSame=url.origin===CLOUD_ORIGIN&&
                    url.pathname===('/app/accounts/196799/conversations/'+cid)}catch{}
                  if(stillSame)void adoptedSentRef.current?.(cid,mid).catch(()=>false);
                }
              }
            })();
            return;
          }
          const waClick=/^YENRA_CLOUD_WA_REACT:(\d+):(\d+):([0-5])$/u.exec(value);
          if(waClick){
            const c=Number(waClick[1]),m=Number(waClick[2]),idx=Number(waClick[3]);
            if(disposed||!visibleRef.current||guest!==el||waAllowedConversationId!==c)return;
            try{
              const u=new URL(el.getURL());
              if(u.origin!==CLOUD_ORIGIN||u.pathname!==('/app/accounts/196799/conversations/'+c))return;
            }catch{return}
            void submitWaReaction(el,c,m,idx);
            return;
          }
          const ktClick=/^YENRA_CLOUD_KT_CLICK:(\d+):(\d+)$/u.exec(value);
          const ktCountry=/^YENRA_CLOUD_KT_COUNTRY:(\d+):(\d+):([A-Za-z0-9+]{1,8})$/u.exec(value);
          const ktSelect=/^YENRA_CLOUD_KT_SELECT:(\d+):(\d+):(\d+)$/u.exec(value);
          if(ktClick||ktCountry||ktSelect){
            const part=(ktClick||ktCountry||ktSelect)!;
            const c=Number(part[1]),m=Number(part[2]);
            if(disposed||!visibleRef.current||guest!==el||!isCurrentKt(el,c,m))return;
            if(ktSelect){
              const index=Number(ktSelect[3]),choice=ktSelections.get(c+':'+m);
              if(choice&&Number.isSafeInteger(index)&&index>=0&&index<choice.numbers.length)
                void queryKt(c,m,'check',choice.numbers[index].number,choice.country);
            }else{
              const country=ktCountry?.[3];
              void queryKt(c,m,'inspect',undefined,country,
                ktCountry?'manual':'none');
            }
            return;
          }
          const toolsClick=/^YENRA_CLOUD_CONVERSATION_TOOLS_CLICK:(\d+)$/u.exec(value);
          if(toolsClick){
            if(disposed||!visibleRef.current||guest!==el)return;
            try{
              const url=new URL(el.getURL());
              const current=CONVERSATION_PATH.exec(url.pathname);
              if(url.origin!==CLOUD_ORIGIN||!current||current[1]!==toolsClick[1]||
                  !Number.isSafeInteger(Number(current[1]))||Number(current[1])<=0)return;
              toggleToolsRef.current?.();
            }catch{/* A navigation can invalidate a display-only request. */}
            return;
          }
          if(value==='YENRA_CLOUD_DSH_DRAFT_TRANSLATE'){
            void dshTranslateDraft();return;
          }
          if(value==='YENRA_CLOUD_DSH_INCOMING_CHANGED'){
            void restoreCachedTranslations().then(()=>{
              if(Date.now()-dshRefreshAt>1800)void dshIncoming();
            });return;
          }
          if(value==='YENRA_CLOUD_SAVED_PREVIEW_DIRTY'){
            scheduleSavedPreviews();queuePreviewTranslationRetries();return;
          }
          const match=/^YENRA_PRIVATE_CLOUD_EXPORT_CLICK:(\d+)$/u.exec(value);
          if(!match)return;
          const id=Number(match[1]);
          if(!Number.isSafeInteger(id)||id<=0)return;
          let pathname='';
          try{const u=new URL(el.getURL());if(u.origin!==CLOUD_ORIGIN)return;pathname=u.pathname}catch{return}
          if(pathname!==`/app/accounts/196799/conversations/${id}`)return;
          setExportConversationId(id);
        });
        el.addEventListener('did-navigate',onNavigation);
        el.addEventListener('did-navigate-in-page',onNavigation);
        el.addEventListener('did-stop-loading',onNavigation);
        el.addEventListener('did-fail-load',(event:Event)=>{
          const e=event as Event&{errorCode?:number;isMainFrame?:boolean};
          if(!disposed&&e.isMainFrame!==false&&e.errorCode!==-3)setState('failed');
        });
        target.appendChild(el);
      }catch{
        if(!disposed)setState('failed');
      }
    };
    void boot();
    return()=>{
      disposed=true;
      dshIncomingEpoch++;dshIncomingAbort?.abort();dshIncomingAbort=null;
      adoptSinkRef.current?.(null);
      navigationRef.current=null;
      notificationRouteRef.current=null;
      visualsRef.current=null;
      repaintShareRef.current=null;
      captionVisualsRef.current=null;
      exportAbortRef.current?.abort();
      exportFileRef.current=null;
      observer.disconnect();
      themeObserver.disconnect();
      if(previewTimer)clearTimeout(previewTimer);
      for(const timer of previewRetryTimers)clearTimeout(timer);
      previewRetryTimers.clear();
      clearInterval(previewWatchdog);
      clearInterval(dshTranslationWatchdog);
      removeExternalLinkListener();
      guest?.remove();
      cloudGuestRef.current=null;
      if(activeLease!==null)void bridge.release(activeLease).catch(()=>{});
    };
  },[]);
  // Revalidate on returning from Work or the emergency inbox. The Guest stays
  // mounted and retains its native drafts, but an old Brain identity is not reused.
  useEffect(()=>{if(visible)navigationRef.current?.()},[visible]);
  useEffect(()=>{if(visible)repaintShareRef.current?.()},[visible,shareConversationId,verifiedShareLinks]);
  // One verified notification click uses the SAME Guest, Cloud auth and Brain
  // conversation onNavigate callback. No new tab or independent route store.
  useEffect(()=>{
    if(notificationTarget&&Number.isSafeInteger(notificationTarget.conversationId)&&
      notificationTarget.conversationId>0)
      notificationRouteRef.current?.(notificationTarget.conversationId);
  },[notificationTarget?.sequence]);
  useEffect(()=>{visualsRef.current?.()},[showTools]);
  // Caption geometry is display-only: do not reinstall or invoke translation
  // services while resizing the window or opening the existing AI pane.
  useEffect(()=>{captionVisualsRef.current?.()},[mergedHeader,captionWindowInset,captionModeCenter]);
  return (
    <section data-yenra-cloud-native-seat="candidate" data-conversation-tools={showTools?'visible':'secondary'} aria-label="YENRA 云收件箱"
      style={{display:visible?'flex':'none',width:'100%',height:'100%',minHeight:0,
        position:'relative',flexDirection:'column'}}>
      <div ref={hostRef} style={{flex:1,minHeight:0,width:'100%',display:'flex'}}/>
      {visible&&exportConversationId!==null?<div
        data-yenra-cloud-export-dialog="true"
        style={{position:'absolute',inset:0,zIndex:80,background:'rgba(0,0,0,.46)',
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
        <div role="dialog" aria-modal="true" aria-label="导出 Cloud 聊天报表"
          style={{width:'min(370px,100%)',display:'flex',flexDirection:'column',gap:12,
            border:'1px solid var(--dsw-alias-border-l2)',
            borderRadius:12,padding:18,boxShadow:'0 15px 45px rgba(0,0,0,.3)',
            background:'var(--dsw-alias-bg-layer-1)',
            color:'var(--dsw-alias-label-primary)'}}>
          <strong style={{fontSize:15}}>导出聊天记录／报表</strong>
          <span style={{fontSize:12,color:'var(--dsw-alias-label-secondary)'}}>
            使用原版 ChatLume 的聊天气泡、日期、原文＋已有译文及附件布局。仅导出当前 Cloud 已保存的消息。
          </span>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
            导出格式
            <select value={exportFormat} disabled={exportBusy}
              onChange={event=>{setExportFormat(event.target.value as 'html'|'zip');
                exportFileRef.current=null;setExportReady(false);setExportStatus('');}}>
              <option value="zip">HTML＋媒体 ZIP（离线存档）</option>
              <option value="html">独立 HTML（图片及小媒体内嵌）</option>
            </select>
          </label>
          {exportStatus?<span role="status" style={{fontSize:12}}>{exportStatus}</span>:null}
          {exportError?<span role="alert" style={{fontSize:12,color:'#d66'}}>
            {exportError}</span>:null}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button type="button" onClick={closeCloudExport}>
              {exportBusy?'停止并关闭':exportReady?'关闭':'取消'}
            </button>
            {exportReady?<button type="button"
              onClick={()=>{void saveCloudReportAs()}}>选择位置保存…</button>:null}
            <button type="button" disabled={exportBusy}
              onClick={()=>{if(exportReady)saveCloudReport();else void startCloudExport()}}
              style={{borderRadius:7,padding:'7px 12px',
                background:'var(--dsw-alias-bg-layer-3)',
                color:'var(--dsw-alias-label-primary)'}}>
              {exportBusy?'正在生成…':exportReady?'下载文件':'生成 ChatLume 报表'}
            </button>
          </div>
        </div>
      </div>:null}
      {visible&&state==='loading'&&<div role="status" aria-live="polite" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',pointerEvents:'none',background:'var(--dsw-alias-bg-base, #fff)',color:'var(--dsw-alias-label-primary)'}}>YENRA · 正在加载云收件箱…</div>}
      {state==='unavailable'&&<div role="alert">云收件箱需要 YENRA 官方 DSH 桌面工作台</div>}
      {state==='failed'&&<div role="alert">云收件箱加载失败，请检查网络或登录状态</div>}
    </section>
  );
}
