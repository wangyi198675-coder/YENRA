import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {restoreSavedTranslationsForChatLume as restore} from './cloud-export-translation-policy.ts'

const make=(id,content='Hello from a friend')=>
  ({id,content,message_type:0,private:false})
const abort=()=>new AbortController().signal

test('13 missed translations never require a model call or block a ChatLume archive',async()=>{
  const rows=Array.from({length:13},(_,i)=>make(i+100))
  const calls=[]
  const result=await restore({rows,conversationId:92,signal:abort(),
    readCache:async ids=>{
      calls.push(ids)
      return {mode:'cached',conversationId:92,items:[]}
    },
  })
  assert.equal(result.missingCount,13)
  assert.equal(result.cacheUnavailable,false)
  assert.equal(calls.length,1)
  assert.deepEqual(calls[0],rows.map(row=>row.id))
})

test('restore saved Chinese by verified conversation and MID, preserve other original text',async()=>{
  const rows=[make(101,'How are you?'),make(102,'Good evening'),make(103,'Thank you')]
  const r=await restore({rows,conversationId:92,signal:abort(),readCache:async()=>({
    mode:'cached',conversationId:92,items:[
      {id:102,translation:'晚上好'},{id:101,translation:'你好吗？'},
    ],
  })})
  assert.equal(r.missingCount,1)
  assert.equal(rows[0].savedZh,'你好吗？')
  assert.equal(rows[1].savedZh,'晚上好')
  assert.equal(rows[2].savedZh,undefined)
  assert.equal(rows[0].content,'How are you?')
})

test('offline original DSH cache is nonfatal and original Cloud saved translations survive',async()=>{
  const rows=[make(101),{...make(102),savedZh:'已保存中文'},make(103)]
  let tries=0
  const r=await restore({rows,conversationId:92,signal:abort(),readCache:async()=>{
    tries++;throw Error('vclaw-gpt:MODEL_NOT_IN_CATALOG')
  }})
  assert.equal(tries,1)
  assert.deepEqual(r,{missingCount:2,cacheUnavailable:true})
  assert.equal(rows[1].savedZh,'已保存中文')
})

test('wrong conversation and foreign MID cannot corrupt exported translations',async()=>{
  const rows=[make(101),make(102)]
  let result=await restore({rows,conversationId:92,signal:abort(),readCache:async()=>({
    mode:'cached',conversationId:91,items:[{id:101,translation:'污染'}]
  })})
  assert.equal(result.cacheUnavailable,true)
  assert.equal(rows[0].savedZh,undefined)
  result=await restore({rows,conversationId:92,signal:abort(),readCache:async()=>({
    mode:'cached',conversationId:92,items:[{id:999,translation:'串号'}]
  })})
  assert.equal(result.cacheUnavailable,true)
  assert.equal(rows[0].savedZh,undefined)
})

test('cancel fails closed; private, numeric and Chinese originals do not call cache',async()=>{
  const controller=new AbortController()
  controller.abort(Error('EXPORT_CANCELLED'))
  await assert.rejects(()=>restore({rows:[make(101)],conversationId:92,
    signal:controller.signal,readCache:async()=>({})}),/EXPORT_CANCELLED/)
  let n=0
  const rows=[make(1,'123456'),make(2,'你好'),{...make(3),private:true},
    {...make(4),message_type:2}]
  const r=await restore({rows,conversationId:92,signal:abort(),readCache:async()=>{
    n++;return {}
  }})
  assert.equal(n,0)
  assert.equal(r.missingCount,0)
})

test('Cloud UI export sends cache-only requests and continues to original ChatLume',()=>{
  const src=readFileSync(new URL('./cloud-native-inbox.tsx',import.meta.url),'utf8')
  const section=src.slice(src.indexOf('const fetchExportTranslations='),src.indexOf("const reportModule='/api/yenra/cloud-export/runtime.js"))
  assert.ok(section.includes("mode:'cached'"))
  assert.ok(section.includes('restoreSavedTranslationsForChatLume'))
  assert.ok(!section.includes("mode:'export'"))
  assert.ok(!section.includes("fetchExportTranslations('export'"))
  assert.ok(src.includes('exportCloudConversationReport({'))
})
