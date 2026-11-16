/** Ephemeral grammar state only; never persisted or logged. No model or sender APIs. */
export type GrammarReview = { phase:'checking'|'complete'|'unavailable'|'unreadable'|'timeout'; issues?:number; details?:string }
export type GrammarLanguage = 'de-DE'|'en-US'|'auto'
const normalize=(text:string)=>text.replace(/\s+/gu,' ').trim()

// Require multiple independent lexical clues in EVERY draft. Short, ambiguous,
// mixed-language and non-Latin drafts deliberately stay auto (never English by default).
export function grammarLanguage(drafts:readonly string[]):GrammarLanguage {
 const detect=(text:string):GrammarLanguage=>{
  if(/[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}\s]/u.test(text))return 'auto'
  const words=new Set(text.toLowerCase().match(/[\p{L}]+/gu)??[])
  const count=(cues:string[])=>cues.filter(word=>words.has(word)).length
  const de=count(['ich','nicht','auch','aber','dich','mich','heute','morgen','freue','habe','bist','dein','kannst','schön'])
  const en=count(['the','you','your','are','have','would','with','that','this','sounds','looking','tonight','what','how'])
  return de>=3&&en===0?'de-DE':en>=3&&de===0?'en-US':'auto'
 }
 const langs=drafts.map(detect)
 return langs.length&&langs.every(lang=>lang===langs[0])?langs[0]!:'auto'
}

