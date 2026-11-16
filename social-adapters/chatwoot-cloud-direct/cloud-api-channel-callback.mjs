import {createHmac,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const ids=new Set([155900,155901,155902]);
export const cloudApiCallbackStats={signedVerified:0,ignored:0,blocked:0,authorizedCandidate:0};
const helper=fileURLToPath(new URL('./read-cloud-channel-secrets-dpapi.ps1',import.meta.url));
let secretsPromise;
function getSecrets(){
 if(!secretsPromise){
 secretsPromise=exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper],
 {windowsHide:true,timeout:8500,maxBuffer:4000}).then(({stdout})=>{
   const p=JSON.parse(stdout.trim());
   if(p.cloudAccountId!==196799||p.schema!==1||Object.keys(p.channels??{}).length!==3)throw Error('CLOUD_CHANNEL_SECRET_SCOPE_INVALID');
   for(const id of ids){if(!/^[a-zA-Z0-9_-]{20,180}$/.test(p.channels[String(id)]??''))throw Error('CLOUD_CHANNEL_SECRET_INVALID')}
   return p.channels;
 }).catch(e=>{secretsPromise=null;throw e});
 }
 return secretsPromise;
}
function safeNum(x){const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null}
export async function verifyCloudApiChannelCallback({rawBody,headers={},now=Date.now,
 secretProvider=getSecrets,permitVerifiedOutbound=false,allowedInboxIds=ids}={}){
 if(typeof rawBody!=='string'||Buffer.byteLength(rawBody,'utf8')>180000)throw Error('CLOUD_API_CALLBACK_BODY_INVALID');
 const h=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),Array.isArray(v)?v[0]:v]));
 const ts=String(h['x-chatwoot-timestamp']??''),sig=String(h['x-chatwoot-signature']??'');
 if(!/^\d{10}$/.test(ts)||Math.abs(now()/1000-Number(ts))>300)throw Error('CLOUD_API_CALLBACK_EXPIRED');
 if(!/^sha256=[a-f0-9]{64}$/.test(sig))throw Error('CLOUD_API_CALLBACK_SIGNATURE_INVALID');
 let obj;try{obj=JSON.parse(rawBody)}catch{throw Error('CLOUD_API_CALLBACK_JSON_INVALID')}
 const account=safeNum(obj?.account?.id);
 const inbox=safeNum(obj?.inbox?.id??obj?.conversation?.inbox_id);
 if(account!==196799||!(allowedInboxIds instanceof Set)||!allowedInboxIds.has(inbox)||inbox===155865)
   throw Error('CLOUD_API_CALLBACK_CROSS_ACCOUNT_OR_INBOX_REJECTED');
 const secrets=await secretProvider(),secret=secrets[String(inbox)];
 if(!/^[a-zA-Z0-9_-]{20,180}$/.test(secret??''))throw Error('CLOUD_API_CALLBACK_SECRET_UNKNOWN');
 const expected='sha256='+createHmac('sha256',secret).update(ts+'.'+rawBody).digest('hex');
 if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw Error('CLOUD_API_CALLBACK_SIGNATURE_REJECTED');
 cloudApiCallbackStats.signedVerified++;
 if(obj?.event!=='message_created'){cloudApiCallbackStats.ignored++;return {kind:'ignore',reason:'NOT_CREATED',inbox}}
 if(obj?.private===true){cloudApiCallbackStats.ignored++;return {kind:'ignore',reason:'PRIVATE_NOTE',inbox}}
 const type=obj.message_type;
 if(type!=='outgoing'&&type!==1){cloudApiCallbackStats.ignored++;return {kind:'ignore',reason:'NOT_AGENT_OUTBOUND',inbox}}
 const messageId=safeNum(obj?.id),conversationId=safeNum(obj?.conversation?.id);
 if(!messageId||!conversationId)throw Error('CLOUD_API_CALLBACK_MESSAGE_SCOPE_INVALID');
 // No send by verifying a webhook alone. Only the explicitly enabled Cloud
 // WA adapter may access this verified envelope; its Cloud API readback and
 // durable claim still gate the original Host Sender.
 if(permitVerifiedOutbound===true){cloudApiCallbackStats.authorizedCandidate++;return {kind:'verified-outgoing',inbox,
   messageId,conversationId,content:obj.content}}
 cloudApiCallbackStats.blocked++;
 return {kind:'blocked',inbox,reason:'CLOUD_UNIQUE_SENDER_NOT_CUT_OVER'};
}
