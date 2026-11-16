// YEN-15 license admission is intentionally not a substitute for legal review.
// Failing does not mean infringement; it means redistribution is not approved.
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const required=['LICENSE','docs/THIRD_PARTY_NOTICES.md','docs/v22-release-license-approval.json'];
const missing=required.filter(p=>!fs.existsSync(path.join(root,p)));
let approved=false;
if(missing.length===0){
  try{
    const a=JSON.parse(fs.readFileSync(path.join(root,'docs/v22-release-license-approval.json'),'utf8'));
    approved=a.version==='0.2.1-rc.5.20261116.22'&&a.approved===true&&
      typeof a.approvedBy==='string'&&a.approvedBy.trim().length>0&&
      Array.isArray(a.reviewedDependencies)&&a.reviewedDependencies.length>0;
  }catch{}
}
const result={
  gate:'YEN-15 v22 public license and notice admission',
  missing,
  upstreamPinnedMitIsNotYenraOriginalCodeLicense:true,
  thirdPartyEnterpriseTermsRequireSeparateReview:true,
  releaseLicenseApproved:approved,
  note:'Only an authorized owner and license review can create a legitimate approval receipt.'
};
console.log(JSON.stringify(result,null,2));
if(missing.length||!approved)process.exitCode=1;