// Conservative coverage: extra commentary, labels or older drafts do not certify
// the final answer. Whitespace-only formatting changes are harmless.
export function coversFinalDrafts(inspected:unknown,drafts:readonly string[]):boolean {
 return typeof inspected==='string'&&drafts.length>0&&normalize(inspected)===normalize(drafts.join('\n\n'))
}
export function parseGrammarReport(content:unknown):GrammarReview {
 if(!Array.isArray(content))return {phase:'unreadable'}
 const details=content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n')
 const review={details:details.slice(0,1600)}
 if(!details||/Ergebnisse gekürzt|result exceeded the display cap/iu.test(details))return {phase:'unreadable',...review}
 // Parse only summary lines, not quoted source text inside individual findings.
 const clean=details.split('\n').some(line=>/^\s*(?:[#*>✅✓\s])*Keine Probleme gefunden[.!\s]*$/iu.test(line))
 const counts=details.split('\n').flatMap(line=>{
  const count=/^\s*(?:[#*>📋🔎🔍📝⚠️\s])*(?:(?:LanguageTool|Ergebnis(?:se)?|Prüfergebnis)\s*[:–—-]\s*)?(\d+)\s+(?:Hinweise|Hinweis|issues?|suggestions?)\b/iu.exec(line)
  return count?[Number(count[1])]:[]
 })
 if(clean&&counts.some(count=>count>0))return {phase:'unreadable',...review}
 if(clean)return {phase:'complete',issues:0,...review}
 if(counts.length===1&&Number.isSafeInteger(counts[0]))return {phase:'complete',issues:counts[0],...review}
 return {phase:'unreadable',...review}
}
export function parsePanelReview(json:any):GrammarReview {
 const value=json?.result?.value
 if(json?.result?.ok!==true||!value||value.isError!==false||typeof value.resultJson!=='string')return {phase:'unavailable'}
 if(value.truncated!==false)return {phase:'unreadable'}
 try{
  const payload=JSON.parse(value.resultJson)
  if(payload?.error||payload?.value?.isError===true)return {phase:'unavailable'}
  return parseGrammarReport(payload.content)
 }catch{return {phase:'unreadable'}}
}
export function reviewLabel(review:GrammarReview|null):string {
 if(!review)return ''
 if(review.phase==='checking')return ' · 语法校对中'
 if(review.phase==='unavailable')return ' · 语法校对暂不可用'
 if(review.phase==='timeout')return ' · 语法校对超时'
 if(review.phase==='unreadable')return ' · 校对结果请查看（未确认完成）'
 return review.issues&&review.issues>0?' · 语法校对提示 '+review.issues+' 处':' · 语言校对已完成'
}

export function reviewIdentity(sessionId:string,turn:number,drafts:readonly string[],language:GrammarLanguage):string {
 // Exact, collision-free, content-aware identity; process memory only, bounded below.
 return JSON.stringify([sessionId,turn,language,drafts])
}
/** The latest, visible, finalized reply stays eligible after two minutes.
 * Its content is unchanged; local MCP checking is async and scoped to one Session.
 * Historical, hidden or unfinished replies must never start new checks.
 */
export function shouldProofreadCurrentAdvice(
 draftCount:number,latestTurn:boolean,active:boolean,finishedAt:number|undefined|null
):boolean {
 return Number.isSafeInteger(draftCount)&&draftCount>0&&latestTurn&&active&&
  typeof finishedAt==='number'&&Number.isFinite(finishedAt)&&finishedAt>0
}
export type NativeGrammarState='none'|'pending'|'failed'|'report'
/** A deadline is not evidence of failure: never duplicate a pending native call. */
export function grammarPlan(state:NativeGrammarState,deadlineExpired=false):'fallback'|'wait'|'timeout'|'native' {
 if(state==='pending')return deadlineExpired?'timeout':'wait'
 return state==='report'?'native':'fallback'
}
/** Numeric telemetry de-duplication only; contains no draft/report text. */
export function createTurnTimingGuard(max=256) {
 const seen=new Set<string>()
 return (sessionId:string,turn:number,stage:'first-render'|'replies-complete')=>{
  const key=JSON.stringify([sessionId,turn,stage])
  if(seen.has(key))return false
  seen.add(key)
  while(seen.size>max)seen.delete(seen.values().next().value!)
  return true
 }
}
type Entry={promise:Promise<GrammarReview>;controller:AbortController;users:number}
export function createReviewStore(options:{timeoutMs?:number;max?:number;now?:()=>number}={}) {
 const timeoutMs=options.timeoutMs??12000,max=options.max??128,now=options.now??Date.now
 const completed=new Map<string,{review:GrammarReview;until:number}>(),inflight=new Map<string,Entry>()
 const remember=(key:string,review:GrammarReview)=>{
  completed.delete(key);completed.set(key,{review,until:now()+(review.phase==='complete'?120000:15000)})
  while(completed.size>max)completed.delete(completed.keys().next().value!)
 }
 return {
  acquire(key:string,run:(signal:AbortSignal)=>Promise<GrammarReview>){
   const cached=completed.get(key)
   if(cached&&cached.until>now())return {promise:Promise.resolve(cached.review),cached:true,release(){}}
   completed.delete(key)
   let entry=inflight.get(key)
   if(!entry){
    if(inflight.size>=8)return {promise:Promise.resolve<GrammarReview>({phase:'unavailable'}),cached:false,release(){}}
    const controller=new AbortController()
    let timer:ReturnType<typeof setTimeout>
    const deadline=new Promise<GrammarReview>(resolve=>{timer=setTimeout(()=>{resolve({phase:'timeout'});controller.abort()},timeoutMs)})
    // Race even transports that ignore AbortSignal. Late responses cannot overwrite cache.
    const task=Promise.resolve().then(()=>controller.signal.aborted?{phase:'unavailable'} as GrammarReview:run(controller.signal)).catch(():GrammarReview=>({phase:'unavailable'}))
    const cancelled=new Promise<GrammarReview>(resolve=>controller.signal.addEventListener('abort',()=>resolve({phase:'unavailable'}),{once:true}))
    entry={controller,users:0,promise:Promise.race([task,deadline,cancelled]).then(review=>{
     if(!controller.signal.aborted||review.phase==='timeout')remember(key,review)
     return review
    }).finally(()=>{clearTimeout(timer);if(inflight.get(key)===entry)inflight.delete(key)})}
    inflight.set(key,entry)
   }
   entry.users++
   const own=entry
   let released=false
   return {promise:own.promise,cached:false,release(){
    if(released)return;released=true;own.users--
    // StrictMode effect teardown/setup in one commit shares the same request.
    queueMicrotask(()=>{if(own.users===0&&inflight.get(key)===own){inflight.delete(key);own.controller.abort()}})
   }}
  },
 }
}
