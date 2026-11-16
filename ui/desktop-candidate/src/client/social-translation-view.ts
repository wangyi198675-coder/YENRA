/** Strict display decoder for native DSH scoped translation command.
 * Translations are sidecars to the ORIGINAL ChatScope message, never the message source.
 */
export const TRANSLATION_PREFIX='YENRA_TRANSLATION_V1:'
export type TranslateDirection='to-zh'|'to-de'
export type TranslationRequest={
  channel:'WhatsApp'|'Personal'|'Page';accountRef:string;roomRef:string;direction:TranslateDirection
  items:Array<{id:string;text:string;legacyId?:string}>
  chatwoot?:{accountId:number;conversationId:number;inboxId:number;messageId:number}
}
export type TranslationResult={
  accountRef:string;roomRef:string;direction:TranslateDirection;cached:boolean
  items:Array<{id:string;translation:string}>
}
export const messageTranslationKey=(account:string,room:string,mid:string,text:string)=>
  account+':'+room+':msg:'+mid+':'+text
export const previewTranslationKey=(account:string,room:string,text:string)=>
  account+':'+room+':preview:'+text
export const needsChineseTranslation=(text:string)=>Boolean(text?.trim())&&
  /[a-zA-ZäöüÄÖÜß]/.test(text)&&!/[\u4e00-\u9fff]{3,}/.test(text)
export function parseTranslationResult(text:string|undefined,request:TranslationRequest):TranslationResult{
  if(!text?.startsWith(TRANSLATION_PREFIX))throw Error('原生 DSH 翻译结果不存在')
  let result:unknown
  try{result=JSON.parse(text.slice(TRANSLATION_PREFIX.length))}catch{throw Error('译文格式无效')}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('译文无效')
  const value=result as Record<string,unknown>
  if(value.accountRef!==request.accountRef||value.roomRef!==request.roomRef||
    value.direction!==request.direction||typeof value.cached!=='boolean'||
    !Array.isArray(value.items)||value.items.length!==request.items.length)
    throw Error('翻译账号/房间/方向不匹配')
  const got=new Map<string,string>()
  for(const r of value.items){
    if(!r||typeof r!=='object'||Array.isArray(r))throw Error('译文条目无效')
    const o=r as Record<string,unknown>
    if(typeof o.id!=='string'||typeof o.translation!=='string'||!o.translation.trim()||got.has(o.id))
      throw Error('译文内容无效')
    got.set(o.id,o.translation)
  }
  if(request.items.some(x=>!got.has(x.id)))throw Error('译文 ID 不匹配')
  return value as TranslationResult
}
