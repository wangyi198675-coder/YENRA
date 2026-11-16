import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
import {cloudPageMemoryScope,cloudPageManagedAccountRef,verifyCloudPageMemoryScope} from './cloud-page-memory-scope.mjs';
const OWNER='a'.repeat(32),PSID='12345678901234567',CONTACT=334,INBOX=156456;
const index={byIdentifier:new Map(),byAccountRef:new Map([[OWNER,{channel:'Page'}]])};
const scopes=[{channel:'Page',cloudInboxId:155865,accountRef:OWNER}];
const messenger=[
 {id:155865,name:'Yeonhee Kim',channelType:'Channel::FacebookPage'},
 {id:INBOX,name:'Kim',channelType:'Channel::FacebookPage'},
 {id:155901,name:'WA1',channelType:'Channel::Api'}
];
function makeCloud(inbox=INBOX,source=PSID){
 return {
  listInboxes:async()=>messenger,
  getConversation:async()=>({id:51,account_id:196799,inbox_id:inbox,
    meta:{sender:{id:CONTACT,name:'Safe Test Contact'}}}),
  getContactById:async()=>({id:CONTACT,contact_inboxes:[{inbox:{id:inbox},source_id:source}]})
 };
}
function makeReader(inbox=INBOX,source=PSID){
 return {
  async verifyMessengerPeer({conversationId,expectedInboxId}){
   assert.equal(expectedInboxId,inbox);
   return {cloudConversationId:conversationId,cloudInboxId:inbox,
     cloudContactId:CONTACT,metaPsid:source};
  },
  readMessages:async()=>[{id:1,private:false,message_type:0,content:'Hallo',
    created_at:1794640000}]
 };
}
test('new verified Cloud Messenger Page opens the same native DSH Brain, without original legacy Page room',async()=>{
 const cloud=makeCloud(),pageReader=makeReader();
 const r=await resolveCloudNativeConversation({cloud,index,scopes,conversationId:51,pageReader});
 assert.equal(r.ok,true);assert.equal(r.selection.kind,'CLOUD_PAGE');
 assert.equal(r.selection.cloudInboxId,INBOX);assert.equal(r.selection.messages.length,1);
 assert.match(r.selection.memoryAccountRef,/^[a-f0-9]{32}$/);
 assert.equal(JSON.stringify(r.selection).includes(PSID),false);
 assert.equal(await verifyCloudPageMemoryScope({cloud,index,scopes,
  accountRef:r.selection.memoryAccountRef,roomRef:r.selection.memoryRoomRef,
  pageIdentityHash:r.selection.pageIdentityHash,expectedInboxId:INBOX}),true);
 assert.equal(await verifyCloudPageMemoryScope({cloud,index,scopes,
  accountRef:r.selection.memoryAccountRef,roomRef:r.selection.memoryRoomRef,
  pageIdentityHash:r.selection.pageIdentityHash,expectedInboxId:155865}),false);
});
test('same PSID on different Page inboxes cannot leak Memory or DSH Brain',()=>{
 const old=cloudPageMemoryScope({originalAccountRef:OWNER,cloudInboxId:155865,
  cloudContactId:CONTACT,metaPsid:PSID});
 const newest=cloudPageMemoryScope({originalAccountRef:cloudPageManagedAccountRef(INBOX),
  cloudInboxId:INBOX,cloudContactId:CONTACT,metaPsid:PSID});
 assert.notEqual(old.memoryAccountRef,newest.memoryAccountRef);
 assert.notEqual(old.memoryRoomRef,newest.memoryRoomRef);
 assert.notEqual(old.pageIdentityHash,newest.pageIdentityHash);
});
test('new Page must be an account-authorized Facebook Page, not an API inbox',async()=>{
 const cloud=makeCloud(155901),pageReader=makeReader(155901);
 const r=await resolveCloudNativeConversation({cloud,index,scopes,conversationId:51,pageReader});
 assert.equal(r.ok,false);
 assert.equal(r.code,'CLOUD_ORIGINAL_IDENTIFIER_UNVERIFIED');
});
test('new Page with wrong Contact PSID cannot bind Brain',async()=>{
 const cloud=makeCloud(),pageReader=makeReader(INBOX,'bad');
 const r=await resolveCloudNativeConversation({cloud,index,scopes,conversationId:51,pageReader});
 assert.equal(r.ok,false);
 assert.equal(r.code,'CLOUD_PAGE_PS_IDENTITY_NOT_VERIFIED');
});
test('duplicate verified source bindings fail memory verification',async()=>{
 const scope=cloudPageMemoryScope({originalAccountRef:cloudPageManagedAccountRef(INBOX),
  cloudInboxId:INBOX,cloudContactId:CONTACT,metaPsid:PSID});
 const cloud=makeCloud();const original=cloud.getContactById;
 cloud.getContactById=async()=>{const contact=await original();contact.contact_inboxes.push({...contact.contact_inboxes[0]});return contact};
 assert.equal(await verifyCloudPageMemoryScope({cloud,index,scopes,
  accountRef:scope.memoryAccountRef,roomRef:scope.memoryRoomRef,
  pageIdentityHash:scope.pageIdentityHash}),false);
});
