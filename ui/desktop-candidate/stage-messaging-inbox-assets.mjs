/** Copy mature OSS built artifacts alongside the existing DSH plugin build.
 * This is packaging, not a second frontend or an extra release gate.
 * A packaged YENRA must not depend on C:/Users/1 source checkout paths.
 */
import {mkdir,copyFile,readFile,stat,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const source=resolve(root,'../../social-adapters/oss-candidates/messaging-inbox/dist');
const target=join(root,'lib','oss');
await mkdir(target,{recursive:true});
for(const name of ['messaging-inbox.umd.js','messaging-inbox.css','notification.wav']){
  const path=join(source,name);
  const info=await stat(path);
  if(info.size<1000)throw Error('MATURE_OSS_ASSET_MISSING_OR_EMPTY: '+name);
  await copyFile(path,join(target,name));
  const copied=await stat(join(target,name));
  if(copied.size!==info.size)throw Error('MATURE_OSS_ASSET_COPY_INCOMPLETE: '+name);
  process.stdout.write('[YENRA original DSH] packaged mature OSS '+name+': '+copied.size+' bytes\n');
}

/** Stage the EXISTING Pancake Page SDK code-only files. No DPAPI credentials,
 * W25 history, private owner paths, secondary Sender or new login service.
 * Every staged byte must match the mature original adapter in compat/.
 */
const pageSource=resolve(root,'../../social-adapters/compat/pancake-page-original-sdk');
const pageManifest=JSON.parse(await readFile(join(pageSource,'package.json'),'utf8'));
if(pageManifest.name!=='@yance/v2-pancake-page'||
  pageManifest.version!=='0.1.50-dsh-page-root-oss-queue.1')
  throw Error('ORIGINAL_PANCAKE_SDK_VERSION_UNVERIFIED');
const pageTarget=join(root,'lib','pancake-sdk');
const pageAssets=[
  'package.json','lib/account-store.js','lib/native-page-inbox.mjs',
  'lib/native-page-manual-send.mjs','lib/native-page-media-send.mjs',
  'lib/native-page-mark-read.mjs','lib/page-realtime.mjs',
  'scripts/pancake-accounts-v2.ps1',
];
for(const name of pageAssets){
  const sourcePath=join(pageSource,name),targetPath=join(pageTarget,name);
  const bytes=await readFile(sourcePath);
  if(bytes.byteLength<100)throw Error('ORIGINAL_PANCAKE_SDK_ASSET_MISSING: '+name);
  if(bytes.includes(Buffer.from('C:/Users/1/'))||
     bytes.includes(Buffer.from('C:\\Users\\1\\')))
    throw Error('OWNER_PATH_INSIDE_PORTABLE_PAGE_SDK: '+name);
  await mkdir(dirname(targetPath),{recursive:true});
  await copyFile(sourcePath,targetPath);
  if((await stat(targetPath)).size!==bytes.byteLength)
    throw Error('ORIGINAL_PANCAKE_SDK_ASSET_COPY_INCOMPLETE: '+name);
}
process.stdout.write('[YENRA original DSH] staged mature Page SDK code: '+pageAssets.length+' files\n');

/** Stage original mautrix-meta/Matrix read adapter ONLY, with its current-user
 * DPAPI reader. Never package a sealed session, Matrix token, room database,
 * homeserver or second Facebook protocol. Local Matrix setup remains separate.
 */
const matrixSource=resolve(root,'../../social-adapters/compat/mautrix-meta-w56-original-reader');
const matrixTarget=join(root,'lib','personal-matrix');
const matrixAssets=[
  'official-matrix-inbox.mjs','native-matrix-session.mjs',
  'provisioning-auth.mjs','read-protected-matrix-session.ps1',
];
for(const name of matrixAssets){
  const sourcePath=join(matrixSource,name),targetPath=join(matrixTarget,name);
  const bytes=await readFile(sourcePath);
  if(bytes.length<100)throw Error('ORIGINAL_MATRIX_READER_MISSING: '+name);
  if(bytes.includes(Buffer.from('C:/Users/1/'))||
     bytes.includes(Buffer.from('C:\\Users\\1\\')))
    throw Error('OWNER_PATH_INSIDE_ORIGINAL_MATRIX_READER: '+name);
  await mkdir(dirname(targetPath),{recursive:true});
  await copyFile(sourcePath,targetPath);
  if((await stat(targetPath)).size!==bytes.length)
    throw Error('ORIGINAL_MATRIX_READER_COPY_INCOMPLETE: '+name);
}
process.stdout.write('[YENRA original DSH] staged original Matrix reader: '+matrixAssets.length+' code files\n');

/** Strip developer checkout paths embedded ONLY in rolldown's generated
 * //#region metadata. This does not alter JS code, its length, source-map
 * offsets, official SDK bytes, W25, account credentials, or Sender behavior.
 */
for(const entry of await readdir(join(root,'lib'),{withFileTypes:true})){
  if(!entry.isFile()||!entry.name.endsWith('.js'))continue;
  const file=join(root,'lib',entry.name);
  const original=await readFile(file,'utf8');
  const portable=original.replace(/(\/\/#region )([^\r\n]+)/g,(match,prefix,source)=>{
    if(!/c:\\users\\1\\|c:\/users\/1\/|yancev2[\\/]harnessnativewindows/i.test(source))
      return match;
    // Keep the original byte/column length (one ASCII source marker).
    return prefix+'original-mature-module'.padEnd(source.length,' ');
  });
  if(portable!==original)await writeFile(file,portable,'utf8');
  if(/c:\\users\\1\\|c:\/users\/1\//i.test(portable))
    throw Error('OWNER_MACHINE_ABSOLUTE_PATH_IN_COMPILED_PLUGIN: '+entry.name);
}
process.stdout.write('[YENRA original DSH] portable compiler source-path metadata sanitized\n');
