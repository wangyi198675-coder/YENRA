/** Thin original-DSH-IM inbox event adapter for mature messaging-inbox.
 * Observes the ONE existing WhatsApp Socket's atomic inbox.json output.
 * Native fs.watch is notification-only; there is no second WhatsApp Socket,
 * channel API, polling timer, translation/model call, Sender or chat database.
 */
import {watch, type FSWatcher} from 'node:fs'
import {join} from 'node:path'
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {accountRef,roomRef,currentBots,readInbox} from './social-readonly-commands.ts'
import {originalPersonalMatrixObserver} from '../../../social-adapters/personal-matrix/original-personal-delta.mjs'

type OriginalMessage={
  id:string;text:string;direction:'INBOUND'|'OUTBOUND';timestamp:number;
  nativeMediaType?:string
}
type OriginalChat={jid:string;name:string;messages:OriginalMessage[]}
type OriginalInbox={chats:OriginalChat[]}
type EventRow={
  accountRef:string;roomRef:string;mid:string;text:string;
  direction:'INBOUND'|'OUTBOUND';timestamp:number;
  name:string;nativeMediaType?:string
}
/** Numeric diagnostics only: the original SSE stream, not a second feed. */
export const originalSocialSseHealth={
 activeConnections:0,connectionsOpened:0,pageFramesWritten:0,
 lastPageFrameAt:0,lastDisconnectAt:0
}
/** Process-local fan-out over the ALREADY-OPEN same-origin SSE feed.
 * Verified Agent actions publish a local UI intent here (contact mark changed,
 * draft adopted, panel switched); each connected YENRA window applies it with
 * its own existing code path. No second EventSource, socket, store or cache. */
