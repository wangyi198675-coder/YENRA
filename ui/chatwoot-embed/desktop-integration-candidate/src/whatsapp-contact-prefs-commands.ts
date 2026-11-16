/** Thin original-DSH WhatsApp contact-list preferences adapter.
 * The source DSH-IM does not expose WhatsApp server-side chatModify APIs.
 * These four actions are explicitly LOCAL YENRA presentation preferences,
 * persisted in the official DSH Storage Domain (not a second chat database).
 * Only Host-verified original bot/inbox account+room may be accessed.
 */
import {createHash} from 'node:crypto'
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-storage-domain'
import {defineDomain,domainTable} from '../../../upstream/official-source/packages/storage/storage-domain/src/spec.ts'
import {z} from '../../../upstream/official-source/packages/storage/storage-domain/node_modules/zod/index.js'
import {accountRef as waAccountRef,roomRef as waRoomRef,currentBots,readInbox} from './social-readonly-commands.ts'

import {isTrustedNativeWorkspace} from './trusted-native-workspace.ts'
const PREFIX='YENRA_WA_PREFS_V1:'
const REF=/^[a-f0-9]{32}$/
const FIELDS=['pinned','muted','archived','manualUnread'] as const
type Field=typeof FIELDS[number]
const defaultPrefs=()=>({pinned:false,muted:false,archived:false,manualUnread:false})
const entry=z.object({
 revision:z.number().int().nonnegative(),pinned:z.boolean(),muted:z.boolean(),
 archived:z.boolean(),manualUnread:z.boolean(),
 displayName:z.string().max(80).optional(),
})
const manualContact=z.object({
 accountRef:z.string().regex(REF),roomRef:z.string().regex(REF),
 phoneNumber:z.string().regex(/^\+[1-9][0-9]{4,14}$/),
 displayName:z.string().trim().min(1).max(80),
})
export const whatsappContactPrefsDomain=defineDomain({
 name:'yenra_whatsapp_contact_preferences',version:1,
 layout:'per-record',invalidRecords:'backup-and-skip',
 tables:{entries:domainTable(entry),manual_contacts:domainTable(manualContact)},
})
// Reuse ONE official Storage Domain handle per mounted DSH facility.
// Domain.table().get() is synchronous authoritative memory; reopening its
// backend for each roster read needlessly reloads validated contact prefs.
// This map retains ONLY the official domain handle Promise, never contact data.
const openDomains=new WeakMap<object,Promise<any>>()
function sharedPrefsDomain(storage:any):Promise<any>{
 let pending=openDomains.get(storage)
 if(!pending){
  pending=storage.open(whatsappContactPrefsDomain)
  openDomains.set(storage,pending)
  const current=pending
  void current.catch(()=>{if(openDomains.get(storage)===current)openDomains.delete(storage)})
 }
 return pending
}
async function closeSharedPrefsDomain(storage:any):Promise<void>{
 const pending=openDomains.get(storage)
 if(!pending)return
 openDomains.delete(storage)
 await pending.then(domain=>domain.close(),()=>undefined)
}
const normalized=(v:string|undefined)=>(v??'').replaceAll('\\','/').replace(/\/+$/,'').toLowerCase()
const keyOf=(a:string,r:string)=>createHash('sha256').update(JSON.stringify([a,r])).digest('hex')
/** A manually entered number is local until the original WhatsApp provider accepts it. */
export async function getSavedWhatsAppManualContact(ctx:Context,botId:string,accountRef:string,roomRef:string){
 if(!REF.test(accountRef)||!REF.test(roomRef)||waAccountRef(botId)!==accountRef)return null
 const storage=ctx.get('storageDomain')
 if(!storage)return null
 const domain=await sharedPrefsDomain(storage)
 const record=domain.table('manual_contacts').get(keyOf(accountRef,roomRef))
 if(!record||record.accountRef!==accountRef||record.roomRef!==roomRef||
    !/^\+[1-9][0-9]{4,14}$/.test(record.phoneNumber))return null
 const jid=record.phoneNumber.slice(1)+'@s.whatsapp.net'
 if(waRoomRef(botId,jid)!==roomRef)return null
 return {jid,phoneNumber:record.phoneNumber,displayName:record.displayName}
}
const error=(e:unknown)=>({kind:'error' as const,text:'WhatsApp 本地联系人操作未保存：'+String(e instanceof Error?e.message:e).slice(0,190)})
function parse(raw:string,save:boolean){
 if(typeof raw!=='string'||raw.length>550)throw Error('CONTACT_PREF_REQUEST_LENGTH')
 const q:unknown=JSON.parse(raw)
 if(!q||typeof q!=='object'||Array.isArray(q))throw Error('CONTACT_PREF_BODY')
 const v=q as Record<string,unknown>
 if(Object.keys(v).sort().join('|')!==(save?'accountRef|expectedRevision|field|roomRef|value':'accountRef|roomRef')||
    typeof v.accountRef!=='string'||!REF.test(v.accountRef)||
    typeof v.roomRef!=='string'||!REF.test(v.roomRef))
   throw Error('CONTACT_PREF_ACCOUNT_ROOM')
 if(save&&(!FIELDS.includes(v.field as Field)||typeof v.value!=='boolean'||
   !Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<0))
   throw Error('CONTACT_PREF_ACTION')
 return v as {accountRef:string;roomRef:string;field?:Field;value?:boolean;expectedRevision?:number}
}
async function verifyOriginalRoom(service:any,a:string,r:string,ctx?:Context){
 if(!service||typeof service.listBots!=='function')throw Error('DSH_IM_UNAVAILABLE')
 const bots=await currentBots(service)
 for(const bot of bots){
  if(waAccountRef(bot.botId)!==a)continue
  const inbox=await readInbox(bot.botId)
  if(inbox.chats.some(c=>waRoomRef(bot.botId,c.jid)===r))return
  if(ctx&&await getSavedWhatsAppManualContact(ctx,bot.botId,a,r))return
  throw Error('WHATSAPP_ROOM_NOT_AUTHENTICATED')
 }
 throw Error('WHATSAPP_ACCOUNT_NOT_AUTHENTICATED')
}
/** Optional per-request diagnostics; never contains account or message data. */
export type WhatsAppPrefsTiming={domainAcquireMs:number;tableReadMs:number;domainCloseMs:number;roomGets:number}
/** Enrich ONLY already verified cached/actual WA roster rows, no extra IM read. */
export async function applyWhatsAppLocalContactPrefs(
 ctx:Context,accounts:any[],timing?:WhatsAppPrefsTiming,
):Promise<any[]>{
 if(!accounts.some(a=>a.channel==='WhatsApp'))return accounts
 const storage=ctx.get('storageDomain')
 if(!storage)return accounts
 const start=timing?performance.now():0
 const domain=await sharedPrefsDomain(storage)
 if(timing)timing.domainAcquireMs=performance.now()-start
 const table=domain.table('entries')
 const readStart=timing?performance.now():0
 let roomGets=0
 const savedContacts=[...domain.table('manual_contacts').entries()].map(([,record]:[string,any])=>record)
 const projected=accounts.map(account=>{
  if(account.channel!=='WhatsApp')return account
  const rooms=account.rooms.map((room:any)=>{
   const record=table.get(keyOf(account.accountRef,room.roomRef))
   if(timing)roomGets++
   const local=savedContacts.find((item:any)=>item.accountRef===account.accountRef&&
     (item.roomRef===room.roomRef||item.phoneNumber===room.phoneFallback))
   const savedName=record?.displayName?.trim()||local?.displayName?.trim()
   return {...room,contactOrigin:'existing_chat',localNameSaved:Boolean(savedName),
    ...(savedName?{name:savedName,nameKnown:true}:{}),
    contactPreferences:record?{
     pinned:record.pinned,muted:record.muted,
     archived:record.archived,manualUnread:record.manualUnread,
    }:defaultPrefs()}
  })
  const known=new Set(rooms.map((room:any)=>room.roomRef))
  const originalPhones=new Set(account.rooms.map((room:any)=>room.phoneFallback).filter(Boolean))
  for(const saved of savedContacts){
   if(saved.accountRef!==account.accountRef||known.has(saved.roomRef)||
      originalPhones.has(saved.phoneNumber))continue
   if(rooms.length>=650)break
   const prefs=table.get(keyOf(account.accountRef,saved.roomRef))
   rooms.push({roomRef:saved.roomRef,contactOrigin:'local_only',registrationStatus:'unverified',
    name:prefs?.displayName??saved.displayName,
    nameKnown:true,localNameSaved:true,phoneFallback:saved.phoneNumber,providerPeerKind:'number',
    lastMessageAt:null,latestText:null,messageCount:0,
    contactPreferences:prefs?{
     pinned:prefs.pinned,muted:prefs.muted,archived:prefs.archived,
     manualUnread:prefs.manualUnread,
    }:defaultPrefs()})
   known.add(saved.roomRef)
  }
  return {...account,rooms}
 })
 if(timing){
  timing.tableReadMs=performance.now()-readStart
  timing.roomGets=roomGets
  // The ONE domain closes on plugin lifecycle disposal, not on GET requests.
  timing.domainCloseMs=0
 }
 return projected
}
export function registerWhatsAppContactPreferenceCommands(ctx:Context):void{
 // One official Domain lease for this plugin's Storage Domain lifecycle.
 // Writes and roster reads share the SAME revisioned records; unmount drains.
 ctx.inject(['storageDomain'],scope=>scope.effect(()=>{
  const storage=scope.get('storageDomain')
  return()=>closeSharedPrefsDomain(storage)
 },'YENRA shared official WhatsApp preferences Domain lifecycle'))
 ctx.inject(['dshIm','storageDomain'],scope=>scope.effect(()=>{
  const service=(scope as unknown as {dshIm:any}).dshIm
  const storage=scope.get('storageDomain')
  const read=async(raw:string,save:boolean)=>{
   const q=parse(raw,save)
   await verifyOriginalRoom(service,q.accountRef,q.roomRef,scope)
   if(!storage)throw Error('DSH_STORAGE_DOMAIN_UNAVAILABLE')
   const domain=await sharedPrefsDomain(storage)
   const table=domain.table('entries')
    const key=keyOf(q.accountRef,q.roomRef)
    const state=table.get(key)??{revision:0,...defaultPrefs()}
    if(save){
     if(q.expectedRevision!==state.revision)throw Error('REVISION_CHANGED_REFRESH_MENU')
     const field=q.field as Field
     const value=q.value as boolean
     const next={...state,[field]:value,revision:state.revision+1}
     await table.put(key,next)
     return {ok:true,saved:true,accountRef:q.accountRef,roomRef:q.roomRef,
      revision:next.revision,preferences:{
       pinned:next.pinned,muted:next.muted,archived:next.archived,
       manualUnread:next.manualUnread,
      },scope:'YENRA_LOCAL_DSH_STORAGE'}
    }
    return {ok:true,accountRef:q.accountRef,roomRef:q.roomRef,
     revision:state.revision,localNameSaved:Boolean(state.displayName),
     localContactSaved:Boolean(domain.table('manual_contacts').get(key)),preferences:{
      pinned:state.pinned,muted:state.muted,archived:state.archived,
      manualUnread:state.manualUnread,
     },scope:'YENRA_LOCAL_DSH_STORAGE'}
  }
  const create=scope.commands.register({
   name:'yenra-whatsapp-contact-create',recordInput:false,
   description:'Owner manually adds a phone number in the existing official contact preferences domain',
   input:{hint:'Verified WhatsApp account, E.164 phone and display name'},
   handler:async({agent,rawInput})=>{
    if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('DSH_OWNER_SESSION_REQUIRED')
    try{
     if(typeof rawInput!=='string'||rawInput.length>500)throw Error('CONTACT_CREATE_REQUEST_LENGTH')
     const data:unknown=JSON.parse(rawInput.trim())
     if(!data||typeof data!=='object'||Array.isArray(data))throw Error('CONTACT_CREATE_REQUEST')
     const q=data as Record<string,unknown>
     if(Object.keys(q).sort().join('|')!=='accountRef|displayName|phoneNumber'||
       typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
       typeof q.phoneNumber!=='string'||!/^\+[1-9][0-9]{4,14}$/.test(q.phoneNumber)||
       typeof q.displayName!=='string'||!q.displayName.trim()||
       q.displayName.trim().length>80||/[\x00-\x1f\x7f]/.test(q.displayName))
       throw Error('CONTACT_CREATE_INVALID_INPUT')
     const bot=(await currentBots(service)).find(b=>waAccountRef(b.botId)===q.accountRef)
     if(!bot)throw Error('WHATSAPP_ACCOUNT_NOT_AUTHENTICATED')
     const jid=q.phoneNumber.slice(1)+'@s.whatsapp.net'
     const original=await readInbox(bot.botId)
     // A linked WhatsApp number can be represented by a LID identity.
     // Reuse the original verified room instead of creating a duplicate.
     const matches=original.chats.filter(c=>c.jid===jid||c.phoneFallback===q.phoneNumber)
     if(matches.length>1)throw Error('CONTACT_PHONE_IDENTITY_AMBIGUOUS')
     const match=matches[0]
     const roomRef=waRoomRef(bot.botId,match?.jid??jid)
     const domain=await sharedPrefsDomain(storage)
     const key=keyOf(q.accountRef,roomRef)
     const displayName=q.displayName.trim()
     if(match){
      const prefs=domain.table('entries')
      const current=prefs.get(key)??{revision:0,...defaultPrefs()}
      await prefs.put(key,{...current,displayName,revision:current.revision+1})
     }else{
      const table=domain.table('manual_contacts')
      if(!table.get(key)){
       const count=[...table.entries()].filter(([,v]:[string,any])=>v.accountRef===q.accountRef).length
       if(count>=200)throw Error('WHATSAPP_LOCAL_CONTACT_LIMIT_REACHED')
      }
      await table.put(key,{accountRef:q.accountRef,roomRef,phoneNumber:q.phoneNumber,displayName})
     }
     return {kind:'success' as const,text:PREFIX+JSON.stringify({
      ok:true,saved:true,accountRef:q.accountRef,roomRef,phoneNumber:q.phoneNumber,
      displayName,scope:'YENRA_LOCAL_DSH_STORAGE',whatsappVerified:false,
      registrationVerified:false,contactOrigin:match?'existing_chat':'local_only',
     })}
    }catch(e){return error(e)}
   },
  })
  // Removing a local entry NEVER deletes an original WhatsApp room, message or avatar.
  const remove=scope.commands.register({
   name:'yenra-whatsapp-contact-remove',recordInput:false,
   description:'Remove only YENRA-local WhatsApp contact or name override',
   input:{hint:'Authenticated account + room + expected revision'},
   handler:async({agent,rawInput})=>{
    if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('DSH_OWNER_SESSION_REQUIRED')
    try{
     if(typeof rawInput!=='string'||rawInput.length>500)throw Error('CONTACT_REMOVE_LENGTH')
     const data:unknown=JSON.parse(rawInput.trim())
     if(!data||typeof data!=='object'||Array.isArray(data))throw Error('CONTACT_REMOVE_REQUEST')
     const q=data as Record<string,unknown>
     if(Object.keys(q).sort().join('|')!=='accountRef|expectedRevision|roomRef'||
       typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
       typeof q.roomRef!=='string'||!REF.test(q.roomRef)||
       !Number.isSafeInteger(q.expectedRevision)||Number(q.expectedRevision)<0)
       throw Error('CONTACT_REMOVE_SCOPE')
     const bot=(await currentBots(service)).find(b=>waAccountRef(b.botId)===q.accountRef)
     if(!bot)throw Error('WHATSAPP_ACCOUNT_NOT_AUTHENTICATED')
     const original=await readInbox(bot.botId)
     const originalRoom=original.chats.find(c=>waRoomRef(bot.botId,c.jid)===q.roomRef)
     const existing=Boolean(originalRoom)
     const domain=await sharedPrefsDomain(storage)
     const key=keyOf(q.accountRef,q.roomRef)
     const manual=domain.table('manual_contacts')
     const aliased=[...manual.entries()].find(([,v]:[string,any])=>
       v.accountRef===q.accountRef&&v.phoneNumber===originalRoom?.phoneFallback)
     const manualKey=manual.get(key)?key:aliased?.[0]
     const record=manualKey?manual.get(manualKey):null
     const prefs=domain.table('entries')
     const state=prefs.get(key)??{revision:0,...defaultPrefs()}
     if(state.revision!==q.expectedRevision)throw Error('REVISION_CHANGED_REFRESH_MENU')
     if(!record&&!existing)throw Error('CONTACT_NOT_FOUND_IN_THIS_ACCOUNT')
     if(!record&&!state.displayName)throw Error('NO_LOCAL_CONTACT_NAME_TO_REMOVE')
     if(record&&manualKey)await manual.delete(manualKey)
     if(!existing){
      if(prefs.get(key))await prefs.delete(key)
     }else if(state.displayName){
      const {displayName:_removed,...withoutLocalName}=state
      await prefs.put(key,{...withoutLocalName,revision:state.revision+1})
     }
     return {kind:'success' as const,text:PREFIX+JSON.stringify({
      ok:true,removed:true,accountRef:q.accountRef,roomRef:q.roomRef,
      localRecordRemoved:Boolean(record),originalChatPreserved:existing,
      revision:state.revision+(state.displayName?1:0),
      scope:'YENRA_LOCAL_DSH_STORAGE',whatsappAddressBookChanged:false,
     })}
    }catch(e){return error(e)}
   },
  })
  // Explicit owner sync reads the existing DSH-IM inbox only. This is NOT
  // WhatsApp registration lookup or phone-address-book synchronization.
  const resync=scope.commands.register({
   name:'yenra-whatsapp-contact-resync',recordInput:false,
   description:'Reconcile local WhatsApp phone records with original inbox aliases',
   input:{hint:'One authenticated WhatsApp account reference'},
   handler:async({agent,rawInput})=>{
    if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('DSH_OWNER_SESSION_REQUIRED')
    try{
     if(typeof rawInput!=='string'||rawInput.length>300)throw Error('CONTACT_RESYNC_LENGTH')
     const data:unknown=JSON.parse(rawInput.trim())
     if(!data||typeof data!=='object'||Array.isArray(data))throw Error('CONTACT_RESYNC_REQUEST')
     const q=data as Record<string,unknown>
     if(Object.keys(q).sort().join('|')!=='accountRef'||
       typeof q.accountRef!=='string'||!REF.test(q.accountRef))
       throw Error('CONTACT_RESYNC_SCOPE')
     const bot=(await currentBots(service)).find(b=>waAccountRef(b.botId)===q.accountRef)
     if(!bot)throw Error('WHATSAPP_ACCOUNT_NOT_AUTHENTICATED')
     const original=await readInbox(bot.botId)
     const domain=await sharedPrefsDomain(storage)
     const manual=domain.table('manual_contacts'),prefs=domain.table('entries')
     let reconciled=0,unverifiedLocal=0
     for(const [key,record] of manual.entries()){
      if(record.accountRef!==q.accountRef)continue
      const jid=record.phoneNumber.slice(1)+'@s.whatsapp.net'
      const matches=original.chats.filter(c=>c.jid===jid||c.phoneFallback===record.phoneNumber)
      if(matches.length!==1){unverifiedLocal++;continue}
      const newKey=keyOf(q.accountRef,waRoomRef(bot.botId,matches[0].jid))
      const sourcePrefs=prefs.get(key)
      const originalPrefs=prefs.get(newKey)
      const current=originalPrefs??sourcePrefs??{revision:0,...defaultPrefs()}
      const displayName=originalPrefs?.displayName||sourcePrefs?.displayName||record.displayName
      if(newKey!==key||!originalPrefs?.displayName)
       await prefs.put(newKey,{...current,displayName,revision:current.revision+1})
      await manual.delete(key)
      if(newKey!==key&&sourcePrefs)await prefs.delete(key)
      reconciled++
     }
     return {kind:'success' as const,text:PREFIX+JSON.stringify({
      ok:true,accountRef:q.accountRef,reconciled,unverifiedLocal,
      existingChats:original.chats.length,scope:'ORIGINAL_DSH_IM_INBOX',
      registrationVerified:false,whatsappAddressBookChanged:false,
     })}
    }catch(e){return error(e)}
   },
  })
  const rename=scope.commands.register({
   name:'yenra-whatsapp-contact-name-save',recordInput:false,
   description:'Save verified WhatsApp contact name in official DSH Storage Domain',
   input:{hint:'Authorized account, room, name and revision'},
   handler:async({agent,rawInput})=>{
    if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('DSH_OWNER_SESSION_REQUIRED')
    try{
     if(typeof rawInput!=='string'||rawInput.length>600)throw Error('CONTACT_NAME_REQUEST_LENGTH')
     const body:unknown=JSON.parse(rawInput.trim())
     if(!body||typeof body!=='object'||Array.isArray(body))throw Error('CONTACT_NAME_BODY')
     const q=body as Record<string,unknown>
     if(Object.keys(q).sort().join('|')!=='accountRef|displayName|expectedRevision|roomRef'||
       typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
       typeof q.roomRef!=='string'||!REF.test(q.roomRef)||
       typeof q.displayName!=='string'||!q.displayName.trim()||
       q.displayName.trim().length>80||/[\x00-\x1f\x7f]/.test(q.displayName)||
       !Number.isSafeInteger(q.expectedRevision)||Number(q.expectedRevision)<0)
       throw Error('CONTACT_NAME_INPUT')
     await verifyOriginalRoom(service,q.accountRef,q.roomRef,scope)
     const domain=await sharedPrefsDomain(storage)
     const table=domain.table('entries')
     const key=keyOf(q.accountRef,q.roomRef)
     const current=table.get(key)??{revision:0,...defaultPrefs()}
     if(current.revision!==q.expectedRevision)throw Error('REVISION_CHANGED_REFRESH_MENU')
     const displayName=q.displayName.trim()
     await table.put(key,{...current,displayName,revision:current.revision+1})
     return {kind:'success' as const,text:PREFIX+JSON.stringify({
      ok:true,saved:true,accountRef:q.accountRef,roomRef:q.roomRef,
      displayName,revision:current.revision+1,scope:'YENRA_LOCAL_DSH_STORAGE',
     })}
    }catch(e){return error(e)}
   },
  })
  const commands=([
   ['yenra-whatsapp-contact-prefs-read',false],
   ['yenra-whatsapp-contact-prefs-save',true],
  ] as const).map(([name,save])=>scope.commands.register({
   name,recordInput:false,
   description:'Original DSH local-only WhatsApp contact list preferences; no WhatsApp network chat mutation',
   input:{hint:'Original authenticated account + room + expected revision'},
   handler:async({agent,rawInput})=>{
    if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('DSH_OWNER_SESSION_REQUIRED')
    try{
     const result=await read(rawInput.trim(),save)
     return {kind:'success' as const,text:PREFIX+JSON.stringify(result)}
    }catch(e){return error(e)}
   },
  }))
  return()=>{resync();remove();create();rename();for(const dispose of commands.reverse())dispose()}
 },'YENRA existing official DSH Storage Domain WA local contact preferences'))
}
