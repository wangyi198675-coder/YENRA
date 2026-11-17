// YEN-6: build-only source-level v19 integration. Preserve v18 provider read AND
// the mature W25/DSH history fallback; do not modify any specialist's author file.
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { clientBundle } from '../upstream/official-source/packages/client/tsdown.client.ts';
const root=resolve(import.meta.dirname,'..');
const moduleDir=resolve(root,'ui/chatwoot-embed/desktop-integration-candidate');
const original=resolve(root,'ui/desktop-candidate/src/client/oss-native-social.tsx');
const shadow=resolve(moduleDir,'src/client/oss-native-social.tsx');
const sha=s=>createHash('sha256').update(s).digest('hex');
const src=readFileSync(original,'utf8');
const stale=readFileSync(shadow,'utf8');
if(sha(src)!=='9a6bd06ca499b39c4754484990bfe796b7df6d8e373d76f93ef96dd282b92761'||
   sha(stale)!=='0a59bfc21fc6075d1fc625e96079732830f91bd67d76a36246fc62ed9766e984')
  throw Error('YEN6_V19_NATIVE_SOCIAL_SOURCE_MISMATCH');
function section(start,end){
  const i=src.indexOf(start),j=src.indexOf(end,i+start.length);
  if(i<0||j<=i||src.indexOf(start,i+1)>=0)throw Error('YEN6_V19_REAL_READ_FRAGMENT_NOT_UNIQUE');
  return src.slice(i,j);
}
const state=section("  const [personalReadError,setPersonalReadError]=useState('');",
  '  // A successful identity read is retained');
const read=section('          // Same human-visible-read gate across WhatsApp1/2, Page and Personal.',
  '          // A verified open room is newer than a stale roster snapshot.');
const message=section('    {personalReadError?<p role="status"',
  '    {!signature?<div role="status"');
function insert(input,needle,fragment,label){
  const first=input.indexOf(needle);
  if(first<0||input.indexOf(needle,first+needle.length)>=0)throw Error('YEN6_V19_SOCIAL_ANCHOR_'+label);
  return input.slice(0,first)+fragment+input.slice(first);
}
function mergeNativeSocial(code){
  if(sha(code)!==sha(stale))throw Error('YEN6_V19_SOCIAL_AUTHOR_BYTES_MOVED');
  if(!code.includes('findVerifiedHistoricalMessages:async')||code.includes('WA_READ_SELF_ONLY'))
    throw Error('YEN6_V19_SOCIAL_EXPECTED_HISTORY_ONLY');
  let result=insert(code,'  // A successful identity read is retained',state,'READ_STATE');
  result=insert(result,'          // A verified open room is newer than a stale roster snapshot.',read,'READ_HOOK');
  result=insert(result,'    {!signature?<div role="status"',message,'READ_ERROR_UI');
  if(!result.includes('findVerifiedHistoricalMessages:async')||
     !result.includes('/api/yenra/social-native-read')||
     !result.includes('WA_READ_SELF_ONLY'))
    throw Error('YEN6_V19_MERGED_SOCIAL_CONTRACT');
  return result;
}
const normalized=p=>String(p||'').split('?')[0].replaceAll('\\','/').toLowerCase();
const nativeSocialMerge={
 name:'yen6-original-read-and-history-preservation',
 enforce:'pre',
 transform(code,id){
  if(normalized(id)!==normalized(shadow))return null;
  return {code:mergeNativeSocial(code),map:null};
 }
};
const preset=clientBundle(moduleDir,['src/index.ts']);
export default ()=>preset({env:{}}).slice(1).map(config=>({
 ...config,
 entry:[resolve(moduleDir,'src/client/index.ts')],
 outDir:resolve(root,'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-build-03/desktop-native-merged'),
 clean:false,
 alias:{
  '../../../../upstream/official-source':resolve(root,'upstream/official-source'),
  '../../../../social-adapters':resolve(root,'social-adapters'),
 },
 plugins:[...(config.plugins||[]),nativeSocialMerge]
}));
