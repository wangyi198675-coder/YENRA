/**
 * Cloud conversation-list preview: existing saved zh_CN plus verified
 * latest-MID cache lookup candidates. One Cloud API page read per request.
 * No AI generation, sender or new translation database/cache.
 */
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
// Existing Cloud-authorized original four inboxes plus the confirmed friend WA.
const VALID_INBOXES=new Set([155865,155900,155901,155902,156555]);
const valid=n=>Number.isSafeInteger(n)&&n>0;
const limit=(x,n)=>typeof x==='string'?x.slice(0,n):'';
export function mapCloudSavedPreview(raw,{accountId=196799,page=1,allowedInboxIds=VALID_INBOXES}={}){
 if(accountId!==196799||!valid(page)||page>8||!(allowedInboxIds instanceof Set))throw Error('PREVIEW_SCOPE_INVALID');
 const rows=listRows(raw?.data?.payload??raw);
 if(!Array.isArray(rows)||rows.length>30)throw Error('PREVIEW_CLOUD_LIST_SHAPE_INVALID');
 const out=[],candidates=[];
 for(const c of rows){
  if(!c||c.account_id!==196799||!valid(c.id)||!allowedInboxIds.has(Number(c.inbox_id)))continue;
  const contact=c.meta?.sender;
  const message=c.last_non_activity_message;
  if(!valid(contact?.id)||!valid(message?.id)||typeof contact.name!=='string'||
     typeof message.content!=='string'||!message.content.trim()||message.content.length>2000)continue;
  if(message.private===true||message.message_type===2)continue;
  const translation=message.content_attributes?.translations?.zh_CN;
  // Chatwoot may persist an unchanged Latin original under zh_CN.
  // That is not a Chinese translation and must never be advertised as one.
  const validSaved=typeof translation==='string'&&!!translation.trim()&&
    translation.length<=2000&&translation.trim()!==message.content.trim()&&
    /\p{Script=Han}/u.test(translation);
  if(validSaved){
    out.push({conversationId:c.id,contactId:contact.id,messageId:message.id,
      name:limit(contact.name,180),original:limit(message.content,2000),
      translation:limit(translation,2000)});
  }else if([0,1,'incoming','outgoing'].includes(message.message_type)&&
    message.content.length<=1200&&/\p{L}/u.test(message.content)&&
    !/\p{Script=Han}/u.test(message.content)){
    // Allow a cache-only lookup by the original DSH Host for exactly this
    // verified Cloud MID. No model generation or second translation store.
    candidates.push({conversationId:c.id,contactId:contact.id,messageId:message.id,
      name:limit(contact.name,180),original:limit(message.content,1200)});
  }
 }
 return {ok:true,accountId:196799,page,sourceCount:rows.length,rows:out,candidates};
}
export function createCloudSavedPreviewReader({getAuthority}={}){
 if(typeof getAuthority!=='function')throw Error('CLOUD_PREVIEW_AUTHORITY_REQUIRED');
 return async({accountId,page})=>{
  if(accountId!==196799||!valid(page)||page>8)throw Error('PREVIEW_SCOPE_INVALID');
  const {cloud}=await getAuthority();
  if(!cloud?.request||cloud.accountId!==196799)
    throw Error('CLOUD_PREVIEW_ACCOUNT_UNVERIFIED');
  const raw=await cloud.request('GET',cloud.apiBase+'/conversations?status=all&page='+page,undefined,{timeoutMs:12000});
  // New Cloud-authenticated Facebook Pages are allowed only by the original
  // Cloud account's verified inbox registry, never by a browser hint.
  const allowedInboxIds=new Set(VALID_INBOXES);
  if(typeof cloud.listInboxes==='function'){
    const inboxes=await cloud.listInboxes();
    if(!Array.isArray(inboxes))throw Error('PREVIEW_INBOX_REGISTRY_INVALID');
    for(const inbox of inboxes){
      if(valid(Number(inbox?.id))&&(inbox?.channelType??inbox?.channel_type)==='Channel::FacebookPage')
        allowedInboxIds.add(Number(inbox.id));
    }
  }
  return mapCloudSavedPreview(raw,{accountId,page,allowedInboxIds});
 };
}
