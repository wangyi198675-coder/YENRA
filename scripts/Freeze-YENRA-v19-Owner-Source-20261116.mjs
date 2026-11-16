// YEN-6: one-source v19 intake from official author files. NEVER installs or publishes.
// A v18 hash change is an intentional v19 delta, never an edit to the v18 freeze.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditOwner, BASE_VERSION } from './Assert-YENRA-Owner-ReleaseGate-20261116.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V18 = 'artifacts/YENRA_DUAL_MACHINE_UNIFICATION_20261114/unified-release-candidate-20261116-18';
const V19 = 'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-source-04';
const FROZEN_SHA = '3f0cd933f3d6658fc6ce78b0fd5221861d78106af27bb4cc3932215a836cbce1';
const BASELINE_CLAIMS = Object.freeze({
  'ui/desktop-candidate/src/client/oss-native-social.tsx': ['YEN-6-v18-original-read-preserved', '9a6bd06ca499b39c4754484990bfe796b7df6d8e373d76f93ef96dd282b92761'],
  'ui/chatwoot-embed/desktop-integration-candidate/src/client/oss-native-social.tsx': ['YEN-6-stale-shadow-merge-preimage', '0a59bfc21fc6075d1fc625e96079732830f91bd67d76a36246fc62ed9766e984'],
  'ui/chatwoot-embed/desktop-integration-candidate/src/client/advice-bridge.ts': ['YEN-7', '554aa2d9ea48bce05e307482b182d757120f4a3e184ee568497bdd63eab0f833'],
  'ui/chatwoot-embed/desktop-integration-candidate/src/client/native-reply-cards.tsx': ['YEN-7', '0eca13e4e9488943fced29d876f7669896fa539d8e5d678c3125a28a7b870f2d'],
  'ui/chatwoot-embed/src/client/cloud-native-inbox.tsx': ['YEN-11', '912ce41d7ad749f2d899d26723f5b89d3132f027d446028861d7849d218c590e'],
  'ui/chatwoot-embed/src/client/cloud-dsh-translator-script.ts': ['YEN-11', 'cc08d0c160ee9f31f0503dff23fbe05f5c625d26a2ae492ed5a9e6e4c41aa063'],
  'ui/chatwoot-embed/desktop-integration-candidate/src/client/v2-desktop.css': ['YEN-12', '2cfbeecec918d334e6fc03333776fc4762e5bccf2c4b801db623184570f862c0'],
  'social-adapters/chatwoot-bridge/src/index.mjs': ['YEN-9/YEN-10/YEN-14', '56343f0edb14e31da20038ed4e4aa9ce56eead1eaa1a43dfa45091e7731ba769'],
  'social-adapters/chatwoot-cloud-direct/cloud-inbound-projection.mjs': ['YEN-9/YEN-10/YEN-14', 'd5d7970c5cc466c15287da7e7008b8a3257f2f8bc0147e1c24b73ee9e7f581af'],
  'social-adapters/chatwoot-cloud-direct/cloud-wa-outbound.mjs': ['YEN-9', '4c9a0059d30127f75f392d99454344be70f3668ad8045327a772fc2d2242e9a5'],
  'social-adapters/chatwoot-cloud-direct/cloud-wa-original-mid-recovery.mjs': ['YEN-9', 'cf7bfc8d20808bd54889386d8ddfaa304f461d681eb7a40fb6bba5e2f0ab34c6'],
  'social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.mjs': ['YEN-10', 'fa3470b3d6992d9753216a5715abcb654ccd9302feb7a4f7dab1e88c2b38f809'],
  'social-adapters/chatwoot-cloud-direct/cloud-native-selection.mjs': ['YEN-10', '8752b3ec8b2e5cc0cf897e8fe807a7709f40a78394861411f0ce2dcec4341704'],
  'ui/chatwoot-embed/desktop-integration-candidate/src/client/ui.tsx': ['YEN-12-shared-review', '0e0e70a453e03b61a8c04e5dca47f86769d635140d761f5d14f2ae22592d1a0d'],
});
const TEST_FILES = [
  'ui/chatwoot-embed/qa/brain-reply-distinctness-20261116.test.mjs',
  'ui/chatwoot-embed/src/client/cloud-translation-rightclick-fallback-v19.test.mjs',
  'ui/chatwoot-embed/src/client/cloud-preview-live-miss-20261116.test.mjs',
  'ui/chatwoot-embed/src/client/cloud-translation-auto-restore-20261115.test.mjs',
  'ui/chatwoot-embed/qa/p1-native-caption-drag-zone-20261116.test.mjs',
  'ui/chatwoot-embed/qa/p1-real-host-caption-hover-preview-20261116.mjs',
  'ui/chatwoot-embed/qa/p1-yen12-owner-candidate-manifest-20261116.mjs',
  'ui/chatwoot-embed/tsdown.yen-11-translation-qa-20261116.config.ts',
  'social-adapters/chatwoot-cloud-direct/cloud-whatsapp-roster-hydration.test.mjs',
  'social-adapters/chatwoot-cloud-direct/cloud-wa-outbound.test.mjs',
  'social-adapters/chatwoot-cloud-direct/cloud-wa-original-mid-recovery.test.mjs',
  'social-adapters/chatwoot-cloud-direct/cloud-webhook-contract.test.mjs',
  'social-adapters/chatwoot-cloud-direct/cloud-native-selection.test.mjs',
];
const OPTIONAL_BASELINE = [
  // Baseline installed binaries are SHA-attested by the imported owner release gate,
  // never copied into this author-source snapshot (Profile contains live identities).
  '@yenra/desktop-ui-candidate', '@xmanrui/dsh-im',
  '@guntur-d/dsh-memory', '@yenra/chatwoot-embed',
];

