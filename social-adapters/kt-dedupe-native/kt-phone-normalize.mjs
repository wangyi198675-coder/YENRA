// Number normalization only. All dedupe verdicts still come from KT Original.
// Country must be explicit, independently verified contact metadata or user confirmation.
import { findPhoneNumbersInText,parsePhoneNumberFromString,getCountryCallingCode } from 'libphonenumber-js/max';
import {isVerifiedKtCountryEvidence} from './kt-country-evidence.mjs';
import {europeanCountrySet,europeanCountryCodes} from './kt-europe-regions.mjs';
const NEGATIVE = /验证码|校验码|动态码|一次性密码|订单号|订单编号|编号|运单号|物流单号|支付单号|发票号|交易编号|流水号|verification\s*code|one[-\s]*time\s*password|\botp\b|order\s*(?:number|no\.?|id)|tracking\s*(?:number|id)|bestellnummer|auftragsnummer|sendungsnummer|rechnung(?:snummer)?|code\s*(?:ist|:)/i;
const POSITIVE = /手机号|手机号码|电话号码|电话|联系号码|联系方式|联系我|我的号码|号码是|whats[\s-]?app|phone|mobile|tel(?:ephone)?\b|call me|(?:meine|deine|die)\s*(?:handy|telefon|ruf)?nummer|handynummer|telefonnummer|rufnummer|kontaktnummer|nummer\s*(?:ist|:)/i;
export const maskNumber = num => String(num).replace(/\d(?=\d{4})/g,'*');
function acceptedCountry(evidence){
  if(!isVerifiedKtCountryEvidence(evidence))return;
  return evidence.iso2;
}
export function normalizeKtPhoneNumber(raw, {countryEvidence}={}){
  if(typeof raw!=='string'||raw.length>120) return null;
  const country=acceptedCountry(countryEvidence);
  const trimmed=raw.trim();
  const explicitInternational=trimmed.startsWith('+')||trimmed.startsWith('00')||/^https?:\/\/wa\.me\//i.test(trimmed);
  const source=trimmed.replace(/^https?:\/\/wa\.me\/([1-9]\d{7,14})$/i,'+$1')
    .replace(/^00[\s.()-]*(?=[1-9])/,'+');
  // KT displays international digits without the +. Interpret them as E.164
  // only when the whole value is a valid international mobile number.
  const compact=source.replace(/[\s().-]/g,'');
  const calling=country?getCountryCallingCode(country):null;
  if(/^\d{11,15}$/.test(compact)&&!compact.startsWith('0')&&
     (!country||compact.startsWith(calling))){
    const candidate=parsePhoneNumberFromString('+'+compact);
    if(candidate?.isValid()&&candidate.country&&(!country||candidate.country===country)){
      const number=candidate.number;
      return {number,masked:maskNumber(number),country:candidate.country,
        countryEvidence:country?'VERIFIED_CONTACT_COUNTRY':'UNPREFIXED_INTERNATIONAL_DIGITS'};
    }
  }
  if(!explicitInternational&&!country)return null;
  const hits=findPhoneNumbersInText(source, country);
  const h=hits.length===1 ? hits[0] : null;
  if(!h || !h.number.isValid()) return null;
  // Do not reinterpret bare national numbers in an unverified country.
  if(!explicitInternational && (!country || h.number.country!==country))return null;
  if(h.startsAt!==0 || h.endsAt!==source.length)return null;
  const number=h.number.number;
  if(!/^\+[1-9]\d{7,14}$/.test(number))return null;
  return {number,masked:maskNumber(number),country:h.number.country||null,
    countryEvidence:explicitInternational?'EXPLICIT_INTERNATIONAL':'VERIFIED_CONTACT_COUNTRY'};
}
export function extractExplicitPhoneNumbers(text,{countryEvidence,confirmedManualLookup=false}={}){
  if(typeof text!=='string'||text.length>16000)return [];
  const country=acceptedCountry(countryEvidence);
  // Keep the parser's original ranges for contextual filtering; never guess DE from language alone.
  const candidates=[];
  const finder=findPhoneNumbersInText(text, country);
  for(const x of finder){
    const raw=text.slice(x.startsAt,x.endsAt);
    const lhs=text.slice(Math.max(0,x.startsAt-65),x.startsAt).split(/[。！？!?\n;；]/).pop()||'';
    const rhs=text.slice(x.endsAt,x.endsAt+35).split(/[。！？!?\n;；]/)[0]||'';
    const context=(lhs+' '+rhs).trim();
    const stripped=text.trim();
    const singlePhone=stripped===raw.trim();
    const explicitIntl=raw.trim().startsWith('+')||raw.trim().startsWith('00')||
      /wa\.me\/\d+$/.test(lhs+raw);
    if(NEGATIVE.test(context))continue;
    // Isolated number (as in this test chat) is eligible if country context was confirmed.
    // Inside long prose, national-format numbers additionally need phone-related words.
    if(!explicitIntl && !country)continue;
    if(!explicitIntl && !singlePhone && !POSITIVE.test(context) && !confirmedManualLookup)continue;
    const normalized=normalizeKtPhoneNumber(raw,{countryEvidence});
    if(!normalized)continue;
    candidates.push({...normalized,index:x.startsAt});
    if(candidates.length>=5)break;
  }
  // Capture KT-style bare international digits (without +) and 00-spaced
  // international dialing formats, including numbers inside labeled messages.
  const internationalCandidate=/(?:^|[^\p{L}\d])((?:00[\s.()-]*[1-9]|[1-9])[\d\s().-]{8,23}\d)(?=$|[^\d])/gu;
  for(const m of text.matchAll(internationalCandidate)){
    if(candidates.length>=5)break;
    const raw=m[1].trim();
    if(raw.startsWith('+')||raw.startsWith('0')&&!raw.startsWith('00'))continue;
    const at=m.index+m[0].indexOf(m[1]);
    const lhs=text.slice(Math.max(0,at-65),at).split(/[。！？!?\n;；]/).pop()||'';
    const rhs=text.slice(at+raw.length,at+raw.length+35).split(/[。！？!?\n;；]/)[0]||'';
    const singlePhone=text.trim()===raw;
    // An explicit international 00 prefix is itself sufficient phone evidence;
    // do not require the sender to spell 'WhatsApp' or 'phone' correctly.
    if(NEGATIVE.test(lhs+' '+rhs)||(!singlePhone&&!raw.startsWith('00')&&!POSITIVE.test(lhs+' '+rhs)&&!confirmedManualLookup))continue;
    const n=normalizeKtPhoneNumber(raw,{countryEvidence});
    if(n&&!candidates.some(x=>x.number===n.number))candidates.push({...n,index:at});
  }
  // Some official Page histories concatenate a national phone number
  // directly with Latin words (e.g. "gemacht0176...Bis"). The standard
  // parser correctly skips it. ONLY an explicit manual action with a
  // user-confirmed country may treat a contiguous digit run as a phone.
  if(confirmedManualLookup && country){
    const contiguous=/\+?\d{8,15}/g;
    for(const match of text.matchAll(contiguous)){
      if(candidates.length>=5)break;
      const at=match.index,raw=match[0];
      if((at>0 && /\d/.test(text[at-1])) || /\d/.test(text[at+raw.length]||''))continue;
      const surrounding=text.slice(Math.max(0,at-90),at)+ ' ' +
        text.slice(at+raw.length,Math.min(text.length,at+raw.length+65));
      if(NEGATIVE.test(surrounding))continue;
      const n=normalizeKtPhoneNumber(raw,{countryEvidence});
      if(n&&!candidates.some(x=>x.number===n.number))
        candidates.push({...n,index:at});
    }
  }
  // wa.me links may not be recognized by findPhoneNumbersInText when adjacent to a URL.
  const wa=/(?:https?:\/\/)?wa\.me\/([1-9]\d{7,14})/gi;
  for(const m of text.matchAll(wa)){
    if(candidates.length>=5)break;
    const n=normalizeKtPhoneNumber('+'+m[1]);
    if(n&&!candidates.some(x=>x.number===n.number))candidates.push({...n,index:m.index});
  }
  return [...new Map(candidates.map(x=>[x.number,x])).values()];
}


