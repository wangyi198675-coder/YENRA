// YEN-6: immutable v18 owner baseline and next-release admission. No install, network, or messages.
// The friend computer is intentionally never inspected: owner-only releases are independently gated.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const BASE_VERSION = '0.2.1-rc.5.20261116.18';
// Public-source safe: record only the SHA-256 of the authorized computer name.
const OWNER_HOST_SHA256 = 'c1848def40873518e2beabe8500aa35e7136870fa00a620a52f3293ad625a453';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = 'artifacts/YENRA_DUAL_MACHINE_UNIFICATION_20261114/unified-release-candidate-20261116-18';
const PROFILE = 'runtime/ui-candidate-desktop-home/profiles/desktop';
const COMPONENTS = Object.freeze({
  ui: { rel: PROFILE + '/node_modules/@yenra/desktop-ui-candidate/lib/client.js', freeze: 'sourceUI' },
  host: { rel: PROFILE + '/node_modules/@yenra/desktop-ui-candidate/lib/index.js', freeze: 'sourceHost' },
  im: { rel: PROFILE + '/node_modules/@xmanrui/dsh-im/lib/index.js', freeze: 'imSrcHashes.lib/index.js' },
  memory: { rel: PROFILE + '/node_modules/@guntur-d/dsh-memory/lib/index.js', freeze: 'memoryClientSha' },
  embed: { rel: PROFILE + '/node_modules/@yenra/chatwoot-embed/lib/index.js', freeze: 'embedHostSHA256' }
});
const PINNED_IDS = Object.freeze([
  '@yenra/desktop-ui-candidate', '@xmanrui/dsh-im', '@guntur-d/dsh-memory',
  '@yenra/chatwoot-embed', '@local/yenra-personal-chrome'
]);
const SHA = /^[a-f0-9]{64}$/i;
const isSafeRel = p => typeof p === 'string' && p.length > 0 &&
  !path.isAbsolute(p) && !p.includes('\\') && !p.split('/').some(x => x === '..' || x === '' || x === '.') &&
  !/(^|\/)(?:runtime|upstream|artifacts|backups|evidence|\.git|node_modules|profiles)(\/|$)/i.test(p);
