/**
 * Thin read-only view of the EXISTING native DSH Plugin Manager and
 * the EXISTING original Host's last-verified display roster. These are
 * different facts: a Facebook channel need not be a DSH npm bundle,
 * and a cached roster never proves that a channel is online now.
 * No new connection centre, login, credentials, SDK, Sender or refresh job.
 */
import React,{useCallback,useEffect,useRef,useState} from 'react'
import type {Context as ClientContext} from '@deepseek-ai/cordis'
import type {PluginTabProps} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {facebookBrandIcon,whatsAppBrandIcon} from './social-brand-icons'
import {readOriginalWhatsappHealth,displayOriginalAccountState,readOriginalOwnAccountProfile} from './native-whatsapp-connection-status'
import type {NativeWhatsAppHealth,VerifiedOwnAccountProfile} from './native-whatsapp-connection-status'

type Channel='Personal'|'Page'|'WhatsApp'
type Installed={name:string;installed:boolean;enabled:boolean;version?:string}
type Inventory={phase:'checking'|'ready'|'error'|'unavailable';bundles:Installed[]}
type NativeAccount={channel:Channel;accountRef:string;rooms:number;accountLabel?:string}
type HostRoster={phase:'checking'|'ready'|'error';accounts:NativeAccount[];
  lastVerifiedAt:string|null;failures:string[]}
const REF=/^[a-f0-9]{32}$/
const EMPTY:HostRoster={phase:'checking',accounts:[],lastVerifiedAt:null,failures:[]}

async function bounded<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined
 try{return await Promise.race([promise,new Promise<T>((_,reject)=>{
   timer=setTimeout(()=>reject(new Error('ORIGINAL_DSH_HOST_TIMEOUT')),7000)
 })])}
 finally{if(timer!==undefined)clearTimeout(timer)}
}

const targets=[
 {key:'personal',channel:'Personal',name:'Facebook Personal',bundle:null,
  description:'Messenger · 个人账号'},
 {key:'page',channel:'Page',name:'Facebook Page',bundle:null,
  description:'Facebook · 主页账号'},
 {key:'whatsapp',channel:'WhatsApp',name:'WhatsApp',bundle:'@xmanrui/dsh-im',
  description:'WhatsApp · 多账号'},
] as const

/** Only the existing DSH Storage Domain cached display roster is read.
 * No refresh=1: that would unnecessarily call the Page provider again.
 */
export async function readExistingSocialRoster(fetchImpl:typeof fetch=fetch):Promise<HostRoster>{
 const response=await bounded(fetchImpl('/api/yenra/oss-roster',{method:'GET',cache:'no-store'}))
 if(!response.ok)throw Error('EXISTING_HOST_ROSTER_UNAVAILABLE')
 const raw:unknown=await response.json()
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_EXISTING_HOST_ROSTER')
 const body=raw as Record<string,unknown>
 if(body.ok!==true||!body.roster||typeof body.roster!=='object'||Array.isArray(body.roster))
   throw Error('ORIGINAL_HOST_NO_VERIFIED_ROSTER')
 const roster=body.roster as Record<string,unknown>
 if(roster.source!=='YENRA_AGGREGATED_NATIVE'||!Array.isArray(roster.accounts))
   throw Error('UNVERIFIED_ORIGINAL_HOST_ROSTER')
 const accounts:NativeAccount[]=[]
 for(const item of roster.accounts){
   if(!item||typeof item!=='object'||Array.isArray(item))continue
   const row=item as Record<string,unknown>
   if(!['Personal','Page','WhatsApp'].includes(String(row.channel))||
      typeof row.accountRef!=='string'||!REF.test(row.accountRef)||
      !Array.isArray(row.rooms)||row.rooms.length>600)continue
   // Do not expose names, identifiers or messages to plugin cards.
       accounts.push({channel:row.channel as Channel,
      accountRef:row.accountRef,rooms:row.rooms.length,
      ...(typeof row.accountLabel==='string'&&row.accountLabel.length<=110
        ?{accountLabel:row.accountLabel}:{}),})
 }
 const failures=Array.isArray(roster.failures)
   ?roster.failures.filter((x):x is string=>typeof x==='string').slice(0,20):[]
 return {phase:'ready',accounts,
   lastVerifiedAt:typeof roster.lastVerifiedAt==='string'?roster.lastVerifiedAt:null,
   failures}
}

