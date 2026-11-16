import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createYenraCloudNoticeFeed,verifiedMessagePreview} from './cloud-notice-feed.mjs';

test('read-only notice feed: exact owner token, verified Cloud contact, no raw message',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'yenra-notice-'));
 const clock=Date.now();
 const cloud={getConversation:async()=>({id:6,account_id:196799,inbox_id:155865,meta:{sender:{id:18,name:'Fabio',thumbnail:'https://app.chatwoot.com/storage/verified.png'}}})};
 const logger={warn:()=>{}};
 const feed=createYenraCloudNoticeFeed({cloud,logger,localAppData:dir,now:()=>clock});
 const server=createServer((req,res)=>feed.subscribe(req,res));
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
 const url='http://127.0.0.1:'+server.address().port;
 const token=readFileSync(feed.tokenPath,'utf8');
 try{
  const denied=await fetch(url);assert.equal(denied.status,403);
  const c=new AbortController();
  const response=await fetch(url,{headers:{'x-yenra-notice-token':token},signal:c.signal});
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  await reader.read(); // SSE comment header
  const msg={cloudInboxId:155865,cloudConversationId:6,cloudContactId:18,cloudMessageId:4901,occurredAtMs:clock};
  assert.equal(await feed.publish(msg),true);
  assert.equal(await feed.publish(msg),false);
  await assert.rejects(()=>feed.publish({...msg,cloudMessageId:4902,cloudContactId:20}),/CLOUD_NOTICE_CONVERSATION_SCOPE_CHANGED/);
  assert.equal(await feed.publish({...msg,cloudMessageId:4903,occurredAtMs:clock-3600000}),false);
  const frame=new TextDecoder().decode((await reader.read()).value);
  assert.match(frame,/"contactName":"Fabio"/);
  assert.match(frame,/"conversationId":6/);
  assert.doesNotMatch(frame,/rawMessage|PSID|senderPassword|private/);
  assert.equal(feed.stats.published,1);
  c.abort();
 }finally{server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true})}
});

test('replays a verified Cloud notification once after a brief Desktop reconnect',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'yenra-replay-'));
 let clock=Date.now();
 const feed=createYenraCloudNoticeFeed({localAppData:dir,now:()=>clock,
   cloud:{getConversation:async()=>({id:6,account_id:196799,inbox_id:155865,
     meta:{sender:{id:18,name:'Test contact'}}})},logger:{warn:()=>{}}});
 const server=createServer((req,res)=>feed.subscribe(req,res));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const token=readFileSync(feed.tokenPath,'utf8');
 const message={cloudInboxId:155865,cloudConversationId:6,cloudContactId:18,
   cloudMessageId:4905,occurredAtMs:clock};
 const controller=new AbortController();
 try{
   assert.equal(await feed.publish(message),true);
   assert.equal(feed.stats.queued,1);
   assert.equal(feed.stats.delivered,0);
   const response=await fetch('http://127.0.0.1:'+server.address().port,{
     headers:{'x-yenra-notice-token':token},signal:controller.signal});
   assert.equal(response.status,200);
   const reader=response.body.getReader();
   let frame='';
   for(let i=0;i<3&&!frame.includes('"messageId":4905');i++){
     const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>
       setTimeout(()=>reject(Error('REPLAY_NOT_DELIVERED')),1500))]);
     frame+=new TextDecoder().decode(chunk.value);
   }
   assert.match(frame,/"messageId":4905/);
   assert.equal(feed.stats.queued,0);
   assert.equal(feed.stats.replayed,1);
   assert.equal(feed.stats.delivered,1);
   assert.equal(await feed.publish(message),false); // same verified MID cannot repeat
 }finally{controller.abort();server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true})}
});

test('expires disconnected notice frames without replaying stale content',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'yenra-replay-expire-'));
 let clock=Date.now();
 const feed=createYenraCloudNoticeFeed({localAppData:dir,now:()=>clock,
   cloud:{getConversation:async()=>({id:6,account_id:196799,inbox_id:155865,
     meta:{sender:{id:18,name:'Test contact'}}})},logger:{warn:()=>{}}});
 const server=createServer((req,res)=>feed.subscribe(req,res));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const token=readFileSync(feed.tokenPath,'utf8');
 const ctl=new AbortController();
 try{
   assert.equal(await feed.publish({cloudInboxId:155865,cloudConversationId:6,
     cloudContactId:18,cloudMessageId:4906,occurredAtMs:clock}),true);
   clock+=45_100;
   const response=await fetch('http://127.0.0.1:'+server.address().port,
     {headers:{'x-yenra-notice-token':token},signal:ctl.signal});
   assert.equal(response.status,200);
   assert.equal(feed.stats.queued,0);
   assert.equal(feed.stats.replayed,0);
 }finally{ctl.abort();server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true})}
});

