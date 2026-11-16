import test from 'node:test';
import assert from 'node:assert/strict';
import {getCountries,getExampleNumber,getCountryCallingCode,parsePhoneNumberFromString} from 'libphonenumber-js/max';
import examples from 'libphonenumber-js/mobile/examples';
import {europeanCountryCodes,europeGroups} from './qa-europe-all-country-matrix.mjs';
import {extractManualKtPhoneNumbers as extract} from './kt-phone-normalize.mjs';
import {resolveKtCountryInput as resolve} from './kt-country-input.mjs';
// Europe UN M49 subregions + Kosovo and wider cross-regional European
// communications: CY AM AZ GE TR KZ. This is TEST coverage only,
// never a runtime allowlist. Mature phone metadata supports ~245 regions.
test('all four UN Europe regions + cross-regional coverage included',()=>{
 assert.equal(europeanCountryCodes.length,58);
 assert.deepEqual(Object.keys(europeGroups).sort(),
  ['north','south','west','east','extended'].sort());
 assert.equal(new Set(europeanCountryCodes).size,58);
});
for(const iso2 of europeanCountryCodes){
 test('Europe '+iso2+': calling code, ISO2, E164, 00, local and bare +digits',()=>{
   assert.ok(getCountries().includes(iso2),'lib metadata must include '+iso2);
   const sample=getExampleNumber(iso2,examples);
   assert.ok(sample?.isValid(),'mobile fixture must be valid');
   const e164=sample.number,national=sample.nationalNumber;
   const prefix=getCountryCallingCode(iso2);
   const evidence={verified:true,source:'USER_CONFIRMED_CONTEXT',iso2};
   assert.equal(resolve(iso2).iso2,iso2);
   for(const input of [e164,'00'+e164.slice(1),national,e164.slice(1)]){
     const r=extract(input,{countryEvidence:evidence});
     assert.ok(r.some(x=>x.number===e164),
       iso2+' must normalize input variant in mature library');
   }
   if(national.length<9){
     assert.deepEqual(extract(national),[],'short local without country must not guess '+iso2);
   }
 });
 test('Europe '+iso2+': shared calling code uses full canonical number',()=>{
   const example=getExampleNumber(iso2,examples);
   const expected=parsePhoneNumberFromString(example.number)?.country;
   const actual=resolve(getCountryCallingCode(iso2),{phoneText:example.nationalNumber});
   assert.equal(actual.ok,true,'Full valid number must resolve or remain safe');
   assert.equal(actual.iso2,expected,'Do not trust temporary candidate ISO on shared prefix');
 });
}
test('no 6-digit local guessed without verified country, and invalid plan rejected',()=>{
 assert.deepEqual(extract('211234'),[]);
 const evidence={verified:true,source:'USER_CONFIRMED_CONTEXT',iso2:'FO'};
 assert.equal(extract('211234',{countryEvidence:evidence})[0]?.number,'+298211234');
 assert.deepEqual(extract('111111',{countryEvidence:evidence}),[]);
});
