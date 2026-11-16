// YEN-6: verify combined v19 author UI + original v18 provider read source.
// A verified JS build is not a signed NSIS, a provider ACK or a deployed release.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditOwner, BASE_VERSION } from './Assert-YENRA-Owner-ReleaseGate-20261116.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const source = path.join(root, 'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-source-05');
const build = path.join(root, 'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-build-02');
const installed = path.join(root, 'runtime/ui-candidate-desktop-home/profiles/desktop/node_modules/@yenra/desktop-ui-candidate/lib/client.js');
const candidate = path.join(root, 'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-build-03/desktop-merged-complete/client.js');
const embedHost = path.join(build, 'embed-full/index.js');
const embedClient = path.join(build, 'embed-full/client.js');
const frozenFile = path.join(root, 'artifacts/YENRA_DUAL_MACHINE_UNIFICATION_20261114/unified-release-candidate-20261116-18/release-v18-freeze.json');
export const requiredFromV18 = Object.freeze([
  'THREE_REPLY_DISTINCT_INTENT_GUIDANCE', 'findVerifiedHistoricalMessages',
  'i-lucide-arrow-right-to-line', 'i-lucide-arrow-left-to-line',
  'conversations-list-wrap.hidden', 'v2-caption-drag-zone',
  'yenra:kt:confirmed-country:v2:196799:',
  '/api/yenra/social-native-read', 'WA_READ_SELF_ONLY',
  'DraggableBrainLauncher', 'BrainLightHalo', 'PERSONAL_CONTACT_COMMAND'
]);
export const requiredV19 = Object.freeze([
  'diagnoseAdviceChoices', '__yenraDshCloudTranslateActionV19',
  'data-yenra-cloud-translate-action'
]);
export function checkMarkers(installedText, candidateText) {
  const lost = requiredFromV18.filter(k => installedText.includes(k) && !candidateText.includes(k));
  const missed = requiredV19.filter(k => !candidateText.includes(k));
  return { lost, missed, baselinePresent: requiredFromV18.filter(k => installedText.includes(k)).length,
    newPresent: requiredV19.filter(k => candidateText.includes(k)).length };
}
const assert = (v,reason) => { if (!v) throw Error('YEN6_V19_COMPILED_BUILD_BLOCK_'+reason); };
function verify() {
  const gate = auditOwner(root, { mode: 'intake' });
  assert(gate.baselineVerified && gate.blockers.length === 0 && gate.installedVersion === BASE_VERSION,'V18_INSTALLED_BASELINE');
  assert(sha(frozenFile)==='3f0cd933f3d6658fc6ce78b0fd5221861d78106af27bb4cc3932215a836cbce1','V18_FREEZE_CHANGED');
  const intake = JSON.parse(fs.readFileSync(path.join(source,'v19-source-intake.json'),'utf8'));
  assert(intake.status === 'V19_OWNER_SOURCE_CAPTURED_NOT_RELEASED' &&
    intake.releaseEligible === false && intake.count >= 94 && intake.changedCount >= 10,'SOURCE_SNAPSHOT_STATUS');
  const changes = [];
  for (const entry of intake.files) {
    const staged = path.join(source,'source',entry.path);
    const formal = path.join(root,entry.path);
    if (!fs.existsSync(staged) || sha(staged)!==entry.sha256) throw Error('SOURCE_SNAPSHOT_CORRUPT:'+entry.path);
    if (!fs.existsSync(formal) || sha(formal)!==entry.sha256) changes.push(entry.path);
  }
  assert(changes.length === 0, 'AUTHOR_SOURCE_CHANGED_AFTER_INTAKE:'+changes.join(','));
  const original = fs.readFileSync(installed,'utf8');
  const built = fs.readFileSync(candidate,'utf8');
  const marker = checkMarkers(original,built);
  assert(marker.lost.length === 0, 'V18_CLIENT_FEATURES_LOST:'+marker.lost.join(','));
  assert(marker.missed.length === 0, 'V19_CLIENT_SOURCE_NOT_COMPILED:'+marker.missed.join(','));
  for (const p of [candidate,embedHost,embedClient])
    execFileSync(process.execPath,['--check',p], { timeout:12000, stdio:'pipe' });
  const native = intake.files.find(x=>x.path==='ui/desktop-candidate/src/client/oss-native-social.tsx');
  assert(native?.sha256 === '9a6bd06ca499b39c4754484990bfe796b7df6d8e373d76f93ef96dd282b92761',
    'NATIVE_READ_SOURCE_NOT_PINNED');
  const evidence = {
    status:'V19_OWNER_ISOLATED_COMPILED_INTEGRATION_NOT_RELEASED', task:'YEN-6',
    baseVersion:BASE_VERSION, sourceIntakeSha256:sha(path.join(source,'v19-source-intake.json')),
    v18FrozenSha256:sha(frozenFile),
    sourceFileCount:intake.count, sourceDrifts:intake.changedCount,
    bridgeFrozenFiles:intake.frozenBridgeFiles, ownerInstalledV18:true,
    originalReadSourceSha256:native.sha256,
    built:{ desktopClient:{sha256:sha(candidate),bytes:fs.statSync(candidate).size},
      chatwootHost:{sha256:sha(embedHost),bytes:fs.statSync(embedHost).size},
      chatwootClient:{sha256:sha(embedClient),bytes:fs.statSync(embedClient).size}},
    v18ClientAnchorsPreserved:marker.baselinePresent, v19ClientAnchorsPresent:marker.newPresent,
    noNewSenderOrDBBuilt:true, friendUntouched:true,
    officialNsisBuilt:false, ownerInstalledV19:false, realProviderAckVerified:false,
    releaseEligible:false,
    blockers:['SOURCE_PR3_NOT_REBASED','FULL_DSH_HOST_AND_PLUGINS_NOT_PACKED',
      'OFFICIAL_NSIS_NOT_BUILT','OWNER_V19_REAL_GUI_NOT_INSTALLED',
      'PROVIDER_ACK_AND_READ_REAL_E2E_PENDING'],
  };
  const out=path.join(build,'v19-owner-compiled-integrity.json');
  fs.writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');
  console.log('YEN6_V19_COMBINED_BUILD_PASS '+JSON.stringify({
    status:evidence.status, sourceFiles:evidence.sourceFileCount,
    v18Anchors:marker.baselinePresent,v19Anchors:marker.newPresent,
    clientSha256:evidence.built.desktopClient.sha256,
    releaseEligible:false,proof:path.relative(root,out)
  }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verify(); } catch(e){ console.error(String(e?.message||e)); process.exitCode=15; }
}