/**
 * User-selected KT check: the button click is the intent signal.
 * Unlike the legacy passive recognizer, this deliberately applies no
 * WhatsApp-keyword, OTP, order-reference, or chat-language classifier.
 * Only extract digit candidates with 9-15 digits, normalize known
 * international/country formats, and defer the result entirely to KT.
 */
export function extractManualKtPhoneNumbers(text,{countryEvidence}={}){
  if(typeof text!=='string'||text.length>16000)return [];
  const country=acceptedCountry(countryEvidence);
  // KT/Chatwoot contacts often write the international country prefix with
  // a comma: "39, 3337345533". Normalize ONLY a short calling-code prefix
  // before a long digit run, then delegate to the existing libphonenumber
  // recognizer. Preserve text indices by substituting comma with one space.
  let candidateText=text.replace(
    /(?<!\d)((?:\+|00)?[1-9]\d{0,2})[,，](?=\s*\d[\d\s().-]{7,28}\d)/gu,
    '$1 ');
  // A verified European country can have nationally formatted grouping
  // commas, e.g. 344,12345. Interpret a comma as number punctuation ONLY
  // if the concatenated candidate is valid under the existing numbering
  // plan, and not when both sides are themselves valid separate numbers.
  // No comma rewrite is performed for unverified local numbers.
  if(country){
    const commaIndices=[...candidateText.matchAll(/(?<=\d)[,，](?=\s*\d)/gu)]
      .map(m=>m.index).reverse();
    for(const at of commaIndices){
      const left=candidateText.slice(0,at)
        .match(/(?:\+|00)?\d[\d\s().-]*$/u)?.[0]?.trim()||'';
      const right=candidateText.slice(at+1)
        .match(/^\s*\d[\d\s().-]*/u)?.[0]?.trim()||'';
      const together=(left+right).replace(/[\s().-]/gu,'');
      if(together.replace(/\D/g,'').length<6||
         together.replace(/\D/g,'').length>15)continue;
      const full=parsePhoneNumberFromString(together,country);
      const a=parsePhoneNumberFromString(left,country);
      const b=parsePhoneNumberFromString(right,country);
      if(full?.isValid()===true&&!(a?.isValid()===true&&b?.isValid()===true))
        candidateText=candidateText.slice(0,at)+' '+candidateText.slice(at+1);
    }
  }
  const matches=[];
  // Includes digit runs joined to letters: 'gemacht017661474793Bis'.
  // Spaces, parentheses and common phone-number punctuation are accepted.
  for(const match of candidateText.matchAll(/(?<!\d)(?:\+|00)?\d[\d\s().-]{7,28}\d(?!\d)/gu)){
    const raw=match[0].trim();
    const digits=raw.replace(/\D/g,'');
    if(digits.length<9||digits.length>15)continue;
    const compact=raw.replace(/[\s().-]/g,'');
    let candidate=null,countryName=null,origin=null;
    if(compact.startsWith('+')||compact.startsWith('00')){
      const e164=compact.startsWith('00')?'+'+compact.slice(2):compact;
      if(!/^\+[1-9]\d{7,14}$/.test(e164))continue;
      const parsed=parsePhoneNumberFromString(e164);
      // A user-selected number may be new/unallocated; KT decides the result.
      // Require only an identifiable international country calling code.
      // Keep the user's exact +digits even if its calling code is unassigned.
      // KT, not the local numbering-plan library, owns the lookup result.
      // An unassigned prefix must be reported as unverified, never silently
      // corrected to an unrelated country.
      candidate=e164;countryName=parsed?.country||null;
      origin=countryName?'EXPLICIT_INTERNATIONAL':'EXPLICIT_UNALLOCATED_PREFIX';
    }else if(country){
      const calling=getCountryCallingCode(country);
      // Country prefixes already present without +: 4917... => +4917...
      if(compact.startsWith(calling)&&compact.length>=11){
        const international=parsePhoneNumberFromString('+'+compact);
        if(international?.country===country)candidate='+'+compact;
      }
      if(!candidate){
        const parsed=parsePhoneNumberFromString(compact,country);
        if(parsed?.number)candidate=parsed.number;
      }
      if(!candidate||!/^\+[1-9]\d{7,14}$/.test(candidate))continue;
      countryName=country;origin='USER_CONFIRMED_OR_VERIFIED_COUNTRY';
    }else{
      // International digits without a '+' can be recognized when their
      // country is unambiguous; bare national 9/10-digit numbers still
      // need a country selected by the user.
      if(compact.length<11||compact.startsWith('0'))continue;
      const parsed=parsePhoneNumberFromString('+'+compact);
      if(!parsed?.country)continue;
      // The selected user's project targets European numbers. A German
      // national mobile 151... can also appear as a valid US "+1..." phone:
      // with no '+' and no verified contact country, that would send KT the
      // WRONG number. For international interpretations outside Europe only,
      // detect a competing valid European national plan with the official
      // numbering metadata. In a conflict ask for country, never guess.
      // Explicit '+'/'00' and all European international prefixes still work.
      // A visibly separated calling code such as "1, 2025550143"
      // is explicit dialing evidence (the comma was normalized above).
      // This is not equivalent to the ambiguous local "15123456789".
      const calling=getCountryCallingCode(parsed.country);
      const originalAt=text.slice(match.index);
      const explicitSeparatedPrefix=originalAt.startsWith(calling+',')||
        originalAt.startsWith(calling+'，');
      if(!explicitSeparatedPrefix&&!europeanCountrySet.has(parsed.country)&&
         europeanCountryCodes.some(iso2=>{
           const possible=parsePhoneNumberFromString(compact,iso2);
           return possible?.isValid()===true&&possible.number!=='+'+compact;
         }))continue;
      candidate='+'+compact;countryName=parsed.country;
      origin='UNPREFIXED_INTERNATIONAL_DIGITS';
    }
    if(!matches.some(x=>x.number===candidate)){
      matches.push({number:candidate,masked:maskNumber(candidate),
        country:countryName,countryEvidence:origin,index:match.index});
    }
    if(matches.length>=5)break;
  }
  // Europe includes verified 6–8 digit national mobile plans (e.g. FO,
  // AD, IS, DK, NO). The >=9-digit candidate scanner above misses those
  // despite valid official libphonenumber plans. Only accept short national
  // numbers after an explicitly verified country; require genuine validity
  // in the mature numbering-plan library, never guess from chat language.
  if(country&&matches.length<5){
    // The text finder can return only one result from "number, number" even
    // when both entries are valid independent numbers. Preserve both user
    // choices, and never merge two already-valid numbers into a fake one.
    for(const pair of candidateText.matchAll(
      /(?<!\d)((?:\+|00)?\d[\d\s().-]{4,24}\d)\s*[,，]\s*((?:\+|00)?\d[\d\s().-]{4,24}\d)(?!\d)/gu)){
      const sides=[pair[1],pair[2]].map(raw=>parsePhoneNumberFromString(raw,country));
      if(!sides.every(x=>x?.isValid()===true&&x.country))continue;
      for(const parsed of sides){
        if(matches.length>=5)break;
        if(matches.some(x=>x.number===parsed.number))continue;
        matches.push({number:parsed.number,masked:maskNumber(parsed.number),
          country:parsed.country,
          countryEvidence:'USER_CONFIRMED_OR_VERIFIED_COUNTRY',index:pair.index});
      }
    }
    // The mature text finder intentionally skips digits glued to letters.
    // When a user explicitly clicks "check this number" and the country is
    // verified, validate a short contiguous run using the mature parser.
    // This does not infer a country, and does not search arbitrary prose.
    for(const part of candidateText.matchAll(/(?<!\d)\d{6,8}(?!\d)/gu)){
      if(matches.length>=5)break;
      const idx=part.index,end=idx+part[0].length;
      if(!/[\p{L}]/u.test((candidateText[idx-1]||'')+
                            (candidateText[end]||'')))continue;
      const parsed=parsePhoneNumberFromString(part[0],country);
      if(parsed?.isValid()!==true||!parsed.country||
         matches.some(x=>x.number===parsed.number))continue;
      matches.push({number:parsed.number,masked:maskNumber(parsed.number),
        country:parsed.country,
        countryEvidence:'USER_CONFIRMED_OR_VERIFIED_COUNTRY',index:idx});
    }
    for(const found of findPhoneNumbersInText(candidateText,country)){
      const raw=candidateText.slice(found.startsAt,found.endsAt);
      const digitCount=raw.replace(/\D/g,'').length;
      if(digitCount<6||digitCount>8||!found.number.isValid()||
         /^\+|^00/.test(raw))continue;
      if(matches.some(x=>x.number===found.number.number))continue;
      matches.push({number:found.number.number,
        masked:maskNumber(found.number.number),
        country:found.number.country||country,
        countryEvidence:'USER_CONFIRMED_OR_VERIFIED_COUNTRY',
        index:found.startsAt});
      if(matches.length>=5)break;
    }
  }
  return matches;
}
