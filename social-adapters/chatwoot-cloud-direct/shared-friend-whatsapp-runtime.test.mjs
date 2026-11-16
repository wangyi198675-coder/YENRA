import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareFriendWhatsAppRuntime} from './shared-friend-whatsapp-runtime.mjs';
import {friendInboxName} from './shared-friend-whatsapp-provision.mjs';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
const accountRef='c'.repeat(32),roomRef='d'.repeat(32),other='a'.repeat(32);
const inboxId=192345,secret='z'.repeat(32),url='https://friend.example.net/yenra-cloud-channel';
const timestamp=Date.parse('2026-11-13T12:40:00Z');
const identifier=stableContactIdentifier(accountRef,roomRef);
const row={accountRef,roomRef,direction:'INBOUND',mid:'wamid.FRIEND-REAL-MOCK-01',
 text:'Test friend inbound',timestamp:timestamp-8000};
function setup({corruptInbox=false,addOther=true,hmacOnly=false,weakPolicy=false,ackSource=false}={}){
 const record={id:inboxId,channel_type:'Channel::Api',name:friendInboxName(accountRef),
   webhook_url:corruptInbox?'https://wrong.example.net/route':url,secret:hmacOnly?null:secret,hmac_token:'y'.repeat(32),hmac_mandatory:!weakPolicy};
 const roster={accounts:[{channel:'WhatsApp',accountRef,rooms:[{roomRef,name:'Friend peer',nameKnown:true}]}]};
 if(addOther)roster.accounts.push({channel:'WhatsApp',accountRef:other,rooms:[{roomRef:'e'.repeat(32)}]});
 let onFrame=()=>{},closed=0,sent=0,posted=0;
 const patched=[];
 const messages=[];
 const cloud={
  accountId:196799,apiBase:'/api/v1/accounts/196799',
  request:async(method,path)=>{
    if(method==='GET'&&path.endsWith('/inboxes/'+inboxId))return record;
    if(method==='GET'&&path.endsWith('/agents'))return {payload:[{id:284212},{id:284213}]};
    if(method==='GET'&&path.endsWith('/inbox_members/'+inboxId))return {payload:[{id:284212},{id:284213}]};
    if(method==='GET'&&path.endsWith('/conversations/89/messages'))return {payload:[{
      id:77,conversation_id:89,inbox_id:inboxId,message_type:1,
      sender:{id:284212},private:false,source_id:null,content:'Friend reply',
      content_type:0,created_at:timestamp/1000,attachments:[],
    },...messages]};
    if(method==='GET'&&path.endsWith('/messages'))return {payload:messages};
    throw Error('UNEXPECTED_REQUEST '+method+' '+path);
  },
  getConversation:async()=>({id:89,inbox_id:inboxId,account_id:196799,meta:{sender:{id:900}}}),
  getContactById:async()=>({id:900,identifier,contact_inboxes:[{inbox:{id:inboxId},source_id:identifier}]}),
  uploadVerifiedContactAvatar:async()=>true,
  findContactByIdentifier:async()=>ackSource?{id:900,identifier,
    contact_inboxes:[{inbox:{id:inboxId},source_id:identifier}]}:null,
  createContact:async()=>({id:900}),
  listContactConversations:async()=>ackSource?[{id:89,inbox_id:inboxId}]:[],
  updateMessageStatus:async(...args)=>{patched.push(args);return {ok:true}}, 
  createConversation:async()=>({id:89}),
  createIncomingMessage:async(_,payload)=>{
    const m={id:400+posted,source_id:payload.source_id,message_type:0,content:payload.content};
    messages.push(m);posted++;return m;
  },
 };
 const host={
  openEventStream:({onFrame:fn})=>{onFrame=fn;return{close:()=>{closed++}}},
  readRoom:async({accountRef:a,roomRef:b})=>{
    if(a!==accountRef||b!==roomRef)throw Error('HOST_SCOPE_DENIED');
    return {accountRef,roomRef,messages:ackSource?[row,
      {mid:'wamid.mock',direction:'OUTBOUND',text:'Friend reply',timestamp}]:[row]};
  },
  readVerifiedWhatsAppContactAvatar:async()=>null,
 };
 const hostAccount={channel:'WhatsApp',authorized:true,online:true,accountRef};
 const logger={warn:()=>{}};
 return {cloud,host,hostAccount,logger,roster,
  hostSender:{send:async({accountRef:a,roomRef:b})=>{
   assert.equal(a,accountRef);assert.equal(b,roomRef);sent++;return{providerMessageId:'wamid.mock',
     submitted:true,transportAccepted:true,deliveryStatus:'UNKNOWN',delivered:false,
     channel:'WhatsApp',accountRef,roomRef};
  }},
  feed:frame=>onFrame(frame),counts:()=>({sent,posted,closed,patched})};
}
function signed({inbox=inboxId,account=196799,messageId=77}={}){
 const ts=String(timestamp/1000);
 const rawBody=JSON.stringify({event:'message_created',account:{id:account},
   inbox:{id:inbox},conversation:{id:89},id:messageId,
   message_type:'outgoing',private:false,content:'Friend reply'});
 return {rawBody,headers:{'x-chatwoot-timestamp':ts,
   'x-chatwoot-signature':'sha256='+createHmac('sha256',secret).update(ts+'.'+rawBody).digest('hex')}};
}
test('friend signed Cloud reply routes only to friend original Host Sender, once',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup();
  const runtime=await prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,now:()=>timestamp-1000});
  assert.equal(runtime.verified,true);
  const result=await runtime.processCallback(signed());
  assert.equal(result.kind,'submitted-unconfirmed');
  assert.equal((await runtime.processCallback(signed())).kind,'already-claimed');
  assert.equal(m.counts().sent,1);
  await assert.rejects(runtime.processCallback(signed({inbox:155901})),
    /CROSS_ACCOUNT_OR_INBOX_REJECTED/);
  await assert.rejects(runtime.processCallback(signed({account:196800})),
    /CROSS_ACCOUNT_OR_INBOX_REJECTED/);
  assert.equal(m.counts().sent,1);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
