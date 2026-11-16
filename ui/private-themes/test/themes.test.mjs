import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PALETTES,DEFAULT_STATE,normalizeState,transition,palette,tokens,tokenPairs,needsOverlay} from '../core.js';
import {createStateStore} from '../store.js';
import {createAppearanceController} from '../appearance.js';
import {apply} from '../index.js';
const clone=value=>structuredClone(value);
const selected=(id='atelier-ivory',mode='dark')=>transition(DEFAULT_STATE,{action:'select',id,previousMode:mode});
function luminance(hex){const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test('all four palettes meet the documented text contrast pairs',()=>{
  assert.equal(PALETTES.length,4);
  for(const p of PALETTES){for(const text of ['text','secondary','muted'])for(const bg of ['base','panel','raised','overlay','input','sidebar','bubble','selected','hover'])assert(ratio(p[text],p[bg])>=4.5,`${p.id}: ${text}/${bg}`);assert(ratio(p.onAccent,p.accent)>=4.5);}
});
test('material tokens set opaque surfaces AND explicitly disable menu filter',()=>{
  for(const p of PALETTES){const v=tokens(p);assert.equal(v['--dsw-menu-backdrop-filter'],'none');for(const k of ['--dsw-menu-surface-fill','--dsw-specific-input-major','--dsw-alias-markdown-code-block','--dsw-alias-bg-overlay'])assert.match(v[k],/^#[0-9A-F]{6}$/);}
});
test('both modes are complete, preserve selected day/night pair and cover candidate overrides',()=>{
  const s={...selected(),night:'atelier-dusk'},pairs=tokenPairs(s);
  for(const v of Object.values(pairs)){assert.equal(typeof v.light,'string');assert.equal(typeof v.dark,'string');}
  const active={colorScheme:'light',tokens:{'--dsw-alias-bg-base':'#FFFFFF'}};
  assert(needsOverlay({active},pairs));
  active.tokens=Object.fromEntries(Object.entries(pairs).map(([k,v])=>[k,v.light]));assert(!needsOverlay({active},pairs));
  assert.equal(pairs['--dsw-alias-bg-base'].dark,palette('atelier-dusk').base);
});
test('trial undo restores THIS trial baseline rather than first-ever theme',()=>{
  let s=selected('atelier-ivory','dark');
  s=transition(s,{action:'select',id:'atelier-porcelain'});
  assert.equal(s.baseline.mode,'dark');
  s=transition(s,{action:'restore'});assert.equal(s.enabled,false);assert.equal(s.mode,'dark');
  s=transition(s,{action:'select',id:'atelier-dusk',previousMode:'light'});
  s=transition(s,{action:'restore'});assert.equal(s.mode,'light');
});
test('commit establishes a new baseline; undo retains independent favourites',()=>{
  let s=transition(selected(),{action:'commit'});
  assert.equal(s.baseline,null);
  s=transition(s,{action:'select',id:'atelier-dusk'});
  s=transition(s,{action:'favourite',id:'atelier-porcelain',enabled:true});
  s=transition(s,{action:'restore'});
  assert.equal(s.enabled,true);assert.equal(s.day,'atelier-ivory');assert.equal(s.mode,'light');assert.deepEqual(s.favourites,['atelier-porcelain']);
});
test('invalid IDs, wrong actions and stale revisions are rejected',()=>{
  assert.throws(()=>transition(DEFAULT_STATE,{action:'select',id:'not-a-theme'}));
  assert.throws(()=>transition(DEFAULT_STATE,{action:'restore'}));
  assert.throws(()=>transition(selected(),{action:'disable',expectedRevision:0}),/REVISION_CONFLICT/);
  assert.equal(normalizeState({day:'atelier-dusk'}).day,DEFAULT_STATE.day);
});
test('store serializes CAS across callers and idempotent favourites do not flip',async()=>{
  let value=clone(DEFAULT_STATE),writes=0;
  const store=createStateStore({read:()=>value,write:async next=>{writes++;value=clone(next);}});
  const [a,b]=await Promise.all([store.operate({action:'select',id:'atelier-ivory',expectedRevision:0}),store.operate({action:'select',id:'atelier-dusk',expectedRevision:0})]);
  assert(a.ok);assert.equal(b.code,'conflict');assert.equal(writes,1);
  await store.operate({action:'favourite',id:'atelier-dusk',enabled:true});const revision=value.revision;
  await store.operate({action:'favourite',id:'atelier-dusk',enabled:true});assert.equal(value.revision,revision);assert.deepEqual(value.favourites,['atelier-dusk']);
  await store.close();assert.equal((await store.operate({action:'get'})).code,'closed');
});
test('saved state survives reopening independently of Client origin/port',async()=>{
  let durable=clone(DEFAULT_STATE);
  const make=()=>createStateStore({read:()=>durable,write:async value=>{durable=clone(value);}});
  const first=make();await first.operate({action:'select',id:'atelier-dusk'});await first.operate({action:'commit'});await first.close();
  const second=make(),result=await second.operate({action:'get'});assert(result.ok);assert.equal(result.state.night,'atelier-dusk');assert.equal(result.state.mode,'dark');assert.equal(result.state.baseline,null);await second.close();
});
test('failed durable write does not publish a successful optimistic state',async()=>{
  const initial=clone(DEFAULT_STATE),store=createStateStore({read:()=>initial,write:async()=>{throw new Error('disk failure');}});
  const result=await store.operate({action:'select',id:'atelier-dusk'});assert.equal(result.ok,false);assert.equal(initial.revision,0);assert.equal(initial.enabled,false);await store.close();
});
// Service-face test double only: deliberately no DOM/React or screenshot simulation.
function themeFace(initial='dark') {
  let pref=initial,revision=0,fonts={text:14},sequence=0;
  const layers=new Map(),listeners=new Set(),writes=[];
  const snapshot=()=>{const scheme=pref==='system'?'light':pref;const result={};for(const layer of [...layers.values()].sort((a,b)=>a.seq-b.seq))for(const [key,v] of Object.entries(layer.pairs))result[key]=v[scheme];return{preference:pref,revision,fontSizes:fonts,active:{id:scheme,colorScheme:scheme,tokens:result}};};
  const emit=()=>{revision++;for(const listener of [...listeners])listener(snapshot());};
  const theme={getTheme:snapshot,setTheme(id){assert(['light','dark','system'].includes(id),'Never use ephemeral custom IDs');writes.push(id);pref=id;emit();},overrideTokens(source,pairs){const item={pairs,seq:sequence++};layers.set(source,item);emit();return()=>{if(layers.get(source)===item){layers.delete(source);emit();}};}};
  return {theme,writes,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},fontSync(){fonts={text:16};emit();},external(id){pref=id;emit();},candidate(){theme.overrideTokens('candidate',{'--dsw-alias-bg-base':{light:'#FFFFFF',dark:'#10151D'}});},layers};
}
test('disabled startup does not change the existing host appearance',()=>{
  const face=themeFace('dark'),controller=createAppearanceController({...face});controller.apply(DEFAULT_STATE,tokenPairs(DEFAULT_STATE));assert.deepEqual(face.writes,[]);controller.dispose();
});
test('font adoption retains private overlay without custom-ID preference writes',()=>{
  const face=themeFace(),controller=createAppearanceController({...face}),s=selected();
  controller.apply(s,tokenPairs(s));assert.deepEqual(face.writes,['light']);face.fontSync();
  assert.equal(face.theme.getTheme().fontSizes.text,16);assert.equal(face.theme.getTheme().active.tokens['--dsw-alias-bg-base'],palette(s.day).base);assert.deepEqual(face.writes,['light']);controller.dispose();
});
test('late candidate override is re-stacked once, without recursion or preference churn',()=>{
  const face=themeFace(),controller=createAppearanceController({...face}),s=selected();controller.apply(s,tokenPairs(s));face.candidate();
  assert.equal(face.theme.getTheme().active.tokens['--dsw-alias-bg-base'],palette(s.day).base);assert.deepEqual(face.writes,['light']);controller.dispose();assert.equal(face.layers.size,1);
});
test('native night/system switching uses the saved matching palette and only notifies',()=>{
  const face=themeFace(),modes=[],controller=createAppearanceController({...face,onExternalMode:mode=>modes.push(mode)}),s={...selected(),night:'atelier-dusk'};
  controller.apply(s,tokenPairs(s));face.external('dark');assert.equal(face.theme.getTheme().active.tokens['--dsw-alias-bg-base'],palette('atelier-dusk').base);assert.deepEqual(modes,['dark']);assert.deepEqual(face.writes,['light']);controller.dispose();
});
test('undo restores original mode and disposes only the private layer',()=>{
  const face=themeFace('dark'),controller=createAppearanceController({...face}),s=selected('atelier-ivory','dark');controller.apply(s,tokenPairs(s));const restored=transition(s,{action:'restore'});controller.apply(restored,tokenPairs(restored));assert.equal(face.theme.getTheme().preference,'dark');assert.equal(face.layers.size,0);controller.dispose();
});
test('re-enabling the same day theme overrides a native night switch while disabled',()=>{
  const face=themeFace('dark'),controller=createAppearanceController({...face});let s=selected();
  controller.apply(s,tokenPairs(s));s=transition(s,{action:'disable'});controller.apply(s,tokenPairs(s));
  face.external('dark');s=transition(s,{action:'select',id:'atelier-ivory',previousMode:'dark'});controller.apply(s,tokenPairs(s));
  assert.equal(face.theme.getTheme().preference,'light');assert.equal(face.theme.getTheme().active.tokens['--dsw-alias-bg-base'],palette('atelier-ivory').base);controller.dispose();
});
test('actual Host adapter: HTTP and tool use the same validated durable operation',async()=>{
  let durable,closed=false;const routes=new Map(),tools=new Map(),disposers=[],events=new Map();
  const ctx={storageDomain:{async open(spec){assert.match(spec.name,/^[a-z][a-z0-9_]*$/,'Storage unit names must be SQL-safe identifiers');durable=clone(spec.global.initial);return{name:spec.name,global:{get:()=>durable,set:async value=>{spec.global.schema.parse(value);durable=clone(value);events.get('domain/changed')?.({domain:spec.name,table:'',operation:'put',value:durable});}},close:async()=>{closed=true;}};}},connection:{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}},tools:{register:tool=>{tools.set(tool.name,tool);return()=>tools.delete(tool.name);}},on(name,fn){events.set(name,fn);return()=>events.delete(name);},effect(fn){const dispose=fn();if(dispose)disposers.push(dispose);return dispose;}};
  await apply(ctx);const root=routes.get('/api/yenra-private-themes'),tool=tools.get('yenra_private_themes');assert(root&&tool);
  const selected=await tool.execute({action:'select',id:'atelier-ivory',previousMode:'dark',expectedRevision:0});assert(selected.ok);
  let response=await root.fetch(new Request('http://local/api/yenra-private-themes'));let data=await response.json();assert.equal(data.state.revision,selected.state.revision);assert.equal(data.state.baseline.mode,'dark');
  response=await root.fetch(new Request('http://local/api/yenra-private-themes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'favourite',id:'atelier-dusk',enabled:true,expectedRevision:1})}));assert.equal(response.status,200);data=await tool.execute({action:'get'});assert.deepEqual(data.state.favourites,['atelier-dusk']);
  response=await root.fetch(new Request('http://local/api/yenra-private-themes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'disable',expectedRevision:0})}));assert.equal(response.status,409);assert.equal(durable.enabled,true);
  response=await root.fetch(new Request('http://local/api/yenra-private-themes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'favourite',id:'atelier-dusk'})}));assert.equal(response.status,400);
  const abort=new AbortController(),streamResponse=await routes.get('/api/yenra-private-themes/events').fetch(new Request('http://local/api/yenra-private-themes/events',{signal:abort.signal})),reader=streamResponse.body.getReader();const initial=await reader.read();assert.match(new TextDecoder().decode(initial.value),/"favourites":\["atelier-dusk"\]/);await reader.cancel();abort.abort();
  for(const dispose of disposers.reverse())await dispose();assert(closed);
});
