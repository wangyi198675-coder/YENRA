// YEN-11 isolated Cloud UI compile. Never overwrites the v18 installed app or shared lib/.
import {defineConfig} from 'tsdown'
import {readFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
const inlineCss={
 name:'yen-11-inline-css',
 resolveId(id,importer){
  if(!id.endsWith('.css?inline')||!importer)return null
  return resolve(dirname(importer),id.slice(0,-7))+'?inline'
 },
 load(id){
  if(!id.endsWith('.css?inline'))return null
  return 'export default '+JSON.stringify(readFileSync(id.slice(0,-7),'utf8'))
 },
}
export default defineConfig({
 entry:['src/client/cloud-native-inbox.tsx'],
 outDir:resolve(import.meta.dirname,'../../runtime/yen-11-isolated-compile-20261116'),
 platform:'browser',format:['esm'],dts:false,sourcemap:false,clean:false,
 external:['react','react/jsx-runtime'],
 plugins:[inlineCss],
})
