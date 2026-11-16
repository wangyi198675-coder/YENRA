import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativePersonaApi } from './native-persona-api.ts'

const SID='session-brain'
const CWD='C:/candidate'
const canonical={name:'Yeonhee · 完整人格 CCv3',text:'canonical full CCv3'}
function fixture({mode='session',pick='other',enabled=true}:{mode?:string;pick?:string|null;enabled?:boolean}={}){
  const picks=new Map<string,string>()
  if(pick)picks.set(SID,pick)
  const catalog=[{id:'yeonhee',name:canonical.name,enabled:true,text:canonical.text},
    {id:'other',name:'Owner selected other',enabled:true,text:'other persona'},
    {id:'global',name:'Global',enabled:true,text:'global persona'}]
  const actions:Record<string,unknown>[]=[]
  let reads=0
  let corrupt=false
  let failed=false
  let modeNow=mode
  const snapshot=(sid:string)=>{
    const selected=picks.get(sid)
    const persona=catalog.find(p=>p.id===selected)
    const off=selected==='none'
    const effective=modeNow==='session'&&off?null:
      modeNow==='session'&&persona?.enabled?{...persona,source:'session'}:{...catalog.find(p=>p.id==='global')!,source:'global'}
    return {enabled,active:!!effective,mode:modeNow,sessionId:sid,sessionOff:off,
      sessionPersona:persona?{id:persona.id,name:persona.name}:null,
      effective:corrupt?null:effective,currentName:'Global',chars:effective?.text.length??0,personas:catalog}
  }
  const api=createNativePersonaApi(async(input,init)=>{
    const url=new URL(input,'http://localhost')
    const reply=(value:unknown)=>new Response(JSON.stringify({ok:true,value}))
    if(url.pathname.endsWith('/status')){reads++;return reply(snapshot(url.searchParams.get('sessionId')!))}
    if(url.pathname.endsWith('/persona'))return reply(catalog.find(p=>p.id===url.searchParams.get('id')))
    const action=JSON.parse(String(init?.body))
    actions.push(action)
    if(failed)return new Response(JSON.stringify({ok:false,error:'test rejection'}))
    if(action.action==='import')catalog.push({id:'imported',name:action.name,text:action.text,enabled:true})
    else if(action.action==='set-session-persona'){
      picks.delete(action.sessionId)
      picks.set(action.sessionId,action.none?'none':action.personaId)
      while(picks.size>200)picks.delete(picks.keys().next().value!)
    }else throw Error('Forbidden global/library mutation: '+action.action)
    return reply(snapshot(action.sessionId))
  },canonical)
  return {api,actions,picks,catalog,get reads(){return reads},set corrupt(v:boolean){corrupt=v},set failed(v:boolean){failed=v},set mode(v:string){modeNow=v}}
}

