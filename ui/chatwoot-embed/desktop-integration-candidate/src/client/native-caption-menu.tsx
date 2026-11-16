import React,{useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {MenuSurface} from '../../../../upstream/official-source/packages/client/ui-primitives/src/MenuSurface'
import {MenuItemButton} from '../../../../upstream/official-source/packages/client/ui-primitives/src/Menu'

const newSession=()=>document.querySelector<HTMLButtonElement>(
  'button[aria-label="新建会话"],button[aria-label="New session"],button[aria-label="New Session"]')

/** A container for the EXISTING preload menu, not another command registry.
 * App/Edit retain their actual buttons, native popup IPC and editor handling. */
export function NativeCaptionMenu({enabled,onToggleSidebar}:{enabled:boolean;onToggleSidebar:()=>void}){
  const [ready,setReady]=useState(false)
  const [open,setOpen]=useState(false)
  const trigger=useRef<HTMLButtonElement>(null)
  const surface=useRef<HTMLDivElement>(null)
  const slot=useRef<HTMLDivElement>(null)
  const native=useRef<HTMLElement|null>(null)
  const anchor=useRef<Comment|null>(null)
  const focusOnOpen=useRef(false)

  useLayoutEffect(()=>{
    if(!enabled||!document.documentElement.hasAttribute('data-windows-titlebar'))return
    let disposed=false
    let cleanup=()=>{}
    const mount=()=>{
      const host=document.querySelector<HTMLElement>('[data-windows-menu]')
      if(disposed||!host?.shadowRoot||!host.parentNode)return
      const mark=document.createComment('YENRA original caption menu seat')
      host.parentNode.insertBefore(mark,host)
      anchor.current=mark;native.current=host
      const style=document.createElement('style')
      style.textContent=`
        :host([data-yenra-menu-hosted=true]){position:static!important;height:auto!important;width:100%;margin:0!important;padding:0!important;border:0!important}
        :host([data-yenra-menu-hosted=true]) [role=menubar]{display:flex;flex-direction:column;width:100%;gap:2px}
        :host([data-yenra-menu-hosted=true]) button{box-sizing:border-box;width:100%;height:32px;display:flex;align-items:center;justify-content:space-between;text-align:left;padding:0 12px;border-radius:7px}
        :host([data-yenra-menu-hosted=true]) button::after{content:'›';opacity:.65;font-size:18px}
      `
      host.shadowRoot.append(style)
      document.documentElement.dataset.yenraCaptionMenu='ready'
      setReady(true);observer.disconnect()
      cleanup=()=>{
        if(mark.parentNode)mark.parentNode.insertBefore(host,mark.nextSibling)
        delete host.dataset.yenraMenuHosted
        style.remove();mark.remove()
        delete document.documentElement.dataset.yenraCaptionMenu
        native.current=null;anchor.current=null
      }
    }
    const observer=new MutationObserver(mount)
    observer.observe(document.body,{childList:true,subtree:true})
    mount()
    return()=>{disposed=true;observer.disconnect();cleanup();setReady(false);setOpen(false)}
  },[enabled])

  useLayoutEffect(()=>{
    const host=native.current
    if(!open||!host||!slot.current)return
    slot.current.append(host);host.dataset.yenraMenuHosted='true'
    const buttons=[...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
    let nativePopup=false
    const observer=new MutationObserver(()=>{
      const next=buttons.some(b=>b.getAttribute('aria-expanded')==='true')
      if(nativePopup&&!next)setOpen(false)
      nativePopup=next
    })
    for(const button of buttons)observer.observe(button,{attributes:true,attributeFilter:['aria-expanded']})
    // Pointer entry preserves the active Cloud/native editor's focus. Keyboard
    // entry uses the original menubar's own arrow keys and focus restoration.
    if(focusOnOpen.current)buttons[0]?.focus()
    return()=>{
      observer.disconnect()
      if(anchor.current?.parentNode)anchor.current.parentNode.insertBefore(host,anchor.current.nextSibling)
      delete host.dataset.yenraMenuHosted
    }
  },[open])

  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{
      const path=event.composedPath()
      if(!path.includes(surface.current!)&&!path.includes(trigger.current!))setOpen(false)
    }
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus()}
    }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[open])

  if(!ready)return null
  const shortcut=newSession()?.getAttribute('aria-keyshortcuts')??undefined
  return createPortal(<>
    <button ref={trigger} type="button" className="v2-caption-menu-trigger"
      aria-label="YENRA 菜单" aria-haspopup="menu" aria-expanded={open} aria-controls="yenra-caption-menu"
      onPointerDown={event=>{event.preventDefault();focusOnOpen.current=false}}
      onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();focusOnOpen.current=true;setOpen(true)}}}
      onClick={event=>{focusOnOpen.current=event.detail===0;setOpen(value=>!value)}}>
      <span aria-hidden="true">☰</span>
    </button>
    {open?<MenuSurface ref={surface} id="yenra-caption-menu" role="menu" aria-label="YENRA 菜单"
      className="v2-caption-menu-surface" compact>
      <div ref={slot} className="v2-caption-native-slot"/>
      <MenuItemButton separatorBefore disabled={!newSession()}
        shortcut={shortcut?{aria:shortcut,keys:shortcut.replace('Control','Ctrl').split('+')}:undefined}
        onSelect={()=>{newSession()?.click();setOpen(false)}}>新建会话</MenuItemButton>
      <MenuItemButton onSelect={()=>{onToggleSidebar();setOpen(false)}}>展开／收起工作导航</MenuItemButton>
    </MenuSurface>:null}
  </>,document.body)
}
