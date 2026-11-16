/**
 * Minimal YENRA header adapter for the UNMODIFIED dsh-persona-dafeiyu plugin.
 * All persona and scope data are owned by the original plugin's native API.
 * No second persona store, picker engine, system prompt, or session is created.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IconPersonalizationOutlineRegular, IconChevronDownOutlineRegular } from '../../../../upstream/official-source/packages/client/ui-primitives/src/icons/index'

import { readNativePersonaStatus, selectNativeSessionPersona } from './native-persona-core'
import { LOCAL_MODE_ERROR } from './persona/native-persona-api'
import type { NativePersonaStatus as Status, NativePersonaSelection } from './persona/native-persona-api'
export function PersonaHeaderMenu({sessionId,cwd}:{sessionId:string|undefined;cwd:string}){
  const [value,setValue]=useState<Status|null>(null)
  const [open,setOpen]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const menuRef=useRef<HTMLDivElement>(null)
  const contextRef=useRef({sessionId,cwd})
  contextRef.current={sessionId,cwd}
  const load=useCallback(async()=>{
    if(!sessionId)return
    const state=await readNativePersonaStatus(sessionId,cwd)
    if(contextRef.current.sessionId===sessionId&&contextRef.current.cwd===cwd)setValue(state)
  },[sessionId,cwd])
  useEffect(()=>{
    const onSync=(event:Event)=>{
      const info=(event as CustomEvent<{sessionId:string}>).detail
      if(sessionId&&info?.sessionId===sessionId)void load().catch(()=>{})
    }
    window.addEventListener('yenra-persona-core-ready',onSync)
    return()=>window.removeEventListener('yenra-persona-core-ready',onSync)
  },[sessionId,load])
  useEffect(()=>{
    let active=true
    setValue(null)
    setOpen(false)
    setError('')
    if(!sessionId)return
    void readNativePersonaStatus(sessionId,cwd)
      .then(next=>{if(active)setValue(next)})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason))})
    return()=>{active=false}
  },[sessionId,cwd])
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{
      if(!menuRef.current?.contains(event.target as Node))setOpen(false)
    }
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setOpen(false)}
    }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return()=>{
      document.removeEventListener('pointerdown',outside)
      document.removeEventListener('keydown',escape)
    }
  },[open])
  const mutate=async (selection:NativePersonaSelection)=>{
    if(!sessionId||busy)return
    setBusy(true)
    setError('')
    const sameContext=()=>contextRef.current.sessionId===sessionId&&contextRef.current.cwd===cwd
    try{
      const next=await selectNativeSessionPersona(sessionId,cwd,selection)
      if(sameContext()){setValue(next);setOpen(false)}
    }catch(reason){if(sameContext())setError(reason instanceof Error?reason.message:String(reason))}
    finally{setBusy(false)}
  }
  if(!sessionId)return null
  const name=!value?'人物卡状态不可用':!value.enabled?'人物卡插件已停用'
    :value.mode!=='session'?'非会话范围 · 需主人确认'
    :value.sessionOff?'本会话不启用人物卡'
    :!value.sessionPersona?'请为本会话选择人物卡'
    :value.effective?.enabled===false?'人物卡已停用'
    :value.sessionPersona.name
  const currentId=value?.sessionPersona?.id??null
  const canSelect=value?.enabled===true&&value.mode==='session'
  return <div className="v2-persona-header" ref={menuRef} data-yenra-persona-state={canSelect?'ready':'blocked'}>
    <button type="button" className="v2-persona-trigger" disabled={busy}
      aria-label={'人物卡：'+name} aria-expanded={open} aria-haspopup="dialog"
      title={'人物卡：'+name}
      onClick={()=>{
        setOpen(!open)
        if(!open)void load().catch(reason=>setError(String(reason)))
      }}>
      <IconPersonalizationOutlineRegular size={15} className="v2-persona-icon"/>
      <span className="v2-persona-name">{name}</span>
      <IconChevronDownOutlineRegular size={14} className="v2-persona-chevron"/>
    </button>
    {open?<div className="v2-persona-menu" role="dialog" aria-label="人物卡与生效范围">
      <div className="v2-persona-menu-heading">人物卡</div>
      <div className="v2-persona-choice-list">
        {(value?.personas||[]).filter(item=>item.enabled!==false).map(item=>
          <button type="button" key={item.id} disabled={busy||!canSelect}
            aria-pressed={item.id===currentId}
            onClick={()=>void mutate({personaId:item.id})}>
            <span>{item.name}</span><span>{item.id===currentId?'✓':''}</span>
          </button>)}
      </div>
      {canSelect?<div className="v2-persona-choice-list v2-persona-fallback">
        <button type="button" disabled={busy} aria-pressed={value?.sessionOff===true}
          onClick={()=>void mutate({none:true})}>此会话不启用人物卡</button>
      </div>:null}
      <div className="v2-persona-menu-heading">生效范围</div>
      <div className="v2-persona-menu-note">此入口仅修改当前会话，不修改全局或工作区规则。</div>
      {value&&value.mode!=='session'?<div className="v2-persona-menu-note" role="alert">{LOCAL_MODE_ERROR}</div>:null}
      {value&&!value.enabled?<div className="v2-persona-menu-note">原生插件已停用，请在原生设置中确认。</div>:null}
      {canSelect&&!value?.sessionPersona&&!value?.sessionOff?<div className="v2-persona-menu-note">没有本会话选择，或选择已被原生容量淘汰。请重新明确选择后再生成；不会自动套用 Yeonhee。</div>:null}
      {error?<div className="v2-persona-menu-error" role="alert">{error}</div>:null}
    </div>:null}
  </div>
}
