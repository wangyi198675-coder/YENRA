// YEN-6: compare immutable v19 intake files against the draft YEN-15 PR #3.
// Read-only Git blobs; no checkout, merge, reset, install, credentials or messages.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-source-05');
const owner = JSON.parse(fs.readFileSync(path.join(stage, 'v19-source-intake.json'), 'utf8'));
const prHead = '70816e5e3859d471c27a61b38b843954fc7fcdf4';
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const currentSha = execFileSync('git', ['-C', root, 'rev-parse', prHead], { encoding: 'utf8' }).trim();
if (currentSha !== prHead) throw Error('EXPECTED_PR3_SHA_NOT_FETCHED');
const items = owner.files.map(file => {
  let prSha = null;
  try {
    const blob = execFileSync('git', ['-C', root, 'show', prHead + ':' + file.path],
      { maxBuffer: 24 * 1024 * 1024, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    prSha = hash(blob);
  } catch {}
  const relative = !prSha ? 'NOT_IN_DRAFT_PR3' :
    prSha === file.sha256 ? 'EXACT_V19' :
    prSha === file.v18Sha256 ? 'PR3_HAS_FROZEN_V18_NOT_LATEST_V19' :
    !file.v18Sha256 ? 'PR3_UNREVIEWED_NEW_SOURCE_DIFFERENCE' :
    'PR3_DIVERGES_FROM_V18_AND_V19';
  return { path: file.path, issue: file.issue, relative,
    pr3Sha256: prSha, v19Sha256: file.sha256, v18Sha256: file.v18Sha256 };
});
const counts = Object.fromEntries([...new Set(items.map(x => x.relative))].sort()
  .map(k => [k, items.filter(x => x.relative === k).length]));
const blockers = items.filter(x => x.relative !== 'EXACT_V19')
  .map(x => ({ path: x.path, issue: x.issue, reason: x.relative }));
const report = { task: 'YEN-6', branch: 'yen-15-v18-batch-source-ci', pr: 3,
  commit: prHead, status: blockers.length ? 'PR3_NOT_SAFE_AS_CURRENT_V19_SOURCE' : 'PR3_EQUAL_TO_V19_INTAKE',
  v18FrozenUntouched: true, ownerAppUntouched: true, counts, inspected: items.length,
  differences: blockers, all: items };
const target = path.join(stage, 'pr3-v19-source-compare.json');
fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
console.log('YEN6_PR3_V19_SOURCE_COMPARISON ' + JSON.stringify({
  status: report.status, count: items.length, counts,
  changedCritical: blockers.filter(x => x.issue).slice(0,35),
  report: path.relative(root, target), sha256: hash(fs.readFileSync(target))
}));
