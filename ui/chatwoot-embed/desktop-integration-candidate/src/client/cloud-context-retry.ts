/** A bounded, read-only retry for transient Cloud→original DSH identity lookups.
 * Never invents or trusts contact IDs. The caller retains the identity
 * validation, selection epoch, native Brain Session and sender boundary.
 */
export type CloudContextHint={accountId:196799;conversationId:number}
export type CloudContextResult={response:Response;payload:any}
type RequestOptions={
  fetchImpl?:typeof fetch
  delay?:(ms:number)=>Promise<void>
  timeoutMs?:number
  desktopOrigin?:boolean
}
const transient=(status:number,payload:any):boolean=>{
  const code=typeof payload?.code==='string'?payload.code:''
  return !payload||status===408||status===429||status>=500||
    (payload?.ok===false&&code.endsWith('_UNAVAILABLE'))
}
export async function resolveCloudContextWithRetry(
  hint:CloudContextHint,controller:AbortController,options:RequestOptions={}
):Promise<CloudContextResult|null>{
  const fetchImpl=options.fetchImpl??fetch
  const delay=options.delay??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)))
  for(let attempt=0;attempt<2;attempt++){
    if(controller.signal.aborted)return null
    try{
      const response=await fetchImpl('/api/yenra/cloud-context/resolve',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(options.timeoutMs??12000)]),
        headers:{'content-type':'application/json',
          ...(options.desktopOrigin?{'x-yenra-desktop-origin':'dsh-app://app'}:{})},
        body:JSON.stringify(hint),
      })
      const payload=await response.json().catch(()=>null)
      if(attempt===0&&!controller.signal.aborted&&transient(response.status,payload)){
        await delay(300)
        continue
      }
      return {response,payload}
    }catch(error){
      if(controller.signal.aborted||attempt===1)throw error
      await delay(300)
    }
  }
  return null
}
