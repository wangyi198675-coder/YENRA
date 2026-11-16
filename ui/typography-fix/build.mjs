import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const client=read('client-entry.js').replace('/*__TYPOGRAPHY__*/',read('typography.js').replace(/^export /gm,''));
// Keep old entry URLs current for a running Host's package-resolution cache.
for(const name of ['client-v100.js','client-v101.js'])fs.writeFileSync(new URL(name,import.meta.url),client);
for(const name of ['host-v100.js','host-v101.js'])fs.writeFileSync(new URL(name,import.meta.url),read('index.js'));
console.log('Built versioned typography bridge and compatible entry aliases.');
