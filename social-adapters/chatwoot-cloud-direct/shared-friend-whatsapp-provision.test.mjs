import test from 'node:test';
import assert from 'node:assert/strict';
import {
  friendInboxName,ensureFriendWhatsAppCloudInbox,defaultCallbackProbe
} from './shared-friend-whatsapp-provision.mjs';
const ref='b17f154a3e6d475bb266a2c1a100a107';
const live={channel:'WhatsApp',authorized:true,online:true,accountRef:ref};
const url='https://friend-example.tailnet.ts.net/yenra-friend-callback-unique';
const endpoint='/api/v1/accounts/196799';
function mock({old=null,agentPresent=false,agentIds=[284212],otherMemberIds=[]}={}){
 const inboxes=[{id:155901,name:'YENRA · WhatsApp 1',channel_type:'Channel::Api'}];
 let next=190001,created=0,assigned=0;
 const memberIds=new Set(agentPresent?agentIds:otherMemberIds);
 const requested=[];
 if(old)inboxes.push(old);
 const cloud={
  accountId:196799,apiBase:endpoint,request:async(method,path,body)=>{
   requested.push({method,path,body});
   if(method==='GET'&&path===endpoint+'/inboxes')return {payload:inboxes.map(({id,name,channel_type})=>({id,name,channel_type}))};
   const found=path.match(/^\/api\/v1\/accounts\/196799\/inboxes\/(\d+)$/);
   if(method==='GET'&&found)return inboxes.find(i=>i.id===Number(found[1]))??null;
   if(method==='POST'&&path===endpoint+'/inboxes'){
     assert.equal(body.channel.type,'api');
     assert.equal(body.channel.webhook_url,url);
     assert.equal(body.channel.hmac_mandatory,true);
     created++;const row={id:next++,name:body.name,channel_type:'Channel::Api',
       channel:{webhook_url:body.channel.webhook_url},secret:'s'.repeat(32),hmac_mandatory:true};
     inboxes.push(row);return row;
   }
   if(method==='GET'&&path===endpoint+'/agents')
     return {payload:agentIds.map(id=>({id,role:'administrator'}))};
   if(method==='GET'&&path===endpoint+'/inbox_members/'+(old?.id??190001))
     return {payload:[...memberIds].map(id=>({id}))};
   if(method==='POST'&&path===endpoint+'/inbox_members'){
     assert.equal(body.inbox_id,old?.id??190001);
     assert.ok(Array.isArray(body.user_ids));
     for(const id of body.user_ids){assert.ok(agentIds.includes(id));memberIds.add(id)}
     assigned++;return {payload:[...memberIds].map(id=>({id}))};
   }
   throw Error('UNEXPECTED_REQUEST:'+method+':'+path);
  }
 };
 return {cloud,requested,counts:()=>({created,assigned})};
}
const run=(cloud,more={})=>ensureFriendWhatsAppCloudInbox({
 cloud,hostAccount:live,callbackUrl:url,verifyPublicCallback:async()=>true,...more
});
test('stable account-scope name never reuses the two owner inboxes',()=>{
 const n=friendInboxName(ref);
 assert.match(n,/^YENRA · WhatsApp · [a-f0-9]{14}$/);
 assert.notEqual(n,friendInboxName('c17f154a3e6d475bb266a2c1a100a107'));
});
test('linked friend WhatsApp provisions exactly one Cloud API inbox and adds existing owner agent',async()=>{
 const m=mock(),result=await run(m.cloud);
 assert.equal(result.created,true);assert.equal(result.phase,'INBOX_CREATED_SENDER_NOT_YET_ACTIVE');
 assert.equal(result.inboxId,190001);
 assert.deepEqual(m.counts(),{created:1,assigned:1});
 assert.equal(m.requested.filter(x=>x.method==='POST'&&x.path.endsWith('/inboxes')).length,1);
});
test('same account is idempotent: no duplicate inbox, no membership overwrite',async()=>{
 const old={id:200002,name:friendInboxName(ref),channel_type:'Channel::Api',
   channel:{webhook_url:url},secret:'s'.repeat(32),hmac_mandatory:true};
 const m=mock({old,agentPresent:true});
 const r=await run(m.cloud);assert.equal(r.inboxId,200002);assert.equal(r.created,false);
 assert.deepEqual(m.counts(),{created:0,assigned:0});
});
test('rejects unlinked account without altering Cloud',async()=>{
 const m=mock();await assert.rejects(run(m.cloud,{hostAccount:{...live,online:false}}),/LOGIN_REQUIRED/);
 assert.equal(m.requested.length,0);
});
test('rejects missing public endpoint before Cloud creation',async()=>{
 const m=mock();await assert.rejects(run(m.cloud,{verifyPublicCallback:async()=>false}),/NOT_READY/);
 assert.equal(m.requested.length,0);
});
test('rejects another account and local callback endpoints',async()=>{
 const m=mock();
 await assert.rejects(run({...m.cloud,accountId:196798}),/AUTHORITY_REQUIRED/);
 await assert.rejects(run(m.cloud,{callbackUrl:'http://localhost:31917/anything'}),/PUBLIC_CALLBACK_REQUIRED/);
 assert.equal(m.requested.length,0);
});
test('does not adopt altered callback or wrong channel',async()=>{
 const mismatch={id:200002,name:friendInboxName(ref),channel_type:'Channel::Api',
   channel:{webhook_url:'https://other.example/funnel'}};
 await assert.rejects(run(mock({old:mismatch}).cloud),/WEBHOOK_MISMATCH/);
 await assert.rejects(run(mock({old:{...mismatch,channel_type:'Channel::FacebookPage',
   channel:{webhook_url:url}}}).cloud),/SCOPE_CONFLICT/);
});
test('callback probe accepts existing Bridge GET 405 and refuses fake 200',async()=>{
 assert.equal(await defaultCallbackProbe(url,{fetchImpl:async()=>({
   status:405,json:async()=>({code:'POST_ONLY'}),
 })}),true);
 assert.equal(await defaultCallbackProbe(url,{fetchImpl:async()=>({
   status:200,json:async()=>({ok:true}),
 })}),false);
});