test('owner other selection is preserved by initialization and every fresh preflight',async()=>{
  const f=fixture()
  await f.api.ensure(SID,CWD,{allowDefault:true})
  await f.api.revalidate(SID,CWD)
  await f.api.revalidate(SID,CWD)
  assert.equal(f.picks.get(SID),'other')
  assert.equal(f.reads,6)
  assert.ok(f.actions.every(a=>a.action==='set-session-persona'&&a.personaId==='other'))
})
test('explicit off is renewed without fallback or canonical import',async()=>{
  const f=fixture({pick:'none'})
  await f.api.ensure(SID,CWD,{allowDefault:true})
  const state=await f.api.revalidate(SID,CWD)
  assert.equal(state.effective,null)
  assert.ok(f.actions.every(a=>a.none===true))
})
for(const mode of ['global','workspace'])test(mode+' mode is fail-closed without ANY mutation',async()=>{
  const f=fixture({mode,pick:null})
  await assert.rejects(f.api.ensure(SID,CWD,{allowDefault:true}),/不会修改全局/)
  await assert.rejects(f.api.select(SID,CWD,{personaId:'other'}),/不会修改全局/)
  await assert.rejects(f.api.revalidate(SID,CWD),/不会修改全局/)
  assert.equal(f.actions.length,0)
})
test('missing old-session pick blocks rather than guessing Yeonhee',async()=>{
  const f=fixture({pick:null})
  await assert.rejects(f.api.ensure(SID,CWD),/200/)
  await assert.rejects(f.api.revalidate(SID,CWD),/200/)
  assert.equal(f.actions.length,0)
})
test('only explicitly authorized new-session bootstrap selects canonical',async()=>{
  const f=fixture({pick:null})
  await f.api.ensure(SID,CWD,{allowDefault:true})
  assert.equal(f.picks.get(SID),'yeonhee')
  assert.equal(f.actions.length,1)
})
test('bootstrap imports canonical only into the original native library',async()=>{
  const f=fixture({pick:null})
  f.catalog.splice(0,1)
  await f.api.ensure(SID,CWD,{allowDefault:true})
  assert.deepEqual(f.actions.map(a=>a.action),['import','set-session-persona'])
  assert.equal(f.picks.get(SID),'imported')
})
test('same-name incorrect card is not overwritten or used as canonical',async()=>{
  const f=fixture({pick:null})
  f.catalog[0].text='not the canonical CCv3'
  await assert.rejects(f.api.ensure(SID,CWD,{allowDefault:true}),/不一致/)
  assert.equal(f.actions.length,0)
})
test('disabled owner choice never silently re-enables or defaults',async()=>{
  const f=fixture()
  f.catalog[1].enabled=false
  await assert.rejects(f.api.ensure(SID,CWD,{allowDefault:true}),/停用/)
  await assert.rejects(f.api.revalidate(SID,CWD),/停用/)
  await assert.rejects(f.api.select(SID,CWD,{personaId:'other'}),/停用/)
  assert.equal(f.actions.length,0)
})
test('disabled plugin blocks all writes',async()=>{
  const f=fixture({enabled:false})
  await assert.rejects(f.api.revalidate(SID,CWD),/插件已停用/)
  assert.equal(f.actions.length,0)
})
test('owner can recover an evicted pick through an explicit native selection',async()=>{
  const f=fixture()
  for(let i=0;i<200;i++)await f.api.select('session-'+i,CWD,{personaId:'yeonhee'})
  assert.equal(f.picks.size,200)
  assert.equal(f.picks.has(SID),false)
  const before=f.actions.length
  await assert.rejects(f.api.revalidate(SID,CWD),/200/)
  assert.equal(f.actions.length,before)
  await f.api.select(SID,CWD,{personaId:'other'})
  await f.api.revalidate(SID,CWD)
  assert.equal(f.picks.size,200)
  assert.equal(f.picks.get(SID),'other')
  assert.equal(f.picks.has('session-0'),false)
})
test('revalidation renews the current native pick instead of changing capacity',async()=>{
  const f=fixture()
  for(let i=0;i<199;i++)await f.api.select('session-'+i,CWD,{personaId:'yeonhee'})
  await f.api.revalidate(SID,CWD)
  await f.api.select('session-extra',CWD,{personaId:'yeonhee'})
  assert.equal(f.picks.get(SID),'other')
  assert.equal(f.picks.has('session-0'),false)
  assert.equal(f.picks.size,200)
})
test('failed effective proof blocks; HTTP ok is not proof',async()=>{
  const f=fixture()
  f.corrupt=true
  await assert.rejects(f.api.revalidate(SID,CWD),/核验失败/)
  assert.equal(f.actions.length,0)
  await assert.rejects(f.api.select(SID,CWD,{personaId:'other'}),/核验失败/)
})
test('native API business rejection propagates and queue remains usable',async()=>{
  const f=fixture()
  f.failed=true
  await assert.rejects(f.api.revalidate(SID,CWD),/test rejection/)
  f.failed=false
  await f.api.revalidate(SID,CWD)
})
test('a mode change after initial success is detected afresh',async()=>{
  const f=fixture()
  await f.api.revalidate(SID,CWD)
  const before=f.actions.length
  f.mode='global'
  await assert.rejects(f.api.revalidate(SID,CWD),/不会修改全局/)
  assert.equal(f.actions.length,before)
})
test('legacy API without scoped fields is fail-closed',async()=>{
  const actions:string[]=[]
  const api=createNativePersonaApi(async(input)=>{
    actions.push(input)
    return new Response(JSON.stringify({ok:true,value:{mode:'session',personas:[]}}))
  },canonical)
  await assert.rejects(api.revalidate(SID,CWD),/缺少可核验的会话 API/)
  assert.equal(actions.length,1)
})
test('same-session concurrent owner choice precedes queued preflight',async()=>{
  const f=fixture()
  const selected=f.api.select(SID,CWD,{personaId:'yeonhee'})
  const checked=f.api.revalidate(SID,CWD)
  await selected
  assert.equal((await checked).sessionPersona?.id,'yeonhee')
  assert.ok(f.actions.every(a=>a.personaId==='yeonhee'))
})
test('concurrent bootstrap operations do not duplicate native imports',async()=>{
  const f=fixture({pick:null})
  f.catalog.splice(0,1)
  await Promise.all([f.api.ensure(SID,CWD,{allowDefault:true}),f.api.ensure(SID,CWD,{allowDefault:true})])
  assert.equal(f.actions.filter(a=>a.action==='import').length,1)
  assert.equal(f.picks.get(SID),'imported')
})
test('evicted explicit off is never guessed as Yeonhee and can be explicitly restored',async()=>{
  const f=fixture({pick:'none'})
  for(let i=0;i<200;i++)await f.api.select('session-'+i,CWD,{personaId:'yeonhee'})
  const before=f.actions.length
  await assert.rejects(f.api.revalidate(SID,CWD),/200/)
  assert.equal(f.actions.length,before)
  await f.api.select(SID,CWD,{none:true})
  assert.equal((await f.api.revalidate(SID,CWD)).sessionOff,true)
  assert.equal(f.picks.size,200)
})
test('invalid scope fails before native calls',async()=>{
  const f=fixture()
  await assert.rejects(f.api.revalidate('wrong',CWD),/缺少/)
  await assert.rejects(f.api.select(SID,' ',{none:true}),/缺少/)
  assert.equal(f.reads,0)
})
