import test from 'node:test';import assert from 'node:assert/strict';
import{verifyCloudRequest,verifyCloudMessages}from'./cloud-model-translation.ts';
test('Cloud owner account and conversation validated before Cloud read/model call',()=>{
 assert.doesNotThrow(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'incoming',messageIds:[9901]}));
 assert.throws(()=>verifyCloudRequest({accountId:3,conversationId:25,mode:'incoming',messageIds:[9901]}),/SCOPE/);
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'incoming',messageIds:[9901,9901]}),/IDS/);
});
test('only verified real native incoming messages are translated',()=>{
 const msgs=[{id:9901,private:false,message_type:0,content:'Ciao'},
 {id:9902,private:true,message_type:0,content:'internal note'},
 {id:9903,private:false,message_type:1,content:'owner reply'}];
 assert.equal(verifyCloudMessages(msgs,[9901])[0].content,'Ciao');
 assert.throws(()=>verifyCloudMessages(msgs,[9902]),/UNVERIFIED/);
 assert.throws(()=>verifyCloudMessages(msgs,[9903]),/UNVERIFIED/);
 assert.throws(()=>verifyCloudMessages(msgs,[5500]),/UNVERIFIED/);
});
test('Chinese composer interception cannot accept raw text as a translated draft',()=>{
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'draft',draft:'hello'}),/CHINESE_DRAFT_REQUIRED/);
 assert.doesNotThrow(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'draft',draft:'你好，你今天怎么样？'}));
});

test('Cloud cached and export modes share verified native message scope',()=>{
 assert.doesNotThrow(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'cached',messageIds:[1,2,3]}));
 assert.doesNotThrow(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'export',messageIds:[1]}));
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'export',messageIds:Array.from({length:9},(_,i)=>i+1)}),/IDS/);
 assert.doesNotThrow(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'cached',messageIds:Array.from({length:30},(_,i)=>i+1)}));
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'cached',messageIds:Array.from({length:31},(_,i)=>i+1)}),/IDS/);
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'cached',messageIds:[1,1]}),/IDS/);
});
test('Cloud Copilot translations are display-only and bounded',()=>{
 assert.doesNotThrow(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'copilot',copilotTexts:['Guten Morgen','Hallo']}));
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'copilot',copilotTexts:['']}),/COPILOT/);
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'copilot',copilotTexts:Array(4).fill('Hallo')}),/COPILOT/);
 assert.throws(()=>verifyCloudRequest({accountId:196799,conversationId:25,mode:'copilot',copilotTexts:['Hallo'],draft:'秘密'}),/COPILOT/);
});
test('cached/export may verify native outgoing messages but never private notes',()=>{
 const rows=[{id:100,private:false,message_type:1,content:'Buongiorno'},
  {id:101,private:false,message_type:0,content:'Hallo'},
  {id:102,private:true,message_type:1,content:'private'},
  {id:103,private:false,message_type:2,content:'automation'}];
 assert.throws(()=>verifyCloudMessages(rows,[100]),/UNVERIFIED/);
 assert.equal(verifyCloudMessages(rows,[100],true)[0].content,'Buongiorno');
 assert.equal(verifyCloudMessages(rows,[101],true)[0].content,'Hallo');
 assert.throws(()=>verifyCloudMessages(rows,[102],true),/UNVERIFIED/);
 assert.throws(()=>verifyCloudMessages(rows,[103],true),/UNVERIFIED/);
});
