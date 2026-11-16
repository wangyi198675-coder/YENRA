import test from 'node:test';import assert from 'node:assert/strict';
import {createCloudSavedPreviewReader,mapCloudSavedPreview} from './cloud-conversation-preview.mjs';
const msg=(id,content,zh)=>({id,message_type:0,private:false,content,content_attributes:{translations:{zh_CN:zh}}});
const chat=(id,contactId,content,zh,inbox=155865)=>({id,account_id:196799,inbox_id:inbox,meta:{sender:{id:contactId,name:'Confirmed Name'}},last_non_activity_message:msg(id+100,content,zh)});
test('reads only previously saved Cloud zh_CN from same account and known inbox',()=>{
const data={data:{payload:[chat(10,3,'Ciao','你好'),chat(11,4,'Hallo',null),
 {...chat(12,5,'Hello','您好'),account_id:8},chat(13,6,'Hi','你好',100),
 {...chat(14,7,'Bonjour','早上好'),last_non_activity_message:{...msg(114,'Bonjour','早上好'),private:true}}]}};
const m=mapCloudSavedPreview(data,{accountId:196799,page:1});
assert.equal(m.rows.length,1);assert.equal(m.rows[0].conversationId,10);
assert.equal(m.rows[0].original,'Ciao');assert.equal(m.rows[0].translation,'你好');
});
test('request strictly read-only; account and pagination not browser controlled beyond scope',async()=>{
const requests=[];
const read=createCloudSavedPreviewReader({getAuthority:async()=>({cloud:{accountId:196799,apiBase:'/api/v1/accounts/196799',request:async(...args)=>{requests.push(args);return {data:{payload:[chat(20,30,'Ciao','你好',155901)]}}}}})});
const result=await read({accountId:196799,page:1});
assert.equal(result.rows.length,1);assert.equal(requests[0][0],'GET');
assert.equal(requests[0][1],'/api/v1/accounts/196799/conversations?status=all&page=1');
await assert.rejects(read({accountId:22,page:1}),/PREVIEW_SCOPE/);
await assert.rejects(read({accountId:196799,page:0}),/PREVIEW_SCOPE/);
await assert.rejects(read({accountId:196799,page:9}),/PREVIEW_SCOPE/);
});

test('zh_CN must contain real Chinese, never unchanged Latin or a failed translation',()=>{
 const same=chat(31,41,'Ciao','Ciao');
 const latin=chat(32,42,'Bonjour','Hello');
 const valid=chat(33,43,'Wie geht es dir?','你好吗？');
 const alreadyChinese=chat(34,44,'你好','你好');
 const output=mapCloudSavedPreview({data:{payload:[same,latin,valid,alreadyChinese]}});
 assert.equal(output.sourceCount,4);
 assert.equal(output.rows.length,1);
 assert.equal(output.rows[0].conversationId,33);
 assert.equal(output.rows[0].translation,'你好吗？');
});
test('filter malformed scope and private notes, preserve sourceCount for safe pagination',()=>{
 const good=chat(42,43,'Ciao','你好',155902);
 const privateMessage={...chat(40,48,'Ciao','你好'),last_non_activity_message:{...msg(140,'Ciao','你好'),private:true}};
 const wrongInbox=chat(41,49,'Ciao','你好',9999);
 const result=mapCloudSavedPreview({data:{payload:[good,privateMessage,wrongInbox]}},{accountId:196799,page:2});
 assert.equal(result.sourceCount,3);
 assert.equal(result.page,2);
 assert.deepEqual(result.rows.map(x=>x.conversationId),[42]);
});

test('new authenticated Facebook Page previews saved Chinese but unverified API inbox stays excluded',async()=>{
 const records={data:{payload:[
  chat(91,100,'Hello from Page','来自主页的你好',156456),
  chat(92,101,'Wrong inbox','未授权渠道',999999),
  chat(93,102,'Legacy Page','旧页面',155865)
 ]}};
 const cloud={accountId:196799,apiBase:'/api/v1/accounts/196799',
  request:async(method)=>{assert.equal(method,'GET');return records},
  listInboxes:async()=>[
   {id:156456,channelType:'Channel::FacebookPage',name:'Kim'},
   {id:999999,channelType:'Channel::Api',name:'Unknown API'}
  ]};
 const reader=createCloudSavedPreviewReader({getAuthority:async()=>({cloud})});
 const result=await reader({accountId:196799,page:1});
 assert.deepEqual(result.rows.map(x=>x.conversationId),[91,93]);
});

test('latest Cloud message without native zh_CN supplies only a verified cache-only candidate',()=>{
 const saved=chat(91,151,'Good evening','晚上好',155901);
 const cached=chat(92,152,'How have you been?',null,155902);
 const chinese=chat(93,153,'你好',null,155900);
 const privateNote={...chat(94,154,'Secret',null),last_non_activity_message:{...msg(194,'Secret',null),private:true}};
 const data=mapCloudSavedPreview({data:{payload:[saved,cached,chinese,privateNote]}})
 assert.equal(data.sourceCount,4);
 assert.deepEqual(data.rows.map(x=>x.conversationId),[91]);
 assert.deepEqual(data.candidates.map(x=>x.conversationId),[92]);
 assert.equal(data.candidates[0].messageId,192);
 assert.equal(data.candidates[0].original,'How have you been?');
 assert.equal(Object.hasOwn(data.candidates[0],'translation'),false);
});
test('cached preview candidates never cross account, unknown inbox or private note',()=>{
 const wrong={...chat(90,150,'Ciao',null),account_id:100};
 const untrusted=chat(95,156,'Hello',null,765432);
 const media={...chat(96,157,'Photo',null),last_non_activity_message:{...msg(196,'Photo',null),message_type:2}};
 const result=mapCloudSavedPreview({data:{payload:[wrong,untrusted,media]}})
 assert.deepEqual(result.candidates,[]);
 assert.deepEqual(result.rows,[]);
});

test('confirmed friend WhatsApp inbox is eligible, unknown other API inbox remains blocked',()=>{
 const known=chat(101,201,'Guten Abend',null,156555);
 const unknown=chat(102,202,'Bonjour',null,999999);
 const r=mapCloudSavedPreview({data:{payload:[known,unknown]}});
 assert.deepEqual(r.candidates.map(x=>x.conversationId),[101]);
});
