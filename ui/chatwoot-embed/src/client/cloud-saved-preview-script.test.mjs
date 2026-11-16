import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{runInNewContext}from'node:vm';
import{fileURLToPath}from'node:url';
import{resolve,dirname}from'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const file=readFileSync(resolve(root,'cloud-saved-preview-script.ts'),'utf8');
const tick=String.fromCharCode(96);
const start=file.indexOf('String.raw'+tick)+('String.raw'+tick).length;
const end=file.lastIndexOf(tick+';');
if(start<=10||end<=start)throw Error('PREVIEW_SCRIPT_NOT_FOUND');
const code=file.slice(start,end);
function setup(oldPreview=null){
 const rows=[];
 const list={isConnected:true,querySelectorAll:()=>rows};
 const document={body:{},querySelector:q=>q==='.conversations-list'?list:null};
 class MutationObserver{observe(){}disconnect(){}}
 const win=oldPreview?{__yenraCloudSavedPreviewV1:oldPreview}:{};
 const context={window:win,location:{pathname:'/app/accounts/196799/conversations/7'},document,
   MutationObserver,WeakMap,Set,Date,queueMicrotask:fn=>fn(),console:{info(){}}};
 assert.equal(runInNewContext(code,context),true);
 const api=win.__yenraCloudSavedPreviewV1;
 function row(name,text){
  const span={textContent:text,title:'',removeAttribute(k){if(k==='title')this.title=''}};
  const last={querySelector:q=>q==='span:last-child'?span:null};
  const el={name,span,children:[{}, {children:[{}, {},last]}],querySelector(q){return q==='.conversation--user'?{textContent:this.name}:null}};
  rows.push(el);api.refresh();return el;
 }
 const v=(id,name,original,translation)=>({conversationId:id,contactId:id+200,messageId:id+300,name,original,translation});
 return {rows,api,row,v};
}
test('saved Chinese preview replaces only exactly matched native message',()=>{
 const s=setup(),r=s.row('A','Ciao');
 assert.equal(s.api.set([s.v(1,'A','Ciao','你好')]),true);
 assert.equal(r.span.textContent,'你好');assert.equal(r.span.title,'原文：Ciao');
});
test('new native message removes stale old title and preserves unmatched original',()=>{
 const s=setup(),r=s.row('A','Ciao');s.api.set([s.v(1,'A','Ciao','你好')]);
 r.span.textContent='Guten Morgen';s.api.refresh();
 assert.equal(r.span.textContent,'Guten Morgen');assert.equal(r.span.title,'');
 s.api.set([s.v(2,'A','Guten Morgen','早上好')]);
 assert.equal(r.span.textContent,'早上好');
});
test('virtual node reused for another contact never retains prior person translation',()=>{
 const s=setup(),r=s.row('A','Ciao');s.api.set([s.v(1,'A','Ciao','你好')]);
 r.name='B';s.api.refresh();
 assert.equal(r.span.textContent,'');assert.equal(r.span.title,'');
 r.span.textContent='Hallo';s.api.set([s.v(3,'B','Hallo','你好啊')]);
 assert.equal(r.span.textContent,'你好啊');
});
test('removal of translation restores original Cloud preview, no stale tooltip',()=>{
 const s=setup(),r=s.row('A','Ciao');s.api.set([s.v(1,'A','Ciao','你好')]);
 s.api.set([]);assert.equal(r.span.textContent,'Ciao');assert.equal(r.span.title,'');
});
test('ambiguous duplicate contact and content never guess identities',()=>{
 const s=setup(),r=s.row('A','Ciao');
 s.api.set([s.v(1,'A','Ciao','你好'),s.v(2,'A','Ciao','您好')]);
 assert.equal(r.span.textContent,'Ciao');assert.equal(r.span.title,'');
});

test('visible last-message cache candidate reuses existing DSH Chinese with no generated translation',()=>{
 const s=setup(),r=s.row('A','Ciao');
 const descriptor={...s.v(7,'A','Ciao',''),translation:''};
 assert.equal(s.api.set([descriptor]),true);
 const misses=JSON.parse(JSON.stringify(s.api.visibleMissing(12)));
 assert.equal(misses.length,1);
 assert.equal(misses[0].conversationId,7);
 assert.equal(misses[0].messageId,307);
 assert.equal(s.api.mergeCached([{...descriptor,translation:'你好'}]),1);
 assert.equal(r.span.textContent,'你好');
 assert.equal(r.span.title,'原文：Ciao');
 assert.equal(s.api.visibleMissing().length,0);
 assert.equal(s.api.set([descriptor]),true,'re-fetch of unchanged Cloud metadata keeps the display cache');
 assert.equal(r.span.textContent,'你好');
 r.span.textContent='Hallo';
 assert.equal(s.api.set([{...s.v(7,'A','Hallo',''),messageId:308}]),true);
 assert.equal(r.span.textContent,'Hallo');
 assert.equal(r.span.title,'');
});
test('native Cloud saved Chinese wins over existing DSH cached preview',()=>{
 const s=setup(),r=s.row('A','Ciao');
 const descriptor=s.v(7,'A','Ciao','');
 s.api.set([descriptor]);
 assert.equal(s.api.mergeCached([{...descriptor,translation:'你好'}]),1);
 assert.equal(r.span.textContent,'你好');
 s.api.set([{...descriptor,translation:'您好'}]);
 assert.equal(r.span.textContent,'您好');
 assert.equal(s.api.mergeCached([{...descriptor,translation:'旧模型译文'}]),0);
 assert.equal(r.span.textContent,'您好');
});
test('ambiguous same-name and same-source last messages are never cache-looked-up',()=>{
 const s=setup();s.row('A','Ciao');s.row('A','Ciao');
 s.api.set([{...s.v(1,'A','Ciao',''),translation:''},
  {...s.v(2,'A','Ciao',''),translation:''}]);
 assert.equal(s.api.visibleMissing().length,0);
 assert.equal(s.api.mergeCached([{...s.v(1,'A','Ciao','你好')}]),1);
 const r=s.rows[0],other=s.rows[1];
 assert.equal(r.span.textContent,'Ciao');
 assert.equal(other.span.textContent,'Ciao');
});

test('old preview observer upgrades in place without Cloud reload or duplicate listener',()=>{
 let disconnected=0,refreshed=0;
 const old={refresh(){refreshed++},disconnect(){disconnected++}};
 const s=setup(old);
 assert.equal(disconnected,1);
 assert.equal(refreshed,0,'v1 refresh alone must not shadow new cache functions');
 assert.notEqual(s.api,old);
 assert.equal(s.api.version,2);
 assert.equal(typeof s.api.mergeCached,'function');
 assert.equal(typeof s.api.visibleMissing,'function');
});

test('removed Cloud-native translation is not silently preserved as a fake DSH cache hit',()=>{
 const s=setup(),r=s.row('A','Ciao'),descriptor=s.v(13,'A','Ciao','');
 s.api.set([{...descriptor,translation:'您好'}]);
 assert.equal(r.span.textContent,'您好');
 s.api.set([descriptor]);
 assert.equal(r.span.textContent,'Ciao');
 assert.equal(s.api.visibleMissing().length,1);
});
