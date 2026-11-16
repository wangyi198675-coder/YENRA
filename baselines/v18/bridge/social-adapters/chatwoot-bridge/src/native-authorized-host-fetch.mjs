/**
 * Authorized read-only Host transport over the ONE existing YENRA dsh-app page.
 * No credential extraction, alternate sender, secondary data store or Host.
 */
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const validPath=/^\/api\/yenra\/(?:oss-roster|social-read|facebook-room|social-events|facebook-media|facebook-avatar|social-media)(?:\?|$)/u;
const ssePath='/api/yenra/social-events';
const maxBody=6_000_000;
function verifyUrl(url,init){
 const u=new URL(String(url));
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||
  u.username||u.password||String(init?.method??'GET').toUpperCase()!=='GET'||init?.body!==undefined||
  !validPath.test(u.pathname+u.search))throw Error('DSH_NATIVE_AUTH_READONLY_SCOPE_REJECTED');
 return u.pathname+u.search;
}
function check(obj,message){if(!obj)throw Error(message)}
class NativeSession{
 constructor(port,verifyProcess){this.port=port;this.verifyProcess=verifyProcess;this.ws=null;this.pending=new Map();this.seq=0;this.attaching=null;this.event=null;this.name='__yenraSse_'+randomUUID().replaceAll('-','')}
 async verify(){
  if(this.verifyProcess)return this.verifyProcess(this.port);
  if(process.platform!=='win32')throw Error('DSH_NATIVE_WINDOWS_REQUIRED');
  const ps=['$p=@(Get-CimInstance Win32_Process -Filter "Name=\'YENRA.exe\'" |Where-Object {$_.CommandLine -notmatch \'--type=|--expose-internals\'});',
   'if($p.Count -ne 1){exit 2};',
   '$s=[string]$p[0].CommandLine;',
   'if(!$s.Contains(\'--remote-debugging-port='+this.port+'\')){exit 3};',
   this.port===32649?'if(!$s.Contains(\'ui-candidate-desktop-user-data\')){exit 4};':'',
   'if($p[0].ExecutablePath -notlike \'*\\Programs\\YENRA\\YENRA.exe\'){exit 5}'].join('');
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],
    {timeout:9000,windowsHide:true,maxBuffer:1024});
 }
 async attach(){
  if(this.ws?.readyState===1)return;
  if(this.attaching)return this.attaching;
  this.attaching=this.connect().finally(()=>{this.attaching=null});
  return this.attaching;
 }
 async connect(){
  await this.verify();
  const r=await fetch('http://127.0.0.1:'+this.port+'/json/list',
    {redirect:'error',signal:AbortSignal.timeout(3500)});
  check(r.ok,'DSH_NATIVE_INSPECTOR_UNAVAILABLE');
  const t=(await r.json()).filter(x=>x.type==='page'&&x.url==='dsh-app://app/');
  check(t.length===1,'DSH_NATIVE_SINGLE_AUTHORIZED_PAGE_REQUIRED');
  const u=new URL(t[0].webSocketDebuggerUrl);
  check(u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&Number(u.port)===this.port&&!u.username,
    'DSH_NATIVE_CDP_ADDRESS_REJECTED');
  const ws=new WebSocket(u);
  await new Promise((yes,no)=>{
   const to=setTimeout(()=>no(Error('DSH_NATIVE_CDP_CONNECT_TIMEOUT')),4500);
   ws.addEventListener('open',()=>{clearTimeout(to);yes()},{once:true});
   ws.addEventListener('error',()=>{clearTimeout(to);no(Error('DSH_NATIVE_CDP_CONNECT_ERROR'))},{once:true});
  });
  this.ws=ws;
  ws.addEventListener('message',e=>{
   let packet;try{packet=JSON.parse(e.data)}catch{return}
   if(Number.isInteger(packet.id)){
    const p=this.pending.get(packet.id);
    if(p){this.pending.delete(packet.id);clearTimeout(p.timer);p.resolve(packet)}
    return;
   }
   if(packet.method==='Runtime.bindingCalled'&&packet.params?.name===this.name){
    let row;try{row=JSON.parse(packet.params.payload)}catch{return}
    const ev=this.event;if(!ev||row?.sid!==ev.sid)return;
    if(row.type==='start')ev.start(row);
    else if(row.type==='chunk'&&typeof row.bytes==='string'){
     const b=Buffer.from(row.bytes,'base64');
     if(b.length>131072)ev.fail(Error('DSH_NATIVE_SSE_FRAME_TOO_LARGE'));
     else ev.push(b);
    }else if(row.type==='ended')ev.fail(Error('DSH_NATIVE_SSE_DISCONNECTED'));
   }else if(packet.method==='Runtime.executionContextsCleared'){
    this.event?.fail(Error('DSH_NATIVE_RENDERER_RELOADED'));
   }
  });
  ws.addEventListener('close',()=>{
   if(this.ws!==ws)return;
   this.ws=null;
   for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('DSH_NATIVE_CDP_CLOSED'))}
   this.pending.clear();this.event?.fail(Error('DSH_NATIVE_CDP_CLOSED'));
  });
  await this.command('Runtime.enable',{});
  await this.command('Runtime.addBinding',{name:this.name});
 }
 command(method,params={},timeout=13000){
  check(this.ws?.readyState===1,'DSH_NATIVE_CDP_DISCONNECTED');
  return new Promise((resolve,reject)=>{
   const id=++this.seq;
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('DSH_NATIVE_CDP_TIMEOUT'))},timeout);
   this.pending.set(id,{resolve,reject,timer});
   this.ws.send(JSON.stringify({id,method,params}));
  });
 }
 async evaluate(expr){
  await this.attach();
  const result=await this.command('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},17500);
  check(!result.error&&!result.result?.exceptionDetails,'DSH_NATIVE_AUTHORIZED_EVAL_FAILED');
  return result.result?.result?.value;
 }
 async read(path,signal){
  if(signal?.aborted)throw Error('DSH_NATIVE_ABORTED');
  const expression=[
   '(async()=>{const p='+JSON.stringify(path)+';const controller=new AbortController();',
   'const limit=setTimeout(()=>controller.abort(),10000);try{',
   'const response=await fetch(p,{method:"GET",credentials:"include",redirect:"error",',
   'headers:{accept:"application/json"},signal:controller.signal});',
   'const buffer=new Uint8Array(await response.arrayBuffer());',
   'if(buffer.byteLength>'+maxBody+')return {error:"BODY_TOO_LARGE"};',
   'let binary="";for(let i=0;i<buffer.length;i+=16384){binary+=String.fromCharCode(...buffer.subarray(i,i+16384))}',
   'return {status:response.status,contentType:response.headers.get("content-type"),data:btoa(binary)};',
   '}catch(e){return{error:e?.name??"FETCH_ERROR"}}finally{clearTimeout(limit)}})()'
  ].join('');
  const out=await this.evaluate(expression);
  check(out&&typeof out==='object'&&!out.error,'DSH_NATIVE_AUTHORIZED_READ_FAILED');
  check(Number.isInteger(out.status)&&out.status>=200&&out.status<=599,'DSH_NATIVE_STATUS_INVALID');
  check(typeof out.data==='string'&&out.data.length<maxBody*1.4,'DSH_NATIVE_BODY_INVALID');
  const data=Buffer.from(out.data,'base64');
  check(data.length<=maxBody,'DSH_NATIVE_BODY_TOO_LARGE');
  return new Response([204,205,304].includes(out.status)?null:data,{status:out.status,
   headers:{'content-type':out.contentType??'application/octet-stream'}});
 }
 async stream(signal){
  await this.attach();
  check(this.event===null,'DSH_NATIVE_ONE_SSE_REQUIRED');
  const sid=randomUUID();let accept,reject;const ready=new Promise((a,b)=>{accept=a;reject=b});
  let ctrl=null,buffered=[],settled=false;
  const ev={
   sid,start:(x)=>{if(settled)return;settled=true;
     if(x.status===200&&String(x.contentType??'').startsWith('text/event-stream'))accept();
     else reject(Error('DSH_NATIVE_SSE_HTTP_'+x.status))},
   push:(x)=>{if(ctrl)ctrl.enqueue(x);else buffered.push(x);
     if(buffered.length>48)ev.fail(Error('DSH_NATIVE_SSE_BACKLOG_EXCEEDED'))},
   fail:(e)=>{if(!settled){settled=true;reject(e)}
     try{ctrl?.error(e)}catch{};if(this.event===ev)this.event=null}
  };
  this.event=ev;
  const abort=()=>{
   if(this.event!==ev)return;
   this.event=null;
   void this.command('Runtime.evaluate',{expression:'window.__yenraOfficialSseStop?.();true',returnByValue:true},2000).catch(()=>{});
   try{ctrl?.close()}catch{}
  };
  if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})}
  const source=[
   '(()=>{const last=window.__yenraOfficialSseStop;if(typeof last==="function")last();',
   'const cancel=new AbortController();window.__yenraOfficialSseStop=()=>cancel.abort();',
   'const send=x=>{try{window['+JSON.stringify(this.name)+'](JSON.stringify({sid:'+JSON.stringify(sid)+',...x}))}catch{}};',
   'void(async()=>{try{const r=await fetch('+JSON.stringify(ssePath)+',',
   '{method:"GET",credentials:"include",headers:{accept:"text/event-stream"},signal:cancel.signal});',
   'send({type:"start",status:r.status,contentType:r.headers.get("content-type")});',
   'if(!r.ok||!r.body)return;',
   'const reader=r.body.getReader();while(!cancel.signal.aborted){const v=await reader.read();if(v.done)break;',
   'for(let i=0;i<v.value.byteLength;i+=16384){',
   'const part=v.value.subarray(i,i+16384);send({type:"chunk",bytes:btoa(String.fromCharCode(...part))})}}}',
   'catch(e){if(!cancel.signal.aborted)send({type:"ended",error:e?.name??"UNKNOWN"})}',
   'finally{if(!cancel.signal.aborted)send({type:"ended"})}})();return true})()'
  ].join('');
  try{
   const started=await this.command('Runtime.evaluate',{expression:source,returnByValue:true},5500);
   check(!started.error&&!started.result?.exceptionDetails,'DSH_NATIVE_SSE_START_REJECTED');
   await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('DSH_NATIVE_SSE_READY_TIMEOUT')),7500))]);
  }catch(e){abort();throw e}
  const stream=new ReadableStream({start(c){ctrl=c;for(const x of buffered)c.enqueue(x);buffered=[]},cancel:abort});
  return new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}});
 }
}
export function createNativeAuthorizedHostFetch({cdpPort,verifyProcess}={}){
 check([32642,32649].includes(cdpPort),'DSH_NATIVE_INSPECTOR_NOT_APPROVED');
 const session=new NativeSession(cdpPort,verifyProcess);
 return async (url,init={})=>{
  const path=verifyUrl(url,init);
  if(path===ssePath)return session.stream(init.signal);
  return session.read(path,init.signal);
 };
}
