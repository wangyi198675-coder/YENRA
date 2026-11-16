import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  isCloudMemorySessionTitle,assertVerifiedCloudMemoryScope,
} from '../desktop-integration-candidate/src/cloud-memory-model-scope.ts'

const hash=(c)=>c.repeat(64)
const relation={kind:'contact',workspace:'yenra-relation-v1:'+hash('f')}
const titles=[
  ['P','Page','pageIdentityHash'],
  ['W','WhatsApp','cloudIdentityHash'],
  ['F','Personal','cloudIdentityHash'],
]
test('YEN-8: exact verified Cloud Page/WA/Personal scope is allowed',()=>{
  for(const [prefix,channel,field] of titles){
    const title='YENRA:'+prefix+':'+hash('a')
    assert.equal(isCloudMemorySessionTitle(title),true)
    assert.doesNotThrow(()=>assertVerifiedCloudMemoryScope(
      title,{...relation,channel,[field]:hash('a')}))
  }
})
test('YEN-8: owner fallback, mismatched contact, cross channel, and malformed Cloud titles denied',()=>{
  for(const [prefix,channel,field] of titles){
    const title='YENRA:'+prefix+':'+hash('a')
    const valid={...relation,channel,[field]:hash('a')}
    for(const bad of [
      {...valid,kind:'owner'},
      {...valid,workspace:'C:/Users/1/Documents/YENRA'},
      {...valid,channel:channel==='Page'?'WhatsApp':'Page'},
      {...valid,[field]:hash('b')},
      {...valid,[field]:undefined},
      {...valid,pageIdentityHash:hash('b'),cloudIdentityHash:hash('b')},
    ])assert.throws(()=>assertVerifiedCloudMemoryScope(title,bad),/拒绝/)
    for(const malformed of [
      'YENRA:'+prefix+':','YENRA:'+prefix+':'+hash('a').slice(0,63),
      'YENRA:'+prefix+':'+hash('a').toUpperCase(),
    ]){
      assert.equal(isCloudMemorySessionTitle(malformed),true)
      assert.throws(()=>assertVerifiedCloudMemoryScope(malformed,valid),/禁止回退/)
    }
  }
})
test('YEN-8: unrelated owner and old contact titles cannot pass Cloud guard',()=>{
  assert.equal(isCloudMemorySessionTitle('YENRA · 闺蜜大脑'),false)
  assert.equal(isCloudMemorySessionTitle('YENRA:B:'+hash('a')),false)
  assert.throws(()=>assertVerifiedCloudMemoryScope('YENRA · 闺蜜大脑',relation))
})
test('YEN-8: model yenra_memory uses verified Cloud branch, never owner bind for Cloud',()=>{
  const src=readFileSync(new URL('../desktop-integration-candidate/src/social-agent-actions.ts',import.meta.url),'utf8')
  const begin=src.indexOf('const memoryTitle=sessionTitle(agent)')
  const end=src.indexOf("if(action==='list')",begin)
  assert.ok(begin>0&&end>begin)
  const body=src.slice(begin,end)
  assert.match(body,/if\(isCloudMemorySessionTitle\(memoryTitle\)\)/)
  assert.match(body,/memory\.verifiedScope\(agent\)/)
  assert.match(body,/assertVerifiedCloudMemoryScope\(memoryTitle,memory\.verifiedScope\(agent\)\)/)
  assert.ok(body.indexOf('if(isCloudMemorySessionTitle')<body.indexOf("JSON.stringify({kind:'owner'})"))
  assert.ok(body.indexOf("JSON.stringify({kind:'owner'})")<end-begin)
})
