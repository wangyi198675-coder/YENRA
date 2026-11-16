import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';
const file='C:\\Users\\1\\Documents\\YENRA\\ui\\chatwoot-embed\\src\\client\\cloud-dsh-translator-script.ts';
const s=readFileSync(file,'utf8'),t=String.fromCharCode(96),start=s.indexOf('String.raw'+t)+('String.raw'+t).length,end=s.lastIndexOf(t+';');
if(start<12||end<start)throw Error('SCRIPT_INVALID');
const script=s.slice(start,end);
function createScenario(native=false,previous=false,outgoing=false,quoted=false){
 const children=[],text='Ciao, come stai?',id='992432378',rows=[];
 const source={textContent:text,style:{display:'',fontSize:'',lineHeight:'',opacity:'',removeProperty(k){if(k==='display')this.display='';if(k==='font-size')this.fontSize='';if(k==='line-height')this.lineHeight='';if(k==='opacity')this.opacity=''}},
  attributes:{},querySelector(){return null},
  setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]??null},removeAttribute(k){delete this.attributes[k]}};
 const body={children:[source],classList:{contains(k){return ['gap-3','flex'].includes(k)}},
   appendChild(c){this.children.push(c);if(c.getAttribute?.('data-yenra-dsh-chinese')!==null&&!overlays.includes(c))overlays.push(c)},
   insertBefore(c,anchor){const index=this.children.indexOf(anchor);if(index<0)throw Error('MISSING_CHATWOOT_SOURCE');this.children.splice(index,0,c);if(c.getAttribute?.('data-yenra-dsh-chinese')!==null&&!overlays.includes(c))overlays.push(c)}};
 const quotePreview={className:'p-3 -mx-3 mb-3 rounded-lg',children:[],textContent:'Quoted original text'};
 const bubble={children:quoted?[quotePreview,body]:[body]},parent={className:'[grid-area:bubble] flex',children:[bubble]},root={children:outgoing?[{className:'[grid-area:avatar]',children:[]},parent]:[parent]};
 const overlays=[];
 const row={children:[root],id,querySelector(q){
   if(q==='[data-bubble-name="text"]')return bubble;
   if(q==='[data-yenra-dsh-chinese]')return overlays.find(x=>!x.removed)??null;
   return null;},
   querySelectorAll(q){
    if(q==='span,button,a')return native?[nativeToggle]:[];
    if(q==='[data-yenra-dsh-chinese]')return overlays.filter(x=>!x.removed);
    return [];},
   getAttribute(k){return k==='data-message-id'?this.id:null}};
 const nativeToggle={textContent:'查看原始内容',children:[],closest(){return null}};
 function makeNode(tag){
  const attrs={},node={
   tagName:tag.toUpperCase(),children:[],style:{},className:'',textContent:'',removed:false,
   setAttribute(k,v){attrs[k]=v},getAttribute(k){return attrs[k]??null},
   appendChild(c){this.children.push(c);if(Object.prototype.hasOwnProperty.call(attrs,'data-yenra-dsh-chinese')&&!overlays.includes(this))overlays.push(this)},
   remove(){this.removed=true;const index=body.children.indexOf(this);if(index>=0)body.children.splice(index,1)},
   addEventListener(k,cb){this.events??={};this.events[k]=cb}};
  return node;
 }
 const listeners=new Map(),logs=[];
 const doc={
  body:{},addEventListener(type,listener){const list=listeners.get(type)??[];list.push(listener);listeners.set(type,list)},
  querySelector(q){if(q==='[data-message-id="'+id+'"]'||q==='[data-message-id="'+id+'"].justify-start,[data-message-id="'+id+'"].justify-end')return row;return null},
  querySelectorAll(q){if(q==='[data-message-id].justify-start,[data-message-id].justify-end'||(!outgoing&&q==='[data-message-id].justify-start'))return rows;return []},
  createElement:makeNode
 };
 rows.push(row);
 class Observer{observe(){}disconnect(){}}
 const context={document:doc,window:{},location:{pathname:'/app/accounts/196799/conversations/26'},
  MutationObserver:Observer,setTimeout(){},console:{info(message){logs.push(message)}},Date,Set,Array};
 assert.equal(runInNewContext(script,context),true);
 const api=context.window.__yenraDshCloudTranslatorV1;
 if(previous){
  const old=makeNode('div');old.setAttribute('data-yenra-dsh-chinese','');old.textContent='你好，你怎么样？';
  bubble.children.push(old);overlays.push(old);
 }
 return {api,source,body,row,overlays,nativeToggle,quotePreview,bubble,listeners,logs,context};
}
test('outgoing uses original Chatwoot bubble: Chinese above, source below; no avatar overlay or toggle',()=>{
 const p=createScenario(false,false,true);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'我理解你的意思'}]),1);
 const block=p.body.children.find(n=>n.getAttribute?.('data-yenra-dsh-chinese')==='');
 assert.ok(block);
 assert.equal(p.body.children[0],block);
 assert.equal(p.body.children[1],p.source);
 assert.equal(p.source.style.display,'');
 assert.equal(p.source.style.fontSize,'12px');
 assert.match(block.style.cssText,/font-size:15px/);
 assert.equal(block.textContent,'我理解你的意思');
 assert.equal(block.children.length,0,'no custom toggle replacing native text');
});
test('outgoing foreign-language Chatwoot bubbles enter automatic translation without a right click',()=>{
 const p=createScenario(false,false,true);
 assert.deepEqual(JSON.parse(JSON.stringify(p.api.visible().ids)),[992432378]);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好，最近怎么样？'}]),1);
 assert.equal(p.api.visible().ids.length,0,'outgoing translation must not re-request after painting');
 const block=p.body.children[0];
 assert.equal(block.textContent,'你好，最近怎么样？');
 assert.equal(p.body.children[1].textContent,'Ciao, come stai?');
});
test('outgoing native translation takes precedence and never double-paints',()=>{
 const p=createScenario(true,false,true);
 assert.equal(p.api.visible().ids.length,0);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好'}]),0);
});
test('outgoing A→B→A replay restores the saved Chinese without manual click',()=>{
 const p=createScenario(false,false,true);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好，今天怎么样？'}]),1);
 for(const overlay of [...p.overlays])overlay.remove();
 assert.equal(p.api.visible().ids.length,1);
 p.api.refresh();
 assert.equal(p.api.visible().ids.length,0);
 assert.equal(p.body.children[0].textContent,'你好，今天怎么样？');
});
test('Cloud-native translation is the only visible translation; removes old duplicated append',()=>{
 const p=createScenario(true,true);
 assert.equal(p.api.visible().ids.length,0);
 assert.equal(p.overlays.filter(x=>!x.removed).length,0);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好'}]),0);
 assert.equal(p.source.style.display,'');
});
test('DSH fallback reuses native body with visible bilingual text, without UI replacement',()=>{
 const p=createScenario(false);
 assert.equal(JSON.stringify(p.api.visible().ids),'[992432378]');
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好，你怎么样？'}]),1);
 const block=p.body.children.find(n=>n.getAttribute?.('data-yenra-dsh-chinese')==='');
 assert.ok(block);
 assert.equal(p.body.children[0],block);
 assert.equal(p.body.children[1],p.source);
 assert.equal(p.source.style.display,'');
 assert.equal(p.source.textContent,'Ciao, come stai?');
 assert.equal(p.source.style.fontSize,'12px');
 assert.equal(block.textContent,'你好，你怎么样？');
 assert.ok(block.style.cssText.includes('font-size:15px'));
 assert.equal(block.children.length,0);
});
test('When Cloud native translation arrives, DSH fallback disappears and original is restored',()=>{
 const p=createScenario(false);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好'}]),1);
 p.row.querySelectorAll=q=>q==='span,button,a'?[p.nativeToggle]:q==='[data-yenra-dsh-chinese]'?p.overlays.filter(x=>!x.removed):[];
 p.api.refresh();
 assert.equal(p.source.style.display,'');
 assert.equal(p.overlays.filter(x=>!x.removed).length,0);
});
test('virtualized recycled row invalidates translation rather than leaking prior contact',()=>{
 const p=createScenario(false);
 p.api.paint(26,[{id:992432378,translation:'你好'}]);
 p.row.id='111111111';
 p.api.refresh();
 assert.equal(p.source.style.display,'');
 assert.equal(p.overlays.filter(x=>!x.removed).length,0);
});

