/** Parent DSH renderer delegates explicit Cloud Guest external link clicks to
 * the ORIGINAL Electron main-process window-open handler (OS browser).
 * No second Cloud guest, Electron window, Sender or credential forwarding. */
export function verifiedCloudGuestExternalUrl(raw:unknown):string|null{
 if(typeof raw!=='string'||raw.length<12||raw.length>2048||/[\u0000-\u001f\u007f]/u.test(raw))
   return null;
 try{
  const url=new URL(raw);
  const hostname=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     url.origin==='https://app.chatwoot.com'||url.hash.length>500||
     hostname==='localhost'||hostname.endsWith('.localhost')||
     hostname.endsWith('.local')||hostname.endsWith('.internal')||
     hostname==='127.0.0.1'||hostname==='0.0.0.0'||hostname==='[::1]'||
     /^[\d.]+$/u.test(hostname)||!hostname.includes('.')||
     !/^[a-z0-9.-]+$/u.test(hostname)||hostname.startsWith('.')||hostname.endsWith('.'))return null;
  return url.href;
 }catch{return null}
}
export function bindExistingCloudGuestExternalLinkOpener(
 bridge:{onOpenRequested?:(lease:string,callback:(url:string)=>void)=>()=>void},
 lease:string,
 active:()=>boolean,
 open:(url:string)=>void
):()=>void{
 if(!bridge?.onOpenRequested||typeof lease!=='string'||!lease)return()=>{};
 return bridge.onOpenRequested(lease,(raw)=>{
  if(!active())return;
  const href=verifiedCloudGuestExternalUrl(raw);
  if(href)open(href);
 });
}
