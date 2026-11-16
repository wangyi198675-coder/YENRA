/**
 * YEN-9: recover the original WhatsApp Socket MID after a verified transport
 * submission whose Host receipt omitted the MID. This is READ ONLY against
 * the same authorized Host, and never authorizes a send, retry or read ACK.
 */
import {MID_PATTERN} from '../chatwoot-bridge/src/contract.mjs';
const REF=/^[a-f0-9]{32}$/u;
function scoped(scope){
 return scope?.channel==='WhatsApp'&&REF.test(scope.accountRef??'')&&
   REF.test(scope.roomRef??'');
}
export async function snapshotOriginalWhatsAppOutbox({host,scope}={}){
 if(!scoped(scope)||typeof host?.readRoom!=='function')return null;
 let payload;
 try{payload=await host.readRoom({channel:'WhatsApp',
   accountRef:scope.accountRef,roomRef:scope.roomRef})}
 catch{return null}
 if(payload?.accountRef!==scope.accountRef||
    payload?.roomRef!==scope.roomRef||!Array.isArray(payload.messages))return null;
 const messages=[],seen=new Set();
 for(const item of payload.messages){
  if(item?.direction!=='OUTBOUND')continue;
  if(typeof item.mid!=='string'||!MID_PATTERN.test(item.mid))continue;
  if(seen.has(item.mid))return null;
  seen.add(item.mid);
  if(typeof item.text==='string'&&Number.isFinite(item.timestamp))
   messages.push({mid:item.mid,text:item.text,timestamp:item.timestamp});
 }
 return messages;
}
export async function recoverSubmittedOriginalWhatsAppMid({
 host,scope,before,text,sendStartedAt,now=Date.now
}={}){
 if(!Array.isArray(before)||!scoped(scope)||typeof text!=='string'||!text||
    !Number.isFinite(sendStartedAt))return null;
 const after=await snapshotOriginalWhatsAppOutbox({host,scope});
 if(!after)return null;
 const initial=new Set(before.map(row=>row.mid));
 // Never backfill old rows that disappeared from a limited original inbox.
 // A new MID must be absent from the exact pre-send snapshot and its original
 // provider timestamp must be inside this single transport attempt.
 const fresh=after.filter(row=>!initial.has(row.mid)&&
   row.timestamp>=sendStartedAt-1500&&row.timestamp<=now()+5000&&
   row.timestamp<=sendStartedAt+90000);
 // Require exactly ONE new original outbound of ANY text in the room. A
 // simultaneous manual/socket message could otherwise falsely bind a Cloud
 // claim even when its actual provider MID is still missing.
 if(fresh.length!==1||fresh[0].text!==text)return null;
 return fresh[0].mid;
}
