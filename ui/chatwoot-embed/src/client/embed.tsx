/**
 * Compatibility-only inbox seat. No shell/main/sidebar/Conversation registration.
 * Insert this component INSIDE the existing Desktop `v2-social` seat, retaining
 * the existing right-hand brain, persona, suggestions and translation callbacks.
 *
 * When a Host-verified selection producer is available (supplied by the parent,
 * or auto-created from Config via the opt-in route reporter), selecting
 * a conversation in the Chatwoot iframe binds the right-hand Brain to the mapped
 * accountRef/roomRef. On any mapping failure it deselects — adoption/send stay
 * disabled, never pointing at the wrong contact.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_NAMESPACE, validateOrigin } from '../config.mjs'
import type { InboxBindingSink, VerifiedSelectionSource } from './binding-contract.ts'
import { createHostVerifiedSelectionSource } from './selection-source.ts'
import { createDashboardSelectionSource } from './dashboard-selection.mjs'
import { createRouteSelectionSource } from './route-selection.mjs'

export interface ChatwootInboxProps {
  /** Visibility only: parent MUST keep this component mounted in Chat and Work. */
  visible: boolean
  /** Exact Host entry namespace from Inspect/Settings, not a package name. */
  configNamespace?: string
  bindingSink: InboxBindingSink
  /** Optional explicit producer; when omitted, one is auto-created from config. */
  selectionSource?: VerifiedSelectionSource
  /** Existing original DSH translator only. Trigger on a VISIBLE Chatwoot
   * message, with original MID+source proof. No bulk historical backfill. */
  translateVisibleMessage?: (
    scope: { accountRef: string; roomRef: string },
    message: { id: string; text: string; chatwoot: {
      accountId:number;conversationId:number;inboxId:number;messageId:number
    } }
  ) => Promise<string | null>
}

