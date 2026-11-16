/**
 * Native YENRA *display-only* roster snapshot.
 * The mature authorized Matrix/Pancake/DSH-IM Host remains the single identity,
 * live message and Sender authority. Official DSH Storage Domain stores only
 * previously verified non-secret contact display refs/names/last-text, so a
 * transient Page 429 or program restart never erases the account from UI.
 * No custom DB, no new login/Socket/server/Agent/approval flow.
 */
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-storage-domain';
import {defineDomain,domainTable} from '../../../upstream/official-source/packages/storage/storage-domain/src/spec.ts';
import {z} from '../../../upstream/official-source/packages/storage/storage-domain/node_modules/zod/index.js';
import {readExistingFacebookRosterForOss,restoreVerifiedCachedPagePrefsFromW25,restoreVerifiedCachedPagePreviewsFromW25,readVerifiedHistoricalPagePreviewSources} from './facebook-social-commands.ts';
import type {CachedPagePreviewReader} from './translation-commands.ts';
import {readExistingFacebookContactPrefsSnapshotForRoster} from './facebook-contact-prefs-commands.ts';
import {readExistingWhatsAppRosterForOss} from './social-readonly-commands.ts';
import {applyWhatsAppLocalContactPrefs,type WhatsAppPrefsTiming} from './whatsapp-contact-prefs-commands.ts';

