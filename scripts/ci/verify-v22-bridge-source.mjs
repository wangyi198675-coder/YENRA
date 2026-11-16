// YEN-15: Fail closed when reviewed public sources cannot recreate the exact
// owner v22 Bridge source. Reads hashes only; never accesses owner runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/v22-frozen-bridge-source-hashes.json'),'utf8'));
const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const invalid=[],missing=[],different=[];
if(manifest.version!=='0.2.1-rc.5.20261116.22'||manifest.files?.length!==60||manifest.schema!==1){
  console.error('YEN15_V22_FROZEN_MANIFEST_INVALID');process.exit(2);
}
const unique=new Set();
for(const item of manifest.files){
  const rel=item.path;
  if(typeof rel!=='string'||!/^social-adapters\/[a-zA-Z0-9_.\/-]+$/.test(rel)||
     rel.includes('..')||!(/^[a-f0-9]{64}$/i).test(item.sha256)||unique.has(rel)){
    invalid.push(typeof rel==='string'?rel:'invalid manifest entry');continue;
  }
  unique.add(rel);
  const full=path.join(root,rel);
  if(!tracked.has(rel)||!fs.existsSync(full)){missing.push(rel);continue;}
  if(sha(full)!==item.sha256)different.push(rel);
}
const summary={
  gate:'YEN-15 v22 frozen Bridge source equality',
  version:manifest.version,
  expected:manifest.files.length,
  exact:manifest.files.length-invalid.length-missing.length-different.length,
  missing, different, invalid,
  releaseEligible:invalid.length===0&&missing.length===0&&different.length===0
};
console.log(JSON.stringify(summary,null,2));
if(!summary.releaseEligible)process.exitCode=1;
