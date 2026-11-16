/**
 * Adopt officially verified SendPulse contacts into the EXISTING Bridge's
 * in-memory roster/index at startup. NOT a second roster database or poller.
 *
 * Original Page accountRef is preserved for existing Chatwoot bindings.
 * Legacy room refs remain visible for historical contacts until durable
 * provider MID crosswalk migration is finished.
 */
import {createSendPulseOfficialReader} from '../../sendpulse-bridge/sendpulse-official-reader.mjs';
import {sendPulsePageRoomIdentity} from './sendpulse-page-migration.mjs';
import {MID_PATTERN} from './contract.mjs';
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validContact=x=>typeof x==='string'&&/^[a-z0-9_-]{10,80}$/i.test(x);
const validPeer=x=>typeof x==='string'&&/^[a-z0-9_.:-]{5,120}$/i.test(x);
const time=x=>{const n=Date.parse(String(x??''));return Number.isFinite(n)?n:0};

export async function augmentRosterWithVerifiedSendPulsePage({
 host,roster,reader=createSendPulseOfficialReader()
}={}) {
 if(!host||!roster||!Array.isArray(roster.accounts))throw Error('ROSTER_REQUIRED');
 const pages=roster.accounts.filter(x=>x.channel==='Page');
 if(pages.length!==1)throw Error('SENDPULSE_UNIQUE_PAGE_ACCOUNT_REQUIRED');
 const page=pages[0],binding=await reader.verifyBotPage();
 if(binding?.verifiedBy!=='SENDPULSE_OFFICIAL_REST_API'||
   !/^[0-9]{5,40}$/.test(binding.pageId))throw Error('PAGE_BOT_NOT_VERIFIED');
 const list=await reader.readChats();
 if(list?.success!==true||!Array.isArray(list.data)||list.data.length>300)
   throw Error('SENDPULSE_CHATS_INVALID');
 const peers=new Set(),ids=new Set(),newRooms=[],map=new Map();
 for(const entry of list.data){
  const c=entry?.contact,peer=c?.channel_data?.id;
  if(!object(c)||c.bot_id!==binding.botId||
     !validContact(c.id)||!validPeer(peer))continue;
  if(peers.has(peer)||ids.has(c.id))throw Error('AMBIGUOUS_SENDPULSE_PAGE_PEER');
  peers.add(peer);ids.add(c.id);
  const {roomRef}=sendPulsePageRoomIdentity({
   accountRef:page.accountRef,pageId:binding.pageId,
   contactId:c.id,peerId:peer});
  if(map.has(roomRef))throw Error('SENDPULSE_ROOM_COLLISION');
  map.set(roomRef,{contactId:c.id,peer,botId:binding.botId,
   pageId:binding.pageId,name:c.channel_data?.name??''});
  newRooms.push({
   roomRef,name:typeof c.channel_data?.name==='string'?
     c.channel_data.name.slice(0,100):null,
   nameKnown:typeof c.channel_data?.name==='string'&&
     !!c.channel_data.name.trim(),
   // Do NOT trigger legacy 40-room history migration with these new identities.
   // Native Chatwoot has its own persisted time/preview.
   lastMessageAt:time(entry.inbox_last_message?.created_at)||null,
   messageCount:0,source:'SENDPULSE_OFFICIAL_REST_API'
  });
 }
 if(!newRooms.length)throw Error('SENDPULSE_NO_VERIFIED_PAGE_PEERS');
 const existing=new Set(page.rooms.map(x=>x.roomRef));
 const added=newRooms.filter(x=>!existing.has(x.roomRef));
 host.adoptVerifiedPageProvider?.({reader,binding,accountRef:page.accountRef,rooms:map});
 if(typeof host.adoptVerifiedPageProvider!=='function')
   throw Error('HOST_SENDPULSE_ROOM_READ_UNAVAILABLE');
 page.rooms.push(...added);
 page.roomCount=page.rooms.length;
 roster.totalRooms+=added.length;
 const now=Date.now();
 const recentRooms=newRooms
  .filter(x=>Number.isFinite(x.lastMessageAt) &&
    x.lastMessageAt >= now-72*3600_000 &&
    x.lastMessageAt <= now+300_000)
  .sort((a,b)=>b.lastMessageAt-a.lastMessageAt).slice(0,12)
  .map(x=>x.roomRef);
 return {added:added.length,verified:map.size,
   accountRef:page.accountRef,recentRooms};
}

export async function readVerifiedSendPulsePageRoom({reader,binding,room,accountRef,roomRef}={}) {
 if(!room||room.botId!==binding?.botId||room.pageId!==binding?.pageId||
    !validContact(room.contactId)||!validPeer(room.peer))
   throw Error('SENDPULSE_ROOM_VERIFICATION_INVALID');
 const value=await reader.readMessages(room.contactId);
 if(value?.verifiedBotId!==binding.botId||value?.verifiedPageId!==binding.pageId||
   value.raw?.success!==true||!Array.isArray(value.raw.data)||value.raw.data.length>300)
   throw Error('SENDPULSE_ROOM_MESSAGE_SOURCE_UNVERIFIED');
 const mids=new Set(),messages=[];
 for(const m of value.raw.data){
  if(!object(m)||m.bot_id!==binding.botId||
     m.contact_id!==room.contactId||![1,2].includes(m.direction)||
     !MID_PATTERN.test(String(m.id??''))||mids.has(m.id))continue;
  const at=time(m.created_at);
  if(at<Date.UTC(2000,0,1)||at>Date.now()+300000)continue;
  mids.add(m.id);
  if(typeof m.data?.text!=='string'||!m.data.text.trim()||
     m.data.text.length>4000)continue; // media needs verified bytes separately
  // SendPulse's documented 3=delivered, 4=opened statuses are authoritative
  // only for the exact verified bot+Page+contact+OUTBOUND original MID.
  // Do not infer receipts from a SendPulse row merely being present.
  const receiptAt=m.status===4?time(m.opened_at):
    m.status===3?time(m.delivered_at):0;
  const receiptStatus=m.status===4?'read':
    m.status===3?'delivered':null;
  const verifiedReceipt=m.direction===2&&receiptStatus &&
    receiptAt>=at&&receiptAt<=Date.now()+300000?
      {status:receiptStatus,confirmedAt:receiptAt,
        source:'SENDPULSE_OFFICIAL_REST_API'}:null;
  messages.push({mid:m.id,text:m.data.text,
   direction:m.direction===1?'INBOUND':'OUTBOUND',timestamp:at,
   ...(verifiedReceipt?{providerReceipt:verifiedReceipt}:{})});
 }
 messages.sort((a,b)=>a.timestamp-b.timestamp);
 return {schema:1,channel:'Page',accountRef,roomRef,
   source:'YENRA_FB_OFFICIAL',name:room.name??null,
   verifiedReceiptProvider:'SENDPULSE_OFFICIAL_REST_API',
   readOnly:true,canSend:false,historicalOnly:false,partial:false,
   messages};
}
