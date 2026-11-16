/**
 * Cloud First Facebook Page inbound. The EXISTING signed Bridge receives
 * Chatwoot's official webhook, verifies the Cloud account/Inbox/Meta MID
 * against official Cloud data, and acknowledges it. Cloud owns the message
 * already: NEVER require or write a retired local Chatwoot CE contact/PSID.
 * No Sender, contact database, polling, or second webhook listener.
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createCloudPageReader} from '../../chatwoot-cloud-direct/cloud-api-reader.mjs';
import {createCloudPageWebhookProcessor} from '../../chatwoot-cloud-direct/cloud-event-processor.mjs';

const execFileAsync=promisify(execFile);
export function createCloudNativePageAdapter({logger,secretProvider,onVerifiedIncoming,
  reader=createCloudPageReader(),now=Date.now}={}){
 if(typeof logger?.warn!=='function'||typeof secretProvider!=='function')
   throw Error('CLOUD_PAGE_NATIVE_BRIDGE_DEPENDENCIES_MISSING');
 const readOnly=true;
 const stats={signedVerified:0,cloudPeerVerified:0,nativeIdentityVerified:0,
   shadowEvents:0,applied:0,duplicates:0,failures:0,cloudAccepted:0};
 function deliver(row){
  // createCloudPageWebhookProcessor has ALREADY verified Cloud account 196799,
  // Inbox 155865, PSID, exact source_id/MID, message direction and privacy.
  if(row?.channel!=='Page'||row?.source!=='CHATWOOT_CLOUD_META_DIRECT_VERIFIED'||
     !Number.isSafeInteger(row.cloudConversationId)||row.cloudConversationId<=0||
     !Number.isSafeInteger(row.cloudContactId)||row.cloudContactId<=0||
     !Number.isSafeInteger(row.cloudMessageId)||row.cloudMessageId<=0)
    throw Error('CLOUD_PAGE_VERIFIED_ENVELOPE_INVALID');
  stats.cloudPeerVerified++;
  stats.cloudAccepted++;
  // An ACK of the signed Cloud webhook is NOT a platform message ACK.
  // No new local message is written and nativeWritten always remains false.
  return {ok:true,cloudOnly:true,nativeWritten:false};
 }
 async function handle({rawBody,headers}={}){
  try {
   const secret=await secretProvider();
   const processor=createCloudPageWebhookProcessor({
     secret,reader,deliver,now,onVerifiedIncoming,
   });
   const result=await processor({rawBody,headers});
   if(result.kind==='accepted'||result.kind==='ignore')stats.signedVerified++;
   return result;
  }catch(err){
   stats.failures++;
   logger.warn('cloud.page_webhook_denied',
     {code:String(err?.message??'CLOUD_ERROR').slice(0,75)});
   throw err;
  }
 }
 return {handle,stats,readOnly};
}

/** Windows Owner-only DPAPI lookup; this is the already existing Bridge Node process. */
export function createCloudWebhookSecretProvider(){
 let cached=null,pending=null;
 const helper=fileURLToPath(new URL('../../chatwoot-cloud-direct/read-cloud-webhook-dpapi.ps1',import.meta.url));
 return async()=>{
  if(cached)return cached;
  if(!pending){
   pending=execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper],
    {windowsHide:true,timeout:9000,maxBuffer:1024}).then(({stdout})=>{
      const s=stdout.trim();
      if(!/^[a-zA-Z0-9_\-]{20,180}$/.test(s))throw Error('CLOUD_WEBHOOK_SECRET_FORMAT_UNVERIFIED');
      cached=s;return s;
    }).finally(()=>{pending=null});
  }
  return pending;
 };
}
