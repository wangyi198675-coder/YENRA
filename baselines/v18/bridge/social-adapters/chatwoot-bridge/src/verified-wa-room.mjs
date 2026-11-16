/**
 * Strict read-only reuse of the ORIGINAL authenticated DSH-IM WhatsApp room.
 * No QR login, socket, Sender, persistent cache or alternate history store.
 * An exact Host roster + verified Chatwoot Inbox binding is mandatory.
 */
export async function readVerifiedWhatsAppRoom({index,host,accountRef,roomRef}={}){
  if(typeof accountRef!=='string'||!/^[a-f0-9]{32}$/u.test(accountRef)||
     typeof roomRef!=='string'||!/^[a-f0-9]{32}$/u.test(roomRef))
    return {ok:false,error:'WA_SCOPE_INVALID'};
  const bound=index?.byAccountRef?.get(accountRef);
  if(!bound||bound.channel!=='WhatsApp'||!Number.isSafeInteger(bound.inboxId)||
     bound.inboxId<1||!bound.rooms?.includes(roomRef))
    return {ok:false,error:'WA_SCOPE_NOT_IN_VERIFIED_INBOX'};
  const scoped=index?.byIdentifier;
  if(scoped?.size&&![...scoped.values()].some(value=>
    value.channel==='WhatsApp'&&value.accountRef===accountRef&&
    value.roomRef===roomRef&&value.inboxId===bound.inboxId))
    return {ok:false,error:'WA_CONTACT_BINDING_MISMATCH'};
  const hostStarted=performance.now();
  const original=await host.readRoom({channel:'WhatsApp',accountRef,roomRef});
  const hostReadMs=Math.max(0,Math.round(performance.now()-hostStarted));
  if(original?.schema!==1||original?.source!=='DSH_IM_EXISTING_INBOX'||
     original?.channel!=='WhatsApp'||original?.accountRef!==accountRef||
     original?.roomRef!==roomRef||original?.readOnly!==true||original?.canSend!==false)
    return {ok:false,error:'WA_ORIGINAL_HOST_IDENTITY_MISMATCH'};
  // Preserve original MID and chronological order; strip provider/socket detail.
  const messages=(Array.isArray(original.messages)?original.messages:[])
    .filter(message=>typeof message?.mid==='string'&&message.mid.length>0&&
      message.mid.length<=180&&['INBOUND','OUTBOUND'].includes(message.direction))
    .slice(-200).map(message=>({
      mid:message.mid,
      direction:message.direction,
      text:typeof message.text==='string'?message.text.slice(0,8000):'',
      timestamp:Number.isFinite(message.timestamp)?message.timestamp:0,
      ...(typeof message.translation==='string'?{translation:message.translation}:{}),
    }));
  const room={
    schema:1,source:'DSH_IM_EXISTING_INBOX',channel:'WhatsApp',
    accountRef,roomRef,readOnly:true,canSend:false,
    name:typeof original.name==='string'?original.name:null,
    nameKnown:original.nameKnown===true,
    partial:original.partial===true,
    updatedAt:typeof original.updatedAt==='string'?original.updatedAt:null,
    messages,
  };
  // Volatile diagnostic only: duration is a number, never a message or ID.
  return {ok:true,text:'YENRA_SOCIAL_V1:'+JSON.stringify(room),hostReadMs};
}
