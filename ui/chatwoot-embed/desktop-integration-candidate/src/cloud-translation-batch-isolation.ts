/** Translate only already authorized Cloud MIDs. Never use this for contact/privacy verification. */
export function isNonLinguisticCloudText(text:string):boolean{
 const value=text.trim()
 return !/\p{L}/u.test(value)||
  (/^[\p{L}\p{N}_-]{2,28}$/u.test(value)&&
   /\p{N}/u.test(value)&&/\p{L}/u.test(value))
}
export async function translateCloudBatchIsolated<T extends {id:string;text:string}>(
 rows:readonly T[],
 translate:(batch:T[])=>Promise<Map<string,string>>,
 signal:AbortSignal,
):Promise<{translations:Map<string,string>;failedIds:string[]}>{
 const translations=new Map<string,string>()
 const failures=new Set<string>()
 let attempts=0
 const budget=Math.max(1,Math.min(15,rows.length*2-1))
 const visit=async(batch:T[]):Promise<void>=>{
  if(!batch.length)return
  if(signal.aborted)throw signal.reason??Error('TRANSLATION_CANCELLED')
  if(attempts>=budget){for(const item of batch)failures.add(item.id);return}
  try{
   attempts++
   const values=await translate(batch)
   const missing:T[]=[]
   for(const item of batch){
    const translation=values.get(item.id)
    if(typeof translation==='string'&&/[\u3400-\u9fff]/u.test(translation))
     translations.set(item.id,translation)
    else missing.push(item)
   }
   if(!missing.length)return
   if(missing.length===batch.length)throw Error('MODEL_BATCH_NO_VALID_ITEMS')
   await visit(missing)
  }catch(error){
   if(signal.aborted)throw signal.reason??error
   if(batch.length===1){failures.add(batch[0].id);return}
   const half=Math.ceil(batch.length/2)
   await visit(batch.slice(0,half))
   await visit(batch.slice(half))
  }
 }
 await visit([...rows])
 return {translations,failedIds:[...failures]}
}
