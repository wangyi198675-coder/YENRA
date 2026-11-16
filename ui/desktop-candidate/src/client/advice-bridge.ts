/** Thin text-format adapter only. Persona owns identity and output voice.
 * Official DSH systemPrompt.section owns generation rules for Brain Sessions.
 */
export type AdviceSuggestion = {id:string;style:string;text:string;translation:string}
const defaults=['','',''] as const
export const OPUS_ROUTE={provider:'openrouter',model:'anthropic/claude-opus-5.5'} as const
export const ADVICE_MARKER='YENRA_ADVICE_V1'

export function suggestionPrompt(contact:{name:string;label:string;intro:string;translation:string}):string {
  return [
    '为当前联系人准备回复建议。',
    `联系人：${contact.name}（${contact.label}）`,
    `最近真实对话：\n${contact.intro}`,
    contact.translation?`对方最近消息中文（仅供理解）：${contact.translation}`:'',
    '沿用当前原生 DSH Session 的 Yeonhee 完整人格及记忆，给出三条有实际内容差异、可直接发送的私人自然回复，不使用固定风格。',
    '使用对方语言；每条附中文译文供主人理解，按 1、2、3 分别对应外文和中文。',
  ].filter(Boolean).join('\n')
}

function stripMarkdown(value:string):string {
  return value.trim().replace(/^[-*>\s]+/u,'').replace(/\*\*|\*/gu,'').trim().replace(/^[“"]|[”"]$/gu,'')
}
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
    // Standard native DSH Markdown: bold numbered heading followed by one
    // original-language line and one translation line. No second chat renderer.
    for(let i=0;i<lines.length;i++){
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