/** Same two original Host accountRefs in a stable display order.
 * No new per-account store and no fabricated telephone/username.
 */
export function whatsappAccountRows(roster:HostRoster){
 const unique=new Map<string,NativeAccount>()
 for(const row of roster.accounts)
   if(row.channel==='WhatsApp')unique.set(row.accountRef,row)
 return [...unique.values()].sort((a,b)=>a.accountRef.localeCompare(b.accountRef))
}

/** Presentation-only, must never turn historical roster into online status. */
export function channelStatus(
 channel:Channel,roster:HostRoster,plugin:Installed|undefined,
):{title:string;detail:string;rosterCount:number;sourceFailure:boolean}{
 const records=roster.accounts.filter(a=>a.channel===channel)
 const count=records.reduce((sum,a)=>sum+a.rooms,0)
 const sourceFailure=roster.failures.some(f=>channel==='WhatsApp'
   ?f.startsWith('WHATSAPP_')
   :channel==='Personal'
     ?f.startsWith('Personal_')||f==='FACEBOOK_TEMPORARILY_UNAVAILABLE'
     :f.startsWith('Page_')||f==='FACEBOOK_TEMPORARILY_UNAVAILABLE')
 if(roster.phase==='checking')
   return {title:'正在核对原生账号',detail:'读取原 DSH Host 已验证的名册',rosterCount:0,sourceFailure:false}
 if(records.length>0){
   const total=channel==='WhatsApp'?records.length+' 个账号 · '+count+' 位联系人'
     :count+' 位联系人'
   return {
     title:channel==='WhatsApp'&&plugin?.installed&&plugin.enabled
       ?'插件已启用 · 已读取账号名册':'已接入 · 已读取联系人名册',
     detail:total+'（最近验证）'+(sourceFailure
       ?' · 上次原生来源刷新失败':' · 实时在线状态尚未核验'),
     rosterCount:count,sourceFailure,
   }
 }
 if(roster.phase==='error')
   return {title:'原生状态暂不可读',detail:'未读取到可靠的当前名册，不能判断账号是否断开',
     rosterCount:0,sourceFailure:false}
 if(channel==='WhatsApp'&&plugin?.installed)
   return {title:plugin.enabled?'插件已启用':'插件已停用',
     detail:'尚未从原 Host 读取到私人 WhatsApp 联系人；需在原生插件配置中查看登录',
     rosterCount:0,sourceFailure}
 return {title:'未读取到已验证账号',
   detail:'原渠道当前无可显示的已验证名册；不是 npm 插件未安装的结论',
   rosterCount:0,sourceFailure}
}

