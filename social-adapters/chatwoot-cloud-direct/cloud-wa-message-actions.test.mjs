import test from 'node:test';
import assert from 'node:assert/strict';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {verifyCloudWaMessageForReaction} from './cloud-wa-message-actions.mjs';
const ref='a'.repeat(32),room='b'.repeat(32),identifier=stableContactIdentifier(ref,room);
const index={byIdentifier:new Map([[identifier,{channel:'WhatsApp',accountRef:ref,roomRef:room}]])};
const scopes=[{channel:'WhatsApp',accountRef:ref,cloudInboxId:155901}];
function setup({message={},conversation={},contact={},roomResult={},messageRows=null}={}){
 const m={id:91,conversation_id:9,inbox_id:155901,message_type:0,private:false,
   source_id:'ORIGINAL_123',content:'Hallo',...message};
 const cloud={
   apiBase:'/api/v1/accounts/196799',
   getConversation:async()=>({id:9,account_id:196799,inbox_id:155901,meta:{sender:{id:222}},...conversation}),
   getContactById:async()=>({id:222,identifier,contact_inboxes:[{source_id:identifier,inbox:{id:155901}}],...contact}),
   request:async()=>({payload:messageRows??[m]})
 };
 const host={readRoom:async()=>({accountRef:ref,roomRef:room,
  messages:[{mid:'ORIGINAL_123',direction:'INBOUND',text:'Hallo'}, ... (roomResult.messages??[])],
  ...Object.fromEntries(Object.entries(roomResult).filter(([k])=>k!=='messages'))})};
 return {cloud,index,scopes,host,conversationId:9,messageId:91,emoji:'❤️'};
}
test('only Cloud-verified WA original message is eligible',async()=>{
 const value=await verifyCloudWaMessageForReaction(setup());
 assert.equal(value.ok,true);
 assert.equal(value.selection.originalMid,'ORIGINAL_123');
 assert.equal(value.selection.direction,'INBOUND');
 assert.equal('jid' in value.selection,false);
});
const cases=[
 ['wrong platform inbox',{conversation:{inbox_id:155902}}],
 ['forged contact',{contact:{identifier:'yenra-'+('0'.repeat(40))}}],
 ['missing source MID',{message:{source_id:null}}],
 ['Cloud private note',{message:{private:true}}],
 ['cross-room Cloud message',{message:{conversation_id:72}}],
 ['wrong Cloud inbox',{message:{inbox_id:155902}}],
 ['mutated message text',{message:{content:'Changed'}}],
 ['outbound direction not in Host',{message:{message_type:1}}],
 ['wrong original Host room',{roomResult:{roomRef:'f'.repeat(32)}}],
 ['missing Cloud message ID',{messageRows:[]}],
 ['duplicate Cloud message ID',{messageRows:[
  {id:91,source_id:'ORIGINAL_123',message_type:0,content:'Hallo'},
  {id:91,source_id:'ORIGINAL_123',message_type:0,content:'Hallo'}]}],
];
for(const [name,opts] of cases){
 test(name+' refuses before platform action',async()=>{
  assert.equal((await verifyCloudWaMessageForReaction(setup(opts))).ok,false)
 })
}
test('unsupported emoji is rejected without Cloud reads',async()=>{
 let touched=0;
 const x=setup();x.emoji='🔫';x.cloud.getConversation=async()=>{touched++;throw Error('should not call')};
 assert.equal((await verifyCloudWaMessageForReaction(x)).ok,false);
 assert.equal(touched,0);
});
test('Cloud Page is never a WhatsApp reaction target',async()=>{
 const x=setup({conversation:{inbox_id:155865}});
 assert.equal((await verifyCloudWaMessageForReaction(x)).ok,false);
});
