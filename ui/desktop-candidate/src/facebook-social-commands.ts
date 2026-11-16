/** YENRA thin Host adapter: pre-existing mature Matrix/mautrix and Pancake SDK.
 * No second social Socket, server, credential database, Agent, Sender or Composer.
 * Source authorizations remain the existing Windows-protected account stores.
 * All browser inputs are Host-issued refs; never raw provider IDs or tokens.
 */
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Readable } from 'node:stream'
import { existsSync, mkdirSync, realpathSync, symlinkSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {createExistingFacebookMediaSendBridge} from '../../../social-adapters/oss-candidates/existing-facebook-media-send-bridge.mjs'
import {createOriginalPageRequestReads} from './original-page-request-reads.mjs'
import {readOwnerVerifiedPageAvatar} from './owner-verified-page-avatar.js'
import {createOriginalPageIdentityHints} from './original-page-identity-hints.mjs'
import {createSendPulseOfficialReader} from '../../../social-adapters/sendpulse-bridge/sendpulse-official-reader.mjs'
import {readVerifiedSendPulsePageFallback} from '../../../social-adapters/sendpulse-bridge/sendpulse-page-fallback.mjs'
import {mergeVerifiedPageHistoricalPreviews} from '../../../social-adapters/w25-readonly/verified-page-roster-preview.mjs'
import {defineDomain,domainTable} from '../../../upstream/official-source/packages/storage/storage-domain/src/spec.ts'
import {z} from '../../../upstream/official-source/packages/storage/storage-domain/node_modules/zod/index.js'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'

import {installedYenraRoot,isTrustedNativeWorkspace} from './trusted-native-workspace.ts'
const ROOT=installedYenraRoot()
const PREFIX='YENRA_FACEBOOK_V1:'
const sha=(text:string)=>createHash('sha256').update(text).digest('hex').slice(0,32)
const norm=(text:string|undefined)=>(text??'').replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase()
const error=(message:string)=>({kind:'error' as const,text:message})
const okay=(data:unknown)=>({kind:'success' as const,text:PREFIX+JSON.stringify(data)})
const REF=/^[a-f0-9]{32}$/
// Existing source-checkout users may keep their original mature SDK in a
// sibling per-user legacy workspace. A clean friend install uses packaged SDK.
const legacyStateRoot=ROOT?join(ROOT,'..','YanceV2','HarnessNativeWindows','state'):''
const legacyPageDir=legacyStateRoot?
  join(legacyStateRoot,'profiles','web','node_modules','@yance','v2-pancake-page','lib'):''
// The installed mature Page SDK follows the CURRENT user's official DSH Home.
// A clean Windows installation has no YENRA source checkout, so never gate
// package resolution on the developer's repository being present.
const dshHome=process.env.DSH_HOME&&isAbsolute(process.env.DSH_HOME)?process.env.DSH_HOME:''
const portablePageDir=dshHome?join(dshHome,'profiles','desktop','node_modules','@yance','v2-pancake-page','lib'):''
// The same vetted original SDK code ships beside the YENRA plugin. This
// avoids requiring the friend's machine to contain the owner's old SDK tree.
const packagedPageDir=fileURLToPath(new URL('./pancake-sdk/lib/',import.meta.url))
const pageSdkDir=portablePageDir&&existsSync(join(portablePageDir,'account-store.js'))?portablePageDir:
  existsSync(join(packagedPageDir,'account-store.js'))?packagedPageDir:
  legacyPageDir&&existsSync(join(legacyPageDir,'account-store.js'))?legacyPageDir:''
const LEGACY_PAGE=pageSdkDir?pathToFileURL(pageSdkDir).href.replace(/\/?$/u,'/'):'file:///YENRA_PAGE_SDK_NOT_INSTALLED/'
const nativeModuleUrl=(relative:string)=>ROOT?pathToFileURL(join(ROOT,relative)).href:'file:///YENRA_PROJECT_ROOT_UNAVAILABLE'
// Reuse the same original mautrix-meta/Matrix read adapter on every device.
// The source-tree path remains the CURRENT owner upgrade's first choice; a
// clean install uses the byte-identical plugin resource instead. Neither
// resource contains an account token, a Matrix database or its local bridge.
const ownerPersonalReader=ROOT?join(ROOT,'docs/handoff/FB_PERSONAL_W56_LEGACY/Worktrees/W56_FB_PERSONAL_NATIVE_LOGIN_20261028/connectors/mautrix-meta/native/official-matrix-inbox.mjs'):''
const packagedPersonalReader=fileURLToPath(new URL('./personal-matrix/official-matrix-inbox.mjs',import.meta.url))
const LEGACY_PERSONAL=ownerPersonalReader&&existsSync(ownerPersonalReader)?pathToFileURL(ownerPersonalReader).href:
  existsSync(packagedPersonalReader)?pathToFileURL(packagedPersonalReader).href:
  'file:///YENRA_ORIGINAL_PERSONAL_MATRIX_READER_NOT_INSTALLED'
const PAGE_PROJECTION=nativeModuleUrl('social-adapters/w25-readonly/projection.mjs')
const PERSONAL_SENDER=nativeModuleUrl('docs/handoff/FB_PERSONAL_W56_LEGACY/HarnessNativeWindows/extensions/v2-messenger-send.mjs')
const PAGE_SENDER=LEGACY_PAGE+'native-page-manual-send.mjs'
// Keep installed mature modules external: their scripts/assets resolve next to their ORIGINAL package.
const loadMatureModule=(path:string):Promise<any>=>import(path)
const SANDBOX=ROOT||dshHome?join(ROOT||dshHome,'runtime','page-dpapi-host-view'):''
const ALIAS=join(SANDBOX,'YanceV2','PancakePage')
const legacyProtectedPage=legacyStateRoot?join(legacyStateRoot,'protected-page-bridge'):''
const userProtectedPage=process.env.APPDATA?join(process.env.APPDATA,'YanceV2','PancakePage'):''
const SECRET=legacyProtectedPage&&existsSync(join(legacyProtectedPage,'accounts-v2.dpapi'))?
  legacyProtectedPage:userProtectedPage
const PAGE_ACCOUNT_FILE=join(SECRET,'accounts-v2.dpapi')
const LIST_LIMIT=500
// Source-verified Page identity hints in the existing official DSH Storage Domain.
// No tokens, message bodies, additional Sender or permission authority.
const pageIdentitySpec=defineDomain({name:'yenra_page_verified_identity_hints',version:1,
 layout:'per-record',invalidRecords:'backup-and-skip',
 tables:{entries:domainTable(z.object({
  accountRef:z.string(),pageId:z.string(),accountName:z.string(),
  revision:z.number(),savedAt:z.number(),rows:z.array(z.object({
   roomId:z.string(),conversationId:z.string(),customerFromId:z.string(),
   displayName:z.string(),pageId:z.string(),accountName:z.string(),
   bindingRevision:z.string(),channel:z.literal('FB_PAGE'),
   source:z.literal('PANCAKE_OFFICIAL_READ_ONLY'),
   readOnly:z.literal(true),canSend:z.literal(false),
   lastMessageTimestamp:z.number()
  }))
 }))},
})
let pageHints:ReturnType<typeof createOriginalPageIdentityHints>|undefined
type Row={roomRef:string;name:string|null;nameKnown:boolean;lastMessageAt:number|null;messageCount:number;latestText:string|null;providerPeerKind:string;contactPreferences?:{pinned:boolean;muted:boolean;archived:boolean;manualUnread:boolean}}
type Account={channel:'Personal'|'Page';accountRef:string;displayId?:string;accountLabel?:string;source:'YENRA_FB_OFFICIAL';readOnly:true;canSend:false;partial:boolean;updatedAt:null;rooms:Row[]}
type Room={schema:1;channel:'Personal'|'Page';accountRef:string;roomRef:string;source:'YENRA_FB_OFFICIAL';name:string|null;nameKnown:boolean;readOnly:true;canSend:false;partial:boolean;updatedAt:null;messages:Array<{mid:string;text:string;direction:string;timestamp:number;translation?:string|null;media?:Array<{type:string;url:string}>;attachmentMeta?:Array<{kind:string;mimeType?:string;name?:string;size?:number|null}>;nativeMediaType?:string;hasNativeMedia?:boolean;quotedMessageId?:string;quotedContent?:string}>}
const parsedInput=(raw:string)=>{
 if(raw.length>300)throw Error('FACEBOOK_ROOM_REQUEST_TOO_LONG')
 const v:unknown=JSON.parse(raw)
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('FACEBOOK_ROOM_REQUEST_INVALID')
 const q=v as Record<string,unknown>
 if(Object.keys(q).length!==2||typeof q.accountRef!=='string'||typeof q.roomRef!=='string'||
  !REF.test(q.accountRef)||!REF.test(q.roomRef))throw Error('FACEBOOK_ROOM_SCOPE_INVALID')
 return {accountRef:q.accountRef,roomRef:q.roomRef}
}
const limited=(s:unknown,n=4000)=>typeof s==='string'?s.slice(0,n):''
function timestamp(v:unknown):number{
 if(typeof v==='number'&&Number.isFinite(v)&&v>=0)return v<1e11?v*1000:v
 if(typeof v==='string'){const n=Date.parse(v);if(Number.isFinite(n)&&n>=0)return n}
 return 0
}
async function personalSdk(){
 return loadMatureModule(LEGACY_PERSONAL) as Promise<{readOfficialFacebookInbox:()=>Promise<any>;readOfficialFacebookMessages:(id:string)=>Promise<any>;readOfficialFacebookAvatar:(id:string)=>Promise<{mime:string;data:Uint8Array}>;readOfficialFacebookMedia:(room:string,mid:string)=>Promise<{mime:string;data:Uint8Array;type:string}>;markOfficialFacebookRead:(room:string,mid:string)=>Promise<{ok:boolean;roomId:string;mid:string;state:string}>}>
}
async function personalRows(){
 const sdk=await personalSdk()
 const inbox=await sdk.readOfficialFacebookInbox()
 if(inbox?.ok!==true||inbox.connectedAccountCount!==1||!Array.isArray(inbox.contacts))throw Error('PERSONAL_OFFICIAL_NOT_CONNECTED')
 if(inbox.contacts.length>300)throw Error('PERSONAL_ROOM_COUNT_INVALID')
 const accountRef=sha('FB_PERSONAL|W56|@w56_internal_fb_bridge:yance-w26.invalid')
 const rows=inbox.contacts.filter((c:any)=>typeof c.roomId==='string'&&c.roomId.length<260)
 const account:Account={channel:'Personal',accountRef,source:'YENRA_FB_OFFICIAL',readOnly:true,canSend:false,
  partial:Boolean(inbox.providerPeerBindingPending),updatedAt:null,rooms:rows.map((c:any)=>({
   roomRef:sha(accountRef+'\0'+c.roomId),name:limited(c.displayName,100)||null,
   nameKnown:Boolean(c.displayName&&c.displayName!=='Messenger 对话'),
   lastMessageAt:timestamp(c.lastMessageTimestamp)||null,messageCount:0,
   latestText:limited(c.lastMessage,240)||null,providerPeerKind:'matrix-room'}))}
 return {account,rows,sdk}
}
function ensurePageAlias(allowFreshAccount=false){
 // Never resolve or create a credential alias relative to an unknown cwd.
 // Missing installed mature SDK or Windows user AppData is not a reason to
 // fall back to somebody else's personal credential directory.
 if(!pageSdkDir||!SANDBOX||!isAbsolute(SANDBOX)||!SECRET||!isAbsolute(SECRET))
  throw Error('PAGE_INSTALLED_SDK_OR_USER_PROFILE_MISSING')
 // First-time account registration is allowed to create its OWN empty DPAPI
 // directory; normal reads still require an existing protected account file.
 if(allowFreshAccount)mkdirSync(SECRET,{recursive:true})
 if(!allowFreshAccount&&!existsSync(PAGE_ACCOUNT_FILE))throw Error('PAGE_PROTECTED_CREDENTIAL_NOT_FOUND')
 mkdirSync(join(SANDBOX,'YanceV2'),{recursive:true})
 if(!existsSync(ALIAS))symlinkSync(SECRET,ALIAS,'junction')
 if(norm(realpathSync.native(ALIAS))!==norm(realpathSync.native(SECRET)))
  throw Error('PAGE_AUTH_ALIAS_SCOPE_CHANGED')
}
// Only promises from the SAME authorized read call are shared. They are
// dropped on completion; no second account store or cross-request token cache.
type PageReadCall={list?:Promise<any>;reads?:Map<string,Promise<any>>;coalesceFirstListOnly?:boolean;initialListStarted?:boolean;
  // Original SDK scope verified at this read's entry, never persisted.
  verifiedInitialScope?:any}
const pageReadCall=new AsyncLocalStorage<PageReadCall>()
/** Feed the original mature SDK its EXISTING W25-authenticated room identity.
 * This is a bounded read-only lookup, not a second roster/permission database.
 * The SDK still rechecks the protected account and verifies the live provider
 * response before any message is rendered; no W25 historical text is sent.
 */
function pageAccountRef(page:{accountName:string;pageId:string},revision:number):string{
 return sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+revision)
}
function pageByAccountRef(
 scope:{revision:number;pages:Array<{accountName:string;pageId:string}>},accountRef:string
){
 if(!REF.test(accountRef)||!Number.isSafeInteger(scope.revision))return null
 const matches=scope.pages.filter(page=>pageAccountRef(page,scope.revision)===accountRef)
 return matches.length===1?matches[0]:null
}
/** The existing W25 source is historical and read-only. The already-authenticated
 * original Pancake SDK remains responsible for current provider messages.
 * A Page B room can never be matched using Page A's scope or W25 index. */
