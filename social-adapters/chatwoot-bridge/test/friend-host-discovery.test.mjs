import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFriendHostBaseUrl} from '../src/friend-host-discovery.mjs';
const ref='c'.repeat(32);
const good={ok:true,roster:{accounts:[{channel:'WhatsApp',accountRef:ref,rooms:[]}]}};
const headers={get:name=>name==='content-type'?'application/json; charset=utf-8':null};
const response=data=>({ok:true,headers,json:async()=>data});
test('resolves only the verified original local Host (not first open port)',async()=>{
 const calls=[];
 const url=await resolveFriendHostBaseUrl({ports:[54555,51734],fetchImpl:async path=>{
  calls.push(path);
  return response(path.includes(':51734/')?good:{ok:true,accounts:[]});
 }});
 assert.equal(url,'http://127.0.0.1:51734');
 assert.equal(calls.length,2);
 assert.ok(calls.every(u=>u.startsWith('http://127.0.0.1:')));
});
test('refuses ambiguous multiple verified Hosts',async()=>{
 await assert.rejects(resolveFriendHostBaseUrl({
  ports:[51734,60474],fetchImpl:async()=>response(good),
 }),/AMBIGUOUS/);
});
test('never trusts unrelated localhost web content or no native WhatsApp',async()=>{
 await assert.rejects(resolveFriendHostBaseUrl({
  ports:[60474],fetchImpl:async()=>response({ok:true,accounts:[{channel:'Page',accountRef:ref}]}),
 }),/UNAVAILABLE/);
});
test('rejects remote, privileged or invalid listener candidates',async()=>{
 await assert.rejects(resolveFriendHostBaseUrl({ports:[443]}),/CANDIDATES_INVALID/);
 await assert.rejects(resolveFriendHostBaseUrl({ports:[90000]}),/CANDIDATES_INVALID/);
 await assert.rejects(resolveFriendHostBaseUrl({ports:[51734,'8.8.8.8']}),/CANDIDATES_INVALID/);
});

import {HostClient} from '../src/host-client.mjs';
test('friend HostClient heals a restarted native port without any new sender',async()=>{
 const called=[];
 const host=new HostClient({baseUrl:'http://127.0.0.1:60474',
  resolveHostBaseUrl:async()=> 'http://127.0.0.1:51734',
  fetchImpl:async path=>{
   called.push(path);
   if(path.includes(':60474/'))throw Error('native host restarted');
   return {ok:true,json:async()=>good};
  },
 });
 const roster=await host.readRoster({refresh:true});
 assert.equal(roster.accounts.length,1);
 assert.equal(host.baseUrl,'http://127.0.0.1:51734');
 assert.deepEqual(called.map(x=>new URL(x).port),['60474','51734']);
});
test('friend HostClient refuses an external replacement Host URL',async()=>{
 const host=new HostClient({baseUrl:'http://127.0.0.1:60474',
  resolveHostBaseUrl:async()=> 'https://attacker.example:51734',
  fetchImpl:async()=>{throw Error('offline')},
 });
 await assert.rejects(host.readRoster({refresh:true}),/HOST_NETWORK_ERROR/);
 assert.equal(host.baseUrl,'http://127.0.0.1:60474');
});


import {officialHostRecoveryPowerShell} from '../src/host-client.mjs';
test('owner Host recovery recognizes official installed YENRA.exe and preview electron.exe, rejecting untrusted or ambiguous listeners',()=>{
 const cmd=officialHostRecoveryPowerShell();
 assert.match(cmd,/electron\.exe/);
 assert.match(cmd,/YENRA\.exe/);
 assert.match(cmd,/dsh-desktop-host/);
 assert.match(cmd,/--expose-internals/);
 assert.match(cmd,/profiles\\desktop/);
 assert.match(cmd,/127\.0\.0\.1/);
 assert.match(cmd,/\$p\.Count -ne 1/);
 assert.match(cmd,/\$l\.Count -ne 1/);
 assert.match(cmd,/32649,32650,9230/);
 assert.doesNotMatch(cmd,/Invoke-RestMethod|Invoke-WebRequest|Start-Process|Stop-Process|Remove-Item/);
});
