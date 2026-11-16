// KT third-party black-box adapter: use the owner's existing locally stored
// KT login session against KT's ORIGINAL production read-only repeat endpoint.
// No modifications to original KT, no DevTools, no OCR, no token logging,
// no token stored in Yance config. No chat-message sending functionality.
import {createRequire} from 'node:module';
import {mkdtempSync,readdirSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {maskNumber} from './kt-phone-normalize.mjs';
const require=createRequire(import.meta.url);
const {ClassicLevel}=require('classic-level');
const API='https://api.kt8899.org';
const TIMEOUT_MS=18000;
const validPhone=n=>typeof n==='string'&&/^\+[1-9]\d{7,14}$/.test(n);
function reject(reason){return {status:'unavailable',reason,canSend:false,freshQueryVerified:false}}
async function currentSession(){
 const profile=process.env.APPDATA;
 if(!profile)throw Error('KT_LOCAL_PROFILE_UNAVAILABLE');
 const live=join(profile,'electron-vue-vite','Local Storage','leveldb');

 if(!existsSync(live))throw Error('KT_SESSION_STORAGE_UNAVAILABLE');
 const snapshot=mkdtempSync(join(tmpdir(),'YENRA_KT_Transient_'));
 let db;let token=null;
 try{
  for(const file of readdirSync(live)){
   if(/^(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|log)|LOG(?:\.old)?)$/.test(file))
    copyFileSync(join(live,file),join(snapshot,file));
  }
  db=new ClassicLevel(snapshot,{createIfMissing:false,keyEncoding:'buffer',valueEncoding:'buffer'});
  await db.open();
  for await(const [key,value] of db.iterator()){
   const k=key.toString('utf8');
   if(!k.endsWith('token')||k.endsWith('adminToken')||k.length>500||value.length<8)continue;
   let decoded='';
   if(value[0]===1)decoded=value.subarray(1).toString('utf8');
   else if(value[0]===0)decoded=value.subarray(1).toString('utf16le');
   else decoded=value.toString('utf8');
   if(!/^[\w.~+\/=-]{8,4096}$/.test(decoded))continue;
   if(token!==null)throw Error('KT_SESSION_MULTIPLE_ACCOUNTS_UNVERIFIED');
   token=decoded;
  }
  if(token===null)throw Error('KT_SESSION_NOT_LOGGED_IN');
  return token;
 }finally{
  try{await db?.close()}catch{}
  try{rmSync(snapshot,{recursive:true,force:true,maxRetries:5,retryDelay:150})}
  catch{throw Error('KT_LOCAL_SESSION_SNAPSHOT_DELETE_FAILED')}
 }
}
function originalCount(data,expectedDigits){
 // Match KT's ACTUAL protocol: `repeat` lists duplicates, `data` lists
 // numbers that passed. Do not turn absence from both arrays into zero.
 if(!data||data.success!==true||(data.code!==undefined&&data.code!==200)||
    !Array.isArray(data.repeat)||!Array.isArray(data.data))
  throw Error('KT_ORIGINAL_RESPONSE_UNVERIFIED');
 if(data.repeat.some(x=>!Array.isArray(x)||String(x[0])!==expectedDigits)||
    data.data.some(x=>String(x)!==expectedDigits))
  throw Error('KT_ORIGINAL_MIXED_NUMBER_RESPONSE');
 if(data.repeat.length>1||data.data.length>1)
  throw Error('KT_ORIGINAL_RESPONSE_AMBIGUOUS');
 if(data.repeat.length===1){
  const count=data.repeat[0][1];
  if(!Number.isSafeInteger(count)||count<0||count>100000000)
   throw Error('KT_ORIGINAL_COUNT_INVALID');
  return count;
 }
 if(data.data.length===1)return 0;
 throw Error('KT_ORIGINAL_RESULT_UNKNOWN');
}
export function createKtDirectSessionAdapter({fetchFn=fetch,loadSession=currentSession,
 sleepFn=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 now=()=>Date.now(),sessionTtlMs=120000}={}){
 // One short-lived local login session, shared by manual checks. No token
 // is written to Yance storage or exposed to the renderer.
 let token=null,tokenExpiry=0,lastVerifiedAt=0;
 let queue=Promise.resolve(),waiting=0;
 const validToken=x=>typeof x==='string'&&/^[-.\w~+\/=]{8,4096}$/.test(x);
 async function session(force=false){
  if(!force&&token&&now()<tokenExpiry)return token;
  const latest=await loadSession();
  if(!validToken(latest))throw Error('KT_SESSION_NOT_LOGGED_IN');
  token=latest;tokenExpiry=now()+sessionTtlMs;
  return token;
 }
 function result(number,status,count,reason){
  return {status,repeatCount:count,masked:maskNumber(number),
   queriedPlatform:'whats',provenance:'KT_ORIGINAL_DIRECT_SESSION',
   sourcePlatforms:[],rule:null,freshQueryVerified:status!=='unknown'&&status!=='unavailable',
   canSend:false,...(reason?{reason}:{})};
 }
 async function requestChunk(numbers){
  const digits=numbers.map(n=>n.slice(1));
  let auth=await session();
  const url=new URL('/whatsFriend/filterRepeatFriend/0',API);
  if(url.origin!==API)throw Error('KT_CROSS_ORIGIN_REJECTED');
  for(let attempt=0;attempt<3;attempt++){
   let response;
   try{
    response=await fetchFn(url,{method:'POST',
     headers:{token:auth,Language:'zh',Accept:'application/json','Content-Type':'application/json'},
     redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS),body:JSON.stringify(digits)});
   }catch(e){
    if(attempt===2)throw Error('KT_ORIGINAL_NETWORK_UNAVAILABLE');
    await sleepFn(200*(attempt+1));
    continue;
   }
   if(response.status===401||response.status===403){
    token=null;tokenExpiry=0;
    if(attempt>=1)throw Error('KT_SESSION_EXPIRED');
    const refreshed=await session(true);
    if(refreshed===auth)throw Error('KT_SESSION_EXPIRED');
    auth=refreshed;
    continue;
   }
   if([429,500,502,503,504].includes(response.status)){
    if(attempt===2)throw Error('KT_ORIGINAL_HTTP_UNAVAILABLE');
    await sleepFn(300*(attempt+1));
    continue;
   }
   if(!response.ok)throw Error('KT_ORIGINAL_HTTP_UNAVAILABLE');
   const json=await response.json().catch(()=>null);
   if(json?.code===401||json?.code===403){
    token=null;tokenExpiry=0;
    if(attempt>=1)throw Error('KT_SESSION_EXPIRED');
    const refreshed=await session(true);
    if(refreshed===auth)throw Error('KT_SESSION_EXPIRED');
    auth=refreshed;continue;
   }
   if(!json||json.success!==true||(json.code!==undefined&&json.code!==200)||
      !Array.isArray(json.data)||!Array.isArray(json.repeat))
    throw Error('KT_ORIGINAL_RESPONSE_UNVERIFIED');
   const asked=new Set(digits),passed=new Set(),repeated=new Map();
   for(const d of json.data){
    const id=String(d);
    if(!asked.has(id)||passed.has(id))throw Error('KT_ORIGINAL_MIXED_NUMBER_RESPONSE');
    passed.add(id);
   }
   for(const item of json.repeat){
    if(!Array.isArray(item)||item.length<2)throw Error('KT_ORIGINAL_RESPONSE_UNVERIFIED');
    const id=String(item[0]),n=item[1];
    if(!asked.has(id)||repeated.has(id)||!Number.isSafeInteger(n)||n<0||n>100000000)
      throw Error('KT_ORIGINAL_MIXED_NUMBER_RESPONSE');
    repeated.set(id,n);
   }
   for(const id of passed){if(repeated.has(id))throw Error('KT_ORIGINAL_RESPONSE_AMBIGUOUS')}
   lastVerifiedAt=now();
   return numbers.map((number,i)=>{
    const id=digits[i];
    if(repeated.has(id)){
     const hits=repeated.get(id);
     return result(number,hits>0?'duplicate':'not_duplicate',hits);
    }
    if(passed.has(id))return result(number,'not_duplicate',0);
    return result(number,'unknown',null,'KT_ORIGINAL_RESULT_UNKNOWN');
   });
  }
  throw Error('KT_ORIGINAL_QUERY_FAILED');
 }
 async function runBatch(numbers){
  const resultList=[];
  for(let start=0;start<numbers.length;start+=1000){
   const group=await requestChunk(numbers.slice(start,start+1000));
   resultList.push(...group);
  }
  const sum=status=>resultList.filter(r=>r.status===status).length;
  return {ok:true,results:resultList,
   summary:{total:numbers.length,duplicate:sum('duplicate'),
    notDuplicate:sum('not_duplicate'),unknown:sum('unknown')},
   canSend:false,provenance:'KT_ORIGINAL_DIRECT_SESSION'};
 }
 function enqueue(job,failed){
  if(waiting>=64)return Promise.resolve(failed('KT_QUERY_QUEUE_FULL'));
  waiting++;
  const task=queue.then(job,job).catch(e=>{
   const m=String(e?.message||'');
   return failed(/^KT_[A-Z0-9_]{4,90}$/.test(m)?m:'KT_ORIGINAL_DIRECT_QUERY_FAILED');
  }).finally(()=>{waiting--});
  queue=task.then(()=>undefined,()=>undefined);
  return task;
 }
 async function checkBatch({numbers,vendorPlatform='whats',authorized=false}={}){
  if(!authorized)return {ok:false,...reject('KT_ORIGINAL_MID_NOT_VERIFIED')};
  if(vendorPlatform!=='whats')return {ok:false,...reject('KT_PLATFORM_UNSUPPORTED')};
  if(!Array.isArray(numbers)||numbers.length<1||numbers.length>10000||
     !numbers.every(validPhone))return {ok:false,...reject('KT_PHONE_INVALID')};
  return enqueue(()=>runBatch(numbers),
   reason=>({ok:false,...reject(reason)}));
 }
 async function check({number,vendorPlatform,authorized=false}={}){
  if(!authorized)return reject('KT_ORIGINAL_MID_NOT_VERIFIED');
  if(!validPhone(number))return reject('KT_PHONE_INVALID');
  if(vendorPlatform!=='whats')return reject('KT_PLATFORM_UNSUPPORTED');
  const out=await checkBatch({numbers:[number],vendorPlatform,authorized});
  if(!out.ok)return reject(out.reason||'KT_ORIGINAL_DIRECT_QUERY_FAILED');
  const item=out.results[0];
  if(item.status==='unknown')return reject('KT_ORIGINAL_RESULT_UNKNOWN');
  return item;
 }
 return Object.freeze({isDirectSession:true,isReadOnly:true,check,checkBatch,
  getStatus:()=>({configured:true,readOnly:true,sessionCached:!!token&&now()<tokenExpiry,
   connectionVerified:lastVerifiedAt>0&&now()-lastVerifiedAt<300000,
   lastVerifiedAt:lastVerifiedAt||null,activeAndQueued:waiting,canSend:false})});
}
