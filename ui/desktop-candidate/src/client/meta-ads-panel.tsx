import React, {useState} from 'react'
import type {Context as ClientContext} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

const META_ADS='https://adsmanager.facebook.com/adsmanager/manage/ads'
const META_BILLING='https://business.facebook.com/latest/billing_hub/payment_settings/'

// Presentation-only launchers for the ORIGINAL Meta website in DSH's ORIGINAL
// browser tab. No iframe, credentials, payment handling, Marketing API, Ads
// management API, cookie copying, new Electron window or YENRA browser engine.
export function makeMetaAdsPanel(host:ClientContext){
  return function MetaAdsPanel(){
    const [message,setMessage]=useState('')
    const openOfficial=(url:string,label:string)=>{
      // DSH Browser belongs to an ON-SCREEN native Session. The standalone
      // Meta launcher itself has no Session and cannot own browser tabs.
      // Return to the EXISTING native Conversation first, never create one.
      const nativeBrowser=host.sidebarRight
      if(!nativeBrowser){
        window.open(url,'_blank','noopener,noreferrer')
        setMessage('原生浏览器不可用，已交给系统浏览器打开 Meta 官方页面。')
        return
      }
      host.layout.selectPanel(null)
      window.requestAnimationFrame(()=>{
        try{
          if(!nativeBrowser.mounted.getSnapshot())throw Error('DSH_SESSION_NOT_MOUNTED')
          nativeBrowser.openTab('browser',{params:{url},revealIfOpened:true})
        }catch{
          // Meta login remains in the official browser's own trusted session.
          // If DSH has no selected Session, use the authenticated OS browser.
          window.open(url,'_blank','noopener,noreferrer')
        }
      })
    }
    const apps=[
      {id:'ads',label:'广告管理器',description:'查看、创建、编辑广告系列、广告组和广告，管理预算与投放表现。',url:META_ADS},
      {id:'billing',label:'账单与支付',description:'查看付款活动、余额、账单及支付设置。付款仍由 Meta 官方页面处理。',url:META_BILLING},
    ] as const
    return <main aria-label="Meta 广告管理" data-yenra-meta-management="" style={{
      display:'flex',flexDirection:'column',height:'100%',minWidth:0,overflow:'auto',
      padding:'clamp(16px,3vw,32px)',background:'var(--dsw-alias-bg-base)',
      color:'var(--dsw-alias-label-primary)',gap:22
    }}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <div><h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700}}>广告管理</h1>
        <p style={{margin:0,color:'var(--dsw-alias-label-secondary)',fontSize:13}}>直接使用 Meta 官方广告管理器与支付设置，不经过 SendPulse。</p></div>
        <button type="button" onClick={()=>host.layout.selectPanel('yenra-desktop-chat')}
          style={{border:'1px solid var(--dsw-alias-border-l2)',borderRadius:10,padding:'9px 13px',background:'var(--dsw-alias-bg-layer-1)',color:'inherit',cursor:'pointer'}}>返回聊天</button>
      </header>
      <section aria-label="Meta 官方管理入口" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,300px),1fr))',gap:16}}>
        {apps.map(app=><article key={app.id} style={{border:'1px solid var(--dsw-alias-border-l2)',borderRadius:14,padding:20,background:'var(--dsw-alias-bg-layer-1)',display:'flex',flexDirection:'column',gap:12}}>
          <h2 style={{fontSize:17,margin:0}}>{app.label}</h2>
          <p style={{fontSize:13,lineHeight:1.6,margin:0,color:'var(--dsw-alias-label-secondary)',minHeight:44}}>{app.description}</p>
          <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
            <button type="button" aria-label={'在 DSH 浏览器打开'+app.label} onClick={()=>openOfficial(app.url,app.label)}
              style={{padding:'10px 14px',borderRadius:9,border:0,background:'var(--dsw-alias-brand-primary)',color:'var(--dsw-alias-bg-base)',cursor:'pointer'}}>在 YENRA 内打开</button>
            <button type="button" aria-label={'在系统浏览器打开'+app.label} onClick={()=>window.open(app.url,'_blank','noopener,noreferrer')}
              style={{padding:'10px 14px',borderRadius:9,border:'1px solid var(--dsw-alias-border-l2)',background:'var(--dsw-alias-bg-layer-2)',color:'inherit',cursor:'pointer'}}>在系统浏览器打开</button>
          </div>
        </article>)}
      </section>
      <p role="status" style={{color:'var(--dsw-alias-label-secondary)',fontSize:13,margin:0}}>{message}</p>
      <p style={{color:'var(--dsw-alias-label-tertiary)',fontSize:12,margin:0}}>Meta 页面自行处理登录、广告投放和付款。DSH 原生浏览器与 Chrome 的登录状态可能不共享；如果 Meta 要求重新验证，可使用已经登录的系统浏览器。</p>
    </main>
  }
}
