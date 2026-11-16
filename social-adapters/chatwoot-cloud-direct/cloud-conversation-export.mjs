import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';
const valid=n=>Number.isSafeInteger(n)&&n>0;
const safeText=(text,max=16000)=>typeof text==='string'&&text.length<=max?text:null;
/** Read-only original Cloud transcript page, after the same Host-backed
 * conversation resolution used by the Brain. No alternate chat DB or token
 * is exposed to the renderer. Attachment URLs remain Cloud-owned. */
export function createCloudConversationExport({getAuthority,resolveCloudSelection}={}){
 if(typeof getAuthority!=='function'||typeof resolveCloudSelection!=='function')
  throw Error('CLOUD_EXPORT_AUTHORITY_REQUIRED');
 return async function readCloudExport({accountId,conversationId,before}={}){
  if(accountId!==196799||!valid(conversationId)||
     !(before===null||before===undefined||valid(before)))
   throw Error('CLOUD_EXPORT_PARAMETERS_INVALID');
  const selection=await resolveCloudSelection({conversationId});
  if(selection?.ok!==true||selection.selection?.cloudAccountId!==196799||
     selection.selection?.cloudConversationId!==conversationId)
    throw Error('CLOUD_EXPORT_UNVERIFIED_SELECTION');
  const {cloud}=await getAuthority();
  const conversation=await cloud.getConversation(conversationId);
  const chosen=selection.selection;
  if(conversation?.id!==conversationId||conversation.account_id!==196799||
     Number(conversation.inbox_id??conversation.inbox?.id)!==chosen.cloudInboxId)
    throw Error('CLOUD_EXPORT_CONVERSATION_CHANGED');
  const contactId=Number(conversation?.meta?.sender?.id??conversation?.contact_id);
  if(contactId!==chosen.cloudContactId||!valid(contactId))
    throw Error('CLOUD_EXPORT_CONTACT_CHANGED');
  const raw=await cloud.request('GET',cloud.apiBase+'/conversations/'+conversationId+'/messages'+
    (before?'?before='+before:''));
  const messages=listRows(raw);
  if(!Array.isArray(messages)||messages.length>30)throw Error('CLOUD_EXPORT_NATIVE_PAGE_INVALID');
  const seen=new Set();
  const rows=[];
  for(const m of messages){
    if(!valid(m.id)||seen.has(m.id)||![0,1,2,3].includes(m.message_type))continue;
    seen.add(m.id);
    const content=safeText(m.content??'',40000);
    if(content===null)throw Error('CLOUD_EXPORT_TEXT_TOO_LARGE');
    const extras=Array.isArray(m.attachments)?m.attachments:[];
    if(extras.length>12)throw Error('CLOUD_EXPORT_TOO_MANY_ATTACHMENTS');
    const attachments=extras.filter(x=>x&&typeof x==='object').map(x=>{
      const rawUrl=String(x.data_url??x.external_url??'');
      let href=null;
      try{
        const u=new URL(rawUrl);
        if(u.protocol==='https:'&&(
          u.hostname==='app.chatwoot.com'||u.hostname.endsWith('.chatwoot.com')||
          u.hostname.endsWith('.amazonaws.com')||
          u.hostname.endsWith('.cloudfront.net')
        ))href=u.href;
      }catch{}
      return {id:valid(x.id)?x.id:null,
        name:String(x.file_name??x.filename??'媒体文件').slice(0,160),
        type:String(x.file_type??x.content_type??'file').slice(0,50),
        url:href};
    });
    const attributes=m.content_attributes&&typeof m.content_attributes==='object'?
      m.content_attributes:{};
    rows.push({id:m.id,message_type:m.message_type,source_id:String(m.source_id??'').slice(0,190),
      content,created_at:Number(m.created_at),private:m.private===true,
      status:String(m.status??'').slice(0,30),
      original_timestamp:Number(attributes.external_created_at??0),
      savedZh:typeof attributes.translations?.zh_CN==='string'&&
        /[\u3400-\u9fff]/u.test(attributes.translations.zh_CN)&&
        attributes.translations.zh_CN.trim()!==content.trim()
        ?attributes.translations.zh_CN.slice(0,4000):null,
      attachments});
  }
  let avatarUrl=null;
  try{
    const imageUrl=new URL(String(conversation?.meta?.sender?.thumbnail??conversation?.meta?.sender?.avatar_url??''));
    if(imageUrl.protocol==='https:'&&(
      imageUrl.hostname==='app.chatwoot.com'||imageUrl.hostname.endsWith('.chatwoot.com')||
      imageUrl.hostname.endsWith('.amazonaws.com')||imageUrl.hostname.endsWith('.cloudfront.net')
    ))avatarUrl=imageUrl.href;
  }catch{}
  const nextCursor=messages.length?Math.min(...messages.map(x=>x.id).filter(valid)):null;
  if(nextCursor!==null&&!valid(nextCursor))throw Error('CLOUD_EXPORT_CURSOR_INVALID');
  // Only a country code explicitly stored on this verified Cloud contact.
  // Never derive it from a display name, interface language, or a guessed
  // Facebook/WhatsApp location. Do not expose the contact's phone or metadata.
  const sender=conversation.meta?.sender??{};
  const contactCountryHint=[
    sender.country_code,sender.additional_attributes?.country_code,
    sender.custom_attributes?.yenra_kt_country_iso2
  ].find(v=>typeof v==='string'&&/^[A-Za-z]{2}$/u.test(v.trim()));
  return {ok:true,accountId:196799,conversationId,
    inboxId:chosen.cloudInboxId,contactId,
    contactCountryHint:contactCountryHint?.trim().toUpperCase()??null,
    name:String(conversation.meta?.sender?.name??'联系人').slice(0,100),
    avatarUrl,rows,nextCursor,hasMore:messages.length>=20};
 }
}
