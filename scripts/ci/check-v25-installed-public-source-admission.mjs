// YEN-15: v25 PUBLIC release admission. Runs only against the public checkout.
// Never reads or ships a private owner profile, installer, token or plugin archive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve(import.meta.dirname,'../..');
const ref=JSON.parse(fs.readFileSync(path.join(root,'docs/v25-owner-installed-sha256-only-provenance.json'),'utf8'));
const bridge=JSON.parse(fs.readFileSync(path.join(root,'docs/v22-frozen-bridge-source-hashes.json'),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const digest=/^[a-f0-9]{64}$/i;
const errors=[];
if(ref.schema!==1||ref.installedVersion!=='0.2.1-rc.5.20261117.25')errors.push('wrong v25 provenance schema/version');
for(const [name,obj] of Object.entries(ref.files||{})){
 if(!obj||!digest.test(obj.sha256||''))errors.push('invalid hash field: '+name);
}
if(ref.localVerified?.pluginArchivesCompared!==13||ref.localVerified.pluginArchivesExact!==13||
ref.localVerified.bridgeFilesCompared!==60||ref.localVerified.bridgeFilesExact!==60||
ref.localVerified.readOnlyInstalledParityChecks!=='30/30'){
 errors.push('missing local installed v25 parity evidence');
}
const absent=[],different=[];
for(const entry of bridge.files||[]){
 const rel=entry.path;
 if(typeof rel!=='string'||!rel.startsWith('social-adapters/')||rel.includes('..')||!digest.test(entry.sha256||'')){
  errors.push('invalid frozen Bridge path/hash');continue;
 }
 const file=path.join(root,rel);
 if(!fs.existsSync(file)){absent.push(rel);continue;}
 if(sha(file)!==entry.sha256)different.push(rel);
}
if(bridge.files?.length!==60)errors.push('incomplete frozen Bridge inventory');
const required=[
 'LICENSE',
 'docs/THIRD_PARTY_NOTICES.md',
 'docs/v25-public-rebuild-provenance.json',
 'docs/v25-public-release-approval.json'
];
const pending=required.filter(x=>!fs.existsSync(path.join(root,x)));
let approvalMatches=false;
if(!pending.length){
 try{
  const rebuild=JSON.parse(fs.readFileSync(path.join(root,'docs/v25-public-rebuild-provenance.json'),'utf8'));
  const approval=JSON.parse(fs.readFileSync(path.join(root,'docs/v25-public-release-approval.json'),'utf8'));
  approvalMatches=approval.approved===true&&approval.version===ref.installedVersion&&
   typeof approval.approvedBy==='string'&&approval.approvedBy.trim().length>0&&
   rebuild.version===ref.installedVersion&&rebuild.independentWindowsNsisVerified===true&&
   rebuild.publicSourceHostSha256===ref.files.installedPageHost.sha256&&
   rebuild.publicSourceClientSha256===ref.files.installedClient.sha256&&
   rebuild.installerSha256===ref.files.privateUnsignedNsis.sha256&&
   rebuild.licenseReviewCompleted===true&&rebuild.privacyHistoryReviewCompleted===true;
 }catch{}
}
const permitted=errors.length===0&&absent.length===0&&different.length===0&&pending.length===0&&approvalMatches;
const outcome={
 gate:'YEN-15 v25 public-source versus installed owner release admission',
 version:ref.installedVersion,
 ownerInstalledParityReceipt:'30/30 read-only owner verification',
 publicBridgeExact:60-absent.length-different.length,
 publicBridgeExpected:60,
 publicBridgeMissing:absent,
 publicBridgeDifferent:different,
 missingPublicationEvidence:pending,
 approvedIndependentRebuildAndLicensing:approvalMatches,
 internalReceiptValidationErrors:errors,
 releaseEligible:permitted,
 note:'Public CI cannot reverify the owner private installation. Hash receipt alone cannot approve source parity, public redistribution, or formal release.'
};
console.log(JSON.stringify(outcome,null,2));
if(!permitted)process.exitCode=1;
