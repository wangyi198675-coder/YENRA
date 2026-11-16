/** Own relay and read-only identity resolver; no Sender/provider connection. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DEFAULT_ORIGIN, DEFAULT_BRIDGE_ORIGIN, validateOrigin } from './config.mjs'
import { renderDashboardRelay } from './dashboard-relay.mjs'
import { CONTEXT_PATH, RELAY_PATH, CLOUD_CONTEXT_PATH, isLocalSameOrigin, resolveFromBridge, resolveFromHost, resolveCloudContextFromBridge } from './context-resolver.mjs'
import { mintNativeChatwootSso } from './native-sso.mjs'
import { readVerifiedCloudAsset } from './cloud-export-asset.mjs'
import { lookupCloudKt } from './kt-lookup.mjs'
const DESKTOP_SSO_PATH = '/api/yenra/chatwoot-desktop-session'
const CLOUD_EXPORT_PATH = '/api/yenra/cloud-export/page'
const CLOUD_PREVIEW_PATH = '/api/yenra/cloud-preview/list'
export const Config = z.object({
  origin: z.string().default(DEFAULT_ORIGIN).volatile(),
  bridgeOrigin: z.string().default(DEFAULT_BRIDGE_ORIGIN).volatile(),
  accountId: z.number().default(1).volatile(),
  inboxMap: z.string().default('{}').volatile(),
  tokenEnv: z.string().default('CHATWOOT_API_TOKEN').volatile(),
  selectionMode: z.string().default('route').volatile(),
})
interface ConfigValue { origin: Volatile<string>; bridgeOrigin: Volatile<string>;
  accountId: Volatile<number>; inboxMap: Volatile<string>; tokenEnv: Volatile<string>; selectionMode: Volatile<string> }
export function apply(ctx: Context, config: ConfigValue): void {
  validateOrigin(config.origin.get())
  validateOrigin(config.bridgeOrigin.get())
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: true }, ctx.fiber))
  })
  ctx.inject(['webServer'], child => {
    // Same DSH Host serves an on-demand static export bundle. No channel data,
    // credentials or Sender API in this module; actual room reads stay scoped
    // to original owner-authenticated social-read endpoints after explicit click.
    child.effect(() => child.webServer.register({
      kind:'exact',path:'/api/yenra/chat-export/runtime.js',
      handler:async(request,response)=>{
        if(request.method!=='GET'){response.writeHead(405);response.end();return}
        const remote=String(request.socket?.remoteAddress??'')
        const origin=String(request.headers.origin??'')
        const site=String(request.headers['sec-fetch-site']??'')
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote) ||
           (origin&&origin!==child.webServer.getOrigin()&&origin!=='dsh-app://app') ||
           (site&&site!=='same-origin'&&site!=='none')){
          response.writeHead(403);response.end();return
        }
        try{
          const bytes=await readFile(new URL('./chat-export-runtime.js',import.meta.url))
          response.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
            'cache-control':'private, max-age=600','x-content-type-options':'nosniff'})
          response.end(bytes)
        }catch{
          response.writeHead(503,{'cache-control':'no-store'})
          response.end('Export module unavailable')
        }
      }
    }))
    // Only the authenticated owner desktop may load the narrow Cloud-only
    // HTML formatter. The original ChatLume/media ZIP bundle is unaffected.
    child.effect(() => child.webServer.register({
      kind:'exact',path:'/api/yenra/cloud-export/runtime.js',
      handler:async(request,response)=>{
        const remote=String(request.socket?.remoteAddress??'');
        const origin=String(request.headers.origin??'');
        if(request.method!=='GET'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)||
           (origin&&origin!==child.webServer.getOrigin()&&origin!=='dsh-app://app')){
          response.writeHead(403);response.end();return
        }
        try{
          const bytes=await readFile(new URL('./cloud-export-runtime.js',import.meta.url))
          response.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
            'cache-control':'private, max-age=600','x-content-type-options':'nosniff'})
          response.end(bytes)
        }catch{
          response.writeHead(503);response.end('Cloud export module unavailable')
        }
      }
    }))
    child.effect(() => child.webServer.register({kind:'exact',path:RELAY_PATH,handler:(request,response)=>{
      if(request.method!=='GET'){response.writeHead(405);response.end();return}
      const topOrigin=child.webServer.getOrigin(),chatwootOrigin=validateOrigin(config.origin.get())
      const nonce=randomBytes(18).toString('base64')
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
        'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors ${topOrigin} ${chatwootOrigin}; base-uri 'none'; form-action 'none'`})
      response.end(renderDashboardRelay({chatwootOrigin,topOrigin,nonce}))
    }}))
    // Owner-authenticated original DSH Host is the ONLY launch authority.
    // Chatwoot signs its own login with native five-minute Redis SSO; no
    // credentials, OAuth cookies or shared user sessions cross installations.
    child.effect(() => child.webServer.register({kind:'exact',path:DESKTOP_SSO_PATH,handler:async(request,response)=>{
      const send=(status:number,value:unknown)=>{
        response.writeHead(status,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store, private','x-content-type-options':'nosniff',
          'referrer-policy':'no-referrer'})
        response.end(JSON.stringify(value))
      }
      if(request.method!=='POST'){send(405,{ok:false,error:'POST_ONLY'});return}
      if(!isLocalSameOrigin(request,child.webServer.getOrigin())){
        send(403,{ok:false,error:'ORIGINAL_DSH_OWNER_SESSION_REQUIRED'});return
      }
      // Do not accept an arbitrary email, account, contact or redirect from
      // browsers. The one local Chatwoot account is selected inside Rails.
      if(request.headers['content-length']&&Number(request.headers['content-length'])>2){
        send(413,{ok:false,error:'BODY_NOT_ACCEPTED'});return
      }
      try{
        const launched=await mintNativeChatwootSso({origin:validateOrigin(config.origin.get())})
        if(launched.accountId!==config.accountId.get())
          throw Error('CHATWOOT_SSO_ACCOUNT_MISMATCH')
        send(200,{ok:true,url:launched.url})
      }catch{
        send(503,{ok:false,error:'CHATWOOT_DESKTOP_SSO_UNAVAILABLE'})
      }
    }}))
    // Cloud First V2.0: Cloud navigation is a hint only. Resolve current
    // Cloud conversation against original DSH authorization via local Bridge.
    // Never expose Cloud API token, Browser session or a second contact store.
    child.effect(() => child.webServer.register({
      kind:'exact',path:CLOUD_CONTEXT_PATH,handler:async(request,response)=>{
        const send=(status:number,value:unknown)=>{
          response.writeHead(status,{'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store, private','x-content-type-options':'nosniff'})
          response.end(JSON.stringify(value))
        }
        if(!isLocalSameOrigin(request,child.webServer.getOrigin())){
          send(403,{ok:false,error:'ORIGINAL_DSH_OWNER_REQUIRED'});return
        }
        if(request.method!=='POST'){send(405,{ok:false,error:'POST_ONLY'});return}
        if(!String(request.headers['content-type']??'').startsWith('application/json')){
          send(415,{ok:false,error:'JSON_REQUIRED'});return
        }
        try{
          let body=''
          for await(const chunk of request){
            body+=chunk.toString()
            if(body.length>400)throw Error('CLOUD_BODY_TOO_LARGE')
          }
          const value=JSON.parse(body)
          const result=await resolveCloudContextFromBridge(value,{
            bridgeOrigin:validateOrigin(config.bridgeOrigin.get()),
          })
          send(200,{ok:true,selection:result})
        }catch{
          send(422,{ok:false,error:'CLOUD_SCOPE_NOT_VERIFIED'})
        }
      }
    }))
    // One manual, read-only KT check for the exact Cloud original message.
    child.effect(() => child.webServer.register({
      kind:'exact',path:'/api/yenra/cloud-kt/check',
      handler:async(request,response)=>{
        const send=(status:number,value:unknown)=>{
          response.writeHead(status,{'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store, private','x-content-type-options':'nosniff'});
          response.end(JSON.stringify(value));
        };
        if(!isLocalSameOrigin(request,child.webServer.getOrigin())){
          send(403,{ok:false,code:'KT_OWNER_REQUIRED'});return;
        }
        if(request.method!=='POST'||
           !String(request.headers['content-type']??'').startsWith('application/json')){
          send(405,{ok:false,code:'KT_POST_JSON_ONLY'});return;
        }
        try{
          let body='';
          for await(const chunk of request){
            body+=chunk.toString();
            if(body.length>480)throw Error('KT_REQUEST_TOO_LARGE');
          }
          const args=JSON.parse(body);
          const result=await lookupCloudKt({
            bridgeOrigin:validateOrigin(config.bridgeOrigin.get()),args});
          send(result.ok?200:422,result);
        }catch{
          send(422,{ok:false,code:'KT_LOOKUP_UNAVAILABLE',canSend:false});
        }
      }
    }));
    // Cloud-only cached zh_CN snippets for the ORIGINAL list rows.
    // Credentials stay inside the verified local Bridge, never the WebView.
    child.effect(() => child.webServer.register({
      kind:'exact',path:CLOUD_PREVIEW_PATH,handler:async(request,response)=>{
        const send=(code:number,data:unknown)=>{
          response.writeHead(code,{'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store, private','x-content-type-options':'nosniff',
            'referrer-policy':'no-referrer'});
          response.end(JSON.stringify(data));
        };
        if(!isLocalSameOrigin(request,child.webServer.getOrigin())){
          send(403,{ok:false,code:'OWNER_CLOUD_PREVIEW_ONLY'});return;
        }
        if(request.method!=='POST'||
           !String(request.headers['content-type']??'').startsWith('application/json')){
          send(405,{ok:false,code:'POST_JSON_ONLY'});return;
        }
        try{
          let body='';
          for await(const chunk of request){body+=chunk.toString();
            if(body.length>100)throw Error('PREVIEW_BODY_TOO_LARGE')}
          const args=JSON.parse(body);
          if(Object.keys(args??{}).sort().join(',')!=='accountId,page'||
            args.accountId!==196799||!Number.isSafeInteger(args.page)||
            args.page<1||args.page>8)throw Error('PREVIEW_REQUEST_INVALID');
          const responseFromBridge=await fetch(new URL('/yenra-cloud/preview-list',
            validateOrigin(config.bridgeOrigin.get())),{
              method:'POST',redirect:'error',cache:'no-store',
              signal:AbortSignal.timeout(15000),
              headers:{'content-type':'application/json',
                'x-yenra-original-dsh-cloud-preview':'1'},
              body:JSON.stringify(args),
          });
          if(!responseFromBridge.ok)throw Error('PREVIEW_CLOUD_SOURCE_UNAVAILABLE');
          const data=await responseFromBridge.json();
          if(data?.ok!==true||data.accountId!==196799||
            !Array.isArray(data.rows)||data.rows.length>30||
            !Array.isArray(data.candidates)||data.candidates.length>30||
            data.rows.length+data.candidates.length>30)throw Error('PREVIEW_INVALID');
          send(200,data);
        }catch{send(422,{ok:false,code:'CLOUD_SAVED_PREVIEW_UNAVAILABLE'});}
      }
    }));
    child.effect(() => child.webServer.register({
      kind:'exact',path:CLOUD_EXPORT_PATH,handler:async(request,response)=>{
        const send=(status:number,value:unknown)=>{
          response.writeHead(status,{'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store, private','x-content-type-options':'nosniff',
            'referrer-policy':'no-referrer'});
          response.end(JSON.stringify(value));
        };
        if(!isLocalSameOrigin(request,child.webServer.getOrigin())){
          send(403,{ok:false,code:'ORIGINAL_DSH_OWNER_REQUIRED'});return;
        }
        if(request.method!=='POST'||
           !String(request.headers['content-type']??'').startsWith('application/json')){
          send(405,{ok:false,code:'POST_JSON_ONLY'});return;
        }
        try{
          let body='';
          for await(const chunk of request){
            body+=chunk.toString();
            if(body.length>500)throw Error('EXPORT_BODY_TOO_LARGE');
          }
          const args=JSON.parse(body);
          const names=Object.keys(args??{}).sort().join(',');
          if(!['accountId,conversationId','accountId,before,conversationId'].includes(names)||
             args.accountId!==196799||!Number.isSafeInteger(args.conversationId)||
             args.conversationId<=0||
             !(args.before===undefined||(Number.isSafeInteger(args.before)&&args.before>0)))
            throw Error('EXPORT_SCOPE_INVALID');
          const origin=validateOrigin(config.bridgeOrigin.get());
          const result=await fetch(new URL('/yenra-cloud/export-page',origin),{
            method:'POST',redirect:'error',cache:'no-store',
            signal:AbortSignal.timeout(15000),
            headers:{'content-type':'application/json',
              'x-yenra-original-dsh-cloud-export':'1'},
            body:JSON.stringify(args),
          });
          if(!result.ok){send(422,{ok:false,code:'CLOUD_EXPORT_UNAVAILABLE'});return}
          const data=await result.json();
          if(data?.ok!==true||data.accountId!==196799||
             data.conversationId!==args.conversationId||
             !Array.isArray(data.rows)||data.rows.length>30)
            throw Error('CLOUD_EXPORT_RESPONSE_INVALID');
          send(200,data);
        }catch{
          send(422,{ok:false,code:'CLOUD_EXPORT_NOT_VERIFIED'});
        }
      }
    }));
    // Exactly the same authorized Cloud export-page reader, but returning
    // genuine attachment bytes. Node Host avoids the Cloud CDN browser CORS
    // restriction without exposing a signed URL or creating another service.
    child.effect(() => child.webServer.register({
      kind:'exact',path:'/api/yenra/cloud-export/asset',
      handler:async(request,response)=>{
        const fail=(status:number,code:string)=>{
          response.writeHead(status,{'content-type':'application/json; charset=utf-8',
            'cache-control':'no-store, private','x-content-type-options':'nosniff'});
          response.end(JSON.stringify({ok:false,code}));
        };
        if(!isLocalSameOrigin(request,child.webServer.getOrigin())){
          fail(403,'ORIGINAL_DSH_OWNER_REQUIRED');return;
        }
        if(request.method!=='POST'||
           !String(request.headers['content-type']??'').startsWith('application/json')){
          fail(405,'POST_JSON_ONLY');return;
        }
        try{
          let body='';
          for await(const chunk of request){
            body+=chunk.toString();
            if(body.length>300)throw Error('ASSET_BODY_TOO_LARGE');
          }
          const args=JSON.parse(body);
          const result=await readVerifiedCloudAsset({
            args,bridgeOrigin:validateOrigin(config.bridgeOrigin.get()),
          });
          response.writeHead(200,{'content-type':result.mime,
            'content-length':result.bytes.length,'cache-control':'no-store, private',
            'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
          response.end(result.bytes);
        }catch{
          fail(422,'CLOUD_ASSET_NOT_VERIFIED_OR_UNAVAILABLE');
        }
      }
    }));
    child.effect(() => child.webServer.register({kind:'exact',path:CONTEXT_PATH,handler:async(request,response)=>{
      const send=(status:number,payload:unknown)=>{response.writeHead(status,{'content-type':'application/json',
        'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(payload))}
      const origin=child.webServer.getOrigin()
      if(!isLocalSameOrigin(request,origin)){send(403,{ok:false,error:'LOCAL_SAME_ORIGIN_REQUIRED'});return}
      if(request.method!=='POST'){send(405,{ok:false,error:'POST_ONLY'});return}
      if(!String(request.headers['content-type']??'').startsWith('application/json')){send(415,{ok:false,error:'JSON_REQUIRED'});return}
      try{
        let body=''
        for await(const chunk of request){body+=chunk.toString();if(body.length>2048)throw Error('CONTEXT_TOO_LARGE')}
        const inboxMap=JSON.parse(config.inboxMap.get())
        if(!inboxMap||typeof inboxMap!=='object'||Array.isArray(inboxMap)||Object.entries(inboxMap).some(([ref,id])=>
          !/^[a-f0-9]{32}$/.test(ref)||!Number.isSafeInteger(id)||Number(id)<=0))throw Error('TRUSTED_INBOX_MAP_INVALID')
        const tokenEnv=config.tokenEnv.get()
        if(!/^[A-Z][A-Z0-9_]{0,79}$/.test(tokenEnv))throw Error('TOKEN_ENV_NAME_INVALID')
        const selection=config.selectionMode.get()==='bridge-route'
          ? await resolveFromBridge(JSON.parse(body),{accountId:config.accountId.get(),bridgeOrigin:validateOrigin(config.bridgeOrigin.get())})
          : await resolveFromHost(JSON.parse(body),{origin,chatwootOrigin:validateOrigin(config.origin.get()),
              accountId:config.accountId.get(),inboxMap,token:process.env[tokenEnv]})
        send(200,{ok:true,selection})
      }catch(error){
        const safe=new Set(['INVALID_CONTEXT','ACCOUNT_MISMATCH','CHATWOOT_CONTEXT_MISMATCH','CONTACT_INBOX_MISMATCH',
          'ROSTER_SCOPE_NOT_UNIQUE','TRUSTED_INBOX_MAP_MISMATCH','TRUSTED_INBOX_MAP_INVALID','TOKEN_ENV_NAME_INVALID',
          'BRIDGE_SELECTION_UNAVAILABLE','BRIDGE_SCOPE_NOT_VERIFIED','BRIDGE_ORIGIN_INVALID',
          'CHATWOOT_TOKEN_ENV_UNAVAILABLE','TRUSTED_INBOX_MAP_UNCONFIGURED','CONTEXT_TOO_LARGE','HOST_READ_UNAVAILABLE','ORIGINAL_ROSTER_UNAVAILABLE'])
        const code=error instanceof Error&&safe.has(error.message)?error.message:'CONTEXT_RESOLVE_UNAVAILABLE'
        send(422,{ok:false,error:code})
      }
    }}))
  })
}