export function createChatwootInbox(ctx: Context) {
  return function ChatwootInbox({
    visible, configNamespace = DEFAULT_NAMESPACE, bindingSink, selectionSource,
    translateVisibleMessage,
  }: ChatwootInboxProps) {
    const frameRef = useRef<HTMLIFrameElement | null>(null)
    const form = useMemo(() => ctx.configForms.get<{ origin: string; bridgeOrigin: string; selectionMode: string; accountId: number }>(configNamespace), [configNamespace])
    const snapshot = useSyncExternalStore(
      listener => form.subscribe(listener), () => form.getSnapshot(), () => form.getSnapshot(),
    )
    const sink = useRef(bindingSink)
    sink.current = bindingSink
    // Restore the original ChatLume HTML/media ZIP exporter without touching
    // Chatwoot's native inbox, Composer, or upstream message/cache components.
    // Export reads only on explicit user confirmation, never at room open.
    const [exportScope, setExportScope] = useState<{accountRef:string;roomRef:string}|null>(null)
    const exportScopeRef = useRef<{accountRef:string;roomRef:string}|null>(null)
    const exportEpoch = useRef(0)
    const exportVisibleRef = useRef(visible)
    exportVisibleRef.current = visible
    const [exportOpen, setExportOpen] = useState(false)
    const [exportVerified, setExportVerified] = useState(false)
    const [exportFormat, setExportFormat] = useState<'zip'|'html'>('zip')
    const [exportBusy, setExportBusy] = useState(false)
    const [exportStatus, setExportStatus] = useState('')
    const [exportError, setExportError] = useState('')
    const startExport = async () => {
      const scope = exportScopeRef.current
      if (!visible || !scope || exportBusy || !exportOpen || !exportVerified) return
      const epoch = ++exportEpoch.current
      setExportBusy(true)
      setExportError('')
      setExportStatus('正在读取当前联系人已授权的聊天历史…')
      const cancelled = () => exportEpoch.current !== epoch ||
        !exportVisibleRef.current ||
        exportScopeRef.current?.accountRef !== scope.accountRef ||
        exportScopeRef.current?.roomRef !== scope.roomRef
      try {
        // Load the mature ZIP renderer only on demand; it never runs in the
        // normal contact-open path or extends Chatwoot's startup bundle.
        const exportModulePath = '/api/yenra/chat-export/runtime.js'
        const {exportSelectedLegacyConversation} = await import(/* @vite-ignore */ exportModulePath) as {
          exportSelectedLegacyConversation: (options: Record<string,unknown>) => Promise<{
            messageCount:number;missingAttachments:number
          }>
        }
        if (cancelled()) return
        const result = await exportSelectedLegacyConversation({
          scope, format:exportFormat, cancelled,
          onProgress: (progress: {stage?:string;received?:number;finished?:number;total?:number}) => {
            if (cancelled()) return
            setExportStatus(progress.stage === 'media'
              ? `正在打包媒体 ${progress.finished ?? 0}/${progress.total ?? 0}`
              : progress.stage === 'messages'
                ? `已读取 ${progress.received ?? 0} 条消息，正在生成存档…`
                : '正在生成聊天存档…')
          },
        })
        if (cancelled()) return
        setExportOpen(false)
        setExportStatus(`已生成 ${result.messageCount} 条消息的存档` +
          (result.missingAttachments ? `（${result.missingAttachments} 项媒体未能取回）` : ''))
      } catch (error) {
        if (!cancelled()) setExportError(error instanceof Error ? error.message : '聊天记录导出失败')
      } finally {
        if (!cancelled()) setExportBusy(false)
      }
    }
    useEffect(() => {
      if (visible) return
      exportEpoch.current++
      setExportOpen(false)
      setExportBusy(false)
      setExportStatus('')
      setExportError('')
    }, [visible])
    // Keep the asynchronous translation worker attached to its ONE mounted
    // iframe. Brain/contact selection rerenders may replace a callback but
    // must never discard a completed DSH translation or its bubble reply.
    const latestTranslator = useRef(translateVisibleMessage)
    latestTranslator.current = translateVisibleMessage
    // Only Host-VERIFIED Chatwoot selection is allowed to request ChatGPT work.
    // Neither Chatwoot URLs nor postMessage payloads provide account authority.
    const verifiedTranslationScope = useRef<{accountRef:string;roomRef:string}|null>(null)
    const wakeTranslationQueue = useRef<(() => void)|null>(null)
    const invalidateTranslationQueue = useRef<(() => void)|null>(null)
    // Each installed YENRA desktop gets a short-lived Chatwoot-native SSO
    // launch from its own authenticated original DSH Host. No password fields,
    // shared cookies or Chatwoot credential access in this client.
    const [ssoLaunch,setSsoLaunch]=useState<{key:string;url:string}|null>(null)
    const [ssoError,setSsoError]=useState(false)
    const [ssoAttempt,setSsoAttempt]=useState(0)

    let origin: string | undefined
    let bridgeOrigin: string | undefined
    let error = ''
    if (snapshot.status === 'ready' && snapshot.value) {
      try {
        origin = validateOrigin(snapshot.value.origin)
        bridgeOrigin = validateOrigin(snapshot.value.bridgeOrigin ?? '')
      } catch (failure) {
        error = String(failure)
      }
    }

    const accountId=snapshot.value?.accountId??1
    // The Chatwoot native More menu is the ONLY entry point. Treat its
    // postMessage as an untrusted hint and re-verify the current conversation
    // against the original authenticated DSH Host before offering export.
    useEffect(() => {
      if (!origin || !visible) return
      let disposed=false
      const controller=new AbortController()
      const receive = (event: MessageEvent) => {
        const data=event.data
        if(event.source!==frameRef.current?.contentWindow ||
          event.origin!==origin) return
        // Native AI button in the Chatwoot composer opens the right-hand Brain.
        if(data?.type==='yenra:cw:brain-toggle:v1'){
          sink.current.onBrainToggle?.()
          return
        }
        if(data?.type!=='yenra:cw-export-request:v1' ||
          data.accountId!==accountId ||
          !Number.isSafeInteger(data.conversationId) || data.conversationId<=0) return
        const selected=exportScopeRef.current
        if(!selected)return
        const epoch=exportEpoch.current
        setExportOpen(true)
        setExportVerified(false)
        setExportError('')
        setExportStatus('正在核实当前聊天…')
        void fetch('/api/yenra/chatwoot-context/resolve',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          signal:controller.signal,
          headers:{'content-type':'application/json',
            ...(window.location.origin==='dsh-app://app'
              ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
          body:JSON.stringify({accountId,conversationId:data.conversationId}),
        }).then(async response=>{
          const result=await response.json()
          if(!response.ok || result?.ok!==true ||
            result.selection?.accountRef!==selected.accountRef ||
            result.selection?.roomRef!==selected.roomRef)
            throw Error('当前会话身份核验未通过，请重新打开联系人')
          if(disposed || !exportVisibleRef.current || exportEpoch.current!==epoch ||
            exportScopeRef.current?.accountRef!==selected.accountRef ||
            exportScopeRef.current?.roomRef!==selected.roomRef)return
          setExportVerified(true)
          setExportStatus('')
        }).catch(error=>{
          if(disposed || !exportVisibleRef.current || exportEpoch.current!==epoch)return
          setExportVerified(false)
          setExportStatus('')
          setExportError(error instanceof Error && error.name!=='AbortError'
            ? error.message : '无法核验当前会话')
        })
      }
      window.addEventListener('message',receive)
      return()=>{disposed=true;controller.abort();window.removeEventListener('message',receive)}
    },[origin,visible,accountId])
    const ssoKey=origin?origin+'#'+accountId:null
    useEffect(()=>{
      if(!origin||!ssoKey)return
      let disposed=false
      const controller=new AbortController()
      setSsoLaunch(null)
      setSsoError(false)
      void (async()=>{
        try{
          // Reuse Chatwoot's EXISTING authenticated browser session. Previously
          // every YENRA window/remount minted a new SSO token, exhausting
          // Chatwoot's official 25-session limit and showing a login picker.
          // The local proxy validates the native token with Rails; it returns
          // only a boolean, never credentials or the actual Chatwoot cookie.
          const session=await fetch(origin+'/__yenra/session/status',{
            method:'GET',credentials:'include',cache:'no-store',
            signal:controller.signal,headers:{accept:'application/json'},
          })
          if(!session.ok)throw Error('NATIVE_CHATWOOT_SESSION_CHECK_FAILED')
          const status=await session.json() as {authorized?:boolean}
          if(status.authorized===true){
            const dashboard=new URL('/app/accounts/'+accountId+'/dashboard',origin)
            dashboard.searchParams.set('yenraEmbed','1')
            dashboard.searchParams.set('yenraParentOrigin',window.location.origin)
            if(!disposed)setSsoLaunch({key:ssoKey,url:dashboard.href})
            return
          }
          const response=await fetch('/api/yenra/chatwoot-desktop-session',{
            method:'POST',credentials:'same-origin',cache:'no-store',
            signal:controller.signal,
            headers:{'content-type':'application/json',
              ...(window.location.origin==='dsh-app://app'
                ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
            body:'{}',
          })
          if(!response.ok)throw Error('OWNER_SSO_UNAVAILABLE')
          const payload=await response.json() as {ok?:boolean;url?:string}
          if(payload.ok!==true||typeof payload.url!=='string')throw Error('SSO_NOT_ISSUED')
          const target=new URL(payload.url)
          if(target.origin!==origin||target.pathname!=='/app/login'||
            target.searchParams.get('sso_account_id')!==String(accountId)||
            !/^[a-f0-9]{64}$/.test(target.searchParams.get('sso_auth_token')??''))
            throw Error('SSO_TARGET_REJECTED')
          if(!disposed)setSsoLaunch({key:ssoKey,url:target.href})
        }catch{
          if(!disposed)setSsoError(true)
        }
      })()
      return()=>{disposed=true;controller.abort()}
    },[ssoKey,ssoAttempt])
    // An unprovisioned first-run Chatwoot can finish Rails/PG startup after the
    // original DSH window becomes interactive. Retry only this bounded first
    // launch, never keep a polling service alive during normal chat.
    useEffect(()=>{
      if(!ssoError||!visible||ssoAttempt>=10)return
      const delay=Math.min(8000,1000*2**Math.min(ssoAttempt,3))
      const timer=setTimeout(()=>setSsoAttempt(attempt=>attempt+1),delay)
      return()=>clearTimeout(timer)
    },[ssoError,visible,ssoAttempt])

    const effectiveSource = useMemo<VerifiedSelectionSource | null>(() => {
      if (selectionSource) return selectionSource
      if (!origin) return null
      if (snapshot.value?.selectionMode === 'proxy' && bridgeOrigin) {
        return createHostVerifiedSelectionSource({ proxyOrigin: origin, bridgeOrigin })
      }
      const createSource = snapshot.value?.selectionMode === 'dashboard'
        ? createDashboardSelectionSource : createRouteSelectionSource
      return createSource({
        expectedOrigin: origin,
        getFrameWindow: () => frameRef.current?.contentWindow ?? null,
        resolveContext: async (context: unknown, signal: AbortSignal) => {
          const response = await fetch('/api/yenra/chatwoot-context/resolve', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
            headers: { 'content-type': 'application/json',
              ...(window.location.origin === 'dsh-app://app' ? { 'x-yenra-desktop-origin': 'dsh-app://app' } : {}) },
            body: JSON.stringify(context),
          })
          const payload = await response.json()
          if (!response.ok || payload?.ok !== true) throw Error('CONTEXT_NOT_HOST_VERIFIED')
          return payload.selection
        },
      })
    }, [selectionSource, origin, bridgeOrigin, snapshot.value?.selectionMode, snapshot.revision])

    useEffect(() => {
      if (!origin || !latestTranslator.current || !visible) return
      type VisibleMessage = { messageId:number; conversationId:number; inboxId:number; sourceId:string; text:string; manual?:boolean }
      const queued = new Map<number, VisibleMessage>()
      const completed = new Set<number>()
      // Retain only authenticated, verified replies for the current live
      // contact. A Chatwoot iframe reload must receive the exact same
      // finished translation again, without another model call.
      const completedReplies = new Map<number, {
        conversationId: number; inboxId: number; sourceId: string;
        text: string; translation: string
      }>()
      let active = true
      let running = 0
      let epoch = 0
      let verifiedConversation: {id:number;accountRef:string;roomRef:string}|null = null
      let resolving = false
      const resolutionAttempts = new Map<number,number>()
      const clear = () => {
        queued.clear();completed.clear();completedReplies.clear();verifiedConversation=null
        resolutionAttempts.clear();++epoch
      }
      const pump = () => {
        if (!active || !queued.size) return
        const first = queued.values().next().value as VisibleMessage | undefined
        if (!first) return
        if (verifiedConversation?.id !== first.conversationId) {
          if (resolving || (resolutionAttempts.get(first.conversationId)??0)>=2) return
          const conversationId=first.conversationId
          resolutionAttempts.set(conversationId,(resolutionAttempts.get(conversationId)??0)+1)
          const startedEpoch=epoch
          resolving=true
          // Reuse the SAME authenticated original Host identity resolver as
          // native route selection. The iframe event is a hint, not authority.
          void fetch('/api/yenra/chatwoot-context/resolve',{
            method:'POST',credentials:'same-origin',cache:'no-store',
            headers:{'content-type':'application/json',
              ...(window.location.origin==='dsh-app://app'
                ?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
            body:JSON.stringify({accountId,conversationId}),
          }).then(async response=>{
            const payload=await response.json()
            if(!response.ok||payload?.ok!==true ||
              !/^[a-f0-9]{32}$/.test(payload?.selection?.accountRef??'') ||
              !/^[a-f0-9]{32}$/.test(payload?.selection?.roomRef??'')){
              throw Error('CHATWOOT_HOST_CONTEXT_UNVERIFIED')
            }
            if(!active || startedEpoch!==epoch ||
              queued.values().next().value?.conversationId!==conversationId)return
            verifiedConversation={id:conversationId,
              accountRef:payload.selection.accountRef,roomRef:payload.selection.roomRef}
            verifiedTranslationScope.current=payload.selection
            sink.current.onSelected(payload.selection.accountRef,payload.selection.roomRef)
          }).catch(()=>{
            // Manual translation must never fail silently. Only return an error
            // to the same authenticated iframe; no bypass of Host authority.
            if(!active || startedEpoch!==epoch)return
            for(const item of [...queued.values()]){
              if(!item.manual || item.conversationId!==conversationId)continue
              queued.delete(item.messageId)
              frameRef.current?.contentWindow?.postMessage({
                type:'yenra:cw:auto-zh-failed:v1',messageId:item.messageId,
                conversationId:item.conversationId,inboxId:item.inboxId,
                sourceId:item.sourceId,text:item.text,
              },origin)
            }
          })
            .finally(()=>{resolving=false; if(active&&queued.size&&
              (verifiedConversation || (resolutionAttempts.get(conversationId)??0)<2))
                pump()})
          return
        }
        const scope=verifiedConversation
        while (running < 2 && queued.size) {
          const next = queued.entries().next().value as [number,VisibleMessage] | undefined
          if (!next) return
          const [messageId, item] = next
          queued.delete(messageId)
          if (completed.has(messageId)) continue
          const currentEpoch = epoch
          const exactScope = {...scope}
          running++
          void latestTranslator.current!(exactScope, {id:item.sourceId,text:item.text,
            chatwoot:{accountId,conversationId:item.conversationId,inboxId:item.inboxId,messageId:item.messageId}})
            .then(translation => {
              if (!active || currentEpoch !== epoch ||
                verifiedConversation?.id !== item.conversationId ||
                verifiedConversation?.accountRef !== exactScope.accountRef ||
                verifiedConversation?.roomRef !== exactScope.roomRef ||
                typeof translation !== 'string' || !translation.trim() ||
                translation.length > 3500) return
              completed.add(messageId)
              completedReplies.set(messageId,{
                conversationId:item.conversationId,inboxId:item.inboxId,
                sourceId:item.sourceId,text:item.text,translation:translation.trim(),
              })
              // Bound the in-memory, contact-scoped replay cache; never
              // persist or duplicate the original Host translation authority.
              if(completedReplies.size>64){
                const oldest=completedReplies.keys().next().value
                if(oldest!==undefined){completedReplies.delete(oldest);completed.delete(oldest)}
              }
              frameRef.current?.contentWindow?.postMessage({
                type:'yenra:cw:auto-zh-result:v1',messageId,
                conversationId:item.conversationId,inboxId:item.inboxId,
                sourceId:item.sourceId,text:item.text,translation:translation.trim(),
              }, origin)
            })
            .catch(() => {
              if(!item.manual || !active || currentEpoch!==epoch)return
              frameRef.current?.contentWindow?.postMessage({
                type:'yenra:cw:auto-zh-failed:v1',messageId:item.messageId,
                conversationId:item.conversationId,inboxId:item.inboxId,
                sourceId:item.sourceId,text:item.text,
              },origin)
            })
            .finally(() => { running--; pump() })
        }
      }
      const receive = (event:MessageEvent) => {
        if (event.source !== frameRef.current?.contentWindow || event.origin !== origin) return
        const v=event.data
        if (!v || v.type !== 'yenra:cw:auto-zh-request:v1' ||
          ![v.messageId,v.conversationId,v.inboxId].every((n:unknown)=>
            typeof n === 'number' && Number.isSafeInteger(n) && n > 0) ||
          typeof v.sourceId !== 'string' || !v.sourceId || v.sourceId.length > 180 ||
          /[\x00-\x1f\x7f]/u.test(v.sourceId) ||
          typeof v.text !== 'string' || !v.text.trim() || v.text.length > 1200 ||
          v.accountId !== accountId ||
          (v.manual!==undefined && typeof v.manual!=='boolean') ||
          (queued.size >= 12 && v.manual!==true)) return
        if (completed.has(v.messageId) && v.manual!==true) {
          const cached=completedReplies.get(v.messageId)
          // Same trusted iframe source, account and original MID/text guard
          // as the first request. A new contact must never receive old replies.
          if(cached && cached.conversationId===v.conversationId &&
              cached.inboxId===v.inboxId &&
              cached.sourceId===v.sourceId && cached.text===v.text) {
            frameRef.current?.contentWindow?.postMessage({
              type:'yenra:cw:auto-zh-result:v1',messageId:v.messageId,
              conversationId:cached.conversationId,inboxId:cached.inboxId,
              sourceId:cached.sourceId,text:cached.text,
              translation:cached.translation,
            },origin)
          }
          return
        }
        if ((verifiedConversation && verifiedConversation.id!==v.conversationId) ||
          (queued.size && queued.values().next().value?.conversationId!==v.conversationId)){
          clear()
        }
        if(queued.has(v.messageId)){
          if(v.manual===true)queued.get(v.messageId)!.manual=true
          return
        }
        const request:VisibleMessage={
          messageId:v.messageId,conversationId:v.conversationId,
          inboxId:v.inboxId,sourceId:v.sourceId,text:v.text,manual:v.manual===true,
        }
        if(v.manual===true){
          // A direct right-click takes priority over silent idle history.
          completed.delete(v.messageId)
          completedReplies.delete(v.messageId)
          resolutionAttempts.delete(v.conversationId)
          const prior=[...queued.entries()]
          queued.clear()
          queued.set(v.messageId,request)
          for(const [id,item] of prior)if(queued.size<12)queued.set(id,item)
        }else queued.set(v.messageId,request)
        pump()
      }
      wakeTranslationQueue.current = pump
      invalidateTranslationQueue.current = clear
      window.addEventListener('message',receive)
      return () => {
        active=false;clear()
        window.removeEventListener('message',receive)
        if(wakeTranslationQueue.current === pump) wakeTranslationQueue.current=null
        if(invalidateTranslationQueue.current === clear) invalidateTranslationQueue.current=null
      }
    }, [origin, visible, accountId])

    useEffect(() => {
      // Fail closed for PERSONA/CONTACT context, not for loading the inbox.
      // Never let an unrelated Work session masquerade as a contact Brain.
      sink.current.clearLegacyAdoption()
      sink.current.bindAdoptDraft?.(null)
      sink.current.onDeselected()
      if (!effectiveSource) return
      const verifiedSource = effectiveSource as VerifiedSelectionSource & {
        adoptDraft?: (accountRef: string, roomRef: string, text: string) => Promise<boolean>
      }
      if (typeof verifiedSource.adoptDraft === 'function') {
        sink.current.bindAdoptDraft?.((accountRef, roomRef, text) =>
          verifiedSource.adoptDraft!(accountRef, roomRef, text))
      }
      const dispose = effectiveSource.subscribe(contact => {
        // An export can never outlive its original account/room selection.
        if (contact?.accountRef !== exportScopeRef.current?.accountRef ||
            contact?.roomRef !== exportScopeRef.current?.roomRef) {
          exportEpoch.current++
          exportScopeRef.current = contact ? {...contact} : null
          setExportScope(contact ? {...contact} : null)
          setExportOpen(false)
          setExportBusy(false)
          setExportStatus('')
          setExportError('')
        }
        // Brain selection events are not the source of translation authority.
        // The translation queue independently resolves the exact current CW
        // conversation through original Host, so a transient deselect cannot
        // cancel a completed ChatGPT translation while the iframe stays open.
        verifiedTranslationScope.current = contact
        if (!contact) sink.current.onDeselected()
        else {
          sink.current.onSelected(contact.accountRef, contact.roomRef)
          wakeTranslationQueue.current?.()
        }
      })
      return () => { dispose(); sink.current.bindAdoptDraft?.(null); sink.current.onDeselected() }
    }, [effectiveSource])

    return <section
      data-yenra-chatwoot-seat="compatibility"
      data-contact-binding={effectiveSource ? 'awaiting-host-verified-context' : 'unavailable'}
      hidden={!visible} aria-hidden={!visible}
      ref={node => { if (node) node.inert = !visible }}
      style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', position: 'relative', height: '100%', minHeight: 0, minWidth: 0 }}>
      {exportOpen && exportScope && visible ? <div
        data-yenra-export-dialog="native-more-menu"
        style={{position:'absolute',inset:0,zIndex:40,display:'flex',
          alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.22)'}}>
        <div role="dialog" aria-modal="true" aria-label="导出聊天记录"
          style={{width:'min(340px,calc(100% - 32px))',padding:18,borderRadius:12,
            background:'var(--dsw-alias-bg-primary, #fff)',
            color:'var(--dsw-alias-label-primary, #222)',
            boxShadow:'0 12px 48px rgba(0,0,0,.24)',display:'flex',flexDirection:'column',gap:12}}>
          <strong>导出聊天记录</strong>
          <label htmlFor="yenra-chatlume-export-format">导出格式</label>
          <select id="yenra-chatlume-export-format" value={exportFormat}
            disabled={exportBusy || !exportVerified}
            onChange={event=>setExportFormat(event.target.value==='html'?'html':'zip')}>
            <option value="zip">HTML＋媒体 ZIP</option>
            <option value="html">仅 HTML（文字）</option>
          </select>
          {exportStatus ? <span role="status" style={{fontSize:12}}>{exportStatus}</span> : null}
          {exportError ? <span role="alert" style={{fontSize:12,color:'#c33'}}>
            {exportError}</span> : null}
          <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
            <button type="button" onClick={()=>{
              exportEpoch.current++;setExportBusy(false);setExportOpen(false);
              setExportVerified(false);setExportStatus('');setExportError('')
            }}>取消</button>
            <button type="button" disabled={exportBusy || !exportVerified}
              onClick={()=>{void startExport()}}>开始导出</button>
          </div>
        </div>
      </div> : null}
      {!effectiveSource ? <p role="status" style={{ margin: 0, padding: '4px 8px', fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)' }}>
        Chatwoot 原生收件箱；真人联系人脑绑定尚未接通（缺 selectionSource），不沿用旧联系人上下文。
      </p> : null}
      {origin && ssoLaunch?.key===ssoKey ? <iframe ref={frameRef}
        title="Chatwoot 原生收件箱" data-yenra-chatwoot-frame="compatibility"
        src={ssoLaunch.url}
        onLoad={() => { (effectiveSource as VerifiedSelectionSource & { reset?: () => void })?.reset?.() }}
        referrerPolicy="no-referrer"
        style={{ display: 'block', flex: '1 1 auto', width: '100%', minHeight: 0, border: 0 }}
      /> : origin && ssoError ? ssoAttempt<10 ? <p role="status">
        正在连接本机 Chatwoot，准备进入原生收件箱…
      </p> : <div role="alert" style={{ padding: 18 }}>
        本机 Chatwoot 服务暂不可用，未打开任何外部登录页面。
        <button type="button" onClick={()=>setSsoAttempt(n=>n+1)}>重试进入收件箱</button>
      </div> : <p role="status">{error || (snapshot.status === 'unavailable'
        ? '原生 Config 未暴露此插件 namespace；请核对 Settings/Inspect。'
        : origin?'正在验证本机主人身份，准备原生收件箱…':'正在读取持久化 Chatwoot origin…')}</p>}
    </section>
  }
}
