/** YENRA controls in the same official DSH AssistantMarkdown rows.
 * Uses the official conversation.chat.turnTail Slot and native answer identities.
 * React owns Adopt/Edit/Regenerate buttons for current and historical turns.
 * changes the DSH renderer, or builds a second Composer.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { suggestionsFromText, diagnoseAdviceChoices, isNativeBrainAdvicePrompt, canRecoverNativeAdvice, type AdviceSuggestion } from './advice-bridge'
import { emitBrainTiming } from './brain-timing'
import { isVisibleBrainScope } from './grammar/scope'
import { coversFinalDrafts, createReviewStore, createTurnTimingGuard, grammarLanguage, grammarPlan, parseGrammarReport, parsePanelReview, reviewIdentity, reviewLabel, shouldProofreadCurrentAdvice, type GrammarLanguage, type GrammarReview } from './grammar/review'

type NativeAction = { sessionId:SessionId; adopt: (text:string)=>void; modify:(text:string)=>void; regenerate:()=>void }
// Bounded in-memory final-draft identities + reports, never persisted or logged.
const proofreads=createReviewStore()
const firstTurnTiming=createTurnTimingGuard()

// This is only a thin DSH UI Slot -> original MCP Client adapter.
// The actual rules, grammar models, and corrections belong to OSS LanguageTool.
async function checkWithNativeLanguageTool(sessionId:SessionId,text:string,language:GrammarLanguage,signal:AbortSignal):Promise<GrammarReview>{
 const requestJson=JSON.stringify({serverName:'yenra_de_grammar',
   toolName:'mcp__yenra_de_grammar__check_text',
   argsJson:JSON.stringify({language,text})})
 const response=await fetch('/api/mcpPanel/callTool',{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({type:'client-request',
     rpcId:'yenra-grammar-slot-'+Date.now()+'-'+Math.random().toString(36).slice(2),
     method:'mcpPanel/callTool',payload:{args:{requestJson,sessionId}}}),
   signal})
 if(!response.ok)throw Error('原生校对工具不可用')
 return parsePanelReview(await response.json())
}

// The native DSH assistant node identifies the owning turn and answer.
// Only exact original + translation pairs may receive the two actions.
export function ReplyActions({turn,useChat,inputActions,adopt,modify,regenerate,sessionId}:PropsRuntime<'conversation.chat.turnTail'> & InjectFace<NativeAction>){
 const closing=useChat(snapshot=>
   snapshot.nodes.turnDataSource(Number(turn.turn),'turn-tail').getSnapshot().at(-1)?.closing)
 const endTime=useChat(snapshot=>snapshot.legacy.turnTimings.get(Number(turn.turn))?.endTime)
 const latestTurn=useChat(snapshot=>snapshot.navigation.items().at(-1)?.turn===Number(turn.turn))
 // A native Brain Session can also have unrelated manual conversation turns.
 // Only official YENRA advice prompts may expose the recovery action.
 const adviceTurn=useChat(snapshot=>snapshot.nodes.turnDataSource(Number(turn.turn),'user').getSnapshot()
   .some(message=>message.content.some(block=>block.type==='text'&&isNativeBrainAdvicePrompt(block.text))))
 // DSH Memory and tool turns may follow a valid reply before the owner reads it.
 // Surface only a just-finished suggestion; older suggestions stay collapsed.
 const completedAt=endTime?(endTime<1e11?endTime*1000:endTime):0
 const recentReply=completedAt>0&&Date.now()>=completedAt&&Date.now()-completedAt<120000
 const body=closing?.blocks.flatMap(block=>block.kind==='text'?[block.text]:[]).join('')??''
 const replies=useMemo(()=>suggestionsFromText(body),[body])
 const choiceIssues=useMemo(()=>diagnoseAdviceChoices(replies??[]),[replies])
 const drafts=useMemo(()=>replies?.map(reply=>reply.text)??[],[replies])
 // ToolResultNode's content/isError are the native contract (not just a success
 // transport bit). Parse it with the SAME function as the panel fallback.
 const nativeGrammarRoot=useChat(snapshot=>snapshot.nodes.turnDataSource(Number(turn.turn),'tool-call').getSnapshot()
   .filter(call=>call.root.name==='mcp__yenra_de_grammar__check_text'&&coversFinalDrafts(call.root.args.value('text'),drafts)).at(-1)?.root??null)
 const nativeReview=useMemo(()=>nativeGrammarRoot&&'kind' in nativeGrammarRoot&&nativeGrammarRoot.kind==='tool-result'
   ?nativeGrammarRoot.isError?null:parseGrammarReport(nativeGrammarRoot.content):null,[nativeGrammarRoot])
 const anchor=useRef<HTMLDivElement>(null)
 const [scope,setScope]=useState<HTMLElement|null>(null)
 const [active,setActive]=useState(false)
 const canRecover=canRecoverNativeAdvice({parsedCount:replies?.length??0,
   active,latestTurn,hasClosing:!!closing,hasBody:!!body.trim(),adviceTurn})
 const finalKey=useMemo(()=>reviewIdentity(String(sessionId),Number(turn.turn),drafts,grammarLanguage(drafts)),[sessionId,turn.turn,drafts])
 const [reviewSnapshot,setReviewSnapshot]=useState<{key:string;review:GrammarReview|null}|null>(null)
 const review=reviewSnapshot?.key===finalKey?reviewSnapshot.review:null
 useLayoutEffect(()=>{
   const pane=anchor.current?.closest<HTMLElement>('.v2-native-chat-pane')??null
   setScope(pane)
   const update=()=>setActive(isVisibleBrainScope(pane,String(sessionId),document.visibilityState))
   update()
   if(!pane)return
   const observer=new MutationObserver(update)
   for(let node:HTMLElement|null=pane;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['data-yenra-brain-session','data-yenra-brain-active','hidden','aria-hidden','inert']})
   document.addEventListener('visibilitychange',update)
   return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update)}
 },[sessionId])
 useLayoutEffect(()=>{
   if(!active||!latestTurn||!body.trim()||!isVisibleBrainScope(scope,String(sessionId),document.visibilityState))return
   const end=endTime&&endTime<1e11?endTime*1000:endTime
   if(end&&Date.now()-end>120000)return
   // This Slot exposes the finalized native closing body, not streaming tokens.
   if(firstTurnTiming(String(sessionId),Number(turn.turn),'first-render'))
     emitBrainTiming(String(sessionId),'first-render',{turn:Number(turn.turn)})
   if(end&&(drafts.length===3||drafts.length===1)&&firstTurnTiming(String(sessionId),Number(turn.turn),'replies-complete'))
     emitBrainTiming(String(sessionId),'replies-complete',{turn:Number(turn.turn),count:drafts.length})
 },[active,latestTurn,body,scope,sessionId,turn.turn,endTime,drafts])
 useEffect(()=>{
   const setReview=(value:GrammarReview|null)=>setReviewSnapshot({key:finalKey,review:value})
   const end=endTime&&endTime<1e11?endTime*1000:endTime
   // A still-visible current suggestion does not expire after 120 seconds.
   // The first-render timing gate remains short-lived; the local LanguageTool
   // review can be recovered asynchronously without any model or Sender call.
   if(!shouldProofreadCurrentAdvice(drafts.length,latestTurn,active,end)){setReview(null);return}
   let live=true,release=()=>{},pendingTimer:ReturnType<typeof setTimeout>|undefined
   const started=performance.now()
   const report=(done:GrammarReview)=>{
     if(!live||!isVisibleBrainScope(scope,String(sessionId),document.visibilityState))return
     setReview(done)
     emitBrainTiming(String(sessionId),done.phase==='complete'?'grammar-complete':done.phase==='timeout'?'grammar-timeout':'grammar-unavailable',
       {turn:Number(turn.turn),count:done.issues??0,durationMs:performance.now()-started})
   }
   const state=!nativeGrammarRoot?'none':!('kind' in nativeGrammarRoot)?'pending':nativeGrammarRoot.isError?'failed':'report'
   const plan=grammarPlan(state)
   if(plan==='native'&&nativeReview){report(nativeReview);return()=>{live=false}}
   const fallback=()=>{
     if(!live||!isVisibleBrainScope(scope,String(sessionId),document.visibilityState))return
     const language=grammarLanguage(drafts)
     const lease=proofreads.acquire(reviewIdentity(String(sessionId),Number(turn.turn),drafts,language),
       signal=>checkWithNativeLanguageTool(sessionId,drafts.join('\n\n'),language,signal))
     release=lease.release
     emitBrainTiming(String(sessionId),lease.cached?'grammar-cache-hit':'grammar-start',{turn:Number(turn.turn),count:drafts.length})
     void lease.promise.then(report)
   }
   setReview({phase:'checking'})
   // A native deadline is NOT failure and cannot authorize a duplicate MCP.
   // Only an actually failed result (or no matching call) permits fallback.
   if(plan==='wait')pendingTimer=setTimeout(()=>{
     if(grammarPlan(state,true)==='timeout')report({phase:'timeout'})
   },12000)
   else if(plan==='fallback')fallback()
   return()=>{live=false;clearTimeout(pendingTimer);release()}
 },[sessionId,turn.turn,drafts,latestTurn,nativeGrammarRoot,nativeReview,endTime,active,scope,finalKey])

 // The original DSH answer remains in its native Session and can be read
 // from the expandable source below. Only its finalized THREE-pair rendering
 // is replaced visually with independent reply rows in this official Slot.
 useLayoutEffect(()=>{
   if(!replies?.length||!scope||!active)return
   const node=scope.querySelector<HTMLElement>(
     '[data-chat-turn="'+Number(turn.turn)+'"][data-chat-group-part="response"]')
   const original=node?.querySelector<HTMLElement>(
     ':scope > [data-slot="conversation.chat.node"] > div > div')
   if(!original)return
   const wasHidden=original.hidden
   original.hidden=true
   node?.setAttribute('data-yenra-structured-reply','')
   return()=>{original.hidden=wasHidden;node?.removeAttribute('data-yenra-structured-reply')}
 },[replies,scope,active,turn.turn])

 return <div ref={anchor} style={{display:'contents'}}>
 {replies?.length&&active&&!latestTurn?<details className="yenra-native-reply-source yenra-native-reply-history" defaultOpen={recentReply}>
   <summary>{recentReply?'本次回复建议':'过往回复建议'}（{replies.length} 条）</summary>
   {replies.map((option,i)=><div key={option.id} className="yenra-native-reply-history-entry">
     <strong>{i+1}.</strong> <span>{option.text}</span>
     <p lang="zh-CN">{option.translation}</p>
     {choiceIssues[i]?.duplicateOf!==null&&choiceIssues[i]?.duplicateOf!==undefined?
       <small role="status">与第 {choiceIssues[i]!.duplicateOf!+1} 条基本相同，可修改或重新生成</small>:null}
     {choiceIssues[i]?.multipleQuestions?<small>这条有多个问句，建议先修改</small>:null}
     <div className="yenra-native-reply-buttons" data-yenra-reply-history-option={i+1}>
       <button type="button" disabled={choiceIssues[i]?.duplicateOf!==null&&choiceIssues[i]?.duplicateOf!==undefined} onClick={()=>adopt(option.text)} aria-label={'采用历史第'+(i+1)+'条回复'}>采用</button>
       <button type="button" onClick={()=>modify(option.text)} aria-label={'修改历史第'+(i+1)+'条回复'}>修改</button>
       <button type="button" onClick={regenerate} aria-label="重新生成三条回复建议">重新生成</button>
     </div>
   </div>)}
 </details>:null}
 {canRecover?<section
    className="yenra-native-reply-candidates yenra-native-reply-invalid"
    data-yenra-reply-invalid="" role="status"
    aria-label="本轮 AI 回复建议不完整">
    <p>本轮建议缺少可确认的外文与中文译文配对，暂不能安全采用</p>
    <div className="yenra-native-reply-buttons">
      <button type="button" onClick={regenerate} aria-label="重新生成完整的三条双语回复建议">重新生成三条建议</button>
    </div>
  </section>:null}
 {replies?.length&&active&&latestTurn?<section className="yenra-native-reply-candidates" data-yenra-reply-candidates=""
   aria-label="当前联系人 AI 回复建议">
   {review&&<small className="yenra-native-reply-grammar" title={review.details??''}>{reviewLabel(review)}</small>}
   {replies.map((option,i)=><article className="yenra-native-reply-actions" key={option.id} data-yenra-reply-option={i+1}>
     <strong className="yenra-native-reply-head">{String(i+1).padStart(2,'0')}</strong>
     <p className="yenra-native-reply-original">{option.text}</p>
     <p className="yenra-native-reply-translation" lang="zh-CN">{option.translation}</p>
     {choiceIssues[i]?.duplicateOf!==null&&choiceIssues[i]?.duplicateOf!==undefined?
       <small role="status">与第 {choiceIssues[i]!.duplicateOf!+1} 条基本相同，可修改或重新生成</small>:null}
     {choiceIssues[i]?.multipleQuestions?<small>这条有多个问句，建议先修改</small>:null}
     <div className="yenra-native-reply-buttons">
       <button type="button" disabled={choiceIssues[i]?.duplicateOf!==null&&choiceIssues[i]?.duplicateOf!==undefined} onClick={()=>adopt(option.text)} aria-label={'采用第'+(i+1)+'条回复'}>采用</button>
       <button type="button" onClick={()=>modify(option.text)} aria-label={'修改第'+(i+1)+'条回复'}>修改</button>
       <button type="button" onClick={regenerate} aria-label="重新生成三条回复建议">重新生成</button>
     </div>
   </article>)}
   <details className="yenra-native-reply-source"><summary>查看本次 AI 完整原文</summary><pre>{body.slice(0,6000)}</pre></details>
 </section>:null}
 </div>
}
export function installNativeReplyCards(ctx:ClientContext):void {
 // First-party DSH UserText presentation rule: only the automatic contact
 // context is summarized in the UI. The original text remains intact in the
 // official Session and reaches the model unchanged. Manual conversation is
 // always rendered through the native unmodified user-text component.
 ctx.effect(()=>ctx.uiConversation.userText.register({
   id:'yenra:automatic-reply-summary',order:-1000,
   match(text,from){
     if(from!==0||!text.startsWith('为当前联系人准备回复建议。\n联系人：')||
       (!text.includes('最近真实对话：')&&!text.includes('之前的真实对话：')))return undefined
     const name=/^联系人：([^\n（]{1,80})/mu.exec(text)?.[1]?.trim()
     if(!name)return undefined
     return {id:'text',start:0,end:text.length,
       data:{text,display:name+' · 回复建议'}}
   },
 }), 'YENRA native short automatic-reply status')
 ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({
   name:'conversation.chat.turnTail',id:'yenra.native.reply-actions',
   inject:(sessionId:SessionId):NativeAction=>({
     sessionId,
     adopt:(text:string)=>{
       if(typeof text!=='string'||!text.trim()||text.length>2000)return
       document.dispatchEvent(new CustomEvent('yenra-brain-adopt',{detail:{sessionId,text}}))
     },
     modify:(text:string)=>{
       if(typeof text!=='string'||!text.trim()||text.length>2000)return
       document.dispatchEvent(new CustomEvent('yenra-brain-modify',{detail:{sessionId,text}}))
     },
     regenerate:()=>document.dispatchEvent(new CustomEvent('yenra-brain-regenerate',{detail:{sessionId}})),
   }),
 },ReplyActions))
}
