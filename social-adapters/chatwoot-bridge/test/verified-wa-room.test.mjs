import test from 'node:test';
import assert from 'node:assert/strict';
import {readVerifiedWhatsAppRoom} from '../src/verified-wa-room.mjs';
import {createBridgeServer} from '../src/server.mjs';
import {silentLogger} from '../src/logger.mjs';
import {createRequestShim,createResponseShim,REF_A,REF_B} from './fixtures/synthetic.mjs';
function setup(){
  const calls=[];
  const index={byAccountRef:new Map([[REF_A,{channel:'WhatsApp',inboxId:4,rooms:[REF_B]}]]),
    byIdentifier:new Map([['synthetic',{channel:'WhatsApp',accountRef:REF_A,roomRef:REF_B,inboxId:4}]])};
  const host={async readRoom(scope){calls.push(scope);return {
    schema:1,source:'DSH_IM_EXISTING_INBOX',channel:'WhatsApp',accountRef:REF_A,roomRef:REF_B,
    readOnly:true,canSend:false,name:'Synthetic',nameKnown:true,updatedAt:null,
    messages:[{mid:'synthetic-mid',direction:'INBOUND',text:'synthetic history',timestamp:1700000000,
      credential:'NEVER_COPY'},{mid:'invalid',direction:'OTHER',text:'drop',timestamp:0}],
    credential:'NEVER_COPY',
  }}};
  return {index,host,calls};
}
test('verified WhatsApp room uses the ONE original Host and removes provider private fields',async()=>{
 const {index,host,calls}=setup();
 const result=await readVerifiedWhatsAppRoom({index,host,accountRef:REF_A,roomRef:REF_B});
 assert.equal(result.ok,true);
 assert.equal(calls.length,1);assert.equal(calls[0].channel,'WhatsApp');
 assert.ok(result.text.startsWith('YENRA_SOCIAL_V1:'));
 const data=JSON.parse(result.text.slice('YENRA_SOCIAL_V1:'.length));
 assert.equal(data.readOnly,true);assert.equal(data.canSend,false);
 assert.deepEqual(data.messages.map(x=>x.mid),['synthetic-mid']);
 assert.equal(JSON.stringify(data).includes('NEVER_COPY'),false);
});
test('invalid, cross account, non-mapped and mismatched Host scope refuse without leaking',async()=>{
 const {index,host,calls}=setup();
 for(const [a,r]of [['fake',REF_B],[REF_A,'c'.repeat(32)],['d'.repeat(32),REF_B]]){
  assert.equal((await readVerifiedWhatsAppRoom({index,host,accountRef:a,roomRef:r})).ok,false);
 }
 assert.equal(calls.length,0);
 index.byAccountRef.get(REF_A).channel='Page';
 assert.equal((await readVerifiedWhatsAppRoom({index,host,accountRef:REF_A,roomRef:REF_B})).ok,false);
 assert.equal(calls.length,0);
});
test('Bridge only allows verified original WhatsApp historical read from isolated DSH loopback',async()=>{
 const {index,host,calls}=setup();
 const readVerifiedWhatsAppRoomBound=x=>readVerifiedWhatsAppRoom({...x,index,host});
 const {handleRequest}=createBridgeServer({outbound:{handle:async()=>({status:202,body:{ok:true}})},
   logger:silentLogger,readVerifiedWhatsAppRoom:readVerifiedWhatsAppRoomBound});
 const url='/verified-wa-room?'+new URLSearchParams({accountRef:REF_A,roomRef:REF_B});
 let request=createRequestShim({url,headers:{origin:'http://127.0.0.1:60480'}});
 let response=createResponseShim();
 await handleRequest(request,response);
 assert.equal(response.state.status,200);
 assert.equal(response.json().ok,true);
 assert.equal(Number.isSafeInteger(response.json().hostReadMs),true);
 assert.match(response.state.headers['server-timing'],/^host;dur=[0-9]+,bridge;dur=[0-9]+$/);
 assert.equal(response.state.headers['access-control-allow-origin'],'http://127.0.0.1:60480');
 assert.equal(calls.length,1);
 for(const opts of [
  {headers:{origin:'http://evil.example'}},
  {headers:{origin:'http://127.0.0.1:60474'}},
  {headers:{origin:'http://127.0.0.1:60480'},remoteAddress:'172.18.0.2'},
 ]){
  request=createRequestShim({url,...opts});response=createResponseShim();
  await handleRequest(request,response);
  assert.equal(response.state.status,403);
 }
 request=createRequestShim({method:'POST',url,headers:{origin:'http://127.0.0.1:60480'}});
 response=createResponseShim();await handleRequest(request,response);
 assert.equal(response.state.status,405);
 assert.equal(calls.length,1);
});
