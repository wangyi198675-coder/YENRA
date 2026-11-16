/** Scoped adapter; the installed native plugin remains the only persona store. */
import { YEONHEE_FULL_CCV3 } from '../legacy-persona/yeonhee-full-ccv3'
import { createNativePersonaApi } from './persona/native-persona-api'
export type { NativePersonaStatus, NativePersonaSelection } from './persona/native-persona-api'

const native=createNativePersonaApi((input,init)=>fetch(input,init),{
  name:'Yeonhee · 完整人格 CCv3 + V4.1',text:YEONHEE_FULL_CCV3,
})
function notify(sessionId:string){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('yenra-persona-core-ready',{detail:{sessionId}}))
}
export const readNativePersonaStatus=native.status
export async function selectNativeSessionPersona(
  sessionId:string,cwd:string,selection:import('./persona/native-persona-api').NativePersonaSelection,
){
  const state=await native.select(sessionId,cwd,selection)
  notify(sessionId)
  // Only an explicit owner selection may retry a previously blocked Brain init.
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('yenra-persona-selection-changed',{detail:{sessionId}}))
  return state
}
/** Only a newly created Brain may receive explicit one-shot allowDefault authorization. */
export async function ensureNativeYeonheeCore(
  sessionId:string,cwd:string,options:{allowDefault?:boolean}={},
):Promise<void>{
  await native.ensure(sessionId,cwd,options)
  notify(sessionId)
}
/** Await immediately before EVERY Brain generation. A rejected check must block generation. */
export async function revalidateNativePersonaBeforeGeneration(sessionId:string,cwd:string){
  const state=await native.revalidate(sessionId,cwd)
  notify(sessionId)
  return state
}
