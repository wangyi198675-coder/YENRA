/**
 * Cloud-native YENRA translation metadata for a verified API Inbox inbound.
 * PURE: no network / model client / second DB / extra messages / Sender.
 * Only used on the SAME new Cloud message being created by the existing ingress.
 * The existing Chatwoot UI reads content_attributes.translations.zh_CN.
 */
const CJK=/\p{Script=Han}/u;
const LANGUAGE=/^(de|en|it|fr|es|pt|nl|pl|ko|tr|ru|ja|uk|sv|no|da|fi|ro|el|cs|hu|ar|th|vi)(?:[-_][a-zA-Z]{2,4})?$/u;
export function attachVerifiedNativeTranslation(payload,{translation,sourceLanguage,modelRoute}={}){
 if(!payload||payload.message_type!=='incoming'||payload.private!==false||
    typeof payload.source_id!=='string'||!payload.source_id||
    typeof payload.content!=='string'||!payload.content.trim()||
    !payload.content_attributes||
    payload.content_attributes.yenra_original_platform_mid!==payload.source_id)
   throw Error('TRANSLATION_ORIGINAL_MID_AND_DIRECTION_REQUIRED');
 if(typeof translation!=='string'||!translation.trim()||translation.length>4000||
    translation.trim()===payload.content.trim()||!CJK.test(translation))
   throw Error('TRANSLATION_NOT_REAL_ZH_CN');
 if(sourceLanguage!==undefined&&(typeof sourceLanguage!=='string'||!LANGUAGE.test(sourceLanguage)))
   throw Error('TRANSLATION_SOURCE_LANGUAGE_INVALID');
 if(typeof modelRoute!=='string'||!/^yenra-dsh:[a-z0-9_-]{1,55}$/u.test(modelRoute))
   throw Error('TRANSLATION_PROVIDER_UNVERIFIED');
 if(payload.content_attributes.translations!==undefined)
   throw Error('TRANSLATION_ALREADY_PRESENT');
 const updated={
   ...payload,
   content_attributes:{
     ...payload.content_attributes,
     translations:{zh_CN:translation.trim()},
     translation_provider:modelRoute,
     ...(sourceLanguage?{source_language:sourceLanguage}:{}),
   },
 };
 if(updated.content!==payload.content||updated.source_id!==payload.source_id||
    updated.message_type!==payload.message_type)
   throw Error('CLOUD_ORIGINAL_CONTENT_MUST_REMAIN_UNCHANGED');
 return updated;
}
