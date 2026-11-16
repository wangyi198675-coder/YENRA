import test from 'node:test'
import assert from 'node:assert/strict'
import {translateUsingOriginalDshWithFallback as run} from './translation-model-fallback.ts'

const validation=(s)=>new Map(Object.entries(JSON.parse(s)))
const signal=()=>new AbortController().signal

test('advertised model IDs control native DSH model routing, never hardcoded missing IDs',async()=>{
 const streamCalls=[]
 const result=await run({
   registeredProviders:['openai-codex','vclaw-gpt'],
   listModels:async provider=>provider==='openai-codex'?['gpt-6.1-sol']:[],
   signal:signal(),validate:validation,
   stream:async function*(route){
     streamCalls.push({provider:route.provider,model:route.model})
     yield{type:'text-delta',text:'{"a":"你好"}'}
     yield{type:'finish',reason:{kind:'stop'}}
   }
 })
 assert.deepEqual(streamCalls,[{provider:'openai-codex',model:'gpt-6.1-sol'}])
 assert.equal(result.values.get('a'),'你好')
})

test('catalog mismatch must not call unavailable model or guess provider IDs',async()=>{
 let calls=0
 await assert.rejects(()=>run({
  registeredProviders:['vclaw-gpt'],
  listModels:async()=>['retired-unavailable-model'],
  signal:signal(),validate:validation,
  stream:async function*(){calls++;yield{type:'finish',reason:{kind:'stop'}}}
 }),/MODEL_NOT_IN_CATALOG/)
 assert.equal(calls,0)
})

test('real DSH provider failure falls back to another catalog-advertised route, without duplicate model retries',async()=>{
 const attempts=[]
 const result=await run({
  registeredProviders:['openai-codex','deepseek-official'],
  listModels:async provider=>provider==='openai-codex'?['gpt-6.1-sol']:['deepseek-flash'],
  signal:signal(),validate:validation,
  stream:async function*(route){
   attempts.push(route.provider+'/'+route.model)
   if(route.provider==='openai-codex'){
     yield{type:'finish',reason:{kind:'error',failure:{code:'MODEL_NOT_FOUND'}}}
   }else{
     yield{type:'text-delta',text:'{"a":"晚上好"}'}
     yield{type:'finish',reason:{kind:'stop'}}
   }
  }
 })
 assert.deepEqual(attempts,['openai-codex/gpt-6.1-sol','deepseek-official/deepseek-flash'])
 assert.equal(result.values.get('a'),'晚上好')
})

test('aborted model request does not continue to other providers',async()=>{
 const ctrl=new AbortController()
 ctrl.abort(Error('TRANSLATION_CANCELLED'))
 let calls=0
 await assert.rejects(()=>run({
  registeredProviders:['openai-codex','deepseek-official'],
  listModels:async()=>['gpt-6.1-sol'],
  signal:ctrl.signal,validate:validation,
  stream:async function*(){calls++;}
 }),/TRANSLATION_CANCELLED/)
 assert.equal(calls,0)
})
