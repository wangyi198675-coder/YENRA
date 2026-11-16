// PUBLIC SOURCE REFERENCE ONLY: frozen offline inputs are not in GitHub; do not
// run an owner v18 NSIS build or verification without explicit unified release approval.
if(process.env.YENRA_ALLOW_ARCHIVAL_V18_SCRIPT!=='YES') throw Error('YEN-15_UNRELEASED_REFERENCE_ONLY');
// Independent v12 artifact verification; no installation or real messages.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const root=(process.env.YENRA_SOURCE_ROOT ?? path.resolve(import.meta.dirname,'../..')),app=path.join(root,'upstream/official-source/apps/desktop');
const work=path.join(root,'artifacts/YENRA_DUAL_MACHINE_UNIFICATION_20261114/unified-release-candidate-20261116-18');
const built=path.join(app,'.desktop-build/targets/win-x64/unsigned-artifacts'),res=path.join(built,'win-unpacked/resources');
const exe=path.join(built,'YENRA-0.2.1-rc.5.20261116.18-win-x64-BETA-unsigned.exe');
const seed=path.join(work,'seed'),bridge=path.join(work,'bridge'),f=JSON.parse(fs.readFileSync(path.join(work,'release-v18-freeze.json'),'utf8'));
const sha=p=>{const h=crypto.createHash('sha256'),fd=fs.openSync(p,'r'),b=Buffer.allocUnsafe(1<<20);try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));return h.digest('hex')}finally{fs.closeSync(fd)}};
const bufferSHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const data=p=>JSON.parse(fs.readFileSync(p,'utf8'));const exists=fs.existsSync;
const marks={},bad=[];const check=(name,ok)=>{marks[name]=!!ok;if(!ok)bad.push(name)};
check('canonicalV15Frozen',f.status==='V18_CANONICAL_FROZEN_NOT_BUILT'&&f.version==='0.2.1-rc.5.20261116.18');
check('officialUnsignedInstaller',exists(exe)&&fs.statSync(exe).size>500e6);
check('officialDpiIdentityMain',sha(path.join(app,'lib/main.js'))===f.currentDesktopMain);
const m=data(path.join(seed,'package.json')),lock=fs.readFileSync(path.join(seed,'pnpm-lock.yaml'),'utf8');
const packed=path.join(res,'yenra-profile-seed');
check('42OriginalBundles',m.dsh.profile.bundles.length===42&&new Set(m.dsh.profile.bundles).size===42);
check('32OnlyDependencies',Object.keys(m.dependencies).length===32);
check('oneOriginalMemoryProvider',(fs.readFileSync(path.join(seed,'cordis.patch.yml'),'utf8').match(/id:\s*yenra-native-memory-provider/g)||[]).length===1);
check('packageManifestPackedExact',exists(path.join(packed,'package.json'))&&sha(path.join(packed,'package.json'))===sha(path.join(seed,'package.json')));
check('packageLockPackedExact',exists(path.join(packed,'pnpm-lock.yaml'))&&sha(path.join(packed,'pnpm-lock.yaml'))===sha(path.join(seed,'pnpm-lock.yaml')));
check('noOwnerPersonalWorkspaceHardLink',!lock.includes('YENRA-Workspace'));
let archiveCount=0;
for(const [name,ref] of Object.entries(m.dependencies)){
 if(!ref.startsWith('file:./packages/'))continue;
 archiveCount++;
 const file=ref.slice('file:./packages/'.length),a=path.join(seed,'packages',file),b=path.join(packed,'packages',file);
 check('archive:'+name,exists(a)&&exists(b)&&sha(a)===sha(b));
 if(exists(a))check('integrity:'+name,lock.includes('sha512-'+crypto.createHash('sha512').update(fs.readFileSync(a)).digest('base64')));
}
check('thirteenOriginalPluginArchives',archiveCount===13);
const archive=name=>path.join(seed,'packages',m.dependencies[name].slice('file:./packages/'.length));
const unpack=(tar,name)=>execFileSync('tar',['-xOzf',tar,'package/'+name],{maxBuffer:25e6,timeout:25000});
const ui=archive('@yenra/desktop-ui-candidate');
check('formalLatestUiTar',sha(ui)===f.uiArchiveSha&&m.dependencies['@yenra/desktop-ui-candidate'].includes('20261116.18.tgz'));
check('latestNativeReplyAndPersonalClient',bufferSHA(unpack(ui,'lib/client.js'))===f.sourceUI);
check('latestNativeTranslationHost',bufferSHA(unpack(ui,'lib/index.js'))===f.sourceHost);
check('sourceClientCompilePreserved',sha(path.join(root,'artifacts/YENRA_OWNER_INTEGRATION_20261115/v16-latest-official-source/client.js'))===f.baseCompiledClientSHA256);
check('latestNativeReplyGuide',unpack(ui,'lib/client.js').includes(Buffer.from('THREE_REPLY_DISTINCT_INTENT_GUIDANCE'))&&unpack(ui,'lib/client.js').includes(Buffer.from('loadOlder')));
check('personalReadOnlyChromeHook',unpack(ui,'lib/client.js').includes(Buffer.from('yenra:personal-chrome'))&&unpack(ui,'lib/client.js').includes(Buffer.from('PERSONAL_CONTACT_COMMAND')));
check('singleHostTranslationModel',unpack(ui,'lib/index.js').includes(Buffer.from('DSH_NATIVE_TRANSLATION_BUSY'))&&unpack(ui,'lib/index.js').includes(Buffer.from('shared.push({')));
const personal=archive('@local/yenra-personal-chrome');
check('portablePersonalChromeArchive',sha(personal)===f.personalChrome.sha256);
const pj=JSON.parse(unpack(personal,'package.json').toString());
check('personalOriginalDSHHost',pj.name==='@local/yenra-personal-chrome'&&pj.version==='1.0.1'&&(pj.main==='host-v100.js'||pj.exports?.['.']==='./host-v100.js')&&pj.dsh?.bundle?.patch==='./cordis.patch.yml');
check('PersonalChromeSingleBundle',m.dsh.profile.bundles.filter(x=>x==='@local/yenra-personal-chrome').length===1);
for(const [name,suffix] of [['@guntur-d/dsh-memory','rc5compat.10.tgz'],['@xmanrui/dsh-im','rc5compat.13.tgz'],['@yenra/chatwoot-embed','route.9.tgz'],['@local/yenra-typography-fix','1.0.1.tgz'],['@local/yenra-private-themes','1.1.1.tgz']])
 check('preserved:'+name,m.dependencies[name].endsWith(suffix));
