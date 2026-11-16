import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const owner=path.resolve(process.argv[2]??'');
const repo=path.resolve(process.argv[3]??'');
const applying=process.argv.includes('--apply');
if(owner===repo||!fs.existsSync(path.join(owner,'social-adapters/chatwoot-bridge/src/index.mjs')) ||!fs.existsSync(path.join(repo,'docs/v18-source-hashes.json')))throw Error('INVALID_SOURCE_OR_REVIEW_ROOT');
const sources=[
 ['social-adapters/chatwoot-bridge/src/index.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-inbound-projection.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-native-selection.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-native-selection.test.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-wa-outbound.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-wa-outbound.test.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.test.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-wa-original-mid-recovery.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-wa-original-mid-recovery.test.mjs','YEN-9/YEN-10/YEN-14'],
 ['social-adapters/chatwoot-cloud-direct/cloud-whatsapp-roster-hydration.test.mjs','YEN-9/YEN-10/YEN-14'],
 ['ui/chatwoot-embed/desktop-integration-candidate/src/client/advice-bridge.ts','YEN-7'],
 ['ui/chatwoot-embed/desktop-integration-candidate/src/client/native-reply-cards.tsx','YEN-7'],
 ['ui/chatwoot-embed/desktop-integration-candidate/src/client/ui.tsx','YEN-7/YEN-12'],
 ['ui/chatwoot-embed/desktop-integration-candidate/src/client/v2-desktop.css','YEN-12'],
 ['ui/chatwoot-embed/desktop-integration-candidate/src/social-agent-actions.ts','YEN-7/YEN-8'],
 ['ui/chatwoot-embed/desktop-integration-candidate/src/cloud-memory-model-scope.ts','YEN-7/YEN-8'],
 ['ui/chatwoot-embed/qa/native-contact-public-source.test.mjs','YEN-12'],
 ['ui/chatwoot-embed/qa/p1-native-caption-drag-zone-20261116.test.mjs','YEN-12'],
 ['ui/chatwoot-embed/qa/brain-reply-distinctness-20261116.test.mjs','YEN-7'],
 ['ui/chatwoot-embed/qa/cloud-memory-model-scope-20261116.test.mjs','YEN-7/YEN-8'],
 ['ui/chatwoot-embed/src/client/cloud-native-inbox.tsx','YEN-11'],
 ['ui/chatwoot-embed/src/client/cloud-translation-auto-restore-20261115.test.mjs','YEN-11'],
 ['ui/chatwoot-embed/src/client/cloud-preview-live-miss-20261116.test.mjs','YEN-11']
].sort((a,b)=>a[0].localeCompare(b[0]));
const deny=[
 ['credential',/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN.*PRIVATE KEY-----)/i],
 ['private_contact',/(?<!\d)\+[1-9]\d{9,14}(?!\d)|\b(?:Janko|Ralf|Schmeling|Franco|Vincenzo|Tommaso)\b/i],
 ['personal_email',/[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
 ['owner_local_path',/C:[\\/]Users[\\/]/i],
 ['embedded_token',/\bBearer\s+[A-Za-z0-9_\-\.]{25,}/i],
];
const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=[],blocked=[];
for(const [rel,task] of sources){
 const src=path.join(owner,rel),dst=path.join(repo,rel);
 if(!/^(social-adapters|ui)\/[A-Za-z0-9/_\.\-]+\.(?:mjs|ts|tsx|css)$/.test(rel)|| !fs.existsSync(src))throw Error('NOT_APPROVED_SOURCE:'+rel);
 const originalBytes=fs.readFileSync(src);
 let bytes=originalBytes;
 if(rel==='social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.test.mjs'){
   const original=originalBytes.toString('utf8');
   const safe=original.replace(/^const secret=['\x22][A-Za-z0-9_.-]{20,}['\x22];?$/m,"const secret='test-only-' + 'x'.repeat(28);");
   if(safe===original)throw Error('UNEXPECTED_WEBHOOK_FIXTURE_FORMAT');
   bytes=Buffer.from(safe,'utf8');
 }
 if(bytes.length>400000||bytes.includes(0))throw Error('NOT_SOURCE_TEXT:'+rel);
 const text=bytes.toString('utf8');
 const flagged=deny.filter(([_,rx])=>rx.test(text)).map(([name])=>name);
 if(flagged.length){blocked.push({path:rel,reason:flagged});continue}
 const digest=sha(bytes),sourceSha=sha(originalBytes);
 if(sha(fs.readFileSync(src))!==sourceSha)throw Error('CONCURRENT_OWNER_SOURCE_EDIT:'+rel);
 rows.push({path:rel,ownerTask:task,v19Sha256:digest,ownerSourceSha256:sourceSha,privacySanitizedFixture:sourceSha!==digest,previousCandidateSha256:fs.existsSync(dst)?sha(fs.readFileSync(dst)):null,bytes:bytes.length,source:bytes});
}
console.log(JSON.stringify({mode:applying?'apply':'preflight',approved:rows.length,blocked,changed:rows.filter(x=>x.previousCandidateSha256!==x.v19Sha256).map(x=>x.path)},null,2));
const approvedPrivacyExclusions=new Set([
 'social-adapters/chatwoot-cloud-direct/cloud-whatsapp-roster-hydration.test.mjs',
 'ui/chatwoot-embed/qa/cloud-memory-model-scope-20261116.test.mjs'
]);
if(blocked.some(x=>!approvedPrivacyExclusions.has(x.path)))throw Error('UNEXPECTED_PRIVATE_CANDIDATE_FILE');
if(!applying){if(blocked.length)process.exitCode=5;process.exit();}
for(const row of rows){const source=path.join(owner,row.path);if(sha(fs.readFileSync(source))!==row.ownerSourceSha256)throw Error('OWNER_SOURCE_CHANGED_BEFORE_COPY:'+row.path)}
const ledger={label:'v19-candidate-not-published',baselineVersion:'0.2.1-rc.5.20261116.18',ownerRootNotModified:true,excludedPrivacyFixtures:blocked,files:rows.map(({source,...row})=>row)};
const ledgerFile=path.join(repo,'docs/v19-owner-candidate-sha256.json');
if(fs.existsSync(ledgerFile))throw Error('V19_LEDGER_EXISTS_REVIEW_BEFORE_REPLACE');
for(const row of rows){
 const out=path.join(repo,row.path);
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,row.source);
 if(sha(fs.readFileSync(out))!==row.v19Sha256)throw Error('STAGING_COPY_HASH_FAILED:'+row.path);
}
fs.writeFileSync(ledgerFile,JSON.stringify(ledger,null,2)+'\n','utf8');
console.log(JSON.stringify({imported:rows.length,ledger:'docs/v19-owner-candidate-sha256.json',ownerUntouched:true},null,2));