test('verified Cloud notification shows bounded real content, preserving emoji and removing control spoofing',()=>{
 const text='Hast du ein aktuelles Foto? 😊';
 assert.equal(verifiedMessagePreview(text,null),text);
 assert.equal(verifiedMessagePreview('  Hello\n\r  world  ',null),'Hello world');
 assert.equal(verifiedMessagePreview('test\u202eEvil',null),'test Evil');
 const long='😊'.repeat(200);
 assert.equal(verifiedMessagePreview(long,null),'😊'.repeat(160)+'…');
 assert.equal(verifiedMessagePreview('', 'image/jpeg'),'收到图片');
 assert.equal(verifiedMessagePreview('', 'audio/ogg'),'收到语音消息');
 assert.equal(verifiedMessagePreview('', 'video/mp4'),'收到视频');
 assert.equal(verifiedMessagePreview('', 'application/pdf'),'收到文件');
 assert.equal(verifiedMessagePreview('', 'sticker'),'收到贴纸');
 assert.equal(verifiedMessagePreview('', null),'收到一条新消息');
});

test('scoped Cloud SSE contains only verified text preview for the correct message',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'yenra-preview-'));
 const clock=Date.now(),cloud={getConversation:async()=>({
   id:23,account_id:196799,inbox_id:155900,meta:{sender:{id:29,name:'Oli Oli'}}})};
 const feed=createYenraCloudNoticeFeed({cloud,logger:{warn:()=>{}},localAppData:dir,now:()=>clock});
 const server=createServer((req,res)=>feed.subscribe(req,res));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const abort=new AbortController();
 try{
  const res=await fetch('http://127.0.0.1:'+server.address().port,{signal:abort.signal,
    headers:{'x-yenra-notice-token':readFileSync(feed.tokenPath,'utf8')}});
  const reader=res.body.getReader();
  assert.equal(await feed.publish({cloudConversationId:23,cloudInboxId:155900,
    cloudContactId:29,cloudMessageId:7812,occurredAtMs:clock,
    messageText:'Hast du ein aktuelles Foto? 😊'}),true);
  let frame='';
  for(let i=0;i<3&&!frame.includes('"messageId":7812');i++){
    const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>
      setTimeout(()=>reject(Error('PREVIEW_FRAME_TIMEOUT')),1400))]);
    frame+=new TextDecoder().decode(chunk.value);
  }
  assert.match(frame,/"messagePreview":"Hast du ein aktuelles Foto\? 😊"/);
  assert.doesNotMatch(frame,/rawMessage|senderPassword|PSID/);
  await assert.rejects(()=>feed.publish({cloudConversationId:23,cloudInboxId:155900,
    cloudContactId:30,cloudMessageId:7813,occurredAtMs:clock,messageText:'wrong'}),
    /CLOUD_NOTICE_CONVERSATION_SCOPE_CHANGED/);
  assert.equal(feed.stats.published,1);
 }finally{abort.abort();server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true})}
});

test('when Cloud conversation omits the thumbnail, use the same verified contact avatar',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'yenra-notice-avatar-'));
 const clock=Date.now();let requested=0;
 const cloud={
   getConversation:async()=>({id:36,account_id:196799,inbox_id:155865,
     meta:{sender:{id:77,name:'Test contact',thumbnail:''}}}),
   getContactById:async id=>{requested++;return {id,thumbnail:'https://app.chatwoot.com/storage/verified-contact.jpg'}}
 };
 const feed=createYenraCloudNoticeFeed({cloud,logger:{warn:()=>{}},localAppData:dir,now:()=>clock});
 const server=createServer((req,res)=>feed.subscribe(req,res));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const ctl=new AbortController();
 try{
  const res=await fetch('http://127.0.0.1:'+server.address().port,{
    headers:{'x-yenra-notice-token':readFileSync(feed.tokenPath,'utf8')},signal:ctl.signal});
  const reader=res.body.getReader();
  assert.equal(await feed.publish({cloudConversationId:36,cloudInboxId:155865,
    cloudContactId:77,cloudMessageId:7900,occurredAtMs:clock,
    messageText:'Test notification preview'}),true);
  let frame='';
  for(let i=0;i<3&&!frame.includes('"messageId":7900');i++){
    const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>
      setTimeout(()=>reject(Error('AVATAR_FRAME_TIMEOUT')),1400))]);
    frame+=new TextDecoder().decode(chunk.value);
  }
  const line=frame.split('\n').find(x=>x.startsWith('data: '));
  const event=JSON.parse(line.slice(6));
  assert.equal(event.avatarUrl,'https://app.chatwoot.com/storage/verified-contact.jpg');
  assert.equal(event.messagePreview,'Test notification preview');
  assert.equal(requested,1);
 }finally{ctl.abort();server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true})}
});
