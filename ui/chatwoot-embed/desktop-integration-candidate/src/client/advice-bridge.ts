/** Thin text-format adapter only. Persona owns identity and output voice.
 * Official DSH systemPrompt.section owns generation rules for Brain Sessions.
 */
export type AdviceSuggestion = {id:string;style:string;text:string;translation:string}
const defaults=['','',''] as const

import { BERLIN_TIME_ZONE, berlinHour } from './berlin-welcome.ts'

/** Keep both ends of a long verified incoming message. In real chats the
 * question is often at the end; taking only the first 600 chars loses it.
 * Pure bounded presentation; no new database, agent, model or prompt rules.
 */
export function boundedLatestIncoming(text:string,maxCharacters=600):string {
  const value=text.trim()
  const limit=Math.max(12,Math.floor(maxCharacters))
  const chars=Array.from(value)
  if(chars.length<=limit)return value
  const separator=' … '
  const available=limit-Array.from(separator).length
  const lead=Math.floor(available*0.56)
  return chars.slice(0,lead).join('').trimEnd()+
    separator+chars.slice(-(available-lead)).join('').trimStart()
}

/** Preserve complete speaker turns in the existing 4,800-char history
 * budget. A raw string.slice(-4800) can begin mid-name or mid-sentence.
 * Most recent turns take priority; never create or infer chat messages.
 */
export function boundedAdviceHistory<T extends {direction:string;text:string}>(
  messages:readonly T[],perMessage=180,maxCharacters=4800,
):string {
  const rows=messages.map(message=>{
    const text=message.text.trim()
    if(!text)return ''
    const who=message.direction==='OUTBOUND'?'我：':'对方：'
    return who+boundedLatestIncoming(text,perMessage)
  }).filter(Boolean)
  const chosen:string[]=[]
  let size=0
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i]!
    const extra=row.length+(chosen.length?1:0)
    if(size+extra>maxCharacters)break
    chosen.unshift(row)
    size+=extra
  }
  return chosen.join('\n')
}

/** Correlate one ORIGINAL DSH manual reply request to its exact native
 * turn/end. The official Client passes requestId to session.prompt(), and the
 * Host echoes it in user/message.source.rpcId. No custom queue or timer.
 *
 * observedTurn can be retained by a subscriber after the source event pages
 * out of the live event window. Other/older turns cannot release this lock.
 */
export function nativeReplyRequestOutcome(
  events:readonly {type:string;data:unknown}[],
  requestId:string,
  observedTurn:number|undefined=undefined,
):{turn:number|undefined;reason:string|null} {
  let activeTurn:number|undefined
  let targetTurn=observedTurn
  for(const event of events){
    const data=event.data&&typeof event.data==='object'
      ?event.data as Record<string,unknown>:null
    if(event.type==='turn/start'&&typeof data?.turn==='number')
      activeTurn=data.turn
    if(event.type==='user/message'){
      const source=data?.source&&typeof data.source==='object'
        ?data.source as Record<string,unknown>:null
      if(source?.kind==='user'&&source.rpcId===requestId)
        targetTurn=activeTurn
    }
    if(event.type==='turn/end'&&targetTurn!==undefined&&data?.turn===targetTurn){
      const reason=data.reason&&typeof data.reason==='object'
        ?data.reason as Record<string,unknown>:null
      return {turn:targetTurn,reason:typeof reason?.kind==='string'?reason.kind:'unknown'}
    }
  }
  return {turn:targetTurn,reason:null}
}

/** An authoritative Berlin clock for Yeonhee's natural replies.
 * Do not use the owner's computer timezone. IANA Europe/Berlin automatically
 * observes CET/CEST and the incoming timestamp must also be converted.
 */
export function berlinReplyTimeContext(lastIncomingAt?:number, now:Date=new Date()):string {
  const zone=BERLIN_TIME_ZONE
  const format=new Intl.DateTimeFormat('zh-CN',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
    timeZoneName:'short',
  })
  const hour=berlinHour(now)
  const period=hour<5?'凌晨':hour<11?'早上':hour<17?'白天':hour<22?'晚上':'深夜'
  const messages=[
    '柏林当地现在（Europe/Berlin）：'+format.format(now)+'（'+period+'）。',
  ]
  const stamp=Number(lastIncomingAt)
  if(Number.isFinite(stamp)&&stamp>0){
    const millis=stamp<1e11?stamp*1000:stamp
    const date=new Date(millis)
    if(Number.isFinite(date.getTime())&&millis>=946684800000&&
      millis<=now.getTime()+5*60*1000)
      messages.push('对方最近来信（柏林）：'+format.format(date)+'。')
  }
  messages.push('时间仅供理解语境；根据当前柏林时间决定是否需要问候，不必刻意提到时间。')
  return messages.join('\n')
}

