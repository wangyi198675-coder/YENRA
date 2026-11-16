import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerCloudModelTranslation} from './cloud-model-translation.ts';

test('overlapping A and A+B requests reuse settled A even after its pending map entry is deleted',async()=>{
 const oldFetch=globalThis.fetch,cache=new Map();
 let handler,modelCalls=0,notifyA,notifyB,resumeA,resumeB;
 const enteredA=new Promise(resolve=>{notifyA=resolve});
 const enteredB=new Promise(resolve=>{notifyB=resolve});
 const holdA=new Promise(resolve=>{resumeA=resolve});
 const holdB=new Promise(resolve=>{resumeB=resolve});
 const rows=[
  {id:101,message_type:0,private:false,content:'Hello there'},
  {id:102,message_type:1,private:false,content:'Good morning'},
 ];
 globalThis.fetch=async()=>({ok:true,json:async()=>({
  ok:true,accountId:196799,conversationId:92,contactId:7,inboxId:155865,
  rows,hasMore:false,nextCursor:null,
 })});
 const ctx={
  llm:{
   listProviders:()=>[{id:'openai-codex'}],
   listModels:async()=>[{id:'gpt-6-sol'}],
   stream:async function*(route){
    modelCalls++;
    const batch=JSON.parse(route.messages[0].content[0].text).items;
    if(batch.some(x=>x.id==='101')){notifyA();await holdA}
    else {notifyB();await holdB}
    yield{type:'text-delta',text:JSON.stringify({items:batch.map(x=>({
     id:x.id,translation:x.id==='101'?'你好':'早上好',
    }))})};
    yield{type:'finish',reason:{kind:'stop'}};
   },
  },
  inject:(_deps,fn)=>fn({effect:fn=>fn(),webServer:{
   getOrigin:()=> 'http://127.0.0.1:37777',
   register:r=>{handler=r.handler;return()=>{}},
  }}),
 };
 const store=async()=>({table:()=>({
  get:k=>cache.get(k),put:async(k,v)=>{cache.set(k,v)},
 })});
 class Reply extends EventEmitter{
  status=0;json=null;destroyed=false;writableEnded=false;
  writeHead(code){this.status=code}
  end(payload){this.json=JSON.parse(payload);this.writableEnded=true}
 }
 const run=async(ids,mode='incoming')=>{
  const req={method:'POST',socket:{remoteAddress:'127.0.0.1'},
   headers:{'content-type':'application/json'},
   async *[Symbol.asyncIterator](){
    yield Buffer.from(JSON.stringify({
     accountId:196799,conversationId:92,mode,messageIds:ids,
    }));
   },
  };
  const res=new Reply();await handler(req,res);
  return{status:res.status,...res.json};
 };
 try{
  registerCloudModelTranslation(ctx,store,fn=>fn());
  const first=run([101]);await enteredA;
  const second=run([101,102]);await enteredB;
  resumeA();
  const a=await first;
  assert.equal(a.status,200,JSON.stringify(a));
  resumeB();
  const b=await second;
  assert.equal(b.status,200,JSON.stringify(b));
  assert.deepEqual(b.items.map(x=>x.translation),['你好','早上好']);
  assert.equal(modelCalls,2,'singleflight must not redo already-running A');
  const cached=await run([101,102],'cached');
  assert.equal(cached.status,200);
  assert.deepEqual(cached.items.map(x=>x.translation),['你好','早上好']);
  assert.equal(modelCalls,2,'cached restoration never invokes model');
 }finally{globalThis.fetch=oldFetch;resumeA?.();resumeB?.()}
});
