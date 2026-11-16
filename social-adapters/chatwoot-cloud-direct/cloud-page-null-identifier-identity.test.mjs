import test from'node:test';import assert from'node:assert/strict';
import {ChatwootClient} from '../chatwoot-bridge/src/chatwoot-client.mjs';
import {cloudPageMemoryScope,verifyCloudPageMemoryScope} from './cloud-page-memory-scope.mjs';
function client(contact){
 const instance=new ChatwootClient({baseUrl:'https://app.chatwoot.com',accountId:196799,token:'test-only-local-identity',timeoutMs:2500});
 instance.request=async(method,url)=>{
  assert.equal(method,'GET');
  assert.match(url,/contacts\/221\?include_contact_inboxes=true$/);
  return{payload:contact};
 };
 return instance;
}
const id=221,psid='1000000000111100',accountRef='a'.repeat(32);
const contact={id,identifier:null,contact_inboxes:[{inbox:{id:155865},source_id:psid}]};
test('official Page contact identifier=null only accepted by explicit Page memory reader',async()=>{
 const cloud=client(contact);
 await assert.rejects(()=>cloud.getContactById(id),/CHATWOOT_CONTACT_IDENTITY_INVALID/);
 assert.equal((await cloud.getContactById(id,{allowPageWithoutIdentifier:true})).id,id);
});
test('explicit Page option still rejects invalid/forged account contact shapes',async()=>{
 for(const c of [{...contact,id:999},{...contact,identifier:0},{...contact,identifier:{}},null])
  await assert.rejects(()=>client(c).getContactById(id,{allowPageWithoutIdentifier:true}),/CHATWOOT_CONTACT_IDENTITY_INVALID/);
});
test('verified Page inbox and PSID must match stable memory identity',async()=>{
 const cloud=client(contact),scope=cloudPageMemoryScope({originalAccountRef:accountRef,cloudContactId:id,metaPsid:psid});
 const args={cloud,scopes:[{channel:'Page',cloudInboxId:155865,accountRef}],
   index:{byAccountRef:new Map([[accountRef,{channel:'Page'}]])},
   accountRef:scope.memoryAccountRef,roomRef:scope.memoryRoomRef,pageIdentityHash:scope.pageIdentityHash};
 assert.equal(await verifyCloudPageMemoryScope(args),true);
 assert.equal(await verifyCloudPageMemoryScope({...args,pageIdentityHash:'b'.repeat(64)}),false);
 assert.equal(await verifyCloudPageMemoryScope({...args,roomRef:scope.memoryRoomRef.slice(0,31)+'f'}),false);
 assert.equal(await verifyCloudPageMemoryScope({...args,cloud:client({...contact,contact_inboxes:[{inbox:{id:155900},source_id:psid}]})}),false);
 assert.equal(await verifyCloudPageMemoryScope({...args,cloud:client({...contact,contact_inboxes:[contact.contact_inboxes[0],contact.contact_inboxes[0]]})}),false);
});
