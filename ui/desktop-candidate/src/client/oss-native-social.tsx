/**
 * YENRA native social surface: mature messaging-inbox inside the OFFICIAL
 * DSH main Slot. All data is read via the ALREADY running authenticated Host.
 * No second HTTP server, JS fetch monkeypatch, socket, database, Sender,
 * Agent, account login, or custom Composer.
 *
 * This is a pre-release native integration candidate. Do not create an
 * additional root window or enable it in the current installed Desktop.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {yenraInboxChinese} from './yenra-inbox-chinese';
import {parseFacebookResponse} from './social-readonly-view';
import {readOriginalOwnAccountProfile,readOriginalWhatsappHealth} from './native-whatsapp-connection-status';
import type {VerifiedOwnAccountProfile} from './native-whatsapp-connection-status';

// Mature OSS already checks account state on its existing 30s cadence.
// Reuse one verified original DSH-IM RPC for both WA accounts per poll;
// no second tracker, socket, or independent polling job is created.
let sharedHealthRead:{at:number;result:ReturnType<typeof readOriginalWhatsappHealth>}|null=null;
const getSharedOriginalHealth=()=>{
  const now=Date.now();
  if(!sharedHealthRead||now-sharedHealthRead.at>1250)
    sharedHealthRead={at:now,result:readOriginalWhatsappHealth()};
  return sharedHealthRead.result;
};
type InboxHandle = {unmount:()=>void;addDevices:(devices:DeviceConfig[])=>void;updateDevice:(id:string,patch:Partial<DeviceConfig>)=>void;refreshChats:()=>Promise<void>;
  selectConversation:(phoneNumber:string,prefillMessage?:string,deviceId?:string)=>void;
  emitOriginalHostEvent:(event:
    |{type:'message.new';deviceId:string;channelId:string;
      payload:{chatId:string;message:Message}}
    |{type:'message.verified-ack';deviceId:string;channelId:string;
      payload:{chatId:string;messageId:string;ackKind:'DELIVERED'|'READ'|'PLAYED';
        providerAccepted:true;providerDelivered:true;source:'original-dsh-im-sse'|'original-mautrix-meta-sync'}})=>boolean;};
type MountFn = (element:HTMLElement,config:WhatsAppMultiDeviceConfig)=>InboxHandle;
declare global { interface Window { MessagingInbox?: {mount:MountFn} } }
let sharedMountPromise:Promise<MountFn>|null=null;
function loadMatureInbox():Promise<MountFn>{
  if(window.MessagingInbox?.mount)return Promise.resolve(window.MessagingInbox.mount);
  if(!sharedMountPromise){
    sharedMountPromise=new Promise<MountFn>((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='/api/yenra/oss/messaging-inbox.umd.js';
      script.async=true;
      script.dataset.yenraNativeOss='script';
      script.onload=()=>window.MessagingInbox?.mount
        ?resolve(window.MessagingInbox.mount):reject(Error('ORIGINAL_OSS_MOUNT_NOT_EXPORTED'));
      script.onerror=()=>reject(Error('ORIGINAL_DSH_OSS_STATIC_ASSET_UNAVAILABLE'));
      document.head.appendChild(script);
    }).catch(reason=>{sharedMountPromise=null;throw reason});
  }
  return sharedMountPromise;
}
/** Start the SAME mature OSS script loader while the original verified roster
 * is being read. The later inbox mount reuses sharedMountPromise, not another
 * network reader, inbox, database, Socket, or Sender. */
export function warmOriginalMatureInbox():void{
  void loadMatureInbox().catch(()=>undefined)
}
import {
  chatsFromHost, messagesFromHost, paginateMessages, nativeGermanDraftTranslator,
  nativeChineseMessageTranslator,
} from '../../../../social-adapters/oss-candidates/existing-host-generic-mapping.mjs';
import type {
  DeviceConfig, WhatsAppMultiDeviceConfig, Message, Chat, ChatAction, PaginatedMessages,
  SendTextParams, SendMediaParams, SendResult,
} from '../../../../social-adapters/oss-candidates/messaging-inbox/src/lib/providers/types';

type NativeRoom = {
  roomRef:string;name:string|null;nameKnown:boolean;phoneFallback?:string;latestText:string|null;
  contactOrigin?:'local_only'|'existing_chat';localNameSaved?:boolean;
  lastMessageAt:number|null;
  latestMessageId?:string;latestMessageSource?:string;
  contactPreferences?:{pinned:boolean;muted:boolean;archived:boolean;manualUnread:boolean};
  /** Only when Host verified the translation for the exact preview source. */
  latestTranslation?:string|null;
};
type NativeAccount = {
  channel:'WhatsApp'|'Personal'|'Page';
  accountRef:string;rooms:NativeRoom[];displayId?:string;accountLabel?:string;mediaSendSupported?:boolean;
};
type AdoptDraftFn=(accountRef:string,roomRef:string,text:string)=>boolean;
type Props = {
  accounts:NativeAccount[];
  /** Host roster read phase; an empty initial React prop is NOT proof of logout. */
  rosterPhase?:'checking'|'ready'|'unavailable';
  refreshOriginalRoster?:()=>Promise<void>;
  refreshContactDisplay?:()=>Promise<void>;
  /** Expose only the ORIGINAL mature inbox prefill action to the official DSH Slot. */
  bindAdoptDraft?:(adapter:AdoptDraftFn|null)=>void;
  sessionId?:string;
  /** Original authorized DSH Host room endpoint, already scope-checked. */
  readRoom:(channel:NativeAccount['channel'],accountRef:string,roomRef:string)=>Promise<unknown>;
  /** Original DSH /yenra-* manual Sender + verified ACCEPTED receipt only. */
  sendNativeText:(channel:NativeAccount['channel'],accountRef:string,roomRef:string,text:string,quotedId?:string)=>Promise<SendResult>;
  /** Host-only original FB media sender; never B's Composer or own upload server. */
  sendNativeMedia:(channel:NativeAccount['channel'],accountRef:string,roomRef:string,params:SendMediaParams)=>Promise<SendResult>;
  /** Only feeds selected contact context to DSH Brain in the background. */
  onSelected:(accountRef:string,roomRef:string)=>void;
  /** Original OSS null selection: release stale Brain contact without touching OSS drafts. */
  onDeselected?:()=>void;
  /** Reuse the SAME verified Host reply to feed the DSH copilot context. */
  onRoomData:(accountRef:string,roomRef:string,source:unknown)=>void;
  /** Same authenticated original Host SSE MID for an already-selected WA room.
   * Updates only the existing native Brain context, no new reader or sender. */
  onVerifiedInbound?:(accountRef:string,roomRef:string,mid:string,text:string,timestamp:number)=>void;
  /** Verified Agent panel switch; applied through the same layout action a click uses. */
  onPanelOpen?:(panel:string)=>void;
  removeLocalWhatsAppContact:(accountRef:string,roomRef:string,expectedRevision:number)=>Promise<{ok:boolean;removed:boolean;accountRef:string;roomRef:string;localRecordRemoved:boolean;originalChatPreserved:boolean}>;
  resyncWhatsAppContacts:(accountRef:string)=>Promise<{ok:boolean;accountRef:string;reconciled:number;unverifiedLocal:number}>;
  createWhatsAppContact:(accountRef:string,phoneNumber:string,displayName:string)=>Promise<{ok:boolean;saved:boolean;accountRef:string;roomRef:string;phoneNumber:string;displayName:string}>;
  saveContactName:(accountRef:string,roomRef:string,displayName:string,expectedRevision:number)=>Promise<{ok:boolean;saved:boolean;accountRef:string;roomRef:string;displayName:string}>;
  getContactPrefs:(accountRef:string,roomRef:string)=>Promise<{ok:boolean;revision:number;accountRef:string;roomRef:string;localNameSaved?:boolean;localContactSaved?:boolean;preferences:Record<string,boolean>}>;
  saveContactPref:(accountRef:string,roomRef:string,field:string,value:boolean,revision:number)=>Promise<{ok:boolean;saved:boolean;accountRef:string;roomRef:string;preferences:Record<string,boolean>}>;
};
const REF=/^[a-f0-9]{32}$/;
const ACTIVE_SESSION=/^session-[a-f0-9-]{36}$/;


