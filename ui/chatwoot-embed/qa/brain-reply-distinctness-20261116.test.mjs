import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {diagnoseAdviceChoices,suggestionPrompt,suggestionsFromText} from '../desktop-integration-candidate/src/client/advice-bridge.ts'

test('real advice UI detects repeats differing only by punctuation, spaces or case',()=>{
 const diagnostics=diagnoseAdviceChoices([
  {text:'Guten Morgen, ich habe heute viel zu tun!'},
  {text:'guten morgen ich habe heute viel zu tun.'},
  {text:'Ich bin heute unterwegs, wir reden später'},
 ])
 assert.deepEqual(diagnostics,[
  {duplicateOf:null,multipleQuestions:false},
  {duplicateOf:0,multipleQuestions:false},
  {duplicateOf:null,multipleQuestions:false},
 ])
})
test('no duplicate false-positive on truly different German responses',()=>{
 const choices=diagnoseAdviceChoices([
  {text:'Ich bin gerade im Atelier'},
  {text:'Ich freue mich auf den freien Abend'},
  {text:'Wie war dein Tag?'},
 ])
 assert.equal(choices.every(row=>row.duplicateOf===null),true)
})
test('one reply with serial interrogation is surfaced but text stays unchanged',()=>{
 const original='Wie geht es dir? Was machst du?'
 const result=diagnoseAdviceChoices([{text:original}])
 assert.equal(result[0]?.multipleQuestions,true)
 assert.equal(original,'Wie geht es dir? Was machst du?')
})
test('native bilingual suggestions remain byte-for-byte model text',()=>{
 const source='1. 温柔自然：Hallo — heute habe ich viel zu tun | 中文：你好，我今天很忙\n2. 简洁自信：Wir reden später | 中文：我们晚点聊\n3. 俏皮轻松：Ich bin noch im Atelier | 中文：我还在工作室'
 const rows=suggestionsFromText(source)
 assert.equal(rows?.length,3)
 assert.equal(rows?.[0]?.text,'Hallo — heute habe ich viel zu tun')
 assert.equal(diagnoseAdviceChoices(rows??[]).every(row=>row.duplicateOf===null),true)
})
test('single model request preserves source, latest inbound and verified persona priority',()=>{
 const prompt=suggestionPrompt({
  name:'Synthetic',label:'Page',intro:'对方：Ich habe es dir schon gesagt',
  translation:'我已经告诉过你了',latestIncoming:'Guten Morgen',
 })
 assert.match(prompt,/对方最新来信：Guten Morgen/)
 assert.match(prompt,/不重复询问已知事实/)
 assert.match(prompt,/原生联系人记忆/)
 assert.match(prompt,/Page 初识不要突然亲密/)
 assert.match(prompt,/三个不同的交流意图/)
 assert.match(prompt,/每条最多一个自然问题/)
})
test('both original Brain history and live cards guard duplicate adoption without blocking Modify/Regenerate',()=>{
 const src=readFileSync(new URL('../desktop-integration-candidate/src/client/native-reply-cards.tsx',import.meta.url),'utf8')
 assert.match(src,/diagnoseAdviceChoices\(replies\?\?\[\]\)/)
 assert.match(src,/disabled=\{choiceIssues\[i\]\?\.duplicateOf!==null&&choiceIssues\[i\]\?\.duplicateOf!==undefined\}/)
 assert.equal((src.match(/disabled=\{choiceIssues\[i\]\?\.duplicateOf!==null&&choiceIssues\[i\]\?\.duplicateOf!==undefined\}/g)??[]).length,2)
 assert.equal((src.match(/onClick=\{\(\)=>modify\(option\.text\)\}/g)??[]).length,2)
 assert.equal((src.match(/onClick=\{regenerate\}/g)??[]).length>=2,true)
})
