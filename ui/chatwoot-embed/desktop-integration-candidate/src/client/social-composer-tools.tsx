/** ChatScope 2.1.1 native InputToolbox composition for the social draft editor.
 * Emoji engine: emoji-picker-react@4.22.3 (MIT; stable v4 API).
 * No channel Sender, recording service, translator, uploader or second Composer.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDismissOnOutsidePointer } from '../../../../upstream/official-source/packages/client/ui-primitives/src/useDismissOnOutsidePointer'
import { Button } from '@chatscope/chat-ui-kit-react'
import EmojiPickerModule from 'emoji-picker-react'
import { MediaSurface } from './product-surfaces'
// emoji-picker-react 4.22.3 exposes a nested default in this DSH CJS bundle.
// Resolve the existing component only; do not implement another picker.
const EmojiPicker = ((EmojiPickerModule as unknown as {default?: typeof EmojiPickerModule}).default ?? EmojiPickerModule) as React.ComponentType<any>

export function SocialComposerTools({onEmoji,hasLocalFile,colorScheme}:{
  onEmoji:(value:string)=>void;
  hasLocalFile:boolean;
  colorScheme:'light'|'dark';
}){
  const [emojiOpen,setEmojiOpen]=useState(false)
  const [detailsOpen,setDetailsOpen]=useState(false)
  const toolbarRef=useRef<HTMLDivElement|null>(null)
  const emojiAnchorRef=useRef<HTMLDivElement|null>(null)

  // Reuse the official DSH outside-pointer hook for all existing local
  // menus. Native <details name> handles exclusivity; no overlay engine.
  const closeDetails=useCallback(()=>{
    toolbarRef.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail=>{detail.open=false})
    setDetailsOpen(false)
  },[])
  const syncDetails=useCallback(()=>{
    const opened=toolbarRef.current?.querySelector('details[open]')!==null
    setDetailsOpen(opened)
    if(opened)setEmojiOpen(false)
  },[])
  useDismissOnOutsidePointer(toolbarRef,detailsOpen,closeDetails)
  useDismissOnOutsidePointer(emojiAnchorRef,emojiOpen,setEmojiOpen)
  // Listen during the entire toolbar lifetime (capture phase) so even an
  // immediate Escape after a click dismisses the opened native details before
  // other DSH conversation key handlers can consume the key.
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        closeDetails()
        setEmojiOpen(false)
      }
    }
    document.addEventListener('keydown',onKeyDown,true)
    return()=>document.removeEventListener('keydown',onKeyDown,true)
  },[closeDetails])
  return <>
    <div className="yenra-composer-toolbar" ref={toolbarRef}>
      <div className="yenra-emoji-anchor" ref={emojiAnchorRef}>
        <Button type="button" className="yenra-tool-action" aria-label="选择表情" aria-expanded={emojiOpen}
          onClick={()=>{closeDetails();setEmojiOpen(open=>!open)}} icon={<span aria-hidden="true">☺</span>}>表情</Button>
        {emojiOpen?<div className="yenra-emoji-pop" data-yenra-emoji-picker="open">
          <EmojiPicker width={300} height={290} theme={colorScheme} previewConfig={{showPreview:false}}
            onEmojiClick={emoji=>{onEmoji(emoji.emoji);setEmojiOpen(false)}}/>
        </div>:null}
      </div>
      <details name="yenra-social-tool-menu" className="yenra-composer-tool-status" onToggle={syncDetails}>
        <summary aria-label="语音录制和生成状态">♫ <span>语音</span></summary>
        <div className="yenra-composer-tool-pop" role="status">
          <strong>语音能力未接入</strong>
          <span>原生录音、TTS 试听及 WhatsApp PTT 均由现有专项和唯一 Sender 接入；当前不会录音或发送普通音频附件。</span>
        </div>
      </details>
      <details name="yenra-social-tool-menu" className="yenra-composer-tool-status" onToggle={syncDetails}>
        <summary aria-label="ChatGPT 翻译状态">文 <span>翻译</span></summary>
        <div className="yenra-composer-tool-pop" role="status">
          <strong>ChatGPT 翻译待接入</strong>
          <span>需要复用现有翻译 Tool 和 W25 缓存。当前不会悄悄改写草稿，也不产生额外模型调用。</span>
        </div>
      </details>
      <MediaSurface onToggle={syncDetails}/>
      <span className="yenra-composer-tool-hint" aria-live="polite">{hasLocalFile?'附件暂存 · 未外发':'仅演示草稿 · 未连接 Sender'}</span>
    </div>
  </>
}
