import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotOriginalWhatsAppOutbox,recoverSubmittedOriginalWhatsAppMid} from
 './cloud-wa-original-mid-recovery.mjs';
const accountRef='a'.repeat(32),roomRef='b'.repeat(32);
const scope={channel:'WhatsApp',accountRef,roomRef};
const t=Date.parse('2026-11-16T05:00:00.000Z');
const old={direction:'OUTBOUND',mid:'wamid.existing.1',text:'Hallo',timestamp:t-60000};
const fresh={direction:'OUTBOUND',mid:'wamid.fresh.2',text:'Hallo',timestamp:t+125};
const host=messages=>({readRoom:async args=>{
 assert.deepEqual(args,{channel:'WhatsApp',accountRef,roomRef});
 return {accountRef,roomRef,messages};
}});
test('unique original MID added after the authorized transport is recovered read-only',async()=>{
 const baseline=await snapshotOriginalWhatsAppOutbox({host:host([old]),scope});
 const mid=await recoverSubmittedOriginalWhatsAppMid({host:host([old,fresh]),
  scope,before:baseline,text:'Hallo',sendStartedAt:t,now:()=>t+250});
 assert.equal(mid,fresh.mid);
});
test('same text sent twice concurrently is ambiguous and never promoted into a claim',async()=>{
 const before=await snapshotOriginalWhatsAppOutbox({host:host([old]),scope});
 const extra={...fresh,mid:'wamid.fresh.3'};
 assert.equal(await recoverSubmittedOriginalWhatsAppMid({host:host([old,fresh,extra]),
  scope,before,text:'Hallo',sendStartedAt:t,now:()=>t+300}),null);
});
test('old text, different text, wrong room and malformed scope never qualify',async()=>{
 const baseline=await snapshotOriginalWhatsAppOutbox({host:host([old]),scope});
 assert.equal(await recoverSubmittedOriginalWhatsAppMid({host:host([old]),
  scope,before:baseline,text:'Hallo',sendStartedAt:t,now:()=>t+300}),null);
 assert.equal(await recoverSubmittedOriginalWhatsAppMid({host:host([old,fresh]),
  scope,before:baseline,text:'Other',sendStartedAt:t,now:()=>t+300}),null);
 assert.equal(await recoverSubmittedOriginalWhatsAppMid({host:host([old,fresh]),
  scope:{...scope,roomRef:'f'.repeat(32)},before:baseline,text:'Hallo',
  sendStartedAt:t,now:()=>t+300}),null);
});
test('a mid without a verified pre-send snapshot never proves submission',async()=>{
 assert.equal(await recoverSubmittedOriginalWhatsAppMid({host:host([fresh]),
  scope,before:null,text:'Hallo',sendStartedAt:t,now:()=>t+300}),null);
});

test('two new original outbounds of different texts are also ambiguous',async()=>{
 const baseline=await snapshotOriginalWhatsAppOutbox({host:host([old]),scope});
 const concurrent={...fresh,mid:'wamid.concurrent.4',text:'Other message'};
 assert.equal(await recoverSubmittedOriginalWhatsAppMid({host:host([old,fresh,concurrent]),
  scope,before:baseline,text:'Hallo',sendStartedAt:t,now:()=>t+300}),null);
});
