import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./cloud-dsh-translator-script.ts',import.meta.url),'utf8');
const tick=String.fromCharCode(96);
const start=source.indexOf('String.raw'+tick)+('String.raw'+tick).length,end=source.lastIndexOf(tick+';');
assert(start>10&&end>start);
const js=source.slice(start,end);
function setup({native=false,text=true}={}){
 const handlers=new Map(),timers=[],actions=[],logs=[];let path='/app/accounts/196799/conversations/26';
 const original={getAttribute:()=>null},body={children:[],classList:{contains:v=>v==='gap-3'||v==='flex'},appendChild(n){this.children.push(n)}};
 body.children.push(original);
 const row={children:[{children:[{className:'[grid-area:bubble]',children:[{children:[body]}]}]}],
  getAttribute:k=>k==='data-message-id'?'321':null,
  querySelector:q=>q==='[data-bubble-name="text"]'&&text?{}:null};
 const nativeMenu={textContent:'翻译',disabled:false,getAttribute:()=>null,getClientRects:()=>[{}]};
 const document={body:{appendChild(n){actions.push(n)}},addEventListener(type,fn,capture){
   const k=type+(capture===true?':capture':':bubble');
   if(!handlers.has(k))handlers.set(k,[]);handlers.get(k).push(fn);
  },querySelectorAll(q){return q==='[role="menuitem"],button'&&native?[nativeMenu]:[]},
  querySelector:()=>null,
  createElement(tag){const attrs=new Set();return{tagName:tag.toUpperCase(),style:{},textContent:'',
    setAttribute:k=>attrs.add(k),remove(){this.removed=true},getAttribute:k=>attrs.has(k)?'':null,
    closest(q){return q==='[data-yenra-cloud-translate-action]'&&attrs.has('data-yenra-cloud-translate-action')?this:null}}}
 };
 class MutationObserver{observe(){}disconnect(){}}
 const win={innerWidth:1360,innerHeight:720};
 const ctx={document,window:win,location:{get pathname(){return path}},MutationObserver,
  Date,Math,Number,JSON,setTimeout:fn=>{timers.push(fn)},console:{info:s=>logs.push(s)}};
 assert.equal(runInNewContext(js,ctx),true);
 const dispatch=(type,target)=>{
  const event={target,clientX:250,clientY:180,key:type==='keydown'?'Escape':undefined};
  for(const fn of handlers.get(type+':capture')??[])fn(event);
  for(const fn of handlers.get(type+':bubble')??[])fn(event);
 };
 const fakeTarget={closest:q=>q==='[data-message-id]'?row:null,textContent:''};
 const flush=()=>{const tasks=timers.splice(0);for(const fn of tasks)fn()};
 return {row,win,logs,actions,handlers,dispatch,flush,rightClick:()=>dispatch('contextmenu',fakeTarget),
  route:value=>{path=value}};
}
test('YEN-11: absent native Translate reveals an explicit safe action, never auto calls model',()=>{
 const x=setup();x.rightClick();x.flush();
 assert.equal(x.actions.length,1);
 assert.equal(x.actions[0].textContent,'翻译');
 assert.equal(x.logs.filter(s=>s.startsWith('YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:')).length,0,
  'right-click alone never invokes original DSH model');
 x.dispatch('click',x.actions[0]);
 assert.deepEqual(x.logs.filter(s=>s.startsWith('YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:')),
  ['YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:26:321']);
});
test('YEN-11: do not duplicate native enabled Translate menu',()=>{
 const x=setup({native:true});x.rightClick();x.flush();assert.equal(x.actions.length,0);
});
test('YEN-11: no fallback on a non-text message and no cross-contact stale action',()=>{
 const noText=setup({text:false});noText.rightClick();noText.flush();assert.equal(noText.actions.length,0);
 const switched=setup();switched.rightClick();switched.route('/app/accounts/196799/conversations/27');
 switched.flush();assert.equal(switched.actions.length,0);
});
test('YEN-11: clicking Copy never translates, Escape dismisses fallback without Sender',()=>{
 const x=setup();x.rightClick();x.flush();x.dispatch('click',{textContent:'复制',closest:()=>null});
 assert.equal(x.logs.filter(s=>s.startsWith('YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:')).length,0);
 assert.equal(x.actions[0].removed,true);
 x.rightClick();x.flush();x.dispatch('keydown',{key:'Escape'});assert.equal(x.actions.at(-1).removed,true);
});
test('YEN-11: guest hot reinjection registers only one fallback listener',()=>{
 const x=setup();const before=(x.handlers.get('contextmenu:capture')??[]).length;
 assert.equal(runInNewContext(js,{document:{},location:{pathname:'/app/accounts/196799/conversations/26'},window:x.win}),true);
 assert.equal((x.handlers.get('contextmenu:capture')??[]).length,before);
});