export function OssNativeSocial({accounts,rosterPhase='checking',refreshOriginalRoster,refreshContactDisplay,sessionId,readRoom,sendNativeText,sendNativeMedia,onSelected,onDeselected,onRoomData,onVerifiedInbound,onPanelOpen,getContactPrefs,saveContactPref,saveContactName,createWhatsAppContact,removeLocalWhatsAppContact,resyncWhatsAppContacts,bindAdoptDraft}:Props){
  const nodeRef=useRef<HTMLDivElement|null>(null);
  const refreshOriginalRosterRef=useRef(refreshOriginalRoster);
  refreshOriginalRosterRef.current=refreshOriginalRoster;
  const refreshContactDisplayRef=useRef(refreshContactDisplay);
  refreshContactDisplayRef.current=refreshContactDisplay;
  const mountedRef=useRef<InboxHandle|null>(null);
  const knownRef=useRef(new Map<string,NativeAccount>());
  // Only the mature inbox owns the human draft. Preserve current selected
  // original account + room identity when the DSH advice Slot adopts text.
  const selectedScopeRef=useRef<{accountRef:string;roomRef:string;deviceId:string}|null>(null);
  const bindAdoptDraftRef=useRef(bindAdoptDraft);
  bindAdoptDraftRef.current=bindAdoptDraft;
  const onPanelOpenRef=useRef(onPanelOpen);
  onPanelOpenRef.current=onPanelOpen;
  const adoptViaOriginalInbox=useCallback<AdoptDraftFn>((accountRef,roomRef,text)=>{
    const selected=selectedScopeRef.current;
    const account=selected&&knownRef.current.get(selected.deviceId);
    const mounted=mountedRef.current;
    if(!selected||!account||!mounted||
      !REF.test(accountRef)||!REF.test(roomRef)||
      selected.accountRef!==accountRef||selected.roomRef!==roomRef||
      account.accountRef!==accountRef||
      !account.rooms.some(room=>room.roomRef===roomRef)||
      typeof text!=='string'||!text.trim()||text.length>2000||
      typeof mounted.selectConversation!=='function')return false;
    try{
      // Original mature OSS implements per-room draft prefill. No Sender call,
      // synthetic text input, second draft store or channel network request.
      mounted.selectConversation(roomRef,text.trim(),selected.deviceId);
      return true;
    }catch{return false}
  },[]);
  useEffect(()=>{
    bindAdoptDraftRef.current?.(adoptViaOriginalInbox);
    return()=>bindAdoptDraftRef.current?.(null);
  },[adoptViaOriginalInbox]);
  const handlersRef=useRef({readRoom,sendNativeText,sendNativeMedia,onSelected,onDeselected,onRoomData,onVerifiedInbound,getContactPrefs,saveContactPref,saveContactName,createWhatsAppContact,removeLocalWhatsAppContact,resyncWhatsAppContacts,sessionId});
  handlersRef.current={readRoom,sendNativeText,sendNativeMedia,onSelected,onDeselected,onRoomData,onVerifiedInbound,getContactPrefs,saveContactPref,saveContactName,createWhatsAppContact,removeLocalWhatsAppContact,resyncWhatsAppContacts,sessionId};
  const [signature,setSignature]=useState('');
  // Mount readiness belongs to the existing mature OSS instance, not another
  // workbench. W25 idle lookup starts only AFTER that one instance is ready.
  const [inboxMounted,setInboxMounted]=useState(false);
  const makeDevicesRef=useRef<((known:NativeAccount[])=>DeviceConfig[])|null>(null);
  const mountedIdsRef=useRef(new Set<string>());
  const mountedMediaRef=useRef(new Map<string,boolean>());
  const mountedLabelsRef=useRef(new Map<string,string>());
  // Display-only authenticated own-account identity; never contact identity,
  // an account state authority or a substitute for DSH-IM connection.status.
  const ownProfilesRef=useRef(new Map<string,VerifiedOwnAccountProfile>());
  const lastDisplayTokenRef=useRef('');
  const [startupError,setStartupError]=useState('');
  const [personalReadError,setPersonalReadError]=useState('');
  const personalReadPending=useRef(new Set<string>());
  const personalReadAccepted=useRef(new Set<string>());

  // A successful identity read is retained, but a temporary 503 at startup
  // must NOT permanently freeze the label at "账号 1/2". Reuse only the
  // authenticated original Host profile capability; at most four attempts
  // per WA account, with cancellable bounded backoff, no independent poller.
  const waIdentityRefs=accounts.filter(a=>a.channel==='WhatsApp'&&REF.test(a.accountRef))
    .map(a=>a.accountRef).join('|');
  useEffect(()=>{
    let disposed=false;
    const timers:Array<ReturnType<typeof setTimeout>>=[];
    const resolveIdentity=async(accountRef:string,attempt:number)=>{
      if(disposed||ownProfilesRef.current.has(accountRef))return;
      try{
        const profile=await readOriginalOwnAccountProfile(accountRef);
        if(disposed)return;
        if(profile.displayName||profile.ownPhone){
          ownProfilesRef.current.set(accountRef,profile);
          const known=[...knownRef.current.values()];
          const configured=makeDevicesRef.current?.(known)
            .find(device=>device.instanceName===accountRef);
          if(configured&&mountedIdsRef.current.has(configured.id)){
            mountedRef.current?.updateDevice(configured.id,{label:configured.label});
            mountedLabelsRef.current.set(configured.id,String(configured.label??''));
          }
          return;
        }
      }catch{/* A failed identity read does not mean the account is offline. */}
      if(!disposed&&attempt<3){
        timers.push(setTimeout(()=>{void resolveIdentity(accountRef,attempt+1)},
          [1500,4500,12000][attempt]));
      }
    };
    for(const accountRef of waIdentityRefs.split('|').filter(Boolean))
      void resolveIdentity(accountRef,0);
    return()=>{disposed=true;for(const timer of timers)clearTimeout(timer)};
  },[waIdentityRefs]);

  // Never discard an already verified account just because this refresh was
  // partial (Page 429/DPAPI). The DSH Host remains the identity authority.
  // This is current-renderer presentation state only, not an account store.
  useEffect(()=>{
    for(const account of accounts){
      if(!REF.test(account.accountRef)||!['WhatsApp','Page','Personal'].includes(account.channel))continue;
      const key=account.displayId&&REF.test(account.displayId)?account.displayId:account.accountRef;
      // A newly received Host roster may omit optional contact preferences
      // that were just confirmed by the original Matrix/DSH-IM write.
      // Preserve only those verified flags in this existing rendered roster;
      // never invent a second persisted preferences database.
      const prior=knownRef.current.get(key);
      const verified=new Map(prior?.rooms.filter(room=>room.contactPreferences)
        .map(room=>[room.roomRef,room.contactPreferences] as const)??[]);
      const previousRooms=new Map(prior?.rooms.map(room=>[room.roomRef,room] as const)??[]);
      knownRef.current.set(key,{
        ...account,
        rooms:account.rooms.map(room=>{
          const previous=previousRooms.get(room.roomRef);
          // An older Host snapshot must not roll back a newly verified
          // inbound preview, MID or sort timestamp from the same account.
          const sameVerifiedSource=previous&&
            ((room.latestText??'')===''||
             room.latestText===previous.latestText);
          const keepEvent=previous&&(
            (previous.lastMessageAt??0)>(room.lastMessageAt??0)||
            ((previous.lastMessageAt??0)===(room.lastMessageAt??0)&&
             sameVerifiedSource&&(
               Boolean(previous.latestMessageId&&!room.latestMessageId)||
               Boolean(previous.latestTranslation&&!room.latestTranslation)
             ))
          );
          return {
            ...room,
            ...(keepEvent?{
              latestText:previous.latestText,lastMessageAt:previous.lastMessageAt,
              latestMessageId:previous.latestMessageId,
              latestMessageSource:previous.latestMessageSource,
              latestTranslation:previous.latestTranslation,
            }:{}),
            ...(!room.contactPreferences&&verified.has(room.roomRef)
              ?{contactPreferences:verified.get(room.roomRef)}:{}),
          };
        }),
      });
    }
    const token=[...knownRef.current].map(([id,a])=>[
      id,a.accountRef,a.rooms.length,String(a.mediaSendSupported===true),
      // Name changes must refresh the existing OSS list even when the chat
      // is below the first three rows. Never remount the active inbox.
      ...a.rooms.map(r=>r.roomRef+':'+String(r.name??'')+':'+String(r.nameKnown)+':'+String(r.phoneFallback??'')+
        ':prefs='+['pinned','muted','archived','manualUnread'].map(field=>
          r.contactPreferences?.[field as keyof NonNullable<typeof r.contactPreferences>]===true?'1':'0').join('')),
      ...a.rooms.map(r=>r.roomRef+':latest='+String(r.lastMessageAt)+':'+String(r.latestText??'')),
    ].join(':')).join('|');
    if(token!==lastDisplayTokenRef.current){
      lastDisplayTokenRef.current=token;
      setSignature(token);
    }
  },[accounts]);

  useEffect(()=>{
    if(!signature||!nodeRef.current)return;
    const element=nodeRef.current;
    const known=[...knownRef.current.values()];
    // Reuse the mature provider's existing MID -> verified original Host
    // media-path projection. SSE only contributes another already-authorized
    // MID, never a second downloader, media cache, Socket or Sender.
    // Same already-verified per-device MID projection, with its original
    // room identity retained. No second media cache or network reader.
    const mediaByDevice=new Map<string,Map<string,{roomRef:string;url:string}>>();
    const makeDevices=(source:NativeAccount[]):DeviceConfig[]=>source.map(account=>{
      const id=account.displayId&&REF.test(account.displayId)?account.displayId:account.accountRef;
      const waOrdinal=account.channel==='WhatsApp'
        ?source.filter(item=>item.channel==='WhatsApp')
          .findIndex(item=>item.accountRef===account.accountRef)+1:0;
      const ownProfile=ownProfilesRef.current.get(account.accountRef);
      const verifiedIdentity=ownProfile?.displayName||
        ownProfile?.ownPhone||null;
      const waIdentity=verifiedIdentity
        ?(ownProfile?.ownPhone&&ownProfile.displayName
          ?verifiedIdentity+' · '+ownProfile.ownPhone:verifiedIdentity)
        :'账号 '+waOrdinal;
      const accountLabel=account.channel==='WhatsApp'
        ?'WhatsApp · '+waIdentity+' ('+account.rooms.length+')':
        account.channel==='Page'&&account.accountLabel
          ?account.accountLabel+' ('+account.rooms.length+')':account.channel;
      let mediaById=mediaByDevice.get(id);
      if(!mediaById){mediaById=new Map<string,{roomRef:string;url:string}>();mediaByDevice.set(id,mediaById);}
      const originalHost:NonNullable<DeviceConfig['originalHost']>={
        getConnectionState:async()=>{
          // Mature OSS already polls this provider on its existing cadence.
          // Status comes from original DSH-IM connection.status only: a 503
          // means unknown (loading), never a fabricated online/offline state.
          if(account.channel!=='WhatsApp')return 'loading' as const;
          try{
            const health=await getSharedOriginalHealth();
            const verified=health.accounts.find(item=>item.accountRef===account.accountRef);
            if(!verified)return 'loading' as const;
            if(verified.connected)return 'open' as const;
            return verified.state==='connecting'?'connecting' as const:'close' as const;
          }catch{return 'loading' as const}
        },
        findChats:async()=> {
          const current=knownRef.current.get(id)??account;
          // Display only original Host names. Native scoped avatar endpoint
          // supplies actual archived/SDK avatars, never invented pictures.
          return (chatsFromHost(current) as Chat[]).map(chat=>({
            ...chat,
            profilePicUrl:current.channel==='WhatsApp'
              ?'/api/yenra/social-read?mode=avatar&accountRef='+
                encodeURIComponent(current.accountRef)+'&roomRef='+encodeURIComponent(chat.id)
              :'/api/yenra/facebook-avatar?accountRef='+
                encodeURIComponent(current.accountRef)+'&roomRef='+encodeURIComponent(chat.id),
          }));
        },
        // Do not start an extra W25/DPAPI read in parallel with every cold
        // Page open. pageRoom() owns its existing historical-only fallback when
        // the provider is actually unavailable; live messages win the first screen.
        findMessagesPaginated:async(_instance,roomRef,options)=>{
          const current=knownRef.current.get(id)??account;
          if(!REF.test(roomRef)||!current.rooms.some(r=>r.roomRef===roomRef))
            throw Error('ORIGINAL_AUTHORIZED_ROOM_NOT_PRESENT');
          const source=await handlersRef.current.readRoom(current.channel,current.accountRef,roomRef);
          const messages=messagesFromHost(source,current.accountRef,roomRef) as Message[];
          // Same human-visible-read gate across WhatsApp1/2, Page and Personal.
          // Never clear a local unread badge in place of original provider work.
          if(['WhatsApp','Personal','Page'].includes(current.channel)&&
            (options?.page??1)===1&&
            !(current.channel==='WhatsApp'&&
              current.rooms.find(r=>r.roomRef===roomRef)?.providerPeerKind==='group')){
            const latest=messages.filter(m=>m.direction==='inbound'&&
              (current.channel==='Personal'?/^\$[^\s]{4,179}$/u.test(m.id):
                current.channel==='Page'
                ?/^pancake:\d{1,40}:[^\s]{1,155}$/.test(m.id)
                :/^[A-Za-z0-9_.:~-]{1,180}$/.test(m.id)))
              .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
            if(latest){
              const targetMid=latest.id;
              const key=current.accountRef+'|'+roomRef+'|'+targetMid;
              window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{
                const selected=selectedScopeRef.current;
                const owner=handlersRef.current.sessionId;
                if(!selected||selected.deviceId!==id||
                  selected.accountRef!==current.accountRef||
                  selected.roomRef!==roomRef||
                  document.visibilityState!=='visible'||
                  !owner||!ACTIVE_SESSION.test(owner)||
                  personalReadPending.current.has(key)||
                  personalReadAccepted.current.has(key))return;
                personalReadPending.current.add(key);
                void fetch('/api/yenra/social-native-read',{
                  method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
                  body:JSON.stringify({channel:current.channel,accountRef:current.accountRef,
                    roomRef,mid:targetMid,sessionId:owner}),
                  // Provider may lag on fresh seen status; never block thread paint.
                  signal:AbortSignal.timeout(45000),
                }).then(async response=>{
                  const result=await response.json() as {ok?:boolean;channel?:string;
                    accountRef?:string;roomRef?:string;mid?:string;state?:string;error?:string};
                  const privacyOnly=current.channel==='WhatsApp'&&
                    result.state==='WA_READ_SELF_ONLY';
                  const matchingState=current.channel==='Personal'
                    ?result.state==='MATRIX_RECEIPT_ACCEPTED'
                    :current.channel==='Page'
                      ?result.state==='PAGE_SEEN_CONFIRMED'
                      :result.state==='WA_SOCKET_READ_SUBMITTED'||privacyOnly;
                  if(!response.ok||result.ok!==true||result.channel!==current.channel||
                    result.accountRef!==current.accountRef||
                    result.roomRef!==roomRef||result.mid!==targetMid||!matchingState)
                    throw Error(result.error||'NATIVE_READ_NOT_ACCEPTED');
                  personalReadAccepted.current.add(key);
                  if(personalReadAccepted.current.size>256)
                    personalReadAccepted.current.delete(personalReadAccepted.current.values().next().value!);
                  setPersonalReadError(privacyOnly
                    ?'WhatsApp 当前账号关闭了已读回执，仅本机标为已读；对方不会看到蓝勾。请在 WhatsApp 设置→隐私中开启已读回执。'
                    :'');
                }).catch(e=>{
                  const selectedNow=selectedScopeRef.current;
                  if(selectedNow?.deviceId===id&&selectedNow.roomRef===roomRef)
                    setPersonalReadError(String((e as Error)?.message??'NATIVE_READ_UNAVAILABLE').slice(0,90));
                }).finally(()=>personalReadPending.current.delete(key));
              }));
            }
          }
          // A verified open room is newer than a stale roster snapshot.
          // Update its original OSS preview, time and sort position even if
          // the prior roster's preview was DIFFERENT. The old equality check
          // bound translation MIDs but left Rainer's row at 20:11 despite a
          // genuine 20:40 outbound message already visible in his timeline.
          if(current.channel!=='WhatsApp'){
            // Provider arrays are not guaranteed oldest→newest. The latest
            // real timestamp (not array order) owns contact-list preview.
            const latest=messages.reduce<Message|undefined>((best,m)=>{
              const at=Date.parse(m.createdAt);
              const old=best?Date.parse(best.createdAt):NaN;
              return Number.isFinite(at)&&(!best||!Number.isFinite(old)||at>=old)?m:best;
            },undefined);
            const room=current.rooms.find(row=>row.roomRef===roomRef);
            const at=latest?.createdAt?Date.parse(latest.createdAt):NaN;
            if(room&&latest?.id&&typeof latest.content==='string'&&
               latest.content.length<=4000&&Number.isFinite(at)&&
               at>=1262304000000&&at<=Date.now()+300000&&
               (at>=(room.lastMessageAt??0)||
                // The SDK sometimes timestamps a preview without supplying
                // a real MID. The already authenticated original room may
                // restore the missing text identity even if its timestamp
                // predates that partial roster timestamp. No fabricated MID.
                !room.latestMessageId||!room.latestMessageSource)){
              const effectiveAt=Math.max(at,room.lastMessageAt??0);
              const changed=room.latestMessageId!==latest.id||
                room.latestMessageSource!==latest.content||
                room.latestText!==latest.content.slice(0,240)||
                room.lastMessageAt!==effectiveAt;
              const previousTranslation=room.latestTranslation;
              room.latestMessageId=latest.id;
              room.latestMessageSource=latest.content;
              room.latestText=latest.content.slice(0,240);
              room.lastMessageAt=effectiveAt;
              if(changed)room.latestTranslation=null;
              const saved=latest.metadata?.verifiedTranslation;
              if(typeof saved==='string'&&saved.trim())room.latestTranslation=saved.trim();
              if(changed||previousTranslation!==room.latestTranslation)
                void mountedRef.current?.refreshChats().catch(()=>undefined);
            }
          }
          // DSH Brain only observes this already-verified response; no second
          // Page read, no separate context-fetch request or shadow storage.
          handlersRef.current.onRoomData(current.accountRef,roomRef,source);
          for(const message of messages){
            const path=message.metadata?.nativeMediaPath;
            if(typeof path==='string'&&path.startsWith('/api/yenra/social-read?mode=media&'))
              mediaById.set(message.id,{roomRef,url:path});
            else if(current.channel==='Personal'&&message.hasMedia&&
              message.metadata?.mediaId===message.id&&message.id.startsWith('$')){
              // Only a Matrix event proven by this original authenticated
              // account+room may be resolved via its existing native reader.
              mediaById.set(message.id,{roomRef,url:'/api/yenra/facebook-media?accountRef='+
                encodeURIComponent(current.accountRef)+'&roomRef='+
                encodeURIComponent(roomRef)+'&mid='+encodeURIComponent(message.id)});
            }else if(current.channel==='Page'&&message.hasMedia&&
              typeof message.mediaData?.url==='string'&&
              /^https:\/\//.test(message.mediaData.url)){
              // Reuse ONLY a Page SDK-verified HTTPS media URL already present
              // in this authenticated original room response. Never extract
              // arbitrary links from chat text, or invent missing attachments.
              mediaById.set(message.id,{roomRef,url:message.mediaData.url});
            }
          }
          return paginateMessages(messages,options?.page??1,options?.pageSize??50) as PaginatedMessages;
        },
        sendText:async(_instance,params:SendTextParams)=>{
          const current=knownRef.current.get(id)??account;
          if(!REF.test(params.to)||!current.rooms.some(r=>r.roomRef===params.to))
            throw Error('ORIGINAL_AUTHORIZED_RECIPIENT_NOT_PRESENT');
          return handlersRef.current.sendNativeText(
            current.channel,current.accountRef,params.to,params.body,params.replyToMessageId);
        },
        sendMedia:async(_instance,params:SendMediaParams):Promise<SendResult>=>{
          const current=knownRef.current.get(id)??account;
          if(current.channel==='WhatsApp'&&current.mediaSendSupported!==true)
            throw Error('WHATSAPP_NATIVE_MEDIA_SEND_CAPABILITY_UNVERIFIED_KEEP_DRAFT');
          if(!REF.test(params.to)||!current.rooms.some(room=>room.roomRef===params.to))
            throw Error('ORIGINAL_AUTHORIZED_MEDIA_RECIPIENT_NOT_PRESENT');
          // Original DSH-IM supports an ordinary document/file attachment,
          // not WhatsApp PTT. Route approved MP3 through that same native
          // document Sender; all Host MIME/signature/identity checks remain.
          const mp3File=current.channel==='WhatsApp'&&
            params.mediaType==='audio'&&params.mimeType?.toLowerCase()==='audio/mpeg'&&
            /\.mp3$/i.test(params.fileName??'');
          if(current.channel==='WhatsApp'&&params.mediaType==='audio'&&!mp3File)
            throw Error('WHATSAPP_NATIVE_AUDIO_FORMAT_UNVERIFIED_KEEP_DRAFT');
          return handlersRef.current.sendNativeMedia(
            current.channel,current.accountRef,params.to,
            mp3File?{...params,mediaType:'document'}:params);
        },
        getMediaUrl:async(_instance,mid,scopedRoomRef)=>{
          if(_instance!==account.accountRef)return null;
          const item=mediaById.get(mid);
          if(!item||scopedRoomRef&&item.roomRef!==scopedRoomRef)return null;
          // Existing message UI still uses the two-argument media reader;
          // export supplies roomRef to protect against same-MID collisions.
          return item.url;
        },
      };
      return {
        id,instanceName:account.accountRef,label:accountLabel,
        sourceChannel:account.channel,
        // Mature OSS already supports DeviceConfig.icon. Use the existing
        // authenticated own-account avatar URL, never a contact's picture.
        ...(account.channel==='WhatsApp'?{icon:'/api/yenra/social-read?mode=account-avatar&accountRef='+
          encodeURIComponent(account.accountRef)}:{}),
        apiUrl:window.location.origin,instanceToken:'native-session-only',
        providerType:'generic-server',readonly:false,
        contactActionsSupported:true,
        // Exact current Host capability: ordinary MP3 as WhatsApp file only,
        // never PTT or a native WhatsApp voice-note bubble.
        ...(account.channel==='WhatsApp'&&account.mediaSendSupported===true?{
          mediaAccept:'image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,audio/mpeg',
          mediaMaxBytes:8*1024*1024,
        }:{}),
        autoRead:false,websocket:{enabled:false},originalHost,
        translateDraftToGerman:async input=>{
          const current=knownRef.current.get(id)??account;
          const owner=handlersRef.current.sessionId;
          if(!owner||!ACTIVE_SESSION.test(owner))throw Error('OFFICIAL_OWNER_SESSION_NOT_READY');
          return nativeGermanDraftTranslator({
            channel:current.channel,accountRef:current.accountRef,
            sessionId:owner,fetchImpl:fetch.bind(window),
          })(input);
        },
        translateContactPreview:async input=>{
          const current=knownRef.current.get(id)??account;
          const room=current.rooms.find(r=>r.roomRef===input.roomRef);
          if(!room||room.latestMessageId!==input.id||
              room.latestMessageSource!==input.text)
            throw Error('ORIGINAL_PREVIEW_MESSAGE_NOT_VERIFIED');
          const owner=handlersRef.current.sessionId;
          if(!owner||!ACTIVE_SESSION.test(owner))throw Error('OFFICIAL_OWNER_SESSION_NOT_READY');
          const result=await nativeChineseMessageTranslator({
            channel:current.channel,accountRef:current.accountRef,
            sessionId:owner,fetchImpl:fetch.bind(window),
          })({roomRef:input.roomRef,items:[{id:input.id,text:input.text}],
            // The mature DSH Domain/W25 is the only preview cache.
            // Contact-list paint MUST NOT start a paid model call. The active
            // conversation continues to use the full original translation.
            cachedOnly:true});
          const translation=result[0]?.translation?.trim()??'';
          if(translation && room.latestMessageId===input.id &&
             room.latestMessageSource===input.text)room.latestTranslation=translation;
          return translation;
        },
        translateVisibleMessagesToChinese:async input=>{
          const current=knownRef.current.get(id)??account;
          if(!REF.test(input.roomRef)||!current.rooms.some(r=>r.roomRef===input.roomRef))
            throw Error('ORIGINAL_AUTHORIZED_ROOM_NOT_PRESENT');
          const owner=handlersRef.current.sessionId;
          if(!owner||!ACTIVE_SESSION.test(owner))throw Error('OFFICIAL_OWNER_SESSION_NOT_READY');
          const translated=await nativeChineseMessageTranslator({
            channel:current.channel,accountRef:current.accountRef,
            sessionId:owner,fetchImpl:fetch.bind(window),
          })(input);
          // The active conversation always takes priority. Reuse its verified
          // translation as the existing contact-list preview, at zero extra
          // model expense, only when current account + exact MID/text match.
          const live=knownRef.current.get(id);
          if(live?.accountRef===current.accountRef){
            const room=live.rooms.find(row=>row.roomRef===input.roomRef);
            const match=translated.find((row:{id:string;translation:string})=>
              row.id===room?.latestMessageId);
            if(room&&match?.translation&&input.items.some((item:{id:string;text:string})=>
              item.id===room.latestMessageId&&item.text===room.latestMessageSource)){
              room.latestTranslation=match.translation;
              void mountedRef.current?.refreshChats().catch(()=>undefined);
            }
          }
          return translated;
        },
        capabilities:{
          templates:false,messagingWindow24h:false,pushToTalk:false,
          interactiveButtons:false,deleteForEveryone:false,
          markAsRead:false,quoteReplies:account.channel==='Personal',
          mediaSend:account.channel==='Personal'||account.channel==='Page'||
            (account.channel==='WhatsApp'&&account.mediaSendSupported===true), // Original Host image/document only; voice/video unsupported.
          conversationInitiation:{canInitiate:false,identifierType:'opaque'},
        },
      } satisfies DeviceConfig;
    });
    const devices=makeDevices(known);
    makeDevicesRef.current=makeDevices;
    const config:WhatsAppMultiDeviceConfig={
      devices,defaultDeviceId:devices[0]?.id,
      onSourceRefresh:async()=>{await refreshOriginalRosterRef.current?.()},
      createContact:async(device,phoneNumber,displayName)=>{
        const account=knownRef.current.get(device.id);
        if(!account||account.channel!=='WhatsApp'||device.instanceName!==account.accountRef)
          throw Error('请先选择正确的 WhatsApp 账号');
        const result=await handlersRef.current.createWhatsAppContact(
          account.accountRef,phoneNumber,displayName);
        if(result.accountRef!==account.accountRef||!REF.test(result.roomRef)||
           result.phoneNumber!==phoneNumber||result.displayName!==displayName)
          throw Error('原生联系人保存回执不匹配');
        const existing=account.rooms.find(room=>room.roomRef===result.roomRef);
        if(existing){existing.name=displayName;existing.nameKnown=true;existing.localNameSaved=true;}
        else account.rooms.push({
          roomRef:result.roomRef,name:displayName,nameKnown:true,contactOrigin:'local_only',
          localNameSaved:true,phoneFallback:phoneNumber,lastMessageAt:null,latestText:null,
          contactPreferences:{pinned:false,muted:false,archived:false,manualUnread:false},
        });
        // Redraw immediately; refresh official Host's single source snapshot in the background.
        await mountedRef.current?.refreshChats();
        void refreshContactDisplayRef.current?.().catch(()=>undefined);
        return {roomRef:result.roomRef,phoneNumber,displayName};
      },
      translations:yenraInboxChinese,
      // Use original Matrix account_data for genuine FB contact preferences.
      // Resolver is lazy: no network/DPAPI work during chat or roster paint.
      chatActions:async(chat,device)=>{
        const current=knownRef.current.get(device.id);
        if(!current||!current.rooms.some(room=>room.roomRef===chat.id))return [];
        const state=await handlersRef.current.getContactPrefs(current.accountRef,chat.id);
        if(!state.ok||state.accountRef!==current.accountRef||
          state.roomRef!==chat.id||!Number.isSafeInteger(state.revision))
          throw Error('原生联系人偏好未就绪');
        const labels={
          pinned:['置顶','取消置顶'],
          muted:['静音','取消静音'],
          archived:['归档','取消归档'],
          manualUnread:['标记未读','取消未读标记'],
        } as const;
        const actions:ChatAction[]=(Object.keys(labels) as Array<keyof typeof labels>).map(field=>{
          const enabled=state.preferences[field]===true;
          return {id:field,label:labels[field][enabled?1:0],
            onClick:async(selectedChat,selectedDevice)=>{
              if(selectedChat.id!==chat.id||selectedDevice.id!==device.id)
                throw Error('联系人已切换');
              const live=knownRef.current.get(device.id);
              if(live?.accountRef!==current.accountRef||
                !live.rooms.some(room=>room.roomRef===chat.id))
                throw Error('原账号或房间已改变');
              const result=await handlersRef.current.saveContactPref(
                current.accountRef,chat.id,field,!enabled,state.revision);
              if(!result.ok||result.saved!==true||
                result.accountRef!==current.accountRef||result.roomRef!==chat.id||
                result.preferences?.[field]!==!enabled)
                throw Error('原偏好存储未确认保存');
              // All three channels must reflect the *confirmed* original
              // Host write in the existing mature OSS list immediately.
              // WhatsApp persists via original DSH-IM Storage Domain;
              // Personal/Page persist via original Matrix account_data.
              const room=live.rooms.find(row=>row.roomRef===chat.id);
              if(room&&result.preferences){
                room.contactPreferences={
                  pinned:result.preferences.pinned===true,
                  muted:result.preferences.muted===true,
                  archived:result.preferences.archived===true,
                  manualUnread:result.preferences.manualUnread===true,
                };
                await mountedRef.current?.refreshChats();
              }
            }};
        });
        if(current.channel==='WhatsApp')actions.push({
          id:'rename-contact',label:'保存或修改联系人姓名',
          onClick:async(selectedChat,selectedDevice,displayName)=>{
            if(selectedChat.id!==chat.id||selectedDevice.id!==device.id)
              throw Error('联系人已切换');
            const proposed=typeof displayName==='string'?displayName.trim():'';
            if(!proposed||proposed.length>80)throw Error('姓名需要 1～80 个字符');
            const stateNow=await handlersRef.current.getContactPrefs(current.accountRef,chat.id);
            if(!stateNow.ok||stateNow.accountRef!==current.accountRef||stateNow.roomRef!==chat.id)
              throw Error('当前联系人校验失败');
            const result=await handlersRef.current.saveContactName(
              current.accountRef,chat.id,proposed,stateNow.revision);
            if(!result.ok||!result.saved||result.displayName!==proposed||
              result.accountRef!==current.accountRef||result.roomRef!==chat.id)
              throw Error('联系人姓名未确认保存');
            const live=knownRef.current.get(device.id);
            const room=live?.accountRef===current.accountRef
              ?live.rooms.find(item=>item.roomRef===chat.id):null;
            if(room){room.name=proposed;room.nameKnown=true;room.localNameSaved=true;await mountedRef.current?.refreshChats();}
            void refreshContactDisplayRef.current?.().catch(()=>undefined);
          },
        });
        if(current.channel==='WhatsApp'){
          if(state.localNameSaved||state.localContactSaved)actions.push({
            id:'remove-local-contact',label:'移除本地保存（保留原消息）',
            onClick:async(selectedChat,selectedDevice)=>{
              if(selectedChat.id!==chat.id||selectedDevice.id!==device.id)
                throw Error('联系人已切换');
              const latest=await handlersRef.current.getContactPrefs(current.accountRef,chat.id);
              if(!latest.ok||latest.accountRef!==current.accountRef||latest.roomRef!==chat.id)
                throw Error('联系人身份已变化');
              const result=await handlersRef.current.removeLocalWhatsAppContact(
                current.accountRef,chat.id,latest.revision);
              if(!result.ok||!result.removed||result.accountRef!==current.accountRef||
                 result.roomRef!==chat.id)throw Error('本地联系人移除未确认');
              const live=knownRef.current.get(device.id);
              if(live?.accountRef===current.accountRef){
                if(result.localRecordRemoved&&!result.originalChatPreserved)
                  live.rooms=live.rooms.filter(room=>room.roomRef!==chat.id);
                else {
                  const found=live.rooms.find(room=>room.roomRef===chat.id);
                  if(found){found.name=null;found.nameKnown=false;found.localNameSaved=false;}
                }
                await mountedRef.current?.refreshChats();
              }
              void refreshContactDisplayRef.current?.().catch(()=>undefined);
            },
          });
          actions.push({
            id:'resync-contact',label:'重新同步本账号联系人',
            onClick:async(selectedChat,selectedDevice)=>{
              if(selectedChat.id!==chat.id||selectedDevice.id!==device.id)
                throw Error('账号或联系人已切换');
              const result=await handlersRef.current.resyncWhatsAppContacts(current.accountRef);
              if(!result.ok||result.accountRef!==current.accountRef)
                throw Error('重新同步未确认');
              await refreshContactDisplayRef.current?.();
              await mountedRef.current?.refreshChats();
            },
          });
        }
        return actions;
      },
      onConversationSelected:selection=>{
        if(!selection){
          selectedScopeRef.current=null;
          handlersRef.current.onDeselected?.();
          return;
        }
        const current=knownRef.current.get(selection.deviceId);
        if(current&&current.rooms.some(r=>r.roomRef===selection.roomRef)){
          selectedScopeRef.current={
            accountRef:current.accountRef,roomRef:selection.roomRef,deviceId:selection.deviceId,
          };
          // Never block OSS selection or its own human draft on DSH Brain work.
          handlersRef.current.onSelected(current.accountRef,selection.roomRef);
        }else{
          // A stale/unknown original room must not leave the previous person's
          // native Brain history visible while no verified room is selected.
          selectedScopeRef.current=null;
          handlersRef.current.onDeselected?.();
        }
      },
    };
    const stylesheet=document.createElement('link');
    stylesheet.rel='stylesheet';
    stylesheet.href='/api/yenra/oss/messaging-inbox.css';
    stylesheet.dataset.yenraNativeOss='stylesheet';
    // The mature OSS script can finish before its stylesheet. Never mount
    // bare HTML controls; wait for the original official stylesheet load event.
    // A failed stylesheet leaves an explicit error, not an unstyled chat.
    const cssReady=new Promise<void>((resolve,reject)=>{
      stylesheet.addEventListener('load',()=>resolve(),{once:true});
      stylesheet.addEventListener('error',()=>reject(Error('原生收件箱样式加载失败')),{once:true});
    });
    document.head.appendChild(stylesheet);
    let disposed=false;
    let originalEvents:EventSource|null=null;
    void Promise.all([loadMatureInbox(),cssReady]).then(([mount])=>{
      if(disposed)return;
      mountedRef.current=mount(element,config);
      setInboxMounted(true);
      mountedIdsRef.current=new Set(devices.map(d=>d.id));
      mountedMediaRef.current=new Map(devices.map(d=>[d.id,d.capabilities?.mediaSend===true]));
      mountedLabelsRef.current=new Map(devices.map(d=>[d.id,String(d.label??'')]));
      // React's official mount is async: allow its imperative bridge to commit.
      window.requestAnimationFrame(()=>{
        if(disposed||!mountedRef.current)return;
        const available=makeDevices([...knownRef.current.values()]);
        const added=available.filter(d=>!mountedIdsRef.current.has(d.id));
        if(added.length){
          try{
            mountedRef.current.addDevices(added);
            added.forEach(d=>{mountedIdsRef.current.add(d.id);
              mountedMediaRef.current.set(d.id,d.capabilities?.mediaSend===true);
              mountedLabelsRef.current.set(d.id,String(d.label??''));});
          }catch(e){setStartupError('原生账号增量恢复异常：'+String(e));}
        }
        // A restored Host may reveal WA media support after the old device
        // was mounted. Patch the original OSS device; never remount the inbox.
        for(const device of available){
          if(!mountedIdsRef.current.has(device.id))continue;
          const supported=device.capabilities?.mediaSend===true;
          if(mountedMediaRef.current.get(device.id)===supported)continue;
          try{
            mountedRef.current.updateDevice(device.id,{capabilities:device.capabilities});
            mountedMediaRef.current.set(device.id,supported);
          }catch(e){setStartupError('原账号媒体能力同步失败：'+String(e));}
        }
      });
      // The original DSH-IM Socket already saves inbound messages while AI
      // auto-hosting is OFF. Observe those local authoritative writes through
      // the SAME DSH WebServer; never establish another WhatsApp Socket or
      // poll Facebook Page. EventSource provides only a passive UI feed.
      originalEvents=new EventSource('/api/yenra/social-events');
      // Initial Matrix /sync carries historic latest messages. Update the
      // original OSS list only: no unread increment, no Toast, no duplicate
      // message bubble and no second model/translation request.
      let personalPreviewScheduled=false;
      originalEvents.addEventListener('personal-preview',event=>{
        if(disposed||!mountedRef.current)return;
        try{
          const row=JSON.parse(String((event as MessageEvent).data)) as
            {channel?:unknown;source?:unknown;accountRef?:unknown;roomRef?:unknown;
             mid?:unknown;text?:unknown;timestamp?:unknown;direction?:unknown};
          if(row.channel!=='Personal'||
             row.source!=='OFFICIAL_MAUTRIX_META_MATRIX_SYNC'||
             typeof row.accountRef!=='string'||!REF.test(row.accountRef)||
             typeof row.roomRef!=='string'||!REF.test(row.roomRef)||
             typeof row.mid!=='string'||!row.mid.startsWith('$')||row.mid.length>180||
             typeof row.text!=='string'||row.text.length>4000||
             typeof row.timestamp!=='number'||!Number.isFinite(row.timestamp)||
             row.timestamp<1262304000000||row.timestamp>Date.now()+300000||
             !['INBOUND','OUTBOUND'].includes(String(row.direction)))return;
          const key=[...knownRef.current].find(([,a])=>
            a.channel==='Personal'&&a.accountRef===row.accountRef)?.[0];
          const account=key&&knownRef.current.get(key);
          if(!key||!account)return;
          const old=account.rooms.find(room=>room.roomRef===row.roomRef);
          if(!old||(old.lastMessageAt??0)>row.timestamp)return;
          if(old.lastMessageAt===row.timestamp&&old.latestMessageId===row.mid&&
             old.latestText===row.text.slice(0,240))return;
          const rooms=account.rooms.map(room=>room.roomRef!==row.roomRef?room:{
            ...room,latestText:row.text.slice(0,240),lastMessageAt:row.timestamp,
            latestMessageId:row.mid,latestMessageSource:row.text,latestTranslation:null,
          });
          knownRef.current.set(key,{...account,rooms});
          if(!personalPreviewScheduled){
            personalPreviewScheduled=true;
            window.requestAnimationFrame(()=>{
              personalPreviewScheduled=false;
              if(!disposed)void mountedRef.current?.refreshChats().catch(()=>undefined);
            });
          }
        }catch{/* unknown Matrix events do not enter the UI */}
      });
      // Verified Agent actions arrive on THIS already-open same-origin stream.
      // Each is re-validated here and applied by the exact code path a click
      // uses, so Agent and UI converge on one Host authority and one UI state.
      originalEvents.addEventListener('yenra-contact-changed',()=>{
        if(disposed)return;
        void Promise.resolve(refreshOriginalRosterRef.current()).catch(()=>undefined);
      });
      originalEvents.addEventListener('yenra-draft-adopt',event=>{
        if(disposed)return;
        try{
          const row=JSON.parse(String((event as MessageEvent).data)) as {
            accountRef?:unknown;roomRef?:unknown;text?:unknown};
          if(typeof row.accountRef!=='string'||!REF.test(row.accountRef)||
            typeof row.roomRef!=='string'||!REF.test(row.roomRef)||
            typeof row.text!=='string'||!row.text.trim()||row.text.length>2000)return;
          // Reuses the SAME Adopt prefill: only the currently selected room,
          // original input only, never the Sender.
          adoptViaOriginalInbox(row.accountRef,row.roomRef,row.text.trim());
        }catch{/* malformed frames never touch the inbox */}
      });
      originalEvents.addEventListener('yenra-panel-open',event=>{
        if(disposed)return;
        try{
          const row=JSON.parse(String((event as MessageEvent).data)) as {panel?:unknown};
          if(typeof row.panel!=='string')return;
          if(!['conversation','yenra-desktop-chat','yenra-memory-relations',
            'yenra-scout-market','yenra-meta-ads','schedules','plugins'].includes(row.panel))return;
          onPanelOpenRef.current?.(row.panel);
        }catch{/* malformed frames never switch the UI */}
      });
      originalEvents.onmessage=event=>{
        if(disposed||!mountedRef.current)return;
        try{
          const row=JSON.parse(String(event.data)) as {
            accountRef?:unknown;roomRef?:unknown;mid?:unknown;
            text?:unknown;direction?:unknown;timestamp?:unknown;name?:unknown;
            nativeMediaType?:unknown;channel?:unknown;source?:unknown;
          };
          if(typeof row.accountRef!=='string'||!REF.test(row.accountRef)||
            typeof row.roomRef!=='string'||!REF.test(row.roomRef)||
            typeof row.mid!=='string'||!row.mid||row.mid.length>180||
            typeof row.text!=='string'||row.text.length>4000||
            typeof row.timestamp!=='number'||!Number.isFinite(row.timestamp)||
            row.timestamp<1262304000000||row.timestamp>Date.now()+300000)return;
          // Page events require original provider proof. Personal events use
          // the SAME original Matrix principal + verified room, never an
          // untrusted Facebook Webhook or a second account connection.
          const isPage=row.channel==='Page';
          const isPersonal=row.channel==='Personal';
          if(isPage&&row.source!=='ORIGINAL_SIGNED_PANCAKE_AND_PROVIDER_GET'&&
              row.source!=='SENDPULSE_OFFICIAL_REST_API_VERIFIED')return;
          if(isPersonal&&(row.source!=='OFFICIAL_MAUTRIX_META_MATRIX_SYNC'||
              !row.mid.startsWith('$')))return;
          if(!isPage&&!isPersonal&&row.channel!==undefined&&row.channel!=='WhatsApp')return;
          if(row.direction!=='INBOUND'&&!(isPersonal&&row.direction==='OUTBOUND'))return;
          const key=[...knownRef.current].find(([,account])=>
            account.channel===(isPage?'Page':isPersonal?'Personal':'WhatsApp')&&
            account.accountRef===row.accountRef)?.[0];
          if(!key)return;
          const account=knownRef.current.get(key);
          if(!account)return;
          const existing=account.rooms.find(room=>room.roomRef===row.roomRef);
          if(!existing){
            // Another original DSH-IM account contact was created by a
            // natural inbound message; no second provider or invented name.
            const room:NativeRoom={
              roomRef:row.roomRef,name:typeof row.name==='string'&&row.name.trim()
                ?row.name.slice(0,100):null,
              nameKnown:typeof row.name==='string'&&Boolean(row.name.trim()),
              latestText:row.text.slice(0,240),lastMessageAt:row.timestamp,
              latestMessageId:row.mid,latestMessageSource:row.text,
            };
            knownRef.current.set(key,{...account,rooms:[room,...account.rooms]});
            setSignature(previous=>previous+'|new:'+row.roomRef+':'+row.timestamp);
          }else if(row.timestamp >= (existing.lastMessageAt??0)){
            // EventBus updates the mature OSS row; keep the original Host
            // provider snapshot aligned without a remount or network read.
            const rooms=account.rooms.map(room=>room.roomRef!==row.roomRef?room:{
              ...room,latestText:row.text.slice(0,240),
              lastMessageAt:row.timestamp,latestMessageId:row.mid,
              latestMessageSource:row.text,latestTranslation:null,
            });
            knownRef.current.set(key,{...account,rooms});
          }
          // Original DSH-IM has already authenticated this inbound event;
          // the same existing media endpoint rechecks account, room, MID and
          // live media availability at request time. Never fabricate bytes.
          const nativeType=['image','video','audio','file'].includes(String(row.nativeMediaType))
            ?String(row.nativeMediaType):null;
          if(nativeType){
            const mediaById=mediaByDevice.get(key);
            if(mediaById){
              mediaById.set(row.mid,{roomRef:row.roomRef,
                url:isPersonal
                  ?'/api/yenra/facebook-media?accountRef='+
                    encodeURIComponent(account.accountRef)+'&roomRef='+
                    encodeURIComponent(row.roomRef)+'&mid='+encodeURIComponent(row.mid)
                  :'/api/yenra/social-read?mode=media&accountRef='+
                    encodeURIComponent(account.accountRef)+'&roomRef='+
                    encodeURIComponent(row.roomRef)+'&mid='+encodeURIComponent(row.mid)});
              // Reuse the original scoped media source, not another cache.
              while(mediaById.size>200)mediaById.delete(mediaById.keys().next().value!);
            }
          }
          const message:Message={
            id:row.mid,content:row.text,
            // The original Matrix provider supplies real INBOUND/OUTBOUND.
            ...(typeof row.name==='string'&&row.name.trim()?{senderName:row.name.slice(0,100)}:{}),
            direction:row.direction==='OUTBOUND'?'outbound':'inbound',phoneNumber:row.roomRef,
            createdAt:new Date(row.timestamp).toISOString(),
            messageType:nativeType?(nativeType==='file'?'document':nativeType):'text',
            hasMedia:!!nativeType,
            ...(nativeType?{metadata:{mediaId:row.mid}}:{}),
          };
          // Feed this same verified original inbound MID into the selected
          // DSH Brain context: the mature OSS has already received the event.
          // This is a state signal, not another chat fetch or model request.
          if(row.direction==='INBOUND'&&
             selectedScopeRef.current?.accountRef===account.accountRef&&
             selectedScopeRef.current.roomRef===row.roomRef)
            handlersRef.current.onVerifiedInbound?.(
              account.accountRef,row.roomRef,row.mid,row.text,row.timestamp);
          const delivered=mountedRef.current.emitOriginalHostEvent({
            type:'message.new',deviceId:key,channelId:account.accountRef,
            payload:{chatId:row.roomRef,message},
          });
          // First native React commit is asynchronous; one immediate frame
          // retry is enough, never queue duplicate provider reads or sends.
          if(!delivered)window.requestAnimationFrame(()=>{
            if(!disposed)mountedRef.current?.emitOriginalHostEvent({
              type:'message.new',deviceId:key,channelId:account.accountRef,
              payload:{chatId:row.roomRef,message},
            });
          });
        }catch{/* untrusted/malformed event never affects social UI */}
      };
      // Reuse this already-open, same-origin original DSH-IM SSE connection.
      // Named verified delivery receipts must NOT be passed to onmessage.
      // No second EventSource, provider connection, Sender or message cache.
      // The original authenticated Matrix /sync can emit a peer m.receipt.
      // Reuse this EventSource and mature OSS event bus; never open another.
      originalEvents.addEventListener('personal-read-ack',event=>{
        if(disposed||!mountedRef.current)return;
        try{
          const ack=JSON.parse(String((event as MessageEvent).data)) as Record<string,unknown>;
          if(ack.channel!=='Personal'||
            ack.source!=='OFFICIAL_MAUTRIX_META_MATRIX_SYNC_RECEIPT'||
            typeof ack.accountRef!=='string'||!REF.test(ack.accountRef)||
            typeof ack.roomRef!=='string'||!REF.test(ack.roomRef)||
            typeof ack.mid!=='string'||!ack.mid.startsWith('$')||ack.mid.length>180||
            ack.ackKind!=='READ'||ack.providerRead!==true||
            ack.providerAccepted!==true||ack.providerDelivered!==true)return;
          const original=[...knownRef.current].find(([,account])=>
            account.channel==='Personal'&&account.accountRef===ack.accountRef&&
            account.rooms.some(room=>room.roomRef===ack.roomRef));
          if(!original)return;
          const [deviceId,account]=original;
          mountedRef.current.emitOriginalHostEvent({
            type:'message.verified-ack',deviceId,channelId:account.accountRef,
            payload:{chatId:ack.roomRef,messageId:ack.mid,ackKind:'READ',
              providerAccepted:true,providerDelivered:true,source:'original-mautrix-meta-sync'}
          });
        }catch{/* Fail closed on malformed or out-of-scope receipts. */}
      });
      originalEvents.addEventListener('delivery-ack',event=>{
        if(disposed||!mountedRef.current)return;
        try{
          const ack=JSON.parse(String((event as MessageEvent).data)) as Record<string,unknown>;
          if(ack.channel!=='WhatsApp'||
            typeof ack.accountRef!=='string'||!REF.test(ack.accountRef)||
            typeof ack.roomRef!=='string'||!REF.test(ack.roomRef)||
            typeof ack.mid!=='string'||!ack.mid||ack.mid.length>180||
            !['DELIVERED','READ','PLAYED'].includes(String(ack.ackKind))||
            ack.providerAccepted!==true||ack.providerDelivered!==true||
            ((ack.ackKind==='READ'||ack.ackKind==='PLAYED')&&ack.providerRead!==true))return;
          const original=[...knownRef.current].find(([,account])=>
            account.channel==='WhatsApp'&&account.accountRef===ack.accountRef&&
            account.rooms.some(room=>room.roomRef===ack.roomRef));
          if(!original)return;
          const [deviceId,account]=original;
          mountedRef.current.emitOriginalHostEvent({
            type:'message.verified-ack',deviceId,channelId:account.accountRef,
            payload:{chatId:ack.roomRef,messageId:ack.mid,
              ackKind:ack.ackKind as 'DELIVERED'|'READ'|'PLAYED',
              providerAccepted:true,providerDelivered:true,
              source:'original-dsh-im-sse'},
          });
        }catch{/* Malformed or unauthorized receipts cannot change any bubble. */}
      });
      setStartupError('');
    }).catch(reason=>{if(!disposed)setStartupError(String(reason))});
    return()=>{
      disposed=true;
      selectedScopeRef.current=null;
      originalEvents?.close();
      mountedRef.current?.unmount();
      mountedRef.current=null;
      mountedIdsRef.current.clear();
      mountedMediaRef.current.clear();
      mountedLabelsRef.current.clear();
      makeDevicesRef.current=null;
      stylesheet.remove();
    };
  },[Boolean(signature)]);

  // Same mounted mature OSS instance across incremental Page/WhatsApp recovery.
  // Never remount the entire inbox or drop active drafts/hot-room snapshots.
  useEffect(()=>{
    const active=mountedRef.current,make=makeDevicesRef.current;
    if(!active||!make)return;
    const latest=make([...knownRef.current.values()]);
    const added=latest.filter(device=>!mountedIdsRef.current.has(device.id));
    if(added.length){
      try{
        active.addDevices(added);
        added.forEach(device=>{mountedIdsRef.current.add(device.id);
          mountedMediaRef.current.set(device.id,device.capabilities?.mediaSend===true);
          mountedLabelsRef.current.set(device.id,String(device.label??''));});
      }catch(error){setStartupError('账号增量恢复暂不可用：'+String(error));}
    }
    let updatedCapability=false;
    let updatedLabel=false;
    for(const device of latest){
      if(!mountedIdsRef.current.has(device.id))continue;
      const label=String(device.label??'');
      if(mountedLabelsRef.current.get(device.id)!==label){
        try{
          active.updateDevice(device.id,{label:device.label});
          mountedLabelsRef.current.set(device.id,label);
          updatedLabel=true;
        }catch(error){setStartupError('原账号显示名称同步失败：'+String(error));}
      }
      const supported=device.capabilities?.mediaSend===true;
      if(mountedMediaRef.current.get(device.id)===supported)continue;
      try{
        // Use the mature OSS existing imperative bridge, not addDevices():
        // addDevices intentionally ignores already registered account IDs.
        active.updateDevice(device.id,{capabilities:device.capabilities});
        mountedMediaRef.current.set(device.id,supported);
        updatedCapability=true;
      }catch(error){setStartupError('原媒体能力恢复失败：'+String(error));}
    }
    if(!added.length&&!updatedCapability&&!updatedLabel){
      // Local Host-only contact snapshot changes never query Page SDK.
      void active.refreshChats().catch(()=>undefined);
    }
  },[signature]);

  // Ask the SAME original Host for verified W25 Chinese previews only during
  // browser idle time. The ordinary roster GET, room-open and provider reads
  // stay independent. Neither a model request nor a new cache/database exists.
  useEffect(()=>{
    if(!signature||!inboxMounted||!mountedRef.current||
       !window.requestIdleCallback)return;
    const controller=new AbortController();
    const idle=window.requestIdleCallback(()=>{
      void fetch('/api/yenra/oss-roster?verifiedW25=1',{
        method:'GET',cache:'no-store',signal:controller.signal,
      }).then(async response=>{
        if(!response.ok)return null;
        return await response.json() as {ok?:boolean;translations?:Array<{
          accountRef:string;roomRef:string;original:string;
          at:number|null;translation:string;
        }>};
      }).then(payload=>{
        if(controller.signal.aborted||payload?.ok!==true||
           !Array.isArray(payload.translations))return;
        let changed=false;
        for(const row of payload.translations){
          if(!REF.test(row.accountRef)||!REF.test(row.roomRef)||
             typeof row.original!=='string'||!row.original.trim()||
             typeof row.translation!=='string'||!/[\u4e00-\u9fff]/u.test(row.translation))continue;
          const account=[...knownRef.current.values()].find(a=>
            a.channel==='Page'&&a.accountRef===row.accountRef);
          const room=account?.rooms.find(r=>r.roomRef===row.roomRef);
          if(!room||room.latestText!==row.original||
             room.lastMessageAt!==row.at||
             room.latestTranslation===row.translation)continue;
          room.latestTranslation=row.translation;
          changed=true;
        }
        if(changed&&!controller.signal.aborted)
          void mountedRef.current?.refreshChats().catch(()=>undefined);
      }).catch(()=>undefined);
    },{timeout:8000});
    return()=>{controller.abort();window.cancelIdleCallback?.(idle)};
  },[signature,inboxMounted]);

  return <div className="yenra-oss-native-wrap" data-yenra-mature-inbox="native"
    style={{width:'100%',height:'100%',minWidth:0,minHeight:0,display:'flex',flexDirection:'column'}}>
    {startupError?<p role="status">社交收件箱未就绪：{startupError}</p>:null}
    {personalReadError?<p role="status" style={{padding:'4px 12px'}}>
      平台已读同步未确认：{personalReadError}</p>:null}
    {!signature?<div role="status" style={{padding:12}}>{accounts.length>0
      ?'正在同步已连接账号…'
      :rosterPhase==='checking'?'正在读取已授权的社交账号与联系人…'
      :rosterPhase==='unavailable'?'社交账号状态暂时无法读取，请点击重试名册。'
      :'尚未发现已连接的 Facebook 或 WhatsApp 账号，可在设置中登录。'}</div>:null}
    <div ref={nodeRef} style={{width:'100%',flex:1,minHeight:0}}/>
  </div>;
}