function verifiedW25PageContact(
 scope:{revision:number;pages:Array<{pageId:string;accountName:string}>},
 roomOrRef:string,byOpaqueRef=false
):any|null{
 if(!Number.isSafeInteger(scope.revision)||typeof roomOrRef!=='string'||
   !Array.isArray(scope.pages)||scope.pages.length>24)return null
 try{
  const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
  if(config.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
     config.sqliteOpenMode!=='readOnly'||config.allowMutateSource!==false||
     config.historicalOnly!==true||config.canSend!==false)return null
  const db=new DatabaseSync(config.sourcePath,{readOnly:true})
  try{
   db.exec('PRAGMA query_only=ON')
   const pagePrefix=!byOpaqueRef?/^page:([^:]+):/.exec(roomOrRef)?.[1]:null
   const candidates=pagePrefix?scope.pages.filter(p=>p.pageId===pagePrefix):scope.pages
   for(const page of candidates){
    const hit=db.prepare('SELECT contacts_json FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
      .get(page.pageId,page.accountName,scope.revision) as any
    if(typeof hit?.contacts_json!=='string'||hit.contacts_json.length>350000)continue
    const rows:unknown=JSON.parse(hit.contacts_json)
    if(!Array.isArray(rows)||rows.length>LIST_LIMIT)continue
    const accountRef=pageAccountRef(page,scope.revision)
    const selected=rows.find((value:any)=>value&&typeof value==='object'&&
      typeof value.roomId==='string'&&value.roomId.startsWith('page:'+page.pageId+':')&&
      value.pageId===page.pageId&&value.accountName===page.accountName&&
      String(value.bindingRevision)===String(scope.revision)&&
      value.channel==='FB_PAGE'&&value.source==='PANCAKE_OFFICIAL_READ_ONLY'&&
      value.canSend===false&&value.readOnly===true&&
      typeof value.conversationId==='string'&&value.conversationId.length<=240&&
      typeof value.customerFromId==='string'&&
      (byOpaqueRef?sha(accountRef+'\0'+value.roomId)===roomOrRef:value.roomId===roomOrRef))
    if(selected)return selected
   }
   return null
  }finally{db.close()}
 }catch{return null}
}
let pageBackend:Promise<any>|undefined
/**
 * SendPulse verified Page peer to the ORIGINAL SDK room identity.
 * Reuses current DPAPI scope, signed SDK contact hints in DSH Storage,
 * and W25 historical evidence. Never matches by webhook name/text.
 */
export async function resolveSendPulseW25PagePeer(
 pageId:string,providerPeerId:string
):Promise<{accountRef:string;roomRef:string;pageId:string;authoritative:true}|null>{
 if(!/^\d{5,40}$/.test(pageId)||!/^[a-zA-Z0-9_.:-]{5,120}$/.test(providerPeerId))
  return null
 const {sdk}=await pageSdk()
 const current=await sdk.scope()
 if(!Number.isSafeInteger(current?.revision))return null
 const pages=current.pages.filter((p:any)=>p.pageId===pageId)
 if(pages.length!==1)return null
 // Resolve a provider peer using only already-authenticated original SDK
 // records: current in-memory roster, original DSH Storage Domain identity
 // hints, and historical W25. Exact Page/account/revision and PSID are required.
 // Never discover contacts by webhook-supplied names or refresh the full roster.
 const accountRef=pageAccountRef(pages[0],current.revision)
 const roomIds=new Set<string>()
 let ambiguous=false
 // ORIGINAL SDK rows contain canSend:false but no row-level readOnly flag;
 // their exact-scope verified parent Page account owns readOnly:true.
 // Only that trusted original parent can supply the absent field. Stored
 // W25 and persisted hints must still explicitly prove row.readOnly:true.
 const take=(rows:unknown,verifiedOriginalReadonlyParent=false)=>{
  if(!Array.isArray(rows)||rows.length>LIST_LIMIT)return
  const matches=rows.filter((v:any)=>
   v&&v.pageId===pageId&&v.accountName===pages[0].accountName&&
   String(v.bindingRevision)===String(current.revision)&&
   v.channel==='FB_PAGE'&&v.source==='PANCAKE_OFFICIAL_READ_ONLY'&&
   (v.readOnly===true||(verifiedOriginalReadonlyParent&&v.readOnly===undefined))&&
   v.canSend===false&&
   v.customerFromId===providerPeerId&&
   typeof v.roomId==='string'&&v.roomId.startsWith('page:'+pageId+':'))
  if(matches.length>1)ambiguous=true
  for(const row of matches)roomIds.add(row.roomId)
 }
 const cached=recentPageRows.get(accountRef)?.value
 if(cached?.account?.accountRef===accountRef&&
    cached.account.channel==='Page'&&
    cached.account.source==='YENRA_FB_OFFICIAL'&&
    cached.account.readOnly===true&&cached.account.canSend===false&&
    cached.revision===current.revision&&
    cached.page?.pageId===pageId&&cached.page?.accountName===pages[0].accountName)
  take(cached.rows,true)
 if(pageHints){
  const hint=await pageHints.get(current,accountRef)
  if(hint?.accountRef===accountRef)take(hint.rows)
 }
 try{
  const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
  if(config.sourceKind==='W25_CONSISTENT_HISTORY_SNAPSHOT'&&
     config.sqliteOpenMode==='readOnly'&&config.allowMutateSource===false&&
     config.historicalOnly===true&&config.canSend===false){
   const db=new DatabaseSync(config.sourcePath,{readOnly:true})
   try{
    db.exec('PRAGMA query_only=ON')
    const record=db.prepare('SELECT contacts_json FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
     .get(pageId,pages[0].accountName,current.revision) as any
    if(typeof record?.contacts_json==='string'&&record.contacts_json.length<=350000)
     take(JSON.parse(record.contacts_json))
   }finally{db.close()}
  }
 }catch{/* W25 is optional historical evidence, never an identity prerequisite. */}
 if(ambiguous||roomIds.size!==1)return null
 const roomId=[...roomIds][0]
 return {accountRef,roomRef:sha(accountRef+'\0'+roomId),
  pageId,authoritative:true}
}

async function pageSdk(){
 if(!pageBackend)pageBackend=(async()=>{
  ensurePageAlias()
  const store=await loadMatureModule(LEGACY_PAGE+'account-store.js') as any
  const {createPancakeReadOnlyInbox}=await loadMatureModule(LEGACY_PAGE+'native-page-inbox.mjs') as any
  const env={...process.env,APPDATA:SANDBOX}
  const originalList=()=>store.accountStoreOp('list',undefined,env)
  const originalRead=(name:string,pageId:string)=>store.accountStoreOp('read',{accountName:name,pageId},env)
  // Original operations, scheduled only inside this read request. In particular
  // the final scope and every Sender call still perform fresh original DPAPI.
  const {list,read,prefetch}=createOriginalPageRequestReads({
   getCurrent:()=>pageReadCall.getStore(),listAccounts:originalList,readAccountPair:originalRead,
  })
  // Original SDK's existing message cache (no second cache or provider).
  // 8 seconds accommodates A→B→A without delaying passive refresh for long.
  const sdk=createPancakeReadOnlyInbox({listAccounts:list,readAccountPair:read,messageTtl:8000,
    verifiedContactLookup:({scope,room}:any)=>
      verifiedRecentPageContact(scope,room)??pageHints?.find(scope,room)??verifiedW25PageContact(scope,room)})
  return {sdk,store,env,prefetch}
 })().catch(e=>{pageBackend=undefined;throw e})
 return pageBackend
}
async function getPageScope(accountRef?:string){
 const {sdk}=await pageSdk()
 // Reuse the ORIGINAL SDK scope verified at request entry, not a second
 // identity store. Independent scope revalidation still runs at request exit.
 const scope=pageReadCall.getStore()?.verifiedInitialScope??await sdk.scope()
 if(!Array.isArray(scope.pages)||!scope.pages.length||scope.pages.length>24||
    !Number.isSafeInteger(scope.revision))throw Error('PAGE_ACCOUNT_SCOPE_UNVERIFIED')
 const page=accountRef?pageByAccountRef(scope,accountRef):
   scope.pages.length===1?scope.pages[0]:null
 if(!page)throw Error('PAGE_EXACT_ACCOUNT_REF_REQUIRED')
 return {sdk,scope,page}
}
/** Reuse one DPAPI-verified account/Token promise within a SINGLE Page read.
 * A fresh original DPAPI scope check at the end detects revoked/changed accounts.
 * Manual sending is deliberately NOT wrapped and retains its original checks.
 */
async function withVerifiedPageRead<T>(action:()=>Promise<T>,roomHint?:{accountRef:string;roomRef:string}):Promise<T>{
 const {sdk,prefetch}=await pageSdk()
 return pageReadCall.run({},async()=>{
  if(roomHint){
   // An already verified roster supplies a scheduling HINT only. The original
   // protected store still validates this exact account/Page, the SDK still
   // awaits the fresh scope before GET, and the final independent check stays.
   // Overlap process startup instead of doing list -> read strictly in series.
   const hint=recentPageRows.get(roomHint.accountRef)?.value
   const last=recentlyVerifiedPageMessages.get(roomHint.accountRef+'|'+roomHint.roomRef)
   if(hint&&pageAccountRef(hint.page,hint.revision)===roomHint.accountRef&&
      hint.rows.some((row:any)=>sha(roomHint.accountRef+'\0'+row.roomId)===roomHint.roomRef)&&
      (!last||Date.now()-last.time>=8000))prefetch(hint.page.accountName,hint.page.pageId)
  }
  const start=await sdk.scope()
  if(!Array.isArray(start.pages)||!start.pages.length||start.pages.length>24||
     !Number.isSafeInteger(start.revision))
   throw Error('PAGE_ACCOUNT_SCOPE_UNVERIFIED')
  // Only internal read paths reuse this result; independent final scope
  // check runs OUTSIDE request-local coalescing and detects account change.
  const local=pageReadCall.getStore()
  if(local)local.verifiedInitialScope=start
  const value=await action()
  const finish=await pageReadCall.exit(()=>sdk.scope())
  const identities=(pages:Array<{accountName:string;pageId:string}>)=>
    pages.map(p=>JSON.stringify([p.accountName,p.pageId])).sort().join('|')
  if(finish.revision!==start.revision||
     identities(finish.pages)!==identities(start.pages))
   throw Error('PAGE_ACCOUNT_CHANGED_DURING_READ')
  return value
 })
}
/** Read verified W25 Chinese only, for already authenticated Page scope.
 * Uses ORIGINAL DPAPI SDK scope (no Page provider HTTP) and the ORIGINAL
 * read-only W25 snapshot. Match exact account/revision/room/MID/text SHA256.
 * No historical roster refresh, background job or alternate translation DB.
 */
export async function readVerifiedPageW25Translations(args:{
 accountRef:string;roomRef:string;items:Array<{id:string;text:string}>
}):Promise<Map<string,string>>{
 const found=new Map<string,string>()
 if(!REF.test(args.accountRef)||!REF.test(args.roomRef)||args.items.length>8)return found
 const {sdk,scope,page}=await getPageScope(args.accountRef) // existing DPAPI only, never fetchContacts()
 const actualRef=sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+scope.revision)
 if(actualRef!==args.accountRef)return found
 return pageW25ForVerifiedScope(args,page,scope.revision)
}
function pageW25ForVerifiedScope(
 args:{accountRef:string;roomRef:string;items:Array<{id:string;text:string}>},
 page:{pageId:string;accountName:string},revision:number
):Map<string,string>{
 const found=new Map<string,string>()
 if(!REF.test(args.accountRef)||!REF.test(args.roomRef)||args.items.length>100)return found
 const actualRef=sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+revision)
 if(actualRef!==args.accountRef)return found
 const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
 if(config.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
   config.sqliteOpenMode!=='readOnly'||config.allowMutateSource!==false||
   config.historicalOnly!==true||config.canSend!==false)throw Error('W25_READONLY_SOURCE_INVALID')
 const db=new DatabaseSync(config.sourcePath,{readOnly:true})
 try{
  db.exec('PRAGMA query_only=ON')
  const index=db.prepare('SELECT contacts_json FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
   .get(page.pageId,page.accountName,revision) as any
  if(!index||typeof index.contacts_json!=='string')return found
  const contacts=JSON.parse(index.contacts_json)
  if(!Array.isArray(contacts)||contacts.length>500)return found
  const originalRoom=contacts.find((c:any)=>typeof c?.roomId==='string'&&
    String(c.pageId)===String(page.pageId)&&c.accountName===page.accountName&&
    String(c.bindingRevision)===String(revision)&&
    sha(actualRef+'\0'+c.roomId)===args.roomRef)?.roomId
  if(!originalRoom)return found
  const statement=db.prepare(`SELECT translation_text FROM page_verified_translations
    WHERE page_id=? AND account_name=? AND binding_revision=? AND room_id=?
      AND provider_mid=? AND original_sha256=? AND target_language='zh'
      AND status='VERIFIED' LIMIT 1`)
  for(const item of args.items){
   if(!item.id||item.id.length>180||typeof item.text!=='string'||!item.text)continue
   const sourceHash=createHash('sha256').update(item.text,'utf8').digest('hex')
   const hit=statement.get(page.pageId,page.accountName,revision,
     originalRoom,item.id,sourceHash) as any
   if(typeof hit?.translation_text==='string'&&hit.translation_text.trim())
     found.set(item.id,hit.translation_text)
  }
  return found
 }finally{db.close()}
}
async function pageArchiveSource(page:{pageId:string;accountName:string},revision:number){
 const {createW25ReadOnlyHistoricalProjection}=await loadMatureModule(PAGE_PROJECTION) as any
 const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
 const db=new DatabaseSync(config.sourcePath,{readOnly:true})
 db.exec('PRAGMA query_only=ON')
 let tenant:string|null=null
 try{
   const row=db.prepare('SELECT page_id,account_name,binding_revision FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
    .get(page.pageId,page.accountName,revision) as any
  if(row&&String(row.page_id)===String(page.pageId)&&String(row.account_name)===String(page.accountName)&&
     String(row.binding_revision)===String(revision)){
   const bound=db.prepare("SELECT tenant_id FROM inbound_messages WHERE channel='FB_PAGE' AND account_id=? LIMIT 1")
    .get('pancake:'+page.accountName+':'+page.pageId) as any
   if(typeof bound?.tenant_id==='string')tenant=bound.tenant_id
  }
 }finally{db.close()}
 if(!tenant)return null
 return createW25ReadOnlyHistoricalProjection({getCurrentVerifiedChannelScope:async()=>{
   const live=await getPageScope(pageAccountRef(page,revision))
   if(live.scope.revision!==revision||live.page.pageId!==page.pageId||
     live.page.accountName!==page.accountName)throw Error('PAGE_IDENTITY_CHANGED_NO_ARCHIVE')
  return {source:'CURRENT_OFFICIAL_CONNECTOR',verified:true,channel:'FB_PAGE',pageId:page.pageId,
    accountName:page.accountName,tenantId:tenant,bindingRevision:revision}
 }})
}
function buildPageRows(
 scope:{revision:number;pages:Array<{accountName:string;pageId:string}>},
 page:{accountName:string;pageId:string},
 res:any,sdk:any
){
 const accountRef=pageAccountRef(page,scope.revision)
 const rows=res.contacts.filter((c:any)=>typeof c.roomId==='string'&&
   c.pageId===page.pageId&&c.accountName===page.accountName)
 if(rows.length>LIST_LIMIT)throw Error('PAGE_TOO_MANY_CONTACTS')
 const account:Account={
  channel:'Page',accountRef,
  displayId:sha('FB_PAGE_DISPLAY|'+page.accountName+'|'+page.pageId),
  accountLabel:'Page · '+limited(page.accountName,48)+' · '+page.pageId.slice(-4),
  source:'YENRA_FB_OFFICIAL',readOnly:true,canSend:false,
  partial:Boolean(res.partial),updatedAt:null,
  rooms:rows.map((c:any)=>{
   const name=limited(c.displayName,100)
   return {roomRef:sha(accountRef+'\0'+c.roomId),name:name||null,
    nameKnown:Boolean(name&&!name.startsWith('Page 会话')),
    providerPeerKind:'page-conversation',
    lastMessageAt:timestamp(c.lastMessageTimestamp)||null,
    messageCount:0,latestText:limited(c.lastMessage,240)||null}
  })
 }
 // Historical W25 may supply a verified same-room preview when the mature
 // SDK only returns contacts and timestamps. One SQLite query, zero Page GETs.
 // Prefix marks old history; never fabricate a current provider last message.
 return {account:mergeVerifiedPageHistoricalPreviews({scope,page,account}),
   rows,sdk,page,revision:scope.revision}
}
/** One original SDK contact batch covers all authorized Pages.
 * No per-Page roster polling, new credential cache or second SDK. */
async function pageRowsAll(preferCached=false,forceFresh=false){
 const {sdk}=await pageSdk()
 const scope=await sdk.scope()
 if(!Array.isArray(scope.pages)||!scope.pages.length||scope.pages.length>24||
    !Number.isSafeInteger(scope.revision))throw Error('PAGE_ACCOUNT_SCOPE_UNVERIFIED')
 const cached=preferCached?await sdk.peekCachedContacts():null
 // Explicit source refresh uses the mature SDK's existing fresh option;
 // ordinary cached views never force a Page provider fetch.
 const res=cached??await sdk.fetchContacts(forceFresh?{fresh:true}:undefined)
 if(res?.ok!==true||res.channel!=='FB_PAGE'||!Array.isArray(res.contacts))
  throw Error('PAGE_OFFICIAL_CONTACTS_UNAVAILABLE')
 if(res.contacts.length>LIST_LIMIT)throw Error('PAGE_TOO_MANY_CONTACTS')
 return scope.pages.map(page=>buildPageRows(scope,page,res,sdk))
}
async function pageRows(preferCached=false,accountRef?:string){
 const {sdk,scope,page}=await getPageScope(accountRef)
 const cached=preferCached?await sdk.peekCachedContacts():null
 const res=cached??await sdk.fetchContacts()
 if(res?.ok!==true||res.channel!=='FB_PAGE'||!Array.isArray(res.contacts))
  throw Error('PAGE_OFFICIAL_CONTACTS_UNAVAILABLE')
 return buildPageRows(scope,page,res,sdk)
}

/** Original authorized Matrix room-avatar reader and W25 verified Page avatar.
 * Never return raw room identifiers, provider tokens, or image bytes in roster JSON.
 */
// One process-local snapshot of the original SDK's verified Page roster.
// Its accountRef includes the DPAPI scope revision, which is rechecked on
// every use. A 15-second TTL used to trigger a WHOLE Page roster lookup
// whenever the user opened chats later; keep the verified list instead.
// Only explicit Refresh, verified account change or an unknown room misses it.
// The unique native Sender always uses its own fresh authorized checks.
type PageRowsResult=Awaited<ReturnType<typeof pageRows>>
const recentPageRows=new Map<string,{time:number;value:PageRowsResult}>()
/** One already-authenticated live room may be newer than SDK's roster card.
 * Keep only its latest text/time inside the ORIGINAL in-memory Host roster;
 * no new contact DB, provider polling, W25 writes or cross-Page merge.
 */
function rememberVerifiedPagePreview(
 input:{accountRef:string;roomRef:string},
 page:{pageId:string;accountName:string},revision:number,
 roomId:string,messages:any[]
){
 const current=recentPageRows.get(input.accountRef)?.value
 if(!current||current.account.accountRef!==input.accountRef||
    current.page.pageId!==page.pageId||
    current.page.accountName!==page.accountName||
    current.revision!==revision||
    sha(input.accountRef+'\0'+roomId)!==input.roomRef||
    !Array.isArray(messages))return
 const card=current.account.rooms.find(r=>r.roomRef===input.roomRef)
 if(!card)return
 const latest=messages.flatMap((m:any)=>{
  const at=timestamp(m?.matrixTimestamp)
  if(typeof m?.mid!=='string'||typeof m?.original!=='string'||
     !m.original.trim()||m.original.length>4000||!at||
     at> Date.now()+300000)return []
  return [{at,text:limited(m.original,240)}]
 }).sort((a:any,b:any)=>b.at-a.at)[0]
 if(!latest||latest.at<(card.lastMessageAt??0))return
 card.latestText=latest.text
 card.lastMessageAt=latest.at
}
/** A full SDK roster refresh is not permission to erase an already-verified
 * latest preview from this SAME account/revision. If provider timestamp is
 * newer, preserve its time and show no guessed old text.
 */
function inheritVerifiedPagePreviews(fresh:PageRowsResult,prior?:PageRowsResult){
 if(!prior||fresh.account.accountRef!==prior.account.accountRef||
    fresh.page.pageId!==prior.page.pageId||
    fresh.page.accountName!==prior.page.accountName||
    fresh.revision!==prior.revision)return
 const seen=new Map(prior.account.rooms.map(room=>[room.roomRef,room] as const))
 fresh.account.rooms=fresh.account.rooms.map(room=>{
  const previous=seen.get(room.roomRef)
  if(!previous||!previous.latestText||!previous.lastMessageAt||
     previous.lastMessageAt<(room.lastMessageAt??0))return room
  return {...room,latestText:previous.latestText,lastMessageAt:previous.lastMessageAt}
 })
}
/** Refresh the ORIGINAL in-memory Page roster from a provider-verified
 * SendPulse inbound event, even when the user has not opened that room.
 * The caller MUST be the same Host's official REST + PSID + Page resolver.
 * No new roster storage, SDK mass-read, translation or Sender.
 */
export function recordVerifiedPageInboundPreview(row:{
 channel:string;source:string;direction:string;
 accountRef:string;roomRef:string;mid:string;text:string;timestamp:number
}):boolean{
 if(row?.channel!=='Page'||
    row.source!=='SENDPULSE_OFFICIAL_REST_API_VERIFIED'||
    row.direction!=='INBOUND'||
    !REF.test(row.accountRef)||!REF.test(row.roomRef)||
    typeof row.mid!=='string'||row.mid.length<5||row.mid.length>180||
    typeof row.text!=='string'||!row.text.trim()||row.text.length>4000||
    !Number.isFinite(row.timestamp)||row.timestamp<1262304000000||
    row.timestamp>Date.now()+300000)return false
 const source=recentPageRows.get(row.accountRef)?.value
 if(!source||source.account.accountRef!==row.accountRef||
    source.account.channel!=='Page'||!Array.isArray(source.account.rooms))return false
 const existing=source.account.rooms.find(room=>room.roomRef===row.roomRef)
 if(!existing||row.timestamp<(existing.lastMessageAt??0))return false
 existing.latestText=limited(row.text,240)
 existing.lastMessageAt=row.timestamp
 return true
}
/** Existing ORIGINAL SDK provider roster is valid as a room identity hint for
 * newly discovered Page contacts absent from historical W25. It carries no
 * messages/credentials and cannot authorize GET without fresh SDK scope.
 * The outer read still performs a second independent post-read DPAPI check.
 */
function verifiedRecentPageContact(
 scope:{revision:number;pages:Array<{accountName:string;pageId:string}>},room:string
):any|null{
 if(!Number.isSafeInteger(scope?.revision)||!Array.isArray(scope?.pages)||
    scope.pages.length>24||typeof room!=='string'||room.length>300)return null
 for(const page of scope.pages){
  const ref=pageAccountRef(page,scope.revision)
  const saved=recentPageRows.get(ref)?.value
  if(!saved||saved.account.accountRef!==ref||
     saved.page.pageId!==page.pageId||saved.page.accountName!==page.accountName||
     saved.revision!==scope.revision)continue
  const hits=saved.rows.filter((row:any)=>
    row.roomId===room&&row.roomId.startsWith('page:'+page.pageId+':')&&
    row.pageId===page.pageId&&row.accountName===page.accountName&&
    String(row.bindingRevision)===String(scope.revision)&&
    row.channel==='FB_PAGE'&&row.source==='PANCAKE_OFFICIAL_READ_ONLY'&&
    row.canSend===false&&typeof row.conversationId==='string'&&
    row.conversationId.length<=240&&typeof row.customerFromId==='string')
  if(hits.length===1)return hits[0]
 }
 return null
}
// Translation source proof is strictly scoped by BOTH account and room.
let recentlyVerifiedPersonalMessages:{
 accountRef:string;roomRef:string;time:number;exact:Set<string>
}|undefined
const recentlyVerifiedPageMessages=new Map<string,{
 accountRef:string;roomRef:string;revision:number;time:number;exact:Set<string>
}>()
const pendingAvatarPageRoster=new Map<string,Promise<PageRowsResult>>()
async function verifiedAvatarPageRows(refreshRoster=false,accountRef?:string):Promise<PageRowsResult>{
 const {scope,page}=await getPageScope(accountRef)
 const ref=pageAccountRef(page,scope.revision)
 const saved=recentPageRows.get(ref)
 if(!refreshRoster&&saved)return saved.value
 const pending=pendingAvatarPageRoster.get(ref)
 if(pending)return pending
 const request=pageRows(!refreshRoster,ref)
 pendingAvatarPageRoster.set(ref,request)
 try{
  const value=await request
  if(value.account.accountRef===ref){
   inheritVerifiedPagePreviews(value,saved?.value)
   recentPageRows.set(ref,{time:Date.now(),value})
   if(!value.account.partial)void pageHints?.save(
     {revision:value.revision,pages:[value.page]},value.page,value.account,value.rows)
  }
  if(recentPageRows.size>24){
   for(const key of recentPageRows.keys())if(key!==ref&&!scope.pages.some(
     p=>pageAccountRef(p,scope.revision)===key))recentPageRows.delete(key)
  }
  return value
 }finally{if(pendingAvatarPageRoster.get(ref)===request)pendingAvatarPageRoster.delete(ref)}
}
async function verifiedAllPageRows(refreshRoster=false):Promise<PageRowsResult[]>{
 const {sdk}=await pageSdk()
 let sources:PageRowsResult[]
 try{sources=await pageRowsAll(!refreshRoster,refreshRoster)}
 catch(e){
  // Provider 429 is NOT a disconnected account. Only reuse Page identities
  // previously verified by the SAME SDK and saved to official DSH Storage.
  // They are marked partial and cannot authorize messages or sending.
  if(String((e as Error)?.message??e)!=='PAGE_PROVIDER_RATE_LIMITED'||!pageHints)throw e
  const scope=await sdk.scope()
  const saved=await pageHints.snapshotForScope(scope)
  if(!saved.length)throw e
  sources=saved.map(item=>buildPageRows(scope,
    {accountName:item.accountName,pageId:item.pageId},
    {contacts:item.rows,partial:true},sdk))
 }
 // With multiple Pages, restore only the individual Page missing from
 // a partial official response; never cross account/revision or overwrite fresh.
 for(let i=0;i<sources.length;i++){
  const item=sources[i]
  if(item.account.partial&&!item.rows.length&&pageHints){
   const snapshot=await pageHints.get(
     {revision:item.revision,pages:[item.page]},item.account.accountRef)
   if(snapshot)sources[i]=buildPageRows(
     {revision:item.revision,pages:[item.page]},item.page,
     {contacts:snapshot.rows,partial:true},sdk)
  }
 }
 const active=new Set(sources.map(item=>item.account.accountRef))
 for(const key of recentPageRows.keys())if(!active.has(key))recentPageRows.delete(key)
 for(const item of sources){
  const original=recentPageRows.get(item.account.accountRef)?.value
  inheritVerifiedPagePreviews(item,original)
  // A partial Page 429 must retain only a SAME-revision previously verified roster.
  if(item.account.partial&&item.account.rooms.length===0&&original?.account.rooms.length){
   item.account.rooms=original.account.rooms
   item.rows=original.rows
  }
  recentPageRows.set(item.account.accountRef,{time:Date.now(),value:item})
  if(!item.account.partial)void pageHints?.save(
    {revision:item.revision,pages:[item.page]},item.page,item.account,item.rows)
 }
 return sources
}
export async function getVerifiedFacebookAvatar(accountRef:string,roomRef:string,cacheOnly=false):
 Promise<{mime:string;bytes:Buffer}|null>{
 if(!REF.test(accountRef)||!REF.test(roomRef))return null
 const isPersonal=accountRef===sha('FB_PERSONAL|W56|@w56_internal_fb_bridge:yance-w26.invalid')
 if(isPersonal){
  const personal=await personalRows().catch(()=>null)
  if(!personal)return null
  const row=personal.rows.find((r:any)=>sha(accountRef+'\0'+r.roomId)===roomRef)
  if(!row)return null
  try{
   const value=await personal.sdk.readOfficialFacebookAvatar(row.roomId)
   if(!value?.data||!value?.mime)return null
   return {mime:value.mime,bytes:Buffer.from(value.data)}
  }catch{return null}
 }
 // Visible avatars may join a concurrent initial DPAPI list instead of
 // starting one process per image. Later SDK checks remain independent.
 return pageReadCall.run({coalesceFirstListOnly:true},async()=>{
 const page=await verifiedAvatarPageRows(false,accountRef).catch(()=>null)
 if(page?.account.accountRef!==accountRef)return null
 const row=page.rows.find((r:any)=>sha(accountRef+'\0'+r.roomId)===roomRef)
 if(!row||typeof row.customerFromId!=='string')return null
 // W25 remains first: its original verified image bytes are cheap to read.
 // For newer chats missing W25, call the EXISTING mature Pancake official
 // readAvatar(), which verifies the same Page/room/peer and limits CDN reads.
 // Load W25 only for the selected idle avatar request, never on roster
 // or conversation opens. Its original DB remains read-only.
 try{
  const archive=await pageArchiveSource(page.page,page.revision)
  const saved=await archive?.getPageAvatar({roomId:row.roomId,peerId:row.customerFromId})
  if(saved?.bytes&&saved.mime)return {mime:saved.mime,bytes:Buffer.from(saved.bytes)}
 }catch{}
 // The original source still wins. The user-confirmed browser photo is only
 // a strictly scoped fallback for a genuine provider 404 / unavailable image.
 // It uses an inert static asset in existing YENRA runtime, not a new reader.
 const ownerFallback=async()=>{
  const asset=readOwnerVerifiedPageAvatar(ROOT,{
   accountRef,roomRef,peerId:row.customerFromId
  })
  if(!asset)return null
  try{
   // A browser picture alone never authorizes a room. Recheck original DPAPI
   // Page authority/revision immediately before returning even cached bytes.
   const live=await page.sdk.scope()
   if(live.revision!==page.revision||
      !live.pages.some((p:any)=>p.pageId===page.page.pageId&&
        p.accountName===page.page.accountName))return null
   return asset
  }catch{return null}
 }
 // Visible contact rows do not start a provider/CDN read during fast switching.
 if(cacheOnly)return ownerFallback()
 let providerReadError:unknown=null
 try{
  const fresh=await page.sdk.readAvatar(row.roomId)
  if(fresh?.bytes&&fresh.mime)return {mime:fresh.mime,bytes:Buffer.from(fresh.bytes)}
 }catch(e){providerReadError=e}
 const fallback=await ownerFallback()
 if(fallback)return fallback
 // A provider error is NOT a verified "no avatar" response. The existing
 // native Host route maps failures to HTTP 503, true missing photos to 204.
 if(providerReadError)throw providerReadError
 return null
 })
}

/** Exact event + verified account/room; original Matrix remains the only media source. */
export async function getVerifiedPersonalMedia(accountRef:string,roomRef:string,mid:string):
 Promise<{mime:string;bytes:Buffer;type:string}|null>{
 if(!REF.test(accountRef)||!REF.test(roomRef)||typeof mid!=='string'||
    !mid.startsWith('$')||mid.length>=240)return null
 const {account,rows,sdk}=await personalRows()
 if(account.accountRef!==accountRef)return null
 const item=rows.find((r:any)=>sha(accountRef+'\0'+r.roomId)===roomRef)
 if(!item)return null
 const actual=await sdk.readOfficialFacebookMedia(item.roomId,mid)
 if(!actual?.mime||!actual?.data||!actual?.type)return null
 return {mime:actual.mime,bytes:Buffer.from(actual.data),type:actual.type}
}
/** W25 verified Personal translation is read-only sidecar data.
 * The caller has already passed official Matrix account / joined-room / event
 * verification. Archive fingerprints are only historical lookup keys and
 * never treated as new current authentication credentials.
 */
function personalW25InCurrentVerifiedRoom(roomId:string,messages:any[]):Map<string,string>{
 const found=new Map<string,string>()
 if(!roomId||!Array.isArray(messages)||messages.length>100)return found
 try{
  const cfg=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
  if(cfg.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
    cfg.sqliteOpenMode!=='readOnly'||cfg.allowMutateSource!==false||
    cfg.historicalOnly!==true||cfg.canSend!==false)return found
  const db=new DatabaseSync(cfg.sourcePath,{readOnly:true})
  try{
   db.exec('PRAGMA query_only=ON')
   const pairs=db.prepare(`SELECT DISTINCT account_fingerprint,binding_fingerprint
     FROM personal_verified_translations WHERE room_id=? AND status='VERIFIED' LIMIT 2`).all(roomId) as any[]
   const s=pairs.length===1?pairs[0]:null
   if(!s||!/^[a-f0-9]{64}$/.test(s.account_fingerprint)||
      !/^[a-f0-9]{64}$/.test(s.binding_fingerprint))return found
   const get=db.prepare(`SELECT translation_text FROM personal_verified_translations
     WHERE account_fingerprint=? AND room_id=? AND provider_mid=? AND original_sha256=?
       AND binding_fingerprint=? AND target_language='zh'
       AND status='VERIFIED' LIMIT 1`)
   for(const m of messages){
    if(typeof m?.mid!=='string'||!m.mid.startsWith('$')||
       typeof m.original!=='string'||m.original.length>4000)continue
    const h=createHash('sha256').update(m.original,'utf8').digest('hex')
    const t=get.get(s.account_fingerprint,roomId,m.mid,h,s.binding_fingerprint) as any
    if(typeof t?.translation_text==='string'&&t.translation_text.trim())
      found.set(m.mid,t.translation_text)
   }
  }finally{db.close()}
 }catch{/* Historical archive is optional and must never block current chat. */}
 return found
}
export async function personalRoom(input:{accountRef:string;roomRef:string}):Promise<Room|null>{
 const {account,rows,sdk}=await personalRows()
 if(account.accountRef!==input.accountRef)return null
 const item=rows.find((c:any)=>sha(account.accountRef+'\0'+c.roomId)===input.roomRef)
 if(!item)return null
 const timeline=await sdk.readOfficialFacebookMessages(item.roomId)
 if(timeline?.ok!==true||timeline.roomId!==item.roomId)throw Error('PERSONAL_ROOM_NOT_AUTHENTICATED')
 recentlyVerifiedPersonalMessages={
  accountRef:input.accountRef,roomRef:input.roomRef,time:Date.now(),
  exact:new Set(timeline.messages.filter((m:any)=>
    typeof m.mid==='string'&&typeof m.original==='string').map((m:any)=>
    sha(JSON.stringify([m.mid,keyOfTranslationOriginal(m.original)]))))
 }
 const archiveText=personalW25InCurrentVerifiedRoom(item.roomId,timeline.messages)
 return {schema:1,channel:'Personal',source:'YENRA_FB_OFFICIAL',accountRef:input.accountRef,roomRef:input.roomRef,
  name:limited(item.displayName,100)||null,nameKnown:Boolean(item.displayName&&item.displayName!=='Messenger 对话'),
  readOnly:true,canSend:false,partial:Boolean(timeline.providerPeerBindingPending),updatedAt:null,
  messages:timeline.messages.slice(-100).map((m:any)=>({
   mid:limited(m.mid,180),text:limited(m.original,4000),timestamp:timestamp(m.matrixTimestamp),
   direction:m.direction==='OUTBOUND'?'OUTBOUND':'INBOUND',
   ...(archiveText.has(m.mid)?{translation:archiveText.get(m.mid)!}:{}),
   ...(m.nativeMediaType?{nativeMediaType:m.nativeMediaType,hasNativeMedia:Boolean(m.hasNativeMedia)}:{}),
   // Only the verified Personal room's Matrix projection may supply quotes.
   ...(typeof m.quotedMessageId==='string'&&m.quotedMessageId.startsWith('$')&&
     m.quotedMessageId.length<=180&&m.quotedMessageId!==m.mid?
     {quotedMessageId:m.quotedMessageId,
      ...(typeof m.quotedContent==='string'?{quotedContent:limited(m.quotedContent,2000)}:{})}:{})
  }))}
}
/** The owner's already-visible Page room, never a guessed FB identity.
 * Calls the existing mature Pancake seen helper and requires fresh provider
 * readback. Matrix Personal and Page stay different authenticated scopes. */
export async function markVerifiedPageSeen(input:{accountRef:string;roomRef:string;mid:string}){
 if(!REF.test(input.accountRef)||!REF.test(input.roomRef)||
    !/^pancake:\d{1,40}:[^\s]{1,155}$/.test(input.mid))
   throw Error('PAGE_READ_INPUT_INVALID')
 return withVerifiedPageRead(async()=>{
   const {sdk,scope,page}=await getPageScope(input.accountRef)
   const listing=await sdk.fetchContacts()
   if(listing?.ok!==true||!Array.isArray(listing.contacts))
     throw Error('PAGE_READ_ROSTER_UNAVAILABLE')
   const matching=listing.contacts.filter((r:any)=>
     r.channel==='FB_PAGE'&&r.source==='PANCAKE_OFFICIAL_READ_ONLY'&&
     r.pageId===page.pageId&&r.accountName===page.accountName&&
     String(r.bindingRevision)===String(scope.revision)&&r.canSend===false&&
     typeof r.roomId==='string'&&
     sha(input.accountRef+'\0'+r.roomId)===input.roomRef)
   if(matching.length!==1)throw Error('PAGE_READ_CONTACT_NOT_VERIFIED')
   const {read}=await pageSdk()
   // Use the same vetted code-only helper staged into this plugin. The
   // portable provider SDK may still carry its original HTTP-only handler.
   const sdkRead=await loadMatureModule(ROOT
     ?nativeModuleUrl('social-adapters/compat/pancake-page-original-sdk/lib/native-page-mark-read.mjs')
     :new URL('./pancake-sdk/lib/native-page-mark-read.mjs',import.meta.url).href)
   if(typeof sdkRead.markOriginalPageSeen!=='function')
     throw Error('PAGE_READ_NATIVE_HELPER_UNAVAILABLE')
   const result=await sdkRead.markOriginalPageSeen({
     pageInbox:sdk,readAccountPair:read,roomId:matching[0].roomId,
     expectedNewestInboundMid:input.mid})
   if(result?.ok!==true||result.roomId!==matching[0].roomId||
      result.readConfirmed!==true)
     throw Error('PAGE_READ_PROVIDER_READBACK_UNCONFIRMED')
   return {ok:true,channel:'Page',accountRef:input.accountRef,roomRef:input.roomRef,
     mid:input.mid,state:'PAGE_SEEN_CONFIRMED',pageProviderSeenConfirmed:true}
 },input)
}

/** Explicit owner read for Personal only; current Matrix source rechecks
 * account, joined room and the exact newest incoming message before POST.
 * A Matrix acknowledgement is never represented as proven Meta read state. */
export async function markVerifiedPersonalRead(input:{accountRef:string;roomRef:string;mid:string}){
 if(!REF.test(input.accountRef)||!REF.test(input.roomRef)||
   !/^\$[^\s]{4,179}$/u.test(input.mid))throw Error('PERSONAL_READ_INPUT_INVALID')
 const {account,rows,sdk}=await personalRows()
 if(account.accountRef!==input.accountRef)throw Error('PERSONAL_READ_ACCOUNT_MISMATCH')
 const matches=rows.filter((c:any)=>sha(input.accountRef+'\0'+c.roomId)===input.roomRef)
 if(matches.length!==1)throw Error('PERSONAL_READ_ROOM_NOT_UNIQUE')
 const receipt=await sdk.markOfficialFacebookRead(matches[0].roomId,input.mid)
 if(receipt?.ok!==true||receipt.roomId!==matches[0].roomId||
    receipt.mid!==input.mid||receipt.state!=='MATRIX_RECEIPT_ACCEPTED')
   throw Error('PERSONAL_READ_RECEIPT_UNCONFIRMED')
 return {ok:true,channel:'Personal',accountRef:input.accountRef,roomRef:input.roomRef,
  mid:input.mid,state:'MATRIX_RECEIPT_ACCEPTED',metaReadConfirmed:false}
}

/** Original mature W25 read-only history, only when official Page GET is temporarily unavailable.
 * Historical content is never reported as fresh. The outer withVerifiedPageRead
 * still performs a second independent SDK/DPAPI scope check before returning.
 */
async function pageHistoricalFallback(
 input:{accountRef:string;roomRef:string},
 verified:{scope:{revision:number;pages:Array<{accountName:string;pageId:string}>};page:{accountName:string;pageId:string}},
 item:any
):Promise<Room|null>{
 const current=verifiedW25PageContact(verified.scope,input.roomRef,true)
 if(!current||current.roomId!==item?.roomId||
    pageAccountRef(verified.page,verified.scope.revision)!==input.accountRef)return null
 let historical:any
 try{
  const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
  if(config.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
     config.sqliteOpenMode!=='readOnly'||config.allowMutateSource!==false||
     config.historicalOnly!==true||config.canSend!==false)return null
  const {readVerifiedW25PageHistory}=await loadMatureModule(LEGACY_PAGE+'page-w25-verified-fast-history.mjs')
  historical=readVerifiedW25PageHistory({room:item.roomId,scope:verified.scope,
    databasePath:config.sourcePath})
 }catch{return null}
 if(historical?.ok!==true||historical.roomId!==item.roomId||
    historical.historicalOnly!==true||historical.officialFresh!==false||
    historical.canSend!==false||!Array.isArray(historical.messages))return null
 const messages=historical.messages.slice(-80).flatMap((m:any)=>{
  if(!m||m.roomId!==item.roomId||typeof m.mid!=='string'||
     !m.mid.startsWith('pancake:'+verified.page.pageId+':')||
     typeof m.original!=='string'||!m.original.trim()||
     !['INBOUND','OUTBOUND'].includes(m.direction)||
     m.historicalOnly!==true||m.source!=='W25_PERSISTED_HISTORY')return []
  const at=timestamp(m.matrixTimestamp)
  return at?[{mid:limited(m.mid,180),text:limited(m.original,4000),
    timestamp:at,direction:m.direction}]:[]
 })
 if(!messages.length)return null
 return {schema:1,channel:'Page',source:'YENRA_FB_OFFICIAL',
  accountRef:input.accountRef,roomRef:input.roomRef,
  name:limited(item.displayName,100)||null,
  nameKnown:Boolean(item.displayName&&!item.displayName.startsWith('Page 会话')),
  readOnly:true,canSend:false,partial:true,updatedAt:null,
  historicalOnly:true,officialFresh:false,messages} as Room
}

/** Read the SAME mature verified W25 history as provisional display only.
 * This never contacts the Page provider, creates a Sender, or marks history
 * as fresh. The enclosing original withVerifiedPageRead checks account scope
 * both before and after the read, and returns null for unindexed contacts. */
export async function pageHistoricalOnly(input:{accountRef:string;roomRef:string}):Promise<Room|null>{
 const verified=await getPageScope(input.accountRef)
 if(pageAccountRef(verified.page,verified.scope.revision)!==input.accountRef)return null
 const item=verifiedW25PageContact(verified.scope,input.roomRef,true)
 if(!item)return null
 return pageHistoricalFallback(input,verified,item)
}

let sendPulsePageFallbackReader:ReturnType<typeof createSendPulseOfficialReader>|undefined
const existingSendPulsePageReader=()=>
 sendPulsePageFallbackReader??(sendPulsePageFallbackReader=createSendPulseOfficialReader())
export async function pageRoom(input:{accountRef:string;roomRef:string}):Promise<Room|null>{
 // First use the already-authorized W25 room identity, then let the
 // ORIGINAL mature SDK GET and verify this room's current messages.
 // A 429 on the WHOLE Page roster must not block an independently
 // authenticated existing contact. No historical W25 messages are trusted.
 const verified=await getPageScope(input.accountRef)
 const expectedRef=pageAccountRef(verified.page,verified.scope.revision)
 if(expectedRef!==input.accountRef)return null
 let {sdk,page}=verified
 let revision=verified.scope.revision
 let account:Pick<Account,'accountRef'|'partial'>={accountRef:expectedRef,partial:true}
 let item:any=verifiedW25PageContact(verified.scope,input.roomRef,true)
 // New Page contacts may have no W25 history. Reuse the SAME already
 // provider-verified original Host roster, if currently present. A strict
 // room-ref hash resolves its native provider room; the existing mature
 // verifiedRecentPageContact validates account/tenant/revision and provenance.
 // This is neither a second contact store nor authority to send anything.
 if(!item){
  const current=recentPageRows.get(input.accountRef)?.value
  if(current?.account.accountRef===input.accountRef&&
     current.account.partial===false&&
     current.revision===verified.scope.revision&&
     current.page.pageId===page.pageId&&
     current.page.accountName===page.accountName){
    const matched=current.rows.filter((row:any)=>
      typeof row.roomId==='string'&&
      sha(input.accountRef+'\0'+row.roomId)===input.roomRef)
    if(matched.length===1)
      item=verifiedRecentPageContact(verified.scope,matched[0].roomId)
  }
 }
 // The official DSH Storage Domain identity hint then covers cold Process
 // restarts; an unverified or unknown room still must use the original SDK.
 if(!item&&pageHints)
  item=await pageHints.byOpaqueRef(verified.scope,input.accountRef,input.roomRef)
 if(!item){
  // Unknown/new Page rooms still require the original provider authority.
  let source=await verifiedAvatarPageRows(false,input.accountRef)
  ;({sdk,page,revision}=source)
  account=source.account
  if(account.accountRef!==input.accountRef)return null
  item=source.rows.find((c:any)=>sha(account.accountRef+'\0'+c.roomId)===input.roomRef)
  if(!item){
   source=await pageRows(false,input.accountRef)
   ;({sdk,page,revision}=source)
   account=source.account
   if(account.accountRef!==input.accountRef)return null
   item=source.rows.find((c:any)=>sha(account.accountRef+'\0'+c.roomId)===input.roomRef)
  }
 }
 if(!item)return null
 let current:any
 try{current=await sdk.fetchMessages(item.roomId)}catch(e){
  // No fallback for revoked accounts, invalid rooms, or rejected credentials.
  // Historical W25 is only displayed when the original provider is unavailable.
  const code=String((e as Error)?.message??e)
  if(!['PAGE_PROVIDER_UNAVAILABLE','PAGE_PROVIDER_NETWORK_UNAVAILABLE',
        'PAGE_PROVIDER_RATE_LIMITED'].includes(code))throw e
  // The verified current source wins over the archived W25 snapshot when
  // Pancake is rate-limited. This is the SAME existing SendPulse official
  // REST reader, bound to the original Page/peer and never a second sender.
  // Only if the ORIGINAL Page SDK itself reported 429, use the already
  // connected SendPulse official REST reader for this exact verified Page
  // provider peer. This cannot authorize a new contact, send or media URL.
  // Original Host/DPAPI checks still enclose the entire read.
  if(code==='PAGE_PROVIDER_RATE_LIMITED' &&
     item.pageId===verified.page.pageId &&
     item.accountName===verified.page.accountName &&
     typeof item.customerFromId==='string'){
   try{
    const source=await readVerifiedSendPulsePageFallback({
     reader:existingSendPulsePageReader(),
     pageId:verified.page.pageId,
     providerPeerId:item.customerFromId
    })
    if(source?.messages.length){
     // Only already provider-verified text and this same authenticated
     // Page+peer may refresh the existing preview during a Pancake 429.
     rememberVerifiedPagePreview(input,verified.page,verified.scope.revision,
      item.roomId,source.messages.map(m=>({
       mid:m.mid,original:m.text,matrixTimestamp:m.timestamp
      })))
     recentlyVerifiedPageMessages.delete(input.accountRef+'|'+input.roomRef)
     return {schema:1,channel:'Page',source:'YENRA_FB_OFFICIAL',
      accountRef:input.accountRef,roomRef:input.roomRef,
      name:limited(item.displayName,100)||null,
      nameKnown:Boolean(item.displayName&&!item.displayName.startsWith('Page 会话')),
      readOnly:true,canSend:false,partial:true,updatedAt:null,
      officialFresh:false,historicalOnly:false,
      messages:source.messages} as Room
    }
   }catch{/* Keep the original 429 if SendPulse is also temporarily unavailable. */}
  }
  // Only if no independently verified current messages are available,
  // show old W25 text explicitly as historical/non-fresh.
  const historical=await pageHistoricalFallback(input,verified,item)
  if(historical){
   // A historical fallback must never authorize source-based paid translations.
   recentlyVerifiedPageMessages.delete(input.accountRef+'|'+input.roomRef)
   return historical
  }
  throw e
 }
 if(current?.ok!==true||current.roomId!==item.roomId)throw Error('PAGE_ROOM_NOT_AUTHENTICATED')
 // Exact verified provider room: update the SAME Host roster preview without
 // a second contact fetch, translation or message database.
 rememberVerifiedPagePreview(input,page,revision,item.roomId,current.messages)
  recentlyVerifiedPageMessages.set(input.accountRef+'|'+input.roomRef,{
   accountRef:input.accountRef,roomRef:input.roomRef,revision,time:Date.now(),
   exact:new Set(current.messages.filter((m:any)=>typeof m.mid==='string'&&
     typeof m.original==='string').map((m:any)=>sha(JSON.stringify([
       m.mid,createHash('sha256').update(m.original,'utf8').digest('hex')
     ]))))
 })
 if(recentlyVerifiedPageMessages.size>80)
   recentlyVerifiedPageMessages.delete(recentlyVerifiedPageMessages.keys().next().value!)
 // Original DSH translation-domain service restores exact verified W25 MID/text
 // translations separately for visible bubbles. A synchronous W25 SQLite query
 // must not delay this already-authenticated live Page provider response.
 // Original history-only fallback remains in pageHistoricalFallback above.
 // W25 full history is reference-only and must never hold up live messages.
 return {schema:1,channel:'Page',source:'YENRA_FB_OFFICIAL',accountRef:input.accountRef,roomRef:input.roomRef,
  name:limited(item.displayName,100)||null,nameKnown:Boolean(item.displayName&&!item.displayName.startsWith('Page 会话')),
  readOnly:true,canSend:false,partial:Boolean(account.partial),updatedAt:null,
  messages:current.messages.map((m:any)=>({
   mid:limited(m.mid,180),text:limited(m.original,4000),timestamp:timestamp(m.matrixTimestamp),
   direction:m.direction==='OUTBOUND'?'OUTBOUND':'INBOUND',
   // Same authenticated provider response, exact Page/customer watermark.
   ...(m.direction==='OUTBOUND'&&
     m.verifiedAckSource==='PANCAKE_OFFICIAL_CUSTOMER_READ_WATERMARK'&&
     m.verifiedDeliveryStatus==='READ'&&m.verifiedAckKind==='READ'?{
       verifiedDeliveryStatus:'READ',verifiedAckKind:'READ',
       verifiedAckSource:'PANCAKE_OFFICIAL_CUSTOMER_READ_WATERMARK',
       ...(Number.isSafeInteger(m.verifiedAckObservedAt)&&m.verifiedAckObservedAt>0?
         {verifiedAckObservedAt:m.verifiedAckObservedAt}:{})
     }:{}),
   // Translation is asynchronous via the existing DSH Storage Domain/W25 verified reader.
   // Official SDK has already verified Page/room/sender and normalized media.
   // Preserve its exact HTTPS provider URL for *on-demand* native playback.
   media:(Array.isArray(m.media)?m.media:[]).slice(0,8).flatMap((x:any)=>{
    if(!x||!['image','video','audio','file','sticker'].includes(x.type)||typeof x.url!=='string')return []
    try{
     const url=new URL(x.url),host=url.hostname.toLowerCase()
     const allowed=host==='content.pancake.vn'||host==='cdn.fbsbx.com'||
       host==='fbcdn.net'||host.endsWith('.fbcdn.net')
     return allowed&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port
       ?[{type:x.type,url:url.href}]:[]
    }catch{return []}
   }),
   attachmentMeta:(Array.isArray(m.attachmentMeta)?m.attachmentMeta:[]).slice(0,8),
   // Already-authorized Page SDK share metadata. Never enrich from an
   // unauthenticated preview fetch or fabricate missing cover/title.
   sharePreviews:(Array.isArray(m.sharePreviews)?m.sharePreviews:[]).slice(0,4).flatMap((s:any)=>{
    if(!s||typeof s.url!=='string'||s.url.length>2000)return []
    try{
     const u=new URL(s.url),host=u.hostname.toLowerCase()
     if(u.protocol!=='https:'||u.username||u.password||u.port||
       !['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch'].includes(host))return []
     const result:any={url:u.href}
     for(const key of ['title','source','description']){
      if(typeof s[key]==='string'&&s[key].length<=500)result[key]=s[key]
     }
     if(typeof s.image==='string'&&s.image.length<=2000){
      try{
       const img=new URL(s.image),h=img.hostname.toLowerCase()
       if(img.protocol==='https:'&&!img.username&&!img.password&&!img.port&&
        (h==='content.pancake.vn'||h==='cdn.fbsbx.com'||h==='fbcdn.net'||h.endsWith('.fbcdn.net')))
        result.image=img.href
      }catch{}
     }
     return [result]
    }catch{return []}
   })
  })).filter((m:any)=>m.mid).sort((a:any,b:any)=>a.timestamp-b.timestamp).slice(-100)}
}

/** Original Host-only translation authorization. Always checks the current
 * account and room, and for existing messages exact MID + original source.
 * Personal reads the existing Matrix room once per batch. Page NEVER requests
 * provider data just to translate; only a previously authenticated room
 * message batch can authorize a paid call.
 */
export async function verifyFacebookTranslationSource(args:{
 channel:'Personal'|'Page';accountRef:string;roomRef:string;
 direction:'to-zh'|'to-de';items:Array<{id:string;text:string}>;cachedOnly?:boolean
}):Promise<void>{
 if(!REF.test(args.accountRef)||!REF.test(args.roomRef)||
   args.items.length>8)throw Error('FACEBOOK_TRANSLATION_REFERENCE_INVALID')
 if(args.channel==='Personal'){
  const {account,rows,sdk}=await personalRows()
  if(account.accountRef!==args.accountRef)throw Error('PERSONAL_ACCOUNT_NOT_VERIFIED')
  const item=rows.find((r:any)=>sha(account.accountRef+'\0'+r.roomId)===args.roomRef)
  if(!item)throw Error('PERSONAL_ROOM_NOT_VERIFIED')
  if(args.direction==='to-de')return
  const recent=recentlyVerifiedPersonalMessages
  if(recent&&recent.accountRef===args.accountRef&&
    recent.roomRef===args.roomRef&&Date.now()-recent.time<90_000){
   if(args.items.some(q=>!recent.exact.has(
     sha(JSON.stringify([q.id,keyOfTranslationOriginal(q.text)])))))
     throw Error('PERSONAL_MESSAGE_SOURCE_NOT_VERIFIED')
   return
  }
  const timeline=await sdk.readOfficialFacebookMessages(item.roomId)
  if(timeline?.ok!==true||timeline.roomId!==item.roomId)
   throw Error('PERSONAL_MESSAGE_SCOPE_NOT_VERIFIED')
  if(args.items.some(q=>!timeline.messages.some((m:any)=>
     m.mid===q.id&&m.original===q.text)))
   throw Error('PERSONAL_MESSAGE_SOURCE_NOT_VERIFIED')
  return
 }
 const {scope,page}=await getPageScope(args.accountRef) // Original DPAPI; zero Page HTTP.
 const actual=sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+scope.revision)
 if(actual!==args.accountRef)throw Error('PAGE_ACCOUNT_NOT_VERIFIED')
 if(args.cachedOnly===true){
  // Already-authorized read-only Domain/W25 translation lookup does NOT
  // require a fresh provider GET. Reuse existing current-revision SDK roster,
  // original DSH persisted hints, and original VERIFIED W25 binding only.
  // A paid translation still follows the strict recent MID+SHA proof below.
  const saved=recentPageRows.get(actual)?.value
  const roster=saved?.account.accountRef===actual&&
    saved.revision===scope.revision&&
    saved.page.pageId===page.pageId&&saved.page.accountName===page.accountName
    ?saved.rows.find((row:any)=>typeof row?.roomId==='string'&&
      sha(actual+'\0'+row.roomId)===args.roomRef):null
  const hint=roster??(pageHints
    ?await pageHints.byOpaqueRef(scope,actual,args.roomRef):null)??
    verifiedW25PageContact(scope,args.roomRef,true)
  if(!hint||typeof hint.roomId!=='string'||
     !hint.roomId.startsWith('page:'+page.pageId+':')||
     hint.pageId!==page.pageId||hint.accountName!==page.accountName||
     String(hint.bindingRevision)!==String(scope.revision)||
     hint.channel!=='FB_PAGE'||hint.source!=='PANCAKE_OFFICIAL_READ_ONLY'||
     hint.canSend!==false||sha(actual+'\0'+hint.roomId)!==args.roomRef)
    throw Error('PAGE_CACHED_TRANSLATION_ROOM_NOT_VERIFIED')
  return
 }
 const recent=recentlyVerifiedPageMessages.get(args.accountRef+'|'+args.roomRef)
 if(!recent||recent.accountRef!==actual||recent.roomRef!==args.roomRef||
   recent.revision!==scope.revision||Date.now()-recent.time>180_000)
   throw Error('PAGE_ROOM_MUST_BE_OPENED_WITH_ORIGINAL_SDK')
 if(args.direction==='to-zh'&&args.items.some(q=>
   !recent.exact.has(sha(JSON.stringify([q.id,keyOfTranslationOriginal(q.text)])))))
   throw Error('PAGE_MESSAGE_SOURCE_NOT_VERIFIED')
}
const keyOfTranslationOriginal=(text:string)=>
 createHash('sha256').update(text,'utf8').digest('hex')

/** Existing user-click senders: original Matrix/Messenger and Pancake.
 * Each request resolves CURRENT account + opaque room refs again. No second Sender,
 * no AI auto-hosting switch, no repeated per-contact permission prompts.
 */
function manualParams(raw:string){
 if(raw.length>5200)throw Error('FACEBOOK_SEND_REQUEST_TOO_LONG')
 const v:unknown=JSON.parse(raw)
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('FACEBOOK_SEND_BAD_REQUEST')
 const q=v as Record<string,unknown>
 const keys=Object.keys(q).sort().join('|')
 if(!['accountRef|roomRef|text','accountRef|replyToMessageId|roomRef|text'].includes(keys)||
  typeof q.accountRef!=='string'||typeof q.roomRef!=='string'||
  !REF.test(q.accountRef)||!REF.test(q.roomRef)||typeof q.text!=='string'||
  !q.text.trim()||q.text.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(q.text)||
  (q.replyToMessageId!==undefined&&
    (typeof q.replyToMessageId!=='string'||!/^\$[^\s]{5,240}$/.test(q.replyToMessageId))))
   throw Error('FACEBOOK_SEND_INVALID_ACCOUNT_OR_MESSAGE')
 return {accountRef:q.accountRef,roomRef:q.roomRef,text:q.text,
   ...(typeof q.replyToMessageId==='string'?{replyToMessageId:q.replyToMessageId}:{})}
}
async function personalManualSend(q:ReturnType<typeof manualParams>){
 const {account,rows}=await personalRows()
 if(q.accountRef!==account.accountRef)throw Error('PERSONAL_ACCOUNT_CHANGED')
 const item=rows.find((r:any)=>sha(account.accountRef+'\0'+r.roomId)===q.roomRef)
 if(!item)throw Error('PERSONAL_ROOM_CHANGED')
 const sender=await loadMatureModule(PERSONAL_SENDER)
 if(typeof sender.sendV2AuthenticatedBrowserMessage!=='function')throw Error('ORIGINAL_PERSONAL_SENDER_MISSING')
 const result=await sender.sendV2AuthenticatedBrowserMessage({
  roomId:item.roomId,text:q.text,requestId:randomUUID(),authenticatedBrowserAction:true,
  ...(q.replyToMessageId?{replyToEventId:q.replyToMessageId}:{})
 })
 if(result?.matrixAccepted!==true)return error('Matrix 提交未确认；请查看原渠道，勿自动重发')
 return {kind:'success' as const,text:'YENRA_SOCIAL_SEND_V1:'+JSON.stringify({
  schema:1,channel:'Personal',accountRef:q.accountRef,roomRef:q.roomRef,
  sent:true,submitted:true,deliveryStatus:'UNKNOWN',matrixAccepted:true,
  delivered:false,providerMessageId:null,matrixEventId:result.matrixEventId??null
 })}
}
async function pageManualSend(q:ReturnType<typeof manualParams>){
 if(q.replyToMessageId)throw Error('PAGE_QUOTED_SENDER_NOT_AVAILABLE_KEEP_DRAFT')
 // Reuse the original SDK's scope-verified EXISTING roster rather than
 // triggering an extra fetchContacts before the original Sender. Its native
 // handler independently rechecks current scope, contacts AND room history.
 const {account,rows,sdk}=await verifiedAvatarPageRows(false,q.accountRef)
 if(q.accountRef!==account.accountRef)throw Error('PAGE_ACCOUNT_CHANGED')
 const item=rows.find((r:any)=>sha(account.accountRef+'\0'+r.roomId)===q.roomRef)
 if(!item)throw Error('PAGE_ROOM_CHANGED')
 const sender=await loadMatureModule(PAGE_SENDER)
 if(typeof sender.createPancakeManualSendHandler!=='function')throw Error('ORIGINAL_PAGE_SENDER_MISSING')
 const {store,env}=await pageSdk()
 const peer={originalUserClick:'DSH_NATIVE_COMPOSER'}
 const connection={browserPeer:peer,admit:()=>({peer})}
 const read=(accountName:string,pageId:string)=>store.accountStoreOp('read',{accountName,pageId},env)
 const handler=sender.createPancakeManualSendHandler({connection,pageInbox:sdk,readAccountPair:read})
 const req=Readable.from([JSON.stringify({roomId:item.roomId,text:q.text,requestId:randomUUID()})]) as any
 req.method='POST'
 req.url='/native-page-manual'
 req.headers={origin:'dsh-app://app','content-type':'application/json',
  'x-yance-user-action':'PAGE_MANUAL_SEND_CLICK'}
 const receipt:any=await new Promise((resolve,reject)=>{
  let status=0
  const res={headersSent:false,
   writeHead(code:number){status=code;this.headersSent=true;return this},
   end(raw:string){try{resolve({status,data:JSON.parse(raw)})}catch(e){reject(e)}}
  }
  Promise.resolve(handler(req,res)).catch(reject)
 })
 if(receipt.data?.ok!==true||receipt.data?.state!=='ACCEPTED'||receipt.data?.providerAccepted!==true)
  return error('Page 平台提交未确认：'+limited(receipt.data?.error??receipt.data?.state,80)+'；请查看原渠道，勿自动重发')
 return {kind:'success' as const,text:'YENRA_SOCIAL_SEND_V1:'+JSON.stringify({
  schema:1,channel:'Page',accountRef:q.accountRef,roomRef:q.roomRef,
  sent:true,submitted:true,deliveryStatus:'UNKNOWN',providerAccepted:true,
  delivered:false,providerMessageId:receipt.data.providerMid??null
 })}
}

/** One verified text dispatch shared by the existing slash Command and the
 * native owner-click WebServer route. Neither creates a Sender or a Session. */
export async function sendVerifiedFacebookTextClick(
 raw:string,claimedChannel?:'Personal'|'Page'
){
 const q=manualParams(raw)
 const personalRef=sha('FB_PERSONAL|W56|@w56_internal_fb_bridge:yance-w26.invalid')
 if(q.accountRef===personalRef){
  if(claimedChannel&&claimedChannel!=='Personal')return error('原生渠道与账号不匹配')
  return personalManualSend(q)
 }
 if(claimedChannel==='Personal')return error('原生渠道与账号不匹配')
 const page=await getPageScope(q.accountRef).catch(()=>null)
 if(page&&pageAccountRef(page.page,page.scope.revision)===q.accountRef)
   return pageManualSend(q)
 return error('原账号或联系人已变化，刷新联系人后才能发送')
}

/** Exact verified mapping for the EXISTING Matrix account_data preferences.
 * Page uses the already-verified in-memory SDK roster and current DPAPI scope:
 * opening a right-click menu never calls fetchContacts or Page provider HTTP.
 * Current Sender scope remains separate and independently reverified.
 */
export async function resolveExistingFacebookContactPreferenceRoom(args:{
 accountRef:string;roomRef:string
}):Promise<{channel:'Personal'|'Page';accountRef:string;roomRef:string;
 nativeRoomId:string;pageOwnerHash?:string}|null>{
 if(!REF.test(args.accountRef)||!REF.test(args.roomRef))return null
 const personalRef=sha('FB_PERSONAL|W56|@w56_internal_fb_bridge:yance-w26.invalid')
 if(args.accountRef===personalRef){
  const {account,rows}=await personalRows()
  if(account.accountRef!==args.accountRef)return null
  const row=rows.find((r:any)=>sha(account.accountRef+'\0'+r.roomId)===args.roomRef)
  return row?{channel:'Personal',accountRef:args.accountRef,
    roomRef:args.roomRef,nativeRoomId:row.roomId}:null
 }
 const {scope,page}=await getPageScope(args.accountRef) // DPAPI proof only. No Page contact HTTP.
 const actual=sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+scope.revision)
 if(actual!==args.accountRef)return null
 const cached=recentPageRows.get(actual)?.value
 const row=cached?.account.accountRef===actual
  ?cached.rows.find((r:any)=>sha(actual+'\0'+r.roomId)===args.roomRef):null
 let nativeRoomId: string|undefined=row?.roomId
 // Newer verified contacts can exist in the ORIGINAL DSH Storage Domain
 // even when absent from the older W25 snapshot. The existing Page identity
 // hint validates DPAPI revision, original signed SDK source, exact room ref,
 // and 30-day age before returning. Never perform Page HTTP at this gate.
 if(!nativeRoomId&&pageHints){
  const hint=await pageHints.byOpaqueRef(scope,actual,args.roomRef)
  if(hint&&hint.pageId===page.pageId&&
     hint.accountName===page.accountName&&
     String(hint.bindingRevision)===String(scope.revision)&&
     hint.channel==='FB_PAGE'&&hint.source==='PANCAKE_OFFICIAL_READ_ONLY'&&
     hint.readOnly===true&&hint.canSend===false&&
     sha(actual+'\0'+hint.roomId)===args.roomRef)
    nativeRoomId=hint.roomId
 }
 // When Page 429 temporarily prevents a fresh roster or DSH restarts, reuse
 // only the ALREADY VERIFIED W25 readonly Page roster index tied to CURRENT
 // DPAPI accountName/pageId/revision. No Page API request or second DB.
 if(!nativeRoomId){
  try{
   const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
   if(config.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
      config.sqliteOpenMode!=='readOnly'||config.allowMutateSource!==false||
      config.historicalOnly!==true||config.canSend!==false)return null
   const db=new DatabaseSync(config.sourcePath,{readOnly:true})
   try{
    db.exec('PRAGMA query_only=ON')
    const index=db.prepare('SELECT contacts_json FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
      .get(page.pageId,page.accountName,scope.revision) as any
    if(typeof index?.contacts_json!=='string')return null
    const contacts=JSON.parse(index.contacts_json)
    if(!Array.isArray(contacts)||contacts.length>500)return null
    nativeRoomId=contacts.find((c:any)=>typeof c?.roomId==='string'&&
      c.roomId.startsWith('page:')&&
      String(c.pageId)===String(page.pageId)&&
      c.accountName===page.accountName&&
      String(c.bindingRevision)===String(scope.revision)&&
      sha(actual+'\0'+c.roomId)===args.roomRef)?.roomId
   }finally{db.close()}
  }catch{return null}
 }
 if(!nativeRoomId)return null
 const pageOwnerHash=createHash('sha256').update('YANCE_OWNER_PAGE_PREFS_V1|'+
   page.pageId+'|'+page.accountName).digest('hex')
 return {channel:'Page',accountRef:actual,roomRef:args.roomRef,
   nativeRoomId,pageOwnerHash}
}

/** Enrich ONLY a same-account verified, existing DSH display snapshot.
 * This does not contact Pancake or grant private data access to an MCP tool.
 * Original protected Host scope is rechecked before any W25 history is read.
 */
export async function restoreVerifiedCachedPagePreviewsFromW25<
 T extends {accountRef:string;rooms:Array<{roomRef:string;latestText:string|null}>}
>(account:T):Promise<T>{
 if(!REF.test(account.accountRef)||!Array.isArray(account.rooms)||
    !account.rooms.length)return account
 try{
  const {scope,page}=await getPageScope(account.accountRef)
  return mergeVerifiedPageHistoricalPreviews({scope,page,account}) as T
 }catch{return account}
}

/** Exact historical MID/source proof for the original DSH idle cache reader.
 * No provider GET, new database, model call or W25 write. A historical
 * preview is eligible only when the current authenticated snapshot displays
 * precisely that W25 text AND still carries the matching message timestamp.
 */
export type VerifiedHistoricalPagePreviewSource={
 accountRef:string;roomRef:string;id:string;source:string;displayed:string;at:number|null
}
export async function readVerifiedHistoricalPagePreviewSources(account:{
 accountRef:string;
 rooms:Array<{roomRef:string;latestText:string|null;lastMessageAt:number|null}>
}):Promise<VerifiedHistoricalPagePreviewSource[]>{
 if(!REF.test(account.accountRef)||!Array.isArray(account.rooms)||
    !account.rooms.length||account.rooms.length>500)return []
 // The ORIGINAL SDK checks the Page scope both before and AFTER the
 // historical Domain/W25 read, including mid-read account revocation.
 try{return await withVerifiedPageRead(async()=>{
  const {scope,page}=await getPageScope(account.accountRef)
  if(sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+scope.revision)!==account.accountRef)
   return []
  const cfg=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
  if(cfg.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
     cfg.sqliteOpenMode!=='readOnly'||cfg.allowMutateSource!==false||
     cfg.historicalOnly!==true||cfg.canSend!==false)return []
  const db=new DatabaseSync(cfg.sourcePath,{readOnly:true})
  try{
   db.exec('PRAGMA query_only=ON')
   const result=db.prepare('SELECT contacts_json FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
    .get(page.pageId,page.accountName,scope.revision) as any
   if(typeof result?.contacts_json!=='string'||result.contacts_json.length>350000)return []
   const rows=JSON.parse(result.contacts_json)
   if(!Array.isArray(rows)||rows.length>500)return []
   const oldByOpaque=new Map<string,any>()
   for(const c of rows){
    if(!c||typeof c.roomId!=='string'||!c.roomId.startsWith('page:'+page.pageId+':')||
       c.pageId!==page.pageId||c.accountName!==page.accountName||
       String(c.bindingRevision)!==String(scope.revision)||
       c.channel!=='FB_PAGE'||c.source!=='PANCAKE_OFFICIAL_READ_ONLY'||
       c.readOnly!==true||c.canSend!==false)continue
    oldByOpaque.set(sha(account.accountRef+'\0'+c.roomId),c)
   }
   const latest=new Map<string,{provider_mid:string;original_text:string}>()
   const messages=db.prepare(`SELECT peer_id,provider_mid,original_text FROM inbound_messages
    WHERE channel='FB_PAGE' AND account_id=? AND binding_revision=?
    ORDER BY COALESCE(message_at,received_at) DESC,id DESC LIMIT 12000`)
    .all('pancake:'+page.accountName+':'+page.pageId,String(scope.revision)) as any[]
   for(const msg of messages){
    if(typeof msg.peer_id==='string'&&!latest.has(msg.peer_id))
     latest.set(msg.peer_id,msg)
   }
   const out:VerifiedHistoricalPagePreviewSource[]=[]
   for(const room of account.rooms){
    if(!REF.test(room.roomRef))continue
    const c=oldByOpaque.get(room.roomRef)
    if(!c||typeof c.lastMessage!=='string'||!c.lastMessage.trim())continue
    const oldAt=timestamp(c.lastMessageTimestamp),shownAt=timestamp(room.lastMessageAt)
    if(!oldAt||!shownAt||Math.abs(oldAt-shownAt)>=1500)continue
    let peer=''
    try{peer=decodeURIComponent(c.roomId.slice(('page:'+page.pageId+':').length))}
    catch{continue}
    const m=latest.get(peer)
    if(!m||typeof m.provider_mid!=='string'||m.provider_mid.length>180||
       typeof m.original_text!=='string'||m.original_text.length>1200||
       m.original_text!==c.lastMessage)continue
    const displayed='历史 · '+limited(c.lastMessage,235)
    if(room.latestText!==displayed)continue
    out.push({accountRef:account.accountRef,roomRef:room.roomRef,
      id:m.provider_mid,source:m.original_text,displayed,at:room.lastMessageAt})
   }
   return out
  }finally{db.close()}
 })}catch{return []}
}

/** One existing authenticated Facebook SDK roster read for the native OSS UI.
 * The caller merges by stable display identity and never drops a previously
 * verified Page merely because an SDK/DPAPI read temporarily failed.
 * Manual Sender always rechecks the original revision-bound accountRef.
 */
export async function readExistingFacebookRosterForOss(
 matrixSnapshot?:Promise<{revision:number;rooms:Record<string,any>}|null>,
 forcePageSource=false
){
 const accounts:Account[]=[],failures:string[]=[]
 const outcomes=await Promise.allSettled([
   // A cached view is the default; explicit Host refresh=1 must actually
   // read the original provider again, not replay its previous SDK snapshot.
   personalRows(),withVerifiedPageRead(()=>verifiedAllPageRows(forcePageSource)),
 ])
 const prefs=matrixSnapshot?await matrixSnapshot.catch(()=>null):null
 for(let i=0;i<outcomes.length;i++){
  const outcome=outcomes[i]
  if(outcome.status!=='fulfilled'){
   const reason=String(outcome.reason?.message??'UNKNOWN')
   const code=/^[A-Z][A-Z0-9_]{3,90}$/.test(reason)?reason:'UNCLASSIFIED'
   failures.push((i===0?'Personal':'Page')+'_ORIGINAL_SDK_TEMPORARILY_UNAVAILABLE:'+code)
   continue
  }
  const sources=i===0?[outcome.value]:outcome.value as PageRowsResult[]
  for(const source of sources){
   // A verified but partial original Page roster is stale, not synchronized.
   if(source.account.channel==='Page'&&source.account.partial===true)
     failures.push('Page_ORIGINAL_SOURCE_PARTIAL')
   const page='page' in source?source.page:null
   const ownerHash=page?createHash('sha256').update(
      'YANCE_OWNER_PAGE_PREFS_V1|'+page.pageId+'|'+page.accountName).digest('hex'):null
   const rooms=source.account.rooms.map((room,index)=>{
    const nativeId=source.rows[index]?.roomId
    const stored=typeof nativeId==='string'&&prefs?.rooms
      ?Object.hasOwn(prefs.rooms,nativeId)?prefs.rooms[nativeId]:null:null
    if(!stored||typeof stored!=='object'||Array.isArray(stored)||
       (source.account.channel==='Page'&&stored.pageOwnerHash!==ownerHash))return room
    return {...room,contactPreferences:{
      pinned:stored.pinned===true,muted:stored.muted===true,
      archived:stored.archived===true,manualUnread:stored.manualUnread===true,
    }}
   })
   accounts.push({...source.account,rooms})
  }
 }
 return {accounts,partial:failures.length>0,failures}
}
/**
 * Cold-start fallback when the ORIGINAL Page provider temporarily rejects a
 * roster refresh (e.g. 429). Reuse the already-authorized cached DSH roster,
 * ONE existing Matrix account_data snapshot and original read-only W25
 * verified room index. Never query the provider, create a new DB or infer
 * another account's contact preferences.
 */
export async function restoreVerifiedCachedPagePrefsFromW25<
 T extends {accountRef:string;rooms:Array<{roomRef:string;contactPreferences?:{
   pinned:boolean;muted:boolean;archived:boolean;manualUnread:boolean}}>}
>(account:T,matrix:{revision:number;rooms:Record<string,any>}|null):Promise<T>{
 if(!matrix||!REF.test(account.accountRef)||!Array.isArray(account.rooms)||
    account.rooms.length>LIST_LIMIT)return account
 try{
  const {scope,page}=await getPageScope(account.accountRef) // original DPAPI scope; no Page contact HTTP
  const currentRef=sha('FB_PAGE|'+page.accountName+'|'+page.pageId+'|'+scope.revision)
  if(account.accountRef!==currentRef)return account
  const config=JSON.parse(readFileSync(join(ROOT,'config','W25_READONLY_SOURCE.json'),'utf8'))
  if(config.sourceKind!=='W25_CONSISTENT_HISTORY_SNAPSHOT'||
     config.sqliteOpenMode!=='readOnly'||config.allowMutateSource!==false||
     config.historicalOnly!==true||config.canSend!==false)return account
  const db=new DatabaseSync(config.sourcePath,{readOnly:true})
  let record:any
  try{
   db.exec('PRAGMA query_only=ON')
   record=db.prepare('SELECT contacts_json FROM page_verified_roster_index WHERE page_id=? AND account_name=? AND binding_revision=? LIMIT 1')
     .get(page.pageId,page.accountName,scope.revision)
  }finally{db.close()}
  if(typeof record?.contacts_json!=='string'||record.contacts_json.length>350000)return account
  const index:unknown=JSON.parse(record.contacts_json)
  if(!Array.isArray(index)||index.length>LIST_LIMIT)return account
  const ownerHash=createHash('sha256').update('YANCE_OWNER_PAGE_PREFS_V1|'+
    page.pageId+'|'+page.accountName).digest('hex')
  const matches=new Map<string,{pinned:boolean;muted:boolean;archived:boolean;manualUnread:boolean}>()
  for(const row of index){
   if(!row||typeof row!=='object'||typeof row.roomId!=='string'||
      !row.roomId.startsWith('page:')||String(row.pageId)!==String(page.pageId)||
      row.accountName!==page.accountName||
      String(row.bindingRevision)!==String(scope.revision))continue
   const saved=Object.hasOwn(matrix.rooms,row.roomId)?matrix.rooms[row.roomId]:null
   if(!saved||typeof saved!=='object'||Array.isArray(saved)||
      saved.pageOwnerHash!==ownerHash)continue
   matches.set(sha(account.accountRef+'\0'+row.roomId),{
     pinned:saved.pinned===true,muted:saved.muted===true,
     archived:saved.archived===true,manualUnread:saved.manualUnread===true,
   })
  }
  // Only map the exact currently verified original roomRef, never add a
  // contact and never overwrite a more recent confirmed in-memory choice.
  for(const room of account.rooms){
   if(room.contactPreferences)continue
   const saved=matches.get(room.roomRef)
   if(saved)room.contactPreferences=saved
  }
 }catch{/* Original W25 and DPAPI unavailable: retain the cached roster. */}
 return account
}

/** Original mature Page media Sender, ONE handler per SDK lifecycle so its
 * original room busy lock and irreversible one-attempt ledger are respected.
 * Never initialize a second Page credential store, WebServer or Sender.
 */
let pageMediaHandler:Promise<any>|undefined
async function getOriginalPageMediaHandler(){
 if(!pageMediaHandler)pageMediaHandler=(async()=>{
  const {sdk,store,env}=await pageSdk()
  const sender=await loadMatureModule(LEGACY_PAGE+'native-page-media-send.mjs')
  if(typeof sender.createPageMediaSendHandler!=='function')
   throw Error('ORIGINAL_PAGE_MEDIA_SENDER_UNAVAILABLE')
  const peer={source:'ORIGINAL_DSH_OWNER_CLICK'},connection={
   browserPeer:peer,admit:()=>({peer})
  }
  return sender.createPageMediaSendHandler({
   connection,pageInbox:sdk,
   readAccountPair:(accountName:string,pageId:string)=>
      store.accountStoreOp('read',{accountName,pageId},env)
  })
 })().catch(e=>{pageMediaHandler=undefined;throw e})
 return pageMediaHandler
}
async function submitOriginalPageMedia({
 roomId,mime,filename,bytes,requestId,
}:{
 roomId:string;mime:string;filename:string;bytes:Buffer;requestId:string
}):Promise<{status:number;data:any}>{
 const handler=await getOriginalPageMediaHandler()
 const req=Readable.from([bytes]) as any
 req.method='POST';req.url='/native-page-media'
 req.headers={
  host:'127.0.0.1:9230',origin:'dsh-app://app',
  'content-type':mime,'x-yance-user-action':'PAGE_MANUAL_MEDIA_SEND_CLICK',
  'x-yance-room':roomId,'x-yance-request-id':requestId,
  'x-yance-filename':encodeURIComponent(filename)
 }
 return await new Promise((resolve,reject)=>{
  let status=0
  const res:any={
   headersSent:false,writeHead(n:number){status=n;this.headersSent=true;return this},
   end(raw:string){try{resolve({status,data:JSON.parse(raw)})}catch(e){reject(e)}}
  }
  Promise.resolve(handler(req,res)).catch(reject)
 })
}
function parseNativeFacebookMediaRequest(raw:string){
 if(typeof raw!=='string'||raw.length<40||raw.length>11_300_000)
  throw Error('FACEBOOK_MEDIA_REQUEST_SIZE_INVALID')
 const value:unknown=JSON.parse(raw)
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('FACEBOOK_MEDIA_REQUEST_INVALID')
 const q=value as Record<string,unknown>
 if(!['accountRef|fileName|media|mediaType|mimeType|roomRef',
       'accountRef|caption|fileName|media|mediaType|mimeType|roomRef'].includes(
         Object.keys(q).sort().join('|'))||
   typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
   typeof q.roomRef!=='string'||!REF.test(q.roomRef)||
   typeof q.media!=='string'||typeof q.fileName!=='string'||
   typeof q.mimeType!=='string'||typeof q.mediaType!=='string'||
   (q.caption!==undefined&&typeof q.caption!=='string'))
   throw Error('FACEBOOK_MEDIA_ACCOUNT_OR_INPUT_INVALID')
 if(!['image','document'].includes(q.mediaType))
   throw Error('ORIGINAL_FB_VIDEO_AUDIO_MEDIA_SEND_UNSUPPORTED_KEEP_DRAFT')
 return {
  accountRef:q.accountRef,roomRef:q.roomRef,
  payload:{to:q.roomRef,mediaType:q.mediaType,media:q.media,
   fileName:q.fileName,mimeType:q.mimeType,
   ...(typeof q.caption==='string'?{caption:q.caption}:{})}
 }
}
/** The SAME existing mature media bridge and exact account/room resolver.
 * Do not register an alternative Sender; this is only a user-click Host adapter.
 */
async function submitExistingFacebookMediaClick(q:ReturnType<typeof parseNativeFacebookMediaRequest>){
 const bridge=createExistingFacebookMediaSendBridge({
  resolveVerifiedRoom:resolveExistingFacebookContactPreferenceRoom,
  submitPageMedia:submitOriginalPageMedia,
  submitPersonalMedia:async(args:any)=>{
   const original=await loadMatureModule(PERSONAL_SENDER)
   if(typeof original.sendV2AuthenticatedBrowserMessage!=='function')
    throw Error('ORIGINAL_PERSONAL_MEDIA_SENDER_UNAVAILABLE')
   return original.sendV2AuthenticatedBrowserMessage(args)
  }
 })
 return bridge({hostContext:{accountRef:q.accountRef,ownerClickAuthorized:true},
  payload:q.payload})
}
/** Exact existing Facebook Owner media bridge shared with the official
 * DSH WebServer route. Not an Agent/tool Sender.
 */
export async function sendVerifiedFacebookMediaClick(
 raw:string,claimedChannel:'Personal'|'Page'
){
 const request=parseNativeFacebookMediaRequest(raw)
 // Check the claimed channel BEFORE the irreversible upload boundary.
 // The existing verified native room resolver checks the SAME authenticated
 // Matrix/DPAPI authority and optional W25 readonly Page index (zero Page HTTP).
 const binding=await resolveExistingFacebookContactPreferenceRoom({
  accountRef:request.accountRef,roomRef:request.roomRef
 })
 if(!binding||binding.channel!==claimedChannel)
  throw Error('ORIGINAL_FB_CHANNEL_ACCOUNT_ROOM_MISMATCH_KEEP_DRAFT')
 const accepted=await submitExistingFacebookMediaClick(request)
 if(accepted?.ok!==true||accepted.state!=='ACCEPTED'||
   accepted.providerAccepted!==true||accepted.providerDelivered!==false)
  throw Error('ORIGINAL_FB_MEDIA_SUBMISSION_UNCONFIRMED_DO_NOT_RETRY')
 return {
  schema:1,channel:accepted.channel,accountRef:request.accountRef,
  roomRef:request.roomRef,submitted:true,sent:true,delivered:false,
  deliveryStatus:'UNKNOWN',requestId:accepted.requestId,
  providerMessageId:accepted.providerMid??null
 }
}
export function registerFacebookSocialCommands(ctx:Context):void{
  ctx.inject(['storageDomain'],scope=>scope.effect(()=>{
   let domain:Promise<any>|undefined
   const openTable=async()=>{
    if(!domain){
     const provider=scope.get('storageDomain')
     if(!provider)throw Error('OFFICIAL_DSH_STORAGE_UNAVAILABLE')
     domain=provider.open(pageIdentitySpec)
     domain.catch(()=>{domain=undefined})
    }
    return (await domain).table('entries')
   }
   const holder=createOriginalPageIdentityHints({
    openTable,refOf:pageAccountRef,sha,now:Date.now
   })
   pageHints=holder
   return ()=>{
    if(pageHints===holder)pageHints=undefined
    holder.clear()
    if(domain)void domain.then(d=>d.close()).catch(()=>{})
   }
  },'YENRA Page original SDK identity hints in official DSH Storage Domain'))
  // The EXISTING mature Pancake source validates HMAC, Page membership, and
  // provider MIDs. This is a single DSH Host route, NOT a listener/socket/poller.
  ctx.inject(['webServer'],scope=>scope.effect(()=>{
    let originalRealtime:Promise<any>|null=null
    const getOriginalRealtime=()=>{
      if(originalRealtime)return originalRealtime
      originalRealtime=(async()=>{
        const {sdk}=await pageSdk()
        const {createPageRealtime}=await loadMatureModule(LEGACY_PAGE+'page-realtime.mjs') as any
        return createPageRealtime({
          // For a FIRST-TIME conversation, the webhook's signed ID is only
          // a candidate. The original SDK must still authenticate it via
          // provider GET before ANY inbox event can be displayed.
          pageInbox:{
            scope:()=>sdk.scope(),
            lookupCachedRoom:(pageId:string,conversationId:string)=>{
              const cached=sdk.lookupCachedRoom(pageId,conversationId)
              if(cached)return cached
              if(!/^\d{5,40}$/.test(pageId)||
                 typeof conversationId!=='string'||
                 !/^[a-zA-Z0-9_.:~-]{1,240}$/.test(conversationId))return null
              return 'page:'+pageId+':'+conversationId
            },
            invalidateMessages:(room:string)=>sdk.invalidateMessages(room),
            invalidateRoom:(room:string)=>sdk.invalidateRoom(room)
          },
          // Reuse the mature Pancake SDK's existing signing-secret provider:
          // its YANCE_PANCAKE_WEBHOOK_SECRET environment override or the
          // Windows per-user LOCALAPPDATA/YanceV2/page-webhook-secret file.
          // Never echo or log the secret; when absent, fail closed with 503.
          onVerifiedWake:({room,pageId,hintMid,wakeAt}:any)=>{
            // Acknowledge the signed wake promptly; original provider GET
            // continues on this SAME Host without blocking Pancake retries.
            void (async()=>{
            if(typeof room!=='string'||typeof pageId!=='string'||
               typeof hintMid!=='string'||!Number.isFinite(wakeAt))
              return {status:'UNVERIFIED'}
            const start=await sdk.scope()
            const pages=start.pages.filter((p:any)=>p.pageId===pageId)
            if(pages.length!==1||!room.startsWith('page:'+pageId+':'))return {status:'UNVERIFIED'}
            const verified=await sdk.fetchMessages(room)
            if(verified?.ok!==true||verified.roomId!==room)return {status:'UNVERIFIED'}
            // Webhook body is ONLY an invalidation hint. The actual content,
            // MID, direction and time must be confirmed via the official API.
            const message=verified.messages.find((m:any)=>m.mid===hintMid&&
              m.direction==='INBOUND'&&typeof m.original==='string'&&
              Number.isFinite(timestamp(m.matrixTimestamp))&&
              Math.abs(timestamp(m.matrixTimestamp)-wakeAt)<86_400_000)
            if(!message)return {status:'UNVERIFIED'}
            const finish=await sdk.scope()
            const exactly=finish.pages.filter((p:any)=>p.pageId===pageId)
            if(start.revision!==finish.revision||exactly.length!==1||
               exactly[0].accountName!==pages[0].accountName)return {status:'REVOKED'}
            const accountRef=pageAccountRef(pages[0],finish.revision)
            const roomRef=sha(accountRef+'\0'+room)
            const known=recentPageRows.get(accountRef)?.rows.find((r:any)=>r.roomId===room)
            const event={
              channel:'Page',source:'ORIGINAL_SIGNED_PANCAKE_AND_PROVIDER_GET',
              accountRef,roomRef,mid:limited(message.mid,180),
              text:limited(message.original,4000),direction:'INBOUND',
              timestamp:timestamp(message.matrixTimestamp),
              name:limited(known?.displayName,100)
            }
            // Cordis is the SAME original DSH event bus. The existing
            // /social-events SSE forwards it into the mature inbox notifier.
            ctx.emit('yenra/page-verified-inbound' as any,event as any)
            return {status:'ORIGINAL_PROVIDER_VERIFIED'}
            })().catch(()=>{/* provider unavailable: no unverified UI signal */})
            return {status:'ORIGINAL_PROVIDER_VERIFICATION_PENDING'}
          }
        })
      })().catch(e=>{originalRealtime=null;throw e})
      return originalRealtime
    }
    const unregister=scope.webServer.register({
      kind:'exact',path:'/api/yenra/pancake-webhook',
      handler:async(request,response)=>{
        try{
          const realtime=await getOriginalRealtime()
          await realtime.onWebhook(request,response)
        }catch{
          if(!response.headersSent){
            response.writeHead(503,{'content-type':'application/json; charset=utf-8',
              'cache-control':'no-store','x-content-type-options':'nosniff'})
            response.end(JSON.stringify({ok:false,error:'ORIGINAL_PANCAKE_WEBHOOK_UNAVAILABLE'}))
          }
        }
      }
    })
    return ()=>{void originalRealtime?.then(r=>r.close?.()).catch(()=>{});unregister()}
  }))
  // Original Pancake account store already supports many accounts and Pages.
  // This native local-only endpoint is only a thin UI-to-existing-DPAPI bridge.
  // No secondary login service, database, token logs or provider calls.
  ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
    kind:'exact',path:'/api/yenra/page-account',
    handler:async(request,response)=>{
      const reply=(status:number,code:string,extra:Record<string,unknown>={})=>{
        response.writeHead(status,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'})
        response.end(JSON.stringify({ok:status===201,code,...extra}))
      }
      if(request.method!=='POST'){reply(405,'METHOD_NOT_ALLOWED');return}
      const ip=String(request.socket?.remoteAddress??'')
      const site=String(request.headers['sec-fetch-site']??'')
      const origin=String(request.headers.origin??'')
      const type=String(request.headers['content-type']??'').split(';')[0].trim()
      if((ip&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip))||
         (site&&!['same-origin','none'].includes(site))||
         (origin&&!['null','dsh-app://app'].includes(origin))){
        reply(403,'ORIGINAL_DSH_LOCAL_ONLY');return
      }
      if(type!=='application/json'){reply(415,'JSON_REQUIRED');return}
      if(Number(request.headers['content-length']??0)>4600){
        reply(413,'REQUEST_TOO_LARGE');return
      }
      try{
        let raw=''
        for await(const part of request as AsyncIterable<Buffer>){
          raw+=Buffer.isBuffer(part)?part.toString('utf8'):String(part)
          if(raw.length>4600)throw Error('REQUEST_TOO_LARGE')
        }
        const value:unknown=JSON.parse(raw)
        if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_INPUT')
        const data=value as Record<string,unknown>
        if(Object.keys(data).sort().join(',')!=='accountName,pageId,pageToken,userToken')
          throw Error('INVALID_FIELDS')
        const {accountName,pageId,userToken,pageToken}=data
        if(typeof accountName!=='string'||!(/^[\p{L}\p{N}_. -]{1,48}$/u).test(accountName)||
          !accountName.trim()||typeof pageId!=='string'||!/^[0-9]{1,40}$/.test(pageId)||
          typeof userToken!=='string'||typeof pageToken!=='string'||
          ![userToken,pageToken].every(v=>v.length>=8&&v.length<=1600&&
            !/[\s\x00-\x1f\x7f]/.test(v)))
          throw Error('INVALID_ACCOUNT_FIELDS')
        // Fresh Windows user has no DPAPI file yet. Do not call pageSdk():
        // its read path requires existing credentials. Bootstrap only the
        // mature installed SDK account store, then continue with original DPAPI.
        ensurePageAlias(true)
        const store=await loadMatureModule(LEGACY_PAGE+'account-store.js') as any
        const env={...process.env,APPDATA:SANDBOX}
        // Existing Page is an UPDATE operation, not an ADD. The mature
        // original account store deliberately rejects duplicate Page IDs.
        // Guard BEFORE any write to prevent accidental credential changes.
        const configured=await store.accountStoreOp('list',undefined,env)
        if(configured?.accounts?.some((row:any)=>row.name===accountName&&
           Array.isArray(row.pageIds)&&row.pageIds.includes(pageId))){
          reply(409,'PAGE_ALREADY_CONNECTED');return
        }
        const saved=await store.accountStoreOp('save',
          {accountName,pageId,userToken,pageToken},env)
        if(saved?.saved!==true||saved.ok!==true)
          throw Error('ORIGINAL_DPAPI_SAVE_FAILED')
        // The original SDK reads fresh protected account scope on each call.
        // Discard only temporary in-process page previews, NOT W25 or history.
        recentPageRows.clear()
        pendingAvatarPageRoster.clear()
        recentlyVerifiedPageMessages.clear()
        reply(201,'PAGE_ACCOUNT_SAVED',{
          displayId:sha('FB_PAGE_DISPLAY|'+accountName+'|'+pageId),
          revision:saved.revision
        })
      }catch{
        // Never echo the provided tokens or original PowerShell exception.
        reply(400,'PANCAKE_ORIGINAL_ACCOUNT_SAVE_REJECTED')
      }
    }
  }), 'YENRA original Pancake DPAPI multi-Page account registration'))
  ctx.effect(()=>{
  const disposers=[
   ctx.commands.register({name:'yenra-facebook-roster',
    description:'Verified current Facebook Personal/ Page rosters from original mature connectors',
    recordInput:false,handler:async({agent})=>{
     if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('主人工作区未经认证')
     const accounts:Account[]=[],failures:string[]=[]
     const outcomes=await Promise.allSettled([personalRows(),withVerifiedPageRead(()=>verifiedAllPageRows(true))])
      for(let i=0;i<outcomes.length;i++){
       const item=outcomes[i]
       if(item.status==='fulfilled'){
        const sources=i===0?[item.value]:item.value as PageRowsResult[]
        for(const source of sources)accounts.push(source.account)
       }else failures.push((i===0?'Personal':'Page')+':'+String(item.reason?.message??'UNAVAILABLE').slice(0,90))
      }
      if(!accounts.length)return error('Facebook 后端未就绪：'+failures.join(';'))
     return okay({schema:1,source:'YENRA_FB_OFFICIAL',accounts,partial:failures.length>0,failures})
    }}),
   ctx.commands.register({name:'yenra-facebook-manual-send',
    description:'Exact text typed by owner in current native Composer. Reuse original Matrix/Pancake sender.',
    recordInput:false,input:{hint:'Owner-issued accountRef+roomRef+text'},
    handler:async({agent,rawInput})=>{
      if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('主人工作区未经认证')
      try{
        // Keep the old Command API available for native callers, but the
        // owner-click UI now uses the same Host dispatch without Session events.
        return await sendVerifiedFacebookTextClick(rawInput.trim())
      }catch(e){return error('Facebook 发送未确认：'+String((e as Error)?.message??e).slice(0,110))}
    }}),
   ctx.commands.register({name:'yenra-facebook-room',
    description:'Verified original room history for authenticated Facebook account and room',
    input:{hint:'Host-issued accountRef and roomRef'},recordInput:false,
    handler:async({agent,rawInput})=>{
     try{
      if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('主人工作区未经认证')
      const args=parsedInput(rawInput.trim())
      // Route directly by the authenticated account reference: do not load
      // the Personal roster before every Page conversation.
      const personalRef=sha('FB_PERSONAL|W56|@w56_internal_fb_bridge:yance-w26.invalid')
      const value=args.accountRef===personalRef?await personalRoom(args):await withVerifiedPageRead(()=>pageRoom(args),args)
      if(!value)return error('没有匹配的当前认证 Facebook 会话')
      return okay(value)
     }catch(e){return error('Facebook 原生会话读取失败：'+String((e as Error)?.message??e).slice(0,100))}
    }})
  ]
  return()=>{for(const dispose of disposers.reverse())dispose()}
 },'YENRA verified Personal + Page original mature channels in one DSH Host')
 // Reuse the EXISTING official DSH Host WebServer (also used for translation).
 // Bytes never enter roster JSON, localStorage or a second avatar database.
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/facebook-avatar',
  handler:async(request,response)=>{
   const reply=(status:number,bytes?:Buffer,mime?:string)=>{
    response.writeHead(status,{
     'cache-control':status===200?'private, max-age=300':'no-store',
     'x-content-type-options':'nosniff',
     ...(mime?{'content-type':mime}:{}),
    })
    response.end(bytes)
   }
   if(request.method!=='GET'){reply(405);return}
   // The private desktop WebServer route must not be a remote media proxy.
   const addr=String(request.socket?.remoteAddress??'')
   if(addr&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr)){reply(403);return}
   const site=String(request.headers['sec-fetch-site']??'')
   if(site&& !['same-origin','none'].includes(site)){reply(403);return}
   const origin=String(request.headers.origin??'')
   if(origin&&origin!=='null'&&origin!=='dsh-app://app'){reply(403);return}
   try{
    const url=new URL(String(request.url??''),'http://localhost')
    if([...url.searchParams.keys()].sort().join(',')!=='accountRef,roomRef'){reply(400);return}
    const accountRef=url.searchParams.get('accountRef')??''
    const roomRef=url.searchParams.get('roomRef')??''
    if(!REF.test(accountRef)||!REF.test(roomRef)){reply(400);return}
    const avatar=await getVerifiedFacebookAvatar(accountRef,roomRef)
    if(!avatar){reply(204);return}
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(avatar.mime)||
      avatar.bytes.length<100||avatar.bytes.length>1_500_000){reply(204);return}
    reply(200,avatar.bytes,avatar.mime)
   }catch{reply(503)}
  },
 }), 'YENRA scoped original Facebook avatar bytes on official DSH WebServer'))
 // Exact same mature Account/Room SDK, exposed by the existing official Host
 // WebServer as a read-only fallback when a large Command result is delayed.
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/facebook-roster',
  handler:async(request,response)=>{
   const send=(status:number,value:unknown)=>{
    response.writeHead(status,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'})
    response.end(JSON.stringify(value))
   }
   if(request.method!=='GET'){send(405,{ok:false});return}
   const addr=String(request.socket?.remoteAddress??'')
   if(addr&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr)){send(403,{ok:false});return}
   const site=String(request.headers['sec-fetch-site']??'')
   if(site&& !['same-origin','none'].includes(site)){send(403,{ok:false});return}
   const origin=String(request.headers.origin??'')
   if(origin&&origin!=='null'&&origin!=='dsh-app://app'){send(403,{ok:false});return}
   if(String(request.url??'')!=='/api/yenra/facebook-roster'){send(400,{ok:false});return}
   const checks=await Promise.allSettled([personalRows(),withVerifiedPageRead(()=>verifiedAllPageRows())])
    const accounts:Account[]=[],failures:string[]=[]
    for(let i=0;i<checks.length;i++){
     const result=checks[i]
     if(result.status==='fulfilled'){
      const sources=i===0?[result.value]:result.value as PageRowsResult[]
      for(const source of sources)accounts.push(source.account)
     }else failures.push(i===0?'Personal_UNAVAILABLE':'Page_UNAVAILABLE')
    }
    if(!accounts.length){send(503,{ok:false,error:'NATIVE_FACEBOOK_ROSTER_UNAVAILABLE'});return}
   send(200,{ok:true,text:PREFIX+JSON.stringify({schema:1,source:'YENRA_FB_OFFICIAL',
     accounts,partial:failures.length>0,failures})})
  },
 }), 'YENRA scoped read-only official Facebook roster fallback'))
 // The same authenticated Personal/Page room readers, with no DSH Session log.
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/facebook-room',
  handler:async(request,response)=>{
   const started=performance.now()
   const send=(status:number,value:unknown)=>{
    // Diagnostic timing only; no message content, tokens or raw IDs.
    // Separate original Host work from DSH gateway/renderer waiting time.
    response.setHeader('server-timing','yenraPageHost;dur='+
      Math.max(0,performance.now()-started).toFixed(1))
    response.writeHead(status,{'content-type':'application/json; charset=utf-8',
     'cache-control':'no-store','x-content-type-options':'nosniff'})
    response.end(JSON.stringify(value))
   }
   if(request.method!=='GET'){send(405,{ok:false,error:'METHOD_NOT_ALLOWED'});return}
   const addr=String(request.socket?.remoteAddress??'')
   if(addr&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr)){send(403,{ok:false,error:'LOCAL_ONLY'});return}
   const site=String(request.headers['sec-fetch-site']??'')
   if(site&&!['same-origin','none'].includes(site)){send(403,{ok:false,error:'SAME_ORIGIN_ONLY'});return}
   const origin=String(request.headers.origin??'')
   if(origin&&origin!=='null'&&origin!=='dsh-app://app'){send(403,{ok:false,error:'SAME_ORIGIN_ONLY'});return}
   try{
    const url=new URL(String(request.url??''),'http://localhost')
    const keys=[...url.searchParams.keys()].sort().join(',')
    const historyOnly=keys==='accountRef,historyOnly,roomRef'&&
      url.searchParams.get('historyOnly')==='1'
    if(keys!=='accountRef,roomRef'&&!historyOnly){
     send(400,{ok:false,error:'INVALID_QUERY'});return
    }
    const args=parsedInput(JSON.stringify({
     accountRef:url.searchParams.get('accountRef')??'',
     roomRef:url.searchParams.get('roomRef')??'',
    }))
    const personalRef=sha('FB_PERSONAL|W56|@w56_internal_fb_bridge:yance-w26.invalid')
    // Historical preview: exactly the same scoped endpoint and existing W25
    // reader; never block or start the original provider refresh on this call.
    const value=historyOnly
      ?(args.accountRef===personalRef?null:await withVerifiedPageRead(
        ()=>pageHistoricalOnly(args),args))
      :(args.accountRef===personalRef?await personalRoom(args):
        await withVerifiedPageRead(()=>pageRoom(args),args))
    if(!value){send(404,{ok:false,error:'ROOM_NOT_IN_AUTHORIZED_ACCOUNT'});return}
    send(200,{ok:true,text:okay(value).text})
   }catch(e){
    // Preserve original provider/identity error category for local diagnostics,
    // not raw exception text, account ID, room ID, token or private message.
    const code=String((e as Error)?.message??'UNKNOWN')
    const known=new Set([
     'PAGE_PROVIDER_RATE_LIMITED','PAGE_PROVIDER_UNAVAILABLE',
     'PAGE_PROVIDER_NETWORK_UNAVAILABLE','PAGE_PROVIDER_TOKEN_REJECTED',
     'PAGE_ACCOUNT_REVOKED_DURING_READ','PAGE_ACCOUNT_CHANGED_DURING_READ',
     'PAGE_ACCOUNT_SCOPE_UNVERIFIED','PAGE_EXACT_ACCOUNT_REF_REQUIRED',
     'PAGE_CONVERSATION_NOT_VERIFIED','PAGE_ROOM_NOT_AUTHENTICATED',
     'PAGE_ACCOUNTS_UNAVAILABLE','PAGE_TOKEN_UNAVAILABLE',
     'PAGE_PROTECTED_CREDENTIAL_NOT_FOUND','ACCOUNT_STORE_TIMEOUT',
     'PAGE_PROVIDER_QUEUE_BUSY'
    ])
    send(code==='PAGE_PROVIDER_RATE_LIMITED'?429:503,{
      ok:false,error:'NATIVE_FACEBOOK_ROOM_UNAVAILABLE',
      reason:known.has(code)?code:'PAGE_ORIGINAL_READ_FAILED'})
   }
  },
 }), 'YENRA native Facebook room read without Brain Session log'))
 // Original Matrix Personal bytes, via the SAME authenticated DSH WebServer.
 // No bearer token, MXC, raw Matrix room or independent media service in UI.
 ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/facebook-media',
  handler:async(request,response)=>{
   const reject=(status:number)=>{
    response.writeHead(status,{'cache-control':'no-store',
      'x-content-type-options':'nosniff'});
    response.end();
   };
   if(request.method!=='GET'){reject(405);return}
   const addr=String(request.socket?.remoteAddress??'')
   if(addr&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr)){reject(403);return}
   const site=String(request.headers['sec-fetch-site']??'')
   if(site&&!['same-origin','none'].includes(site)){reject(403);return}
   const origin=String(request.headers.origin??'')
   if(origin&&origin!=='null'&&origin!=='dsh-app://app'){reject(403);return}
   try{
    const url=new URL(String(request.url??''),'http://localhost')
    if(url.pathname!=='/api/yenra/facebook-media'||
      [...url.searchParams.keys()].sort().join(',')!=='accountRef,mid,roomRef'){
      reject(400);return
    }
    const accountRef=url.searchParams.get('accountRef')??''
    const roomRef=url.searchParams.get('roomRef')??''
    const mid=url.searchParams.get('mid')??''
    if(!REF.test(accountRef)||!REF.test(roomRef)||
      !mid.startsWith('$')||mid.length<5||mid.length>180||
      /[\x00-\x20\x7f]/.test(mid)){reject(400);return}
    // Existing mature SDK verifies current protected session, exact joined
    // room, original event, media MIME and size before returning any bytes.
    const media=await getVerifiedPersonalMedia(accountRef,roomRef,mid)
    if(!media){reject(404);return}
    const bytes=media.bytes
    if(!Buffer.isBuffer(bytes)||!bytes.length||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(media.mime)){reject(503);return}
    const range=String(request.headers.range??'')
    const bounds=range?/^bytes=(\d+)-(\d*)$/.exec(range):null
    if(range&&!bounds){response.writeHead(416,{'content-range':'bytes */'+bytes.length});response.end();return}
    const start=bounds?Number(bounds[1]):0
    const end=bounds?Math.min(bytes.length-1,bounds[2]?Number(bounds[2]):bytes.length-1):bytes.length-1
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
      start<0||end<start||start>=bytes.length){
      response.writeHead(416,{'content-range':'bytes */'+bytes.length});response.end();return
    }
    const part=Boolean(bounds),data=bytes.subarray(start,end+1)
    response.writeHead(part?206:200,{
      'content-type':media.mime,'content-length':data.length,
      'content-disposition':'inline','accept-ranges':'bytes',
      'cache-control':'private, no-store','x-content-type-options':'nosniff',
      ...(part?{'content-range':'bytes '+start+'-'+end+'/'+bytes.length}:{})
    })
    response.end(data)
   }catch{reject(503)}
  }
 }), 'YENRA existing authenticated Personal Matrix media on DSH WebServer'))
}
