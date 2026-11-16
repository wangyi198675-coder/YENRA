import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const dirs=['social-adapters/chatwoot-bridge','social-adapters/chatwoot-cloud-direct',
 'social-adapters/kt-dedupe-native','ui/chatwoot-embed/src',
 'ui/chatwoot-embed/desktop-integration-candidate/src','ui/desktop-candidate/src',
 'ui/personal-chrome','ui/private-themes','ui/typography-fix'];
const errors=[];
let checked=0;
for(const rel of dirs){
 const base=path.join(root,rel);
 if(!fs.existsSync(base))continue;
 function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name);
   if(entry.isDirectory()){
    if(!['node_modules','lib','build','dist'].includes(entry.name))walk(file);
   } else if(/\.(?:mjs|cjs|js)$/.test(entry.name)){
    // This source template has an intentional CSS sentinel, filled by build.mjs.
    if(path.relative(root,file).replaceAll('\\','/')==='ui/personal-chrome/client-entry.js')continue;
    try{execFileSync(process.execPath,['--check',file],{stdio:'pipe'});checked++;}
    catch(e){errors.push(path.relative(root,file)+': '+String(e.stderr??e.message).slice(0,500));}
   }
  }
 }
 walk(base);
}
console.log(JSON.stringify({gate:'JavaScript parser',checked,errors:errors.slice(0,40)},null,2));
if(errors.length)process.exitCode=1;
