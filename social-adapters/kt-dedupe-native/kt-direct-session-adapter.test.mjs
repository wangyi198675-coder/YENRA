import test from 'node:test';
import assert from 'node:assert/strict';
import {createKtDirectSessionAdapter} from './kt-direct-session-adapter.mjs';
const digits='491631995093',number='+'+digits;
function make({status=200,body={success:true,data:[],repeat:[[digits,3]]},session='testing-local-token',
  wait=0}={}){
 const calls=[];
 const f=async(url,options)=>{calls.push({url:String(url),method:options.method,body:options.body,
  redirect:options.redirect,headerIsLocalToken:options.headers.token===session});
  if(wait)await new Promise(r=>setTimeout(r,wait));
  return {status,ok:status>=200&&status<300,json:async()=>body};
 };
 return {calls,adapter:createKtDirectSessionAdapter({fetchFn:f,loadSession:async()=>session})};
}
test('real KT original bulk query protocol emits accurate source-backed count',async()=>{
 const x=make();
 const v=await x.adapter.check({authorized:true,number,vendorPlatform:'whats'});
 assert.equal(v.status,'duplicate');assert.equal(v.repeatCount,3);
 assert.equal(v.freshQueryVerified,true);assert.equal(v.canSend,false);
 assert.equal(v.provenance,'KT_ORIGINAL_DIRECT_SESSION');
 assert.deepEqual(x.calls,[{
  url:'https://api.kt8899.org/whatsFriend/filterRepeatFriend/0',
  method:'POST',body:JSON.stringify([digits]),redirect:'error',headerIsLocalToken:true}]);
});
test('provider rejects calls not verified through original source MID',async()=>{
 const x=make();const v=await x.adapter.check({number,vendorPlatform:'whats'});
 assert.equal(v.status,'unavailable');assert.equal(v.reason,'KT_ORIGINAL_MID_NOT_VERIFIED');assert.equal(x.calls.length,0);
});
test('provider rejects invalid phone and unsupported non-WhatsApp platform',async()=>{
 const x=make();assert.equal((await x.adapter.check({number:'123456',authorized:true,vendorPlatform:'whats'})).status,'unavailable');
 assert.equal((await x.adapter.check({number,authorized:true,vendorPlatform:'fb'})).reason,'KT_PLATFORM_UNSUPPORTED');
 assert.equal(x.calls.length,0);
});
test('wrong original KT response number fails closed, never displays another contact count',async()=>{
 const x=make({body:{success:true,data:[digits],repeat:[['491732884738',56]]}});
 const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'unavailable');assert.equal(v.reason,'KT_ORIGINAL_MIXED_NUMBER_RESPONSE');
});
test('KT genuine data[] pass without repeat[] is confirmed not duplicate',async()=>{
 const x=make({body:{code:200,success:true,data:[digits],repeat:[]}});
 const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'not_duplicate');assert.equal(v.repeatCount,0);
 assert.equal(v.freshQueryVerified,true);
});
test('if number absent from both arrays, return unknown; never invent a pass',async()=>{
 const x=make({body:{code:200,success:true,data:[],repeat:[]}});
 const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'unavailable');assert.equal(v.reason,'KT_ORIGINAL_RESULT_UNKNOWN');
});
test('explicit original repeat zero is also a nonduplicate verdict',async()=>{
 const x=make({body:{success:true,data:[],repeat:[[digits,0]]}});
 const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'not_duplicate');assert.equal(v.repeatCount,0);
});
test('unexpected KT response number is never treated as same selected phone',async()=>{
 const x=make({body:{code:200,success:true,data:['491732884738'],repeat:[]}});
 const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'unavailable');assert.equal(v.reason,'KT_ORIGINAL_MIXED_NUMBER_RESPONSE');
});
test('KT session expired returns unavailable, never a fake count',async()=>{
 const x=make({status:401,body:null});
 const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'unavailable');assert.equal(v.reason,'KT_SESSION_EXPIRED');
});
test('KT login missing returns unavailable with no external HTTP request',async()=>{
 const x=make({session:''});const v=await x.adapter.check({number,authorized:true,vendorPlatform:'whats'});
 assert.equal(v.status,'unavailable');assert.equal(v.reason,'KT_SESSION_NOT_LOGGED_IN');assert.equal(x.calls.length,0);
});
test('multiple parallel manual clicks are queued, not rejected or overlapped',async()=>{
 const x=make({wait:30});
 const [a,b]=await Promise.all([
  x.adapter.check({number,authorized:true,vendorPlatform:'whats'}),
  x.adapter.check({number,authorized:true,vendorPlatform:'whats'})
 ]);
 assert.equal(a.status,'duplicate');assert.equal(b.status,'duplicate');
 assert.equal(a.repeatCount,3);assert.equal(b.repeatCount,3);
 assert.equal(x.calls.length,2);
});
