#!/usr/bin/env node
/**
 * YENRA <-> Chatwoot bridge entry point.
 *
 * Startup order is fail-closed:
 *  1. read configuration (no secrets printed);
 *  2. read the current DSH Host roster (GET only);
 *  3. resolve + verify the four Chatwoot API inbox bindings (GET only);
 *  4. optionally construct the Host Sender gate (only when ENABLE_REAL_SEND=true
 *     and a real owner Session id was configured);
 *  5. open the Host's existing single SSE read feed and the local webhook server.
 *
 * Nothing is written to Chatwoot before step 3 succeeds, and nothing is ever
 * written to the Host in the inbound direction.
 */
import { loadConfig, assertRuntimePrerequisites, configSummary } from './config.mjs';
import {join} from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { isIP } from 'node:net';
import { createLogger } from './logger.mjs';
import {createCloudConversationExport} from '../../chatwoot-cloud-direct/cloud-conversation-export.mjs';
import {createCloudSavedPreviewReader} from '../../chatwoot-cloud-direct/cloud-conversation-preview.mjs';
import { HostClient, classifySseFrame } from './host-client.mjs';
import {createNativeAuthorizedHostFetch} from './native-authorized-host-fetch.mjs';
import { ChatwootClient } from './chatwoot-client.mjs';
import { resolveInboxMap, buildRosterIndex } from './inbox-map.mjs';
import { syncAccountInboxPresentation } from './channel-presentation.mjs';
import { resolveConversationSelection } from './selection.mjs';
import { verifyVisibleTranslationMessage } from './translation-proof.mjs';
import { readVerifiedWhatsAppRoom } from './verified-wa-room.mjs';
import { openVerifiedPageContact } from './page-contact.mjs';
import { createVerifiedPageAvatarSync } from './page-contact-avatar.mjs';
import { createVerifiedWhatsAppAvatarSync } from './whatsapp-contact-avatar.mjs';
import { createSelectedWhatsAppPresence } from './whatsapp-peer-presence.mjs';
import { createInboundBridge } from './inbound.mjs';
import { augmentRosterWithVerifiedSendPulsePage } from './sendpulse-page-roster.mjs';
import { createPlatformAckHandler } from './platform-ack.mjs';
import { createOutboundHandler } from './outbound.mjs';
import { stableContactIdentifier } from './contract.mjs';
import { createHostSender } from './sender-gate.mjs';
import { createNativeDeliveryAuthority } from './native-delivery.mjs';
import { createBridgeServer } from './server.mjs';
import { createCloudNativePageAdapter, createCloudWebhookSecretProvider } from './cloud-native-page.mjs';
import { verifyCloudApiChannelCallback,cloudApiCallbackStats } from '../../chatwoot-cloud-direct/cloud-api-channel-callback.mjs';
import {prepareCloudInbound,loadCloudAuthority} from '../../chatwoot-cloud-direct/cloud-inbound-bootstrap.mjs';
import {resolveCloudNativeConversation} from '../../chatwoot-cloud-direct/cloud-native-selection.mjs';
import {verifyCloudPageMemoryScope} from '../../chatwoot-cloud-direct/cloud-page-memory-scope.mjs';
import {verifyCloudRemoteWhatsAppMemoryScope} from '../../chatwoot-cloud-direct/cloud-remote-wa-scope.mjs';
import {verifyCloudRemotePersonalMemoryScope} from '../../chatwoot-cloud-direct/cloud-remote-personal-scope.mjs';
import {proveNativeCloudPageSent} from '../../chatwoot-cloud-direct/cloud-page-sent-proof.mjs';
import {createCloudWaOutbound} from '../../chatwoot-cloud-direct/cloud-wa-outbound.mjs';
import {verifyCloudWaMessageForReaction} from '../../chatwoot-cloud-direct/cloud-wa-message-actions.mjs';
import {createCloudWaRecentSync} from '../../chatwoot-cloud-direct/cloud-wa-recent-sync.mjs';
import {createCloudPlatformAck} from '../../chatwoot-cloud-direct/cloud-platform-ack.mjs';
import {createYenraCloudNoticeFeed} from './cloud-notice-feed.mjs';

