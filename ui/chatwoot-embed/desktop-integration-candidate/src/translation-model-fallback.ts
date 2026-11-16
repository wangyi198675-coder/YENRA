/**
 * Native translation routing across ORIGINAL DSH registered models only.
 * The registered provider name is NOT proof that a hard-coded model exists.
 * Consult the official DSH model catalog and select at most one model per
 * provider. No alternate gateway, credentials, agent, database or sender.
 */
export type NativeTranslationModelRoute={
  readonly provider:string
  readonly model:string
  readonly label:string
  readonly timeoutMs:number
}
export const NATIVE_TRANSLATION_ROUTES:readonly NativeTranslationModelRoute[]=[
  {provider:'openai-codex',model:'gpt-6-sol',label:'ChatGPT',timeoutMs:28000},
  {provider:'vclaw-gpt',model:'gpt-6.1-sol',label:'ChatGPT',timeoutMs:28000},
  {provider:'deepseek-official',model:'deepseek-flash',label:'DeepSeek',timeoutMs:26000},
  {provider:'vclaw-ccmax',model:'claude-opus-5-5',label:'V-Claw Claude',timeoutMs:30000},
  {provider:'vclaw-opus-ab',model:'claude-opus-4-6',label:'V-Claw Claude',timeoutMs:30000},
]
// Prefer current models; fall back only to names actually advertised by DSH.
// Never guess a model ID when listModels says it does not exist.
const MODEL_PREFERENCE:Readonly<Record<string,readonly string[]>>={
  'openai-codex':['gpt-6.1-sol','gpt-6-sol','gpt-5.3-codex','gpt-5.2-codex'],
  'vclaw-gpt':['gpt-6.1-sol','gpt-6.1-terra'],
  'deepseek-official':['deepseek-flash','deepseek-chat','deepseek-reasoner'],
  'vclaw-ccmax':['claude-opus-5-5','claude-opus-4-6','claude-sonnet-5-5'],
  'vclaw-opus-ab':['claude-opus-4-6','claude-sonnet-4-5'],
}
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
  readonly listModels?:(provider:string)=>Promise<readonly string[]>
  readonly signal:AbortSignal
  readonly stream:(route:NativeTranslationModelRoute,signal:AbortSignal)=>AsyncIterable<NativeTranslationStreamChunk>
  readonly validate:(output:string)=>Map<string,string>
}):Promise<NativeTranslationAttemptResult>{
  const available=new Set(args.registeredProviders)
  const registered=NATIVE_TRANSLATION_ROUTES.filter(route=>available.has(route.provider))
  if(!registered.length)throw Error('翻译暂不可用：DSH 尚无已连接的翻译模型，请检查模型设置。')
  const catalogErrors:string[]=[]
  const routes:NativeTranslationModelRoute[]=[]
  for(const route of registered){
    if(args.signal.aborted)throw args.signal.reason??Error('翻译请求已取消')
    if(!args.listModels){routes.push(route);continue}
    try{
      const advertised=new Set(await args.listModels(route.provider))
      const model=(MODEL_PREFERENCE[route.provider]??[route.model])
        .find(id=>advertised.has(id))
      if(model)routes.push({...route,model})
      else catalogErrors.push(route.provider+':MODEL_NOT_IN_CATALOG')
    }catch{
      catalogErrors.push(route.provider+':MODEL_CATALOG_UNAVAILABLE')
    }
  }
  if(!routes.length)throw Error('翻译暂不可用：已注册的 DSH 提供商没有可用模型目录。'+
    '请检查原生模型设置。 ['+catalogErrors.join(', ').slice(0,160)+']')
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
      // Caller verifies all MIDs before writing the one original DSH cache.
      return {values:args.validate(text),route}
    }catch(error){
      if(args.signal.aborted)throw args.signal.reason??Error('翻译请求已取消')
      const code=String(error instanceof Error?error.message:'MODEL_FAILURE')
        .replace(/[^A-Za-z0-9_-]/g,'').slice(0,52)||'UNKNOWN'
      failures.push(route.provider+'/'+route.model+':'+code)
      // Do not blindly retry the same provider/model.
    }
  }
  throw Error('翻译暂不可用：原生 ChatGPT 及已连接的备用模型均未完成。已尝试 '+
    routes.map(route=>route.label).join(' → ')+'；请检查额度或模型连接后重试。'+
    ' ['+[...catalogErrors,...failures].join(', ').slice(0,220)+']')
}
