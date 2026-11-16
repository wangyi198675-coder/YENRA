import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeServer} from '../src/server.mjs';
import {silentLogger} from '../src/logger.mjs';
import {createRequestShim,createResponseShim} from './fixtures/synthetic.mjs';

const body=JSON.stringify({accountId:1,displayId:25});
const trusted={
  'content-type':'application/json',
  origin:'http://127.0.0.1:31908',
  'x-yenra-page-thread-refresh':'1',
};
function create(syncPageConversation){
  return createBridgeServer({
    outbound:{handle:async()=>({status:202,body:{ok:true}})},
    logger:silentLogger,
    syncPageConversation,
  }).handleRequest;
}
async function check(handler,{method='POST',url='/page-conversation/sync',
  headers=trusted,raw=body}={}){
  const reply=createResponseShim();
  await handler(createRequestShim({method,url,headers,body:raw}),reply);
  return {status:reply.state.status,result:reply.json()};
}
test('verified native Page active thread waits for one original Host catch-up and returns no user content',async()=>{
  let count=0;
  const handler=create(async({accountId,displayId})=>{
    count++;assert.equal(accountId,1);assert.equal(displayId,25);
    return {ok:true,page:true,imported:2,code:'VERIFIED_PAGE_SYNC_DONE'};
  });
  const result=await check(handler);
  assert.equal(result.status,200);
  assert.equal(result.result.imported,2);
  assert.equal(count,1);
  assert.equal('accountRef' in result.result,false);
  assert.equal('roomRef' in result.result,false);
});
test('other origins, missing bridge gate and malformed accounts cannot trigger catch-up',async()=>{
  let count=0;
  const handler=create(async()=>{count++;return {ok:true}});
  for(const patch of [
    {headers:{...trusted,origin:'https://evil.example'}},
    {headers:{...trusted,'x-yenra-page-thread-refresh':'0'}},
    {method:'GET'},
    {raw:'{"accountId":1,"displayId":0}'},
  ]){
    const result=await check(handler,patch);
    assert.notEqual(result.status,200);
  }
  assert.equal(count,0);
});
test('verified non-Page conversation is rejected without history injection',async()=>{
  const handler=create(async()=>({ok:false,code:'NOT_VERIFIED_PAGE_CONVERSATION'}));
  const r=await check(handler);
  assert.equal(r.status,404);
});
