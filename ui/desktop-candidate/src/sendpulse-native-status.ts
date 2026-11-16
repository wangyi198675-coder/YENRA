/** Optional SendPulse Page status inside EXISTING YENRA DSH Host.
 * GET never awaits provider OAuth/DPAPI or performs sync subprocess work.
 * One in-flight asynchronous official verification, cached and throttled.
 * This status does not activate paid Webhook or replace Pancake messages.
 */
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import {sendPulseCredentialStatus,createSendPulseOfficialReader}
  from '../../../social-adapters/sendpulse-bridge/sendpulse-official-reader.mjs';

const LOCAL=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const MAX_AGE=120000;
const RETRY_AFTER_ERROR=30000;
function send(response:any,status:number,body:Record<string,unknown>){
  response.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify(body));
}
function isLocal(request:any){
  const address=String(request.socket?.remoteAddress??'');
  if(!LOCAL.has(address))return false;
  const origin=String(request.headers?.origin??'');
  return !origin||origin==='dsh-app://app'||origin==='null';
}
export function createSendPulseStatusHandler({
  state=sendPulseCredentialStatus,
  verify=async()=>createSendPulseOfficialReader().verifyBotPage(),
  now=()=>Date.now()
}={}){
  let verifiedAt=0,attemptAt=0,verified=false,inflight=null;
  let errorCode='SENDPULSE_PAGE_NOT_YET_VERIFIED';
  function schedule(configured:boolean){
    if(!configured||inflight)return;
    const current=now();
    const age=current-attemptAt;
    if(attemptAt&&(age<(verified?MAX_AGE:RETRY_AFTER_ERROR)))return;
    attemptAt=current;
    inflight=Promise.resolve().then(verify).then(result=>{
      if(result?.verifiedBy!=='SENDPULSE_OFFICIAL_REST_API'){
        throw Error('SENDPULSE_PROVIDER_IDENTITY_UNVERIFIED');
      }
      verified=true;verifiedAt=now();errorCode='';
    }).catch(()=>{
      verified=false;errorCode='SENDPULSE_PROVIDER_VERIFICATION_UNAVAILABLE';
    }).finally(()=>{inflight=null});
  }
  return async function handler(request:any,response:any){
    if(!isLocal(request)){
      send(response,403,{ok:false,code:'LOCAL_DSH_ONLY'});return;
    }
    const urlText=String(request.url??'');
    if(request.method!=='GET'||urlText.split('?')[0]!=='/api/yenra/sendpulse-status'){
      send(response,405,{ok:false,code:'READ_ONLY'});return;
    }
    const config=state();
    if(!config.apiConfigured||!config.bindingConfigured){
      send(response,200,{ok:true,provider:'SendPulse',channel:'Page',
        apiConfigured:false,bindingConfigured:false,
        authorizedBotPage:false,verificationPending:false,
        realTimeWebhookConnected:null,reason:'SENDPULSE_CLIENT_CREDENTIALS_MISSING',
        originalPancakeUnchanged:true});return;
    }
    // This runs asynchronously after handler returns; even a 12s upstream
    // timeout cannot stall unrelated DSH routes or the native inbox.
    schedule(true);
    const snapshot={
      ok:true,provider:'SendPulse',channel:'Page',
      apiConfigured:true,bindingConfigured:true,
      authorizedBotPage:verified,verificationPending:!!inflight,
      lastVerifiedAt:verifiedAt||null,
      realTimeWebhookConnected:null,webhookActive:null,
      reason:verified?'READ_ONLY_OFFICIAL_FACEBOOK_PAGE_API_VERIFIED':
        errorCode,originalPancakeUnchanged:true
    };
    send(response,200,snapshot);
  };
}
export function registerSendPulseNativeStatus(ctx:Context):void{
  ctx.inject(['webServer'],scope=>scope.effect(()=>{
    const handler=createSendPulseStatusHandler();
    const remove=scope.webServer.register({
      kind:'exact',path:'/api/yenra/sendpulse-status',handler
    });
    return()=>remove();
  }));
}