test('A→B→A restores cached Chinese to a remounted row without a model call',()=>{
 const p=createScenario(false);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好，今天怎么样？'}]),1);
 for(const overlay of [...p.overlays])overlay.remove();
 p.source.style.display='';
 assert.equal(p.api.visible().ids.length,1);
 p.api.refresh();
 assert.equal(p.api.visible().ids.length,0);
 const restored=p.body.children.find(n=>n.getAttribute?.('data-yenra-dsh-chinese')==='');
 assert.ok(restored);
 assert.equal(restored.textContent,'你好，今天怎么样？');
 assert.equal(p.source.style.display,'');
 p.api.refresh();
 assert.equal(p.overlays.filter(x=>!x.removed).length,1);
});
test('A→B→A never reuses Chinese when original message content has changed',()=>{
 const p=createScenario(false);
 p.api.paint(26,[{id:992432378,translation:'你好'}]);
 for(const overlay of [...p.overlays])overlay.remove();
 p.source.style.display='';
 p.source.textContent='Edited original content';
 p.api.refresh();
 assert.equal(p.api.visible().ids.length,1);
 assert.equal(p.overlays.filter(x=>!x.removed).length,0);
});

test('phone numbers and numeric identifiers do not trigger a paid translation batch',()=>{
 const p=createScenario(false);
 p.source.textContent='392 0180322';
 assert.equal(p.api.visible().ids.length,0);
 p.source.textContent='Ciao 392 0180322';
 assert.equal(p.api.visible().ids.length,1);
});

