/** Original official DSH WebServer manual media POST, never a new server.
 * The mature OSS Composer triggers this directly on a human send click.
 * Route checks official owner Session; original channel Host checks account,
 * room and bytes again; original Matrix/Pancake/DSH-IM Sender does the send.
 * No model-readable base64 Command, no parallel login/media engine/Sender.
 */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import {allowedLocal,assertOriginalDshOwnerSession} from './translation-commands.ts'
import {sendVerifiedFacebookMediaClick,sendVerifiedFacebookTextClick} from './facebook-social-commands.ts'
import {sendVerifiedWhatsAppMediaClick,sendVerifiedWhatsAppTextClick} from './social-readonly-commands.ts'

const MAX_BODY=11_300_000
const REF=/^[a-f0-9]{32}$/
type Request={
 channel:'Personal'|'Page'|'WhatsApp';sessionId:string;
 accountRef:string;roomRef:string;mediaType:'image'|'document';
 mimeType:string;fileName:string;media:string
}
function parseOwnerMedia(value:unknown):Request{
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('NATIVE_MEDIA_REQUEST_INVALID')
 const q=value as Record<string,unknown>
 if(Object.keys(q).sort().join('|')!==
    'accountRef|channel|fileName|media|mediaType|mimeType|roomRef|sessionId'||
   !['Personal','Page','WhatsApp'].includes(String(q.channel))||
   typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
   typeof q.roomRef!=='string'||!REF.test(q.roomRef)||
   typeof q.sessionId!=='string'||!/^session-[a-f0-9-]{36}$/.test(q.sessionId)||
   typeof q.fileName!=='string'||typeof q.mimeType!=='string'||
   typeof q.media!=='string'||!q.media||
   !['image','document'].includes(String(q.mediaType)))
  throw Error('NATIVE_MEDIA_ACCOUNT_ROOM_OR_SESSION_INVALID')
 return q as Request
}
type TextClick={channel:'Personal'|'Page'|'WhatsApp';sessionId:string;
 accountRef:string;roomRef:string;text:string;replyToMessageId?:string}
