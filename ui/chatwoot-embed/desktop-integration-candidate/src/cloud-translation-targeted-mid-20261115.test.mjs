import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerCloudModelTranslation,verifyCloudRequest} from './cloud-model-translation.ts';

test('deep Cloud MID -> native page proof -> existing DSH translation; cached never spends',async()=>{
 const previous=globalThis.fetch, calls=[],cache=new Map();
 let handler,modelCalls=0,spoofContact=false;
 const rows=Array.from({length:401},(_,i)=>{
  const id=500-i;
  return {id,message_type:id===201?1:0,private:id===198,
   content:id===201?'Bonjour':id===198?'private note':'Guten Morgen',
   savedZh:id===200?'早安':null};
 });
 globalThis.fetch=async(_url,args)=>{
  const payload=JSON.parse(args.body);calls.push(payload);
  assert.equal(payload.accountId,196799);
  assert.equal(payload.conversationId,42);
  let batch=rows.filter(x=>payload.before===undefined||x.id<payload.before).slice(0,20);
  const mismatch=spoofContact&&payload.before===201;
  return {ok:true,json:async()=>({ok:true,accountId:196799,
   conversationId:42,contactId:mismatch?99:7,inboxId:12,
   rows:batch,hasMore:batch.length===20,
   nextCursor:batch.at(-1)?.id??null})};
 };
 const ctx={
  llm:{listProviders:()=>[{id:'openai-codex'}],
   listModels:async()=>[{id:'gpt-6-sol'}],
   stream:async function*(r){
    modelCalls++;
    const req=JSON.parse(r.messages[0].content[0].text);
    yield {type:'text-delta',text:JSON.stringify({items:req.items.map(x=>({
     id:x.id,translation:'你好'
    }))})};
    yield {type:'finish',reason:{kind:'stop'}};
   }},
  inject:(_deps,fn)=>fn({effect:fn=>fn(),webServer:{
   getOrigin:()=> 'http://127.0.0.1:37777',
   register:r=>{handler=r.handler;return()=>{}}
  }})
 };
 const store=async()=>({table:()=>({
  get:k=>cache.get(k),put:async(k,v)=>{cache.set(k,v)}
 })});
 class Reply extends EventEmitter{
  status=0;json=null;destroyed=false;writableEnded=false;
  writeHead(status){this.status=status;}
  end(value){this.json=JSON.parse(value);this.writableEnded=true;}
 }
 async function run(mode,ids){
  const req={method:'POST',socket:{remoteAddress:'127.0.0.1'},
   headers:{'content-type':'application/json'},
   async *[Symbol.asyncIterator](){
    yield Buffer.from(JSON.stringify({accountId:196799,
      conversationId:42,mode,messageIds:ids}));
   }};
  const res=new Reply();await handler(req,res);
  return {status:res.status,...res.json};
 }
 try{
  registerCloudModelTranslation(ctx,store,fn=>fn());
  const a=await run('cached',[200]);
  assert.equal(a.status,200);
  assert.equal(a.items[0].translation,'早安');
  assert.equal(modelCalls,0,'restoration must stay free');
  assert(calls.some(x=>x.before===201),'exact-ID cursor must find old message');
  assert(calls.length<=3,'never scan eight old pages');
  const b=await run('incoming',[201]);
  assert.equal(b.status,200,'automatic translated incoming-mode accepts outgoing Cloud MIDs');
  assert.equal(b.items[0].translation,'你好');
  assert.equal(modelCalls,1);
  const manual=await run('export',[201]);
  assert.equal(manual.status,200);
  assert.equal(manual.items[0].translation,'你好');
  assert.equal(modelCalls,1,'manual fallback must reuse automatic cache');
  const c=await run('cached',[201]);
  assert.equal(c.status,200);
  assert.equal(c.items[0].translation,'你好');
  assert.equal(modelCalls,1);
  const beforeBatchCalls=calls.length;
  const batch=await run('cached',Array.from({length:30},(_,i)=>200-i));
  assert.equal(batch.status,200);
  assert(batch.items.some(x=>x.id===200&&x.translation==='早安'));
  assert.equal(modelCalls,1,'30 old cached MIDs must never spend models');
  assert(calls.length-beforeBatchCalls<=5,'group old IDs into bounded native pages');
  const count=modelCalls;
  const priv=await run('export',[198]);
  assert.equal(priv.status,422);
  const autoPrivate=await run('incoming',[198]);
  assert.equal(autoPrivate.status,422,'automatic bidirectional translation must still deny private notes');
  const mixedPrivate=await run('incoming',[201,198]);
  assert.equal(mixedPrivate.status,422,'mixed private/outgoing batch must fail closed without partial disclosure');
  assert.equal(modelCalls,count,'private note never invokes model in either mode');
  const unknown=await run('incoming',[900]);
  assert.equal(unknown.status,422);
  assert.equal(modelCalls,count);
  spoofContact=true;
  const wrong=await run('cached',[200]);
  assert.equal(wrong.status,422,'contact changes must be denied');
  assert.equal(modelCalls,count);
  assert.throws(()=>verifyCloudRequest({accountId:196799,
   conversationId:42,mode:'export',messageIds:[Number.MAX_SAFE_INTEGER]}),/IDS/);
 }finally{globalThis.fetch=previous;}
});
