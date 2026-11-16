// Read-only reconciliation of a published YENRA release with an isolated Git candidate.
// Never copies private offline tarballs, contacts, credentials, or frozen v18 bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  if (i < 0 || !args[i + 1]) throw Error('Missing --' + name);
  return path.resolve(args[i + 1]);
};
const formal = opt('formal');
const candidate = opt('candidate');
const snapshotFile = opt('snapshot');
const captured = opt('captured');
const freezeFile = opt('freeze');
const releaseBridge = opt('release-bridge');
const sha = p => fs.existsSync(p)
  ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  : null;
const data = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const snapshot = data(snapshotFile);
const frozen = data(freezeFile);
const bridge = data(path.join(releaseBridge, 'bridge-manifest.json'));
const summarize = (rows, limit = 25) => ({
  count: rows.length,
  paths: rows.slice(0, limit),
  omitted: Math.max(0, rows.length - limit),
});
const all = snapshot.files.map(f => f.path);
const wrongCaptured = [], currentOwnerDrift = [], candidateDrift = [], candidateMissing = [];
for (const f of snapshot.files) {
  if (sha(path.join(captured, f.path)) !== f.sha256) wrongCaptured.push(f.path);
  if (sha(path.join(formal, f.path)) !== f.sha256) currentOwnerDrift.push(f.path);
  const c = sha(path.join(candidate, f.path));
  if (c !== f.sha256) candidateDrift.push(f.path);
  if (c === null) candidateMissing.push(f.path);
}
const frozenFormalDrift = [];
for (const [file, hash] of Object.entries(frozen.latestFormalSourceSHA256 ?? {})) {
  if (sha(path.join(formal, file)) !== hash) frozenFormalDrift.push(file);
}
const bridgeIncorrect = [], bridgeCandidateDrift = [], bridgeFormalDrift = [];
for (const f of bridge.files) {
  if (sha(path.join(releaseBridge, f.file)) !== f.sha256) bridgeIncorrect.push(f.file);
  if (sha(path.join(candidate, f.file)) !== f.sha256) bridgeCandidateDrift.push(f.file);
  if (sha(path.join(formal, f.file)) !== f.sha256) bridgeFormalDrift.push(f.file);
}
const snapshotHash = sha(snapshotFile);
const output = {
  kind: 'YENRA_V19_PUBLISHED_SOURCE_READONLY_AUDIT',
  releaseVersion: frozen.version,
  snapshotStatus: snapshot.status,
  snapshotFileCount: all.length,
  snapshotChangedSinceV18: snapshot.files.filter(f => f.changedSinceV18).length,
  releaseSnapshotManifestExpectedSha: frozen.v19OwnerSource05ManifestSha256 ?? null,
  releaseSnapshotManifestActualSha: snapshotHash,
  releaseSnapshotManifestExact: snapshotHash === frozen.v19OwnerSource05ManifestSha256,
  snapshotCaptureIntegrity: summarize(wrongCaptured),
  currentOwnerDriftSinceCapture: summarize(currentOwnerDrift),
  candidateDiffFromPublishedSnapshot: summarize(candidateDrift, 50),
  candidateAbsentFromPublishedSnapshot: summarize(candidateMissing, 20),
  frozenFormalSourceDrift: summarize(frozenFormalDrift),
  frozenBridgeCount: bridge.files.length,
  frozenBridgeIntegrity: summarize(bridgeIncorrect),
  candidateDiffFromFrozenBridge: summarize(bridgeCandidateDrift, 50),
  currentOwnerDiffFromFrozenBridge: summarize(bridgeFormalDrift),
  publicOfflineTarballsCopied: false,
};
console.log(JSON.stringify(output, null, 2));
if (wrongCaptured.length || bridgeIncorrect.length || !output.releaseSnapshotManifestExact)
  process.exitCode = 2;
