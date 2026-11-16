import test from 'node:test';
import assert from 'node:assert/strict';
import { readVersion, isNewerThanBaseline, profileContract, candidateContract } from './Assert-YENRA-Owner-ReleaseGate-20261116.mjs';

test('release must be strictly after installed v18; not a renamed stale package', () => {
  assert.deepEqual(readVersion('0.2.1-rc.5.20261116.18'), { date: 20261116, revision: 18 });
  for (const v of ['0.2.1-rc.5.20261116.17', '0.2.1-rc.5.20261116.18', '0.2.1-rc.5.20261115.99', 'v19', '0.2.1-rc.5.20261116.18-old'])
    assert.equal(isNewerThanBaseline(v), false, v);
  assert.equal(isNewerThanBaseline('0.2.1-rc.5.20261116.19'), true);
  assert.equal(isNewerThanBaseline('0.2.1-rc.5.20261117.1'), true);
});
test('owner baseline denies plugin regression or a second desktop UI', () => {
  const bundles = [...Array.from({length: 40}, (_, i) => 'bundle-' + i), '@yenra/desktop-ui-candidate', '@local/yenra-personal-chrome'];
  const dependencies = Object.fromEntries(Array.from({length: 32}, (_, i) => ['dep-' + i, '' + i]));
  for (const id of ['@yenra/desktop-ui-candidate','@xmanrui/dsh-im','@guntur-d/dsh-memory','@yenra/chatwoot-embed','@local/yenra-personal-chrome'])
    dependencies[id] = 'file:./packages/' + id.slice(1).replaceAll('/', '-') + '.tgz';
  // Retain exactly 32 dependency IDs after replacing five dummy entries.
  for (let i = 27; i < 32; i++) delete dependencies['dep-' + i];
  const src = { dsh: {profile: {bundles}}, dependencies };
  assert.deepEqual(profileContract(structuredClone(src), src), []);
  const downgraded = structuredClone(src);
  downgraded.dependencies['@xmanrui/dsh-im'] = 'file:./packages/stale-im.tgz';
  assert.ok(profileContract(downgraded, src).includes('BASELINE_PIN_DRIFT:@xmanrui/dsh-im'));
  const extra = structuredClone(src);
  extra.dsh.profile.bundles.push('@yenra/desktop-ui-candidate');
  assert.ok(profileContract(extra, src).includes('PROFILE_42_UNIQUE_BUNDLES'));
});
test('candidate cannot claim success without real safe sources, CI, and official installer proof', () => {
  const p = {schema:1,baseVersion:'0.2.1-rc.5.20261116.18',version:'0.2.1-rc.5.20261116.19',targetMachine:'owner',deploymentScope:'owner-only'};
  const failures = candidateContract(p, {version:'0.2.1-rc.5.20261116.18'}, 'C:/YENRA', () => null);
  assert.ok(failures.includes('CANDIDATE_PR_NOT_VERIFIED'));
  assert.ok(failures.includes('CANDIDATE_CI_OR_REVIEW_MISSING'));
  assert.ok(failures.includes('OFFICIAL_NSIS_VERIFICATION_MISSING'));
  assert.ok(failures.includes('CANDIDATE_SOURCE_CHANGESET_MISSING'));
  assert.ok(failures.some(x=>x.includes('CANDIDATE_COMPONENT_HASH_MISSING')));
  const unsafe = candidateContract({...p,changedSourceFiles:[{path:'../runtime/private.json',sha256:'a'.repeat(64)}]}, {version:p.baseVersion}, 'C:/YENRA', () => null);
  assert.ok(unsafe.includes('UNSAFE_SOURCE_RECORD'));
});
