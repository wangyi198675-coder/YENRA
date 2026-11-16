import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostSender} from '../src/sender-gate.mjs';
const input={channel:'WhatsApp',accountRef:'a'.repeat(32),roomRef:'b'.repeat(32),text:'Test only (mock; never sent)'};
const options={enabled:true,ownerSessionId:'session-00000000-0000-4000-8000-000000000000',baseUrl:'http://127.0.0.1:60474'};
test('reuses the verified dynamic DSH Host port before the only Sender POST',async()=>{
  let hits=0,actual='';
  const sender=createHostSender({...options,
    resolveBaseUrl:async()=> 'http://127.0.0.1:50642',
    fetchImpl:async(url)=>{hits++;actual=url;return {ok:true,json:async()=>({ok:true,receipt:{sent:true,submitted:true,deliveryStatus:'UNKNOWN',delivered:false,channel:'WhatsApp',accountRef:input.accountRef,roomRef:input.roomRef,providerMessageId:null}})};}});
  const r=await sender.send(input);
  assert.equal(r.submitted,true);
  assert.equal(hits,1);
  assert.equal(actual,'http://127.0.0.1:50642/api/yenra/social-text-send');
});
for(const [name,resolver] of [
 ['offline',async()=>{throw Error('OFFLINE')}],
 ['outside loopback',async()=> 'https://another-host.example:50642'],
 ['stale path',async()=> 'http://127.0.0.1:50642/other'],
])test(name+' rejects before platform submission',async()=>{
  let hits=0;
  const sender=createHostSender({...options,resolveBaseUrl:resolver,fetchImpl:async()=>{hits++;throw Error('SHOULD_NOT_SEND')}});
  await assert.rejects(sender.send(input),/HOST_SENDER_ACTIVE_HOST_/);
  assert.equal(hits,0);
});
