import test from 'node:test';
import assert from 'node:assert/strict';
import {readMediaResponse,postNativeAttachment,MEDIA_TYPES,MEDIA_LIMIT_BYTES} from '../src/media-transfer.mjs';
const a='f'.repeat(32);
const formats=[
 {kind:'image',mime:'image/gif',extension:'gif',bytes:Buffer.from('GIF89a0000','ascii')},
 {kind:'image',mime:'image/webp',extension:'webp',bytes:Buffer.from('RIFF0000WEBP','ascii')},
 {kind:'video',mime:'video/mp4',extension:'mp4',bytes:Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109])},
 {kind:'video',mime:'video/webm',extension:'webm',bytes:Buffer.from([0x1a,0x45,0xdf,0xa3,0x93,0x42])},
 {kind:'image',mime:'image/png',extension:'png',bytes:Buffer.from([137,80,78,71,13,10,26,10])},
 {kind:'image',mime:'image/jpeg',extension:'jpg',bytes:Buffer.from([255,216,255,224])}
];
for(const x of formats){
 test('original Host -> Chatwoot native attachment preserves '+x.mime+' as same platform MID',async()=>{
  assert.equal(MEDIA_TYPES.has(x.kind),true);
  const result=await readMediaResponse(new Response(x.bytes,{headers:{'content-type':x.mime}}));
  assert.equal(result.mime,x.mime);
  let intercepted=null;
  const client={baseUrl:'http://127.0.0.1:31907',apiBase:'/api/v1/accounts/1',
    token:'test-only',timeoutMs:100,
    fetchImpl:async(_url,init)=>{
     intercepted=init.body;
     return Response.json({id:88,source_id:'$test-owner-original-mid',
       attachments:[{id:89,file_type:x.kind}]});
    }};
  const message={message_type:'incoming',source_id:'$test-owner-original-mid',
    content:'',content_attributes:{external_created_at:1794444000}};
  await postNativeAttachment(client,7,message,result);
  assert.equal(intercepted.get('source_id'),message.source_id);
  assert.equal(intercepted.get('content'),'');
  const blob=intercepted.get('attachments[]');
  assert.equal(blob.type,x.mime);
  assert.equal(blob.name,'attachment.'+x.extension);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),x.bytes);
 });
}
test('never use a text-only duplicate message as media success',async()=>{
 const client={baseUrl:'http://127.0.0.1:31907',apiBase:'/api/v1/accounts/1',token:'test-only',
 fetchImpl:async()=>Response.json({id:88,source_id:'$test-owner-original-mid',attachments:[]})};
 await assert.rejects(postNativeAttachment(client,7,{message_type:'incoming',source_id:'$test-owner-original-mid',content:'',content_attributes:{}},
 {mime:'image/gif',bytes:Buffer.from('GIF89a')}),{code:'CHATWOOT_MEDIA_EXISTING_TEXT_ONLY_MID'});
});
test('reject video beyond original Host size limit without fetching complete body',async()=>{
 assert.equal(MEDIA_LIMIT_BYTES,20*1024*1024);
 await assert.rejects(readMediaResponse(new Response('x',{headers:{
  'content-type':'video/mp4','content-length':String(MEDIA_LIMIT_BYTES+1)}})),
 {code:'HOST_MEDIA_TOO_LARGE'});
});
