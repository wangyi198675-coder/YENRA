// Offline tests only: no fetch, model, MCP execution, actual chat, or runtime restart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coversFinalDrafts, createReviewStore, createTurnTimingGuard, grammarLanguage, grammarPlan, parseGrammarReport, parsePanelReview, reviewIdentity, reviewLabel } from './review.ts'
import { isVisibleBrainScope } from './scope.ts'
const content=text=>[{type:'text',text}]
const clean=content('## ✅ Keine Probleme gefunden\nSprache: German (de-DE)')
const issues=content('## ⚠️ 3 Hinweise\nSprache: English (en-US)\n\n### Grammatik\n1. Correction')
const panel=(blocks,extra={})=>({result:{ok:true,value:{isError:false,truncated:false,resultJson:JSON.stringify({value:{content:blocks},content:blocks}),...extra}}})

test('pending native deadline never authorizes duplicate fallback; only actual failure does',()=>{
 assert.equal(grammarPlan('pending'),'wait')
 assert.equal(grammarPlan('pending',true),'timeout')
 assert.equal(grammarPlan('none'),'fallback')
 assert.equal(grammarPlan('failed'),'fallback')
 assert.equal(grammarPlan('report'),'native')
 assert.equal(grammarPlan('report',true),'native')
 // Render / deadline / re-render all refer to one still-pending native call.
 let fallbackCalls=0
 for(const expired of [false,true,true,false,true])if(grammarPlan('pending',expired)==='fallback')fallbackCalls++
 assert.equal(fallbackCalls,0)
 if(grammarPlan('failed')==='fallback')fallbackCalls++
 assert.equal(fallbackCalls,1)
 assert.equal(parseGrammarReport(content('Unrecognized native output')).phase,'unreadable')
})
test('per-turn first-render and replies-complete timings deduplicate remount and StrictMode',()=>{
 const once=createTurnTimingGuard()
 for(const stage of ['first-render','replies-complete']){
  assert.equal(once('brain-a',1,stage),true)
  assert.equal(once('brain-a',1,stage),false)
  assert.equal(once('brain-b',1,stage),true)
  assert.equal(once('brain-a',2,stage),true)
 }
 const bounded=createTurnTimingGuard(2)
 bounded('a',1,'first-render');bounded('a',2,'first-render');bounded('a',3,'first-render')
 assert.equal(bounded('a',1,'first-render'),true)
})

