/**
 * YENRA V2 production-facing composition over the ONLY official DSH Desktop.
 * ChatScope owns social presentation; DSH owns Agent, Session, Conversation,
 * native Composer, Sidebar, theme and jobs. No fixture contacts, simulated
 * channel messages, demo sends, shadow database or private channel sessions.
 * Unconnected real social channels are intentionally empty.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useDrag } from '@use-gesture/react'
import v2Css from './v2-desktop.css?inline'
import { OssNativeSocial, warmOriginalMatureInbox } from './oss-native-social'
import { suggestionPrompt } from './advice-bridge'
import { installNativeReplyCards } from './native-reply-cards'
import { PersonaHeaderMenu } from './persona-header-menu'
import { ensureNativeYeonheeCore, revalidateNativePersonaBeforeGeneration } from './native-persona-core'
import { emitBrainTiming } from './brain-timing'
import PQueue from 'p-queue'
import { messageTranslationKey,previewTranslationKey,needsChineseTranslation,parseTranslationResult } from './social-translation-view'
import type {TranslationRequest} from './social-translation-view'
import {parseSocialResponse,parseSocialRoster,parseSocialRoom,parseFacebookResponse,parseFacebookRoster,parseFacebookRoom,socialKey,socialName,socialTime} from './social-readonly-view'
import type {SocialRoster,SocialRoom,SocialRoomSummary} from './social-readonly-view'
import { nativeConnectionsTab } from './native-connections-tab'
import { makeMetaAdsPanel } from './meta-ads-panel'
import { makeNativeMemoryPanel } from './native-memory-ui'
import { yenraBrandLockup } from './yenra-brand-lockup'
import { YenraWorkWelcome } from './yenra-work-welcome'
import { facebookBrandIcon, whatsAppBrandIcon } from './social-brand-icons'
// Reuse the original DSH icon artwork directly. No separate icon library.
import {
  IconCordisPluginOutlineMedium, IconDatabaseOutlineMedium, IconSettingsOutlineMedium,
  IconGoalOutlineMedium, IconBrowseOutlineMedium,
   IconSparkleMedium, IconCloseOutlineRegular, IconSearchOutlineRegular,
} from '../../../../upstream/official-source/packages/client/ui-primitives/src/icons/index'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '../../../../upstream/official-source/packages/client/ui-settings/src/client/contract/slots'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime, PropsRenderSlots, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'yenra.candidate.ai': { kind:'single'; scope:'session' }
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { yenraDesktopCandidate: unknown }
}
export const inject=['slots','uiConversation','layout','sessions','theme','sidebarRight','remote','remote.commands','remote.pluginManager','remote.pluginInventory','workspaces']
const logo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><rect width=\"1024\" height=\"1024\" rx=\"210\" fill=\"#fff\"/><path fill=\"#292b30\" fill-rule=\"evenodd\" d=\"M533,618 473,595 438,587 385,585 354,591 317,607 283,636 267,662 259,693 300,653 327,637 364,623 422,613 480,613Z M825,468 801,517 779,550 747,584 721,603 684,621 649,631 466,654 413,667 373,682 322,711 286,744 261,783 249,822 299,783 342,762 379,749 467,730 609,717 669,701 704,684 748,649 783,600 810,536Z M912,249 900,268 877,285 854,291 820,293 797,301 775,320 763,338 760,316 751,296 729,278 681,260 661,247 643,222 638,197 613,238 605,269 605,294 612,320 630,348 651,366 691,391 708,415 711,443 707,458 695,473 681,478 663,475 645,464 577,395 546,369 521,353 478,334 439,325 388,324 347,332 294,354 258,377 221,412 198,446 184,479 177,513 179,554 192,600 206,630 229,665 255,692 216,581 210,530 215,509 225,492 249,471 280,460 314,459 351,469 484,546 556,576 590,583 628,584 656,579 679,570 705,552 727,525 741,496 756,448 780,415 807,400 862,389 882,378 901,359 915,333 921,307 920,276Z M480,436 495,431 527,435 542,444 572,476 561,479 530,476Z\"/></svg>"
const logoUrl='data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logo)
const panelKey='yenra-desktop-chat'
const memoryPanelKey='yenra-memory-relations'
const scoutPanelKey='yenra-scout-market'
const metaPanelKey='yenra-meta-ads'
type PanelProps=Pick<PropsRuntime<'main'>,'useSessions'|'SessionProvider'> & PropsRenderSlots<'yenra.candidate.ai'> & {surfaceVisible?:boolean}
const samePath=(v:string|undefined)=>v?.replaceAll('\\','/').replace(/\/$/,'').toLowerCase()
const BRAIN_TITLE='YENRA · 闺蜜大脑'
// Transient presentation state only; DSH remains the sole message/session store.
type MemoryPanelTarget={sessionId?:SessionId;channel:'WhatsApp'|'Page'|'Personal';accountRef:string;roomRef:string}
const v2Transient={socialDraft:'',socialDraftByRoom:new Map<string,string>(),
  memoryTarget:null as MemoryPanelTarget|null}

/** The original ChatScope Conversation requires Avatar as a *direct* child.
 * Share the existing authenticated media URL, not a replacement Avatar wrapper. */
const socialAvatarUrl=(accountRef:string,roomRef:string)=>
  '/api/yenra/facebook-avatar?accountRef='+accountRef+'&roomRef='+roomRef

// Same scoped browser-preference persistence convention as DSH's native
// ConversationWidthControls. This stores only layout pixel preferences, never
// contact, message, account, or Session data.
const BRAIN_WIDTH_KEY='yenra.desktop.v2.brainWidth'
const BRAIN_DEFAULT=385
const CHAT_MIN_WIDTH=420
function savedPanelWidth(key:string,fallback:number,min:number,max:number){
  try{
    const raw=localStorage.getItem(key)
    if(raw===null)return fallback
    const width=Number(raw)
    return Number.isFinite(width)&&width>=min&&width<=max?width:fallback
  }catch{return fallback}
}
function commitPanelWidth(key:string,width:number){
  try{localStorage.setItem(key,String(width))}catch{}
}
function resetPanelWidth(key:string){
  try{localStorage.removeItem(key)}catch{}
}
const clampPanelWidth=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),max)

/** One thin DSH in-panel adapter. Pointer/touch gesture ownership belongs to
 * the mature @use-gesture/react library, not another YENRA drag engine.
 * Width-only UI preferences follow DSH's scoped browser preference pattern. */
