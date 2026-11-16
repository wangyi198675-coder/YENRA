// YEN-15: v23 private pilot must never be confused with a formally approved,
// independently reproducible public GitHub NSIS release.
// This script reads hash-only public provenance. It cannot inspect a private
// owner's Windows installation from an untrusted GitHub runner.
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const receipt=JSON.parse(fs.readFileSync(path.join(root,'docs/v23-owner-pilot-installed-provenance.json'),'utf8'));
const bridge=JSON.parse(fs.readFileSync(path.join(root,'docs/v22-frozen-bridge-source-hashes.json'),'utf8'));
const approvalPath=path.join(root,'docs/v23-independent-build-approval.json');
const sha=/^[a-f0-9]{64}$/;
const failures=[];
if(receipt.schema!==1||receipt.version!=='0.2.1-rc.5.20261117.23')failures.push('version/schema');
if(receipt.status!=='OWNER_PRIVATE_UI_PILOT_NOT_FORMAL_RELEASE')failures.push('pilot classification');
if(receipt.officialUnsignedNsis?.bytes!==709991194||!sha.test(receipt.officialUnsignedNsis?.sha256||''))failures.push('unsigned NSIS hash receipt');
for(const key of ['archiveSha256','clientSha256','hostSha256'])if(!sha.test(receipt.installedUi?.[key]||''))failures.push('installed UI '+key);
if(receipt.bridge?.files!==60||receipt.bridge.manifestSha256!=='ddfaf629a93333919d9dc2c1639af284ae8323420499e04d7bfb8727dca'||bridge.files?.length!==60)failures.push('frozen v22/v23 Bridge provenance');
if(receipt.ownerLocalEvidence?.nsisChecksPassed!==62||receipt.ownerLocalEvidence.installedRuntimeSmokeChecksPassed!==18)failures.push('pilot local QA provenance');
let approved=false;
if(fs.existsSync(approvalPath)){
  try{
    const a=JSON.parse(fs.readFileSync(approvalPath,'utf8'));
    approved=a.approved===true&&a.version===receipt.version&&a.installerSha256===receipt.officialUnsignedNsis.sha256&&
      a.installedUiSha256===receipt.installedUi.archiveSha256&&
      a.independentConfidentialBuilderVerified===true&&a.ownerRuntimeAcceptanceVerified===true&&
      typeof a.approver==='string'&&a.approver.trim().length>0;
  }catch{}
}
const outcome={
  gate:'YEN-15 installed v23 pilot provenance versus full release admission',
  version:receipt.version,
  localNsisReceiptValid:failures.length===0,
  localNsisChecks:'62/62 reported by owner build verifier, NOT a GitHub independent NSIS rebuild',
  actualInstalledUiSha256:receipt.installedUi.archiveSha256,
  bridgeExactSourceGate:'Separately verified by scripts/ci/verify-v22-bridge-source.mjs',
  privateIndependentBuildAndOwnerAcceptanceApproved:approved,
  approvalRecordPresent:fs.existsSync(approvalPath),
  failures,
  releaseEligible:failures.length===0&&approved
};
console.log(JSON.stringify(outcome,null,2));
if(!outcome.releaseEligible)process.exitCode=1;