test('new Cloud Inbox includes every already-authorized account agent without changing roles',async()=>{
 const ids=[284212,300017];
 const m=mock({agentIds:ids,otherMemberIds:[284212]});
 const result=await run(m.cloud);
 assert.equal(result.inboxId,190001);
 const grants=m.requested.filter(x=>x.method==='POST'&&x.path===endpoint+'/inbox_members');
 assert.equal(grants.length,1);
 assert.deepEqual(grants[0].body.user_ids,[300017]);
 assert.equal(m.requested.filter(x=>x.method==='PATCH'||
   (x.path.endsWith('/agents')&&x.method!=='GET')).length,0);
});
test('existing Inbox membership is idempotent for all authorized account agents',async()=>{
 const old={id:200002,name:friendInboxName(ref),channel_type:'Channel::Api',
   channel:{webhook_url:url},secret:'s'.repeat(32),hmac_mandatory:true};
 const m=mock({old,agentPresent:true,agentIds:[284212,300017]});
 await run(m.cloud);
 assert.equal(m.requested.filter(x=>x.method==='POST'&&x.path===endpoint+'/inbox_members').length,0);
 assert.equal(m.counts().created,0);
});
test('Cloud agent list lacking the existing administrator is rejected without membership changes',async()=>{
 const m=mock({agentIds:[300017]});
 await assert.rejects(run(m.cloud),/OWNER_NOT_IN_ACCOUNT/);
 assert.equal(m.requested.filter(x=>x.method==='POST'&&x.path===endpoint+'/inbox_members').length,0);
});
test('Cloud empty agent list is rejected before granting any Inbox permissions',async()=>{
 const m=mock({agentIds:[]});
 await assert.rejects(run(m.cloud),/ACCOUNT_AGENTS_INVALID/);
 assert.equal(m.requested.filter(x=>x.method==='POST'&&x.path===endpoint+'/inbox_members').length,0);
});