test('official wrapper headings and native/fallback semantics agree',()=>{
 for(const blocks of [clean,issues])assert.deepEqual(parsePanelReview(panel(blocks)),parseGrammarReport(blocks))
 assert.equal(parseGrammarReport(clean).issues,0)
 assert.equal(parseGrammarReport(issues).issues,3)
 assert.equal(parseGrammarReport(content('## ⚠️ 1 Hinweise')).issues,1)
 assert.equal(reviewLabel(parseGrammarReport(issues)),' · 语法校对提示 3 处')
})
test('never treat native success bit or unknown/incomplete report as clean',()=>{
 for(const blocks of [[],content('Unknown report'),content('## ✅ Keine Probleme gefunden\n(Hinweis: LanguageTool hat die Ergebnisse gekürzt – der Text ist sehr lang)'),content('Quoted phrase: Keine Probleme gefunden'),content('## ✅ Keine Probleme gefunden\n## ⚠️ 2 Hinweise')])assert.equal(parseGrammarReport(blocks).phase,'unreadable')
 assert.equal(parsePanelReview(panel(clean,{truncated:true})).phase,'unreadable')
 assert.equal(parsePanelReview(panel(clean,{isError:true})).phase,'unavailable')
 assert.equal(parsePanelReview(panel(clean,{resultJson:'broken'})).phase,'unreadable')
 assert.equal(parsePanelReview({result:{ok:false}}).phase,'unavailable')
 assert.equal(parsePanelReview(panel(clean,{resultJson:JSON.stringify({value:{isError:true},content:clean})})).phase,'unavailable')
})
test('coverage certifies all and only final drafts, not substring prefixes',()=>{
 const drafts=['Hello there!', 'Are you free tonight?', 'I would love that.']
 assert.equal(coversFinalDrafts(drafts.join('\n\n'),drafts),true)
 assert.equal(coversFinalDrafts(drafts.join('  \n'),drafts),true)
 for(const checked of [null,drafts[0],drafts.join('\n')+' and extra old draft',drafts.join('\n').replace('Hello there!','Hello there! I changed it.')])assert.equal(coversFinalDrafts(checked,drafts),false)
})
test('conservative regional language requires reliable evidence in every draft',()=>{
 assert.equal(grammarLanguage(['Ich freue mich auch heute.','Ich habe dich heute vermisst.']),'de-DE')
 assert.equal(grammarLanguage(['What are you looking for tonight?','Your plans for tonight sounds good with you.']),'en-US')
 for(const drafts of [['Hi!'],['Hallo!'],['Merci beaucoup'],['Hello 你好'],['Ich freue mich heute.','What are you looking for tonight?'],['Ich freue mich heute.','Hey!'],[]])assert.equal(grammarLanguage(drafts),'auto')
})
test('exact cache identity changes for final text, language, session and turn',()=>{
 const base=reviewIdentity('session-a',1,['Hi'],'auto')
 for(const changed of [reviewIdentity('session-b',1,['Hi'],'auto'),reviewIdentity('session-a',2,['Hi'],'auto'),reviewIdentity('session-a',1,['Hi!'],'auto'),reviewIdentity('session-a',1,['Hi'],'en-US')])assert.notEqual(base,changed)
})
test('inflight consumers deduplicate, release independently and preserve cached report details',async()=>{
 const store=createReviewStore()
 let calls=0,finish
 const run=async()=>{calls++;return new Promise(resolve=>{finish=resolve})}
 const first=store.acquire('a',run),second=store.acquire('a',run)
 await Promise.resolve()
 assert.equal(calls,1)
 first.release();await Promise.resolve()
 finish(parseGrammarReport(issues))
 assert.equal((await second.promise).issues,3)
 const hit=store.acquire('a',run)
 assert.equal(hit.cached,true)
 assert.deepEqual(await hit.promise,await second.promise)
 second.release();hit.release()
 assert.equal(calls,1)
})
test('StrictMode teardown and immediate re-acquire shares one inflight request',async()=>{
 const store=createReviewStore()
 let calls=0
 const run=async()=>{calls++;return parseGrammarReport(clean)}
 const first=store.acquire('strict',run);first.release()
 const second=store.acquire('strict',run)
 assert.equal((await second.promise).issues,0)
 assert.equal(calls,1);second.release()
})
test('final consumer cancellation aborts, does not cache and allows fresh request',async()=>{
 const store=createReviewStore()
 let signal
 const first=store.acquire('cancel',async s=>{signal=s;return new Promise(()=>{})})
 await Promise.resolve();first.release();await Promise.resolve()
 assert.equal(signal.aborted,true)
 assert.equal((await first.promise).phase,'unavailable')
 const next=store.acquire('cancel',async()=>parseGrammarReport(clean))
 assert.equal(next.cached,false);assert.equal((await next.promise).issues,0);next.release()
})
test('timeout resolves even when transport ignores abort; late response cannot overwrite',async()=>{
 const store=createReviewStore({timeoutMs:5})
 let signal,finish
 const lease=store.acquire('slow',s=>{signal=s;return new Promise(resolve=>{finish=resolve})})
 assert.equal((await lease.promise).phase,'timeout')
 assert.equal(signal.aborted,true)
 finish(parseGrammarReport(clean));await Promise.resolve();await Promise.resolve()
 const hit=store.acquire('slow',async()=>parseGrammarReport(clean))
 assert.equal(hit.cached,true);assert.equal((await hit.promise).phase,'timeout');lease.release()
})
test('bounded cache eviction and failure cooldown avoid retry storms',async()=>{
 let now=1,calls=0
 const store=createReviewStore({max:2,now:()=>now})
 const run=async()=>{calls++;return {phase:'unavailable'}}
 for(const key of ['a','b','c']){const lease=store.acquire(key,run);await lease.promise;lease.release()}
 const evicted=store.acquire('a',run);assert.equal(evicted.cached,false);await evicted.promise
 const hit=store.acquire('a',run);assert.equal(hit.cached,true);await hit.promise
 now+=15001
 const expired=store.acquire('a',run);assert.equal(expired.cached,false);await expired.promise
 assert.equal(calls,5)
})
test('only visible exact active Chat session passes scope; hidden Work never does',()=>{
 const pane={isConnected:true,dataset:{yenraBrainSession:'brain-a',yenraBrainActive:'true'},closest:()=>null}
 assert.equal(isVisibleBrainScope(pane,'brain-a','visible'),true)
 assert.equal(isVisibleBrainScope(pane,'work-session','visible'),false)
 assert.equal(isVisibleBrainScope(pane,'brain-a','hidden'),false)
 assert.equal(isVisibleBrainScope({...pane,isConnected:false},'brain-a','visible'),false)
 assert.equal(isVisibleBrainScope({...pane,dataset:{...pane.dataset,yenraBrainActive:'false'}},'brain-a','visible'),false)
 assert.equal(isVisibleBrainScope({...pane,closest:()=>({})},'brain-a','visible'),false)
 assert.equal(isVisibleBrainScope(null,'brain-a','visible'),false)
})