function NativePanelGrip({side,width,min,max,onWidth,onCommit,onReset}:{
  side:'contact'|'brain'
  width:number
  min:number
  max:number
  onWidth:(value:number)=>void
  onCommit:(value:number)=>void
  onReset:()=>void
}){
  const startWidth=useRef(width)
  const [dragging,setDragging]=useState(false)
  const direction=side==='contact'?1:-1
  const bindDrag=useDrag(({first,last,active,movement:[dx]})=>{
    if(first)startWidth.current=width
    const next=clampPanelWidth(startWidth.current+dx*direction,min,max)
    if(active||last)onWidth(next)
    if(last&&dx!==0)onCommit(next)
    setDragging(active)
  },{axis:'x',pointer:{buttons:1,keys:false},filterTaps:true})
  return <div {...bindDrag()} role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={side==='contact'?'调整联系人栏宽度':'调整闺蜜大脑宽度'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    aria-valuetext={width+' 像素'} title="拖动调整宽度，双击恢复默认值"
    className={'v2-pane-grip v2-'+side+'-grip'} data-yenra-resize={side} data-dragging={dragging||undefined}
    onDoubleClick={event=>{event.preventDefault();onReset()}}
    onKeyDown={event=>{
      const delta=event.key==='ArrowRight'?12*direction:event.key==='ArrowLeft'?-12*direction:null
      const next=event.key==='Home'?min:event.key==='End'?max:delta===null?null:clampPanelWidth(width+delta,min,max)
      if(next===null)return
      event.preventDefault()
      onWidth(next)
      onCommit(next)
    }}
  />
}

function makeV2Panel(host:ClientContext){
  return function V2Panel({useSessions,SessionProvider,renderSlot,surfaceVisible=true}:PanelProps){
    const rootRef=useRef<HTMLDivElement|null>(null)
    const [chatwootSeat,setChatwootSeat]=useState<{Inbox:any}|null>(null)
    const [chatwootContact,setChatwootContact]=useState<{accountRef:string;roomRef:string}|null>(null)
    useEffect(()=>{
      const fiber=host.inject(['yenraChatwootEmbed'],(ctx:any)=>{
        setChatwootSeat({Inbox:ctx.yenraChatwootEmbed.Inbox})
        ctx.effect(()=>()=>setChatwootSeat(null))
      })
      return()=>{void fiber.dispose()}
    },[])
    const [workWidth,setWorkWidth]=useState(()=>window.innerWidth)
    useEffect(()=>{
      const node=rootRef.current
      if(!node)return
      // DSH native display scaling may apply zoom:0.9. ResizeObserver's
      // contentRect is *unzoomed* CSS pixels (e.g. 1280 while the visible
      // workspace is only 1152), so the brain drawer broke at 12–14" widths.
      // Use the true on-screen rectangle and re-evaluate on window resize.
      const measure=()=>setWorkWidth(Math.round(Math.min(
        window.innerWidth,node.getBoundingClientRect().width||window.innerWidth)))
      const observer=new ResizeObserver(measure)
      observer.observe(node)
      window.addEventListener('resize',measure)
      measure()
      return()=>{observer.disconnect();window.removeEventListener('resize',measure)}
    },[])
    // Selecting YENRA from native Work restores the compact V2 rail.
    // Never override a manual expansion while this panel remains mounted.
    useEffect(()=>{
      const raf=window.requestAnimationFrame(()=>{
        const frame=document.querySelector('[style*="grid-template-columns"]')
        if(window.innerWidth>=1024&&frame&&!frame.hasAttribute('data-sidebar-collapsed'))host.layout.toggleSidebar()
      })
      return()=>window.cancelAnimationFrame(raf)
    },[host])
    // Mature messaging-inbox already owns its own contact-list toggle.
    // Keep one YENRA copilot open preference; resize changes only presentation,
    // never collapses contacts, closes the brain, or mutates DSH Session state.
    const [brainOpen,setBrainOpen]=useState(()=>window.innerWidth>=1240)
    // Chat/Work are views of THIS native DSH main panel, not two panels that
    // unmount the mature social inbox and force a fresh four-second roster load.
    const [workspaceMode,setWorkspaceMode]=useState<'chat'|'work'>('chat')
    // Lazy, retained original Work Session view: only the very first Work
    // opening mounts the official DSH Conversation. Hot mode switches hide
    // the view instead of repeating its expensive transcript hydration.
    const [workVisited,setWorkVisited]=useState(false)
    // Work opens the native DSH Composer without changing the user's
    // preferred Chat Brain visibility when returning to the same inbox.
    const chatBrainOpenBeforeWork=useRef(brainOpen)
    // Native DSH Work/new-session navigation can temporarily hide this retained
    // Chat surface without unmounting it. When the user explicitly returns via
    // the native Chat panel, restore Chat mode as well as the Layout panel key.
    // Keep the original inbox mounted and preserve its contact/draft state.
    const wasSurfaceVisible=useRef(surfaceVisible)
    useLayoutEffect(()=>{
      const enteredChat=surfaceVisible&&!wasSurfaceVisible.current
      wasSurfaceVisible.current=surfaceVisible
      if(!enteredChat||workspaceMode!=='work')return
      setBrainOpen(chatBrainOpenBeforeWork.current)
      setWorkspaceMode('chat')
    },[surfaceVisible,workspaceMode])
    const [brainWidth,setBrainWidth]=useState(()=>savedPanelWidth(BRAIN_WIDTH_KEY,BRAIN_DEFAULT,300,520))
    const [filter,setFilter]=useState('全部')
    const [searchOpen,setSearchOpen]=useState(false)
    const [searchQuery,setSearchQuery]=useState('')
    const searchInputRef=useRef<HTMLInputElement|null>(null)
    const searchButtonRef=useRef<HTMLButtonElement|null>(null)
    useEffect(()=>{
      if(!searchOpen)return
      const raf=requestAnimationFrame(()=>searchInputRef.current?.focus())
      return ()=>cancelAnimationFrame(raf)
    },[searchOpen])
    const closeContactSearch=()=>{
      setSearchQuery('')
      setSearchOpen(false)
      requestAnimationFrame(()=>searchButtonRef.current?.focus())
    }
    // A historical DSH-IM inbox does not prove a live Socket or valid Sender.
    const [socialRoster,setSocialRoster]=useState<SocialRoster|null>(null)
    const [socialPhase,setSocialPhase]=useState<'checking'|'ready'|'unavailable'>('checking')
    const [socialError,setSocialError]=useState('')
    const connectedChannelFilters:ReadonlyArray<'Personal'|'Page'|'WhatsApp'>=
      (['Personal','Page','WhatsApp'] as const).filter(channel=>socialRoster?.accounts.some(account=>account.channel===channel))
    const [selectedSocial,setSelectedSocial]=useState<{accountRef:string;roomRef:string}|null>(null)
    const selectedSocialRef=useRef<{accountRef:string;roomRef:string}|null>(null)
    // Existing mature OSS owns human drafts; only keep its scoped imperative
    // prefill callback, never write advice into the retired ChatScope draft.
    const ossAdoptDraftRef=useRef<((accountRef:string,roomRef:string,text:string)=>boolean)|null>(null)
    useEffect(()=>{selectedSocialRef.current=selectedSocial},[selectedSocial])
    const [selectedRoom,setSelectedRoom]=useState<SocialRoom|null>(null)
    const [roomPhase,setRoomPhase]=useState<'idle'|'loading'|'ready'|'error'>('idle')
    const [roomError,setRoomError]=useState('')
    const [sendNotice,setSendNotice]=useState('')
    const [sendBusy,setSendBusy]=useState(false)
    const sendingRef=useRef(false)
    const rosterRequest=useRef(0)
    const roomRequest=useRef(0)
    const [socialDraft,setSocialDraft]=useState(()=>v2Transient.socialDraft)
    const socialDraftRef=useRef(socialDraft)
    const [draftBeforeTranslation,setDraftBeforeTranslation]=useState('')
    const [draftTranslationBusy,setDraftTranslationBusy]=useState(false)
    const [showChinese,setShowChinese]=useState(true)
    const [socialTranslations,setSocialTranslations]=useState<Record<string,string>>({})
    const [translationNotice,setTranslationNotice]=useState('')
    const [translationRetry,setTranslationRetry]=useState(0)
    const translationPending=useRef(new Set<string>())
    const translationFailed=useRef(new Set<string>())
    const translationQueue=useRef<PQueue|null>(null)
    if(!translationQueue.current)translationQueue.current=new PQueue({concurrency:1,intervalCap:3,interval:1000})
    const changeSocialDraft=(text:string)=>{
      socialDraftRef.current=text
      if(selectedSocial)v2Transient.socialDraftByRoom.set(socialKey(selectedSocial.accountRef,selectedSocial.roomRef),text)
      else v2Transient.socialDraft=text
      setSocialDraft(text)
    }
    const [socialFile,setSocialFile]=useState<File|null>(null)
    const [socialToolsOpen,setSocialToolsOpen]=useState(false)
    const showSocialTools=socialToolsOpen || socialDraft.trim().length>0 || Boolean(socialFile)
    // Reuse ChatScope's own attachment button as the compact '+' tools trigger.
    // Its internal SVG is presentation-only; supply an accessible name/state
    // without creating a second button or another Composer.
    useEffect(()=>{
      const trigger=rootRef.current?.querySelector<HTMLButtonElement>('.v2-social .cs-button--attachment')
      trigger?.setAttribute('aria-label','更多聊天工具')
      trigger?.setAttribute('title','展开或收起聊天工具')
      trigger?.setAttribute('aria-expanded',String(showSocialTools))
    },[showSocialTools])
    const fileInputRef=useRef<HTMLInputElement|null>(null)
    const [error,setError]=useState('')
    const [created,setCreated]=useState<SessionId|undefined>()
    const [reference,setReference]=useState<SessionReference|undefined>()
    const creating=useRef(false)
    const phase=useSessions(s=>s.phase)
    // Prefer this profile's EXISTING native Brain Session (history preserved).
    // New computers use the ORIGINAL DSH WorkspaceController, never the
    // developer's Documents path or a separately managed YENRA worktree.
    const existingOwnerCwd=useSessions(s=>s.ids.map(id=>s.byId[id])
      .find(row=>row?.title===BRAIN_TITLE&&typeof row.cwd==='string')?.cwd)
    const workspaceSnapshot=useSyncExternalStore(
      useCallback(notify=>host.workspaces.list.subscribe(notify),[host]),
      useCallback(()=>host.workspaces.list.getSnapshot(),[host]),
      useCallback(()=>host.workspaces.list.getSnapshot(),[host]),
    )
    const [firstUseWorkspace,setFirstUseWorkspace]=useState('')
    const CWD=existingOwnerCwd||workspaceSnapshot.items[0]?.path||firstUseWorkspace
    useEffect(()=>{
      if(phase!=='ready'||workspaceSnapshot.phase!=='ready'||CWD)return
      const controller=new AbortController()
      void host.workspaces.initializeDefault(controller.signal)
        .then(workspace=>{if(!controller.signal.aborted&&workspace?.path)
          setFirstUseWorkspace(workspace.path)})
        .catch(()=>{})
      return()=>controller.abort()
    },[host,phase,workspaceSnapshot.phase,CWD])
    // Do not bind to an arbitrary Work conversation (e.g. weather).
    const existingId=useSessions(s=>s.ids.find(id=>samePath(s.byId[id]?.cwd)===samePath(CWD)&&s.byId[id]?.title===BRAIN_TITLE))
    const sessionId=existingId??created
    // Reuse DSH's durable blank-session flag; never inspect or duplicate transcripts.
    const workSessionBlank=useSessions(s=>sessionId!==undefined&&Boolean(s.byId[sessionId]?.blank))
    const liveRef=reference?.sessionId===sessionId?reference:undefined
    // Same DSH engine, different native Session for each authenticated contact.
    // Keep the owner Session above for translations and the established Sender.
    // A native session ID is allocated by the Host, not made from contact hashes.
    // Official DSH session-title has an 80 UTF-8 byte limit. The previous
    // Chinese prefix plus two 32-char refs was 87 bytes and silently lost the
    // roomRef's last 7 chars. Keep both complete Host refs in 73 ASCII bytes.
    const brainKey=selectedSocial
      ? 'YENRA:B:'+selectedSocial.accountRef+':'+selectedSocial.roomRef
      : undefined
    // Existing native histories have the 80-byte truncated Chinese title.
    // Reopen ONLY when the currently authorized roster maps that legacy
    // prefix to exactly one real account/room, then rename the SAME Session.
    const legacyBrainTitle=selectedSocial
      ? 'YENRA · 闺蜜 · '+selectedSocial.accountRef+' · '+selectedSocial.roomRef.slice(0,25)
      : undefined
    const legacyTitleUnique=Boolean(legacyBrainTitle&&
      socialRoster?.accounts.flatMap(account=>account.rooms.map(room=>
        'YENRA · 闺蜜 · '+account.accountRef+' · '+room.roomRef.slice(0,25)))
        .filter(title=>title===legacyBrainTitle).length===1)
    // Old reloads may have created several native Sessions with the SAME
    // durable scoped title. Catalog order is not a continuity guarantee:
    // prefer a nonblank, history-rich official Session, then latest activity,
    // instead of an arbitrary duplicate that hides native rewrites.
    const listedBrainId=useSessions(s=>{
      if(!brainKey)return undefined
      // Official sessionStats is a Host projection of completed native turns.
      // A two-turn conversation with an adopted rewrite must outrank a newer
      // one-turn accidental reload duplicate, otherwise the edit is hidden.
      const turns=(id:SessionId)=>
        (s.byId[id]?.projectionValues as {sessionStats?:{turns:number}}|undefined)
          ?.sessionStats?.turns??0
      return s.ids.filter(id=>
        samePath(s.byId[id]?.cwd)===samePath(CWD)&&
        (s.byId[id]?.title===brainKey||
         (legacyTitleUnique&&s.byId[id]?.title===legacyBrainTitle)))
        .sort((a,b)=>Number(Boolean(s.byId[a]?.blank))-Number(Boolean(s.byId[b]?.blank))||
          turns(b)-turns(a)||(s.byId[b]?.updatedAt??0)-(s.byId[a]?.updatedAt??0))[0]
    })
    const [brainCreated,setBrainCreated]=useState<Record<string,SessionId>>({})
    const [brainReference,setBrainReference]=useState<SessionReference|undefined>()
    const brainCreating=useRef(new Set<string>())
    // Only Sessions allocated by THIS creation path may receive a default pick.
    // An old Session with an evicted pick must not silently lose owner intent.
    const newBrainSessions=useRef(new Set<SessionId>())
    const brainSessionId=brainKey?(listedBrainId??brainCreated[brainKey]):undefined
    const brainLiveRef=brainReference?.sessionId===brainSessionId?brainReference:undefined
    // An archived DSH Session blocks all model steps without any provider call.
    // The verified original Session is resumed through the already-loaded
    // official remote.workspace API, not a second Service or new Session.
    const [brainRestored,setBrainRestored]=useState<{key:string;id:SessionId}|null>(null)
    // Reuse the same original WorkspaceController snapshot for archive state.
    const workspaceUnarchiveFlights=useRef(new Map<SessionId,Promise<void>>())
    const brainArchived=Boolean(brainLiveRef&&
      (brainRestored?.id!==brainLiveRef.sessionId||brainRestored.key!==brainKey))
    const brainHasCanonicalTitle=useSessions(s=>
      Boolean(brainSessionId&&s.byId[brainSessionId]?.title===brainKey))
    const adviceRequested=useRef(new Set<string>())
    const adoptNoticeSeq=useRef(0)
    // The official Chat turn-tail Slot can adopt text only for the currently
    // selected authenticated contact. It never invokes a channel Sender.
    useEffect(()=>{
      const onAdopt=(event:Event)=>{
        const details=(event as CustomEvent<{sessionId:string;text:string}>).detail
        if(!details||typeof details.text!=='string'||!details.text.trim()||
          details.text.length>2000||!selectedSocial||!brainLiveRef||
          brainLiveRef.sessionId!==details.sessionId)return
        if(selectedSocialRef.current?.accountRef!==selectedSocial.accountRef||
          selectedSocialRef.current?.roomRef!==selectedSocial.roomRef)return
        const accepted=ossAdoptDraftRef.current?.(
          selectedSocial.accountRef,selectedSocial.roomRef,details.text.trim())===true
        setSendNotice(accepted
          ?'已采用为当前联系人草稿，尚未发送；正在记下本次选择'
          :'当前联系人原生草稿暂不可用，没有发送')
        if(!accepted)return
        // A real, explicit "采用" action is positive choice evidence, but
        // never a platform send. Reuse the SAME official DSH Session and
        // MemoryService; the Host may write ONLY after verifying its scope.
        // selectedSocial stores ONLY accountRef and roomRef. Its .channel is
        // undefined and was silently dropped by JSON.stringify, so Host
        // correctly refused every adopted-draft memory bind. Resolve channel
        // from the same original authenticated roster as the Memory panel.
        const trustedAccount=socialRoster?.accounts.find(account=>
          account.accountRef===selectedSocial.accountRef&&
          account.rooms.some(room=>room.roomRef===selectedSocial.roomRef))
        if(!trustedAccount){
          setSendNotice('已采用为草稿，尚未发送；当前账号或联系人未通过原 Host 名册核验，未记入长期记忆')
          return
        }
        const exact={kind:'contact' as const,channel:trustedAccount.channel,
          accountRef:selectedSocial.accountRef,roomRef:selectedSocial.roomRef}
        const exactSession=brainLiveRef.sessionId
        const noticeSeq=++adoptNoticeSeq.current
        const stillOnContact=()=>adoptNoticeSeq.current===noticeSeq&&
          selectedSocialRef.current?.accountRef===exact.accountRef&&
          selectedSocialRef.current?.roomRef===exact.roomRef
        void (async()=>{
          const proof=await host.remote.commands.execute(exactSession,
            '/yenra-memory-bind '+JSON.stringify(exact),[])
          if(!proof.ok)throw new Error('记忆身份绑定命令连接失败')
          if(proof.value?.result.kind!=='success')
            throw new Error('记忆身份校验失败：'+(proof.value?.result.text??'未得到原 Host 确认').slice(0,110))
          const recorded=await host.remote.commands.execute(exactSession,
            '/yenra-memory-adopt '+JSON.stringify({text:details.text.trim()}),[])
          if(!recorded.ok)throw new Error('采用记忆命令连接失败')
          if(recorded.value?.result.kind!=='success')
            throw new Error('采用记忆保存失败：'+(recorded.value?.result.text??'未得到持久化确认').slice(0,110))
          if(stillOnContact())setSendNotice('已采用为草稿，且已记下本次选择；尚未发送')
        })().catch((reason:unknown)=>{
          const problem=reason instanceof Error?reason.message:'原生记忆命令执行失败'
          // Only bounded, original Host-authored failure text is ever shown:
          // never echo Session IDs, credentials, arbitrary provider payloads.
          const safe=/^(记忆身份绑定命令连接失败|采用记忆命令连接失败|记忆身份校验失败|采用记忆保存失败)/.test(problem)
            ?problem.slice(0,120):'原生记忆服务暂不可用'
          if(stillOnContact())setSendNotice('已采用为草稿，尚未发送；未记入长期记忆（'+safe+'）')
        })
      }
      document.addEventListener('yenra-brain-adopt',onAdopt)
      return()=>document.removeEventListener('yenra-brain-adopt',onAdopt)
    },[host,selectedSocial,brainLiveRef,socialRoster])

    // Passive inbox navigation must NOT execute slash Commands against the
    // interactive Brain Session. Use existing authenticated Host read projections.
    // Only an explicit user send continues through the original native Sender.
    const nativeReadQuery=(arg:string)=>{
      const refs:unknown=JSON.parse(arg)
      if(!refs||typeof refs!=='object'||Array.isArray(refs))throw Error('会话引用无效')
      const v=refs as Record<string,unknown>
      if(typeof v.accountRef!=='string'||typeof v.roomRef!=='string'||
        !/^[a-f0-9]{32}$/.test(v.accountRef)||!/^[a-f0-9]{32}$/.test(v.roomRef))
        throw Error('会话引用必须由当前 Host 生成')
      return '?accountRef='+encodeURIComponent(v.accountRef)+'&roomRef='+encodeURIComponent(v.roomRef)
    }
    const hostRead=async(url:string)=>{
      const response=await fetch(url,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(35000)})
      let payload:{ok?:boolean;text?:string;error?:string;reason?:string}
      try{payload=await response.json() as typeof payload}
      catch{throw Error('原生社交只读接口返回无效数据')}
      if(!response.ok||payload.ok!==true||typeof payload.text!=='string'){
        // The existing authenticated Page Host sanitizes its provider error
        // into a stable reason. A genuine upstream 429 is not a generic 503.
        // Never return a raw SDK error, token, room ID or contact detail.
        if(payload.error==='NATIVE_FACEBOOK_ROOM_UNAVAILABLE'&&
           payload.reason==='PAGE_PROVIDER_RATE_LIMITED')
          throw Error('PAGE_PROVIDER_RATE_LIMITED')
        // Preserve the original Host's allowlisted provider-store timeout.
        // The mature TanStack Query distinguishes a transient 30s retry
        // from a genuine Page 429 (10min). Never expose raw SDK messages.
        if(payload.error==='NATIVE_FACEBOOK_ROOM_UNAVAILABLE'&&
           payload.reason==='ACCOUNT_STORE_TIMEOUT')
          throw Error('ACCOUNT_STORE_TIMEOUT')
        throw Error(payload.error||'原生社交只读接口暂不可用（HTTP '+response.status+'）')
      }
      return payload.text
    }
    const nativeSocialCommand=useCallback(async(name:'yenra-social-roster'|'yenra-social-room',arg='')=>{
      const uri=name==='yenra-social-roster'?'/api/yenra/social-read?mode=roster':
        '/api/yenra/social-read?mode=room&'+nativeReadQuery(arg).slice(1)
      return parseSocialResponse(await hostRead(uri))
    },[])
    const nativeFacebookCommand=useCallback(async(name:'yenra-facebook-roster'|'yenra-facebook-room',arg='')=>{
      const uri=name==='yenra-facebook-roster'?'/api/yenra/facebook-roster':
        '/api/yenra/facebook-room'+nativeReadQuery(arg)
      return parseFacebookResponse(await hostRead(uri))
    },[])
    // Original DSH Commands + Codex + Storage Domain are the only translation
    // engine and persistence. A changed room never cancels a valid result.
    const translateNative=useCallback(async(request:TranslationRequest)=>{
      if(!sessionId)throw Error('主人 DSH Session 尚未加载')
      // The existing official DSH Host WebServer route is display-only.
      // Do NOT use slash Commands: their results become Session log entries.
      const response=await fetch('/api/yenra/translate',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({...request,sessionId}),
      })
      let data:{ok?:boolean;text?:string;error?:string}
      try{data=await response.json() as typeof data}catch{throw Error('原生翻译接口返回无效数据')}
      if(!response.ok||data.ok!==true)throw Error(data.error||'原生 DSH 翻译接口不可用')
      return parseTranslationResult(data.text,request)
    },[sessionId])
    // Original DSH Storage Domain display cache is shown FIRST.
    // One normal Host refresh follows asynchronously, and any failed channel
    // retains its last verified avatar/name/room entries. Never erase Page
    // because a single SDK/DPAPI request returned partial or 429.
    const refreshSocialRoster=useCallback(async(refreshLive=true)=>{
      // A cache-only DSH connection/reset must not cancel the one already
      // running original source refresh. Keep the same request generation;
      // only a new source refresh or panel disposal supersedes it.
      const request=refreshLive?++rosterRequest.current:rosterRequest.current
      const get=async(uri:string)=>{
        const res=await fetch(uri,{cache:'no-store',
          signal:AbortSignal.timeout(uri==='/api/yenra/oss-roster'?4000:35000)})
        const data=await res.json() as {ok:boolean;roster?:SocialRoster&{failures?:string[]};error?:string}
        if(!res.ok||data.ok!==true||!data.roster)throw Error(data.error??'原生账号展示缓存暂不可用')
        return data.roster
      }
      const apply=(incoming:SocialRoster&{failures?:string[]})=>{
        if(request!==rosterRequest.current||!Array.isArray(incoming.accounts))return
        setSocialRoster(previous=>{
          // A slow cache-only reply must never roll back the more recent
          // verified original Host roster or its Matrix contact preferences.
          const incomingTime=(incoming as typeof incoming&{lastVerifiedAt?:string|null}).lastVerifiedAt
          const previousTime=(previous as typeof incoming|null)?.lastVerifiedAt
          if(previousTime&&incomingTime&&Date.parse(incomingTime)<Date.parse(previousTime))
            return previous
          const map=new Map<string,any>()
          const id=(a:any)=>a.displayId??a.accountRef
          for(const account of previous?.accounts??[])map.set(id(account),account)
          for(const account of incoming.accounts)map.set(id(account),account)
          return {...incoming,accounts:[...map.values()]} as SocialRoster
        })
        if(incoming.accounts.length)setSocialPhase('ready')
        setSocialError((incoming.failures??[]).join('；'))
      }
      try{
        const cached=await get('/api/yenra/oss-roster')
        apply(cached)
      }catch{/* An empty first-run cache only delays the first legitimate read. */}
      if(!refreshLive||request!==rosterRequest.current)return
      try{
        const latest=await get('/api/yenra/oss-roster?refresh=1')
        apply(latest)
      }catch(e){
        if(request!==rosterRequest.current)return
        setSocialPhase(phase=>phase==='ready'?'ready':'unavailable')
        setSocialError('原渠道暂时不可用，保留已验证账号与联系人：'+String(e).slice(0,110))
      }
    },[])
    useEffect(()=>{void refreshSocialRoster();return()=>{rosterRequest.current++;roomRequest.current++}},[refreshSocialRoster])
    useEffect(()=>host.on('connection/reset',()=>{void refreshSocialRoster(false)}),[host,refreshSocialRoster])
    // Same original mature Page roster source; bounded fallback for external
    // webhook deliveries missed by the provider. No second SDK/DB/Sender.
    useEffect(()=>{
      let disposed=false,running=false
      const reconcile=()=>{
        if(disposed||running)return
        running=true
        void Promise.resolve(refreshSocialRoster(true)).catch(()=>{}).finally(()=>{running=false})
      }
      const timer=setInterval(reconcile,90000)
      return()=>{disposed=true;clearInterval(timer)}
    },[refreshSocialRoster])
    const selectSocialRoom=useCallback(async(accountRef:string,roomRef:string)=>{
      const account=socialRoster?.accounts.find(a=>a.accountRef===accountRef)
      if(!account?.rooms.some(r=>r.roomRef===roomRef))return
      if(selectedSocial)
        v2Transient.socialDraftByRoom.set(socialKey(selectedSocial.accountRef,selectedSocial.roomRef),socialDraft)
      else v2Transient.socialDraft=socialDraft
      selectedSocialRef.current={accountRef,roomRef}
      setSelectedSocial({accountRef,roomRef})
      const nextDraft=v2Transient.socialDraftByRoom.get(socialKey(accountRef,roomRef))??''
      socialDraftRef.current=nextDraft
      setSocialDraft(nextDraft);setDraftBeforeTranslation('')
      setSelectedRoom(null);setRoomPhase('loading');setRoomError('')
      const request=++roomRequest.current
      try{
        const args=JSON.stringify({accountRef,roomRef})
        const payload=account.channel==='WhatsApp'
          ?await nativeSocialCommand('yenra-social-room',args)
          :await nativeFacebookCommand('yenra-facebook-room',args)
        const verified=account.channel==='WhatsApp'
          ?parseSocialRoom(payload,accountRef,roomRef):parseFacebookRoom(payload,accountRef,roomRef)
        if(request!==roomRequest.current)return
        setSelectedRoom(verified);setRoomPhase('ready')
      }catch(e){
        if(request!==roomRequest.current)return
        setSelectedRoom(null);setRoomPhase('error')
        setRoomError(e instanceof Error?e.message:String(e))
      }
    },[socialRoster,selectedSocial,socialDraft,nativeSocialCommand,nativeFacebookCommand])
    useEffect(()=>{
      if(!chatwootContact||!chatwootSeat)return
      const {accountRef,roomRef}=chatwootContact
      if(selectedSocialRef.current?.accountRef===accountRef&&selectedSocialRef.current?.roomRef===roomRef)return
      const account=socialRoster?.accounts.find(a=>a.accountRef===accountRef)
      if(account?.rooms.some(r=>r.roomRef===roomRef))void selectSocialRoom(accountRef,roomRef)
    },[chatwootContact,chatwootSeat,socialRoster])
    const sendManualSocial=useCallback(async()=>{
      if(sendingRef.current)return
      if(!selectedSocial||!socialRoster?.accounts.some(a=>a.accountRef===selectedSocial.accountRef&&
        a.rooms.some(r=>r.roomRef===selectedSocial.roomRef))){
        setSendNotice('请先选择真实账号中的联系人');return
      }
      const text=socialDraft.trim()
      if(!text){setSendNotice('请输入消息内容');return}
      if(!sessionId){setSendNotice('原生主人 Session 尚未加载');return}
      const selectedAccount=socialRoster.accounts.find(a=>a.accountRef===selectedSocial.accountRef)
      if(!selectedAccount){setSendNotice('原生账号已变化，请刷新联系人');return}
      sendingRef.current=true;setSendBusy(true);setSendNotice('正在通过 '+selectedAccount.channel+' 成熟原生 Sender 发送…')
      const {accountRef,roomRef}=selectedSocial
      const sentKey=socialKey(accountRef,roomRef)
      try{
        const response=await fetch('/api/yenra/social-text-send',{
          method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
          body:JSON.stringify({channel:selectedAccount.channel,sessionId,accountRef,roomRef,text})
        })
        const payload=await response.json() as {
          ok?:boolean;error?:string;receipt?:unknown
        }
        if(!response.ok||payload.ok!==true)
          throw Error(payload.error??'原生 Sender 未确认提交，原稿保留')
        const result:unknown=payload.receipt
        if(!result||typeof result!=='object')throw Error('原生发送回执无效')
        const receipt=result as Record<string,unknown>
        if(receipt.sent!==true||receipt.submitted!==true||
          receipt.accountRef!==accountRef||receipt.roomRef!==roomRef)
          throw Error('原生 Sender 未确认对应的账号和会话')
        setSendNotice(selectedAccount.channel+' 已提交；送达及已读状态等待渠道可信回执')
        if(v2Transient.socialDraftByRoom.get(sentKey)?.trim()===text)
          v2Transient.socialDraftByRoom.delete(sentKey)
        // Clear only the draft that was submitted, never the draft of a newly
        // selected person (the user may switch while the network is working).
        if(selectedSocialRef.current?.accountRef===accountRef&&
          selectedSocialRef.current.roomRef===roomRef)
          setSocialDraft(currentText=>{
            if(currentText.trim()!==text)return currentText
            socialDraftRef.current=''
            return ''
          })
        // Refresh the REAL provider timeline without creating a fake outgoing bubble.
        // A failed read must not turn a provider-accepted send into an error.
        const currentRoomEpoch=roomRequest.current
        void (async()=>{
          try{
            const args=JSON.stringify({accountRef,roomRef})
            const value=selectedAccount.channel==='WhatsApp'
              ?await nativeSocialCommand('yenra-social-room',args)
              :await nativeFacebookCommand('yenra-facebook-room',args)
            const refreshed=selectedAccount.channel==='WhatsApp'
              ?parseSocialRoom(value,accountRef,roomRef)
              :parseFacebookRoom(value,accountRef,roomRef)
            if(roomRequest.current===currentRoomEpoch&&
              selectedSocialRef.current?.accountRef===accountRef&&
              selectedSocialRef.current.roomRef===roomRef)setSelectedRoom(refreshed)
          }catch{/* Network read failed: keep accepted status, use existing refresh button. */}
        })()
      }catch(e){
        setSendNotice('发送未确认，原稿保留：'+(e instanceof Error?e.message:String(e)))
      }finally{
        sendingRef.current=false;setSendBusy(false)
      }
    },[host,sessionId,selectedSocial,socialRoster,socialDraft,nativeSocialCommand,nativeFacebookCommand])
    // Native DSH Commands run on the original authenticated Owner Session.
    // Matrix access tokens and true Page/native-room bindings stay Host-only.
    // Right-click merely asks for the existing 4 preferences; no Page roster
    // refresh or independent permission prompt is introduced.
    const contactPrefCommand=async(
      kind:'read'|'save'|'name-save'|'remove'|'resync',payload:Record<string,unknown>
    ):Promise<any>=>{
      if(!sessionId)throw Error('原生 DSH 主人会话尚未就绪')
      const channel=socialRoster?.accounts.find(a=>a.accountRef===payload.accountRef)?.channel
      if(!channel)throw Error('账号引用已变化，请刷新联系人')
      const whatsapp=channel==='WhatsApp'
      const command=whatsapp&&kind==='name-save'?'yenra-whatsapp-contact-name-save':
        whatsapp&&kind==='remove'?'yenra-whatsapp-contact-remove':
        whatsapp&&kind==='resync'?'yenra-whatsapp-contact-resync':
        (whatsapp?'yenra-whatsapp-contact-prefs-':'yenra-facebook-contact-prefs-')+kind
      const result=await host.remote.commands.execute(sessionId,
        '/'+command+' '+JSON.stringify(payload),[])
      if(!result.ok)throw Error(result.error.message)
      if(!result.value||result.value.result.kind!=='success')
        throw Error(result.value?.result?.text??'原生联系人偏好暂不可用')
      const raw=result.value.result.text
      const prefix=whatsapp?'YENRA_WA_PREFS_V1:':'YENRA_FB_PREFS_V1:'
      if(!raw.startsWith(prefix))throw Error('原生联系人偏好回执不完整')
      const data=JSON.parse(raw.slice(prefix.length))
      if(data?.accountRef!==payload.accountRef||
        (kind!=='resync'&&data?.roomRef!==payload.roomRef)||data.ok!==true)throw Error('原生联系人偏好账号或会话回执不匹配')
      return data
    }
    const createWhatsAppContact=async(accountRef:string,phoneNumber:string,displayName:string)=>{
      if(!sessionId)throw Error('原生 DSH 主人会话尚未就绪')
      if(socialRoster?.accounts.find(a=>a.accountRef===accountRef)?.channel!=='WhatsApp')
        throw Error('请选择已连接的 WhatsApp 账号')
      const result=await host.remote.commands.execute(sessionId,
        '/yenra-whatsapp-contact-create '+JSON.stringify({accountRef,phoneNumber,displayName}),[])
      if(!result.ok)throw Error(result.error.message)
      const reply=result.value?.result
      if(!reply||reply.kind!=='success')throw Error(reply?.text??'联系人保存未确认')
      const prefix='YENRA_WA_PREFS_V1:'
      if(!reply.text.startsWith(prefix))throw Error('联系人保存回执不完整')
      const data=JSON.parse(reply.text.slice(prefix.length))
      if(data.ok!==true||data.saved!==true||data.accountRef!==accountRef||
         data.phoneNumber!==phoneNumber||data.displayName!==displayName||
         !/^[a-f0-9]{32}$/.test(String(data.roomRef)))
        throw Error('联系人保存回执账号或号码不匹配')
      return data as {ok:true;saved:true;accountRef:string;roomRef:string;phoneNumber:string;displayName:string}
    }
    const matchingSocial=(accountRef:string,room:SocialRoomSummary)=>{
      const q=searchQuery.trim().toLocaleLowerCase()
      return !q||socialName(room).toLocaleLowerCase().includes(q)||
        (room.latestText??'').toLocaleLowerCase().includes(q)||accountRef.slice(0,6).includes(q)
    }
    const activeAccount=socialRoster?.accounts.find(a=>a.accountRef===selectedSocial?.accountRef)
    const activeSummary=activeAccount?.rooms.find(r=>r.roomRef===selectedSocial?.roomRef)
    const activeAccountOrdinal=activeAccount?socialRoster!.accounts.indexOf(activeAccount)+1:0
    const selectedLabel=activeSummary?socialName(activeSummary):''
    useEffect(()=>{
      // Keep selected contact intent even while its native Session is loading;
      // never fall back to displaying owner records for a loading contact.
      const valid=selectedSocial&&activeAccount
      v2Transient.memoryTarget=valid?{sessionId:brainSessionId,
        channel:activeAccount.channel,accountRef:selectedSocial.accountRef,
        roomRef:selectedSocial.roomRef}:null
    },[brainSessionId,selectedSocial?.accountRef,selectedSocial?.roomRef,
      activeAccount?.channel,selectedRoom?.accountRef,selectedRoom?.roomRef,roomPhase])
    // Retired ChatScope auto-translation queue removed: mature OSS only reuses trusted W25/DSH translations. 
    // Older contact history / missing translations never block normal chat or trigger unused model requests.
    // Contact previews only use previously returned translations. Never
    // schedule hundreds of missing preview requests while a chat is active.
    // Any idle backfill belongs to an explicitly installed native DSH Job.

    const translateDraft=async()=>{
      if(!selectedSocial||!socialDraft.trim()||draftTranslationBusy)return
      const raw=socialDraft.trim()
      const scope={...selectedSocial}
      setDraftTranslationBusy(true);setTranslationNotice('ChatGPT 正在把输入草稿翻译成自然德语…')
      try{
        const request:TranslationRequest={channel:activeAccount?.channel??'WhatsApp',accountRef:scope.accountRef,
          roomRef:scope.roomRef,direction:'to-de',items:[{id:'draft',text:raw}]}
        const response=await translationQueue.current!.add(()=>translateNative(request),{priority:20})
        const translated=response?.items[0]?.translation
        if(!translated)throw Error('模型没有返回德语草稿')
        if(selectedSocialRef.current?.accountRef===scope.accountRef&&
           selectedSocialRef.current.roomRef===scope.roomRef&&socialDraftRef.current.trim()===raw){
          setDraftBeforeTranslation(raw)
          changeSocialDraft(translated)
          setTranslationNotice('德语草稿已生成，尚未发送。可恢复原稿。')
        }
      }catch(error){
        setTranslationNotice('德语翻译失败，原稿保留：'+(error instanceof Error?error.message:String(error)))
      }finally{setDraftTranslationBusy(false)}
    }
    const historyPresent=Boolean(socialRoster?.accounts.some(a=>a.rooms.length))
    const visibleAccountCount=socialRoster?.accounts.length??0
    const socialDataState=socialPhase==='ready'?(historyPresent?'readonly-history':'configured-empty'):'unconnected'

    // A single official DSH YENRA project session for user-initiated Brain
    // conversation; NEVER create an agent/session for fabricated contacts.
    useEffect(()=>{
      if(phase!=='ready'||!CWD||sessionId||creating.current)return
      creating.current=true
      void host.sessions.create({cwd:CWD}).then(id=>{setCreated(id);setError('')})
        .catch(e=>{creating.current=false;setError('原生 DSH 会话暂不可用：'+String(e))})
    },[host,brainOpen,phase,sessionId,CWD])
    useEffect(()=>{
      if(!sessionId)return
      const ref=host.sessions.retain(sessionId,{source:'yenraDesktopCandidate'})
      setReference(ref)
      return ()=>{ref.release()}
    },[host,sessionId])
    useEffect(()=>{
      if(!reference||!sessionId||reference.sessionId!==sessionId)return
      let active=true
      void reference.ready.then(async binding=>{
        if(existingId!==sessionId){
          const renamed=await binding.session.rename(BRAIN_TITLE)
          if(!renamed.ok)throw Error(renamed.error.message)
        }
        if(!active)return
        // Do not run memory-bind on chat/session open: the installed mature
        // memory .1 has no trusted per-Session bindVerifiedScope capability.
        // Command failures are native DSH transcript turns with no assistant
        // answer; use explicit Memory panel actions only, fail-closed.
      }).catch(reason=>{if(active&&existingId!==sessionId)
        setError('DSH 会话初始化失败：'+String(reason))})
      return()=>{active=false}
    },[host,reference,sessionId,existingId])

    // Bind ONLY the selected verified contact to the existing DSH native
    // Conversation/Composer. No second UI, model gateway or Sender.
    useEffect(()=>{
      if(!brainOpen||phase!=='ready'||!CWD||!brainKey||brainSessionId||brainCreating.current.has(brainKey))return
      brainCreating.current.add(brainKey)
      void host.sessions.create({cwd:CWD})
        .then(id=>{
          // The Cordis ClientContext service unwraps the lower-level RPC.
          // Its public create() resolves to a native SessionId directly.
          if(typeof id!=='string'||!id.startsWith('session-'))
            throw Error('DSH Session.create 未返回原生会话 ID')
          newBrainSessions.current.add(id)
          setBrainCreated(old=>({...old,[brainKey]:id}))
        })
        .catch(e=>setError('联系人闺蜜会话打开失败：'+String(e)))
        .finally(()=>brainCreating.current.delete(brainKey))
    },[host,brainOpen,phase,brainKey,brainSessionId,CWD])
    useEffect(()=>{
      if(!brainSessionId)return
      const ref=host.sessions.retain(brainSessionId,{source:'yenraDesktopCandidate'})
      setBrainReference(ref)
      return()=>{ref.release();setBrainReference(undefined)}
    },[host,brainSessionId])
    // Contact-scoped formatting and dynamic CCv3 Lore are selected by the
    // durable native Session title. Serialize first advice behind the official
    // rename result; independent .ready callbacks raced on initial open.
    const brainNamed=useRef(new Map<SessionId,Promise<void>>())
    const [personaSelectionRevision,setPersonaSelectionRevision]=useState(0)
    useEffect(()=>{
      const onSelection=(event:Event)=>{
        const id=(event as CustomEvent<{sessionId?:string}>).detail?.sessionId
        if(!brainSessionId||id!==brainSessionId)return
        // Explicit reselection can recover a previously evicted/blocked pick.
        // Ordinary revalidation notifications must not reset the Brain view.
        brainNamed.current.delete(brainSessionId)
        setBrainRestored(null)
        setPersonaSelectionRevision(value=>value+1)
      }
      window.addEventListener('yenra-persona-selection-changed',onSelection)
      return()=>window.removeEventListener('yenra-persona-selection-changed',onSelection)
    },[brainSessionId])
    useEffect(()=>{
      if(!brainLiveRef||!brainKey||brainNamed.current.has(brainLiveRef.sessionId))return
      const ref=brainLiveRef
      let namingActive=true
      const naming=ref.ready.then(async binding=>{
        emitBrainTiming(ref.sessionId,'session-ready')
        // Preserve the native Session and all edits. A matched legacy
        // 80-byte title is upgraded in-place to the 73-byte full-identity key.
        if(!brainHasCanonicalTitle){
          const result=await binding.session.rename(brainKey)
          if(!result.ok)throw Error(result.error.message)
        }
        // Official dsh-persona-dafeiyu Session pick must be committed BEFORE
        // the first native model prompt (including automatic suggestions).
        await ensureNativeYeonheeCore(ref.sessionId,CWD,{allowDefault:newBrainSessions.current.has(ref.sessionId)})
        newBrainSessions.current.delete(ref.sessionId)
        emitBrainTiming(ref.sessionId,'persona-ready')
      })
      brainNamed.current.set(ref.sessionId,naming)
      void naming.catch(e=>{
        // A late failure from an older initialization must not delete a newer
        // owner-reselection attempt or overwrite its visible state.
        if(brainNamed.current.get(ref.sessionId)!==naming)return
        brainNamed.current.delete(ref.sessionId)
        if(namingActive)setError('联系人闺蜜会话人格初始化失败：'+String(e))
      })
      return()=>{namingActive=false}
    },[brainLiveRef,brainKey,brainHasCanonicalTitle,CWD,personaSelectionRevision])
    // The existing official DSH Workspace controller already publishes the
    // Host-authoritative archive set and unarchive operation. Call it ONLY for
    // archived native Sessions. Never issue a chat Command on every contact
    // selection: those commands were rendered as noisy transcript turns.
    const verifiedBrainAccount=selectedSocial?socialRoster?.accounts.find(account=>
      account.accountRef===selectedSocial.accountRef&&
      account.rooms.some(room=>room.roomRef===selectedSocial.roomRef)):undefined
    useEffect(()=>{
      if(!brainOpen||!brainLiveRef||!brainKey||!selectedSocial||!verifiedBrainAccount||
         workspaceSnapshot.phase!=='ready')return
      const id=brainLiveRef.sessionId,key=brainKey
      const naming=brainNamed.current.get(id)
      if(!naming)return
      let live=true
      setBrainRestored(previous=>previous?.id===id&&previous.key===key?previous:null)
      void naming.then(async()=>{
        if(workspaceSnapshot.archivedSessionIds.includes(id)){
          let flight=workspaceUnarchiveFlights.current.get(id)
          if(!flight){
            flight=host.workspaces.unarchiveSession(id)
            workspaceUnarchiveFlights.current.set(id,flight)
            const tracked=flight
            void tracked.finally(()=>{
              if(workspaceUnarchiveFlights.current.get(id)===tracked)
                workspaceUnarchiveFlights.current.delete(id)
            }).catch(()=>undefined)
          }
          await flight
        }
        if(live){setError('');setBrainRestored({id,key})}
      }).catch(reason=>{if(live)setError('原生闺蜜会话恢复失败：'+String(reason))})
      return()=>{live=false}
    },[host,brainOpen,brainLiveRef?.sessionId,brainKey,
      selectedSocial?.accountRef,selectedSocial?.roomRef,verifiedBrainAccount?.channel,
      workspaceSnapshot.phase,workspaceSnapshot.archivedSessionIds,personaSelectionRevision])
    // No automatic yenra-memory-bind command on contact selection.
    // Mature @guntur-d/dsh-memory .1 remains owner-CWD scoped, so binding
    // cannot succeed and creates empty red command turns in native Brain.
    // The explicit Memory panel still checks trusted Host scope and fails
    // closed; ordinary social advice and freeform Brain chat remain available.
    // The initial three suggestions are one ordinary native DSH prompt and
    // one assistant answer in the SAME transcript used for follow-up edits.
    // Reuse the tested suggestionPrompt, never a shadow chat/suggestion store.
    useEffect(()=>{
      if(!surfaceVisible||workspaceMode!=='chat'||!brainOpen||brainArchived||!brainLiveRef||!selectedSocial||!selectedRoom||
        !activeAccount||roomPhase!=='ready'||selectedRoom.accountRef!==selectedSocial.accountRef||
        selectedRoom.roomRef!==selectedSocial.roomRef)return
      const latest=selectedRoom.messages.at(-1)
      if(!latest||latest.direction!=='INBOUND'||
        (!latest.text.trim()&&!latest.mediaContext?.trim()))return
      const targetKey=socialKey(selectedSocial.accountRef,selectedSocial.roomRef)
      const requestKey=targetKey+':'+latest.mid
      if(adviceRequested.current.has(requestKey))return
      adviceRequested.current.add(requestKey)
      const readyAt=performance.now()
      emitBrainTiming(brainLiveRef.sessionId,'advice-ready')
      // Ground advice in the recent *exchange*, not only the last two messages:
      // a follow-up like "I already sent it" may refer to a photo several turns
      // earlier. Only use this trusted, selected account+room's original history.
      // Keep a strict bounded window so cold-open and model latency stay low.
      const context=selectedRoom.messages.slice(-12).map(message=>{
        const body=message.text.trim().slice(0,180)
        // Existing verified media metadata only. The same original DSH
        // Session receives it as context; images/video/voice are NOT claimed
        // to have been visually decoded without the native multimodal tool.
        const extra=typeof message.mediaContext==='string'
          ?message.mediaContext.slice(0,480):''
        return body||extra
          ?(message.direction==='OUTBOUND'?'我':'对方')+'：'+
            [body,extra&&'[原平台真实媒体信息：'+extra+']'].filter(Boolean).join(' ')
          :''
      }).filter(Boolean).join('\n').slice(-3200)
      const historicalPrompt=suggestionPrompt({name:selectedLabel,label:activeAccount.channel,
        intro:context,translation:latest.translation??''})
      // Record the true Host message identity in the native DSH transcript, not
      // in another cache. Older CCv3 prompts lacked this marker and are matched
      // against their exact native user/message text on first upgrade.
      const originMarker='来源消息ID：'+latest.mid
      const prompt=historicalPrompt+'\n'+originMarker
      const latestAt=latest.timestamp<1e11?latest.timestamp*1000:latest.timestamp
      const bound=brainLiveRef
      let live=true
      let admitted=false
      void bound.ready.then(async binding=>{
        emitBrainTiming(bound.sessionId,'session-ready',{durationMs:performance.now()-readyAt})
        // The native Session must be titled for this authenticated contact
        // before its first agent turn evaluates contact-specific prompt Slots.
        const naming=brainNamed.current.get(bound.sessionId)
        if(!naming)throw Error('联系人原生会话命名流程尚未就绪')
        await naming
        if(!live||selectedSocialRef.current?.accountRef!==selectedSocial.accountRef||
          selectedSocialRef.current?.roomRef!==selectedSocial.roomRef)return
        // SessionReference.ready waits for the official Session.open history page.
        // Never generate against an empty/error EventWindow during a reload.
        if(binding.session.getSnapshot().openState!=='open')
          throw Error('原生 DSH 历史尚未恢复，暂停自动建议')
        const hasRecordedPrompt=()=>binding.eventSource.getSnapshot().entries.some(entry=>{
          if(entry.type!=='event'||entry.event.type!=='user/message')return false
          const event=entry.event
          const text=event.data.content.filter(block=>block.type==='text')
            .map(block=>block.text).join('\n').trim()
          if(text.split('\n').includes(originMarker))return true
          // Existing CCv3 transcript before the message-ID marker rollout:
          // exact prompt and origin chronology only, never compare names alone.
          const recordedAt=event.time<1e11?event.time*1000:event.time
          return text===historicalPrompt&&(!latestAt||recordedAt>=latestAt)
        })
        // The official DSH Session.open returns a tail window, not necessarily
        // the entire native transcript. A missing MID in that window does NOT
        // mean the same message was never submitted. Use the original DSH
        // Session.loadOlder() API, never a shadow database or second model.
        let previous=hasRecordedPrompt()
        let scannedPages=0
        while(!previous&&binding.session.getSnapshot().hasMore){
          if(!live||selectedSocialRef.current?.accountRef!==selectedSocial.accountRef||
            selectedSocialRef.current?.roomRef!==selectedSocial.roomRef)return
          if(scannedPages++>=8)throw Error('原生会话历史尚未完整核验，暂不重复请求模型')
          const count=binding.eventSource.getSnapshot().entries.length
          await binding.session.loadOlder()
          previous=hasRecordedPrompt()
          if(!previous&&binding.session.getSnapshot().hasMore&&
            binding.eventSource.getSnapshot().entries.length<=count)
            throw Error('原生历史分页暂不可读，未再次请求模型')
        }
        if(!live||selectedSocialRef.current?.accountRef!==selectedSocial.accountRef||
          selectedSocialRef.current?.roomRef!==selectedSocial.roomRef)return
        emitBrainTiming(bound.sessionId,'history-ready',{pages:scannedPages,durationMs:performance.now()-readyAt})
        if(previous){admitted=true;emitBrainTiming(bound.sessionId,'advice-duplicate');return}
        // Re-read the native pick before EVERY automatic generation. A cached
        // naming promise cannot prove that a 200-entry pick was not evicted.
        const personaAt=performance.now()
        await revalidateNativePersonaBeforeGeneration(bound.sessionId,CWD)
        emitBrainTiming(bound.sessionId,'persona-ready',{durationMs:performance.now()-personaAt})
        if(!live||selectedSocialRef.current?.accountRef!==selectedSocial.accountRef||
          selectedSocialRef.current?.roomRef!==selectedSocial.roomRef)return
        // Latch before the async admission round trip; a translation/status
        // rerender must not submit an identical pending native prompt twice.
        admitted=true
        emitBrainTiming(bound.sessionId,'prompt-submit',{durationMs:performance.now()-readyAt})
        const sent=await binding.session.prompt([{type:'text',text:prompt}],'queue')
        if(!sent.ok)throw sent.error
        emitBrainTiming(bound.sessionId,'prompt-accepted',{durationMs:performance.now()-readyAt})
      }).catch(e=>{emitBrainTiming(bound.sessionId,'advice-error');adviceRequested.current.delete(requestKey);if(live)setError('三条建议暂不可用：'+String(e))})
      return()=>{live=false;if(!admitted){adviceRequested.current.delete(requestKey);emitBrainTiming(bound.sessionId,'advice-cancelled')}}
    },[surfaceVisible,workspaceMode,brainOpen,brainArchived,brainLiveRef,selectedSocial,selectedRoom,roomPhase,activeAccount,selectedLabel])

    // Keep the same DSH/OSS panels side by side on laptop widths. Contacts
    // remain under the mature inbox's own collapse control, never auto-hidden.
    const railWidth=document.querySelector('[data-sidebar-collapsed]')?44:0
    const workspaceWidth=Math.max(0,workWidth-railWidth)
    // At an actual 1024px laptop viewport the 200px contact roster plus
    // 420px native chat Composer leave only ~270px for Brain, too narrow for
    // three original DSH suggestions and their inline Adopt/Edit actions.
    // Preserve both original editors and the OSS contact list; use the
    // existing reversible Brain drawer until the full layout fits naturally.
    // workWidth is the on-screen CENTER width (window minus the 210px DSH
    // sidebar, after display zoom), not the full window. At the 1100px default
    // window that is ~900px, which fits contact + Composer + the 300px Brain
    // floor as inline columns; the old 1100 threshold misread it and forced the
    // overlay drawer to cover the conversation.
    const brainInline=workWidth>=900
    // The mature inbox alone owns contact collapse. Never budget 0px for
    // contacts merely because the screen is 1024px: the user may leave the
    // existing 231px OSS roster expanded. Reserve a 264px contact/resize
    // allowance AND the original 420px chat Composer minimum before assigning
    // the remaining space to the existing DSH Brain. No forced collapse.
    const brainMax=brainInline
      ?Math.max(300,Math.min(520,workspaceWidth-264-CHAT_MIN_WIDTH))
      :Math.max(300,Math.min(520,workspaceWidth-24))
    const visibleBrainWidth=brainOpen?clampPanelWidth(brainWidth,300,brainMax):0
    const canResizeColumns=brainInline&&brainMax>300
    const resetBrainWidth=()=>{resetPanelWidth(BRAIN_WIDTH_KEY);setBrainWidth(BRAIN_DEFAULT)}
    const openNativeWork=()=>{
      // Keep the original OSS mounted and its per-room drafts unchanged.
      // Work displays the already-retained original DSH owner Session using
      // the SAME native Conversation / Composer, not a second workspace.
      if(workspaceMode!=='work')chatBrainOpenBeforeWork.current=brainOpen
      setWorkVisited(true)
      setBrainOpen(true)
      setWorkspaceMode('work')
    }
    const openNativeChat=()=>{
      if(workspaceMode==='work')setBrainOpen(chatBrainOpenBeforeWork.current)
      setWorkspaceMode('chat')
    }
    const openMemory=()=>{
      // Synchronous scope selection prevents one-frame owner-memory fallback
      // when the user opens Relations immediately after changing contacts.
      v2Transient.memoryTarget=selectedSocial&&activeAccount?{
        sessionId:brainSessionId,channel:activeAccount.channel,
        accountRef:selectedSocial.accountRef,roomRef:selectedSocial.roomRef}:null
      // The compact rail and official Sidebar resolve to ONE native main panel.
      if(document.querySelector('[data-sidebar-collapsed]'))host.layout.toggleSidebar()
      host.layout.selectPanel(memoryPanelKey)
    }
    const openMeta=()=>{
      if(document.querySelector('[data-sidebar-collapsed]'))host.layout.toggleSidebar()
      host.layout.selectPanel(metaPanelKey)
    }
    const openConnections=()=>{
      // One plugins entry. Restore the official sidebar before our rail unmounts,
      // otherwise the native Plugins page loses its return navigation.
      if(document.querySelector('[data-sidebar-collapsed]'))host.layout.toggleSidebar()
      host.layout.selectPanel('plugins')
    }
    // Only account/Session/Host identity changes may rebuild mature OSS props.
    // Chat/Work and Brain layout are view-only state: reusing this exact JSX
    // element prevents the original inbox subtree + callback reconciliation
    // on navigation. Closures use dependencies below or stable setters/refs.
    // Verified Agent panel navigation uses ONE stable layout action: the same
    // host.layout.selectPanel every YENRA rail button already calls.
    const openNativePanel=useCallback((panel:string)=>{
      try{host.layout.selectPanel(panel as never)}catch{/* unknown panel stays put */}
    },[host])
    const socialSurface=useMemo(()=>{
      // Optional Chatwoot seat: when the @yenra/chatwoot-embed service is present,
      // its verified Chatwoot inbox replaces the legacy mature-inbox surface here.
      // It stays MOUNTED across Chat/Work (visible only in Chat), never a second inbox.
      const Inbox=chatwootSeat?.Inbox
      if(typeof Inbox==='function')return <Inbox
        visible={surfaceVisible&&workspaceMode==='chat'}
        configNamespace="yenra-chatwoot-embed"
        translateVisibleMessage={async(scope:{accountRef:string;roomRef:string},
          message:{id:string;text:string;chatwoot:{accountId:number;conversationId:number;inboxId:number;messageId:number}})=>{
          const account=socialRoster?.accounts.find(a=>a.accountRef===scope.accountRef)
          if(!sessionId || !account?.rooms.some(r=>r.roomRef===scope.roomRef) ||
            !translationQueue.current)return null
          const request:TranslationRequest={
            channel:account.channel,accountRef:scope.accountRef,
            roomRef:scope.roomRef,direction:'to-zh',items:[{id:message.id,text:message.text}],
            chatwoot:message.chatwoot,
          }
          const translated=await translationQueue.current.add(
            ()=>translateNative(request),{priority:8})
          const value=translated?.items.find(item=>item.id===message.id)?.translation
          return typeof value==='string' && value.trim()?value.trim():null
        }}
        bindingSink={{
          onSelected:(accountRef:string,roomRef:string)=>{
            setChatwootContact({accountRef,roomRef})
            const account=socialRoster?.accounts.find(a=>a.accountRef===accountRef)
            if(!account?.rooms.some(r=>r.roomRef===roomRef)){
              ++roomRequest.current;ossAdoptDraftRef.current=null;selectedSocialRef.current=null;setSelectedSocial(null);setSelectedRoom(null);setRoomPhase('idle');return
            }
            void selectSocialRoom(accountRef,roomRef)
          },
          onDeselected:()=>{
            setChatwootContact(null)
            ++roomRequest.current;ossAdoptDraftRef.current=null;selectedSocialRef.current=null;setSelectedSocial(null);setSelectedRoom(null);setRoomPhase('idle');setRoomError('');setSendNotice('')
          },
          clearLegacyAdoption:()=>{ossAdoptDraftRef.current=null},
        }}/>
      return <OssNativeSocial
            rosterPhase={socialPhase}
            accounts={(socialRoster?.accounts??[]) as any}
            refreshOriginalRoster={()=>refreshSocialRoster(true)}
            refreshContactDisplay={()=>refreshSocialRoster(false)}
            sessionId={sessionId}
            bindAdoptDraft={adapter=>{ossAdoptDraftRef.current=adapter}}
            readRoom={async(channel,accountRef,roomRef)=>{
              const args=JSON.stringify({accountRef,roomRef})
              // Both Host callbacks have already decoded the authenticated
              // YENRA_*_V1 payload. Passing the object through the response
              // decoder a second time throws and leaves real OSS bubbles blank.
              return channel==='WhatsApp'
                ?nativeSocialCommand('yenra-social-room',args)
                :nativeFacebookCommand('yenra-facebook-room',args)
            }}
            sendNativeText={async(channel,accountRef,roomRef,text,quotedId)=>{
              if(!sessionId)throw Error('原生主人 DSH Session 尚未就绪')
              if(quotedId&&channel!=='Personal')throw Error('该渠道暂不支持原生引用发送，草稿已保留')
              // The same verified owner-click Host route as manual text.
              // Never execute a slash Command inside the native Work Session.
              const response=await fetch('/api/yenra/social-text-send',{
                method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
                body:JSON.stringify({channel,sessionId,accountRef,roomRef,text,
                  ...(quotedId&&channel==='Personal'?{replyToMessageId:quotedId}:{})})
              })
              const payload=await response.json() as {
                ok?:boolean;error?:string;receipt?:Record<string,unknown>
              }
              if(!response.ok||payload.ok!==true||!payload.receipt)
                throw Error(payload.error??'原生 Sender 未确认提交，草稿必须保留')
              const receipt=payload.receipt
              if(receipt.sent!==true||receipt.submitted!==true||
                receipt.channel!==channel||receipt.accountRef!==accountRef||
                receipt.roomRef!==roomRef||receipt.delivered!==false||
                receipt.deliveryStatus!=='UNKNOWN')
                throw Error('原生 Sender 渠道、账号、会话或送达状态回执未匹配')
              // DSH-IM confirms submission, NOT independent platform accept.
              // Original Page/MATRIX alone explicitly reports acceptance.
              const accepted=channel==='Page'?receipt.providerAccepted===true:
                channel==='Personal'?receipt.matrixAccepted===true:false
              const originalMid=channel==='Personal'?receipt.matrixEventId:
                receipt.providerMessageId
              const verifiedMid=typeof originalMid==='string'&&
                originalMid.length>0&&originalMid.length<=180&&
                !/[\x00-\x20\x7f]/.test(originalMid)?originalMid:null
              return {messageId:verifiedMid??'accepted-without-provider-mid',
                status:accepted?'accepted':'submitted'}
            }}
            sendNativeMedia={async(channel,accountRef,roomRef,params)=>{
              if(!sessionId)throw Error('原生主人 Session 尚未就绪，媒体草稿保留');
              if(channel==='WhatsApp'&&!
                (socialRoster?.accounts.find(a=>a.accountRef===accountRef) as any)?.mediaSendSupported)
                throw Error('原 DSH-IM 尚未开放单 Socket 人工媒体发送，草稿保留');
              if(!socialRoster?.accounts.some(a=>a.accountRef===accountRef&&
                  a.channel===channel&&a.rooms.some(r=>r.roomRef===roomRef)))
                throw Error('原生账号或会话引用已变化');
              if(params.to!==roomRef)throw Error('MEDIA_TO_ROOM_MISMATCH');
              if(!['image','document'].includes(params.mediaType))
                throw Error('当前原 Facebook Sender 不支持视频或语音发送，草稿保留');
              if(params.caption?.trim())throw Error('当前原生媒体 Sender 不支持图片附带文字，请先保留文字草稿');
              // The original official DSH WebServer is already used for
              // translations. Direct human-click POST keeps image bytes OUT
              // of Brain/Agent slash Commands and their Session execution.
              const response=await fetch('/api/yenra/social-media-send',{
                method:'POST',cache:'no-store',
                headers:{'content-type':'application/json'},
                body:JSON.stringify({channel,sessionId,accountRef,roomRef,
                  mediaType:params.mediaType,media:params.media,
                  fileName:params.fileName,mimeType:params.mimeType}),
              });
              const result=await response.json() as {
                ok?:boolean;error?:string;
                receipt?:Record<string,unknown>
              };
              if(!response.ok||result.ok!==true||!result.receipt)
                throw Error(result.error??'原生媒体 Sender 未确认提交，请勿自动重发');
              const receipt=result.receipt;
              if(receipt.submitted!==true||receipt.sent!==true||receipt.delivered!==false||
                 receipt.accountRef!==accountRef||receipt.roomRef!==roomRef||
                 receipt.channel!==channel||
                 (channel!=='WhatsApp'&&typeof receipt.requestId!=='string'))
                throw Error('原生媒体 Sender 回执未匹配账号和联系人，请勿重发');
              // A media Sender request ID is not a provider MID or an ACK.
              const originalMid=typeof receipt.providerMessageId==='string'&&
                receipt.providerMessageId.length>0&&receipt.providerMessageId.length<=180&&
                !/[\x00-\x20\x7f]/.test(receipt.providerMessageId)
                ?receipt.providerMessageId:null;
              return {messageId:originalMid??'accepted-without-provider-mid',
                status:receipt.providerAccepted===true?'accepted':'submitted'};
            }}
            createWhatsAppContact={createWhatsAppContact}
            removeLocalWhatsAppContact={async(accountRef,roomRef,expectedRevision)=>
              contactPrefCommand('remove',{accountRef,roomRef,expectedRevision})}
            resyncWhatsAppContacts={async(accountRef)=>
              contactPrefCommand('resync',{accountRef})}
            saveContactName={async(accountRef,roomRef,displayName,expectedRevision)=>
              contactPrefCommand('name-save',{accountRef,roomRef,displayName,expectedRevision})}
            getContactPrefs={async(accountRef,roomRef)=>
              contactPrefCommand('read',{accountRef,roomRef})}
            saveContactPref={async(accountRef,roomRef,field,value,expectedRevision)=>
              contactPrefCommand('save',{accountRef,roomRef,field,value,expectedRevision})}
            onSelected={(accountRef,roomRef)=>{
              selectedSocialRef.current={accountRef,roomRef}
              setSelectedSocial({accountRef,roomRef})
              setSelectedRoom(null) // Right native Brain context only; OSS bubbles stay visible
              setRoomPhase('loading')
            }}
            onDeselected={()=>{
              // Mature OSS is the sole owner of account/conversation selection.
              // A null selection must release Brain's old contact, never carry
              // Stefan's history into an unselected Personal/Page/WA account.
              selectedSocialRef.current=null
              setSelectedSocial(null)
              setSelectedRoom(null)
              setRoomPhase('idle')
              setRoomError('')
              setSendNotice('')
            }}
            onRoomData={(accountRef,roomRef,source)=>{
              if(selectedSocialRef.current?.accountRef!==accountRef||
                selectedSocialRef.current?.roomRef!==roomRef)return
              try{
                const raw=source as {channel?:string}
                const room=raw.channel==='WhatsApp'
                  ?parseSocialRoom(source,accountRef,roomRef)
                  :parseFacebookRoom(source,accountRef,roomRef)
                setSelectedRoom(previous=>{
                  // Never let an older room fetch erase a newer original SSE
                  // MID already delivered to the selected native Brain.
                  if(previous?.accountRef!==accountRef||previous.roomRef!==roomRef)return room
                  const mids=new Set(room.messages.map(item=>item.mid))
                  const newest=room.messages.at(-1)?.timestamp??0
                  const verifiedNew=previous.messages.filter(item=>
                    !mids.has(item.mid)&&item.timestamp>=newest)
                  return verifiedNew.length?{...room,messages:[...room.messages,...verifiedNew]
                    .sort((a,b)=>a.timestamp-b.timestamp).slice(-200)}:room
                })
                setRoomPhase('ready')
              }catch(error){setRoomError(String(error));setRoomPhase('error')}
            }}
            onPanelOpen={openNativePanel}
            onVerifiedInbound={(accountRef,roomRef,mid,text,timestamp)=>{
              if(selectedSocialRef.current?.accountRef!==accountRef||
                 selectedSocialRef.current?.roomRef!==roomRef)return
              setSelectedRoom(previous=>{
                if(!previous||!['WhatsApp','Personal','Page'].includes(previous.channel)||
                  previous.accountRef!==accountRef||previous.roomRef!==roomRef||
                  previous.messages.some(item=>item.mid===mid))return previous
                const latest={mid,text,direction:'INBOUND' as const,timestamp}
                const messages=[...previous.messages,latest]
                  .sort((a,b)=>a.timestamp-b.timestamp).slice(-200)
                return {...previous,messages,updatedAt:new Date(timestamp).toISOString()}
              })
            }}
          />
    },[socialRoster,socialPhase,sessionId,nativeSocialCommand,nativeFacebookCommand,host,openNativePanel,surfaceVisible,workspaceMode,selectSocialRoom,chatwootSeat,translateNative])
    // Retain one identical native Work Session/Conversation React element
    // after its first mount. Its official store subscription still updates
    // messages; toggling Chat/Work does not re-render the hidden transcript.
    const retainedWorkView=useMemo(()=>(!workVisited?null:liveRef?
      <SessionProvider session={liveRef}>{renderSlot('yenra.candidate.ai',{})}</SessionProvider>:
      <div className="v2-brain-pending" role="status">正在恢复原生 DSH 工作会话…</div>
    ),[workVisited,liveRef,SessionProvider,renderSlot])
    // Contact folding is handled by the mature messaging-inbox control.
    return <div ref={rootRef} className="yenra-v2" data-yenra-v2="native" data-channel-data={socialDataState}
      data-yenra-social-readonly="false" data-yenra-account-count={visibleAccountCount} data-yenra-mode={workspaceMode}
      data-yenra-selected-account={selectedSocial?.accountRef??''} data-yenra-selected-room={selectedSocial?.roomRef??''}
      data-yenra-room-phase={roomPhase}>
      {/* Windows DSH intentionally hides its sidebar completely when collapsed.
          The V2 icon rail is a display-only view of the SAME native panel actions,
          never another navigation store, Agent or Electron window. It is hidden
          when the official DSH sidebar is expanded. */}
      <aside className="v2-navigation-rail" aria-label="YENRA 原生面板快捷导航">
        <div className="v2-rail-top">
          {/* Chat / Work are the single global topbar modes. The compact rail
              only exposes native secondary destinations; no duplicate modes. */}
          <button type="button" className="v2-rail-button" aria-label="插件管理"
            title="官方 DSH 插件管理" onClick={openConnections}><IconCordisPluginOutlineMedium size={18}/></button>
          <button type="button" className="v2-rail-button" aria-label="记忆与关系"
            title="记忆与关系" onClick={openMemory}><IconDatabaseOutlineMedium size={18}/></button>
          <button type="button" className="v2-rail-button" aria-label="广告管理" title="Meta 官方广告管理" onClick={openMeta}><IconGoalOutlineMedium size={18}/></button>
        </div>
      </aside>
      <header className="v2-topbar">
        <div className="v2-top-title" data-yenra-global-brand="chat"><img src={yenraBrandLockup} alt="YENRA · GRAPHITE GLOW" className="v2-top-lockup"/></div>
        <nav className="v2-modes" aria-label="工作模式">
          <button type="button" className={'v2-mode'+(workspaceMode==='chat'?' v2-mode-current':'')} aria-current={workspaceMode==='chat'?'page':undefined} onClick={openNativeChat}>聊天</button>
          <button type="button" className={'v2-mode'+(workspaceMode==='work'?' v2-mode-current':'')} aria-current={workspaceMode==='work'?'page':undefined} onClick={openNativeWork}>工作</button>
        </nav>
        <div className="v2-top-actions">
          {/* The original messaging-inbox account picker is portaled into this
              native DSH caption seat. This never creates a second picker/store. */}
          <div className="v2-native-account-seat" data-yenra-account-seat="" aria-label="社交账号选择" />
          {/* Loaded rosters need no redundant success badge. When the original
              Host is unavailable, keep one compact actionable retry instead
              of a misleading online/offline indicator or explanatory copy. */}
          {socialPhase!=='ready'?<button type="button" className="v2-disconnect"
            disabled={socialPhase==='checking'}
            title={socialPhase==='checking'?'正在读取原账号名册':'原账号名册暂不可用，点击重新读取'}
            aria-label={socialPhase==='checking'?'正在读取名册':'重新读取账号名册'}
            onClick={()=>{void refreshSocialRoster(true)}}>
            {socialPhase==='checking'?'读取中':'重试名册'}
          </button>:null}
          {!brainOpen&&workspaceMode==='chat'?<button type="button" className="v2-top-action v2-brain-toggle" aria-expanded={false} aria-label="展开闺蜜大脑" onClick={()=>setBrainOpen(true)}><IconSparkleMedium size={16}/> 闺蜜大脑</button>:null}
        </div>
      </header>

      <main className="v2-workspace" data-brain-open={brainOpen} data-yenra-mode={workspaceMode} data-brain-layout={brainInline?'inline':'drawer'}
        style={{'--yenra-brain-width':visibleBrainWidth+'px'} as React.CSSProperties}>
        <section className="v2-social" aria-label="真人社交收件箱">
          {socialSurface}
          {/* Mature messaging-inbox owns the complete contact list and collapse control. */}
        </section>
        {brainOpen&&workspaceMode==='chat'&&canResizeColumns?
          <NativePanelGrip side="brain" width={visibleBrainWidth} min={300} max={brainMax}
            onWidth={setBrainWidth} onCommit={value=>commitPanelWidth(BRAIN_WIDTH_KEY,value)} onReset={resetBrainWidth}/>:null}

        {(brainOpen||workVisited)?<aside className="v2-brain"
          hidden={!brainOpen&&workspaceMode==='chat'}
          aria-label="闺蜜大脑" data-brain-native="dsh">
          <div className="v2-brain-head">
            <div className="v2-brain-label"><span className="v2-brain-mark"><IconSparkleMedium size={18}/></span><div><strong>{workspaceMode==='work'?'工作':'闺蜜大脑'}</strong></div></div>
            <div className="v2-brain-controls">
              <PersonaHeaderMenu sessionId={workspaceMode==='work'?(liveRef?sessionId:undefined):(brainLiveRef?brainSessionId:undefined)} cwd={CWD}/>
              {workspaceMode==='chat'?<button type="button" aria-label="收起闺蜜大脑" onClick={()=>setBrainOpen(false)}><IconCloseOutlineRegular size={16}/></button>:null}
            </div>
          </div>
          {/* Keep the already-authorized DSH owner Work Session mounted after
              its first use. Hidden official views have NO actionable Composer;
              this avoids re-hydrating the full native owner transcript on every
              hot Chat/Work switch. No new Agent, Session, Composer or Sender. */}
          <div className="v2-native-conversation" data-brain-contact={selectedSocial?'selected':'none'}>
            <div className="v2-native-chat-pane" hidden={workspaceMode==='work'}
              data-yenra-brain-session={brainLiveRef?.sessionId}
              data-yenra-brain-active={surfaceVisible&&workspaceMode==='chat'&&brainOpen&&!brainArchived?'true':'false'}
              aria-hidden={workspaceMode==='work'}
              ref={node=>{if(node)node.inert=workspaceMode==='work'}}>
              {!selectedSocial?<div className="v2-brain-pending" role="status">选择左侧联系人，即可和闺蜜大脑讨论三条回复。</div>:
                brainLiveRef?(brainArchived?<div className="v2-brain-pending" role="status">{error.startsWith('原生闺蜜会话恢复失败')?error:'正在恢复当前联系人的原生会话…'}</div>:<SessionProvider session={brainLiveRef}>{renderSlot('yenra.candidate.ai',{})}</SessionProvider>):
                <div className="v2-brain-pending" role="status">{error||'正在打开当前联系人的原生闺蜜会话…'}</div>}
            </div>
            {workVisited?<div className="v2-native-work-pane"
              data-inactive={workspaceMode!=='work'}
              aria-hidden={workspaceMode!=='work'}
              ref={node=>{if(node)node.inert=workspaceMode!=='work'}}>
              {workspaceMode==='work'&&workSessionBlank&&liveRef?<YenraWorkWelcome markUrl={logoUrl}/>:null}
              {retainedWorkView}
            </div>:null}
          </div>
        </aside>:null}
      </main>
    </div>
  }
}

