/**
 * The one original Brain launcher: theme-adaptive pearl/star Canvas artwork.
 * Colors are sampled from inherited DSH tokens at runtime, never fixed here.
 * CSS owns hit testing and position only; Canvas owns luminous rendering.
 */
import {useEffect,useRef} from 'react'

type RGB=[number,number,number]
const mix=(a:RGB,b:RGB,k:number):RGB=>a.map((n,i)=>
  Math.round(n+(b[i]-n)*k)) as RGB
const rgb=(v:RGB,a=1)=>`rgba(${v[0]},${v[1]},${v[2]},${a})`
const parse=(value:string):RGB|null=>{
  const hex=/^#([a-f\d]{6})$/i.exec(value.trim())
  if(hex)return [0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)) as RGB
  const short=/^#([a-f\d]{3})$/i.exec(value.trim())
  if(short)return [...short[1]].map(c=>parseInt(c+c,16)) as RGB
  const c=/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value)
  if(c)return [Number(c[1]),Number(c[2]),Number(c[3])]
  // Modern Chromium may preserve CSS Color 4 values after an appearance
  // plugin switches to oklch()/display-p3(). Force an sRGB computed sample.
  const linear=/^color\(srgb\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i.exec(value)
  if(linear)return [1,2,3].map(i=>Math.round(Math.max(0,
    Math.min(1,Number(linear[i])))*255)) as RGB
  return null
}

