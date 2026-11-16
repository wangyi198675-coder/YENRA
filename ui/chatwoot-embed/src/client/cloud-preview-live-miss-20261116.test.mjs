import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../../../../upstream/official-source/package.json',import.meta.url));
const ts=require('typescript');
const source=readFileSync(new URL('./cloud-native-inbox.tsx',import.meta.url),'utf8');
const start=source.indexOf('    const restoreCachedVisiblePreviews=async(');
const end=source.indexOf('    const previewRetryTimers=',start);
assert(start>0&&end>start,'must execute the real source function');
const fn=ts.transpileModule(source.slice(start,end),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
}).outputText;
function harness({cached='',generated='早上好',misses=1,routeSwitch=false,original='Guten Morgen'}={}){
 const rows=Array.from({length:misses},(_,i)=>({
   conversationId:30+i,contactId:90+i,messageId:700+i,name:'Test '+i,original
 }));
 const queries=[],painted=[],visibleRef={current:true};
 const view={executeJavaScript:async script=>{
   if(script.includes('visibleMissing'))return rows;
   if(script.includes('mergeCached')){const txt=script.slice(script.indexOf('(')+1,-1);painted.push(...JSON.parse(txt));return 1;}
   throw Error('UNEXPECTED_SCRIPT');
 }};
 const env={guest:view,disposed:false,visibleRef,previewCacheBusy:false,previewCacheFollowup:false,
   previewCacheReadAt:new Map(),previewAutoAttemptAt:new Map(),
   sendDshTranslation:async req=>{
     queries.push(req.mode+':'+req.conversationId);
     if(routeSwitch)env.guest={...view};
     return {mode:req.mode,conversationId:req.conversationId,items:req.mode==='cached'&&cached
       ?[{id:req.messageIds[0],translation:cached}]
       :req.mode==='incoming'&&generated?[{id:req.messageIds[0],translation:generated}]:[]};
   },
   Number,Date,JSON,Map,Array,Promise,AbortSignal,Set};
 const execute=vm.runInNewContext(fn+'\nrestoreCachedVisiblePreviews',env);
 return {run:()=>execute(view),queries,painted,env,rows};
}
test('YEN-11: latest visible uncached Cloud MID generates via same Host once and paints Chinese',async()=>{
 const x=harness();await x.run();
 assert.deepEqual(x.queries,['cached:30','incoming:30']);
 assert.equal(x.painted.length,1);
 assert.equal(x.painted[0].translation,'早上好');
 assert.equal(x.env.previewAutoAttemptAt.size,1);
 x.env.previewCacheReadAt.clear();await x.run();
 assert.deepEqual(x.queries,['cached:30','incoming:30','cached:30'],
   '15-min attempt throttle stops a repeated model call on unchanged MID');
});
test('YEN-11: existing persisted translation never invokes model',async()=>{
 const x=harness({cached:'你好'});await x.run();
 assert.deepEqual(x.queries,['cached:30']);
 assert.equal(x.painted[0].translation,'你好');
 assert.equal(x.env.previewAutoAttemptAt.size,0);
});
test('YEN-11: do not model-translate non-linguistic latest preview',async()=>{
 const x=harness({original:'123456789'});await x.run();
 assert.deepEqual(x.queries,['cached:30']);assert.equal(x.painted.length,0);
});
test('YEN-11: visible fallback is at most four MIDs per batch',async()=>{
 const x=harness({misses:9});await x.run();
 assert.equal(x.queries.filter(s=>s.startsWith('incoming:')).length,4);
});
test('YEN-11: changing Cloud Guest invalidates all stale renders and model calls',async()=>{
 const x=harness({routeSwitch:true});await x.run();
 assert.deepEqual(x.queries,['cached:30']);assert.equal(x.painted.length,0);
});
