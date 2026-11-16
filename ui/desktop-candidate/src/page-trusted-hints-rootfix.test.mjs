import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createOriginalPageIdentityHints} from './original-page-identity-hints.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const page={accountName:'page-owner-fixture',pageId:'1203748086150141'};
const refOf=(p,revision)=>sha('FB_PAGE|'+p.accountName+'|'+p.pageId+'|'+revision);
const scope={revision:4,pages:[page]};
const roomId='page:'+page.pageId+':room-sub-1234';
const row={pageId:page.pageId,accountName:page.accountName,bindingRevision:'4',
 channel:'FB_PAGE',source:'PANCAKE_OFFICIAL_READ_ONLY',canSend:false,readOnly:true,
 roomId,conversationId:'room-sub-1234',customerFromId:'provider-12345',
 displayName:'Fixture',lastMessageTimestamp:Date.now()-1000};
test('verified Page hint matches exact account revision and opaque room only',async()=>{
 const record=new Map();
 const adapter=createOriginalPageIdentityHints({
  refOf,sha,openTable:async()=>({get:key=>record.get(key),put:async(key,v)=>record.set(key,v)})
 });
 const ref=refOf(page,scope.revision),opaque=sha(ref+'\0'+roomId);
 assert.equal(await adapter.save(scope,page,{accountRef:ref,partial:false},[row]),true);
 const verified=await adapter.byOpaqueRef(scope,ref,opaque);
 assert.equal(verified?.roomId,roomId);
 assert.equal(await adapter.byOpaqueRef(scope,ref,sha(ref+'\0'+'other-room')),null);
 assert.equal(await adapter.byOpaqueRef({revision:5,pages:[page]},ref,opaque),null);
 assert.equal(await adapter.byOpaqueRef(scope,sha('other-account'),opaque),null);
});
test('Host no longer depends only on old W25 for archived Page Brain identity',()=>{
 const src=readFileSync(new URL('./facebook-social-commands.ts',import.meta.url),'utf8');
 assert.match(src,/if\(!nativeRoomId&&pageHints\)\{/);
 assert.match(src,/pageHints\.byOpaqueRef\(scope,actual,args\.roomRef\)/);
 assert.match(src,/hint\.source==='PANCAKE_OFFICIAL_READ_ONLY'/);
 assert.match(src,/hint\.readOnly===true&&hint\.canSend===false/);
 assert.match(src,/sha\(actual\+'\\0'\+hint\.roomId\)===args\.roomRef/);
});
test('Page 429 recovery never bypasses the original Host scope/SDK read checks',()=>{
 const src=readFileSync(new URL('./facebook-social-commands.ts',import.meta.url),'utf8');
 const start=src.indexOf('async function pageRoom(');
 const end=src.indexOf('if(current?.ok!==true',start);
 const block=src.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.ok(block.includes('const verified=await getPageScope(input.accountRef)'));
 assert.ok(block.includes('await sdk.fetchMessages(item.roomId)'));
 assert.ok(block.includes('const historical=await pageHistoricalFallback'));
 assert.ok(block.indexOf('const historical=await pageHistoricalFallback')<block.indexOf('readVerifiedSendPulsePageFallback'));
 assert.ok(block.includes("code==='PAGE_PROVIDER_RATE_LIMITED'"));
 assert.ok(block.includes('item.pageId===verified.page.pageId'));
 assert.ok(block.includes('item.accountName===verified.page.accountName'));
 assert.ok(block.includes('providerPeerId:item.customerFromId'));
 assert.ok(block.includes('throw e'));
});

test('SendPulse live inbound identity can reuse authenticated original hints but never trust a name',()=>{
 const src=readFileSync(new URL('./facebook-social-commands.ts',import.meta.url),'utf8');
 const start=src.indexOf('export async function resolveSendPulseW25PagePeer(');
 const end=src.indexOf('async function pageSdk()',start);
 const block=src.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.ok(block.includes('await sdk.scope()'));
 assert.ok(block.includes('pageAccountRef(pages[0],current.revision)'));
 assert.ok(block.includes('recentPageRows.get(accountRef)'));
 assert.ok(block.includes('pageHints.get(current,accountRef)'));
 assert.ok(block.includes('page_verified_roster_index'));
 assert.ok(block.includes('v.customerFromId===providerPeerId'));
 assert.ok(block.includes("v.source==='PANCAKE_OFFICIAL_READ_ONLY'"));
 assert.ok(block.includes("v.readOnly===true&&v.canSend===false"));
 assert.ok(block.includes('if(ambiguous||roomIds.size!==1)return null'));
 assert.ok(!block.includes('displayName==='));
});
