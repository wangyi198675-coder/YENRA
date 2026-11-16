/**
 * Shared Cloud 196799, additional *authorized* DSH-IM WhatsApp account.
 * This is only an adapter to Chatwoot's official inbox/membership APIs.
 * It does not create a WhatsApp Socket, chat store, sender or new DSH Agent.
 * Sender activation is deliberately separate and requires callback routing
 * to the SAME computer that owns the original authorized WhatsApp Socket.
 */
import {createHash} from 'node:crypto';

const ACCOUNT=196799;
const EXISTING=new Set([155865,155900,155901,155902]);
const id=x=>Number.isSafeInteger(x)&&x>0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{32}$/i.test(x);
function requireWebhook(raw){
  let u;try{u=new URL(raw)}catch{throw Error('FRIEND_CALLBACK_URL_INVALID')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
     u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.pathname==='/')
    throw Error('FRIEND_PUBLIC_CALLBACK_REQUIRED');
  return u.href;
}
export function friendInboxName(accountRef){
  if(!hex(accountRef))throw Error('FRIEND_ACCOUNT_REF_INVALID');
  const tag=createHash('sha256').update('YENRA-FRIEND-WA-v1:'+accountRef.toLowerCase()).digest('hex').slice(0,14);
  return 'YENRA · WhatsApp · '+tag;
}
function rows(v){return Array.isArray(v)?v:Array.isArray(v?.payload)?v.payload:null}
function normal(v){return v?.payload?.inbox??v?.inbox??v?.payload??v}
function webhookOf(v){
  const obj=normal(v);
  return obj?.channel?.webhook_url??obj?.webhook_url??
    obj?.callback_webhook_url??obj?.channel?.callback_webhook_url??null;
}
function checkInbox(row,name,url){
  if(!id(row?.id)||EXISTING.has(row.id)||row.name!==name||
     (row.channel_type??row.channelType)!=='Channel::Api')
    throw Error('FRIEND_CLOUD_INBOX_SCOPE_CONFLICT');
  const webhook=webhookOf(row);
  if(webhook!==url)throw Error('FRIEND_CLOUD_WEBHOOK_MISMATCH');
  if(row.hmac_mandatory!==true||
     typeof row.secret!=='string'||!(/^[a-zA-Z0-9_-]{20,180}$/.test(row.secret)))
    throw Error('FRIEND_CLOUD_SIGNED_WEBHOOK_REQUIRED');
  return row.id;
}
async function readInboxList(cloud){
  const list=rows(await cloud.request('GET',cloud.apiBase+'/inboxes'));
  if(!Array.isArray(list))throw Error('FRIEND_CLOUD_LIST_INVALID');
  return list;
}
function userIdsFromCloud(list){
  if(!Array.isArray(list)||list.length===0||list.length>100)
    throw Error('FRIEND_CLOUD_ACCOUNT_AGENTS_INVALID');
  const ids=list.map(m=>Number(m?.id??m?.user_id));
  if(ids.some(x=>!id(x))||new Set(ids).size!==ids.length)
    throw Error('FRIEND_CLOUD_ACCOUNT_AGENTS_INVALID');
  return ids;
}
async function verifyMember(cloud,inboxId,ownerId){
  // All *already authorized* Cloud account agents are eligible for the same
  // Inbox. Do not create a second role, grant administrator, or modify seats.
  const agents=rows(await cloud.request('GET',cloud.apiBase+'/agents'));
  const authorized=userIdsFromCloud(agents);
  if(!authorized.includes(ownerId))throw Error('FRIEND_CLOUD_OWNER_NOT_IN_ACCOUNT');
  const endpoint=cloud.apiBase+'/inbox_members/'+inboxId;
  const before=rows(await cloud.request('GET',endpoint));
  if(!Array.isArray(before))throw Error('FRIEND_CLOUD_MEMBERS_INVALID');
  const known=new Set(before.map(m=>Number(m?.id??m?.user_id)));
  const missing=authorized.filter(agentId=>!known.has(agentId));
  if(missing.length){
    // Official Chatwoot InboxMembers#create only adds missing existing
    // account users. Never use PATCH, which can remove existing members.
    await cloud.request('POST',cloud.apiBase+'/inbox_members',{
      inbox_id:inboxId,user_ids:missing,
    });
  }
  const after=rows(await cloud.request('GET',endpoint));
  if(!Array.isArray(after)||authorized.some(agentId=>!after.some(
    m=>Number(m?.id??m?.user_id)===agentId
  )))throw Error('FRIEND_CLOUD_EQUAL_MEMBERSHIP_NOT_CONFIRMED');
  return authorized.length;
}
/**
 * Must be called only after original DSH-IM authenticates this account.
 * The trusted Host determines the accountRef, not a browser form or phone number.
 *
 * This phase provisions Cloud ONLY. It does not claim the sender is ready.
 */
