import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const base=new URL('./',import.meta.url);
const source=readFileSync(new URL('cloud-native-inbox.tsx',base),'utf8');
const guest=readFileSync(new URL('cloud-dsh-translator-script.ts',base),'utf8');
const begin=source.indexOf('                const alreadyVisible=painted===1||await el.executeJavaScript(');
const end=source.indexOf('                invalidatePreviewMisses(cid,',begin);
assert(begin>0&&end>begin,'exercise production idempotence branch, not copied mock');
const branch=source.slice(begin,end);

async function idempotentPaint({painted=0,mid=123,chinese='你好',existing='你好',present=true}={}){
 let guestChecks=0;
 const context={
  painted,mid,item:{translation:chinese},JSON,
  el:{executeJavaScript:async(js)=>{
    guestChecks++;
    return runInNewContext(js,{document:{querySelector:selector=>{
      if(!present||!selector.includes('data-message-id="'+mid+'"'))return null;
      return {textContent:existing};
    }}});
  }}
 };
 const result=await runInNewContext('(async()=>{'+branch+'return alreadyVisible;})()',context);
 return {result,guestChecks};
}
test('YEN-11: existing verified same-MID Chinese is successful even when paint returns zero',async()=>{
 const x=await idempotentPaint();assert.equal(x.result,true);assert.equal(x.guestChecks,1);
});
test('YEN-11: new paint immediately succeeds without unnecessary DOM lookup',async()=>{
 const x=await idempotentPaint({painted:1,present:false});assert.equal(x.result,true);assert.equal(x.guestChecks,0);
});
test('YEN-11: wrong translation or absent MID never masquerades as successful paint',async()=>{
 assert.equal((await idempotentPaint({existing:'另一条'})).result,false);
 assert.equal((await idempotentPaint({present:false})).result,false);
});
test('YEN-11: manual Host call is bounded and preserves native Cloud Sender isolation',()=>{
 assert.match(source,/mode:'export',conversationId:cid,messageIds:\[mid\],[\s\S]{0,50}AbortSignal\.timeout\(45000\)/u);
 assert.doesNotMatch(branch,/sender\.send|sender\.post|sendMessage/u);
 assert.match(source,/await feedback\(alreadyVisible\?'翻译完成，可查看原文':/u);
});

function guestHarness(){
 const tick=String.fromCharCode(96),start=guest.indexOf('String.raw'+tick)+('String.raw'+tick).length;
 const end=guest.lastIndexOf(tick+';');
 assert(start>0&&end>start);
 const timers=[],created=[],handlers=new Map();
 let path='/app/accounts/196799/conversations/26';
 const original={getAttribute:()=>null};
 const body={children:[original],classList:{contains:v=>v==='gap-3'||v==='flex'},
  appendChild(n){created.push(n);this.children.push(n);n.isConnected=true}};
 const row={children:[{children:[{className:'[grid-area:bubble]',children:[{children:[body]}]}]}],
  getAttribute:x=>x==='data-message-id'?'555':null,
  querySelector(q){if(q==='[data-bubble-name="text"]')return {};
    if(q==='[data-yenra-manual-translation-status]')return created.find(x=>x.isConnected)??null;
    return null}};
 const document={body:{},addEventListener(name,fn){handlers.set(name,fn)},
  querySelector(q){return q==='[data-message-id="555"]'?row:null},
  querySelectorAll:()=>[],
  createElement:()=>({isConnected:false,style:{},textContent:'',setAttribute(){},
   remove(){this.isConnected=false}})};
 class MutationObserver{observe(){}disconnect(){}}
 const context={document,window:{},location:{get pathname(){return path}},
   MutationObserver,Date,Math,console:{info:()=>{}},
   setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length}};
 assert.equal(runInNewContext(guest.slice(start,end),context),true);
 return {feedback:context.window.__yenraDshCloudManualTranslateV1.feedback,
  created,timers,runTimers:ms=>{const ready=timers.filter(t=>t.ms===ms);for(const t of ready)t.fn()}};
}
test('YEN-11: a lost manual callback turns permanent pending badge into transient retryable status',()=>{
 const x=guestHarness();
 assert.equal(x.feedback(26,555,'正在通过 YENRA 翻译…'),true);
 assert.equal(x.created.length,1);
 assert.equal(x.created[0].isConnected,true);
 x.runTimers(48000);
 assert.match(x.created[0].textContent,/翻译等待超时/);
 x.runTimers(6000);
 assert.equal(x.created[0].isConnected,false);
});
test('YEN-11: successful cached translation immediately removes status, late watchdog cannot resurrect it',()=>{
 const x=guestHarness();
 x.feedback(26,555,'正在通过 YENRA 翻译…');
 x.feedback(26,555,'翻译完成，可查看原文');
 assert.equal(x.created[0].isConnected,false);
 x.runTimers(48000);
 assert.equal(x.created[0].isConnected,false);
});
