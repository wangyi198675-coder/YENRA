import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudInboundProjection} from './cloud-inbound-projection.mjs';
const accountRef='a'.repeat(32),roomRef='b'.repeat(32),cloudInboxId=155900;
const row={accountRef,roomRef,direction:'INBOUND',mid:'$verified-original-host-message-987654321',
 text:'Guten Morgen',timestamp:Date.now()-3000};
const roster={accounts:[{channel:'Personal',accountRef,rooms:[{roomRef,name:'Verified peer',nameKnown:true}]}]};
const scopes=[{channel:'Personal',accountRef,cloudInboxId}];
function harness({active=true,stored=[]}={}){
 const messages=[...stored],log=[];
 const cloud={apiBase:'/api/v1/accounts/196799',baseUrl:'https://app.chatwoot.com',
  findContactByIdentifier:async()=>null,
  getContactById:async()=>({id:1001,identifier: 'yenra-'+('0'.repeat(40)),contact_inboxes:[]}),
  uploadVerifiedContactAvatar:async()=>{},
  createContact:async()=>({id:1001}),
  listContactConversations:async()=>[],
  createConversation:async()=>({id:2002}),
  request:async()=>({payload:messages}),
  createIncomingMessage:async(id,payload)=>{
    const entry={id:3003,source_id:payload.source_id,message_type:0,content:payload.content};
    messages.push(entry);return entry;
  },
 };
 const host={readRoom:async()=>({accountRef,roomRef,messages:[row]}),
  readVerifiedWhatsAppContactAvatar:async()=>null};
 const service=createCloudInboundProjection({host,cloud,roster,scopes,
  logger:{warn(code,detail){log.push({code,detail})}},
  enabledAccountRefs:active?[accountRef]:[]});
 return {service,messages,log,cloud,host};
}
test('Cloud ingress disabled does not claim original DSH event',()=>{
 const {service}=harness({active:false});
 assert.equal(service.handle(row),false);
 assert.equal(service.stats.posted,0);
});
test('only one Cloud native message after exact Host identity/MID and no CE',async()=>{
 const {service,messages}=harness();
 assert.equal(service.handle(row),true);
 assert.equal(service.handle(row),true);
 await service.drain();
 assert.equal(service.stats.posted,1);
 assert.equal(messages.length,1);
 assert.equal(messages[0].source_id,row.mid);
});
test('existing Cloud MID skips repeat native creation',async()=>{
 const {service,messages}=harness({stored:[{id:12,source_id:row.mid,message_type:0}]});
 service.handle(row);await service.drain();
 assert.equal(service.stats.duplicate,1);
 assert.equal(messages.length,1);
});
test('original Host video metadata repairs missing SSE type; Cloud posts real media bytes, not text-only',async()=>{
 const h=harness(),native={...row,nativeMediaType:'video',hasNativeMedia:true};
 h.host.readRoom=async()=>({accountRef,roomRef,messages:[native]});
 let mediaReads=0,multipart=null,notes=0;
 h.host.readMedia=async()=>{mediaReads++;return{bytes:Buffer.from([0,0,0,24,102,116,121,112]),mime:'video/mp4'}};
 h.cloud.token='test-token';
 h.cloud.fetchImpl=async(_url,init)=>{
  multipart=init.body;
  const message={id:4404,source_id:row.mid,message_type:0,
   content:row.text,attachments:[{id:5505,file_type:'video'}]};
  h.messages.push(message);
  return Response.json(message);
 };
 const service=createCloudInboundProjection({host:h.host,cloud:h.cloud,roster,scopes,
  logger:{warn:()=>{}},enabledAccountRefs:[accountRef],
  onVerifiedIncoming:()=>{notes++}});
 const first=await service.deliver({...row,historyImport:true});
 assert.equal(first.ok,true);assert.equal(service.stats.media,1);
 assert.equal(mediaReads,1);
 assert.equal(multipart.get('attachments[]').type,'video/mp4');
 assert.equal(multipart.get('source_id'),row.mid);
 assert.equal(JSON.parse(multipart.get('content_attributes')).yenra_history_import,true);
 assert.equal(notes,0,'old media must never raise a new unread alert');
 const second=await service.deliver({...row,historyImport:true});
 assert.equal(second.alreadyCloud,true);assert.equal(h.messages.length,1);
 assert.equal(mediaReads,2,'verified Host is authoritative, never the UI');
 assert.equal(notes,0);
});
test('inconsistent SSE media kind cannot override the exact original Host media kind',async()=>{
 const h=harness();
 h.host.readRoom=async()=>({accountRef,roomRef,
  messages:[{...row,nativeMediaType:'video',hasNativeMedia:true}]});
 h.host.readMedia=async()=>{throw Error('MUST_NOT_BE_CALLED')};
 await assert.rejects(h.service.deliver({...row,nativeMediaType:'image'}),
  /CLOUD_SSE_MEDIA_TYPE_CONFLICT_WITH_ORIGINAL/);
 assert.equal(h.messages.length,0);
});
test('original Host media cannot be misreported as an already-delivered text-only Cloud MID',async()=>{
 const h=harness({stored:[{id:901,source_id:row.mid,message_type:0,attachments:[]}]});
 h.host.readRoom=async()=>({accountRef,roomRef,
  messages:[{...row,nativeMediaType:'image',hasNativeMedia:true}]});
 h.host.readMedia=async()=>({bytes:Buffer.from([137,80,78,71,13,10,26,10]),mime:'image/png'});
 await assert.rejects(h.service.deliver({...row,nativeMediaType:'image'}),
  /CLOUD_MEDIA_EXISTING_TEXT_ONLY_MID/);
 assert.equal(h.service.stats.duplicate,0);
 assert.equal(h.messages.length,1,'must not create a second Cloud bubble');
});
test('historical original text backfill carries history flag and never generates a fresh notification',async()=>{
 const h=harness();let notifications=0,payload=null;
 h.cloud.createIncomingMessage=async(_id,msg)=>{
  payload=msg;return{id:101,source_id:msg.source_id,message_type:0}
 };
 const service=createCloudInboundProjection({host:h.host,cloud:h.cloud,roster,scopes,
  logger:{warn:()=>{}},enabledAccountRefs:[accountRef],
  onVerifiedIncoming:()=>notifications++});
 const result=await service.deliver({...row,historyImport:true});
 assert.equal(result.ok,true);
 assert.equal(payload.content_attributes.yenra_history_import,true);
 assert.equal(notifications,0);
});
test('reject cross account Cloud route',()=>{
 assert.throws(()=>createCloudInboundProjection({roster,scopes,host:{},cloud:{},logger:{},
  enabledAccountRefs:['c'.repeat(32)]}),/CUTOVER_NOT_AUTHORIZED/);
});
test('do not record Host MID mismatch as Cloud message',async()=>{
 const {service,host,messages}=harness();
 host.readRoom=async()=>({accountRef,roomRef,messages:[{...row,text:'spoofed'}]});
 service.handle(row);await service.drain();
 assert.equal(service.stats.failed,1);assert.equal(messages.length,0);
});
