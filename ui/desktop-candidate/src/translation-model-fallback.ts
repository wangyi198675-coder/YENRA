/**
 * Thin routing policy around the existing original DSH LLM service.
 * No provider clients, credentials, queues, databases, Agents or Senders.
 */
export type NativeTranslationModelRoute={
  readonly provider:string
  readonly model:string
  readonly label:string
  readonly timeoutMs:number
}
export const NATIVE_TRANSLATION_ROUTES:readonly NativeTranslationModelRoute[]=[
  {provider:'openai-codex',model:'gpt-6-sol',label:'ChatGPT',timeoutMs:28000},
  {provider:'deepseek-official',model:'deepseek-flash',label:'DeepSeek',timeoutMs:26000},
  {provider:'vclaw-ccmax',model:'claude-opus-5-5',label:'V-Claw Claude',timeoutMs:30000},
]
export type NativeTranslationStreamChunk={
  readonly type:string
  readonly text?:string
  readonly reason?:{
    readonly kind:string
    readonly failure?:{readonly code?:string;readonly status?:number}
  }
}
export type NativeTranslationAttemptResult={
  readonly values:Map<string,string>
  readonly route:NativeTranslationModelRoute
}
export async function translateUsingOriginalDshWithFallback(args:{
  readonly registeredProviders:readonly string[]
  readonly signal:AbortSignal
  readonly stream:(route:NativeTranslationModelRoute,signal:AbortSignal)=>AsyncIterable<NativeTranslationStreamChunk>
  readonly validate:(output:string)=>Map<string,string>
}):Promise<NativeTranslationAttemptResult>{
  const available=new Set(args.registeredProviders)
  const routes=NATIVE_TRANSLATION_ROUTES.filter(route=>available.has(route.provider))
  if(!routes.length)throw Error('翻译暂不可用：DSH 尚无已连接的翻译模型，请检查模型设置。')
  const failures:string[]=[]
  for(const route of routes){
    if(args.signal.aborted)throw args.signal.reason??Error('翻译请求已取消')
    const attemptSignal=AbortSignal.any([args.signal,AbortSignal.timeout(route.timeoutMs)])
    let text='',reason:NativeTranslationStreamChunk['reason']
    try{
      for await(const chunk of args.stream(route,attemptSignal)){
        if(chunk.type==='text-delta'&&typeof chunk.text==='string')text+=chunk.text
        if(chunk.type==='finish')reason=chunk.reason
      }
      if(attemptSignal.aborted)throw Error('ATTEMPT_TIMEOUT_OR_CANCELLED')
      if(reason?.kind!=='stop'){
        const code=String(reason?.failure?.code||reason?.kind||'NO_FINISH')
          .replace(/[^A-Za-z0-9_-]/g,'').slice(0,36)
        throw Error('MODEL_FINISH_'+code)
      }
      // Original caller validates every original MID before writing its one DSH cache.
      return {values:args.validate(text),route}
    }catch(error){
      if(args.signal.aborted)throw args.signal.reason??Error('翻译请求已取消')
      const code=String(error instanceof Error?error.message:'MODEL_FAILURE')
        .replace(/[^A-Za-z0-9_-]/g,'').slice(0,52)||'UNKNOWN'
      failures.push(route.label+':'+code)
      // Never retry the same paid provider call.
    }
  }
  throw Error('翻译暂不可用：ChatGPT 及已连接的备用模型均未完成。'
    +'已尝试 '+routes.map(route=>route.label).join(' → ')
    +'；请检查额度或模型连接后重试。'
    +(failures.length?' ['+failures.join(', ').slice(0,160)+']':''))
}
