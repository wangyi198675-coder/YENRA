import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const ts=readFileSync(new URL('../../ui/chatwoot-embed/src/client/cloud-kt-inline-script.ts',import.meta.url),'utf8');
const tick=String.fromCharCode(96);
const start=ts.indexOf('String.raw'+tick);
const end=ts.lastIndexOf(tick+';');
assert.ok(start>=0&&end>start);
const script=ts.slice(start+11,end);
const store=new Map();
const storage={
 getItem:key=>store.has(key)?store.get(key):null,
 setItem:(key,value)=>{store.set(key,String(value))},
 removeItem:key=>store.delete(key),
};
function page(path='/app/accounts/196799/conversations/11'){
 const location={origin:'https://app.chatwoot.com',pathname:path};
 const window={addEventListener(){},removeEventListener(){}};
 const document={querySelectorAll:()=>[],body:{},hidden:false,
  addEventListener(){},removeEventListener(){}};
 class MutationObserver{observe(){} disconnect(){}}
 const ctx={
  window,location,document,
  localStorage:storage,MutationObserver,setInterval:()=>1,clearInterval:()=>{},
  requestAnimationFrame:fn=>fn(),queueMicrotask:fn=>fn(),console:{info(){}},
 };
 assert.equal(runInNewContext(script,ctx),true);
 return {ctx,api:window.__yenraCloudKtV1};
}
test('same verified account+contact country is remembered once',()=>{
 const {api}=page();
 assert.equal(api.countryFor(11,154321),null);
 assert.equal(api.rememberCountry(11,154321,'IT'),true);
 assert.equal(api.countryFor(11,154321),'IT');
});
test('new Cloud document retains owner confirmation with the same partition',()=>{
 assert.equal(page().api.countryFor(11,154321),'IT');
});
test('a different contact does not inherit any country',()=>{
 assert.equal(page().api.countryFor(11,154322),null);
});
test('different conversation route cannot read prior selection while off-route',()=>{
 assert.equal(page('/app/accounts/196799/conversations/12').api.countryFor(11,154321),null);
});
test('invalid country format and contact identifiers never persist',()=>{
 const {api}=page();
 assert.equal(api.rememberCountry(11,154321,'IT/DE'),false);
 assert.equal(api.rememberCountry(11,0,'IT'),false);
 assert.equal(api.countryFor(11,154321),'IT');
});
test('v2 preserves country and manual UI provenance, never phone text',()=>{
 const keys=[...store.keys()];
 assert.deepEqual(keys,['yenra:kt:confirmed-country:v2:196799:154321']);
 const record=JSON.parse(store.get(keys[0]));
 assert.equal(record.v,2);
 assert.equal(record.iso2,'IT');
 assert.equal(record.contactId,154321);
 assert.equal(record.source,'manual-ui');
 assert.ok(Number.isSafeInteger(record.confirmedAt));
 assert.ok(!JSON.stringify(record).includes('phone'));
});
test('legacy unproven v1 country hints are not usable for automatic KT lookup',()=>{
 store.set('yenra:kt:confirmed-country:v1:196799:154399','FR');
 const {api}=page();
 assert.equal(api.countryFor(11,154399),null);
 assert.equal(api.rememberCountry(11,154399,'FR'),true);
 assert.equal(api.countryFor(11,154399),'FR');
 assert.equal(store.has('yenra:kt:confirmed-country:v1:196799:154399'),false);
});
test('forged or malformed v2 storage cannot silently override Cloud identity',()=>{
 const id=154400,key='yenra:kt:confirmed-country:v2:196799:'+id;
 const api=page().api;
 for(const payload of [
  'FR',
  JSON.stringify({v:2,source:'manual-ui',iso2:'FR',contactId:id}),
  JSON.stringify({v:2,source:'unknown',iso2:'FR',contactId:id,confirmedAt:Date.now()}),
  JSON.stringify({v:2,source:'manual-ui',iso2:'FR',contactId:id+1,confirmedAt:Date.now()}),
  JSON.stringify({v:2,source:'manual-ui',iso2:'FR',contactId:id,confirmedAt:Date.now()+60000})
 ]){store.set(key,payload);assert.equal(api.countryFor(11,id),null);}
});