export const readVersion = v => {
  const m = /^0\.2\.1-rc\.5\.(20\d{6})\.(\d+)$/.exec(String(v));
  return m ? { date: Number(m[1]), revision: Number(m[2]) } : null;
};
export function isNewerThanBaseline(version, baseline = BASE_VERSION) {
  const a = readVersion(version), b = readVersion(baseline);
  return !!(a && b && (a.date > b.date || (a.date === b.date && a.revision > b.revision)));
}
export function profileContract(actual, original) {
  const problems = [];
  const bundles = actual?.dsh?.profile?.bundles;
  const deps = actual?.dependencies;
  const oldDeps = original?.dependencies;
  if (!Array.isArray(bundles) || bundles.length !== 42 || new Set(bundles).size !== 42)
    problems.push('PROFILE_42_UNIQUE_BUNDLES');
  if (!deps || Object.keys(deps).length !== 32) problems.push('PROFILE_32_DEPENDENCIES');
  if (JSON.stringify(bundles) !== JSON.stringify(original?.dsh?.profile?.bundles))
    problems.push('ORIGINAL_BUNDLE_ORDER_CHANGED');
  for (const id of PINNED_IDS) {
    if (!deps?.[id] || deps[id] !== oldDeps?.[id])
      problems.push('BASELINE_PIN_DRIFT:' + id);
  }
  if (bundles?.filter(x => x === '@yenra/desktop-ui-candidate').length !== 1 ||
      bundles?.filter(x => x === '@local/yenra-personal-chrome').length !== 1)
    problems.push('SECOND_OR_MISSING_DESKTOP_UI');
  return problems;
}
export function candidateContract(candidate, baseline, root, fileSha) {
  const errors = [];
  const fail = name => errors.push(name);
  if (candidate?.schema !== 1) fail('CANDIDATE_SCHEMA');
  if (candidate?.baseVersion !== baseline.version) fail('CANDIDATE_WRONG_BASE_VERSION');
  if (!isNewerThanBaseline(candidate?.version, baseline.version)) fail('CANDIDATE_VERSION_NOT_NEWER');
  if (candidate?.targetMachine !== 'owner' || candidate?.deploymentScope !== 'owner-only')
    fail('CANDIDATE_OWNER_SCOPE');
  if (candidate?.provenance?.githubPrVerified !== true ||
      !/^https:\/\/github\.com\/wangyi198675-coder\/YENRA\/pull\/\d+$/.test(candidate?.provenance?.pullRequest || ''))
    fail('CANDIDATE_PR_NOT_VERIFIED');
  if (candidate?.provenance?.ciStatus !== 'success' || candidate?.provenance?.reviewedByOwner !== true)
    fail('CANDIDATE_CI_OR_REVIEW_MISSING');
  if (!Array.isArray(candidate?.changedSourceFiles) || candidate.changedSourceFiles.length === 0)
    fail('CANDIDATE_SOURCE_CHANGESET_MISSING');
  else {
    for (const x of candidate.changedSourceFiles) {
      if (!isSafeRel(x.path) || !SHA.test(x.sha256 || '')) {
        fail('UNSAFE_SOURCE_RECORD'); continue;
      }
      const full = path.resolve(root, x.path);
      if (!full.startsWith(path.resolve(root) + path.sep) || fileSha(full) !== x.sha256.toLowerCase())
        fail('SOURCE_SHA_NOT_CURRENT:' + x.path);
    }
  }
  const expectedKeys = Object.keys(COMPONENTS);
  for (const key of expectedKeys)
    if (!SHA.test(candidate?.componentSha256?.[key] || '')) fail('CANDIDATE_COMPONENT_HASH_MISSING:' + key);
  if (candidate?.qa?.sourceRegressionPassed !== true ||
      candidate?.qa?.compiledIntegrationPassed !== true ||
      candidate?.qa?.noRegressionToV18 !== true)
    fail('CANDIDATE_QA_NOT_PASSED');
  if (candidate?.safety?.singleDshElectron !== true ||
      candidate?.safety?.singleSenderBridge !== true ||
      candidate?.safety?.singleMemoryService !== true ||
      candidate?.safety?.noCredentialsOrPersonalData !== true ||
      candidate?.safety?.noHumanTestMessages !== true)
    fail('CANDIDATE_SAFETY_GATES');
  // A frozen proposal alone is never installable: require a separately verified official installer.
  if (candidate?.build?.officialNsisVerified !== true ||
      !SHA.test(candidate?.build?.installerSha256 || '') ||
      !Number.isSafeInteger(candidate?.build?.bytes) || candidate.build.bytes < 500_000_000 ||
      typeof candidate?.build?.installerPath !== 'string')
    fail('OFFICIAL_NSIS_VERIFICATION_MISSING');
  else {
    const full = path.resolve(root, candidate.build.installerPath);
    if (!full.startsWith(path.resolve(root) + path.sep) ||
        !fs.existsSync(full) || fs.statSync(full).size !== candidate.build.bytes ||
        fileSha(full) !== candidate.build.installerSha256.toLowerCase())
      fail('OFFICIAL_NSIS_BYTES_CHANGED');
  }
  return errors;
}
function shaFile(p) {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
  // Stream hash to avoid loading 700 MB installers into memory.
  const h = crypto.createHash('sha256'), fd = fs.openSync(p, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      h.update(buffer.subarray(0, count));
    return h.digest('hex');
  } finally { fs.closeSync(fd); }
}
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
function getVersion(exe) {
  if (!fs.existsSync(exe)) return null;
  const command = "(Get-Item -LiteralPath '" + exe.replace(/'/g, "''") + "').VersionInfo.FileVersion";
  const p = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  return p.status === 0 ? p.stdout.trim() : null;
}
export function auditOwner(root = DEFAULT_ROOT, { candidatePath = null, mode = 'intake', machine = process.env.COMPUTERNAME || os.hostname() } = {}) {
  const blockers = [], notes = [];
  const block = x => blockers.push(x);
  if (crypto.createHash('sha256').update(String(machine).toUpperCase()).digest('hex') !== OWNER_HOST_SHA256) block('NOT_OWNER_MACHINE');
  const frozen = json(path.join(root, RELEASE, 'release-v18-freeze.json'));
  const installed = json(path.join(root, PROFILE, 'package.json'));
  const seed = json(path.join(root, RELEASE, 'seed/package.json'));
  const issues = profileContract(installed, seed);
  for (const issue of issues) block(issue);
  const installedVersion = getVersion(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Programs/YENRA/YENRA.exe'));
  if (installedVersion !== BASE_VERSION) block('INSTALLED_EXE_VERSION_NOT_V18');
  if (frozen.version !== BASE_VERSION) block('FROZEN_BASE_NOT_V18');
  const components = {};
  for (const [name, spec] of Object.entries(COMPONENTS)) {
    let expected = spec.freeze.split('.').reduce((v, k) => v?.[k], frozen);
    if (name === 'im') {
      // The old freeze contains an intermediate IM source hash, not its final packaged lib.
      // The v18 installer uses the exact verified rc13 archive; compare the real archive payload.
      const pin = seed.dependencies?.['@xmanrui/dsh-im'];
      const archive = typeof pin === 'string' && pin.startsWith('file:./packages/')
        ? path.join(root, RELEASE, 'seed/packages', pin.slice('file:./packages/'.length)) : null;
      try {
        if (!archive || shaFile(archive) !== frozen.imArchiveSha) throw Error('IM_ARCHIVE_DRIFT');
        const packedLib = execFileSync('tar', ['-xOzf', archive, 'package/lib/index.js'],
          { maxBuffer: 40e6, timeout: 30000, windowsHide: true });
        expected = crypto.createHash('sha256').update(packedLib).digest('hex');
      } catch {
        expected = null;
        block('FROZEN_IM_ARCHIVE_INVALID');
      }
    }
    const actual = shaFile(path.join(root, spec.rel));
    components[name] = { matchesV18: actual === expected, installedSha256: actual, v18Sha256: expected || null };
    if (!actual || !expected || actual !== expected) block('INSTALLED_COMPONENT_DRIFT:' + name);
  }
  const bridge = json(path.join(root, RELEASE, 'bridge/bridge-manifest.json'));
  if (bridge.codeFiles !== 53 || bridge.supportFiles !== 5 || bridge.files.length !== 58 ||
      bridge.noSecondSender !== true || bridge.noSecondWhatsAppSocket !== true)
    block('FROZEN_BRIDGE_MANIFEST_INVALID');
  const drift = [];
  for (const [rel, digest] of Object.entries(frozen.latestFormalSourceSHA256 || {})) {
    if (shaFile(path.join(root, rel)) !== digest) drift.push({ area: 'source', path: rel });
  }
  for (const entry of bridge.files) {
    if (!isSafeRel(entry.file) || shaFile(path.join(root, entry.file)) !== entry.sha256)
      drift.push({ area: 'bridge', path: entry.file });
  }
  if (drift.length) notes.push('FORMAL_SOURCE_CHANGED_SINCE_V18_REQUIRES_REBUILD');
  if (!candidatePath && mode === 'release') block('NEW_CANDIDATE_NOT_PROVIDED');
  if (candidatePath) {
    const full = path.resolve(candidatePath);
    const rootFull = path.resolve(root);
    if (!full.startsWith(rootFull + path.sep) || !fs.existsSync(full))
      block('CANDIDATE_MANIFEST_OUTSIDE_FORMAL_PROJECT_OR_MISSING');
    else {
      const c = json(full);
      blockers.push(...candidateContract(c, frozen, root, shaFile));
      if (drift.length) {
        const indexed = new Set((c.changedSourceFiles || []).map(x => x.path));
        for (const d of drift) if (!indexed.has(d.path)) block('UNREVIEWED_SOURCE_DRIFT:' + d.path);
      }
    }
  }
  return {
    schema: 1, task: 'YEN-6', baseline: BASE_VERSION, ownerMachine: 'owner',
    mode, installedVersion, baselineVerified: !blockers.some(x => /^(?:NOT_OWNER|INSTALLED_|FROZEN_BASE|PROFILE_|BASELINE_PIN|ORIGINAL_|SECOND_|FROZEN_BRIDGE)/.test(x)),
    releaseEligible: mode === 'release' && !!candidatePath && blockers.length === 0,
    friendMachineRequiredForOwnerRelease: false,
    friendMachineTouched: false, components, frozenBridgeFiles: bridge.files.length,
    sourceDriftSinceV18: drift, notes, blockers
  };
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2), opt = (key, def) => args.includes(key) ? args[args.indexOf(key) + 1] : def;
  const mode = opt('--mode', 'intake');
  if (!['intake', 'release'].includes(mode)) throw new Error('MODE_MUST_BE_INTAKE_OR_RELEASE');
  try {
    const result = auditOwner(opt('--root', DEFAULT_ROOT), { mode, candidatePath: opt('--candidate', null) });
    console.log(JSON.stringify(result, null, 2));
    if (result.blockers.length) process.exitCode = 12;
    else if (mode === 'release' && !result.releaseEligible) process.exitCode = 12;
  } catch (err) {
    console.error('YEN6_OWNER_RELEASE_GATE_ERROR ' + String(err?.message || err));
    process.exitCode = 12;
  }
}
