import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaims } from './Freeze-YENRA-v19-Owner-Source-20261116.mjs';
import { checkMarkers, requiredFromV18, requiredV19 } from './Verify-YENRA-v19-Owner-Compiled-20261116.mjs';

test('v19 source never changes v18 hash and every changed path keeps its owner', () => {
 const f={'ui/a.ts':'1'.repeat(64),'bridge/b.mjs':'2'.repeat(64)};
 const claims={'ui/a.ts':['YEN-11','3'.repeat(64)]};
 const result=evaluateClaims(f,claims,{'ui/a.ts':'3'.repeat(64),'bridge/b.mjs':'2'.repeat(64)});
 assert.equal(f['ui/a.ts'],'1'.repeat(64));
 assert.deepEqual(result.unresolved,[]);
 assert.deepEqual(result.mismatchedClaims,[]);
 assert.equal(result.drifts.length,1);
 assert.equal(result.drifts[0].owner,'YEN-11');
});
test('v19 rejects unattributed overlap and specialist hash changing after handoff',()=>{
 const result=evaluateClaims({'shared/ui.ts':'a'.repeat(64)},
  {'shared/ui.ts':['YEN-7','b'.repeat(64)]},
  {'shared/ui.ts':'c'.repeat(64)});
 assert.equal(result.drifts.length,1);
 assert.equal(result.mismatchedClaims.length,1);
 const unowned=evaluateClaims({'bridge/index.mjs':'a'.repeat(64)}, {},
  {'bridge/index.mjs':'b'.repeat(64)});
 assert.deepEqual(unowned.unresolved,['bridge/index.mjs']);
});
test('naive compilation must fail when v18 native read and Personal Chrome are lost',()=>{
 const installed=requiredFromV18.join('\n');
 const naive=requiredFromV18.filter(x=>!['WA_READ_SELF_ONLY','/api/yenra/social-native-read','PERSONAL_CONTACT_COMMAND'].includes(x)).join('\n')+requiredV19.join('\n');
 const r=checkMarkers(installed,naive);
 assert.deepEqual(r.lost.sort(),['WA_READ_SELF_ONLY','/api/yenra/social-native-read','PERSONAL_CONTACT_COMMAND'].sort());
});
test('one integrated client retains original and new anchors without double UI',()=>{
 const installed=requiredFromV18.join('\n');
 const candidate=installed+'\n'+requiredV19.join('\n');
 const r=checkMarkers(installed,candidate);
 assert.deepEqual(r.lost,[]);
 assert.deepEqual(r.missed,[]);
});
