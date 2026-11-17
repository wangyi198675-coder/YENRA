// Privacy-safe metadata gate: validates the owner-local script SHA receipt only.
// Public CI cannot read or execute the private owner's current installation.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const receipt=JSON.parse(fs.readFileSync(path.join(root,'docs/yen15-yen17-owner-private-three-phase-hash-review-20261117.json'),'utf8'));
const scope=process.argv.includes('--release')?'release':'review';
const errors=[];
const must=(ok,name)=>{if(!ok)errors.push(name)};
const hash=/^[a-f0-9]{64}$/i;
must(receipt.schema===1&&receipt.currentInstalledVersion==='0.2.1-rc.5.20261117.25','receipt schema and owner baseline');
must(receipt.artifactClassification==='HASH_ONLY_REVIEW_NO_PRIVATE_SOURCE_OR_CREDENTIALS','hash-only public receipt');
must(Array.isArray(receipt.newPrivateOwnerScripts)&&receipt.newPrivateOwnerScripts.length===3&&
 receipt.newPrivateOwnerScripts.every(x=>typeof x.name==='string'&&!x.name.includes('/')&&!x.name.includes('\\')&&hash.test(x.sha256||'')),'three original owner-local script SHA256 receipts');
must(JSON.stringify(receipt.explicitSourcePhaseOrder)===JSON.stringify([
 'PREBUILD','PRIVATE_WHITELIST_LICENSE_PRIVACY','PREINSTALL','COMPLETE_NSIS','AUTHORIZED_PRIVATE_APPLY','POSTINSTALL']),'three release phases not omitted');
for(const [key,n] of [['threePhaseWiringRegression',10],['originalHostPageHhmmTextButtonsNsisRegression',11],
 ['phaseSeparationFeatureRegression',8],['v25PrivateInstalledParity',30],['v25PrivatePackageIntegrity',76]]){
 const x=receipt.validation?.[key];must(x?.passed===n&&x?.tested===n,'owner reported '+key+' '+n);
}
must(receipt.validation?.noLiveInstallPerformedByAudit===true&&receipt.validation?.v25RepeatedAsNewerRejected===true,
 'anti-rollback and no live install evidence');
must(receipt.ownerLocalWhitelist?.pluginArchiveCount===13&&receipt.ownerLocalWhitelist?.originalBridgeFileCount===60,
 'original plugin and Bridge whitelist inventory');
must(receipt.ownerLocalWhitelist?.suspectedConstantValueExcluded===true&&
 receipt.ownerLocalWhitelist?.publicRedistributionAuthorized===false,
 'no private credential or unapproved rights publicized');
if(scope==='release'){
 must(receipt.actualNewReleaseInstalled===true,'new release actually installed');
 must(receipt.originalOwnerPrivateInstallerApprovedForNewStage===true,'real owner authorization');
 must(receipt.postinstallRuntimeAllChecksComplete===true,'real postinstall acceptance');
 must(receipt.ownerLocalWhitelist.publicSourceHistoryReviewComplete===true,'public privacy/history review');
 must(receipt.ownerLocalWhitelist.publicRedistributionAuthorized===true,'genuine original-work and third-party license approvals');
 must(receipt.ownerLocalWhitelist.privacyPotentialThirdPartyBundledGoogleKeyLikeConstant===0,'bundle credential-format candidate resolved');
 must(receipt.publicGitHubSourceFullyMatchesV25===true,'source and NSIS reproducibility');
 must(receipt.formalReleaseGo===true,'formal release signoff');
}
const pass=errors.length===0;
console.log(JSON.stringify({gate:'YEN-15/17 three-phase hash-only receipt',scope,status:pass?'PASS':'NO_GO',
 ownerLocalScriptBytesAccessibleToPublicRunner:false,checkedEvidence:5,errors,
 note:'Review success is NOT installation approval. Public CI never receives private source, installers, profiles, credentials or contact data.'},null,2));
if(!pass)process.exitCode=1;
