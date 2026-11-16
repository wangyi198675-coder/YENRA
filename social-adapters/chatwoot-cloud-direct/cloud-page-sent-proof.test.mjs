import test from 'node:test'
import assert from 'node:assert/strict'
import {cloudPageMemoryScope,cloudPageManagedAccountRef} from './cloud-page-memory-scope.mjs'
import {proveNativeCloudPageSent} from './cloud-page-sent-proof.mjs'
const account='a'.repeat(32),psid='1234567890123456',contactId=284212
const scope=cloudPageMemoryScope({originalAccountRef:account,metaPsid:psid,cloudContactId:contactId})
const now=Date.now()
const target={conversationId:11,messageId:80,accountRef:scope.memoryAccountRef,
  roomRef:scope.memoryRoomRef,pageIdentityHash:scope.pageIdentityHash}
const row={id:80,message_type:1,private:false,content:'Ciao, come stai?',
  source_id:'m_'+('A'.repeat(86)),status:'delivered',
  created_at:Math.floor(now/1000),attachments:[]}
const defaultDeps={
 cloud:{getContactById:async id=>({id,contact_inboxes:[{inbox:{id:155865},source_id:psid}]})},
 scopes:[{channel:'Page',cloudInboxId:155865,accountRef:account}],
 index:{byAccountRef:new Map([[account,{channel:'Page'}]])},
 readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[row]})
}
const prove=(override={},t=target)=>proveNativeCloudPageSent({...defaultDeps,...override,...t,now})
test('true Cloud Page delivery status and platform MID confirm original sent message',async()=>{
 const x=await prove()
 assert.equal(x.ok,true);assert.equal(x.messageId,80)
 assert.equal(x.text,row.content);assert.match(x.providerMidHash,/^[a-f0-9]{64}$/)
})
test('Meta MID + Cloud sent proves provider acceptance but never delivery',async()=>{
 const x=await prove({readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[{...row,status:'sent'}]})})
 assert.equal(x.ok,true)
 assert.equal(x.confirmationLevel,'provider-accepted')
 assert.equal(x.status,'sent')
})
test('local sent without a genuine Meta Page MID is refused',async()=>{
 const x=await prove({readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,
  rows:[{...row,source_id:'local-chatwoot-12345',status:'sent'}]})})
 assert.equal(x.ok,false)
})
test('failed provider status is never learned even with Meta MID',async()=>{
 const x=await prove({readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,
  rows:[{...row,status:'failed'}]})})
 assert.equal(x.ok,false)
})
test('cross-contact memory scope is rejected',async()=>{
 assert.equal((await prove({}, {...target,roomRef:'b'.repeat(32)})).ok,false)
})
test('original Cloud contact mismatch is refused',async()=>{
 assert.equal((await prove({readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId:contactId+1,rows:[row]})})).ok,false)
})
test('missing original provider MID is refused',async()=>{
 const x=await prove({readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[{...row,source_id:''}]})})
 assert.equal(x.ok,false)
})
test('old historical send is never admitted as new learning',async()=>{
 const x=await prove({readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[{...row,created_at:Math.floor(now/1000)-100000}]})})
 assert.equal(x.ok,false)
})
test('original confirmed receipt allows a later read status correction without new sends',async()=>{
 const old={...row,status:'read',created_at:Math.floor(now/1000)-3*86400}
 const source={readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[old]})}
 assert.equal((await prove(source)).ok,false)
 const upgraded=await prove(source,{...target,upgrade:true})
 assert.equal(upgraded.ok,true)
 assert.equal(upgraded.status,'read')
 assert.equal(upgraded.confirmationLevel,'delivery-confirmed')
})
test('even a confirmed receipt cannot bypass fourteen-day proof horizon',async()=>{
 const old={...row,status:'read',created_at:Math.floor(now/1000)-16*86400}
 const source={readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[old]})}
 assert.equal((await prove(source,{...target,upgrade:true})).ok,false)
})

test('second authenticated Facebook Page proves its own sent receipt without sharing Page 155865 memory',async()=>{
  const inboxId=156456
  const accountRef=cloudPageManagedAccountRef(inboxId)
  const bound=cloudPageMemoryScope({originalAccountRef:accountRef,cloudInboxId:inboxId,
    cloudContactId:contactId,metaPsid:psid})
  const cloud={
    listInboxes:async()=>[{id:155865,channelType:'Channel::FacebookPage'},
      {id:inboxId,channelType:'Channel::FacebookPage'}],
    getContactById:async id=>({id,contact_inboxes:[{inbox:{id:inboxId},source_id:psid}]})
  }
  const args={cloud,scopes:defaultDeps.scopes,index:defaultDeps.index,
    accountRef:bound.memoryAccountRef,roomRef:bound.memoryRoomRef,
    pageIdentityHash:bound.pageIdentityHash,conversationId:11,messageId:80,now,
    readCloudExportPage:async()=>({ok:true,inboxId,contactId,rows:[row]})}
  const allowed=await proveNativeCloudPageSent(args)
  assert.equal(allowed.ok,true)
  assert.equal(allowed.cloudInboxId,inboxId)
  assert.equal(allowed.confirmationLevel,'delivery-confirmed')
  // An older Page's same-looking Meta message cannot pass the new Page's scope.
  const foreign=await proveNativeCloudPageSent({...args,
    readCloudExportPage:async()=>({ok:true,inboxId:155865,contactId,rows:[row]})})
  assert.equal(foreign.ok,false)
})
