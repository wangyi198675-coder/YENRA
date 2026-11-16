import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudPageMemoryScope,verifyCloudPageMemoryScope} from './cloud-page-memory-scope.mjs';
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
const owner='a'.repeat(32),secondOwner='b'.repeat(32);
const peers=[{id:221,psid:'1000000000111100',conversation:11},
             {id:229,psid:'1000000000222200',conversation:29}];
const index={byIdentifier:new Map(),byAccountRef:new Map([[owner,{channel:'Page'}]])};
const scopes=[{channel:'Page',cloudInboxId:155865,accountRef:owner}];
const cloud={
 async getConversation(id){
  const p=peers.find(x=>x.conversation===id);
  if(!p)throw Error('not found');
  return {id,account_id:196799,inbox_id:155865,meta:{sender:{id:p.id,name:'Test Page Person'}}};
 },
 async getContactById(id){
  const p=peers.find(x=>x.id===id);
  if(!p)throw Error('no contact');
  return {id,contact_inboxes:[{inbox:{id:155865},source_id:p.psid}]};
 }
};
const pageReader={
 async verifyMessengerPeer({conversationId}){
  const p=peers.find(x=>x.conversation===conversationId);
  if(!p)throw Error('not verified');
  return {cloudConversationId:conversationId,cloudContactId:p.id,
    cloudInboxId:155865,metaPsid:p.psid};
 },
 async readMessages(){return []}
};
test('one original Cloud Page contact keeps stable scope across selections',async()=>{
 const a=await resolveCloudNativeConversation({cloud,index,scopes,conversationId:11,pageReader});
 assert.equal(a.ok,true);
 const v=a.selection;
 assert.equal(v.kind,'CLOUD_PAGE');
 assert.match(v.memoryAccountRef,/^[a-f0-9]{32}$/);
 assert.match(v.memoryRoomRef,/^[a-f0-9]{32}$/);
 assert.equal(await verifyCloudPageMemoryScope({cloud,scopes,index,accountRef:v.memoryAccountRef,
    roomRef:v.memoryRoomRef,pageIdentityHash:v.pageIdentityHash}),true);
 const direct=cloudPageMemoryScope({originalAccountRef:owner,cloudContactId:221,metaPsid:peers[0].psid});
 assert.equal(v.memoryRoomRef,direct.memoryRoomRef);
 assert.equal(v.pageIdentityHash,direct.pageIdentityHash);
 assert.equal(JSON.stringify(v).includes(peers[0].psid),false);
});
test('A->B->A isolates contact memory and cannot inherit legacy Page workspace',async()=>{
 const a=(await resolveCloudNativeConversation({cloud,index,scopes,conversationId:11,pageReader})).selection;
 const b=(await resolveCloudNativeConversation({cloud,index,scopes,conversationId:29,pageReader})).selection;
 const a2=(await resolveCloudNativeConversation({cloud,index,scopes,conversationId:11,pageReader})).selection;
 assert.equal(a.memoryAccountRef,b.memoryAccountRef);
 assert.notEqual(a.memoryRoomRef,b.memoryRoomRef);
 assert.equal(a.memoryRoomRef,a2.memoryRoomRef);
 assert.notEqual(a.memoryAccountRef,owner);
 assert.equal(await verifyCloudPageMemoryScope({cloud,scopes,index,accountRef:a.memoryAccountRef,
    roomRef:b.memoryRoomRef,pageIdentityHash:a.pageIdentityHash}),false);
 assert.equal(await verifyCloudPageMemoryScope({cloud,scopes,index,accountRef:owner,
    roomRef:a.memoryRoomRef,pageIdentityHash:a.pageIdentityHash}),false);
 assert.equal(await verifyCloudPageMemoryScope({cloud,scopes,index,accountRef:a.memoryAccountRef,
    roomRef:a.memoryRoomRef,pageIdentityHash:b.pageIdentityHash}),false);
});
test('Cloud account binding, contact source and unique inbox proof are mandatory',async()=>{
 const a=cloudPageMemoryScope({originalAccountRef:owner,cloudContactId:221,metaPsid:peers[0].psid});
 const args={cloud,scopes,index,accountRef:a.memoryAccountRef,roomRef:a.memoryRoomRef,pageIdentityHash:a.pageIdentityHash};
 assert.equal(await verifyCloudPageMemoryScope({...args,scopes:[{channel:'Page',cloudInboxId:155865,accountRef:secondOwner}]}),false);
 const altered={...cloud,getContactById:async id=>({id,contact_inboxes:[{inbox:{id:155900},source_id:peers[0].psid}]})};
 assert.equal(await verifyCloudPageMemoryScope({...args,cloud:altered}),false);
 const duplicated={...cloud,getContactById:async id=>({id,contact_inboxes:[{inbox:{id:155865},source_id:peers[0].psid},{inbox:{id:155865},source_id:peers[0].psid}]})};
 assert.equal(await verifyCloudPageMemoryScope({...args,cloud:duplicated}),false);
 const mutated={...cloud,getContactById:async id=>({id,contact_inboxes:[{inbox:{id:155865},source_id:peers[1].psid}]})};
 assert.equal(await verifyCloudPageMemoryScope({...args,cloud:mutated}),false);
 assert.equal(await verifyCloudPageMemoryScope({...args,roomRef:'0'.repeat(32)}),false);
});
