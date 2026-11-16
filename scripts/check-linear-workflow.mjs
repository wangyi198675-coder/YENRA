import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const required = [
  'docs/LINEAR_GITHUB_YENRA_WORKFLOW.md',
  '.github/pull_request_template.md',
  '.github/workflows/linear-workflow-check.yml',
];
const failures = [];
for (const path of required) {
  if (!fs.existsSync(path)) failures.push(`required governance file missing: ${path}`);
}

const event = process.env.GITHUB_EVENT_NAME;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (event === 'pull_request' && eventPath && fs.existsSync(eventPath)) {
  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = payload.pull_request ?? {};
  const branch = pr.head?.ref ?? '';
  const body = pr.body ?? '';
  const title = pr.title ?? '';
  if (!/YEN-\d+/i.test(title) || !/YEN-\d+/i.test(branch)) {
    failures.push('PR title and branch both must include the Linear issue id (YEN-123).');
  }
  if (!/linear\.app\/yenra\/issue\/YEN-\d+/i.test(body)) {
    failures.push('PR body must link the authoritative Linear issue.');
  }
}

const base = process.env.GITHUB_BASE_REF || 'main';
if (process.env.GITHUB_ACTIONS === 'true' && event === 'pull_request') {
  try {
    const files = execFileSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
    const dangerous = [
      /(^|\/)(?:node_modules|backups|exports|evidence|artifacts|\.dsh-uploads|brain-memory|legacy-readonly)(\/|$)/i,
      /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|id_rsa|\.git-credentials$)/i,
      /(^|\/)(?:credentials|secrets|profile|profiles)(\/|$)/i,
      /\.(?:sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|log|p12|pfx|pem|key|asc|session|zip|7z|exe|msi|nsis)$/i,
      /^runtime\//i,
      /^upstream\//i,
    ];
    for (const f of files) if (dangerous.some(pattern => pattern.test(f))) {
      failures.push(`private/runtime artifact is not allowed in PR: ${f}`);
    }
    process.stdout.write(`Reviewed ${files.length} changed paths\n`);
  } catch (err) {
    failures.push(`unable to inspect changed paths: ${err.message}`);
  }
}

if (failures.length) {
  failures.forEach(s => console.error('FAIL:', s));
  process.exit(1);
}
console.log('YENRA workflow and guarded path checks passed. This is NOT production acceptance.');
