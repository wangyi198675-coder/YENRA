import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyVisibleTranslationMessage} from '../src/translation-proof.mjs'
import {webhookContactIdentifier} from '../src/contract.mjs'

const accountRef='a'.repeat(32),roomRef='b'.repeat(32),inboxId=5
const identifier='yenra-'+'c'.repeat(40)
const originalMid='native-platform-mid-001'
const conversation={id:48,display_id:16,account_id:1,inbox_id:5,
 meta:{sender:{id:13,identifier}},contact_inbox:{source_id:identifier}}
const client={
 async getConversation(){return conversation},
 async listConversationMessages(){return [{id:102,message_type:'incoming',private:false,
  account_id:1,inbox_id:5,source_id:originalMid,content:'Hello, how are you?'}]}
}
const index={byIdentifier:new Map([[identifier,{
 accountRef,roomRef,inboxId,channel:'Page',label:'Private contact'}]])}
const request={accountId:1,conversationId:16,inboxId:5,messageId:102,accountRef,roomRef,
 channel:'Page',sourceId:originalMid,text:'Hello, how are you?'}
test('verified Chatwoot persisted incoming text can prove only exact original Host-roster contact',async()=>{
 assert.deepEqual(await verifyVisibleTranslationMessage({chatwoot:client,index,expectedAccountId:1,request}),
  {ok:true,verified:true})
})
test('wrong host room, inbox or original text are rejected before any model',async()=>{
 for(const patch of [{roomRef:'d'.repeat(32)},{inboxId:2},{text:'forged'}, {sourceId:'forged'},
 {accountId:2},{messageId:999},{channel:'WhatsApp'}]){
  const value=await verifyVisibleTranslationMessage({
   chatwoot:client,index,expectedAccountId:1,request:{...request,...patch}})
  assert.equal(value.ok,false)
 }
})
test('owner outgoing original MID can translate; private and forged outgoing cannot',async()=>{
 const owned={...client,listConversationMessages:async()=>[{
  id:102,message_type:'outgoing',private:false,source_id:originalMid,content:request.text,
  account_id:1,inbox_id:5}]}
 assert.deepEqual(await verifyVisibleTranslationMessage({
  chatwoot:owned,index,expectedAccountId:1,request}),{ok:true,verified:true})
 for(const patch of [{private:true},{source_id:'forged'},{content:'forged'},{inbox_id:3},{account_id:2}]){
  const denied={...client,listConversationMessages:async()=>[{
   id:102,message_type:'outgoing',private:false,source_id:originalMid,
   content:request.text,account_id:1,inbox_id:5,...patch}]}
  const value=await verifyVisibleTranslationMessage({
   chatwoot:denied,index,expectedAccountId:1,request})
  assert.equal(value.ok,false)
 }
})
