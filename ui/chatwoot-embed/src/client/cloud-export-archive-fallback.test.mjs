import test from 'node:test'
import assert from 'node:assert/strict'
import {exportCloudConversationReport} from './cloud-native-export.mjs'

const messages=[
  {id:101,message_type:0,private:false,content:'Good morning!',
    original_timestamp:1794770000,attachments:[]},
  {id:102,message_type:1,private:false,content:'Thank you',
    savedZh:'谢谢',original_timestamp:1794770050,attachments:[]},
  {id:103,message_type:0,private:false,content:'Nice to meet you',
    original_timestamp:1794770060,attachments:[]},
]
for(const format of ['html','zip']){
 test('native ChatLume '+format+' exports originals and available Chinese with no models',async()=>{
   const out=await exportCloudConversationReport({
     accountId:196799,conversationId:92,contactName:'Offline Sample',
     format,messages,signal:new AbortController().signal,
   })
   assert.equal(out.messageCount,3)
   assert.ok(out.blob.size>0)
   assert.ok(out.filename.endsWith(format==='html'?'.html':'.zip'))
   if(format==='html'){
     const text=await out.blob.text()
     assert.ok(text.includes('Good morning!'))
     assert.ok(text.includes('Thank you'))
     assert.ok(text.includes('谢谢'))
     assert.ok(text.includes('原文已保留'))
   }else{
     const head=new Uint8Array(await out.blob.slice(0,4).arrayBuffer())
     assert.equal(String.fromCharCode(...head.slice(0,2)),'PK')
   }
 })
}
