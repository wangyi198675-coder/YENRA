/**
 * Discover the already-running YENRA/DSH Host on THIS Windows computer.
 * Only loopback listeners owned by the official YENRA executable or the
 * original DSH Electron host can be considered. GET /api/yenra/oss-roster
 * is an existing read endpoint; no auth bypass, second Host or Sender.
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execAsync=promisify(execFile);
const validPort=x=>Number.isInteger(x)&&x>=1024&&x<=65535;
const VALID_ACCOUNT=/^[a-f0-9]{32}$/i;

export async function windowsYenraHostPorts(){
 if(process.platform!=='win32')return [];
 const script=[
  "$ErrorActionPreference='Stop';",
  "$p=@(Get-CimInstance Win32_Process | Where-Object {",
  " ($_.Name -ieq 'YENRA.exe' -and $_.ExecutablePath -like '*\\Programs\\YENRA\\*') -or",
  " ($_.Name -ieq 'electron.exe' -and $_.CommandLine -like '*dsh-desktop-host*' -and $_.CommandLine -like '*profiles*desktop*')",
  " } | Select-Object -ExpandProperty ProcessId);" ,
  "if(-not $p){exit 3};",
  "$l=Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {",
  " $_.OwningProcess -in $p -and $_.LocalAddress -in @('127.0.0.1','::1') -and $_.LocalPort -gt 1023",
  " } | Select-Object -ExpandProperty LocalPort -Unique;",
  "$l | Sort-Object",
 ].join(' ');
 try{
  const {stdout}=await execAsync('powershell.exe',
   ['-NoProfile','-NonInteractive','-Command',script],
   {windowsHide:true,timeout:9000,maxBuffer:2048});
  return [...new Set(stdout.split(/\s+/).map(Number).filter(validPort))].slice(0,40);
 }catch{return []}
}

export async function resolveFriendHostBaseUrl({
 ports,portProvider=windowsYenraHostPorts,fetchImpl=globalThis.fetch,
}={}){
 if(typeof fetchImpl!=='function')throw Error('FRIEND_HOST_FETCH_REQUIRED');
 const listed=ports??await portProvider();
 if(!Array.isArray(listed)||listed.length>40||listed.some(x=>!validPort(x)))
  throw Error('FRIEND_HOST_CANDIDATES_INVALID');
 const found=[];
 for(const port of new Set(listed)){
  const url='http://127.0.0.1:'+port+'/api/yenra/oss-roster';
  try{
   const response=await fetchImpl(url,{
    method:'GET',redirect:'error',
    headers:{accept:'application/json'},
    signal:AbortSignal.timeout(1400),
   });
   if(!response.ok||!(response.headers?.get?.('content-type')??'').includes('application/json'))continue;
   const payload=await response.json();
   const accounts=payload?.roster?.accounts??payload?.accounts;
   if(payload?.ok!==true||!Array.isArray(accounts)||!accounts.some(
    a=>a.channel==='WhatsApp'&&VALID_ACCOUNT.test(a.accountRef)
   ))continue;
   found.push(port);
  }catch{/* port does not expose a verified original Host */ }
 }
 if(found.length===0)throw Error('FRIEND_ORIGINAL_DSH_HOST_UNAVAILABLE');
 if(found.length!==1)throw Error('FRIEND_ORIGINAL_DSH_HOST_AMBIGUOUS');
 return 'http://127.0.0.1:'+found[0];
}
