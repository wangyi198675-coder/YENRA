import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHostEventRow,parseVerifiedPageHistoryRow,buildHistoricalPageOutgoingMessage} from '../src/contract.mjs';
import {createInboundBridge} from '../src/inbound.mjs';
import {resolveInboxMap} from '../src/inbox-map.mjs';
import {silentLogger} from '../src/logger.mjs';
import {API_INBOXES,ROSTER,buildHostRow,createFakeChatwoot,createFakeHost} from './fixtures/synthetic.mjs';

const PAGE_ACCOUNT='3'.repeat(32), PAGE_ROOM='5'.repeat(32);

test('Page OUTBOUND history is validated but remains prohibited in live SSE',()=>{
 const row=buildHostRow({accountRef:PAGE_ACCOUNT,roomRef:PAGE_ROOM,mid:'$page-old-outgoing',direction:'OUTBOUND'});
 assert.equal(parseHostEventRow(row).reason,'OUTBOUND_IGNORED');
 const checked=parseVerifiedPageHistoryRow(row);
 assert.equal(checked.ok,true);
 assert.equal(checked.row.direction,'OUTBOUND');
 const payload=buildHistoricalPageOutgoingMessage(checked.row);
 assert.equal(payload.message_type,'outgoing');
 assert.equal(payload.private,false);
 assert.equal(payload.content_attributes.yenra_history_import,true);
 assert.equal(payload.source_id,row.mid);
 assert.throws(()=>buildHistoricalPageOutgoingMessage({...checked.row,direction:'INBOUND'}),/HISTORY_OUTBOUND_DIRECTION_INVALID/);
});

test('one Page contact click restores 20 mixed directions, no mass import or Sender',async()=>{
 const messages=Array.from({length:20},(_,i)=>buildHostRow({
  accountRef:PAGE_ACCOUNT,roomRef:PAGE_ROOM,mid:'$mixed-page-history-'+i,
  timestamp:Date.now()-2000000+i*1000,direction:i%5<2?'OUTBOUND':'INBOUND',
 }));
 const host=createFakeHost({onReadRoom:({accountRef,roomRef})=>({accountRef,roomRef,messages})});
 const chatwoot=createFakeChatwoot();
 const outgoing=[];
 chatwoot.createHistoricalOutgoingMessage=async(conversationDisplayId,payload)=>{
  assert.equal(payload.content_attributes.yenra_history_import,true);
  assert.equal(payload.message_type,'outgoing');
  outgoing.push(payload);
  chatwoot.messages.push({conversationDisplayId,payload});
  return {id:800+outgoing.length};
 };
 const resolved=await resolveInboxMap({roster:ROSTER,inboxes:API_INBOXES});
 const inbound=createInboundBridge({host,chatwoot,mapping:resolved.mapping,roster:ROSTER,logger:silentLogger});
 assert.equal(inbound.handleFrame({data:JSON.stringify(messages[0])}).kind,'ignore');
 const before=await inbound.syncRow(messages[0],{forceHistoryImport:true});
 assert.equal(before.code,'OUTBOUND_IGNORED');
 assert.equal(chatwoot.messages.length,0);
 const result=await inbound.openPageRoomOnDemand({accountRef:PAGE_ACCOUNT,roomRef:PAGE_ROOM});
 assert.equal(result.ok,true);
 assert.equal(result.imported,20);
 assert.equal(result.skipped,0);
 assert.equal(host.reads.length,1);
 assert.equal(chatwoot.messages.length,20);
 assert.equal(outgoing.length,8);
 assert.equal(chatwoot.messages.filter(m=>m.payload.message_type==='incoming').length,12);
 assert.ok(chatwoot.messages.every(m=>m.payload.content_attributes.yenra_history_import===true));
 assert.equal(chatwoot.calls.createConversation,1);
});
