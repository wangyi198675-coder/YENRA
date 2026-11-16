/** YENRA Memory UI: native DSH Panel over official Session-addressed Commands.
 * All entries and mutations are sourced from the one installed guntur-d MemoryService.
 * View state is ephemeral; no memory DB, second Agent, private RPC or synthetic contacts.
 */
import React,{useCallback,useEffect,useRef,useState} from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { IconDatabaseOutlineMedium } from '../../../../upstream/official-source/packages/client/ui-primitives/src/icons/index'

type Entry={id:string;workspace:string;text:string;tags:string[];importance:'low'|'medium'|'high';seq:number;createdAt:number;sourceSession:string}
type Envelope={scope:'owner'|'contact';workspace:string;entries?:Entry[];saved?:Entry;oldId?:string;forgotten?:boolean;corrected?:boolean;canCorrect?:boolean}
type MemoryTarget={sessionId?:SessionId;channel:'WhatsApp'|'Page'|'Personal';accountRef:string;roomRef:string}
type Phase='checking'|'ready'|'no-session'|'unavailable'|'error'
const RESPONSE='YENRA_MEMORY_V1:'
const normalize=(p:string)=>p.replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase()
const safeEntry=(value:unknown):value is Entry=>{
 if(!value||typeof value!=='object')return false
 const x=value as Partial<Entry>
 return typeof x.id==='string'&&typeof x.workspace==='string'&&typeof x.text==='string'&&
 Array.isArray(x.tags)&&x.tags.every(t=>typeof t==='string')&&
 ['low','medium','high'].includes(String(x.importance))&&typeof x.createdAt==='number'&&
 typeof x.sourceSession==='string'
}
function decodeResponse(text:string|undefined):Envelope{
 if(!text?.startsWith(RESPONSE))throw new Error('DSH Commands 未返回可信记忆结果')
 const obj:unknown=JSON.parse(text.slice(RESPONSE.length))
 if(!obj||typeof obj!=='object')throw new Error('记忆工具响应无效')
 const e=obj as Partial<Envelope>
 if(!['owner','contact'].includes(String(e.scope))||typeof e.workspace!=='string')
  throw new Error('记忆作用域不匹配')
 if(e.entries!==undefined&&(!Array.isArray(e.entries)||!e.entries.every(safeEntry)))throw new Error('记忆列表响应格式不正确')
 if(e.saved!==undefined&&!safeEntry(e.saved))throw new Error('记忆保存响应格式不正确')
 if(e.canCorrect!==undefined&&typeof e.canCorrect!=='boolean')throw new Error('原生纠正能力状态格式不正确')
 return e as Envelope
}
function timeString(ms:number):string{
 return Number.isFinite(ms)?new Date(ms).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''
}
export function makeNativeMemoryPanel(host:ClientContext,ownerCwd:string|(()=>string),chatPanelKey:string,
 getTarget:()=>MemoryTarget|null=()=>null){
 return function NativeMemoryPanel({useSessions}:PropsRuntime<'main'>){
  const heading=useRef<HTMLHeadingElement|null>(null)
  const existingOwnerCwd=useSessions(s=>s.ids.map(id=>s.byId[id])
    .find(row=>row?.title==='YENRA · 闺蜜大脑'&&typeof row.cwd==='string')?.cwd)
  const project=normalize(existingOwnerCwd||(typeof ownerCwd==='function'?ownerCwd():ownerCwd))
  const target=getTarget()
  const contactMode=Boolean(target)
  // The original DSH Session catalog is the only Session authority.
  // Never display global owner memories while a contact session is loading.
  const ownerSessionId=useSessions(s=>s.ids.find(id=>normalize(s.byId[id]?.cwd??'')===project&&
    s.byId[id]?.title==='YENRA · 闺蜜大脑'))
  const contactSessionId=useSessions(s=>{
    if(!target?.sessionId)return undefined
    const entry=s.byId[target.sessionId]
    return normalize(entry?.cwd??'')===project&&
      entry?.title==='YENRA:B:'+target.accountRef+':'+target.roomRef
      ?target.sessionId:undefined
  })
  const sessionId=contactMode?contactSessionId:ownerSessionId
  const [phase,setPhase]=useState<Phase>('checking')
  const requestedScopeKey=contactMode
    ?'contact:'+(target?.channel??'')+':'+(target?.accountRef??'')+':'+(target?.roomRef??'')+':'+(sessionId??'pending')
    :'owner:'+(sessionId??'pending')
  const [loadedScopeKey,setLoadedScopeKey]=useState('')
  // A panel switch must not paint stale owner/previous-contact entries
  // before the new asynchronous Host authentication completes.
  const visibleReady=phase==='ready'&&loadedScopeKey===requestedScopeKey
  const [records,setRecords]=useState<Entry[]>([])
  const [query,setQuery]=useState('')
  const [draft,setDraft]=useState('')
  const [tags,setTags]=useState('')
  const [canCorrect,setCanCorrect]=useState(false)
  const [editing,setEditing]=useState<Pick<Entry,'id'|'text'|'seq'|'createdAt'|'sourceSession'>|null>(null)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [detail,setDetail]=useState('')
  const [confirmDelete,setConfirmDelete]=useState<string|null>(null)
  const requestVersion=useRef(0)
  const busyRef=useRef(false)
  // Never keep one contact's edit buffer when the native Session changes.
  useEffect(()=>{
    setRecords([]);setEditing(null);setDraft('');setTags('');setQuery('')
    setConfirmDelete(null);setNotice('');setCanCorrect(false);setLoadedScopeKey('')
  },[requestedScopeKey])
  const back=()=>host.layout.selectPanel(chatPanelKey)
  useEffect(()=>{heading.current?.focus()},[])
  const command=useCallback(async(session:SessionId,name:string,arg=''):Promise<Envelope>=>{
    const response=await host.remote.commands.execute(session,'/'+name+(arg?' '+arg:''),[])
    if(!response.ok)throw new Error(response.error.code+': '+response.error.message)
    if(!response.value)throw new Error('Host 尚未注册记忆 UI Commands；请在原生插件管理器检查 YENRA 插件加载')
    if(response.value.result.kind==='error')throw new Error(response.value.result.text)
    const parsed=decodeResponse(response.value.result.text)
    if(contactMode){
      if(parsed.scope!=='contact'||!/^yenra-relation-v1:[a-f0-9]{64}$/u.test(parsed.workspace))
        throw new Error('原生联系人记忆作用域不匹配，拒绝显示')
    }else if(parsed.scope!=='owner'||normalize(parsed.workspace)!==project)
      throw new Error('记忆记录来自非当前主人工作区，已拒绝显示')
    if(parsed.entries?.some(entry=>entry.workspace!==parsed.workspace)||
      (parsed.saved&&parsed.saved.workspace!==parsed.workspace))
      throw new Error('原生记忆记录的持久作用域与当前 Session 不一致')
    return parsed
  },[host,project,contactMode])
  const refresh=useCallback(async(customQuery?:string)=>{
    const version=++requestVersion.current
    if(!sessionId){setRecords([]);setCanCorrect(false);setLoadedScopeKey('');setPhase('no-session');setDetail('');return}
    setPhase('checking');setLoadedScopeKey('');setDetail('')
    try{
      // The actual native Agent belongs to this exact SessionId. Rebind only
      // against the current original authenticated Host, never from a title.
      if(contactMode){
        if(!target||target.sessionId!==sessionId)throw new Error('原生联系人会话已变化')
        const payload=JSON.stringify({kind:'contact',channel:target.channel,
          accountRef:target.accountRef,roomRef:target.roomRef})
        const proof=await host.remote.commands.execute(sessionId,'/yenra-memory-bind '+payload,[])
        if(!proof.ok||proof.value?.result.kind!=='success')
          throw new Error(proof.value?.result.text??'原 Host 尚未完成当前联系人记忆身份验证')
      }
      if(!contactMode){
        // The original .1 owner-only MemoryService does not expose bind;
        // retain its existing owner panel while .3 stays a release candidate.
        await host.remote.commands.execute(sessionId,
          '/yenra-memory-bind {"kind":"owner"}',[]).catch(()=>undefined)
      }
      const effectiveQuery=customQuery??''
      const response=await command(sessionId,effectiveQuery.trim()?'yenra-memory-search':'yenra-memory-list',effectiveQuery.trim())
      if(version!==requestVersion.current)return
      setRecords(response.entries??[]);setCanCorrect(response.canCorrect===true)
      setLoadedScopeKey(requestedScopeKey);setPhase('ready')
    }catch(error){
      if(version!==requestVersion.current)return
      setRecords([]);setCanCorrect(false);setLoadedScopeKey('');setPhase('unavailable')
      setDetail(error instanceof Error?error.message:String(error))
    }
  },[host,sessionId,command,contactMode,target?.channel,target?.accountRef,target?.roomRef,requestedScopeKey])
  useEffect(()=>{void refresh();return()=>{requestVersion.current++}},[refresh,sessionId])
  // The official DSH transport may reset while this panel is first opening.
  // The initial refresh already owns that read; only revalidate a previously
  // loaded, visible scope on reconnect, not a second simultaneous list call.
  useEffect(()=>{
    const reset=host.on('connection/reset',()=>{
      if(visibleReady&&!busyRef.current)void refresh()
    })
    return()=>{reset()}
  },[host,refresh,visibleReady])
  const begin=()=>{if(busyRef.current||!sessionId||!visibleReady)return false;busyRef.current=true;setBusy(true);return true}
  const finish=()=>{busyRef.current=false;setBusy(false)}
  const save=async()=>{
    if(!draft.trim()){setNotice('请输入要保存的记忆内容');return}
    if(editing&&!canCorrect){setNotice('原生安全纠正接口尚未加载，原记录保持不变');return}
    if(!begin())return
    try{
      const args={text:draft.trim(),tags:tags.split(/[,，\s]+/u).map(t=>t.trim()).filter(Boolean).slice(0,16),
        ...(editing?{oldId:editing.id,expectedText:editing.text}:{})}
      const result=await command(sessionId!,editing?'yenra-memory-correct':'yenra-memory-save',JSON.stringify(args))
      if(!result.saved)throw new Error('未收到持久写入回执')
      if(editing&&(result.corrected!==true||result.saved.id!==editing.id||result.saved.seq!==editing.seq||
        result.saved.createdAt!==editing.createdAt||result.saved.sourceSession!==editing.sourceSession))
        throw new Error('纠正结果未保持原记录 ID 与版本属性，已停止编辑')
      setNotice(editing?'同 ID 纠正成功，原生记录已读回':'已保存并验证持久读回')
      setDraft('');setTags('');setEditing(null);setConfirmDelete(null)
      await refresh(query)
    }catch(error){
      const message=error instanceof Error?error.message:String(error)
      setNotice(message.includes('stale')?'记录已被其他操作修改，拒绝覆盖；请刷新并重新选择纠正。你的输入仍保留。':message)
    }finally{finish()}
  }
  const remove=async(id:string)=>{
    if(confirmDelete!==id){setConfirmDelete(id);setNotice('再次点击「确认删除」才会删除这条原生记忆');return}
    if(!begin())return
    try{
      const result=await command(sessionId!,'yenra-memory-forget',id)
      if(!result.forgotten)throw new Error('未收到删除确认')
      setConfirmDelete(null);setNotice('已删除，并核验记录不再存在')
      if(editing?.id===id){setEditing(null);setDraft('');setTags('')}
      await refresh(query)
    }catch(error){setNotice(error instanceof Error?error.message:String(error))}
    finally{finish()}
  }
  const beginEdit=(entry:Entry)=>{
    if(!visibleReady||!canCorrect||busy)return
    setEditing({id:entry.id,text:entry.text,seq:entry.seq,createdAt:entry.createdAt,sourceSession:entry.sourceSession})
    setDraft(entry.text);setTags(entry.tags.join(', '));setConfirmDelete(null)
    setNotice('将原 ID 的内容安全纠正；若原记录已变更，将拒绝覆盖。')
  }
  const cancelEdit=()=>{setEditing(null);setDraft('');setTags('');setNotice('')}
  const phaseLabel=!visibleReady&&phase==='ready'?'正在核验当前记忆作用域…':
    phase==='checking'?'正在读取官方记忆服务…':
    phase==='no-session'?(contactMode?'当前联系人原生会话尚未就绪':'尚无可信主人会话'):
    phase==='unavailable'?'原生记忆接口暂不可用':
    phase==='error'?'记忆服务读取失败':
    contactMode?'联系人记忆已连接':'主人记忆已连接'
  const anyRecords=visibleReady&&records.length>0
  return <section className="yenra-memory-native" aria-label="记忆与关系"
    data-yenra-memory-service={visibleReady?'ready':phase==='ready'?'checking':phase}
    data-yenra-memory-correction={canCorrect&&visibleReady?'ready':'unavailable'}
    onKeyDown={event=>{if(event.key==='Escape'&&!(event.target instanceof HTMLInputElement)&&!(event.target instanceof HTMLTextAreaElement)){event.preventDefault();back()}}}>
    <div className="yenra-memory-native-content">
      <header className="yenra-memory-native-header">
        <div className="yenra-memory-native-heading"><span>YENRA · 闺蜜大脑</span>
          <h1 ref={heading} tabIndex={-1}>记忆与关系</h1></div>
        <button type="button" className="yenra-memory-native-back" onClick={back}>返回聊天</button>
      </header>
      <div className="yenra-memory-native-status" role="status">
        <IconDatabaseOutlineMedium size={22}/>
        <div><h2>{phaseLabel}</h2>
          {visibleReady?<p>{contactMode?'当前仅展示原 Host 验证的此联系人专属记忆，不混入其他账号或主人记录。':'当前仅展示 YENRA 主人工作区记忆，所有记录来自唯一成熟 MemoryService。'}</p>:
           <p>{phase==='no-session'?'请先在聊天工作台打开原生闺蜜大脑会话。':detail||'正在核验当前 Session 与原 Host 的记忆身份。'}</p>}
          {phase!=='ready'&&sessionId?<button type="button" className="yenra-memory-native-back" onClick={()=>void refresh()}>重试连接</button>:null}
        </div>
      </div>
      {visibleReady?<div className="yenra-memory-live">
        <div className="yenra-memory-live-head">
          <h2>{contactMode?'当前联系人长期记忆':'主人偏好与长期记忆'}</h2><button type="button" disabled={busy}
            className="yenra-memory-native-back" onClick={()=>void refresh(query)}>刷新</button>
        </div>
        <form className="yenra-memory-search" onSubmit={e=>{e.preventDefault();void refresh(query)}}>
          <input aria-label="搜索记忆" value={query} onChange={e=>setQuery(e.currentTarget.value)}
            placeholder={contactMode?'搜索当前联系人记忆或标签':'搜索主人记忆或标签'} maxLength={180}/>
          <button type="submit" disabled={busy}>搜索</button>
          {query?<button type="button" disabled={busy} onClick={()=>{setQuery('');void refresh('')}}>清除</button>:null}
        </form>
        {anyRecords?<div className="yenra-memory-list" role="list">
          {records.map(item=><article className="yenra-memory-record" role="listitem" key={item.id} data-yenra-memory-id={item.id}>
            <div className="yenra-memory-record-info"><p>{item.text}</p>
              <small>{item.tags.length?item.tags.join(' · ')+' · ':''}{timeString(item.createdAt)}</small></div>
            <div className="yenra-memory-record-actions">
              <button type="button" disabled={busy||!canCorrect}
                aria-label={canCorrect?'纠正此条记忆':'纠正暂不可用：原生安全更新接口尚未安装'}
                title={canCorrect?'保持同一记录 ID 并验证过期编辑':'原生安全纠正接口尚未安装，旧记录受到保护'}
                onClick={()=>beginEdit(item)}>纠正</button>
              <button type="button" disabled={busy} onClick={()=>void remove(item.id)}>
                {confirmDelete===item.id?'确认删除':'删除'}</button>
            </div>
          </article>)}
        </div>:<p className="yenra-memory-empty">当前查询没有记忆记录。这里不会生成示例联系人或虚拟数据。</p>}
        <div className="yenra-memory-editor">
          <h2>{editing?'纠正现有记忆':contactMode?'保存当前联系人记忆':'保存一条主人记忆'}</h2>
          <textarea aria-label="记忆内容" value={draft} maxLength={2000} rows={3}
            placeholder="例如：德语日常问候简洁自然，不使用感叹号" onChange={e=>setDraft(e.currentTarget.value)}/>
          <input aria-label="记忆标签" value={tags} maxLength={240}
            placeholder="标签（可选，用逗号分隔）" onChange={e=>setTags(e.currentTarget.value)}/>
          <div className="yenra-memory-editor-actions"><button type="button" disabled={busy||!draft.trim()}
            onClick={()=>void save()}>{busy?'执行中…':editing?'保存纠正':'保存记忆'}</button>
            {editing?<button type="button" onClick={cancelEdit} disabled={busy}>取消纠正</button>:null}
</div>
        </div>
        {notice?<p className="yenra-memory-notice" role="status">{notice}</p>:null}
      </div>:null}
      <section className="yenra-memory-contacts-boundary" aria-label="联系人关系记忆状态">
        <h2>联系人关系</h2>
        <p>{contactMode?(visibleReady?'仅可读取并修改当前原 Host 认证的联系人记忆，所有操作使用同一成熟 MemoryService。':'当前联系人尚未取得可信记忆身份绑定，拒绝读取或修改记忆。'):'主人记忆与联系人关系记忆分域保存。进入真实联系人聊天后可查看其专属关系记忆；未验证的联系人默认拒绝访问。'}</p>
      </section>
    </div>
  </section>
 }
}
