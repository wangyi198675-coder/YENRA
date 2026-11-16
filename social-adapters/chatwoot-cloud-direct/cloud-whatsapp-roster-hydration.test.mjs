import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudInboundProjection} from './cloud-inbound-projection.mjs';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';

const wa1='a'.repeat(32),wa2='b'.repeat(32),r1='c'.repeat(32),r2='d'.repeat(32);
const phoneGerman=['+49','151','234','56789'].join('');
const phoneItalian=['+39','333','123','4567'].join('');
const accounts=[
 {channel:'WhatsApp',accountRef:wa1,rooms:[{roomRef:r1,phoneFallback:phoneGerman}]},
 {channel:'WhatsApp',accountRef:wa2,rooms:[{roomRef:r2,phoneFallback:phoneItalian}]},
];
const scopes=[
 {channel:'WhatsApp',accountRef:wa1,cloudInboxId:155901},
 {channel:'WhatsApp',accountRef:wa2,cloudInboxId:155902},
];
const ids=[stableContactIdentifier(wa1,r1),stableContactIdentifier(wa2,r2)];
function harness({wrongInbox=false,missingFirst=false}={}){
 const records=new Map(ids.map((id,i)=>[id,{
   id:91+i,identifier:id,phone_number:null,thumbnail:null,
   contact_inboxes:[{source_id:id,inbox:{id:i===0?155901:(wrongInbox?155901:155902)}}],
 }]));
 if(missingFirst)records.delete(ids[0]);
 const conversations=new Set(missingFirst?[92]:[91,92]);
 const counters={readAvatar:0,upload:0,putPhone:0,send:0,created:0,createdConversations:0};
 const cloud={apiBase:'/api/v1/accounts/196799',
   async findContactByIdentifier(id){return records.get(id)??null},
   async createContact({name,identifier,inboxId,sourceId}){
     assert.equal(sourceId,identifier);assert.equal(inboxId,155901);
     assert.ok(name);counters.created++;
     const contact={id:91,identifier,phone_number:null,thumbnail:null,
       contact_inboxes:[{source_id:identifier,inbox:{id:inboxId}}]};
     records.set(identifier,contact);return contact;
   },
   async listContactConversations(id){return conversations.has(id)
      ?[{id:5000+id,inbox_id:id===91?155901:155902}]:[]},
   async createConversation({contactId,inboxId,sourceId}){
     assert.equal(sourceId,ids[0]);assert.equal(contactId,91);
     assert.equal(inboxId,155901);
     counters.createdConversations++;conversations.add(contactId);
     return{id:5000+contactId,inbox_id:inboxId};
   },
   async getContactById(id){return [...records.values()].find(c=>c.id===id)},
   async uploadVerifiedContactAvatar(id){counters.upload++;
     const c=[...records.values()].find(x=>x.id===id);c.thumbnail='https://example.test/verified-avatar.jpg'},
   async request(method,url,body){
     if(method!=='PUT')throw Error('UNEXPECTED_CLOUD_READ_OR_WRITE');
     counters.putPhone++;
     const id=Number(url.split('/').at(-1));
     const c=[...records.values()].find(x=>x.id===id);
     if(!c)throw Error('UNEXPECTED_CLOUD_CONTACT');
     c.phone_number=body.phone_number;return c;
   },
 };
 const host={async readVerifiedWhatsAppContactAvatar(){counters.readAvatar++;
   return {mime:'image/jpeg',bytes:Buffer.from('verified-image-bytes'.repeat(20))}}};
 const service=createCloudInboundProjection({host,cloud,roster:{accounts},scopes,
   logger:{warn(){}},enabledAccountRefs:[wa1,wa2]});
 return {service,records,counters};
}
test('both existing original WhatsApp account contacts recover phone and avatar without fresh inbound or sending',async()=>{
 const h=harness();
 assert.deepEqual(await h.service.reconcileExistingWhatsAppContacts({batchSize:2}),
   {scanned:2,scheduled:2});
 await h.service.drain();
 assert.equal(h.counters.send,0);
 assert.equal(h.counters.created,0);
 assert.equal(h.counters.putPhone,2);
 assert.equal(h.counters.upload,2);
 assert.equal(h.counters.readAvatar,2);
 assert.equal(h.records.get(ids[0]).phone_number,phoneGerman);
 assert.equal(h.records.get(ids[1]).phone_number,phoneItalian);
 assert.equal(h.service.waRosterHydration.matched,2);
 assert.equal(h.service.waRosterHydration.failed,0);
});
test('cross-inbox Cloud identity is not hydrated even when identifier matches',async()=>{
 const h=harness({wrongInbox:true});
 await h.service.reconcileExistingWhatsAppContacts({batchSize:2});
 await h.service.drain();
 assert.equal(h.counters.upload,1);
 assert.equal(h.counters.putPhone,1);
 assert.equal(h.service.waRosterHydration.missing,1);
 assert.equal(h.records.get(ids[1]).phone_number,null);
});
test('contact open rejects forged channel, room and account before scheduling original photos or phone',async()=>{
 const h=harness();
 const input={channel:'WhatsApp',accountRef:wa1,roomRef:r1,
   cloudContactId:91,cloudInboxId:155901};
 assert.equal(h.service.scheduleExistingWhatsAppContact({...input,channel:'Page'}),false);
 assert.equal(h.service.scheduleExistingWhatsAppContact({...input,accountRef:'f'.repeat(32)}),false);
 assert.equal(h.service.scheduleExistingWhatsAppContact({...input,cloudInboxId:155902}),false);
 assert.equal(h.service.scheduleExistingWhatsAppContact(input),true);
 await h.service.drain();
 assert.equal(h.counters.upload,1);
 assert.equal(h.counters.putPhone,1);
});

test('YEN-14: verified original WhatsApp room absent from Cloud restores exactly one contact and native conversation',async()=>{
 const h=harness({missingFirst:true});
 const r=await h.service.reconcileExistingWhatsAppContacts({batchSize:2});
 assert.deepEqual(r,{scanned:2,scheduled:2});
 await h.service.drain();
 assert.equal(h.counters.created,1);
 assert.equal(h.counters.createdConversations,1);
 assert.equal(h.service.waRosterHydration.createdContacts,1);
 assert.equal(h.service.waRosterHydration.createdConversations,1);
 assert.equal(h.counters.putPhone,2);
 assert.equal(h.counters.upload,2);
 assert.equal(h.counters.send,0);
 await h.service.reconcileExistingWhatsAppContacts({batchSize:2});
 await h.service.drain();
 assert.equal(h.counters.created,1,'no duplicate Cloud contact on second full roster pass');
 assert.equal(h.counters.createdConversations,1,'no duplicate Cloud conversation');
});
