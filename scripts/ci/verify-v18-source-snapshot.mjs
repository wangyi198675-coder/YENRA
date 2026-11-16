import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/v18-source-hashes.json'), 'utf8').replace(/^\uFEFF/, ''));
const issues = [];
function verify(entry, scope) {
  const rel = entry.file;
  if (!/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/i.test(rel) || rel.includes('..')) {
    issues.push(scope + ': unexpected path'); return;
  }
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { issues.push(scope + ': missing ' + rel); return; }
  const bytes = fs.readFileSync(file);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest.toLowerCase() !== String(entry.sha256).toLowerCase()) {
    issues.push(scope + ': changed since v18 freeze ' + rel);
  }
  if (entry.bytes !== undefined && bytes.byteLength !== Number(entry.bytes)) {
    issues.push(scope + ': byte-size mismatch ' + rel);
  }
}
if (manifest.version !== '0.2.1-rc.5.20261116.18') issues.push('unrecognized baseline version');
if (manifest.bridgeFiles?.length !== 58) issues.push('frozen Bridge inventory must have 58 entries');
if (!Array.isArray(manifest.latestFormalSources) || manifest.latestFormalSources.length < 19) {
  issues.push('incomplete frozen formal source inventory');
}
for (const x of manifest.bridgeFiles ?? []) verify(x, 'Bridge');
for (const x of manifest.latestFormalSources ?? []) verify(x, 'UI');
console.log(JSON.stringify({ baseline: manifest.version, bridge: manifest.bridgeFiles?.length,
  latestFormalSources: manifest.latestFormalSources?.length, failures: issues }, null, 2));
if (issues.length) process.exitCode = 1;
