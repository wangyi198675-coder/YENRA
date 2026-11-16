import test from 'node:test';
import assert from 'node:assert/strict';
import {selectVerifiedCloudVisibleRead as choose} from './cloud-visible-read-gate.mjs';
const accountRef='a'.repeat(32),roomRef='b'.repeat(32),time=Date.parse('2026-11-16T08:54:00Z');
const m=(id,text,stamp)=>({mid:id,text,direction:'INBOUND',timestamp:stamp});
function fixture(){
 const mid='$matrix-event-001';
 return {accountRef,roomRef,channel:'Personal',conversationId:139,
  original:{accountRef,roomRef,channel:'Personal',messages:[
   m(mid,'Ciao, come stai?',time),
   m('$matrix-event-old','Old question',time-120000)]},
  cloud:{ok:true,accountId:196799,conversationId:139,inboxId:155900,
   rows:[{id:9981,source_id:mid,message_type:0,private:false,
    content:'Ciao, come stai?',created_at:(time+4000)/1000,
    original_timestamp:time/1000},
    {id:9980,source_id:'$matrix-event-old',message_type:0,private:false,
    content:'Old question',created_at:(time-116000)/1000,
    original_timestamp:(time-120000)/1000}]}
 }
}
test('actual currently visible Personal Cloud newest incoming matches original exact MID/text/account/room and is eligible',()=>{
 assert.deepEqual(choose(fixture()),{channel:'Personal',accountRef,roomRef,
  mid:'$matrix-event-001',cloudConversationId:139,cloudMessageId:9981});
});
for(const [name,patch] of [
 ['wrong Cloud account',f=>{f.cloud.accountId=3}],
 ['wrong Cloud Inbox Page',f=>{f.cloud.inboxId=155865}],
 ['wrong Cloud conversation',f=>{f.cloud.conversationId=140}],
 ['switched original contact',f=>{f.original.roomRef='c'.repeat(32)}],
 ['new unread original not yet Cloud visible',f=>{f.original.messages.push(m('$latest-in-original','New message',time+60000))}],
 ['new Cloud message not yet original',f=>{f.cloud.rows.push({id:9982,source_id:'$latest-in-cloud',
   content:'Not in original',message_type:0,private:false,created_at:(time+60000)/1000})}],
 ['same chat message ID but altered text',f=>{f.cloud.rows[0].content='FORGED'}],
 ['timestamp from unrelated older event',f=>{f.cloud.rows[0].original_timestamp=(time-300000)/1000}],
 ['Cloud private message',f=>{f.cloud.rows[0].private=true}],
 ['Cloud outgoing message',f=>{f.cloud.rows[0].message_type=1}],
 ['non-Matrix source MID',f=>{f.cloud.rows[0].source_id='provider-out';f.original.messages[0].mid='provider-out'}],
 ['unsupported WhatsApp channel',f=>{f.channel='WhatsApp';f.original.channel='WhatsApp';f.cloud.inboxId=155902}],
 ['unsupported Page channel',f=>{f.channel='Page';f.original.channel='Page';f.cloud.inboxId=155865}],
 ['duplicate original MID',f=>{f.original.messages.push({...f.original.messages[0]})}],
 ['missing original messages',f=>{f.original.messages=[]}]
]){
 test('refuse mark-read when '+name,()=>{
  const f=fixture();patch(f);assert.equal(choose(f),null);
 });
}

test('do not mark either message if two new original incoming MIDs share the same timestamp',()=>{
 const f=fixture();
 f.original.messages.push(m('$matrix-event-simultaneous','Another message',time));
 assert.equal(choose(f),null);
});
test('do not mark either message if two Cloud inbound MIDs share same creation timestamp',()=>{
 const f=fixture();
 f.cloud.rows.push({id:9983,source_id:'$unmatched-event',message_type:0,private:false,
  content:'Another message',created_at:(time+4000)/1000});
 assert.equal(choose(f),null);
});
test('a later owner OUTBOUND reply does not erase proof that newest incoming was visible',()=>{
 const f=fixture();
 f.cloud.rows.push({id:9985,source_id:null,message_type:1,private:false,
  content:'Thanks',created_at:(time+30000)/1000});
 assert.equal(choose(f)?.mid,'$matrix-event-001');
});
