import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {ChatwootClient} from '../chatwoot-bridge/src/chatwoot-client.mjs';
import {createCloudInboundProjection} from './cloud-inbound-projection.mjs';
const exec=promisify(execFile);
const tokenFile=fileURLToPath(new URL('./read-cloud-dpapi.ps1',import.meta.url));
const scopeFile=fileURLToPath(new URL('./read-cloud-four-account-map-dpapi.ps1',import.meta.url));
async function dpapi(file){
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],
 {timeout:9500,windowsHide:true,maxBuffer:14000});
 return stdout.trim();
}
export async function loadCloudAuthority(roster){
 if(!Array.isArray(roster?.accounts)||roster.accounts.length!==4)throw Error('CLOUD_DSH_FOUR_ACCOUNT_ROSTER_REQUIRED');
 const [token,scopeJson]=await Promise.all([dpapi(tokenFile),dpapi(scopeFile)]);
 if(!/^[a-zA-Z0-9_-]{16,180}$/.test(token))throw Error('CLOUD_OWNER_API_TOKEN_MISSING');
 let map;try{map=JSON.parse(scopeJson)}catch{throw Error('CLOUD_OWNER_SCOPE_ENVELOPE_INVALID')}
 if(map.cloudAccountId!==196799||map.schema!==1||map.authority!=='CHATWOOT_CLOUD'||map.scopes?.length!==4)
  throw Error('CLOUD_OWNER_SCOPE_CONFIG_INVALID');
 const expected=roster.accounts.map(a=>a.accountRef).sort();
 const actual=map.scopes.map(x=>x.accountRef).sort();
 if(expected.length!==actual.length||expected.some((ref,i)=>ref!==actual[i]))
   throw Error('CLOUD_OWNER_SCOPE_ROSTER_CHANGED');
 if(map.scopes.filter(x=>x.channel==='Personal'&&x.cloudInboxId===155900).length!==1 ||
    map.scopes.filter(x=>x.channel==='WhatsApp'&&x.cloudInboxId===155901).length!==1 ||
    map.scopes.filter(x=>x.channel==='WhatsApp'&&x.cloudInboxId===155902).length!==1 ||
    map.scopes.filter(x=>x.channel==='Page'&&x.cloudInboxId===155865).length!==1)
   throw Error('CLOUD_OWNER_INBOX_SCOPE_NOT_UNIQUE');
 const cloud=new ChatwootClient({
   baseUrl:'https://app.chatwoot.com',accountId:196799,token,timeoutMs:17000,
 });
 const inboxes=await cloud.listInboxes();
 for(const s of map.scopes){
   const found=inboxes.filter(i=>i.id===s.cloudInboxId);
   if(found.length!==1||found[0].channelType!==(s.channel==='Page'?'Channel::FacebookPage':'Channel::Api'))
     throw Error('CLOUD_INBOX_REMOTE_AUTHORITY_MISMATCH');
 }
 return {cloud,scopes:map.scopes};
}
export async function prepareCloudInbound({host,roster,logger,cutoverAccounts=[],cloudOwnerAuthority,onVerifiedIncoming,onVerifiedNewRoom}={}){
 if(!Array.isArray(cutoverAccounts)||cutoverAccounts.length>3)throw Error('CLOUD_CUTOVER_ACCOUNT_COUNT_INVALID');
 const {cloud,scopes}=cloudOwnerAuthority??await loadCloudAuthority(roster);
 return createCloudInboundProjection({host,cloud,roster,scopes,logger,enabledAccountRefs:cutoverAccounts,onVerifiedIncoming,onVerifiedNewRoom});
}
