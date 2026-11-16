import {createHmac,timingSafeEqual} from 'node:crypto';
const ACCOUNT=196799, INBOX=155865;
const num=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
export function verifyCloudWebhook({body,headers,secret,nowMs=Date.now()}={}){
  if(typeof body!=='string'||Buffer.byteLength(body)>180000)throw Error('CLOUD_WEBHOOK_BODY_INVALID');
  if(typeof secret!=='string'||secret.length<20)throw Error('CLOUD_WEBHOOK_SECRET_REQUIRED');
  const h=Object.fromEntries(Object.entries(headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
  const timestamp=String(h['x-chatwoot-timestamp']??'');
  const signature=String(h['x-chatwoot-signature']??'');
  if(!/^\d{10}$/.test(timestamp)||Math.abs(nowMs/1000-Number(timestamp))>300)throw Error('CLOUD_WEBHOOK_EXPIRED');
  if(!/^sha256=[0-9a-f]{64}$/.test(signature))throw Error('CLOUD_WEBHOOK_SIGNATURE_INVALID');
  const expected='sha256='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))throw Error('CLOUD_WEBHOOK_SIGNATURE_REJECTED');
  let x;
  try{x=JSON.parse(body)}catch{throw Error('CLOUD_WEBHOOK_BAD_JSON')}
  if(!['message_created','message_updated'].includes(x?.event))return {kind:'ignore',reason:'UNSUPPORTED_CLOUD_EVENT'};
  if(num(x?.account?.id)!==ACCOUNT)throw Error('CLOUD_WEBHOOK_ACCOUNT_REJECTED');
  // One account webhook covers every Cloud inbox. Other verified inboxes are
  // dispatched by their own adapter, never handled as Facebook Page.
  if(num(x?.inbox?.id??x?.conversation?.inbox_id)!==INBOX)
    return {kind:'ignore',reason:'NOT_PAGE_INBOX'};
  // A native Chatwoot private note has no platform MID. Verify the Cloud
  // signature and account scope, then ignore it BEFORE checking provider MID.
  if(x?.private===true)return {kind:'ignore',reason:'PRIVATE_NOTE'};
  const id=num(x?.id),cv=num(x?.conversation?.id??x?.conversation?.display_id);
  if(!id||!cv)throw Error('CLOUD_MESSAGE_ID_OR_MID_INVALID');
  const direction=x.message_type===0||x.message_type==='incoming'?'INBOUND':
    x.message_type===1||x.message_type==='outgoing'?'OUTBOUND':null;
  if(!direction)return {kind:'ignore',reason:'NON_USER_MESSAGE'};
  const providerMid=String(x?.source_id??'');
  if(!/^.{8,220}$/.test(providerMid)){
    // Chatwoot may emit an outgoing Page message before Meta has returned a
    // provider MID (including a genuinely failed send). Cloud already owns
    // that message and its provider retry/state; a signed notification with
    // no MID is neither a new inbound nor proof of successful delivery.
    // Acknowledge this notification without creating a second Sender or
    // flooding the Bridge with 401s. Missing MID on inbound stays invalid.
    if(direction==='OUTBOUND'&&!providerMid)
      return {kind:'ignore',reason:'PAGE_OUTBOUND_PENDING_PROVIDER_MID'};
    throw Error('CLOUD_MESSAGE_ID_OR_MID_INVALID');
  }
  // Always re-read the exact message and contact/PSID via Cloud API before
  // touching the native CE store. A valid webhook is not the platform ACK.
  return {kind:'candidate',cloudAccountId:ACCOUNT,cloudInboxId:INBOX,
    cloudConversationId:cv,cloudMessageId:id,providerMid:String(x.source_id),
    direction,event:x.event,cloudMessageStatus:x.status??null};
}
