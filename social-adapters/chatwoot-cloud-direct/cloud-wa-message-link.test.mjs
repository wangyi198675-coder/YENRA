import test from 'node:test';
import assert from 'node:assert/strict';
import {stableContactIdentifier} from '../chatwoot-bridge/src/contract.mjs';
import {verifyCloudWaMessageForReaction} from './cloud-wa-message-actions.mjs';

const accountRef='a'.repeat(32),roomRef='b'.repeat(32);
const identifier=stableContactIdentifier(accountRef,roomRef);
const mid='ORIGINAL_VERIFIED_PLATFORM_42',created=1794554699;
const primary={id:993294910,conversation_id:32,inbox_id:155901,
  message_type:1,private:false,source_id:null,status:'sent',
  sender:{id:284212},content:'Original WhatsApp self message',created_at:created,attachments:[]};
const mirror={id:993295485,conversation_id:32,inbox_id:155901,
  message_type:1,private:false,source_id:mid,status:'sent',
  sender:{id:284212},content:primary.content,created_at:created+18,
  content_attributes:{yenra_history_import:true,yenra_original_platform_mid:mid}};
const original={mid,direction:'OUTBOUND',text:primary.content,timestamp:created*1000+3000};
function setup({primaryChange={},mirrorChange={},extraCloud=[],hostExtras=[],dropMirror=false}={}){
 const rows=[{...primary,...primaryChange},
    ...(dropMirror?[]:[{...mirror,...mirrorChange}]),...extraCloud];
 const cloud={apiBase:'/api/v1/accounts/196799',
  getConversation:async()=>({id:32,account_id:196799,inbox_id:155901,meta:{sender:{id:9}}}),
  getContactById:async()=>({id:9,identifier,contact_inboxes:[{inbox:{id:155901},source_id:identifier}]}),
  request:async()=>({payload:rows})};
 const host={readRoom:async()=>({accountRef,roomRef,messages:[original,...hostExtras]})};
 return{cloud,index:{byIdentifier:new Map([[identifier,{accountRef,roomRef,channel:'WhatsApp'}]])},
  scopes:[{accountRef,cloudInboxId:155901,channel:'WhatsApp'}],host,
  conversationId:32,messageId:primary.id,emoji:'👍'};
}
test('original Cloud staff bubble links only to one independently verified DSH MID mirror',async()=>{
 const r=await verifyCloudWaMessageForReaction(setup());
 assert.equal(r.ok,true);
 assert.equal(r.selection.originalMid,mid);
 assert.equal(r.selection.cloudMessageId,primary.id);
 assert.equal(r.selection.direction,'OUTBOUND');
});
for(const [name,changes] of [
 ['missing confirmed MID mirror',{dropMirror:true}],
 ['changed mirror content',{mirrorChange:{content:'DIFFERENT'}}],
 ['other inbox mirror',{mirrorChange:{inbox_id:155902}}],
 ['unmarked fake mirror',{mirrorChange:{content_attributes:{}}}],
 ['mirror with mismatched original MID marker',{mirrorChange:{content_attributes:{yenra_history_import:true,yenra_original_platform_mid:'WRONG'}}}],
 ['wrong outbound staff',{primaryChange:{sender:{id:99}}}],
 ['not submitted Cloud message',{primaryChange:{status:'failed'}}],
 ['private Cloud note',{primaryChange:{private:true}}],
 ['changed Cloud text',{primaryChange:{content:'DIFFERENT'}}],
 ['wrong Cloud conversation',{primaryChange:{conversation_id:40}}],
 ['ambiguous original MID',{hostExtras:[{...original,mid:'OTHER_ORIGINAL_MID'}]}],
 ['ambiguous duplicate owner bubble',{extraCloud:[{...primary,id:993294911,created_at:created+1}]}],
 ['duplicate mirror source',{extraCloud:[{...mirror,id:993295486,created_at:created+20}]}],
 ['late unrelated platform timestamp',{primaryChange:{created_at:created-500}}],
 ['non-WhatsApp direction',{primaryChange:{message_type:0}}]
]){
 test(name+' is rejected before WhatsApp sending',async()=>{
  const r=await verifyCloudWaMessageForReaction(setup(changes));
  assert.equal(r.ok,false, name);
 });
}