export type SocialBroadcast={
 publish(event:string,data:unknown):boolean
 subscriberCount():number
}
const broadcastSubscribers=new Set<(frame:string)=>void>()
export const originalSocialSseBroadcast:SocialBroadcast={
 publish(event,data){
  if(broadcastSubscribers.size===0)return false
  const frame='event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'
  for(const write of broadcastSubscribers){
   try{write(frame)}catch{/* one dead window must not starve the others */}
  }
  return true
 },
 subscriberCount(){return broadcastSubscribers.size},
}
const MAX_IDS=120
/** At connection start record existing IDs; never replay whole past history as new. */
export function diffOriginalInbox(
  seen:Map<string,Set<string>>,snapshot:OriginalInbox,
  account:string,botId:string,initial:boolean,
):EventRow[]{
  const emitted:EventRow[]=[]
  for(const chat of snapshot.chats){
    const id=roomRef(botId,chat.jid)
    let ids=seen.get(id)
    if(!ids){ids=new Set<string>();seen.set(id,ids)}
    const messages=chat.messages.slice(-50)
    for(const message of messages){
      if(ids.has(message.id))continue
      ids.add(message.id)
      if(!initial && (message.direction==='INBOUND'||message.direction==='OUTBOUND') &&
        Number.isFinite(message.timestamp) && message.timestamp>0){
        emitted.push({
          accountRef:account,roomRef:id,mid:message.id,
          text:message.text.slice(0,4000),direction:message.direction,
          timestamp:message.timestamp,name:chat.name.slice(0,100),
          ...(['image','video','audio','file'].includes(message.nativeMediaType??'')
            ?{nativeMediaType:message.nativeMediaType}:{}),
        })
      }
    }
    // Only a bounded per-client duplicate filter, not shadow chat history.
    while(ids.size>MAX_IDS)ids.delete(ids.values().next().value as string)
  }
  return emitted.slice(-50)
}
type Bot={botId:string;channel:string}
type OriginalService={listBots():Promise<Bot[]>}
const local=(req:any)=>{
  const ip=String(req.socket?.remoteAddress??'')
  if(ip&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip))return false
  const site=String(req.headers['sec-fetch-site']??'')
  if(site&&!['same-origin','none'].includes(site))return false
  const origin=String(req.headers.origin??'')
  if(origin&&origin!=='null'&&origin!=='dsh-app://app')return false
  return true
}
export function registerOriginalSocialInboxEvents(ctx:Context):void{
  ctx.inject(['webServer','dshIm'],scope=>scope.effect(()=>scope.webServer.register({
    kind:'exact',path:'/api/yenra/social-events',
    handler:async(request,response)=>{
      const abort=(code:number,reason:string)=>{
        response.writeHead(code,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'})
        response.end(JSON.stringify({ok:false,error:reason}))
      }
      if(request.method!=='GET'){abort(405,'GET_ONLY');return}
      if(String(request.url??'')!=='/api/yenra/social-events'){
        abort(400,'NO_QUERY_ALLOWED');return
      }
      if(!local(request)){abort(403,'ORIGINAL_DSH_SAME_ORIGIN_REQUIRED');return}
      const service=(scope as unknown as {dshIm?:OriginalService}).dshIm
      const home=process.env.DSH_HOME
      // Personal Matrix and Page webhook fanout must not go down merely
      // because one WhatsApp bot's directory/snapshot is temporarily offline.
      // Reuse only the original authenticated DSH-IM list when available.
      let bots:Bot[]=[]
      if(service?.listBots&&home){
        try{bots=await currentBots(service)}catch{bots=[]}
      }
      const observations:Array<{bot:Bot;seen:Map<string,Set<string>>;dir:string}>=[]
      for(const bot of bots){
        try{
          const seen=new Map<string,Set<string>>()
          diffOriginalInbox(seen,await readInbox(bot.botId),accountRef(bot.botId),bot.botId,true)
          observations.push({bot,seen,dir:join(home!,'integrations','dsh-whatsapp','bots',bot.botId)})
        }catch{/* Preserve other authenticated accounts' existing live feeds. */}
      }
      response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8',
        'cache-control':'no-cache, no-transform','connection':'keep-alive',
        'x-content-type-options':'nosniff','x-accel-buffering':'no'})
      response.write(': original-dsh-im-ready\n\n')
      originalSocialSseHealth.activeConnections++
      originalSocialSseHealth.connectionsOpened++
      let closed=false
      // Verified Agent actions reuse THIS already-open same-origin stream; the
      // browser applies them through its own existing handlers.
      const writeBroadcast=(frame:string)=>{
        if(closed)return
        try{response.write(frame)}catch{/* its own close handler removes it */}
      }
      broadcastSubscribers.add(writeBroadcast)
      const watchers:FSWatcher[]=[]
      const queues=new Map<string,{pending:boolean;running:boolean;timer:NodeJS.Timeout|null}>()
      let stopAck:(()=>unknown)|null=null
      let stopPresence:(()=>unknown)|null=null
      let stopPage:(()=>unknown)|null=null
      let stopPersonal:(()=>unknown)|null=null
      // A comment-only heartbeat keeps the existing SAME-ORIGIN EventSource
      // alive through idle proxies. It never fetches providers or adds a socket.
      const heartbeat=setInterval(()=>{
        if(closed)return
        try{response.write(': yenra-live\n\n')}catch{close()}
      },15000)
      heartbeat.unref?.()
      const close=()=>{
        if(closed)return
        closed=true
        broadcastSubscribers.delete(writeBroadcast)
        originalSocialSseHealth.activeConnections=Math.max(0,
          originalSocialSseHealth.activeConnections-1)
        originalSocialSseHealth.lastDisconnectAt=Date.now()
        stopAck?.()
        stopAck=null
        stopPresence?.()
        stopPresence=null
        stopPage?.()
        stopPage=null
        stopPersonal?.()
        stopPersonal=null
        clearInterval(heartbeat)
        for(const watcher of watchers)watcher.close()
        for(const job of queues.values())if(job.timer)clearTimeout(job.timer)
        queues.clear()
      }
      response.on('close',close)
      // The original single Baileys Socket and Sender already verified this
      // ACK against a previously accepted outbound MID and exact recipient.
      // Reuse Cordis events; do not add a receipt DB, watcher or Sender.
      const authorized=new Set(bots.map(bot=>bot.botId))
      // Same already-authorized Matrix principal and original 41 room hints;
      // one shared /sync cursor across SSE subscribers. Baseline changes
      // only update list previews, never manufacture an incoming alert.
      stopPersonal=originalPersonalMatrixObserver.subscribe(row=>{
        if(closed||row.accountRef===undefined)return
        const {kind,...scoped}=row
        if(kind==='verified-receipt'){
          if(scoped.channel!=='Personal'||
             scoped.source!=='OFFICIAL_MAUTRIX_META_MATRIX_SYNC_RECEIPT'||
             typeof scoped.accountRef!=='string'||!/^[a-f0-9]{32}$/.test(scoped.accountRef)||
             typeof scoped.roomRef!=='string'||!/^[a-f0-9]{32}$/.test(scoped.roomRef)||
             typeof scoped.mid!=='string'||!scoped.mid.startsWith('$')||
             scoped.ackKind!=='READ'||scoped.providerRead!==true||
             scoped.providerAccepted!==true||scoped.providerDelivered!==true)return
          try{response.write('event: personal-read-ack\ndata: '+JSON.stringify(scoped)+'\n\n')}
          catch{close()}
          return
        }
        if(scoped.channel!=='Personal'||
           scoped.source!=='OFFICIAL_MAUTRIX_META_MATRIX_SYNC'||
           typeof scoped.accountRef!=='string'||!/^[a-f0-9]{32}$/.test(scoped.accountRef)||
           typeof scoped.roomRef!=='string'||!/^[a-f0-9]{32}$/.test(scoped.roomRef)||
           typeof scoped.mid!=='string'||!scoped.mid.startsWith('$')||
           !['INBOUND','OUTBOUND'].includes(scoped.direction)||
           typeof scoped.timestamp!=='number'||!Number.isFinite(scoped.timestamp)||
           typeof scoped.text!=='string'||scoped.text.length>4000)return
        const prefix=kind==='preview'?'event: personal-preview\n':''
        try{response.write(prefix+'data: '+JSON.stringify(scoped)+'\n\n')}
        catch{close()}
      })
      stopPage=scope.on('yenra/page-verified-inbound' as any,(input:unknown)=>{
        if(closed||!input||typeof input!=='object')return
        const row=input as Record<string,unknown>
        const verifiedExternalOutgoing=row.direction==='OUTBOUND'&&
          row.source==='SENDPULSE_OFFICIAL_REST_API_VERIFIED'
        if(!['ORIGINAL_SIGNED_PANCAKE_AND_PROVIDER_GET','SENDPULSE_OFFICIAL_REST_API_VERIFIED'].includes(String(row.source))||
           row.channel!=='Page'||(row.direction!=='INBOUND'&&!verifiedExternalOutgoing)||
           typeof row.accountRef!=='string'||!/^[a-f0-9]{32}$/.test(row.accountRef)||
           typeof row.roomRef!=='string'||!/^[a-f0-9]{32}$/.test(row.roomRef)||
           typeof row.mid!=='string'||row.mid.length>180||
           typeof row.text!=='string'||row.text.length>4000||
           typeof row.timestamp!=='number'||!Number.isFinite(row.timestamp))return
        try{
          const event=verifiedExternalOutgoing?'event: page-external-outgoing\n':''
          response.write(event+'data: '+JSON.stringify(row)+'\n\n')
          originalSocialSseHealth.pageFramesWritten++
          originalSocialSseHealth.lastPageFrameAt=Date.now()
        }catch{close()}
      })
      stopPresence=scope.on('dsh-im/whatsapp-peer-presence',(raw:unknown)=>{
        if(closed||!raw||typeof raw!=='object')return
        const e=raw as Record<string,unknown>
        if(typeof e.botId!=='string'||!authorized.has(e.botId)||
           typeof e.jid!=='string'||
           !/^\d{5,32}@(s\.whatsapp\.net|lid)$/.test(e.jid)||
           e.source!=='ORIGINAL_BAILEYS_PRESENCE'||
           !['on','off'].includes(String(e.status))||
           !Number.isFinite(e.observedAt)||Date.now()-Number(e.observedAt)>12000)
          return
        const event={channel:'WhatsApp',accountRef:accountRef(e.botId),
          roomRef:roomRef(e.botId,e.jid),status:e.status,
          source:'ORIGINAL_BAILEYS_PRESENCE',observedAt:e.observedAt}
        try{response.write('event: whatsapp-peer-presence\ndata: '+
          JSON.stringify(event)+'\n\n')}catch{close()}
      })
      stopAck=scope.on('dsh-im/whatsapp-verified-ack',(raw:unknown)=>{
        if(closed||!raw||typeof raw!=='object')return
        const ack=raw as Record<string,unknown>
        const botId=ack.botId,peer=ack.providerContactId,mid=ack.nativeOutboundMid
        if(typeof botId!=='string'||!authorized.has(botId)||
           ack.channel!=='WHATSAPP'||
           ack.senderAuthority!=='EXISTING_DSH_IM_SINGLE_SOCKET'||
           ack.verifiedRecipient!==true||ack.providerAccepted!==true||
           ack.providerDelivered!==true||
           !['DELIVERED','READ','PLAYED'].includes(String(ack.ackKind))||
           typeof peer!=='string'||!/^\d{5,32}@(s\.whatsapp\.net|lid)$/.test(peer)||
           typeof mid!=='string'||!mid||mid.length>180)return
        // Named SSE event: existing inbound onmessage cannot misread an ACK
        // as a newly arrived chat message or manufacture a success bubble.
        const event={channel:'WhatsApp',accountRef:accountRef(botId),
          roomRef:roomRef(botId,peer),mid,ackKind:ack.ackKind,
          providerAccepted:true,providerDelivered:true,
          providerRead:ack.providerRead===true,
          observedAt:Number.isFinite(ack.observedAt)?ack.observedAt:null}
        try{response.write('event: delivery-ack\ndata: '+JSON.stringify(event)+'\n\n')}
        catch{close()}
      })
      for(const state of observations){
        const job={pending:false,running:false,timer:null as NodeJS.Timeout|null}
        queues.set(state.bot.botId,job)
        const perform=async()=>{
          if(closed||job.running)return
          job.running=true
          try{
            do{
              job.pending=false
              try{
                // The original DSH-IM writes inbox.json by atomic rename.
                const inbox=await readInbox(state.bot.botId)
                const events=diffOriginalInbox(state.seen,inbox,
                  accountRef(state.bot.botId),state.bot.botId,false)
                for(const event of events){
                  if(closed)return
                  if(event.direction==='OUTBOUND'){
                    // Named event: browser onmessage receives incoming ONLY.
                    // Bridge re-reads the original authenticated room by MID.
                    response.write('event: whatsapp-external-outgoing\n'+'data: '+
                      JSON.stringify({channel:'WhatsApp',
                        source:'ORIGINAL_DSH_IM_ATOMIC_INBOX',direction:'OUTBOUND',
                        accountRef:event.accountRef,roomRef:event.roomRef,
                        mid:event.mid,timestamp:event.timestamp})+'\n\n')
                  }else response.write('data: '+JSON.stringify(event)+'\n\n')
                }
              }catch{/* preserve original Socket; client retains cached UI */}
            }while(job.pending&&!closed)
          }finally{job.running=false}
        }
        try{
          const watcher=watch(state.dir,{persistent:false},(_kind,filename)=>{
            if(closed)return
            if(filename&&String(filename)!=='inbox.json')return
            job.pending=true
            // Coalesce atomic rename notifications; never periodic provider polling.
            if(job.timer)clearTimeout(job.timer)
            job.timer=setTimeout(()=>{job.timer=null;void perform()},35)
            job.timer.unref?.()
          })
          watcher.on('error',()=>{
            // One degraded/offline WhatsApp account must not take down the
            // remaining already-authorized account's native message feed.
            try{watcher.close()}catch{}
            const index=watchers.indexOf(watcher)
            if(index>=0)watchers.splice(index,1)
            const queued=queues.get(state.bot.botId)
            if(queued?.timer)clearTimeout(queued.timer)
            queues.delete(state.bot.botId)
            // A WhatsApp file watcher failing must NEVER close the shared
            // Page/Personal SSE or disable those independently verified
            // inbound events. Browser EventSource keeps one stream alive.
            // This bot can recover on the next original Host restart.
          })
          watchers.push(watcher)
        }catch{
          // During a partial account restore this bot's inbox directory may
          // not exist yet. Keep observing other established original accounts.
          queues.delete(state.bot.botId)
        }
      }
    },
  }), 'YENRA observer of original DSH-IM inbox events; no second socket or AI gate'))
}