export async function ensureFriendWhatsAppCloudInbox({
  cloud,hostAccount,callbackUrl,ownerAgentId=284212,
  verifyPublicCallback=defaultCallbackProbe,
}={}){
  if(cloud?.accountId!==ACCOUNT||cloud.apiBase!=='/api/v1/accounts/'+ACCOUNT||
     typeof cloud.request!=='function')throw Error('FRIEND_SHARED_CLOUD_AUTHORITY_REQUIRED');
  if(!hostAccount||hostAccount.channel!=='WhatsApp'||hostAccount.online!==true||
     hostAccount.authorized!==true||!hex(hostAccount.accountRef))
    throw Error('FRIEND_ORIGINAL_DSH_IM_LOGIN_REQUIRED');
  if(!id(ownerAgentId))throw Error('FRIEND_OWNER_AGENT_INVALID');
  const url=requireWebhook(callbackUrl),name=friendInboxName(hostAccount.accountRef);
  // Require the actual friend's public endpoint before creating a Cloud inbox.
  if(await verifyPublicCallback(url)!==true)throw Error('FRIEND_PUBLIC_CALLBACK_NOT_READY');
  const inboxes=await readInboxList(cloud);
  const matches=inboxes.filter(x=>x.name===name);
  if(matches.length>1)throw Error('FRIEND_CLOUD_INBOX_AMBIGUOUS');
  let inboxId,created=false;
  if(matches.length){
    if(EXISTING.has(matches[0].id))throw Error('FRIEND_RESERVED_INBOX_REFUSED');
    const info=normal(await cloud.request('GET',cloud.apiBase+'/inboxes/'+matches[0].id));
    inboxId=checkInbox(info,name,url);
  }else{
    const newOne=normal(await cloud.request('POST',cloud.apiBase+'/inboxes',{
      name,channel:{type:'api',webhook_url:url,hmac_mandatory:true},
    }));
    if(!id(newOne?.id)||EXISTING.has(newOne.id))throw Error('FRIEND_CLOUD_CREATE_NOT_VERIFIED');
    inboxId=newOne.id;created=true;
    // Never trust POST response alone.
    const info=normal(await cloud.request('GET',cloud.apiBase+'/inboxes/'+inboxId));
    checkInbox(info,name,url);
  }
  await verifyMember(cloud,inboxId,ownerAgentId);
  const current=(await readInboxList(cloud)).filter(x=>x.id===inboxId);
  if(current.length!==1||current[0].name!==name||
    current[0].channel_type!=='Channel::Api')throw Error('FRIEND_CLOUD_READBACK_FAILED');
  return {cloudAccountId:ACCOUNT,inboxId,created,ownerAssigned:true,
    channel:'WhatsApp',phase:'INBOX_CREATED_SENDER_NOT_YET_ACTIVE'};
}
export async function defaultCallbackProbe(url,{fetchImpl=fetch}={}){
  const target=requireWebhook(url);
  try{
    const response=await fetchImpl(target,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(6000),
    });
    if(response.status!==405)return false;
    const body=await response.json().catch(()=>null);
    return body?.code==='POST_ONLY'||body?.error==='GET_ONLY';
  }catch{return false}
}
