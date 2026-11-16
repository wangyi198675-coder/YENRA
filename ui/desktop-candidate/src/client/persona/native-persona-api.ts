/** Native Persona is the sole selection store. No mirrored picks or global writes. */
export type NativePersona = {id:string;name:string;enabled:boolean}
export type NativePersonaStatus = {
  enabled:boolean
  active:boolean
  mode:'global'|'workspace'|'session'
  sessionId:string|null
  sessionPersona:{id:string;name:string}|null
  sessionOff:boolean
  effective:{id:string;name:string;enabled:boolean;source:string}|null
  currentName:string|null
  chars:number
  personas:NativePersona[]
}
export type NativePersonaSelection = {personaId:string} | {none:true}
type Fetch = (input:string, init?:RequestInit)=>Promise<Response>
const API='/api/dsh-persona-dafeiyu'
export const LOCAL_MODE_ERROR='原生 Persona 当前不是会话模式，无法只改本会话；请主人在原生设置中确认范围后切到会话模式。此入口不会修改全局或工作区设置。'

export function createNativePersonaApi(fetcher:Fetch, canonical:{name:string;text:string}){
  // Only transient operation ordering, never a persona selection cache.
  const pending=new Map<string,Promise<unknown>>()
  async function serial<T>(sessionId:string,cwd:string,operation:()=>Promise<T>):Promise<T>{
    if(!sessionId.startsWith('session-')||!cwd.trim())throw Error('缺少原生 Session 或工作区')
    const key=JSON.stringify([sessionId,cwd])
    const previous=pending.get(key)
    const run=(async()=>{await previous?.catch(()=>{});return operation()})()
    pending.set(key,run)
    try{return await run}finally{if(pending.get(key)===run)pending.delete(key)}
  }
  async function decode<T>(response:Response):Promise<T>{
    const payload=await response.json() as {ok:boolean;value?:T;error?:string}
    if(!response.ok||payload.ok!==true||!payload.value)
      throw Error('原生 Persona 操作失败：'+(payload.error||String(response.status)).slice(0,180))
    return payload.value
  }
  async function status(sessionId:string,cwd:string):Promise<NativePersonaStatus>{
    const query=new URLSearchParams({sessionId,cwd})
    const result=await decode<NativePersonaStatus>(await fetcher(API+'/status?'+query,{
      headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000),
    }))
    // Missing scoped fields indicate an older/incompatible API, not an empty pick.
    if(result.sessionId!==sessionId||typeof result.sessionOff!=='boolean'||
      !Object.hasOwn(result,'sessionPersona')||!Array.isArray(result.personas))
      throw Error('原生 Persona 缺少可核验的会话 API；已停止操作，不会改全局设置')
    return result
  }
  function requireLocal(state:NativePersonaStatus){
    if(state.enabled!==true)throw Error('原生 Persona 插件已停用；请主人在原生设置确认，未自动启用')
    if(state.mode!=='session')throw Error(LOCAL_MODE_ERROR)
  }
  async function mutate(sessionId:string,cwd:string,action:Record<string,unknown>){
    return decode<NativePersonaStatus>(await fetcher(API+'/mutate',{
      method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({...action,sessionId,cwd}),signal:AbortSignal.timeout(10000),
    }))
  }
  function currentSelection(state:NativePersonaStatus):NativePersonaSelection{
    requireLocal(state)
    if(state.sessionOff)return {none:true}
    if(!state.sessionPersona)
      throw Error('本会话没有可核验的人物卡选择（可能已被原生 200 条容量淘汰）。请重新选择人物卡；不会猜测或强制恢复 Yeonhee。')
    const item=state.personas.find(item=>item.id===state.sessionPersona!.id)
    if(!item||!item.enabled)throw Error('本会话选择的人物卡已删除或停用；请重新选择，未自动启用或替换')
    return {personaId:item.id}
  }
  function prove(state:NativePersonaStatus,selection:NativePersonaSelection){
    requireLocal(state)
    if('none' in selection){
      if(!state.sessionOff||state.effective!==null||state.active!==false||state.chars!==0)
        throw Error('原生 Persona 的本会话不启用状态核验失败，已停止生成')
    }else if(state.sessionOff||state.sessionPersona?.id!==selection.personaId||
      state.effective?.id!==selection.personaId||state.effective.source!=='session'||
      state.effective.enabled!==true||state.active!==true||!(state.chars>0)){
      throw Error('原生 Persona 本会话人物卡生效核验失败，已停止生成')
    }
  }
  async function applyAndProve(sessionId:string,cwd:string,selection:NativePersonaSelection){
    await mutate(sessionId,cwd,{action:'set-session-persona',...selection})
    const proven=await status(sessionId,cwd)
    prove(proven,selection)
    return proven
  }
  return {
    status,
    /** Owner action: writes only this native Session; never enables a disabled card. */
    select(sessionId:string,cwd:string,selection:NativePersonaSelection){
      return serial(sessionId,cwd,async()=>{
        const state=await status(sessionId,cwd)
        requireLocal(state)
        if(!('none' in selection)&&!state.personas.some(p=>p.id===selection.personaId&&p.enabled))
          throw Error('人物卡不存在或已停用；未修改选择')
        return applyAndProve(sessionId,cwd,selection)
      })
    },
    /** Fresh native read on EVERY request; renew the SAME pick in the native 200-entry table. */
    revalidate(sessionId:string,cwd:string){
      return serial(sessionId,cwd,async()=>{
        const state=await status(sessionId,cwd)
        const selection=currentSelection(state)
        prove(state,selection)
        return applyAndProve(sessionId,cwd,selection)
      })
    },
    /** allowDefault is one-shot authorization for a just-created Brain, never an old Session. */
    ensure(sessionId:string,cwd:string,{allowDefault=false}:{allowDefault?:boolean}={}){
      return serial(sessionId,cwd,async()=>{
        let state=await status(sessionId,cwd)
        requireLocal(state)
        if(state.sessionOff||state.sessionPersona){
          const selection=currentSelection(state)
          prove(state,selection)
          await applyAndProve(sessionId,cwd,selection)
          return
        }
        if(!allowDefault){currentSelection(state);return}
        let core=state.personas.find(item=>item.name===canonical.name)
        if(!core){
          state=await mutate(sessionId,cwd,{action:'import',name:canonical.name,text:canonical.text})
          core=state.personas.find(item=>item.name===canonical.name)
        }
        if(!core?.enabled)throw Error('完整 CCv3 不存在或已被主人停用；未自动启用')
        const body=await decode<{id:string;text:string}>(await fetcher(API+'/persona?'+new URLSearchParams({id:core.id}),{
          headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000),
        }))
        if(body.id!==core.id||body.text!==canonical.text.trim())throw Error('原生库同名 CCv3 与完整源不一致；未覆盖原卡，请主人确认')
        // Re-read after import/body fetch: do not overwrite an intervening owner choice.
        const latest=await status(sessionId,cwd)
        requireLocal(latest)
        if(latest.sessionOff||latest.sessionPersona){
          const selection=currentSelection(latest)
          prove(latest,selection)
          await applyAndProve(sessionId,cwd,selection)
        }else await applyAndProve(sessionId,cwd,{personaId:core.id})
      })
    },
  }
}
