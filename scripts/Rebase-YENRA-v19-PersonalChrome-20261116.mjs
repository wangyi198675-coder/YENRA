// YEN-6: byte-verifiable restoration of the already released Personal Chrome
// integration into ONLY the isolated v19 combined client. Original v18 is read only.
// Never patch installed binary, credentials, profile, Cloud account or sender.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const oldFile=path.join(root,'runtime/ui-candidate-desktop-home/profiles/desktop/node_modules/@yenra/desktop-ui-candidate/lib/client.js');
const input=path.join(root,'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-build-03/desktop-native-merged/client.js');
const dir=path.join(root,'artifacts/YENRA_V19_OWNER_INTAKE_20261116/v19-owner-build-03/desktop-merged-complete');
const target=path.join(dir,'client.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error('YEN6_PERSONAL_CHROME_REBASE_BLOCK_'+m)};
const one=(text,needle)=>{const a=text.indexOf(needle);if(a<0||text.indexOf(needle,a+needle.length)>=0)fail('ANCHOR_NOT_UNIQUE_'+needle.slice(0,35));return a};
function addBefore(text,needle,payload){
 const a=one(text,needle);return text.slice(0,a)+payload+text.slice(a);
}
const original=fs.readFileSync(oldFile,'utf8');
if(sha(original)!=='53c47a14f15ba57a64190228eaaba1a1545e0aee66fd7f703a13593ec84e641f')
 fail('V18_INSTALLED_CLIENT_CHANGED');
const prefix='const PERSONAL_CONTACT_COMMAND=', suffix=';\nfunction cloudNativeTheme(host) {';
const a=one(original,prefix),b=original.indexOf(suffix,a+prefix.length);
if(b<0||b<=a)fail('V18_ORIGINAL_CONTACT_COMMAND_MISSING');
const literal=original.slice(a+prefix.length,b);
const command=JSON.parse(literal);
if(!command.includes('version===4')||!command.includes('__yenraPersonalContactsV1')||
   !command.includes('validNativeTabs'))fail('ORIGINAL_COMMAND_NOT_V4');
const candidate=fs.readFileSync(input,'utf8');
if(candidate.includes('PERSONAL_CONTACT_COMMAND')||
 !candidate.includes('/api/yenra/social-native-read')||
 !candidate.includes('findVerifiedHistoricalMessages'))fail('CANDIDATE_WRONG_NATIVE_SOURCE');
const declaration='const PERSONAL_CONTACT_COMMAND='+literal+';\n';
const call=`if (el.executeJavaScript && visibleRef.current) {
  const command=toolsRef.current
    ? "window.__yenraPersonalContactsV1?.disable?.() ?? ({enabled:false,reason:'disabled'})"
    : PERSONAL_CONTACT_COMMAND;
  el.executeJavaScript(command).then(detail=>{
    if(!disposed&&guest===el&&detail)
      window.dispatchEvent(new CustomEvent('yenra:personal-chrome',{detail}));
  }).catch(()=>{});
}
`;
const listen=`const onPersonalChromeRequest=()=>{
 if(!disposed&&visibleRef.current)applyVisuals().catch(()=>{});
};
window.addEventListener('yenra:personal-chrome-request',onPersonalChromeRequest);
`;
const cleanup="window.removeEventListener('yenra:personal-chrome-request',onPersonalChromeRequest);\n";
let patched=addBefore(candidate,'function cloudNativeTheme(host) {',declaration);
patched=addBefore(patched,'const caption = captionRef.current;',call);
patched=addBefore(patched,'const installContactNavigation = () => {',listen);
patched=addBefore(patched,'clearInterval(dshTranslationWatchdog);',cleanup);
if(!patched.includes('PERSONAL_CONTACT_COMMAND')||
 !patched.includes('findVerifiedHistoricalMessages')||
 !patched.includes('WA_READ_SELF_ONLY')||
 !patched.includes('__yenraDshCloudTranslateActionV19'))
 fail('MERGE_REQUIRED_MARKER_MISSING');
// Strict reversible patch; no untracked source/library changes are permitted.
let reversed=patched;
for(const insertion of [cleanup,listen,call,declaration]){
 if(reversed.split(insertion).length!==2)fail('INSERTION_NOT_EXACTLY_ONCE');
 reversed=reversed.replace(insertion,'');
}
if(reversed!==candidate)fail('NOT_BYTE_REVERSIBLE');
fs.mkdirSync(dir,{recursive:true});
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==patched)fail('EXISTING_OUTPUT_DIFFERENT');
if(!fs.existsSync(target))fs.writeFileSync(target,patched,{flag:'wx'});
execFileSync(process.execPath,['--check',target],{timeout:15000});
const proof={status:'V19_PERSONAL_CHROME_V18_PRESERVED_IN_ISOLATED_CANDIDATE',
 task:'YEN-6',base:'0.2.1-rc.5.20261116.18',
 installedV18Sha256:sha(original), compiledInputSha256:sha(candidate),
 compiledOutputSha256:sha(patched), preservedCommandSha256:sha(command),
 sourceCopiedFromUnmodifiedV18:true, insertedExactlyFourAnchors:true, exactRollback:true,
 originalCloudContactToggleRetained:patched.includes('conversations-list-wrap.hidden'),
 originalReadRetained:patched.includes('WA_READ_SELF_ONLY'),
 originalHistoricalMessageRetained:patched.includes('findVerifiedHistoricalMessages'),
 newReplyTranslationRetained:patched.includes('diagnoseAdviceChoices')&&patched.includes('__yenraDshCloudTranslateActionV19'),
 v18StillRunning:true, officialNsisBuilt:false, deployed:false};
const out=path.join(dir,'rebase-proof.json');
fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n');
console.log('YEN6_OWNER_PERSONAL_CHROME_SOURCE_REBASE '+JSON.stringify({
 result:'ISOLATED_COMPILATION_NOT_INSTALLED',
 clientSha256:proof.compiledOutputSha256,exactRollback:true,preservedCommandSha256:proof.preservedCommandSha256,
 proof:path.relative(root,out)}));
