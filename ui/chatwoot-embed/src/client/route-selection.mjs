/** Verified native Chatwoot route selection and explicit, ACK-gated draft insertion. */
export function createRouteSelectionSource({getFrameWindow,expectedOrigin,resolveContext,windowObject=window,now=Date.now}) {
  const listeners=new Set()
  let sequence=0,generation=0,desired=null,current=null,pending=null
  let draftNumber=0, pendingDraft=null
  // Bounded, ephemeral Host proof ONLY. Never messages, avatars, credentials or
  // stored contact state. Safe only within this same mounted/verified iframe.
  const verifiedScopes=new Map()
  const warmProofMs=30000, maxVerifiedScopes=16
  const emit=value=>{current=value;for(const listener of [...listeners])listener(value)}
  const cancelDraft=()=>{pendingDraft?.finish(false)}
  const clear=()=>{++generation;pending?.abort();pending=null;cancelDraft();desired=null;emit(null)}
  const request=()=>getFrameWindow()?.postMessage({type:'yenra:cw-route-request:v1'},expectedOrigin)
  async function receive(event){
    if(event.source!==getFrameWindow()||!event.source||event.origin!==expectedOrigin)return
    if(event.data?.type==='yenra:cw-draft-ack:v1'){
      const ack=pendingDraft
      if(ack&&ack.requestId===event.data.requestId&&ack.generation===generation&&
          ack.accountId===event.data.accountId&&ack.conversationId===event.data.conversationId)
        ack.finish(event.data.ok===true)
      return
    }
    if(event.data?.type!=='yenra:cw-route:v1')return
    const value=event.data
    if(!Number.isSafeInteger(value.sequence)||value.sequence<=sequence)return
    sequence=value.sequence
    if(![value.accountId,value.conversationId].every(id=>Number.isSafeInteger(id)&&id>0)){clear();return}
    const key=`${value.accountId}:${value.conversationId}`
    if(desired===key&&(pending||current))return
    const epoch=++generation
    pending?.abort();cancelDraft();desired=key;emit(null)
    // Reuse a recently HOST-VERIFIED conversation identity for immediate
    // A->B->A feedback. Full Host proof is mandatory on cold/expired entries.
    const cached=verifiedScopes.get(key)
    if(cached){
      verifiedScopes.delete(key)
      if(cached.validUntil>now()){
        pending=null;verifiedScopes.set(key,cached)
        emit({...cached.contact});return
      }
    }
    const controller=new AbortController();pending=controller
    let contact=null
    try{
      const verified=await resolveContext({accountId:value.accountId,conversationId:value.conversationId},controller.signal)
      if(/^[a-f0-9]{32}$/.test(verified?.accountRef??'')&&/^[a-f0-9]{32}$/.test(verified?.roomRef??''))
        contact={accountRef:verified.accountRef,roomRef:verified.roomRef}
    }catch{/* Never fall back to browser-supplied contact identity. */}
    if(epoch!==generation||!listeners.size)return
    pending=null;if(!contact){desired=null;verifiedScopes.delete(key)}
    else{
      verifiedScopes.delete(key)
      verifiedScopes.set(key,{contact:{...contact},validUntil:now()+warmProofMs})
      while(verifiedScopes.size>maxVerifiedScopes)verifiedScopes.delete(verifiedScopes.keys().next().value)
    }
    emit(contact)
  }
  return {
    reset(){verifiedScopes.clear();sequence=0;clear();request()},
    subscribe(listener){
      listeners.add(listener);listener(current)
      if(listeners.size===1){windowObject.addEventListener('message',receive);request()}
      return()=>{listeners.delete(listener);if(!listeners.size){windowObject.removeEventListener('message',receive);verifiedScopes.clear();clear();sequence=0}}
    },
    adoptDraft(accountRef,roomRef,text){
      if(!current||current.accountRef!==accountRef||current.roomRef!==roomRef||
          !desired||pending||pendingDraft||!listeners.size||
          typeof text!=='string'||!text.trim()||text.length>2000)return Promise.resolve(false)
      const frame=getFrameWindow()
      if(!frame)return Promise.resolve(false)
      const [accountId,conversationId]=desired.split(':').map(Number)
      const requestId=++draftNumber,epoch=generation
      return new Promise(resolve=>{
        const finish=ok=>{
          if(pendingDraft?.requestId!==requestId)return
          clearTimeout(timeout);pendingDraft=null
          resolve(ok===true&&generation===epoch&&current?.accountRef===accountRef&&current?.roomRef===roomRef)
        }
        const timeout=setTimeout(()=>finish(false),1600)
        pendingDraft={requestId,accountId,conversationId,generation:epoch,finish}
        try{frame.postMessage({type:'yenra:cw-draft:v1',accountId,conversationId,requestId,text},expectedOrigin)}
        catch{finish(false)}
      })
    },
  }
}
