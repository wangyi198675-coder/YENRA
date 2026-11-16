import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const ledger=JSON.parse(fs.readFileSync(path.join(root,'docs/v19-owner-candidate-sha256.json'),'utf8'));
if(ledger.label!=='v19-candidate-not-published'||ledger.baselineVersion!=='0.2.1-rc.5.20261116.18'||ledger.files?.length!==22)throw Error('WRONG_RELEASE_SCOPE');
const seen=new Set();let sanitized=0;
for(const row of ledger.files){
 if(!/^(?:social-adapters|ui)\/[A-Za-z0-9_.\/-]+\.(?:mjs|ts|tsx|css)$/.test(row.path)||row.path.includes('..')||seen.has(row.path))throw Error('DUPLICATE_OR_UNSAFE_V19_SOURCE');
 seen.add(row.path);
 const file=path.join(root,row.path);
 if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==row.v19Sha256)throw Error('V19_SOURCE_LEDGER_MISMATCH:'+row.path);
 if(typeof row.ownerTask!=='string'||!/^YEN-\d+/.test(row.ownerTask))throw Error('MISSING_LINEAR_OWNERSHIP:'+row.path);
 if(row.privacySanitizedFixture===true){
   sanitized++;
   if(row.path!=='social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.test.mjs')throw Error('UNREVIEWED_SANITIZED_SOURCE');
 }
}
if(JSON.stringify(ledger.excludedPrivacyFixtures?.map(x=>x.path).sort())!==JSON.stringify([
 'social-adapters/chatwoot-cloud-direct/cloud-whatsapp-roster-hydration.test.mjs',
 'ui/chatwoot-embed/qa/cloud-memory-model-scope-20261116.test.mjs'].sort()))throw Error('PRIVACY_EXCLUSION_SCOPE_CHANGED');
if(sanitized!==1)throw Error('EXPECTED_ONE_SANITIZED_MOCK_WEBHOOK_FIXTURE');
console.log(JSON.stringify({gate:'v19 candidate source receipts',version:'v19-unreleased',sourceFiles:seen.size,privacySanitizedFixtures:sanitized,excludedPrivateLocalFixtures:2,allSourceHashesMatched:true},null,2));