export const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const safe = rel => typeof rel === 'string' && rel.length > 0 &&
  /^[a-zA-Z0-9@._/+\-]+$/.test(rel) && !rel.includes('..') && !rel.startsWith('/') &&
  !/^(?:runtime|upstream|artifacts|backups|evidence|\.git)\//.test(rel) &&
  !/\/(?:node_modules|profiles|\.git)\//.test(rel);
const assert = (condition, message) => { if (!condition) throw Error('YEN6_V19_INTAKE_BLOCK_' + message); };
export function evaluateClaims(frozenFiles, claims, sourceSha) {
  const drifts = [], mismatchedClaims = [], unresolved = [];
  for (const [rel, frozenSha] of Object.entries(frozenFiles)) {
    const actual = sourceSha[rel];
    if (actual !== frozenSha) {
      const claim = claims[rel];
      drifts.push({ path: rel, originalV18Sha256: frozenSha, currentV19Sha256: actual, owner: claim?.[0] || null });
      if (!claim) unresolved.push(rel);
    }
  }
  for (const [rel, [owner, expected]] of Object.entries(claims))
    if (sourceSha[rel] !== expected) mismatchedClaims.push({ path: rel, owner, expected, actual: sourceSha[rel] ?? null });
  return { drifts, mismatchedClaims, unresolved };
}
const stageDir = path.join(ROOT, V19), manifestPath = path.join(stageDir, 'v19-source-intake.json');

