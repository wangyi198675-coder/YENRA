import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const upstream=path.join(root,'upstream/official-source');
const patch=path.join(root,'patches/deepseek-harness-v18-owner-integration.patch');
const expectedBase='b830ec950faba0a46dda564be3e2d854afed94f1';
if(!fs.existsSync(patch))throw Error('missing YENRA DSH integration patch');
if(!fs.existsSync(path.join(upstream,'.git')))throw Error('missing pinned DSH checkout');
const base=execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(base!==expectedBase)throw Error('DSH base mismatch; refusing to apply YENRA overlay: '+base);
// Fresh Windows runners can have core.autocrlf=true, while the pinned patch
// is generated from Git blobs with LF. Normalize ONLY this disposable CI checkout.
if(process.platform==='win32'){
  execFileSync('git',['-C',upstream,'config','core.autocrlf','false'],{stdio:'pipe'});
  execFileSync('git',['-C',upstream,'checkout-index','--all','--force'],{stdio:'pipe'});
}
const data=fs.readFileSync(patch,'utf8');
const names=[...data.matchAll(/^diff --git a\/([^\r\n]+) b\/([^\r\n]+)/gm)].map(x=>x[1]);
if(names.length!==27)throw Error('expected exactly 27 YENRA DSH source paths; got '+names.length);
for(const name of names){
 if(!/^(?:apps\/(?:desktop|desktop-host)\/|packages\/client\/(?:ui-conversation|ui-layout)\/)/.test(name))
   throw Error('unexpected third-party path in DSH overlay: '+name);
}
execFileSync('git',['-C',upstream,'apply','--check','--whitespace=nowarn',patch],{stdio:'pipe'});
execFileSync('git',['-C',upstream,'apply','--whitespace=nowarn',patch],{stdio:'pipe'});
const actual=execFileSync('git',['-C',upstream,'diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
if(actual.length!==27)throw Error('DSH overlay apply result differs from 27 expected paths: '+actual.length);
console.log(JSON.stringify({source:'official DSH pinned + owner integration patch',base,ownerModifiedFiles:names.length,appliedFiles:actual.length,ok:true},null,2));
