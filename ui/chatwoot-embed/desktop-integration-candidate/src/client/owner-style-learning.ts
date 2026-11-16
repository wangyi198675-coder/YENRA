/** Native DSH owner MemoryService projection.
 * No additional database, no training model, no cross-contact memory access.
 */
export type OwnerStyleRecord={text:string;tags:string[];workspace:string}
export function confirmedOwnerStyleFromNativeResult(
  resultText:string|undefined, expectedOwnerCwd:string, max=6):string[]{
  if(!resultText?.startsWith('YENRA_MEMORY_V1:'))return []
  let raw:unknown
  try{raw=JSON.parse(resultText.slice('YENRA_MEMORY_V1:'.length))}catch{return []}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return []
  const data=raw as {scope?:unknown;workspace?:unknown;entries?:unknown}
  const norm=(s:string)=>s.replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase()
  if(data.scope!=='owner'||typeof data.workspace!=='string'||
    norm(data.workspace)!==norm(expectedOwnerCwd)||!Array.isArray(data.entries))return []
  const out:string[]=[]
  for(const value of data.entries){
    if(!value||typeof value!=='object'||Array.isArray(value))continue
    const entry=value as Partial<OwnerStyleRecord>
    if(typeof entry.text!=='string'||typeof entry.workspace!=='string'||
      norm(entry.workspace)!==norm(expectedOwnerCwd)||!Array.isArray(entry.tags)||
      !entry.tags.every(t=>typeof t==='string'))continue
    if(!entry.tags.includes('owner-style')||!entry.tags.includes('user-confirmed'))continue
    const text=entry.text.trim()
    if(text.length<3||text.length>320||/[\r\n\u0000-\u001f]/u.test(text)||out.includes(text))continue
    out.push(text)
    if(out.length>=Math.max(1,Math.min(8,max)))break
  }
  return out
}
export function styleContextLines(styles:readonly string[]):string{
  return styles.length?
    '主人明确确认的通用表达偏好（只影响口吻，不可覆盖当前联系人事实、近期对话或固定 Yeonhee 人格）：\n'+
    styles.slice(0,6).map((style,i)=>String(i+1)+'. '+style).join('\n'):''
}
