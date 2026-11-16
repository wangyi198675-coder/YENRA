#!/usr/bin/env node
/**
 * YENRA friend installation: SAME original Bridge, original DSH-IM WhatsApp
 * Socket/Sender, and shared Chatwoot Cloud account 196799.
 * This is an alternative ENTRYPOINT, not an additional process beside the
 * owner's existing Bridge. It requires installer-provisioned Cloud credentials
 * and a publicly reachable callback to THIS friend's computer.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {HostClient} from './host-client.mjs';
import {resolveFriendHostBaseUrl} from './friend-host-discovery.mjs';
import {createHostSender} from './sender-gate.mjs';
import {createBridgeServer} from './server.mjs';
import {ChatwootClient} from './chatwoot-client.mjs';
import {createCloudConversationExport} from '../../chatwoot-cloud-direct/cloud-conversation-export.mjs';
import {createLogger} from './logger.mjs';
import {ensureFriendWhatsAppCloudInbox} from '../../chatwoot-cloud-direct/shared-friend-whatsapp-provision.mjs';
import {prepareFriendWhatsAppRuntime} from '../../chatwoot-cloud-direct/shared-friend-whatsapp-runtime.mjs';
import {resolveCloudRemoteWhatsAppConversation,verifyCloudRemoteWhatsAppMemoryScope} from '../../chatwoot-cloud-direct/cloud-remote-wa-scope.mjs';
import {resolveCloudRemotePersonalConversation,verifyCloudRemotePersonalMemoryScope} from '../../chatwoot-cloud-direct/cloud-remote-personal-scope.mjs';
import {resolveCloudRemotePageConversation,verifyCloudRemotePageMemoryScope} from '../../chatwoot-cloud-direct/cloud-remote-page-scope.mjs';

const ACCOUNT_ID=196799;
const validPhone=p=>typeof p==='string'&&/^\+[1-9][0-9]{4,14}$/.test(p);
async function readCloudToken(env){
 const path=String(env.YENRA_SHARED_CHATWOOT_TOKEN_FILE??'');
 if(path){
  const content=(await readFile(path,'utf8')).trim();
  if(!/^[a-zA-Z0-9_-]{16,180}$/.test(content))throw Error('FRIEND_CLOUD_TOKEN_FILE_INVALID');
  return content;
 }
 const inline=String(env.YENRA_SHARED_CHATWOOT_TOKEN??'').trim();
 if(!/^[a-zA-Z0-9_-]{16,180}$/.test(inline))throw Error('FRIEND_CLOUD_TOKEN_NOT_CONFIGURED');
 return inline;
}
export async function startSharedFriendBridge({
 env=process.env,host,cloud,hostSender,logger=createLogger({level:'info'}),
 port=31917,verifyPublicCallback,
}={}){
 if(env.YENRA_SHARED_CLOUD_FRIEND_MODE!=='true')
   throw Error('FRIEND_MODE_NOT_EXPLICITLY_ENABLED');
 const url=String(env.YENRA_SHARED_CLOUD_FRIEND_CALLBACK_URL??'');
 if(!/^https:\/\/[^/?#]+\/[^?#]+$/.test(url))
   throw Error('FRIEND_PUBLIC_WEBHOOK_NOT_CONFIGURED');
 // A packaged YENRA Host chooses its port at runtime. Validate the native
 // roster before attaching; never guess a port or adopt a foreign service.
 const originalHostUrl=env.YENRA_HOST_BASE_URL??
   (host&&hostSender?'http://127.0.0.1:60474':await resolveFriendHostBaseUrl());
 const local=host??new HostClient({
   baseUrl:originalHostUrl,resolveHostBaseUrl:resolveFriendHostBaseUrl,
 });
 const api=cloud??new ChatwootClient({
   baseUrl:'https://app.chatwoot.com',accountId:ACCOUNT_ID,token:await readCloudToken(env),
 });
 // Fail closed at startup if real sending lacks native Host authority.
 // On each signed Cloud reply, recheck the SAME native Host and its current
 // port before the one original Sender request. Do not retry unknown sends.
 const senderOptions={enabled:env.ENABLE_REAL_SEND==='true',
   ownerSessionId:env.YENRA_HOST_OWNER_SESSION_ID??'',logger};
 if(!hostSender)createHostSender({baseUrl:originalHostUrl,...senderOptions});
 const sender=hostSender??{
   send:async input=>{
     const roster=await local.readRoster({refresh:true});
     if(!roster?.accounts?.some(a=>a.channel==='WhatsApp'&&a.accountRef===input?.accountRef))
       throw Error('FRIEND_ORIGINAL_SENDER_ACCOUNT_NOT_IN_HOST');
     return createHostSender({baseUrl:local.baseUrl,...senderOptions}).send(input);
   },
 };
 const claims=join(env.LOCALAPPDATA??'', 'YENRA','cloud-wa-once-claims');
 if(!/^[A-Z]:[\\/]/i.test(claims))throw Error('FRIEND_CLAIM_DIRECTORY_UNAVAILABLE');
 const active=new Map(),inProgress=new Map(),botScope=new Map(),attachingByAccount=new Map();
 // Both the native account-connected callback and startup recovery MUST join
 // the SAME verified original account-to-Cloud binding. No second Socket.
 async function attachVerifiedOriginal(roster,original){
   if(!original||original.channel!=='WhatsApp'||!roster.accounts.some(a=>
     a.channel==='WhatsApp'&&a.accountRef===original.accountRef))
     throw Error('FRIEND_RESTORE_ORIGINAL_ACCOUNT_NOT_IN_HOST');
   const previous=active.get(original.accountRef);
   if(previous)return {ok:true,inboxId:previous.inboxId,created:false};
   if(attachingByAccount.has(original.accountRef))return attachingByAccount.get(original.accountRef);
   const task=(async()=>{
     const hostAccount={channel:'WhatsApp',accountRef:original.accountRef,
       authorized:true,online:true};
     const provisioned=await ensureFriendWhatsAppCloudInbox({
       cloud:api,hostAccount,callbackUrl:url,
       ...(verifyPublicCallback?{verifyPublicCallback}:{})
     });
     const runtime=await prepareFriendWhatsAppRuntime({
       cloud:api,host:local,roster,hostAccount,inboxId:provisioned.inboxId,
       callbackUrl:url,hostSender:sender,logger,claimDirectory:claims
     });
     if([...active.values()].some(x=>x.inboxId===runtime.inboxId)){
       runtime.stop();throw Error('FRIEND_INBOX_DUPLICATE_LOCAL_AUTHORITY');
     }
     runtime.startOriginalHostEvents();
     void runtime.bootstrapRecentIncoming().then(result=>
       logger.info('friend.cloud_recent_bootstrap',result)).catch(()=>
       logger.warn('friend.cloud_recent_deferred'));
     active.set(original.accountRef,runtime);
     logger.info('friend.cloud_attached',{inboxId:runtime.inboxId,created:provisioned.created});
     return {ok:true,inboxId:runtime.inboxId,created:provisioned.created};
   })();
   attachingByAccount.set(original.accountRef,task);
   try{return await task}finally{
     if(attachingByAccount.get(original.accountRef)===task)
       attachingByAccount.delete(original.accountRef);
   }
 }
 async function registerFriendWhatsApp({botId,ownPhone}={}){
   if(typeof botId!=='string'||!/^whatsapp_[a-f0-9]{24}$/.test(botId))
     return {ok:false,code:'FRIEND_NATIVE_CONNECTED_IDENTITY_MISSING'};
   if(inProgress.has(botId))return inProgress.get(botId);
   const bound=botScope.get(botId);
   if(bound&&active.has(bound))return {ok:true,inboxId:active.get(bound).inboxId,created:false};
   const task=(async()=>{
     // The sender-side identity comes from the original DSH Host, never just
     // from a phone number supplied by a Cloud message/browser.
     const roster=await local.readRoster({refresh:true});
     const accounts=roster.accounts.filter(a=>a.channel==='WhatsApp');
     const matches=[];
     for(const candidate of accounts){
       const owner=await local.readOwnWhatsAppProfile(candidate.accountRef).catch(()=>null);
       if(owner?.ownPhone===ownPhone)matches.push(candidate);
     }
     // Official DSH-IM can authenticate by WhatsApp LID without exposing a
     // phone number. Only one newly linked and unbound Host account may use
     // that fallback; more than one candidate is always rejected.
     const candidates=validPhone(ownPhone)?matches:
       accounts.filter(a=>!active.has(a.accountRef));
     if(candidates.length!==1)throw Error('FRIEND_ORIGINAL_WHATSAPP_IDENTITY_AMBIGUOUS');
     const original=candidates[0];
     const result=await attachVerifiedOriginal(roster,original);
     if(result.ok===true)botScope.set(botId,original.accountRef);
     return result;
   })().catch(error=>{
     logger.warn('friend.cloud_attach_deferred',{
       code:String(error?.code??error?.message??'UNKNOWN').slice(0,75)});
     return {ok:false,code:'FRIEND_CLOUD_NOT_READY'};
   }).finally(()=>inProgress.delete(botId));
   inProgress.set(botId,task);
   return task;
 }
 async function processCallback(args){
   // The untrusted JSON chooses only which isolated verifier should inspect
   // the request. The selected adapter rechecks original Cloud HMAC, ID and MID.
   let envelope;try{envelope=JSON.parse(args.rawBody)}catch{throw Error('FRIEND_CALLBACK_INVALID_JSON')}
   const inboxId=Number(envelope?.inbox?.id??envelope?.conversation?.inbox_id);
   const instances=[...active.values()].filter(s=>s.inboxId===inboxId);
   if(instances.length!==1)return {kind:'blocked'};
   return instances[0].processCallback(args);
 }
const resolveFriendSelection=async ({conversationId}={})=>{
     // The existing private Bridge endpoint already verifies account 196799
     // before passing only the bounded conversationId to this callback.
     if(!Number.isSafeInteger(conversationId)||conversationId<=0)
       return {ok:false,code:'FRIEND_CLOUD_SELECTION_INPUT_INVALID'};
     let conversation;
     try{conversation=await api.getConversation(conversationId)}
     catch{return {ok:false,code:'FRIEND_CLOUD_CONVERSATION_UNAVAILABLE'}};
     const inboxId=Number(conversation?.inbox_id??conversation?.inbox?.id);
     let inboxes;
     try{inboxes=await api.listInboxes()}
     catch{return {ok:false,code:'FRIEND_CLOUD_INBOX_LIST_UNAVAILABLE'}};
     const matches=inboxes.filter(row=>row?.id===inboxId);
     if(matches.length!==1)return {ok:false,code:'FRIEND_CLOUD_INBOX_NOT_AUTHORIZED'};
     const type=matches[0].channelType;
     const params={cloud:api,conversation,inboxId,
       contactId:Number(conversation?.meta?.sender?.id),knownInboxes:inboxes};
     if(type==='Channel::FacebookPage')
       return resolveCloudRemotePageConversation(params);
     if(type==='Channel::Api'&&inboxId===155900)
       return resolveCloudRemotePersonalConversation(params);
     if(type==='Channel::Api')
       return resolveCloudRemoteWhatsAppConversation(params);
     return {ok:false,code:'FRIEND_CLOUD_CHANNEL_NOT_SUPPORTED'};
   };
 const {server}=createBridgeServer({
   outbound:{handle:async()=>({status:503,body:{ok:false,code:'LEGACY_SENDER_NOT_USED'}})},
   cloudApiCallback:async()=>({kind:'blocked'}),
   cloudApiSenderHandler:processCallback,
   registerFriendWhatsApp,
   // Use the SAME original Cloud Bridge as owner mode. The friend Host may
   // open its independently signed API Inbox in Brain without another DB,
   // Agent, sender, or pretending to have the owner's local DSH-IM roster.
  resolveCloudSelection:resolveFriendSelection,
  // Existing Cloud original transcript reader, used by the SAME friend Bridge.
  readCloudExportPage:createCloudConversationExport({
    getAuthority:async()=>({cloud:api}),
    resolveCloudSelection:resolveFriendSelection
  }),
   verifyCloudRemoteWaMemory:args=>verifyCloudRemoteWhatsAppMemoryScope({cloud:api,...args}),
   verifyCloudRemotePersonalMemory:args=>verifyCloudRemotePersonalMemoryScope({cloud:api,...args}),
   verifyCloudPageMemory:async args=>({ok:await verifyCloudRemotePageMemoryScope({cloud:api,...args})}),
   logger,
   health:()=>({
     mode:'SHARED_FRIEND_CLOUD',cloudAccountId:ACCOUNT_ID,
     linkedWhatsAppCount:active.size,
     linkedInboxes:[...active.values()].map(x=>x.inboxId),
     friendScopes:[...active.values()].map(x=>x.status()),
   }),
 });
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('FRIEND_PORT_INVALID');
 await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,'127.0.0.1',()=>{
     server.removeListener('error',reject);resolve();
   });
 });
 logger.info('friend.cloud_bridge_ready',{port,linkedWhatsAppCount:0});
 // The original Host may already be logged into WhatsApp when a Windows
 // scheduled task restarts this Bridge. Connected bots do not necessarily
 // emit another login event, so re-bind the SAME already-authorized Host
 // account once. This uses the same provision/runtime/SSE objects as the
 // native connected callback; it does NOT open another WhatsApp Socket.
 let recoveryAttempts=0;
 const recoverExistingHost=async()=>{
   if(active.size>0)return;
   recoveryAttempts++;
   try{
     const roster=await local.readRoster({refresh:true});
     const accounts=roster.accounts.filter(a=>a.channel==='WhatsApp'&&
       Array.isArray(a.rooms)&&a.rooms.length>0);
     if(accounts.length!==1)throw Error('FRIEND_RECOVERY_HOST_ACCOUNT_NOT_UNIQUE');
     const result=await attachVerifiedOriginal(roster,accounts[0]);
     if(result?.ok!==true)throw Error('FRIEND_RECOVERY_BIND_UNCONFIRMED');
     logger.info('friend.cloud_existing_host_restored',{inboxId:result.inboxId});
   }catch(error){
     logger.warn('friend.cloud_existing_host_restore_deferred',{
       code:String(error?.code??error?.message??'UNKNOWN').slice(0,68),
       attempt:recoveryAttempts
     });
     if(recoveryAttempts<4){
       const retry=setTimeout(()=>void recoverExistingHost(),recoveryAttempts*2700);
       retry.unref?.();
     }
   }
 };
 void recoverExistingHost();
 const shutdown=async()=>{
   for(const instance of active.values())instance.stop();
   await Promise.allSettled([...active.values()].map(x=>x.inbound.drain()));
   await new Promise(resolve=>server.close(resolve));
 };
 process.once('SIGINT',()=>void shutdown());
 process.once('SIGTERM',()=>void shutdown());
 return {server,registerFriendWhatsApp,processCallback,
   health:()=>({cloudAccountId:ACCOUNT_ID,active:active.size}),
   close:shutdown};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 startSharedFriendBridge().catch(error=>{
   // Never print credentials, WhatsApp phone numbers or callback path.
   console.error('FRIEND_BRIDGE_START_REFUSED',String(error?.message??'UNKNOWN').slice(0,85));
   process.exitCode=1;
 });
}
