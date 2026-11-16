// Public v19 receipt check: verifies public source bytes, not a claim of NSIS reproduction.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const r=JSON.parse(fs.readFileSync(path.join(root,'docs/v19-published-release-provenance.json'),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const need=(c,s)=>{if(!c)throw Error('V19_PUBLISHED_SOURCE_RECEIPT_'+s)};
need(r.schema===1&&r.publishedVersion==='0.2.1-rc.5.20261116.19','VERSION');
need(r.publishedSource.snapshotFileCount===96&&r.publishedSource.frozenBridgeCount===59,'SOURCE_SCOPE');
need(r.publishedSource.snapshotSha256==='5376e69488b9782037027cb22ec7e824b4a143367800f8347bd8e75348f2944b','OWNER_CAPTURE_PIN');
need(r.publishedSource.frozenBridgeManifestSha256==='f685d1d55254a69c69f541a497305015226d8ca8d2b196d401579a51a72cf7e6','BRIDGE_PIN');
need(r.officialWindowsNSIS.bytes===707406885&&r.officialWindowsNSIS.sourceIntegrityChecksPassed===87&&r.officialWindowsNSIS.sourceIntegrityChecksTotal===87,'OWNER_BUILD_RECEIPT');
need(r.officialWindowsNSIS.sha256==='8eab5ffdedbc04726e551a2bab853ff43ebbcf171a61b3147979457562144e64','INSTALLER_HASH_RECEIPT');
need(r.officialWindowsNSIS.independentGitHubRebuildProven===false&&r.officialWindowsNSIS.signed===false,'NO_FALSE_REBUILD_CLAIM');
// A post-v19 candidate must validate the IMMUTABLE published source commit,
// not demand that later fixes keep the exact v19 working-tree bytes.
const postV19=fs.existsSync(path.join(root,'docs/post-v19-build-input-policy.json'));
const referenceSha='e5d591f4bf68d3cb5dd172cd95a8a64f64a82465';
if(postV19){
 try{execFileSync('git',['-C',root,'merge-base','--is-ancestor',referenceSha,'HEAD'],{stdio:'pipe'});}
 catch{need(false,'IMMUTABLE_REFERENCE_NOT_ANCESTOR_OR_SHALLOW_CHECKOUT')}
}
const files=r.repoDelta.publishedSourceSha256;
need(files.length===5&&new Set(files.map(x=>x.path)).size===5,'SOURCE_COUNT');
for(const row of files){
 need(/^(?:ui|social-adapters)\/[A-Za-z0-9._/-]+\.(?:mjs|ts)$/.test(row.path)&&!row.path.includes('..'),'UNSAFE_PATH');
 const f=path.join(root,row.path);
 const bytes=postV19?execFileSync('git',['-C',root,'show',referenceSha+':'+row.path],{maxBuffer:10*1024*1024}):fs.readFileSync(f);
 need(crypto.createHash('sha256').update(bytes).digest('hex')===row.sha256,'SOURCE_BYTE_DRIFT_'+row.path);
}
const exclusions=[
 'social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.test.mjs',
 'social-adapters/chatwoot-cloud-direct/cloud-whatsapp-roster-hydration.test.mjs',
 'ui/chatwoot-embed/qa/p1-real-host-caption-hover-preview-20261116.mjs',
 'ui/chatwoot-embed/qa/p1-yen12-owner-candidate-manifest-20261116.mjs'
].sort();
need(JSON.stringify(r.repoDelta.privacyOrNonportableExclusions.map(x=>x.path).sort())===JSON.stringify(exclusions),'UNREVIEWED_EXCEPTION');
need(r.security.noPrivateTarballsInPublicRepo&&r.security.v18ImmutableFrozenBaselineUnchanged,'GUARDS');
console.log(JSON.stringify({gate:'v19 published source provenance',version:r.publishedVersion,sourceSnapshot:r.publishedSource.snapshotFileCount,frozenBridge:r.publishedSource.frozenBridgeCount,releaseAttestationChecks:r.officialWindowsNSIS.sourceIntegrityChecksPassed,publicSourceShaVerified:files.length,verificationSource:postV19?'immutable-v19-git-commit':'v19-current-tree',excludedPrivacyOrLocalQAFiles:exclusions.length,independentNsisRebuilt:false,passed:true}));
