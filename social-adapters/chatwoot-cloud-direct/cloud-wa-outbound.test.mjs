import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,readFile,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import {createCloudWaOutbound} from './cloud-wa-outbound.mjs';
import{stableContactIdentifier}from'../chatwoot-bridge/src/contract.mjs';
const now=Date.parse('2026-11-12T11:30:00.000Z');
function setup({senderFails=false,missingMid=false,transportFails=false,messageChanges={},selectionChanges={},verifyChanges={},
 accountAgentIds=[284212,284213],inboxMemberIds=[284212,284213],channel='WhatsApp'}={}){
 const inboxId=channel==='Personal'?155900:155901;
 const accountRef='a'.repeat(32),roomRef='b'.repeat(32);
 const identifier=stableContactIdentifier(accountRef,roomRef);
 let sent=0;
 const msg={id:81,conversation_id:8,inbox_id:inboxId,message_type:1,
  sender:{id:284212},private:false,source_id:null,content:'Hallo',
  content_type:0,created_at:now/1000,attachments:[],...messageChanges};
 const cloud={
  accountId:196799,apiBase:'/api/v1/accounts/196799',
  getConversation:async()=>({id:8,account_id:196799,inbox_id:inboxId,
    meta:{sender:{id:900}},...selectionChanges}),
  getContactById:async()=>({id:900,identifier,contact_inboxes:[{inbox:{id:inboxId},source_id:identifier}]}),
  request:async(method,path)=>{
   assert.equal(method,'GET');
   if(path.endsWith('/agents'))return {payload:accountAgentIds.map(id=>({id}))};
   if(path.endsWith('/inbox_members/'+inboxId))return {payload:inboxMemberIds.map(id=>({id}))};
   return {payload:[msg]};
  }
 };
 const verify=async()=>({kind:'verified-outgoing',inbox:inboxId,conversationId:8,messageId:81,content:'Hallo',...verifyChanges});
 const hostSender={send:async args=>{assert.equal(args.channel,channel);sent++;if(senderFails)throw Error('SIMULATED_SENDER_UNCONFIRMED');return{providerMessageId:missingMid?null:channel==='Personal'?'$matrix_event_100':'wamid.mock',submitted:true,transportAccepted:!transportFails,deliveryStatus:'UNKNOWN',delivered:false,channel,accountRef,roomRef}}};
 const index={byIdentifier:new Map([[identifier,{accountRef,roomRef,channel}]])};
 const scopes=[{accountRef,cloudInboxId:inboxId,channel}];
 const logger={warn:()=>{}};
 return {cloud,verify,hostSender,index,scopes,logger,getSendCount:()=>sent};
}
test('Personal Cloud sender reuses ONE original Matrix sender with durable exact-MID claim and no duplicate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-personal-'));
 try{
  const b=setup({channel:'Personal'});
  const args={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000,
    allowedInboxIds:new Set([155901,155902,155900])};
  const p=createCloudWaOutbound(args);
  assert.equal((await p.process({})).kind,'submitted-unconfirmed');
  assert.equal(b.getSendCount(),1);
  assert.equal((await createCloudWaOutbound(args).process({})).kind,'already-claimed');
  assert.equal(b.getSendCount(),1);
  const claim=await readFile(join(dir,'account-196799','81.jsonl'),'utf8');
  assert.match(claim,/providerMidSha256/);
  assert.equal(claim.includes('$matrix_event_100'),false);
  assert.equal(claim.includes('Hallo'),false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Personal Cloud callback stays BLOCKED when Personal inbox not in active scope',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-personal-'));
 try{
  const b=setup({channel:'Personal'});
  await assert.rejects(createCloudWaOutbound({...b,claimDirectory:dir,
    now:()=>now,activatedAt:now-1000}).process({}),/UNVERIFIED_CALLBACK/);
  assert.equal(b.getSendCount(),0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Personal original transport-submitted without MID remains pending and never retries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-personal-'));
 try{
  const b=setup({channel:'Personal',missingMid:true}),args={...b,
    claimDirectory:dir,now:()=>now,activatedAt:now-1000,
    allowedInboxIds:new Set([155900])};
  const first=await createCloudWaOutbound(args).process({});
  assert.equal(first.kind,'submitted-mid-pending');
  assert.equal(first.delivered,false);
  assert.equal((await createCloudWaOutbound(args).process({})).kind,'submitted-mid-pending');
  assert.equal(b.getSendCount(),1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('verified WhatsApp Cloud message can submit only once, across adapter restarts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
 try{
  const b=setup(),options={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  const first=createCloudWaOutbound(options);
  const r=await first.process({});
  assert.equal(r.kind,'submitted-unconfirmed');
  assert.equal(b.getSendCount(),1);
  const restart=createCloudWaOutbound(options);
  const replay=await restart.process({});
  assert.equal(replay.kind,'already-claimed');
  assert.equal(b.getSendCount(),1);
  const claim=await readFile(join(dir,'account-196799','81.jsonl'),'utf8');
  assert.match(claim,/CLAIMED_BEFORE_SEND/);assert.match(claim,/SUBMITTED_UNCONFIRMED/);
  assert.equal(claim.includes('Hallo'),false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('second paid seat is allowed only when verified in the exact Cloud inbox',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
 try{
  const b=setup({messageChanges:{sender:{id:284213}}});
  const result=await createCloudWaOutbound({...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000}).process({});
  assert.equal(result.kind,'submitted-unconfirmed');
  assert.equal(b.getSendCount(),1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
for(const [name,changes]of [
 ['sender no longer in this inbox',{messageChanges:{sender:{id:284213}},inboxMemberIds:[284212]}],
 ['sender no longer in paid account',{messageChanges:{sender:{id:284213}},accountAgentIds:[284212]}],
 ['inbox has no verified members',{inboxMemberIds:[]}],
 ['account agent list has duplicate identities',{accountAgentIds:[284212,284212]}],
]){
 test(name+' cannot reach native Sender',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
  try{
   const b=setup(changes);
   await assert.rejects(createCloudWaOutbound({...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000}).process({}),
     /AGENT_NOT_MEMBER|AGENTS_UNVERIFIED|MEMBERS_UNVERIFIED/);
   assert.equal(b.getSendCount(),0);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
}
test('unknown Host sender outcome is NOT repeated on callback retry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
 try{
  const b=setup({senderFails:true}),o={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  await assert.rejects(createCloudWaOutbound(o).process({}),/UNKNOWN_NO_RETRY/);
  assert.equal((await createCloudWaOutbound(o).process({})).kind,'unknown-no-retry');
  assert.equal(b.getSendCount(),1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
for(const [name,changes]of [
 ['wrong agent',{messageChanges:{sender:{id:42}}}],
 ['wrong source id',{messageChanges:{source_id:'external-wa-mid'}}],
 ['wrong inbox',{messageChanges:{inbox_id:155902}}],
 ['wrong content',{messageChanges:{content:'DIFFERENT'}}],
 ['wrong account',{selectionChanges:{account_id:4}}],
 ['wrong webhook inbox',{verifyChanges:{inbox:155900}}],
 ['media not supported',{messageChanges:{attachments:[{id:1}]}}],
 ['history provenance cannot send',{messageChanges:{content_attributes:{yenra_history_import:true,external_created_at:1794490000}}}],
]){
 test(name+' refuses BEFORE claim and platform sender',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
  try{
   const b=setup(changes);
   await assert.rejects(createCloudWaOutbound({...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000}).process({}));
   assert.equal(b.getSendCount(),0);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
}

test('verified Cloud history callback is acknowledged without re-sending the original WhatsApp MID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
 try{
  const mid='provider-verified-old-mid';
  const b=setup({messageChanges:{source_id:mid,content_attributes:{yenra_history_import:true,yenra_original_platform_mid:mid}}});
  const out=await createCloudWaOutbound({...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000}).process({});
  assert.equal(out.kind,'ignored-history');
  assert.equal(b.getSendCount(),0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('messages created before Cloud sender activation are never retroactively sent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
 try{
  const b=setup({messageChanges:{created_at:(now-60000)/1000}});
  await assert.rejects(createCloudWaOutbound({
    ...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000
  }).process({}),/PRE_ACTIVATION_OUTBOUND_REFUSED/);
  assert.equal(b.getSendCount(),0);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('original WhatsApp transport confirms submission without MID: no false 503 or replay',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-'));
 try{
  const b=setup({missingMid:true}),o={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  const first=await createCloudWaOutbound(o).process({});
  assert.equal(first.kind,'submitted-mid-pending');
  assert.equal(first.providerMidPresent,false);
  assert.equal(first.delivered,false);
  const replay=await createCloudWaOutbound(o).process({});
  assert.equal(replay.kind,'submitted-mid-pending');
  assert.equal(b.getSendCount(),1,'original sender must be called exactly once');
  const claim=await readFile(join(dir,'account-196799','81.jsonl'),'utf8');
  assert.match(claim,/TRANSPORT_SUBMITTED_MID_PENDING/);
  assert.doesNotMatch(claim,/SUBMITTED_UNCONFIRMED|UNKNOWN_NO_RETRY|providerMidSha256/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('legacy submitted claim with MID presence but no provider hash is UNKNOWN on replay',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-legacy-'));
 try{
  const b=setup(),args={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  assert.equal((await createCloudWaOutbound(args).process({})).kind,'submitted-unconfirmed');
  const file=join(dir,'account-196799','81.jsonl');
  const lines=(await readFile(file,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
  delete lines[1].providerMidSha256;
  await writeFile(file,lines.map(s=>JSON.stringify(s)).join('\n')+'\n');
  const replay=await createCloudWaOutbound(args).process({});
  assert.equal(replay.kind,'unknown-no-retry');
  assert.equal(b.getSendCount(),1);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('existing Claim with altered inbox authority is UNKNOWN and cannot authorize a duplicate send',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-scope-'));
 try{
  const b=setup(),args={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  assert.equal((await createCloudWaOutbound(args).process({})).kind,'submitted-unconfirmed');
  const file=join(dir,'account-196799','81.jsonl');
  const lines=(await readFile(file,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
  lines[0].inbox=155902;
  await writeFile(file,lines.map(s=>JSON.stringify(s)).join('\n')+'\n');
  const replay=await createCloudWaOutbound(args).process({});
  assert.equal(replay.kind,'unknown-no-retry');
  assert.equal(b.getSendCount(),1);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Host transport not accepted, even if it returns submitted=true, is UNKNOWN and never retried',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-no-transport-'));
 try{
  const b=setup({missingMid:true,transportFails:true}),o={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  await assert.rejects(createCloudWaOutbound(o).process({}),/UNKNOWN_NO_RETRY/);
  assert.equal((await createCloudWaOutbound(o).process({})).kind,'unknown-no-retry');
  assert.equal(b.getSendCount(),1);
  const log=await readFile(join(dir,'account-196799','81.jsonl'),'utf8');
  assert.match(log,/UNKNOWN_NO_RETRY/);
  assert.doesNotMatch(log,/TRANSPORT_SUBMITTED_MID_PENDING/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('forged MID-pending claim cannot claim transport success on webhook replay',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yenra-cloud-wa-fake-pending-'));
 try{
  const b=setup({missingMid:true}),o={...b,claimDirectory:dir,now:()=>now,activatedAt:now-1000};
  assert.equal((await createCloudWaOutbound(o).process({})).kind,'submitted-mid-pending');
  const file=join(dir,'account-196799','81.jsonl');
  const rows=(await readFile(file,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
  rows[1].transportAccepted=false;
  await writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  assert.equal((await createCloudWaOutbound(o).process({})).kind,'unknown-no-retry');
  assert.equal(b.getSendCount(),1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
