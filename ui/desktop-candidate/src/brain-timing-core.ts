/** Bounded, volatile diagnostics. Never retain prompts, messages, contact refs,
 * model output, credentials or error strings. Host and Client clocks stay separate.
 */
export type BrainTimingStage=
  |'advice-ready'|'session-ready'|'persona-ready'|'history-ready'|'prompt-submit'|'prompt-accepted'|'advice-duplicate'|'advice-error'|'advice-cancelled'
  |'inbox-inserted'|'inbox-claimed'|'request-config-start'|'request-config-ready'
  |'assistant-stream-start'|'first-text-chunk'|'assistant-stream-end'|'token-usage'|'agent-error'
  |'first-render'|'replies-complete'|'grammar-start'|'grammar-complete'|'grammar-unavailable'|'grammar-cache-hit'|'grammar-timeout'
export type BrainTimingCounters={turn?:number;step?:number;count?:number;durationMs?:number;pages?:number;route?:number;inputTokens?:number;outputTokens?:number;reasoningTokens?:number}
export type BrainTimingRecord={seq:number;session:number;stage:BrainTimingStage;atMs:number;counters:BrainTimingCounters}
const stages=new Set<BrainTimingStage>(['advice-ready','session-ready','persona-ready','history-ready','prompt-submit','prompt-accepted','advice-duplicate','advice-error','advice-cancelled','inbox-inserted','inbox-claimed','request-config-start','request-config-ready','assistant-stream-start','first-text-chunk','assistant-stream-end','token-usage','agent-error','first-render','replies-complete','grammar-start','grammar-complete','grammar-unavailable','grammar-cache-hit','grammar-timeout'])
const counterKeys=['turn','step','count','durationMs','pages','route','inputTokens','outputTokens','reasoningTokens'] as const
export function createBrainTimingRecorder(clock:()=>number=()=>performance.now(),limit=512){
  if(!Number.isSafeInteger(limit)||limit<1||limit>4096)throw Error('Invalid diagnostic bound')
  const sessions=new Map<string,number>()
  const records:BrainTimingRecord[]=[]
  let nextSession=0,seq=0
  const started=clock()
  return {
    emit(sessionId:string,stage:BrainTimingStage,counters:BrainTimingCounters={}):void {
      // Diagnostics must never block generation, even on malformed input.
      try{
        if(typeof sessionId!=='string'||!sessionId.startsWith('session-')||!stages.has(stage))return
        let session=sessions.get(sessionId)
        if(session===undefined){
          session=++nextSession;sessions.set(sessionId,session)
          if(sessions.size>limit)sessions.delete(sessions.keys().next().value!)
        }
        const safe:BrainTimingCounters={}
        for(const key of counterKeys){
          const value=counters[key]
          if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12)safe[key]=value
        }
        const atMs=clock()-started
        if(!Number.isFinite(atMs)||atMs<0)return
        records.push({seq:++seq,session,stage,atMs,counters:safe})
        if(records.length>limit)records.shift()
      }catch{/* best-effort diagnostics cannot change task results */}
    },
    snapshot():BrainTimingRecord[]{return records.map(record=>({...record,counters:{...record.counters}}))},
    clear():void {records.length=0;sessions.clear()},
  }
}
