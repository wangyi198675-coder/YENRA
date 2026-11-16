/**
 * One narrow, display-only Cloud -> original DSH read binding.
 * The only authority for provider MID is the ORIGINAL Host room; a Cloud
 * message ID or auto-selected/background contact can never authorize a
 * provider read receipt by itself.
 */
const valid=x=>Number.isSafeInteger(x)&&x>0;
const REF=/^[a-f0-9]{32}$/;
const MATRIX_MID=/^\$[^\s]{4,179}$/u;
export function selectVerifiedCloudVisibleRead({
  cloud,original,accountRef,roomRef,channel,conversationId
}={}){
 if(!valid(conversationId)||!REF.test(accountRef??'')||
    !REF.test(roomRef??'')||!original||
    original.accountRef!==accountRef||original.roomRef!==roomRef||
    original.channel!==channel||!Array.isArray(original.messages)||
    !cloud||cloud.ok!==true||cloud.accountId!==196799||
    cloud.conversationId!==conversationId||!Array.isArray(cloud.rows)||
    cloud.rows.length>30)return null;
 // This screenshot is Personal Messenger, not a Page. Page/WhatsApp require
 // their own original provider authority and are intentionally not inferred.
 if(channel!=='Personal'||cloud.inboxId!==155900)return null;
 const originals=original.messages.filter(m=>m?.direction==='INBOUND'&&
    typeof m.mid==='string'&&MATRIX_MID.test(m.mid)&&
    typeof m.text==='string'&&Number.isFinite(m.timestamp));
 if(!originals.length)return null;
 const newestOriginal=originals.reduce((a,b)=>b.timestamp>a.timestamp?b:a);
 // Two different inbound events at the same original timestamp have no
 // unambiguous latest visible event; leave the read state untouched.
 if(originals.some(m=>m.mid!==newestOriginal.mid&&
    m.timestamp===newestOriginal.timestamp))return null;
 const cloudInbound=cloud.rows.filter(m=>m?.message_type===0&&m.private!==true&&
    valid(m.id)&&typeof m.source_id==='string'&&
    typeof m.content==='string'&&Number.isFinite(m.created_at));
 if(!cloudInbound.length)return null;
 const newestCloud=cloudInbound.reduce((a,b)=>b.created_at>a.created_at?b:a);
 if(cloudInbound.some(m=>m.source_id!==newestCloud.source_id&&
    m.created_at===newestCloud.created_at))return null;
 // Do not silently mark a new official Messenger message as read if it has
 // not reached the owner's visible Cloud conversation. Also reject old Cloud
 // snapshots and different text even when messages share a display name.
 if(newestCloud.source_id!==newestOriginal.mid||
    newestCloud.content!==newestOriginal.text)return null;
 const observed=Number(newestCloud.original_timestamp)>0
   ?Number(newestCloud.original_timestamp)*1000
   :newestCloud.created_at*1000;
 if(Math.abs(observed-newestOriginal.timestamp)>120000)return null;
 const matched=originals.filter(m=>m.mid===newestCloud.source_id);
 if(matched.length!==1)return null;
 return {channel:'Personal',accountRef,roomRef,mid:newestOriginal.mid,
    cloudConversationId:conversationId,cloudMessageId:newestCloud.id};
}