/**
 * One permanent YENRA Chat view in the official root-scoped shell.overlay
 * Slot. DSH's main Slot switches mounted children on every native navigation,
 * so putting the mature inbox there restarted it on Chat <-> Memory/Plugins.
 * This keeps exactly ONE existing inbox/DSH Session/Composer alive, offscreen
 * when another native panel is selected. No second roster, Agent, DB or Sender.
 */
function makeRetainedChat(host:ClientContext){
  const Chat=makeV2Panel(host)
  return function RetainedChat(props:PanelProps){
    const activePanelId=useSyncExternalStore(
      useCallback(notify=>host.layout.panelInfo.subscribe(notify),[host]),
      useCallback(()=>host.layout.panelInfo.getSnapshot().activePanelId,[host]),
      useCallback(()=>host.layout.panelInfo.getSnapshot().activePanelId,[host]),
    )
    const visible=activePanelId===panelKey
    const seatRef=useRef<HTMLDivElement|null>(null)
    // Read the original DSH AppFrame's central grid track, never resize or
    // modify upstream DOM. The overlay slot stays mounted across main keys.
    useLayoutEffect(()=>{
      const seat=seatRef.current
      const layer=seat?.closest<HTMLElement>('[data-shell-overlay]')
      const center=layer?.parentElement?.children.item(1)
      if(!seat||!layer||!(center instanceof HTMLElement))return
      const measure=()=>{
        const root=layer.getBoundingClientRect()
        const rect=center.getBoundingClientRect()
        // DSH Windows Desktop can zoom its Web UI (e.g. 90%). Translate
        // visual DOMRects back to the overlay's CSS coordinate space first.
        const sx=root.width/(layer.offsetWidth||root.width)||1
        const sy=root.height/(layer.offsetHeight||root.height)||1
        seat.style.left=((rect.left-root.left)/sx)+'px'
        seat.style.top=((rect.top-root.top)/sy)+'px'
        seat.style.width=(rect.width/sx)+'px'
        seat.style.height=(rect.height/sy)+'px'
      }
      const observer=new ResizeObserver(measure)
      observer.observe(center)
      // A sidebar shift can move the center without changing its width.
      const frame=layer.parentElement
      const columns=new MutationObserver(measure)
      if(frame)columns.observe(frame,{attributes:true,
        attributeFilter:['style','data-sidebar-collapsed','data-rightbar-collapsed']})
      window.addEventListener('resize',measure)
      measure()
      return()=>{observer.disconnect();columns.disconnect();
        window.removeEventListener('resize',measure)}
    },[])
    useEffect(()=>{if(seatRef.current)seatRef.current.inert=!visible},[visible])
    return <div ref={seatRef} className="yenra-retained-chat-seat"
      data-yenra-retained-chat="" data-yenra-retained-visible={visible}
      aria-hidden={!visible} style={{visibility:visible?'visible':'hidden',
        pointerEvents:visible?'auto':'none'}}>
      <Chat {...props} surfaceVisible={visible}/>
    </div>
  }
}

