// Independent v19 NSIS input gate; never uploads, copies or logs private archives.
// The public GitHub runner fails closed until separately approved inputs are provisioned.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const data=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const r=data(path.join(root,'docs/v19-nsis-input-provenance.json'));
const fail=(reason,more={})=>{
 console.log(JSON.stringify({gate:'YENRA_V19_INDEPENDENT_WINDOWS_NSIS_INPUTS',status:'BLOCKED',reason,...more}));
 process.exit(12);
};
if(r.schema!==1||r.version!=='0.2.1-rc.5.20261116.19'||r.inputs?.length!==13||
   r.profileBundles!==42||r.declaredDependencies!==32||
   r.publicGithubIncludesPrivateInputs!==false||r.reproducibleWindowsNsisValidated!==false)
 fail('INVALID_PUBLIC_RELEASE_RECEIPT');
if(new Set(r.inputs.map(x=>x.id)).size!==13||
   new Set(r.inputs.map(x=>x.file)).size!==13||
   r.inputs.some(x=>!/(?:^[A-Za-z0-9._-]+\.tgz$)/.test(x.file)||!/^[0-9a-f]{64}$/.test(x.sha256)))
 fail('INVALID_ARCHIVE_IDS');
const seed=process.env.YENRA_V19_PRIVATE_SEED_DIR;
const kt=process.env.YENRA_V19_KT_DIR;
const grammar=process.env.YENRA_V19_GRAMMAR_DIR;
if(!seed||!kt||!grammar)
 fail('OWNER_PRIVATE_INPUTS_NOT_PROVISIONED',{requiredArchiveHashes:13,requiredResourceSets:['KT','grammar'],publicCIInstallerReproduced:false});
const needFile=(f,expected,why)=>{
 if(!fs.existsSync(f)||sha(f)!==expected)fail(why);
};
needFile(path.join(seed,'package.json'),r.rootPackageSha256,'PROFILE_SEED_CHANGED');
needFile(path.join(seed,'pnpm-lock.yaml'),r.rootPnpmLockSha256,'PINNED_LOCK_CHANGED');
const pkg=data(path.join(seed,'package.json')),lock=fs.readFileSync(path.join(seed,'pnpm-lock.yaml'),'utf8');
if(pkg.dsh?.profile?.bundles?.length!==42||Object.keys(pkg.dependencies??{}).length!==32)
 fail('PROFILE_42_32_MISSING');
let count=0;
for(const item of r.inputs){
 const spec=pkg.dependencies[item.id];
 if(spec!=='file:./packages/'+item.file)fail('ARCHIVE_PIN_MISMATCH');
 const p=path.join(seed,'packages',item.file);
 if(!fs.existsSync(p)||fs.statSync(p).size!==item.bytes)fail('ARCHIVE_MISSING_OR_SIZE_MISMATCH');
 const bytes=fs.readFileSync(p);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256||
    !lock.includes(item.lockfileIntegrity)||
    'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')!==item.lockfileIntegrity)
   fail('ARCHIVE_BYTE_OR_LOCKFILE_DRIFT');
 count++;
}
for(const item of r.resources){
 const dir=item.kind==='KT'?kt:grammar,manifest=path.join(dir,'manifest.json');
 needFile(manifest,item.manifestSha256,'RESOURCE_MANIFEST_DRIFT');
 const m=data(manifest);
 if(m.files.length!==item.fileCount)fail('RESOURCE_COUNT_DRIFT');
 for(const f of m.files){
   const resolved=path.resolve(dir,f.relative);
   if(!resolved.startsWith(path.resolve(dir)+path.sep))fail('RESOURCE_PATH_ESCAPE');
   needFile(resolved,f.sha256,'RESOURCE_BYTES_DRIFT');
 }
}
console.log(JSON.stringify({gate:'YENRA_V19_INDEPENDENT_WINDOWS_NSIS_INPUTS',status:'PROVENANCE_INPUTS_VERIFIED_NOT_NSIS_BUILT',exactArchives:count,KTResources:1317,grammarResources:4,privateBytesUploaded:false}));
