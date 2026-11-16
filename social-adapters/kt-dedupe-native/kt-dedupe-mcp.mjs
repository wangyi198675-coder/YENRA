// YanCe Desktop: original third-party KT lookup through the EXISTING
// locally authenticated DirectSession adapter. No duplicate query algorithm,
// OCR, desktop-window automation, token storage, or chat sender.
import {createInterface} from 'node:readline';
import {createKtLiveAdapter} from './native-kt-web-route.mjs';
import {extractManualKtPhoneNumbers} from './kt-phone-normalize.mjs';
import {resolveKtCountryInput} from './kt-country-input.mjs';

const selected=createKtLiveAdapter();
const kt=selected?.isDirectSession===true&&selected.isReadOnly===true?selected:null;
const tools=[
 {name:'kt_status',description:'Check whether the KT original read-only local session connector is installed. This does not validate an active session or expose credentials.',
  inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'kt_check_phone',description:'User-triggered read-only KT original-service duplicate lookup for one selected phone number (9+ digits). Supports international +/00 and a user-specified country when needed. No chats are sent.',
  inputSchema:{type:'object',properties:{
   number:{type:'string',description:'The phone number or selected message text; no WhatsApp keyword required'},
   country:{type:'string',description:'Optional explicitly specified ISO country or calling code (e.g. DE,49,+49,0049) for an ambiguous national number'},
   countryConfirmedByUser:{type:'boolean',description:'Legacy compatibility; country argument itself represents user-directed country selection'}
  },required:['number'],additionalProperties:false}},
 {name:'kt_check_phones',description:'Batch check selected WhatsApp numbers using KT own native bulk interface, up to 10000 per call in 1000-number original chunks; returns duplicate/not_duplicate/unknown in input order, no sender.',
  inputSchema:{type:'object',properties:{
   numbers:{type:'array',items:{type:'string'},minItems:1,maxItems:10000,
    description:'Selected numbers; supports +, 00, country-specific local number, spaces within each number'},
   numbersText:{type:'string',description:'Alternative: one number per line, or separated by comma/semicolon, but never split numbers on spaces'},
   country:{type:'string',description:'Optional ISO country or calling code for national numbers'}
  },additionalProperties:false}}
];
const write=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
const error=(id,code,message)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code,message}})+'\n');
const unavailable=(reason)=>({status:'unavailable',reason,canSend:false,freshQueryVerified:false});
function countryEvidence(args){
 const raw=args?.country;
 if(raw==null||raw==='')return {ok:true,context:undefined};
 if(typeof raw!=='string')return {ok:false,reason:'KT_COUNTRY_FORMAT_INVALID'};
 const parsed=resolveKtCountryInput(raw);
 if(!parsed.ok)return {ok:false,reason:parsed.error};
 return {ok:true,context:{iso2:parsed.iso2,verified:true,source:'USER_CONFIRMED_CONTEXT'}};
}
async function batchCheck(args){
 const country=countryEvidence(args);
 if(!country.ok)return unavailable(country.reason);
 const raw=Array.isArray(args?.numbers)?args.numbers:
  typeof args?.numbersText==='string'?args.numbersText.split(/[\r\n,;，、|]+/).map(x=>x.trim()).filter(Boolean):null;
 if(!raw||raw.length<1||raw.length>10000)return unavailable('KT_BATCH_NUMBERS_REQUIRED');
 if(!kt)return unavailable('KT_ORIGINAL_DIRECT_SESSION_NOT_CONFIGURED');
 const rows=[],normalized=new Set();
 for(const item of raw){
  if(typeof item!=='string'||item.length>1024){
   rows.push({status:'invalid',reason:'KT_SELECTED_PHONE_INVALID',canSend:false});continue;
  }
  const found=extractManualKtPhoneNumbers(item,{countryEvidence:country.context});
  if(found.length!==1){
   rows.push({status:found.length>1?'ambiguous':'invalid',
    reason:found.length>1?'KT_MULTIPLE_NUMBERS_SELECT_ONE':'KT_PHONE_COUNTRY_OR_FORMAT_UNVERIFIED',canSend:false});
   continue;
  }
  const number=found[0].number;
  normalized.add(number);
  rows.push({status:'pending',number,canSend:false});
 }
 const originals=[...normalized];
 const result=originals.length?await kt.checkBatch({
  numbers:originals,vendorPlatform:'whats',authorized:true}):null;
 if(result&&!result.ok)return unavailable(result.reason||'KT_ORIGINAL_DIRECT_QUERY_FAILED');
 // Internal exact keys are the normalized inputs, not a guessed display name.
 const lookup=new Map(originals.map((n,i)=>[n,result.results[i]]));
 const output=rows.map((row,index)=>{
  if(row.status!=='pending')return {index,...row};
  const value=lookup.get(row.number);
  return {index,masked:value?.masked??null,status:value?.status||'unknown',
   repeatCount:value?.repeatCount??null,
   reason:value?.reason??null,originalVerified:value?.freshQueryVerified===true,
   canSend:false};
 });
 return {ok:true,source:'KT_ORIGINAL_DIRECT_SESSION',results:output,
  summary:{total:output.length,duplicate:output.filter(x=>x.status==='duplicate').length,
   notDuplicate:output.filter(x=>x.status==='not_duplicate').length,
   unknown:output.filter(x=>x.status==='unknown').length,
   invalid:output.filter(x=>x.status==='invalid'||x.status==='ambiguous').length},
  canSend:false};
}
async function check(args){
 if(typeof args?.number!=='string'||args.number.length>16000||args.number.length<8)
  return unavailable('KT_SELECTED_PHONE_MISSING');
 const region=countryEvidence(args);
 if(!region.ok)return unavailable(region.reason);
 const matches=extractManualKtPhoneNumbers(args.number,{countryEvidence:region.context});
 if(matches.length===0)return unavailable('KT_PHONE_COUNTRY_OR_FORMAT_UNVERIFIED');
 if(matches.length>1)return unavailable('KT_MULTIPLE_NUMBERS_SELECT_ONE');
 if(!kt)return unavailable('KT_ORIGINAL_DIRECT_SESSION_NOT_CONFIGURED');
 const value=await kt.check({number:matches[0].number,vendorPlatform:'whats',authorized:true});
 if(value.freshQueryVerified===true && !['duplicate','not_duplicate'].includes(value.status))
  return unavailable('KT_ORIGINAL_RESULT_UNVERIFIED');
 return {...value,canSend:false};
}
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 if(line.length>64000)continue;
 let req;
 try{req=JSON.parse(line)}catch{continue}
 if(!req||typeof req!=='object'||!Object.hasOwn(req,'id'))continue;
 const {id,method,params={}}=req;
 try{
  if(method==='initialize')write(id,{protocolVersion:'2024-11-05',
   serverInfo:{name:'kt-original-readonly',version:'0.3.0-desktop-batch'},
   capabilities:{tools:{}}});
  else if(method==='ping')write(id,{});
  else if(method==='tools/list')write(id,{tools});
  else if(method==='tools/call'){
   if(params.name==='kt_status')write(id,{content:[{type:'text',
    text:JSON.stringify({source:'KT_ORIGINAL_DIRECT_SESSION',configured:!!kt,
     ...(kt?.getStatus?.()||{}),canSend:false,
     status:kt?(kt.getStatus().connectionVerified?'KT_ORIGINAL_RECENT_QUERY_VERIFIED':'KT_DIRECT_ADAPTER_READY_SESSION_NOT_YET_VERIFIED'):'KT_DIRECT_SESSION_NOT_CONFIGURED'})}]});
   else if(params.name==='kt_check_phone'||params.name==='kt_check_phones'){
    const result=params.name==='kt_check_phone'?await check(params.arguments):
     await batchCheck(params.arguments);
    write(id,{content:[{type:'text',text:JSON.stringify(result)}],
     isError:result.status==='unavailable'||result.status==='error'});
   }else error(id,-32602,'Unknown KT tool');
  }else error(id,-32601,'Method not found');
 }catch{error(id,-32603,'KT_READONLY_BRIDGE_INTERNAL_ERROR')}
}
