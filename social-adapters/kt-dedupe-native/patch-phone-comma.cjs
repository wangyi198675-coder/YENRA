const fs=require('node:fs');
const p=process.argv[2];
let s=fs.readFileSync(p,'utf8');
const start=s.indexOf('  const candidateText=text.replace(');
if(start<0)throw Error('CANDIDATE_NORMALIZATION_NOT_FOUND');
const stop=s.indexOf('  const matches=[];',start);
if(stop<start)throw Error('PATCH_BOUNDARY_NOT_FOUND');
const newBlock=String.raw`  const candidateText=text.replace(
    /((?:\+|00)?[1-9]\d{0,2})[,，](?=\s*\d[\d\s().-]{7,28}\d)/gu,
    '$1 ');
`;
s=s.slice(0,start)+newBlock+s.slice(stop);
const idx=s.indexOf('export function extractManualKtPhoneNumbers');
const tail=s.slice(idx);
if(!tail.includes('for(const match of text.matchAll('))throw Error('MATCH_ITERATOR_NOT_FOUND');
s=s.slice(0,idx)+tail.replace('for(const match of text.matchAll(','for(const match of candidateText.matchAll(');
fs.writeFileSync(p,s);
console.log('NORMALIZATION_PATCH_APPLIED');