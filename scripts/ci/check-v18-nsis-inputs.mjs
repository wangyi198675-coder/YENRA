import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const info=JSON.parse(fs.readFileSync(path.join(root,'docs/v18-nsis-inputs.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
if(info.version!=='0.2.1-rc.5.20261116.18'||info.bundleCount!==42||info.dependencyCount!==32||info.pluginArchiveCount!==13||info.pinnedArchives?.length!==13)throw Error('INVALID_V18_PACKAGING_FREEZE');
const dir=process.env.YENRA_V18_FROZEN_PLUGIN_DIR??path.join(root,'baselines/v18/offline-plugins');
const missing=[],changed=[];
for(const a of info.pinnedArchives){
 if(!/^[\w.@+-]+$/.test(a.file)||!a.file.endsWith('.tgz'))throw Error('UNSAFE_OFFLINE_ARCHIVE_NAME');
 const archive=path.join(dir,a.file);
 if(!fs.existsSync(archive)){missing.push(a.id);continue}
 if(sha(fs.readFileSync(archive))!==a.sha256)changed.push(a.id);
}
console.log(JSON.stringify({gate:'exact v18 offline NSIS inputs',version:info.version,expectedPluginArchives:13,missing,shaMismatch:changed,
 status:missing.length||changed.length?'NSIS_BUILD_NOT_REPRODUCIBLE_FROM_PUBLIC_CHECKOUT':'PINNED_PLUGIN_ARCHIVES_VERIFIED_BUILD_NOT_YET_EXECUTED'},null,2));
if(missing.length||changed.length)process.exitCode=12;
