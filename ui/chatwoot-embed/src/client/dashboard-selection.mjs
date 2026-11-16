/** Native Dashboard App relay -> original Host resolver -> existing Brain sink. */
export function createDashboardSelectionSource({getFrameWindow,resolveContext,windowObject=window,leaseMs=3500}) {
  const listeners=new Set()
  let activeSource=null,desired=null,current=null,timer=null,pending=null,generation=0
  const emit=value=>{current=value;for(const listener of [...listeners])listener(value)}
  function clear(){++generation;pending?.abort();pending=null;desired=null;current=null;emit(null)}
  function trusted(event){
    if(event.origin!==windowObject.location.origin||!event.source)return false
    const frame=getFrameWindow()
    if(!frame)return false
    try{
      if(event.source.parent!==frame||frame.parent!==windowObject)return false
      // A detached previous conversation's WindowProxy cannot renew its lease.
      for(let i=0;i<Math.min(frame.length,32);i++)if(frame[i]===event.source)return true
    }catch{/* Cross-origin WindowProxy supports parent/length/index, nothing else. */}
    return false
  }
  async function receive(event){
    if(!trusted(event)||event.data?.type!=='yenra:cw-context:v1')return
    const value=event.data.context
    if(value===null){if(activeSource===event.source){clear();activeSource=null}return}
    if(!value||![value.accountId,value.conversationId,value.inboxId,value.contactId].every(id=>Number.isSafeInteger(id)&&id>0)||
      !/^yenra-[a-f0-9]{40}$/.test(value.identifier??''))return
    const key=[value.accountId,value.conversationId,value.inboxId,value.contactId,value.identifier].join(':')
    if(timer!==null)windowObject.clearTimeout(timer)
    timer=windowObject.setTimeout(()=>{timer=null;activeSource=null;clear()},leaseMs)
    if(activeSource===event.source&&desired===key&&(pending||current))return
    const epoch=++generation
    pending?.abort()
    const controller=new AbortController();pending=controller;activeSource=event.source;desired=key;emit(null)
    let selected=null
    try{
      const verified=await resolveContext(value,controller.signal)
      if(/^[a-f0-9]{32}$/.test(verified?.accountRef??'')&&/^[a-f0-9]{32}$/.test(verified?.roomRef??''))
        selected={accountRef:verified.accountRef,roomRef:verified.roomRef}
    }catch{/* Unavailable/unverified stays unbound. Next lease heartbeat may retry. */}
    if(epoch!==generation||!listeners.size)return
    pending=null
    if(!selected)desired=null
    emit(selected)
  }
  return {subscribe(listener){
    listeners.add(listener);listener(current)
    if(listeners.size===1)windowObject.addEventListener('message',receive)
    return()=>{
      listeners.delete(listener)
      if(!listeners.size){windowObject.removeEventListener('message',receive);if(timer!==null)windowObject.clearTimeout(timer)
        timer=null;pending?.abort();pending=null;++generation;desired=null;current=null;activeSource=null}
    }
  }}
}
