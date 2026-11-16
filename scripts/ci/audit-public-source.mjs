import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}).split('\0').filter(Boolean);
const protectedSegment = /(^|\/)(?:node_modules|runtime|artifacts|upstream|backups|exports|evidence|brain-memory|profiles?|cookies|secrets|credentials|\.dsh-uploads)(\/|$)/i;
const protectedFile = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|.*\.(?:sqlite(?:-.*)?|db(?:-.*)?|exe|msi|asar|7z|zip|tgz|tar|pem|p12|pfx|key|session|log))$/i;
const secretPatterns = [
  ['known credential shape', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['literal bearer token', /\bBearer\s+[A-Za-z0-9_\-\.]{25,}/i],
  ['literal secret assignment', /\b(?:password|secret|accessToken|apiKey)\s*[:=]\s*['"][A-Za-z0-9_.\-]{20,}['"]/i],
  ['personal email', /[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['international contact number', /(?<!\d)\+[1-9]\d{9,14}(?!\d)/],
  ['private local home path', /(?:C:[\\/]Users[\\/]|\/Users\/[A-Za-z0-9_.-]+\/(?:Documents|Desktop|Library)\/)/],
  ['named real-contact fixture', /\b(?:janko|ralf|schmeling|franco|vincenzo|marie|anna|lukas|tommaso)\b/i],
  ['token in query URL', /https?:\/\/[^\s'"<>]{0,120}(?:api_key|access_token|auth_token)=[^\s'"<>]+/i]
];
const errors = [];
let totalBytes = 0;
for (const rel of files) {
  const normalized = rel.replaceAll('\\', '/');
  if (/\b(?:janko|ralf|schmeling|franco|vincenzo|marie|anna|lukas|tommaso)\b/i.test(normalized)) {
    errors.push({ file: normalized, reason: 'named-contact path' }); continue;
  }
  if (protectedSegment.test(normalized) || protectedFile.test(normalized)) {
    errors.push({ file: normalized, reason: 'prohibited path or file type' }); continue;
  }
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
  const stat = fs.statSync(abs);
  if (stat.size > 600_000) { errors.push({ file: normalized, reason: 'unexpected large file' }); continue; }
  totalBytes += stat.size;
  const content = fs.readFileSync(abs, 'utf8');
  if (content.includes('\u0000')) { errors.push({ file: normalized, reason: 'binary content in public source' }); continue; }
  for (const [reason, re] of secretPatterns) {
    // The audit source contains the contact-name detector itself, not fixture data.
    if (reason === 'named real-contact fixture' && /^scripts\/ci\/(audit-public-source\.mjs|import-owner-source\.ps1|import-v18-published-baseline\.mjs|sync-v19-owner-sources\.mjs)$/.test(normalized)) continue;
    // The asset-staging source explicitly rejects such local paths; it does not use one.
    if (reason === 'private local home path' && normalized === 'ui/desktop-candidate/stage-messaging-inbox-assets.mjs') continue;
    if (re.test(content)) errors.push({ file: normalized, reason });
  }
}
console.log(JSON.stringify({
  audit: 'YEN-15 public source preflight',
  files: files.length, totalBytes,
  rejected: errors.length,
  blocked: errors.slice(0, 100)
}, null, 2));
if (errors.length) process.exitCode = 1;
