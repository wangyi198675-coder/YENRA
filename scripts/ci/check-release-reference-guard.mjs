import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const names = [
  'Build-YENRA-P0-OfficialNSIS-v18-OwnerOnly-20261116.mjs',
  'Verify-YENRA-P0-v18-NSIS-20261116.mjs',
];
const checks=[];
const env={...process.env};
delete env.YENRA_ALLOW_ARCHIVAL_V18_SCRIPT;
for(const name of names){
  const file=path.join(root,'scripts/release-reference',name);
  if(!fs.existsSync(file))throw Error('missing guarded reference '+name);
  const code=fs.readFileSync(file,'utf8');
  const localHome=['C:','Users','1','Documents'].join('/');
  const localWindowsHome=['C:','Users','1','Documents'].join('\\');
  if(code.includes(localHome)||code.includes(localWindowsHome)||code.includes('196799'))
    throw Error('source reference contains owner identifiers '+name);
  const result=spawnSync(process.execPath,[file],{cwd:root,env,encoding:'utf8',timeout:15000});
  if(result.status===0||!String(result.stderr??'').includes('YEN-15_UNRELEASED_REFERENCE_ONLY'))
    throw Error('release reference is not fail closed '+name);
  checks.push({name,guard:'blocked by default'});
}
console.log(JSON.stringify({gate:'archival v18 scripts never build/install in CI',checks},null,2));
