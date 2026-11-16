/**
 * Reads registered original DSH-IM Socket authorization via the existing
 * YENRA Host's strictly read-only scoped projection. No new Socket, account
 * registry, Sender, poller or stale management HTTP RPC dependency.
 */
export type NativeWhatsAppAccount={
  accountRef:string
  name:string|null
  maskedNumber:string|null
  connected:boolean
  state:'connected'|'connecting'|'offline'|'error'|'unknown'
  lastCheckedAt:number|null
  errorCode:string|null
  errorMessage:string|null
}
export type NativeWhatsAppHealth={
  phase:'checking'|'ready'|'error'
  accounts:NativeWhatsAppAccount[]
  problem:string|null
}
const ACCOUNT_ID=/^[A-Za-z0-9_-]{1,128}$/
const HASH=/^[a-f0-9]{32}$/
const validText=(value:unknown,max=160)=>
  typeof value==='string'&&value.trim()?value.trim().slice(0,max):null
const object=(value:unknown):Record<string,unknown>|null=>
  value!==null&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:null

export async function originalWhatsappAccountRef(botId:string,cryptoApi:Crypto=crypto){
  if(!ACCOUNT_ID.test(botId))throw Error('INVALID_ORIGINAL_DSH_IM_BOT_ID')
  const bytes=new TextEncoder().encode('WA-account:'+botId)
  const buffer=await cryptoApi.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(buffer)).map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,32)
}

/** Current source is the Host's existing DSH-IM registered Socket service.
 * Its old /api/dsh-im/whatsapp management route now returns HTTP 404; do
 * not infer disconnection from that obsolete URL or from cached contacts.
 */
export async function readOriginalWhatsappHealth(fetchImpl:typeof fetch=fetch):
 Promise<NativeWhatsAppHealth>{
 const response=await fetchImpl('/api/yenra/social-read?mode=connection-status',{
   method:'GET',signal:AbortSignal.timeout(7000),cache:'no-store',
 })
 if(!response.ok)throw Error('原 DSH-IM Socket 状态不可读（HTTP '+response.status+'）')
 const raw:unknown=await response.json()
 const body=object(raw)
 if(body?.ok!==true||body.source!=='ORIGINAL_DSH_IM_SINGLE_SOCKET'||
    !Array.isArray(body.accounts)||body.accounts.length>12)
   throw Error('原 DSH-IM Socket 状态回应无效')
 const accounts:NativeWhatsAppAccount[]=[]
 const seen=new Set<string>()
 for(const item of body.accounts){
   const record=object(item)
   if(!record||typeof record.accountRef!=='string'||!HASH.test(record.accountRef)||
      seen.has(record.accountRef)||typeof record.connected!=='boolean'||
      !['connected','offline','unknown'].includes(String(record.state))||
      (record.connected&&record.state!=='connected')||
      (!record.connected&&record.state==='connected'))
      throw Error('原 DSH-IM Socket 账号状态不可信')
   seen.add(record.accountRef)
   const state=record.state as NativeWhatsAppAccount['state']
   accounts.push({accountRef:record.accountRef,name:null,maskedNumber:null,
      connected:record.connected,state,lastCheckedAt:null,
      errorCode:state==='unknown'?'SOCKET_STATUS_UNAVAILABLE':null,
      errorMessage:null})
 }
 return {phase:'ready',accounts,problem:null}
}

export function displayOriginalAccountState(
 account:NativeWhatsAppAccount|undefined,phase:NativeWhatsAppHealth['phase'],
):{label:string;problem:string|null}{
 if(phase==='checking')return {label:'正在检查',problem:null}
 if(phase==='error')return {label:'状态暂不可读',problem:'原 DSH-IM Socket 状态接口暂不可读'}
 if(!account)return {label:'未核验',problem:'账号名册存在，但原 DSH-IM 未返回该账号的运行状态'}
 if(account.state==='unknown')return {label:'状态未核验',problem:'当前原生 Socket 状态检查失败，不能判断是否断线'}
 if(account.connected)return {label:'已连接',problem:null}
 if(account.state==='connecting')return {label:'连接中',problem:null}
 if(account.state==='error')return {
   label:'连接异常',
   problem:account.errorMessage??account.errorCode??'原 DSH-IM 检测到连接异常',
 }
 return {label:'未连接',problem:account.errorMessage??null}
}

export type VerifiedOwnAccountProfile={
  accountRef:string
  displayName:string|null
  ownPhone:string|null
}

/** Identity from the same authenticated original DSH Host; never use any
 * contact's phone/avatar as the current logged-in owner's identity.
 */
export async function readOriginalOwnAccountProfile(
 accountRef:string,fetchImpl:typeof fetch=fetch,
):Promise<VerifiedOwnAccountProfile>{
 if(!HASH.test(accountRef))throw Error('INVALID_VERIFIED_ACCOUNT_REF')
 const response=await fetchImpl(
   '/api/yenra/social-read?mode=profile&accountRef='+encodeURIComponent(accountRef),
   {method:'GET',cache:'no-store',signal:AbortSignal.timeout(7000)})
 if(!response.ok)throw Error('ORIGINAL_ACCOUNT_PROFILE_UNAVAILABLE')
 const raw:unknown=await response.json()
 const body=object(raw)
 if(body?.ok!==true||body.accountRef!==accountRef)
   throw Error('UNVERIFIED_ORIGINAL_ACCOUNT_PROFILE')
 return {
   accountRef,
   displayName:validText(body.displayName,100),
   ownPhone:typeof body.ownPhone==='string'&&/^\+[0-9]{5,15}$/.test(body.ownPhone)
     ?body.ownPhone:null,
 }
}
