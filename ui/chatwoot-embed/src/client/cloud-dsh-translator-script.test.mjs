import test from'node:test';import assert from'node:assert/strict';
import{runInNewContext}from'node:vm';import{readFileSync}from'node:fs';
const root='C:\\Users\\1\\Documents\\YENRA\\ui\\chatwoot-embed\\src\\client';
const src=readFileSync(root+'\\cloud-dsh-translator-script.ts','utf8');
const tick=String.fromCharCode(96),start=src.indexOf('String.raw'+tick)+('String.raw'+tick).length;
const end=src.lastIndexOf(tick+';');if(start<12||end<=start)throw Error('SCRIPT_INVALID');
const body=src.slice(start,end);
function sandbox(value){
 const events=new Map(),logs=[],spans=[];
 const button={disabled:false,textContent:'发送 (↵)'};
 const editor={innerText:value,textContent:value,parentElement:{appendChild:el=>spans.push(el)},contains:()=>true};
 const doc={
  body:{},addEventListener:(name,fn)=>events.set(name,fn),
  querySelector:q=>q==='.ProseMirror[contenteditable="true"]'?editor:null,
  querySelectorAll:q=>q==='button'?[button]:[],
  createElement:()=>({style:{},setAttribute(){},textContent:''})
 };
 class Observer{observe(){}disconnect(){}}
 const win={};
 const ctx={window:win,location:{pathname:'/app/accounts/196799/conversations/25'},
  document:doc,MutationObserver:Observer,setTimeout:()=>{},Date,console:{info:x=>logs.push(x)}};
 assert.equal(runInNewContext(body,ctx),true);
 const e={target:{closest:()=>button},preventDefault(){this.stopped=true},stopImmediatePropagation(){this.blocked=true}};
 return {events,button,editor,e,logs,api:win.__yenraDshCloudTranslatorV1,win};
}
test('native send is intercepted for Chinese without invoking Cloud Sender',()=>{
 const t=sandbox('你好，今天怎么样？');t.events.get('click')(t.e);
 assert.equal(t.e.stopped,true);assert.equal(t.e.blocked,true);
 assert.equal(t.api.draft().conversationId,25);
 assert.equal(t.api.draft().draft,'你好，今天怎么样？');
 assert.equal(t.logs.filter(v=>v==='YENRA_CLOUD_DSH_DRAFT_TRANSLATE').length,1);
 t.api.fail('Translation temporarily unavailable');
 assert.equal(t.api.draft(),null);
});
test('pretranslated foreign-language text passes native Cloud send unchanged',()=>{
 const t=sandbox('Guten Abend');t.events.get('click')(t.e);
 assert.equal(t.e.stopped,undefined);
 assert.equal(t.api.draft(),null);
});
test('Cannot reuse previous draft after a conversation switch',()=>{
 const t=sandbox('你好');t.events.get('click')(t.e);
 assert.equal(t.api.draft().conversationId,25);
 t.win.__yenraDshCloudTranslatorV1.fail('not available');
 assert.equal(t.api.draft(),null);
});