export function BrainLightHalo({expanded}:{expanded:boolean}){
  const canvasRef=useRef<HTMLCanvasElement|null>(null)
  useEffect(()=>{
    const canvas=canvasRef.current
    const button=canvas?.parentElement
    const ctx=canvas?.getContext('2d',{alpha:true})
    if(!canvas||!button||!ctx)return
    button.setAttribute('data-yenra-canvas-ready','true')
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)')
    const side=56
    const probe=document.createElement('span')
    probe.setAttribute('aria-hidden','true')
    probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;'
    button.appendChild(probe)
    const resolved=(token:string)=>{
      probe.style.color=`color-mix(in srgb,var(--yenra-brain-trigger-${token}) 100%,transparent)`
      return parse(getComputedStyle(probe).color)
    }
    let colors:{surface:RGB;accent:RGB;border:RGB;ink:RGB}|null=null
    const sampleColors=()=>{
      const surface=resolved('surface'),accent=resolved('accent')
      const border=resolved('border'),ink=resolved('ink')
      if(surface&&accent&&border&&ink){
        colors={surface,accent,border,ink}
      }else{
        // If a third-party theme has not finished initializing yet, simply
        // wait for its native tokens rather than displaying a fixed palette.
        colors=null
      }
    }
    let raf=0,last=0,lastTheme=-Infinity
    let hovered=false,focused=false,pressedAt=-Infinity
    const onScreen=()=>!document.hidden&&button.isConnected&&
      button.closest<HTMLElement>('[data-yenra-retained-chat]')
        ?.dataset.yenraRetainedVisible!=='false'
    const paint=(time:number)=>{
      ctx.clearRect(0,0,side,side)
      if(!colors)return
      const {surface,accent,border,ink}=colors
      const center=side/2
      const reduced=motion.matches
      const breathe=reduced?0.5:(Math.sin(time*0.00115)+1)/2
      const strength=hovered||focused?1:expanded?0.42:0.70
      const press=Math.max(0,1-(time-pressedAt)/360)
      const radius=expanded?15:17
      ctx.save()
      ctx.translate(center,center)
      // A tiny theme-color halo, not an oversized CSS neon glow.
      const halo=ctx.createRadialGradient(0,0,radius-7,0,0,side/2)
      halo.addColorStop(0,rgb(accent,0))
      halo.addColorStop(.55,rgb(accent,(0.05+0.065*breathe)*strength))
      halo.addColorStop(1,rgb(accent,0))
      ctx.fillStyle=halo
      ctx.fillRect(-center,-center,side,side)

      // Pearl-like dock: fill, rim and shadow are all derived from current
      // theme tokens. Dark themes remain dark; light themes stay soft.
      const shell=ctx.createLinearGradient(-radius,-radius,radius,radius)
      shell.addColorStop(0,rgb(mix(surface,accent,.07)))
      shell.addColorStop(.50,rgb(surface))
      shell.addColorStop(1,rgb(mix(surface,border,.30)))
      ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2)
      ctx.fillStyle=shell
      ctx.shadowColor=rgb(ink,.13*strength)
      ctx.shadowBlur=7
      ctx.shadowOffsetY=1.5
      ctx.fill()
      ctx.shadowBlur=0;ctx.shadowOffsetY=0

      const rim=ctx.createLinearGradient(-radius,-radius,radius,radius)
      rim.addColorStop(0,rgb(mix(border,accent,.65),.90))
      rim.addColorStop(.4,rgb(border,.55))
      rim.addColorStop(1,rgb(mix(border,accent,.4),.82))
      ctx.beginPath();ctx.arc(0,0,radius-.65,0,Math.PI*2)
      ctx.strokeStyle=rim
      ctx.lineWidth=1
      ctx.stroke()

      // Four-point tapered star instead of the old black square plus icon.
      const scale=expanded?0.76:1
      ctx.save();ctx.scale(scale,scale)
      const star=ctx.createLinearGradient(-9,-10,10,11)
      star.addColorStop(0,rgb(mix(accent,surface,.16)))
      star.addColorStop(.45,rgb(mix(accent,ink,.14)))
      star.addColorStop(1,rgb(mix(accent,surface,.27)))
      ctx.beginPath()
      ctx.moveTo(0,-11)
      ctx.bezierCurveTo(1.65,-4.3,3.5,-1.7,10.5,0)
      ctx.bezierCurveTo(3.5,1.7,1.65,4.3,0,11)
      ctx.bezierCurveTo(-1.65,4.3,-3.5,1.7,-10.5,0)
      ctx.bezierCurveTo(-3.5,-1.7,-1.65,-4.3,0,-11)
      ctx.closePath()
      ctx.shadowColor=rgb(accent,(.24+.18*breathe)*strength)
      ctx.shadowBlur=(hovered||focused?7:4)+press*4
      ctx.fillStyle=star
      ctx.fill()
      ctx.shadowBlur=0
      const shine=ctx.createRadialGradient(-1,-2,0,0,0,8)
      shine.addColorStop(0,rgb(surface,.55*strength))
      shine.addColorStop(1,rgb(surface,0))
      ctx.fillStyle=shine
      ctx.fill()
      ctx.restore()
      ctx.restore()
    }
    const render=()=>{
      const now=performance.now()
      sampleColors()
      paint(now)
    }
    const resize=()=>{
      const dpr=Math.min(2.5,Math.max(1,window.devicePixelRatio||1))
      canvas.width=Math.round(side*dpr);canvas.height=Math.round(side*dpr)
      ctx.setTransform(canvas.width/side,0,0,canvas.height/side,0,0)
      render()
    }
    const frame=(time:number)=>{
      raf=0
      if(!onScreen())return
      if(time-lastTheme>=350){sampleColors();lastTheme=time}
      if(time-last>=45){last=time;paint(time)}
      if(!motion.matches)raf=requestAnimationFrame(frame)
    }
    const start=()=>{
      window.cancelAnimationFrame(raf);raf=0
      if(onScreen()){
        render()
        if(!motion.matches)raf=window.requestAnimationFrame(frame)
      }
    }
    const hoverIn=()=>{hovered=true;render()}
    const hoverOut=()=>{hovered=false;render()}
    const focusIn=()=>{focused=true;render()}
    const focusOut=()=>{focused=false;render()}
    const flash=()=>{pressedAt=performance.now();render()}
    const keyFlash=(event:Event)=>{
      if(['Enter',' '].includes((event as KeyboardEvent).key))flash()
    }
    const retained=button.closest<HTMLElement>('[data-yenra-retained-chat]')
    const seatObserver=new MutationObserver(start)
    if(retained)seatObserver.observe(retained,{attributes:true,attributeFilter:['data-yenra-retained-visible']})
    // Theme updates can change root class, data attributes or injected styles.
    const themeObserver=new MutationObserver(start)
    themeObserver.observe(document.documentElement,{attributes:true,
      attributeFilter:['class','style','data-ds-dark-theme','data-ds-theme-source','data-theme']})
    if(document.body)themeObserver.observe(document.body,{attributes:true,
      attributeFilter:['class','style','data-ds-dark-theme','data-ds-theme-source','data-theme']})
    button.addEventListener('pointerenter',hoverIn)
    button.addEventListener('pointerleave',hoverOut)
    button.addEventListener('focus',focusIn)
    button.addEventListener('blur',focusOut)
    button.addEventListener('pointerdown',flash)
    button.addEventListener('keydown',keyFlash)
    window.addEventListener('resize',resize)
    document.addEventListener('visibilitychange',start)
    motion.addEventListener?.('change',start)
    resize();start()
    return()=>{
      window.cancelAnimationFrame(raf)
      button.removeAttribute('data-yenra-canvas-ready')
      probe.remove()
      seatObserver.disconnect();themeObserver.disconnect()
      button.removeEventListener('pointerenter',hoverIn)
      button.removeEventListener('pointerleave',hoverOut)
      button.removeEventListener('focus',focusIn)
      button.removeEventListener('blur',focusOut)
      button.removeEventListener('pointerdown',flash)
      button.removeEventListener('keydown',keyFlash)
      window.removeEventListener('resize',resize)
      document.removeEventListener('visibilitychange',start)
      motion.removeEventListener?.('change',start)
    }
  },[expanded])
  return <canvas ref={canvasRef} aria-hidden="true" width={56} height={56}
    data-yenra-brain-canvas-light=""
    style={{position:'absolute',width:56,height:56,left:'50%',top:'50%',
      transform:'translate(-50%,-50%)',pointerEvents:'none'}}/>
}
