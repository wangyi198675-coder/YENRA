// Create a PUBLIC, hash-only receipt from an authorized local v19 frozen NSIS seed.
// No offline archive bytes, private resource data or absolute paths enter the receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args=process.argv.slice(2);
const value=x=>{const i=args.indexOf('--'+x);if(i<0||!args[i+1])throw Error('MISSING_'+x);return path.resolve(args[i+1])};
const seed=value('seed'),freezeFile=value('freeze'),out=value('out');
const data=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const need=(ok,s)=>{if(!ok)throw Error('V19_PRIVATE_INPUT_RECEIPT_'+s)};
const freeze=data(freezeFile),pkg=data(path.join(seed,'package.json'));
const lock=fs.readFileSync(path.join(seed,'pnpm-lock.yaml'),'utf8');
need(freeze.version==='0.2.1-rc.5.20261116.19','VERSION');
need(pkg.dsh.profile.bundles.length===42&&Object.keys(pkg.dependencies).length===32,'PROFILE');
const archiveEntries=Object.entries(pkg.dependencies).filter(([,x])=>x.startsWith('file:./packages/'));
need(archiveEntries.length===13,'ARCHIVES');
const inputs=archiveEntries.map(([id,spec])=>{
 const file=spec.slice('file:./packages/'.length);
 need(!file.includes('..')&&/^[A-Za-z0-9._-]+\.tgz$/.test(file),'ARCHIVE_NAME');
 const full=path.join(seed,'packages',file),bytes=fs.readFileSync(full);
 const integrity='sha512-'+crypto.createHash('sha512').update(bytes).digest('base64');
 need(lock.includes(integrity),'LOCKFILE_INTEGRITY_'+id);
 return {id,file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),lockfileIntegrity:integrity};
});
const resources=[['KT',freeze.originalKT,1317],['grammar',freeze.originalGrammar,4]].map(([kind,p,count])=>{
 const mp=path.join(p,'manifest.json'),m=data(mp);
 need(m.files?.length===count,'RESOURCE_COUNT_'+kind);
 return {kind,manifestSha256:sha(mp),fileCount:count};
});
const r={
 schema:1,version:freeze.version,status:'HASH_ONLY_PROVENANCE_NOT_INDEPENDENT_REBUILD',
 publishedInstallerSha256:'8eab5ffdedbc04726e551a2bab853ff43ebbcf171a61b3147979457562144e64',
 releaseSnapshotSha256:freeze.v19OwnerSource05ManifestSha256,
 bridgeManifestSha256:freeze.bridgeManifestSha,
 rootPackageSha256:sha(path.join(seed,'package.json')),
 rootPnpmLockSha256:sha(path.join(seed,'pnpm-lock.yaml')),
 originalUpstreamDSHCommit:'b830ec950faba0a46dda564be3e2d854afed94f1',
 profileBundles:42,declaredDependencies:32,inputs,resources,
 publicGithubIncludesPrivateInputs:false,privateProvisioningNeeded:true,
 reproducibleWindowsNsisValidated:false,
 limitations:'Hash-only receipt. No original archives or KT/grammar assets are committed. Upstream official DSH, owner overlay, Windows packaging tools and other private inputs still require an independently authorized build environment.'
};
need(r.releaseSnapshotSha256==='5376e69488b9782037027cb22ec7e824b4a143367800f8347bd8e75348f2944b','SNAPSHOT_PIN');
fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:r.status,version:r.version,pluginArchives:inputs.length,resources:resources.map(x=>({kind:x.kind,files:x.fileCount})),publicBytesWritten:fs.statSync(out).size,privateBytesCopied:false}));