/** The main key is an official DSH navigation target; the ONE Chat renderer
 * lives in the persistent shell.overlay Slot instead of mounting here. */
function RetainedChatMainSeat(){return null}

function makeMemoryPanel(host:ClientContext){return makeNativeMemoryPanel(host,
  ()=>host.workspaces.list.getSnapshot().items[0]?.path??'',panelKey,
  ()=>v2Transient.memoryTarget)}
/** Reuse the already-registered Scout Page through the official Slots registry.
 * Its React component and all remote catalog/installer logic remain OSS-owned.
 * Do not re-declare the root plugins.tab as a child; that breaks DSH boot. */
function makeScoutPanel(host:ClientContext){
  return function ScoutStandalone(){
    const version=useSyncExternalStore(
      notify=>host.slots.subscribe('plugins.tab',notify),
      ()=>host.slots.getVersion('plugins.tab'),
      ()=>0,
    )
    const scout=host.slots.entriesOfSlot('plugins.tab').find(entry=>entry.options.id==='dsh-plugin-scout')
    const ScoutPage=scout?.component as React.ComponentType<{openPackage?:(name:string)=>void}>|undefined
    const openOfficialPlugins=()=>host.layout.selectPanel('plugins')
    return <main className="yenra-scout-standalone" data-yenra-scout-standalone="" data-scout-ledger-version={version}>
      <header className="yenra-scout-standalone-head">
        <div><h1>插件市场</h1><p>发现、筛选与安装 DSH 插件</p></div>
        <button type="button" onClick={openOfficialPlugins}>已安装插件</button>
      </header>
      <section className="yenra-scout-standalone-content" aria-label="Scout 插件市场">
        {ScoutPage?<ScoutPage openPackage={()=>openOfficialPlugins()}/>:
          <p role="status">Scout 尚未加载，可在「插件」中检查启用状态。</p>}
      </section>
    </main>
  }
}
function SidebarScoutIcon({size}:{size:number}){return <IconBrowseOutlineMedium size={size}/>}
function SidebarMetaIcon({size}:{size:number}){return <IconGoalOutlineMedium size={size}/>}

