import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerCloudModelTranslation} from './cloud-model-translation.ts';

test('real Cloud envelope: code + failed language + two valid MIDs yields partial HTTP 200, not batch 422',async()=>{
 const oldFetch=globalThis.fetch,cache=new Map();
 let handler,modelCalls=0,bridgeCalls=0;
 const messages=[
  {id:996962886,message_type:0,private:false,content:'goos6'},
  {id:996977080,message_type:0,private:false,content:'Iam Bob from the netherlands'},
  {id:996977545,message_type:0,private:false,content:'Iam fine kim'},
  {id:996977546,message_type:0,private:false,content:'untranslatable'},
  {id:996977547,message_type:0,private:true,content:'PRIVATE NOTE'},
 ];
 globalThis.fetch=async(url,args)=>{
  bridgeCalls++;assert.match(String(url),/127\.0\.0\.1:31917\/yenra-cloud\/export-page/);
  const payload=JSON.parse(args.body);
  assert.equal(payload.accountId,196799);assert.equal(payload.conversationId,92);
  return{ok:true,json:async()=>({ok:true,accountId:196799,conversationId:92,
   inboxId:155865,contactId:421,rows:messages,hasMore:false,nextCursor:null})};
 };
 const ctx={
  llm:{listProviders:()=>[{id:'openai-codex'}],
   listModels:async()=>[{id:'gpt-6-sol'}],
   stream:async function*(r){
    modelCalls++;
    const items=JSON.parse(r.messages[0].content[0].text).items;
    if(items.some(x=>x.text==='untranslatable'))throw Error('MODEL_TRANSLATION_LANGUAGE_INVALID');
    yield{type:'text-delta',text:JSON.stringify({items:items.map(x=>({id:x.id,translation:'中文正常译文'}))})};
    yield{type:'finish',reason:{kind:'stop'}};
   }},
  inject:(_d,fn)=>fn({effect:x=>x(),webServer:{getOrigin:()=> 'http://127.0.0.1:37777',
   register:args=>{handler=args.handler;return()=>{}}}})
 };
 const store=async()=>({table:()=>({get:k=>cache.get(k),put:async(k,v)=>cache.set(k,v)})});
 class Reply extends EventEmitter{
  status=0;json=null;destroyed=false;writableEnded=false;
  writeHead(status){this.status=status}
  end(body){this.json=JSON.parse(body);this.writableEnded=true}
 }
 const run=async(ids,mode='incoming')=>{
  const req={method:'POST',socket:{remoteAddress:'127.0.0.1'},
   headers:{'content-type':'application/json'},
   async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({accountId:196799,conversationId:92,mode,messageIds:ids}))}
  };
  const res=new Reply();await handler(req,res);
  return{http:res.status,...res.json};
 };
 try{
  registerCloudModelTranslation(ctx,store,fn=>fn());
  const ids=[996962886,996977080,996977545,996977546];
  const first=await run(ids);
  assert.equal(first.http,200,JSON.stringify(first));
  assert.deepEqual(first.items.map(x=>x.id),ids);
  assert.equal(first.items[0].translation,null,'goos6 is an identifier: show original, no model');
  assert.equal(first.items[1].translation,'中文正常译文');
  assert.equal(first.items[2].translation,'中文正常译文');
  assert.equal(first.items[3].translation,null,'one truly failed item stays untranslated');
  assert(modelCalls<=5,'a 3-row batch failure is bounded');
  const previousCalls=modelCalls;
  const second=await run(ids);
  assert.equal(second.http,200);
  assert.equal(second.items[1].translation,'中文正常译文');
  assert.equal(modelCalls,previousCalls,'cache successes and cool down only failure MID');
  const saved=await run(ids,'cached');
  assert.equal(saved.http,200);
  assert.deepEqual(saved.items.map(x=>x.id),[996977080,996977545]);
  assert.equal(modelCalls,previousCalls,'read-only cache must never spend models');
  const privateAttempt=await run([996977080,996977547]);
  assert.equal(privateAttempt.http,422,'private note contaminates scope; reject before model');
  assert.equal(modelCalls,previousCalls);
  assert(bridgeCalls>0);
 }finally{globalThis.fetch=oldFetch}
});
