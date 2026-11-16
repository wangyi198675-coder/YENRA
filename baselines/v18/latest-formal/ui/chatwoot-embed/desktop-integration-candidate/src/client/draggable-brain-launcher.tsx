/**
 * The ONE original DSH Brain open/close control, with UI-only draggable
 * placement isolated from the heavy Cloud/Brain parent renderer.
 * Gesture ownership reuses the existing @use-gesture/react dependency.
 */
import React,{useLayoutEffect,useRef,useState} from 'react'
import {useDrag} from '@use-gesture/react'
import {BrainLightHalo} from './brain-light-halo'
import {BRAIN_LAUNCHER_POSITION_KEY,parseBrainLauncherPosition,
  brainLauncherBounds,brainLauncherPixelPosition,brainLauncherNormalizedPosition,
  brainLauncherSnapToEdge}
  from './brain-launcher-position'
import type {BrainLauncherPosition} from './brain-launcher-position'

export function DraggableBrainLauncher({expanded,onToggle,children}:{
  expanded:boolean;onToggle:()=>void;children:React.ReactNode
}){
  const ref=useRef<HTMLButtonElement|null>(null)
  const [position,setPosition]=useState<BrainLauncherPosition|null>(()=>{
    try{return parseBrainLauncherPosition(localStorage.getItem(BRAIN_LAUNCHER_POSITION_KEY))}
    catch{return null}
  })
  const [area,setArea]=useState({width:0,height:0})
  const [dragging,setDragging]=useState(false)
  const start=useRef({x:0,y:0})
  const ignoreClick=useRef(false)
  useLayoutEffect(()=>{
    // The button is inside .v2-social. The workspace establishes its
    // absolute positioning context; .v2-social is the safe horizontal bound.
    const social=ref.current?.parentElement
    if(!social||!social.classList.contains('v2-social'))return
    const measure=()=>{
      const width=social.clientWidth,height=social.clientHeight
      setArea(prev=>prev.width===width&&prev.height===height?prev:{width,height})
    }
    const observer=new ResizeObserver(measure)
    observer.observe(social)
    measure()
    return()=>observer.disconnect()
  },[])
  const bounds=brainLauncherBounds(area.width,area.height)
  const pixel=brainLauncherPixelPosition(position,bounds)
  const persist=(next:BrainLauncherPosition|null)=>{
    setPosition(next)
    try{
      if(next)localStorage.setItem(BRAIN_LAUNCHER_POSITION_KEY,JSON.stringify(next))
      else localStorage.removeItem(BRAIN_LAUNCHER_POSITION_KEY)
    }catch{}
  }
  const bindDrag=useDrag(({first,last,active,movement:[dx,dy]})=>{
    if(area.width<=0||area.height<=0)return
    if(first)start.current=brainLauncherPixelPosition(position,bounds)
    const moved=Math.abs(dx)>4||Math.abs(dy)>4
    if(moved)ignoreClick.current=true
    if(active&&moved){
      setDragging(true)
      setPosition(brainLauncherNormalizedPosition(
        start.current.x+dx,start.current.y+dy,bounds))
    }
    if(last){
      setDragging(false)
      if(moved)persist(brainLauncherSnapToEdge(brainLauncherNormalizedPosition(
        start.current.x+dx,start.current.y+dy,bounds)))
    }
  },{pointer:{buttons:1,keys:false},filterTaps:true,threshold:5})
  return <button type="button" ref={ref} className="v2-brain-launcher"
    {...bindDrag()} data-dragging={dragging||undefined}
    style={area.width>0?{left:pixel.x,top:pixel.y,right:'auto'}:undefined}
    aria-label={expanded?'收起 AI 侧栏':'打开 AI 侧栏'}
    aria-expanded={expanded} aria-controls="yenra-brain-panel"
    title="单击展开或收起闺蜜大脑；拖动后吸附聊天区边缘；Alt+方向键微调、Alt+Home复位"
    onPointerDownCapture={()=>{ignoreClick.current=false}}
    onKeyDownCapture={event=>{
      if(event.key==='Enter'||event.key===' ')ignoreClick.current=false
    }}
    onKeyDown={event=>{
      if(!event.altKey||area.width<=0)return
      if(event.key==='Home'){
        event.preventDefault()
        persist(null)
        return
      }
      const dx=event.key==='ArrowLeft'?-12:event.key==='ArrowRight'?12:0
      const dy=event.key==='ArrowUp'?-12:event.key==='ArrowDown'?12:0
      if(!dx&&!dy)return
      event.preventDefault()
      persist(brainLauncherNormalizedPosition(pixel.x+dx,pixel.y+dy,bounds))
    }}
    onClick={event=>{
      // Chromium may synthesize a click after releasing pointer capture.
      if(ignoreClick.current){
        ignoreClick.current=false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      onToggle()
    }}>
    <BrainLightHalo expanded={expanded}/>
    <span className="v2-brain-launcher-glyph" aria-hidden="true">{children}</span>
  </button>
}
