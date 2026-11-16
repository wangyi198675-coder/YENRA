export const inject=['connection','tools'];
const short=(v,n)=>typeof v==='string'&&v.length<=n;
export function clean(raw){
 if(!raw||!short(raw.clientId,100)||!short(raw.version,30)||typeof raw.nativeWindows!=='boolean'||typeof raw.mergedCloud!=='boolean'||!short(raw.captionFill,120)||!short(raw.headerFill,120)||!short(raw.contactsState,80)||typeof raw.contactsEnabled!=='boolean')throw Error('Invalid display report');
 return{clientId:raw.clientId,version:raw.version,nativeWindows:raw.nativeWindows,mergedCloud:raw.mergedCloud,captionFill:raw.captionFill,headerFill:raw.headerFill,sameFill:raw.captionFill===raw.headerFill,contactsState:raw.contactsState,contactsEnabled:raw.contactsEnabled,contactsAgeMs:Number.isFinite(raw.contactsAgeMs)?Math.max(0,Math.min(86400000,raw.contactsAgeMs)):86400000};
}
export function apply(ctx){
 const reports=new Map();let stopped=false;
 ctx.connection.fetch.register({path:'/api/yenra-personal-chrome/report',methods:['POST'],requestBody:'buffered',fetch:async request=>{
  try{const text=await request.text();if(text.length>8192)return new Response('',{status:413});const value=clean(JSON.parse(text));reports.set(value.clientId,{...value,seenAt:Date.now()});if(reports.size>8)reports.delete(reports.keys().next().value);return Response.json({ok:true});}catch{return Response.json({ok:false},{status:400});}
 }});
 ctx.effect(()=>ctx.tools.register({name:'yenra_personal_chrome',description:'Read real connected-page diagnostics for YENRA’s personal contact header and native caption color source. Reports missing/inactive regions and report ages; does not change filters, read messages or control windows.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async()=>({ok:!stopped,clients:[...reports.values()]})}));
 ctx.effect(()=>()=>{stopped=true;reports.clear();});
}
