/** Read-only local diagnostic surface, no persistence or network delivery. */
import {createBrainTimingRecorder,type BrainTimingStage,type BrainTimingCounters} from '../brain-timing-core'
const timing=createBrainTimingRecorder()
export function emitBrainTiming(sessionId:string,stage:BrainTimingStage,counters:BrainTimingCounters={}):void{
  timing.emit(sessionId,stage,counters)
}
export function readClientBrainTimings(){return{version:1,clock:'client-performance',records:timing.snapshot()}}
// Explicit retrieval for the existing Electron devtools/read-only QA consumer.
// No session ID or contact identifiers leave the private recorder.
if(typeof window!=='undefined'){
  try{
    Object.defineProperty(window,'__YENRA_BRAIN_TIMING_V1__',{
      configurable:true,value:Object.freeze({snapshot:readClientBrainTimings}),
    })
  }catch{/* Optional diagnostics must never prevent the native UI from loading. */}
}
