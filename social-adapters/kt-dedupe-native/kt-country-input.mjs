// Resolve user-confirmed country input for KT manual message lookup.
// Accept ISO 3166-1 alpha-2 or international calling code; never guess
// a region when multiple countries share the same calling code.
import {getCountries,getCountryCallingCode,isSupportedCountry,parsePhoneNumberFromString} from 'libphonenumber-js/max';
import {extractManualKtPhoneNumbers} from './kt-phone-normalize.mjs';
const calling=new Map();
for(const iso2 of getCountries()){
 const prefix=getCountryCallingCode(iso2);
 if(!calling.has(prefix))calling.set(prefix,[]);
 calling.get(prefix).push(iso2);
}
export function resolveKtCountryInput(value,{phoneText}={}){
 const text=typeof value==='string'?value.trim().toUpperCase().replace(/\\s+/g,''):'';
 if(/^[A-Z]{2}$/.test(text)){
  return isSupportedCountry(text)?{ok:true,iso2:text,kind:'iso2'}:
   {ok:false,error:'UNSUPPORTED_NUMBER_COUNTRY'};
 }
 const prefixed=text.startsWith('00')?text.slice(2):text.startsWith('+')?text.slice(1):text;
 if(!/^[1-9][0-9]{0,2}$/.test(prefixed)){
  return {ok:false,error:'UNSUPPORTED_NUMBER_COUNTRY'};
 }
 const matches=calling.get(prefixed)||[];
 if(matches.length===1)return {ok:true,iso2:matches[0],kind:'calling-code'};
 if(matches.length>1){
  // A shared calling code is not necessarily ambiguous when the original
  // message contains a full valid phone number. Use the existing native
  // phone validator, not a new country-guessing heuristic.
  if(typeof phoneText==='string'&&phoneText.length<=16000){
   const valid=matches.filter(iso2=>
     extractManualKtPhoneNumbers(phoneText,{
       countryEvidence:{iso2,verified:true,source:'USER_CONFIRMED_CONTEXT'}
     }).some(n=>{
       const parsed=parsePhoneNumberFromString(n.number);
       return parsed?.isValid()===true&&parsed.country===iso2;
     }));
   if(valid.length===1)return {
     ok:true,iso2:valid[0],kind:'calling-code-disambiguated-by-number'
   };
  }
  return {ok:false,error:'AMBIGUOUS_NUMBER_COUNTRY'};
 }
 return {ok:false,error:'UNSUPPORTED_NUMBER_COUNTRY'};
}
