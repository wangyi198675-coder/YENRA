/**
 * YENRA native ACTION Agent Tools over the SAME official DSH Command handlers
 * the existing YENRA UI already calls (one operation, two callers).
 *
 *  - yenra_contact_status        : the CURRENT Host-verified contact.
 *  - yenra_contact_preferences   : pin / archive / mute / unread on that contact.
 *  - yenra_contact_rename        : saved contact name override.
 *  - yenra_contact_local_remove  : remove a YENRA-local contact record.
 *  - yenra_memory                : list / search / save / forget / correct.
 *  - yenra_draft_adopt           : put a reply into the existing chat input.
 *  - yenra_panel_open            : switch a registered native main panel.
 *
 * No second contact store, memory database, Sender, Socket, model gateway,
 * permission path or UI state. Every mutation goes through the SAME Command
 * handler (and therefore the SAME trust checks and receipts) the UI uses; the
 * UI learns about out-of-band changes through the existing same-origin SSE
 * feed, so both callers converge on one Host authority.
 */
import type {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import {isTrustedNativeWorkspace,trustedWorkspaceDiagnostics} from './trusted-native-workspace.ts'
import {originalSocialSseBroadcast} from './social-native-events.ts'
import {resolveTrustedContact,isContactBrainSession,type ImService} from './social-agent-tools.ts'
import type {TranslationBridge} from './translation-commands.ts'
import {decodeEnvelope} from './command-envelope.ts'

const REF=/^[a-f0-9]{32}$/u
const PANELS=new Set([
  'conversation','yenra-desktop-chat','yenra-memory-relations',
  'yenra-scout-market','yenra-meta-ads','schedules','plugins',
])
const WA_PREFIX='YENRA_WA_PREFS_V1:'
const FB_PREFIX='YENRA_FB_PREFS_V1:'
const ACTIONS=['get','pin','unpin','archive','unarchive','mute','unmute',
  'mark_unread','clear_unread'] as const
type PrefAction=typeof ACTIONS[number]
const FIELD:Record<string,{field:'pinned'|'muted'|'archived'|'manualUnread';value:boolean}>=
  {pin:{field:'pinned',value:true},unpin:{field:'pinned',value:false},
   archive:{field:'archived',value:true},unarchive:{field:'archived',value:false},
   mute:{field:'muted',value:true},unmute:{field:'muted',value:false},
   mark_unread:{field:'manualUnread',value:true},clear_unread:{field:'manualUnread',value:false}}

function requireAgent(exec:{agent?:Agent}):Agent{
  if(exec.agent===undefined)throw new Error('YENRA 联系人工具必须由所属 Agent Session 调用')
  return exec.agent
}
/** Tool results must be lossless JSON: drop undefined object fields instead of
 * failing the whole call (the Host rejects `undefined` in a tool value). */
import {lossless} from './tool-result.ts'
/** Register a tool whose execute result is always lossless JSON. The registry
 * call is written with a computed property so this wrapper cannot capture
 * itself (a self-recursive wrapper took the whole plugin down once). */
function registerTool(ctx:Context,definition:never):void{
  const source=definition as unknown as {execute:(args:unknown,exec:unknown)=>Promise<unknown>}
  const execute=source.execute
  const registry=(ctx.tools as unknown as {
    ['register']:(value:unknown)=>unknown
  })['register']
  registry.call(ctx.tools,{
    ...(definition as unknown as Record<string,unknown>),
    async execute(args:unknown,exec:unknown){
      return lossless(await execute(args,exec))
    },
  })
}
/** Fail with a clear reason when a Context is passed where an Agent is needed
 * (this exact mistake produced Cordis' unrelated `session without inject`). */
function assertAgentLike(value:unknown,label:string):Agent{
  let session:unknown
  try{session=(value as {session?:unknown}|undefined)?.session}catch{session=undefined}
  const id=(value as {id?:unknown}|undefined)?.id
  if(!session||typeof id!=='string')
    throw new Error('内部调用错误（'+label+'）：需要 Agent 而不是 Context')
  return value as Agent
}
function requireOwner(ctx:Context,agent:Agent):void{
  if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))
    throw new Error('未确认主人 DSH 工作区，拒绝访问联系人数据')
}
type CommandOutcome={ok:true;text:string}|{ok:false;error:string}
/** Execute one EXISTING YENRA Command in the caller's own Agent scope. */
async function runCommand(ctx:Context,agent:Agent,name:string,arg?:string):Promise<CommandOutcome>{
  const line='/'+name+(arg===undefined||arg===''?'':' '+arg)
  const execution=await ctx.commands.execute(agent,line,[],AbortSignal.timeout(25000))
  if(!execution)return {ok:false,error:'原生命令不可用：'+name}
  if(execution.result.kind!=='success')return {ok:false,error:execution.result.text}
  return {ok:true,text:execution.result.text??''}
}
function decodePrefs(text:string,prefix:string):Record<string,unknown>|null{
  if(!text.startsWith(prefix))return null
  try{
    const value:unknown=JSON.parse(text.slice(prefix.length))
    return value&&typeof value==='object'&&!Array.isArray(value)
      ?value as Record<string,unknown>:null
  }catch{return null}
}
type Contact={channel:'WhatsApp'|'Personal'|'Page';accountRef:string;roomRef:string}
async function currentContact(im:ImService|undefined,agent:Agent):Promise<Contact>{
  const found=await resolveTrustedContact(im,agent)
  if(!found)throw new Error('当前 Session 未绑定可信联系人；请先在 YENRA 聊天中选择联系人')
  return found
}
function prefsPrefix(channel:Contact['channel']):string{
  return channel==='WhatsApp'?WA_PREFIX:FB_PREFIX
}
async function readPreferences(ctx:Context,agent:Agent,contact:Contact){
  const pair=JSON.stringify({accountRef:contact.accountRef,roomRef:contact.roomRef})
  const name=contact.channel==='WhatsApp'
    ?'yenra-whatsapp-contact-prefs-read':'yenra-facebook-contact-prefs-read'
  const outcome=await runCommand(ctx,agent,name,pair)
  if(!outcome.ok)throw new Error(outcome.error)
  const value=decodePrefs(outcome.text,prefsPrefix(contact.channel))
  if(!value||value.ok!==true||value.accountRef!==contact.accountRef||value.roomRef!==contact.roomRef)
    throw new Error('原生联系人偏好回执与当前联系人身份不一致')
  return value
}
async function savePreferences(ctx:Context,agent:Agent,contact:Contact,
  field:'pinned'|'muted'|'archived'|'manualUnread',value:boolean,retry=true){
  const name=contact.channel==='WhatsApp'
    ?'yenra-whatsapp-contact-prefs-save':'yenra-facebook-contact-prefs-save'
  for(let attempt=0;attempt<2;attempt++){
    const current=await readPreferences(ctx,agent,contact)
    const revision=Number(current.revision)
    if(!Number.isSafeInteger(revision)||revision<0)
      throw new Error('原生联系人偏好版本号无效')
    const outcome=await runCommand(ctx,agent,name,JSON.stringify({
      accountRef:contact.accountRef,roomRef:contact.roomRef,
      field,value,expectedRevision:revision,
    }))
    if(outcome.ok){
      const saved=decodePrefs(outcome.text,prefsPrefix(contact.channel))
      if(!saved||saved.ok!==true||saved.saved!==true)
        throw new Error('原生联系人偏好保存未确认')
      return {saved,previous:current}
    }
    // A concurrent UI click changed the revision: re-read once, then give up
    // with the Host reason instead of retrying blindly.
    if(retry&&/REVISION_CHANGED|stale/i.test(outcome.error)){retry=false;continue}
    throw new Error(outcome.error)
  }
  throw new Error('原生联系人偏好版本持续变化，已放弃本次写入')
}
function prefsOf(value:Record<string,unknown>):Record<string,boolean>{
  const raw=value.preferences
  const source=raw&&typeof raw==='object'&&!Array.isArray(raw)
    ?raw as Record<string,unknown>:{}
  return {
    pinned:source.pinned===true,muted:source.muted===true,
    archived:source.archived===true,manualUnread:source.manualUnread===true,
  }
}
function renderContact(value:Record<string,unknown>):string{
  const channel=String(value.channel??'?')
  const name=typeof value.name==='string'&&value.name?value.name:'未知联系人'
  const prefs=value.preferences&&typeof value.preferences==='object'
    ?value.preferences as Record<string,unknown>:{}
  const flags=['pinned','muted','archived','manualUnread']
    .filter(key=>prefs[key]===true)
  return `${channel} 联系人「${name}」${flags.length?'（'+flags.join('、')+'）':'（无特殊标记）'}`
}

