import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const pure=name=>read(name).replace(/^export /gm,'');
const client=read('client-entry.js').replace('/*__CORE__*/',pure('core.js')).replace('/*__APPEARANCE__*/',pure('appearance.js'));
for(const name of ['client.js','client-v111.js'])fs.writeFileSync(new URL(name,import.meta.url),client);
fs.writeFileSync(new URL('core-v111.js',import.meta.url),read('core.js'));
fs.writeFileSync(new URL('store-v111.js',import.meta.url),read('store.js').replace("'./core.js'","'./core-v111.js'"));
fs.writeFileSync(new URL('host-v111.js',import.meta.url),read('index.js').replace("'./core.js'","'./core-v111.js'").replace("'./store.js'","'./store-v111.js'"));
console.log('Built v1.1.1 versioned Host/Client entry points.');
