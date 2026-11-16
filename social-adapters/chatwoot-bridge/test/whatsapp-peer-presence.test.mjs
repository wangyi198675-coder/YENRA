import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectedWhatsAppPresence} from '../src/whatsapp-peer-presence.mjs';
import {classifySseFrame} from '../src/host-client.mjs';
import {stableContactIdentifier} from '../src/contract.mjs';
const accountRef='d'.repeat(32),roomRef='e'.repeat(32);
const identifier=stableContactIdentifier(accountRef,roomRef);
const correct={channel:'WhatsApp',accountRef,roomRef,
  source:'ORIGINAL_BAILEYS_PRESENCE',status:'on',observedAt:1700000000000};
const index={byIdentifier:new Map([[identifier,
  {channel:'WhatsApp',accountRef,roomRef,inboxId:3}]])};
test('native provider named SSE recognized, unknown or forged presence rejected',()=>{
  assert.equal(classifySseFrame({event:'whatsapp-peer-presence',
    data:JSON.stringify(correct)}).kind,'presence');
  assert.equal(classifySseFrame({event:'whatsapp-peer-presence',
    data:JSON.stringify({...correct,source:'CUSTOM_OR_GUESSED'})}).kind,'ignore');
});
test('native typing only for selected, same-auth account, real provider event',async()=>{
  const writes=[],cw={async writeVerifiedPeerTyping(q){writes.push(q);}};
  let t=1700000000000;
  const handler=createSelectedWhatsAppPresence({chatwoot:cw,index,now:()=>t});
  const falseFirst=await handler.handle(correct);
  assert.equal(falseFirst.ok,false);
  handler.select({channel:'WhatsApp',accountRef,roomRef,inboxId:3},57);
  assert.equal((await handler.handle({...correct,accountRef:'a'.repeat(32)})).ok,false);
  assert.equal((await handler.handle({...correct,observedAt:t-30000})).ok,false);
  assert.equal((await handler.handle(correct)).ok,true);
  assert.deepEqual(writes[0],{conversationDisplayId:57,inboxId:3,
    identifier,status:'on'});
  assert.equal((await handler.handle({...correct,status:'off'})).ok,true);
  assert.equal(writes.at(-1).status,'off');
  handler.select({channel:'Page',accountRef,roomRef,inboxId:5},90);
  assert.equal((await handler.handle(correct)).ok,false);
  handler.close();
});
