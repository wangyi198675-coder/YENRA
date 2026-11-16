import test from 'node:test';
import assert from 'node:assert/strict';
import {
 cloudRemotePersonalMemoryScope,verifiedCloudPersonalInbox,
 resolveCloudRemotePersonalConversation,verifyCloudRemotePersonalMemoryScope
} from './cloud-remote-personal-scope.mjs';
const account=196799,inbox=155900,id=97,contactId=1201932845;
const identifier='yenra-'+'c'.repeat(40);
const make=(opts={})=>{
 const calls=[];let sent=0;
 const inboxes=[{id:inbox,name:opts.name??'Facebook Personal',channelType:'Channel::Api'}];
 const cv={id,account_id:account,inbox_id:opts.inbox??inbox,
   meta:{sender:{id:opts.sender??contactId,name:'Verified Personal'}}};
 const contact={id:contactId,identifier:opts.identifier??identifier,
   contact_inboxes:opts.bindings??[{inbox:{id:inbox},source_id:identifier}]};
 const data={payload:opts.messages??[
   {id:1,message_type:0,conversation_id:id,inbox_id:inbox,content:'Hallo',created_at:1794500000},
   {id:2,message_type:1,conversation_id:id,inbox_id:inbox,content:'Guten Morgen',created_at:1794500010,status:'sent'},
   {id:3,message_type:0,conversation_id:id,inbox_id:inbox,content:'Private note',created_at:1794500020,private:true},
 ]};
 const cloud={accountId:opts.account??account,apiBase:'/api/v1/accounts/196799',
  listInboxes:async()=>{calls.push('listInboxes');return opts.inboxes??inboxes},
  getContactById:async n=>{calls.push('contact:'+n);return contact},
  request:async(method,path)=>{calls.push(method+':'+path);assert.equal(method,'GET');
   if(path.endsWith('/inboxes/'+inbox))return{payload:{
    id:inbox,name:opts.name??'Facebook Personal',channel_type:'Channel::Api',
    hmac_mandatory:opts.hmac??true,secret:opts.secret??'s'.repeat(32)
   }};
   if(path.endsWith('/conversations/'+id+'/messages'))return data;
   throw Error('unexpected read');
  },
  send:()=>{sent++}
 };
 return {cloud,cv,calls,get sent(){return sent}};
};
const resolve=x=>resolveCloudRemotePersonalConversation({
 cloud:x.cloud,conversation:x.cv,inboxId:x.cv.inbox_id,
 contactId:x.cv.meta.sender.id,readMessages:true
});
test('strictly scoped official Cloud Personal read produces native Brain projection',async()=>{
 const a=make(),r=await resolve(a);
 assert.equal(r.ok,true);
 assert.equal(r.selection.kind,'CLOUD_PERSONAL_REMOTE');
 assert.equal(r.selection.channel,'Personal');
 assert.equal(r.selection.cloudInboxId,inbox);
 assert.equal(r.selection.messages.length,2);
 assert.equal(JSON.stringify(r).includes('Private note'),false);
 assert.equal(r.selection.sendVia,'CLOUD_ORIGINAL_PERSONAL_SENDER_ONLY');
 assert.ok(a.calls.every(v=>!v.startsWith('POST')));
 assert.equal(a.sent,0);
 assert.equal(await verifyCloudRemotePersonalMemoryScope({
  cloud:a.cloud,accountRef:r.selection.memoryAccountRef,
  roomRef:r.selection.memoryRoomRef,cloudIdentityHash:r.selection.cloudIdentityHash,
  expectedInboxId:inbox
 }),true);
});
test('Personal identity and WhatsApp identity remain disjoint',async()=>{
 const a=cloudRemotePersonalMemoryScope({inboxId:inbox,contactId,identifier});
 const b=cloudRemotePersonalMemoryScope({inboxId:inbox,contactId:contactId+1,identifier});
 assert.notEqual(a.memoryRoomRef,b.memoryRoomRef);
 assert.notEqual(a.cloudIdentityHash,b.cloudIdentityHash);
 assert.match(a.memoryAccountRef,/^[a-f0-9]{32}$/);
 assert.match(a.memoryRoomRef,/^[a-f0-9]{32}$/);
});
test('wrong Cloud account, inbox, sender, HMAC and inbox name fail closed',async()=>{
 for(const o of [{account:1},{inbox:155901},{sender:1},{hmac:false},{name:'Not Personal'}]){
  const a=make(o),r=await resolve(a);
  assert.equal(r.ok,false,JSON.stringify(o));
 }
});
test('spoofed identifier, unrelated source_id, duplicated bindings fail closed',async()=>{
 for(const o of [
  {identifier:'fake-id'},
  {bindings:[{inbox:{id:inbox},source_id:'yenra-'+'0'.repeat(40)}]},
  {bindings:[{inbox:{id:inbox},source_id:identifier},{inbox:{id:inbox},source_id:identifier}]},
 ]){
  const r=await resolve(make(o));assert.equal(r.ok,false,JSON.stringify(o));
 }
});
test('wrong memory identities and inbox ID cannot read or bind',async()=>{
 const a=make(),p=cloudRemotePersonalMemoryScope({inboxId:inbox,contactId,identifier});
 const expected={cloud:a.cloud,accountRef:p.memoryAccountRef,roomRef:p.memoryRoomRef,
   cloudIdentityHash:p.cloudIdentityHash,expectedInboxId:inbox};
 assert.equal(await verifyCloudRemotePersonalMemoryScope({...expected,cloudIdentityHash:'0'.repeat(64)}),false);
 assert.equal(await verifyCloudRemotePersonalMemoryScope({...expected,roomRef:'0'.repeat(32)}),false);
 assert.equal(await verifyCloudRemotePersonalMemoryScope({...expected,expectedInboxId:155901}),false);
});
test('invalid or unbounded Cloud message response fails closed',async()=>{
 const a=make({messages:new Array(201).fill({})});
 const r=await resolve(a);
 assert.equal(r.ok,false);assert.equal(r.code,'CLOUD_REMOTE_PERSONAL_HISTORY_UNAVAILABLE');
});
