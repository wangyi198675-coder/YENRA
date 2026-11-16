import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {retryableManualModify} from '../desktop-integration-candidate/src/client/manual-modify-recovery.ts'

const seed='Ich freue mich, von dir zu hören'
const failed={sessionId:'session-a',contactKey:'YENRA:P:verified-a',
 sourceKey:'cloud:120:300',seed}
const scope={sessionId:'session-a',contactKey:'YENRA:P:verified-a',
 sourceKey:'cloud:120:300'}

test('explicit human retry keeps exact original-language edit',()=>{
 assert.equal(retryableManualModify(failed,scope,false),seed)
})
test('never auto-retry while a native model turn is running',()=>{
 assert.equal(retryableManualModify(failed,scope,true),null)
})
test('rejects cross-contact, wrong Session, or changed MID',()=>{
 for(const changed of [{sessionId:'session-b'},{contactKey:'YENRA:P:verified-b'},
  {sourceKey:'cloud:120:301'},{sourceKey:undefined}]){
  assert.equal(retryableManualModify(failed,{...scope,...changed},false),null)
 }
})
test('does not accept Chinese input, empty input or oversized text',()=>{
 for(const bad of ['','  ','请帮我修改','x'.repeat(2001)]){
  assert.equal(retryableManualModify({...failed,seed:bad},scope,false),null)
 }
})
test('never recovers an absent failure or unknown identity',()=>{
 assert.equal(retryableManualModify(null,scope,false),null)
 assert.equal(retryableManualModify(failed,{...scope,contactKey:undefined},false),null)
})
test('real native UI only offers owner-click retry after an ended Modify turn',()=>{
 const ui=readFileSync(new URL('../desktop-integration-candidate/src/client/ui.tsx',import.meta.url),'utf8')
 assert.match(ui,/onNativeUpdate=\(\)=>/)
 assert.match(ui,/nativeReplyRequestOutcome\(events,requestId,targetTurn\)/)
 assert.match(ui,/else if\(mode==='modify'&&brainKey&&latestManualSourceKey\)/)
 assert.match(ui,/data-yenra-explicit-modify-retry/)
 assert.match(ui,/onClick=\{\(\)=>\{void generateReplies\('modify',retryFailedModifySeed\)\}\}/)
 assert.match(ui,/setFailedModify\(null\)/)
 assert.doesNotMatch(ui,/setTimeout\(\(\)=>generateReplies\('modify'/)
})