function parseOwnerText(value:unknown):TextClick{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('TEXT_REQUEST_INVALID')
 const q=value as Record<string,unknown>
 const keys=Object.keys(q).sort().join('|')
 if(!['accountRef|channel|roomRef|sessionId|text',
      'accountRef|channel|replyToMessageId|roomRef|sessionId|text'].includes(keys)||
    !['Personal','Page','WhatsApp'].includes(String(q.channel))||
    typeof q.sessionId!=='string'||!/^session-[a-f0-9-]{36}$/.test(q.sessionId)||
    typeof q.accountRef!=='string'||!REF.test(q.accountRef)||
    typeof q.roomRef!=='string'||!REF.test(q.roomRef)||
    typeof q.text!=='string'||!q.text.trim()||q.text.length>4000||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(q.text)||
    (q.replyToMessageId!==undefined&&
      (q.channel!=='Personal'||typeof q.replyToMessageId!=='string'||
        !/^\$[^\s]{5,240}$/.test(q.replyToMessageId))))
   throw Error('TEXT_ACCOUNT_ROOM_OR_SESSION_INVALID')
 return q as TextClick
}
export function registerOriginalSocialMediaHostRoute(ctx:Context):void{
 // Cordis services are independently recoverable. The original Facebook
 // media route must still exist if WhatsApp is temporarily offline.
 let originalIm:any=null
 ctx.inject(['dshIm'],imCtx=>imCtx.effect(()=>{
  originalIm=(imCtx as unknown as {dshIm:any}).dshIm
  return()=>{originalIm=null}
 },'YENRA existing DSH-IM media bridge optional service lifecycle'))
 ctx.inject(['webServer','sessions','sessionController'],scope=>{
  scope.effect(()=>scope.webServer.register({
   kind:'exact',path:'/api/yenra/social-media-send',
   handler:async(request,response)=>{
    const reply=(status:number,value:unknown)=>{
     response.writeHead(status,{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff',
     })
     response.end(JSON.stringify(value))
    }
    if(!allowedLocal(request)){reply(403,{ok:false,error:'ORIGINAL_DSH_LOCAL_UI_ONLY'});return}
    if(request.method!=='POST'){reply(405,{ok:false,error:'POST_ONLY'});return}
    if(String(request.url??'')!=='/api/yenra/social-media-send'){
     reply(400,{ok:false,error:'UNKNOWN_MEDIA_ROUTE'});return
    }
    if(!String(request.headers['content-type']??'').toLowerCase()
      .startsWith('application/json')){
     reply(415,{ok:false,error:'JSON_REQUIRED'});return
    }
    const indicated=Number(request.headers['content-length']??0)
    if(!Number.isSafeInteger(indicated)||indicated<0||indicated>MAX_BODY){
     reply(413,{ok:false,error:'ORIGINAL_MEDIA_SIZE_LIMIT'});return
    }
    let raw='',bytes=0
    try{
     for await(const chunk of request){
      const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)
      bytes+=b.byteLength
      if(bytes>MAX_BODY)throw Error('ORIGINAL_MEDIA_SIZE_LIMIT')
      raw+=b.toString('utf8')
     }
     const q=parseOwnerMedia(JSON.parse(raw))
     // The real owner Session is verified using the SAME official session
     // guard used by the existing original ChatGPT translation route.
     await assertOriginalDshOwnerSession(scope,q.sessionId)
     const original={accountRef:q.accountRef,roomRef:q.roomRef,
      mediaType:q.mediaType,mimeType:q.mimeType,fileName:q.fileName,media:q.media}
     if(q.channel==='WhatsApp'&&
       (!originalIm||typeof originalIm.listBots!=='function'))
      throw Error('ORIGINAL_WHATSAPP_SERVICE_TEMPORARILY_UNAVAILABLE_KEEP_DRAFT')
     const receipt=q.channel==='WhatsApp'
       ?await sendVerifiedWhatsAppMediaClick(
        originalIm,JSON.stringify(original),AbortSignal.timeout(90_000),scope)
       :await sendVerifiedFacebookMediaClick(JSON.stringify(original),q.channel)
     if(receipt.channel!==q.channel||
        receipt.accountRef!==q.accountRef||receipt.roomRef!==q.roomRef||
        receipt.submitted!==true||receipt.delivered!==false)
      throw Error('ORIGINAL_MEDIA_RECEIPT_SCOPE_UNCONFIRMED')
     reply(200,{ok:true,receipt})
    }catch(e){
     // A timeout/network error can mean UNKNOWN, never auto-resend.
     // Do not echo the user's media bytes or any protected credentials.
     reply(400,{ok:false,willRetryAutomatically:false,
      error:'原生媒体提交未确认，保留原文件；请检查原渠道，勿自动重发：'+
       String((e as Error)?.message??e).slice(0,110)})
    }
   },
  }), 'YENRA original DSH verified human media click through original Sender')
  // Text clicks share this SAME official WebServer and existing original
  // Sender helpers; unlike Commands.execute, no Work Session event is added.
  scope.effect(()=>scope.webServer.register({
   kind:'exact',path:'/api/yenra/social-text-send',
   handler:async(request,response)=>{
    const reply=(status:number,value:unknown)=>{
     response.writeHead(status,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'})
     response.end(JSON.stringify(value))
    }
    if(!allowedLocal(request)){reply(403,{ok:false,error:'ORIGINAL_DSH_LOCAL_UI_ONLY'});return}
    if(request.method!=='POST'){reply(405,{ok:false,error:'POST_ONLY'});return}
    if(String(request.url??'')!=='/api/yenra/social-text-send'){
     reply(400,{ok:false,error:'UNKNOWN_TEXT_ROUTE'});return
    }
    if(!String(request.headers['content-type']??'').toLowerCase()
      .startsWith('application/json')){reply(415,{ok:false,error:'JSON_REQUIRED'});return}
    const indicated=Number(request.headers['content-length']??0)
    if(!Number.isSafeInteger(indicated)||indicated<0||indicated>5500){
     reply(413,{ok:false,error:'TEXT_REQUEST_TOO_LARGE'});return
    }
    let raw='',bytes=0
    try{
     for await(const part of request){
      const chunk=Buffer.isBuffer(part)?part:Buffer.from(part)
      bytes+=chunk.byteLength
      if(bytes>5500)throw Error('TEXT_REQUEST_TOO_LARGE')
      raw+=chunk.toString('utf8')
     }
     const q=parseOwnerText(JSON.parse(raw))
     await assertOriginalDshOwnerSession(scope,q.sessionId)
     if(q.channel==='WhatsApp'&&
       (!originalIm||typeof originalIm.listBots!=='function'))
      throw Error('ORIGINAL_DSH_IM_UNAVAILABLE_KEEP_DRAFT')
     const original=JSON.stringify({accountRef:q.accountRef,roomRef:q.roomRef,text:q.text,
      ...(q.replyToMessageId?{replyToMessageId:q.replyToMessageId}:{})})
     const outcome=q.channel==='WhatsApp'
      ?await sendVerifiedWhatsAppTextClick(scope,originalIm,original,AbortSignal.timeout(90_000))
      :await sendVerifiedFacebookTextClick(original,q.channel)
     if(outcome.kind!=='success')throw Error(outcome.text)
     const prefix='YENRA_SOCIAL_SEND_V1:'
     if(!outcome.text.startsWith(prefix))throw Error('ORIGINAL_SENDER_RECEIPT_INVALID')
     const receipt:unknown=JSON.parse(outcome.text.slice(prefix.length))
     if(!receipt||typeof receipt!=='object')throw Error('ORIGINAL_RECEIPT_NOT_OBJECT')
     const checked=receipt as Record<string,unknown>
     if(checked.channel!==q.channel||checked.accountRef!==q.accountRef||
       checked.roomRef!==q.roomRef||checked.sent!==true||
       checked.submitted!==true||checked.delivered!==false||
       checked.deliveryStatus!=='UNKNOWN')
       throw Error('ORIGINAL_SENDER_RECEIPT_SCOPE_UNCONFIRMED')
     reply(200,{ok:true,receipt:checked})
    }catch(e){
     // Unconfirmed is NOT a license to retry. Keep local draft unchanged.
     reply(400,{ok:false,willRetryAutomatically:false,
      error:'发送未确认，原稿保留；请查看原渠道，勿自动重发：'+
       String((e as Error)?.message??e).slice(0,110)})
    }
   }
  }), 'YENRA original DSH verified owner text click without Work Session Command events')
 })
}
