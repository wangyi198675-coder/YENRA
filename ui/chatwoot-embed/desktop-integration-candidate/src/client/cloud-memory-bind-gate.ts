/** Ephemeral admission guard for the EXISTING DSH MemoryService command.
 * It is NOT a memory store, scope grant, credential cache or second agent.
 * The original Host MUST verify every admitted bind and every later read/write.
 */
export type CloudMemoryIdentity={
  sessionId:string
  selectionEpoch:number
  cloudConversationId:number
  pageIdentityHash:string
  memoryAccountRef?:string
  memoryRoomRef?:string
}
export type CloudMemoryBindReceipt={ok:boolean;invalidIdentityShape?:boolean}

export function verifiedCloudMemoryRef(input:CloudMemoryIdentity):boolean {
  return typeof input.sessionId==='string'&&input.sessionId.length>0&&
    Number.isSafeInteger(input.selectionEpoch)&&input.selectionEpoch>=0&&
    Number.isSafeInteger(input.cloudConversationId)&&input.cloudConversationId>0&&
    /^[a-f0-9]{64}$/u.test(input.pageIdentityHash)&&
    /^[a-f0-9]{32}$/u.test(input.memoryAccountRef??'')&&
    /^[a-f0-9]{32}$/u.test(input.memoryRoomRef??'')
}

/** Prevent repeated malformed Host commands. A new verified selection epoch
 * always gets another opportunity. No success is cached: actual authorization
 * is always checked again on later generations and writes.
 */
export function createCloudMemoryBindGate(now:()=>number=Date.now){
  const pending=new Map<string,Promise<boolean>>()
  const rejectedUntil=new Map<string,number>()
  const key=(i:CloudMemoryIdentity)=>[
    i.sessionId,i.selectionEpoch,i.cloudConversationId,
    i.pageIdentityHash,i.memoryAccountRef,i.memoryRoomRef,
  ].join(':')
  return {
    run(input:CloudMemoryIdentity,invoke:()=>Promise<CloudMemoryBindReceipt>):Promise<boolean>{
      if(!verifiedCloudMemoryRef(input))return Promise.resolve(false)
      const id=key(input)
      if(pending.has(id))return pending.get(id)!
      if((rejectedUntil.get(id)??0)>now())return Promise.resolve(false)
      const flight=Promise.resolve().then(invoke).then(receipt=>{
        if(receipt.ok){rejectedUntil.delete(id);return true}
        // A schema rejection cannot heal without changing Host/selection.
        // Ordinary service errors can heal on next retry after a short cooldown.
        rejectedUntil.set(id,now()+(receipt.invalidIdentityShape?5*60_000:30_000))
        return false
      }).catch(()=>{
        rejectedUntil.set(id,now()+30_000)
        return false
      }).finally(()=>{pending.delete(id)})
      pending.set(id,flight)
      // A selection change naturally changes the key; bound memory itself is
      // stored ONLY in the upstream MemoryService.
      if(rejectedUntil.size>128)rejectedUntil.clear()
      return flight
    }
  }
}
