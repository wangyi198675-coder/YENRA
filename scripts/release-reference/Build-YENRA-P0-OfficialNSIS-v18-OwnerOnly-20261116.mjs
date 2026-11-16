// PUBLIC SOURCE REFERENCE ONLY: frozen offline inputs are not in GitHub; do not
// run an owner v18 NSIS build or verification without explicit unified release approval.
if(process.env.YENRA_ALLOW_ARCHIVAL_V18_SCRIPT!=='YES') throw Error('YEN-15_UNRELEASED_REFERENCE_ONLY');
// ONE official DSH/Electron/Chatwoot YENRA v18 OWNER-only installer; friend untouched.
// Fail closed before build if even one formal source or manifest byte changed.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=(process.env.YENRA_SOURCE_ROOT ?? path.resolve(import.meta.dirname,'../..'));
const dir=path.join(root,'artifacts/YENRA_DUAL_MACHINE_UNIFICATION_20261114/unified-release-candidate-20261116-18');
const app=path.join(root,'upstream/official-source/apps/desktop');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const data=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const need=(ok,name)=>{if(!ok)throw Error('YENRA_V18_NSIS_BLOCK_'+name)};
const f=data(path.join(dir,'release-v18-freeze.json')),seed=path.join(dir,'seed'),bridge=path.join(dir,'bridge'),m=data(path.join(seed,'package.json'));
need(f.status==='V18_CANONICAL_FROZEN_NOT_BUILT'&&f.version==='0.2.1-rc.5.20261116.18','FREEZE_NOT_AUTHORIZED');
need(m.dsh.profile.bundles.length===42&&new Set(m.dsh.profile.bundles).size===42&&Object.keys(m.dependencies).length===32,'PROFILE_42_32');
need(m.dsh.profile.bundles.includes('@local/yenra-personal-chrome'),'PERSONAL_CHROME_NOT_ENABLED');
need(sha(path.join(app,'lib/main.js'))===f.currentDesktopMain,'EARLY_IDENTITY_GUARD_DRIFT');
const pin=(id,expected)=>{
 const link=m.dependencies[id];need(link?.startsWith('file:./packages/'),'MISSING_PIN_'+id);
 const name=link.slice('file:./packages/'.length),file=path.join(seed,'packages',name);
 need(name===expected&&fs.existsSync(file),'ARCHIVE_NAME_'+id);return file;
};
const ui=pin('@yenra/desktop-ui-candidate','yenra-desktop-ui-candidate-0.1.0-yenra.unified.20261116.18.tgz');
const chrome=pin('@local/yenra-personal-chrome','local-yenra-personal-chrome-1.0.1.tgz');
need(sha(ui)===f.uiArchiveSha&&sha(chrome)===f.personalChrome?.sha256,'UI_AND_PERSONAL_TAR_HASH');
need(sha(pin('@yenra/chatwoot-embed','yenra-chatwoot-embed-0.3.0-route.9.tgz'))===f.embedArchiveSHA256,'EMBED_ROUTE9_PIN');
need(f.latestP0QuotedReply&&f.latestP0CloudCachedPreview&&f.latestP1ThemeAdaptiveBrain&&f.latestPersonalChromeV101,'LATEST_HANDOFFS_MISSING');
need(f.latestP0FacebookAndWhatsAppNativeRead&&f.latestP1NativeContactCollapse&&f.latestP1WindowsCaptionDrag&&f.latestKTVerifiableCountryV2,'V18_HANDOFFS_NOT_FROZEN');
const unpack=(tar,file)=>execFileSync('tar',['-xOzf',tar,'package/'+file],{maxBuffer:30e6,timeout:30000});
const latestClient=unpack(ui,'lib/client.js').toString('utf8');
const latestHost=unpack(ui,'lib/index.js').toString('utf8');
for(const mark of ['PERSONAL_CONTACT_COMMAND','v2-caption-drag-zone','i-lucide-arrow-right-to-line','i-lucide-arrow-left-to-line','conversations-list-wrap.hidden','yenra:kt:confirmed-country:v2:','findVerifiedHistoricalMessages','DraggableBrainLauncher','BrainLightHalo','THREE_REPLY_DISTINCT_INTENT_GUIDANCE','/api/yenra/social-native-read','WA_READ_SELF_ONLY'])need(latestClient.includes(mark),'NATIVE_CLIENT_REGRESSION_'+mark);
for(const mark of ['createNativeMemoryAdoptSingleFlight','translateCloudBatchIsolated','registerOriginalWhatsAppPresenceSubscription','markVerifiedPageSeen','markVerifiedPersonalRead','markVerifiedWhatsAppRead','/api/yenra/social-native-read'])need(latestHost.includes(mark),'NATIVE_HOST_REGRESSION_'+mark);
need(unpack(ui,'cordis.patch.yml').toString('utf8').includes('- id: yenra-desktop-candidate')&&!unpack(ui,'cordis.patch.yml').toString('utf8').includes('- insert:'),'SECOND_DESKTOP_PROHIBITED');
need(sha(pin('@local/yenra-private-themes',f.theme.archive))===f.theme.sha256,'THEME_PIN');
need(sha(pin('@local/yenra-typography-fix',f.typoArchive))===f.typoArchiveSha256,'TYPOGRAPHY_PIN');
need(sha(pin('@guntur-d/dsh-memory','guntur-d-dsh-memory-0.1.0-yenra.rc5compat.10.tgz'))===f.memoryArchiveSha,'MEMORY_PIN');
need(sha(pin('@xmanrui/dsh-im','xmanrui-dsh-im-5.10.0-yenra.rc5compat.13.tgz'))===f.imArchiveSha,'IM_PIN');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
need(digest(unpack(ui,'lib/index.js'))===f.sourceHost,'HOST_TRANSLATION_NOT_PACKED');
need(digest(unpack(ui,'lib/client.js'))===f.sourceUI,'NATIVE_PAGED_REPLIES_NOT_PACKED');
const bm=data(path.join(bridge,'bridge-manifest.json'));
need(bm.files.length===58&&bm.codeFiles===53&&bm.supportFiles===5&&bm.noSecondSender&&bm.noSecondWhatsAppSocket,'BRIDGE_DEPENDENCY_SCOPE');
need(sha(path.join(bridge,'bridge-manifest.json'))===f.bridgeManifestSha,'BRIDGE_MANIFEST_FROZEN_SHA');
for(const x of bm.files){
 const file=path.join(bridge,x.file);need(fs.existsSync(file)&&fs.statSync(file).size===x.bytes&&sha(file)===x.sha256,'BRIDGE_MISSING_OR_STALE_'+x.file);
 const formal=path.join(root,x.file);need(fs.existsSync(formal)&&sha(formal)===x.sha256,'FORMAL_BRIDGE_CHANGED_'+x.file);
}
const update=data(path.join(bridge,'upgrade-release-manifest.json'));
need(update.pluginCount===13&&sha(path.join(bridge,'upgrade-release-manifest.json'))===f.upgradeManifestSHA256,'UPGRADER_MANIFEST');
need(sha(path.join(bridge,'Install-YENRA-Unified-Plugins-20261115.ps1'))===f.v12UpgradeScriptSHA256,'UPGRADER_SCRIPT');
for(const x of update.files)need(sha(path.join(bridge,x.name))===x.sha256,'UPGRADER_OTHER_RESOURCE_'+x.name);
const lock=fs.readFileSync(path.join(seed,'pnpm-lock.yaml'),'utf8');
let count=0;
for(const link of Object.values(m.dependencies)){
 if(!link.startsWith('file:./packages/'))continue;
 const file=path.join(seed,'packages',link.slice('file:./packages/'.length));
 need(fs.existsSync(file),'MISSING_OFFLINE_ARCHIVE');
 const integrity='sha512-'+crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
 need(lock.includes(integrity),'LOCKFILE_ARCHIVE_INTEGRITY');
 count++;
}
need(count===13,'PINNED_PLUGIN_COUNT_NOT_13');
const kt=data(path.join(f.originalKT,'manifest.json'));
need(kt.files.length===1317&&kt.files.every(x=>sha(path.join(f.originalKT,x.relative))===x.sha256),'ORIGINAL_KT_CHANGED');
for(const [rel,h] of Object.entries(f.latestFormalSourceSHA256)){
  need(sha(path.join(root,rel))===h,'LATEST_SOURCE_CHANGED_AFTER_FREEZE_'+rel);
}
need(f.bridgeLatestP0Fixes.length===5&&f.latestCloudUnknownNoRetry===true,'NEW_ACK_FIXES_MISSING');
need(digest(unpack(pin('@guntur-d/dsh-memory','guntur-d-dsh-memory-0.1.0-yenra.rc5compat.10.tgz'),'lib/index.js'))===f.memoryClientSha,'MEMORY_RC9_PATCH_MISSING');
need(f.latestTransportSubmittedMIDPending===true&&f.latestGraphiteBrainDrag===true,'P0_AND_UI_HANDOFF_MISSING');
const exe=path.join(app,'.desktop-build/targets/win-x64/unsigned-artifacts/YENRA-0.2.1-rc.5.20261116.18-win-x64-BETA-unsigned.exe');
need(!fs.existsSync(exe),'IMMUTABLE_OUTPUT_ALREADY_EXISTS');
const {loadDesktopPackageEnvironment}=await import(pathToFileURL(path.join(app,'scripts/desktop-package-environment.mjs')).href);
const loaded=loadDesktopPackageEnvironment('win32',process.env,app,{unsigned:true});
const env=Object.fromEntries(Object.entries(loaded).filter(([k])=>!k.startsWith('DSH_DESKTOP_WINDOWS_')&&!/^(?:(?:WIN_)?CSC_|APPLE_)/i.test(k)));
Object.assign(env,{
 DSH_DESKTOP_UNSIGNED:'1',CSC_IDENTITY_AUTO_DISCOVERY:'false',
 DSH_DESKTOP_TARGET_PLATFORM:'win32',DSH_DESKTOP_TARGET_ARCH:'x64',
 DSH_DESKTOP_BUILD_VERSION:f.version,
 DSH_DESKTOP_YENRA_PROFILE_SEED_DIR:seed,
 DSH_DESKTOP_YENRA_FRIEND_BRIDGE_DIR:bridge,
 DSH_DESKTOP_YENRA_OFFLINE_GRAMMAR_DIR:f.originalGrammar,
 DSH_DESKTOP_YENRA_KT_NATIVE_DIR:f.originalKT,ELECTRON_BUILDER_7Z_FILTER:'BCJ'
});
console.log('YENRA_V18_ONE_OFFICIAL_NSIS_BUILD_STARTED_42_32_53_BRIDGE_5_SCRIPTS');
const proc=spawn('cmd.exe',['/d','/s','/c','pnpm exec electron-builder --config electron-builder.config.mjs --win --x64 --publish never'],{cwd:app,env,stdio:'inherit',windowsHide:true});
const done=await new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',(code,signal)=>resolve({code,signal}))});
need(done.code===0,'OFFICIAL_ELECTRON_BUILDER_FAILED_'+JSON.stringify(done));
need(fs.existsSync(exe)&&fs.statSync(exe).size>500e6,'OFFICIAL_NSIS_NOT_BUILT');
console.log('YENRA_V18_ONE_OFFICIAL_UNSIGNED_NSIS_BUILT_NOT_INSTALLED '+JSON.stringify({exe,bytes:fs.statSync(exe).size}));
