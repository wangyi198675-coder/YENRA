import { z } from 'zod';
import { DEFAULT_STATE, PALETTES, VERSION, DOMAIN_NAME } from './core-v111.js';
import { createStateStore } from './store-v111.js';
export const inject=['storageDomain','connection','tools'];
const ids=PALETTES.map(p=>p.id),Id=z.enum(ids),Mode=z.enum(['light','dark','system']);
const Basic=z.object({enabled:z.boolean(),day:Id,night:Id,mode:Mode}).strict();
const State=Basic.extend({version:z.literal(2),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),favourites:z.array(Id).max(4),baseline:Basic.nullable()}).strict().refine(s=>PALETTES.find(p=>p.id===s.day)?.scheme==='light'&&PALETTES.find(p=>p.id===s.night)?.scheme==='dark','Invalid day/night pair');
const Request=z.object({action:z.enum(['get','status','select','commit','restore','disable','favourite','mode']),id:Id.optional(),enabled:z.boolean().optional(),mode:Mode.optional(),previousMode:Mode.optional(),expectedRevision:z.number().int().nonnegative().optional()}).strict();
const Diagnostic=z.object({clientId:z.string().min(1).max(100),version:z.string().max(30),revision:z.number().int().nonnegative(),preference:z.string().max(100),scheme:z.enum(['light','dark']),enabled:z.boolean(),mismatches:z.array(z.string().max(120)).max(100),fontSize:z.number(),error:z.string().max(500).optional()}).strict();
const path='/api/yenra-private-themes';
export async function apply(ctx) {
  const domain=await ctx.storageDomain.open({name:DOMAIN_NAME,version:1,global:{schema:State,initial:structuredClone(DEFAULT_STATE)},tables:{}});
  const store=createStateStore({read:()=>domain.global.get(),write:value=>domain.global.set(value),validate:value=>State.parse(value)});
  const reports=new Map(),streams=new Set(),encoder=new TextEncoder();
  let stopped=false;
  const send=(controller,value)=>{try{controller.enqueue(encoder.encode('data: '+JSON.stringify(value)+'\n\n'));}catch{streams.delete(controller);}};
  const current=()=>State.parse(domain.global.get());
  const operate=async raw=>{
    const parsed=Request.safeParse(raw);
    if(!parsed.success) return {ok:false,code:'invalid',message:parsed.error.message};
    if(parsed.data.action==='status') return {ok:true,version:VERSION,state:current(),clients:[...reports.values()].filter(r=>Date.now()-r.seenAt<120000)};
    return store.operate(parsed.data);
  };
  ctx.on('domain/changed',change=>{
    if(change.domain===domain.name && change.table==='' && change.operation==='put') for(const c of streams) send(c,{ok:true,version:VERSION,state:change.value});
  });
  ctx.effect(()=>()=>{
    stopped=true;
    for(const c of streams){try{c.close();}catch{}}
    streams.clear();reports.clear();
    return store.close().then(()=>domain.close());
  });
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  // These exact routes are admitted by Connection's existing authenticated owner /api carrier.
  ctx.connection.fetch.register({path,methods:['GET','POST'],requestBody:'buffered',fetch:async request=>{
    if(stopped) return json({ok:false,code:'closed'},503);
    if(request.method==='GET') return json(await operate({action:'status'}));
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ok:false,code:'content-type'},415);
    let raw;
    try{const text=await request.text();if(text.length>8192)return json({ok:false,code:'too-large'},413);raw=JSON.parse(text);}catch{return json({ok:false,code:'invalid-json'},400);}
    const result=await operate(raw);
    return json(result,result.ok?200:result.code==='conflict'?409:400);
  }});
  ctx.connection.fetch.register({path:path+'/diagnostic',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    let value;try{const text=await request.text();if(text.length>8192)return json({ok:false},413);value=Diagnostic.safeParse(JSON.parse(text));}catch{return json({ok:false},400);}
    if(!value.success)return json({ok:false},400);
    const {clientId,...data}=value.data;
    if(!reports.has(clientId)&&reports.size>=8)reports.delete(reports.keys().next().value);
    reports.set(clientId,{...data,clientId,seenAt:Date.now()});return json({ok:true});
  }});
  ctx.connection.fetch.register({path:path+'/events',methods:['GET'],requestBody:'buffered',fetch:request=>{
    if(stopped)return json({ok:false},503);
    let own,abort;
    const stream=new ReadableStream({start(controller){
      own=controller;streams.add(controller);
      send(controller,{ok:true,version:VERSION,state:current()});
      abort=()=>{streams.delete(controller);try{controller.close();}catch{}};
      request.signal.addEventListener('abort',abort,{once:true});
      if(request.signal.aborted)abort();
    },cancel(){streams.delete(own);request.signal.removeEventListener('abort',abort);}});
    return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','x-accel-buffering':'no'}});
  }});
  ctx.effect(()=>ctx.tools.register({
    name:'yenra_private_themes',
    description:'Read, trial, save or undo the owner’s private day/night themes. status includes recent Client token diagnostics, not a screenshot. Changes affect this profile’s connected windows. select starts a reversible trial; commit keeps it; restore undoes this trial; disable returns to the host appearance. Theme ids: atelier-ivory, atelier-porcelain (day), atelier-obsidian, atelier-dusk (night).',
    parameters:{type:'object',properties:{action:{type:'string',enum:['get','status','select','commit','restore','disable','favourite','mode']},id:{type:'string',enum:ids,description:'Required by select and favourite.'},enabled:{type:'boolean',description:'Required by favourite; exact desired mark, not toggle.'},mode:{type:'string',enum:['light','dark','system'],description:'Required by mode.'},previousMode:{type:'string',enum:['light','dark','system'],description:'With select, appearance before the first trial.'},expectedRevision:{type:'integer',description:'Revision from get/status; stale writes return conflict.'}},required:['action'],additionalProperties:false},
    output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async args=>operate(args)
  }));
}