export function registerSocialActionAgentTools(ctx:Context,translate?:TranslationBridge):void{
  let originalIm:ImService|undefined
  ctx.inject(['dshIm'],scope=>scope.effect(()=>{
    const service=(scope as unknown as {dshIm?:ImService}).dshIm
    originalIm=service
    return()=>{if(originalIm===service)originalIm=undefined}
  },'YENRA contact action tools original IM binding'))

  const contactState=async(agent:Agent)=>{
    assertAgentLike(agent,'contactState')
    requireOwner(ctx,agent)
    const contact=await currentContact(originalIm,agent)
    return {contact,value:await readPreferences(ctx,agent,contact)}
  }
  /** Either the CURRENT verified contact, or explicit roster references that
   * the ORIGINAL Host re-verifies on every call (the same check the existing
   * contact menu performs). The model cannot bypass either path. */
  const explicitContact=async(agent:Agent,accountRef:unknown,roomRef:unknown)=>{
    assertAgentLike(agent,'explicitContact')
    const bothGiven=accountRef!==undefined||roomRef!==undefined
    if(!bothGiven)return contactState(agent)
    requireOwner(ctx,agent)
    if(typeof accountRef!=='string'||!REF.test(accountRef)||
      typeof roomRef!=='string'||!REF.test(roomRef))
      throw new Error('联系人引用必须同时提供有效的 accountRef 与 roomRef；请先调用 yenra_social_roster')
    const candidates:Contact[]=[
      {channel:'WhatsApp',accountRef,roomRef},
      {channel:'Page',accountRef,roomRef},
    ]
    let lastError=''
    for(const candidate of candidates){
      try{
        const value=await readPreferences(ctx,agent,candidate)
        const channel=typeof value.channel==='string'&&
          ['WhatsApp','Personal','Page'].includes(value.channel)
          ?value.channel as Contact['channel']:candidate.channel
        return {contact:{...candidate,channel},value}
      }catch(error){
        lastError=error instanceof Error?error.message:String(error)
      }
    }
    throw new Error('原 Host 未验证该账号与联系人：'+lastError)
  }
  /** Current verified contact, or explicit roster refs verified through the
   * SAME room-read authority the contact list uses. */
  const anyContact=async(agent:Agent,accountRef:unknown,roomRef:unknown):Promise<Contact>=>{
    assertAgentLike(agent,'anyContact')
    if(accountRef===undefined&&roomRef===undefined)
      return currentContact(originalIm,agent)
    requireOwner(ctx,agent)
    if(typeof accountRef!=='string'||!REF.test(accountRef)||
      typeof roomRef!=='string'||!REF.test(roomRef))
      throw new Error('联系人引用必须同时提供有效的 accountRef 与 roomRef；请先调用 yenra_social_roster')
    for(const [channel,name] of [['WhatsApp','yenra-social-room'],
      ['Page','yenra-facebook-room']] as const){
      const outcome=await runCommand(ctx,agent,name,JSON.stringify({accountRef,roomRef}))
      if(!outcome.ok)continue
      const value=decodeEnvelope(outcome.text)
      const found=typeof value.channel==='string'&&
        ['WhatsApp','Personal','Page'].includes(value.channel)
        ?value.channel as Contact['channel']:channel
      return {channel:found,accountRef,roomRef}
    }
    throw new Error('原 Host 未验证该账号与联系人')
  }

  registerTool(ctx,{
    name:'yenra_workspace_diag',
    description:'Read-only diagnostic for a trust refusal: report this Session\'s own cwd, whether the original Host trusts it, the installed YENRA root and the original WorkspaceRegistry paths. Contains no messages, account references or credentials, and works even when untrusted.',
    parameters:{type:'object',additionalProperties:false,properties:{}},
    timeoutMs:15000,
    output:{schema:{type:'object',additionalProperties:true,
      required:['cwd','trusted','registeredCount'],
      properties:{cwd:{type:'string'},trusted:{type:'boolean'},
        installedRoot:{type:'string'},registeredCount:{type:'integer'},
        registered:{type:'array'}}},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {cwd?:unknown;trusted?:unknown;installedRoot?:unknown;
          registered?:unknown[];registeredCount?:unknown}
        return [{type:'text',text:[
          'cwd: '+String(v.cwd??''),
          'trusted: '+String(v.trusted===true),
          'installedRoot: '+String(v.installedRoot??''),
          'registered: '+String(v.registeredCount??0)+' 项 '+
            JSON.stringify(v.registered??[]),
        ].join('\n')}]
      }},
    async execute(_args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      const cwd=String(agent.session.header.cwd??'')
      const diag=trustedWorkspaceDiagnostics(ctx)
      return {cwd,trusted:isTrustedNativeWorkspace(ctx,cwd),
        installedRoot:diag.installedRoot,
        registered:diag.registered,registeredCount:diag.registered.length}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_contact_status',
    description:'Report the Host-verified social contact of this Session (channel, account and room references, saved name, and its local pinned/muted/archived/unread marks). Defaults to the CURRENT bound contact; explicit accountRef+roomRef are re-verified by the original Host. Read-only; fails closed when neither is available.',
    parameters:{type:'object',additionalProperties:false,properties:{
      accountRef:{type:'string',description:'Optional roster accountRef'},
      roomRef:{type:'string',description:'Optional roster roomRef'}}},
    timeoutMs:30000,
    output:{
      schema:{type:'object',additionalProperties:true,
        required:['channel','accountRef','roomRef','preferences'],
        properties:{channel:{type:'string'},accountRef:{type:'string'},
          roomRef:{type:'string'},name:{type:'string'},preferences:{type:'object'}}},
      render:(_args:unknown,value:unknown)=>[{type:'text',text:renderContact(value as never)}],
    },
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      const input=(args??{}) as {accountRef?:unknown;roomRef?:unknown}
      const {contact,value}=await explicitContact(agent,input.accountRef,input.roomRef)
      return {
        channel:contact.channel,accountRef:contact.accountRef,roomRef:contact.roomRef,
        name:typeof value.displayName==='string'?value.displayName:undefined,
        revision:Number(value.revision)||0,
        preferences:prefsOf(value),
        scope:'YENRA_LOCAL_DSH_STORAGE',
        sentProof:false,
      }
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_contact_preferences',
    description:'Read or change the local contact marks (pinned, archived, muted, manual unread) through the SAME official DSH Storage Domain rows the YENRA contact menu uses. Defaults to the CURRENT verified contact; explicit accountRef+roomRef from yenra_social_roster are re-verified by the original Host. Local presentation state only: it never mutates WhatsApp/Meta server state and never sends a message. The connected YENRA UI is told to refresh after a successful change.',
    parameters:{type:'object',additionalProperties:false,
      required:['action'],
      properties:{
        action:{type:'string',enum:[...ACTIONS],
          description:'get reads; pin/unpin archive mute unread set the exact mark.'},
        accountRef:{type:'string',
          description:'Optional roster accountRef; omit to use the CURRENT verified contact. Either both refs or neither.'},
        roomRef:{type:'string',
          description:'Optional roster roomRef, re-verified by the original Host.'},
      }},
    timeoutMs:40000,
    output:{
      schema:{type:'object',additionalProperties:true,
        required:['changed','channel','accountRef','roomRef','preferences'],
        properties:{changed:{type:'boolean'},channel:{type:'string'},
          accountRef:{type:'string'},roomRef:{type:'string'},
          preferences:{type:'object'},uiNotified:{type:'boolean'}}},
      render:(args:unknown,value:unknown)=>{
        const action=String((args as {action?:unknown})?.action??'get')
        if(action==='get')return [{type:'text',text:renderContact(value as never)}]
        return [{type:'text',text:'已更新'+renderContact(value as never)}]
      },
    },
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      const input=(args??{}) as {action?:unknown;accountRef?:unknown;roomRef?:unknown}
      const action=input.action
      if(typeof action!=='string'||!ACTIONS.includes(action as PrefAction))
        throw new Error('原生联系人偏好操作无效')
      const explicit=await explicitContact(agent,input.accountRef,input.roomRef)
      const contact=explicit.contact
      const current=explicit.value
      if(action==='get')return {changed:false,channel:contact.channel,
        accountRef:contact.accountRef,roomRef:contact.roomRef,
        name:typeof current.displayName==='string'?current.displayName:undefined,
        revision:Number(current.revision)||0,preferences:prefsOf(current),uiNotified:false}
      const mapping=FIELD[action]!
      const {saved}=await savePreferences(ctx,agent,contact,mapping.field,mapping.value)
      const preferences=prefsOf(saved)
      const uiNotified=originalSocialSseBroadcast.publish('yenra-contact-changed',{
        channel:contact.channel,accountRef:contact.accountRef,roomRef:contact.roomRef,
        field:mapping.field,value:mapping.value,preferences,
      })
      return {changed:true,channel:contact.channel,
        accountRef:contact.accountRef,roomRef:contact.roomRef,
        name:typeof saved.displayName==='string'?saved.displayName:undefined,
        revision:Number(saved.revision)||0,preferences,uiNotified}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_contact_rename',
    description:'Save a local display-name override for the CURRENT verified contact in the official DSH Storage Domain. It changes only YENRA\'s local presentation name; it never edits the platform address book. Currently supported for WhatsApp contacts only.',
    parameters:{type:'object',additionalProperties:false,required:['displayName'],
      properties:{displayName:{type:'string',minLength:1,maxLength:80},
        accountRef:{type:'string',description:'Optional roster accountRef'},
        roomRef:{type:'string',description:'Optional roster roomRef'}}},
    timeoutMs:40000,
    output:{
      schema:{type:'object',additionalProperties:true,
        required:['saved','channel','accountRef','roomRef','displayName'],
        properties:{saved:{type:'boolean'},channel:{type:'string'},
          accountRef:{type:'string'},roomRef:{type:'string'},
          displayName:{type:'string'},uiNotified:{type:'boolean'}}},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {displayName?:unknown}
        return [{type:'text',text:'联系人备注已保存为「'+String(v.displayName??'')+'」'}]
      },
    },
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      const input=(args??{}) as {displayName?:unknown;accountRef?:unknown;roomRef?:unknown}
      const displayName=input.displayName
      if(typeof displayName!=='string'||!displayName.trim()||displayName.trim().length>80||
        /[\x00-\x1f\x7f]/u.test(displayName))
        throw new Error('联系人备注必须为 1-80 个可见字符')
      const {contact,value:pending}=await explicitContact(agent,input.accountRef,input.roomRef)
      if(contact.channel!=='WhatsApp')
        throw new Error('当前联系人属于 '+contact.channel+'；现有原生接口尚未提供该渠道的本地备注保存')
      const revision=Number(pending.revision)
      if(!Number.isSafeInteger(revision)||revision<0)throw new Error('原生联系人版本号无效')
      const outcome=await runCommand(ctx,agent,'yenra-whatsapp-contact-name-save',JSON.stringify({
        accountRef:contact.accountRef,roomRef:contact.roomRef,
        displayName:displayName.trim(),expectedRevision:revision,
      }))
      if(!outcome.ok)throw new Error(outcome.error)
      const saved=decodePrefs(outcome.text,WA_PREFIX)
      if(!saved||saved.ok!==true||saved.saved!==true||saved.displayName!==displayName.trim())
        throw new Error('原生联系人备注保存未确认')
      const uiNotified=originalSocialSseBroadcast.publish('yenra-contact-changed',{
        channel:contact.channel,accountRef:contact.accountRef,roomRef:contact.roomRef,
        field:'displayName',value:displayName.trim(),
      })
      return {saved:true,channel:contact.channel,accountRef:contact.accountRef,
        roomRef:contact.roomRef,displayName:displayName.trim(),
        revision:Number(saved.revision)||0,uiNotified}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_contact_local_remove',
    description:'Remove only the YENRA-local contact record or name override of a verified WhatsApp contact (defaults to the CURRENT contact; explicit refs are re-verified). The original platform chat, messages, avatar and account remain untouched. Never use it to delete a real conversation.',
    parameters:{type:'object',additionalProperties:false,properties:{
      accountRef:{type:'string',description:'Optional roster accountRef'},
      roomRef:{type:'string',description:'Optional roster roomRef'}}},
    timeoutMs:40000,
    output:{
      schema:{type:'object',additionalProperties:true,
        required:['removed','channel','accountRef','roomRef'],
        properties:{removed:{type:'boolean'},channel:{type:'string'},
          accountRef:{type:'string'},roomRef:{type:'string'},uiNotified:{type:'boolean'}}},
      render:()=>[{type:'text',text:'已移除本地联系人记录；平台原始聊天保持不变。'}],
    },
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      const input=(args??{}) as {accountRef?:unknown;roomRef?:unknown}
      const {contact,value:pending}=await explicitContact(agent,input.accountRef,input.roomRef)
      if(contact.channel!=='WhatsApp')
        throw new Error('当前联系人属于 '+contact.channel+'；现有原生接口尚未提供该渠道的本地移除')
      const revision=Number(pending.revision)
      if(!Number.isSafeInteger(revision)||revision<0)throw new Error('原生联系人版本号无效')
      const outcome=await runCommand(ctx,agent,'yenra-whatsapp-contact-remove',JSON.stringify({
        accountRef:contact.accountRef,roomRef:contact.roomRef,expectedRevision:revision,
      }))
      if(!outcome.ok)throw new Error(outcome.error)
      const removed=decodePrefs(outcome.text,WA_PREFIX)
      if(!removed||removed.ok!==true||removed.removed!==true)
        throw new Error('原生联系人本地移除未确认')
      const uiNotified=originalSocialSseBroadcast.publish('yenra-contact-changed',{
        channel:contact.channel,accountRef:contact.accountRef,roomRef:contact.roomRef,
        field:'localRemove',value:true,
      })
      return {removed:true,channel:contact.channel,accountRef:contact.accountRef,
        roomRef:contact.roomRef,uiNotified}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_memory',
    description:'Work with the SAME official session-scoped MemoryService the YENRA memory panel uses: list, search, save, forget, or atomically correct one entry (id + exact previous text). Owner facts use the owner workspace; a verified contact Session reads and writes only its own contact relationship scope. The scope is derived by the Host from the Session binding, never from a tool argument.',
    parameters:{type:'object',additionalProperties:false,required:['action'],
      properties:{
        action:{type:'string',enum:['list','search','save','forget','correct']},
        query:{type:'string',maxLength:180,description:'search keyword'},
        text:{type:'string',maxLength:2000,description:'new memory text'},
        id:{type:'string',maxLength:120,description:'entry id for forget/correct'},
        expectedText:{type:'string',maxLength:2000,
          description:'exact previous text, required for correct'},
        tags:{type:'array',items:{type:'string'},maxItems:16},
        importance:{type:'string',enum:['low','medium','high']},
      }},
    timeoutMs:45000,
    output:{schema:{type:'object',additionalProperties:true},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {entries?:unknown[];saved?:{text?:unknown};corrected?:boolean;forgotten?:boolean}
        if(v.corrected===true)return [{type:'text',text:'记忆已在原记录 ID 上纠正并读回。'}]
        if(v.forgotten===true)return [{type:'text',text:'记忆已删除并核查。'}]
        if(v.saved&&typeof v.saved==='object')
          return [{type:'text',text:'记忆已保存并读回：'+String(v.saved.text??'')}]
        const entries=Array.isArray(v.entries)?v.entries:[]
        if(entries.length===0)return [{type:'text',text:'当前作用域没有记忆记录。'}]
        const lines=entries.slice(0,20).map((raw,index)=>{
          const entry=(raw??{}) as Record<string,unknown>
          return `${index+1}. [${String(entry.id??'')}] ${String(entry.text??'')}`
        })
        return [{type:'text',text:`共 ${entries.length} 条记忆：\n${lines.join('\n')}`}]
      }},
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      requireOwner(ctx,agent)
      const input=(args??{}) as Record<string,unknown>
      const action=input.action
      // A contact Session must be bound to its Host-verified relationship
      // scope first, exactly like the memory panel does on open. The tuple is
      // taken from the Session title and re-verified by the command handler;
      // the model cannot choose an identity.
      if(isContactBrainSession(agent)){
        const match=/^YENRA:B:([a-f0-9]{32}):([a-f0-9]{32})$/u.exec(sessionTitle(agent)??'')
        if(!match)throw new Error('当前联系人 Session 身份不完整，拒绝记忆访问')
        for(const channel of ['WhatsApp','Personal','Page'] as const){
          const bound=await runCommand(ctx,agent,'yenra-memory-bind',JSON.stringify({
            kind:'contact',channel,accountRef:match[1],roomRef:match[2],
          }))
          // A bind failure for the wrong channel is expected; continue probing.
          if(bound.ok)break
          if(channel==='Page')throw new Error(bound.error)
        }
      }else{
        // The owner panel binds the SAME owner scope before listing; without it
        // the mature MemoryService refuses with `Host-verified Session binding
        // required`. The bind is Host-verified: the model cannot choose a scope.
        const bound=await runCommand(ctx,agent,'yenra-memory-bind',JSON.stringify({kind:'owner'}))
        if(!bound.ok)throw new Error(bound.error)
      }
      if(action==='list'){
        const outcome=await runCommand(ctx,agent,'yenra-memory-list')
        return decodeOrThrow(outcome)
      }
      if(action==='search'){
        const query=typeof input.query==='string'?input.query.trim():''
        if(!query)throw new Error('请提供搜索关键词')
        return decodeOrThrow(await runCommand(ctx,agent,'yenra-memory-search',query))
      }
      if(action==='forget'){
        const id=typeof input.id==='string'?input.id.trim():''
        if(!id)throw new Error('请提供要删除的记忆 ID')
        return decodeOrThrow(await runCommand(ctx,agent,'yenra-memory-forget',id))
      }
      const text=typeof input.text==='string'?input.text.trim():''
      if(!text)throw new Error('请提供记忆内容')
      const payload:Record<string,unknown>={text}
      if(Array.isArray(input.tags))payload.tags=input.tags
      if(typeof input.importance==='string')payload.importance=input.importance
      if(action==='correct'){
        const id=typeof input.id==='string'?input.id.trim():''
        if(!id)throw new Error('纠正需要原记忆 ID')
        if(typeof input.expectedText!=='string'||!input.expectedText)
          throw new Error('纠正需要原记忆的完整文本快照')
        payload.oldId=id
        payload.expectedText=input.expectedText
      }
      const name=action==='correct'?'yenra-memory-correct':'yenra-memory-save'
      return decodeOrThrow(await runCommand(ctx,agent,name,JSON.stringify(payload)))
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_draft_adopt',
    description:'Put a prepared reply into the EXISTING YENRA chat input of the verified contact (the same prefill action the Adopt button performs). Defaults to the CURRENT contact; explicit refs are re-verified. It never sends: the owner still reviews and presses send. Fails when no YENRA window is connected or the selected contact differs.',
    parameters:{type:'object',additionalProperties:false,required:['text'],
      properties:{text:{type:'string',minLength:1,maxLength:2000},
        accountRef:{type:'string',description:'Optional roster accountRef'},
        roomRef:{type:'string',description:'Optional roster roomRef'}}},
    timeoutMs:20000,
    output:{
      schema:{type:'object',additionalProperties:true,
        required:['delivered','channel','accountRef','roomRef'],
        properties:{delivered:{type:'boolean'},channel:{type:'string'},
          accountRef:{type:'string'},roomRef:{type:'string'},sent:{type:'boolean'}}},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {delivered?:unknown}
        return [{type:'text',text:v.delivered===true
          ?'已放入当前聊天输入框（未发送，请主人确认后自行发送）'
          :'未能放入输入框：当前没有已连接的 YENRA 聊天窗口'}]
      },
    },
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      const input=(args??{}) as {text?:unknown;accountRef?:unknown;roomRef?:unknown}
      const text=input.text
      if(typeof text!=='string'||!text.trim()||text.length>2000)
        throw new Error('回复草稿必须为 1-2000 个字符')
      const contact=await anyContact(agent,input.accountRef,input.roomRef)
      const delivered=originalSocialSseBroadcast.publish('yenra-draft-adopt',{
        channel:contact.channel,accountRef:contact.accountRef,roomRef:contact.roomRef,
        text:text.trim(),
      })
      if(!delivered)throw new Error('没有已连接的 YENRA 聊天窗口；请先打开聊天面板后重试')
      return {delivered:true,channel:contact.channel,accountRef:contact.accountRef,
        roomRef:contact.roomRef,sent:false}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_panel_open',
    description:'Switch the YENRA window to one registered native main panel: chat, memory and relations, plugin market, Meta ads, schedules, plugins, or the DSH conversation. Use it instead of simulating clicks. It changes only the visible panel; it does not switch Session, account or contact.',
    parameters:{type:'object',additionalProperties:false,required:['panel'],
      properties:{panel:{type:'string',enum:[...PANELS]}}},
    timeoutMs:15000,
    output:{
      schema:{type:'object',additionalProperties:true,
        required:['delivered','panel'],
        properties:{delivered:{type:'boolean'},panel:{type:'string'}}},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {delivered?:unknown;panel?:unknown}
        return [{type:'text',text:v.delivered===true
          ?'已切换到面板：'+String(v.panel??'')
          :'未能切换：当前没有已连接的 YENRA 窗口'}]
      },
    },
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      requireOwner(ctx,agent)
      const panel=(args as {panel?:unknown})?.panel
      if(typeof panel!=='string'||!PANELS.has(panel))
        throw new Error('未注册的面板：'+String(panel))
      const delivered=originalSocialSseBroadcast.publish('yenra-panel-open',{panel})
      if(!delivered)throw new Error('没有已连接的 YENRA 窗口；请先打开 YENRA 界面后重试')
      return {delivered:true,panel}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_contact_history',
    description:'Read recent real messages of ONE contact chosen from the authorized YENRA roster (WhatsApp, Facebook Personal or Page). The account and room references are re-verified by the original Host on every call; unknown or unauthorized references fail closed. Read-only, never sends and never opens a second provider connection.',
    parameters:{type:'object',additionalProperties:false,
      required:['accountRef','roomRef'],
      properties:{
        accountRef:{type:'string',description:'accountRef from yenra_social_roster'},
        roomRef:{type:'string',description:'roomRef from yenra_social_roster'},
        limit:{type:'integer',minimum:1,maximum:100,
          description:'how many latest messages to return (default 30)'},
      }},
    timeoutMs:45000,
    output:{schema:{type:'object',additionalProperties:true,
      required:['accountRef','roomRef','messages'],
      properties:{channel:{type:'string'},accountRef:{type:'string'},
        roomRef:{type:'string'},name:{type:'string'},messages:{type:'array'}}},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {channel?:unknown;name?:unknown;messages?:unknown[]}
        const messages=Array.isArray(v.messages)?v.messages:[]
        const head=`[${String(v.channel??'?')}] 联系人「${String(v.name??'未知')}」最近 ${messages.length} 条消息：`
        const lines=messages.slice(-30).map((raw)=>{
          const m=(raw??{}) as Record<string,unknown>
          const at=Number.isFinite(m.timestamp)?new Date(Number(m.timestamp)).toISOString():''
          return `${m.direction==='OUTBOUND'?'我方':'对方'} ${at}：${String(m.text??'').slice(0,300)}`
        })
        return [{type:'text',text:head+'\n'+lines.join('\n')}]
      }},
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      requireOwner(ctx,agent)
      const input=(args??{}) as {accountRef?:unknown;roomRef?:unknown;limit?:unknown}
      if(typeof input.accountRef!=='string'||!REF.test(input.accountRef)||
        typeof input.roomRef!=='string'||!REF.test(input.roomRef))
        throw new Error('联系人引用无效；请先调用 yenra_social_roster 获取')
      const payload=JSON.stringify({accountRef:input.accountRef,roomRef:input.roomRef})
      let outcome=await runCommand(ctx,agent,'yenra-social-room',payload)
      if(!outcome.ok)
        outcome=await runCommand(ctx,agent,'yenra-facebook-room',payload)
      if(!outcome.ok)throw new Error(outcome.error)
      const value=decodeEnvelope(outcome.text)
      const messages=Array.isArray(value.messages)?value.messages:[]
      const limit=Number.isSafeInteger(input.limit)?Math.min(100,Math.max(1,Number(input.limit))):30
      return {channel:typeof value.channel==='string'?value.channel:undefined,
        accountRef:input.accountRef,roomRef:input.roomRef,
        name:typeof value.name==='string'?value.name:undefined,
        messages:messages.slice(-limit)}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_send_receipts',
    description:'Report the real provider delivery state of a contact\'s outbound messages: only receipts the original Sender/Socket actually observed (provider submitted/accepted/delivered/read). A missing receipt is reported as UNKNOWN, never as delivered. Defaults to the CURRENT verified contact; explicit accountRef+roomRef are re-verified by the original Host.',
    parameters:{type:'object',additionalProperties:false,properties:{
      accountRef:{type:'string',description:'Optional roster accountRef'},
      roomRef:{type:'string',description:'Optional roster roomRef'}}},
    timeoutMs:45000,
    output:{schema:{type:'object',additionalProperties:true,
      required:['channel','accountRef','roomRef','receipts'],
      properties:{channel:{type:'string'},accountRef:{type:'string'},
        roomRef:{type:'string'},receipts:{type:'array'},unknown:{type:'integer'}}},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {receipts?:unknown[];unknown?:unknown}
        const receipts=Array.isArray(v.receipts)?v.receipts:[]
        if(receipts.length===0)
          return [{type:'text',text:'当前联系人没有可用的平台发送回执（未观察到投递/已读，不能视为已送达）。'}]
        const lines=receipts.slice(-20).map((raw)=>{
          const r=(raw??{}) as Record<string,unknown>
          return `${String(r.id??'')} → ${String(r.deliveryStatus??'UNKNOWN')}`
        })
        return [{type:'text',text:`已观察到的发送回执：\n${lines.join('\n')}`}]
      }},
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      requireOwner(ctx,agent)
      const input=(args??{}) as {accountRef?:unknown;roomRef?:unknown}
      const contact=await anyContact(agent,input.accountRef,input.roomRef)
      const payload=JSON.stringify({accountRef:contact.accountRef,roomRef:contact.roomRef})
      let outcome=await runCommand(ctx,agent,
        contact.channel==='WhatsApp'?'yenra-social-room':'yenra-facebook-room',payload)
      if(!outcome.ok)throw new Error(outcome.error)
      const value=decodeEnvelope(outcome.text)
      const messages=Array.isArray(value.messages)?value.messages:[]
      const outbound=messages.filter((raw)=>{
        const m=(raw??{}) as Record<string,unknown>
        return m.direction==='OUTBOUND'
      })
      const receipts=outbound.map((raw)=>{
        const m=raw as Record<string,unknown>
        return {id:typeof m.id==='string'?m.id:undefined,
          timestamp:Number.isFinite(m.timestamp)?Number(m.timestamp):undefined,
          deliveryStatus:typeof m.verifiedDeliveryStatus==='string'
            ?m.verifiedDeliveryStatus:'UNKNOWN',
          ackKind:typeof m.verifiedAckKind==='string'?m.verifiedAckKind:undefined,
          ackSource:typeof m.verifiedAckSource==='string'?m.verifiedAckSource:undefined,
          observedAt:Number.isFinite(m.verifiedAckObservedAt)
            ?Number(m.verifiedAckObservedAt):undefined}
      })
      const unknown=receipts.filter(receipt=>receipt.deliveryStatus==='UNKNOWN').length
      return {channel:contact.channel,accountRef:contact.accountRef,
        roomRef:contact.roomRef,receipts,unknown,sentProof:false}
    },
  } as never)

  registerTool(ctx,{
    name:'yenra_translate',
    description:'Translate real chat content through the SAME original DSH translation pipeline the YENRA UI uses (same Host authority checks, same official cache, same model queue). Defaults to the CURRENT verified contact; explicit accountRef+roomRef are re-verified by the original Host. target=zh translates recent real messages into Chinese; target=de rewrites one Chinese reply draft into German. It never sends and never invents messages.',
    parameters:{type:'object',additionalProperties:false,required:['target'],
      properties:{
        target:{type:'string',enum:['zh','de'],description:'zh = recent messages to Chinese; de = Chinese draft to German'},
        limit:{type:'integer',minimum:1,maximum:20,description:'how many recent messages to translate for zh (default 10)'},
        text:{type:'string',maxLength:1200,description:'Chinese draft for target=de'},
        accountRef:{type:'string',description:'Optional roster accountRef'},
        roomRef:{type:'string',description:'Optional roster roomRef'},
      }},
    timeoutMs:120000,
    output:{schema:{type:'object',additionalProperties:true},
      render:(_args:unknown,value:unknown)=>{
        const v=value as {target?:unknown;translation?:unknown;
          items?:Array<{original?:unknown;translation?:unknown}>}
        if(v.target==='de')
          return [{type:'text',text:'德语：'+String(v.translation??'')}]
        const items=Array.isArray(v.items)?v.items:[]
        const lines=items.map(item=>`原文：${String(item.original??'')}\n译文：${String(item.translation??'')}`)
        return [{type:'text',text:lines.join('\n\n')||'没有可翻译的消息'}]
      }},
    async execute(args:unknown,exec:{agent?:Agent}){
      const agent=requireAgent(exec)
      requireOwner(ctx,agent)
      if(!translate||typeof translate.translate!=='function')
        throw new Error('原生翻译管线尚未就绪')
      const input=(args??{}) as {target?:unknown;limit?:unknown;text?:unknown;
        accountRef?:unknown;roomRef?:unknown}
      const target=input.target
      if(target!=='zh'&&target!=='de')throw new Error('翻译目标必须是 zh 或 de')
      const contact=await anyContact(agent,input.accountRef,input.roomRef)
      const sessionId=agent.session.header.id
      if(!/^session-[a-f0-9-]{36}$/u.test(sessionId))
        throw new Error('当前 Session 引用无效，拒绝翻译')
      if(target==='de'){
        const text=typeof input.text==='string'?input.text.trim():''
        if(!text||text.length>1200||!/[\u4e00-\u9fff]/u.test(text))
          throw new Error('德语改写需要 1-1200 个字符的中文草稿')
        const result=await translate.translate({channel:contact.channel,
          accountRef:contact.accountRef,roomRef:contact.roomRef,
          direction:'to-de',sessionId,items:[{id:'draft',text}]})
        const translation=result.items[0]?.translation
        if(!translation)throw new Error('原生翻译未返回德语结果')
        return {target:'de',cached:result.cached,original:text,translation,sent:false}
      }
      const limit=Number.isSafeInteger(input.limit)
        ?Math.min(20,Math.max(1,Number(input.limit))):10
      const command=contact.channel==='WhatsApp'?'yenra-social-room':'yenra-facebook-room'
      const outcome=await runCommand(ctx,agent,command,JSON.stringify({
        accountRef:contact.accountRef,roomRef:contact.roomRef}))
      if(!outcome.ok)throw new Error(outcome.error)
      const room=decodeEnvelope(outcome.text)
      const messages=Array.isArray(room.messages)?room.messages:[]
      // The room projection names the provider message id `mid` (the contact
      // history tool also reads that shape); accept `id` only as a fallback.
      const providerId=(raw:unknown):string=>{
        const m=(raw??{}) as Record<string,unknown>
        const value=typeof m.mid==='string'?m.mid
          :typeof m.id==='string'?m.id:''
        return value.length>0&&value.length<=180?value:''
      }
      const items=messages.filter((raw)=>{
        const m=(raw??{}) as Record<string,unknown>
        return providerId(raw)!==''&&
          typeof m.text==='string'&&Boolean(m.text.trim())&&m.text.length<=1200
      }).slice(-limit).map((raw)=>{
        const m=raw as {text:string}
        return {id:providerId(raw),text:m.text}
      })
      if(items.length===0)throw new Error('当前联系人没有可翻译的真实消息')
      const result=await translate.translate({channel:contact.channel,
        accountRef:contact.accountRef,roomRef:contact.roomRef,
        direction:'to-zh',sessionId,items})
      const map=new Map(result.items.map(item=>[item.id,item.translation]))
      return {target:'zh',channel:contact.channel,
        accountRef:contact.accountRef,roomRef:contact.roomRef,
        cached:result.cached,
        items:items.map(item=>({id:item.id,original:item.text,
          translation:map.get(item.id)}))}
    },
  } as never)
}

/** The Session's own title is a lookup key for the contact and, for memory,
 * only a hint the Host re-verifies; never an authorization by itself. */
function sessionTitle(agent:Agent):string|undefined{
  const events=agent.session.snapshotEvents() as unknown as readonly {type:string;data?:unknown}[]
  const event=events.findLast(e=>e.type==='session/title')
  const data=event?.data as {title?:string}|undefined
  return typeof data?.title==='string'?data.title:undefined
}

function decodeOrThrow(outcome:CommandOutcome):Record<string,unknown>{
  if(!outcome.ok)throw new Error(outcome.error)
  const prefix='YENRA_MEMORY_V1:'
  if(!outcome.text.startsWith(prefix))throw new Error('原生记忆回执不完整')
  try{
    const value:unknown=JSON.parse(outcome.text.slice(prefix.length))
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new Error('原生记忆回执格式错误')
    return value as Record<string,unknown>
  }catch(e){
    if(e instanceof Error&&e.message.includes('回执'))throw e
    throw new Error('原生记忆回执不是有效数据')
  }
}