function verifySnapshot(snapshot) {
  assert(snapshot?.status === 'V19_OWNER_SOURCE_CAPTURED_NOT_RELEASED', 'SNAPSHOT_STATUS');
  assert(snapshot?.v18FrozenSha256 === FROZEN_SHA, 'SNAPSHOT_V18_FINGERPRINT');
  const bad = snapshot.files.filter(x => sha(path.join(stageDir, 'source', x.path)) !== x.sha256);
  assert(bad.length === 0, 'SNAPSHOT_BYTES_DRIFT');
  return snapshot;
}
export function collect() {
  const oldFreeze = path.join(ROOT, V18, 'release-v18-freeze.json');
  assert(sha(oldFreeze) === FROZEN_SHA, 'V18_FREEZE_IMMUTABLE');
  const live = auditOwner(ROOT, { mode: 'intake' });
  assert(live.baselineVerified && live.blockers.length === 0, 'CURRENT_OWNER_V18_PARITY');
  assert(live.installedVersion === BASE_VERSION, 'RUNNING_VERSION_UNEXPECTED');
  assert(live.frozenBridgeFiles === 58, 'ORIGINAL_BRIDGE_COUNT');
  const freeze = JSON.parse(fs.readFileSync(oldFreeze, 'utf8'));
  const bridge = JSON.parse(fs.readFileSync(path.join(ROOT, V18, 'bridge/bridge-manifest.json'), 'utf8'));
  const original = Object.assign({}, freeze.latestFormalSourceSHA256,
    Object.fromEntries(bridge.files.map(x => [x.file, x.sha256])));
  const files = [...new Set([...Object.keys(original), ...Object.keys(BASELINE_CLAIMS), ...TEST_FILES])].sort();
  const entries = files.map(rel => {
    assert(safe(rel), 'UNSAFE_SOURCE_PATH');
    const full = path.join(ROOT, rel);
    assert(fs.existsSync(full) && fs.statSync(full).isFile(), 'MISSING_SOURCE_' + rel);
    const observed = sha(full), owner = BASELINE_CLAIMS[rel]?.[0] || null;
    return { path: rel, sha256: observed, bytes: fs.statSync(full).size,
      v18Sha256: original[rel] || null, issue: owner, changedSinceV18: !!original[rel] && original[rel] !== observed };
  });
  const hashes = Object.fromEntries(entries.map(x => [x.path, x.sha256]));
  const judgement = evaluateClaims(original, BASELINE_CLAIMS, hashes);
  assert(judgement.mismatchedClaims.length === 0, 'SPECIALIST_HASH_CHANGED_SINCE_HANDOFF');
  assert(judgement.unresolved.length === 0, 'UNATTRIBUTED_V18_SOURCE_CHANGE');
  // Review is still required for shared UI and four independently versioned plugin builds.
  const blockers = ['CANDIDATE_NOT_BUILT', 'PR3_FROZEN_HASH_CHECK_FAILED',
    'V19_NO_APPROVED_OFFICIAL_NSIS', 'SHARED_UI_OWNER_REVIEW_PENDING',
    'LIVE_FOUR_CHANNEL_PROVIDER_ACK_NOT_VERIFIED'];
  return { status: 'V19_OWNER_SOURCE_CAPTURED_NOT_RELEASED', schema: 1, task: 'YEN-6',
    baseVersion: BASE_VERSION, proposedVersion: 'v19-candidate-not-issued',
    ownerScopeOnly: true, friendUntouched: true,
    v18FrozenSha256: FROZEN_SHA, files: entries, count: entries.length,
    changedSinceV18: judgement.drifts, changedCount: judgement.drifts.length,
    newCount: entries.filter(x => !x.v18Sha256).length,
    frozenBridgeFiles: bridge.files.length,
    installedV18Components: Object.fromEntries(Object.entries(live.components).map(([k, v]) => [k, v.installedSha256])),
    pinnedPlatformPlugins: OPTIONAL_BASELINE, blockers, releaseEligible: false,
    sourceSelectionOnly: true, createsNoRunnableSecondApp: true };
}
export function capture() {
  const info = collect();
  if (fs.existsSync(stageDir)) {
    assert(fs.existsSync(manifestPath), 'EXISTING_STAGE_WITHOUT_MANIFEST');
    const stored = verifySnapshot(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    assert(JSON.stringify(stored.files) === JSON.stringify(info.files), 'FORMAL_SOURCE_MOVED_AFTER_STAGE');
    return stored;
  }
  const parent = path.dirname(stageDir);
  fs.mkdirSync(parent, { recursive: true });
  const temp = stageDir + '.pending';
  assert(!fs.existsSync(temp), 'EXISTING_PENDING_STAGE_REQUIRES_REVIEW');
  try {
    fs.mkdirSync(temp);
    for (const item of info.files) {
      const dest = path.join(temp, 'source', item.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(ROOT, item.path), dest, fs.constants.COPYFILE_EXCL);
      assert(sha(dest) === item.sha256, 'STAGED_SOURCE_CHANGED:' + item.path);
    }
    fs.writeFileSync(path.join(temp, 'v19-source-intake.json'), JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, stageDir);
    return verifySnapshot(info);
  } catch (e) {
    if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
    throw e;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv.includes('--verify') ? 'verify' : 'capture';
    const v = mode === 'verify' ? verifySnapshot(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) : capture();
    console.log('YEN6_V19_OWNER_SOURCE_INTAKE ' + JSON.stringify({
      status: v.status, sourceFiles: v.count, frozenBridgeFiles: v.frozenBridgeFiles,
      changedSinceV18: v.changedCount, newSourceFiles: v.newCount,
      conflicts: v.changedSinceV18, blockers: v.blockers,
      result: v.releaseEligible ? 'ELIGIBLE' : 'NOT_RELEASED',
      manifest: path.relative(ROOT, manifestPath), manifestSha256: sha(manifestPath)
    }));
  } catch (e) {
    console.error(String(e.message || e));
    process.exitCode = 14;
  }
}