const REF=/^[a-f0-9]{32}$/;
const room=z.object({
  roomRef:z.string().regex(REF),name:z.string().nullable(),nameKnown:z.boolean(),
  contactOrigin:z.enum(['local_only','existing_chat']).optional(),localNameSaved:z.boolean().optional(),
  phoneFallback:z.string().regex(/^\+\d{5,15}$/).optional(),
  lastMessageAt:z.number().nullable(),latestText:z.string().nullable(),
  latestMessageId:z.string().max(180).optional(),latestMessageSource:z.string().max(1200).optional(),
  messageCount:z.number().optional(),providerPeerKind:z.string().optional(),
  contactPreferences:z.object({pinned:z.boolean(),muted:z.boolean(),
    archived:z.boolean(),manualUnread:z.boolean()}).optional(),
});
const account=z.object({
  channel:z.enum(['Personal','Page','WhatsApp']),
  accountRef:z.string().regex(REF),
  displayId:z.string().regex(REF).optional(),
  accountLabel:z.string().max(110).optional(),
  source:z.string(),rooms:z.array(room),mediaSendSupported:z.boolean().optional(),
  readOnly:z.literal(true),canSend:z.literal(false),
  updatedAt:z.string().nullable().optional(),
});
type Account=z.infer<typeof account>;
const snapshot=z.object({
  updatedAt:z.string(),accounts:z.array(account),failures:z.array(z.string()),
});
const spec=defineDomain({name:'yenra_social_display',version:1,
  layout:'per-record',invalidRecords:'backup-and-skip',
  tables:{entries:domainTable(snapshot)},
});
function checkLocal(req:any):boolean{
  const addr=String(req.socket?.remoteAddress??'');
  if(addr&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr))return false;
  const site=String(req.headers?.['sec-fetch-site']??'');
  if(site&&!['same-origin','none'].includes(site))return false;
  const origin=String(req.headers?.origin??'');
  if(!origin||origin==='null'||origin==='dsh-app://app')return true;
  try{
    const host=String(req.headers?.host??'').toLowerCase(),url=new URL(origin);
    return ['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)&&
      url.host.toLowerCase()===host;
  }catch{return false}
}
function cleanAccount(value:unknown):Account|null{
  if(!value||typeof value!=='object')return null;
  const raw=value as any;
  if(!['Personal','Page','WhatsApp'].includes(raw.channel)||!REF.test(raw.accountRef)||
    !Array.isArray(raw.rooms)||raw.rooms.length>800)return null;
  const rooms=raw.rooms.filter((r:any)=>r&&REF.test(r.roomRef)).map((r:any)=>({
    roomRef:r.roomRef,
    name:typeof r.name==='string'?r.name.slice(0,120):null,
    nameKnown:typeof r.nameKnown==='boolean'?r.nameKnown:false,
    ...(raw.channel==='WhatsApp'&&['local_only','existing_chat'].includes(r.contactOrigin)?{contactOrigin:r.contactOrigin}:{}),
    ...(raw.channel==='WhatsApp'&&r.localNameSaved===true?{localNameSaved:true}:{}),
    ...(raw.channel==='WhatsApp'&&typeof r.phoneFallback==='string'&&
      /^\+\d{5,15}$/.test(r.phoneFallback)?{phoneFallback:r.phoneFallback}:{}),
    lastMessageAt:Number.isFinite(r.lastMessageAt)?r.lastMessageAt:null,
    latestText:typeof r.latestText==='string'?r.latestText.slice(0,240):null,
    ...(raw.channel==='WhatsApp'&&typeof r.latestMessageId==='string'&&
      r.latestMessageId.length<=180&&typeof r.latestMessageSource==='string'&&
      r.latestMessageSource.length<=1200&&r.latestMessageSource.trim()
       ?{latestMessageId:r.latestMessageId,latestMessageSource:r.latestMessageSource}:{}),
    messageCount:Number.isSafeInteger(r.messageCount)?r.messageCount:0,
    providerPeerKind:typeof r.providerPeerKind==='string'?r.providerPeerKind.slice(0,40):'unknown',
    ...(r.contactPreferences&&typeof r.contactPreferences==='object'&&!Array.isArray(r.contactPreferences)
      ?{contactPreferences:{
        pinned:r.contactPreferences.pinned===true,muted:r.contactPreferences.muted===true,
        archived:r.contactPreferences.archived===true,manualUnread:r.contactPreferences.manualUnread===true,
      }}:{}),
  }));
  return {
    channel:raw.channel,accountRef:raw.accountRef,
    ...(REF.test(raw.displayId)?{displayId:raw.displayId}:{}),
    ...(typeof raw.accountLabel==='string'&&raw.accountLabel.length<=110&&raw.channel==='Page'
      ?{accountLabel:raw.accountLabel}:{}),
    source:raw.channel==='WhatsApp'?'DSH_IM_EXISTING_INBOX':'YENRA_FB_OFFICIAL',
    rooms,readOnly:true,canSend:false,
    ...(raw.channel==='WhatsApp'?{mediaSendSupported:raw.mediaSendSupported===true}:{}),
    updatedAt:
      typeof raw.updatedAt==='string'?raw.updatedAt:null,
  };
}
const accountKey=(a:Account)=>a.displayId??a.accountRef;
function project(data:z.infer<typeof snapshot>|null,refreshing:boolean){
  return {schema:1,source:'YENRA_AGGREGATED_NATIVE',
    readOnly:true,canSend:false,partial:Boolean(data?.failures.length),
    configuredBotCount:data?.accounts.filter(a=>a.channel==='WhatsApp').length??0,
    accounts:data?.accounts??[],lastVerifiedAt:data?.updatedAt??null,
    refreshing,failures:data?.failures??[],
  };
}
async function withLocalWhatsAppPrefs(
  ctx:Context,view:ReturnType<typeof project>,timing?:WhatsAppPrefsTiming,
){
  // Exact current DSH Storage Domain snapshot only: no Page W25 or SDK on GET.
  const enriched=view;
  // A transient preferences read error must NEVER make the actual verified
  // WhatsApp/FB roster disappear or block the social workbench.
  try{return {...enriched,accounts:await applyWhatsAppLocalContactPrefs(ctx,enriched.accounts,timing)}}
  catch{return enriched}
}
export function registerOssDisplayRoster(ctx:Context,readCachedPagePreview:CachedPagePreviewReader):void{
  let storePromise:Promise<any>|undefined;
  let refreshPromise:Promise<z.infer<typeof snapshot>>|null=null;
  let whatsappRefreshPromise:Promise<z.infer<typeof snapshot>>|null=null;
  let originalDshIm:unknown=null;
  ctx.inject(['dshIm'],scope=>scope.effect(()=>{
    originalDshIm=(scope as unknown as {dshIm:unknown}).dshIm;
    return()=>{originalDshIm=null};
  },'YENRA read-only original DSH-IM roster service binding'));
  const open=()=>{
    if(!storePromise){
      const native=ctx.get('storageDomain');
      if(!native)throw Error('OFFICIAL_DSH_STORAGE_DOMAIN_NOT_AVAILABLE');
      storePromise=native.open(spec);
      void storePromise.catch(()=>{storePromise=undefined});
    }
    return storePromise;
  };
  const read=async()=>{
    const record=(await open()).table('entries').get('last-verified');
    return record? snapshot.parse(record):null;
  };
  // Serialize writes to the SAME official DSH Storage Domain record; a
  // provider refresh must not overwrite a newer verified SSE/Page event.
  // This is not another database, provider request, or message history.
  let lastDisplayWrite:Promise<unknown>=Promise.resolve();
  const updateDisplay=(modify:(current:z.infer<typeof snapshot>|null)=>
      z.infer<typeof snapshot>|null)=>{
    const job=lastDisplayWrite.catch(()=>undefined).then(async()=>{
      const domain=await open();
      const table=domain.table('entries');
      const raw=table.get('last-verified');
      const current=raw?snapshot.parse(raw):null;
      const next=modify(current);
      if(next)await table.put('last-verified',next);
      return next;
    });
    lastDisplayWrite=job.then(()=>undefined,()=>undefined);
    return job;
  };
  const keepLatestVerifiedPage=(next:z.infer<typeof snapshot>,
      current:z.infer<typeof snapshot>|null)=>{
    if(!current)return next;
    const incoming=new Map(next.accounts.map(a=>[accountKey(a),a]));
    for(const old of current.accounts){
      const oldKey=accountKey(old);
      // A verified first Page event has accountRef, but the mature Page roster
      // later supplies the stable displayId. Match the SAME original account
      // by trusted accountRef rather than displaying it as two Page accounts.
      const updatedKey=incoming.has(oldKey)?oldKey:
        old.channel==='Page'
          ?[...incoming.entries()].find(([,value])=>
              value.channel==='Page'&&value.accountRef===old.accountRef)?.[0]
          :undefined;
      const updated=updatedKey===undefined?undefined:incoming.get(updatedKey);
      // Preserve a Page first observed through an independently verified
      // native event while a slow provider roster fetch was in flight.
      if(!updated){incoming.set(oldKey,old);continue}
      if(updated.channel!=='Page'||old.channel!=='Page'||
          updated.accountRef!==old.accountRef)continue;
      const currentRooms=new Map(updated.rooms.map(r=>[r.roomRef,r]));
      for(const earlier of old.rooms){
        const fresh=currentRooms.get(earlier.roomRef);
        if(!fresh){currentRooms.set(earlier.roomRef,earlier);continue}
        if((earlier.lastMessageAt??0)>(fresh.lastMessageAt??0)||
           (earlier.lastMessageAt===fresh.lastMessageAt&&
            !fresh.latestText&&Boolean(earlier.latestText))){
          currentRooms.set(earlier.roomRef,{
            ...fresh,lastMessageAt:earlier.lastMessageAt,latestText:earlier.latestText
          });
        }
      }
      incoming.set(accountKey(updated),{...updated,rooms:[...currentRooms.values()]});
    }
    return {...next,accounts:[...incoming.values()]};
  };
  // The SAME authenticated original Page event bus already verifies:
  // signed Pancake + provider GET, or SendPulse REST + W25 Page/PSID.
  // Persist its display-only preview even while Work hides the inbox SSE.
  ctx.effect(()=>ctx.on('yenra/page-verified-inbound' as any,(raw:unknown)=>{
    if(!raw||typeof raw!=='object')return;
    const row=raw as Record<string,unknown>;
    if(row.channel!=='Page'||row.direction!=='INBOUND'||
       !['ORIGINAL_SIGNED_PANCAKE_AND_PROVIDER_GET',
         'SENDPULSE_OFFICIAL_REST_API_VERIFIED'].includes(String(row.source))||
       typeof row.accountRef!=='string'||!REF.test(row.accountRef)||
       typeof row.roomRef!=='string'||!REF.test(row.roomRef)||
       typeof row.mid!=='string'||row.mid.length<5||row.mid.length>180||
       typeof row.text!=='string'||!row.text.trim()||row.text.length>4000||
       typeof row.timestamp!=='number'||!Number.isFinite(row.timestamp)||
       row.timestamp<1262304000000||row.timestamp>Date.now()+300000)return;
    void updateDisplay(current=>{
      // The first genuine inbound can arrive before the first full roster
      // refresh (and while Work does not mount the inbox SSE). The original
      // Host has ALREADY verified this account and room at the provider.
      // Seed only display refs in the same DSH Domain, never a new message DB.
      const before=current??{updatedAt:new Date(0).toISOString(),accounts:[],failures:[]};
      let changed=false,matchedAccount=false;
      const accounts=before.accounts.map(account=>{
        if(account.channel!=='Page'||account.accountRef!==row.accountRef)return account;
        matchedAccount=true;
        const rooms=account.rooms.slice();
        const index=rooms.findIndex(room=>room.roomRef===row.roomRef);
        if(index>=0){
          const old=rooms[index];
          if(row.timestamp<(old.lastMessageAt??0))return account;
          if(row.timestamp===old.lastMessageAt&&old.latestText===row.text.slice(0,240))
            return account;
          rooms[index]={...old,lastMessageAt:row.timestamp,latestText:row.text.slice(0,240)};
        }else{
          // An original provider-verified first-time Page conversation may
          // exist before the slow full provider roster finishes.
          if(rooms.length>=800)return account;
          const name=typeof row.name==='string'&&row.name.trim()
            ?row.name.slice(0,110):null;
          rooms.unshift({roomRef:row.roomRef,name,nameKnown:!!name,
            lastMessageAt:row.timestamp,latestText:row.text.slice(0,240)});
        }
        changed=true;
        return {...account,rooms};
      });
      if(!matchedAccount){
        // First authorized Page message before a roster snapshot exists.
        // Only original provider-verified events reach this branch.
        const name=typeof row.name==='string'&&row.name.trim()
          ?row.name.slice(0,110):null;
        accounts.push({channel:'Page',accountRef:row.accountRef,
          source:'YENRA_FB_OFFICIAL',rooms:[{roomRef:row.roomRef,
            name,nameKnown:!!name,lastMessageAt:row.timestamp,
            latestText:row.text.slice(0,240)}],readOnly:true,canSend:false,
          updatedAt:new Date().toISOString()});
        changed=true;
      }
      return changed?{...before,updatedAt:new Date().toISOString(),accounts}:null;
    }).catch(()=>{/* Original Domain availability never interrupts Sender */});
  }),'YENRA verified Page preview in existing official DSH Storage Domain');
  async function refresh(forcePageSource=false){
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{
      const previous=await read();
      const latest=new Map<string,Account>(
        (previous?.accounts??[]).map(a=>[accountKey(a),a]));
      const errors:string[]=[];
      // ONE bounded original Matrix read is shared by current Facebook roster
      // and W25-only Page recovery if the provider is temporarily unavailable.
      const matrixSnapshot=readExistingFacebookContactPrefsSnapshotForRoster().catch(()=>null);
      // Cordis services are injectable, not necessarily properties on the
      // plugin's original root context. Read the existing official service,
      // never create or reconnect a second WhatsApp account/Socket.
      const existingIm=originalDshIm ?? (ctx as unknown as {dshIm?:any}).dshIm ??
        (ctx as unknown as {get:(name:string)=>unknown}).get('dshIm');
      const results=await Promise.allSettled([
        readExistingFacebookRosterForOss(matrixSnapshot,forcePageSource),
        existingIm?readExistingWhatsAppRosterForOss(existingIm):Promise.reject(Error('DSH_IM_TEMPORARILY_UNAVAILABLE')),
      ]);
      for(let i=0;i<results.length;i++){
        const result=results[i];
        if(result.status!=='fulfilled'){errors.push(i===0?'FACEBOOK_TEMPORARILY_UNAVAILABLE':'WHATSAPP_TEMPORARILY_UNAVAILABLE');continue;}
        const data=result.value;
        for(const row of data.accounts??[]){
          const verified=cleanAccount(row);
          if(!verified)continue;
          // A temporarily unavailable Matrix read must not erase previously
          // verified flags from this official DSH display snapshot.
          const older=latest.get(accountKey(verified))??
            (verified.channel==='Page'
              ?[...latest.values()].find(previous=>
                  previous.channel==='Page'&&previous.accountRef===verified.accountRef)
              :undefined);
          if(older){
            const byRoom=new Map(older.rooms.map(r=>[r.roomRef,r.contactPreferences] as const));
            for(const room of verified.rooms){
              if(!room.contactPreferences&&byRoom.has(room.roomRef))
                room.contactPreferences=byRoom.get(room.roomRef);
            }
          }
          // W25 is read ONLY while the existing provider refresh is already
          // running, never in a cached roster GET or room-open path. Reuse the
          // original verified identity, message text, MID and timestamp checks.
          // Its result is persisted in the SAME DSH display Domain snapshot.
          const display=verified.channel==='Page'
            ?await restoreVerifiedCachedPagePreviewsFromW25(verified):verified;
          if(display.channel==='Page')for(const [key,olderAlias] of latest){
            // The first inbound may have been stored before the provider
            // returned its stable displayId. Keep only the provider's
            // canonical account key when both refs identify the SAME Page.
            if(key!==accountKey(display)&&olderAlias.channel==='Page'&&
               olderAlias.accountRef===display.accountRef)latest.delete(key);
          }
          latest.set(accountKey(display),display);
        }
        if('failures' in data&&Array.isArray(data.failures))
          errors.push(...data.failures.map(String));
      }
      // Do not let a temporary provider 429 conceal previously saved Page
      // archived/pinned/unread flags. Use current DPAPI identity and existing
      // W25 verified index to map the ONE Matrix snapshot onto cached refs.
      // No Page SDK request, new roster, sender, background job or database.
      if(errors.some(e=>e.startsWith('Page_')||e==='FACEBOOK_TEMPORARILY_UNAVAILABLE')){
        const matrix=await matrixSnapshot;
        if(matrix)for(const value of latest.values()){
          if(value.channel==='Page')
            await restoreVerifiedCachedPagePrefsFromW25(value,matrix);
        }
      }
      const updated={updatedAt:new Date().toISOString(),accounts:[...latest.values()],failures:errors};
      return await updateDisplay(current=>keepLatestVerifiedPage(updated,current))??updated;
    })().finally(()=>{refreshPromise=null});
    return refreshPromise;
  }

  // Existing DSH Storage Domain, scoped to the already authorized original
  // WhatsApp inboxes. Reuse this exact route when a cached LID roster needs
  // fresh display names/phone labels, without reading Facebook Page at all.
  async function refreshWhatsAppOnly(){
    if(whatsappRefreshPromise)return whatsappRefreshPromise;
    whatsappRefreshPromise=(async()=>{
      // A previously initiated full source refresh must finish before a
      // WA-only update so it cannot overwrite these authentic local fields.
      if(refreshPromise)await refreshPromise.catch(()=>undefined);
      const previous=await read();
      const im=originalDshIm ?? (ctx as unknown as {dshIm?:any}).dshIm ??
        (ctx as unknown as {get:(name:string)=>unknown}).get('dshIm');
      if(!im)throw Error('DSH_IM_TEMPORARILY_UNAVAILABLE');
      const original=await readExistingWhatsAppRosterForOss(im);
      const accounts=new Map<string,Account>(
        (previous?.accounts??[]).map(a=>[accountKey(a),a]));
      let verified=0;
      for(const row of original.accounts??[]){
        const value=cleanAccount(row);
        if(value?.channel!=='WhatsApp')continue;
        accounts.set(accountKey(value),value);
        verified++;
      }
      if(verified===0)throw Error('ORIGINAL_WHATSAPP_ROSTER_NOT_READY');
      const next={updatedAt:new Date().toISOString(),accounts:[...accounts.values()],
        failures:(previous?.failures??[]).filter(e=>!e.startsWith('WHATSAPP_'))};
      return await updateDisplay(current=>keepLatestVerifiedPage(next,current))??next;
    })().finally(()=>{whatsappRefreshPromise=null});
    return whatsappRefreshPromise;
  }

  ctx.effect(()=>()=>{if(storePromise)void storePromise.then(x=>x.close()).catch(()=>{})},
    'Original DSH display-only social snapshot dispose');
  ctx.inject(['webServer'],scope=>scope.effect(()=>scope.webServer.register({
    kind:'exact',path:'/api/yenra/oss-roster',
    handler:async(request,response)=>{
      const handlerStarted=performance.now();
      const send=(status:number,payload:unknown)=>{
        // Keep the original one-shot Host response. Desktop's official
        // forwardWebRequest strips content-length, so changing that header
        // would not establish a faster renderer body transfer.
        const serializeStarted=performance.now();
        const body=JSON.stringify(payload);
        const serializeMs=performance.now()-serializeStarted;
        const existingTiming=response.getHeader('server-timing');
        if(typeof existingTiming==='string')
          response.setHeader('server-timing',existingTiming+
            ', hostSerialize;dur='+Math.max(0,serializeMs).toFixed(3)+
            ', hostHandler;dur='+Math.max(0,performance.now()-handlerStarted).toFixed(3));
        response.writeHead(status,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'});
        response.end(body);
      };
      if(!checkLocal(request)){send(403,{ok:false,error:'LOCAL_ONLY'});return}
      if(request.method!=='GET'){send(405,{ok:false,error:'GET_ONLY'});return}
      const url=new URL(String(request.url??''),'http://localhost');
      const keys=[...url.searchParams.keys()].sort().join(',')
      if(url.pathname!=='/api/yenra/oss-roster'||
        !['','refresh','verifiedW25'].includes(keys)){
        send(400,{ok:false,error:'INVALID_QUERY'});return
      }
      const w25Only=keys==='verifiedW25'&&url.searchParams.get('verifiedW25')==='1'
      if(keys==='verifiedW25'&&!w25Only){
        send(400,{ok:false,error:'INVALID_QUERY'});return
      }
      const mode=url.searchParams.get('refresh');
      if(mode!==null&&!['1','wa'].includes(mode)){
        send(400,{ok:false,error:'INVALID_REFRESH_SCOPE'});return
      }
      const refreshing=mode==='1'||mode==='wa';
      // Same-origin opt-in diagnostics, not an additional API/storage service.
      // Do not trigger original provider requests merely to measure a cache hit.
      const probe=mode===null&&request.headers['x-yenra-roster-timing']==='1';
      const times:WhatsAppPrefsTiming={domainAcquireMs:0,tableReadMs:0,domainCloseMs:0,roomGets:0};
      try{
        if(w25Only){
          // Optional low-priority verified W25 read. The ordinary cached
          // roster GET never enters this branch and cannot be slowed by W25.
          // It reuses the SAME authenticated Host and original DSH snapshot.
          const data=await read()
          if(!data){send(503,{ok:false,error:'NO_VERIFIED_DISPLAY_SNAPSHOT_YET'});return}
          const view=project(data,false)
          const translations:Array<{accountRef:string;roomRef:string;original:string;
            at:number|null;translation:string}>=[]
          for(const account of view.accounts){
            if(account.channel!=='Page'||!account.rooms.length)continue
            const verified=await restoreVerifiedCachedPagePreviewsFromW25(account)
            const byRoom=new Map(verified.rooms.map(room=>[room.roomRef,room]))
            for(const room of account.rooms){
              const translated=byRoom.get(room.roomRef)?.latestText
              if(!room.latestText?.trim()||!translated?.trim()||
                 translated===room.latestText||translated.startsWith('历史 · ')||
                 !/[\u4e00-\u9fff]/u.test(translated))continue
              // Original W25 reader has already checked exact Page, original
              // source, provider MID, SHA-256 and latest timestamp.
              translations.push({accountRef:account.accountRef,roomRef:room.roomRef,
                original:room.latestText,at:room.lastMessageAt,translation:translated})
            }
            // The SAME low-priority W25 idle endpoint also reads the
            // original DSH translation Domain. Source provenance, Page
            // revision, MID, source hash and timestamp are verified first.
            // No provider GET, paid model, second cache or hot-roster scan.
            const proof=await readVerifiedHistoricalPagePreviewSources(account)
            const cached=await readCachedPagePreview(proof)
            const seen=new Set(translations.map(x=>x.accountRef+'|'+x.roomRef))
            for(const row of cached){
              const key=row.accountRef+'|'+row.roomRef
              if(seen.has(key))continue // verified W25 wins on duplicates
              seen.add(key)
              translations.push(row)
            }
          }
          send(200,{ok:true,translations})
          return
        }
        const started=probe?performance.now():0;
        const data=mode==='wa'?await refreshWhatsAppOnly():
          mode==='1'?await refresh(true):await read();
        const snapshotReadMs=probe?performance.now()-started:0;
        const view=project(data,refreshing);
        const roster=await withLocalWhatsAppPrefs(ctx,view,probe?times:undefined);
        if(probe){
          const ms=(n:number)=>Math.max(0,n).toFixed(3);
          response.setHeader('server-timing',[
            'dshSnapshot;dur='+ms(snapshotReadMs),
            'waDomainAcquire;dur='+ms(times.domainAcquireMs),
            'waTableRead;dur='+ms(times.tableReadMs),
            'waDomainClose;dur='+ms(times.domainCloseMs),
          ].join(', '));
          response.setHeader('x-yenra-wa-pref-reads',String(times.roomGets));
        }
        send(200,{ok:true,roster});
      }catch(error){
        const stale=await read().catch(()=>null);
        if(stale){const view=project(stale,false);
          send(200,{ok:true,roster:await withLocalWhatsAppPrefs(ctx,view,undefined),refreshError:'SOURCE_TEMPORARILY_UNAVAILABLE'});return}
        send(503,{ok:false,error:'NO_VERIFIED_DISPLAY_SNAPSHOT_YET'});
      }
    },
  }),'YENRA official Storage Domain view-only verified social roster'));
}
