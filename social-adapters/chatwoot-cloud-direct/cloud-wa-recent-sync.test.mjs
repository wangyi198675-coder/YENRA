import test from 'node:test';import assert from 'node:assert/strict';
import{createCloudWaRecentSync}from './cloud-wa-recent-sync.mjs';
import{stableContactIdentifier}from '../chatwoot-bridge/src/contract.mjs';
const t=Date.parse('2026-11-12T12:00:00Z');
function fixture({crossAccount=false,media=false,incomingMedia=false,channel='WhatsApp'}={}){
 const inboxId=channel==='Personal'?155900:155901;
 const accountRef='a'.repeat(32),roomRef='b'.repeat(32),
  identifier=stableContactIdentifier(accountRef,roomRef),messages=[];
 const original=[
  {mid:'provider-in-001',direction:'INBOUND',text:'guten morgen',
   timestamp:t-80000,accountRef,roomRef},
  {mid:'provider-out-002',direction:'OUTBOUND',text:'Guten Morgen',
   timestamp:t-70000,accountRef,roomRef},
  {mid:'provider-in-old',direction:'INBOUND',text:'old text',
   timestamp:t-100*3600000,accountRef,roomRef},
  ...(incomingMedia?[{mid:'provider-in-image',direction:'INBOUND',text:'',
    timestamp:t-50000,nativeMediaType:'image',hasNativeMedia:true,accountRef,roomRef}]:[]),
  ...(media?[{mid:'provider-image-3',direction:'OUTBOUND',text:'foto',
    timestamp:t-5000,media:[{type:'image'}],accountRef,roomRef}]:[])
 ];
 const selection={cloudAccountId:196799,cloudConversationId:8,cloudInboxId:inboxId,cloudContactId:900,accountRef,roomRef,channel};
 const roster={accounts:[{accountRef,channel,rooms:[{roomRef}]}]};
 const scopes=[{accountRef,cloudInboxId:inboxId,channel}];
 const counts={inbound:0,outbound:0,readHost:0,patched:0};
 const capturedInbound=[];
 const cloud={
  apiBase:'/api/v1/accounts/196799',
  getConversation:async()=>({id:8,account_id:crossAccount?3:196799,inbox_id:inboxId,meta:{sender:{id:900}}}),
  getContactById:async()=>({id:900,identifier,contact_inboxes:[{inbox:{id:inboxId},source_id:identifier}]}),
  findContactByIdentifier:async i=>i===identifier?{id:900}:null,
  listContactConversations:async()=>[{id:8,inbox_id:inboxId}],
  request:async()=>({payload:messages}),
  createHistoricalOutgoingMessage:async(id,b)=>{
   counts.outbound++;
   const m={id:100+messages.length,source_id:b.source_id,message_type:1,
    content:b.content,content_attributes:b.content_attributes,status:'sent'};
   messages.push(m);return m
  },
  updateMessageStatus:async()=>{counts.patched++}
 };
 const host={readRoom:async()=>{counts.readHost++;return{accountRef,roomRef,messages:original}}};
 const cloudInbound={deliver:async m=>{
  counts.inbound++;capturedInbound.push(m);
  messages.push({id:200+messages.length,source_id:m.mid,message_type:0,content:m.text});return{ok:true};
 }};
 const logger={warn:()=>{}};
 return{cloud,host,cloudInbound,logger,roster,scopes,selection,counts,messages,capturedInbound};
}
test('recent two-way WhatsApp projections create Cloud bubbles, not platform sends, exactly once',async()=>{
 const f=fixture(),sync=createCloudWaRecentSync({...f,now:()=>t});
 const result=await sync.reconcile(f.selection,{force:true});
 assert.equal(result.ok,true);assert.equal(result.incoming,1);assert.equal(result.outgoing,1);
 assert.equal(f.counts.inbound,1);assert.equal(f.counts.outbound,1);
 assert.equal(f.messages.find(m=>m.message_type===1)?.content_attributes?.yenra_history_import,true);
 const replay=await sync.reconcile(f.selection,{force:true});
 assert.equal(replay.incoming,0);assert.equal(replay.outgoing,0);
 assert.equal(f.counts.outbound,1);assert.equal(f.counts.inbound,1);
});
test('cross account Cloud conversation cannot import',async()=>{
 const f=fixture({crossAccount:true}),sync=createCloudWaRecentSync({...f,now:()=>t});
 await assert.rejects(sync.reconcile(f.selection,{force:true}),/CONVERSATION_CHANGED/);
 assert.equal(f.counts.inbound,0);assert.equal(f.counts.outbound,0);
});
test('Personal original Matrix room recent two-way history stays in Personal Cloud inbox, no extra platform sender',async()=>{
 const f=fixture({channel:'Personal'});
 const sync=createCloudWaRecentSync({...f,now:()=>t});
 const r=await sync.byOriginalRoom({accountRef:f.selection.accountRef,
  roomRef:f.selection.roomRef});
 assert.equal(r.ok,true);
 assert.equal(r.incoming,1);assert.equal(r.outgoing,1);
 assert.equal(f.counts.inbound,1);assert.equal(f.counts.outbound,1);
 assert.equal(f.messages.find(m=>m.message_type===1)?.content_attributes?.yenra_history_import,true);
 const replay=await sync.reconcile(f.selection,{force:true});
 assert.equal(replay.incoming,0);assert.equal(replay.outgoing,0);
 assert.equal(f.counts.outbound,1);
});
test('Personal original room cannot be misrouted into WhatsApp Cloud inbox',async()=>{
 const f=fixture({channel:'Personal'});
 f.selection.cloudInboxId=155901;
 await assert.rejects(createCloudWaRecentSync({...f,now:()=>t}).reconcile(f.selection,{force:true}),
  /SELECTION_INVALID/);
 assert.equal(f.counts.outbound,0);assert.equal(f.counts.inbound,0);
});
test('selected Personal/WhatsApp verified old incoming image goes through native media-only Cloud ingress, not a blank text send or fresh alert',async()=>{
 for(const channel of ['WhatsApp','Personal']){
  const f=fixture({channel,incomingMedia:true});
  const r=await createCloudWaRecentSync({...f,now:()=>t}).reconcile(f.selection,{force:true});
  assert.equal(r.ok,true);assert.equal(r.incoming,2);
  assert.equal(r.mediaSkipped,0);
  assert.equal(f.counts.inbound,2);
  const picture=f.capturedInbound.find(x=>x.nativeMediaType==='image');
  assert.ok(picture);
  assert.equal(picture.text,'');
  assert.equal(picture.historyImport,true);
  assert.equal(f.counts.outbound,1,'original outgoing remains history-only, no platform Sender');
 }
});
test('media never downgraded into text-only outgoing',async()=>{
 const f=fixture({media:true}),sync=createCloudWaRecentSync({...f,now:()=>t});
 const result=await sync.reconcile(f.selection,{force:true});
 assert.equal(result.mediaSkipped,1);assert.equal(result.outgoing,1);
});
test('roster delta resolves only the exact authorized Cloud inbox and contact',async()=>{
 const f=fixture(),sync=createCloudWaRecentSync({...f,now:()=>t});
 const result=await sync.byOriginalRoom({accountRef:f.selection.accountRef,roomRef:f.selection.roomRef});
 assert.equal(result.ok,true);assert.equal(f.counts.outbound,1);
});

