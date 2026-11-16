// YEN-15 public-release privacy admission, intentionally conservative.
// Only reports counts/paths, never matched account IDs or potential credentials.
// This check supplements (not replaces) the general secret/PII scanner.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})
  .split('\0').filter(Boolean);
// Review heuristic: possible six-digit deployment account / inbox identifiers.
// Broad ranges are used rather than embedding the owner's exact account IDs.
const deploymentLike=/\b(?:155\d{3}|196\d{3})\b/g;
const flagged=[];
let occurrences=0;
for(const rel of files){
  const full=path.join(root,rel);
  if(!fs.existsSync(full)||!fs.statSync(full).isFile())continue;
  const input=fs.readFileSync(full,'utf8');
  const matches=input.match(deploymentLike);
  if(matches?.length){occurrences+=matches.length;flagged.push(rel);}
}
const result={
  gate:'YEN-15 deployment identifiers in public release sources',
  scannedTrackedFiles:files.length,
  filesRequiringReview:flagged.length,
  occurrenceCount:occurrences,
  samplePaths:flagged.slice(0,12),
  rule:'Conservative 6-digit deployment-ID heuristic; review false positives manually',
  credentialsProvenExposed:false,
  publicReleaseEligible:flagged.length===0
};
console.log(JSON.stringify(result,null,2));
if(!result.publicReleaseEligible)process.exitCode=1;
