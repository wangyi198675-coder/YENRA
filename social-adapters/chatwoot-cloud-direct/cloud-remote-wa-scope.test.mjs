import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
import {
 cloudRemoteWhatsAppMemoryScope,verifyCloudRemoteWhatsAppMemoryScope,
} from './cloud-remote-wa-scope.mjs';

const cloudAccountId=196799;
const inboxId=190001,otherInboxId=190002,contactId=613,conversationId=2701;
const name='YENRA · WhatsApp · '+'a'.repeat(14);
const identifier='yenra-'+'c'.repeat(40);
const callback='https://friend-device.private.ts.net/yenra-friend-cw-'+'a'.repeat(48);
const refs={byIdentifier:new Map(),byAccountRef:new Map()};
const scopes=[{channel:'WhatsApp',accountRef:'1'.repeat(32),cloudInboxId:155901}];
function mock(opts={}){
 const state={reads:[],sent:0,ident:opts.identifier??identifier};
 const contact={
  id:contactId,identifier:state.ident,name:'Contact name',
  contact_inboxes:opts.bindings??[{inbox:{id:inboxId},source_id:identifier}],
 };
 const rows=[
  {id:inboxId,name,channelType:'Channel::Api'},
  {id:155901,name:'YENRA WhatsApp 1',channelType:'Channel::Api'},
  {id:otherInboxId,name:'YENRA · WhatsApp · '+'b'.repeat(14),channelType:'Channel::Api'},
 ];
 const cv={id:conversationId,account_id:opts.accountId??cloudAccountId,
  inbox_id:opts.inboxId??inboxId,meta:{sender:{id:opts.senderId??contactId,name:'Friend Contact'}}};
 const messages=opts.messages??[
  {id:100,message_type:0,content:'Guten Morgen',created_at:1794600000,
   inbox_id:inboxId,conversation_id:conversationId,private:false},
  {id:101,message_type:1,content:'Hallo',created_at:1794600010,
   inbox_id:inboxId,conversation_id:conversationId,private:false,status:'sent'},
  {id:102,message_type:0,content:'Sensitive private note',created_at:1794600020,private:true},
 ];
 const cloud={
  accountId:cloudAccountId,apiBase:'/api/v1/accounts/196799',
  async getConversation(n){state.reads.push('conversation');assert.equal(n,conversationId);return cv},
  async listInboxes(){state.reads.push('inboxes');return rows},
  async getContactById(n){state.reads.push('contact');assert.equal(n,contactId);return contact},
  async request(method,path){
   state.reads.push(method+path);assert.equal(method,'GET');
   if(path.endsWith('/inboxes/'+inboxId))return {payload:{
    id:inboxId,name,channel_type:'Channel::Api',
    hmac_mandatory:opts.unsigned?false:true,
    secret:opts.missingSecret?null:'s'.repeat(32),
    channel:{webhook_url:opts.wrongCallback?'https://wrong.invalid/callback':callback},
   }};
   if(path.endsWith('/conversations/'+conversationId+'/messages'))return {payload:messages};
   throw Error('unrecognized read-only endpoint');
  },
 };
 return {cloud,state,cv,contact,rows};
}
const resolve=cloud=>resolveCloudNativeConversation({
 cloud,index:refs,scopes,conversationId
});
test('friend Inbox verified through official Cloud source, no owner DSH roster',async()=>{
 const {cloud,state}=mock();
 const result=await resolve(cloud);
 assert.equal(result.ok,true);
 assert.equal(result.selection.kind,'CLOUD_WHATSAPP_REMOTE');
 assert.equal(result.selection.channel,'WhatsApp');
 assert.equal(result.selection.cloudInboxId,inboxId);
 assert.equal(result.selection.sendVia,'CLOUD_ORIGINAL_FRIEND_SENDER_ONLY');
 assert.equal(result.selection.accountRef,undefined);
 assert.equal(result.selection.roomRef,undefined);
 assert.equal(result.selection.messages.length,2);
 assert.equal(JSON.stringify(result).includes('Sensitive private note'),false);
 assert.equal(JSON.stringify(result).includes(callback),false);
 assert.ok(state.reads.every(s=>!s.startsWith('POST')));
 const hash=result.selection.cloudIdentityHash;
 assert.match(hash,/^[a-f0-9]{64}$/);
 assert.equal(await verifyCloudRemoteWhatsAppMemoryScope({
  cloud,accountRef:result.selection.memoryAccountRef,
  roomRef:result.selection.memoryRoomRef,
  cloudIdentityHash:hash,expectedInboxId:inboxId,
 }),true);
});
test('new Inbox and contact have different strictly isolated memory',async()=>{
 const a=cloudRemoteWhatsAppMemoryScope({inboxId,contactId,identifier});
 const b=cloudRemoteWhatsAppMemoryScope({inboxId:otherInboxId,contactId,identifier});
 const c=cloudRemoteWhatsAppMemoryScope({inboxId,contactId:contactId+1,identifier});
 const a2=cloudRemoteWhatsAppMemoryScope({inboxId,contactId,identifier});
 assert.deepEqual(a,a2);
 assert.notEqual(a.memoryAccountRef,b.memoryAccountRef);
 assert.notEqual(a.memoryRoomRef,c.memoryRoomRef);
 assert.notEqual(a.cloudIdentityHash,b.cloudIdentityHash);
});
test('wrong Cloud account, sender, inbox, contact source are rejected',async()=>{
 for(const opts of [
  {accountId:197700},{senderId:contactId+1},
  {bindings:[{inbox:{id:otherInboxId},source_id:identifier}]},
  {bindings:[{inbox:{id:inboxId},source_id:'yenra-'+'0'.repeat(40)}]},
  {bindings:[{inbox:{id:inboxId},source_id:identifier},
    {inbox:{id:inboxId},source_id:identifier}]},
 ]){
  const {cloud}=mock(opts);
  const result=await resolve(cloud);
  assert.equal(result.ok,false,JSON.stringify(opts));
 }
});
test('unsigned API Inbox, wrong webhook route or absent secret fail closed',async()=>{
 for(const opts of [{unsigned:true},{wrongCallback:true},{missingSecret:true}]){
  const {cloud}=mock(opts);
  const result=await resolve(cloud);
  assert.equal(result.ok,false);
  assert.equal(result.code,'CLOUD_REMOTE_WA_INBOX_SIGNED_BINDING_INVALID');
 }
});
test('swapped memory hash, contact and Inbox fail proof',async()=>{
 const {cloud}=mock();
 const proof=cloudRemoteWhatsAppMemoryScope({inboxId,contactId,identifier});
 const args={cloud,accountRef:proof.memoryAccountRef,roomRef:proof.memoryRoomRef,
  cloudIdentityHash:proof.cloudIdentityHash,expectedInboxId:inboxId};
 assert.equal(await verifyCloudRemoteWhatsAppMemoryScope({...args,cloudIdentityHash:'0'.repeat(64)}),false);
 assert.equal(await verifyCloudRemoteWhatsAppMemoryScope({...args,expectedInboxId:otherInboxId}),false);
 assert.equal(await verifyCloudRemoteWhatsAppMemoryScope({...args,roomRef:'0'.repeat(32)}),false);
});
test('friends cannot be inferred from unrecognized API Inbox',async()=>{
 const {cloud}=mock();
 cloud.listInboxes=async()=>[{id:inboxId,name:'Unrelated API Channel',channelType:'Channel::Api'}];
 const result=await resolve(cloud);
 assert.equal(result.ok,false);
 assert.equal(result.code,'CLOUD_NON_API_CHANNEL_DEFERRED');
});
test('invalid Cloud message list blocks Brain context',async()=>{
 const {cloud}=mock({messages:new Array(201).fill({})});
 const result=await resolve(cloud);
 assert.equal(result.ok,false);
 assert.equal(result.code,'CLOUD_REMOTE_WA_HISTORY_UNAVAILABLE');
});
