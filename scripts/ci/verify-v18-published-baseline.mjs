import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const file=path.join(root,'docs/v18-source-hashes.json');
const expectedManifestHash='7d1be9e7d3a2809e0e0b0c7d6a96149b0b8cf8cd6d7731552c36d6669993c232';
if(sha(fs.readFileSync(file))!==expectedManifestHash)throw Error('PUBLISHED_V18_FREEZE_MANIFEST_WAS_REWRITTEN');
const m=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const index=JSON.parse(fs.readFileSync(path.join(root,'baselines/v18/snapshot-index.json'),'utf8'));
if(m.version!=='0.2.1-rc.5.20261116.18'||index.version!==m.version)throw Error('V18_VERSION_INCONSISTENT');
if(m.bridgeFiles.length!==58||m.latestFormalSources.length!==20||index.frozenBridge!==58||index.latestFormalRecovered!==19)throw Error('V18_FREEZE_SCOPE_CHANGED');
const unresolved=['ui/chatwoot-embed/src/client/cloud-native-inbox.tsx'];
if(JSON.stringify(index.missingLatest)!==JSON.stringify(unresolved))throw Error('V18_MISSING_SOURCE_SCOPE_CHANGED');
const entries=[...m.bridgeFiles.map(x=>({...x,scope:'bridge'})),...m.latestFormalSources.filter(x=>!unresolved.includes(x.file)).map(x=>({...x,scope:'latest-formal'}))];
if(index.files.length!==entries.length)throw Error('V18_IMMUTABLE_FILE_INDEX_CHANGED');
const safeRel=rel=>typeof rel==='string'&&/^[\w./-]+$/.test(rel)&&!rel.includes('..')&&!rel.startsWith('/');
for(const entry of entries){
 if(!safeRel(entry.file))throw Error('UNSAFE_BASELINE_PATH');
 const record=index.files.find(x=>x.scope===entry.scope&&x.path===entry.file);
 if(!record||record.sha256!==entry.sha256)throw Error('INDEX_V18_SHA_MISMATCH:'+entry.file);
 const filename=path.join(root,'baselines/v18',entry.scope,entry.file);
 if(!fs.existsSync(filename))throw Error('V18_FROZEN_FILE_MISSING:'+entry.file);
 const bytes=fs.readFileSync(filename);
 if(sha(bytes)!==entry.sha256||record.bytes!==bytes.length)throw Error('V18_IMMUTABLE_FILE_CHANGED:'+entry.file);
}
console.log(JSON.stringify({gate:'immutable published v18 source archive',version:m.version,bridgeVerified:58,formalRecoveredVerified:19,formalUnrecovered:unresolved,status:'FROZEN_ARCHIVE_VERIFIED_BUT_NOT_COMPLETE_NSIS_SOURCE'},null,2));
