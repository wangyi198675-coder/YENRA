import test from 'node:test';import assert from 'node:assert/strict';
import{createCloudWaRecentSync}from './cloud-wa-recent-sync.mjs';
import{stableContactIdentifier}from '../chatwoot-bridge/src/contract.mjs';
const t=Date.parse('2026-11-12T12:00:00Z');
function fixture({crossAccount=false,media=false,incomingMedia=false,channel='WhatsApp',waInboxId=155901}={}){
 const inboxId=channel==='Personal'?155900:waInboxId;
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
  updateMessageStatus:async(cid,id,status)=>{
   assert.equal(cid,8);counts.patched++;
   const m=messages.find(x=>x.id===id);if(!m)throw Error('CLOUD_TEST_MESSAGE_NOT_FOUND');
   m.status=status;return m;
  }
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
 f.cloud.updateMessageStatus=async(...args)=>{
  changes.push(args);f.counts.patched++;
  const row=f.messages.find(m=>m.id===args[1]);
  if(!row)throw Error('EXPECTED_CLOUD_PERSISTENCE_TARGET_MISSING');
  row.status=args[2];return row;
 };
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

async function withPendingOriginalClaim({waInboxId=155901,status='failed',lastState='TRANSPORT_SUBMITTED_MID_PENDING',wrongScope=false,staleClaim=false}={}){
 const f=fixture({waInboxId}),dir=await mkdtemp(join(tmpdir(),'yenra-midpending-'));
 const row={id:997,source_id:null,message_type:1,private:false,status,
   content:'Guten Morgen',created_at:(t-72000)/1000};
 f.messages.push(row);
 await mkdir(join(dir,'account-196799'));
 const midTime=t-70000;
 const firstAt=staleClaim?midTime-300000:midTime-1000;
 await writeFile(join(dir,'account-196799','997.jsonl'),[
   {v:1,account:196799,inbox:wrongScope?155902:waInboxId,conversationId:8,
    messageId:997,contentSha256:createHash('sha256').update(row.content).digest('hex'),
    state:'CLAIMED_BEFORE_SEND',at:firstAt},
   {state:lastState,transportAccepted:true,platformMidPresent:false,at:firstAt+600}
 ].map(JSON.stringify).join('\n')+'\n');
 return {f,dir};
}
for(const inbox of [155901,155902]){
 test('red failed bubble of WA Inbox '+inbox+' is repaired from one original MID and durable MID_PENDING claim only, never resent',async()=>{
  const {f,dir}=await withPendingOriginalClaim({waInboxId:inbox});
  try{
   const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
   const first=await sync.reconcile(f.selection,{force:true});
   assert.equal(first.ok,true);assert.equal(first.recoveredPendingMid,1);
   assert.equal(first.corrected,1);
   assert.equal(f.messages.find(m=>m.id===997).status,'sent');
   assert.equal(f.counts.patched,1);
   assert.equal(f.counts.outbound,0);
   assert.equal(sync.stats.recoveredPendingMid,1);
   const lines=(await (await import('node:fs/promises')).readFile(
    join(dir,'account-196799','997.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
   assert.equal(lines.length,3);
   assert.equal(lines.at(-1).state,'SUBMITTED_UNCONFIRMED');
   assert.equal(lines.at(-1).recoveredVia,'ONE_ORIGINAL_HOST_ROOM_MID');
   assert.equal(lines.at(-1).providerMidSha256,
    createHash('sha256').update('provider-out-002').digest('hex'));
   assert.equal(JSON.stringify(lines).includes('Guten Morgen'),false);
   const second=await sync.reconcile(f.selection,{force:true});
   assert.equal(second.corrected,0);
   assert.equal(f.counts.patched,1);
   assert.equal(f.counts.outbound,0);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
}
for(const option of [
 {name:'UNKNOWN_NO_RETRY terminal claim',args:{lastState:'UNKNOWN_NO_RETRY'}},
 {name:'cross-inbox original claim',args:{wrongScope:true}},
 {name:'stale unrelated original MID',args:{staleClaim:true}},
]){
 test('no status upgrade or duplicate import for '+option.name,async()=>{
  const {f,dir}=await withPendingOriginalClaim(option.args);
  try{
   const r=await createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir})
     .reconcile(f.selection,{force:true});
   assert.equal(r.ambiguousSubmitted,1);
   assert.equal(r.recoveredPendingMid,0);
   assert.equal(f.counts.patched,0);
   assert.equal(f.counts.outbound,0);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
}
test('concurrent original different-text MID prevents false binding and status upgrade',async()=>{
 const {f,dir}=await withPendingOriginalClaim();
 try{
  const previous=f.host.readRoom;
  f.host.readRoom=async(...args)=>{
   const room=await previous(...args);
   return {...room,messages:[...room.messages,
    {mid:'provider-out-concurrent',direction:'OUTBOUND',text:'Other message',
     timestamp:t-69000}]};
  };
  const result=await createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir})
   .reconcile(f.selection,{force:true});
  assert.equal(result.recoveredPendingMid,0);
  assert.equal(f.counts.patched,0);
  assert.equal(f.messages.find(m=>m.id===997).status,'failed');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('owner-exact status repair updates ONLY the selected failed WA2 Cloud message and no platform sender',async()=>{
 const {f,dir}=await withPendingOriginalClaim({waInboxId:155902});
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  const first=await sync.repairExactFailedOutgoing({selection:f.selection,cloudMessageId:997});
  assert.deepEqual(first,{ok:true,corrected:true,status:'sent',
   recoveredPendingMid:true,providerMidBound:true,platformSenderInvoked:false});
  assert.equal(f.messages.find(m=>m.id===997).status,'sent');
  assert.equal(f.counts.patched,1);
  assert.equal(f.counts.outbound,0);
  assert.equal(f.counts.inbound,0);
  const again=await sync.repairExactFailedOutgoing({selection:f.selection,cloudMessageId:997});
  assert.equal(again.unchanged,true);
  assert.equal(f.counts.patched,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('owner-exact status repair refuses unsigned, missing, cross-inbox and UNKNOWN claims',async()=>{
 for(const variation of [
  {args:{lastState:'UNKNOWN_NO_RETRY'}},
  {args:{wrongScope:true}},
 ]){
  const {f,dir}=await withPendingOriginalClaim(variation.args);
  try{
   const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
   await assert.rejects(sync.repairExactFailedOutgoing({
    selection:f.selection,cloudMessageId:997}),/DURABLE_CLAIM_NOT_VERIFIED/);
   assert.equal(f.counts.patched,0);
   assert.equal(f.counts.outbound,0);
  }finally{await rm(dir,{recursive:true,force:true})}
 }
 const {f,dir}=await withPendingOriginalClaim({waInboxId:155902});
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  await assert.rejects(sync.repairExactFailedOutgoing({
   selection:{...f.selection,cloudInboxId:155901},cloudMessageId:997}),/SCOPE_NOT_VERIFIED/);
  await assert.rejects(sync.repairExactFailedOutgoing({
   selection:f.selection,cloudMessageId:998}),/MESSAGE_NOT_AUTHORIZED/);
  assert.equal(f.counts.patched,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('owner-exact status repair refuses a PATCH whose sent state does not persist on Cloud',async()=>{
 const {f,dir}=await withPendingOriginalClaim();
 try{
  f.cloud.updateMessageStatus=async()=>{f.counts.patched++;return {status:'sent'}};
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  await assert.rejects(sync.repairExactFailedOutgoing({
   selection:f.selection,cloudMessageId:997}),/STATUS_NOT_PERSISTED/);
  assert.equal(f.counts.patched,1);
  assert.equal(f.messages.find(m=>m.id===997).status,'failed');
  assert.equal(f.counts.outbound,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});

for(const inboxId of [155901,155902]){
 test('v19 real new INBOUND MID on WhatsApp inbox '+inboxId+' corrects Cloud false failed without Sender or duplicate',async()=>{
  const f=fixture({waInboxId:inboxId});
  const expected=t-80000;
  f.messages.push({id:650,source_id:'provider-in-001',message_type:0,
   private:false,status:'failed',content:'guten morgen',
   created_at:(expected+4000)/1000,
   content_attributes:{yenra_history_import:false,
    yenra_original_platform_mid:'provider-in-001',
    external_created_at:expected/1000,
    external_error:'synthetic webhook failure'}});
  const sync=createCloudWaRecentSync({...f,now:()=>t});
  const r=await sync.reconcile(f.selection,{force:true});
  assert.equal(r.ok,true);assert.equal(r.corrected,1);
  assert.equal(sync.stats.correctedIncoming,1);
  assert.equal(f.messages.find(m=>m.id===650).status,'sent');
  assert.equal(f.counts.patched,1);
  assert.equal(f.counts.inbound,0,'must not import another inbound or raise a new alert');
  assert.equal(f.counts.outbound,1,'only unrelated original historical outbound may import');
  const repeat=await sync.reconcile(f.selection,{force:true});
  assert.equal(repeat.corrected,0);
  assert.equal(f.counts.patched,1);
 });
}
for(const alteration of [
 {name:'no signed original MID marker',attrs:{yenra_original_platform_mid:'wrong-mid'}},
 {name:'untrusted external original timestamp',attrs:{external_created_at:0}},
 {name:'stale unrelated Cloud create time',created_at:(t-80000+200000)/1000},
 {name:'unknown import status',attrs:{yenra_history_import:null}}
]){
 test('v19 Cloud incoming failed must stay failed with '+alteration.name,async()=>{
  const f=fixture();
  const expected=t-80000;
  f.messages.push({id:651,source_id:'provider-in-001',message_type:0,
   private:false,status:'failed',content:'guten morgen',
   created_at:(expected+4000)/1000,
   content_attributes:{yenra_history_import:false,
    yenra_original_platform_mid:'provider-in-001',
    external_created_at:expected/1000,...alteration.attrs},
   ...(alteration.created_at?{created_at:alteration.created_at}:{})});
  const r=await createCloudWaRecentSync({...f,now:()=>t})
   .reconcile(f.selection,{force:true});
  assert.equal(r.corrected,0);
  assert.equal(f.counts.patched,0);
  assert.equal(f.messages.find(m=>m.id===651).status,'failed');
 });
}
test('v19 original historical OUTBOUND source MID is displayed as sent only after persistent Cloud readback',async()=>{
 const f=fixture({waInboxId:155902});
 f.messages.push({id:750,source_id:'provider-out-002',message_type:1,
   private:false,status:'failed',content:'Guten Morgen',
   created_at:(t-70000+5000)/1000,
   content_attributes:{yenra_history_import:true,
    yenra_original_platform_mid:'provider-out-002',external_error:'synthetic callback timeout'}});
 const sync=createCloudWaRecentSync({...f,now:()=>t});
 const r=await sync.reconcile(f.selection,{force:true});
 assert.equal(r.corrected,1);assert.equal(sync.stats.correctedSent,1);
 assert.equal(f.messages.find(m=>m.id===750).status,'sent');
 assert.equal(f.counts.patched,1);
 assert.equal(f.counts.outbound,0,'no second Cloud bubble for original outbox');
 assert.equal(f.counts.inbound,1,'only unrelated original incoming can backfill');
});
test('v19 original historical OUTBOUND does not claim success if Cloud PATCH is not persisted',async()=>{
 const f=fixture({waInboxId:155902});
 f.messages.push({id:751,source_id:'provider-out-002',message_type:1,
   private:false,status:'failed',content:'Guten Morgen',
   content_attributes:{yenra_history_import:true,yenra_original_platform_mid:'provider-out-002'}});
 f.cloud.updateMessageStatus=async()=>{f.counts.patched++;return {status:'sent'}};
 const sync=createCloudWaRecentSync({...f,now:()=>t});
 const r=await sync.reconcile(f.selection,{force:true});
 assert.equal(r.corrected,0);assert.equal(sync.stats.correctedSent,0);
 assert.equal(f.messages.find(m=>m.id===751).status,'failed');
 assert.equal(f.counts.outbound,0);
});

for(const [kind,messageType,mid,text,age] of [
 ['live inbound',0,'provider-in-001','guten morgen',80000],
 ['historical outbound',1,'provider-out-002','Guten Morgen',70000]
]){
 test('v19 exact owner-only '+kind+' correction checks Cloud GET and original MID, never sends',async()=>{
  const f=fixture({waInboxId:155902}),created=t-age+4000;
  f.messages.push({id:850,source_id:mid,message_type:messageType,private:false,
    status:'failed',content:text,created_at:created/1000,
    content_attributes:{yenra_history_import:messageType===1,
      yenra_original_platform_mid:mid,external_created_at:(t-age)/1000}});
  const sync=createCloudWaRecentSync({...f,now:()=>t});
  const changed=await sync.repairExactVerifiedSourceBubble({
    selection:f.selection,cloudMessageId:850});
  assert.deepEqual(changed,{ok:true,statusObservedNow:'sent',
    asynchronousCloudCallbackUnverified:true,
    direction:messageType===0?'INBOUND':'OUTBOUND',
    platformSenderInvoked:false,providerReadAckNotAsserted:true});
  assert.equal(f.messages.find(m=>m.id===850).status,'sent');
  assert.equal(f.counts.patched,1);
  assert.equal(f.counts.outbound,0);
  assert.equal(f.counts.inbound,0);
  const again=await sync.repairExactVerifiedSourceBubble({selection:f.selection,cloudMessageId:850});
  assert.equal(again.unchanged,true);
  assert.equal(f.counts.patched,1);
 });
}
for(const bad of [
 {label:'forged source MID marker',attrs:{yenra_original_platform_mid:'not-real'}},
 {label:'invalid live original timestamp',attrs:{external_created_at:0}},
 {label:'unverified live import flag',attrs:{yenra_history_import:null}},
 {label:'cross contact private message',private:true},
 {label:'unrelated Cloud content',content:'unrelated'},
]){
 test('v19 exact inbound repair refuses '+bad.label,async()=>{
  const f=fixture({waInboxId:155902});
  f.messages.push({id:860,source_id:'provider-in-001',message_type:0,
    private:false,status:'failed',content:'guten morgen',
    created_at:(t-80000+4000)/1000,
    content_attributes:{yenra_history_import:false,yenra_original_platform_mid:'provider-in-001',
      external_created_at:(t-80000)/1000,...bad.attrs},
    ...(bad.content?{content:bad.content}:{}),
    ...(bad.private?{private:true}:{})});
  const sync=createCloudWaRecentSync({...f,now:()=>t});
  await assert.rejects(sync.repairExactVerifiedSourceBubble({
    selection:f.selection,cloudMessageId:860}));
  assert.equal(f.counts.patched,0);
  assert.equal(f.counts.outbound,0);
  assert.equal(f.messages.find(m=>m.id===860).status,'failed');
 });
}
test('v19 exact scoped fix refuses cross-inbox selection even when MID exists in Host',async()=>{
 const f=fixture({waInboxId:155902});
 f.messages.push({id:861,source_id:'provider-in-001',message_type:0,
  private:false,status:'failed',content:'guten morgen',
  created_at:(t-80000+4000)/1000,
  content_attributes:{yenra_history_import:false,yenra_original_platform_mid:'provider-in-001',
    external_created_at:(t-80000)/1000}});
 await assert.rejects(createCloudWaRecentSync({...f,now:()=>t})
  .repairExactVerifiedSourceBubble({selection:{...f.selection,cloudInboxId:155901},
    cloudMessageId:861}),/SCOPE_NOT_VERIFIED/);
 assert.equal(f.counts.patched,0);
});
test('v19 exact original status repair never claims success on a nonpersistent Cloud 200',async()=>{
 const f=fixture({waInboxId:155902});
 f.messages.push({id:870,source_id:'provider-in-001',message_type:0,
  private:false,status:'failed',content:'guten morgen',created_at:(t-80000+4000)/1000,
  content_attributes:{yenra_history_import:false,yenra_original_platform_mid:'provider-in-001',
    external_created_at:(t-80000)/1000}});
 f.cloud.updateMessageStatus=async()=>{f.counts.patched++;return {status:'sent'}};
 await assert.rejects(createCloudWaRecentSync({...f,now:()=>t})
  .repairExactVerifiedSourceBubble({selection:f.selection,cloudMessageId:870}),/NOT_PERSISTED/);
 assert.equal(f.counts.patched,1);
 assert.equal(f.messages.find(m=>m.id===870).status,'failed');
});

test('v19 upstream callback repeatedly re-fails a genuine new incoming MID: status PATCH is rate-limited per Cloud message',async()=>{
 const f=fixture({waInboxId:155902});
 const at=t-80000;let clock=t;
 f.messages.push({id:880,source_id:'provider-in-001',message_type:0,
   private:false,status:'failed',content:'guten morgen',created_at:(at+4000)/1000,
   content_attributes:{yenra_history_import:false,
     yenra_original_platform_mid:'provider-in-001',external_created_at:at/1000}});
 const sync=createCloudWaRecentSync({...f,now:()=>clock});
 const first=await sync.reconcile(f.selection,{force:true});
 assert.equal(first.corrected,1);assert.equal(f.counts.patched,1);
 f.messages.find(m=>m.id===880).status='failed'; // Async Cloud webhook rollback.
 for(let i=0;i<10;i++){
   const retry=await sync.reconcile(f.selection,{force:true});
   assert.equal(retry.corrected,0);
 }
 assert.equal(f.counts.patched,1,'ten upstream rollbacks must not trigger another PATCH burst');
 assert.equal(sync.stats.statusCorrectionThrottled,10);
 assert.equal(f.counts.inbound,0,'no duplicate real inbound');
 clock+=5*60*1000+1;
 const afterCooldown=await sync.reconcile(f.selection,{force:true});
 assert.equal(afterCooldown.corrected,1);
 assert.equal(f.counts.patched,2,'bounded single re-attempt only after cooldown');
 assert.equal(f.messages.find(m=>m.id===880).status,'sent');
});
test('v19 original historical outgoing Cloud callback rollback never causes repeated status PATCH or duplicate Sender',async()=>{
 const f=fixture({waInboxId:155902});
 f.messages.push({id:881,source_id:'provider-out-002',message_type:1,
   private:false,status:'failed',content:'Guten Morgen',
   content_attributes:{yenra_history_import:true,yenra_original_platform_mid:'provider-out-002'}});
 const sync=createCloudWaRecentSync({...f,now:()=>t});
 const first=await sync.reconcile(f.selection,{force:true});
 assert.equal(first.corrected,1);assert.equal(f.counts.patched,1);
 f.messages.find(m=>m.id===881).status='failed';
 for(let i=0;i<8;i++)await sync.reconcile(f.selection,{force:true});
 assert.equal(f.counts.patched,1);
 assert.equal(sync.stats.statusCorrectionThrottled,8);
 assert.equal(f.counts.outbound,0,'original sender must never send again');
 assert.equal(f.messages.find(m=>m.id===881).status,'failed',
   'Cloud failure remains honest when upstream is broken');
});
test('v19 once-only submitted Cloud claim status rollback is bounded without losing sender deduplication',async()=>{
 const {f,dir}=await withOneCloudClaim({status:'failed'});
 try{
  const sync=createCloudWaRecentSync({...f,now:()=>t,claimDirectory:dir});
  const first=await sync.reconcile(f.selection,{force:true});
  assert.equal(first.corrected,1);assert.equal(f.counts.patched,1);
  f.messages.find(m=>m.id===991).status='failed';
  for(let i=0;i<3;i++)await sync.reconcile(f.selection,{force:true});
  assert.equal(f.counts.patched,1);
  assert.equal(f.counts.outbound,0,'never replay original WA send on callback failure');
  assert.equal(sync.stats.statusCorrectionThrottled,3);
 }finally{await rm(dir,{recursive:true,force:true})}
});
