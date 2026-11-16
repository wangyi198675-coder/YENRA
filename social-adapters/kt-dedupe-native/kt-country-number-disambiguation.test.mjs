import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveKtCountryInput as resolve} from './kt-country-input.mjs';
const msg='392 0180322';
for(const code of ['39','+39','0039']){
 test('calling code '+code+' + validated full original number yields IT',()=>{
  assert.deepEqual(resolve(code,{phoneText:msg}),
   {ok:true,iso2:'IT',kind:'calling-code-disambiguated-by-number'});
 });
}
test('calling code alone remains ambiguous',()=>{
 assert.deepEqual(resolve('39'),{ok:false,error:'AMBIGUOUS_NUMBER_COUNTRY'});
});
test('shared calling code in irrelevant prose stays ambiguous',()=>{
 assert.deepEqual(resolve('39',{phoneText:'Ciao come stai'}),{ok:false,error:'AMBIGUOUS_NUMBER_COUNTRY'});
});
test('incomplete number stays ambiguous',()=>{
 assert.equal(resolve('39',{phoneText:'392 0180'}).error,'AMBIGUOUS_NUMBER_COUNTRY');
});
test('full explicit international phone is recognized without country prompt',()=>{
 assert.equal(resolve('39',{phoneText:'+39 3920180322'}).iso2,'IT');
});
