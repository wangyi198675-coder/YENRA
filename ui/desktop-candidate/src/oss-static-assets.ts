/**
 * Serve the already-built mature OSS assets through the EXISTING official
 * DSH Host WebServer. One origin, one app, one Agent. No second frontend
 * server or dynamic file path from untrusted requests.
 */
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';

// Compiled original DSH plugin code resides in lib/index.js, with bundled
// mature OSS resources staged under lib/oss. Source-only isolated QA resolves
// through ../lib/oss without depending on any developer's home directory.
const BASE=dirname(fileURLToPath(import.meta.url));
const ROOT=existsSync(join(BASE,'oss','messaging-inbox.umd.js'))
  ?join(BASE,'oss'):join(BASE,'..','lib','oss');
const files=[
  {name:'messaging-inbox.umd.js',mime:'text/javascript; charset=utf-8'},
  {name:'messaging-inbox.css',mime:'text/css; charset=utf-8'},
  {name:'notification.wav',mime:'audio/wav'},
] as const;
function originalLocalClient(request:any):boolean{
  const address=String(request.socket?.remoteAddress??'');
  if(address&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))return false;
  const site=String(request.headers?.['sec-fetch-site']??'');
  if(site&&!['same-origin','none'].includes(site))return false;
  const origin=String(request.headers?.origin??'');
  if(!origin||origin==='null'||origin==='dsh-app://app')return true;
  try{
    const url=new URL(origin);
    return ['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname)&&
      url.host.toLowerCase()===String(request.headers?.host??'').toLowerCase();
  }catch{return false}
}
export function registerOssStaticAssets(ctx:Context):void{
  ctx.inject(['webServer'],scope=>scope.effect(()=>{
    const disposers=files.map(asset=>scope.webServer.register({
      kind:'exact' as const,path:'/api/yenra/oss/'+asset.name,
      handler:async(request,response)=>{
        const error=(status:number)=>{
          response.writeHead(status,{'content-type':'text/plain; charset=utf-8',
            'cache-control':'no-store','x-content-type-options':'nosniff'});
          response.end(status===403?'LOCAL_ONLY':'RESOURCE_UNAVAILABLE');
        };
        if(!originalLocalClient(request)){error(403);return}
        if(request.method!=='GET'){error(405);return}
        if(String(request.url??'')!=='/api/yenra/oss/'+asset.name){error(400);return}
        try{
          const body=await readFile(join(ROOT,asset.name));
          response.writeHead(200,{'content-type':asset.mime,
            'cache-control':asset.name==='notification.wav'?'private, max-age=60':'no-store',
            'x-content-type-options':'nosniff',
            'content-length':body.length});
          response.end(body);
        }catch{error(503)}
      },
    }));
    return()=>disposers.reverse().forEach(dispose=>dispose());
  },'YENRA mature OSS static assets via original DSH WebServer'));
}
