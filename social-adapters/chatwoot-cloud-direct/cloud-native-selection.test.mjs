import test from 'node:test';
import assert from 'node:assert/strict';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
const ref='a'.repeat(32),room='b'.repeat(32),identifier=stableContactIdentifier(ref,room);
const index={byIdentifier:new Map([[identifier,{accountRef:ref,roomRef:room,channel:'WhatsApp'}]])};
const scopes=[{accountRef:ref,cloudInboxId:155901,channel:'WhatsApp'}];
const ok=()=>({
 getConversation:async()=>({id:9,inbox_id:155901,account_id:196799,meta:{sender:{id:234}}}),
 getContactById:async()=>({id:234,identifier,contact_inboxes:[{source_id:identifier,inbox:{id:155901}}]})
});
test('Cloud contact hint binds only exact DSH-authorized Host room',async()=>{
 const result=await resolveCloudNativeConversation({cloud:ok(),index,scopes,conversationId:9});
 assert.equal(result.ok,true);assert.equal(result.selection.accountRef,ref);
});
test('cross-cloud inbox cannot bind WA room',async()=>{
 const cloud=ok();cloud.getConversation=async()=>({id:9,inbox_id:155902,account_id:196799,meta:{sender:{id:234}}});
 assert.equal((await resolveCloudNativeConversation({cloud,index,scopes,conversationId:9})).code,'CLOUD_CROSS_CHANNEL_SELECTION_REJECTED');
});
test('Cloud Facebook Page without verified original room not silently mapped',async()=>{
 const cloud=ok();cloud.getConversation=async()=>({id:9,inbox_id:155865,account_id:196799,meta:{sender:{id:234}}});
 assert.equal((await resolveCloudNativeConversation({cloud,index,scopes,conversationId:9,
   pageReader:{verifyMessengerPeer:async()=>{throw Error('MOCK_UNVERIFIED_PAGE')}}})).code,'CLOUD_PAGE_PS_IDENTITY_NOT_VERIFIED');
});
test('forged contact identifier does not resolve',async()=>{
 const cloud=ok();cloud.getContactById=async()=>({id:234,identifier:'yenra-'+('0'.repeat(40)),contact_inboxes:[]});
 assert.equal((await resolveCloudNativeConversation({cloud,index,scopes,conversationId:9})).code,'CLOUD_CONTACT_NOT_IN_AUTHORIZED_DSH_ROSTER');
});

test('official Page Cloud PSID opens an independently scoped read-only DSH Brain',async()=>{
 const pageAccountRef='c'.repeat(32);
 const cloud={
  getConversation:async()=>({id:6,inbox_id:155865,account_id:196799,meta:{sender:{id:313,name:'Test Page Person'}}})
 };
 const pageIndex={byIdentifier:new Map(),byAccountRef:new Map([[pageAccountRef,{channel:'Page'}]])};
 const pageScopes=[{channel:'Page',accountRef:pageAccountRef,cloudInboxId:155865}];
 const pageReader={
  verifyMessengerPeer:async()=>({cloudConversationId:6,cloudInboxId:155865,cloudContactId:313,metaPsid:'12345678901234567'}),
  readMessages:async()=>[
   {id:100,message_type:0,content:'Guten Morgen',created_at:1794500000,private:false},
   {id:101,message_type:1,content:'Hallo',created_at:1794500040,private:false,status:'delivered'},
   {id:104,message_type:1,content:'Cannot deliver',created_at:1794500050,private:false,status:'failed',
      source_id:null,content_attributes:{external_error:'Meta (#551)'}},
   {id:102,message_type:0,content:'Wie geht es dir?',created_at:1794500100,private:false},
   {id:103,message_type:0,content:'Secret note',created_at:1794500200,private:true},
  ]
 };
 const result=await resolveCloudNativeConversation({
  cloud,index:pageIndex,scopes:pageScopes,conversationId:6,pageReader});
 assert.equal(result.ok,true);
 assert.equal(result.selection.kind,'CLOUD_PAGE');
 assert.equal(result.selection.cloudInboxId,155865);
 assert.equal(result.selection.messages.length,4);
 assert.equal(result.selection.messages.find(m=>m.id===101).status,'delivered');
 assert.equal(result.selection.messages.find(m=>m.id===104).status,'failed');
 assert.equal(result.selection.messages.find(m=>m.id===100).status,'unknown');
 assert.match(result.selection.pageIdentityHash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(result.selection).includes('12345678901234567'),false);
 assert.equal(JSON.stringify(result.selection).includes('Secret note'),false);
 assert.equal(result.selection.accountRef,undefined);
 assert.equal(result.selection.roomRef,undefined);
 const swapped=await resolveCloudNativeConversation({
  cloud,index:pageIndex,scopes:pageScopes,conversationId:6,
  pageReader:{...pageReader,verifyMessengerPeer:async()=>({...await pageReader.verifyMessengerPeer(),cloudContactId:999})}});
 assert.equal(swapped.ok,false);
 assert.equal(swapped.code,'CLOUD_PAGE_PS_IDENTITY_NOT_VERIFIED');
});
