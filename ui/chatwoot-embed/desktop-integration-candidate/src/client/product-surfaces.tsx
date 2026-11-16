/** YENRA product surface composition only.
 * Uses official DSH icon primitives and the existing AppFrame keyed-panel Slot.
 * No memory CRUD, managed execution, sender, telephony, media engine or second state authority.
 * All below-status affordances require a verified owner-supplied contract.
 */
import React from 'react'

const media=[
  {name:'自然语音',desc:'生成、试听、重新生成 · 等待 TTS Tool',kind:'voice'},
  {name:'WhatsApp 语音消息',desc:'原生 PTT，不是 MP3 附件 · 待 Sender 验证',kind:'ptt'},
  {name:'生成照片',desc:'参考照片、人物一致性 · 等待原生 Tool',kind:'photo'},
  {name:'生成视频',desc:'场景短视频与预览 · 等待原生 Tool',kind:'video'},
]
export function MediaSurface({onToggle}:{onToggle?:React.ReactEventHandler<HTMLDetailsElement>}){
  return <details name="yenra-social-tool-menu" className="yenra-media-menu" onToggle={onToggle}>
    <summary aria-label="打开媒体与语音能力"><span aria-hidden="true">✧</span>媒体 <span className="yenra-caret">⌄</span></summary>
    <div className="yenra-media-sheet" role="group" aria-label="媒体与语音能力状态">
      <div className="yenra-media-title">多模态工具 <small>由 DSH Tools 提供</small></div>
      {media.map(m=><div className="yenra-media-row" key={m.kind}>
        <div className="yenra-media-glyph">{m.kind==='voice'||m.kind==='ptt'?<span aria-hidden="true">♫</span>:<span aria-hidden="true">✧</span>}</div>
        <div><strong>{m.name}</strong><small>{m.desc}</small></div><span className="yenra-media-state">未接入</span>
      </div>)}
    </div>
  </details>
}
