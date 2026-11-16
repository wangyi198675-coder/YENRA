/**
 * ChatLume archive rule: Cloud's original messages are exportable even when
 * the optional original DSH read-only translation cache is unavailable.
 * This code must NEVER trigger a model or modify Cloud/DSH storage.
 */
type Row={
  id?:unknown;message_type?:unknown;private?:boolean;
  content?:unknown;savedZh?:unknown
}
type CacheResponse={
  mode?:unknown;conversationId?:unknown;
  items?:Array<{id?:unknown;translation?:unknown}>
}
type ReadCache=(ids:number[])=>Promise<CacheResponse>
const zh=(value:unknown):value is string=>
  typeof value==='string'&&/[\u3400-\u9fff]/u.test(value)
const eligible=(row:Row):boolean=>
  (row.message_type===0||row.message_type===1)&&row.private!==true&&
  Number.isSafeInteger(row.id)&&Number(row.id)>0&&
  typeof row.content==='string'&&row.content.trim().length>0&&
  /\p{L}/u.test(row.content)&&row.content.length<=1200&&
  !zh(row.content)&&!zh(row.savedZh)
export async function restoreSavedTranslationsForChatLume({
  rows,conversationId,readCache,signal,onProgress=()=>{}
}:{
  rows:Row[];conversationId:number;readCache:ReadCache;
  signal:AbortSignal;onProgress?:(done:number,total:number)=>void
}):Promise<{missingCount:number;cacheUnavailable:boolean}>{
  const needed=rows.filter(eligible)
  const byId=new Map(needed.map(row=>[Number(row.id),row]))
  const ids=[...byId.keys()]
  let cacheUnavailable=false
  for(let i=0;i<ids.length;i+=30){
    if(signal.aborted)throw signal.reason??Error('导出已取消')
    onProgress(Math.min(i+30,ids.length),ids.length)
    const page=ids.slice(i,i+30)
    try{
      const reply=await readCache(page)
      if(reply.mode!=='cached'||reply.conversationId!==conversationId||
        !Array.isArray(reply.items)||reply.items.length>page.length)
        throw Error('DSH 缓存查询版本不匹配')
      const allowed=new Set(page),seen=new Set<number>()
      for(const item of reply.items){
        const id=Number(item.id)
        if(!allowed.has(id)||seen.has(id))throw Error('DSH 译文消息 ID 不匹配')
        seen.add(id)
      }
      if(signal.aborted)throw signal.reason??Error('导出已取消')
      for(const item of reply.items){
        const row=byId.get(Number(item.id))
        if(row&&zh(item.translation)&&
          item.translation.trim()!==String(row.content).trim())
          row.savedZh=item.translation.trim()
      }
    }catch(error){
      if(signal.aborted)throw error
      // Cache is optional: retain Cloud's original and saved translations.
      // Do not invoke model=export or retry paid model providers.
      cacheUnavailable=true
      break
    }
  }
  return {missingCount:needed.filter(row=>!zh(row.savedZh)).length,
    cacheUnavailable}
}
