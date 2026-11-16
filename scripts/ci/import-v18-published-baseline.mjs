import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const frozenRoot = path.resolve(process.argv[2] ?? '');
const repo = path.resolve(process.argv[3] ?? '');
if (!fs.existsSync(path.join(frozenRoot, 'bridge/bridge-manifest.json'))) throw Error('NOT_V18_FREEZE_DIRECTORY');
if (!fs.existsSync(path.join(repo, 'docs/v18-source-hashes.json'))) throw Error('MISSING_PINNED_V18_MANIFEST');
const manifest = JSON.parse(fs.readFileSync(path.join(repo,'docs/v18-source-hashes.json'),'utf8').replace(/^\uFEFF/, ''));
const freeze = JSON.parse(fs.readFileSync(path.join(frozenRoot,'release-v18-freeze.json'),'utf8'));
const bridge = JSON.parse(fs.readFileSync(path.join(frozenRoot,'bridge/bridge-manifest.json'),'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const expectedVersion = '0.2.1-rc.5.20261116.18';
if (freeze.version !== expectedVersion || manifest.version !== expectedVersion) throw Error('BASELINE_IDENTITY_MISMATCH');
if (manifest.bridgeFiles.length !== 58 || manifest.latestFormalSources.length !== 20) throw Error('BASELINE_INVENTORY_MISMATCH');
const blocked = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN.*PRIVATE KEY-----|[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?<!\d)\+[1-9]\d{9,14}(?!\d)|C:[\\/]Users[\\/]|\b(?:Janko|Ralf|Schmeling|Franco|Vincenzo|Tommaso)\b)/i;
const cleanRel = r => {
 if (typeof r !== 'string' || !/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/i.test(r) || r.includes('..') || r.includes('node_modules')) throw Error('UNSAFE_RELATIVE_PATH');
 return r;
};
const saved = [];
function copyBaseline(entry, folder, candidatePaths) {
 const rel = cleanRel(entry.file);
 let matched = null;
 for (const candidate of candidatePaths) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
  const data = fs.readFileSync(candidate);
  if (sha(data) === String(entry.sha256).toLowerCase()) { matched = data; break; }
 }
 if (!matched) return false;
 if (blocked.test(matched.toString('utf8'))) throw Error('PRIVATE_DATA_IN_FROZEN_SOURCE:'+rel);
 const dest = path.join(repo,'baselines/v18',folder,rel);
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 if (fs.existsSync(dest) && sha(fs.readFileSync(dest)) !== sha(matched)) throw Error('IMMUTABLE_V18_SOURCE_CHANGED:'+rel);
 if (!fs.existsSync(dest)) fs.writeFileSync(dest,matched);
 saved.push({scope:folder,path:rel,sha256:entry.sha256,bytes:matched.length});
 return true;
}
const missingBridge = [];
for (const item of manifest.bridgeFiles) {
 const corresponding = bridge.files.find(x=>x.file===item.file);
 if (!corresponding || corresponding.sha256 !== item.sha256) throw Error('FROZEN_BRIDGE_MANIFEST_INCONSISTENT:'+item.file);
 const rel = cleanRel(item.file);
 if(!copyBaseline(item,'bridge',[path.join(frozenRoot,'bridge',rel)])) missingBridge.push(rel);
}
if(missingBridge.length) throw Error('MISSING_FROZEN_BRIDGE:'+missingBridge.join(','));
const missingLatest = [];
for (const item of manifest.latestFormalSources) {
 const rel = cleanRel(item.file);
 const copied = copyBaseline(item,'latest-formal',[
  path.join(frozenRoot,'bridge',rel),
  path.join(repo,rel),
 ]);
 if(!copied) missingLatest.push(rel);
}
const report = {version:expectedVersion,origin:'v18 published freeze, not v19 source tree',
 frozenBridge:manifest.bridgeFiles.length,latestFormalTotal:manifest.latestFormalSources.length,
 latestFormalRecovered:manifest.latestFormalSources.length-missingLatest.length,
 missingLatest,files:saved};
const reportPath = path.join(repo,'baselines/v18/snapshot-index.json');
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
if(fs.existsSync(reportPath)) {
 const prior=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 if(JSON.stringify(prior)!==JSON.stringify(report)) throw Error('V18_IMMUTABLE_INDEX_WOULD_CHANGE');
}else fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({frozenBridge:report.frozenBridge,latestRecovered:report.latestFormalRecovered,missingLatest},null,2));