export const NATURAL_CHAT_REPLY_GUIDANCE='即时聊天语感：简短回复不必机械地添加句末句号；通常最多一个自然问题，能回应就不连环反问。'
export const THREE_REPLY_DISTINCT_INTENT_GUIDANCE='三条建议须有不同交流意图，不只是换词重复。'
export const ADVICE_FORMAT_TAIL='使用对方语言，每条附中文译文供主人理解；用 1、2、3 对应每条回复与译文（例如「1. 外文回复 | 中文：译文」）。'

export function suggestionPrompt(contact:{name:string;label:string;intro:string;translation:string;latestIncoming?:string;lastIncomingAt?:number},now:Date=new Date()):string {
  return [
    '为当前联系人准备回复建议。',
    `联系人：${contact.name}（${contact.label}）`,
    berlinReplyTimeContext(contact.lastIncomingAt,now),
    `之前的真实对话：\n${contact.intro}`,
    contact.latestIncoming?.trim()?`对方最新来信：${contact.latestIncoming.trim()}`:'',
    contact.translation?`最近来信译文（仅供理解）：${contact.translation}`:'',
    '沿用 DSH 当前 Session 的完整 Yeonhee 人格和记忆，给出三条真正不同、能直接发送的自然回复。内容与表达由当前对话决定，不预设风格。',
    NATURAL_CHAT_REPLY_GUIDANCE,
    THREE_REPLY_DISTINCT_INTENT_GUIDANCE,
    ADVICE_FORMAT_TAIL,
  ].filter(Boolean).join('\n')
}

/** Identify only original YENRA Brain advice turns before exposing a recovery
 * action in the native DSH view. This is a UI-scope check, NOT authorization
 * to send, fetch contacts or skip Host Cloud identity verification.
 * A contact's quoted text containing one of these words must not qualify.
 */
export function isNativeBrainAdvicePrompt(text:string):boolean {
  const input=text.trimStart()
  return input.startsWith('为当前联系人准备回复建议。')||
    (input.startsWith('针对当前联系人刚才的来信，换一个')&&
      input.includes('重新给出三条自然回复'))
}

/** Finished, current, verified native advice is recoverable even if its
 * original turn completed minutes or hours before the owner returned.
 * The current Host always revalidates selected contact and latest inbound.
 */
export function canRecoverNativeAdvice(
  params:{parsedCount:number;active:boolean;latestTurn:boolean;
    hasClosing:boolean;hasBody:boolean;adviceTurn:boolean},
):boolean {
  return params.parsedCount===0&&params.active&&params.latestTurn&&
    params.hasClosing&&params.hasBody&&params.adviceTurn
}

/** A manual action can reuse native DSH history only if this exact, trusted
 * inbound message was already submitted by automatic advice in this Session.
 * Browser conversation content alone never authorizes skipping context.
 */
function trustedNativeAdviceOriginLine(text:string):string|null {
  if(!text.startsWith('为当前联系人准备回复建议。'))return null
  // A contact may send text containing newlines that look like source markers.
  // The Host-authored marker is immediately after the LAST fixed format line,
  // never inside the earlier quoted Cloud history.
  const anchor='\n'+ADVICE_FORMAT_TAIL+'\n'
  const location=text.lastIndexOf(anchor)
  if(location>=0)return text.slice(location+anchor.length).split('\n',1)[0]??null
  // Early Cloud Page native suggestions used a different output-format tail
  // but still appended the original Host-issued numeric conversation/MID as
  // the FINAL line. Only that exact terminal form is admissible; quoting an
  // alleged marker in the contact's earlier conversation cannot authorize it.
  if(!text.includes('\n联系人：'))return null
  const last=text.split('\n').at(-1)??''
  return /^Cloud Page 来源消息 [1-9]\d{0,17}\/[1-9]\d{0,17}$/u.test(last)
    ?last:null
}
export function nativeAdviceHasOrigin(prompts:readonly string[],originMarker:string):boolean {
  return prompts.some(text=>trustedNativeAdviceOriginLine(text)===originMarker)
}

/** Manual actions must inspect the original DSH Session's older event pages,
 * not mistake a tail-only EventWindow for an empty contact history.
 * No new cache/Agent or content authority: the callbacks use Session.loadOlder.
 * null means contact changed during the read and the caller must not prompt.
 */
