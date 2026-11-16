import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCloudRemotePageConversation,verifyCloudRemotePageMemoryScope}
 from './cloud-remote-page-scope.mjs';
import {resolveCloudRemoteWhatsAppConversation,verifyCloudRemoteWhatsAppMemoryScope}
 from './cloud-remote-wa-scope.mjs';
const make=(type,inboxId,{wrongBinding=false,unsigned=false}={})=>{
 const page=type==='PAGE',contactId=1200511122,id=52;
 const source=page?'123456789012345':('yenra-'+'a'.repeat(40));
 const cb=page?'':(inboxId===155901||inboxId===155902?
  'https://desktop-029fh47.tail742be5.ts.net/yenra-cw-api-'+'b'.repeat(48):
  'https://friend-box.tail742be5.ts.net/yenra-friend-cw-'+'b'.repeat(48));
 const row={id:inboxId,name:page?'Another FB Page':inboxId===156555?
   'YENRA · WhatsApp · '+'a'.repeat(14):'Legacy Owner WA',
   channelType:page?'Channel::FacebookPage':'Channel::Api'};
 const conversation={id,account_id:196799,inbox_id:inboxId,
  meta:{sender:{id:contactId,name:'Fixture'}}};
 const contact={id:contactId,identifier:page?'':source,
  contact_inboxes:[{inbox:{id:inboxId},source_id:wrongBinding?'WRONG':source}]};
 const cloud={accountId:196799,apiBase:'/api/v1/accounts/196799',
  listInboxes:async()=>[row],
  getContactById:async()=>contact,
  request:async(method,path)=>{
   assert.equal(method,'GET');
   if(path.endsWith('/inboxes/'+inboxId))
    return {payload:{id:inboxId,name:row.name,channel_type:row.channelType,
     hmac_mandatory:unsigned?false:true,secret:'s'.repeat(32),
     webhook_url:cb}};
   if(path.endsWith('/conversations/'+id+'/messages'))
    return {payload:[{id:11,message_type:0,content:'Hallo',created_at:1794600000,
     inbox_id:inboxId,conversation_id:id}]};
   throw Error('UNKNOWN_ENDPOINT');
  }
 };
 return {cloud,conversation,inboxId,contactId};
};
for(const inboxId of [155865,156456]){
 test('Cloud Facebook Page Inbox '+inboxId+' is verified across devices',async()=>{
  const data=make('PAGE',inboxId);
  const response=await resolveCloudRemotePageConversation(data);
  assert.equal(response.ok,true,JSON.stringify(response));
  assert.equal(response.selection.kind,'CLOUD_PAGE');
  assert.equal(response.selection.messages.length,1);
  const scope=response.selection;
  assert.equal(await verifyCloudRemotePageMemoryScope({cloud:data.cloud,
   accountRef:scope.memoryAccountRef,roomRef:scope.memoryRoomRef,
   pageIdentityHash:scope.pageIdentityHash}),true);
 });
 test('Page '+inboxId+' rejects forged Cloud PSID binding',async()=>{
  const data=make('PAGE',inboxId,{wrongBinding:true});
  const response=await resolveCloudRemotePageConversation(data);
  assert.equal(response.ok,false);
 });
}
for(const inboxId of [155901,155902,156555]){
 test('signed WhatsApp Inbox '+inboxId+' verifies original Cloud scope',async()=>{
  const data=make('WA',inboxId);
  const response=await resolveCloudRemoteWhatsAppConversation(data);
  assert.equal(response.ok,true,JSON.stringify(response));
  assert.equal(response.selection.kind,'CLOUD_WHATSAPP_REMOTE');
  assert.equal(await verifyCloudRemoteWhatsAppMemoryScope({cloud:data.cloud,
   accountRef:response.selection.memoryAccountRef,
   roomRef:response.selection.memoryRoomRef,
   cloudIdentityHash:response.selection.cloudIdentityHash,
   expectedInboxId:inboxId}),true);
 });
 test('signed WhatsApp Inbox '+inboxId+' rejects missing HMAC',async()=>{
  const result=await resolveCloudRemoteWhatsAppConversation(make('WA',inboxId,{unsigned:true}));
  assert.equal(result.ok,false);
 });
}
test('Personal API Inbox cannot be mislabeled as WhatsApp',async()=>{
 const data=make('WA',155900);
 const result=await resolveCloudRemoteWhatsAppConversation(data);
 assert.equal(result.ok,false);
});
