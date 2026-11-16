import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const packages=[
 'ui/chatwoot-embed/package.json',
 'ui/chatwoot-embed/desktop-integration-candidate/package.json',
 'ui/desktop-candidate/package.json',
 'ui/personal-chrome/package.json',
 'ui/private-themes/package.json',
 'ui/typography-fix/package.json',
 'social-adapters/chatwoot-bridge/package.json',
 'social-adapters/kt-dedupe-native/package.json'
];
const forbiddenDirect=new Set([
 'electron','electron-builder','better-sqlite3','sqlite3','@prisma/client',
 'typeorm','sequelize','mongoose','@anthropic-ai/sdk','openai',
 '@deepseek-ai/dsh-subagent-codex','@deepseek-ai/dsh-subagent-claude-code'
]);
const errors=[];
for(const name of packages){
 const full=path.join(root,name);
 if(!fs.existsSync(full)) {errors.push('missing manifest: '+name);continue;}
 const p=JSON.parse(fs.readFileSync(full,'utf8').replace(/^\uFEFF/,''));
 for(const group of ['dependencies','optionalDependencies','peerDependencies']){
  for(const pkg of Object.keys(p[group]??{})){
   if(forbiddenDirect.has(pkg))errors.push(name+': direct '+group+' adds a second Electron/chat DB/agent or model gateway: '+pkg);
  }
 }
}
const bridge=JSON.parse(fs.readFileSync(path.join(root,'social-adapters/chatwoot-bridge/package.json'),'utf8'));
if(bridge.name!=='@yenra/chatwoot-bridge') errors.push('unexpected bridge identity');
const sourceVersion=JSON.parse(fs.readFileSync(path.join(root,'docs/v18-source-hashes.json'),'utf8').replace(/^\uFEFF/,'')).version;
if(sourceVersion!=='0.2.1-rc.5.20261116.18')errors.push('baseline version must stay pinned');
console.log(JSON.stringify({gate:'manifest-level architecture invariants',checked:packages.length,failures:errors},null,2));
if(errors.length)process.exitCode=1;
