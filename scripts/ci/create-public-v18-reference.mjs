import fs from 'node:fs';
import path from 'node:path';
const sourceRoot=process.argv[2] && path.resolve(process.argv[2]);
const publicRoot=process.argv[3] && path.resolve(process.argv[3]);
if(!sourceRoot||!publicRoot||sourceRoot===publicRoot)throw Error('separate owner and review roots required');
const outDir=path.join(publicRoot,'scripts/release-reference');
fs.mkdirSync(outDir,{recursive:true});
// This source-only exporter has no ability to run, sign, install or replace v18.
const localHome=['C:','Users','1','Documents','YENRA'].join('/');
const filenames=[
 'Build-YENRA-P0-OfficialNSIS-v18-OwnerOnly-20261116.mjs',
 'Verify-YENRA-P0-v18-NSIS-20261116.mjs'
];
for(const name of filenames){
 const src=fs.readFileSync(path.join(sourceRoot,'scripts',name),'utf8');
 if(!src.includes("const root='"+localHome+"'"))throw Error('Unexpected v18 builder preimage: '+name);
 let safe=src.replace("const root='"+localHome+"'", "const root=(process.env.YENRA_SOURCE_ROOT ?? path.resolve(import.meta.dirname,'../..'))");
 const directAsar="require('"+localHome+"/upstream/official-source/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar')";
 safe=safe.replace(directAsar,"require(createRequire(path.join(app,'package.json')).resolve('@electron/asar'))");
 safe=safe.replace('link:'+localHome+'-Workspace','YENRA-Workspace');
 safe=safe.replace(/yenra:kt:confirmed-country:v2:\d+:/g,'yenra:kt:confirmed-country:v2:');
 if(safe.includes(localHome)||safe.includes('196799'))throw Error('owner-specific values remain: '+name);
 const guard="// PUBLIC SOURCE REFERENCE ONLY: frozen offline inputs are not in GitHub; do not\n// run an owner v18 NSIS build or verification without explicit unified release approval.\nif(process.env.YENRA_ALLOW_ARCHIVAL_V18_SCRIPT!=='YES') throw Error('YEN-15_UNRELEASED_REFERENCE_ONLY');\n";
 fs.writeFileSync(path.join(outDir,name),guard+safe,'utf8');
}
console.log(JSON.stringify({exported:filenames.length,directory:'scripts/release-reference',safeByDefault:true},null,2));
