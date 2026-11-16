/**
 * A single original WhatsApp message proof for optional owner-click actions.
 * No send, socket, source-id inference, or Cloud mutation. The platform call
 * must be made separately by the EXISTING DSH-IM runtime after rechecking
 * this proof and the original account's stored WhatsApp inbox.
 */
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
import {listRows} from '../chatwoot-bridge/src/chatwoot-client.mjs';

const WA_INBOXES=new Set([155901,155902]);
const ALLOWED_REACTIONS=new Set(['👍','❤️','😂','😮','😢','🙏']);
const valid=x=>Number.isSafeInteger(x)&&x>0;

export async function verifyCloudWaMessageForReaction({
  cloud,index,scopes,host,conversationId,messageId,emoji,
  resolve=resolveCloudNativeConversation
}={}){
  if(!valid(conversationId)||!valid(messageId)||!ALLOWED_REACTIONS.has(emoji)||
     !cloud?.getConversation||!cloud?.request||!host?.readRoom)
    return {ok:false,code:'WA_REACTION_INVALID_REQUEST'};
  const selection=await resolve({cloud,index,scopes,conversationId});
  if(!selection?.ok||selection.selection?.channel!=='WhatsApp'||
     !WA_INBOXES.has(selection.selection.cloudInboxId))
    return {ok:false,code:'WA_REACTION_ACCOUNT_NOT_VERIFIED'};
  const s=selection.selection;
  // Cloud message IDs never authorize platform operations on their own.
  let previous=null,matched=null;
  const cloudRows=[];
  for(let page=0;page<5;page++){
    const suffix=previous===null?'':'?before='+previous;
    const response=await cloud.request('GET',
      cloud.apiBase+'/conversations/'+conversationId+'/messages'+suffix);
    const rows=listRows(response);
    if(!Array.isArray(rows)||rows.length>100)
      return {ok:false,code:'WA_REACTION_CLOUD_MESSAGES_UNAVAILABLE'};
    cloudRows.push(...rows);
    const matches=rows.filter(m=>m?.id===messageId);
    if(matches.length>1)return {ok:false,code:'WA_REACTION_DUPLICATE_CLOUD_ID'};
    if(matches.length===1){matched=matches[0];break;}
    if(rows.length<20)break;
    const ids=rows.map(m=>m?.id).filter(valid);
    if(ids.length!==rows.length)return {ok:false,code:'WA_REACTION_CLOUD_CURSOR_INVALID'};
    const minimum=Math.min(...ids);
    if(previous!==null&&minimum>=previous)
      return {ok:false,code:'WA_REACTION_CLOUD_CURSOR_INVALID'};
    previous=minimum;
  }
  if(!matched)return {ok:false,code:'WA_REACTION_MESSAGE_NOT_FOUND'};
  const cloudDirection=matched.message_type===0?'INBOUND':
                       matched.message_type===1?'OUTBOUND':null;
  if(!cloudDirection||matched.private===true||
     (valid(matched.conversation_id)&&matched.conversation_id!==conversationId)||
     (valid(matched.inbox_id)&&matched.inbox_id!==s.cloudInboxId)||
     (matched.source_id!=null&&
       (typeof matched.source_id!=='string'||!matched.source_id||
         matched.source_id.length>180)))
    return {ok:false,code:'WA_REACTION_ORIGINAL_MID_REQUIRED'};
  const original=await host.readRoom({
    channel:'WhatsApp',accountRef:s.accountRef,roomRef:s.roomRef
  });
  if(original?.accountRef!==s.accountRef||
     original?.roomRef!==s.roomRef||!Array.isArray(original.messages))
    return {ok:false,code:'WA_REACTION_ORIGINAL_ROOM_UNAVAILABLE'};
  // A staff-created Cloud bubble has no MID. Chatwoot's hosted PATCH
  // only updates status. Require one original platform record and one
  // MID-bearing history projection before authorizing any reaction.
  let originalMid=matched.source_id;
  if(originalMid==null){
    if(cloudDirection!=='OUTBOUND'||matched.status!=='sent'||
       !valid(matched.sender?.id)||typeof matched.content!=='string'||
       !matched.content.trim()||!Number.isFinite(matched.created_at)||
       (matched.attachments??[]).length>0)
      return {ok:false,code:'WA_REACTION_ORIGINAL_MID_REQUIRED'};
    const time=matched.created_at*1000;
    const originalMatches=original.messages.filter(m=>m?.direction==='OUTBOUND'&&
      !m.nativeMediaType&&m.text===matched.content&&
      typeof m.mid==='string'&&m.mid.length>0&&m.mid.length<=180&&
      Number.isFinite(m.timestamp)&&Math.abs(m.timestamp-time)<=120_000);
    if(originalMatches.length!==1)
      return {ok:false,code:'WA_REACTION_SOURCE_AMBIGUOUS'};
    const source=originalMatches[0];
    const unsignedCloudRows=cloudRows.filter(m=>m?.message_type===1&&
      m.private!==true&&m.source_id==null&&
      m.content===matched.content&&m.sender?.id===matched.sender.id&&
      Number.isFinite(m.created_at)&&
      Math.abs(m.created_at-matched.created_at)<=120);
    if(unsignedCloudRows.length!==1||unsignedCloudRows[0].id!==messageId)
      return {ok:false,code:'WA_REACTION_CLOUD_ORIGINAL_AMBIGUOUS'};
    const projections=cloudRows.filter(m=>m?.id!==messageId&&
      m.message_type===1&&m.private!==true&&
      m.conversation_id===conversationId&&m.inbox_id===s.cloudInboxId&&
      m.sender?.id===matched.sender.id&&m.content===matched.content&&
      m.source_id===source.mid&&
      m.content_attributes?.yenra_history_import===true&&
      m.content_attributes?.yenra_original_platform_mid===source.mid&&
      Number.isFinite(m.created_at)&&
      m.created_at>=matched.created_at&&m.created_at-matched.created_at<=3600);
    if(projections.length!==1)
      return {ok:false,code:'WA_REACTION_MID_PROJECTION_NOT_UNIQUE'};
    originalMid=source.mid;
  }
  const matches=original.messages.filter(m=>
    m?.mid===originalMid&&m?.direction===cloudDirection);
  if(matches.length!==1)
    return {ok:false,code:'WA_REACTION_PLATFORM_MESSAGE_NOT_UNIQUE'};
  const source=matches[0];
  // For plain text, source and Cloud must still be exactly the same message.
  // Other media types require original mid+direction; never infer by text.
  if(!source.nativeMediaType&&typeof matched.content==='string'&&
     source.text!==matched.content)
    return {ok:false,code:'WA_REACTION_PLATFORM_CONTENT_CHANGED'};
  return {ok:true,selection:{channel:'WhatsApp',accountRef:s.accountRef,
    roomRef:s.roomRef,cloudInboxId:s.cloudInboxId,
    cloudConversationId:conversationId,cloudMessageId:messageId,
    originalMid,direction:cloudDirection,
    emoji}};
}
