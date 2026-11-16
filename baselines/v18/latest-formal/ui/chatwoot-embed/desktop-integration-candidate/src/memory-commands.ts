/** YENRA-only thin UI adapter over the installed mature dsh-memory service.
 * Registered as official DSH Commands, addressed to an existing Agent Session.
 * No Host HTTP endpoint, independent memory storage, custom RPC or alternate Agent.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type { MemoryService } from '../../../brain-memory/compat/guntur-dsh-memory-rc5/src/index.ts'
import type { MemoryEntry, MemoryEntryInput, MemoryId } from '../../../brain-memory/compat/guntur-dsh-memory-rc5/src/types.ts'
import type { VerifiedMemoryScope } from '../../../brain-memory/compat/guntur-dsh-memory-rc5-scoped/src/index.ts'
import { resolveExistingFacebookContactPreferenceRoom } from './facebook-social-commands.ts'
import { readExistingWhatsAppRosterForOss, currentBots, accountRef as waAccountRef, roomRef as waRoomRef, readInbox } from './social-readonly-commands.ts'

import {isTrustedNativeWorkspace} from './trusted-native-workspace.ts'
import {createNativeMemoryAdoptSingleFlight} from './native-memory-adopt-singleflight.ts'
const PREFIX='YENRA_MEMORY_V1:'
type Importance='low'|'medium'|'high'
const normalized=(input:string)=>input.replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase()
const supportsAtomicCorrection=(memory:MemoryService)=>typeof (memory as MemoryService & {correct?:unknown}).correct==='function'
const entryWire=(m:MemoryEntry)=>({
  id:String(m.id),workspace:m.workspace,text:m.text,tags:[...m.tags],
  importance:m.importance,seq:m.seq,createdAt:m.createdAt,sourceSession:m.sourceSession,
})
type Input={text:string;tags?:string[];importance?:Importance;oldId?:string;expectedText?:string}
function readInput(raw:string):Input {
  if(raw.length>8000)throw new Error('记忆输入超过限制')
  const obj:unknown=JSON.parse(raw)
  if(obj===null||typeof obj!=='object'||Array.isArray(obj))throw new Error('记忆数据必须是对象')
  const x=obj as Record<string,unknown>
  if(typeof x.text!=='string'||!x.text.trim()||x.text.length>2000)throw new Error('记忆内容为空或超过限制')
  if(x.oldId!==undefined&&(typeof x.oldId!=='string'||!x.oldId.trim()))throw new Error('无效的旧记录 ID')
  if(x.expectedText!==undefined&&typeof x.expectedText!=='string')throw new Error('旧记录快照格式不正确')
  if(x.tags!==undefined&&(!Array.isArray(x.tags)||x.tags.length>16||!x.tags.every(t=>typeof t==='string'&&t.length<=64)))throw new Error('记忆标签不合法')
  if(x.importance!==undefined&&!['low','medium','high'].includes(String(x.importance)))throw new Error('重要性参数不合法')
  return {text:x.text.trim(),...(x.tags!==undefined?{tags:x.tags as string[]}:{}),
    ...(x.importance!==undefined?{importance:x.importance as Importance}:{}),
    ...(x.oldId!==undefined?{oldId:x.oldId as string}:{}),
    ...(x.expectedText!==undefined?{expectedText:x.expectedText as string}:{})}
}
const writeResult=(data:unknown)=>({kind:'success' as const,text:PREFIX+JSON.stringify(data)})
const errorResult=(e:unknown)=>({kind:'error' as const,text:'记忆操作失败：'+(e instanceof Error?e.message:String(e))})
const scopeError=(ctx:Context,cwd:string|undefined)=>!isTrustedNativeWorkspace(ctx,cwd)
// A Brain title is not authorization. It can only DENY owner-memory commands
// until the original Host binds (channel, accountRef, roomRef) to SessionId.
const unboundContactBrain=(agent:Parameters<MemoryService['list']>[0]):boolean=>{
  const events=agent.session.snapshotEvents() as readonly {type:string;data?:unknown}[]
  return events.some(event=>{
    if(!event.data||typeof event.data!=='object')return false
    const data=event.data as Record<string,unknown>
    if(event.type==='session/title'&&typeof data.title==='string')
      return data.title.startsWith('YENRA:B:')||data.title.startsWith('YENRA:P:')||
        data.title.startsWith('YENRA:W:')||data.title.startsWith('YENRA:F:')||
        data.title.startsWith('YENRA · 闺蜜 · ')
    if(event.type==='user/message'&&Array.isArray(data.content))
      return data.content.some(part=>!!part&&typeof part==='object'&&
        typeof (part as Record<string,unknown>).text==='string'&&
        ((part as Record<string,unknown>).text as string).includes('YENRA_ADVICE_V1'))
    return false
  })
}
const found=(memory:MemoryService,agent:Parameters<MemoryService['list']>[0],id:string)=>
  memory.list(agent).find(entry=>String(entry.id)===id)

export function registerMemoryUiCommands(ctx:Context):void {
  // Coalesce only simultaneous writes of one exact user-adopted draft in one
  // trusted workspace. No permission cache, second memory store or Sender.
  const adoptFlight=createNativeMemoryAdoptSingleFlight()
  // The original IM service is injected, not instantiated or reconnected.
  let originalIm:Parameters<typeof readExistingWhatsAppRosterForOss>[0]|undefined
  // Verify Cloud Page memory through the EXISTING Bridge and its currently
  // authorized Cloud contact_inboxes, not through an invented legacy Page room.
  const verifyCloudPage=async(v:Extract<VerifiedMemoryScope,{kind:'contact'}>):Promise<boolean>=>{
    if(v.channel!=='Page'||!v.pageIdentityHash||
      !/^[a-f0-9]{64}$/u.test(v.pageIdentityHash))return false
    const origin=process.env.YENRA_CHATWOOT_BRIDGE_ORIGIN||'http://127.0.0.1:31917'
    if(!/^http:\/\/127\.0\.0\.1:\d{2,5}$/u.test(origin))return false
    try {
      const response=await fetch(new URL('/yenra-cloud/memory-verify',origin),{
        method:'POST',redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(12000),
        headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-memory':'1'},
        body:JSON.stringify({accountRef:v.accountRef,roomRef:v.roomRef,
          pageIdentityHash:v.pageIdentityHash})
      })
      return response.ok&&(await response.json())?.ok===true
    }catch{return false}
  }
  // R2: Verify remote WhatsApp against the SAME Bridge and Cloud inbox.
  // It is not an original local DSH-IM account and MUST never borrow its socket.
  const verifyCloudRemoteWa=async(v:Extract<VerifiedMemoryScope,{kind:'contact'}>):Promise<boolean>=>{
    if(v.channel!=='WhatsApp'||!/^[a-f0-9]{64}$/u.test(v.cloudIdentityHash??'')||
      !Number.isSafeInteger(v.expectedInboxId)||(v.expectedInboxId??0)<=0)return false
    const origin=process.env.YENRA_CHATWOOT_BRIDGE_ORIGIN||'http://127.0.0.1:31917'
    if(!/^http:\/\/127\.0\.0\.1:\d{2,5}$/u.test(origin))return false
    try{
      const response=await fetch(new URL('/yenra-cloud/remote-wa-memory-verify',origin),{
        method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),
        headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-memory':'1'},
        body:JSON.stringify({accountRef:v.accountRef,roomRef:v.roomRef,
          cloudIdentityHash:v.cloudIdentityHash,expectedInboxId:v.expectedInboxId})
      })
      return response.ok&&(await response.json())?.ok===true
    }catch{return false}
  }
  // Existing Cloud Personal Inbox 155900 is distinct from WhatsApp/Page.
  // Re-verify current signed Cloud contact and original inbox before each
  // MemoryService bind or write; no local second memory store or sender.
  const verifyCloudRemotePersonal=async(v:Extract<VerifiedMemoryScope,{kind:'contact'}>):Promise<boolean>=>{
    if(v.channel!=='Personal'||v.expectedInboxId!==155900||
      !/^[a-f0-9]{64}$/u.test(v.cloudIdentityHash??''))return false
    const origin=process.env.YENRA_CHATWOOT_BRIDGE_ORIGIN||'http://127.0.0.1:31917'
    if(!/^http:\/\/127\.0\.0\.1:\d{2,5}$/u.test(origin))return false
    try{
      const response=await fetch(new URL('/yenra-cloud/remote-personal-memory-verify',origin),{
        method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),
        headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-memory':'1'},
        body:JSON.stringify({accountRef:v.accountRef,roomRef:v.roomRef,
          cloudIdentityHash:v.cloudIdentityHash,expectedInboxId:v.expectedInboxId})
      })
      return response.ok&&(await response.json())?.ok===true
    }catch{return false}
  }
  // Consult the EXISTING provider authorities on every manual memory access.
  // A prior Session bind is not proof that the account is still authorized.
  const hostVerifiesContact=async(v:Extract<VerifiedMemoryScope,{kind:'contact'}>):Promise<boolean>=>{
    if(v.channel==='Personal'&&v.cloudIdentityHash!==undefined)
      return verifyCloudRemotePersonal(v)
    if(v.channel==='WhatsApp'&&v.cloudIdentityHash!==undefined)
      return verifyCloudRemoteWa(v)
    if(v.channel==='WhatsApp'){
      // Original installed DSH-IM controller is authoritative: registered bot,
      // exact stored room mapping AND current live Baileys connection, never
      // a cached inbox or model-supplied id alone.
      if(!originalIm||typeof originalIm.whatsappCurrentlyAuthorized!=='function')return false
      const bots=await currentBots(originalIm)
      const originalBot=bots.find(bot=>waAccountRef(bot.botId)===v.accountRef)
      if(!originalBot||await originalIm.whatsappCurrentlyAuthorized(originalBot.botId)!==true)return false
      const inbox=await readInbox(originalBot.botId)
      return inbox.chats.some(chat=>waRoomRef(originalBot.botId,chat.jid)===v.roomRef)
    }
    if(v.channel==='Page'&&v.pageIdentityHash!==undefined)
      return verifyCloudPage(v)
    const found=await resolveExistingFacebookContactPreferenceRoom({accountRef:v.accountRef,roomRef:v.roomRef})
    return found?.channel===v.channel&&found.accountRef===v.accountRef&&found.roomRef===v.roomRef
  }
  ctx.inject(['dshIm'],scope=>scope.effect(()=>{
    originalIm=(scope as unknown as {dshIm:typeof originalIm}).dshIm
    return()=>{originalIm=undefined}
  },'YENRA memory read-only trusted original IM binding'))
  // Native official DSH waterfall: re-verify Host proof at the moment the
  // MODEL would read a memory tool result or receive app:memory. The .1 plugin's
  // shared CWD is NOT an allowed relation scope, even if its model tool exists.
  const guardedAgents=new WeakSet<object>()
  const installAgentMemoryGuard=(agent:Parameters<MemoryService['list']>[0]):void=>{
    if(!agent?.ctx||!agent.session)return
    // The original DSH owner has access to the single existing workspace.
    // The exact title and CWD must both be satisfied; historical contact
    // Sessions are never granted an owner binding.
    const possible=agent.ctx.get('memory') as MemoryService&{
      bindVerifiedScope?:(a:typeof agent,v:VerifiedMemoryScope)=>string
    }|undefined
    if(typeof possible?.bindVerifiedScope==='function'&&
      !scopeError(ctx,agent.session.header.cwd)&&!unboundContactBrain(agent)){
      const current=agent.session.snapshotEvents().filter(e=>e.type==='session/title').at(-1)?.data
      if(current&&'title' in current&&current.title==='YENRA · 闺蜜大脑'){
        try{possible.bindVerifiedScope(agent,{kind:'owner'})}catch{/* not a verified owner */}
      }
    }
    if(guardedAgents.has(agent))return
    guardedAgents.add(agent)
    const safeContact=async():Promise<boolean>=>{
      const memory=agent.ctx.get('memory') as MemoryService&{
        verifiedScope?:(a:typeof agent)=>VerifiedMemoryScope&{workspace:string};
        bindVerifiedScope?:(a:typeof agent,s:VerifiedMemoryScope)=>string;
        revokeVerifiedAccount?:(channel:'WhatsApp'|'Personal'|'Page',accountRef:string)=>void
      }|undefined
      if(typeof memory?.verifiedScope!=='function'||typeof memory.bindVerifiedScope!=='function')
        return false
      let verified:VerifiedMemoryScope&{workspace:string}|undefined
      try{verified=memory.verifiedScope(agent)}catch{/* may not yet be bound */}
      if(!verified){
        // A Session title is ONLY a lookup key. The original Host must prove
        // the exact channel/account/room before any capability can be granted.
        const events=agent.session.snapshotEvents().filter(e=>e.type==='session/title')
        const title=events.at(-1)?.data
        const tuple=title&&'title' in title&&typeof title.title==='string'
          ?/^YENRA:B:([a-f0-9]{32}):([a-f0-9]{32})$/.exec(title.title):null
        if(!tuple)return false
        for(const channel of ['WhatsApp','Personal','Page'] as const){
          const candidate:VerifiedMemoryScope={kind:'contact',channel,
            accountRef:tuple[1]!,roomRef:tuple[2]!}
          let authorized=false
          try{authorized=await hostVerifiesContact(candidate)}catch{/* fail closed */}
          if(!authorized)continue
          try{
            memory.bindVerifiedScope(agent,candidate)
            verified=memory.verifiedScope(agent)
          }catch{return false}
          break
        }
      }
      if(!verified||verified.kind!=='contact')return false
      let live=false
      try{live=await hostVerifiesContact(verified)}catch{/* fail closed */}
      if(!live)memory.revokeVerifiedAccount?.(verified.channel,verified.accountRef)
      return live
    }
    const isRelation=()=>unboundContactBrain(agent)
    agent.ctx.on('tools/pre-execute',async(exec,next)=>{
      if(!['memory_write','memory_list','memory_search','memory_forget'].includes(exec.name)||
         (exec.agent&&exec.agent.id!==agent.id)||!isRelation())return next()
      if(!await safeContact())return {kind:'deny',reason:'当前联系人未通过原 Host 实时记忆身份验证，拒绝记忆工具调用'}
      return next()
    })
    agent.ctx.on('system-prompt/assemble',async(assembly,_context,next)=>{
      // Check BEFORE official app:memory calculates its section so the
      // CURRENT contact can use permitted memories on the first model turn.
      const assembledAgent=(_context as typeof _context&{agent?:typeof agent}).agent
      if(assembledAgent&&assembledAgent.id!==agent.id)return next()
      const relation=isRelation()
      const allowed=relation?await safeContact():true
      const settled=await next()
      if(relation&&!allowed){
        settled.sections=settled.sections.filter(section=>section.name!=='app:memory')
        settled.tools=settled.tools.filter(tool=>!['memory_write','memory_list',
          'memory_search','memory_forget'].includes(tool.name))
      }
      return settled
    })
  }
  ctx.on('agent/created',({agent})=>installAgentMemoryGuard(agent))
  // Official Agent Registry may already contain revived native Sessions when
  // this plugin mounts. Protect them as well, without creating new Agents.
  ctx.inject(['agents','memory'],scope=>{
    for(const agent of scope.agents.list())installAgentMemoryGuard(agent)
  })
  // Official Commands Remote resolves the real Agent from the native SessionId.
  ctx.effect(()=>{
    const names=['yenra-memory-list','yenra-memory-search','yenra-memory-save',
      'yenra-memory-forget','yenra-memory-correct','yenra-memory-bind',
      'yenra-memory-adopt','yenra-memory-confirm-page-sent','yenra-brain-resume'] as const
    const register=ctx.commands.register.bind(ctx.commands)
    const disposers=names.map((name)=>{
      return register({
        name,
        description:'YENRA native memory UI adapter; delegates to official session-scoped MemoryService',
        ...(name.endsWith('list')
          ? {}
          : { input: { hint: name.endsWith('search') ? 'keyword' : 'memory data' } }),
        // No input payload in command/run; the settled response is the authoritative
        // native command log, not a second YENRA memory store.
        recordInput:false,
        handler:async({agent,rawInput})=>{
          try {
            const cwd=agent.session.header.cwd
            if(scopeError(ctx,cwd))return {kind:'error',text:'未验证主人工作区；拒绝读取或更改记忆'}
            // A selected, authenticated social Brain may have been archived
            // from the native Workspace panel. That official archive gate
            // rejects every later Claude turn as "blocked" (zero provider
            // requests). Resume exactly the SAME native Session through the
            // existing Host Workspace service. No memory permission is given.
            if(name==='yenra-brain-resume'){
              if(rawInput.length>300)return {kind:'error',text:'闺蜜会话恢复参数过长'}
              const request:unknown=JSON.parse(rawInput)
              if(!request||typeof request!=='object'||Array.isArray(request))
                return {kind:'error',text:'原生会话恢复参数格式错误'}
              const input=request as Record<string,unknown>
              if(Object.keys(input).sort().join('|')!=='accountRef|channel|kind|roomRef'||
                input.kind!=='contact'||!['WhatsApp','Personal','Page'].includes(String(input.channel))||
                typeof input.accountRef!=='string'||typeof input.roomRef!=='string'||
                !/^[a-f0-9]{32}$/u.test(input.accountRef)||
                !/^[a-f0-9]{32}$/u.test(input.roomRef))
                return {kind:'error',text:'只能恢复已有可信渠道和联系人的原生会话'}
              const titles=agent.session.snapshotEvents().filter(event=>event.type==='session/title')
              const title=titles.at(-1)?.data
              const expected='YENRA:B:'+input.accountRef+':'+input.roomRef
              if(!title||!('title' in title)||title.title!==expected)
                return {kind:'error',text:'原生 Session 的完整账号／联系人身份不匹配'}
              const authorized=input.channel==='WhatsApp'
                ?Boolean(originalIm&&(await readExistingWhatsAppRosterForOss(originalIm)).accounts.some(account=>
                  account.channel==='WhatsApp'&&account.accountRef===input.accountRef&&
                  account.rooms.some(room=>room.roomRef===input.roomRef)))
                :await resolveExistingFacebookContactPreferenceRoom({
                  accountRef:input.accountRef,roomRef:input.roomRef})
              if(!authorized||(typeof authorized==='object'&&authorized.channel!==input.channel))
                return {kind:'error',text:'原 Host 尚未验证当前账号和联系人，不恢复归档'}
              const service=ctx.get('workspaceRegistry') as {
                unarchiveSession?:(session:string)=>Promise<void>
              }|undefined
              if(typeof service?.unarchiveSession!=='function')
                return {kind:'error',text:'原生 DSH Workspace 归档恢复能力不可用'}
              await service.unarchiveSession(agent.session.header.id)
              return writeResult({resumed:true,sessionId:agent.session.header.id,
                channel:input.channel,accountRef:input.accountRef,roomRef:input.roomRef})
            }
            const memory=agent.ctx.get('memory') as MemoryService | undefined
            if(!memory || typeof memory.list!=='function')return {kind:'error',text:'当前 Agent 未连接原生记忆服务；官方 memory_list 工具='+(ctx.tools.get('memory_list',agent)?'存在':'未注册')+'；Host Service='+(ctx.get('memory')?'存在':'不可见')}
            if(name==='yenra-memory-bind'){
              const guarded=memory as MemoryService & {bindVerifiedScope?:(a:Parameters<MemoryService['list']>[0],s:VerifiedMemoryScope)=>string}
              if(typeof guarded.bindVerifiedScope!=='function')return {kind:'error',text:'原生记忆尚未安装可信 Session 作用域版本，联系人学习继续禁用'}
              if(rawInput.length>300)return {kind:'error',text:'记忆绑定参数过长'}
              const value:unknown=JSON.parse(rawInput)
              if(!value||typeof value!=='object'||Array.isArray(value))return {kind:'error',text:'记忆绑定参数不合法'}
              const req=value as Record<string,unknown>
              if(req.kind==='owner'&&Object.keys(req).length===1){
                if(unboundContactBrain(agent))return {kind:'error',text:'联系人 Session 不能取得主人全局记忆'}
                const workspace=guarded.bindVerifiedScope(agent,{kind:'owner'})
                return writeResult({bound:true,scope:'owner',workspace})
              }
              const fields=Object.keys(req).sort().join('|')
              const isCloud=fields==='accountRef|channel|kind|pageIdentityHash|roomRef'
              const isRemoteWa=fields==='accountRef|channel|cloudIdentityHash|expectedInboxId|kind|roomRef'
              if(!isCloud&&!isRemoteWa&&fields!=='accountRef|channel|kind|roomRef')
                return {kind:'error',text:'联系人绑定参数字段不匹配'}
              if(isCloud&&(req.channel!=='Page'||
                 typeof req.pageIdentityHash!=='string'||
                 !/^[a-f0-9]{64}$/u.test(req.pageIdentityHash)))
                return {kind:'error',text:'Cloud Page 联系人标识未核验'}
              if(isRemoteWa&&(!['WhatsApp','Personal'].includes(String(req.channel))||
                 (req.channel==='Personal'&&req.expectedInboxId!==155900)||
                 (req.channel==='WhatsApp'&&req.expectedInboxId===155900)||
                 typeof req.cloudIdentityHash!=='string'||
                 !/^[a-f0-9]{64}$/u.test(req.cloudIdentityHash)||
                 !Number.isSafeInteger(req.expectedInboxId)||(req.expectedInboxId as number)<=0))
                return {kind:'error',text:'Cloud WhatsApp 远程联系人身份未核验'}
              if(req.kind!=='contact'||!['WhatsApp','Personal','Page'].includes(String(req.channel))||
                typeof req.accountRef!=='string'||typeof req.roomRef!=='string'||
                !/^[a-f0-9]{32}$/.test(req.accountRef)||!/^[a-f0-9]{32}$/.test(req.roomRef))
                return {kind:'error',text:'联系人绑定必须包含精确渠道及原 Host 双重引用'}
              const verified:Extract<VerifiedMemoryScope,{kind:'contact'}>={kind:'contact',
                channel:req.channel as 'WhatsApp'|'Personal'|'Page',accountRef:req.accountRef,roomRef:req.roomRef,
                ...(isCloud?{pageIdentityHash:req.pageIdentityHash as string}:{}),
                ...(isRemoteWa?{cloudIdentityHash:req.cloudIdentityHash as string,
                  expectedInboxId:req.expectedInboxId as number}:{})}
              // Reuse the original DPAPI/W25-verified Page/Personal resolver.
              // No extra Page SDK room-list request, even while it returns 503.
              const authenticated=await hostVerifiesContact(verified)
              if(!authenticated){
                let reason='原账号或联系人当前身份未验证'
                if(verified.channel==='WhatsApp'){
                  if(!originalIm){
                    const hostProbe=ctx as unknown as {get:(service:string)=>unknown}
                    const services=['connection','credentials','typertGateway','webServer','dshIm']
                    const state=services.map(s=>s+':'+(Boolean(hostProbe.get(s))?'yes':'no')).join(',')
                    reason='原 DSH-IM 账号服务不可用（Host 服务状态 '+state+'）'
                  }
                  else if(typeof originalIm.whatsappCurrentlyAuthorized!=='function')
                    reason='原 DSH-IM 未提供实时账号授权状态'
                  else{
                    try{
                      const bots=await currentBots(originalIm)
                      const bot=bots.find(b=>waAccountRef(b.botId)===verified.accountRef)
                      if(!bot)reason='原 DSH-IM 未识别当前 WhatsApp 账号'
                      else if(await originalIm.whatsappCurrentlyAuthorized(bot.botId)!==true)
                        reason='原 WhatsApp Socket 尚未连接；不允许使用已失效授权'
                      else if(!(await readInbox(bot.botId)).chats.some(c=>
                        waRoomRef(bot.botId,c.jid)===verified.roomRef))
                        reason='原 WhatsApp 账号的当前联系人房间身份不一致'
                    }catch{reason='原生 WhatsApp 授权验证暂时失败'}
                  }
                }
                return {kind:'error',text:'原 Host 联系人记忆授权未通过：'+reason}
              }
              // A forged room must NOT be allowed to revoke other legitimate Sessions.
              const workspace=guarded.bindVerifiedScope(agent,verified)
              return writeResult({bound:true,scope:'contact',workspace,channel:verified.channel,
                accountRef:verified.accountRef,roomRef:verified.roomRef})
            }
            const isContact=unboundContactBrain(agent)
            const scoped=memory as MemoryService & {verifiedScope?:(a:Parameters<MemoryService['list']>[0])=>
              VerifiedMemoryScope&{workspace:string};
              revokeVerifiedAccount?:(channel:'WhatsApp'|'Personal'|'Page',accountRef:string)=>void}
            if(isContact&&typeof scoped.verifiedScope!=='function')
              return {kind:'error',text:'正式记忆插件尚无联系人分域能力，拒绝读取主人记忆'}
            const granted=typeof scoped.verifiedScope==='function'
              ?scoped.verifiedScope(agent):{kind:'owner' as const,workspace:cwd!}
            if(granted.kind!==(isContact?'contact':'owner'))
              return {kind:'error',text:'原生 Session 身份与记忆授权作用域不一致'}
            if(granted.kind==='contact'){
              let stillAuthorized=false
              try {stillAuthorized=await hostVerifiesContact(granted)}catch{/* deny below */}
              if(!stillAuthorized){
                scoped.revokeVerifiedAccount?.(granted.channel,granted.accountRef)
                return {kind:'error',text:'原 Host 当前账号或联系人已失去可信授权，禁止记忆访问'}
              }
              // The original verified Session must still be the exact same identity.
              scoped.verifiedScope?.(agent)
            }
            const scope=granted.kind,workspace=granted.workspace
            // Original Cloud Page platform-proof learning: only an existing
            // adopted memory from THIS trusted contact can be promoted after
            // readback of the original Cloud message and provider MID/status.
            // The client supplies IDs only; it cannot supply trusted message
            // text, status, sender or destination. No new Sender or database.
            if(name==='yenra-memory-confirm-page-sent'){
              if(granted.kind!=='contact'||granted.channel!=='Page'||
                 !granted.pageIdentityHash)return {kind:'error',text:'仅可信 Cloud Page 联系人可核验采用发送'}
              if(rawInput.length>160)return {kind:'error',text:'平台消息证据参数过长'}
              const ids:unknown=JSON.parse(rawInput)
              if(!ids||typeof ids!=='object'||Array.isArray(ids))return {kind:'error',text:'平台消息证据格式错误'}
              const proofIds=ids as Record<string,unknown>
              if(Object.keys(proofIds).sort().join('|')!=='conversationId|messageId'||
                 typeof proofIds.conversationId!=='number'||!Number.isSafeInteger(proofIds.conversationId)||proofIds.conversationId<=0||
                 typeof proofIds.messageId!=='number'||!Number.isSafeInteger(proofIds.messageId)||proofIds.messageId<=0)
                return {kind:'error',text:'平台消息证据 ID 未核验'}
              const receiptTag='page-sent:'+String(proofIds.messageId)
              const existingReceipt=memory.list(agent).find(m=>m.tags.includes(receiptTag)&&
                m.tags.includes('user-adopted-sent'))
              const origin=process.env.YENRA_CHATWOOT_BRIDGE_ORIGIN||'http://127.0.0.1:31917'
              if(!/^http:\/\/127\.0\.0\.1:\d{2,5}$/u.test(origin))
                return {kind:'error',text:'原生 Cloud Host 地址未验证'}
              const response=await fetch(new URL('/yenra-cloud/page-adopt-sent-proof',origin),{
                method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(16000),
                headers:{'content-type':'application/json',
                  'x-yenra-original-dsh-cloud-memory':'1','x-yenra-page-sent-proof':'1'},
                body:JSON.stringify({accountRef:granted.accountRef,roomRef:granted.roomRef,
                  pageIdentityHash:granted.pageIdentityHash,
                  conversationId:proofIds.conversationId,messageId:proofIds.messageId,
                  ...(existingReceipt?{upgrade:true}:{})})
              })
              if(!response.ok)return {kind:'error',text:'尚未取得该条 Page 消息的原渠道接受或送达证据'}
              const evidence=await response.json() as Record<string,unknown>
              // The original Cloud Bridge has already verified the exact
              // Page inbox against the authenticated account registry and
              // this Session's Page PSID + scoped MemoryService identity.
              // Do not reject a valid second Page merely because its inbox ID
              // differs from the first Page (155865).
              if(evidence.ok!==true||evidence.cloudAccountId!==196799||
                 typeof evidence.cloudInboxId!=='number'||
                 !Number.isSafeInteger(evidence.cloudInboxId)||evidence.cloudInboxId<=0||
                 evidence.conversationId!==proofIds.conversationId||
                 evidence.messageId!==proofIds.messageId||
                 !(['delivered','read'].includes(String(evidence.status))&&
                    evidence.confirmationLevel==='delivery-confirmed'||
                    evidence.status==='sent'&&evidence.confirmationLevel==='provider-accepted')||
                 typeof evidence.providerMidHash!=='string'||
                 !/^[a-f0-9]{64}$/u.test(evidence.providerMidHash)||
                 typeof evidence.text!=='string'||!evidence.text.trim()||
                 evidence.text.length>1800||!Number.isFinite(evidence.occurredAtMs))
                return {kind:'error',text:'原平台证据返回内容不完整'}
              const sent=evidence.text.trim()
              const delivered=evidence.confirmationLevel==='delivery-confirmed'
              const read=evidence.status==='read'
              const proofLevel=read?'read':delivered?'delivered':'provider-accepted'
              const learnedText=(level:'provider-accepted'|'delivered'|'read')=>
                '主人此前在本联系人的 Cloud Page 聊天中采用并实际发送过这条回复（'+
                (level==='read'?'Cloud 已读状态已核验（非独立 Meta 已读证明）':
                 level==='delivered'?'Cloud 送达状态已核验':
                 '原平台 Meta MID 接受已核验，尚未证明送达或已读')+'）：'+sent
              const receiptEntries=memory.list(agent).filter(m=>m.tags.includes(receiptTag))
              if(receiptEntries.length>1)return {kind:'error',text:'同一消息已存在多条学习记录，禁止自动覆盖'}
              const prior=receiptEntries[0]
              if(prior){
                if(!prior.tags.includes('user-adopted-sent')||
                   !prior.tags.some(t=>t==='verified-page-provider-accepted'||t==='verified-page-outbound')||
                   !prior.text.endsWith('）：'+sent))
                  return {kind:'error',text:'原学习记录证据不一致，拒绝升级'}
                const previouslyRead=prior.tags.includes('page-receipt-read')
                const previouslyDelivered=prior.tags.includes('verified-page-outbound')
                if(previouslyRead||(!read&&previouslyDelivered)||(!delivered&&
                    prior.tags.includes('verified-page-provider-accepted')))
                  return writeResult({scope,workspace,confirmed:true,
                    confirmationLevel:previouslyRead?'read':previouslyDelivered?'delivery-confirmed':'provider-accepted',
                    duplicate:true,saved:entryWire(prior)})
                const original=memory as MemoryService&{correct?:(a:typeof agent,id:MemoryId,
                  change:MemoryEntryInput&{expectedText:string})=>Promise<MemoryEntry>}
                if(typeof original.correct!=='function')
                  return {kind:'error',text:'原生记忆原位纠正能力不可用，禁止建立重复记录'}
                const updated=await original.correct(agent,prior.id,{
                  text:learnedText(proofLevel),expectedText:prior.text,
                  tags:['user-adopted-sent','verified-page-outbound',receiptTag,
                    read?'page-receipt-read':'page-receipt-delivered'],
                  importance:'low'
                })
                if(found(memory,agent,String(updated.id))?.text!==updated.text)
                  return {kind:'error',text:'原位回执升级持久化读回失败'}
                return writeResult({scope,workspace,confirmed:true,updated:true,
                  confirmationLevel:proofLevel,cloudMessageId:proofIds.messageId,
                  saved:entryWire(updated)})
              }
              const prefix='主人曾选择以下回复建议填入本联系人的草稿（不代表已发送）：'
              const sentAt=evidence.occurredAtMs as number
              const same=(a:string,b:string)=>{
                const x=a.trim().replace(/\s+/gu,' ').toLowerCase()
                const y=b.trim().replace(/\s+/gu,' ').toLowerCase()
                if(x===y)return true
                if(Math.min(x.length,y.length)<25||Math.max(x.length,y.length)>Math.min(x.length,y.length)*1.6)
                  return false
                const shingles=(s:string)=>new Set(Array.from({length:Math.max(0,s.length-2)},(_,i)=>s.slice(i,i+3)))
                const lhs=shingles(x),rhs=shingles(y)
                let matching=0;for(const s of lhs)if(rhs.has(s))matching++
                return matching/Math.max(lhs.size,rhs.size,1)>=0.72
              }
              // The owner can hit Cloud's original Send immediately after
              // Adopt, while this async native MemoryService.save finishes
              // tens of seconds later. The live Page sample proved a 50.846s
              // write-behind lag. Allow a bounded 120s lag ONLY for an
              // EXACT text match, same verified contact and original Session.
              // Once memory is already durable, modest manual edits remain
              // eligible through the pre-existing strict similarity check.
              const normalizedText=(s:string)=>s.trim().replace(/\s+/gu,' ').toLowerCase()
              const adopted=memory.list(agent).filter(m=>m.tags.includes('user-adopted-draft')&&
                m.tags.includes('not-sent-proof')&&m.text.startsWith(prefix)&&
                m.sourceSession===agent.session.header.id&&
                typeof m.createdAt==='number'&&
                sentAt>=m.createdAt-120000&&
                sentAt-m.createdAt<=45*60*1000&&
                (sentAt<m.createdAt
                  ?normalizedText(m.text.slice(prefix.length))===normalizedText(sent)
                  :same(m.text.slice(prefix.length),sent)))
                .sort((a,b)=>b.createdAt-a.createdAt)[0]
              if(!adopted)return {kind:'error',text:'未匹配当前联系人近期真实采用记录，不会伪称采用已发送'}
              const entry=await memory.save(agent,{text:learnedText(proofLevel).slice(0,2000),
                tags:['user-adopted-sent',delivered?'verified-page-outbound':
                  'verified-page-provider-accepted',receiptTag,
                  ...(delivered?[read?'page-receipt-read':'page-receipt-delivered']:[])],
                importance:'low'})
              if(!found(memory,agent,String(entry.id)))return {kind:'error',text:'发送学习记忆持久读回失败'}
              return writeResult({scope,workspace,confirmed:true,
                confirmationLevel:evidence.confirmationLevel,
                cloudMessageId:proofIds.messageId,saved:entryWire(entry),duplicate:false})
            }
            // Explicit user "采用": this is evidence of a selected DRAFT,
            // not evidence of a provider send or a fact about the recipient.
            // Save only inside the exact Host-verified contact workspace.
            if(name==='yenra-memory-adopt'){
              if(granted.kind!=='contact')
                return {kind:'error',text:'采用草稿记忆只能写入可信联系人作用域'}
              const choice=readInput(rawInput.trim())
              if(choice.oldId!==undefined||choice.expectedText!==undefined||
                choice.tags!==undefined||choice.importance!==undefined)
                return {kind:'error',text:'采用记忆不得伪造纠正、标签或重要性'}
              const observed='主人曾选择以下回复建议填入本联系人的草稿（不代表已发送）：'+choice.text
              if(observed.length>2000)
                return {kind:'error',text:'采用草稿记录长度超过上限'}
              const existing=memory.list(agent).find(m=>m.text===observed)
              if(existing)return writeResult({scope,workspace,saved:entryWire(existing),duplicate:true})
              // The mature MemoryService.save is intentionally append-only.
              // The original read-then-save had a race when two adopt commands
              // arrived before either durable write completed. One native
              // write per trusted workspace+exact draft is now shared in-flight.
              const result=await adoptFlight.run(workspace,observed,async()=>{
                const prior=memory.list(agent).find(m=>m.text===observed)
                if(prior)return {entry:prior,duplicate:true}
                const entry=await memory.save(agent,{text:observed,
                  tags:['user-adopted-draft','not-sent-proof'],importance:'low'})
                if(!found(memory,agent,String(entry.id)))
                  throw new Error('采用记录持久化读回失败')
                return {entry,duplicate:false}
              })
              if(!found(memory,agent,String(result.value.entry.id)))
                return {kind:'error',text:'采用记录持久化读回失败'}
              return writeResult({scope,workspace,saved:entryWire(result.value.entry),
                duplicate:result.joined||result.value.duplicate})
            }
            if(name==='yenra-memory-list')return writeResult({
              scope,workspace,canCorrect:supportsAtomicCorrection(memory),entries:memory.list(agent,{limit:50}).map(entryWire),
            })
            if(name==='yenra-memory-search'){
              const q=rawInput.trim().slice(0,180)
              if(!q)return {kind:'error',text:'请输入搜索内容'}
              return writeResult({scope,workspace,query:q,canCorrect:supportsAtomicCorrection(memory),
                entries:memory.search(agent,q).slice(0,50).map(entryWire)})
            }
            if(name==='yenra-memory-forget'){
              const id=rawInput.trim()
              if(!id||!found(memory,agent,id))return {kind:'error',text:'记录不存在或不属于本工作区'}
              const forgotten=await memory.forget(agent,id as MemoryId)
              if(!forgotten||found(memory,agent,id))return {kind:'error',text:'删除后核查失败'}
              return writeResult({scope,workspace,forgotten:true,id})
            }
            const input=readInput(rawInput.trim())
            const saveInput:MemoryEntryInput={text:input.text,...(input.tags?{tags:input.tags}:{}),
              ...(input.importance?{importance:input.importance}:{})}
            if(name==='yenra-memory-save'){
              const entry=await memory.save(agent,saveInput)
              if(!found(memory,agent,String(entry.id)))return {kind:'error',text:'写入后未读回'}
              return writeResult({scope,workspace,saved:entryWire(entry)})
            }
            // Use ONLY the architecture Owner's native MemoryService.correct.
            // Never fall back to save+forget: it is not an atomic replacement.
            if(name==='yenra-memory-correct'){
              if(!input.oldId||input.expectedText===undefined)
                return {kind:'error',text:'纠正缺少原记录 ID 或原文快照，已拒绝覆盖'}
              const same=memory as MemoryService & {correct?:(a:typeof agent,id:MemoryId,change:MemoryEntryInput&{expectedText:string})=>Promise<MemoryEntry>}
              if(typeof same.correct!=='function')
                return {kind:'error',text:'原生安全纠正接口尚未安装，旧记录保持不变'}
              const original=found(memory,agent,input.oldId)
              if(!original)return {kind:'error',text:'记录不存在或不属于当前主人工作区'}
              const result=await same.correct(agent,input.oldId as MemoryId,{...saveInput,expectedText:input.expectedText})
              if(String(result.id)!==String(original.id)||result.seq!==original.seq||
                result.createdAt!==original.createdAt||result.sourceSession!==original.sourceSession)
                throw new Error('纠正结果的 ID 或原始记录属性不一致')
              const verified=found(memory,agent,input.oldId)
              if(!verified||verified.text!==result.text)throw new Error('纠正后真实读回不一致')
              return writeResult({scope,workspace,corrected:true,oldId:input.oldId,saved:entryWire(result)})
            }
            return {kind:'error',text:'不支持的原生记忆命令'}
          }catch(e){return errorResult(e)}
        },
      })
    })
    return ()=>{for(const dispose of disposers.reverse())dispose()}
  },'YENRA Memory UI native Commands lifecycle')
}
