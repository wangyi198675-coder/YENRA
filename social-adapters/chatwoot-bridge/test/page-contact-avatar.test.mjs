import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedPageAvatarSync} from '../src/page-contact-avatar.mjs';
import {stableContactIdentifier} from '../src/contract.mjs';
const a='a'.repeat(32),r='b'.repeat(32),id=stableContactIdentifier(a,r);
function create({avatarAlready=false,correctInbox=true}={}){
 let reads=0,uploads=0;
 const index={byIdentifier:new Map([[id,{accountRef:a,roomRef:r,channel:'Page',inboxId:5}]])};
 const contact={id:310,identifier:id,contact_inboxes:[{inbox_id:correctInbox?5:2}],
   avatar_url:avatarAlready?'http://127.0.0.1/native-rails-avatar':''};
 const host={readFacebookContactAvatar:async()=>{reads++;return {mime:'image/jpeg',bytes:new Uint8Array(400)}}};
 const chatwoot={getContactById:async()=>contact,findContactByIdentifier:async()=>contact,
   uploadVerifiedContactAvatar:async()=>{uploads++;return {ok:true}}};
 return {sync:createVerifiedPageAvatarSync({host,chatwoot,index}),stats:()=>({reads,uploads})};
}
test('one verified Page contact avatar updates native storage only once',async()=>{
 const x=create();
 assert.equal((await x.sync.sync({accountRef:a,roomRef:r,contactId:310})).uploaded,true);
 assert.equal((await x.sync.sync({accountRef:a,roomRef:r,contactId:310})).cached,true);
 assert.deepEqual(x.stats(),{reads:1,uploads:1});
});
test('cross-account or wrong inbox never reads photo bytes',async()=>{
 const x=create({correctInbox:false});
 assert.equal((await x.sync.sync({accountRef:a,roomRef:r})).code,'PAGE_AVATAR_INBOX_MISMATCH');
 assert.equal((await x.sync.sync({accountRef:'f'.repeat(32),roomRef:r})).code,'PAGE_AVATAR_SCOPE_NOT_VERIFIED');
 assert.deepEqual(x.stats(),{reads:0,uploads:0});
});
test('native attached contact avatar is reused without downloading',async()=>{
 const x=create({avatarAlready:true});
 assert.equal((await x.sync.sync({accountRef:a,roomRef:r})).alreadyAttached,true);
 assert.deepEqual(x.stats(),{reads:0,uploads:0});
});