import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
async function withOneCloudClaim({submitted=true,second=false,status='sent',wrongHash=false,missingHash=false,missingMidPresence=false}={}){
 const f=fixture(),dir=await mkdtemp(join(tmpdir(),'yenra-dedup-'));
 const timestamp=t-70000,text='Guten Morgen';
 const id=991;
 const cloudRow={id,source_id:null,message_type:1,private:false,status,content:text,created_at:(timestamp-2000)/1000};
 f.messages.push(cloudRow);
 const folder=join(dir,'account-196799');
 await mkdir(folder);
 const ids=second?[991,992]:[991];
 if(second)f.messages.push({...cloudRow,id:992});
 for(const mid of ids){
  const contentSha256=createHash('sha256').update(text).digest('hex');
  await writeFile(join(folder,mid+'.jsonl'),
   JSON.stringify({v:1,account:196799,inbox:155901,conversationId:8,messageId:mid,
     contentSha256,state:'CLAIMED_BEFORE_SEND',at:timestamp})+'\n'+
   JSON.stringify({state:submitted?'SUBMITTED_UNCONFIRMED':'UNKNOWN_NO_RETRY',at:timestamp,
     platformMidPresent:missingMidPresence?undefined:true,
     providerMidSha256:missingHash?undefined:(wrongHash?'f'.repeat(64):createHash('sha256').update('provider-out-002').digest('hex'))})+'\n');
 }
 return {f,dir};
}
test('original Host outgoing MID is NOT reimported when an exact submitted Cloud message and durable claim already exist',async()=>{
 const {f,dir}=await withOneCloudClaim();
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  const r=await sync.reconcile(f.selection,{force:true});
  assert.equal(r.ok,true);assert.equal(r.matchedSubmitted,1);
  assert.equal(r.outgoing,0);assert.equal(f.counts.outbound,0);
  const again=await sync.reconcile(f.selection,{force:true});
  assert.equal(again.outgoing,0);assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('failed Cloud API bubble with uniquely verified original MID is repaired without duplicate',async()=>{
 const {f,dir}=await withOneCloudClaim({status:'failed'});
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  const r=await sync.reconcile(f.selection,{force:true});
  assert.equal(r.ok,true);assert.equal(r.matchedSubmitted,1);
  assert.equal(r.corrected,1);assert.equal(f.counts.patched,1);
  assert.equal(r.outgoing,0);assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
for(const [name,options] of [
 ['legacy claim lacks provider MID SHA',{status:'failed',missingHash:true}],
 ['legacy claim does not prove actual provider MID presence',{status:'failed',missingMidPresence:true}],
]){
 test(name+' never upgrades failed to sent or creates duplicate',async()=>{
  const {f,dir}=await withOneCloudClaim(options);
  try{
   const r=await createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir})
     .reconcile(f.selection,{force:true});
   assert.equal(r.ok,true);
   assert.equal(r.matchedSubmitted,0);
   assert.equal(r.ambiguousSubmitted,1);
   assert.equal(r.corrected,0);
   assert.equal(f.counts.patched,0);
   assert.equal(f.counts.outbound,0);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
}
test('forged provider MID hash cannot match or create a duplicate Cloud bubble',async()=>{
 const {f,dir}=await withOneCloudClaim({wrongHash:true});
 try{
  const r=await createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir})
    .reconcile(f.selection,{force:true});
  assert.equal(r.matchedSubmitted,0);
  assert.equal(r.ambiguousSubmitted,1);
  assert.equal(r.outgoing,0);assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('identical rapid original sends are left ambiguous instead of falsely deduped',async()=>{
 const {f,dir}=await withOneCloudClaim({status:'failed'});
 try{
  const initial=f.host.readRoom;
  f.host.readRoom=async(...args)=>{const x=await initial(...args);
   return {...x,messages:[...x.messages,{...x.messages[1],mid:'second-real-mid'}]}};
  const r=await createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir})
    .reconcile(f.selection,{force:true});
  assert.equal(r.matchedSubmitted,0);
  assert.equal(r.ambiguousSubmitted,2);
  assert.equal(f.counts.patched,0);assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('an UNKNOWN_NO_RETRY claim is never mistaken for verified submission',async()=>{
 const {f,dir}=await withOneCloudClaim({submitted:false});
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  const r=await sync.reconcile(f.selection,{force:true});
  assert.equal(r.matchedSubmitted,0);
  assert.equal(r.ambiguousSubmitted,1);
  assert.equal(r.outgoing,0);
  assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('two equally plausible Cloud submissions are not guessed and are never duplicated by sync',async()=>{
 const {f,dir}=await withOneCloudClaim({second:true});
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  const r=await sync.reconcile(f.selection,{force:true});
  assert.equal(r.ambiguousSubmitted,1);
  assert.equal(r.outgoing,0);
  assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('verified imported INBOUND with callback-timeout failed status is corrected without any send or duplicate',async()=>{
 const f=fixture();
 const changes=[];
 f.messages.push({id:501,source_id:'provider-in-001',message_type:0,private:false,
  status:'failed',content:'guten morgen',
  content_attributes:{yenra_history_import:true,yenra_original_platform_mid:'provider-in-001'}});
 f.cloud.updateMessageStatus=async(...args)=>{changes.push(args);f.counts.patched++};
 const sync=createCloudWaRecentSync({...f,now:()=>t});
 const result=await sync.reconcile(f.selection,{force:true});
 assert.equal(result.ok,true);
 assert.equal(result.corrected,1);
 assert.equal(sync.stats.correctedIncoming,1);
 assert.deepEqual(changes,[[8,501,'sent']]);
 assert.equal(f.counts.inbound,0,'existing inbound must never be reimported');
 assert.equal(f.counts.outbound,1,'only unrelated original outgoing is history-projected');
});

test('unproven incoming status never changes when MID provenance, text or privacy differs',async()=>{
 for(const patch of [
  {content:'forged'},
  {private:true},
  {content_attributes:{yenra_history_import:false,yenra_original_platform_mid:'provider-in-001'}},
  {content_attributes:{yenra_history_import:true,yenra_original_platform_mid:'wrong-mid'}},
  {message_type:1}
 ]){
  const f=fixture();
  f.messages.push({id:502,source_id:'provider-in-001',message_type:0,private:false,
   status:'failed',content:'guten morgen',
   content_attributes:{yenra_history_import:true,yenra_original_platform_mid:'provider-in-001'},...patch});
  const sync=createCloudWaRecentSync({...f,now:()=>t});
  const result=await sync.reconcile(f.selection,{force:true});
  assert.equal(result.corrected,0);
  assert.equal(sync.stats.correctedIncoming,0);
  assert.equal(f.counts.patched,0);
 }
});
