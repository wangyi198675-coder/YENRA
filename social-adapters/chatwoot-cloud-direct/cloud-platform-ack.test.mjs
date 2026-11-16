import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCloudPlatformAck} from './cloud-platform-ack.mjs';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const accountRef='a'.repeat(32),roomRef='b'.repeat(32),waMid='wamid.proof_777',personalMid='$matrix_event_777';
function fixture({channel='WhatsApp',status='sent',sourceId,duplicate=false,wrongContact=false,
 originalDirection='OUTBOUND',sourceText='Verified text',otherConversation=false}={}){
 const inboxId=channel==='WhatsApp'?155901:155900,mid=channel==='WhatsApp'?waMid:personalMid;
 const identifier=stableContactIdentifier(accountRef,roomRef);
 const cloudMessage={id:91,conversation_id:70,inbox_id:inboxId,
  message_type:1,private:false,source_id:sourceId===undefined?mid:sourceId,
  content:sourceText,status,created_at:1794500000};
 const messages=duplicate?[cloudMessage,{...cloudMessage,id:92}]:[cloudMessage];
 const patches=[];
 const cloud={accountId:196799,apiBase:'/api/v1/accounts/196799',
  findContactByIdentifier:async()=>({id:80,identifier:wrongContact?'bad':identifier,
   contact_inboxes:[{inbox:{id:inboxId},source_id:identifier}]}),
  listContactConversations:async()=>[{id:70,inbox_id:otherConversation?999:inboxId}],
  getConversation:async()=>({id:70,account_id:196799,inbox_id:inboxId,meta:{sender:{id:80}}}),
  getContactById:async()=>({id:80,identifier}),
  request:async(method,path)=>{
   assert.equal(method,'GET');assert.match(path,/\/conversations\/70\/messages/);
   return {payload:messages};
  },
  updateMessageStatus:async(cid,msgId,newStatus)=>patches.push([cid,msgId,newStatus])
 };
 const host={readRoom:async()=>({accountRef,roomRef,messages:[
  {mid,direction:originalDirection,text:sourceText,timestamp:1794500000000}
 ]})};
 const roster={accounts:[{accountRef,channel,rooms:[{roomRef}]}]};
 const scopes=[{channel,accountRef,cloudInboxId:inboxId}];
 const logger={warn(){}};
 const ack={channel,accountRef,roomRef,mid,ackKind:channel==='Personal'?'READ':'DELIVERED',
  providerAccepted:true,providerDelivered:true,providerRead:channel==='Personal'};
 return {cloud,host,roster,scopes,logger,ack,mid,inboxId,patches};
}
for(const first of ['delivered','read']){
 test('out-of-order native ACK cannot downgrade READ when '+first+' arrives first',async()=>{
  const h=fixture(),applied=[];
  let currentStatus='sent';
  h.cloud.request=async()=>({payload:[{
   id:91,conversation_id:70,inbox_id:155901,message_type:1,
   source_id:h.mid,private:false,content:'Verified text',status:currentStatus
  }]});
  h.cloud.updateMessageStatus=async(cid,msgId,status)=>{
   // Simulate a slow old DELIVERED PATCH after a fast READ event.
   if(status==='delivered')await new Promise(r=>setTimeout(r,25));
   currentStatus=status;applied.push(status);
  };
  const p=createCloudPlatformAck(h),read={...h.ack,ackKind:'READ',providerRead:true};
  const delivered=h.ack;
  const result=await Promise.all(first==='read'?
   [p.handle(read),p.handle(delivered)]:[p.handle(delivered),p.handle(read)]);
  assert.equal(result.every(r=>r.ok),true);
  assert.equal(currentStatus,'read');
  assert.equal(applied.at(-1),'read');
  assert.equal(p.stats.seen,2);
 });
}
test('native WhatsApp provider-delivered ACK updates the exact imported Cloud MID once',async()=>{
 const h=fixture(),p=createCloudPlatformAck(h);
 assert.equal((await p.handle(h.ack)).status,'delivered');
 assert.deepEqual(h.patches,[[70,91,'delivered']]);
 assert.equal(p.stats.updated,1);
});
test('native Personal Matrix read ACK stays in its own Cloud inbox',async()=>{
 const h=fixture({channel:'Personal'});
 assert.deepEqual((await createCloudPlatformAck(h).handle(h.ack)).status,'read');
 assert.deepEqual(h.patches,[[70,91,'read']]);
});
test('already-read Cloud message cannot be downgraded by delayed delivered ACK',async()=>{
 const h=fixture({status:'read'});
 const result=await createCloudPlatformAck(h).handle(h.ack);
 assert.equal(result.duplicate,true);assert.equal(h.patches.length,0);
});
test('source-id-less Cloud API message requires durable matching provider MID hash',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-ack-'));
 try{
  const h=fixture({sourceId:null});
  const folder=join(dir,'account-196799');await mkdir(folder);
  await writeFile(join(folder,'91.jsonl'),
   JSON.stringify({v:1,account:196799,inbox:h.inboxId,conversationId:70,messageId:91,
     state:'CLAIMED_BEFORE_SEND',contentSha256:sha('Verified text')})+'\n'+
   JSON.stringify({state:'SUBMITTED_UNCONFIRMED',platformMidPresent:true,
     providerMidSha256:sha(h.mid)})+'\n');
  const p=createCloudPlatformAck({...h,claimDirectory:dir});
  assert.equal((await p.handle(h.ack)).status,'delivered');
  assert.deepEqual(h.patches,[[70,91,'delivered']]);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Personal Cloud API outgoing without source_id can reach verified Matrix READ only with its durable exact MID hash',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-personal-ack-'));
 try{
  const h=fixture({channel:'Personal',sourceId:null});
  const folder=join(dir,'account-196799');await mkdir(folder);
  await writeFile(join(folder,'91.jsonl'),
   JSON.stringify({v:1,account:196799,inbox:155900,conversationId:70,messageId:91,
     state:'CLAIMED_BEFORE_SEND',contentSha256:sha('Verified text')})+'\n'+
   JSON.stringify({state:'SUBMITTED_UNCONFIRMED',platformMidPresent:true,
     providerMidSha256:sha(h.mid)})+'\n');
  const result=await createCloudPlatformAck({...h,claimDirectory:dir}).handle(h.ack);
  assert.equal(result.status,'read');
  assert.deepEqual(h.patches,[[70,91,'read']]);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('claim with platform MID presence but WITHOUT provider hash never proves ACK',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-ack-'));
 try{
  const h=fixture({sourceId:null});const folder=join(dir,'account-196799');await mkdir(folder);
  await writeFile(join(folder,'91.jsonl'),
   JSON.stringify({v:1,account:196799,inbox:h.inboxId,conversationId:70,messageId:91,
     state:'CLAIMED_BEFORE_SEND',contentSha256:sha('Verified text')})+'\n'+
   JSON.stringify({state:'SUBMITTED_UNCONFIRMED',platformMidPresent:true})+'\n');
  assert.equal((await createCloudPlatformAck({...h,claimDirectory:dir}).handle(h.ack)).ok,false);
  assert.equal(h.patches.length,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
for(const [name,options] of [
 ['wrong Cloud contact',{wrongContact:true}],
 ['wrong Cloud conversation',{otherConversation:true}],
 ['incoming original MID',{originalDirection:'INBOUND'}],
 ['ambiguous Cloud MID',{duplicate:true}],
]){
 test(name+' cannot alter Cloud ACK',async()=>{
  const h=fixture(options);
  assert.equal((await createCloudPlatformAck(h).handle(h.ack)).ok,false);
  assert.equal(h.patches.length,0);
 });
}
test('forged provider delivery proof is never upgraded',async()=>{
 const h=fixture();
 const result=await createCloudPlatformAck(h).handle({...h.ack,providerDelivered:false});
 assert.equal(result.ok,false);assert.equal(h.patches.length,0);
});
