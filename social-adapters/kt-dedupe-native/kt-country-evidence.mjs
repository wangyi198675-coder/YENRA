// Country resolution for KT phone conversion, never a dedupe verdict.
// Supports all libphonenumber-js regions when the contact's country evidence is verified.
// The optional textual matcher uses ONLY direct self-reported country declarations in
// verified INBOUND history, never language, nickname, timezone, IP, or guessing.
import {getCountries,isSupportedCountry} from 'libphonenumber-js/max';

const aliases=new Map();
function key(value){return String(value).normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();}
function record(name,iso2){
 const k=key(name);
 if((k.length<3 && !/[\p{Script=Han}\p{Script=Hangul}]/u.test(k) && !['uk','us'].includes(k))||!isSupportedCountry(iso2))return;
 if(!aliases.has(k))aliases.set(k,iso2);
 else if(aliases.get(k)!==iso2)aliases.set(k,null); // ambiguous -> never guess
}
const countries=getCountries();
for(const locale of ['en','de','fr','es','zh','ko','ja','tr','pl']){
 const names=new Intl.DisplayNames([locale],{type:'region'});
 for(const iso2 of countries){
  const name=names.of(iso2);
  if(name&&name!==iso2)record(name,iso2);
 }
}
for(const [iso2,names] of Object.entries({
 DE:['deutschland','germany','德国'],KH:['cambodia','kambodscha','柬埔寨'],
 KR:['south korea','südkorea','韩国','대한민국','한국'],
 GB:['united kingdom','the uk','uk','great britain','英国','vereinigten königreich'],
 US:['united states','the united states','usa','the usa','美国','vereinigten staaten'],
 FR:['france','frankreich','法国'],IT:['italy','italien','意大利'],
 ES:['spain','spanien','西班牙'],TR:['turkey','türkiye','türkei','土耳其'],
 PL:['poland','polen','波兰'],AT:['austria','österreich','奥地利'],
 TH:['thailand','泰国'],VN:['vietnam','越南'],PH:['philippines','菲律宾'],
 IN:['india','indien','印度'],AU:['australia','australien','澳大利亚'],
 JP:['japan','日本'],BR:['brazil','brasil','brasilien','巴西'],
 CA:['canada','kanada','加拿大'],MY:['malaysia','马来西亚'],
 SG:['singapore','singapur','新加坡']
}))for(const name of names)record(name,iso2);

const direct=/^(?:ich (?:wohne|lebe) in|ich komme aus|ich bin aus|i (?:currently )?live in|i(?:'m| am) from|i come from|je vis (?:en|au|aux)|je viens d(?:e|u|')|vivo en|soy de|eu moro (?:em|no|na)|eu sou d(?:e|o|a)|我(?:住在|来自)|我生活在|저는\s*|나는\s*)(?:\s+)(.+?)\s*$/iu;
const chinese=/^(?:我(?:住在|来自|生活在|现在住在|目前住在))\s*(.+?)\s*$/u;
const korean=/^(?:저는|나는)\s*(.+?)(?:에|에서)\s*살아요\s*$/u;
const negated=/\b(?:not|never|don't|dont|didn't|used to|formerly|nicht|kein|früher|avant|no vivo)\b/iu;
const lastCountry=/[.,，。!！?？;；:：]+$/u;

export function countryEvidenceFromVerifiedHistory(messages,until=Infinity){
 if(!Array.isArray(messages))return null;
 for(const m of messages.slice(-120).reverse()){
  if(m?.direction!=='INBOUND'||typeof m.original!=='string'||m.original.length>1200||
     Number(m.matrixTimestamp||m.timestamp||0)>until)continue;
  for(const segment of m.original.split(/[\r\n。!?！？;；]+/u)){
   const sentence=segment.trim();
   if(negated.test(sentence))continue;
   const match=chinese.exec(sentence)||korean.exec(sentence)||direct.exec(sentence);
   if(!match)continue;
   const place=key(match[1].replace(lastCountry,'')).replace(/^the /u,'');
   const iso2=aliases.get(place);
   if(iso2&&isSupportedCountry(iso2))
    return Object.freeze({verified:true,source:'EXPLICIT_CONTACT_COUNTRY_INBOUND',iso2});
  }
 }
 return null;
}
export function isVerifiedKtCountryEvidence(evidence){
 return !!evidence && evidence.verified===true &&
   ['USER_CONFIRMED_CONTEXT','VERIFIED_CONTACT_PROFILE','OFFICIAL_ACCOUNT_COUNTRY','EXPLICIT_CONTACT_COUNTRY_INBOUND'].includes(evidence.source) &&
   isSupportedCountry(evidence.iso2);
}
export const ktCountryPlanCount=countries.length;
