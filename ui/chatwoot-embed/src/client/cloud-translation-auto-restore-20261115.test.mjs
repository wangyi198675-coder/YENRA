import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require=createRequire(new URL('../../../../upstream/official-source/package.json',import.meta.url));
const ts=require('typescript');
const source=readFileSync(new URL('./cloud-native-inbox.tsx',import.meta.url),'utf8');
const start=source.indexOf('    const dshIncoming=async()=>{');
const end=source.indexOf('    const dshTranslateDraft=async()=>',start);
assert(start>0&&end>start,'real Cloud inbox translation function must exist');
const fnJs=ts.transpileModule(source.slice(start,end),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
}).outputText;

function harness(size,{cancelOnFirst=false}={}){
 let currentUrl='https://app.chatwoot.com/app/accounts/196799/conversations/90';
 const remaining=new Set(Array.from({length:size},(_,i)=>90001+i));
 let painted=0;
 const requests=[];
 let ctx;
 let last=[];
 const guest={
  getURL:()=>currentUrl,
  executeJavaScript:async script=>{
   if(script==='INSTALL_SCRIPT')return true;
   if(script.includes('.visible?.()'))return{
    conversationId:Number(new URL(currentUrl).pathname.split('/').at(-1)),
    ids:[...remaining].slice(-8)};
   if(script.includes('.paint(')){
    for(const id of last)remaining.delete(id);
    painted+=last.length;return last.length;
   }
   throw Error('UNRECOGNIZED_UI_SCRIPT');
  },
 };
 ctx={
  guest,visibleRef:{current:true},disposed:false,dshModelBusy:false,
  dshFailureUntil:0,dshRefreshAt:0,dshIncomingEpoch:0,
  dshIncomingAbort:null,CLOUD_ORIGIN:'https://app.chatwoot.com',
  CONVERSATION_PATH:/^\/app\/accounts\/196799\/conversations\/(\d+)$/u,
  CLOUD_DSH_TRANSLATOR_SCRIPT:'INSTALL_SCRIPT',
  Number,Date,URL,Set,AbortController,AbortSignal,
  // The production translation flow refreshes the existing saved-preview view
  // after each painted batch; this harness must include that no-op callback.
  scheduleSavedPreviews:()=>{},
  invalidatePreviewMisses:()=>{},
  sendDshTranslation:async(req,signal)=>{
   requests.push({ids:req.messageIds,mode:req.mode});
   last=req.messageIds;
   if(cancelOnFirst){
    currentUrl='https://app.chatwoot.com/app/accounts/196799/conversations/91';
    ctx.dshIncomingEpoch++;
    ctx.dshIncomingAbort?.abort();
   }
   return{items:req.messageIds.map(id=>({id,translation:'你好'}))};
  },
 };
 const fn=vm.runInNewContext(fnJs+'\ndshIncoming',ctx);
 return{run:fn,requests,remaining,get painted(){return painted},ctx};
}
test('real Cloud inbox drains 23 missing native MIDs in 3 bounded model batches',async()=>{
 const x=harness(23);
 await x.run();
 assert.equal(x.requests.length,3);
 assert(x.requests.every(r=>r.mode==='incoming'&&r.ids.length<=8));
 assert.equal(x.painted,23);
 assert.equal(x.remaining.size,0);
 assert.equal(x.ctx.dshModelBusy,false);
});
test('stale A request never paints into B even when model completes',async()=>{
 const x=harness(16,{cancelOnFirst:true});
 await x.run();
 assert.equal(x.requests.length,1);
 assert.equal(x.painted,0);
 assert.equal(x.remaining.size,16);
 assert.equal(x.ctx.dshIncomingEpoch,1);
});
test('current contact backoff is cleared on navigation and pending Host request is aborted',()=>{
 assert.match(source,/dshIncomingEpoch\+\+;\s*dshIncomingAbort\?\.abort\(\);dshIncomingAbort=null;/u);
 assert.match(source,/dshModelBusy=false;dshFailureUntil=0;dshRefreshAt=0;/u);
});

test('YEN-11: persisted translation invalidates exact preview cache misses immediately',()=>{
 const start=source.indexOf('    const invalidatePreviewMisses=');
 const end=source.indexOf('    // Cloud saved zh_CN wins.',start);
 assert(start>0&&end>start);
 const js=ts.transpileModule(source.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 const {misses,invalidate}=vm.runInNewContext(
  'const previewCacheReadAt=new Map();\n'+js+
  '\n({misses:previewCacheReadAt,invalidate:invalidatePreviewMisses})');
 misses.set('90:201:Hallo',Date.now());
 misses.set('90:202:Ciao',Date.now());
 misses.set('91:201:Hallo',Date.now());
 invalidate(90,[{id:201,translation:'你好'},
  {id:202,translation:null},{id:203,translation:'Hello'}]);
 assert.equal(misses.has('90:201:Hallo'),false);
 assert.equal(misses.has('90:202:Ciao'),true,'other MID misses retain throttle');
 assert.equal(misses.has('91:201:Hallo'),true,'other contact is isolated');
 assert.match(source,/invalidatePreviewMisses\(selected,result\.items\);\s*\/\/ The same verified MID/u);
 assert.match(source,/invalidatePreviewMisses\(cid,\[\{id:mid,translation:item\.translation\}\]\);/u);
});
