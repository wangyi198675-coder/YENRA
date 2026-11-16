import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerCloudModelTranslation} from './cloud-model-translation.ts';

test('Cloud source -> DSH cache -> model -> native UI contract: five modes, no second Sender',async()=>{
 const originalFetch=globalThis.fetch;
 const cache=new Map();
 let route,modelCalls=0,cloudReads=0;
 const messages=[
  {id:101,message_type:1,private:false,content:'Guten Morgen'},
  {id:100,message_type:0,private:false,content:'Ciao bella'},
  {id:102,message_type:0,private:true,content:'Private note'}
 ];
 const ctx={
  llm:{
   listProviders:()=>[{id:'openai-codex'}],
   stream:async function*(request){
    modelCalls++;
    const content=JSON.parse(request.messages[0].content[0].text);
    yield {type:'text-delta',text:JSON.stringify({items:content.items.map(row=>({
     id:row.id,translation:row.id==='draft'?'Guten Morgen':'你好'
    }))})};
    yield {type:'finish',reason:{kind:'stop'}};
   },
  },
  inject:(_services,cb)=>cb({
   effect:(fn)=>fn(),
   webServer:{
    getOrigin:()=> 'http://127.0.0.1:37777',
    register:({handler})=>{route=handler;return()=>{}},
   },
  }),
 };
 const store=async()=>({table:()=>({
  get:(key)=>cache.get(key),
  put:async(key,value)=>{cache.set(key,value)},
 })});
 globalThis.fetch=async(uri,params)=>{
  assert.equal(uri,'http://127.0.0.1:31917/yenra-cloud/export-page');
  const body=JSON.parse(params.body);
  assert.equal(body.accountId,196799);
  assert.equal(body.conversationId,42);
  cloudReads++;
  const rows=messages.filter(row=>body.before===undefined||row.id<body.before);
  return {ok:true,json:async()=>({ok:true,accountId:196799,
   conversationId:42,rows})};
 };
 class Reply extends EventEmitter{
  status=0;output=null;writableEnded=false;destroyed=false;
  writeHead(code){this.status=code;}
  end(payload){this.output=JSON.parse(payload);this.writableEnded=true;}
 }
 async function call(data){
  const request={
   socket:{remoteAddress:'127.0.0.1'},
   headers:{'content-type':'application/json'},
   method:'POST',
   async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(data));},
  };
  const response=new Reply();
  await route(request,response);
  return {status:response.status,...response.output};
 }
 try{
  registerCloudModelTranslation(ctx,store,work=>work());
  assert.equal(typeof route,'function');
  const base={accountId:196799,conversationId:42};
  let res=await call({...base,mode:'cached',messageIds:[100]});
  assert.equal(res.status,200);
  assert.equal(res.mode,'cached');
  assert.equal(res.items[0].translation,null);
  assert.equal(modelCalls,0,'cached mode must not call paid model');
  res=await call({...base,mode:'export',messageIds:[100]});
  assert.equal(res.status,200);
  assert.equal(res.items[0].translation,'你好');
  assert.equal(modelCalls,1);
  assert.equal(cache.size,1);
  res=await call({...base,mode:'cached',messageIds:[100]});
  assert.equal(res.items[0].translation,'你好');
  assert.equal(modelCalls,1);
  res=await call({...base,mode:'export',messageIds:[101]});
  assert.equal(res.status,200);
  assert.equal(res.items[0].translation,'你好','outgoing export verified');
  res=await call({...base,mode:'incoming',messageIds:[100]});
  assert.equal(res.status,200);
  assert.equal(modelCalls,2,'incoming reuses export translation cache');
  res=await call({...base,mode:'copilot',copilotTexts:['Hallo']});
  assert.equal(res.status,200);
  assert.equal(res.mode,'copilot');
  assert.deepEqual(res.items,[{id:1,translation:'你好'}]);
  res=await call({...base,mode:'draft',draft:'早安'});
  assert.equal(res.status,200);
  assert.equal(res.translation,'Guten Morgen');
  const count=modelCalls;
  res=await call({...base,mode:'export',messageIds:[102]});
  assert.equal(res.status,422,'private notes are never translated');
  assert.equal(modelCalls,count);
  res=await call({...base,mode:'incoming',messageIds:[999]});
  assert.equal(res.status,422,'unverified MID is never translated');
  assert.equal(modelCalls,count);
  const reads=cloudReads;
  res=await call({...base,accountId:123,mode:'incoming',messageIds:[100]});
  assert.equal(res.status,422);
  assert.equal(cloudReads,reads,'wrong account blocked before Cloud request');
 }finally{
  globalThis.fetch=originalFetch;
 }
});