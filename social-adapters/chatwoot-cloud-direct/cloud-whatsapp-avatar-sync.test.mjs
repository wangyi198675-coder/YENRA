import test from 'node:test';
import assert from 'node:assert/strict';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {createCloudWhatsAppAvatarSync} from './cloud-whatsapp-avatar-sync.mjs';
const accountRef='a'.repeat(32),roomRef='b'.repeat(32);
const id=stableContactIdentifier(accountRef,roomRef);
test('nonblocking Cloud native avatar update verifies exact contact and inbox',async()=>{
 let reads=0,uploads=0;
 const cloud={
  getContactById:async()=>({id:12,identifier:id,contact_inboxes:[{source_id:id,inbox:{id:155901}}],thumbnail:uploads?'https://example.com/avatar.jpg':null}),
  uploadVerifiedContactAvatar:async()=>{uploads++},
 };
 const host={readVerifiedWhatsAppContactAvatar:async()=>{reads++;return{mime:'image/jpeg',bytes:Buffer.from('testjpg'.repeat(40))}}};
 const s=createCloudWhatsAppAvatarSync({host,cloud,logger:{warn(){}}});
 assert.equal(s.schedule({channel:'WhatsApp',accountRef,roomRef,contactId:12,inboxId:155901}),true);
 assert.equal(s.schedule({channel:'WhatsApp',accountRef,roomRef,contactId:12,inboxId:155901}),true);
 await s.drain();assert.equal(reads,1);assert.equal(uploads,1);assert.equal(s.stats.uploaded,1);
});
test('cross-account or Page cannot upload a WhatsApp avatar',async()=>{
 let uploads=0;const s=createCloudWhatsAppAvatarSync({host:{readVerifiedWhatsAppContactAvatar:async()=>{}},
 cloud:{getContactById:async()=>{},uploadVerifiedContactAvatar:async()=>{uploads++}},
 logger:{warn(){}}});
 assert.equal(s.schedule({channel:'Page',accountRef,roomRef,contactId:12,inboxId:155901}),false);
 assert.equal(s.schedule({channel:'WhatsApp',accountRef,roomRef,contactId:12,inboxId:155865}),false);
 await s.drain();assert.equal(uploads,0);
});
test('existing Cloud native avatar bypasses source media retrieval',async()=>{
 let hostReads=0;
 const s=createCloudWhatsAppAvatarSync({host:{readVerifiedWhatsAppContactAvatar:async()=>{hostReads++}},
 cloud:{getContactById:async()=>({identifier:id,contact_inboxes:[{source_id:id,inbox:{id:155902}}],thumbnail:'https://example.com/existing.jpg'}),
 uploadVerifiedContactAvatar:async()=>{throw Error('NO')}} ,
 logger:{warn(){}}});
 assert.equal(s.schedule({channel:'WhatsApp',accountRef,roomRef,contactId:22,inboxId:155902}),true);
 await s.drain();assert.equal(hostReads,0);assert.equal(s.stats.alreadyPresent,1);
});