export async function findNativeAdviceOriginInSessionHistory(
  marker:string|null,
  source:{
    readPrompts:()=>readonly string[]
    hasMore:()=>boolean
    entryCount:()=>number
    loadOlder:()=>Promise<unknown>
    stillSelected:()=>boolean
  },
  maxPages=8,
):Promise<boolean|null> {
  if(!source.stillSelected())return null
  if(marker===null)return false
  let found=nativeAdviceHasOrigin(source.readPrompts(),marker)
  let pages=0
  while(!found&&source.hasMore()){
    if(!source.stillSelected())return null
    if(pages++>=maxPages)throw Error('MANUAL_REPLY_NATIVE_HISTORY_NOT_VERIFIED')
    const count=source.entryCount()
    await source.loadOlder()
    if(!source.stillSelected())return null
    found=nativeAdviceHasOrigin(source.readPrompts(),marker)
    if(!found&&source.hasMore()&&source.entryCount()<=count)
      throw Error('MANUAL_REPLY_NATIVE_HISTORY_PAGE_STALLED')
  }
  return found
}

/** The official DSH Session already keeps earlier prompts and turns.
 * Only relay messages added since the latest previously submitted origin
 * marker in this same native Session. Missing/rotated native history falls
 * back to the original bounded Cloud window, never a second cache.
 */
export function historySinceLastNativeAdvice<T>(
  messages:readonly T[],nativeUserPrompts:readonly string[],originPrefix:string,
  idOf:(message:T)=>string,
):{history:readonly T[];continuesSession:boolean} {
  const prior=messages.slice(-31,-1)
  const recordedIds=new Set<string>()
  for(const prompt of nativeUserPrompts){
    const marker=trustedNativeAdviceOriginLine(prompt)
    if(!marker?.startsWith(originPrefix))continue
    const value=marker.slice(originPrefix.length).trim()
    if(value&&value.length<=256&&!/\s/u.test(value))recordedIds.add(value)
  }
  for(let i=prior.length-1;i>=0;i--){
    if(recordedIds.has(idOf(prior[i]!)))
      return {history:prior.slice(i+1),continuesSession:true}
  }
  return {history:prior,continuesSession:false}
}

function stripMarkdown(value:string):string {
  return value.trim().replace(/^[-*>\s]+/u,'').replace(/\*\*|\*/gu,'').trim().replace(/^[“"]|[”"]$/gu,'')
}
/** Preserve the actual model text for Adopt/Edit. The thin parser must not
 * silently turn natural pauses into grammatical sentence fragments.
 * Native DSH Session text and the Chinese translation stay unchanged.
 */