function NativeConversation({renderFactorySlot}:PropsRuntime<'yenra.candidate.ai'> & PropsRenderFactories){
  return <div className="v2-native-embed" data-yenra-ai-composer="official">
    {renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false},
      {slots:{widthControls:()=>null}})}
  </div>
}

// Official DSH keyed command-card extension. The authenticated, persisted
// original Session still executes and stores its memory commands; only their
// machine-readable execution receipts stop leaking into the owner's Brain UI.
// Work's native command history remains navigable via a short human-readable
// status, with failures visible rather than hidden as successful replies.
const internalMemoryCommandNames=[
  'yenra-memory-bind','yenra-memory-list','yenra-memory-search',
  'yenra-memory-adopt','yenra-memory-save','yenra-memory-correct',
  'yenra-memory-forget',
] as const
// These exact older Commands remain in DSH's durable transcript for audit.
 // Keyed DSH commandview changes PRESENTATION only for YENRA internal commands.
 // It never overrides the native work tools, assistant replies or other cards.
const internalSocialCommandNames=[
  'yenra-facebook-manual-send','yenra-social-manual-send',
  'yenra-facebook-roster','yenra-facebook-room',
  'yenra-social-roster','yenra-social-room',
  'yenra-facebook-contact-prefs-read','yenra-facebook-contact-prefs-save',
  'yenra-whatsapp-contact-prefs-read','yenra-whatsapp-contact-prefs-save',
  'yenra-whatsapp-contact-create','yenra-whatsapp-contact-remove',
  'yenra-whatsapp-contact-name-save','yenra-whatsapp-contact-resync',
] as const
function InternalYenraCommandReceipt({node}:PropsRuntime<'conversation.chat.commandview'>){
  const name=node.name??''
  const send=name.endsWith('-manual-send')
  const memory=name.startsWith('yenra-memory-')
  const contact=name.includes('contact-')
  const running=node.outcome===null
  const failed=node.outcome?.kind==='error'
  // User-facing summary does not expose old JSON/account hashes/MIDs.
  const raw=node.outcome?.text??''
  let accepted=false
  if(send&&!running&&!failed&&raw.startsWith('YENRA_SOCIAL_SEND_V1:')){
    try{
      const info=JSON.parse(raw.slice('YENRA_SOCIAL_SEND_V1:'.length)) as Record<string,unknown>
      accepted=info.providerAccepted===true||info.matrixAccepted===true
    }catch{/* Preserve the original event; do not infer delivery. */}
  }
  const label=send?'社交发送':memory?'记忆操作':contact?'联系人设置':'社交读取'
  const status=running?'执行中':failed?'未完成':send?(accepted?'平台已接受，送达待核实':'提交记录，送达待核实'):
    memory?'已记录':contact?'已处理':'已读取'
  // Expose a short failure reason on demand; the unmodified full event stays
  // in DSH's native Session storage for audit instead of being deleted.
  const reason=failed?raw.replace(/[a-f0-9]{32}/gi,'[引用]')
    .replace(/session-[a-f0-9-]{36}/gi,'[会话]')
    .slice(0,180):''
  return <details data-yenra-internal-command={name}>
    <summary aria-label={label+'：'+status}>{label} · {status}</summary>
    <span>{failed?(reason||'可到原始会话审计记录查看失败原因'):
      '原始操作和完整回执仍保留在 DSH Session 历史中；这里仅显示摘要。'}</span>
  </details>
}

