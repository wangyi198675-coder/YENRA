import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyCloudApiChannelCallback} from './cloud-api-channel-callback.mjs';
const secrets={'155900':'00000000000000000000000000000000','155901':'11111111111111111111111111111111','155902':'22222222222222222222222222222222'};
const now=1794480000000,ts=String(now/1000);
const a={event:'message_created',account:{id:196799},inbox:{id:155901},conversation:{id:17},id:34,message_type:'outgoing',private:false,content:'hello'};
function packet(obj=a,secret=secrets['155901']){
 const rawBody=JSON.stringify(obj);
 return {rawBody,headers:{'x-chatwoot-timestamp':ts,'x-chatwoot-signature':'sha256='+createHmac('sha256',secret).update(ts+'.'+rawBody).digest('hex')}};
}
function check(p){return verifyCloudApiChannelCallback({...p,now:()=>now,secretProvider:async()=>secrets})}
test('valid Cloud API outgoing is blocked rather than silently sent',async()=>{
 const r=await check(packet());assert.equal(r.kind,'blocked');assert.equal(r.inbox,155901);
});
test('forged payload is rejected',async()=>assert.rejects(check({...packet(),rawBody:JSON.stringify({...a,content:'forged'})}),/SIGNATURE_REJECTED/));
test('other Cloud account and Page cannot be routed into the old Sender',async()=>{
 for(const x of [{...a,inbox:{id:155865}},{...a,account:{id:1}}])await assert.rejects(check(packet(x)),/CROSS_ACCOUNT_OR_INBOX_REJECTED/);
});
test('private note never invokes sender',async()=>assert.equal((await check(packet({...a,private:true}))).kind,'ignore'));
test('expired signature is rejected before any routing',async()=>assert.rejects(
 verifyCloudApiChannelCallback({...packet(),now:()=>now+301000,secretProvider:async()=>secrets}),/EXPIRED/));

// P0 fifth-channel admission regression: a synthetic unprovisioned Zangi
// inbox must never inherit WA1/WA2/Personal sender capabilities.
test('unprovisioned Zangi inbox cannot fall through to existing Cloud sender',async()=>{
 const syntheticZangi={...a,inbox:{id:999999},conversation:{id:17,inbox_id:999999}};
 await assert.rejects(check(packet(syntheticZangi)),/CROSS_ACCOUNT_OR_INBOX_REJECTED/);
});