test('quoted incoming reply: keep quote untouched, auto-translate actual body and right-click the same MID',()=>{
 const p=createScenario(false,false,false,true);
 assert.equal(p.bubble.children[0],p.quotePreview,'native quote stays in its original position');
 assert.deepEqual(JSON.parse(JSON.stringify(p.api.visible().ids)),[992432378],
  'quoted text bubble must be a candidate for automatic translation');
 const manual=p.context.window.__yenraDshCloudManualTranslateV1;
 assert.ok(manual);
 for(const listener of p.listeners.get('contextmenu')??[])
  listener({target:{closest(){return p.row}}});
 for(const listener of p.listeners.get('click')??[])
  listener({target:{textContent:'翻译',parentElement:null}});
 assert.deepEqual(p.logs.filter(s=>s.startsWith('YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:')),
  ['YENRA_CLOUD_DSH_RIGHTCLICK_TRANSLATE:26:992432378']);
 assert.equal(manual.feedback(26,992432378,'正在通过 YENRA 翻译…'),true,
  'right-click status must target the actual reply body');
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好，最近怎么样？'}]),1);
 assert.equal(p.bubble.children[0],p.quotePreview);
 const block=p.body.children.find(n=>n.getAttribute?.('data-yenra-dsh-chinese')==='');
 assert.ok(block,'Chinese is added above the reply rather than inside the quote');
 assert.equal(p.body.children.indexOf(block)<p.body.children.indexOf(p.source),true);
 assert.equal(p.source.textContent,'Ciao, come stai?');
 assert.equal(p.api.visible().ids.length,0);
});

test('quoted outgoing reply: translator paints only the new outgoing text and replays without touching quote',()=>{
 const p=createScenario(false,false,true,true);
 assert.deepEqual(JSON.parse(JSON.stringify(p.api.visible().ids)),[992432378]);
 assert.equal(p.api.paint(26,[{id:992432378,translation:'你好，最近怎么样？'}]),1);
 assert.equal(p.bubble.children[0],p.quotePreview);
 assert.equal(p.quotePreview.textContent,'Quoted original text');
 const block=p.body.children.find(n=>n.getAttribute?.('data-yenra-dsh-chinese')==='');
 assert.ok(block);
 assert.equal(p.body.children.indexOf(block)<p.body.children.indexOf(p.source),true);
 for(const overlay of [...p.overlays])overlay.remove();
 assert.equal(p.api.visible().ids.length,1);
 p.api.refresh();
 assert.equal(p.api.visible().ids.length,0,'A→B→A or virtual re-mount replays the exact cached MID');
 assert.equal(p.bubble.children[0],p.quotePreview);
 assert.equal(p.quotePreview.textContent,'Quoted original text');
});
