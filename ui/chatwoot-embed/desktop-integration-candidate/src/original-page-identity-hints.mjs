// Page identity hints in the EXISTING official DSH Storage Domain.
// Not an authorization source, provider client, message cache, Sender or scheduler.
// Original SDK and current protected DPAPI scope are required on every use.
const MAX_ROWS=500,MAX_AGE_MS=30*86400000,MAX_FUTURE_MS=300000;
const refPattern=/^[a-f0-9]{32}$/;
const providerId=/^[a-z0-9_.:~-]{1,240}$/i;
function checkedRow(row,page,revision){
 if(!row||typeof row!=='object'||Array.isArray(row)||
   row.pageId!==page.pageId||row.accountName!==page.accountName||
   String(row.bindingRevision)!==String(revision)||
   row.channel!=='FB_PAGE'||row.source!=='PANCAKE_OFFICIAL_READ_ONLY'||
   row.canSend!==false||row.readOnly!==true||
   typeof row.roomId!=='string'||row.roomId.length>300||
   typeof row.conversationId!=='string'||!providerId.test(row.conversationId)||
   typeof row.customerFromId!=='string'||row.customerFromId.length>120||
   typeof row.displayName!=='string'||row.displayName.length>150)return null;
 if(row.roomId!=='page:'+page.pageId+':'+encodeURIComponent(row.conversationId))
   return null;
 return {
  roomId:row.roomId,conversationId:row.conversationId,
  customerFromId:row.customerFromId,displayName:row.displayName,
  pageId:page.pageId,accountName:page.accountName,
  bindingRevision:String(revision),channel:'FB_PAGE',
  source:'PANCAKE_OFFICIAL_READ_ONLY',canSend:false,readOnly:true,
  lastMessageTimestamp:Number.isFinite(row.lastMessageTimestamp)&&row.lastMessageTimestamp>0?
    row.lastMessageTimestamp:0
 };
}
export function createOriginalPageIdentityHints({openTable,refOf,sha,now=Date.now}){
 if(typeof openTable!=='function'||typeof refOf!=='function'||typeof sha!=='function')
  throw Error('ORIGINAL_PAGE_HINT_ADAPTER_INVALID');
 const mem=new Map();
 function pageOf(scope,ref){
  if(!refPattern.test(ref)||!Number.isSafeInteger(scope?.revision)||
     !Array.isArray(scope?.pages)||scope.pages.length>24)return null;
  const pages=scope.pages.filter(p=>refOf(p,scope.revision)===ref);
  return pages.length===1?pages[0]:null;
 }
 function validate(data,page,scope,ref){
  if(!data||data.accountRef!==ref||data.accountName!==page.accountName||
     data.pageId!==page.pageId||data.revision!==scope.revision||
     !Number.isSafeInteger(data.savedAt)||data.savedAt>now()+MAX_FUTURE_MS||
     now()-data.savedAt>MAX_AGE_MS||
     !Array.isArray(data.rows)||!data.rows.length||data.rows.length>MAX_ROWS)
    return null;
  const rows=[],seen=new Set();
  for(const original of data.rows){
   const checked=checkedRow(original,page,scope.revision);
   if(!checked||seen.has(checked.roomId))return null;
   rows.push(checked);seen.add(checked.roomId);
  }
  return {accountRef:ref,pageId:page.pageId,accountName:page.accountName,
   revision:scope.revision,savedAt:data.savedAt,rows};
 }
 async function get(scope,ref){
  const page=pageOf(scope,ref);if(!page)return null;
  const hit=validate(mem.get(ref),page,scope,ref);
  if(hit)return hit;
  mem.delete(ref);
  try{
   const table=await openTable();
   const stored=validate(table.get(ref),page,scope,ref);
   if(stored)mem.set(ref,stored);
   return stored;
  }catch{return null}
 }
 function find(scope,room){
  if(typeof room!=='string')return null;
  for(const page of scope?.pages??[]){
   const ref=refOf(page,scope.revision);
   const cached=validate(mem.get(ref),page,scope,ref);
   if(!cached)continue;
   const matches=cached.rows.filter(row=>row.roomId===room);
   if(matches.length===1)return matches[0];
  }
  return null;
 }
 async function byOpaqueRef(scope,ref,roomRef){
  if(!refPattern.test(roomRef))return null;
  const snapshot=await get(scope,ref);if(!snapshot)return null;
  const matches=snapshot.rows.filter(row=>sha(ref+'\0'+row.roomId)===roomRef);
  return matches.length===1?matches[0]:null;
 }
 async function snapshotForScope(scope){
  if(!Number.isSafeInteger(scope?.revision)||!Array.isArray(scope?.pages)||
     scope.pages.length<1||scope.pages.length>24)return [];
  const records=[];
  for(const page of scope.pages){
   const ref=refOf(page,scope.revision);
   const hit=await get(scope,ref);
   if(hit)records.push(hit);
  }
  return records;
 }
 async function save(scope,page,account,rows){
  if(account?.partial!==false||!Number.isSafeInteger(scope?.revision)||
     !Array.isArray(scope?.pages)||scope.pages.length>24||
     !scope.pages.some(p=>p.pageId===page.pageId&&p.accountName===page.accountName)||
     !Array.isArray(rows)||rows.length<1||rows.length>MAX_ROWS)return false;
  const accountRef=refOf(page,scope.revision);
  if(account?.accountRef!==accountRef)return false;
  const prepared=rows.map(row=>checkedRow({...row,readOnly:true},page,scope.revision));
  if(prepared.some(row=>!row)||new Set(prepared.map(row=>row.roomId)).size!==prepared.length)
   return false;
  const data={accountRef,pageId:page.pageId,accountName:page.accountName,
   revision:scope.revision,savedAt:now(),rows:prepared};
  try{
   const table=await openTable();
   await table.put(accountRef,data);
   mem.set(accountRef,data);
   return true;
  }catch{return false}
 }
 function clear(){mem.clear()}
 return {get,find,byOpaqueRef,snapshotForScope,save,clear};
}
