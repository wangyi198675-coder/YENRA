import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudConversationExport} from './cloud-conversation-export.mjs';
const verified={ok:true,selection:{cloudAccountId:196799,cloudConversationId:8,cloudInboxId:155901,cloudContactId:48}};
function fixture({crossAccount=false,wrongContact=false}={}){
 let apiCount=0,resolveCount=0;
 const cloud={apiBase:'/api/v1/accounts/196799',
  getConversation:async()=>({id:8,account_id:crossAccount?7:196799,inbox_id:155901,
    meta:{sender:{id:wrongContact?49:48,name:'Vitali'}}}),
  request:async(method,path)=>{apiCount++;assert.equal(method,'GET');
   assert.equal(path,'/api/v1/accounts/196799/conversations/8/messages');
   return{payload:[
    {id:20,message_type:0,content:'Hallo',created_at:1794492000,private:false,source_id:'mid-123',
     attachments:[{id:101,file_name:'photo.jpg',file_type:'image',data_url:'https://app.chatwoot.com/rails/active_storage/a.jpg'}]},
    {id:19,message_type:1,content:'Guten Morgen',created_at:1794491990,source_id:'mid-122'},
   ]};
  }};
 const read=createCloudConversationExport({getAuthority:async()=>({cloud}),
  resolveCloudSelection:async()=>{resolveCount++;return verified}});
 return{read,getReads:()=>apiCount,getVerifies:()=>resolveCount};
}
test('verified current Cloud contact exports only whitelisted native fields',async()=>{
 const f=fixture(),out=await f.read({accountId:196799,conversationId:8});
 assert.equal(out.ok,true);assert.equal(out.name,'Vitali');assert.equal(out.rows.length,2);
 assert.equal(out.rows[0].source_id,'mid-123');
 assert.equal(out.rows[0].attachments[0].url,'https://app.chatwoot.com/rails/active_storage/a.jpg');
 assert.equal(out.rows[1].message_type,1);assert.equal(f.getReads(),1);assert.equal(f.getVerifies(),1);
});
test('cross Cloud account is rejected before reading messages',async()=>{
 const f=fixture({crossAccount:true});
 await assert.rejects(f.read({accountId:196799,conversationId:8}),/CONVERSATION_CHANGED/);
 assert.equal(f.getReads(),0);
});
test('switched contact is rejected before reading messages',async()=>{
 const f=fixture({wrongContact:true});
 await assert.rejects(f.read({accountId:196799,conversationId:8}),/CONTACT_CHANGED/);
 assert.equal(f.getReads(),0);
});
test('cannot use forged account or invalid cursor',async()=>{
 const f=fixture();
 for(const args of [{accountId:2,conversationId:8},{accountId:196799,conversationId:8,before:-1}]){
  await assert.rejects(f.read(args),/PARAMETERS_INVALID/);
 }
 assert.equal(f.getReads(),0);
});
