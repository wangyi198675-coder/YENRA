/**
 * In-memory coalescing ONLY while the original DSH memory-adopt write is pending.
 * Not an independent memory store, authorization cache, duplicate sender or Agent.
 * Authorization remains checked by the original Host before every invocation.
 */
export function createNativeMemoryAdoptSingleFlight(){
  const pending=new Map<string,Promise<unknown>>()
  return {
    async run<T>(verifiedWorkspace:string,adoptedDraft:string,operation:()=>Promise<T>):
      Promise<{value:T;joined:boolean}>{
      if(!verifiedWorkspace||!adoptedDraft)
        throw new Error('Native memory adopt needs a verified scope and a nonempty draft')
      const key=JSON.stringify([verifiedWorkspace,adoptedDraft])
      const existing=pending.get(key) as Promise<T>|undefined
      if(existing)return {value:await existing,joined:true}
      // Install the pending promise synchronously; defer work to next microtask.
      // Concurrent actions for exactly the same verified contact/draft now join.
      const promise=Promise.resolve().then(operation)
      pending.set(key,promise)
      try{return {value:await promise,joined:false}}
      finally{if(pending.get(key)===promise)pending.delete(key)}
    },
  }
}
