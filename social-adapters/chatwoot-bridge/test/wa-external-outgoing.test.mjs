import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySseFrame} from '../src/host-client.mjs';
const A='a'.repeat(32),R='b'.repeat(32);
function event(overrides={}){return {event:'whatsapp-external-outgoing',data:JSON.stringify({
 channel:'WhatsApp',source:'ORIGINAL_DSH_IM_ATOMIC_INBOX',direction:'OUTBOUND',
 accountRef:A,roomRef:R,mid:'ORIGINAL-PLATFORM-MID-123',timestamp:Date.now(),...overrides
})}}
test('named original WhatsApp external outgoing triggers read-only sync route, never an incoming fake',()=>{
 const x=classifySseFrame(event());
 assert.equal(x.kind,'message');assert.equal(x.row.direction,'OUTBOUND');
 assert.equal(x.row.accountRef,A);assert.equal(x.row.roomRef,R);
 assert.equal(x.row.text,undefined);
});
test('invalid account, forged source, old MID or other channel are rejected',()=>{
 for(const invalid of [{source:'FORGED'},{channel:'Page'},{direction:'INBOUND'},
  {accountRef:'wrong'},{roomRef:'wrong'},{mid:''},{timestamp:Date.now()-3600_000}]){
  const x=classifySseFrame(event(invalid));
  assert.equal(x.kind,'ignore',JSON.stringify(invalid));
  assert.equal(x.reason,'UNVERIFIED_WA_EXTERNAL_OUTGOING');
 }
});
test('original regular incoming and named receipt routing remain unchanged',()=>{
 const incoming=classifySseFrame({data:JSON.stringify({accountRef:A,roomRef:R,direction:'INBOUND',mid:'m',timestamp:Date.now()})});
 assert.equal(incoming.kind,'message');assert.equal(incoming.row.direction,'INBOUND');
 const unknown=classifySseFrame({event:'not-ours',data:'{}'});
 assert.equal(unknown.reason,'UNKNOWN_NAMED_EVENT');
});
