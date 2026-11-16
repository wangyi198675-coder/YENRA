export const inject=['connection','tools'];
const path='/api/yenra-typography';
const bounded=(value,n)=>typeof value==='string'&&value.length<=n;
export function cleanReport(raw){
  if(!raw||!bounded(raw.clientId,100)||!bounded(raw.version,30)||!Number.isInteger(raw.base)||raw.base<10||raw.base>22||!Array.isArray(raw.samples)||raw.samples.length>12)throw Error('Invalid typography report');
  const samples=raw.samples.map(s=>{
    if(!bounded(s.id,40)||!bounded(s.family,1200)||!bounded(s.lineHeight,40)||!Number.isFinite(s.size)||!Number.isFinite(s.expected)||typeof s.pass!=='boolean')throw Error('Invalid sample');
    return{id:s.id,size:s.size,expected:s.expected,family:s.family,lineHeight:s.lineHeight,pass:s.pass};
  });
  const result={clientId:raw.clientId,version:raw.version,base:raw.base,samples,missing:Array.isArray(raw.missing)?raw.missing.filter(v=>bounded(v,40)).slice(0,12):[],failures:samples.filter(s=>!s.pass).map(s=>s.id)};
  if(raw.requestId!==undefined){if(!bounded(raw.requestId,100))throw Error('Invalid request');result.requestId=raw.requestId;}
  if(raw.verification){const v=raw.verification;if(typeof v.passed!=='boolean'||typeof v.restored!=='boolean'||!bounded(v.message,1000))throw Error('Invalid verification');if(![v.originalSize,v.testSize].every(n=>Number.isInteger(n)&&n>=10&&n<=22))throw Error('Invalid test sizes');const ids=list=>Array.isArray(list)?list.filter(id=>bounded(id,40)).slice(0,12):[];result.verification={passed:v.passed,restored:v.restored,message:v.message,originalSize:v.originalSize,testSize:v.testSize,changed:ids(v.changed),unchanged:ids(v.unchanged)};}
  return result;
}
export function apply(ctx){
  const reports=new Map(),streams=new Map(),encoder=new TextEncoder();let stopped=false,pending=null,sequence=0;
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  ctx.connection.fetch.register({path:path+'/report',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    try{const text=await request.text();if(text.length>65536)return json({ok:false},413);const value=cleanReport(JSON.parse(text));reports.set(value.clientId,{...value,seenAt:Date.now()});if(reports.size>8)reports.delete(reports.keys().next().value);
      if(pending&&pending.id===value.requestId&&pending.clientId===value.clientId){const complete=pending;pending=null;clearTimeout(complete.timer);complete.resolve({ok:true,report:reports.get(value.clientId)});}return json({ok:true});
    }catch(error){return json({ok:false,message:String(error.message||error)},400);}
  }});
  ctx.connection.fetch.register({path:path+'/events',methods:['GET'],requestBody:'buffered',fetch:request=>{
    const id=new URL(request.url).searchParams.get('id');if(!id||id.length>100)return json({ok:false},400);
    let own,abort;
    const stream=new ReadableStream({start(controller){own=controller;streams.get(id)?.close();streams.set(id,controller);controller.enqueue(encoder.encode('data: {"kind":"ready"}\n\n'));abort=()=>{if(streams.get(id)===controller)streams.delete(id);try{controller.close();}catch{}};request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();},cancel(){if(streams.get(id)===own)streams.delete(id);request.signal.removeEventListener('abort',abort);}});
    return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-cache, no-transform'}});
  }});
  ctx.effect(()=>ctx.tools.register({name:'yenra_typography',description:'Inspect the connected YENRA page’s real font measurements. verify briefly changes the global text size by one step, checks visible contact/chat/AI roles, then restores it. Missing roles are reported, not counted as tested; no messages are read or sent.',parameters:{type:'object',properties:{action:{type:'string',enum:['status','verify']}},required:['action'],additionalProperties:false},output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async({action})=>{
    if(stopped)return{ok:false,message:'Typography plugin stopped'};
    if(action==='status')return{ok:true,clients:[...reports.values()]};
    if(action!=='verify')return{ok:false,message:'Unknown action'};
    if(pending)return{ok:false,message:'A verification is already running'};
    const candidates=[...reports.values()].filter(r=>streams.has(r.clientId)).sort((a,b)=>b.samples.length-a.samples.length||b.seenAt-a.seenAt),target=candidates[0];if(!target)return{ok:false,message:'No connected typography Client; refresh the current YENRA window'};
    const id='font-check-'+Date.now()+'-'+(++sequence);
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{if(pending?.id===id){pending=null;resolve({ok:false,message:'Client verification timed out; no successful check is claimed'});}},8000);
      pending={id,clientId:target.clientId,resolve,timer};
      try{streams.get(target.clientId).enqueue(encoder.encode('data: '+JSON.stringify({kind:'verify',requestId:id})+'\n\n'));}catch(error){clearTimeout(timer);pending=null;resolve({ok:false,message:String(error.message||error)});}
    });
  }}));
  ctx.effect(()=>()=>{stopped=true;if(pending){clearTimeout(pending.timer);pending.resolve({ok:false,message:'Plugin unloaded'});pending=null;}for(const c of streams.values()){try{c.close();}catch{}}streams.clear();reports.clear();});
}
