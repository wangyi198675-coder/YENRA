import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const s=readFileSync(new URL('../../ui/chatwoot-embed/src/client/cloud-kt-inline-script.ts',import.meta.url),'utf8');
const first=s.indexOf('  function numberVisible(row){');
const last=s.indexOf('  function paint(id,value){',first);
assert.ok(first>=0&&last>first);
const f=runInNewContext(s.slice(first,last)+';numberVisible');
const row=text=>({querySelector(sel){
 if(sel==='[processedmessagecontent]')return {getAttribute:()=>null};
 if(sel==='[data-bubble-name="text"]')return {textContent:text};
 return null;
}});
for(const input of ['+39, 3337345533','39，3337345533','39, 3337345533','0039 3337345533','3468554909','+49 17661474793']){
 test('KT lookup action visible for '+input,()=>assert.equal(f(row(input)),true));
}
// Short numbers are legitimate in some European countries (6–8 digits).
for(const input of ['211234','6111234','34412345']){
 test('European short national mobile KT action visible for '+input,
   ()=>assert.equal(f(row(input)),true));
}
for(const input of ['hello world','12345','']){
 test('no false phone affordance '+input,()=>assert.equal(f(row(input)),false));
}
