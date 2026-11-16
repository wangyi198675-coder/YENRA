/**
 * YENRA optional SendPulse Facebook Page official REST reader.
 * Runs inside original DSH Host; no new Agent, sender, socket, DB or polling.
 * Protected credentials are unlocked ASYNCHRONOUSLY, so Windows DPAPI
 * PowerShell cannot block YENRA's single Node event loop/UI requests.
 */
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const execFileAsync=promisify(execFile);
const BOT=/^[0-9a-f-]{18,64}$/i;
const PAGE=/^\d{5,40}$/;
const CONTACT=/^[a-z0-9_-]{10,80}$/i;
const BASE='https://api.sendpulse.com';
const HELPER=fileURLToPath(new URL('./read-sendpulse-dpapi.ps1',import.meta.url));
const protectedFile=()=>join(process.env.LOCALAPPDATA??'',
  'YENRA','secrets','sendpulse-client.oauth.dpapi');
const clean=(s)=>typeof s==='string'&&s.length<4000?s:'';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
let protectedCredentialPromise=null;
async function loadCredentials(env){
  if(env.YENRA_SENDPULSE_CLIENT_ID&&env.YENRA_SENDPULSE_CLIENT_SECRET){
    return {clientId:env.YENRA_SENDPULSE_CLIENT_ID,
      clientSecret:env.YENRA_SENDPULSE_CLIENT_SECRET,
      botId:env.YENRA_SENDPULSE_BOT_ID,pageId:env.YENRA_SENDPULSE_PAGE_ID};
  }
  if(env!==process.env||!existsSync(protectedFile()))
    throw Error('SENDPULSE_AUTH_NOT_CONFIGURED');
  if(!protectedCredentialPromise){
    protectedCredentialPromise=(async()=>{
      try{
        const {stdout}=await execFileAsync('powershell.exe',
          ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',HELPER],
          {encoding:'utf8',timeout:8000,maxBuffer:4096,windowsHide:true});
        const keys=JSON.parse(stdout);
        if(!object(keys)||!clean(keys.clientId)||!clean(keys.clientSecret)||
          !BOT.test(keys.botId)||!PAGE.test(keys.pageId))
          throw Error('BAD_DPAPI_RESULT');
        return keys;
      }catch{throw Error('SENDPULSE_PROTECTED_AUTH_UNAVAILABLE')}
    })().catch(e=>{protectedCredentialPromise=null;throw e});
  }
  return protectedCredentialPromise;
}
export function sendPulseCredentialStatus(env=process.env){
  const ready=env===process.env&&existsSync(protectedFile());
  return {provider:'SendPulse',channel:'Page',pageLinkAuthorizedInProvider:true,
    apiConfigured:!!(clean(env.YENRA_SENDPULSE_CLIENT_ID)&&
      clean(env.YENRA_SENDPULSE_CLIENT_SECRET))||ready,
    bindingConfigured:(BOT.test(env.YENRA_SENDPULSE_BOT_ID??'')&&
      PAGE.test(env.YENRA_SENDPULSE_PAGE_ID??''))||ready,
    // This REST reader does not query the account's live webhook plan or
    // subscription. Never infer 'disabled' from an unverified plan flag.
    webhookEntitlement:'NOT_VERIFIED_BY_API',allowedActions:'READ_ONLY_UNTIL_VERIFIED'};
}
export function createSendPulseOfficialReader({
  env=process.env,fetchImpl=globalThis.fetch,now=()=>Date.now()
}={}){
  if(typeof fetchImpl!=='function')throw Error('FETCH_REQUIRED');
  if(env!==process.env&&(!env.YENRA_SENDPULSE_CLIENT_ID||
    !env.YENRA_SENDPULSE_CLIENT_SECRET||
    !BOT.test(env.YENRA_SENDPULSE_BOT_ID??'')||
    !PAGE.test(env.YENRA_SENDPULSE_PAGE_ID??'')))
      throw Error('SENDPULSE_ORIGINAL_ACCOUNT_API_CREDENTIALS_OR_BINDING_MISSING');
  let token=null,expiresAt=0,tokenPromise=null;
  async function fetchJSON(url,init={},maxBytes=256000){
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),12000);
    try{
      const response=await fetchImpl(url,
        {...init,redirect:'error',signal:abort.signal});
      if(!response.ok)throw Error('SENDPULSE_PROVIDER_HTTP_'+response.status);
      const raw=await response.text();
      if(raw.length>maxBytes)throw Error('SENDPULSE_PROVIDER_PAYLOAD_TOO_LARGE');
      let data;
      try{data=JSON.parse(raw)}
      catch{throw Error('SENDPULSE_PROVIDER_BAD_JSON')}
      return data;
    }finally{clearTimeout(timeout)}
  }
  async function auth(){
    if(token&&now()+60000<expiresAt)return token;
    if(!tokenPromise){
      tokenPromise=(async()=>{
        const keys=await loadCredentials(env);
        const result=await fetchJSON(BASE+'/oauth/access_token',{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({grant_type:'client_credentials',
            client_id:clean(keys.clientId),client_secret:clean(keys.clientSecret)})
        },4096);
        if(!object(result)||typeof result.access_token!=='string'||
          result.access_token.length<20||
          !Number.isFinite(Number(result.expires_in)))
          throw Error('SENDPULSE_OAUTH_RESPONSE_UNVERIFIED');
        token=result.access_token;
        expiresAt=now()+Math.min(Math.max(Number(result.expires_in),60),3600)*1000;
        return token;
      })().finally(()=>{tokenPromise=null});
    }
    return tokenPromise;
  }
  async function get(path,query){
    if(!/^(\/[a-zA-Z0-9_-]+)+$/.test(path))
      throw Error('UNSAFE_SENDPULSE_READ_PATH');
    const url=new URL(BASE+path);
    for(const [key,val] of Object.entries(query??{})){
      if(!/^[a-z][a-z_]*$/.test(key)||typeof val!=='string'||val.length>80)
        throw Error('UNSAFE_SENDPULSE_QUERY');
      url.searchParams.set(key,val);
    }
    const bearer=await auth();
    return fetchJSON(url.toString(),{headers:{Authorization:'Bearer '+bearer}});
  }
  async function verifiedBinding(){
    const keys=await loadCredentials(env);
    if(!BOT.test(clean(keys.botId))||!PAGE.test(clean(keys.pageId)))
      throw Error('SENDPULSE_ACCOUNT_BINDING_INVALID');
    const result=await get('/messenger/bots');
    if(result.success===false)throw Error('SENDPULSE_BOT_LOOKUP_REJECTED');
    const bots=Array.isArray(result)?result:
      Array.isArray(result?.data)?result.data:
      Array.isArray(result?.bots)?result.bots:null;
    if(!bots)throw Error('SENDPULSE_BOTS_SCHEMA_NOT_VERIFIED');
    const matches=bots.filter(b=>object(b)&&
      (String(b._id)===keys.botId||String(b.id)===keys.botId)&&
      String(b.channel_data?.id??b.external_id)===keys.pageId&&
      /^(messenger|facebook|fb)$/i.test(String(b.channel)));
    if(matches.length!==1)throw Error('SENDPULSE_BOT_PAGE_BINDING_NOT_VERIFIED');
    return {botId:keys.botId,pageId:keys.pageId,
      verifiedBy:'SENDPULSE_OFFICIAL_REST_API'};
  }
  return Object.freeze({
    verifyBotPage:()=>verifiedBinding(),
    async readChats(){
      const binding=await verifiedBinding();
      return get('/messenger/chats',{bot_id:binding.botId});
    },
    async readContact(contactId){
      if(!CONTACT.test(contactId))throw Error('SENDPULSE_CONTACT_SCOPE_INVALID');
      const binding=await verifiedBinding();
      const response=await get('/messenger/contacts/get',{id:contactId});
      return {verifiedBinding:binding,raw:response,schemaUnconfirmed:true};
    },
    async readMessages(contactId){
      if(!CONTACT.test(contactId))throw Error('SENDPULSE_CONTACT_SCOPE_INVALID');
      const binding=await verifiedBinding();
      const raw=await get('/messenger/chats/messages',{contact_id:contactId});
      // No claim of verified message identity until MID, direction, provider
      // contact mapping and timestamp have been proved from actual REST.
      return {provider:'SendPulse',verifiedBotId:binding.botId,
        verifiedPageId:binding.pageId,schemaUnconfirmed:true,raw};
    }
  });
}