test('friend native provider ACK upgrades only the exact Cloud reply after durable claim',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup({ackSource:true});
  const runtime=await prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,now:()=>timestamp-1000});
  runtime.startOriginalHostEvents();
  assert.equal((await runtime.processCallback(signed())).kind,'submitted-unconfirmed');
  m.feed({event:'delivery-ack',data:JSON.stringify({
   channel:'WhatsApp',accountRef,roomRef,mid:'wamid.mock',ackKind:'READ',
   providerAccepted:true,providerDelivered:true,providerRead:true})});
  for(let i=0;i<40&&runtime.status().ack.updated!==1;i++)
    await new Promise(r=>setTimeout(r,10));
  assert.equal(runtime.status().ack.updated,1);
  assert.deepEqual(m.counts().patched,[[89,77,'read']]);
  assert.equal(m.counts().sent,1);
  runtime.stop();
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
test('friend original Host incoming SSE goes only to friend Cloud inbox',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup();
  const runtime=await prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,now:()=>timestamp});
  runtime.startOriginalHostEvents();
  m.feed({data:JSON.stringify({...row,kind:'live'})});
  await runtime.inbound.drain();
  assert.equal(runtime.inbound.stats.posted,1);
  assert.equal(m.counts().posted,1);
  assert.equal(m.counts().sent,0);
  runtime.stop();
  assert.equal(m.counts().closed,1);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
test('changed Cloud callback destination fails before opening original Sender',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup({corruptInbox:true});
  await assert.rejects(prepareFriendWhatsAppRuntime({
    ...m,inboxId,callbackUrl:url,claimDirectory}),/INBOX_NOT_BOUND/);
  assert.equal(m.counts().sent,0);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
test('owner original WhatsApp inbox IDs cannot become friend-side sender',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup();
  await assert.rejects(prepareFriendWhatsAppRuntime({
    ...m,inboxId:155901,callbackUrl:url,claimDirectory}),/NATIVE_AUTHORITY_NOT_READY/);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});

test('first bind reuses original Host history for bounded real recent INBOUND MID; never resends',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup();
  const runtime=await prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,now:()=>timestamp});
  const first=await runtime.bootstrapRecentIncoming();
  assert.equal(first.scannedRooms,1);
  assert.equal(first.verifiedIncoming,1);
  assert.equal(first.failed,0);
  assert.equal(m.counts().posted,1);
  assert.equal(m.counts().sent,0);
  const repeat=await runtime.bootstrapRecentIncoming();
  assert.equal(repeat.alreadyCloud,1);
  assert.equal(m.counts().posted,1);
  assert.equal(m.counts().sent,0);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});

test('never accepts API contact hmac_token as webhook signing secret',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup({hmacOnly:true});
  await assert.rejects(prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,
  }),/WEBHOOK_SECRET_NOT_AVAILABLE/);
  assert.equal(m.counts().sent,0);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
test('unsigned new Cloud API inbox cannot activate friend bridge',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-friend-wa-'));
 try{
  const m=setup({weakPolicy:true});
  await assert.rejects(prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,
  }),/HMAC_NOT_MANDATORY/);
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});

test('brand-new native WhatsApp contact refreshes the existing Host roster before Cloud delivery',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-new-contact-'));
 try{
  const m=setup({addOther:false});
  m.roster.accounts[0].rooms=[]; // contact not present when Bridge first starts
  let originalRefresh=0;
  m.host.readRoster=async(options)=>{
   assert.deepEqual(options,{whatsappOnly:true});
   originalRefresh++;
   return {accounts:[{channel:'WhatsApp',accountRef,rooms:[{roomRef,name:'Friend peer',nameKnown:true}]}]};
  };
  const runtime=await prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,now:()=>timestamp});
  runtime.startOriginalHostEvents();
  m.feed({data:JSON.stringify({...row,kind:'live'})});
  await new Promise(resolve=>setTimeout(resolve,20));
  await runtime.inbound.drain();
  assert.equal(originalRefresh,1);
  assert.equal(m.counts().posted,1);
  assert.equal(m.counts().sent,0);
  runtime.stop();
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
test('unverified new WhatsApp room is not written to Cloud',async()=>{
 const claimDirectory=await mkdtemp(join(tmpdir(),'yenra-new-room-denied-'));
 try{
  const m=setup({addOther:false});
  m.roster.accounts[0].rooms=[];
  m.host.readRoster=async()=>({accounts:[{channel:'WhatsApp',accountRef,rooms:[]}]});
  const runtime=await prepareFriendWhatsAppRuntime({
   ...m,inboxId,callbackUrl:url,claimDirectory,now:()=>timestamp});
  runtime.startOriginalHostEvents();
  m.feed({data:JSON.stringify({...row,kind:'live'})});
  await new Promise(resolve=>setTimeout(resolve,20));
  await runtime.inbound.drain();
  assert.equal(m.counts().posted,0);
  assert.equal(m.counts().sent,0);
  runtime.stop();
 }finally{await rm(claimDirectory,{recursive:true,force:true})}
});