const resourceBridge=path.join(res,'yenra-friend-bridge');
const bm=data(path.join(bridge,'bridge-manifest.json'));
check('bridge53Modules5Support',bm.codeFiles===53&&bm.supportFiles===5&&bm.files.length===58);
check('bridgeOnlyOriginalSender',bm.noSecondSender===true&&bm.noSecondWhatsAppSocket===true);
check('bridgeManifestPackedExact',exists(path.join(resourceBridge,'bridge-manifest.json'))&&sha(path.join(resourceBridge,'bridge-manifest.json'))===f.bridgeManifestSha);
check('all58OriginalBridgeDependenciesPacked',bm.files.every(x=>exists(path.join(resourceBridge,x.file))&&sha(path.join(resourceBridge,x.file))===x.sha256));
check('authorizedNativeHostImport',bm.files.some(x=>x.file==='social-adapters/chatwoot-bridge/src/native-authorized-host-fetch.mjs'));
const up=data(path.join(bridge,'upgrade-release-manifest.json'));
check('single13PluginSafeUpgrader',up.pluginCount===13&&sha(path.join(bridge,'Install-YENRA-Unified-Plugins-20261115.ps1'))===f.v12UpgradeScriptSHA256);
check('upgraderManifestPackedExact',exists(path.join(resourceBridge,'upgrade-release-manifest.json'))&&sha(path.join(resourceBridge,'upgrade-release-manifest.json'))===f.upgradeManifestSHA256);
const kt=path.join(res,'yenra-kt-native'),km=data(path.join(kt,'manifest.json'));
check('original1317KTFiles',km.files.length===1317&&km.files.every(x=>exists(path.join(kt,x.relative))&&sha(path.join(kt,x.relative))===x.sha256));
const grammar=path.join(res,'yenra-offline-grammar'),gm=data(path.join(grammar,'manifest.json'));
check('originalFourGrammarResources',gm.files.length===4&&gm.files.every(x=>exists(path.join(grammar,x.relative))&&sha(path.join(grammar,x.relative))===x.sha256));
try{
 const require=createRequire(import.meta.url);
 const asar=require(createRequire(path.join(app,'package.json')).resolve('@electron/asar'));
 const main=asar.extractFile(path.join(res,'app.asar'),'lib/main.js');
 check('officialAsarMainUnchanged',bufferSHA(main)===f.currentDesktopMain);
 check('officialEarlyIdentityBlock',main.includes(Buffer.from('YENRA_PACKAGED_IDENTITY_GUARD_V1_BLOCKED')));
}catch(e){check('officialAsarMainUnchanged',false);check('officialEarlyIdentityBlock',false)}

