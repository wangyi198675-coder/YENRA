// KT native read-only duplicate lookup for a Chatwoot Cloud message.
// Source authority: existing Cloud Bridge export API. Query authority: original KT DirectSession.
// No Sender, second daemon, credential storage or legacy Page/Web route.
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

let implementation=null;
async function provider(){
  if(implementation)return implementation;
  const projectRoot=join(homedir(),'Documents','YENRA','social-adapters','kt-dedupe-native');
  const portableRoot=join(process.env.LOCALAPPDATA || join(homedir(),'AppData','Local'),'YENRA','KTNative');
  // The one official NSIS embeds the verified KT original as an extraResource.
  // Its path follows the installed executable (including custom install dirs).
  // Old running installations still use the already provisioned portable root.
  const resourcesRoot=typeof process.resourcesPath==='string'&&
    process.resourcesPath.length>3?join(process.resourcesPath,'yenra-kt-native'):null;
  // An original DSH Host launched in Electron run-as-Node mode may expose
  // execPath but not resourcesPath. Resolve relative to THIS installed app.
  const executableRoot=typeof process.execPath==='string'?
    join(dirname(process.execPath),'resources','yenra-kt-native'):null;
  const validRoot=root=>typeof root==='string'&&
    ['kt-direct-session-adapter.mjs','kt-phone-normalize.mjs','kt-country-input.mjs']
      .every(name=>existsSync(join(root,name)));
  const explicit=process.env.YENRA_KT_NATIVE_ROOT;
  const root=explicit||( [resourcesRoot,executableRoot,projectRoot,portableRoot].find(validRoot));
  if(!validRoot(root))throw Error('KT_NATIVE_RUNTIME_NOT_INSTALLED');
  const [direct,phone,country]=await Promise.all([
    import(pathToFileURL(join(root,'kt-direct-session-adapter.mjs')).href),
    import(pathToFileURL(join(root,'kt-phone-normalize.mjs')).href),
    import(pathToFileURL(join(root,'kt-country-input.mjs')).href),
  ]);
  implementation={adapter:direct.createKtDirectSessionAdapter(),
    extract:phone.extractManualKtPhoneNumbers,country:country.resolveKtCountryInput};
  return implementation;
}
const positive=x=>Number.isSafeInteger(x)&&x>0;
const fail=(reason)=>({ok:false,code:reason,canSend:false});
async function messageAt({bridgeOrigin,accountId,conversationId,messageId}){
  let before;
  let contact=null,inbox=null,cloudCountryHint=null;
  for(let page=0;page<120;page++){
    const response=await fetch(new URL('/yenra-cloud/export-page',bridgeOrigin),{
      method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:{'content-type':'application/json','x-yenra-original-dsh-cloud-export':'1'},
      body:JSON.stringify({accountId,conversationId,...(before?{before}:{})}),
    });
    if(!response.ok)throw Error('KT_CLOUD_SOURCE_UNAVAILABLE');
    const data=await response.json();
    if(data?.ok!==true||data.accountId!==accountId||
       data.conversationId!==conversationId||!positive(data.contactId)||
       !positive(data.inboxId)||!Array.isArray(data.rows)||data.rows.length>30)
      throw Error('KT_CLOUD_SOURCE_UNVERIFIED');
    if(contact===null){
      contact=data.contactId;inbox=data.inboxId;
      if(typeof data.contactCountryHint==='string'&&
         /^(?:[A-Z]{2}|\+?[1-9][0-9]{0,2}|00[1-9][0-9]{0,2})$/u.test(data.contactCountryHint))
        cloudCountryHint=data.contactCountryHint;
    }
    else if(contact!==data.contactId||inbox!==data.inboxId)
      throw Error('KT_CLOUD_CONTACT_CHANGED');
    const m=data.rows.find(x=>Number(x?.id)===messageId);
    if(m){
      if(m.message_type!==0||typeof m.content!=='string')
        throw Error('KT_INBOUND_ORIGINAL_REQUIRED');
      return {original:m.content,contactId:contact,inboxId:inbox,cloudCountryHint};
    }
    if(!data.hasMore)break;
    if(!positive(data.nextCursor)||before&&data.nextCursor>=before)
      throw Error('KT_CLOUD_PAGE_UNVERIFIED');
    before=data.nextCursor;
  }
  throw Error('KT_CLOUD_MESSAGE_NOT_FOUND');
}
export async function lookupCloudKt({bridgeOrigin,args}){
  try{
    const names=Object.keys(args??{}).sort().join(',');
    if(!['accountId,conversationId,messageId,mode',
          'accountId,conversationId,messageId,mode,number',
          'accountId,conversationId,country,messageId,mode',
          'accountId,conversationId,country,messageId,mode,number'].includes(names)||
       args.accountId!==196799||!positive(args.conversationId)||
       !positive(args.messageId)||!['inspect','check'].includes(args.mode)||
       args.country!==undefined&&(typeof args.country!=='string'||args.country.length>15)||
       args.number!==undefined&&(typeof args.number!=='string'||args.number.length>32))
      return fail('KT_REQUEST_INVALID');
    const {adapter,extract,country}=await provider();
    const source=await messageAt({...args,bridgeOrigin});
    // A complete E.164 number may disambiguate a shared calling code (e.g.
    // +39 IT/VA). Prefer the original Cloud message's verified full number
    // over treating a manually typed "39" as a region selection by itself.
    const directlyIdentified=extract(source.original);
    let countryEvidence,confirmedCountry=null;
    const countryInput=args.country??source.cloudCountryHint;
    if(countryInput){
      const selected=country(countryInput,{phoneText:source.original});
      // An invalid Cloud hint simply falls back to explicit user selection.
      if(!selected.ok&&args.country&&directlyIdentified.length===0)
        return fail(selected.error||'KT_COUNTRY_INVALID');
      if(selected.ok){
        countryEvidence={iso2:selected.iso2,verified:true,
          source:args.country?'USER_CONFIRMED_CONTEXT':'VERIFIED_CONTACT_PROFILE'};
        if(args.country)confirmedCountry=selected.iso2;
      }
    }
    // A bare 11-digit national number can also accidentally parse as an
    // unrelated E.164 number without '+': German 151... may look like US +1.
    // Cloud-verified or owner-confirmed country takes precedence for
    // unprefixed numbers. Explicit '+'/'00' still retains its meaning inside
    // the mature extractor and can target a different country.
    const withVerifiedCountry=countryEvidence?
      extract(source.original,{countryEvidence}):[];
    const found=withVerifiedCountry.length?withVerifiedCountry:directlyIdentified;
    if(!found.length)return {...fail('KT_PHONE_COUNTRY_OR_FORMAT_UNVERIFIED'),
      accountId:196799,conversationId:args.conversationId,messageId:args.messageId,
      contactId:source.contactId};
    const numbers=found.map(x=>({number:x.number,masked:x.masked,country:x.country||null}));
    const scope={accountId:196799,conversationId:args.conversationId,
      messageId:args.messageId,contactId:source.contactId,inboxId:source.inboxId};
    if(args.mode==='inspect')return {ok:true,mode:'inspect',...scope,numbers,
      ...(confirmedCountry?{confirmedCountry}:{}),canSend:false};
    if(!args.number||!numbers.some(x=>x.number===args.number))
      return fail('KT_SELECTED_NUMBER_NOT_IN_ORIGINAL_MESSAGE');
    const result=await adapter.check({number:args.number,vendorPlatform:'whats',authorized:true});
    if(!result||!['duplicate','not_duplicate','unknown','unavailable'].includes(result.status))
      return fail('KT_PROVIDER_RESULT_INVALID');
    if(['duplicate','not_duplicate'].includes(result.status)&&
       (result.freshQueryVerified!==true||!Number.isSafeInteger(result.repeatCount)))
      return fail('KT_PROVIDER_RESULT_UNVERIFIED');
    return {ok:true,mode:'check',...scope,number:args.number,
      masked:result.masked,status:result.status,
      repeatCount:result.status==='unknown'?null:result.repeatCount??null,
      reason:result.reason??null,freshQueryVerified:result.freshQueryVerified===true,
      canSend:false};
  }catch(e){
    const name=String(e?.message??'');
    return fail(/^KT_[A-Z0-9_]{4,80}$/u.test(name)?name:'KT_LOOKUP_UNAVAILABLE');
  }
}