/** One original DSH shell.overlay occupant for the *native* Conversation main.
 * It appears only when the official Layout selects the native Work Session:
 * no alternative navigation store, Session, Composer, or duplicate chat view.
 * The built-in Workspace Controller still creates and owns every New Session. */
function makeYenraNativeSessionHeader(host:ClientContext){
  return function YenraNativeSessionHeader(){
    const active=useSyncExternalStore(
      useCallback((notify:()=>void)=>host.layout.panelInfo.subscribe(notify),[host]),
      useCallback(()=>host.layout.panelInfo.getSnapshot().activePanelId,[host]),
    )
    if(active!==null)return null
    return <header className="yenra-native-session-header" data-yenra-unified-navigation="native-work">
      <img className="yenra-native-session-lockup" src={yenraBrandLockup} alt="YENRA · GRAPHITE GLOW"/>
      <nav className="yenra-native-session-modes" aria-label="YENRA 聊天与工作">
        <button type="button" onClick={()=>host.layout.selectPanel(panelKey)}>聊天</button>
        <button type="button" aria-current="page" onClick={()=>host.layout.selectPanel(null)}>工作</button>
      </nav>
    </header>
  }
}
function NativeBrandMark({size}:{size:number}){
  return <img src={logoUrl} alt="YENRA" style={{width:size,height:size,borderRadius:Math.max(6,size/4)}}/>
}
function NativeOwnerWelcome(){return <YenraWorkWelcome markUrl={logoUrl}/>}
function NativeBrandName(){return <span data-yenra-global-brand="sidebar" style={{display:'flex',flexDirection:'column',gap:2,lineHeight:1.05}}><strong style={{fontSize:15,letterSpacing:'.13em',fontWeight:800}}>YENRA</strong><small style={{fontSize:8,letterSpacing:'.07em',fontWeight:400,color:'var(--dsw-alias-label-tertiary)'}}>GRAPHITE GLOW</small></span>}
/** Official settings-shell owner callback; this slot shadows AccountMenu without forking Settings. */
function SettingsOnlyLauncher({openSettings,settingsOpen}:PropsRuntime<'settings.launcher'>){
  return createPortal(<button type="button" className="yenra-settings-only-launcher"
    aria-label="设置" title="设置" aria-haspopup="dialog" aria-expanded={settingsOpen}
    onClick={openSettings}><IconSettingsOutlineMedium size={19}/></button>,document.body)
}
function SidebarMemoryIcon({size}:{size:number}){return <IconDatabaseOutlineMedium size={size}/>}
function SidebarChatIcon({size,active}:{size:number,active:boolean}){
  return <span aria-hidden="true" title="YENRA 聊天" style={{
    display:'inline-flex',width:size,height:size,alignItems:'center',justifyContent:'center',
    opacity:active?1:.75}}><IconGoalOutlineMedium size={size}/></span>
}
export function apply(ctx:ClientContext):void {
  // Reuse the one mature OSS script's existing in-flight loader, concurrent
  // with the original DSH Storage Domain roster GET; never block DSH boot.
  warmOriginalMatureInbox()
  installNativeReplyCards(ctx)
  // Native DSH owns Appearance, including light, dark and follow-system.
  // Only keep the existing compact Desktop navigation; never force theme preference.
  ctx.effect(()=>{
    if(window.innerWidth>=1024)ctx.layout.toggleSidebar()
  },'YENRA compact native Desktop navigation')
  // Existing Figma Graphite Glow colors, registered ONLY through the official
  // DSH Theme token override API. No YENRA-specific color token namespace.
  ctx.effect(()=>ctx.theme.overrideTokens('yenra.desktop.visual',{
    '--dsw-alias-bg-base':{light:'#FFFFFF',dark:'#10151D'},
    '--dsw-alias-bg-layer-1':{light:'#FFFFFF',dark:'#19212B'},
    '--dsw-alias-bg-layer-2':{light:'#FFFFFF',dark:'#252F3C'},
    '--dsw-alias-bg-layer-3':{light:'#E8ECF2',dark:'#263647'},
    '--dsw-alias-border-l2':{light:'#DEE4EC',dark:'#344151'},
    '--dsw-alias-label-primary':{light:'#252D38',dark:'#FFFFFF'},
    '--dsw-alias-label-secondary':{light:'#69788B',dark:'#ABB9CB'},
    '--dsw-alias-label-tertiary':{light:'#778598',dark:'#7F91A6'},
    '--dsw-alias-brand-primary':{light:'#28303A',dark:'#EEF0F4'},
    '--dsw-specific-sidebar-fill':{light:'var(--dsw-alias-bg-layer-1)',dark:'var(--dsw-alias-bg-layer-1)'},
    '--dsw-specific-input-major':{light:'var(--dsw-alias-bg-layer-2)',dark:'var(--dsw-alias-bg-layer-2)'},
  }),'YENRA Figma palette via official DSH Theme')
  ctx.effect(()=>{
    const tag=document.createElement('style')
    tag.dataset.yenraCandidate='v2-native-styles'
    tag.textContent=v2Css
    document.head.appendChild(tag)
    // Official Windows caption menus are rendered by the DSH preload in an
    // open ShadowRoot. Keep the original menu and align only its typography
    // with the existing, persisted DSH text-size setting.
    let nativeMenuFont:HTMLStyleElement|undefined
    const attachMenuFont=()=>{
      if(nativeMenuFont) return
      const shadow=document.querySelector<HTMLElement>('[data-windows-menu]')?.shadowRoot
      if(!shadow) return
      nativeMenuFont=document.createElement('style')
      nativeMenuFont.dataset.yenraFontBridge='official-dsh-text-size'
      nativeMenuFont.textContent='[role=menubar] button{font-size:max(10px,calc(14px + (var(--dsh-content-font-size,10px) - 10px) * .75))}'
      shadow.append(nativeMenuFont)
      observer.disconnect()
    }
    const observer=new MutationObserver(attachMenuFont)
    observer.observe(document.body,{childList:true})
    attachMenuFont()
    return ()=>{observer.disconnect();nativeMenuFont?.remove();tag.remove()}
  },'YENRA V2 layout in official DSH Desktop')
  ctx.slots.inject('plugins.tab',()=>ctx.slots.register({
    name:'plugins.tab',id:'yenra.social.connections',label:'连接与服务',order:12,
  },nativeConnectionsTab(ctx)))
  // Official keyed command renderer: only our legacy internal operation names
  // are summarized. Every other Work command and tool stays fully native.
  ctx.slots.inject('conversation.chat.commandview',function*(){
    for(const key of [...internalMemoryCommandNames,...internalSocialCommandNames])
      yield ctx.slots.register({name:'conversation.chat.commandview',key},InternalYenraCommandReceipt)
  })
  ctx.slots.inject('main',function*(){
    yield ctx.slots.register({name:'main',key:panelKey},RetainedChatMainSeat)
    yield ctx.slots.register({name:'main',key:memoryPanelKey},makeMemoryPanel(ctx))
    yield ctx.slots.register({name:'main',key:scoutPanelKey},makeScoutPanel(ctx))
    yield ctx.slots.register({name:'main',key:metaPanelKey},makeMetaAdsPanel(ctx))
    ctx.layout.selectPanel(panelKey)
  })
  // Preserve the original DSH LayoutController and one set of native panel slots.
  // During initial boot native Conversation can be reset after the first YENRA
  // render. Keep repairing only until a real human navigation begins; native
  // browser and other user-selected panels remain fully accessible afterward.
  ctx.effect(()=>{
    let humanNavigated=false,queued=false
    const noteHuman=(event:Event)=>{if(event.isTrusted)humanNavigated=true}
    window.addEventListener('pointerdown',noteHuman,true)
    window.addEventListener('keydown',noteHuman,true)
    const ensure=()=>{
      if(humanNavigated||queued)return
      queued=true
      requestAnimationFrame(()=>{
        queued=false
        if(humanNavigated||ctx.layout.panelInfo.getSnapshot().activePanelId!==null)return
        if(ctx.slots.entries('main').some(entry=>entry.options.key===panelKey))
          ctx.layout.selectPanel(panelKey)
      })
    }
    const unMain=ctx.slots.subscribe('main',ensure)
    const unPanel=ctx.layout.panelInfo.subscribe(ensure)
    ensure()
    return()=>{
      humanNavigated=true
      unPanel();unMain()
      window.removeEventListener('pointerdown',noteHuman,true)
      window.removeEventListener('keydown',noteHuman,true)
    }
  },'YENRA startup default until explicit user navigation')
  // Keep the single original social inbox mounted in the official root Slot.
  // Other native main panels can freely switch without unmounting this tree.
  ctx.slots.inject('shell.overlay',function*(){
    yield ctx.slots.register({
      name:'shell.overlay',id:'yenra.retained-chat',order:-11,
      children:{'yenra.candidate.ai':{kind:'single',scope:'session'}},
    },makeRetainedChat(ctx))
    yield ctx.slots.register({name:'yenra.candidate.ai'},NativeConversation)
  })
  // Reuse the same approved YENRA greeting in DSH's native New Session Hero.
  // The original native Session and Composer remain untouched.
  ctx.slots.inject('conversation.hero.owner.welcome',()=>ctx.slots.register(
    {name:'conversation.hero.owner.welcome',priority:-10},NativeOwnerWelcome))
  // Official DSH root shell.overlay is retained across main-panel navigation:
  // preserve the same YENRA Chat/Work controls while New Session stays native.
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register(
    {name:'shell.overlay',id:'yenra.native-session.global-navigation',order:-10},
    makeYenraNativeSessionHeader(ctx)))
  ctx.slots.inject('sidebar.brand.mark',()=>ctx.slots.register({name:'sidebar.brand.mark',priority:-10},NativeBrandMark))
  ctx.slots.inject('sidebar.brand.name',()=>ctx.slots.register({name:'sidebar.brand.name',priority:-10},NativeBrandName))
  ctx.slots.inject('settings.launcher',()=>ctx.slots.register({name:'settings.launcher',priority:-10},SettingsOnlyLauncher))
  ctx.slots.inject('sidebar.panellist',function*(){
    yield ctx.slots.register({name:'sidebar.panellist',id:panelKey,label:'聊天',order:8},SidebarChatIcon)
    yield ctx.slots.register({name:'sidebar.panellist',id:memoryPanelKey,label:'记忆与关系',order:9},SidebarMemoryIcon)
    yield ctx.slots.register({name:'sidebar.panellist',id:scoutPanelKey,label:'插件市场',order:11},SidebarScoutIcon)
    yield ctx.slots.register({name:'sidebar.panellist',id:metaPanelKey,label:'广告管理',order:10},SidebarMetaIcon)
  })
}