const actualUi=unpack(ui,'lib/client.js').toString('utf8');
check('v14NewDefaultCloudIdleUi',f.latestIdleCloudCaptainHidden===true&&f.latestBrainIdlePrompt===true&&f.latestHeaderBorder===true);
check('v14PersonalChromeInjectReversible',f.personalHooksReversible===true);
check('v14NewClientCompiledSourceExists',fs.existsSync(path.join(root,'artifacts/YENRA_OWNER_INTEGRATION_20261115/v16-latest-official-source/client.js'))&&bufferSHA(fs.readFileSync(path.join(root,'artifacts/YENRA_OWNER_INTEGRATION_20261115/v16-latest-official-source/client.js')))===f.baseCompiledClientSHA256);
check('v14NoCaptainTrayOnUnselectedContact',actualUi.includes('.conversation-details-wrap:has(img[alt=No')&&actualUi.includes('.fixed.bottom-20.end-4.z-50')&&actualUi.includes('max-w-xs{display:none!important}'));
check('v14BrainEmptyStateText',actualUi.includes('请选择联系人'));
check('v14NoRegressionNaturalReplies',actualUi.includes('THREE_REPLY_DISTINCT_INTENT_GUIDANCE'));
const mem=archive('@guntur-d/dsh-memory');
check('v14MemoryRc9PatchExact',bufferSHA(unpack(mem,'lib/index.js'))===f.memoryClientSha&&f.memoryOfficialRc9PatchExactlyReversible===true);
check('v14LatestBridgeP0Sources',f.latestBridgeSourcesSameAsOfficial===true&&f.bridgeLatestP0Fixes.length===5);
check('v14NewReplyMemoryLight',f.latestUiCanvas2d&&f.latestChatLumeCacheOnlyTranslation&&f.latestNativeSingleFlight&&actualUi.includes('BrainLightHalo')&&actualUi.includes('restoreSavedTranslationsForChatLume'));
check('v14ClientNativeSingleFlightHost',unpack(ui,'lib/index.js').includes(Buffer.from('yenra-memory-adopt')));
check('v15TransportMIDPending',f.latestTransportSubmittedMIDPending===true&&f.latestP0RealSenderNoSecondSocket===true);
check('v15PremiumDraggableBrainCanvas',f.latestGraphiteBrainDrag===true&&actualUi.includes('DraggableBrainLauncher')&&actualUi.includes('BrainLightHalo'));
check('v16QuoteAndPreviewAndTheme',f.latestP0QuotedReply&&f.latestP0CloudCachedPreview&&f.latestP1ThemeAdaptiveBrain&&f.latestPersonalChromeV101&&actualUi.includes('visibleMissing'));
check('v16RealEmbedRoute9',sha(archive('@yenra/chatwoot-embed'))===f.embedArchiveSHA256);
check('v18NativeContactToggleOneOriginalButton',actualUi.includes('i-lucide-arrow-right-to-line')&&actualUi.includes('i-lucide-arrow-left-to-line')&&actualUi.includes('conversations-list-wrap.hidden'));
check('v18NativeCaptionDragTitlebar',actualUi.includes('v2-caption-drag-zone'));
check('v18KTProvenCountryV2',actualUi.includes('yenra:kt:confirmed-country:v2:'));
check('v18RealPlatformReadOriginalSocket',actualUi.includes('/api/yenra/social-native-read')&&actualUi.includes('WA_READ_SELF_ONLY')&&unpack(ui,'lib/index.js').includes(Buffer.from('markVerifiedWhatsAppRead')));
check('v18NoDuplicateCordisWorkbench',!unpack(ui,'cordis.patch.yml').toString().includes('- insert:')&&unpack(ui,'cordis.patch.yml').toString().includes('- id: yenra-desktop-candidate'));
check('v18ReadTargetHostSocketIM13',f.latestP0FacebookAndWhatsAppNativeRead===true&&sha(archive('@xmanrui/dsh-im'))===f.imArchiveSha);
const result={status:bad.length?'V18_NSIS_RELEASE_BLOCKED':'V18_NSIS_VERIFIED_NOT_INSTALLED',
 at:new Date().toISOString(),version:f.version,pass:Object.values(marks).filter(Boolean).length,
 total:Object.keys(marks).length,failed:bad,checks:marks,
 exeBytes:exists(exe)?fs.statSync(exe).size:0,exeSha256:exists(exe)?sha(exe):null,
 signed:false,ownerInstalled:false,friendInstalled:false,noRealMessagesSent:true};
fs.writeFileSync(path.join(work,'v18-release-integrity.json'),JSON.stringify(result,null,2)+'\n');
console.log('YENRA_V18_NSIS_INDEPENDENT_INTEGRITY '+JSON.stringify({status:result.status,pass:result.pass,total:result.total,failed:bad,bytes:result.exeBytes,sha256:result.exeSha256}));
if(bad.length)process.exitCode=12;
