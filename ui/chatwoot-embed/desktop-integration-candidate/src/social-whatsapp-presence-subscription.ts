/** Single authenticated WhatsApp Socket: on-demand presence subscription.
 * The Bridge has FIRST resolved a native Chatwoot conversation into the
 * original accountRef+roomRef. Never accept raw bot/JID from a browser.
 */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {accountRef,roomRef,currentBots,readInbox} from './social-readonly-commands.ts'

type Service={
 listBots():Promise<Array<{botId:string;channel:string}>>
 subscribePeerPresence?:(botId:string,jid:string)=>Promise<boolean>
}
const REF=/^[a-f0-9]{32}$/
export function registerOriginalWhatsAppPresenceSubscription(ctx:Context):void{
 ctx.inject(['webServer','dshIm'],scope=>scope.effect(()=>scope.webServer.register({
  kind:'exact',path:'/api/yenra/social-presence-subscribe',
  handler:async(request,response)=>{
   const send=(status:number,body:unknown)=>{
    response.writeHead(status,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'})
    response.end(JSON.stringify(body))
   }
   const addr=String(request.socket?.remoteAddress??'')
   if(request.method!=='POST'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr)||
      request.headers.origin||request.headers['sec-fetch-site']||
      request.headers['x-yenra-verified-chatwoot-room']!=='1'||
      !String(request.headers['content-type']??'').startsWith('application/json')){
    send(403,{ok:false,code:'VERIFIED_BRIDGE_LOCAL_ONLY'});return
   }
   let raw=''
   try{
    for await(const part of request){
     raw+=Buffer.from(part).toString('utf8')
     if(raw.length>512)throw Error('OVER_LIMIT')
    }
    const q:unknown=JSON.parse(raw)
    if(!q||typeof q!=='object'||Array.isArray(q))throw Error('NOT_OBJECT')
    const x=q as Record<string,unknown>
    if(Object.keys(x).sort().join('|')!=='accountRef|roomRef'||
       typeof x.accountRef!=='string'||!REF.test(x.accountRef)||
       typeof x.roomRef!=='string'||!REF.test(x.roomRef))
      throw Error('SCOPE_INVALID')
    const svc=(scope.get('dshIm') ??
      (scope as unknown as {dshIm?:Service}).dshIm) as Service
    if(typeof svc?.subscribePeerPresence!=='function'){
     send(503,{ok:false,code:'NATIVE_SOCKET_PRESENCE_UNAVAILABLE'});return
    }
    const bot=(await currentBots(svc)).find(v=>accountRef(v.botId)===x.accountRef)
    if(!bot){send(404,{ok:false,code:'NATIVE_ACCOUNT_SCOPE_MISMATCH'});return}
    const original=await readInbox(bot.botId)
    const room=original.chats.find(v=>v.jid.endsWith('@g.us')===false&&
      roomRef(bot.botId,v.jid)===x.roomRef)
    if(!room){send(404,{ok:false,code:'NATIVE_ROOM_NOT_IN_INBOX'});return}
    const ok=await svc.subscribePeerPresence(bot.botId,room.jid)
    send(ok?200:503,{ok:ok===true,code:ok?'NATIVE_PRESENCE_SUBSCRIBED':'NATIVE_PRESENCE_NOT_READY'})
   }catch{send(400,{ok:false,code:'VERIFIED_ROOM_REQUEST_INVALID'})}
  },
 })))
}