async function main() {
  const cfg = loadConfig();
  const logger = createLogger({ level: cfg.logLevel });
  assertRuntimePrerequisites(cfg);
  logger.info('bridge.starting', configSummary(cfg));

  // Official DSH Connection now requires an authenticated native browser.
  // Reuse its one authorized dsh-app page, never export cookies/tokens or
  // relax Host authentication; the original Host remains the sole read source.
  const nativeRead=process.env.YENRA_NATIVE_AUTH_HOST_READS==='true';
  const host = new HostClient({ baseUrl: cfg.hostBaseUrl, timeoutMs: cfg.hostTimeoutMs,
    ...(nativeRead?{fetchImpl:createNativeAuthorizedHostFetch({cdpPort:32649})}:{}) });
  const chatwoot = new ChatwootClient({
    baseUrl: cfg.chatwootBaseUrl,
    accountId: cfg.chatwootAccountId,
    token: cfg.chatwootApiToken,
    timeoutMs: cfg.chatwootTimeoutMs,
  });

  const roster = await host.readRoster();
  logger.info('host.roster_read', {
    accounts: roster.accounts.length,
    rooms: roster.totalRooms,
    partial: roster.partial,
    failureCount: roster.failures.length,
  });
  if (roster.accounts.length === 0) throw new Error('HOST_ROSTER_EMPTY');

  const inboxes = await chatwoot.listInboxes();
  const resolved = await resolveInboxMap({
    roster,
    inboxes,
    override: cfg.inboxMapOverride,
    chatwoot,
    sampleRooms: 2,
  });
  if (!resolved.ok) {
    logger.error('inbox_map.unresolved', { failures: resolved.failures });
    throw new Error(`INBOX_MAP_UNRESOLVED:${resolved.failures.join('|')}`);
  }
  logger.info('inbox_map.resolved', {
    entries: resolved.entries.map((entry) => ({
      channel: entry.channel,
      inboxId: entry.inboxId,
      resolvedBy: entry.resolvedBy,
      bindingVerified: entry.bindingVerified,
      contactSamplesChecked: entry.contactSamplesChecked ?? 0,
    })),
  });

  // Cloud First V2: an account either writes to Cloud or remains on the old
  // transitional CE path; never write the SAME live event into both stores.
  // The default is unchanged until Cloud native UI and unique sender pass.
  const cutoverRefs=String(process.env.YENRA_CLOUD_INGRESS_CUTOVER_REFS??'')
    .split(',').map(x=>x.trim()).filter(Boolean);
  const waAccountRefs=roster.accounts.filter(a=>a.channel==='WhatsApp').map(a=>a.accountRef);
  const waCutover=waAccountRefs.length===2&&waAccountRefs.every(ref=>cutoverRefs.includes(ref));
  const waSenderEnabled=process.env.YENRA_CLOUD_WA_SENDER_ENABLED==='true';
  const personalAccounts=roster.accounts.filter(a=>a.channel==='Personal');
  const personalSenderEnabled=process.env.YENRA_CLOUD_PERSONAL_SENDER_ENABLED==='true';
  const personalCutover=personalAccounts.length===1&&cutoverRefs.includes(personalAccounts[0].accountRef);
  // The two WA accounts and the one Personal account each switch Cloud
  // inbound and their existing original Host Sender as one authorized scope.
  // Never permit a Cloud Inbox to accept replies before the sender is ready.
  if(cutoverRefs.some(ref=>waAccountRefs.includes(ref))!==waCutover||waCutover!==waSenderEnabled)
    throw Error('CLOUD_WA_INGRESS_AND_SENDER_MUST_SWITCH_ATOMICALLY');
  if(cutoverRefs.some(ref=>personalAccounts.some(a=>a.accountRef===ref))!==personalCutover||
     personalCutover!==personalSenderEnabled)
    throw Error('CLOUD_PERSONAL_INGRESS_AND_SENDER_MUST_SWITCH_ATOMICALLY');
  const cloudOwnerAuthority=(cutoverRefs.length||waSenderEnabled||personalSenderEnabled)
    ?await loadCloudAuthority(roster):null;
  const cloudNoticeFeed=cloudOwnerAuthority?createYenraCloudNoticeFeed({
    cloud:cloudOwnerAuthority.cloud,logger}):null;
  const onVerifiedCloudIncoming=payload=>{
    if(!cloudNoticeFeed)return;
    void cloudNoticeFeed.publish(payload).catch(error=>logger.warn('cloud.notice_presentation_unavailable',
      {code:String(error?.message??'UNKNOWN').slice(0,80)}));
  };
  // A verified new room must enter the SAME in-memory routing index so its
  // next message/Cloud send uses the original Host identity, not a new sender.
  let index=null;
  const onVerifiedNewRoom=()=>{
    if(!index)return;
    const next=buildRosterIndex(roster,resolved.mapping);
    index.byIdentifier=next.byIdentifier;
    index.byAccountRef=next.byAccountRef;
    index.size=next.size;
  };
  const cloudInbound=cutoverRefs.length
    ?await prepareCloudInbound({host,roster,logger,cutoverAccounts:cutoverRefs,
      cloudOwnerAuthority,onVerifiedIncoming:onVerifiedCloudIncoming,onVerifiedNewRoom})
    :null;
  index=buildRosterIndex(roster, resolved.mapping);
  const pageAvatars = createVerifiedPageAvatarSync({host,chatwoot,index,logger});
  const whatsappAvatars = createVerifiedWhatsAppAvatarSync({host,chatwoot,index,logger});
  const whatsappPresence = createSelectedWhatsAppPresence({chatwoot,index,logger});
  const pageHistoryInFlight = new Map();
  const whatsappHistoryInFlight = new Map();
  const whatsappHistoryLastRefresh = new Map();
  // A Page contact can receive new owner replies from the original channel
  // AFTER its first Chatwoot open. A permanent 'opened' flag made those
  // replies invisible for the entire Bridge lifetime. Refresh only on the
  // next verified selection, coalesced and rate-limited per room; never poll.
  const pageHistoryLastRefresh = new Map();
  const pageHistoryRecheckMs = 15_000;
  const nativeDelivery = createNativeDeliveryAuthority({ chatwoot });
  let sender = null;
  if (cfg.enableRealSend) {
    sender = createHostSender({
      baseUrl: cfg.hostBaseUrl,
      // Reuse the original HostClient's native desktop-PID/port recovery.
      // A stale 60474 startup port must never strand Cloud WA sends after
      // DSH moves to its verified dynamic loopback port.
      resolveBaseUrl: async () => {
        await host.readRoster();
        return host.baseUrl;
      },
      enabled: cfg.enableRealSend,
      ownerSessionId: cfg.hostOwnerSessionId,
      logger,
    });
    logger.warn('sender.enabled', { note: 'real outbound send allowed; owner Session verified by the Host' });
  } else {
    logger.info('sender.disabled', { note: 'ENABLE_REAL_SEND is not "true"; outbound is plan-only' });
  }

  // Reuse the already verified Cloud credential/scope once for both the
  // unique Sender and bounded WA anti-entropy; no second connection/login.
  const cloudApiSenderAuthority=(waSenderEnabled||personalSenderEnabled)?cloudOwnerAuthority:null;
  const allowedCloudSenderInboxIds=new Set([
    ...(waSenderEnabled?[155901,155902]:[]),
    ...(personalSenderEnabled?[155900]:[]),
  ]);
  // Reuse one already-open original Host Sender, one Cloud token and one
  // once-only claim directory for ALL authorized API inboxes.
  const cloudWaClaimDirectory=join(process.env.LOCALAPPDATA??'','YENRA','cloud-wa-once-claims');
  const cloudWaOutbound=cloudApiSenderAuthority?createCloudWaOutbound({
    ...cloudApiSenderAuthority,hostSender:sender,host,index,logger,
    claimDirectory:cloudWaClaimDirectory,allowedInboxIds:allowedCloudSenderInboxIds,
  }):null;
  const cloudWaRecentSync=cloudApiSenderAuthority?createCloudWaRecentSync({
    host,...cloudOwnerAuthority,roster,cloudInbound,logger,
    claimDirectory:cloudWaClaimDirectory,
  }):null;
  const cloudPlatformAck=cloudOwnerAuthority&&cloudInbound?createCloudPlatformAck({
    host,...cloudOwnerAuthority,roster,logger,claimDirectory:cloudWaClaimDirectory,
  }):null;
  const inbound = createInboundBridge({
    host,
    chatwoot,
    mapping: resolved.mapping,
    roster,
    logger,
    concurrency: cfg.concurrency,
    freshnessMinutes: cfg.freshnessMinutes,
    historyAgeMinutes: cfg.historyAgeMinutes,
    verifyRoomBeforePost: cfg.verifyRoomBeforePost,
    dryRun: cfg.dryRunInbound,
    ackHandler: createPlatformAckHandler({ index, chatwoot, logger, nativeDelivery }),
    onVerifiedPageContact: verified => pageAvatars.sync(verified),
  });

  const cloudPage=createCloudNativePageAdapter({
    chatwoot,logger,secretProvider:createCloudWebhookSecretProvider(),
    onVerifiedIncoming:onVerifiedCloudIncoming,
  });

  // One original Host read for the verified active Page room. Only external
  // platform OUTBOUND is caught up here; independently verified INBOUND uses
  // the original Host SSE path, avoiding competing provider MID namespaces.
  // Native Chatwoot source_id dedup, no roster scan or second Sender.
  const refreshVerifiedPageHistory = ({accountRef,roomRef}) => {
    const key=accountRef+'|'+roomRef;
    const ongoing=pageHistoryInFlight.get(key);
    if(ongoing)return ongoing;
    const last=pageHistoryLastRefresh.get(key)??0;
    if(Date.now()-last<pageHistoryRecheckMs)
      return Promise.resolve({ok:true,imported:0,skippedRateLimit:true});
    pageHistoryLastRefresh.set(key,Date.now());
    const task=inbound.openPageRoomOnDemand({accountRef,roomRef,maxMessages:40,onlyOutbound:true});
    pageHistoryInFlight.set(key,task);
    void task.finally(()=>{
      if(pageHistoryInFlight.get(key)===task)pageHistoryInFlight.delete(key);
    }).catch(()=>{});
    return task;
  };

  const refreshVerifiedWhatsAppHistory=({accountRef,roomRef})=>{
    const key=accountRef+'|'+roomRef;
    const pending=whatsappHistoryInFlight.get(key);
    if(pending)return pending;
    if(Date.now()-(whatsappHistoryLastRefresh.get(key)??0)<15_000)
      return Promise.resolve({ok:true,imported:0,skippedRateLimit:true});
    whatsappHistoryLastRefresh.set(key,Date.now());
    // This is NOT a second WA sync loop: read only the selected, authenticated
    // original DSH-IM room; import existing provider OUTBOUND MIDs without send.
    const task=inbound.openWhatsAppRoomOnDemand({accountRef,roomRef,maxMessages:24});
    whatsappHistoryInFlight.set(key,task);
    void task.finally(()=>{
      if(whatsappHistoryInFlight.get(key)===task)whatsappHistoryInFlight.delete(key);
    }).catch(()=>{});
    return task;
  };

  const outbound = createOutboundHandler({
    sender,
    // The native claim API is only contacted if a Sender is authorized.
    // ENABLE_REAL_SEND stays hard-disabled by config until the Rails routes
    // and owner-controlled end-to-end checks are approved and installed.
    deliveryAuthority: nativeDelivery,
    host,
    index,
    logger,
    secrets: {
      default: cfg.webhookSecret,
      byInbox: cfg.webhookSecretsByInbox,
    },
    toleranceSeconds: cfg.webhookToleranceSeconds,
  });

  const startedAt = Date.now();
  const health = () => ({
    mode: cfg.enableRealSend ? 'REAL_SEND_ENABLED' : 'REAL_SEND_DISABLED',
    dryRunInbound: cfg.dryRunInbound,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    host: {
      accounts: roster.accounts.length,
      rooms: roster.totalRooms,
      partial: roster.partial,
    },
    inboxes: resolved.entries.map((entry) => ({
      channel: entry.channel,
      inboxId: entry.inboxId,
      bindingVerified: entry.bindingVerified,
    })),
    identifiers: index.size,
    inbound: { ...inbound.stats, inFlight: inbound.inFlight.size },
    outbound: { processed: outbound.processedSize(), correlations: outbound.correlations.size },
    cloudPage: { readOnly:cloudPage.readOnly,...cloudPage.stats },
    cloudApiChannels: {inboxes:[155900,155901,155902],verifiedCallbackAvailable:true,
      senderEnabledInboxes:[...allowedCloudSenderInboxIds],
      personalSenderEnabled, senderReady:cloudWaOutbound!==null,
      waSenderStats:cloudWaOutbound?.stats??null,
      callbackStats:{...cloudApiCallbackStats}},
    cloudIngress: {cutoverAccounts:cutoverRefs.length,source:'DSH_VERIFIED',
      authority:'CHATWOOT_CLOUD',stats:cloudInbound?.stats??null,
      waExistingContactHydration:cloudInbound?.waRosterHydration??null,
      waAvatarSync:cloudInbound?.avatarStats??null},
    cloudSelection: {readOnly:true,cloudAccountId:196799,liveTrustedResolution:true},
    cloudNotifications: {active:cloudNoticeFeed!==null,...(cloudNoticeFeed?.stats??{})},
    cloudWhatsAppRecentSync: {active:cloudWaRecentSync!==null,stats:cloudWaRecentSync?.stats??null},
  });

  let cloudSelectionAuthority=cloudOwnerAuthority?Promise.resolve(cloudOwnerAuthority):null;
  let activeCloudApiRoom=null;
  const resolveCloudSelection=async({conversationId})=>{
    if(!cloudSelectionAuthority){
      cloudSelectionAuthority=loadCloudAuthority(roster).catch(error=>{
        cloudSelectionAuthority=null;throw error;
      });
    }
    const {cloud,scopes}=await cloudSelectionAuthority;
    const result=await resolveCloudNativeConversation({cloud,index,scopes,conversationId});
    activeCloudApiRoom=result?.ok===true&&
      (result.selection?.channel==='WhatsApp'&&waSenderEnabled||
       result.selection?.channel==='Personal'&&personalSenderEnabled)
      ?result.selection:null;
    // Contact opening also hydrates the existing native Cloud phone/avatar,
    // even when no fresh inbound event has arrived for this WhatsApp contact.
    if(activeCloudApiRoom?.channel==='WhatsApp')
      cloudInbound?.scheduleExistingWhatsAppContact?.(activeCloudApiRoom);
    if(activeCloudApiRoom&&cloudWaRecentSync){
      void cloudWaRecentSync.reconcile(activeCloudApiRoom,{force:true})
        .then(outcome=>{
          if(outcome?.ok&&outcome.incoming+outcome.outgoing>0)
            logger.info('wa.cloud_selected_recent_recovered',{
              incoming:outcome.incoming,outgoing:outcome.outgoing});
        }).catch(error=>logger.warn('wa.cloud_selected_recent_unavailable',
          {code:String(error?.code??error?.message??'UNKNOWN').slice(0,80)}));
    }
    return result;
  };
  const readCloudPreviewList=createCloudSavedPreviewReader({
    getAuthority:async()=>{
      if(!cloudSelectionAuthority)
        cloudSelectionAuthority=loadCloudAuthority(roster);
      return cloudSelectionAuthority;
    },
  });
  const readCloudExportPage=createCloudConversationExport({
    resolveCloudSelection,
    getAuthority:async()=>{
      if(!cloudSelectionAuthority)cloudSelectionAuthority=loadCloudAuthority(roster);
      return cloudSelectionAuthority;
    },
  });
  const { server, handleRequest } = createBridgeServer({
    outbound,
    cloudPageWebhook:cloudPage.handle,
    cloudNoticeFeed,
    cloudApiCallback:verifyCloudApiChannelCallback,
    cloudApiSenderHandler:cloudWaOutbound?.process,
    resolveCloudSelection,
    verifyCloudPageMemory:async args=>{
      if(!cloudSelectionAuthority)cloudSelectionAuthority=loadCloudAuthority(roster);
      const {cloud,scopes}=await cloudSelectionAuthority;
      return {ok:await verifyCloudPageMemoryScope({cloud,scopes,index,...args})};
    },
    verifyCloudRemoteWaMemory:async args=>{
      if(!cloudSelectionAuthority)cloudSelectionAuthority=loadCloudAuthority(roster);
      const {cloud}=await cloudSelectionAuthority;
      return verifyCloudRemoteWhatsAppMemoryScope({cloud,...args});
    },
    verifyCloudRemotePersonalMemory:async args=>{
      if(!cloudSelectionAuthority)cloudSelectionAuthority=loadCloudAuthority(roster);
      const {cloud}=await cloudSelectionAuthority;
      return verifyCloudRemotePersonalMemoryScope({cloud,...args});
    },
    provePageAdoptSent:async args=>{
      if(!cloudSelectionAuthority)cloudSelectionAuthority=loadCloudAuthority(roster);
      const {cloud,scopes}=await cloudSelectionAuthority;
      return proveNativeCloudPageSent({cloud,scopes,index,readCloudExportPage,...args});
    },
    verifyCloudWaReaction:async args=>{
      if(!cloudSelectionAuthority)cloudSelectionAuthority=loadCloudAuthority(roster);
      const {cloud,scopes}=await cloudSelectionAuthority;
      return verifyCloudWaMessageForReaction({
        cloud,index,scopes,host,conversationId:args.conversationId,
        messageId:args.messageId,emoji:args.emoji
      });
    },
    readCloudExportPage,
    readCloudPreviewList,
    readVerifiedWhatsAppRoom:({accountRef,roomRef})=>
      readVerifiedWhatsAppRoom({index,host,accountRef,roomRef}),
    health,
    logger,
    allowCidrs: cfg.allowCidrs,
    // Read-only, on-demand: turns an observed Chatwoot display_id into the
    // verified Host account/room scope. No loop, no cache, no second roster.
    resolveSelection: async ({ accountId, displayId }) => {
      if (accountId !== cfg.chatwootAccountId)
        return {ok:false,error:'ACCOUNT_ID_MISMATCH'};
      const result=await resolveConversationSelection({
        chatwoot,index,accountId:cfg.chatwootAccountId,displayId,
      });
      // Native conversation clicks bypass the contact-directory open route.
      // Kick off ONLY this verified Page room's missing recent two-way history
      // and real avatar, after responding to the selected Brain context.
      whatsappPresence.select(result?.ok===true?result.selection:null,displayId);
      if(result?.ok===true&&result.selection?.channel==='Page'){
        const {accountRef,roomRef}=result.selection;
        void pageAvatars.sync({accountRef,roomRef});
        // Non-blocking first screen; the authenticated native UI can await
        // this SAME task and then refresh its official Chatwoot message store.
        void refreshVerifiedPageHistory({accountRef,roomRef})
          .then(outcome=>{
            if(outcome?.ok!==true)
              logger.warn('page.select_history_unavailable',{code:outcome?.code??'UNKNOWN'});
          }).catch(()=>logger.warn('page.select_history_unavailable',{code:'HOST_OR_CHATWOOT_UNAVAILABLE'}));
      }
      if(result?.ok===true && result.selection?.channel==='WhatsApp'){
        const {accountRef,roomRef,contactId}=result.selection;
        void whatsappAvatars.sync({accountRef,roomRef,contactId});
        void host.subscribeSelectedWhatsAppPresence({accountRef,roomRef})
          .then(ok=>{if(!ok)logger.warn('wa.peer_presence_subscription_unavailable',
            {code:'ORIGINAL_SOCKET_NOT_READY'});})
          .catch(error=>logger.warn('wa.peer_presence_subscription_unavailable',
            {code:error?.code??'ORIGINAL_HOST_UNAVAILABLE'}));
        void refreshVerifiedWhatsAppHistory({accountRef,roomRef})
          .then(outcome=>{
            if(outcome?.ok!==true)
              logger.warn('wa.selected_outgoing_sync_unavailable',{code:outcome?.code??'UNKNOWN'});
            else if(outcome.imported>0)
              logger.info('wa.selected_outgoing_restored',{imported:outcome.imported});
          }).catch(error=>logger.warn('wa.selected_outgoing_sync_unavailable',
            {code:error?.code??'HOST_OR_CHATWOOT_UNAVAILABLE'}));
      }
      return result;
    },
    syncPageConversation: async ({accountId,displayId}) => {
      if(accountId!==cfg.chatwootAccountId)
        return {ok:false,code:'ACCOUNT_ID_MISMATCH'};
      const scoped=await resolveConversationSelection({chatwoot,index,accountId,displayId});
      if(scoped?.ok!==true || scoped.selection?.channel!=='Page')
        return {ok:false,code:'NOT_VERIFIED_PAGE_CONVERSATION'};
      const {accountRef,roomRef}=scoped.selection;
      const outcome=await refreshVerifiedPageHistory({accountRef,roomRef});
      return {ok:outcome?.ok===true,page:true,
        imported:Number.isSafeInteger(outcome?.imported)?outcome.imported:0,
        code:outcome?.ok===true?'VERIFIED_PAGE_SYNC_DONE':outcome?.code??'PAGE_SYNC_UNAVAILABLE'};
    },
    verifyVisibleTranslation: request => verifyVisibleTranslationMessage({
      chatwoot,index,expectedAccountId:cfg.chatwootAccountId,request,
    }),
    openPageContact: ({ accountId, contactId }) =>
      openVerifiedPageContact({
        chatwoot, index, inbound, accountId, contactId,
        expectedAccountId: cfg.chatwootAccountId,
        hydrateAvatar: verified => pageAvatars.sync(verified),
      }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.bridgePort, cfg.bridgeBind, resolve);
  });
  logger.info('bridge.listening', { address: `${cfg.bridgeBind}:${cfg.bridgePort}` });
  // A second LISTEN SOCKET on the one existing Bridge handler makes Docker's
  // HMAC-signed API Channel webhook reachable through the exact WSL virtual
  // switch. It is not a second Bridge, Sender, listener loop or message store.
  // The primary Windows loopback route remains unchanged for the DSH window.
  const wslBind=String(process.env.BRIDGE_WSL_BIND??'').trim();
  let wslServer=null;
  if(wslBind){
    if(isIP(wslBind)!==4 || ['0.0.0.0','127.0.0.1'].includes(wslBind) ||
      cfg.allowCidrs.length!==1 || !/^\d+\.\d+\.\d+\.\d+\/32$/u.test(cfg.allowCidrs[0]))
      throw new Error('WSL_CALLBACK_EXACT_BIND_AND_PEER_REQUIRED');
    wslServer=createHttpServer((request,response)=>{
      void handleRequest(request,response).catch(error=>{
        logger.error('wsl.callback_failed',{code:error?.code??'UNKNOWN'});
        if(!response.headersSent)response.writeHead(500,{'content-type':'application/json'});
        response.end(JSON.stringify({ok:false,error:'BRIDGE_REQUEST_FAILED'}));
      });
    });
    await new Promise((resolve,reject)=>{
      wslServer.once('error',reject);
      wslServer.listen(cfg.bridgePort,wslBind,resolve);
    });
    logger.info('bridge.wsl_callback_listening',{address:`${wslBind}:${cfg.bridgePort}`,restrictedPeer:true});
  }
  // Presentation-only, native Inbox sync. Non-blocking: incoming SSE starts
  // immediately and no profile/photo lookup can hold up real messages.
  void syncAccountInboxPresentation({ host, chatwoot, roster, resolved, inboxes, logger })
    .catch(error => logger.warn('inbox_presentation.unavailable', { code: error?.code ?? 'UNKNOWN' }));

  const stream = host.openEventStream({
    onFrame: (frame) => {
      const event=classifySseFrame(frame);
      if(event.kind==='presence'){
        void whatsappPresence.handle(event.presence);return;
      }
      if(event.kind==='message'&&cloudInbound?.isOwned(event.row?.accountRef)){
        if(event.row?.direction==='OUTBOUND'){
          // Native outgoing was already submitted by the original Host.
          // Project only its verified recent MID into the matching Cloud room;
          // NEVER hand it to inbound or resubmit it to the platform.
          if(['WhatsApp','Personal'].includes(event.row.channel)&&cloudWaRecentSync)
            void cloudWaRecentSync.byOriginalRoom({
              accountRef:event.row.accountRef,roomRef:event.row.roomRef
            }).catch(error=>logger.warn('wa.cloud_external_outgoing_unavailable',
              {code:String(error?.code??error?.message??'UNKNOWN').slice(0,75)}));
        }else cloudInbound.handle(event.row);
        return;
      }
      if(event.kind==='ack'&&cloudInbound?.isOwned(event.ack?.accountRef)){
        // Keep Cloud as the SOLE authority: verify original provider MID and
        // patch only its exact native Cloud message, never the retired CE.
        if(cloudPlatformAck)void cloudPlatformAck.handle(event.ack).then(result=>{
          if(!result.ok)logger.warn('cloud.platform_ack_not_confirmed',
            {code:result.code});
        }).catch(error=>logger.warn('cloud.platform_ack_unavailable',
          {code:String(error?.code??error?.message??'UNKNOWN').slice(0,72)}));
        return;
      }
      inbound.handleFrame(frame);
    },
    onError: (error) => logger.warn('host.sse_error', {
      code: error?.code ?? error?.name ?? 'UNKNOWN',
      detail: typeof error?.message === 'string' ? error.message.slice(0, 300) : undefined,
    }),
  });

  // One bounded anti-entropy loop inside the existing Bridge (NOT another
  // account listener). The original Host SSE above remains the primary path.
  // Native Cloud only receives the verified 72-hour platform MID deltas.
  const waLastActivity=new Map(roster.accounts.filter(a=>a.channel==='WhatsApp')
    .flatMap(a=>a.rooms.map(r=>[a.accountRef+'|'+r.roomRef,r.lastMessageAt??0])));
  const waRecentSelectedTimer=cloudWaRecentSync?setInterval(()=>{
    const selected=activeCloudApiRoom;
    if(selected)void cloudWaRecentSync.reconcile(selected).catch(error=>
      logger.warn('wa.cloud_selected_delta_unavailable',{
        code:String(error?.code??error?.message??'UNKNOWN').slice(0,80)}));
  },14000):null;
  waRecentSelectedTimer?.unref?.();
  let waRosterProbeBusy=false;
  const waRecentRosterTimer=cloudWaRecentSync?setInterval(async()=>{
    if(waRosterProbeBusy)return;
    waRosterProbeBusy=true;
    try{
      const fresh=await host.readRoster({whatsappOnly:true});
      const changed=[];
      let rosterExtended=false;
      for(const account of fresh.accounts.filter(a=>a.channel==='WhatsApp')){
        const known=roster.accounts.find(a=>a.channel==='WhatsApp'&&a.accountRef===account.accountRef);
        if(!known)continue;
        for(const room of account.rooms){
          let knownRoom=known.rooms.find(r=>r.roomRef===room.roomRef);
          if(!knownRoom){
            // Newly saved, original-Host-verified WA contacts may have no
            // inbound event. Admit their native room identity to the SAME
            // roster/index, so the existing Cloud contact hydration can
            // recover them without inventing a message or another Socket.
            known.rooms.unshift(room);
            knownRoom=room;
            rosterExtended=true;
            if(Number.isSafeInteger(roster.totalRooms))roster.totalRooms++;
          }
          // The trusted original WhatsApp roster can resolve a LID phone
          // long after Bridge boot. Enrich only a missing E.164 phone; never
          // replace a previously verified number or merge LID identities.
          if(!/^\+[1-9][0-9]{6,14}$/u.test(knownRoom.phoneFallback??'')&&
             /^\+[1-9][0-9]{6,14}$/u.test(room.phoneFallback??''))
            knownRoom.phoneFallback=room.phoneFallback;
          const key=account.accountRef+'|'+room.roomRef;
          const stamp=room.lastMessageAt??0;
          if(Number.isFinite(stamp)&&stamp>(waLastActivity.get(key)??0)&&
             stamp>Date.now()-72*60*60*1000)
            changed.push({accountRef:account.accountRef,roomRef:room.roomRef,stamp,key});
        }
      }
      if(rosterExtended){
        const updated=buildRosterIndex(roster,resolved.mapping);
        index.byIdentifier=updated.byIdentifier;
        index.byAccountRef=updated.byAccountRef;
        index.size=updated.size;
      }
      changed.sort((a,b)=>b.stamp-a.stamp);
      for(const room of changed.slice(0,3)){
        try{
          const result=await cloudWaRecentSync.byOriginalRoom(room);
          if(result?.ok===true)waLastActivity.set(room.key,room.stamp);
        }catch(error){
          logger.warn('wa.cloud_roster_delta_unavailable',{
            code:String(error?.code??error?.message??'UNKNOWN').slice(0,75)});
        }
      }
      // Reuse this existing 30-second roster pass to gradually hydrate
      // verified Cloud contacts without recent messages. Two per pass avoids
      // flooding Cloud search or the original WA photo endpoint.
      if(cloudInbound?.reconcileExistingWhatsAppContacts)
        await cloudInbound.reconcileExistingWhatsAppContacts({batchSize:2});
    }catch(error){logger.warn('wa.cloud_roster_probe_unavailable',{
      code:String(error?.code??error?.message??'UNKNOWN').slice(0,75)})}
    finally{waRosterProbeBusy=false}
  },30000):null;
  waRecentRosterTimer?.unref?.();

  // Use the existing Bridge in-memory index for the CURRENT authorized
  // SendPulse Page. One bounded official read after the native listener is
  // already ready; no extra polling process, database or Frontend authority.
  // Preserve legacy Chatwoot identifiers while source-scoped contacts migrate.
  const sendPulseRosterTimer=setTimeout(()=>{
    void augmentRosterWithVerifiedSendPulsePage({host,roster})
      .then(async result=>{
        const updated=buildRosterIndex(roster,resolved.mapping);
        index.byIdentifier=updated.byIdentifier;
        index.byAccountRef=updated.byAccountRef;
        index.size=updated.size;
        logger.info('sendpulse.page_roster_adopted',
          {verified:result.verified,added:result.added,totalRooms:roster.totalRooms});
        // A cold-start REST delta uses its FIRST snapshot as baseline; thus
        // real messages received while Desktop was offline never generate a
        // "changed" event. Bounded ONE-TIME catch-up uses the very same
        // verified Page room reader, native Chatwoot MID idempotence, and
        // source message timestamps. No second poller/DB/Sender or 98-room
        // history scan. Keep UI and live Host SSE completely nonblocking.
        // Page catch-up is a background convenience, not a prerequisite for
        // daily WA chats. A broad 12+40-room startup burst exhausts the
        // native Chatwoot contact-search rate limit and blocks WA avatars.
        // Limit to the two hottest Page rooms; other rooms hydrate on click.
        const recent=Array.isArray(result.recentRooms)
          ?result.recentRooms.slice(0,2):[];
        let imported=0,checked=0,failures=0,identityDeferred=0;
        const page=roster.accounts.find(a=>a.channel==='Page'&&
          a.accountRef===result.accountRef);
        const inboxId=resolved.mapping.get(result.accountRef)?.inboxId;
        for(const roomRef of recent){
          // Fail CLOSED for an existing named old Page contact whose verified
          // SendPulse identity is not yet persisted. The previous startup
          // import created parallel conversations for Speedy / Francesco /
          // Rino; only an exact provider MID crosswalk may merge identities.
          // A name match may VETO creation, never authorize a merge.
          const room=page?.rooms.find(r=>r.roomRef===roomRef &&
            r.source==='SENDPULSE_OFFICIAL_REST_API');
          if(!room?.nameKnown||!Number.isSafeInteger(inboxId)){
            identityDeferred++;continue;
          }
          const canonical=stableContactIdentifier(result.accountRef,roomRef);
          try{
            const existing=await chatwoot.findContactByIdentifier(canonical);
            if(!existing){
              const candidates=await chatwoot.searchContacts(room.name);
              if(candidates.some(c=>c?.name===room.name&&c?.identifier!==canonical&&
                Array.isArray(c.contact_inboxes)&&
                c.contact_inboxes.some(ci=>ci?.inbox?.id===inboxId))){
                identityDeferred++;continue;
              }
            }
          }catch{
            identityDeferred++;continue; // 429 or auth failure must not create
          }
          const outcome=await inbound.openPageRoomOnDemand({
            accountRef:result.accountRef,roomRef,
            maxMessages:24,onlyOutbound:false,
          });
          checked++;
          if(outcome?.ok===true)imported+=outcome.imported??0;
          else if(++failures>=3)break;
        }
        logger.info('sendpulse.page_startup_gap_reconciled',
          {checked,imported,failures,identityDeferred});
      }).catch(error=>logger.warn('sendpulse.page_roster_unavailable',
        {code:error?.code??error?.message??'UNKNOWN'}));
  },150);
  sendPulseRosterTimer.unref?.();

  // Only AFTER native HTTP + original SSE are ready: one bounded catch-up
  // from the VERIFIED Page roster. New contact identities and real recent
  // messages survive a Desktop restart without fake messages, old-history
  // mass imports, a second sender, or a blocking first-screen load.
  // Do not start a 40-room Page history walk while the user is chatting.
  // Page realtime SSE and verified on-selection catch-up remain enabled.
  // Keeping this off also preserves the one native API quota for messages,
  // original WhatsApp contact avatars and verified delivery status.
  const recentPageTimer = null;
  recentPageTimer?.unref();

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('bridge.stopping', { signal });
    if (recentPageTimer) clearTimeout(recentPageTimer);
    if(waRecentSelectedTimer)clearInterval(waRecentSelectedTimer);
    if(waRecentRosterTimer)clearInterval(waRecentRosterTimer);
    stream.close();
    whatsappPresence.close();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      ...(wslServer?[new Promise((resolve)=>wslServer.close(resolve))]:[]),
    ]);
    await Promise.all([inbound.drain(),cloudInbound?.drain?.(),cloudWaRecentSync?.drain?.()].filter(Boolean)).catch(() => {});
    logger.info('bridge.stopped', { inbound: inbound.stats });
    process.exitCode = 0;
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // Startup failures are configuration/runtime facts, not private data.
  const logger = createLogger({ level: 'error' });
  logger.error('bridge.start_failed', {
    code: error?.code ?? error?.name ?? 'UNKNOWN',
    reason: String(error?.message ?? error).slice(0, 200),
  });
  process.exitCode = 1;
});