export function suggestionsFromText(text:string):AdviceSuggestion[]|null {
  const lines=text.split(/\r?\n/u)
  const oldRows: {number?:number;style?:string;text:string;translation:string}[]=[]
  for(const line of lines){
    const m=/^\s*(?:([1-3])[.、)．]\s*)?(?:(版本[一二三]|温柔自然|简洁自信|幽默自然|俏皮轻松|温柔体贴|独立知性|修改版)[：:]\s*)?(.+?)\s*[｜|]\s*(?:译文|中文译文|中文|ZH)[：:]\s*(.+?)\s*$/u.exec(line)
    if(m)oldRows.push({number:m[1]?Number(m[1]):undefined,style:m[2],text:stripMarkdown(m[3]||''),translation:stripMarkdown(m[4]||'')})
  }
  let rows=oldRows
  if(!rows.length){
    rows=[]
    // The actual DSH/CCv3 answer can present three numbered "选项" with
    // a foreign reply and its "中文含义" in separate Markdown bullets.
    // Extract ONLY the two source fields, not the model's extra analysis.
    const optionHeads=[...text.matchAll(/^\s*(?:#{1,5}\s*)?(?:\*{0,2})?选项([一二三123])[：:]\s*([^\n]*)/gmu)]
    if(optionHeads.length===3){
      const indices:Record<string,number>={一:1,二:2,三:3,'1':1,'2':2,'3':3}
      const parsed=optionHeads.map((head,i)=>{
        const chunk=text.slice((head.index??0)+head[0].length,
          i+1<optionHeads.length?optionHeads[i+1]!.index:text.length)
        const original=/^\s*(?:[-*]\s*)?\*{0,2}(?:德语|意大利语|英语|原文|Deutsch|Italiano|English)[：:]\*{0,2}\s*(.+?)\s*$/imu.exec(chunk)
        const translated=/^\s*(?:[-*]\s*)?\*{0,2}(?:中文含义|中文译文|中文|译文)[：:]\*{0,2}\s*(.+?)\s*$/gmu.exec(chunk)
        return {number:indices[head[1]??''],style:stripMarkdown(head[2]||'').slice(0,25),
          text:stripMarkdown(original?.[1]||''),translation:stripMarkdown(translated?.[1]||'')}
      })
      if(parsed.every(x=>x.number&&x.text&&x.translation))rows=parsed
    }
    // Standard native DSH Markdown: bold numbered heading followed by one
    // original-language line and one translation line. No second chat renderer.
    if(!rows.length)for(let i=0;i<lines.length;i++){
      const heading=/^\s*(?:#{1,3}\s*)?\*{0,2}([1-3])[.、)．]\s*(自然简洁|温柔克制|轻松俏皮)\*{0,2}\s*$/u.exec(lines[i]||'')
      if(!heading)continue
      const next=lines.slice(i+1,i+5).map(x=>x.trim()).filter(Boolean)
      const original=/^(?:原文|德语|英语)[：:]\s*(.+?)\s*$/u.exec(next[0]||'')
      const translation=/^(?:译文|中文)[：:]\s*(.+?)\s*$/u.exec(next[1]||'')
      if(original&&translation)rows.push({number:Number(heading[1]),style:heading[2],
        text:stripMarkdown(original[1]||''),translation:stripMarkdown(translation[1]||'')})
    }
    if(!rows.length)for(let i=0;i<lines.length;i++){
      const header=/^\s*([1-3])[.、)．]\s*\*{0,2}(版本[一二三]|温柔自然|简洁自信|幽默自然|俏皮轻松|温柔体贴|独立知性)\*{0,2}[：:]\s*(.+?)\s*$/u.exec(lines[i]||'')
      if(!header)continue
      const after=lines.slice(i+1).find(x=>x.trim())||''
      const translation=/^\s*(?:[-*>]\s*)?\*{0,2}(?:译文|中文译文|中文|ZH)\*{0,2}[：:]\s*(.+?)\s*$/u.exec(after)
      if(!translation)continue
      rows.push({number:Number(header[1]),style:header[2],text:stripMarkdown(header[3]||''),translation:stripMarkdown(translation[1]||'')})
    }
    if(!rows.length)for(let i=0;i<lines.length;i++){
      // New native Markdown rows don't repeat "版本一 / 二 / 三" inside
      // the prose. Numbered list order already identifies the candidate.
      const original=/^\s*([1-3])[.、)．]\s*(?:(?:原文|德语|英语)[：:]\s*)?(.+?)\s*$/u.exec(lines[i]||'')
      if(!original)continue
      const following=lines.slice(i+1).find(x=>x.trim())||''
      const translated=/^\s*(?:[-*>]\s*)?(?:译文|中文)[：:]\s*(.+?)\s*$/u.exec(following)
      if(translated)rows.push({number:Number(original[1]),text:stripMarkdown(original[2]||''),translation:stripMarkdown(translated[1]||'')})
    }
    if(!rows.length)for(let i=0;i<lines.length;i++){
      // Claude commonly writes a numbered Markdown style heading, then the
      // actual reply and its translation on separate lines. Keep native
      // DSH Markdown unchanged and recover its existing per-reply actions.
      const heading=/^\s*([1-3])[.、)．]\s*\*{0,2}(温柔|独立|俏皮|自然温柔|独立有趣|轻松俏皮|温柔克制|自然简洁|温柔体贴|独立知性)\*{0,2}\s*$/u.exec(lines[i]||'')
      if(!heading)continue
      const next=lines.slice(i+1,i+5).map(line=>line.trim()).filter(Boolean)
      const original=next[0]||''
      const translated=/^(?:[-*>]\s*)?(?:译文|中文译文|中文)[：:]\s*(.+?)\s*$/u.exec(next[1]||'')
      if(original&&translated&&!/^(?:译文|中文)[：:]/u.test(original))
        rows.push({number:Number(heading[1]),style:heading[2],text:stripMarkdown(original),
          translation:stripMarkdown(translated[1]||'')})
    }
    if(!rows.length)for(const line of lines){
      // Explicit owner-requested three suggestions may be formatted as
      // compact one-line style + original + translation by a real model.
      const compact=/^\s*(?:[1-3][.、)．]\s*)?(自然温柔|独立有趣|轻松俏皮|温柔|独立|俏皮)\s+(.+?)\s+(?:译文|中文译文|中文)[：:]\s*(.+?)\s*$/u.exec(line)
      if(compact)rows.push({style:compact[1],text:stripMarkdown(compact[2]||''),
        translation:stripMarkdown(compact[3]||'')})
    }
    if(!rows.length){
      // Mature DSH Markdown accepts model headings like "**建议 1**" and
      // "**Reply 1:**", followed by a bilingual pair. This is presentation
      // mapping only: the original native message and Sender stay unchanged.
      for(let i=0;i<lines.length;i++){
        const head=/^\s*\*{0,2}(?:建议|Reply)\s*([1-3])\s*(?:[:：])?\*{0,2}\s*$/iu.exec(lines[i]||'')
        if(!head)continue
        let original='',translation=''
        for(let j=i+1;j<Math.min(i+9,lines.length);j++){
          const next=(lines[j]||'').trim()
          if(!next||/^[-—]{3,}$/u.test(next))continue
          if(/^\s*\*{0,2}(?:建议|Reply)\s*[1-3]/iu.test(next))break
          const translated=/^\s*\*{0,2}(?:中文译文|译文)\s*[:：]\*{0,2}\s*(.*)$/u.exec(next)
          if(translated){
            translation=stripMarkdown(translated[1]||'')
            if(!translation)translation=stripMarkdown(lines.slice(j+1).find(x=>x.trim())||'')
            break
          }
          if(!original)original=stripMarkdown(next)
        }
        if(original&&translation&&/[\u4e00-\u9fff]/u.test(translation))
          rows.push({number:Number(head[1]),text:original,translation})
      }
    }
    if(!rows.length){
      // The real flagship model may omit optional numbers and style tags.
      // Three foreign|Chinese pairs are structurally complete by themselves.
      const compactLines=lines.map(line=>line.trim()).filter(Boolean)
      if(compactLines.length===3){
        const parsed=compactLines.map(line=>{
          const match=/^(?:[1-3][.、)．]\s*)?(.+?)\s*[|｜]\s*(?:中文|中文译文|译文|ZH)[：:]\s*(.+?)\s*$/u.exec(line)
          return match?{text:stripMarkdown(match[1]||''),translation:stripMarkdown(match[2]||'')}:null
        })
        if(parsed.every((value):value is {text:string;translation:string}=>
          Boolean(value?.text&&value.translation)))
          rows=parsed as {text:string;translation:string}[]
      }
    }
    if(!rows.length){
      // Native DSH/CCv3 can return three natural Markdown paragraphs with
      // inline bilingual pairs and no fixed style headings or numbering.
      // This is display-only extraction for the existing Adopt/Edit Slot:
      // neither persona, Session, model routing nor message history changes.
      const paragraphs=text.trim().split(/\r?\n\s*\r?\n/u).map(p=>p.trim()).filter(Boolean)
      if(paragraphs.length===3){
        const extracted=paragraphs.map(paragraph=>{
          const m=/^(.+?)\s+(?:译文|中文译文|中文)[：:]\s*(.+?)\s*$/su.exec(paragraph.replace(/\r?\n/gu,' '))
          return m?{text:stripMarkdown(m[1]||''),translation:stripMarkdown(m[2]||'')}:null
        })
        if(extracted.every((value):value is {text:string;translation:string}=>
          Boolean(value?.text&&value.translation&&/[\u4e00-\u9fff]/u.test(value.translation))))
          rows=extracted as {text:string;translation:string}[]
      }
    }
    if(!rows.length){
      // Native DSH sometimes omits the optional '原文：' label on an edit.
      // A complete two-line foreign reply + Chinese translation is still one
      // actionable revision, not an instruction to create another Composer.
      const one=/^\s*(?:(?:外文|德语|英语|原文)[：:]\s*)?(.+?)\s*\n\s*(?:译文|中文)[：:]\s*(.+?)\s*$/u.exec(text.trim())
      if(one)rows=[{style:'修改版',text:stripMarkdown(one[1]||''),translation:stripMarkdown(one[2]||'')}]
    }
  }
  if(![1,3].includes(rows.length)||rows.some((x,i)=> (x.number!==undefined&&x.number!==i+1)||!x.text||!x.translation||!/[\u3400-\u9fff]/u.test(x.translation)||/[\u3400-\u9fff]/u.test(x.text)))return null
  return rows.map((x,i)=>({id:`reply-${i+1}`,style:x.style??(rows.length===1?'修改版':defaults[i]),text:x.text,translation:x.translation}))
}
