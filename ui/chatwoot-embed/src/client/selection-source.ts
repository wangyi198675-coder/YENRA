/** Event-driven proxy selection -> original Host verified scope. No polling. */
import type { VerifiedContact, VerifiedSelectionSource } from './binding-contract.ts'
export interface HostVerifiedSelectionSourceOptions { proxyOrigin: string; bridgeOrigin: string }
export function createHostVerifiedSelectionSource({proxyOrigin,bridgeOrigin}:HostVerifiedSelectionSourceOptions):VerifiedSelectionSource {
  const listeners=new Set<(contact:VerifiedContact|null)=>void>()
  let stream:EventSource|null=null
  let generation=0
  let lifecycle=0
  let desired:string|null=null
  let current:VerifiedContact|null=null
  let pending:AbortController|null=null
  function emit(contact:VerifiedContact|null){current=contact;for(const listener of [...listeners])listener(contact)}
  function clear(){++generation;pending?.abort();pending=null;desired=null;emit(null)}
  async function observe(value:any){
    const accountId=Number(value?.accountId),displayId=Number(value?.displayId)
    if(!Number.isSafeInteger(accountId)||!Number.isSafeInteger(displayId)||accountId<=0||displayId<=0){clear();return}
    const key=`${accountId}:${displayId}`
    if(desired===key&&(pending||current))return
    const epoch=++generation
    pending?.abort()
    const controller=new AbortController();pending=controller;desired=key
    // Clear A immediately, BEFORE resolving B, including any pending room read.
    emit(null)
    let contact:VerifiedContact|null=null
    try{
      const response=await fetch(`${bridgeOrigin}/selection?accountId=${accountId}&displayId=${displayId}`,{cache:'no-store',signal:controller.signal})
      if(response.ok){
        const payload=await response.json(),selection=payload?.selection
        if(payload?.ok===true&&typeof selection?.accountRef==='string'&&selection.accountRef.trim()&&typeof selection?.roomRef==='string'&&selection.roomRef.trim())
          contact={accountRef:selection.accountRef,roomRef:selection.roomRef}
      }
    }catch{/* Failure stays unbound. The next same-key event can retry. */}
    if(epoch!==generation||listeners.size===0)return
    pending=null
    if(!contact)desired=null
    emit(contact)
  }
  return {subscribe(listener){
    listeners.add(listener);listener(current)
    if(listeners.size===1){
      const life=++lifecycle
      let receivedStream=false
      // Snapshot is only a startup fallback; it may NEVER supersede stream data.
      void (async()=>{try{
        const response=await fetch(`${proxyOrigin}/__yenra/selection`,{cache:'no-store'})
        const value=response.ok?await response.json():null
        if(life===lifecycle&&!receivedStream)void observe(value)
      }catch{if(life===lifecycle&&!receivedStream)clear()}})()
      try{
        stream=new EventSource(`${proxyOrigin}/__yenra/selection/stream`)
        stream.onmessage=event=>{
          if(life!==lifecycle)return
          receivedStream=true
          try{void observe(JSON.parse(event.data))}catch{clear()}
        }
        stream.onerror=()=>{if(life===lifecycle){receivedStream=true;clear()}}
      }catch{clear()}
    }
    return()=>{
      listeners.delete(listener)
      if(!listeners.size){++lifecycle;++generation;pending?.abort();pending=null;stream?.close();stream=null;desired=null;current=null}
    }
  }}
}
