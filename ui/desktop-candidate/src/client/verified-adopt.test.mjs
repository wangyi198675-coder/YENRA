import test from 'node:test'
import assert from 'node:assert/strict'
import {confirmVerifiedAdoption} from './verified-adopt.ts'

const target={accountRef:'account-A',roomRef:'room-A'}
test('original OSS synchronous adoption remains supported',async()=>{
  const calls=[]
  const accepted=await confirmVerifiedAdoption((a,r,t)=>{
    calls.push([a,r,t]);return true
  },target,'  Hallo  ',()=>true)
  assert.equal(accepted,true)
  assert.deepEqual(calls,[['account-A','room-A','Hallo']])
})
test('Chatwoot adoption waits for actual async true',async()=>{
  let resolve
  const pending=new Promise(done=>{resolve=done})
  let settled=false
  const operation=confirmVerifiedAdoption(()=>pending,target,'Hallo',()=>true)
    .then(value=>{settled=true;return value})
  await Promise.resolve()
  assert.equal(settled,false)
  resolve(true)
  assert.equal(await operation,true)
})
test('async false and rejected insertion are never success',async()=>{
  assert.equal(await confirmVerifiedAdoption(async()=>false,target,'Hallo',()=>true),false)
  assert.equal(await confirmVerifiedAdoption(async()=>{throw Error('stale composer')},target,'Hallo',()=>true),false)
})
test('selection changed while adoption is pending suppresses success',async()=>{
  let selected=true,resolve
  const pending=new Promise(done=>{resolve=done})
  const operation=confirmVerifiedAdoption(()=>pending,target,'Hallo',()=>selected)
  selected=false
  resolve(true)
  assert.equal(await operation,false)
})
test('unselected contact cannot invoke adapter',async()=>{
  let calls=0
  const accepted=await confirmVerifiedAdoption(()=>{calls++;return true},target,'Hallo',()=>false)
  assert.equal(accepted,false)
  assert.equal(calls,0)
})
test('nonboolean truthy result, missing callback, and empty text fail closed',async()=>{
  assert.equal(await confirmVerifiedAdoption(async()=>1,target,'Hallo',()=>true),false)
  assert.equal(await confirmVerifiedAdoption(null,target,'Hallo',()=>true),false)
  assert.equal(await confirmVerifiedAdoption(()=>true,target,' ',()=>true),false)
})

test('Cloud inbox adapter is wired to original Brain and its result awaited',async()=>{
  const {readFile}=await import('node:fs/promises')
  const ui=await readFile(new URL('./ui.tsx',import.meta.url),'utf8')
  const chatwoot=await readFile(new URL('../../../chatwoot-embed/src/client/embed.tsx',import.meta.url),'utf8')
  assert.match(ui,/bindAdoptDraft:\(adapter:VerifiedAdoptAdapter\|null\)/)
  assert.match(ui,/await confirmVerifiedAdoption\(/)
  assert.match(ui,/if\(!stillOnContact\(\)\)return/)
  assert.match(chatwoot,/bindAdoptDraft\?\.\(/)
})
test('modify action keeps native DSH draft and does not invoke social Sender',async()=>{
  const {readFile}=await import('node:fs/promises')
  const cards=await readFile(new URL('./native-reply-cards.tsx',import.meta.url),'utf8')
  const rewrite=cards.slice(cards.indexOf('function applyRewrite('),cards.indexOf('function mountInlineActions('))
  assert.match(rewrite,/inputActions\.setDraft\(/)
  assert.match(rewrite,/inputActions\.persistDraft\(\)/)
  assert.doesNotMatch(rewrite,/sendNativeText|sendNativeMedia|social-text-send/)
})
