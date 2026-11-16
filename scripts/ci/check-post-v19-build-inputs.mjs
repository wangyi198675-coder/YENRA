// Owner-only, read-only next-release input admission. Never uploads private artifacts.
// This validates SOURCE + private dependency INPUTS, not an NSIS build or live provider ACK.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const receipt=JSON.parse(fs.readFileSync(path.join(root,'docs/v19-nsis-input-provenance.json'),'utf8'));
const config=JSON.parse(fs.readFileSync(path.join(root,'docs/post-v19-build-input-policy.json'),'utf8'));
function block(reason,details={}){
 console.log(JSON.stringify({gate:'YENRA_POST_V19_WINDOWS_INPUT_ADMISSION',status:'BLOCKED',reason,...details}));
 process.exit(12);
}
if(config.schema!==1||config.publishedReference!==receipt.version||
   receipt.profileBundles!==42||receipt.declaredDependencies!==32||
   receipt.inputs?.length!==13||config.dshUpstreamCommit!==receipt.originalUpstreamDSHCommit)
 block('PINNED_PUBLIC_RECEIPT_INVALID');
const patch=path.join(root,config.dshOverlayPatch);
if(!fs.existsSync(patch))block('DSH_OVERLAY_PATCH_MISSING');
const patchText=fs.readFileSync(patch,'utf8');
const files=[...patchText.matchAll(/^diff --git a\/([^\r\n]+) b\/[^\r\n]+/gm)].map(x=>x[1]);
if(files.length!==27||new Set(files).size!==27)block('DSH_OVERLAY_PATHS_NOT_27');
for(const item of files)if(!/^(?:apps\/(?:desktop|desktop-host)\/|packages\/client\/(?:ui-conversation|ui-layout)\/)/.test(item))
 block('DSH_OVERLAY_UNEXPECTED_SOURCE_AREA');
const unresolved=execFileSync('git',['-C',root,'ls-files','-u'],{encoding:'utf8'}).trim();
if(unresolved)block('UNRESOLVED_GIT_MERGE_CONFLICTS');
const audit=spawnSync(process.execPath,[path.join(root,'scripts/ci/audit-public-source.mjs')],{cwd:root,encoding:'utf8'});
if(audit.status!==0)block('PUBLIC_SOURCE_REJECTED');
const required=['YENRA_V19_PRIVATE_SEED_DIR','YENRA_V19_KT_DIR','YENRA_V19_GRAMMAR_DIR','YENRA_DSH_PINNED_DIR','YENRA_OFFICIAL_WINDOWS_TARGET_DIR'];
if(process.platform!=='win32')block('WINDOWS_OWNER_BUILDER_REQUIRED');
const missing=required.filter(key=>!process.env[key]);
if(missing.length)block('OWNER_ONLY_PRIVATE_INPUTS_NOT_PROVISIONED',{requiredEnvironmentNames:missing});
let head;
try{head=execFileSync('git',['-C',process.env.YENRA_DSH_PINNED_DIR,'rev-parse','HEAD'],{encoding:'utf8'}).trim();}
catch{block('UPSTREAM_GIT_BASE_NOT_VERIFIED');}
if(head!==receipt.originalUpstreamDSHCommit)block('UPSTREAM_GIT_BASE_CHANGED');
const target=process.env.YENRA_OFFICIAL_WINDOWS_TARGET_DIR;
for(const seg of ['dsh','electron','installer-ui','package-set','packed','runtime','unsigned-artifacts']){
 if(!fs.existsSync(path.join(target,seg)))block('ORIGINAL_WINDOWS_TARGET_INCOMPLETE',{missingSegment:seg});
}
const original=spawnSync(process.execPath,[path.join(root,'scripts/ci/check-v19-nsis-inputs.mjs')],{
 cwd:root,encoding:'utf8',env:process.env,maxBuffer:1024*1024});
if(original.status!==0)block('FROZEN_PRIVATE_INPUT_HASH_GATE_FAILED',{gateExit:original.status});
let evidence;
try{evidence=JSON.parse(original.stdout.trim().split(/\r?\n/).at(-1));}
catch{block('FROZEN_PRIVATE_GATE_OUTPUT_INVALID');}
if(evidence.status!=='PROVENANCE_INPUTS_VERIFIED_NOT_NSIS_BUILT'||
 evidence.exactArchives!==13||evidence.KTResources!==1317||evidence.grammarResources!==4)
 block('PRIVATE_RESOURCE_COUNTS_MISMATCH');
console.log(JSON.stringify({
 gate:'YENRA_POST_V19_WINDOWS_INPUT_ADMISSION',
 status:'OWNER_BUILD_INPUTS_VERIFIED__NSIS_NOT_BUILT',
 originalDSHPinValid:true,dshOverlayPaths:27,
 privateArchiveHashesVerified:13,ownerProfileBundles:42,lockedDependencies:32,
 ktFilesVerified:1317,grammarFilesVerified:4,originalWindowsPackagingInputsPresent:true,
 publicCodeSafe:true,unresolvedGitConflicts:0,
 installedVersionChanged:false,providerSendAttempted:false,
 independentInstallerRebuilt:false,privateInputsUploaded:false
}));
