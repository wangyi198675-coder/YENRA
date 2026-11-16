/** YENRA controls in the same official DSH AssistantMarkdown rows.
 * Uses the existing conversation.chat.turnTail Slot and its native answer
 * identities. Only moves Adopt/Edit buttons, never copies/hides message text,
 * changes the DSH renderer, or builds a second Composer.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { suggestionsFromText, type AdviceSuggestion } from './advice-bridge'
import { emitBrainTiming } from './brain-timing'
import { isVisibleBrainScope } from './grammar/scope'
import { coversFinalDrafts, createReviewStore, createTurnTimingGuard, grammarLanguage, grammarPlan, parseGrammarReport, parsePanelReview, reviewIdentity, reviewLabel, type GrammarLanguage, type GrammarReview } from './grammar/review'

type NativeAction = { sessionId:SessionId; adopt: (text:string)=>void }
type NativeInput = PropsRuntime<'conversation.chat.turnTail'>['inputActions']
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
function findNativeAnswerRows(scope:HTMLElement,turn:number,replies:AdviceSuggestion[]):HTMLElement[]|null {
 const matches=[...scope.querySelectorAll<HTMLElement>(
   '[data-chat-turn="'+turn+'"][data-chat-group-part="response"]')]
 const nodes=matches.flatMap(root=>[...root.querySelectorAll<HTMLElement>('li,p')])
 const used=new Set<HTMLElement>()
 const mapped:HTMLElement[]=[]
 for(const reply of replies){
   const match=nodes.find(node=>!used.has(node)
     &&node.textContent?.includes(reply.text)
     &&node.textContent?.includes(reply.translation))
   if(!match)return null
   used.add(match);mapped.push(match)
 }
 return mapped.length===replies.length?mapped:null
}

function applyRewrite(inputActions:NativeInput,text:string):void {
 inputActions.setDraft('请把上面这条回复改得更自然、简短一些，并附中文译文：'+text)
 inputActions.persistDraft()
}

/** UI Slot glue for the two buttons already provided by YENRA.
 * Their clickable elements are placed inside DSH's native Markdown <li>/<p>
 * and removed with the official Slot lifecycle. No external portal runtime,
 * custom text renderer, hidden upstream UI or new state database.
 */
function mountInlineActions(targets:HTMLElement[],replies:AdviceSuggestion[],
 inputActions:NativeInput,adopt:(text:string)=>void,review:GrammarReview|null):()=>void {
 const attached:HTMLElement[]=[]
 for(let i=0;i<targets.length;i++){
   const target=targets[i]!
   const option=replies[i]!
   const wrapper=document.createElement('span')
   wrapper.className='yenra-native-reply-inline-tools'
   wrapper.setAttribute('aria-label','第'+(i+1)+'条回复操作')
   for(const entry of [
     {label:'采用',act:()=>adopt(option.text)},
     {label:'修改',act:()=>applyRewrite(inputActions,option.text)},
   ]){
     const button=document.createElement('button')
     button.type='button'
     button.textContent=entry.label
     button.setAttribute('aria-label',entry.label+'第'+(i+1)+'条回复')
     button.addEventListener('click',entry.act)
     wrapper.appendChild(button)
   }
   if(i===0&&review){
     const status=document.createElement('small')
     status.className='yenra-native-reply-grammar'
     status.textContent=reviewLabel(review)
     if(review.details)status.title=review.details
     wrapper.appendChild(status)
   }
   target.appendChild(wrapper)
   attached.push(wrapper)
 }
 return ()=>attached.forEach(el=>el.remove())
}

function ReplyActions({turn,useChat,inputActions,adopt,sessionId}:PropsRuntime<'conversation.chat.turnTail'> & InjectFace<NativeAction>){
 const closing=useChat(snapshot=>
   snapshot.nodes.turnDataSource(Number(turn.turn),'turn-tail').getSnapshot().at(-1)?.closing)
 const endTime=useChat(snapshot=>snapshot.legacy.turnTimings.get(Number(turn.turn))?.endTime)
 const latestTurn=useChat(snapshot=>snapshot.navigation.items().at(-1)?.turn===Number(turn.turn))
 const body=closing?.blocks.flatMap(block=>block.kind==='text'?[block.text]:[]).join('')??''
 const replies=useMemo(()=>suggestionsFromText(body),[body])
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
 const [inline,setInline]=useState(false)
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
   if(!drafts.length||!latestTurn||!end||Date.now()-end>120000||!active){setReview(null);return}
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

 useLayoutEffect(()=>{
   if(!replies?.length||!scope||!active){setInline(false);return}
   const targets=findNativeAnswerRows(scope,Number(turn.turn),replies)
   if(!targets){setInline(false);return}
   const dispose=mountInlineActions(targets,replies,inputActions,adopt,review)
   setInline(true)
   return ()=>{dispose()}
 },[body,turn.turn,replies,inputActions,adopt,review,scope,active])

 // Stable local anchor prevents cross-session same-turn DOM matches. Hidden Work
 // never mounts actions or starts grammar, while native text stays untouched.
 return <div ref={anchor} style={{display:'contents'}}>
 {replies?.length&&active&&!inline?<div className="yenra-native-reply-candidates" data-yenra-reply-candidates="" aria-label="回复候选操作">
   {review&&<small className="yenra-native-reply-grammar" title={review.details??''}>{reviewLabel(review)}</small>}
   {replies.map((option,i)=><div className="yenra-native-reply-actions" key={option.id} data-yenra-reply-option={i+1}>
     <span className="yenra-native-reply-head">{String(i+1).padStart(2,'0')} · {option.style}</span>
     <button type="button" onClick={()=>adopt(option.text)} aria-label={'采用第'+(i+1)+'条回复'}>采用</button>
     <button type="button" onClick={()=>applyRewrite(inputActions,option.text)} aria-label={'修改第'+(i+1)+'条回复'}>修改</button>
   </div>)}
 </div>:null}
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
       !text.includes('最近真实对话：'))return undefined
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
   }),
 },ReplyActions))
}