export function nativeConnectionsTab(host:ClientContext){
 return function NativeConnectionsTab({openPackage}:PluginTabProps){
  const [inventory,setInventory]=useState<Inventory>({phase:'checking',bundles:[]})
  const [native,setNative]=useState<HostRoster>(EMPTY)
  const [whatsappHealth,setWhatsappHealth]=useState<NativeWhatsAppHealth>({phase:'checking',accounts:[],problem:null})
     const [ownProfiles,setOwnProfiles]=useState<Record<string,VerifiedOwnAccountProfile>>({})
    const [sendPulseStatus,setSendPulseStatus]=useState<{apiConfigured?:boolean;authorizedBotPage?:boolean;verificationPending?:boolean;lastVerifiedAt?:number|null}|null>(null)
    const [pageWebhookHealth,setPageWebhookHealth]=useState<{webhookHandlerReady?:boolean;incomingHintsAccepted?:number;providerVerifiedEvents?:number;lastReceivedAt?:number|null;activeSseConnections?:number;pageSseFramesWritten?:number}|null>(null)
  const refreshEpoch=useRef(0)
  const refresh=useCallback(()=>{
   const epoch=++refreshEpoch.current
   setInventory(v=>({...v,phase:'checking'}))
   setNative(v=>({...v,phase:'checking'}))
   setWhatsappHealth(v=>({...v,phase:'checking'}))
   setPageWebhookHealth(null)
    // Local cached Host status is immediate. Original protected DPAPI + REST
    // run asynchronously in the one Host, never block the inbox/UI refresh.
    const readSendPulseStatus=()=>fetch('/api/yenra/sendpulse-status',{cache:'no-store'})
      .then(async response=>response.ok?await response.json():null);
    void readSendPulseStatus().then(data=>{
      if(epoch!==refreshEpoch.current)return;
      setSendPulseStatus(data?{
        apiConfigured:data.apiConfigured===true,
        authorizedBotPage:data.authorizedBotPage===true,
        verificationPending:data.verificationPending===true,
        lastVerifiedAt:typeof data.lastVerifiedAt==='number'?data.lastVerifiedAt:null
      }:null);
      // One bounded follow-up for a still-in-flight original API verification.
      // This is NOT a provider poll, Webhook or second inbox connection.
      if(data?.verificationPending===true)window.setTimeout(()=>{
        void readSendPulseStatus().then(verified=>{
          if(epoch===refreshEpoch.current&&verified)
            setSendPulseStatus({
              apiConfigured:verified.apiConfigured===true,
              authorizedBotPage:verified.authorizedBotPage===true,
              verificationPending:verified.verificationPending===true,
              lastVerifiedAt:typeof verified.lastVerifiedAt==='number'?verified.lastVerifiedAt:null
            });
        }).catch(()=>{});
      },2200);
    }).catch(()=>{if(epoch===refreshEpoch.current)setSendPulseStatus(null)});
    // Read the ORIGINAL Host's live event counters. The SendPulse OAuth
    // status alone never proves that a webhook is subscribed or delivering.
    void fetch('/api/yenra/sendpulse-hook-health',{cache:'no-store'})
      .then(async response=>response.ok?await response.json():null)
      .then(data=>{if(epoch===refreshEpoch.current)setPageWebhookHealth(data)})
      .catch(()=>{if(epoch===refreshEpoch.current)setPageWebhookHealth(null)});
   // Independent reads: Facebook/WhatsApp Host visibility never depends
   // on the official npm package inventory being available.
   void (async()=>{
     try{
       const scope=await bounded(host.remote.pluginInventory.list())
       if(!scope.ok){setInventory(v=>({...v,phase:'error'}));return}
       if(scope.value.managementAvailable!==true){
         setInventory({phase:'unavailable',bundles:[]});return
       }
       const result=await bounded(host.remote.pluginManager.listBundles())
       if(!result.ok){setInventory(v=>({...v,phase:'error'}));return}
       setInventory({phase:'ready',bundles:result.value.map(b=>({
         name:b.name,installed:b.installed,enabled:b.enabled,
         ...(b.version?{version:b.version}:{})
       }))})
     }catch{setInventory(v=>({...v,phase:'error'}))}
   })()
   void readExistingSocialRoster().then(async roster=>{
     if(epoch!==refreshEpoch.current)return
     setNative(roster)
     const accounts=whatsappAccountRows(roster)
     if(accounts.length===0){setOwnProfiles({});return}
     // Only already-authorized owner identities, one read per existing
     // account, not a Page/WhatsApp contact crawl or a second account store.
     const results=await Promise.all(accounts.map(async account=>
       readOriginalOwnAccountProfile(account.accountRef).catch(()=>null)))
     if(epoch!==refreshEpoch.current)return
     setOwnProfiles(Object.fromEntries(results.filter((profile):profile is VerifiedOwnAccountProfile=>profile!==null)
       .map(profile=>[profile.accountRef,profile])))
   }).catch(()=>{
     if(epoch===refreshEpoch.current)setNative(v=>({...v,phase:'error'}))
   })
   // Native DSH-IM status RPC is the same read-only status source as the
   // official plugin configuration. It never sends a test message or reconnects.
   void readOriginalWhatsappHealth().then(value=>{
     if(epoch===refreshEpoch.current)setWhatsappHealth(value)
   }).catch(()=>{
     if(epoch===refreshEpoch.current)setWhatsappHealth({
       phase:'error',accounts:[],problem:'原生插件状态读取失败'})
   })
  },[host])
  useEffect(()=>{
   refresh()
   const off=host.remote.$on('plugin-manager/changed',refresh)
   const reset=host.on('connection/reset',refresh)
   return()=>{++refreshEpoch.current;off();reset()}
  },[host,refresh])
   const installed=(bundle:string|null)=>
    inventory.bundles.find(item=>bundle!==null&&item.name===bundle)
  return <section className="yenra-connection-tab"
    data-yenra-native-connections="true" aria-label="连接与服务">
    <div className="yenra-connection-head">
      <div>
        <h2>账号与连接</h2>
        <p>查看账号资料、连接状态和异常诊断。</p>
      </div>
      <button type="button" onClick={refresh}
        disabled={inventory.phase==='checking'&&native.phase==='checking'}
        aria-label="刷新现有连接状态">
        {inventory.phase==='checking'&&native.phase==='checking'?'正在检查…':'刷新状态'}
      </button>
    </div>
    {inventory.phase==='error'||inventory.phase==='unavailable'
      ?<p role="status" className="yenra-connection-note">
        DSH 插件清单暂不可用；下方原生渠道状态仍来自原 Host。
       </p>:null}
    {native.phase==='error'
      ?<p role="status" className="yenra-connection-note">
        原 Host 已验证名册暂不可读；不会把读取失败解释为账号未安装。
       </p>:null}
    <div className="yenra-connection-grid">
      {targets.map(ch=>{
        const plugin=installed(ch.bundle)
        const fact=channelStatus(ch.channel,native,plugin)
        const waRows=ch.key==='whatsapp'?whatsappAccountRows(native):[]
        return <article className="yenra-connection-card" key={ch.key}
          data-channel={ch.key} data-channel-roster={fact.rosterCount}
          data-channel-source-failure={fact.sourceFailure}>
          <div className="yenra-connection-card-top">
            <img src={ch.key==='whatsapp'?whatsAppBrandIcon:facebookBrandIcon} alt=""/>
            <div><h3>{ch.name}</h3><p>{ch.description}</p></div>
          </div>
          <p className="yenra-connection-status" role="status"
             data-installed={plugin?.installed===true}
             data-verified-roster={fact.rosterCount>0}>
            {fact.title}
          </p>
          <p className="yenra-connection-note">{
            ch.key==='whatsapp'&&!fact.sourceFailure&&waRows.length>0&&
            whatsappHealth.phase==='ready'&&waRows.every(a=>
              whatsappHealth.accounts.some(s=>s.accountRef===a.accountRef&&s.state!=='unknown'))
              ?waRows.length+' 个账号 · '+fact.rosterCount+' 位联系人（最近验证）· 原生 Socket 状态已核验'
              :fact.detail
          }</p>
          {ch.key!=='whatsapp'&&native.accounts.filter(a=>a.channel===ch.channel).map((account,index)=>
            <div key={account.accountRef} className="yenra-fb-account"
                 data-testid="yenra-facebook-account">
              <div className="yenra-fb-account-avatar" title="平台图标，不是本人账号头像">
                <img src={facebookBrandIcon} alt=""/>
              </div>
              <div className="yenra-fb-account-details">
                                 <strong>{account.accountLabel??ch.name+' · 账号 '+(index+1)}</strong>
                <small title="原生 Host 尚未返回 Page 本人账号资料">账号资料未由原平台返回</small>
                <span>{account.rooms} 位联系人 · 最近已验证名册</span>

              </div>
            </div>
          )}
                     {ch.key==='page'&&<p className="yenra-connection-note"
               data-testid="yenra-sendpulse-account-status" role="status">
               SendPulse 官方 Page API：{sendPulseStatus?.authorizedBotPage
                 ?'已验证（只读）'
                 :sendPulseStatus?.verificationPending?'正在验证'
                 :sendPulseStatus?.apiConfigured?'已保存授权，尚未验证':'授权状态待核实'}。
               Webhook 接收端：{pageWebhookHealth?.webhookHandlerReady
                 ? (Number(pageWebhookHealth.providerVerifiedEvents||0)>0
                     ?'本次运行已验证 '+pageWebhookHealth.providerVerifiedEvents+' 条消息'
                     :'已就绪，本次运行尚无已验证来信')
                 :'状态未核实'}。
               {pageWebhookHealth?.webhookHandlerReady&&
                 ' SSE '+Number(pageWebhookHealth.activeSseConnections||0)+' 条连接 · '+
                 Number(pageWebhookHealth.pageSseFramesWritten||0)+' 条 Page 推送。'}
               <small>订阅配置请以 SendPulse 后台为准；接收端就绪不代表已收到新消息。人工发送继续由现有授权通道完成。</small>
             </p>}
           {ch.key!=='whatsapp'&&fact.sourceFailure&&
            <details className="yenra-connection-problem">
              <summary>查看上次原生连接失败原因</summary>
              <p>上次渠道刷新未完成，旧联系人名册仍保留。详情：</p>
              {native.failures.filter(f=>f.startsWith(ch.channel+'_')
                ||f==='FACEBOOK_TEMPORARILY_UNAVAILABLE').map(f=>
                <code key={f}>{f}</code>)}
              <p>需通过原连接器恢复验证；这里不会重新安装旧插件。</p>
            </details>}
          {ch.key==='whatsapp'&&waRows.length>0&&
            <div className="yenra-wa-account-list" role="list"
              aria-label="已有 WhatsApp 账号">
              {waRows.map((account,index)=>{
                const original=whatsappHealth.accounts.find(
                  row=>row.accountRef===account.accountRef)
                const ownProfile=ownProfiles[account.accountRef]
                const current=displayOriginalAccountState(original,whatsappHealth.phase)
                return <div key={account.accountRef} role="listitem"
                  data-testid="yenra-whatsapp-account"
                  data-account-order={index+1}
                  data-account-connection={original?.state??'unknown'}
                  className="yenra-wa-account">
                  <div className="yenra-wa-account-avatar" title="本人头像仅从当前原账号读取，失败则保留平台图标">
                    <img src={whatsAppBrandIcon} alt=""/>
                    {ownProfile&&<img className="yenra-wa-own-avatar"
                      src={'/api/yenra/social-read?mode=account-avatar&accountRef='+encodeURIComponent(account.accountRef)}
                      alt="" onError={event=>{event.currentTarget.style.display='none'}}/>}
                  </div>
                  <div className="yenra-wa-account-content">
                    <div className="yenra-wa-account-heading">
                      <strong title="原 DSH-IM 保存的账号别名，不一定是 WhatsApp 资料名">{ownProfile?.displayName??original?.name??'账号 '+(index+1)}</strong>
                      <span className="yenra-wa-account-state"
                        data-connected={original?.connected===true}>
                        {current.label}
                      </span>
                    </div>
                    <span className="yenra-wa-account-id">
                      {ownProfile?.ownPhone??original?.maskedNumber??'登录号码尚未从原生状态返回'}
                    </span>
                    <span>{account.rooms} 位联系人</span>
                    {original?.lastCheckedAt&&
                      <small>原生检查：{new Date(original.lastCheckedAt).toLocaleString('zh-CN')}</small>}
                    {current.problem&&
                      <p className="yenra-wa-account-error" role="status">
                        {current.problem}{original?.errorCode?'（'+original.errorCode+'）':''}
                      </p>}
                    <button type="button" className="yenra-wa-account-settings"
                      onClick={()=>openPackage('@xmanrui/dsh-im')}>
                      打开 DSH-IM 诊断与重连
                    </button>
                  </div>
                </div>
              })}
            </div>}
          {!(ch.key==='whatsapp'&&waRows.length>0)&&<div className="yenra-connection-actions">
            {ch.bundle&&plugin?.installed
              ?<button type="button" onClick={()=>openPackage(ch.bundle)}>
                打开 DSH 原生插件配置
              </button>
              :<p className="yenra-connection-note">
                {ch.key==='whatsapp'
                  ?'使用现有 DSH 插件管理检查账号，不安装旧版插件。'
                  :'在聊天顶部选择已有账号；无需重复安装独立连接器。'}
              </p>}
          </div>}
        </article>
      })}
    </div>
    <p className="yenra-connection-foot">
      连接状态由原生渠道验证；历史联系人数量不代表实时在线。
    </p>
  </section>
 }
}
