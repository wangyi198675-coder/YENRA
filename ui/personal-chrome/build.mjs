import fs from'node:fs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
for(const name of ['client-v100.js','client-v101.js'])fs.writeFileSync(new URL(name,import.meta.url),read('client-entry.js').replace('/*__CAPTION_CSS__*/',JSON.stringify(read('caption.css'))));
console.log('Built caption bridge with original icon and English/Chinese display resources.');
